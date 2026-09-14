import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Onde a configuração do dashboard mora: arquivos JSON num diretório de dados.
 *
 * MESMA METODOLOGIA DO COM · GESTÃO COMERCIAL (`comercial_pbi`), e a escolha é
 * proporcional ao que se guarda: papéis de algumas dezenas de pessoas, a matriz
 * de 8 telas e um provedor de IA. Isso não é dado de negócio — é configuração,
 * lida em toda requisição e escrita de vez em quando, medindo poucos KB.
 *
 * ⚠️ NÃO EXISTE CADASTRO DE LOGIN AQUI, e é o ponto que mais confunde: quem diz
 * QUEM a pessoa é continua sendo o Google, via Firebase. Não há tabela de
 * usuários, não há senha, não há convite. O que estes arquivos guardam é
 * AUTORIZAÇÃO — o que cada e-mail já autenticado pode ver.
 *
 * POR QUE ARQUIVO E NÃO BANCO: um Postgres para isto seria um serviço a
 * provisionar, um esquema a migrar e mais uma dependência entre o dashboard e
 * ficar de pé — em troca de consultas que cabem num arquivo de 2 KB. O preço do
 * arquivo é precisar de volume; o preço do banco era não subir sem ele.
 */

/**
 * `/app/data` é onde o volume é montado no container (ver docker-compose.yml).
 * Em desenvolvimento cai em `./data`, na raiz do projeto, que está no
 * `.gitignore` — configuração local não tem por que virar commit.
 */
export function diretorioDados(): string {
  return process.env.DADOS_DIR ?? (process.env.NODE_ENV === 'production' ? '/app/data' : 'data')
}

export const ARQUIVO_ACESSO = () => join(diretorioDados(), 'acesso.json')
export const ARQUIVO_IA = () => join(diretorioDados(), 'ia.json')

/**
 * Lê um JSON, devolvendo o padrão quando o arquivo não existe ou está ilegível.
 *
 * NUNCA LANÇA. Arquivo de configuração corrompido não pode derrubar o
 * dashboard: o efeito de cair para o padrão é o controle de acesso ficar
 * permissivo e visível na tela, enquanto o efeito de lançar seria ninguém
 * conseguir abrir nada — e a segunda falha é pior, porque a barreira que
 * importa (autenticação) não depende deste arquivo.
 */
export function lerJson<T>(caminho: string, padrao: T): T {
  try {
    if (!existsSync(caminho)) return padrao
    const bruto = readFileSync(caminho, 'utf8').trim()
    if (!bruto) return padrao
    return JSON.parse(bruto) as T
  } catch (e) {
    console.warn(
      `[armazenamento] não consegui ler ${caminho}: ${
        e instanceof Error ? e.message : String(e)
      } — seguindo com o padrão.`
    )
    return padrao
  }
}

/**
 * Grava um JSON de forma ATÔMICA: escreve num temporário e renomeia por cima.
 *
 * `rename` no mesmo sistema de arquivos é atômico — ou o arquivo antigo está
 * lá inteiro, ou o novo está. Escrever direto no destino tem uma janela em que
 * ele está truncado, e se o processo morrer nela (deploy no meio de um Salvar,
 * container sem memória) o arquivo de acesso vira lixo: todo mundo perde o
 * papel e volta a ser viewer, com um `JSON.parse` falhando em silêncio.
 *
 * É uma janela curta e improvável. Também custa uma linha a mais fechá-la.
 */
export function gravarJson(caminho: string, dados: unknown): void {
  mkdirSync(dirname(caminho), { recursive: true })
  const temporario = `${caminho}.tmp`
  writeFileSync(temporario, `${JSON.stringify(dados, null, 2)}\n`, 'utf8')
  renameSync(temporario, caminho)
}

/**
 * O diretório de dados está gravável?
 *
 * A tela de Configurações usa isto para dizer o que falta em vez de deixar o
 * primeiro Salvar falhar com erro de permissão — que é o sintoma clássico de
 * volume montado sem o `chown` no Dockerfile, e não se parece nem um pouco com
 * a causa.
 */
export function podeGravar(): { ok: true } | { ok: false; motivo: string } {
  const dir = diretorioDados()
  try {
    mkdirSync(dir, { recursive: true })
    const teste = join(dir, '.escrita-teste')
    writeFileSync(teste, 'ok', 'utf8')
    renameSync(teste, join(dir, '.escrita-teste.ok'))
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      motivo: `não consigo escrever em ${dir}: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}
