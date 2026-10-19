'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

/**
 * Atalho de uma tela para o Histórico, com a métrica certa já escolhida.
 *
 * ⚠️ EXISTE PARA NÃO DUPLICAR O CÁLCULO DO COEFICIENTE.
 *
 * A alternativa seria repetir o painel "volume × base de clientes" dentro de
 * Preventivos, Recorrência e Executivo — e é exatamente isso que o Power BI
 * faz. O preço aparece lá: a tela de Recorrência dele exibe 2.358 clientes com
 * coeficiente 2,82%, que é o coeficiente da tela de Campo (2.358 ÷ 87.218 dá
 * 2,70%). Duas telas discordando sobre a mesma conta, sem ninguém perceber,
 * porque os dois números são plausíveis.
 *
 * O link dá o benefício que a duplicação daria — achar o número a partir do
 * contexto em que a pessoa já está — sem criar uma segunda definição.
 *
 * A QUERY INTEIRA VAI JUNTO. Quem filtrou Canoas e setembro chega no Histórico
 * com Canoas e setembro: o link leva o recorte, não só a tela. É o mesmo
 * princípio do cross-filter da Recorrência.
 *
 * O tipo é literal aqui em vez de importado de `server/indicadores/historico`:
 * este é componente de cliente, e `import type` some no build mas basta alguém
 * trocar por um import normal para arrastar o driver do `pg` para o navegador —
 * a mesma armadilha documentada em `config/telas.ts`.
 */
export function LinkHistorico({
  metrica,
  rotulo = 'Ver no Histórico',
}: {
  metrica: 'entrantes' | 'clientes' | 'preventivas'
  rotulo?: string
}) {
  const sp = useSearchParams()
  const q = new URLSearchParams(sp.toString())
  q.set('metrica', metrica)

  return (
    <Link
      href={`/historico?${q.toString()}`}
      title="Abre a série mensal desta métrica sobre a base de clientes, com o recorte atual"
      className="rounded border px-2 py-1 text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
      style={{ borderColor: 'var(--border)' }}
    >
      {rotulo} ↗
    </Link>
  )
}
