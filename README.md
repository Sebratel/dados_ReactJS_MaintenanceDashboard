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

O dashboard entra com **conta Google da Sebratel** (ver [Acesso](#acesso)). Sem
`FIREBASE_PROJECT_ID` e `ALLOWED_DOMAIN` ele responde 503 e não abre — falha
fechada de propósito, para que erro de configuração não vire exposição
silenciosa.

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
├── middleware.ts           o ÚNICO portão: verifica a sessão em toda rota
├── app/
│   ├── (dashboard)/        as 8 telas + a moldura (cabeçalho e filtros).
│   │                       O grupo entre parênteses não aparece na URL; ele
│   │                       existe para o login NÃO herdar a moldura.
│   ├── login/              tela de entrada (SSO Google)
│   └── api/                indicadores/[slug], protocolos, auth/sessao, health
├── server/
│   ├── auth/               ID token (Web Crypto), cookie, acesso e guardas
│   ├── ia/                 provedores, cifra da chave e o insight dos painéis
│   ├── armazenamento.ts    os JSON de configuração (acesso, IA) no volume
│   ├── db/                 pools pg e mysql2, type parsers de timestamp
│   └── indicadores/        um módulo por indicador; base.ts tem o FROM composável
├── config/
│   ├── regras-negocio.ts   equipes, catálogos, categorias preventivas, metas
│   └── telas.ts            catálogo das telas — o contrato de autorização
├── components/
│   ├── charts/             wrappers ECharts (Chart, SerieTemporal, RankingBarras, Heatmap…)
│   ├── kpi/StatTile.tsx
│   ├── filtros/            barra global com estado na URL
│   ├── SessaoFirebase.tsx  mantém o cookie em dia com o token do Firebase
│   └── Painel.tsx          card com toggle gráfico ⇄ tabela
└── lib/                    filtros (Zod), formato pt-BR, tema, clienteHttp (401)
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
| `/configuracoes` | — (não existe no Power BI) | ✅ só admin: usuários e matriz de acesso |

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

**SSO com conta Google, via Firebase Authentication.** Cada pessoa entra com a
própria conta `@sebratel.com.br`; não há mais senha para combinar nem para
trocar. O e-mail de cada sessão aberta vai para o log do servidor, então dá para
saber quem viu — coisa que a credencial compartilhada anterior nunca permitiu.

`src/middleware.ts` continua protegendo **tudo**, inclusive
`/api/indicadores/*` — trancar a página e deixar o endpoint aberto não protegeria
nada. Ele é o **único portão**: espalhar a checagem pelas rotas criaria a chance
de uma rota nova nascer desprotegida.

### Por que Firebase e não Google Identity Services

O GSI baixa o SDK de `accounts.google.com` **em tempo de execução** e obriga o
servidor a chamar o Google **a cada login**, porque o `access_token` dele é
opaco. São duas dependências de rede, e qualquer uma bloqueada pelo firewall
corporativo derruba o login inteiro — com uma tela de erro que não ajuda, porque
ela precisa exatamente do domínio bloqueado para aparecer. Foi o que quebrou o
Data Hub em agosto/2026 enquanto o HUBBI, com Firebase, seguia logando.

Aqui o SDK vem no bundle (npm) e o ID token é um **JWT assinado**, verificado
localmente em `src/server/auth/firebaseToken.ts` com a chave pública do Google,
que fica em cache por horas. Depois da primeira busca de chaves, validar sessão
não toca a rede.

### O que o servidor confere em todo token

`alg = RS256` (recusar o que o token declara abre o `alg: none`), emissor e
audience **deste** projeto (sem isso, token de qualquer projeto Firebase do mundo
entra), vencimento, `iat` não absurdamente no futuro, e-mail verificado e
**domínio do e-mail**. O `hd` que a tela manda ao Google só filtra o seletor de
contas — **quem controla acesso é `ALLOWED_DOMAIN` no servidor**.

`npm test` cobre isso com 17 casos, incluindo `alg: none`, troca para HS256,
payload adulterado depois de assinado, token de outro projeto e domínio que
apenas *termina* parecido com o autorizado.

### A tela de login

Segue o **mesmo padrão do COM · Gestão Comercial** (`comercial_pbi`): cena de
marca à esquerda, card claro à direita com etiqueta do sistema, aviso de domínio
e barra de rodapé. A porta de entrada dos sistemas internos é reconhecível entre
si de propósito.

O que muda em relação à de lá: a cor (vermelho da marca, não o vinho do
relatório comercial — paleta se herda do relatório de origem, e as origens são
diferentes) e o **motor**, que aqui é Firebase e lá é GSI. Copiar a tela não é
copiar o mecanismo.

⚠️ Esta é a única tela que **não acompanha o alternador de tema**. Ela é uma cena
de marca, fixa, e vem antes do cabeçalho — que é onde o alternador mora. Por isso
as cores dela são literais, num módulo CSS próprio (`login.module.css`), e não
tokens: token aqui viraria uma cena que se desmonta sozinha no tema escuro. As 8
telas de dados seguem o tema normalmente.

### Controle de acesso — quem vê o quê

Autenticar diz **quem é**; autorizar diz **o que alcança**. As duas coisas vivem
em lugares diferentes, e não por elegância: o middleware roda no runtime Edge,
que **não fala com Postgres**.

| Onde | O quê |
|---|---|
| `src/middleware.ts` (Edge) | autenticação: a sessão é válida? |
| `src/server/auth/acesso.ts` (Node) | autorização: esta pessoa vê esta tela? |
| `src/app/(dashboard)/layout.tsx` | aplica a decisão nas 8 telas, num ponto só |
| `src/server/auth/guarda.ts` | aplica nas rotas de API |

O middleware passa o caminho pedido em `x-caminho` e o e-mail verificado em
`x-usuario-email` — **apagando antes o que veio de fora**, senão bastaria mandar
o cabeçalho na mão para virar outra pessoa.

**Dois papéis:** `viewer` (padrão de quem entra) e `admin` (vê tudo e abre
Configurações). A matriz por tela tem dois modos: `todos` libera para qualquer
pessoa do domínio; `lista` restringe às marcadas.

⚠️ **Esconder a tela sem fechar o endpoint não esconde nada.** Por isso
`/api/indicadores/[slug]` e `/api/protocolos` checam acesso **antes** de qualquer
trabalho, usando o mapa `TELAS_POR_INDICADOR` em `src/config/telas.ts`. Os
indicadores nominais (`produtividade`, `ofensores`, `recorrencia`) têm uma tela
cada, então restringir a tela restringe o dado de verdade — e um teste garante
que continue assim.

**Tela nova precisa entrar em `src/config/telas.ts`.** Se não entrar, ela não
aparece na matriz e fica visível para todo mundo, em silêncio. `telas.test.ts`
compara o catálogo com as rotas em disco e quebra o build se divergirem.

**Sem administrador ninguém configura nada**, e o caminho para esse beco é
trivial (o único admin se rebaixa e salva). Duas travas: `ADMIN_EMAILS` no
ambiente é sempre admin e a tela não o rebaixa, e a API recusa com 409 qualquer
gravação que deixaria o sistema sem nenhum administrador.

### Onde isso é guardado

**Não existe cadastro de login.** Quem diz QUEM a pessoa é continua sendo o
Google, via Firebase: não há tabela de usuários, senha nem convite. O que se
guarda é AUTORIZAÇÃO — o que cada e-mail já autenticado alcança.

Mesma metodologia do COM · Gestão Comercial: **arquivos JSON num volume**, não um
banco.

| Arquivo | Conteúdo |
|---|---|
| `data/acesso.json` | papéis e matriz de telas |
| `data/ia.json` | provedor, modelo e a chave cifrada |
| `data/.secret` | chave de cifra, gerada sozinha se `APP_SECRET` não vier do ambiente |

Um Postgres para isto seria um serviço a provisionar, um esquema a migrar e mais
uma dependência entre o dashboard e ficar de pé — em troca de consultas que cabem
num arquivo de 2 KB. O preço do arquivo é precisar de volume; o preço do banco
era não subir sem ele.

A gravação é **atômica** (arquivo temporário + `rename`). Escrever direto no
destino tem uma janela em que ele está truncado, e morrer nela — deploy no meio
de um Salvar — faria todo mundo perder o papel de uma vez.

⚠️ **O volume precisa existir na stack**, e o diretório precisa pertencer ao
usuário `app` (o Dockerfile faz o `chown`; volume Docker herda o dono do que já
está na imagem). Sem isso o container não escreve, e o sintoma é "controle de
acesso inativo" num sistema que parece configurado.

**Sem diretório gravável o controle fica inativo** e todo mundo do domínio vê as
8 telas — como antes desta funcionalidade. É degradação deliberada: derrubar o
dashboard inteiro porque o volume não montou seria trocar um problema pequeno por
um grande. A tela de Configurações e o menu do usuário dizem isso em letras
grandes, porque o pior engano numa tela de permissão é a que faz acreditar que
algo está protegido.

### IA — leitura dos painéis

Com um provedor cadastrado em **Configurações → IA**, cada painel ganha um botão
**Explicar** que manda a tabela do painel ao provedor e mostra a leitura em prosa.

Três provedores: Anthropic, OpenAI (e compatíveis — Azure, Groq, OpenRouter, via
base URL) e Gemini. HTTP cru, não SDK: são três dialetos atrás de uma interface
só, e a parte usada de cada API é uma requisição POST.

⚠️ **Isso manda dado para fora da empresa.** Vai a mesma tabela que o painel já
mostra, limitada a 120 linhas — e em Produtividade e Ofensores isso inclui nome
de técnico, em Protocolos nome e endereço de cliente. Por isso a funcionalidade
só existe depois que um administrador cadastra a chave, o aviso está na tela de
cadastro, e a resposta vem etiquetada com provedor, modelo e quantas linhas
foram enviadas — texto de máquina sem etiqueta vira "o sistema disse" uma
reunião depois.

A **tela de origem viaja no pedido e é conferida** no servidor: sem isso, quem
não tem acesso a Produtividade mandaria a tabela de Produtividade e receberia a
leitura dela, contornando a matriz pelo caminho da IA.

**A chave fica cifrada em repouso** (AES-256-GCM, chave de `APP_SECRET` ou de
`data/.secret`) e **nunca volta para o navegador** — a tela recebe os quatro
últimos caracteres, para conferência. Sem `APP_SECRET` uma chave é gerada em
`data/.secret` — funciona, mas aí a chave de cifra mora ao lado do que ela cifra;
definir `APP_SECRET` fecha essa brecha. ⚠️ Trocá-lo torna a chave gravada
ilegível; a tela detecta e pede o cadastro de novo.

### Sessão

O cookie `sessao_manutencao` é **HttpOnly** e guarda o próprio ID token, que vale
1 h. Quem o mantém vivo é o cliente: o SDK renova o token sozinho e
`SessaoFirebase` reposta o novo. A sessão do Firebase persiste no navegador, então
quem volta no dia seguinte entra sem ver o popup.

⚠️ **Falha ao renovar NÃO é logout.** Quem encerra a sessão é um **401 que
persiste depois de uma tentativa de renovação** (`src/lib/clienteHttp.ts`).
Tratar falha de rede como logout foi o erro que, no Data Hub, jogava a pessoa
numa tela de login que o mesmo bloqueio impedia de funcionar: sessão válida
virava beco sem saída.

### Passos manuais no console do Firebase

Projeto próprio deste sistema: `maintenance-dashboard-bbf92`. Nunca reaproveitar
o projeto de outro setor — base de usuários, domínios autorizados, cotas e log de
acesso ficam separados.

1. **Authentication → Sign-in method → Google → Ativar.** Projeto novo vem com
   todos os provedores desligados.
2. **Authentication → Settings → Authorized domains** → adicionar o domínio onde
   o dashboard roda. Só `localhost` vem liberado. Sem isso o popup falha com
   `auth/unauthorized-domain` — e esse erro **só aparece no primeiro clique real,
   nunca no build**.
3. **Google Cloud → APIs e serviços → Credenciais** → restringir a `apiKey`:
   só Identity Toolkit e Token Service, e referenciadores HTTP do domínio do
   dashboard. Ela ser pública é normal; ela valer para API cobrada não é.

### Limite conhecido

O cache das chaves do Google vive **em memória**, não em disco: o middleware roda
no runtime Edge, que não tem sistema de arquivos. Uma renovação que falha não
invalida o que já está em cache, e o cache vale 30 dias — mas um **restart do
container durante um bloqueio de saída para o Google** deixa o servidor sem
chaves para validar sessão existente. (Login novo não seria possível de todo
jeito nesse cenário: o navegador também não alcançaria o Google.)

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
