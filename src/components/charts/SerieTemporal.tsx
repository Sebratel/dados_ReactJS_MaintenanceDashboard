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
import { fmtInt, fmtPeriodo } from '@/lib/formato'
import type { PontoSerie } from '@/server/indicadores/serie'
import type { Granularidade } from '@/lib/filtros'

/**
 * Fluxo de entrada (criados) × saída (encerrados) no tempo.
 *
 * Duas séries de MESMA unidade (protocolos) → um só eixo de valor. O MTTR NÃO
 * entra aqui: unidade diferente exigiria segundo eixo, e eixo duplo é proibido
 * pelo guia de dataviz. Ele vive no gráfico ao lado, compartilhando o eixo X.
 *
 * Rótulo direto apenas no ÚLTIMO ponto de cada série — nunca em todo ponto.
 * O tooltip mostra o saldo (entrada − saída), que é a leitura de backlog.
 */
export function SerieTemporal({
  dados,
  granularidade,
  altura,
  comZoom = false,
}: {
  dados: PontoSerie[]
  granularidade: Granularidade
  altura?: number
  comZoom?: boolean
}) {

  const option = useMemo(() => {
    const tk = lerTokens()
    const rotulos = dados.map((d) => fmtPeriodo(d.periodo, granularidade))
    /**
     * O último ponto COM MEDIDA, e não o último do array.
     *
     * O rótulo impresso no fim da linha existe para dizer em quanto ela
     * terminou. Desde 15/09/2026 (item D) período futuro vem `null`, e apontar
     * para o fim do array escreveria o rótulo sobre o dia 30 de um mês que está
     * no dia 15 — ou nada, dependendo de como o ECharts trata o nulo. Nos dois
     * casos o número deixa de aparecer onde a linha realmente para.
     */
    const ultimo = dados.reduce(
      (acc, d, i) => (d.abertos === null && d.encerrados === null ? acc : i),
      -1
    )

    /**
     * ⚠️ O RÓTULO FINAL É CONFIGURADO NO PONTO, NÃO NA SÉRIE.
     *
     * A versão anterior punha `label` na série com um `formatter` que devolvia
     * '' para todos menos o último. Só que o ECharts desenha o FUNDO do rótulo
     * mesmo com texto vazio: o resultado eram caixinhas da cor da superfície
     * flutuando sobre cada ponto da linha, que no tema claro liam como sujeira
     * no gráfico e no escuro como marcadores pretos sem significado.
     *
     * Reportado pela Manutenção em 19/10/2026 junto com o defeito de tema.
     * Marcar só o item certo faz o ECharts não desenhar nada nos outros.
     */
    const pontoComRotulo = (valor: number | null) => ({
      value: valor,
      label: {
        show: true,
        position: 'top' as const,
        formatter: () => (valor === null ? '' : `${valor > 0 ? '+' : ''}${fmtInt(valor)}`),
        color: tk.textSecondary,
        fontSize: 11,
        fontWeight: 600 as const,
        backgroundColor: tk.surface,
        padding: [2, 3],
        borderRadius: 3,
      },
    })

    return {
      grid: baseGrid(tk, { bottom: comZoom ? 34 : 4, top: 22 }),
      tooltip: baseTooltip(tk, {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: tk.axis, width: 1, type: 'solid' } },
        formatter: (ps: { dataIndex: number; seriesName: string; value: number; color: string }[]) => {
          const i = ps[0]?.dataIndex ?? 0
          const d = dados[i]
          if (!d) return ''

          // Com trigger 'axis' o tooltip abre mesmo onde não há ponto. Sem
          // isto, passar o mouse pela parte vazia do mês mostrava
          // "Criados —  Encerrados —", que parece dado faltando e não futuro.
          if (d.abertos === null && d.encerrados === null) {
            return `<b>${fmtPeriodo(d.periodo, granularidade)}</b><br/><span style="color:${tk.textMuted}">ainda não aconteceu</span>`
          }

          const linhas = ps
            .map(
              (p) =>
                `<div style="display:flex;align-items:center;gap:6px;margin-top:3px">
                   <span style="width:8px;height:8px;border-radius:2px;background:${p.color}"></span>
                   <span style="color:${tk.textSecondary}">${p.seriesName}</span>
                   <b style="margin-left:auto">${fmtInt(p.value)}</b>
                 </div>`
            )
            .join('')
          // Período futuro não tem saldo — a linha inteira sai do tooltip em
          // vez de mostrar "= 0", que afirmaria equilíbrio onde não há medida.
          const saldo =
            d.saldo === null
              ? ''
              : (() => {
                  const cor =
                    d.saldo > 0 ? tk.statusCritical : d.saldo < 0 ? tk.statusGood : tk.textMuted
                  const seta = d.saldo > 0 ? '▲' : d.saldo < 0 ? '▼' : '='
                  return `<div style="display:flex;gap:6px;margin-top:5px;padding-top:4px;border-top:1px solid ${tk.gridline}">
              <span style="color:${tk.textSecondary}">Saldo do backlog</span>
              <b style="margin-left:auto;color:${cor}">${seta} ${d.saldo > 0 ? '+' : ''}${fmtInt(d.saldo)}</b>
            </div>`
                })()
          return `<b>${fmtPeriodo(d.periodo, granularidade)}</b>${linhas}${saldo}`
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
        data: rotulos,
        boundaryGap: false,
        axisLabel: {
          color: tk.textMuted,
          fontSize: 11,
          // com muitos pontos o ECharts já rareia; aqui garantimos legibilidade
          hideOverlap: true,
        },
      }),
      yAxis: [
        baseEixoValor(tk, { minInterval: 1 }),
        /*
         * EIXO DA DIREITA SÓ PARA O SALDO, e ele precisa conter o zero.
         * A leitura inteira do painel é "a linha está acima ou abaixo de
         * zero?" — um eixo que começasse no mínimo da série esconderia
         * justamente isso, desenhando um saldo sempre positivo como se
         * oscilasse em torno de nada.
         */
        baseEixoValor(tk, {
          minInterval: 1,
          splitLine: { show: false },
          axisLabel: { color: tk.textMuted, fontSize: 11, formatter: (v: number) => (v > 0 ? `+${fmtInt(v)}` : fmtInt(v)) },
        }),
      ],
      dataZoom: comZoom
        ? [
            { type: 'inside', throttle: 60 },
            {
              type: 'slider',
              height: 18,
              bottom: 4,
              borderColor: 'transparent',
              backgroundColor: tk.gridline,
              fillerColor: `${tk.series[0]}22`,
              handleStyle: { color: tk.series[0] },
              dataBackground: {
                lineStyle: { color: tk.axis },
                areaStyle: { color: tk.gridline },
              },
              textStyle: { color: tk.textMuted, fontSize: 10 },
            },
          ]
        : undefined,
      /*
       * ⚠️ DUAS LINHAS QUASE IGUAIS NÃO DIZEM NADA, E ESSE ERA O DEFEITO.
       *
       * Criados e encerrados andam colados por construção — num mês normal
       * entra quase o mesmo tanto que sai. No grão mensal as duas linhas se
       * sobrepunham e o painel ocupava a largura inteira para comunicar
       * "equilíbrio", que é o estado esperado e portanto não é notícia.
       *
       * Reportado pela Manutenção em 19/10/2026. A pergunta que a operação faz
       * ali não é "quanto entrou e quanto saiu", é **"está acumulando?"** — e
       * isso é o SALDO, que estava escondido no tooltip.
       *
       * Agora: barra = criados (o volume, que é o contexto), linha = saldo (a
       * resposta). Encerrados continua no tooltip e na aba Tabela — sai do
       * desenho, não do painel.
       */
      series: [
        {
          name: 'Criados',
          type: 'bar',
          yAxisIndex: 0,
          data: dados.map((d) => d.abertos),
          itemStyle: { color: gradienteColuna(tk), borderRadius: MARCA.barraTopo4px },
          emphasis: { focus: 'series' as const },
        },
        {
          name: 'Saldo (entra − sai)',
          type: 'line',
          yAxisIndex: 1,
          data: dados.map((d, i) => (i === ultimo ? pontoComRotulo(d.saldo) : d.saldo)),
          // explícito porque é carga: período futuro vem null (item D) e a linha
          // precisa PARAR ali, não saltar por cima do vazio até o fim do mês.
          connectNulls: false,
          smooth: false,
          symbol: 'circle',
          symbolSize: MARCA.tamanhoMarcador,
          showSymbol: dados.length <= 40,
          lineStyle: { width: MARCA.larguraLinha, color: tk.series[2] },
          /*
           * A COR DO PONTO CARREGA O SINAL, não a cor da linha.
           * Pintar a linha inteira de vermelho gritaria o mês inteiro num
           * indicador que passa a vida perto de zero; pintá-la de neutro
           * perderia o aviso. O ponto resolve os dois: vermelho onde o backlog
           * cresceu, verde onde encolheu.
           */
          itemStyle: {
            color: (p: { data: number | null }) =>
              p.data === null || p.data === 0
                ? tk.textMuted
                : p.data > 0
                  ? tk.statusCritical
                  : tk.statusGood,
            borderColor: tk.surface,
            borderWidth: 2,
          },
          markLine: {
            silent: true,
            symbol: 'none',
            data: [{ yAxis: 0 }],
            // `tk.textMuted` e não `tk.axis`: o eixo é desenhado para sumir atrás
            // do dado, e esta linha é a referência que decide a leitura do
            // painel inteiro — precisa ser vista nos dois temas.
            lineStyle: { color: tk.textMuted, type: 'dashed', width: 1 },
            label: {
              show: true,
              position: 'insideEndTop',
              formatter: 'equilíbrio',
              color: tk.textMuted,
              fontSize: 10,
            },
          },
          emphasis: { focus: 'series' as const },
        },
      ],
    }
  }, [dados, granularidade, comZoom])

  return <Chart option={option} altura={altura} aria-label="Protocolos criados por período, com o saldo entre entrada e saída" />
}
