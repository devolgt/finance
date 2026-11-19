-- =============================================================================
-- 0009_sync_tables.sql
--
-- Tabelas da sincronização (sync-design §5.3, §6.2 e §9; sync-plan Fase 1).
--
-- Regra de negócio (Sincronização): cada célula é resolvida por last-writer-wins
-- contra o seu relógio efetivo — a entrada em `sync_cells`, se existir; senão a
-- da linha em `sync_rows` (sync-design §5.1 e §5.3). Não existe log de
-- mudanças: só o vencedor atual de cada célula importa, e o valor dele já está
-- na tabela de domínio. As tabelas de domínio não mudam.
--
-- Escopo de cada tabela:
--   * sync_rows, sync_cells e sync_members são sincronizadas: trafegam entre os
--     aparelhos e vêm no snapshot de quem entra no grupo.
--   * sync_vector e sync_state são locais: descrevem este aparelho e são
--     reiniciadas com a identidade própria depois de um snapshot (§6.4).
--
-- Os relógios são o HLC de largura fixa (`{ms 13}.{contador 5}.{device_id}`),
-- comparáveis como texto; por isso não há CHECK de formato além do tamanho: o
-- núcleo os valida ao ler (`HybridLogicalClock.parse`).
--
-- O índice em (origin, seq) responde "o que falta a um vetor" — toda entrada
-- cuja sequência de origem é maior que a que o par possui daquela origem —
-- sem varrer as tabelas.
-- =============================================================================

-- Uma entrada por linha sincronizada: o relógio, a origem e a sequência de
-- origem da sua criação. A chave é (tabela, id) porque os ids são únicos só
-- dentro da tabela.
CREATE TABLE sync_rows (
    table_name TEXT NOT NULL,
    row_id TEXT NOT NULL,
    hlc TEXT NOT NULL,
    origin TEXT NOT NULL,
    seq INTEGER NOT NULL,

    CONSTRAINT pk_sync_rows PRIMARY KEY (table_name, row_id),

    CONSTRAINT ck_sync_rows_row_id CHECK (length(row_id) = 36),
    CONSTRAINT ck_sync_rows_hlc CHECK (length(hlc) = 56),
    CONSTRAINT ck_sync_rows_origin CHECK (length(origin) = 36),
    CONSTRAINT ck_sync_rows_seq CHECK (seq >= 1)
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_sync_rows_origin_seq ON sync_rows (origin, seq);

-- Uma entrada por célula alterada depois da criação da linha. Uma célula sem
-- entrada aqui tem o relógio da linha.
CREATE TABLE sync_cells (
    table_name TEXT NOT NULL,
    row_id TEXT NOT NULL,
    column_name TEXT NOT NULL,
    hlc TEXT NOT NULL,
    origin TEXT NOT NULL,
    seq INTEGER NOT NULL,

    CONSTRAINT pk_sync_cells PRIMARY KEY (table_name, row_id, column_name),

    CONSTRAINT ck_sync_cells_row_id CHECK (length(row_id) = 36),
    CONSTRAINT ck_sync_cells_hlc CHECK (length(hlc) = 56),
    CONSTRAINT ck_sync_cells_origin CHECK (length(origin) = 36),
    CONSTRAINT ck_sync_cells_seq CHECK (seq >= 1)
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_sync_cells_origin_seq ON sync_cells (origin, seq);

-- Os aparelhos do grupo (sync-design §6.2). Replicada como dados de domínio,
-- então todo membro converge para a mesma lista. `removed_at` é a lápide: a
-- remoção é permanente para aquele id (§6.5), e por isso não há `deleted_at`
-- que pudesse ser desfeito por uma escrita mais nova.
--
-- O id é o do aparelho (UUID v4 gerado no primeiro uso), e a chave pública é a
-- X25519 do Noise em hexadecimal; a privada nunca entra no banco (§6.1).
CREATE TABLE sync_members (
    id TEXT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    platform INTEGER NOT NULL,
    public_key TEXT NOT NULL,
    added_by TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    updated_at TEXT NOT NULL,
    removed_at TEXT,

    CONSTRAINT ck_sync_members_id CHECK (length(id) = 36),
    CONSTRAINT ck_sync_members_name CHECK (length(name) BETWEEN 1 AND 60),
    -- 1 = desktop, 2 = Android, 3 = iOS.
    CONSTRAINT ck_sync_members_platform CHECK (platform IN (1, 2, 3)),
    CONSTRAINT ck_sync_members_public_key CHECK (length(public_key) = 64),
    CONSTRAINT ck_sync_members_added_by CHECK (added_by IS NULL OR length(added_by) = 36),
    CONSTRAINT ck_sync_members_created_at CHECK (created_at IS strftime('%Y-%m-%d %H:%M:%S', created_at)),
    CONSTRAINT ck_sync_members_updated_at CHECK (updated_at IS strftime('%Y-%m-%d %H:%M:%S', updated_at)),
    CONSTRAINT ck_sync_members_removed_at CHECK (removed_at IS strftime('%Y-%m-%d %H:%M:%S', removed_at))
) STRICT;

-- Local: por aparelho de origem, a maior sequência de origem que este aparelho
-- possui. É prefixo-completo — ter a sequência N significa ter todas até N —
-- porque cada lote é aplicado inteiro numa transação.
CREATE TABLE sync_vector (
    origin TEXT NOT NULL PRIMARY KEY,
    seq INTEGER NOT NULL,

    CONSTRAINT ck_sync_vector_origin CHECK (length(origin) = 36),
    CONSTRAINT ck_sync_vector_seq CHECK (seq >= 0)
) STRICT, WITHOUT ROWID;

-- Local: a identidade deste aparelho dentro do grupo. Uma linha só, que existe
-- enquanto o aparelho pertence a um grupo; sem ela a sincronização está
-- desativada e a captura não carimba nada.
CREATE TABLE sync_state (
    singleton INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
    device_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    hlc TEXT NOT NULL,
    next_seq INTEGER NOT NULL,

    CONSTRAINT ck_sync_state_singleton CHECK (singleton = 1),
    CONSTRAINT ck_sync_state_device_id CHECK (length(device_id) = 36),
    CONSTRAINT ck_sync_state_group_id CHECK (length(group_id) = 36),
    CONSTRAINT ck_sync_state_hlc CHECK (length(hlc) = 56),
    CONSTRAINT ck_sync_state_next_seq CHECK (next_seq >= 1)
) STRICT;
