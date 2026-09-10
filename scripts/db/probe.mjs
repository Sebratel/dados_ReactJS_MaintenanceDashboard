import pg from 'pg'
import dotenv from 'dotenv'
dotenv.config({ path: '../.env' })

const targets = [
  {
    name: 'ELLEVEN',
    cfg: {
      host: process.env.DB_ELLEVEN_HOST,
      port: +process.env.DB_ELLEVEN_PORT,
      database: process.env.DB_ELLEVEN_DATABASE,
      user: process.env.DB_ELLEVEN_USER,
      password: process.env.DB_ELLEVEN_PASSWORD,
    },
  },
  {
    name: 'AUTOISP',
    cfg: {
      host: process.env.DB_AUTOISP_HOST,
      port: +process.env.DB_AUTOISP_PORT,
      database: process.env.DB_AUTOISP_DATABASE,
      user: process.env.DB_AUTOISP_USER,
      password: process.env.DB_AUTOISP_PASSWORD,
    },
  },
]

for (const t of targets) {
  console.log('\n' + '='.repeat(70))
  console.log(`### ${t.name}  ${t.cfg.user}@${t.cfg.host}:${t.cfg.port}/${t.cfg.database}`)
  console.log('='.repeat(70))
  const client = new pg.Client({
    ...t.cfg,
    connectionTimeoutMillis: 15000,
    statement_timeout: 30000,
    ssl: false,
  })
  try {
    await client.connect()
    const v = await client.query('select version(), current_database(), current_user')
    console.log('version:', v.rows[0].version.split(',')[0])

    const schemas = await client.query(`
      select table_schema, count(*)::int as tables
      from information_schema.tables
      where table_schema not in ('pg_catalog','information_schema')
      group by 1 order by 2 desc
    `)
    console.log('\n-- schemas --')
    console.table(schemas.rows)

    // look for the voalle-ish tables the PBI queries reference
    const wanted = [
      'assignments', 'assignment_incidents', 'contracts', 'teams', 'reports',
      'catalog_services', 'catalog_services_items', 'incident_status', 'incident_types',
      'people', 'people_addresses', 'schedules', 'contract_service_tags',
      'authentication_contracts', 'authentication_access_points', 'authentication_sites',
      'authentication_splitters', 'authentication_splitter_ports', 'authentication_concentrators',
      'solicitation_problems', 'solicitation_classifications', 'solicitation_solutions',
      'solicitation_category_matrices', 'solicitation_service_categories',
      'patrimony_packing_lists', 'patrimony_packing_list_items', 'manufacturers',
      'consolidated_indicators', 'v_users', 'v_service_desk_slots_productivity_informative',
    ]
    const found = await client.query(
      `select table_schema, table_name, table_type
         from information_schema.tables
        where table_name = any($1::text[])
        order by table_name, table_schema`,
      [wanted]
    )
    console.log(`\n-- PBI-referenced objects found (${found.rowCount}/${wanted.length}) --`)
    console.table(found.rows)
    const foundNames = new Set(found.rows.map((r) => r.table_name))
    console.log('MISSING:', wanted.filter((w) => !foundNames.has(w)).join(', ') || '(none)')
  } catch (e) {
    console.log('!! ERROR:', e.message)
  } finally {
    await client.end().catch(() => {})
  }
}
