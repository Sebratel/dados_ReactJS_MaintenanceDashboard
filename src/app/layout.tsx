import type { Metadata } from 'next'
import './globals.css'
import { Provedores } from '@/components/Provedores'

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
        {/*
          ⚠️ NADA DE CONFIGURAÇÃO DE AMBIENTE AQUI.

          Este layout é o único que envolve TODAS as rotas, inclusive as 8 telas
          de dados, que são pré-renderizadas estaticamente. Componente de
          servidor em rota estática roda UMA VEZ, no `next build` — então
          qualquer `process.env` lido aqui é CONGELADO no HTML.

          Foi o que aconteceu com a configuração do Firebase: na máquina de
          desenvolvimento o `.env` existe durante o build e a chave era assada no
          HTML; no container, que constrói sem `.env` de propósito, o mesmo HTML
          nascia com `"config":null`. Resultado no Portainer: o login funcionava
          (aquela página é dinâmica), mas dentro do dashboard o SDK do Firebase
          nunca inicializava — sem avatar, sem "Sair", e sem renovação de token,
          de modo que a sessão caía sozinha quando o cookie vencia.

          A leitura do ambiente mudou para `(dashboard)/layout.tsx`, que é
          dinâmico e por isso roda a cada request. Ver o comentário de lá.
        */}
        <Provedores>{children}</Provedores>
      </body>
    </html>
  )
}
