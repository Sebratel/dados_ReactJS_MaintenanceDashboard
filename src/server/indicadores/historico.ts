import type { RowDataPacket } from 'mysql2'
import { consultarErp } from '@/server/db/erp'
import { consultarMaria } from '@/server/db/maria'
import {
  CATEGORIAS_PREVENTIVAS,
  CIDADES_REGIAO,
  TIPOS_PREVENTIVOS,
} from '@/config/regras-negocio'
import type { Filtros } from '@/lib/filtros'
import { montarFrom, montarWhere, partesNecessarias } from './base'

/**
 * Série MENSAL sobre a base de clientes — a visão que o Power BI repete em
 * quatro telas.
 *
 * "Por solicitação do time de Manutenção, quase tudo no BI tem cálculo
 * relacionado a % sobre a base de clientes." Campo conta protocolos,
 * Recorrência conta clientes, Preventivos conta preventivas — e os três
 * dividem pelo mesmo denominador. É UMA pergunta feita três vezes.
 *
 * ⚠️ POR QUE OS TRÊS NUMERADORES SAEM DA MESMA CONSULTA, E NÃO DE TRÊS.
 *
 * No Power BI eles saem de telas diferentes, e as telas DISCORDAM. Medido nos
 * rótulos em 16/10/2026: a tela de Recorrência mostra 2.358 clientes em
 * setembro com coeficiente 2,82% — mas 2.358 ÷ 87.218 = 2,70%. Os 2,82% são o
 * coeficiente da tela de Campo (2.463 protocolos). Uma tela está exibindo a
 * medida da outra sobre barras que contam coisa diferente, e ninguém percebeu
 * porque os dois números são plausíveis.
 *
 * Com um `FILTER` por métrica sobre o MESMO universo, isso não tem como
 * acontecer: o denominador é literalmente a mesma variável.
 *
 * ⚠️ O DENOMINADOR É O ÚLTIMO DIA MEDIDO DE CADA MÊS, não a média do mês. Base
 * de clientes é ESTOQUE, não fluxo: somar ou tirar média de snapshots diários
 * responderia "quantos clientes-dia tivemos", que não é a pergunta. O mês
 * corrente usa o último dia com medição, que é o melhor retrato disponível.
 */

export type MetricaHistorico = 'entrantes' | 'clientes' | 'preventivas'

export type PontoMesHistorico = {
  /** 'YYYY-MM' */
  mes: string
  entrantes: number
  clientes: number
  preventivas: number
  /** base do último dia MEDIDO do mês — `null` se o Data Hub não cobre o mês */
  baseClientes: number | null
}

export type ItemBaseHistorico = {
  base: string
  entrantes: number
  clientes: number
  preventivas: number
}

export type ResultadoHistorico = {
  data: {
    porMes: PontoMesHistorico[]
    porBase: ItemBaseHistorico[]
  }
  meta: { apenasRegiao: boolean; mesesSemBase: number }
  ms: number
}

type LinhaMes = {
  mes: string
  entrantes: number
  clientes: number
  preventivas: number
}

type LinhaBase = LinhaMes & { base: string | null }

export async function obterHistorico(f: Filtros): Promise<ResultadoHistorico> {
  // mesma regra de `coeficiente.ts`: sem filtro de cidade, o numerador é
  // restrito à região porque o denominador do Data Hub é regional. Comparar
  // protocolo do país inteiro com a base de 6 cidades inflaria o coeficiente.
  const apenasRegiao = !f.cidade
  const cidades = f.cidade ?? [...CIDADES_REGIAO]

  const FROM = montarFrom(partesNecessarias(f, { categorias: true, agenda: true }))
  const w = montarWhere({ ...f, eixo: 'criacao', cidade: cidades })
  const iTiposPrev = w.params.push([...TIPOS_PREVENTIVOS])
  const iCatsPrev = w.params.push([...CATEGORIAS_PREVENTIVAS])

  /*
   * A INSTALAÇÃO VEM DE UM LATERAL COM LIMIT 1, nunca de join direto.
   *
   * `erp.authentication_contracts` é 1:N por service_tag_id — há tag com 2.050
   * contratos. O join direto multiplicaria o protocolo, e aqui isso não
   * inflaria só a contagem: `instalacao` é o que o `count(distinct)` da métrica
   * de clientes usa. Mesma regra de desempate de protocolos.ts e preventivos.ts:
   * contrato ativo primeiro, depois o mais recente.
   */
  const lateralInstalacao = /* sql */ `
    LEFT JOIN LATERAL (
      SELECT x."user"
        FROM erp.authentication_contracts x
       WHERE x.service_tag_id = ai.contract_service_tag_id
       ORDER BY x.active DESC NULLS LAST, x.id DESC
       LIMIT 1
    ) ac ON true`

  const selecao = /* sql */ `
    count(distinct ai.protocol) FILTER (
      WHERE NOT (it.title = any($${iTiposPrev}) OR cat2.title = any($${iCatsPrev}))
    )::int AS entrantes,
    count(distinct coalesce(ac."user", 'tag:' || ai.contract_service_tag_id::text)) FILTER (
      WHERE NOT (it.title = any($${iTiposPrev}) OR cat2.title = any($${iCatsPrev}))
    )::int AS clientes,
    count(distinct ai.protocol) FILTER (
      WHERE it.title = any($${iTiposPrev}) OR cat2.title = any($${iCatsPrev})
    )::int AS preventivas`

  const sqlMes = /* sql */ `
    SELECT to_char(date_trunc('month', a.created), 'YYYY-MM') AS mes,
           ${selecao}
    ${FROM}
    ${lateralInstalacao}
    ${w.sql}
    GROUP BY 1
    ORDER BY 1
  `

  const sqlBaseDim = /* sql */ `
    SELECT s.regiao_agenda AS base,
           ${selecao}
    ${FROM}
    ${lateralInstalacao}
    ${w.sql}
    GROUP BY 1
  `

  // ── denominador: base de clientes por dia (MariaDB), reduzida ao mês ──
  const sqlBase = `
    SELECT DATE(\`date\`) AS dia, SUM(total) AS clientes
      FROM Autentication_Contracts_Daily
     WHERE DATE(\`date\`) BETWEEN ? AND ?
       AND city IN (${cidades.map(() => '?').join(',')})
     GROUP BY DATE(\`date\`)
     ORDER BY dia
  `

  const t0 = Date.now()
  const [rMes, rBase, rDim] = await Promise.all([
    consultarErp<LinhaMes>(sqlMes, w.params),
    consultarMaria<RowDataPacket & { dia: string; clientes: string | number }>(sqlBase, [
      f.de,
      f.ate,
      ...cidades,
    ]),
    consultarErp<LinhaBase>(sqlBaseDim, w.params),
  ])

  // último dia MEDIDO de cada mês — a série vem ordenada, então o último a
  // sobrescrever a chave é o maior dia daquele mês
  const basePorMes = new Map<string, number>()
  for (const r of rBase.rows) {
    const dia = String(r.dia).slice(0, 10)
    basePorMes.set(dia.slice(0, 7), Number(r.clientes))
  }

  const porMes: PontoMesHistorico[] = rMes.rows.map((r) => ({
    mes: r.mes,
    entrantes: r.entrantes,
    clientes: r.clientes,
    preventivas: r.preventivas,
    baseClientes: basePorMes.get(r.mes) ?? null,
  }))

  const porBase: ItemBaseHistorico[] = rDim.rows
    .map((r) => ({
      base: r.base ?? '(sem base)',
      entrantes: r.entrantes,
      clientes: r.clientes,
      preventivas: r.preventivas,
    }))
    .sort((a, b) => b.entrantes - a.entrantes)

  return {
    data: { porMes, porBase },
    meta: {
      apenasRegiao,
      mesesSemBase: porMes.filter((p) => p.baseClientes === null).length,
    },
    ms: Date.now() - t0,
  }
}
