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
 * Desfecho das visitas por dia — barras empilhadas.
 *
 * Este é o trabalho de cor de STATUS, não categórico: Produtivo / Improdutivo /
 * Sem Ação não são categorias intercambiáveis, são níveis de um julgamento
 * (bom → ruim). Usar a paleta categórica aqui faria "improdutivo" parecer
 * apenas "outra coisa" em vez de "perda".
 *
 * Empilhado e não agrupado porque o total da barra É a informação — total de
 * visitas do dia — e a leitura de interesse é a fatia perdida dentro dele.
 *
 * Sem eixo duplo: a assertividade (%) mora em painel separado logo abaixo,
 * compartilhando o mesmo eixo X.
 */
export function ComposicaoDiaria({
  dados,
  altura = 240,
}: {
  dados: PontoProdutividadeDia[]
  altura?: number
}) {
  // o memo abaixo lê as variáveis CSS do tema — ver useTema.ts
  const tema = useTemaAtual()

  const option = useMemo(() => {
    const tk = lerTokens()

    const serie = (
      nome: string,
      cor: string,
      pega: (d: PontoProdutividadeDia) => number,
      ehTopo: boolean
    ) => ({
      name: nome,
      type: 'bar' as const,
      stack: 'visitas',
      data: dados.map(pega),
      itemStyle: {
        color: cor,
        // só o segmento do topo recebe a ponta arredondada; arredondar os do
        // meio abriria fenda entre as fatias e quebraria a leitura do total
        borderRadius: ehTopo ? MARCA.barraTopo4px : 0,
        borderColor: tk.surface,
        borderWidth: MARCA.vaoSuperficie / 2,
      },
      emphasis: { focus: 'series' as const },
      /**
       * O RÓTULO VAI SÓ NO SEGMENTO DO TOPO, E IMPRIME O TOTAL DA PILHA.
       *
       * Rotular cada fatia seria ilegível: num dia típico a verde tem 170 e as
       * outras duas somam 8 — o número não cabe dentro de um segmento de 4 px, e
       * três rótulos empilhados na mesma coluna colidem entre si.
       *
       * O total, sim, é a informação que o próprio subtítulo do painel promete
       * ("Total da barra = visitas do dia"), e até 17/09/2026 só existia no
       * tooltip. Ele sai de `d.totalVisitas` e não da soma das três séries: o
       * `value` que o ECharts entrega aqui é o da fatia âmbar, não o da pilha.
       */
      ...(ehTopo
        ? rotuloValor({
            n: dados.length,
            formatter: (p) => fmtInt(dados[p.dataIndex]?.totalVisitas ?? 0),
            cor: tk.textSecondary,
          })
        : {}),
    })

    return {
      grid: baseGrid(tk, { top: 26 }),
      tooltip: baseTooltip(tk, {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: `${tk.textMuted}14` } },
        formatter: (ps: { dataIndex: number }[]) => {
          const d = dados[ps[0]?.dataIndex ?? 0]
          if (!d) return ''
          const linha = (rot: string, v: number, cor: string) =>
            `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${cor};margin-right:6px"></span>${rot} <b>${fmtInt(v)}</b>`
          return `<b>${fmtDiaCurto(d.dia)}</b><br/>
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
      xAxis: baseEixoCategoria(tk, {
        data: dados.map((d) => fmtDiaCurto(d.dia)),
        axisLabel: { color: tk.textMuted, fontSize: 11, hideOverlap: true },
      }),
      yAxis: baseEixoValor(tk),
      series: [
        serie('Produtivo', tk.statusGood, (d) => d.produtivo, false),
        serie('Improdutivo', tk.statusCritical, (d) => d.improdutivo, false),
        // âmbar, não cinza: cinza lê como "sem dado", e "sem ação" não é ausência
        // de informação — é slot de agenda gasto sem desfecho, que é problema.
        // Cinza sobre verde também tem contraste baixo demais para uma fatia fina.
        serie('Sem ação', tk.statusWarning, (d) => d.semAcao, true),
      ],
    }
  }, [dados, tema])

  return (
    <Chart
      option={option}
      altura={altura}
      aria-label="Desfecho das visitas por dia: produtivo, improdutivo e sem ação"
    />
  )
}
