'use client'

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { parsearFiltros } from '@/lib/filtros'
import { useOfensores } from '@/lib/useIndicador'
import { Painel } from '@/components/Painel'
import { StatTile } from '@/components/kpi/StatTile'
import { RankingSimples } from '@/components/charts/RankingSimples'
import type { ItemOfensor } from '@/server/indicadores/ofensores'
import { fmtFracaoPct, fmtInt } from '@/lib/formato'

/**
 * Ordenar por volume responde "onde estão os retornos"; por taxa responde "quem
 * retorna mais proporcionalmente". As duas perguntas são legítimas e dão listas
 * diferentes — deixar só uma esconde metade do problema.
 */
const ORDENS = [
  { id: 'retornos', label: 'Volume' },
  { id: 'taxa', label: 'Taxa' },
] as const
type Ordem = (typeof ORDENS)[number]['id']

/** Abaixo disto a taxa é ruído de amostra, não desempenho. */
const MIN_ATENDIMENTOS = 50

export function OfensoresConteudo() {
  const sp = useSearchParams()
  const filtros = useMemo(() => parsearFiltros(Object.fromEntries(sp.entries())), [sp])
  const [ordem, setOrdem] = useState<Ordem>('retornos')

  const q = useOfensores(filtros)
  const d = q.data?.data
  const t = d?.total
  const erro = q.error ? String(q.error.message) : null

  const tecnicos = useMemo(() => {
    const lista = (d?.porTecnicoAnterior ?? []).filter(
      (x) => (x.atendimentos ?? 0) >= MIN_ATENDIMENTOS
    )
    return [...lista]
      .sort((a, b) =>
        ordem === 'taxa'
          ? (b.taxaRetorno ?? 0) - (a.taxaRetorno ?? 0)
          : b.retornos - a.retornos
      )
      .slice(0, 15)
  }, [d?.porTecnicoAnterior, ordem])

  const ocultos = (d?.porTecnicoAnterior ?? []).filter(
    (x) => (x.atendimentos ?? 0) < MIN_ATENDIMENTOS
  ).length

  const tabelaSimples = (linhas: ItemOfensor[], rotulo: string) => ({
    colunas: [
      { chave: 'rotulo', rotulo },
      { chave: 'r30', rotulo: '≤30d', alinhar: 'dir' as const },
      { chave: 'r60', rotulo: '31–60d', alinhar: 'dir' as const },
      { chave: 'r90', rotulo: '61–90d', alinhar: 'dir' as const },
      { chave: 'total', rotulo: 'Retornos', alinhar: 'dir' as const },
    ],
    linhas: linhas.map((x) => ({
      rotulo: x.rotulo,
      r30: fmtInt(x.ret30),
      r60: fmtInt(x.ret60),
      r90: fmtInt(x.ret90),
      total: fmtInt(x.retornos),
    })),
  })

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
      <p
        className="rounded-md border px-3 py-2 text-xs text-[var(--text-secondary)]"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
        role="note"
      >
        Quando um reparo volta em até 90 dias no mesmo login PPPoE, esta página mostra{' '}
        <strong>o atendimento ANTERIOR</strong> — quem foi, qual solução aplicou, qual
        categoria. <strong>Não é ranking de culpa:</strong> a taxa vem sempre com o
        número de atendimentos, porque quem atende mais aparece mais no topo por
        volume, não por qualidade. Preventiva não entra em nenhuma das pontas — se o
        cliente abre reparo depois de uma preventiva, isso é qualidade da preventiva, e
        está na página Preventivos.
      </p>

      <section
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}
        aria-label="Retornos em até 90 dias"
      >
        <StatTile
          rotulo="Taxa de retorno"
          valor={q.isLoading ? '…' : fmtFracaoPct(t?.taxaRetorno, 1)}
          contexto={t ? `${fmtInt(t.retornos)} de ${fmtInt(t.reparos)} reparos` : undefined}
          subirEhRuim
          destaque
        />
        <StatTile
          rotulo="Voltou em ≤ 30 dias"
          valor={q.isLoading ? '…' : fmtInt(t?.ret30)}
          contexto="a mais grave"
          subirEhRuim
        />
        <StatTile
          rotulo="Voltou em 31–60 dias"
          valor={q.isLoading ? '…' : fmtInt(t?.ret60)}
          subirEhRuim
        />
        <StatTile
          rotulo="Voltou em 61–90 dias"
          valor={q.isLoading ? '…' : fmtInt(t?.ret90)}
          subirEhRuim
        />
      </section>

      <Painel
        titulo="Técnico do atendimento anterior"
        descricao="Alterne entre volume e taxa — as duas listas são diferentes e as duas importam"
        carregando={q.isLoading}
        erro={erro}
        nota={
          <>
            {ocultos > 0 &&
              `${ocultos} técnico(s) com menos de ${MIN_ATENDIMENTOS} atendimentos fora do gráfico — em amostra pequena a taxa é ruído. A tabela mostra todos. `}
            {q.data ? `Consulta em ${fmtInt(q.data.meta.ms)} ms.` : ''}
          </>
        }
        acoes={
          <div
            className="flex overflow-hidden rounded border text-[11px]"
            style={{ borderColor: 'var(--border)' }}
            role="group"
            aria-label="ordenar por"
          >
            {ORDENS.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setOrdem(o.id)}
                aria-pressed={ordem === o.id}
                className={`px-2 py-1 transition-colors ${
                  ordem === o.id
                    ? 'bg-[var(--brand)] text-[var(--brand-ink)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        }
        tabela={{
          colunas: [
            { chave: 'tecnico', rotulo: 'Técnico anterior' },
            { chave: 'r30', rotulo: '≤30d', alinhar: 'dir' },
            { chave: 'r60', rotulo: '31–60d', alinhar: 'dir' },
            { chave: 'r90', rotulo: '61–90d', alinhar: 'dir' },
            { chave: 'total', rotulo: 'Retornos', alinhar: 'dir' },
            { chave: 'atend', rotulo: 'Atendimentos', alinhar: 'dir' },
            { chave: 'taxa', rotulo: 'Taxa de retorno', alinhar: 'dir' },
          ],
          linhas: (d?.porTecnicoAnterior ?? []).map((x) => ({
            tecnico: x.rotulo,
            r30: fmtInt(x.ret30),
            r60: fmtInt(x.ret60),
            r90: fmtInt(x.ret90),
            total: fmtInt(x.retornos),
            atend: fmtInt(x.atendimentos),
            taxa: fmtFracaoPct(x.taxaRetorno, 1),
          })),
        }}
      >
        {d && (
          <RankingSimples
            dados={tecnicos.map((x) => ({
              rotulo: x.rotulo,
              valor: ordem === 'taxa' ? Math.round((x.taxaRetorno ?? 0) * 1000) : x.retornos,
              detalhe: `${fmtInt(x.retornos)} retornos em ${fmtInt(x.atendimentos)} atendimentos · taxa ${fmtFracaoPct(x.taxaRetorno, 1)} · ≤30d ${fmtInt(x.ret30)}`,
            }))}
            unidade={ordem === 'taxa' ? '‰ de retorno' : 'retornos'}
          />
        )}
      </Painel>

      {/*
        POR CLIENTE — o mesmo conjunto de 383 retornos, agrupado por quem sofreu.

        Os painéis de técnico, solução e categoria respondem "por que voltou".
        Este responde "com quem voltou", que é a pergunta de quem vai ligar para o
        cliente antes que ele ligue de novo. A Manutenção pediu em 01/09/2026, a
        partir de uma dinâmica que já montava na mão a cada mês.

        SEM TAXA, e de propósito: o denominador que existe aqui conta reparo por
        TÉCNICO responsável. Cruzá-lo com nome de cliente devolveria uma taxa de
        coisa nenhuma. Aqui o que importa é volume e distância do retorno.
      */}
      <Painel
        titulo="Cliente que voltou"
        descricao="Onde o retorno se concentra — quem chamou de novo, e quão rápido"
        carregando={q.isLoading}
        erro={erro}
        nota={
          d ? (
            <>
              Soma <strong>{fmtInt(d.total.retornos)}</strong> retornos, o mesmo total
              dos cartões — é o mesmo conjunto visto por outro eixo. Um cliente com
              mais de um login aparece uma vez só, somando todos.
            </>
          ) : undefined
        }
        tabela={{
          colunas: [
            { chave: 'cliente', rotulo: 'Cliente' },
            { chave: 'r30', rotulo: '≤30d', alinhar: 'dir' },
            { chave: 'r60', rotulo: '31–60d', alinhar: 'dir' },
            { chave: 'r90', rotulo: '61–90d', alinhar: 'dir' },
            { chave: 'total', rotulo: 'Total', alinhar: 'dir' },
          ],
          linhas: (d?.porCliente ?? []).map((x) => ({
            cliente: x.rotulo,
            r30: fmtInt(x.ret30),
            r60: fmtInt(x.ret60),
            r90: fmtInt(x.ret90),
            total: fmtInt(x.retornos),
          })),
        }}
      >
        {d && (
          <RankingSimples
            dados={d.porCliente.slice(0, 15).map((x) => ({
              rotulo: x.rotulo,
              valor: x.retornos,
              detalhe: `≤30d ${fmtInt(x.ret30)} · 31–60d ${fmtInt(x.ret60)} · 61–90d ${fmtInt(x.ret90)}`,
            }))}
            unidade="retornos"
          />
        )}
      </Painel>

      {/*
        Segunda medida, no formato do pivot "TÉCNICOS OFENSORES EM RECORRÊNCIA" do
        relatório atual. Existe para conferência: a classificação é CUMULATIVA
        (Recorrente 60 exige chamado em 30 E em 31–60), diferente do painel acima,
        que mede a distância até o atendimento anterior. As duas somam totais
        diferentes de propósito.
      */}
      <Painel
        titulo="Técnicos ofensores em recorrência (30 / 60 / 90 dias)"
        descricao="Classificação cumulativa do relatório atual — Recorrente 60 exige chamado em 30 E em 31–60"
        carregando={q.isLoading}
        erro={erro}
        nota={
          d ? (
            <>
              Total: <strong>{fmtInt(d.totalRecorrencia.rec30)}</strong> Rec30 ·{' '}
              <strong>{fmtInt(d.totalRecorrencia.rec60)}</strong> Rec60 ·{' '}
              <strong>{fmtInt(d.totalRecorrencia.rec90)}</strong> Rec90 ={' '}
              <strong>{fmtInt(d.totalRecorrencia.total)}</strong>. Não some com o painel
              acima — são medidas diferentes da mesma realidade.
            </>
          ) : undefined
        }
        tabela={{
          colunas: [
            { chave: 'tecnico', rotulo: 'Reparador resp. anterior' },
            { chave: 'r30', rotulo: 'Recorrente 30', alinhar: 'dir' },
            { chave: 'r60', rotulo: 'Recorrente 60', alinhar: 'dir' },
            { chave: 'r90', rotulo: 'Recorrente 90', alinhar: 'dir' },
            { chave: 'total', rotulo: 'Total', alinhar: 'dir' },
          ],
          linhas: (d?.porTecnicoRecorrencia ?? []).map((x) => ({
            tecnico: x.rotulo,
            r30: fmtInt(x.rec30),
            r60: fmtInt(x.rec60),
            r90: fmtInt(x.rec90),
            total: fmtInt(x.total),
          })),
        }}
      >
        {d && (
          <RankingSimples
            dados={d.porTecnicoRecorrencia.slice(0, 15).map((x) => ({
              rotulo: x.rotulo,
              valor: x.total,
              detalhe: `Rec30 ${fmtInt(x.rec30)} · Rec60 ${fmtInt(x.rec60)} · Rec90 ${fmtInt(x.rec90)}`,
            }))}
            unidade="recorrências"
          />
        )}
      </Painel>

      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}
      >
        <Painel
          titulo="Solução aplicada no atendimento anterior"
          descricao="O que foi feito e não resolveu — o corte mais acionável desta página"
          carregando={q.isLoading}
          erro={erro}
          tabela={tabelaSimples(d?.porSolucaoAnterior ?? [], 'Solução anterior')}
        >
          {d && (
            <RankingSimples
              dados={d.porSolucaoAnterior.slice(0, 12).map((x) => ({
                rotulo: x.rotulo,
                valor: x.retornos,
                detalhe: `≤30d ${fmtInt(x.ret30)} · 31–60d ${fmtInt(x.ret60)} · 61–90d ${fmtInt(x.ret90)}`,
              }))}
              unidade="retornos"
            />
          )}
        </Painel>

        <Painel
          titulo="Categoria do atendimento anterior"
          descricao="Natureza do problema que voltou"
          carregando={q.isLoading}
          erro={erro}
          tabela={tabelaSimples(d?.porCategoriaAnterior ?? [], 'Categoria anterior')}
        >
          {d && (
            <RankingSimples
              dados={d.porCategoriaAnterior.slice(0, 12).map((x) => ({
                rotulo: x.rotulo,
                valor: x.retornos,
                detalhe: `≤30d ${fmtInt(x.ret30)} · 31–60d ${fmtInt(x.ret60)} · 61–90d ${fmtInt(x.ret90)}`,
              }))}
              unidade="retornos"
            />
          )}
        </Painel>
      </div>
    </div>
  )
}
