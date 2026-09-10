/**
 * Exportação das tabelas de painel, para conferir os números fora da tela.
 *
 * POR QUE EXISTE: auditar é comparar. Enquanto o número só existe dentro do
 * gráfico, comparar com o Power BI significa ler na tela e digitar no Excel —
 * lento e sujeito a erro de digitação, que depois vira "achei uma divergência"
 * quando a divergência foi o dedo.
 *
 * DOIS FORMATOS, PORQUE SÃO DUAS TAREFAS DIFERENTES:
 * - COPIAR (TSV) para a conferência rápida: cola direto em células do Excel,
 *   sem passar pelo assistente de importação.
 * - CSV para guardar: fica um arquivo com o período no nome, que serve de
 *   evidência do que a tela mostrava naquele recorte.
 */

export type ColunaExport = { chave: string; rotulo: string }
export type LinhaExport = Record<string, string | number>

/**
 * Marca de ordem de bytes (BOM) e faixa de acentos combinantes, escritas como
 * ESCAPE dentro de string em vez de caractere literal.
 *
 * POR QUE: os dois são invisíveis num editor de texto. Escritos literalmente,
 * ninguém consegue revisar a linha, e uma cópia/cola descuidada os remove sem
 * deixar rastro — aí o CSV volta a abrir com acentuação corrompida no Excel e a
 * causa é impossível de ver lendo o código.
 */
const BOM = String.fromCharCode(0xfeff)
const ACENTOS_COMBINANTES = new RegExp('[\\u0300-\\u036f]', 'g')

/**
 * Achata o valor e remove tabulação e quebra de linha.
 *
 * Sem isso, um rótulo com quebra de linha desloca todas as colunas seguintes e o
 * arquivo abre desalinhado no Excel — o tipo de defeito que faz a pessoa
 * desconfiar do dado quando o problema era o arquivo.
 */
function celula(v: string | number | undefined | null): string {
  if (v === undefined || v === null) return ''
  return String(v).replace(/[\t\r\n]+/g, ' ').trim()
}

/** TSV: o formato que cola direto em células do Excel, sem assistente. */
export function paraTsv(colunas: ColunaExport[], linhas: LinhaExport[]): string {
  const cab = colunas.map((c) => celula(c.rotulo)).join('\t')
  const corpo = linhas.map((l) => colunas.map((c) => celula(l[c.chave])).join('\t'))
  return [cab, ...corpo].join('\r\n')
}

/**
 * CSV com ponto e vírgula.
 *
 * NÃO É ESCOLHA ESTÉTICA: o Excel em português usa ';' como separador de lista.
 * Com ',' o arquivo abre com tudo empilhado numa única coluna, e a pessoa conclui
 * que a exportação está quebrada.
 */
export function paraCsv(colunas: ColunaExport[], linhas: LinhaExport[]): string {
  const escapar = (s: string) => (/[;"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

  const cab = colunas.map((c) => escapar(celula(c.rotulo))).join(';')
  const corpo = linhas.map((l) =>
    colunas.map((c) => escapar(celula(l[c.chave]))).join(';')
  )
  return [cab, ...corpo].join('\r\n')
}

/**
 * Nome de arquivo autoexplicativo, com o período embutido.
 *
 * Numa auditoria a pasta de downloads acumula dezenas de arquivos. Três
 * "ranking.csv" não dizem qual recorte gerou qual — e comparar o arquivo errado
 * com o Power BI produz uma divergência inteiramente falsa.
 */
export function nomeDeArquivo(titulo: string): string {
  const slug = titulo
    .normalize('NFD')
    .replace(ACENTOS_COMBINANTES, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

  let periodo = ''
  if (typeof window !== 'undefined') {
    const p = new URLSearchParams(window.location.search)
    const de = p.get('de')
    const ate = p.get('ate')
    if (de && ate) periodo = `_${de}_a_${ate}`
  }
  return `${slug || 'tabela'}${periodo}.csv`
}

/**
 * Dispara o download do CSV.
 *
 * O BOM no início é obrigatório: sem ele o Excel lê o arquivo na codepage do
 * sistema e "São Leopoldo" chega como "SÃ£o Leopoldo". O dado está correto, mas
 * ilegível — e num relatório de auditoria isso é o mesmo que errado.
 */
export function baixarCsv(nomeArquivo: string, csv: string): void {
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo
  document.body.appendChild(a)
  a.click()
  a.remove()
  // sem revoke, cada exportação vaza o blob até a aba ser recarregada
  URL.revokeObjectURL(url)
}

/** Copia para a área de transferência. Devolve false se o navegador recusar. */
export async function copiar(texto: string): Promise<boolean> {
  try {
    // localhost conta como contexto seguro, então a API moderna funciona aqui
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    // Reserva para o caso de a permissão ser negada: sem isto o botão falharia
    // em silêncio, que é pior que falhar avisando.
    try {
      const ta = document.createElement('textarea')
      ta.value = texto
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}
