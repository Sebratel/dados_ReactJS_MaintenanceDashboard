'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback, useEffect, useMemo } from 'react'
import { CATALOGOS_MANUTENCAO, STATUS_CANCELADO, TIPOS_PREVENTIVOS } from '@/config/regras-negocio'
import { EIXOS_DATA, GRANULARIDADES, parsearFiltros, presetsPeriodo, type Filtros } from '@/lib/filtros'
import { useOpcoesFiltro } from '@/lib/useIndicador'
import { useAlturaComoVariavel } from '@/lib/useAlturaComoVariavel'
import { telaTemFiltros } from '@/config/telas'
import { Icone } from '@/components/Icone'
import { Segmentado } from '@/components/Segmentado'
import { SeletorLista } from './SeletorLista'
import { SeletorPeriodo } from './SeletorPeriodo'

const CAMPOS_MULTI = [
  // Base primeiro de propósito: é o corte de supervisão, o mais usado.
  { chave: 'base', label: 'Base' },
  { chave: 'cidade', label: 'Cidade' },
  { chave: 'bairro', label: 'Bairro' },
  { chave: 'equipe', label: 'Equipe' },
  { chave: 'catalogo', label: 'Catálogo' },
  { chave: 'tipo', label: 'Tipo' },
  { chave: 'status', label: 'Status' },
  { chave: 'categoria2', label: 'Categoria 2' },
  { chave: 'tecnico', label: 'Técnico' },
] as const

export function BarraFiltros() {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const filtros = useMemo(() => parsearFiltros(Object.fromEntries(sp.entries())), [sp])
  const { data: opcoes } = useOpcoesFiltro(filtros)
  // a altura real da barra entra na conta da área útil (ver o hook)
  const medirBarra = useAlturaComoVariavel('--h-filtros', 'raiz')

  const aplicar = useCallback(
    (patch: Partial<Record<string, string | string[] | undefined>>) => {
      const q = new URLSearchParams(sp.toString())
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || (Array.isArray(v) && v.length === 0)) q.delete(k)
        else q.set(k, Array.isArray(v) ? v.join('~') : v)
      }
      router.replace(`${pathname}?${q.toString()}`, { scroll: false })
    },
    [pathname, router, sp]
  )

  const presets = useMemo(() => presetsPeriodo(), [])
  const temFiltroDim = CAMPOS_MULTI.some((c) => filtros[c.chave]?.length)
  const eixoGovernaTela = pathname !== '/tempos'

  /**
   * ⚠️ STATUS NÃO VALE NA PRODUTIVIDADE — e o controle fica à vista, inerte.
   *
   * Aquela página conta VISITA, não DEMANDA: a ida aconteceu mesmo que o
   * protocolo tenha sido cancelado depois (decisão da Manutenção, 03/09/2026).
   * Como `status` é filtro global, quem vinha de Tempos ou Preventivos chegava
   * lá com Cancelado excluído e a página contrariava a própria regra calada —
   * eram 67 visitas em setembro/2026, a diferença inteira contra o Power BI.
   *
   * ESCONDER O CONTROLE SERIA PIOR, E UM RÓTULO MORTO TAMBÉM. Quem acabou de
   * selecionar um status na aba anterior veria o filtro sumir e concluiria que
   * foi aplicado; e um rótulo apagado dizendo "não se aplica" obriga a acreditar
   * na tarja sem poder conferir. Foi o que a Manutenção recusou em 15/10/2026:
   *
   *   "deixar visual o filtro mas inativo... o usuário ia ver que Cancelado,
   *    por exemplo, está flegado por regra"
   *
   * Então o controle ABRE normalmente e mostra a lista inteira TODA MARCADA, em
   * linhas inertes (`span`, não `button`). A pessoa vê com os próprios olhos que
   * Cancelado está incluído, e por quê — a nota no rodapé do dropdown explica.
   * A seleção que ela fez segue na URL e volta a valer na próxima aba.
   *
   * Difere do `eixo da data` em /tempos de propósito: lá o controle vira um
   * rótulo fixo porque não há lista nenhuma para mostrar.
   */
  const statusGovernaTela = pathname !== '/produtividade'

  /**
   * A tela de Preventivos só sabe filtrar ENTRE preventivas.
   *
   * Oferecer os outros tipos ali era um botao que nao faz nada: a pessoa
   * escolhia 'TEC-MANUT-ACESSO-CLI-REQUISICAO', a tela nao mudava, e a
   * conclusao natural e que o dashboard esta quebrado. Reportado pela
   * Manutencao em 28/08/2026.
   *
   * Restringir a LISTA e melhor que desabilitar o filtro: entre os dois tipos
   * preventivos a comparacao e util (PREVENCAO/PROBLEMA x PREVENCAO/RECORRENTE)
   * e agora funciona de verdade (ver preventivos.ts).
   */
  const tiposPermitidos: readonly string[] | null =
    pathname === '/preventivos' ? TIPOS_PREVENTIVOS : null

  /**
   * O MESMO, PARA CATÁLOGO — e pela mesma razão exata.
   *
   * O combo listava os oito catálogos que existem na base (Suporte 24h, Suporte
   * 72h, Suporte Tecnico, Equipe ativação…), mas o universo de Preventivos só
   * contém os quatro de manutenção. Enquanto o filtro era ignorado pelo backend
   * isso não aparecia: escolher "Suporte (24 Horas)" devolvia as 5.459
   * preventivas do recorte inteiro. Com o filtro funcionando (17/09/2026), a
   * mesma escolha zeraria a tela em silêncio — quatro das oito opções.
   */
  const catalogosPermitidos: readonly string[] | null =
    pathname === '/preventivos' ? CATALOGOS_MANUTENCAO : null

  /**
   * SANEAMENTO DA URL, não só da lista exibida.
   *
   * O filtro acima (`tiposPermitidos`) só tira as opções erradas do combo —
   * não limpa um `tipo` que a URL já trouxe de outra tela (troca de aba,
   * link direto, URL colada à mão). Sem isto, um `tipo=...INCIDENTE/PROBLEMA`
   * vindo de Recorrência chega a Preventivos, nunca bate com nenhuma
   * preventiva, e a tela inteira mostra zero em silêncio — sem erro, igual a
   * "não há preventiva no período". Achado em 09/09/2026 pela Manutenção.
   * O backend (`preventivos.ts`) já ignora tipo inválido por defesa, mas a
   * barra precisa refletir isso na URL, senão o combo mente "2 selec.".
   */
  useEffect(() => {
    // Um patch só, e não uma chamada por campo: `aplicar` monta a URL a partir
    // do `sp` desta renderização, então duas chamadas seguidas fariam a segunda
    // sobrescrever a primeira — a poda de um dos dois campos se perderia.
    const patch: Record<string, string[]> = {}
    const podar = (chave: 'tipo' | 'catalogo', permitidos: readonly string[] | null) => {
      const atual = filtros[chave]
      if (!permitidos || !atual?.length) return
      const valido = atual.filter((v) => permitidos.includes(v))
      if (valido.length !== atual.length) patch[chave] = valido
    }
    podar('tipo', tiposPermitidos)
    podar('catalogo', catalogosPermitidos)
    if (Object.keys(patch).length) aplicar(patch)
  }, [tiposPermitidos, catalogosPermitidos, filtros.tipo, filtros.catalogo, aplicar])

  /**
   * A BARRA SÓ EXISTE NAS TELAS DE DADOS, E QUEM DECIDE É ESTE COMPONENTE.
   *
   * Antes a decisão ficava no `(dashboard)/layout.tsx`, que envolvia a barra num
   * `{!ehConfiguracoes && …}`. A regra estava certa; o valor é que não chegava.
   * `ehConfiguracoes` vem do cabeçalho `x-caminho`, posto pelo middleware — e o
   * App Router REAPROVEITA o layout compartilhado quando só a página muda, então
   * ele ficava com o caminho da tela ANTERIOR. Os dois sintomas, medidos em
   * 14/09/2026 e reproduzíveis por qualquer um:
   *
   *   Preventivos --(menu)--> Configurações : barra aparecia onde não filtra nada
   *   Configurações --(menu)--> Tempos      : barra SUMIA de uma tela de trabalho
   *
   * O segundo é o grave: sem filtro, a tela de Tempos não serve para nada, e
   * nada na tela sugere que recarregar resolve. `export const dynamic =
   * 'force-dynamic'` não cobre isso — ele garante render por requisição, não que
   * o roteador peça o layout de novo.
   *
   * Aqui o problema não existe: `usePathname()` é do roteador do cliente e
   * acompanha a navegação. O componente já o usava para outra coisa.
   *
   * ⚠️ ISTO CORRIGE O SINTOMA DA BARRA, NÃO A CAUSA. O mesmo `caminho` congelado
   * decide o `permitido` do layout — ver item Z de docs/06. Com a barra
   * consertada o sinal visível some e a causa continua; tratar lá é o que fecha.
   *
   * O teste é o CATÁLOGO e não uma lista de rotas proibidas: `telaTemFiltros`
   * conhece as telas de dados, e `/configuracoes` está fora dele por desenho
   * (ver `config/telas.ts`). Assim, rota nova que não seja tela de dados nasce
   * sem a barra por omissão, em vez de esperar que alguém lembre de listá-la.
   * Tela de dados que não obedece aos filtros (Predições) declara
   * `semFiltros` no catálogo.
   */
  if (!telaTemFiltros(pathname)) return null

  return (
    /*
     * A barra da casca Sebratel: uma linha grudada abaixo da navegação, cada
     * filtro um botão compacto que abre o seletor. ~50px no lugar dos ~125px de
     * cartões de slicer — numa tela em que a altura é o recurso escasso, a
     * diferença é uma faixa de gráfico.
     */
    <div className="filtros-moldura" ref={medirBarra}>
      <div className="filtros" role="toolbar" aria-label="Filtros">
        <span className="rotulo">Filtros</span>

        <SeletorPeriodo
          de={filtros.de}
          ate={filtros.ate}
          presets={presets}
          aoAplicar={(p) => aplicar(p)}
        />

        {/* ── eixo da data: o filtro que o Power BI escondia em USERELATIONSHIP ──
            Some na tela de Tempos, onde não governa nada: lá os dois eixos são
            fixos por definição do indicador (desempenho pelo encerramento,
            capacidade pela abertura). Deixá-lo clicável e inerte seria pior que
            não tê-lo — a pessoa trocaria, nada mudaria, e a conclusão natural
            seria que a tela está quebrada. */}
        <span className="grupo-rotulo">Eixo</span>
        {eixoGovernaTela ? (
          <Segmentado
            claro
            rotulo="Eixo da data"
            valor={filtros.eixo}
            aoMudar={(v) => aplicar({ eixo: v })}
            opcoes={Object.entries(EIXOS_DATA).map(([k, v]) => ({
              valor: k as Filtros['eixo'],
              rotulo: v.label,
            }))}
          />
        ) : (
          <span
            className="filtro-fixo"
            title="Nesta tela o eixo é fixo: desempenho (MTTR/MTTA) conta pelo encerramento, capacidade (mapa de calor) conta pela abertura. Os demais filtros valem normalmente."
          >
            fixo por indicador
          </span>
        )}

        {/* sem rótulo de grupo: "Dia / Semana / Mês" se explica sozinho, e os
            ~45px economizados são o que faz a barra caber numa linha em 1440 */}
        <Segmentado
          claro
          rotulo="Granularidade"
          valor={filtros.granularidade}
          aoMudar={(v) => aplicar({ granularidade: v })}
          opcoes={Object.entries(GRANULARIDADES).map(([k, v]) => ({
            valor: k as Filtros['granularidade'],
            rotulo: v.label,
          }))}
        />

        <span className="divisor" aria-hidden="true" />

        {/* ── filtros de dimensão ── */}
        {CAMPOS_MULTI.map((c, i) => {
          let lista: readonly string[] = opcoes?.[c.chave] ?? []
          if (c.chave === 'tipo' && tiposPermitidos)
            lista = lista.filter((v) => tiposPermitidos.includes(v))
          if (c.chave === 'catalogo' && catalogosPermitidos)
            lista = lista.filter((v) => catalogosPermitidos.includes(v))
          const inerte =
            c.chave === 'status' && !statusGovernaTela ? (
              <>
                Todos contam <strong>por regra</strong>, Cancelado inclusive: esta tela mede{' '}
                <strong>visita</strong>, e a ida ao cliente aconteceu mesmo que o protocolo tenha
                morrido depois. Por isso o filtro não se aplica aqui — a seleção que você fez
                continua valendo nas outras abas.
              </>
            ) : undefined
          return (
            <SeletorLista
              key={c.chave}
              rotulo={c.label}
              opcoes={lista}
              selecionados={filtros[c.chave] ?? []}
              aoAplicar={(v) => aplicar({ [c.chave]: v })}
              inerte={inerte}
              direita={i >= CAMPOS_MULTI.length - 3}
            />
          )
        })}

        {temFiltroDim && (
          <button
            type="button"
            className="limpar"
            onClick={() =>
              aplicar(Object.fromEntries(CAMPOS_MULTI.map((c) => [c.chave, undefined])))
            }
          >
            <Icone nome="fechar" tamanho={12} /> Limpar filtros
          </button>
        )}
      </div>

      {/*
        AVISO DE CANCELADO. Não é decoração: cancelado sai do universo por
        padrão, então pedir por ele muda o significado das medidas em vez de só
        encolher o recorte. Encerramento vai a 0%, MTTR passa a medir "quanto
        tempo até desistirem" (32h em julho contra 17h do normal) e o volume
        deixa de ser demanda. Sem esta linha, os três números parecem defeito.
      */}
      {filtros.status?.includes(STATUS_CANCELADO) && (
        <div className="aviso aviso-faixa" role="note">
          <Icone nome="alerta" tamanho={13} />
          <span>
            <strong>Cancelados incluídos.</strong> Eles ficam fora do universo por
            padrão porque não são demanda real — aqui, taxa de encerramento vai a 0% e
            o MTTR mede tempo até o cancelamento, não até o reparo. Vale para auditar
            visita perdida: parte deles teve deslocamento e improdutiva antes de morrer.{' '}
            <strong>Produtividade não muda</strong> — ela sempre contou essas visitas.
          </span>
        </div>
      )}
    </div>
  )
}
