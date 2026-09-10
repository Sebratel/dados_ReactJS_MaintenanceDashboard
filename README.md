# Dashboard Manutenção FTTX · Sebratel

Substitui o relatório Power BI `MAN - Relatório Manutenção FTTX` por uma aplicação
web própria, com gráficos dinâmicos sobre os dados ao vivo do ERP.

## Rodar

**Uso diário:** duplo-clique em `Dashboard Manutencao FTTX` na área de trabalho.
O atalho sobe o servidor, **espera ele responder** e só então abre o navegador —
sem isso a página abre antes da hora e dá `ERR_CONNECTION_REFUSED`, que parece
projeto quebrado e é só pressa. Clicar duas vezes não duplica nada: se o servidor
já estiver no ar, ele apenas abre o navegador.

O servidor roda **em segundo plano, sem janela**. Para desligar e liberar a
memória, duplo-clique em `Desligar Dashboard`.

⚠️ A primeira versão abria o servidor numa janela de console visível, para deixar
os logs à mão. Foi um erro: aquela janela era **um botão de desligar disfarçado de
log**. Uma janela preta cheia de texto técnico convida a ser fechada, e fechá-la
derrubava o dashboard. O acesso foi perdido duas vezes assim, e nas duas o sintoma
foi `ERR_CONNECTION_REFUSED` — que não se parece em nada com "fechei uma janela".
**Não volte a abrir o servidor em janela visível** sem resolver esse problema.

Os logs vão para `dev-server.log`, na raiz. Se o servidor não subir, o próprio
atalho mostra as últimas linhas do log na tela — sem janela visível, o log é a
única fonte do erro real.

O servidor **não sobrevive a reiniciar a máquina** — é um processo comum, não um
serviço do Windows. Depois de todo boot, duplo-clique de novo.

**Pela linha de comando:**

```bash
npm install
npm run dev        # http://localhost:3000
```

Requer `.env` na raiz (ver `.env.example`). O MariaDB está em IP privado —
**exige rede corporativa ou VPN**.

## Backup

O projeto tem git próprio, e `onedrive` é o remoto: um repositório vazio em
`OneDrive/repos/dashboard-manutencao-fttx.git`, que o OneDrive sincroniza para a
nuvem da Sebratel.

**Uso diário:** duplo-clique em `Salvar Backup do Dashboard` na área de trabalho,
ao terminar de mexer no projeto. Ele grava o estado e envia a cópia.

```bash
git push onedrive HEAD    # o equivalente manual
```

⚠️ **O `.env` não vai no backup, de propósito** — senha de banco não sobe para a
nuvem. Se a máquina morrer, o código volta inteiro e o `.env` é recriado a partir
do `.env.example`. Por isso o `.env.example` precisa continuar listando **todas**
as variáveis: ele é a receita de recuperação, não só documentação.

O script confere, a cada backup, se o `.env` continua ignorado pelo git, e
**cancela o envio** se não estiver. Um `.gitignore` editado por engano só
apareceria nesse momento.

O dashboard pede usuário e senha (`DASH_USUARIO` / `DASH_SENHA` no `.env`).
Sem essas duas variáveis ele responde 503 e não abre — falha fechada de
propósito, para que erro de configuração não vire exposição silenciosa.

```bash
npm run verify     # valida o build SEM derrubar o dev server (saída em .next-verify/)
npm run build      # build de produção (grava em .next — ver aviso abaixo)
npm run typecheck  # tsc --noEmit
```

⚠️ **Não rode `npm run build` com o dev server no ar.** Os dois gravam no mesmo
`.next`, e o build troca os artefatos de desenvolvimento pelos de produção: a
página passa a abrir **em HTML puro, sem CSS**, com todos os assets em 404. O
sintoma não parece com a causa — aconteceu duas vezes aqui. Use `npm run verify`,
que escreve em `.next-verify/`. Se acontecer: pare o servidor, `rm -rf .next`,
`npm run dev`.

## Documentação

| Arquivo | Conteúdo |
|---|---|
| [docs/01-regras-de-negocio-powerbi.md](docs/01-regras-de-negocio-powerbi.md) | Especificação funcional extraída do PBIP/TMDL: universo de manutenção, MTTR/MTTA/MTPA, produtividade de campo, reincidência × recorrência, preventivos, ofensores, projeções |
| [docs/02-schema-postgres.md](docs/02-schema-postgres.md) | Levantamento dos 3 bancos, volumetria, domínios de valores, performance medida |
| [docs/03-plano.md](docs/03-plano.md) | Plano completo, escolhas de stack justificadas, pendências, roadmap |
| [docs/04-mudancas-de-criterio.md](docs/04-mudancas-de-criterio.md) | **Toda divergência de critério vs o Power BI**, com impacto medido e como reverter item por item |
| [docs/05-pontos-de-auditoria.md](docs/05-pontos-de-auditoria.md) | Pontos levantados na auditoria (P1, P2, …): o que foi pedido, decidido e o que ficou pendente |
| [docs/06-ajustes-pendentes.md](docs/06-ajustes-pendentes.md) | **A fila de ajustes que MUDAM NÚMERO**, com o "de → para" de cada um. Leia antes de investigar um valor que mudou |

## Fontes de dados

| Alias | Banco | Uso |
|---|---|---|
| `DB_ELLEVEN` | Postgres 13 · `dbemp00100` schema `erp` (1.384 tabelas) | ERP Voalle — protocolos, tempos, agenda. **Somente leitura.** |
| `MARIA` | MariaDB 10.11 · `DB_Applicattion` | Base diária de clientes (denominador do coeficiente de reparos) |
| `DB_AUTOISP` | Postgres 12 · `postgres` (53 GB) | Telemetria óptica GPON — reservado para a Fase 2 (preditivo) |

## Estrutura

```
src/
├── app/                    rotas (wrapper server + Conteudo client) e /api/indicadores/[slug]
├── server/
│   ├── db/                 pools pg e mysql2, type parsers de timestamp
│   └── indicadores/        um módulo por indicador; base.ts tem o FROM composável
├── config/regras-negocio.ts  equipes, catálogos, categorias preventivas, metas, feriados
├── components/
│   ├── charts/             wrappers ECharts (Chart, SerieTemporal, RankingBarras, Heatmap…)
│   ├── kpi/StatTile.tsx
│   ├── filtros/            barra global com estado na URL
│   └── Painel.tsx          card com toggle gráfico ⇄ tabela
└── lib/                    filtros (Zod), formato pt-BR, tema (tokens → ECharts)
```

## Páginas

| Rota | Página do Power BI equivalente | Estado |
|---|---|---|
| `/` | Relatório Executivo | ✅ |
| `/operacao` | Manutenção Campo + Protocolos Abertos Suporte | ✅ |
| `/tempos` | Geral MTTs | ✅ |
| `/produtividade` | FIELD MANUTENÇÃO | ✅ |
| `/recorrencia` | Clientes recorrentes + Indicadores Recorrência + Clientes reincidentes | ✅ |
| `/preventivos` | Preventivos (qualidade da ação preventiva) | ✅ |
| `/ofensores` | Ofensores (reparo atual × anterior, técnicos ofensores) | ✅ |
| `/protocolos` | Indicadores Manutenção (grid detalhado + export) | ✅ |

`/protocolos` é o **relatório analítico**: um protocolo por linha, 38 colunas,
mesmos filtros globais e mesmo universo SQL das demais telas. Existe para
auditar — exporta CSV com todas as linhas do recorte e com o rodapé de filtros
aplicados, para comparar direto com o export do Voalle. Ver
[docs/05 · P1 nível 2](docs/05-pontos-de-auditoria.md).

⚠️ O universo do dashboard é **maior** que o do export padrão do Voalle (3.764
contra 2.361 em julho/2026): aquele exclui preventivas e requisições, este as
inclui porque Preventivos e Ofensores dependem delas. A tabela com a origem de
cada diferença está no docs/05.

## Atualização dos dados

Cabeçalho tem **botão *Atualizar*** e a **idade do dado** ("há X min"). O botão
consulta o banco ignorando o cache, e **atualiza para todos** — grava no cache
compartilhado do servidor.

Não há real-time automático, por decisão medida: o ERP é réplica compartilhada e
somente leitura, e duas consultas pesadas colidindo degradam uma da outra em 8×
(MTTA de 1,7 s para 14 s). O polling de fundo é longo (5–30 min conforme o
indicador) e serve só de rede de segurança. Racional completo e medições em
[docs/04](docs/04-mudancas-de-criterio.md) §15.

## Cache — o substituto do refresh do Power BI

O relatório antigo não consulta o ERP quando você abre uma página: consulta no
*refresh* e guarda o resultado no modelo. Ou seja, **o Power BI já é uma camada de
materialização** — só está escondida dentro do `.pbix`.

`src/server/cache.ts` cumpre esse papel sem infraestrutura nova: TTL por
indicador, **single-flight** (dez abas simultâneas = uma execução, não dez) e
**stale-while-revalidate** (passado o TTL devolve o valor velho na hora e atualiza
atrás). Só a primeiríssima requisição de cada recorte espera.

É memória do processo: reiniciar esvazia, e em desenvolvimento uma mudança de
regra só aparece depois do TTL ou de um restart. Persistir exigiria o Postgres de
agregados de `docs/03-plano.md` §2.

## Acesso

**Trocou a senha? Reinicie o servidor.** O Next recarrega o `.env` para a
aplicação (escreve `Reload env: .env` no log), mas o middleware vive num bundle
compilado separado e mantém o valor antigo até o processo reiniciar — a senha nova
responde 401 e parece erro de digitação.

`src/middleware.ts` protege **tudo**, inclusive `/api/indicadores/*` — trancar a
página e deixar o endpoint aberto não protegeria nada. Autenticação HTTP Basic com
credencial compartilhada: barra quem não deve ver, mas **não identifica quem viu**
e não permite revogar o acesso de uma pessoa sem trocar a senha de todos. Quando
identidade por pessoa passar a importar, o caminho é Auth.js com Google restrito a
`@sebratel.com.br` (as credenciais já estão no `.env`, só precisam ser renomeadas).

## Decisões que não devem ser revertidas sem ler o porquê

- **`erp.schedules` NÃO é a fonte de agenda.** Foi abandonada (3.449 linhas em
  2026 contra 145.182 em 2024). A agenda vem da view
  `v_service_desk_slots_productivity_informative`. Detalhe em
  `src/server/indicadores/base.ts`.
- **O FROM é composável.** Carregar o LATERAL da agenda e as tabelas de
  categoria em toda consulta fazia a série levar 2,5 s onde 0,4 s bastava.
- **O painel de fluxo usa dois eixos de data** (criados por criação, encerrados
  por encerramento) — com eixo único as duas linhas se sobrepõem em 99,7%.
- **Nunca eixo duplo em gráfico.** Métricas de unidades diferentes vão para
  gráficos separados compartilhando o eixo X.
- **Vermelho da marca (`#D80010`) só no chrome**, nunca como série de dados —
  senão colide com o vermelho semântico de "crítico". Paleta categórica de 7
  slots validada com o script do guia de dataviz.
- **Timestamps do ERP são `timestamp without time zone`** e chegam como string
  crua. Todo cálculo de dia/mês/turno acontece no Postgres, nunca no JS.
- **Visita improdutiva é contador INDEPENDENTE, não um status excludente.** Um
  protocolo que perdeu a visita da manhã e fechou à tarde conta 1 produtivo E 1
  improdutiva — foram duas idas a campo. Por isso
  `Total Visitas = Produtivo + Improdutivas + Sem Ação` é MAIOR que o número de
  pares protocolo×dia. Tratar como excludente dava 231 improdutivas onde o Power
  BI mostra 340.
- **`base` é filtro global e vive na AGENDA, não no protocolo.** São Leopoldo e
  Canoas são supervisões diferentes e cada uma acompanha o próprio resultado.
  Vem de `region_title` da view de field service. Consequência técnica: filtrar
  por base EXIGE o LATERAL da agenda no FROM — `partesNecessarias()` liga isso
  automaticamente quando `f.base` está preenchido, senão a query quebra em tempo
  de execução. Em `recorrencia.ts` e `preventivos.ts` o join entra condicional.
- **Ofensores traz SEMPRE o denominador.** O Power BI ranqueia técnicos ofensores
  só pelo número de retornos, o que coloca no topo quem atende mais. Medido:
  NICOLAS lidera com 56 retornos e taxa de 8,7%; CARLOS EDUARDO tem 43 retornos e
  taxa de 5,6% porque atende 764 protocolos. Sem o denominador o ranking acusa
  volume, não qualidade. A tela alterna entre as duas ordenações.
- **Ofensores: preventiva não entra em nenhuma das pontas.** Nem como reparo
  atual nem como anterior — preventiva é ação nossa, e reparo depois dela é
  qualidade da preventiva (página Preventivos), não ofensa de quem executou.
- **Preventivos: a taxa de falha usa só preventivas “maduras”** (com 90 dias
  completos de observação). Incluir as recentes faria o indicador parecer melhor
  quanto mais recente o recorte, porque preventiva de ontem não teve tempo de
  falhar. As recentes ficam em "Em observação", visíveis e fora da conta.
- **A dupla é creditada pela perna `RAUX`, ligada por `reports.tags`.** O
  auxiliar fica numa `assignment` separada com `assignment_type = 'RAUX'` e é o
  autor do relato dela (`reports.person_id`).
  ⚠️ **NÃO usar `corresponding_parent_id`** para achar o pai: o join
  `assignments.id = raux.corresponding_parent_id` devolve **zero** linhas (aponta
  para outro espaço de ids). O vínculo é o **número do protocolo em
  `reports.tags`**, 100% numérico nas pernas RAUX.
  Descartados antes, com medição: `resource_name` da view (um recurso em 1.108
  protocolos = 37/dia, pico 66, contra ~8 plausíveis — papéis de coordenação) e
  `reports.person_id` do protocolo pai (maiores autores são backoffice e
  sistemas). Existe também uma pessoa "SEM AUXILIAR" que é placeholder e está em
  `AUXILIARES_PLACEHOLDER`.
- **A recorrência é por INSTALAÇÃO (login PPPoE), não por cliente.** Caminho:
  `assignment_incidents.contract_service_tag_id` →
  `authentication_contracts.service_tag_id` → `.user`. Resolve 98,9% dos
  protocolos para exatamente 1 login. **Não trocar por `contract_id`**: um
  contrato agrega várias instalações, e um cliente corporativo com 55 pontos
  viraria "cronicamente recorrente" sendo que cada ponto teve um chamado só.
  (`nn_authentication_contract_info`, que o nome sugere ser a ponte, é 100% NULL.)
- **Produtividade tem DUAS visões separadas na tela.** "Visão da empresa ·
  visitas" (protocolo × dia) é o total da operação e o único número somável;
  "Visão do técnico · produção individual" traz o total de CADA técnico. Quando a
  dupla passar a ser creditada, não pode existir total geral na segunda visão:
  2.789 de 3.974 visitas são em dupla, então somar os técnicos daria quase o
  dobro das atividades reais.
- **A regra de universo usa `equipe OR catálogo` porque houve uma virada em
  maio/2025.** Antes disso só a equipe identificava manutenção; depois, só o
  catálogo. Tirar uma das condições zera metade do histórico.
- **A recorrência usa window function com frame `RANGE`, não join.** A versão com
  `base JOIN universo` levava 11,7 s porque o planejador estimava o CTE com
  `row_number()` em 1 linha, escolhia Nested Loop e re-executava o agregado 6.139
  vezes. Hoje roda em ~850 ms com resultado idêntico, em qualquer tamanho de
  janela. Se for reescrever, rode `scripts/db/explain.mjs` antes e depois.

## Scripts de diagnóstico

```bash
node scripts/db/probe.mjs           # alcance e inventário dos bancos
node scripts/db/deep.mjs            # colunas e volumetria do schema erp
node scripts/db/validate.mjs        # valida as regras de negócio contra o banco
node scripts/db/bench.mjs           # performance do SQL do universo
node scripts/db/explain.mjs <ind>   # EXPLAIN ANALYZE do SQL real de um indicador
node scripts/db/q.mjs "<sql>"       # consulta ad-hoc no ERP (a ferramenta da auditoria)
node scripts/shot.mjs <url> <png>   # captura a página renderizada (CDP, sem Playwright)
```

`explain.mjs` extrai o SQL direto do módulo em vez de transcrevê-lo — foi o que
localizou a regressão de plano da recorrência em uma rodada, depois de dois
palpites errados.
