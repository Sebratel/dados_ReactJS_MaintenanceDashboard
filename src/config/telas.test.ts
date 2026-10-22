import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { INDICADORES } from '@/server/indicadores'
import { TELAS, TELAS_POR_INDICADOR, telaDoCaminho } from './telas'

/**
 * O catálogo de telas é o contrato de AUTORIZAÇÃO. Uma tela que exista em disco
 * e não esteja nele fica visível para todo mundo do domínio, e ninguém percebe:
 * não há erro, não há log, a tela simplesmente abre para quem não deveria.
 *
 * Este teste é o que transforma esse esquecimento em build vermelho.
 */

const RAIZ_DASHBOARD = join(process.cwd(), 'src', 'app', '(dashboard)')

/** Rotas que existem em disco, pelo `page.tsx` de cada diretório. */
function rotasEmDisco(): string[] {
  const rotas: string[] = []
  if (existsSync(join(RAIZ_DASHBOARD, 'page.tsx'))) rotas.push('/')

  for (const e of readdirSync(RAIZ_DASHBOARD, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    if (existsSync(join(RAIZ_DASHBOARD, e.name, 'page.tsx'))) rotas.push(`/${e.name}`)
  }
  return rotas.sort()
}

/**
 * Rotas do grupo que NÃO são telas de dados e por isso não entram na matriz.
 * Configurações é decidida pelo papel; a Capa é de todos (não mostra dado
 * restrito, só o que o painel é e de onde vêm os números).
 */
const FORA_DA_MATRIZ = new Set(['/configuracoes', '/capa'])

describe('catálogo de telas', () => {
  it('cobre todas as rotas que existem em disco', () => {
    const emDisco = rotasEmDisco().filter((r) => !FORA_DA_MATRIZ.has(r))
    const catalogadas = TELAS.map((t) => t.caminho).sort()
    expect(emDisco).toEqual(catalogadas)
  })

  it('não tem id nem caminho repetido', () => {
    expect(new Set(TELAS.map((t) => t.id)).size).toBe(TELAS.length)
    expect(new Set(TELAS.map((t) => t.caminho)).size).toBe(TELAS.length)
  })

  it('casa o caminho exato, nunca por prefixo', () => {
    expect(telaDoCaminho('/protocolos')?.id).toBe('protocolos')
    expect(telaDoCaminho('/protocolos/export')).toBeUndefined()
    expect(telaDoCaminho('/nao-existe')).toBeUndefined()
  })
})

describe('mapa de indicador para tela', () => {
  /**
   * Indicador sem mapa é recusado pela guarda (`indicador-sem-mapa`), então
   * esquecer não abre buraco — mas quebra a tela em produção. Melhor aqui.
   */
  it('mapeia TODOS os indicadores registrados', () => {
    const registrados = Object.keys(INDICADORES).sort()
    const mapeados = Object.keys(TELAS_POR_INDICADOR).sort()
    expect(mapeados).toEqual(registrados)
  })

  it('só aponta para telas que existem no catálogo', () => {
    const ids = new Set(TELAS.map((t) => t.id))
    for (const [indicador, telas] of Object.entries(TELAS_POR_INDICADOR)) {
      expect(telas.length, `${indicador} sem tela`).toBeGreaterThan(0)
      for (const t of telas) expect(ids.has(t), `${indicador} → ${t}`).toBe(true)
    }
  })

  it('mantém os indicadores nominais restritos a UMA tela cada', () => {
    // Se um destes passar a alimentar várias telas, a regra "acesso a pelo menos
    // uma" deixa de restringir dado nominal — e isso precisa ser uma decisão,
    // não um efeito colateral.
    for (const nominal of ['produtividade', 'ofensores', 'recorrencia'] as const) {
      expect(TELAS_POR_INDICADOR[nominal]).toHaveLength(1)
    }
  })
})

/**
 * O catálogo ganhou um SEGUNDO uso em 14/09/2026: `BarraFiltros` pergunta a ele
 * se a rota atual é tela de dados, e se não for não se desenha.
 *
 * Antes quem decidia era o `(dashboard)/layout.tsx`, comparando com
 * '/configuracoes'. A regra estava certa e o valor não chegava — o App Router
 * reaproveita o layout compartilhado, então o caminho ficava o da tela anterior
 * e a barra SUMIA de Tempos na volta pelo menu. Ver item Z de docs/06.
 *
 * Estes testes prendem o contrato novo: se alguém tirar `/configuracoes` do
 * limbo e colocá-lo no catálogo, a barra de filtros volta a aparecer lá — e o
 * build avisa antes de a tela fazer isso em produção.
 */
describe('telaDoCaminho como regra da barra de filtros', () => {
  const AS_OITO = ['/', '/operacao', '/tempos', '/produtividade', '/recorrencia',
    '/preventivos', '/ofensores', '/protocolos']

  it('reconhece as 8 telas de dados — nelas a barra aparece', () => {
    for (const caminho of AS_OITO) {
      expect(telaDoCaminho(caminho), `${caminho} deveria estar no catálogo`).toBeDefined()
    }
  })

  it('NÃO reconhece /configuracoes nem /capa — lá não há o que recortar', () => {
    expect(telaDoCaminho('/configuracoes')).toBeUndefined()
    expect(telaDoCaminho('/capa')).toBeUndefined()
  })

  it('rota desconhecida nasce SEM barra, em vez de esperar quem a proíba', () => {
    // O oposto de uma lista de proibidos: tela nova que não seja de dados não
    // precisa ser lembrada por ninguém para não ganhar filtro que não usa.
    expect(telaDoCaminho('/rota-que-ainda-nao-existe')).toBeUndefined()
    expect(telaDoCaminho('/login')).toBeUndefined()
  })
})

/**
 * O PORTÃO MORA EM CADA PÁGINA — e por isso cada página precisa tê-lo.
 *
 * Desde 22/10/2026 quem decide se a tela abre é `<PaginaProtegida>`, dentro do
 * `page.tsx` (o layout decidia com o caminho da tela anterior — item Z de
 * docs/06). O risco que isso troca de lugar é a página nova nascer sem o
 * portão: aberta para todo mundo, sem erro nenhum. Este teste lê as páginas em
 * disco e transforma esse esquecimento em build vermelho — e pega também a
 * página que declara a tela ERRADA, que abriria pela regra de outra.
 */
describe('toda página do grupo passa pelo portão', () => {
  const esperado = (rota: string): string =>
    rota === '/configuracoes' ? 'configuracoes'
      : rota === '/capa' ? 'capa'
        : (telaDoCaminho(rota)?.id ?? `(rota ${rota} fora do catálogo)`)

  for (const rota of rotasEmDisco()) {
    it(`${rota} usa <PaginaProtegida tela="${esperado(rota)}">`, () => {
      const arq = join(RAIZ_DASHBOARD, rota === '/' ? '' : rota.slice(1), 'page.tsx')
      const fonte = readFileSync(arq, 'utf8')
      const telas = [...fonte.matchAll(/<PaginaProtegida\s+tela="([^"]+)"/g)].map((m) => m[1])
      expect(telas).toEqual([esperado(rota)])
    })
  }
})
