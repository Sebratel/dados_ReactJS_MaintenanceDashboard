import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise'

/**
 * Pool do Data Hub (MariaDB `DB_Applicattion`).
 *
 * Fonte da base diária de clientes por cidade/bairro/site
 * (`Autentication_Contracts_Daily`), que é o denominador do Coeficiente de
 * Reparos. Host em IP privado (10.0.11.171) — só resolve na rede corporativa.
 *
 * `dateStrings: true` pelo mesmo motivo do ERP: a coluna `date` é `datetime`
 * com a hora da carga (23:50:16), não data limpa. Trazemos como string e
 * agrupamos por `DATE(date)` no próprio banco.
 */
const globalParaPool = globalThis as unknown as { __poolMaria?: Pool }

function criar(): Pool {
  const host = process.env.MARIA_HOST
  if (!host) throw new Error('MARIA_HOST ausente (ver .env.example)')
  return mysql.createPool({
    host,
    port: Number(process.env.MARIA_PORT ?? 3306),
    database: process.env.MARIA_DATABASE ?? 'DB_Applicattion',
    user: process.env.MARIA_USER,
    password: process.env.MARIA_PASSWORD,
    connectionLimit: Number(process.env.MARIA_POOL_MAX ?? 5),
    connectTimeout: 20_000,
    dateStrings: true,
    ssl: process.env.MARIA_SSL === 'true' ? {} : undefined,
    timezone: 'Z',
  })
}

export const poolMaria: Pool = globalParaPool.__poolMaria ?? criar()
if (process.env.NODE_ENV !== 'production') globalParaPool.__poolMaria = poolMaria

export async function consultarMaria<T extends RowDataPacket>(
  sql: string,
  params: readonly unknown[] = []
): Promise<{ rows: T[]; ms: number }> {
  const t0 = performance.now()
  const [rows] = await poolMaria.query<T[]>(sql, params as unknown[])
  const ms = Math.round(performance.now() - t0)
  return { rows, ms }
}
