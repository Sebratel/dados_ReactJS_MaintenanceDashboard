'use client'

import { useMemo } from 'react'
import { Chart } from './Chart'
import { lerTokens, MARCA, baseEixoCategoria, baseEixoValor, baseGrid, baseTooltip } from '@/lib/tema'
import { fmtFracaoPct, fmtHoras, fmtInt } from '@/lib/formato'
import type { ItemRanking } from '@/server/indicadores/ranking'

/**
 * Ranking horizontal por dimensão.
 *
 * Categórico NOMINAL (cidade, equipe, catálogo… trocar a ordem não muda o
 * significado) → uma série, todas as barras no slot 1. Nunca colorir a barra
 * pelo próprio valor: isso gastaria o canal de identidade re-codificando o que
 * o comprimento já mostra.
 *
 * Rótulo direto em toda barra — poucas categorias, e é o canal de alívio do
 * WARN de contraste.
 */
export function RankingBarras({
  dados,
  altura,
  onSelecionar,
  /**
   * `ordinal` = a dimensão tem ordem natural (turno, dia da semana). Nesse caso
   * a barra recebe uma rampa de UM hue, para o leitor ver a ordem na cor, e a
   * sequência de entrada é preservada.
   */
  escala = 'nominal',
}: {
  dados: ItemRanking[]
  altura?: number
  onSelecionar?: (rotulo: string) => void
  escala?: 'nominal' | 'ordinal'
}) {
  const option = useMemo(() => {
    const tk = lerTokens()
    // ECharts desenha o eixo Y de baixo para cima; inverte para o primeiro no topo
    const ordenado = [...dados].reverse()

    // rampa ordinal: interpola os 3 steps validados (--ord-1..3) para N barras
    const corOrdinal = (iOriginal: number, n: number) => {
      if (n <= 1) return tk.ord[1]!
      const t = iOriginal / (n - 1)
      const idx = Math.round(t * (tk.ord.length - 1))
      return tk.ord[idx] ?? tk.ord[1]!
    }

    return {
      // rótulos longos (ex: TEC-MANUT-ACESSO-CLI-INCIDENTE/PROBLEMA) ficam
      // indistinguíveis se truncados curto — o eixo cresce com o texto
      grid: baseGrid(tk, { left: 4, right: 52, top: 4, bottom: 4 }),
      tooltip: baseTooltip(tk, {
        trigger: 'item',
        formatter: (p: { dataIndex: number }) => {
          const d = ordenado[p.dataIndex]
          if (!d) return ''
          return `<b>${d.rotulo}</b><br/>
            Protocolos <b>${fmtInt(d.protocolos)}</b> (${fmtFracaoPct(d.share, 1)} do total)<br/>
            Encerrados <b>${fmtInt(d.encerrados)}</b><br/>
            MTTR médio <b>${fmtHoras(d.mttrHoras)}</b>`
        },
      }),
      xAxis: baseEixoValor(tk, { splitLine: { show: false } }),
      yAxis: baseEixoCategoria(tk, {
        data: ordenado.map((d) => d.rotulo),
        axisLine: { show: false },
        axisLabel: {
          color: tk.textSecondary,
          fontSize: 11,
          width: Math.min(
            280,
            Math.max(90, Math.ceil(7.8 * Math.max(...ordenado.map((d) => d.rotulo.length), 8)) + 10)
          ),
          overflow: 'truncate',
        },
      }),
      series: [
        {
          type: 'bar',
          data: ordenado.map((d, i) => ({
            value: d.protocolos,
            itemStyle: {
              color:
                escala === 'ordinal'
                  ? // i está na ordem invertida; reconverte para a ordem original
                    corOrdinal(ordenado.length - 1 - i, ordenado.length)
                  : tk.series[0],
              borderRadius: MARCA.barraDireita4px,
            },
          })),
          barMaxWidth: 16,
          // vão de 2px na cor da superfície entre barras adjacentes
          barCategoryGap: '38%',
          label: {
            show: true,
            position: 'right' as const,
            formatter: (p: { value: number }) => fmtInt(p.value),
            color: tk.textSecondary,
            fontSize: 11,
            fontWeight: 600 as const,
          },
          cursor: onSelecionar ? 'pointer' : 'default',
        },
      ],
    }
  }, [dados, onSelecionar, escala])

  const h = altura ?? Math.max(160, dados.length * 26 + 24)
  return <Chart option={option} altura={h} aria-label="Ranking de protocolos por dimensão" />
}
