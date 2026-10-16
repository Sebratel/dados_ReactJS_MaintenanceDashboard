/**
 * Projeção de entrantes para o fim do mês — o "Projeção Entrantes Mês" do
 * Power BI, refeito com as duas correções que o original não tem.
 *
 * A pergunta é "se o ritmo se mantiver, quantos reparos o mês inteiro terá?".
 * A conta é média diária × dias do mês, e é nas duas pontas dessa conta que o
 * BI erra.
 *
 * ⚠️ ERRO 1 DO BI — DIVIDIR PELO DIA DE HOJE. A medida `Média Diária` do Power
 * BI divide pelo dia do mês de HOJE, não pelos dias que o recorte realmente
 * cobre. Provado em 15/10/2026: o MESMO mês fechado devolvia 308 e, quatro dias
 * depois, 205. Mês fechado não pode mudar de número. Aqui o denominador são os
 * dias que têm dado, contados da série.
 *
 * ⚠️ ERRO 2, E É O SUTIL — O DIA DE HOJE ESTÁ PELA METADE. Às 9h da manhã o dia
 * corrente tem três horas de protocolo. Incluí-lo como se fosse um dia inteiro
 * puxa a média para baixo e a projeção sai subestimada justamente de manhã, que
 * é quando a operação olha a tela. Por isso **o dia corrente fica fora da
 * média** e entra só no total de dias projetados.
 *
 * ⚠️ NÃO É PROJEÇÃO DO RECORTE, É DO MÊS-CALENDÁRIO. O preset "Mês corrente"
 * vai de 01 até HOJE, então o alvo da extrapolação está fora do recorte. Fora
 * de um recorte que seja o mês corrente a função devolve `null` em vez de
 * inventar: num mês fechado a projeção é o próprio realizado (é por isso que o
 * BI mostra 2463 nos dois cartões de setembro), e em "Últimos 7 dias" ela não
 * quer dizer nada.
 */

export type PontoDiario = {
  dia: string
  /** `null` em dia futuro ou sem medição */
  reparos: number | null
}

export type Projecao = {
  /** entrantes projetados para o mês inteiro */
  entrantes: number
  mediaDiaria: number
  /** dias que entraram na média — nunca inclui o dia corrente */
  diasCompletos: number
  diasDoMes: number
}

/** Dias do mês de uma data ISO, sem passar por fuso local. */
function diasNoMes(iso: string): number {
  const [a, m] = iso.split('-').map(Number)
  if (!a || !m) return 0
  // dia 0 do mês seguinte = último dia deste mês
  return new Date(Date.UTC(a, m, 0)).getUTCDate()
}

/** ISO do dia anterior, em UTC puro. */
function diaAnterior(iso: string): string {
  const t = Date.parse(`${iso}T00:00:00Z`)
  if (!Number.isFinite(t)) return iso
  return new Date(t - 86_400_000).toISOString().slice(0, 10)
}

export function projetarMes(
  pontos: PontoDiario[],
  de: string,
  ate: string,
  hoje: string
): Projecao | null {
  const diasDoMes = diasNoMes(hoje)
  if (!diasDoMes) return null

  // o recorte tem de ser o mês corrente, do dia 1 em diante
  if (de !== `${hoje.slice(0, 7)}-01`) return null
  // ...e tem de alcançar o presente; um recorte que parou antes de ontem já é
  // histórico, e extrapolar histórico para o mês inteiro seria inventar.
  if (ate < diaAnterior(hoje)) return null

  let soma = 0
  let diasCompletos = 0
  for (const p of pontos) {
    // `< hoje` é o que mantém o dia pela metade fora da média
    if (p.dia >= hoje || p.dia < de) continue
    if (p.reparos === null) continue
    soma += p.reparos
    diasCompletos += 1
  }
  if (diasCompletos === 0) return null

  const mediaDiaria = soma / diasCompletos
  return {
    entrantes: Math.round(mediaDiaria * diasDoMes),
    mediaDiaria,
    diasCompletos,
    diasDoMes,
  }
}
