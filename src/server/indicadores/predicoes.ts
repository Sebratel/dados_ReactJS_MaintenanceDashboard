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
  /** próximo horário reservado (ou das últimas 12 h), 'YYYY-MM-DD HH:MI' */
  proxima: string | null
  base: string | null
}

export type ResultadoRiscoAbertos = {
  data: AbertoAgora[]
  meta: { agora: string }
  ms: number
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
    agora: string
  }>(
    /* sql */ `
    SELECT ai.protocol::text AS protocolo,
           to_char(a.created, 'YYYY-MM-DD HH24:MI') AS criado,
           (extract(epoch FROM localtimestamp - a.created) / 3600.0)::float8 AS idade_h,
           cs.title AS catalogo, st.title AS status, p.city AS cidade, p.neighborhood AS bairro,
           to_char(ag.proxima, 'YYYY-MM-DD HH24:MI') AS proxima, ag.base,
           to_char(localtimestamp, 'YYYY-MM-DD HH24:MI') AS agora
    ${u.from}
    LEFT JOIN LATERAL (
      SELECT min(v.begin_date_slot) FILTER (
               WHERE v.routing_status >= 4 AND v.begin_date_slot >= localtimestamp - interval '12 hours'
             ) AS proxima,
             (array_agg(v.region_title ORDER BY v.begin_date_slot DESC))[1] AS base
        FROM erp.v_service_desk_slots_productivity_informative v
       WHERE v.assignment_id = a.id
    ) ag ON true
    ${u.where}
      AND NOT ${u.ehPreventiva}
      AND coalesce(st.title, '') <> all(${u.p([...STATUS_ENCERRADO])}::text[])
      AND a.created >= current_date - 120
    ORDER BY a.created`,
    u.params
  )
  return {
    data: r.rows.map(({ idade_h, agora: _a, ...l }) => ({ ...l, idadeH: idade_h })),
    meta: { agora: r.rows[0]?.agora ?? '' },
    ms: r.ms,
  }
}
