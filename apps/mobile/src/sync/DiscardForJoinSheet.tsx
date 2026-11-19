import { useCoreClient } from '@finance/client';
import { useState, type ReactNode } from 'react';
import type { DatabaseSetAsideResult } from '../startup/discardDatabase.ts';
import { useStartupControls } from '../startup/StartupGate.tsx';
import { AppText } from '../ui/AppText.tsx';
import { Button } from '../ui/Button.tsx';
import { Sheet } from '../ui/Sheet.tsx';

/**
 * Aviso antes de descartar (mockup `MobileParear`, caixa de aviso).
 * Regra de negócio (Sincronização, sync-design §6.4): quem entra num grupo troca os próprios
 * dados pelos do grupo; o aparelho com dados precisa descartá-los antes, e a tela pede
 * confirmação com todas as letras.
 */
const DISCARD_WARNING =
    'Os dados deste celular serão descartados e substituídos pelos do grupo. O banco atual fica guardado em backups, e o app reabre vazio, pronto para ler o QR code do outro aparelho.';

/**
 * @param result Resultado de tirar o banco do lugar.
 * @return A frase que o app reaberto mostra por cima do primeiro uso.
 */
export function setAsideMessage(result: DatabaseSetAsideResult): string {
    if (result.ok) {
        return `Os dados anteriores foram guardados em backups/${result.previousCopy}. Agora toque em "Entrar num grupo existente" e leia o QR code no outro aparelho.`;
    }
    if (result.reason === 'database-moved') {
        return `A troca parou no meio. O banco anterior está em backups/${result.failedCopy}.`;
    }
    return 'Não foi possível guardar o banco deste celular, e nada foi descartado. Confira se há espaço no aparelho e tente de novo.';
}

/**
 * Confirmação de "Entrar num grupo" num aparelho que já tem dados (sync-plan Fase 8). O núcleo não
 * tem rota para zerar o banco e recusa a entrada com dados, então o descarte é do app: encerra a
 * sincronização — o listener e as sessões usam o banco que vai sair —, tira o banco do lugar pela
 * raiz de composição (`setAsideForJoin`) e reabre o núcleo pelo `StartupGate`, que encontra um
 * banco novo e mostra o primeiro uso, onde fica "Entrar num grupo existente".
 *
 * @param props.open Se a folha está aberta.
 * @param props.onClose Fecha sem descartar nada.
 * @return A folha de confirmação.
 */
export function DiscardForJoinSheet({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }): ReactNode {
    const client = useCoreClient();
    const { copies, restart } = useStartupControls();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /** Encerra a sincronização, guarda o banco e reabre o app vazio. */
    const discard = (): void => {
        if (copies === null) {
            setError('O banco não está aberto agora. Feche e abra o app para tentar de novo.');
            return;
        }
        setBusy(true);
        setError(null);
        void client.call('sync.close', {}).then(() => {
            restart(setAsideMessage(copies.setAsideForJoin()));
        });
    };

    return (
        <Sheet open={open} title="Entrar num grupo?" onClose={busy ? () => undefined : onClose}>
            <AppText className="rounded-10 bg-warn-bg p-3 text-14 text-warn-ink">{DISCARD_WARNING}</AppText>
            {error !== null && (
                <AppText accessibilityRole="alert" className="text-13 text-danger">
                    {error}
                </AppText>
            )}
            <Button label="Descartar e continuar" variant="danger" busy={busy} onPress={discard} />
            <Button label="Cancelar" variant="secondary" disabled={busy} onPress={onClose} />
        </Sheet>
    );
}
