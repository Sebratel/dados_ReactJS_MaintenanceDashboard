import { describe, expect, it } from 'vitest'
import { baldes } from './preventivos'

/**
 * `baldes()` existe para que um dia sem nenhuma preventiva apareça como zero no
 * gráfico, em vez de sumir do eixo. Ela precisa casar EXATAMENTE com o
 * `date_trunc` que a consulta usa para agrupar — se divergir, o balde do banco
 * não encontra o balde da lista e o painel mostra zero onde havia volume.
 *
 * Nada disso é visível em tela: o gráfico continua desenhando, só que errado.
 * Daí os testes.
 */
describe('baldes', () => {
  it('lista todo dia do intervalo, inclusive as pontas', () => {
    const r = baldes('2026-09-01', '2026-09-14', 'dia')
    expect(r).toHaveLength(14)
    expect(r[0]).toBe('2026-09-01')
    expect(r.at(-1)).toBe('2026-09-14')
  })

  it('não pula o dia 1 por causa do fuso de São Paulo', () => {
    // A armadilha real: `new Date('2026-09-01')` em America/Sao_Paulo (UTC−3)
    // cai em 31/08 21:00. Se a aritmética não fosse em UTC, o primeiro balde
    // viraria '2026-08-31' e nunca casaria com o `date_trunc` do Postgres.
    expect(baldes('2026-09-01', '2026-09-01', 'dia')).toEqual(['2026-09-01'])
    expect(baldes('2026-01-01', '2026-01-01', 'mes')).toEqual(['2026-01-01'])
  })

  it('começa a semana na SEGUNDA, como o date_trunc do Postgres', () => {
    // 2026-09-01 é terça; a semana ISO que a contém começa na segunda, 31/08.
    const r = baldes('2026-09-01', '2026-09-14', 'semana')
    expect(r[0]).toBe('2026-08-31')
    expect(r).toEqual(['2026-08-31', '2026-09-07', '2026-09-14'])
  })

  it('a semana que já começa na segunda não recua sete dias', () => {
    expect(baldes('2026-09-07', '2026-09-07', 'semana')).toEqual(['2026-09-07'])
  })

  it('o mês começa no dia 1 e atravessa a virada do ano', () => {
    expect(baldes('2026-11-20', '2027-01-05', 'mes')).toEqual([
      '2026-11-01',
      '2026-12-01',
      '2027-01-01',
    ])
  })

  it('devolve lista vazia para data ilegível em vez de estourar', () => {
    // `de`/`ate` chegam da URL. Um valor inválido não pode derrubar a página.
    expect(baldes('nao-e-data', '2026-09-14', 'dia')).toEqual([])
    expect(baldes('2026-09-01', '', 'dia')).toEqual([])
  })

  it('intervalo invertido não gera balde nenhum nem laço infinito', () => {
    expect(baldes('2026-09-14', '2026-09-01', 'dia')).toEqual([])
  })
})
