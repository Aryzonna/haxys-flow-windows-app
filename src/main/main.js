// ═══════════════════════════════════════════════════════════════════════
// Haxys Flow — Desktop App
// Electron wrapper for flow2.haxys.com.br
// ═══════════════════════════════════════════════════════════════════════

const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const path = require('path');
const https = require('https');
const { createTray } = require('./tray');
const { initAutoUpdater } = require('./updater');
const {
  getMainBounds,
  setMainBounds,
  getStartWithWindows,
  setStartWithWindows,
} = require('./store');

// ── Constants ────────────────────────────────────────────────────────
const HAXYS_URL = 'https://flow2.haxys.com.br/';
const SESSION_PARTITION = 'persist:haxysflow';

// Desktop Chrome User-Agent
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

// Mobile Chrome UA for login popup (Google blocks Electron UA)
const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/134.0.6998.205 Mobile Safari/537.36';

// ── State ────────────────────────────────────────────────────────────
let mainWindow = null;
let loginWindow = null;
let tray = null;
let isQuitting = false;
const startHidden = process.argv.some(arg => arg.includes('--hidden'));
let mainBoundsTimeout = null;

let knownVersionTimestamp = null;
let updatePollingInterval = null;

// ── Single Instance Lock ─────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    // If the second instance was also launched with --hidden, do not show the window.
    // This happens if there are duplicate startup registry entries.
    const secondInstanceHidden = commandLine && commandLine.some(arg => arg.includes('--hidden'));
    if (secondInstanceHidden) {
      return;
    }

    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ── App Lifecycle ────────────────────────────────────────────────────

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  // Don't quit — stay in tray
});

// ── App Ready ────────────────────────────────────────────────────────

app.whenReady().then(() => {
  configureSession();
  createMainWindow();

  tray = createTray(mainWindow);
  initAutoUpdater(mainWindow);

  setupIPC();
});

// ── Session Configuration ────────────────────────────────────────────

function configureSession() {
  const ses = session.fromPartition(SESSION_PARTITION);

  ses.setUserAgent(DESKTOP_UA);

  // Enable persistent cookies
  ses.cookies.flushStore().catch(() => {});

  // Set permissive cookie policy
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = DESKTOP_UA;
    callback({ requestHeaders: details.requestHeaders });
  });

  const chromeVersion = DESKTOP_UA.match(/Chrome\/([\d.]+)/)?.[1] || '134.0.0.0';
  console.log(`[HaxysFlow] Session configured — Chrome/${chromeVersion}`);
}

// ── URL Helpers ──────────────────────────────────────────────────────

function isAllowedURL(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === 'flow2.haxys.com.br' ||
      parsed.hostname.endsWith('.haxys.com.br') ||
      parsed.hostname === 'accounts.google.com' ||
      parsed.hostname === 'accounts.youtube.com' ||
      parsed.hostname === 'ssl.gstatic.com' ||
      parsed.hostname === 'apis.google.com'
    );
  } catch {
    return false;
  }
}

function isLoginURL(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'accounts.google.com';
  } catch {
    return false;
  }
}

// ── State for WebContentsView ────────────────────────────────────────
let contentView = null;

function createMainWindow() {
  const savedBounds = getMainBounds();

  mainWindow = new BrowserWindow({
    width: savedBounds.width || 1280,
    height: savedBounds.height || 800,
    x: savedBounds.x,
    y: savedBounds.y,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0a0a',
      symbolColor: '#ffffff',
      height: 38,
    },
    backgroundColor: '#0a0a0a',
    icon: path.join(__dirname, '../../assets/icon.png'),

    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load a minimal shell page with the titlebar
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(getShellHTML())}`);

  // Create the WebContentsView for the actual website
  const { WebContentsView } = require('electron');
  contentView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      partition: SESSION_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.contentView.addChildView(contentView);
  contentView.webContents.loadURL(HAXYS_URL);

  // Position the content view below the 38px titlebar
  const layoutViews = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const { width, height } = mainWindow.getContentBounds();
    contentView.setBounds({ x: 0, y: 38, width, height: height - 38 });
  };

  layoutViews();
  mainWindow.on('resize', layoutViews);

  // Show when content is ready
  contentView.webContents.once('did-finish-load', () => {
    if (!startHidden) {
      mainWindow.show();
    }
  });

  // Also inject CSS for shell titlebar
  mainWindow.webContents.once('did-finish-load', () => {
    injectShellCSS();
  });

  // ── Save window bounds (debounced) ─────────────────────────────
  const saveBounds = () => {
    if (mainBoundsTimeout) clearTimeout(mainBoundsTimeout);
    mainBoundsTimeout = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMaximized()) {
        setMainBounds(mainWindow.getBounds());
      }
    }, 500);
  };

  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);

  // ── Close → Hide to Tray ───────────────────────────────────────
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // ── Navigation Guards (on content view) ────────────────────────
  contentView.webContents.on('will-navigate', (event, url) => {
    if (isLoginURL(url)) {
      event.preventDefault();
      openLoginPopup(url);
      return;
    }
    if (!isAllowedURL(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  contentView.webContents.setWindowOpenHandler(({ url }) => {
    if (isLoginURL(url)) {
      openLoginPopup(url);
      return { action: 'deny' };
    }
    if (isAllowedURL(url)) {
      contentView.webContents.loadURL(url);
      return { action: 'deny' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // ── Keyboard Shortcuts (F5, Ctrl+R, Ctrl+Shift+R) ──────────────
  contentView.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown') {
      if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) {
        if (input.shift) {
          contentView.webContents.reloadIgnoringCache();
        } else {
          contentView.webContents.reload();
        }
        event.preventDefault();
      }
    }
  });

  // Expose reload to tray
  app.reloadContentView = () => {
    if (contentView && !contentView.webContents.isDestroyed()) {
      contentView.webContents.reloadIgnoringCache();
    }
  };

  // ── Navigation intercept for Update Button ──────────────
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'appaction://install-update/') {
      require('electron-updater').autoUpdater.quitAndInstall(true, true);
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });

  // ── Version Polling ──────────────────────────────────────
  // Removed: CRM now natively handles update banners internally.
}

// ── Shell HTML (titlebar with icon + name) ───────────────────────────

function getShellHTML() {
  const fs = require('fs');
  const iconFile = path.join(__dirname, '../../assets/icon.png');
  let iconDataURI = '';
  try {
    const iconData = fs.readFileSync(iconFile);
    iconDataURI = `data:image/png;base64,${iconData.toString('base64')}`;
  } catch {}


  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      height: 100%;
      background: #0a0a0a;
      overflow: hidden;
      font-family: "Segoe UI", system-ui, sans-serif;
    }
    .titlebar {
      display: flex;
      align-items: center;
      height: 38px;
      padding: 0 150px 0 12px;
      -webkit-app-region: drag;
      user-select: none;
    }
    .titlebar img {
      width: 20px;
      height: 20px;
      margin-right: 8px;
      border-radius: 3px;
      -webkit-app-region: drag;
      pointer-events: none;
    }
    .titlebar span {
      font-size: 13px;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.85);
      letter-spacing: 0.2px;
    }
    .spacer {
      flex: 1;
      -webkit-app-region: drag;
    }
    .action-btn {
      display: none;
      background: rgba(0, 188, 212, 0.05);
      color: #00bcd4;
      border: 1px solid rgba(0, 188, 212, 0.3);
      padding: 5px 14px;
      border-radius: 8px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      -webkit-app-region: no-drag;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      transition: all 0.2s ease;
      margin-left: 8px;
    }
    .action-btn:hover {
      background: rgba(0, 188, 212, 0.15);
      border-color: #00bcd4;
    }
  </style>
</head>
<body>
  <div class="titlebar">
    <img src="${iconDataURI}" alt="Haxys">
    <span>Haxys Flow</span>
    <div class="spacer"></div>
    <div id="app-update-btn" class="action-btn" onclick="window.open('appaction://install-update/')">Atualizar o App</div>
  </div>
</body>
</html>`;
}

// ── Shell CSS Injection ──────────────────────────────────────────────

function injectShellCSS() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.insertCSS(`
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      background: #0a0a0a !important;
      overflow: hidden !important;
      height: 100% !important;
    }
  `).catch(() => {});
}

// ── Login Popup ──────────────────────────────────────────────────────
// Google blocks Electron-based browsers from signing in.
// Workaround: open login in a popup with mobile Chrome UA.
// Same session partition → cookies are shared.

function openLoginPopup(loginURL) {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return;
  }

  loginWindow = new BrowserWindow({
    width: 460,
    height: 720,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    parent: mainWindow,
    modal: true,
    title: 'Fazer login — Google',
    icon: path.join(__dirname, '../../assets/icon.png'),
    backgroundColor: '#202124',

    webPreferences: {
      partition: SESSION_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  loginWindow.webContents.setUserAgent(MOBILE_UA);
  loginWindow.loadURL(loginURL);

  // Auto-close when authentication is done (navigated away from accounts.google.com)
  const closeIfAuthenticated = (url, event) => {
    try {
      const parsed = new URL(url);
      if (
        parsed.hostname !== 'accounts.google.com' &&
        parsed.hostname !== 'ssl.gstatic.com' &&
        parsed.hostname !== 'apis.google.com'
      ) {
        if (event) event.preventDefault();
        if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
        // Reload content view to pick up authenticated session
        contentView.webContents.loadURL(HAXYS_URL);
      }
    } catch {}
  };

  loginWindow.webContents.on('will-navigate', (event, url) => {
    closeIfAuthenticated(url, event);
  });

  loginWindow.webContents.on('did-navigate', (_event, url) => {
    closeIfAuthenticated(url, null);
  });

  loginWindow.on('closed', () => {
    loginWindow = null;
  });

  loginWindow.setMenuBarVisibility(false);
  console.log('[HaxysFlow] Login popup opened with mobile UA');
}

// ── IPC Handlers ─────────────────────────────────────────────────────

function setupIPC() {
  ipcMain.on('window:minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  });

  ipcMain.on('window:close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  });
}
