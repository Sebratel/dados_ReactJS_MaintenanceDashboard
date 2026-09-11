import { NextResponse, type NextRequest } from 'next/server'
import { verificarIdToken } from '@/server/auth/firebaseToken'
import { NOME_COOKIE } from '@/server/auth/sessao'

/**
 * Porta de entrada do dashboard — SSO com conta Google, via Firebase
 * Authentication.
 *
 * O QUE ISTO SUBSTITUIU, E POR QUÊ
 * ────────────────────────────────
 * Até 11/09/2026 aqui havia HTTP Basic com credencial COMPARTILHADA. Ela
 * resolvia o problema imediato (barrar quem não deve ver nome de cliente,
 * endereço e produtividade individual de técnico) e não resolvia identidade:
 * não dava para saber QUEM viu, nem revogar o acesso de uma pessoa sem trocar a
 * senha de todos. Agora cada pessoa entra com a própria conta `@sebratel.com.br`
 * e sai quando a conta dela sai.
 *
 * POR QUE FIREBASE E NÃO GOOGLE IDENTITY SERVICES
 * ────────────────────────────────────────────────
 * O GSI baixa o SDK de `accounts.google.com` em tempo de execução e obriga o
 * servidor a chamar o Google a CADA login, porque o `access_token` dele é
 * opaco. São duas dependências de rede, e qualquer uma bloqueada pelo firewall
 * corporativo derruba o login inteiro — com uma tela de erro que não ajuda,
 * porque ela precisa exatamente do domínio bloqueado. O ID token do Firebase é
 * um JWT assinado, verificado localmente (`server/auth/firebaseToken.ts`).
 *
 * ESTE ARQUIVO CONTINUA SENDO O ÚNICO PORTÃO — e é por isso que a verificação
 * precisou caber no runtime Edge. Espalhar a checagem pelas rotas criaria a
 * chance de uma nova rota nascer desprotegida; aqui, o padrão é estar trancado.
 *
 * FALHA FECHADA de propósito: sem `FIREBASE_PROJECT_ID` e `ALLOWED_DOMAIN`, o
 * dashboard não abre. Falhar aberto transformaria erro de configuração em
 * exposição silenciosa — exatamente o que este arquivo existe para evitar.
 */

export const config = {
  /**
   * Protege TUDO, inclusive `/api/indicadores/*` — de nada serviria trancar a
   * página e deixar o endpoint que devolve os mesmos dados aberto.
   * Fora só o que o navegador busca antes de poder autenticar (assets
   * estáticos) e o ícone, que não carregam dado nenhum.
   *
   * `api/health` também fica fora, e isso é OBRIGATÓRIO: o `HEALTHCHECK` do
   * container chama a rota com `wget`, que não manda credencial. Se ela pedisse
   * sessão, o Docker leria 401 como "não saudável", marcaria o container como
   * unhealthy para sempre e entraria em laço de restart — o dashboard nunca
   * subiria, e o sintoma (restart infinito) não pareceria com a causa (auth).
   *
   * Em troca, `/api/health` NÃO PODE devolver dado de negócio: a porta é
   * publicada no host, então a rota é alcançável pela rede. Ver o comentário
   * no próprio route.ts.
   *
   * `logo-sebratel.png` entrou na lista com o SSO, e o motivo é bom de guardar:
   * a tela de login usa o logo, e quem a vê é exatamente quem ainda não tem
   * sessão. Protegido, ele era redirecionado para `/login` e a tela de login
   * abria com a marca quebrada — um ícone de imagem faltando na primeira tela
   * do sistema. Com a credencial Basic isso não aparecia, porque o navegador
   * reenviava a mesma credencial para a imagem.
   *
   * ⚠️ A exclusão é NOMINAL, e não um `.*\\..*` que liberaria todo arquivo com
   * extensão: este é o único arquivo público do projeto, e qualquer outro que
   * nasça em `public/` deve ser uma decisão consciente de publicar, não um
   * efeito colateral de ter ponto no nome.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|logo-sebratel\\.png|api/health).*)',
  ],
}

/** A tela de login e a rota que cria a sessão precisam abrir sem sessão. */
function ehPublica(caminho: string): boolean {
  return caminho === '/login' || caminho === '/api/auth/sessao'
}

function ehChamadaDeDados(req: NextRequest): boolean {
  return req.nextUrl.pathname.startsWith('/api/')
}

/**
 * Sem sessão válida: a API responde 401 em JSON e a página vai para o login.
 *
 * A distinção importa. Redirecionar uma chamada de dados devolveria o HTML da
 * tela de login com status 200, e o cliente tentaria interpretá-lo como
 * indicador — o erro apareceria como "falha ao carregar", escondendo que o caso
 * era sessão vencida. Com 401 explícito, `lib/sessao.ts` sabe que deve tentar
 * renovar o token uma vez antes de desistir.
 */
function recusar(req: NextRequest, motivo: string): NextResponse {
  if (ehChamadaDeDados(req)) {
    return NextResponse.json(
      { erro: 'sessão inválida ou expirada', motivo },
      { status: 401, headers: { 'cache-control': 'no-store' } }
    )
  }

  const destino = new URL('/login', req.url)
  // Para devolver a pessoa exatamente à tela que ela pediu depois do login.
  // Só o caminho relativo entra, nunca uma URL absoluta vinda de fora: aceitar
  // host arbitrário aqui viraria redirecionamento aberto.
  const pedido = `${req.nextUrl.pathname}${req.nextUrl.search}`
  if (pedido !== '/') destino.searchParams.set('destino', pedido)
  destino.searchParams.set('motivo', motivo)

  const r = NextResponse.redirect(destino)
  // Cookie ilegível ou vencido não deve voltar no próximo request.
  if (req.cookies.has(NOME_COOKIE)) r.cookies.delete(NOME_COOKIE)
  return r
}

export async function middleware(req: NextRequest) {
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.ALLOWED_DOMAIN) {
    return new NextResponse(
      'Dashboard sem autenticação configurada.\n' +
        'Defina FIREBASE_PROJECT_ID e ALLOWED_DOMAIN no ambiente e reinicie o servidor.\n' +
        '(Ver .env.example.)',
      { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } }
    )
  }

  if (ehPublica(req.nextUrl.pathname)) return NextResponse.next()

  const token = req.cookies.get(NOME_COOKIE)?.value
  if (!token) return recusar(req, 'sem-sessao')

  let resultado
  try {
    resultado = await verificarIdToken(token)
  } catch (e) {
    // Só chega aqui por falha de INFRAESTRUTURA: sem nenhuma chave utilizável
    // em cache e sem conseguir buscar as do Google. Não é sessão inválida, e
    // tratá-la como tal mandaria para o login quem está com token bom.
    console.error(
      '[auth] não consegui verificar a sessão:',
      e instanceof Error ? e.message : String(e)
    )
    return NextResponse.json(
      { erro: 'não foi possível validar a sessão agora' },
      { status: 503, headers: { 'cache-control': 'no-store' } }
    )
  }

  if (!resultado.ok) return recusar(req, resultado.motivo)

  // A identidade viaja para as rotas em cabeçalho de request — é o que permite
  // o log dizer QUEM consultou, coisa que a credencial compartilhada nunca pôde.
  const cabecalhos = new Headers(req.headers)
  cabecalhos.set('x-usuario-email', resultado.claims.email)

  return NextResponse.next({ request: { headers: cabecalhos } })
}
