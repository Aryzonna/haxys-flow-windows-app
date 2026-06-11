// ═══════════════════════════════════════════════════════════════════════
// Haxys Flow — Desktop App
// Electron wrapper for flow2.haxys.com.br
// ═══════════════════════════════════════════════════════════════════════

const { app, BrowserWindow, WebContentsView, ipcMain, session, shell } = require('electron');
const path = require('path');
const https = require('https');
const { createTray } = require('./tray');
const { initAutoUpdater } = require('./updater');
const { WidgetManager } = require('./widget');
const { registerShortcuts, unregisterShortcuts } = require('./shortcuts');
const {
  getMainBounds,
  setMainBounds,
  getStartWithWindows,
  setStartWithWindows,
  getLastWidgetOpen,
  setLastWidgetOpen,
} = require('./store');

// ── Constants ────────────────────────────────────────────────────────
const HAXYS_URL = 'https://flow2.haxys.com.br/';
const GEMINI_URL = 'https://gemini.google.com';
const GOOGLE_FLOW_URL = 'https://labs.google/fx/pt/tools/flow';
const SESSION_PARTITION = 'persist:haxysflow';

// Desktop Chrome User-Agent
// Dynamically build User-Agent to match the exact Chromium version
const CHROME_VERSION = process.versions.chrome;
const CHROME_MAJOR = CHROME_VERSION.split('.')[0];
const DESKTOP_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`;
const MOBILE_UA = `Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Mobile Safari/537.36`;

const SEC_CH_UA = `"Google Chrome";v="${CHROME_MAJOR}", "Chromium";v="${CHROME_MAJOR}", "Not?A_Brand";v="99"`;
const SEC_CH_UA_FULL = `"Google Chrome";v="${CHROME_VERSION}", "Chromium";v="${CHROME_VERSION}", "Not?A_Brand";v="99.0.0.0"`;

// ── State ────────────────────────────────────────────────────────────
let mainWindow = null;
let loginWindow = null;
let tray = null;
let widgetManager = null;
let isQuitting = false;
const startHidden = process.argv.some(arg => arg.includes('--hidden'));
let mainBoundsTimeout = null;

let flowView = null;
let geminiView = null;
let googleFlowView = null;
let activeView = 'haxys'; // 'haxys', 'gemini', 'googleflow'

let knownVersionTimestamp = null;
let updatePollingInterval = null;

let _iconBase64 = '';
try {
  const fs = require('fs');
  const iconBuffer = fs.readFileSync(path.join(__dirname, '../../assets/icon.png'));
  _iconBase64 = `data:image/png;base64,${iconBuffer.toString('base64')}`;
} catch (e) {}

// ── App-Level Chrome Masking ────────────────────────────────────────
// These MUST run before app.whenReady() and before any window/session is created.
app.userAgentFallback = DESKTOP_UA;
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

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
  if (widgetManager) {
    setLastWidgetOpen(widgetManager.isOpen());
  }
});

app.on('will-quit', () => {
  unregisterShortcuts();
});

app.on('window-all-closed', () => {
  // Don't quit — stay in tray
});

// ── App Ready ────────────────────────────────────────────────────────

app.whenReady().then(() => {
  configureSession();
  createMainWindow();

  widgetManager = new WidgetManager();
  tray = createTray(mainWindow, widgetManager);
  registerShortcuts(widgetManager);
  initAutoUpdater(mainWindow);

  if (getLastWidgetOpen()) {
    widgetManager.show();
  }

  setupIPC();
});

// ── Session Configuration ────────────────────────────────────────────

function configureSession() {
  const ses = session.fromPartition(SESSION_PARTITION);
  ses.setUserAgent(DESKTOP_UA);
  ses.cookies.flushStore().catch(() => {});

  ses.webRequest.onBeforeSendHeaders(
    {
      urls: [
        '*://*.google.com/*',
        '*://*.googleapis.com/*',
        '*://*.gstatic.com/*',
        '*://*.youtube.com/*',
      ],
    },
    (details, callback) => {
      const headers = details.requestHeaders;
      const isLoginReq = loginWindow && !loginWindow.isDestroyed() &&
        details.webContentsId === loginWindow.webContents.id;

      headers['User-Agent'] = isLoginReq ? MOBILE_UA : DESKTOP_UA;
      headers['sec-ch-ua'] = SEC_CH_UA;
      headers['sec-ch-ua-mobile'] = isLoginReq ? '?1' : '?0';
      headers['sec-ch-ua-platform'] = isLoginReq ? '"Android"' : '"Windows"';
      headers['sec-ch-ua-full-version-list'] = SEC_CH_UA_FULL;

      delete headers['X-Electron-Version'];
      callback({ requestHeaders: headers });
    }
  );

  console.log(`[HaxysFlow] Session configured — Chrome/${CHROME_VERSION}`);
}

// ── URL Helpers ──────────────────────────────────────────────────────

function isAllowedURL(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === 'flow2.haxys.com.br' ||
      parsed.hostname.endsWith('.haxys.com.br') ||
      parsed.hostname === 'gemini.google.com' ||
      parsed.hostname === 'labs.google' ||
      parsed.hostname === 'accounts.google.com' ||
      parsed.hostname === 'myaccount.google.com' ||
      parsed.hostname === 'accounts.youtube.com' ||
      parsed.hostname === 'ssl.gstatic.com' ||
      parsed.hostname === 'apis.google.com' ||
      parsed.hostname === 'play.google.com' ||
      parsed.hostname === 'www.google.com' ||
      parsed.hostname === 'google.com' ||
      parsed.hostname === 'oauthaccountmanager.googleapis.com' ||
      parsed.hostname === 'content-push-notifications.googleapis.com' ||
      parsed.hostname === 'gds.google.com' ||
      parsed.hostname === 'lh3.googleusercontent.com' ||
      parsed.hostname === 'aisandbox-pa.googleapis.com' ||
      parsed.hostname === 'generativelanguage.googleapis.com'
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
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.loadURL('about:blank');

  const viewPrefs = {
    preload: path.join(__dirname, '../preload/preload.js'),
    partition: SESSION_PARTITION,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    additionalArguments: ['--in-view'],
  };

  flowView = new WebContentsView({ webPreferences: viewPrefs });
  geminiView = new WebContentsView({ webPreferences: viewPrefs });
  googleFlowView = new WebContentsView({ webPreferences: viewPrefs });

  mainWindow.contentView.addChildView(flowView);
  mainWindow.contentView.addChildView(geminiView);
  mainWindow.contentView.addChildView(googleFlowView);

  flowView.webContents.setUserAgent(DESKTOP_UA);
  geminiView.webContents.setUserAgent(DESKTOP_UA);
  googleFlowView.webContents.setUserAgent(DESKTOP_UA);

  flowView.webContents.loadURL(HAXYS_URL);
  geminiView.webContents.loadURL(GEMINI_URL);
  googleFlowView.webContents.loadURL(GOOGLE_FLOW_URL);

  geminiView.setVisible(false);
  googleFlowView.setVisible(false);
  activeView = 'haxys';

  updateViewBounds();
  mainWindow.on('resize', updateViewBounds);

  flowView.webContents.once('did-finish-load', () => {
    if (!startHidden) mainWindow.show();
  });

  mainWindow.webContents.once('did-finish-load', () => {
    injectShellCSS();
    injectTabBar();
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

  // ── Navigation Guards ──────────────────────────────────────
  setupViewNavGuard(flowView);
  setupViewNavGuard(geminiView);
  setupViewNavGuard(googleFlowView);

  // Expose reload to tray
  app.reloadContentView = () => {
    if (activeView === 'haxys' && flowView) flowView.webContents.reloadIgnoringCache();
    if (activeView === 'gemini' && geminiView) geminiView.webContents.reloadIgnoringCache();
    if (activeView === 'googleflow' && googleFlowView) googleFlowView.webContents.reloadIgnoringCache();
  };

  // ── Navigation intercept for Update Button ──────────────
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'appaction://install-update/') {
      require('electron-updater').autoUpdater.quitAndInstall(true, true);
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });

  // ── View CSS ──────────────────────────────────────────────────
  const viewCSS = `
    ::-webkit-scrollbar { width: 6px !important; }
    ::-webkit-scrollbar-track { background: transparent !important; }
    ::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.15) !important;
      border-radius: 3px !important;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.25) !important;
    }
    * { scroll-behavior: smooth !important; }
    [data-install-prompt],
    [aria-label*="install"],
    [aria-label*="download app"] {
      display: none !important;
    }
  `;
  const insertViewCSS = (view) => view.webContents.on('did-finish-load', () => view.webContents.insertCSS(viewCSS).catch(() => {}));
  insertViewCSS(flowView);
  insertViewCSS(geminiView);
  insertViewCSS(googleFlowView);
}

function updateViewBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const { width, height } = mainWindow.getContentBounds();
  const viewBounds = { x: 0, y: 38, width, height: height - 38 };
  if (flowView) flowView.setBounds(viewBounds);
  if (geminiView) geminiView.setBounds(viewBounds);
  if (googleFlowView) googleFlowView.setBounds(viewBounds);
}

function switchToView(name) {
  if (name === activeView) return;
  activeView = name;
  if (flowView) flowView.setVisible(name === 'haxys');
  if (geminiView) geminiView.setVisible(name === 'gemini');
  if (googleFlowView) googleFlowView.setVisible(name === 'googleflow');
  injectTabBar();
}

function setupViewNavGuard(view) {
  view.webContents.on('will-navigate', (event, url) => {
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

  view.webContents.on('will-redirect', (event, url) => {
    if (isLoginURL(url)) {
      event.preventDefault();
      openLoginPopup(url);
    }
  });

  view.webContents.setWindowOpenHandler(({ url }) => {
    if (isLoginURL(url)) {
      openLoginPopup(url);
      return { action: 'deny' };
    }
    if (isAllowedURL(url)) {
      view.webContents.loadURL(url);
      return { action: 'deny' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  view.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown') {
      if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) {
        if (input.shift) {
          view.webContents.reloadIgnoringCache();
        } else {
          view.webContents.reload();
        }
        event.preventDefault();
      }
    }
  });
}

function injectShellCSS() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.insertCSS(`
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      background: #0a0a0a !important;
      overflow: hidden !important;
      height: 100% !important;
      font-family: "Segoe UI", system-ui, sans-serif !important;
    }
    html::before {
      content: '';
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 38px;
      -webkit-app-region: drag;
      z-index: 0;
    }
  `).catch(() => {});
}

function injectTabBar() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const iconSrc = _iconBase64;
  mainWindow.webContents.executeJavaScript(`
    (function() {
      var existing = document.getElementById('haxys-tabs');
      if (existing) existing.remove();

      var activeView = '${activeView}';

      var bar = document.createElement('div');
      bar.id = 'haxys-tabs';
      bar.style.cssText = [
        'position: fixed',
        'top: 0',
        'left: 0',
        'right: 0',
        'height: 38px',
        'display: flex',
        'align-items: center',
        'gap: 2px',
        'z-index: 2147483647',
        'padding: 0 0 0 12px',
        'pointer-events: none',
        'background: transparent'
      ].join(' !important;') + ' !important';

      var icon = document.createElement('img');
      icon.src = '${iconSrc}';
      icon.style.cssText = [
        'width: 20px',
        'height: 20px',
        'object-fit: contain',
        'display: block',
        'flex-shrink: 0',
        'margin-right: 6px',
        'pointer-events: none'
      ].join(' !important;') + ' !important';
      bar.appendChild(icon);

      function makeTab(label, viewName, active) {
        var btn = document.createElement('button');
        btn.textContent = label;
        btn.style.cssText = [
          'border: none',
          'outline: none',
          'background: ' + (active ? 'rgba(255,255,255,0.1)' : 'transparent'),
          'color: rgba(232,234,237,' + (active ? '1' : '0.55') + ')',
          'font-family: "Segoe UI", system-ui, sans-serif',
          'font-size: 12.5px',
          'font-weight: ' + (active ? '600' : '400'),
          'padding: 5px 14px',
          'border-radius: 8px',
          'cursor: pointer',
          'height: 28px',
          'line-height: 18px',
          'transition: all 0.15s ease',
          'pointer-events: auto',
          '-webkit-app-region: no-drag',
          'letter-spacing: 0.1px'
        ].join(' !important;') + ' !important';

        btn.addEventListener('mouseenter', function() {
          if (!active) this.style.setProperty('background', 'rgba(255,255,255,0.06)', 'important');
          if (!active) this.style.setProperty('color', 'rgba(232,234,237,0.8)', 'important');
        });
        btn.addEventListener('mouseleave', function() {
          if (!active) this.style.setProperty('background', 'transparent', 'important');
          if (!active) this.style.setProperty('color', 'rgba(232,234,237,0.55)', 'important');
        });
        btn.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          window.haxys.switchTab(viewName);
        });
        return btn;
      }

      bar.appendChild(makeTab('Haxys Flow', 'haxys', activeView === 'haxys'));
      bar.appendChild(makeTab('Gemini', 'gemini', activeView === 'gemini'));
      bar.appendChild(makeTab('Google Flow', 'googleflow', activeView === 'googleflow'));

      var spacer = document.createElement('div');
      spacer.style.flex = '1';
      bar.appendChild(spacer);

      var updateBtn = document.createElement('div');
      updateBtn.id = 'app-update-btn';
      updateBtn.textContent = 'Atualizar o App';
      updateBtn.style.cssText = [
        'display: none',
        'background: rgba(0, 188, 212, 0.05)',
        'color: #00bcd4',
        'border: 1px solid rgba(0, 188, 212, 0.3)',
        'padding: 5px 14px',
        'border-radius: 8px',
        'font-family: "Segoe UI", system-ui, sans-serif',
        'font-size: 11px',
        'font-weight: 600',
        'cursor: pointer',
        '-webkit-app-region: no-drag',
        'text-transform: uppercase',
        'letter-spacing: 0.5px',
        'transition: all 0.2s ease',
        'margin-right: 150px'
      ].join(' !important;') + ' !important';
      updateBtn.addEventListener('click', function() {
        window.open('appaction://install-update/');
      });
      bar.appendChild(updateBtn);

      document.documentElement.appendChild(bar);
    })();
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
        if (flowView) flowView.webContents.loadURL(HAXYS_URL);
        if (geminiView) geminiView.webContents.loadURL(GEMINI_URL);
        if (googleFlowView) googleFlowView.webContents.loadURL(GOOGLE_FLOW_URL);
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
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  });

  ipcMain.on('widget:toggle', () => {
    if (widgetManager) widgetManager.toggle();
  });

  ipcMain.on('tab:switch', (_event, viewName) => {
    switchToView(viewName);
  });
}
