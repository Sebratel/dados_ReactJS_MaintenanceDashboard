import type { Metadata } from 'next'
import { Suspense } from 'react'
import './globals.css'
import { Provedores } from '@/components/Provedores'
import { Cabecalho } from '@/components/Cabecalho'
import { BarraFiltros } from '@/components/filtros/BarraFiltros'

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
          <Suspense fallback={<div className="h-[45px]" />}>
            <Cabecalho />
          </Suspense>
          <Suspense fallback={<div className="h-[49px]" />}>
            <BarraFiltros />
          </Suspense>
          <main className="px-4 py-4">{children}</main>
        </Provedores>
      </body>
    </html>
  )
}
