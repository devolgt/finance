import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AndroidConfig, withAndroidManifest, withAppBuildGradle, withDangerousMod, type ConfigPlugin } from 'expo/config-plugins';
import type { ExpoConfig } from 'expo/config';
import corePackageJson from '../../packages/core/package.json';
import { addReleaseSigning, versionCodeOf } from './config/releaseSigning.ts';
import { CAMERA_PLUGIN_OPTIONS, SYNC_ANDROID_PERMISSIONS } from './config/syncPermissions.ts';
import packageJson from './package.json';

/** Pacote Android escolhido pelo usuário (mobile §2). Nunca mudar: é a identidade do app instalado. */
const ANDROID_PACKAGE = 'br.com.finance.app';

/** Pasta dos ícones do pacote compartilhado `@finance/assets`, o mesmo de onde o desktop tira o dele. */
const ICONS = './node_modules/@finance/assets/icons';

/**
 * Cor de fundo do ícone adaptativo: a do próprio desenho, e não um token de tema, porque precisa
 * emendar sem costura com o fundo do primeiro plano, que a máscara do launcher recorta.
 */
const ICON_BACKGROUND = '#111919';

/** Pasta das fontes do IBM Plex Sans no pacote do Google Fonts para o Expo. */
const PLEX = './node_modules/@expo-google-fonts/ibm-plex-sans';

/**
 * Regras de extração de dados do Android 12+, que excluem tudo do backup em nuvem e da
 * transferência entre aparelhos. O `allowBackup="false"` sozinho não basta: a partir do
 * Android 12 ele desliga o backup em nuvem, mas a cópia de aparelho para aparelho continua
 * levando o diretório do app — e o banco junto (mobile §7.1).
 */
const DATA_EXTRACTION_RULES = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!-- Gerado pelo app.config.ts (withNoDataExtraction): o histórico financeiro não sai do aparelho. -->',
    '<data-extraction-rules>',
    '    <cloud-backup>',
    ...['root', 'file', 'database', 'sharedpref', 'external'].map((domain) => `        <exclude domain="${domain}" path="." />`),
    '    </cloud-backup>',
    '    <device-transfer>',
    ...['root', 'file', 'database', 'sharedpref', 'external'].map((domain) => `        <exclude domain="${domain}" path="." />`),
    '    </device-transfer>',
    '</data-extraction-rules>',
    '',
].join('\n');

/**
 * Tira o banco, os anexos e `backups/` de todo backup do sistema (mobile §7.1): o
 * backup automático mandaria o histórico financeiro a um terceiro, o que a regra de produto da
 * sincronização só na rede local recusa — e em silêncio, configurado pelo sistema e não pelo
 * usuário. Grava as regras de extração e as liga no `AndroidManifest`, junto com o
 * `allowBackup` e o `fullBackupContent` desligados para o Android 11 e anteriores.
 *
 * @param config Configuração do Expo recebida da cadeia de plugins.
 * @return A configuração com o manifesto e o recurso XML ajustados no `prebuild`.
 */
const withNoDataExtraction: ConfigPlugin = (config) => {
    const withRules = withDangerousMod(config, ['android', (modConfig) => {
        const folder = join(modConfig.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, 'data_extraction_rules.xml'), DATA_EXTRACTION_RULES);
        return modConfig;
    }]);
    return withAndroidManifest(withRules, (modConfig) => {
        const application = AndroidConfig.Manifest.getMainApplicationOrThrow(modConfig.modResults);
        application.$['android:allowBackup'] = 'false';
        application.$['android:fullBackupContent'] = 'false';
        application.$['android:dataExtractionRules'] = '@xml/data_extraction_rules';
        return modConfig;
    });
};

/**
 * Assina o APK de release com a chave do usuário, fora do repositório (mobile §11). A
 * regra da troca e o motivo de cair na chave de depuração sem ela estão no `addReleaseSigning`.
 *
 * @param config Configuração do Expo recebida da cadeia de plugins.
 * @return A configuração com o `app/build.gradle` ajustado no `prebuild`.
 * @throws Error Quando o `build.gradle` gerado não tem a assinatura de release esperada.
 */
const withReleaseSigning: ConfigPlugin = (config) => withAppBuildGradle(config, (modConfig) => {
    modConfig.modResults.contents = addReleaseSigning(modConfig.modResults.contents);
    return modConfig;
});

/**
 * Permissões da sincronização na rede local (sincronizacao §6.4): o porquê de cada uma está em
 * `SYNC_ANDROID_PERMISSIONS`. Plugin, e não a lista `android.permissions`, para que a regra fique
 * num lugar só e testável, junto do motivo de cada permissão.
 *
 * @param config Configuração do Expo recebida da cadeia de plugins.
 * @return A configuração com o `AndroidManifest` ajustado no `prebuild`.
 */
const withSyncPermissions: ConfigPlugin = (config) => withAndroidManifest(config, (modConfig) => {
    AndroidConfig.Permissions.ensurePermissions(modConfig.modResults, [...SYNC_ANDROID_PERMISSIONS]);
    return modConfig;
});

/**
 * Configuração do app (mobile §2): Expo SDK 58 — em que a Nova Arquitetura, o
 * Hermes e o edge-to-edge são o único modo, sem chave na configuração —, development build e
 * `android/` gerado pelo `prebuild`, nunca versionado. As permissões que
 * o template do Expo traz por padrão e que o app não usa ficam bloqueadas: o app não lê
 * arquivos externos, não abre janela por cima de outros apps nem vibra.
 */
const config: ExpoConfig = {
    name: 'Finance',
    slug: 'finance',
    scheme: 'finance',
    version: packageJson.version,
    // A versão do núcleo embarcado, para Ajustes mostrar junto da do app (mobile §7.2).
    extra: { coreVersion: corePackageJson.version },
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    icon: `${ICONS}/finance-icon-1024.png`,
    android: {
        package: ANDROID_PACKAGE,
        // Android 8+ recorta o ícone com a máscara do launcher (círculo, gota, quadrado): o
        // primeiro plano traz o desenho reduzido à zona segura, e o fundo liso cobre o que a
        // máscara revelar; com o ícone quadrado direto, o launcher o encolheria numa moldura branca.
        adaptiveIcon: {
            foregroundImage: `${ICONS}/finance-icon-adaptive-foreground.png`,
            backgroundColor: ICON_BACKGROUND,
        },
        // Sobe com a versão do app, para o Android recusar instalar um APK antigo por cima (mobile §11).
        versionCode: versionCodeOf(packageJson.version),
        allowBackup: false,
        permissions: [],
        blockedPermissions: [
            'android.permission.READ_EXTERNAL_STORAGE',
            'android.permission.WRITE_EXTERNAL_STORAGE',
            'android.permission.SYSTEM_ALERT_WINDOW',
            'android.permission.VIBRATE',
            'android.permission.RECORD_AUDIO',
        ],
    },
    plugins: [
        'expo-router',
        'expo-sqlite',
        // Folha de compartilhamento da cópia do banco e do log (mobile §7.2).
        'expo-sharing',
        // Leitura do QR do convite de sincronização (sincronizacao §6.4), sem microfone.
        ['expo-camera', CAMERA_PLUGIN_OPTIONS],
        [
            'expo-font',
            {
                android: {
                    fonts: [
                        {
                            fontFamily: 'IBM Plex Sans',
                            fontDefinitions: [
                                { path: `${PLEX}/400Regular/IBMPlexSans_400Regular.ttf`, weight: 400 },
                                { path: `${PLEX}/500Medium/IBMPlexSans_500Medium.ttf`, weight: 500 },
                                { path: `${PLEX}/600SemiBold/IBMPlexSans_600SemiBold.ttf`, weight: 600 },
                            ],
                        },
                    ],
                },
            },
        ],
    ],
};

export default withReleaseSigning(withSyncPermissions(withNoDataExtraction(config)));
