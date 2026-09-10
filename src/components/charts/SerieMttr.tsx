'use client'

import { useMemo } from 'react'
import { Chart } from './Chart'
import { lerTokens, MARCA, baseEixoCategoria, baseEixoValor, baseGrid, baseTooltip } from '@/lib/tema'
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
          data: dados.map((d) => d.mttrHoras),
          connectNulls: false,
          smooth: false,
          symbol: 'circle',
          symbolSize: MARCA.tamanhoMarcador,
          showSymbol: dados.length <= 40,
          lineStyle: { width: MARCA.larguraLinha, color: tk.series[1] },
          itemStyle: { color: tk.series[1], borderColor: tk.surface, borderWidth: 2 },
          areaStyle: { color: `${tk.series[1]}14` },
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
