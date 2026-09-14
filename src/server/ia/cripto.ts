import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * Cifra da chave do provedor de IA, em repouso.
 *
 * POR QUE CIFRAR SE O BANCO JÁ É NOSSO: a chave de um provedor de IA é um cartão
 * de crédito — quem a tiver gasta em nome da Sebratel. Ela vai para um banco que
 * aparece em backup, em dump de suporte e na tela de quem tem acesso de leitura
 * ao Postgres, e nenhum desses lugares precisa saber a chave. Cifrada, um dump
 * vazado não é uma fatura.
 *
 * AES-256-GCM: além de cifrar, AUTENTICA. Um blob adulterado falha ao decifrar
 * em vez de devolver lixo que viraria uma requisição estranha ao provedor.
 *
 * ⚠️ A CHAVE DE CIFRA VEM DE `APP_SECRET`. Sem ela este módulo se recusa a
 * operar, e é deliberado: derivar uma chave de algo previsível (nome do host,
 * string fixa no código) daria a aparência de cifra com a segurança de base64.
 * Trocar o `APP_SECRET` torna o que está gravado ilegível — a tela trata isso
 * como "chave ilegível, cadastre de novo", não como erro genérico.
 */

const ALGORITMO = 'aes-256-gcm'

function segredo(): Buffer {
  const bruto = process.env.APP_SECRET
  if (!bruto || bruto.length < 16) {
    throw new Error(
      'APP_SECRET ausente ou curto demais (mínimo 16 caracteres). ' +
        'Sem ele a chave do provedor de IA não pode ser guardada com segurança.'
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
