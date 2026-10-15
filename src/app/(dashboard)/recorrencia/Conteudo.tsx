'use client'

import { useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CLASSE_REC_POR_CODIGO, parsearFiltros, type CodigoClasseRec } from '@/lib/filtros'
import { useRecorrencia } from '@/lib/useIndicador'
import { Painel } from '@/components/Painel'
import { StatTile } from '@/components/kpi/StatTile'
import { RankingSimples } from '@/components/charts/RankingSimples'
import { fmtFracaoPct, fmtInt } from '@/lib/formato'

/**
 * ESTA TELA FALA DE RECORRÊNCIA, E SÓ DELA — decisão da Manutenção em
 * 15/10/2026, durante o batimento de setembro contra o Power BI.
 *
 * Antes a página mostrava as duas medidas lado a lado: reincidência (voltou em
 * ALGUMA das janelas) e recorrência (voltou em TODAS). São perguntas
 * diferentes, e misturá-las numa tela só custava caro na leitura — o cartão em
 * destaque era o de reincidência, os dois painéis de dimensão ranqueavam por
 * reincidência, e a evolução mensal plotava reincidentes. Quem abria a aba
 * "Recorrência" via, em primeiro plano, outro indicador.
 *
 * ⚠️ O CÁLCULO DE REINCIDÊNCIA CONTINUA INTEIRO NO BACKEND, de propósito:
 * `taxaReincidencia`, `pctReincidente30/60/90` e `porClasseReincidencia` seguem
 * sendo calculados e devolvidos pela API — só não são desenhados aqui. Foi o
 * pedido explícito: *"guarde os dados para uso no futuro, mas não vamos
 * apresentar aqui"*. Apagar o cálculo tornaria a volta atrás um trabalho de
 * reconstrução; mantê-lo é não desenhar.
 *
 * Quem quiser reincidência tem a tela de Preventivos (reincidência pós-ação
 * preventiva) e a de Ofensores (retorno por técnico).
 */
export function RecorrenciaConteudo() {
  const sp = useSearchParams()
  const router = useRouter()
  const filtros = useMemo(() => parsearFiltros(Object.fromEntries(sp.entries())), [sp])

  /**
   * CROSS-FILTER: clicar numa barra escreve o filtro NA URL, não num estado
   * local do React.
   *
   * Pedido da Manutencao em 15/10/2026 -- "ao selecionar Canoas, so os
   * recorrentes, bairros e catalogo de Canoas". Isso exige que o SERVIDOR
   * reagregue: nao da para derivar "os bairros de Canoas" a partir dos totais
   * por bairro que ja vieram somados de todas as cidades.
   *
   * Indo para a URL, tres coisas saem de graca: a barra de filtros no topo
   * mostra o recorte ativo e sabe limpa-lo, o botao voltar do navegador desfaz,
   * e o link copiado leva o colega para a mesma tela. Um `useState` daria o
   * filtro visual e nenhuma das tres.
   *
   * Clicar de novo no mesmo rotulo desliga -- e o que a barra ja faz, e e o que
   * se espera de um recorte aplicado por clique.
   */
  const alternar = useCallback(
    (chave: 'cidade' | 'bairro' | 'catalogo' | 'classeRec', valor: string) => {
      const q = new URLSearchParams(sp.toString())
      if (q.get(chave) === valor) q.delete(chave)
      else q.set(chave, valor)
      router.replace(`/recorrencia?${q.toString()}`, { scroll: false })
    },
    [router, sp]
  )

  /**
   * So destaca quando o recorte e de UM valor. Com dois ou mais -- possivel
   * pela barra de filtros, que e multissselecao -- esmaecer "todos menos um"
   * mentiria sobre o que esta aplicado; ai nenhum fica em foco e as barras ja
   * mostram apenas o que sobrou.
   */
  const emFoco = (chave: 'cidade' | 'bairro' | 'catalogo') => {
    const v = filtros[chave]
    return v?.length === 1 ? v[0]! : null
  }

  /** rótulo da classe em recorte, ou null — o painel é o próprio controle */
  const classeEmFoco = filtros.classeRec
    ? CLASSE_REC_POR_CODIGO[filtros.classeRec]
    : null
  const codigoDaClasse = (rotulo: string): CodigoClasseRec | undefined =>
    (Object.keys(CLASSE_REC_POR_CODIGO) as CodigoClasseRec[]).find(
      (k) => CLASSE_REC_POR_CODIGO[k] === rotulo
    )

  const q = useRecorrencia(filtros)
  const d = q.data?.data
  const t = d?.total
  const erro = q.error ? String(q.error.message) : null

  /**
   * ⚠️ TODO CAMPO DE `d` É LIDO COM `?? []`, mesmo os que "sempre existem".
   *
   * `d && (...)` garante que a resposta chegou, não que ela tem o formato de
   * hoje. Em 15/10/2026, ao acrescentar `porBairro`, a tela quebrou inteira com
   * "d.porBairro is not iterable": o componente já era o novo, mas a resposta
   * vinha do CACHE DE INDICADOR, gravada antes da mudança e sem o campo.
   *
   * O mesmo acontece em qualquer janela entre o deploy do servidor e a
   * expiração do cache, e também se alguém abrir a aba com o bundle novo contra
   * um servidor ainda antigo. O custo de errar é desproporcional: um campo
   * ausente derrubava a PÁGINA TODA, inclusive os painéis que tinham dados.
   *
   * Com o `?? []`, o painel novo nasce vazio e o resto da tela continua de pé —
   * mesma escolha de degradação já feita no controle de acesso, que fica
   * inativo em vez de derrubar o dashboard.
   */

  /** Saúde da ponte do PPPoE — se muitos protocolos caem no fallback, a chave
   *  por login perde precisão e o número muda de significado. */
  const semLogin = q.data?.meta.protocolosSemLogin ?? 0
  const noUniverso = q.data?.meta.protocolosNoUniverso ?? 0

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
      <p
        className="rounded-md border px-3 py-2 text-xs text-[var(--text-secondary)]"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
        role="note"
      >
        <strong>Recorrente</strong> = o login voltou a abrir chamado em{' '}
        <strong>até 30 dias</strong>. Isso vale para os três baldes; o que muda
        entre eles é <em>quantas janelas consecutivas</em> tiveram retorno —{' '}
        <em>Recorrente 30</em> voltou só na janela recente, <em>60</em> voltou
        também entre 31 e 60 dias, e <em>90</em> voltou nas três. Quanto mais
        janelas, mais crônico. Preventivas nunca contam, nem como chamado atual
        nem como anterior.{' '}
        A unidade é <strong>login-mês</strong>: a chave é o{' '}
        <strong>login PPPoE</strong>, não o cliente — um cliente corporativo com
        vários logins em cidades diferentes não vira recorrente por isso. Cada
        login entra uma vez por mês, pelo seu último protocolo não preventivo.
      </p>

      <section
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}
        aria-label="Indicadores de recorrência"
      >
        <StatTile
          rotulo="Taxa de recorrência"
          valor={q.isLoading ? '…' : fmtFracaoPct(t?.taxaRecorrencia, 1)}
          contexto={
            t ? `${fmtInt(t.recorrentes)} de ${fmtInt(t.clientesBase)} logins` : undefined
          }
          subirEhRuim
          destaque
        />
        {/*
          ⚠️ "voltaram em todas as janelas" estava AQUI e era FALSO para 114 dos
          125 — a Manutenção pegou em 15/10/2026: *"dá a entender que os 125
          estão em 30, 60 e 90 dias e isso não é real"*. Só a classe Recorrente
          90 cumpre as três; em setembro/2026 ela tem UM login. O que os 125
          têm em comum é o piso: todos voltaram em até 30 dias.
        */}
        <StatTile
          rotulo="Logins com retorno"
          valor={q.isLoading ? '…' : fmtInt(t?.recorrentes)}
          contexto="voltaram a abrir em até 30 dias"
          subirEhRuim
        />
        <StatTile
          rotulo="Reparos-mês"
          valor={q.isLoading ? '…' : fmtInt(t?.clientesBase)}
          contexto="último protocolo não preventivo de cada login"
        />
        {/*
          Os três abaixo são EXCLUSIVOS entre si e somam a taxa de recorrência
          acima — não são "quantos voltaram em 30 dias", que seria o acumulado.
          Ver a descrição do painel de classificação.
        */}
        <StatTile
          rotulo="Recorrente 30 d"
          valor={q.isLoading ? '…' : fmtFracaoPct(t?.pctRecorrente30, 1)}
          contexto="voltou só na janela de 30 dias"
          subirEhRuim
        />
        <StatTile
          rotulo="Recorrente 60 d"
          valor={q.isLoading ? '…' : fmtFracaoPct(t?.pctRecorrente60, 1)}
          contexto="voltou em 30 e também em 60"
          subirEhRuim
        />
        <StatTile
          rotulo="Recorrente 90 d"
          valor={q.isLoading ? '…' : fmtFracaoPct(t?.pctRecorrente90, 1)}
          contexto="voltou nas três janelas — o mais grave"
          subirEhRuim
        />
      </section>

      <Painel
        titulo="Classificação de recorrência"
        descricao="Todas voltaram em até 30 dias. A classe diz até que janela a volta se repetiu — são exclusivas entre si."
        carregando={q.isLoading}
        erro={erro}
        nota={
          classeEmFoco ? (
            <>
              Recorte ativo: <strong>{classeEmFoco}</strong> — cidade, bairro e
              catálogo abaixo mostram só estes. Clique na mesma barra para
              remover.
            </>
          ) : q.data ? (
            `Exclui os protocolos com categoria 5 = “Solucao Interna” · consulta em ${fmtInt(q.data.meta.ms)} ms`
          ) : (
            'Exclui os protocolos com categoria 5 = “Solucao Interna”'
          )
        }
        tabela={{
          colunas: [
            { chave: 'classe', rotulo: 'Classe' },
            { chave: 'clientes', rotulo: 'Reparos-mês', alinhar: 'dir' },
            { chave: 'share', rotulo: 'Share', alinhar: 'dir' },
          ],
          linhas: (d?.porClasseRecorrencia ?? []).map((x) => ({
            classe: x.classe,
            clientes: fmtInt(x.clientes),
            share: fmtFracaoPct(x.share, 1),
          })),
        }}
      >
        {d && (
          <RankingSimples
            dados={(d.porClasseRecorrencia ?? []).map((x) => ({
              rotulo: x.classe,
              valor: x.clientes,
              share: x.share,
              // "Não recorrente" é ausência de evento, não um passo da escala
              neutro: x.classe === 'Não recorrente',
            }))}
            unidade="reparos-mês"
            escala="ordinal"
            altura={150}
            aoClicar={(r) => {
              const cod = codigoDaClasse(r)
              if (cod) alternar('classeRec', cod)
            }}
            selecionado={classeEmFoco}
          />
        )}
      </Painel>

      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}
      >
        <Painel
          titulo="Recorrência por cidade"
          descricao="Barra = logins crônicos. O tooltip traz o volume e a taxa."
          carregando={q.isLoading}
          erro={erro}
          tabela={{
            colunas: [
              { chave: 'cidade', rotulo: 'Cidade' },
              { chave: 'clientes', rotulo: 'Reparos-mês', alinhar: 'dir' },
              { chave: 'rec', rotulo: 'Recorrentes', alinhar: 'dir' },
              { chave: 'taxaRec', rotulo: 'Taxa recor.', alinhar: 'dir' },
            ],
            linhas: (d?.porCidade ?? []).map((x) => ({
              cidade: x.rotulo,
              clientes: fmtInt(x.clientes),
              rec: fmtInt(x.recorrentes),
              taxaRec: fmtFracaoPct(x.taxaRecorrencia, 1),
            })),
          }}
        >
          {d && (
            <RankingSimples
              dados={[...(d.porCidade ?? [])]
                .sort((a, b) => b.recorrentes - a.recorrentes)
                .slice(0, 10)
                .map((x) => ({
                  rotulo: x.rotulo,
                  valor: x.recorrentes,
                  detalhe: `${fmtInt(x.clientes)} reparos-mês · taxa ${fmtFracaoPct(x.taxaRecorrencia, 1)}`,
                }))}
              unidade="logins recorrentes"
              aoClicar={(r) => alternar('cidade', r)}
              selecionado={emFoco('cidade')}
            />
          )}
        </Painel>

        <Painel
          titulo="Recorrência por catálogo"
          descricao="Barra = logins crônicos. Reparo × Tecnologia."
          carregando={q.isLoading}
          erro={erro}
          nota={
            noUniverso > 0 ? (
              <>
                Ponte do PPPoE:{' '}
                <strong>
                  {fmtInt(noUniverso - semLogin)} de {fmtInt(noUniverso)}
                </strong>{' '}
                protocolos resolveram para um login
                {semLogin > 0 && (
                  <>
                    ; os {fmtInt(semLogin)} restantes (serviço sem PPPoE) foram
                    agrupados pelo <em>service tag</em>, que identifica o mesmo
                    serviço
                  </>
                )}
                .
              </>
            ) : undefined
          }
          tabela={{
            colunas: [
              { chave: 'catalogo', rotulo: 'Catálogo' },
              { chave: 'clientes', rotulo: 'Reparos-mês', alinhar: 'dir' },
              { chave: 'rec', rotulo: 'Recorrentes', alinhar: 'dir' },
              { chave: 'taxaRec', rotulo: 'Taxa recor.', alinhar: 'dir' },
            ],
            linhas: (d?.porCatalogo ?? []).map((x) => ({
              catalogo: x.rotulo,
              clientes: fmtInt(x.clientes),
              rec: fmtInt(x.recorrentes),
              taxaRec: fmtFracaoPct(x.taxaRecorrencia, 1),
            })),
          }}
        >
          {d && (
            <RankingSimples
              dados={[...(d.porCatalogo ?? [])]
                .sort((a, b) => b.recorrentes - a.recorrentes)
                .slice(0, 10)
                .map((x) => ({
                  rotulo: x.rotulo,
                  valor: x.recorrentes,
                  detalhe: `${fmtInt(x.clientes)} reparos-mês · taxa ${fmtFracaoPct(x.taxaRecorrencia, 1)}`,
                }))}
              unidade="logins recorrentes"
              aoClicar={(r) => alternar('catalogo', r)}
              selecionado={emFoco('catalogo')}
            />
          )}
        </Painel>
      </div>

      {/*
        BAIRRO EM LARGURA CHEIA, E NÃO ao lado de cidade/catálogo: cidade tem 8
        valores e catálogo 3, mas bairro tem dezenas — numa coluna estreita o
        rótulo come o gráfico, porque `RankingSimples` deixa `containLabel`
        medir o texto real e um "Vila Nova Santa Luzia" empurra as barras para
        a direita até sobrar nada.
      */}
      <Painel
        titulo="Recorrência por bairro"
        descricao="Barra = logins crônicos. O grão em que a operação age — cidade diz onde olhar, bairro diz onde ir."
        carregando={q.isLoading}
        erro={erro}
        nota="Bairro do solicitante, como cadastrado no Voalle"
        tabela={{
          colunas: [
            { chave: 'bairro', rotulo: 'Bairro' },
            { chave: 'clientes', rotulo: 'Reparos-mês', alinhar: 'dir' },
            { chave: 'rec', rotulo: 'Recorrentes', alinhar: 'dir' },
            { chave: 'taxaRec', rotulo: 'Taxa recor.', alinhar: 'dir' },
          ],
          linhas: (d?.porBairro ?? []).map((x) => ({
            bairro: x.rotulo,
            clientes: fmtInt(x.clientes),
            rec: fmtInt(x.recorrentes),
            taxaRec: fmtFracaoPct(x.taxaRecorrencia, 1),
          })),
        }}
      >
        {d && (
          <RankingSimples
            dados={[...(d.porBairro ?? [])]
              .sort((a, b) => b.recorrentes - a.recorrentes)
              .slice(0, 15)
              .map((x) => ({
                rotulo: x.rotulo,
                valor: x.recorrentes,
                detalhe: `${fmtInt(x.clientes)} reparos-mês · taxa ${fmtFracaoPct(x.taxaRecorrencia, 1)}`,
              }))}
            unidade="logins recorrentes"
            aoClicar={(r) => alternar('bairro', r)}
            selecionado={emFoco('bairro')}
          />
        )}
      </Painel>

      {d && d.porMes.length > 1 && (
        <Painel
          titulo="Evolução mensal"
          descricao="Só aparece quando o recorte cobre mais de um mês"
          carregando={q.isLoading}
          erro={erro}
          tabela={{
            colunas: [
              { chave: 'mes', rotulo: 'Mês' },
              { chave: 'clientes', rotulo: 'Reparos-mês', alinhar: 'dir' },
              { chave: 'rec', rotulo: 'Recorrentes', alinhar: 'dir' },
              { chave: 'taxa', rotulo: 'Taxa recor.', alinhar: 'dir' },
            ],
            linhas: d.porMes.map((x) => ({
              mes: x.mes,
              clientes: fmtInt(x.clientes),
              rec: fmtInt(x.recorrentes),
              taxa: fmtFracaoPct(x.taxaRecorrencia, 1),
            })),
          }}
        >
          <RankingSimples
            dados={(d.porMes ?? []).map((x) => ({
              rotulo: x.mes,
              valor: x.recorrentes,
              detalhe: `${fmtInt(x.clientes)} reparos-mês · taxa ${fmtFracaoPct(x.taxaRecorrencia, 1)}`,
            }))}
            unidade="logins recorrentes"
          />
        </Painel>
      )}
    </div>
  )
}
