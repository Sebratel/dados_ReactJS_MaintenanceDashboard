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

export type ItemSimples = {
  rotulo: string
  valor: number
  share?: number
  /** linha extra no tooltip (ex.: família do motivo) */
  detalhe?: string
  /**
   * Item que NÃO faz parte da sequência ordinal — tipicamente a categoria de
   * ausência ("Não Reincidente"). Recebe cor neutra em vez de um passo da rampa:
   * senão o não-evento fica com a cor mais saturada da escala e rouba a ênfase
   * de quem tem o problema.
   */
  neutro?: boolean
}

/**
 * Ranking horizontal de uma medida só.
 *
 * Uma série, todas as barras no slot 1: a dimensão é nominal (motivo, catálogo),
 * então trocar a ordem não muda o significado e colorir cada barra de um jeito
 * gastaria o canal de identidade re-codificando o que o comprimento já diz.
 *
 * O `detalhe` (família do motivo, p.ex.) fica no tooltip e na tabela em vez de
 * virar cor: com 8 famílias, a legenda de cor custaria mais atenção do que
 * entrega.
 */
export function RankingSimples({
  dados,
  altura,
  unidade = 'visitas',
  /**
   * `ordinal` = as categorias têm ordem natural (janelas 30/60/90 dias). Aí a
   * barra recebe a rampa de UM hue (--ord-1..3, criada no CSS para exatamente
   * este caso) e a ordem de entrada é preservada — ordenar 30/60/90 por volume
   * destruiria a leitura de "quanto mais recente, mais grave".
   */
  escala = 'nominal',
  aoClicar,
  selecionado = null,
  formatarValor = fmtInt,
}: {
  dados: ItemSimples[]
  altura?: number
  unidade?: string
  escala?: 'nominal' | 'ordinal'
  /**
   * Como escrever o valor no rótulo da barra, no eixo e no tooltip.
   *
   * ⚠️ EXISTE PORQUE NÚMERO SEM UNIDADE MENTE. A tela de Ofensores, ordenada
   * por taxa, plotava `taxa × 1000` para ter inteiro na barra — e o rótulo
   * mostrava "39" ao lado de um técnico cuja taxa é 3,9%. O tooltip dizia
   * "39 ‰ de retorno", mas quem lê o gráfico lê a barra, não o tooltip.
   *
   * Reportado pela Manutenção em 20/10/2026: "onde for % está aparecendo
   * somente o número e confunde".
   *
   * Com o formatador, a tela passa o valor REAL (a fração) e manda formatá-lo
   * como percentual — o comprimento da barra continua certo e o rótulo deixa
   * de precisar de tradução.
   */
  formatarValor?: (v: number) => string
  /** clique na barra; recebe o rótulo. Sem isto o gráfico não é interativo. */
  aoClicar?: (rotulo: string) => void
  /** rótulo em foco — os demais esmaecem, em vez de sumirem */
  selecionado?: string | null
}) {
  // fora do useMemo: o handler de clique precisa da MESMA ordem que as barras
  const ordenado = useMemo(() => [...dados].reverse(), [dados])


  const option = useMemo(() => {
    const tk = lerTokens()

    // a rampa cobre só os itens ordinais; os neutros saem da conta
    const nOrdinais = dados.filter((d) => !d.neutro).length
    const corOrdinal = (posicaoEntreOrdinais: number) => {
      if (nOrdinais <= 1) return tk.ord[1]!
      const idx = Math.round(
        (posicaoEntreOrdinais / (nOrdinais - 1)) * (tk.ord.length - 1)
      )
      return tk.ord[idx] ?? tk.ord[1]!
    }
    // índice de cada item dentro da sequência ordinal, na ordem original
    const posOrdinal = new Map<string, number>()
    let k = 0
    for (const d of dados) if (!d.neutro) posOrdinal.set(d.rotulo, k++)

    return {
      grid: baseGrid(tk, {
        left: 8,
        right: 52,
        top: 4,
        bottom: 4,
      }),
      tooltip: baseTooltip(tk, {
        trigger: 'item',
        formatter: (p: { dataIndex: number }) => {
          const d = ordenado[p.dataIndex]
          if (!d) return ''
          return `<b>${d.rotulo}</b><br/>
            ${formatarValor(d.valor)} ${unidade}${
              d.share !== undefined ? ` (${fmtFracaoPct(d.share, 1)} do total)` : ''
            }${d.detalhe ? `<br/><span style="color:${tk.textMuted}">${d.detalhe}</span>` : ''}`
        },
      }),
      xAxis: baseEixoValor(tk, {
        splitLine: { show: false },
        // o eixo fala a mesma língua do rótulo: com fração, 0,02 em vez de 0.02
        axisLabel: { color: tk.textMuted, fontSize: 11, formatter: (v: number) => formatarValor(v) },
      }),
      yAxis: baseEixoCategoria(tk, {
        data: ordenado.map((d) => d.rotulo),
        axisLine: { show: false },
        axisLabel: {
          color: tk.textSecondary,
          fontSize: 11,
          // SEM `width` de propósito. Estimar a largura por contagem de
          // caracteres erra em fonte proporcional — com qualquer fator que testei
          // (7 e 7,8) o ECharts cortava a primeira letra de um ou outro rótulo
          // ("ovo Hamburgo", "quipe tecnologia"). Sem a largura declarada, o
          // `containLabel` mede o texto de verdade e reserva o espaço certo.
          // Rótulo comprido passa a alargar o eixo em vez de ser truncado — é o
          // trade-off aceito aqui, porque os rótulos desta escala são curtos.
        },
      }),
      series: [
        {
          type: 'bar',
          data: ordenado.map((d) => ({
            value: d.valor,
            itemStyle: {
              color:
                escala !== 'ordinal'
                  ? tk.series[0]
                  : d.neutro
                    ? tk.textMuted
                    : corOrdinal(posOrdinal.get(d.rotulo) ?? 0),
              borderRadius: MARCA.barraDireita4px,
              /**
               * ESMAECE O NÃO-SELECIONADO EM VEZ DE ESCONDÊ-LO.
               *
               * Filtrar a lista deixaria o painel com uma barra só e apagaria a
               * referência: não dá para ver que Canoas é a terceira de seis se
               * as outras cinco sumiram. Mantendo-as a 25%, o recorte fica
               * óbvio e o contexto continua legível.
               */
              opacity: selecionado && d.rotulo !== selecionado ? 0.25 : 1,
            },
          })),
          barMaxWidth: 16,
          barCategoryGap: '38%',
          label: {
            show: true,
            position: 'right' as const,
            formatter: (p: { value: number }) => formatarValor(p.value),
            color: tk.textSecondary,
            fontSize: 11,
            fontWeight: 600 as const,
          },
        },
      ],
    }
  }, [dados, ordenado, unidade, escala, selecionado, formatarValor])

  // sem altura fixa preenche o card; ~18px por barra é o piso legível
  const minima = Math.max(120, dados.length * 18 + 24)
  return (
    <Chart
      option={option}
      altura={altura}
      alturaMinima={minima}
      aria-label="Ranking por volume"
      aoClicar={
        aoClicar ? (i) => {
          const r = ordenado[i]?.rotulo
          if (r) aoClicar(r)
        } : undefined
      }
    />
  )
}
