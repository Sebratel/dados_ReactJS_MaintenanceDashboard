import { beforeAll, describe, expect, it } from 'vitest'
import { __definirChavesParaTeste, verificarIdToken } from './firebaseToken'

/**
 * Teste de segurança da verificação do ID token.
 *
 * POR QUE ESTE ARQUIVO EXISTE: um erro aqui não aparece na tela. Um token
 * aceito indevidamente não quebra nada, não gera log estranho e não some com
 * número nenhum — ele simplesmente deixa alguém entrar. Só um teste que TENTA
 * entrar com token falso pega isso, e é o que está abaixo.
 *
 * As chaves são geradas aqui e injetadas no cache, então nada disto toca a rede.
 */

const PROJETO = 'maintenance-dashboard-teste'
const DOMINIO = 'sebratel.com.br'
const KID = 'chave-de-teste'

let privada: CryptoKey

const b64url = (bytes: ArrayBuffer | Uint8Array): string => {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  for (const b of arr) bin += String.fromCharCode(b)
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

const b64urlTexto = (s: string): string => b64url(new TextEncoder().encode(s))

const agora = () => Math.floor(Date.now() / 1000)

/** Payload de um token que DEVERIA passar; cada teste estraga um campo. */
function payloadValido(extra: Record<string, unknown> = {}) {
  return {
    iss: `https://securetoken.google.com/${PROJETO}`,
    aud: PROJETO,
    iat: agora() - 60,
    exp: agora() + 3600,
    email: 'pessoa@sebratel.com.br',
    email_verified: true,
    name: 'Pessoa de Teste',
    ...extra,
  }
}

/** Assina de verdade, com a chave privada do par gerado no `beforeAll`. */
async function assinar(
  payload: Record<string, unknown>,
  cabecalho: Record<string, unknown> = { alg: 'RS256', kid: KID, typ: 'JWT' }
): Promise<string> {
  const corpo = `${b64urlTexto(JSON.stringify(cabecalho))}.${b64urlTexto(JSON.stringify(payload))}`
  const assinatura = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privada,
    new TextEncoder().encode(corpo)
  )
  return `${corpo}.${b64url(assinatura)}`
}

beforeAll(async () => {
  process.env.FIREBASE_PROJECT_ID = PROJETO
  process.env.ALLOWED_DOMAIN = DOMINIO

  const par = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )
  privada = par.privateKey
  __definirChavesParaTeste(new Map([[KID, par.publicKey]]))
})

describe('verificarIdToken', () => {
  it('aceita um token legítimo do projeto e do domínio', async () => {
    const r = await verificarIdToken(await assinar(payloadValido()))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.claims.email).toBe('pessoa@sebratel.com.br')
      expect(r.claims.nome).toBe('Pessoa de Teste')
    }
  })

  it('normaliza o e-mail para minúsculas', async () => {
    const r = await verificarIdToken(
      await assinar(payloadValido({ email: 'Pessoa@Sebratel.com.BR' }))
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.claims.email).toBe('pessoa@sebratel.com.br')
  })

  it('recusa `alg: none` — o ataque clássico de JWT', async () => {
    const cabecalho = b64urlTexto(JSON.stringify({ alg: 'none', kid: KID }))
    const corpo = b64urlTexto(JSON.stringify(payloadValido()))
    const r = await verificarIdToken(`${cabecalho}.${corpo}.`)
    expect(r).toEqual({ ok: false, motivo: 'assinatura-invalida' })
  })

  it('recusa a troca para HS256, que assinaria com a chave pública', async () => {
    const cabecalho = b64urlTexto(JSON.stringify({ alg: 'HS256', kid: KID }))
    const corpo = b64urlTexto(JSON.stringify(payloadValido()))
    const r = await verificarIdToken(`${cabecalho}.${corpo}.assinatura-qualquer`)
    expect(r).toEqual({ ok: false, motivo: 'assinatura-invalida' })
  })

  it('recusa payload adulterado depois de assinado', async () => {
    const token = await assinar(payloadValido())
    const [cab, , assinatura] = token.split('.') as [string, string, string]
    const outro = b64urlTexto(JSON.stringify(payloadValido({ email: 'invasor@sebratel.com.br' })))
    const r = await verificarIdToken(`${cab}.${outro}.${assinatura}`)
    expect(r).toEqual({ ok: false, motivo: 'assinatura-invalida' })
  })

  it('recusa token de OUTRO projeto Firebase', async () => {
    const r = await verificarIdToken(
      await assinar(
        payloadValido({ iss: 'https://securetoken.google.com/outro-projeto', aud: 'outro-projeto' })
      )
    )
    expect(r).toEqual({ ok: false, motivo: 'projeto-errado' })
  })

  it('recusa token com audience de outro projeto, mesmo com emissor certo', async () => {
    const r = await verificarIdToken(await assinar(payloadValido({ aud: 'outro-projeto' })))
    expect(r).toEqual({ ok: false, motivo: 'projeto-errado' })
  })

  it('recusa token vencido', async () => {
    const r = await verificarIdToken(await assinar(payloadValido({ exp: agora() - 10 })))
    expect(r).toEqual({ ok: false, motivo: 'token-vencido' })
  })

  it('recusa token emitido muito no futuro', async () => {
    const r = await verificarIdToken(await assinar(payloadValido({ iat: agora() + 3600 })))
    expect(r).toEqual({ ok: false, motivo: 'token-malformado' })
  })

  it('aceita relógio adiantado dentro dos 5 min de tolerância', async () => {
    const r = await verificarIdToken(await assinar(payloadValido({ iat: agora() + 120 })))
    expect(r.ok).toBe(true)
  })

  it('recusa conta de fora do domínio autorizado', async () => {
    const r = await verificarIdToken(
      await assinar(payloadValido({ email: 'pessoa@gmail.com' }))
    )
    expect(r).toEqual({ ok: false, motivo: 'dominio-nao-autorizado' })
  })

  it('recusa domínio que apenas TERMINA parecido com o autorizado', async () => {
    // `naosebratel.com.br` passaria num `endsWith` sem a arroba.
    const r = await verificarIdToken(
      await assinar(payloadValido({ email: 'pessoa@naosebratel.com.br' }))
    )
    expect(r).toEqual({ ok: false, motivo: 'dominio-nao-autorizado' })
  })

  it('recusa e-mail não verificado', async () => {
    const r = await verificarIdToken(await assinar(payloadValido({ email_verified: false })))
    expect(r).toEqual({ ok: false, motivo: 'email-nao-verificado' })
  })

  it('recusa token sem e-mail', async () => {
    const { email: _ignorado, ...semEmail } = payloadValido()
    const r = await verificarIdToken(await assinar(semEmail))
    expect(r).toEqual({ ok: false, motivo: 'email-nao-verificado' })
  })

  it('recusa token assinado por chave desconhecida', async () => {
    const r = await verificarIdToken(
      await assinar(payloadValido(), { alg: 'RS256', kid: 'kid-que-nao-temos' })
    )
    expect(r).toEqual({ ok: false, motivo: 'assinatura-invalida' })
  })

  it('recusa texto que nem é JWT', async () => {
    expect(await verificarIdToken('nada-disso')).toEqual({
      ok: false,
      motivo: 'token-malformado',
    })
    expect(await verificarIdToken('a.b.c')).toEqual({ ok: false, motivo: 'token-malformado' })
  })

  it('recusa tudo quando falta configuração no servidor', async () => {
    const guardado = process.env.FIREBASE_PROJECT_ID
    delete process.env.FIREBASE_PROJECT_ID
    const r = await verificarIdToken(await assinar(payloadValido()))
    process.env.FIREBASE_PROJECT_ID = guardado
    expect(r).toEqual({ ok: false, motivo: 'sem-configuracao' })
  })
})
