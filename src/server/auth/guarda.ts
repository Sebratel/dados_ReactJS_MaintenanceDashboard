import { NextResponse } from 'next/server'
import { TELAS_POR_INDICADOR, type IdTela } from '@/config/telas'
import { resolverAcesso, type Acesso } from './acesso'

/**
 * A guarda das rotas de API.
 *
 * POR QUE EXISTE, em uma frase: esconder a TELA sem fechar o ENDPOINT não
 * esconde nada. Quem souber o endereço lê `/api/indicadores/produtividade`
 * direto e recebe o desempenho nominal que a matriz dizia ter escondido — e o
 * vazamento não deixa rastro de erro em lugar nenhum, porque do ponto de vista
 * do servidor foi um request bem-sucedido.
 *
 * O e-mail vem do cabeçalho `x-usuario-email`, que o middleware escreve DEPOIS
 * de apagar o que veio de fora. Sem aquela limpeza, esta função seria puro
 * teatro: bastaria mandar o cabeçalho na mão.
 */

export type Autorizado = { ok: true; acesso: Acesso }
export type Negado = { ok: false; resposta: NextResponse }

function semIdentidade(): Negado {
  // Não deveria acontecer: o middleware barra antes. Se acontecer, é sinal de
  // rota fora do matcher — e aí o certo é recusar, não adivinhar quem é.
  return {
    ok: false,
    resposta: NextResponse.json(
      { erro: 'sessão inválida ou expirada', motivo: 'sem-identidade' },
      { status: 401, headers: { 'cache-control': 'no-store' } }
    ),
  }
}

function negar(motivo: string): Negado {
  return {
    ok: false,
    resposta: NextResponse.json(
      { erro: 'você não tem acesso a este conteúdo', motivo },
      { status: 403, headers: { 'cache-control': 'no-store' } }
    ),
  }
}

/** Só confirma a identidade e devolve o acesso resolvido. */
export async function exigirSessao(req: Request): Promise<Autorizado | Negado> {
  const email = req.headers.get('x-usuario-email')
  if (!email) return semIdentidade()
  return { ok: true, acesso: await resolverAcesso(email) }
}

/**
 * Exige acesso a PELO MENOS UMA das telas que consomem o indicador.
 *
 * Os genéricos (kpis, série, ranking…) alimentam várias telas, e mais fino que
 * isso exigiria o cliente declarar de que tela está falando — dado que o cliente
 * declara, o cliente falsifica. O que importa está garantido: `produtividade`,
 * `ofensores`, `recorrencia` e `preventivos` têm uma tela só cada, então
 * restringir a tela restringe o dado de verdade.
 */
export async function exigirIndicador(
  req: Request,
  slug: string
): Promise<Autorizado | Negado> {
  const r = await exigirSessao(req)
  if (!r.ok) return r

  const necessarias = TELAS_POR_INDICADOR[slug]
  // Indicador que ninguém mapeou é indicador novo: recusar é o padrão seguro, e
  // o erro aparece no primeiro teste em vez de virar um endereço aberto.
  if (!necessarias?.length) return negar('indicador-sem-mapa')

  const podeAlguma = necessarias.some((t) => r.acesso.telas.has(t))
  return podeAlguma ? r : negar('sem-acesso-a-tela')
}

/** Exige acesso a uma tela específica. */
export async function exigirTela(req: Request, tela: IdTela): Promise<Autorizado | Negado> {
  const r = await exigirSessao(req)
  if (!r.ok) return r
  return r.acesso.telas.has(tela) ? r : negar('sem-acesso-a-tela')
}

/** Exige papel de administrador — as rotas de configuração. */
export async function exigirAdmin(req: Request): Promise<Autorizado | Negado> {
  const r = await exigirSessao(req)
  if (!r.ok) return r
  return r.acesso.papel === 'admin' ? r : negar('precisa-ser-admin')
}
