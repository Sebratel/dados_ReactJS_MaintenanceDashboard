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
import { fmtFracaoPct, fmtInt } from '@/lib/formato'

export type PontoVolumeCoef = {
  rotulo: string
  volume: number
  /** volume ÷ base de clientes; `null` quando o Data Hub não cobre o mês */
  coeficiente: number | null
  baseClientes: number | null
}

/**
 * Barra de volume com a linha do coeficiente sobre a base de clientes.
 *
 * É a forma que a Manutenção já lê no Power BI em quatro telas, e o motivo de
 * ela funcionar é que as duas grandezas respondem perguntas que só fazem
 * sentido juntas: o volume diz quanto trabalho entrou, o coeficiente diz se
 * isso é muito PARA O TAMANHO DA BASE. Um mês com mais reparos e base crescendo
 * mais rápido é um mês melhor, e só a linha mostra isso.
 *
 * ⚠️ DOIS EIXOS, E ISSO É DÍVIDA VISUAL ACEITA DE PROPÓSITO. Eixo duplo deixa a
 * relação entre as duas séries dependente da escala escolhida, e por isso é
 * desaconselhado em geral. Aqui vale porque a comparação pretendida NÃO é entre
 * as duas séries — é de cada uma com ela mesma ao longo do tempo. O rótulo
 * direto em cima de cada barra e de cada ponto é o que tira o leitor da
 * dependência da escala: ele lê o número, não a altura.
 */
export function VolumeComCoeficiente({
  dados,
  altura,
  rotuloVolume = 'Volume',
}: {
  dados: PontoVolumeCoef[]
  altura?: number
  rotuloVolume?: string
}) {

  const option = useMemo(() => {
    const tk = lerTokens()
    const n = dados.length

    return {
      grid: baseGrid(tk, { top: 44, right: 8 }),
      tooltip: baseTooltip(tk, {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: `${tk.textMuted}14` } },
        formatter: (ps: { dataIndex: number }[]) => {
          const d = dados[ps[0]?.dataIndex ?? 0]
          if (!d) return ''
          const base =
            d.baseClientes === null
              ? `<span style="color:${tk.statusWarning}">sem base no Data Hub</span>`
              : `${fmtInt(d.baseClientes)} clientes`
          return `<b>${d.rotulo}</b><br/>
            ${rotuloVolume} <b>${fmtInt(d.volume)}</b><br/>
            Sobre a base <b>${fmtFracaoPct(d.coeficiente, 2)}</b><br/>
            <span style="color:${tk.textMuted}">${base}</span>`
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
      xAxis: baseEixoCategoria(tk, { data: dados.map((d) => d.rotulo) }),
      yAxis: [
        baseEixoValor(tk, { splitLine: { show: false } }),
        // eixo da direita, só para o coeficiente. Sem splitLine para não
        // desenhar duas grades concorrentes sobre as mesmas barras.
        baseEixoValor(tk, {
          splitLine: { show: false },
          axisLabel: {
            color: tk.textMuted,
            fontSize: 11,
            formatter: (v: number) => fmtFracaoPct(v, 1),
          },
        }),
      ],
      series: [
        {
          name: rotuloVolume,
          type: 'bar' as const,
          yAxisIndex: 0,
          data: dados.map((d) => d.volume),
          itemStyle: { color: gradienteColuna(tk), borderRadius: MARCA.barraTopo4px },
          /*
            RÓTULO DENTRO DA BARRA, e não em cima dela.
            Com eixo duplo, a linha passa perto do topo das barras em escalas
            que mudam a cada recorte — os dois rótulos em 'top' colidiam
            ("2,76%" cobrindo "2.359"). Dentro da barra eles ficam separados
            por construção, em qualquer escala.

            Texto na cor de tinta, não branco: a coluna agora é dourada, e
            branco sobre dourado fica em ~2:1 de contraste — o número sumia.
          */
          ...rotuloValor({
            n,
            formatter: (p) => fmtInt(p.value),
            cor: tk.textPrimary,
            position: 'insideTop',
            distancia: 6,
          }),
        },
        {
          name: 'Sobre a base',
          type: 'line' as const,
          yAxisIndex: 1,
          // o ponto sem base vira buraco na linha em vez de zero — zero ali
          // leria como "não houve reparo", e o que houve foi falta de medição
          connectNulls: false,
          data: dados.map((d) => d.coeficiente),
          // segunda cor de série (laranja), não o vermelho de "crítico": cor de
          // estado é reservada, e uma linha vermelha leria como alarme o mês todo.
          // O rótulo vai na tinta — texto nunca na cor da série (skill, seção 1).
          lineStyle: { width: MARCA.larguraLinha, color: tk.series[1] },
          itemStyle: { color: tk.series[1] },
          symbolSize: MARCA.tamanhoMarcador,
          ...rotuloValor({
            n,
            formatter: (p) => (p.value === null ? '' : fmtFracaoPct(p.value, 2)),
            cor: tk.textPrimary,
            distancia: 8,
          }),
        },
      ],
    }
  }, [dados, rotuloVolume])

  return (
    <Chart
      option={option}
      altura={altura}
      aria-label={`${rotuloVolume} por mês, com o percentual sobre a base de clientes`}
    />
  )
}
