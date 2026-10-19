import type { LinhaProtocolo } from '@/server/indicadores/protocolos'
import { fmtDataHora, fmtHoras } from './formato'

/**
 * Catálogo de colunas do relatório analítico.
 *
 * Vive fora do componente porque é usado nos DOIS lados: a tabela na tela e o
 * CSV gerado no servidor. Duplicar a lista faria a exportação divergir da tela
 * exatamente quando alguém acrescentasse uma coluna — e o CSV é a evidência que
 * a auditoria arquiva.
 */

export type ChaveProtocolo = keyof LinhaProtocolo

export type DefColuna = {
  chave: ChaveProtocolo
  rotulo: string
  /** números e datas alinham à direita, para o olho comparar dígito a dígito */
  alinhar?: 'esq' | 'dir'
  /** largura mínima em px na tela; o CSV ignora */
  largura?: number
}

export const COLUNAS: DefColuna[] = [
  { chave: 'protocolo', rotulo: 'Protocolo', alinhar: 'dir', largura: 82 },
  { chave: 'criacao', rotulo: 'Criação', largura: 130 },
  { chave: 'encerramento', rotulo: 'Encerramento', largura: 130 },
  { chave: 'statusProtocolo', rotulo: 'Status', largura: 90 },
  { chave: 'cliente', rotulo: 'Cliente', largura: 220 },
  { chave: 'contrato', rotulo: 'Contrato', alinhar: 'dir', largura: 80 },
  { chave: 'etiqueta', rotulo: 'Etiqueta', largura: 90 },
  { chave: 'statusContrato', rotulo: 'Status contrato', largura: 110 },
  { chave: 'cidade', rotulo: 'Cidade', largura: 120 },
  { chave: 'bairro', rotulo: 'Bairro', largura: 140 },
  { chave: 'rua', rotulo: 'Rua', largura: 200 },
  { chave: 'equipe', rotulo: 'Equipe', largura: 150 },
  { chave: 'responsavel', rotulo: 'Responsável (ERP)', largura: 200 },
  { chave: 'tipo', rotulo: 'Tipo', largura: 230 },
  { chave: 'catalogo', rotulo: 'Catálogo', largura: 130 },
  { chave: 'cat1', rotulo: 'Categoria 1', largura: 220 },
  { chave: 'cat2', rotulo: 'Categoria 2', largura: 160 },
  { chave: 'cat3', rotulo: 'Categoria 3', largura: 160 },
  { chave: 'cat4', rotulo: 'Categoria 4', largura: 140 },
  { chave: 'cat5', rotulo: 'Categoria 5', largura: 150 },
  { chave: 'solucao', rotulo: 'Solução', largura: 280 },
  { chave: 'pontoAcesso', rotulo: 'Ponto de acesso', largura: 130 },
  { chave: 'slot', rotulo: 'Slot', alinhar: 'dir', largura: 50 },
  { chave: 'porta', rotulo: 'Porta', alinhar: 'dir', largura: 55 },
  { chave: 'cto', rotulo: 'CTO', largura: 200 },
  // ⚠️ O RÓTULO diz `Login (PPPoE)`; a chave interna continua `instalacao`.
  //
  // A divergência é deliberada e não vale um refactor: a palavra saiu da TELA
  // em 01/09/2026 porque colidia com a operação de Instalação/Ativação — num
  // painel de Manutenção, quem lia "Instalação" entendia ordem de instalação,
  // não a conexão do cliente. Renomear a chave arrastaria o campo por SQL, tipo
  // e busca sem mudar nada para quem usa.
  { chave: 'instalacao', rotulo: 'Login (PPPoE)', largura: 170 },
  { chave: 'base', rotulo: 'Base', largura: 190 },
  { chave: 'instalador', rotulo: 'Executor (fechou)', largura: 200 },
  { chave: 'tecnicosAgenda', rotulo: 'Técnicos que foram', largura: 240 },
  { chave: 'auxiliar', rotulo: 'Auxiliar', largura: 200 },
  { chave: 'agendamentos', rotulo: 'Agend.', alinhar: 'dir', largura: 60 },
  { chave: 'primeiraAgenda', rotulo: '1ª agenda', largura: 130 },
  { chave: 'ultimaAgenda', rotulo: 'Última agenda', largura: 130 },
  { chave: 'mttrHoras', rotulo: 'MTTR (hh:mm:ss)', alinhar: 'dir', largura: 100 },
  { chave: 'improdutivas', rotulo: 'Improd.', alinhar: 'dir', largura: 60 },
  { chave: 'motivosImprod', rotulo: 'Motivo improd.', largura: 130 },
  { chave: 'preventiva', rotulo: 'Preventiva', largura: 80 },
  /**
   * DOIS PARES DE COLUNAS QUE NUNCA PREENCHEM NA MESMA LINHA, e a distinção é o
   * ponto:
   *
   * - `reincidencia` / `reincidenciaQtd` são de PREVENTIVA: a preventiva
   *   segurou, ou veio reparo depois? Vazias em protocolo de reparo.
   * - `voltouEm` / `protocoloAnterior` são de REPARO: este reparo já é uma
   *   volta? Vazias em preventiva, que nunca entra nesse cálculo.
   *
   * ⚠️ A FAIXA É A DO PRIMEIRO RETORNO, uma só. Até 01/09/2026 a coluna trazia
   * todas as janelas atingidas somadas ("<=30d + 31-60d"), e isso impedia as
   * telas de fechar entre si: Preventivos sempre classificou pelo primeiro
   * retorno, então os mesmos protocolos caíam em faixas diferentes de cada lado.
   * O caso de retorno múltiplo não se perdeu — está em `reincidenciaQtd`.
   * Ver docs/04 item 34.
   */
  { chave: 'reincidencia', rotulo: 'Reincidiu em', largura: 150 },
  { chave: 'reincidenciaQtd', rotulo: 'Retornos', alinhar: 'dir', largura: 80 },
  { chave: 'voltouEm', rotulo: 'Voltou em', largura: 110 },
  { chave: 'protocoloAnterior', rotulo: 'Protocolo anterior', largura: 140 },
  /*
    O OFENSOR, NOMINAL. Vem do executor da agenda do protocolo ANTERIOR — é a
    mesma pessoa que a página de Ofensores agrega, e é o que permite conferir
    aquele número linha a linha: 23 lá, 23 linhas aqui com o filtro ligado.

    Fica ao lado de `protocoloAnterior` de propósito: o par (qual protocolo,
    quem o atendeu) só se lê junto.
  */
  { chave: 'tecnicoAnterior', rotulo: 'Técnico do anterior', largura: 220 },
  { chave: 'criador', rotulo: 'Criador', largura: 200 },
]

/**
 * Conjuntos de colunas.
 *
 * 38 colunas de uma vez não se lê: cada uma rouba largura das outras e a pessoa
 * rola horizontalmente atrás da que interessa. Os conjuntos existem porque as
 * perguntas de auditoria são de três tipos diferentes, e cada um quer um
 * subconjunto distinto — não uma versão "resumida" do mesmo.
 */
export const CONJUNTOS = {
  voalle: {
    rotulo: 'Voalle',
    ajuda: 'Mesmas colunas do export do Voalle, para conferência linha a linha',
    chaves: [
      'protocolo', 'criacao', 'cliente', 'contrato', 'etiqueta', 'statusProtocolo',
      'encerramento', 'cidade', 'rua', 'bairro', 'equipe', 'responsavel', 'tipo',
      'catalogo', 'cat1', 'cat2', 'cat3', 'cat4', 'cat5', 'solucao', 'pontoAcesso',
      'slot', 'porta', 'statusContrato', 'cto', 'criador',
    ],
  },
  auditoria: {
    rotulo: 'Auditoria',
    ajuda: 'Os campos que o dashboard CALCULA — é aqui que divergência aparece',
    chaves: [
      // `cliente` na MESMA posição do conjunto Voalle (logo depois da criação),
      // para as duas visões poderem ser lidas lado a lado sem procurar a coluna.
      'protocolo', 'criacao', 'cliente', 'encerramento', 'statusProtocolo', 'base', 'cidade',
      'instalador', 'tecnicosAgenda', 'auxiliar', 'responsavel',
      'agendamentos', 'mttrHoras', 'improdutivas', 'motivosImprod', 'preventiva',
      'reincidencia', 'reincidenciaQtd',
      'voltouEm', 'protocoloAnterior', 'tecnicoAnterior',
      'tipo', 'catalogo', 'cat2', 'solucao',
    ],
  },
  rede: {
    rotulo: 'Rede',
    ajuda: 'Login, OLT e CTO — para cruzar reparo com ponto físico',
    chaves: [
      'protocolo', 'criacao', 'cliente', 'cidade', 'bairro', 'rua', 'instalacao',
      'pontoAcesso', 'slot', 'porta', 'cto', 'cat2', 'solucao', 'improdutivas',
    ],
  },
  tudo: {
    rotulo: 'Tudo',
    // conta sozinho: o número já esteve errado uma vez por coluna acrescentada
    ajuda: `As ${COLUNAS.length} colunas`,
    chaves: COLUNAS.map((c) => c.chave),
  },
} satisfies Record<
  string,
  { rotulo: string; ajuda: string; chaves: readonly ChaveProtocolo[] }
>

export type NomeConjunto = keyof typeof CONJUNTOS

export function ehNomeConjunto(s: string): s is NomeConjunto {
  return Object.hasOwn(CONJUNTOS, s)
}

export function colunasDe(conjunto: NomeConjunto): DefColuna[] {
  const ordem = new Map(COLUNAS.map((c) => [c.chave, c]))
  return CONJUNTOS[conjunto].chaves.flatMap((k) => {
    const c = ordem.get(k)
    return c ? [c] : []
  })
}

const COLUNAS_DATA = new Set<ChaveProtocolo>([
  'criacao',
  'encerramento',
  'primeiraAgenda',
  'ultimaAgenda',
])

/**
 * Formata UMA célula. Tela e CSV chamam esta função — não duas parecidas.
 *
 * A regra que não é óbvia: célula vazia sai como string vazia, nunca "—". O
 * travessão é decoração de tela; dentro de um CSV ele vira um valor de texto que
 * o Excel não reconhece como vazio, e qualquer contagem de "quantos sem CTO"
 * passa a dar zero.
 */
export function valorCelula(
  linha: LinhaProtocolo,
  chave: ChaveProtocolo
): string | number {
  const v = linha[chave]
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não'
  if (COLUNAS_DATA.has(chave)) return fmtDataHora(String(v))
  // hh:mm:ss, não decimal. "23,05" obriga a pessoa a converter 0,05 de hora em
  // minutos de cabeça no meio da auditoria; "23:03:00" já está na unidade em que
  // ela pensa. É também a MESMA função (fmtHoras) do resto do dashboard, então a
  // linha do relatório e o cartão de MTTR passam a falar a mesma língua.
  //
  // ⚠️ Não trunca em 24 h de propósito: MTTR aqui é criação→encerramento e passa
  // de um dia com frequência. "283:07:12" é feio e é honesto; "19:07:12" seria
  // bonito e errado.
  if (chave === 'mttrHoras') return fmtHoras(Number(v))
  return v
}

/**
 * Campos que a busca livre varre.
 *
 * Só identificadores, de propósito. Incluir cliente/rua faria "Silva" devolver
 * centenas de linhas e a busca deixaria de servir para o que ela serve numa
 * auditoria: achar UM protocolo específico e ver a linha inteira dele.
 */
export const CAMPOS_BUSCA: ChaveProtocolo[] = [
  'protocolo',
  'contrato',
  'etiqueta',
  'instalacao',
  'cto',
  'cliente',
]
