import { consultarErp } from '@/server/db/erp'
import {
  CATALOGOS_MANUTENCAO,
  CATEGORIAS_PREVENTIVAS,
  CLIENTES_TESTE,
  EQUIPES_FORA_DA_MANUTENCAO,
  EQUIPES_MANUTENCAO,
  TIPOS_FORA_DA_MANUTENCAO,
  TIPOS_PREVENTIVOS,
} from '@/config/regras-negocio'
import type { Filtros } from '@/lib/filtros'

/**
 * Ofensores (docs/01 §6).
 *
 * A pergunta: **"a instalação voltou a dar problema — quem atendeu antes, e o que
 * foi feito?"**. Não é ranking de culpa; é onde o retorno se concentra.
 *
 * MECÂNICA: `LAG()` sobre os protocolos da mesma instalação ordenados por data
 * traz, em cada reparo, os dados do reparo ANTERIOR (técnico, solução, categoria,
 * catálogo, protocolo, data). O "ofensor" é o atendimento anterior de um reparo
 * que retornou dentro de 90 dias.
 *
 * ⚠️ A CHAVE É A INSTALAÇÃO (login PPPoE), não o cliente — mesma decisão de
 * `recorrencia.ts` e `preventivos.ts`. Com `client_id` (o que o Power BI usa), um
 * cliente corporativo com 55 pontos faria o reparo do ponto A "acusar" o técnico
 * que atendeu o ponto B, em outra cidade. Seria ranking de ruído.
 *
 * ⚠️ PREVENTIVA NÃO É OFENSORA. Ela é ação nossa, planejada; se o cliente abre
 * reparo depois, isso é qualidade da preventiva (página Preventivos), não ofensa
 * de quem executou. Preventivas ficam fora das duas pontas — nem como reparo
 * atual, nem como anterior.
 *
 * ⚠️ O QUE ESTE NÚMERO **NÃO** É. Técnico com mais atendimentos aparece mais no
 * topo por volume, não por qualidade. Por isso o resultado traz `atendimentos` e
 * `taxaRetorno` junto de `retornos` — sem o denominador, o ranking premia quem
 * trabalha pouco.
 *
 * DUAS MEDIDAS CONVIVEM AQUI, e confundi-las é o erro mais fácil de cometer:
 *
 *   A) RETORNO POR DISTÂNCIA (`porTecnicoAnterior`) — quantos dias entre o reparo
 *      atual e o anterior. Cada retorno cai em UM balde: ≤30, 31–60 ou 61–90.
 *      Responde "com que rapidez o problema voltou".
 *
 *   B) RECORRÊNCIA CUMULATIVA (`porTecnicoRecorrencia`) — a classificação de
 *      recorrência do cliente (§5.3) atribuída ao técnico anterior. "Recorrente
 *      60" exige chamado nos últimos 30 dias E entre 31–60; "Recorrente 90"
 *      exige nas três janelas. Responde "o ponto é cronicamente problemático".
 *      É a medida do relatório atual, e por construção concentra quase tudo em
 *      "Recorrente 30" — poucos pontos têm chamado em janelas consecutivas.
 *
 * As duas somam totais diferentes de propósito. B existe para conferência com o
 * Power BI; A é a leitura mais direta de "voltou rápido".
 */

type LinhaRecorrenciaOfensor = {
  tecnico_anterior: string | null
  classe: 'Recorrente 30' | 'Recorrente 60' | 'Recorrente 90'
  clientes: number
}

type LinhaOfensor = {
  janela: '30' | '60' | '90'
  /** cliente do reparo QUE VOLTOU — a instalação é a mesma dos dois lados */
  cliente: string | null
  tecnico_anterior: string | null
  solucao_anterior: string | null
  categoria_anterior: string | null
  catalogo_anterior: string | null
  retornos: number
}

type LinhaVolume = {
  tecnico: string | null
  /** reparos do técnico DENTRO do período — o denominador do cartão */
  noPeriodo: number
  /** reparos na janela de lookup — o denominador de CADA técnico */
  naJanela: number
}

export type ItemOfensor = {
  rotulo: string
  retornos: number
  ret30: number
  ret60: number
  ret90: number
  /** total de atendimentos da pessoa no período — o denominador que falta no PBI */
  atendimentos: number | null
  taxaRetorno: number | null
}

export type ItemOfensorRecorrencia = {
  rotulo: string
  rec30: number
  rec60: number
  rec90: number
  total: number
}

export type ResultadoOfensores = {
  data: {
    total: {
      reparos: number
      retornos: number
      taxaRetorno: number | null
      ret30: number
      ret60: number
      ret90: number
    }
    porTecnicoAnterior: ItemOfensor[]
    /** onde o retorno se concentra por CLIENTE — pedido da Manutenção, 01/09/2026 */
    porCliente: ItemOfensor[]
    /** paridade com o pivot "TÉCNICOS OFENSORES EM RECORRÊNCIA" do Power BI */
    porTecnicoRecorrencia: ItemOfensorRecorrencia[]
    totalRecorrencia: { rec30: number; rec60: number; rec90: number; total: number }
    porSolucaoAnterior: ItemOfensor[]
    porCategoriaAnterior: ItemOfensor[]
    porCatalogoAnterior: ItemOfensor[]
  }
  meta: { linhas: number; janelaDias: number }
  ms: number
}

/**
 * As condicoes dos filtros da barra, para as TRES consultas desta pagina.
 *
 * ⚠️ ONDE ELAS ENTRAM IMPORTA MAIS QUE QUAIS SAO. Nunca no CTE `universo`: ele e
 * a fonte do atendimento ANTERIOR, e estreita-lo apaga elos da cadeia. Um reparo
 * removido dali faz o reparo seguinte parecer primeira visita da instalacao --
 * a pagina passaria a PERDER retornos, e o indicador melhoraria por enxergar
 * menos. Mesmo raciocinio documentado em preventivos.ts.
 *
 * Elas entram na escolha de QUAL RETORNO CONTA, sobre o reparo do periodo.
 *
 * ⚠️ O FILTRO VALE PARA O REPARO QUE VOLTOU, nao para o atendimento anterior.
 * `Tecnico = X` responde "dos reparos que o X atendeu, quantos eram retorno" --
 * e nao "quantos retornos o X causou", que a tabela "Tecnico do atendimento
 * anterior" ja responde. E a mesma regra dos outros seis filtros e a mesma da
 * aba Protocolos, e uniformidade aqui vale mais que a leitura especial: filtro
 * que se comporta ao contrario dos vizinhos obriga a pessoa a lembrar de uma
 * excecao, e quem nao lembra le o numero errado sem perceber.
 */
function condicoesUsuario(f: Filtros, p: (v: unknown) => string): string[] {
  const c: string[] = []
  // `ag.regiao` exige o LATERAL da view de field service (ver `joinBase`)
  if (f.base) c.push(`ag.regiao = any(${p(f.base)}::text[])`)
  if (f.cidade) c.push(`pe.city = any(${p(f.cidade)}::text[])`)
  if (f.tipo) c.push(`coalesce(it.title, '') = any(${p(f.tipo)}::text[])`)
  if (f.equipe) c.push(`t.title = any(${p(f.equipe)}::text[])`)
  if (f.catalogo) c.push(`cs.title = any(${p(f.catalogo)}::text[])`)
  if (f.status) c.push(`st.title = any(${p(f.status)}::text[])`)
  if (f.categoria2) c.push(`cat2.title = any(${p(f.categoria2)}::text[])`)
  if (f.tecnico) c.push(`resp.name = any(${p(f.tecnico)}::text[])`)
  return c
}

/** O LATERAL da base, so quando alguem filtra por ela: custa ~2 s. */
const JOIN_BASE = /* sql */ `
        LEFT JOIN LATERAL (
          SELECT max(v.region_title) AS regiao
            FROM erp.v_service_desk_slots_productivity_informative v
           WHERE v.assignment_id = a.id
        ) ag ON true`

export async function obterOfensores(f: Filtros): Promise<ResultadoOfensores> {
  const params: unknown[] = []
  const p = (v: unknown) => `$${params.push(v)}`

  const de = p(f.de)
  const ate = p(f.ate)
  const equipes = `${p([...EQUIPES_MANUTENCAO])}::bigint[]`
  const catalogos = `${p([...CATALOGOS_MANUTENCAO])}::text[]`
  const tiposPrev = `${p([...TIPOS_PREVENTIVOS])}::text[]`
  const catsPrev = `${p([...CATEGORIAS_PREVENTIVAS])}::text[]`
  const clientesTeste = `${p([...CLIENTES_TESTE])}::text[]`
  const tiposFora = `${p([...TIPOS_FORA_DA_MANUTENCAO])}::text[]`
  const equipesFora = `${p([...EQUIPES_FORA_DA_MANUTENCAO])}::bigint[]`

  const condUsuario = condicoesUsuario(f, p)
  // booleano calculado NO universo e carregado ate a escolha do retorno; o CTE
  // em si continua completo, para o LAG achar o anterior de todo mundo.
  const passaFiltro = condUsuario.length ? `(${condUsuario.join(' AND ')})` : 'true'
  const joinBase = f.base ? JOIN_BASE : ''

  const sql = /* sql */ `
    WITH universo AS (
      -- Carrega 90 dias ANTES do periodo: o reparo do inicio do recorte precisa
      -- ter o anterior dele disponivel, senao ele apareceria como primeira visita
      -- da instalacao e nao acusaria ofensor nenhum.
      SELECT a.id,
             a.created,
             coalesce(ac.user, 'tag:' || ai.contract_service_tag_id::text) AS instalacao,
             resp.name  AS tecnico,
             pe.name    AS cliente,
             ss.title   AS solucao,
             cat2.title AS categoria,
             cs.title   AS catalogo,
             -- COALESCE OBRIGATORIO. Sem ele, tipo nao-preventivo + cat2 NULL
             -- da  false OR NULL = NULL, e o  WHERE NOT eh_preventiva  logo
             -- abaixo descarta NULL EM SILENCIO -- eram 35 reparos legitimos
             -- sumindo da analise no recorte de agosto/2026.
             (coalesce(it.title, '')   = any(${tiposPrev})
           OR coalesce(cat2.title, '') = any(${catsPrev})) AS eh_preventiva,
             -- os filtros da barra viram um BOOLEANO aqui e so recortam la na
             -- frente, na escolha do retorno. Filtrar o CTE apagaria elos da
             -- cadeia do LAG (ver a nota de condicoesUsuario).
             ${passaFiltro} AS passa_filtro
        FROM erp.assignment_incidents ai
        JOIN erp.assignments a            ON a.id = ai.assignment_id
        LEFT JOIN erp.incident_status st  ON st.id = ai.incident_status_id
        LEFT JOIN erp.incident_types it   ON it.id = ai.incident_type_id
        LEFT JOIN erp.teams t             ON t.id = ai.team_id
        LEFT JOIN erp.catalog_services cs ON cs.id = ai.catalog_service_id
        LEFT JOIN erp.people pe           ON pe.id = a.requestor_id
        LEFT JOIN erp.people resp         ON resp.id = a.responsible_id
        LEFT JOIN erp.solicitation_solutions ss ON ss.id = ai.solicitation_solution_id
        LEFT JOIN erp.solicitation_category_matrices scm ON scm.id = ai.solicitation_category_matrix_id
        LEFT JOIN erp.solicitation_service_categories cat2 ON cat2.id = scm.service_category_id_2
        -- LATERAL COM LIMIT 1, e nao join direto: authentication_contracts e
        -- 1:N por service_tag_id (ha tags com 2.050 contratos). O join direto
        -- que estava aqui duplicava protocolo -- 39 linhas a mais em 14.454 no
        -- recorte de agosto/2026 -- e, pior, POLUIA A CHAVE DE PARTICAO: o
        -- mesmo protocolo se espalhava por duas instalacoes, e em cada uma o
        -- LAG() apontava um "atendimento anterior" diferente. Mesma correcao ja
        -- aplicada em preventivos.ts e protocolos.ts.
        LEFT JOIN LATERAL (
          SELECT x."user"
            FROM erp.authentication_contracts x
           WHERE x.service_tag_id = ai.contract_service_tag_id
           ORDER BY x.active DESC NULLS LAST, x.id DESC
           LIMIT 1
        ) ac ON true
        ${joinBase}
       WHERE a.created >= (${de}::date - interval '90 days')
         AND a.created < (${ate}::date + interval '1 day')
         AND (t.id = any(${equipes}) OR cs.title = any(${catalogos}))
         AND coalesce(st.title, '') <> 'Cancelado'
         AND ai.contract_service_tag_id IS NOT NULL
         AND coalesce(pe.name, '') <> all(${clientesTeste})
         -- OS MESMOS CORTES DE UNIVERSO DO RESTO DO SISTEMA, que faltavam aqui.
         --
         -- O tipo GERAL - Registro de Atendimento Inicial e o registro que o
         -- Suporte abre no primeiro contato e que DEPOIS vira um reparo. Deixa-lo
         -- no conjunto fabricava retorno: o par (registro, reparo) da mesma
         -- instalacao aparecia como "voltou em poucos dias", quando e a MESMA
         -- ocorrencia contada duas vezes. Por isso ele sai do universo inteiro,
         -- inclusive da janela de lookup -- nao adianta tira-lo so do recorte.
         --
         -- COR/CGR saem pela mesma razao das telas de protocolo: quando o
         -- protocolo fica com a central, nao houve atendimento de campo, e nao
         -- ha tecnico anterior a apontar.
         AND coalesce(it.title, '') <> all(${tiposFora})
         AND coalesce(ai.team_id, -1) <> all(${equipesFora})
    ),
    reparos AS (
      -- Preventiva sai das DUAS pontas: nao e reparo atual nem anterior.
      SELECT * FROM universo WHERE NOT eh_preventiva
    ),
    com_anterior AS (
      SELECT r.id,
             r.created,
             r.instalacao,
             r.cliente,
             r.passa_filtro,
             lag(r.created)   OVER w AS ant_created,
             lag(r.tecnico)   OVER w AS ant_tecnico,
             lag(r.solucao)   OVER w AS ant_solucao,
             lag(r.categoria) OVER w AS ant_categoria,
             lag(r.catalogo)  OVER w AS ant_catalogo
        FROM reparos r
      WINDOW w AS (PARTITION BY r.instalacao ORDER BY r.created, r.id)
    ),
    retorno AS (
      SELECT c.*,
             CASE
               WHEN c.created <= c.ant_created + interval '30 days' THEN '30'
               WHEN c.created <= c.ant_created + interval '60 days' THEN '60'
               WHEN c.created <= c.ant_created + interval '90 days' THEN '90'
               ELSE NULL
             END AS janela
        FROM com_anterior c
       WHERE c.ant_created IS NOT NULL
         -- só os reparos DENTRO do recorte; o resto foi carregado para lookup
         AND c.created >= ${de}::date
         AND c.created < (${ate}::date + interval '1 day')
         -- e só os que passam nos filtros da barra
         AND c.passa_filtro
    )
    SELECT janela, cliente, ant_tecnico AS tecnico_anterior,
           ant_solucao AS solucao_anterior,
           ant_categoria AS categoria_anterior, ant_catalogo AS catalogo_anterior,
           count(*)::int AS retornos
      FROM retorno
     WHERE janela IS NOT NULL
     GROUP BY 1, 2, 3, 4, 5, 6`

  /**
   * O DENOMINADOR — e ele estava errado de duas formas, as duas medidas.
   *
   * 1) A JANELA ERA A DO LOOKUP, NÃO A DO PERÍODO. A consulta ia de
   *    `de - 90 dias` até `ate`, ou seja 121 dias quando o filtro pedia um mês.
   *    O numerador conta retornos DO PERÍODO; o denominador contava
   *    atendimentos de quatro meses. Medido em agosto/2026: 14.454 no
   *    denominador contra 3.850 atendimentos reais do mês — a taxa de retorno
   *    saía dividida por ~3,75.
   *
   *    Os 90 dias a mais existem para o LAG() achar o atendimento anterior;
   *    são janela de CONSULTA, nunca de contagem.
   *
   * 2) CONTAVA PREVENTIVA. O numerador exclui preventiva das duas pontas (ela
   *    não é ofensora — ver o cabeçalho deste arquivo), mas o denominador
   *    somava todas. Numerador e denominador falavam de conjuntos diferentes.
   *
   * 3) UM DENOMINADOR NÃO SERVE PARA AS DUAS PERGUNTAS — e eu tropecei nisto ao
   *    corrigir (1). São populações diferentes:
   *
   *    - O CARTÃO pergunta "dos reparos deste mês, quantos são retorno?". Os dois
   *      lados são do período: 383 de 2.854.
   *    - CADA TÉCNICO pergunta "dos atendimentos DELE, quantos voltaram?". Mas o
   *      retorno é atribuído a quem fez o atendimento ANTERIOR, e esse
   *      atendimento pode estar em qualquer ponto dos 90 dias que precedem o
   *      período. O denominador dele é a JANELA, não o mês.
   *
   *    Com o denominador do mês para os dois, quem atendeu muito antes de agosto
   *    e pouco em agosto virava absurdo: HECTOR LUIS BRITO aparecia com 16
   *    retornos em 1 atendimento — 1.600,0%. Reportado pela Manutenção em
   *    01/09/2026 olhando a tabela.
   *
   * Uma consulta só devolve os dois: `naJanela` para o técnico, `noPeriodo`
   * (filtrado) para o cartão. Os dois excluem preventiva, tipos e equipes fora
   * da manutenção — o mesmo conjunto do numerador.
   */
  // Params PROPRIOS: o pg recusa o bind com um parametro que a consulta nao usa,
  // e cada uma destas tres consultas usa um conjunto diferente de filtros.
  const paramsVol: unknown[] = []
  const v = (x: unknown) => `$${paramsVol.push(x)}`
  const vDe = v(f.de)
  const vAte = v(f.ate)
  const vEquipes = `${v([...EQUIPES_MANUTENCAO])}::bigint[]`
  const vCatalogos = `${v([...CATALOGOS_MANUTENCAO])}::text[]`
  const vTiposPrev = `${v([...TIPOS_PREVENTIVOS])}::text[]`
  const vCatsPrev = `${v([...CATEGORIAS_PREVENTIVAS])}::text[]`
  const vTiposFora = `${v([...TIPOS_FORA_DA_MANUTENCAO])}::text[]`
  const vEquipesFora = `${v([...EQUIPES_FORA_DA_MANUTENCAO])}::bigint[]`
  const condVol = condicoesUsuario(f, v)
  const filtroVol = condVol.length ? `AND ${condVol.join(' AND ')}` : ''

  const sqlVolume = /* sql */ `
    SELECT resp.name AS tecnico,
           count(*) FILTER (WHERE a.created >= ${vDe}::date)::int AS "noPeriodo",
           count(*)::int AS "naJanela"
      FROM erp.assignment_incidents ai
      JOIN erp.assignments a            ON a.id = ai.assignment_id
      LEFT JOIN erp.incident_status st  ON st.id = ai.incident_status_id
      LEFT JOIN erp.incident_types it   ON it.id = ai.incident_type_id
      LEFT JOIN erp.teams t             ON t.id = ai.team_id
      LEFT JOIN erp.catalog_services cs ON cs.id = ai.catalog_service_id
      -- pe entra para o filtro de CIDADE; antes so resp era necessario
      LEFT JOIN erp.people pe           ON pe.id = a.requestor_id
      LEFT JOIN erp.people resp         ON resp.id = a.responsible_id
      LEFT JOIN erp.solicitation_category_matrices scm ON scm.id = ai.solicitation_category_matrix_id
      LEFT JOIN erp.solicitation_service_categories cat2 ON cat2.id = scm.service_category_id_2
      ${f.base ? JOIN_BASE : ''}
     WHERE a.created >= (${vDe}::date - interval '90 days')
       AND a.created <  (${vAte}::date + interval '1 day')
       AND (t.id = any(${vEquipes}) OR cs.title = any(${vCatalogos}))
       AND coalesce(st.title, '') <> 'Cancelado'
       AND NOT (coalesce(it.title, '')   = any(${vTiposPrev})
             OR coalesce(cat2.title, '') = any(${vCatsPrev}))
       AND coalesce(it.title, '') <> all(${vTiposFora})
       AND coalesce(ai.team_id, -1) <> all(${vEquipesFora})
       -- ⚠️ O DENOMINADOR RECEBE OS MESMOS FILTROS DO NUMERADOR.
       --
       -- Sem isto, filtrar Cidade = Canoas recortava só os retornos e deixava o
       -- denominador inteiro: a taxa caía de 11,7% para 2,7% e a pessoa lia
       -- Canoas como quatro vezes melhor que a média. Aqui não há cadeia de LAG
       -- para preservar — é contagem direta —, então o filtro entra no WHERE.
       ${filtroVol}
     GROUP BY 1`

  /**
   * Medida B: classificação CUMULATIVA de recorrência (§5.3) atribuída ao técnico
   * do atendimento anterior — o pivot "TÉCNICOS OFENSORES EM RECORRÊNCIA" do
   * relatório atual.
   *
   * Reaproveita a mecânica de `recorrencia.ts`: contadores acumulados por janela
   * via window function com frame RANGE, sem join (o planejador não estima CTE
   * com row_number e escolheria Nested Loop — ver a nota naquele arquivo).
   */
  const paramsRec: unknown[] = []
  const w = (x: unknown) => `$${paramsRec.push(x)}`
  const wDe = w(f.de)
  const wAte = w(f.ate)
  const wEquipes = `${w([...EQUIPES_MANUTENCAO])}::bigint[]`
  const wCatalogos = `${w([...CATALOGOS_MANUTENCAO])}::text[]`
  const wTiposPrev = `${w([...TIPOS_PREVENTIVOS])}::text[]`
  const wCatsPrev = `${w([...CATEGORIAS_PREVENTIVAS])}::text[]`
  const wTiposFora = `${w([...TIPOS_FORA_DA_MANUTENCAO])}::text[]`
  const wEquipesFora = `${w([...EQUIPES_FORA_DA_MANUTENCAO])}::bigint[]`
  const condRec = condicoesUsuario(f, w)
  const passaRec = condRec.length ? `(${condRec.join(' AND ')})` : 'true'

  const sqlRecorrencia = /* sql */ `
    WITH universo AS (
      SELECT a.id,
             a.created,
             coalesce(ac.user, 'tag:' || ai.contract_service_tag_id::text) AS instalacao,
             resp.name AS tecnico,
             (coalesce(it.title, '')   = any(${wTiposPrev})
           OR coalesce(cat2.title, '') = any(${wCatsPrev})) AS eh_preventiva,
             -- mesmo raciocínio da consulta principal: booleano aqui, recorte lá
             -- na frente. As janelas c30/c60/c90 contam chamados ANTERIORES e
             -- precisam da cadeia inteira.
             ${passaRec} AS passa_filtro
        FROM erp.assignment_incidents ai
        JOIN erp.assignments a            ON a.id = ai.assignment_id
        LEFT JOIN erp.incident_status st  ON st.id = ai.incident_status_id
        LEFT JOIN erp.incident_types it   ON it.id = ai.incident_type_id
        LEFT JOIN erp.teams t             ON t.id = ai.team_id
        LEFT JOIN erp.catalog_services cs ON cs.id = ai.catalog_service_id
        LEFT JOIN erp.people pe           ON pe.id = a.requestor_id
        LEFT JOIN erp.people resp         ON resp.id = a.responsible_id
        LEFT JOIN erp.solicitation_category_matrices scm ON scm.id = ai.solicitation_category_matrix_id
        LEFT JOIN erp.solicitation_service_categories cat2 ON cat2.id = scm.service_category_id_2
        LEFT JOIN LATERAL (
          SELECT x."user"
            FROM erp.authentication_contracts x
           WHERE x.service_tag_id = ai.contract_service_tag_id
           ORDER BY x.active DESC NULLS LAST, x.id DESC
           LIMIT 1
        ) ac ON true
        ${f.base ? JOIN_BASE : ''}
       WHERE a.created >= (${wDe}::date - interval '90 days')
         AND a.created < (${wAte}::date + interval '1 day')
         AND (t.id = any(${wEquipes}) OR cs.title = any(${wCatalogos}))
         AND coalesce(st.title, '') <> 'Cancelado'
         AND ai.contract_service_tag_id IS NOT NULL
         AND coalesce(it.title, '') <> all(${wTiposFora})
         AND coalesce(ai.team_id, -1) <> all(${wEquipesFora})
    ),
    reparos AS (SELECT * FROM universo WHERE NOT eh_preventiva),
    janelas AS (
      SELECT r.id, r.created, r.instalacao, r.passa_filtro,
             lag(r.tecnico) OVER (PARTITION BY r.instalacao ORDER BY r.created, r.id)
               AS ant_tecnico,
             count(*) OVER (PARTITION BY r.instalacao ORDER BY r.created
               RANGE BETWEEN interval '30 days' PRECEDING
                         AND interval '1 microsecond' PRECEDING)::int AS c30,
             count(*) OVER (PARTITION BY r.instalacao ORDER BY r.created
               RANGE BETWEEN interval '60 days' PRECEDING
                         AND interval '1 microsecond' PRECEDING)::int AS c60,
             count(*) OVER (PARTITION BY r.instalacao ORDER BY r.created
               RANGE BETWEEN interval '90 days' PRECEDING
                         AND interval '1 microsecond' PRECEDING)::int AS c90
        FROM reparos r
    ),
    classificado AS (
      SELECT ant_tecnico,
             CASE
               WHEN c90 - c60 > 0 AND c60 - c30 > 0 AND c30 > 0 THEN 'Recorrente 90'
               WHEN c60 - c30 > 0 AND c30 > 0                   THEN 'Recorrente 60'
               WHEN c30 > 0                                     THEN 'Recorrente 30'
               ELSE NULL
             END AS classe
        FROM janelas
       WHERE created >= ${wDe}::date
         AND created < (${wAte}::date + interval '1 day')
         AND ant_tecnico IS NOT NULL
         AND passa_filtro
    )
    SELECT ant_tecnico AS tecnico_anterior, classe, count(*)::int AS clientes
      FROM classificado WHERE classe IS NOT NULL
     GROUP BY 1, 2`


  const [r, rv, rr] = await Promise.all([
    consultarErp<LinhaOfensor>(sql, params),
    consultarErp<LinhaVolume>(sqlVolume, paramsVol),
    consultarErp<LinhaRecorrenciaOfensor>(sqlRecorrencia, paramsRec),
  ])

  // denominador de CADA técnico: a janela inteira (ver a nota em sqlVolume)
  const volume = new Map<string, number>()
  for (const v of rv.rows) if (v.tecnico) volume.set(v.tecnico, v.naJanela)

  type Acum = { r30: number; r60: number; r90: number }
  const novo = (): Acum => ({ r30: 0, r60: 0, r90: 0 })
  const mapas = {
    tecnico: new Map<string, Acum>(),
    cliente: new Map<string, Acum>(),
    solucao: new Map<string, Acum>(),
    categoria: new Map<string, Acum>(),
    catalogo: new Map<string, Acum>(),
  }
  const totalAcum = novo()

  for (const l of r.rows) {
    const n = l.retornos
    const somar = (a: Acum) => {
      if (l.janela === '30') a.r30 += n
      else if (l.janela === '60') a.r60 += n
      else a.r90 += n
    }
    somar(totalAcum)
    const em = (m: Map<string, Acum>, k: string | null) => {
      const chave = k ?? '(sem informação)'
      const a = m.get(chave) ?? novo()
      somar(a)
      m.set(chave, a)
    }
    em(mapas.tecnico, l.tecnico_anterior)
    em(mapas.cliente, l.cliente)
    em(mapas.solucao, l.solucao_anterior)
    em(mapas.categoria, l.categoria_anterior)
    em(mapas.catalogo, l.catalogo_anterior)
  }

  const paraItens = (m: Map<string, Acum>, comVolume: boolean): ItemOfensor[] =>
    [...m.entries()]
      .map(([rotulo, a]) => {
        const retornos = a.r30 + a.r60 + a.r90
        const atendimentos = comVolume ? (volume.get(rotulo) ?? null) : null
        return {
          rotulo,
          retornos,
          ret30: a.r30,
          ret60: a.r60,
          ret90: a.r90,
          atendimentos,
          taxaRetorno:
            atendimentos && atendimentos > 0 ? retornos / atendimentos : null,
        }
      })
      .sort((x, y) => y.retornos - x.retornos)

  // medida B: recorrência cumulativa por técnico anterior
  const recMap = new Map<string, { r30: number; r60: number; r90: number }>()
  const recTotal = { rec30: 0, rec60: 0, rec90: 0 }
  for (const l of rr.rows) {
    if (!l.tecnico_anterior) continue
    const a = recMap.get(l.tecnico_anterior) ?? { r30: 0, r60: 0, r90: 0 }
    if (l.classe === 'Recorrente 30') { a.r30 += l.clientes; recTotal.rec30 += l.clientes }
    else if (l.classe === 'Recorrente 60') { a.r60 += l.clientes; recTotal.rec60 += l.clientes }
    else { a.r90 += l.clientes; recTotal.rec90 += l.clientes }
    recMap.set(l.tecnico_anterior, a)
  }
  const porTecnicoRecorrencia: ItemOfensorRecorrencia[] = [...recMap.entries()]
    .map(([rotulo, a]) => ({
      rotulo,
      rec30: a.r30,
      rec60: a.r60,
      rec90: a.r90,
      total: a.r30 + a.r60 + a.r90,
    }))
    .sort((x, y) => y.total - x.total)

  const retornos = totalAcum.r30 + totalAcum.r60 + totalAcum.r90
  // denominador do CARTÃO: só o período, e aí sim numerador e denominador
  // falam do mesmo mês
  const reparosPeriodo = rv.rows.reduce((s, x) => s + x.noPeriodo, 0)

  return {
    data: {
      total: {
        reparos: reparosPeriodo,
        retornos,
        taxaRetorno: reparosPeriodo > 0 ? retornos / reparosPeriodo : null,
        ret30: totalAcum.r30,
        ret60: totalAcum.r60,
        ret90: totalAcum.r90,
      },
      porTecnicoAnterior: paraItens(mapas.tecnico, true),
      // sem denominador: `volume` conta reparo por TÉCNICO responsável, e cruzá-lo
      // com nome de cliente devolveria taxa de coisa nenhuma.
      porCliente: paraItens(mapas.cliente, false),
      porTecnicoRecorrencia,
      totalRecorrencia: {
        ...recTotal,
        total: recTotal.rec30 + recTotal.rec60 + recTotal.rec90,
      },
      porSolucaoAnterior: paraItens(mapas.solucao, false),
      porCategoriaAnterior: paraItens(mapas.categoria, false),
      porCatalogoAnterior: paraItens(mapas.catalogo, false),
    },
    meta: { linhas: r.rows.length, janelaDias: 90 },
    ms: r.ms + rv.ms + rr.ms,
  }
}
