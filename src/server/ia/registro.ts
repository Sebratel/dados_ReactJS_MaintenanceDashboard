import { consultarDash, dashConfigurado, garantirEsquema } from '@/server/db/dash'
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
 * Onde a configuração de IA é guardada e lida.
 *
 * Uma linha só, na tabela `dash.config_ia` (o CHECK `id = 1` garante isso — ver
 * o esquema em `db/dash.ts`). Duas configurações de IA fariam o sistema usar "a
 * primeira que voltar", que muda sem aviso entre reinícios.
 */

/** O que a TELA pode ver. Note que a chave não está aqui. */
export type ConfigIaPublica = {
  configurado: boolean
  tipo: TipoProvedor | null
  modelo: string | null
  baseUrl: string | null
  /** só os quatro últimos caracteres, para conferência */
  chaveMascarada: string | null
  /** `true` quando há chave gravada mas ela não abre com o APP_SECRET atual */
  chaveIlegivel: boolean
  atualizadoEm: string | null
  atualizadoPor: string | null
  /** o que falta no servidor para a IA funcionar */
  faltaBanco: boolean
  faltaSegredo: boolean
  tipos: { id: TipoProvedor; rotulo: string; modeloSugerido: string }[]
}

type LinhaIa = {
  provedor: string | null
  modelo: string | null
  chave_cifrada: string | null
  atualizado_em: Date | string | null
  atualizado_por: string | null
}

/**
 * A base URL viaja junto do provedor, separada por `|`.
 *
 * Não ganhou coluna própria porque é um detalhe do mesmo ajuste (usar Azure ou
 * OpenRouter em vez da OpenAI), e uma coluna a mais numa tabela de linha única
 * seria uma migração para guardar o que cabe aqui. O separador é `|` porque não
 * aparece em nome de provedor nem em URL.
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
    faltaBanco: !dashConfigurado(),
    faltaSegredo: !criptoConfigurada(),
    tipos: CATALOGO,
    ...extras,
  }
}

export async function lerConfigPublica(): Promise<ConfigIaPublica> {
  if (!dashConfigurado()) return vazia()

  await garantirEsquema()
  const linhas = await consultarDash<LinhaIa>(
    'SELECT provedor, modelo, chave_cifrada, atualizado_em, atualizado_por FROM dash.config_ia WHERE id = 1'
  )
  const l = linhas[0]
  if (!l?.chave_cifrada || !l.provedor) return vazia()

  const { tipo, baseUrl } = separar(l.provedor)
  const chave = decifrar(l.chave_cifrada)

  return vazia({
    // Configurado só quando a chave ABRE: com ela ilegível, o provedor
    // responderia 401 e o erro apareceria como "a IA parou de funcionar", em vez
    // de "a chave precisa ser cadastrada de novo".
    configurado: chave !== null,
    tipo: ehTipoValido(tipo) ? tipo : null,
    modelo: l.modelo,
    baseUrl,
    chaveMascarada: chave ? mascarar(chave) : null,
    chaveIlegivel: chave === null,
    atualizadoEm:
      l.atualizado_em instanceof Date
        ? l.atualizado_em.toISOString()
        : (l.atualizado_em ?? null),
    atualizadoPor: l.atualizado_por,
  })
}

/** A configuração COM a chave. Só para uso interno do servidor. */
export async function lerConfigUsavel(): Promise<ConfigProvedor | null> {
  if (!dashConfigurado()) return null

  await garantirEsquema()
  const linhas = await consultarDash<LinhaIa>(
    'SELECT provedor, modelo, chave_cifrada FROM dash.config_ia WHERE id = 1'
  )
  const l = linhas[0]
  if (!l?.chave_cifrada || !l.provedor || !l.modelo) return null

  const { tipo, baseUrl } = separar(l.provedor)
  if (!ehTipoValido(tipo)) return null

  const chave = decifrar(l.chave_cifrada)
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

export async function salvarConfig(
  entrada: EntradaConfig,
  porQuem: string
): Promise<void> {
  if (!ehTipoValido(entrada.tipo)) {
    throw new Error(`Provedor desconhecido: ${entrada.tipo}`)
  }
  if (!entrada.modelo.trim()) {
    throw new Error(`Informe o modelo (ex.: ${MODELO_SUGERIDO[entrada.tipo]}).`)
  }

  await garantirEsquema()

  /**
   * Salvar sem mandar a chave MANTÉM a que já está lá.
   *
   * É o que permite trocar só o modelo sem digitar a chave de novo — e digitar
   * de novo é o momento em que ela vai parar num gerenciador de senhas do
   * navegador, num histórico de área de transferência, ou num campo de texto que
   * alguém fotografa.
   */
  let cifrada: string
  if (entrada.chave?.trim()) {
    cifrada = cifrar(entrada.chave.trim())
  } else {
    const atual = await consultarDash<{ chave_cifrada: string | null }>(
      'SELECT chave_cifrada FROM dash.config_ia WHERE id = 1'
    )
    const anterior = atual[0]?.chave_cifrada
    if (!anterior) throw new Error('Informe a chave do provedor.')
    cifrada = anterior
  }

  await consultarDash(
    `INSERT INTO dash.config_ia (id, provedor, modelo, chave_cifrada, atualizado_em, atualizado_por)
     VALUES (1, $1, $2, $3, now(), $4)
     ON CONFLICT (id) DO UPDATE
       SET provedor = EXCLUDED.provedor,
           modelo = EXCLUDED.modelo,
           chave_cifrada = EXCLUDED.chave_cifrada,
           atualizado_em = now(),
           atualizado_por = EXCLUDED.atualizado_por`,
    [juntar(entrada.tipo, entrada.baseUrl), entrada.modelo.trim(), cifrada, porQuem]
  )
}

export async function apagarConfig(): Promise<void> {
  await garantirEsquema()
  await consultarDash('DELETE FROM dash.config_ia WHERE id = 1')
}

/**
 * Lista os modelos que a chave informada enxerga.
 *
 * Aceita a chave direto do formulário — antes de gravar — porque é assim que o
 * administrador confere se ela funciona sem antes salvar algo quebrado. Se a
 * chave não vier, usa a que está no banco.
 */
export async function listarModelos(entrada: {
  tipo: string
  chave?: string
  baseUrl?: string | null
}): Promise<{ id: string; label: string }[]> {
  if (!ehTipoValido(entrada.tipo)) throw new Error(`Provedor desconhecido: ${entrada.tipo}`)

  let chave = entrada.chave?.trim()
  if (!chave) {
    const atual = await lerConfigUsavel()
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
