import { consultarErp } from '@/server/db/erp'
import { STATUS_ENCERRADO } from '@/config/regras-negocio'
import type { Filtros } from '@/lib/filtros'
import { montarFrom, montarWhere, partesNecessarias, porEncerramento } from './base'

export type Mtta = {
  /** deslocamento + atendimento */
  mttaHoras: number | null
  deslocamentoHoras: number | null
  atendimentoHoras: number | null
  /** encerrados no período que têm relato de campo — denominador do MTTA */
  protocolosComRelato: number
  /** encerrados no período SEM nenhum relato de campo — MTTA nulo, não zero */
  protocolosSemRelato: number
}

/**
 * MTTA — TEMPO DE CAMPO: deslocamento + atendimento no cliente.
 *
 * ── O que entra, e por quê (docs/04 §K) ───────────────────────────────────
 *
 * `erp.reports.type` separa a natureza do relato:
 *   1 → Deslocamento          ⟵ entra
 *   2 → Atendimento solicitação ⟵ entra
 *   null → Apontamento interno  ⟵ FICA DE FORA
 *
 * A versão anterior somava `seconds_worked` de TODOS os relatos, e com isso
 * media coisa que não é reparo de campo. O protocolo 1723749 mostrou o problema
 * inteiro: antes de a demanda chegar à Manutenção, o Suporte Técnico (PATRICK
 * CECONI FAGUNDES, DOUGLAS RODRIGUES DA CUNHA, LUIS RICARDO RIBEIRO DA SILVA) e
 * o COR/CGR (EDUARDO JARDEL DA SILVA SANTANA) tentam resolver remotamente. Esse
 * tempo é real e é trabalho — mas é trabalho de OUTRA equipe, e somá-lo ao MTTA
 * fazia a Manutenção responder por espera que ela não produziu.
 *
 * O "play" também não é ponto de partida confiável: quem dá o play é o técnico,
 * então o relógio só começa quando ele encosta no protocolo.
 *
 * ── Quando não há relato de campo ─────────────────────────────────────────
 *
 * O MTTA fica NULO, nunca zero. Zero afirmaria "foi ao cliente e levou tempo
 * nenhum"; nulo diz "não temos o dado", que é a verdade. Isso importa porque a
 * ausência de deslocamento tem causas legítimas, todas confirmadas pela
 * Manutenção em agosto/2026: preventivo sem visita (1734859), protocolo
 * transferido para outro (1739886 → 1740125), atendimento pelo Supervisor, que
 * não usa o app de campo (1740048), e orientação sem visita (1746813, 1749355).
 *
 * ⚠️ Esses protocolos CONTINUAM contando como produtivo e como demanda — só não
 * entram na média de tempo. `avg` ignora nulo por si; `protocolosSemRelato`
 * existe para a tela poder dizer quantos ficaram de fora.
 *
 * ── Eixo ──────────────────────────────────────────────────────────────────
 *
 * Encerramento, como o MTTR_E: é indicador de desempenho, pertence ao mês em
 * que o reparo terminou. Ver `porEncerramento` em base.ts.
 *
 * ── Forma ─────────────────────────────────────────────────────────────────
 *
 * LATERAL agregado, uma passada por assignment no índice de
 * `reports.assignment_id`. Medido em julho/2026: 266 ms — mais rápido que a
 * subquery escalar que estava aqui antes (1.534 ms), porque aquela precisava de
 * uma varredura por métrica e esta resolve as três de uma vez.
 *
 * A soma dos componentes FECHA com o total de propósito: `desl` e `atend` usam
 * `coalesce(...,0)` e as três médias são tomadas sobre a MESMA população
 * (`total IS NOT NULL`). Sem isso, um protocolo com atendimento mas sem
 * deslocamento entrava em duas das três médias e a tela mostrava
 * 00:15:41 + 00:52:43 ≠ 01:08:23 — diferença de segundos que parece defeito.
 */
export async function obterMtta(f: Filtros): Promise<{ data: Mtta; ms: number }> {
  const fEnc = porEncerramento(f)
  const FROM = montarFrom(partesNecessarias(fEnc))
  const w = montarWhere(fEnc)
  const enc = w.params.push([...STATUS_ENCERRADO])

  const sql = /* sql */ `
    SELECT round(avg(play.total) FILTER (WHERE play.total IS NOT NULL)::numeric, 4) AS mtta_h,
           round(avg(play.desl)  FILTER (WHERE play.total IS NOT NULL)::numeric, 4) AS desloc_h,
           round(avg(play.atend) FILTER (WHERE play.total IS NOT NULL)::numeric, 4) AS atend_h,
           count(play.total)::int                                    AS com_relato,
           count(*) FILTER (WHERE play.total IS NULL)::int           AS sem_relato
      FROM (
        SELECT rp.total, rp.desl, rp.atend
        ${FROM}
        LEFT JOIN LATERAL (
          SELECT sum(r.seconds_worked) FILTER (WHERE r.type in (1, 2)) / 3600.0        AS total,
                 coalesce(sum(r.seconds_worked) FILTER (WHERE r.type = 1), 0) / 3600.0 AS desl,
                 coalesce(sum(r.seconds_worked) FILTER (WHERE r.type = 2), 0) / 3600.0 AS atend
            FROM erp.reports r
           WHERE r.assignment_id = a.id
        ) rp ON true
        ${w.sql}
          AND st.title = any($${enc})
      ) play
  `

  const r = await consultarErp<{
    mtta_h: number | null
    desloc_h: number | null
    atend_h: number | null
    com_relato: number
    sem_relato: number
  }>(sql, w.params)

  const x = r.rows[0]
  return {
    ms: r.ms,
    data: {
      mttaHoras: x?.mtta_h ?? null,
      deslocamentoHoras: x?.desloc_h ?? null,
      atendimentoHoras: x?.atend_h ?? null,
      protocolosComRelato: x?.com_relato ?? 0,
      protocolosSemRelato: x?.sem_relato ?? 0,
    },
  }
}
