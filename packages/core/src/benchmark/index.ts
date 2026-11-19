// Medição das chamadas interativas (mobile §12.1): o roteiro e o banco de referência,
// os mesmos no Node (`pnpm bench:core`) e no Hermes do aparelho.
export { formatBenchmarkLog, INTERACTIVE_OPERATIONS, INTERACTIVE_P95_BUDGET_MS, runInteractiveBenchmark, type InteractiveBenchmarkOptions, type InteractiveOperation, type OperationStats } from './interactiveBenchmark.ts';
export { DEFAULT_HISTORY_OPTIONS, historyPeriods, type HistoryOptions, type HistoryPeriods } from './referenceHistory.ts';
// Medição da cifra da sincronização no Hermes (sincronizacao §5.5, risco aceito da
// decisoes §52): o app de contrato mede o mesmo Noise que as sessões usam.
export { CipherState, keyPairFrom, NOISE_MAX_PLAINTEXT, NoiseHandshake, type KeyPair } from '../protocol/noise/Noise.ts';
