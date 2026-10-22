'use client'

import { useEffect, useRef, useState } from 'react'
import { fmtData } from '@/lib/formato'
import { Icone } from '@/components/Icone'

type Preset = { id: string; label: string; de: string; ate: string; granularidade: 'dia' | 'semana' | 'mes' }

/**
 * O filtro de período: presets de um clique e o intervalo personalizado.
 *
 * ── O PERSONALIZADO SÓ VALE NO "APLICAR PERÍODO" ──────────────────────────
 *
 * Os dois campos de data aplicavam a cada mudança. No Chrome, digitar o ano
 * num `<input type="date">` dispara uma mudança por tecla com o ano pela
 * metade — 0002, 0020, 0202, 2025 — e cada uma ia para a URL como recorte
 * válido. "De 0002-10-01" é o histórico inteiro do ERP, pedido a todos os
 * painéis da tela de uma vez, na réplica de produção.
 *
 * Agora os campos são rascunho; o botão só habilita com as duas datas
 * completas, num ano plausível e na ordem certa. Os presets continuam de um
 * clique só: cada um é um recorte inteiro e conhecido.
 */
const ANO_MINIMO = 2000
const formatoData = /^\d{4}-\d{2}-\d{2}$/

function problemaDoIntervalo(de: string, ate: string): string | null {
  if (!formatoData.test(de) || !formatoData.test(ate)) return 'Preencha as duas datas.'
  const anoMax = new Date().getFullYear() + 1
  for (const d of [de, ate]) {
    const ano = Number(d.slice(0, 4))
    if (ano < ANO_MINIMO || ano > anoMax || !Number.isFinite(Date.parse(`${d}T00:00:00`))) {
      return `Data fora do intervalo aceito (${ANO_MINIMO} a ${anoMax}).`
    }
  }
  if (de > ate) return 'O início está depois do fim.'
  return null
}

export function SeletorPeriodo({
  de,
  ate,
  presets,
  aoAplicar,
}: {
  de: string
  ate: string
  presets: readonly Preset[]
  aoAplicar: (patch: { de: string; ate: string; granularidade?: Preset['granularidade'] }) => void
}) {
  const [aberto, setAberto] = useState(false)
  const [rascunho, setRascunho] = useState({ de, ate })
  const caixa = useRef<HTMLDivElement>(null)

  const ativo = presets.find((p) => p.de === de && p.ate === ate)
  const problema = problemaDoIntervalo(rascunho.de, rascunho.ate)
  const mudou = rascunho.de !== de || rascunho.ate !== ate

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false)
    }
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false)
    }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', tecla)
    }
  }, [aberto])

  const abrir = () => {
    setRascunho({ de, ate })
    setAberto(true)
  }

  return (
    <div className="filtro ativo" ref={caixa}>
      <button type="button" onClick={() => (aberto ? setAberto(false) : abrir())} aria-expanded={aberto}>
        <Icone nome="calendario" tamanho={13} />
        <span className="nome">Período</span>
        <span className="valor">{ativo ? ativo.label : `${fmtData(de)} – ${fmtData(ate)}`}</span>
        <Icone nome="baixo" tamanho={11} />
      </button>

      {aberto && (
        <div className="pop" role="dialog" aria-label="Período">
          <div className="lista">
            {presets.map((p) => {
              const marcado = p.de === de && p.ate === ate
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`opcao${marcado ? ' marcada' : ''}`}
                  onClick={() => {
                    aoAplicar({ de: p.de, ate: p.ate, granularidade: p.granularidade })
                    setAberto(false)
                  }}
                >
                  <span className="marca" aria-hidden="true">
                    {marcado && <Icone nome="ok" tamanho={13} traco={2.4} />}
                  </span>
                  {p.label}
                </button>
              )
            })}
          </div>

          <div className="pop-secao">
            <span className="pop-titulo">Personalizado</span>
            <div className="datas">
              <input
                type="date"
                aria-label="Início"
                value={rascunho.de}
                onChange={(e) => setRascunho((r) => ({ ...r, de: e.target.value }))}
              />
              <span aria-hidden="true">a</span>
              <input
                type="date"
                aria-label="Fim"
                value={rascunho.ate}
                onChange={(e) => setRascunho((r) => ({ ...r, ate: e.target.value }))}
              />
            </div>
            {mudou && problema && <span className="pop-erro">{problema}</span>}
            <div className="acoes">
              <span />
              <span className="direita">
                <button
                  type="button"
                  className="aplicar"
                  disabled={!mudou || problema !== null}
                  onClick={() => {
                    aoAplicar({ de: rascunho.de, ate: rascunho.ate })
                    setAberto(false)
                  }}
                >
                  Aplicar período
                </button>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
