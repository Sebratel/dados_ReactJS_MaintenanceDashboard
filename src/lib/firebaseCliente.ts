'use client'

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  type Auth,
} from 'firebase/auth'

/**
 * Inicialização do Firebase no cliente.
 *
 * O SDK VEM DO npm, NUNCA DE `<script src>`. Essa é a diferença que faz o login
 * funcionar atrás do firewall corporativo: o código de autenticação viaja no
 * bundle da própria aplicação, e não num arquivo baixado de
 * `accounts.google.com` no instante do clique. Bloquear aquele domínio deixaria
 * o botão de login sem reagir, sem mensagem útil — e a tela de erro precisaria
 * exatamente do domínio bloqueado para aparecer.
 *
 * A CONFIGURAÇÃO CHEGA DO SERVIDOR, EM TEMPO DE EXECUÇÃO
 * ──────────────────────────────────────────────────────
 * Ela NÃO usa `NEXT_PUBLIC_*`. Variável `NEXT_PUBLIC_` é gravada dentro do
 * JavaScript no momento do `next build`, o que significa que trocar o projeto
 * Firebase exigiria RECONSTRUIR A IMAGEM — e a stack deste projeto entrega
 * variável em runtime, não em build (ver o comentário sobre `args` no
 * docker-compose.yml). Em vez disso, a página de login (componente de servidor)
 * lê o ambiente e passa a configuração como prop. Trocar de projeto passa a ser
 * recriar o container, como todo o resto daqui.
 *
 * Estes valores não são segredo: eles vão para o navegador por desenho, e a
 * `apiKey` do Firebase é a chave "browser" do projeto. O que a protege não é
 * sigilo, é restrição — ver a seção de chave de API no README.
 */

export type ConfigFirebase = {
  apiKey: string
  authDomain: string
  projectId: string
  appId: string
}

let appMemo: FirebaseApp | undefined
let authMemo: Auth | undefined

/**
 * A instância fica em módulo para que `clienteHttp` possa renovar o token sem
 * receber a configuração de novo — ela é criada uma vez, na primeira tela que
 * precisa dela, e vale para a aba inteira.
 */
export function obterAuth(config: ConfigFirebase): Auth {
  if (authMemo) return authMemo

  appMemo = getApps()[0] ?? initializeApp(config)
  authMemo = getAuth(appMemo)

  /**
   * Persistência local: a sessão do Firebase sobrevive a fechar a aba.
   *
   * É o que permite reabrir o dashboard no dia seguinte sem ver o popup de
   * novo — o cookie de sessão terá vencido (ele dura o que o token dura, ~1 h),
   * mas o SDK ainda tem com que pedir um token novo, em silêncio.
   *
   * O `catch` vazio é deliberado: navegador com armazenamento bloqueado cai
   * para persistência de memória e o login continua funcionando nesta aba.
   * Falhar aqui seria trocar "sessão mais curta" por "não entra".
   */
  void setPersistence(authMemo, browserLocalPersistence).catch(() => {})

  return authMemo
}

/** A instância já criada, se houver. Não cria — quem cria é quem tem a config. */
export function authAtual(): Auth | undefined {
  return authMemo
}
