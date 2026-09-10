/**
 * `next build` num diretório de saída SEPARADO, para validar o build sem derrubar
 * o dev server.
 *
 * POR QUE UM SCRIPT E NÃO UMA LINHA NO package.json: no Windows o npm executa os
 * scripts pelo `cmd.exe`, que não entende a sintaxe POSIX `VAR=valor comando` —
 * ele tenta rodar `NEXT_DIST_DIR` como se fosse um programa e falha com
 * "não é reconhecido como um comando interno ou externo". Pior: falha ANTES de
 * chamar o next, então o build simplesmente não acontece e parece ter dado certo.
 * Definir a variável aqui, em JS, funciona igual nos dois shells e sem depender
 * de `cross-env`.
 *
 * O problema que isto resolve: `next build` e `next dev` gravam no mesmo `.next`.
 * Buildar com o dev server no ar troca os artefatos de desenvolvimento pelos de
 * produção, e a página passa a abrir sem CSS, com todos os assets em 404.
 */
import { spawnSync } from 'node:child_process'

const DIST = '.next-verify'

// comando como STRING única: com `shell: true`, passar args em array dispara
// DEP0190 (os argumentos são concatenados, não escapados). Aqui não há entrada
// externa, mas a forma correta é a string.
const r = spawnSync('npx next build', {
  stdio: 'inherit',
  env: { ...process.env, NEXT_DIST_DIR: DIST },
  // no Windows o npx é um .cmd; sem shell:true o spawn não o encontra
  shell: true,
})

if (r.status !== 0) {
  console.error(`\n✗ build falhou (saída ${r.status}) — saída em ${DIST}/`)
  process.exit(r.status ?? 1)
}
console.log(`\n✓ build ok, em ${DIST}/ — o .next do dev server não foi tocado`)
