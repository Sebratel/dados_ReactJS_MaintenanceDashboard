'use client'

/**
 * Alternador de opções — o `Segmentado` da skill padrao-frontend-dashboards.
 *
 * Mora na barra vinho do card (`.seg`, branco sobre vinho) porque escolhe algo
 * DESTA visão: gráfico ou tabela, métrica do heatmap, ordenação do ranking. Com
 * `claro`, a mesma peça vai para fundo branco.
 *
 * `multiplo` é para os botões que ligam e desligam cada um por si (o "abonar"
 * da Produtividade): aí `valor` é a lista do que está ligado.
 */
type Opcao<T extends string> = { valor: T; rotulo: string; dica?: string }

type Comum<T extends string> = {
  opcoes: readonly Opcao<T>[]
  rotulo: string
  /** texto fixo à esquerda, dentro do grupo (ex.: "abonar") */
  prefixo?: string
  claro?: boolean
}

export function Segmentado<T extends string>(
  props: Comum<T> &
    (
      | { multiplo?: false; valor: T; aoMudar: (v: T) => void }
      | { multiplo: true; valor: ReadonlySet<T>; aoMudar: (v: T) => void }
    )
) {
  const { opcoes, rotulo, prefixo, claro } = props
  const ligado = (v: T) => (props.multiplo ? props.valor.has(v) : props.valor === v)

  return (
    <div className={`seg${claro ? ' claro' : ''}`} role="group" aria-label={rotulo}>
      {prefixo && (
        <span style={{ alignSelf: 'center', padding: '0 7px', fontSize: 11, opacity: 0.8 }}>
          {prefixo}
        </span>
      )}
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          aria-pressed={ligado(o.valor)}
          title={o.dica}
          onClick={() => props.aoMudar(o.valor)}
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  )
}
