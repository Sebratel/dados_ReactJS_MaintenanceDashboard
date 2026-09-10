import { NextResponse, type NextRequest } from 'next/server'

/**
 * Porta de entrada do dashboard — autenticação HTTP Basic com credencial única.
 *
 * POR QUE ISTO E NÃO SSO (ainda)
 * ───────────────────────────────
 * O objetivo aqui é resolver um problema concreto e imediato: sem nenhuma
 * barreira, qualquer pessoa na rede corporativa abre o dashboard e vê nome de
 * cliente, endereço e produtividade individual de técnico. Basic auth resolve
 * isso com ~40 linhas e zero infraestrutura.
 *
 * O QUE ISTO **NÃO** É: identidade. A credencial é compartilhada, então o acesso
 * não é auditável por pessoa e não há como revogar o de um indivíduo sem trocar a
 * senha de todos. Quando isso passar a importar, o caminho é Auth.js com Google
 * restrito ao domínio @sebratel.com.br — as credenciais do Google já estão no
 * `.env`, só precisam ser renomeadas (ver `.env.example`).
 *
 * FALHA FECHADA de propósito: sem as variáveis definidas, o dashboard não abre.
 * Falhar aberto transformaria um erro de configuração em exposição silenciosa —
 * exatamente o que este arquivo existe para evitar.
 */

export const config = {
  /**
   * Protege TUDO, inclusive `/api/indicadores/*` — de nada serviria trancar a
   * página e deixar o endpoint que devolve os mesmos dados aberto.
   * Fora só o que o navegador busca antes de poder autenticar (assets estáticos)
   * e o ícone, que não carregam dado nenhum.
   *
   * `api/health` também fica fora, e isso é OBRIGATÓRIO: o `HEALTHCHECK` do
   * container chama a rota com `wget`, que não manda credencial. Se ela pedisse
   * senha, o Docker leria 401 como "não saudável", marcaria o container como
   * unhealthy para sempre e entraria em laço de restart — o dashboard nunca
   * subiria, e o sintoma (restart infinito) não pareceria com a causa (auth).
   *
   * Em troca, `/api/health` NÃO PODE devolver dado de negócio: a porta é
   * publicada no host, então a rota é alcançável pela rede. Ver o comentário
   * no próprio route.ts.
   */
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|api/health).*)'],
}

const PEDIR_SENHA = {
  status: 401,
  headers: {
    // o realm aparece no diálogo do navegador
    'WWW-Authenticate': 'Basic realm="Dashboard Manutencao FTTX", charset="UTF-8"',
    'content-type': 'text/plain; charset=utf-8',
  },
} as const

/**
 * Comparação de tempo constante.
 *
 * `a === b` sai no primeiro caractere diferente, o que em teoria permite
 * descobrir a senha caractere a caractere medindo o tempo de resposta. O custo
 * de evitar isso é uma linha, então não há motivo para não evitar.
 */
function iguaisEmTempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diferenca = 0
  for (let i = 0; i < a.length; i++) {
    diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diferenca === 0
}

export function middleware(req: NextRequest) {
  const usuarioEsperado = process.env.DASH_USUARIO
  const senhaEsperada = process.env.DASH_SENHA

  if (!usuarioEsperado || !senhaEsperada) {
    return new NextResponse(
      'Dashboard sem credencial configurada.\n' +
        'Defina DASH_USUARIO e DASH_SENHA no .env e reinicie o servidor.\n' +
        '(Ver .env.example.)',
      { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } }
    )
  }

  const cabecalho = req.headers.get('authorization')
  if (!cabecalho?.startsWith('Basic ')) {
    return new NextResponse('Autenticação necessária.', PEDIR_SENHA)
  }

  let usuario = ''
  let senha = ''
  try {
    // runtime Edge: `atob` existe, `Buffer` não
    const decodificado = atob(cabecalho.slice('Basic '.length))
    const corte = decodificado.indexOf(':')
    // a senha pode conter ':' — só o PRIMEIRO separa usuário de senha
    usuario = decodificado.slice(0, corte)
    senha = decodificado.slice(corte + 1)
  } catch {
    return new NextResponse('Credencial malformada.', PEDIR_SENHA)
  }

  const ok =
    iguaisEmTempoConstante(usuario, usuarioEsperado) &&
    iguaisEmTempoConstante(senha, senhaEsperada)

  if (!ok) return new NextResponse('Usuário ou senha inválidos.', PEDIR_SENHA)

  return NextResponse.next()
}
