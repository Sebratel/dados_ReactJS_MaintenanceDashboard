import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { TELAS, type IdTela } from '@/config/telas'
import { exigirTela } from '@/server/auth/guarda'
import { SemProvedorError, gerarInsight } from '@/server/ia/insight'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * "Explique este painel".
 *
 * ⚠️ A TELA DE ORIGEM VEM NO CORPO E É CONFERIDA. Sem isso, quem não tem acesso
 * a Produtividade poderia mandar a tabela de Produtividade para cá e receber a
 * leitura dela de volta — o controle de acesso das telas seria contornado pelo
 * caminho da IA, que é o último lugar onde alguém procuraria o buraco.
 *
 * A tabela vem do CLIENTE, e isso é aceitável aqui porque a rota não devolve
 * dado novo: ela comenta o que o cliente já tem. Quem mandar uma tabela
 * inventada recebe um comentário sobre a tabela inventada.
 */

const IDS = TELAS.map((t) => t.id) as [IdTela, ...IdTela[]]

const Schema = z.object({
  tela: z.enum(IDS),
  titulo: z.string().min(1).max(200),
  descricao: z.string().max(500).optional(),
  recorte: z.string().max(500).optional(),
  pergunta: z.string().max(500).optional(),
  colunas: z
    .array(z.object({ chave: z.string().max(80), rotulo: z.string().max(120) }))
    .min(1)
    .max(40),
  linhas: z
    .array(z.record(z.string(), z.union([z.string(), z.number()])))
    .min(1)
    // teto alto aqui e corte fino no `insight.ts`: este é contra corpo gigante
    // chegando ao servidor; aquele é contra custo por token.
    .max(5000),
})

export async function POST(req: NextRequest) {
  let corpo
  try {
    corpo = Schema.parse(await req.json())
  } catch (e) {
    return NextResponse.json(
      { erro: 'pedido inválido', detalhe: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    )
  }

  const guarda = await exigirTela(req, corpo.tela)
  if (!guarda.ok) return guarda.resposta

  try {
    const r = await gerarInsight(corpo)
    console.info(
      `[ia] insight "${corpo.titulo}" para ${guarda.acesso.email} — ${r.provedor}/${r.modelo}, ${r.linhasEnviadas} linhas, ${r.ms}ms`
    )
    return NextResponse.json(r)
  } catch (e) {
    if (e instanceof SemProvedorError) {
      // 409 e não 500: não é falha, é funcionalidade não configurada. A tela usa
      // essa diferença para dizer o que fazer em vez de "erro inesperado".
      return NextResponse.json({ erro: e.message, motivo: 'sem-provedor' }, { status: 409 })
    }
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[ia] insight falhou:', msg)
    return NextResponse.json({ erro: msg }, { status: 502 })
  }
}
