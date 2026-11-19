// O Noise vem do subcaminho de medição do núcleo: a API pública principal não o expõe, porque é
// detalhe do protocolo, mas a medição precisa da mesma implementação que as sessões usam.
import { CipherState, keyPairFrom, NOISE_MAX_PLAINTEXT, NoiseHandshake, type KeyPair } from '@finance/core/benchmark';

/** Quanto texto cifrar na medição da vazão: alguns megabytes, o tamanho de um lote grande ou de um snapshot. */
const DEFAULT_CIPHER_BYTES = 8 * 1024 * 1024;

/** Handshakes medidos; a média de vários dilui a primeira chamada, mais lenta no Hermes sem JIT. */
const DEFAULT_HANDSHAKES = 20;

/** Bytes num megabyte, no sentido decimal (10^6), o mesmo das velocidades de rede. */
const BYTES_PER_MEGABYTE = 1_000_000;

/** Resultado da medição da criptografia da sincronização no runtime sob teste. */
export interface CryptoBenchmarkReport {
    /** Vazão da ChaCha20-Poly1305 cifrando mensagens do tamanho máximo do Noise. */
    readonly cipherMbPerSecond: number;
    /** Quantos bytes foram cifrados. */
    readonly cipherBytes: number;
    /** Tempo médio de um handshake Noise KK completo, os dois lados no mesmo processo. */
    readonly handshakeMs: number;
    /** Quantos handshakes entraram na média. */
    readonly handshakes: number;
}

/** O que a medição recebe do runtime. */
export interface CryptoBenchmarkOptions {
    /** Relógio monotônico em milissegundos (`performance.now` no Hermes e no Node). */
    readonly now: () => number;
    readonly cipherBytes?: number;
    readonly handshakes?: number;
}

/**
 * @param bytes Bytes processados.
 * @param elapsedMs Tempo gasto.
 * @return A vazão em MB/s decimais; `0` quando o relógio não andou, para um relógio grosseiro não
 * virar uma vazão infinita no relatório.
 */
export function megabytesPerSecond(bytes: number, elapsedMs: number): number {
    return elapsedMs <= 0 ? 0 : bytes / BYTES_PER_MEGABYTE / (elapsedMs / 1000);
}

/**
 * @param elapsedMs Tempo total.
 * @param count Quantas operações.
 * @return O tempo médio de uma operação; `0` sem operações.
 */
export function millisecondsPerOperation(elapsedMs: number, count: number): number {
    return count <= 0 ? 0 : elapsedMs / count;
}

/**
 * Bytes de chave determinísticos. A medição não precisa de segredo — só de chaves válidas para o
 * X25519 —, e o app de contrato não tem gerador seguro (o Hermes não tem `crypto`); um gerador
 * fixo também deixa o resultado reproduzível entre execuções.
 *
 * @param seed Semente da chave.
 * @return 32 bytes.
 */
function keyBytes(seed: number): Uint8Array {
    return Uint8Array.from({ length: 32 }, (_, index) => (seed * 31 + index * 7 + 1) & 0xff);
}

/**
 * Um handshake KK inteiro, como o da sessão normal entre dois membros (sync-design §7.4): os dois
 * lados já conhecem a chave pública um do outro e trocam as duas mensagens do padrão.
 *
 * @param round Número do handshake, que varia as chaves efêmeras.
 * @param initiatorKeys Chaves estáticas de quem disca.
 * @param responderKeys Chaves estáticas de quem atende.
 * @throws {Error} Quando o handshake não completa — o Noise do núcleo quebrou no runtime.
 */
function runKkHandshake(round: number, initiatorKeys: KeyPair, responderKeys: KeyPair): void {
    const prologue = new Uint8Array([1]);
    const payload = new Uint8Array(0);
    const initiator = new NoiseHandshake({ pattern: 'KK', initiator: true, prologue, staticKeys: initiatorKeys, remoteStatic: responderKeys.publicKey, psk: null, ephemeral: () => keyPairFrom(keyBytes(round * 2 + 100)) });
    const responder = new NoiseHandshake({ pattern: 'KK', initiator: false, prologue, staticKeys: responderKeys, remoteStatic: initiatorKeys.publicKey, psk: null, ephemeral: () => keyPairFrom(keyBytes(round * 2 + 101)) });
    responder.readMessage(initiator.writeMessage(payload));
    initiator.readMessage(responder.writeMessage(payload));
    if (!initiator.isComplete() || !responder.isComplete()) {
        throw new Error('o handshake KK não completou');
    }
    initiator.split();
    responder.split();
}

/**
 * Mede a criptografia da sincronização no runtime (sync-plan Fase 5; mobile-shell-design §5.1,
 * "Risco aceito"): o Hermes não tem JIT, e a cifra em JavaScript puro das `@noble` pode não dar
 * vazão para um snapshot de alguns megabytes. Usa o código do núcleo — a `CipherState` da sessão
 * e o `NoiseHandshake` —, e não a biblioteca direto, para medir exatamente o que roda na
 * sincronização, com o nonce e a etiqueta de cada mensagem. Se a vazão não bastar, a primitiva
 * passa para um módulo nativo por trás de uma porta.
 *
 * @param options Relógio e tamanhos da medição.
 * @return A vazão da cifra e o tempo médio do handshake.
 */
export function runCryptoBenchmark(options: CryptoBenchmarkOptions): CryptoBenchmarkReport {
    const cipherBytes = options.cipherBytes ?? DEFAULT_CIPHER_BYTES;
    const handshakes = options.handshakes ?? DEFAULT_HANDSHAKES;

    const cipher = new CipherState(keyBytes(1));
    const message = new Uint8Array(NOISE_MAX_PLAINTEXT).fill(0x5a);
    const associated = new Uint8Array(0);
    let encrypted = 0;
    const cipherStart = options.now();
    while (encrypted < cipherBytes) {
        const size = Math.min(message.length, cipherBytes - encrypted);
        cipher.encrypt(associated, size === message.length ? message : message.subarray(0, size));
        encrypted += size;
    }
    const cipherMs = options.now() - cipherStart;

    const initiatorKeys = keyPairFrom(keyBytes(2));
    const responderKeys = keyPairFrom(keyBytes(3));
    const handshakeStart = options.now();
    for (let round = 0; round < handshakes; round++) {
        runKkHandshake(round, initiatorKeys, responderKeys);
    }
    const handshakeMs = options.now() - handshakeStart;

    return {
        cipherMbPerSecond: megabytesPerSecond(encrypted, cipherMs),
        cipherBytes: encrypted,
        handshakeMs: millisecondsPerOperation(handshakeMs, handshakes),
        handshakes,
    };
}

/**
 * @param report Resultado da medição.
 * @return A linha da tela do app de contrato.
 */
export function describeCryptoBenchmark(report: CryptoBenchmarkReport): string {
    return `Cifra ChaCha20-Poly1305: ${report.cipherMbPerSecond.toFixed(1)} MB/s · handshake Noise KK: ${report.handshakeMs.toFixed(1)} ms`;
}

/**
 * Linha estável para o `adb logcat`, como a do contrato: é o que fica guardado da execução no
 * aparelho, para comparar versões e aparelhos sem captura de tela.
 *
 * @param report Resultado da medição.
 * @return A linha do log.
 */
export function formatCryptoBenchmarkLog(report: CryptoBenchmarkReport): string {
    return `[cifra] chacha20poly1305=${report.cipherMbPerSecond.toFixed(2)}MB/s bytes=${String(report.cipherBytes)} handshake-kk=${report.handshakeMs.toFixed(2)}ms n=${String(report.handshakes)}`;
}
