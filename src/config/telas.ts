/**
 * Catálogo das telas do dashboard — a fonte única de "o que existe para
 * controlar acesso".
 *
 * POR QUE UM CATÁLOGO E NÃO A LISTA DO CABEÇALHO: a navegação é uma lista de
 * links, e serve para navegar. Este catálogo é o contrato de AUTORIZAÇÃO, e as
 * duas coisas divergem por natureza — `/configuracoes` não é uma tela de dados,
 * está fora da navegação principal e não entra na matriz de acesso, porque quem
 * a vê é decidido pelo papel, não por lista.
 *
 * ⚠️ TELA NOVA PRECISA ENTRAR AQUI. Se não entrar, ela não aparece na matriz de
 * Configurações e o administrador não tem como restringi-la — ela fica visível
 * para todo mundo do domínio, em silêncio. O teste `telas.test.ts` compara este
 * catálogo com as rotas que existem em disco, justamente para que esquecer
 * quebre o build e não a confidencialidade.
 */

/**
 * Papel mora AQUI, e não no módulo de acesso, por um motivo de empacotamento: o
 * cabeçalho é componente de cliente e precisa do tipo. Importá-lo de
 * `server/auth/acesso.ts` faria um arquivo de cliente apontar para o módulo que
 * carrega o `pg` — some no build, porque `import type` é apagado, mas basta
 * alguém trocar por um import normal para arrastar o driver do Postgres para
 * dentro do bundle do navegador. Este arquivo é seguro dos dois lados.
 */
export type Papel = 'admin' | 'viewer'

export type Tela = {
  id: string
  caminho: string
  rotulo: string
  /** O que a tela expõe — texto mostrado ao administrador na matriz. */
  contem: string
  /**
   * A tela não obedece à barra de filtros, então a barra não aparece nela.
   * Filtro que não faz nada é pior que filtro ausente (item 30).
   */
  semFiltros?: true
}

export const TELAS = [
  {
    id: 'executivo',
    caminho: '/',
    rotulo: 'Executivo',
    contem: 'Volume, MTTR e fluxo de protocolos consolidados.',
  },
  {
    id: 'operacao',
    caminho: '/operacao',
    rotulo: 'Operação',
    contem: 'Manutenção em campo e protocolos abertos no suporte.',
  },
  {
    id: 'tempos',
    caminho: '/tempos',
    rotulo: 'Tempos',
    contem: 'MTTR e MTTA por recorte, com mapa de calor.',
  },
  {
    id: 'produtividade',
    caminho: '/produtividade',
    rotulo: 'Produtividade',
    contem: 'DESEMPENHO INDIVIDUAL NOMINAL de técnico, visita a visita.',
  },
  {
    id: 'recorrencia',
    caminho: '/recorrencia',
    rotulo: 'Recorrência',
    contem: 'Clientes recorrentes e reincidentes, com login PPPoE.',
  },
  {
    id: 'preventivos',
    caminho: '/preventivos',
    rotulo: 'Preventivos',
    contem: 'Qualidade da ação preventiva e taxa de falha.',
  },
  {
    id: 'ofensores',
    caminho: '/ofensores',
    rotulo: 'Ofensores',
    contem: 'Ranking de retorno por técnico, NOMINAL, com denominador.',
  },
  {
    id: 'historico',
    caminho: '/historico',
    rotulo: 'Histórico',
    contem: 'Série mensal de volume contra a base de clientes.',
  },
  {
    id: 'predicoes',
    caminho: '/predicoes',
    rotulo: 'Predições',
    contem: 'Previsões da Manutenção; lista protocolos abertos e logins PPPoE com reparo repetido.',
    semFiltros: true,
  },
  {
    id: 'protocolos',
    caminho: '/protocolos',
    rotulo: 'Protocolos',
    contem: 'Relatório analítico: nome, endereço e telefone do cliente.',
  },
] as const satisfies readonly Tela[]

export type IdTela = (typeof TELAS)[number]['id']

/**
 * O tipo do mapa preserva os ids literais. Tipá-lo como `Map<string, Tela>`
 * alargaria `id` para `string`, e aí `acesso.telas.has(tela.id)` deixaria de
 * compilar — o compilador perderia a garantia de que todo id que circula por
 * aqui é um dos oito, que é exatamente o que impede uma tela inventada passar
 * pela checagem.
 */
type TelaCatalogada = (typeof TELAS)[number]

const POR_CAMINHO = new Map<string, TelaCatalogada>(TELAS.map((t) => [t.caminho, t]))

/**
 * Descobre a tela a partir do caminho da URL.
 *
 * Casa o caminho EXATO, e é de propósito: casar por prefixo faria `/protocolos`
 * liberar qualquer rota futura que comece com isso, e o erro apareceria como
 * acesso a mais — o tipo que ninguém reporta.
 */
export function telaDoCaminho(caminho: string): TelaCatalogada | undefined {
  return POR_CAMINHO.get(caminho)
}

/**
 * A barra de filtros aparece aqui? Só em tela de dados que obedece a ela —
 * Configurações e Capa estão fora do catálogo, e as Predições estão nele mas
 * calculam sobre o universo inteiro.
 */
export function telaTemFiltros(caminho: string): boolean {
  const t = telaDoCaminho(caminho)
  return t !== undefined && !('semFiltros' in t)
}

/**
 * Que telas consomem cada indicador da API.
 *
 * Existe porque esconder a TELA sem fechar o ENDPOINT não esconde nada: quem
 * souber o endereço lê `/api/indicadores/produtividade` direto e recebe o
 * desempenho nominal que a matriz dizia ter escondido.
 *
 * Os indicadores genéricos (kpis, série, ranking…) alimentam várias telas, então
 * a regra de liberação é "tem acesso a PELO MENOS UMA das telas que o usam".
 * Mais fino que isso exigiria o cliente declarar de que tela está falando — e
 * dado que o cliente declara, o cliente falsifica.
 */
export const TELAS_POR_INDICADOR: Record<string, readonly IdTela[]> = {
  kpis: ['executivo', 'operacao', 'tempos'],
  mtta: ['executivo', 'tempos'],
  serie: ['executivo', 'operacao', 'tempos'],
  ranking: ['executivo', 'operacao', 'tempos'],
  heatmap: ['tempos'],
  coeficiente: ['executivo'],
  produtividade: ['produtividade'],
  recorrencia: ['recorrencia'],
  preventivos: ['preventivos'],
  ofensores: ['ofensores'],
  historico: ['historico'],
  predicoes: ['predicoes'],
  riscoAbertos: ['predicoes'],
  /**
   * As opções dos combos alimentam a barra de filtros, que existe em TODAS as
   * telas. Quem entrou no dashboard já pode vê-las: são nomes de cidade, equipe
   * e catálogo — o mesmo que a barra de filtros mostra desde sempre.
   */
  opcoes: ['executivo', 'operacao', 'tempos', 'produtividade', 'recorrencia', 'preventivos', 'ofensores', 'historico', 'protocolos'],
}
