import type { SyncInviteResponse, SyncStatusResponse } from '@finance/core';
import { describeError, inviteCountdown, syncMemberViews, useCoreMutation, useSyncScreen, type SyncMemberView } from '@finance/client';
import QRCode from 'qrcode';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { bridge } from '@/lib/bridge';
import { cn } from '@/lib/cn';

/**
 * Tela de Dispositivos do desktop (mockup `DesktopDispositivos`; sync-plan Fase 7). Abrir a
 * tela liga a sincronização e sair dela desliga (`useSyncScreen`): é a única hora em que o
 * aparelho escuta, se anuncia e troca dados (sync-design §7.1).
 * Divergência aprovada do mockup (sync-plan §7): sem o código de 8 caracteres (o convite por
 * código ficou para uma próxima entrega) e sem "último sync" — cada aparelho mostra o estado
 * da sessão agora.
 *
 * @return A tela.
 */
export function DevicesScreen(): ReactNode {
    const status = useSyncScreen();
    return (
        <div className="flex max-w-220 flex-col gap-5">
            <header className="flex flex-col gap-1">
                <h1 className="text-24 font-semibold">Dispositivos e sincronização</h1>
                <p className="text-13 text-muted">Sincroniza direto entre aparelhos, na mesma rede Wi-Fi, com esta tela aberta nos dois. Sem nuvem.</p>
            </header>
            {status.data === undefined ? (
                status.isError ? <p role="alert" className="text-13 text-danger">{describeError(status.error.error).message}</p> : <Skeleton className="h-40" />
            ) : status.data.groupId === null ? (
                <CreateGroup status={status.data} />
            ) : (
                <Group status={status.data} />
            )}
        </div>
    );
}

/**
 * Fora de um grupo: criar o grupo neste aparelho, que vira o primeiro membro.
 *
 * @param props.status Estado da sincronização.
 * @return O cartão de criar o grupo.
 */
function CreateGroup({ status }: { readonly status: SyncStatusResponse }): ReactNode {
    const [name, setName] = useState('Computador');
    const create = useCoreMutation('sync.createGroup');
    return (
        <section aria-labelledby="create-group" className="flex flex-col gap-4 rounded-12 border border-line bg-surface p-6">
            <h2 id="create-group" className="text-16 font-semibold">Sincronizar com outros aparelhos</h2>
            <p className="text-13 text-ink2">
                Crie o grupo neste computador. Depois, no celular, abra Dispositivos › Entrar num grupo e leia o QR code que aparecer aqui.
            </p>
            {!status.available && <p className="rounded-8 bg-warn-bg px-3 py-2.5 text-13 text-warn-ink">A sincronização não está disponível nesta instalação.</p>}
            <form
                className="flex items-end gap-3"
                onSubmit={(event) => {
                    event.preventDefault();
                    create.mutate({ deviceName: name });
                }}
            >
                <label className="flex flex-col gap-1.5 text-13">
                    Nome deste aparelho
                    <Input value={name} maxLength={60} onChange={(event) => { setName(event.target.value); }} className="w-64" />
                </label>
                <Button type="submit" disabled={!status.available || create.isPending || name.trim() === ''}>
                    {create.isPending ? 'Criando…' : 'Criar grupo'}
                </Button>
            </form>
            {create.isError && <p role="alert" className="text-13 text-danger">{describeError(create.error.error).message}</p>}
        </section>
    );
}

/**
 * Dentro de um grupo: os aparelhos com o estado da sessão, o convite e sair do grupo.
 *
 * @param props.status Estado da sincronização.
 * @return O conteúdo da tela.
 */
function Group({ status }: { readonly status: SyncStatusResponse }): ReactNode {
    const members = syncMemberViews(status);
    const self = members.find((member) => member.isSelf);
    return (
        <>
            {status.revivedRows > 0 && (
                <p role="status" className="rounded-8 bg-warn-bg px-3 py-2.5 text-13 text-warn-ink">
                    {status.revivedRows === 1 ? 'Um item excluído em outro aparelho foi restaurado' : `${String(status.revivedRows)} itens excluídos em outro aparelho foram restaurados`},
                    porque tinham lançamentos novos. Se quiser, exclua de novo.
                </p>
            )}
            {self === undefined ? (
                <p className="rounded-8 bg-warn-bg px-3 py-2.5 text-13 text-warn-ink">Este aparelho foi removido do grupo e não sincroniza mais. Os dados continuam aqui.</p>
            ) : null}
            <section aria-labelledby="group-members" className="rounded-12 border border-line bg-surface">
                <h2 id="group-members" className="flex items-center justify-between border-b border-line2 px-5 py-3.5 text-15 font-semibold">
                    Neste grupo
                    <span className="text-13 font-normal text-muted">{members.length === 1 ? '1 aparelho' : `${String(members.length)} aparelhos`}</span>
                </h2>
                <ul>
                    {members.map((member) => (
                        <MemberRow key={member.id} member={member} />
                    ))}
                </ul>
                {self !== undefined && <LeaveGroup />}
            </section>
            {self !== undefined && <Invite status={status} />}
        </>
    );
}

/**
 * @param props.member Aparelho.
 * @return A linha do aparelho, com o selo do estado e o botão de remover.
 */
function MemberRow({ member }: { readonly member: SyncMemberView }): ReactNode {
    const [confirming, setConfirming] = useState(false);
    const remove = useCoreMutation('sync.removeMember');
    return (
        <li className="flex flex-col gap-1.5 border-b border-line2 px-5 py-3.5 last:border-b-0">
            <div className="flex items-center gap-3">
                <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-14 font-medium">{member.name}</span>
                    <span className="text-12 text-muted">{member.detail}</span>
                </div>
                {member.status !== null && (
                    <span className={cn('rounded-full px-2.5 py-0.5 text-12', member.status.tone === 'ok' && 'bg-ok-bg text-ok-ink', member.status.tone === 'warn' && 'bg-warn-bg text-warn-ink', member.status.tone === 'muted' && 'bg-track text-muted')}>
                        {member.status.label}
                    </span>
                )}
                {member.removable && (
                    <Button variant="ghost" className="text-13 text-danger" onClick={() => { setConfirming(true); }}>
                        Remover
                    </Button>
                )}
            </div>
            {member.warning !== null && <p className="text-12 text-warn-ink">{member.warning}</p>}
            <Dialog open={confirming} onOpenChange={setConfirming}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Remover {member.name}?</DialogTitle>
                        <DialogDescription>
                            O aparelho para de sincronizar com o grupo e não volta: para entrar de novo, ele precisa de um convite novo e do banco vazio. Os dados que já estão nele continuam lá.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setConfirming(false); }}>Cancelar</Button>
                        <Button
                            variant="destructive"
                            disabled={remove.isPending}
                            onClick={() => {
                                remove.mutate({ id: member.id }, { onSuccess: () => { setConfirming(false); } });
                            }}
                        >
                            Remover
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </li>
    );
}

/**
 * "Sair do grupo" (sync-design §6.5).
 *
 * @return O rodapé do cartão do grupo.
 */
function LeaveGroup(): ReactNode {
    const [confirming, setConfirming] = useState(false);
    const leave = useCoreMutation('sync.leave');
    return (
        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3.5">
            <p className="text-12 text-muted">Os dados continuam neste aparelho, mas param de sincronizar.</p>
            <Button variant="outline" className="border-line text-13 font-normal text-danger" onClick={() => { setConfirming(true); }}>
                Sair do grupo
            </Button>
            <Dialog open={confirming} onOpenChange={setConfirming}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Sair do grupo?</DialogTitle>
                        <DialogDescription>
                            Os outros aparelhos ficam sabendo na próxima vez que sincronizarem com este. Para voltar, será preciso entrar de novo com um convite e o banco vazio.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setConfirming(false); }}>Cancelar</Button>
                        <Button variant="destructive" disabled={leave.isPending} onClick={() => { leave.mutate({}, { onSuccess: () => { setConfirming(false); } }); }}>
                            Sair do grupo
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

/**
 * Convite de uso único com QR code, válido por 5 minutos (sync-design §6.3).
 *
 * @param props.status Estado, que traz o convite em aberto.
 * @return O cartão de adicionar dispositivo.
 */
function Invite({ status }: { readonly status: SyncStatusResponse }): ReactNode {
    const create = useCoreMutation('sync.createInvite');
    const cancel = useCoreMutation('sync.cancelInvite');
    const invite = status.invite;
    return (
        <section aria-labelledby="invite-title" className="flex flex-col gap-4 rounded-12 border border-line bg-surface p-6">
            <h2 id="invite-title" className="text-16 font-semibold">Adicionar dispositivo</h2>
            {invite === null ? (
                <>
                    <p className="text-13 text-ink2">No celular: Mais › Dispositivos › Entrar num grupo. O celular precisa estar sem dados.</p>
                    <div>
                        <Button disabled={create.isPending} onClick={() => { create.mutate({}); }}>
                            {create.isPending ? 'Gerando…' : 'Gerar convite'}
                        </Button>
                    </div>
                    {create.isError && <p role="alert" className="text-13 text-danger">{describeError(create.error.error).message}</p>}
                </>
            ) : (
                <InviteCode invite={invite} onCancel={() => { cancel.mutate({}); }} onRenew={() => { create.mutate({}); }} />
            )}
        </section>
    );
}

/**
 * @param props.invite Convite em aberto.
 * @param props.onCancel Cancela o convite.
 * @param props.onRenew Gera outro convite.
 * @return O QR, a validade e o endereço para digitar.
 */
function InviteCode({ invite, onCancel, onRenew }: { readonly invite: SyncInviteResponse; readonly onCancel: () => void; readonly onRenew: () => void }): ReactNode {
    const now = useNow();
    const expired = invite.expiresAt <= now;
    return (
        <div className="flex gap-6">
            <QrCode text={invite.text} />
            <div className="flex flex-col gap-3 text-13">
                <p className="text-ink2">Leia este QR code com o celular, em Dispositivos › Entrar num grupo.</p>
                <p className={cn('text-ink', expired && 'text-danger')}>
                    {expired ? 'O convite expirou.' : <>Expira em <span className="font-medium">{inviteCountdown(invite.expiresAt, now)}</span> · vale para um aparelho</>}
                </p>
                <div className="flex gap-2">
                    <Button variant="outline" className="border-line text-13 font-normal" onClick={onRenew}>Gerar novo convite</Button>
                    <Button
                        variant="outline"
                        className="border-line text-13 font-normal"
                        onClick={() => {
                            void bridge.clipboard.writeText(invite.text).then(
                                () => toast.success('Convite copiado.'),
                                () => toast.error('Não foi possível copiar o convite.'),
                            );
                        }}
                    >
                        Copiar convite
                    </Button>
                    <Button variant="ghost" className="text-13" onClick={onCancel}>Cancelar</Button>
                </div>
                <p className="text-12 text-muted">
                    Se a rede bloquear a descoberta, digite no outro aparelho o endereço{' '}
                    <span className="font-medium text-ink">{invite.addresses.map((address) => `${address}:${String(invite.port)}`).join(' ou ')}</span>
                </p>
            </div>
        </div>
    );
}

/** Margem clara em volta do QR, em módulos: os 4 que a norma pede, para leitores mais exigentes. */
const QUIET_ZONE = 4;

/**
 * QR code desenhado a partir da matriz do `qrcode`, com os tokens `qr-ink`/`qr-bg`: escuro
 * sobre claro nos dois temas, porque nem todo leitor lê o código invertido.
 *
 * @param props.text Texto do convite.
 * @return O QR em SVG.
 */
function QrCode({ text }: { readonly text: string }): ReactNode {
    const path = useMemo(() => {
        const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
        const cells: string[] = [];
        for (let row = 0; row < modules.size; row++) {
            for (let column = 0; column < modules.size; column++) {
                if (modules.get(row, column)) {
                    cells.push(`M${String(column + QUIET_ZONE)} ${String(row + QUIET_ZONE)}h1v1h-1z`);
                }
            }
        }
        return { d: cells.join(''), size: modules.size + QUIET_ZONE * 2 };
    }, [text]);
    return (
        <svg role="img" aria-label="QR code do convite" viewBox={`0 0 ${String(path.size)} ${String(path.size)}`} className="size-64 shrink-0 rounded-8 bg-qr-bg" shapeRendering="crispEdges">
            <path d={path.d} className="fill-qr-ink" />
        </svg>
    );
}

/**
 * @return O instante atual, atualizado a cada segundo — para a contagem do convite.
 */
function useNow(): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => {
            setNow(Date.now());
        }, 1_000);
        return () => {
            clearInterval(timer);
        };
    }, []);
    return now;
}
