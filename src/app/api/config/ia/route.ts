import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { exigirAdmin } from '@/server/auth/guarda'
import { criptoConfigurada } from '@/server/ia/cripto'
import {
  apagarConfig,
  lerConfigPublica,
  listarModelos,
  salvarConfig,
} from '@/server/ia/registro'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Configuração do provedor de IA — só administradores.
 *
 * ⚠️ NENHUMA RESPOSTA DAQUI CONTÉM A CHAVE. O GET devolve os quatro últimos
 * caracteres, para conferência. Devolver a chave inteira para preencher o
 * formulário seria mandá-la de volta pela rede a cada abertura da tela, e ela
 * passaria a viver no histórico do DevTools de quem abriu.
 */

const SalvarSchema = z.object({
  tipo: z.string(),
  modelo: z.string(),
  // ausente = manter a que está gravada
  chave: z.string().optional(),
  baseUrl: z.string().trim().url('base URL inválida').nullish().or(z.literal('')),
})

const ModelosSchema = z.object({
  tipo: z.string(),
  chave: z.string().optional(),
  baseUrl: z.string().trim().url('base URL inválida').nullish().or(z.literal('')),
})

function erro(e: unknown, status = 400) {
  return NextResponse.json(
    { erro: e instanceof Error ? e.message : String(e) },
    { status }
  )
}

export async function GET(req: NextRequest) {
  const guarda = await exigirAdmin(req)
  if (!guarda.ok) return guarda.resposta

  try {
    return NextResponse.json(lerConfigPublica())
  } catch (e) {
    console.error('[config/ia] leitura falhou:', e instanceof Error ? e.message : String(e))
    return erro('não consegui ler a configuração de IA', 503)
  }
}

export async function PUT(req: NextRequest) {
  const guarda = await exigirAdmin(req)
  if (!guarda.ok) return guarda.resposta

  if (!criptoConfigurada()) {
    return erro(
      'APP_SECRET não está definido no servidor. Sem ele a chave do provedor não pode ser guardada com segurança.',
      503
    )
  }

  let corpo
  try {
    corpo = SalvarSchema.parse(await req.json())
  } catch (e) {
    return erro(e)
  }

  try {
    salvarConfig(
      { tipo: corpo.tipo, modelo: corpo.modelo, chave: corpo.chave, baseUrl: corpo.baseUrl || null },
      guarda.acesso.email
    )
    console.info(`[config/ia] provedor alterado por ${guarda.acesso.email}`)
    return NextResponse.json(lerConfigPublica())
  } catch (e) {
    console.error('[config/ia] gravação falhou:', e instanceof Error ? e.message : String(e))
    return erro(e)
  }
}

export async function DELETE(req: NextRequest) {
  const guarda = await exigirAdmin(req)
  if (!guarda.ok) return guarda.resposta

  try {
    apagarConfig()
    console.info(`[config/ia] provedor removido por ${guarda.acesso.email}`)
    return NextResponse.json(lerConfigPublica())
  } catch (e) {
    return erro(e, 503)
  }
}

/**
 * Lista os modelos que a chave enxerga.
 *
 * É POST, e não GET, porque a chave vai no CORPO. Numa query string ela pararia
 * no log de acesso do servidor e no histórico do navegador — os dois lugares
 * onde uma credencial sobrevive mais tempo do que deveria.
 */
export async function POST(req: NextRequest) {
  const guarda = await exigirAdmin(req)
  if (!guarda.ok) return guarda.resposta

  let corpo
  try {
    corpo = ModelosSchema.parse(await req.json())
  } catch (e) {
    return erro(e)
  }

  try {
    const modelos = await listarModelos({
      tipo: corpo.tipo,
      chave: corpo.chave,
      baseUrl: corpo.baseUrl || null,
    })
    return NextResponse.json({ modelos })
  } catch (e) {
    // Erro do PROVEDOR (chave errada, rede, 429) é informação para o
    // administrador, não falha do nosso servidor — por isso 400 com a mensagem
    // que o provedor deu, e não um 500 opaco.
    return erro(e)
  }
}
