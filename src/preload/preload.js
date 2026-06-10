const { contextBridge, ipcRenderer } = require('electron');

// ── Expose Haxys Flow API to renderer ──────────────────────────────
contextBridge.exposeInMainWorld('haxys', {
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  switchTab: (viewName) => ipcRenderer.send('tab:switch', viewName),
});

// ── Inject custom CSS on page load ─────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style');
  style.textContent = `
    /* Thin dark scrollbars */
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    ::-webkit-scrollbar-track {
      background: transparent;
    }
    ::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.15);
      border-radius: 4px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.25);
    }

    /* Smooth scroll */
    html {
      scroll-behavior: smooth;
    }
  `;
  document.head.appendChild(style);
});
