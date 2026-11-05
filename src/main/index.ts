import { app, BrowserWindow } from 'electron';
import path from 'path';
import { getAppConfig } from './config/appConfig';
import { AppService } from './services/appService';
import { registerIpcHandlers } from './ipc/handlers';
import { setupContentSecurityPolicy } from './security/csp';
import { applyWindowSecurityGuards } from './security/validator';
import { APP_NAME } from '../shared/constants';

let mainWindow: BrowserWindow | null = null;

// Single instance lock
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  console.log('[QuickFind] Another instance is already running. Quitting.');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

async function createWindow(): Promise<BrowserWindow> {
  const config = getAppConfig();

  // Preload script path in dist/preload/index.js
  const preloadPath = path.join(__dirname, '../preload/index.js');

  const win = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 700,
    minHeight: 500,
    title: APP_NAME,
    show: false,
    backgroundColor: '#0f172a',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // Apply security navigation guards
  applyWindowSecurityGuards(win, config.isDev);

  // Show window smoothly once ready
  win.once('ready-to-show', () => {
    win.show();
    console.log('[QuickFind] Main window shown successfully');

    if (process.env.QUICKFIND_SMOKE_TEST === '1') {
      console.log('[QuickFind:SmokeTest] Window is ready to show. Verification successful!');
      setTimeout(() => {
        app.quit();
      }, 1000);
    }
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  // Load renderer
  if (config.isDev) {
    await win.loadURL(config.rendererUrl);
  } else {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  return win;
}

async function initializeApp(): Promise<void> {
  const config = getAppConfig();
  const appService = AppService.getInstance();

  // Setup Content Security Policy
  setupContentSecurityPolicy(config.isDev);

  // Initialize backend database and service facades
  await appService.initialize();

  // Register secure IPC handlers
  registerIpcHandlers(() => mainWindow, config.isDev);

  // Create main window
  mainWindow = await createWindow();
}

app
  .whenReady()
  .then(initializeApp)
  .catch(err => {
    console.error('[QuickFind] Fatal error during app initialization:', err);
    app.quit();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = await createWindow();
  }
});

let isShuttingDown = false;
app.on('before-quit', async event => {
  if (isShuttingDown) return;
  event.preventDefault();
  isShuttingDown = true;

  try {
    const appService = AppService.getInstance();
    await appService.shutdown();
  } catch (err) {
    console.error('[QuickFind] Error during shutdown:', err);
  } finally {
    app.exit(0);
  }
});
