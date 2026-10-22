import type { RowDataPacket } from 'mysql2'
import { CIDADES_REGIAO } from '@/config/regras-negocio'
import { memoizar } from './cache'
import { estadoErp } from './db/erp'
import { consultarMaria, estadoMaria } from './db/maria'

/**
 * O que a Capa mostra no selo e em "Atualização dos dados".
 *
 * ⚠️ A CAPA NÃO PODE VIRAR CARGA. Ela é a primeira aba, a que todo mundo abre:
 * se custasse uma consulta ao ERP, o painel ganharia mais um ponto de pressão
 * na réplica de produção só para dizer "estou aqui". Por isso:
 *
 * - o frescor do ERP sai de `estadoErp()`, que as telas alimentam sozinhas a
 *   cada consulta — custo zero;
 * - a base de clientes é UMA soma por dia no Data Hub (não na réplica), na
 *   janela dos últimos 15 dias, guardada por 1 h. A base só muda uma vez por
 *   dia, na carga das 23:50, então 1 h não esconde nada de ninguém.
 */

export type FonteStatus = {
  nome: string
  /** ISO; `null` quando a fonte ainda não foi lida desde o último restart */
  atualizadoEm: string | null
  falhou: boolean
  cadencia: string
}

export type StatusPainel = {
  /** clientes autenticados nas 6 cidades da região, no último dia medido */
  baseClientes: number | null
  /** 'YYYY-MM-DD' do último dia medido */
  baseDia: string | null
  cidadesRegiao: number
  fontes: FonteStatus[]
  lidoEm: string
}

type LinhaBase = RowDataPacket & { dia: string; carga: string; clientes: string | number }

/** 'YYYY-MM-DD HH:MM:SS' (horário local, como o MariaDB guarda) → ISO local. */
function paraIsoLocal(bruto: string): string {
  return bruto.replace(' ', 'T').slice(0, 19)
}

async function ultimaBase(): Promise<{ dia: string; carga: string; clientes: number } | null> {
  const inicio = new Date(Date.now() - 15 * 86_400_000).toISOString().slice(0, 10)
  // `date` cru no WHERE, e não DATE(date): a função na coluna impediria o
  // índice; a janela de 15 dias cobre fim de semana e feriado sem carga.
  const { rows } = await consultarMaria<LinhaBase>(
    `SELECT DATE(\`date\`) AS dia, MAX(\`date\`) AS carga, SUM(total) AS clientes
       FROM Autentication_Contracts_Daily
      WHERE \`date\` >= ?
        AND city IN (${CIDADES_REGIAO.map(() => '?').join(',')})
      GROUP BY DATE(\`date\`)
      ORDER BY dia DESC
      LIMIT 1`,
    [inicio, ...CIDADES_REGIAO]
  )
  const x = rows[0]
  if (!x) return null
  return {
    dia: String(x.dia).slice(0, 10),
    carga: paraIsoLocal(String(x.carga)),
    clientes: Number(x.clientes),
  }
}

export async function obterStatus(): Promise<StatusPainel> {
  let base: Awaited<ReturnType<typeof ultimaBase>> = null
  let falhouBase = false
  try {
    base = (await memoizar('status:base-clientes', 3600, ultimaBase)).valor
  } catch (e) {
    // A Capa abre mesmo com o Data Hub fora — só diz que aquela fonte falhou.
    console.warn('[status] base de clientes indisponível:', e instanceof Error ? e.message : e)
    falhouBase = true
  }

  const erp = estadoErp()
  const maria = estadoMaria()
  const iso = (ms: number) => (ms ? new Date(ms).toISOString() : null)

  return {
    baseClientes: base?.clientes ?? null,
    baseDia: base?.dia ?? null,
    cidadesRegiao: CIDADES_REGIAO.length,
    fontes: [
      {
        nome: 'ERP Voalle (réplica de leitura)',
        atualizadoEm: iso(erp.ultimaLeitura),
        falhou: erp.ultimaFalha > erp.ultimaLeitura,
        cadencia: 'ao vivo, guardado de 1 a 30 min',
      },
      {
        nome: 'Data Hub (base de clientes)',
        atualizadoEm: base?.carga ?? null,
        falhou: falhouBase || maria.ultimaFalha > maria.ultimaLeitura,
        cadencia: 'carga diária às 23:50',
      },
    ],
    lidoEm: new Date().toISOString(),
  }
}
