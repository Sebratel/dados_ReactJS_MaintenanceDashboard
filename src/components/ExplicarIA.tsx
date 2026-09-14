'use client'

import { useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { buscarJson, ErroHttp } from '@/lib/clienteHttp'
import { telaDoCaminho } from '@/config/telas'
import type { ColunaTabela } from './Painel'

/**
 * "Explicar" — pede à IA uma leitura em prosa da tabela do painel.
 *
 * ⚠️ MANDA A TABELA PARA FORA DA EMPRESA. É por isso que o botão só existe
 * quando um administrador cadastrou um provedor, e por isso a resposta vem
 * rotulada com o provedor e o modelo que a produziram: quem lê precisa saber que
 * aquilo é texto de máquina, e de qual.
 *
 * A tela de origem vai junto e é CONFERIDA no servidor — sem isso, quem não tem
 * acesso a Produtividade poderia mandar a tabela de Produtividade e receber a
 * leitura dela, contornando o controle de acesso pelo caminho da IA.
 */

type Resposta = {
  texto: string
  provedor: string
  modelo: string
  linhasEnviadas: number
  ms: number
}

export function ExplicarIA({
  titulo,
  descricao,
  colunas,
  linhas,
}: {
  titulo: string
  descricao?: string
  colunas: ColunaTabela[]
  linhas: Record<string, string | number>[]
}) {
  const caminho = usePathname()
  const sp = useSearchParams()
  const [aberto, setAberto] = useState(false)
  const [carregando, setCarregando] = useState(false)
  const [resposta, setResposta] = useState<Resposta | null>(null)
  const [erro, setErro] = useState<{ texto: string; semProvedor: boolean } | null>(null)

  const tela = telaDoCaminho(caminho)
  // Sem tela reconhecida não há como o servidor conferir acesso, então o botão
  // não aparece. Acontece em rota nova que ainda não entrou no catálogo.
  if (!tela || !linhas.length) return null

  const perguntar = async () => {
    setAberto(true)
    setCarregando(true)
    setErro(null)
    setResposta(null)
    try {
      const r = await buscarJson<Resposta>('/api/ia/insight', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tela: tela.id,
          titulo,
          descricao,
          // O recorte em texto: sem ele o modelo comenta números sem saber de
          // que período são, e escreve "em 2025" quando a tela mostra julho.
          recorte: recorteEmTexto(sp),
          colunas: colunas.map((c) => ({ chave: c.chave, rotulo: c.rotulo })),
          linhas,
        }),
      })
      setResposta(r)
    } catch (e) {
      const semProvedor = e instanceof ErroHttp && e.status === 409
      setErro({
        texto: e instanceof Error ? e.message : String(e),
        semProvedor,
      })
    } finally {
      setCarregando(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void perguntar()}
        disabled={carregando}
        title="Pede a um provedor de IA para ler esta tabela e resumir o que ela mostra"
        className="flex items-center gap-1 rounded border px-2 py-1 text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-50"
        style={{ borderColor: 'var(--border)' }}
      >
        <IconeFaisca />
        {carregando ? 'lendo…' : 'Explicar'}
      </button>

      {aberto && (
        <div
          className="absolute inset-x-3 top-full z-30 mt-1 rounded-lg border p-3 shadow-lg"
          style={{ borderColor: 'var(--border)', background: 'var(--surface-raised)' }}
          role="status"
          aria-live="polite"
        >
          <div className="mb-1.5 flex items-start justify-between gap-3">
            <span className="text-[10px] font-bold tracking-wide uppercase text-[var(--text-muted)]">
              Leitura por IA
            </span>
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              fechar
            </button>
          </div>

          {carregando && (
            <p className="text-xs text-[var(--text-muted)]">Lendo a tabela…</p>
          )}

          {erro && (
            <p
              className="text-xs leading-relaxed"
              style={{ color: erro.semProvedor ? 'var(--text-secondary)' : 'var(--status-critical)' }}
            >
              {erro.texto}
            </p>
          )}

          {resposta && (
            <>
              <p className="text-xs leading-relaxed whitespace-pre-wrap text-[var(--text-primary)]">
                {resposta.texto}
              </p>
              {/*
                A procedência fica visível: texto de máquina sem etiqueta vira,
                uma reunião depois, "o sistema disse". Aqui dá para saber qual
                modelo escreveu e sobre quantas linhas.
              */}
              <p className="mt-2 border-t pt-1.5 text-[10px] text-[var(--text-muted)]" style={{ borderColor: 'var(--border)' }}>
                {resposta.provedor} · {resposta.modelo} · {resposta.linhasEnviadas} linhas ·{' '}
                {(resposta.ms / 1000).toFixed(1)}s — confira contra a tabela antes de usar.
              </p>
            </>
          )}
        </div>
      )}
    </>
  )
}

/** O recorte da barra de filtros, em texto legível para o modelo. */
function recorteEmTexto(sp: URLSearchParams): string {
  const partes: string[] = []
  const de = sp.get('de')
  const ate = sp.get('ate')
  if (de && ate) partes.push(`período de ${de} a ${ate}`)

  for (const [chave, rotulo] of [
    ['base', 'base'],
    ['cidade', 'cidade'],
    ['equipe', 'equipe'],
    ['tecnico', 'responsável'],
    ['catalogo', 'catálogo'],
    ['tipo', 'tipo'],
    ['status', 'status'],
  ] as const) {
    const v = sp.get(chave)
    if (v) partes.push(`${rotulo}: ${v.split('~').join(', ')}`)
  }

  const eixo = sp.get('eixo')
  if (eixo) partes.push(`eixo da data: ${eixo}`)

  return partes.join('; ')
}

function IconeFaisca() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <path
        fill="currentColor"
        d="M8 1.5 9.3 5.4 13.2 6.7 9.3 8 8 11.9 6.7 8 2.8 6.7 6.7 5.4 8 1.5Zm4.6 7.4.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6.6-1.7Z"
      />
    </svg>
  )
}
