# Contexto — Reparos recorrentes (maio–agosto 2026)

> Documento de handoff. O Claude deve ler **este arquivo**, não o CSV.
> O CSV tem 5,3 MB (~1,3 M tokens) e estoura a janela de contexto sozinho.

## Fonte

- Arquivo: `RELATÓRIO_RESUMO_MAIO-AGO.csv`
- Encoding: UTF-8 **com BOM** → usar `encoding="utf-8-sig"`
- Quebra de linha CRLF
- Período: 2026-05-01 a 2026-08-31
- 16.095 linhas × 18 colunas

## Chave de recorrência: `user` (DEFINIDO)

A chave oficial é **`user`** — o login/serviço, não o cliente nem a etiqueta.
Logo o evento é o par **protocolo × user**, que é exatamente o grão do export:
16.095 eventos, 14.762 protocolos, 12.338 users.

### Ressalva obrigatória: protocolo multi-user

Um protocolo pode cobrir dezenas de users do mesmo contrato. Com `user` como
chave, cada um deles conta como uma abertura própria — o que **concentra a
recorrência em poucos clientes corporativos**:

| Cliente | Users recorrentes em ago | Realidade |
|---|---|---|
| UNIDASUL | 108 | 1 protocolo cobrindo 108 links |
| DGT TECNOLOGIA | 35 | 14 protocolos × ~35 câmeras no contrato `SLE285277-20` |
| Prefeitura de São Leopoldo | 15 | contrato multi-ponto |

São **158 dos 951 users recorrentes de agosto (17%) vindos de 3 clientes.**
Os 35 users da DGT com "9 aberturas" cada são os mesmos 9 protocolos
atingindo o contrato inteiro — não 315 incidentes independentes.

Decisão pendente: manter (mede impacto por serviço afetado) ou tratar
protocolo multi-user como evento único (mede incidentes reais). Ver pendências.

## Colunas

| Coluna | Distintos | Observação |
|---|---|---|
| `.` | 1 | coluna lixo do export, descartar |
| `Protocolo` | 14.762 | chave do evento |
| `Dt. criação` | — | data de abertura |
| `Cliente` | 11.971 | nome; chave de recorrência do negócio |
| `ETIQUETA` | 12.129 | id do contrato |
| `user` | 12.338 | login; 2.010 com sufixo `_N` |
| `Status do Protocolo` | 5 | 15.115 Encerrado, 974 Cancelado |
| `Data Encerramento` | 129 | 6 nulos |
| `Cidade` | 13 | São Leopoldo, Canoas, Sapucaia, Esteio, N. Hamburgo = 97% |
| `Equipe` | 9 | Field Service = 15.878 (98,7%) |
| `Responsável Protocolo` | 84 | 606 nulos |
| `Tipo Protocolo` | 7 | ver abaixo |
| `Catálogo` | 2 | Oper. Reparo 11.603 / Oper. Tecnologia 4.492 |
| `Categoria 1..5` | 4/18/33/19/4 | Cat.3 1.209 nulos, Cat.4 9.786 nulos |

### Tipo Protocolo

| Tipo | Qtd |
|---|---|
| TEC-MANUT-ACESSO-CLI-INCIDENTE/PROBLEMA | 10.050 |
| TEC-MANUT-ACESSO-CLI-PREVENCAO/PROBLEMA | 3.676 |
| TEC-MANUT-ACESSO-CLI-REQUISICAO | 1.221 |
| TEC-MANUT-ACESSO-CLI-PREVENCAO/RECORRENTE | 636 |
| TEC-MANUT-ACESSO-CLI-INCIDENTE/RECORRENTE | 395 |
| TEC-MANUT-INT-CLIN-REGULARIZACAO | 84 |
| TEC - Migração com troca de Equipamento | 33 |

> Existe recorrência **marcada na origem** (`/RECORRENTE` no Tipo Protocolo e
> `[Prevencao Recorrente]` na Categoria 1). Comparar com a recorrência
> **calculada** pela regra abaixo — a divergência é achado de auditoria.

## Regra de recorrência (definição do negócio)

Cliente é recorrente no mês M se tiver **≥ 2 aberturas de reparo na janela
[M−1, M]** — repetição dentro do próprio mês ou entre o mês anterior e o de
referência.

## Resultados calculados

### Aberturas por mês (protocolo único)

| Mês | Total | Oper. Reparo | Oper. Tecnologia |
|---|---|---|---|
| 2026-05 | 3.504 | 2.605 | 899 |
| 2026-06 | 3.506 | 2.551 | 955 |
| 2026-07 | 3.802 | 2.713 | 1.089 |
| 2026-08 | 3.950 | 2.824 | 1.126 |

### Recorrentes por `user` (chave oficial)

| Mês | Todos os tipos | Só `Oper. Reparo` |
|---|---|---|
| 2026-06 | 946 / 3.409 (27,8%) | 660 / 2.544 (25,9%) |
| 2026-07 | 909 / 3.580 (25,4%) | 630 / 2.525 (25,0%) |
| 2026-08 | 951 / 3.771 (25,2%) | 529 / 2.810 (18,8%) |

Volume absoluto sobe, percentual cai — a base atendida cresce mais rápido
que a recorrência. Em `Oper. Reparo` a queda é bem mais forte (25,0% → 18,8%).

Para referência, com outras chaves em agosto: `ETIQUETA` 795, `Cliente` 833.

### Distribuição de aberturas por user recorrente (ago)

| Aberturas na janela | Users |
|---|---|
| 2 | 676 |
| 3 | 104 |
| 4 | 130 |
| 5 | 4 |
| 7 | 1 |
| 9 | 35 |
| 10 | 1 |

O pico em 9 é artificial: são os 35 logins da DGT. Ignorando ele, a cauda
acima de 4 aberturas é praticamente vazia.

## Como reprocessar

```bash
# padrao: chave user, mes de referencia 2026-08
python scripts/analisar_recorrencia.py "RELATÓRIO_RESUMO_MAIO-AGO.csv"

# so reparo
python scripts/analisar_recorrencia.py "RELATÓRIO_RESUMO_MAIO-AGO.csv" --catalogo "Oper. Reparo"

# comparar com outras chaves
python scripts/analisar_recorrencia.py "RELATÓRIO_RESUMO_MAIO-AGO.csv" --chave ETIQUETA
```

A saída inclui um bloco de **concentração** — quantos users recorrentes cada
cliente responde — para você detectar na hora se o número está inflado por
contrato multi-serviço.

## Pendências de revisão

- [x] Chave oficial de recorrência: **`user`**.
- [ ] **Protocolo multi-user conta 1 vez por user ou 1 vez no total?**
      Impacta 158 users recorrentes de agosto (17% do total), de 3 clientes.
- [ ] Definir se `Cancelado`/`Anulado` (976 protocolos) entram na contagem.
- [ ] Definir se `REQUISICAO` e `Migração com troca de Equipamento` contam como reparo.
- [ ] Cruzar recorrência calculada × marcada na origem (`/RECORRENTE`).
- [ ] Conferir os números contra o print do BI de agosto.
