import { DeviceId } from '../../domain/shared/ids.ts';
import { SYNC_PLATFORMS, type SyncMember, type SyncPlatform } from '../../domain/sync/SyncMember.ts';
import { parseTimestamp, type Clock } from '../../ports/Clock.ts';
import type { Database, SqlRow } from '../../ports/Database.ts';
import type { SyncMemberRepository } from '../../repositories/SyncMemberRepository.ts';
import { CorruptRowError } from '../../domain/shared/errors.ts';
import { RowReader } from './RowReader.ts';

/** Implementação SQLite de `sync_members`. */
export class SqliteSyncMemberRepository implements SyncMemberRepository {
    /**
     * @param database Conexão do núcleo; as escritas passam pela captura e se propagam.
     * @param clock Relógio que carimba `updated_at` e `removed_at`.
     */
    public constructor(private readonly database: Database, private readonly clock: Clock) {}

    /**
     * @return Todos os membros, em ordem de id.
     */
    public listAll(): readonly SyncMember[] {
        return this.database.all('SELECT * FROM sync_members ORDER BY id').map((row) => this.toMember(row));
    }

    /**
     * @param id Aparelho.
     * @return O membro, ou `null`.
     */
    public findById(id: DeviceId): SyncMember | null {
        const row = this.database.get('SELECT * FROM sync_members WHERE id = :id', { id });
        return row === undefined ? null : this.toMember(row);
    }

    /**
     * @param member Membro novo.
     */
    public insert(member: SyncMember): void {
        this.database.run(
            `INSERT INTO sync_members (id, name, platform, public_key, added_by, updated_at)
            VALUES (:id, :name, :platform, :publicKey, :addedBy, :now)`,
            {
                id: member.id,
                name: member.name,
                platform: SYNC_PLATFORMS.indexOf(member.platform) + 1,
                publicKey: member.publicKey,
                addedBy: member.addedBy,
                now: this.clock.now(),
            },
        );
    }

    /**
     * @param id Membro a remover.
     */
    public markRemoved(id: DeviceId): void {
        this.database.run(
            'UPDATE sync_members SET removed_at = :now, updated_at = :now WHERE id = :id AND removed_at IS NULL',
            { id, now: this.clock.now() },
        );
    }

    /**
     * @param row Linha de `sync_members`.
     * @return O membro.
     * @throws {CorruptRowError} Quando o código da plataforma não é conhecido.
     */
    private toMember(row: SqlRow): SyncMember {
        const reader = new RowReader('sync_members', row);
        const platform: SyncPlatform | undefined = SYNC_PLATFORMS[reader.number('platform') - 1];
        if (platform === undefined) {
            throw new CorruptRowError('sync_members', `plataforma desconhecida: ${reader.number('platform')}`);
        }
        const addedBy = reader.nullableText('added_by');
        const removedAt = reader.nullableText('removed_at');
        return {
            id: DeviceId(reader.text('id')),
            name: reader.text('name'),
            platform,
            publicKey: reader.text('public_key'),
            addedBy: addedBy === null ? null : DeviceId(addedBy),
            removedAt: removedAt === null ? null : parseTimestamp(removedAt),
        };
    }
}
