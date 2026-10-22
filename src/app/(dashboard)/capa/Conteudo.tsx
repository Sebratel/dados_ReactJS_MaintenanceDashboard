'use client'

import { useQuery } from '@tanstack/react-query'
import { buscarJson } from '@/lib/clienteHttp'
import { fmtInstante, fmtInt, haQuanto } from '@/lib/formato'
import type { FonteStatus, StatusPainel } from '@/server/status'

/**
 * Capa padrão Sebratel (casca da skill padrao-frontend-dashboards): faixa vinho
 * com selo de três números, três blocos — Objetivo, Atualização dos dados,
 * Indicadores — e o rodapé de contato. A estrutura é a mesma do COM · Gestão
 * Comercial; o que muda é o texto.
 *
 * ⚠️ OS NOMES DOS INDICADORES SÃO OS DOS CARTÕES, LETRA POR LETRA. A Capa é
 * onde a pessoa vem conferir o que um número quer dizer; se o nome daqui não
 * bate com o do cartão, ela não acha a definição e volta a adivinhar.
 */

const SISTEMA = 'MAN · MANUTENÇÃO FTTX'
const SUBTITULO = 'Reparos, tempos e qualidade do campo — direto do ERP Voalle'

// Cada item é uma decisão que o painel apoia, não "mostrar dados".
const OBJETIVOS = [
  'Ver se o backlog de reparos está crescendo ou diminuindo, e em que cidade, base e catálogo ele se acumula;',
  'Medir quanto o reparo demora (MTTR) e quanto o técnico passa em campo (MTTA), e em que dia e turno o tempo pesa;',
  'Acompanhar a produção de cada técnico visita a visita: produtivas, improdutivas e o motivo de cada perda;',
  'Achar os logins PPPoE que voltam a abrir reparo em 30, 60 e 90 dias, e quem fez o atendimento anterior;',
  'Saber se a preventiva resolveu: quantas voltaram como reparo dentro de 90 dias;',
  'Conferir qualquer número protocolo a protocolo e exportar o recorte para bater com o Voalle.',
]

const INDICADORES: [string, string][] = [
  [
    'Protocolos abertos',
    'protocolos de manutenção criados no período (equipe ou catálogo de manutenção). Cancelados, o cliente de teste e as centrais COR/CGR ficam fora.',
  ],
  [
    'MTTR médio',
    'da criação ao encerramento, contado no período em que o reparo TERMINOU, em h:mm:ss.',
  ],
  [
    'MTTA médio',
    'deslocamento + atendimento registrados pelo técnico em campo. Protocolo sem relato de campo fica fora da média, não entra como zero.',
  ],
  [
    'Coeficiente de reparos sobre a base de clientes',
    'reparos do dia ÷ clientes autenticados no dia nas 6 cidades da região. Meta: 0,12% de segunda a sexta, 0,08% no sábado, 0,06% no domingo.',
  ],
  [
    'Assertividade de campo',
    'visitas produtivas ÷ (produtivas + improdutivas). Cada relato improdutivo é uma visita, e protocolo cancelado conta, porque a ida ao cliente aconteceu.',
  ],
  [
    'Taxa de recorrência',
    'logins PPPoE cujo reparo do mês teve outro reparo nos 30 dias anteriores ÷ logins com reparo no mês. 60 e 90 dias são cumulativos; preventiva não conta.',
  ],
  [
    'Taxa de reincidência',
    'preventivas que voltaram como reparo em até 90 dias ÷ preventivas do período. Só entram as que já completaram 90 dias; as recentes ficam em observação.',
  ],
  [
    'Taxa de retorno',
    'reparos que voltaram até 90 dias depois do atendimento anterior da mesma instalação ÷ reparos do período, atribuídos a quem fez o anterior.',
  ],
]

function textoFonte(f: FonteStatus): string {
  if (f.falhou) return 'falhou'
  return f.atualizadoEm ? `${haQuanto(f.atualizadoEm)} · ${f.cadencia}` : f.cadencia
}

export function CapaConteudo() {
  // Leve por desenho (ver server/status.ts): o ERP não é consultado para a Capa.
  const { data: status } = useQuery({
    queryKey: ['status'],
    queryFn: () => buscarJson<StatusPainel>('/api/status'),
    staleTime: 60_000,
    refetchInterval: 300_000,
  })

  const erp = status?.fontes[0]
  const selo: [string, string][] = [
    [status?.baseClientes != null ? fmtInt(status.baseClientes) : '—', 'clientes na base'],
    [status ? String(status.cidadesRegiao) : '—', 'cidades na região'],
    [erp?.atualizadoEm ? haQuanto(erp.atualizadoEm) : '—', 'última leitura do ERP'],
  ]

  return (
    <div className="pagina">
      <section className="capa-topo">
        <img src="/logo-circular-sebratel.png" alt="" />
        <div className="txt">
          <h2>{SISTEMA}</h2>
          <p>{SUBTITULO}</p>
        </div>
        <div className="selo">
          {selo.map(([valor, rotulo]) => (
            <div key={rotulo}>
              <b>{valor}</b>
              <span>{rotulo}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="capa">
        <article className="bloco">
          <h3>Objetivo</h3>
          <div className="conteudo">
            <ul>
              {OBJETIVOS.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          </div>
        </article>

        <article className="bloco">
          <h3>Atualização dos dados</h3>
          <div className="conteudo">
            <p>
              Os números são lidos <b>ao vivo</b> da réplica de leitura do <b>ERP Voalle</b>. Cada
              consulta fica guardada no servidor de 1 a 30 minutos, conforme o custo do
              indicador, e o botão <b>Atualizar</b> do topo busca de novo para todos. A base de
              clientes vem do <b>Data Hub</b>, que recebe uma carga por dia.
            </p>
            <table className="capa-fontes">
              <tbody>
                {(status?.fontes ?? []).map((f) => (
                  <tr key={f.nome}>
                    <td>{f.nome}</td>
                    <td title={f.atualizadoEm ? `Última leitura: ${fmtInstante(f.atualizadoEm)}` : ''}>
                      {f.falhou ? <span className="texto-erro">falhou</span> : textoFonte(f)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="bloco">
          <h3>Indicadores</h3>
          <div className="conteudo">
            <ul>
              {INDICADORES.map(([nome, definicao]) => (
                <li key={nome}>
                  <b>{nome}:</b> {definicao}
                </li>
              ))}
            </ul>
          </div>
        </article>
      </div>

      <div className="rodape">
        <span>Dúvidas: intel@sebratel.com.br</span>
        <span>{status?.lidoEm ? `dados lidos em ${fmtInstante(status.lidoEm)}` : ''}</span>
        <span>Inteligência de Dados · Sebratel</span>
      </div>
    </div>
  )
}
