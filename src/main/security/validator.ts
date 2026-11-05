import { BrowserWindow, IpcMainInvokeEvent } from 'electron';

/**
 * Validates that an incoming IPC request originated from the authorized BrowserWindow
 * and from a valid origin/frame.
 */
export function validateIpcSender(
  event: IpcMainInvokeEvent,
  mainWindow: BrowserWindow | null,
  isDev: boolean
): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.warn('[QuickFind:Security] Rejected IPC request: Main window is invalid or destroyed');
    return false;
  }

  // Ensure request originates strictly from the main window's webContents
  if (event.sender.id !== mainWindow.webContents.id) {
    console.warn(
      `[QuickFind:Security] Rejected IPC request: Sender ID (${event.sender.id}) does not match window webContents ID (${mainWindow.webContents.id})`
    );
    return false;
  }

  // Validate senderFrame if present
  if (event.senderFrame) {
    const frameUrl = event.senderFrame.url;
    if (isDev) {
      if (!frameUrl.startsWith('http://localhost:5173') && frameUrl !== 'about:blank') {
        console.warn(
          `[QuickFind:Security] Rejected IPC request: Invalid dev frame origin (${frameUrl})`
        );
        return false;
      }
    } else {
      if (!frameUrl.startsWith('file://')) {
        console.warn(
          `[QuickFind:Security] Rejected IPC request: Invalid prod frame origin (${frameUrl})`
        );
        return false;
      }
    }
  }

  return true;
}

/**
 * Attaches navigation guards to the BrowserWindow to prevent untrusted navigation
 * and unauthorized new window creation.
 */
export function applyWindowSecurityGuards(window: BrowserWindow, isDev: boolean): void {
  // Prevent window.open and target="_blank"
  window.webContents.setWindowOpenHandler(details => {
    console.warn(`[QuickFind:Security] Blocked window.open request to: ${details.url}`);
    return { action: 'deny' };
  });

  // Prevent navigation away from the local app
  window.webContents.on('will-navigate', (event, navigationUrl) => {
    const isAllowed = isDev
      ? navigationUrl.startsWith('http://localhost:5173')
      : navigationUrl.startsWith('file://');

    if (!isAllowed) {
      event.preventDefault();
      console.warn(`[QuickFind:Security] Blocked will-navigate request to: ${navigationUrl}`);
    }
  });
}
