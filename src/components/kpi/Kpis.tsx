'use client'

import type { ReactNode } from 'react'
import { useAlturaComoVariavel } from '@/lib/useAlturaComoVariavel'

/**
 * A faixa de KPIs do topo da tela. Além do grid, ela informa a própria altura
 * à `.pagina` (`--h-kpis`), que desconta essa altura da área dos visuais —
 * é o que faz as duas faixas abaixo dela caberem na janela. Ver
 * `useAlturaComoVariavel`.
 */
export function Kpis({ children, rotulo }: { children: ReactNode; rotulo: string }) {
  const medir = useAlturaComoVariavel('--h-kpis', 'pagina')
  return (
    <section className="kpis" aria-label={rotulo} ref={medir}>
      {children}
    </section>
  )
}
