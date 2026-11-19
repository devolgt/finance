/**
 * Decodifica UTF-8 sem `TextDecoder`. O núcleo roda também no Hermes, onde o `TextDecoder`
 * não é garantido em toda versão do React Native; as mensagens do protocolo são JSON em UTF-8
 * e precisam ser lidas igual nas duas plataformas.
 *
 * @param bytes Texto em UTF-8.
 * @return O texto; sequências inválidas viram U+FFFD, como no `TextDecoder` padrão.
 */
export function decodeUtf8(bytes: Uint8Array): string {
    const codes: number[] = [];
    let output = '';
    for (let index = 0; index < bytes.length;) {
        const first = bytes[index] ?? 0;
        let code = 0xfffd;
        let length = 1;
        if (first < 0x80) {
            code = first;
        } else if (first >= 0xc2 && first < 0xe0) {
            length = 2;
        } else if (first >= 0xe0 && first < 0xf0) {
            length = 3;
        } else if (first >= 0xf0 && first < 0xf5) {
            length = 4;
        }
        if (length > 1) {
            let value = first & (0xff >> (length + 1));
            let valid = index + length <= bytes.length;
            for (let offset = 1; valid && offset < length; offset++) {
                const next = bytes[index + offset] ?? 0;
                valid = (next & 0xc0) === 0x80;
                value = (value << 6) | (next & 0x3f);
            }
            const minimum = [0, 0, 0x80, 0x800, 0x10000][length] ?? 0;
            if (valid && value >= minimum && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)) {
                code = value;
            } else {
                length = 1;
            }
        }
        if (code > 0xffff) {
            code -= 0x10000;
            codes.push(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
        } else {
            codes.push(code);
        }
        if (codes.length > 8192) {
            output += String.fromCharCode(...codes);
            codes.length = 0;
        }
        index += length;
    }
    return output + String.fromCharCode(...codes);
}
