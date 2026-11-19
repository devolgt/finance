import { callOrThrow, type CoreCallError, describeError, describeSyncRefusal, invalidateAfter, useCoreClient, useCoreQuery } from '@finance/client';
import type { SyncJoinResponse } from '@finance/core';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeButton } from '../shell/ThemeButton.tsx';
import { useStartupControls } from '../startup/StartupGate.tsx';
import { AppText } from '../ui/AppText.tsx';
import { Button } from '../ui/Button.tsx';
import { TextField } from '../ui/TextField.tsx';
import { DiscardForJoinSheet } from './DiscardForJoinSheet.tsx';

/** Entrada da rota `sync.join`: o texto do QR e o nome com que o aparelho aparece no grupo. */
interface JoinInput {
    readonly invite: string;
    readonly deviceName: string;
}

/** Nome sugerido para o aparelho; o usuário troca antes de ler o QR. */
const DEFAULT_DEVICE_NAME = 'Celular';

/**
 * Entra no grupo e, ao chegar, encerra a sessão de entrada.
 * Regra de negócio (Sincronização, sincronizacao §1.3): a sincronização só roda com a
 * tela de Dispositivos aberta. A entrada termina quando a sessão fica "ao vivo" — tudo o que o
 * anfitrião tinha já chegou —, e a sessão seria mantida aberta por baixo do Início; fechá-la aqui
 * desliga o socket junto com a tela de entrar. O fechamento fica dentro da mutação, e não num
 * `onSuccess` da tela, porque a invalidação troca o primeiro uso pelo app e a tela desmonta antes.
 * Com snapshot (`restartRequired`), o banco foi trocado e o núcleo reabre.
 *
 * @return A mutação da entrada.
 */
function useJoinGroup(): UseMutationResult<SyncJoinResponse, CoreCallError, JoinInput> {
    const client = useCoreClient();
    const queryClient = useQueryClient();
    const { restart } = useStartupControls();
    return useMutation<SyncJoinResponse, CoreCallError, JoinInput>({
        mutationFn: async (input) => {
            const joined = await callOrThrow(client, 'sync.join', input);
            if (joined.joined) {
                await client.call('sync.close', {});
            }
            return joined;
        },
        onSuccess: async (joined) => {
            if (joined.restartRequired) {
                restart(null);
                return;
            }
            await invalidateAfter(queryClient, 'sync.join');
        },
    });
}

/**
 * Entrar num grupo (sincronizacao §6.4 e §7.2): lê o QR code do
 * convite pela câmera e chama `sync.join`; enquanto os dados chegam, "Recebendo dados…". Quando a
 * entrada termina, a invalidação traz os perfis do grupo e o primeiro uso dá lugar ao app.
 * Sem o código de 8 caracteres e sem "3 tentativas" (o convite por código ficou para outra
 * entrega, sincronizacao §10.2), e "Recebendo dados…" sem porcentagem — o núcleo
 * não informa o total antes de terminar. Acrescenta "Colar o convite", o texto que o desktop copia
 * em "Copiar convite", para quando a câmera foi negada.
 *
 * O aparelho com dados não entra (o núcleo recusa com `has-data`): ler o QR, ou tocar em
 * "Descartar os dados deste celular", abre antes a confirmação de descarte (`DiscardForJoinSheet`).
 *
 * @param props.onBack Volta à tela que abriu esta (primeiro uso ou Dispositivos).
 * @return A tela.
 */
export function JoinGroupScreen({ onBack }: { readonly onBack: () => void }): ReactNode {
    const insets = useSafeAreaInsets();
    const status = useCoreQuery('sync.status', {});
    const join = useJoinGroup();
    const [deviceName, setDeviceName] = useState(DEFAULT_DEVICE_NAME);
    const [pasted, setPasted] = useState('');
    const [discarding, setDiscarding] = useState(false);
    // Convite que já falhou: a câmera relê o mesmo QR várias vezes por segundo, e cada leitura
    // seria uma tentativa nova com o mesmo erro.
    const failed = useRef<string | null>(null);
    const hasData = status.data?.hasData ?? false;
    const refusal = join.data?.refusal ?? null;

    /**
     * @param invite Texto do convite, lido do QR ou colado.
     */
    const submit = (invite: string): void => {
        const text = invite.trim();
        if (join.isPending || text === '' || deviceName.trim() === '') {
            return;
        }
        if (hasData) {
            setDiscarding(true);
            return;
        }
        join.mutate(
            { invite: text, deviceName: deviceName.trim() },
            {
                onSettled: (joined) => {
                    failed.current = joined?.joined === true ? null : text;
                },
            },
        );
    };

    if (join.isPending || join.data?.joined === true) {
        return <Receiving />;
    }

    return (
        <View style={{ paddingTop: insets.top }} className="flex-1 bg-bg">
            <View className="min-h-16.5 flex-row items-center justify-between gap-2 border-b border-line bg-surface pb-2 pl-4 pr-3 pt-2.5">
                <View className="min-w-0 flex-1 flex-row items-center gap-1">
                    <Pressable accessibilityRole="button" accessibilityLabel="Voltar" onPress={onBack} className="-ml-2 h-11 w-11 items-center justify-center rounded-full active:bg-line2">
                        <AppText className="text-22">‹</AppText>
                    </Pressable>
                    <AppText className="shrink text-17 font-semibold" accessibilityRole="header" numberOfLines={1}>Entrar num grupo</AppText>
                </View>
                <ThemeButton />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 24 }} contentContainerClassName="items-center gap-3.5 px-4 pt-4.5">
                <QrScanner
                    paused={discarding}
                    onScan={(data) => {
                        if (data !== failed.current) {
                            submit(data);
                        }
                    }}
                />
                <AppText className="text-center text-13 text-muted">Aponte para o QR code em Dispositivos › Adicionar dispositivo, no outro aparelho.</AppText>
                {join.isError && (
                    <AppText accessibilityRole="alert" className="self-stretch text-13 text-danger">
                        {describeError(join.error.error).message}
                    </AppText>
                )}
                {refusal !== null && (
                    <AppText accessibilityRole="alert" className="self-stretch text-13 text-danger">
                        {describeSyncRefusal(refusal, null)}
                    </AppText>
                )}
                <View className="gap-3 self-stretch">
                    <TextField label="Nome deste aparelho" value={deviceName} maxLength={60} onChangeText={setDeviceName} hint="É como ele aparece na lista do grupo." />
                    <TextField label="Ou cole o convite" value={pasted} placeholder="FINANCAS1:…" autoCapitalize="characters" autoCorrect={false} onChangeText={setPasted} />
                    <Button
                        label="Entrar com o convite colado"
                        variant="secondary"
                        disabled={pasted.trim() === '' || deviceName.trim() === ''}
                        onPress={() => {
                            submit(pasted);
                        }}
                    />
                </View>
                <AppText className="self-stretch rounded-10 bg-warn-bg p-3 text-14 text-warn-ink">
                    {hasData
                        ? 'Este celular tem dados. Ao ler o QR, vamos pedir confirmação para descartá-los e substituí-los pelos do grupo.'
                        : 'Mantenha a tela de Dispositivos aberta no outro aparelho, na mesma rede Wi-Fi, até terminar.'}
                </AppText>
                {hasData && (
                    <Button
                        label="Descartar os dados deste celular"
                        variant="danger"
                        className="self-stretch"
                        onPress={() => {
                            setDiscarding(true);
                        }}
                    />
                )}
            </ScrollView>
            <DiscardForJoinSheet
                open={discarding}
                onClose={() => {
                    setDiscarding(false);
                }}
            />
        </View>
    );
}

/**
 * Leitura do QR code pelo `expo-camera` (mobile §10.1), com o pedido de permissão:
 * sem ela, a tela explica o porquê e oferece pedir de novo — ou, quando o sistema não pergunta
 * mais, aponta as configurações e o campo de colar o convite.
 *
 * @param props.onScan Recebe o texto de cada QR lido.
 * @param props.paused Ignora as leituras enquanto a confirmação de descarte está aberta. Com
 * dados no aparelho o leitor continua lendo: a leitura é o que abre a confirmação — pausado, o
 * visor mostrava a câmera e não reagia ao QR, sem dizer por quê.
 * @return O visor da câmera, ou o pedido de permissão.
 */
function QrScanner({ onScan, paused }: { readonly onScan: (data: string) => void; readonly paused: boolean }): ReactNode {
    const [permission, requestPermission] = useCameraPermissions();
    if (permission === null) {
        return (
            <View className="h-65 w-65 items-center justify-center rounded-18 border border-line bg-surface">
                <ActivityIndicator className="text-accent" />
            </View>
        );
    }
    if (!permission.granted) {
        return (
            <View className="min-h-65 w-65 items-center justify-center gap-3 rounded-18 border border-line bg-surface p-4">
                <AppText className="text-center text-14 text-ink2">
                    {permission.canAskAgain
                        ? 'Para ler o QR code do convite, o app precisa usar a câmera.'
                        : 'A câmera está bloqueada para o app. Libere em Configurações › Apps › Finance › Permissões, ou cole o convite abaixo.'}
                </AppText>
                {permission.canAskAgain && (
                    <Button
                        label="Permitir a câmera"
                        onPress={() => {
                            void requestPermission();
                        }}
                    />
                )}
            </View>
        );
    }
    return (
        <View accessible accessibilityLabel="Câmera lendo o QR code" className="h-65 w-65 overflow-hidden rounded-18 bg-surface">
            <CameraView
                testID="qr-camera"
                style={{ flex: 1 }}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                {...(paused ? {} : { onBarcodeScanned: (result: { readonly data: string }) => { onScan(result.data); } })}
            />
        </View>
    );
}

/**
 * "Recebendo dados…", sem porcentagem: a entrada é uma chamada só ao núcleo, que não informa o progresso, e não tem "Cancelar" pelo
 * mesmo motivo.
 *
 * @return A tela de espera.
 */
function Receiving(): ReactNode {
    return (
        <View accessibilityLiveRegion="polite" className="flex-1 items-center justify-center gap-4.5 bg-bg p-8">
            <ActivityIndicator size="large" className="text-accent" />
            <AppText className="text-center text-20 font-semibold" accessibilityRole="header">Recebendo dados…</AppText>
            <AppText className="text-center text-14 text-muted">Mantenha os dois apps abertos e na mesma rede Wi-Fi. Pode levar alguns minutos.</AppText>
        </View>
    );
}
