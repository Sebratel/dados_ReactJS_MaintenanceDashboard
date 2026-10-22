'use client'

import { useMemo } from 'react'
import { Chart } from './Chart'
import { lerTokens, MARCA, baseEixoCategoria, baseEixoValor, baseGrid, baseTooltip } from '@/lib/tema'
import { fmtDiaSemana, fmtInt } from '@/lib/formato'
import type { PontoAvaliacao } from '@/lib/previsao'

/**
 * O que a tela teria dito com uma semana de antecedência × o que aconteceu,
 * nas 8 semanas da avaliação.
 *
 * A faixa é uma área empilhada (base invisível + largura), e por isso aqui ela
 * é contínua, ao contrário do bigode da previsão: são 56 dias seguidos, e o que
 * se lê é o realizado escapando da faixa — os pontos vermelhos.
 */
export function PrevistoRealizado({ pontos }: { pontos: PontoAvaliacao[] }) {
  const option = useMemo(() => {
    const tk = lerTokens()
    const fora = (p: PontoAvaliacao) => p.real < p.min || p.real > p.max
    return {
      grid: baseGrid(tk, { top: 26 }),
      tooltip: baseTooltip(tk, {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: tk.axis, width: 1 } },
        formatter: (ps: { dataIndex: number }[]) => {
          const p = pontos[ps[0]?.dataIndex ?? 0]
          if (!p) return ''
          const veredito = fora(p)
            ? `<b style="color:${tk.statusCritical}">fora da faixa</b>`
            : `<span style="color:${tk.textMuted}">dentro da faixa</span>`
          return `<b>${fmtDiaSemana(p.dia)}</b>
            <br/>Realizado: <b>${fmtInt(p.real)}</b>
            <br/>Previsto 7 dias antes: ${fmtInt(p.previsto)} (faixa ${fmtInt(p.min)} a ${fmtInt(p.max)})
            <br/>${veredito}`
        },
      }),
      legend: {
        top: 0,
        right: 0,
        itemWidth: 10,
        itemHeight: 10,
        itemGap: 14,
        icon: 'roundRect',
        textStyle: { color: tk.textSecondary, fontSize: 11 },
        data: ['Realizado', 'Previsto 7 dias antes', 'Faixa provável'],
      },
      xAxis: baseEixoCategoria(tk, {
        data: pontos.map((p) => p.dia),
        boundaryGap: false,
        axisLabel: { color: tk.textMuted, fontSize: 11, hideOverlap: true, formatter: (d: string) => fmtDiaSemana(d) },
      }),
      yAxis: baseEixoValor(tk, { minInterval: 1 }),
      series: [
        {
          name: 'base da faixa',
          type: 'line',
          stack: 'faixa',
          data: pontos.map((p) => p.min),
          symbol: 'none',
          lineStyle: { opacity: 0 },
          silent: true,
          tooltip: { show: false },
        },
        {
          name: 'Faixa provável',
          type: 'line',
          stack: 'faixa',
          color: tk.serieClara,
          data: pontos.map((p) => p.max - p.min),
          symbol: 'none',
          lineStyle: { opacity: 0 },
          areaStyle: { color: tk.serieClara, opacity: 0.7 },
          silent: true,
        },
        {
          name: 'Previsto 7 dias antes',
          type: 'line',
          color: tk.series[0],
          data: pontos.map((p) => p.previsto),
          symbol: 'none',
          lineStyle: { width: MARCA.larguraLinha, color: tk.series[0], type: 'dashed' },
        },
        {
          name: 'Realizado',
          type: 'line',
          color: tk.series[2],
          data: pontos.map((p) => p.real),
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { width: MARCA.larguraLinha, color: tk.series[2] },
          itemStyle: {
            color: (x: { dataIndex: number }) => {
              const p = pontos[x.dataIndex]
              return p && fora(p) ? tk.statusCritical : tk.series[2]
            },
            borderColor: tk.surface,
            borderWidth: 1,
          },
        },
      ],
    }
  }, [pontos])

  return <Chart option={option} aria-label="Reparos realizados contra o previsto uma semana antes, com a faixa provável" />
}
