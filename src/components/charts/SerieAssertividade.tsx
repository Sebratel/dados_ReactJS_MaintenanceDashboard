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
  rotuloValor,
} from '@/lib/tema'
import { useTemaAtual } from '@/lib/useTema'
import { fmtDiaCurto, fmtFracaoPct, fmtInt } from '@/lib/formato'
import type { PontoProdutividadeDia } from '@/server/indicadores/produtividade'

/**
 * Assertividade de campo por dia — painel irmão do de composição.
 *
 * Existe separado, e não como segundo eixo Y no gráfico de barras, porque taxa
 * (%) e contagem (visitas) não compartilham escala: no eixo duplo o cruzamento
 * das duas curvas vira artefato da escala escolhida, não fato do dado.
 * Empilhados verticalmente, os dois painéis compartilham o eixo X e a
 * comparação continua direta.
 *
 * A linha de referência é a média do período — sem meta formal de assertividade
 * documentada no modelo Power BI, é o único comparador honesto disponível.
 */
export function SerieAssertividade({
  dados,
  altura = 170,
}: {
  dados: PontoProdutividadeDia[]
  altura?: number
}) {
  // o memo abaixo lê as variáveis CSS do tema — ver useTema.ts
  const tema = useTemaAtual()

  const option = useMemo(() => {
    const tk = lerTokens()

    const comValor = dados.filter((d) => d.assertividadeCampo !== null)
    const media =
      comValor.length > 0
        ? comValor.reduce((s, d) => s + (d.assertividadeCampo ?? 0), 0) / comValor.length
        : null

    // escala apertada no intervalo observado: começar em 0 num indicador que
    // vive entre 85% e 100% achataria toda a variação que interessa
    const valores = comValor.map((d) => d.assertividadeCampo ?? 0)
    const min = valores.length ? Math.min(...valores) : 0
    const piso = Math.max(0, Math.floor((min - 0.05) * 20) / 20)

    return {
      grid: baseGrid(tk, { top: 14 }),
      tooltip: baseTooltip(tk, {
        trigger: 'axis',
        formatter: (ps: { dataIndex: number }[]) => {
          const d = dados[ps[0]?.dataIndex ?? 0]
          if (!d) return ''
          return `<b>${fmtDiaCurto(d.dia)}</b><br/>
            Assertividade de campo <b>${fmtFracaoPct(d.assertividadeCampo, 1)}</b><br/>
            <span style="color:${tk.textMuted}">
              ${fmtInt(d.produtivo)} produtivos de ${fmtInt(d.totalVisitasReais)} visitas reais
            </span>`
        },
      }),
      xAxis: baseEixoCategoria(tk, {
        data: dados.map((d) => fmtDiaCurto(d.dia)),
        axisLabel: { color: tk.textMuted, fontSize: 11, hideOverlap: true },
      }),
      yAxis: baseEixoValor(tk, {
        min: piso,
        max: 1,
        axisLabel: {
          color: tk.textMuted,
          fontSize: 11,
          formatter: (v: number) => fmtFracaoPct(v, 0),
        },
      }),
      series: [
        {
          name: 'Assertividade de campo',
          type: 'line',
          data: dados.map((d) => d.assertividadeCampo),
          // dia sem visita real não vira zero: vira lacuna. Zero afirmaria
          // "nenhum reparo deu certo", o que é diferente de "não houve visita".
          connectNulls: false,
          smooth: false,
          symbol: 'circle',
          symbolSize: MARCA.tamanhoMarcador,
          showSymbol: dados.length <= 40,
          lineStyle: { color: tk.series[0], width: MARCA.larguraLinha },
          itemStyle: { color: tk.series[0] },
          areaStyle: { color: `${tk.series[0]}14` },
          // Série única, mesma justificativa de SerieMttr. Sem casa decimal:
          // "96%" ocupa metade de "96,4%", e a variação que interessa no painel
          // é de pontos inteiros -- a decimal fica no tooltip.
          ...rotuloValor({
            n: dados.length,
            formatter: (p) => (p.value === null ? '' : fmtFracaoPct(p.value, 0)),
            cor: tk.textSecondary,
          }),
          markLine: media
            ? {
                silent: true,
                symbol: 'none',
                label: {
                  formatter: `média ${fmtFracaoPct(media, 1)}`,
                  position: 'insideEndTop' as const,
                  color: tk.textMuted,
                  fontSize: 10,
                },
                lineStyle: { color: tk.textMuted, type: 'dashed', width: 1 },
                data: [{ yAxis: media }],
              }
            : undefined,
        },
      ],
    }
  }, [dados, tema])

  return (
    <Chart
      option={option}
      altura={altura}
      aria-label="Assertividade de campo por dia, com a média do período"
    />
  )
}
