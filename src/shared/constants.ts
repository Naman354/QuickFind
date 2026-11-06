/**
 * QuickFind Application Constants
 */

export const APP_NAME = 'QuickFind';
export const APP_VERSION = '0.4.0';

/**
 * IPC Channel identifiers
 */
export const IPC_CHANNELS = {
  SYSTEM: {
    GET_INFO: 'quickfind:system:getInfo',
    GET_HEALTH: 'quickfind:system:getHealth',
  },
  DATABASE: {
    GET_STATUS: 'quickfind:database:getStatus',
  },
  INDEXING: {
    GET_STATUS: 'quickfind:indexing:getStatus',
    GET_VOLUMES: 'quickfind:indexing:getVolumes',
    START_SCAN: 'quickfind:indexing:startScan',
    CANCEL_SCAN: 'quickfind:indexing:cancelScan',
    PROGRESS_UPDATE: 'quickfind:indexing:progressUpdate',
  },
  SYNC: {
    GET_STATUS: 'quickfind:sync:getStatus',
    RECONCILE: 'quickfind:sync:reconcile',
    STATUS_UPDATE: 'quickfind:sync:statusUpdate',
  },
  SEARCH: {
    EXECUTE: 'quickfind:search:execute',
  },
  WINDOW: {
    MINIMIZE: 'quickfind:window:minimize',
    MAXIMIZE: 'quickfind:window:maximize',
    CLOSE: 'quickfind:window:close',
  },
} as const;

/**
 * SQLite Configuration Defaults
 */
export const SQLITE_CONFIG = {
  DB_FILENAME: 'quickfind.db',
  BUSY_TIMEOUT_MS: 10000,
  CACHE_SIZE_KB: -64000, // 64 MB
  MMAP_SIZE_BYTES: 268435456, // 256 MB
} as const;

/**
 * Filesystem Indexing Defaults
 */
export const INDEXING_CONFIG = {
  BATCH_SIZE: 2000,
  CONCURRENCY: 8,
  PROGRESS_INTERVAL_MS: 300,
  // Conservative exclusions for Windows system locations
  EXCLUDED_DIR_NAMES: new Set([
    '$recycle.bin',
    'system volume information',
    '$sysreset',
    '$windows.~bt',
    '$windows.~ws',
  ]),
  EXCLUDED_ROOT_FILES: new Set([
    'pagefile.sys',
    'hiberfil.sys',
    'swapfile.sys',
    'dumpstack.log.tmp',
  ]),
} as const;

/**
 * Search Engine Defaults
 */
export const SEARCH_CONFIG = {
  DEFAULT_LIMIT: 50,
  MAX_LIMIT: 500,
  TRIGRAM_MIN_LENGTH: 3,
} as const;

/**
 * Filesystem Synchronization Defaults
 */
export const SYNC_CONFIG = {
  DEBOUNCE_MS: 150,
  BATCH_FLUSH_INTERVAL_MS: 500,
  MAX_PENDING_CHANGES: 1000,
  USN_READ_BATCH_SIZE: 1000,
  MAX_RETRY_ATTEMPTS: 3,
} as const;
