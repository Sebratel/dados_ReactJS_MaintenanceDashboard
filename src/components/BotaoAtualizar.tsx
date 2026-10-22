'use client'

import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { marcarAtualizacaoForcada } from '@/lib/useIndicador'
import { useCallback, useEffect, useState } from 'react'
import { Icone } from './Icone'

/**
 * Botão "Atualizar" + idade do dado.
 *
 * POR QUE OS DOIS JUNTOS, E NÃO SÓ O BOTÃO: um botão de atualizar sem a idade ao
 * lado é inútil — o gestor clica, o número não muda (porque já estava fresco) e
 * ele não tem como saber se funcionou ou se o sistema travou. A idade é o que
 * dá sentido ao clique, nos dois casos: quando muda e quando não muda.
 *
 * A idade também é o que permite NÃO ter atualização automática agressiva.
 * Enquanto o "há X min" estiver visível, dado velho é uma escolha informada do
 * leitor, não uma armadilha.
 *
 * PROTEÇÕES:
 * - desabilitado enquanto qualquer consulta estiver correndo, para o clique
 *   repetido não empilhar requisição (o single-flight do servidor já protege a
 *   réplica, mas o botão não pode PARECER que não fez nada);
 * - o refetch força `atualizar=1`, que ignora o cache do servidor E manda
 *   `no-store` ao navegador — sem isso o botão devolveria a cópia local.
 */
export function BotaoAtualizar() {
  const qc = useQueryClient()
  const carregandoReal = useIsFetching() > 0
  const [montado, setMontado] = useState(false)
  const [atualizadoEm, setAtualizadoEm] = useState<number | null>(null)
  const [, forcarRender] = useState(0)

  useEffect(() => setMontado(true), [])

  // `useIsFetching()` lê o estado AO VIVO da query — ele pode genuinamente
  // divergir entre o HTML do servidor e a primeiríssima pintura do cliente,
  // porque o TanStack Query pode disparar um fetch durante a fase de render
  // do cliente, antes da hidratação terminar de conferir a árvore. Travar em
  // `false` até o efeito de montagem rodar garante que a primeira renderização
  // do cliente bata com a do servidor (nem span, nem atributo mudam sozinhos);
  // a atualização para o valor real acontece DEPOIS da hidratação, como
  // qualquer mudança normal de estado — sem risco de mismatch.
  const carregando = montado && carregandoReal

  // marca o instante em que a última leva de consultas terminou
  useEffect(() => {
    if (!carregando) setAtualizadoEm(Date.now())
  }, [carregando])

  // o "há X min" precisa envelhecer sozinho na tela, senão congela no valor
  // do último render e mente para quem deixou a aba aberta
  useEffect(() => {
    const id = setInterval(() => forcarRender((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const atualizar = useCallback(() => {
    // abre a janela ANTES do refetch: o queryFn a lê para anexar `atualizar=1`
    marcarAtualizacaoForcada()
    void qc.refetchQueries({ type: 'active' })
  }, [qc])

  const idade = atualizadoEm ? Date.now() - atualizadoEm : null
  const rotuloIdade = (() => {
    if (carregando) return 'atualizando…'
    if (idade === null) return null
    const min = Math.floor(idade / 60_000)
    if (min < 1) return 'agora há pouco'
    if (min === 1) return 'há 1 min'
    if (min < 60) return `há ${min} min`
    const h = Math.floor(min / 60)
    return h === 1 ? 'há 1 h' : `há ${h} h`
  })()

  return (
    <div className="flex items-center gap-2">
      {rotuloIdade && (
        <span
          className="text-[11px] text-[var(--text-muted)] tabular-nums"
          aria-live="polite"
        >
          {rotuloIdade}
        </span>
      )}
      <button
        type="button"
        onClick={atualizar}
        disabled={carregando}
        aria-busy={carregando}
        title="Consulta o banco agora, ignorando o cache. Atualiza para todos."
        className="flex items-center gap-1.5 rounded border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        style={{
          borderColor: 'var(--border)',
          color: 'var(--text-secondary)',
        }}
      >
        <span className={carregando ? 'inline-flex animate-spin' : 'inline-flex'}>
          <Icone nome="atualizar" tamanho={12} />
        </span>
        Atualizar
      </button>
    </div>
  )
}
