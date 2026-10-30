import { consultarErp } from '@/server/db/erp'
import {
  CATALOGOS_MANUTENCAO,
  CATEGORIAS_PREVENTIVAS,
  CLIENTES_TESTE,
  EQUIPES_FORA_DA_MANUTENCAO,
  TIPOS_FORA_DA_MANUTENCAO,
  REGEX_CODIGO_IMPRODUTIVIDADE,
  TIPOS_PREVENTIVOS,
} from '@/config/regras-negocio'
import type { Filtros } from '@/lib/filtros'
import { CASAS_HORA, ORDEM_EXECUTOR, colunaEixo, montarFrom, montarWhere } from './base'

/**
 * RELATÓRIO ANALÍTICO — um protocolo por linha.
 *
 * POR QUE ESTE INDICADOR É DIFERENTE DE TODOS OS OUTROS
 * ────────────────────────────────────────────────────
 * Os demais respondem "quanto". Este responde **"quais"** — é a lista nominal
 * por trás de cada número da tela. Sem ele, auditar significa confiar: o gestor
 * vê 3.764 protocolos no cartão e não tem como conferir se são os mesmos 3.764
 * que o Voalle lista. Com ele, exporta os dois CSVs e compara protocolo a
 * protocolo.
 *
 * O UNIVERSO É O MESMO, POR CONSTRUÇÃO. As colunas vêm de um SELECT novo, mas o
 * FROM e o WHERE são os de `base.ts`, os mesmos que alimentam KPI, série e
 * ranking. Se eu tivesse reescrito o filtro aqui, o relatório poderia "provar"
 * que o dashboard está certo estando os dois errados juntos — que é exatamente o
 * defeito que uma auditoria precisa ser capaz de pegar.
 *
 * DUAS FAMÍLIAS DE COLUNA, e a distinção importa:
 *
 * 1. PARIDADE VOALLE — protocolo, cliente, contrato, etiqueta, categorias,
 *    solução, CTO… reproduzem o export "Ex relat detalhado protocolos" para
 *    conferência linha a linha.
 * 2. DERIVADAS DO DASHBOARD — base, instalador, auxiliar, improdutivas, MTTR,
 *    instalação (login PPPoE), preventiva. Não existem no export do Voalle, e
 *    são justamente os campos que o dashboard CALCULA. Conferir só as colunas
 *    cruas provaria que lemos a mesma tabela, não que calculamos certo.
 *
 * ONDE ESTE RELATÓRIO DIVERGE DO EXPORT DO VOALLE — de propósito:
 *
 * - SLOT e PORTA. No export do Voalle essas colunas são
 *   `authentication_access_points.slots_first_number` / `ports_first_number`, que
 *   são CONFIGURAÇÃO DA OLT (o número do primeiro slot do chassi), iguais para
 *   todos os clientes da mesma OLT — 0 nas CHNVA/CHNVC, 1 nas demais, porta
 *   sempre 1. Não dizem nada sobre o cliente. Aqui usamos
 *   `authentication_contracts.slot_olt` / `port_olt`, que são o slot e a porta
 *   REAIS daquela instalação (e batem com o que o nome da CTO codifica).
 * - CONTEXTO e PROBLEMA saíram: 99,8% nulos no universo (3.758 de 3.764 em
 *   julho/2026). Coluna vazia em relatório de auditoria só ocupa largura.
 * - CLIENTE DE TESTE excluído (docs/04). O export do Voalle o inclui; a
 *   diferença é de 7 protocolos em 8 meses e vai declarada em `meta`.
 *
 * CAMINHO ATÉ A REDE (OLT/CTO) — não é o óbvio:
 *   assignment_incidents.contract_service_tag_id → authentication_contracts
 * falha em ~2% dos casos, porque o protocolo guarda a etiqueta VIGENTE NA ÉPOCA
 * e o contrato de autenticação pode já ter migrado para outra. Medido no
 * protocolo 1498361: a etiqueta do protocolo é a 255493, o contrato de
 * autenticação aponta para a 286480 — pelo caminho direto o CTO viria vazio, e o
 * export do Voalle mostra `CAN-C-1047-2-6-3/4`. Por isso o LATERAL tenta a
 * etiqueta PRIMEIRO e cai para o contrato depois: a etiqueta é mais específica,
 * o contrato é a rede de segurança.
 */

export type LinhaProtocolo = {
  // — identificação —
  /** `assignment_incidents.protocol` é int8 no Voalle, não texto */
  protocolo: number
  criacao: string
  encerramento: string | null
  statusProtocolo: string | null
  cliente: string | null
  contrato: string | null
  etiqueta: string | null
  statusContrato: string | null
  // — endereço —
  cidade: string | null
  bairro: string | null
  rua: string | null
  // — classificação —
  equipe: string | null
  responsavel: string | null
  tipo: string | null
  catalogo: string | null
  cat1: string | null
  cat2: string | null
  cat3: string | null
  cat4: string | null
  cat5: string | null
  solucao: string | null
  // — rede —
  pontoAcesso: string | null
  /** slot/porta REAIS da instalação na OLT — ver nota no cabeçalho */
  slot: number | null
  porta: number | null
  cto: string | null
  /** login PPPoE: a CHAVE da recorrência (docs/04). `tag:<id>` quando não há. */
  instalacao: string | null
  // — derivadas do dashboard —
  base: string | null
  /** quem FECHOU o protocolo — não "quem atendeu": ver `tecnicosAgenda` */
  instalador: string | null
  /**
   * Todos os técnicos que o protocolo consumiu, separados por vírgula. Existe
   * porque `instalador` é um campo só e o protocolo pode ter tido duas visitas
   * com dois técnicos — um que perdeu a visita e outro que executou. Ver a nota
   * de cabeçalho de produtividade.ts.
   */
  tecnicosAgenda: string | null
  /**
   * Só para protocolo PREVENTIVO, e só quando o corte de reincidência está
   * ativo: em que janelas houve reparo depois, na mesma instalação
   * ('≤30d', '31–60d', '61–90d', ou combinações). null quando não foi calculado
   * ou quando o protocolo não é preventivo.
   */
  reincidencia: string | null
  /** quantos reparos vieram depois, dentro de 90 dias */
  reincidenciaQtd: number | null
  /**
   * Só para REPARO (preventiva nunca entra): quanto tempo depois do atendimento
   * ANTERIOR da mesma instalação este protocolo entrou — '≤30d', '31–60d' ou
   * '61–90d'. Vazio quando não é retorno.
   *
   * É o MESMO conjunto que a aba Ofensores agrega por técnico anterior, só que
   * nominal. Conferido em agosto/2026: 192 + 108 + 83 = 383 dos dois lados.
   */
  voltouEm: string | null
  /** o protocolo ANTERIOR da mesma instalação, para auditar o par */
  protocoloAnterior: string | null
  /**
   * Quem atendeu o protocolo ANTERIOR — o "ofensor" da página de Ofensores,
   * aqui nominal. É o que fecha o drill-down: o técnico que aparece com 23
   * retornos lá devolve 23 linhas aqui com `tecnicoOfensor` ligado.
   *
   * Vem do executor da agenda, nunca do responsável — ver a nota no CTE.
   */
  tecnicoAnterior: string | null
  /**
   * Três estados, e a distinção é o ponto: um NOME (houve dupla),
   * `SEM AUXILIAR` (o técnico declarou que foi sozinho) ou vazio (não registrou
   * nada). A coluna booleana `temRegistroDupla` existia só para separar os dois
   * últimos e saiu: contradizia esta aqui em toda linha de quem trabalha sozinho.
   */
  auxiliar: string | null
  agendamentos: number
  primeiraAgenda: string | null
  ultimaAgenda: string | null
  mttrHoras: number | null
  /** dias distintos com relato improdutivo neste protocolo */
  improdutivas: number
  motivosImprod: string | null
  preventiva: boolean
  criador: string | null
}

/**
 * Teto de linhas por recorte.
 *
 * O resultado inteiro fica no cache do servidor para que virar de página e
 * exportar CSV não custem consulta nova. ~1,1 KB por linha medido → 15 mil
 * linhas ≈ 16 MB por entrada de cache, e 15 mil cobre um trimestre com folga
 * (~3.700 protocolos/mês). Passando disso o relatório TRUNCA e avisa, em vez de
 * entregar uma lista silenciosamente incompleta — que numa auditoria é pior que
 * não entregar nada.
 */
export const LIMITE_LINHAS = 15_000

export type ResultadoProtocolos = {
  data: { linhas: LinhaProtocolo[] }
  meta: {
    total: number
    truncado: boolean
    limite: number
    /** protocolos do cliente de teste removidos deste recorte */
    excluidosTeste: number
    /**
     * Logins PPPoE distintos no recorte — o card da tela mostra ao lado do
     * total de protocolos para que "protocolo ≠ login" fique à vista (a dúvida
     * 118 × 105 contra a Recorrência, 23/10/2026). Opcional: entrada de cache
     * anterior a 30/10/2026 não tem.
     */
    loginsDistintos?: number
    /**
     * Quantos protocolos da lista caem em cada botão de "Retorno do reparo",
     * contados do MESMO mapa que o filtro usa — a contagem do botão é o que o
     * clique devolve. Só reparo do universo do retorno entra; preventiva não.
     */
    retornoPorFaixa?: { sim: number; v30: number; v60: number; v90: number; nao: number }
  }
  ms: number
}

export async function obterProtocolos(f: Filtros): Promise<ResultadoProtocolos> {
  const { sql: where, params } = montarWhere(f)
  const p = (v: unknown) => `$${params.push(v)}`

  const de = p(f.de)
  const ate = p(f.ate)
  const regexCodigo = p(REGEX_CODIGO_IMPRODUTIVIDADE)

  /**
   * REINCIDÊNCIA É SOB DEMANDA — decisão de custo, medida, não preferência.
   *
   * Os dois CTEs que a coluna exige custam **4,35 s** sozinhos na réplica
   * (7.813 reparos × 3.019 preventivas em jun–ago/2026), sobre um relatório que
   * já levava 5,8 s. Somados encostam no `statement_timeout`, e sob contenção da
   * réplica ESTOURAM.
   *
   * Foi assim que a Manutenção viu *"fiz um filtro no status e a tabela não
   * mudou"* (28/08/2026): a consulta falhava e a tela seguia exibindo o
   * resultado anterior. Erro que se disfarça de dado velho é o pior tipo — não
   * há nada na tela dizendo que falhou.
   *
   * Então o cálculo só entra quando alguém pergunta por ele. Sem corte ativo os
   * CTEs não existem na consulta e a coluna vem nula; a tela custa o que sempre
   * custou.
   */
  const comReincidencia = Boolean(f.reincidencia)

  // tiposPrev e catsPrev já eram usados pela coluna `Preventiva`, que existe
  // sempre — só `catalogos` nasceu com a reincidência.
  const tiposPrev = `${p([...TIPOS_PREVENTIVOS])}::text[]`
  const catsPrev = `${p([...CATEGORIAS_PREVENTIVAS])}::text[]`

  /**
   * O CORTE VIRA UMA LISTA DE PROTOCOLOS, calculada ANTES e à parte.
   *
   * A reincidência já morou dentro desta consulta, de três formas, e as três
   * falharam pelo mesmo motivo: os CTEs entravam num SELECT que já carrega
   * LATERAIs caros (agenda, improdutividade, CTO, auxiliar) e um ORDER BY sobre
   * o recorte inteiro. Com LIMIT no fim, o planejador prefere varrer por data e
   * sondar o CTE linha a linha — e CTE não tem índice. Medido: 23 s a 58 s nos
   * cortes, timeout em "Não reincidiu".
   *
   * Aqui o cálculo sai da frente. `reincidenciaPorProtocolo` é uma consulta
   * própria de ~550 ms; o que ela devolve entra na consulta pesada como
   * `ai.protocol = any($n)` — uma lista de bigint, que o índice atende e o
   * planejador sabe estimar. As duas colunas são preenchidas em JS, sem junção.
   *
   * O ganho não é só de tempo: a consulta principal volta a ser exatamente a
   * mesma de sempre, com um filtro a mais. Nada do que ela já fazia mudou de
   * plano por causa da reincidência.
   */
  /**
   * O RETORNO É SEMPRE CALCULADO, ao contrário da reincidência.
   *
   * A pergunta "quais reparos deste mês são retorno?" é a razão de a aba
   * Ofensores existir, e até aqui ela só tinha resposta agregada — dava para ver
   * que 383 reparos de agosto voltaram, não QUAIS. Deixar a coluna vazia até
   * alguém acionar um corte devolveria o mesmo problema.
   *
   * Custa ~540 ms e roda em paralelo com a reincidência.
   *
   * ⚠️ OLHA PARA TRÁS, e isso é deliberado. A pergunta simétrica — "este reparo
   * ainda vai voltar?" — não tem resposta perto do presente: um reparo de 28/08
   * teve poucos dias para voltar, então TUDO cairia em ≤30d e as faixas de 60 e
   * 90 viriam zeradas. Medido em agosto/2026: 121 "voltas" adiante, 100% em
   * ≤30d. Olhando para trás a janela está sempre completa, e é a mesma direção
   * que a aba Ofensores usa.
   */
  const [reinc, retorno] = await Promise.all([
    comReincidencia ? reincidenciaPorProtocolo(f) : Promise.resolve(null),
    retornoPorProtocolo(f),
  ])

  const protocolosDoCorte = reinc
    ? [...reinc.entries()]
        .filter(([, r]) =>
          f.reincidencia === 'sim'
            ? r.rotulo !== null
            : f.reincidencia === 'nao'
              ? r.rotulo === null
              : f.reincidencia === 'r30'
                ? r.rotulo === '≤30d'
                : f.reincidencia === 'r60'
                  ? r.rotulo === '31–60d'
                  : r.rotulo === '61–90d'
        )
        .map(([protocolo]) => protocolo)
    : null

  const protocolosDoRetorno = f.retorno
    ? [...retorno.entries()]
        .filter(([, r]) =>
          f.retorno === 'sim'
            ? r.faixa !== null
            : f.retorno === 'nao'
              ? r.faixa === null
              : f.retorno === 'v30'
                ? r.faixa === '≤30d'
                : f.retorno === 'v60'
                  ? r.faixa === '31–60d'
                  : r.faixa === '61–90d'
        )
        .map(([protocolo]) => protocolo)
    : null

  /**
   * O CORTE PELO OFENSOR — o que fecha o drill-down vindo de Ofensores.
   *
   * Reusa o mesmo mapa `retorno`, então por construção a lista daqui é a mesma
   * que a página de Ofensores agrega: não há duas definições de "atendimento
   * anterior" para divergirem.
   */
  const protocolosDoOfensor = f.tecnicoOfensor
    ? [...retorno.entries()]
        .filter(([, r]) => r.tecnicoAnterior === f.tecnicoOfensor)
        .map(([protocolo]) => protocolo)
    : null

  /**
   * OS CORTES VIRAM UMA LISTA SÓ, por interseção.
   *
   * Reincidência recorta preventiva; retorno recorta reparo. Pedir os dois ao
   * mesmo tempo devolve vazio — o que está certo, porque um protocolo não é
   * preventiva e reparo ao mesmo tempo. Resolver a interseção aqui em JS deixa
   * o SQL com um único filtro em vez de dois encadeados.
   */
  const listas = [protocolosDoCorte, protocolosDoRetorno, protocolosDoOfensor].filter(
    (x): x is number[] => x !== null
  )
  const alvos =
    listas.length === 0
      ? null
      : listas.reduce((a, b) => {
          const s = new Set(b)
          return a.filter((x) => s.has(x))
        })

  /**
   * A LISTA ENTRA COMO CTE MATERIALIZADO, e não como `ai.protocol = any(...)`.
   *
   * Com o `any(array)` o custo dependia do TAMANHO da lista de um jeito que não
   * fazia sentido nenhum — e é escolha de plano, não carga da réplica, porque
   * reproduz:
   *
   * | corte | protocolos | com `any(array)` |
   * |---|---|---|
   * | ≤30d | 192 | 1,2 s |
   * | 31–60d | 108 | 1,3 s |
   * | **Voltou** | **383** | **54 s** |
   * | Não voltou | 2.471 | 8,7 s |
   *
   * O 383 caía numa faixa de estimativa em que o planejador achava que valia a
   * pena varrer o índice de data em ordem e testar a pertinência linha a linha
   * — para satisfazer o `ORDER BY ... LIMIT` sem ordenar. Como os LATERAIs de
   * agenda, improdutividade e CTO rodam por linha visitada, ele pagava caro por
   * cada linha descartada.
   *
   * `MATERIALIZED` é a cerca de otimização do Postgres: obriga a lista a existir
   * como relação antes, com contagem de linhas REAL em vez de estimada, e o
   * `JOIN` vira hash. O plano deixa de depender de qual botão foi clicado.
   *
   * ⚠️ Lista VAZIA precisa continuar sendo um JOIN que não casa com nada: sem o
   * filtro, um corte sem nenhum protocolo devolveria o recorte inteiro.
   */
  /**
   * A LISTA ENTRA COMO PRIMEIRA RELAÇÃO DO FROM. As duas coisas importam: ser
   * CTE materializado E vir primeiro.
   *
   * `join_collapse_limit` vale 8 por padrão. Esta consulta tem MUITO mais que
   * isso — núcleo, categorias, solicitação, agenda, CTO, improdutividade,
   * auxiliar — então o planejador desiste da busca exaustiva de ordem de junção
   * e passa a HONRAR A ORDEM ESCRITA. Em consulta pequena a posição do JOIN no
   * texto não muda nada; nesta, mudou tudo.
   *
   * Foi o que me custou duas tentativas erradas:
   *
   * | forma | "Voltou" (383) |
   * |---|---|
   * | `ai.protocol = any(array)` no WHERE | 54 s |
   * | CTE materializado com o JOIN NO FIM do FROM | timeout |
   * | CTE materializado com o JOIN NO INÍCIO | ver docs/06 |
   *
   * Com a lista primeiro, o plano começa por ela — 383 linhas, contagem REAL e
   * não estimada — e alcança `assignment_incidents` pelo índice de protocolo. Os
   * LATERAIs de agenda, improdutividade e CTO passam a rodar só para as linhas
   * que sobreviveram, que era o ponto desde o começo.
   *
   * ⚠️ Lista VAZIA vira um JOIN que não casa com nada, e é o correto: sem o
   * filtro, um corte sem nenhum protocolo devolveria o recorte inteiro.
   */
  const filtroAlvos = alvos ? /* sql */ `AND ai.protocol = any(${p(alvos)}::bigint[])` : ''

  /**
   * SEM `LIMIT` QUANDO HÁ CORTE — e é isto que conserta o plano.
   *
   * O `LIMIT` existe para o caso geral, em que o recorte tem dezenas de milhares
   * de linhas e ninguém vai ler todas. Com um corte ativo o conjunto já está
   * limitado pela própria lista (2.471 no maior deles), então o `LIMIT` não
   * protege de nada — mas ATRAPALHA: é ele que faz o planejador tentar varrer o
   * índice de data em ordem e parar cedo, em vez de pegar as linhas da lista e
   * ordenar. Como os LATERAIs de agenda, improdutividade e CTO rodam por linha
   * visitada, cada linha descartada nessa varredura custa caro.
   *
   * Medido no corte "Voltou" (383 protocolos, agosto/2026):
   *
   * | forma | tempo |
   * |---|---|
   * | `any(array)` + LIMIT | 54 s |
   * | CTE MATERIALIZED + JOIN + LIMIT | timeout |
   * | `any(array)` sem LIMIT | ver docs/06 |
   *
   * A tentativa do meio merece registro: `MATERIALIZED` é a cerca de otimização
   * do Postgres e parecia a resposta, mas piorou TUDO — o hash join só podia
   * acontecer depois de a consulta principal produzir suas linhas, ou seja
   * perdeu a restrição antecipada que era justamente o ganho.
   */
  const limiteSql = `LIMIT ${p(LIMITE_LINHAS + 1)}`

  // agenda: o filtro por base e as colunas de campo dependem do LATERAL.
  // categorias: são 5 colunas do relatório, sempre presentes.
  // solicitacao: só pela solução — contexto e problema saíram (99,8% nulos).
  const from = montarFrom({ agenda: true, categorias: true, solicitacao: true })

  const ordem = colunaEixo(f.eixo)

  const sql = /* sql */ `
    -- ⚠️ MATERIALIZED NÃO É DETALHE: é o que separa 7 segundos de um timeout.
    --
    -- Sem ele o planejador INLINE este CTE e, como estima  rows=1  para o
    -- recorte filtrado, escolhe Nested Loop com  Join Filter: r.tags::bigint =
    -- ai.protocol  -- ou seja, revarre a ponte RAUX A CADA LINHA do relatório.
    -- Com 2.477 linhas reais em vez de 1, vira minutos.
    --
    -- A estimativa de  rows=1  aparece quando DOIS filtros de dimensão se
    -- combinam (Equipe + Tipo): o planejador multiplica as seletividades e chega
    -- perto de zero. Nenhum filtro sozinho provoca isso.
    --
    -- Medido em 02/09/2026, agosto, aba Protocolos:
    --
    --   Equipe + Tipo ............ timeout (60 s)  ->  7,0 s
    --   Equipe + Tipo + Cidade ... timeout (60 s)  ->  6,6 s
    --   90d status=Encerrado+tipo  timeout (60 s)  -> 21,1 s   (item R de docs/06)
    --   90d corte "Voltou" ....... 52 s            ->  6,7 s   (item T de docs/06)
    --
    -- MATERIALIZED obriga uma avaliação só, com contagem REAL de linhas, e a
    -- junção vira hash. Nenhum número muda -- e conferido: os totais de todos os
    -- recortes ficaram idênticos.
    WITH auxiliar AS MATERIALIZED (
      -- O SEGUNDO TECNICO DA DUPLA. Mesma ponte da produtividade: a perna RAUX e
      -- uma assignment separada e o vinculo com o protocolo esta em reports.tags
      -- (NAO em corresponding_parent_id, que devolve zero linhas). Ver
      -- produtividade.ts para a medicao que estabeleceu isso.
      --
      -- Janela por data em vez de join com o universo: r.tags e TEXTO, entao
      -- casar com o protocolo exige cast e o cast anula o indice. Medido: com
      -- "r.tags::bigint IN (SELECT ...)" a consulta vai de 2,8 s para 5,6 s.
      SELECT DISTINCT ON (r.tags::bigint)
             r.tags::bigint AS protocolo,
             r.person_id
        FROM erp.assignments raux
        JOIN erp.reports r ON r.assignment_id = raux.id
       WHERE raux.assignment_type = 'RAUX'
         AND r.tags ~ '^[0-9]+$'
         AND raux.created >= (${de}::date - interval '60 days')
         AND raux.created <  (${ate}::date + interval '60 days')
       ORDER BY r.tags::bigint, r.beginning_date DESC, r.id DESC
    )
    SELECT ai.protocol                       AS "protocolo",
           a.created                         AS "criacao",
           a.conclusion_date                 AS "encerramento",
           st.title                          AS "statusProtocolo",
           p.name                           AS "cliente",
           ct.contract_number                AS "contrato",
           cst.service_tag                   AS "etiqueta",
           ct.v_status                       AS "statusContrato",
           p.city                           AS "cidade",
           p.neighborhood                   AS "bairro",
           p.street                         AS "rua",
           t.title                           AS "equipe",
           resp.name                         AS "responsavel",
           it.title                          AS "tipo",
           cs.title                          AS "catalogo",
           cat1.title AS "cat1", cat2.title AS "cat2", cat3.title AS "cat3",
           cat4.title AS "cat4", cat5.title AS "cat5",
           ss.title                          AS "solucao",
           aap.title                         AS "pontoAcesso",
           ac.slot_olt                       AS "slot",
           ac.port_olt                       AS "porta",
           cto.cto                           AS "cto",
           coalesce(ac.login, 'tag:' || ai.contract_service_tag_id::text) AS "instalacao",
           s.regiao_agenda                   AS "base",
           s.instalador                      AS "instalador",
           s.tecnicos_agenda                 AS "tecnicosAgenda",
           -- O PLACEHOLDER "SEM AUXILIAR" VEM COMO ESTA, nao vira vazio.
           --
           -- Ele nao e gente: e a opcao que o app grava quando o tecnico declara
           -- que foi sozinho. A produtividade PRECISA anula-lo (senao viraria um
           -- "tecnico" com centenas de creditos), mas aqui, num relatorio de
           -- AUDITORIA, apaga-lo destruia informacao: a linha ficava com
           -- "Registrou dupla = Sim" e Auxiliar vazio, e quem lia concluia que o
           -- tecnico esqueceu de preencher. Ele nao esqueceu -- preencheu
           -- "sozinho", e a tela do Voalle mostra exatamente esta string.
           --
           -- Mostrar o mesmo texto do ERP e o que torna a conferencia direta:
           -- o auditor compara as duas telas sem traduzir nada.
           paux.name                         AS "auxiliar",
           coalesce(s.qtd_agendamentos, 0)   AS "agendamentos",
           s.primeira_agenda                 AS "primeiraAgenda",
           s.ultima_agenda                   AS "ultimaAgenda",
           round((extract(epoch from (a.conclusion_date - a.created)) / 3600.0)::numeric, ${CASAS_HORA})
                                             AS "mttrHoras",
           coalesce(i.dias, 0)               AS "improdutivas",
           i.motivos                         AS "motivosImprod",
           (it.title = any(${tiposPrev}) OR cat2.title = any(${catsPrev}))
                                             AS "preventiva",
           cri.name                          AS "criador"
    ${from}
      LEFT JOIN erp.solicitation_service_categories cat4 ON cat4.id = scm.service_category_id_4
      LEFT JOIN erp.solicitation_service_categories cat5 ON cat5.id = scm.service_category_id_5
      LEFT JOIN erp.contract_service_tags cst ON cst.id = ai.contract_service_tag_id
      LEFT JOIN erp.contracts ct              ON ct.id  = cst.contract_id
      -- CRIADOR SAI DE erp.users, NAO DE erp.people.
      --
      -- A coluna assignments.created_by guarda o id do USUARIO do ERP (quem opera o
      -- sistema), nao o id da pessoa. Ligar em erp.people casava por coincidencia
      -- de id e devolvia gente aleatoria -- inclusive CLIENTES: o id 777 e o
      -- usuario LUIS GUSTAVO mas a pessoa "FARMACIA DROGA REI", que foi como a
      -- Manutencao percebeu ("nao encontrei as pessoas que estao como Criador na
      -- empresa").
      --
      -- O erro era INVISIVEL porque as faixas de id se sobrepoem inteiras: nos
      -- 27.970 protocolos de 2026, 100% achavam um usuario E 100% achavam uma
      -- pessoa. Toda linha vinha com um nome plausivel; nenhuma vinha vazia.
      -- Nao ha como um teste de cobertura pegar isso -- so a leitura humana.
      LEFT JOIN erp.users cri                 ON cri.id = a.created_by
      LEFT JOIN LATERAL (
        -- Etiqueta primeiro, contrato como rede de segurança: ver cabeçalho.
        SELECT x.id, x."user" AS login, x.slot_olt, x.port_olt, x.authentication_access_point_id
          FROM erp.authentication_contracts x
         WHERE x.service_tag_id = ai.contract_service_tag_id
            OR x.contract_id    = cst.contract_id
         ORDER BY (x.service_tag_id = ai.contract_service_tag_id) DESC,
                  x.active DESC NULLS LAST, x.id DESC
         LIMIT 1
      ) ac ON true
      LEFT JOIN erp.authentication_access_points aap ON aap.id = ac.authentication_access_point_id
      LEFT JOIN LATERAL (
        SELECT spl.title AS cto
          FROM erp.authentication_splitter_ports spo
          JOIN erp.authentication_splitters spl ON spl.id = spo.authentication_splitter_id
         WHERE spo.authentication_contract_id = ac.id
         ORDER BY spo.id DESC
         LIMIT 1
      ) cto ON true
      LEFT JOIN LATERAL (
        -- IMPRODUTIVIDADE por LATERAL, nao por CTE com janela de data.
        --
        -- A CTE exigiria adivinhar quanto tempo depois do protocolo o relato
        -- aparece, e adivinhar errado silencia improdutivas de verdade. Aqui a
        -- busca e por assignment_id (indexado): sem janela, sem chute, e ainda
        -- saiu mais rapido (5,4 s contra 6,0 s no mes).
        --
        -- Conta DIA, nao relato: dois relatos improdutivos no mesmo dia sao uma
        -- visita perdida, nao duas -- mesma regra da produtividade.
        SELECT count(DISTINCT date_trunc('day', r.beginning_date)::date)::int AS dias,
               string_agg(DISTINCT upper(substring(
                 regexp_replace(regexp_replace(r.description, '<[^>]+>', ' ', 'g'),
                                '&nbsp;', ' ', 'g')
                 from ${regexCodigo})), ', ') AS motivos
          FROM erp.reports r
         WHERE r.assignment_id = a.id
           AND upper(r.description) LIKE '%IMPROD%'
      ) i ON true
      LEFT JOIN auxiliar ax     ON ax.protocolo = ai.protocol::bigint
      LEFT JOIN erp.people paux ON paux.id = ax.person_id
    ${where}
      ${filtroAlvos}
     ORDER BY ${ordem} DESC NULLS LAST, ai.protocol DESC
     ${limiteSql}`

  const { rows, ms } = await consultarErp<LinhaProtocolo>(sql, params)

  const truncado = rows.length > LIMITE_LINHAS
  const linhas = (truncado ? rows.slice(0, LIMITE_LINHAS) : rows).map((l) => {
    const r = reinc?.get(Number(l.protocolo))
    const v = retorno.get(Number(l.protocolo))
    return {
      ...l,
      reincidencia: r?.rotulo ?? null,
      reincidenciaQtd: r?.qtd ?? null,
      voltouEm: v?.faixa ?? null,
      protocoloAnterior: v?.anterior ?? null,
      tecnicoAnterior: v?.tecnicoAnterior ?? null,
    }
  })

  // Quantos ficaram de fora pela regra do cliente de teste. Sem este número o
  // gestor vê "3.764 aqui, 3.765 no Voalle" e não sabe se achou um defeito ou a
  // regra funcionando.
  const excluidosTeste = await contarExcluidosTeste(f)

  const loginsDistintos = new Set(linhas.map((l) => l.instalacao).filter(Boolean)).size
  const retornoPorFaixa = { sim: 0, v30: 0, v60: 0, v90: 0, nao: 0 }
  for (const l of linhas) {
    const v = retorno.get(Number(l.protocolo))
    if (!v) continue // fora do universo do retorno (preventiva, cancelado…)
    if (v.faixa === null) retornoPorFaixa.nao++
    else {
      retornoPorFaixa.sim++
      if (v.faixa === '≤30d') retornoPorFaixa.v30++
      else if (v.faixa === '31–60d') retornoPorFaixa.v60++
      else retornoPorFaixa.v90++
    }
  }

  return {
    data: { linhas },
    meta: {
      total: linhas.length,
      truncado,
      limite: LIMITE_LINHAS,
      excluidosTeste,
      loginsDistintos,
      retornoPorFaixa,
    },
    ms,
  }
}

type Retorno = { faixa: string | null; anterior: string | null; tecnicoAnterior: string | null }

/**
 * "Este reparo é um RETORNO?" — quanto tempo depois do atendimento anterior da
 * mesma instalação ele entrou.
 *
 * É o conjunto da aba Ofensores, visto protocolo a protocolo. Lá ele aparece
 * agregado por técnico anterior, por solução, por categoria; aqui, nominal —
 * era o que faltava para sair do "383 reparos voltaram" e chegar em QUAIS.
 * Conferido em agosto/2026: 192 + 108 + 83 = 383 nos dois lados.
 *
 * ⚠️ OLHA PARA TRÁS (`lag`), não para frente. A pergunta simétrica — "este
 * reparo ainda vai voltar?" — é inutilizável perto do presente: um reparo de
 * 28/08 teve três dias para voltar, então tudo cai em ≤30d e as faixas de 60 e
 * 90 vêm zeradas. Medido: 121 voltas adiante em agosto/2026, 100% em ≤30d,
 * contra 383 retornos legítimos olhando para trás. Por isso os 90 dias extras
 * são carregados ANTES do recorte, e não depois.
 *
 * ⚠️ PREVENTIVA NÃO ENTRA, nem como reparo atual nem como anterior — mesma
 * regra de ofensores.ts. Ela é ação nossa, planejada; se o cliente abre reparo
 * depois, isso é qualidade da preventiva e mora na aba Preventivos, com a
 * coluna `Reincidiu em`. As duas colunas nunca preenchem na mesma linha, e é
 * assim que tem de ser.
 *
 * ⚠️ A CHAVE É A INSTALAÇÃO (login PPPoE), não o cliente: um corporativo com 55
 * pontos faria o reparo do ponto A contar como retorno do ponto B.
 */
async function retornoPorProtocolo(f: Filtros): Promise<Map<number, Retorno>> {
  const params: unknown[] = []
  const p = (v: unknown) => `$${params.push(v)}`
  const de = p(f.de)
  const ate = p(f.ate)
  const tiposPrev = `${p([...TIPOS_PREVENTIVOS])}::text[]`
  const catsPrev = `${p([...CATEGORIAS_PREVENTIVAS])}::text[]`
  const catalogos = `${p([...CATALOGOS_MANUTENCAO])}::text[]`
  const tiposFora = `${p([...TIPOS_FORA_DA_MANUTENCAO])}::text[]`
  const equipesFora = `${p([...EQUIPES_FORA_DA_MANUTENCAO])}::bigint[]`

  const sql = /* sql */ `
    WITH universo AS (
      -- 90 dias ANTES do recorte: o reparo do primeiro dia precisa ter o
      -- anterior dele disponível, senão apareceria como primeira visita da
      -- instalação e nunca seria marcado como retorno.
      SELECT ai.protocol,
             a.created,
             coalesce(ac."user", 'tag:' || ai.contract_service_tag_id::text) AS instalacao,
             -- QUEM FOI AO CLIENTE, mesma regra da página de Ofensores: é este
             -- nome que vira "técnico ofensor" na linha do retorno. Sair do
             -- responsible_id aqui repetiria o defeito que a auditoria de
             -- Produtividade achou em 16/10/2026 — backoffice levando crédito
             -- de campo —, só que com o sinal trocado: levando CULPA.
             coalesce(ex.executor, resp.name) AS tecnico,
             (coalesce(it.title, '')   = any(${tiposPrev})
           OR coalesce(cat2.title, '') = any(${catsPrev})) AS eh_preventiva
        FROM erp.assignment_incidents ai
        JOIN erp.assignments a              ON a.id = ai.assignment_id
        LEFT JOIN erp.incident_status st    ON st.id = ai.incident_status_id
        LEFT JOIN erp.incident_types it     ON it.id = ai.incident_type_id
        LEFT JOIN erp.catalog_services cs   ON cs.id = ai.catalog_service_id
        LEFT JOIN erp.solicitation_category_matrices scm
               ON scm.id = ai.solicitation_category_matrix_id
        LEFT JOIN erp.solicitation_service_categories cat2
               ON cat2.id = scm.service_category_id_2
        LEFT JOIN LATERAL (
          SELECT x."user"
            FROM erp.authentication_contracts x
           WHERE x.service_tag_id = ai.contract_service_tag_id
           ORDER BY x.active DESC NULLS LAST, x.id DESC
           LIMIT 1
        ) ac ON true
        LEFT JOIN erp.people resp ON resp.id = a.responsible_id
        LEFT JOIN LATERAL (
          SELECT (array_agg(v.resource_name ORDER BY ${ORDEM_EXECUTOR})
                    FILTER (WHERE v.routing_status >= 4))[1] AS executor
            FROM erp.v_service_desk_slots_productivity_informative v
           WHERE v.assignment_id = a.id
        ) ex ON true
       WHERE a.created >= (${de}::date - interval '90 days')
         AND a.created <  (${ate}::date + interval '1 day')
         AND cs.title = any(${catalogos})
         AND coalesce(st.title, '') <> 'Cancelado'
         AND ai.contract_service_tag_id IS NOT NULL
         -- o registro inicial do Suporte vira reparo depois; mantê-lo aqui
         -- FABRICARIA retorno, porque o par (registro, reparo) da mesma
         -- instalação parece "voltou em poucos dias" sendo a MESMA ocorrência.
         AND coalesce(it.title, '') <> all(${tiposFora})
         AND coalesce(ai.team_id, -1) <> all(${equipesFora})
    ),
    reparos AS (SELECT * FROM universo WHERE NOT eh_preventiva),
    vizinhos AS (
      SELECT r.protocol, r.created,
             lag(r.created)  OVER w AS ant_created,
             lag(r.protocol) OVER w AS ant_protocol,
             lag(r.tecnico)  OVER w AS ant_tecnico
        FROM reparos r
      WINDOW w AS (PARTITION BY r.instalacao ORDER BY r.created, r.protocol)
    )
    SELECT protocol::bigint AS protocolo,
           CASE
             WHEN ant_created IS NULL                            THEN NULL
             WHEN created <= ant_created + interval '30 days'    THEN '≤30d'
             WHEN created <= ant_created + interval '60 days'    THEN '31–60d'
             WHEN created <= ant_created + interval '90 days'    THEN '61–90d'
             ELSE NULL
           END AS faixa,
           -- só mostra o anterior quando ele explica o retorno; um atendimento
           -- de 8 meses atrás não é "o par" de nada.
           CASE
             WHEN ant_created >= created - interval '90 days'
             THEN ant_protocol::text
           END AS anterior,
           -- pelo mesmo critério do protocolo anterior: só aparece quando ele
           -- EXPLICA o retorno. Nome de pessoa pendurado num atendimento de 8
           -- meses atrás seria acusação sem nexo.
           CASE
             WHEN ant_created >= created - interval '90 days'
             THEN ant_tecnico
           END AS tecnico_anterior
      FROM vizinhos
     WHERE created >= ${de}::date
       AND created <  (${ate}::date + interval '1 day')`

  const { rows } = await consultarErp<{
    protocolo: string
    faixa: string | null
    anterior: string | null
    tecnico_anterior: string | null
  }>(sql, params)
  return new Map(
    rows.map((r) => [
      Number(r.protocolo),
      { faixa: r.faixa, anterior: r.anterior, tecnicoAnterior: r.tecnico_anterior },
    ])
  )
}

type Reincidencia = { rotulo: string | null; qtd: number }

/**
 * A reincidência de CADA preventiva do recorte, por protocolo.
 *
 * MESMA REGRA DA TELA DE PREVENTIVOS, e isso é o ponto: a faixa é a do PRIMEIRO
 * reparo posterior na mesma instalação. Enquanto as duas telas classificavam
 * diferente, os mesmos protocolos caíam em faixas diferentes de cada lado e os
 * totais nunca fechavam — foi o que a Manutenção cobrou em 01/09/2026 ao pedir
 * "os 20 protocolos da tela de preventivos na aba de protocolos".
 *
 * UMA PASSADA, SEM CRUZAMENTO. Preventivas e reparos entram no MESMO conjunto e
 * a window function olha para frente. As versões que cruzavam dois conjuntos
 * (7.813 reparos × 3.019 preventivas) custavam 4,35 s só para montar os CTEs;
 * esta custa ~550 ms no mesmo recorte de 90 dias.
 *
 * ⚠️ O CTE carrega 91 dias ALÉM do fim do recorte. Sem isso a preventiva do
 * último dia nunca acharia o reparo que a invalida, e a taxa cairia sozinha
 * perto da borda — defeito silencioso, que melhora o indicador por enxergar
 * menos.
 *
 * ⚠️ Os recortes de tipo/equipe/cidade NÃO entram aqui de propósito, pela mesma
 * razão documentada em preventivos.ts: estreitar este conjunto apagaria reparos
 * do lookup, e a preventiva cujo retorno viesse por um protocolo excluído
 * passaria a contar como "sem retorno". Quem decide o que ENTRA NA TELA é o
 * universo da consulta principal.
 */
async function reincidenciaPorProtocolo(f: Filtros): Promise<Map<number, Reincidencia>> {
  const params: unknown[] = []
  const p = (v: unknown) => `$${params.push(v)}`
  const de = p(f.de)
  const ate = p(f.ate)
  const tiposPrev = `${p([...TIPOS_PREVENTIVOS])}::text[]`
  const catsPrev = `${p([...CATEGORIAS_PREVENTIVAS])}::text[]`
  const catalogos = `${p([...CATALOGOS_MANUTENCAO])}::text[]`

  const sql = /* sql */ `
    WITH universo AS (
      SELECT ai.protocol,
             a.created,
             -- A INSTALAÇÃO, não o cliente: um corporativo com 55 pontos teria a
             -- preventiva de um ponto invalidada pelo reparo de outro, em outra
             -- cidade. LIMIT 1 porque authentication_contracts é 1:N por tag (há
             -- tags com 2.050 contratos) e o join direto duplicaria a preventiva,
             -- espalhando o mesmo protocolo por duas partições.
             coalesce(ac."user", 'tag:' || ai.contract_service_tag_id::text) AS instalacao,
             (coalesce(it.title, '')   = any(${tiposPrev})
           OR coalesce(cat2.title, '') = any(${catsPrev})) AS eh_preventiva
        FROM erp.assignment_incidents ai
        JOIN erp.assignments a              ON a.id = ai.assignment_id
        LEFT JOIN erp.incident_status st    ON st.id = ai.incident_status_id
        LEFT JOIN erp.incident_types it     ON it.id = ai.incident_type_id
        LEFT JOIN erp.catalog_services cs   ON cs.id = ai.catalog_service_id
        LEFT JOIN erp.solicitation_category_matrices scm
               ON scm.id = ai.solicitation_category_matrix_id
        LEFT JOIN erp.solicitation_service_categories cat2
               ON cat2.id = scm.service_category_id_2
        LEFT JOIN LATERAL (
          SELECT x."user"
            FROM erp.authentication_contracts x
           WHERE x.service_tag_id = ai.contract_service_tag_id
           ORDER BY x.active DESC NULLS LAST, x.id DESC
           LIMIT 1
        ) ac ON true
       WHERE a.created >= ${de}::date
         AND a.created <  (${ate}::date + interval '91 days')
         AND cs.title = any(${catalogos})
         AND coalesce(st.title, '') <> 'Cancelado'
         AND ai.contract_service_tag_id IS NOT NULL
    ),
    marcado AS (
      SELECT u.protocol, u.created, u.eh_preventiva,
             min(u.created) FILTER (WHERE NOT u.eh_preventiva) OVER (
               PARTITION BY u.instalacao ORDER BY u.created
               ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING
             ) AS proximo_reparo,
             -- quantos retornos em 90 dias. É a coluna "Retornos" da tela, e é
             -- ela que mostra o caso de mais de um retorno no período — o que o
             -- rótulo, agora de faixa única, deixou de dizer.
             count(*) FILTER (WHERE NOT u.eh_preventiva) OVER (
               PARTITION BY u.instalacao ORDER BY u.created
               RANGE BETWEEN CURRENT ROW AND interval '90 days' FOLLOWING
             ) AS retornos
        FROM universo u
    )
    SELECT protocol::bigint AS protocolo,
           CASE
             WHEN proximo_reparo IS NULL                                  THEN NULL
             WHEN proximo_reparo <= created + interval '30 days'          THEN '≤30d'
             WHEN proximo_reparo <= created + interval '60 days'          THEN '31–60d'
             WHEN proximo_reparo <= created + interval '90 days'          THEN '61–90d'
             ELSE NULL
           END AS rotulo,
           retornos::int AS qtd
      FROM marcado
     WHERE eh_preventiva
       AND created >= ${de}::date
       AND created <  (${ate}::date + interval '1 day')`

  const { rows } = await consultarErp<{ protocolo: string; rotulo: string | null; qtd: number }>(
    sql,
    params
  )
  return new Map(rows.map((r) => [Number(r.protocolo), { rotulo: r.rotulo, qtd: r.qtd }]))
}

/**
 * Mesmo universo, SÓ o colaborador no papel de cliente — a diferença declarada
 * contra o export do Voalle.
 *
 * ⚠️ `incluirClienteTeste` é obrigatório aqui. Desde 02/09/2026 `montarWhere`
 * exclui essas linhas por padrão; sem suspender a regra, este contador pediria
 * "as linhas que já foram removidas" e devolveria zero para sempre — o cartão
 * da tela passaria a dizer que nada foi excluído justamente quando algo foi.
 */
async function contarExcluidosTeste(f: Filtros): Promise<number> {
  const { sql: where, params } = montarWhere(f, { incluirClienteTeste: true })
  const p = (v: unknown) => `$${params.push(v)}`
  const clientesTeste = `${p([...CLIENTES_TESTE])}::text[]`

  const sql = /* sql */ `
    SELECT count(*)::int AS n
    ${montarFrom({ agenda: Boolean(f.base) || f.eixo === 'agenda', categorias: Boolean(f.categoria2) })}
    ${where}
      AND coalesce(p.name, '') = any(${clientesTeste})`

  const { rows } = await consultarErp<{ n: number }>(sql, params)
  return rows[0]?.n ?? 0
}
