import Redis from 'ioredis'

/**
 * Cache L2 em Redis — só para os agregados PEQUENOS.
 *
 * O QUE ELE RESOLVE (e o que deliberadamente não resolve)
 * ────────────────────────────────────────────────────────
 * O cache L1 (`cache.ts`) é memória do processo: um redeploy o esvazia, e a
 * primeira pessoa a abrir cada tela depois paga a query inteira. Este L2 faz o
 * dado sobreviver ao redeploy e, se um dia houver mais de um container, ser
 * compartilhado entre eles.
 *
 * Ele NÃO substitui o L1. O single-flight e o stale-while-revalidate continuam
 * todos lá; aqui é só um "semeador" — depois de um restart, o L1 se repovoa a
 * partir do Redis em vez de ir ao ERP.
 *
 * ⚠️ POR QUE SÓ OS PEQUENOS
 * ─────────────────────────
 * O Redis deste servidor é COMPARTILHADO com todas as aplicações da Sebratel.
 * Isso tem duas consequências que definem o desenho:
 *
 * 1. Não posso definir `maxmemory` — é configuração global do servidor, não
 *    minha. Meu único controle é não ocupar espaço demais.
 * 2. Se o servidor bater no limite com política `allkeys-lru`, o Redis passa a
 *    despejar chaves de QUEM ESTIVER LÁ — inclusive das outras aplicações.
 *
 * Uma entrada de `/protocolos` serializada mede ~50 MB (medido em 10/09/2026).
 * Colocar isso num Redis compartilhado seria transformar um problema de memória
 * nosso num incidente das outras equipes. Por isso `TAMANHO_MAXIMO_BYTES` é
 * baixo de propósito: o que não couber simplesmente não vai para o Redis, e
 * continua servido pelo L1 como hoje.
 *
 * DISCIPLINA OBRIGATÓRIA EM REDIS COMPARTILHADO
 * ──────────────────────────────────────────────
 * - Todo chave tem prefixo próprio (`PREFIXO`), para nunca colidir com outra app.
 * - Toda chave tem TTL. Sem exceção: chave sem expiração em banco compartilhado
 *   é vazamento permanente que ninguém sabe de quem é.
 * - Nunca `KEYS`, `FLUSHDB` ou `FLUSHALL`. `KEYS` bloqueia o servidor inteiro
 *   (afetando todas as apps) e os `FLUSH*` apagariam dado alheio.
 *
 * DEGRADAÇÃO: sem `REDIS_HOST` definido, todo este módulo vira no-op e o
 * comportamento é exatamente o de hoje. Nenhuma tela depende dele.
 */

/** Namespace desta aplicação dentro do Redis compartilhado. */
const PREFIXO = process.env.REDIS_PREFIXO ?? 'dash:manutencao:'

/**
 * Acima disto o valor não vai para o Redis compartilhado. 512 KB por chave é
 * suficiente para todo agregado (kpis, série, opções, coeficiente, heatmap) e
 * exclui por construção os grids grandes.
 */
const TAMANHO_MAXIMO_BYTES = Number(process.env.REDIS_MAX_KB ?? 512) * 1024

/**
 * Orçamento de tempo por operação. O cache existe para deixar a tela rápida —
 * se o Redis demorar, é mais barato ir ao L1/banco do que esperar por ele.
 */
const TIMEOUT_MS = Number(process.env.REDIS_TIMEOUT_MS ?? 200)

const globalParaRedis = globalThis as unknown as {
  __redis?: Redis | null
}

function criar(): Redis | null {
  const host = process.env.REDIS_HOST
  if (!host) return null

  const cliente = new Redis({
    host,
    port: Number(process.env.REDIS_PORT ?? 6379),
    username: process.env.REDIS_USER || undefined,
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB ?? 0),
    connectTimeout: 5_000,
    // Sem fila offline: se o Redis estiver fora, a operação falha na hora e o
    // chamador cai no L1. Com fila, os comandos se acumulariam em memória
    // esperando uma reconexão — exatamente o crescimento que queremos evitar.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    // Recuo progressivo com teto: sem o teto, um Redis fora do ar por muito
    // tempo vira tempestade de reconexão.
    retryStrategy: (tentativas) => Math.min(tentativas * 500, 10_000),
    lazyConnect: false,
  })

  cliente.on('error', (e: Error) => {
    // Não pode ser fatal: o Redis é opcional por desenho. Log e segue —
    // mas sem repetir, senão um Redis fora do ar vira enxurrada no log.
    registrarFalha(e.message)
  })

  return cliente
}

/**
 * DISJUNTOR (circuit breaker).
 *
 * POR QUE EXISTE: sem ele, um Redis inalcançável gerava DOIS avisos por
 * requisição (leitura + gravação) — 27 linhas em um minuto de uso medido em
 * 11/09/2026. Num log que rotaciona a 10 MB, esse ruído enterra o erro de
 * verdade, e ainda paga uma tentativa de conexão por requisição.
 *
 * Depois de `LIMITE_FALHAS` seguidas, o módulo PARA de chamar o Redis por
 * `COOLDOWN_MS` e volta a servir só pelo L1. Loga a TRANSIÇÃO (caiu / voltou),
 * nunca a falha individual.
 *
 * O caso mais comum disto disparar não é incidente: em desenvolvimento o
 * `REDIS_HOST` costuma ser um nome de rede Docker (ex.: `redis-alpine`) que só
 * resolve dentro do servidor. Localmente ele nunca vai responder — e é correto
 * que o dashboard siga funcionando sem reclamar a cada clique.
 */
const LIMITE_FALHAS = 3
const COOLDOWN_MS = Number(process.env.REDIS_COOLDOWN_MS ?? 60_000)

let falhasSeguidas = 0
let pausadoAte = 0

function registrarFalha(motivo: string): void {
  falhasSeguidas++
  if (falhasSeguidas === LIMITE_FALHAS) {
    pausadoAte = Date.now() + COOLDOWN_MS
    console.warn(
      `[redis] indisponível (${motivo}). Pausando por ${COOLDOWN_MS / 1000}s; ` +
        'o cache L1 continua atendendo normalmente.'
    )
  } else if (falhasSeguidas > LIMITE_FALHAS && Date.now() >= pausadoAte) {
    // venceu o cooldown e falhou de novo: renova em silêncio
    pausadoAte = Date.now() + COOLDOWN_MS
  }
}

function registrarSucesso(): void {
  if (falhasSeguidas >= LIMITE_FALHAS) {
    console.info('[redis] voltou a responder.')
  }
  falhasSeguidas = 0
  pausadoAte = 0
}

/** `true` enquanto o disjuntor está aberto — nem tenta chamar o Redis. */
function pausado(): boolean {
  return Date.now() < pausadoAte
}

const cliente: Redis | null = globalParaRedis.__redis ?? criar()
if (process.env.NODE_ENV !== 'production') globalParaRedis.__redis = cliente

export function redisAtivo(): boolean {
  return cliente !== null
}

/** Corre `p` contra o relógio: o cache nunca pode ser o gargalo. */
async function comTimeout<T>(p: Promise<T>): Promise<T | null> {
  let id: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      p,
      new Promise<null>((resolve) => {
        id = setTimeout(() => resolve(null), TIMEOUT_MS)
      }),
    ])
  } finally {
    if (id) clearTimeout(id)
  }
}

/**
 * Lê do Redis. Devolve `null` em qualquer situação anormal (sem Redis, timeout,
 * erro, chave ausente, JSON corrompido) — o chamador trata tudo como miss.
 */
export async function lerCompartilhado<T>(chave: string): Promise<T | null> {
  if (!cliente || pausado()) return null
  try {
    const bruto = await comTimeout(cliente.get(PREFIXO + chave))
    registrarSucesso()
    if (!bruto) return null
    return JSON.parse(bruto) as T
  } catch (e) {
    registrarFalha(e instanceof Error ? e.message : String(e))
    return null
  }
}

/**
 * Grava no Redis com TTL obrigatório. Valores acima de `TAMANHO_MAXIMO_BYTES`
 * são ignorados em silêncio — não é erro, é o desenho (ver o cabeçalho).
 */
export async function gravarCompartilhado(
  chave: string,
  valor: unknown,
  ttlSegundos: number
): Promise<void> {
  if (!cliente || pausado()) return
  try {
    const bruto = JSON.stringify(valor)
    if (bruto.length > TAMANHO_MAXIMO_BYTES) return

    // 'EX' garante que nenhuma chave nossa fique sem expiração
    await comTimeout(cliente.set(PREFIXO + chave, bruto, 'EX', ttlSegundos))
    registrarSucesso()
  } catch (e) {
    registrarFalha(e instanceof Error ? e.message : String(e))
  }
}
