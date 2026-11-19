import type { Clock, IdGenerator, Timestamp, WallClock } from '../../src/index.ts';
import { LocalDate } from '../../src/index.ts';
import { parseUuid, type Uuid } from '../../src/domain/shared/ids.ts';

/**
 * Relógio de teste controlado pelo próprio teste. Não é mock: é um adaptador de verdade da
 * porta `Clock`, cujo "hoje" o teste fixa e move, porque saldo do mês corrente, fatura em
 * aberto e virada de mês dependem de "hoje" (testes §2.4).
 */
export class FixedClock implements Clock {
    private current: LocalDate;

    /**
     * @param today Data inicial de "hoje", `YYYY-MM-DD`.
     */
    public constructor(today: string) {
        this.current = LocalDate.parse(today);
    }

    /**
     * @return Meio-dia UTC de "hoje"; o horário não importa para as regras, só o formato.
     */
    public now(): Timestamp {
        return `${this.current.toString()} 12:00:00` as Timestamp;
    }

    /**
     * @return O "hoje" fixado pelo teste.
     */
    public today(): LocalDate {
        return this.current;
    }

    /**
     * @param today Nova data de "hoje"; simula a passagem do tempo (virada do mês).
     * @return void
     */
    public set(today: string): void {
        this.current = LocalDate.parse(today);
    }
}

/**
 * Gerador de UUID v4 sequencial: ids previsíveis tornam falhas reproduzíveis e mensagens
 * de erro legíveis, sem mudar o formato que o schema exige.
 */
export class SequentialIds implements IdGenerator {
    private counter = 0;

    /**
     * @param namespace Distingue os aparelhos de um teste de sincronização: cada réplica gera
     * ids próprios, como UUIDs v4 de verdade fariam, sem perder a previsibilidade.
     */
    public constructor(private readonly namespace = 0) {}

    /**
     * @return O próximo id, com versão 4 e variante RFC para passar em qualquer validação.
     */
    public random(): Uuid {
        this.counter++;
        const variant = (0x8000 + this.namespace).toString(16);
        return parseUuid(`00000000-0000-4000-${variant}-${this.counter.toString(16).padStart(12, '0')}`);
    }
}

/**
 * Relógio de parede de teste, em milissegundos. Anda 1 ms a cada leitura por padrão, para
 * que carimbos seguidos tenham relógios distintos como no mundo real, e pode ser parado ou
 * voltado — o caso que o HLC precisa tolerar (sincronizacao §3.2).
 */
export class ManualWallClock implements WallClock {
    /**
     * @param current Milissegundos da próxima leitura.
     * @param step Quanto o relógio anda a cada leitura; `0` simula um relógio parado.
     */
    public constructor(private current = 1_773_576_000_000, public step = 1) {}

    /**
     * @return A leitura atual; avança `step` depois de ler.
     */
    public millis(): number {
        const value = this.current;
        this.current += this.step;
        return value;
    }

    /**
     * @param millis Nova leitura; pode voltar no tempo.
     */
    public set(millis: number): void {
        this.current = millis;
    }
}
