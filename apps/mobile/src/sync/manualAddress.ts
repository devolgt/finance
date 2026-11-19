/** Endereço e porta digitados, prontos para o `sync.connect`. */
export interface ManualAddress {
    readonly address: string;
    readonly port: number;
}

/**
 * Lê o endereço digitado em "Digitar endereço manualmente" (sync-design §7.2), no formato que o
 * desktop mostra no convite: `192.168.0.10:45123`, ou `[fe80::1]:45123` para IPv6 — os colchetes
 * separam a porta dos `:` do próprio endereço. A tela confere aqui só o formato; se o endereço é
 * da rede local, quem decide é o núcleo, com a mesma regra da descoberta.
 *
 * @param text Texto digitado; espaços nas pontas são ignorados.
 * @return O endereço e a porta, ou `null` quando falta a porta ou ela está fora de 1–65535.
 */
export function parseManualAddress(text: string): ManualAddress | null {
    const trimmed = text.trim();
    const match = /^\[([0-9a-zA-Z:.%]+)\]:(\d{1,5})$/.exec(trimmed) ?? /^([^:\s[\]]+):(\d{1,5})$/.exec(trimmed);
    const address = match?.[1];
    const port = Number(match?.[2]);
    if (address === undefined || !Number.isInteger(port) || port < 1 || port > 65_535) {
        return null;
    }
    return { address, port };
}
