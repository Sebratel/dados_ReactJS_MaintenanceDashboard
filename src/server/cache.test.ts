/**
 * Testes do teto de memória do cache.
 *
 * O que estes testes protegem: o cache guarda o CONJUNTO INTEIRO de linhas de
 * `/protocolos` por combinação de filtro, e a versão anterior limitava só a
 * CONTAGEM de entradas (400) — que não protege memória nenhuma, porque as
 * entradas têm tamanhos muito diferentes. Se alguém trocar o teto de bytes de
 * volta por um teto de contagem, estes testes quebram.
 *
 * `CACHE_MAX_MB` é lido na carga do módulo, então cada teste que precisa de um
 * teto diferente importa o módulo de novo com `vi.resetModules()`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

/** Importa o cache com um teto de memória específico, do zero. */
async function carregarCache(maxMb: number) {
  vi.resetModules()
  process.env.CACHE_MAX_MB = String(maxMb)
  return import('./cache')
}

/** Payload com tamanho aproximadamente controlável (1 char ≈ 2 bytes). */
function payloadDe(mbAproximado: number) {
  const chars = Math.round((mbAproximado * 1024 * 1024) / 2)
  return { data: { linhas: ['x'.repeat(chars)] }, ms: 1 }
}

beforeEach(() => {
  delete process.env.CACHE_MAX_MB
})

describe('teto de memória', () => {
  it('despeja a entrada mais antiga quando estoura o teto de bytes', async () => {
    const { memoizar, estatisticasCache } = await carregarCache(10)

    // três entradas de ~4 MB não cabem em 10 MB: a primeira tem de sair
    for (const nome of ['a', 'b', 'c']) {
      await memoizar(nome, 60, async () => payloadDe(4))
    }

    const s = estatisticasCache()
    expect(s.bytes).toBeLessThanOrEqual(s.bytesLimite)
    expect(s.entradas).toBe(2)

    // 'a' foi despejada: recalcula (miss), 'c' continua quente (hit)
    const a = await memoizar('a', 60, async () => payloadDe(4))
    expect(a.estado).toBe('miss')
    const c = await memoizar('c', 60, async () => payloadDe(4))
    expect(c.estado).toBe('hit')
  })

  it('NÃO cacheia entrada maior que o teto inteiro, mas serve o valor', async () => {
    const { memoizar, estatisticasCache } = await carregarCache(4)
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const r = await memoizar('gigante', 60, async () => payloadDe(20))

    // o valor é entregue normalmente — não cachear não pode virar erro
    expect(r.valor).toBeDefined()
    expect(aviso).toHaveBeenCalled()

    // e nada ficou ocupando memória
    const s = estatisticasCache()
    expect(s.entradas).toBe(0)
    expect(s.bytes).toBe(0)

    aviso.mockRestore()
  })

  it('não contabiliza duas vezes ao sobrescrever a mesma chave', async () => {
    const { memoizar, estatisticasCache } = await carregarCache(50)

    await memoizar('k', 60, async () => payloadDe(4))
    const depoisDaPrimeira = estatisticasCache().bytes

    // `forcar = true` recalcula e regrava a MESMA chave
    await memoizar('k', 60, async () => payloadDe(4), true)
    const depoisDaSegunda = estatisticasCache().bytes

    expect(estatisticasCache().entradas).toBe(1)
    // tolerância de 1%: a estimativa amostra arrays, não é determinística ao byte
    expect(depoisDaSegunda).toBeLessThan(depoisDaPrimeira * 1.01)
  })
})

describe('comportamentos que não podem regredir', () => {
  it('single-flight: chamadas simultâneas compartilham UMA execução', async () => {
    const { memoizar } = await carregarCache(50)
    let execucoes = 0

    const fn = async () => {
      execucoes++
      await new Promise((r) => setTimeout(r, 20))
      return payloadDe(0.001)
    }

    await Promise.all([
      memoizar('mesma', 60, fn),
      memoizar('mesma', 60, fn),
      memoizar('mesma', 60, fn),
    ])

    expect(execucoes).toBe(1)
  })

  it('estatísticas relatam uso em bytes e o percentual do teto', async () => {
    const { memoizar, estatisticasCache } = await carregarCache(10)
    await memoizar('x', 60, async () => payloadDe(5))

    const s = estatisticasCache()
    expect(s.bytesLimite).toBe(10 * 1024 * 1024)
    expect(s.bytes).toBeGreaterThan(0)
    expect(s.usoPercentual).toBeGreaterThan(0)
    expect(s.usoPercentual).toBeLessThanOrEqual(100)
  })
})
