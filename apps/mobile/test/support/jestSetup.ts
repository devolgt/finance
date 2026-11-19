// Preparação de todo arquivo de teste do app: os módulos nativos que o Jest não tem.
import 'react-native-gesture-handler/jestSetup';
import '@shopify/flash-list/jestSetup';
import type * as React from 'react';
import type * as ReactNative from 'react-native';


// Módulos nativos da sincronização (sincronizacao §6.4). A raiz de composição os importa, e o Jest
// não tem o lado nativo: os testes de tela usam o núcleo com uma rede em memória
// (`syncTestCore`), e os adaptadores são testados pelas partes sem módulo nativo.
jest.mock('react-native-tcp-socket', () => ({ __esModule: true, default: {} }));
jest.mock('react-native-zeroconf', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0 }));

// A câmera vira uma `View` que guarda o `onBarcodeScanned`: o teste "lê" um QR disparando o evento
// `barcodeScanned` nela. A permissão começa concedida; o teste da permissão troca o retorno.
jest.mock('expo-camera', () => {
    const { createElement } = jest.requireActual<typeof React>('react');
    const { View } = jest.requireActual<typeof ReactNative>('react-native');
    return {
        CameraView: (props: Readonly<Record<string, unknown>>) => createElement(View, props),
        useCameraPermissions: jest.fn(() => [{ granted: true, canAskAgain: true, status: 'granted', expires: 'never' }, jest.fn(), jest.fn()]),
        // Os valores do enum do `expo`, que o módulo de verdade reexporta.
        PermissionStatus: { GRANTED: 'granted', UNDETERMINED: 'undetermined', DENIED: 'denied' },
    };
});
