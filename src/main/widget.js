const { BrowserWindow } = require('electron');
const path = require('path');
const { getWidgetBounds, setWidgetBounds, setLastWidgetOpen } = require('./store');

const GEMINI_URL = 'https://gemini.google.com';
const SESSION_PARTITION = 'persist:haxysflow';

// Dynamically use the Electron's Chromium version
const CHROME_VERSION = process.versions.chrome;
const USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`;

class WidgetManager {
  constructor() {
    this.window = null;
    this._saveTimeout = null;
  }

  isOpen() {
    return this.window !== null && !this.window.isDestroyed() && this.window.isVisible();
  }

  create() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show();
      this.window.focus();
      return;
    }

    const savedBounds = getWidgetBounds() || {};

    this.window = new BrowserWindow({
      width: savedBounds.width || 420,
      height: savedBounds.height || 620,
      x: savedBounds.x,
      y: savedBounds.y,
      minWidth: 320,
      minHeight: 400,

      alwaysOnTop: true,
      frame: false,
      titleBarStyle: 'hidden',

      resizable: true,
      movable: true,
      skipTaskbar: true,
      roundedCorners: true,

      backgroundColor: '#202124',
      transparent: false,

      webPreferences: {
        preload: path.join(__dirname, '../preload/preload.js'),
        partition: SESSION_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    this.window.setAlwaysOnTop(true, 'screen-saver');
    this.window.webContents.setUserAgent(USER_AGENT);
    this.window.loadURL(GEMINI_URL);

    this.window.webContents.on('did-finish-load', () => {
      this.window.webContents.insertCSS(`
        html {
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 12px;
        }
        html::before {
          content: '';
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 48px;
          -webkit-app-region: drag;
        }
        html::after {
          content: 'Ctrl+Shift+G para fechar';
          position: fixed;
          top: 11px;
          right: 68px;
          font-family: "Google Sans", "Segoe UI", system-ui, sans-serif;
          font-size: 10px;
          color: rgba(255, 255, 255, 0.25);
          letter-spacing: 0.3px;
          pointer-events: none;
          z-index: 2147483647;
          -webkit-app-region: drag;
        }
        button, a, input, select, textarea,
        [role="button"], [role="link"], [role="menuitem"],
        [role="tab"], [role="combobox"], [role="listbox"],
        [data-tooltip], mat-icon, .mdc-icon-button,
        .gmat-mdc-button, .navigation-rail, .toolbar-actions {
          -webkit-app-region: no-drag !important;
        }
      `).catch(() => {});
    });

    const saveBounds = () => {
      clearTimeout(this._saveTimeout);
      this._saveTimeout = setTimeout(() => {
        if (this.window && !this.window.isDestroyed()) {
          const bounds = this.window.getBounds();
          setWidgetBounds(bounds);
        }
      }, 500);
    };

    this.window.on('resize', saveBounds);
    this.window.on('move', saveBounds);

    this.window.on('close', (e) => {
      if (this.window && !this.window.isDestroyed()) {
        e.preventDefault();
        this.window.hide();
        setLastWidgetOpen(false);
      }
    });

    this.window.on('closed', () => {
      this.window = null;
    });
  }

  toggle() {
    if (this.window && !this.window.isDestroyed()) {
      if (this.window.isVisible()) {
        this.hide();
      } else {
        this.show();
      }
    } else {
      this.create();
      setLastWidgetOpen(true);
    }
  }

  show() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show();
      this.window.focus();
      setLastWidgetOpen(true);
    } else {
      this.create();
      setLastWidgetOpen(true);
    }
  }

  hide() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.hide();
      setLastWidgetOpen(false);
    }
  }

  destroy() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.removeAllListeners('close');
      this.window.destroy();
      this.window = null;
      setLastWidgetOpen(false);
    }
  }
}

module.exports = { WidgetManager };
