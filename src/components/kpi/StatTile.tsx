import type { ReactNode } from 'react'
import { fmtVariacao } from '@/lib/formato'

export type StatTileProps = {
  rotulo: string
  valor: string
  /** contexto abaixo do número: comparação, denominador, ressalva */
  contexto?: ReactNode
  /** fração de variação; sinal define a cor, mas nunca só a cor — vem com seta e rótulo */
  variacao?: number | null
  /** em métricas onde subir é ruim (MTTR, improdutividade), inverte a leitura */
  subirEhRuim?: boolean
  status?: 'good' | 'warning' | 'critical' | null
  destaque?: boolean
}

/**
 * Tile de KPI. O número é o protagonista — figuras proporcionais (não tabulares,
 * porque não está em coluna). A variação nunca comunica só por cor: leva seta
 * (↑/↓) e o valor percentual explícito.
 */
export function StatTile({
  rotulo,
  valor,
  contexto,
  variacao = null,
  subirEhRuim = false,
  status = null,
  destaque = false,
}: StatTileProps) {
  const temVar = variacao !== null && variacao !== undefined && Number.isFinite(variacao)
  const subiu = temVar && variacao! > 0
  const desceu = temVar && variacao! < 0
  const bom = subirEhRuim ? desceu : subiu
  const ruim = subirEhRuim ? subiu : desceu

  const corVar = !temVar || variacao === 0
    ? 'var(--text-muted)'
    : bom
      ? 'var(--delta-up-good)'
      : ruim
        ? 'var(--status-critical)'
        : 'var(--text-muted)'

  const corStatus =
    status === 'good'
      ? 'var(--status-good)'
      : status === 'warning'
        ? 'var(--status-warning)'
        : status === 'critical'
          ? 'var(--status-critical)'
          : null

  return (
    <div
      className="flex flex-col justify-between rounded-lg border bg-[var(--surface-1)] px-4 py-3"
      style={{
        borderColor: destaque ? 'var(--brand)' : 'var(--border)',
        borderLeftWidth: destaque ? 3 : 1,
      }}
    >
      <div className="flex items-center gap-1.5">
        {corStatus && (
          <span
            aria-hidden="true"
            className="inline-block size-2 shrink-0 rounded-full"
            style={{ background: corStatus }}
          />
        )}
        <span className="text-[11px] font-medium tracking-wide uppercase text-[var(--text-muted)]">
          {rotulo}
        </span>
      </div>

      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-[26px] leading-none font-semibold text-[var(--text-primary)]">
          {valor}
        </span>
        {temVar && (
          <span
            className="flex items-center gap-0.5 text-xs font-medium"
            style={{ color: corVar }}
          >
            <span aria-hidden="true">{subiu ? '↑' : desceu ? '↓' : '→'}</span>
            {fmtVariacao(variacao)}
          </span>
        )}
      </div>

      {contexto && (
        <div className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">{contexto}</div>
      )}
    </div>
  )
}
