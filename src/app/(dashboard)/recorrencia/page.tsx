import { Suspense } from 'react'
import { PaginaProtegida } from '@/components/PaginaProtegida'
import { RecorrenciaConteudo } from './Conteudo'

/** Wrapper de servidor — o boundary de Suspense é exigido por useSearchParams(). */
export default function Pagina() {
  return (
    <PaginaProtegida tela="recorrencia">
      <Suspense fallback={<div className="h-96" aria-busy="true" />}>
        <RecorrenciaConteudo />
      </Suspense>
    </PaginaProtegida>
  )
}
