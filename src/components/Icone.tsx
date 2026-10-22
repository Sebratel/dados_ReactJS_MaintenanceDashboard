import type { CSSProperties, ReactNode } from 'react'

/**
 * Ícones em SVG traçado — a casca Sebratel não usa emoji em lugar nenhum.
 *
 * Emoji renderiza com o desenho de cada sistema operacional (o ⚠ do Windows é
 * colorido, o do Linux é texto) e desalinha a linha em que está. Aqui o traço
 * herda a cor do texto (`currentColor`), então o ícone de alerta pega a cor de
 * alerta do parágrafo sem precisar de variante.
 *
 * Mesmo conjunto do `Icone.jsx` da skill padrao-frontend-dashboards, com os
 * nomes em português. `externo` é daqui: os links que levam a outra tela
 * levando o recorte junto (Histórico, drill-down de Ofensores).
 */
const CAMINHOS = {
  busca: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  fechar: <path d="M18 6 6 18M6 6l12 12" />,
  config: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.35.4.65.73.85" />
    </>
  ),
  cadeado: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  alerta: (
    <>
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    </>
  ),
  relogio: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  atualizar: (
    <>
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
      <path d="M21 3v6h-6" />
    </>
  ),
  copiar: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </>
  ),
  baixo: <path d="m6 9 6 6 6-6" />,
  cima: <path d="m6 15 6-6 6 6" />,
  direita: <path d="m9 6 6 6-6 6" />,
  externo: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 10 14" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </>
  ),
  mais: <path d="M12 5v14M5 12h14" />,
  pessoas: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16.5 5.3a3.2 3.2 0 0 1 0 5.4M18 20a6.5 6.5 0 0 0-2.2-4.9" />
    </>
  ),
  tela: (
    <>
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  sair: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5M21 12H9" />
    </>
  ),
  ok: <path d="m5 13 4 4L19 7" />,
  baixar: (
    <>
      <path d="M12 3v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M4 20h16" />
    </>
  ),
  ia: (
    <>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
      <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" />
      <circle cx="12" cy="12" r="2" />
    </>
  ),
  calendario: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 10h18" />
    </>
  ),
} satisfies Record<string, ReactNode>

export type NomeIcone = keyof typeof CAMINHOS

export function Icone({
  nome,
  tamanho = 15,
  className,
  style,
  traco = 1.8,
}: {
  nome: NomeIcone
  tamanho?: number
  className?: string
  style?: CSSProperties
  traco?: number
}) {
  return (
    <svg
      className={className}
      style={style}
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={traco}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {CAMINHOS[nome]}
    </svg>
  )
}
