'use client'

import { useMemo } from 'react'
import { Chart } from './Chart'
import { lerTokens, baseEixoCategoria, baseEixoValor, baseGrid, baseTooltip } from '@/lib/tema'
import { fmtInt, fmtFracaoPct } from '@/lib/formato'

export type ColunaMes = {
  /** 'YYYY-MM' */
  mes: string
  valor: number
  /** linha secundária no tooltip — ex.: taxa de reincidência do mês */
  detalhe?: string
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** 'YYYY-MM' → 'jul/26'. Sem `new Date`: o fuso do processo mudaria o mês. */
function rotuloMes(mes: string): string {
  const [ano, m] = mes.split('-')
  const i = Number(m) - 1
  return `${MESES[i] ?? m}/${(ano ?? '').slice(2)}`
}

/**
 * Volume por mês, em colunas verticais.
 *
 * Colunas e não barras horizontais porque o eixo é TEMPO: a leitura da esquerda
 * para a direita é a convenção que todo mundo já traz, e trocá-la por barras
 * empilhadas de cima para baixo obriga a pessoa a reconstruir a ordem. É também
 * a forma do visual equivalente no Power BI (`PROTOCOLOS PREVENTIVOS ABERTOS
 * MÊS`, um columnChart).
 *
 * Um hue só, chapado: aqui não há categoria a distinguir — é a mesma medida ao
 * longo do tempo. Colorir cada mês diferente sugeriria um agrupamento que não
 * existe.
 *
 * O número vai impresso no topo de cada coluna. Com 6 a 12 meses cabe sem
 * poluir, e dispensa o leitor de estimar altura contra o eixo.
 */
export function ColunasMes({
  dados,
  altura = 200,
  unidade = 'protocolos',
}: {
  dados: ColunaMes[]
  altura?: number
  unidade?: string
}) {
  const option = useMemo(() => {
    const tk = lerTokens()
    const rotulos = dados.map((d) => rotuloMes(d.mes))

    return {
      grid: baseGrid(tk, { top: 24, bottom: 4, left: 4, right: 4 }),
      tooltip: baseTooltip(tk, {
        trigger: 'axis',
        axisPointer: { type: 'shadow' as const },
        formatter: (ps: { dataIndex: number }[]) => {
          const d = dados[ps[0]?.dataIndex ?? 0]
          if (!d) return ''
          return `<b>${rotuloMes(d.mes)}</b><br/>${fmtInt(d.valor)} ${unidade}${
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
          itemStyle: { color: tk.series[0], borderRadius: [3, 3, 0, 0] as [number, number, number, number] },
          barMaxWidth: 46,
          label: {
            show: true,
            position: 'top' as const,
            formatter: (p: { value: number }) => fmtInt(p.value),
            color: tk.textSecondary,
            fontSize: 11,
            fontWeight: 600 as const,
          },
        },
      ],
    }
  }, [dados, unidade])

  return <Chart option={option} altura={altura} aria-label={`${unidade} por mês`} />
}

/** Ajuda quem monta o tooltip a não repetir a formatação da taxa. */
export function detalheTaxa(rotulo: string, taxa: number | null): string {
  return `${rotulo} ${fmtFracaoPct(taxa, 1)}`
}
