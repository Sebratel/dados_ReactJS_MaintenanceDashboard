import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SQL_ESQUEMA } from '@/server/db/dash'
import {
  lerMatriz,
  listarUsuarios,
  removerUsuario,
  resolverAcesso,
  salvarTela,
  salvarUsuario,
  type Executor,
} from './acesso'

/**
 * Este teste roda o SQL DE VERDADE.
 *
 * `@electric-sql/pglite` é um Postgres compilado para WASM, em processo. Não é
 * um mock: o `CREATE SCHEMA`, os `CHECK`, o `ON CONFLICT` e a chave estrangeira
 * com `ON DELETE CASCADE` são executados pelo mesmo motor que roda no servidor.
 *
 * POR QUE ISSO IMPORTA AQUI: não há Postgres da aplicação provisionado ainda, e
 * entregar esquema e consultas que nunca rodaram seria empurrar a primeira
 * execução para o dia do deploy — com o agravante de que erro de autorização não
 * aparece como erro, aparece como gente vendo o que não devia.
 */

let pg: PGlite
let exec: Executor

beforeEach(async () => {
  pg = new PGlite()
  await pg.exec(SQL_ESQUEMA)
  exec = async (sql, params) => {
    const r = await pg.query(sql, params ? [...params] : [])
    return r.rows as never
  }
  process.env.DASH_HOST = 'memoria-de-teste'
  process.env.ADMIN_EMAILS = ''
})

afterEach(async () => {
  await pg.close()
  delete process.env.DASH_HOST
  delete process.env.ADMIN_EMAILS
})

describe('esquema', () => {
  it('é idempotente — rodar de novo não quebra', async () => {
    await expect(pg.exec(SQL_ESQUEMA)).resolves.toBeDefined()
  })

  it('recusa papel inválido', async () => {
    await expect(
      pg.query("INSERT INTO dash.usuarios (email, papel) VALUES ('x@y.com', 'chefe')")
    ).rejects.toThrow()
  })

  it('recusa uma segunda linha de configuração de IA', async () => {
    await pg.query('INSERT INTO dash.config_ia (id) VALUES (1)')
    await expect(pg.query('INSERT INTO dash.config_ia (id) VALUES (2)')).rejects.toThrow()
  })

  it('apaga as pessoas junto com a tela (cascade)', async () => {
    await salvarTela('ofensores', 'lista', ['a@sebratel.com.br'], 'admin@sebratel.com.br', exec)
    await pg.query("DELETE FROM dash.acesso_telas WHERE tela = 'ofensores'")
    const r = await pg.query('SELECT count(*)::int AS n FROM dash.acesso_tela_pessoas')
    expect((r.rows[0] as { n: number }).n).toBe(0)
  })
})

describe('resolverAcesso', () => {
  it('sem configuração nenhuma, todo mundo vê as 8 telas', async () => {
    const a = await resolverAcesso('alguem@sebratel.com.br', exec)
    expect(a.papel).toBe('viewer')
    expect(a.telas.size).toBe(8)
    expect(a.controleAtivo).toBe(true)
  })

  it('respeita o papel gravado no banco', async () => {
    await salvarUsuario('chefe@sebratel.com.br', 'admin', 'eu@sebratel.com.br', exec)
    const a = await resolverAcesso('chefe@sebratel.com.br', exec)
    expect(a.papel).toBe('admin')
    expect(a.origemAdmin).toBe('banco')
  })

  it('ADMIN_EMAILS manda mais que o banco — a porta de emergência', async () => {
    await salvarUsuario('dono@sebratel.com.br', 'viewer', 'eu@sebratel.com.br', exec)
    process.env.ADMIN_EMAILS = 'dono@sebratel.com.br'
    const a = await resolverAcesso('dono@sebratel.com.br', exec)
    expect(a.papel).toBe('admin')
    expect(a.origemAdmin).toBe('ambiente')
  })

  it('tela em modo lista some para quem não está nela', async () => {
    await salvarTela('produtividade', 'lista', ['pode@sebratel.com.br'], 'eu@sebratel.com.br', exec)

    const pode = await resolverAcesso('pode@sebratel.com.br', exec)
    expect(pode.telas.has('produtividade')).toBe(true)

    const naoPode = await resolverAcesso('outra@sebratel.com.br', exec)
    expect(naoPode.telas.has('produtividade')).toBe(false)
    // as outras 7 continuam visíveis: restringir uma não tranca o dashboard
    expect(naoPode.telas.size).toBe(7)
  })

  it('administrador vê tela restrita mesmo sem estar na lista', async () => {
    await salvarUsuario('chefe@sebratel.com.br', 'admin', 'eu@sebratel.com.br', exec)
    await salvarTela('ofensores', 'lista', ['outro@sebratel.com.br'], 'eu@sebratel.com.br', exec)
    const a = await resolverAcesso('chefe@sebratel.com.br', exec)
    expect(a.telas.has('ofensores')).toBe(true)
  })

  it('normaliza o e-mail: maiúsculas e espaços não driblam a lista', async () => {
    await salvarTela('protocolos', 'lista', ['Pessoa@Sebratel.com.BR'], 'eu@sebratel.com.br', exec)
    const a = await resolverAcesso('  PESSOA@sebratel.com.br  ', exec)
    expect(a.telas.has('protocolos')).toBe(true)
  })

  it('banco fora do ar libera as telas e marca controleAtivo=false', async () => {
    const quebrado: Executor = () => Promise.reject(new Error('conexão recusada'))
    const a = await resolverAcesso('alguem@sebratel.com.br', quebrado)
    expect(a.controleAtivo).toBe(false)
    expect(a.telas.size).toBe(8)
  })

  it('sem DASH_HOST o controle fica inativo, sem consultar nada', async () => {
    delete process.env.DASH_HOST
    const explode: Executor = () => Promise.reject(new Error('não deveria consultar'))
    const a = await resolverAcesso('alguem@sebratel.com.br', explode)
    expect(a.controleAtivo).toBe(false)
    expect(a.telas.size).toBe(8)
  })
})

describe('gestão de usuários', () => {
  it('grava, atualiza sem duplicar e remove', async () => {
    await salvarUsuario('p@sebratel.com.br', 'admin', 'eu@sebratel.com.br', exec)
    await salvarUsuario('p@sebratel.com.br', 'viewer', 'eu@sebratel.com.br', exec)

    const lista = await listarUsuarios(exec)
    expect(lista).toHaveLength(1)
    expect(lista[0]?.papel).toBe('viewer')

    await removerUsuario('p@sebratel.com.br', exec)
    expect(await listarUsuarios(exec)).toHaveLength(0)
  })

  it('remover a pessoa também a tira das listas de tela', async () => {
    await salvarTela('recorrencia', 'lista', ['p@sebratel.com.br'], 'eu@sebratel.com.br', exec)
    await removerUsuario('p@sebratel.com.br', exec)

    const a = await resolverAcesso('p@sebratel.com.br', exec)
    expect(a.telas.has('recorrencia')).toBe(false)
  })

  it('admin do ambiente aparece na lista mesmo sem linha no banco', async () => {
    process.env.ADMIN_EMAILS = 'fundador@sebratel.com.br'
    const lista = await listarUsuarios(exec)
    expect(lista).toEqual([
      { email: 'fundador@sebratel.com.br', papel: 'admin', nome: null, fixo: true },
    ])
  })
})

describe('matriz de telas', () => {
  it('começa com as 8 telas em modo todos', async () => {
    const m = await lerMatriz(exec)
    expect(m).toHaveLength(8)
    expect(m.every((t) => t.modo === 'todos' && t.emails.length === 0)).toBe(true)
  })

  it('substitui a lista inteira, sem sobra da gravação anterior', async () => {
    await salvarTela('tempos', 'lista', ['a@sebratel.com.br', 'b@sebratel.com.br'], 'eu@x.com', exec)
    await salvarTela('tempos', 'lista', ['c@sebratel.com.br'], 'eu@x.com', exec)

    const m = await lerMatriz(exec)
    expect(m.find((t) => t.tela === 'tempos')?.emails).toEqual(['c@sebratel.com.br'])
  })

  it('e-mail repetido na mesma gravação não duplica', async () => {
    await salvarTela('tempos', 'lista', ['a@sebratel.com.br', 'A@SEBRATEL.com.br'], 'eu@x.com', exec)
    const m = await lerMatriz(exec)
    expect(m.find((t) => t.tela === 'tempos')?.emails).toEqual(['a@sebratel.com.br'])
  })

  it('voltar para modo todos devolve a tela a quem não está na lista', async () => {
    await salvarTela('operacao', 'lista', ['so-eu@sebratel.com.br'], 'eu@x.com', exec)
    expect((await resolverAcesso('outra@sebratel.com.br', exec)).telas.has('operacao')).toBe(false)

    await salvarTela('operacao', 'todos', [], 'eu@x.com', exec)
    expect((await resolverAcesso('outra@sebratel.com.br', exec)).telas.has('operacao')).toBe(true)
  })
})
