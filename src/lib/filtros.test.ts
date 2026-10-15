import { describe, expect, it } from 'vitest'
import { idadeMaximaDias, parsearFiltros } from './filtros'

/**
 * Esta função decide se um cartão mostra um número ou um "—". Errar para MENOS
 * esconde um indicador que já podia ser lido; errar para MAIS volta a afirmar
 * 0,0% onde nada foi medido, que é justamente o defeito que ela corrige.
 *
 * O caso de 14/09/2026 que originou tudo: recorte 01/09–14/09, preventiva mais
 * velha com 13 dias, cartões de 31–60 e 61–90 marcando 0,0%.
 */
describe('idadeMaximaDias', () => {
  const em = (s: string) => new Date(`${s}T12:00:00`)

  it('mede de `de` até hoje, não até `ate`', () => {
    // 01/09 -> 14/09 são 13 dias. É o caso da tela que levantou a pergunta.
    expect(idadeMaximaDias('2026-09-01', em('2026-09-14'))).toBe(13)
  })

  it('a preventiva de hoje tem idade zero', () => {
    expect(idadeMaximaDias('2026-09-14', em('2026-09-14'))).toBe(0)
  })

  it('agosto/2026 dá 44 dias — o caso que prova o limiar de 31 dias', () => {
    // 44 >= 31, então o balde 31–60 é observável e de fato mostrou 0,3%.
    // 44 < 61, então o de 61–90 continua indisponível e segue como "—".
    const idade = idadeMaximaDias('2026-08-01', em('2026-09-14'))
    expect(idade).toBe(44)
    expect(idade! >= 31).toBe(true)
    expect(idade! >= 61).toBe(false)
  })

  it('maio/2026 já passou dos 90 dias — os três baldes abrem', () => {
    const idade = idadeMaximaDias('2026-05-01', em('2026-09-14'))
    expect(idade).toBe(136)
    expect(idade! >= 61).toBe(true)
  })

  it('não desliza um dia conforme a hora do navegador', () => {
    // A armadilha: comparar contra Date.now() cru, em vez de normalizar `hoje`
    // pelos componentes locais, faria a conta pular um dia perto da meia-noite
    // no fuso de São Paulo (UTC−3).
    for (const hora of ['00:00:01', '02:59:59', '12:00:00', '23:59:59']) {
      expect(idadeMaximaDias('2026-09-01', new Date(`2026-09-14T${hora}`))).toBe(13)
    }
  })

  it('atravessa a virada do ano', () => {
    expect(idadeMaximaDias('2025-12-25', em('2026-01-05'))).toBe(11)
  })

  it('data ilegível devolve null, e a tela então não esconde nada', () => {
    // null faz `observavel()` liberar todos os baldes: na dúvida, mostrar o
    // número medido é melhor que sumir com ele por causa de uma URL estranha.
    expect(idadeMaximaDias('nao-e-data')).toBeNull()
    expect(idadeMaximaDias('')).toBeNull()
  })

  it('recorte no futuro não devolve idade negativa', () => {
    expect(idadeMaximaDias('2026-10-01', em('2026-09-14'))).toBe(0)
  })
})

/**
 * ⚠️ ESTES TESTES EXISTEM PORQUE A TELA CAIU.
 *
 * Em 15/10/2026 a Manutenção ajustou o período pela barra de endereços e a URL
 * ficou `?de=2026-08-01&ate=` — com o parâmetro presente e vazio. O `??` só cai
 * no padrão para `undefined`, então a string vazia chegava ao schema, estourava
 * um ZodError e derrubava o dashboard INTEIRO: `parsearFiltros` roda na
 * `BarraFiltros`, que vive no layout.
 *
 * A regra que estes testes fixam é uma só: **nenhuma URL derruba a tela**. Pior
 * recorte possível é o padrão, nunca uma exceção.
 */
describe('parsearFiltros: URL malformada degrada, não quebra', () => {
  const q = (s: string) => parsearFiltros(new URLSearchParams(s))
  const DATA = /^\d{4}-\d{2}-\d{2}$/

  it('o caso real: `ate` presente e vazio', () => {
    const f = q('de=2026-08-01&ate=')
    expect(f.de).toBe('2026-08-01')
    expect(f.ate).toMatch(DATA)
  })

  it('parâmetro vazio é tratado como ausente, não como valor', () => {
    const f = q('de=&ate=&eixo=&dim=')
    expect(f.de).toMatch(DATA)
    expect(f.eixo).toBe('criacao')
  })

  it('descarta só o campo inválido e preserva o resto', () => {
    const f = q('de=2026-08-01&ate=lixo&cidade=Canoas')
    expect(f.de).toBe('2026-08-01')
    expect(f.ate).toMatch(DATA)
    expect(f.cidade).toEqual(['Canoas'])
  })

  it('enum inventado volta ao padrão sem levar o período junto', () => {
    const f = q('de=2026-08-01&ate=2026-08-31&eixo=banana')
    expect(f.eixo).toBe('criacao')
    expect(f.de).toBe('2026-08-01')
    expect(f.ate).toBe('2026-08-31')
  })

  it('período invertido não vira recorte vazio em silêncio', () => {
    // `de` inválido volta ao padrão e pode cair DEPOIS do `ate` que sobreviveu
    const f = q('de=ontem&ate=2026-08-31')
    expect(f.de <= f.ate).toBe(true)
  })

  it('lixo completo ainda devolve um recorte utilizável', () => {
    const f = q('tudo=errado&de=&ate=&limite=abc&classeRec=zzz')
    expect(f.de <= f.ate).toBe(true)
    expect(f.limite).toBeGreaterThan(0)
  })

  it('URL correta passa intacta', () => {
    const f = q('de=2026-08-01&ate=2026-08-31&cidade=Canoas~Esteio&eixo=encerramento')
    expect(f.de).toBe('2026-08-01')
    expect(f.ate).toBe('2026-08-31')
    expect(f.cidade).toEqual(['Canoas', 'Esteio'])
    expect(f.eixo).toBe('encerramento')
  })
})
