/**
 * A tela que aparece quando a pessoa não tem acesso.
 *
 * DIZ O QUE FALTA E PARA QUEM PEDIR. Uma tela de "acesso negado" muda que a
 * pessoa conclua que o dashboard quebrou, e uma que só diz "sem permissão" gera
 * o mesmo chamado, uma semana depois. Por isso mostra a conta com que ela entrou
 * — metade dos casos é ter entrado com a conta errada — e a quem recorrer.
 *
 * Também não é um redirecionamento: mandar para a Executivo em silêncio faria a
 * pessoa clicar no mesmo link de novo amanhã, achando que errou o clique.
 */
export function SemAcesso({
  tela,
  email,
  ehConfiguracoes,
}: {
  tela: string
  email: string
  ehConfiguracoes: boolean
}) {
  return (
    <section
      className="mx-auto mt-10 max-w-[520px] rounded-lg border p-6"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
    >
      <div className="flex items-start gap-3">
        <IconeCadeado />
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold text-[var(--text-primary)]">
            {ehConfiguracoes
              ? 'Configurações é só para administradores'
              : `Você não tem acesso a ${tela}`}
          </h1>

          <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
            {ehConfiguracoes
              ? 'Esta tela gerencia quem entra no dashboard e o provedor de IA.'
              : 'Esta tela mostra dado restrito, então o acesso é liberado pessoa a pessoa.'}{' '}
            Peça a um administrador para liberar em <strong>Configurações</strong>.
          </p>

          <p className="mt-3 text-[11px] text-[var(--text-muted)]">
            Você entrou como <span className="font-medium">{email}</span>. Se essa não é a
            sua conta de trabalho, saia pelo menu no canto e entre de novo.
          </p>
        </div>
      </div>
    </section>
  )
}

function IconeCadeado() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="mt-0.5 shrink-0"
      style={{ color: 'var(--text-muted)' }}
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        d="M3.6 7.1h8.8v6.3H3.6zM5.6 7.1V4.9a2.4 2.4 0 0 1 4.8 0v2.2"
      />
    </svg>
  )
}
