import { app } from 'electron';
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
  const isDev =
    (process.env.NODE_ENV === 'development' || !app.isPackaged) &&
    process.env.NODE_ENV !== 'production' &&
    process.env.QUICKFIND_SMOKE_TEST !== '1';
  const userDataPath = app.getPath('userData');
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
