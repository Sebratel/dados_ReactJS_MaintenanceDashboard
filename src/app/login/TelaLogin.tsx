'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup } from 'firebase/auth'
import { obterAuth, type ConfigFirebase } from '@/lib/firebaseCliente'
import { gravarSessao } from '@/lib/clienteHttp'
import css from './login.module.css'

/**
 * Tela de entrada — mesmo padrão do COM · Gestão Comercial (`comercial_pbi`).
 *
 * A estrutura veio de lá para que a porta de entrada dos sistemas internos da
 * Sebratel seja reconhecível entre si: cena de marca à esquerda, card à
 * direita, etiqueta do sistema, aviso de domínio, botão do Google e barra de
 * rodapé. O que muda é a cor (vermelho da marca, não o vinho do relatório
 * comercial) e o MOTOR: lá o login é Google Identity Services, aqui é Firebase
 * Authentication — ver o cabeçalho de `middleware.ts` para o porquê. Copiar a
 * tela não significa copiar o mecanismo.
 *
 * Três estados: `verificando` (o SDK ainda está dizendo se já há sessão
 * guardada), `pronto` e `entrando`. O erro convive com todos eles, porque a
 * pessoa precisa ver a mensagem E o botão para tentar de novo.
 */

type Estado = 'verificando' | 'pronto' | 'entrando'

/** Mensagem de por que a pessoa está vendo esta tela, e não o dashboard. */
const MOTIVOS: Record<string, string> = {
  'dominio-nao-autorizado': 'Essa conta não é da Sebratel. Entre com sua conta corporativa.',
  'email-nao-verificado': 'Essa conta Google está sem e-mail verificado.',
  'projeto-errado': 'Esse login é de outro sistema. Entre novamente por aqui.',
  'assinatura-invalida': 'Não consegui validar seu login anterior. Entre novamente.',
  'token-malformado': 'Não consegui validar seu login anterior. Entre novamente.',
}

/** Estes dois não são erro: são explicação, e têm aviso próprio no card. */
const SAIDAS = new Set(['expirada', 'token-vencido', 'saiu'])

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
      return 'A janela do Google foi fechada antes de concluir. Tente de novo.'
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
  const expirou = motivo === 'expirada' || motivo === 'token-vencido'
  const saiu = motivo === 'saiu'

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
    <div className={css.login}>
      <div className={css.arte} aria-hidden="true">
        <div className={`${css.brilho} ${css.brilho1}`} />
        <div className={`${css.brilho} ${css.brilho2}`} />
        {/*
          A malha não é decoração genérica: são traços de fibra atravessando a
          cena, que é o que este sistema mede. Mesma ideia das curvas da tela
          do comercial, com a paleta daqui.
        */}
        <svg className={css.malha} viewBox="0 0 1200 780" preserveAspectRatio="xMidYMid slice">
          <path
            d="M0,520 Q280,380 520,460 T920,400 T1200,360"
            fill="none"
            stroke="rgba(255,107,114,0.5)"
            strokeWidth="1.25"
          />
          <path
            d="M80,620 Q420,520 720,560 T1180,480"
            fill="none"
            stroke="rgba(235,104,52,0.4)"
            strokeWidth="1"
          />
          <path
            d="M200,180 Q520,280 780,200 T1120,240"
            fill="none"
            stroke="rgba(255,255,255,0.18)"
            strokeWidth="0.9"
          />
        </svg>
      </div>

      <div className={css.conteudo}>
        <section className={css.marca}>
          <div className={css.marcaTopo}>
            {/* mesmo arquivo do cabeçalho e do Data Hub — PNG RGBA */}
            <img src="/logo-sebratel.png" alt="" width={46} height={46} />
            <span>Operação Sebratel</span>
          </div>
          <h2>
            A manutenção de fibra <span>em tempo real.</span>
          </h2>
          <p>
            MTTR, produtividade de campo, recorrência e preventivos direto do Voalle — os
            mesmos indicadores do Power BI, sem esperar refresh.
          </p>
        </section>

        <section className={css.cardWrap}>
          <div className={`${css.card}${erro ? ` ${css.tremer}` : ''}`}>
            <header>
              <span className={css.etiqueta}>MAN · Manutenção FTTX</span>
              <h1>Acessar o dashboard</h1>
              <p>
                Entre com a sua conta Google corporativa. A tela mostra nome de cliente,
                endereço e produtividade individual de técnico.
              </p>
            </header>

            {expirou && !erro && (
              <div className={css.expirou}>
                <IconeRelogio />
                <span>
                  Sua sessão expirou e você foi desconectado. Entre novamente para continuar.
                </span>
              </div>
            )}

            {saiu && !erro && (
              <div className={css.expirou}>
                <IconeRelogio />
                <span>Você saiu do dashboard. Entre novamente quando precisar.</span>
              </div>
            )}

            <div className={css.aviso}>
              <div className={css.icone}>
                <IconeCadeado />
              </div>
              <div>
                <p>
                  Domínio liberado: <b>@{dominio}</b>
                </p>
                <span>Não é a sua conta? Saia do Google antes de entrar.</span>
              </div>
            </div>

            {erro && (
              <div className={css.erro} role="alert">
                <IconeAlerta />
                <span>{erro}</span>
              </div>
            )}

            {config === null && (
              <div className={css.semConfig}>
                O servidor está sem <code>FIREBASE_API_KEY</code>,{' '}
                <code>FIREBASE_AUTH_DOMAIN</code>, <code>FIREBASE_PROJECT_ID</code> ou{' '}
                <code>FIREBASE_APP_ID</code>. Configure no ambiente e recrie o container
                para habilitar o login.
              </div>
            )}

            <button
              type="button"
              className={css.botaoGoogle}
              onClick={() => void entrar()}
              disabled={estado !== 'pronto' || config === null}
            >
              <span className={css.marcaBotao}>
                {estado === 'pronto' ? (
                  <MarcaGoogle />
                ) : (
                  <span className={css.girando}>
                    <IconeEspera />
                  </span>
                )}
              </span>
              {estado === 'verificando'
                ? 'Verificando sessão…'
                : estado === 'entrando'
                  ? 'Autenticando…'
                  : 'Entrar com Google'}
            </button>

            <p className={css.rodapeCard}>
              Problemas para acessar? Fale com{' '}
              <a href="mailto:intel@sebratel.com.br">intel@sebratel.com.br</a>
            </p>
          </div>
        </section>
      </div>

      <footer className={css.barra}>
        <IconeCadeado tamanho={13} /> Ambiente seguro e monitorado · Inteligência de Dados
        Sebratel
      </footer>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────
   Ícones em SVG, nunca emoji: emoji renderiza diferente por sistema
   operacional e destrói o alinhamento vertical.
   ────────────────────────────────────────────────────────────────────── */

/** As quatro cores oficiais do Google — marca de terceiro, não vira token. */
function MarcaGoogle() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.25 1.3-1 2.4-2.1 3.1l3.4 2.6c2-1.8 3.1-4.5 3.1-7.7 0-.75-.07-1.5-.2-2.2H12z"
      />
      <path
        fill="#34A853"
        d="M5.8 14.1l-.9.7-2.5 1.9C4.2 20.8 7.9 23 12 23c3 0 5.5-1 7.3-2.7l-3.4-2.6c-.9.6-2.1 1-3.9 1-3 0-5.5-2-6.4-4.7z"
      />
      <path fill="#FBBC05" d="M5.5 9.3 2.9 7.1C1.1 10.4 1.1 14.3 2.9 17.6l2.6-2c-.4-1.2-.4-2.5 0-3.7z" />
      <path
        fill="#4285F4"
        d="M12 5.8c1.7 0 3.2.6 4.4 1.8l3.3-3.3C16.5 2.1 14.4 1 12 1 7.9 1 4.2 3.2 2.9 7.1l2.6 2C6.5 7.4 9.1 5.8 12 5.8z"
      />
    </svg>
  )
}

function IconeCadeado({ tamanho = 17 }: { tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        d="M3.6 7.1h8.8v6.3H3.6zM5.6 7.1V4.9a2.4 2.4 0 0 1 4.8 0v2.2"
      />
    </svg>
  )
}

function IconeRelogio() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        d="M8 4.4V8l2.5 1.6"
      />
    </svg>
  )
}

function IconeAlerta() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 1.4 15.2 14H.8L8 1.4Zm0 4.1a.75.75 0 0 0-.75.75v3a.75.75 0 0 0 1.5 0v-3A.75.75 0 0 0 8 5.5Zm0 5.4a.85.85 0 1 0 0 1.7.85.85 0 0 0 0-1.7Z"
      />
    </svg>
  )
}

/**
 * `currentColor` em vez do vermelho escrito aqui: o disco do botão já define a
 * cor (`.marcaBotao` no módulo CSS), e cor escrita dentro do componente é o que
 * faz uma troca de marca deixar uma peça para trás.
 */
function IconeEspera() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2"
      />
      <path
        d="M8 2a6 6 0 0 1 6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
