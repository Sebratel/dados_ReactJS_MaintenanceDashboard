import { baseGrid, baseTooltip, type TokensTema } from './tema'
import { fmtHoras, fmtInt } from './formato'
import type { CelulaHeatmap } from '@/server/indicadores/heatmap'

/**
 * MONTAGEM DA OPÇÃO DO MAPA DE CALOR — módulo puro, de propósito.
 *
 * Isto morava dentro do componente React. Saiu de lá depois de um defeito que
 * só aparecia no navegador: a versão anterior omitia o `visualMap` e pintava
 * cada célula por `itemStyle`, o que o ECharts recusa em tempo de execução com
 * `Heatmap must use with visualMap`. A tela quebrou inteira, e nenhuma
 * verificação de servidor pegou — o HTML voltava 200 e limpo, porque o erro
 * acontece no `useEffect`, depois da hidratação.
 *
 * Como função pura, a opção passa a ser conferível fora do navegador: dá para
 * entregá-la ao próprio ECharts em Node (modo SSR) e deixar a biblioteca julgar
 * se ela é válida. Ver `scripts/verificar-heatmap.mjs`.
 */

/**
 * FAIXAS DE MTTR — as mesmas do Power BI, hex por hex.
 *
 * Vieram da formatação condicional do visual `MTTR_A POR DIA E TURNO`, medida
 * `MTTR Mapa de Calor (Valor)`, lidas direto do PBIP:
 *   .Report/definition/pages/…/visuals/…/visual.json → objects.values[].backColor
 *
 * ⚠️ Estas cores são REGRA DE NEGÓCIO, não decoração. Os cortes em 12/15/18/21
 * horas são o acordo de serviço que a Manutenção já usa para ler o mapa, e
 * trocá-los por uma rampa "bonita" faria a mesma célula mudar de significado
 * entre o BI e aqui. Elas escapam da paleta do dashboard de propósito — é o
 * único lugar em que isso acontece (ver docs/04 §25).
 *
 * Diferença deliberada em relação ao BI: a última regra de lá é `>= 21 e < 60`,
 * e uma célula acima de 60 h ficava SEM COR — buraco branco no mapa que se lê
 * como "sem dado" quando na verdade é o pior caso possível. Aqui a faixa é
 * aberta: 21 h ou mais é vermelho, sempre.
 */
export const FAIXAS_MTTR = [
  { ate: 12, cor: '#0C8E4A', tinta: '#ffffff', label: '< 12h' },
  { ate: 15, cor: '#63BE7B', tinta: '#10231a', label: '12–15h' },
  { ate: 18, cor: '#F6D94F', tinta: '#2b2410', label: '15–18h' },
  { ate: 21, cor: '#E96A35', tinta: '#ffffff', label: '18–21h' },
  { ate: Infinity, cor: '#CB0A0A', tinta: '#ffffff', label: '≥ 21h' },
] as const

/** Primeira faixa cujo teto o valor não alcança — `>= piso AND < teto`, como no BI. */
export function faixaMttr(h: number) {
  return FAIXAS_MTTR.find((f) => h < f.ate) ?? FAIXAS_MTTR[FAIXAS_MTTR.length - 1]!
}

/**
 * `gte`/`lt` e não `min`/`max`: no ECharts as faixas de `min`/`max` são fechadas
 * dos dois lados, e um valor exatamente igual à fronteira cai na primeira faixa
 * que o contenha. O BI é `>= piso AND < teto` — 12h é verde CLARO lá, não
 * escuro. Com `gte`/`lt` as duas ferramentas concordam na fronteira, que é
 * justamente onde uma divergência passaria despercebida.
 */
export function faixasComoPieces() {
  return FAIXAS_MTTR.map((f, i) => ({
    ...(i === 0 ? {} : { gte: FAIXAS_MTTR[i - 1]!.ate }),
    ...(Number.isFinite(f.ate) ? { lt: f.ate } : {}),
    color: f.cor,
  }))
}

const DIAS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB']

/** Ordem NATURAL do dia — é a ordem em que os dados chegam ('1. 00-08h'…'4. 19-24h'). */
const TURNOS = ['00–08h', '08–12h', '12–19h', '19–24h']

/**
 * O EIXO Y VAI INVERTIDO, e isso é proposital.
 *
 * O eixo de categoria do ECharts desenha `data[0]` EMBAIXO e vai subindo. Com a
 * ordem natural, a madrugada ficava no rodapé e a noite no topo — o dia lido de
 * baixo para cima, ao contrário de qualquer grade de horário que a operação usa.
 * Passava despercebido enquanto o mapa era uma rampa de azul; com as faixas do
 * BI, em que cada célula grita uma cor, a inversão virou erro de leitura.
 *
 * Então o eixo recebe a lista ao contrário e o índice de cada ponto é espelhado
 * por `indiceEixo`. ⚠️ As duas coisas andam juntas: inverter só o eixo trocaria
 * os VALORES de lugar sem trocar os rótulos, que é um defeito silencioso — o
 * mapa continuaria bonito e estaria mentindo. O `verificar-heatmap.mjs` prende
 * as duas pontas.
 */
const TURNOS_EIXO = [...TURNOS].reverse()
const indiceEixo = (natural: number) => TURNOS.length - 1 - natural

/**
 * Duas escalas, porque as duas métricas são de naturezas diferentes:
 *
 * - MTTR → escala ABSOLUTA, as faixas do BI acima. 18 h é laranja em julho e em
 *   agosto, num mês bom e num mês ruim. Uma rampa relativa ao máximo faria o
 *   melhor mês parecer tão vermelho quanto o pior, porque a cor mais forte é
 *   sempre gasta no maior valor presente — que é justamente o erro que um mapa
 *   de calor de SLA não pode cometer.
 * - Protocolos → rampa SEQUENCIAL relativa ao máximo (azul claro→escuro). Aqui
 *   não existe patamar acordado, só magnitude, e o interesse é o contraste
 *   interno do recorte.
 *
 * A célula leva o número impresso nos dois casos: o valor fica legível sem
 * depender da cor (canal de alívio + acessibilidade).
 */
export function montarOpcaoHeatmap({
  dados,
  metrica,
  tk,
}: {
  dados: CelulaHeatmap[]
  metrica: 'protocolos' | 'mttr'
  tk: TokensTema
}) {
  const ehMttr = metrica === 'mttr'
  const valor = (c: CelulaHeatmap) => (ehMttr ? c.mttrHoras : c.protocolos)

  const brutos = dados.map((c) => {
    // '3. 12-19h' -> 2 (natural) -> 1 (posição no eixo invertido)
    const iTurno = indiceEixo(Number(c.turno.charAt(0)) - 1)
    return [c.diaSemana, iTurno, valor(c) ?? null] as [number, number, number | null]
  })
  const max = Math.max(0, ...brutos.map((p) => p[2] ?? 0))

  /**
   * A cor do RÓTULO é resolvida POR PONTO, não por callback.
   * Callback em `series.label.color` não é aplicado de forma confiável no
   * heatmap do ECharts — o número herdava a cor da própria célula e ficava
   * ilegível nas células claras da rampa (visto em 08-12h e 19-24h).
   *
   * A cor da CÉLULA, ao contrário, sai obrigatoriamente do `visualMap` — ver o
   * comentário no topo deste arquivo.
   */
  const pontos = brutos.map((p) => {
    const v = p[2]
    if (ehMttr) {
      return { value: p, label: { color: v === null ? tk.textMuted : faixaMttr(v).tinta } }
    }
    // A rampa de contagem é dourada (claro → escuro) desde a paleta da origem,
    // e branco sobre dourado fica ilegível já no meio da escala. A tinta
    // grafite lê em todos os tons, do mais claro ao mais escuro (~4:1).
    return { value: p, label: { color: tk.textPrimary } }
  })

  const visualMap = ehMttr
    ? {
        show: false,
        type: 'piecewise' as const,
        pieces: faixasComoPieces(),
        // célula sem reparo encerrado no período: superfície neutra, sem faixa
        outOfRange: { color: tk.gridline },
      }
    : { show: false, min: 0, max: max || 1, inRange: { color: tk.seq } }

  return {
    grid: baseGrid(tk, { left: 4, right: 4, top: 6, bottom: 4 }),
    tooltip: baseTooltip(tk, {
      trigger: 'item',
      formatter: (p: { value: [number, number, number | null] }) => {
        const [d, t] = p.value
        const cel = dados.find(
          (c) => c.diaSemana === d && indiceEixo(Number(c.turno.charAt(0)) - 1) === t
        )
        if (!cel) return ''
        return `<b>${DIAS[d]} · ${TURNOS_EIXO[t]}</b><br/>
          Abertos <b>${fmtInt(cel.protocolos)}</b><br/>
          MTTR médio <b>${fmtHoras(cel.mttrHoras)}</b>`
      },
    }),
    xAxis: {
      type: 'category' as const,
      data: DIAS,
      splitArea: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: tk.textMuted, fontSize: 11 },
    },
    yAxis: {
      type: 'category' as const,
      data: TURNOS_EIXO,
      splitArea: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: tk.textMuted, fontSize: 11 },
    },
    visualMap,
    series: [
      {
        type: 'heatmap' as const,
        data: pontos,
        label: {
          show: true,
          formatter: (p: { value: [number, number, number | null] }) => {
            const v = p.value[2]
            if (v === null) return ''
            // hh:mm:ss e não decimal — decimal é o que a Manutenção pediu para
            // sair de toda a tela de tempos. Cabe: 7 colunas em ~115 px cada.
            return ehMttr ? fmtHoras(v) : fmtInt(v)
          },
          fontSize: 11,
          fontWeight: 500,
        },
        itemStyle: {
          // vão de 2px na cor da superfície entre células
          borderColor: tk.surface,
          borderWidth: 2,
          borderRadius: 3,
        },
        emphasis: {
          itemStyle: { borderColor: tk.textPrimary, borderWidth: 2 },
        },
      },
    ],
  }
}
