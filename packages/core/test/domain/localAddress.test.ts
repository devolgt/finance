import { describe, expect, it } from 'vitest';
import { isLocalAddress } from '../../src/domain/sync/LocalAddress.ts';

describe('Regra de endereços locais (sync-design §7.1)', () => {
    it.each(['10.0.0.5', '172.16.0.1', '172.31.255.254', '192.168.1.20', '169.254.10.1', '127.0.0.1', '::1', 'fe80::1%en0', 'fd12:3456::1', '::ffff:192.168.0.7'])(
        'aceita %s',
        (address) => {
            expect(isLocalAddress(address)).toBe(true);
        },
    );

    it.each(['8.8.8.8', '172.32.0.1', '100.64.0.1', '100.100.100.100', '192.169.0.1', '2001:4860::8888', '::ffff:8.8.8.8', 'fe00::1', '256.1.1.1', 'localhost', ''])(
        'recusa %s',
        (address) => {
            expect(isLocalAddress(address)).toBe(false);
        },
    );
});
