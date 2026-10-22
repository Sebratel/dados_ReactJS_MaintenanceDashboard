import { Suspense } from 'react'
import { PaginaProtegida } from '@/components/PaginaProtegida'
import { OfensoresConteudo } from './Conteudo'

/** Wrapper de servidor — o boundary de Suspense é exigido por useSearchParams(). */
export default function Pagina() {
  return (
    <PaginaProtegida tela="ofensores">
      <Suspense fallback={<div className="h-96" aria-busy="true" />}>
        <OfensoresConteudo />
      </Suspense>
    </PaginaProtegida>
  )
}
