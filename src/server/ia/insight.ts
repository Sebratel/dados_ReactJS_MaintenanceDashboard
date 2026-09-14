import { criarProvedor } from './provedor'
import { lerConfigUsavel } from './registro'

/**
 * "Explique este painel" — a leitura em prosa do que está na tela.
 *
 * O QUE VAI PARA O PROVEDOR, E O QUE NÃO VAI
 * ───────────────────────────────────────────
 * Vai a MESMA tabela que o painel já mostra, que é a visão de tabela de todo
 * gráfico deste dashboard. Não vai o SQL, não vai credencial, não vai nada que a
 * pessoa pedindo já não esteja vendo — quem não tem acesso à tela não chega
 * aqui, porque a rota exige a tela (ver `/api/ia/insight`).
 *
 * ⚠️ ISSO AINDA É DADO SAINDO DA EMPRESA. As tabelas de Produtividade e
 * Ofensores têm nome de técnico; a de Protocolos tem nome e endereço de cliente.
 * Mandá-las a um provedor externo é uma decisão de negócio, não um detalhe
 * técnico: por isso a funcionalidade só existe depois que um administrador
 * cadastra uma chave, e o limite abaixo corta o volume.
 */

/**
 * Teto de linhas enviadas.
 *
 * Um painel de série anual tem centenas de linhas, e mandar todas custa dinheiro
 * por token sem melhorar a leitura — o modelo não precisa de 365 pontos para
 * dizer que a tendência subiu. Cortar também limita o estrago se alguém apontar
 * a IA para o relatório analítico inteiro.
 */
const MAX_LINHAS = 120

/** Teto de caracteres por célula, contra texto longo vindo do ERP. */
const MAX_CELULA = 200

export type PedidoInsight = {
  titulo: string
  descricao?: string
  colunas: { chave: string; rotulo: string }[]
  linhas: Record<string, string | number>[]
  /** o recorte que gerou a tabela, em texto — "julho/2026, base Canoas" */
  recorte?: string
  /** pergunta livre do usuário; vazio = leitura geral */
  pergunta?: string
}

const SISTEMA = `Você analisa indicadores de manutenção de fibra óptica (FTTX) de um provedor de internet brasileiro.

Responda em português do Brasil, direto ao ponto, em no máximo 5 frases curtas ou 4 marcadores.

REGRAS QUE IMPORTAM:
- Fale APENAS do que está na tabela. Não invente causa, não suponha dado que não veio.
- Números vêm da tabela; não recalcule o que já está calculado nem arredonde diferente.
- Aponte o que salta: maior, menor, concentração, quebra de tendência, valor fora do padrão.
- Se a tabela não sustenta uma conclusão, diga isso em vez de preencher com generalidade.
- Nada de introdução ("Claro!", "Analisando os dados…") nem de fechamento. Comece pela conclusão.
- Não recomende ação de negócio a menos que perguntem: descreva o que o dado mostra.`

function tabelaEmTexto(p: PedidoInsight): string {
  const corte = p.linhas.slice(0, MAX_LINHAS)
  const cab = p.colunas.map((c) => c.rotulo).join(' | ')
  const sep = p.colunas.map(() => '---').join(' | ')

  const corpo = corte
    .map((linha) =>
      p.colunas
        .map((c) => {
          const v = linha[c.chave]
          const s = v === undefined || v === null ? '' : String(v)
          return s.length > MAX_CELULA ? `${s.slice(0, MAX_CELULA)}…` : s
        })
        .join(' | ')
    )
    .join('\n')

  const aviso =
    p.linhas.length > corte.length
      ? `\n\n(Mostrando as primeiras ${corte.length} de ${p.linhas.length} linhas.)`
      : ''

  return `${cab}\n${sep}\n${corpo}${aviso}`
}

export type ResultadoInsight = {
  texto: string
  provedor: string
  modelo: string
  linhasEnviadas: number
  ms: number
}

export class SemProvedorError extends Error {
  constructor() {
    super(
      'Nenhum provedor de IA configurado. Um administrador pode cadastrar a chave em Configurações → IA.'
    )
    this.name = 'SemProvedorError'
  }
}

export async function gerarInsight(p: PedidoInsight): Promise<ResultadoInsight> {
  const cfg = await lerConfigUsavel()
  if (!cfg) throw new SemProvedorError()

  if (!p.linhas.length) {
    throw new Error('Não há dados neste painel para analisar.')
  }

  const partes = [
    `Painel: ${p.titulo}`,
    p.descricao ? `Descrição: ${p.descricao}` : null,
    p.recorte ? `Recorte aplicado: ${p.recorte}` : null,
    '',
    tabelaEmTexto(p),
    '',
    p.pergunta?.trim()
      ? `Pergunta: ${p.pergunta.trim()}`
      : 'Leia a tabela e diga o que ela mostra.',
  ].filter((l) => l !== null)

  const t0 = performance.now()
  const texto = await criarProvedor(cfg).conversar(SISTEMA, partes.join('\n'))
  const ms = Math.round(performance.now() - t0)

  const limpo = texto.trim()
  if (!limpo) throw new Error('O provedor de IA respondeu vazio.')

  return {
    texto: limpo,
    provedor: cfg.tipo,
    modelo: cfg.modelo,
    linhasEnviadas: Math.min(p.linhas.length, MAX_LINHAS),
    ms,
  }
}
