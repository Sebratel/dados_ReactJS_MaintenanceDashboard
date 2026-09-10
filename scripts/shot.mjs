/**
 * Screenshot via CDP puro (sem Playwright). Abre o Chrome headless, navega,
 * espera os canvases do ECharts renderizarem e captura.
 *
 * Uso: node shot.mjs <url> <arquivo.png> [larguraxaltura]
 */
import { spawn } from 'node:child_process'
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
// WebSocket global do Node 22+ — evita depender do pacote `ws`

const CANDIDATOS = [
  String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`,
  String.raw`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
  String.raw`C:\Program Files\Microsoft\Edge\Application\msedge.exe`,
  String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`,
]
const chrome = CANDIDATOS.find((p) => existsSync(p))
if (!chrome) {
  console.error('navegador não encontrado. Candidatos:', CANDIDATOS)
  process.exit(1)
}

const url = process.argv[2]
const saida = process.argv[3]
const [larg, alt] = (process.argv[4] ?? '1600x2400').split('x').map(Number)
const PORTA = 9331 + Math.floor(process.uptime() * 7) % 200

const proc = spawn(
  chrome,
  [
    '--headless=new',
    `--remote-debugging-port=${PORTA}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    `--window-size=${larg},${alt}`,
    '--user-data-dir=' + process.env.TEMP + '\\cdp-shot-' + PORTA,
    'about:blank',
  ],
  { stdio: 'ignore' }
)

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

async function alvo() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORTA}/json/list`)
      const lista = await r.json()
      const p = lista.find((t) => t.type === 'page')
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl
    } catch {}
    await dormir(250)
  }
  throw new Error('CDP não respondeu')
}

const ws = new WebSocket(await alvo())
await new Promise((r, rej) => {
  ws.addEventListener('open', r, { once: true })
  ws.addEventListener('error', rej, { once: true })
})

let id = 0
const pendentes = new Map()
const logs = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
  if (m.id && pendentes.has(m.id)) {
    pendentes.get(m.id)(m.result)
    pendentes.delete(m.id)
  }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`)
  }
  if (m.method === 'Runtime.exceptionThrown') {
    logs.push('exception: ' + (m.params.exceptionDetails?.exception?.description ?? '?'))
  }
})

const cmd = (method, params = {}) =>
  new Promise((res) => {
    const meu = ++id
    pendentes.set(meu, res)
    ws.send(JSON.stringify({ id: meu, method, params }))
  })

await cmd('Page.enable')
await cmd('Runtime.enable')
// a rota da API manda `cache-control: private, max-age=600` — legítimo em
// produção, mas faz o Chrome servir a resposta antiga entre execuções deste
// script (o perfil é reaproveitado), e a captura mostraria dado velho
await cmd('Network.enable')
await cmd('Network.setCacheDisabled', { cacheDisabled: true })

// O dashboard exige Basic auth (src/middleware.ts). Embutir a credencial na URL
// (http://user:pass@host) NAO funciona via CDP — o Chrome ignora. O header
// explicito funciona. Le de SHOT_AUTH="usuario:senha".
if (process.env.SHOT_AUTH) {
  const b64 = Buffer.from(process.env.SHOT_AUTH).toString('base64')
  await cmd('Network.setExtraHTTPHeaders', {
    headers: { Authorization: `Basic ${b64}` },
  })
}
await cmd('Emulation.setDeviceMetricsOverride', {
  width: larg,
  height: alt,
  deviceScaleFactor: 1,
  mobile: false,
})
await cmd('Page.navigate', { url })

// espera a rede assentar e os canvases aparecerem
let canvas = 0
let carregando = 1
for (let i = 0; i < 80; i++) {
  await dormir(500)
  const r = await cmd('Runtime.evaluate', {
    expression: `JSON.stringify({
      canvas: document.querySelectorAll('canvas').length,
      carregando: [...document.querySelectorAll('*')].filter(e => e.children.length===0 && /carregando/i.test(e.textContent||'')).length,
      pronto: document.readyState
    })`,
    returnByValue: true,
  })
  try {
    const v = JSON.parse(r.result.value)
    canvas = v.canvas
    carregando = v.carregando
    if (v.pronto === 'complete' && canvas > 0 && carregando === 0) break
  } catch {}
}
await dormir(1200)

// Prepara a pagina antes de capturar: abrir a visao de tabela, expandir um
// painel, trocar uma aba. Roda DEPOIS da espera acima porque o alvo do clique so
// existe quando a pagina terminou de montar — antes disso o clique nao acha nada
// e a captura sai igual, dando a impressao de que o codigo novo nao funcionou.
// Uso: SHOT_ANTES="<javascript>" node shot.mjs <url> <arquivo>
if (process.env.SHOT_ANTES) {
  const r = await cmd('Runtime.evaluate', {
    expression: process.env.SHOT_ANTES,
    returnByValue: true,
    awaitPromise: true,
  })
  if (r.exceptionDetails) {
    logs.push('SHOT_ANTES: ' + (r.exceptionDetails.exception?.description ?? '?'))
  } else {
    console.log('SHOT_ANTES ->', JSON.stringify(r.result?.value ?? null))
  }
  await dormir(900)
}

const alturaReal = await cmd('Runtime.evaluate', {
  expression: 'document.documentElement.scrollHeight',
  returnByValue: true,
})
const h = Math.min(Math.max(alturaReal.result.value, 600), 8000)
await cmd('Emulation.setDeviceMetricsOverride', {
  width: larg,
  height: h,
  deviceScaleFactor: 1,
  mobile: false,
})
await dormir(700)

const shot = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
mkdirSync(dirname(saida), { recursive: true })
writeFileSync(saida, Buffer.from(shot.data, 'base64'))

console.log(`ok: ${saida}  canvas=${canvas} carregando=${carregando} altura=${h}`)
if (logs.length) console.log('CONSOLE:\n  ' + logs.slice(0, 12).join('\n  '))
else console.log('console limpo')

ws.close()
proc.kill()
process.exit(0)
