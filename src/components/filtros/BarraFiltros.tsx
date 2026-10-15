'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CATALOGOS_MANUTENCAO, STATUS_CANCELADO, TIPOS_PREVENTIVOS } from '@/config/regras-negocio'
import { EIXOS_DATA, GRANULARIDADES, parsearFiltros, presetsPeriodo, type Filtros } from '@/lib/filtros'
import { fmtData } from '@/lib/formato'
import { useOpcoesFiltro } from '@/lib/useIndicador'
import { telaDoCaminho } from '@/config/telas'

const CAMPOS_MULTI = [
  // Base primeiro de propósito: é o corte de supervisão, o mais usado.
  { chave: 'base', label: 'Base' },
  { chave: 'cidade', label: 'Cidade' },
  { chave: 'bairro', label: 'Bairro' },
  { chave: 'equipe', label: 'Equipe' },
  { chave: 'catalogo', label: 'Catálogo' },
  { chave: 'tipo', label: 'Tipo' },
  { chave: 'status', label: 'Status' },
  { chave: 'categoria2', label: 'Categoria 2' },
  { chave: 'tecnico', label: 'Técnico' },
] as const

export function BarraFiltros() {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const filtros = useMemo(() => parsearFiltros(Object.fromEntries(sp.entries())), [sp])
  const { data: opcoes } = useOpcoesFiltro(filtros)
  const [aberto, setAberto] = useState<string | null>(null)

  const aplicar = useCallback(
    (patch: Partial<Record<string, string | string[] | undefined>>) => {
      const q = new URLSearchParams(sp.toString())
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || (Array.isArray(v) && v.length === 0)) q.delete(k)
        else q.set(k, Array.isArray(v) ? v.join('~') : v)
      }
      router.replace(`${pathname}?${q.toString()}`, { scroll: false })
    },
    [pathname, router, sp]
  )

  const presets = useMemo(() => presetsPeriodo(), [])
  const presetAtivo = presets.find((p) => p.de === filtros.de && p.ate === filtros.ate)
  const temFiltroDim = CAMPOS_MULTI.some((c) => filtros[c.chave]?.length)
  const eixoGovernaTela = pathname !== '/tempos'

  /**
   * A tela de Preventivos só sabe filtrar ENTRE preventivas.
   *
   * Oferecer os outros tipos ali era um botao que nao faz nada: a pessoa
   * escolhia 'TEC-MANUT-ACESSO-CLI-REQUISICAO', a tela nao mudava, e a
   * conclusao natural e que o dashboard esta quebrado. Reportado pela
   * Manutencao em 28/08/2026.
   *
   * Restringir a LISTA e melhor que desabilitar o filtro: entre os dois tipos
   * preventivos a comparacao e util (PREVENCAO/PROBLEMA x PREVENCAO/RECORRENTE)
   * e agora funciona de verdade (ver preventivos.ts).
   */
  const tiposPermitidos: readonly string[] | null =
    pathname === '/preventivos' ? TIPOS_PREVENTIVOS : null

  /**
   * O MESMO, PARA CATÁLOGO — e pela mesma razão exata.
   *
   * O combo listava os oito catálogos que existem na base (Suporte 24h, Suporte
   * 72h, Suporte Tecnico, Equipe ativação…), mas o universo de Preventivos só
   * contém os quatro de manutenção. Enquanto o filtro era ignorado pelo backend
   * isso não aparecia: escolher "Suporte (24 Horas)" devolvia as 5.459
   * preventivas do recorte inteiro. Com o filtro funcionando (17/09/2026), a
   * mesma escolha zeraria a tela em silêncio — quatro das oito opções.
   */
  const catalogosPermitidos: readonly string[] | null =
    pathname === '/preventivos' ? CATALOGOS_MANUTENCAO : null

  /**
   * SANEAMENTO DA URL, não só da lista exibida.
   *
   * O filtro acima (`tiposPermitidos`) só tira as opções erradas do combo —
   * não limpa um `tipo` que a URL já trouxe de outra tela (troca de aba,
   * link direto, URL colada à mão). Sem isto, um `tipo=...INCIDENTE/PROBLEMA`
   * vindo de Recorrência chega a Preventivos, nunca bate com nenhuma
   * preventiva, e a tela inteira mostra zero em silêncio — sem erro, igual a
   * "não há preventiva no período". Achado em 09/09/2026 pela Manutenção.
   * O backend (`preventivos.ts`) já ignora tipo inválido por defesa, mas a
   * barra precisa refletir isso na URL, senão o combo mente "2 selec.".
   */
  useEffect(() => {
    // Um patch só, e não uma chamada por campo: `aplicar` monta a URL a partir
    // do `sp` desta renderização, então duas chamadas seguidas fariam a segunda
    // sobrescrever a primeira — a poda de um dos dois campos se perderia.
    const patch: Record<string, string[]> = {}
    const podar = (chave: 'tipo' | 'catalogo', permitidos: readonly string[] | null) => {
      const atual = filtros[chave]
      if (!permitidos || !atual?.length) return
      const valido = atual.filter((v) => permitidos.includes(v))
      if (valido.length !== atual.length) patch[chave] = valido
    }
    podar('tipo', tiposPermitidos)
    podar('catalogo', catalogosPermitidos)
    if (Object.keys(patch).length) aplicar(patch)
  }, [tiposPermitidos, catalogosPermitidos, filtros.tipo, filtros.catalogo, aplicar])

  /**
   * A BARRA SÓ EXISTE NAS TELAS DE DADOS, E QUEM DECIDE É ESTE COMPONENTE.
   *
   * Antes a decisão ficava no `(dashboard)/layout.tsx`, que envolvia a barra num
   * `{!ehConfiguracoes && …}`. A regra estava certa; o valor é que não chegava.
   * `ehConfiguracoes` vem do cabeçalho `x-caminho`, posto pelo middleware — e o
   * App Router REAPROVEITA o layout compartilhado quando só a página muda, então
   * ele ficava com o caminho da tela ANTERIOR. Os dois sintomas, medidos em
   * 14/09/2026 e reproduzíveis por qualquer um:
   *
   *   Preventivos --(menu)--> Configurações : barra aparecia onde não filtra nada
   *   Configurações --(menu)--> Tempos      : barra SUMIA de uma tela de trabalho
   *
   * O segundo é o grave: sem filtro, a tela de Tempos não serve para nada, e
   * nada na tela sugere que recarregar resolve. `export const dynamic =
   * 'force-dynamic'` não cobre isso — ele garante render por requisição, não que
   * o roteador peça o layout de novo.
   *
   * Aqui o problema não existe: `usePathname()` é do roteador do cliente e
   * acompanha a navegação. O componente já o usava para outra coisa.
   *
   * ⚠️ ISTO CORRIGE O SINTOMA DA BARRA, NÃO A CAUSA. O mesmo `caminho` congelado
   * decide o `permitido` do layout — ver item Z de docs/06. Com a barra
   * consertada o sinal visível some e a causa continua; tratar lá é o que fecha.
   *
   * O teste é o CATÁLOGO e não uma lista de rotas proibidas: `telaDoCaminho`
   * conhece as 8 telas de dados, e `/configuracoes` está fora dele por desenho
   * (ver `config/telas.ts`). Assim, rota nova que não seja tela de dados nasce
   * sem a barra por omissão, em vez de esperar que alguém lembre de listá-la.
   */
  if (!telaDoCaminho(pathname)) return null

  return (
    <div
      className="sticky top-0 z-30 border-b bg-[var(--surface-page)]/95 backdrop-blur"
      style={{ borderColor: 'var(--border)' }}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2.5">
        {/* ── período ── */}
        <Dropdown
          id="periodo"
          aberto={aberto}
          setAberto={setAberto}
          rotulo="Período"
          valor={presetAtivo ? presetAtivo.label : `${fmtData(filtros.de)} – ${fmtData(filtros.ate)}`}
          largura="w-64"
        >
          <div className="py-1">
            {presets.map((p) => {
              const ativo = p.de === filtros.de && p.ate === filtros.ate
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    aplicar({ de: p.de, ate: p.ate, granularidade: p.granularidade })
                    setAberto(null)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-[var(--surface-raised)]"
                >
                  <span className="w-4 shrink-0 text-center font-bold" aria-hidden="true">
                    {ativo ? '✓' : ''}
                  </span>
                  <span className={ativo ? 'font-semibold' : ''}>{p.label}</span>
                </button>
              )
            })}
          </div>
          <div className="px-3 py-2" style={{ borderTop: '1px solid var(--border)' }}>
            <span className="mb-1.5 block text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              Personalizado
            </span>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={filtros.de}
                max={filtros.ate}
                onChange={(e) => aplicar({ de: e.target.value })}
                className="w-full rounded border bg-transparent px-1.5 py-1 text-xs"
                style={{ borderColor: 'var(--border)' }}
              />
              <span className="text-xs text-[var(--text-muted)]">→</span>
              <input
                type="date"
                value={filtros.ate}
                min={filtros.de}
                onChange={(e) => aplicar({ ate: e.target.value })}
                className="w-full rounded border bg-transparent px-1.5 py-1 text-xs"
                style={{ borderColor: 'var(--border)' }}
              />
            </div>
          </div>
        </Dropdown>

        {/* ── eixo da data: o filtro que o Power BI escondia em USERELATIONSHIP ──
            Some na tela de Tempos, onde não governa nada: lá os dois eixos são
            fixos por definição do indicador (desempenho pelo encerramento,
            capacidade pela abertura). Deixá-lo clicável e inerte seria pior que
            não tê-lo — a pessoa trocaria, nada mudaria, e a conclusão natural
            seria que a tela está quebrada. */}
        {eixoGovernaTela ? (
          <SegmentControl
            rotulo="Eixo da data"
            opcoes={Object.entries(EIXOS_DATA).map(([k, v]) => ({ id: k, label: v.label }))}
            valor={filtros.eixo}
            onChange={(v) => aplicar({ eixo: v })}
            destaque
          />
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[var(--text-muted)]">Eixo da data</span>
            <span
              className="rounded border px-2 py-1.5 text-[11px] text-[var(--text-muted)]"
              style={{ borderColor: 'var(--border)' }}
              title="Nesta tela o eixo é fixo: desempenho (MTTR/MTTA) conta pelo encerramento, capacidade (mapa de calor) conta pela abertura. Os demais filtros valem normalmente."
            >
              fixo por indicador
            </span>
          </div>
        )}

        <SegmentControl
          rotulo="Granularidade"
          opcoes={Object.entries(GRANULARIDADES).map(([k, v]) => ({ id: k, label: v.label }))}
          valor={filtros.granularidade}
          onChange={(v) => aplicar({ granularidade: v })}
        />

        <span className="mx-1 h-5 w-px" style={{ background: 'var(--border)' }} aria-hidden="true" />

        {/* ── filtros de dimensão ── */}
        {CAMPOS_MULTI.map((c) => {
          const sel = filtros[c.chave] ?? []
          let lista = opcoes?.[c.chave] ?? []
          if (c.chave === 'tipo' && tiposPermitidos)
            lista = lista.filter((v) => tiposPermitidos.includes(v))
          if (c.chave === 'catalogo' && catalogosPermitidos)
            lista = lista.filter((v) => catalogosPermitidos.includes(v))
          return (
            <Dropdown
              key={c.chave}
              id={c.chave}
              aberto={aberto}
              setAberto={setAberto}
              rotulo={c.label}
              valor={sel.length === 0 ? 'Todos' : sel.length === 1 ? sel[0]! : `${sel.length} selec.`}
              ativo={sel.length > 0}
              largura="w-72"
            >
              <div className="max-h-72 overflow-auto py-1">
                {lista.length === 0 && (
                  <p className="px-3 py-2 text-xs text-[var(--text-muted)]">carregando…</p>
                )}
                {lista.map((v) => {
                  const marcado = sel.includes(v)
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() =>
                        aplicar({
                          [c.chave]: marcado ? sel.filter((x) => x !== v) : [...sel, v],
                        })
                      }
                      className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs hover:bg-[var(--surface-raised)]"
                    >
                      <span className="w-4 shrink-0 text-center font-bold" aria-hidden="true">
                        {marcado ? '✓' : ''}
                      </span>
                      <span className={marcado ? 'font-semibold' : ''}>{v}</span>
                    </button>
                  )
                })}
              </div>
              {sel.length > 0 && (
                <button
                  type="button"
                  onClick={() => aplicar({ [c.chave]: undefined })}
                  className="w-full px-3 py-2 text-left text-xs text-[var(--brand)] hover:bg-[var(--surface-raised)]"
                  style={{ borderTop: '1px solid var(--border)' }}
                >
                  Limpar {c.label.toLowerCase()}
                </button>
              )}
            </Dropdown>
          )
        })}

        {temFiltroDim && (
          <button
            type="button"
            onClick={() =>
              aplicar(Object.fromEntries(CAMPOS_MULTI.map((c) => [c.chave, undefined])))
            }
            className="ml-auto rounded border px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            style={{ borderColor: 'var(--border)' }}
          >
            Limpar filtros
          </button>
        )}
      </div>

      {/*
        AVISO DE CANCELADO. Não é decoração: cancelado sai do universo por
        padrão, então pedir por ele muda o significado das medidas em vez de só
        encolher o recorte. Encerramento vai a 0%, MTTR passa a medir "quanto
        tempo até desistirem" (32h em julho contra 17h do normal) e o volume
        deixa de ser demanda. Sem esta linha, os três números parecem defeito.
      */}
      {filtros.status?.includes(STATUS_CANCELADO) && (
        <div
          className="flex items-start gap-2 border-t px-4 py-1.5 text-[11px]"
          style={{
            borderColor: 'var(--border)',
            background: 'color-mix(in srgb, var(--status-warning) 12%, transparent)',
            color: 'var(--text-secondary)',
          }}
          role="note"
        >
          <span aria-hidden="true">⚠</span>
          <span>
            <strong>Cancelados incluídos.</strong> Eles ficam fora do universo por
            padrão porque não são demanda real — aqui, taxa de encerramento vai a 0% e
            o MTTR mede tempo até o cancelamento, não até o reparo. Vale para auditar
            visita perdida: parte deles teve deslocamento e improdutiva antes de morrer.{' '}
            <strong>Produtividade não muda</strong> — ela sempre contou essas visitas.
          </span>
        </div>
      )}
    </div>
  )
}

function Dropdown({
  id,
  aberto,
  setAberto,
  rotulo,
  valor,
  children,
  ativo = false,
  largura = 'w-64',
}: {
  id: string
  aberto: string | null
  setAberto: (v: string | null) => void
  rotulo: string
  valor: string
  children: React.ReactNode
  ativo?: boolean
  largura?: string
}) {
  const eu = aberto === id
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAberto(eu ? null : id)}
        aria-expanded={eu}
        className="flex items-center gap-1.5 rounded border px-2 py-1.5 text-xs transition-colors hover:border-[var(--border-strong)]"
        style={{
          borderColor: ativo ? 'var(--brand)' : 'var(--border)',
          background: 'var(--surface-1)',
        }}
      >
        <span className="text-[var(--text-muted)]">{rotulo}</span>
        <span className="max-w-40 truncate font-medium text-[var(--text-primary)]">{valor}</span>
        <span className="text-[var(--text-muted)]" aria-hidden="true">
          ▾
        </span>
      </button>
      {eu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAberto(null)} aria-hidden="true" />
          <div
            className={`absolute left-0 z-50 mt-1 ${largura} overflow-hidden rounded-lg border shadow-lg`}
            style={{ borderColor: 'var(--border-strong)', background: 'var(--surface-1)' }}
          >
            {children}
          </div>
        </>
      )}
    </div>
  )
}

function SegmentControl<T extends string>({
  rotulo,
  opcoes,
  valor,
  onChange,
  destaque = false,
}: {
  rotulo: string
  opcoes: { id: string; label: string }[]
  valor: T
  onChange: (v: T) => void
  destaque?: boolean
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-[var(--text-muted)]">{rotulo}</span>
      <div
        className="flex overflow-hidden rounded border text-[11px]"
        style={{ borderColor: destaque ? 'var(--brand)' : 'var(--border)' }}
        role="group"
        aria-label={rotulo}
      >
        {opcoes.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id as T)}
            aria-pressed={valor === o.id}
            className={`px-2 py-1.5 transition-colors ${
              valor === o.id
                ? 'bg-[var(--brand)] font-medium text-[var(--brand-ink)]'
                : 'bg-[var(--surface-1)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
