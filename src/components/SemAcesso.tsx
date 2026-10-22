import { Icone } from './Icone'

/**
 * A tela que aparece quando a pessoa não tem acesso — o "Tela restrita" da
 * casca Sebratel, com o que só este dashboard sabe dizer.
 *
 * DIZ O QUE FALTA E PARA QUEM PEDIR. Uma tela de "acesso negado" faz a pessoa
 * concluir que o dashboard quebrou, e uma que só diz "sem permissão" gera o
 * mesmo chamado uma semana depois. Por isso mostra a conta com que ela entrou
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
    <div className="pagina">
      <div className="tela-negada">
        <Icone nome="cadeado" tamanho={30} />
        <h2>{ehConfiguracoes ? 'Configurações é só para administradores' : 'Tela restrita'}</h2>
        <p style={{ maxWidth: 520, margin: 0, lineHeight: 1.6 }}>
          {ehConfiguracoes
            ? 'Esta tela gerencia quem entra no dashboard e o provedor de IA.'
            : `${tela} mostra dado restrito, então o acesso é liberado pessoa a pessoa.`}{' '}
          Peça a liberação a um administrador, em <b>Configurações</b>.
        </p>
        <p style={{ margin: 0, fontSize: 12 }}>
          Você entrou como <b>{email}</b>. Se essa não é a sua conta de trabalho, saia pelo
          menu no canto e entre de novo.
        </p>
      </div>
    </div>
  )
}
