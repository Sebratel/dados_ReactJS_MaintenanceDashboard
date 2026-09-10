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

export const poolErp: Pool =
  globalParaPool.__poolErp ??
  new Pool({
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

if (process.env.NODE_ENV !== 'production') globalParaPool.__poolErp = poolErp

poolErp.on('error', (e) => {
  console.error('[pool erp] erro em conexão idle:', e.message)
})

export type ResultadoQuery<T> = { rows: T[]; ms: number }

/**
 * Executa SQL no ERP com binding de parâmetros.
 * Nunca interpolar valor em string — sempre $1, $2, …
 */
export async function consultarErp<T extends QueryResultRow>(
  sql: string,
  params: readonly unknown[] = []
): Promise<ResultadoQuery<T>> {
  const t0 = performance.now()
  const r = await poolErp.query<T>(sql, params as unknown[])
  const ms = Math.round(performance.now() - t0)
  if (ms > 5_000) {
    console.warn(`[erp] consulta lenta (${ms}ms): ${sql.slice(0, 120).replace(/\s+/g, ' ')}…`)
  }
  return { rows: r.rows, ms }
}
