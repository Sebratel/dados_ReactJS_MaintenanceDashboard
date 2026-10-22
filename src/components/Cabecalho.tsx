'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { BotaoAtualizar } from './BotaoAtualizar'
import { Icone } from './Icone'
import { MenuUsuario } from './MenuUsuario'

import { TELAS, type IdTela, type Papel } from '@/config/telas'

/**
 * Cabeçalho padrão Sebratel (casca da skill padrao-frontend-dashboards): topo de
 * 52px + navegação de 36px, igual ao do COM · Gestão Comercial.
 *
 *  ┌──────────────────────────────────────────────────────────────────────────┐
 *  │ [logo] MAN · MANUTENÇÃO FTTX     TÍTULO DA TELA     ● há 2 min [↻]  (M) │
 *  ├──────────────────────────────────────────────────────────────────────────┤
 *  │ CAPA  EXECUTIVO  OPERAÇÃO  TEMPOS ...                    [⚙] CONFIG.     │
 *  └──────────────────────────────────────────────────────────────────────────┘
 *
 * A mesma sigla aparece no topo, na Capa, na etiqueta do login e no <title>.
 */
const SISTEMA = 'MAN · MANUTENÇÃO FTTX'

/**
 * A navegação sai do CATÁLOGO de telas, não de uma lista própria.
 *
 * Antes eram duas listas, e duas listas divergem: a tela nova entrava na
 * navegação e não na matriz de acesso, ficando visível para todo mundo sem
 * ninguém decidir isso. Agora `config/telas.ts` é a fonte das duas. A Capa fica
 * fora do catálogo (é de todos) e entra à frente, como em todo dashboard.
 */
const NAV = TELAS.map((t) => ({ href: t.caminho, label: t.rotulo, id: t.id }))

/**
 * Cortes que existem em UMA tela so.
 *
 * `reincidencia` e `retorno` sao botoes da tela de Protocolos: em qualquer outra
 * pagina eles nao recortam nada. Sem esta limpeza eles VIAJAM na URL, invisiveis
 * -- a barra de filtros nao os mostra fora dali -- e quem compartilha o endereco
 * de Ofensores achando que compartilha um recorte entrega ao destinatario uma
 * tela de Protocolos ja filtrada, sem nada dizendo isso.
 *
 * Nao afeta numero nenhum: conferido que as duas telas ignoram os dois
 * parametros. E questao de o endereco dizer a verdade sobre o que esta na tela.
 */
const CORTES_DA_TELA: Record<string, string> = {
  reincidencia: '/protocolos',
  retorno: '/protocolos',
  // a pergunta aberta nas Predições não é recorte de dado de tela nenhuma
  pergunta: '/predicoes',
}

/** O endereço de `destino` levando junto o recorte que sobrevive lá. */
function hrefPara(destino: string, sp: URLSearchParams): string {
  const q = new URLSearchParams(sp)
  for (const [corte, tela] of Object.entries(CORTES_DA_TELA)) {
    if (destino !== tela) q.delete(corte)
  }
  const s = q.toString()
  return s ? `${destino}?${s}` : destino
}

export function Cabecalho({
  papel,
  telasPermitidas,
  controleAtivo,
}: {
  papel: Papel
  telasPermitidas: IdTela[]
  controleAtivo: boolean
}) {
  const pathname = usePathname()
  const sp = useSearchParams()

  /**
   * A navegação mostra só o que a pessoa pode abrir.
   *
   * Isto é conforto, NÃO é a barreira: quem digitar o endereço direto bate em
   * `PaginaProtegida`, e a API tem a sua checagem. Esconder o link evita o
   * clique que leva a uma tela de "sem acesso" — frustração sem informação, já
   * que a pessoa não pediu nada errado.
   */
  const permitidas = new Set(telasPermitidas)
  const nav = NAV.filter((n) => permitidas.has(n.id))

  const titulo =
    pathname === '/configuracoes'
      ? 'Configurações'
      : pathname === '/capa'
        ? 'Capa'
        : (NAV.find((n) => n.href === pathname)?.label ?? SISTEMA)

  const classe = (href: string) => (pathname === href ? 'active' : '')

  return (
    <>
      <header className="topbar">
        <Link href={hrefPara('/', sp)} className="logo" title="Ir para o Executivo">
          <img src="/logo-sebratel.svg" alt="Sebratel" />
          <span>{SISTEMA}</span>
        </Link>
        <h1>{titulo}</h1>
        <BotaoAtualizar />
        <MenuUsuario papel={papel} controleAtivo={controleAtivo} />
      </header>

      <nav className="pagenav" aria-label="Telas do painel">
        <Link
          href={hrefPara('/capa', sp)}
          className={classe('/capa')}
          aria-current={pathname === '/capa' ? 'page' : undefined}
        >
          Capa
        </Link>
        {nav.map((n) => (
          <Link
            key={n.href}
            href={hrefPara(n.href, sp)}
            className={classe(n.href)}
            aria-current={pathname === n.href ? 'page' : undefined}
          >
            {n.label}
          </Link>
        ))}
        {papel === 'admin' && (
          <Link
            href="/configuracoes"
            className={`com-icone a-direita ${classe('/configuracoes')}`}
            aria-current={pathname === '/configuracoes' ? 'page' : undefined}
          >
            <Icone nome="config" tamanho={13} /> Configurações
          </Link>
        )}
      </nav>
    </>
  )
}
