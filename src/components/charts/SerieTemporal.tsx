'use client'

import { useMemo } from 'react'
import { Chart } from './Chart'
import { lerTokens, MARCA, baseEixoCategoria, baseEixoValor, baseGrid, baseTooltip } from '@/lib/tema'
import { fmtInt, fmtPeriodo } from '@/lib/formato'
import type { PontoSerie } from '@/server/indicadores/serie'
import type { Granularidade } from '@/lib/filtros'

/**
 * Fluxo de entrada (criados) × saída (encerrados) no tempo.
 *
 * Duas séries de MESMA unidade (protocolos) → um só eixo de valor. O MTTR NÃO
 * entra aqui: unidade diferente exigiria segundo eixo, e eixo duplo é proibido
 * pelo guia de dataviz. Ele vive no gráfico ao lado, compartilhando o eixo X.
 *
 * Rótulo direto apenas no ÚLTIMO ponto de cada série — nunca em todo ponto.
 * O tooltip mostra o saldo (entrada − saída), que é a leitura de backlog.
 */
export function SerieTemporal({
  dados,
  granularidade,
  altura = 260,
  comZoom = false,
}: {
  dados: PontoSerie[]
  granularidade: Granularidade
  altura?: number
  comZoom?: boolean
}) {
  const option = useMemo(() => {
    const tk = lerTokens()
    const rotulos = dados.map((d) => fmtPeriodo(d.periodo, granularidade))
    /**
     * O último ponto COM MEDIDA, e não o último do array.
     *
     * O rótulo impresso no fim da linha existe para dizer em quanto ela
     * terminou. Desde 15/09/2026 (item D) período futuro vem `null`, e apontar
     * para o fim do array escreveria o rótulo sobre o dia 30 de um mês que está
     * no dia 15 — ou nada, dependendo de como o ECharts trata o nulo. Nos dois
     * casos o número deixa de aparecer onde a linha realmente para.
     */
    const ultimo = dados.reduce(
      (acc, d, i) => (d.abertos === null && d.encerrados === null ? acc : i),
      -1
    )

    const rotuloFinal = (cor: string) => ({
      show: true,
      position: 'top' as const,
      formatter: (p: { dataIndex: number; value: number }) =>
        p.dataIndex === ultimo ? fmtInt(p.value) : '',
      color: tk.textSecondary,
      fontSize: 11,
      fontWeight: 600 as const,
      backgroundColor: tk.surface,
      padding: [2, 3],
      borderRadius: 3,
    })

    return {
      grid: baseGrid(tk, { bottom: comZoom ? 34 : 4, top: 22 }),
      tooltip: baseTooltip(tk, {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: tk.axis, width: 1, type: 'solid' } },
        formatter: (ps: { dataIndex: number; seriesName: string; value: number; color: string }[]) => {
          const i = ps[0]?.dataIndex ?? 0
          const d = dados[i]
          if (!d) return ''

          // Com trigger 'axis' o tooltip abre mesmo onde não há ponto. Sem
          // isto, passar o mouse pela parte vazia do mês mostrava
          // "Criados —  Encerrados —", que parece dado faltando e não futuro.
          if (d.abertos === null && d.encerrados === null) {
            return `<b>${fmtPeriodo(d.periodo, granularidade)}</b><br/><span style="color:${tk.textMuted}">ainda não aconteceu</span>`
          }

          const linhas = ps
            .map(
              (p) =>
                `<div style="display:flex;align-items:center;gap:6px;margin-top:3px">
                   <span style="width:8px;height:8px;border-radius:2px;background:${p.color}"></span>
                   <span style="color:${tk.textSecondary}">${p.seriesName}</span>
                   <b style="margin-left:auto">${fmtInt(p.value)}</b>
                 </div>`
            )
            .join('')
          // Período futuro não tem saldo — a linha inteira sai do tooltip em
          // vez de mostrar "= 0", que afirmaria equilíbrio onde não há medida.
          const saldo =
            d.saldo === null
              ? ''
              : (() => {
                  const cor =
                    d.saldo > 0 ? tk.statusCritical : d.saldo < 0 ? tk.statusGood : tk.textMuted
                  const seta = d.saldo > 0 ? '▲' : d.saldo < 0 ? '▼' : '='
                  return `<div style="display:flex;gap:6px;margin-top:5px;padding-top:4px;border-top:1px solid ${tk.gridline}">
              <span style="color:${tk.textSecondary}">Saldo do backlog</span>
              <b style="margin-left:auto;color:${cor}">${seta} ${d.saldo > 0 ? '+' : ''}${fmtInt(d.saldo)}</b>
            </div>`
                })()
          return `<b>${fmtPeriodo(d.periodo, granularidade)}</b>${linhas}${saldo}`
        },
      }),
      legend: {
        show: true,
        top: 0,
        right: 0,
        itemWidth: 10,
        itemHeight: 10,
        itemGap: 14,
        icon: 'roundRect',
        textStyle: { color: tk.textSecondary, fontSize: 11 },
      },
      xAxis: baseEixoCategoria(tk, {
        data: rotulos,
        boundaryGap: false,
        axisLabel: {
          color: tk.textMuted,
          fontSize: 11,
          // com muitos pontos o ECharts já rareia; aqui garantimos legibilidade
          hideOverlap: true,
        },
      }),
      yAxis: baseEixoValor(tk, { minInterval: 1 }),
      dataZoom: comZoom
        ? [
            { type: 'inside', throttle: 60 },
            {
              type: 'slider',
              height: 18,
              bottom: 4,
              borderColor: 'transparent',
              backgroundColor: tk.gridline,
              fillerColor: `${tk.series[0]}22`,
              handleStyle: { color: tk.series[0] },
              dataBackground: {
                lineStyle: { color: tk.axis },
                areaStyle: { color: tk.gridline },
              },
              textStyle: { color: tk.textMuted, fontSize: 10 },
            },
          ]
        : undefined,
      series: [
        {
          name: 'Criados',
          type: 'line',
          data: dados.map((d) => d.abertos),
          // explícito porque é carga: período futuro vem null (item D) e a linha
          // precisa PARAR ali, não saltar por cima do vazio até o fim do mês.
          connectNulls: false,
          smooth: false,
          symbol: 'circle',
          symbolSize: MARCA.tamanhoMarcador,
          showSymbol: dados.length <= 40,
          lineStyle: { width: MARCA.larguraLinha, color: tk.series[0] },
          itemStyle: { color: tk.series[0], borderColor: tk.surface, borderWidth: 2 },
          label: rotuloFinal(tk.series[0]!),
          emphasis: { focus: 'series' as const },
        },
        {
          name: 'Encerrados',
          type: 'line',
          data: dados.map((d) => d.encerrados),
          connectNulls: false,
          smooth: false,
          symbol: 'circle',
          symbolSize: MARCA.tamanhoMarcador,
          showSymbol: dados.length <= 40,
          lineStyle: { width: MARCA.larguraLinha, color: tk.series[2] },
          itemStyle: { color: tk.series[2], borderColor: tk.surface, borderWidth: 2 },
          label: rotuloFinal(tk.series[2]!),
          emphasis: { focus: 'series' as const },
        },
      ],
    }
  }, [dados, granularidade, comZoom])

  return <Chart option={option} altura={altura} aria-label="Protocolos abertos e encerrados ao longo do tempo" />
}
