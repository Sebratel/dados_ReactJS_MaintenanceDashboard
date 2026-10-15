import { consultarErp } from '@/server/db/erp'
import { STATUS_ENCERRADO } from '@/config/regras-negocio'
import type { Filtros } from '@/lib/filtros'
import { CASAS_HORA, montarFrom, montarWhere, partesNecessarias, truncGranularidade } from './base'

/**
 * ⚠️ TUDO ANULÁVEL POR CAUSA DO FUTURO, e a diferença importa: `0` é uma
 * AFIRMAÇÃO ("não houve nenhum"), `null` é a ausência de medida ("esse dia
 * ainda não aconteceu"). Ver o comentário sobre `periodo > current_date` na
 * consulta abaixo.
 */
export type PontoSerie = {
  periodo: string
  /** protocolos CRIADOS no período (entrada) — `null` em período futuro */
  abertos: number | null
  /** protocolos ENCERRADOS no período (saída) — contados pela data de encerramento */
  encerrados: number | null
  /** saldo do fluxo: entrada − saída. Positivo = backlog crescendo. */
  saldo: number | null
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
 *
 * ⚠️ Com UMA exceção, e ela é o oposto: período no FUTURO vem `null`, não zero.
 * Dia sem movimento é uma medida ("não houve nenhum"); dia que ainda não
 * aconteceu não é medida nenhuma. Ver o comentário na cláusula final.
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
             round(avg(extract(epoch from (a.conclusion_date - a.created)) / 3600.0)::numeric, ${CASAS_HORA}) AS mttr_h
      ${FROM}
      ${w.sql}
        AND st.title = any($${enc})
        AND a.conclusion_date >= $${iDe}::date
        AND a.conclusion_date < ($${iAte}::date + interval '1 day')
      GROUP BY 1
    )
    /*
     * PERÍODO FUTURO VEM NULO, NÃO ZERO.
     *
     * Num recorte que alcança o futuro — "mês corrente" no dia 15 vai até o dia
     * 30 — o LEFT JOIN não acha linha para os dias que ainda não aconteceram,
     * e o coalesce(…, 0) que estava aqui os desenhava como zero. A linha
     * despencava no meio do gráfico e lia como operação parando; quem olhasse a
     * ponta direita via uma queda que não existiu.
     *
     * Zero é uma AFIRMAÇÃO — "não houve nenhum". Null é ausência de medida. O
     * eixo continua indo até o fim do recorte (a pessoa vê quanto do mês já
     * correu), mas o traço para em hoje. É o que o Power BI da Manutenção
     * sempre fez, e foi a decisão dela em 15/09/2026 (item D de docs/06).
     *
     * c.periodo > current_date e não >=: o balde é datado pelo INÍCIO, então
     * a semana que começou dia 14 e o mês que começou dia 1 são o período
     * CORRENTE — parciais, mas medidos. Só some o balde que começa depois de
     * hoje.
     */
    SELECT c.periodo::text AS periodo,
           CASE WHEN c.periodo > current_date THEN NULL ELSE coalesce(e.n, 0) END AS abertos,
           CASE WHEN c.periodo > current_date THEN NULL ELSE coalesce(s.n, 0) END AS encerrados,
           s.mttr_h                   AS mttr_h
      FROM calendario c
      LEFT JOIN entradas e ON e.periodo = c.periodo
      LEFT JOIN saidas   s ON s.periodo = c.periodo
     ORDER BY c.periodo
  `

  const r = await consultarErp<{
    periodo: string
    abertos: number | null
    encerrados: number | null
    mttr_h: number | null
  }>(sql, w.params)

  const data = r.rows.map((x) => ({
    periodo: x.periodo,
    abertos: x.abertos,
    encerrados: x.encerrados,
    // sem as duas pontas não há saldo — `null - null` daria 0 em JS, que é
    // exatamente a afirmação falsa ("entrou tanto quanto saiu") que este item
    // veio tirar da tela.
    saldo: x.abertos === null || x.encerrados === null ? null : x.abertos - x.encerrados,
    mttrHoras: x.mttr_h,
  }))

  return {
    ms: r.ms,
    meta: {
      eixoDuplo: true,
      // `?? 0` nos totais: período futuro não soma nada, e o total continua
      // sendo o que de fato aconteceu no recorte. Aqui somar zero é correto —
      // é no GRÁFICO que zero mentiria, porque lá ele vira um ponto desenhado.
      totalAbertos: data.reduce((s, d) => s + (d.abertos ?? 0), 0),
      totalEncerrados: data.reduce((s, d) => s + (d.encerrados ?? 0), 0),
    },
    data,
  }
}
