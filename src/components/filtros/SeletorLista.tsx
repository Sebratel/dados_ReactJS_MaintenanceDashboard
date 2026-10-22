'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icone } from '@/components/Icone'
import { semEmoji } from '@/lib/formato'

/**
 * Um filtro de lista da barra — botão compacto que abre o seletor (casca da
 * skill padrao-frontend-dashboards: a barra inteira cabe em ~50px).
 *
 * ── RASCUNHO + APLICAR, E NÃO GRAVAR A CADA CAIXA ─────────────────────────
 *
 * A versão anterior escrevia na URL a cada caixa marcada. Cada escrita é um
 * recorte novo, e cada recorte novo é uma consulta por painel na réplica do
 * ERP: escolher 5 cidades disparava 5 levas, e as 4 do meio eram recortes que
 * ninguém pediu para ver. Agora a marcação fica num rascunho e só o
 * **Aplicar** vira URL — uma leva por decisão, não por clique.
 *
 * ── POPOVER OU DIÁLOGO ────────────────────────────────────────────────────
 *
 * Até 10 opções, popover ancorado no botão. Acima disso (bairro, técnico),
 * diálogo centralizado num portal no `body`, com busca e grade em colunas:
 * popover com lista longa empilha três recortes de rolagem para escolher um
 * item, e o painel "abre para baixo" para fora da tela.
 *
 * `inerte` é para o filtro que a tela mostra mas não aplica (Status na
 * Produtividade): a lista aparece toda marcada e travada, com o porquê.
 */
const LIMITE_POPOVER = 10

const ACENTOS = new RegExp('[\\u0300-\\u036f]', 'g')
const semAcento = (s: string) => s.normalize('NFD').replace(ACENTOS, '').toLowerCase()

export function SeletorLista({
  rotulo,
  opcoes,
  selecionados,
  aoAplicar,
  inerte,
  direita = false,
}: {
  rotulo: string
  opcoes: readonly string[]
  selecionados: readonly string[]
  aoAplicar: (lista: string[]) => void
  /** nota que explica por que o filtro não se aplica nesta tela */
  inerte?: ReactNode
  /** abre o popover alinhado à direita (os últimos da barra) */
  direita?: boolean
}) {
  const [aberto, setAberto] = useState(false)
  const [rascunho, setRascunho] = useState<Set<string>>(new Set())
  const [busca, setBusca] = useState('')
  const caixa = useRef<HTMLDivElement>(null)

  /**
   * O que a lista mostra: as opções do período MAIS o que já está na URL e
   * saiu delas. Sem isso, um valor que veio de outro recorte (ou de um link
   * colado) ficaria aplicado sem caixa para desmarcar.
   */
  const lista = useMemo(() => {
    const fora = selecionados.filter((s) => !opcoes.includes(s))
    return [...fora, ...opcoes]
  }, [opcoes, selecionados])

  const visiveis = useMemo(() => {
    const q = semAcento(busca.trim())
    return q ? lista.filter((v) => semAcento(semEmoji(v)).includes(q)) : lista
  }, [lista, busca])

  const emDialogo = lista.length > LIMITE_POPOVER

  const abrir = () => {
    setRascunho(new Set(selecionados))
    setBusca('')
    setAberto(true)
  }
  const fechar = () => setAberto(false)

  const aplicar = () => {
    // na ordem da lista, não na ordem dos cliques: a URL fica estável e o
    // cache do servidor reconhece o mesmo recorte escrito de outro jeito
    aoAplicar(lista.filter((v) => rascunho.has(v)))
    setAberto(false)
  }

  const alternar = (v: string) =>
    setRascunho((r) => {
      const novo = new Set(r)
      if (novo.has(v)) novo.delete(v)
      else novo.add(v)
      return novo
    })

  const mudou =
    rascunho.size !== selecionados.length || selecionados.some((s) => !rascunho.has(s))

  // Esc fecha sem aplicar; clique fora também (só no popover — o diálogo tem
  // o fundo escuro para isso)
  useEffect(() => {
    if (!aberto) return
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false)
    }
    const fora = (e: MouseEvent) => {
      if (!emDialogo && caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('keydown', tecla)
    document.addEventListener('mousedown', fora)
    return () => {
      document.removeEventListener('keydown', tecla)
      document.removeEventListener('mousedown', fora)
    }
  }, [aberto, emDialogo])

  const resumo = inerte
    ? 'Todos · por regra'
    : selecionados.length === 0
      ? null
      : selecionados.length === 1
        ? semEmoji(selecionados[0]!)
        : `${selecionados.length} selecionados`

  const itens = (
    <div className={emDialogo ? 'dialogo-lista' : 'lista'}>
      {lista.length === 0 && <span className="pop-vazio">carregando…</span>}
      {lista.length > 0 && visiveis.length === 0 && (
        <span className="pop-vazio">Nada encontrado.</span>
      )}
      {visiveis.map((v) => (
        <label key={v} title={semEmoji(v)}>
          <input
            type="checkbox"
            checked={inerte ? true : rascunho.has(v)}
            disabled={Boolean(inerte)}
            onChange={() => alternar(v)}
          />
          <span className="txt">{semEmoji(v)}</span>
        </label>
      ))}
    </div>
  )

  const rodape = inerte ? (
    <p className="pop-nota">{inerte}</p>
  ) : (
    <div className="acoes">
      <button type="button" onClick={() => setRascunho(new Set())} disabled={rascunho.size === 0}>
        Limpar
      </button>
      <span>
        {rascunho.size} marcado{rascunho.size === 1 ? '' : 's'}
      </span>
      <span className="direita">
        <button type="button" className="secundario" onClick={fechar}>
          Cancelar
        </button>
        <button type="button" className="aplicar" onClick={aplicar} disabled={!mudou}>
          Aplicar
        </button>
      </span>
    </div>
  )

  return (
    <div className={`filtro${selecionados.length && !inerte ? ' ativo' : ''}`} ref={caixa}>
      <button
        type="button"
        onClick={() => (aberto ? fechar() : abrir())}
        aria-expanded={aberto}
        aria-haspopup="dialog"
        title={selecionados.map(semEmoji).join(', ') || undefined}
      >
        <span className="nome">{rotulo}</span>
        {resumo && <span className="valor">{resumo}</span>}
        <Icone nome="baixo" tamanho={11} />
      </button>

      {aberto && !emDialogo && (
        <div className={`pop${direita ? ' direita' : ''}`} role="dialog" aria-label={`Filtrar por ${rotulo}`}>
          {itens}
          {rodape}
        </div>
      )}

      {aberto &&
        emDialogo &&
        createPortal(
          <div className="dialogo-fundo" onMouseDown={(e) => e.target === e.currentTarget && fechar()}>
            <div className="dialogo" role="dialog" aria-modal="true" aria-label={`Filtrar por ${rotulo}`}>
              <div className="dialogo-cab">
                <h2>Filtrar por {rotulo.toLowerCase()}</h2>
                <span>{lista.length} opções no período</span>
                <button type="button" onClick={fechar} aria-label="Fechar">
                  <Icone nome="fechar" tamanho={16} />
                </button>
              </div>
              {!inerte && (
                <input
                  className="busca-interna"
                  autoFocus
                  placeholder={`Buscar ${rotulo.toLowerCase()}…`}
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              )}
              {itens}
              {rodape}
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
