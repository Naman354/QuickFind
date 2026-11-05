/**
 * QuickFind Application Constants
 */

export const APP_NAME = 'QuickFind';
export const APP_VERSION = '0.1.0';

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
  BUSY_TIMEOUT_MS: 5000,
  CACHE_SIZE_KB: -64000, // 64 MB
  MMAP_SIZE_BYTES: 268435456, // 256 MB
} as const;

