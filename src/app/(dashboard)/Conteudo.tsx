'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { parsearFiltros } from '@/lib/filtros'
import { projetarMes } from '@/lib/projecao'
import {
  useCoeficiente,
  useKpis,
  useMtta,
  useRanking,
  useSerie,
} from '@/lib/useIndicador'
import { Painel } from '@/components/Painel'
import { StatTile } from '@/components/kpi/StatTile'
import { SerieTemporal } from '@/components/charts/SerieTemporal'
import { SerieMttr } from '@/components/charts/SerieMttr'
import { RankingBarras } from '@/components/charts/RankingBarras'
import { CoeficienteVsMeta } from '@/components/charts/CoeficienteVsMeta'
import {
  fmtData,
  fmtDec,
  fmtFracaoPct,
  fmtHoras,
  fmtInt,
  fmtPeriodo,
} from '@/lib/formato'

export function VisaoExecutivaConteudo() {
  const sp = useSearchParams()
  const filtros = useMemo(() => parsearFiltros(Object.fromEntries(sp.entries())), [sp])

  const kpis = useKpis(filtros)
  const mtta = useMtta(filtros)
  const serie = useSerie(filtros)
  const cidades = useRanking(filtros, 'cidade', 8)
  const coef = useCoeficiente(filtros)

  const k = kpis.data?.data

  // Base de clientes no fim do período: reaproveita o último ponto de `coef`
  // (já carregado para o painel de coeficiente) em vez de repetir a consulta
  // ao MariaDB só para este card.
  /**
   * O ÚLTIMO DIA COM BASE MEDIDA, e não o último ponto da série.
   *
   * Desde 15/09/2026 (item D) dia futuro vem com `baseClientes: null`, então
   * num recorte “mês corrente” o `.at(-1)` caía no dia 30 e este cartão
   * mostrava “—” o mês inteiro. A base de clientes é um estoque: o valor
   * conhecido mais recente é a melhor resposta para “quantos clientes temos”.
   */
  const baseClientes =
    [...(coef.data?.data ?? [])].reverse().find((p) => p.baseClientes !== null)?.baseClientes ??
    null
  const taxaEntrantes = k && baseClientes ? k.protocolos / baseClientes : null

  /**
   * PROJEÇÃO DO MÊS — a regra inteira mora em `lib/projecao.ts`, com testes.
   *
   * Sai da série de `coef`, e não de `k.protocolos`, de propósito: a projeção é
   * de ENTRANTES, e aquela série é sempre por criação e já restrita à região
   * quando a base de clientes é regional. Numerador e denominador saindo da
   * mesma fonte é o que impede o cartão de discordar do painel logo abaixo.
   *
   * `projetarMes` devolve `null` fora de um recorte do mês corrente — e aí o
   * cartão simplesmente não existe, em vez de mostrar um número que seria o
   * próprio realizado com outro nome.
   */
  const projecao = useMemo(() => {
    const pad = (n: number) => String(n).padStart(2, '0')
    const d = new Date()
    const hoje = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    return projetarMes(coef.data?.data ?? [], filtros.de, filtros.ate, hoje)
  }, [coef.data, filtros.de, filtros.ate])

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
      {/* ── KPIs de topo ── */}
      <section
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}
        aria-label="Indicadores principais"
      >
        <StatTile
          rotulo="Protocolos abertos"
          valor={kpis.isLoading ? '…' : fmtInt(k?.protocolos)}
          variacao={k?.variacaoProtocolos}
          subirEhRuim
          contexto={
            k
              ? `${fmtInt(k.anterior.protocolos)} no período anterior`
              : undefined
          }
          destaque
        />
        <StatTile
          rotulo="Encerrados"
          valor={kpis.isLoading ? '…' : fmtInt(k?.encerrados)}
          contexto={k ? `${fmtFracaoPct(k.taxaEncerramento, 1)} do total` : undefined}
        />
        <StatTile
          rotulo="Em aberto"
          valor={kpis.isLoading ? '…' : fmtInt(k?.abertos)}
          status={k && k.abertos > 0 ? 'warning' : null}
          contexto={k ? `${fmtInt(k.semAgenda)} sem agendamento` : undefined}
        />
        <StatTile
          rotulo="Entrantes / base de clientes"
          valor={
            kpis.isLoading || coef.isLoading ? '…' : fmtFracaoPct(taxaEntrantes, 2)
          }
          subirEhRuim
          contexto={
            k && baseClientes
              ? `${fmtInt(k.protocolos)} / ${fmtInt(baseClientes)} clientes${
                  coef.data?.meta.apenasRegiao ? ' (região)' : ''
                }`
              : undefined
          }
        />
        {projecao && (
          <StatTile
            rotulo="Projeção do mês"
            valor={fmtInt(projecao.entrantes)}
            subirEhRuim
            contexto={
              baseClientes
                ? `${fmtFracaoPct(projecao.entrantes / baseClientes, 2)} da base · ${fmtDec(projecao.mediaDiaria)}/dia em ${fmtInt(projecao.diasCompletos)} dias cheios`
                : `${fmtDec(projecao.mediaDiaria)}/dia em ${fmtInt(projecao.diasCompletos)} dias cheios`
            }
          />
        )}
        <StatTile
          rotulo="MTTR médio"
          valor={kpis.isLoading ? '…' : fmtHoras(k?.mttrHoras)}
          contexto={
            k ? `${fmtInt(k.encerradosNoPeriodo)} encerrados no período` : 'criação → encerramento'
          }
          subirEhRuim
          variacao={
            k && k.anterior.mttrHoras && k.mttrHoras
              ? (k.mttrHoras - k.anterior.mttrHoras) / k.anterior.mttrHoras
              : null
          }
        />
        <StatTile
          rotulo="MTTA médio"
          valor={mtta.isLoading ? '…' : fmtHoras(mtta.data?.data.mttaHoras)}
          contexto="deslocamento + atendimento"
          subirEhRuim
        />
      </section>

      {/* ── série: abertos x encerrados + MTTR (eixos separados, nunca duplo) ── */}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}>
        <div className="flex flex-col gap-4">
          <Painel
            titulo="Fluxo: criados e saldo do backlog"
            descricao={`Barra = criados, linha = saldo (entra − sai): acima da tracejada o backlog cresceu. Encerrados fica no tooltip e na aba Tabela. ${fmtData(filtros.de)} a ${fmtData(filtros.ate)} · criados pela data de criação, encerrados pela data de encerramento`}
            carregando={serie.isLoading}
            erro={serie.error ? String(serie.error.message) : null}
            nota={
              serie.data ? (
                <span>
                  Este painel usa os <b>dois eixos de data</b> — é o que permite ler o saldo
                  do backlog. O filtro &ldquo;eixo da data&rdquo; governa os KPIs e os
                  rankings. Total {fmtInt(serie.data.meta.totalAbertos)} criados ×{' '}
                  {fmtInt(serie.data.meta.totalEncerrados)} encerrados · consulta em{' '}
                  {serie.data.meta.ms} ms
                </span>
              ) : undefined
            }
            tabela={{
              colunas: [
                { chave: 'periodo', rotulo: 'Período' },
                { chave: 'abertos', rotulo: 'Criados', alinhar: 'dir' },
                { chave: 'encerrados', rotulo: 'Encerrados', alinhar: 'dir' },
                { chave: 'saldo', rotulo: 'Saldo', alinhar: 'dir' },
                { chave: 'mttr', rotulo: 'MTTR', alinhar: 'dir' },
              ],
              linhas: (serie.data?.data ?? []).map((d) => ({
                periodo: fmtPeriodo(d.periodo, filtros.granularidade),
                abertos: fmtInt(d.abertos),
                encerrados: fmtInt(d.encerrados),
                saldo: d.saldo === null ? fmtInt(null) : `${d.saldo > 0 ? '+' : ''}${fmtInt(d.saldo)}`,
                mttr: fmtHoras(d.mttrHoras),
              })),
            }}
          >
            {serie.data && (
              <SerieTemporal
                dados={serie.data.data}
                granularidade={filtros.granularidade}
                altura={250}
                comZoom={serie.data.data.length > 45}
              />
            )}
          </Painel>

          <Painel
            titulo="MTTR médio"
            descricao="Tempo médio entre criação e encerramento"
            carregando={serie.isLoading}
            erro={serie.error ? String(serie.error.message) : null}
            /*
              A coluna "Encerrados" existe para o número ser auditável: MTTR é
              média sobre os protocolos encerrados no período, e média sem o N que
              a compõe não se confere. Um dia com 2 encerrados e MTTR de 40 h não
              é um problema de operação, é uma amostra de dois.
            */
            tabela={{
              colunas: [
                { chave: 'periodo', rotulo: 'Período' },
                { chave: 'encerrados', rotulo: 'Encerrados', alinhar: 'dir' },
                { chave: 'mttr', rotulo: 'MTTR', alinhar: 'dir' },
              ],
              linhas: (serie.data?.data ?? []).map((d) => ({
                periodo: fmtPeriodo(d.periodo, filtros.granularidade),
                encerrados: fmtInt(d.encerrados),
                mttr: fmtHoras(d.mttrHoras),
              })),
            }}
          >
            {serie.data && (
              <SerieMttr dados={serie.data.data} granularidade={filtros.granularidade} altura={180} />
            )}
          </Painel>
        </div>

        <Painel
          titulo="Protocolos por cidade"
          descricao={cidades.data ? `Total ${fmtInt(cidades.data.meta.total)}` : undefined}
          carregando={cidades.isLoading}
          erro={cidades.error ? String(cidades.error.message) : null}
          tabela={{
            colunas: [
              { chave: 'rotulo', rotulo: 'Cidade' },
              { chave: 'protocolos', rotulo: 'Protocolos', alinhar: 'dir' },
              { chave: 'share', rotulo: 'Share', alinhar: 'dir' },
              { chave: 'mttr', rotulo: 'MTTR', alinhar: 'dir' },
            ],
            linhas: (cidades.data?.data ?? []).map((d) => ({
              rotulo: d.rotulo,
              protocolos: fmtInt(d.protocolos),
              share: fmtFracaoPct(d.share, 1),
              mttr: fmtHoras(d.mttrHoras),
            })),
          }}
        >
          {cidades.data && <RankingBarras dados={cidades.data.data} altura={468} />}
        </Painel>
      </div>

      {/* ── coeficiente de reparos: o KPI que cruza os dois bancos ── */}
      <Painel
        titulo="Coeficiente de reparos sobre a base de clientes"
        descricao="Reparos do dia ÷ clientes autenticados no dia, comparado à meta"
        carregando={coef.isLoading}
        erro={coef.error ? String(coef.error.message) : null}
        nota={
          coef.data ? (
            <span>
              Base de clientes: MariaDB <code>Autentication_Contracts_Daily</code>
              {coef.data.meta.apenasRegiao && ' · restrito às 6 cidades da região'}
              {coef.data.meta.diasInterpolados > 0 && (
                <>
                  {' · '}
                  <span style={{ color: 'var(--status-warning)' }}>
                    ⚠ {coef.data.meta.diasInterpolados}{' '}
                    {coef.data.meta.diasInterpolados === 1 ? 'dia' : 'dias'} com base estimada
                    (sem snapshot) — barra tracejada
                  </span>
                </>
              )}
            </span>
          ) : undefined
        }
        tabela={{
          colunas: [
            { chave: 'dia', rotulo: 'Dia' },
            { chave: 'reparos', rotulo: 'Reparos', alinhar: 'dir' },
            { chave: 'base', rotulo: 'Base clientes', alinhar: 'dir' },
            { chave: 'coef', rotulo: 'Coeficiente', alinhar: 'dir' },
            { chave: 'meta', rotulo: 'Meta', alinhar: 'dir' },
            { chave: 'obs', rotulo: 'Obs.' },
          ],
          linhas: (coef.data?.data ?? []).map((d) => ({
            dia: fmtData(d.dia),
            reparos: fmtInt(d.reparos),
            base: fmtInt(d.baseClientes),
            coef: fmtFracaoPct(d.coeficiente, 3),
            meta: fmtFracaoPct(d.meta, 3),
            // "ainda não aconteceu" e "base estimada" são coisas diferentes, e
            // até 15/09/2026 as duas apareciam como estimada — ver item D.
            obs: d.futuro ? 'ainda não aconteceu' : d.interpolado ? 'base estimada' : '',
          })),
        }}
      >
        {coef.data && <CoeficienteVsMeta dados={coef.data.data} altura={230} />}
      </Painel>
    </div>
  )
}
