import { consultarErp } from '@/server/db/erp'
import type { Filtros } from '@/lib/filtros'
import { CASAS_HORA, EXPR, montarFrom, montarWhere, partesNecessarias, porAbertura } from './base'

export type CelulaHeatmap = {
  diaSemana: number
  diaLabel: string
  turno: string
  protocolos: number
  mttrHoras: number | null
}

const DIAS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'] as const
const TURNOS = ['1. 00-08h', '2. 08-12h', '3. 12-19h', '4. 19-24h'] as const

/**
 * MTTR_A — matriz dia da semana × turno, SEMPRE no eixo de ABERTURA.
 *
 * Este painel não responde "quanto demorou o que fechamos", e sim **"reparo que
 * ENTRA neste dia e nesta hora espera quanto"**. É leitura de CAPACIDADE, na
 * perspectiva do cliente: reparo aberto no sábado à noite espera até segunda —
 * o que o mapa mostra é escala e folga, não lentidão da equipe.
 *
 * Por isso ele IGNORA o seletor "Eixo da data" (`porAbertura`). Trocar o eixo
 * aqui não deixaria o painel mais coerente com o resto da tela; deixaria ele
 * sem função, porque a pergunta que ele existe para responder é sobre o
 * instante da ABERTURA. As duas colunas que classificam a célula
 * (`EXPR.diaSemanaNum` e `EXPR.turno`) já leem `a.created` — o que faltava era
 * o recorte do período concordar com elas.
 *
 * É o que o Power BI fazia, escrito nas colunas calculadas:
 *   column 'Turno MTTR_A'  = HOUR(protocolosTotais[dataHoraCriacao])
 *   column 'Dia da Semana' = FORMAT(protocolosTotais[dataHoraCriacao], "ddd")
 *
 * Substitui os pivots `QTD. TOTAL REPAROS POR DIA E TURNO` e `MTTR_A POR DIA E
 * TURNO` do Relatório Executivo. Sempre devolve a grade completa (7×4 = 28
 * células), com zero onde não houve movimento, para o mapa não ficar esburacado.
 */
export async function obterHeatmap(f: Filtros): Promise<{
  data: CelulaHeatmap[]
  meta: { dias: readonly string[]; turnos: readonly string[]; maxProtocolos: number; maxMttr: number }
  ms: number
}> {
  const fAbertura = porAbertura(f)
  // partes vêm do recorte ORIGINAL: se a pessoa filtrou por base, o LATERAL da
  // agenda continua necessário mesmo com o eixo trocado.
  const FROM = montarFrom(partesNecessarias(f))
  const w = montarWhere(fAbertura)
  const sql = /* sql */ `
    SELECT ${EXPR.diaSemanaNum} AS dia,
           ${EXPR.turno} AS turno,
           count(distinct ai.protocol)::int AS protocolos,
           round(avg(extract(epoch from (a.conclusion_date - a.created)) / 3600.0)::numeric, ${CASAS_HORA}) AS mttr_h
    ${FROM}
    ${w.sql}
    GROUP BY 1, 2
  `
  const r = await consultarErp<{
    dia: number
    turno: string
    protocolos: number
    mttr_h: number | null
  }>(sql, w.params)

  const mapa = new Map(r.rows.map((x) => [`${x.dia}|${x.turno}`, x]))
  const data: CelulaHeatmap[] = []
  for (let d = 0; d < 7; d++) {
    for (const t of TURNOS) {
      const hit = mapa.get(`${d}|${t}`)
      data.push({
        diaSemana: d,
        diaLabel: DIAS[d]!,
        turno: t,
        protocolos: hit?.protocolos ?? 0,
        mttrHoras: hit?.mttr_h ?? null,
      })
    }
  }

  return {
    ms: r.ms,
    meta: {
      dias: DIAS,
      turnos: TURNOS,
      maxProtocolos: Math.max(0, ...data.map((c) => c.protocolos)),
      maxMttr: Math.max(0, ...data.map((c) => c.mttrHoras ?? 0)),
    },
    data,
  }
}
