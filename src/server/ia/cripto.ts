import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { diretorioDados } from '@/server/armazenamento'

/**
 * Cifra da chave do provedor de IA, em repouso.
 *
 * POR QUE CIFRAR SE O ARQUIVO JÁ É NOSSO: a chave de um provedor de IA é um
 * cartão de crédito — quem a tiver gasta em nome da Sebratel. Ela vive num
 * arquivo que aparece em backup do volume, em `docker cp` de suporte e na tela
 * de quem só foi conferir configuração, e nenhum desses lugares precisa saber a
 * chave. Cifrada, uma cópia do arquivo não é uma fatura.
 *
 * AES-256-GCM: além de cifrar, AUTENTICA. Um blob adulterado falha ao decifrar
 * em vez de devolver lixo que viraria uma requisição estranha ao provedor.
 *
 * DE ONDE VEM A CHAVE DE CIFRA, em ordem:
 *   1. `APP_SECRET` no ambiente — o caminho recomendado, e o único em que a
 *      chave não mora no mesmo lugar que o dado que ela protege.
 *   2. `data/.secret`, gerado aleatoriamente na primeira vez. Mesma metodologia
 *      do COM · Gestão Comercial: funciona sem configuração extra e sobrevive ao
 *      recriar o container, porque o diretório é um volume.
 *
 * ⚠️ O QUE A OPÇÃO 2 CUSTA, dito claramente: a chave passa a ficar AO LADO do
 * arquivo que ela cifra. Quem levar o volume leva os dois, e a cifra deixa de
 * proteger contra vazamento do volume — continua protegendo contra o caso mais
 * comum, que é a chave aparecer em claro num backup, num dump de suporte ou na
 * tela de quem só foi ler configuração. Definir `APP_SECRET` fecha essa brecha.
 *
 * Trocar a origem da chave torna o que está gravado ilegível — a tela trata isso
 * como "chave ilegível, cadastre de novo", não como erro genérico.
 */

const ALGORITMO = 'aes-256-gcm'

let cacheDoArquivo: string | null = null

/**
 * A chave guardada em `data/.secret`, gerando-a na primeira vez.
 *
 * `mode: 0o600` para o arquivo nascer legível só pelo dono — num volume
 * compartilhado, permissão padrão deixaria a chave de cifra legível por
 * qualquer processo que monte o mesmo diretório.
 */
function segredoDoArquivo(): string | null {
  if (cacheDoArquivo) return cacheDoArquivo
  const arquivo = join(diretorioDados(), '.secret')
  try {
    if (existsSync(arquivo)) {
      const lido = readFileSync(arquivo, 'utf8').trim()
      if (lido) {
        cacheDoArquivo = lido
        return lido
      }
    }
    const novo = randomBytes(48).toString('base64')
    mkdirSync(diretorioDados(), { recursive: true })
    writeFileSync(arquivo, `${novo}\n`, { encoding: 'utf8', mode: 0o600 })
    console.info(
      `[cripto] chave de cifra gerada em ${arquivo} — defina APP_SECRET no ambiente para controlá-la.`
    )
    cacheDoArquivo = novo
    return novo
  } catch (e) {
    console.warn(
      `[cripto] não consegui preparar ${arquivo}: ${e instanceof Error ? e.message : String(e)}`
    )
    return null
  }
}

function segredo(): Buffer {
  const bruto = process.env.APP_SECRET?.trim() || segredoDoArquivo()
  if (!bruto || bruto.length < 16) {
    throw new Error(
      'Sem chave de cifra: defina APP_SECRET no ambiente, ou deixe o diretório ' +
        'de dados gravável para que uma seja gerada em data/.secret.'
    )
  }
  // SHA-256 para transformar um segredo de tamanho livre nos 32 bytes que o
  // AES-256 exige. Não é derivação com custo (PBKDF2/scrypt) de propósito: o
  // segredo é de máquina, longo e aleatório, não uma senha que alguém decora.
  return createHash('sha256').update(bruto).digest()
}

/** Devolve `iv.tag.dados`, tudo em base64. */
export function cifrar(texto: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITMO, segredo(), iv)
  const dados = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), dados.toString('base64')].join('.')
}

/**
 * Decifra. Devolve `null` quando o blob não abre — trocaram o `APP_SECRET`,
 * o dado foi adulterado, ou veio de outra instalação.
 *
 * Não lança de propósito: quem chama precisa distinguir "não há chave
 * cadastrada" de "há uma chave que não consigo ler", e as duas levam à mesma
 * ação do administrador (cadastrar de novo) com mensagens diferentes.
 */
export function decifrar(blob: string): string | null {
  try {
    const [ivB, tagB, dadosB] = blob.split('.')
    if (!ivB || !tagB || !dadosB) return null

    const decipher = createDecipheriv(ALGORITMO, segredo(), Buffer.from(ivB, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(dadosB, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return null
  }
}

/** `true` se dá para cifrar — a tela usa isto para explicar o que falta. */
export function criptoConfigurada(): boolean {
  try {
    segredo()
    return true
  } catch {
    return false
  }
}

/**
 * Mostra só o fim da chave: `…a1b2`. Nunca a chave inteira.
 *
 * A tela precisa provar QUE existe uma chave e ajudar a conferir QUAL é, sem
 * relançá-la no navegador — onde ela voltaria a passar pela rede, pelo histórico
 * do DevTools e por qualquer extensão instalada.
 */
export function mascarar(chave: string): string {
  const limpa = chave.trim()
  if (limpa.length <= 4) return '…'
  return `…${limpa.slice(-4)}`
}
