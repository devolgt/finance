/**
 * Permissões Android da sincronização (mobile §10.1; sincronizacao §6.4), declaradas
 * pelo `app.config.ts` (`withSyncPermissions`) e não à mão no `android/`, que é gerado pelo
 * `prebuild` e não é versionado.
 *
 * - `INTERNET`: o socket TCP da sessão, mesmo só na rede local.
 * - `ACCESS_NETWORK_STATE` e `ACCESS_WIFI_STATE`: o `NsdManager` e o `react-native-tcp-socket`
 *   consultam a rede ativa antes de anunciar, procurar e discar.
 * - `CHANGE_WIFI_MULTICAST_STATE`: o *multicast lock*. A descoberta usa a implementação `NSD`, em
 *   que o mDNS roda no serviço do sistema e o app não precisa do lock; a permissão fica para a
 *   implementação `DNSSD` da mesma biblioteca, que adquire o lock sozinha, e porque o manifesto da
 *   biblioteca já a traz — declarada aqui, não some se a biblioteca mudar.
 * - `ACCESS_LOCAL_NETWORK`: a permissão de rede local do Android 17, cobrada dos apps que miram a
 *   API 37. O projeto mira a 36 (o `targetSdk` do React Native 0.88), em que ela ainda não é
 *   exigida; fica declarada, e o adaptador a confere em tempo de execução
 *   (`localNetworkAccess`), para que subir o `targetSdk` não quebre a sincronização em silêncio.
 *   Abaixo da API 37 o sistema ignora a declaração.
 *
 * `NEARBY_WIFI_DEVICES` fica de fora: é para Wi-Fi Direct e varredura de redes, não para mDNS nem
 * TCP na rede em que o aparelho já está.
 */
export const SYNC_ANDROID_PERMISSIONS = [
    'android.permission.INTERNET',
    'android.permission.ACCESS_NETWORK_STATE',
    'android.permission.ACCESS_WIFI_STATE',
    'android.permission.CHANGE_WIFI_MULTICAST_STATE',
    'android.permission.ACCESS_LOCAL_NETWORK',
] as const;

/**
 * Configuração do plugin do `expo-camera`: só a leitura do QR do convite. O microfone fica
 * desligado (`recordAudioAndroid: false`) — o app não grava vídeo, e o `RECORD_AUDIO` continua na
 * lista de bloqueadas do `app.config.ts`.
 */
export const CAMERA_PLUGIN_OPTIONS = {
    cameraPermission: 'O Finanças usa a câmera para ler o QR code do convite de sincronização.',
    microphonePermission: false,
    recordAudioAndroid: false,
    barcodeScannerEnabled: true,
} as const;
