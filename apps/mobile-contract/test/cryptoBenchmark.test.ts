import { describeCryptoBenchmark, formatCryptoBenchmarkLog, megabytesPerSecond, millisecondsPerOperation, runCryptoBenchmark } from '../src/cryptoBenchmark.ts';

/**
 * Relógio de teste que anda um passo fixo a cada leitura: a medição lê o relógio duas vezes por
 * etapa, então cada etapa "dura" exatamente um passo.
 *
 * @param stepMs Quanto o relógio anda por leitura.
 * @return O relógio.
 */
function steppingClock(stepMs: number): () => number {
    let now = 0;
    return () => {
        now += stepMs;
        return now;
    };
}

describe('medição da cifra da sincronização (sincronizacao §5.5)', () => {
    it('converte bytes e tempo em MB/s decimais e ms por operação, sem infinito com o relógio parado', () => {
        expect(megabytesPerSecond(8_000_000, 2_000)).toBe(4);
        expect(megabytesPerSecond(1_000, 0)).toBe(0);
        expect(millisecondsPerOperation(250, 20)).toBe(12.5);
        expect(millisecondsPerOperation(250, 0)).toBe(0);
    });

    it('cifra o volume pedido com a CipherState do núcleo e completa os handshakes KK', () => {
        const report = runCryptoBenchmark({ now: steppingClock(100), cipherBytes: 200_000, handshakes: 2 });

        expect(report).toEqual({ cipherMbPerSecond: 2, cipherBytes: 200_000, handshakeMs: 50, handshakes: 2 });
        expect(describeCryptoBenchmark(report)).toBe('Cifra ChaCha20-Poly1305: 2.0 MB/s · handshake Noise KK: 50.0 ms');
        expect(formatCryptoBenchmarkLog(report)).toBe('[cifra] chacha20poly1305=2.00MB/s bytes=200000 handshake-kk=50.00ms n=2');
    });
});
