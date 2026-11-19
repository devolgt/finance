import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { keyPairFrom, NoiseError, NoiseHandshake, type NoisePattern, type TransportCiphers } from '../../src/protocol/noise/Noise.ts';

/** Um vetor da cacophony, só com os campos usados aqui. */
interface Vector {
    readonly protocol_name: string;
    readonly init_prologue: string;
    readonly init_static: string;
    readonly init_ephemeral: string;
    readonly init_remote_static?: string;
    readonly init_psks?: readonly string[];
    readonly resp_prologue: string;
    readonly resp_static: string;
    readonly resp_ephemeral: string;
    readonly resp_remote_static?: string;
    readonly resp_psks?: readonly string[];
    readonly handshake_hash: string;
    readonly messages: readonly { readonly payload: string; readonly ciphertext: string }[];
}

const vectors = (JSON.parse(readFileSync(new URL('../fixtures/noise-vectors.json', import.meta.url), 'utf8')) as { readonly vectors: readonly Vector[] }).vectors;

/**
 * @param vector Vetor.
 * @param initiator Lado.
 * @return O handshake configurado com as chaves e a efêmera fixas do vetor.
 */
function side(vector: Vector, initiator: boolean): NoiseHandshake {
    const pattern = /^Noise_(\w+?)_25519/.exec(vector.protocol_name)?.[1] as NoisePattern;
    const remote = initiator ? vector.init_remote_static : vector.resp_remote_static;
    const psk = (initiator ? vector.init_psks : vector.resp_psks)?.[0];
    return new NoiseHandshake({
        pattern,
        initiator,
        prologue: hexToBytes(initiator ? vector.init_prologue : vector.resp_prologue),
        staticKeys: keyPairFrom(hexToBytes(initiator ? vector.init_static : vector.resp_static)),
        remoteStatic: remote === undefined ? null : hexToBytes(remote),
        psk: psk === undefined ? null : hexToBytes(psk),
        ephemeral: () => keyPairFrom(hexToBytes(initiator ? vector.init_ephemeral : vector.resp_ephemeral)),
    });
}

describe('Noise sobre @noble (sync-plan Fase 5)', () => {
    it.each(vectors.map((vector) => [vector.protocol_name, vector] as const))('confere com os vetores públicos: %s', (_name, vector) => {
        const initiator = side(vector, true);
        const responder = side(vector, false);
        let ciphers: { initiator: TransportCiphers; responder: TransportCiphers } | null = null;

        vector.messages.forEach((message, index) => {
            const fromInitiator = index % 2 === 0;
            const payload = hexToBytes(message.payload);
            if (ciphers === null) {
                const [writer, reader] = fromInitiator ? [initiator, responder] : [responder, initiator];
                const sent = writer.writeMessage(payload);
                expect(bytesToHex(sent)).toBe(message.ciphertext);
                expect(bytesToHex(reader.readMessage(sent))).toBe(message.payload);
                if (initiator.isComplete() && responder.isComplete()) {
                    ciphers = { initiator: initiator.split(), responder: responder.split() };
                    expect(bytesToHex(ciphers.initiator.handshakeHash)).toBe(vector.handshake_hash);
                }
                return;
            }
            const [writer, reader] = fromInitiator ? [ciphers.initiator, ciphers.responder] : [ciphers.responder, ciphers.initiator];
            const sent = writer.send.encrypt(new Uint8Array(0), payload);
            expect(bytesToHex(sent)).toBe(message.ciphertext);
            expect(bytesToHex(reader.receive.decrypt(new Uint8Array(0), sent))).toBe(message.payload);
        });
        expect(ciphers).not.toBeNull();
    });

    it('recusa mensagem adulterada e chave estática errada', () => {
        const [vector] = vectors;
        if (vector === undefined) {
            throw new Error('sem vetores');
        }
        const initiator = side(vector, true);
        const responder = side(vector, false);
        const first = initiator.writeMessage(utf8ToBytes('oi'));
        const tampered = first.slice();
        tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
        expect(() => responder.readMessage(tampered)).toThrow(NoiseError);

        const stranger = new NoiseHandshake({
            pattern: 'KK',
            initiator: false,
            prologue: hexToBytes(vector.resp_prologue),
            staticKeys: keyPairFrom(new Uint8Array(32).fill(7)),
            remoteStatic: keyPairFrom(hexToBytes(vector.init_static)).publicKey,
            psk: null,
            ephemeral: () => keyPairFrom(new Uint8Array(32).fill(9)),
        });
        expect(() => stranger.readMessage(side(vector, true).writeMessage(new Uint8Array(0)))).toThrow(NoiseError);
    });
});
