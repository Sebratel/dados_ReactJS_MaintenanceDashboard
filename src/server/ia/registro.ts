import { ARQUIVO_IA, gravarJson, lerJson, podeGravar } from '@/server/armazenamento'
import { cifrar, criptoConfigurada, decifrar, mascarar } from './cripto'
import {
  MODELO_SUGERIDO,
  ROTULO_TIPO,
  TIPOS,
  criarProvedor,
  ehTipoValido,
  type ConfigProvedor,
  type TipoProvedor,
} from './provedor'

/**
 * Onde a configuração de IA é guardada e lida: `data/ia.json`, ao lado do
 * `acesso.json`. Mesma metodologia do COM · Gestão Comercial.
 *
 * Um arquivo, uma configuração — o formato não permite duas, o que evita o
 * problema de "usar a primeira que voltar" e mudar de comportamento entre
 * reinícios sem ninguém ter tocado em nada.
 */

/** O que a TELA pode ver. Note que a chave não está aqui. */
export type ConfigIaPublica = {
  configurado: boolean
  tipo: TipoProvedor | null
  modelo: string | null
  baseUrl: string | null
  /** só os quatro últimos caracteres, para conferência */
  chaveMascarada: string | null
  /** `true` quando há chave gravada mas ela não abre com a chave de cifra atual */
  chaveIlegivel: boolean
  atualizadoEm: string | null
  atualizadoPor: string | null
  /** o que falta no servidor para a IA funcionar */
  faltaArmazenamento: boolean
  faltaSegredo: boolean
  tipos: { id: TipoProvedor; rotulo: string; modeloSugerido: string }[]
}

type ArquivoIa = {
  provedor?: string
  modelo?: string
  chaveCifrada?: string
  atualizadoEm?: string
  atualizadoPor?: string
}

const ler = () => lerJson<ArquivoIa>(ARQUIVO_IA(), {})
const gravar = (d: ArquivoIa) => gravarJson(ARQUIVO_IA(), d)

/**
 * A base URL viaja junto do provedor, separada por `|`.
 *
 * Não ganhou campo próprio porque é um detalhe do mesmo ajuste (usar Azure ou
 * OpenRouter em vez da OpenAI), e um campo a mais significaria tratar o arquivo
 * antigo sem ele em toda leitura. O separador é `|` porque não aparece em nome
 * de provedor nem em URL.
 */
function juntar(tipo: string, baseUrl: string | null | undefined): string {
  return baseUrl ? `${tipo}|${baseUrl}` : tipo
}

function separar(bruto: string | null): { tipo: string; baseUrl: string | null } {
  if (!bruto) return { tipo: '', baseUrl: null }
  const i = bruto.indexOf('|')
  if (i < 0) return { tipo: bruto, baseUrl: null }
  return { tipo: bruto.slice(0, i), baseUrl: bruto.slice(i + 1) || null }
}

const CATALOGO = TIPOS.map((id) => ({
  id,
  rotulo: ROTULO_TIPO[id],
  modeloSugerido: MODELO_SUGERIDO[id],
}))

function vazia(extras: Partial<ConfigIaPublica> = {}): ConfigIaPublica {
  return {
    configurado: false,
    tipo: null,
    modelo: null,
    baseUrl: null,
    chaveMascarada: null,
    chaveIlegivel: false,
    atualizadoEm: null,
    atualizadoPor: null,
    faltaArmazenamento: !podeGravar().ok,
    faltaSegredo: !criptoConfigurada(),
    tipos: CATALOGO,
    ...extras,
  }
}

export function lerConfigPublica(): ConfigIaPublica {
  const l = ler()
  if (!l.chaveCifrada || !l.provedor) return vazia()

  const { tipo, baseUrl } = separar(l.provedor)
  const chave = decifrar(l.chaveCifrada)

  return vazia({
    // Configurado só quando a chave ABRE: com ela ilegível, o provedor
    // responderia 401 e o erro apareceria como "a IA parou de funcionar", em vez
    // de "a chave precisa ser cadastrada de novo".
    configurado: chave !== null,
    tipo: ehTipoValido(tipo) ? tipo : null,
    modelo: l.modelo ?? null,
    baseUrl,
    chaveMascarada: chave ? mascarar(chave) : null,
    chaveIlegivel: chave === null,
    atualizadoEm: l.atualizadoEm ?? null,
    atualizadoPor: l.atualizadoPor ?? null,
  })
}

/** A configuração COM a chave. Só para uso interno do servidor. */
export function lerConfigUsavel(): ConfigProvedor | null {
  const l = ler()
  if (!l.chaveCifrada || !l.provedor || !l.modelo) return null

  const { tipo, baseUrl } = separar(l.provedor)
  if (!ehTipoValido(tipo)) return null

  const chave = decifrar(l.chaveCifrada)
  if (!chave) return null

  return { tipo, modelo: l.modelo, chave, baseUrl }
}

export type EntradaConfig = {
  tipo: string
  modelo: string
  /** ausente = manter a chave que já está gravada */
  chave?: string
  baseUrl?: string | null
}

export function salvarConfig(entrada: EntradaConfig, porQuem: string): void {
  if (!ehTipoValido(entrada.tipo)) {
    throw new Error(`Provedor desconhecido: ${entrada.tipo}`)
  }
  if (!entrada.modelo.trim()) {
    throw new Error(`Informe o modelo (ex.: ${MODELO_SUGERIDO[entrada.tipo]}).`)
  }

  /**
   * Salvar sem mandar a chave MANTÉM a que já está lá.
   *
   * É o que permite trocar só o modelo sem digitar a chave de novo — e digitar
   * de novo é o momento em que ela vai parar num gerenciador de senhas do
   * navegador, num histórico de área de transferência, ou num campo de texto que
   * alguém fotografa.
   */
  const atual = ler()
  let cifrada: string
  if (entrada.chave?.trim()) {
    cifrada = cifrar(entrada.chave.trim())
  } else {
    if (!atual.chaveCifrada) throw new Error('Informe a chave do provedor.')
    cifrada = atual.chaveCifrada
  }

  gravar({
    provedor: juntar(entrada.tipo, entrada.baseUrl),
    modelo: entrada.modelo.trim(),
    chaveCifrada: cifrada,
    atualizadoEm: new Date().toISOString(),
    atualizadoPor: porQuem,
  })
}

export function apagarConfig(): void {
  gravar({})
}

/**
 * Lista os modelos que a chave informada enxerga.
 *
 * Aceita a chave direto do formulário — antes de gravar — porque é assim que o
 * administrador confere se ela funciona sem antes salvar algo quebrado. Se a
 * chave não vier, usa a que está gravada.
 */
export async function listarModelos(entrada: {
  tipo: string
  chave?: string
  baseUrl?: string | null
}): Promise<{ id: string; label: string }[]> {
  if (!ehTipoValido(entrada.tipo)) throw new Error(`Provedor desconhecido: ${entrada.tipo}`)

  let chave = entrada.chave?.trim()
  if (!chave) {
    const atual = lerConfigUsavel()
    if (!atual || atual.tipo !== entrada.tipo) {
      throw new Error('Informe a chave do provedor para listar os modelos.')
    }
    chave = atual.chave
  }

  return criarProvedor({
    tipo: entrada.tipo,
    modelo: '',
    chave,
    baseUrl: entrada.baseUrl ?? null,
  }).modelos()
}
