'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { BotaoAtualizar } from './BotaoAtualizar'
import { MenuUsuario } from './MenuUsuario'

import { TELAS, type IdTela, type Papel } from '@/config/telas'

/**
 * A navegação sai do CATÁLOGO de telas, não de uma lista própria.
 *
 * Antes eram duas listas, e duas listas divergem: a tela nova entrava na
 * navegação e não na matriz de acesso, ficando visível para todo mundo sem
 * ninguém decidir isso. Agora `config/telas.ts` é a fonte das duas.
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
}

/** A query que sobrevive ao ir para `destino`. */
function queryPara(destino: string, sp: URLSearchParams): string {
  const q = new URLSearchParams(sp)
  for (const [corte, tela] of Object.entries(CORTES_DA_TELA)) {
    if (destino !== tela) q.delete(corte)
  }
  return q.toString()
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
   * Isto é conforto, NÃO é a barreira: quem digitar o endereço direto continua
   * batendo na checagem do layout, e a API tem a sua. Esconder o link evita o
   * clique que leva a uma tela de "sem acesso" — que é frustração sem
   * informação, já que a pessoa não pediu nada errado.
   */
  const permitidas = new Set(telasPermitidas)
  const nav = NAV.filter((n) => permitidas.has(n.id))

  return (
    <header
      className="border-b"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
    >
      <div className="flex items-center gap-4 px-4 py-2.5">
        {/* marca — vermelho Sebratel vive AQUI, no chrome, nunca como série */}
        <Link
          href={`/${queryPara('/', sp) ? `?${queryPara('/', sp)}` : ''}`}
          className="flex shrink-0 items-center gap-2"
        >
          {/*
            O ARQUIVO OFICIAL, não um desenho meu. A primeira versão redesenhava
            a esfera em SVG para acompanhar o tema — ficou parecida e errada: a
            marca da Sebratel tem a malha de losangos, não meridianas, e marca
            não é lugar para aproximação. É o MESMO arquivo do Data Hub
            (`logo-circular-sebratel.png`), então os dois sistemas internos
            mostram exatamente o mesmo símbolo.

            O PNG é RGBA: os vazados da malha são transparentes, então ele se
            apoia no fundo dos dois temas sem precisar de variante.
          */}
          <img
            src="/logo-circular-sebratel.png"
            alt=""
            width={28}
            height={28}
            className="size-7 shrink-0"
          />
          <span className="flex flex-col leading-none">
            {/* nowrap: sem isto o título quebra em "Manutenção / FTTX" quando a
                janela aperta, e a marca fica com o dobro da altura do resto do
                cabeçalho — some o alinhamento de tudo que está ao lado. */}
            <span className="text-[13px] font-semibold whitespace-nowrap text-[var(--text-primary)]">
              Manutenção FTTX
            </span>
            {/* "SEBRATEL" em vermelho e caixa alta espaçada: é o wordmark da
                empresa, não um subtítulo — por isso não usa a cor de texto
                secundário como o resto do chrome. O tracking é o mesmo do Data
                Hub (0.14em), para as duas marcas lerem como a mesma família. */}
            <span
              className="mt-0.5 text-[9px] font-bold tracking-[0.14em]"
              style={{ color: 'var(--brand)' }}
            >
              SEBRATEL
            </span>
          </span>
        </Link>

        <nav className="flex items-center gap-0.5" aria-label="Seções">
          {nav.map((n) => {
            const ativo = pathname === n.href
            const q = queryPara(n.href, sp)
            return (
              <Link
                key={n.href}
                href={q ? `${n.href}?${q}` : n.href}
                aria-current={ativo ? 'page' : undefined}
                className="relative rounded px-2.5 py-1.5 text-xs font-medium transition-colors"
                style={{
                  color: ativo ? 'var(--text-primary)' : 'var(--text-muted)',
                  background: ativo ? 'var(--surface-page)' : 'transparent',
                }}
              >
                {n.label}
                {ativo && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-2.5 -bottom-[9px] h-0.5 rounded-full"
                    style={{ background: 'var(--brand)' }}
                  />
                )}
              </Link>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <BotaoAtualizar />
          <MenuUsuario papel={papel} controleAtivo={controleAtivo} />
        </div>
      </div>
    </header>
  )
}
