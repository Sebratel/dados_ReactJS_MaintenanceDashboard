'use client'

import type { User } from 'firebase/auth'
import { authAtual } from './firebaseCliente'

/**
 * O ÚNICO cliente HTTP das telas.
 *
 * POR QUE UM SÓ: um `fetch` cru esquecido em algum botão manda a requisição sem
 * passar por aqui e toma 401 em silêncio — a ação não acontece, nada aparece na
 * tela, e como o cache do front recarrega de todo jeito parece ter funcionado.
 * Toda chamada de dados passa por `buscarJson`.
 *
 * O cookie de sessão viaja sozinho (é HttpOnly, o navegador anexa). O trabalho
 * desta função é o outro lado: decidir o que fazer quando o servidor responde
 * 401.
 */

/** Grava o token atual no cookie de sessão do servidor. */
export async function gravarSessao(user: User, forcarRenovacao = false): Promise<boolean> {
  const idToken = await user.getIdToken(forcarRenovacao)
  const r = await fetch('/api/auth/sessao', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken }),
  })
  return r.ok
}

/**
 * Encerra a sessão e manda para o login dizendo por quê.
 *
 * A tela de login PRECISA do motivo. Sem ele, quem estava no meio de uma
 * conferência é devolvido a um formulário sem explicação e conclui que o
 * dashboard quebrou — em vez de ler "sua sessão expirou, entre de novo".
 */
export async function encerrarSessao(motivo: 'expirada' | 'saiu'): Promise<void> {
  try {
    await fetch('/api/auth/sessao', { method: 'DELETE' })
  } catch {
    // o cookie pode não ter sido apagado, mas a saída não pode ficar presa
  }
  try {
    await authAtual()?.signOut()
  } catch {
    // idem: o SDK pode falhar offline; o cookie já foi
  }

  const destino =
    motivo === 'expirada'
      ? `/login?motivo=expirada&destino=${encodeURIComponent(location.pathname + location.search)}`
      : '/login?motivo=saiu'
  location.assign(destino)
}

/**
 * Uma renovação em andamento é compartilhada por todas as chamadas que tomaram
 * 401 ao mesmo tempo. Sem isto, uma tela com seis indicadores dispararia seis
 * renovações simultâneas do mesmo token no primeiro 401.
 */
let renovacaoEmVoo: Promise<boolean> | null = null

function renovarSessao(): Promise<boolean> {
  renovacaoEmVoo ??= (async () => {
    const user = authAtual()?.currentUser
    if (!user) return false
    // `true` força ir ao Google buscar token novo em vez de devolver o de
    // memória — que é justamente o que acabou de ser recusado.
    return await gravarSessao(user, true)
  })()
    .catch(() => false)
    .finally(() => {
      renovacaoEmVoo = null
    })

  return renovacaoEmVoo
}

export class ErroHttp extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'ErroHttp'
  }
}

/**
 * `fetch` de dados com a regra que custou caro no Data Hub:
 * **falha ao renovar NÃO é logout.**
 *
 * O erro original era `try { renovar() } catch { logout() }`. Com o Google
 * inalcançável, isso jogava a pessoa numa tela de login que, pelo mesmo
 * bloqueio, não conseguia logar: sessão válida virava beco sem saída.
 *
 * Aqui quem encerra a sessão é **um 401 que PERSISTE depois da tentativa de
 * renovação**. Se a renovação falhar por rede, o erro sobe como qualquer outro
 * e a tela mostra o estado de erro — com o botão de tentar de novo, e com a
 * sessão intacta para quando a rede voltar.
 */
export async function buscarJson<T>(url: string, init?: RequestInit): Promise<T> {
  let r = await fetch(url, init)

  if (r.status === 401) {
    const renovou = await renovarSessao()
    if (!renovou) {
      // Não conseguimos nem tentar (sem usuário no SDK) ou a renovação falhou:
      // se não há usuário, a sessão realmente acabou; se falhou por rede, o
      // erro abaixo é honesto e não derruba ninguém.
      if (!authAtual()?.currentUser) {
        await encerrarSessao('expirada')
        throw new ErroHttp('sessão expirada', 401)
      }
      throw new ErroHttp('não foi possível renovar a sessão agora', 401)
    }

    r = await fetch(url, init)
    if (r.status === 401) {
      // Token novo em folha e o servidor continua recusando: acabou mesmo.
      await encerrarSessao('expirada')
      throw new ErroHttp('sessão expirada', 401)
    }
  }

  if (!r.ok) {
    const corpo = (await r.json().catch(() => null)) as { erro?: string } | null
    throw new ErroHttp(corpo?.erro ?? `falha na requisição (HTTP ${r.status})`, r.status)
  }

  return r.json() as Promise<T>
}
