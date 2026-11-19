import { registerRootComponent } from 'expo';
import { createElement, type ReactNode } from 'react';
import { ContractScreen } from './src/ContractScreen.tsx';
import { runCryptoBenchmark, type CryptoBenchmarkReport } from './src/cryptoBenchmark.ts';
import { runDeviceContract } from './src/deviceContract.ts';

/**
 * Mede a cifra e o handshake da sincronização no Hermes, com o relógio monotônico do runtime.
 *
 * @return A vazão da cifra e o tempo do handshake.
 */
function runDeviceCryptoBenchmark(): CryptoBenchmarkReport {
    return runCryptoBenchmark({ now: () => performance.now() });
}

/**
 * Raiz do app de contrato. Sem Expo Router: é uma tela só, e cada dependência a menos é uma
 * fonte a menos de falha que não seja do núcleo ou do `expo-sqlite`.
 *
 * @return A tela do contrato rodando no aparelho, seguida da medição da cifra (sincronizacao §5.5).
 */
function ContractApp(): ReactNode {
    return createElement(ContractScreen, { run: runDeviceContract, benchmark: runDeviceCryptoBenchmark });
}

registerRootComponent(ContractApp);
