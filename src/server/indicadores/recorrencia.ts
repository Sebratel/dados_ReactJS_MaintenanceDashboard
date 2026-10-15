import { consultarErp } from '@/server/db/erp'
import {
  CATALOGOS_MANUTENCAO,
  CATEGORIAS_PREVENTIVAS,
  CLIENTES_TESTE,
  EQUIPES_FORA_DA_MANUTENCAO,
  EQUIPES_MANUTENCAO,
  TIPOS_FORA_DA_MANUTENCAO,
  TIPOS_FORA_DA_RECORRENCIA,
  TIPOS_PREVENTIVOS,
} from '@/config/regras-negocio'
import { CLASSE_REC_POR_CODIGO, type Filtros } from '@/lib/filtros'

/**
 * Reincidência e recorrência de clientes (docs/01 §5).
 *
 * DUAS COISAS DIFERENTES, e o relatório antigo as mistura na conversa:
 *
 *   REINCIDENTE = o cliente voltou a abrir chamado em ALGUMA das janelas
 *                 (30, 31–60 ou 61–90 dias antes). Classificação por
 *                 alternativa — testa 90, depois 60, depois 30.
 *   RECORRENTE  = o cliente voltou a abrir chamado em TODAS as janelas
 *                 consecutivas. É problema crônico, não repetição eventual.
 *                 Classificação CUMULATIVA (§5.3).
 *
 * Um cliente com um chamado há 80 dias é "Reincidente 90" e "Não recorrente".
 * Um cliente com chamado nos últimos 30, entre 31–60 E entre 61–90 é
 * "Recorrente 90" — três meses seguidos com problema.
 *
 * REGRAS QUE NÃO SÃO ÓBVIAS:
 * - Preventiva NUNCA conta, nem como protocolo classificado nem como chamado
 *   anterior. Preventiva é visita que NÓS agendamos; contá-la faria a nossa
 *   própria ação preventiva parecer reincidência do cliente.
 * - Só o ÚLTIMO protocolo do mês de cada cliente é classificado. Sem isso, um
 *   cliente com 4 chamados no mês entraria 4 vezes na conta e distorceria o
 *   percentual.
 * - Recorrência exclui do UNIVERSO inteiro `categoria5 = 'Solucao Interna'`
 *   (§5.3): chamado resolvido internamente (sem agenda nem relato de campo)
 *   não caracteriza problema recorrente do cliente, e nem deveria contar como
 *   "reparo" nenhum. Medido em 09/09/2026: de 20.269 protocolos com essa
 *   categoria em mai–ago/2026, só 7 (0,03%) tinham algum sinal de campo —
 *   todos de equipes-fringe já conhecidas como ruído (`Técnica [Nova Santa
 *   Rita]`/`Técnica [Triunfo]`, ver docs/06 item A).
 *
 * A CHAVE É A INSTALAÇÃO, NÃO O CLIENTE — e isso é essencial, não detalhe.
 *
 * Recorrência responde "qual INSTALAÇÃO volta a dar problema". Agrupar por
 * cliente quebra em cliente corporativo: um cliente com 55 instalações em
 * cidades diferentes apareceria como cronicamente recorrente sendo que cada
 * ponto teve um único chamado. Caso real no banco: o cliente 14458 tem 55
 * service tags.
 *
 * Caminho até o login PPPoE:
 *   assignment_incidents.contract_service_tag_id
 *     → authentication_contracts.service_tag_id
 *       → authentication_contracts.user
 *
 * Medido no universo de manutenção (jul/2026): 3.722 de 3.765 protocolos (98,9%)
 * resolvem para EXATAMENTE 1 login; 41 não têm contrato de autenticação
 * (serviço sem PPPoE); 2 são ambíguos.
 *
 * ⚠️ NÃO ir por `contract_id`. Esse caminho parece equivalente e não é: um
 * contrato agrega várias instalações, então o cliente 14458 viraria 108 logins
 * em vez de 76 — reintroduzindo exatamente a distorção que a chave por
 * instalação existe para evitar.
 *
 * ⚠️ `nn_authentication_contract_info` (que o nome sugere ser a ponte) é 100%
 * NULL — 0 de 39.562 protocolos. Coluna morta.
 *
 * FALLBACK: quando não há login, a chave passa a ser o próprio service tag
 * (`tag:<id>`). O service tag está preenchido em 100% do universo de manutenção,
 * então nenhum protocolo é descartado em silêncio.
 */

export type ClasseReincidencia =
  | 'Reincidente 30'
  | 'Reincidente 60'
  | 'Reincidente 90'
  | 'Não Reincidente'

export type ClasseRecorrencia =
  | 'Recorrente 30'
  | 'Recorrente 60'
  | 'Recorrente 90'
  | 'Não recorrente'

type LinhaRecorrencia = {
  classe_reincidencia: ClasseReincidencia
  classe_recorrencia: ClasseRecorrencia
  cidade: string | null
  bairro: string | null
  catalogo: string | null
  mes: string
  clientes: number
}

export type ItemClasse<T extends string> = { classe: T; clientes: number; share: number }

export type ItemDimensaoRecorrencia = {
  rotulo: string
  clientes: number
  reincidentes: number
  recorrentes: number
  taxaReincidencia: number | null
  taxaRecorrencia: number | null
}

export type PontoMesRecorrencia = {
  mes: string
  clientes: number
  reincidentes: number
  recorrentes: number
  taxaReincidencia: number | null
  /**
   * Faltava, e a tela de Recorrência precisava dela: a série mensal só
   * devolvia a taxa de REINCIDÊNCIA, então o painel de evolução não tinha como
   * falar de recorrência sem recalcular `rec / clientes` no cliente — conta que
   * já existe aqui e em todas as outras dimensões.
   */
  taxaRecorrencia: number | null
}

export type ResultadoRecorrencia = {
  data: {
    total: {
      clientesBase: number
      reincidentes: number
      recorrentes: number
      taxaReincidencia: number | null
      taxaRecorrencia: number | null
      /** cada janela isolada, para os cartões 30/60/90 */
      pctReincidente30: number | null
      pctReincidente60: number | null
      pctReincidente90: number | null
      pctRecorrente30: number | null
      pctRecorrente60: number | null
      pctRecorrente90: number | null
    }
    porClasseReincidencia: ItemClasse<ClasseReincidencia>[]
    porClasseRecorrencia: ItemClasse<ClasseRecorrencia>[]
    porCidade: ItemDimensaoRecorrencia[]
    /**
     * Bairro do SOLICITANTE (`people.neighborhood`), pedido da Manutenção em
     * 15/10/2026 — é o grão em que a operação consegue agir: cidade diz onde
     * olhar, bairro diz onde ir.
     *
     * ⚠️ Acrescentar `bairro` ao GROUP BY não mexe em total nenhum, e isso não
     * é sorte: `base` tem UMA linha por (instalação, mês) — é o que `rn_mes = 1`
     * garante —, então cada instalação já tem um único bairro. A coluna é
     * funcionalmente determinada pelo que já estava agrupado, e o
     * `count(DISTINCT instalacao)` não se reparte. Conferido depois da mudança:
     * `clientesBase` e `recorrentes` idênticos.
     */
    porBairro: ItemDimensaoRecorrencia[]
    porCatalogo: ItemDimensaoRecorrencia[]
    porMes: PontoMesRecorrencia[]
  }
  meta: {
    /** protocolos sem login PPPoE, que caíram no fallback por service tag */
    protocolosSemLogin: number
    protocolosNoUniverso: number
    clientesBase: number
    linhas: number
    /** tempos separados: sem isso não se sabe qual das duas consultas custa */
    msClassificacao: number
    msDiagnostico: number
  }
  ms: number
}

const ORDEM_REINC: ClasseReincidencia[] = [
  'Reincidente 30',
  'Reincidente 60',
  'Reincidente 90',
  'Não Reincidente',
]
const ORDEM_RECOR: ClasseRecorrencia[] = [
  'Recorrente 30',
  'Recorrente 60',
  'Recorrente 90',
  'Não recorrente',
]

export async function obterRecorrencia(f: Filtros): Promise<ResultadoRecorrencia> {
  const params: unknown[] = []
  const p = (v: unknown) => `$${params.push(v)}`

  /**
   * CAST EXPLÍCITO NOS ARRAYS — não é cosmético.
   *
   * Com `any($1)` sem cast, o Postgres infere o tipo do parâmetro no momento do
   * planejamento e escolhe um plano pior: medido 10,5 s no mês e 49 s em 3 meses.
   * Com `any($1::bigint[])`, a MESMA query cai para ~1,4 s em 3 meses. A
   * diferença é o plano, não o trabalho.
   */
  const de = p(f.de)
  const ate = p(f.ate)
  const equipes = `${p([...EQUIPES_MANUTENCAO])}::bigint[]`
  const catalogos = `${p([...CATALOGOS_MANUTENCAO])}::text[]`
  const tiposPrev = `${p([...TIPOS_PREVENTIVOS])}::text[]`
  const catsPrev = `${p([...CATEGORIAS_PREVENTIVAS])}::text[]`
  const clientesTeste = `${p([...CLIENTES_TESTE])}::text[]`
  const tiposFora = `${p([...TIPOS_FORA_DA_MANUTENCAO])}::text[]`
  const equipesFora = `${p([...EQUIPES_FORA_DA_MANUTENCAO])}::bigint[]`
  const tiposForaRecorrencia = `${p([...TIPOS_FORA_DA_RECORRENCIA])}::text[]`

  // Cada `cond` aqui estreita DENTRO do universo já fixado no WHERE de `universo`
  // (equipes/catálogos/tipos de manutenção) — nunca o alarga. `equipe`, `tipo`,
  // `status` e `categoria2` faltavam: a barra global mostrava o filtro
  // aplicado, mas os joins (`t`, `it`, `st`, `cat2`) já existem nesta consulta e
  // simplesmente não eram usados no WHERE — por isso mudar "Tipo" nunca mexia
  // no número (achado pela Manutenção em 08/09/2026).
  const cond: string[] = []
  if (f.base) cond.push(`ag.regiao = any(${p(f.base)}::text[])`)
  if (f.cidade) cond.push(`pe.city = any(${p(f.cidade)}::text[])`)
  if (f.bairro) cond.push(`pe.neighborhood = any(${p(f.bairro)}::text[])`)
  if (f.equipe) cond.push(`t.title = any(${p(f.equipe)}::text[])`)
  if (f.catalogo) cond.push(`cs.title = any(${p(f.catalogo)}::text[])`)
  if (f.tipo) cond.push(`it.title = any(${p(f.tipo)}::text[])`)
  if (f.status) cond.push(`st.title = any(${p(f.status)}::text[])`)
  if (f.categoria2) cond.push(`cat2.title = any(${p(f.categoria2)}::text[])`)
  const filtroUsuario = cond.length ? `AND ${cond.join(' AND ')}` : ''

  /**
   * A base é propriedade da AGENDA, e o universo da recorrência é de protocolo —
   * então só entra quando o filtro está em uso. Igual à lógica do FROM composável
   * de base.ts: um LATERAL na view de field service custa caro para carregar sem
   * necessidade.
   */
  const joinBase = f.base
    ? /* sql */ `
        LEFT JOIN LATERAL (
          SELECT max(v.region_title) AS regiao
            FROM erp.v_service_desk_slots_productivity_informative v
           WHERE v.assignment_id = a.id
        ) ag ON true`
    : ''

  const sql = /* sql */ `
    WITH universo AS (
      -- Universo AMPLIADO (§5): inclui preventivas e tipos de incidente, porque
      -- a preventiva precisa existir aqui para poder ser EXCLUÍDA da contagem —
      -- não dá para excluir o que não foi carregado.
      --
      -- Carrega 90 dias ANTES do início do mês pedido: as janelas olham para
      -- trás, então sem essa margem os protocolos do começo do período
      -- pareceriam não ter histórico e seriam classificados como não
      -- reincidentes por falta de dado, não por ausência de chamado.
      SELECT a.id,
             ai.client_id,
             a.created,
             ai.contract_service_tag_id,
             -- CHAVE DA RECORRÊNCIA: o login PPPoE identifica a instalação.
             -- Sem login (serviço não-PPPoE), cai no service tag para não
             -- descartar o protocolo.
             coalesce(ac.user, 'tag:' || ai.contract_service_tag_id::text)
               AS instalacao,
             pe.city AS cidade,
             pe.neighborhood AS bairro,
             cs.title AS catalogo,
             (cat2.title = any(${catsPrev}) OR it.title = any(${tiposPrev})) AS eh_preventiva
        FROM erp.assignment_incidents ai
        JOIN erp.assignments a            ON a.id = ai.assignment_id
        LEFT JOIN erp.incident_status st  ON st.id = ai.incident_status_id
        LEFT JOIN erp.incident_types it   ON it.id = ai.incident_type_id
        LEFT JOIN erp.teams t             ON t.id = ai.team_id
        LEFT JOIN erp.catalog_services cs ON cs.id = ai.catalog_service_id
        LEFT JOIN erp.people pe           ON pe.id = a.requestor_id
        LEFT JOIN erp.solicitation_category_matrices scm ON scm.id = ai.solicitation_category_matrix_id
        LEFT JOIN erp.solicitation_service_categories cat2 ON cat2.id = scm.service_category_id_2
        LEFT JOIN erp.solicitation_service_categories cat5 ON cat5.id = scm.service_category_id_5
        -- LATERAL COM LIMIT 1, e nao join direto: authentication_contracts e
        -- 1:N por service_tag_id (ha tags com milhares de contratos — a
        -- UNIDASUL sozinha tem 41 logins no tag 23520, um por filial SD-WAN).
        -- O join direto espalhava CADA protocolo dela por ate 41 "instalacoes"
        -- diferentes, inflando reincidencia/recorrencia por fan-out em vez de
        -- problema real. Mesma correcao ja aplicada em ofensores.ts,
        -- preventivos.ts e protocolos.ts (docs/04 item 33) — so recorrencia.ts
        -- ainda nao tinha recebido (docs/06, achado em 09/09/2026).
        LEFT JOIN LATERAL (
          SELECT x."user"
            FROM erp.authentication_contracts x
           WHERE x.service_tag_id = ai.contract_service_tag_id
           ORDER BY x.active DESC NULLS LAST, x.id DESC
           LIMIT 1
        ) ac ON true
        ${joinBase}
       WHERE a.created >= (date_trunc('month', ${de}::date) - interval '90 days')
         AND a.created < (${ate}::date + interval '1 day')
         AND ( t.id = any(${equipes})
            OR cs.title = any(${catalogos})
            OR it.title = any(${tiposPrev})
            OR it.title IN ('TEC-MANUT-ACESSO-CLI-INCIDENTE/PROBLEMA',
                            'TEC-MANUT-ACESSO-CLI-INCIDENTE/RECORRENTE') )
         AND coalesce(st.title, '') <> 'Cancelado'
         AND ai.client_id IS NOT NULL
         AND coalesce(pe.name, '') <> all(${clientesTeste})
         -- OS MESMOS CORTES DE UNIVERSO DO RESTO DO SISTEMA, que faltavam
         -- aqui (docs/06, achado e confirmado pela Manutenção em 09/09/2026:
         -- "os recorrentes seguem a mesma regra de somente contabilizarmos
         -- reparos que vão a campo"). Sem isso, Suporte - Atendimento sozinho
         -- respondia por 53–63% do universo mensal deste indicador — a
         -- cláusula it.title IN (...INCIDENTE/...) acima ignora equipe e
         -- catálogo, e deixava entrar protocolo que nunca vai a campo.
         AND coalesce(it.title, '') <> all(${tiposFora})
         AND coalesce(ai.team_id, -1) <> all(${equipesFora})
         -- Requisição e regularização administrativa ficam no universo de
         -- Protocolos/KPIs (são demanda), mas não caracterizam "o cliente
         -- voltou a ter defeito" — não entram na recorrência. Achado
         -- cruzando protocolo a protocolo contra o BI em 09/09/2026: 351 dos
         -- 512 protocolos que só apareciam do nosso lado eram destes dois
         -- tipos. Ver docs/06 e docs/04 item 49.
         AND coalesce(it.title, '') <> all(${tiposForaRecorrencia})
         -- "Solucao Interna" (categoria5) sai do universo inteiro, não só da
         -- classificação de Recorrente (era assim antes, ver classificado
         -- mais abaixo). Achado em 09/09/2026: 30 protocolos do catálogo
         -- "Suporte Tecnico" (equipe Telefonia/GERAL) vazavam pela cláusula
         -- de tipo acima, todos com "Solucao Interna" e ZERO com agenda ou
         -- relato de campo. Ver docs/06 e docs/04 item 49.
         AND coalesce(cat5.title, '') <> 'Solucao Interna'
         ${filtroUsuario}
    ),
    -- Um passo unico: a janela por mes E as tres contagens de historico saem
    -- de window functions sobre o mesmo conjunto. NAO existe join aqui.
    --
    -- POR QUE NAO JOIN: a versao anterior fazia "base JOIN universo" para
    -- contar chamados anteriores. O planejador estimava a base em 1 LINHA (nao
    -- consegue estimar cardinalidade atraves de CTE + row_number), escolhia
    -- Nested Loop e RE-EXECUTAVA o agregado uma vez por linha -- 6.139 loops de
    -- ~1,5 ms = 9,2 s dos 11,7 s, confirmado por EXPLAIN ANALYZE. Reagrupar o
    -- agregado por mais colunas para matar o join piorou (30 s). Window function
    -- com frame RANGE resolve sem join e sem depender de estimativa.
    --
    -- c30/c60/c90 sao ACUMULADOS (tudo nos ultimos N dias, excluindo a propria
    -- linha). As janelas exclusivas saem por subtracao, abaixo.
    -- O fim do frame em '1 microsecond' PRECEDING e o que exclui a linha atual
    -- e seus empates de horario: equivale ao v.created < b.created original.
    candidatos AS (
      SELECT u.*,
             row_number() OVER (
               PARTITION BY u.instalacao, date_trunc('month', u.created)
               ORDER BY u.created DESC, u.id DESC
             ) AS rn_mes,
             count(*) OVER (
               PARTITION BY u.instalacao ORDER BY u.created
               RANGE BETWEEN interval '30 days' PRECEDING
                         AND interval '1 microsecond' PRECEDING
             )::int AS c30,
             count(*) OVER (
               PARTITION BY u.instalacao ORDER BY u.created
               RANGE BETWEEN interval '60 days' PRECEDING
                         AND interval '1 microsecond' PRECEDING
             )::int AS c60,
             count(*) OVER (
               PARTITION BY u.instalacao ORDER BY u.created
               RANGE BETWEEN interval '90 days' PRECEDING
                         AND interval '1 microsecond' PRECEDING
             )::int AS c90
        FROM universo u
       WHERE NOT u.eh_preventiva
    ),
    base AS (
      SELECT *,
             c30                AS q30,
             (c60 - c30)::int   AS q60,
             (c90 - c60)::int   AS q90
        FROM candidatos
       WHERE rn_mes = 1
         AND created >= ${de}::date
         AND created < (${ate}::date + interval '1 day')
    ),
    classificado AS (
      SELECT b.cidade,
             b.bairro,
             b.catalogo,
             to_char(date_trunc('month', b.created), 'YYYY-MM') AS mes,
             b.instalacao,
             -- REINCIDENCIA: alternativa, da janela mais distante para a mais
             -- proxima (mesma precedencia do SWITCH do DAX)
             CASE
               WHEN b.q90 > 0 THEN 'Reincidente 90'
               WHEN b.q60 > 0 THEN 'Reincidente 60'
               WHEN b.q30 > 0 THEN 'Reincidente 30'
               ELSE 'Não Reincidente'
             END AS classe_reincidencia,
             -- RECORRENCIA: cumulativa. "Solucao Interna" já saiu no universo
             -- (não chega aqui) — ver nota no CTE universo.
             CASE
               WHEN b.q90 > 0 AND b.q60 > 0 AND b.q30 > 0 THEN 'Recorrente 90'
               WHEN b.q60 > 0 AND b.q30 > 0 THEN 'Recorrente 60'
               WHEN b.q30 > 0 THEN 'Recorrente 30'
               ELSE 'Não recorrente'
             END AS classe_recorrencia
        FROM base b
    )
    SELECT classe_reincidencia, classe_recorrencia, cidade, bairro, catalogo, mes,
           count(DISTINCT instalacao)::int AS clientes
      FROM classificado
     GROUP BY 1, 2, 3, 4, 5, 6`

  const { rows, ms } = await consultarErp<LinhaRecorrencia>(sql, params)

  /**
   * Diagnóstico da ponte do PPPoE: quantos protocolos do recorte não tinham
   * login e caíram no fallback por service tag. Enquanto for baixo, a chave por
   * instalação está íntegra; se subir, a ponte quebrou e a recorrência passa a
   * agrupar instalações erradas.
   *
   * ⚠️ Precisa do filtro de universo. A primeira versão desta consulta media
   * outra coisa sobre `erp.assignments` inteiro do período e custava 48 s dos
   * 50 s do indicador — a métrica de diagnóstico custava 35x o cálculo que ela
   * diagnosticava.
   */
  const diag = await consultarErp<{ total: number; sem_login: number }>(
    /* sql */ `
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE ac.user IS NULL)::int AS sem_login
      FROM erp.assignment_incidents ai
      JOIN erp.assignments a            ON a.id = ai.assignment_id
      LEFT JOIN erp.incident_status st  ON st.id = ai.incident_status_id
      LEFT JOIN erp.teams t             ON t.id = ai.team_id
      LEFT JOIN erp.catalog_services cs ON cs.id = ai.catalog_service_id
      LEFT JOIN LATERAL (
        SELECT x."user"
          FROM erp.authentication_contracts x
         WHERE x.service_tag_id = ai.contract_service_tag_id
         ORDER BY x.active DESC NULLS LAST, x.id DESC
         LIMIT 1
      ) ac ON true
     WHERE a.created >= $1::date
       AND a.created < ($2::date + interval '1 day')
       AND (t.id = any($3::bigint[]) OR cs.title = any($4::text[]))
       AND coalesce(st.title, '') <> 'Cancelado'`,
    [f.de, f.ate, [...EQUIPES_MANUTENCAO], [...CATALOGOS_MANUTENCAO]]
  )

  // ── rollups ──────────────────────────────────────────────────────────────
  const reincMap = new Map<ClasseReincidencia, number>()
  const recorMap = new Map<ClasseRecorrencia, number>()
  const cidadeMap = new Map<string, { c: number; rei: number; rec: number }>()
  const bairroMap = new Map<string, { c: number; rei: number; rec: number }>()
  const catMap = new Map<string, { c: number; rei: number; rec: number }>()
  const mesMap = new Map<string, { c: number; rei: number; rec: number }>()

  /**
   * UNIDADE: cliente-mês, não cliente.
   * Cada cliente entra uma vez por mês (o último protocolo não preventivo do
   * mês). Num período de 3 meses, um cliente que abriu chamado nos três conta 3.
   * É essa a unidade do Power BI também, porque lá o mês está no contexto do
   * pivot. Num recorte de mês único — o padrão da tela — cliente-mês = cliente.
   * A tela diz "clientes-mês" para não prometer o que o número não é.
   */
  let clientesBase = 0

  /**
   * ⚠️ O PAINEL DE CLASSIFICAÇÃO NÃO SE AUTO-FILTRA.
   *
   * `classeRec` recorta tudo — totais, cidade, bairro, catálogo, mês —, mas o
   * próprio gráfico de classes continua mostrando as quatro barras. É a regra
   * de cross-filter que o Power BI também segue, e aqui ela é obrigatória: o
   * gráfico é o único controle deste filtro. Se ele se auto-filtrasse, sobraria
   * UMA barra na tela e não haveria como trocar de classe nem remover o
   * recorte sem editar a URL na mão.
   *
   * Por isso o filtro é aplicado em JS e não no SQL: a classe é atributo das
   * linhas que a consulta JÁ devolveu, então dá para contar os dois conjuntos
   * numa passagem só. Cidade, bairro e catálogo vão no WHERE porque lá o
   * recorte muda QUAIS linhas existem.
   */
  const classeAlvo = f.classeRec ? CLASSE_REC_POR_CODIGO[f.classeRec] : null
  /** total do recorte SEM o filtro de classe — denominador do painel de classes */
  let baseSemClasse = 0

  for (const r of rows) {
    const n = r.clientes
    baseSemClasse += n
    recorMap.set(r.classe_recorrencia, (recorMap.get(r.classe_recorrencia) ?? 0) + n)
    if (classeAlvo && r.classe_recorrencia !== classeAlvo) continue
    clientesBase += n
    reincMap.set(r.classe_reincidencia, (reincMap.get(r.classe_reincidencia) ?? 0) + n)

    const ehRei = r.classe_reincidencia !== 'Não Reincidente'
    const ehRec = r.classe_recorrencia !== 'Não recorrente'

    const soma = (
      m: Map<string, { c: number; rei: number; rec: number }>,
      chave: string
    ) => {
      const v = m.get(chave) ?? { c: 0, rei: 0, rec: 0 }
      v.c += n
      if (ehRei) v.rei += n
      if (ehRec) v.rec += n
      m.set(chave, v)
    }

    soma(cidadeMap, r.cidade ?? '(sem cidade)')
    soma(bairroMap, r.bairro ?? '(sem bairro)')
    soma(catMap, r.catalogo ?? '(sem catálogo)')
    soma(mesMap, r.mes)
  }

  const taxa = (num: number, den: number) => (den > 0 ? num / den : null)
  const pct = (classe: string, mapa: Map<string, number>) =>
    taxa(mapa.get(classe) ?? 0, clientesBase)

  const reincidentes = clientesBase - (reincMap.get('Não Reincidente') ?? 0)
  const recorrentes = clientesBase - (recorMap.get('Não recorrente') ?? 0)

  const paraDim = (
    m: Map<string, { c: number; rei: number; rec: number }>
  ): ItemDimensaoRecorrencia[] =>
    [...m.entries()]
      .map(([rotulo, v]) => ({
        rotulo,
        clientes: v.c,
        reincidentes: v.rei,
        recorrentes: v.rec,
        taxaReincidencia: taxa(v.rei, v.c),
        taxaRecorrencia: taxa(v.rec, v.c),
      }))
      .sort((a, b) => b.clientes - a.clientes)

  return {
    data: {
      total: {
        clientesBase,
        reincidentes,
        recorrentes,
        taxaReincidencia: taxa(reincidentes, clientesBase),
        taxaRecorrencia: taxa(recorrentes, clientesBase),
        pctReincidente30: pct('Reincidente 30', reincMap as Map<string, number>),
        pctReincidente60: pct('Reincidente 60', reincMap as Map<string, number>),
        pctReincidente90: pct('Reincidente 90', reincMap as Map<string, number>),
        pctRecorrente30: pct('Recorrente 30', recorMap as Map<string, number>),
        pctRecorrente60: pct('Recorrente 60', recorMap as Map<string, number>),
        pctRecorrente90: pct('Recorrente 90', recorMap as Map<string, number>),
      },
      porClasseReincidencia: ORDEM_REINC.map((classe) => ({
        classe,
        clientes: reincMap.get(classe) ?? 0,
        share: taxa(reincMap.get(classe) ?? 0, clientesBase) ?? 0,
      })),
      // share sobre `baseSemClasse`: as quatro barras continuam somando 100%
      // mesmo com uma classe selecionada — ver a nota do cross-filter acima.
      porClasseRecorrencia: ORDEM_RECOR.map((classe) => ({
        classe,
        clientes: recorMap.get(classe) ?? 0,
        share: taxa(recorMap.get(classe) ?? 0, baseSemClasse) ?? 0,
      })),
      porCidade: paraDim(cidadeMap),
      porBairro: paraDim(bairroMap),
      porCatalogo: paraDim(catMap),
      porMes: [...mesMap.entries()]
        .map(([mes, v]) => ({
          mes,
          clientes: v.c,
          reincidentes: v.rei,
          recorrentes: v.rec,
          taxaReincidencia: taxa(v.rei, v.c),
          taxaRecorrencia: taxa(v.rec, v.c),
        }))
        .sort((a, b) => a.mes.localeCompare(b.mes)),
    },
    meta: {
      protocolosSemLogin: diag.rows[0]?.sem_login ?? 0,
      protocolosNoUniverso: diag.rows[0]?.total ?? 0,
      clientesBase,
      linhas: rows.length,
      msClassificacao: ms,
      msDiagnostico: diag.ms,
    },
    ms: ms + diag.ms,
  }
}
