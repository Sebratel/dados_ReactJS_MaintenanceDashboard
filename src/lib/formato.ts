const nfInt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const nfDec = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const fmtInt = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : nfInt.format(n)

export const fmtDec = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : nfDec.format(n)

/** Percentual com 2 casas. Recebe fração (0.0012 → "0,12%"). */
export function fmtPct(n: number | null | undefined, casas = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return `${n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`.replace(
    /^([\d.,-]+)%$/,
    (_, v) => `${v}%`
  )
}

/** Fração → percentual formatado. 0.3105 → "31,05%" */
export function fmtFracaoPct(n: number | null | undefined, casas = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return `${(n * 100).toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })}%`
}

/**
 * Horas decimais → HH:MM:SS.
 * Reproduz as medidas `Média MTTR Formatada` / `Média MTTA Formatada` do
 * Power BI, que exibiam tempo médio nesse formato.
 */
export function fmtHoras(horas: number | null | undefined): string {
  if (horas === null || horas === undefined || !Number.isFinite(horas)) return '—'
  const totalSeg = Math.round(horas * 3600)
  const h = Math.floor(totalSeg / 3600)
  const m = Math.floor((totalSeg % 3600) / 60)
  const s = totalSeg % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(h)}:${p(m)}:${p(s)}`
}

/** Versão curta para eixos: "16,6h" */
export function fmtHorasCurto(horas: number | null | undefined): string {
  if (horas === null || horas === undefined || !Number.isFinite(horas)) return '—'
  if (horas < 1) return `${Math.round(horas * 60)}min`
  return `${horas.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}h`
}

const MESES_CURTOS = [
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez',
] as const

/**
 * "2026-01" → "jan/26".
 *
 * Eixo mensal com "2026-01" obriga a pessoa a traduzir número em mês a cada
 * leitura, e doze rótulos iguais no prefixo ("2026-") gastam largura sem
 * informar nada — o ano repetido não distingue ponto nenhum.
 */
export function fmtMesCurto(iso: string): string {
  const [ano, mes] = iso.split('-')
  const i = Number(mes) - 1
  if (!ano || !MESES_CURTOS[i]) return iso
  return `${MESES_CURTOS[i]}/${ano.slice(2)}`
}

/** "2026-08-05" → "05/08" (eixo) */
export function fmtDiaCurto(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

/** "2026-08-05" → "05/08/2026" */
export function fmtData(iso: string): string {
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

/**
 * "2026-07-31 23:24:05.258" → "31/07/2026 23:24"
 *
 * Recebe a string CRUA do Postgres e fatia — nunca constrói `Date`. As colunas
 * do Voalle são `timestamp without time zone`; passar por `Date` aplicaria o
 * fuso do processo e um protocolo das 23:24 apareceria no dia seguinte.
 */
export function fmtDataHora(bruto: string | null | undefined): string {
  if (!bruto) return ''
  const [data, hora = ''] = bruto.split(/[T ]/)
  const [a, m, d] = (data ?? '').split('-')
  if (!a || !m || !d) return bruto
  return `${d}/${m}/${a}${hora ? ` ${hora.slice(0, 5)}` : ''}`
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** Rótulo de eixo conforme a granularidade. */
export function fmtPeriodo(iso: string, granularidade: 'dia' | 'semana' | 'mes'): string {
  const [a, m, d] = iso.split('-')
  if (granularidade === 'mes') return `${MESES[Number(m) - 1]}/${a!.slice(2)}`
  if (granularidade === 'semana') return `${d}/${m}`
  return `${d}/${m}`
}

/**
 * Idade de um instante: "agora há pouco", "há 4 min", "há 2 h", "há 3 dias".
 *
 * Recebe ISO (com ou sem fuso) ou milissegundos. É a idade do DADO, e quem
 * chama decide de qual dado: o cabeçalho passa o mais velho que está na tela.
 */
export function haQuanto(quando: string | number, agora = Date.now()): string {
  const t = typeof quando === 'number' ? quando : Date.parse(quando)
  if (!Number.isFinite(t)) return '—'
  const min = Math.floor(Math.max(0, agora - t) / 60_000)
  if (min < 1) return 'agora há pouco'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.floor(h / 24)
  return d === 1 ? 'há 1 dia' : `há ${d} dias`
}

/** Instante → "22/10/2026 08:43", no fuso de quem está lendo. */
export function fmtInstante(quando: string | number): string {
  const t = typeof quando === 'number' ? quando : Date.parse(quando)
  if (!Number.isFinite(t)) return '—'
  return new Date(t).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Tira emoji de um RÓTULO vindo do banco, só para exibir.
 *
 * O `region_title` da agenda do Voalle vem com um ✅ na frente
 * ("✅Base São Leopoldo"). A casca não usa emoji em lugar nenhum, nem herdado
 * da origem: ele muda de desenho por sistema operacional e desalinha a linha.
 * ⚠️ É só para a tela — o valor que vai para o filtro e para a URL continua o
 * original, senão o recorte deixaria de casar com o banco.
 */
const PICTOGRAFICO = new RegExp('[\\p{Extended_Pictographic}\\u{FE0F}]', 'gu')
export function semEmoji(texto: string): string {
  return texto.replace(PICTOGRAFICO, '').trim()
}

/** Sinal explícito para variação: "+12,3%" / "−4,1%" */
export function fmtVariacao(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const pct = (Math.abs(n) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${pct}%`
}
