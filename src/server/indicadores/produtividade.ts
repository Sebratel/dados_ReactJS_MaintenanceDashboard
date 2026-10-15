import { consultarErp } from '@/server/db/erp'
import {
  AUXILIARES_PLACEHOLDER,
  MOTIVOS_IMPRODUTIVIDADE,
  REGEX_CODIGO_IMPRODUTIVIDADE,
  CLIENTES_TESTE,
  STATUS_ENCERRADO,
  TIPOS_CAMPO,
  type GrupoImprodutividade,
} from '@/config/regras-negocio'
import type { Filtros } from '@/lib/filtros'

/**
 * Produtividade de campo (docs/01 §4). Conferido contra o Power BI atual.
 *
 * TRÊS CONTADORES INDEPENDENTES, e nenhum é status excludente do protocolo —
 * são três respostas a três perguntas sobre a mesma VISITA:
 *
 *   PRODUTIVO   = protocolo ENCERROU no dia da visita.
 *   IMPRODUTIVA = CADA relato com classificação inserida (`MAN.xxx - IMPROD` /
 *                 `INST.xxx - IMPROD`) é a SUA PRÓPRIA visita. Um protocolo
 *                 que perdeu duas visitas de manhã e fechou à tarde conta 1
 *                 produtivo E 2 improdutivas — foram três idas a campo.
 *   SEM AÇÃO    = agendado, não encerrou e não teve NENHUM relato classificado
 *                 naquele dia.
 *
 * ⚠️ REGRA "CONTA VISITA" CONFIRMADA EM 03/09/2026, depois de a Manutenção
 * comparar protocolo a protocolo contra o Power BI: *"a regra não é conta dia,
 * é conta VISITA... se técnico foi 3x no cliente afetou capacidade, tempo,
 * etc."* Antes deste ajuste, um dia com 3 relatos classificados só contava 1
 * improdutiva — o dia colapsava em cima do relato, e a segunda e terceira
 * idas a campo desapareciam do total.
 *
 * ⚠️ PROTOCOLO CANCELADO CONTA — decisão explícita da mesma conversa: *"sim
 * protocolo cancelado também vai contar, o BI já conta."* Nunca houve filtro
 * de Cancelado aqui (ver a nota no CTE `matriz_base`); agora está documentado
 * como escolha, não como omissão.
 *
 * A DEDUPLICAÇÃO QUE PROTEGE A CONTAGEM: dois relatos idênticos no MESMO
 * segundo (mesmo protocolo, mesma descrição, `id`s diferentes) são bug de
 * duplo toque no app, não duas visitas — confirmado nos protocolos 1732559
 * (5 relatos idênticos), 1767832 e 1788646 (2 cada). O CTE `improd` colapsa
 * esses casos por `DISTINCT`; relatos em segundos DIFERENTES no mesmo dia
 * continuam visitas distintas, que é exatamente o que a regra pede.
 *
 * O TÉCNICO É O DA VISITA, NÃO O TITULAR DO PROTOCOLO — e essa é a correção
 * mais importante que este arquivo já sofreu. Vale a pena contar por quê.
 *
 * A versão anterior creditava toda visita ao `assignments.responsible_id`. Isso
 * reproduzia o Power BI número por número, e mesmo assim estava errado: o
 * titular é UM por protocolo, mas um protocolo pode ter DUAS visitas de DOIS
 * técnicos. O caso que derrubou a regra é o 1720002 — LETIERE foi no dia 02/07 e
 * deu MAN.005 (reagenda por chuva); LUCAS foi no dia 03/07 e executou. O ERP
 * então gravou LUCAS como responsável, e a improdutiva do LETIERE caía no LUCAS.
 *
 * E não é caso raro, é o caso TÍPICO: toda improdutiva gera reagendamento, todo
 * reagendamento passa pelo backoffice, e o backoffice vira o responsável. Medido
 * em julho/2026: **191 das 334 improdutivas (57%) estavam na pessoa errada** e
 * EDSON SILVA DOS SANTOS — que é administrativo e nunca foi a campo — aparecia
 * com 68 improdutivas, 20% de tudo que a operação perdeu no mês.
 *
 * `resource_name` DA VIEW É A FONTE CERTA, e eu a havia descartado por uma
 * medição contaminada. O que me fez descartá-la foi ver um recurso em 1.103
 * protocolos de julho (35/dia, impossível para um técnico). Mas isso conta as
 * linhas de `routing_status = 0`, que são a SUGESTÃO do roteirizador — quem
 * aparecia 1.103 vezes era o roteirizador, não um técnico. Refeita a medição só
 * com as linhas reservadas/executadas (`routing_status >= 4`), o topo cai para
 * 6,2 protocolos/dia, exatamente a ordem de grandeza plausível. Conferido também
 * contra o autor do relato de campo do dia: bate em 8 de 9 casos amostrados.
 *
 * Por isso o CTE `slots` resolve o executor POR (protocolo × dia). Quando o dia
 * não tem linha reservada (17 visitas em 3.948), cai no titular.
 *
 * O AUXILIAR TAMBÉM É POR VISITA, pelo mesmo motivo e pelo mesmo caminho. Eu
 * havia dito que a perna RAUX não registrava a qual dia pertence — estava
 * errado. Ela registra: das visitas de manutenção com perna RAUX, 731 de 739
 * (98,9%) têm o relato no MESMO DIA da visita, e na Instalação — que é aderente,
 * 97% das visitas com perna — 2.704 de 2.998 (90,2%). O ERP ARMAZENA a dupla com
 * data; o que falta na Manutenção é PREENCHIMENTO (20% das visitas normais, 12%
 * das improdutivas).
 *
 * Daí a regra que a Manutenção pediu: **quando o dia da visita não tem registro
 * de dupla, a visita fica só com o executor**. Creditar o auxiliar do dia
 * seguinte numa improdutiva que ele não viveu geraria desordem maior que a
 * lacuna. Onde o registro EXISTE no dia da improdutiva (40 visitas em julho), a
 * dupla é creditada normalmente — os dois contam produtivo ou improdutivo.
 *
 * ⚠️ O EIXO DE DATA AQUI É SEMPRE O DIA DA AGENDA. A matriz É por dia agendado;
 * contar visita por data de criação do protocolo não significaria nada.
 */

/** Desfecho do protocolo-dia. Improdutiva é contada em separado, não aqui. */
export type StatusDia = 'Produtivo' | 'Sem Ação'

/** `nivel` separa as duas visões que vêm no mesmo resultado. */
type LinhaMatriz = {
  nivel: 'visita' | 'credito'
  dia: string
  tecnico: string | null
  papel: 'Principal' | 'Auxiliar' | null
  base: string | null
  catalogo: string | null
  /** encerrou neste dia */
  instalado: boolean
  /**
   * Esta LINHA é uma visita improdutiva — não "o dia teve alguma". Cada
   * relato classificado gera a sua própria linha (ver `eventos_improd`), então
   * um dia com 3 relatos aparece como 3 linhas com `improdutiva: true`.
   */
  improdutiva: boolean
  motivo: string | null
  /**
   * Só true na linha de PRODUTIVO/SEM AÇÃO do dia (nunca nas linhas de
   * `eventos_improd`) — evita que a expansão de N linhas por dia infle Sem
   * Ação. Ver a nota do CTE `matriz`.
   */
  conta_sem_acao: boolean
  protocolos: number
  /** só no nível 'visita': visitas com auxiliar real identificado */
  com_dupla: number
  /** só no nível 'visita': visitas com qualquer registro na perna RAUX */
  com_registro: number
}

export type MedidasProdutividade = {
  produtivo: number
  improdutivo: number
  semAcao: number
  /** Produtivo + Improdutivo + Sem Ação */
  totalVisitas: number
  /** exclui Sem Ação — é o denominador da assertividade "de campo" */
  totalVisitasReais: number
  /** Produtivo ÷ Total Visitas */
  assertividadeVisita: number | null
  /** Produtivo ÷ Total Visitas Reais */
  assertividadeCampo: number | null
}

export type PontoProdutividadeDia = MedidasProdutividade & { dia: string }

export type ItemTecnico = MedidasProdutividade & {
  tecnico: string
  /** quanto da produção veio como auxiliar da dupla */
  comoAuxiliar: number
  /** dias distintos em que o técnico teve ao menos um produtivo */
  diasProdutivos: number
  /** Produtivo ÷ dias produtivos — a "média diária de reparos" do Power BI */
  mediaDiaria: number | null
  /**
   * Improdutivas do técnico quebradas por família de motivo, para a tela poder
   * abonar chuva/cliente/infra sem mexer no total da operação.
   */
  improdutivoPorGrupo: Record<string, number>
}

export type ItemMotivo = {
  codigo: string
  rotulo: string
  grupo: GrupoImprodutividade | 'Não classificado'
  visitas: number
  share: number
}

export type ItemBase = MedidasProdutividade & { base: string }

export type ItemCatalogo = MedidasProdutividade & { catalogo: string }

export type ResultadoProdutividade = {
  data: {
    total: MedidasProdutividade & {
      protocolosBase: number
      /**
       * Produtivos ÷ Σ(dias produtivos de cada técnico como TITULAR).
       *
       * Mesma conta da medida `Média Reparos Produtivos Time` do Power BI,
       * confirmada termo a termo em 15/10/2026 — `DIVIDE([Produtivo],
       * SUMX(VALUES(Técnico), CALCULATE(DISTINCTCOUNT(Dia), Status="Produtivo")))`.
       *
       * ⚠️ NÃO CONFUNDIR COM A PRODUÇÃO DIÁRIA DA OPERAÇÃO. Em setembro/2026
       * esta medida dá 5,37 (3.842 ÷ 715 dias-técnico); a produção diária da
       * operação dá 128,07 (3.842 ÷ 30 dias). O Power BI chama as duas de
       * "Média Diária Produtivos" em visuais diferentes, e é por isso que o
       * cartão exibe o denominador: lendo o card dá para refazer a conta.
       */
      mediaReparosTime: number | null
      /** o denominador de `mediaReparosTime`, exibido para o número ser auditável */
      diasTimeSomados: number
      tecnicosAtivos: number
      /** visitas com auxiliar real identificado — cobertura do crédito */
      visitasComDupla: number
      /**
       * Visitas com QUALQUER registro na perna RAUX, inclusive "SEM AUXILIAR".
       * Mede adesão ao PROCESSO, que é diferente de cobertura do crédito: quem
       * declara que foi sozinho cumpriu o processo e não gera crédito de dupla.
       */
      visitasComRegistro: number
    }
    porDia: PontoProdutividadeDia[]
    porTecnico: ItemTecnico[]
    porBase: ItemBase[]
    porCatalogo: ItemCatalogo[]
    motivos: ItemMotivo[]
  }
  meta: { linhasMatriz: number }
  ms: number
}

function medidasVazias(): MedidasProdutividade {
  return {
    produtivo: 0,
    improdutivo: 0,
    semAcao: 0,
    totalVisitas: 0,
    totalVisitasReais: 0,
    assertividadeVisita: null,
    assertividadeCampo: null,
  }
}

/** Fecha as medidas derivadas depois que os três contadores estão somados. */
function fechar(m: MedidasProdutividade): MedidasProdutividade {
  m.totalVisitas = m.produtivo + m.improdutivo + m.semAcao
  m.totalVisitasReais = m.produtivo + m.improdutivo
  m.assertividadeVisita = m.totalVisitas > 0 ? m.produtivo / m.totalVisitas : null
  m.assertividadeCampo =
    m.totalVisitasReais > 0 ? m.produtivo / m.totalVisitasReais : null
  return m
}

/**
 * Acumula os três contadores a partir de TRÊS sinais independentes, um por
 * contador — não dois booleanos exclusivos como antes. A independência é o
 * que permite `improdutivo` crescer além de 1 por dia: cada linha de
 * `eventos_improd` aciona SÓ `improdutivo`; a linha de PRODUTIVO/SEM AÇÃO do
 * dia aciona `produtivo` OU `semAcao`, nunca `improdutivo`. Ver os CTEs
 * `matriz_base` / `eventos_improd` / `matriz`.
 */
function acumular(
  m: MedidasProdutividade,
  l: { instalado: boolean; improdutiva: boolean; conta_sem_acao: boolean },
  n: number
): void {
  if (l.instalado) m.produtivo += n
  if (l.improdutiva) m.improdutivo += n
  if (l.conta_sem_acao) m.semAcao += n
}

export async function obterProdutividade(f: Filtros): Promise<ResultadoProdutividade> {
  const params: unknown[] = []
  const p = (v: unknown) => `$${params.push(v)}`

  const de = p(f.de)
  const ate = p(f.ate)
  const tipos = p([...TIPOS_CAMPO])
  const encerrado = p([...STATUS_ENCERRADO])
  const regexCodigo = p(REGEX_CODIGO_IMPRODUTIVIDADE)
  const clientesTeste = `${p([...CLIENTES_TESTE])}::text[]`
  const auxPlaceholder = `${p([...AUXILIARES_PLACEHOLDER])}::text[]`

  // filtros que a view resolve sozinha — aplicados o mais cedo possível, para
  // encolher o conjunto antes dos joins
  const cond: string[] = []
  // a view já tem a base: filtrar aqui encolhe o conjunto antes de tudo
  if (f.base) cond.push(`v.region_title = any(${p(f.base)})`)
  if (f.tipo) cond.push(`v.incident_type_title = any(${p(f.tipo)})`)
  /**
   * ⚠️ O FILTRO DE STATUS NÃO É APLICADO AQUI, E ISSO É A REGRA, NÃO UM FURO.
   *
   * Esta página conta VISITA, não DEMANDA: a ida ao cliente aconteceu mesmo que
   * o protocolo tenha sido cancelado depois. É a decisão explícita da Manutenção
   * em 03/09/2026 — "protocolo cancelado também vai contar, o BI já conta" — e
   * está escrita de novo, em maiúsculas, no CTE `matriz_base` lá embaixo.
   *
   * O PROBLEMA ERA QUE A BARRA PODIA REVOGAR ESSA REGRA SEM NINGUÉM PERCEBER.
   * `status` é filtro global: quem vem de Tempos ou Preventivos — onde excluir
   * Cancelado está certo — chega aqui com ele ligado, e a página passava a
   * contrariar o próprio critério em silêncio.
   *
   * Medido no batimento de setembro/2026 contra o BI (15/10/2026). Com
   * `status=Agendado~Andamento~Encerrado` herdado da aba anterior:
   *
   *   produtivos ....... 0 a menos  (cancelado nunca é produtivo: exige
   *                                  encerramento no dia da visita)
   *   improdutivas .... 34 a menos
   *   sem ação ........ 33 a menos
   *   ---------------------------------
   *   67 visitas somem, e a tela não dizia nada.
   *
   * Era a diferença INTEIRA contra o Power BI nesta página: sem o filtro, os
   * 3.842 produtivos e as 392 improdutivas batem exatamente.
   *
   * A barra mostra o controle inerte em vez de escondê-lo — quem trouxe o
   * filtro vê que ele está lá e que aqui não vale. Ver BarraFiltros.
   */
  const filtroSlots = cond.length ? `AND ${cond.join(' AND ')}` : ''

  // filtros que exigem descer no protocolo. `tecnico` entra aqui, e não na view:
  // a dimensão de técnico é o executor resolvido POR VISITA (ver nota no CTE
  // `slots`), e ele só existe depois do agrupamento por protocolo × dia.
  const condProto: string[] = []
  if (f.cidade) condProto.push(`pe.city = any(${p(f.cidade)})`)
  if (f.catalogo) condProto.push(`cs.title = any(${p(f.catalogo)})`)
  if (f.tecnico) {
    // filtrar por técnico tem de alcançar as visitas em que ele foi AUXILIAR:
    // a produção dele é principal + auxiliar, então um filtro só no principal
    // esconderia parte do próprio trabalho da pessoa filtrada.
    const alvo = p(f.tecnico)
    condProto.push(
      `(coalesce(s.executor, resp.name) = any(${alvo}) OR paux.name = any(${alvo}))`
    )
  }
  if (f.equipe) condProto.push(`t.title = any(${p(f.equipe)})`)
  if (f.categoria2) condProto.push(`cat2.title = any(${p(f.categoria2)})`)
  const filtroProto = condProto.length ? `AND ${condProto.join(' AND ')}` : ''

  // Os joins de categoria custam caro e a maioria dos acessos não filtra por
  // categoria; só entram quando o filtro está de fato em uso. Mesma lógica do
  // FROM composável de base.ts.
  const joinCategoria = f.categoria2
    ? /* sql */ `
        LEFT JOIN erp.solicitation_category_matrices scm ON scm.id = ai.solicitation_category_matrix_id
        LEFT JOIN erp.solicitation_service_categories cat2 ON cat2.id = scm.service_category_id_2`
    : ''

  const sql = /* sql */ `
    WITH slots AS (
      -- VISITAS: um registro por (protocolo x dia agendado). A view e 1:N em
      -- slots por dia; agregamos para que uma visita em dupla continue sendo
      -- UMA visita para a empresa.
      SELECT v.assignment_id,
             max(v.protocol) AS protocolo,
             date_trunc('day', v.begin_date_slot)::date AS dia,
             max(v.region_title) AS base,
             -- O EXECUTOR DESTE DIA. O FILTER e o que separa quem foi ao cliente
             -- de quem o roteirizador sugeriu: routing_status 0 e proposta, >= 4
             -- e slot reservado de fato. Sem ele voltariamos a ver o
             -- roteirizador com 35 atendimentos/dia.
             (array_agg(v.resource_name ORDER BY v.routing_status DESC)
                FILTER (WHERE v.routing_status >= 4))[1] AS executor
        FROM erp.v_service_desk_slots_productivity_informative v
       WHERE v.begin_date_slot >= ${de}::date
         AND v.begin_date_slot < (${ate}::date + interval '1 day')
         /*
          * ESTA TELA RECORTA POR TIPO; TODAS AS OUTRAS RECORTAM POR
          * EQUIPE/CATALOGO. E DELIBERADO -- NAO E ESQUECIMENTO.
          *
          * A divergencia ficou aberta um mes como item A de docs/06, sob a
          * suspeita de que o recorte por tipo deixava entrar trabalho que nao e
          * manutencao. MEDIDA em jun-ago/2026 (15/09/2026), no grao de visita:
          *
          *   visitas hoje (por tipo) ................. 11.614
          *   visitas no recorte por equipe/catalogo .. 11.606
          *   sairiam ................................. 10   (0,086%)
          *   entrariam ...............................  2
          *
          * NENHUMA das 10 sai por catalogo -- a suspeita original nao ocorre.
          * Todas saem por EQUIPES_FORA_DA_MANUTENCAO, que esta tela nao
          * aplica. E nao aplicar esta CERTO, porque as duas telas respondem
          * perguntas diferentes:
          *
          *   - No MTTR, excluir COR/CGR/Suporte esta certo: enquanto o
          *     protocolo esta com a central, o tempo medido e dela e nao do
          *     campo (item M de docs/06).
          *   - Aqui, quando um tecnico de campo VAI AO CLIENTE num protocolo do
          *     COR, aquilo e producao DELE. Quem esta sendo medido e o tecnico,
          *     nao o protocolo.
          *
          * As 10 foram conferidas relato a relato: deslocamento iniciado e
          * encerrado, tecnico nomeado, motivo classificado (MAN.002 - IMPROD -
          * REAGENDA CLI (COM VISITA), "cliente nao pode receber no momento").
          * Sao improdutivas REAIS em base de Manutencao. Unificar apagaria
          * trabalho que aconteceu, melhorando o indicador por enxergar menos.
          *
          * E pioraria pelo outro lado tambem: as 2 que ENTRARIAM sao do
          * protocolo 1735660 (equipe Financeiro, tipo CX - ATENDIMENTO
          * PRIORITARIO 72H), roteirizado para a trilha de ATIVACAO -- o mesmo
          * que fez a "Base Sao Leopoldo (Ativacao)" aparecer no combo e que
          * opcoes.ts tirou de la por nao pertencer a operacao.
          *
          * ⚠️ QUEM FOR "ARRUMAR" A FRAGMENTACAO DE UNIVERSO: esta tela e a
          * excecao justificada, nao a pendencia. Medir de novo antes de mexer.
          */
         AND v.incident_type_title = any(${tipos})
         ${filtroSlots}
       GROUP BY v.assignment_id, 3
    ),
    auxiliar AS (
      -- O SEGUNDO TECNICO DA DUPLA, AMARRADO AO DIA DA VISITA.
      --
      -- Fica numa assignment SEPARADA, com assignment_type = 'RAUX' ("Atendimento
      -- offline - Auxiliares do atendimento"), e o auxiliar e o autor do relato
      -- dessa perna (reports.person_id).
      --
      -- O VINCULO E O NUMERO DO PROTOCOLO EM reports.tags, nao
      -- corresponding_parent_id. Testado: o join
      -- assignments.id = raux.corresponding_parent_id devolve ZERO linhas -- esse
      -- campo aponta para outro espaco de ids (o #7668096 do titulo). Ja
      -- reports.tags e 100% numerico nas pernas RAUX e casa com v.protocol.
      --
      -- POR QUE POR DIA E NAO POR PROTOCOLO. A versao anterior pegava UM auxiliar
      -- por protocolo (o relato mais recente) e o creditava em TODAS as visitas
      -- daquele protocolo. Num protocolo reagendado isso dava a improdutiva da
      -- visita perdida ao auxiliar da visita seguinte -- alguem que nao estava
      -- la. A Manutencao vetou: quando o dado da dupla nao existe na improdutiva,
      -- ela fica so com o executor.
      --
      -- E DA PARA AMARRAR PORQUE A DATA EXISTE. Medido em julho/2026: das visitas
      -- de manutencao com perna RAUX, 731 de 739 (98,9%) tem o relato no MESMO
      -- DIA da visita; na Instalacao, que e aderente, 2.704 de 2.998 (90,2%).
      -- Ou seja o ERP ARMAZENA a data da dupla -- o que falta na Manutencao e
      -- PREENCHIMENTO (20% das visitas normais, 12% das improdutivas).
      SELECT DISTINCT ON (r.tags::bigint, date_trunc('day', r.beginning_date)::date)
             r.tags::bigint AS protocolo,
             date_trunc('day', r.beginning_date)::date AS dia,
             r.person_id
        FROM erp.assignments raux
        JOIN erp.reports r ON r.assignment_id = raux.id
       WHERE raux.assignment_type = 'RAUX'
         AND r.tags ~ '^[0-9]+$'
         -- a perna nasce junto do atendimento; a folga cobre quem registra depois
         AND raux.created >= (${de}::date - interval '60 days')
         AND raux.created < (${ate}::date + interval '60 days')
       ORDER BY r.tags::bigint,
                date_trunc('day', r.beginning_date)::date,
                r.beginning_date DESC, r.id DESC
    ),
    improd AS MATERIALIZED (
      -- Uma linha por RELATO IMPRODUTIVO CLASSIFICADO -- e' o grao de VISITA,
      -- nao de dia: se o tecnico foi 3x ao cliente e as 3 tiveram codigo
      -- MAN.xxx/INST.xxx - IMPROD, sao 3 visitas improdutivas, nao 1.
      --
      -- REGRA "CONTA VISITA" CONFIRMADA EM 03/09/2026, apos a Manutencao
      -- auditar o Power BI protocolo a protocolo: "a regra nao e conta dia,
      -- e conta VISITA... se tecnico foi 3x no cliente afetou capacidade,
      -- tempo, etc." Ate aqui este CTE colapsava tudo num maximo de 1
      -- improdutiva por dia (GROUP BY assignment_id, dia); agora cada relato
      -- classificado vira sua propria linha.
      --
      -- DISTINCT, nao GROUP BY: colapsa so quando (protocolo, dia, timestamp,
      -- motivo) sao IDENTICOS -- o sinal de duplicidade de envio do app (dois
      -- toques na mesma tela), ja confirmado nos protocolos 1732559 (5x),
      -- 1767832 e 1788646 (2x cada, mesmo segundo, id diferente). Relatos em
      -- segundos DIFERENTES no mesmo dia permanecem visitas distintas -- e'
      -- exatamente o caso que a Manutencao pediu para contar.
      --
      -- MATERIALIZED porque este CTE e' usado DUAS vezes daqui pra baixo (a
      -- EXISTS de matriz_base e o JOIN de eventos_improd), e ele carrega o
      -- seq scan mais caro do arquivo (ver a nota de performance no fim). Sem
      -- isso o planejador poderia repetir o LIKE '%IMPROD%' inteiro duas
      -- vezes na mesma consulta.
      SELECT DISTINCT assignment_id, dia, beginning_date, motivo
        FROM (
          SELECT r.assignment_id,
                 date_trunc('day', r.beginning_date)::date AS dia,
                 r.beginning_date,
                 upper(substring(
                   regexp_replace(regexp_replace(r.description, '<[^>]+>', ' ', 'g'),
                                  '&nbsp;', ' ', 'g')
                   from ${regexCodigo})) AS motivo
            FROM erp.reports r
           WHERE r.beginning_date >= ${de}::date
             AND r.beginning_date < (${ate}::date + interval '1 day')
             AND upper(r.description) LIKE '%IMPROD%'
        ) classificados
       WHERE motivo IS NOT NULL
    ),
    matriz_base AS MATERIALIZED (
      -- Uma linha por (protocolo x dia agendado), como sempre foi -- e' quem
      -- decide PRODUTIVO e SEM ACAO, que continuam sendo propriedade do DIA:
      -- o protocolo ou fechou naquele dia, ou nao, independente de quantas
      -- visitas improdutivas ele teve antes.
      --
      -- ⚠️ CANCELADO CONTA. Nunca foi filtrado aqui, e desde 03/09/2026 isso e'
      -- decisao EXPLICITA, nao omissao: "protocolo cancelado tambem vai
      -- contar, o BI ja conta." Produtividade mede VISITA -- a ida aconteceu
      -- --, nao DEMANDA -- se o protocolo sobreviveu. E' a mesma logica que
      -- ja fazia esta pagina contar a visita improdutiva de um protocolo
      -- cancelado com deslocamento registrado (docs/04 item 20).
      --
      -- MATERIALIZED pelo mesmo motivo de improd: referenciado duas vezes
      -- abaixo (no branch de PRODUTIVO/SEM ACAO de matriz e no JOIN de
      -- eventos_improd).
      SELECT s.assignment_id,
             s.dia,
             s.base,
             cs.title AS catalogo,
             -- o executor da visita; o titular so entra quando o dia nao tem
             -- slot reservado (17 visitas em 3.948 no mes conferido)
             coalesce(s.executor, resp.name) AS titular,
             -- placeholder que o app grava quando o tecnico foi sozinho nao e gente
             CASE WHEN paux.name = any(${auxPlaceholder}) THEN NULL ELSE paux.name END
               AS auxiliar,
             -- houve registro na perna RAUX NESTE DIA, inclusive "SEM AUXILIAR".
             -- Distinguir isso de "nao registrou nada" e o que mede adesao ao
             -- processo, separado da cobertura do credito da dupla. Passou a ser
             -- por dia junto com o credito: registro de outro dia nao e adesao
             -- desta visita.
             (ax.protocolo IS NOT NULL) AS tem_registro,
             (date_trunc('day', a.conclusion_date)::date = s.dia
              AND st.title = any(${encerrado})) AS instalado,
             -- so para decidir SEM ACAO mais abaixo -- NAO e' a contagem de
             -- improdutivas, essa vem inteira de eventos_improd
             EXISTS (
               SELECT 1 FROM improd i
                WHERE i.assignment_id = s.assignment_id AND i.dia = s.dia
             ) AS teve_improd
        FROM slots s
        JOIN erp.assignments a           ON a.id = s.assignment_id
        JOIN erp.assignment_incidents ai ON ai.assignment_id = a.id
        LEFT JOIN erp.incident_status st ON st.id = ai.incident_status_id
        LEFT JOIN erp.catalog_services cs ON cs.id = ai.catalog_service_id
        LEFT JOIN erp.teams t            ON t.id  = ai.team_id
        LEFT JOIN erp.people pe          ON pe.id = a.requestor_id
        LEFT JOIN erp.people resp        ON resp.id = a.responsible_id
        LEFT JOIN auxiliar ax            ON ax.protocolo = s.protocolo
                                        AND ax.dia = s.dia
        LEFT JOIN erp.people paux        ON paux.id = ax.person_id
        ${joinCategoria}
       WHERE true ${filtroProto}
        AND coalesce(pe.name, '') <> all(${clientesTeste})
    ),
    eventos_improd AS (
      -- Uma linha POR VISITA IMPRODUTIVA. Reaproveita base/titular/auxiliar do
      -- DIA (e' o mesmo agendamento, a mesma dupla que foi ao cliente), mas
      -- cada relato classificado que sobreviveu ao DISTINCT de improd gera
      -- sua propria linha aqui, com o proprio motivo -- e' o que faz 3
      -- relatos no mesmo dia virarem 3 visitas, nao 1.
      SELECT mb.dia, mb.base, mb.catalogo, mb.titular, mb.auxiliar, mb.tem_registro,
             i.motivo
        FROM improd i
        JOIN matriz_base mb ON mb.assignment_id = i.assignment_id AND mb.dia = i.dia
    ),
    matriz AS (
      -- A UNIAO e' o que separa PRODUTIVO/SEM ACAO (no maximo 1 linha por dia,
      -- de matriz_base) de IMPRODUTIVA (N linhas por dia, de eventos_improd)
      -- sem que um contamine o outro: cada branch aciona SO UM dos tres
      -- contadores -- ver acumular(). Um dia com 1 fechamento e 2
      -- improdutivas produz 3 linhas aqui: 1 com instalado=true, 2 com
      -- improdutiva=true, nenhuma pisando na outra.
      SELECT dia, base, catalogo, titular, auxiliar, tem_registro,
             instalado, false AS improdutiva, NULL::text AS motivo,
             (NOT instalado AND NOT teve_improd) AS conta_sem_acao
        FROM matriz_base
      UNION ALL
      SELECT dia, base, catalogo, titular, auxiliar, tem_registro,
             false AS instalado, true AS improdutiva, motivo,
             false AS conta_sem_acao
        FROM eventos_improd
    )
    -- VISAO DA EMPRESA: uma linha por visita. Somavel.
    SELECT 'visita' AS nivel, dia, NULL::varchar AS tecnico,
           NULL::varchar AS papel, base, catalogo, instalado, improdutiva, motivo,
           conta_sem_acao,
           count(*)::int AS protocolos,
           count(*) FILTER (WHERE auxiliar IS NOT NULL)::int AS com_dupla,
           count(*) FILTER (WHERE tem_registro)::int AS com_registro
      FROM matriz
     GROUP BY 1, dia, base, catalogo, instalado, improdutiva, motivo, conta_sem_acao
    UNION ALL
    -- VISAO DO TECNICO: uma linha por (visita x pessoa creditada). O titular e o
    -- auxiliar recebem crédito INTEGRAL, cada um conta 1 -- inclusive nas
    -- visitas improdutivas, que agora podem ser mais de uma por dia.
    SELECT 'credito' AS nivel, dia, titular AS tecnico,
           'Principal'::varchar AS papel, base, catalogo, instalado, improdutiva,
           motivo, conta_sem_acao, count(*)::int AS protocolos, 0 AS com_dupla, 0 AS com_registro
      FROM matriz WHERE titular IS NOT NULL
     GROUP BY 1, dia, titular, base, catalogo, instalado, improdutiva, motivo, conta_sem_acao
    UNION ALL
    SELECT 'credito' AS nivel, dia, auxiliar AS tecnico,
           'Auxiliar'::varchar AS papel, base, catalogo, instalado, improdutiva,
           motivo, conta_sem_acao, count(*)::int AS protocolos, 0 AS com_dupla, 0 AS com_registro
      FROM matriz WHERE auxiliar IS NOT NULL
     GROUP BY 1, dia, auxiliar, base, catalogo, instalado, improdutiva, motivo, conta_sem_acao`

  const { rows, ms } = await consultarErp<LinhaMatriz>(sql, params)

  // -- rollups em JS -------------------------------------------------------
  // Uma unica varredura no banco alimenta todos os cortes. Rodar cinco queries
  // pagaria a varredura de ~5 s cinco vezes.

  const total = medidasVazias()
  const porDiaMap = new Map<string, MedidasProdutividade>()
  const porBaseMap = new Map<string, MedidasProdutividade>()
  const porCatMap = new Map<string, MedidasProdutividade>()
  const motivoMap = new Map<string, number>()

  type AcumTecnico = MedidasProdutividade & {
    dias: Set<string>
    porGrupo: Map<string, number>
    auxiliar: number
  }
  const porTecMap = new Map<string, AcumTecnico>()

  // Denominador de `mediaReparosTime` — SÓ dias como TITULAR (papel Principal).
  // A Manutenção pediu explicitamente para não incluir dupla aqui: o auxiliar
  // credita a produção dele mesmo (ver `AcumTecnico`/`comoAuxiliar`), mas não
  // deve encolher o denominador de "quantos reparos o time faz por dia
  // trabalhado" — senão um técnico que só aparece ocasionalmente como
  // auxiliar de RAUX (às vezes nem tecnicamente de campo, ver docs/06) dilui
  // a média sem ter liderado nenhuma visita.
  const diasComoPrincipal = new Set<string>()

  let visitasComDupla = 0
  let visitasComRegistro = 0

  for (const r of rows) {
    const n = r.protocolos

    // ── visão do TÉCNICO: nunca entra nos totais da empresa ──────────────
    if (r.nivel === 'credito') {
      if (!r.tecnico) continue
      const tec: AcumTecnico =
        porTecMap.get(r.tecnico) ?? {
          ...medidasVazias(),
          dias: new Set<string>(),
          porGrupo: new Map<string, number>(),
          auxiliar: 0,
        }
      acumular(tec, r, n)
      if (r.instalado) {
        tec.dias.add(r.dia)
        if (r.papel === 'Auxiliar') tec.auxiliar += n
        else diasComoPrincipal.add(`${r.tecnico}|${r.dia}`)
      }
      if (r.improdutiva) {
        const grupo = r.motivo
          ? (MOTIVOS_IMPRODUTIVIDADE[r.motivo]?.agrupa ?? 'Não classificado')
          : 'Não classificado'
        tec.porGrupo.set(grupo, (tec.porGrupo.get(grupo) ?? 0) + n)
      }
      porTecMap.set(r.tecnico, tec)
      continue
    }

    // ── visão da EMPRESA: só aqui somamos ────────────────────────────────
    visitasComDupla += r.com_dupla
    visitasComRegistro += r.com_registro
    acumular(total, r, n)

    const dia = porDiaMap.get(r.dia) ?? medidasVazias()
    acumular(dia, r, n)
    porDiaMap.set(r.dia, dia)

    const chaveBase = r.base ?? '(sem base)'
    const bs = porBaseMap.get(chaveBase) ?? medidasVazias()
    acumular(bs, r, n)
    porBaseMap.set(chaveBase, bs)

    // O catalogo e o corte que de fato separa a operacao: team_id e
    // "Equipe Field Service" em quase todo protocolo de campo.
    const chaveCat = r.catalogo ?? '(sem catalogo)'
    const ct = porCatMap.get(chaveCat) ?? medidasVazias()
    acumular(ct, r, n)
    porCatMap.set(chaveCat, ct)

    // `r.motivo` nunca e' nulo aqui: desde 03/09/2026 o CTE `improd` so
    // inclui reparo com a classificacao inserida (ver a nota la).
    if (r.improdutiva && r.motivo) motivoMap.set(r.motivo, (motivoMap.get(r.motivo) ?? 0) + n)
  }

  fechar(total)

  const porDia = [...porDiaMap.entries()]
    .map(([dia, m]) => ({ dia, ...fechar(m) }))
    .sort((a, b) => a.dia.localeCompare(b.dia))

  const porTecnico = [...porTecMap.entries()]
    .map(([tecnico, m]) => {
      const { dias, porGrupo, auxiliar, ...resto } = m
      fechar(resto)
      return {
        tecnico,
        ...resto,
        comoAuxiliar: auxiliar,
        diasProdutivos: dias.size,
        mediaDiaria: dias.size > 0 ? resto.produtivo / dias.size : null,
        improdutivoPorGrupo: Object.fromEntries(porGrupo),
      }
    })
    .sort((a, b) => b.produtivo - a.produtivo)

  const porBase = [...porBaseMap.entries()]
    .map(([base, m]) => ({ base, ...fechar(m) }))
    .sort((a, b) => b.produtivo - a.produtivo)

  const porCatalogo = [...porCatMap.entries()]
    .map(([catalogo, m]) => ({ catalogo, ...fechar(m) }))
    .sort((a, b) => b.produtivo - a.produtivo)

  const totalImprodComCodigo = [...motivoMap.values()].reduce((s, x) => s + x, 0)
  const denomMotivo = totalImprodComCodigo
  const motivos: ItemMotivo[] = [...motivoMap.entries()]
    .map(([codigo, visitas]) => {
      const cat = MOTIVOS_IMPRODUTIVIDADE[codigo]
      return {
        codigo,
        rotulo: cat?.rotulo ?? codigo,
        grupo: cat?.agrupa ?? ('Não classificado' as const),
        visitas,
        share: denomMotivo > 0 ? visitas / denomMotivo : 0,
      }
    })
    .sort((a, b) => b.visitas - a.visitas)


  // MAN.* e INST.* tem motivos homonimos (MAN.004 e INST.005 sao ambos "chuva
  // com visita"). Duas barras com o mesmo rotulo sao ilegiveis, e fundi-las
  // esconderia que um codigo de INSTALACAO foi usado num protocolo de
  // manutencao -- sinal de erro de apontamento, nao ruido.
  const contagemRotulo = new Map<string, number>()
  for (const m of motivos) {
    contagemRotulo.set(m.rotulo, (contagemRotulo.get(m.rotulo) ?? 0) + 1)
  }
  for (const m of motivos) {
    if ((contagemRotulo.get(m.rotulo) ?? 0) > 1) m.rotulo = m.rotulo + ' - ' + m.codigo
  }

  // Produtivo / soma dos dias produtivos de cada tecnico -- "reparos por tecnico
  // por dia trabalhado". O denominador e a soma dos dias de CADA tecnico, nao os
  // dias do calendario -- e NAO INCLUI DUPLA: e' só dia em que o técnico foi
  // TITULAR (papel Principal) de uma visita produtiva, contado em
  // `diasComoPrincipal` no loop acima. Decisão explícita da Manutenção
  // (04/09/2026): crédito de auxiliar de dupla não deve encolher o
  // denominador desta média, senão alguém que só aparece ocasionalmente como
  // auxiliar da perna RAUX dilui o "reparos por dia" do time sem ter liderado
  // nenhuma visita.
  const diasTimeSomados = diasComoPrincipal.size

  return {
    data: {
      total: {
        ...total,
        protocolosBase: total.totalVisitas,
        mediaReparosTime:
          diasTimeSomados > 0 ? total.produtivo / diasTimeSomados : null,
        diasTimeSomados,
        tecnicosAtivos: porTecnico.length,
        visitasComDupla,
        visitasComRegistro,
      },
      porDia,
      porTecnico,
      porBase,
      porCatalogo,
      motivos,
    },
    meta: { linhasMatriz: rows.length },
    ms,
  }
}

/**
 * NOTA DE PERFORMANCE — por que este indicador é o mais caro do sistema
 *
 * `upper(description) LIKE '%IMPROD%'` é seq scan por definição: nenhum índice
 * btree serve para padrão com curinga à esquerda. Medido em ~5 s no mês.
 *
 * O que já está feito para conter isso:
 * - o filtro de data em `reports.beginning_date` corta o scan à janela pedida;
 * - a varredura roda UMA vez e alimenta os cinco cortes por rollup em JS;
 * - o resultado passa pelo cache de `server/cache.ts` com revalidação em
 *   segundo plano, então só a primeiríssima requisição espera.
 *
 * O que resolveria de verdade (fora do nosso alcance — o ERP é read-only):
 * um índice GIN `pg_trgm` em `reports.description`, ou uma coluna materializada
 * com o código já extraído. Ambos exigem DDL no banco de produção.
 */
