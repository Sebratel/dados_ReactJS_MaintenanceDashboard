# Plano de implementação — Dashboard Manutenção FTTX

Status: **aguardando aprovação**. Nada de código de aplicação foi escrito ainda.
Pré-requisitos lidos: `01-regras-de-negocio-powerbi.md`, `02-schema-postgres.md`.

---

## 0. Pendências que precisam de decisão sua

Ordenadas por impacto. As três primeiras **bloqueiam parte do escopo**;
o resto tem default que eu sigo se você não disser nada.

### ✅ P1 — RESOLVIDO: credencial do MariaDB adicionada (2026-08-04)
`MARIA_*` no `.env` conecta em `10.0.11.171:3306` → MariaDB 10.11,
`DB_Applicattion`. **`Autentication_Contracts_Daily` existe e tem 145.935
registros** (85.525 clientes no snapshot de 2026-08-03, por cidade/bairro/site).
O Coeficiente de Reparos está viável exatamente como no Power BI.

Três ressalvas que entram no desenho (detalhe em `02-schema` §1.3):
- `date` é `datetime` com hora de carga → sempre `DATE(date)` no agrupamento;
- **13 dias sem snapshot** em 154 → LOCF (repetir último valor conhecido) e
  sinalizar na UI que o dia é interpolado;
- histórico começa em **2026-03-03** → sem coeficiente antes de março.

Bônus: o mesmo banco tem `Installation_Teams` com `CAPACIDADE MANHÃ`/`TARDE`
por equipe/dia — a fonte correta do gauge `AGENDA / CAPACIDADE`, hoje aproximado
por `COUNT(solicitacao)/3`. Mas está parada em 2025-07-16. **Vale a pena voltar a
alimentá-la?**

### ✅ P2 — RESOLVIDO por medição: o ERP é read-only
`CREATE SCHEMA` em `dbemp00100` retorna
`cannot execute CREATE SCHEMA in a read-only transaction`. A opção (a) está
descartada empiricamente. Sigo com **Postgres próprio em Docker** para os
agregados do Tier 2 — que também é o que eu recomendaria de todo jeito, por
isolar o ERP de produção.

Preciso saber apenas **onde isso roda**: sua máquina, um servidor interno, ou
container junto do app? Isso muda só o `docker-compose` e as variáveis `DASH_*`
(já previstas no `.env.example`).

### ✅ P3 — AUTOISP conectado. Resta só um GRANT (não bloqueante)
Resolvido: rede liberada e `sebratel_db` autentica. **As quatro conexões do
`.env` passam** (revalidado 2026-08-05). O banco é a plataforma de
observabilidade GPON, com **telemetria óptica por cliente** que o ERP não tem —
detalhe em `02-schema` §1.4 e §1.5.

Legível e já útil: `onu_statuses` (sinal atual — 749 `critical`, 1.297 `warning`),
`onu_status_changes` (4 M transições, ~100 quedas/dia), `gpon_clients` (215 k).
Ponte com o ERP pelo login PPPoE
(`gpon_clients.pppoe_username` ⇄ `erp.authentication_contracts."user"`),
**80,9 % de casamento** medido — `contract_id` é inútil (24 preenchidos de 215 k).

**Único pedido pendente ao DBA** (afeta só a profundidade da Fase 2, não a Fase 1):

```sql
GRANT SELECT ON TABLE public.optical_power_samples      TO sebratel_db;
GRANT SELECT ON TABLE public.optical_power_rollup_stats TO sebratel_db;
```

São 16 GB / 46,5 M amostras e 5,3 GB / 12,2 M linhas de histórico de potência
óptica. Sem eles temos o estado atual e as transições, mas não a **tendência de
degradação** — que é o sinal preditivo mais forte.

### 🟡 P4 — Divergência de status: não existe `'Faturado'`
A coluna `TIPOS DE STATUS` do Power BI testa `statusProtocolo IN ('Encerrado',
'Faturado')`, mas no banco **não há status `Faturado`** — o equivalente é
**`A Faturar`** (id 35, 122 ocorrências em 2026). Ou seja, hoje o Power BI está
classificando esses 122 protocolos como "Abertos" quando provavelmente deveriam
ser "Encerrados". Confirmo o comportamento atual (bug replicado) ou corrijo?
**Default: corrijo** e deixo registrado.

### 🟡 P5 — Janela de dados
O modelo atual é fixo em `created >= '2026-01-01'`. Proponho parametrizar
(`DATA_INICIO_HISTORICO`, default `2025-01-01`) para permitir comparação
ano-contra-ano. Confirma?

### 🟡 P6b — Renomear as variáveis de auth do `.env`
O `.env` tem `VITE_GOOGLE_CLIENT_ID` (prefixo do **Vite**, herdado de um projeto
anterior). O Next.js **ignora** `VITE_*`, e o Auth.js v5 procura por nomes
próprios. O par de credenciais em si **é válido** — validei contra o endpoint de
token do Google. Só o nome está errado:

| Hoje | Precisa ser | Por quê |
|---|---|---|
| `VITE_GOOGLE_CLIENT_ID` | `AUTH_GOOGLE_ID` | Auth.js v5 lê automaticamente; e o client id nem precisa ir ao browser |
| `GOOGLE_CLIENT_SECRET` | `AUTH_GOOGLE_SECRET` | idem |
| — | `AUTH_SECRET` | **ausente** — Auth.js não sobe em produção sem ele (`npx auth secret` gera) |
| `API_PORT=8790` | `PORT` | Next.js não lê `API_PORT` |

Deixei os nomes atuais intactos e documentei os corretos no `.env.example`.
Faço a renomeação no Sprint 0, junto com a configuração do Auth.js — a menos que
o `API_PORT=8790` esteja em uso por outro serviço, aí me avise.

### 🟡 P6 — Escopo de IA/preditivo
A pasta se chama `dashboard_manutencao_ia` e você confirmou interesse em
manutenção preditiva, mas o prompt de requisitos não lista nenhum indicador de
IA. Proponho: **Fase 1 = dashboard completo** (este plano), **Fase 2 = preditivo**
(detalhado em §9). Confirma essa ordem?

### ⚠️ P7 — o repositório git está na sua pasta pessoal
`git rev-parse --show-toplevel` → **`C:/Users/fabricio.machado`**, sem nenhum
commit ainda. Um `git add .` daqui staged **toda a sua pasta de usuário** —
`AppData`, `OneDrive`, `NTUSER.DAT`, `.claude.json`.

**Mitigação já aplicada:** criei `dashboard_manutencao_ia/.gitignore` cobrindo
`.env*`, `node_modules/`, `.next/`. Verificado com `git check-ignore`:
o `.env` está ignorado e o `.env.example` liberado. O risco imediato de vazar
senha por commit está fechado.

**Ainda pendente (não executo sem seu OK):** o repo continua enraizado na sua
pasta pessoal, o que é ruim para o projeto (histórico misturado, `git status`
inútil). O certo é um repositório próprio dentro de `dashboard_manutencao_ia`.
Digo os comandos quando você autorizar.

---

## 1. Stack — escolhas e justificativas

| Camada | Escolha | Por quê |
|---|---|---|
| Framework | **Next.js 15 (App Router) + React 19 + TypeScript strict** | Server Components mantêm SQL e credenciais no servidor; Route Handlers dão os endpoints JSON; um único deploy |
| Gráficos | **Apache ECharts** (`echarts-for-react`) | ver §1.1 |
| Tabelas | **TanStack Table v8** | o relatório atual tem **11 pivotTables + 8 tabelas** — isso é grid, não gráfico. Precisa de agrupamento, subtotais, expand/collapse, virtualização e export CSV |
| Acesso a dados | **`pg` (node-postgres) + Pool + SQL em módulos tipados** | ver §1.2 |
| Validação | **Zod** na fronteira dos endpoints | filtros vêm da URL; nunca interpolar em SQL |
| Estado de dados | **TanStack Query** | cache, `refetchInterval`, invalidação, dedupe de requests entre gráficos que compartilham filtro |
| Estilo | **Tailwind CSS v4** + tokens em CSS custom properties | design system em §5; a troca light/dark acontece em um lugar só |
| Auth | **Auth.js (NextAuth v5)** + Google, restrito a `@sebratel.com.br` | as credenciais já estão no `.env` |
| Testes | **Vitest** para as regras de negócio | as regras de reincidência/produtividade são a parte que erra silenciosamente — §7 |

### 1.1 Por que ECharts (e não Recharts nem Tremor)

Olhando o que o relatório atual **realmente** usa:

- **6 páginas** usam `lineStackedColumnComboChart` / `lineClusteredColumnComboChart`
  — coluna empilhada + linha no mesmo plot.
- **`MTTR Mapa de Calor`** e os pivots `MTTR_A POR DIA E TURNO` são **heatmaps**.
- Séries diárias de um ano inteiro (~365 pontos × várias séries) com necessidade de
  zoom/brush para drill-down.

| | ECharts | Recharts | Tremor |
|---|---|---|---|
| Heatmap nativo | ✅ | ❌ (não tem) | ❌ |
| Combo coluna+linha | ✅ nativo | ⚠️ manual e frágil | ⚠️ herda do Recharts |
| Renderer | Canvas (e SVG opcional) — milhares de pontos sem travar | SVG — degrada acima de ~2k nós | SVG |
| dataZoom / brush para drill | ✅ nativo | ❌ | ❌ |
| `borderRadius` por ponta de barra (spec de marca de 4px) | ✅ | parcial | parcial |
| Custo | bundle maior (~mitigável com import modular) | leve | leve |

Tremor é um wrapper fino de Recharts: herda as mesmas limitações. Os *stat tiles*
dele são bons, mas construí-los em Tailwind custa menos que a dependência.

**Decisão: ECharts para os plots, Tailwind puro para stat tiles/KPIs, TanStack
Table para as grades.** O tema default do ECharts é descartado — as cores vêm das
nossas CSS custom properties (§5), nunca do tema da lib.

### 1.2 Por que `pg` puro (e não Prisma/Drizzle)

- A carga é **100% leitura analítica** sobre um schema de ERP de terceiro que não
  é nosso: **1.384 tabelas**, com 92 a 208 colunas cada. Zero escritas, zero migrations.
- Prisma/Drizzle exigiriam introspectar 1.384 tabelas para gerar um schema que
  jamais usaríamos para escrever — overhead puro.
- Nenhum dos dois expressa `LAG() OVER (PARTITION BY …)`, `ROW_NUMBER()`,
  `FILTER (WHERE …)`, `generate_series`, CTEs múltiplas ou `DATE_TRUNC` sem cair em
  raw SQL de qualquer forma — e essas construções **são** as regras de negócio
  (§3, §5, §6 de `01-regras`).
- Então: `pg` + helper `sql` com **binding de parâmetros** (`$1, $2…`), um módulo
  por indicador, tipos de retorno declarados em TypeScript.

**Gotcha já identificada:** todos os timestamps do ERP são
`timestamp without time zone`, e o driver os interpreta no fuso local — o
`DATE_TRUNC('month', …)` voltou como `2026-01-01T03:00:00.000Z`. Precisa de
`pg.types.setTypeParser` para 1114/1082 devolvendo string/`Date` naive, e todo o
cálculo de dia/turno feito **no Postgres**, não no JS. Isso vai para o Sprint 0.

---

## 2. Arquitetura de dados — como "realtime" funciona aqui

O banco de origem é réplica de produção do ERP, somente leitura, com consultas de
0,3 s a 8,8 s. "Realtime" aqui é **latência de minutos com atualização sem
reload**, não streaming de eventos. Dois tiers:

```
┌─────────────────────────────────────────────────────────────────┐
│  erp.* (dbemp00100 · Postgres 13 · READ ONLY · 1.384 tabelas)   │
└───────────────┬─────────────────────────────┬───────────────────┘
                │ TIER 1 (rápido, <1,5s)      │ TIER 2 (pesado)
                │ query direta + cache 60s    │ job agendado
                ▼                             ▼
       ┌────────────────────┐      ┌──────────────────────────────┐
       │ Route Handlers     │      │ Postgres local `dash` (P2)   │
       │ /api/indicadores/* │◀─────│ fato_protocolo               │
       └─────────┬──────────┘      │ fato_produtividade_dia       │
                 │                 │ fato_reincidencia            │
                 │                 │ dim_categoria (normalização) │
                 │                 │ snapshot_base_clientes       │
                 │                 │ dim_feriado                  │
                 │                 └──────────────────────────────┘
                 ▼
       ┌────────────────────┐   SSE /api/stream
       │ TanStack Query     │◀──── "dataset X atualizado" → invalidate
       │ (dedupe + refetch) │
       └────────────────────┘
```

**Tier 1 — direto** (medidos < 1,5 s): volume de protocolos por dia/mês, por
cidade, por equipe, por catálogo, MTTR/MTTA/MTPA, encerrados, sem agendamento.
Cache de 60 s no servidor, `refetchInterval` de 60 s no cliente.

**Tier 2 — materializado** (o que não pode ir ao vivo):
- `fato_produtividade_dia` — a matriz protocolo × dia com `Produtivo /
  Improdutivo / Sem Ação` (§4 de `01-regras`). Exige o scan de 8,8 s em
  `reports.description`. Job a cada **5 min**.
- `fato_reincidencia` — janelas 30/60/90 d por (cliente, usuario). É `O(n²)` em
  DAX; em SQL vira window function, mas ainda é caro. Job a cada **15 min**.
- `fato_ofensores` — os 12 `LAG()` por `client_id`. Job a cada **15 min**.
- `snapshot_base_clientes` — cópia incremental de
  `DB_Applicattion.Autentication_Contracts_Daily` (MariaDB), 1×/dia. Traz o
  histórico de 2026-03-03 em diante na primeira carga. Aplica `DATE(date)` e
  LOCF nos 13 dias faltantes, marcando-os como interpolados.

**Push:** um endpoint SSE emite `{dataset, updatedAt}` quando um job termina; o
cliente invalida só as queries daquele dataset. Sem WebSocket, sem broker.

**Normalização de categorias** (§4 de `02-schema`): há duplicação com grafias
diferentes (`INSTABILIDADE` vs `Instável`, `Desbloqueio de Confiança` vs
`Confianca`, `Configuracão` vs `CONFIGURACAO EQUIPAMENTO`). As listas do Power BI
são sensíveis a isso. `dim_categoria` mapeia grafia → categoria canônica, e as
listas de negócio (preventivas, categorias técnicas de recorrência, feriados,
equipes, cidades da região) saem do SQL e vão para
**`src/config/regras-negocio.ts`** — versionado, testável, sem hardcode em query.

---

## 3. Páginas — 13 do Power BI consolidadas em 8

Consolidei onde as páginas atuais eram a mesma pergunta com filtro diferente
(reincidentes/recorrentes e as três páginas "CARTÃO", que são só tooltips).

| Rota | Nome | Substitui | Conteúdo |
|---|---|---|---|
| `/` | **Visão Executiva** | Relatório Executivo + CARTÃO(PORCENT) | KPIs de topo (protocolos entrantes, encerrados, MTTR, MTTA, assertividade, coeficiente vs meta, ativações/cancelamentos vs projeção); série de entrantes × encerrados; reparos por dia × turno |
| `/operacao` | **Operação de Campo** | Manutenção Campo + Protocolos Abertos Suporte | entrantes/encerrados por cidade, base, categoria 1–5, catálogo, solução, site, bairro; em andamento por data de abertura; sem agendamento |
| `/produtividade` | **Produtividade de Campo** | Field Manutenção + CARTÃO(Equipes) | assertividade diária (total / base / técnico); produtivo × improdutivo × sem ação; motivos de improdutividade; produção e média por técnico |
| `/tempos` | **Tempos Médios** | Geral MTTs | MTTR_E, MTTA (em play), MTPA por dia/base/bairro/catálogo/turno; heatmap dia × turno; indicadores mensais |
| `/recorrencia` | **Reincidência & Recorrência** | Clientes reincidentes + Clientes recorrentes + Indicadores Recorrência | toggle Reincidente ⇄ Recorrente; janelas 30/60/90 d; por base, cidade, bairro, catálogo; lista de clientes; reparo vigente × anterior |
| `/preventivos` | **Preventivos** | Preventivos | preventivos abertos por base/cidade/bairro/site/categoria; **qualidade da preventiva** (reincidência pós-preventiva 30/60/90 d) |
| `/ofensores` | **Ofensores** | (hoje espalhado em Clientes recorrentes) | técnicos ofensores em recorrência; equipamentos/patrimônios por idade × reincidência; CTO/site com cluster de reincidência |
| `/protocolos` | **Explorador de Protocolos** | as 4 tabelas "RELATÓRIO DETALHADO" | grid completo, todos os filtros, ordenação, colunas configuráveis, export CSV/XLSX |

### Barra de filtros global (persistente entre páginas, na URL)

Uma linha acima do conteúdo, estado em query string (compartilhável por link):

```
[ Período: presets + custom ] [ Eixo da data: Criação | Encerramento | Agenda ]
[ Cidade ▾ ] [ Base ▾ ] [ Equipe ▾ ] [ Técnico ▾ ] [ Catálogo ▾ ]
[ Tipo de Protocolo ▾ ] [ Status ▾ ] [ Categoria 1–5 ▾ ]     [ Limpar ]
```

**"Eixo da data" é um filtro de primeira classe** — no Power BI isso está
escondido em `USERELATIONSHIP` dentro de cada medida, e é a causa mais comum de
número divergente entre páginas. Aqui fica explícito na tela.

Drill-down: clique em barra/célula acrescenta o filtro correspondente (breadcrumb
mostra a pilha, clicável para voltar). Sem reload — só invalidação de query.

---

## 4. Endpoints e queries

`GET /api/indicadores/<slug>?<filtros>` — todos aceitam o mesmo objeto de filtro
(validado por um único Zod schema `FiltrosDashboard`) e devolvem
`{ data, meta: { updatedAt, tier, ms } }`.

| Slug | Tier | Origem | Métricas |
|---|---|---|---|
| `kpis-executivos` | 1 | `erp` | entrantes, encerrados, MTTR, MTTA, assertividade, coeficiente, % crescimento MoM |
| `protocolos-serie` | 1 | `erp` | série por dia/semana/mês, eixo de data configurável |
| `protocolos-dimensao` | 1 | `erp` | agregado por cidade/bairro/site/base/equipe/técnico/catálogo/tipo/status/categoria N |
| `tempos-medios` | 1 | `erp` | MTTR/MTTA/MTPA — média, p50, p90, por dimensão e por turno |
| `tempos-heatmap` | 1 | `erp` | dia da semana × turno |
| `sem-agendamento` | 1 | `erp` | abertos sem `dataHoraUltimaAgenda` |
| `ativacoes-cancelamentos` | 1 | `erp` | mês corrente + projeção (dias produtivos de `dim_feriado`) |
| `produtividade-dia` | 2 | `dash.fato_produtividade_dia` | produtivo/improdutivo/sem ação, assertividade, visitas |
| `produtividade-tecnico` | 2 | `dash.fato_produtividade_dia` | produção, média/dia, assertividade por técnico |
| `motivos-improdutividade` | 2 | `dash.fato_produtividade_dia` | ranking dos códigos `INST.*`/`MAN.*`/`OPER.*` |
| `reincidencia` | 2 | `dash.fato_reincidencia` | reincidentes 30/60/90 d + % sobre total de clientes |
| `recorrencia` | 2 | `dash.fato_reincidencia` | recorrentes 30/60/90 d (regra cumulativa + filtro de categoria técnica) |
| `preventivos-qualidade` | 2 | `dash.fato_reincidencia` | preventivos abertos, reincidência pós-preventiva 30/60/90 d, % |
| `ofensores-tecnicos` | 2 | `dash.fato_ofensores` | técnico anterior × recorrência atual |
| `ofensores-equipamento` | 2 | `dash.fato_ofensores` | idade do patrimônio × reincidência |
| `coeficiente-base` | 2 | `dash.snapshot_base_clientes` (← MariaDB) | reparos ÷ base, por cidade/bairro/site, vs meta; LOCF nos 13 dias sem snapshot |
| `protocolos-detalhe` | 1 | `erp` | grid paginado + export |
| `GET /api/stream` | — | SSE | `{dataset, updatedAt}` a cada fim de job |

Cada indicador vira um módulo em `src/server/indicadores/<slug>.ts` exportando
`{ querySQL, params, parse, tipo }` — testável isoladamente sem subir o Next.

---

## 5. Design system

### 5.1 Cores — o conflito da marca, resolvido

A identidade da Sebratel é **vermelho + neutros** (`#D80010` extraído do logo;
nenhuma outra cor de marca). Isso é um problema real: vermelho é a cor da marca
**e** a cor semântica de "crítico/ruim". Se vermelho for também "série 4", o
leitor não sabe se a cor significa *Sebratel*, *alerta* ou *só uma categoria*.

**Resolução:**
- **Vermelho de marca = apenas chrome.** Barra de topo, logo, navegação ativa,
  botão primário, anel de foco. Nunca uma série de dados.
  Contrastes medidos: branco sobre `#D80010` = **5,35:1** (AA); `#D80010` sobre
  superfície clara = **5,21:1**; em dark mode o accent clareia para `#E84A52` = **4,59:1**.
- **Séries categóricas = paleta validada de 7 slots**, com o vermelho
  **fora da rotação** — assim nenhuma série pode se passar por marca ou por status.
- **Status permanece fixo e reservado.**

### 5.2 Paleta categórica (7 slots, ordem fixa, nunca ciclada)

| Slot | Hue | Light | Dark |
|---|---|---|---|
| 1 | azul | `#2a78d6` | `#3987e5` |
| 2 | laranja | `#eb6834` | `#d95926` |
| 3 | aqua | `#1baf7a` | `#199e70` |
| 4 | amarelo | `#eda100` | `#c98500` |
| 5 | magenta | `#e87ba4` | `#d55181` |
| 6 | verde | `#008300` | `#008300` |
| 7 | violeta | `#4a3aa7` | `#9085e9` |

**Validado com `scripts/validate_palette.js`** (não estimado):

```
light (superfície #fcfcfb) → TODOS OS CHECKS PASSAM
  banda de luminosidade  PASS  · piso de croma  PASS
  separação CVD          PASS  pior par adjacente #eda100↔#1baf7a ΔE 9.1 (protan)
  piso visão normal      PASS  pior par adjacente #e87ba4↔#eda100 ΔE 19.6
  contraste vs superfície WARN  #1baf7a 2,74 · #eda100 2,11 · #e87ba4 2,62

dark (superfície #1a1a19) → TODOS OS CHECKS PASSAM
  separação CVD          PASS  pior par #c98500↔#199e70 ΔE 8.4 (protan)
  piso visão normal      PASS  ΔE 19.3
  contraste vs superfície PASS  todos ≥ 3:1
```

O `WARN` de contraste em light **não é dispensável**: obriga rótulo direto visível
ou visão de tabela nos gráficos que usam os slots 3, 4 ou 5 — está incorporado
como regra de componente.

**Limite de séries:** gráficos de dispersão / bolha / mapa / small multiples usam
o pairlist `all-pairs`, que é mais duro. Validado: **os 3 primeiros slots passam
all-pairs nos dois modos** (pior par CVD ΔE 9,2 light / 9,4 dark; visão normal
24,0 / 20,9). Acima de 3 séries nessas formas → agrupar em "Outros" ou facetar.
Nunca gerar uma 8ª cor.

### 5.3 Cores por trabalho (não por gosto)

| Dado | Trabalho | Codificação |
|---|---|---|
| **Produtivo / Improdutivo / Sem Ação** | **status** (significa bom/ruim) | good `#0ca30c` / critical `#d03b3b` / warning `#fab219` — sempre com **ícone + rótulo**, nunca cor sozinha |
| Reincidente/Recorrente **30 → 60 → 90 d** | **ordinal** (janelas ordenadas) | rampa azul de um hue. Light `#86b6ef → #2a78d6 → #184f95`; dark `#cde2fb → #3987e5 → #184f95`. **Validado `--ordinal`: PASS** nos dois modos (L monótona, ΔL ≥ 0,06, ponta clara 2,06:1 light / 2,15:1 dark) |
| MTTR no heatmap dia × turno | **sequencial** (magnitude) | um hue azul, steps 100→700 |
| Coeficiente **vs meta** | **divergente** (polaridade) | azul ↔ vermelho com **cinza neutro no meio** (light `#f0efec`, dark `#383835`) |
| Cidade / base / equipe / catálogo | **nominal categórico** | uma série → todas as barras no slot 1; N séries → slots 1..N |
| MTTR ou entrantes ao longo do tempo (série única) | — | slot 1, **sem legenda** (o título nomeia a série) |

Regra que **não** vou quebrar: nunca colorir barras nominais pelo próprio valor —
isso gasta o canal de identidade re-codificando o que o comprimento da barra já mostra.

**Nunca eixo duplo.** O relatório atual tem 6 combos linha+coluna com duas escalas
(`lineStackedColumnComboChart`). Isso é o erro nº 1 de gráfico. Cada caso vai para:
dois gráficos empilhados verticalmente compartilhando o eixo X, ou indexação a uma
base comum. Vou apontar caso por caso na revisão.

### 5.4 Chrome, tipografia, marcas

| Papel | Light | Dark |
|---|---|---|
| Superfície do gráfico | `#fcfcfb` | `#1a1a19` |
| Plano da página | `#f9f9f7` | `#0d0d0d` |
| Tinta primária | `#0b0b0b` | `#ffffff` |
| Tinta secundária | `#52514e` | `#c3c2b7` |
| Muted (eixo/rótulo) | `#898781` | `#898781` |
| Gridline (fio de cabelo) | `#e1e0d9` | `#2c2c2a` |
| Linha de base / eixo | `#c3c2b7` | `#383835` |
| Delta ↑ bom | `#006300` | `#0ca30c` |
| **Accent de marca** | `#D80010` | `#E84A52` |

- Tipografia: `system-ui, -apple-system, "Segoe UI", sans-serif`. Sem fonte display.
  `tabular-nums` **só** em colunas de tabela e ticks de eixo.
- Marcas: barras finas, **ponta de dado arredondada 4px** ancorada na base,
  linhas 2px, marcadores ≥ 8px, **vão de 2px na cor da superfície** entre
  segmentos empilhados e entre barras adjacentes, anel de 2px em marcas sobrepostas.
- Rótulos diretos **seletivos** (extremos e último ponto) — nunca número em todo ponto.
- Grid e eixos recessivos.
- Texto sempre em token de tinta, **nunca na cor da série**.

### 5.5 Interação e acessibilidade

- **Hover por padrão**: crosshair + tooltip em linha/área; tooltip por marca em
  barra/ponto/célula. Alvo de clique maior que a marca.
- Legenda presente sempre que houver ≥ 2 séries; ≤ 4 séries também recebem rótulo
  direto → identidade nunca depende só de cor.
- **Visão de tabela** disponível em todo gráfico (também resolve o WARN de contraste).
- Dark mode é **escolhido**, não inversão automática — steps próprios validados
  contra a superfície escura.
- Textura (hachura 45°/135°) disponível para daltonismo/impressão/`forced-colors`.
- Responsivo: desktop e **tablet** (uso em campo). Gráficos com
  `overflow-x: auto` próprio; o body nunca rola na horizontal.

---

## 6. Estrutura de pastas

```
dashboard_manutencao_ia/
├── .env                          # NUNCA commitado
├── .env.example                  # nomes das variáveis, sem valores
├── docs/
│   ├── 01-regras-de-negocio-powerbi.md
│   ├── 02-schema-postgres.md
│   └── 03-plano.md
├── scripts/
│   ├── db/                       # introspecção (probe/deep/validate) — já existe
│   └── jobs/                     # refresh dos fatos do Tier 2
├── src/
│   ├── app/
│   │   ├── layout.tsx            # shell + barra de filtros + tema
│   │   ├── page.tsx              # / Visão Executiva
│   │   ├── operacao/page.tsx
│   │   ├── produtividade/page.tsx
│   │   ├── tempos/page.tsx
│   │   ├── recorrencia/page.tsx
│   │   ├── preventivos/page.tsx
│   │   ├── ofensores/page.tsx
│   │   ├── protocolos/page.tsx
│   │   └── api/
│   │       ├── indicadores/[slug]/route.ts
│   │       ├── stream/route.ts               # SSE
│   │       └── auth/[...nextauth]/route.ts
│   ├── server/
│   │   ├── db/
│   │   │   ├── erp.ts            # Pool do dbemp00100 (read-only, schema erp)
│   │   │   ├── maria.ts          # Pool do DB_Applicattion (base diária de clientes)
│   │   │   ├── dash.ts           # Pool do Postgres de agregados
│   │   │   └── tipos.ts          # setTypeParser (timestamps naive, int8→number)
│   │   ├── indicadores/          # um módulo por slug de §4
│   │   ├── regras/               # produtividade, reincidencia, recorrencia,
│   │   │                         # preventiva, ofensores, projecao
│   │   └── cache.ts
│   ├── config/
│   │   ├── regras-negocio.ts     # equipes, catálogos, categorias preventivas,
│   │   │                         # cidades da região, metas de coeficiente
│   │   ├── feriados.ts
│   │   └── categorias-normalizadas.ts
│   ├── components/
│   │   ├── charts/               # wrappers ECharts por forma
│   │   ├── kpi/                  # stat tiles, hero number, delta
│   │   ├── tabela/               # TanStack Table + pivot + export
│   │   └── filtros/              # barra global + breadcrumb de drill
│   ├── lib/
│   │   ├── filtros.ts            # Zod FiltrosDashboard + URL ⇄ objeto
│   │   ├── formato.ts            # HH:MM:SS, %, milhar pt-BR
│   │   └── tema.ts               # tokens → variáveis ECharts
│   └── styles/tokens.css         # §5 em CSS custom properties
└── tests/
    └── regras/                   # Vitest: os casos de §7
```

---

## 7. Testes das regras de negócio (não negociável)

As regras que **erram em silêncio** — número plausível, mas errado:

1. **Precedência IMPROD → PROD.** `"IMPRODUTIVO"` contém `"PROD"`. Se a ordem
   inverter, todo improdutivo vira produtivo e a assertividade sobe. Teste com os
   códigos reais dos dois casos (`2.015 - REL - IMPRODUTIVO` e `2.04 - REL - PRODUTIVA`).
2. **Reincidente ≠ Recorrente.** Reincidente = voltou em **alguma** janela;
   recorrente = voltou em **todas** as janelas consecutivas. Fixtures com um
   cliente que satisfaz uma e não a outra.
3. **"Mais recente do mês" por (cliente, usuario).** Só esse protocolo classifica;
   os outros ficam nulos. Sem isso o total de reincidentes infla.
4. **Fronteiras das janelas.** `> D−30 AND < D` para 30 d, mas
   `> D−60 AND <= D−30` para 60 d. Testes de borda exatamente em 30 e 60 dias.
5. **`Sem Ação` = `EXCEPT(Agendados, Produtivos ∪ Improdutivos)`.**
6. **`Qtd Visitas Improd` conta datas distintas de relato**, não relatos.
7. **Dias produtivos:** domingo 0, sábado 0,5, feriado 0.
8. **Eixo de data:** o mesmo filtro em "criação" vs "encerramento" deve dar
   números diferentes — e cada um consistente entre páginas.

---

## 8. Roadmap

| Sprint | Entrega |
|---|---|
| **0** — Fundação | Next.js + TS + Tailwind + tokens de §5; pools `pg` (ERP + dash) e `mysql2` (MariaDB) com `setTypeParser`; Zod `FiltrosDashboard`; renomear vars de auth (P6b) + Auth.js Google restrito ao domínio; repo próprio (P7); shell com barra de filtros e dark mode |
| **1** — Tier 1 + Executivo | módulos de indicadores Tier 1; `/` Visão Executiva; `/tempos`; `/protocolos` (grid + export); wrappers ECharts; **carga inicial do histórico da base de clientes (mar/2026 →) do MariaDB** |
| **2** — Tier 2 + Campo | Postgres `dash` + jobs + SSE; `fato_produtividade_dia`; `/produtividade`; `/operacao`; testes de §7 (1, 5, 6) |
| **3** — Recorrência | `fato_reincidencia` + `fato_ofensores`; `/recorrencia`; `/preventivos`; `/ofensores`; testes de §7 (2, 3, 4) |
| **4** — Acabamento | drill-down completo, visão de tabela em todo gráfico, textura de acessibilidade, responsivo tablet, conferência número-a-número contra o Power BI |

**Conferência de paridade** (fim do Sprint 4): planilha comparando cada indicador
Power BI × novo sistema, por mês de 2026, com tolerância declarada e justificativa
para cada divergência (incluindo as intencionais — P4, feriado 03/04, bug do
`% Reincidentes Prev60/90`).

---

## 9. Fase 2 — preditivo (fora deste plano, para confirmar em P6)

**Atualização 2026-08-05:** com o AUTOISP acessível, a Fase 2 deixou de ser
hipótese. A telemetria óptica por cliente existe, tem histórico, e liga ao ERP
pelo login PPPoE com 80,9 % de casamento medido. O número que fecha o caso:

> **2.046 clientes estão com sinal óptico `critical`/`warning` agora. Apenas 31 %
> já abriram protocolo. Sobram 1.411 clientes com degradação detectada e nenhum
> atendimento em curso.**

Isso é uma fila de preventiva pronta, derivável hoje com `onu_statuses` +
`gpon_clients` + `erp.authentication_contracts` — **sem modelo nenhum**, só
regra. O modelo entra depois, para ordenar essa fila por probabilidade de falha
e evitar visita desnecessária.

Os três modelos abaixo seguem válidos. Registro para o desenho da Fase 1 não
fechar portas:

1. **Risco de reincidência em 30 d** (classificação por protocolo encerrado).
   Features do ERP: histórico de protocolos do cliente, `categoria1..5`, técnico
   responsável, solução aplicada, idade do patrimônio
   (`Data Criado − DATA PRIMEIRA ALOCAÇÃO`), CTO/slot/porta, site, cidade/bairro,
   MTTR do atendimento, turno.
   **Features do AUTOISP (as mais fortes):** `calculated_rx_power` e sua
   tendência, `calculated_status`/`_trigger`, contagem de transições em
   `onu_status_changes` na janela, `last_off`/`last_off_trigger`,
   `ponlink_alarm_status`, `olt_alarm_status`, `onu_model`, `power_threshold`.
   → prioriza preventiva antes do cliente reclamar.
2. **Risco de visita improdutiva** (classificação por slot de agenda, antes da
   visita). Features: tipo de protocolo, turno, técnico, base, histórico de
   reagendamento do cliente, `rescheduling_type` e `routing_status` da view de
   produtividade, clima. → permite reordenar a agenda do dia.
3. **Detecção de CTO/site/PON ofensor** (anomalia agregada). Cluster de
   reincidência acima do esperado dado o número de clientes atendidos. Com o
   AUTOISP isso fica muito mais preciso: agrupar por `olt_id` + `ponlink` (a
   árvore óptica real) em vez de por `ChaveLocal` (cidade|bairro|site, que é
   geografia aproximada). → aponta problema de infraestrutura, não de cliente.
   ⚠️ `ctos` está **vazia** no AUTOISP — se a importação voltar, dá para descer
   até a caixa.

O que a Fase 1 precisa deixar pronto: `fato_protocolo` com as features acima já
materializadas e historiadas — o que o desenho do Tier 2 (§2) naturalmente
produz — mais um `dim_cliente_pppoe` que resolve a ponte
PPPoE ⇄ contrato ⇄ `gpon_client_id` uma única vez.
