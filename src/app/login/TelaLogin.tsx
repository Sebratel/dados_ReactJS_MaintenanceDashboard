'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup } from 'firebase/auth'
import { obterAuth, type ConfigFirebase } from '@/lib/firebaseCliente'
import { gravarSessao } from '@/lib/clienteHttp'

/**
 * Tela de entrada.
 *
 * Três estados, como toda tela deste dashboard: `verificando` (o SDK ainda está
 * dizendo se já há sessão guardada), `pronto` (botão) e `entrando`. O quarto,
 * erro, convive com os demais porque a pessoa precisa ver a mensagem E o botão
 * para tentar de novo.
 */

type Estado = 'verificando' | 'pronto' | 'entrando'

/** Mensagem de por que a pessoa está vendo esta tela, e não o dashboard. */
const MOTIVOS: Record<string, string> = {
  expirada: 'Sua sessão expirou. Entre novamente para continuar.',
  saiu: 'Você saiu do dashboard.',
  'sem-sessao': '',
  'token-vencido': 'Sua sessão expirou. Entre novamente para continuar.',
  'dominio-nao-autorizado': 'Essa conta não é da Sebratel. Entre com sua conta corporativa.',
  'email-nao-verificado': 'Essa conta Google está sem e-mail verificado.',
  'projeto-errado': 'Esse login é de outro sistema. Entre novamente por aqui.',
  'assinatura-invalida': 'Não consegui validar seu login anterior. Entre novamente.',
  'token-malformado': 'Não consegui validar seu login anterior. Entre novamente.',
}

/**
 * Só caminho interno vira destino. Aceitar o que vier na query permitiria
 * mandar alguém de um endereço legítimo da Sebratel para fora, logo depois de
 * um login bem-sucedido — que é quando a pessoa está mais disposta a confiar na
 * página que aparece. `//` no início é URL relativa a protocolo: `//site.com`
 * sai do domínio sem precisar escrever `https:`.
 */
function destinoSeguro(bruto: string | null): string {
  if (!bruto || !bruto.startsWith('/') || bruto.startsWith('//')) return '/'
  return bruto
}

/** Mensagem útil a partir do código do Firebase — o texto cru dele não serve. */
function mensagemDoErro(e: unknown): string {
  const codigo = typeof e === 'object' && e && 'code' in e ? String(e.code) : ''
  switch (codigo) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'A janela do Google foi fechada antes de concluir.'
    case 'auth/popup-blocked':
      return 'O navegador bloqueou a janela do Google. Libere o pop-up para este endereço e tente de novo.'
    case 'auth/unauthorized-domain':
      // Erro de configuração, não de quem está tentando entrar — e só aparece
      // no primeiro clique real, nunca no build. Daí a instrução explícita.
      return 'Este endereço não está autorizado no projeto Firebase. Adicione-o em Authentication → Settings → Authorized domains.'
    case 'auth/network-request-failed':
      return 'Não consegui falar com o Google. Verifique a conexão com a rede corporativa e tente de novo.'
    case 'auth/operation-not-allowed':
      return 'O acesso com Google está desativado no projeto Firebase. Ative em Authentication → Sign-in method.'
    default:
      return e instanceof Error && e.message ? e.message : 'Não consegui concluir o login.'
  }
}

export function TelaLogin({
  config,
  dominio,
}: {
  config: ConfigFirebase | null
  dominio: string
}) {
  const params = useSearchParams()
  const destino = destinoSeguro(params.get('destino'))
  const motivo = params.get('motivo')

  const [estado, setEstado] = useState<Estado>(config ? 'verificando' : 'pronto')
  const [erro, setErro] = useState<string | null>(
    motivo && MOTIVOS[motivo] ? MOTIVOS[motivo] : null
  )

  /**
   * Sessão do Firebase guardada no navegador, cookie vencido.
   *
   * É o caso de quem volta no dia seguinte: o cookie dura o que o token dura
   * (~1 h), mas o SDK ainda consegue um token novo sozinho. Sem esta passagem, a
   * pessoa veria o popup do Google todo dia de manhã, sem necessidade.
   */
  useEffect(() => {
    if (!config) return

    const auth = obterAuth(config)
    return onAuthStateChanged(
      auth,
      (user) => {
        if (!user) {
          setEstado('pronto')
          return
        }
        void gravarSessao(user)
          .then((ok) => {
            if (ok) {
              location.assign(destino)
              return
            }
            // Token bom para o Firebase e recusado por nós: tipicamente conta
            // pessoal. Encerrar aqui evita o laço de tentar a mesma conta.
            void auth.signOut()
            setErro(`Entre com uma conta @${dominio}.`)
            setEstado('pronto')
          })
          .catch(() => {
            setErro('Não consegui abrir a sessão no servidor. Tente novamente.')
            setEstado('pronto')
          })
      },
      () => setEstado('pronto')
    )
  }, [config, destino, dominio])

  const entrar = useCallback(async () => {
    if (!config) return
    setErro(null)
    setEstado('entrando')
    try {
      const auth = obterAuth(config)
      const provider = new GoogleAuthProvider()
      /**
       * `hd` filtra o seletor de contas do Google para o domínio da empresa.
       * É CONFORTO, NÃO CONTROLE: quem decide acesso é o servidor, em
       * `firebaseToken.ts`. Serve para a pessoa não escolher a conta pessoal e
       * só descobrir que não pode depois de passar pelo login inteiro.
       */
      provider.setCustomParameters({ hd: dominio })
      const cred = await signInWithPopup(auth, provider)

      const ok = await gravarSessao(cred.user)
      if (!ok) {
        await auth.signOut()
        setErro(`Entre com uma conta @${dominio}.`)
        setEstado('pronto')
        return
      }
      location.assign(destino)
    } catch (e) {
      setErro(mensagemDoErro(e))
      setEstado('pronto')
    }
  }, [config, destino, dominio])

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <section
        className="w-full max-w-[400px] rounded-lg border p-7"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
      >
        <div className="flex items-center gap-2.5">
          {/* mesmo arquivo do cabeçalho e do Data Hub: PNG RGBA, que se apoia
              no fundo dos dois temas sem precisar de variante */}
          <img src="/logo-sebratel.png" alt="" width={32} height={32} className="size-8" />
          <span className="flex flex-col leading-none">
            <span className="text-sm font-semibold whitespace-nowrap text-[var(--text-primary)]">
              Manutenção FTTX
            </span>
            <span
              className="mt-1 text-[9px] font-bold tracking-[0.14em]"
              style={{ color: 'var(--brand)' }}
            >
              SEBRATEL
            </span>
          </span>
        </div>

        <h1 className="mt-6 text-base font-semibold text-[var(--text-primary)]">
          Entre para ver os indicadores
        </h1>
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-muted)]">
          O acesso é com sua conta <strong className="font-semibold">@{dominio}</strong>. O
          dashboard mostra nome de cliente, endereço e produtividade individual de técnico.
        </p>

        {erro && (
          <p
            role="alert"
            className="mt-4 flex items-start gap-2 rounded border px-3 py-2 text-xs leading-relaxed"
            style={{
              borderColor: 'var(--status-critical)',
              // a cor de status entra como fundo tênue: fundo chapado de alerta
              // numa tela que é quase toda ela um aviso vira ruído
              background: 'color-mix(in srgb, var(--status-critical) 10%, transparent)',
              color: 'var(--text-primary)',
            }}
          >
            <IconeAlerta />
            <span>{erro}</span>
          </p>
        )}

        {config === null ? (
          <p
            className="mt-5 rounded border px-3 py-2 text-xs leading-relaxed"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            Autenticação não configurada neste servidor. Defina{' '}
            <code>FIREBASE_API_KEY</code>, <code>FIREBASE_AUTH_DOMAIN</code>,{' '}
            <code>FIREBASE_PROJECT_ID</code> e <code>FIREBASE_APP_ID</code> no ambiente e
            recrie o container.
          </p>
        ) : (
          <button
            type="button"
            onClick={() => void entrar()}
            disabled={estado !== 'pronto'}
            className="mt-6 flex w-full items-center justify-center gap-2.5 rounded border px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              borderColor: 'var(--border-strong)',
              background: 'var(--surface-raised)',
              color: 'var(--text-primary)',
            }}
          >
            {estado === 'pronto' ? (
              <>
                <IconeGoogle />
                Entrar com Google
              </>
            ) : (
              <>
                <IconeEspera />
                {estado === 'verificando' ? 'Verificando sessão…' : 'Entrando…'}
              </>
            )}
          </button>
        )}
      </section>
    </main>
  )
}

/* ──────────────────────────────────────────────────────────────────────
   Ícones em SVG, nunca emoji: emoji renderiza diferente por sistema
   operacional e destrói o alinhamento vertical do botão.
   ────────────────────────────────────────────────────────────────────── */

/** As quatro cores oficiais do Google — marca de terceiro, não entra em token. */
function IconeGoogle() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  )
}

function IconeAlerta() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="mt-px shrink-0"
      style={{ color: 'var(--status-critical)' }}
    >
      <path
        fill="currentColor"
        d="M8 1.4 15.2 14H.8L8 1.4Zm0 4.1a.75.75 0 0 0-.75.75v3a.75.75 0 0 0 1.5 0v-3A.75.75 0 0 0 8 5.5Zm0 5.4a.85.85 0 1 0 0 1.7.85.85 0 0 0 0-1.7Z"
      />
    </svg>
  )
}

function IconeEspera() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" className="animate-spin">
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="var(--border-strong)" strokeWidth="2" />
      <path
        d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5"
        fill="none"
        stroke="var(--brand)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
