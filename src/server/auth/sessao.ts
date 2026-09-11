/**
 * A sessão: onde o ID token fica entre um request e outro.
 *
 * POR QUE COOKIE, E NÃO CABEÇALHO `Authorization`
 * ───────────────────────────────────────────────
 * O padrão de API é mandar `Authorization: Bearer` em cada chamada — e é o que
 * `lib/sessao.ts` faz para as chamadas de dados. Mas NAVEGAÇÃO DE PÁGINA não
 * passa por `fetch`: quando alguém digita o endereço de `/ofensores`, quem pede
 * é o navegador, e navegador não manda cabeçalho personalizado. Com token só em
 * memória, o middleware não teria o que conferir numa navegação e a proteção
 * cairia para "a página abre e os dados não vêm" — que é tela em branco, não
 * porta trancada.
 *
 * O cookie é HttpOnly de propósito: o JavaScript da página não precisa lê-lo
 * (quem guarda o token para as chamadas de dados é o SDK do Firebase), e assim
 * um XSS não consegue exfiltrar a sessão.
 *
 * O QUE ESTE COOKIE NÃO É: um cookie de sessão longo. Ele guarda o próprio ID
 * token, que vence em 1 h. Quem o mantém vivo é o cliente, que reposta o token
 * renovado quando o SDK o troca (ver `componentes/SessaoFirebase`). Isso evita
 * ter um segundo prazo de validade, paralelo ao do Google, que poderia manter
 * de pé uma sessão que o Google já encerrou.
 */

export const NOME_COOKIE = 'sessao_manutencao'

/** Rotas que existem para quem AINDA NÃO tem sessão. */
export const ROTAS_PUBLICAS = ['/login', '/api/auth/sessao'] as const

/**
 * Prazo do cookie = prazo do token, nunca mais.
 *
 * Um cookie que sobrevive ao token faria o middleware rejeitar request atrás de
 * request com um cookie que o navegador insiste em mandar — e o sintoma seria
 * "entrei e o dashboard não abre", sem nada indicando que o problema é idade.
 */
export function segundosAteVencer(exp: number): number {
  return Math.max(0, exp - Math.floor(Date.now() / 1000))
}

export function opcoesCookie(maxAge: number, seguro: boolean) {
  return {
    httpOnly: true,
    // `lax` deixa o cookie viajar na navegação que vem do popup do Google;
    // `strict` derrubaria a volta do login.
    sameSite: 'lax' as const,
    // Em produção o dashboard fica atrás de HTTPS; em rede interna por HTTP o
    // `secure` impediria o cookie de ser gravado e o login entraria em laço.
    secure: seguro,
    path: '/',
    maxAge,
  }
}
