/**
 * Verificação do ID token do Firebase — feita AQUI, com a chave pública do
 * Google, em vez de perguntar ao Google a cada request.
 *
 * É esta escolha que faz o login sobreviver ao firewall corporativo. O
 * `access_token` do Google Identity Services é OPACO: só o Google sabe de quem
 * é, então o servidor precisa chamar `googleapis.com/userinfo` em toda
 * validação — uma dependência de rede por login. O ID token do Firebase é um
 * JWT ASSINADO: o e-mail vem dentro dele e a assinatura prova que foi o Google
 * que emitiu. Basta ter a chave pública, e ela vale horas.
 *
 * Resultado prático: depois de buscar as chaves uma vez, este servidor valida
 * sessão sem tocar na rede. Se a saída para o Google cair, quem já está logado
 * continua trabalhando.
 *
 * POR QUE WEB CRYPTO E NÃO `node:crypto`
 * ───────────────────────────────────────
 * Este módulo roda nos DOIS runtimes: no middleware (Edge, onde `node:crypto` e
 * `Buffer` não existem) e na rota `/api/auth/sessao` (Node). `crypto.subtle` é
 * o único verificador disponível nos dois, então é ele que permite haver UMA
 * implementação em vez de duas — e duas implementações de verificação de token
 * é como uma delas fica para trás numa correção de segurança.
 *
 * Pelo mesmo motivo a fonte das chaves é o endpoint JWKS, e não o de
 * certificados X.509 que o `firebase-admin` usa: `crypto.subtle.importKey` lê
 * JWK direto, enquanto X.509 exigiria extrair a chave do certificado à mão.
 *
 * POR QUE NÃO `firebase-admin`: ele faria exatamente isto, mas arrasta uma
 * árvore de dependências grande (google-auth-library, gcp-metadata, gtoken…) e
 * não roda no Edge — o que obrigaria a tirar a autenticação do middleware, que
 * é justamente o único ponto por onde TUDO passa.
 */

/** Onde o Google publica, em JWK, as chaves que assinam os ID tokens. */
const JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'

/** Renova depois disso, se der. As chaves do Google giram a cada poucos dias. */
const TTL_BRANDO_MS = 6 * 60 * 60 * 1000

/**
 * Além disto não confia mais e passa a BLOQUEAR esperando a rede.
 *
 * O intervalo entre os dois TTLs é a margem de sobrevivência a uma queda de
 * saída para o Google: dentro dela o servidor segue validando com o que tem.
 */
const TTL_DURO_MS = 30 * 24 * 60 * 60 * 1000

const TIMEOUT_REDE_MS = 10_000

type ChaveJwk = JsonWebKey & { kid?: string }
type CacheChaves = { chaves: Map<string, CryptoKey>; buscadoEm: number }

/**
 * O cache vive no `globalThis` porque em desenvolvimento o hot reload reavalia
 * o módulo, e sem isso cada recarga buscaria as chaves de novo.
 */
const globalParaChaves = globalThis as unknown as {
  __chavesFirebase?: CacheChaves
  __chavesFirebaseEmVoo?: Promise<CacheChaves> | null
}

async function buscarChaves(): Promise<CacheChaves> {
  const r = await fetch(JWKS_URL, {
    signal: AbortSignal.timeout(TIMEOUT_REDE_MS),
    // o cache do fetch do Next guardaria a resposta indefinidamente; o
    // controle de validade é o daqui, com os dois TTLs acima
    cache: 'no-store',
  })
  if (!r.ok) throw new Error(`JWKS do Google respondeu ${r.status}`)

  const corpo = (await r.json()) as { keys?: ChaveJwk[] }
  const lista = corpo.keys ?? []
  if (!lista.length) throw new Error('JWKS do Google veio vazio')

  const chaves = new Map<string, CryptoKey>()
  for (const jwk of lista) {
    if (!jwk.kid) continue
    try {
      chaves.set(
        jwk.kid,
        await crypto.subtle.importKey(
          'jwk',
          jwk,
          { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
          false,
          ['verify']
        )
      )
    } catch {
      // uma chave ilegível não pode derrubar as outras
    }
  }
  if (!chaves.size) throw new Error('nenhuma chave utilizável no JWKS')

  return { chaves, buscadoEm: Date.now() }
}

/**
 * Chaves válidas. A ordem importa: serve o que está em memória, renova em
 * segundo plano quando envelhece, e SÓ bloqueia esperando a rede quando não há
 * nada utilizável. Uma renovação que falha NÃO invalida o que já temos — esse é
 * o ponto inteiro do cache.
 */
async function obterChaves(): Promise<CacheChaves> {
  const memo = globalParaChaves.__chavesFirebase
  const idade = memo ? Date.now() - memo.buscadoEm : Number.POSITIVE_INFINITY

  if (memo && idade < TTL_BRANDO_MS) return memo

  if (memo && idade < TTL_DURO_MS) {
    // Envelhecido mas ainda utilizável: renova sem segurar o request.
    if (!globalParaChaves.__chavesFirebaseEmVoo) {
      globalParaChaves.__chavesFirebaseEmVoo = buscarChaves()
        .then((c) => {
          globalParaChaves.__chavesFirebase = c
          return c
        })
        .catch((e: unknown) => {
          console.warn(
            `[auth] não consegui renovar as chaves do Google (${
              e instanceof Error ? e.message : String(e)
            }); seguindo com as que estão em cache.`
          )
          return memo
        })
        .finally(() => {
          globalParaChaves.__chavesFirebaseEmVoo = null
        })
    }
    return memo
  }

  // Sem nada utilizável: aqui não tem como não esperar.
  if (!globalParaChaves.__chavesFirebaseEmVoo) {
    globalParaChaves.__chavesFirebaseEmVoo = buscarChaves()
      .then((c) => {
        globalParaChaves.__chavesFirebase = c
        return c
      })
      .finally(() => {
        globalParaChaves.__chavesFirebaseEmVoo = null
      })
  }
  return globalParaChaves.__chavesFirebaseEmVoo
}

/**
 * base64url → bytes, sem `Buffer` (que não existe no Edge).
 *
 * O `new ArrayBuffer(...)` explícito não é adorno: `new Uint8Array(n)` tem tipo
 * `Uint8Array<ArrayBufferLike>`, que o `crypto.subtle` recusa porque
 * `ArrayBufferLike` inclui `SharedArrayBuffer` — e memória compartilhada pode
 * ser alterada por outra thread no meio da verificação.
 */
function debase64url(s: string): Uint8Array<ArrayBuffer> {
  const base64 = s.replaceAll('-', '+').replaceAll('_', '/')
  const completo = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const bin = atob(completo)
  const bytes = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function textoDe(bytes: Uint8Array<ArrayBuffer>): string {
  return new TextDecoder().decode(bytes)
}

export type ClaimsFirebase = {
  email: string
  nome?: string
  foto?: string
  /** vencimento do token, em segundos desde a época — governa o prazo do cookie */
  exp: number
}

export type FalhaSessao =
  | 'sem-configuracao'
  | 'token-malformado'
  | 'assinatura-invalida'
  | 'token-vencido'
  | 'projeto-errado'
  | 'email-nao-verificado'
  | 'dominio-nao-autorizado'

export type ResultadoVerificacao =
  | { ok: true; claims: ClaimsFirebase }
  | { ok: false; motivo: FalhaSessao }

/**
 * Valida o ID token e devolve as claims.
 *
 * Nunca lança por token inválido — devolve o motivo, que é o que a chamada
 * precisa para decidir entre "mande logar de novo" e "você não tem acesso".
 * Lança apenas por falha de infraestrutura (sem chave nenhuma utilizável).
 */
export async function verificarIdToken(token: string): Promise<ResultadoVerificacao> {
  const projeto = process.env.FIREBASE_PROJECT_ID
  const dominio = process.env.ALLOWED_DOMAIN
  if (!projeto || !dominio) return { ok: false, motivo: 'sem-configuracao' }

  const partes = token.split('.')
  if (partes.length !== 3) return { ok: false, motivo: 'token-malformado' }
  const [cru1, cru2, cruAssinatura] = partes as [string, string, string]

  let cabecalho: { alg?: string; kid?: string }
  let dados: Record<string, unknown>
  try {
    cabecalho = JSON.parse(textoDe(debase64url(cru1))) as typeof cabecalho
    dados = JSON.parse(textoDe(debase64url(cru2))) as Record<string, unknown>
  } catch {
    return { ok: false, motivo: 'token-malformado' }
  }

  // O Firebase assina ID token com RS256. Aceitar o algoritmo que o próprio
  // token declara abriria a porta clássica do `alg: none` — e a troca para
  // HS256, em que a "assinatura" passaria a ser feita com a chave PÚBLICA, que
  // qualquer um tem.
  if (cabecalho.alg !== 'RS256' || !cabecalho.kid) {
    return { ok: false, motivo: 'assinatura-invalida' }
  }

  // Emissor e público têm de ser ESTE projeto: sem isto, um token válido de
  // qualquer outro projeto Firebase do mundo entraria aqui.
  if (dados.iss !== `https://securetoken.google.com/${projeto}`) {
    return { ok: false, motivo: 'projeto-errado' }
  }
  if (dados.aud !== projeto) return { ok: false, motivo: 'projeto-errado' }

  const agora = Math.floor(Date.now() / 1000)
  const exp = Number(dados.exp ?? 0)
  const iat = Number(dados.iat ?? 0)
  if (!exp || exp <= agora) return { ok: false, motivo: 'token-vencido' }
  // 5 min de tolerância para relógio adiantado de quem emitiu.
  if (iat && iat > agora + 300) return { ok: false, motivo: 'token-malformado' }

  const { chaves } = await obterChaves()
  const chave = chaves.get(cabecalho.kid)
  // `kid` desconhecido normalmente é chave nova do Google com cache velho aqui;
  // o TTL brando já terá disparado a renovação em segundo plano.
  if (!chave) return { ok: false, motivo: 'assinatura-invalida' }

  const assinado = new TextEncoder().encode(`${cru1}.${cru2}`)
  const assinaturaOk = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    chave,
    debase64url(cruAssinatura),
    assinado
  )
  if (!assinaturaOk) return { ok: false, motivo: 'assinatura-invalida' }

  // Só depois da assinatura conferida é que o conteúdo vale alguma coisa.
  const email = typeof dados.email === 'string' ? dados.email.toLowerCase() : ''
  if (!email) return { ok: false, motivo: 'email-nao-verificado' }
  if (dados.email_verified === false) return { ok: false, motivo: 'email-nao-verificado' }

  // O `hd` do provedor no cliente só enfeita o seletor de contas; QUEM DECIDE
  // acesso é esta linha. Sem ela, qualquer conta Google do mundo entraria com
  // token legítimo deste projeto.
  if (!email.endsWith(`@${dominio.toLowerCase()}`)) {
    return { ok: false, motivo: 'dominio-nao-autorizado' }
  }

  return {
    ok: true,
    claims: {
      email,
      nome: typeof dados.name === 'string' ? dados.name : undefined,
      foto: typeof dados.picture === 'string' ? dados.picture : undefined,
      exp,
    },
  }
}

/** Só para teste: injeta chaves sem tocar na rede. */
export function __definirChavesParaTeste(chaves: Map<string, CryptoKey>): void {
  globalParaChaves.__chavesFirebase = { chaves, buscadoEm: Date.now() }
}
