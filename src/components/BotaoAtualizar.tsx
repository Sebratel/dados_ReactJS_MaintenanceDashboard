'use client'

import { useIsFetching, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { marcarAtualizacaoForcada } from '@/lib/useIndicador'
import { fmtInstante, haQuanto } from '@/lib/formato'
import { useCallback, useEffect, useState } from 'react'
import { Icone } from './Icone'

/**
 * Ponto de atualização + idade do dado + botão "Atualizar" — o bloco `.updated`
 * do topo da casca Sebratel.
 *
 * POR QUE OS TRÊS JUNTOS, E NÃO SÓ O BOTÃO: um botão de atualizar sem a idade ao
 * lado é inútil — o gestor clica, o número não muda (porque já estava fresco) e
 * ele não tem como saber se funcionou ou se o sistema travou. A idade é o que
 * dá sentido ao clique, nos dois casos: quando muda e quando não muda.
 *
 * ⚠️ A IDADE É DO DADO, NÃO DO NAVEGADOR — e isso corrigiu uma mentira.
 *
 * A versão anterior marcava o instante em que o NAVEGADOR terminou de buscar. O
 * servidor devolve o valor guardado e, vencida a validade, ainda o serve por até
 * 20× o TTL enquanto recalcula atrás (`server/cache.ts`). Resultado: a
 * Produtividade podia chegar com 3 h de idade e o topo dizia "agora há pouco".
 * Agora a idade é a de `meta.geradoEm` de cada indicador da tela, e vale a do
 * MAIS VELHO — é ele que limita o quanto a tela inteira está em dia.
 *
 * O PONTO: verde é em dia; dourado é dado com mais de `VELHO_MS` (passou de
 * todas as validades do servidor, então algo não está renovando); vermelho é
 * consulta com erro na tela.
 *
 * PROTEÇÕES DO BOTÃO:
 * - desabilitado enquanto qualquer consulta estiver correndo, para o clique
 *   repetido não empilhar requisição (o single-flight do servidor já protege a
 *   réplica, mas o botão não pode PARECER que não fez nada);
 * - o refetch força `atualizar=1`, que ignora o cache do servidor E manda
 *   `no-store` ao navegador — sem isso o botão devolveria a cópia local.
 */

/** A maior validade de cache do servidor é 30 min; passou disso, está velho. */
const VELHO_MS = 30 * 60_000

type Situacao = { maisVelho: number | null; falhou: boolean }

/** Lê as consultas ATIVAS (as que a tela está mostrando) no cache do cliente. */
function situacaoDaTela(qc: QueryClient): Situacao {
  let maisVelho: number | null = null
  let falhou = false
  for (const q of qc.getQueryCache().findAll({ type: 'active' })) {
    if (q.state.status === 'error') falhou = true
    const gerado = (q.state.data as { meta?: { geradoEm?: string } } | undefined)?.meta?.geradoEm
    const t = gerado ? Date.parse(gerado) : Number.NaN
    if (Number.isFinite(t) && (maisVelho === null || t < maisVelho)) maisVelho = t
  }
  return { maisVelho, falhou }
}

export function BotaoAtualizar() {
  const qc = useQueryClient()
  const carregandoReal = useIsFetching() > 0
  const [montado, setMontado] = useState(false)
  const [, envelhecer] = useState(0)

  useEffect(() => setMontado(true), [])

  // `useIsFetching()` lê o estado AO VIVO da query — ele pode genuinamente
  // divergir entre o HTML do servidor e a primeiríssima pintura do cliente,
  // porque o TanStack Query pode disparar um fetch durante a fase de render
  // do cliente, antes da hidratação terminar de conferir a árvore. Travar em
  // `false` até o efeito de montagem rodar garante que a primeira renderização
  // do cliente bata com a do servidor; a atualização para o valor real
  // acontece DEPOIS da hidratação, como qualquer mudança normal de estado.
  const carregando = montado && carregandoReal

  // o "há X min" precisa envelhecer sozinho na tela, senão congela no valor
  // do último render e mente para quem deixou a aba aberta
  useEffect(() => {
    const id = setInterval(() => envelhecer((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const atualizar = useCallback(() => {
    // abre a janela ANTES do refetch: o queryFn a lê para anexar `atualizar=1`
    marcarAtualizacaoForcada()
    void qc.refetchQueries({ type: 'active' })
  }, [qc])

  // Antes da montagem não há cache para ler — e o HTML do servidor tem de bater
  // com a primeira pintura do cliente.
  const { maisVelho, falhou } = montado ? situacaoDaTela(qc) : { maisVelho: null, falhou: false }

  const ponto = falhou
    ? 'error'
    : maisVelho !== null && Date.now() - maisVelho > VELHO_MS
      ? 'stale'
      : ''

  const rotulo = carregando ? 'atualizando…' : maisVelho !== null ? haQuanto(maisVelho) : '—'

  const dica = falhou
    ? 'Algum painel desta tela não carregou.'
    : maisVelho !== null
      ? `Dado mais antigo nesta tela: ${fmtInstante(maisVelho)}. Cada indicador fica guardado no servidor de 1 a 30 min.`
      : 'Esta tela não tem indicador para datar.'

  return (
    <div className="updated">
      <span className={`live-dot ${ponto}`} title={dica} aria-hidden="true" />
      <span className="quando" title={dica} aria-live="polite">
        {rotulo}
      </span>
      <button
        type="button"
        className="icon-btn"
        onClick={atualizar}
        disabled={carregando}
        aria-busy={carregando}
        title="Consulta o banco agora, ignorando o cache. Atualiza para todos."
      >
        <span className={carregando ? 'spin' : ''}>
          <Icone nome="atualizar" tamanho={15} />
        </span>
        <span className="sr-only">Atualizar</span>
      </button>
    </div>
  )
}
