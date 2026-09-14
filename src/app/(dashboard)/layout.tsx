import { headers } from 'next/headers'
import { Suspense } from 'react'
import { Cabecalho } from '@/components/Cabecalho'
import { BarraFiltros } from '@/components/filtros/BarraFiltros'
import { SessaoFirebase } from '@/components/SessaoFirebase'
import { SemAcesso } from '@/components/SemAcesso'
import { obterConfigFirebase } from '@/server/auth/configCliente'
import { resolverAcesso } from '@/server/auth/acesso'
import { telaDoCaminho } from '@/config/telas'

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
 * Agora há um segundo motivo, igualmente forte: a AUTORIZAÇÃO acontece aqui, e
 * ela depende de quem está pedindo. Resposta que varia por pessoa não pode ser
 * um arquivo servido a todo mundo.
 */
export const dynamic = 'force-dynamic'

export default async function LayoutDashboard({ children }: { children: React.ReactNode }) {
  /**
   * Os dois cabeçalhos vêm do middleware, que os apaga da requisição de entrada
   * antes de escrevê-los — ver `middleware.ts`. Ler daqui é ler o que o portão
   * verificou, não o que o navegador afirmou.
   */
  const h = await headers()
  const email = h.get('x-usuario-email') ?? ''
  const caminho = h.get('x-caminho') ?? '/'

  const acesso = await resolverAcesso(email)
  const tela = telaDoCaminho(caminho)

  /**
   * A decisão de bloquear mora AQUI, num lugar só, e não em cada página.
   *
   * Se estivesse em cada `page.tsx`, a página nova nasceria aberta por omissão —
   * e esquecimento de autorização não aparece como erro na tela: aparece como
   * alguém vendo desempenho nominal de técnico que não devia ver. Aqui o padrão
   * é o contrário: rota que não está no catálogo de telas só passa se for
   * reconhecida abaixo.
   */
  const ehConfiguracoes = caminho === '/configuracoes'
  const permitido = ehConfiguracoes
    ? acesso.papel === 'admin'
    : tela
      ? acesso.telas.has(tela.id)
      : true // rota do grupo que não é tela de dados nem configurações

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
          alturas do fallback são as reais, para a tela não pular. */}
      <Suspense fallback={<div className="h-[45px]" />}>
        <Cabecalho
          papel={acesso.papel}
          telasPermitidas={telasPermitidas}
          controleAtivo={acesso.controleAtivo}
        />
      </Suspense>

      {permitido ? (
        <>
          {/*
            A barra só existe nas telas de dados — mas QUEM DECIDE ISSO é a
            própria `BarraFiltros`, pelo `usePathname()`, e não este layout.

            Aqui havia um `{!ehConfiguracoes && …}`. A regra era a certa e o
            valor é que não chegava: `ehConfiguracoes` sai de `x-caminho`, e o
            App Router reaproveita o layout compartilhado quando só a página
            muda — ele ficava com o caminho da tela ANTERIOR. O sintoma feio não
            era a barra sobrando em Configurações, era ela SUMINDO de Tempos na
            volta pelo menu, deixando a tela sem filtro nenhum.

            ⚠️ MESMA CAUSA, OUTRA METADE: o `permitido` acima sai do MESMO
            `caminho` congelado. Isto aqui não conserta aquilo — ver item Z de
            docs/06 e conversar com quem escreveu a matriz de acesso.
          */}
          <Suspense fallback={<div className="h-[49px]" />}>
            <BarraFiltros />
          </Suspense>
          <main className="px-4 py-4">{children}</main>
        </>
      ) : (
        <main className="px-4 py-4">
          <SemAcesso
            tela={tela?.rotulo ?? 'Configurações'}
            email={acesso.email}
            ehConfiguracoes={ehConfiguracoes}
          />
        </main>
      )}
    </SessaoFirebase>
  )
}
