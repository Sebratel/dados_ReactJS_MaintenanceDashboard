import type { Metadata } from 'next'
import { Conteudo } from './Conteudo'

export const metadata: Metadata = {
  title: 'Configurações · Manutenção FTTX',
}

/**
 * O acesso a esta tela é decidido no layout do grupo `(dashboard)`, que lê o
 * papel do servidor. Aqui não há checagem repetida de propósito: duas checagens
 * do mesmo fato divergem no dia em que alguém muda uma delas.
 */
export const dynamic = 'force-dynamic'

export default function PaginaConfiguracoes() {
  return <Conteudo />
}
