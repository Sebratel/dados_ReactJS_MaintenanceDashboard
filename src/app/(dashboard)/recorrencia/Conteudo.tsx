'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { parsearFiltros } from '@/lib/filtros'
import { useRecorrencia } from '@/lib/useIndicador'
import { Painel } from '@/components/Painel'
import { StatTile } from '@/components/kpi/StatTile'
import { RankingSimples } from '@/components/charts/RankingSimples'
import { fmtFracaoPct, fmtInt } from '@/lib/formato'

export function RecorrenciaConteudo() {
  const sp = useSearchParams()
  const filtros = useMemo(() => parsearFiltros(Object.fromEntries(sp.entries())), [sp])

  const q = useRecorrencia(filtros)
  const d = q.data?.data
  const t = d?.total
  const erro = q.error ? String(q.error.message) : null

  /** Saúde da ponte do PPPoE — se muitos protocolos caem no fallback, a chave
   *  por login perde precisão e o número muda de significado. */
  const semLogin = q.data?.meta.protocolosSemLogin ?? 0
  const noUniverso = q.data?.meta.protocolosNoUniverso ?? 0

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
      <p
        className="rounded-md border px-3 py-2 text-xs text-[var(--text-secondary)]"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
        role="note"
      >
        <strong>Reincidente</strong> = voltou a abrir chamado em <em>alguma</em> das
        janelas de 30/60/90 dias. <strong>Recorrente</strong> = voltou em{' '}
        <em>todas</em> as janelas consecutivas — problema crônico, não repetição
        eventual. Preventivas nunca contam, nem como chamado atual nem como anterior.
        {' '}A unidade é <strong>login-mês</strong>: a chave é o{' '}
        <strong>login PPPoE</strong>, não o cliente — um cliente corporativo com
        vários logins em cidades diferentes não vira recorrente por isso. Cada
        login entra uma vez por mês, pelo seu último protocolo não preventivo.
      </p>

      <section
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}
        aria-label="Indicadores de reincidência e recorrência"
      >
        <StatTile
          rotulo="Taxa de reincidência"
          valor={q.isLoading ? '…' : fmtFracaoPct(t?.taxaReincidencia, 1)}
          contexto={t ? `${fmtInt(t.reincidentes)} de ${fmtInt(t.clientesBase)}` : undefined}
          subirEhRuim
          destaque
        />
        <StatTile
          rotulo="Taxa de recorrência"
          valor={q.isLoading ? '…' : fmtFracaoPct(t?.taxaRecorrencia, 1)}
          contexto={t ? `${fmtInt(t.recorrentes)} clientes crônicos` : undefined}
          subirEhRuim
        />
        <StatTile
          rotulo="Reparos-mês"
          valor={q.isLoading ? '…' : fmtInt(t?.clientesBase)}
          contexto="último protocolo não preventivo de cada login"
        />
        <StatTile
          rotulo="Reincidente 30 d"
          valor={q.isLoading ? '…' : fmtFracaoPct(t?.pctReincidente30, 1)}
          contexto="chamado anterior há ≤ 30 dias"
          subirEhRuim
        />
        <StatTile
          rotulo="Reincidente 60 d"
          valor={q.isLoading ? '…' : fmtFracaoPct(t?.pctReincidente60, 1)}
          contexto="anterior entre 31 e 60 dias"
          subirEhRuim
        />
        <StatTile
          rotulo="Reincidente 90 d"
          valor={q.isLoading ? '…' : fmtFracaoPct(t?.pctReincidente90, 1)}
          contexto="anterior entre 61 e 90 dias"
          subirEhRuim
        />
      </section>

      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}
      >
        <Painel
          titulo="Classificação de reincidência"
          descricao="Alternativa: cai na janela mais distante em que houve chamado"
          carregando={q.isLoading}
          erro={erro}
          nota={q.data ? `Consulta em ${fmtInt(q.data.meta.ms)} ms` : undefined}
          tabela={{
            colunas: [
              { chave: 'classe', rotulo: 'Classe' },
              { chave: 'clientes', rotulo: 'Reparos-mês', alinhar: 'dir' },
              { chave: 'share', rotulo: 'Share', alinhar: 'dir' },
            ],
            linhas: (d?.porClasseReincidencia ?? []).map((x) => ({
              classe: x.classe,
              clientes: fmtInt(x.clientes),
              share: fmtFracaoPct(x.share, 1),
            })),
          }}
        >
          {d && (
            <RankingSimples
              dados={d.porClasseReincidencia.map((x) => ({
                rotulo: x.classe,
                valor: x.clientes,
                share: x.share,
                // "Não Reincidente" é ausência de evento, não um passo da escala
                neutro: x.classe === 'Não Reincidente',
              }))}
              unidade="reparos-mês"
              escala="ordinal"
              altura={150}
            />
          )}
        </Painel>

        <Painel
          titulo="Classificação de recorrência"
          descricao="Cumulativa: exige chamado em todas as janelas até ali"
          carregando={q.isLoading}
          erro={erro}
          nota="Exclui também os protocolos com categoria 5 = “Solucao Interna”"
          tabela={{
            colunas: [
              { chave: 'classe', rotulo: 'Classe' },
              { chave: 'clientes', rotulo: 'Reparos-mês', alinhar: 'dir' },
              { chave: 'share', rotulo: 'Share', alinhar: 'dir' },
            ],
            linhas: (d?.porClasseRecorrencia ?? []).map((x) => ({
              classe: x.classe,
              clientes: fmtInt(x.clientes),
              share: fmtFracaoPct(x.share, 1),
            })),
          }}
        >
          {d && (
            <RankingSimples
              dados={d.porClasseRecorrencia.map((x) => ({
                rotulo: x.classe,
                valor: x.clientes,
                share: x.share,
                neutro: x.classe === 'Não recorrente',
              }))}
              unidade="reparos-mês"
              escala="ordinal"
              altura={150}
            />
          )}
        </Painel>
      </div>

      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}
      >
        <Painel
          titulo="Reincidência por cidade"
          descricao="Barra = reparos-mês. O tooltip traz as duas taxas."
          carregando={q.isLoading}
          erro={erro}
          tabela={{
            colunas: [
              { chave: 'cidade', rotulo: 'Cidade' },
              { chave: 'clientes', rotulo: 'Reparos-mês', alinhar: 'dir' },
              { chave: 'rei', rotulo: 'Reincidentes', alinhar: 'dir' },
              { chave: 'taxaRei', rotulo: 'Taxa reinc.', alinhar: 'dir' },
              { chave: 'taxaRec', rotulo: 'Taxa recor.', alinhar: 'dir' },
            ],
            linhas: (d?.porCidade ?? []).map((x) => ({
              cidade: x.rotulo,
              clientes: fmtInt(x.clientes),
              rei: fmtInt(x.reincidentes),
              taxaRei: fmtFracaoPct(x.taxaReincidencia, 1),
              taxaRec: fmtFracaoPct(x.taxaRecorrencia, 1),
            })),
          }}
        >
          {d && (
            <RankingSimples
              dados={d.porCidade.slice(0, 10).map((x) => ({
                rotulo: x.rotulo,
                valor: x.clientes,
                detalhe: `reincidência ${fmtFracaoPct(x.taxaReincidencia, 1)} · recorrência ${fmtFracaoPct(x.taxaRecorrencia, 1)}`,
              }))}
              unidade="reparos-mês"
            />
          )}
        </Painel>

        <Painel
          titulo="Reincidência por catálogo"
          descricao="Reparo × Tecnologia × preventiva"
          carregando={q.isLoading}
          erro={erro}
          nota={
            noUniverso > 0 ? (
              <>
                Ponte do PPPoE:{' '}
                <strong>
                  {fmtInt(noUniverso - semLogin)} de {fmtInt(noUniverso)}
                </strong>{' '}
                protocolos resolveram para um login
                {semLogin > 0 && (
                  <>
                    ; os {fmtInt(semLogin)} restantes (serviço sem PPPoE) foram
                    agrupados pelo <em>service tag</em>, que identifica o mesmo
                    serviço
                  </>
                )}
                .
              </>
            ) : undefined
          }
          tabela={{
            colunas: [
              { chave: 'catalogo', rotulo: 'Catálogo' },
              { chave: 'clientes', rotulo: 'Reparos-mês', alinhar: 'dir' },
              { chave: 'rei', rotulo: 'Reincidentes', alinhar: 'dir' },
              { chave: 'taxaRei', rotulo: 'Taxa reinc.', alinhar: 'dir' },
              { chave: 'taxaRec', rotulo: 'Taxa recor.', alinhar: 'dir' },
            ],
            linhas: (d?.porCatalogo ?? []).map((x) => ({
              catalogo: x.rotulo,
              clientes: fmtInt(x.clientes),
              rei: fmtInt(x.reincidentes),
              taxaRei: fmtFracaoPct(x.taxaReincidencia, 1),
              taxaRec: fmtFracaoPct(x.taxaRecorrencia, 1),
            })),
          }}
        >
          {d && (
            <RankingSimples
              dados={d.porCatalogo.slice(0, 10).map((x) => ({
                rotulo: x.rotulo,
                valor: x.clientes,
                detalhe: `reincidência ${fmtFracaoPct(x.taxaReincidencia, 1)} · recorrência ${fmtFracaoPct(x.taxaRecorrencia, 1)}`,
              }))}
              unidade="reparos-mês"
            />
          )}
        </Painel>
      </div>

      {d && d.porMes.length > 1 && (
        <Painel
          titulo="Evolução mensal"
          descricao="Só aparece quando o recorte cobre mais de um mês"
          carregando={q.isLoading}
          erro={erro}
          tabela={{
            colunas: [
              { chave: 'mes', rotulo: 'Mês' },
              { chave: 'clientes', rotulo: 'Reparos-mês', alinhar: 'dir' },
              { chave: 'rei', rotulo: 'Reincidentes', alinhar: 'dir' },
              { chave: 'rec', rotulo: 'Recorrentes', alinhar: 'dir' },
              { chave: 'taxa', rotulo: 'Taxa reinc.', alinhar: 'dir' },
            ],
            linhas: d.porMes.map((x) => ({
              mes: x.mes,
              clientes: fmtInt(x.clientes),
              rei: fmtInt(x.reincidentes),
              rec: fmtInt(x.recorrentes),
              taxa: fmtFracaoPct(x.taxaReincidencia, 1),
            })),
          }}
        >
          <RankingSimples
            dados={d.porMes.map((x) => ({
              rotulo: x.mes,
              valor: x.reincidentes,
              detalhe: `${fmtInt(x.clientes)} reparos-mês · taxa ${fmtFracaoPct(x.taxaReincidencia, 1)}`,
            }))}
            unidade="reincidentes"
          />
        </Painel>
      )}
    </div>
  )
}
