import { NextResponse } from 'next/server'
import { estatisticasCache } from '@/server/cache'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Sonda de liveness para o `HEALTHCHECK` do container.
 *
 * ⚠️ ESTA ROTA NÃO PASSA PELA AUTENTICAÇÃO (ver o matcher em `middleware.ts`),
 * porque o `wget` do HEALTHCHECK não manda credencial. Como a porta é publicada
 * no host, ela é alcançável pela rede — então **nada de dado de negócio aqui**.
 * Só fatos do processo: memória, tempo no ar e ocupação do cache. Nenhum nome de
 * cliente, nenhum número de indicador, nenhuma configuração de banco.
 *
 * POR QUE NÃO CONSULTA O BANCO
 * ────────────────────────────
 * Liveness responde "o processo está de pé?", não "as fontes estão boas?". Se
 * o healthcheck fizesse SELECT no ERP:
 *
 * 1. seriam ~2.880 consultas/dia só de sonda (a cada 30 s), na réplica de
 *    produção, para não responder pergunta nenhuma;
 * 2. uma oscilação de VPN marcaria o container como unhealthy e o Docker o
 *    reiniciaria — o que não conserta a rede, e ainda joga fora o cache quente,
 *    fazendo a volta ficar MAIS lenta justamente quando a rede voltou.
 *
 * O estado das fontes já aparece onde importa: o endpoint de indicador devolve
 * 503 com `falha ao acessar a fonte de dados` quando o banco não responde.
 */
export async function GET() {
  const cache = estatisticasCache()
  const mem = process.memoryUsage()

  const mb = (n: number) => Math.round((n / 1024 / 1024) * 10) / 10

  return NextResponse.json(
    {
      status: 'ok',
      uptimeSegundos: Math.round(process.uptime()),
      memoria: {
        rssMb: mb(mem.rss),
        heapUsadoMb: mb(mem.heapUsed),
        heapTotalMb: mb(mem.heapTotal),
      },
      cache: {
        entradas: cache.entradas,
        emVoo: cache.emVoo,
        usadoMb: mb(cache.bytes),
        limiteMb: mb(cache.bytesLimite),
        usoPercentual: cache.usoPercentual,
      },
    },
    { headers: { 'cache-control': 'no-store' } }
  )
}
