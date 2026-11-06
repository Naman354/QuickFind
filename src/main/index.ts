import { app } from 'electron';

// Set application name early so userData path resolves to %APPDATA%\QuickFind
app.name = 'QuickFind';

import { getAppConfig } from './config/appConfig';
import { AppService } from './services/appService';
import { registerIpcHandlers } from './ipc/handlers';
import { setupContentSecurityPolicy } from './security/csp';
import { logger } from './logger';
import { APP_VERSION } from '../shared/constants';
import {
  createMainWindow,
  getMainWindow,
  showFloatingSearch,
  toggleFloatingSearch,
  setWindowViewMode,
  setAppIsQuitting,
} from './window';
import { createTray, destroyTray } from './tray';
import { registerGlobalShortcuts, unregisterGlobalShortcuts } from './shortcuts';

// Ensure app configuration and userData resolution are established
getAppConfig();

// Initialize persistent file logging
logger.initialize();

// Safeguard against unhandled exceptions causing silent or unexpected termination
process.on('uncaughtException', err => {
  logger.error('Process', 'Uncaught exception encountered:', err);
});

process.on('unhandledRejection', reason => {
  logger.error('Process', 'Unhandled promise rejection encountered:', reason);
});

// Single instance lock to prevent duplicate instances
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  logger.info('App', 'Another instance is already running. Quitting.');
  app.quit();
} else {
  app.on('second-instance', () => {
    logger.info('App', 'Second instance attempt detected; summoning search window.');
    const win = getMainWindow();
    if (win) {
      showFloatingSearch(win);
    }
  });
}

function quitApplication(): void {
  logger.info('App', 'User requested application quit via tray');
  setAppIsQuitting(true);
  app.quit();
}

async function initializeApp(): Promise<void> {
  const config = getAppConfig();
  logger.initialize(config.userDataPath);
  const appService = AppService.getInstance();

  logger.info(
    'App',
    `QuickFind starting (v${APP_VERSION}, Electron ${process.versions.electron}, Node ${process.versions.node}, arch: ${process.arch})`
  );
  logger.info('App', `UserData directory: ${config.userDataPath}`);
  logger.info('App', `Database file: ${config.databasePath}`);

  // Setup Content Security Policy
  setupContentSecurityPolicy(config.isDev);

  // Initialize backend database and service facades
  await appService.initialize();

  // Register secure IPC handlers
  registerIpcHandlers(getMainWindow, config.isDev);

  // Create primary floating search window (starts hidden or ready-to-show)
  const win = await createMainWindow();

  // Initialize System Tray
  createTray({
    onToggleSearch: () => {
      toggleFloatingSearch(win);
    },
    onManageVolumes: () => {
      setWindowViewMode(win, 'manage');
    },
    onReindexAll: async () => {
      try {
        const indexingService = appService.getIndexingService();
        const volumes = await indexingService.getVolumes();
        for (const vol of volumes) {
          indexingService.startIndexing(vol.id);
        }
        setWindowViewMode(win, 'manage');
      } catch (err) {
        logger.error('App', 'Failed to re-index all volumes:', err);
      }
    },
    onQuit: () => {
      quitApplication();
    },
  });

  // Register Global Keyboard Shortcut (Ctrl + Shift + Space)
  registerGlobalShortcuts(() => {
    toggleFloatingSearch(win);
  });
}

app
  .whenReady()
  .then(initializeApp)
  .catch(err => {
    logger.error('App', 'Fatal error during app initialization:', err);
    app.quit();
  });

// Do not quit when window is closed/hidden; QuickFind resides in tray and shortcut
app.on('window-all-closed', () => {
  // Retain background tray and watcher operation
});

app.on('will-quit', () => {
  unregisterGlobalShortcuts();
  destroyTray();
});

let isShuttingDown = false;
app.on('before-quit', async event => {
  if (isShuttingDown) return;
  event.preventDefault();
  isShuttingDown = true;
  setAppIsQuitting(true);

  logger.info('App', 'Application graceful shutdown initiated...');

  try {
    unregisterGlobalShortcuts();
    destroyTray();
    const appService = AppService.getInstance();
    await appService.shutdown();
    logger.info('App', 'All services disposed cleanly. Exiting.');
  } catch (err) {
    logger.error('App', 'Error during shutdown:', err);
  } finally {
    app.exit(0);
  }
});
