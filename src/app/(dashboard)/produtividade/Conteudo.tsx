'use client'

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { parsearFiltros } from '@/lib/filtros'
import { useProdutividade } from '@/lib/useIndicador'
import { Painel } from '@/components/Painel'
import { Segmentado } from '@/components/Segmentado'
import { StatTile } from '@/components/kpi/StatTile'
import { Kpis } from '@/components/kpi/Kpis'
import { ComposicaoDiaria } from '@/components/charts/ComposicaoDiaria'
import { SerieAssertividade } from '@/components/charts/SerieAssertividade'
import { RankingComposto } from '@/components/charts/RankingComposto'
import { RankingSimples } from '@/components/charts/RankingSimples'
import { fmtDec, fmtFracaoPct, fmtInt, fmtData } from '@/lib/formato'

/** Ordenações possíveis do ranking de técnicos — cada uma responde outra pergunta. */
const ORDENS = [
  { id: 'produtivo', label: 'Produção' },
  { id: 'assertividade', label: 'Assertividade' },
  { id: 'improdutivo', label: 'Visitas perdidas' },
] as const

type Ordem = (typeof ORDENS)[number]['id']

/**
 * Famílias de motivo que podem ser abonadas na assertividade do TÉCNICO.
 *
 * Chuva, cliente ausente e pendência de infra não são falha de quem foi a campo.
 * Abonar aqui muda só a leitura por técnico — o total da operação continua
 * contando a visita perdida, porque para a empresa ela foi perdida de fato.
 */
const GRUPOS_ABONAVEIS = ['Clima', 'Cliente', 'Infra'] as const

export function ProdutividadeConteudo() {
  const sp = useSearchParams()
  const filtros = useMemo(() => parsearFiltros(Object.fromEntries(sp.entries())), [sp])
  const [ordem, setOrdem] = useState<Ordem>('produtivo')
  const [decrescente, setDecrescente] = useState(true)
  const [abonados, setAbonados] = useState<Set<string>>(new Set())

  const q = useProdutividade(filtros)
  const d = q.data?.data
  const t = d?.total

  const erro = q.error ? String(q.error.message) : null
  const nota = q.data
    ? `${fmtInt(q.data.meta.linhasMatriz)} combinações · consulta em ${fmtInt(q.data.meta.ms)} ms · ${
        q.data.meta.cache === 'miss' ? 'consultado agora' : `cache de ${fmtData(q.data.meta.geradoEm.slice(0, 10))}`
      }`
    : undefined

  /**
   * Técnicos com pouquíssima visita distorcem qualquer ranking de taxa: quem fez
   * 1 visita e acertou aparece com 100%. O corte é declarado na tela, não
   * escondido — ver o rodapé do painel.
   */
  const MIN_VISITAS = 10

  /**
   * Aplica o abono e recalcula a assertividade do técnico.
   * O improdutivo abonado sai do numerador E do denominador — ele deixa de ser
   * julgado, não vira acerto.
   */
  const tecnicos = useMemo(() => {
    const lista = (d?.porTecnico ?? [])
      .filter((x) => x.totalVisitas >= MIN_VISITAS)
      .map((x) => {
        const abonado = [...abonados].reduce(
          (soma, g) => soma + (x.improdutivoPorGrupo[g] ?? 0),
          0
        )
        const improdutivo = x.improdutivo - abonado
        const reais = x.produtivo + improdutivo
        return {
          ...x,
          improdutivo,
          abonado,
          totalVisitas: x.produtivo + improdutivo + x.semAcao,
          totalVisitasReais: reais,
          assertividadeCampo: reais > 0 ? x.produtivo / reais : null,
        }
      })
    const sinal = decrescente ? 1 : -1
    const ordenada = [...lista].sort((a, b) => {
      if (ordem === 'assertividade') {
        return sinal * ((b.assertividadeCampo ?? 0) - (a.assertividadeCampo ?? 0))
      }
      if (ordem === 'improdutivo') return sinal * (b.improdutivo - a.improdutivo)
      return sinal * (b.produtivo - a.produtivo)
    })
    return ordenada
  }, [d?.porTecnico, ordem, decrescente, abonados])

  /**
   * O GRÁFICO fica em 15 barras — mais que isso vira ilegível. A TABELA (linha
   * 342 e adiante) usa `tecnicos` inteiro: é o "canal de alívio" que permite ao
   * gestor ver o time todo, inclusive quem está fora do gráfico, sem precisar
   * de outra tela. Ver a pergunta que motivou isso em docs/06.
   */
  const tecnicosGrafico = useMemo(() => tecnicos.slice(0, 15), [tecnicos])

  const totalAbonado = tecnicos.reduce((s, x) => s + x.abonado, 0)

  const tecnicosOcultos = (d?.porTecnico ?? []).filter(
    (x) => x.totalVisitas < MIN_VISITAS
  ).length

  /**
   * Catálogos residuais (1–2 visitas por engano de classificação) entram no
   * gráfico como barra de largura zero com um "100%" flutuando ao lado, que lê
   * como painel quebrado. Ficam só na tabela.
   */
  const catalogos = (d?.porCatalogo ?? []).filter((x) => x.totalVisitas >= 10)
  const catalogosOcultos = (d?.porCatalogo ?? []).length - catalogos.length

  return (
    <div className="pagina com-kpis">
      {/*
        Aviso necessário, não decorativo. A barra de filtros é global e mostra
        "Eixo da data" e "Granularidade" ativos, mas esta página não pode honrar
        nenhum dos dois: a matriz É protocolo × dia agendado. Sem este aviso, o
        leitor veria "Criação" selecionado e concluiria que o gráfico conta por
        data de criação — que é outro número.
      */}
      <p className="nota-tela" role="note">
        <strong>Nesta página o período é sempre pelo dia agendado</strong> e a série é
        diária — a produtividade é medida por visita, não por protocolo, então os
        controles de <em>eixo da data</em> e <em>granularidade</em> não se aplicam aqui.
        Os demais filtros valem normalmente.
      </p>

      <Kpis rotulo="Indicadores de produtividade de campo">
        <StatTile
          rotulo="Assertividade de campo"
          valor={q.isLoading ? '…' : fmtFracaoPct(t?.assertividadeCampo, 1)}
          contexto="produtivo ÷ visitas reais"
          destaque
        />
        <StatTile
          rotulo="Assertividade de visita"
          valor={q.isLoading ? '…' : fmtFracaoPct(t?.assertividadeVisita, 1)}
          contexto="inclui “sem ação” no total"
        />
        <StatTile
          rotulo="Produtivos"
          valor={q.isLoading ? '…' : fmtInt(t?.produtivo)}
          contexto="encerrou no dia da visita"
        />
        <StatTile
          rotulo="Visitas improdutivas"
          valor={q.isLoading ? '…' : fmtInt(t?.improdutivo)}
          contexto="conta mesmo em dia produtivo"
          subirEhRuim
        />
        <StatTile
          rotulo="Sem ação"
          valor={q.isLoading ? '…' : fmtInt(t?.semAcao)}
          contexto="agendado, nenhum desfecho"
          subirEhRuim
        />
        <StatTile
          rotulo="Média diária produtivos"
          valor={q.isLoading ? '…' : fmtDec(t?.mediaReparosTime)}
          /*
            O DENOMINADOR FICA NO CARTÃO DE PROPÓSITO — é o que torna o número
            auditável sem abrir o código, e é o que separa esta medida da
            produção diária da operação (3.842 ÷ 30 = 128,07). O Power BI chama
            as duas de "Média Diária Produtivos" em visuais diferentes.

            O rótulo anterior era "Atividades por técnico/dia", e a Manutenção
            pediu a troca em 15/10/2026 pelo melhor dos motivos: "atividade"
            convida a entender que improdutivo entra na soma, e não entra — o
            numerador é só produtivo.
          */
          contexto={
            t
              ? `${fmtInt(t.produtivo)} produtivos ÷ ${fmtInt(t.diasTimeSomados)} dias-técnico`
              : undefined
          }
        />
        {/*
          Este cartão é o que torna o registro da dupla cobrável: hoje é processo
          não obrigatório, e o que não aparece em nenhuma tela não é acompanhado.
          Mede ADESÃO (registrou algo, inclusive "foi sozinho"), não cobertura do
          crédito — quem declara que foi sozinho cumpriu o processo.
        */}
        <StatTile
          rotulo="Registro da dupla"
          valor={
            q.isLoading || !t
              ? '…'
              : fmtFracaoPct(
                  t.totalVisitas > 0 ? t.visitasComRegistro / t.totalVisitas : null,
                  1
                )
          }
          contexto={
            t
              ? `${fmtInt(t.visitasComDupla)} com auxiliar · ${fmtInt(t.visitasComRegistro - t.visitasComDupla)} declarados sozinho`
              : undefined
          }
        />
      </Kpis>

      <div className="titulo-grupo">
        <h2>Visão da empresa · visitas</h2>
        <p>
          Grão: protocolo × dia agendado. Uma visita feita em dupla é <strong>uma</strong>{' '}
          visita. É o total real da operação, e o único número desta página que pode ser
          somado.
        </p>
      </div>

      {/* desfecho e assertividade empilhados: mesmo eixo X, escalas diferentes */}
      <Painel
        titulo="Desfecho das visitas por dia"
        classe="v-grafico"
        descricao="Total da barra = visitas do dia. A fatia vermelha é o que se perdeu."
        carregando={q.isLoading}
        erro={erro}
        nota={nota}
        tabela={{
          colunas: [
            { chave: 'dia', rotulo: 'Dia' },
            { chave: 'produtivo', rotulo: 'Produtivo', alinhar: 'dir' },
            { chave: 'improdutivo', rotulo: 'Improdutivo', alinhar: 'dir' },
            { chave: 'semAcao', rotulo: 'Sem ação', alinhar: 'dir' },
            { chave: 'total', rotulo: 'Total', alinhar: 'dir' },
            { chave: 'assertiv', rotulo: 'Assertiv. campo', alinhar: 'dir' },
          ],
          linhas: (d?.porDia ?? []).map((x) => ({
            dia: fmtData(x.dia),
            produtivo: fmtInt(x.produtivo),
            improdutivo: fmtInt(x.improdutivo),
            semAcao: fmtInt(x.semAcao),
            total: fmtInt(x.totalVisitas),
            assertiv: fmtFracaoPct(x.assertividadeCampo, 1),
          })),
        }}
      >
        {d && <ComposicaoDiaria dados={d.porDia} />}
      </Painel>

      <Painel
        titulo="Assertividade de campo por dia"
        classe="v-tabela"
        descricao="Mesmo eixo X do painel acima — painel separado porque taxa e contagem não compartilham escala"
        carregando={q.isLoading}
        erro={erro}
        tabela={{
          colunas: [
            { chave: 'dia', rotulo: 'Dia' },
            { chave: 'assertiv', rotulo: 'Assertiv. campo', alinhar: 'dir' },
            { chave: 'reais', rotulo: 'Visitas reais', alinhar: 'dir' },
          ],
          linhas: (d?.porDia ?? []).map((x) => ({
            dia: fmtData(x.dia),
            assertiv: fmtFracaoPct(x.assertividadeCampo, 1),
            reais: fmtInt(x.totalVisitasReais),
          })),
        }}
      >
        {d && <SerieAssertividade dados={d.porDia} />}
      </Painel>

      <div className="titulo-grupo">
        <h2>Visão do técnico · produção individual</h2>
      <p>
        Grão: visita × pessoa creditada. <strong>Os dois da dupla contam 1</strong> —
        crédito integral, executor e auxiliar. O executor é{' '}
        <strong>quem foi naquele dia</strong>, não o responsável do protocolo: um
        protocolo reagendado tem duas visitas de dois técnicos, e a improdutiva
        pertence a quem perdeu a visita. O auxiliar vem da perna <code>RAUX</code> do
        Voalle, mesmo método do BI de instalação, e <strong>também é do dia</strong>:
        visita sem dupla registrada naquele dia fica só com o executor — ninguém
        herda a improdutiva de um dia em que não esteve.{' '}
        {t && t.visitasComDupla > 0 && (
          <>
            {/*
              ⚠️ ESTA FRASE E O CARTÃO "Registro da dupla" MOSTRAM PERCENTUAIS
              DIFERENTES SOBRE O MESMO ASSUNTO, e por isso ela precisa citar o
              cartão em vez de fingir que ele não existe. Aqui é COBERTURA DO
              CRÉDITO (tem auxiliar para creditar); lá é ADESÃO AO PROCESSO
              (registrou alguma coisa, inclusive "fui sozinho"). O numerador é o
              mesmo; o cartão só soma mais um pedaço.

              Reportado pela Manutenção em 16/10/2026 — leu 15% no texto e 24,7%
              no cartão, a três cartões de distância, sem nada ligando os dois.
            */}
            No recorte, <strong>{fmtInt(t.visitasComDupla)}</strong> das{' '}
            {fmtInt(t.totalVisitas)} visitas — produtivas + improdutivas + sem ação —
            têm auxiliar identificado, {fmtFracaoPct(t.visitasComDupla / t.totalVisitas, 0)}.
            São os mesmos {fmtInt(t.visitasComDupla)} do cartão{' '}
            <strong>Registro da dupla</strong>: o{' '}
            {fmtFracaoPct(t.visitasComRegistro / t.totalVisitas, 1)} de lá é maior porque
            soma também as {fmtInt(t.visitasComRegistro - t.visitasComDupla)} visitas em
            que o técnico <em>declarou ter ido sozinho</em> — cumpriu o processo, só não
            há crédito de dupla para dar.{' '}
          </>
        )}
        <strong>Sem total geral de propósito</strong>: somar os técnicos passaria do
        número de atividades da operação. O total de cada técnico, esse sim, é o
        número dele.
      </p>
      </div>

      <Painel
        titulo="Produção por técnico"
        classe="v-cheia"
        /*
          O SUBTÍTULO PRECISA DIZER POR QUE A LISTA ESTÁ NESSA ORDEM.
          Relato da Manutenção em 16/10/2026: "o primeiro está ordenado do maior
          para o menor, os demais não sei qual a regra". As três ordenações
          sempre estiveram corretas — o que faltava era a tela anunciar o
          critério. Em "Produção" ele é visível (a barra verde), nas outras duas
          não era: assertividade está no rótulo e visitas perdidas não aparecia
          em lugar nenhum.
        */
        descricao={
          ordem === 'produtivo'
            ? `Ordenado por produção, ${decrescente ? 'maior → menor' : 'menor → maior'}. Rótulo à direita = assertividade de campo. Barra = volume e mix.`
            : ordem === 'assertividade'
              ? `Ordenado por assertividade, ${decrescente ? 'maior → menor' : 'menor → maior'} — é o próprio rótulo à direita. Barra = volume e mix.`
              : `Ordenado por visitas perdidas, ${decrescente ? 'maior → menor' : 'menor → maior'} — a fatia vermelha. O rótulo à direita traz quantas foram, e a assertividade ao lado.`
        }
        carregando={q.isLoading}
        erro={erro}
        nota={
          <>
            {tecnicosOcultos > 0 &&
              `${tecnicosOcultos} técnico(s) com menos de ${MIN_VISITAS} atividades fora de tudo (gráfico e tabela) — em amostra pequena a taxa não é comparável. `}
            {tecnicos.length > tecnicosGrafico.length &&
              `Gráfico mostra os ${tecnicosGrafico.length} primeiros; a tabela tem os ${tecnicos.length} técnicos do recorte — use “inverter” para trazer os piores para o topo. `}
            {abonados.size > 0
              ? `Abonando ${[...abonados].join(', ')}: ${fmtInt(totalAbonado)} improdutivas saíram da conta do técnico. O total da operação não muda.`
              : 'Use “abonar” para tirar da conta do técnico os motivos que não são dele. O total da operação continua contando a visita perdida.'}
          </>
        }
        acoes={
          <>
            <Segmentado
              multiplo
              rotulo="abonar motivos que não são do técnico"
              prefixo="abonar"
              valor={abonados}
              aoMudar={(g) =>
                setAbonados((prev) => {
                  const novo = new Set(prev)
                  if (novo.has(g)) novo.delete(g)
                  else novo.add(g)
                  return novo
                })
              }
              opcoes={GRUPOS_ABONAVEIS.map((g) => ({ valor: g, rotulo: g }))}
            />
            <Segmentado
              rotulo="ordenar técnicos por"
              valor={ordem}
              aoMudar={setOrdem}
              opcoes={ORDENS.map((o) => ({ valor: o.id, rotulo: o.label }))}
            />
            <button
              type="button"
              onClick={() => setDecrescente((v) => !v)}
              aria-pressed={!decrescente}
              title={
                decrescente
                  ? 'Mostrando os maiores primeiro — clique para trazer os piores ao topo'
                  : 'Mostrando os piores primeiro — clique para voltar aos maiores'
              }
              className="btn-cab"
            >
              {decrescente ? '↓ maiores' : '↑ piores'}
            </button>
          </>
        }
        tabela={{
          colunas: [
            { chave: 'tecnico', rotulo: 'Técnico' },
            { chave: 'produtivo', rotulo: 'Produtivas', alinhar: 'dir' },
            { chave: 'improdutivo', rotulo: 'Improdutivas', alinhar: 'dir' },
            { chave: 'semAcao', rotulo: 'Sem ação', alinhar: 'dir' },
            { chave: 'aux', rotulo: 'Como auxiliar', alinhar: 'dir' },
            { chave: 'assertiv', rotulo: 'Assertiv. campo', alinhar: 'dir' },
            /*
              DIAS TRABALHADOS FICA COLADO EM Ativ./dia PORQUE É O DENOMINADOR
              DELE: produtivas ÷ dias = ativ./dia, e as três colunas lado a lado
              deixam a conta conferível na própria linha.

              "Trabalhados" é dia com atendimento registrado, produtivo ou
              não — dia em que a pessoa saiu e só perdeu visitas conta igual.
              Não é dia de escala: dia sem nenhuma visita não aparece.

              ⚠️ Somar esta coluna NÃO dá o denominador do cartão "Média diária
              produtivos". Lá o dia só conta para o TITULAR e só quando houve
              produtivo, porque o cartão reproduz a medida do Power BI; aqui
              conta o dia de quem esteve lá, inclusive como auxiliar.
            */
            { chave: 'dias', rotulo: 'Dias trabalhados', alinhar: 'dir' },
            { chave: 'media', rotulo: 'Ativ./dia', alinhar: 'dir' },
          ],
          linhas: tecnicos.map((x) => ({
            tecnico: x.tecnico,
            produtivo: fmtInt(x.produtivo),
            aux: fmtInt(x.comoAuxiliar),
            improdutivo: fmtInt(x.improdutivo),
            semAcao: fmtInt(x.semAcao),
            assertiv: fmtFracaoPct(x.assertividadeCampo, 1),
            dias: fmtInt(x.diasTrabalhados),
            media: fmtDec(x.mediaDiaria),
          })),
        }}
      >
        {d && (
          <RankingComposto
            dados={tecnicosGrafico.map((x) => ({
              rotulo: x.tecnico,
              produtivo: x.produtivo,
              improdutivo: x.improdutivo,
              semAcao: x.semAcao,
              totalVisitas: x.totalVisitas,
              assertividadeCampo: x.assertividadeCampo,
            }))}
            rotuloEixo="Técnico"
            realce={ordem === 'improdutivo' ? 'improdutivo' : 'assertividade'}
          />
        )}
      </Painel>

      <div className="faixa dupla">
        <Painel
          titulo="Motivos de improdutividade"
          classe="v-meia"
          descricao="Código do relato do técnico, traduzido pelo catálogo"
          carregando={q.isLoading}
          erro={erro}
          nota="Só entra o relato com a classificação inserida (MAN.xxx / INST.xxx — IMPROD). Nota de campo sem esse código, mesmo mencionando 'improdutivo' no texto, não conta — decisão da Manutenção em 03/09/2026, para não presumir visita perdida."
          tabela={{
            colunas: [
              { chave: 'rotulo', rotulo: 'Motivo' },
              { chave: 'codigo', rotulo: 'Código' },
              { chave: 'grupo', rotulo: 'Família' },
              { chave: 'visitas', rotulo: 'Visitas', alinhar: 'dir' },
              { chave: 'share', rotulo: 'Share', alinhar: 'dir' },
            ],
            linhas: (d?.motivos ?? []).map((m) => ({
              rotulo: m.rotulo,
              codigo: m.codigo,
              grupo: m.grupo,
              visitas: fmtInt(m.visitas),
              share: fmtFracaoPct(m.share, 1),
            })),
          }}
        >
          {d && (
            <RankingSimples
              dados={d.motivos.slice(0, 12).map((m) => ({
                rotulo: m.rotulo,
                valor: m.visitas,
                share: m.share,
                detalhe: `${m.codigo} · família ${m.grupo}`,
              }))}
            />
          )}
        </Painel>

        <Painel
          titulo="Por base"
          classe="v-meia"
          descricao="Base real da agenda de campo, incluindo a trilha"
          carregando={q.isLoading}
          erro={erro}
          tabela={{
            colunas: [
              { chave: 'base', rotulo: 'Base' },
              { chave: 'produtivo', rotulo: 'Produtivo', alinhar: 'dir' },
              { chave: 'improdutivo', rotulo: 'Improdutivo', alinhar: 'dir' },
              { chave: 'semAcao', rotulo: 'Sem ação', alinhar: 'dir' },
              { chave: 'assertiv', rotulo: 'Assertiv. campo', alinhar: 'dir' },
            ],
            linhas: (d?.porBase ?? []).map((b) => ({
              base: b.base,
              produtivo: fmtInt(b.produtivo),
              improdutivo: fmtInt(b.improdutivo),
              semAcao: fmtInt(b.semAcao),
              assertiv: fmtFracaoPct(b.assertividadeCampo, 1),
            })),
          }}
        >
          {d && (
            <RankingComposto
              dados={d.porBase.map((b) => ({
                rotulo: b.base,
                produtivo: b.produtivo,
                improdutivo: b.improdutivo,
                semAcao: b.semAcao,
                totalVisitas: b.totalVisitas,
                assertividadeCampo: b.assertividadeCampo,
              }))}
              rotuloEixo="Base"
            />
          )}
        </Painel>
      </div>

      <Painel
        titulo="Por catálogo de serviço"
        classe="v-grafico"
        descricao="Reparo × Tecnologia — este é o corte que realmente separa a operação de campo"
        carregando={q.isLoading}
        erro={erro}
        nota={
          <>
            O filtro de <em>equipe</em> não segmenta esta página: praticamente todo
            protocolo de campo está em “Equipe Field Service”. Quem separa a operação
            é o catálogo.
            {catalogosOcultos > 0 &&
              ` ${catalogosOcultos} catálogo(s) com menos de 10 visitas ficaram só na tabela.`}
          </>
        }
        tabela={{
          colunas: [
            { chave: 'catalogo', rotulo: 'Catálogo' },
            { chave: 'produtivo', rotulo: 'Produtivo', alinhar: 'dir' },
            { chave: 'improdutivo', rotulo: 'Improdutivo', alinhar: 'dir' },
            { chave: 'semAcao', rotulo: 'Sem ação', alinhar: 'dir' },
            { chave: 'total', rotulo: 'Total', alinhar: 'dir' },
            { chave: 'assertiv', rotulo: 'Assertiv. campo', alinhar: 'dir' },
          ],
          linhas: (d?.porCatalogo ?? []).map((x) => ({
            catalogo: x.catalogo,
            produtivo: fmtInt(x.produtivo),
            improdutivo: fmtInt(x.improdutivo),
            semAcao: fmtInt(x.semAcao),
            total: fmtInt(x.totalVisitas),
            assertiv: fmtFracaoPct(x.assertividadeCampo, 1),
          })),
        }}
      >
        {d && (
          <RankingComposto
            dados={catalogos.map((x) => ({
              rotulo: x.catalogo,
              produtivo: x.produtivo,
              improdutivo: x.improdutivo,
              semAcao: x.semAcao,
              totalVisitas: x.totalVisitas,
              assertividadeCampo: x.assertividadeCampo,
            }))}
            rotuloEixo="Catálogo"
          />
        )}
      </Painel>
    </div>
  )
}
