/**
 * As contas da tela de Predições — sem banco e sem React, para poderem ser
 * testadas e rodarem dos dois lados (o servidor monta as previsões; o cliente
 * cruza a curva de fechamento com os abertos de agora).
 *
 * ── O MÉTODO FOI ESCOLHIDO POR BACKTEST, NÃO POR GOSTO ────────────────────
 *
 * Em 22/10/2026, sobre 26 semanas de reparo diário, prevendo cada dia de 1 a
 * 14 dias antes e só com o que se sabia na véspera, a MEDIANA das 8 últimas
 * semanas do mesmo dia da semana errou menos (erro médio de ~17 reparos/dia,
 * ~19%) que a média das mesmas 8 semanas e que "nível dos últimos 28 dias ×
 * perfil do dia da semana". A mediana ganha porque um dia de pane — 22/09/2026
 * teve 249 reparos — não arrasta a previsão das oito semanas seguintes.
 *
 * Nada aqui é modelo treinado: são contagens, medianas e proporções que a
 * Manutenção consegue refazer numa planilha. A tela diz isso, e a aba
 * Confiabilidade mostra o quanto cada conta acertou no passado recente.
 *
 * ⚠️ DATAS SÃO TEXTO 'YYYY-MM-DD' E A ARITMÉTICA É EM UTC PURO. O "hoje" vem
 * do Postgres (`current_date`), nunca do relógio do processo — o fuso do
 * contêiner mudaria o dia da semana de um alvo e a previsão inteira.
 */

const DIA_MS = 86_400_000
const SABADO = 6

export type Feriados = Readonly<Record<string, string>>

export function somarDias(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10)
}

/** 0 = domingo … 6 = sábado. */
export function diaDaSemana(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay()
}

/** Horas entre dois instantes 'YYYY-MM-DD HH:MI', lidos sem fuso. */
export function horasEntre(de: string, ate: string): number {
  const t = (s: string) => Date.parse(`${s.replace(' ', 'T')}:00Z`)
  return (t(ate) - t(de)) / 3_600_000
}

export function mediana(v: readonly number[]): number | null {
  if (v.length === 0) return null
  const s = [...v].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/**
 * Quantil por posição, sem interpolação: devolve um valor que de fato
 * aconteceu. É o mesmo do estudo que calibrou a faixa — trocar por um quantil
 * interpolado mudaria a faixa sem ninguém ter decidido isso.
 */
export function quantil(ordenados: readonly number[], p: number): number | null {
  if (ordenados.length === 0) return null
  return ordenados[Math.floor(p * (ordenados.length - 1))]!
}

/**
 * O dia da semana cujo histórico prevê `iso`: o próprio, ou SÁBADO se for
 * feriado. Ver a nota de `FERIADOS` em regras-negocio.ts para os números.
 */
export function perfilDoDia(iso: string, feriados: Feriados): number {
  return feriados[iso] ? SABADO : diaDaSemana(iso)
}

/** Quantas ocorrências do mesmo dia da semana entram na mediana. */
export const SEMANAS_PREVISAO = 8

/** Até quantos dias à frente a tela prevê — e o que a calibração cobre. */
export const HORIZONTE = 14

/**
 * Previsão de UM dia: mediana das 8 últimas ocorrências do mesmo perfil, até a
 * `origem` (o último dia que se conhecia quando a previsão foi feita).
 *
 * Feriado do passado fica fora da mediana: uma segunda-feira de feriado no
 * histórico puxaria para baixo a previsão de todas as segundas seguintes.
 * Com menos de 4 ocorrências a resposta é `null` — mediana de duas semanas
 * não é previsão, é palpite.
 */
export function preverDia(
  serie: ReadonlyMap<string, number>,
  alvo: string,
  origem: string,
  feriados: Feriados,
  semanas = SEMANAS_PREVISAO
): number | null {
  const perfil = perfilDoDia(alvo, feriados)
  let d = somarDias(origem, -((diaDaSemana(origem) - perfil + 7) % 7))
  const vals: number[] = []
  for (let k = 0; k < 30 && vals.length < semanas; k++, d = somarDias(d, -7)) {
    if (feriados[d]) continue
    const v = serie.get(d)
    if (v !== undefined) vals.push(v)
  }
  return vals.length >= Math.ceil(semanas / 2) ? mediana(vals) : null
}

export type PontoPrevisao = {
  dia: string
  previsto: number
  /** faixa em que 8 de cada 10 dias caíram na calibração */
  min: number
  max: number
  feriado: string | null
}

export type PontoAvaliacao = { dia: string; real: number; previsto: number; min: number; max: number }

export type Avaliacao = {
  /** real ÷ previsto nos percentis 10 e 90 da calibração — a largura da faixa */
  razaoMin: number
  razaoMax: number
  /** erro médio absoluto, em reparos/dia, na janela de avaliação */
  erroMedio: number
  /** o mesmo erro em fração do realizado */
  erroPercentual: number
  /** fração das previsões avaliadas que caiu dentro da faixa (o esperado é 0,8) */
  cobertura: number
  previsoesAvaliadas: number
  diasAvaliados: number
  porHorizonte: { horizonte: number; erroMedio: number; cobertura: number }[]
  /** o que se previa com 7 dias de antecedência × o que aconteceu */
  semanaAntes: PontoAvaliacao[]
}

/** Janelas do backtest: calibra a faixa num trecho e mede o acerto no seguinte. */
export const DIAS_AVALIACAO = 56
export const DIAS_CALIBRACAO = 84

export type Faixa = { razaoMin: number; razaoMax: number }

/**
 * A largura da faixa: real ÷ previsto nos percentis 10 e 90, com cada dia de
 * `de` a `ate` previsto 14 vezes (de 1 a 14 dias antes), cada vez só com o que
 * se sabia na origem.
 */
export function calibrarFaixa(
  serie: ReadonlyMap<string, number>,
  de: string,
  ate: string,
  feriados: Feriados
): Faixa | null {
  const razoes: number[] = []
  for (let a = de; a <= ate; a = somarDias(a, 1)) {
    const real = serie.get(a)
    if (real === undefined) continue
    for (let h = 1; h <= HORIZONTE; h++) {
      const p = preverDia(serie, a, somarDias(a, -h), feriados)
      if (p) razoes.push(real / p)
    }
  }
  // menos de ~um mês de previsões calibradas não sustenta um percentil 10
  if (razoes.length < 300) return null
  razoes.sort((x, y) => x - y)
  return { razaoMin: quantil(razoes, 0.1)!, razaoMax: quantil(razoes, 0.9)! }
}

/**
 * A faixa que a tela desenha para os próximos dias: calibrada nas 20 semanas
 * mais recentes, as de avaliação incluídas.
 *
 * ⚠️ NÃO É A MESMA FAIXA QUE A AVALIAÇÃO MEDE, e de propósito. A avaliação
 * precisa de uma faixa que não viu os dias avaliados; a previsão precisa da
 * faixa mais atual possível. Em 22/10/2026 as 8 semanas avaliadas tinham a
 * pane de Feitoria (22/09, 249 reparos no dia) e a faixa calibrada antes dela
 * cobriu só 68% — a recalibrada a incorpora e sai mais larga.
 */
export function faixaAtual(serie: ReadonlyMap<string, number>, ultimo: string, feriados: Feriados): Faixa | null {
  return calibrarFaixa(serie, somarDias(ultimo, -(DIAS_AVALIACAO + DIAS_CALIBRACAO) + 1), ultimo, feriados)
}

/**
 * Backtest honesto: a faixa é calibrada nas 12 semanas ANTERIORES à janela de
 * avaliação, e o acerto é medido nas 8 semanas mais recentes — dias que não
 * ajudaram a desenhar a faixa. Medir a cobertura nos mesmos dias que a
 * calibraram daria 80% por construção e não diria nada.
 *
 * `ultimo` é o último dia COMPLETO — hoje está pela metade.
 */
export function avaliarPrevisao(
  serie: ReadonlyMap<string, number>,
  ultimo: string,
  feriados: Feriados
): Avaliacao | null {
  const inicioAvaliacao = somarDias(ultimo, -DIAS_AVALIACAO + 1)
  const faixa = calibrarFaixa(
    serie,
    somarDias(inicioAvaliacao, -DIAS_CALIBRACAO),
    somarDias(inicioAvaliacao, -1),
    feriados
  )
  if (!faixa) return null
  const { razaoMin, razaoMax } = faixa

  const porH = Array.from({ length: HORIZONTE }, () => ({ erro: 0, dentro: 0, n: 0 }))
  let erro = 0
  let erroPct = 0
  let nPct = 0
  let dentro = 0
  let n = 0
  let dias = 0
  const semanaAntes: PontoAvaliacao[] = []

  for (let a = inicioAvaliacao; a <= ultimo; a = somarDias(a, 1)) {
    const real = serie.get(a)
    if (real === undefined) continue
    dias++
    for (let h = 1; h <= HORIZONTE; h++) {
      const p = preverDia(serie, a, somarDias(a, -h), feriados)
      if (!p) continue
      const e = Math.abs(real - p)
      const ok = real >= p * razaoMin && real <= p * razaoMax
      erro += e
      if (real > 0) {
        erroPct += e / real
        nPct++
      }
      dentro += ok ? 1 : 0
      n++
      porH[h - 1]!.erro += e
      porH[h - 1]!.dentro += ok ? 1 : 0
      porH[h - 1]!.n++
      if (h === 7) {
        semanaAntes.push({
          dia: a,
          real,
          previsto: Math.round(p),
          min: Math.round(p * razaoMin),
          max: Math.round(p * razaoMax),
        })
      }
    }
  }
  if (n === 0) return null

  return {
    razaoMin,
    razaoMax,
    erroMedio: erro / n,
    erroPercentual: nPct ? erroPct / nPct : 0,
    cobertura: dentro / n,
    previsoesAvaliadas: n,
    diasAvaliados: dias,
    porHorizonte: porH.map((x, i) => ({
      horizonte: i + 1,
      erroMedio: x.n ? x.erro / x.n : 0,
      cobertura: x.n ? x.dentro / x.n : 0,
    })),
    semanaAntes,
  }
}

/**
 * Os próximos dias, de HOJE em diante. A origem é ONTEM, o último dia
 * completo: hoje entra como alvo (com horizonte 1), nunca como histórico.
 */
export function preverProximos(
  serie: ReadonlyMap<string, number>,
  hoje: string,
  feriados: Feriados,
  { razaoMin, razaoMax }: Faixa,
  dias = HORIZONTE
): PontoPrevisao[] {
  const origem = somarDias(hoje, -1)
  const saida: PontoPrevisao[] = []
  for (let i = 0; i < dias; i++) {
    const alvo = somarDias(hoje, i)
    const p = preverDia(serie, alvo, origem, feriados)
    if (p === null) continue
    saida.push({
      dia: alvo,
      previsto: Math.round(p),
      min: Math.round(p * razaoMin),
      max: Math.round(p * razaoMax),
      feriado: feriados[alvo] ?? null,
    })
  }
  return saida
}

// ── O campo dá conta? ──────────────────────────────────────────────────────

export type DiaCampo = { dia: string; visitasReparo: number; visitasPrev: number; tecnicos: number }

export type PerfilCampo = {
  tecnicos: number
  /** visitas de reparo + preventiva num dia típico desse dia da semana */
  visitas: number
  visitasPorTecnico: number
}

/**
 * O ritmo típico do campo por dia da semana: mediana de técnicos, de visitas e
 * de visitas por técnico nas últimas 8 semanas.
 *
 * Feriado fica fora e é previsto como SÁBADO, pelo mesmo motivo da entrada de
 * reparo — e o campo confirma: 07/09/2026 teve 88 visitas com 19 técnicos e
 * 12/10/2026 teve 66 com 16, perto de um sábado (~82 com 12 a 13).
 */
export function perfilDoCampo(campo: readonly DiaCampo[], feriados: Feriados): (PerfilCampo | null)[] {
  return Array.from({ length: 7 }, (_, dow) => {
    const dias = campo.filter((c) => !feriados[c.dia] && diaDaSemana(c.dia) === dow && c.tecnicos > 0)
    if (dias.length < 3) return null
    return {
      tecnicos: mediana(dias.map((c) => c.tecnicos))!,
      visitas: mediana(dias.map((c) => c.visitasReparo + c.visitasPrev))!,
      visitasPorTecnico: mediana(dias.map((c) => (c.visitasReparo + c.visitasPrev) / c.tecnicos))!,
    }
  })
}

/**
 * Quantas visitas de campo cada reparo que entra consome, em média: visitas de
 * reparo ÷ reparos que entraram, nos mesmos dias. Abaixo de 1 porque parte se
 * resolve remoto; acima de 1 quando há muita revisita.
 */
export function visitasPorReparo(campo: readonly DiaCampo[], serie: ReadonlyMap<string, number>): number | null {
  let visitas = 0
  let reparos = 0
  for (const c of campo) {
    const r = serie.get(c.dia)
    if (r === undefined) continue
    visitas += c.visitasReparo
    reparos += r
  }
  return reparos > 0 ? visitas / reparos : null
}

export type DiaPlano = {
  dia: string
  feriado: string | null
  reparosPrevistos: number
  /** visitas de reparo que a entrada prevista deve consumir */
  demanda: number
  /** visitas que o campo faz num dia típico como este */
  capacidade: number
  tecnicosTipicos: number
  tecnicosParaReparo: number
  /** capacidade − demanda: o espaço que sobra para preventiva no ritmo de sempre */
  folga: number
}

/**
 * Previsão de entrada × ritmo típico do campo, dia a dia.
 *
 * ⚠️ É O RITMO DE SEMPRE, NÃO A CAPACIDADE MÁXIMA. "Capacidade" aqui é o que
 * o time costuma fazer naquele dia da semana; a folga diz quanto sobra para
 * preventiva se nada mudar. E o reparo de domingo é atendido na segunda: lido
 * dia a dia, o domingo parece apertado e a segunda folgada — a soma da semana
 * é a leitura certa, e a tela a mostra.
 */
export function planejarCampo(
  previsao: readonly PontoPrevisao[],
  perfis: readonly (PerfilCampo | null)[],
  razao: number,
  feriados: Feriados
): DiaPlano[] {
  const saida: DiaPlano[] = []
  for (const p of previsao) {
    const perfil = perfis[perfilDoDia(p.dia, feriados)]
    if (!perfil) continue
    const demanda = p.previsto * razao
    saida.push({
      dia: p.dia,
      feriado: p.feriado,
      reparosPrevistos: p.previsto,
      demanda: Math.round(demanda),
      capacidade: Math.round(perfil.visitas),
      tecnicosTipicos: Math.round(perfil.tecnicos),
      tecnicosParaReparo: Math.ceil(demanda / perfil.visitasPorTecnico),
      folga: Math.round(perfil.visitas - demanda),
    })
  }
  return saida
}

// ── Reparos abertos que vão passar de 48h ──────────────────────────────────

/** Horas de vida de um reparo, arredondadas para baixo; -1 = ainda aberto. */
export type FaixaFechamento = { hora: number; n: number }

export const LIMITE_HORAS = 48

export type CurvaFechamento = {
  /** índice = idade em horas (0..47): chance de passar de 48h dado que já está aberto há tanto */
  passa: number[]
  /** horas em que metade / 90% da coorte já tinha fechado */
  p50: number | null
  p90: number | null
  /** reparos na coorte */
  amostra: number
}

/**
 * A chance de um reparo aberto há `a` horas passar de 48h:
 * P(T > 48 | T > a) = (quantos passaram de 48h) ÷ (quantos ainda estavam abertos em `a`).
 *
 * A COORTE É POR ABERTURA E TODA ELA TEM MAIS DE 48h DE IDADE, e isso
 * dispensa o estimador de sobrevivência: quem ainda está aberto já passou de
 * 48h, então nenhum caso fica "sem saber". Medir por encerramento — o jeito
 * óbvio — deixaria de fora justamente os casos longos que continuam abertos,
 * e a curva sairia otimista.
 */
export function curvaDeFechamento(hist: readonly FaixaFechamento[]): CurvaFechamento | null {
  const amostra = hist.reduce((s, f) => s + f.n, 0)
  if (amostra === 0) return null
  const passou = (f: FaixaFechamento, a: number) => f.hora === -1 || f.hora >= a
  const alem48 = hist.reduce((s, f) => s + (passou(f, LIMITE_HORAS) ? f.n : 0), 0)

  const passa = Array.from({ length: LIMITE_HORAS }, (_, a) => {
    const vivos = hist.reduce((s, f) => s + (passou(f, a) ? f.n : 0), 0)
    return vivos ? alem48 / vivos : 0
  })

  // percentis sobre a coorte inteira, com os abertos no fim da fila
  const fechados = [...hist].filter((f) => f.hora >= 0).sort((x, y) => x.hora - y.hora)
  const ate = (q: number) => {
    let acum = 0
    for (const f of fechados) {
      acum += f.n
      if (acum / amostra >= q) return f.hora + 1
    }
    return null
  }
  return { passa, p50: ate(0.5), p90: ate(0.9), amostra }
}

export type MotivoRisco = 'estourou' | 'agenda-tarde' | 'curva'

/**
 * O risco de um reparo aberto passar de 48h.
 *
 * - já passou: 100%, e o motivo diz isso;
 * - tem horário reservado DEPOIS das 48h: vai passar, salvo se resolverem
 *   remoto antes — a curva histórica não sabe disso, a agenda sabe;
 * - fora isso, a curva da coorte na idade dele.
 */
export function riscoDoAberto(
  curva: CurvaFechamento,
  idadeH: number,
  criado: string,
  proxima: string | null
): { risco: number; motivo: MotivoRisco } {
  if (idadeH >= LIMITE_HORAS) return { risco: 1, motivo: 'estourou' }
  if (proxima && horasEntre(criado, proxima) >= LIMITE_HORAS) return { risco: 1, motivo: 'agenda-tarde' }
  return { risco: curva.passa[Math.max(0, Math.floor(idadeH))] ?? 0, motivo: 'curva' }
}

// ── Onde a rede pede socorro ───────────────────────────────────────────────

export type DiaBairro = { dia: string; cidade: string | null; bairro: string | null; n: number }

export type BairroEmAlta = {
  cidade: string
  bairro: string
  /** reparos nas últimas 4 semanas */
  recente: number
  /** o que as 12 semanas anteriores fariam esperar em 4 */
  esperado: number
  razao: number
  /** desvios acima do esperado (Poisson): acima de 2 raramente é acaso */
  z: number
}

export const SEMANAS_RECENTES = 4
export const SEMANAS_BASE = 12

/**
 * Bairros cuja entrada de reparo das últimas 4 semanas está acima do que as 12
 * anteriores fariam esperar, com z > 2.
 *
 * O piso de 4 reparos esperados existe porque, em bairro pequeno, sair de 1
 * para 4 dá z alto e não quer dizer nada sobre a rede.
 */
export function bairrosEmAlta(linhas: readonly DiaBairro[], ultimo: string, zMinimo = 2, esperadoMinimo = 4): BairroEmAlta[] {
  const iniRecente = somarDias(ultimo, -SEMANAS_RECENTES * 7 + 1)
  const iniBase = somarDias(iniRecente, -SEMANAS_BASE * 7)
  const acum = new Map<string, { cidade: string; bairro: string; recente: number; base: number }>()
  for (const l of linhas) {
    if (!l.bairro || l.dia > ultimo || l.dia < iniBase) continue
    const cidade = l.cidade ?? ''
    const k = `${cidade}|${l.bairro}`
    const a = acum.get(k) ?? { cidade, bairro: l.bairro, recente: 0, base: 0 }
    if (l.dia >= iniRecente) a.recente += l.n
    else a.base += l.n
    acum.set(k, a)
  }
  const saida: BairroEmAlta[] = []
  for (const a of acum.values()) {
    const esperado = (a.base * SEMANAS_RECENTES) / SEMANAS_BASE
    if (esperado < esperadoMinimo) continue
    const z = (a.recente - esperado) / Math.sqrt(esperado)
    if (z <= zMinimo) continue
    saida.push({ cidade: a.cidade, bairro: a.bairro, recente: a.recente, esperado, razao: a.recente / esperado, z })
  }
  return saida.sort((x, y) => y.z - x.z)
}

/** P(X ≥ n) para X ~ Poisson(λ). */
export function caudaPoisson(n: number, lambda: number): number {
  let termo = Math.exp(-lambda)
  let acum = 0
  for (let k = 0; k < n; k++) {
    acum += termo
    termo *= lambda / (k + 1)
  }
  return Math.max(0, 1 - acum)
}

export type Aglomeracao = {
  dia: string
  cidade: string
  bairro: string
  n: number
  /** reparos por dia que o bairro costuma ter */
  mediaDia: number
  /** chance de um dia comum do bairro ter tantos reparos */
  chance: number
}

/**
 * Dias em que um bairro teve 5+ reparos e isso tinha menos de 1 em 1.000 de
 * chance de ser acaso para aquele bairro — a assinatura de falha de REDE (caixa,
 * cabo, OLT), não de cliente. O maior de 2026: Feitoria (São Leopoldo), 56
 * reparos em 22/09 e 41 no dia seguinte, num bairro cuja mediana é 6 por dia.
 */
export function aglomeracoes(
  linhas: readonly DiaBairro[],
  ultimo: string,
  dias = 14,
  minimo = 5,
  chanceMaxima = 0.001
): Aglomeracao[] {
  const janela = (SEMANAS_RECENTES + SEMANAS_BASE) * 7
  const iniJanela = somarDias(ultimo, -janela + 1)
  const iniRecente = somarDias(ultimo, -dias + 1)
  const total = new Map<string, number>()
  for (const l of linhas) {
    if (!l.bairro || l.dia < iniJanela || l.dia > ultimo) continue
    const k = `${l.cidade ?? ''}|${l.bairro}`
    total.set(k, (total.get(k) ?? 0) + l.n)
  }
  const saida: Aglomeracao[] = []
  for (const l of linhas) {
    if (!l.bairro || l.n < minimo || l.dia < iniRecente || l.dia > ultimo) continue
    const mediaDia = (total.get(`${l.cidade ?? ''}|${l.bairro}`) ?? 0) / janela
    const chance = caudaPoisson(l.n, mediaDia)
    if (chance < chanceMaxima) {
      saida.push({ dia: l.dia, cidade: l.cidade ?? '', bairro: l.bairro, n: l.n, mediaDia, chance })
    }
  }
  return saida.sort((x, y) => (x.dia === y.dia ? y.n - x.n : x.dia < y.dia ? 1 : -1))
}

// ── Quem deve voltar a abrir reparo ────────────────────────────────────────

export type ReparoLogin = { instalacao: string; dia: string; cidade: string | null; bairro: string | null }

export type ClasseReparos = '1' | '2' | '3+'
export type ClasseRecencia = '0–7' | '8–30' | '31–90'

export type ClasseVolta = {
  reparos: ClasseReparos
  recencia: ClasseRecencia
  observados: number
  voltaram: number
  taxa: number
}

export const JANELA_LOGIN = 90
export const HORIZONTE_VOLTA = 30

const classeReparos = (n: number): ClasseReparos => (n === 1 ? '1' : n === 2 ? '2' : '3+')
const classeRecencia = (d: number): ClasseRecencia => (d <= 7 ? '0–7' : d <= 30 ? '8–30' : '31–90')

export type TaxasDeVolta = {
  classes: ClasseVolta[]
  /**
   * As mesmas taxas só por número de reparos, todas as recências somadas. É
   * esta que vira "chance" de um login: com 3+ reparos as classes de recência
   * têm de 90 a 190 observações e oscilam sem ordem (6,8% / 3,1% / 10,1% em
   * 22/10/2026) — ruído, não sinal. Somadas, são ~460.
   */
  porReparos: { reparos: ClasseReparos; observados: number; voltaram: number; taxa: number }[]
  /** dos logins que abriram reparo nos 30 dias seguintes, quantos já tinham reparo nos 90 anteriores */
  concentracao: number | null
  referencias: number
}

/**
 * Taxa empírica de um login voltar a abrir reparo em 30 dias, por classe:
 * quantos reparos teve nos 90 dias anteriores × há quantos dias foi o último.
 *
 * Medida em datas de referência semanais em que a janela inteira (90 dias para
 * trás, 30 para a frente) cabe no histórico carregado — nenhuma referência
 * conta um futuro que ainda não aconteceu.
 *
 * A CONCENTRAÇÃO É A RESSALVA QUE A LISTA PRECISA. Em 22/10/2026 só 10% dos
 * logins que abriram reparo nos 30 dias seguintes tinham reparo nos 90
 * anteriores, e ter reparo recente leva a chance de voltar de ~3,5% para no
 * máximo ~8%: a maior parte do reparo de amanhã vem de cliente que estava
 * quieto — é a rede, não o cliente.
 */
export function taxasDeVolta(reparos: readonly ReparoLogin[], ultimo: string): TaxasDeVolta {
  const porLogin = new Map<string, string[]>()
  let primeiro: string | null = null
  for (const r of reparos) {
    const v = porLogin.get(r.instalacao)
    if (v) v.push(r.dia)
    else porLogin.set(r.instalacao, [r.dia])
    if (primeiro === null || r.dia < primeiro) primeiro = r.dia
  }
  const vazio: TaxasDeVolta = { classes: [], porReparos: [], concentracao: null, referencias: 0 }
  if (primeiro === null) return vazio

  const refs: string[] = []
  for (let r = somarDias(primeiro, JANELA_LOGIN); r <= somarDias(ultimo, -HORIZONTE_VOLTA); r = somarDias(r, 7)) {
    refs.push(r)
  }
  if (refs.length === 0) return vazio

  const cont = new Map<string, { obs: number; volta: number }>()
  let comHistorico = 0
  let voltaramTodos = 0
  for (const R of refs) {
    const iniAntes = somarDias(R, -JANELA_LOGIN)
    const fimDepois = somarDias(R, HORIZONTE_VOLTA)
    for (const dias of porLogin.values()) {
      let n = 0
      let ultimoAntes: string | null = null
      let volta = false
      for (const d of dias) {
        if (d > iniAntes && d <= R) {
          n++
          if (ultimoAntes === null || d > ultimoAntes) ultimoAntes = d
        } else if (d > R && d <= fimDepois) {
          volta = true
        }
      }
      if (volta) voltaramTodos++
      if (n === 0 || ultimoAntes === null) continue
      const desde = (Date.parse(`${R}T00:00:00Z`) - Date.parse(`${ultimoAntes}T00:00:00Z`)) / DIA_MS
      const k = `${classeReparos(n)}|${classeRecencia(desde)}`
      const c = cont.get(k) ?? { obs: 0, volta: 0 }
      c.obs++
      if (volta) {
        c.volta++
        comHistorico++
      }
      cont.set(k, c)
    }
  }

  const classes: ClasseVolta[] = []
  const porReparos: TaxasDeVolta['porReparos'] = []
  for (const reparosC of ['1', '2', '3+'] as const) {
    let obs = 0
    let volta = 0
    for (const recencia of ['0–7', '8–30', '31–90'] as const) {
      const c = cont.get(`${reparosC}|${recencia}`)
      if (!c || c.obs === 0) continue
      classes.push({ reparos: reparosC, recencia, observados: c.obs, voltaram: c.volta, taxa: c.volta / c.obs })
      obs += c.obs
      volta += c.volta
    }
    if (obs) porReparos.push({ reparos: reparosC, observados: obs, voltaram: volta, taxa: volta / obs })
  }
  return {
    classes,
    porReparos,
    concentracao: voltaramTodos ? comHistorico / voltaramTodos : null,
    referencias: refs.length,
  }
}

export type LoginCronico = {
  instalacao: string
  cidade: string | null
  bairro: string | null
  reparos90: number
  ultimoReparo: string
  diasDesde: number
}

/**
 * Logins com 3+ reparos nos últimos 90 dias (contando hoje) — os mais
 * reparados primeiro, e entre iguais o de reparo mais recente. Cidade e bairro
 * são os do reparo mais recente.
 */
export function loginsCronicos(reparos: readonly ReparoLogin[], hoje: string, minimo = 3): LoginCronico[] {
  const ini = somarDias(hoje, -JANELA_LOGIN)
  const porLogin = new Map<string, ReparoLogin[]>()
  for (const r of reparos) {
    if (r.dia <= ini || r.dia > hoje) continue
    const v = porLogin.get(r.instalacao)
    if (v) v.push(r)
    else porLogin.set(r.instalacao, [r])
  }
  const saida: LoginCronico[] = []
  for (const [instalacao, rs] of porLogin) {
    if (rs.length < minimo) continue
    const ultimo = rs.reduce((m, r) => (r.dia > m.dia ? r : m))
    saida.push({
      instalacao,
      cidade: ultimo.cidade,
      bairro: ultimo.bairro,
      reparos90: rs.length,
      ultimoReparo: ultimo.dia,
      diasDesde: (Date.parse(`${hoje}T00:00:00Z`) - Date.parse(`${ultimo.dia}T00:00:00Z`)) / DIA_MS,
    })
  }
  return saida.sort((x, y) => y.reparos90 - x.reparos90 || x.diasDesde - y.diasDesde)
}
