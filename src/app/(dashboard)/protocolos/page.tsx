import { Suspense } from 'react'
import { PaginaProtegida } from '@/components/PaginaProtegida'
import { ProtocolosConteudo } from './Conteudo'

/** Wrapper de servidor — o boundary de Suspense é exigido por useSearchParams(). */
export default function Pagina() {
  return (
    <PaginaProtegida tela="protocolos">
      <Suspense fallback={<div className="h-96" aria-busy="true" />}>
        <ProtocolosConteudo />
      </Suspense>
    </PaginaProtegida>
  )
}
