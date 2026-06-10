const { globalShortcut } = require('electron');

let registered = false;

/**
 * Register global keyboard shortcuts.
 * Ctrl+Shift+G toggles the floating widget.
 * @param {WidgetManager} widgetManager
 */
function registerShortcuts(widgetManager) {
  if (registered) return;

  const success = globalShortcut.register('Ctrl+Shift+G', () => {
    if (widgetManager) {
      widgetManager.toggle();
    }
  });

  if (success) {
    registered = true;
    console.log('[HaxysFlow] Global shortcut Ctrl+Shift+G registered');
  } else {
    console.warn('[HaxysFlow] Failed to register Ctrl+Shift+G — may be in use by another app');
  }
}

/**
 * Unregister all global shortcuts.
 */
function unregisterShortcuts() {
  globalShortcut.unregisterAll();
  registered = false;
}

module.exports = { registerShortcuts, unregisterShortcuts };
