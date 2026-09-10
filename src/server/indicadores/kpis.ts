import { consultarErp } from '@/server/db/erp'
import { STATUS_ENCERRADO } from '@/config/regras-negocio'
import type { Filtros } from '@/lib/filtros'
import { montarFrom, montarWhere, partesNecessarias, porEncerramento } from './base'

export type Kpis = {
  protocolos: number
  /** criados no recorte que JÁ encerraram — base de `abertos` e da taxa */
  encerrados: number
  abertos: number
  semAgenda: number
  /**
   * MTTR_E — média dos reparos ENCERRADOS no período, contados pelo mês em que
   * o cliente voltou a operar. Não acompanha o seletor de eixo. Ver
   * `porEncerramento` em base.ts.
   */
  mttrHoras: number | null
  /** protocolos cuja DATA DE ENCERRAMENTO caiu no período — denominador do MTTR_E */
  encerradosNoPeriodo: number
  taxaEncerramento: number | null
  /** comparação com o período anterior de mesma duração */
  anterior: { protocolos: number; mttrHoras: number | null }
  variacaoProtocolos: number | null
}

type LinhaContagem = {
  protocolos: number
  encerrados: number
  sem_agenda: number
}

type LinhaTempo = {
  mttr_h: number | null
  ant_mttr_h: number | null
  encerrados_periodo: number
}

function periodoAnterior(f: Filtros): { de: string; ate: string } {
  const de = new Date(`${f.de}T00:00:00Z`)
  const ate = new Date(`${f.ate}T00:00:00Z`)
  const dias = Math.max(1, Math.round((ate.getTime() - de.getTime()) / 86_400_000) + 1)
  const anteriorAte = new Date(de.getTime() - 86_400_000)
  const anteriorDe = new Date(anteriorAte.getTime() - (dias - 1) * 86_400_000)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { de: iso(anteriorDe), ate: iso(anteriorAte) }
}

/**
 * KPIs do topo, em três consultas SEQUENCIAIS de escopo desigual.
 *
 * O caminho até aqui, medido (docs/02-schema-postgres.md §7):
 *
 * 1. Três consultas em `Promise.all` (atual, anterior, MTTA): isoladas custavam
 *    ~370 ms cada, mas concorrentes na réplica de produção subiam para 2,5 s
 *    (mês) e 5,7 s (ano) — contenção de I/O e CPU, não custo de plano.
 * 2. Fundir tudo em uma consulta piorou o ano (9,8 s): dobrar a janela para
 *    cobrir o período anterior dobrou também o alcance do LATERAL da agenda,
 *    que é a parte caríssima (~2,4 s no ano por si só).
 * 3. Daí a separação por NECESSIDADE de agenda:
 *    - Q1, período atual, COM o LATERAL — é o único que precisa dele, para
 *      `semAgenda`;
 *    - Q2, período anterior, SEM o LATERAL — só conta protocolo.
 * 4. O MTTA saiu daqui para o indicador `mtta`: sozinho ele custava 1,2 s no mês
 *    e 3,6 s no ano dentro desta consulta. Como tile independente, carrega em
 *    paralelo e não atrasa os outros números.
 * 5. Q3 nasceu com o MTTR_E. O MTTR deixou de ser um `avg` carona nas contagens
 *    porque passou a ter EIXO PRÓPRIO — encerramento, sempre, qualquer que seja
 *    o seletor (ver `porEncerramento` em base.ts). Como o eixo é outro, o
 *    conjunto de linhas é outro: um reparo aberto em junho e fechado em julho
 *    não está nas linhas de Q1 quando o eixo é criação.
 *
 * Medido em julho/2026: Q1 668 ms + Q2 209 ms + Q3 365 ms.
 *
 * Custa ~365 ms a mais que a versão anterior, e é o preço de o número parar de
 * mudar depois que o mês fecha. Q3 ainda devolve `encerrados_periodo`, que é o
 * denominador honesto do MTTR_E — sem ele o cartão mostraria uma média sem
 * dizer sobre quantos reparos.
 *
 * Sequenciais, para não competirem pelo banco. A janela padrão (mês) fica
 * rápida e o ano, que é consulta eventual, é absorvido pelo cache de 60 s.
 */
export async function obterKpis(f: Filtros): Promise<{ data: Kpis; ms: number }> {
  const ant = periodoAnterior(f)

  // ── Q1: contagens do período atual, no eixo que a pessoa escolheu, com agenda ──
  const FROM_COM_AGENDA = montarFrom(partesNecessarias(f, { agenda: true }))
  const w1 = montarWhere(f)
  const enc1 = w1.params.push([...STATUS_ENCERRADO])
  const ehEnc1 = `st.title = any($${enc1})`

  const sqlAtual = /* sql */ `
    SELECT
      count(distinct ai.protocol)::int AS protocolos,
      count(distinct ai.protocol) FILTER (WHERE ${ehEnc1})::int AS encerrados,
      -- "sem agendamento" só entre os AINDA ABERTOS: um protocolo encerrado sem
      -- slot registrado não é pendência de agenda. Contar sobre o total dava o
      -- absurdo de 33 sem agenda com 12 em aberto.
      count(distinct ai.protocol) FILTER (
        WHERE s.ultima_agenda IS NULL AND NOT (${ehEnc1})
      )::int AS sem_agenda
    ${FROM_COM_AGENDA}
    ${w1.sql}
  `

  // ── Q2: contagem do período anterior, SEM agenda ──
  const w2 = montarWhere({ ...f, de: ant.de, ate: ant.ate })
  const sqlAnterior = /* sql */ `
    SELECT count(distinct ai.protocol)::int AS ant_protocolos
    ${montarFrom(partesNecessarias({ ...f, de: ant.de, ate: ant.ate }))}
    ${w2.sql}
  `

  /**
   * ── Q3: MTTR_E, período atual E anterior numa passada só ──
   *
   * Os dois períodos são CONTÍGUOS em `conclusion_date` (o anterior termina na
   * véspera do atual), então uma única faixa cobre ambos e o corte sai por
   * FILTER. Isso mantém o predicado numa coluna só — que é o que preserva o
   * índice. Medido em julho/2026: 365 ms para os dois meses, contra 310 ms para
   * um mês sozinho; o período anterior sai praticamente de graça.
   *
   * Sem LATERAL de agenda de propósito: MTTR não usa nada de lá, e o LATERAL
   * custa ~200 ms no mês e ~2,4 s no ano.
   */
  const fTempo = porEncerramento({ ...f, de: ant.de, ate: f.ate })
  const w3 = montarWhere(fTempo)
  const iCorte = w3.params.push(f.de)
  const mttr = `extract(epoch from (a.conclusion_date - a.created)) / 3600.0`
  const noAtual = `a.conclusion_date >= $${iCorte}::date`

  const sqlTempo = /* sql */ `
    SELECT round(avg(${mttr}) FILTER (WHERE ${noAtual})::numeric, 2)       AS mttr_h,
           round(avg(${mttr}) FILTER (WHERE NOT (${noAtual}))::numeric, 2) AS ant_mttr_h,
           count(distinct ai.protocol) FILTER (WHERE ${noAtual})::int      AS encerrados_periodo
    ${montarFrom(partesNecessarias(fTempo))}
    ${w3.sql}
  `

  // sequenciais de propósito — em paralelo disputam a réplica e ficam 6× mais lentas
  const r1 = await consultarErp<LinhaContagem>(sqlAtual, w1.params)
  const r2 = await consultarErp<{ ant_protocolos: number }>(sqlAnterior, w2.params)
  const r3 = await consultarErp<LinhaTempo>(sqlTempo, w3.params)

  const x = r1.rows[0]
  if (!x) throw new Error('consulta de KPIs não retornou linha')
  const y = r2.rows[0]
  const z = r3.rows[0]

  const protocolos = x.protocolos ?? 0
  const encerrados = x.encerrados ?? 0
  const antProtocolos = y?.ant_protocolos ?? 0

  return {
    ms: r1.ms + r2.ms + r3.ms,
    data: {
      protocolos,
      encerrados,
      abertos: protocolos - encerrados,
      semAgenda: x.sem_agenda ?? 0,
      mttrHoras: z?.mttr_h ?? null,
      encerradosNoPeriodo: z?.encerrados_periodo ?? 0,
      taxaEncerramento: protocolos ? encerrados / protocolos : null,
      anterior: { protocolos: antProtocolos, mttrHoras: z?.ant_mttr_h ?? null },
      variacaoProtocolos: antProtocolos
        ? (protocolos - antProtocolos) / antProtocolos
        : null,
    },
  }
}
