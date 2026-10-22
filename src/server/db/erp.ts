import { Pool, type QueryResultRow } from 'pg'
import { configurarTiposPg } from './tipos'

configurarTiposPg()

function exigir(nome: string): string {
  const v = process.env[nome]
  if (!v) throw new Error(`Variável de ambiente ausente: ${nome} (ver .env.example)`)
  return v
}

/**
 * Pool do ERP Voalle (dbemp00100, schema `erp`).
 *
 * SOMENTE LEITURA — confirmado empiricamente: `CREATE SCHEMA` retorna
 * "cannot execute CREATE SCHEMA in a read-only transaction". É réplica de
 * produção de um ERP de terceiro com 1.384 tabelas: nunca escrever, nunca
 * criar índice, nunca deixar consulta longa sem timeout.
 */
const globalParaPool = globalThis as unknown as { __poolErp?: Pool }

let poolDoModulo: Pool | undefined

/**
 * O POOL NASCE NA PRIMEIRA CONSULTA, NUNCA NA IMPORTAÇÃO.
 *
 * Isto não é preferência de estilo — é o que faz a imagem Docker construir.
 *
 * `next build` IMPORTA todo módulo de rota na etapa "Collecting page data",
 * para ler a configuração do segmento (`dynamic`, `runtime`, …).
 * `export const dynamic = 'force-dynamic'` impede que a rota seja EXECUTADA no
 * build, mas não impede que ela seja IMPORTADA — e a importação arrastava este
 * arquivo junto. Com o pool criado no corpo do módulo, `exigir()` rodava nessa
 * hora e derrubava o build onde não há credencial:
 *
 *     Collecting page data ...
 *     Error: Variável de ambiente ausente: DB_ELLEVEN_HOST
 *     > Build error occurred
 *     [Error: Failed to collect page data for /api/protocolos]
 *
 * Que é precisamente a situação da imagem: o `.dockerignore` barra o `.env` DE
 * PROPÓSITO (para a credencial não ser assada dentro da imagem) e o compose só
 * entrega as variáveis em runtime. Na máquina de desenvolvimento o `.env`
 * existe, então o build passava aqui e só quebrava no Portainer — o sintoma
 * (`npm run build` exit 1) não apontava para banco nenhum.
 *
 * Adiar a criação faz valer o que o Dockerfile já afirmava: a imagem se constrói
 * sem VPN e sem credencial. Em runtime não muda nada — `new Pool()` não conecta,
 * só guarda configuração; quem abre conexão é a primeira `query`. E a mensagem
 * de variável ausente continua existindo, agora na primeira consulta, que é
 * quando ela de fato importa.
 */
function criar(): Pool {
  const p = new Pool({
    host: exigir('DB_ELLEVEN_HOST'),
    port: Number(process.env.DB_ELLEVEN_PORT ?? 5432),
    database: exigir('DB_ELLEVEN_DATABASE'),
    user: exigir('DB_ELLEVEN_USER'),
    password: exigir('DB_ELLEVEN_PASSWORD'),
    max: Number(process.env.ERP_POOL_MAX ?? 6),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 20_000,
    statement_timeout: 60_000,
    query_timeout: 65_000,
    application_name: 'dashboard-manutencao-fttx',
    // o schema de negócio é `erp`; deixa as queries mais curtas e legíveis
    options: '-c search_path=erp,public',
  })

  p.on('error', (e) => {
    console.error('[pool erp] erro em conexão idle:', e.message)
  })

  return p
}

export function obterPoolErp(): Pool {
  const existente = poolDoModulo ?? globalParaPool.__poolErp
  if (existente) return existente

  const novo = criar()
  poolDoModulo = novo
  // Em desenvolvimento o hot reload reavalia o módulo. Sem guardar no global,
  // cada recarga abriria um pool novo e os anteriores ficariam segurando
  // conexões da réplica do ERP até o processo morrer.
  if (process.env.NODE_ENV !== 'production') globalParaPool.__poolErp = novo
  return novo
}

export type ResultadoQuery<T> = { rows: T[]; ms: number }

/**
 * Quando o ERP respondeu pela última vez, e quando falhou.
 *
 * É o que a Capa mostra em "Atualização dos dados", e é DE GRAÇA: sai das
 * consultas que as telas já fazem. Perguntar ao banco "você está aí?" para
 * preencher um selo seria carga na réplica para responder uma pergunta que as
 * próprias telas já respondem. Memória do processo: zera num restart, e até a
 * primeira consulta a Capa diz "—", que é a verdade.
 */
const estado = { ultimaLeitura: 0, ultimaFalha: 0 }

export function estadoErp(): { ultimaLeitura: number; ultimaFalha: number } {
  return { ...estado }
}

/**
 * Executa SQL no ERP com binding de parâmetros.
 * Nunca interpolar valor em string — sempre $1, $2, …
 */
export async function consultarErp<T extends QueryResultRow>(
  sql: string,
  params: readonly unknown[] = []
): Promise<ResultadoQuery<T>> {
  const t0 = performance.now()
  let r
  try {
    r = await obterPoolErp().query<T>(sql, params as unknown[])
  } catch (e) {
    estado.ultimaFalha = Date.now()
    throw e
  }
  estado.ultimaLeitura = Date.now()
  const ms = Math.round(performance.now() - t0)
  if (ms > 5_000) {
    console.warn(`[erp] consulta lenta (${ms}ms): ${sql.slice(0, 120).replace(/\s+/g, ' ')}…`)
  }
  return { rows: r.rows, ms }
}
