import { InvalidValueError } from '../shared/errors.ts';
import type { DeviceId } from '../shared/ids.ts';
import { compareCodeUnits } from '../shared/textOrder.ts';

/**
 * Vetor de versões: por aparelho de origem, a maior sequência de origem que um aparelho
 * possui (sincronizacao §3.3). É prefixo-completo — ter N significa ter todas as entradas até
 * N daquela origem —, porque um lote é aplicado inteiro numa transação. Com isso, "o que
 * falta ao par" é só "toda entrada com sequência maior que a do vetor dele".
 *
 * Imutável: `with` e `merge` devolvem vetores novos.
 */
export class VersionVector {
    /**
     * @param entries Sequência por origem; origens ausentes valem 0.
     */
    private constructor(private readonly entries: ReadonlyMap<DeviceId, number>) {}

    /** O vetor de quem não tem nada — o de um aparelho que acabou de entrar vazio. */
    public static readonly EMPTY = new VersionVector(new Map());

    /**
     * @param entries Pares (origem, sequência) lidos de `sync_vector` ou de uma mensagem.
     * @return O vetor.
     * @throws {InvalidValueError} Quando uma sequência não é inteiro não negativo — um vetor
     * assim pediria entradas que não existem ou esconderia as que faltam.
     */
    public static of(entries: Iterable<readonly [DeviceId, number]>): VersionVector {
        const map = new Map<DeviceId, number>();
        for (const [origin, seq] of entries) {
            if (!Number.isSafeInteger(seq) || seq < 0) {
                throw new InvalidValueError('vector', `sequência inválida para ${origin}: ${seq}`);
            }
            map.set(origin, Math.max(seq, map.get(origin) ?? 0));
        }
        return new VersionVector(map);
    }

    /**
     * @param origin Aparelho de origem.
     * @return A maior sequência possuída daquela origem; 0 quando nada foi recebido dela.
     */
    public seqOf(origin: DeviceId): number {
        return this.entries.get(origin) ?? 0;
    }

    /**
     * @param origin Aparelho de origem.
     * @param seq Sequência agora possuída.
     * @return O vetor avançado; nunca recua, para que um lote atrasado não faça o aparelho
     * pedir de novo o que já tem.
     */
    public with(origin: DeviceId, seq: number): VersionVector {
        return VersionVector.of([...this.entries, [origin, seq]]);
    }

    /**
     * @param other Vetor de quem enviou um lote completo.
     * @return O máximo por origem — o que este aparelho passa a ter depois de aplicar o lote.
     */
    public merge(other: VersionVector): VersionVector {
        return VersionVector.of([...this.entries, ...other.entries]);
    }

    /**
     * @return As entradas em ordem de origem, para serializar de forma estável.
     */
    public toEntries(): readonly (readonly [DeviceId, number])[] {
        return [...this.entries].sort(([a], [b]) => compareCodeUnits(a, b));
    }

    /**
     * @param other Outro vetor.
     * @return `true` quando este possui tudo o que `other` possui — o fim da troca de uma sessão.
     */
    public covers(other: VersionVector): boolean {
        return [...other.entries].every(([origin, seq]) => this.seqOf(origin) >= seq);
    }
}
