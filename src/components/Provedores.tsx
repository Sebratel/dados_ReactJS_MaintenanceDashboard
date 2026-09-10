'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

export function Provedores({ children }: { children: React.ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // o ERP é réplica de produção: não faz sentido re-consultar a cada foco
            refetchOnWindowFocus: false,
            retry: 1,
            // consultas do ano inteiro chegam a ~1s; 30s de frescor é folgado
            staleTime: 30_000,
          },
        },
      })
  )
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}
