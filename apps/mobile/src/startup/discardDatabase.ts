import { joinUri, type AppFileSystem } from '../platform/AppFileSystem.ts';
import type { DatabaseFiles } from './databaseFiles.ts';

/** O banco e os arquivos que o SQLite mantém ao lado dele no modo WAL. */
const DATABASE_SUFFIXES = ['', '-wal', '-shm'] as const;

/** Resultado de tirar o banco do lugar para entrar num grupo. */
export type DatabaseSetAsideResult =
    | { readonly ok: true; readonly previousCopy: string }
    | { readonly ok: false; readonly reason: 'io-error' }
    | { readonly ok: false; readonly reason: 'database-moved'; readonly failedCopy: string };

/**
 * Tira o banco do lugar para o aparelho entrar num grupo com o banco vazio.
 * Regra de negócio (Sincronização, sync-design §6.4): quem entra num grupo descarta os próprios
 * dados e recebe os do grupo — juntar dois históricos que nunca se conheceram duplicaria tudo o
 * que têm em comum. O núcleo recusa a entrada com dados (`has-data`) e não tem rota para zerar o
 * banco, então o celular faz isso pelo disco, com o banco fechado: a próxima abertura cria um
 * banco novo, migrado, e a tela de primeiro uso oferece "Entrar num grupo".
 *
 * "Descartar" não apaga: o banco vai, com o `-wal` e o `-shm`, para
 * `backups/antes-de-entrar-no-grupo-{instante}.sqlite`, fora da rotação automática, para o usuário
 * voltar a ele pela importação de cópia se entrou no grupo errado. A troca é protegida pela mesma
 * marca da restauração (`restore-pending.json`): se o app morrer no meio, a próxima abertura
 * bloqueia apontando onde o banco ficou, em vez de abrir um banco vazio ao lado de um `-wal`
 * órfão. Se a troca falhar, o que andou volta; se nem isso der, a marca fica.
 *
 * @param files Disco do aparelho.
 * @param paths Onde ficam o banco, os backups e as marcas.
 * @param instant Instante `YYYYMMDD-HHMMSS` do nome da cópia guardada.
 * @return Onde o banco ficou; `io-error` quando o disco recusou e tudo foi desfeito;
 * `database-moved` quando nem o desfazer funcionou. O banco precisa estar fechado antes.
 */
export function setAsideDatabase(files: AppFileSystem, paths: DatabaseFiles, instant: string): DatabaseSetAsideResult {
    const previousName = `antes-de-entrar-no-grupo-${instant}.sqlite`;
    const previous = joinUri(paths.backupsUri, previousName);
    try {
        files.ensureFolder(paths.backupsUri);
        files.writeText(paths.restoreMarkerUri, JSON.stringify({ failedCopy: previousName }));
    } catch {
        discard(files, paths.restoreMarkerUri);
        return { ok: false, reason: 'io-error' };
    }

    const moved: { readonly from: string; readonly to: string }[] = [];
    try {
        for (const suffix of DATABASE_SUFFIXES) {
            const from = `${paths.databaseUri}${suffix}`;
            if (files.exists(from)) {
                const to = `${previous}${suffix}`;
                files.move(from, to);
                moved.push({ from, to });
            }
        }
    } catch {
        try {
            for (const { from, to } of [...moved].reverse()) {
                files.move(to, from);
            }
        } catch {
            // A marca fica: a próxima abertura bloqueia apontando onde o banco está.
            return { ok: false, reason: 'database-moved', failedCopy: previousName };
        }
        discard(files, paths.restoreMarkerUri);
        return { ok: false, reason: 'io-error' };
    }
    discard(files, paths.restoreMarkerUri);
    return { ok: true, previousCopy: previousName };
}

/**
 * Remove um arquivo auxiliar sem deixar a falha esconder o resultado da troca.
 *
 * @param files Disco do aparelho.
 * @param uri Arquivo a remover; não existir não é erro.
 */
function discard(files: AppFileSystem, uri: string): void {
    try {
        files.remove(uri);
    } catch {
        // Sobra a marca; a próxima abertura a trata.
    }
}
