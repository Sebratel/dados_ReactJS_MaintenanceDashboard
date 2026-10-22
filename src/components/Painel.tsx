'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { baixarCsv, copiar, nomeDeArquivo, paraCsv, paraTsv } from '@/lib/exportar'
import { ExplicarIA } from './ExplicarIA'
import { Icone } from './Icone'
import { Segmentado } from './Segmentado'

export type ColunaTabela = { chave: string; rotulo: string; alinhar?: 'esq' | 'dir' }

/**
 * A altura do card, em fração da área útil da tela (padrao.css). É o que faz
 * duas faixas caberem numa tela e nenhum gráfico passar da altura da janela.
 *
 * - `v-grafico` / `v-tabela`: as duas faixas que somam uma tela (0,455 + 0,545)
 * - `v-meia`: meia tela, para duas faixas iguais
 * - `v-cheia`: a área útil inteira, para o visual que é a tela
 * - `v-auto`: altura do conteúdo — o gráfico dentro precisa de `altura` própria
 */
export type ClasseAltura = 'v-grafico' | 'v-tabela' | 'v-meia' | 'v-cheia' | 'v-auto'

export type PainelProps = {
  titulo: string
  descricao?: string
  /** rodapé curto: fonte, ressalva, tempo de consulta */
  nota?: ReactNode
  children: ReactNode
  /**
   * Visão de tabela — obrigatória em todo gráfico.
   * Além de acessibilidade, é o "canal de alívio" que deixa conferir o número
   * por trás de cada barra, e é ela que vai para o Copiar, o CSV e a IA.
   */
  tabela?: { colunas: ColunaTabela[]; linhas: Record<string, string | number>[] }
  acoes?: ReactNode
  /** posição no grid da página (ex.: ocupar duas colunas) — não mexe em altura */
  className?: string
  classe?: ClasseAltura
  carregando?: boolean
  erro?: string | null
  /**
   * Força o estado vazio. Sem isto, o painel se declara vazio quando a tabela
   * dele não tem linha — que cobre quase todos os casos.
   */
  vazio?: boolean
}

/**
 * Card de visual no padrão Sebratel (o `Visual` da skill): barra na cor
 * primária com o título e as ações "desta visão", subtítulo que diz o que a
 * pessoa está vendo, corpo e rodapé.
 *
 * OS TRÊS ESTADOS NÃO SÃO OPCIONAIS. Tela de dashboard passa a vida carregando,
 * filtrando para vazio e tomando erro de rede; sem os três, o card fica branco
 * e a pessoa conclui que o número é zero.
 */
export function Painel({
  titulo,
  descricao,
  nota,
  children,
  tabela,
  acoes,
  className = '',
  classe = 'v-grafico',
  carregando = false,
  erro = null,
  vazio,
}: PainelProps) {
  const [modo, setModo] = useState<'grafico' | 'tabela'>('grafico')

  /**
   * Retorno visível do "Copiar".
   *
   * Copiar não muda nada na tela: sem confirmação, a pessoa clica, não vê nada
   * acontecer e clica de novo — ou pior, vai colar no Excel achando que copiou
   * quando o navegador recusou a permissão. Por isso o estado distingue sucesso
   * de falha, em vez de só "cliquei".
   */
  const [copia, setCopia] = useState<'nada' | 'ok' | 'erro'>('nada')

  useEffect(() => {
    if (copia === 'nada') return
    const id = setTimeout(() => setCopia('nada'), 2000)
    return () => clearTimeout(id)
  }, [copia])

  const aoCopiar = async () => {
    if (!tabela) return
    const ok = await copiar(paraTsv(tabela.colunas, tabela.linhas))
    setCopia(ok ? 'ok' : 'erro')
  }

  const aoBaixar = () => {
    if (!tabela) return
    baixarCsv(nomeDeArquivo(titulo), paraCsv(tabela.colunas, tabela.linhas))
  }

  const semDados = vazio ?? (tabela !== undefined && tabela.linhas.length === 0)

  return (
    <section className={`visual ${classe} ${className}`} aria-label={titulo}>
      {/*
        `position: relative` na barra (padrao.css) ancora o balão da leitura por
        IA logo abaixo dela, sobre o corpo do card que ele explica.
      */}
      <div className="visual-cab" style={{ position: 'relative' }}>
        <h2 title={titulo}>{titulo}</h2>
        <div className="acoes">
          {/*
            Exportação só aparece na visão de tabela, e de propósito: é ali que a
            pessoa está conferindo número. No gráfico, o botão seria mais um
            controle competindo por atenção com o dado.

            A CONTAGEM DE LINHAS fica junto porque é a primeira coisa que se
            confere numa auditoria — se o gráfico mostra 12 barras e a tabela diz
            48 linhas, a divergência aparece antes de abrir o Excel.
          */}
          {tabela && modo === 'tabela' && (
            <>
              <span style={{ fontSize: 11, opacity: 0.85 }} className="tabular">
                {tabela.linhas.length} {tabela.linhas.length === 1 ? 'linha' : 'linhas'}
              </span>
              <button
                type="button"
                onClick={aoCopiar}
                title="Copia a tabela para colar direto no Excel"
                className={`btn-cab${copia === 'ok' ? ' ok' : copia === 'erro' ? ' falhou' : ''}`}
                aria-live="polite"
              >
                <Icone nome={copia === 'ok' ? 'ok' : 'copiar'} tamanho={11} />
                {copia === 'ok' ? 'copiado' : copia === 'erro' ? 'falhou' : 'Copiar'}
              </button>
              <button
                type="button"
                onClick={aoBaixar}
                title="Baixa um arquivo CSV com o período no nome"
                className="btn-cab"
              >
                <Icone nome="baixar" tamanho={11} />
                CSV
              </button>
            </>
          )}
          {/*
            "Explicar" só aparece com tabela, porque é a tabela que vai para o
            provedor. Num painel sem visão de tabela não havia o que mandar.
          */}
          {tabela && tabela.linhas.length > 0 && (
            <ExplicarIA
              titulo={titulo}
              descricao={descricao}
              colunas={tabela.colunas}
              linhas={tabela.linhas}
            />
          )}
          {acoes}
          {tabela && (
            <Segmentado
              rotulo="alternar visualização"
              valor={modo}
              aoMudar={setModo}
              opcoes={[
                { valor: 'grafico', rotulo: 'Gráfico' },
                { valor: 'tabela', rotulo: 'Tabela' },
              ]}
            />
          )}
        </div>
      </div>

      {descricao && <div className="visual-sub">{descricao}</div>}

      <div className="visual-corpo">
        {erro ? (
          <div className="estado erro" role="alert">
            <span className="linha">
              <Icone nome="alerta" tamanho={14} />
              {erro}
            </span>
          </div>
        ) : carregando ? (
          <div className="estado" role="status" aria-label="Carregando">
            <div className="carregando-barra" />
          </div>
        ) : semDados ? (
          <div className="estado">Sem dados para este recorte.</div>
        ) : modo === 'grafico' || !tabela ? (
          children
        ) : (
          <div className="tabela-caixa">
            <table className="tabela">
              <thead>
                <tr>
                  {tabela.colunas.map((c) => (
                    <th key={c.chave} scope="col" className={c.alinhar === 'dir' ? '' : 'texto'}>
                      {c.rotulo}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tabela.linhas.map((l, i) => (
                  <tr key={i}>
                    {tabela.colunas.map((c) => (
                      <td key={c.chave} className={c.alinhar === 'dir' ? '' : 'texto'}>
                        {l[c.chave] ?? '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {nota && <div className="visual-nota">{nota}</div>}
    </section>
  )
}
