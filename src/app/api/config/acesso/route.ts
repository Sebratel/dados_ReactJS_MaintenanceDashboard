import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { TELAS, type IdTela } from '@/config/telas'
import { exigirAdmin } from '@/server/auth/guarda'
import {
  lerMatriz,
  listarUsuarios,
  removerUsuario,
  salvarTela,
  salvarUsuario,
  adminsDoAmbiente,
} from '@/server/auth/acesso'
import { podeGravar } from '@/server/armazenamento'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Leitura e gravação do controle de acesso — a tela de Configurações.
 *
 * ⚠️ TODO MUNDO AQUI PASSA POR `exigirAdmin`. É a rota que decide quem vê o
 * quê: deixá-la aberta a um viewer seria dar a ele o poder de se promover.
 */

const IDS = TELAS.map((t) => t.id) as [IdTela, ...IdTela[]]

const CorpoSchema = z.object({
  usuarios: z
    .array(
      z.object({
        email: z.string().email('e-mail inválido'),
        papel: z.enum(['admin', 'viewer']),
      })
    )
    .default([]),
  removidos: z.array(z.string().email()).default([]),
  telas: z
    .array(
      z.object({
        tela: z.enum(IDS),
        modo: z.enum(['todos', 'lista']),
        emails: z.array(z.string().email()).default([]),
      })
    )
    .default([]),
})

function estadoAtual() {
  const gravavel = podeGravar()
  return {
    usuarios: listarUsuarios(),
    telas: lerMatriz(),
    catalogo: TELAS,
    adminsFixos: [...adminsDoAmbiente()],
    controleAtivo: gravavel.ok,
    motivoInativo: gravavel.ok ? null : gravavel.motivo,
  }
}

export async function GET(req: NextRequest) {
  const guarda = await exigirAdmin(req)
  if (!guarda.ok) return guarda.resposta

  try {
    // Estado honesto mesmo quando o diretório não está gravável: a tela precisa
    // poder DIZER o que falta, e um 503 aqui apareceria como "Configurações
    // quebrou" em vez de "o volume não montou".
    return NextResponse.json(estadoAtual())
  } catch (e) {
    console.error('[config/acesso] leitura falhou:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ erro: 'não consegui ler a configuração' }, { status: 503 })
  }
}

export async function PUT(req: NextRequest) {
  const guarda = await exigirAdmin(req)
  if (!guarda.ok) return guarda.resposta

  const gravavel = podeGravar()
  if (!gravavel.ok) {
    return NextResponse.json(
      { erro: `não consigo gravar a configuração — ${gravavel.motivo}` },
      { status: 503 }
    )
  }

  let corpo
  try {
    corpo = CorpoSchema.parse(await req.json())
  } catch (e) {
    return NextResponse.json(
      { erro: 'configuração inválida', detalhe: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    )
  }

  const quem = guarda.acesso.email

  /**
   * ⚠️ TRAVA CONTRA AUTO-EXCLUSÃO: a gravação não pode deixar o sistema sem
   * nenhum administrador.
   *
   * O caminho para isso é trivial — o único admin se rebaixa para viewer e
   * clica em Salvar. Dali em diante ninguém abre Configurações, e a correção
   * exige mexer no ambiente e reiniciar o container. Os admins de `ADMIN_EMAILS`
   * contam como rede de segurança e por isso entram na conta.
   */
  const fixos = adminsDoAmbiente()
  const removidos = new Set(corpo.removidos.map((e) => e.trim().toLowerCase()))
  const sobrariaAdmin =
    fixos.size > 0 ||
    corpo.usuarios.some(
      (u) => u.papel === 'admin' && !removidos.has(u.email.trim().toLowerCase())
    )

  if (!sobrariaAdmin) {
    return NextResponse.json(
      {
        erro: 'esta alteração deixaria o dashboard sem nenhum administrador',
        detalhe:
          'Promova outra pessoa a administrador antes, ou defina ADMIN_EMAILS no ambiente.',
      },
      { status: 409 }
    )
  }

  try {
    for (const email of removidos) removerUsuario(email)
    for (const u of corpo.usuarios) {
      if (removidos.has(u.email.trim().toLowerCase())) continue
      salvarUsuario(u.email, u.papel, quem)
    }
    for (const t of corpo.telas) salvarTela(t.tela, t.modo, t.emails, quem)

    console.info(`[config/acesso] alterado por ${quem}`)
    return NextResponse.json(estadoAtual())
  } catch (e) {
    console.error('[config/acesso] gravação falhou:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ erro: 'não consegui gravar a configuração' }, { status: 503 })
  }
}
