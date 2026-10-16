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
} from '@/lib/tema'
import { fmtFracaoPct, fmtInt } from '@/lib/formato'

export type ItemComposto = {
  rotulo: string
  produtivo: number
  improdutivo: number
  semAcao: number
  totalVisitas: number
  assertividadeCampo: number | null
}

/**
 * Ranking horizontal empilhado por desfecho.
 *
 * Mostra volume E mix numa marca só. A alternativa — um gráfico de volume ao
 * lado de um de assertividade — obrigaria o leitor a cruzar duas listas
 * ordenadas de formas diferentes para responder "quem produz muito mas erra
 * muito?".
 *
 * Cor é status (bom → ruim), igual ao painel diário, de propósito: o leitor
 * aprende a leitura uma vez e ela vale na página inteira.
 *
 * O rótulo direto fica à direita da barra e mostra a ASSERTIVIDADE, não o
 * total: o comprimento já comunica o total, então o texto entrega o que o
 * comprimento não entrega.
 */
export function RankingComposto({
  dados,
  altura,
  rotuloEixo = 'Categoria',
  realce = 'assertividade',
}: {
  dados: ItemComposto[]
  altura?: number
  /**
   * O QUE O RÓTULO DA DIREITA MOSTRA — e, por tabela, qual critério de
   * ordenação o gráfico está anunciando.
   *
   * Nasceu de um relato da Manutenção em 16/10/2026: ordenando por "Visitas
   * perdidas", a lista parecia fora de ordem. Estava ordenada certo — pelo
   * número de improdutivas —, só que NADA na tela mostrava esse número: o
   * comprimento da barra é o total e o rótulo era sempre a assertividade.
   * Ordenar por uma grandeza invisível lê como defeito, mesmo correto.
   */
  realce?: 'assertividade' | 'improdutivo'
  rotuloEixo?: string
}) {
  const option = useMemo(() => {
    const tk = lerTokens()
    // ECharts desenha o eixo Y de baixo para cima; inverte para o 1º no topo
    const ordenado = [...dados].reverse()

    // Estimar largura de texto por nº de caracteres subestima em fonte
    // proporcional — com fator 7 o rótulo perdia a primeira letra ("écnico" em
    // vez de "Técnico"). 7,8 + 10px de folga cobre o erro residual.
    const larguraRotulo = Math.min(
      260,
      Math.max(90, Math.ceil(7.8 * Math.max(...ordenado.map((d) => d.rotulo.length), 8)) + 10)
    )

    const serie = (
      nome: string,
      cor: string,
      pega: (d: ItemComposto) => number,
      ehPonta: boolean
    ) => ({
      name: nome,
      type: 'bar' as const,
      stack: 'desfecho',
      data: ordenado.map(pega),
      itemStyle: {
        color: cor,
        borderRadius: ehPonta ? MARCA.barraDireita4px : 0,
        borderColor: tk.surface,
        borderWidth: MARCA.vaoSuperficie / 2,
      },
      emphasis: { focus: 'series' as const },
      ...(ehPonta
        ? {
            label: {
              show: true,
              position: 'right' as const,
              formatter: (p: { dataIndex: number }) => {
                const d = ordenado[p.dataIndex]
                const pct = fmtFracaoPct(d?.assertividadeCampo, 0)
                // ordenando por visitas perdidas, o número que ordena vem junto
                return realce === 'improdutivo' ? `${fmtInt(d?.improdutivo ?? 0)} · ${pct}` : pct
              },
              color: tk.textSecondary,
              fontSize: 11,
              fontWeight: 600 as const,
            },
          }
        : {}),
    })

    return {
      grid: baseGrid(tk, { left: 4, right: realce === 'improdutivo' ? 96 : 56, top: 24, bottom: 4 }),
      tooltip: baseTooltip(tk, {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: `${tk.textMuted}14` } },
        formatter: (ps: { dataIndex: number }[]) => {
          const d = ordenado[ps[0]?.dataIndex ?? 0]
          if (!d) return ''
          const linha = (rot: string, v: number, cor: string) =>
            `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${cor};margin-right:6px"></span>${rot} <b>${fmtInt(v)}</b>`
          return `<b>${d.rotulo}</b><br/>
            ${linha('Produtivo', d.produtivo, tk.statusGood)}<br/>
            ${linha('Improdutivo', d.improdutivo, tk.statusCritical)}<br/>
            ${linha('Sem ação', d.semAcao, tk.statusWarning)}<br/>
            <span style="color:${tk.textMuted}">Total de visitas <b>${fmtInt(d.totalVisitas)}</b></span><br/>
            Assertividade de campo <b>${fmtFracaoPct(d.assertividadeCampo, 1)}</b>`
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
      xAxis: baseEixoValor(tk, { splitLine: { show: false } }),
      yAxis: baseEixoCategoria(tk, {
        data: ordenado.map((d) => d.rotulo),
        name: rotuloEixo,
        nameGap: 8,
        nameTextStyle: { color: tk.textMuted, fontSize: 0 },
        axisLine: { show: false },
        axisLabel: {
          color: tk.textSecondary,
          fontSize: 11,
          width: larguraRotulo,
          overflow: 'truncate',
        },
      }),
      series: [
        serie('Produtivo', tk.statusGood, (d) => d.produtivo, false),
        serie('Improdutivo', tk.statusCritical, (d) => d.improdutivo, false),
        // mesma escolha do painel diário: âmbar em vez de cinza (ver
        // ComposicaoDiaria.tsx). A leitura de cor tem de valer na página inteira.
        serie('Sem ação', tk.statusWarning, (d) => d.semAcao, true),
      ],
    }
  }, [dados, rotuloEixo, realce])

  const h = altura ?? Math.max(160, dados.length * 26 + 40)
  return (
    <Chart
      option={option}
      altura={h}
      aria-label="Ranking por desfecho das visitas, com assertividade de campo"
    />
  )
}
