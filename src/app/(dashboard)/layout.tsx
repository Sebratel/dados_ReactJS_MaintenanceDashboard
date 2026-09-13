import { Suspense } from 'react'
import { Cabecalho } from '@/components/Cabecalho'
import { BarraFiltros } from '@/components/filtros/BarraFiltros'
import { SessaoFirebase } from '@/components/SessaoFirebase'
import { obterConfigFirebase } from '@/server/auth/configCliente'

/**
 * ESTE LAYOUT É DINÂMICO DE PROPÓSITO, e a razão é de correção, não de gosto.
 *
 * Ele lê a configuração do Firebase do ambiente e a entrega ao cliente. Sem
 * `force-dynamic`, as 8 telas abaixo são pré-renderizadas no `next build`, e
 * componente de servidor em rota estática roda UMA VEZ: o valor lido vira parte
 * do HTML gravado na imagem.
 *
 * O estrago medido em 12/09/2026, com o build rodando como no container:
 *
 *     .next/server/app/index.html  →  "config":null
 *
 * Na máquina de desenvolvimento, onde o `.env` existe durante o build, o mesmo
 * arquivo saía com a `apiKey` de verdade dentro. Daí o sintoma ser "funciona
 * aqui e não lá": no Portainer o login abria normalmente (a página de login é
 * dinâmica e lê o ambiente em tempo de execução), mas dentro do dashboard o SDK
 * nunca inicializava. Sem SDK não há avatar, não há "Sair", e — o pior — não há
 * renovação do ID token: quando o cookie vencia, a pessoa era mandada para o
 * login no meio do trabalho.
 *
 * ⚠️ É A MESMA ARMADILHA do pool de banco criado no corpo do módulo: valor de
 * runtime avaliado em tempo de build. A regra que fecha a família: **nada que
 * dependa do ambiente pode ser avaliado em rota estática.**
 *
 * O preço é as 8 telas passarem a ser renderizadas a cada request em vez de
 * servidas prontas. É barato aqui: elas são só a casca (todo dado vem da API,
 * por `fetch`), e cada request já passa pelo middleware, que faz verificação
 * criptográfica de sessão — o custo de montar a casca some ao lado disso.
 */
export const dynamic = 'force-dynamic'

export default function LayoutDashboard({ children }: { children: React.ReactNode }) {
  return (
    /**
     * `SessaoFirebase` envolve a moldura porque o cabeçalho depende dela: é ela
     * que fornece quem está logado para o `MenuUsuario`. E é ela que mantém o
     * cookie de sessão em dia com o token que o SDK renova sozinho.
     *
     * Não está no layout raiz (que envolveria o login também) por dois motivos:
     * o layout raiz é estático — ver o comentário acima — e a tela de login
     * conduz o próprio fluxo de autenticação, sem precisar deste provedor.
     */
    <SessaoFirebase config={obterConfigFirebase()}>
      {/* Suspense porque os dois leem a query string (`useSearchParams`). As
          alturas do fallback são as reais, para a tela não pular quando eles
          chegam. */}
      <Suspense fallback={<div className="h-[45px]" />}>
        <Cabecalho />
      </Suspense>
      <Suspense fallback={<div className="h-[49px]" />}>
        <BarraFiltros />
      </Suspense>
      <main className="px-4 py-4">{children}</main>
    </SessaoFirebase>
  )
}
