import { NextResponse, type NextRequest } from 'next/server'
import { exigirSessao } from '@/server/auth/guarda'
import { obterStatus } from '@/server/status'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * O status da Capa: selo e frescor das fontes.
 *
 * Diferente de `/api/health`, PASSA pela autenticação: a base de clientes é
 * dado de negócio. E não é indicador do `[slug]` porque não tem tela dona — a
 * Capa é de todo mundo que entrou; basta a sessão.
 */
export async function GET(req: NextRequest) {
  const guarda = await exigirSessao(req)
  if (!guarda.ok) return guarda.resposta

  return NextResponse.json(await obterStatus(), {
    headers: { 'cache-control': 'no-store' },
  })
}
