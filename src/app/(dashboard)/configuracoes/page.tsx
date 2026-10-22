import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { PaginaProtegida } from '@/components/PaginaProtegida'
import { Conteudo } from './Conteudo'

export const metadata: Metadata = {
  title: 'Configurações · MAN - Manutenção FTTX | Sebratel',
}

/**
 * Só administrador abre — quem decide é `PaginaProtegida`, que roda a cada
 * navegação (ver o porquê lá). A API de configuração confere de novo, em
 * `exigirAdmin`: esconder a tela sem fechar o endpoint não esconderia nada.
 */
export const dynamic = 'force-dynamic'

export default async function PaginaConfiguracoes() {
  // Só para o subtítulo do card ("quem está editando"); a decisão de acesso é
  // do portão abaixo, que lê o mesmo cabeçalho.
  const email = ((await headers()).get('x-usuario-email') ?? '').trim().toLowerCase()

  return (
    <PaginaProtegida tela="configuracoes">
      <Conteudo email={email} />
    </PaginaProtegida>
  )
}
