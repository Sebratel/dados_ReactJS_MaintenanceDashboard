'use client'

import { useMemo } from 'react'
import { Chart } from './Chart'
import { lerTokens, MARCA, baseEixoCategoria, baseEixoValor, baseGrid, baseTooltip } from '@/lib/tema'
import { fmtFracaoPct } from '@/lib/formato'

export type AbertoNaCurva = { protocolo: string; idadeH: number; risco: number; agendaTarde: boolean }

/**
 * A chance de um reparo passar de 48h conforme a idade dele agora.
 *
 * É a regra que a tabela ao lado aplica, desenhada: a curva fica rasteira nas
 * primeiras 12 horas e sobe depois de 24h, quando quem ainda está aberto é,
 * cada vez mais, o caso difícil. Os pontos marcam os abertos de agora, um
 * ponto por HORA de idade (dois abertos com 47h dividem o ponto).
 *
 * CLICAR NUM PONTO FILTRA A TABELA para os abertos daquela hora (pedido da
 * Manutenção em 30/10/2026); clicar de novo, ou no "✕" da tabela, desfaz.
 *
 * ⚠️ O PONTO FICA NA CURVA, MAS A CHANCE DO PROTOCOLO PODE SER OUTRA: quem tem
 * visita agendada depois das 48h é 100% na tabela, seja qual for a idade. O
 * tooltip lista cada protocolo com a chance que a tabela mostra.
 */
export function CurvaFechamento({
  passa,
  abertos,
  horaSelecionada = null,
  aoSelecionarHora,
}: {
  passa: number[]
  abertos: AbertoNaCurva[]
  horaSelecionada?: number | null
  aoSelecionarHora?: (hora: number | null) => void
}) {
  const porHora = useMemo(() => {
    const m = new Map<number, AbertoNaCurva[]>()
    for (const a of abertos) {
      const h = Math.floor(a.idadeH)
      if (h < 0 || h >= passa.length) continue
      const v = m.get(h)
      if (v) v.push(a)
      else m.set(h, [a])
    }
    return m
  }, [abertos, passa.length])
  const horas = useMemo(() => [...porHora.keys()].sort((x, y) => x - y), [porHora])

  const option = useMemo(() => {
    const tk = lerTokens()
    return {
      grid: baseGrid(tk, { top: 26, bottom: 18 }),
      tooltip: baseTooltip(tk, {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: tk.axis, width: 1 } },
        formatter: (ps: { dataIndex: number; seriesIndex: number }[]) => {
          const p0 = ps.find((p) => p.seriesIndex === 0) ?? ps[0]
          const h = p0?.dataIndex ?? 0
          const lista = (porHora.get(h) ?? [])
            .map(
              (a) =>
                `${a.protocolo} · ${fmtFracaoPct(a.risco, 0)}${a.agendaTarde ? ' (visita depois das 48h)' : ''}`
            )
            .join('<br/>')
          const agora = lista ? `<br/><br/>Abertos com essa idade agora:<br/>${lista}<br/><i>clique para ver na tabela</i>` : ''
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
        },
        {
          // série própria (era markPoint) para o clique devolver qual ponto foi
          name: 'Abertos agora',
          type: 'scatter',
          data: horas.map((h) => {
            const sel = horaSelecionada === h
            const apagado = horaSelecionada !== null && !sel
            return {
              value: [h, passa[h]],
              symbolSize: sel ? 16 : 10,
              itemStyle: {
                color: tk.brand,
                opacity: apagado ? 0.35 : 1,
                borderColor: sel ? tk.textPrimary : tk.surface,
                borderWidth: 2,
              },
            }
          }),
          cursor: 'pointer',
          z: 3,
        },
      ],
    }
  }, [passa, porHora, horas, horaSelecionada])

  return (
    <Chart
      option={option}
      aria-label="Chance de um reparo aberto passar de 48 horas, por idade"
      aoClicar={
        aoSelecionarHora
          ? (i, serie) => {
              // a linha devolve a hora; o ponto devolve a posição em `horas`
              const h = serie === 1 ? horas[i] : i
              if (h === undefined || !porHora.has(h)) return
              aoSelecionarHora(h === horaSelecionada ? null : h)
            }
          : undefined
      }
    />
  )
}
