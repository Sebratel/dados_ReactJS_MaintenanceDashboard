import { NextResponse, type NextRequest } from 'next/server'
import { ZodError } from 'zod'
import { EIXOS_DATA, parsearFiltros, type Filtros } from '@/lib/filtros'
import { chaveDe, memoizar } from '@/server/cache'
import {
  obterProtocolos,
  type LinhaProtocolo,
  type ResultadoProtocolos,
} from '@/server/indicadores/protocolos'
import {
  CAMPOS_BUSCA,
  colunasDe,
  ehNomeConjunto,
  valorCelula,
  type NomeConjunto,
} from '@/lib/colunasProtocolo'
import { paraCsv } from '@/lib/exportar'
import { fmtData } from '@/lib/formato'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Rota própria do relatório analítico — não entra no `/api/indicadores/[slug]`.
 *
 * O motivo é a forma do dado, não organização. Os outros indicadores devolvem
 * dezenas de linhas agregadas; este devolve milhares de linhas nominais. Três
 * coisas decorrem disso e nenhuma cabe na rota genérica:
 *
 * 1. PAGINAÇÃO DEPOIS DO CACHE. O recorte inteiro é calculado uma vez (~5,4 s no
 *    mês) e guardado; virar de página e buscar só fatiam o array já em memória.
 *    Paginar no SQL custaria os 5,4 s A CADA página, porque o custo está nos
 *    LATERAIS e não no LIMIT.
 * 2. BUSCA EM MEMÓRIA. Se `busca` entrasse em `FiltrosSchema`, cada tecla
 *    mudaria a chave de cache de TODOS os indicadores e o dashboard inteiro
 *    recalcularia. Aqui ela filtra o array em memória: instantânea e sem tocar
 *    no banco.
 * 3. CSV GERADO NO SERVIDOR. Mandar 3,8 MB de JSON ao navegador só para ele
 *    montar o CSV é desperdício; e num trimestre seriam ~16 MB.
 */

const POR_PAGINA_PADRAO = 100
const POR_PAGINA_MAX = 500
const CACHE_SEGUNDOS = 600

function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .toLowerCase()
}

function filtrarPorBusca(linhas: LinhaProtocolo[], busca: string): LinhaProtocolo[] {
  const alvo = normalizar(busca.trim())
  if (!alvo) return linhas
  // String(v) e não `typeof v === 'string'`: o protocolo é int8 no Voalle, então
  // o campo mais buscado de todos é justamente o que um teste de tipo descartaria
  return linhas.filter((l) =>
    CAMPOS_BUSCA.some((c) => {
      const v = l[c]
      return v !== null && v !== undefined && normalizar(String(v)).includes(alvo)
    })
  )
}

/**
 * Rodapé de filtros no CSV — o mesmo recurso que o export do Voalle traz.
 *
 * Não é enfeite: numa auditoria a pasta acumula arquivos e, sem o recorte
 * escrito dentro, comparar dois CSVs de períodos diferentes produz uma
 * "divergência" que nunca existiu.
 */
function rodapeFiltros(f: Filtros, total: number, busca: string): string[] {
  const linhas = [
    '',
    'Filtros aplicados:',
    `Período (${EIXOS_DATA[f.eixo].label}): ${fmtData(f.de)} a ${fmtData(f.ate)}`,
  ]
  const rotulos: [keyof Filtros, string][] = [
    ['base', 'Base'],
    ['cidade', 'Cidade'],
    ['equipe', 'Equipe'],
    ['catalogo', 'Catálogo'],
    ['tipo', 'Tipo de protocolo'],
    ['status', 'Status'],
    ['categoria2', 'Categoria 2'],
    ['tecnico', 'Responsável'],
  ]
  for (const [k, rot] of rotulos) {
    const v = f[k]
    if (Array.isArray(v) && v.length) linhas.push(`${rot}: ${v.join(' | ')}`)
  }
  if (busca.trim()) linhas.push(`Busca: ${busca.trim()}`)
  linhas.push(
    'Universo: equipes de manutenção OU catálogo de manutenção; exclui Cancelado e o cliente de teste'
  )
  // O MTTR é criação→encerramento e passa de 24 h em ~16% das linhas. O texto
  // ("332:42:00") está certo, mas o Excel reconhece o padrão h:mm:ss e pode
  // reinterpretá-lo como hora do dia, exibindo 20:42:00. Quem confere precisa
  // saber disso ANTES de achar que o dashboard errou.
  linhas.push(
    'MTTR em hh:mm:ss, sem truncar em 24h. Se o Excel exibir um valor menor que o da tela, formate a coluna como [h]:mm:ss'
  )
  linhas.push(`Linhas exportadas: ${total}`)
  linhas.push(`Gerado em: ${new Date().toLocaleString('pt-BR')}`)
  return linhas
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams

  let filtros: Filtros
  try {
    filtros = parsearFiltros(sp)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json(
        { erro: 'filtros inválidos', detalhes: e.flatten().fieldErrors },
        { status: 400 }
      )
    }
    throw e
  }

  const forcar = sp.get('atualizar') === '1'
  const busca = sp.get('busca') ?? ''
  const csv = sp.get('formato') === 'csv'
  const conjuntoBruto = sp.get('conjunto') ?? 'voalle'
  const conjunto: NomeConjunto = ehNomeConjunto(conjuntoBruto) ? conjuntoBruto : 'voalle'

  // a chave ignora `busca`, `pagina` e `conjunto` de propósito: os três operam
  // sobre o MESMO conjunto calculado, então compartilham a entrada de cache
  const chave = chaveDe('protocolos', filtros)

  try {
    const {
      valor: r,
      estado,
      idadeMs,
    } = await memoizar<ResultadoProtocolos>(
      chave,
      CACHE_SEGUNDOS,
      () => obterProtocolos(filtros),
      forcar
    )

    const filtradas = filtrarPorBusca(r.data.linhas, busca)

    if (csv) {
      const colunas = colunasDe(conjunto).map((c) => ({ chave: c.chave, rotulo: c.rotulo }))
      const corpo = paraCsv(
        colunas,
        filtradas.map((l) =>
          Object.fromEntries(colunas.map((c) => [c.chave, valorCelula(l, c.chave)]))
        )
      )
      const texto = [corpo, ...rodapeFiltros(filtros, filtradas.length, busca)].join('\r\n')
      // BOM como escape, nunca como caractere literal: literal é invisível no
      // editor e some numa cópia descuidada — aí o Excel abre "São Leopoldo"
      // como "SÃ£o Leopoldo" e ninguém consegue ver a causa lendo o código.
      const BOM = String.fromCharCode(0xfeff)
      return new NextResponse(`${BOM}${texto}`, {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          // "auditoria" no começo do nome a pedido da Manutenção: na pasta de
          // downloads o arquivo tem de se identificar como evidência de
          // auditoria antes de dizer o período.
          'content-disposition': `attachment; filename="auditoria_${filtros.de}_a_${filtros.ate}.csv"`,
          'cache-control': 'no-store',
        },
      })
    }

    const porPagina = Math.min(
      POR_PAGINA_MAX,
      Math.max(1, Number(sp.get('porPagina')) || POR_PAGINA_PADRAO)
    )
    const paginas = Math.max(1, Math.ceil(filtradas.length / porPagina))
    const pagina = Math.min(paginas, Math.max(1, Number(sp.get('pagina')) || 1))
    const inicio = (pagina - 1) * porPagina

    return NextResponse.json(
      {
        data: filtradas.slice(inicio, inicio + porPagina),
        meta: {
          ...r.meta,
          // `total` do indicador é o do recorte; aqui vale o pós-busca, que é o
          // que a paginação da tela precisa
          total: filtradas.length,
          totalRecorte: r.meta.total,
          pagina,
          porPagina,
          paginas,
          slug: 'protocolos',
          tier: 1 as const,
          ms: r.ms,
          cache: estado,
          idadeMs,
          filtros,
          geradoEm: new Date(Date.now() - idadeMs).toISOString(),
        },
      },
      {
        headers: {
          'cache-control': forcar
            ? 'no-store'
            : `private, max-age=${CACHE_SEGUNDOS}, stale-while-revalidate=${CACHE_SEGUNDOS * 2}`,
        },
      }
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[api/protocolos]', msg)
    const operacional =
      /ETIMEDOUT|ECONNREFUSED|password authentication|permission denied|Variável de ambiente/i.test(
        msg
      )
    return NextResponse.json(
      {
        erro: operacional
          ? 'falha ao acessar a fonte de dados'
          : 'erro ao montar o relatório analítico',
        detalhe: msg,
      },
      { status: operacional ? 503 : 500 }
    )
  }
}
