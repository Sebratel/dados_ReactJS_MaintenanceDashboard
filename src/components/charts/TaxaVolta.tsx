'use client'

import { useMemo } from 'react'
import { Chart } from './Chart'
import { lerTokens, MARCA, baseEixoCategoria, baseEixoValor, baseGrid, baseTooltip } from '@/lib/tema'
import { fmtFracaoPct, fmtInt } from '@/lib/formato'
import type { ClasseRecencia, ClasseVolta } from '@/lib/previsao'

const RECENCIAS: { id: ClasseRecencia; rotulo: string }[] = [
  { id: '0–7', rotulo: 'último há até 7 dias' },
  { id: '8–30', rotulo: 'há 8 a 30 dias' },
  { id: '31–90', rotulo: 'há 31 a 90 dias' },
]

/**
 * Chance de voltar a abrir reparo em 30 dias, por quantos reparos o login teve
 * em 90 dias (grupo) e há quanto tempo foi o último (cor).
 *
 * Três séries na ordem fixa de identidade (dourado → laranja → grafite), com
 * legenda — dourado e laranja são o par mais próximo da paleta, então a cor
 * nunca carrega a identidade sozinha. O número de observações vai no tooltip:
 * com 3+ reparos as classes têm poucas centenas de casos, e é isso que explica
 * por que elas oscilam sem ordem.
 */
export function TaxaVolta({ classes }: { classes: ClasseVolta[] }) {
  const option = useMemo(() => {
    const tk = lerTokens()
    const grupos = ['1', '2', '3+'] as const
    const achar = (g: string, r: string) => classes.find((c) => c.reparos === g && c.recencia === r)
    return {
      grid: baseGrid(tk, { top: 26 }),
      tooltip: baseTooltip(tk, {
        trigger: 'item',
        formatter: (p: { seriesIndex: number; dataIndex: number }) => {
          const c = achar(grupos[p.dataIndex]!, RECENCIAS[p.seriesIndex]!.id)
          if (!c) return ''
          return `<b>${c.reparos} reparo(s) em 90 dias</b>, ${RECENCIAS[p.seriesIndex]!.rotulo}
            <br/>Voltaram em 30 dias: <b>${fmtFracaoPct(c.taxa, 1)}</b>
            <br/><span style="color:${tk.textMuted}">${fmtInt(c.voltaram)} de ${fmtInt(c.observados)} observados</span>`
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
      },
      xAxis: baseEixoCategoria(tk, {
        data: grupos.map((g) => `${g} reparo${g === '1' ? '' : 's'} em 90 dias`),
      }),
      yAxis: baseEixoValor(tk, {
        axisLabel: { color: tk.textMuted, fontSize: 11, formatter: (v: number) => fmtFracaoPct(v, 0) },
      }),
      series: RECENCIAS.map((r, i) => ({
        name: r.rotulo,
        type: 'bar',
        barMaxWidth: 34,
        barGap: '8%',
        data: grupos.map((g) => achar(g, r.id)?.taxa ?? null),
        itemStyle: { color: tk.series[i], borderRadius: MARCA.barraTopo4px },
        label: {
          show: true,
          position: 'top',
          fontSize: 10,
          color: tk.textSecondary,
          formatter: (p: { value: number | null }) => (p.value === null ? '' : fmtFracaoPct(p.value, 1)),
        },
      })),
    }
  }, [classes])

  return <Chart option={option} aria-label="Chance de um login voltar a abrir reparo em 30 dias, por classe" />
}
