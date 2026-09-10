import { consultarErp } from '@/server/db/erp'
import {
  CATALOGOS_MANUTENCAO,
  EQUIPES_MANUTENCAO,
  TRILHA_MANUTENCAO,
} from '@/config/regras-negocio'
import type { Filtros } from '@/lib/filtros'
import { montarFrom, montarWhere } from './base'

export type OpcoesFiltro = {
  base: string[]
  cidade: string[]
  equipe: string[]
  catalogo: string[]
  tipo: string[]
  status: string[]
  categoria2: string[]
  tecnico: string[]
}

/**
 * Valores disponíveis para os combos da barra de filtros.
 *
 * Uma ÚNICA varredura com `array_agg(DISTINCT …)`. A versão anterior fazia 7
 * `UNION ALL`, ou seja 7 varreduras completas do universo: 4,9 s no mês e 9,0 s
 * no ano — travava a barra de filtros no primeiro carregamento. Medido depois
 * da mudança: 231 ms no mês, 955 ms no ano (21× mais rápido).
 *
 * Ignora deliberadamente os filtros de dimensão: a lista de cidades não deve
 * sumir porque o usuário já selecionou uma. Mantém o recorte de período, para a
 * lista refletir o que existe na janela em análise.
 */
export async function obterOpcoesFiltro(f: Filtros): Promise<{ data: OpcoesFiltro; ms: number }> {
  const FROM = montarFrom({ categorias: true })
  const w = montarWhere(
    {
      ...f,
      cidade: undefined,
      equipe: undefined,
      catalogo: undefined,
      tipo: undefined,
      status: undefined,
      categoria2: undefined,
      tecnico: undefined,
      base: undefined,
    },
    // sem isto, 'Cancelado' nunca apareceria no combo de status — a exclusão
    // padrão do universo o esconderia, e a pessoa não teria como pedir a única
    // visão em que ele aparece. O combo lista o que EXISTE; o universo é quem
    // decide o que entra por padrão.
    { incluirCancelado: true }
  )

  const sql = /* sql */ `
    SELECT
      array_agg(DISTINCT p.city)     FILTER (WHERE nullif(trim(p.city), '')     IS NOT NULL) AS cidade,
      array_agg(DISTINCT t.title)    FILTER (WHERE nullif(trim(t.title), '')    IS NOT NULL) AS equipe,
      array_agg(DISTINCT cs.title)   FILTER (WHERE nullif(trim(cs.title), '')   IS NOT NULL) AS catalogo,
      array_agg(DISTINCT it.title)   FILTER (WHERE nullif(trim(it.title), '')   IS NOT NULL) AS tipo,
      array_agg(DISTINCT st.title)   FILTER (WHERE nullif(trim(st.title), '')   IS NOT NULL) AS status,
      array_agg(DISTINCT cat2.title) FILTER (WHERE nullif(trim(cat2.title), '') IS NOT NULL) AS categoria2,
      array_agg(DISTINCT resp.name)  FILTER (WHERE nullif(trim(resp.name), '')  IS NOT NULL) AS tecnico
    ${FROM}
    ${w.sql}
  `

  /**
   * A base e os executores NÃO saem do universo de protocolo: são
   * `region_title` e `resource_name` da view de field service.
   *
   * Consulta separada porque puxar o LATERAL da agenda para dentro da varredura
   * principal custaria ~2 s a ela. Separada, as duas rodam em paralelo no
   * `Promise.all` e o custo total é o da mais lenta, não a soma.
   *
   * ⚠️ Esta é a mais lenta: ~5,8 s no ano contra ~1 s da principal, porque a
   * view de field service é cara por definição. Os joins de universo somam ~0,6 s
   * (10%) — o preço de o combo concordar com as telas. Quem for otimizar: o alvo
   * é a view, não estes joins.
   */
  const sqlBase = /* sql */ `
    SELECT array_agg(DISTINCT v.region_title) FILTER (
             WHERE nullif(trim(v.region_title), '') IS NOT NULL
           ) AS base,
           -- os EXECUTORES de campo, que não são o mesmo conjunto dos
           -- responsáveis: o responsável de um protocolo reagendado vira o
           -- backoffice, e um técnico que só executa nunca aparece como
           -- responsável. Sem esta metade, escolher um técnico no combo e não
           -- achá-lo na Produtividade seria o comportamento normal.
           array_agg(DISTINCT v.resource_name) FILTER (
             WHERE v.routing_status >= 4
               AND nullif(trim(v.resource_name), '') IS NOT NULL
           ) AS executor
      FROM erp.v_service_desk_slots_productivity_informative v
      -- SÓ O QUE É MANUTENÇÃO, pela MESMA regra de universo do resto do sistema
      -- (equipe OU catálogo), e não pela lista de tipos.
      --
      -- Sem isto o combo oferecia "Base Canoas (Ativação)" e "Base São Leopoldo
      -- (Ativação)": bases reais, mas de instalação — escolher uma delas
      -- devolvia tela vazia, que parece defeito do dashboard. Elas entravam por
      -- causa do tipo 'TEC - Pendência Técnico Campo' (catálogo "Equipe
      -- ativação", 86 protocolos em 2026, TODOS em base de ativação), que está
      -- em TIPOS_CAMPO por aparecer na agenda de campo.
      --
      -- Recortar por equipe/catálogo em vez de por tipo é o que faz o combo
      -- concordar com as telas por construção: o que ele oferece é exatamente o
      -- que o universo contém. Filtrar por nome de base seria uma lista de
      -- proibidos que envelhece na primeira vez que a operação abrir uma base.
      JOIN erp.assignment_incidents ai   ON ai.assignment_id = v.assignment_id
      LEFT JOIN erp.teams t              ON t.id  = ai.team_id
      LEFT JOIN erp.catalog_services cs  ON cs.id = ai.catalog_service_id
     WHERE v.begin_date_slot >= $1::date
       AND v.begin_date_slot < ($2::date + interval '1 day')
       AND (t.id = any($3) OR cs.title = any($4))
       -- ── e SÓ bases da trilha de MANUTENÇÃO ───────────────────────────
       --
       -- O recorte por equipe/catálogo acima já tinha tirado a ✅Base Canoas
       -- (Ativação) do combo, mas não bastou: em 28/08/2026 a Manutenção viu a
       -- ✅Base São Leopoldo (Ativação) reaparecer.
       --
       -- E o combo não estava mentindo. Havia UM protocolo em julho/2026 — o
       -- 1735660, equipe Financeiro, tipo CX - ATENDIMENTO PRIORITARIO 72H —
       -- que entra no universo pelo catálogo "Oper. Tecnologia" e foi
       -- roteirizado para a trilha de instalação. Um em 3.843 (0,03%).
       --
       -- Só que oferecer uma base de ATIVAÇÃO num dashboard de MANUTENÇÃO não
       -- ajuda ninguém: quem clica está procurando um corte de supervisão que
       -- não existe, e encontra o resíduo de um roteamento atípico. A base sai
       -- do combo por não pertencer à operação, não por estar vazia.
       --
       -- ⚠️ O PROTOCOLO CONTINUA NOS NÚMEROS. Isto muda o que o combo OFERECE,
       -- não o que o universo CONTÉM — nenhuma contagem se move. Se ele também
       -- não devesse ser contado, isso é o item A da fila (universo por
       -- catálogo trazendo trabalho que não é manutenção), e mexe em valor.
       AND v.region_title LIKE $5`

  const [r, rb] = await Promise.all([
    consultarErp<Record<keyof OpcoesFiltro, string[] | null>>(sql, w.params),
    consultarErp<{ base: string[] | null; executor: string[] | null }>(sqlBase, [
      f.de,
      f.ate,
      [...EQUIPES_MANUTENCAO],
      [...CATALOGOS_MANUTENCAO],
      `%${TRILHA_MANUTENCAO}%`,
    ]),
  ])
  const linha = r.rows[0]

  const ordenar = (a: string[] | null | undefined) =>
    [...(a ?? [])].sort((x, y) => x.localeCompare(y, 'pt-BR'))

  return {
    ms: r.ms + rb.ms,
    data: {
      base: ordenar(rb.rows[0]?.base),
      cidade: ordenar(linha?.cidade),
      equipe: ordenar(linha?.equipe),
      catalogo: ordenar(linha?.catalogo),
      tipo: ordenar(linha?.tipo),
      status: ordenar(linha?.status),
      categoria2: ordenar(linha?.categoria2),
      // união responsáveis ∪ executores, porque o filtro atende os dois grãos:
      // nas telas de protocolo ele casa com o responsável, na Produtividade com
      // quem foi ao cliente.
      tecnico: ordenar([
        ...new Set([...(linha?.tecnico ?? []), ...(rb.rows[0]?.executor ?? [])]),
      ]),
    },
  }
}
