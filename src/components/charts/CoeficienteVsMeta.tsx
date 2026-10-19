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
import { fmtFracaoPct, fmtInt, fmtDiaCurto, fmtData } from '@/lib/formato'
import type { PontoCoeficiente } from '@/server/indicadores/coeficiente'

/**
 * Coeficiente de reparos vs meta.
 *
 * Polaridade (acima/abaixo da meta) → codificação DIVERGENTE: abaixo da meta é
 * bom (azul), acima é ruim (vermelho de status). A meta é uma linha de
 * referência na MESMA unidade, então não é eixo duplo.
 *
 * Dias com base de clientes interpolada (LOCF, 13 dias faltam no snapshot)
 * recebem hachura — o leitor precisa saber que aquele ponto é estimado.
 */
export function CoeficienteVsMeta({
  dados,
  altura = 240,
}: {
  dados: PontoCoeficiente[]
  altura?: number
}) {
  // o memo abaixo lê as variáveis CSS do tema — ver useTema.ts
  const tema = useTemaAtual()

  const option = useMemo(() => {
    const tk = lerTokens()

    return {
      grid: baseGrid(tk, { top: 24 }),
      tooltip: baseTooltip(tk, {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: `${tk.textMuted}14` } },
        formatter: (ps: { dataIndex: number }[]) => {
          const d = dados[ps[0]?.dataIndex ?? 0]
          if (!d) return ''
          const acima = d.coeficiente !== null && d.coeficiente > d.meta
          return `<b>${fmtData(d.dia)}</b><br/>
            Coeficiente <b>${fmtFracaoPct(d.coeficiente, 3)}</b>
              <span style="color:${acima ? tk.statusCritical : tk.statusGood}">
                ${acima ? '▲ acima' : '▼ dentro'} da meta
              </span><br/>
            Meta do dia <b>${fmtFracaoPct(d.meta, 3)}</b><br/>
            Reparos <b>${fmtInt(d.reparos)}</b><br/>
            Base de clientes <b>${fmtInt(d.baseClientes)}</b>
            ${d.interpolado ? `<br/><span style="color:${tk.statusWarning}">⚠ base estimada (sem snapshot no dia)</span>` : ''}`
        },
      }),
      xAxis: baseEixoCategoria(tk, {
        data: dados.map((d) => fmtDiaCurto(d.dia)),
        axisLabel: { color: tk.textMuted, fontSize: 11, hideOverlap: true },
      }),
      yAxis: baseEixoValor(tk, {
        axisLabel: {
          color: tk.textMuted,
          fontSize: 11,
          formatter: (v: number) => fmtFracaoPct(v, 2),
        },
      }),
      series: [
        {
          name: 'Coeficiente',
          type: 'bar',
          data: dados.map((d) => ({
            value: d.coeficiente,
            itemStyle: {
              // divergente: dentro da meta = azul; acima = vermelho de status
              color:
                d.coeficiente !== null && d.coeficiente > d.meta
                  ? tk.statusCritical
                  : tk.series[0],
              borderRadius: MARCA.barraTopo4px,
              // dia com base estimada: contorno tracejado em vez de fill cheio
              opacity: d.interpolado ? 0.55 : 1,
              borderColor: d.interpolado ? tk.statusWarning : 'transparent',
              borderWidth: d.interpolado ? 1 : 0,
              borderType: d.interpolado ? ('dashed' as const) : ('solid' as const),
            },
          })),
          barMaxWidth: 22,
          barCategoryGap: '30%',
          /**
           * DUAS CASAS, e não as três do tooltip.
           *
           * O coeficiente vive na terceira casa (0,118% contra 0,123%), então a
           * precisão importa de verdade aqui — mas "0,123%" ocupa ~42 px contra
           * ~32 px de "0,12%", e num recorte mensal essa diferença é a que faz o
           * `hideOverlap` derrubar metade dos rótulos. A leitura na tela é
           * "passou da meta ou não", que duas casas resolvem; a terceira
           * continua no tooltip, junto com reparos e base de clientes.
           *
           * Só a série da barra rotula. A Meta é uma linha de referência em
           * degraus e imprimir o valor dela em cada dia repetiria o mesmo número
           * dezenas de vezes.
           */
          ...rotuloValor({
            n: dados.length,
            formatter: (p) => (p.value === null ? '' : fmtFracaoPct(p.value, 2)),
            cor: tk.textSecondary,
          }),
        },
        {
          // a meta varia por dia da semana (0,12% seg–sex · 0,08% sáb · 0,06% dom)
          name: 'Meta',
          type: 'line',
          data: dados.map((d) => d.meta),
          symbol: 'none',
          step: 'middle' as const,
          lineStyle: { color: tk.textMuted, width: 1.5, type: 'dashed' },
          // sem isto a legenda pinta o item com a cor default da paleta do
          // ECharts (verde) — um quadradinho verde para uma linha cinza
          itemStyle: { color: tk.textMuted },
          z: 5,
        },
      ],
      legend: {
        show: true,
        top: 0,
        right: 0,
        itemWidth: 10,
        itemHeight: 10,
        itemGap: 14,
        icon: 'roundRect',
        textStyle: { color: tk.textSecondary, fontSize: 11 },
        // ícone customizado por série (path://) colapsa a largura do item e
        // sobrepõe os rótulos — swatch igual para as duas, e a cor cinza do
        // item da Meta já a distingue da barra
        data: ['Coeficiente', 'Meta'],
      },
    }
  }, [dados, tema])

  return <Chart option={option} altura={altura} aria-label="Coeficiente de reparos sobre a base de clientes, comparado à meta diária" />
}
