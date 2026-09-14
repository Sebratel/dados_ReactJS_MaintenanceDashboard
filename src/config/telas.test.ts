import { readdirSync, existsSync } from 'node:fs'
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
 * Quem decide quem as vê é o papel, não a lista de pessoas.
 */
const FORA_DA_MATRIZ = new Set(['/configuracoes'])

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
