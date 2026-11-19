import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeInvite, encodeInvite, type InvitePayload } from '../../src/protocol/messages.ts';

const INVITE: InvitePayload = {
    v: 1,
    group: '0f1e2d3c-4b5a-4968-8776-655443322110',
    host: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    key: 'ab'.repeat(32),
    addresses: ['192.168.0.12', '10.0.0.7'],
    port: 47_321,
    secret: '0123456789abcdef0123456789abcdef',
    expiresAt: 1_763_480_000_123,
};

describe('Texto do QR do convite (sync-design §6.3)', () => {
    it('é curto e só usa o alfabeto do modo alfanumérico do QR', () => {
        const text = encodeInvite({ ...INVITE, addresses: ['192.168.0.12'] });

        expect(text).toMatch(/^[0-9A-Z $%*+\-./:]+$/);
        expect(text.length).toBeLessThanOrEqual(170);
    });

    it('volta ao mesmo convite, inclusive colado em minúsculas e com espaços', () => {
        expect(decodeInvite(encodeInvite(INVITE))).toEqual(INVITE);
        expect(decodeInvite(`  ${encodeInvite(INVITE).toLowerCase()}\n`)).toEqual(INVITE);
    });

    it('vai e volta para qualquer convite com endereços IPv4', () => {
        const hex = (length: number): fc.Arbitrary<string> => fc.uint8Array({ minLength: length, maxLength: length }).map((bytes) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(''));
        const ipv4 = fc.tuple(fc.nat(255), fc.nat(255), fc.nat(255), fc.nat(255)).map((octets) => octets.join('.'));
        const invite = fc.record({
            v: fc.constant(1 as const),
            group: fc.uuid(),
            host: fc.uuid(),
            key: hex(32),
            addresses: fc.array(ipv4, { minLength: 1, maxLength: 8 }),
            port: fc.integer({ min: 1, max: 65_535 }),
            secret: hex(16),
            expiresAt: fc.integer({ min: 0, max: 2 ** 47 }),
        });
        fc.assert(fc.property(invite, (value) => {
            expect(decodeInvite(encodeInvite(value))).toEqual(value);
        }));
    });

    it.each(['https://exemplo.com', 'FINANCAS1:', 'FINANCAS1:AAAA', `${encodeInvite(INVITE)}AA`, 'FINANCAS1:!!!!'])('recusa %s', (text) => {
        expect(decodeInvite(text)).toBeNull();
    });
});
