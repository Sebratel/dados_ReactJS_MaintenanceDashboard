'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { filtrosParaQuery, parsearFiltros } from '@/lib/filtros'
import { useProtocolos } from '@/lib/useIndicador'
import {
  CONJUNTOS,
  colunasDe,
  valorCelula,
  type NomeConjunto,
} from '@/lib/colunasProtocolo'
import { fmtInt } from '@/lib/formato'
import { StatTile } from '@/components/kpi/StatTile'
import { Kpis } from '@/components/kpi/Kpis'
import { Icone } from '@/components/Icone'
import { Segmentado } from '@/components/Segmentado'

const POR_PAGINA = 100

/**
 * Os cortes de reincidência oferecidos na tela.
 *
 * As três janelas NÃO são mutuamente exclusivas: um preventivo que voltou em 12
 * dias e de novo em 40 aparece em `≤30d` E em `31–60d`. É proposital — a
 * pergunta que cada botão responde é "esta janela foi atingida?", não "qual foi
 * a primeira". A Manutenção pediu exatamente isso ao falar de mais de um retorno
 * no período.
 */
const REINCIDENCIA = [
  { id: undefined, rotulo: 'Todos', ajuda: 'Sem corte por reincidência' },
  { id: 'sim' as const, rotulo: 'Reincidiu', ajuda: 'Preventiva que voltou em até 90 dias, em qualquer janela' },
  { id: 'r30' as const, rotulo: '≤ 30d', ajuda: 'Voltou em até 30 dias — a mais grave' },
  { id: 'r60' as const, rotulo: '31–60d', ajuda: 'Voltou entre 31 e 60 dias' },
  { id: 'r90' as const, rotulo: '61–90d', ajuda: 'Voltou entre 61 e 90 dias' },
  { id: 'nao' as const, rotulo: 'Não reincidiu', ajuda: 'Preventiva que segurou os 90 dias' },
]

/**
 * CORTE POR RETORNO DE REPARO — o outro lado da moeda do corte acima.
 *
 * Reincidência recorta PREVENTIVA ("a preventiva segurou?"); retorno recorta
 * REPARO ("este reparo já é uma volta?"). São perguntas de abas diferentes e um
 * protocolo nunca é os dois, então as duas colunas jamais preenchem na mesma
 * linha.
 *
 * A faixa mede a distância até o atendimento ANTERIOR do mesmo login, e é
 * exatamente o conjunto que a aba Ofensores agrega por técnico. Era o que
 * faltava para sair de "383 reparos voltaram em agosto" e chegar em QUAIS.
 */
const RETORNO = [
  { id: undefined, rotulo: 'Todos', ajuda: 'Sem corte por retorno' },
  { id: 'sim' as const, rotulo: 'Voltou', ajuda: 'Reparo que veio depois de outro no mesmo login, em até 90 dias' },
  { id: 'v30' as const, rotulo: '≤ 30d', ajuda: 'Voltou em até 30 dias do atendimento anterior — a mais grave' },
  { id: 'v60' as const, rotulo: '31–60d', ajuda: 'Voltou entre 31 e 60 dias do atendimento anterior' },
  { id: 'v90' as const, rotulo: '61–90d', ajuda: 'Voltou entre 61 e 90 dias do atendimento anterior' },
  { id: 'nao' as const, rotulo: 'Não voltou', ajuda: 'Reparo sem atendimento anterior nos 90 dias' },
]

/**
 * Relatório analítico — a página onde o número vira lista.
 *
 * TRÊS DECISÕES DE INTERFACE QUE NÃO SÃO ESTÉTICAS:
 *
 * 1. CONJUNTO DE COLUNAS, não uma tabela de 38 colunas. Auditoria tem três
 *    perguntas diferentes ("bate com o Voalle?", "o cálculo está certo?", "qual
 *    ponto físico?") e cada uma quer colunas distintas. Uma tabela única
 *    obrigaria rolagem horizontal permanente atrás da coluna que interessa.
 * 2. BUSCA POR IDENTIFICADOR. O gesto real da auditoria é "esse protocolo aqui
 *    do Power BI, cadê ele?" — então a busca varre protocolo, contrato,
 *    etiqueta, login e CTO, e não o texto todo.
 * 3. EXPORTAÇÃO POR LINK, não por botão de JavaScript. O arquivo vem pronto do
 *    servidor com TODAS as linhas do recorte, não só as 100 da página — que é o
 *    erro clássico de "exportei e faltou dado".
 */
export function ProtocolosConteudo() {
  const sp = useSearchParams()
  const filtros = useMemo(() => parsearFiltros(Object.fromEntries(sp.entries())), [sp])

  const [conjunto, setConjunto] = useState<NomeConjunto>('voalle')
  const [pagina, setPagina] = useState(1)
  const [buscaBruta, setBuscaBruta] = useState('')
  const [busca, setBusca] = useState('')

  // debounce: sem ele cada tecla vira uma requisição e a paginação recalcula no
  // meio da digitação
  useEffect(() => {
    const id = setTimeout(() => setBusca(buscaBruta), 300)
    return () => clearTimeout(id)
  }, [buscaBruta])

  // mudar o recorte ou a busca invalida a página atual: a página 7 de um
  // resultado que agora tem 2 páginas mostraria vazio
  const chaveFiltros = filtrosParaQuery(filtros)
  useEffect(() => setPagina(1), [chaveFiltros, busca])

  const q = useProtocolos(filtros, { pagina, porPagina: POR_PAGINA, busca })
  const linhas = q.data?.data ?? []
  const meta = q.data?.meta
  const erro = q.error ? String(q.error.message) : null

  const colunas = colunasDe(conjunto)

  const router = useRouter()
  const pathname = usePathname()
  const aplicarCorte = (campo: 'reincidencia' | 'retorno', id: string | undefined) => {
    const q = new URLSearchParams(sp.toString())
    if (id) q.set(campo, id)
    else q.delete(campo)
    router.replace(`${pathname}?${q.toString()}`, { scroll: false })
  }

  const urlCsv = useMemo(() => {
    const p = new URLSearchParams(chaveFiltros)
    p.set('formato', 'csv')
    p.set('conjunto', conjunto)
    if (busca) p.set('busca', busca)
    return `/api/protocolos?${p.toString()}`
  }, [chaveFiltros, conjunto, busca])

  const inicio = meta ? (meta.pagina - 1) * meta.porPagina + 1 : 0
  const fim = meta ? Math.min(meta.total, meta.pagina * meta.porPagina) : 0

  return (
    <div className="pagina com-kpis">
      <p className="nota-tela" role="note">
        Esta é a <strong>lista nominal por trás dos números</strong> das outras páginas —
        mesmo universo, mesmos filtros, um protocolo por linha. O conjunto{' '}
        <strong>Voalle</strong> reproduz as colunas do export do ERP para conferência
        linha a linha; o conjunto <strong>Auditoria</strong> mostra os campos que o
        dashboard <em>calcula</em> (base, dupla, improdutivas, MTTR), que é onde uma
        divergência de fato aparece.
      </p>

      {/*
        UM CARD SÓ (30/10/2026). "Linhas exibidas", "Páginas" e "Tempo da
        consulta" eram cards e são números do SISTEMA, não da operação — foram
        para o rodapé da tabela. Esta é a lista de conferência, não um painel de
        indicador: novo card só se alguém pedir. Os logins distintos ficam no
        subtítulo para "protocolo ≠ login" estar à vista.
      */}
      <Kpis rotulo="Resumo do recorte">
        <div style={{ maxWidth: 380 }}>
          <StatTile
            rotulo="Protocolos no recorte"
            valor={q.isLoading ? '…' : fmtInt(meta?.totalRecorte)}
            contexto={[
              meta?.loginsDistintos !== undefined ? `${fmtInt(meta.loginsDistintos)} logins (PPPoE)` : null,
              meta && meta.excluidosTeste > 0
                ? `+${fmtInt(meta.excluidosTeste)} do cliente de teste, excluídos`
                : 'cliente de teste já excluído',
            ]
              .filter(Boolean)
              .join(' · ')}
            destaque
          />
        </div>
      </Kpis>

      {/* OS DOIS CORTES DE RECORRENCIA.
          Vivem aqui, e nao na barra global, porque so esta tela tem as colunas
          correspondentes -- nas outras seriam botoes que nao fazem nada, que e
          exatamente o defeito do item 30. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px]">
        <CorteRecorrencia
          rotulo="Reincidência da preventiva"
          aria="filtro de reincidência pós-preventiva"
          opcoes={REINCIDENCIA}
          valor={filtros.reincidencia ?? undefined}
          onChange={(id) => aplicarCorte('reincidencia', id)}
          nota={filtros.reincidencia ? 'só protocolos preventivos entram neste corte' : null}
        />
        <CorteRecorrencia
          rotulo="Retorno do reparo"
          aria="filtro de retorno de reparo"
          opcoes={RETORNO}
          valor={filtros.retorno ?? undefined}
          onChange={(id) => aplicarCorte('retorno', id)}
          contagens={meta?.retornoPorFaixa ?? null}
          /*
            PROTOCOLO, NÃO LOGIN. Em 23/10/2026 o ≤30d daqui (118) foi comparado
            com os "logins com retorno" da Recorrência (105) e pareceu
            divergência: lá cada login conta uma vez por mês, aqui cada
            protocolo conta. A nota diz isso e aponta onde está a outra régua.
          */
          nota={
            filtros.retorno
              ? 'só protocolos de reparo entram neste corte, e a contagem é por protocolo, não por login (PPPoE): o mesmo login pode aparecer mais de uma vez. Para ver quantos logins voltaram, use a aba Recorrência.'
              : null
          }
        />
      </div>

      {/* A grade ocupa a área útil (`v-cheia`) e rola por dentro: com 100
          linhas por página, deixá-la crescer empurraria a paginação e as
          ressalvas do rodapé para fora da tela. */}
      <section className="visual v-cheia" aria-label="Protocolos">
        <div className="visual-cab">
          <h2>Protocolos</h2>
          <div className="acoes">
            <label>
              <span className="sr-only">Buscar</span>
              <input
                type="search"
                value={buscaBruta}
                onChange={(e) => setBuscaBruta(e.target.value)}
                placeholder="protocolo, contrato, etiqueta, login, CTO…"
                className="busca-cab"
              />
            </label>

            <Segmentado
              rotulo="conjunto de colunas"
              valor={conjunto}
              aoMudar={setConjunto}
              opcoes={(Object.keys(CONJUNTOS) as NomeConjunto[]).map((k) => ({
                valor: k,
                rotulo: CONJUNTOS[k].rotulo,
                dica: CONJUNTOS[k].ajuda,
              }))}
            />

            <a
              href={urlCsv}
              className="btn-cab"
              title="Baixa TODAS as linhas do recorte (não só a página), com o rodapé de filtros"
            >
              <Icone nome="baixar" tamanho={11} />
              Exportar CSV
            </a>
          </div>
        </div>

        <div className="visual-corpo">

        {erro ? (
          <div className="estado erro" role="alert">
            <span className="linha">
              <Icone nome="alerta" tamanho={14} />
              {erro}
            </span>
          </div>
        ) : q.isLoading ? (
          <div className="estado" role="status">
            <div className="carregando-barra" />
            montando o relatório… (a primeira carga do recorte consulta o ERP)
          </div>
        ) : linhas.length === 0 ? (
          <div className="estado">nenhum protocolo neste recorte</div>
        ) : (
          <div className="tabela-caixa">
            <table className="tabela" style={{ minWidth: 'max-content', fontSize: 11 }}>
              <thead>
                <tr>
                  {colunas.map((c) => (
                    <th
                      key={c.chave}
                      scope="col"
                      className={c.alinhar === 'dir' ? '' : 'texto'}
                      style={{ minWidth: c.largura }}
                    >
                      {c.rotulo}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.protocolo}>
                    {colunas.map((c) => {
                      const v = valorCelula(l, c.chave)
                      return (
                        <td
                          key={c.chave}
                          title={typeof v === 'string' && v.length > 24 ? v : undefined}
                          className={`max-w-[320px] truncate ${c.alinhar === 'dir' ? '' : 'texto'}`}
                          style={{ whiteSpace: 'nowrap' }}
                        >
                          {v === '' ? (
                            <span className="text-[var(--text-muted)]">—</span>
                          ) : (
                            v
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </div>

        <footer className="visual-nota flex flex-wrap items-center gap-3">
          {meta && meta.total > 0 && (
            <span className="tabular-nums">
              {fmtInt(inicio)}–{fmtInt(fim)} de {fmtInt(meta.total)}
            </span>
          )}
          {/* os números de sistema que eram cards (até 30/10/2026) */}
          {meta && (
            <span className="tabular-nums text-[var(--text-muted)]">
              {fmtInt(meta.total)} linhas{busca ? ` (busca “${busca}”)` : ''} · {fmtInt(meta.paginas)}{' '}
              {meta.paginas === 1 ? 'página' : 'páginas'} de {POR_PAGINA} · consulta em{' '}
              {(meta.ms / 1000).toFixed(1).replace('.', ',')} s ·{' '}
              {meta.cache === 'hit'
                ? 'do cache do servidor'
                : meta.cache === 'stale'
                  ? 'cache vencido, atualizando'
                  : 'consultado no ERP agora'}
            </span>
          )}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPagina((n) => Math.max(1, n - 1))}
              disabled={!meta || meta.pagina <= 1}
              className="rounded border px-2 py-0.5 transition-colors enabled:hover:text-[var(--text-primary)] disabled:opacity-40"
              style={{ borderColor: 'var(--border)' }}
            >
              ‹ anterior
            </button>
            <button
              type="button"
              onClick={() => setPagina((n) => n + 1)}
              disabled={!meta || meta.pagina >= meta.paginas}
              className="rounded border px-2 py-0.5 transition-colors enabled:hover:text-[var(--text-primary)] disabled:opacity-40"
              style={{ borderColor: 'var(--border)' }}
            >
              próxima ›
            </button>
          </div>

          {meta?.truncado && (
            <span
              className="inline-flex items-center gap-1"
              style={{ color: 'var(--status-warning)' }}
            >
              <Icone nome="alerta" tamanho={12} />
              recorte maior que o teto de {fmtInt(meta.limite)} linhas — a lista está
              cortada nas mais recentes. Reduza o período para auditar tudo.
            </span>
          )}

          {/*
            Duas ressalvas, e as duas existem para evitar um chamado de defeito
            que não é defeito. A do grão é a mais importante: é a primeira conta
            que alguém tenta fechar contra a tela de Produtividade.
          */}
          <span className="ml-auto max-w-[64ch] text-right">
            <strong>Auxiliar</strong> tem três estados: um <em>nome</em> (houve dupla),{' '}
            <strong>SEM AUXILIAR</strong> (o técnico declarou que foi sozinho — é o que
            o Voalle mostra na perna RAUX) e <em>vazio</em> (ninguém registrou nada).{' '}
            Grão aqui é o <strong>protocolo</strong>; em Produtividade é{' '}
            <strong>protocolo × dia agendado</strong> — somar “Improd.” não reproduz
            aquela tela, e não é divergência. <strong>Executor</strong> é quem{' '}
            <em>fechou</em>; quando o protocolo teve mais de uma visita, os outros nomes
            estão em <strong>Técnicos que foram</strong> — e a improdutiva de uma visita
            perdida pertence a quem foi naquele dia, não ao executor.{' '}
            <strong>Responsável (ERP)</strong> é o campo cru do Voalle, que vira o
            backoffice a cada reagendamento. <strong>Agend.</strong> conta horários
            distintos que a agenda preservou: um reagendamento cujo horário anterior foi
            sobrescrito não aparece. Slot/Porta são os reais do serviço, não a
            configuração da OLT que o Voalle exporta.
          </span>
        </footer>
      </section>
    </div>
  )
}

/**
 * Uma fileira de botões de corte. Existe porque os dois cortes têm a MESMA
 * mecânica e rótulos diferentes — duplicar o markup deixaria os dois divergindo
 * no primeiro ajuste de estilo.
 */
function CorteRecorrencia({
  rotulo,
  aria,
  opcoes,
  valor,
  onChange,
  nota,
  contagens,
}: {
  rotulo: string
  aria: string
  opcoes: { id?: string; rotulo: string; ajuda: string }[]
  valor: string | undefined
  onChange: (id: string | undefined) => void
  nota: string | null
  /**
   * Quantos protocolos cada botão devolveria, por id. Só aparece com o corte em
   * "Todos": com uma faixa escolhida a lista já está recortada, e as outras
   * faixas mostrariam 0 — que leria como "não existe", e não é.
   */
  contagens?: Record<string, number> | null
}) {
  const mostrarContagem = valor === undefined && !!contagens
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={aria}>
      <span className="text-[var(--text-muted)]">{rotulo}</span>
      {/* fora da barra vinho, em fundo claro: a mesma peça `.seg` do card */}
      <div className="seg claro">
        {opcoes.map((o) => (
          <button
            key={o.id ?? 'todos'}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={valor === o.id}
            title={o.ajuda}
          >
            {o.rotulo}
            {mostrarContagem && o.id && contagens![o.id] !== undefined && (
              <span className="tabular-nums" style={{ opacity: 0.7 }}>
                {' '}({fmtInt(contagens![o.id])})
              </span>
            )}
          </button>
        ))}
      </div>
      {nota && <span className="text-[var(--text-muted)]">{nota}</span>}
    </div>
  )
}
