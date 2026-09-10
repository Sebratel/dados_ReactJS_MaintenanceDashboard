import { Suspense } from 'react'
import { OfensoresConteudo } from './Conteudo'

/** Wrapper de servidor — o boundary de Suspense é exigido por useSearchParams(). */
export default function Pagina() {
  return (
    <Suspense fallback={<div className="h-96" aria-busy="true" />}>
      <OfensoresConteudo />
    </Suspense>
  )
}
