import type { Metadata } from 'next'
import './globals.css'
import { Provedores } from '@/components/Provedores'
import { SessaoFirebase } from '@/components/SessaoFirebase'
import { obterConfigFirebase } from '@/server/auth/configCliente'

export const metadata: Metadata = {
  title: 'Manutenção FTTX · Sebratel',
  description: 'Dashboards de manutenção de fibra em tempo quase real',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /**
     * `translate="no"` + a meta `notranslate` DESLIGAM o tradutor do navegador.
     *
     * Não é preferência de estilo: o Chrome estava traduzindo a página apesar do
     * `lang="pt-BR"`, e o resultado é rótulo corrompido em tela de auditoria.
     * Reportado pela Manutenção em 28/08/2026 — "corrigir a palavra Auditoria que
     * está Auditório". O código sempre disse "Auditoria"; quem reescreveu foi o
     * navegador. Na mesma tela ele trocou "Linhas exibidas" por "Linhas de
     * transmissão", "Limpar filtros" por "Olho de Limpar", "Improdutivas" por
     * "Improvisado" e "Atualizando…" por "Regulando…".
     *
     * O estrago é maior que o cosmético: os TIPOS DE PROTOCOLO vinham traduzidos
     * ("TEC-MANUT-ACESSO-CLI-PREVENÇÃO/PROBLEMA" com cedilha, contra
     * "PREVENCAO" que é o valor real no ERP). Numa tela cujo propósito é conferir
     * linha a linha contra o Voalle, texto reescrito invalida a conferência.
     */
    <html lang="pt-BR" translate="no" suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
      </head>
      <body>
        <Provedores>
          {/*
            Envolve TUDO, login inclusive: é quem mantém o cookie de sessão em
            dia com o token do Firebase enquanto a aba fica aberta. A moldura do
            dashboard (cabeçalho e filtros) não está mais aqui — ela vive no
            layout do grupo `(dashboard)`, para a tela de login não herdá-la.
          */}
          <SessaoFirebase config={obterConfigFirebase()}>{children}</SessaoFirebase>
        </Provedores>
      </body>
    </html>
  )
}
