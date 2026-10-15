'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { parsearFiltros } from '@/lib/filtros'
import { useRecorrencia } from '@/lib/useIndicador'
import { Painel } from '@/components/Painel'
import { StatTile } from '@/components/kpi/StatTile'
import { RankingSimples } from '@/components/charts/RankingSimples'
import { fmtFracaoPct, fmtInt } from '@/lib/formato'

/**
 * ESTA TELA FALA DE RECORRÊNCIA, E SÓ DELA — decisão da Manutenção em
 * 15/10/2026, durante o batimento de setembro contra o Power BI.
 *
 * Antes a página mostrava as duas medidas lado a lado: reincidência (voltou em
 * ALGUMA das janelas) e recorrência (voltou em TODAS). São perguntas
 * diferentes, e misturá-las numa tela só custava caro na leitura — o cartão em
 * destaque era o de reincidência, os dois painéis de dimensão ranqueavam por
 * reincidência, e a evolução mensal plotava reincidentes. Quem abria a aba
 * "Recorrência" via, em primeiro plano, outro indicador.
 *
 * ⚠️ O CÁLCULO DE REINCIDÊNCIA CONTINUA INTEIRO NO BACKEND, de propósito:
 * `taxaReincidencia`, `pctReincidente30/60/90` e `porClasseReincidencia` seguem
 * sendo calculados e devolvidos pela API — só não são desenhados aqui. Foi o
 * pedido explícito: *"guarde os dados para uso no futuro, mas não vamos
 * apresentar aqui"*. Apagar o cálculo tornaria a volta atrás um trabalho de
 * reconstrução; mantê-lo é não desenhar.
 *
 * Quem quiser reincidência tem a tela de Preventivos (reincidência pós-ação
 * preventiva) e a de Ofensores (retorno por técnico).
 */
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
        <strong>Recorrente</strong> = o login voltou a abrir chamado em{' '}
        <em>todas</em> as janelas consecutivas — em até 30 dias, e também entre
        31 e 60, e também entre 61 e 90. É problema <strong>crônico</strong>, não
        repetição eventual: quem voltou uma vez só não entra aqui. Preventivas
        nunca contam, nem como chamado atual nem como anterior.{' '}
        A unidade é <strong>login-mês</strong>: a chave é o{' '}
        <strong>login PPPoE</strong>, não o cliente — um cliente corporativo com
        vários logins em cidades diferentes não vira recorrente por isso. Cada
        login entra uma vez por mês, pelo seu último protocolo não preventivo.
      </p>

      <section
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}
        aria-label="Indicadores de recorrência"
      >
        <StatTile
          rotulo="Taxa de recorrência"
          valor={q.isLoading ? '…' : fmtFracaoPct(t?.taxaRecorrencia, 1)}
          contexto={
            t ? `${fmtInt(t.recorrentes)} de ${fmtInt(t.clientesBase)} logins` : undefined
          }
          subirEhRuim
          destaque
        />
        <StatTile
          rotulo="Logins crônicos"
          valor={q.isLoading ? '…' : fmtInt(t?.recorrentes)}
          contexto="voltaram em todas as janelas"
          subirEhRuim
        />
        <StatTile
          rotulo="Reparos-mês"
          valor={q.isLoading ? '…' : fmtInt(t?.clientesBase)}
          contexto="último protocolo não preventivo de cada login"
        />
        {/*
          Os três abaixo são EXCLUSIVOS entre si e somam a taxa de recorrência
          acima — não são "quantos voltaram em 30 dias", que seria o acumulado.
          Ver a descrição do painel de classificação.
        */}
        <StatTile
          rotulo="Recorrente 30 d"
          valor={q.isLoading ? '…' : fmtFracaoPct(t?.pctRecorrente30, 1)}
          contexto="voltou só na janela de 30 dias"
          subirEhRuim
        />
        <StatTile
          rotulo="Recorrente 60 d"
          valor={q.isLoading ? '…' : fmtFracaoPct(t?.pctRecorrente60, 1)}
          contexto="voltou em 30 e também em 60"
          subirEhRuim
        />
        <StatTile
          rotulo="Recorrente 90 d"
          valor={q.isLoading ? '…' : fmtFracaoPct(t?.pctRecorrente90, 1)}
          contexto="voltou nas três janelas — o mais grave"
          subirEhRuim
        />
      </section>

      <Painel
        titulo="Classificação de recorrência"
        descricao="Cumulativa: exige chamado em todas as janelas até ali. As classes são exclusivas entre si."
        carregando={q.isLoading}
        erro={erro}
        nota={
          q.data
            ? `Exclui os protocolos com categoria 5 = “Solucao Interna” · consulta em ${fmtInt(q.data.meta.ms)} ms`
            : 'Exclui os protocolos com categoria 5 = “Solucao Interna”'
        }
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
              // "Não recorrente" é ausência de evento, não um passo da escala
              neutro: x.classe === 'Não recorrente',
            }))}
            unidade="reparos-mês"
            escala="ordinal"
            altura={150}
          />
        )}
      </Painel>

      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}
      >
        <Painel
          titulo="Recorrência por cidade"
          descricao="Barra = logins crônicos. O tooltip traz o volume e a taxa."
          carregando={q.isLoading}
          erro={erro}
          tabela={{
            colunas: [
              { chave: 'cidade', rotulo: 'Cidade' },
              { chave: 'clientes', rotulo: 'Reparos-mês', alinhar: 'dir' },
              { chave: 'rec', rotulo: 'Recorrentes', alinhar: 'dir' },
              { chave: 'taxaRec', rotulo: 'Taxa recor.', alinhar: 'dir' },
            ],
            linhas: (d?.porCidade ?? []).map((x) => ({
              cidade: x.rotulo,
              clientes: fmtInt(x.clientes),
              rec: fmtInt(x.recorrentes),
              taxaRec: fmtFracaoPct(x.taxaRecorrencia, 1),
            })),
          }}
        >
          {d && (
            <RankingSimples
              dados={[...d.porCidade]
                .sort((a, b) => b.recorrentes - a.recorrentes)
                .slice(0, 10)
                .map((x) => ({
                  rotulo: x.rotulo,
                  valor: x.recorrentes,
                  detalhe: `${fmtInt(x.clientes)} reparos-mês · taxa ${fmtFracaoPct(x.taxaRecorrencia, 1)}`,
                }))}
              unidade="logins crônicos"
            />
          )}
        </Painel>

        <Painel
          titulo="Recorrência por catálogo"
          descricao="Barra = logins crônicos. Reparo × Tecnologia."
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
              { chave: 'rec', rotulo: 'Recorrentes', alinhar: 'dir' },
              { chave: 'taxaRec', rotulo: 'Taxa recor.', alinhar: 'dir' },
            ],
            linhas: (d?.porCatalogo ?? []).map((x) => ({
              catalogo: x.rotulo,
              clientes: fmtInt(x.clientes),
              rec: fmtInt(x.recorrentes),
              taxaRec: fmtFracaoPct(x.taxaRecorrencia, 1),
            })),
          }}
        >
          {d && (
            <RankingSimples
              dados={[...d.porCatalogo]
                .sort((a, b) => b.recorrentes - a.recorrentes)
                .slice(0, 10)
                .map((x) => ({
                  rotulo: x.rotulo,
                  valor: x.recorrentes,
                  detalhe: `${fmtInt(x.clientes)} reparos-mês · taxa ${fmtFracaoPct(x.taxaRecorrencia, 1)}`,
                }))}
              unidade="logins crônicos"
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
              { chave: 'rec', rotulo: 'Recorrentes', alinhar: 'dir' },
              { chave: 'taxa', rotulo: 'Taxa recor.', alinhar: 'dir' },
            ],
            linhas: d.porMes.map((x) => ({
              mes: x.mes,
              clientes: fmtInt(x.clientes),
              rec: fmtInt(x.recorrentes),
              taxa: fmtFracaoPct(x.taxaRecorrencia, 1),
            })),
          }}
        >
          <RankingSimples
            dados={d.porMes.map((x) => ({
              rotulo: x.mes,
              valor: x.recorrentes,
              detalhe: `${fmtInt(x.clientes)} reparos-mês · taxa ${fmtFracaoPct(x.taxaRecorrencia, 1)}`,
            }))}
            unidade="logins crônicos"
          />
        </Painel>
      )}
    </div>
  )
}
