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
  statement_timeout: 180000,
})
await client.connect()

const q = async (label, sql, params) => {
  const t0 = Date.now()
  try {
    const r = await client.query(sql, params)
    console.log(`\n### ${label}  (${r.rowCount} rows, ${Date.now() - t0}ms)`)
    console.table(r.rows)
  } catch (e) {
    console.log(`\n### ${label}  ERRO: ${e.message}`)
  }
}

// 1. Onde vive a classificacao IMPROD/PROD? (PBI usa reports.description = "relato")
await q(
  '1. reports.description com codigo de produtividade (2026)',
  `select left(r.description, 60) as relato_prefix, count(*)::int qtd
     from erp.reports r
    where r.beginning_date >= '2026-05-01'
      and (r.description ilike '%IMPROD%' or r.description ilike '%PROD%')
    group by 1 order by 2 desc limit 45`
)

// 2. incident_status titles
await q(
  '2. incident_status (title, unproductive)',
  `select is2.id, is2.title, is2.unproductive, is2.active,
          (select count(*) from erp.assignment_incidents ai
            join erp.assignments a on a.id = ai.assignment_id
           where ai.incident_status_id = is2.id and a.created >= '2026-01-01')::int qtd_2026
     from erp.incident_status is2
    order by qtd_2026 desc limit 20`
)

// 3. catalog_services de manutencao
await q(
  '3. catalog_services relevantes',
  `select cs.id, cs.title,
          (select count(*) from erp.assignment_incidents ai
            join erp.assignments a on a.id = ai.assignment_id
           where ai.catalog_service_id = cs.id and a.created >= '2026-01-01')::int qtd_2026
     from erp.catalog_services cs
    where cs.title in ('Oper. Reparo','Oper. Tecnologia','Equipe tecnologia','Equipe reparo')
    order by qtd_2026 desc`
)

// 4. incident_types no universo de manutencao
await q(
  '4. incident_types no universo manutencao (2026)',
  `select it.id, it.title, it.active, count(*)::int qtd
     from erp.assignment_incidents ai
     join erp.assignments a on a.id = ai.assignment_id
     left join erp.incident_types it on it.id = ai.incident_type_id
     left join erp.catalog_services cs on cs.id = ai.catalog_service_id
     left join erp.teams t on t.id = ai.team_id
    where a.created >= '2026-01-01'
      and ( t.id in (1050,65,1065,1064,1063,1062)
            or cs.title in ('Oper. Reparo','Oper. Tecnologia','Equipe tecnologia','Equipe reparo') )
    group by 1,2,3 order by 4 desc limit 30`
)

// 5. Universo protocolosTotais (contagem) por mes
await q(
  '5. volume protocolos manutencao por mes (2026)',
  `select date_trunc('month', a.created)::date mes, count(distinct ai.protocol)::int protocolos
     from erp.assignment_incidents ai
     join erp.assignments a on a.id = ai.assignment_id
     left join erp.catalog_services cs on cs.id = ai.catalog_service_id
     left join erp.teams t on t.id = ai.team_id
     left join erp.incident_status is2 on is2.id = ai.incident_status_id
    where a.created >= '2026-01-01'
      and ( t.id in (1050,65,1065,1064,1063,1062)
            or cs.title in ('Oper. Reparo','Oper. Tecnologia','Equipe tecnologia','Equipe reparo') )
      and is2.title <> 'Cancelado'
    group by 1 order by 1`
)

// 6. Cidades
await q(
  '6. cidades no universo manutencao (2026)',
  `select p.city, count(distinct ai.protocol)::int protocolos
     from erp.assignment_incidents ai
     join erp.assignments a on a.id = ai.assignment_id
     left join erp.people p on p.id = a.requestor_id
     left join erp.catalog_services cs on cs.id = ai.catalog_service_id
     left join erp.teams t on t.id = ai.team_id
    where a.created >= '2026-01-01'
      and ( t.id in (1050,65,1065,1064,1063,1062)
            or cs.title in ('Oper. Reparo','Oper. Tecnologia','Equipe tecnologia','Equipe reparo') )
    group by 1 order by 2 desc limit 20`
)

// 7. solicitation_service_categories (categoria2 = eixo de recorrencia)
await q(
  '7. categoria2 (solicitation_service_categories via matrix) 2026',
  `select ssc2.title categoria2, count(*)::int qtd
     from erp.assignment_incidents ai
     left join erp.solicitation_category_matrices scm on scm.id = ai.solicitation_category_matrix_id
     left join erp.solicitation_service_categories ssc2 on ssc2.id = scm.service_category_id_2
    where ai.beginning_service_date >= '2026-01-01' and ssc2.title is not null
    group by 1 order by 2 desc limit 30`
)

// 8. view produtividade - tipos de protocolo do Field Manutencao
await q(
  '8. view produtividade: incident_type_title (>= 2026-05-01)',
  `select v.incident_type_title, count(*)::int qtd, count(distinct v.protocol)::int protocolos
     from erp.v_service_desk_slots_productivity_informative v
    where v.begin_date_slot >= date '2026-05-01'
    group by 1 order by 2 desc limit 25`
)

// 9. regioes (base) da view
await q(
  '9. view produtividade: region_title',
  `select v.region_title, count(distinct v.protocol)::int protocolos
     from erp.v_service_desk_slots_productivity_informative v
    where v.begin_date_slot >= date '2026-05-01'
    group by 1 order by 2 desc limit 20`
)

// 10. MTTA/MTTR sanity: seconds_worked em reports p/ encerrados
await q(
  '10. MTTA (emPlay) e MTTR sanity check julho/2026',
  `with base as (
     select ai.protocol, a.created, a.conclusion_date,
            (select sum(r.seconds_worked) from erp.reports r where r.assignment_id = a.id) as em_play
       from erp.assignment_incidents ai
       join erp.assignments a on a.id = ai.assignment_id
       left join erp.incident_status is2 on is2.id = ai.incident_status_id
       left join erp.teams t on t.id = ai.team_id
       left join erp.catalog_services cs on cs.id = ai.catalog_service_id
      where a.created >= '2026-07-01' and a.created < '2026-08-01'
        and is2.title = 'Encerrado'
        and ( t.id in (1050,65,1065,1064,1063,1062)
              or cs.title in ('Oper. Reparo','Oper. Tecnologia','Equipe tecnologia','Equipe reparo') )
   )
   select count(*)::int protocolos,
          round(avg(extract(epoch from (conclusion_date - created))/3600)::numeric, 2) as mttr_horas_media,
          round(avg(em_play/3600.0)::numeric, 2) as mtta_emplay_horas_media,
          count(*) filter (where em_play is null)::int sem_emplay
     from base`
)

await client.end()
