import type { Filtros } from '@/lib/filtros'
import { obterKpis } from './kpis'
import { obterMtta } from './mtta'
import { obterSerie } from './serie'
import { obterRanking } from './ranking'
import { obterHeatmap } from './heatmap'
import { obterCoeficiente } from './coeficiente'
import { obterOpcoesFiltro } from './opcoes'
import { obterProdutividade } from './produtividade'
import { obterRecorrencia } from './recorrencia'
import { obterPreventivos } from './preventivos'
import { obterOfensores } from './ofensores'

type Resultado = { data: unknown; meta?: unknown; ms: number }

/**
 * Registry de indicadores.
 *
 * `cacheSegundos` é o TTL no cache do servidor (`server/cache.ts`), que é o que
 * substitui o refresh do modelo Power BI. Regra para escolher o valor: quanto
 * mais caro o SQL e mais lento o dado muda, maior o TTL.
 *
 * `produtividade` é o caso extremo — varredura de texto de ~5 s que só muda
 * quando o técnico fecha relato. TTL alto e revalidação em segundo plano.
 */
export const INDICADORES = {
  kpis: { tier: 1, cacheSegundos: 60, fn: obterKpis },
  mtta: { tier: 1, cacheSegundos: 120, fn: obterMtta },
  serie: { tier: 1, cacheSegundos: 60, fn: obterSerie },
  ranking: { tier: 1, cacheSegundos: 60, fn: obterRanking },
  heatmap: { tier: 1, cacheSegundos: 300, fn: obterHeatmap },
  coeficiente: { tier: 1, cacheSegundos: 300, fn: obterCoeficiente },
  opcoes: { tier: 1, cacheSegundos: 1800, fn: obterOpcoesFiltro },
  produtividade: { tier: 1, cacheSegundos: 600, fn: obterProdutividade },
  recorrencia: { tier: 1, cacheSegundos: 600, fn: obterRecorrencia },
  preventivos: { tier: 1, cacheSegundos: 600, fn: obterPreventivos },
  ofensores: { tier: 1, cacheSegundos: 600, fn: obterOfensores },
} satisfies Record<
  string,
  { tier: 1 | 2; cacheSegundos: number; fn: (f: Filtros) => Promise<Resultado> }
>

export type SlugIndicador = keyof typeof INDICADORES

export function ehSlugValido(s: string): s is SlugIndicador {
  return Object.hasOwn(INDICADORES, s)
}
