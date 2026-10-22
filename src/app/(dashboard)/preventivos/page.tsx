import { Suspense } from 'react'
import { PaginaProtegida } from '@/components/PaginaProtegida'
import { PreventivosConteudo } from './Conteudo'

/** Wrapper de servidor — o boundary de Suspense é exigido por useSearchParams(). */
export default function Pagina() {
  return (
    <PaginaProtegida tela="preventivos">
      <Suspense fallback={<div className="h-96" aria-busy="true" />}>
        <PreventivosConteudo />
      </Suspense>
    </PaginaProtegida>
  )
}
