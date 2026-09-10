import { z } from 'zod'

/**
 * Eixo da data — decisão explícita, não escondida.
 *
 * No Power BI isso vive dentro de `USERELATIONSHIP` em cada medida, e é a causa
 * mais comum de número divergente entre páginas: "protocolos de julho" significa
 * coisa diferente se você conta por criação ou por encerramento. Aqui é filtro
 * de primeira classe, visível na tela.
 */
export const EIXOS_DATA = {
  criacao: { label: 'Criação', coluna: 'a.created' },
  encerramento: { label: 'Encerramento', coluna: 'a.conclusion_date' },
  /**
   * `s.ultima_agenda` = o ÚLTIMO horário agendado que a fonte preservou. Mesma
   * escolha do Power BI, que fazia `ROW_NUMBER() … ORDER BY start_date DESC`.
   *
   * Exige o LATERAL da agenda no FROM — `partesNecessarias` cuida disso ao ver
   * `eixo === 'agenda'`. Já foi `s.start_date`, coluna que não existe em lugar
   * nenhum: `colunaEixo` a substituía em silêncio, então o valor errado ficava
   * escrito aqui sem nunca quebrar nada. Corrigido para o que roda de verdade.
   */
  agenda: { label: 'Agenda', coluna: 's.ultima_agenda' },
} as const

export type EixoData = keyof typeof EIXOS_DATA

export const GRANULARIDADES = {
  dia: { label: 'Dia', truncPg: 'day' },
  semana: { label: 'Semana', truncPg: 'week' },
  mes: { label: 'Mês', truncPg: 'month' },
} as const

export type Granularidade = keyof typeof GRANULARIDADES

export const DIMENSOES = {
  cidade: { label: 'Cidade', sql: 'p.city' },
  bairro: { label: 'Bairro', sql: 'p.neighborhood' },
  /**
   * Base operacional REAL, vinda de `region_title` da view de produtividade
   * (✅Base São Leopoldo / ✅Base Canoas, em trilha de Manutenção ou Ativação).
   * Mais confiável que a derivação por cidade do Power BI, que só aproximava.
   */
  base: { label: 'Base (real)', sql: 's.regiao_agenda' },
  /** Técnico que executou em campo, vindo de `resource_name` da view. */
  // "Executor", e não "Instalador": é o técnico de MANUTENÇÃO que fechou o
  // protocolo. O rótulo antigo vinha da mesma confusão com a operação de
  // Instalação, e a coluna equivalente em Protocolos já dizia Executor.
  instalador: { label: 'Executor (campo)', sql: 's.instalador' },
  equipe: { label: 'Equipe', sql: 't.title' },
  tecnico: { label: 'Responsável', sql: 'resp.name' },
  catalogo: { label: 'Catálogo', sql: 'cs.title' },
  tipo: { label: 'Tipo de protocolo', sql: 'it.title' },
  status: { label: 'Status', sql: 'st.title' },
  contexto: { label: 'Contexto', sql: 'sc.title' },
  problema: { label: 'Problema', sql: 'sp.title' },
  solucao: { label: 'Solução', sql: 'ss.title' },
  categoria1: { label: 'Categoria 1', sql: 'cat1.title' },
  categoria2: { label: 'Categoria 2', sql: 'cat2.title' },
  categoria3: { label: 'Categoria 3', sql: 'cat3.title' },
  /**
   * Turno e dia da semana são ORDINAIS, não nominais: trocar a ordem muda o
   * significado. Ordená-los por volume destrói a leitura do padrão diário /
   * semanal. Por isso mantêm a sequência natural e usam rampa de um hue.
   */
  turno: { label: 'Turno', sql: 'turno', ordinal: true },
  diaSemana: { label: 'Dia da semana', sql: 'dia_semana', ordinal: true },
} as const

export type Dimensao = keyof typeof DIMENSOES

export function ehDimensaoOrdinal(d: Dimensao): boolean {
  return 'ordinal' in DIMENSOES[d] && DIMENSOES[d].ordinal === true
}

const dataISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use AAAA-MM-DD')

/** Lista de strings vinda da URL como `a~b~c` (til evita conflito com vírgula em nomes). */
const listaTexto = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined
    const arr = Array.isArray(v) ? v : v.split('~')
    const limpo = arr.map((s) => s.trim()).filter(Boolean)
    return limpo.length ? limpo : undefined
  })

export const FiltrosSchema = z.object({
  de: dataISO,
  ate: dataISO,
  /**
   * Base operacional da agenda de campo. É o corte MAIS importante da operação:
   * São Leopoldo e Canoas são SUPERVISÕES DIFERENTES e cada uma acompanha o
   * próprio resultado. Vem de `region_title` da view de field service, não da
   * derivação por cidade — a derivação só aproximava.
   */
  base: listaTexto,
  eixo: z.enum(['criacao', 'encerramento', 'agenda']).default('criacao'),
  granularidade: z.enum(['dia', 'semana', 'mes']).default('dia'),
  cidade: listaTexto,
  equipe: listaTexto,
  tecnico: listaTexto,
  catalogo: listaTexto,
  tipo: listaTexto,
  status: listaTexto,
  categoria2: listaTexto,
  /**
   * REINCIDÊNCIA pós-preventiva — só o relatório analítico usa.
   *
   * Fica fora da barra global de propósito: nas outras telas não haveria o que
   * filtrar, e filtro que não faz nada é pior que filtro ausente (item 30).
   * O controle vive na própria página de Protocolos.
   *
   * 'r30' | 'r60' | 'r90' = a preventiva voltou naquela janela (pode ter voltado
   * em mais de uma; o corte é "atingiu esta"). 'sim' = qualquer janela.
   * 'nao' = preventiva que não voltou.
   */
  reincidencia: z.enum(['r30', 'r60', 'r90', 'sim', 'nao']).optional(),
  /**
   * Corte por RETORNO DE REPARO — o mesmo conjunto da aba Ofensores, aqui
   * nominal. 'v30'/'v60'/'v90' = quanto tempo depois do atendimento ANTERIOR
   * da mesma instalação este reparo entrou.
   */
  retorno: z.enum(['v30', 'v60', 'v90', 'sim', 'nao']).optional(),
  /** dimensão de agrupamento, para o endpoint de ranking */
  dim: z
    .enum(Object.keys(DIMENSOES) as [Dimensao, ...Dimensao[]])
    .default('cidade'),
  limite: z.coerce.number().int().min(1).max(200).default(12),
})

export type Filtros = z.infer<typeof FiltrosSchema>

/** Padrão: mês corrente, por data de criação, granularidade diária. */
export function filtrosPadrao(hoje = new Date()): Filtros {
  const ano = hoje.getFullYear()
  const mes = hoje.getMonth()
  const pad = (n: number) => String(n).padStart(2, '0')
  const primeiro = `${ano}-${pad(mes + 1)}-01`
  const ultimo = `${ano}-${pad(mes + 1)}-${pad(new Date(ano, mes + 1, 0).getDate())}`
  return FiltrosSchema.parse({ de: primeiro, ate: ultimo })
}

export function parsearFiltros(sp: URLSearchParams | Record<string, string | string[] | undefined>): Filtros {
  const obj =
    sp instanceof URLSearchParams ? Object.fromEntries(sp.entries()) : sp
  const base = filtrosPadrao()
  return FiltrosSchema.parse({
    de: obj.de ?? base.de,
    ate: obj.ate ?? base.ate,
    eixo: obj.eixo ?? base.eixo,
    granularidade: obj.granularidade ?? base.granularidade,
    base: obj.base,
    cidade: obj.cidade,
    equipe: obj.equipe,
    tecnico: obj.tecnico,
    catalogo: obj.catalogo,
    tipo: obj.tipo,
    status: obj.status,
    categoria2: obj.categoria2,
    reincidencia: obj.reincidencia,
    retorno: obj.retorno,
    dim: obj.dim ?? base.dim,
    limite: obj.limite ?? base.limite,
  })
}

export function filtrosParaQuery(f: Partial<Filtros>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null) continue
    q.set(k, Array.isArray(v) ? v.join('~') : String(v))
  }
  return q.toString()
}

/** Presets de período para a barra de filtros. */
export function presetsPeriodo(hoje = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const menos = (n: number) => {
    const d = new Date(hoje)
    d.setDate(d.getDate() - n)
    return d
  }
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
  const inicioMesAnterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)
  const fimMesAnterior = new Date(hoje.getFullYear(), hoje.getMonth(), 0)
  const inicioAno = new Date(hoje.getFullYear(), 0, 1)
  return [
    { id: 'hoje', label: 'Hoje', de: iso(hoje), ate: iso(hoje), granularidade: 'dia' as const },
    { id: '7d', label: 'Últimos 7 dias', de: iso(menos(6)), ate: iso(hoje), granularidade: 'dia' as const },
    { id: '30d', label: 'Últimos 30 dias', de: iso(menos(29)), ate: iso(hoje), granularidade: 'dia' as const },
    { id: 'mes', label: 'Mês corrente', de: iso(inicioMes), ate: iso(hoje), granularidade: 'dia' as const },
    { id: 'mesAnterior', label: 'Mês anterior', de: iso(inicioMesAnterior), ate: iso(fimMesAnterior), granularidade: 'dia' as const },
    { id: '90d', label: 'Últimos 90 dias', de: iso(menos(89)), ate: iso(hoje), granularidade: 'semana' as const },
    { id: 'ano', label: 'Ano corrente', de: iso(inicioAno), ate: iso(hoje), granularidade: 'mes' as const },
  ]
}
