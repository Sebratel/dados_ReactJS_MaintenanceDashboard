/**
 * Cache de resultado em memória do processo.
 *
 * POR QUE ISTO EXISTE
 * ───────────────────
 * O Power BI não consulta o ERP quando você abre uma página: ele consulta no
 * *refresh* e guarda o resultado no modelo em memória. Todo visual lê do
 * material já calculado. Ou seja — o relatório atual JÁ É uma camada de
 * materialização; ela só está escondida dentro do arquivo .pbix.
 *
 * Sem um banco de agregados, este módulo é o equivalente: a query pesada roda
 * uma vez e o resultado serve todas as requisições seguintes até vencer o TTL.
 * A varredura de produtividade custa ~5 s (`reports.description` não tem índice
 * que sirva para `LIKE '%IMPROD%'` — é seq scan por definição). Sem cache, cada
 * aba aberta paga os 5 s de novo e concorre na réplica de produção.
 *
 * TRÊS COMPORTAMENTOS QUE IMPORTAM
 * ─────────────────────────────────
 * 1. SINGLE-FLIGHT — dez requisições simultâneas da mesma chave compartilham
 *    UMA execução. Sem isto, dez abas abertas juntas viram dez seq scans
 *    concorrentes, que é exatamente o que derrubaria a réplica.
 * 2. STALE-WHILE-REVALIDATE — passado o TTL, devolve o valor velho na hora e
 *    atualiza em segundo plano. O usuário nunca espera pela query pesada, exceto
 *    na primeiríssima vez.
 * 3. TETO EM BYTES — a chave inclui os filtros, e filtro é combinatório.
 *    Sem teto, memória cresce sem parar. Descarta a entrada mais antiga.
 *
 * POR QUE O TETO É EM BYTES E NÃO EM NÚMERO DE ENTRADAS (medido em 10/09/2026)
 * ───────────────────────────────────────────────────────────────────────────
 * A versão anterior limitava a CONTAGEM (400 entradas), o que não protege
 * nada: as entradas têm tamanhos completamente diferentes. Um `kpis` são
 * dezenas de linhas agregadas; uma entrada de `/protocolos` guarda o CONJUNTO
 * INTEIRO de linhas, porque a chave ignora `busca`/`pagina` de propósito (a
 * paginação acontece depois, em memória, para não repetir a query a cada
 * página).
 *
 * Medição de uma entrada de "Ano corrente" com 45.000 linhas nominais:
 *
 *   heap ocupado ........ 14,1 MB   (piso: dados sintéticos sofrem interning
 *                                    do V8; com nome/endereço reais é maior)
 *   serializado ......... 49,8 MB
 *   entradas até 1 GB ... 72
 *
 * Ou seja, o teto de 400 entradas ficava ~5,5× acima do que o heap de 1 GB
 * (`--max-old-space-size=1024`, o padrão de deploy) aguenta. O sintoma era
 * "a RAM sobe conforme o uso" — não um vazamento, e sim o cache fazendo
 * exatamente o que estava escrito.
 *
 * LIMITAÇÃO ACEITA: é memória do processo. Reiniciar o servidor esvazia, e duas
 * instâncias não compartilham. Para o uso atual (um container) isso é
 * suficiente. Persistir exigiria o banco de agregados de docs/03-plano.md §2.
 */

type Entrada = {
  valor: unknown
  /** quando o valor deixa de ser fresco */
  expiraEm: number
  /** quando foi calculado — vira o "atualizado há X" da tela */
  nascidoEm: number
  /** evita disparar duas revalidações em paralelo para a mesma chave */
  revalidando: boolean
  /** tamanho estimado no heap — o que o teto de memória contabiliza */
  bytes: number
}

/** Depois disto o valor velho é lixo: espera a query em vez de servir. */
const FATOR_STALE_MAXIMO = 20

/**
 * Teto de memória do cache. 256 MB deixa folga confortável dentro do heap de
 * 1 GB do padrão de deploy, e ainda comporta ~18 grids anuais ou centenas de
 * agregados pequenos.
 */
const LIMITE_BYTES = Number(process.env.CACHE_MAX_MB ?? 256) * 1024 * 1024

/**
 * Guarda secundária, barata: impede que MUITAS entradas minúsculas inchem o
 * próprio Map. O teto que importa é o de bytes.
 */
const LIMITE_ENTRADAS = 400

const memo = new Map<string, Entrada>()
const emVoo = new Map<string, Promise<unknown>>()

/** Soma dos `bytes` de `memo`. Mantida incrementalmente para não varrer o Map. */
let bytesEmUso = 0

export type EstadoCache = 'miss' | 'hit' | 'stale'

export type ResultadoCache<T> = {
  valor: T
  estado: EstadoCache
  /** idade do valor entregue, em ms (0 em `miss`) */
  idadeMs: number
}

function agora(): number {
  return Date.now()
}

/**
 * Tamanho aproximado de um valor no heap, em bytes.
 *
 * POR QUE NÃO `JSON.stringify(v).length`: para uma entrada de 45 mil linhas
 * isso alocaria uma string de ~50 MB só para medir — o próprio ato de medir
 * viraria o pico de memória que queremos evitar.
 *
 * Em vez disso, arrays longos são AMOSTRADOS: mede 20 elementos distribuídos ao
 * longo do array e extrapola. A amostra é espaçada, e não os 20 primeiros,
 * porque as primeiras linhas costumam não representar o resto (campos que só
 * começam a vir preenchidos mais adiante).
 *
 * É estimativa, e é o suficiente: serve para decidir despejo, não para
 * contabilidade.
 */
function estimarBytes(v: unknown, profundidade = 0): number {
  if (v === null || v === undefined) return 8

  switch (typeof v) {
    case 'boolean':
      return 4
    case 'number':
      return 8
    case 'bigint':
      return 16
    case 'string':
      // cabeçalho do objeto string + UTF-16
      return 16 + v.length * 2
    case 'function':
    case 'symbol':
      return 0
  }

  // guarda contra estrutura muito aninhada (e contra ciclo, que não deveria
  // existir num resultado de query, mas não custa nada blindar)
  if (profundidade > 6) return 64

  if (Array.isArray(v)) {
    const n = v.length
    if (n === 0) return 32

    const AMOSTRA = 20
    if (n <= AMOSTRA) {
      let total = 32
      for (const item of v) total += estimarBytes(item, profundidade + 1)
      return total
    }

    const passo = Math.floor(n / AMOSTRA)
    let soma = 0
    for (let i = 0; i < AMOSTRA; i++) {
      soma += estimarBytes(v[i * passo], profundidade + 1)
    }
    return 32 + Math.round((soma / AMOSTRA) * n)
  }

  let total = 48
  for (const [k, valor] of Object.entries(v as Record<string, unknown>)) {
    total += 16 + k.length * 2
    total += estimarBytes(valor, profundidade + 1)
  }
  return total
}

/** Remove a entrada e devolve os bytes dela ao orçamento. */
function esquecer(chave: string): void {
  const e = memo.get(chave)
  if (!e) return
  bytesEmUso -= e.bytes
  memo.delete(chave)
}

/**
 * Despeja a entrada mais antiga até caber nos dois tetos.
 *
 * Map preserva ordem de inserção, então a primeira chave é sempre a mais
 * antiga — não precisa de estrutura de LRU separada.
 */
function podar(): void {
  for (const k of memo.keys()) {
    if (bytesEmUso <= LIMITE_BYTES && memo.size <= LIMITE_ENTRADAS) return
    esquecer(k)
  }
}

/** Executa `fn` com single-flight: chamadas concorrentes esperam a mesma promise. */
function executarUmaVez<T>(
  chave: string,
  ttlSegundos: number,
  fn: () => Promise<T>
): Promise<T> {
  const existente = emVoo.get(chave)
  if (existente) return existente as Promise<T>

  const p = (async () => {
    try {
      const valor = await fn()
      const t = agora()
      const bytes = estimarBytes(valor)

      // Uma entrada maior que o teto inteiro não pode ser guardada: despejaria
      // TUDO e ainda assim estouraria. Serve a requisição e não cacheia — a
      // próxima paga a query de novo, que é melhor do que derrubar o processo.
      if (bytes > LIMITE_BYTES) {
        console.warn(
          `[cache] entrada grande demais, não cacheada (${chave}): ` +
            `${(bytes / 1024 / 1024).toFixed(1)} MB > teto de ` +
            `${(LIMITE_BYTES / 1024 / 1024).toFixed(0)} MB`
        )
        esquecer(chave)
        return valor
      }

      esquecer(chave) // se já havia versão anterior, desconta os bytes dela
      memo.set(chave, {
        valor,
        nascidoEm: t,
        expiraEm: t + ttlSegundos * 1000,
        revalidando: false,
        bytes,
      })
      bytesEmUso += bytes
      podar()
      return valor
    } finally {
      emVoo.delete(chave)
    }
  })()

  emVoo.set(chave, p)
  return p
}

export async function memoizar<T>(
  chave: string,
  ttlSegundos: number,
  fn: () => Promise<T>,
  /**
   * Ignora o valor em cache e consulta o banco. É o que o botão "Atualizar" usa.
   *
   * DUAS PROPRIEDADES QUE IMPORTAM:
   * 1. Continua passando pelo single-flight. Dez gestores clicando ao mesmo tempo
   *    = UMA consulta, não dez — sem isso o botão vira o jeito mais fácil de
   *    derrubar a réplica de produção.
   * 2. Grava o resultado no cache compartilhado. Quem clica atualiza para TODO
   *    MUNDO, não só para si — um clique aquece o dado da equipe inteira.
   */
  forcar = false
): Promise<ResultadoCache<T>> {
  if (forcar) {
    const valor = await executarUmaVez(chave, ttlSegundos, fn)
    return { valor, estado: 'miss', idadeMs: 0 }
  }

  const e = memo.get(chave)
  const t = agora()

  // fresco
  if (e && t < e.expiraEm) {
    return { valor: e.valor as T, estado: 'hit', idadeMs: t - e.nascidoEm }
  }

  // vencido, mas ainda utilizável: entrega velho e atualiza atrás
  if (e && t < e.expiraEm + ttlSegundos * 1000 * FATOR_STALE_MAXIMO) {
    if (!e.revalidando) {
      e.revalidando = true
      // deliberadamente sem await: a requisição atual não espera
      void executarUmaVez(chave, ttlSegundos, fn)
        .catch((err) => {
          // falha na revalidação não pode derrubar a resposta que já foi servida;
          // o valor velho continua valendo até o próximo pedido tentar de novo
          console.error(`[cache] revalidação falhou (${chave}):`, err)
        })
        .finally(() => {
          const atual = memo.get(chave)
          if (atual) atual.revalidando = false
        })
    }
    return { valor: e.valor as T, estado: 'stale', idadeMs: t - e.nascidoEm }
  }

  // sem valor utilizável: espera
  const valor = await executarUmaVez(chave, ttlSegundos, fn)
  return { valor, estado: 'miss', idadeMs: 0 }
}

/** Chave estável: ordena as entradas para que a ordem dos filtros não importe. */
export function chaveDe(slug: string, filtros: Record<string, unknown>): string {
  const partes = Object.entries(filtros)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('~') : String(v)}`)
  return `${slug}?${partes.join('&')}`
}

export function limparCache(): void {
  memo.clear()
  emVoo.clear()
  bytesEmUso = 0
}

export function estatisticasCache(): {
  entradas: number
  emVoo: number
  bytes: number
  bytesLimite: number
  usoPercentual: number
} {
  return {
    entradas: memo.size,
    emVoo: emVoo.size,
    bytes: bytesEmUso,
    bytesLimite: LIMITE_BYTES,
    usoPercentual: Math.round((bytesEmUso / LIMITE_BYTES) * 100),
  }
}
