import 'server-only'

import { headers } from 'next/headers'
import { podeAbrir, resolverAcesso, type AlvoPagina } from '@/server/auth/acesso'
import { TELAS } from '@/config/telas'
import { SemAcesso } from './SemAcesso'

/**
 * O portão de AUTORIZAÇÃO de cada página — o item Z de docs/06, resolvido.
 *
 * ── POR QUE NÃO NO LAYOUT, COMO ERA ─────────────────────────────────────────
 *
 * A decisão morava em `(dashboard)/layout.tsx`, lendo `x-caminho`. O App Router
 * REAPROVEITA o layout compartilhado quando só a página muda: na navegação por
 * clique ele não roda de novo, então decidia com o caminho da tela ANTERIOR.
 * `force-dynamic` não cobre isso — garante render por requisição, não que o
 * roteador peça o layout de novo. Na prática: quem tinha Ofensores e clicava no
 * drill-down para Protocolos abria Protocolos, mesmo sem acesso a ela, até o F5.
 * A API barrava o dado; a tela abria do mesmo jeito.
 *
 * A PÁGINA é o segmento que muda na navegação, então ela roda no servidor a
 * cada troca de tela — e lê os cabeçalhos DAQUELA requisição, que o middleware
 * acabou de escrever para o caminho certo. É a decisão por requisição que o
 * item Z pedia, sem tirar a autorização do runtime Node (o Edge não lê o
 * arquivo de acesso).
 *
 * ── POR QUE UM COMPONENTE E NÃO UMA LINHA EM CADA PÁGINA ────────────────────
 *
 * Cada `page.tsx` envolve o conteúdo com `<PaginaProtegida tela="…">`. O teste
 * `telas.test.ts` lê as páginas em disco e quebra se alguma não fizer isso, ou
 * declarar a tela errada — página nova nasce barrada no build, não aberta em
 * produção.
 */
export async function PaginaProtegida({
  tela,
  children,
}: {
  tela: AlvoPagina
  children: React.ReactNode
}) {
  // Escrito pelo middleware DEPOIS de apagar o que veio de fora — ver middleware.ts.
  const email = (await headers()).get('x-usuario-email') ?? ''
  const acesso = resolverAcesso(email)

  if (!podeAbrir(acesso, tela)) {
    const rotulo = TELAS.find((t) => t.id === tela)?.rotulo ?? 'Esta tela'
    return (
      <SemAcesso
        tela={rotulo}
        email={acesso.email}
        ehConfiguracoes={tela === 'configuracoes'}
      />
    )
  }

  return <>{children}</>
}
