'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { buscarJson } from '@/lib/clienteHttp'
import type { IdTela, Papel, Tela } from '@/config/telas'
import { AbaIA } from './AbaIA'

/**
 * Configurações — quem entra e o que cada um vê.
 *
 * PADRÃO DE GRAVAÇÃO: rascunho + Salvar, nunca gravação por clique.
 *
 * Numa tela de permissão isso não é conforto, é segurança de operação. Gravar a
 * cada clique significa que reorganizar o acesso de cinco pessoas dispara
 * dezenas de gravações parciais, e que o estado intermediário — alguém sem
 * acesso por dois segundos, alguém com acesso a mais — é real e observável por
 * quem estiver usando o dashboard naquele instante. Com rascunho, o intervalo
 * inconsistente não existe: ou a mudança inteira valeu, ou nada valeu.
 */

type UsuarioConfig = { email: string; papel: Papel; nome: string | null; fixo: boolean }
type MatrizTela = { tela: IdTela; modo: 'todos' | 'lista'; emails: string[] }
type Estado = {
  usuarios: UsuarioConfig[]
  telas: MatrizTela[]
  catalogo: readonly Tela[]
  adminsFixos: string[]
  controleAtivo: boolean
}

type Rascunho = { usuarios: UsuarioConfig[]; telas: MatrizTela[]; removidos: string[] }

export function Conteudo() {
  const qc = useQueryClient()
  const [aba, setAba] = useState<'usuarios' | 'telas' | 'ia'>('usuarios')
  const [rascunho, setRascunho] = useState<Rascunho | null>(null)
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['config', 'acesso'],
    queryFn: () => buscarJson<Estado>('/api/config/acesso'),
    staleTime: 60_000,
  })

  // O rascunho nasce do servidor e só é substituído quando não há edição
  // pendente — senão um refetch de fundo apagaria o que a pessoa acabou de
  // mexer, e ela não teria como saber que apagou.
  useEffect(() => {
    if (data && rascunho === null) {
      setRascunho({ usuarios: data.usuarios, telas: data.telas, removidos: [] })
    }
  }, [data, rascunho])

  const salvar = useMutation({
    mutationFn: (r: Rascunho) =>
      buscarJson<Estado>('/api/config/acesso', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(r),
      }),
    onSuccess: (novo) => {
      qc.setQueryData(['config', 'acesso'], novo)
      setRascunho({ usuarios: novo.usuarios, telas: novo.telas, removidos: [] })
      setErroSalvar(null)
    },
    onError: (e: unknown) => setErroSalvar(e instanceof Error ? e.message : String(e)),
  })

  const pendentes = useMemo(() => {
    if (!data || !rascunho) return 0
    let n = rascunho.removidos.length
    for (const u of rascunho.usuarios) {
      const antes = data.usuarios.find((x) => x.email === u.email)
      if (!antes || antes.papel !== u.papel) n++
    }
    for (const t of rascunho.telas) {
      const antes = data.telas.find((x) => x.tela === t.tela)
      if (!antes) continue
      if (antes.modo !== t.modo) n++
      else if (antes.emails.join('|') !== [...t.emails].sort().join('|')) n++
    }
    return n
  }, [data, rascunho])

  const descartar = useCallback(() => {
    if (!data) return
    setRascunho({ usuarios: data.usuarios, telas: data.telas, removidos: [] })
    setErroSalvar(null)
  }, [data])

  if (isLoading) return <Estado3 tipo="carregando" />
  if (error) {
    return <Estado3 tipo="erro" mensagem={error instanceof Error ? error.message : String(error)} />
  }
  if (!data || !rascunho) return <Estado3 tipo="vazio" />

  /**
   * Depois do guard acima o rascunho nunca é nulo, mas o setter do `useState`
   * continua tipado como `Rascunho | null`. Este embrulho passa às abas um
   * setter que só sabe de rascunho existente — em vez de espalhar `?? r` por
   * dentro de cada `setRascunho`, onde o `null` voltaria a ser possível.
   */
  const editar = (f: (r: Rascunho) => Rascunho) => setRascunho((r) => (r ? f(r) : r))

  return (
    <div className="mx-auto max-w-[1100px] pb-24">
      <header className="mb-4">
        <h1 className="text-[15px] font-semibold text-[var(--text-primary)]">Configurações</h1>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Quem entra no dashboard e o que cada pessoa enxerga.
        </p>
      </header>

      {!data.controleAtivo && <AvisoControleInativo />}

      <div className="mb-4 flex gap-1 border-b" style={{ borderColor: 'var(--border)' }}>
        {(
          [
            ['usuarios', 'Usuários'],
            ['telas', 'Telas'],
            ['ia', 'IA'],
          ] as const
        ).map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            onClick={() => setAba(id)}
            className="relative px-3 py-2 text-xs font-medium transition-colors"
            style={{ color: aba === id ? 'var(--text-primary)' : 'var(--text-muted)' }}
          >
            {rotulo}
            {aba === id && (
              <span
                aria-hidden="true"
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full"
                style={{ background: 'var(--brand)' }}
              />
            )}
          </button>
        ))}
      </div>

      {aba === 'usuarios' && <AbaUsuarios rascunho={rascunho} setRascunho={editar} />}
      {aba === 'telas' && (
        <AbaTelas rascunho={rascunho} setRascunho={editar} catalogo={data.catalogo} />
      )}
      {/* A aba de IA grava sozinha — ela lida com credencial, e credencial nao
          fica pendurada num rascunho que alguem pode descartar sem querer. Por
          isso ela nao participa da barra de Salvar abaixo. */}
      {aba === 'ia' && <AbaIA />}

      <BarraSalvar
        pendentes={pendentes}
        salvando={salvar.isPending}
        erro={erroSalvar}
        onDescartar={descartar}
        onSalvar={() => salvar.mutate(rascunho)}
      />
    </div>
  )
}

/* ─────────────────────────────── Usuários ─────────────────────────────── */

function AbaUsuarios({
  rascunho,
  setRascunho,
}: {
  rascunho: Rascunho
  setRascunho: (f: (r: Rascunho) => Rascunho) => void
}) {
  const [novo, setNovo] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  const visiveis = rascunho.usuarios.filter((u) => !rascunho.removidos.includes(u.email))
  const admins = visiveis.filter((u) => u.papel === 'admin').length

  const adicionar = () => {
    const email = novo.trim().toLowerCase()
    if (!email) return
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setErro('E-mail inválido.')
      return
    }
    if (rascunho.usuarios.some((u) => u.email === email)) {
      setErro('Essa pessoa já está na lista.')
      return
    }
    setErro(null)
    setNovo('')
    setRascunho((r) => ({
      ...r,
      removidos: r.removidos.filter((e) => e !== email),
      usuarios: [
        ...r.usuarios,
        { email, papel: 'viewer' as const, nome: null, fixo: false },
      ].sort((a, b) =>
        a.email.localeCompare(b.email)
      ),
    }))
  }

  return (
    <section>
      <p className="mb-3 text-xs leading-relaxed text-[var(--text-secondary)]">
        <strong>Quem não está nesta lista também entra</strong> — basta ter conta{' '}
        <code className="text-[11px]">@sebratel.com.br</code> — e entra como{' '}
        <em>viewer</em>. A lista serve para <strong>promover a administrador</strong> e para
        ter um nome a usar na aba Telas.
      </p>

      <div className="mb-3 flex gap-2">
        <input
          value={novo}
          onChange={(e) => setNovo(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && adicionar()}
          placeholder="pessoa@sebratel.com.br"
          className="w-72 rounded border px-2.5 py-1.5 text-xs"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--surface-1)',
            color: 'var(--text-primary)',
          }}
        />
        <button
          type="button"
          onClick={adicionar}
          className="rounded border px-3 py-1.5 text-xs font-medium transition-colors hover:border-[var(--border-strong)]"
          style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
        >
          Adicionar
        </button>
      </div>

      {erro && (
        <p className="mb-3 text-xs" style={{ color: 'var(--status-critical)' }}>
          {erro}
        </p>
      )}

      {visiveis.length === 0 ? (
        <Vazio texto="Ninguém cadastrado. Todo mundo do domínio entra como viewer." />
      ) : (
        <div
          className="overflow-hidden rounded-lg border"
          style={{ borderColor: 'var(--border)' }}
        >
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: 'var(--surface-page)' }}>
                <Th>Pessoa</Th>
                <Th>Papel</Th>
                <Th alinhar="dir">Ações</Th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((u) => (
                <tr key={u.email} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  <td className="px-3 py-2">
                    <span className="text-[var(--text-primary)]">{u.email}</span>
                    {u.fixo && (
                      <span
                        className="ml-2 rounded px-1.5 py-px text-[9px] font-bold tracking-wide uppercase"
                        style={{
                          background: 'var(--surface-page)',
                          color: 'var(--text-muted)',
                        }}
                        title="Administrador definido em ADMIN_EMAILS, no ambiente. A tela não pode rebaixá-lo — é a porta de emergência contra ficar sem admin."
                      >
                        fixo
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={u.papel}
                      disabled={u.fixo}
                      onChange={(e) =>
                        setRascunho((r) => ({
                          ...r,
                          usuarios: r.usuarios.map((x) =>
                            x.email === u.email ? { ...x, papel: e.target.value as Papel } : x
                          ),
                        }))
                      }
                      className="rounded border px-2 py-1 text-xs disabled:opacity-60"
                      style={{
                        borderColor: 'var(--border)',
                        background: 'var(--surface-1)',
                        color: 'var(--text-primary)',
                      }}
                      title={
                        u.fixo
                          ? 'Definido no ambiente (ADMIN_EMAILS); não pode ser alterado por aqui.'
                          : undefined
                      }
                    >
                      <option value="viewer">viewer</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      disabled={u.fixo || (u.papel === 'admin' && admins === 1)}
                      onClick={() =>
                        setRascunho((r) => ({ ...r, removidos: [...r.removidos, u.email] }))
                      }
                      className="rounded px-2 py-1 text-xs transition-colors hover:bg-[var(--surface-page)] disabled:cursor-not-allowed disabled:opacity-40"
                      style={{ color: 'var(--status-critical)' }}
                      title={
                        u.fixo
                          ? 'Definido no ambiente.'
                          : u.papel === 'admin' && admins === 1
                            ? 'É o único administrador — promova outra pessoa antes.'
                            : 'Remover da lista'
                      }
                    >
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/* ──────────────────────────────── Telas ───────────────────────────────── */

function AbaTelas({
  rascunho,
  setRascunho,
  catalogo,
}: {
  rascunho: Rascunho
  setRascunho: (f: (r: Rascunho) => Rascunho) => void
  catalogo: readonly Tela[]
}) {
  const pessoas = rascunho.usuarios
    .filter((u) => !rascunho.removidos.includes(u.email))
    .map((u) => u.email)

  const porId = new Map(catalogo.map((t) => [t.id, t]))

  return (
    <section>
      <p className="mb-3 text-xs leading-relaxed text-[var(--text-secondary)]">
        <strong>Todos</strong> libera a tela para qualquer pessoa do domínio.{' '}
        <strong>Lista</strong> restringe às marcadas. Administradores veem tudo, sempre —
        quem edita a matriz precisa poder conferir o resultado da própria edição.
      </p>

      {pessoas.length === 0 && (
        <p
          className="mb-3 rounded border px-3 py-2 text-xs leading-relaxed"
          style={{
            borderColor: 'var(--status-warning)',
            background: 'color-mix(in srgb, var(--status-warning) 12%, transparent)',
            color: 'var(--text-primary)',
          }}
        >
          Nenhuma pessoa cadastrada na aba Usuários. Para restringir uma tela a pessoas
          específicas, adicione-as lá primeiro.
        </p>
      )}

      <div className="grid gap-2">
        {rascunho.telas.map((t) => {
          const info = porId.get(t.tela)
          return (
            <article
              key={t.tela}
              className="rounded-lg border p-3"
              style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
                    {info?.rotulo ?? t.tela}
                  </h3>
                  <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{info?.contem}</p>
                </div>

                <div className="flex shrink-0 gap-1">
                  {(['todos', 'lista'] as const).map((modo) => (
                    <button
                      key={modo}
                      type="button"
                      onClick={() =>
                        setRascunho((r) => ({
                          ...r,
                          telas: r.telas.map((x) => (x.tela === t.tela ? { ...x, modo } : x)),
                        }))
                      }
                      className="rounded border px-2.5 py-1 text-[11px] font-medium transition-colors"
                      style={
                        t.modo === modo
                          ? {
                              borderColor: 'var(--brand)',
                              background: 'color-mix(in srgb, var(--brand) 12%, transparent)',
                              color: 'var(--text-primary)',
                            }
                          : { borderColor: 'var(--border)', color: 'var(--text-muted)' }
                      }
                    >
                      {modo === 'todos' ? 'Todos' : 'Lista'}
                    </button>
                  ))}
                </div>
              </div>

              {t.modo === 'lista' && pessoas.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                  {pessoas.map((email) => {
                    const marcado = t.emails.includes(email)
                    return (
                      <label
                        key={email}
                        className="flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 text-[11px] transition-colors"
                        style={{
                          borderColor: marcado ? 'var(--brand)' : 'var(--border)',
                          background: marcado
                            ? 'color-mix(in srgb, var(--brand) 10%, transparent)'
                            : 'transparent',
                          color: 'var(--text-primary)',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={marcado}
                          onChange={(e) =>
                            setRascunho((r) => ({
                              ...r,
                              telas: r.telas.map((x) =>
                                x.tela === t.tela
                                  ? {
                                      ...x,
                                      emails: e.target.checked
                                        ? [...x.emails, email]
                                        : x.emails.filter((m) => m !== email),
                                    }
                                  : x
                              ),
                            }))
                          }
                          className="size-3"
                        />
                        {email}
                      </label>
                    )
                  })}
                </div>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}

/* ─────────────────────────── Peças compartilhadas ─────────────────────── */

/**
 * A barra fica FIXA no rodapé e só aparece com alteração pendente.
 *
 * Numa lista longa, o botão de salvar no fim da página é o botão que ninguém
 * encontra: a pessoa mexe em três telas, rola para ver o resultado, e sai sem
 * gravar. A contagem no rótulo é o que transforma "salvar" em "salvar o quê".
 */
function BarraSalvar({
  pendentes,
  salvando,
  erro,
  onDescartar,
  onSalvar,
}: {
  pendentes: number
  salvando: boolean
  erro: string | null
  onDescartar: () => void
  onSalvar: () => void
}) {
  if (pendentes === 0 && !erro) return null

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t px-4 py-3"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-raised)' }}
    >
      <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-3">
        <span className="text-xs text-[var(--text-secondary)]">
          {pendentes} alteração{pendentes === 1 ? '' : 'ões'} não salva
          {pendentes === 1 ? '' : 's'}
        </span>

        {erro && (
          <span className="text-xs" style={{ color: 'var(--status-critical)' }}>
            {erro}
          </span>
        )}

        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={onDescartar}
            disabled={salvando}
            className="rounded border px-3 py-1.5 text-xs transition-colors hover:border-[var(--border-strong)] disabled:opacity-50"
            style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          >
            Descartar
          </button>
          <button
            type="button"
            onClick={onSalvar}
            disabled={salvando || pendentes === 0}
            className="rounded px-4 py-1.5 text-xs font-medium transition-opacity disabled:opacity-50"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AvisoControleInativo() {
  return (
    <p
      className="mb-4 rounded border px-3 py-2 text-xs leading-relaxed"
      style={{
        borderColor: 'var(--status-warning)',
        background: 'color-mix(in srgb, var(--status-warning) 12%, transparent)',
        color: 'var(--text-primary)',
      }}
    >
      <strong>Controle de acesso inativo.</strong> O diretório de dados não está gravável,
      então <strong>todas as pessoas do domínio veem todas as telas</strong> e nada aqui pode
      ser gravado. Confira o volume montado em{' '}
      <code className="text-[11px]">/app/data</code> — no Portainer ele precisa existir na
      stack, e o diretório precisa pertencer ao usuário <code className="text-[11px]">app</code>.
    </p>
  )
}

function Th({ children, alinhar }: { children: React.ReactNode; alinhar?: 'dir' }) {
  return (
    <th
      className={`px-3 py-2 text-[11px] font-semibold tracking-wide uppercase ${
        alinhar === 'dir' ? 'text-right' : 'text-left'
      }`}
      style={{ color: 'var(--text-secondary)' }}
    >
      {children}
    </th>
  )
}

function Vazio({ texto }: { texto: string }) {
  return (
    <p
      className="rounded-lg border px-3 py-6 text-center text-xs"
      style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
    >
      {texto}
    </p>
  )
}

/** Os três estados obrigatórios de toda tela deste dashboard. */
function Estado3({
  tipo,
  mensagem,
}: {
  tipo: 'carregando' | 'erro' | 'vazio'
  mensagem?: string
}) {
  const texto =
    tipo === 'carregando'
      ? 'Carregando configuração…'
      : tipo === 'erro'
        ? (mensagem ?? 'Não consegui ler a configuração.')
        : 'Sem configuração para mostrar.'

  return (
    <p
      className="mx-auto mt-10 max-w-[520px] rounded-lg border px-4 py-8 text-center text-xs"
      style={{
        borderColor: tipo === 'erro' ? 'var(--status-critical)' : 'var(--border)',
        color: 'var(--text-secondary)',
      }}
    >
      {texto}
    </p>
  )
}
