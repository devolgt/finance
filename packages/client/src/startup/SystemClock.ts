import { LocalDate, parseTimestamp, type Clock, type Timestamp, type WallClock } from '@finance/core';

/**
 * Relógio real dos dois shells (porta `Clock`, testes §2.4), no `client` porque o
 * desktop e o celular precisam virar o mês no mesmo instante. As duas leituras são
 * diferentes de propósito: `now` é o instante UTC que carimba `updated_at`; `today` é a data
 * do calendário **local** do usuário, que decide o mês corrente — às 22h do dia 31 em
 * São Paulo, o UTC já está no dia 1º, mas o mês do usuário ainda não virou.
 */
export class SystemClock implements Clock {
    /**
     * @param current Fonte do instante atual; trocada nos testes para fixar o horário.
     */
    public constructor(private readonly current: () => Date = () => new Date()) {}

    /** @return O instante UTC no formato do schema, `YYYY-MM-DD HH:MM:SS`. */
    public now(): Timestamp {
        return parseTimestamp(this.current().toISOString().slice(0, 19).replace('T', ' '));
    }

    /** @return A data de hoje no fuso do sistema operacional. */
    public today(): LocalDate {
        const instant = this.current();
        return LocalDate.of(instant.getFullYear(), instant.getMonth() + 1, instant.getDate());
    }
}

/**
 * Relógio de parede do sistema para o HLC da sincronização (sincronizacao §3.2). Mora junto do
 * `SystemClock` porque desktop e celular leem o relógio do mesmo jeito; o HLC tolera que ele
 * pare ou volte.
 */
export class SystemWallClock implements WallClock {
    /**
     * @param current Fonte do instante; os testes a fixam.
     */
    public constructor(private readonly current: () => number = () => Date.now()) {}

    /**
     * @return Milissegundos desde a época Unix.
     */
    public millis(): number {
        return this.current();
    }
}
