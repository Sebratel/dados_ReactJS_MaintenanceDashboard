import { TELAS, type IdTela, type Papel } from '@/config/telas'
import { ARQUIVO_ACESSO, gravarJson, lerJson, podeGravar } from '@/server/armazenamento'

export type { Papel }

/**
 * Quem pode ver o quê.
 *
 * A AUTENTICAÇÃO (é mesmo essa pessoa?) fica no middleware, no runtime Edge. A
 * AUTORIZAÇÃO (essa pessoa pode ver esta tela?) fica aqui, no runtime Node — e a
 * separação é imposta, não escolhida: o Edge não tem sistema de arquivos.
 *
 * ⚠️ NÃO HÁ CADASTRO DE LOGIN. Quem diz QUEM a pessoa é continua sendo o Google,
 * via Firebase. Este módulo nunca vê senha, nunca cria conta e nunca convida
 * ninguém: ele decide o que um e-mail JÁ AUTENTICADO alcança. Quem não está em
 * lista nenhuma entra assim mesmo, como `viewer`, desde que tenha conta do
 * domínio autorizado.
 *
 * Mesma metodologia do COM · Gestão Comercial: um JSON no diretório de dados,
 * e o papel efetivo é o MAIOR entre o ambiente e o arquivo.
 */

export type Acesso = {
  email: string
  papel: Papel
  /** Telas que esta pessoa pode abrir. */
  telas: Set<IdTela>
  /**
   * De onde veio o papel de admin. A tela usa isto para explicar por que um
   * administrador do ambiente não pode ser rebaixado pela interface.
   */
  origemAdmin: 'ambiente' | 'arquivo' | null
  /** `false` quando o diretório de dados não está gravável: tudo liberado. */
  controleAtivo: boolean
}

type TelaGravada = {
  modo: 'todos' | 'lista'
  emails: string[]
  atualizadoEm?: string
  atualizadoPor?: string
}

type ArquivoAcesso = {
  papeis: Record<string, string>
  telas: Record<string, TelaGravada>
}

const VAZIO: ArquivoAcesso = { papeis: {}, telas: {} }

const TODAS_AS_TELAS = new Set<IdTela>(TELAS.map((t) => t.id))

const normalizar = (e: string) => e.trim().toLowerCase()

/**
 * Administradores definidos no AMBIENTE, que o arquivo não pode revogar.
 *
 * É a saída para o problema do ovo e da galinha: sem ninguém admin, ninguém abre
 * Configurações, e sem Configurações ninguém vira admin. Também é a porta de
 * emergência quando alguém se rebaixa por engano — a correção é uma variável e
 * um restart, não editar JSON dentro do container às pressas.
 */
export function adminsDoAmbiente(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? '')
      .split(/[,;\s]+/)
      .map(normalizar)
      .filter(Boolean)
  )
}

/**
 * Lê o arquivo inteiro, saneando o que vier.
 *
 * O conteúdo é editável à mão (é um JSON num volume), então nada aqui confia no
 * formato: papel desconhecido vira `viewer`, tela fora do catálogo é ignorada, e
 * campo com tipo errado não derruba a leitura. Um arquivo editado errado deixa o
 * acesso mais permissivo e visível, nunca o dashboard inacessível.
 */
function ler(): ArquivoAcesso {
  const bruto = lerJson<Partial<ArquivoAcesso>>(ARQUIVO_ACESSO(), VAZIO)

  const papeis: Record<string, string> = {}
  for (const [email, papel] of Object.entries(bruto.papeis ?? {})) {
    if (typeof papel === 'string') papeis[normalizar(email)] = papel === 'admin' ? 'admin' : 'viewer'
  }

  const telas: Record<string, TelaGravada> = {}
  for (const [id, valor] of Object.entries(bruto.telas ?? {})) {
    if (!TODAS_AS_TELAS.has(id as IdTela) || !valor) continue
    telas[id] = {
      modo: valor.modo === 'lista' ? 'lista' : 'todos',
      emails: Array.isArray(valor.emails) ? valor.emails.map(normalizar).filter(Boolean) : [],
      atualizadoEm: valor.atualizadoEm,
      atualizadoPor: valor.atualizadoPor,
    }
  }

  return { papeis, telas }
}

function gravar(dados: ArquivoAcesso): void {
  gravarJson(ARQUIVO_ACESSO(), dados)
}

/**
 * Resolve o acesso de uma pessoa.
 *
 * Nunca lança: se o diretório de dados não estiver gravável, devolve acesso
 * total com `controleAtivo: false`. É degradação deliberada — trancar todo mundo
 * fora porque o VOLUME não montou transformaria um problema de infraestrutura
 * acessória em queda total de um dashboard cujo dado nem vem dali. A barreira
 * que importa (autenticação) segue de pé, e a degradação aparece em letras
 * grandes na tela de Configurações e no menu do usuário.
 */
export function resolverAcesso(email: string): Acesso {
  const normalizado = normalizar(email)
  const ehAdminPorAmbiente = adminsDoAmbiente().has(normalizado)
  const gravavel = podeGravar()

  if (!gravavel.ok) {
    console.warn(`[acesso] controle inativo — ${gravavel.motivo}`)
    return {
      email: normalizado,
      papel: ehAdminPorAmbiente ? 'admin' : 'viewer',
      telas: new Set(TODAS_AS_TELAS),
      origemAdmin: ehAdminPorAmbiente ? 'ambiente' : null,
      controleAtivo: false,
    }
  }

  const dados = ler()
  const papel: Papel =
    ehAdminPorAmbiente || dados.papeis[normalizado] === 'admin' ? 'admin' : 'viewer'

  // Administrador vê tudo, sempre. Deixá-lo fora de uma tela produziria o
  // absurdo de alguém que pode EDITAR a matriz e não pode ver o resultado da
  // própria edição.
  if (papel === 'admin') {
    return {
      email: normalizado,
      papel,
      telas: new Set(TODAS_AS_TELAS),
      origemAdmin: ehAdminPorAmbiente ? 'ambiente' : 'arquivo',
      controleAtivo: true,
    }
  }

  const telas = new Set<IdTela>()
  for (const t of TELAS) {
    // Tela sem entrada = 'todos'. O padrão preserva o comportamento anterior ao
    // controle de acesso: ligar a funcionalidade não escurece o dashboard de
    // ninguém sem alguém ter decidido isso.
    const gravada = dados.telas[t.id]
    if (!gravada || gravada.modo === 'todos' || gravada.emails.includes(normalizado)) {
      telas.add(t.id)
    }
  }

  return { email: normalizado, papel, telas, origemAdmin: null, controleAtivo: true }
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

export function listarUsuarios(): UsuarioConfig[] {
  const doAmbiente = adminsDoAmbiente()
  const dados = ler()

  const porEmail = new Map<string, UsuarioConfig>()
  for (const [email, papel] of Object.entries(dados.papeis)) {
    porEmail.set(email, {
      email,
      papel: papel === 'admin' ? 'admin' : 'viewer',
      nome: null,
      fixo: doAmbiente.has(email),
    })
  }

  // Quem é admin pelo ambiente aparece na lista mesmo sem entrada no arquivo —
  // senão a tela mostraria "nenhum administrador" num sistema que tem um.
  for (const email of doAmbiente) {
    const atual = porEmail.get(email)
    if (atual) atual.papel = 'admin'
    else porEmail.set(email, { email, papel: 'admin', nome: null, fixo: true })
  }

  return [...porEmail.values()].sort((a, b) => a.email.localeCompare(b.email))
}

export function salvarUsuario(email: string, papel: Papel, porQuem: string): void {
  const dados = ler()
  dados.papeis[normalizar(email)] = papel
  void porQuem // a autoria fica por tela; no papel, o log do servidor já registra
  gravar(dados)
}

export function removerUsuario(email: string): void {
  const alvo = normalizar(email)
  const dados = ler()
  delete dados.papeis[alvo]

  // A pessoa sai também das listas de tela: deixar o e-mail pendurado ali faria
  // um futuro homônimo herdar acesso que ninguém lhe deu.
  for (const tela of Object.values(dados.telas)) {
    tela.emails = tela.emails.filter((e) => e !== alvo)
  }

  gravar(dados)
}

export type MatrizTela = { tela: IdTela; modo: 'todos' | 'lista'; emails: string[] }

export function lerMatriz(): MatrizTela[] {
  const dados = ler()
  return TELAS.map((t) => {
    const gravada = dados.telas[t.id]
    return {
      tela: t.id,
      modo: gravada?.modo === 'lista' ? ('lista' as const) : ('todos' as const),
      emails: [...(gravada?.emails ?? [])].sort(),
    }
  })
}

export function salvarTela(
  tela: IdTela,
  modo: 'todos' | 'lista',
  emails: string[],
  porQuem: string
): void {
  const dados = ler()
  /**
   * A lista é substituída inteira. A tela manda o conjunto final, não um diff —
   * diff exigiria que cliente e servidor concordassem sobre o estado anterior, e
   * eles não concordam quando duas pessoas editam ao mesmo tempo. Substituir é
   * idempotente, e o pior caso é a última gravação vencer, que é o que a tela
   * promete ao mostrar "Salvar".
   */
  dados.telas[tela] = {
    modo,
    emails: [...new Set(emails.map(normalizar).filter(Boolean))],
    atualizadoEm: new Date().toISOString(),
    atualizadoPor: porQuem,
  }
  gravar(dados)
}
