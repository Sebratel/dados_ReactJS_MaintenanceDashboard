/**
 * Ponte entre os design tokens (CSS custom properties) e o ECharts.
 *
 * O tema default do ECharts é descartado inteiro: as cores vêm dos tokens em
 * globals.css, lidos do DOM. Assim a troca light/dark acontece em um lugar só e
 * a paleta validada não é duplicada em JS.
 */

export type TokensTema = {
  surface: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  gridline: string
  axis: string
  series: string[]
  statusGood: string
  statusWarning: string
  statusCritical: string
  seq: string[]
  ord: string[]
  brand: string
}

const FALLBACK: TokensTema = {
  surface: '#fcfcfb',
  textPrimary: '#0b0b0b',
  textSecondary: '#52514e',
  textMuted: '#898781',
  gridline: '#e1e0d9',
  axis: '#c3c2b7',
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7'],
  statusGood: '#0ca30c',
  statusWarning: '#fab219',
  statusCritical: '#d03b3b',
  seq: ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
  ord: ['#86b6ef', '#2a78d6', '#184f95'],
  brand: '#d80010',
}

export function lerTokens(): TokensTema {
  if (typeof window === 'undefined') return FALLBACK
  const cs = getComputedStyle(document.documentElement)
  const v = (nome: string, fb: string) => cs.getPropertyValue(nome).trim() || fb
  return {
    surface: v('--surface-1', FALLBACK.surface),
    textPrimary: v('--text-primary', FALLBACK.textPrimary),
    textSecondary: v('--text-secondary', FALLBACK.textSecondary),
    textMuted: v('--text-muted', FALLBACK.textMuted),
    gridline: v('--gridline', FALLBACK.gridline),
    axis: v('--axis', FALLBACK.axis),
    series: [1, 2, 3, 4, 5, 6, 7].map((i) => v(`--series-${i}`, FALLBACK.series[i - 1]!)),
    statusGood: v('--status-good', FALLBACK.statusGood),
    statusWarning: v('--status-warning', FALLBACK.statusWarning),
    statusCritical: v('--status-critical', FALLBACK.statusCritical),
    seq: [100, 200, 300, 400, 500, 600, 700].map((s, i) => v(`--seq-${s}`, FALLBACK.seq[i]!)),
    ord: [1, 2, 3].map((i) => v(`--ord-${i}`, FALLBACK.ord[i - 1]!)),
    brand: v('--brand', FALLBACK.brand),
  }
}

/** Especificações de marca comuns a todos os gráficos (guia de dataviz). */
export const MARCA = {
  /** ponta de dado arredondada 4px, ancorada na base */
  barraTopo4px: [4, 4, 0, 0] as [number, number, number, number],
  barraDireita4px: [0, 4, 4, 0] as [number, number, number, number],
  /** linha 2px */
  larguraLinha: 2,
  /** marcador ≥ 8px */
  tamanhoMarcador: 8,
  /** vão de 2px na cor da superfície entre segmentos empilhados / barras */
  vaoSuperficie: 2,
} as const

export function baseGrid(tk: TokensTema, extra?: Record<string, unknown>) {
  return {
    left: 8,
    right: 16,
    top: 8,
    bottom: 4,
    containLabel: true,
    ...extra,
  }
}

export function baseEixoCategoria(tk: TokensTema, extra?: Record<string, unknown>) {
  return {
    type: 'category' as const,
    axisLine: { lineStyle: { color: tk.axis } },
    axisTick: { show: false },
    axisLabel: { color: tk.textMuted, fontSize: 11 },
    ...extra,
  }
}

export function baseEixoValor(tk: TokensTema, extra?: Record<string, unknown>) {
  return {
    type: 'value' as const,
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: tk.gridline, width: 1 } },
    axisLabel: { color: tk.textMuted, fontSize: 11 },
    ...extra,
  }
}

export function baseTooltip(tk: TokensTema, extra?: Record<string, unknown>) {
  return {
    backgroundColor: tk.surface,
    borderColor: tk.axis,
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: tk.textPrimary, fontSize: 12 },
    extraCssText: 'box-shadow: 0 4px 16px rgba(0,0,0,.12); border-radius: 6px;',
    ...extra,
  }
}
