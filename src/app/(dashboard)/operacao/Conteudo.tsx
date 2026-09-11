'use client'

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { DIMENSOES, parsearFiltros, type Dimensao } from '@/lib/filtros'
import { useRanking, useSerie } from '@/lib/useIndicador'
import { Painel } from '@/components/Painel'
import { RankingBarras } from '@/components/charts/RankingBarras'
import { SerieTemporal } from '@/components/charts/SerieTemporal'
import { fmtFracaoPct, fmtHoras, fmtInt, fmtPeriodo } from '@/lib/formato'

/** Pares de dimensão exibidos lado a lado. */
const BLOCOS: { dim: Dimensao; titulo: string; descricao: string; limite: number }[] = [
  { dim: 'categoria2', titulo: 'Por categoria 2', descricao: 'Natureza técnica do chamado', limite: 12 },
  { dim: 'catalogo', titulo: 'Por catálogo de serviço', descricao: 'Equipe de reparo × tecnologia', limite: 8 },
  { dim: 'tipo', titulo: 'Por tipo de protocolo', descricao: 'Incidente, preventiva, requisição', limite: 10 },
  { dim: 'equipe', titulo: 'Por equipe', descricao: 'Equipe responsável no Voalle', limite: 10 },
  { dim: 'solucao', titulo: 'Por solução aplicada', descricao: 'Registrada no encerramento', limite: 12 },
]

export function OperacaoConteudo() {
  const sp = useSearchParams()
  const filtros = useMemo(() => parsearFiltros(Object.fromEntries(sp.entries())), [sp])
  const [dimPrincipal, setDimPrincipal] = useState<Dimensao>('bairro')

  const serie = useSerie(filtros)
  const principal = useRanking(filtros, dimPrincipal, 15)

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
      <Painel
        titulo="Entrantes × encerrados"
        descricao={`Eixo da data: ${filtros.eixo}`}
        carregando={serie.isLoading}
        erro={serie.error ? String(serie.error.message) : null}
        tabela={{
          colunas: [
            { chave: 'periodo', rotulo: 'Período' },
            { chave: 'abertos', rotulo: 'Abertos', alinhar: 'dir' },
            { chave: 'encerrados', rotulo: 'Encerrados', alinhar: 'dir' },
            { chave: 'saldo', rotulo: 'Saldo', alinhar: 'dir' },
          ],
          linhas: (serie.data?.data ?? []).map((d) => ({
            periodo: fmtPeriodo(d.periodo, filtros.granularidade),
            abertos: fmtInt(d.abertos),
            encerrados: fmtInt(d.encerrados),
            saldo: fmtInt(d.abertos - d.encerrados),
          })),
        }}
      >
        {serie.data && (
          <SerieTemporal
            dados={serie.data.data}
            granularidade={filtros.granularidade}
            altura={230}
            comZoom={serie.data.data.length > 45}
          />
        )}
      </Painel>

      {/* dimensão principal, trocável — substitui os "REPAROS ABERTOS - VISÃO X" */}
      <Painel
        titulo={`Distribuição por ${DIMENSOES[dimPrincipal].label.toLowerCase()}`}
        descricao={principal.data ? `Total ${fmtInt(principal.data.meta.total)} protocolos` : undefined}
        carregando={principal.isLoading}
        erro={principal.error ? String(principal.error.message) : null}
        acoes={
          <select
            value={dimPrincipal}
            onChange={(e) => setDimPrincipal(e.target.value as Dimensao)}
            aria-label="Dimensão de agrupamento"
            className="rounded border bg-[var(--surface-1)] px-1.5 py-1 text-[11px] text-[var(--text-primary)]"
            style={{ borderColor: 'var(--border)' }}
          >
            {(Object.keys(DIMENSOES) as Dimensao[]).map((d) => (
              <option key={d} value={d}>
                {DIMENSOES[d].label}
              </option>
            ))}
          </select>
        }
        tabela={{
          colunas: [
            { chave: 'rotulo', rotulo: DIMENSOES[dimPrincipal].label },
            { chave: 'protocolos', rotulo: 'Protocolos', alinhar: 'dir' },
            { chave: 'encerrados', rotulo: 'Encerrados', alinhar: 'dir' },
            { chave: 'share', rotulo: 'Share', alinhar: 'dir' },
            { chave: 'mttr', rotulo: 'MTTR', alinhar: 'dir' },
          ],
          linhas: (principal.data?.data ?? []).map((d) => ({
            rotulo: d.rotulo,
            protocolos: fmtInt(d.protocolos),
            encerrados: fmtInt(d.encerrados),
            share: fmtFracaoPct(d.share, 1),
            mttr: fmtHoras(d.mttrHoras),
          })),
        }}
      >
        {principal.data && <RankingBarras dados={principal.data.data} />}
      </Painel>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))' }}>
        {BLOCOS.map((b) => (
          <BlocoRanking key={b.dim} {...b} filtros={filtros} />
        ))}
      </div>
    </div>
  )
}

function BlocoRanking({
  dim,
  titulo,
  descricao,
  limite,
  filtros,
}: {
  dim: Dimensao
  titulo: string
  descricao: string
  limite: number
  filtros: ReturnType<typeof parsearFiltros>
}) {
  const q = useRanking(filtros, dim, limite)
  return (
    <Painel
      titulo={titulo}
      descricao={descricao}
      carregando={q.isLoading}
      erro={q.error ? String(q.error.message) : null}
      tabela={{
        colunas: [
          { chave: 'rotulo', rotulo: DIMENSOES[dim].label },
          { chave: 'protocolos', rotulo: 'Protocolos', alinhar: 'dir' },
          { chave: 'share', rotulo: 'Share', alinhar: 'dir' },
          { chave: 'mttr', rotulo: 'MTTR', alinhar: 'dir' },
        ],
        linhas: (q.data?.data ?? []).map((d) => ({
          rotulo: d.rotulo,
          protocolos: fmtInt(d.protocolos),
          share: fmtFracaoPct(d.share, 1),
          mttr: fmtHoras(d.mttrHoras),
        })),
      }}
    >
      {q.data && <RankingBarras dados={q.data.data} />}
    </Painel>
  )
}
