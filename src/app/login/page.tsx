import type { Metadata } from 'next'
import { Suspense } from 'react'
import { dominioPermitido, obterConfigFirebase } from '@/server/auth/configCliente'
import { TelaLogin } from './TelaLogin'

export const metadata: Metadata = {
  title: 'Entrar · MAN - Manutenção FTTX | Sebratel',
}

/**
 * A configuração do Firebase é lida AQUI, no servidor, e desce como prop.
 *
 * `force-dynamic` é o que garante isso: sem ele, a página seria pré-renderizada
 * no `next build` e a configuração ficaria congelada no HTML do momento da
 * construção da imagem — que é exatamente quando as variáveis não existem.
 */
export const dynamic = 'force-dynamic'

export default function PaginaLogin() {
  return (
    <Suspense fallback={null}>
      <TelaLogin config={obterConfigFirebase()} dominio={dominioPermitido()} />
    </Suspense>
  )
}
