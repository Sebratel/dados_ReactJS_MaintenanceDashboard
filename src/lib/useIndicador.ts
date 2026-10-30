'use client'

import { useQuery } from '@tanstack/react-query'
import { buscarJson } from './clienteHttp'
import { filtrosParaQuery, type Filtros } from './filtros'
import type { Kpis } from '@/server/indicadores/kpis'
import type { Mtta } from '@/server/indicadores/mtta'
import type { PontoSerie } from '@/server/indicadores/serie'
import type { ItemRanking } from '@/server/indicadores/ranking'
import type { CelulaHeatmap } from '@/server/indicadores/heatmap'
import type { PontoCoeficiente } from '@/server/indicadores/coeficiente'
import type { OpcoesFiltro } from '@/server/indicadores/opcoes'
import type { ResultadoProdutividade } from '@/server/indicadores/produtividade'
import type { ResultadoRecorrencia } from '@/server/indicadores/recorrencia'
import type { ResultadoPreventivos } from '@/server/indicadores/preventivos'
import type { ResultadoOfensores } from '@/server/indicadores/ofensores'
import type { ResultadoHistorico } from '@/server/indicadores/historico'
import type { LinhaProtocolo } from '@/server/indicadores/protocolos'
import type { ResultadoPredicoes, ResultadoRiscoAbertos } from '@/server/indicadores/predicoes'

export type Envelope<T, M = Record<string, unknown>> = {
  data: T
  meta: M & { slug: string; tier: 1 | 2; ms: number; geradoEm: string }
}

/**
 * Janela em que as próximas consultas ignoram o cache do servidor.
 *
 * O botão "Atualizar" dispara o refetch de VÁRIAS queries de uma vez. Uma flag
 * booleana consumida pela primeira delas deixaria as outras lendo do cache, e o
 * gestor veria metade da tela atualizada. A janela de tempo cobre a leva inteira.
 */
let forcarAte = 0

export function marcarAtualizacaoForcada(): void {
  forcarAte = Date.now() + 10_000
}

async function buscar<T, M = Record<string, unknown>>(
  slug: string,
  filtros: Partial<Filtros>
): Promise<Envelope<T, M>> {
  const forcar = Date.now() < forcarAte
  const qs = `${filtrosParaQuery(filtros)}${forcar ? '&atualizar=1' : ''}`
  // `buscarJson` e não `fetch`: é ele que distingue sessão expirada de erro de
  // dados. Um `fetch` cru aqui tomaria 401 e a tela mostraria "falha ao
  // carregar" para sempre, sem nunca mandar ninguém para o login.
  return buscarJson<Envelope<T, M>>(`/api/indicadores/${slug}?${qs}`, {
    headers: { accept: 'application/json' },
    ...(forcar ? { cache: 'no-store' as const } : {}),
  })
}

/** Chave de cache: só os campos que o indicador realmente usa. */
function chave(slug: string, f: Partial<Filtros>) {
  return [slug, filtrosParaQuery(f)] as const
}

/**
 * Atualização automática de FUNDO, não a principal.
 *
 * Com o botão "Atualizar" na tela, o polling deixa de ser a fonte de frescor e
 * vira só custo: cada ciclo é uma consulta na réplica de PRODUÇÃO do ERP,
 * multiplicada por usuário e por combinação de filtro. Medido nesta base: duas
 * consultas pesadas colidindo degradam uma da outra em 8× (MTTA de 1,7 s para
 * 14 s).
 *
 * O intervalo longo serve só para que uma aba esquecida aberta não derive
 * demais. Quem precisa do número agora clica no botão — e o clique atualiza para
 * todo mundo, porque grava no cache compartilhado do servidor.
 */
const INTERVALO_TIER1 = 300_000

export function useKpis(f: Filtros) {
  return useQuery({
    queryKey: chave('kpis', f),
    queryFn: () => buscar<Kpis>('kpis', f),
    refetchInterval: INTERVALO_TIER1,
    staleTime: 30_000,
  })
}

/** MTTA é indicador separado por custo (ver src/server/indicadores/mtta.ts). */
export function useMtta(f: Filtros) {
  return useQuery({
    queryKey: chave('mtta', f),
    queryFn: () => buscar<Mtta>('mtta', f),
    refetchInterval: 600_000,
    staleTime: 60_000,
  })
}

export function useSerie(f: Filtros) {
  return useQuery({
    queryKey: chave('serie', f),
    queryFn: () =>
      buscar<
        PontoSerie[],
        { eixoDuplo: true; totalAbertos: number; totalEncerrados: number }
      >('serie', f),
    refetchInterval: INTERVALO_TIER1,
    staleTime: 30_000,
  })
}

export function useRanking(f: Filtros, dim: Filtros['dim'], limite = 12) {
  const q = { ...f, dim, limite }
  return useQuery({
    queryKey: chave('ranking', q),
    queryFn: () => buscar<ItemRanking[], { dimensao: string; total: number }>('ranking', q),
    refetchInterval: INTERVALO_TIER1,
    staleTime: 30_000,
  })
}

export function useHeatmap(f: Filtros) {
  return useQuery({
    queryKey: chave('heatmap', f),
    queryFn: () =>
      buscar<CelulaHeatmap[], { maxProtocolos: number; maxMttr: number }>('heatmap', f),
    refetchInterval: 900_000,
    staleTime: 120_000,
  })
}

export function useCoeficiente(f: Filtros) {
  return useQuery({
    queryKey: chave('coeficiente', f),
    queryFn: () =>
      buscar<PontoCoeficiente[], { diasInterpolados: number; apenasRegiao: boolean }>(
        'coeficiente',
        f
      ),
    refetchInterval: 900_000,
    staleTime: 120_000,
  })
}

/**
 * Produtividade de campo. É o indicador mais caro (~5 s de seq scan em
 * `reports.description`), mas o cache do servidor absorve isso: só o primeiro
 * pedido de cada recorte espera. Do lado do cliente, intervalo longo porque o
 * dado só muda quando o técnico fecha relato.
 */
export function useProdutividade(f: Filtros) {
  return useQuery({
    queryKey: chave('produtividade', f),
    queryFn: () =>
      buscar<
        ResultadoProdutividade['data'],
        {
          linhasMatriz: number
          cache: string
          idadeMs: number
        }
      >('produtividade', f),
    refetchInterval: 1_800_000,
    staleTime: 300_000,
  })
}

/**
 * Reincidência e recorrência. Custa ~9 s: a classificação precisa carregar 90
 * dias antes do período para as janelas terem histórico, e faz window function
 * por cliente. Cache de servidor com TTL longo cobre.
 */
export function useRecorrencia(f: Filtros) {
  return useQuery({
    queryKey: chave('recorrencia', f),
    queryFn: () =>
      buscar<
        ResultadoRecorrencia['data'],
        {
          protocolosSemLogin: number
          protocolosNoUniverso: number
          clientesBase: number
          linhas: number
          msClassificacao: number
          msDiagnostico: number
        }
      >('recorrencia', f),
    refetchInterval: 1_800_000,
    staleTime: 300_000,
  })
}

/**
 * Qualidade da ação preventiva. Carrega 90 dias ALÉM do fim do período para poder
 * achar o reparo que invalida a preventiva do fim do recorte.
 */
export function usePreventivos(f: Filtros) {
  return useQuery({
    queryKey: chave('preventivos', f),
    queryFn: () =>
      buscar<
        ResultadoPreventivos['data'],
        { linhas: number; janelaObservacaoDias: number }
      >('preventivos', f),
    refetchInterval: 1_800_000,
    staleTime: 300_000,
  })
}

/**
 * Ofensores. Carrega 90 dias ANTES do período: o reparo do início do recorte
 * precisa ter o anterior dele disponível, senão apareceria como primeira visita.
 */
export function useOfensores(f: Filtros) {
  return useQuery({
    queryKey: chave('ofensores', f),
    queryFn: () =>
      buscar<ResultadoOfensores['data'], { linhas: number; janelaDias: number }>(
        'ofensores',
        f
      ),
    refetchInterval: 1_800_000,
    staleTime: 300_000,
  })
}

export type MetaProtocolos = {
  total: number
  totalRecorte: number
  truncado: boolean
  limite: number
  excluidosTeste: number
  /** ver ResultadoProtocolos em server/indicadores/protocolos.ts */
  loginsDistintos?: number
  retornoPorFaixa?: { sim: number; v30: number; v60: number; v90: number; nao: number }
  pagina: number
  porPagina: number
  paginas: number
  cache: string
  idadeMs: number
  /** tempo do SQL que gerou o recorte — 0 quando veio do cache */
  ms: number
}

/**
 * Relatório analítico. Rota própria (`/api/protocolos`), não o `[slug]` genérico
 * — o porquê está no cabeçalho daquela rota.
 *
 * `placeholderData` mantém a página anterior na tela enquanto a nova chega. Sem
 * isso a tabela pisca em branco a cada tecla da busca, e numa conferência linha
 * a linha o pisca-pisca é o que faz perder a linha que se estava lendo.
 */
export function useProtocolos(
  f: Filtros,
  opts: { pagina: number; porPagina: number; busca: string }
) {
  return useQuery({
    queryKey: ['protocolos', filtrosParaQuery(f), opts.pagina, opts.porPagina, opts.busca],
    queryFn: async () => {
      const forcar = Date.now() < forcarAte
      const q = new URLSearchParams(filtrosParaQuery(f))
      q.set('pagina', String(opts.pagina))
      q.set('porPagina', String(opts.porPagina))
      if (opts.busca) q.set('busca', opts.busca)
      if (forcar) q.set('atualizar', '1')
      return buscarJson<{ data: LinhaProtocolo[]; meta: MetaProtocolos }>(
        `/api/protocolos?${q.toString()}`,
        {
          headers: { accept: 'application/json' },
          ...(forcar ? { cache: 'no-store' as const } : {}),
        }
      )
    },
    refetchInterval: 1_800_000,
    staleTime: 300_000,
    placeholderData: (anterior) => anterior,
  })
}

/**
 * Opções dos combos.
 *
 * A CHAVE PRECISA DO PERÍODO. Ela era `['opcoes']`, fixa, com o comentário de
 * que as opções "não dependem do período" — e isso nunca foi verdade: o servidor
 * recorta a lista pela janela em análise de propósito, para ninguém escolher uma
 * cidade e cair numa tela vazia (ver opcoes.ts).
 *
 * Com a chave fixa, a PRIMEIRA lista buscada na sessão congelava para sempre —
 * `staleTime` de 30 min sobre uma chave que nunca muda não dispara refetch
 * nenhum. Trocar o período atualizava a tela inteira e deixava os combos para
 * trás, sem nada indicando isso.
 *
 * Como apareceu, em 01/09/2026 às 08h38: o período padrão é o MÊS CORRENTE, que
 * no dia 1º às 8h da manhã continha 2 protocolos. A Manutenção abriu o
 * dashboard, trocou para "Últimos 90 dias" — e os combos seguiram exibindo o
 * mundo daqueles 2 protocolos. Reproduzido no banco com corte às 08:00: Cidade
 * = ['Canoas'], Tipo = 1, Técnico = 2, exatamente o que a tela mostrava, contra
 * 12 / 11 / 72 da janela de 90 dias.
 *
 * ⚠️ Todo dia 1º de manhã os combos ficam legitimamente quase vazios, agora que
 * seguem o período. É honesto, mas parece defeito — ver docs/06 item S.
 *
 * `placeholderData` mantém a lista anterior visível durante o refetch: a
 * consulta leva de 4 a 16 s, e esvaziar o combo nesse intervalo devolveria o
 * "carregando…" bem no momento em que a pessoa foi clicar nele.
 */
export function useOpcoesFiltro(f: Filtros) {
  const q = { de: f.de, ate: f.ate }
  return useQuery({
    queryKey: chave('opcoes', q),
    queryFn: () => buscar<OpcoesFiltro>('opcoes', q).then((r) => r.data),
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    placeholderData: (anterior) => anterior,
  })
}

/**
 * Série mensal sobre a base de clientes — a tela de Histórico.
 *
 * Custa pouco (agregação por mês, sem janela) mas cruza os dois bancos, então
 * o TTL de servidor é alto: a base do Data Hub muda uma vez por dia.
 */
export function useHistorico(f: Filtros) {
  return useQuery({
    queryKey: chave('historico', f),
    queryFn: () =>
      buscar<ResultadoHistorico['data'], ResultadoHistorico['meta']>('historico', f),
    refetchInterval: 1_800_000,
    staleTime: 300_000,
  })
}

/**
 * Predições — SEM filtros, de propósito (ver server/indicadores/predicoes.ts).
 * A chamada não leva a URL da tela: o servidor ignoraria, e a chave do cache
 * do navegador variaria à toa com o período que veio de outra aba.
 */
export function usePredicoes() {
  return useQuery({
    queryKey: chave('predicoes', {}),
    queryFn: () => buscar<ResultadoPredicoes['data'], ResultadoPredicoes['meta']>('predicoes', {}),
    refetchInterval: 1_800_000,
    staleTime: 600_000,
  })
}

/** Os reparos abertos agora. O servidor guarda 10 min; mais que isso o risco envelhece. */
export function useRiscoAbertos() {
  return useQuery({
    queryKey: chave('riscoAbertos', {}),
    queryFn: () =>
      buscar<ResultadoRiscoAbertos['data'], ResultadoRiscoAbertos['meta']>('riscoAbertos', {}),
    refetchInterval: 600_000,
    staleTime: 120_000,
  })
}
