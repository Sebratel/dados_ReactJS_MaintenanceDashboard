import {
  CATALOGOS_MANUTENCAO,
  CLIENTES_TESTE,
  EQUIPES_MANUTENCAO,
  STATUS_CANCELADO,
  EQUIPES_FORA_DA_MANUTENCAO,
  STATUS_ENCERRADO,
  TIPOS_FORA_DA_MANUTENCAO,
} from '@/config/regras-negocio'
import { DIMENSOES, EIXOS_DATA, GRANULARIDADES, type Dimensao, type Filtros } from '@/lib/filtros'

/**
 * Construtor do "universo de manutenção" — o FROM/WHERE que TODOS os
 * indicadores compartilham. Regra de negócio em
 * docs/01-regras-de-negocio-powerbi.md §1.
 *
 * Notas de modelagem que importam:
 *
 * - `erp.assignment_incidents` NÃO tem coluna `id`; a PK é `assignment_id`,
 *   1:1 com `assignments`. Não existe fan-out nesse join.
 * - A AGENDA NÃO VEM DE `erp.schedules`. Essa tabela foi praticamente
 *   abandonada: 145.182 linhas em 2024 → 84.223 em 2025 → **3.449 em 2026**.
 *   Dos 6.710 assignments de agosto/2026, apenas **10** têm registro nela.
 *   A agenda migrou para o subsistema de field service, exposto pela view
 *   `v_service_desk_slots_productivity_informative` (`begin_date_slot`), que
 *   cobre **482 de 486** protocolos de manutenção do período (99,2%).
 *   ⚠️ Consequência: o MTPA e o "SEM AGENDAMENTO" do Power BI atual estão
 *   quebrados, porque a expressão `pimeiroAgendamento` lê `erp.schedules`.
 *   O MTPA foi RETIRADO a pedido da Manutenção ("não estamos medindo"), e com ele
 *   saiu o `primeiro_agendamento_valido` do LATERAL — era o único consumidor.
 *   `semAgenda` continua e ainda depende do LATERAL, então ele fica.
 * - A view é 1:N por protocolo (média de 3,2 slots). Entra por LEFT JOIN
 *   LATERAL agregado, nunca por join direto — join direto multiplicaria as
 *   linhas e inflaria toda contagem.
 * - O FROM é COMPOSÁVEL de propósito. O LATERAL da agenda custa ~200 ms no mês
 *   e ~2,4 s no ano; as 4 tabelas de categoria custam mais um tanto. Carregar
 *   tudo sempre fazia a série levar 2,5 s quando ela nem usa agenda. Cada
 *   indicador declara o que precisa.
 * - Todo cálculo de dia/mês/turno acontece no Postgres. O JS nunca reconstrói
 *   data, porque as colunas são `timestamp without time zone` e o fuso do
 *   processo mudaria o resultado.
 */

export type PartesFrom = {
  /** LATERAL na view de produtividade: agenda, MTPA, base real, instalador */
  agenda?: boolean
  /** matriz de categorias 1–3 (solicitation_category_matrices) */
  categorias?: boolean
  /** contexto / problema / solução */
  solicitacao?: boolean
}

const FROM_NUCLEO = /* sql */ `
  FROM erp.assignment_incidents ai
  JOIN erp.assignments a               ON a.id  = ai.assignment_id
  LEFT JOIN erp.incident_status st     ON st.id = ai.incident_status_id
  LEFT JOIN erp.incident_types it      ON it.id = ai.incident_type_id
  LEFT JOIN erp.teams t                ON t.id  = ai.team_id
  LEFT JOIN erp.catalog_services cs    ON cs.id = ai.catalog_service_id
  LEFT JOIN erp.people p               ON p.id  = a.requestor_id
  LEFT JOIN erp.people resp            ON resp.id = a.responsible_id`

const JOIN_SOLICITACAO = /* sql */ `
  LEFT JOIN erp.solicitation_classifications sc ON sc.id = ai.solicitation_classification_id
  LEFT JOIN erp.solicitation_problems sp        ON sp.id = ai.solicitation_problem_id
  LEFT JOIN erp.solicitation_solutions ss       ON ss.id = ai.solicitation_solution_id`

const JOIN_CATEGORIAS = /* sql */ `
  LEFT JOIN erp.solicitation_category_matrices scm ON scm.id = ai.solicitation_category_matrix_id
  LEFT JOIN erp.solicitation_service_categories cat1 ON cat1.id = scm.service_category_id_1
  LEFT JOIN erp.solicitation_service_categories cat2 ON cat2.id = scm.service_category_id_2
  LEFT JOIN erp.solicitation_service_categories cat3 ON cat3.id = scm.service_category_id_3`

/**
 * A VIEW É 1:N POR TRANSIÇÃO DE ROTEIRIZAÇÃO, NÃO POR AGENDAMENTO.
 *
 * Cada protocolo tem uma linha por estado de `routing_status`, encadeados por
 * `previous_routing_status`: 0 (sugestão do roteirizador) → 4 (reservado, ganha
 * `reserved_date`) → 6 (executado). Medido em julho/2026: **3,61 linhas por
 * protocolo, mas só 1,15 slots distintos**.
 *
 * Três consequências, as três encontradas na auditoria da Manutenção:
 *
 * 1. `count(*)` NÃO é o número de agendamentos — é o número de transições de
 *    estado. Dava 3 num protocolo com um único horário. Agora conta
 *    `begin_date_slot` DISTINTO.
 * 2. `max(resource_name)` escolhia ALFABETICAMENTE entre os recursos das várias
 *    linhas — e a linha de `routing_status = 0` traz a **sugestão inicial do
 *    roteirizador**, não quem foi. Em 5.979 de 7.340 protocolos (81%) há mais de
 *    um nome, e a regra antiga trocava o técnico em 41% dos casos. Conferido nos
 *    protocolos auditados: 1758641 dava LUCAS (sugestão) em vez de LETIERE
 *    (executor); 1757714 dava DANIEL em vez de CARLOS FABIO.
 * 3. `routing_status = actual_routing_status` (minha primeira correção) ainda
 *    errava quando o protocolo teve DUAS visitas: o desempate `routing_status
 *    DESC` fazia 8 (cancelado/reagendado) ganhar de 6 (executado), então o
 *    técnico da visita PERDIDA aparecia como executor. No 1720002 dava LETIERE
 *    — que de fato foi, deu MAN.005 (chuva) e o protocolo foi reagendado — em
 *    vez de LUCAS, que executou no dia seguinte.
 *
 * DAÍ A ORDEM ABAIXO, que é uma pergunta de cada vez: qual slot fechou o
 * protocolo (`actual_routing_status = 6`) → dentro dele, uma linha real e não a
 * sugestão (`routing_status >= 4`) → o slot mais recente → o estado mais
 * avançado. `array_agg(... ORDER BY ...)[1]` resolve em uma passada só; um
 * subselect correlacionado varreria a view duas vezes por protocolo.
 *
 * ⚠️ ISSO ESCOLHE UM NOME NUM CAMPO QUE PODE TER DOIS. Um protocolo com visita
 * improdutiva + reexecução tem dois técnicos, cada um dono do seu dia — por isso
 * o LATERAL também devolve `tecnicos_agenda` com todos, e por isso a
 * Produtividade resolve o técnico POR VISITA e não por protocolo (ver o CTE
 * `slots` em produtividade.ts). Ler `instalador` como "quem atendeu o
 * protocolo" é o erro que essa coluna convida a cometer: é quem FECHOU.
 *
 * ⚠️ LIMITE CONHECIDO: a view guarda apenas o slot VIGENTE de cada linha de
 * roteirização. Um reagendamento cujo horário anterior foi sobrescrito é
 * invisível aqui — `erp.schedules` está morta (0 linhas nos protocolos testados)
 * e `Backlog_Schedules` do MariaDB só carrega backlog em aberto. Então
 * `qtd_agendamentos` é "horários distintos que sobreviveram", não "quantas vezes
 * foi agendado".
 */
export const ORDEM_EXECUTOR = /* sql */ `
  (v.actual_routing_status = 6) DESC,
  (v.routing_status >= 4) DESC,
  v.begin_date_slot DESC,
  v.routing_status DESC`

const LATERAL_AGENDA = /* sql */ `
  LEFT JOIN LATERAL (
    SELECT max(v.begin_date_slot) AS ultima_agenda,
           min(v.begin_date_slot) AS primeira_agenda,
           count(DISTINCT v.begin_date_slot)::int AS qtd_agendamentos,
           -- A REGIÃO fica SEM filtro de propósito: mesmo um protocolo que só
           -- foi sugerido pertence à base para onde o roteirizador o mandou, e
           -- essa é a informação que a supervisão usa para achá-lo. Filtrar aqui
           -- sumiria com 88 protocolos de qualquer corte por base.
           (array_agg(v.region_title  ORDER BY ${ORDEM_EXECUTOR}))[1] AS regiao_agenda,
           -- O TÉCNICO, ao contrário, EXIGE linha reservada.
           --
           -- A ordenação sozinha não bastava: ela PREFERE routing_status >= 4,
           -- mas preferência não é filtro — quando o protocolo nunca virou
           -- agendamento, não há o que preferir e o [1] caía na linha 0, que é a
           -- SUGESTÃO do roteirizador. O resultado era uma pessoa que nunca foi
           -- ao cliente aparecendo como quem executou.
           --
           -- Reportado pela Manutenção no protocolo 1648182: o TALHES foi
           -- sugerido em 13/05/2026, o protocolo seguiu em "Abertura", e mesmo
           -- assim ele figurava como executor. Eram 88 protocolos de 2026 (0,34%).
           --
           -- O sintoma na tela era autocontraditório e vale como teste: "Executor"
           -- com nome e "Técnicos que foram" vazio na MESMA linha. Depois deste
           -- FILTER, as duas colunas ou têm nome, ou estão vazias juntas.
           (array_agg(v.resource_name ORDER BY ${ORDEM_EXECUTOR})
              FILTER (WHERE v.routing_status >= 4))[1] AS instalador,
           -- todos os técnicos que o protocolo consumiu, na ordem das visitas.
           -- Só as linhas reservadas: a sugestão do roteirizador não é gente que
           -- foi ao cliente, e incluí-la reinventaria o defeito de cima.
           string_agg(DISTINCT v.resource_name, ', ')
             FILTER (WHERE v.routing_status >= 4) AS tecnicos_agenda
      FROM erp.v_service_desk_slots_productivity_informative v
     WHERE v.assignment_id = a.id
  ) s ON true`

export function montarFrom(partes: PartesFrom = {}): string {
  return [
    FROM_NUCLEO,
    partes.solicitacao ? JOIN_SOLICITACAO : '',
    partes.categorias ? JOIN_CATEGORIAS : '',
    partes.agenda ? LATERAL_AGENDA : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Descobre o que o recorte atual exige, para não carregar join inútil. */
export function partesNecessarias(f: Filtros, extra: PartesFrom = {}): PartesFrom {
  const dimsCategoria: Dimensao[] = ['categoria1', 'categoria2', 'categoria3']
  const dimsSolicitacao: Dimensao[] = ['contexto', 'problema', 'solucao']
  const dimsAgenda: Dimensao[] = ['base', 'instalador']
  return {
    // filtrar por base EXIGE o LATERAL: sem ele `s.regiao_agenda` não existe e a
    // query quebra em tempo de execução, não de compilação.
    agenda:
      extra.agenda ||
      dimsAgenda.includes(f.dim) ||
      f.eixo === 'agenda' ||
      Boolean(f.base),
    categorias: extra.categorias || dimsCategoria.includes(f.dim) || Boolean(f.categoria2),
    solicitacao: extra.solicitacao || dimsSolicitacao.includes(f.dim),
  }
}

/**
 * Casas decimais da MÉDIA EM HORAS que sai do SQL.
 *
 * ⚠️ ERA 2, E 2 CASAS DE HORA SÃO 36 SEGUNDOS. Todo MTTR desta base é exibido
 * como `h:mm:ss` por `fmtHoras` — o formato promete precisão de segundo sobre um
 * número que, com duas casas, só conseguia andar de 36 em 36.
 *
 * Achado no batimento de setembro/2026 contra o Power BI: o card de Tempos
 * mostrava 17:30:36 onde o valor real era 17:30:40 e o BI mostrava 17:30:41. Os
 * 5 segundos não eram divergência de critério com o BI — eram arredondamento
 * nosso, e o BI estava certo. Erro possível de até 18 segundos em qualquer
 * célula.
 *
 * O arredondamento não tinha justificativa escrita em nenhum dos cinco pontos
 * onde aparecia; era incidental, não decisão. No mesmo card, o MTTA sempre teve
 * precisão cheia — dois indicadores lado a lado com precisões diferentes.
 *
 * ⚠️ CONSEQUÊNCIA AO COMPARAR COM O POWER BI: os pivôs de MTTR_A do Relatório
 * Executivo exibem 2 casas decimais, então as nossas células deixam de bater com
 * eles ao segundo — ficam até 18s diferentes. Isso é esperado e é o lado certo
 * da diferença: o número do BI é que está arredondado. Ver docs/06.
 *
 * 6 casas = 3,6 ms, muito abaixo de qualquer coisa que o formato mostre.
 */
export const CASAS_HORA = 6

/** Expressões derivadas reutilizáveis (as "colunas calculadas" do Power BI). */
export const EXPR = {
  mttrHoras: `extract(epoch from (a.conclusion_date - a.created)) / 3600.0`,
  turno: `case
            when extract(hour from a.created) <  8 then '1. 00-08h'
            when extract(hour from a.created) < 12 then '2. 08-12h'
            when extract(hour from a.created) < 19 then '3. 12-19h'
            else '4. 19-24h' end`,
  diaSemanaNum: `extract(dow from a.created)::int`,
  diaSemana: `case extract(dow from a.created)::int
                when 0 then 'DOM' when 1 then 'SEG' when 2 then 'TER'
                when 3 then 'QUA' when 4 then 'QUI' when 5 then 'SEX'
                else 'SÁB' end`,
  base: `case
           when p.city in ('Novo Hamburgo','São Leopoldo','Sapucaia do Sul') then 'BASE (NHO/SLE/SPS)'
           when p.city in ('Esteio','Cachoeirinha','Canoas') then 'BASE (EIO/CAN)'
           else 'OUTROS' end`,
} as const

export type ClausulaWhere = { sql: string; params: unknown[] }

/**
 * Monta o WHERE do universo + os filtros do usuário.
 * Retorna params na ordem de uso; o chamador continua a numeração a partir de
 * `params.length + 1`.
 */
export function montarWhere(
  f: Filtros,
  opts: {
    ignorarPeriodo?: boolean
    incluirCancelado?: boolean
    /**
     * Devolve o colaborador-cliente ao universo. Existe para UM caso: o cartão
     * "cliente de teste já excluído" do relatório analítico, que precisa CONTAR
     * exatamente o que a regra tirou. Sem esta porta ele contaria sempre zero.
     */
    incluirClienteTeste?: boolean
  } = {}
): ClausulaWhere {
  const params: unknown[] = []
  const cond: string[] = []
  const p = (v: unknown) => `$${params.push(v)}`

  cond.push(
    `(t.id = any(${p([...EQUIPES_MANUTENCAO])}) or cs.title = any(${p([...CATALOGOS_MANUTENCAO])}))`
  )

  /**
   * TIPOS QUE NÃO SÃO DEMANDA DE CAMPO SAEM SEMPRE.
   *
   * Diferente do Cancelado abaixo, este corte NÃO tem escape pelo filtro: não é
   * "demanda que deixou de existir", é demanda que nunca foi da Manutenção. O
   * `GERAL - Registro de Atendimento Inicial` é o registro que o Suporte abre no
   * primeiro contato e que depois vira um protocolo de reparo separado — contá-lo
   * era contar a mesma ocorrência duas vezes.
   *
   * `coalesce` porque `it.title` é LEFT JOIN: sem ele, todo protocolo sem tipo
   * cadastrado sairia do universo junto, em silêncio.
   */
  cond.push(`coalesce(it.title, '') <> all(${p([...TIPOS_FORA_DA_MANUTENCAO])})`)

  /**
   * As centrais (COR/CGR) também saem: quando o protocolo fica com elas, o tempo
   * medido é o delas, não o do campo. `coalesce(-1)` porque `ai.team_id` é
   * anulável — sem ele, protocolo sem equipe cadastrada sairia junto, calado.
   */
  cond.push(`coalesce(ai.team_id, -1) <> all(${p([...EQUIPES_FORA_DA_MANUTENCAO])})`)

  /**
   * CANCELADO SAI DO UNIVERSO — a menos que a pessoa peça por ele no filtro.
   *
   * Sai por padrão porque estas telas contam DEMANDA: um protocolo cancelado é
   * demanda que não existiu (duplicidade, abertura errada, cliente desistiu), e
   * contá-lo inflaria volume, MTTR e ofensores. Mesma decisão do Power BI.
   *
   * Mas cancelar não desfaz o que já aconteceu: em julho/2026, dos 188
   * cancelados, **68 tiveram relato de deslocamento** e **48 tiveram
   * improdutiva** — o técnico saiu, perdeu a visita, e só depois o protocolo
   * morreu. Por isso a exclusão é suspensa quando `Cancelado` está selecionado:
   * sem isso não haveria como auditar essas visitas em lugar nenhum.
   *
   * ⚠️ A PRODUTIVIDADE NÃO PASSA POR AQUI e sempre contou os cancelados — ela
   * conta VISITA, não protocolo, e a visita aconteceu. Ver docs/04 §20.
   */
  if (!opts.incluirCancelado && !f.status?.includes(STATUS_CANCELADO)) {
    cond.push(`coalesce(st.title, '') <> '${STATUS_CANCELADO}'`)
  }

  /**
   * COLABORADOR NO PAPEL DE CLIENTE SAI DO UNIVERSO — em TODAS as telas.
   *
   * Estava só em Protocolos, Produtividade, Preventivos, Recorrência e
   * Ofensores, que montam o próprio WHERE. `kpis`, `serie`, `ranking`,
   * `heatmap`, `coeficiente` e `mtta` passam por aqui e não tinham a regra: o
   * mesmo recorte devolvia totais diferentes conforme a aba. Era o item B de
   * docs/06, aberto desde a conferência inicial e decidido em 02/09/2026.
   *
   * ⚠️ `p` é o SOLICITANTE (`a.requestor_id`), nunca o responsável — ver a nota
   * de CLIENTES_TESTE. O `coalesce` protege protocolo sem solicitante
   * cadastrado, que sem ele sairia junto, em silêncio.
   */
  if (!opts.incluirClienteTeste) {
    cond.push(`coalesce(p.name, '') <> all(${p([...CLIENTES_TESTE])})`)
  }

  if (!opts.ignorarPeriodo) {
    const col = colunaEixo(f.eixo)
    cond.push(`${col} >= ${p(f.de)}::date`)
    cond.push(`${col} < (${p(f.ate)}::date + interval '1 day')`)
  }

  // `s.regiao_agenda` só existe se o LATERAL da agenda estiver no FROM —
  // `partesNecessarias` garante isso ao ver `f.base` preenchido.
  if (f.base) cond.push(`s.regiao_agenda = any(${p(f.base)})`)
  if (f.cidade) cond.push(`p.city = any(${p(f.cidade)})`)
  if (f.bairro) cond.push(`p.neighborhood = any(${p(f.bairro)})`)
  if (f.equipe) cond.push(`t.title = any(${p(f.equipe)})`)
  if (f.tecnico) cond.push(`resp.name = any(${p(f.tecnico)})`)
  if (f.catalogo) cond.push(`cs.title = any(${p(f.catalogo)})`)
  if (f.tipo) cond.push(`it.title = any(${p(f.tipo)})`)
  if (f.status) cond.push(`st.title = any(${p(f.status)})`)
  if (f.categoria2) cond.push(`cat2.title = any(${p(f.categoria2)})`)

  return { sql: `WHERE ${cond.join('\n    AND ')}`, params }
}

/**
 * OS DOIS EIXOS QUE NÃO SÃO ESCOLHA DO USUÁRIO.
 *
 * O seletor "Eixo da data" governa CONTAGEM: quantos protocolos entraram no
 * recorte. Mas dois indicadores têm eixo próprio, fixo, por definição:
 *
 * - MTTR_E e MTTA medem DESEMPENHO. Um reparo aberto em 31/07 e fechado em
 *   02/08 é resultado de agosto: foi em agosto que o cliente voltou a operar.
 *   Contá-lo em julho premia o mês errado e, pior, deixa o número de julho
 *   mudando por semanas depois de julho terminar.
 * - MTTR_A mede CAPACIDADE. A pergunta é "reparo que ENTRA sábado 22h espera
 *   quanto", então o instante que classifica a célula é o da abertura. É o que
 *   o mapa de calor sempre respondeu, e por isso ele NÃO acompanha o seletor.
 *
 * Isto não é invenção nossa — é o que o Power BI já fazia, só que escondido:
 *   measure 'MTTR Formatado (Encerramento)' =
 *     CALCULATE(AVERAGE(protocolosTotais[mttrHoras]),
 *               USERELATIONSHIP(Calendario[Date], protocolosTotais[dataEncerrado]))
 *   column 'Turno MTTR_A'  = HOUR(protocolosTotais[dataHoraCriacao])
 *   column 'Dia da Semana' = FORMAT(protocolosTotais[dataHoraCriacao], "ddd")
 *
 * O USERELATIONSHIP troca o eixo DA MEDIDA sem tocar no do visual — as duas
 * funções abaixo são a mesma ideia em SQL. Por isso um ranking legitimamente
 * mostra contagem numa janela e MTTR em outra: são perguntas diferentes na
 * mesma linha, e foi assim que o BI sempre entregou.
 *
 * ⚠️ NÃO tente unir as duas janelas num OR — medido em julho/2026:
 *   período em a.created ................................  668 ms
 *   OR (a.created no período OR a.conclusion_date no período)  5.902 ms
 * O OR sobre duas colunas descarta os dois índices e vira varredura. Duas
 * consultas de janela contígua custam 310–365 ms cada e somam menos que uma.
 */
/**
 * Renumera os `$n` de uma cláusula para que ela possa conviver com outra na
 * MESMA consulta.
 *
 * `montarWhere` sempre numera a partir de `$1`, porque não sabe quem a chama.
 * Quando um indicador precisa de dois recortes na mesma query — tipicamente
 * contagem num eixo e tempo em outro (ver `porEncerramento`) — o segundo WHERE
 * chegaria com placeholders que colidem com os do primeiro, e o Postgres leria
 * o parâmetro errado sem reclamar: os tipos batem, o resultado só fica errado.
 *
 * Daí este deslocamento explícito. O chamador concatena
 * `[...w1.params, ...w2.params]` e passa `w1.params.length` como offset.
 */
export function deslocarParams(w: ClausulaWhere, offset: number): ClausulaWhere {
  if (offset === 0) return w
  return {
    sql: w.sql.replace(/\$(\d+)/g, (_, n: string) => `$${Number(n) + offset}`),
    params: w.params,
  }
}

export function porEncerramento(f: Filtros): Filtros {
  return { ...f, eixo: 'encerramento' }
}

export function porAbertura(f: Filtros): Filtros {
  return { ...f, eixo: 'criacao' }
}

export function colunaEixo(eixo: Filtros['eixo']): string {
  // A coluna vem do catálogo, sem exceção aqui: o caso especial de 'agenda'
  // existia para trocar um valor errado no catálogo por um certo, o que fazia
  // EIXOS_DATA mentir para quem o lesse. Agora o catálogo é a única fonte.
  return EIXOS_DATA[eixo].coluna
}

export function truncGranularidade(g: Filtros['granularidade']): string {
  return GRANULARIDADES[g].truncPg
}

export function sqlDimensao(dim: Filtros['dim']): string {
  if (dim === 'turno') return EXPR.turno
  if (dim === 'diaSemana') return EXPR.diaSemana
  return DIMENSOES[dim].sql
}

export function sqlStatusEncerrado(): readonly string[] {
  return STATUS_ENCERRADO
}
