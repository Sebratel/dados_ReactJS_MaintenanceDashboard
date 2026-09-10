# Levantamento do schema real (Postgres)

Executado em 2026-08-04 via `scripts/db/probe.mjs`, `deep.mjs`, `validate.mjs`.

---

## 1. Conexões do `.env`

Verificado em 2026-08-04 (TCP + autenticação + leitura de negócio):

| Alias | Endpoint | Banco | Usuário | Status |
|---|---|---|---|---|
| `DB_ELLEVEN` | 186.219.128.248:5432 (Postgres 13) | `dbemp00100` | `cliente_s` | ✅ conecta · **read-only confirmado** |
| `MARIA` | 10.0.11.171:3306 (MariaDB 10.11) | `DB_Applicattion` | `DevSebratel` | ✅ conecta (IP privado — exige rede/VPN) |
| `DB_AUTOISP` | 186.219.134.172:5432 (Postgres 12.22) | `postgres` (53 GB) | `sebratel_db` | ✅ conecta · 167/200 tabelas legíveis — ver §1.4 |

**Revalidado em 2026-08-05: as quatro conexões do `.env` passam.**
TCP em 2–5 ms nos três bancos; autenticação e leitura de negócio OK em todos;
par OAuth do Google válido. Não há mais nada pendente no arquivo `.env`.

`cliente_s` está em **transação read-only**: `CREATE SCHEMA` retorna
`cannot execute CREATE SCHEMA in a read-only transaction`. Isso **decide a
pendência P2** — a materialização do Tier 2 vai para um Postgres nosso.

Google OAuth: o par `client_id` + `client_secret` foi validado contra
`https://oauth2.googleapis.com/token` (resposta `invalid_grant`, que é o erro
esperado quando o par está certo e só o `code` é falso; um par errado
retornaria `invalid_client`). ✅ credenciais válidas.

### ⚠️ Bug de parsing corrigido no `.env`

`MARIA_PASSWORD=:XXXXXX/XXX#` estava **sem aspas**. Em dotenv, `#` fora de aspas
inicia comentário: o valor era truncado de 12 para 11 caracteres
(`:XXXXXX/XXX`) **silenciosamente**. Comprovado empiricamente:

| Senha entregue ao driver | Resultado |
|---|---|
| `:XXXXXX/XXX` (truncada, sem o `#`) | `ER_ACCESS_DENIED_ERROR` |
| `:XXXXXX/XXX#` (completa) | autentica |

> 🔒 A senha real foi **redigida em 10/09/2026**, antes do primeiro push para o
> GitHub — estava aqui em texto puro. O que importava para o registro era o
> FORMATO (terminar em `#`), não o valor. Ao documentar um bug de credencial,
> descreva a forma do valor, nunca o valor.

O sintoma aparece como "credencial errada", não como erro de configuração —
por isso é difícil de diagnosticar. Corrigido com aspas simples; todas as senhas
do arquivo foram citadas por precaução.

### 1.1 ELLEVEN **é o ERP Voalle**

`PostgreSQL 13.23 (Debian)`. Um único schema de negócio: **`erp`**, com **1.384 tabelas/views**.

**Descoberta central: as 30 tabelas/views referenciadas pelo Power BI existem no
Postgres com exatamente os mesmos nomes.** O `dsn=dbvoalle` do Power BI Desktop
aponta para este mesmo Postgres via ODBC — não é Firebird. Confirmado também pelo
fato de as queries de projeção usarem sintaxe Postgres pura
(`DATE_TRUNC`, `generate_series`, `::date`, `INTERVAL`, `EXTRACT(DOW ...)`).

**Consequência prática:** o SQL do PBIP é reaproveitável quase literalmente —
basta qualificar com o schema `erp.` (ou definir `search_path = erp, public`).
Não há trabalho de remapeamento de nomes.

Objetos confirmados (todos em `erp`, todos `BASE TABLE` exceto os dois últimos):

```
assignment_incidents            authentication_splitter_ports   people
assignments                     authentication_splitters        people_addresses
authentication_access_points    catalog_services                reports
authentication_concentrators    catalog_services_items          schedules
authentication_contracts        consolidated_indicators         solicitation_category_matrices
authentication_sites            contract_service_tags           solicitation_classifications
                                contracts                       solicitation_problems
                                incident_status                 solicitation_service_categories
                                incident_types                  solicitation_solutions
                                manufacturers                   teams
                                patrimony_packing_list_items
                                patrimony_packing_lists
v_service_desk_slots_productivity_informative   (VIEW)
v_users                                          (VIEW)
```

### 1.2 AUTOISP — rede liberada em 2026-08-05

A porta **abriu**: 186.219.134.172:5432 responde em **5 ms** (antes era
`ETIMEDOUT` com 90 s de espera). O bloqueio de firewall foi removido.
Estado da credencial em §1.4; conteúdo do banco em §1.5.

### 1.3 MARIA (`DB_Applicattion`) — o Data Hub

MariaDB 10.11.10, 10 tabelas. É a fonte do `Base Clientes` do Power BI
(`dsn=dbMaria`) e tem mais coisa útil do que o relatório atual usa:

| Tabela | Registros | Janela | Relevância |
|---|---|---|---|
| **`Autentication_Contracts_Daily`** | 145.935 | 2026-03-03 → 2026-08-03 | ⭐ **base diária de clientes** — resolve o P1 |
| `Backlog_Schedules` | 85.921 | 2025-10-11 → 2026-09-05 | protocolo × slot de agenda × data de carga (inclui agenda futura) |
| `Backlog_Installation` | 5.672 | 2024-06-18 → 2026-08-03 | backlog por tipo de protocolo e equipe |
| `Clients_Daily` | 24.787 | 2026-07-03 → 2026-08-03 | mesma estrutura, série curta |
| `Contracts_Daily` | 17.108 | 2026-06-30 → 2026-08-03 | mesma estrutura, série curta |
| `Installation_Teams` | 10.795 | 2024-08-01 → **2025-07-16** | ⭐ **`CAPACIDADE MANHÃ` / `CAPACIDADE TARDE` por equipe/dia** — desatualizada há 1 ano |
| `v_users` | 69 | — | `name`, `modified` |
| `General_Commercial` | 55.198 | 2022-01-04 → **2024-10-31** | comercial — fora de escopo, desatualizada |
| `Comercial_Teams` | 485 | — | comercial — fora de escopo |
| `finnancial_receipt` | 7 | — | financeiro — fora de escopo |

#### `Autentication_Contracts_Daily`

```
date:datetime, total:bigint, city:varchar, neighborhood:varchar, site:varchar, id:bigint
```

- ~786 linhas/dia (33 cidades × 206 bairros × 19 sites).
- Último snapshot **2026-08-03: 85.525 clientes**.
- Por cidade: São Leopoldo 31.243 · Canoas 20.908 · Sapucaia do Sul 15.719 ·
  Novo Hamburgo 9.772 · Esteio 6.083 · Cachoeirinha 1.639 · demais < 50.
- ⚠️ `date` é **`datetime`**, com hora da carga (`23:50:16`), não data limpa →
  todo agrupamento precisa de `DATE(date)`.
- ⚠️ **Cobertura incompleta: 141 dias com dado em um intervalo de 154** →
  **13 dias faltando**. O coeficiente de reparos daqueles dias fica sem
  denominador. Precisa de tratamento explícito (carregar último valor conhecido
  — LOCF — e sinalizar na UI que o dia é interpolado).
- ⚠️ Histórico começa em **2026-03-03**, não em janeiro. Comparações de
  coeficiente antes de março não existem.

#### Achado extra: capacidade de agenda

`Installation_Teams` tem `CAPACIDADE MANHÃ` e `CAPACIDADE TARDE` por
equipe/técnico/dia. Isso é a fonte **correta** para o gauge
`AGENDA / CAPACIDADE` — as medidas atuais do Power BI
(`DIVISAO CAPACIDADE INSTALACAO` = `COUNT(solicitacao)/3`,
`DIVISAO CAPACIDADE MANUTENCAO` = `/2`) são um proxy grosseiro que assume
3 instalações ou 2 manutenções por equipe/dia. Mas a tabela **para em
2025-07-16** — se voltar a ser alimentada, vale trocar.

### 1.4 AUTOISP — credencial OK, faltam GRANTs

Histórico do diagnóstico:

| Data | Estado |
|---|---|
| 2026-08-04 | ❌ `ETIMEDOUT` no TCP — firewall bloqueando |
| 2026-08-05 (manhã) | ✅ rede liberada · ❌ `sebratel_ro` → `28P01 password authentication failed` |
| 2026-08-05 (atual) | ✅ **`sebratel_db` conecta e lê** |

Sobre o `sebratel_ro`: o role **existe** (`pg_roles`: `rolcanlogin = true`, sem
`rolvaliduntil`), mas a senha `Z2EfdD8NHLqr` não é dele — e essa mesma senha
funciona no `sebratel_db`. Roles no servidor: `int6_analytics`,
`int6_db_replica_reader`, `int6_flows`, `int6_reader`, `postgres`, `replicator`,
`sebratel_db`, `sebratel_ro`, `zbx_monitor`.

**O `.env` está resolvido** (usa `sebratel_db`). O que continua faltando é
permissão, e isso **nenhuma troca de usuário resolve** — verificado com
`has_table_privilege` para os dois roles:

| Tabela | Tamanho | `sebratel_db` | `sebratel_ro` |
|---|---|---|---|
| `optical_power_samples` | **16 GB** (46,5 M linhas) | ❌ | ❌ |
| `optical_power_rollup_stats` | **5.354 MB** (12,2 M linhas) | ❌ | ❌ |
| `gpon_observability_events` | 608 MB | ❌ | — |
| `client_infos` | 196 MB | ❌ | — |
| `diagnostic_snapshots` | 35 MB | ❌ | — |
| `gpon_client_cto_vinculation_snapshots` | 35 MB | ❌ | — |
| `onu_statuses` | 1.754 MB | ✅ | ✅ |
| `onu_status_changes` | 664 MB | ✅ | ✅ |
| `gpon_clients` | 321 MB | ✅ | ✅ |
| `ctos` | 80 kB | ✅ | ✅ |

Placar: **167 legíveis / 33 negadas** de 200 objetos em `public`. Confirmado
também com `SELECT` real, não só com `has_table_privilege` —
`permission denied for table optical_power_samples`.

As outras negadas são operacionais e não fazem falta: `integration_logs`
(3.991 MB), `olt_returns` (2.025 MB), `task_logs` (1.872 MB), `audits`
(1.002 MB), `ping_results`, `download_results`, `upload_results`, `users`,
`settings`, `jwt_denieds`, `web_drivers`.

**Pedido ao DBA** (só isto falta para a Fase 2 completa):

```sql
GRANT SELECT ON TABLE public.optical_power_samples      TO sebratel_db;
GRANT SELECT ON TABLE public.optical_power_rollup_stats TO sebratel_db;
-- desejáveis, não bloqueantes:
GRANT SELECT ON TABLE public.gpon_observability_events  TO sebratel_db;
GRANT SELECT ON TABLE public.diagnostic_snapshots       TO sebratel_db;
```

Sem os dois primeiros, a Fase 2 perde a **série histórica** de potência óptica e
fica só com o estado atual (`onu_statuses`) e as transições
(`onu_status_changes`) — o que ainda permite a fila de preventiva, mas não a
análise de tendência de degradação.

### 1.5 AUTOISP — o que tem dentro (via `sebratel_db`)

`PostgreSQL 12.22 (Debian)`. Um banco (`postgres`, **53 GB**), um schema
(`public`, **200 objetos**, 4 views). É a plataforma de **provisionamento e
observabilidade GPON** — telemetria óptica por cliente, que o ERP não tem.

Maiores tabelas:

| Tabela | Linhas (est.) | Tamanho |
|---|---|---|
| `optical_power_samples` 🔒 | 46.556.592 | 16 GB |
| `optical_power_rollup_stats` 🔒 | 12.193.356 | 5.354 MB |
| `olt_onu_configs` | 19.780.348 | 3.750 MB |
| `onu_status_changes` | 4.033.596 | 664 MB |
| `user_events` | 3.836.693 | 1.119 MB |
| `onu_statuses` | 211.453 | 1.754 MB |
| `gpon_clients` | 214.538 | 321 MB |

🔒 = sem permissão de leitura.

#### `onu_statuses` — saúde óptica atual por cliente (58 colunas)

Colunas relevantes: `gpon_client_id`, `rx_power`, `tx_power`, `olt_rx_power`,
`calculated_rx_power`, `calculated_status`, `calculated_status_trigger`,
`rx_good`, `onu_oper`, `olt_alarm_status`, `ponlink_alarm_status`, `trap_status`,
`massive_status`, `last_off`, `last_off_trigger`, `olt_last_off_cause`,
`status_previous`, `zabbix_*` (leituras via Zabbix), `ethernet`/`wan` (jsonb).

Distribuição atual de `calculated_status` e potência média:

| status | clientes | RX médio (dBm) |
|---|---|---|
| `OK` | 80.326 | −20,64 |
| `inactive` | 5.166 | 0,00 |
| `unavailable` | 4.145 | 0,00 |
| `power_fail` | 2.040 | 0,00 |
| **`warning`** | **1.297** | **−25,82** |
| **`critical`** | **749** | **−28,93** |
| `up` | 391 | 0,00 |
| `loss_signal` | 265 | 0,00 |
| `down` | 164 | 0,00 |
| (null) | 119.650 | — |

A degradação é monótona e limpa: OK −20,6 → warning −25,8 → critical −28,9 dBm.

#### `onu_status_changes` — histórico de transições (desde 2026-01-24)

12 a 35 mil mudanças de estado por dia; ~100 quedas/dia. Campos:
`gpon_client_id`, `previous_status`, `new_status`, `previous_rx_power`,
`new_rx_power`, `*_status_trigger`, timestamps.

#### `ctos` — **vazia** (0 registros)

Tem permissão, mas não há dados. Colunas existem (`occupancy`, `sanitized`,
`port_sanitization`, lat/lng, `last_vinculation_gpon`). Se fosse populada,
casaria com a categoria `SANITIZACAO DE CTO` (1.315 protocolos em 2026) e com o
indicador de CTO ofensor. **Vale perguntar se a importação de CTO está parada.**

#### A ponte AUTOISP ↔ ERP: login PPPoE

`gpon_clients` tem 215.288 registros — **214.995 com `pppoe_username`** mas apenas
**24 com `contract_id`**. Ou seja, a chave de junção é o **login PPPoE**, não o id
de contrato:

```sql
-- AUTOISP                              ERP
lower(trim(gpon_clients.pppoe_username)) = lower(trim(erp.authentication_contracts."user"))
```

**Testado com amostra de 2.947 logins distintos: 2.384 casaram (80,9 %)**, e o
join resolve até cidade/bairro:

| pppoe_username | contract_number | city | neighborhood |
|---|---|---|---|
| `felipeamaral285710` | 285710 | São Leopoldo | Feitoria |
| `brunogodoy285777` | 285777 | Sapucaia do Sul | Santa Catarina |
| `stefanierodrigues285719` | 285719 | Novo Hamburgo | São José |

(O padrão do login é `nome + número do contrato`, o que explica a alta taxa de
casamento. Os ~19 % restantes são provavelmente contratos cancelados ou de outra
base.)

#### O teste que valida a Fase 2

Cruzei o sinal óptico com o histórico de protocolos:

- **2.046 clientes** estão com `calculated_status` em `critical` ou `warning` agora;
- desses, **635 (31 %)** já abriram protocolo de reparo nos últimos 90 dias;
- **1.411 clientes têm sinal degradado e nenhum protocolo aberto.**

Esse é o público-alvo direto de uma preventiva preditiva — e o número saiu de
dado real, não de hipótese. Confirma a viabilidade dos modelos propostos em
`03-plano.md` §9.

---

## 2. Grão e chaves das tabelas centrais

| Tabela | Cols | PK / grão | Observação crítica |
|---|---|---|---|
| `erp.assignments` | 92 | `id` | `created`, `conclusion_date`, `final_date`, `beginning_date`, `seconds_worked`, `responsible_id`, `requestor_id`, `team_id`, `created_by`, `region_id` |
| `erp.assignment_incidents` | 76 | **`assignment_id`** | ⚠️ **não tem coluna `id`** — é 1:1 com `assignments`. `protocol` é o nº de protocolo de negócio. |
| `erp.schedules` | 25 | `id` | `assignment_id`, `start_date`, `end_date`, `performed`, `rescheduled` |
| `erp.reports` | 44 | `id` | `assignment_id`, `beginning_date`, **`description`** (relato HTML c/ código de produtividade), `title`, `seconds_worked`, geoposição inicial/final, `travelled_distance` |
| `erp.teams` | 32 | `id` (bigint) | `title`, `active` |
| `erp.contracts` | 154 | `id` | `contract_number`, `cancellation_date`, **`v_stage`**, **`v_status`** (colunas desnormalizadas do Voalle) |
| `erp.contract_service_tags` | 60 | `id` | `contract_id`, `service_tag`, `lat`, `lng`, endereço completo |
| `erp.incident_status` | 21 | `id` | `title`, **`unproductive`** (boolean nativo!) |
| `erp.incident_types` | 97 | `id` | `title`, `active` |
| `erp.catalog_services` | 25 | `id` | `title`, `active` |
| `erp.people` | 208 | `id` | `name`, `city`, `neighborhood`, `street`, `phone`, `lat`, `lng`, flags `client`/`technical`/`resource` |
| `erp.authentication_contracts` | 96 | `id` | `contract_id`, **`user`** (login PPPoE — precisa de quoting, é palavra reservada), `city`, `neighborhood`, `lat`, `lng`, `authentication_access_point_id` |
| `erp.consolidated_indicators` | 10 | `id` | `authentication_totalizer`, `contract_totalizer`, `monthly_year` (texto `'MM/YYYY'`) |

### View `erp.v_service_desk_slots_productivity_informative` (33 colunas)

```
assignment_id, protocol, incident_type_id, incident_type_title, team_id,
final_date, priority, incident_status_id, incident_status_title,
incident_status_unproductive, region_id, region_title, shift,
begin_date, end_date, identifier_attendance, rescheduling_type,
begin_date_slot, reserved_skills (jsonb), reserved_date,
routing_status, previous_routing_status, first_attendance_history,
last_attendance_history, actual_routing_status, begin_date_routing_status,
resource_id, resource_name, activation_type, activation_type_title,
assignment_created, conclusion_date
```

> Achados aproveitáveis que o Power BI **não** usa: `shift` (turno já pronto),
> `incident_status_unproductive`, `rescheduling_type`, `routing_status`,
> `first/last_attendance_history`. Podem simplificar métricas hoje calculadas à mão.

---

## 3. Volumetria e janelas de data

| Tabela | Registros | Janela |
|---|---|---|
| `erp.assignments` | 2.159.310 | `min(created)` = 1000-01-01 (lixo), `max` = 2026-08-04. **365.865 em 2026** |
| `erp.assignment_incidents` | 1.761.937 | `beginning_service_date`: 2010-04-07 → 2026-08-04 |
| `erp.v_service_desk_slots_productivity_informative` | 293.711 | `begin_date_slot`: 2025-05-27 → 2026-09-05 (inclui agenda futura) |

### Protocolos de manutenção por mês (universo do §1 de `01-regras`)

| Mês/2026 | Protocolos |
|---|---|
| jan | 2.961 |
| fev | 2.743 |
| mar | 3.271 |
| abr | 3.355 |
| mai | 3.542 |
| jun | 3.455 |
| jul | 3.765 |
| ago (parcial, até dia 04) | 418 |

→ ~**3.500 protocolos/mês**, ~**23 mil no ano**. Volume perfeitamente tratável
para consultas agregadas em tempo real.

---

## 4. Domínios de valores confirmados

### `erp.incident_status` (universo manutenção, 2026)

| id | title | unproductive | qtd 2026 |
|---|---|---|---|
| 4 | Encerrado | false | 250.930 |
| 8 | Cancelado | false | 9.925 |
| 2 | Andamento | false | 978 |
| 1 | Abertura | false | 888 |
| 3 | Fechado | false | 386 |
| 112 | Aguardando Aprovação de Encerramento | null | 359 |
| 20 | Agendado | false | 355 |
| 35 | A Faturar | false | 122 |
| 62 | Retorno 18 horas | **true** | 37 |
| 60 | Falta de contato 3 | **true** | 23 |

> ⚠️ Não existe status `'Faturado'` (a coluna `TIPOS DE STATUS` do PBI testa por ele).
> O equivalente é **`A Faturar`** (id 35). Divergência a confirmar com o negócio.

### `erp.incident_types` no universo manutenção (2026)

| id | title | qtd |
|---|---|---|
| 1174 | TEC - Suporte técnico | 10.039 |
| 1267 | TEC-MANUT-ACESSO-CLI-INCIDENTE/PROBLEMA | 9.148 |
| 1269 | TEC-MANUT-ACESSO-CLI-PREVENCAO/PROBLEMA | 3.626 |
| 1272 | TEC-MANUT-ACESSO-CLI-REQUISICAO | 1.207 |
| 1271 | TEC-MANUT-ACESSO-CLI-PREVENCAO/RECORRENTE | 369 |
| 1270 | TEC-MANUT-ACESSO-CLI-INCIDENTE/RECORRENTE | 368 |
| 11 | GERAL - Registro de Atendimento Inicial | 120 |
| 1266 | TEC-MANUT-INT-CLIN-REGULARIZACAO | 86 |
| 268 | TEC - Migração com troca de Equipamento | 27 |
| 1268 | TEC-ACESSO-CLI-RETORNO-PRIORITARIO | 13 |

### Cidades (universo manutenção, 2026)

São Leopoldo 9.342 · Canoas 5.759 · Sapucaia do Sul 4.907 · Novo Hamburgo 2.554 ·
Esteio 2.095 · Cachoeirinha 227 · Nova Santa Rita 50 · Triunfo 28 · Campo Bom 21 ·
Porto Alegre 8 · demais < 6 · 1 nulo.

→ As 6 cidades do filtro `(Região)` cobrem **~99 %** do volume.

### `region_title` na view de produtividade (bases de campo reais)

| region_title | protocolos (desde mai/2026) |
|---|---|
| ✅Base São Leopoldo (Manutenção) | 7.453 |
| ✅Base São Leopoldo (Ativação) | 6.427 |
| ✅Base Canoas (Ativação) | 5.916 |
| ✅Base Canoas (Manutenção) | 4.091 |

> Só **2 bases** físicas (São Leopoldo e Canoas), cada uma com trilha de
> Manutenção e de Ativação. O prefixo `✅` faz parte do dado.
> Isso é mais confiável que a derivação por cidade (`EQUIPES TEMPORARIAS`)
> — vale usar `region_title` como fonte primária de "Base" onde disponível.

### `categoria2` (`solicitation_service_categories` via matriz), 2026

Top: SLA - 72 HORAS 22.857 · INSTABILIDADE 21.590 · INFORMACAO 14.764 ·
Instável 8.686 · INDISPONIBILIDADE 8.665 · Serviço local (Reparo) 5.265 ·
Serviço local (Tecnologia) 2.566 · Manutenções FO 1.598 · SANITIZACAO DE CTO 1.315 ·
**Preventiva reparo 1.150**.

> ⚠️ Há **duplicação semântica com grafias diferentes**
> (`INSTABILIDADE` vs `Instável`, `Configuracão` vs `CONFIGURACAO EQUIPAMENTO`,
> `Desbloqueio de Confiança` vs `Desbloqueio de Confianca`,
> `Registro de Atendimento` vs `Registro Atendimento`).
> As listas de categorias do PBI são sensíveis a isso. Precisamos de uma tabela de
> normalização/mapeamento de categorias no novo sistema.

---

## 5. Onde vive a classificação de produtividade

Confirmado: **`erp.reports.description`** (mapeado como `relato` no PBI), HTML,
com o código no início — às vezes precedido de
`Relato por <NOME><br>--------------------<br>`.

Exemplos reais (mai–ago/2026):
```
<p>2.04 - REL - PRODUTIVA - Fechamento de Instalação de Fibra ...
<p>MAN.002 - IMPROD - REAGENDA CLI (COM VISITA)<br /><br /> ...
<p>2.015 - REL - IMPRODUTIVO - Fechamento de Instalação de Fibra ...
<p>MAN.005 - IMPROD - REAGENDA POR CHUVA (SEM VISITA) - MAN ...
Relato por ELIEL RIBEIRO MACHADO<br>--------------------<br><p>2.04 - REL - ...
```

`erp.reports.title` (mapeado como `descricao`) contém apenas rótulos genéricos
(`Atendimento solicitação`, `Field Service Management`, `Encaminhamento de
Solicitação`) — **não serve** para classificar produtividade.

**Extração em SQL** (respeitando a precedência IMPROD → PROD):
```sql
CASE
  WHEN r.description ILIKE '%IMPROD%' THEN 'Improdutiva'
  WHEN r.description ILIKE '%PROD%'   THEN 'Produtiva'
END
```
E o código em si via regex:
```sql
substring(r.description from '((?:INST|MAN|OPER)\.\d{3}|2\.0(?:4|15))[^<]*')
```

---

## 6. Validação de MTTR / MTTA

Julho/2026, encerrados, universo manutenção — **3.751 protocolos**:

| Métrica | Valor |
|---|---|
| MTTR médio (`conclusion_date − created`) | **16,59 h** |
| MTTA médio ("em play", `SUM(reports.seconds_worked)`) | **1,30 h** |
| Protocolos sem "em play" | 0 |

Os cálculos do Power BI são reproduzíveis em SQL puro sem divergência estrutural.

---

## 7. Performance — restrições observadas

| Consulta | Tempo |
|---|---|
| Agregação por mês (universo manutenção, 2026) | 0,84 s |
| Cidades (join `people`) | 0,94 s |
| `incident_types` no universo | 0,97 s |
| MTTR/MTTA julho com subquery de `reports` | 1,38 s |
| `categoria2` via matriz | 0,27 s |
| View de produtividade, agrupada | 3,6 – 4,1 s |
| `reports.description ILIKE '%IMPROD%'` (scan em texto) | **8,8 s** |
| Contagem por status com **subquery correlacionada** | **77,9 s** ❌ |

### Conclusões de arquitetura

1. É um **banco de produção do ERP de terceiro** (1.384 tabelas). O usuário
   `cliente_s` presumivelmente é somente-leitura. **Não podemos criar índices,
   views ou materialized views nele** (a confirmar — pendência P2).
2. Subqueries correlacionadas são proibitivas. Todo agregado precisa ser
   `JOIN + GROUP BY` ou CTE.
3. Busca textual em `reports.description` (8,8 s) não pode acontecer a cada
   request. **Precisa de uma camada de cache/pré-agregação nossa.**
4. Filtros de data em `assignments.created` respondem bem (< 1 s) →
   o eixo temporal deve ser sempre o primeiro predicado.

---

## 8. Cores da marca (extraídas do logo)

`logo_sebratel_2017-copiar-35024379995039714.png` — vermelho Sebratel:

| Hex | Ocorrências | Papel |
|---|---|---|
| `#C00810` | 3.194 | vermelho escuro (sombra do globo) |
| `#D80010` | 2.549 | **vermelho principal** |
| `#D80008` | 1.745 | vermelho principal (variação) |
| `#E80010` | 529 | vermelho claro (highlight) |
| `#E0E8F0` | 146 | cinza-azulado claro (malha do globo) |

Nenhuma outra cor de marca — a identidade é **vermelho + neutros**.
Isso é uma restrição relevante: vermelho é a cor de marca **e** a cor semântica de
alerta. A paleta do dashboard precisa resolver esse conflito (ver `03-plano.md` §5).
