import { InvalidValueError } from '../shared/errors.ts';
import { DeviceId } from '../shared/ids.ts';
import { compareCodeUnits } from '../shared/textOrder.ts';

/** Maior valor que cabe nos 13 dígitos dos milissegundos (ano 2286). */
const MAX_MILLIS = 9_999_999_999_999;
/** Maior valor que cabe nos 5 dígitos do contador. */
const MAX_COUNTER = 99_999;
const MILLIS_DIGITS = 13;
const COUNTER_DIGITS = 5;
const PATTERN = /^(\d{13})\.(\d{5})\.(.+)$/;

/**
 * Relógio lógico híbrido (HLC) de um aparelho: o instante da última escrita que ele carimbou
 * ou viu. É o relógio da sincronização, e não `updated_at`, porque precisa de precisão de
 * milissegundo, de ordem estrita quando o relógio de parede para ou volta e de um desempate
 * entre aparelhos — três coisas que `updated_at` não oferece.
 * Regra de negócio (Sincronização): a escrita com o maior relógio vence a célula, e uma
 * mudança feita depois de ver outra sempre fica ordenada depois dela (sincronizacao §3.1 e §3.2).
 *
 * O valor é imutável: `tick` e `receive` devolvem um relógio novo, que o chamador persiste em
 * `sync_state`. A forma serializada tem largura fixa (`{ms 13}.{contador 5}.{device_id}`)
 * para que a ordem dos relógios seja a ordem das strings — `sync_rows` e `sync_cells` comparam
 * relógios no SQL sem decodificá-los.
 */
export class HybridLogicalClock {
    /**
     * @param millis Componente físico, em milissegundos desde a época Unix; o maior relógio
     * de parede já observado por este aparelho, local ou remoto.
     * @param counter Desempate lógico entre carimbos com o mesmo `millis`; é o que mantém a
     * ordem estrita quando o relógio de parede não anda.
     * @param deviceId Aparelho que emitiu o carimbo; desempate final entre aparelhos que
     * escreveram no mesmo milissegundo com o mesmo contador.
     */
    private constructor(
        public readonly millis: number,
        public readonly counter: number,
        public readonly deviceId: DeviceId,
    ) {}

    /**
     * Relógio de um aparelho que ainda não carimbou nada. Existe para a ativação da
     * sincronização: o primeiro `tick` parte dele e já sai com o relógio de parede.
     *
     * @param deviceId Aparelho dono do relógio.
     * @return O relógio na origem do tempo, menor que qualquer carimbo real.
     */
    public static initial(deviceId: DeviceId): HybridLogicalClock {
        return new HybridLogicalClock(0, 0, deviceId);
    }

    /**
     * Lê um relógio serializado — de `sync_state`, de `sync_rows`/`sync_cells` ou de um lote
     * recebido. Valida a forma porque um relógio malformado vindo da rede compararia errado
     * como string e decidiria células sem que ninguém percebesse.
     *
     * @param text Relógio no formato `{ms 13}.{contador 5}.{device_id}`.
     * @return O relógio.
     * @throws {InvalidValueError} Quando o texto não segue o formato ou o id não é um UUID canônico.
     */
    public static parse(text: string): HybridLogicalClock {
        const match = PATTERN.exec(text);
        if (match === null) {
            throw new InvalidValueError('hlc', `relógio fora do formato {ms 13}.{contador 5}.{device_id}: "${text}"`);
        }
        const deviceId = DeviceId(match[3] ?? '');
        if (deviceId !== match[3]) {
            // Um id em maiúsculas normalizaria para outro texto e quebraria a ordem por string.
            throw new InvalidValueError('hlc', `device_id do relógio não está na forma canônica: "${text}"`);
        }
        return new HybridLogicalClock(Number(match[1]), Number(match[2]), deviceId);
    }

    /**
     * Carimba uma escrita local. Usa o relógio de parede quando ele está à frente; senão
     * mantém o componente físico e incrementa o contador, para que uma transação feita com o
     * relógio parado ou atrasado (ajuste de NTP, fuso trocado à mão) ainda fique depois da
     * anterior.
     *
     * @param wallMillis Relógio de parede atual, em milissegundos; vem da plataforma porque o
     * domínio não lê o relógio do sistema (testes §2.4).
     * @return O novo relógio, estritamente maior que este; é também o carimbo da escrita.
     * @throws {InvalidValueError} Quando o relógio de parede não é um inteiro não negativo ou o
     * resultado não cabe no formato.
     */
    public tick(wallMillis: number): HybridLogicalClock {
        const wall = HybridLogicalClock.validWall(wallMillis);
        if (wall > this.millis) {
            return HybridLogicalClock.advance(wall, 0, this.deviceId);
        }
        return HybridLogicalClock.advance(this.millis, this.counter + 1, this.deviceId);
    }

    /**
     * Avança o relógio para além de um relógio remoto visto num lote. Sem isso, um aparelho
     * com o relógio de parede atrasado carimbaria a próxima edição *antes* da mudança que
     * acabou de receber, e a edição dele — feita depois, por quem já via o valor remoto —
     * perderia o last-writer-wins.
     * Regra de negócio (Sincronização): a causalidade é preservada (sincronizacao §3.2).
     *
     * @param remote Relógio de uma entrada recebida de outro aparelho.
     * @param wallMillis Relógio de parede atual, em milissegundos.
     * @return O novo relógio deste aparelho, estritamente maior que este e que `remote`.
     * @throws {InvalidValueError} Quando o relógio de parede não é um inteiro não negativo ou o
     * resultado não cabe no formato.
     */
    public receive(remote: HybridLogicalClock, wallMillis: number): HybridLogicalClock {
        const wall = HybridLogicalClock.validWall(wallMillis);
        const millis = Math.max(wall, this.millis, remote.millis);
        if (millis === this.millis && millis === remote.millis) {
            return HybridLogicalClock.advance(millis, Math.max(this.counter, remote.counter) + 1, this.deviceId);
        }
        if (millis === this.millis) {
            return HybridLogicalClock.advance(millis, this.counter + 1, this.deviceId);
        }
        if (millis === remote.millis) {
            return HybridLogicalClock.advance(millis, remote.counter + 1, this.deviceId);
        }
        return HybridLogicalClock.advance(millis, 0, this.deviceId);
    }

    /**
     * @param other Outro relógio.
     * @return Negativo quando este vem antes, positivo quando vem depois, zero quando são o
     * mesmo carimbo. É a mesma ordem da comparação das formas serializadas no SQL.
     */
    public compareTo(other: HybridLogicalClock): number {
        return compareCodeUnits(this.toString(), other.toString());
    }

    /**
     * @param other Relógio com que comparar.
     * @return `true` quando este relógio é estritamente mais novo — o que decide se uma
     * escrita recebida vence a célula local.
     */
    public isAfter(other: HybridLogicalClock): boolean {
        return this.compareTo(other) > 0;
    }

    /**
     * @return A forma de largura fixa gravada no banco e enviada nos lotes.
     */
    public toString(): string {
        const millis = String(this.millis).padStart(MILLIS_DIGITS, '0');
        const counter = String(this.counter).padStart(COUNTER_DIGITS, '0');
        return `${millis}.${counter}.${this.deviceId}`;
    }

    /**
     * Monta um relógio, transbordando o contador para o milissegundo seguinte. O transbordo
     * existe porque o contador tem 5 dígitos: mais de 99.999 carimbos no mesmo milissegundo
     * (um relógio de parede muito atrasado diante de um remoto adiantado) não pode nem
     * quebrar a largura fixa nem lançar erro no meio de uma escrita do usuário. Adiantar o
     * componente físico em 1 ms mantém a ordem estrita, e a recusa de sessão por divergência
     * de relógio (sincronizacao §3.2) limita quanto ele pode se afastar do relógio real.
     *
     * @param millis Componente físico desejado.
     * @param counter Contador desejado; pode passar do máximo, e então transborda.
     * @param deviceId Aparelho dono do relógio.
     * @return O relógio dentro do formato.
     * @throws {InvalidValueError} Quando o componente físico passa de 13 dígitos.
     */
    private static advance(millis: number, counter: number, deviceId: DeviceId): HybridLogicalClock {
        const carried = counter > MAX_COUNTER ? { millis: millis + 1, counter: 0 } : { millis, counter };
        if (carried.millis > MAX_MILLIS) {
            throw new InvalidValueError('hlc', `relógio além do formato de 13 dígitos: ${carried.millis}`);
        }
        return new HybridLogicalClock(carried.millis, carried.counter, deviceId);
    }

    /**
     * @param wallMillis Relógio de parede vindo da plataforma.
     * @return O mesmo valor, validado; existe para que um `NaN` de um adaptador com defeito não
     * vire um relógio que compara errado.
     * @throws {InvalidValueError} Quando não é um inteiro entre 0 e o máximo de 13 dígitos.
     */
    private static validWall(wallMillis: number): number {
        if (!Number.isSafeInteger(wallMillis) || wallMillis < 0 || wallMillis > MAX_MILLIS) {
            throw new InvalidValueError('wallMillis', `relógio de parede inválido: ${wallMillis}`);
        }
        return wallMillis;
    }
}
