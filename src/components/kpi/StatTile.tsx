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
 * Cartão de KPI — o `Kpi` da skill padrao-frontend-dashboards: número grande,
 * rótulo e uma linha de definição (nome de indicador sozinho raramente basta).
 *
 * A borda de cima carrega o papel do cartão: vinho no normal, dourado no
 * destaque da tela, e as cores de ESTADO quando há estado — nunca enfeite. A
 * variação nunca comunica só por cor: leva seta (↑/↓) e o valor percentual.
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

  const classeEstado =
    status === 'good' ? 'bom' : status === 'warning' ? 'atencao' : status === 'critical' ? 'alerta' : ''

  const corStatus =
    status === 'good'
      ? 'var(--status-good)'
      : status === 'warning'
        ? 'var(--status-warning)'
        : status === 'critical'
          ? 'var(--status-critical)'
          : null

  return (
    <div className={`kpi ${classeEstado || (destaque ? 'destaque' : '')}`}>
      <span className="rotulo">
        {corStatus && (
          <span
            aria-hidden="true"
            style={{ width: 8, height: 8, borderRadius: '50%', background: corStatus, flex: 'none' }}
          />
        )}
        {rotulo}
      </span>

      <span className="linha-valor">
        <span className="valor">{valor}</span>
        {temVar && (
          <span className="variacao" style={{ color: corVar }}>
            <span aria-hidden="true">{subiu ? '↑' : desceu ? '↓' : '→'}</span>
            {fmtVariacao(variacao)}
          </span>
        )}
      </span>

      {contexto && <span className="desc">{contexto}</span>}
    </div>
  )
}
