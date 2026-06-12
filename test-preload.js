const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

ipcMain.on('window:minimize', () => {
  require('fs').writeFileSync('test-output.txt', 'window.haxys works!');
  app.quit();
});

app.whenReady().then(() => {
  const win = new BrowserWindow({
    webPreferences: {
      preload: path.join(__dirname, 'src/preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  require('fs').writeFileSync(path.join(__dirname, 'empty.html'), '<html><body></body></html>');
  win.loadFile(path.join(__dirname, 'empty.html'));

  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer] ${message}`);
  });

  win.webContents.once('did-finish-load', () => {
    win.webContents.executeJavaScript(`
      console.log("Checking window.haxys...");
      if (typeof window.haxys !== "undefined") {
        console.log("window.haxys works!");
        window.haxys.minimize();
      } else {
        console.log("window.haxys is UNDEFINED!");
        document.title = "HAXYS_MISSING";
      }
    `).catch(e => console.error(e));
  });

  win.on('page-title-updated', (e, title) => {
    if (title === "HAXYS_MISSING") {
      require('fs').writeFileSync('test-output.txt', 'window.haxys is missing in about:blank!');
      app.quit();
    }
  });
});
