import { globalShortcut } from 'electron';
import { GLOBAL_SHORTCUT_DEFAULT } from '../shared/constants';
import { logger } from './logger';

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
      logger.warn(
        'Shortcuts',
        `Failed to register global shortcut: ${GLOBAL_SHORTCUT_DEFAULT}. It might be reserved by another application.`
      );
      return false;
    }

    isRegistered = true;
    logger.info('Shortcuts', `Successfully registered global shortcut: ${GLOBAL_SHORTCUT_DEFAULT}`);
    return true;
  } catch (err) {
    logger.error('Shortcuts', `Error registering global shortcut ${GLOBAL_SHORTCUT_DEFAULT}:`, err);
    return false;
  }
}

export function unregisterGlobalShortcuts(): void {
  if (isRegistered) {
    try {
      globalShortcut.unregister(GLOBAL_SHORTCUT_DEFAULT);
      isRegistered = false;
      logger.info('Shortcuts', 'Global shortcuts unregistered cleanly');
    } catch (err) {
      logger.error('Shortcuts', 'Error unregistering global shortcuts:', err);
    }
  }
}
