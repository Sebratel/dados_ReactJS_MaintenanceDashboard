import { Suspense } from 'react'
import { PaginaProtegida } from '@/components/PaginaProtegida'
import { VisaoExecutivaConteudo } from './Conteudo'

/**
 * Wrapper de servidor. O conteúdo é client component porque lê o estado dos
 * filtros de `useSearchParams()` — e isso exige um boundary de Suspense ACIMA
 * dele, senão o build de produção falha no prerender
 * ("useSearchParams() should be wrapped in a suspense boundary").
 * `dynamic` em client component é ignorado; o boundary é a correção certa.
 */
export default function Pagina() {
  return (
    <PaginaProtegida tela="executivo">
      <Suspense fallback={<div className="h-96" aria-busy="true" />}>
        <VisaoExecutivaConteudo />
      </Suspense>
    </PaginaProtegida>
  )
}
