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
  gradienteColuna,
  rotuloValor,
} from '@/lib/tema'
import { fmtDiaSemana, fmtInt } from '@/lib/formato'
import type { PontoPrevisao } from '@/lib/previsao'

type ApiCustom = {
  value: (dim: number) => number
  coord: (v: number[]) => number[]
  size: (v: number[]) => number[]
}

/**
 * Entrada diária de reparo: as 4 últimas semanas realizadas e as 2 próximas
 * previstas, com a faixa provável de cada dia.
 *
 * A COLUNA PREVISTA É O MESMO DOURADO, CLARO E CONTORNADO — é a mesma medida,
 * só que ainda não aconteceu. Uma cor nova faria parecer outra grandeza. A
 * legenda diz qual é qual, e a linha "hoje" separa os dois trechos.
 *
 * A FAIXA É UM BIGODE, não uma área: cada dia é uma previsão independente, e
 * uma área contínua sugeriria que o meio da noite entre dois dias tem valor.
 */
export function PrevisaoDiaria({
  recentes,
  previsao,
  entradaHoje,
}: {
  recentes: { dia: string; reparos: number }[]
  previsao: PontoPrevisao[]
  entradaHoje: number | null
}) {
  const option = useMemo(() => {
    const tk = lerTokens()
    const dias = [...recentes.map((r) => r.dia), ...previsao.map((p) => p.dia)]
    const iHoje = recentes.length
    const porDia = new Map(previsao.map((p) => [p.dia, p]))

    const renderBigode = (_: unknown, api: ApiCustom) => {
      const x = api.value(0)
      const baixo = api.coord([x, api.value(1)])
      const alto = api.coord([x, api.value(2)])
      const meia = api.size([1, 0])[0]! * 0.18
      const estilo = { stroke: tk.textPrimary, lineWidth: 1.5 }
      return {
        type: 'group',
        children: [
          { type: 'line', shape: { x1: baixo[0], y1: baixo[1], x2: alto[0], y2: alto[1] }, style: estilo },
          { type: 'line', shape: { x1: baixo[0]! - meia, y1: baixo[1], x2: baixo[0]! + meia, y2: baixo[1] }, style: estilo },
          { type: 'line', shape: { x1: alto[0]! - meia, y1: alto[1], x2: alto[0]! + meia, y2: alto[1] }, style: estilo },
        ],
      }
    }

    return {
      grid: baseGrid(tk, { top: 26 }),
      tooltip: baseTooltip(tk, {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: `${tk.gridline}66` } },
        formatter: (ps: { dataIndex: number }[]) => {
          const i = ps[0]?.dataIndex ?? 0
          const dia = dias[i]
          if (!dia) return ''
          const p = porDia.get(dia)
          if (!p) {
            return `<b>${fmtDiaSemana(dia)}</b><br/>Entraram <b>${fmtInt(recentes[i]?.reparos)}</b> reparos`
          }
          const feriado = p.feriado
            ? `<br/><span style="color:${tk.textMuted}">${p.feriado} — previsto como sábado</span>`
            : ''
          const hoje =
            i === iHoje && entradaHoje !== null
              ? `<br/><span style="color:${tk.textMuted}">já entraram ${fmtInt(entradaHoje)} até agora</span>`
              : ''
          return `<b>${fmtDiaSemana(dia)}</b>${feriado}<br/>Previsto <b>${fmtInt(p.previsto)}</b> reparos<br/>Faixa provável ${fmtInt(p.min)} a ${fmtInt(p.max)}${hoje}`
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
        data: ['Realizado', 'Previsto', 'Faixa provável (8 em 10 dias)'],
      },
      xAxis: baseEixoCategoria(tk, {
        data: dias,
        axisLabel: {
          color: tk.textMuted,
          fontSize: 11,
          hideOverlap: true,
          formatter: (d: string) => fmtDiaSemana(d),
        },
      }),
      yAxis: baseEixoValor(tk, { minInterval: 1 }),
      series: [
        {
          name: 'Realizado',
          type: 'bar',
          data: dias.map((_, i) => (i < iHoje ? recentes[i]!.reparos : null)),
          barMaxWidth: 22,
          barGap: '-100%',
          itemStyle: { color: gradienteColuna(tk), borderRadius: MARCA.barraTopo4px },
          ...rotuloValor({
            n: dias.length,
            formatter: (p) => (p.value === null ? '' : fmtInt(p.value)),
            cor: tk.textPrimary,
            position: 'insideTop',
          }),
          markLine: {
            silent: true,
            symbol: 'none',
            data: [{ xAxis: iHoje }],
            lineStyle: { color: tk.textMuted, type: 'dashed', width: 1 },
            // 'end' deixa o texto na horizontal, em cima da linha; os 'inside*'
            // giram o rótulo junto com uma linha vertical
            label: { show: true, position: 'end', formatter: 'hoje', color: tk.textMuted, fontSize: 10 },
          },
        },
        {
          name: 'Previsto',
          type: 'bar',
          data: dias.map((d) => porDia.get(d)?.previsto ?? null),
          barMaxWidth: 22,
          itemStyle: {
            color: tk.serieClara,
            borderColor: tk.series[0],
            borderWidth: 1,
            borderRadius: MARCA.barraTopo4px,
          },
          // NO MEIO da coluna, não no topo: o bigode da faixa sobe do mínimo
          // (~3/4 do previsto) e cruzaria um rótulo 'insideTop'. A metade da
          // coluna fica sempre abaixo do mínimo da faixa.
          // COR APAGADA, e não a preta do realizado: pedido da Manutenção em
          // 29/10/2026 — número que ainda não aconteceu não pode ter o mesmo
          // peso de número que aconteceu, igual à coluna clara.
          ...rotuloValor({
            n: dias.length,
            formatter: (p) => (p.value === null ? '' : fmtInt(p.value)),
            cor: tk.textMuted,
            position: 'inside',
          }),
        },
        {
          name: 'Faixa provável (8 em 10 dias)',
          type: 'custom',
          renderItem: renderBigode,
          itemStyle: { color: tk.textPrimary },
          encode: { x: 0, y: [1, 2] },
          data: previsao.map((p) => [dias.indexOf(p.dia), p.min, p.max]),
          z: 3,
        },
      ],
    }
  }, [recentes, previsao, entradaHoje])

  return (
    <Chart
      option={option}
      aria-label="Reparos por dia: quatro semanas realizadas e duas previstas, com faixa provável"
    />
  )
}
