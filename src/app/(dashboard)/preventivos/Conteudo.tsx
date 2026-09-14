'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { GRANULARIDADES, parsearFiltros } from '@/lib/filtros'
import { useCoeficiente, usePreventivos } from '@/lib/useIndicador'
import { Painel } from '@/components/Painel'
import { StatTile } from '@/components/kpi/StatTile'
import { RankingSimples } from '@/components/charts/RankingSimples'
import { ColunasPeriodo } from '@/components/charts/ColunasPeriodo'
import { fmtFracaoPct, fmtInt, fmtPeriodo } from '@/lib/formato'

export function PreventivosConteudo() {
  const sp = useSearchParams()
  const filtros = useMemo(() => parsearFiltros(Object.fromEntries(sp.entries())), [sp])

  const q = usePreventivos(filtros)
  const d = q.data?.data
  const t = d?.total
  const erro = q.error ? String(q.error.message) : null

  // Mesmo card do Executivo, mas com o numerador que esta tela mede: PREVENTIVAS
  // do recorte, não o total geral de protocolos abertos (que inclui reparo,
  // ativação etc. e não bateria com o resto da página).
  const coef = useCoeficiente(filtros)
  const baseClientes = coef.data?.data.at(-1)?.baseClientes ?? null
  const taxaEntrantes = t && baseClientes ? t.preventivas / baseClientes : null

  const tabelaDim = (linhas: NonNullable<typeof d>['porBase']) => ({
    colunas: [
      { chave: 'rotulo', rotulo: 'Item' },
      { chave: 'prev', rotulo: 'Preventivas', alinhar: 'dir' as const },
      { chave: 'reinc', rotulo: 'Reincidentes', alinhar: 'dir' as const },
      { chave: 'taxa', rotulo: 'Taxa', alinhar: 'dir' as const },
    ],
    linhas: linhas.map((x) => ({
      rotulo: x.rotulo,
      prev: fmtInt(x.preventivas),
      reinc: fmtInt(x.reincidentes),
      taxa: fmtFracaoPct(x.taxaReincidencia, 1),
    })),
  })

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
      <p
        className="rounded-md border px-3 py-2 text-xs text-[var(--text-secondary)]"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
      >
        A pergunta aqui não é quantas preventivas fizemos — é{' '}
        <strong>se a preventiva resolveu</strong>. Uma preventiva seguida de reparo no
        mesmo login em até 90 dias é <strong>reincidente</strong>. Toda preventiva do
        recorte entra na conta, independente de quando foi aberta — quanto mais cedo o
        retorno, mais grave.
      </p>

      {/*
        Aviso necessário, não decorativo — mesmo motivo do que existe em
        Produtividade. A barra de filtros é global e mostra "Eixo da data"
        ativo, mas esta página só sabe ler CRIAÇÃO: a janela de 90 dias de
        reincidência começa a correr quando a preventiva é aberta. Sem este
        aviso, quem escolhesse "Encerramento" veria a tela não mudar e não teria
        como saber se o filtro não se aplica ou se o dashboard travou.

        A granularidade, essa, passou a valer em 14/09/2026. Antes o painel era
        mensal à força e escolher "Dia" devolvia uma coluna só — o mesmo
        silêncio, e ele realmente foi lido como defeito.
      */}
      <p
        className="rounded-md border px-3 py-2 text-xs text-[var(--text-secondary)]"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
        role="note"
      >
        <strong>Nesta página o período é sempre pela data de criação</strong> — a janela
        de 90 dias conta a partir da abertura da preventiva, então o controle de{' '}
        <em>eixo da data</em> não se aplica aqui. A <em>granularidade</em> vale para o
        volume; a série da taxa é sempre mensal, porque a reincidência de um único dia
        oscila demais para ser lida. Os demais filtros valem normalmente.
      </p>

      {/* AVISO DE MATURIDADE.
          O denominador inclui as preventivas recentes, que tiveram menos de 90
          dias para reincidir. Isso SUBESTIMA a taxa de um recorte novo, e ela
          sobe sozinha nas semanas seguintes. Sem este aviso, comparar julho com
          março seria comparar coisas diferentes sem saber. */}
      {t && t.recentes > 0 && (
        <p
          className="rounded border px-3 py-2 text-xs leading-relaxed"
          style={{
            borderColor: 'var(--status-warning)',
            background: 'color-mix(in srgb, var(--status-warning) 10%, transparent)',
            color: 'var(--text-primary)',
          }}
          role="status"
        >
          <strong>Taxa ainda em formação.</strong> {fmtInt(t.recentes)} das{' '}
          {fmtInt(t.preventivas)} preventivas deste recorte têm menos de 90 dias, então
          ainda não tiveram a janela inteira para reincidir. A taxa tende a{' '}
          <strong>subir</strong> conforme elas amadurecem — evite comparar este recorte
          com um período já fechado sem levar isso em conta.
        </p>
      )}

      <section
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}
        aria-label="Reincidência após a preventiva"
      >
        <StatTile
          rotulo="Taxa de reincidência"
          valor={q.isLoading ? '…' : fmtFracaoPct(t?.taxaReincidencia, 1)}
          contexto={
            t ? `${fmtInt(t.reincidentes)} de ${fmtInt(t.preventivas)} preventivas` : undefined
          }
          subirEhRuim
          destaque
        />
        <StatTile
          rotulo="Reincidente em ≤ 30 dias"
          valor={q.isLoading ? '…' : fmtFracaoPct(t?.pct30, 1)}
          contexto="a mais grave: voltou logo"
          subirEhRuim
        />
        <StatTile
          rotulo="Reincidente em 31–60 dias"
          valor={q.isLoading ? '…' : fmtFracaoPct(t?.pct60, 1)}
          contexto="grave, mas não a pior"
          subirEhRuim
        />
        <StatTile
          rotulo="Reincidente em 61–90 dias"
          valor={q.isLoading ? '…' : fmtFracaoPct(t?.pct90, 1)}
          contexto="no fim da janela de 90 dias"
          subirEhRuim
        />
        <StatTile
          rotulo="Preventivas no período"
          valor={q.isLoading ? '…' : fmtInt(t?.preventivas)}
          contexto={
            t && t.recentes > 0 ? `${fmtInt(t.recentes)} com menos de 90 dias` : undefined
          }
        />
        <StatTile
          rotulo="Sem reincidência"
          valor={
            q.isLoading || !t
              ? '…'
              : fmtFracaoPct(t.taxaReincidencia === null ? null : 1 - t.taxaReincidencia, 1)
          }
          contexto="preventiva que cumpriu o papel"
        />
        <StatTile
          rotulo="Entrantes / base de clientes"
          valor={q.isLoading || coef.isLoading ? '…' : fmtFracaoPct(taxaEntrantes, 2)}
          subirEhRuim
          contexto={
            t && baseClientes
              ? `${fmtInt(t.preventivas)} / ${fmtInt(baseClientes)} clientes${
                  coef.data?.meta.apenasRegiao ? ' (região)' : ''
                }`
              : undefined
          }
        />
      </section>

      {/* Volume no topo, como no visual `PROTOCOLOS PREVENTIVOS ABERTOS MÊS` do
          Power BI: antes de discutir qualidade, quanto se fez.

          Segue a granularidade da barra desde 14/09/2026 — o volume diário tem
          sinal de verdade (em setembro/2026: 80 preventivas numa terça contra 1
          num domingo), e antes o painel era mensal à força. Só o VOLUME segue a
          granularidade; a série da TAXA, mais abaixo, continua mensal de
          propósito — ver o comentário lá. */}
      {d && d.porPeriodo.length > 0 && (
        <Painel
          titulo={`Preventivas abertas por ${GRANULARIDADES[filtros.granularidade].label.toLowerCase()}`}
          descricao="Volume de protocolos preventivos criados — o tooltip traz a reincidência do período"
          carregando={q.isLoading}
          erro={erro}
          tabela={{
            colunas: [
              { chave: 'periodo', rotulo: 'Período' },
              { chave: 'prev', rotulo: 'Preventivas', alinhar: 'dir' },
              { chave: 'reinc', rotulo: 'Reincidentes', alinhar: 'dir' },
              { chave: 'taxa', rotulo: 'Taxa', alinhar: 'dir' },
            ],
            linhas: d.porPeriodo.map((x) => ({
              periodo: fmtPeriodo(x.periodo, filtros.granularidade),
              prev: fmtInt(x.preventivas),
              reinc: fmtInt(x.reincidentes),
              taxa: fmtFracaoPct(x.taxaReincidencia, 1),
            })),
          }}
        >
          <ColunasPeriodo
            dados={d.porPeriodo.map((x) => ({
              periodo: x.periodo,
              valor: x.preventivas,
              detalhe: `${fmtInt(x.reincidentes)} reincidentes · taxa ${fmtFracaoPct(x.taxaReincidencia, 1)}`,
            }))}
            granularidade={filtros.granularidade}
            unidade="preventivas"
            altura={210}
          />
        </Painel>
      )}

      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}
      >
        <Painel
          titulo="Desfecho das preventivas"
          descricao="Quanto mais cedo o retorno, mais grave — a rampa mostra a ordem"
          carregando={q.isLoading}
          erro={erro}
          nota={q.data ? `Consulta em ${fmtInt(q.data.meta.ms)} ms` : undefined}
          tabela={{
            colunas: [
              { chave: 'classe', rotulo: 'Desfecho' },
              { chave: 'prev', rotulo: 'Preventivas', alinhar: 'dir' },
              { chave: 'share', rotulo: 'Share', alinhar: 'dir' },
            ],
            linhas: (d?.porClasse ?? []).map((x) => ({
              classe: x.classe,
              prev: fmtInt(x.preventivas),
              share: fmtFracaoPct(x.share, 1),
            })),
          }}
        >
          {d && (
            <RankingSimples
              dados={d.porClasse.map((x) => ({
                rotulo: x.classe,
                valor: x.preventivas,
                share: x.share,
                // "sem reincidência" é sucesso: fica fora da rampa de gravidade
                neutro: x.classe === 'Sem reincidência',
              }))}
              unidade="preventivas"
              escala="ordinal"
              altura={170}
            />
          )}
        </Painel>

        <Painel
          titulo="Por categoria da preventiva"
          descricao="Onde a ação preventiva não está resolvendo"
          carregando={q.isLoading}
          erro={erro}
          nota="Barra = volume. O tooltip e a tabela trazem a taxa de reincidência."
          tabela={tabelaDim(d?.porCategoria ?? [])}
        >
          {d && (
            <RankingSimples
              dados={d.porCategoria.slice(0, 10).map((x) => ({
                rotulo: x.rotulo,
                valor: x.preventivas,
                detalhe: `reincidência ${fmtFracaoPct(x.taxaReincidencia, 1)} · ${fmtInt(x.reincidentes)} de ${fmtInt(x.preventivas)}`,
              }))}
              unidade="preventivas"
            />
          )}
        </Painel>
      </div>

      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}
      >
        <Painel
          titulo="Por base"
          descricao="Supervisões diferentes — use o filtro de Base para isolar a sua"
          carregando={q.isLoading}
          erro={erro}
          tabela={tabelaDim(d?.porBase ?? [])}
        >
          {d && (
            <RankingSimples
              dados={d.porBase.map((x) => ({
                rotulo: x.rotulo,
                valor: x.preventivas,
                detalhe: `reincidência ${fmtFracaoPct(x.taxaReincidencia, 1)}`,
              }))}
              unidade="preventivas"
              altura={150}
            />
          )}
        </Painel>

        <Painel
          titulo="Por cidade"
          descricao="Volume de preventiva e onde ela retorna"
          carregando={q.isLoading}
          erro={erro}
          tabela={tabelaDim(d?.porCidade ?? [])}
        >
          {d && (
            <RankingSimples
              dados={d.porCidade.slice(0, 10).map((x) => ({
                rotulo: x.rotulo,
                valor: x.preventivas,
                detalhe: `reincidência ${fmtFracaoPct(x.taxaReincidencia, 1)}`,
              }))}
              unidade="preventivas"
            />
          )}
        </Painel>
      </div>

      <Painel
        titulo="Por técnico que atendeu a preventiva"
        descricao="Quem executou a preventiva — não quem atendeu o reparo que veio depois"
        carregando={q.isLoading}
        erro={erro}
        nota="Barra = volume de preventivas. Ordene pela tabela para ver a taxa."
        tabela={tabelaDim(d?.porTecnico ?? [])}
      >
        {d && (
          <RankingSimples
            dados={d.porTecnico.slice(0, 15).map((x) => ({
              rotulo: x.rotulo,
              valor: x.preventivas,
              detalhe: `reincidência ${fmtFracaoPct(x.taxaReincidencia, 1)} · ${fmtInt(x.reincidentes)} de ${fmtInt(x.preventivas)}`,
            }))}
            unidade="preventivas"
            altura={Math.max(180, Math.min(15, d.porTecnico.length) * 26)}
          />
        )}
      </Painel>

      {/* SEMPRE MENSAL, qualquer que seja a granularidade escolhida — e isso é
          deliberado, não um resto do painel antigo.

          O volume lá em cima ganhou o balde do filtro porque volume diário tem
          sinal. A TAXA não tem: em setembro/2026 foram ~15 reincidentes em 14
          dias, cerca de um por dia. No domingo 13, com 1 preventiva no dia, a
          taxa só podia dar 0% ou 100% — e pintaria de vermelho um dia que não
          diz nada. A janela de reincidência é de 90 dias; o mês é a menor caixa
          que a comporta. O título já diz "mês a mês", então a tela não mente. */}
      {d && d.porMes.length > 1 && (
        <Painel
          titulo="Reincidência mês a mês"
          descricao="Meses recentes aparecem mais baixos: parte das preventivas ainda não completou 90 dias"
          carregando={q.isLoading}
          erro={erro}
          tabela={{
            colunas: [
              { chave: 'mes', rotulo: 'Mês' },
              { chave: 'prev', rotulo: 'Preventivas', alinhar: 'dir' },
              { chave: 'reinc', rotulo: 'Reincidentes', alinhar: 'dir' },
              { chave: 'taxa', rotulo: 'Taxa', alinhar: 'dir' },
            ],
            linhas: d.porMes.map((x) => ({
              mes: x.mes,
              prev: fmtInt(x.preventivas),
              reinc: fmtInt(x.reincidentes),
              taxa: fmtFracaoPct(x.taxaReincidencia, 1),
            })),
          }}
        >
          <RankingSimples
            dados={d.porMes.map((x) => ({
              rotulo: x.mes,
              valor: x.reincidentes,
              detalhe: `${fmtInt(x.preventivas)} preventivas · taxa ${fmtFracaoPct(x.taxaReincidencia, 1)}`,
            }))}
            unidade="reincidentes"
          />
        </Painel>
      )}
    </div>
  )
}
