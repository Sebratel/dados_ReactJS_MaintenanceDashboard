/**
 * EXPLAIN (ANALYZE, BUFFERS) do SQL REAL de um indicador.
 *
 * Extrai o template literal direto do módulo em vez de transcrever a query à
 * mão — transcrever esconde exatamente o detalhe que causa a regressão de plano.
 *
 * Uso: node scripts/db/explain.mjs recorrencia
 *
 * Foi assim que se descobriu que a recorrência gastava 9,2 s de 11,7 s num
 * Nested Loop que re-executava um agregado 6.139 vezes, porque o planejador
 * estimava um CTE com row_number() em 1 linha. Duas tentativas de conserto
 * baseadas em palpite (cast de parâmetro, AS MATERIALIZED) não mudaram nada;
 * o plano apontou a causa em uma rodada.
 */
import { readFileSync } from 'node:fs'
import pg from 'pg'
const env=Object.fromEntries(readFileSync('.env','utf8').split(/\r?\n/)
  .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('='))
  .map(l=>{const i=l.indexOf('=');let v=l.slice(i+1).trim()
    if((v.startsWith("'")&&v.endsWith("'"))||(v.startsWith('"')&&v.endsWith('"')))v=v.slice(1,-1);else v=v.split(' #')[0].trim()
    return [l.slice(0,i).trim(),v]}))

const modulo = process.argv[2] ?? 'recorrencia'
const src = readFileSync(`src/server/indicadores/${modulo}.ts`,'utf8')
const ini = src.indexOf('const sql = /* sql */ `')
const fim = src.indexOf('GROUP BY 1, 2, 3, 4, 5`', ini)
let sql = src.slice(ini + 'const sql = /* sql */ `'.length, fim + 'GROUP BY 1, 2, 3, 4, 5'.length)
sql = sql.replaceAll('${de}','$1').replaceAll('${ate}','$2')
         .replaceAll('${equipes}','$3::bigint[]').replaceAll('${catalogos}','$4::text[]')
         .replaceAll('${tiposPrev}','$5::text[]').replaceAll('${catsPrev}','$6::text[]')
         .replaceAll('${filtroUsuario}','')
if (sql.includes('${')) { console.log('AINDA HÁ PLACEHOLDER:', sql.match(/\$\{[^}]+\}/g)); process.exit(1) }

const P=['2026-07-01','2026-07-31',[1050,65,1065,1064,1063,1062],
  ['Oper. Reparo','Oper. Tecnologia','Equipe tecnologia','Equipe reparo'],
  ['TEC-MANUT-ACESSO-CLI-PREVENCAO/PROBLEMA','TEC-MANUT-ACESSO-CLI-PREVENCAO/RECORRENTE'],
  ['Preventiva / Recorrência Manutenção','Preventiva reparo','Preventiva tecnologia','Preventiva /Correção de Sinal']]

const c=new pg.Client({host:env.DB_ELLEVEN_HOST,port:Number(env.DB_ELLEVEN_PORT??5432),database:env.DB_ELLEVEN_DATABASE,
  user:env.DB_ELLEVEN_USER,password:env.DB_ELLEVEN_PASSWORD,ssl:false,statement_timeout:300000})
await c.connect()
const t0=Date.now()
const r=await c.query('EXPLAIN (ANALYZE, BUFFERS, SETTINGS) '+sql, P)
console.log(`(explain levou ${Date.now()-t0}ms)\n`)
// mostra só os nós com tempo relevante
const linhas = r.rows.map(x=>x['QUERY PLAN'])
for (const l of linhas) {
  const m = l.match(/actual time=[\d.]+\.\.([\d.]+)/)
  const ms = m ? Number(m[1]) : 0
  if (ms > 300 || /CTE|Seq Scan|Hash Join|Nested Loop|Materialize|Sort |Aggregate|Planning|Execution/.test(l)) {
    console.log(l.length > 190 ? l.slice(0,190)+'…' : l)
  }
}
await c.end()
