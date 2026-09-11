import { Suspense } from 'react'
import { Cabecalho } from '@/components/Cabecalho'
import { BarraFiltros } from '@/components/filtros/BarraFiltros'

/**
 * A moldura do dashboard: cabeçalho de navegação e barra de filtros globais.
 *
 * POR QUE ELA VIVE NUM GRUPO DE ROTAS, E NÃO NO LAYOUT RAIZ
 * ─────────────────────────────────────────────────────────
 * A tela de login não pode ter nem uma coisa nem outra: a navegação levaria a
 * páginas que ainda vão recusar a pessoa, e a barra de filtros ofereceria
 * recortar dado nenhum. Com a moldura aqui, "o login não tem cabeçalho" é um
 * fato da estrutura de arquivos, e não um `if (pathname === '/login')` dentro
 * do componente — condicional que a próxima tela pública esqueceria de repetir.
 *
 * `(dashboard)` entre parênteses não aparece na URL: `/ofensores` continua
 * sendo `/ofensores`.
 */
export default function LayoutDashboard({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Suspense porque os dois leem a query string (`useSearchParams`), o que
          os torna dinâmicos; sem a fronteira, a página inteira deixaria de ser
          pré-renderizada. As alturas do fallback são as reais, para a tela não
          pular quando eles chegam. */}
      <Suspense fallback={<div className="h-[45px]" />}>
        <Cabecalho />
      </Suspense>
      <Suspense fallback={<div className="h-[49px]" />}>
        <BarraFiltros />
      </Suspense>
      <main className="px-4 py-4">{children}</main>
    </>
  )
}
