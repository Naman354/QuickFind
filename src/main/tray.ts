import { Tray, Menu, nativeImage } from 'electron';

// Crisp 32x32 RGBA PNG icon: Indigo ring with dark center and violet handle
const TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAj0lEQVR4nGNgGAVDBSSnffyPCw+YxTR3CCmWU90R5FhONUfgMlhO03oLOqa6I4i1mBiHUMUBxFiOyxF08z3VQoESy6kSCqMOGHXAgOcCSkOBJgUR3UtCXI6gW11AyBHE4BWh38F4QBwBs3xAHAFSj+4AqjiCkEPQ1dLMEaSAUUfgcgTdHYDuiAFxwCgY1AAAZBpIm6ayw5kAAAAASUVORK5CYII=';

export interface TrayCallbacks {
  onToggleSearch: () => void;
  onManageVolumes: () => void;
  onReindexAll: () => void | Promise<void>;
  onQuit: () => void;
}

let trayInstance: Tray | null = null;

export function getTray(): Tray | null {
  return trayInstance;
}

export function createTray(callbacks: TrayCallbacks): Tray {
  if (trayInstance && !trayInstance.isDestroyed()) {
    return trayInstance;
  }

  const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL);
  trayInstance = new Tray(icon);

  trayInstance.setToolTip('QuickFind — Local Desktop File Search (Ctrl+Shift+Space)');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open QuickFind',
      accelerator: 'CommandOrControl+Shift+Space',
      click: () => callbacks.onToggleSearch(),
    },
    {
      label: 'Manage Indexed Volumes',
      click: () => callbacks.onManageVolumes(),
    },
    {
      label: 'Re-index All Volumes',
      click: () => callbacks.onReindexAll(),
    },
    { type: 'separator' },
    {
      label: 'Quit QuickFind',
      click: () => callbacks.onQuit(),
    },
  ]);

  trayInstance.setContextMenu(contextMenu);

  // Single click or double click on tray icon toggles search
  trayInstance.on('click', () => {
    callbacks.onToggleSearch();
  });

  trayInstance.on('double-click', () => {
    callbacks.onToggleSearch();
  });

  return trayInstance;
}

export function destroyTray(): void {
  if (trayInstance && !trayInstance.isDestroyed()) {
    trayInstance.destroy();
    trayInstance = null;
  }
}
