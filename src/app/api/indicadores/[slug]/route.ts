import { NextResponse, type NextRequest } from 'next/server'
import { ZodError } from 'zod'
import { parsearFiltros } from '@/lib/filtros'
import { INDICADORES, ehSlugValido } from '@/server/indicadores'
import { chaveDe, memoizar } from '@/server/cache'
import { gravarCompartilhado, lerCompartilhado } from '@/server/cacheCompartilhado'
import { exigirIndicador } from '@/server/auth/guarda'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
) {
  const { slug } = await ctx.params

  if (!ehSlugValido(slug)) {
    return NextResponse.json(
      { erro: `indicador desconhecido: ${slug}`, disponiveis: Object.keys(INDICADORES) },
      { status: 404 }
    )
  }

  /**
   * A AUTORIZAÇÃO VEM ANTES DE QUALQUER TRABALHO — antes de ler filtro, antes de
   * tocar no cache, antes do banco. Checar depois funcionaria igual do ponto de
   * vista da resposta, mas gastaria uma consulta de 5 s na réplica de produção
   * para no fim dizer 403.
   */
  const guarda = await exigirIndicador(req, slug)
  if (!guarda.ok) return guarda.resposta

  let filtros
  try {
    filtros = parsearFiltros(req.nextUrl.searchParams)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json(
        { erro: 'filtros inválidos', detalhes: e.flatten().fieldErrors },
        { status: 400 }
      )
    }
    throw e
  }

  const ind = INDICADORES[slug]
  try {
    // cada indicador tem seu próprio shape de `meta` (alguns não têm nenhum);
    // aqui só precisamos mesclá-lo no envelope, então achatamos o union
    type Env = { data: unknown; meta?: unknown; ms: number }

    // O cache do SERVIDOR é o que importa: o header abaixo só protege o
    // navegador do próprio usuário. Sem este memoizar, cada aba nova paga a
    // query inteira de novo — inviável para a produtividade (~5 s de seq scan).
    // `?atualizar=1` vem do botão da tela: ignora o cache e consulta o banco.
    // O single-flight do memoizar continua valendo, então cliques simultâneos
    // compartilham uma execução só.
    const forcar = req.nextUrl.searchParams.get('atualizar') === '1'
    const chave = chaveDe(slug, filtros)

    // L2 (Redis) entre o L1 e o banco. Só semeia o L1 depois de um redeploy —
    // todo o single-flight/stale-while-revalidate continua no L1, e isto roda
    // DENTRO dele, então concorrência continua compartilhando uma execução só.
    //
    // Não há lista de "quem pode ir pro Redis": `gravarCompartilhado` recusa o
    // que passa de 512 KB, então os agregados entram e os grids grandes ficam
    // de fora por medida, não por catálogo que alguém precisa manter.
    let veioDoRedis = false

    const { valor: r, estado, idadeMs } = await memoizar<Env>(
      chave,
      ind.cacheSegundos,
      async () => {
        // num refresh forçado o L2 é pulado na LEITURA: senão o botão
        // "Atualizar" devolveria o valor compartilhado velho em vez de ir ao ERP
        if (!forcar) {
          const doRedis = await lerCompartilhado<Env>(chave)
          if (doRedis) {
            veioDoRedis = true
            return doRedis
          }
        }
        const fresco = await ind.fn(filtros)
        // sem await: gravar no L2 não pode atrasar a resposta
        void gravarCompartilhado(chave, fresco, ind.cacheSegundos)
        return fresco
      },
      forcar
    )

    return NextResponse.json(
      {
        data: r.data,
        meta: {
          ...(typeof r.meta === 'object' && r.meta !== null ? r.meta : {}),
          slug,
          tier: ind.tier,
          ms: r.ms,
          cache: veioDoRedis ? 'redis' : estado,
          idadeMs,
          filtros,
          geradoEm: new Date(Date.now() - idadeMs).toISOString(),
        },
      },
      {
        headers: {
          // num refresh forçado o navegador NÃO pode servir a cópia dele —
          // senão o botão não faz nada visível
          'cache-control': forcar
            ? 'no-store'
            : `private, max-age=${ind.cacheSegundos}, stale-while-revalidate=${ind.cacheSegundos * 2}`,
        },
      }
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[api/indicadores/${slug}]`, msg)
    // erro de rede/credencial de banco é operacional, não bug de request
    const operacional = /ETIMEDOUT|ECONNREFUSED|password authentication|permission denied|Variável de ambiente/i.test(msg)
    return NextResponse.json(
      { erro: operacional ? 'falha ao acessar a fonte de dados' : 'erro ao calcular o indicador', detalhe: msg },
      { status: operacional ? 503 : 500 }
    )
  }
}
