'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { buscarJson } from '@/lib/clienteHttp'
import type { IdTela, Papel, Tela } from '@/config/telas'
import { Icone, type NomeIcone } from '@/components/Icone'
import { AbaIA } from './AbaIA'

/**
 * Configurações — quem entra e o que cada um vê. Formato da casca Sebratel:
 * um card "Configurações" com quem está editando no subtítulo, abas com ícone
 * e as duas abas obrigatórias (Usuários e papéis, Acesso por tela).
 *
 * PADRÃO DE GRAVAÇÃO: rascunho + Salvar, nunca gravação por clique.
 *
 * Numa tela de permissão isso não é conforto, é segurança de operação. Gravar a
 * cada clique significa que reorganizar o acesso de cinco pessoas dispara
 * dezenas de gravações parciais, e que o estado intermediário — alguém sem
 * acesso por dois segundos, alguém com acesso a mais — é real e observável por
 * quem estiver usando o dashboard naquele instante. Com rascunho, o intervalo
 * inconsistente não existe: ou a mudança inteira valeu, ou nada valeu.
 *
 * ⚠️ AINDA GRAVA EM ARQUIVO NO VOLUME (`data/acesso.json`), não no banco que a
 * casca pede. Mudar isso é decisão de servidor, fora desta reforma de tela.
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

type Aba = 'usuarios' | 'telas' | 'ia'

const ABAS: { id: Aba; rotulo: string; icone: NomeIcone }[] = [
  { id: 'usuarios', rotulo: 'Usuários e papéis', icone: 'pessoas' },
  { id: 'telas', rotulo: 'Acesso por tela', icone: 'tela' },
  { id: 'ia', rotulo: 'Provedor de IA', icone: 'ia' },
]

const PAPEL_LABEL: Record<Papel, string> = { viewer: 'Visualizador', admin: 'Administrador' }

export function Conteudo({ email }: { email: string }) {
  const qc = useQueryClient()
  const [aba, setAba] = useState<Aba>('usuarios')
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

  /**
   * Depois do guard abaixo o rascunho nunca é nulo, mas o setter do `useState`
   * continua tipado como `Rascunho | null`. Este embrulho passa às abas um
   * setter que só sabe de rascunho existente — em vez de espalhar `?? r` por
   * dentro de cada `setRascunho`, onde o `null` voltaria a ser possível.
   */
  const editar = (f: (r: Rascunho) => Rascunho) => setRascunho((r) => (r ? f(r) : r))

  return (
    <div className="pagina">
      <section className="visual v-auto" aria-label="Configurações">
        <div className="visual-cab">
          <h2>Configurações</h2>
        </div>
        <div className="visual-sub">
          {email} · {PAPEL_LABEL.admin} — quem entra no dashboard e o que cada pessoa enxerga.
        </div>

        <div className="visual-corpo" style={{ padding: '10px 12px 14px' }}>
          {isLoading ? (
            <div className="estado" role="status" aria-label="Carregando">
              <div className="carregando-barra" />
            </div>
          ) : error ? (
            <div className="estado erro" role="alert">
              <span className="linha">
                <Icone nome="alerta" tamanho={14} />
                {error instanceof Error ? error.message : String(error)}
              </span>
            </div>
          ) : !data || !rascunho ? (
            <div className="estado">Sem configuração para mostrar.</div>
          ) : (
            <>
              {!data.controleAtivo && <AvisoControleInativo />}

              <div className="cfg-abas" role="tablist">
                {ABAS.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    role="tab"
                    aria-selected={aba === a.id}
                    className={aba === a.id ? 'on' : ''}
                    onClick={() => setAba(a.id)}
                  >
                    <Icone nome={a.icone} tamanho={14} /> {a.rotulo}
                  </button>
                ))}
              </div>

              {/* A aba de IA grava sozinha — ela lida com credencial, e
                  credencial não fica pendurada num rascunho que alguém pode
                  descartar sem querer. Por isso ela não tem a barra de Salvar. */}
              {aba !== 'ia' && (
                <BarraRascunho
                  pendentes={pendentes}
                  salvando={salvar.isPending}
                  erro={erroSalvar}
                  onDescartar={descartar}
                  onSalvar={() => salvar.mutate(rascunho)}
                />
              )}

              {aba === 'usuarios' && (
                <AbaUsuarios rascunho={rascunho} original={data} setRascunho={editar} />
              )}
              {aba === 'telas' && (
                <AbaTelas
                  rascunho={rascunho}
                  original={data}
                  setRascunho={editar}
                  catalogo={data.catalogo}
                />
              )}
              {aba === 'ia' && <AbaIA />}
            </>
          )}
        </div>
      </section>
    </div>
  )
}

/* ─────────────────────────────── Usuários ─────────────────────────────── */

function AbaUsuarios({
  rascunho,
  original,
  setRascunho,
}: {
  rascunho: Rascunho
  original: Estado
  setRascunho: (f: (r: Rascunho) => Rascunho) => void
}) {
  const [novo, setNovo] = useState('')
  const [novoPapel, setNovoPapel] = useState<Papel>('viewer')
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
      usuarios: [...r.usuarios, { email, papel: novoPapel, nome: null, fixo: false }].sort((a, b) =>
        a.email.localeCompare(b.email)
      ),
    }))
  }

  return (
    <div className="cfg-bloco">
      <p className="cfg-nota">
        <b>Quem não está nesta lista também entra</b> — basta ter conta{' '}
        <code>@sebratel.com.br</code> — e entra como <b>Visualizador</b>. A lista serve para{' '}
        <b>promover a Administrador</b> e para ter um nome a marcar em <b>Acesso por tela</b>.
        Administrador vê todas as telas e abre esta página.
      </p>

      <div className="cfg-form">
        <label>
          <span>E-mail corporativo</span>
          <input
            type="email"
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && adicionar()}
            placeholder="pessoa@sebratel.com.br"
          />
        </label>
        <label>
          <span>Papel</span>
          <select value={novoPapel} onChange={(e) => setNovoPapel(e.target.value as Papel)}>
            <option value="viewer">{PAPEL_LABEL.viewer}</option>
            <option value="admin">{PAPEL_LABEL.admin}</option>
          </select>
        </label>
        <button type="button" className="cfg-botao" onClick={adicionar} disabled={!novo.trim()}>
          <Icone nome="mais" tamanho={14} /> Adicionar
        </button>
      </div>

      {erro && (
        <div className="banner error" role="alert">
          <Icone nome="alerta" tamanho={14} /> {erro}
        </div>
      )}

      {visiveis.length === 0 ? (
        <div className="estado">Ninguém cadastrado. Todo mundo do domínio entra como Visualizador.</div>
      ) : (
        <div className="tabela-caixa" style={{ maxHeight: 460 }}>
          <table className="tabela">
            <thead>
              <tr>
                <th className="texto">E-mail</th>
                <th className="texto">Papel</th>
                <th className="centro">Remover</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((u) => {
                const antes = original.usuarios.find((x) => x.email === u.email)
                const pendente = !antes || antes.papel !== u.papel
                const unicoAdmin = u.papel === 'admin' && admins === 1
                return (
                  <tr key={u.email}>
                    <td className="texto">
                      {u.email}
                      {!antes && <span className="cfg-tag">novo</span>}
                    </td>
                    <td className={`texto${pendente ? ' pendente' : ''}`}>
                      {u.fixo ? (
                        <>
                          {PAPEL_LABEL[u.papel]}{' '}
                          <span
                            className="cfg-tag fixo"
                            title="Administrador definido em ADMIN_EMAILS, no ambiente. A tela não pode rebaixá-lo — é a porta de emergência contra ficar sem admin."
                          >
                            <Icone nome="cadeado" tamanho={11} /> fixo
                          </span>
                        </>
                      ) : (
                        <select
                          className="cfg-select-inline"
                          value={u.papel}
                          onChange={(e) =>
                            setRascunho((r) => ({
                              ...r,
                              usuarios: r.usuarios.map((x) =>
                                x.email === u.email ? { ...x, papel: e.target.value as Papel } : x
                              ),
                            }))
                          }
                        >
                          <option value="viewer">{PAPEL_LABEL.viewer}</option>
                          <option value="admin">{PAPEL_LABEL.admin}</option>
                        </select>
                      )}
                    </td>
                    <td className="centro">
                      <button
                        type="button"
                        className="cfg-remover"
                        style={{ margin: '0 auto' }}
                        disabled={u.fixo || unicoAdmin}
                        onClick={() =>
                          setRascunho((r) => ({ ...r, removidos: [...r.removidos, u.email] }))
                        }
                        title={
                          u.fixo
                            ? 'Definido no ambiente (ADMIN_EMAILS); só muda por lá.'
                            : unicoAdmin
                              ? 'É o único administrador — promova outra pessoa antes.'
                              : 'Remover da lista'
                        }
                        aria-label={`Remover ${u.email}`}
                      >
                        <Icone nome="fechar" tamanho={13} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ──────────────────────────── Acesso por tela ─────────────────────────── */

/**
 * A matriz pessoa × tela da casca, sobre o modelo que já existia: cada tela é
 * `todos` (qualquer pessoa do domínio) ou `lista` (só as marcadas).
 *
 * A primeira linha, "Todos do domínio", é o modo da tela. Enquanto ela está
 * marcada, as caixas da coluna aparecem marcadas e TRAVADAS — porque é isso que
 * acontece de fato: todo mundo vê. Caixa clicável que não muda nada engana
 * quem clica (skill, seção 7). O mesmo vale para administrador, que vê tudo
 * pelo papel.
 */
function AbaTelas({
  rascunho,
  original,
  setRascunho,
  catalogo,
}: {
  rascunho: Rascunho
  original: Estado
  setRascunho: (f: (r: Rascunho) => Rascunho) => void
  catalogo: readonly Tela[]
}) {
  const pessoas = rascunho.usuarios.filter((u) => !rascunho.removidos.includes(u.email))
  const porId = new Map(catalogo.map((t) => [t.id, t]))

  const alterarTela = (tela: IdTela, f: (t: MatrizTela) => MatrizTela) =>
    setRascunho((r) => ({ ...r, telas: r.telas.map((x) => (x.tela === tela ? f(x) : x)) }))

  /** O que a pessoa via ANTES desta edição, nesta tela — para marcar o pendente. */
  const viaAntes = (tela: IdTela, email: string) => {
    const t = original.telas.find((x) => x.tela === tela)
    return t?.modo === 'lista' && t.emails.includes(email)
  }

  return (
    <div className="cfg-bloco">
      <p className="cfg-nota">
        <b>Todos do domínio</b> libera a tela para qualquer pessoa com conta{' '}
        <code>@sebratel.com.br</code>. Desmarque para escolher quem vê, pessoa a pessoa.
        Administradores veem tudo, sempre — quem edita a matriz precisa poder conferir o
        resultado da própria edição. A Capa é de todos e não aparece aqui.
      </p>

      {pessoas.length === 0 && (
        <div className="banner">
          Nenhuma pessoa cadastrada em Usuários e papéis. Para restringir uma tela a pessoas
          específicas, adicione-as lá primeiro.
        </div>
      )}

      <div className="tabela-caixa" style={{ maxHeight: 520 }}>
        <table className="tabela matriz">
          <thead>
            <tr>
              <th className="texto col-nome">Pessoa</th>
              {rascunho.telas.map((t) => (
                <th key={t.tela} className="centro" title={porId.get(t.tela)?.contem}>
                  {porId.get(t.tela)?.rotulo ?? t.tela}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="linha-todos">
              <td className="texto col-nome" title="Liberar a tela para qualquer pessoa do domínio">
                Todos do domínio
              </td>
              {rascunho.telas.map((t) => {
                const antes = original.telas.find((x) => x.tela === t.tela)?.modo
                return (
                  <td
                    key={t.tela}
                    className={`centro${antes !== t.modo ? ' pendente' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={t.modo === 'todos'}
                      onChange={(e) =>
                        alterarTela(t.tela, (x) => ({ ...x, modo: e.target.checked ? 'todos' : 'lista' }))
                      }
                      aria-label={`${porId.get(t.tela)?.rotulo ?? t.tela} para todos do domínio`}
                    />
                  </td>
                )
              })}
            </tr>

            {pessoas.map((u) => (
              <tr key={u.email}>
                <td className="texto col-nome" title={u.email}>
                  {u.email}
                  {u.papel === 'admin' && <span className="cfg-tag">admin</span>}
                </td>
                {rascunho.telas.map((t) => {
                  const rotulo = porId.get(t.tela)?.rotulo ?? t.tela
                  const travada = u.papel === 'admin' || t.modo === 'todos'
                  const marcada = travada || t.emails.includes(u.email)
                  const pendente = !travada && marcada !== viaAntes(t.tela, u.email)
                  return (
                    <td
                      key={t.tela}
                      className={`centro${pendente ? ' pendente' : ''}`}
                      title={
                        u.papel === 'admin'
                          ? 'Administrador vê todas as telas pelo papel.'
                          : t.modo === 'todos'
                            ? 'Liberada para todos do domínio. Desmarque "Todos do domínio" para escolher pessoas.'
                            : undefined
                      }
                    >
                      <input
                        type="checkbox"
                        checked={marcada}
                        disabled={travada}
                        onChange={(e) =>
                          alterarTela(t.tela, (x) => ({
                            ...x,
                            emails: e.target.checked
                              ? [...x.emails, u.email]
                              : x.emails.filter((m) => m !== u.email),
                          }))
                        }
                        aria-label={`${rotulo} para ${u.email}`}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ─────────────────────────── Peças compartilhadas ─────────────────────── */

/**
 * A barra de rascunho fica no topo da aba e SEMPRE aparece — neutra quando não
 * há nada pendente, dourada quando há. Nada é gravado até o Salvar, e isso
 * precisa estar à vista, não descoberto no rodapé de uma lista longa.
 */
function BarraRascunho({
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
  return (
    <>
      <div className={`ras-barra${pendentes ? ' ativa' : ''}`} role="status">
        <Icone nome={pendentes ? 'alerta' : 'ok'} tamanho={15} />
        <span>
          {pendentes
            ? `${pendentes} alteraç${pendentes === 1 ? 'ão' : 'ões'} não salva${pendentes === 1 ? '' : 's'}.`
            : 'Nenhuma alteração pendente.'}
        </span>
        <button
          type="button"
          className="cfg-botao ghost"
          onClick={onDescartar}
          disabled={salvando || pendentes === 0}
        >
          Descartar
        </button>
        <button
          type="button"
          className="cfg-botao"
          onClick={onSalvar}
          disabled={salvando || pendentes === 0}
        >
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
      {erro && (
        <div className="banner error" role="alert">
          <Icone nome="alerta" tamanho={14} /> {erro}
        </div>
      )}
    </>
  )
}

function AvisoControleInativo() {
  return (
    <div className="banner" style={{ marginBottom: 12 }}>
      <b>Controle de acesso inativo.</b> O diretório de dados não está gravável, então{' '}
      <b>todas as pessoas do domínio veem todas as telas</b> e nada aqui pode ser gravado.
      Confira o volume montado em <code>/app/data</code> — no Portainer ele precisa existir
      na stack, e o diretório precisa pertencer ao usuário <code>app</code>.
    </div>
  )
}
