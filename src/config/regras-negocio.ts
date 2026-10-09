/**
 * Regras de negócio extraídas do modelo Power BI (docs/01-regras-de-negocio-powerbi.md).
 *
 * Estão AQUI, e não dentro do SQL, de propósito: no modelo antigo essas listas
 * estavam hardcoded dentro de cada query M/DAX, duplicadas e divergindo entre si.
 * Centralizar torna o comportamento testável e auditável.
 */

/**
 * Equipes de manutenção (erp.teams.id).
 *
 * ⚠️ NÃO REMOVER, mesmo parecendo obsoleto. Em MAIO/2025 as matrizes do Voalle
 * mudaram e a regra de filtro passou a ser o CATÁLOGO. Medido mês a mês:
 *
 *   abr/2025 → 2.218 protocolos por equipe,     0 por catálogo
 *   mai/2025 → 1.691 por equipe,              280 por catálogo  (transição)
 *   jun/2025 →     0 por equipe,            1.985 por catálogo
 *
 * Ou seja: para qualquer recorte que alcance abr/2025 ou antes, só a equipe
 * identifica o universo; de jun/2025 em diante, só o catálogo. É por isso que o
 * WHERE usa `equipe OR catálogo` — a condição dupla é o que mantém a série
 * histórica contínua na virada. Ficar só com catálogo zeraria todo 2024 e o
 * começo de 2025.
 */
export const EQUIPES_MANUTENCAO = [1050, 65, 1065, 1064, 1063, 1062] as const

/** Mês em que o Voalle passou a identificar o universo pelo catálogo. */
export const VIRADA_MATRIZ_CATALOGO = '2025-05'

export const EQUIPES_MANUTENCAO_NOMES: Record<number, string> = {
  65: 'Equipe de Reparo [SLE/SPS/NHO/EIO/CAN]',
  1050: 'Equipe de Tecnologia [SLE/SPS/NHO/EIO/CAN]',
  1062: 'Equipe de Tecnologia NHO/SLE/SPS',
  1063: 'Equipe de Tecnologia EIO/CAN',
  1064: 'Equipe de Reparo NHO/SLE/SPS',
  1065: 'Equipe de Reparo EIO/CAN',
}

/** Catálogos de serviço que caracterizam manutenção (erp.catalog_services.title). */
export const CATALOGOS_MANUTENCAO = [
  'Oper. Reparo',
  'Oper. Tecnologia',
  'Equipe tecnologia',
  'Equipe reparo',
] as const

/** Cidades da região atendida — cobrem ~99% do volume. */
export const CIDADES_REGIAO = [
  'Cachoeirinha',
  'Canoas',
  'Esteio',
  'São Leopoldo',
  'Novo Hamburgo',
  'Sapucaia do Sul',
] as const

/**
 * Status que contam como "encerrado".
 *
 * Sobre 'Faturado' / 'A Faturar': os dois EXISTEM em `erp.incident_status`
 * (ids 36 e 35) e pertencem à etapa de INSTALAÇÃO — 'Faturado' vem depois de
 * 'A Faturar'. No universo de manutenção nenhum protocolo usa nenhum dos dois:
 * medido ZERO em 2026. Então incluir ambos aqui não muda nenhum número da
 * manutenção; está aqui só para o caso de o recorte alcançar instalação.
 *
 * ⚠️ 'Fechado' (id 3, 4 protocolos em 2026) NÃO está na lista, porque o Power BI
 * também não o considera. São 4 protocolos; se virar relevante, revisar.
 */
export const STATUS_ENCERRADO = ['Encerrado', 'A Faturar', 'Faturado'] as const

/**
 * Status que tira o protocolo do universo de DEMANDA — mas não do de VISITA.
 *
 * Constante e não string solta porque o valor aparece em três lugares que têm de
 * concordar: a exclusão padrão em `montarWhere`, a checagem que a suspende
 * quando a pessoa filtra por ele, e a lista de opções do combo. Se um deles
 * escrevesse 'CANCELADO' ou 'Cancelada', o filtro viraria um botão que não faz
 * nada — e ninguém veria, porque o resultado continuaria plausível.
 */
export const STATUS_CANCELADO = 'Cancelado' as const

/**
 * Tipos que ESTÃO no catálogo de manutenção mas NÃO são demanda da operação de
 * campo. Saem do universo, em todas as telas de protocolo.
 *
 * ── `GERAL - Registro de Atendimento Inicial` ────────────────────────────────
 *
 * É o protocolo que o **Suporte - Atendimento** abre no primeiro contato do
 * cliente e que só DEPOIS vira um reparo — que por sua vez é outro protocolo,
 * este sim da Manutenção. Mantê-lo contava a mesma demanda duas vezes: uma no
 * registro inicial, outra no reparo de verdade.
 *
 * A Manutenção decidiu retirá-lo em 28/08/2026: *"esse tipo é protocolo inicial
 * aberto pelo time do Suporte Atendimento e que depois vira reparo cliente. Não
 * é responsabilidade da Operação de campo, o ideal é retirarmos de nossa base
 * para evitar confusão e erros."*
 *
 * ⚠️ EXCLUIR UM TIPO INTEIRO É PERIGOSO — se um único protocolo dele carregasse
 * serviço, a exclusão apagaria trabalho real. Por isso foi medido antes, sobre
 * os 68 protocolos deste tipo no universo em 2026 (jan–ago):
 *
 * | sinal de trabalho de campo        | protocolos |
 * |-----------------------------------|------------|
 * | com relato de deslocamento/visita | **0**      |
 * | com solução preenchida            | **0**      |
 * | com técnico reservado na agenda   | **0**      |
 *
 * Zero nos três, em sete meses. O tipo nunca carrega execução — é registro
 * administrativo por construção, e é por isso que a exclusão é segura como
 * regra e não só para os casos auditados.
 *
 * ⚠️ NÃO afeta a Produtividade: ela recorta por `TIPOS_CAMPO`, e este tipo nunca
 * esteve lá. Também não move o MTTA — sem relato de campo, esses protocolos já
 * entravam como nulo (ver docs/04 item 24), não como zero.
 */
export const TIPOS_FORA_DA_MANUTENCAO = [
  'GERAL - Registro de Atendimento Inicial',
  /**
   * ACRESCENTADO 02/09/2026. NÃO é reparo — é UPGRADE: o cliente migra de
   * plano e o equipamento precisa trocar por isso. Mesmo com técnico indo a
   * campo, não é o que MTTR, produtividade ou recorrência medem.
   *
   * Explicado pela Manutenção depois de eu ter achado o tipo do lado ERRADO da
   * divergência do item A (docs/06): ele tinha catálogo Oper. Reparo/Tecnologia
   * e por isso entrava no universo de todas as telas MENOS Produtividade — que
   * o excluía sem querer, só por `TIPOS_CAMPO` não listá-lo. A exclusão estava
   * certa por acidente; agora está certa por definição, e vale para as duas
   * direções: nem MTTR conta, nem Produtividade conta.
   *
   * Medido em jun-ago/2026, dentro do universo por equipe/catálogo: 31
   * protocolos (29 não cancelados), 29 com visita real de campo, MTTR médio
   * 37:04:32 — inflava o MTTR de todas as telas que passam por `montarWhere`
   * (kpis, serie, ranking, heatmap, coeficiente, mtta, Protocolos) e das que
   * montam o próprio universo (Ofensores, Preventivos).
   *
   * ⚠️ Recorrência (`recorrencia.ts`) NÃO consome esta constante — ainda não
   * exclui nem este tipo nem GERAL nem COR/CGR/Suporte/Corporativo. É gap
   * pré-existente, fora do pedido de hoje; fica registrado em docs/06.
   */
  'TEC - Migração com troca de Equipamento',
] as const

/**
 * Equipes que ficam com o protocolo mas NÃO são a operação de campo. Saem do
 * universo das telas de protocolo — contagem e MTTR.
 *
 * | id | equipe | desde |
 * |------|-------------------------------------|------------|
 * | 1007 | CGR - Central de Gestão de Rede | 28/08/2026 |
 * | 1074 | COR - Central de Operação de Redes | 28/08/2026 |
 * | 1025 | Suporte - Atendimento | 02/09/2026 |
 * | 67 | Instalação Corporativo | 02/09/2026 |
 * | 1117 | Manutenção Corporativo | 02/09/2026 |
 *
 * ── As duas centrais (COR/CGR) ─────────────────────────────────────────────
 *
 * São as centrais que tentam resolver remotamente ANTES de a demanda ir para o
 * campo (a Manutenção descreveu o fluxo em 27/08/2026). Quando o protocolo fica
 * com elas, o relógio que corre é o delas: o 1725922 levou **531:49:48** porque
 * o COR esperava liberação de acesso, não porque um técnico demorou.
 *
 * ── As outras três, acrescentadas em 02/09/2026 ────────────────────────────
 *
 * `Suporte - Atendimento` é a mesa de atendimento. Levantamento de 6 meses
 * (mar–ago/2026): **54 protocolos, nenhum com agenda de campo**, e a Manutenção
 * classificou um a um — *"por regra nenhum deve contabilizar, erros dos
 * atendentes"*. 42 dos 54 encerram em MENOS DE UMA HORA, vários em 1 ou 2
 * minutos com solução de campo gravada (`ALTERADA SENHA/SSID`, `BATIMENTO DE
 * CTO`, `IMPRODUTIVA CLIENTE AUSENTE`). Os 7 que tinham relato de campo eram
 * reabertura para correção de patrimônio, encerrados entre 4 e 36 minutos.
 *
 * `Instalação Corporativo` e `Manutenção Corporativo` são o time interno que
 * atende parte dos clientes CNPJ (Sebratel Empresas). São 4 protocolos em 6
 * meses, nenhum com agenda de campo, e levam de **193 h a 489 h** para encerrar
 * porque o time interno trabalha em outro ritmo.
 *
 * ⚠️ O MESMO CLIENTE CNPJ APARECE DOS DOIS LADOS, e é por isso que o corte é por
 * EQUIPE e não por cliente. CARMILLION, ISCERGS, AGAONCO e COMERCIO CAMPESTRE
 * CLUB têm, no mesmo semestre, 15 protocolos atendidos pelo campo (todos com
 * agenda) e 4 pelo time corporativo (nenhum com agenda). A equipe separa os dois
 * mundos com precisão; o cliente não separa nada.
 *
 * ⚠️ A HIPÓTESE DO FIM DE SEMANA FOI TESTADA E NÃO SE CONFIRMA. A suspeita era
 * que o campo assumisse os corporativos no fim de semana. Os 4 atendimentos
 * corporativos foram quinta, quinta, sexta e segunda — e o campo atende esses
 * mesmos clientes em sábado e domingo.
 *
 * ── A salvaguarda que NÃO foi implementada, e como saber se passou a fazer falta
 *
 * A Manutenção levantou o caso de troca de mão: *"agendou sexta e deu
 * improdutiva e acabou executando no sábado, neste caso foi para os dois times"*.
 * A regra correta seria "sai se for dessas equipes E não tiver agenda de campo".
 *
 * Ela não está aqui por custo medido: a condição exige um EXISTS sobre a view de
 * field service e acrescenta **~570 ms a TODA consulta** do dashboard, porque
 * `montarWhere` é compartilhado. E em **todo o 2026** (87 protocolos nas três
 * equipes) ela nunca teria mudado uma linha — zero têm agenda de campo.
 *
 * Para reconferir, esta consulta tem de continuar devolvendo zero na última
 * coluna:
 *
 *     SELECT t.title, count(*),
 *            count(*) FILTER (WHERE EXISTS (
 *              SELECT 1 FROM erp.v_service_desk_slots_productivity_informative v
 *               WHERE v.assignment_id = a.id AND v.routing_status >= 4))
 *       FROM erp.assignment_incidents ai
 *       JOIN erp.assignments a ON a.id = ai.assignment_id
 *       LEFT JOIN erp.teams t  ON t.id = ai.team_id
 *      WHERE ai.team_id = any(ARRAY[67,1117,1025])
 *        AND a.created >= '2026-01-01'
 *      GROUP BY 1;
 *
 * Se algum dia devolver mais que zero, a salvaguarda passou a fazer falta.
 *
 * ── POR QUE A EQUIPE INTEIRA, e não só os sem relato de campo ───────────────
 *
 * Minha primeira leitura foi excluir só os que não tinham relato de campo, para
 * não apagar visita real. Eram 8 de 10; os outros 2 (1656912 e 1667453) tinham
 * deslocamento e técnico. A Manutenção explicou o que aconteceu com eles:
 *
 * > *"eles foram a campo e deu problema na liberação de acesso ao local e os
 * > protocolos retornaram para o COR/CGR que encerraram com SOLUÇÃO incorreta,
 * > como se tivesse havido ação de campo."*
 *
 * Os relatos confirmam: **MAN.002 - IMPROD - REAGENDA CLI** (*"não fomos
 * autorizados pela portaria"*) e **MAN.011 - IMPROD - INVIABILIDADE**
 * (*"não teve permissão para efetuarmos o reparo"*). Depois disso o COR fechou
 * gravando *LIMPEZA ACOPLADOR DA ONT* e *LIMPEZA DE CONECTOR DA CTO* — solução
 * de campo que não houve.
 *
 * Ou seja: **"tem relato de campo" NÃO significa "é do campo"**. A visita
 * aconteceu e foi improdutiva; o protocolo voltou para a central e o tempo
 * seguiu correndo lá. Os dois pertencem ao COR.
 *
 * ⚠️ A VISITA NÃO SE PERDE. A Produtividade recorta por `TIPOS_CAMPO` e não passa
 * por `montarWhere` — os dois são `TEC-MANUT-ACESSO-CLI-INCIDENTE/PROBLEMA`, que
 * está lá. FABIO e DIEGO continuam com suas improdutivas. É a mesma separação do
 * item 20: Produtividade conta VISITA (aconteceu), telas de protocolo contam
 * DEMANDA (não era do campo).
 *
 * ── Por que id e não título ────────────────────────────────────────────────
 *
 * Um rename no Voalle devolveria a equipe ao universo em silêncio — falha aberta,
 * a pior. O id sobrevive ao rename. O custo é que uma equipe NOVA precisa ser
 * acrescentada à mão, o que é aceitável: são cinco equipes nomeadas, não uma
 * família que cresce sozinha.
 *
 * ⚠️ NÃO EXISTE regra por PESSOA aqui, e a tentativa está registrada em
 * docs/06 item M: MARCOS VINICIUS DE OLIVEIRA BARBOSA responde por 717
 * protocolos da Equipe Field Service e entraria na lista por ter respondido a UM
 * do COR. Mesmo problema de vigência do item 18.
 *
 * ── 1084 · Equipe CAOC, acrescentada em 11/09/2026 ────────────────────────
 *
 * Mesma natureza das outras: é central, não campo. Entrou pelo caminho já
 * conhecido — catálogo `Oper. Reparo`/`Equipe reparo` sem ser time de campo.
 *
 * Universo dela em 2026 (medido em 11/09/2026): **14 protocolos**, e a forma
 * importa mais que o número —
 *
 *   13 são `Cancelado` (lote criado em 18–19/03 e cancelado em 24/03, todos
 *      `TEC - Suporte técnico`), então JÁ saíam do universo por padrão;
 *    1 é o **1580311**, `Encerrado`, `INCIDENTE/PROBLEMA`, aberto em 18/03 e
 *      encerrado só em 08/09 — **4.168 h**, com o relato literal
 *      *"DESCONSIDERAR"* e sem nenhuma linha de roteirização.
 *
 * Esse único protocolo sozinho levava o MTTR de setembro/2026 de 20:24 para
 * 23:18 na visão padrão. Ver docs/06 item W.
 */
export const EQUIPES_FORA_DA_MANUTENCAO = [1007, 1074, 1025, 67, 1117, 1084] as const

/**
 * Marca da TRILHA da base no field service (`region_title` da view de slots).
 *
 * O Voalle nomeia as regiões como `✅Base <cidade> (<trilha>)`, e a trilha diz a
 * que operação a base pertence. Em 2026 existem quatro, e só quatro:
 *
 * | region_id | region_title                    | trilha     |
 * |-----------|---------------------------------|------------|
 * | 23        | ✅Base São Leopoldo (Manutenção) | Manutenção |
 * | 24        | ✅Base Canoas (Manutenção)       | Manutenção |
 * | 29        | ✅Base Canoas (Ativação)         | Ativação   |
 * | 30        | ✅Base São Leopoldo (Ativação)   | Ativação   |
 *
 * ⚠️ ISTO NÃO É UMA LISTA DE BASES PROIBIDAS. Já recusamos essa forma uma vez
 * (item 21), porque uma lista de nomes envelhece na primeira vez que a operação
 * abre uma base. A trilha não envelhece assim: uma `✅Base Novo Hamburgo
 * (Manutenção)` que nasça amanhã entra sozinha, sem ninguém editar código.
 *
 * POR QUE EXIGIR a trilha em vez de PROIBIR a de Ativação: se um dia surgir uma
 * trilha nova (`(Corporativo)`, digamos), exigir faz a base sumir do combo — uma
 * ausência que a operação percebe e reporta. Proibir a deixaria entrar em
 * silêncio, misturada com as de manutenção. Entre falhar visível e falhar mudo,
 * este filtro falha visível.
 *
 * Preferido a `region_id` porque o id exigiria manutenção manual a cada base
 * nova — o defeito que se está evitando, só que com números no lugar de nomes.
 */
export const TRILHA_MANUTENCAO = '(Manutenção)' as const

/**
 * Pessoas que aparecem como auxiliar mas não são gente: placeholder que o app
 * grava quando o técnico foi sozinho. Confirmado no banco — "SEM AUXILIAR" tem
 * 193 protocolos em julho/2026, mais que qualquer auxiliar real.
 */
export const AUXILIARES_PLACEHOLDER = ['SEM AUXILIAR'] as const

/**
 * Pessoas que NÃO valem como CLIENTE — o protocolo sai do universo quando elas
 * são o solicitante.
 *
 * ⚠️ E SÓ COMO CLIENTE. `LUIS GUSTAVO ANTUNES NUNES` é colaborador da empresa:
 * em 2026 ele figura como RESPONSÁVEL de 97 protocolos de clientes reais, e
 * esses são trabalho de verdade que continua contando. A regra olha
 * `a.requestor_id`, nunca `a.responsible_id` nem quem emitiu.
 *
 * ⚠️ NÃO É "protocolo de teste", e a distinção veio da Manutenção em
 * 02/09/2026: nem tudo que ele abre é teste. O 1801436, aberto hoje, é real —
 * *"solicito um chip para HECTOR LUIS BRITO, time manutenção São Leopoldo"*. A
 * decisão foi mais simples que caçar quais são teste: **ele como cliente não
 * entra, ponto**. Demanda interna registrada no nome de um colaborador não é
 * demanda de cliente, seja ela teste ou não.
 *
 * O tamanho da regra, medido em 02/09/2026 (funil completo):
 *
 * | | protocolos |
 * |---|---|
 * | total no ERP com ele como solicitante (desde 05/04/2023) | 245 |
 * | dentro do universo de manutenção | 39 |
 * | após os cortes de tipo e equipe | 19 |
 * | **não cancelados — o que a regra de fato remove** | **5** |
 *
 * Os 5 são de 2026, todos em Campo Bom, e três deles abertos e encerrados em
 * menos de 5 minutos no mesmo dia: 1589811, 1600597, 1600614, 1601420, 1640237.
 */
export const CLIENTES_TESTE = ['LUIS GUSTAVO ANTUNES NUNES'] as const

/** Categorias (categoria2) que caracterizam protocolo preventivo. */
export const CATEGORIAS_PREVENTIVAS = [
  'Preventiva / Recorrência Manutenção',
  'Preventiva reparo',
  'Preventiva tecnologia',
  'Preventiva /Correção de Sinal',
] as const

/** Tipos de protocolo (incident_types.title) que caracterizam preventivo. */
export const TIPOS_PREVENTIVOS = [
  'TEC-MANUT-ACESSO-CLI-PREVENCAO/PROBLEMA',
  'TEC-MANUT-ACESSO-CLI-PREVENCAO/RECORRENTE',
] as const

/**
 * Tipos que ficam DENTRO do universo de manutenção (equipe/catálogo batem),
 * mas não são "o cliente voltou a ter problema" — são requisição e
 * regularização administrativa. Só saem da RECORRÊNCIA, não do sistema
 * inteiro (diferente de `TIPOS_FORA_DA_MANUTENCAO`, que sai de todas as
 * telas) — Protocolos/KPIs/Ofensores continuam contando esses protocolos
 * como demanda; só não caracterizam reincidência/recorrência de defeito.
 *
 * Achado em 09/09/2026 cruzando `recorrencia.ts` protocolo a protocolo contra
 * export do Power BI de agosto/2026: dos 512 protocolos que só apareciam do
 * nosso lado, 351 (69%) eram destes dois tipos — `TEC-MANUT-ACESSO-CLI-
 * REQUISICAO` (332) e `TEC-MANUT-INT-CLIN-REGULARIZACAO` (19). Decisão da
 * Manutenção: tirar os dois do universo de recorrência. Ver docs/06 e
 * docs/04 item 49.
 */
export const TIPOS_FORA_DA_RECORRENCIA = [
  'TEC-MANUT-ACESSO-CLI-REQUISICAO',
  'TEC-MANUT-INT-CLIN-REGULARIZACAO',
] as const

/**
 * Tipos de protocolo que entram na agenda de campo (view de produtividade).
 *
 * ⚠️ `TEC-ACESSO-CLI-RETORNO-PRIORITARIO` ACRESCENTADO 02/09/2026: são reparos
 * CRÍTICOS, e a Manutenção foi explícita — *"precisamos contabilizar"*. Ele já
 * pertencia ao universo de todas as outras telas (catálogo Oper. Reparo); só
 * faltava aqui, então essas visitas existiam para MTTR e Ofensores mas
 * ficavam invisíveis na Produtividade. Medido jun-ago/2026: 5 protocolos, os
 * 5 com visita real de campo.
 *
 * ⚠️ `TEC - Pendência Técnico Campo` RETIRADO 02/09/2026. O conceito é
 * regularizar PENDÊNCIA do time de ATIVAÇÃO — foto, patrimônio — não reparo de
 * manutenção. A Manutenção confirmou de memória e eu conferi no banco: dos
 * 1.076 protocolos deste tipo desde fev/2026, **100% têm catálogo "Equipe
 * ativação"** — zero em Oper. Reparo, Oper. Tecnologia, Equipe tecnologia ou
 * Equipe reparo. Nunca entrou no universo de nenhuma outra tela por esse
 * motivo; só inflava Produtividade, que o contava por estar sozinho em
 * `TIPOS_CAMPO`.
 *
 * Gerou 94 visitas entre fev e set/2026, bem mais concentrado que os outros
 * dois tipos revisados no mesmo dia: **64 só em março/2026** — o mês mais
 * afetado da correção.
 *
 * | mês | visitas removidas |
 * |---|---|
 * | fev/2026 | 4 |
 * | **mar/2026** | **64** |
 * | abr/2026 | 8 |
 * | mai/2026 | 6 |
 * | jul/2026 | 2 |
 * | ago/2026 | 8 |
 * | set/2026 (parcial) | 2 |
 *
 * Este é o mesmo item A de docs/06 (Produtividade recorta por TIPO, o resto
 * por equipe/catálogo) — resolvido tipo a tipo, à medida que a Manutenção
 * confirma o que cada um significa, em vez de uma troca em bloco para
 * equipe/catálogo que ninguém validou ainda.
 *
 * ⚠️ `TEC-MANUT-ACESSO-CLI-INTENCAO-CANCELAMENTO` ACRESCENTADO 09/10/2026, a
 * pedido da Manutenção. Tipo NOVO: a primeira ocorrência é de setembro/2026.
 *
 * É o caso do item A acontecendo de novo, e em tempo real. Como o universo das
 * outras telas é catálogo + equipe, e tipo só sai por LISTA DE EXCLUSÃO
 * (`TIPOS_FORA_DA_MANUTENCAO`), o tipo nasceu já contado em Executivo,
 * Operação, Tempos, Recorrência, Ofensores e Protocolos — sem ninguém mexer em
 * nada. A Produtividade, que recorta por lista de PERMISSÃO, foi a única a
 * ignorá-lo. Um tipo novo entra sozinho em seis telas e some numa só.
 *
 * Não é perda teórica. Medido em setembro/2026: **17 protocolos** dentro do
 * universo (23 no total; 6 ficam de fora por catálogo `Suporte Tecnico` e
 * equipe `Suporte - Atendimento`, como qualquer outro tipo ficaria), e os 17
 * geraram **40 slots reservados com 11 técnicos distintos** — visita de campo
 * real, invisível só aqui.
 *
 * NÃO entra em Preventivos, e não precisa de regra para isso: `eh_preventiva`
 * exige tipo preventivo ou categoria preventiva, e a categoria destes é
 * INSTABILIDADE (12) ou INDISPONIBILIDADE (5). Ver docs/06.
 */
export const TIPOS_CAMPO = [
  'TEC - Suporte técnico',
  'TEC-MANUT-ACESSO-CLI-INCIDENTE/PROBLEMA',
  'TEC-MANUT-ACESSO-CLI-INCIDENTE/RECORRENTE',
  'TEC-MANUT-ACESSO-CLI-PREVENCAO/PROBLEMA',
  'TEC-MANUT-ACESSO-CLI-PREVENCAO/RECORRENTE',
  'TEC-MANUT-ACESSO-CLI-REQUISICAO',
  'TEC-MANUT-INT-CLIN-REGULARIZACAO',
  'TEC - Suporte / Problema [ Telefonia ]',
  'TEC-ACESSO-CLI-RETORNO-PRIORITARIO',
  'TEC-MANUT-ACESSO-CLI-INTENCAO-CANCELAMENTO',
] as const

/**
 * Catálogo de motivos de improdutividade (docs/01 §4.2).
 *
 * O código vive no texto de `erp.reports.description` (HTML livre, digitado pelo
 * técnico no app). Extraímos do banco apenas o CÓDIGO, que é estável; o rótulo
 * vem desta tabela, e não do texto, por dois motivos medidos:
 *
 * 1. O rótulo no texto é instável — "REAGENDA POR CHUVA (COM VISITA) - MAN"
 *    contém hífen, então qualquer regex que delimite por hífen o corta no meio.
 *    Vieram 532 nulos de 1.800 relatos tentando extrair rótulo do texto.
 * 2. O texto livre gera variações do MESMO motivo ("clima /chuva",
 *    "clima/chuva", "QUAL O MOTIVO? Chuva"), que virariam categorias distintas
 *    no gráfico e fragmentariam a contagem.
 *
 * `agrupa` reduz os 30+ códigos a poucos grupos acionáveis — é o corte que a
 * operação usa para decidir o que atacar.
 */
export const MOTIVOS_IMPRODUTIVIDADE: Record<
  string,
  { rotulo: string; agrupa: GrupoImprodutividade }
> = {
  // ── manutenção ─────────────────────────────────────────────
  'MAN.001': { rotulo: 'Aguardando infra', agrupa: 'Infra' },
  'MAN.002': { rotulo: 'Cliente reagenda (c/ visita)', agrupa: 'Cliente' },
  'MAN.003': { rotulo: 'Cliente reagenda (s/ visita)', agrupa: 'Cliente' },
  'MAN.004': { rotulo: 'Chuva (c/ visita)', agrupa: 'Clima' },
  'MAN.005': { rotulo: 'Chuva (s/ visita)', agrupa: 'Clima' },
  'MAN.006': { rotulo: 'Técnico reagendou (c/ visita)', agrupa: 'Técnico' },
  'MAN.007': { rotulo: 'Técnico reagendou (s/ visita)', agrupa: 'Técnico' },
  'MAN.008': { rotulo: 'Cliente ausente', agrupa: 'Cliente' },
  'MAN.009': { rotulo: 'Cancelado pelo cliente', agrupa: 'Cliente' },
  'MAN.010': { rotulo: 'Endereço pendente', agrupa: 'Cadastro' },
  'MAN.011': { rotulo: 'Inviável no cliente', agrupa: 'Inviabilidade' },
  'MAN.012': { rotulo: 'Inviável — técnica', agrupa: 'Inviabilidade' },
  'MAN.013': { rotulo: 'Não entrou na cx do técnico', agrupa: 'Operacional' },
  // ── instalação ─────────────────────────────────────────────
  'INST.001': { rotulo: 'Inviável — infra cliente', agrupa: 'Inviabilidade' },
  'INST.002': { rotulo: 'Cliente cancelou (s/ visita)', agrupa: 'Cliente' },
  'INST.003': { rotulo: 'Cliente cancelou (c/ visita)', agrupa: 'Cliente' },
  'INST.004': { rotulo: 'Chuva (s/ visita) — inst.', agrupa: 'Clima' },
  'INST.005': { rotulo: 'Chuva (c/ visita) — inst.', agrupa: 'Clima' },
  'INST.006': { rotulo: 'Cliente pediu reagendamento', agrupa: 'Cliente' },
  'INST.007': { rotulo: 'Erro operacional (s/ visita)', agrupa: 'Operacional' },
  'INST.008': { rotulo: 'Erro comercial (s/ visita)', agrupa: 'Operacional' },
  'INST.009': { rotulo: 'Erro comercial (c/ visita)', agrupa: 'Operacional' },
  'INST.010': { rotulo: 'Técnico reagendou — inst.', agrupa: 'Técnico' },
  'INST.011': { rotulo: 'Inviável — técnica (inst.)', agrupa: 'Inviabilidade' },
  'INST.012': { rotulo: 'Cliente fora da área', agrupa: 'Cadastro' },
  'INST.013': { rotulo: 'Rede interna do cliente', agrupa: 'Inviabilidade' },
  'INST.014': { rotulo: 'Técnico reagendou (s/ visita)', agrupa: 'Técnico' },
  'INST.015': { rotulo: 'CTO sem porta livre', agrupa: 'Infra' },
  'INST.016': { rotulo: 'Responsável ausente/menor', agrupa: 'Cliente' },
  'INST.017': { rotulo: 'Pendência área de risco', agrupa: 'Risco' },
  'INST.018': { rotulo: 'SST — risco', agrupa: 'Risco' },
  'INST.019': { rotulo: 'Cliente ausente', agrupa: 'Cliente' },
  'INST.020': { rotulo: 'Cliente cancelou contratação', agrupa: 'Cliente' },
  'INST.021': { rotulo: 'Acesso negado', agrupa: 'Cliente' },
  // ── operacional / backoffice ───────────────────────────────
  'OPER.001': { rotulo: 'Erro do operacional', agrupa: 'Operacional' },
  'OPER.002': { rotulo: 'Erro do backoffice', agrupa: 'Operacional' },
  // ── fechamento de instalação de fibra ──────────────────────
  '2.015': { rotulo: 'Fechamento de instalação', agrupa: 'Operacional' },
}

export type GrupoImprodutividade =
  | 'Cliente'
  | 'Clima'
  | 'Infra'
  | 'Inviabilidade'
  | 'Técnico'
  | 'Operacional'
  | 'Cadastro'
  | 'Risco'

/**
 * Regex do código, aplicada no texto já sem HTML.
 *
 * Ancorar em `- IMPROD` (com o `REL -` opcional no meio, que a família `2.015`
 * usa) em vez do início da string: em ~25% dos relatos o técnico deixa o app
 * prefixar "Relato por <NOME> --------", e um `^` perderia todos esses.
 */
export const REGEX_CODIGO_IMPRODUTIVIDADE =
  '([A-Z]{3,4}\\.[0-9]{1,3}|[0-9]\\.[0-9]{2,3})\\s*-\\s*(?:REL\\s*-\\s*)?IMPROD'

/**
 * Categorias (categoria2 anterior) de natureza técnica — só contam para
 * recorrência quando o chamado anterior foi técnico de verdade.
 */
export const CATEGORIAS_TECNICAS_RECORRENCIA = [
  '⚠️Retorno prioritário',
  'Instabilidade de Conexão',
  'Instabilidade Fibra',
  'Serviço indisponível Fibra',
  'Serviço local (Reparo)',
  'Serviço local (Tecnologia)',
  'INSTABILIDADE',
  'INDISPONIBILIDADE',
  'ACAO ATIVA - PROBLEMA RECORRENTE',
] as const

/** Tipos de incidente que caracterizam ativação (erp.incident_types.id). */
export const TIPOS_ATIVACAO = [12, 1014, 1136, 1254, 1255] as const

/**
 * Meta de coeficiente de reparos por dia da semana (reparos ÷ base de clientes).
 * 0 = domingo … 6 = sábado (compatível com EXTRACT(DOW) do Postgres).
 */
export const META_COEFICIENTE: Record<number, number> = {
  0: 0.0006, // domingo  0,06%
  1: 0.0012, // segunda  0,12%
  2: 0.0012,
  3: 0.0012,
  4: 0.0012,
  5: 0.0012, // sexta
  6: 0.0008, // sábado   0,08%
}

/** Peso do dia para cálculo de "dias produtivos" nas projeções. */
export const PESO_DIA_PRODUTIVO: Record<number, number> = {
  0: 0, // domingo não trabalha
  1: 1,
  2: 1,
  3: 1,
  4: 1,
  5: 1,
  6: 0.5, // sábado meio período
}

/** Turnos, derivados da hora de criação (regra `Turno MTTR_A` do Power BI). */
export const TURNOS = [
  { id: '1. 00-08h', label: '00–08h', de: 0, ate: 8 },
  { id: '2. 08-12h', label: '08–12h', de: 8, ate: 12 },
  { id: '3. 12-19h', label: '12–19h', de: 12, ate: 19 },
  { id: '4. 19-24h', label: '19–24h', de: 19, ate: 24 },
] as const

/** Mapa cidade → base operacional (regra `EQUIPES TEMPORARIAS`). */
export const BASE_POR_CIDADE: Record<string, string> = {
  'Novo Hamburgo': 'BASE (NHO/SLE/SPS)',
  'São Leopoldo': 'BASE (NHO/SLE/SPS)',
  'Sapucaia do Sul': 'BASE (NHO/SLE/SPS)',
  Esteio: 'BASE (EIO/CAN)',
  Cachoeirinha: 'BASE (EIO/CAN)',
  Canoas: 'BASE (EIO/CAN)',
}

/** Janela histórica mínima carregada (pendência P5 — parametrizável). */
export const DATA_INICIO_HISTORICO =
  process.env.DATA_INICIO_HISTORICO ?? '2025-01-01'
