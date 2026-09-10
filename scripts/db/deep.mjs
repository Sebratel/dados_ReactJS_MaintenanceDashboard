import pg from 'pg'
import dotenv from 'dotenv'
dotenv.config({ path: '../.env' })

const client = new pg.Client({
  host: process.env.DB_ELLEVEN_HOST,
  port: +process.env.DB_ELLEVEN_PORT,
  database: process.env.DB_ELLEVEN_DATABASE,
  user: process.env.DB_ELLEVEN_USER,
  password: process.env.DB_ELLEVEN_PASSWORD,
  connectionTimeoutMillis: 20000,
  statement_timeout: 120000,
})
await client.connect()

const KEY = [
  'assignments',
  'assignment_incidents',
  'schedules',
  'reports',
  'teams',
  'contracts',
  'contract_service_tags',
  'incident_status',
  'incident_types',
  'catalog_services',
  'people',
  'authentication_contracts',
  'consolidated_indicators',
]

console.log('\n########## COLUNAS DAS TABELAS-CHAVE ##########')
for (const t of KEY) {
  const r = await client.query(
    `select column_name, data_type, is_nullable
       from information_schema.columns
      where table_schema='erp' and table_name=$1
      order by ordinal_position`,
    [t]
  )
  console.log(`\n--- erp.${t} (${r.rowCount} cols) ---`)
  console.log(r.rows.map((c) => `${c.column_name}:${c.data_type}`).join(', '))
}

console.log('\n\n########## VIEW v_service_desk_slots_productivity_informative ##########')
const vw = await client.query(
  `select column_name, data_type from information_schema.columns
    where table_schema='erp' and table_name='v_service_desk_slots_productivity_informative'
    order by ordinal_position`
)
console.log(vw.rows.map((c) => `${c.column_name}:${c.data_type}`).join(', '))

console.log('\n\n########## VOLUMETRIA / JANELAS DE DATA ##########')
const q = async (label, sql) => {
  try {
    const r = await client.query(sql)
    console.log(`\n[${label}]`)
    console.table(r.rows)
  } catch (e) {
    console.log(`\n[${label}] ERRO: ${e.message}`)
  }
}

await q(
  'assignments',
  `select count(*)::int total, min(created)::date min_created, max(created)::date max_created,
          count(*) filter (where created >= date_trunc('year', current_date))::int no_ano
     from erp.assignments`
)
await q(
  'assignment_incidents',
  `select count(*)::int total, min(beginning_service_date)::date min_bsd, max(beginning_service_date)::date max_bsd
     from erp.assignment_incidents`
)
await q(
  'incident_status distintos',
  `select is2.id, is2.title, count(ai.id)::int qtd
     from erp.incident_status is2
     left join erp.assignment_incidents ai on ai.incident_status_id = is2.id
     group by 1,2 order by 3 desc limit 25`
)
await q(
  'catalog_services de manutencao',
  `select cs.id, cs.title, count(ai.id)::int qtd
     from erp.catalog_services cs
     join erp.assignment_incidents ai on ai.catalog_service_id = cs.id
     group by 1,2 order by 3 desc limit 30`
)
await q(
  'teams usados no PBI (1050,65,1065,1064,1063,1062)',
  `select id, title from erp.teams where id in (1050,65,1065,1064,1063,1062) order by id`
)
await q(
  'incident_types de manutencao (>=2026)',
  `select it.id, it.title, it.active, count(ai.id)::int qtd
     from erp.incident_types it
     join erp.assignment_incidents ai on ai.incident_type_id = it.id
     join erp.assignments a on a.id = ai.assignment_id
    where a.created >= '2026-01-01'
    group by 1,2,3 order by 4 desc limit 40`
)
await q(
  'view produtividade - janela',
  `select count(*)::int total, min(begin_date_slot)::date min_slot, max(begin_date_slot)::date max_slot
     from erp.v_service_desk_slots_productivity_informative`
)
await q(
  'consolidated_indicators',
  `select * from erp.consolidated_indicators order by monthly_year desc limit 6`
)
await q(
  'reports - amostra de relatos (classificacao produtividade)',
  `select r.title, count(*)::int qtd
     from erp.reports r
    where r.beginning_date >= '2026-05-01'
    group by 1 order by 2 desc limit 40`
)

await client.end()
