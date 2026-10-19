'use client'

import { useEffect, useState } from 'react'

/**
 * O tema vigente, como valor reativo — para os gráficos se RECOLORIREM ao trocar.
 *
 * ⚠️ POR QUE ISTO EXISTE. `lerTokens()` lê as variáveis CSS no instante em que é
 * chamado, e toda `option` de gráfico é montada dentro de um `useMemo` que
 * depende só dos DADOS. Trocar claro↔escuro muda as variáveis CSS na hora, mas
 * não muda dado nenhum — então o memo não reexecutava e o gráfico continuava
 * pintado com as cores do tema ANTERIOR, até que um refetch o reconstruísse por
 * outro motivo.
 *
 * O `Chart` tinha um MutationObserver em `data-theme` cujo comentário prometia
 * "recria a option" e cujo corpo só chamava `chart.resize()`. Redimensionar não
 * recolore nada; a promessa estava no comentário e não no código.
 *
 * Reportado pela Manutenção em 19/10/2026, com os dois sintomas que são o mesmo
 * defeito visto de lados opostos:
 *
 *   escuro → claro .... as linhas de grade do tema escuro, desenhadas sobre
 *                       fundo branco, viram traços pretos grossos
 *   claro → escuro .... a linha do saldo fica invisível, porque a cor que
 *                       contrastava com branco não contrasta com preto
 *
 * Cada gráfico chama este hook e inclui `tema` nas dependências do seu memo. É
 * uma linha por arquivo, e é o que torna a dependência EXPLÍCITA: quem ler o
 * memo vê que ele depende do tema, em vez de depender de um efeito colateral
 * invisível em outro componente.
 */
export function useTemaAtual(): string {
  const [tema, setTema] = useState('')

  useEffect(() => {
    const ler = () => document.documentElement.dataset.theme ?? ''
    setTema(ler())
    const mo = new MutationObserver(() => setTema(ler()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [])

  return tema
}
