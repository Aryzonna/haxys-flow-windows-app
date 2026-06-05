const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const { getStartWithWindows, setStartWithWindows } = require('./store');

let tray = null;

/**
 * Creates the system tray icon with context menu.
 * @param {BrowserWindow} mainWindow - The main application window
 * @returns {Tray} The created tray instance
 */
function createTray(mainWindow) {
  // Load tray icon with fallback
  const iconPath = path.join(__dirname, '../../assets/tray-icon.png');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) throw new Error('Icon file empty');
    // Resize for tray (16x16)
    trayIcon = trayIcon.resize({ width: 16, height: 16 });
  } catch {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Haxys Core');

  // Build context menu
  const buildMenu = () => {
    const startsWithWindows = getStartWithWindows();

    return Menu.buildFromTemplate([
      {
        label: 'Abrir Haxys Core',
        click: () => {
          mainWindow.show();
          mainWindow.focus();
        },
      },
      {
        label: 'Recarregar página',
        click: () => {
          if (app.reloadContentView) app.reloadContentView();
        },
      },
      { type: 'separator' },
      {
        label: 'Iniciar com Windows',
        type: 'checkbox',
        checked: startsWithWindows,
        click: (menuItem) => {
          const enabled = menuItem.checked;
          setStartWithWindows(enabled);
          app.setLoginItemSettings({
            openAtLogin: enabled,
            path: process.execPath,
            args: ['--hidden'],
          });
        },
      },
      { type: 'separator' },
      {
        label: 'Sair',
        click: () => {
          app.quit();
        },
      },
    ]);
  };

  tray.setContextMenu(buildMenu());

  // Double-click tray → show main window
  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  return tray;
}

module.exports = { createTray };
