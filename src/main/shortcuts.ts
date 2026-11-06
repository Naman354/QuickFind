import { globalShortcut } from 'electron';
import { GLOBAL_SHORTCUT_DEFAULT } from '../shared/constants';

let isRegistered = false;

export function registerGlobalShortcuts(onToggle: () => void): boolean {
  if (isRegistered) {
    return true;
  }

  try {
    const success = globalShortcut.register(GLOBAL_SHORTCUT_DEFAULT, () => {
      onToggle();
    });

    if (!success) {
      console.warn(
        `[QuickFind:Shortcuts] Failed to register global shortcut: ${GLOBAL_SHORTCUT_DEFAULT}. It might be reserved by another application.`
      );
      return false;
    }

    isRegistered = true;
    console.log(
      `[QuickFind:Shortcuts] Successfully registered global shortcut: ${GLOBAL_SHORTCUT_DEFAULT}`
    );
    return true;
  } catch (err) {
    console.error(
      `[QuickFind:Shortcuts] Error registering global shortcut ${GLOBAL_SHORTCUT_DEFAULT}:`,
      err
    );
    return false;
  }
}

export function unregisterGlobalShortcuts(): void {
  if (isRegistered) {
    try {
      globalShortcut.unregister(GLOBAL_SHORTCUT_DEFAULT);
      isRegistered = false;
      console.log('[QuickFind:Shortcuts] Global shortcuts unregistered cleanly');
    } catch (err) {
      console.error('[QuickFind:Shortcuts] Error unregistering global shortcuts:', err);
    }
  }
}
