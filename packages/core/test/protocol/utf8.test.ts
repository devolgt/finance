import fc from 'fast-check';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import { decodeUtf8 } from '../../src/protocol/utf8.ts';

describe('decodeUtf8 (protocolo no Hermes)', () => {
    it('é o inverso da codificação para qualquer texto, inclusive acentos e emoji', () => {
        fc.assert(fc.property(fc.string({ unit: 'grapheme' }), (text) => {
            expect(decodeUtf8(utf8ToBytes(text))).toBe(text);
        }));
        expect(decodeUtf8(utf8ToBytes('Alimentação 💸'))).toBe('Alimentação 💸');
    });

    it('troca sequências inválidas por U+FFFD, como o TextDecoder', () => {
        const invalid = Uint8Array.of(0x61, 0xc3, 0x28, 0xed, 0xa0, 0x80, 0xff);
        expect(decodeUtf8(invalid)).toBe(new TextDecoder().decode(invalid));
    });
});
