import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Regra que impede o R8 de apagar os construtores dos registradores do ML Kit, criados por
 * reflexão. Sem ela, o build de release não lê nenhum QR: o leitor falha ao iniciar, o
 * `expo-camera` só registra no log e a câmera mostra a imagem sem reagir (sync-plan §3.3) —
 * e o build de depuração, sem R8, funciona, então só se percebe no aparelho.
 */
const REGISTRAR_KEEP_RULE = '-keep class * implements com.google.firebase.components.ComponentRegistrar { void <init>(); }';

/**
 * Pasta Android do `expo-camera` instalado, para ler o que ele de fato entrega ao build.
 *
 * @return O caminho de `node_modules/expo-camera/android`.
 */
function expoCameraAndroidDir(): string {
    return join(dirname(require.resolve('expo-camera/package.json')), 'android');
}

describe('expo-camera no build de release', () => {
    it('entrega ao R8 a regra que mantém os registradores do ML Kit', () => {
        const android = expoCameraAndroidDir();
        expect(readFileSync(join(android, 'build.gradle'), 'utf8')).toContain('consumerProguardFiles "proguard-rules.pro"');
        expect(readFileSync(join(android, 'proguard-rules.pro'), 'utf8')).toContain(REGISTRAR_KEEP_RULE);
    });
});
