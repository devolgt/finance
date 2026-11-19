import type { SyncStatusResponse } from '@finance/core';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type { CoreCallError } from '../errors/CoreCallError.ts';
import { CORE_QUERY_ROOT, coreQueryKey } from '../queries/routes.ts';
import { useCoreClient } from './CoreClientContext.tsx';
import { callOrThrow } from './coreHooks.ts';

/** Intervalo da consulta do estado enquanto a tela está aberta. */
const STATUS_INTERVAL_MS = 1_000;

/**
 * Estado da sincronização para a tela de Dispositivos, com o ciclo de vida da sessão
 * (sincronizacao §1.3 e §5.2): montar a tela abre o coordenador (escuta, anúncio, busca)
 * e desmontar o fecha — a sincronização só roda com a tela aberta, e nenhum dado muda por
 * baixo de outra tela. O estado é consultado a cada segundo nesse intervalo, e quando um lote
 * chega (`appliedBatches` cresce) todas as consultas do núcleo são invalidadas: os lotes não
 * passam por mutação deste lado, então o mapa de invalidação não os vê.
 * Compartilhado entre desktop e celular para que as duas telas tenham o mesmo ciclo.
 *
 * @param active `false` quando a tela não está visível (app em segundo plano, no celular).
 * @return A consulta do estado.
 */
export function useSyncScreen(active = true): UseQueryResult<SyncStatusResponse, CoreCallError> {
    const client = useCoreClient();
    const queryClient = useQueryClient();
    const applied = useRef<number | null>(null);

    const status = useQuery<SyncStatusResponse, CoreCallError>({
        queryKey: coreQueryKey('sync.status', {}),
        queryFn: () => callOrThrow(client, 'sync.status', {}),
        refetchInterval: active ? STATUS_INTERVAL_MS : false,
    });

    // Reabre quando o grupo passa a existir (criado ou recém-entrado com a tela aberta): fora de
    // um grupo o coordenador não escuta nem se anuncia, então abrir antes não bastava.
    const groupId = status.data?.groupId ?? null;
    useEffect(() => {
        if (!active) {
            return undefined;
        }
        void client.call('sync.open', {});
        return () => {
            void client.call('sync.close', {});
        };
    }, [active, client, groupId]);

    const batches = status.data?.appliedBatches;
    useEffect(() => {
        if (batches === undefined) {
            return;
        }
        if (applied.current !== null && batches > applied.current) {
            void queryClient.invalidateQueries({ queryKey: [CORE_QUERY_ROOT] });
        }
        applied.current = batches;
    }, [batches, queryClient]);

    return status;
}
