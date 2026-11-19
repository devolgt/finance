/**
 * Regra de endereços locais (sync-design §7.1): só se aceita e só se disca para a rede local
 * — faixas privadas IPv4 (`10/8`, `172.16/12`, `192.168/16`), link-local (`169.254/16`) e os
 * IPv6 link-local (`fe80::/10`) e unique-local (`fc00::/7`). Endereços públicos e a faixa de
 * carrier-grade NAT (`100.64/10`, usada por VPNs overlay como o Tailscale) são recusados.
 *
 * O loopback (`127/8`, `::1`) também é aceito: é o próprio aparelho, que nunca chega à rede,
 * e é o que permite rodar dois apps no mesmo computador no teste de fumaça (sync-plan Fase 7).
 *
 * Fica no núcleo, e não em cada plataforma, para que desktop e celular recusem exatamente o
 * mesmo conjunto.
 * Regra de negócio (Sincronização): a localidade é a segunda camada de segurança, por cima das
 * chaves dos aparelhos e do canal cifrado.
 *
 * @param address Endereço IP como o sistema o informa (IPv6 pode vir com zona `%eth0` ou
 * como IPv4 mapeado `::ffff:192.168.0.2`).
 * @return `true` quando o endereço está numa faixa local.
 */
export function isLocalAddress(address: string): boolean {
    const bare = address.split('%')[0]?.toLowerCase() ?? '';
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(bare);
    const ipv4 = mapped?.[1] ?? bare;
    const octets = parseIpv4(ipv4);
    if (octets !== null) {
        const [a, b] = octets;
        return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
    }
    const first = parseIpv6FirstHextet(bare);
    if (first === null) {
        return false;
    }
    return bare === '::1' || (first & 0xffc0) === 0xfe80 || (first & 0xfe00) === 0xfc00;
}

/**
 * @param text Texto candidato a IPv4.
 * @return Os quatro octetos, ou `null` quando não é um IPv4 válido.
 */
function parseIpv4(text: string): readonly [number, number, number, number] | null {
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
    if (match === null) {
        return null;
    }
    const octets = [match[1], match[2], match[3], match[4]].map(Number);
    if (octets.some((octet) => octet > 255)) {
        return null;
    }
    const [a = 0, b = 0, c = 0, d = 0] = octets;
    return [a, b, c, d];
}

/**
 * @param text Texto candidato a IPv6.
 * @return O primeiro grupo de 16 bits, ou `null` quando o texto não é IPv6.
 */
function parseIpv6FirstHextet(text: string): number | null {
    if (!text.includes(':') || !/^[0-9a-f:.]+$/.test(text)) {
        return null;
    }
    if (text.startsWith('::')) {
        return 0;
    }
    const first = text.split(':')[0] ?? '';
    return first.length === 0 || first.length > 4 ? null : Number.parseInt(first, 16);
}
