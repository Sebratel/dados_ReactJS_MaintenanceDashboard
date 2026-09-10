# Pontos de auditoria (P1, P2, …)

Registro dos pontos levantados pela Manutenção durante a auditoria do dashboard,
numerados para poder ser retomados depois. Cada ponto guarda **o que foi pedido**,
**o que foi decidido** e **o que ficou pendente** — a intenção é que, meses
depois, ninguém precise reconstruir o raciocínio a partir do código.

Convenção: a numeração é do solicitante. Não renumerar, não reaproveitar número de
ponto encerrado. Se um ponto se desdobrar, usar P3a / P3b.

Para divergências de **critério** em relação ao Power BI, ver
[04-mudancas-de-criterio.md](04-mudancas-de-criterio.md). Este arquivo é sobre
**capacidade de conferir**; aquele é sobre **como o número é calculado**.

---

## P1 · Ver os dados que geram o gráfico · **Níveis 1 e 2 concluídos**

### O pedido

> "Encontrei dificuldade de fazer auditoria pois antes eu deixava ao final dos
> gráficos uma tabela com os dados que geram os dados, não temos mais isso então
> fico cego pois não sei o que o gráfico está realmente trazendo."

### O que já existia (e não estava comunicado)

30 dos 31 painéis já tinham a alternância **`Gráfico | Tabela`** no canto superior
direito. A capacidade existia; faltou dizer. Falha de comunicação, não de produto
— e vale como lembrete: recurso que ninguém sabe que existe não existe.

O painel **MTTR médio** (tela Executivo) era o único sem tabela. Corrigido.

### A distinção que organiza o problema

"Os dados **que geram** os dados" tem três níveis, e eles resolvem perguntas
diferentes:

| Nível | O que mostra | Responde |
|---|---|---|
| 1 | a tabela agregada do próprio painel, exportável | "o gráfico está desenhando estes números?" |
| 2 | a grade linha por linha dos protocolos | "estes números vêm destes protocolos?" |
| 3 | o recorte exato de uma barra clicada | "estes 442 são quais 442?" |

### Regra que não pode ser violada nos níveis 2 e 3

O detalhe **precisa reaproveitar os mesmos blocos de SQL** dos filtros e das
regras do indicador. Uma consulta de detalhe escrita à parte divergiria por
diferença de filtro, e a auditoria encontraria discrepâncias **que existem só na
ferramenta de auditoria**. Pior que não ter detalhe é ter detalhe que mente.

### Nível 1 — o que foi feito

Exportação em **todos os 31 painéis**, implementada uma vez em
[`Painel.tsx`](../src/components/Painel.tsx) com as funções de
[`exportar.ts`](../src/lib/exportar.ts):

- **`Copiar`** — TSV para a área de transferência, que cola direto em células do
  Excel sem passar pelo assistente de importação.
- **`CSV`** — arquivo com o período no nome (`mttr-medio_2026-08-01_a_2026-08-31.csv`).
- **contagem de linhas** ao lado dos botões. É a primeira conferência de uma
  auditoria: se o gráfico mostra 12 barras e a tabela diz 48 linhas, a divergência
  aparece antes de abrir o Excel.
- os controles só aparecem na visão de tabela — no gráfico seriam mais dois
  botões competindo com o dado.

Três decisões de formato que parecem detalhe e não são:

1. **Separador `;`** — o Excel em português usa ponto e vírgula como separador de
   lista. Com `,` o arquivo abre com tudo empilhado numa coluna só, e a conclusão
   natural é "a exportação está quebrada".
2. **BOM UTF-8** no início do arquivo — sem ele o Excel lê na codepage do sistema
   e "São Leopoldo" chega como "SÃ£o Leopoldo". Num relatório de auditoria,
   ilegível equivale a errado.
3. **Período no nome do arquivo** — a pasta de downloads acumula dezenas de CSV.
   Três `ranking.csv` não dizem qual recorte gerou qual, e comparar o arquivo
   errado com o Power BI produz uma divergência inteiramente falsa.

Verificado com o código real: valores contendo `;`, aspas e quebra de linha saem
com o número certo de colunas; o BOM sai como `ef bb bf`; a remoção de acento no
nome do arquivo funciona (`MTTR médio` → `mttr-medio.csv`).

### Nível 2 — o que foi feito

Tela **[`/protocolos`](../src/app/protocolos/Conteudo.tsx)**: um protocolo por
linha, **38 colunas**, com os mesmos filtros globais do resto do dashboard.
Modelada a partir do export `Ex relat detalhado protocolos` do Voalle, entregue
pela Manutenção como referência.

**O universo é o mesmo por construção.** O SELECT é novo, mas o FROM e o WHERE
vêm de [`base.ts`](../src/server/indicadores/base.ts) — os mesmos que alimentam
KPI, série e ranking. Isso é a regra da seção anterior aplicada: se o filtro
fosse reescrito aqui, o relatório poderia "confirmar" o dashboard estando os dois
errados juntos.

**Duas famílias de coluna**, e a distinção é o ponto:

| Família | Colunas | O que prova |
|---|---|---|
| Paridade Voalle | protocolo, cliente, contrato, etiqueta, categorias 1–5, solução, OLT, CTO, criador… | que lemos **as mesmas linhas** que o ERP |
| Derivadas do dashboard | base, técnico de campo, auxiliar, registrou dupla, agendamentos, MTTR, improdutivas + motivo, preventiva, instalação (login PPPoE) | que **calculamos certo** |

Conferir só as colunas cruas provaria apenas que lemos a mesma tabela. As
derivadas são onde divergência de fato aparece — e são justamente as que o export
do Voalle não tem.

**Conjuntos de colunas** (`Voalle` · `Auditoria` · `Rede` · `Tudo`): 38 colunas
de uma vez não se lê. Não são "resumos" da mesma tabela — auditoria tem três
perguntas diferentes ("bate com o Voalle?", "o cálculo está certo?", "qual ponto
físico?") e cada uma quer colunas distintas.

**Busca por identificador** (protocolo, contrato, etiqueta, login, CTO, cliente):
o gesto real é *"esse protocolo do Power BI, cadê ele?"*.

**Exportação server-side**, por link e não por botão de JavaScript: o arquivo sai
com **todas** as linhas do recorte, não com as 100 da página — que é o erro
clássico de "exportei e faltou dado". Traz o rodapé de filtros aplicados, igual
ao do Voalle, para que o arquivo diga sozinho de que recorte veio.

#### Conferência linha a linha já feita

Três protocolos do CSV entregue pela Manutenção, campo a campo: **1509251**
(normal), **1598801** (CTO em condomínio) e **1613624** (contrato cancelado, sem
rede). Todos batem, com três diferenças **deliberadas**:

1. **Slot e Porta.** O export do Voalle traz
   `authentication_access_points.slots_first_number` / `ports_first_number` —
   **configuração da OLT**, idêntica para todos os clientes dela (0 nas
   CHNVA/CHNVC, 1 nas demais; porta sempre 1). Não dizem nada sobre o cliente.
   Aqui são `slot_olt` / `port_olt`, os **reais da instalação** — e conferem com
   o que o nome da CTO codifica (`CHN-C-822-2-3-8/3` → OLT 2, slot 3, porta 8).
2. **Cliente de teste excluído** (ver 04 §5). O Voalle o inclui; a diferença é de
   7 protocolos em 8 meses e vai declarada no cartão do topo.
3. **`🆕` no rótulo da Categoria 1.** O prefixo faz parte do dado hoje
   (`🆕Visita Externa (FSM)`); o export entregue não o tem. Cosmético, mas
   quebra comparação por igualdade exata de string no Excel.

Uma armadilha resolvida no caminho: o caminho óbvio até a rede
(`contract_service_tag_id → authentication_contracts`) **falha em ~2%** dos
casos, porque o protocolo guarda a etiqueta vigente na época e o contrato de
autenticação pode já ter migrado. No protocolo 1498361 a etiqueta do protocolo é
a 255493 e o contrato aponta para a 286480 — pelo caminho direto o CTO viria
vazio, e o Voalle mostra `CAN-C-1047-2-6-3/4`. Por isso o LATERAL tenta a
etiqueta primeiro e cai para o contrato depois.

#### ⚠️ O universo do dashboard é MAIOR que o do CSV entregue

O CSV de referência traz o próprio recorte no rodapé, e ele é bem mais estreito
que o nosso. Medido em **julho/2026**:

| Recorte | Protocolos |
|---|---|
| Universo do dashboard | **3.764** |
| Aplicando todos os filtros do CSV entregue | **2.361** |

De onde vem a diferença de 1.403:

| Filtro do CSV que corta | Protocolos cortados |
|---|---|
| `tipoProtocolo` restrito a 3 tipos | 1.391 |
| — dos quais `PREVENCAO/PROBLEMA` | 875 |
| — `REQUISICAO` | 305 |
| — `PREVENCAO/RECORRENTE` | 155 |
| `categoria1` restrita a 2 valores | 1.387 (quase o mesmo conjunto) |
| `categoria2` restrita a 7 valores | 733 |
| equipe ≠ Financeiro / Nova Santa Rita / Suporte-Atendimento | 28 |
| cidade fora das 6 | 9 |
| catálogo = `Suporte Tecnico` | 0 |

**Não é divergência — é recorte.** O CSV entregue exclui preventivas e
requisições; o dashboard as inclui porque as telas Preventivos e Ofensores
dependem delas. Para reproduzir o recorte do Voalle na tela, basta usar a barra
de filtros: **Tipo** = os 3 tipos, **Categoria 2** = a lista, **Cidade** = as 6,
**Equipe** ≠ as 3. (`categoria1` não é filtro da barra, e não faz falta: corta
praticamente o mesmo conjunto que `tipo`.)

Conferir isso **antes** de comparar totais evita a conclusão errada de que o
dashboard está inflado.

#### Primeira rodada de auditoria da Manutenção — 3 defeitos reais achados

O relatório fez o que existe para fazer: **na primeira leitura do CSV a
Manutenção achou defeito de verdade**, não ruído.

| Achado | Veredito | Correção |
|---|---|---|
| Nome do CSV não se identifica como auditoria | procede | `auditoria_<de>_a_<ate>.csv` |
| Protocolo 1758835 com `Agend. = 3`, mas 2 no sistema | **defeito** | contava transição de roteirização, não agendamento |
| 1758641/1757714/1755835 com técnico de campo que não aparece no protocolo | **defeito** | `max(resource_name)` escolhia alfabeticamente entre a sugestão do roteirizador e o executor |

Os dois últimos têm **a mesma causa**: a view de field service é 1:N por
`routing_status` (0 sugestão → 4 reservado → 6 executado), não por agendamento.
Diagnóstico completo, medições e tabela antes/depois em
[04 §17](04-mudancas-de-criterio.md). Resumo do impacto: a regra trocava o
técnico em **41% dos protocolos** e inflava o ranking de campo por viés
alfabético (TIAGO aparecia com 471 protocolos; o real é 136).

**Fica um limite de fonte, não de cálculo:** a view guarda só o slot vigente, então
um reagendamento sobrescrito é invisível — por isso o 1758835 mostra 1 e a
Manutenção contou 2. Está declarado no rodapé da tela.

#### ⚠️ Grão: a primeira "divergência" que vai aparecer e não é uma

`/protocolos` conta **protocolo**. Produtividade conta **protocolo × dia
agendado**. Somar a coluna `Improd.` desta lista e comparar com o cartão de
improdutivas **não fecha por construção** — e o eixo de data também difere
(criação aqui, agenda lá). Medido em julho/2026:

| | `/protocolos` (criação, grão protocolo) | `/produtividade` (agenda, grão protocolo-dia) |
|---|---|---|
| improdutivas | 273 dias, em 244 protocolos | 334 |
| registro de dupla (RAUX) | 765 protocolos (20,3%) | 819 visitas |
| auxiliar real identificado | 573 protocolos (15,2%) | 619 visitas |

É o mesmo alerta da tabela dos quatro indicadores acima, agora com número. A tela
diz isso no rodapé para que ninguém abra chamado achando que achou defeito.

**Efeito colateral útil:** isto responde a uma pergunta que estava em aberto — o
**percentual de protocolos com a dupla preenchida**. Em julho/2026, **20,3% têm
registro na perna RAUX** e **15,2% têm auxiliar real**; a diferença de 5 pontos é
quem registrou `SEM AUXILIAR`, ou seja, cumpriu o processo declarando que foi
sozinho.

#### Custo

~5,4 s por recorte novo no mês (o peso está nos LATERAIS, não no volume), depois
**instantâneo**: o recorte inteiro fica no cache do servidor e paginar, buscar e
exportar só fatiam o array em memória — medido em **45–60 ms**. Paginar no SQL
custaria os 5,4 s a cada página. Teto de **15.000 linhas** por recorte (~1 
trimestre); passando disso a lista **trunca e avisa**, em vez de ficar
silenciosamente incompleta.

### Pendente — nível 3

**Nível 3:** clicar numa barra abre a grade já filtrada naquele pedaço. O número
do gráfico e a contagem de linhas têm de bater; quando não baterem, é defeito
real. Combinado fazer **tela por tela, na ordem em que a auditoria avançar**, para
não construir detalhe de tela que ainda pode mudar.

⚠️ **Quatro indicadores não são contagem de protocolo** e precisam expor a própria
unidade no nível 3, senão a contagem não fecha e vai *parecer* erro estando certa:

| Indicador | Unidade real | O que a grade tem de listar |
|---|---|---|
| Produtividade | protocolo-**dia**, creditando 2 técnicos | protocolo, dia, titular, auxiliar, produtivo/improdutivo |
| Recorrência | **instalação** com janela de tempo | login, chamado atual, chamado anterior, distância em dias |
| Preventivos | olha **90 dias para frente** | preventiva, próximo reparo, dias até o retorno |
| Ofensores | **distância** até o atendimento anterior | reparo, atendimento anterior, técnico anterior, solução anterior |

### Observação aberta, aguardando decisão

As tabelas de série trazem **o mês inteiro**, inclusive dias futuros com zero — em
10/08 a tabela do Executivo diz "31 linhas" mas só 10 têm dado. Para auditoria são
21 linhas de ruído no CSV.

Mexer nisso afeta também os gráficos (a linha do fluxo hoje se estende até o fim
do mês), então **não foi alterado**. Relacionado ao rodapé do Coeficiente, que
conta dias futuros como "base estimada" — daí o "22 dias com base estimada" num
mês com 10 dias corridos.
