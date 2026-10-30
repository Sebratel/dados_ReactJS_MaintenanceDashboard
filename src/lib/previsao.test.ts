import { describe, expect, it } from 'vitest'
import {
  aglomeracoes,
  avaliarPrevisao,
  bairrosEmAlta,
  caudaPoisson,
  classificarAgendamento,
  curvaDeFechamento,
  limparMotivo,
  diaDaSemana,
  faixaAtual,
  loginsCronicos,
  perfilDoCampo,
  planejarCampo,
  preverDia,
  preverProximos,
  riscoDoAberto,
  somarDias,
  taxasDeVolta,
  type DiaBairro,
  type DiaCampo,
  type ReparoLogin,
} from './previsao'

/**
 * A tela de Predições afirma números sobre o futuro, e o único jeito de
 * confiar neles é as regras estarem presas aqui: o que entra na mediana, o
 * que é feriado, que a avaliação nunca vê o dia que avalia, e que a curva de
 * 48h conta quem continua aberto.
 */

/** Série diária de `dias` dias até `fim`, com valor por dia da semana. */
function serieSemanal(fim: string, dias: number, porDow: number[]): Map<string, number> {
  const s = new Map<string, number>()
  for (let i = dias - 1; i >= 0; i--) {
    const d = somarDias(fim, -i)
    s.set(d, porDow[diaDaSemana(d)]!)
  }
  return s
}

// dom, seg, ter, qua, qui, sex, sáb
const PERFIL = [40, 100, 90, 92, 91, 88, 65]
const SEM_FERIADO = {}

describe('datas', () => {
  it('soma dias atravessando mês e ano sem depender de fuso', () => {
    expect(somarDias('2026-10-31', 1)).toBe('2026-11-01')
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01')
    expect(somarDias('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('dia da semana é 0 = domingo', () => {
    expect(diaDaSemana('2026-10-25')).toBe(0)
    expect(diaDaSemana('2026-10-22')).toBe(4)
  })
})

describe('preverDia', () => {
  const serie = serieSemanal('2026-10-21', 120, PERFIL)

  it('é a mediana das 8 últimas ocorrências do mesmo dia da semana', () => {
    expect(preverDia(serie, '2026-10-26', '2026-10-21', SEM_FERIADO)).toBe(100) // segunda
    expect(preverDia(serie, '2026-10-25', '2026-10-21', SEM_FERIADO)).toBe(40) // domingo
  })

  it('feriado é previsto como sábado', () => {
    expect(preverDia(serie, '2026-11-02', '2026-10-21', { '2026-11-02': 'Finados' })).toBe(65)
  })

  it('feriado do passado sai da mediana do dia em que caiu', () => {
    const s = new Map(serie)
    // quatro segundas de feriado com 10 reparos puxariam a mediana para baixo
    const feriados: Record<string, string> = {}
    for (const d of ['2026-10-19', '2026-10-12', '2026-10-05', '2026-09-28']) {
      s.set(d, 10)
      feriados[d] = 'feriado'
    }
    expect(preverDia(s, '2026-10-26', '2026-10-21', feriados)).toBe(100)
  })

  it('só usa o que se sabia na origem', () => {
    const s = new Map(serie)
    s.set('2026-10-19', 1000) // segunda DEPOIS da origem
    expect(preverDia(s, '2026-10-26', '2026-10-18', SEM_FERIADO)).toBe(100)
  })

  it('devolve null com menos de 4 ocorrências', () => {
    const curta = serieSemanal('2026-10-21', 20, PERFIL)
    expect(preverDia(curta, '2026-10-26', '2026-10-21', SEM_FERIADO)).toBeNull()
  })
})

describe('avaliação e faixa', () => {
  it('série perfeitamente semanal: erro zero, faixa sem largura, cobertura total', () => {
    const serie = serieSemanal('2026-10-21', 230, PERFIL)
    const av = avaliarPrevisao(serie, '2026-10-21', SEM_FERIADO)!
    expect(av.erroMedio).toBe(0)
    expect(av.razaoMin).toBe(1)
    expect(av.razaoMax).toBe(1)
    expect(av.cobertura).toBe(1)
    expect(av.diasAvaliados).toBe(56)
    expect(av.porHorizonte).toHaveLength(14)
    expect(av.semanaAntes).toHaveLength(56)
  })

  it('a faixa da avaliação não vê os dias avaliados', () => {
    // as 8 últimas semanas dobram: a faixa calibrada antes delas não pode
    // ter aprendido isso, então nenhuma previsão avaliada cobre o realizado
    const serie = serieSemanal('2026-10-21', 230, PERFIL)
    for (let i = 0; i < 56; i++) {
      const d = somarDias('2026-10-21', -i)
      serie.set(d, serie.get(d)! * 2)
    }
    const av = avaliarPrevisao(serie, '2026-10-21', SEM_FERIADO)!
    expect(av.razaoMax).toBe(1)
    expect(av.cobertura).toBeLessThan(0.5)
  })

  it('histórico curto não avalia', () => {
    expect(avaliarPrevisao(serieSemanal('2026-10-21', 100, PERFIL), '2026-10-21', SEM_FERIADO)).toBeNull()
  })

  it('a previsão começa hoje, com faixa e feriado marcados', () => {
    const serie = serieSemanal('2026-10-21', 230, PERFIL)
    const faixa = faixaAtual(serie, '2026-10-21', SEM_FERIADO)!
    const p = preverProximos(serie, '2026-10-22', { '2026-11-02': 'Finados' }, faixa)
    expect(p).toHaveLength(14)
    expect(p[0]!.dia).toBe('2026-10-22')
    expect(p[0]!.previsto).toBe(91)
    expect(p.find((x) => x.dia === '2026-11-02')).toMatchObject({ previsto: 65, feriado: 'Finados' })
    const largura = preverProximos(serie, '2026-10-22', SEM_FERIADO, { razaoMin: 0.5, razaoMax: 1.5 })[0]!
    expect([largura.min, largura.max]).toEqual([46, 137])
  })
})

describe('campo', () => {
  const campo: DiaCampo[] = []
  for (let i = 1; i <= 56; i++) {
    const dia = somarDias('2026-10-22', -i)
    const dow = diaDaSemana(dia)
    const tecnicos = dow === 0 ? 8 : dow === 6 ? 12 : 28
    campo.push({ dia, visitasReparo: tecnicos * 3, visitasPrev: tecnicos * 3, tecnicos })
  }

  it('perfil é a mediana por dia da semana; feriado fica fora', () => {
    const comFeriado = campo.map((c) => (c.dia === '2026-10-12' ? { ...c, tecnicos: 1, visitasReparo: 1, visitasPrev: 0 } : c))
    const perfis = perfilDoCampo(comFeriado, { '2026-10-12': 'Aparecida' })
    expect(perfis[1]).toEqual({ tecnicos: 28, visitas: 168, visitasPorTecnico: 6 })
    expect(perfis[0]!.visitas).toBe(48)
  })

  it('folga = ritmo típico − visitas de reparo; feriado usa o sábado', () => {
    const perfis = perfilDoCampo(campo, SEM_FERIADO)
    const plano = planejarCampo(
      [
        { dia: '2026-10-26', previsto: 100, min: 80, max: 130, feriado: null },
        { dia: '2026-10-25', previsto: 60, min: 40, max: 80, feriado: null },
        { dia: '2026-11-02', previsto: 65, min: 50, max: 85, feriado: 'Finados' },
      ],
      perfis,
      1.1,
      { '2026-11-02': 'Finados' }
    )
    expect(plano[0]).toMatchObject({ demanda: 110, capacidade: 168, folga: 58, tecnicosTipicos: 28, tecnicosParaReparo: 19 })
    expect(plano[1]!.folga).toBe(-18) // domingo: 66 visitas de reparo para um ritmo de 48
    expect(plano[2]!.capacidade).toBe(72) // feriado no ritmo de sábado
  })
})

describe('curva de 48h e risco dos abertos', () => {
  // 100 reparos: 50 fecham em 10h, 30 em 30h, 10 em 60h, 10 seguem abertos
  const hist = [
    { hora: 10, n: 50 },
    { hora: 30, n: 30 },
    { hora: 60, n: 10 },
    { hora: -1, n: 10 },
  ]
  const curva = curvaDeFechamento(hist)!

  it('quem continua aberto conta como passou de 48h', () => {
    expect(curva.passa[0]).toBeCloseTo(0.2)
    expect(curva.passa[20]).toBeCloseTo(20 / 50)
    expect(curva.passa[40]).toBeCloseTo(1)
    expect(curva.amostra).toBe(100)
  })

  it('percentis contam os abertos no fim da fila', () => {
    expect(curva.p50).toBe(11)
    expect(curva.p90).toBe(61)
  })

  it('risco: estourou, agenda depois de 48h, ou a curva na idade', () => {
    expect(riscoDoAberto(curva, 50, '2026-10-20 08:00', null)).toEqual({ risco: 1, motivo: 'estourou' })
    expect(riscoDoAberto(curva, 5, '2026-10-22 08:00', '2026-10-24 09:00')).toEqual({ risco: 1, motivo: 'agenda-tarde' })
    expect(riscoDoAberto(curva, 20.7, '2026-10-21 12:00', '2026-10-22 14:00')).toEqual({
      risco: curva.passa[20],
      motivo: 'curva',
    })
  })
})

describe('rede', () => {
  const linhas: DiaBairro[] = []
  for (let i = 0; i < 112; i++) {
    const dia = somarDias('2026-10-21', -i)
    linhas.push({ dia, cidade: 'Canoas', bairro: 'Estável', n: 1 })
    // dobra nas 4 últimas semanas
    linhas.push({ dia, cidade: 'Canoas', bairro: 'Em alta', n: i < 28 ? 2 : 1 })
    if (i % 14 === 0) linhas.push({ dia, cidade: 'Canoas', bairro: 'Pequeno', n: i < 28 ? 3 : 1 })
  }

  it('acha o bairro que dobrou e ignora o estável e o pequeno', () => {
    const alta = bairrosEmAlta(linhas, '2026-10-21')
    expect(alta.map((b) => b.bairro)).toEqual(['Em alta'])
    expect(alta[0]).toMatchObject({ recente: 56, esperado: 28 })
    expect(alta[0]!.razao).toBeCloseTo(2)
  })

  it('cauda de Poisson', () => {
    expect(caudaPoisson(0, 3)).toBe(1)
    expect(caudaPoisson(2, 1)).toBeCloseTo(1 - 2 * Math.exp(-1), 10)
  })

  it('pico de um dia num bairro calmo, só nos últimos 14 dias', () => {
    const comPico = [
      ...linhas,
      { dia: '2026-10-15', cidade: 'São Leopoldo', bairro: 'Feitoria', n: 12 },
      { dia: '2026-09-22', cidade: 'São Leopoldo', bairro: 'Feitoria', n: 50 },
    ]
    const ag = aglomeracoes(comPico, '2026-10-21')
    expect(ag.map((a) => [a.dia, a.bairro, a.n])).toEqual([['2026-10-15', 'Feitoria', 12]])
  })
})

describe('clientes', () => {
  const r = (instalacao: string, dia: string): ReparoLogin => ({ instalacao, dia, cidade: 'Canoas', bairro: 'Centro' })

  it('taxa de volta por classe, com referências que cabem inteiras no histórico', () => {
    const reparos: ReparoLogin[] = [r('marco', '2026-03-01')]
    // "volta": reparo a cada 20 dias, sempre volta em 30
    for (let d = '2026-03-10'; d <= '2026-10-01'; d = somarDias(d, 20)) reparos.push(r('volta', d))
    // "uma": um reparo só, nunca volta
    reparos.push(r('uma', '2026-06-01'))
    const tx = taxasDeVolta(reparos, '2026-10-21')
    // referências de 30/05 (= 01/03 + 90) até 21/09 (= 21/10 − 30), a cada 7 dias
    expect(tx.referencias).toBe(17)
    const total = tx.porReparos.reduce((s, c) => s + c.observados, 0)
    expect(total).toBeGreaterThan(0)
    // "volta" abre reparo depois de todas as 17 referências, sempre com
    // histórico; "uma" abre o dela (01/06) logo após a de 30/05 sem ter nada
    // antes — é o cliente quieto que a concentração existe para mostrar
    expect(tx.concentracao).toBeCloseTo(17 / 18)
    const umaVez = tx.classes.filter((c) => c.reparos === '1')
    expect(umaVez.every((c) => c.taxa < 1)).toBe(true)
  })

  it('crônicos: 3+ nos últimos 90 dias, mais reparos primeiro', () => {
    const reparos = [
      r('a', '2026-10-01'), r('a', '2026-09-01'), r('a', '2026-08-01'),
      r('b', '2026-10-20'), r('b', '2026-10-10'), r('b', '2026-09-10'), r('b', '2026-08-10'),
      // o terceiro de "c" é de antes da janela
      r('c', '2026-10-20'), r('c', '2026-10-01'), r('c', '2026-06-01'),
    ]
    const cr = loginsCronicos(reparos, '2026-10-22')
    expect(cr.map((c) => [c.instalacao, c.reparos90, c.diasDesde])).toEqual([
      ['b', 4, 2],
      ['a', 3, 21],
    ])
  })
})

/**
 * Os casos são protocolos reais de outubro/2026, conferidos com a Manutenção
 * em 29/10 — cada um é um dos desenhos de divergência entre checklist e máscara.
 */
describe('1º agendamento: checklist primeiro, máscara quando o checklist não diz nada', () => {
  it('limparMotivo: vazio, pontuação e "sim" não são motivo; o resto do relato é cortado', () => {
    expect(limparMotivo('.')).toBeNull()
    expect(limparMotivo('.,')).toBeNull()
    expect(limparMotivo('...')).toBeNull()
    expect(limparMotivo('sim')).toBeNull()
    expect(limparMotivo('(Detalhar pedido do cliente) __________________ ')).toBeNull()
    expect(limparMotivo(': só esta de noite · Número da CTO: SLE-C-1')).toBe('só esta de noite')
    expect(limparMotivo('\n\n· Número da CTO: SLE-C-048-1-1-15/4\n=====')).toBeNull()
  })

  it('1857177: checklist com motivo escrito vence a máscara', () => {
    const c = classificarAgendamento({
      chkPedido: '1', chkMotivo: 'Cliente só pode no turno noite.',
      mascara: 'agenda', mascaraMotivo: '(Detalhar pedido do cliente) ____',
    })
    expect(c).toEqual({ classe: 'pedido', motivo: 'Cliente só pode no turno noite.' })
  })

  it('1866234: checklist "Sim" sem motivo que discorda da máscara perde para ela', () => {
    const c = classificarAgendamento({ chkPedido: '1', chkMotivo: '.', mascara: 'agenda', mascaraMotivo: null })
    expect(c.classe).toBe('agenda')
  })

  it('1861419: checklist "Não" sem motivo × máscara com pedido detalhado — vale a máscara', () => {
    const c = classificarAgendamento({
      chkPedido: '0', chkMotivo: '.,',
      mascara: 'pedido', mascaraMotivo: '(Detalhar pedido do cliente) _____cliente so esta em casa após as 19:00_____',
    })
    expect(c).toEqual({ classe: 'pedido', motivo: 'cliente so esta em casa após as 19:00' })
  })

  it('checklist sem motivo mas que CONCORDA com a máscara continua valendo', () => {
    const c = classificarAgendamento({ chkPedido: '0', chkMotivo: '.', mascara: 'agenda', mascaraMotivo: null })
    expect(c.classe).toBe('agenda')
  })

  it('sem checklist vale a máscara; sem nenhum dos dois, sem classificação', () => {
    expect(classificarAgendamento({ chkPedido: null, chkMotivo: null, mascara: 'pedido', mascaraMotivo: ': não pode hoje' }))
      .toEqual({ classe: 'pedido', motivo: 'não pode hoje' })
    expect(classificarAgendamento({ chkPedido: null, chkMotivo: null, mascara: null, mascaraMotivo: null }))
      .toEqual({ classe: null, motivo: null })
  })
})
