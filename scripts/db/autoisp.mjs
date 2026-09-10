import pg from 'pg'
import dotenv from 'dotenv'
dotenv.config({ path: '../.env' })

const client = new pg.Client({
  host: process.env.DB_AUTOISP_HOST,
  port: +process.env.DB_AUTOISP_PORT,
  database: process.env.DB_AUTOISP_DATABASE,
  user: process.env.DB_AUTOISP_USER,
  password: process.env.DB_AUTOISP_PASSWORD,
  connectionTimeoutMillis: 90000,
  statement_timeout: 60000,
})
try {
  await client.connect()
  console.log('CONECTADO em AUTOISP')
  const v = await client.query('select version(), current_database(), current_user')
  console.log(v.rows[0].version.split(',')[0], '|', v.rows[0].current_database)

  const s = await client.query(`
    select table_schema, count(*)::int tables
      from information_schema.tables
     where table_schema not in ('pg_catalog','information_schema')
     group by 1 order by 2 desc`)
  console.table(s.rows)

  const t = await client.query(`
    select table_schema, table_name, table_type
      from information_schema.tables
     where table_schema not in ('pg_catalog','information_schema')
     order by table_schema, table_name limit 200`)
  console.table(t.rows)

  // procurar algo parecido com base diaria de clientes autenticados
  const like = await client.query(`
    select table_schema, table_name from information_schema.tables
     where table_name ilike '%authent%' or table_name ilike '%autent%'
        or table_name ilike '%daily%' or table_name ilike '%client%'
        or table_name ilike '%contrat%' or table_name ilike '%contract%'`)
  console.log('-- candidatos base diaria de clientes --')
  console.table(like.rows)
} catch (e) {
  console.log('ERRO AUTOISP:', e.message)
} finally {
  await client.end().catch(() => {})
}
