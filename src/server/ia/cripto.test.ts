import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cifrar, criptoConfigurada, decifrar, mascarar } from './cripto'

/**
 * A cifra da chave do provedor de IA.
 *
 * Erro aqui não aparece na tela: uma cifra quebrada continua gravando e lendo,
 * só que sem proteger nada. Os casos abaixo tentam quebrá-la de propósito.
 */

const SEGREDO = 'um-segredo-de-teste-bem-longo-123456'

let dir: string

beforeEach(() => {
  // DADOS_DIR aponta para um temporário mesmo nos testes que usam APP_SECRET:
  // sem isso, um caminho de fallback esquecido escreveria `.secret` dentro do
  // projeto, e o teste passaria sujando o repositório.
  dir = mkdtempSync(join(tmpdir(), 'manutencao-cripto-'))
  process.env.DADOS_DIR = dir
  process.env.APP_SECRET = SEGREDO
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  delete process.env.DADOS_DIR
  delete process.env.APP_SECRET
})

describe('cifrar/decifrar', () => {
  it('vai e volta', () => {
    const chave = 'sk-ant-api03-exemplo-de-chave'
    expect(decifrar(cifrar(chave))).toBe(chave)
  })

  it('cifra a mesma chave de forma diferente a cada vez (IV aleatório)', () => {
    const a = cifrar('mesma-chave')
    const b = cifrar('mesma-chave')
    expect(a).not.toBe(b)
    // e as duas continuam abrindo
    expect(decifrar(a)).toBe('mesma-chave')
    expect(decifrar(b)).toBe('mesma-chave')
  })

  it('não guarda a chave em claro no blob', () => {
    const blob = cifrar('sk-super-secreta-123')
    expect(blob).not.toContain('sk-super-secreta-123')
    expect(Buffer.from(blob, 'utf8').toString('utf8')).not.toContain('super-secreta')
  })

  it('recusa blob adulterado — é isso que o GCM acrescenta ao AES', () => {
    const blob = cifrar('chave-original')
    const [iv, tag, dados] = blob.split('.') as [string, string, string]
    /*
     * ⚠️ ADULTERAR O BYTE, NUNCA O CARACTERE BASE64 — ESTE TESTE JÁ FOI INSTÁVEL.
     *
     * A versão anterior trocava o penúltimo caractere por 'A' e decidia isso
     * olhando `dados.endsWith('A')`, que é o ÚLTIMO caractere — e o último é
     * sempre '=' para este tamanho de texto. Resultado: quando o penúltimo já
     * era 'A', a "adulteração" não mexia em nada, o blob abria normalmente e o
     * teste falhava. Caía em ~6% das execuções (1/16, a chance de o caractere
     * ser 'A'), achado em 16/10/2026 depois de três quedas em ~36 rodadas.
     *
     * Há uma segunda armadilha no mesmo lugar: num grupo base64 incompleto os
     * bits finais são ENCHIMENTO. Trocar aquele caractere por outro do mesmo
     * quarteto ('A'/'B'/'C'/'D') decodifica para os MESMOS bytes — o blob
     * continuaria íntegro mesmo com o texto diferente.
     *
     * Por isso o teste desce ao byte: inverte o primeiro, que é dado de verdade
     * em qualquer tamanho, e confere que o texto mudou antes de exigir a recusa.
     * Teste que às vezes não testa nada é pior que teste ausente — ele dá aval.
     */
    const bytes = Buffer.from(dados, 'base64')
    bytes[0] ^= 0xff
    const mexido = bytes.toString('base64')
    expect(mexido).not.toBe(dados) // a adulteração aconteceu mesmo
    expect(decifrar(`${iv}.${tag}.${mexido}`)).toBeNull()
  })

  it('recusa quando a etiqueta de autenticação não bate', () => {
    const blob = cifrar('chave-original')
    const [iv, , dados] = blob.split('.') as [string, string, string]
    const tagFalsa = Buffer.alloc(16, 7).toString('base64')
    expect(decifrar(`${iv}.${tagFalsa}.${dados}`)).toBeNull()
  })

  it('não abre com outro APP_SECRET — trocar o segredo invalida o que está gravado', () => {
    const blob = cifrar('chave-original')
    process.env.APP_SECRET = 'outro-segredo-completamente-diferente'
    expect(decifrar(blob)).toBeNull()
  })

  it('devolve null para lixo, em vez de lançar', () => {
    expect(decifrar('')).toBeNull()
    expect(decifrar('nada-disso')).toBeNull()
    expect(decifrar('a.b')).toBeNull()
    expect(decifrar('a.b.c')).toBeNull()
  })

  /**
   * Sem APP_SECRET a cifra NÃO desiste: gera a chave em `data/.secret`, como o
   * COM · Gestão Comercial. Estes dois testes fixam esse contrato — e o segundo
   * fixa o limite dele.
   *
   * `resetModules` + import dinâmico porque a chave de arquivo fica em cache no
   * módulo: sem isso, o teste anterior deixaria uma chave carregada e o caso do
   * diretório indisponível passaria por engano.
   */
  it('sem APP_SECRET, gera a chave em data/.secret e continua funcionando', async () => {
    delete process.env.APP_SECRET
    vi.resetModules()
    const cripto = await import('./cripto')

    expect(cripto.criptoConfigurada()).toBe(true)
    expect(cripto.decifrar(cripto.cifrar('chave-x'))).toBe('chave-x')
    expect(existsSync(join(dir, '.secret'))).toBe(true)
  })

  it('sem APP_SECRET e sem diretório gravável, recusa operar', async () => {
    delete process.env.APP_SECRET
    // um arquivo comum no lugar do diretório: impossível de criar
    const bloqueio = join(dir, 'bloqueio')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(bloqueio, 'sou um arquivo', 'utf8')
    process.env.DADOS_DIR = join(bloqueio, 'dentro')

    vi.resetModules()
    const cripto = await import('./cripto')

    expect(cripto.criptoConfigurada()).toBe(false)
    expect(() => cripto.cifrar('x')).toThrow(/chave de cifra/i)
  })

  it('APP_SECRET curto demais não é aceito em silêncio', async () => {
    process.env.APP_SECRET = 'curto'
    // um arquivo no lugar do diretório impede o fallback de salvar o caso
    const { writeFileSync } = await import('node:fs')
    const bloqueio = join(dir, 'bloqueio2')
    writeFileSync(bloqueio, 'x', 'utf8')
    process.env.DADOS_DIR = join(bloqueio, 'dentro')

    vi.resetModules()
    const cripto = await import('./cripto')
    expect(cripto.criptoConfigurada()).toBe(false)
  })

  it('aguenta chave com acento e caractere fora do ASCII', () => {
    const chave = 'chave-com-acentuação-e-emoji-✓'
    expect(decifrar(cifrar(chave))).toBe(chave)
  })
})

describe('mascarar', () => {
  it('mostra só os quatro últimos', () => {
    expect(mascarar('sk-ant-api03-abcdefgh1234')).toBe('…1234')
  })

  it('não vaza chave curta', () => {
    expect(mascarar('abcd')).toBe('…')
    expect(mascarar('ab')).toBe('…')
  })
})
