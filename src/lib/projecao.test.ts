import { describe, expect, it } from 'vitest'
import { projetarMes, type PontoDiario } from './projecao'

/**
 * A projeção é um número de tela executiva, e o equivalente do Power BI já se
 * provou defeituoso duas vezes. Estes testes fixam as três regras que separam
 * uma coisa da outra:
 *
 *   1. o dia corrente NÃO entra na média (está pela metade)
 *   2. o denominador são os dias com dado, nunca o dia do mês de hoje
 *   3. fora do mês corrente a resposta é `null`, não um número inventado
 */

/** série de 1..n com o mesmo valor por dia */
const serie = (mes: string, ate: number, reparos: number | null): PontoDiario[] =>
  Array.from({ length: ate }, (_, i) => ({
    dia: `${mes}-${String(i + 1).padStart(2, '0')}`,
    reparos,
  }))

describe('projetarMes', () => {
  it('projeta pela média dos dias completos', () => {
    // 1..14 com 100/dia, hoje é 15 → média 100, outubro tem 31 dias
    const p = projetarMes(serie('2026-10', 14, 100), '2026-10-01', '2026-10-15', '2026-10-15')
    expect(p).not.toBeNull()
    expect(p!.diasCompletos).toBe(14)
    expect(p!.mediaDiaria).toBe(100)
    expect(p!.diasDoMes).toBe(31)
    expect(p!.entrantes).toBe(3100)
  })

  it('⚠️ o dia de hoje fica FORA da média — está pela metade', () => {
    // 14 dias cheios de 100 + o dia 15 com 7 (três horas de manhã)
    const pontos = [...serie('2026-10', 14, 100), { dia: '2026-10-15', reparos: 7 }]
    const p = projetarMes(pontos, '2026-10-01', '2026-10-15', '2026-10-15')
    // se o dia 15 entrasse, a média cairia para 93,8 e a projeção para 2.907
    expect(p!.diasCompletos).toBe(14)
    expect(p!.entrantes).toBe(3100)
  })

  it('dia futuro sem medição não vira dia de média', () => {
    const pontos = [...serie('2026-10', 14, 100), ...serie('2026-10', 31, null).slice(14)]
    const p = projetarMes(pontos, '2026-10-01', '2026-10-31', '2026-10-15')
    expect(p!.diasCompletos).toBe(14)
    expect(p!.entrantes).toBe(3100)
  })

  it('⚠️ mês fechado devolve null — projeção ali é o próprio realizado', () => {
    const p = projetarMes(serie('2026-09', 30, 82), '2026-09-01', '2026-09-30', '2026-10-15')
    expect(p).toBeNull()
  })

  it('recorte que não começa no dia 1 devolve null', () => {
    const p = projetarMes(serie('2026-10', 14, 100), '2026-10-05', '2026-10-15', '2026-10-15')
    expect(p).toBeNull()
  })

  it('recorte que parou no passado devolve null', () => {
    const p = projetarMes(serie('2026-10', 9, 100), '2026-10-01', '2026-10-09', '2026-10-15')
    expect(p).toBeNull()
  })

  it('aceita o recorte que vai só até ontem — a carga do dia pode não ter vindo', () => {
    const p = projetarMes(serie('2026-10', 14, 100), '2026-10-01', '2026-10-14', '2026-10-15')
    expect(p).not.toBeNull()
    expect(p!.diasCompletos).toBe(14)
  })

  it('primeiro dia do mês, sem nenhum dia completo, devolve null em vez de dividir por zero', () => {
    const p = projetarMes([{ dia: '2026-10-01', reparos: 12 }], '2026-10-01', '2026-10-01', '2026-10-01')
    expect(p).toBeNull()
  })

  it('série vazia devolve null', () => {
    expect(projetarMes([], '2026-10-01', '2026-10-15', '2026-10-15')).toBeNull()
  })

  it('fevereiro de ano bissexto projeta sobre 29 dias', () => {
    const p = projetarMes(serie('2028-02', 10, 50), '2028-02-01', '2028-02-11', '2028-02-11')
    expect(p!.diasDoMes).toBe(29)
    expect(p!.entrantes).toBe(1450)
  })

  it('ignora dia de outro mês que tenha entrado na série', () => {
    const pontos = [{ dia: '2026-09-30', reparos: 999 }, ...serie('2026-10', 14, 100)]
    const p = projetarMes(pontos, '2026-10-01', '2026-10-15', '2026-10-15')
    expect(p!.diasCompletos).toBe(14)
    expect(p!.mediaDiaria).toBe(100)
  })
})
