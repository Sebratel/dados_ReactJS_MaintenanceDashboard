import { NextResponse, type NextRequest } from 'next/server'
import { verificarIdToken } from '@/server/auth/firebaseToken'
import { NOME_COOKIE, opcoesCookie, segundosAteVencer } from '@/server/auth/sessao'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Troca um ID token do Firebase pelo cookie de sessão — e o desfaz no logout.
 *
 * ⚠️ ESTA ROTA É PÚBLICA no matcher do middleware, e tem de ser: é por ela que
 * quem ainda não tem sessão consegue uma. Não é buraco na proteção porque ela
 * não devolve dado nenhum — só aceita um token e responde se ele presta. Quem
 * não tiver um ID token válido, assinado pelo Google, para este projeto e com
 * e-mail do domínio autorizado, sai daqui com 401 e sem cookie.
 *
 * O cliente chama este POST em três momentos (ver `SessaoFirebase`):
 *   1. logo depois do popup de login;
 *   2. quando o SDK renova o token sozinho, perto de 1 h de vida;
 *   3. ao reabrir o dashboard com sessão do Firebase ainda guardada no
 *      navegador, caso em que o cookie tinha vencido mas o login não.
 */

const MOTIVOS_HUMANOS: Record<string, string> = {
  'sem-configuracao': 'autenticação não configurada no servidor',
  'token-malformado': 'token de login ilegível',
  'assinatura-invalida': 'token de login não confere',
  'token-vencido': 'token de login vencido',
  'projeto-errado': 'token de login é de outro sistema',
  'email-nao-verificado': 'conta Google sem e-mail verificado',
  'dominio-nao-autorizado': 'use sua conta corporativa para entrar',
}

export async function POST(req: NextRequest) {
  let idToken: unknown
  try {
    idToken = ((await req.json()) as { idToken?: unknown }).idToken
  } catch {
    return NextResponse.json({ erro: 'corpo inválido' }, { status: 400 })
  }

  if (typeof idToken !== 'string' || !idToken) {
    return NextResponse.json({ erro: 'idToken ausente' }, { status: 400 })
  }

  let resultado
  try {
    resultado = await verificarIdToken(idToken)
  } catch (e) {
    console.error(
      '[auth] falha de infraestrutura ao verificar token:',
      e instanceof Error ? e.message : String(e)
    )
    return NextResponse.json(
      { erro: 'não foi possível validar o login agora' },
      { status: 503 }
    )
  }

  if (!resultado.ok) {
    // 403 quando a pessoa É quem diz ser mas não pode entrar (conta pessoal),
    // 401 quando o token em si não presta. A tela de login usa essa diferença
    // para dizer "entre com a conta da Sebratel" em vez de "tente de novo".
    const proibido =
      resultado.motivo === 'dominio-nao-autorizado' ||
      resultado.motivo === 'email-nao-verificado'
    console.warn(`[auth] login recusado: ${resultado.motivo}`)
    return NextResponse.json(
      { erro: MOTIVOS_HUMANOS[resultado.motivo] ?? 'login recusado', motivo: resultado.motivo },
      { status: proibido ? 403 : 401 }
    )
  }

  const { claims } = resultado
  const maxAge = segundosAteVencer(claims.exp)
  if (maxAge <= 0) {
    return NextResponse.json({ erro: 'token de login vencido' }, { status: 401 })
  }

  console.info(`[auth] sessão aberta: ${claims.email}`)

  const r = NextResponse.json({
    email: claims.email,
    nome: claims.nome ?? null,
    foto: claims.foto ?? null,
    expiraEm: claims.exp,
  })
  // `x-forwarded-proto` porque em produção quem termina o TLS é o proxy: sem
  // consultá-lo, o servidor se veria em HTTP e nunca marcaria o cookie como
  // `secure`.
  const seguro =
    req.nextUrl.protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https'
  r.cookies.set(NOME_COOKIE, idToken, opcoesCookie(maxAge, seguro))
  return r
}

/** Logout: apaga o cookie. O SDK do Firebase encerra o lado dele no cliente. */
export async function DELETE() {
  const r = NextResponse.json({ ok: true })
  r.cookies.set(NOME_COOKIE, '', opcoesCookie(0, false))
  return r
}
