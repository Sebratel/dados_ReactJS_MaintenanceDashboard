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
} from '@/lib/tema'
import { fmtDiaSemana, fmtInt } from '@/lib/formato'
import type { DiaPlano } from '@/lib/previsao'

/**
 * O campo dá conta? Colunas = visitas que o time faz num dia típico como
 * aquele; linha = visitas de reparo que a entrada prevista vai pedir. O vão
 * entre as duas é o espaço para preventiva.
 *
 * As duas medidas são VISITAS, então dividem um eixo só. Técnicos ficam no
 * tooltip: em técnicos a pergunta seria a mesma com outro número, e um
 * segundo eixo é o que o padrão proíbe.
 *
 * O ponto da linha fica vermelho onde a demanda passa do ritmo típico — a cor
 * acompanha o rótulo "falta", nunca anda sozinha.
 */
export function PlanoCampo({ plano }: { plano: DiaPlano[] }) {
  const option = useMemo(() => {
    const tk = lerTokens()
    return {
      grid: baseGrid(tk, { top: 26 }),
      tooltip: baseTooltip(tk, {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: `${tk.gridline}66` } },
        formatter: (ps: { dataIndex: number }[]) => {
          const d = plano[ps[0]?.dataIndex ?? 0]
          if (!d) return ''
          const saldo =
            d.folga >= 0
              ? `Sobram <b>${fmtInt(d.folga)}</b> visitas para preventiva`
              : `<b style="color:${tk.statusCritical}">Faltam ${fmtInt(-d.folga)} visitas</b> no ritmo típico`
          const feriado = d.feriado ? `<br/><span style="color:${tk.textMuted}">${d.feriado} — ritmo de sábado</span>` : ''
          return `<b>${fmtDiaSemana(d.dia)}</b>${feriado}
            <br/>Reparos previstos: <b>${fmtInt(d.reparosPrevistos)}</b> → ${fmtInt(d.demanda)} visitas
            <br/>Ritmo típico: <b>${fmtInt(d.capacidade)}</b> visitas com ${fmtInt(d.tecnicosTipicos)} técnicos
            <br/>Técnicos só para o reparo: ${fmtInt(d.tecnicosParaReparo)}
            <br/>${saldo}`
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
        data: plano.map((d) => d.dia),
        axisLabel: { color: tk.textMuted, fontSize: 11, hideOverlap: true, formatter: (d: string) => fmtDiaSemana(d) },
      }),
      yAxis: baseEixoValor(tk, { minInterval: 1 }),
      series: [
        {
          name: 'Ritmo típico do campo (visitas)',
          type: 'bar',
          data: plano.map((d) => d.capacidade),
          barMaxWidth: 26,
          itemStyle: { color: gradienteColuna(tk), borderRadius: MARCA.barraTopo4px },
        },
        {
          name: 'Visitas de reparo previstas',
          type: 'line',
          // a cor da SÉRIE é o que a legenda pinta; a do ponto vem por função
          color: tk.series[2],
          data: plano.map((d) => d.demanda),
          symbol: 'circle',
          symbolSize: MARCA.tamanhoMarcador,
          lineStyle: { width: MARCA.larguraLinha, color: tk.series[2] },
          itemStyle: {
            color: (p: { dataIndex: number }) =>
              (plano[p.dataIndex]?.folga ?? 0) < 0 ? tk.statusCritical : tk.series[2],
            borderColor: tk.surface,
            borderWidth: 2,
          },
          label: {
            show: true,
            position: 'top',
            fontSize: 10,
            color: tk.textSecondary,
            formatter: (p: { dataIndex: number }) => {
              const f = plano[p.dataIndex]?.folga ?? 0
              return f < 0 ? `falta ${fmtInt(-f)}` : ''
            },
          },
          labelLayout: { hideOverlap: true },
        },
      ],
    }
  }, [plano])

  return <Chart option={option} aria-label="Ritmo típico do campo contra as visitas de reparo previstas, por dia" />
}
