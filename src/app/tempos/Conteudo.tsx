'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { parsearFiltros } from '@/lib/filtros'
import { useHeatmap, useKpis, useMtta, useRanking, useSerie } from '@/lib/useIndicador'
import { Painel } from '@/components/Painel'
import { StatTile } from '@/components/kpi/StatTile'
import { SerieMttr } from '@/components/charts/SerieMttr'
import { HeatmapDiaTurno, FAIXAS_MTTR } from '@/components/charts/HeatmapDiaTurno'
import { RankingBarras } from '@/components/charts/RankingBarras'
import { fmtHoras, fmtInt, fmtFracaoPct } from '@/lib/formato'

/**
 * A TELA É DIVIDIDA POR EIXO, NÃO POR TIPO DE GRÁFICO.
 *
 * Os dois blocos abaixo medem coisas diferentes e por isso contam o tempo a
 * partir de pontos diferentes do calendário. A única forma de isso não ser lido
 * como incoerência é dizer qual é qual, em voz alta, no cabeçalho de cada um:
 *
 * - DESEMPENHO (encerramento) — o reparo pertence ao mês em que o cliente
 *   voltou a operar. Responde "estamos consertando mais rápido?".
 * - CAPACIDADE (abertura) — o reparo pertence ao momento em que entrou.
 *   Responde "quem abre chamado agora espera quanto?".
 *
 * Um protocolo aberto 31/07 e fechado 02/08 está no MTTR de agosto E na célula
 * de sexta-feira do mapa. Os dois estão certos; são perguntas distintas.
 *
 * Por isso o seletor "Eixo da data" da barra superior não aparece nesta tela
 * (ver BarraFiltros): aqui ele não teria o que governar.
 */
function Bloco({
  titulo,
  eixo,
  explicacao,
  children,
}: {
  titulo: string
  eixo: string
  explicacao: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3" aria-label={titulo}>
      <div className="flex flex-col gap-0.5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[13px] font-semibold tracking-[0.08em] text-[var(--text-primary)]">
            {titulo}
          </h2>
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-medium"
            style={{ background: 'var(--surface-raised)', color: 'var(--text-secondary)' }}
          >
            por {eixo}
          </span>
        </div>
        <p className="max-w-[92ch] text-[11px] leading-relaxed text-[var(--text-muted)]">
          {explicacao}
        </p>
      </div>
      {children}
    </section>
  )
}

/** Legenda das faixas do BI — sem ela a cor da célula é enfeite. */
function LegendaFaixas() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[var(--text-muted)]">
      <span>Faixas do Power BI:</span>
      {FAIXAS_MTTR.map((f) => (
        <span key={f.label} className="flex items-center gap-1">
          <span
            className="inline-block size-2.5 rounded-[2px]"
            style={{ background: f.cor }}
            aria-hidden="true"
          />
          {f.label}
        </span>
      ))}
    </div>
  )
}

export function TemposConteudo() {
  const sp = useSearchParams()
  const filtros = useMemo(() => parsearFiltros(Object.fromEntries(sp.entries())), [sp])
  const [metrica, setMetrica] = useState<'protocolos' | 'mttr'>('mttr')

  const kpis = useKpis(filtros)
  const mtta = useMtta(filtros)
  const serie = useSerie(filtros)
  const heat = useHeatmap(filtros)
  const porTurno = useRanking(filtros, 'turno', 4)
  const porDia = useRanking(filtros, 'diaSemana', 7)

  const k = kpis.data?.data
  const m = mtta.data?.data

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-7">
      <Bloco
        titulo="DESEMPENHO DA OPERAÇÃO"
        eixo="encerramento"
        explicacao="O reparo é contado no mês em que o cliente voltou a operar, não no de abertura. Um protocolo aberto em 31/07 e fechado em 02/08 é resultado de agosto — mesma regra do Power BI (USERELATIONSHIP com dataEncerrado), e é o que impede o número de um mês fechado continuar mudando semanas depois."
      >
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}
        >
          <StatTile
            rotulo="MTTR — reparo total"
            valor={kpis.isLoading ? '…' : fmtHoras(k?.mttrHoras)}
            contexto="criação → encerramento"
            subirEhRuim
            variacao={
              k && k.anterior.mttrHoras && k.mttrHoras
                ? (k.mttrHoras - k.anterior.mttrHoras) / k.anterior.mttrHoras
                : null
            }
            destaque
          />
          <StatTile
            rotulo="MTTA — tempo de campo"
            valor={mtta.isLoading ? '…' : fmtHoras(m?.mttaHoras)}
            contexto={
              m
                ? `deslocamento ${fmtHoras(m.deslocamentoHoras)} + atendimento ${fmtHoras(m.atendimentoHoras)}`
                : 'deslocamento + atendimento'
            }
            subirEhRuim
          />
          <StatTile
            rotulo="Reparos encerrados"
            valor={kpis.isLoading ? '…' : fmtInt(k?.encerradosNoPeriodo)}
            contexto={
              m && m.protocolosSemRelato > 0
                ? `${fmtInt(m.protocolosSemRelato)} sem relato de campo (fora do MTTA)`
                : 'base do MTTR e do MTTA'
            }
          />
        </div>

        <Painel
          titulo="MTTR médio no tempo"
          descricao="Cada ponto é a média dos reparos encerrados naquele período. Linha tracejada marca a média do recorte."
          carregando={serie.isLoading}
          erro={serie.error ? String(serie.error.message) : null}
          nota={serie.data ? `Consulta em ${serie.data.meta.ms} ms` : undefined}
          tabela={{
            colunas: [
              { chave: 'periodo', rotulo: 'Período' },
              { chave: 'mttr', rotulo: 'MTTR médio', alinhar: 'dir' },
              { chave: 'encerrados', rotulo: 'Encerrados', alinhar: 'dir' },
            ],
            linhas: (serie.data?.data ?? []).map((d) => ({
              periodo: d.periodo,
              mttr: fmtHoras(d.mttrHoras),
              encerrados: fmtInt(d.encerrados),
            })),
          }}
        >
          {serie.data && (
            <SerieMttr dados={serie.data.data} granularidade={filtros.granularidade} altura={220} />
          )}
        </Painel>
      </Bloco>

      <Bloco
        titulo="CAPACIDADE DE ATENDIMENTO"
        eixo="abertura"
        explicacao="Reparo que ENTRA neste dia e nesta hora espera quanto. Sábado à noite espera até segunda — o que aparece aqui é escala e folga, na visão do cliente, e não lentidão da equipe. Os painéis abaixo classificam o protocolo pelo instante da abertura, mesmo que ele tenha sido encerrado em outro mês."
      >
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)' }}
        >
          <Painel
            titulo="MTTR_A — dia da semana × turno"
            descricao="Cores nas faixas do Power BI. Substitui os pivots do Relatório Executivo."
            carregando={heat.isLoading}
            erro={heat.error ? String(heat.error.message) : null}
            nota={metrica === 'mttr' ? <LegendaFaixas /> : undefined}
            acoes={
              <div
                className="flex overflow-hidden rounded border text-[11px]"
                style={{ borderColor: 'var(--border)' }}
                role="group"
                aria-label="métrica do heatmap"
              >
                {(
                  [
                    ['mttr', 'MTTR'],
                    ['protocolos', 'Abertos'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setMetrica(id)}
                    aria-pressed={metrica === id}
                    className={`px-2 py-1 transition-colors ${
                      metrica === id
                        ? 'bg-[var(--brand)] text-[var(--brand-ink)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            }
            tabela={{
              colunas: [
                { chave: 'dia', rotulo: 'Dia' },
                { chave: 'turno', rotulo: 'Turno' },
                { chave: 'protocolos', rotulo: 'Abertos', alinhar: 'dir' },
                { chave: 'mttr', rotulo: 'MTTR', alinhar: 'dir' },
              ],
              linhas: (heat.data?.data ?? []).map((c) => ({
                dia: c.diaLabel,
                turno: c.turno.slice(3),
                protocolos: fmtInt(c.protocolos),
                mttr: fmtHoras(c.mttrHoras),
              })),
            }}
          >
            {heat.data && <HeatmapDiaTurno dados={heat.data.data} metrica={metrica} altura={230} />}
          </Painel>

          <div className="flex flex-col gap-4">
            <Painel
              titulo="Volume por turno"
              descricao="Ordem natural do dia — não ordenado por volume"
              carregando={porTurno.isLoading}
              erro={porTurno.error ? String(porTurno.error.message) : null}
              tabela={{
                colunas: [
                  { chave: 'rotulo', rotulo: 'Turno' },
                  { chave: 'protocolos', rotulo: 'Protocolos', alinhar: 'dir' },
                  { chave: 'share', rotulo: 'Share', alinhar: 'dir' },
                  { chave: 'mttr', rotulo: 'MTTR', alinhar: 'dir' },
                ],
                linhas: (porTurno.data?.data ?? []).map((d) => ({
                  rotulo: d.rotulo,
                  protocolos: fmtInt(d.protocolos),
                  share: fmtFracaoPct(d.share, 1),
                  mttr: fmtHoras(d.mttrHoras),
                })),
              }}
            >
              {porTurno.data && (
                <RankingBarras dados={porTurno.data.data} altura={130} escala="ordinal" />
              )}
            </Painel>

            <Painel
              titulo="Volume por dia da semana"
              descricao="Domingo a sábado, na ordem da semana"
              carregando={porDia.isLoading}
              erro={porDia.error ? String(porDia.error.message) : null}
              tabela={{
                colunas: [
                  { chave: 'rotulo', rotulo: 'Dia' },
                  { chave: 'protocolos', rotulo: 'Protocolos', alinhar: 'dir' },
                  { chave: 'mttr', rotulo: 'MTTR', alinhar: 'dir' },
                ],
                linhas: (porDia.data?.data ?? []).map((d) => ({
                  rotulo: d.rotulo,
                  protocolos: fmtInt(d.protocolos),
                  mttr: fmtHoras(d.mttrHoras),
                })),
              }}
            >
              {porDia.data && (
                <RankingBarras dados={porDia.data.data} altura={200} escala="ordinal" />
              )}
            </Painel>
          </div>
        </div>
      </Bloco>
    </div>
  )
}
