import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DeviceId } from '../../src/domain/shared/ids.ts';
import { HybridLogicalClock } from '../../src/domain/sync/HybridLogicalClock.ts';

const DESKTOP = DeviceId('00000000-0000-4000-8000-00000000000a');
const PHONE = DeviceId('00000000-0000-4000-8000-00000000000b');
const NOW = 1_763_000_000_000;

/** Passo de um aparelho: escrita local ou recebimento do relógio do outro. */
type Step = { readonly kind: 'tick'; readonly wall: number } | { readonly kind: 'receive'; readonly wall: number; readonly remoteMillis: number; readonly remoteCounter: number };

// O relógio de parede anda, para e volta: o caso que o HLC existe para tolerar.
const wallArb = fc.integer({ min: NOW - 60_000, max: NOW + 60_000 });
const stepArb: fc.Arbitrary<Step> = fc.oneof(
    fc.record({ kind: fc.constant('tick' as const), wall: wallArb }),
    fc.record({ kind: fc.constant('receive' as const), wall: wallArb, remoteMillis: wallArb, remoteCounter: fc.integer({ min: 0, max: 99_999 }) }),
);

/**
 * Monta um relógio remoto pelo formato serializado, o único caminho por que um relógio de
 * outro aparelho chega a este — exercita também o `parse`.
 *
 * @param millis Componente físico do relógio remoto.
 * @param counter Contador do relógio remoto.
 * @return O relógio do celular nesse instante.
 */
function phoneClock(millis: number, counter: number): HybridLogicalClock {
    return HybridLogicalClock.parse(`${String(millis).padStart(13, '0')}.${String(counter).padStart(5, '0')}.${PHONE}`);
}

describe('HybridLogicalClock (sincronizacao §3.2)', () => {
    it('serializa na largura fixa {ms 13}.{contador 5}.{device_id}', () => {
        const clock = HybridLogicalClock.initial(DESKTOP).tick(NOW);

        expect(clock.toString()).toBe(`1763000000000.00000.${DESKTOP}`);
        expect(HybridLogicalClock.parse(clock.toString())).toEqual(clock);
    });

    it.each([
        '1763000000000.00000',
        '176300000000.00000.00000000-0000-4000-8000-00000000000a',
        '1763000000000.0000.00000000-0000-4000-8000-00000000000a',
        '1763000000000.00000.nao-e-uuid',
        '1763000000000.00000.00000000-0000-4000-8000-00000000000A',
    ])('recusa %s', (text) => {
        expect(() => HybridLogicalClock.parse(text)).toThrow(/hlc|deviceId/);
    });

    it('usa o relógio de parede quando ele anda e o contador quando ele para ou volta', () => {
        const first = HybridLogicalClock.initial(DESKTOP).tick(NOW);
        const stalled = first.tick(NOW);
        const behind = stalled.tick(NOW - 5_000);
        const ahead = behind.tick(NOW + 1);

        expect([stalled.millis, stalled.counter]).toEqual([NOW, 1]);
        expect([behind.millis, behind.counter]).toEqual([NOW, 2]);
        expect([ahead.millis, ahead.counter]).toEqual([NOW + 1, 0]);
    });

    it('transborda o contador para o milissegundo seguinte em vez de quebrar a largura fixa', () => {
        const full = HybridLogicalClock.parse(`${NOW}.99999.${DESKTOP}`);

        const next = full.tick(NOW - 1);

        expect(next.toString()).toBe(`${NOW + 1}.00000.${DESKTOP}`);
        expect(next.isAfter(full)).toBe(true);
    });

    it('fica depois de um relógio remoto adiantado, mantendo o próprio device_id', () => {
        const local = HybridLogicalClock.initial(DESKTOP).tick(NOW);
        const remote = phoneClock(NOW + 30_000, 7);

        const received = local.receive(remote, NOW);

        expect(received.toString()).toBe(`${NOW + 30_000}.00008.${DESKTOP}`);
        expect(received.tick(NOW).isAfter(remote)).toBe(true);
    });

    it('desempata pelo device_id quando milissegundo e contador coincidem', () => {
        const desktop = HybridLogicalClock.parse(`${NOW}.00003.${DESKTOP}`);
        const phone = phoneClock(NOW, 3);

        expect(phone.isAfter(desktop)).toBe(true);
        expect(desktop.compareTo(phone)).toBeLessThan(0);
        expect(desktop.compareTo(HybridLogicalClock.parse(desktop.toString()))).toBe(0);
    });

    it.each([Number.NaN, -1, 1.5, 10_000_000_000_000])('recusa o relógio de parede %s', (wall) => {
        expect(() => HybridLogicalClock.initial(DESKTOP).tick(wall)).toThrow(/wallMillis/);
    });

    it('é estritamente monotônico com o relógio de parede andando, parado e voltando', () => {
        fc.assert(fc.property(fc.array(stepArb, { minLength: 1, maxLength: 200 }), (steps) => {
            let clock = HybridLogicalClock.initial(DESKTOP);
            for (const step of steps) {
                const next = step.kind === 'tick'
                    ? clock.tick(step.wall)
                    : clock.receive(phoneClock(step.remoteMillis, step.remoteCounter), step.wall);
                expect(next.isAfter(clock)).toBe(true);
                expect(next.deviceId).toBe(DESKTOP);
                clock = next;
            }
        }));
    });

    it('preserva a causalidade: o que vem depois de receber é maior que o recebido', () => {
        fc.assert(fc.property(stepArb, wallArb, wallArb, fc.integer({ min: 0, max: 99_999 }), (before, wall, remoteMillis, remoteCounter) => {
            const start = HybridLogicalClock.initial(DESKTOP).tick(before.wall);
            const remote = phoneClock(remoteMillis, remoteCounter);

            const received = start.receive(remote, wall);

            expect(received.isAfter(remote)).toBe(true);
            expect(received.tick(wall).isAfter(remote)).toBe(true);
        }));
    });

    it('ordena as strings na mesma ordem da tupla (ms, contador, device_id)', () => {
        const clockArb = fc.record({ millis: wallArb, counter: fc.integer({ min: 0, max: 99_999 }), phone: fc.boolean() })
            .map(({ millis, counter, phone }) => HybridLogicalClock.parse(`${millis}.${String(counter).padStart(5, '0')}.${phone ? PHONE : DESKTOP}`));
        fc.assert(fc.property(clockArb, clockArb, (a, b) => {
            const tuple = Math.sign(a.millis - b.millis) || Math.sign(a.counter - b.counter) || Math.sign(a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0);

            expect(Math.sign(a.compareTo(b))).toBe(tuple);
        }));
    });
});
