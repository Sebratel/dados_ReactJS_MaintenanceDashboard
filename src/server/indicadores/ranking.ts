import { consultarErp } from '@/server/db/erp'
import { STATUS_ENCERRADO } from '@/config/regras-negocio'
import { DIMENSOES, ehDimensaoOrdinal, type Filtros } from '@/lib/filtros'
import {
  EXPR,
  CASAS_HORA,
  deslocarParams,
  montarFrom,
  montarWhere,
  partesNecessarias,
  porEncerramento,
  sqlDimensao,
} from './base'

export type ItemRanking = {
  rotulo: string
  protocolos: number
  encerrados: number
  mttrHoras: number | null
  share: number
}

/**
 * Agregado por dimensão (cidade, base, equipe, técnico, catálogo, categoria…).
 *
 * ── DUAS JANELAS NA MESMA LINHA, de propósito ─────────────────────────────
 *
 * `protocolos` e `encerrados` contam no eixo que a pessoa escolheu — é volume,
 * e volume pertence a quando o protocolo entrou (ou ao que o seletor disser).
 * `mttrHoras` é MTTR_E e sai SEMPRE pelo encerramento: um reparo aberto em
 * julho e fechado em agosto é desempenho de agosto (ver `porEncerramento`).
 *
 * Parece inconsistência e não é — é exatamente o que o Power BI entregava, só
 * que escondido dentro da medida:
 *   measure 'MTTR Formatado (Encerramento)' =
 *     CALCULATE(AVERAGE(...[mttrHoras]),
 *               USERELATIONSHIP(Calendario[Date], protocolosTotais[dataEncerrado]))
 * O USERELATIONSHIP troca o eixo DA MEDIDA e deixa o do visual intacto. Aqui
 * isso vira dois CTEs sobre o mesmo FROM, unidos pelo rótulo.
 *
 * A contagem manda: `contagem LEFT JOIN tempos`. Uma linha que só existe na
 * janela de encerramento (equipe que fechou em julho o que abriu em junho, e
 * nada abriu em julho) não inventa uma categoria nova no ranking — ela
 * apareceria com volume zero e ordenaria o gráfico por uma barra inexistente.
 *
 * ── Ordenação ─────────────────────────────────────────────────────────────
 *
 * Depende do TIPO da dimensão:
 * - nominal (cidade, equipe…) → por volume desc, é um ranking de verdade;
 * - ordinal (turno, dia da semana) → pela sequência natural, porque a ordem
 *   carrega significado e reordenar por volume destruiria o padrão.
 *
 * O `share` sai de window function — é o que a medida `Porcentagem_total` do
 * Power BI fazia com ALL(), mas sem depender de contexto de filtro implícito.
 */
export async function obterRanking(f: Filtros): Promise<{
  data: ItemRanking[]
  meta: { dimensao: string; total: number; ordinal: boolean }
  ms: number
}> {
  // as duas janelas compartilham o FROM: o que a dimensão exige não muda com o eixo
  const FROM = montarFrom(partesNecessarias(f))
  const expr = sqlDimensao(f.dim)
  const ordinal = ehDimensaoOrdinal(f.dim)

  const wCont = montarWhere(f)
  const enc = wCont.params.push([...STATUS_ENCERRADO])
  const wTempo = deslocarParams(montarWhere(porEncerramento(f)), wCont.params.length)
  const params = [...wCont.params, ...wTempo.params]
  const iLimite = params.push(f.limite)

  // chave de ordenação natural para as dimensões ordinais
  const exprOrdem =
    f.dim === 'turno'
      ? EXPR.turno // já vem prefixado '1. '…'4. '
      : f.dim === 'diaSemana'
        ? `lpad(${EXPR.diaSemanaNum}::text, 2, '0')`
        : 'null::text'

  const rotulo = `coalesce(nullif(trim(${expr}::text), ''), '(sem informação)')`

  const sql = /* sql */ `
    WITH contagem AS (
      SELECT ${rotulo} AS rotulo,
             min(${exprOrdem}) AS ordem,
             count(distinct ai.protocol)::int AS protocolos,
             count(distinct ai.protocol) FILTER (WHERE st.title = any($${enc}))::int AS encerrados
      ${FROM}
      ${wCont.sql}
      GROUP BY 1
    ),
    tempos AS (
      SELECT ${rotulo} AS rotulo,
             round(avg(extract(epoch from (a.conclusion_date - a.created)) / 3600.0)::numeric, ${CASAS_HORA}) AS mttr_h
      ${FROM}
      ${wTempo.sql}
      GROUP BY 1
    )
    SELECT c.rotulo, c.protocolos, c.encerrados, t.mttr_h,
           sum(c.protocolos) OVER ()::int AS total_geral
      FROM contagem c
      LEFT JOIN tempos t ON t.rotulo = c.rotulo
     ORDER BY ${ordinal ? 'c.ordem ASC NULLS LAST' : 'c.protocolos DESC'}, c.rotulo
     LIMIT $${iLimite}
  `

  const r = await consultarErp<{
    rotulo: string
    protocolos: number
    encerrados: number
    mttr_h: number | null
    total_geral: number
  }>(sql, params)

  const total = r.rows[0]?.total_geral ?? 0
  return {
    ms: r.ms,
    meta: { dimensao: DIMENSOES[f.dim].label, total, ordinal },
    data: r.rows.map((x) => ({
      // remove o prefixo de ordenação do turno ('3. 12-19h' → '12-19h')
      rotulo: x.rotulo.replace(/^\d+\.\s*/, ''),
      protocolos: x.protocolos,
      encerrados: x.encerrados,
      mttrHoras: x.mttr_h,
      share: total ? x.protocolos / total : 0,
    })),
  }
}
