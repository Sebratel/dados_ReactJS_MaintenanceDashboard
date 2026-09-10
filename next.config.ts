import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * Saida autocontida para a imagem Docker.
   *
   * POR QUE ISTO EXISTE: sem `standalone`, a imagem precisa carregar o
   * `node_modules` inteiro (463 MB medidos em 10/09/2026) para o app subir. Com
   * ele, o Next emite `.next/standalone` com APENAS os modulos efetivamente
   * alcancados pelo codigo, e a imagem final passa a ser esse diretorio +
   * `.next/static` + `public`.
   *
   * Nao muda `next dev` nem `next start`, que continuam funcionando igual — o
   * standalone e emitido em ADICAO ao build normal, nao no lugar dele.
   */
  output: 'standalone',
  /**
   * Diretório de saída, parametrizável.
   *
   * POR QUE ISTO EXISTE: `next build` e `next dev` gravam no MESMO `.next` por
   * padrão. Rodar um build para conferir enquanto o dev server está no ar
   * substitui os artefatos de desenvolvimento pelos de produção, e o dev server
   * passa a servir a página com todos os assets em 404 — a tela abre em HTML puro,
   * sem CSS nenhum. Aconteceu duas vezes neste projeto e o sintoma não parece com
   * a causa.
   *
   * Use `npm run verify` (que aponta para `.next-verify`) sempre que quiser
   * validar o build sem derrubar o dev server.
   */
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // pg e mysql2 são nativos do servidor — nunca devem entrar no bundle do cliente
  serverExternalPackages: ['pg', 'mysql2'],
  experimental: {
    // as queries do ERP podem levar segundos; o padrão de 30s é curto para o Tier 2
    proxyTimeout: 120_000,
  },
}

export default nextConfig
