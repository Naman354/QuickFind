import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { DatabaseStatus } from '../../shared/types';
import { SQLITE_CONFIG } from '../../shared/constants';

export class DatabaseManager {
  private static instance: DatabaseManager | null = null;
  private db: Database.Database | null = null;
  private dbPath: string = '';

  private constructor() {}

  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  /**
   * Initializes the SQLite database connection and sets performance & integrity pragmas.
   */
  public initialize(targetPath: string): void {
    if (this.db && this.db.open) {
      return;
    }

    this.dbPath = targetPath;

    // Ensure the parent directory exists in userData
    const parentDir = path.dirname(this.dbPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    try {
      this.db = new Database(this.dbPath, {
        timeout: SQLITE_CONFIG.BUSY_TIMEOUT_MS,
      });

      // Performance and integrity settings
      this.applyPragmas();

      // Initialize metadata table for milestone tracking without implementing final schema
      this.initializeMetadata();

      console.log(`[QuickFind:Database] Successfully connected to SQLite at ${this.dbPath}`);
    } catch (error) {
      console.error('[QuickFind:Database] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Applies recommended SQLite performance and integrity PRAGMAs
   */
  private applyPragmas(): void {
    if (!this.db) return;

    // Write-Ahead Logging for high concurrency and fast writes
    this.db.pragma('journal_mode = WAL');

    // Safe in WAL mode, avoids synchronous disk flushes
    this.db.pragma('synchronous = NORMAL');

    // Enforce foreign key constraints
    this.db.pragma('foreign_keys = ON');

    // 64MB cache in RAM
    this.db.pragma(`cache_size = ${SQLITE_CONFIG.CACHE_SIZE_KB}`);

    // Temporary tables and indices stored in memory
    this.db.pragma('temp_store = MEMORY');

    // Memory-mapped I/O (256 MB) for high-speed reads
    this.db.pragma(`mmap_size = ${SQLITE_CONFIG.MMAP_SIZE_BYTES}`);

    // Wait before returning SQLITE_BUSY
    this.db.pragma(`busy_timeout = ${SQLITE_CONFIG.BUSY_TIMEOUT_MS}`);
  }

  /**
   * Initializes a minimal schema metadata table to track database versions
   */
  private initializeMetadata(): void {
    if (!this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO _schema_meta (key, value, updated_at)
      VALUES ('version', '0.1.0', ?)
    `);
    stmt.run(Date.now());
  }

  /**
   * Verifies if SQLite FTS5 extension is compiled and available
   */
  public isFts5Available(): boolean {
    if (!this.db) return false;
    try {
      const rows = this.db.pragma('compile_options') as Array<{ compile_options: string }>;
      const hasOption = rows.some(r => r.compile_options?.includes('ENABLE_FTS5'));
      if (hasOption) return true;

      // Fallback verification by creating a test virtual table in memory
      this.db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS temp._fts5_probe USING fts5(probe);');
      this.db.exec('DROP TABLE IF EXISTS temp._fts5_probe;');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns current database status and active pragma configuration
   */
  public getStatus(): DatabaseStatus {
    if (!this.db || !this.db.open) {
      return {
        connected: false,
        filePath: this.dbPath,
        journalMode: 'unknown',
        synchronous: 'unknown',
        fts5Available: false,
        foreignKeysEnabled: false,
        cacheSizeKb: 0,
        pageSizeBytes: 0,
        mmapSize: 0,
        busyTimeoutMs: 0,
        error: 'Database is not initialized or has been closed',
      };
    }

    try {
      const journalMode = (this.db.pragma('journal_mode', { simple: true }) as string) || 'unknown';
      const synchronous = (this.db.pragma('synchronous', { simple: true }) as number).toString();
      const foreignKeys = Boolean(this.db.pragma('foreign_keys', { simple: true }));
      const cacheSize = (this.db.pragma('cache_size', { simple: true }) as number) || 0;
      const pageSize = (this.db.pragma('page_size', { simple: true }) as number) || 0;
      const mmapSize = (this.db.pragma('mmap_size', { simple: true }) as number) || 0;
      const busyTimeout = (this.db.pragma('busy_timeout', { simple: true }) as number) || 0;
      const fts5Available = this.isFts5Available();

      return {
        connected: true,
        filePath: this.dbPath,
        journalMode,
        synchronous,
        fts5Available,
        foreignKeysEnabled: foreignKeys,
        cacheSizeKb: Math.abs(cacheSize),
        pageSizeBytes: pageSize,
        mmapSize,
        busyTimeoutMs: busyTimeout,
      };
    } catch (err) {
      return {
        connected: false,
        filePath: this.dbPath,
        journalMode: 'error',
        synchronous: 'error',
        fts5Available: false,
        foreignKeysEnabled: false,
        cacheSizeKb: 0,
        pageSizeBytes: 0,
        mmapSize: 0,
        busyTimeoutMs: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Returns raw database handle for internal backend operations
   */
  public getDatabase(): Database.Database {
    if (!this.db || !this.db.open) {
      throw new Error('Database is not initialized. Call initialize() first.');
    }
    return this.db;
  }

  /**
   * Closes database connection safely
   */
  public close(): void {
    if (this.db && this.db.open) {
      try {
        console.log('[QuickFind:Database] Closing SQLite connection...');
        this.db.close();
      } catch (err) {
        console.error('[QuickFind:Database] Error closing database:', err);
      } finally {
        this.db = null;
      }
    }
  }

  public isConnected(): boolean {
    return Boolean(this.db && this.db.open);
  }
}

