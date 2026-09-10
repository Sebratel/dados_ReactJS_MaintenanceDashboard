-- ============================================================================
-- EXPORTA IMPRODUTIVAS NO GRÃO DO RELATO — para trazer ao Power BI e comparar
-- ============================================================================
--
-- Uma linha por RELATO improdutivo (não por visita), no MESMO universo de
-- agenda que o dashboard usa em Produtividade (view de field service, tipos de
-- campo, período pela data do SLOT agendado — não pela data do relato).
--
-- POR QUE UMA LINHA POR RELATO: com isso você mesmo escolhe a unidade de conta
-- dentro do Power BI, sem eu decidir por você:
--
--   • "conta DIA"    = DISTINCTCOUNT(protocolo & dia_agendado)   -> é o que o
--     dashboard mostra hoje (291 em agosto/2026, 334 em julho/2026)
--   • "conta RELATO" = COUNTROWS(esta tabela)                    -> soma cada
--     relato como uma visita (373 em julho/2026 — mais alto que os dois lados)
--
-- A coluna `n_relatos_no_dia` já vem calculada: é quantos relatos IMPROD esse
-- MESMO protocolo teve no MESMO dia agendado. Onde ela é 1, as duas contas dão
-- o mesmo resultado; onde é 2 ou mais, é ali que "conta dia" e "conta relato"
-- discordam — e é a lista que explica a diferença contra os 340 do Power BI.
--
-- COMO USAR:
--   1. Power BI > Obter dados > SQL Server (mesma conexão que já alimenta o
--      relatório) > Consulta nativa (Query avançada) > cole este arquivo
--      inteiro.
--   2. Ajuste as duas datas logo abaixo (DE / ATE) para o período que quiser
--      testar — ou deixe como está para trazer o ano inteiro e filtrar dentro
--      do próprio Power BI pela coluna `dia_agendado`.
--   3. Compare COUNTROWS() contra sua medida atual de 340 (julho). Se baterem,
--      o Power BI conta por relato. Se não baterem, sobra pouca coisa a
--      investigar: os relatos com `n_relatos_no_dia >= 2` são a lista inteira
--      de onde as duas contagens podem divergir — dá para conferir um a um.
--
-- ⚠️ MESMA REGRA DE UNIVERSO DO DASHBOARD (TIPOS_CAMPO), que é DIFERENTE do
-- universo de Protocolos/KPIs (equipe OU catálogo) — não misture com números
-- de outras abas. Ver docs/06 item A.

WITH slots AS (
  SELECT v.assignment_id,
         date_trunc('day', v.begin_date_slot)::date AS dia,
         -- o executor do dia: o slot RESERVADO (routing_status >= 4) que
         -- venceu a disputa, nunca a sugestão do roteirizador — mesma regra
         -- de src/server/indicadores/produtividade.ts
         (array_agg(v.resource_name ORDER BY v.routing_status DESC)
            FILTER (WHERE v.routing_status >= 4))[1] AS executor
    FROM erp.v_service_desk_slots_productivity_informative v
   WHERE v.begin_date_slot >= '2026-01-01'::date          -- ← DE (ajuste aqui)
     AND v.begin_date_slot <  CURRENT_DATE + interval '1 day'  -- ← ATE (ajuste aqui)
     AND v.incident_type_title = any(ARRAY[
       'TEC - Suporte técnico',
       'TEC-MANUT-ACESSO-CLI-INCIDENTE/PROBLEMA',
       'TEC-MANUT-ACESSO-CLI-INCIDENTE/RECORRENTE',
       'TEC-MANUT-ACESSO-CLI-PREVENCAO/PROBLEMA',
       'TEC-MANUT-ACESSO-CLI-PREVENCAO/RECORRENTE',
       'TEC-MANUT-ACESSO-CLI-REQUISICAO',
       'TEC-MANUT-INT-CLIN-REGULARIZACAO',
       'TEC - Suporte / Problema [ Telefonia ]',
       'TEC-ACESSO-CLI-RETORNO-PRIORITARIO'
       -- 'TEC - Pendência Técnico Campo' RETIRADO 02/09/2026 — não é reparo,
       -- regulariza pendência do time de Ativação (ver docs/04 item 44). Se
       -- quiser testar CONTRA a definição antiga (antes desta correção),
       -- descomente a linha abaixo:
       -- , 'TEC - Pendência Técnico Campo'
     ])
   GROUP BY 1, 2
),
relatos AS (
  SELECT ai.protocol                                                        AS protocolo,
         s.dia                                                              AS dia_agendado,
         r.beginning_date                                                   AS data_hora_relato,
         s.executor                                                         AS tecnico,
         upper(substring(
           regexp_replace(regexp_replace(r.description, '<[^>]+>', ' ', 'g'), '&nbsp;', ' ', 'g')
           from '([A-Z]{3,4}\.[0-9]{1,3}|[0-9]\.[0-9]{2,3})\s*-\s*(?:REL\s*-\s*)?IMPROD'
         ))                                                                 AS codigo,
         a.requestor_id
    FROM slots s
    JOIN erp.assignment_incidents ai ON ai.assignment_id = s.assignment_id
    JOIN erp.assignments a           ON a.id = s.assignment_id
    JOIN erp.reports r               ON r.assignment_id = s.assignment_id
                                     AND date_trunc('day', r.beginning_date)::date = s.dia
   WHERE r.beginning_date >= '2026-01-01'::date               -- ← mesma DE
     AND r.beginning_date <  CURRENT_DATE + interval '1 day'   -- ← mesma ATE
     AND upper(r.description) LIKE '%IMPROD%'
)
SELECT protocolo,
       dia_agendado,
       data_hora_relato,
       tecnico,
       coalesce(codigo, '(sem código)')                                     AS codigo,
       -- quantos relatos IMPROD este protocolo teve NESTE MESMO dia agendado.
       -- 1 = as duas contagens concordam; 2+ = aqui é onde "dia" e "relato"
       -- discordam, e é a lista que precisa ser conferida
       count(*) OVER (PARTITION BY protocolo, dia_agendado)::int            AS n_relatos_no_dia
  FROM relatos
 -- colaborador no papel de cliente sai, mesma regra do resto do sistema
 WHERE requestor_id NOT IN (
   SELECT id FROM erp.people WHERE name = 'LUIS GUSTAVO ANTUNES NUNES'
 )
 ORDER BY protocolo, dia_agendado, data_hora_relato
