'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { buscarJson } from '@/lib/clienteHttp'

/**
 * Cadastro do provedor de IA.
 *
 * Diferente das outras abas, esta grava DIRETO em vez de acumular rascunho — e
 * é proposital. O que se grava aqui é uma credencial: manter uma chave de API
 * pendurada num rascunho que a pessoa pode esquecer de salvar (ou descartar sem
 * querer) troca uma gravação a mais por uma chave digitada duas vezes. E digitar
 * de novo é o momento em que ela vai parar num gerenciador de senhas ou num
 * histórico de área de transferência.
 */

type Tipo = { id: string; rotulo: string; modeloSugerido: string }

type ConfigIa = {
  configurado: boolean
  tipo: string | null
  modelo: string | null
  baseUrl: string | null
  chaveMascarada: string | null
  chaveIlegivel: boolean
  atualizadoEm: string | null
  atualizadoPor: string | null
  faltaArmazenamento: boolean
  faltaSegredo: boolean
  tipos: Tipo[]
}

export function AbaIA() {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['config', 'ia'],
    queryFn: () => buscarJson<ConfigIa>('/api/config/ia'),
    staleTime: 60_000,
  })

  const [tipo, setTipo] = useState<string | null>(null)
  const [modelo, setModelo] = useState<string | null>(null)
  const [chave, setChave] = useState('')
  const [baseUrl, setBaseUrl] = useState<string | null>(null)
  const [modelos, setModelos] = useState<{ id: string; label: string }[] | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [erroAcao, setErroAcao] = useState<string | null>(null)

  // O formulário começa espelhando o servidor; `??` deixa a edição local vencer
  // assim que a pessoa mexe, sem precisar de um efeito que copia estado.
  const tipoAtual = tipo ?? data?.tipo ?? 'anthropic'
  const modeloAtual = modelo ?? data?.modelo ?? ''
  const baseUrlAtual = baseUrl ?? data?.baseUrl ?? ''
  const sugerido = data?.tipos.find((t) => t.id === tipoAtual)?.modeloSugerido ?? ''

  const salvar = useMutation({
    mutationFn: () =>
      buscarJson<ConfigIa>('/api/config/ia', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tipo: tipoAtual,
          modelo: modeloAtual || sugerido,
          chave: chave.trim() || undefined,
          baseUrl: baseUrlAtual.trim() || null,
        }),
      }),
    onSuccess: (novo) => {
      qc.setQueryData(['config', 'ia'], novo)
      setChave('')
      setErroAcao(null)
      setAviso('Provedor salvo.')
    },
    onError: (e: unknown) => {
      setAviso(null)
      setErroAcao(e instanceof Error ? e.message : String(e))
    },
  })

  const buscarModelos = useMutation({
    mutationFn: () =>
      buscarJson<{ modelos: { id: string; label: string }[] }>('/api/config/ia', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tipo: tipoAtual,
          chave: chave.trim() || undefined,
          baseUrl: baseUrlAtual.trim() || null,
        }),
      }),
    onSuccess: (r) => {
      setModelos(r.modelos)
      setErroAcao(null)
      setAviso(
        r.modelos.length
          ? `${r.modelos.length} modelos encontrados — a chave funciona.`
          : 'A chave funciona, mas o provedor não listou modelos.'
      )
    },
    onError: (e: unknown) => {
      setModelos(null)
      setAviso(null)
      setErroAcao(e instanceof Error ? e.message : String(e))
    },
  })

  const remover = useMutation({
    mutationFn: () => buscarJson<ConfigIa>('/api/config/ia', { method: 'DELETE' }),
    onSuccess: (novo) => {
      qc.setQueryData(['config', 'ia'], novo)
      setChave('')
      setModelos(null)
      setAviso('Provedor removido. O botão de explicar some dos painéis.')
    },
  })

  if (isLoading) return <Caixa>Carregando configuração de IA…</Caixa>
  if (error) return <Caixa erro>{error instanceof Error ? error.message : String(error)}</Caixa>
  if (!data) return <Caixa>Sem configuração para mostrar.</Caixa>

  const bloqueado = data.faltaArmazenamento || data.faltaSegredo

  return (
    <section className="grid gap-4">
      <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
        Com um provedor cadastrado, cada painel ganha um botão que pede à IA para ler a
        tabela e dizer o que ela mostra.
      </p>

      <p
        className="rounded border px-3 py-2 text-xs leading-relaxed"
        style={{
          borderColor: 'var(--status-warning)',
          background: 'color-mix(in srgb, var(--status-warning) 12%, transparent)',
          color: 'var(--text-primary)',
        }}
      >
        <strong>O que sai da empresa:</strong> a mesma tabela que o painel mostra, até 120
        linhas. Em Produtividade e Ofensores isso inclui <strong>nome de técnico</strong>; em
        Protocolos, <strong>nome e endereço de cliente</strong>. A chave nunca volta para o
        navegador, mas o dado enviado sai para o provedor escolhido.
      </p>

      {data.faltaArmazenamento && (
        <Caixa erro>
          O diretório de dados não está gravável — sem ele não há onde guardar a chave.
          Confira o volume montado em <code>/app/data</code>.
        </Caixa>
      )}

      {data.faltaSegredo && (
        <Caixa erro>
          Sem chave de cifra. Normalmente ela é gerada sozinha em{' '}
          <code>data/.secret</code> na primeira vez — se esta mensagem aparece, o diretório
          de dados não está gravável. Definir <code>APP_SECRET</code> no ambiente também
          resolve, e é o caminho recomendado.
        </Caixa>
      )}

      {data.chaveIlegivel && (
        <Caixa erro>
          Há uma chave gravada que <strong>não abre</strong> com a chave de cifra atual —
          provavelmente o <code>APP_SECRET</code> mudou, ou o <code>data/.secret</code> se
          perdeu com o volume. Cadastre a chave novamente.
        </Caixa>
      )}

      {data.configurado && !data.chaveIlegivel && (
        <p className="text-xs text-[var(--text-muted)]">
          Em uso: <strong className="text-[var(--text-primary)]">{data.tipo}</strong> ·{' '}
          {data.modelo} · chave {data.chaveMascarada}
          {data.atualizadoPor && (
            <>
              {' '}
              — atualizado por {data.atualizadoPor}
              {data.atualizadoEm &&
                ` em ${new Date(data.atualizadoEm).toLocaleDateString('pt-BR')}`}
            </>
          )}
        </p>
      )}

      <div className="grid gap-3 rounded-lg border p-4" style={{ borderColor: 'var(--border)' }}>
        <Campo rotulo="Provedor">
          <select
            value={tipoAtual}
            disabled={bloqueado}
            onChange={(e) => {
              setTipo(e.target.value)
              setModelo(null)
              setModelos(null)
            }}
            className="w-full rounded border px-2.5 py-1.5 text-xs disabled:opacity-60"
            style={estiloCampo}
          >
            {data.tipos.map((t) => (
              <option key={t.id} value={t.id}>
                {t.rotulo}
              </option>
            ))}
          </select>
        </Campo>

        <Campo
          rotulo="Chave da API"
          dica={
            data.configurado
              ? 'Deixe em branco para manter a chave já gravada.'
              : 'Fica cifrada no banco e nunca volta para o navegador.'
          }
        >
          <input
            type="password"
            value={chave}
            disabled={bloqueado}
            onChange={(e) => setChave(e.target.value)}
            placeholder={data.configurado ? `mantida (${data.chaveMascarada})` : 'sk-…'}
            autoComplete="off"
            className="w-full rounded border px-2.5 py-1.5 text-xs disabled:opacity-60"
            style={estiloCampo}
          />
        </Campo>

        <Campo
          rotulo="Base URL"
          dica="Opcional. Só para Azure, Groq, OpenRouter e afins, que falam o dialeto da OpenAI em outro endereço."
        >
          <input
            value={baseUrlAtual}
            disabled={bloqueado}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="padrão do provedor"
            className="w-full rounded border px-2.5 py-1.5 text-xs disabled:opacity-60"
            style={estiloCampo}
          />
        </Campo>

        <Campo rotulo="Modelo" dica={sugerido ? `Sugestão: ${sugerido}` : undefined}>
          <div className="flex gap-2">
            {modelos?.length ? (
              <select
                value={modeloAtual}
                onChange={(e) => setModelo(e.target.value)}
                className="w-full rounded border px-2.5 py-1.5 text-xs"
                style={estiloCampo}
              >
                <option value="">selecione…</option>
                {modelos.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={modeloAtual}
                disabled={bloqueado}
                onChange={(e) => setModelo(e.target.value)}
                placeholder={sugerido}
                className="w-full rounded border px-2.5 py-1.5 text-xs disabled:opacity-60"
                style={estiloCampo}
              />
            )}

            <button
              type="button"
              disabled={bloqueado || buscarModelos.isPending}
              onClick={() => buscarModelos.mutate()}
              title="Consulta o provedor com a chave informada e lista os modelos que ela enxerga — é também o teste de que a chave funciona."
              className="shrink-0 rounded border px-3 py-1.5 text-xs whitespace-nowrap transition-colors hover:border-[var(--border-strong)] disabled:opacity-50"
              style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            >
              {buscarModelos.isPending ? 'Testando…' : 'Testar e listar'}
            </button>
          </div>
        </Campo>

        {aviso && (
          <p className="text-xs" style={{ color: 'var(--status-good)' }}>
            {aviso}
          </p>
        )}
        {erroAcao && (
          <p className="text-xs leading-relaxed" style={{ color: 'var(--status-critical)' }}>
            {erroAcao}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            disabled={bloqueado || salvar.isPending}
            onClick={() => salvar.mutate()}
            className="rounded px-4 py-1.5 text-xs font-medium transition-opacity disabled:opacity-50"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            {salvar.isPending ? 'Salvando…' : 'Salvar provedor'}
          </button>

          {data.configurado && (
            <button
              type="button"
              disabled={remover.isPending}
              onClick={() => remover.mutate()}
              className="rounded border px-3 py-1.5 text-xs transition-colors hover:border-[var(--border-strong)] disabled:opacity-50"
              style={{ borderColor: 'var(--border)', color: 'var(--status-critical)' }}
            >
              Remover
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

const estiloCampo = {
  borderColor: 'var(--border)',
  background: 'var(--surface-1)',
  color: 'var(--text-primary)',
} as const

function Campo({
  rotulo,
  dica,
  children,
}: {
  rotulo: string
  dica?: string
  children: React.ReactNode
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] font-semibold tracking-wide uppercase text-[var(--text-secondary)]">
        {rotulo}
      </span>
      {children}
      {dica && <span className="text-[11px] text-[var(--text-muted)]">{dica}</span>}
    </label>
  )
}

function Caixa({ children, erro }: { children: React.ReactNode; erro?: boolean }) {
  return (
    <p
      className="rounded-lg border px-3 py-2 text-xs leading-relaxed"
      style={{
        borderColor: erro ? 'var(--status-critical)' : 'var(--border)',
        color: 'var(--text-secondary)',
      }}
    >
      {children}
    </p>
  )
}
