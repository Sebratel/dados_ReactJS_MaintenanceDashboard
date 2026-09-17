'use client'

import { useMemo } from 'react'
import { Chart } from './Chart'
import {
  lerTokens,
  MARCA,
  baseEixoCategoria,
  baseEixoValor,
  baseGrid,
  baseTooltip,
  rotuloValor,
} from '@/lib/tema'
import { fmtHoras, fmtHorasCurto, fmtPeriodo } from '@/lib/formato'
import type { PontoSerie } from '@/server/indicadores/serie'
import type { Granularidade } from '@/lib/filtros'

/**
 * MTTR médio no tempo — série ÚNICA, então sem caixa de legenda (o título
 * nomeia a série, conforme o guia). Fica separado de Abertos/Encerrados de
 * propósito: unidade diferente (horas vs contagem) exigiria eixo duplo.
 *
 * Linha de referência na média do período dá contexto sem poluir.
 */
export function SerieMttr({
  dados,
  granularidade,
  altura = 200,
}: {
  dados: PontoSerie[]
  granularidade: Granularidade
  altura?: number
}) {
  const option = useMemo(() => {
    const tk = lerTokens()
    const validos = dados.filter((d) => d.mttrHoras !== null)
    const media =
      validos.length > 0
        ? validos.reduce((s, d) => s + (d.mttrHoras ?? 0), 0) / validos.length
        : null

    return {
      grid: baseGrid(tk, { top: 16 }),
      tooltip: baseTooltip(tk, {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: tk.axis, width: 1 } },
        formatter: (ps: { dataIndex: number; value: number | null }[]) => {
          const i = ps[0]?.dataIndex ?? 0
          const d = dados[i]
          if (!d) return ''
          return `<b>${fmtPeriodo(d.periodo, granularidade)}</b><br/>MTTR médio <b>${fmtHoras(d.mttrHoras)}</b>`
        },
      }),
      xAxis: baseEixoCategoria(tk, {
        data: dados.map((d) => fmtPeriodo(d.periodo, granularidade)),
        boundaryGap: false,
        axisLabel: { color: tk.textMuted, fontSize: 11, hideOverlap: true },
      }),
      yAxis: baseEixoValor(tk, {
        axisLabel: {
          color: tk.textMuted,
          fontSize: 11,
          formatter: (v: number) => fmtHorasCurto(v),
        },
      }),
      series: [
        {
          name: 'MTTR',
          type: 'line',
          /**
           * ANCORAGEM DAS PONTAS — sem isto o primeiro rótulo invade o eixo Y.
           *
           * Este gráfico usa `boundaryGap: false`, então o primeiro ponto nasce
           * EM CIMA da linha do eixo. Com `position: 'top'` o rótulo é centrado
           * nele e metade do texto cai fora da área de plotagem, por cima do
           * rótulo do eixo — em 17/09/2026, num teste renderizado, "20h" e
           * "15,6h" saíram sobrepostos como "20₁5,6h".
           *
           * `hideOverlap` não pega este caso: ele resolve colisão ENTRE rótulos
           * de série, e o rótulo do eixo não participa desse layout.
           *
           * Alinhar a primeira à esquerda e a última à direita empurra as duas
           * para dentro. Só as pontas precisam: o miolo tem vizinho dos dois
           * lados e fica centrado, que é a leitura correta.
           */
          data: dados.map((d, i) => ({
            value: d.mttrHoras,
            label:
              i === 0
                ? { align: 'left' as const }
                : i === dados.length - 1
                  ? { align: 'right' as const }
                  : undefined,
          })),
          connectNulls: false,
          smooth: false,
          symbol: 'circle',
          symbolSize: MARCA.tamanhoMarcador,
          showSymbol: dados.length <= 40,
          lineStyle: { width: MARCA.larguraLinha, color: tk.series[1] },
          itemStyle: { color: tk.series[1], borderColor: tk.surface, borderWidth: 2 },
          areaStyle: { color: `${tk.series[1]}14` },
          /**
           * Série ÚNICA — por isso o rótulo por ponto é seguro aqui, e não em
           * `SerieTemporal`, onde duas linhas dividem o eixo e os números de uma
           * cairiam sobre a outra.
           *
           * `fmtHorasCurto` e não `fmtHoras`: "18,2h" ocupa ~30 px, enquanto
           * "18h 12min" ocupa o dobro e faria o `hideOverlap` derrubar metade
           * dos pontos num recorte mensal. A forma longa continua no tooltip.
           */
          ...rotuloValor({
            n: dados.length,
            formatter: (p) => (p.value === null ? '' : fmtHorasCurto(p.value)),
            cor: tk.textSecondary,
          }),
          markLine:
            media === null
              ? undefined
              : {
                  silent: true,
                  symbol: 'none',
                  lineStyle: { color: tk.textMuted, type: 'dashed', width: 1 },
                  label: {
                    formatter: `média ${fmtHorasCurto(media)}`,
                    color: tk.textMuted,
                    fontSize: 10,
                    position: 'insideEndTop' as const,
                  },
                  data: [{ yAxis: media }],
                },
        },
      ],
    }
  }, [dados, granularidade])

  return <Chart option={option} altura={altura} aria-label="MTTR médio ao longo do tempo" />
}
