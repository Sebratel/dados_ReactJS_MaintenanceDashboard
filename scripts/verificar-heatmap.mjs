/**
 * Confere a opção do mapa de calor SEM navegador, entregando-a ao próprio
 * ECharts em modo SSR.
 *
 * POR QUE EXISTE. A tela de Tempos foi ao ar quebrada em 27/08/2026 com
 * `Heatmap must use with visualMap`, e nenhuma verificação de servidor pegou: a
 * página respondia 200, o HTML vinha limpo, o `tsc` passava. O erro nasce no
 * `useEffect`, depois da hidratação — só existe no navegador.
 *
 * O ECharts sabe validar a própria opção; o que faltava era um lugar para
 * perguntar a ele. `echarts.init(null, null, { ssr: true })` renderiza para SVG
 * em Node e aplica as MESMAS checagens de tempo de execução. Se a opção for
 * inválida, este script quebra — que é o ponto.
 *
 * Confere também que as faixas de cor do Power BI chegaram de fato ao desenho,
 * inclusive nas fronteiras (12, 15, 18, 21 h), que é onde uma divergência com o
 * BI passaria despercebida.
 *
 * Uso: node scripts/verificar-heatmap.mjs
 */
import { build } from 'esbuild'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as echarts from 'echarts'

const raiz = process.cwd()
const saida = join(tmpdir(), `heatmap-opcao-${process.pid}.mjs`)

// esbuild resolve o alias `@/` do tsconfig e transpila o TS para ESM
await build({
  entryPoints: [join(raiz, 'src/lib/heatmapOpcao.ts')],
  outfile: saida,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'error',
  alias: { '@': join(raiz, 'src') },
})

const { montarOpcaoHeatmap, FAIXAS_MTTR, faixaMttr } = await import(`file://${saida}`)

const TOKENS = {
  surface: '#fcfcfb',
  textPrimary: '#0b0b0b',
  textSecondary: '#52514e',
  textMuted: '#898781',
  gridline: '#e1e0d9',
  axis: '#c3c2b7',
  series: ['#2a78d6'],
  statusGood: '#0ca30c',
  statusWarning: '#fab219',
  statusCritical: '#d03b3b',
  seq: ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
  ord: ['#86b6ef'],
  brand: '#d80010',
}

const TURNOS = ['1. 00-08h', '2. 08-12h', '3. 12-19h', '4. 19-24h']

/** Grade 7×4 completa, com um MTTR escolhido para cair em cada faixa e fronteira. */
function grade(valores) {
  const cells = []
  let i = 0
  for (let d = 0; d < 7; d++) {
    for (const t of TURNOS) {
      cells.push({
        diaSemana: d,
        diaLabel: ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'][d],
        turno: t,
        protocolos: 10 + i,
        mttrHoras: valores[i % valores.length],
      })
      i++
    }
  }
  return cells
}

function desenhar(dados, metrica) {
  const grafico = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 700, height: 240 })
  grafico.setOption(montarOpcaoHeatmap({ dados, metrica, tk: TOKENS }))
  const svg = grafico.renderToSVGString()
  grafico.dispose()
  return svg
}

let falhas = 0
const ok = (cond, msg) => {
  console.log(`${cond ? '  ok  ' : 'FALHOU'}  ${msg}`)
  if (!cond) falhas++
}

// ── 1. a opção é aceita pelo ECharts nos dois modos ──────────────────────────
// (é aqui que a versão sem visualMap quebrava)
const FRONTEIRAS = [0, 11.99, 12, 14.99, 15, 17.99, 18, 20.99, 21, 30.48, 61]
let svgMttr, svgProt
try {
  svgMttr = desenhar(grade(FRONTEIRAS), 'mttr')
  ok(true, 'ECharts aceita a opção no modo MTTR')
} catch (e) {
  ok(false, `modo MTTR: ${e.message}`)
}
try {
  svgProt = desenhar(grade(FRONTEIRAS), 'protocolos')
  ok(true, 'ECharts aceita a opção no modo Abertos')
} catch (e) {
  ok(false, `modo Abertos: ${e.message}`)
}

// ── 2. as cinco cores do BI chegaram ao SVG ──────────────────────────────────
if (svgMttr) {
  for (const f of FAIXAS_MTTR) {
    ok(svgMttr.toLowerCase().includes(f.cor.toLowerCase()), `faixa ${f.label} pintada com ${f.cor}`)
  }
  // a rampa sequencial NÃO pode aparecer no modo MTTR — seria escala relativa
  ok(!svgMttr.includes('#3987e5'), 'rampa sequencial ausente do modo MTTR')
}

// ── 3. fronteiras conforme o BI: `>= piso AND < teto` ────────────────────────
const ESPERADO = {
  0: '#0C8E4A', 11.99: '#0C8E4A',
  12: '#63BE7B', 14.99: '#63BE7B',
  15: '#F6D94F', 17.99: '#F6D94F',
  18: '#E96A35', 20.99: '#E96A35',
  21: '#CB0A0A', 30.48: '#CB0A0A',
  61: '#CB0A0A', // o BI deixaria sem cor (regra `>= 21 e < 60`) — divergência deliberada
}
for (const [v, cor] of Object.entries(ESPERADO)) {
  ok(faixaMttr(Number(v)).cor === cor, `${String(v).padStart(6)}h → ${cor}`)
}

// ── 4. célula sem reparo encerrado não ganha cor de faixa ────────────────────
try {
  const vazio = grade([null])
  const svg = desenhar(vazio, 'mttr')
  const pintou = FAIXAS_MTTR.some((f) => svg.toLowerCase().includes(f.cor.toLowerCase()))
  ok(!pintou, 'célula sem MTTR fica neutra, sem cor de faixa')
} catch (e) {
  ok(false, `grade vazia: ${e.message}`)
}

// ── 4b. eixo Y na ordem de leitura, com os VALORES acompanhando ──────────
//
// O risco aqui não é quebrar — é mentir em silêncio: inverter os rótulos do eixo
// sem espelhar o índice dos pontos deixa o mapa bonito e trocado. Por isso o teste
// amarra as duas pontas: o rótulo do topo, a linha em que o dado caiu, e o texto
// que o tooltip promete para aquela mesma posição.
{
  // um MTTR distinto por turno, para cada linha ser identificável pelo valor
  const PORTURNO = { '1. 00-08h': 1, '2. 08-12h': 13, '3. 12-19h': 16, '4. 19-24h': 30 }
  const dados = []
  for (let d = 0; d < 7; d++)
    for (const t of TURNOS)
      dados.push({ diaSemana: d, diaLabel: 'X', turno: t, protocolos: 5, mttrHoras: PORTURNO[t] })

  const op = montarOpcaoHeatmap({ dados, metrica: 'mttr', tk: TOKENS })
  const eixo = op.yAxis.data

  // ECharts desenha data[0] EMBAIXO: o topo é o último índice
  ok(eixo[eixo.length - 1] === '00–08h', `madrugada no TOPO do eixo (topo = ${eixo[eixo.length - 1]})`)
  ok(eixo[0] === '19–24h', `noite no rodapé do eixo (rodapé = ${eixo[0]})`)

  // o dado de 00-08h precisa ter ido para a linha do topo, não só o rótulo
  const noTopo = op.series[0].data.filter((p) => p.value[1] === eixo.length - 1)
  ok(noTopo.length === 7 && noTopo.every((p) => p.value[2] === 1),
     'os valores de 00-08h foram para a linha do topo')
  const noRodape = op.series[0].data.filter((p) => p.value[1] === 0)
  ok(noRodape.length === 7 && noRodape.every((p) => p.value[2] === 30),
     'os valores de 19-24h foram para a linha do rodapé')

  // e o tooltip daquela posição precisa dizer o mesmo
  const dica = op.tooltip.formatter({ value: [3, eixo.length - 1, 1] })
  ok(dica.includes('00–08h') && dica.includes('01:00:00'),
     'tooltip do topo concorda com rótulo e valor')
}

// ── 5. valores impressos em hh:mm:ss, não decimal ────────────────────────────
if (svgMttr) {
  ok(svgMttr.includes('11:59:24'), 'rótulo em hh:mm:ss (11,99h → 11:59:24)')
  ok(!svgMttr.includes('11,99') && !svgMttr.includes('11.99'), 'nenhum rótulo decimal')
}

rmSync(saida, { force: true })
console.log(falhas ? `\n${falhas} FALHA(S)` : '\ntudo verde')
process.exit(falhas ? 1 : 0)
