import 'server-only'
import type { ConfigFirebase } from '@/lib/firebaseCliente'

/**
 * A configuração do Firebase que o navegador precisa, lida do ambiente EM TEMPO
 * DE EXECUÇÃO.
 *
 * `import 'server-only'` faz o build falhar se alguém importar este arquivo de
 * um componente de cliente. A proteção é barata e vale: o dia em que alguém
 * puxar daqui uma variável que não seja de cliente, o erro aparece no build e
 * não no bundle publicado.
 *
 * Por que não `NEXT_PUBLIC_*`: aquelas são gravadas dentro do JavaScript no
 * `next build`, então trocar o projeto Firebase exigiria reconstruir a imagem.
 * Aqui a configuração desce como prop da página, e trocar de projeto é recriar
 * o container — o mesmo ciclo de todas as outras variáveis deste sistema.
 *
 * Devolve `null` quando falta qualquer campo: a tela de login usa isso para
 * dizer o que configurar, em vez de abrir um botão que não vai funcionar.
 */
export function obterConfigFirebase(): ConfigFirebase | null {
  const apiKey = process.env.FIREBASE_API_KEY
  const authDomain = process.env.FIREBASE_AUTH_DOMAIN
  const projectId = process.env.FIREBASE_PROJECT_ID
  const appId = process.env.FIREBASE_APP_ID

  if (!apiKey || !authDomain || !projectId || !appId) return null
  return { apiKey, authDomain, projectId, appId }
}

/** Domínio de e-mail aceito — mostrado na tela de login, validado no servidor. */
export function dominioPermitido(): string {
  return process.env.ALLOWED_DOMAIN ?? 'sebratel.com.br'
}
