'use client'

import { useMemo } from 'react'
import { Chart } from './Chart'
import { lerTokens } from '@/lib/tema'
import { useTemaAtual } from '@/lib/useTema'
import { montarOpcaoHeatmap } from '@/lib/heatmapOpcao'
import type { CelulaHeatmap } from '@/server/indicadores/heatmap'

export { FAIXAS_MTTR, faixaMttr } from '@/lib/heatmapOpcao'

/**
 * Matriz dia da semana × turno.
 *
 * O componente ficou fino de propósito: toda a montagem da opção mora em
 * `@/lib/heatmapOpcao`, que é módulo puro e por isso pode ser conferido fora do
 * navegador (`scripts/verificar-heatmap.mjs`). O motivo está escrito lá — um
 * defeito de opção inválida derrubou esta tela sem que nada no servidor
 * acusasse, porque o erro só nasce depois da hidratação.
 */
export function HeatmapDiaTurno({
  dados,
  metrica = 'protocolos',
  altura = 220,
}: {
  dados: CelulaHeatmap[]
  metrica?: 'protocolos' | 'mttr'
  altura?: number
}) {
  // o memo abaixo lê as variáveis CSS do tema — ver useTema.ts
  const tema = useTemaAtual()

  const option = useMemo(
    () => montarOpcaoHeatmap({ dados, metrica, tk: lerTokens() }),
    [dados, metrica, tema]
  )

  return (
    <Chart
      option={option}
      altura={altura}
      aria-label={`Matriz de ${metrica === 'mttr' ? 'MTTR médio' : 'protocolos abertos'} por dia da semana e turno`}
    />
  )
}
