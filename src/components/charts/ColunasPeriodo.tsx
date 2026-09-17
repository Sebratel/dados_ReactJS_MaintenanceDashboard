'use client'

import { useMemo } from 'react'
import { Chart } from './Chart'
import { lerTokens, baseEixoCategoria, baseEixoValor, baseGrid, baseTooltip } from '@/lib/tema'
import { fmtInt, fmtPeriodo } from '@/lib/formato'
import type { Granularidade } from '@/lib/filtros'

export type ColunaPeriodo = {
  /** início do balde, sempre 'YYYY-MM-DD' */
  periodo: string
  valor: number
  /** linha secundária no tooltip — ex.: taxa de reincidência do período */
  detalhe?: string
}

/**
 * Volume por período, em colunas verticais.
 *
 * Colunas e não barras horizontais porque o eixo é TEMPO: a leitura da esquerda
 * para a direita é a convenção que todo mundo já traz, e trocá-la por barras
 * empilhadas de cima para baixo obriga a pessoa a reconstruir a ordem. É também
 * a forma do visual equivalente no Power BI (`PROTOCOLOS PREVENTIVOS ABERTOS
 * MÊS`, um columnChart).
 *
 * Um hue só, chapado: aqui não há categoria a distinguir — é a mesma medida ao
 * longo do tempo. Colorir cada período diferente sugeriria um agrupamento que
 * não existe.
 *
 * ANTES SE CHAMAVA `ColunasMes` e só sabia ler 'YYYY-MM' (14/09/2026). Passou a
 * receber a granularidade porque a aba de Preventivos deixou de ser mensal à
 * força; o rótulo agora sai do mesmo `fmtPeriodo` que a série do Executivo usa,
 * para os dois painéis não escreverem a mesma data de dois jeitos.
 */
export function ColunasPeriodo({
  dados,
  granularidade,
  altura = 200,
  unidade = 'protocolos',
}: {
  dados: ColunaPeriodo[]
  granularidade: Granularidade
  altura?: number
  unidade?: string
}) {
  const option = useMemo(() => {
    const tk = lerTokens()
    const rotulos = dados.map((d) => fmtPeriodo(d.periodo, granularidade))

    /**
     * QUEM DECIDE SE O RÓTULO CABE É O ECHARTS, NÃO UMA CONTAGEM ESCOLHIDA A MÃO.
     *
     * Antes era `dados.length <= 16`, calibrado para 12 meses ou as 13 semanas de
     * um trimestre. No recorte "Ano corrente" a série semanal tem 38 colunas e
     * perdia os rótulos — mas elas CABIAM: 38 colunas em ~1.900 px dão 50 px
     * cada, e "325" a 11 px ocupa uns 20. A Manutenção notou em 17/09/2026,
     * comparando o gráfico mensal (rotulado) com o semanal (sem rótulo nenhum).
     *
     * Contagem fixa erra nas duas direções, porque ignora a LARGURA: numa janela
     * estreita até 16 meses viram borrão, e o código não percebe. `hideOverlap`
     * mede o texto e esconde só o que colidiria de verdade, então o rótulo
     * aparece quando cabe e some quando não cabe — inclusive ao redimensionar.
     *
     * O TETO CONTINUA EXISTINDO, e é para o diário. Com 260 colunas o
     * `hideOverlap` deixaria passar um rótulo a cada três, e um subconjunto
     * espalhado parece escolha arbitrária — pior que rótulo nenhum. 60 cobre o
     * ano inteiro de semanas (53) e o mês inteiro de dias (31); acima disso o
     * valor fica no tooltip e na aba Tabela, como sempre esteve.
     */
    const cabemRotulos = dados.length <= 60

    return {
      grid: baseGrid(tk, { top: 24, bottom: 4, left: 4, right: 4 }),
      tooltip: baseTooltip(tk, {
        trigger: 'axis',
        axisPointer: { type: 'shadow' as const },
        formatter: (ps: { dataIndex: number }[]) => {
          const d = dados[ps[0]?.dataIndex ?? 0]
          if (!d) return ''
          return `<b>${fmtPeriodo(d.periodo, granularidade)}</b><br/>${fmtInt(d.valor)} ${unidade}${
            d.detalhe ? `<br/>${d.detalhe}` : ''
          }`
        },
      }),
      xAxis: baseEixoCategoria(tk, { data: rotulos }),
      yAxis: baseEixoValor(tk, {}),
      series: [
        {
          type: 'bar' as const,
          data: dados.map((d) => d.valor),
          itemStyle: {
            color: tk.series[0],
            borderRadius: [3, 3, 0, 0] as [number, number, number, number],
          },
          barMaxWidth: 46,
          label: {
            show: cabemRotulos,
            position: 'top' as const,
            formatter: (p: { value: number }) => fmtInt(p.value),
            color: tk.textSecondary,
            fontSize: 11,
            fontWeight: 600 as const,
          },
          labelLayout: { hideOverlap: true },
        },
      ],
    }
  }, [dados, granularidade, unidade])

  return <Chart option={option} altura={altura} aria-label={`${unidade} por período`} />
}
