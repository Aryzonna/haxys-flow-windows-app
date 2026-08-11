const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const { lerAjustes, gravarAjuste, sincronizarInicioComWindows } = require('./settings');

let tray = null;

/**
 * Creates the system tray icon with context menu.
 *
 * O menu e a tela de ajustes do Flow leem e gravam pelo MESMO módulo (settings.js). Antes
 * este arquivo chamava `setLoginItemSettings` por conta própria; com dois lugares mexendo no
 * mesmo interruptor, o menu mostraria "desmarcado" para algo que a tela acabou de ligar.
 *
 * @param {BrowserWindow} mainWindow - The main application window
 * @param {WidgetManager} widgetManager - The widget manager
 * @param {{ abrirAjustes?: () => void }} acoes - o que só o main.js sabe fazer
 * @returns {Tray} The created tray instance, com `atualizarMenu()` pendurado
 */
function createTray(mainWindow, widgetManager, acoes = {}) {
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
  tray.setToolTip('Haxys Flow');

  // Build context menu
  const buildMenu = () => {
    const ajustes = lerAjustes();

    return Menu.buildFromTemplate([
      {
        label: 'Abrir Haxys Flow',
        click: () => {
          mainWindow.show();
          mainWindow.focus();
        },
      },
      {
        label: 'Widget Flutuante' + (ajustes.widgetShortcut ? ` (${ajustes.widgetShortcut})` : ''),
        click: () => {
          if (widgetManager) {
            widgetManager.toggle();
          }
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
        checked: ajustes.startWithWindows,
        click: (menuItem) => {
          const atualizados = gravarAjuste('startWithWindows', menuItem.checked);
          sincronizarInicioComWindows(atualizados);
        },
      },
      {
        label: 'Ajustes do aplicativo…',
        click: () => {
          if (acoes.abrirAjustes) acoes.abrirAjustes();
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

  const atualizarMenu = () => {
    if (tray && !tray.isDestroyed()) tray.setContextMenu(buildMenu());
  };

  atualizarMenu();

  // Double-click tray → show main window
  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // A tela de ajustes muda os mesmos valores; sem isto o menu continuaria mostrando o
  // estado de quando o app subiu.
  tray.atualizarMenu = atualizarMenu;

  return tray;
}

module.exports = { createTray };
