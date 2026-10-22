'use client'

import { useCallback, useRef } from 'react'

/**
 * Publica a altura REAL de um elemento numa variável CSS — e a mantém em dia.
 *
 * A altura de cada card sai de `--util`, a área que sobra na janela depois do
 * cromo (padrao.css). A conta da skill supõe a barra de filtros com 50px e a
 * faixa de KPIs com uma altura fixa, e aqui as duas variam: a barra quebra em
 * duas linhas abaixo de ~1700px de largura (são 9 filtros, mais período, eixo e
 * grão) e o aviso de cancelados soma uma faixa; os KPIs crescem quando a
 * descrição quebra. Medido em 1440×900: barra com 78px e KPIs com 103px — as
 * duas faixas de visuais passavam 19px da janela.
 *
 * Com a medida de verdade, a conta fecha em qualquer largura, sem número
 * mágico para envelhecer. Devolve um callback ref; ao desmontar, a variável
 * volta ao padrão do CSS (a Capa e Configurações não têm barra de filtros).
 *
 * `alvo`:
 * - `raiz`: a variável vai para `<html>` (a barra de filtros é da moldura)
 * - `pagina`: vai para o `.pagina` mais próximo (os KPIs são de uma tela só)
 */
export function useAlturaComoVariavel(nome: string, alvo: 'raiz' | 'pagina') {
  const observador = useRef<ResizeObserver | null>(null)
  const dono = useRef<HTMLElement | null>(null)

  return useCallback(
    (el: HTMLElement | null) => {
      observador.current?.disconnect()
      observador.current = null
      dono.current?.style.removeProperty(nome)
      dono.current = null
      if (!el) return

      const destino =
        alvo === 'raiz' ? document.documentElement : el.closest<HTMLElement>('.pagina')
      if (!destino) return
      dono.current = destino

      const publicar = () => destino.style.setProperty(nome, `${Math.ceil(el.offsetHeight)}px`)
      publicar()
      observador.current = new ResizeObserver(publicar)
      observador.current.observe(el)
    },
    [nome, alvo]
  )
}
