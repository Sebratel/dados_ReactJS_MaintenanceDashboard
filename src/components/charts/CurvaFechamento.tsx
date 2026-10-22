'use client'

import { useMemo } from 'react'
import { Chart } from './Chart'
import { lerTokens, MARCA, baseEixoCategoria, baseEixoValor, baseGrid, baseTooltip } from '@/lib/tema'
import { fmtFracaoPct, fmtInt } from '@/lib/formato'

/**
 * A chance de um reparo passar de 48h conforme a idade dele agora.
 *
 * É a regra que a tabela ao lado aplica, desenhada: a curva fica rasteira nas
 * primeiras 12 horas e sobe depois de 24h, quando quem ainda está aberto é,
 * cada vez mais, o caso difícil. Os pontos marcam quantos dos abertos de agora
 * estão em cada idade — é ali que a curva importa hoje.
 */
export function CurvaFechamento({ passa, idadesAbertos }: { passa: number[]; idadesAbertos: number[] }) {
  const option = useMemo(() => {
    const tk = lerTokens()
    const porHora = new Map<number, number>()
    for (const h of idadesAbertos) {
      if (h < passa.length) porHora.set(Math.floor(h), (porHora.get(Math.floor(h)) ?? 0) + 1)
    }
    return {
      grid: baseGrid(tk, { top: 26, bottom: 18 }),
      tooltip: baseTooltip(tk, {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: tk.axis, width: 1 } },
        formatter: (ps: { dataIndex: number }[]) => {
          const h = ps[0]?.dataIndex ?? 0
          const n = porHora.get(h) ?? 0
          const agora = n ? `<br/>${fmtInt(n)} aberto(s) com essa idade agora` : ''
          return `Aberto há <b>${h}h</b><br/>Chance de passar de 48h: <b>${fmtFracaoPct(passa[h], 1)}</b>${agora}`
        },
      }),
      xAxis: baseEixoCategoria(tk, {
        data: passa.map((_, h) => h),
        name: 'horas aberto',
        nameLocation: 'middle',
        nameGap: 22,
        nameTextStyle: { color: tk.textMuted, fontSize: 10 },
        axisLabel: { color: tk.textMuted, fontSize: 11, interval: 5, formatter: (h: number) => `${h}h` },
      }),
      yAxis: baseEixoValor(tk, {
        max: 1,
        axisLabel: { color: tk.textMuted, fontSize: 11, formatter: (v: number) => fmtFracaoPct(v, 0) },
      }),
      series: [
        {
          name: 'Chance de passar de 48h',
          type: 'line',
          data: passa,
          symbol: 'none',
          smooth: false,
          lineStyle: { width: MARCA.larguraLinha, color: tk.series[2] },
          areaStyle: { color: `${tk.series[0]}33` },
          markPoint: {
            symbol: 'circle',
            symbolSize: 10,
            itemStyle: { color: tk.brand, borderColor: tk.surface, borderWidth: 2 },
            label: { show: false },
            data: [...porHora.keys()].map((h) => ({ coord: [h, passa[h]], value: porHora.get(h) })),
          },
        },
      ],
    }
  }, [passa, idadesAbertos])

  return <Chart option={option} aria-label="Chance de um reparo aberto passar de 48 horas, por idade" />
}
