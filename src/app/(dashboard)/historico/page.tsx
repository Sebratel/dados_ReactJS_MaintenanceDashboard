import { Suspense } from 'react'
import { HistoricoConteudo } from './Conteudo'

/** Wrapper de servidor — o boundary de Suspense é exigido por useSearchParams(). */
export default function Pagina() {
  return (
    <Suspense fallback={<div className="h-96" aria-busy="true" />}>
      <HistoricoConteudo />
    </Suspense>
  )
}
