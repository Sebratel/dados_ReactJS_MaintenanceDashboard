import { consultarErp } from '@/server/db/erp'
import { STATUS_ENCERRADO } from '@/config/regras-negocio'
import type { Filtros } from '@/lib/filtros'
import { montarFrom, montarWhere, partesNecessarias, truncGranularidade } from './base'

export type PontoSerie = {
  periodo: string
  /** protocolos CRIADOS no período (entrada) */
  abertos: number
  /** protocolos ENCERRADOS no período (saída) — contados pela data de encerramento */
  encerrados: number
  /** saldo do fluxo: entrada − saída. Positivo = backlog crescendo. */
  saldo: number
  /** MTTR médio dos protocolos encerrados no período */
  mttrHoras: number | null
}

/**
 * Fluxo de entrada × saída no tempo.
 *
 * DECISÃO IMPORTANTE: as duas séries usam eixos de data DIFERENTES de propósito —
 * `abertos` conta por `a.created`, `encerrados` conta por `a.conclusion_date`.
 *
 * Por quê: se ambas usassem o mesmo eixo, "encerrados" com eixo de criação
 * significaria "criados no dia X que já foram encerrados algum dia" — que é
 * 99,7% do total e faz as duas linhas se sobreporem, sem informar nada. Medido
 * em julho/2026: 3.765 abertos × 3.753 "encerrados" no mesmo eixo.
 *
 * Com eixos naturais, o gráfico responde a pergunta que o gestor tem: **o
 * backlog está crescendo ou diminuindo?** É o mesmo par de visuais que o Power
 * BI mantinha separado (`PROTOCOLOS ENTRANTES MÊS` × `REPAROS ENCERRADOS MÊS`),
 * agora sobreposto no mesmo calendário para leitura direta.
 *
 * O filtro "eixo da data" da barra superior continua governando os KPIs, os
 * rankings e o heatmap — só este painel usa os dois eixos, e diz isso na tela.
 *
 * `generate_series` garante períodos sem movimento presentes com zero — sem
 * isso a linha "pula" o dia vazio e sugere continuidade que não existe.
 */
export async function obterSerie(f: Filtros): Promise<{
  data: PontoSerie[]
  meta: { eixoDuplo: true; totalAbertos: number; totalEncerrados: number }
  ms: number
}> {
  // WHERE sem período: cada CTE aplica o seu próprio recorte de data
  // a série não usa agenda nem categorias na saída — só nos filtros
  const FROM = montarFrom(partesNecessarias(f))
  const w = montarWhere(f, { ignorarPeriodo: true })
  const enc = w.params.push([...STATUS_ENCERRADO])
  const iDe = w.params.push(f.de)
  const iAte = w.params.push(f.ate)
  const trunc = truncGranularidade(f.granularidade)

  const sql = /* sql */ `
    WITH calendario AS (
      SELECT generate_series(
               date_trunc('${trunc}', $${iDe}::date),
               date_trunc('${trunc}', $${iAte}::date),
               interval '1 ${trunc}'
             )::date AS periodo
    ),
    entradas AS (
      SELECT date_trunc('${trunc}', a.created)::date AS periodo,
             count(distinct ai.protocol)::int AS n
      ${FROM}
      ${w.sql}
        AND a.created >= $${iDe}::date
        AND a.created < ($${iAte}::date + interval '1 day')
      GROUP BY 1
    ),
    saidas AS (
      SELECT date_trunc('${trunc}', a.conclusion_date)::date AS periodo,
             count(distinct ai.protocol)::int AS n,
             round(avg(extract(epoch from (a.conclusion_date - a.created)) / 3600.0)::numeric, 2) AS mttr_h
      ${FROM}
      ${w.sql}
        AND st.title = any($${enc})
        AND a.conclusion_date >= $${iDe}::date
        AND a.conclusion_date < ($${iAte}::date + interval '1 day')
      GROUP BY 1
    )
    SELECT c.periodo::text            AS periodo,
           coalesce(e.n, 0)           AS abertos,
           coalesce(s.n, 0)           AS encerrados,
           s.mttr_h                   AS mttr_h
      FROM calendario c
      LEFT JOIN entradas e ON e.periodo = c.periodo
      LEFT JOIN saidas   s ON s.periodo = c.periodo
     ORDER BY c.periodo
  `

  const r = await consultarErp<{
    periodo: string
    abertos: number
    encerrados: number
    mttr_h: number | null
  }>(sql, w.params)

  const data = r.rows.map((x) => ({
    periodo: x.periodo,
    abertos: x.abertos,
    encerrados: x.encerrados,
    saldo: x.abertos - x.encerrados,
    mttrHoras: x.mttr_h,
  }))

  return {
    ms: r.ms,
    meta: {
      eixoDuplo: true,
      totalAbertos: data.reduce((s, d) => s + d.abertos, 0),
      totalEncerrados: data.reduce((s, d) => s + d.encerrados, 0),
    },
    data,
  }
}
