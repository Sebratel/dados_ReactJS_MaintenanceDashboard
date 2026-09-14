import { TELAS, type IdTela, type Papel } from '@/config/telas'
import { consultarDash, dashConfigurado, garantirEsquema } from '@/server/db/dash'

export type { Papel }

/**
 * Quem pode ver o quê.
 *
 * A AUTENTICAÇÃO (é mesmo essa pessoa?) fica no middleware, no runtime Edge. A
 * AUTORIZAÇÃO (essa pessoa pode ver esta tela?) fica aqui, no runtime Node, e a
 * razão é dura: o Edge não fala com Postgres. Não é uma divisão elegante
 * escolhida no quadro branco — é a única possível mantendo o middleware como
 * portão único de entrada.
 *
 * Consequência prática, que precisa continuar verdadeira: o middleware garante
 * que TODA requisição tem sessão válida; este módulo decide o que ela alcança.
 * Se alguém um dia mover a autenticação para cá, o buraco não aparece na tela —
 * aparece numa rota nova que esqueceu de chamar a checagem.
 */

export type Acesso = {
  email: string
  papel: Papel
  /** Telas que esta pessoa pode abrir. */
  telas: Set<IdTela>
  /**
   * De onde veio o papel. A tela de Configurações usa isto para explicar por que
   * um administrador não pode ser rebaixado pela interface.
   */
  origemAdmin: 'ambiente' | 'banco' | null
  /** `false` quando não há banco da aplicação: tudo liberado, como antes. */
  controleAtivo: boolean
}

/** Executor de SQL. Existe para o teste injetar um Postgres de verdade. */
export type Executor = <T extends Record<string, unknown>>(
  sql: string,
  params?: readonly unknown[]
) => Promise<T[]>

const executorPadrao: Executor = async (sql, params) => {
  await garantirEsquema()
  return consultarDash(sql, params) as never
}

const TODAS_AS_TELAS = new Set<IdTela>(TELAS.map((t) => t.id))

/**
 * Administradores definidos no AMBIENTE, que o banco não pode revogar.
 *
 * É a saída para o problema do ovo e da galinha: sem ninguém admin, ninguém abre
 * Configurações, e sem Configurações ninguém vira admin. Também é a porta de
 * emergência quando alguém se rebaixa por engano — a correção é uma variável de
 * ambiente e um restart, não um `UPDATE` manual no banco às pressas.
 */
export function adminsDoAmbiente(): Set<string> {
  const bruto = process.env.ADMIN_EMAILS ?? ''
  return new Set(
    bruto
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  )
}

type LinhaUsuario = { email: string; papel: string; nome: string | null }
type LinhaTela = { tela: string; modo: string }
type LinhaPessoa = { tela: string; email: string }

/**
 * Resolve o acesso de uma pessoa.
 *
 * Nunca lança: se o banco da aplicação estiver fora, devolve acesso total com
 * `controleAtivo: false`. Isso é deliberado e vale a discussão — a alternativa
 * seria trancar todo mundo fora quando o banco de CONFIGURAÇÃO cai, ou seja,
 * transformar uma indisponibilidade de recurso acessório em queda total de um
 * dashboard cujo dado nem vem dali. A barreira que importa (autenticação) segue
 * de pé, e a degradação fica visível no cabeçalho da tela de Configurações.
 */
export async function resolverAcesso(email: string, exec: Executor = executorPadrao): Promise<Acesso> {
  const normalizado = email.trim().toLowerCase()
  const ehAdminPorAmbiente = adminsDoAmbiente().has(normalizado)

  if (!dashConfigurado()) {
    return {
      email: normalizado,
      papel: ehAdminPorAmbiente ? 'admin' : 'viewer',
      telas: new Set(TODAS_AS_TELAS),
      origemAdmin: ehAdminPorAmbiente ? 'ambiente' : null,
      controleAtivo: false,
    }
  }

  try {
    const usuarios = await exec<LinhaUsuario>(
      'SELECT email, papel, nome FROM dash.usuarios WHERE email = $1',
      [normalizado]
    )
    const papelBanco = usuarios[0]?.papel === 'admin' ? 'admin' : 'viewer'
    const papel: Papel = ehAdminPorAmbiente ? 'admin' : papelBanco

    // Administrador vê tudo, sempre. Deixá-lo fora de uma tela produziria o
    // absurdo de alguém que pode EDITAR a matriz de acesso e não pode ver o
    // resultado da própria edição.
    if (papel === 'admin') {
      return {
        email: normalizado,
        papel,
        telas: new Set(TODAS_AS_TELAS),
        origemAdmin: ehAdminPorAmbiente ? 'ambiente' : 'banco',
        controleAtivo: true,
      }
    }

    const [modos, pessoas] = await Promise.all([
      exec<LinhaTela>('SELECT tela, modo FROM dash.acesso_telas', []),
      exec<LinhaPessoa>('SELECT tela, email FROM dash.acesso_tela_pessoas WHERE email = $1', [
        normalizado,
      ]),
    ])

    const modoPorTela = new Map(modos.map((m) => [m.tela, m.modo]))
    const minhasTelas = new Set(pessoas.map((p) => p.tela))

    const telas = new Set<IdTela>()
    for (const t of TELAS) {
      // Tela sem linha = 'todos'. O padrão preserva o comportamento anterior ao
      // controle de acesso: ligar a funcionalidade não escurece o dashboard de
      // ninguém sem alguém ter decidido isso.
      const modo = modoPorTela.get(t.id) ?? 'todos'
      if (modo === 'todos' || minhasTelas.has(t.id)) telas.add(t.id)
    }

    return { email: normalizado, papel, telas, origemAdmin: null, controleAtivo: true }
  } catch (e) {
    console.error(
      '[acesso] banco da aplicação indisponível, liberando as telas:',
      e instanceof Error ? e.message : String(e)
    )
    return {
      email: normalizado,
      papel: ehAdminPorAmbiente ? 'admin' : 'viewer',
      telas: new Set(TODAS_AS_TELAS),
      origemAdmin: ehAdminPorAmbiente ? 'ambiente' : null,
      controleAtivo: false,
    }
  }
}

/* ──────────────────────────────────────────────────────────────────────
   Leitura e escrita da configuração — usadas pela tela de Configurações.
   ────────────────────────────────────────────────────────────────────── */

export type UsuarioConfig = {
  email: string
  papel: Papel
  nome: string | null
  /** admin pelo ambiente: a interface mostra, mas não deixa rebaixar */
  fixo: boolean
}

export async function listarUsuarios(exec: Executor = executorPadrao): Promise<UsuarioConfig[]> {
  const doAmbiente = adminsDoAmbiente()
  const linhas = await exec<LinhaUsuario>(
    'SELECT email, papel, nome FROM dash.usuarios ORDER BY email',
    []
  )

  const porEmail = new Map<string, UsuarioConfig>()
  for (const l of linhas) {
    porEmail.set(l.email, {
      email: l.email,
      papel: l.papel === 'admin' ? 'admin' : 'viewer',
      nome: l.nome,
      fixo: doAmbiente.has(l.email),
    })
  }

  // Quem é admin pelo ambiente aparece na lista mesmo sem linha no banco —
  // senão a tela mostraria "nenhum administrador" num sistema que tem um.
  for (const email of doAmbiente) {
    const atual = porEmail.get(email)
    if (atual) atual.papel = 'admin'
    else porEmail.set(email, { email, papel: 'admin', nome: null, fixo: true })
  }

  return [...porEmail.values()].sort((a, b) => a.email.localeCompare(b.email))
}

export async function salvarUsuario(
  email: string,
  papel: Papel,
  porQuem: string,
  exec: Executor = executorPadrao
): Promise<void> {
  const normalizado = email.trim().toLowerCase()
  await exec(
    `INSERT INTO dash.usuarios (email, papel, atualizado_em, atualizado_por)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (email) DO UPDATE
       SET papel = EXCLUDED.papel,
           atualizado_em = now(),
           atualizado_por = EXCLUDED.atualizado_por`,
    [normalizado, papel, porQuem]
  )
}

export async function removerUsuario(
  email: string,
  exec: Executor = executorPadrao
): Promise<void> {
  const normalizado = email.trim().toLowerCase()
  await exec('DELETE FROM dash.usuarios WHERE email = $1', [normalizado])
  // A pessoa sai também das listas de tela: deixar o e-mail pendurado ali faria
  // um futuro homônimo herdar acesso que ninguém lhe deu.
  await exec('DELETE FROM dash.acesso_tela_pessoas WHERE email = $1', [normalizado])
}

export type MatrizTela = { tela: IdTela; modo: 'todos' | 'lista'; emails: string[] }

export async function lerMatriz(exec: Executor = executorPadrao): Promise<MatrizTela[]> {
  const [modos, pessoas] = await Promise.all([
    exec<LinhaTela>('SELECT tela, modo FROM dash.acesso_telas', []),
    exec<LinhaPessoa>('SELECT tela, email FROM dash.acesso_tela_pessoas ORDER BY email', []),
  ])

  const modoPorTela = new Map(modos.map((m) => [m.tela, m.modo]))
  const porTela = new Map<string, string[]>()
  for (const p of pessoas) {
    const lista = porTela.get(p.tela) ?? []
    lista.push(p.email)
    porTela.set(p.tela, lista)
  }

  return TELAS.map((t) => ({
    tela: t.id,
    modo: modoPorTela.get(t.id) === 'lista' ? ('lista' as const) : ('todos' as const),
    emails: porTela.get(t.id) ?? [],
  }))
}

export async function salvarTela(
  tela: IdTela,
  modo: 'todos' | 'lista',
  emails: string[],
  porQuem: string,
  exec: Executor = executorPadrao
): Promise<void> {
  await exec(
    `INSERT INTO dash.acesso_telas (tela, modo, atualizado_em, atualizado_por)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (tela) DO UPDATE
       SET modo = EXCLUDED.modo,
           atualizado_em = now(),
           atualizado_por = EXCLUDED.atualizado_por`,
    [tela, modo, porQuem]
  )

  /**
   * A lista é substituída inteira, e nesta ORDEM: apaga tudo, insere o que veio.
   *
   * A tela manda o conjunto final, não um diff — diff exigiria que cliente e
   * servidor concordassem sobre o estado anterior, e eles não concordam quando
   * duas pessoas editam ao mesmo tempo. Substituir é idempotente e o pior caso é
   * a última gravação vencer, que é o que a tela promete ao mostrar "Salvar".
   */
  await exec('DELETE FROM dash.acesso_tela_pessoas WHERE tela = $1', [tela])

  const limpos = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))]
  for (const email of limpos) {
    await exec(
      'INSERT INTO dash.acesso_tela_pessoas (tela, email) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [tela, email]
    )
  }
}
