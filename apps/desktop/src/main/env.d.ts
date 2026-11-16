/*
 * Tipos dos sufixos de importação do electron-vite no processo principal: o `?asset`, que copia o
 * arquivo para `out/` e devolve o caminho dele em tempo de execução. O `tsconfig.node.json` limita
 * `types` ao Node, então a referência precisa ser explícita.
 */
/// <reference types="electron-vite/node" />
