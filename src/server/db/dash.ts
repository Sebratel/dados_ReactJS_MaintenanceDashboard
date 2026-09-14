import { Pool, type QueryResultRow } from 'pg'
import { configurarTiposPg } from './tipos'

configurarTiposPg()

/**
 * Pool do banco DA APLICAÇÃO (`DASH_*`) — o primeiro banco onde este sistema
 * ESCREVE.
 *
 * Todos os outros são fontes de leitura de terceiros: o ERP Voalle é réplica
 * read-only, o Data Hub é MariaDB de carga diária, o AutoISP é telemetria. Nada
 * de configuração nossa pode morar neles, e não é só etiqueta: o ERP recusa
 * escrita ("cannot execute CREATE SCHEMA in a read-only transaction"), e gravar
 * num banco de outra equipe transformaria nossa configuração no problema de
 * manutenção deles.
 *
 * O QUE VIVE AQUI: papéis, matriz de acesso por tela e a configuração do
 * provedor de IA. Nenhum dado de negócio — indicador continua vindo do ERP ao
 * vivo. Se este banco sumir, o dashboard perde controle de acesso e IA, não
 * perde número.
 *
 * ⚠️ POOL PREGUIÇOSO, como em `erp.ts`. `next build` importa todo módulo de rota
 * para ler a config do segmento, e criar o pool no corpo do módulo faria o build
 * exigir credencial que o container não tem. Ver o comentário longo de `erp.ts`.
 *
 * ⚠️ ESTE BANCO É OPCIONAL POR DESENHO. Sem `DASH_HOST` o dashboard funciona
 * como antes do controle de acesso: todo mundo do domínio autorizado vê as 8
 * telas, e Configurações avisa o que falta configurar. Falhar fechado aqui
 * seria trocar "sem gestão de acesso" por "ninguém entra", o que é pior: a
 * autenticação, que é a barreira que importa, não depende deste banco.
 */

const globalParaPool = globalThis as unknown as { __poolDash?: Pool }

let poolDoModulo: Pool | undefined

/** `true` quando o banco da aplicação está configurado. */
export function dashConfigurado(): boolean {
  return Boolean(process.env.DASH_HOST)
}

function criar(): Pool {
  const host = process.env.DASH_HOST
  if (!host) throw new Error('DASH_HOST ausente (ver .env.example)')

  const p = new Pool({
    host,
    port: Number(process.env.DASH_PORT ?? 5432),
    database: process.env.DASH_DATABASE ?? 'dash',
    user: process.env.DASH_USER ?? 'dash',
    password: process.env.DASH_PASSWORD,
    max: Number(process.env.DASH_POOL_MAX ?? 4),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // curto de propósito: consulta de configuração é pequena, e uma que demore
    // segundos está travada, não lenta — e ela roda no caminho de TODA página
    statement_timeout: 10_000,
    query_timeout: 12_000,
    application_name: 'dashboard-manutencao-fttx',
  })

  p.on('error', (e) => {
    console.error('[pool dash] erro em conexão idle:', e.message)
  })

  return p
}

export function obterPoolDash(): Pool {
  const existente = poolDoModulo ?? globalParaPool.__poolDash
  if (existente) return existente

  const novo = criar()
  poolDoModulo = novo
  if (process.env.NODE_ENV !== 'production') globalParaPool.__poolDash = novo
  return novo
}

export async function consultarDash<T extends QueryResultRow>(
  sql: string,
  params: readonly unknown[] = []
): Promise<T[]> {
  const r = await obterPoolDash().query<T>(sql, params as unknown[])
  return r.rows
}

/**
 * O ESQUEMA, em SQL idempotente.
 *
 * Fica aqui, e não num diretório de migrations numeradas, porque são quatro
 * tabelas de configuração que ninguém versiona em produção paralela. `IF NOT
 * EXISTS` em tudo: rodar duas vezes é inofensivo, o que permite chamá-lo no
 * start do servidor e no script de migração sem coordenar qual roda primeiro.
 *
 * Schema próprio (`dash`) em vez de tabelas soltas no `public`: se um dia
 * apontarem `DASH_DATABASE` para um banco compartilhado, nossas tabelas ficam
 * juntas, identificáveis e removíveis de uma vez — e `app_usuarios` no `public`
 * de um banco alheio é exatamente o tipo de coisa que ninguém sabe de quem é.
 */
export const SQL_ESQUEMA = /* sql */ `
CREATE SCHEMA IF NOT EXISTS dash;

-- Papel de cada pessoa. Quem não está aqui é 'viewer'.
CREATE TABLE IF NOT EXISTS dash.usuarios (
  email          text PRIMARY KEY,
  papel          text NOT NULL DEFAULT 'viewer',
  nome           text,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  atualizado_por text,
  CONSTRAINT usuarios_papel_valido CHECK (papel IN ('admin', 'viewer'))
);

-- Modo de acesso de cada tela. Tela sem linha aqui é 'todos' — o padrão
-- preserva o comportamento anterior ao controle de acesso, para ligar a
-- funcionalidade não escurecer o dashboard de ninguém sem aviso.
CREATE TABLE IF NOT EXISTS dash.acesso_telas (
  tela           text PRIMARY KEY,
  modo           text NOT NULL DEFAULT 'todos',
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  atualizado_por text,
  CONSTRAINT acesso_telas_modo_valido CHECK (modo IN ('todos', 'lista'))
);

-- Quem vê a tela quando o modo é 'lista'.
CREATE TABLE IF NOT EXISTS dash.acesso_tela_pessoas (
  tela  text NOT NULL REFERENCES dash.acesso_telas(tela) ON DELETE CASCADE,
  email text NOT NULL,
  PRIMARY KEY (tela, email)
);

-- Uma linha só, sempre a de id 1. O CHECK é o que impede a segunda: sem ele,
-- um UPDATE sem WHERE certo criaria duas configurações de IA e o sistema
-- passaria a usar "a primeira que voltar", que muda sem aviso.
CREATE TABLE IF NOT EXISTS dash.config_ia (
  id             int PRIMARY KEY DEFAULT 1,
  provedor       text,
  modelo         text,
  chave_cifrada  text,
  atualizado_em  timestamptz,
  atualizado_por text,
  CONSTRAINT config_ia_linha_unica CHECK (id = 1)
);
`

let esquemaPronto: Promise<void> | undefined

/**
 * Garante o esquema uma vez por processo.
 *
 * A promessa é memoizada, não o resultado: dez requests simultâneos no primeiro
 * acesso compartilham um único `CREATE SCHEMA`. Se falhar, a memoização é
 * desfeita para a próxima tentativa não herdar o erro para sempre.
 */
export function garantirEsquema(): Promise<void> {
  esquemaPronto ??= consultarDash(SQL_ESQUEMA)
    .then(() => undefined)
    .catch((e: unknown) => {
      esquemaPronto = undefined
      throw e
    })
  return esquemaPronto
}
