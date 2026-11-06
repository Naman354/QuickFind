import { app } from 'electron';
import { getAppConfig } from './config/appConfig';
import { AppService } from './services/appService';
import { registerIpcHandlers } from './ipc/handlers';
import { setupContentSecurityPolicy } from './security/csp';
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

// Single instance lock to prevent duplicate instances
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  console.log('[QuickFind] Another instance is already running. Quitting.');
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = getMainWindow();
    if (win) {
      showFloatingSearch(win);
    }
  });
}

function quitApplication(): void {
  console.log('[QuickFind] User requested application quit via tray');
  setAppIsQuitting(true);
  app.quit();
}

async function initializeApp(): Promise<void> {
  const config = getAppConfig();
  const appService = AppService.getInstance();

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
        console.error('[QuickFind] Failed to re-index all volumes:', err);
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
    console.error('[QuickFind] Fatal error during app initialization:', err);
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

  try {
    unregisterGlobalShortcuts();
    destroyTray();
    const appService = AppService.getInstance();
    await appService.shutdown();
  } catch (err) {
    console.error('[QuickFind] Error during shutdown:', err);
  } finally {
    app.exit(0);
  }
});
