import { describe, expect, it } from 'vitest'
import { idadeMaximaDias } from './filtros'

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
