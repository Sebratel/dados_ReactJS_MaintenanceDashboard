# Regras de negócio extraídas do Power BI (PBIP/TMDL)

Fonte: `C:\Users\fabricio.machado\Desktop\teste_manutencao_fabricio`
(`MAN - Relatório Manutenção FTTX.SemanticModel` + `.Report`)

Este documento é a **especificação funcional** do novo sistema. Toda métrica aqui
precisa ser reproduzida em SQL/TypeScript — não apenas visualmente.

---

## 1. Universo de dados ("o que é manutenção")

Praticamente todas as queries do modelo aplicam o **mesmo filtro de universo**.
Ele é a definição operacional de "protocolo de manutenção de fibra":

```sql
a.created >= '2026-01-01'                          -- janela do modelo atual
AND (
      t.id IN (1050, 65, 1065, 1064, 1063, 1062)   -- equipes de reparo/tecnologia
   OR cs.title IN ('Oper. Reparo', 'Oper. Tecnologia',
                   'Equipe tecnologia', 'Equipe reparo')  -- catálogo de serviço
)
AND is2.title <> 'Cancelado'
```

### Equipes (`erp.teams`) — confirmadas no banco

| id | title |
|----|-------|
| 65 | Equipe de Reparo [São Leopoldo/Sapucaia/NHO/Esteio/Canoas] |
| 1050 | Equipe de Tecnologia [São Leopoldo/Sapucaia/NHO/Esteio/Canoas] |
| 1062 | Equipe de Tecnologia NHO/SLE/SPS |
| 1063 | Equipe de Tecnologia EIO/CAN |
| 1064 | Equipe de Reparo NHO/SLE/SPS |
| 1065 | Equipe de Reparo EIO/CAN |

### Catálogos de serviço (`erp.catalog_services`) — confirmados

`Oper. Reparo` (1175), `Oper. Tecnologia` (1176), `Equipe reparo` (1098),
`Equipe tecnologia` (1099).

### Variações do filtro

- **`protocolosTotais`** (tabela-fato principal) usa um filtro diferente:
  `(it.active IS TRUE OR cs.title IN ('Equipe reparo','Equipe tecnologia'))`
  — ou seja, é mais ampla (inclui instalações), e a separação
  manutenção × instalação é feita depois pela coluna calculada `GRUPO`.
- **`Field Manutenção`** filtra por `incident_type_title` (lista explícita, ver §5)
  e por `begin_date_slot >= '2026-05-01'`.

---

## 2. Tabela-fato principal: `protocolosTotais`

Query base (Voalle): CTE `PERSONALIZADO` com `ROW_NUMBER() OVER (PARTITION BY
a.title ORDER BY s.start_date DESC) = 1` — ou seja, **um registro por
solicitação, mantendo o agendamento mais recente**.

### Joins essenciais

```
assignment_incidents ai            -- grão: 1 por assignment (PK = assignment_id)
 ├── assignments a                 ON a.id = ai.assignment_id
 ├── schedules s                   ON s.assignment_id = a.id      -- agendamentos
 ├── incident_types it             ON it.id = ai.incident_type_id -- tipoProtocolo
 ├── incident_status is2           ON is2.id = ai.incident_status_id -- statusProtocolo
 ├── people p                      ON p.id = a.requestor_id       -- cliente/endereço
 ├── people p2                     ON p2.id = a.responsible_id    -- técnico responsável
 ├── teams t                       ON t.id = ai.team_id           -- equipe
 ├── contract_service_tags cst     ON cst.id = ai.contract_service_tag_id
 │    └── contracts c              ON c.id = cst.contract_id      -- nº contrato, v_status
 ├── authentication_contracts ac   ON ac.contract_id = c.id       -- user PPPoE, lat/lng
 │    ├── authentication_access_points aap  -- CTO/ponto de acesso, slot, porta
 │    └── authentication_concentrators ac2 → authentication_sites as4 -- SITE
 ├── catalog_services cs           ON cs.id = ai.catalog_service_id
 ├── catalog_services_items csi    ON csi.id = ai.catalog_service_item_id
 ├── solicitation_classifications sc -- contexto
 ├── solicitation_problems sp        -- problema
 ├── solicitation_solutions ss       -- solução
 └── v_users vu                    ON vu.id = a.created_by        -- criador
```

### Datas (crítico — cada métrica usa uma data diferente)

| Campo | Origem | Uso |
|---|---|---|
| `dataHoraCriacao` / `dataCriacao` | `a.created` | protocolos **entrantes/abertos** |
| `dataHoraUltimaAgenda` / `dataAgenda` | `s.start_date` (último) | agenda |
| `dataHoraEncerrado` / `dataEncerrado` | `a.conclusion_date` | protocolos **encerrados** |
| `dataPrimeiroAgendamento` | 1º `s.start_date` entre `a.created` e `a.conclusion_date` | MTPA |
| `dataHoraAlocacao` | `MIN(plis.out_date)` por contrato | idade do cliente/ativação |

> O modelo mantém relacionamentos **inativos** (`isActive: false`) para
> `dataEncerrado → Calendario[Date]`, ativados via `USERELATIONSHIP` nas medidas de
> encerramento. Na nova aplicação isso vira um **parâmetro explícito**
> `dateBasis = 'criacao' | 'encerramento' | 'agenda'`.

### Colunas calculadas (lógica de negócio a reproduzir)

**`TIPOS DE STATUS`**
```
statusProtocolo IN ('Encerrado','Faturado') → 'Protocolos Encerrados'
senão                                       → 'Protocolos Abertos'
```

**`GRUPO`** — cascata de 22 `IF` que classifica em `MANUTENÇÃO` / `INSTALAÇÃO` / `OUTROS`:
- `MANUTENÇÃO` se `equipesProtocolo` ∈ {Equipe de Reparo EIO/CAN, Equipe de Reparo
  NHO/SLE/SPS, Equipe de Tecnologia EIO/CAN, Equipe de Tecnologia NHO/SLE/SPS,
  Operacional Fibra – Manutenções, Troca equipamentos enchente}
  ou `tipoProtocolo` = `TEC - Suporte / Roubo, Furto, Quebra e/ou Equipamento Danificado`
- `INSTALAÇÃO` se `tipoProtocolo` ∈ {TEC - Ativação Diversos - CORPOATIVO,
  TEC - Fibra - Reativação, TEC - Instalação de Fibra, TEC - Instalação de Fibra –
  CORPORATIVO, TEC - Instalação de Fibra - Cortesia, TEC - Instalação de Rádio,
  TEC - Instalação de Roteador (Wi-fi) e Migração de Plano, TEC - Instalação
  Telefonia, TEC - Instalação Telefonia com Portabilidade - Telefonia,
  TEC - Troca de Endereço}
  ou `equipesProtocolo` ∈ {Instalação [Brochier], Instalação [Nova Santa Rita,
  Esteio], Instalação [SLE/SPS/NHO/EIO/CAN], Operacional Fibra – Instalações,
  Instalação Corporativo}
- senão `OUTROS`

**`EQUIPES TEMPORARIAS`** (= "Base" operacional, por cidade):
```
Novo Hamburgo | São Leopoldo | Sapucaia Do Sul  → 'BASE (NHO/SLE/SPS)'
Esteio | Cachoeirinha | Canoas                  → 'BASE (EIO/CAN)'
outras                                          → 'OUTROS'
```

**`EQUIPE_CONDICIONAL`**: contém "Equipe de Reparo" → `Equipe Reparo`;
contém "Equipe de Tecnologia" → `Equipe Tecnologia`; senão `Outros`.

**`TipoAtendimento`**: equipes de Reparo/Tecnologia EIO-CAN e NHO-SLE-SPS +
"Equipe Field Service" → `Campo`; senão `Remoto`.

**`Turno MTTR_A`** (por hora de `dataHoraCriacao`):
`0–8h` → `1. 00-08h`; `8–12h` → `2. 08-12h`; `12–19h` → `3. 12-19h`; `19–24h` → `4. 19-24h`.

**`CONDICAO ITEM`**: `itemProtocolo = 'Sem Informação'` → `Sem Informação`, senão `Com Informação`.

**`ChaveLocal`**: `CIDADE|BAIRRO|SITE` (com `SEM_SITE` quando SITE vazio) — chave de
join com a base diária de clientes (dimensão `DimLocalizacao`).

**`Dia da Semana`** = `UPPER(FORMAT(dataHoraCriacao,"ddd"))`, ordenado por `WEEKDAY(...,1)`.

---

## 3. Tempos médios (MTTA / MTTR / MTPA)

Todos derivados em `protocolosTotais`:

| Métrica | Fórmula | Origem |
|---|---|---|
| **MTTR** (`mttrSeconds`) | `dataHoraEncerrado − dataHoraCriacao` em segundos | `a.conclusion_date − a.created` |
| **MTTA / "Em play"** (`mttaSeconds`) | `SUM(r.seconds_worked)` por protocolo, apenas status `Encerrado` | expressão `MTTs_Em play/Conclusao` sobre `erp.reports` |
| **MTPA** (`mtpaSeconds`) | `dataPrimeiroAgendamento − dataHoraCriacao` | expressão `pimeiroAgendamento` sobre `erp.schedules` |

`*Horas = *Seconds / 3600`. Exibição formatada `HH:MM:SS` (medidas
`Média MTTR Formatada`, `Média MTTA Formatada`, `MTTR Formatado (Encerramento)`).

`MTTR Formatado (Encerramento)` = média de `mttrHoras` **usando a data de
encerramento** como eixo (`USERELATIONSHIP` com `dataEncerrado`).

Query de MTTA (`MTTs_Em play/Conclusao`):
```sql
select distinct ai.protocol, r.seconds_worked
from assignments a
left join assignment_incidents ai on ai.assignment_id = a.id
left join incident_status is2 on is2.id = ai.incident_status_id
left join teams t on t.id = ai.team_id
left join catalog_services cs on cs.id = ai.catalog_service_id
left join reports r on r.assignment_id = a.id
where a.created >= '2026-01-01'
  and (t.id in (1050,65,1065,1064,1063,1062)
       or cs.title in ('Oper. Reparo','Oper. Tecnologia','Equipe tecnologia','Equipe reparo'))
  and is2.title like 'Encerrado'
-- depois: GROUP BY protocol, SUM(seconds_worked) → mttaSeconds
```

Query de MTPA (`pimeiroAgendamento`):
```sql
select distinct s.assignment_id, s.start_date,
       row_number() over (partition by s.assignment_id order by s.start_date asc) persona
from schedules s
left join assignments a on a.id = s.assignment_id
group by s.assignment_id, a.created, s.start_date, a.conclusion_date
having s.start_date > a.created and s.start_date < a.conclusion_date
-- depois: filtra persona = 1 → dataPrimeiroAgendamento
```

**Validado no banco (julho/2026, encerrados, universo manutenção):**
3.751 protocolos · MTTR médio **16,59 h** · MTTA "em play" médio **1,30 h** · 0 sem em-play.

---

## 4. Produtividade de campo (Produtivo / Improdutivo / Sem Ação)

Esta é a regra **mais delicada** do modelo. Envolve três tabelas.

### 4.1 `Field Manutenção` — a agenda de campo

Base: view `erp.v_service_desk_slots_productivity_informative` (vsdspi) +
`erp.reports`. Grão: **um registro por (protocolo × slot de agenda × relato)**.

```sql
SELECT vsdspi.assignment_id,
       vsdspi.protocol             AS protocolo,
       vsdspi.incident_type_title  AS tipo_protocolo,
       vsdspi.incident_status_title AS status_protocolo,
       vsdspi.resource_name        AS instalador,
       vsdspi.region_title         AS base,
       vsdspi.begin_date_slot      AS slot_agenda,
       r.beginning_date            AS data_relato,
       r.title                     AS descricao,
       r.description               AS relato,      -- <<< contém o código de produtividade
       cs.title                    AS catalogo
FROM v_service_desk_slots_productivity_informative vsdspi
LEFT JOIN assignment_incidents ai ON ai.assignment_id = vsdspi.assignment_id
LEFT JOIN catalog_services cs     ON cs.id = ai.catalog_service_id
LEFT JOIN reports r               ON r.assignment_id = vsdspi.assignment_id
WHERE vsdspi.incident_type_title IN (
  'TEC - Suporte técnico',
  'TEC-MANUT-ACESSO-CLI-INCIDENTE/PROBLEMA',
  'TEC-MANUT-ACESSO-CLI-INCIDENTE/RECORRENTE',
  'TEC-MANUT-ACESSO-CLI-PREVENCAO/PROBLEMA',
  'TEC-MANUT-ACESSO-CLI-PREVENCAO/RECORRENTE',
  'TEC-MANUT-ACESSO-CLI-REQUISICAO',
  'TEC-MANUT-INT-CLIN-REGULARIZACAO',
  'TEC - Suporte / Problema [ Telefonia ]',
  'TEC - Pendência Técnico Campo'
)
AND vsdspi.begin_date_slot >= DATE '2026-05-01'
```

### 4.2 `ClassificacaoRelato` / `CategoriaProdutividade`

O relato do técnico (`reports.description`, HTML) contém um **código padronizado**.
A coluna `ClassificacaoRelato` é um `SWITCH` com ~44 `CONTAINSSTRING` que extrai o
código; `CategoriaProdutividade` reduz a:

```
relato contém "IMPROD" → 'Improdutiva'
relato contém "PROD"   → 'Produtiva'
senão                  → BLANK
```

> ⚠️ **Ordem importa**: `"IMPROD"` é testado **antes** de `"PROD"`, porque
> `"IMPRODUTIVO"` também contém `"PROD"`. Em SQL/TS a mesma precedência
> precisa ser respeitada.

**Confirmado no banco** — `reports.description` é HTML com o código no início,
às vezes prefixado por `Relato por <NOME><br>--------------------<br>`:

| Código | Volume (mai–ago/2026) |
|---|---|
| `2.04 - REL - PRODUTIVA - Fechamento de Instalação de Fibra` | 10.416 |
| `MAN.002 - IMPROD - REAGENDA CLI (COM VISITA)` | 434 |
| `2.015 - REL - IMPRODUTIVO - Fechamento de Instalação de Fibra` | 417 |
| `MAN.005 - IMPROD - REAGENDA POR CHUVA (SEM VISITA) - MAN` | 307 |
| `MAN.004 - IMPROD - REAGENDA POR CHUVA (COM VISITA) - MAN` | 261 |
| `INST.004 - IMPROD - REAGENDA POR CHUVA (SEM VISITA) – INST` | 260 |
| `MAN.008 - IMPROD - CLI AUSENTE/SEM CONTATO` | 202 |
| `MAN.001 - IMPROD - AGUARDANDO RETORNO INFRA` | 168 |

Catálogo completo de códigos (motivos de improdutividade) — 3 famílias:

- **`INST.001` … `INST.021`** — improdutividade de instalação
  (inviabilidade infra cliente, cliente cancela agenda c/ e s/ visita,
  reagenda por chuva c/ e s/ visita, cliente solicita reagendamento, erro
  operacional s/ visita, erro comercial c/ e s/ visita, reagendado pelo técnico,
  inviabilidade técnica, cliente fora da área, interna do cliente, CTO sem porta
  livre, responsável ausente/menor no local, pendência área de risco, SST-risco,
  cliente solicita cancelar contratação, acesso negado)
- **`MAN.001` … `MAN.013`** — improdutividade de manutenção
  (aguardando retorno infra, reagenda cliente c/ e s/ visita, reagenda por chuva
  c/ e s/ visita, reagendado pelo técnico c/ e s/ visita, cliente ausente/sem
  contato, cancela a pedido do cliente, pendência de endereço, inviabilidade no
  cliente, inviabilidade técnica, não foi para cx do técnico)
- **`OPER.001` / `OPER.002`** — erro do operacional / backoffice
- **`2.04` (PRODUTIVA) / `2.015` (IMPRODUTIVO)** — fechamento de instalação de fibra

### 4.3 `Status Protocolo Dia` — a matriz protocolo × dia

Tabela calculada. Base = `DISTINCT(protocolo, TRUNC(slot_agenda))` de
`Field Manutenção`. Para cada par:

```
InstaladoNoDia  = protocolo com statusProtocolo='Encerrado' e TRUNC(dataEncerrado) = Dia
ImprodutivoNoDia = existe relato com CategoriaProdutividade='Improdutiva' e TRUNC(data_relato) = Dia

Status = InstaladoNoDia  > 0 → 'Produtivo'
         ImprodutivoNoDia > 0 → 'Improdutivo'
         senão                → 'Sem Ação'
```

Enriquecida por lookup em `protocolosTotais`: Cliente, Cidade, Status Voalle,
Data Encerrado, Catálogo, Tipo, Técnico (`responsavelProtocolo`), Base
(`EQUIPES TEMPORARIAS`).

`Qtd Visitas Improd` = nº de **datas distintas de relato improdutivo** do
protocolo naquele dia (conta visitas, não relatos).

### 4.4 Medidas de produtividade

| Medida | Fórmula |
|---|---|
| `Qtd Protocolos Base` | `DISTINCTCOUNT(protocolo)` |
| `Produtivo` / `Improdutivo` / `Sem Ação` | `Qtd Protocolos Base` filtrado por `Status` |
| `% Produtivo` / `% Improdutivo` / `% Sem Ação` | sobre `Qtd Protocolos Base` |
| `Assertividade` | `Produtivo / Qtd Protocolos Base` |
| `Visitas Improdutivas` | `SUM(Qtd Visitas Improd)` |
| `Total Visitas` | `Produtivo + Visitas Improdutivas + Sem Ação` |
| `Total Visitas Reais` | `Produtivo + Visitas Improdutivas` (exclui Sem Ação) |
| `Assertividade Visita` | `Produtivo / Total Visitas` |
| `Assertividade de Campo` / `% Produtiva Campo` | `Produtivo / Total Visitas Reais` |
| `% Improdutiva Campo` | `Visitas Improdutivas / Total Visitas Reais` |
| `Improdutivo + Sem Ação` | soma |
| `Média Diária Reparos` | `Produtivo / DISTINCTCOUNT(Dia)` |
| `Média Diária Reparos Produtivos` | `Produtivo / DISTINCTCOUNT(Dia onde Status='Produtivo')` |
| `Média Reparos Time` | `Produtivo / SUMX(Técnico, DISTINCTCOUNT(Dia))` |
| `Média Reparos Produtivos Time` | idem, restrito a dias produtivos |

Medidas equivalentes em `Field Manutenção` (`##Qtd Agendado`, `##Qtd Produtivo`,
`##Qtd Improdutivo`, `##Qtd Sem Ação`) reproduzem a mesma lógica para um único dia
selecionado, com a regra extra em `##Qtd Improdutivo`:
`dataEncerrado` vazio **ou** `TRUNC(dataEncerrado) <> Dia` (não instalado no dia).

`##Qtd Sem Ação` = `EXCEPT(Agendados, UNION(Produtivos, Improdutivos))` — os
agendados que não tiveram nenhum desfecho no dia.

---

## 5. Reincidência e recorrência de clientes

Base: `reincidentesVisitas` — um registro por protocolo
(`Table.Distinct` por `protocol`), com `created = ai.beginning_service_date`,
`usuario = ac.user` (login PPPoE), `LAG(a.created)` e `ROW_NUMBER()` particionados
por `client_id`. Enriquecida com `categoria2` de `Base Categorias Field`.

Filtro de universo ampliado (inclui preventivas):
```sql
a.created >= '2026-01-01'
AND ( t.id IN (1050,65,1065,1064,1063,1062)
   OR cs.title IN ('Oper. Reparo','Oper. Tecnologia','Equipe tecnologia','Equipe reparo')
   OR it.title IN ('TEC-MANUT-ACESSO-CLI-PREVENCAO/PROBLEMA',
                   'TEC-MANUT-ACESSO-CLI-PREVENCAO/RECORRENTE',
                   'TEC-MANUT-ACESSO-CLI-INCIDENTE/PROBLEMA',
                   'TEC-MANUT-ACESSO-CLI-INCIDENTE/RECORRENTE') )
AND is2.title <> 'Cancelado'
```

### 5.1 Definições de "preventiva"

```
CategoriasPreventivas (categoria2) = {
  'Preventiva / Recorrência Manutenção',
  'Preventiva reparo',
  'Preventiva tecnologia',
  'Preventiva /Correção de Sinal'
}
TiposProtocoloPreventivos (incident_types.title) = {
  'TEC-MANUT-ACESSO-CLI-PREVENCAO/PROBLEMA',
  'TEC-MANUT-ACESSO-CLI-PREVENCAO/RECORRENTE'
}
EhPreventiva = categoria2 ∈ CategoriasPreventivas OR tipoProtocolo ∈ TiposProtocoloPreventivos
```

### 5.2 `CLIENTES REINCIDENTES (Final)`

Chave de agrupamento: **(NOME DO CLIENTE, usuario)**. Só classifica o protocolo
que for (a) **não preventivo** e (b) **o mais recente do mês** para aquela chave.
Contagens de protocolos anteriores **não preventivos** da mesma chave:

```
QtdOS30d   : created ∈ (DataAtual−30, DataAtual)
QtdOS31a60d: created ∈ (DataAtual−60, DataAtual−30]
QtdOS61a90d: created ∈ (DataAtual−90, DataAtual−60]

QtdOS61a90d > 0 → 'Reincidente 90'
QtdOS31a60d > 0 → 'Reincidente 60'
QtdOS30d    > 0 → 'Reincidente 30'
senão           → 'Não Reincidente'
```
(fora dessas condições → BLANK, isto é, não entra na conta)

### 5.3 `CLIENTES RECORRENTES (Super-Filtro)`

Mesma estrutura, com **dois filtros extras**: exclui preventivas **e** exclui
`categoria5 = 'Solucao Interna'`. E a classificação é **cumulativa**
(exige presença em todas as janelas):

```
QtdOS61a90d > 0 AND QtdOS31a60d > 0 AND QtdOS30d > 0 → 'Recorrente 90'
QtdOS31a60d > 0 AND QtdOS30d > 0                     → 'Recorrente 60'
QtdOS30d > 0                                         → 'Recorrente 30'
senão                                                → 'Não recorrente'
```

> Diferença conceitual: **reincidente** = voltou a abrir chamado em alguma janela.
> **recorrente** = voltou a abrir chamado em **todas** as janelas consecutivas
> (problema crônico).

### 5.4 Reincidência pós-preventiva (qualidade da preventiva)

`REINCIDÊNCIA_REPARO_PÓS_PREVENTIVA` — na linha de um **reparo**, mede a
distância até a **última preventiva anterior** do mesmo cliente:

```
DiasDesdePreventiva = created − MAX(created das preventivas anteriores do cliente)
  ≤ 30 → 'Reincidente Prev 30d'
  ≤ 60 → 'Reincidente Prev 60d'
  ≤ 90 → 'Reincidente Prev 90d'
```
> ⚠️ Contém uma exclusão hardcoded: `NOME DO CLIENTE <> 'LUIS GUSTAVO ANTUNES NUNES'`
> (provável cliente de teste). Deve virar configuração, não código.

Visão inversa (`C1`/`C2`/`C3`) — na linha de uma **preventiva**, olha para frente
até 90 dias e acha o primeiro reparo não-preventivo do cliente:
- `C1 Protocolo Reincidente do PREV` = `MIN(protocol)`
- `C2 Protocolo Reincidente do Prev (data)` = `MIN(created)`
- `C3 Classificacao Reincidente Preventiva` = faixa 30/60/90 d

`% Reincidentes sobre Preventivos` = preventivas com `C3` preenchido ÷
`Preventivos Abertos Total`.

`Preventivos Abertos Total` (denominador) — restrito a:
- `tipoProtocolo ∈ TiposProtocoloPreventivos` **ou** `categoria2 ∈ CategoriasPreventivas`
- `catalogoProtocolo ∈ {Equipe reparo, Equipe tecnologia, Oper. Reparo, Oper. Tecnologia}`
- `statusProtocolo <> 'Cancelado'`
- `CIDADE ∈ {Cachoeirinha, Canoas, Esteio, São Leopoldo, Novo Hamburgo, Sapucaia do Sul}`

### 5.5 Percentuais de recorrência

`% Recorrentes 30d/60d/90d` cruzam `CLIENTES RECORRENTES (Super-Filtro)` com um
filtro em `Ofensores de Reparos[previous_categoria2]` ∈
`{⚠️Retorno prioritário, Instabilidade de Conexão, Instabilidade Fibra, Serviço
indisponível Fibra, Serviço local (Reparo), Serviço local (Tecnologia),
INSTABILIDADE, INDISPONIBILIDADE, ACAO ATIVA - PROBLEMA RECORRENTE}`
— só conta recorrência quando o chamado anterior foi de natureza técnica.

### 5.6 `Base` (região) em `reincidentesVisitas`

```
São Leopoldo | Sapucaia do Sul | Novo Hamburgo → 'Base: SÃO LEO/SPS/NHO'
Esteio | Canoas | Porto Alegre                 → 'Base: EIO/CANOAS/POA'
outras                                         → 'Base: NSR/TRIUNFO'
```

---

## 6. Ofensores

### 6.1 `Ofensores de Reparos` — reparo atual × reparo anterior

`LAG(...) OVER (PARTITION BY ai.client_id ORDER BY a.created)` sobre 12 campos:
`protocol`, `created`, `responsible_name` (técnico), `incident_type`, `catalogo`,
`context`, `problem`, `solution`, `categoria1..categoria5`.

Permite responder: *"o cliente voltou — quem atendeu antes, e qual foi o
problema/solução anterior?"*. Alimenta a tabela **REPARO VIGENTE × REPARO ANTERIOR**
e o pivot **TÉCNICOS OFENSORES EM RECORRÊNCIA (30/60/90 dias)**.

As 5 categorias vêm de `solicitation_category_matrices` →
`solicitation_service_categories` (`service_category_id_1..5`).

### 6.2 `ofensoresTecnicos`
Versão reduzida: `protocol` + `previous_responsible_name`.

### 6.3 `patrimoniosAlocados` — ofensores de equipamento
```sql
SELECT c.contract_number "CONTRATO", MIN(plis.out_date) "DATA PRIMEIRA ALOCAÇÃO"
FROM patrimony_packing_list_items plis
LEFT JOIN patrimony_packing_lists ppl ON ppl.id = plis.patrimony_packing_list_id
LEFT JOIN assignments a ON a.id = ppl.assignment_id
LEFT JOIN assignment_incidents ai ON ai.assignment_id = a.id
LEFT JOIN contract_service_tags cst ON cst.id = ai.contract_service_tag_id
LEFT JOIN contracts c ON c.id = cst.contract_id
GROUP BY c.contract_number
```
Em `totalVisitas`, `Total de Dias = Data Criado − DATA PRIMEIRA ALOCAÇÃO`
→ idade do equipamento no momento do chamado (correlação equipamento antigo × reincidência).

---

## 7. Base de clientes e coeficiente de reparos

### 7.1 `Base Clientes` — ⚠️ fonte externa
```
Odbc.Query("dsn=dbMaria", "SELECT * FROM DB_Applicattion.Autentication_Contracts_Daily")
```
Snapshot **diário** de contratos autenticados por `DATA / CIDADE / BAIRRO / SITE / CLIENTES`.
Vive em **MariaDB**, não no Postgres do ERP. **Não há credencial para ela no `.env`.**
→ ver pendência P1 em `03-plano.md`.

### 7.2 Coeficiente de reparos (KPI central da página "Indicadores Manutenção")
```
Clientes no Dia            = SUM(Base Clientes[CLIENTES])
Qtd Protocolos Distintos 2 = DISTINCTCOUNT(protocolosTotais[numeroProtocolo])
Coeficiente Reparo         = Qtd Protocolos Distintos 2 / Clientes no Dia
Coeficiente Reparo (Encerramento) = Reparos (Encerramento) / Clientes (Encerramento)
Coeficiente Reparo Consolidado    = Qtd Protocolos Distintos 2 / Clientes Último Dia
```
Versões `(Região)` restringem a `{Cachoeirinha, Canoas, Esteio, Novo Hamburgo,
São Leopoldo, Sapucaia do Sul}`.

**`Meta Coeficiente`** (por dia da semana, `WEEKDAY(...,2)`):
```
domingo → 0,06%   sábado → 0,08%   seg–sex → 0,12%
```

`Projeção Reparos Mês` = `(reparos até a data ÷ dias decorridos) × total de dias do mês`
`Projeção Clientes Mês` = `Clientes Último Dia Mês Anterior + projecao_ativacoes − projecao_cancelamentos`
`Coeficiente Projetado Mês` = razão das duas projeções.

> ⚠️ `Crescimento Clientes Mês Março` tem `ClientesInicio = 79186` **hardcoded** e
> `Dias Com Dados Clientes = DAY(TODAY()) − 12`. Débito técnico a não replicar.

### 7.3 `totalClientes` / `baseAtivosSebratel` / `authentication_contracts`
- `totalClientes`: `erp.consolidated_indicators` (totalizadores mensais,
  `monthly_year` no formato `'MM/YYYY'`). Último registro: **12/2025 → 79.351
  autenticados / 80.250 contratos**.
- `baseAtivosSebratel`: `DISTINCT ac.user, ac.created` de `authentication_contracts`.
- `authentication_contracts`: contrato + user + cidade + bairro + ponto de acesso.
  `AcumuladoContratosBase` = `DISTINCTCOUNT(contract_number)` acumulado até a data.

---

## 8. Ativações, cancelamentos e projeções

**Tipos de incidente considerados ativação**: `it.id IN (12, 1014, 1136, 1254, 1255)`.

`Ativações_no_mes` — primeira alocação de patrimônio por contrato no mês corrente:
```sql
WITH base AS (
  SELECT c.contract_number, DATE(plis.out_date) AS data_ativacao
  FROM patrimony_packing_list_items plis
  LEFT JOIN patrimony_packing_lists ppl ON ppl.id = plis.patrimony_packing_list_id
  LEFT JOIN assignments a ON a.id = ppl.assignment_id
  LEFT JOIN assignment_incidents ai ON ai.assignment_id = a.id
  LEFT JOIN incident_types it ON it.id = ai.incident_type_id
  LEFT JOIN contract_service_tags cst ON cst.id = ppl.contract_service_tag_id
  LEFT JOIN contracts c ON c.id = cst.contract_id
  WHERE it.id IN (12,1014,1136,1254,1255) AND plis.out_date IS NOT NULL
),
primeira_instalacao AS (
  SELECT contract_number, MIN(data_ativacao) AS data_ativacao FROM base GROUP BY 1
)
SELECT COUNT(contract_number) AS "Total Ativações" FROM primeira_instalacao
WHERE data_ativacao >= DATE_TRUNC('month', CURRENT_DATE)
  AND data_ativacao <  DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
```

`Cancelamentos_no _mes` — `c.cancellation_date` no mês **e** `c.v_stage = 'Aprovado'`.

### Projeções — regra de "dias produtivos"
```
domingo        → 0
sábado         → 0,5
feriado        → 0
demais         → 1

projecao = ROUND( (total_no_mes / dias_produtivos_trabalhados) * dias_produtivos_mes )
```
Feriados **hardcoded na query** (2026-01-01, 04-03*, 04-21, 05-01, 06-04, 09-07,
10-12, 11-02, 11-15, 12-25).
*04-03 aparece só em Ativações, não em Cancelamentos — **inconsistência** a corrigir.
→ deve virar tabela/config de feriados.

---

## 9. Demais medidas relevantes

| Medida | Fórmula |
|---|---|
| `TOTAL_STATUS_ENCERRADO` | `SUMX(IF(CONTAINSSTRING([TIPOS DE STATUS],"Encerrado"),1,0))` |
| `TotalEncerrados` | `COUNT(solicitacao)` onde `statusProtocolo='Encerrado'` |
| `TotalEncerrados 2` | idem, mas pelo **eixo de encerramento** (`USERELATIONSHIP` + `REMOVEFILTERS(Calendario)`) |
| `Media_Diaria_Criados_Mes_Atual` | `DISTINCTCOUNT(numeroProtocolo) / dias decorridos do mês` |
| `Media_Diaria_Encerrados_Mes_Atual` | `TotalEncerrados 2 / dias decorridos do mês` |
| `SEM AGENDAMENTO` | `COUNTBLANK(dataHoraUltimaAgenda)` onde `TIPOS DE STATUS='Protocolos Abertos'` |
| `Porcentagem_total` | share ignorando filtros de `CIDADE`/`BAIRRO` |
| `Porcentagem_total_Equipes` | share ignorando filtro de `equipesProtocolo` |
| `BASExPROTOCOLOS` | `TotalEncerrados / totalClientes[TOTAL_CLIENTESS]` |
| `BASExPROTOCOLOS_VIGENTE` | `TotalEncerrados / DISTINCTCOUNT(baseAtivosSebratel[user])` |
| `TOTAL DO MES ANTERIOR` / `% CRESCIMENTO` | comparação MoM sobre o eixo de encerramento |
| `DIVISAO CAPACIDADE INSTALACAO` / `MANUTENCAO` | `COUNT(solicitacao) / 3` e `/ 2` — capacidade por equipe (gauge AGENDA/CAPACIDADE) |
| `Protocolos por Base no Dia` | `Protocolos Abertos no Dia / AcumuladoContratosBase` |

---

## 10. Páginas do relatório atual (checklist de escopo)

| Página | Visuais | Conteúdo |
|---|---|---|
| Protocolos Abertos Suporte | 30 | protocolos abertos por categoria 1/2/3, catálogo, tipo de solicitação; tabela detalhada |
| Manutenção Campo | 36 | entrantes/encerrados por cidade, base, categoria, solução, site, bairro; em andamento por data de abertura |
| Indicadores Manutenção | 49 | base de clientes diária (cidade/bairro/site) × coeficiente de reparos; reparos × soluções |
| Clientes recorrentes | 33 | recorrentes 30/60/90 d, técnicos ofensores, reparo vigente × anterior |
| Indicadores Recorrência | 38 | recorrentes 30/60/90 d por base, cidade, bairro, catálogo |
| Clientes reincidentes | 30 | reincidentes 30/60/90 d (+ cortes por cliente corporativo) |
| Preventivos | 40 | preventivos abertos por base/cidade/bairro/site/categoria; qualidade da preventiva |
| Relatório Executivo | 27 | KPIs de topo, MTTR_E, protocolos encerrados, reparos por dia × turno por base |
| Geral MTTs | 27 | MTTR_E e MTTA por dia, base, bairro, catálogo; indicadores mensais |
| Field Manutenção | 37 | assertividade diária (total, por base, por técnico); produção e média por técnico |
| CARTÃO / CARTÃO(PORCENT) / CARTÃO(Equipes) | 1 cada | tooltips (gauge AGENDA/CAPACIDADE, pivots auxiliares) |

Filtros (slicers) recorrentes em todas as páginas: **Data (criação / encerramento /
agenda), Ano, Mês, Dia, Cidade, Bairro, Bases, Equipes, Técnico, Catálogo, Tipo de
Protocolo, Status do Protocolo, Categoria 1–5, Cliente, Protocolo**.

---

## 11. O que **não** replicar

- Tabelas `LocalDateTable_*` e `DateTableTemplate_*` (tabelas de data automáticas do PBI).
- Tema `CY24SU02` (tema genérico, sem customização).
- Valores hardcoded: `ClientesInicio = 79186`, `Dias Com Dados Clientes = DAY(TODAY())−12`,
  exclusão de cliente por nome, listas de feriados dentro do SQL.
- Medida `Medida` (vazia) e duplicatas
  (`% Reincidentes Prev60d/Prev90d` usam o mesmo numerador de `Prev30d` — **bug** no modelo atual).
