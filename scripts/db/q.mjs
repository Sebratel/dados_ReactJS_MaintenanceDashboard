/**
 * Runner ad-hoc de SQL no ERP — a ferramenta da fase de auditoria.
 *
 * Uso:
 *   node scripts/db/q.mjs "select count(*) from erp.assignments"
 *   node scripts/db/q.mjs --arquivo consulta.sql
 *
 * POR QUE EXISTE: auditar número é comparar recorte. Cada conferência exige uma
 * consulta diferente, quase sempre descartável. Sem isso, cada pergunta viraria
 * um arquivo novo em `scripts/db/` — e a pasta encheria de script de uma
 * pergunta só.
 */
import { readFileSync } from 'node:fs'
import pg from 'pg'

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      let v = l.slice(i + 1).trim()
      if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"')))
        v = v.slice(1, -1)
      else v = v.split(' #')[0].trim()
      return [l.slice(0, i).trim(), v]
    })
)

const args = process.argv.slice(2)
const iArq = args.indexOf('--arquivo')
const sql = iArq >= 0 ? readFileSync(args[iArq + 1], 'utf8') : args[0]
if (!sql) {
  console.error('uso: node scripts/db/q.mjs "<sql>"  |  --arquivo <caminho.sql>')
  process.exit(1)
}

const c = new pg.Client({
  host: env.DB_ELLEVEN_HOST,
  port: Number(env.DB_ELLEVEN_PORT ?? 5432),
  database: env.DB_ELLEVEN_DATABASE,
  user: env.DB_ELLEVEN_USER,
  password: env.DB_ELLEVEN_PASSWORD,
  ssl: false,
  statement_timeout: 300_000,
  options: '-c search_path=erp,public',
})
await c.connect()
const t0 = Date.now()
const r = await c.query(sql)
console.log(`${r.rowCount} linhas em ${Date.now() - t0} ms`)
console.table(r.rows.slice(0, 80))
await c.end()
