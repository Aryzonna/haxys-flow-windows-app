/**
 * Auto-updater module for Haxys Core.
 */
function initAutoUpdater(mainWindow) {
  try {
    const { autoUpdater } = require('electron-updater');

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    // Check for updates on init
    autoUpdater.checkForUpdatesAndNotify();

    // Check every 4 hours
    setInterval(() => {
      autoUpdater.checkForUpdatesAndNotify();
    }, 4 * 60 * 60 * 1000);

    autoUpdater.on('update-available', (info) => {
      console.log('[HaxysCore] Update available:', info.version);
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log('[HaxysCore] Update downloaded:', info.version);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.executeJavaScript(`
          var appUpdateBtn = document.getElementById('app-update-btn');
          if (appUpdateBtn) appUpdateBtn.style.display = 'block';
        `).catch(()=>{});
      }
    });

    autoUpdater.on('error', (err) => {
      console.log('[HaxysCore] Auto-updater error (expected without server):', err.message);
    });
  } catch (err) {
    console.log('[HaxysCore] Auto-updater not available:', err.message);
  }
}

module.exports = { initAutoUpdater };
