import { consultarErp } from '@/server/db/erp'
import {
  CATALOGOS_MANUTENCAO,
  CATEGORIAS_PREVENTIVAS,
  CLIENTES_TESTE,
  EQUIPES_FORA_DA_MANUTENCAO,
  TIPOS_FORA_DA_MANUTENCAO,
  TIPOS_PREVENTIVOS,
} from '@/config/regras-negocio'
import type { Filtros } from '@/lib/filtros'
import { truncGranularidade } from './base'

/**
 * Preventivos e REINCIDENCIA pos-preventiva (docs/01 5.4).
 *
 * A pergunta que esta pagina responde nao e "quantas preventivas fizemos" -- e
 * **"a preventiva resolveu?"**. Uma preventiva seguida de reparo no mesmo ponto
 * dentro de 90 dias nao preveniu nada; custou uma visita e o problema voltou.
 *
 * MEDIDA CENTRAL: para cada preventiva, olha PARA FRENTE ate 90 dias e procura o
 * primeiro protocolo NAO preventivo da mesma instalacao. Se achar, a preventiva
 * REINCIDIU e a distancia diz o quao rapido:
 *   <= 30 dias -> reincidencia rapida (a mais grave: o problema nem foi tocado)
 *   31-60 dias
 *   61-90 dias
 *   nada em 90 dias -> sem reincidencia
 *
 * A CHAVE E A INSTALACAO (login PPPoE), nao o cliente -- mesma decisao de
 * recorrencia.ts. Um cliente corporativo com 55 pontos teria a preventiva de um
 * ponto invalidada pelo reparo de outro, em outra cidade. AQUI DIVERGIMOS DO
 * POWER BI de proposito: a coluna C3 dele casa por NOME DO CLIENTE.
 *
 * ── TODA PREVENTIVA ENTRA NA CONTA, INDEPENDENTE DA IDADE ───────────────────
 *
 * O denominador e o total de preventivas do recorte. Nao existe filtro de
 * maturidade, e isso e decisao da Manutencao em 28/08/2026:
 *
 *   "nao podemos esperar 90 dias para ter uma visao dos preventivos recentes que
 *    reincidiram, entao o correto e: independente de quando foi aberto, se teve
 *    reparo posterior entra no indicador."
 *
 * E o que o Power BI sempre fez. A medida "% Reincidentes sobre Preventivos"
 * divide (preventivas com C3 preenchida) por (TODAS as preventivas do periodo) --
 * a coluna C3 classifica em "Reincidente Prev 30d/60d/90d" ou BLANK, sem
 * nenhuma nocao de observacao.
 *
 * ⚠️ O VIES QUE ISSO CRIA, E QUE A TELA PRECISA DIZER: uma preventiva de ontem
 * teve um dia para reincidir, nao noventa. Num recorte recente a taxa sai
 * SUBESTIMADA e vai subir sozinha nas semanas seguintes. Por isso o indicador
 * devolve `recentes` -- quantas ainda tem menos de 90 dias -- e a tela avisa.
 *
 * Isto substitui a versao anterior, que excluia as recentes do denominador. Ela
 * errava para o outro lado e muito mais feio: so ia para observacao a recente
 * QUE AINDA NAO TINHA FALHADO, entao o denominador do mes corrente continha so
 * as que ja tinham falhado e a taxa dava 100%. Ver docs/04 itens 31 e 32.
 */

type Classe = 'Reincidiu ≤30d' | 'Reincidiu 31–60d' | 'Reincidiu 61–90d' | 'Sem reincidência'

type LinhaPreventivo = {
  mes: string
  /** balde da granularidade escolhida, sempre 'YYYY-MM-DD' (início do balde) */
  periodo: string
  base: string | null
  cidade: string | null
  categoria: string | null
  tecnico: string | null
  classe: Classe
  /** criada ha menos de 90 dias: ainda pode reincidir */
  recente: boolean
  preventivas: number
}

export type ItemClassePreventiva = {
  classe: Classe
  preventivas: number
  share: number
}

export type ItemDimPreventiva = {
  rotulo: string
  preventivas: number
  reincidentes: number
  taxaReincidencia: number | null
}

export type ResultadoPreventivos = {
  data: {
    total: {
      preventivas: number
      reincidentes: number
      taxaReincidencia: number | null
      pct30: number | null
      pct60: number | null
      pct90: number | null
      /** ainda com menos de 90 dias de observacao -- a taxa pode subir */
      recentes: number
    }
    porClasse: ItemClassePreventiva[]
    porBase: ItemDimPreventiva[]
    porCidade: ItemDimPreventiva[]
    porCategoria: ItemDimPreventiva[]
    /** quem ATENDEU a preventiva -- o tecnico cuja acao nao segurou */
    porTecnico: ItemDimPreventiva[]
    /**
     * VOLUME no balde da granularidade escolhida (dia/semana/mês), com os
     * baldes vazios preenchidos com zero — ver `baldes()`.
     *
     * Separado do `porMes` de propósito: o volume responde a "quanto se fez", e
     * aí o dia tem sinal (o volume de preventiva despenca no fim de semana — em
     * setembro/2026, 80 numa terça contra 1 num domingo). A TAXA no mesmo dia
     * não teria sinal nenhum: são ~15 reincidentes em 14 dias, então o domingo
     * com 1 preventiva só pode marcar 0% ou 100%.
     */
    porPeriodo: {
      periodo: string
      preventivas: number
      reincidentes: number
      taxaReincidencia: number | null
    }[]
    /** SEMPRE mensal, qualquer que seja a granularidade — é a série da TAXA. */
    porMes: {
      mes: string
      preventivas: number
      reincidentes: number
      taxaReincidencia: number | null
    }[]
  }
  meta: { linhas: number; janelaObservacaoDias: number }
  ms: number
}

const ORDEM: Classe[] = [
  'Reincidiu ≤30d',
  'Reincidiu 31–60d',
  'Reincidiu 61–90d',
  'Sem reincidência',
]

/**
 * Todos os baldes entre `de` e `ate`, inclusive os que não tiveram preventiva.
 *
 * POR QUE PREENCHER O VAZIO. Sem isto, um feriado sem nenhuma preventiva
 * simplesmente não apareceria no eixo, e as colunas dos dias vizinhos ficariam
 * encostadas — a leitura seria "não houve esse dia", não "houve e deu zero".
 * É a mesma razão do `generate_series` de `serie.ts`, e aqui a lista sai em JS
 * porque a consulta devolve linhas por DIMENSÃO, não uma série temporal.
 *
 * ⚠️ Aritmética em UTC de ponta a ponta, e nenhuma chamada a `new Date(string)`
 * com data local: o processo roda em America/Sao_Paulo e a conversão jogaria
 * '2026-09-01' para 31/08 21:00, trocando o mês do primeiro balde.
 *
 * Espelha `date_trunc` do Postgres: 'week' começa na SEGUNDA (ISO-8601), e o
 * primeiro balde pode nascer ANTES de `de` — a semana que contém `de` começa na
 * segunda anterior, e o mês que contém `de` começa no dia 1. É o mesmo
 * comportamento do calendário de `serie.ts`, de propósito: dois painéis da
 * mesma tela recortando o tempo diferente seria pior que a borda.
 */
export function baldes(de: string, ate: string, g: Filtros['granularidade']): string[] {
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  const emUtc = (s: string) => Date.parse(`${s}T00:00:00Z`)
  const DIA = 86_400_000

  const fim = emUtc(ate)
  if (!Number.isFinite(fim) || !Number.isFinite(emUtc(de))) return []

  const saida: string[] = []

  if (g === 'mes') {
    const d = new Date(emUtc(de))
    let ano = d.getUTCFullYear()
    let mes = d.getUTCMonth()
    for (;;) {
      const t = Date.UTC(ano, mes, 1)
      if (t > fim) break
      saida.push(iso(t))
      mes += 1
      if (mes > 11) {
        mes = 0
        ano += 1
      }
      // guarda contra laço infinito se `ate` vier absurdo pela URL
      if (saida.length > 600) break
    }
    return saida
  }

  const passo = g === 'semana' ? 7 * DIA : DIA
  let t = emUtc(de)
  if (g === 'semana') {
    // getUTCDay: 0 = domingo … 6 = sábado. A segunda fica a (dow + 6) % 7 dias atrás.
    const dow = new Date(t).getUTCDay()
    t -= ((dow + 6) % 7) * DIA
  }
  for (; t <= fim; t += passo) {
    saida.push(iso(t))
    if (saida.length > 1200) break
  }
  return saida
}

export async function obterPreventivos(f: Filtros): Promise<ResultadoPreventivos> {
  const params: unknown[] = []
  const p = (v: unknown) => `$${params.push(v)}`

  const de = p(f.de)
  const ate = p(f.ate)
  // interpolado e não parametrizado, como em serie.ts: `date_trunc` exige
  // literal. O valor sai do catálogo GRANULARIDADES, nunca da URL crua.
  const trunc = truncGranularidade(f.granularidade)
  const catalogos = `${p([...CATALOGOS_MANUTENCAO])}::text[]`
  const tiposPrev = `${p([...TIPOS_PREVENTIVOS])}::text[]`
  const catsPrev = `${p([...CATEGORIAS_PREVENTIVAS])}::text[]`
  const clientesTeste = `${p([...CLIENTES_TESTE])}::text[]`
  const tiposFora = `${p([...TIPOS_FORA_DA_MANUTENCAO])}::text[]`
  const equipesFora = `${p([...EQUIPES_FORA_DA_MANUTENCAO])}::int[]`
  // O filtro Tipo da barra só faz sentido entre os tipos preventivos, e por
  // isso a tela restringe o COMBO a eles (ver BarraFiltros). Mas o combo só
  // filtra a LISTA exibida — não limpa um `tipo` que já estava na URL antes
  // de a pessoa chegar aqui (troca de aba, link direto, URL colada à mão).
  // Sem o `filter` abaixo, um tipo de outra tela (ex.: INCIDENTE/PROBLEMA,
  // comum em Recorrência) nunca bate com nenhuma linha de `classificado`
  // (que só contém preventiva) e a tela inteira zera em silêncio — sem
  // erro, sem aviso, indistinguível de "não há preventiva no período".
  // Achado em 09/09/2026, URL reproduzida:
  // /preventivos?...&tipo=TEC-MANUT-ACESSO-CLI-INCIDENTE/PROBLEMA~...
  const tipoValido = f.tipo?.filter((t) => (TIPOS_PREVENTIVOS as readonly string[]).includes(t))
  const filtroTipo = tipoValido?.length ? `AND tipo = any(${p(tipoValido)}::text[])` : ''

  const cond: string[] = []
  if (f.base) cond.push(`ag.regiao = any(${p(f.base)}::text[])`)
  if (f.cidade) cond.push(`pe.city = any(${p(f.cidade)}::text[])`)
  if (f.categoria2) cond.push(`cat2.title = any(${p(f.categoria2)}::text[])`)
  const filtroUsuario = cond.length ? `AND ${cond.join(' AND ')}` : ''

  // a base é propriedade da agenda: só entra no FROM quando o filtro usa
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
      -- Preventivas E reparos juntos: o reparo posterior precisa existir aqui
      -- para ser encontrado. Carrega 90 dias DEPOIS do fim do periodo, senao a
      -- preventiva do fim do recorte nunca acharia o reparo que a invalida.
      SELECT a.id,
             a.created,
             coalesce(ac.user, 'tag:' || ai.contract_service_tag_id::text) AS instalacao,
             pe.city AS cidade,
             cat2.title AS categoria,
             coalesce(it.title, '') AS tipo,
             ai.team_id,
             (it.title = any(${tiposPrev}) OR cat2.title = any(${catsPrev})) AS eh_preventiva,
             max(v2.region_title) OVER (PARTITION BY a.id) AS base_agenda,
             v2.executor AS tecnico
        FROM erp.assignment_incidents ai
        JOIN erp.assignments a            ON a.id = ai.assignment_id
        LEFT JOIN erp.incident_status st  ON st.id = ai.incident_status_id
        LEFT JOIN erp.incident_types it   ON it.id = ai.incident_type_id
        LEFT JOIN erp.catalog_services cs ON cs.id = ai.catalog_service_id
        LEFT JOIN erp.people pe           ON pe.id = a.requestor_id
        LEFT JOIN erp.solicitation_category_matrices scm ON scm.id = ai.solicitation_category_matrix_id
        LEFT JOIN erp.solicitation_service_categories cat2 ON cat2.id = scm.service_category_id_2
        -- LATERAL COM LIMIT 1, E NAO JOIN DIRETO.
        --
        -- erp.authentication_contracts e 1:N por service_tag_id -- ha tags com
        -- 2.050 contratos de autenticacao. O join direto que estava aqui
        -- MULTIPLICAVA a preventiva: em jun-ago/2026 o CTE gerava 3.053 linhas
        -- para 3.050 protocolos distintos, e como a agregacao faz count(*), tres
        -- preventivas eram contadas duas vezes.
        --
        -- Pior que o total inflado: a coluna instalacao e a CHAVE da particao que
        -- procura o reparo posterior. Um protocolo duplicado com logins
        -- diferentes se espalhava por duas particoes, e em cada uma podia achar
        -- (ou nao achar) um reparo distinto.
        --
        -- Mesma regra de desempate ja usada em protocolos.ts: contrato ativo
        -- primeiro, depois o mais recente.
        LEFT JOIN LATERAL (
          SELECT x."user"
            FROM erp.authentication_contracts x
           WHERE x.service_tag_id = ai.contract_service_tag_id
           ORDER BY x.active DESC NULLS LAST, x.id DESC
           LIMIT 1
        ) ac ON true
        LEFT JOIN LATERAL (
          SELECT max(vv.region_title) AS region_title,
                 -- QUEM ATENDEU A PREVENTIVA -- nao quem atendeu o reparo que veio
                 -- depois. Pedido da Manutencao em 28/08/2026 para achar o tecnico
                 -- ofensor: se a preventiva dele volta, a acao preventiva nao
                 -- resolveu.
                 --
                 -- Mesma regra de executor de base.ts (ORDEM_EXECUTOR): o slot que
                 -- fechou primeiro, linha reservada e nunca a sugestao do
                 -- roteirizador. O FILTER e obrigatorio -- sem ele, protocolo que
                 -- so foi sugerido devolveria o nome de quem nunca foi (item 17).
                 (array_agg(vv.resource_name ORDER BY
                    (vv.actual_routing_status = 6) DESC,
                    (vv.routing_status >= 4) DESC,
                    vv.begin_date_slot DESC,
                    vv.routing_status DESC)
                  FILTER (WHERE vv.routing_status >= 4))[1] AS executor
            FROM erp.v_service_desk_slots_productivity_informative vv
           WHERE vv.assignment_id = a.id
        ) v2 ON true
        ${joinBase}
       WHERE a.created >= ${de}::date
         AND a.created < (${ate}::date + interval '91 days')
         AND cs.title = any(${catalogos})
         AND coalesce(st.title, '') <> 'Cancelado'
         -- ⚠️ SEM FILTRO DE CIDADE, de propósito -- decisão da Manutenção em
         -- 02/09/2026: "libera na origem todas as cidades, se precisar análise
         -- faz o filtro e reduz o que interessa". Até aqui só esta tela
         -- restringia às 6 cidades da região (CIDADES_REGIAO), e as outras
         -- telas de protocolo não -- Preventivos e Protocolos respondiam
         -- números diferentes para o mesmo recorte (item O de docs/06). O combo
         -- Cidade da barra continua funcionando normalmente para quem quiser
         -- restringir na hora.
         AND ai.contract_service_tag_id IS NOT NULL
         AND coalesce(pe.name, '') <> all(${clientesTeste})
         ${filtroUsuario}
    ),
    marcado AS (
      -- Para cada linha, a data do PRIMEIRO protocolo nao preventivo posterior da
      -- mesma instalacao. Window function com frame para frente -- sem join, pela
      -- mesma razao documentada em recorrencia.ts (o planejador nao estima CTE e
      -- escolhe Nested Loop).
      SELECT u.*,
             min(u.created) FILTER (WHERE NOT u.eh_preventiva) OVER (
               PARTITION BY u.instalacao ORDER BY u.created
               ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING
             ) AS proximo_reparo
        FROM universo u
    ),
    classificado AS (
      SELECT to_char(date_trunc('month', created), 'YYYY-MM') AS mes,
             -- O BALDE PEDIDO NA BARRA, SEMPRE SOBRE created.
             --
             -- Esta tela ignora o seletor "eixo da data" de propósito: a janela
             -- de 90 dias de reincidência começa a correr quando a preventiva é
             -- ABERTA, então agrupá-la por encerramento ou por agenda mudaria o
             -- balde sem mudar o que está sendo medido. O aviso na tela diz
             -- isso ao leitor -- ver o aviso no topo de preventivos/Conteudo.tsx.
             --
             -- A granularidade, essa sim, passou a valer (14/09/2026): antes
             -- era 'month' fixo, e escolher "Dia" devolvia uma coluna só. O
             -- gráfico não estava errado, mas o silêncio fazia parecer defeito.
             date_trunc('${trunc}', created)::date AS periodo,
             base_agenda AS base,
             cidade,
             categoria,
             tecnico,
             CASE
               -- SEM NENHUMA NOCAO DE MATURIDADE, e isso e deliberado.
               --
               -- Toda preventiva do recorte e classificada: ou reincidiu numa
               -- das tres janelas, ou nao reincidiu. Nenhuma fica de fora do
               -- denominador por ser recente (Manutencao, 28/08/2026), e e o
               -- que a coluna C3 do Power BI sempre fez -- ela devolve
               -- "Reincidente Prev 30d/60d/90d" ou BLANK, so isso.
               --
               -- O preco esta na coluna recente logo abaixo: a preventiva de ontem
               -- teve um dia para reincidir, nao noventa, entao num recorte novo
               -- a taxa sai SUBESTIMADA e sobe sozinha com o tempo. A tela avisa.
               WHEN proximo_reparo IS NULL THEN 'Sem reincidência'
               WHEN proximo_reparo <= created + interval '30 days' THEN 'Reincidiu ≤30d'
               WHEN proximo_reparo <= created + interval '60 days' THEN 'Reincidiu 31–60d'
               WHEN proximo_reparo <= created + interval '90 days' THEN 'Reincidiu 61–90d'
               ELSE 'Sem reincidência'
             END AS classe,
             -- ainda pode reincidir: nao completou a janela de 90 dias
             (created > (current_date - interval '90 days')) AS recente
        FROM marcado
       WHERE eh_preventiva
         -- só as preventivas DENTRO do recorte; o resto foi carregado para lookup
         AND created >= ${de}::date
         AND created < (${ate}::date + interval '1 day')
         -- OS RECORTES ABAIXO FICAM AQUI, E NAO NO CTE universo, DE PROPOSITO.
         --
         -- O CTE universo tem dois papéis: e a fonte das PREVENTIVAS e e a fonte
         -- dos REPAROS que as invalidam. Estreitá-lo apagaria reparos do lookup,
         -- e toda preventiva cujo retorno viesse por um protocolo excluído
         -- passaria a contar como "sem retorno" — o indicador ficaria melhor
         -- justamente por enxergar menos. Defeito silencioso, sem erro na tela.
         --
         -- Aqui embaixo o recorte atinge só QUAL PREVENTIVA ENTRA NA CONTA, que
         -- é o que se quer.
         AND tipo <> all(${tiposFora})
         AND coalesce(team_id, -1) <> all(${equipesFora})
         ${filtroTipo}
    )
    SELECT mes, periodo::text AS periodo, base, cidade, categoria, tecnico, classe, recente,
           count(*)::int AS preventivas
      FROM classificado
     GROUP BY 1, 2, 3, 4, 5, 6, 7, 8`

  const { rows, ms } = await consultarErp<LinhaPreventivo>(sql, params)

  const ehReincidente = (c: Classe) => c.startsWith('Reincidiu')

  const classeMap = new Map<Classe, number>()
  const dim = {
    base: new Map<string, { t: number; r: number }>(),
    cidade: new Map<string, { t: number; r: number }>(),
    categoria: new Map<string, { t: number; r: number }>(),
    tecnico: new Map<string, { t: number; r: number }>(),
    mes: new Map<string, { t: number; r: number }>(),
    periodo: new Map<string, { t: number; r: number }>(),
  }
  let total = 0
  let reincidentes = 0
  let recentes = 0

  for (const r of rows) {
    const n = r.preventivas
    total += n
    if (r.recente) recentes += n
    if (ehReincidente(r.classe)) reincidentes += n
    classeMap.set(r.classe, (classeMap.get(r.classe) ?? 0) + n)

    const soma = (m: Map<string, { t: number; r: number }>, k: string) => {
      const v = m.get(k) ?? { t: 0, r: 0 }
      v.t += n
      if (ehReincidente(r.classe)) v.r += n
      m.set(k, v)
    }
    soma(dim.base, r.base ?? '(sem base)')
    soma(dim.cidade, r.cidade ?? '(sem cidade)')
    soma(dim.categoria, r.categoria ?? '(sem categoria)')
    soma(dim.tecnico, r.tecnico ?? '(sem técnico na agenda)')
    soma(dim.mes, r.mes)
    soma(dim.periodo, r.periodo)
  }

  const taxa = (a: number, b: number) => (b > 0 ? a / b : null)
  const paraDim = (m: Map<string, { t: number; r: number }>): ItemDimPreventiva[] =>
    [...m.entries()]
      .map(([rotulo, v]) => ({
        rotulo,
        preventivas: v.t,
        reincidentes: v.r,
        taxaReincidencia: taxa(v.r, v.t),
      }))
      .sort((a, b) => b.preventivas - a.preventivas)

  return {
    data: {
      total: {
        preventivas: total,
        reincidentes,
        // DENOMINADOR = TODAS as preventivas do recorte, nao so as maduras.
        // Mesma divisao da medida '% Reincidentes sobre Preventivos' do Power BI.
        taxaReincidencia: taxa(reincidentes, total),
        pct30: taxa(classeMap.get('Reincidiu ≤30d') ?? 0, total),
        pct60: taxa(classeMap.get('Reincidiu 31–60d') ?? 0, total),
        pct90: taxa(classeMap.get('Reincidiu 61–90d') ?? 0, total),
        recentes,
      },
      porClasse: ORDEM.map((classe) => ({
        classe,
        preventivas: classeMap.get(classe) ?? 0,
        share: taxa(classeMap.get(classe) ?? 0, total) ?? 0,
      })),
      porBase: paraDim(dim.base),
      porCidade: paraDim(dim.cidade),
      porCategoria: paraDim(dim.categoria),
      porTecnico: paraDim(dim.tecnico),
      porPeriodo: baldes(f.de, f.ate, f.granularidade).map((periodo) => {
        const v = dim.periodo.get(periodo) ?? { t: 0, r: 0 }
        return {
          periodo,
          preventivas: v.t,
          reincidentes: v.r,
          taxaReincidencia: taxa(v.r, v.t),
        }
      }),
      porMes: [...dim.mes.entries()]
        .map(([mes, v]) => ({
          mes,
          preventivas: v.t,
          reincidentes: v.r,
          taxaReincidencia: taxa(v.r, v.t),
        }))
        .sort((a, b) => a.mes.localeCompare(b.mes)),
    },
    meta: { linhas: rows.length, janelaObservacaoDias: 90 },
    ms,
  }
}
