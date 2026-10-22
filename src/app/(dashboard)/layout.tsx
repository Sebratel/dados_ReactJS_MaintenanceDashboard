import { headers } from 'next/headers'
import { Suspense } from 'react'
import { Cabecalho } from '@/components/Cabecalho'
import { BarraFiltros } from '@/components/filtros/BarraFiltros'
import { SessaoFirebase } from '@/components/SessaoFirebase'
import { obterConfigFirebase } from '@/server/auth/configCliente'
import { resolverAcesso } from '@/server/auth/acesso'

/**
 * ESTE LAYOUT É DINÂMICO DE PROPÓSITO, e a razão é de correção, não de gosto.
 *
 * Ele lê a configuração do Firebase do ambiente e a entrega ao cliente. Sem
 * `force-dynamic`, as 8 telas abaixo são pré-renderizadas no `next build`, e
 * componente de servidor em rota estática roda UMA VEZ: o valor lido do ambiente
 * vira parte do HTML gravado na imagem.
 *
 * O estrago, medido em 12/09/2026 com o build rodando como no container:
 *
 *     .next/server/app/index.html  →  "config":null
 *
 * Na máquina de desenvolvimento, onde o `.env` existe durante o build, o mesmo
 * arquivo saía com a `apiKey` de verdade dentro. Daí o sintoma ser "funciona
 * aqui e não lá". Sem config o SDK não inicializa: sem avatar, sem "Sair" e — o
 * pior — sem renovação do ID token, então a sessão caía sozinha em ~1 h.
 *
 * ⚠️ É A MESMA ARMADILHA do pool criado no corpo do módulo. A regra que fecha a
 * família: **nada que dependa do ambiente pode ser avaliado na importação de um
 * módulo nem em rota estática.**
 *
 * Há um segundo motivo, igualmente forte: a navegação que ele monta depende de
 * quem está pedindo. Resposta que varia por pessoa não pode ser um arquivo
 * servido a todo mundo.
 */
export const dynamic = 'force-dynamic'

export default async function LayoutDashboard({ children }: { children: React.ReactNode }) {
  /**
   * O e-mail vem do middleware, que apaga o cabeçalho da requisição de entrada
   * antes de escrevê-lo — ver `middleware.ts`. Ler daqui é ler o que o portão
   * verificou, não o que o navegador afirmou.
   */
  const email = (await headers()).get('x-usuario-email') ?? ''

  /**
   * ⚠️ ESTE LAYOUT NÃO DECIDE MAIS QUEM ABRE A TELA — item Z de docs/06.
   *
   * A decisão morava aqui e lia `x-caminho`. O App Router reaproveita o layout
   * compartilhado quando só a página muda, então na navegação por clique ele
   * decidia com o caminho da tela ANTERIOR. Agora cada `page.tsx` passa por
   * `<PaginaProtegida>`, que roda a cada navegação; e `telas.test.ts` quebra o
   * build se uma página nascer sem ele, que era o motivo de a decisão ter vindo
   * para o layout.
   *
   * O que sobra aqui é CONFORTO: a navegação mostra só as telas que a pessoa
   * abre. Num rebaixamento com a sessão aberta o menu fica velho até o F5 — mas
   * a tela não abre mais, que era o problema.
   */
  const acesso = await resolverAcesso(email)
  const telasPermitidas = [...acesso.telas]

  return (
    /**
     * `SessaoFirebase` envolve a moldura porque o cabeçalho depende dela: é ela
     * que fornece quem está logado para o `MenuUsuario`, e é ela que mantém o
     * cookie em dia com o token que o SDK renova sozinho.
     *
     * Não está no layout raiz (que envolveria o login também) por dois motivos:
     * o raiz é estático — ver acima — e a tela de login conduz o próprio fluxo.
     */
    <SessaoFirebase config={obterConfigFirebase()}>
      {/* Suspense porque os dois leem a query string (`useSearchParams`). As
          alturas do fallback são as reais (topo 52 + navegação 36; barra 50),
          para a tela não pular. */}
      <Suspense fallback={<div style={{ height: 88 }} />}>
        <Cabecalho
          papel={acesso.papel}
          telasPermitidas={telasPermitidas}
          controleAtivo={acesso.controleAtivo}
        />
      </Suspense>

      {/*
        A barra só existe nas telas de dados — e QUEM DECIDE ISSO é a própria
        `BarraFiltros`, pelo `usePathname()`, não este layout. Pelo mesmo motivo
        do item Z: o caminho que o layout enxerga é o da tela anterior.
      */}
      <Suspense fallback={<div style={{ height: 50 }} />}>
        <BarraFiltros />
      </Suspense>
      {/* sem padding aqui: cada tela abre com `.pagina` (padrao.css), que tem o
          dela e a conta de altura das faixas */}
      <main>{children}</main>
    </SessaoFirebase>
  )
}
