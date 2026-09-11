'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { onIdTokenChanged } from 'firebase/auth'
import { obterAuth, type ConfigFirebase } from '@/lib/firebaseCliente'
import { gravarSessao } from '@/lib/clienteHttp'

export type Usuario = { email: string; nome: string | null; foto: string | null }

const ContextoSessao = createContext<Usuario | null>(null)

/** Quem está logado, para o cabeçalho. `null` enquanto o SDK não respondeu. */
export function useUsuario(): Usuario | null {
  return useContext(ContextoSessao)
}

/**
 * Mantém o cookie de sessão em dia com o token do Firebase.
 *
 * O SDK renova o ID token sozinho pouco antes de 1 h de vida e dispara
 * `onIdTokenChanged`. Este componente escuta esse evento e reposta o token novo
 * para o servidor, que regrava o cookie. É isso que faz a pessoa passar o dia
 * no dashboard sem ser mandada de volta para o login no meio de uma conferência.
 *
 * ⚠️ O QUE ELE NÃO FAZ, DE PROPÓSITO: redirecionar. Nenhuma falha aqui encerra
 * sessão. Se a gravação do cookie falhar por rede, o cookie atual continua
 * valendo até vencer de verdade, e quem decide que a sessão acabou é o 401 que
 * persiste depois de uma tentativa de renovação (ver `lib/clienteHttp.ts`).
 * Tratar falha de renovação como logout foi o erro que, no Data Hub, jogava a
 * pessoa numa tela de login que o mesmo bloqueio de rede impedia de funcionar.
 */
export function SessaoFirebase({
  config,
  children,
}: {
  config: ConfigFirebase | null
  children: React.ReactNode
}) {
  const [usuario, setUsuario] = useState<Usuario | null>(null)

  useEffect(() => {
    if (!config) return

    const auth = obterAuth(config)
    return onIdTokenChanged(auth, (user) => {
      if (!user) {
        setUsuario(null)
        return
      }

      setUsuario({
        email: user.email ?? '',
        nome: user.displayName,
        foto: user.photoURL,
      })

      // Sem `await`: o cookie atual ainda serve, e segurar a renderização por
      // causa de uma gravação de cookie deixaria a tela em branco à toa.
      void gravarSessao(user).catch(() => {
        // silencioso por desenho — ver o aviso no cabeçalho deste componente
      })
    })
  }, [config])

  return <ContextoSessao.Provider value={usuario}>{children}</ContextoSessao.Provider>
}
