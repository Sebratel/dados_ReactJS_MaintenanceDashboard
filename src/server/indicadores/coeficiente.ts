import type { RowDataPacket } from 'mysql2'
import { consultarErp } from '@/server/db/erp'
import { consultarMaria } from '@/server/db/maria'
import { CIDADES_REGIAO, META_COEFICIENTE } from '@/config/regras-negocio'
import type { Filtros } from '@/lib/filtros'
import { montarFrom, montarWhere, partesNecessarias } from './base'

export type PontoCoeficiente = {
  dia: string
  /** `null` em dia futuro — ver `futuro` abaixo */
  reparos: number | null
  baseClientes: number | null
  coeficiente: number | null
  meta: number
  /** true quando a base do dia veio do último snapshot conhecido (LOCF) */
  interpolado: boolean
  /**
   * Dia posterior a hoje, dentro de um recorte que alcança o futuro.
   *
   * SEPARADO DE `interpolado` DE PROPÓSITO, e a distinção não é acadêmica: sem
   * ela, todo dia futuro caía em `interpolado` — porque o Data Hub realmente
   * não tem base para amanhã — e o Executivo anunciava "16 dias com base
   * estimada" num mês em que nenhum dia estava estimado de verdade. O aviso
   * existe para denunciar buraco no Data Hub; enchê-lo de dias que ainda não
   * aconteceram o tornava ruído e escondia o buraco real.
   */
  futuro: boolean
}

/**
 * Coeficiente de Reparos = reparos do dia ÷ base de clientes do dia.
 *
 * Cruza os DOIS bancos:
 *   - numerador   → erp (Postgres): protocolos de manutenção abertos no dia
 *   - denominador → DB_Applicattion (MariaDB): Autentication_Contracts_Daily
 *
 * Duas armadilhas reais tratadas aqui (docs/02-schema-postgres.md §1.3):
 *
 * 1. A coluna `date` do MariaDB é `datetime` com a hora da carga (23:50:16).
 *    Agrupar sem `DATE()` cria um "dia" por segundo de carga.
 * 2. Faltam 13 dias de snapshot em 154. Aplicamos LOCF (last observation
 *    carried forward) e MARCAMOS o dia como interpolado — o gráfico precisa
 *    mostrar que aquele ponto é estimado, não medido.
 */
export async function obterCoeficiente(f: Filtros): Promise<{
  data: PontoCoeficiente[]
  meta: { diasInterpolados: number; apenasRegiao: boolean }
  ms: number
}> {
  const apenasRegiao = !f.cidade
  const cidades = f.cidade ?? [...CIDADES_REGIAO]

  // ── numerador: reparos por dia (sempre por data de criação) ──
  const FROM = montarFrom(partesNecessarias(f))
  const w = montarWhere({ ...f, eixo: 'criacao', cidade: cidades })
  const iDe = w.params.push(f.de)
  const iAte = w.params.push(f.ate)
  const sqlReparos = /* sql */ `
    WITH calendario AS (
      SELECT generate_series($${iDe}::date, $${iAte}::date, interval '1 day')::date AS dia
    ),
    dados AS (
      SELECT a.created::date AS dia, count(distinct ai.protocol)::int AS reparos
      ${FROM}
      ${w.sql}
      GROUP BY 1
    )
    SELECT c.dia::text AS dia, coalesce(d.reparos, 0) AS reparos
      FROM calendario c LEFT JOIN dados d ON d.dia = c.dia
     ORDER BY c.dia
  `

  // ── denominador: base de clientes por dia (MariaDB) ──
  // busca 60 dias antes do início para ter valor de LOCF na borda
  const inicioBusca = new Date(`${f.de}T00:00:00Z`)
  inicioBusca.setUTCDate(inicioBusca.getUTCDate() - 60)
  const sqlBase = `
    SELECT DATE(\`date\`) AS dia, SUM(total) AS clientes
      FROM Autentication_Contracts_Daily
     WHERE DATE(\`date\`) BETWEEN ? AND ?
       AND city IN (${cidades.map(() => '?').join(',')})
     GROUP BY DATE(\`date\`)
     ORDER BY dia
  `

  const [rReparos, rBase] = await Promise.all([
    consultarErp<{ dia: string; reparos: number }>(sqlReparos, w.params),
    consultarMaria<RowDataPacket & { dia: string; clientes: string | number }>(sqlBase, [
      inicioBusca.toISOString().slice(0, 10),
      f.ate,
      ...cidades,
    ]),
  ])

  const baseMap = new Map<string, number>()
  for (const r of rBase.rows) {
    baseMap.set(String(r.dia).slice(0, 10), Number(r.clientes))
  }

  // Hoje em ISO pelo relógio do SERVIDOR, que é o mesmo fuso do banco
  // (America/Sao_Paulo no container). Comparação de string funciona porque
  // 'YYYY-MM-DD' ordena lexicograficamente igual à data.
  const agora = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const hojeIso = `${agora.getFullYear()}-${pad(agora.getMonth() + 1)}-${pad(agora.getDate())}`

  let ultimoConhecido: number | null = null
  let diasInterpolados = 0
  const data: PontoCoeficiente[] = rReparos.rows.map((r) => {
    const dow = new Date(`${r.dia}T00:00:00Z`).getUTCDay()

    /*
     * DIA QUE AINDA NÃO ACONTECEU NÃO É MEDIDA NENHUMA.
     *
     * Antes ele vinha com `reparos: 0` e entrava no LOCF como se fosse um
     * buraco do Data Hub. Resultado: o gráfico caía a zero na ponta direita e
     * o aviso contava dias futuros como "base estimada". Decisão da Manutenção
     * em 15/09/2026 (item D de docs/06): o eixo vai até o fim do recorte, o
     * traço para em hoje. Sai do LOCF também — interpolar para a frente seria
     * projeção, e projeção foi recusada por ler como medição.
     */
    if (r.dia > hojeIso) {
      return {
        dia: r.dia,
        reparos: null,
        baseClientes: null,
        coeficiente: null,
        meta: META_COEFICIENTE[dow] ?? 0.0012,
        interpolado: false,
        futuro: true,
      }
    }

    const medido = baseMap.get(r.dia) ?? null
    let interpolado = false
    if (medido !== null) {
      ultimoConhecido = medido
    } else if (ultimoConhecido !== null) {
      interpolado = true
      diasInterpolados++
    }
    const base = medido ?? ultimoConhecido
    return {
      dia: r.dia,
      reparos: r.reparos,
      baseClientes: base,
      coeficiente: base ? r.reparos / base : null,
      meta: META_COEFICIENTE[dow] ?? 0.0012,
      interpolado,
      futuro: false,
    }
  })

  return {
    ms: Math.max(rReparos.ms, rBase.ms),
    meta: { diasInterpolados, apenasRegiao },
    data,
  }
}
