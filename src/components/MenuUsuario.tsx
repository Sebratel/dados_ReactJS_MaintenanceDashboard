'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useUsuario } from './SessaoFirebase'
import { encerrarSessao } from '@/lib/clienteHttp'
import type { Papel } from '@/config/telas'

/**
 * Quem está vendo o dashboard, e a saída.
 *
 * Mostrar a identidade não é enfeite: com a credencial compartilhada de antes,
 * ninguém sabia com que conta estava olhando um dado que tem nome de cliente e
 * produtividade nominal de técnico.
 *
 * ⚠️ O NOME APARECE AO LADO DO AVATAR, e isso corrigiu um problema real: a
 * primeira versão era só um círculo de 28px sem rótulo, e a saída ficou tão
 * escondida que foi reportada como inexistente ("não tem botão de deslogar").
 * Ícone sozinho é adivinhação; com o primeiro nome ao lado, o alvo vira óbvio.
 * Mesmo desenho do COM · Gestão Comercial, pelo mesmo motivo.
 */
export function MenuUsuario({
  papel,
  controleAtivo,
}: {
  papel: Papel
  controleAtivo: boolean
}) {
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

  /**
   * Espaço reservado com a largura aproximada do controle enquanto o SDK não
   * respondeu: sem isso o cabeçalho inteiro se desloca quando o nome chega.
   */
  if (!usuario) return <div className="h-7 w-24" />

  const primeiroNome = (usuario.nome ?? usuario.email).trim().split(/\s+/)[0] ?? ''
  const inicial = primeiroNome.charAt(0).toUpperCase()

  return (
    <div className="relative" ref={caixa}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-haspopup="menu"
        title={usuario.email}
        className="flex h-7 items-center gap-1.5 rounded-full border pr-2 pl-0.5 transition-colors hover:border-[var(--border-strong)]"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-page)' }}
      >
        <span
          className="grid size-6 shrink-0 place-items-center overflow-hidden rounded-full text-[10px] font-semibold"
          style={{ background: 'var(--surface-raised)', color: 'var(--text-secondary)' }}
        >
          {usuario.foto ? (
            // `referrerPolicy` porque o Google recusa a foto quando o referrer é
            // um host que ele não conhece — sem isso o avatar vem quebrado.
            <img
              src={usuario.foto}
              alt=""
              width={24}
              height={24}
              className="size-6 object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span aria-hidden="true">{inicial}</span>
          )}
        </span>

        <span className="max-w-[9rem] truncate text-xs font-medium text-[var(--text-secondary)]">
          {primeiroNome}
        </span>

        {/* O papel só aparece quando é admin: etiqueta "viewer" em todo mundo é
            ruído, porque é o normal. */}
        {papel === 'admin' && (
          <span
            className="rounded-full px-1.5 py-px text-[9px] font-bold tracking-wide uppercase"
            style={{ background: 'var(--surface-raised)', color: 'var(--text-muted)' }}
          >
            admin
          </span>
        )}

        <IconeSeta aberto={aberto} />
        <span className="sr-only">Conta e sessão</span>
      </button>

      {aberto && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1.5 w-64 rounded-lg border p-1 shadow-lg"
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

          {papel === 'admin' && (
            <Link
              href="/configuracoes"
              role="menuitem"
              onClick={() => setAberto(false)}
              className="flex items-center gap-2 rounded px-2.5 py-1.5 text-xs transition-colors hover:bg-[var(--surface-page)]"
              style={{ color: 'var(--text-primary)' }}
            >
              <IconeEngrenagem />
              Configurações
            </Link>
          )}

          {/*
            Avisa quando o controle de acesso está inativo — sem banco da
            aplicação, TODO MUNDO do domínio vê as 8 telas. Um administrador que
            não soubesse disso acharia que a matriz de Configurações está valendo
            quando ela não está, que é o pior tipo de engano numa tela de
            permissão: o que faz acreditar que algo está protegido.
          */}
          {papel === 'admin' && !controleAtivo && (
            <p
              className="mx-1 mt-1 rounded px-2 py-1.5 text-[10px] leading-snug"
              style={{
                background: 'color-mix(in srgb, var(--status-warning) 16%, transparent)',
                color: 'var(--text-secondary)',
              }}
            >
              Controle de acesso inativo: sem o banco da aplicação, todos do
              domínio veem todas as telas.
            </p>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={() => void encerrarSessao('saiu')}
            className="mt-0.5 flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[var(--surface-page)]"
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

function IconeSeta({ aberto }: { aberto: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="shrink-0 transition-transform"
      style={{
        color: 'var(--text-muted)',
        transform: aberto ? 'rotate(180deg)' : undefined,
      }}
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m3.5 6 4.5 4.5L12.5 6"
      />
    </svg>
  )
}

function IconeEngrenagem() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <circle cx="8" cy="8" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        d="M8 1.9v1.6M8 12.5v1.6M14.1 8h-1.6M3.5 8H1.9m10.3-4.2-1.1 1.1m-4.6 4.6-1.1 1.1m0-6.8 1.1 1.1m4.6 4.6 1.1 1.1"
      />
    </svg>
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
