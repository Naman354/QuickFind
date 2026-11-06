import { BrowserWindow, screen, app } from 'electron';
import path from 'path';
import { getAppConfig } from './config/appConfig';
import { applyWindowSecurityGuards } from './security/validator';
import { APP_NAME, IPC_CHANNELS } from '../shared/constants';

export type ViewMode = 'search' | 'manage';

let mainWindow: BrowserWindow | null = null;
let currentViewMode: ViewMode = 'search';
let isAppQuitting = false;
let currentSearchHeight = 58;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function getCurrentViewMode(): ViewMode {
  return currentViewMode;
}

export function setAppIsQuitting(quitting: boolean): void {
  isAppQuitting = quitting;
}

/**
 * Calculates bounds to center the floating window near the upper portion (15%)
 * of the display currently nearest to the mouse cursor.
 */
export function positionFloatingWindow(
  win: BrowserWindow,
  width = 680,
  height = currentSearchHeight
): void {
  const cursorPoint = screen.getCursorScreenPoint();
  const currentDisplay = screen.getDisplayNearestPoint(cursorPoint);
  const workArea = currentDisplay.workArea;

  const x = Math.round(workArea.x + (workArea.width - width) / 2);
  const y = Math.round(workArea.y + workArea.height * 0.15);

  win.setBounds({ x, y, width, height });
}

export async function createMainWindow(): Promise<BrowserWindow> {
  const config = getAppConfig();
  const preloadPath = path.join(__dirname, '../preload/index.js');

  const win = new BrowserWindow({
    width: 680,
    height: 58,
    minWidth: 500,
    minHeight: 58,
    title: APP_NAME,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    hasShadow: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow = win;

  // Apply security navigation guards
  applyWindowSecurityGuards(win, config.isDev);

  // Position on the active monitor
  positionFloatingWindow(win, 680, 58);

  // Auto-dismiss on blur when in search mode (unless devTools is open)
  win.on('blur', () => {
    if (currentViewMode === 'search' && !win.webContents.isDevToolsOpened()) {
      win.hide();
    }
  });

  // Intercept close event: hide window instead of destroying
  win.on('close', event => {
    if (!isAppQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  win.once('ready-to-show', () => {
    console.log('[QuickFind] Main floating search window ready');
    // Initially show and focus the floating window
    showFloatingSearch(win);

    if (process.env.QUICKFIND_SMOKE_TEST === '1') {
      console.log('[QuickFind:SmokeTest] Window is ready to show. Verification successful!');
      setTimeout(() => {
        app.quit();
      }, 1000);
    }
  });

  // Load renderer
  if (config.isDev) {
    await win.loadURL(config.rendererUrl);
  } else {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  return win;
}

/**
 * Show and focus floating search window on the active monitor
 */
export function showFloatingSearch(win: BrowserWindow = mainWindow!): void {
  if (!win || win.isDestroyed()) return;

  if (currentViewMode !== 'search') {
    setWindowViewMode(win, 'search');
  } else {
    positionFloatingWindow(win, 680, currentSearchHeight);
  }

  win.setAlwaysOnTop(true, 'screen-saver');
  win.show();
  win.focus();
  win.webContents.send(IPC_CHANNELS.WINDOW.FOCUS_INPUT);
}

/**
 * Hide floating search window
 */
export function hideFloatingSearch(win: BrowserWindow = mainWindow!): void {
  if (!win || win.isDestroyed()) return;
  win.hide();
}

/**
 * Toggle visibility of floating search window
 */
export function toggleFloatingSearch(win: BrowserWindow = mainWindow!): void {
  if (!win || win.isDestroyed()) return;

  if (win.isVisible() && win.isFocused()) {
    hideFloatingSearch(win);
  } else {
    showFloatingSearch(win);
  }
}

/**
 * Dynamically adjust window height to fit search results smoothly
 */
export function setFloatingWindowHeight(win: BrowserWindow, height: number): void {
  if (!win || win.isDestroyed() || currentViewMode !== 'search') return;

  const clampedHeight = Math.min(Math.max(Math.round(height), 58), 620);
  currentSearchHeight = clampedHeight;

  const [currentWidth] = win.getSize();
  win.setSize(currentWidth, clampedHeight, false);
}

/**
 * Switch between minimal floating search and volume management dashboard
 */
export function setWindowViewMode(win: BrowserWindow, mode: ViewMode): void {
  if (!win || win.isDestroyed()) return;

  currentViewMode = mode;

  if (mode === 'manage') {
    win.setResizable(true);
    win.setAlwaysOnTop(false);
    win.setSkipTaskbar(false);
    win.setSize(920, 640);
    win.center();
    win.show();
    win.focus();
    win.webContents.send(IPC_CHANNELS.WINDOW.SWITCH_VIEW, 'manage');
  } else {
    win.setResizable(false);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setSkipTaskbar(true);
    positionFloatingWindow(win, 680, currentSearchHeight);
    win.show();
    win.focus();
    win.webContents.send(IPC_CHANNELS.WINDOW.SWITCH_VIEW, 'search');
    win.webContents.send(IPC_CHANNELS.WINDOW.FOCUS_INPUT);
  }
}
