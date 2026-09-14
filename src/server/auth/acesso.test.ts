import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  lerMatriz,
  listarUsuarios,
  removerUsuario,
  resolverAcesso,
  salvarTela,
  salvarUsuario,
} from './acesso'

/**
 * O controle de acesso, contra o sistema de arquivos DE VERDADE.
 *
 * Cada teste roda num diretório temporário apontado por `DADOS_DIR` — o mesmo
 * caminho que o container usa, só que descartável. Não há mock: o que falha aqui
 * falha lá.
 *
 * ⚠️ O QUE ESTE ARQUIVO PROTEGE: erro de autorização não aparece como erro. Um
 * acesso liberado a mais não quebra tela, não gera log estranho e não some com
 * número nenhum — só deixa alguém ver o que não devia. Os casos abaixo tentam
 * exatamente isso.
 */

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'manutencao-acesso-'))
  process.env.DADOS_DIR = dir
  process.env.ADMIN_EMAILS = ''
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  delete process.env.DADOS_DIR
  delete process.env.ADMIN_EMAILS
})

const arquivo = () => join(dir, 'acesso.json')

describe('sem nada configurado', () => {
  it('todo mundo vê as 8 telas, como antes do controle existir', () => {
    const a = resolverAcesso('alguem@sebratel.com.br')
    expect(a.papel).toBe('viewer')
    expect(a.telas.size).toBe(8)
    expect(a.controleAtivo).toBe(true)
  })

  it('não cria arquivo só de ler', () => {
    resolverAcesso('alguem@sebratel.com.br')
    expect(() => readFileSync(arquivo())).toThrow()
  })
})

describe('papéis', () => {
  it('respeita o papel gravado no arquivo', () => {
    salvarUsuario('chefe@sebratel.com.br', 'admin', 'eu@sebratel.com.br')
    const a = resolverAcesso('chefe@sebratel.com.br')
    expect(a.papel).toBe('admin')
    expect(a.origemAdmin).toBe('arquivo')
  })

  it('ADMIN_EMAILS manda mais que o arquivo — a porta de emergência', () => {
    salvarUsuario('dono@sebratel.com.br', 'viewer', 'eu@sebratel.com.br')
    process.env.ADMIN_EMAILS = 'dono@sebratel.com.br'
    const a = resolverAcesso('dono@sebratel.com.br')
    expect(a.papel).toBe('admin')
    expect(a.origemAdmin).toBe('ambiente')
  })

  it('admin do ambiente aparece na lista mesmo sem entrada no arquivo', () => {
    process.env.ADMIN_EMAILS = 'fundador@sebratel.com.br'
    expect(listarUsuarios()).toEqual([
      { email: 'fundador@sebratel.com.br', papel: 'admin', nome: null, fixo: true },
    ])
  })

  it('grava, atualiza sem duplicar e remove', () => {
    salvarUsuario('p@sebratel.com.br', 'admin', 'eu@sebratel.com.br')
    salvarUsuario('p@sebratel.com.br', 'viewer', 'eu@sebratel.com.br')

    const lista = listarUsuarios()
    expect(lista).toHaveLength(1)
    expect(lista[0]?.papel).toBe('viewer')

    removerUsuario('p@sebratel.com.br')
    expect(listarUsuarios()).toHaveLength(0)
  })
})

describe('matriz de telas', () => {
  it('começa com as 8 em modo todos', () => {
    const m = lerMatriz()
    expect(m).toHaveLength(8)
    expect(m.every((t) => t.modo === 'todos' && t.emails.length === 0)).toBe(true)
  })

  it('tela em modo lista some para quem não está nela', () => {
    salvarTela('produtividade', 'lista', ['pode@sebratel.com.br'], 'eu@sebratel.com.br')

    expect(resolverAcesso('pode@sebratel.com.br').telas.has('produtividade')).toBe(true)

    const naoPode = resolverAcesso('outra@sebratel.com.br')
    expect(naoPode.telas.has('produtividade')).toBe(false)
    // as outras 7 continuam visíveis: restringir uma não tranca o dashboard
    expect(naoPode.telas.size).toBe(7)
  })

  it('administrador vê tela restrita mesmo fora da lista', () => {
    salvarUsuario('chefe@sebratel.com.br', 'admin', 'eu@sebratel.com.br')
    salvarTela('ofensores', 'lista', ['outro@sebratel.com.br'], 'eu@sebratel.com.br')
    expect(resolverAcesso('chefe@sebratel.com.br').telas.has('ofensores')).toBe(true)
  })

  it('substitui a lista inteira, sem sobra da gravação anterior', () => {
    salvarTela('tempos', 'lista', ['a@sebratel.com.br', 'b@sebratel.com.br'], 'eu@x.com')
    salvarTela('tempos', 'lista', ['c@sebratel.com.br'], 'eu@x.com')
    expect(lerMatriz().find((t) => t.tela === 'tempos')?.emails).toEqual(['c@sebratel.com.br'])
  })

  it('e-mail repetido na mesma gravação não duplica', () => {
    salvarTela('tempos', 'lista', ['a@sebratel.com.br', 'A@SEBRATEL.com.br'], 'eu@x.com')
    expect(lerMatriz().find((t) => t.tela === 'tempos')?.emails).toEqual(['a@sebratel.com.br'])
  })

  it('voltar para modo todos devolve a tela a quem não está na lista', () => {
    salvarTela('operacao', 'lista', ['so-eu@sebratel.com.br'], 'eu@x.com')
    expect(resolverAcesso('outra@sebratel.com.br').telas.has('operacao')).toBe(false)

    salvarTela('operacao', 'todos', [], 'eu@x.com')
    expect(resolverAcesso('outra@sebratel.com.br').telas.has('operacao')).toBe(true)
  })

  it('remover a pessoa também a tira das listas de tela', () => {
    salvarTela('recorrencia', 'lista', ['p@sebratel.com.br'], 'eu@sebratel.com.br')
    removerUsuario('p@sebratel.com.br')
    expect(resolverAcesso('p@sebratel.com.br').telas.has('recorrencia')).toBe(false)
  })

  it('normaliza o e-mail: maiúsculas e espaços não driblam a lista', () => {
    salvarTela('protocolos', 'lista', ['Pessoa@Sebratel.com.BR'], 'eu@x.com')
    expect(resolverAcesso('  PESSOA@sebratel.com.br  ').telas.has('protocolos')).toBe(true)
  })

  it('registra quem mexeu e quando', () => {
    salvarTela('tempos', 'lista', ['a@sebratel.com.br'], 'chefe@sebratel.com.br')
    const bruto = JSON.parse(readFileSync(arquivo(), 'utf8')) as {
      telas: Record<string, { atualizadoPor: string; atualizadoEm: string }>
    }
    expect(bruto.telas.tempos?.atualizadoPor).toBe('chefe@sebratel.com.br')
    expect(Date.parse(bruto.telas.tempos?.atualizadoEm ?? '')).not.toBeNaN()
  })
})

/**
 * O arquivo é um JSON num volume — editável à mão, e portanto capaz de chegar
 * torto. Nada aqui pode derrubar o dashboard nem abrir acesso por engano.
 */
describe('arquivo torto', () => {
  it('JSON corrompido cai no padrão em vez de lançar', () => {
    writeFileSync(arquivo(), '{ isto não é json', 'utf8')
    const a = resolverAcesso('alguem@sebratel.com.br')
    expect(a.telas.size).toBe(8)
    expect(a.papel).toBe('viewer')
  })

  it('arquivo vazio cai no padrão', () => {
    writeFileSync(arquivo(), '', 'utf8')
    expect(resolverAcesso('alguem@sebratel.com.br').telas.size).toBe(8)
  })

  it('papel desconhecido NÃO vira admin', () => {
    writeFileSync(
      arquivo(),
      JSON.stringify({ papeis: { 'x@sebratel.com.br': 'superusuario' }, telas: {} }),
      'utf8'
    )
    expect(resolverAcesso('x@sebratel.com.br').papel).toBe('viewer')
  })

  it('tela fora do catálogo é ignorada', () => {
    writeFileSync(
      arquivo(),
      JSON.stringify({ papeis: {}, telas: { inventada: { modo: 'lista', emails: [] } } }),
      'utf8'
    )
    expect(lerMatriz().map((t) => t.tela)).toHaveLength(8)
    expect(resolverAcesso('alguem@sebratel.com.br').telas.size).toBe(8)
  })

  it('campo com tipo errado não quebra a leitura', () => {
    writeFileSync(
      arquivo(),
      JSON.stringify({ papeis: 'nada disso', telas: { tempos: { modo: 'lista', emails: 'x' } } }),
      'utf8'
    )
    // `emails` não é lista: a tela fica restrita e SEM ninguém liberado, que é o
    // lado seguro de um arquivo torto.
    expect(resolverAcesso('alguem@sebratel.com.br').telas.has('tempos')).toBe(false)
  })

  it('grava de forma atômica — não deixa .tmp para trás', () => {
    salvarTela('tempos', 'lista', ['a@sebratel.com.br'], 'eu@x.com')
    expect(() => readFileSync(`${arquivo()}.tmp`)).toThrow()
  })
})

describe('diretório de dados indisponível', () => {
  it('libera as telas e marca controleAtivo=false', () => {
    // caminho impossível de criar: um arquivo comum no lugar do diretório
    const bloqueio = join(dir, 'bloqueio')
    writeFileSync(bloqueio, 'sou um arquivo, não um diretório', 'utf8')
    process.env.DADOS_DIR = join(bloqueio, 'dentro')

    const a = resolverAcesso('alguem@sebratel.com.br')
    expect(a.controleAtivo).toBe(false)
    expect(a.telas.size).toBe(8)
  })
})
