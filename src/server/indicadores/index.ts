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
import { obterHistorico } from './historico'
import { obterPredicoes, obterRiscoAbertos } from './predicoes'

type Resultado = { data: unknown; meta?: unknown; ms: number }

/** Indicador que não depende de filtro nenhum: uma entrada de cache só. */
const semRecorte = (_f: Filtros): Record<string, unknown> => ({})

/**
 * Registry de indicadores.
 *
 * `cacheSegundos` é o TTL no cache do servidor (`server/cache.ts`), que é o que
 * substitui o refresh do modelo Power BI. Regra para escolher o valor: quanto
 * mais caro o SQL e mais lento o dado muda, maior o TTL.
 *
 * `produtividade` é o caso extremo — varredura de texto de ~5 s que só muda
 * quando o técnico fecha relato. TTL alto e revalidação em segundo plano.
 *
 * `recorte` diz quais filtros entram na CHAVE do cache. Sem ele entram todos,
 * que é o certo para quem obedece à barra. As Predições não obedecem (ver
 * predicoes.ts): com a URL inteira na chave, cada período que alguém trouxesse
 * de outra tela pagaria de novo as ~15 s de consulta para devolver o mesmo
 * resultado.
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
  // série mensal + base de clientes: o dado muda uma vez por dia (a carga
  // do Data Hub), então TTL alto não esconde nada de ninguém
  historico: { tier: 1, cacheSegundos: 900, fn: obterHistorico },
  // previsão sobre entrada DIÁRIA: 3 h não esconde nada, e cada cálculo são
  // ~15 s de réplica. Os abertos mudam de hora em hora e custam ~2 s.
  predicoes: { tier: 1, cacheSegundos: 10_800, fn: obterPredicoes, recorte: semRecorte },
  riscoAbertos: { tier: 1, cacheSegundos: 600, fn: obterRiscoAbertos, recorte: semRecorte },
} satisfies Record<
  string,
  {
    tier: 1 | 2
    cacheSegundos: number
    fn: (f: Filtros) => Promise<Resultado>
    recorte?: (f: Filtros) => Record<string, unknown>
  }
>

export type SlugIndicador = keyof typeof INDICADORES

export function ehSlugValido(s: string): s is SlugIndicador {
  return Object.hasOwn(INDICADORES, s)
}
