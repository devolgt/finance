import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { safeStorage } from 'electron';

/**
 * A chave privada do aparelho no desktop (sincronizacao §4.1 e desktop §14): um arquivo em
 * `userData` cifrado pelo `safeStorage`, que é o chaveiro do sistema operacional exposto pelo
 * Electron. Fica fora do banco para que uma cópia ou backup do `.sqlite` não carregue a
 * capacidade de se passar pelo aparelho.
 */
export class DeviceKeyFile {
    /**
     * @param path Arquivo da chave cifrada.
     */
    public constructor(private readonly path: string) {}

    /**
     * @return A chave em hexadecimal, ou `null` quando ainda não existe.
     * @throws {Error} Quando o arquivo existe mas não decifra (chaveiro trocado).
     */
    public load(): string | null {
        if (!existsSync(this.path)) {
            return null;
        }
        ensureEncryption();
        return safeStorage.decryptString(readFileSync(this.path));
    }

    /**
     * Grava num temporário e renomeia, para que uma queda no meio não deixe uma chave truncada —
     * o aparelho perderia a identidade no grupo.
     *
     * @param keyHex Chave em hexadecimal.
     */
    public save(keyHex: string): void {
        ensureEncryption();
        mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
        const staged = `${this.path}.tmp`;
        writeFileSync(staged, safeStorage.encryptString(keyHex), { mode: 0o600 });
        renameSync(staged, this.path);
    }
}

/**
 * Num Linux sem chaveiro do sistema (sem Secret Service, como em containers e em alguns
 * desktops mínimos), o `safeStorage` cai no backend `basic_text` e recusa cifrar. Sem a chave,
 * o aparelho não sincroniza nunca; com o modo de texto simples do próprio Electron — a mesma
 * proteção que o Chromium usa nos cookies nesse caso —, a chave fica no arquivo restrito ao
 * usuário (0600). Aceito: a defesa principal contra copiar o aparelho é a chave não estar no
 * banco nem nos backups, e isso continua valendo.
 */
function ensureEncryption(): void {
    if (!safeStorage.isEncryptionAvailable() && process.platform === 'linux') {
        safeStorage.setUsePlainTextEncryption(true);
    }
}
