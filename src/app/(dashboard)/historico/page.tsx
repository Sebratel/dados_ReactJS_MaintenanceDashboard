import { Suspense } from 'react'
import { PaginaProtegida } from '@/components/PaginaProtegida'
import { HistoricoConteudo } from './Conteudo'

/** Wrapper de servidor — o boundary de Suspense é exigido por useSearchParams(). */
export default function Pagina() {
  return (
    <PaginaProtegida tela="historico">
      <Suspense fallback={<div className="h-96" aria-busy="true" />}>
        <HistoricoConteudo />
      </Suspense>
    </PaginaProtegida>
  )
}
