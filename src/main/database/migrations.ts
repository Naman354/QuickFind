import Database from 'better-sqlite3';
import { SCHEMA_V1, SCHEMA_V2, SCHEMA_V3 } from './schema';

export interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_filesystem_indexing',
    up: (db: Database.Database) => {
      db.exec(SCHEMA_V1);
    },
  },
  {
    version: 2,
    name: 'fts5_search_infrastructure',
    up: (db: Database.Database) => {
      db.exec(SCHEMA_V2);

      // Populate FTS5 table with any pre-existing records in entries
      try {
        db.prepare(
          `
          INSERT OR IGNORE INTO entries_fts(rowid, name, path)
          SELECT id, name, path FROM entries;
        `
        ).run();
      } catch (err) {
        console.warn('[QuickFind:Database] Initial FTS population note:', err);
      }
    },
  },
  {
    version: 3,
    name: 'incremental_synchronization_and_checkpoints',
    up: (db: Database.Database) => {
      db.exec(SCHEMA_V3);

      // Initialize checkpoint records for any existing volumes
      try {
        db.prepare(
          `
          INSERT OR IGNORE INTO volume_checkpoints (
            volume_id, sync_mode, sync_status, checkpoint_timestamp
          )
          SELECT id, 'filesystem_watcher', 'out_of_sync', ?
          FROM volumes;
        `
        ).run(Date.now());
      } catch (err) {
        console.warn('[QuickFind:Database] Checkpoint initialization note:', err);
      }
    },
  },
];

export class MigrationManager {
  /**
   * Executes pending database migrations in sequence
   */
  public static runMigrations(db: Database.Database): void {
    // Ensure migrations tracking table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version INTEGER NOT NULL UNIQUE,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `);

    const appliedRows = db.prepare('SELECT version FROM _migrations').all() as Array<{
      version: number;
    }>;
    const appliedVersions = new Set(appliedRows.map(r => r.version));

    for (const migration of MIGRATIONS) {
      if (!appliedVersions.has(migration.version)) {
        console.log(
          `[QuickFind:Database] Applying migration ${migration.version}: ${migration.name}...`
        );

        const runTx = db.transaction(() => {
          migration.up(db);
          db.prepare('INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
            migration.version,
            migration.name,
            Date.now()
          );

          db.prepare(
            'INSERT INTO _schema_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
          ).run('schema_version', migration.version.toString(), Date.now());
        });

        runTx();
        console.log(`[QuickFind:Database] Migration ${migration.version} applied successfully.`);
      }
    }
  }
}
