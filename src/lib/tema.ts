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

/**
 * Rótulo de valor impresso no próprio dado (topo da barra, acima do ponto).
 *
 * ── POR QUE UM HELPER, E NÃO UM `label` em cada gráfico ───────────────────
 *
 * Cada gráfico decidia sozinho, com uma contagem escolhida a olho: o
 * `ColunasPeriodo` usava `<= 16`, o `SerieAssertividade` usa `<= 40` para
 * outra coisa, e o resto simplesmente não rotulava. O resultado é o que a
 * Manutenção viu em 17/09/2026 — o mesmo painel em três grãos, rotulado no
 * mensal e mudo no semanal, sem nada que explicasse a diferença.
 *
 * ── CONTAGEM NÃO RESPONDE A PERGUNTA CERTA ────────────────────────────────
 *
 * "Cabe?" depende da LARGURA disponível e do TAMANHO DO TEXTO, não da
 * quantidade de pontos. 38 semanas num monitor largo cabem; 16 meses numa
 * janela estreita não. `hideOverlap` mede o texto já renderizado e esconde só
 * o que colidiria — acerta nos dois casos, e continua acertando quando a
 * pessoa redimensiona a janela.
 *
 * ── O TETO CONTINUA EXISTINDO, E É PARA O DIÁRIO LONGO ────────────────────
 *
 * Com 260 colunas o `hideOverlap` deixaria passar um rótulo a cada três, e um
 * subconjunto espalhado parece escolha arbitrária — pior que rótulo nenhum.
 * `maximo` é esse teto. O padrão, 60, cobre o ano inteiro de semanas (53) e o
 * mês inteiro de dias (31).
 *
 * ⚠️ NÃO USAR EM SÉRIE SOBREPOSTA. Com duas linhas no mesmo eixo o rótulo de
 * uma cai em cima da outra, e `hideOverlap` resolve a colisão escondendo um
 * dos dois — o gráfico passa a mostrar números que aparecem e somem conforme
 * o zoom. `SerieTemporal` rotula só o último ponto de cada série por isso.
 */
export function rotuloValor({
  n,
  formatter,
  cor,
  maximo = 60,
  position = 'top',
  distancia,
}: {
  /** quantos pontos a série tem */
  n: number
  formatter: (p: { value: number | null; dataIndex: number }) => string
  cor: string
  maximo?: number
  /**
   * `'insideTop'` existe para o caso de DUAS séries rotuladas no mesmo gráfico.
   *
   * Barra e linha com rótulo `'top'` colidem sempre que a linha passa perto do
   * topo da barra — e com eixo duplo isso depende da escala, então não há
   * `hideOverlap` que resolva: o ECharts esconderia um dos dois sem avisar, e o
   * leitor não saberia qual sumiu. Jogar o da barra para DENTRO separa os dois
   * por construção. Achado na tela de Histórico em 16/10/2026, onde "2,76%"
   * cobria "2.359".
   */
  position?: 'top' | 'inside' | 'insideTop'
  /** folga em px entre o rótulo e o ponto — útil para afastar séries vizinhas */
  distancia?: number
}) {
  return {
    label: {
      show: n <= maximo,
      position,
      formatter,
      color: cor,
      fontSize: 11,
      fontWeight: 600 as const,
      ...(distancia === undefined ? {} : { distance: distancia }),
    },
    labelLayout: { hideOverlap: true },
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
