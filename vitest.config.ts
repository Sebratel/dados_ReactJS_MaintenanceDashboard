import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * O alias `@/` do tsconfig não chega ao vitest sozinho: o TypeScript o usa para
 * RESOLVER TIPOS, mas quem carrega os módulos em tempo de execução é o Vite, que
 * lê a configuração daqui. Sem esta linha o teste falha com "Failed to load url
 * @/server/db/dash" — erro que parece arquivo inexistente e é só resolução.
 *
 * Os testes antigos não esbarraram nisso porque importavam pelo caminho relativo
 * do próprio diretório.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
