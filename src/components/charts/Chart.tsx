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
  /**
   * Clique numa marca da série. Recebe o `dataIndex` — quem chama traduz para
   * o seu domínio, porque só ele sabe a ordem em que montou os dados.
   */
  aoClicar?: (dataIndex: number) => void
}

export function Chart({ option, altura = 280, className, aoClicar, ...rest }: ChartProps) {
  const ref = useRef<HTMLDivElement>(null)
  const inst = useRef<echarts.ECharts | null>(null)

  /**
   * O callback vive numa ref, e não nas dependências do efeito de init.
   *
   * O efeito que cria a instância roda UMA vez (deps `[]`) — é ele que registra
   * o `on('click')`. Se o handler entrasse ali direto, ele congelaria na
   * primeira renderização e passaria a clicar com `searchParams` velho: o
   * segundo clique desfaria o primeiro em vez de somar. Pôr `aoClicar` nas deps
   * resolveria o congelamento e criaria outro problema — recriar o gráfico a
   * cada render, perdendo zoom, hover e animação.
   */
  const aoClicarRef = useRef(aoClicar)
  aoClicarRef.current = aoClicar

  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current, undefined, { renderer: 'canvas' })
    inst.current = chart

    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(ref.current)

    /*
     * ⚠️ ISTO NÃO RECOLORE NADA — só redimensiona.
     *
     * O comentário antigo aqui dizia "recria a option", e o corpo chamava
     * `resize()`. A promessa estava no comentário e não no código: trocar de
     * tema deixava todo gráfico pintado com as cores do tema anterior até um
     * refetch reconstruí-lo por outro motivo. Reportado em 19/10/2026 —
     * gradeado preto sobre fundo branco num lado, linha invisível no outro.
     *
     * Quem recolore é `useTemaAtual()` (lib/useTema.ts), chamado por cada
     * gráfico e declarado nas dependências do memo que monta a `option`. A
     * dependência fica EXPLÍCITA onde ela existe, em vez de virar efeito
     * colateral invisível aqui dentro.
     *
     * O observer continua porque a troca de tema pode mexer em fonte e
     * espaçamento, e aí o canvas precisa remedir.
     */
    const mo = new MutationObserver(() => chart.resize())
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    chart.on('click', (p) => {
      const i = (p as { dataIndex?: number }).dataIndex
      if (typeof i === 'number') aoClicarRef.current?.(i)
    })

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
      style={{ height: altura, width: '100%', cursor: aoClicar ? 'pointer' : undefined }}
      {...rest}
    />
  )
}
