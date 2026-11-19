import { describeError, syncMemberViews, useCoreMutation, useSyncScreen, type SyncMemberView } from '@finance/client';
import type { SyncStatusResponse } from '@finance/core';
import { useIsFocused } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { Screen } from '../shell/Screen.tsx';
import { ScreenHeader } from '../shell/ScreenHeader.tsx';
import { useAppForeground } from '../startup/AppLifecycle.tsx';
import { DiscardForJoinSheet } from '../sync/DiscardForJoinSheet.tsx';
import { JoinGroupScreen } from '../sync/JoinGroupScreen.tsx';
import { parseManualAddress } from '../sync/manualAddress.ts';
import { AppText } from '../ui/AppText.tsx';
import { Button } from '../ui/Button.tsx';
import { FormSection } from '../ui/form.tsx';
import { OptionList } from '../ui/Select.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { LoadingState } from '../ui/states.tsx';
import { TextField } from '../ui/TextField.tsx';

/** Classes do selo de estado de cada tom do `syncMemberViews`: fundo e texto dos tokens. */
const TONES: Readonly<Record<NonNullable<SyncMemberView['status']>['tone'], string>> = {
    ok: 'bg-ok-bg text-ok-ink',
    warn: 'bg-warn-bg text-warn-ink',
    muted: 'bg-track text-muted',
};

/**
 * Dispositivos e sincronização no celular (sincronizacao §6.4 e §7.1). Abrir a
 * tela liga a sincronização — escuta, anuncia e procura — e sair dela desliga (`useSyncScreen`).
 * Regra de negócio (Sincronização, mobile §10): a tela só sincroniza enquanto está
 * em foco **e** o app em primeiro plano; ir para outra aba ou para segundo plano encerra a
 * sessão, fecha o listener e para o anúncio, sem esperar o sistema cortar os sockets.
 *
 * Sem o código de 8 caracteres (sincronizacao §10.2) e sem "último sync" — cada
 * aparelho mostra o estado da sessão agora (`syncMemberViews`, o mesmo texto do desktop). Sem
 * "Adicionar dispositivo": o celular não sabe o próprio IP do Wi-Fi sem outra dependência nativa
 * (`mobileLocalAddresses`), e o convite sairia sem endereço; o grupo nasce e convida no computador.
 *
 * @return A tela.
 */
export function DevicesScreen(): ReactNode {
    const focused = useIsFocused();
    const foreground = useAppForeground();
    const status = useSyncScreen(focused && foreground);
    const [joining, setJoining] = useState(false);

    if (joining && status.data?.groupId === null) {
        return (
            <JoinGroupScreen
                onBack={() => {
                    setJoining(false);
                }}
            />
        );
    }

    /** Abre a leitura do QR no lugar da lista, para o aparelho sem dados. */
    const startJoin = (): void => {
        setJoining(true);
    };

    return (
        <Screen header={<ScreenHeader title="Dispositivos" back />}>
            {status.data === undefined ? (
                status.isError ? (
                    <AppText accessibilityRole="alert" className="text-13 text-danger">
                        {describeError(status.error.error).message}
                    </AppText>
                ) : (
                    <LoadingState />
                )
            ) : status.data.groupId === null ? (
                <OutsideGroup status={status.data} onJoin={startJoin} />
            ) : (
                <Group status={status.data} />
            )}
        </Screen>
    );
}

/**
 * Fora de um grupo: o que a sincronização faz e "Entrar num grupo". O celular não cria o grupo —
 * ele nasce no computador, que sabe o próprio endereço e mostra o QR.
 * Regra de negócio (Sincronização, sincronizacao §4.4): com dados no aparelho, "Entrar num grupo"
 * abre antes a confirmação de descarte; sem dados, vai direto à leitura do QR.
 *
 * @param props.status Estado da sincronização.
 * @param props.onJoin Abre a leitura do QR, quando o aparelho já está vazio.
 * @return O conteúdo da tela.
 */
function OutsideGroup({ status, onJoin }: { readonly status: SyncStatusResponse; readonly onJoin: () => void }): ReactNode {
    const [discarding, setDiscarding] = useState(false);
    return (
        <>
            <View className="gap-1.5 rounded-14 border border-line bg-surface px-4 py-3.5">
                <AppText className="font-medium">Dados só neste aparelho</AppText>
                <AppText className="text-13 text-muted">
                    Para sincronizar com o computador, crie o grupo nele (Dispositivos › Criar grupo), gere o convite e leia o QR code por aqui. A troca é direta entre os aparelhos, na mesma rede Wi-Fi, sem nuvem.
                </AppText>
            </View>
            {!status.available && <AppText className="rounded-10 bg-warn-bg p-3 text-14 text-warn-ink">A sincronização não está disponível nesta instalação.</AppText>}
            <Button
                large
                variant="secondary"
                label="Entrar num grupo"
                disabled={!status.available}
                onPress={() => {
                    if (status.hasData) {
                        setDiscarding(true);
                    } else {
                        onJoin();
                    }
                }}
            />
            <DiscardForJoinSheet
                open={discarding}
                onClose={() => {
                    setDiscarding(false);
                }}
            />
        </>
    );
}

/**
 * Dentro de um grupo: o estado agora, os aparelhos com o selo e o aviso de cada um, o endereço
 * digitado e sair do grupo. O aparelho removido (ou que saiu) guarda os dados e o grupo antigo, e
 * só volta a sincronizar entrando de novo com o banco vazio — por isso "Entrar num grupo" ali
 * passa direto pela confirmação de descarte.
 *
 * @param props.status Estado da sincronização.
 * @return O conteúdo da tela.
 */
function Group({ status }: { readonly status: SyncStatusResponse }): ReactNode {
    const members = syncMemberViews(status);
    const self = members.find((member) => member.isSelf);
    const others = members.filter((member) => !member.isSelf);
    const [manual, setManual] = useState(false);
    const [leaving, setLeaving] = useState(false);
    const [discarding, setDiscarding] = useState(false);
    return (
        <>
            {status.revivedRows > 0 && (
                <AppText accessibilityRole="alert" className="rounded-10 bg-warn-bg p-3 text-14 text-warn-ink">
                    {status.revivedRows === 1 ? 'Um item excluído em outro aparelho foi restaurado' : `${String(status.revivedRows)} itens excluídos em outro aparelho foram restaurados`}, porque tinham lançamentos novos. Se quiser, exclua de novo.
                </AppText>
            )}
            {self === undefined ? (
                <>
                    <AppText className="rounded-10 bg-warn-bg p-3 text-14 text-warn-ink">Este aparelho foi removido do grupo e não sincroniza mais. Os dados continuam aqui.</AppText>
                    <Button
                        large
                        variant="secondary"
                        label="Entrar num grupo"
                        onPress={() => {
                            setDiscarding(true);
                        }}
                    />
                    <DiscardForJoinSheet
                        open={discarding}
                        onClose={() => {
                            setDiscarding(false);
                        }}
                    />
                </>
            ) : (
                <SessionCard status={status} />
            )}
            <FormSection>Neste grupo</FormSection>
            <View className="overflow-hidden rounded-12 border border-line bg-surface">
                {members.map((member, index) => (
                    <MemberRow key={member.id} member={member} first={index === 0} />
                ))}
            </View>
            {self !== undefined && (
                <>
                    <Button
                        variant="ghost"
                        label="Digitar endereço manualmente"
                        disabled={others.length === 0}
                        onPress={() => {
                            setManual(true);
                        }}
                    />
                    <Button
                        variant="ghost"
                        label="Sair do grupo"
                        className="self-center"
                        onPress={() => {
                            setLeaving(true);
                        }}
                    />
                    <ManualAddressSheet
                        open={manual}
                        members={others}
                        onClose={() => {
                            setManual(false);
                        }}
                    />
                    <LeaveSheet
                        open={leaving}
                        onClose={() => {
                            setLeaving(false);
                        }}
                    />
                </>
            )}
        </>
    );
}

/**
 * Cartão do topo: com quem a sessão está ao vivo agora, ou que o aparelho está procurando os
 * outros. Diz "agora" e não "último sync", porque a sincronização só roda com esta tela aberta
 * (sincronizacao §1.3) e o estado de agora é o que o usuário precisa para saber se está em dia.
 *
 * @param props.status Estado da sincronização.
 * @return O cartão.
 */
function SessionCard({ status }: { readonly status: SyncStatusResponse }): ReactNode {
    const live = status.members.filter((member) => !member.isSelf && member.stage === 'live').map((member) => member.name);
    const busy = status.members.some((member) => !member.isSelf && (member.stage === 'handshake' || member.stage === 'syncing'));
    const title = live.length > 0 ? `Sincronizado com ${live.join(', ')} agora` : busy ? 'Sincronizando…' : status.open ? 'Procurando os aparelhos do grupo…' : 'Sincronização pausada';
    return (
        <View accessibilityLiveRegion="polite" className="gap-1 rounded-14 border border-line bg-surface px-4 py-3.5">
            <View className="flex-row items-center gap-1.5">
                {live.length > 0 && <View accessibilityElementsHidden className="h-2 w-2 rounded-full bg-dot" />}
                <AppText className="shrink">{title}</AppText>
            </View>
            <AppText className="text-12 text-muted">Sincroniza com esta tela aberta nos dois aparelhos, na mesma rede Wi-Fi.</AppText>
        </View>
    );
}

/**
 * Linha de um aparelho: nome, plataforma, selo do estado e aviso da última recusa (o texto do
 * `client`, o mesmo do desktop), com "Remover" e a confirmação.
 *
 * @param props.member Aparelho.
 * @param props.first Se é a primeira linha (sem borda em cima).
 * @return A linha.
 */
function MemberRow({ member, first }: { readonly member: SyncMemberView; readonly first: boolean }): ReactNode {
    const [confirming, setConfirming] = useState(false);
    const remove = useCoreMutation('sync.removeMember');
    return (
        <View className={`min-h-13 gap-1 px-3.5 py-2.75 ${first ? '' : 'border-t border-line2'}`}>
            <View className="flex-row items-center gap-2.5">
                <View className="min-w-0 flex-1">
                    <AppText className="text-15">{member.name}</AppText>
                    <AppText className="text-12 text-muted">{member.detail}</AppText>
                </View>
                {member.isSelf && <AppText className="rounded-full bg-soft px-2 py-0.5 text-12 text-soft-ink">este aparelho</AppText>}
                {member.status !== null && <AppText className={`rounded-full px-2 py-0.5 text-12 ${TONES[member.status.tone]}`}>{member.status.label}</AppText>}
            </View>
            {member.warning !== null && <AppText className="text-12 text-warn-ink">{member.warning}</AppText>}
            {member.removable && (
                <Button
                    variant="ghost"
                    label={`Remover ${member.name}`}
                    className="self-start px-0"
                    onPress={() => {
                        setConfirming(true);
                    }}
                />
            )}
            <Sheet
                open={confirming}
                title={`Remover ${member.name}?`}
                onClose={() => {
                    setConfirming(false);
                }}
            >
                <AppText className="text-ink2">
                    O aparelho para de sincronizar com o grupo e não volta: para entrar de novo, ele precisa de um convite novo e do banco vazio. Os dados que já estão nele continuam lá.
                </AppText>
                {remove.isError && (
                    <AppText accessibilityRole="alert" className="text-13 text-danger">
                        {describeError(remove.error.error).message}
                    </AppText>
                )}
                <Button
                    label="Remover"
                    variant="danger"
                    busy={remove.isPending}
                    onPress={() => {
                        remove.mutate(
                            { id: member.id },
                            {
                                onSuccess: () => {
                                    setConfirming(false);
                                },
                            },
                        );
                    }}
                />
                <Button
                    label="Cancelar"
                    variant="secondary"
                    onPress={() => {
                        setConfirming(false);
                    }}
                />
            </Sheet>
        </View>
    );
}

/**
 * "Digitar endereço manualmente" (sincronizacao §5.2): para a rede que bloqueia o mDNS, disca para
 * o endereço que o outro aparelho mostra no convite. Pede também qual aparelho é — o núcleo só
 * aceita a sessão com o membro esperado, cuja chave já conhece.
 *
 * @param props.open Se a folha está aberta.
 * @param props.members Os outros aparelhos do grupo.
 * @param props.onClose Fecha a folha.
 * @return A folha.
 */
function ManualAddressSheet({ open, members, onClose }: { readonly open: boolean; readonly members: readonly SyncMemberView[]; readonly onClose: () => void }): ReactNode {
    const [text, setText] = useState('');
    const [memberId, setMemberId] = useState<string | null>(members[0]?.id ?? null);
    const [invalid, setInvalid] = useState(false);
    const connect = useCoreMutation('sync.connect');

    /** Confere o formato e disca; a regra de endereços locais é do núcleo. */
    const submit = (): void => {
        const parsed = parseManualAddress(text);
        setInvalid(parsed === null);
        if (parsed === null || memberId === null) {
            return;
        }
        connect.mutate({ address: parsed.address, port: parsed.port, deviceId: memberId }, { onSuccess: onClose });
    };

    return (
        <Sheet open={open} title="Digitar endereço" onClose={onClose}>
            <AppText className="text-13 text-muted">Use o endereço que o outro aparelho mostra em Adicionar dispositivo, com a tela de Dispositivos aberta nele.</AppText>
            <AppText className="text-13 text-muted">Aparelho</AppText>
            <OptionList options={members.map((member) => ({ value: member.id, label: member.name, description: member.detail }))} value={memberId} onSelect={setMemberId} />
            <TextField
                label="Endereço e porta"
                value={text}
                placeholder="192.168.0.10:45123"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="numbers-and-punctuation"
                error={invalid ? 'Digite o endereço e a porta, como 192.168.0.10:45123.' : null}
                onChangeText={setText}
            />
            {connect.isError && (
                <AppText accessibilityRole="alert" className="text-13 text-danger">
                    {describeError(connect.error.error).message}
                </AppText>
            )}
            <Button label="Conectar" busy={connect.isPending} disabled={text.trim() === '' || memberId === null} onPress={submit} />
        </Sheet>
    );
}

/**
 * "Sair do grupo" (sincronizacao §4.5), com a confirmação do desktop.
 *
 * @param props.open Se a folha está aberta.
 * @param props.onClose Fecha a folha.
 * @return A folha.
 */
function LeaveSheet({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }): ReactNode {
    const leave = useCoreMutation('sync.leave');
    return (
        <Sheet open={open} title="Sair do grupo?" onClose={onClose}>
            <AppText className="text-ink2">
                Os dados continuam neste aparelho, mas param de sincronizar. Os outros aparelhos ficam sabendo na próxima vez que sincronizarem com este. Para voltar, será preciso entrar de novo com um convite e o banco vazio.
            </AppText>
            {leave.isError && (
                <AppText accessibilityRole="alert" className="text-13 text-danger">
                    {describeError(leave.error.error).message}
                </AppText>
            )}
            <Button label="Sair do grupo" variant="danger" busy={leave.isPending} onPress={() => { leave.mutate({}, { onSuccess: onClose }); }} />
            <Button label="Cancelar" variant="secondary" onPress={onClose} />
        </Sheet>
    );
}
