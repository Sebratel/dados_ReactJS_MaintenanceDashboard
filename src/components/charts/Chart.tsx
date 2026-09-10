'use client'

import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import {
  BarChart,
  LineChart,
  HeatmapChart,
  CustomChart,
} from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  VisualMapComponent,
  GraphicComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

/**
 * Registro modular do ECharts — só o que usamos entra no bundle.
 * Canvas em vez de SVG: séries diárias de um ano com múltiplas séries
 * degradam em SVG (foi um dos motivos de escolher ECharts sobre Recharts).
 */
echarts.use([
  BarChart,
  LineChart,
  HeatmapChart,
  CustomChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  VisualMapComponent,
  GraphicComponent,
  CanvasRenderer,
])

export type ChartProps = {
  option: echarts.EChartsCoreOption
  /** altura em px; o gráfico rola no próprio container se precisar */
  altura?: number
  className?: string
  'aria-label'?: string
}

export function Chart({ option, altura = 280, className, ...rest }: ChartProps) {
  const ref = useRef<HTMLDivElement>(null)
  const inst = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current, undefined, { renderer: 'canvas' })
    inst.current = chart

    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(ref.current)

    // o tema muda quando o usuário alterna light/dark → recria a option
    const mo = new MutationObserver(() => chart.resize())
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    return () => {
      ro.disconnect()
      mo.disconnect()
      chart.dispose()
      inst.current = null
    }
  }, [])

  useEffect(() => {
    // notMerge: true — evita séries fantasma quando o filtro reduz o dataset
    inst.current?.setOption(option, { notMerge: true })
  }, [option])

  return (
    <div
      ref={ref}
      role="img"
      className={className}
      style={{ height: altura, width: '100%' }}
      {...rest}
    />
  )
}
