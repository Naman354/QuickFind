import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { SQLITE_CONFIG } from '../../shared/constants';

export interface AppConfig {
  isDev: boolean;
  userDataPath: string;
  databasePath: string;
  rendererUrl: string;
  isPackaged: boolean;
}

export function getAppConfig(): AppConfig {
  if (app.name !== 'QuickFind') {
    app.name = 'QuickFind';
  }

  const isDev =
    (process.env.NODE_ENV === 'development' || !app.isPackaged) &&
    process.env.NODE_ENV !== 'production' &&
    process.env.QUICKFIND_SMOKE_TEST !== '1';

  let userDataPath = app.getPath('userData');

  // Handle case-insensitivity on Windows or transition between lowercase 'quickfind' and 'QuickFind'
  try {
    const appDataDir = app.getPath('appData');
    const legacyDir = path.join(appDataDir, 'quickfind');
    const canonicalDir = path.join(appDataDir, 'QuickFind');

    if (
      fs.existsSync(path.join(legacyDir, SQLITE_CONFIG.DB_FILENAME)) &&
      !fs.existsSync(path.join(canonicalDir, SQLITE_CONFIG.DB_FILENAME))
    ) {
      userDataPath = legacyDir;
      app.setPath('userData', legacyDir);
    }
  } catch {
    // Retain default userDataPath if path resolution fails early
  }

  const databasePath = path.join(userDataPath, SQLITE_CONFIG.DB_FILENAME);

  // In development, load from Vite dev server; in production, load local dist/renderer/index.html
  const rendererUrl = isDev
    ? 'http://localhost:5173'
    : `file://${path.join(__dirname, '../renderer/index.html')}`;

  return {
    isDev,
    userDataPath,
    databasePath,
    rendererUrl,
    isPackaged: app.isPackaged,
  };
}
