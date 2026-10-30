'use client'

import { useCallback, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { usePredicoes, useRiscoAbertos } from '@/lib/useIndicador'
import { useAlturaComoVariavel } from '@/lib/useAlturaComoVariavel'
import { riscoDoAberto, somarDias, type MotivoRisco } from '@/lib/previsao'
import {
  fmtData,
  fmtDataHora,
  fmtDec,
  fmtDiaSemana,
  fmtFracaoPct,
  fmtHorasCurto,
  fmtInt,
  semEmoji,
} from '@/lib/formato'
import { Painel } from '@/components/Painel'
import { Segmentado } from '@/components/Segmentado'
import { Kpis } from '@/components/kpi/Kpis'
import { StatTile } from '@/components/kpi/StatTile'
import { PrevisaoDiaria } from '@/components/charts/PrevisaoDiaria'
import { PlanoCampo } from '@/components/charts/PlanoCampo'
import { CurvaFechamento } from '@/components/charts/CurvaFechamento'
import { RankingSimples } from '@/components/charts/RankingSimples'
import { TaxaVolta } from '@/components/charts/TaxaVolta'
import { PrevistoRealizado } from '@/components/charts/PrevistoRealizado'

/**
 * As perguntas que a tela responde. Cada uma é uma aba com no máximo duas
 * faixas — seis perguntas numa rolagem só seriam seis telas empilhadas, e a
 * regra de duas faixas por tela existe para nenhum gráfico ficar maior que a
 * janela. Os seis KPIs do topo respondem todas de uma vez; a aba é o porquê.
 */
const PERGUNTAS = [
  { valor: 'demanda', rotulo: 'Demanda e campo', dica: 'Quantos reparos vão entrar nas próximas duas semanas, e o campo dá conta?' },
  { valor: 'abertos', rotulo: 'Abertos em risco', dica: 'Quais reparos abertos agora vão passar de 48h?' },
  { valor: 'rede', rotulo: 'Rede', dica: 'Em que bairros a entrada de reparo está acima do normal?' },
  { valor: 'clientes', rotulo: 'Clientes', dica: 'Quem deve voltar a abrir reparo?' },
  { valor: 'confianca', rotulo: 'Confiabilidade', dica: 'Quanto estas previsões acertaram no passado recente?' },
] as const

type Pergunta = (typeof PERGUNTAS)[number]['valor']

/** 'YYYY-MM-DD HH:MI' → '21/10 18:33': o ano é sempre este, e a coluna cabe numa linha. */
const diaHora = (s: string) => fmtDataHora(s).replace(/\/\d{4}/, '')

const ROTULO_MOTIVO: Record<MotivoRisco, string> = {
  estourou: 'Já passou de 48h',
  'agenda-tarde': 'Visita depois das 48h',
  curva: 'Pela idade',
}

const ROTULO_AGENDAMENTO = { pedido: 'Pedido do cliente', agenda: 'Conforme agenda' } as const

/**
 * A visita atual é a que o cliente pediu: 1º agendamento a pedido dele e
 * nenhuma remarcação. Remarcado, não se sabe o motivo da data nova — a
 * classificação continua na coluna, mas não vai para o "Por quê".
 *
 * A tela INFORMA, não prescreve: nada de "não dá para antecipar". Se vale
 * ligar para o cliente é decisão do time operacional (29/10/2026).
 */
/**
 * "Vezes o normal" com UMA casa (30/10/2026): "Rincão 2,00×" fazia perguntar
 * se era 2 ou 2 mil — a segunda casa não diz nada sobre um bairro.
 */
const nfVezes = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const fmtVezes = (n: number) => `${nfVezes.format(n)}×`

const pedidoDoCliente = (a: { primeiroAgendamento: string | null; remarcacoes: number }) =>
  a.primeiroAgendamento === 'pedido' && a.remarcacoes === 0

export function PredicoesConteudo() {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  /**
   * A PERGUNTA MORA NA URL, como a métrica do Histórico: o link copiado para um
   * colega abre na mesma aba, e o voltar do navegador desfaz a troca. O
   * cabeçalho a tira do endereço ao sair daqui (`CORTES_DA_TELA`).
   */
  const pergunta: Pergunta = PERGUNTAS.find((p) => p.valor === sp.get('pergunta'))?.valor ?? 'demanda'
  const setPergunta = useCallback(
    (v: Pergunta) => {
      const q = new URLSearchParams(sp.toString())
      q.set('pergunta', v)
      router.replace(`${pathname}?${q.toString()}`, { scroll: false })
    },
    [pathname, router, sp]
  )

  // a barra de perguntas ocupa o lugar da barra de filtros — e a altura dela
  // entra na conta da área útil do mesmo jeito
  const medirBarra = useAlturaComoVariavel('--h-filtros', 'raiz')

  const qp = usePredicoes()
  const qa = useRiscoAbertos()
  const d = qp.data?.data
  const erroP = qp.error ? String(qp.error.message) : null
  const erroA = qa.error ? String(qa.error.message) : null

  /** Cada aberto com o risco dele: a curva vem das previsões, a lista é de agora. */
  const abertos = useMemo(() => {
    const curva = d?.fechamento
    if (!curva || !qa.data) return []
    return qa.data.data
      .map((a) => ({ ...a, ...riscoDoAberto(curva, a.idadeH, a.criado, a.proxima) }))
      .sort((x, y) => {
        // o que ainda dá para salvar vem antes do que já estourou
        const xs = x.motivo === 'estourou' ? 1 : 0
        const ys = y.motivo === 'estourou' ? 1 : 0
        return xs - ys || y.risco - x.risco || y.idadeH - x.idadeH
      })
  }, [d?.fechamento, qa.data])

  /**
   * Hora de idade escolhida no gráfico da curva: a tabela mostra só os abertos
   * daquela hora. Estado local e não URL — é um olhar de momento, e a lista
   * muda a cada 10 minutos (o aberto de 47h agora já terá 48h na próxima).
   */
  const [horaSel, setHoraSel] = useState<number | null>(null)
  const abertosTabela = useMemo(
    () => (horaSel === null ? abertos : abertos.filter((a) => Math.floor(a.idadeH) === horaSel)),
    [abertos, horaSel]
  )

  const resumoAbertos = useMemo(() => {
    const salvaveis = abertos.filter((a) => a.motivo !== 'estourou')
    return {
      total: abertos.length,
      salvaveis: salvaveis.length,
      esperados: salvaveis.reduce((s, a) => s + a.risco, 0),
      estouraram: abertos.length - salvaveis.length,
      agendaTarde: salvaveis.filter((a) => a.motivo === 'agenda-tarde').length,
      agendaTardePedido: salvaveis.filter((a) => a.motivo === 'agenda-tarde' && pedidoDoCliente(a)).length,
    }
  }, [abertos])

  const semana = useMemo(() => {
    const prox = (d?.previsao ?? []).slice(0, 7)
    const plano = (d?.campo.plano ?? []).slice(0, 7)
    return {
      reparos: prox.reduce((s, p) => s + p.previsto, 0),
      dias: prox.length,
      folga: plano.reduce((s, p) => s + p.folga, 0),
      demanda: plano.reduce((s, p) => s + p.demanda, 0),
      capacidade: plano.reduce((s, p) => s + p.capacidade, 0),
      diasApertados: plano.filter((p) => p.folga < 0).length,
    }
  }, [d?.previsao, d?.campo.plano])

  // o servidor ordena por z (o quanto a alta é improvável por acaso); a tela
  // desenha "vezes o normal", e barra fora de ordem de comprimento lê como erro
  const emAlta = useMemo(() => [...(d?.bairros.emAlta ?? [])].sort((x, y) => y.razao - x.razao), [d?.bairros.emAlta])

  const chance3 = d?.logins.porReparos.find((r) => r.reparos === '3+') ?? null
  const chance1 = d?.logins.porReparos.find((r) => r.reparos === '1') ?? null
  const av = d?.avaliacao ?? null
  const ontem = d ? somarDias(d.hoje, -1) : null
  const hojePrev = d?.previsao.find((p) => p.dia === d.hoje) ?? null

  const carregando = qp.isLoading
  /**
   * Valor do KPI nos três estados: o número, '…' carregando, '—' com erro.
   * Sem o '—', um erro deixava os cartões em '…' para sempre — e o contexto
   * dizia "de 0 abertos", que lê como dado e não como falha.
   */
  const v = (s: string, q: { error: unknown; isLoading: boolean } = qp) =>
    q.error ? '—' : q.isLoading || !d ? '…' : s
  const ctx = (s: string) => (d ? s : undefined)

  return (
    <>
      <div className="filtros-moldura" ref={medirBarra}>
        <div className="filtros" role="toolbar" aria-label="Perguntas das predições">
          <span className="rotulo">Pergunta</span>
          <Segmentado claro rotulo="pergunta em foco" valor={pergunta} aoMudar={setPergunta} opcoes={PERGUNTAS} />
          {/*
            RECORTE INVISÍVEL GERA CHAMADO. Quem chega de outra aba com "Canoas"
            no filtro precisa ler aqui que estes números são da Manutenção
            inteira — senão compara com a tela anterior e acha que está errado.
            O "só reparos" é pelo mesmo motivo: Operação conta preventiva junto, e
            o 52 daqui contra o 53 de lá virou pergunta em 29/10/2026. A folga do
            campo é a exceção (o ritmo do time inclui as visitas de preventiva),
            e "só reparos" sozinho a contradizia (30/10/2026).
          */}
          <span className="grupo-rotulo" style={{ marginLeft: 'auto' }}>
            Reparos sem preventivas (a folga do campo conta as duas) · Manutenção inteira, sem filtros
            {ontem && <> · histórico até {fmtData(ontem)}</>}
          </span>
        </div>
      </div>

      <div className="pagina com-kpis">
        <Kpis rotulo="Respostas das predições">
          <StatTile
            rotulo="Previsão reparos próx. 7 dias"
            valor={v(fmtInt(semana.reparos))}
            destaque
            contexto={ctx(
              hojePrev
                ? `hoje ${fmtInt(hojePrev.previsto)} previstos, ${fmtInt(d?.entradaHoje ?? 0)} já entraram`
                : 'mediana das 8 últimas semanas, dia a dia'
            )}
          />
          <StatTile
            rotulo="Folga do campo, 7 dias"
            valor={v(`${semana.folga >= 0 ? '+' : '−'}${fmtInt(Math.abs(semana.folga))} visitas`)}
            status={!d ? null : semana.folga < 0 ? 'critical' : semana.diasApertados > 0 ? 'warning' : 'good'}
            contexto={ctx(
              semana.diasApertados > 0
                ? `${semana.diasApertados} dia(s) com reparo acima do ritmo típico`
                : 'espaço para preventiva no ritmo típico'
            )}
          />
          <StatTile
            rotulo="Devem passar de 48h"
            valor={qp.error ? '—' : v(fmtInt(Math.round(resumoAbertos.esperados)), qa)}
            status={!d || !qa.data ? null : resumoAbertos.estouraram > 0 ? 'warning' : null}
            contexto={
              d && qa.data
                ? `de ${fmtInt(resumoAbertos.salvaveis)} abertos com menos de 48h · ${fmtInt(resumoAbertos.estouraram)} já passaram`
                : undefined
            }
          />
          <StatTile
            rotulo="Bairros acima do normal"
            valor={v(fmtInt(d?.bairros.emAlta.length ?? 0))}
            status={!d ? null : (emAlta.length > 0 || d.bairros.aglomeracoes.length > 0) ? 'warning' : 'good'}
            contexto={ctx(
              emAlta[0]
                ? `${emAlta[0].bairro} ${fmtVezes(emAlta[0].razao)} · ${fmtInt(d?.bairros.aglomeracoes.length ?? 0)} pico(s) em 14 dias`
                : `${fmtInt(d?.bairros.aglomeracoes.length ?? 0)} pico(s) de bairro em 14 dias`
            )}
          />
          <StatTile
            rotulo="Logins com 3+ reparos"
            valor={v(fmtInt(d?.logins.cronicos.length ?? 0))}
            contexto={ctx(
              chance3
                ? `em 90 dias · ~${fmtInt(Math.round((d?.logins.cronicos.length ?? 0) * chance3.taxa))} devem voltar em 30 (${fmtFracaoPct(chance3.taxa, 1)} cada)`
                : 'em 90 dias · sem histórico para a chance'
            )}
          />
          {/*
            "Acerto da previsão" saiu dos cartões em 30/10/2026, antes da
            apresentação aos times: "70% de quê?" não se explica num cartão. O
            número continua na pergunta Confiabilidade; volta depois, se pedirem.
          */}
        </Kpis>

        {pergunta === 'demanda' && (
          <>
            <section className="faixa cheia">
              <Painel
                titulo="Quantos reparos vão entrar"
                classe="v-grafico"
                descricao="Cada dia previsto pela mediana das 8 últimas semanas do mesmo dia da semana; feriado é previsto como sábado. O traço mostra a faixa em que 8 de cada 10 dias caíram."
                carregando={carregando}
                erro={erroP}
                nota={
                  d ? (
                    <>
                      Reparo sem preventiva, pela data de abertura · {fmtInt(d.recentes.length)} dias realizados e{' '}
                      {fmtInt(d.previsao.length)} previstos · hoje está pela metade e entra só como previsão
                      {qp.data && ` · cálculo de ${fmtInt(qp.data.meta.ms / 1000)} s, guardado por 3 h`}
                    </>
                  ) : undefined
                }
                tabela={{
                  colunas: [
                    { chave: 'dia', rotulo: 'Dia' },
                    { chave: 'previsto', rotulo: 'Previsto', alinhar: 'dir' },
                    { chave: 'min', rotulo: 'Faixa de', alinhar: 'dir' },
                    { chave: 'max', rotulo: 'Faixa até', alinhar: 'dir' },
                    { chave: 'feriado', rotulo: 'Feriado' },
                  ],
                  linhas: (d?.previsao ?? []).map((p) => ({
                    dia: fmtDiaSemana(p.dia),
                    previsto: fmtInt(p.previsto),
                    min: fmtInt(p.min),
                    max: fmtInt(p.max),
                    feriado: p.feriado ?? '',
                  })),
                }}
              >
                {d && <PrevisaoDiaria recentes={d.recentes} previsao={d.previsao} entradaHoje={d.entradaHoje} />}
              </Painel>
            </section>
            <section className="faixa cheia">
              <Painel
                titulo="O campo dá conta?"
                classe="v-tabela"
                descricao="Visitas de reparo e preventivas que o time de Manutenção faz num dia típico (mediana das últimas 8 semanas) contra as visitas de reparo que a entrada prevista vai pedir. O que sobra é espaço para preventiva."
                carregando={carregando}
                erro={erroP}
                nota={
                  d?.campo.visitasPorReparo ? (
                    <>
                      Cada reparo que entra consome {fmtDec(d.campo.visitasPorReparo)} visita(s) de campo, contando revisitas ·
                      semana: {fmtInt(semana.demanda)} visitas de reparo para um ritmo de {fmtInt(semana.capacidade)} · o reparo
                      de domingo é atendido na segunda, então leia a soma da semana, não o domingo sozinho
                    </>
                  ) : undefined
                }
                tabela={{
                  colunas: [
                    { chave: 'dia', rotulo: 'Dia' },
                    { chave: 'reparos', rotulo: 'Reparos previstos', alinhar: 'dir' },
                    { chave: 'demanda', rotulo: 'Visitas de reparo', alinhar: 'dir' },
                    { chave: 'capacidade', rotulo: 'Ritmo típico', alinhar: 'dir' },
                    { chave: 'folga', rotulo: 'Folga', alinhar: 'dir' },
                    { chave: 'tecnicos', rotulo: 'Técnicos típicos', alinhar: 'dir' },
                    { chave: 'tecReparo', rotulo: 'Técnicos p/ reparo', alinhar: 'dir' },
                  ],
                  linhas: (d?.campo.plano ?? []).map((p) => ({
                    dia: fmtDiaSemana(p.dia),
                    reparos: fmtInt(p.reparosPrevistos),
                    demanda: fmtInt(p.demanda),
                    capacidade: fmtInt(p.capacidade),
                    folga: `${p.folga > 0 ? '+' : ''}${fmtInt(p.folga)}`,
                    tecnicos: fmtInt(p.tecnicosTipicos),
                    tecReparo: fmtInt(p.tecnicosParaReparo),
                  })),
                }}
              >
                {d && <PlanoCampo plano={d.campo.plano} />}
              </Painel>
            </section>
          </>
        )}

        {pergunta === 'abertos' && (
          <section className="faixa dois-tercos">
            <Painel
              titulo="Reparos abertos agora"
              classe="v-cheia"
              soTabela
              semQuebra
              descricao={`Os que ainda dá para salvar primeiro, do mais arriscado ao menos.${
                qa.data
                  ? ` ${fmtInt(resumoAbertos.agendaTarde)} com visita agendada depois das 48h${
                      resumoAbertos.agendaTardePedido > 0
                        ? `, ${fmtInt(resumoAbertos.agendaTardePedido)} delas a pedido do cliente`
                        : ''
                    }.`
                  : ''
              }`}
              carregando={qa.isLoading || carregando}
              erro={erroA ?? erroP}
              textoVazio={horaSel === null ? 'Nenhum reparo aberto agora.' : `Nenhum aberto com ${horaSel}h agora.`}
              acoes={
                horaSel !== null ? (
                  <button
                    type="button"
                    className="btn-cab"
                    onClick={() => setHoraSel(null)}
                    title="Voltar a mostrar todos os abertos"
                  >
                    Só abertos há {horaSel}h ✕
                  </button>
                ) : undefined
              }
              nota={qa.data ? <>Lista renovada a cada 10 min · leitura de {fmtDataHora(qa.data.meta.agora)}</> : undefined}
              tabela={{
                colunas: [
                  { chave: 'protocolo', rotulo: 'Protocolo' },
                  { chave: 'aberto', rotulo: 'Aberto em', ordenarPor: '_criado' },
                  { chave: 'idade', rotulo: 'Idade', alinhar: 'dir', ordenarPor: '_idade' },
                  { chave: 'chance', rotulo: 'Chance', alinhar: 'dir', ordenarPor: '_risco' },
                  { chave: 'motivo', rotulo: 'Por quê' },
                  { chave: 'agenda', rotulo: 'Visita agendada', ordenarPor: '_proxima' },
                  { chave: 'primeiro', rotulo: '1º agendamento', dica: 'motivoAg' },
                  { chave: 'status', rotulo: 'Status' },
                  // histórico do login (pedido de 30/10/2026): priorizar
                  // atendimento de qualidade em quem já teve muito reparo
                  // faixas exclusivas: cada reparo cai numa só (ver historicoDosLogins)
                  ...(
                    [
                      ['p30', 'até 30 dias'],
                      ['p60', 'de 31 a 60 dias'],
                      ['p90', 'de 61 a 90 dias'],
                    ] as const
                  ).map(([k, faixa]) => ({
                    chave: k,
                    rotulo: k.toUpperCase(),
                    alinhar: 'dir' as const,
                    ordenarPor: `_${k}`,
                    dicaCabecalho: `Outros reparos de campo do mesmo login (PPPoE) ${faixa} atrás, sem contar este e sem preventivas`,
                  })),
                  {
                    chave: 'pt',
                    rotulo: 'PT',
                    alinhar: 'dir',
                    ordenarPor: '_pt',
                    dicaCabecalho:
                      'Outros reparos de campo do mesmo login (PPPoE) em todo o histórico do ERP, sem contar este e sem preventivas',
                  },
                  { chave: 'cidade', rotulo: 'Cidade' },
                  { chave: 'bairro', rotulo: 'Bairro' },
                  { chave: 'base', rotulo: 'Base' },
                ],
                // clicar no cabeçalho ordena (pedido de 30/10/2026); as chaves
                // com _ são os valores crus que a ordenação usa — Copiar e CSV
                // levam só as colunas, então elas não vazam para o arquivo
                ordenavel: true,
                linhas: abertosTabela.map((a) => ({
                  _criado: a.criado,
                  _idade: a.idadeH,
                  _risco: a.risco,
                  _proxima: a.proxima ?? '',
                  _p30: a.historico?.p30 ?? '',
                  _p60: a.historico?.p60 ?? '',
                  _p90: a.historico?.p90 ?? '',
                  _pt: a.historico?.pt ?? '',
                  protocolo: a.protocolo,
                  aberto: diaHora(a.criado),
                  idade: fmtHorasCurto(a.idadeH),
                  chance: fmtFracaoPct(a.risco, 0),
                  motivo:
                    ROTULO_MOTIVO[a.motivo] +
                    (a.motivo === 'agenda-tarde' && pedidoDoCliente(a) ? ' · pedido do cliente' : ''),
                  // último agendamento; "(passou)" quando a visita já foi e o
                  // protocolo segue aberto sem nova data
                  agenda: a.proxima
                    ? `${diaHora(a.proxima)}${a.proxima < qa.data!.meta.agora ? ' (passou)' : ''}`
                    : '',
                  primeiro:
                    (a.primeiroAgendamento ? ROTULO_AGENDAMENTO[a.primeiroAgendamento] : '—') +
                    (a.remarcacoes > 0 ? ` · remarcado ${a.remarcacoes}x` : ''),
                  // motivo escrito do 1º agendamento: só no passar do mouse
                  motivoAg: a.motivoAgendamento ?? '',
                  // `?.`: o cache L2 (Redis) sobrevive ao redeploy e pode
                  // entregar a lista de antes destas colunas — sem ele a tela
                  // inteira quebrava (30/10/2026); vira "—" até revalidar
                  p30: fmtInt(a.historico?.p30),
                  p60: fmtInt(a.historico?.p60),
                  p90: fmtInt(a.historico?.p90),
                  pt: fmtInt(a.historico?.pt),
                  status: a.status ?? '',
                  cidade: a.cidade ?? '',
                  bairro: a.bairro ?? '',
                  base: a.base ? semEmoji(a.base).replace(' (Manutenção)', '') : '',
                })),
              }}
            />
            <Painel
              titulo="Chance de passar de 48h pela idade"
              classe="v-cheia"
              descricao={
                d?.fechamento
                  ? `Dos reparos abertos nas últimas 12 semanas, metade fechou em até ${fmtInt(d.fechamento.p50)}h e 9 em 10 em até ${fmtInt(d.fechamento.p90)}h. Quanto mais tempo aberto, mais provável estourar.`
                  : 'Curva de fechamento dos reparos das últimas 12 semanas.'
              }
              carregando={carregando}
              erro={erroP}
              nota={d?.fechamento ? <>Coorte de {fmtInt(d.fechamento.amostra)} reparos · pontos vinho = abertos agora</> : undefined}
              tabela={{
                colunas: [
                  { chave: 'idade', rotulo: 'Aberto há', alinhar: 'dir' },
                  { chave: 'chance', rotulo: 'Chance de passar de 48h', alinhar: 'dir' },
                ],
                linhas: (d?.fechamento?.passa ?? [])
                  .map((p, h) => ({ idade: `${h}h`, chance: fmtFracaoPct(p, 1) }))
                  .filter((_, h) => h % 6 === 0 || h === 47),
              }}
            >
              {d?.fechamento && (
                <CurvaFechamento
                  passa={d.fechamento.passa}
                  abertos={abertos.map((a) => ({
                    protocolo: a.protocolo,
                    idadeH: a.idadeH,
                    risco: a.risco,
                    agendaTarde: a.motivo === 'agenda-tarde',
                  }))}
                  horaSelecionada={horaSel}
                  aoSelecionarHora={setHoraSel}
                />
              )}
            </Painel>
          </section>
        )}

        {pergunta === 'rede' && (
          <section className="faixa dupla">
            <Painel
              titulo="Bairros acima do normal"
              classe="v-cheia"
              descricao="Reparos das últimas 4 semanas contra o que as 12 anteriores faziam esperar. Só entram bairros com 4+ reparos esperados e alta que dificilmente é acaso (z > 2)."
              carregando={carregando}
              erro={erroP}
              textoVazio="Nenhum bairro acima do normal nas últimas 4 semanas."
              tabela={{
                colunas: [
                  { chave: 'bairro', rotulo: 'Bairro' },
                  { chave: 'cidade', rotulo: 'Cidade' },
                  { chave: 'recente', rotulo: 'Últimas 4 sem.', alinhar: 'dir' },
                  { chave: 'esperado', rotulo: 'Esperado', alinhar: 'dir' },
                  { chave: 'razao', rotulo: 'Vezes o normal', alinhar: 'dir' },
                  {
                    chave: 'z',
                    rotulo: 'z',
                    alinhar: 'dir',
                    dicaCabecalho: 'Quanto o bairro passou do normal dele: acima de 2, dificilmente é acaso; quanto maior, mais certeza.',
                  },
                ],
                linhas: emAlta.map((b) => ({
                  bairro: b.bairro,
                  cidade: b.cidade,
                  recente: fmtInt(b.recente),
                  esperado: fmtDec(b.esperado),
                  razao: fmtVezes(b.razao),
                  z: fmtDec(b.z),
                })),
              }}
            >
              {emAlta.length > 0 && (
                <RankingSimples
                  dados={emAlta.map((b) => ({
                    rotulo: `${b.bairro} (${b.cidade})`,
                    valor: b.razao,
                    detalhe: `${fmtInt(b.recente)} reparos em 4 semanas; o normal seria ${fmtDec(b.esperado)}`,
                  }))}
                  unidade="vezes o normal"
                  formatarValor={fmtVezes}
                />
              )}
            </Painel>
            <Painel
              titulo="Picos de reparo num bairro (14 dias)"
              classe="v-cheia"
              soTabela
              semQuebra
              descricao="Dias em que um bairro teve 5+ reparos e isso tinha menos de 1 chance em 1.000 de ser acaso para ele — a assinatura de falha de rede (caixa, cabo, OLT), não de cliente."
              carregando={carregando}
              erro={erroP}
              textoVazio="Nenhum pico de bairro nos últimos 14 dias."
              tabela={{
                colunas: [
                  { chave: 'dia', rotulo: 'Dia' },
                  { chave: 'bairro', rotulo: 'Bairro' },
                  { chave: 'cidade', rotulo: 'Cidade' },
                  { chave: 'n', rotulo: 'Reparos no dia', alinhar: 'dir' },
                  { chave: 'media', rotulo: 'Normal do bairro/dia', alinhar: 'dir' },
                ],
                linhas: (d?.bairros.aglomeracoes ?? []).map((a) => ({
                  dia: fmtDiaSemana(a.dia),
                  bairro: a.bairro,
                  cidade: a.cidade,
                  n: fmtInt(a.n),
                  media: fmtDec(a.mediaDia),
                })),
              }}
            />
          </section>
        )}

        {pergunta === 'clientes' && (
          <section className="faixa dupla">
            <Painel
              titulo="Chance de voltar a abrir reparo em 30 dias"
              classe="v-cheia"
              descricao={
                d?.logins.concentracao !== null && d?.logins.concentracao !== undefined
                  ? `Reparo recente aumenta pouco a chance de voltar${chance1 ? ` (${fmtFracaoPct(chance1.taxa, 1)} com 1 reparo)` : ''}. E só ${fmtFracaoPct(d.logins.concentracao, 0)} de quem abre reparo no mês seguinte já tinha reparo nos 90 dias anteriores: o grosso vem de cliente que estava quieto — é a rede.`
                  : 'Taxa observada por classe de login.'
              }
              carregando={carregando}
              erro={erroP}
              nota={d ? <>{fmtInt(d.logins.referencias)} datas de referência semanais, cada uma com 90 dias para trás e 30 para a frente</> : undefined}
              tabela={{
                colunas: [
                  { chave: 'reparos', rotulo: 'Reparos em 90 dias' },
                  { chave: 'recencia', rotulo: 'Último há (dias)' },
                  { chave: 'taxa', rotulo: 'Voltaram em 30 dias', alinhar: 'dir' },
                  { chave: 'obs', rotulo: 'Observados', alinhar: 'dir' },
                ],
                linhas: (d?.logins.classes ?? []).map((c) => ({
                  reparos: c.reparos,
                  recencia: c.recencia,
                  taxa: fmtFracaoPct(c.taxa, 1),
                  obs: fmtInt(c.observados),
                })),
              }}
            >
              {d && <TaxaVolta classes={d.logins.classes} />}
            </Painel>
            <Painel
              titulo="Logins com 3+ reparos em 90 dias"
              classe="v-cheia"
              soTabela
              semQuebra
              descricao="A lista para olhar com atenção — mais reparos primeiro, e entre iguais o mais recente. Cidade e bairro do último reparo."
              carregando={carregando}
              erro={erroP}
              textoVazio="Nenhum login com 3 ou mais reparos nos últimos 90 dias."
              tabela={{
                colunas: [
                  { chave: 'login', rotulo: 'Login' },
                  { chave: 'reparos', rotulo: 'Reparos 90d', alinhar: 'dir' },
                  { chave: 'ultimo', rotulo: 'Último reparo' },
                  { chave: 'dias', rotulo: 'Há (dias)', alinhar: 'dir' },
                  { chave: 'bairro', rotulo: 'Bairro' },
                  { chave: 'cidade', rotulo: 'Cidade' },
                ],
                linhas: (d?.logins.cronicos ?? []).map((c) => ({
                  login: c.instalacao,
                  reparos: fmtInt(c.reparos90),
                  ultimo: fmtData(c.ultimoReparo),
                  dias: fmtInt(c.diasDesde),
                  bairro: c.bairro ?? '',
                  cidade: c.cidade ?? '',
                })),
              }}
            />
          </section>
        )}

        {pergunta === 'confianca' && (
          <>
            <section className="faixa cheia">
              <Painel
                titulo="Previsto uma semana antes × realizado"
                classe="v-grafico"
                descricao="As 8 últimas semanas, cada dia previsto com o que se sabia 7 dias antes. A faixa foi calibrada nas 12 semanas anteriores — estes dias não ajudaram a desenhá-la. Ponto vermelho = fora da faixa."
                carregando={carregando}
                erro={erroP}
                nota={
                  av ? (
                    <>
                      {fmtInt(av.previsoesAvaliadas)} previsões em {fmtInt(av.diasAvaliados)} dias · dentro da faixa{' '}
                      {fmtFracaoPct(av.cobertura, 0)} (a faixa promete 80%) · erro médio {fmtDec(av.erroMedio)} reparos/dia (
                      {fmtFracaoPct(av.erroPercentual, 0)})
                    </>
                  ) : undefined
                }
                tabela={{
                  colunas: [
                    { chave: 'dia', rotulo: 'Dia' },
                    { chave: 'real', rotulo: 'Realizado', alinhar: 'dir' },
                    { chave: 'previsto', rotulo: 'Previsto 7d antes', alinhar: 'dir' },
                    { chave: 'faixa', rotulo: 'Faixa' },
                  ],
                  linhas: (av?.semanaAntes ?? []).map((p) => ({
                    dia: fmtDiaSemana(p.dia),
                    real: fmtInt(p.real),
                    previsto: fmtInt(p.previsto),
                    faixa: `${fmtInt(p.min)} a ${fmtInt(p.max)}`,
                  })),
                }}
              >
                {av && <PrevistoRealizado pontos={av.semanaAntes} />}
              </Painel>
            </section>
            <section className="faixa dupla">
              <Painel
                titulo="Erro por antecedência"
                classe="v-tabela"
                soTabela
                descricao="Prever a duas semanas erra quase o mesmo que prever amanhã: a previsão vem do dia da semana, não da véspera."
                carregando={carregando}
                erro={erroP}
                tabela={{
                  colunas: [
                    { chave: 'h', rotulo: 'Dias antes' },
                    { chave: 'erro', rotulo: 'Erro médio (reparos/dia)', alinhar: 'dir' },
                    { chave: 'cob', rotulo: 'Dentro da faixa', alinhar: 'dir' },
                  ],
                  linhas: (av?.porHorizonte ?? []).map((h) => ({
                    h: fmtInt(h.horizonte),
                    erro: fmtDec(h.erroMedio),
                    cob: fmtFracaoPct(h.cobertura, 0),
                  })),
                }}
              />
              <Painel
                titulo="Como cada resposta é calculada"
                classe="v-tabela"
                soTabela
                descricao="Contagens, medianas e proporções que dá para refazer numa planilha — nenhum modelo treinado."
                tabela={{
                  colunas: [
                    { chave: 'pergunta', rotulo: 'Pergunta' },
                    { chave: 'metodo', rotulo: 'Como' },
                    { chave: 'dados', rotulo: 'Dados' },
                  ],
                  linhas: METODOS,
                }}
              />
            </section>
          </>
        )}
      </div>
    </>
  )
}

const METODOS = [
  {
    pergunta: 'Quantos reparos vão entrar',
    metodo: 'Mediana das 8 últimas semanas do mesmo dia da semana; feriado como sábado. Faixa = percentis 10 e 90 de real ÷ previsto.',
    dados: 'Reparos sem preventiva, 32 semanas',
  },
  {
    pergunta: 'O campo dá conta',
    metodo: 'Previsão × visitas por reparo, contra a mediana de visitas do mesmo dia da semana.',
    dados: 'Agenda da trilha de Manutenção, 8 semanas',
  },
  {
    pergunta: 'Abertos que passam de 48h',
    metodo: 'De quem estava aberto na mesma idade, quantos passaram de 48h; visita agendada (o último agendamento) depois das 48h conta como certo.',
    dados: 'Reparos abertos nas últimas 12 semanas',
  },
  {
    pergunta: 'Bairros acima do normal',
    metodo: 'Últimas 4 semanas contra o esperado pelas 12 anteriores (z > 2); picos de um dia com chance < 1/1.000 (Poisson).',
    dados: 'Reparos por bairro do solicitante, 16 semanas',
  },
  {
    pergunta: 'Quem deve voltar',
    metodo: 'Taxa observada de voltar em 30 dias, por reparos em 90 dias e recência, em datas semanais.',
    dados: 'Reparos por login PPPoE, 30 semanas',
  },
]
