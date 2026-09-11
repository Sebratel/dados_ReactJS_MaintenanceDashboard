import { Suspense } from 'react'
import { ProdutividadeConteudo } from './Conteudo'

/**
 * Wrapper de servidor. O conteúdo é client component porque lê os filtros de
 * `useSearchParams()`, e isso exige um boundary de Suspense ACIMA dele — senão o
 * build de produção falha no prerender.
 */
export default function Pagina() {
  return (
    <Suspense fallback={<div className="h-96" aria-busy="true" />}>
      <ProdutividadeConteudo />
    </Suspense>
  )
}
