import { z } from 'zod';
import { DeviceId } from '../domain/shared/ids.ts';
import { HybridLogicalClock } from '../domain/sync/HybridLogicalClock.ts';
import type { SyncBatch } from '../domain/sync/SyncBatch.ts';
import { syncedTable, type SyncedTable } from '../domain/sync/SyncCatalog.ts';
import { VersionVector } from '../domain/sync/VersionVector.ts';
import { parsedText } from './fields.ts';

const cellValueField = z.union([z.string(), z.number(), z.null()]);
const columnField = z.string().regex(/^[a-z_][a-z0-9_]*$/, 'nome de coluna');
const rowIdField = z.string().length(36);
const seqField = z.number().int().min(1);

/**
 * Tabela citada num lote recebido. Só tabelas do catálogo passam: o nome entra em SQL
 * montado, e um par com defeito (ou malicioso, embora autenticado) não pode escrever em
 * `sync_state` nem em tabela desconhecida.
 */
const tableField = z.string().transform((name, context): SyncedTable => {
    const table = syncedTable(name);
    if (table === null) {
        context.addIssue({ code: 'custom', message: `tabela fora do catálogo de sincronização: ${name}` });
        return z.NEVER;
    }
    return table;
});

const changeSchema = z.strictObject({
    hlc: parsedText((raw) => HybridLogicalClock.parse(raw)),
    origin: parsedText(DeviceId),
    seq: seqField,
    rows: z.array(z.strictObject({ table: tableField, id: rowIdField, values: z.record(columnField, cellValueField) })),
    cells: z.array(z.strictObject({ table: tableField, id: rowIdField, column: columnField, value: cellValueField })),
});

/**
 * Validação de um lote recebido (`SyncBatchDto`) e conversão para o domínio.
 * Regra de negócio (Sincronização): todas as entradas de uma transação de origem carregam o
 * mesmo HLC e a mesma sequência (sincronizacao §3.3); o relógio precisa ser do aparelho de
 * origem, senão a escrita seria atribuída a outro aparelho no desempate.
 */
export const syncBatchRequest = z
    .strictObject({
        changes: z.array(changeSchema),
        through: z.array(z.tuple([parsedText(DeviceId), z.number().int().min(0)])),
    })
    .superRefine((batch, context) => {
        for (const change of batch.changes) {
            if (change.hlc.deviceId !== change.origin) {
                context.addIssue({ code: 'custom', message: `relógio ${change.hlc.toString()} não é da origem ${change.origin}` });
            }
        }
    })
    .transform((batch): SyncBatch => ({
        changes: batch.changes.map((change) => ({
            provenance: { clock: change.hlc, origin: change.origin, seq: change.seq },
            rows: change.rows,
            cells: change.cells,
        })),
        through: VersionVector.of(batch.through),
    }));

const deviceNameField = z.string().trim().min(1).max(60);

export const syncStatusRequest = z.strictObject({});
export const createSyncGroupRequest = z.strictObject({ deviceName: deviceNameField });
export const joinSyncGroupRequest = z.strictObject({ invite: z.string().min(1).max(4096), deviceName: deviceNameField });
export const connectSyncPeerRequest = z.strictObject({
    address: z.string().min(1).max(64),
    port: z.number().int().min(1).max(65_535),
    deviceId: parsedText(DeviceId),
});
export const syncMemberIdRequest = z.strictObject({ id: parsedText(DeviceId) });
