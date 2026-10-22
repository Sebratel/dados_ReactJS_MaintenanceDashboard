'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useUsuario } from './SessaoFirebase'
import { Icone } from './Icone'
import { encerrarSessao } from '@/lib/clienteHttp'
import type { Papel } from '@/config/telas'

/**
 * Quem está vendo o dashboard, e a saída — o `.usermenu` da casca Sebratel.
 *
 * Mostrar a identidade não é enfeite: com a credencial compartilhada de antes,
 * ninguém sabia com que conta estava olhando um dado que tem nome de cliente e
 * produtividade nominal de técnico.
 *
 * ⚠️ O NOME APARECE AO LADO DO AVATAR, e isso corrigiu um problema real: a
 * primeira versão era só um círculo de 28px sem rótulo, e a saída ficou tão
 * escondida que foi reportada como inexistente ("não tem botão de deslogar").
 * Ícone sozinho é adivinhação; com o primeiro nome ao lado, o alvo vira óbvio.
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
  if (!usuario) return <div style={{ width: 104, height: 30 }} />

  const primeiroNome = (usuario.nome ?? usuario.email).trim().split(/\s+/)[0] ?? ''
  const inicial = primeiroNome.charAt(0).toUpperCase()

  return (
    <div className="usermenu" ref={caixa}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-haspopup="menu"
        title={usuario.email}
      >
        {usuario.foto ? (
          // `referrerPolicy` porque o Google recusa a foto quando o referrer é
          // um host que ele não conhece — sem isso o avatar vem quebrado.
          <img src={usuario.foto} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className="inicial" aria-hidden="true">
            {inicial}
          </span>
        )}
        <span className="nome">{primeiroNome}</span>
        {/* O papel só aparece quando é admin: etiqueta "viewer" em todo mundo é
            ruído, porque é o normal. */}
        {papel === 'admin' && <span className="papel">admin</span>}
        <span className="sr-only">Conta e sessão</span>
      </button>

      {aberto && (
        <div className="usermenu-pop" role="menu">
          <div className="quem">
            {usuario.nome && <b>{usuario.nome}</b>}
            <span>{usuario.email}</span>
          </div>

          {papel === 'admin' && (
            <Link
              href="/configuracoes"
              role="menuitem"
              className="com-icone"
              onClick={() => setAberto(false)}
            >
              <Icone nome="config" /> Configurações
            </Link>
          )}

          {/*
            Avisa quando o controle de acesso está inativo — sem diretório de
            dados gravável, TODO MUNDO do domínio vê todas as telas. Um
            administrador que não soubesse disso acharia que a matriz de
            Configurações está valendo quando ela não está, que é o pior tipo de
            engano numa tela de permissão: o que faz acreditar que algo está
            protegido.
          */}
          {papel === 'admin' && !controleAtivo && (
            <p className="banner" style={{ margin: '4px 10px 8px' }}>
              Controle de acesso inativo: o diretório de dados não está gravável, então todos
              do domínio veem todas as telas.
            </p>
          )}

          <button
            type="button"
            role="menuitem"
            className="sair"
            onClick={() => void encerrarSessao('saiu')}
          >
            Sair
          </button>
        </div>
      )}
    </div>
  )
}
