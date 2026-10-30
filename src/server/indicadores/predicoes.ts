import { consultarErp } from '@/server/db/erp'
import {
  CATEGORIAS_PREVENTIVAS,
  FERIADOS,
  STATUS_ENCERRADO,
  TIPOS_FORA_DA_RECORRENCIA,
  TIPOS_PREVENTIVOS,
  TRILHA_MANUTENCAO,
} from '@/config/regras-negocio'
import { filtrosPadrao, type Filtros } from '@/lib/filtros'
import {
  aglomeracoes,
  avaliarPrevisao,
  classificarAgendamento,
  type ClasseAgendamento,
  bairrosEmAlta,
  curvaDeFechamento,
  faixaAtual,
  loginsCronicos,
  perfilDoCampo,
  planejarCampo,
  preverProximos,
  somarDias,
  taxasDeVolta,
  visitasPorReparo,
  type Aglomeracao,
  type Avaliacao,
  type BairroEmAlta,
  type CurvaFechamento,
  type DiaPlano,
  type LoginCronico,
  type PerfilCampo,
  type PontoPrevisao,
  type TaxasDeVolta,
} from '@/lib/previsao'
import { montarFrom, montarWhere } from './base'

/**
 * A tela de Predições — seis perguntas que o histórico responde sobre os
 * próximos dias. As contas estão em `lib/previsao.ts`; aqui só o SQL e a
 * montagem.
 *
 * ⚠️ NÃO OBEDECE À BARRA DE FILTROS, e a tela não a mostra. Os métodos foram
 * medidos no universo inteiro da Manutenção: recortar por cidade deixaria a
 * série diária com 5 a 15 reparos, onde a mediana de 8 semanas vira ruído e
 * a faixa calibrada deixa de valer. Previsão por base é trabalho futuro, com
 * backtest próprio — não um filtro que finge funcionar.
 *
 * ⚠️ CUSTO: cinco consultas, ~15 s somadas na réplica (medido em 22/10/2026:
 * diário 2,3 s, coorte 1,6 s, campo 5,2 s, bairros 2,6 s, logins 1,8 s). Por
 * isso o TTL é de 3 h e elas correm em ondas, nunca as cinco juntas — duas
 * consultas pesadas colidindo degradam uma à outra em até 8× nesta base. O
 * dado de entrada é diário: recalcular a cada poucos minutos não mudaria
 * previsão nenhuma, só a carga.
 */

/** Dias de entrada diária carregados: 140 de backtest + 70 que cada alvo precisa para trás. */
const DIAS_DIARIO = 224
/** Coorte da curva de fechamento: aberta nas últimas 12 semanas. */
const DIAS_COORTE = 84
/** Ritmo do campo: as últimas 8 semanas. */
const DIAS_CAMPO = 56
/** Bairros: 4 semanas recentes + 12 de base. */
const DIAS_BAIRROS = 112
/** Logins: 90 dias para trás + 30 para a frente + 13 semanas de referência. */
const DIAS_LOGINS = 210

/**
 * O universo das telas (base.ts) mais a expressão de preventiva. Cada consulta
 * monta o seu, porque `montarWhere` numera os parâmetros a partir de $1.
 */
function universo() {
  const w = montarWhere(filtrosPadrao(), { ignorarPeriodo: true })
  const p = (v: unknown) => `$${w.params.push(v)}`
  // `coalesce(…, false)`: protocolo sem tipo e sem categoria é reparo. Sem o
  // coalesce o `NOT` daria NULL e ele sumiria das DUAS contagens.
  const ehPreventiva = `coalesce(it.title = any(${p([...TIPOS_PREVENTIVOS])}::text[])
    or cat2.title = any(${p([...CATEGORIAS_PREVENTIVAS])}::text[]), false)`
  return { from: montarFrom({ categorias: true }), where: w.sql, params: w.params, ehPreventiva, p }
}

type LinhaDia = { dia: string; reparos: number }
type LinhaHora = { hora: number; n: number }
type LinhaCampo = { dia: string; visitas_reparo: number; visitas_prev: number; tecnicos: number }
type LinhaBairro = { dia: string; cidade: string | null; bairro: string | null; n: number }
type LinhaLogin = { instalacao: string; dia: string; cidade: string | null; bairro: string | null }
type LinhaHoje = { hoje: string; agora: string }

async function consultarDiario() {
  const u = universo()
  return consultarErp<LinhaDia>(
    /* sql */ `
    SELECT to_char(a.created::date, 'YYYY-MM-DD') AS dia,
           count(*) FILTER (WHERE NOT ${u.ehPreventiva})::int AS reparos
    ${u.from}
    ${u.where}
      AND a.created >= current_date - ${u.p(DIAS_DIARIO)}::int
    GROUP BY 1
    ORDER BY 1`,
    u.params
  )
}

/**
 * A coorte da curva de fechamento: reparos ABERTOS nas últimas 12 semanas que
 * já têm mais de 48h de vida, com as horas até fechar (ou -1, se seguem
 * abertos). Ver `curvaDeFechamento` para o porquê de ser por abertura.
 */
async function consultarCoorte() {
  const u = universo()
  return consultarErp<LinhaHora>(
    /* sql */ `
    SELECT CASE WHEN a.conclusion_date IS NOT NULL AND st.title = any(${u.p([...STATUS_ENCERRADO])}::text[])
                THEN least(floor(extract(epoch FROM a.conclusion_date - a.created) / 3600.0)::int, 720)
                ELSE -1 END AS hora,
           count(*)::int AS n
    ${u.from}
    ${u.where}
      AND NOT ${u.ehPreventiva}
      -- a mesma população da lista de abertos (30/10/2026): requisição estoura
      -- 48h o dobro (8,6% × 4,3%) e subia a chance de todo incidente 1 a 3 pontos
      AND coalesce(it.title, '') <> all(${u.p([...TIPOS_FORA_DA_RECORRENCIA])}::text[])
      AND a.created >= current_date - ${u.p(DIAS_COORTE)}::int
      AND a.created < localtimestamp - interval '48 hours'
    GROUP BY 1
    ORDER BY 1`,
    u.params
  )
}

/**
 * Visitas do campo por dia, só na trilha de Manutenção, separadas em reparo e
 * preventiva, e quantos técnicos distintos foram a campo.
 *
 * Visita = protocolo × dia com horário reservado ou executado (`routing_status
 * >= 4`) — a mesma regra da Produtividade. A linha de sugestão do roteirizador
 * (0) não é visita.
 *
 * Só o PASSADO: em 22/10/2026 a view não tinha nenhum horário reservado de
 * amanhã em diante — a agenda da Manutenção é montada no próprio dia, então
 * "agenda já ocupada" não é uma informação que exista para prever.
 */
async function consultarCampo() {
  const params: unknown[] = []
  const p = (v: unknown) => `$${params.push(v)}`
  const sql = /* sql */ `
    WITH vis AS (
      SELECT DISTINCT v.assignment_id, v.begin_date_slot::date AS dia, v.resource_name
        FROM erp.v_service_desk_slots_productivity_informative v
       WHERE v.begin_date_slot >= current_date - ${p(DIAS_CAMPO)}::int
         AND v.begin_date_slot < current_date
         AND v.routing_status >= 4
         AND v.region_title LIKE '%' || ${p(TRILHA_MANUTENCAO)} || '%'
    ), cls AS (
      SELECT vis.*,
             coalesce(it.title = any(${p([...TIPOS_PREVENTIVOS])}::text[])
               or cat2.title = any(${p([...CATEGORIAS_PREVENTIVAS])}::text[]), false) AS prev
        FROM vis
        LEFT JOIN erp.assignment_incidents ai ON ai.assignment_id = vis.assignment_id
        LEFT JOIN erp.incident_types it ON it.id = ai.incident_type_id
        LEFT JOIN erp.solicitation_category_matrices scm ON scm.id = ai.solicitation_category_matrix_id
        LEFT JOIN erp.solicitation_service_categories cat2 ON cat2.id = scm.service_category_id_2
    )
    SELECT to_char(dia, 'YYYY-MM-DD') AS dia,
           count(DISTINCT assignment_id) FILTER (WHERE NOT prev)::int AS visitas_reparo,
           count(DISTINCT assignment_id) FILTER (WHERE prev)::int AS visitas_prev,
           count(DISTINCT resource_name)::int AS tecnicos
      FROM cls
     GROUP BY 1
     ORDER BY 1`
  return consultarErp<LinhaCampo>(sql, params)
}

async function consultarBairros() {
  const u = universo()
  return consultarErp<LinhaBairro>(
    /* sql */ `
    SELECT to_char(a.created::date, 'YYYY-MM-DD') AS dia, p.city AS cidade, p.neighborhood AS bairro,
           count(*)::int AS n
    ${u.from}
    ${u.where}
      AND NOT ${u.ehPreventiva}
      AND a.created >= current_date - ${u.p(DIAS_BAIRROS)}::int
      AND a.created < current_date
    GROUP BY 1, 2, 3`,
    u.params
  )
}

/**
 * Reparos por login PPPoE — a mesma chave da Recorrência (LATERAL com LIMIT 1,
 * contrato ativo primeiro) e o mesmo corte: requisição e regularização não são
 * "o cliente voltou a ter problema" (`TIPOS_FORA_DA_RECORRENCIA`).
 */
async function consultarLogins() {
  const u = universo()
  return consultarErp<LinhaLogin>(
    /* sql */ `
    SELECT coalesce(ac."user", 'tag:' || ai.contract_service_tag_id::text) AS instalacao,
           to_char(a.created::date, 'YYYY-MM-DD') AS dia, p.city AS cidade, p.neighborhood AS bairro
    ${u.from}
    LEFT JOIN LATERAL (
      SELECT x."user"
        FROM erp.authentication_contracts x
       WHERE x.service_tag_id = ai.contract_service_tag_id
       ORDER BY x.active DESC NULLS LAST, x.id DESC
       LIMIT 1
    ) ac ON true
    ${u.where}
      AND NOT ${u.ehPreventiva}
      AND coalesce(it.title, '') <> all(${u.p([...TIPOS_FORA_DA_RECORRENCIA])}::text[])
      AND ai.contract_service_tag_id IS NOT NULL
      AND a.created >= current_date - ${u.p(DIAS_LOGINS)}::int
      AND a.created < current_date + 1`,
    u.params
  )
}

/** O "hoje" é o do banco: o fuso do contêiner não decide que dia é. */
async function consultarHoje() {
  return consultarErp<LinhaHoje>(
    `SELECT to_char(current_date, 'YYYY-MM-DD') AS hoje,
            to_char(localtimestamp, 'YYYY-MM-DD HH24:MI') AS agora`
  )
}

export type ResultadoPredicoes = {
  data: {
    hoje: string
    agora: string
    /** reparos que já entraram hoje, até `agora` */
    entradaHoje: number | null
    /** os 28 últimos dias completos, para o gráfico */
    recentes: { dia: string; reparos: number }[]
    previsao: PontoPrevisao[]
    avaliacao: Avaliacao | null
    campo: {
      plano: DiaPlano[]
      visitasPorReparo: number | null
      /** índice = dia da semana (0 = domingo) */
      perfis: (PerfilCampo | null)[]
    }
    fechamento: CurvaFechamento | null
    bairros: { emAlta: BairroEmAlta[]; aglomeracoes: Aglomeracao[] }
    logins: TaxasDeVolta & { cronicos: LoginCronico[] }
  }
  meta: { msPorConsulta: Record<string, number> }
  ms: number
}

export async function obterPredicoes(_f: Filtros): Promise<ResultadoPredicoes> {
  const t0 = Date.now()

  // ondas: as leves juntas, a da view sozinha, as duas de janela longa juntas
  const [rHoje, rDiario, rCoorte] = await Promise.all([consultarHoje(), consultarDiario(), consultarCoorte()])
  const rCampo = await consultarCampo()
  const [rBairros, rLogins] = await Promise.all([consultarBairros(), consultarLogins()])

  const { hoje, agora } = rHoje.rows[0]!
  const ontem = somarDias(hoje, -1)

  const serie = new Map<string, number>()
  let entradaHoje: number | null = null
  for (const r of rDiario.rows) {
    if (r.dia < hoje) serie.set(r.dia, r.reparos)
    else if (r.dia === hoje) entradaHoje = r.reparos
  }

  const faixa = faixaAtual(serie, ontem, FERIADOS)
  const previsao = faixa ? preverProximos(serie, hoje, FERIADOS, faixa) : []

  const campo = rCampo.rows.map((r) => ({
    dia: r.dia,
    visitasReparo: r.visitas_reparo,
    visitasPrev: r.visitas_prev,
    tecnicos: r.tecnicos,
  }))
  const perfis = perfilDoCampo(campo, FERIADOS)
  const razao = visitasPorReparo(campo, serie)

  const taxas = taxasDeVolta(rLogins.rows, ontem)

  return {
    data: {
      hoje,
      agora,
      entradaHoje,
      recentes: [...serie]
        .filter(([dia]) => dia > somarDias(ontem, -28))
        .map(([dia, reparos]) => ({ dia, reparos })),
      previsao,
      avaliacao: avaliarPrevisao(serie, ontem, FERIADOS),
      campo: {
        plano: razao === null ? [] : planejarCampo(previsao, perfis, razao, FERIADOS),
        visitasPorReparo: razao,
        perfis,
      },
      fechamento: curvaDeFechamento(rCoorte.rows),
      bairros: {
        emAlta: bairrosEmAlta(rBairros.rows, ontem),
        aglomeracoes: aglomeracoes(rBairros.rows, ontem),
      },
      logins: { ...taxas, cronicos: loginsCronicos(rLogins.rows, hoje) },
    },
    meta: {
      msPorConsulta: {
        diario: rDiario.ms,
        coorte: rCoorte.ms,
        campo: rCampo.ms,
        bairros: rBairros.ms,
        logins: rLogins.ms,
      },
    },
    ms: Date.now() - t0,
  }
}

// ── os abertos de agora, com validade curta ────────────────────────────────

export type AbertoAgora = {
  protocolo: string
  criado: string
  idadeH: number
  catalogo: string | null
  status: string | null
  cidade: string | null
  bairro: string | null
  /**
   * Quando o técnico vai ao cliente: o horário do agendamento MAIS RECENTE,
   * 'YYYY-MM-DD HH:MI'. Pode estar no passado — visita de hoje já feita, com o
   * protocolo ainda aberto.
   */
  proxima: string | null
  base: string | null
  /** o 1º agendamento foi a pedido do cliente ou conforme a agenda (null = sem registro) */
  primeiroAgendamento: ClasseAgendamento | null
  /** o motivo escrito do 1º agendamento, quando diz alguma coisa */
  motivoAgendamento: string | null
  /** quantas vezes foi remarcado depois do 1º agendamento */
  remarcacoes: number
  /**
   * Outros reparos do mesmo login PPPoE — este fora — por faixa exclusiva
   * (até 30 dias, 31–60, 61–90) e em todo o histórico do ERP (desde 2016). Ver
   * `historicoDosLogins`.
   */
  historico: { p30: number; p60: number; p90: number; pt: number }
}

export type ResultadoRiscoAbertos = {
  data: AbertoAgora[]
  meta: { agora: string }
  ms: number
}

/**
 * HISTÓRICO DE REPARO DE CADA ABERTO, pedido da Manutenção em 30/10/2026 para
 * priorizar atendimento de qualidade em quem já teve muito reparo.
 *
 * Mesma chave e mesmo corte do "Logins com 3+ reparos" desta tela e da
 * Recorrência: login PPPoE (LATERAL com LIMIT 1, contrato ativo primeiro; sem
 * login, o service tag), sem preventiva, sem requisição/regularização.
 * Por login e não por contrato: contrato agrega instalações (docs em
 * recorrencia.ts, o cliente 14458 com 55 service tags).
 *
 * Duas consultas em vez de um LATERAL: o LATERAL repetiria o universo inteiro
 * com outros aliases. Aqui os service tags candidatos são os dos abertos MAIS
 * os outros tags dos mesmos logins (troca de contrato mantém o login), e a
 * chave de cada protocolo é recalculada e conferida em JS.
 */
async function historicoDosLogins(tags: number[], logins: string[]) {
  const u = universo()
  return consultarErp<{ protocolo: string; instalacao: string; dias: number }>(
    /* sql */ `
    SELECT ai.protocol::text AS protocolo,
           coalesce(ac."user", 'tag:' || ai.contract_service_tag_id::text) AS instalacao,
           -- dias de CALENDÁRIO, não horas ÷ 24: aberto 30/09 08:01 é "30 dias"
           -- em 30/10 o dia inteiro. Em horas ele virava 30,12 às 10h e caía no
           -- P60 (protocolo 1835395, conferido pela Manutenção em 30/10/2026)
           (current_date - a.created::date)::int AS dias
    ${u.from}
    LEFT JOIN LATERAL (
      SELECT x."user"
        FROM erp.authentication_contracts x
       WHERE x.service_tag_id = ai.contract_service_tag_id
       ORDER BY x.active DESC NULLS LAST, x.id DESC
       LIMIT 1
    ) ac ON true
    ${u.where}
      AND NOT ${u.ehPreventiva}
      AND coalesce(it.title, '') <> all(${u.p([...TIPOS_FORA_DA_RECORRENCIA])}::text[])
      AND ai.contract_service_tag_id IN (
            SELECT unnest(${u.p(tags)}::bigint[])
            UNION
            SELECT x.service_tag_id FROM erp.authentication_contracts x
             WHERE x."user" = any(${u.p(logins)}::text[]))`,
    u.params
  )
}

/**
 * Os reparos abertos AGORA — separado das previsões porque muda de hora em
 * hora e custa pouco (~1,7 s, ~40 linhas). O risco de cada um é calculado na
 * tela, cruzando com a curva de `obterPredicoes` (`riscoDoAberto`): a curva
 * muda devagar e não vale reconsultá-la a cada 10 minutos.
 *
 * 120 dias de abertura: protocolo esquecido aberto há meses existe (havia um
 * de julho em 22/10/2026) e PRECISA aparecer — é o "estourou" mais grave.
 */
export async function obterRiscoAbertos(_f: Filtros): Promise<ResultadoRiscoAbertos> {
  const u = universo()
  const r = await consultarErp<{
    protocolo: string
    criado: string
    idade_h: number
    catalogo: string | null
    status: string | null
    cidade: string | null
    bairro: string | null
    proxima: string | null
    base: string | null
    agendamentos: number
    chk_pedido: string | null
    chk_motivo: string | null
    mascara: ClasseAgendamento | null
    mascara_motivo: string | null
    instalacao: string | null
    tag: number | null
    agora: string
  }>(
    /* sql */ `
    SELECT ai.protocol::text AS protocolo,
           to_char(a.created, 'YYYY-MM-DD HH24:MI') AS criado,
           (extract(epoch FROM localtimestamp - a.created) / 3600.0)::float8 AS idade_h,
           cs.title AS catalogo, st.title AS status, p.city AS cidade, p.neighborhood AS bairro,
           to_char(ag.proxima, 'YYYY-MM-DD HH24:MI') AS proxima, ag.base, ag.agendamentos,
           chk.pedido AS chk_pedido, chk.motivo AS chk_motivo,
           CASE WHEN mk.pedido AND mk.conforme THEN NULL
                WHEN mk.pedido THEN 'pedido' WHEN mk.conforme THEN 'agenda' END AS mascara,
           mk.motivo AS mascara_motivo,
           CASE WHEN ai.contract_service_tag_id IS NOT NULL
                THEN coalesce(ac."user", 'tag:' || ai.contract_service_tag_id::text) END AS instalacao,
           ai.contract_service_tag_id::int8 AS tag,
           to_char(localtimestamp, 'YYYY-MM-DD HH24:MI') AS agora
    ${u.from}
    -- a chave do histórico (historicoDosLogins): a mesma da Recorrência
    LEFT JOIN LATERAL (
      SELECT x."user"
        FROM erp.authentication_contracts x
       WHERE x.service_tag_id = ai.contract_service_tag_id
       ORDER BY x.active DESC NULLS LAST, x.id DESC
       LIMIT 1
    ) ac ON true
    /*
     * O 1º AGENDAMENTO FOI A PEDIDO DO CLIENTE? Duas fontes, as mesmas da
     * consulta de auditoria da Manutenção (29/10/2026); a regra que escolhe
     * entre elas está em classificarAgendamento (lib/previsao.ts).
     *
     * Checklist (novo): beginning_checklist do protocolo, um objeto JSON com os
     * itens "Pedido do Cliente:" (yesno, '1'/'0') e "Motivo da Data:" (texto).
     * Máscara (antiga): o PRIMEIRO relato com "Motivo da Data:", lida pela
     * posição do (x) entre "Conforme Agenda" e "Pedido do Cliente". Os dois
     * marcados = ambíguo = NULL.
     *
     * Custo: só roda para os abertos (~45 linhas) — medido ~0,2 s a mais. A
     * consulta de auditoria varria o ano inteiro; aqui não precisa.
     */
    LEFT JOIN LATERAL (
      SELECT max(CASE WHEN lower(e.v->>'label') LIKE 'pedido do cliente%' THEN e.v->>'value' END) AS pedido,
             max(CASE WHEN lower(e.v->>'label') LIKE 'motivo da data%'   THEN e.v->>'value' END) AS motivo
        FROM jsonb_each(CASE WHEN left(btrim(ai.beginning_checklist), 1) = '{'
                             THEN ai.beginning_checklist::jsonb END) AS e(k, v)
    ) chk ON true
    LEFT JOIN LATERAL (
      SELECT (substring(lower(t.txt) from 'motivo da data:(.*?)conforme agenda')  ~ '\\([^)]*x[^)]*\\)') AS conforme,
             (substring(lower(t.txt) from 'conforme agenda(.*?)pedido do cliente') ~ '\\([^)]*x[^)]*\\)') AS pedido,
             substring(t.txt from '(?i)Pedido do Cliente\\s*(?:\\([^)]*\\))?\\s*:?\\s*([^\\n\\r·]*)') AS motivo
        FROM (SELECT replace(regexp_replace(regexp_replace(regexp_replace(
                       translate(r.description, chr(160) || chr(8199) || chr(8239), '   '),
                     '(?i)<br\\s*/?>', E'\\n', 'g'), '(?i)</p\\s*>', E'\\n', 'g'), '<[^>]+>', '', 'g'), '*', '') AS txt
                FROM erp.reports r
               WHERE r.assignment_id = a.id AND r.description ILIKE '%Motivo da Data:%'
               ORDER BY r.beginning_date
               LIMIT 1) t
    ) mk ON true
    /*
     * O ÚLTIMO AGENDAMENTO, com ou sem técnico reservado. Decisão da
     * Manutenção em 29/10/2026: "quando o técnico vai no cliente" — se houve 2
     * ou 3 remarcações, vale a mais recente.
     *
     * Antes era o horário RESERVADO (routing_status >= 4) mais cedo a partir de
     * 12 h atrás, e isso era quase cego: a Manutenção só reserva o técnico no
     * próprio dia, então reagendamento para outro dia (routing_status 0) não
     * aparecia, e a visita de hoje que já tinha passado aparecia como
     * "próxima". Medido em 29/10/2026, ~85 abertos: 79 sem horário na regra
     * antiga e 0 "visita depois das 48h", contra 22 na nova. Caso que achou o
     * defeito: protocolo 1870630, visitado 29/10 14:00, remarcado às 16:56
     * para 31/10 09:30 — 49 h depois da abertura, e a tela dizia 8%.
     *
     * identifier_attendance é quando o agendamento foi criado: é ele que
     * ordena as remarcações, não a data da visita (remarcar pode antecipar).
     * Dentro do mesmo agendamento, a linha do técnico reservado vem antes da
     * sugestão do roteirizador.
     */
    LEFT JOIN LATERAL (
      SELECT v.begin_date_slot AS proxima, v.region_title AS base,
             -- quantos agendamentos houve: 1 + as remarcações
             (SELECT count(DISTINCT x.identifier_attendance)::int
                FROM erp.v_service_desk_slots_productivity_informative x
               WHERE x.assignment_id = a.id) AS agendamentos
        FROM erp.v_service_desk_slots_productivity_informative v
       WHERE v.assignment_id = a.id
       ORDER BY v.identifier_attendance DESC NULLS LAST, v.routing_status DESC, v.begin_date_slot DESC
       LIMIT 1
    ) ag ON true
    ${u.where}
      AND NOT ${u.ehPreventiva}
      -- requisição e regularização saem (30/10/2026): o histórico P30–PT já não
      -- as contava (TIPOS_FORA_DA_RECORRENCIA), e a lista as mostrava como
      -- "reparo aberto" — a linha entrava, o mesmo tipo no passado não somava
      AND coalesce(it.title, '') <> all(${u.p([...TIPOS_FORA_DA_RECORRENCIA])}::text[])
      AND coalesce(st.title, '') <> all(${u.p([...STATUS_ENCERRADO])}::text[])
      AND a.created >= current_date - 120
    ORDER BY a.created`,
    u.params
  )
  const tags = [...new Set(r.rows.flatMap((x) => (x.tag === null ? [] : [Number(x.tag)])))]
  const logins = [
    ...new Set(r.rows.flatMap((x) => (x.instalacao && !x.instalacao.startsWith('tag:') ? [x.instalacao] : []))),
  ]
  const h = tags.length ? await historicoDosLogins(tags, logins) : null
  const porLogin = new Map<string, { protocolo: string; dias: number }[]>()
  for (const x of h?.rows ?? []) {
    const v = porLogin.get(x.instalacao)
    if (v) v.push(x)
    else porLogin.set(x.instalacao, [x])
  }
  const historico = (instalacao: string | null, protocolo: string) => {
    // o próprio protocolo aberto não é histórico dele
    const outros = (instalacao ? porLogin.get(instalacao) ?? [] : []).filter((x) => x.protocolo !== protocolo)
    // faixas EXCLUSIVAS, as mesmas do Retorno da aba Protocolos: acumuladas,
    // um reparo só de 10 dias atrás lia "1 · 1 · 1" e parecia três (30/10/2026)
    const entre = (de: number, ate: number) => outros.filter((x) => x.dias > de && x.dias <= ate).length
    return { p30: entre(-1, 30), p60: entre(30, 60), p90: entre(60, 90), pt: outros.length }
  }

  return {
    data: r.rows.map(
      ({ idade_h, agora: _a, agendamentos, chk_pedido, chk_motivo, mascara, mascara_motivo, instalacao, tag: _t, ...l }) => {
        const c = classificarAgendamento({
          chkPedido: chk_pedido,
          chkMotivo: chk_motivo,
          mascara,
          mascaraMotivo: mascara_motivo,
        })
        return {
          ...l,
          idadeH: idade_h,
          primeiroAgendamento: c.classe,
          motivoAgendamento: c.motivo,
          remarcacoes: Math.max(0, (agendamentos ?? 0) - 1),
          historico: historico(instalacao, l.protocolo),
        }
      }
    ),
    meta: { agora: r.rows[0]?.agora ?? '' },
    ms: r.ms + (h?.ms ?? 0),
  }
}
