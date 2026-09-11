'use client'

import { useEffect, useRef, useState } from 'react'
import { useUsuario } from './SessaoFirebase'
import { encerrarSessao } from '@/lib/clienteHttp'

/**
 * Quem está vendo o dashboard, e a saída.
 *
 * Mostrar a identidade não é enfeite: com a credencial compartilhada de antes,
 * ninguém sabia com que conta estava olhando um dado que tem nome de cliente e
 * produtividade nominal de técnico. Agora a conta está no canto da tela, e um
 * relato de "vi um número estranho" pode ser cruzado com o log do servidor, que
 * registra o e-mail de cada sessão aberta.
 */
export function MenuUsuario() {
  const usuario = useUsuario()
  const [aberto, setAberto] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aberto) return
    const aoClicarFora = (e: MouseEvent) => {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false)
    }
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false)
    }
    document.addEventListener('mousedown', aoClicarFora)
    document.addEventListener('keydown', aoTeclar)
    return () => {
      document.removeEventListener('mousedown', aoClicarFora)
      document.removeEventListener('keydown', aoTeclar)
    }
  }, [aberto])

  // Espaço reservado com a largura do avatar enquanto o SDK não respondeu: sem
  // isso o cabeçalho inteiro se desloca quando o nome chega.
  if (!usuario) return <div className="size-7" />

  const inicial = (usuario.nome ?? usuario.email).trim().charAt(0).toUpperCase()

  return (
    <div className="relative" ref={caixa}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-haspopup="menu"
        title={usuario.email}
        className="grid size-7 place-items-center overflow-hidden rounded-full border text-[11px] font-semibold transition-colors hover:border-[var(--border-strong)]"
        style={{
          borderColor: 'var(--border)',
          background: 'var(--surface-page)',
          color: 'var(--text-secondary)',
        }}
      >
        {usuario.foto ? (
          // `referrerPolicy` porque o Google recusa a foto quando o referrer é
          // um host que ele não conhece — sem isso o avatar vem quebrado.
          <img
            src={usuario.foto}
            alt=""
            width={28}
            height={28}
            className="size-7 object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span aria-hidden="true">{inicial}</span>
        )}
        <span className="sr-only">Conta e sessão</span>
      </button>

      {aberto && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1.5 w-60 rounded-lg border p-1 shadow-lg"
          style={{ borderColor: 'var(--border)', background: 'var(--surface-raised)' }}
        >
          <div className="px-2.5 py-2">
            {usuario.nome && (
              <p className="truncate text-xs font-semibold text-[var(--text-primary)]">
                {usuario.nome}
              </p>
            )}
            <p className="truncate text-[11px] text-[var(--text-muted)]" title={usuario.email}>
              {usuario.email}
            </p>
          </div>
          <div className="my-1 h-px" style={{ background: 'var(--border)' }} />
          <button
            type="button"
            role="menuitem"
            onClick={() => void encerrarSessao('saiu')}
            className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[var(--surface-page)]"
            style={{ color: 'var(--text-primary)' }}
          >
            <IconeSaida />
            Sair
          </button>
        </div>
      )}
    </div>
  )
}

function IconeSaida() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.2 2.5H3.4a.9.9 0 0 0-.9.9v9.2a.9.9 0 0 0 .9.9h2.8M10.4 11 13.5 8l-3.1-3M13.2 8H6.4"
      />
    </svg>
  )
}
