import type { Metadata } from 'next'
import { PaginaProtegida } from '@/components/PaginaProtegida'
import { CapaConteudo } from './Conteudo'

export const metadata: Metadata = {
  title: 'Capa · MAN - Manutenção FTTX | Sebratel',
}

/**
 * Capa — a primeira aba de todo dashboard Sebratel (casca da skill
 * padrao-frontend-dashboards). Responde, antes de qualquer gráfico, o que é o
 * painel, de onde vêm os números, quão frescos estão e o que cada indicador
 * quer dizer.
 *
 * É de todo mundo que entrou: não mostra dado restrito. O portão está aqui
 * assim mesmo porque `telas.test.ts` exige em toda página do grupo — e o dia em
 * que a Capa mudar de natureza, a decisão fica num lugar só.
 *
 * `/` continua sendo o Executivo: links e favoritos antigos apontam para lá, e
 * quem abre o painel todo dia quer o número, não a apresentação.
 */
export default function PaginaCapa() {
  return (
    <PaginaProtegida tela="capa">
      <CapaConteudo />
    </PaginaProtegida>
  )
}
