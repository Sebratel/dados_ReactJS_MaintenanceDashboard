'use client'

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { parsearFiltros } from '@/lib/filtros'
import { useHistorico } from '@/lib/useIndicador'
import { Painel } from '@/components/Painel'
import { VolumeComCoeficiente } from '@/components/charts/VolumeComCoeficiente'
import { RankingSimples } from '@/components/charts/RankingSimples'
import { fmtFracaoPct, fmtInt } from '@/lib/formato'
import type { MetricaHistorico } from '@/server/indicadores/historico'

/**
 * As três métricas que o Power BI espalha por três telas.
 *
 * Elas compartilham o denominador — a base de clientes do Data Hub — e por isso
 * vivem num seletor, não em três painéis: o que muda de uma para outra é só o
 * que está sendo contado. Ver a nota do `FILTER` em `historico.ts` para o
 * defeito que isso evita (no BI, uma tela exibe o coeficiente da outra).
 */
const METRICAS: { id: MetricaHistorico; label: string; unidade: string; ajuda: string }[] = [
  {
    id: 'entrantes',
    label: 'Entrantes',
    unidade: 'protocolos',
    ajuda: 'Protocolos de reparo abertos no mês — preventiva não entra.',
  },
  {
    id: 'clientes',
    label: 'Logins com reparo',
    unidade: 'logins',
    ajuda:
      'Logins PPPoE distintos que abriram ao menos um reparo no mês. Um cliente com 3 chamados conta 1.',
  },
  {
    id: 'preventivas',
    label: 'Preventivas',
    unidade: 'preventivas',
    ajuda: 'Protocolos preventivos abertos no mês.',
  },
]

export function HistoricoConteudo() {
  const sp = useSearchParams()
  const filtros = useMemo(() => parsearFiltros(Object.fromEntries(sp.entries())), [sp])
  const [metrica, setMetrica] = useState<MetricaHistorico>('entrantes')

  const q = useHistorico(filtros)
  const d = q.data?.data
  const escolhida = METRICAS.find((m) => m.id === metrica)!

  const pontos = useMemo(
    () =>
      (d?.porMes ?? []).map((p) => {
        const volume = p[metrica]
        return {
          rotulo: p.mes,
          volume,
          baseClientes: p.baseClientes,
          coeficiente: p.baseClientes ? volume / p.baseClientes : null,
        }
      }),
    [d?.porMes, metrica]
  )

  const porBase = useMemo(
    () => [...(d?.porBase ?? [])].sort((a, b) => b[metrica] - a[metrica]),
    [d?.porBase, metrica]
  )

  const erro = q.error ? String(q.error.message) : null
  const nota = q.data ? (
    <>
      Numerador: ERP · denominador: MariaDB <code>Autentication_Contracts_Daily</code>
      {q.data.meta.apenasRegiao && ' · restrito às 6 cidades da região'}
      {q.data.meta.mesesSemBase > 0 && (
        <>
          {' · '}
          <strong>{fmtInt(q.data.meta.mesesSemBase)} mês(es) sem base no Data Hub</strong> — a
          linha fica interrompida ali, em vez de cair a zero
        </>
      )}
      {` · consulta em ${fmtInt(q.data.meta.ms)} ms`}
    </>
  ) : undefined

  const seletor = (
    <div
      className="flex overflow-hidden rounded border text-[11px]"
      style={{ borderColor: 'var(--border)' }}
      role="group"
      aria-label="métrica do histórico"
    >
      {METRICAS.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => setMetrica(m.id)}
          aria-pressed={metrica === m.id}
          title={m.ajuda}
          className={`px-2 py-1 transition-colors ${
            metrica === m.id
              ? 'bg-[var(--brand)] text-[var(--brand-ink)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  )

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
      {/*
        ⚠️ ESTA TELA FALA DE MESES, E O FILTRO DE PERÍODO CONTINUA MANDANDO.
        Não há controle inerte aqui de propósito: um recorte de 7 dias devolve
        um mês só, o que é a resposta correta para a pergunta feita — e o aviso
        abaixo diz como obter a visão do BI em vez de deixar a pessoa adivinhar.
      */}
      <p
        className="rounded border px-3 py-2 text-xs leading-relaxed text-[var(--text-secondary)]"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
      >
        Série <strong>mensal</strong>, sempre pela data de abertura. O filtro de período vale
        normalmente — para a visão do ano inteiro que o Power BI mostra, escolha{' '}
        <strong>Ano corrente</strong>. Os demais filtros recortam numerador e denominador
        juntos.
      </p>

      <Painel
        titulo={`${escolhida.label} sobre a base de clientes`}
        descricao={`${escolhida.ajuda} A linha é o volume do mês dividido pela base de clientes no último dia medido daquele mês.`}
        carregando={q.isLoading}
        erro={erro}
        nota={nota}
        acoes={seletor}
        tabela={{
          colunas: [
            { chave: 'mes', rotulo: 'Mês' },
            { chave: 'volume', rotulo: escolhida.label, alinhar: 'dir' },
            { chave: 'base', rotulo: 'Base de clientes', alinhar: 'dir' },
            { chave: 'coef', rotulo: 'Sobre a base', alinhar: 'dir' },
          ],
          linhas: pontos.map((p) => ({
            mes: p.rotulo,
            volume: fmtInt(p.volume),
            base: fmtInt(p.baseClientes),
            coef: fmtFracaoPct(p.coeficiente, 2),
          })),
        }}
      >
        {pontos.length > 0 && (
          <VolumeComCoeficiente dados={pontos} rotuloVolume={escolhida.label} altura={320} />
        )}
      </Painel>

      <Painel
        titulo={`${escolhida.label} por base`}
        descricao="Base real da agenda de campo — quem atendeu, não de que região é o cliente."
        carregando={q.isLoading}
        erro={erro}
        tabela={{
          colunas: [
            { chave: 'base', rotulo: 'Base' },
            { chave: 'volume', rotulo: escolhida.label, alinhar: 'dir' },
          ],
          linhas: porBase.map((b) => ({ base: b.base, volume: fmtInt(b[metrica]) })),
        }}
      >
        {porBase.length > 0 && (
          <RankingSimples
            dados={porBase.map((b) => ({ rotulo: b.base, valor: b[metrica] }))}
            unidade={escolhida.unidade}
          />
        )}
      </Painel>
    </div>
  )
}
