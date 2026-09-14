/**
 * Adaptadores dos provedores de IA.
 *
 * Três famílias cobrem o mercado que interessa aqui:
 *   anthropic — Messages API (Claude)
 *   openai    — /chat/completions. Cobre também Azure, Groq, OpenRouter e
 *               Together, que falam o mesmo dialeto; basta trocar a base URL.
 *   gemini    — generateContent do Google
 *
 * POR QUE HTTP CRU E NÃO OS SDKs: são três dialetos atrás de uma interface só
 * (`conversar` e `modelos`). Com SDKs seriam três dependências, três formatos de
 * erro e três modelos de configuração para embrulhar do mesmo jeito — e a parte
 * que usamos de cada API é uma requisição POST. Decisão tomada com o usuário em
 * 14/09/2026, mesmo desenho do COM · Gestão Comercial.
 *
 * ⚠️ A CHAVE NUNCA SAI DAQUI. Ela é decifrada no servidor, usada na requisição e
 * descartada. Nenhuma rota devolve a chave ao navegador — a tela recebe só os
 * quatro últimos caracteres.
 */

export const TIPOS = ['anthropic', 'openai', 'gemini'] as const
export type TipoProvedor = (typeof TIPOS)[number]

export const ROTULO_TIPO: Record<TipoProvedor, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI e compatíveis',
  gemini: 'Google Gemini',
}

/**
 * Sugestão de modelo por provedor, usada quando o campo fica vazio.
 *
 * ⚠️ ENVELHECE. É só um ponto de partida — a tela busca a lista real do provedor
 * com a chave cadastrada, e é essa lista que vale. Modelo escrito em código vira
 * mentira em poucos meses.
 */
export const MODELO_SUGERIDO: Record<TipoProvedor, string> = {
  anthropic: 'claude-opus-5',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash',
}

export function ehTipoValido(v: string): v is TipoProvedor {
  return (TIPOS as readonly string[]).includes(v)
}

export type ConfigProvedor = {
  tipo: TipoProvedor
  modelo: string
  chave: string
  baseUrl?: string | null
  maxTokens?: number
}

export type Provedor = {
  nome: TipoProvedor
  conversar(sistema: string, pergunta: string): Promise<string>
  modelos(): Promise<{ id: string; label: string }[]>
}

/**
 * Orçamento de tempo por chamada.
 *
 * O pedido nasce de um clique numa tela de dashboard: passou disso, a pessoa já
 * desistiu. Sem timeout, uma chamada pendurada segura uma conexão do servidor
 * até o sistema operacional desistir, que é ordem de grandeza mais.
 */
const TIMEOUT_MS = Number(process.env.IA_TIMEOUT_MS ?? 60_000)

const semBarra = (u: string) => u.replace(/\/+$/, '')

/** Mensagem de erro útil a partir do corpo que o provedor devolveu. */
function explicar(status: number, corpo: string): string {
  let detalhe = corpo.slice(0, 300)
  try {
    const j = JSON.parse(corpo) as {
      error?: { message?: string; type?: string } | string
      message?: string
    }
    const e = j.error
    detalhe =
      (typeof e === 'string' ? e : e?.message) ?? j.message ?? detalhe
  } catch {
    // corpo não era JSON; fica o texto cru cortado
  }

  if (status === 401 || status === 403) {
    return `O provedor recusou a chave (HTTP ${status}). ${detalhe}`
  }
  if (status === 404) {
    return `Modelo ou endereço não encontrado (HTTP 404). Confira o modelo e a base URL. ${detalhe}`
  }
  if (status === 429) {
    return `O provedor está limitando as chamadas (HTTP 429). ${detalhe}`
  }
  return `O provedor respondeu ${status}. ${detalhe}`
}

async function chamar<T>(
  url: string,
  corpo: unknown,
  cabecalhos: Record<string, string>
): Promise<T> {
  let r: Response
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...cabecalhos },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    // `TimeoutError` é o nome que o AbortSignal.timeout usa ao estourar.
    if (e instanceof Error && e.name === 'TimeoutError') {
      throw new Error(`O provedor de IA não respondeu em ${Math.round(TIMEOUT_MS / 1000)}s.`)
    }
    throw new Error(
      `Não consegui falar com o provedor de IA: ${e instanceof Error ? e.message : String(e)}`
    )
  }

  if (!r.ok) throw new Error(explicar(r.status, await r.text().catch(() => '')))
  return (await r.json()) as T
}

async function buscar<T>(url: string, cabecalhos: Record<string, string>): Promise<T> {
  const r = await fetch(url, {
    headers: cabecalhos,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!r.ok) throw new Error(explicar(r.status, await r.text().catch(() => '')))
  return (await r.json()) as T
}

/* ─────────────────────────────── Anthropic ────────────────────────────── */

type RespostaAnthropic = { content?: { type?: string; text?: string }[] }
type ModelosAnthropic = { data?: { id?: string; display_name?: string }[] }

function anthropic(cfg: ConfigProvedor): Provedor {
  const base = () => semBarra(cfg.baseUrl || 'https://api.anthropic.com')
  const cabecalhos = () => ({
    'x-api-key': cfg.chave,
    'anthropic-version': '2023-06-01',
  })

  return {
    nome: 'anthropic',
    async conversar(sistema, pergunta) {
      const json = await chamar<RespostaAnthropic>(
        `${base()}/v1/messages`,
        {
          model: cfg.modelo,
          max_tokens: cfg.maxTokens ?? 2000,
          system: sistema,
          messages: [{ role: 'user', content: pergunta }],
        },
        cabecalhos()
      )
      // A resposta é uma LISTA de blocos, não um texto. Blocos que não são
      // texto (raciocínio, uso de ferramenta) entram aqui se o modelo os
      // produzir, e concatená-los cegamente colocaria ruído na tela.
      return (json.content ?? [])
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join('\n')
    },
    async modelos() {
      const json = await buscar<ModelosAnthropic>(
        `${base()}/v1/models?limit=100`,
        cabecalhos()
      )
      return (json.data ?? [])
        .filter((m): m is { id: string; display_name?: string } => Boolean(m.id))
        .map((m) => ({ id: m.id, label: m.display_name ?? m.id }))
    },
  }
}

/* ────────────────────────── OpenAI e compatíveis ──────────────────────── */

type RespostaOpenai = { choices?: { message?: { content?: string } }[] }
type ModelosOpenai = { data?: { id?: string }[] }

function openai(cfg: ConfigProvedor): Provedor {
  const base = () => semBarra(cfg.baseUrl || 'https://api.openai.com/v1')
  const cabecalhos = () => ({ authorization: `Bearer ${cfg.chave}` })

  return {
    nome: 'openai',
    async conversar(sistema, pergunta) {
      const json = await chamar<RespostaOpenai>(
        `${base()}/chat/completions`,
        {
          model: cfg.modelo,
          // `max_completion_tokens` e não `max_tokens`: o nome antigo é
          // recusado pelos modelos de raciocínio da OpenAI.
          max_completion_tokens: cfg.maxTokens ?? 2000,
          messages: [
            { role: 'system', content: sistema },
            { role: 'user', content: pergunta },
          ],
        },
        cabecalhos()
      )
      return json.choices?.[0]?.message?.content ?? ''
    },
    async modelos() {
      const json = await buscar<ModelosOpenai>(`${base()}/models`, cabecalhos())
      const todos = (json.data ?? []).filter((m): m is { id: string } => Boolean(m.id))
      // A lista traz embeddings, TTS e moderação junto. Filtra o que conversa —
      // e, se o filtro não casar nada (provedor compatível com nomes próprios),
      // devolve tudo em vez de uma lista vazia que pareceria falha de conexão.
      const conversam = todos.filter((m) =>
        /gpt|^o\d|chat|llama|mistral|qwen|claude|gemini|deepseek/i.test(m.id)
      )
      return (conversam.length ? conversam : todos)
        .map((m) => ({ id: m.id, label: m.id }))
        .sort((a, b) => a.id.localeCompare(b.id))
    },
  }
}

/* ──────────────────────────────── Gemini ──────────────────────────────── */

type RespostaGemini = { candidates?: { content?: { parts?: { text?: string }[] } }[] }
type ModelosGemini = {
  models?: { name?: string; displayName?: string; supportedGenerationMethods?: string[] }[]
}

function gemini(cfg: ConfigProvedor): Provedor {
  const base = () =>
    semBarra(cfg.baseUrl || 'https://generativelanguage.googleapis.com/v1beta')
  const cabecalhos = () => ({ 'x-goog-api-key': cfg.chave })

  return {
    nome: 'gemini',
    async conversar(sistema, pergunta) {
      const json = await chamar<RespostaGemini>(
        `${base()}/models/${encodeURIComponent(cfg.modelo)}:generateContent`,
        {
          systemInstruction: { parts: [{ text: sistema }] },
          contents: [{ role: 'user', parts: [{ text: pergunta }] }],
          generationConfig: { maxOutputTokens: cfg.maxTokens ?? 2000 },
        },
        cabecalhos()
      )
      return (json.candidates?.[0]?.content?.parts ?? [])
        .filter((p): p is { text: string } => typeof p.text === 'string')
        .map((p) => p.text)
        .join('\n')
    },
    async modelos() {
      const json = await buscar<ModelosGemini>(`${base()}/models?pageSize=200`, cabecalhos())
      return (json.models ?? [])
        .filter((m) => m.name && (m.supportedGenerationMethods ?? []).includes('generateContent'))
        .map((m) => {
          const id = String(m.name).replace(/^models\//, '')
          return { id, label: m.displayName ?? id }
        })
    },
  }
}

export function criarProvedor(cfg: ConfigProvedor): Provedor {
  if (cfg.tipo === 'anthropic') return anthropic(cfg)
  if (cfg.tipo === 'openai') return openai(cfg)
  return gemini(cfg)
}
