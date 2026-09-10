/**
 * Mede a performance do SQL do universo antes de embuti-lo na aplicação.
 * Uso: node scripts/db/bench.mjs
 */
import pg from 'pg'
import fs from 'node:fs'

const env = Object.fromEntries(
  fs
    .readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2')]
    })
)

const c = new pg.Client({
  host: env.DB_ELLEVEN_HOST,
  port: +env.DB_ELLEVEN_PORT,
  database: env.DB_ELLEVEN_DATABASE,
  user: env.DB_ELLEVEN_USER,
  password: env.DB_ELLEVEN_PASSWORD,
  connectionTimeoutMillis: 20000,
  statement_timeout: 180000,
  options: '-c search_path=erp,public',
})
await c.connect()

const FROM_UNIVERSO = `
  FROM erp.assignment_incidents ai
  JOIN erp.assignments a               ON a.id  = ai.assignment_id
  LEFT JOIN erp.incident_status st     ON st.id = ai.incident_status_id
  LEFT JOIN erp.incident_types it      ON it.id = ai.incident_type_id
  LEFT JOIN erp.teams t                ON t.id  = ai.team_id
  LEFT JOIN erp.catalog_services cs    ON cs.id = ai.catalog_service_id
  LEFT JOIN erp.people p               ON p.id  = a.requestor_id
  LEFT JOIN erp.people resp            ON resp.id = a.responsible_id
  LEFT JOIN erp.solicitation_classifications sc ON sc.id = ai.solicitation_classification_id
  LEFT JOIN erp.solicitation_problems sp        ON sp.id = ai.solicitation_problem_id
  LEFT JOIN erp.solicitation_solutions ss       ON ss.id = ai.solicitation_solution_id
  LEFT JOIN erp.solicitation_category_matrices scm ON scm.id = ai.solicitation_category_matrix_id
  LEFT JOIN erp.solicitation_service_categories cat1 ON cat1.id = scm.service_category_id_1
  LEFT JOIN erp.solicitation_service_categories cat2 ON cat2.id = scm.service_category_id_2
  LEFT JOIN erp.solicitation_service_categories cat3 ON cat3.id = scm.service_category_id_3
  LEFT JOIN LATERAL (
    SELECT max(sch.start_date) AS ultima_agenda,
           min(sch.start_date) AS primeira_agenda,
           min(sch.start_date) FILTER (
             WHERE sch.start_date > a.created
               AND (a.conclusion_date IS NULL OR sch.start_date < a.conclusion_date)
           ) AS primeiro_agendamento_valido,
           count(*) AS qtd_agendamentos
      FROM erp.schedules sch
     WHERE sch.assignment_id = a.id
  ) s ON true
`
const EQUIPES = [1050, 65, 1065, 1064, 1063, 1062]
const CATALOGOS = ['Oper. Reparo', 'Oper. Tecnologia', 'Equipe tecnologia', 'Equipe reparo']
const WHERE = `
  WHERE (t.id = any($1) or cs.title = any($2))
    AND coalesce(st.title,'') <> 'Cancelado'
    AND a.created >= $3::date
    AND a.created < ($4::date + interval '1 day')
`
const P = (de, ate) => [EQUIPES, CATALOGOS, de, ate]

const bench = async (nome, sql, params) => {
  // aquece e mede
  const t0 = performance.now()
  const r = await c.query(sql, params)
  const ms = Math.round(performance.now() - t0)
  const t1 = performance.now()
  await c.query(sql, params)
  const ms2 = Math.round(performance.now() - t1)
  const flag = ms2 > 2000 ? '  🐌 LENTO' : ms2 > 1000 ? '  ⚠️' : '  ✅'
  console.log(`${flag} ${nome.padEnd(46)} ${String(ms).padStart(6)}ms / ${String(ms2).padStart(6)}ms (2ª)  ${r.rowCount} linhas`)
  return r
}

console.log('Janela: mês corrente (2026-08-01 → 2026-08-05)\n')
const M = P('2026-08-01', '2026-08-05')

await bench('KPIs agregados', `
  SELECT count(distinct ai.protocol)::int protocolos,
         count(distinct ai.protocol) filter (where st.title = any(array['Encerrado','A Faturar']))::int encerrados,
         round(avg(extract(epoch from (a.conclusion_date - a.created))/3600.0)::numeric, 2) mttr_h,
         round(avg(extract(epoch from (s.primeiro_agendamento_valido - a.created))/3600.0)::numeric, 2) mtpa_h,
         count(distinct ai.protocol) filter (where s.ultima_agenda is null)::int sem_agenda
  ${FROM_UNIVERSO} ${WHERE}`, M)

await bench('Série diária', `
  SELECT date_trunc('day', a.created)::date periodo,
         count(distinct ai.protocol)::int abertos,
         count(distinct ai.protocol) filter (where st.title = any(array['Encerrado','A Faturar']))::int encerrados
  ${FROM_UNIVERSO} ${WHERE}
  GROUP BY 1 ORDER BY 1`, M)

await bench('Ranking por cidade', `
  SELECT coalesce(p.city,'(sem cidade)') rotulo, count(distinct ai.protocol)::int valor
  ${FROM_UNIVERSO} ${WHERE}
  GROUP BY 1 ORDER BY 2 DESC LIMIT 12`, M)

await bench('Ranking por categoria2', `
  SELECT coalesce(cat2.title,'(sem categoria)') rotulo, count(distinct ai.protocol)::int valor
  ${FROM_UNIVERSO} ${WHERE}
  GROUP BY 1 ORDER BY 2 DESC LIMIT 12`, M)

await bench('Heatmap dia da semana x turno', `
  SELECT extract(dow from a.created)::int dia,
         case when extract(hour from a.created) < 8 then '1. 00-08h'
              when extract(hour from a.created) < 12 then '2. 08-12h'
              when extract(hour from a.created) < 19 then '3. 12-19h'
              else '4. 19-24h' end turno,
         count(distinct ai.protocol)::int protocolos,
         round(avg(extract(epoch from (a.conclusion_date - a.created))/3600.0)::numeric,2) mttr_h
  ${FROM_UNIVERSO} ${WHERE}
  GROUP BY 1,2 ORDER BY 1,2`, M)

console.log('\nJanela: ano corrente (2026-01-01 → 2026-08-05) — o caso pesado\n')
const A = P('2026-01-01', '2026-08-05')

await bench('KPIs agregados (ano)', `
  SELECT count(distinct ai.protocol)::int protocolos,
         count(distinct ai.protocol) filter (where st.title = any(array['Encerrado','A Faturar']))::int encerrados,
         round(avg(extract(epoch from (a.conclusion_date - a.created))/3600.0)::numeric, 2) mttr_h
  ${FROM_UNIVERSO} ${WHERE}`, A)

await bench('Série mensal (ano)', `
  SELECT date_trunc('month', a.created)::date periodo,
         count(distinct ai.protocol)::int abertos,
         count(distinct ai.protocol) filter (where st.title = any(array['Encerrado','A Faturar']))::int encerrados
  ${FROM_UNIVERSO} ${WHERE}
  GROUP BY 1 ORDER BY 1`, A)

await bench('Ranking por técnico (ano)', `
  SELECT coalesce(resp.name,'(sem técnico)') rotulo, count(distinct ai.protocol)::int valor
  ${FROM_UNIVERSO} ${WHERE}
  GROUP BY 1 ORDER BY 2 DESC LIMIT 15`, A)

// MTTA precisa de reports — mede separado, era o mais caro
await bench('MTTA (em play, via reports) — mês', `
  WITH play AS (
    SELECT r.assignment_id, sum(r.seconds_worked) AS seg
      FROM erp.reports r
      JOIN erp.assignments a2 ON a2.id = r.assignment_id
     WHERE a2.created >= $3::date AND a2.created < ($4::date + interval '1 day')
     GROUP BY 1
  )
  SELECT round(avg(play.seg/3600.0)::numeric,2) mtta_h, count(*)::int n
  ${FROM_UNIVERSO}
  LEFT JOIN play ON play.assignment_id = a.id
  ${WHERE} AND st.title = any(array['Encerrado','A Faturar'])`, M)

await c.end()
