'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { baixarCsv, copiar, nomeDeArquivo, paraCsv, paraTsv } from '@/lib/exportar'

export type ColunaTabela = { chave: string; rotulo: string; alinhar?: 'esq' | 'dir' }

export type PainelProps = {
  titulo: string
  descricao?: string
  /** rodapé curto: fonte, ressalva, tempo de consulta */
  nota?: ReactNode
  children: ReactNode
  /**
   * Visão de tabela — obrigatória em todo gráfico.
   * Além de acessibilidade, é o "canal de alívio" exigido pelo guia de dataviz
   * para os slots de série que ficam abaixo de 3:1 na superfície clara.
   */
  tabela?: { colunas: ColunaTabela[]; linhas: Record<string, string | number>[] }
  acoes?: ReactNode
  className?: string
  carregando?: boolean
  erro?: string | null
}

export function Painel({
  titulo,
  descricao,
  nota,
  children,
  tabela,
  acoes,
  className = '',
  carregando = false,
  erro = null,
}: PainelProps) {
  const [modo, setModo] = useState<'grafico' | 'tabela'>('grafico')

  /**
   * Retorno visível do "Copiar".
   *
   * Copiar não muda nada na tela: sem confirmação, a pessoa clica, não vê nada
   * acontecer e clica de novo — ou pior, vai colar no Excel achando que copiou
   * quando o navegador recusou a permissão. Por isso o estado distingue sucesso
   * de falha, em vez de só "cliquei".
   */
  const [copia, setCopia] = useState<'nada' | 'ok' | 'erro'>('nada')

  useEffect(() => {
    if (copia === 'nada') return
    const id = setTimeout(() => setCopia('nada'), 2000)
    return () => clearTimeout(id)
  }, [copia])

  const aoCopiar = async () => {
    if (!tabela) return
    const ok = await copiar(paraTsv(tabela.colunas, tabela.linhas))
    setCopia(ok ? 'ok' : 'erro')
  }

  const aoBaixar = () => {
    if (!tabela) return
    baixarCsv(nomeDeArquivo(titulo), paraCsv(tabela.colunas, tabela.linhas))
  }

  return (
    <section
      className={`flex flex-col rounded-lg border bg-[var(--surface-1)] ${className}`}
      style={{ borderColor: 'var(--border)' }}
    >
      <header className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold tracking-wide uppercase text-[var(--text-secondary)]">
            {titulo}
          </h2>
          {descricao && (
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">{descricao}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/*
            Exportação só aparece na visão de tabela, e de propósito: é ali que a
            pessoa está conferindo número. No gráfico, o botão seria mais um
            controle competindo por atenção com o dado.

            A CONTAGEM DE LINHAS fica junto porque é a primeira coisa que se
            confere numa auditoria — se o gráfico mostra 12 barras e a tabela diz
            48 linhas, a divergência aparece antes de abrir o Excel.
          */}
          {tabela && modo === 'tabela' && (
            <>
              <span className="mr-1 text-[11px] text-[var(--text-muted)] tabular-nums">
                {tabela.linhas.length}{' '}
                {tabela.linhas.length === 1 ? 'linha' : 'linhas'}
              </span>
              <button
                type="button"
                onClick={aoCopiar}
                title="Copia a tabela para colar direto no Excel"
                className="rounded border px-2 py-1 text-[11px] transition-colors hover:text-[var(--text-primary)]"
                style={{
                  borderColor: 'var(--border)',
                  color:
                    copia === 'ok'
                      ? 'var(--status-good)'
                      : copia === 'erro'
                        ? 'var(--status-critical)'
                        : 'var(--text-muted)',
                }}
                aria-live="polite"
              >
                {copia === 'ok' ? 'copiado' : copia === 'erro' ? 'falhou' : 'Copiar'}
              </button>
              <button
                type="button"
                onClick={aoBaixar}
                title="Baixa um arquivo CSV com o período no nome"
                className="rounded border px-2 py-1 text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
                style={{ borderColor: 'var(--border)' }}
              >
                CSV
              </button>
            </>
          )}
          {acoes}
          {tabela && (
            <div
              className="flex overflow-hidden rounded border text-[11px]"
              style={{ borderColor: 'var(--border)' }}
              role="group"
              aria-label="alternar visualização"
            >
              {(['grafico', 'tabela'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModo(m)}
                  aria-pressed={modo === m}
                  className={`px-2 py-1 transition-colors ${
                    modo === m
                      ? 'bg-[var(--brand)] text-[var(--brand-ink)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {m === 'grafico' ? 'Gráfico' : 'Tabela'}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <div className="relative min-h-0 flex-1 px-2 pb-3">
        {erro ? (
          <div className="flex h-full min-h-[200px] items-center justify-center px-4">
            <p className="text-center text-sm text-[var(--status-critical)]">
              <span aria-hidden="true">⚠ </span>
              {erro}
            </p>
          </div>
        ) : carregando ? (
          <div className="flex h-full min-h-[200px] items-center justify-center">
            <span className="text-xs text-[var(--text-muted)]">carregando…</span>
          </div>
        ) : modo === 'grafico' || !tabela ? (
          children
        ) : (
          <div className="max-h-[320px] overflow-auto px-2">
            <table className="tabular w-full text-xs">
              <thead className="sticky top-0 bg-[var(--surface-1)]">
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {tabela.colunas.map((c) => (
                    <th
                      key={c.chave}
                      scope="col"
                      className={`py-1.5 pr-3 font-medium text-[var(--text-secondary)] ${
                        c.alinhar === 'dir' ? 'text-right' : 'text-left'
                      }`}
                    >
                      {c.rotulo}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tabela.linhas.map((l, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    {tabela.colunas.map((c) => (
                      <td
                        key={c.chave}
                        className={`py-1.5 pr-3 text-[var(--text-primary)] ${
                          c.alinhar === 'dir' ? 'text-right' : 'text-left'
                        }`}
                      >
                        {l[c.chave] ?? '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {nota && (
        <footer
          className="px-4 pt-1.5 pb-2.5 text-[11px] text-[var(--text-muted)]"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          {nota}
        </footer>
      )}
    </section>
  )
}
