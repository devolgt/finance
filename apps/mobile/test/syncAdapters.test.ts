import { isLocalAddress } from '@finance/core';
import { ChunkQueue, fromHex, peersOf, toHex } from '../src/platform/syncAdapters.ts';
import { setAsideDatabase } from '../src/startup/discardDatabase.ts';
import { databaseFiles } from '../src/startup/databaseFiles.ts';
import { parseManualAddress } from '../src/sync/manualAddress.ts';
import { MemoryFileSystem } from './support/MemoryFileSystem.ts';

/**
 * @param text Texto a codificar.
 * @return Os bytes UTF-8.
 */
function bytes(text: string): Uint8Array {
    return new TextEncoder().encode(text);
}

describe('fila de leitura da Connection (sync-plan Fase 8)', () => {
    it('entrega os pedaços na ordem, tanto os que chegaram antes quanto os que chegam depois do read', async () => {
        const queue = new ChunkQueue();
        queue.push(bytes('a'));
        const early = await queue.next();
        const pending = queue.next();
        queue.push(bytes('b'));
        queue.push(bytes('c'));

        expect(early).toEqual(bytes('a'));
        expect(await pending).toEqual(bytes('b'));
        expect(await queue.next()).toEqual(bytes('c'));
    });

    it('no fim, entrega o que sobrou e depois null — e solta quem estava esperando, para a sessão não travar', async () => {
        const queue = new ChunkQueue();
        const waiting = queue.next();
        queue.end();
        expect(await waiting).toBeNull();

        const other = new ChunkQueue();
        other.push(bytes('último lote'));
        other.end();
        other.push(bytes('depois do fim'));
        expect(await other.next()).toEqual(bytes('último lote'));
        expect(await other.next()).toBeNull();
    });
});

describe('pares descobertos pelo mDNS (sync-design §7.2)', () => {
    it('vira um par por endereço local, com o id e o hash do grupo do TXT', () => {
        const peers = peersOf({ txt: { device: 'aparelho-1', group: 'hash' }, addresses: ['192.168.0.10', 'fe80::1', '100.64.0.2', '8.8.8.8'], port: 45123 }, isLocalAddress);

        expect(peers).toEqual([
            { deviceId: 'aparelho-1', groupHash: 'hash', address: '192.168.0.10', port: 45123 },
            { deviceId: 'aparelho-1', groupHash: 'hash', address: 'fe80::1', port: 45123 },
        ]);
    });

    it('ignora o serviço sem o TXT da sincronização', () => {
        expect(peersOf({ txt: { device: 'aparelho-1' }, addresses: ['192.168.0.10'], port: 1 }, isLocalAddress)).toEqual([]);
        expect(peersOf({ txt: { device: '', group: 'hash' }, addresses: ['192.168.0.10'], port: 1 }, isLocalAddress)).toEqual([]);
    });
});

describe('chave do aparelho no expo-secure-store', () => {
    it('vai e volta em hexadecimal; texto corrompido vira "sem chave"', () => {
        const key = Uint8Array.from({ length: 32 }, (_, index) => index * 7);

        expect(fromHex(toHex(key))).toEqual(key);
        expect(fromHex('abc')).toBeNull();
        expect(fromHex('zz')).toBeNull();
    });
});

describe('endereço digitado', () => {
    it('lê IPv4 e IPv6 entre colchetes com a porta, e recusa sem porta ou fora da faixa', () => {
        expect(parseManualAddress(' 192.168.0.10:45123 ')).toEqual({ address: '192.168.0.10', port: 45123 });
        expect(parseManualAddress('[fe80::1%wlan0]:8080')).toEqual({ address: 'fe80::1%wlan0', port: 8080 });
        expect(parseManualAddress('192.168.0.10')).toBeNull();
        expect(parseManualAddress('192.168.0.10:0')).toBeNull();
        expect(parseManualAddress('192.168.0.10:70000')).toBeNull();
        expect(parseManualAddress('fe80::1:80')).toBeNull();
    });
});

describe('Regra de negócio (Sincronização): descartar o banco para entrar num grupo', () => {
    const paths = databaseFiles('file:///SQLite', 'finance.sqlite', 'file:///docs');

    it('guarda o banco e o WAL em backups, sem apagar, e não deixa marca de restauração', () => {
        const files = new MemoryFileSystem();
        files.writeText(paths.databaseUri, 'banco');
        files.writeText(`${paths.databaseUri}-wal`, 'wal');

        const result = setAsideDatabase(files, paths, '20261118-120000');

        expect(result).toEqual({ ok: true, previousCopy: 'antes-de-entrar-no-grupo-20261118-120000.sqlite' });
        expect(files.exists(paths.databaseUri)).toBe(false);
        expect(files.readText('file:///SQLite/backups/antes-de-entrar-no-grupo-20261118-120000.sqlite')).toBe('banco');
        expect(files.readText('file:///SQLite/backups/antes-de-entrar-no-grupo-20261118-120000.sqlite-wal')).toBe('wal');
        expect(files.exists(paths.restoreMarkerUri)).toBe(false);
    });

    it('se o disco recusa no meio, devolve o que andou e o banco continua no lugar', () => {
        const files = new MemoryFileSystem();
        files.writeText(paths.databaseUri, 'banco');
        files.writeText(`${paths.databaseUri}-wal`, 'wal');
        files.failOn('move', 1, 1);

        const result = setAsideDatabase(files, paths, '20261118-120000');

        expect(result).toEqual({ ok: false, reason: 'io-error' });
        expect(files.readText(paths.databaseUri)).toBe('banco');
        expect(files.readText(`${paths.databaseUri}-wal`)).toBe('wal');
        expect(files.exists(paths.restoreMarkerUri)).toBe(false);
    });

    it('se nem o desfazer funciona, a marca fica, para a abertura bloquear apontando o banco', () => {
        const files = new MemoryFileSystem();
        files.writeText(paths.databaseUri, 'banco');
        files.writeText(`${paths.databaseUri}-wal`, 'wal');
        files.failOn('move', 1);

        const result = setAsideDatabase(files, paths, '20261118-120000');

        expect(result).toEqual({ ok: false, reason: 'database-moved', failedCopy: 'antes-de-entrar-no-grupo-20261118-120000.sqlite' });
        expect(files.exists(paths.restoreMarkerUri)).toBe(true);
    });
});
