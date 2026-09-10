import pg from 'pg'

/**
 * Configuração de parsers do node-postgres.
 *
 * Dois problemas reais medidos no ERP (docs/02-schema-postgres.md §7):
 *
 * 1. TIMESTAMP SEM FUSO. Todas as colunas de data do Voalle são
 *    `timestamp without time zone`. O driver as interpreta no fuso local do
 *    processo e devolve um `Date` deslocado: `date_trunc('month', …)` de
 *    2026-01-01 voltava como `2026-01-01T03:00:00.000Z`. Se o servidor rodar em
 *    UTC e a máquina de dev em -03, os números MUDAM. Solução: devolver
 *    timestamp/date como STRING crua e nunca reconstruir data no JS —
 *    todo cálculo de dia/mês/turno acontece no Postgres.
 *
 * 2. BIGINT COMO STRING. `count(*)` é int8 e o driver devolve string para não
 *    perder precisão. Nossos volumes (milhões, não quintilhões) cabem em
 *    Number com folga, então convertemos — mas com guarda de segurança.
 */

const OID = {
  INT8: 20,
  NUMERIC: 1700,
  DATE: 1082,
  TIMESTAMP: 1114,
  TIMESTAMPTZ: 1184,
} as const

let configurado = false

export function configurarTiposPg(): void {
  if (configurado) return
  configurado = true

  // datas: string crua, sem conversão de fuso
  pg.types.setTypeParser(OID.DATE, (v) => v)
  pg.types.setTypeParser(OID.TIMESTAMP, (v) => v)
  pg.types.setTypeParser(OID.TIMESTAMPTZ, (v) => v)

  // int8 → number, com guarda contra perda de precisão
  pg.types.setTypeParser(OID.INT8, (v) => {
    if (v === null) return null
    const n = Number(v)
    if (!Number.isSafeInteger(n)) {
      throw new Error(
        `int8 fora da faixa segura de Number: ${v}. Trate essa coluna como string.`
      )
    }
    return n
  })

  // numeric → number (usamos para médias, percentuais e potência óptica)
  pg.types.setTypeParser(OID.NUMERIC, (v) => (v === null ? null : Number(v)))
}
