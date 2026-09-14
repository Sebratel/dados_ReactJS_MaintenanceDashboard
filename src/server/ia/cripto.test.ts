import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cifrar, criptoConfigurada, decifrar, mascarar } from './cripto'

/**
 * A cifra da chave do provedor de IA.
 *
 * Erro aqui não aparece na tela: uma cifra quebrada continua gravando e lendo,
 * só que sem proteger nada. Os casos abaixo tentam quebrá-la de propósito.
 */

const SEGREDO = 'um-segredo-de-teste-bem-longo-123456'

beforeEach(() => {
  process.env.APP_SECRET = SEGREDO
})

afterEach(() => {
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
    // troca um caractere dos dados cifrados
    const mexido = dados.slice(0, -2) + (dados.endsWith('A') ? 'B' : 'A') + dados.slice(-1)
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

  it('recusa operar sem APP_SECRET', () => {
    delete process.env.APP_SECRET
    expect(criptoConfigurada()).toBe(false)
    expect(() => cifrar('x')).toThrow(/APP_SECRET/)
  })

  it('recusa APP_SECRET curto demais', () => {
    process.env.APP_SECRET = 'curto'
    expect(criptoConfigurada()).toBe(false)
    expect(() => cifrar('x')).toThrow(/APP_SECRET/)
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
