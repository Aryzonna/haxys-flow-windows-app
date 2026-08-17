const { contextBridge, ipcRenderer } = require('electron');

// ── Spoof navigator.userAgentData (JS-level) ────────────────────────
// Google's login page checks navigator.userAgentData.brands in JavaScript.
// With contextIsolation, we can't modify the page's navigator directly from
// the preload. Instead, we inject a <script> into the DOM that runs in the
// page's main world BEFORE any page scripts execute.

(function injectBrowserSpoof() {
  try {
    // Do not run on the shell window (about:blank)
    if (window.location && window.location.protocol === 'about:') return;

    // Build version strings from the REAL Chromium version bundled in this Electron.
    // Preload runs in Node context so process.versions.chrome is available.
    const chromeVersion = (typeof process !== 'undefined' && process.versions && process.versions.chrome) ? process.versions.chrome : '134.0.6998.205';
    const chromeMajor = chromeVersion.split('.')[0];                      // e.g. "134"

    // This script runs in the PAGE'S main world (not isolated preload context).
    // It spoofs all the JS signals Google uses to detect embedded/non-Chrome browsers.
    const spoofCode = `
      (function() {
        'use strict';
        var CV  = "${chromeVersion}";
        var CMJ = "${chromeMajor}";

        // ── 1. navigator.userAgentData ─────────────────────────────────
        // Google checks brands[] to detect Electron ('Electron' brand = blocked)
        try {
          var brands = Object.freeze([
            Object.freeze({ brand: 'Google Chrome', version: CMJ }),
            Object.freeze({ brand: 'Chromium',      version: CMJ }),
            Object.freeze({ brand: 'Not?A_Brand',   version: '99'  })
          ]);
          var fullVersionList = Object.freeze([
            Object.freeze({ brand: 'Google Chrome', version: CV }),
            Object.freeze({ brand: 'Chromium',      version: CV }),
            Object.freeze({ brand: 'Not?A_Brand',   version: '99.0.0.0'  })
          ]);
          Object.defineProperty(navigator, 'userAgentData', {
            value: Object.freeze({
              brands: brands,
              mobile: false,
              platform: 'Windows',
              getHighEntropyValues: function() {
                return Promise.resolve({
                  brands: brands, fullVersionList: fullVersionList, mobile: false,
                  platform: 'Windows', platformVersion: '15.0.0',
                  architecture: 'x86', bitness: '64',
                  model: '', uaFullVersion: CV, wow64: false
                });
              },
              toJSON: function() { return { brands: brands, mobile: false, platform: 'Windows' }; }
            }),
            configurable: false, enumerable: true
          });
        } catch(e) {}

        // ── 2. window.chrome ───────────────────────────────────────────
        // THE MOST CRITICAL CHECK: Google's accounts.google.com verifies
        // window.chrome exists. In Electron it's undefined → instant block.
        try {
          if (!window.chrome) {
            Object.defineProperty(window, 'chrome', {
              value: {
                app: {
                  isInstalled: false,
                  InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
                  RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
                  getDetails: function() { return null; },
                  getIsInstalled: function() { return false; },
                  installState: function(cb) { cb('not_installed'); },
                  runningState: function() { return 'cannot_run'; }
                },
                runtime: {
                  id: undefined,
                  connect: function() {},
                  sendMessage: function() {},
                  OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', UPDATE: 'update' },
                  PlatformArch: { X86_64: 'x86-64', ARM: 'arm' },
                  PlatformOs: { WIN: 'win', MAC: 'mac', LINUX: 'linux' },
                },
                csi: function() { return { startE: Date.now(), onloadT: Date.now(), pageT: 1000, tran: 15 }; },
                loadTimes: function() {
                  return {
                    commitLoadTime: Date.now() / 1000,
                    connectionInfo: 'h2',
                    finishDocumentLoadTime: Date.now() / 1000,
                    finishLoadTime: Date.now() / 1000,
                    firstPaintAfterLoadTime: 0,
                    firstPaintTime: Date.now() / 1000,
                    navigationType: 'Other',
                    npnNegotiatedProtocol: 'h2',
                    requestTime: Date.now() / 1000,
                    startLoadTime: Date.now() / 1000,
                    wasAlternateProtocolAvailable: false,
                    wasFetchedViaSpdy: true,
                    wasNpnNegotiated: true
                  };
                }
              },
              writable: false, enumerable: true, configurable: false
            });
          }
        } catch(e) {}

        // ── 3. navigator.webdriver ────────────────────────────────────
        // Automation flag — must be false for real browser detection
        try {
          Object.defineProperty(navigator, 'webdriver', {
            get: function() { return false; },
            configurable: true
          });
        } catch(e) {}

        // ── 4. navigator.plugins ──────────────────────────────────────
        // Empty plugins array = headless browser detection signal.
        // Real Chrome has PDF viewer plugin at minimum.
        try {
          if (navigator.plugins.length === 0) {
            const pluginData = [
              { name: 'Chrome PDF Plugin',        filename: 'internal-pdf-viewer',  description: 'Portable Document Format' },
              { name: 'Chrome PDF Viewer',         filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
              { name: 'Native Client',             filename: 'internal-nacl-plugin', description: '' }
            ];
            const fakePluginArray = Object.create(PluginArray.prototype);
            pluginData.forEach(function(p, i) {
              const plugin = Object.create(Plugin.prototype);
              Object.defineProperty(plugin, 'name',        { get: function() { return p.name; } });
              Object.defineProperty(plugin, 'filename',    { get: function() { return p.filename; } });
              Object.defineProperty(plugin, 'description', { get: function() { return p.description; } });
              Object.defineProperty(plugin, 'length',      { get: function() { return 0; } });
              Object.defineProperty(fakePluginArray, i.toString(), { get: function() { return plugin; } });
            });
            Object.defineProperty(fakePluginArray, 'length', { get: function() { return pluginData.length; } });
            Object.defineProperty(navigator, 'plugins', {
              get: function() { return fakePluginArray; },
              configurable: true
            });
          }
        // ── 5. Disable WebAuthn / Passkeys ─────────────────────────────
        // We intercept navigator.credentials.get to prevent the native
        // Windows Security passkey prompt from appearing during login.
        try {
          if (navigator.credentials) {
            const originalGet = navigator.credentials.get;
            navigator.credentials.get = function(options) {
              if (options && options.publicKey) {
                return Promise.reject(new DOMException('Passkeys are disabled in this environment', 'NotAllowedError'));
              }
              return originalGet.apply(this, arguments);
            };
            
            const originalCreate = navigator.credentials.create;
            navigator.credentials.create = function(options) {
              if (options && options.publicKey) {
                return Promise.reject(new DOMException('Passkeys are disabled in this environment', 'NotAllowedError'));
              }
              return originalCreate.apply(this, arguments);
            };
          }
        } catch(e) {}

      })();
    `;

    const script = document.createElement('script');
    script.textContent = spoofCode;
    if (document.documentElement) {
      document.documentElement.prepend(script);
      script.remove();
    }
  } catch(e) {
    console.error('Failed to inject spoofCode', e);
  }
})();

// ── Expose Haxys Flow API to renderer ──────────────────────────────

/**
 * A API DE AJUSTES SÓ EXISTE NA ORIGEM DO FLOW.
 *
 * Este preload roda nas CINCO abas e também no widget flutuante — ou seja, roda dentro do
 * gemini.google.com e do labs.google, que são páginas de terceiro hospedadas na nossa
 * janela. Expor ali "apagar sessão", "desligar abas" ou "trocar o atalho global" seria
 * entregar o app a um script que não é nosso.
 *
 * `window.location` aqui é a URL que a view está carregando, e o preload roda antes de
 * qualquer script da página. O processo principal confere a origem de novo em cada handler
 * (settings.js → `ehPedidoDoFlow`): esta cerca é a primeira, não a única.
 */
const ORIGEM_DO_FLOW = 'https://flow2.haxys.com.br';
const ehOFlow = (() => {
  try {
    return window.location.origin === ORIGEM_DO_FLOW;
  } catch {
    return false;
  }
})();

const ponte = {
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  switchTab: (viewName) => ipcRenderer.send('tab:switch', viewName),
};

if (ehOFlow) {
  /**
   * A TELA DESCOBRE O QUE ESTE APP SABE FAZER PELA PRESENÇA DA FUNÇÃO, nunca pela versão.
   *
   * O Flow é carregado da web: a tela nova chega a todo mundo no deploy, mas o app só
   * atualiza quando o electron-updater terminar e a pessoa reiniciar. Nessa janela, uma tela
   * nova conversa com um preload velho. Checar versão exigiria uma tabela de "o que existe
   * em cada versão" que ninguém mantém; checar a função é sempre verdade.
   */
  ponte.app = {
    versao: () => ipcRenderer.invoke('app:versao'),
    catalogoDeAbas: () => ipcRenderer.invoke('app:abas'),
    lerAjustes: () => ipcRenderer.invoke('app:ajustes:ler'),
    gravarAjuste: (chave, valor) => ipcRenderer.invoke('app:ajustes:gravar', chave, valor),
    procurarAtualizacao: () => ipcRenderer.invoke('app:atualizacao:procurar'),
    instalarAtualizacao: () => ipcRenderer.invoke('app:atualizacao:instalar'),
    limparCache: () => ipcRenderer.invoke('app:manutencao:limpar-cache'),
    sairDasContas: () => ipcRenderer.invoke('app:manutencao:sair-das-contas'),
    abrirPastaDeDados: () => ipcRenderer.invoke('app:manutencao:abrir-pasta'),
    abrirLog: () => ipcRenderer.invoke('app:manutencao:abrir-log'),
    limparLog: () => ipcRenderer.invoke('app:manutencao:limpar-log'),
    reiniciar: () => ipcRenderer.invoke('app:reiniciar'),

    /**
     * Os atalhos do copiloto de voz, registrados no sistema inteiro em nome desta página.
     *
     * A página é quem manda as combinações porque é lá que elas são escolhidas — o ajuste
     * existe também para quem abre o Flow no navegador, onde aplicativo nenhum existe. Aqui é
     * só o registrador.
     */
    registrarAtalhosGlobais: (combinacoes) =>
      ipcRenderer.invoke('app:copiloto:atalhos', combinacoes),

    /**
     * O disparo de volta. Devolve a função que cancela a inscrição.
     *
     * O ouvinte é embrulhado para o `event` do IPC NÃO chegar à página: ele carrega o `sender`
     * e outras referências do Electron, e passá-lo adiante entregaria ao conteúdo web um
     * caminho para dentro do processo principal — que é justamente o que o `contextBridge`
     * existe para impedir.
     */
    aoDispararAtalhoGlobal: (ouvinte) => {
      if (typeof ouvinte !== 'function') return () => {};
      const embrulho = (_event, combinacao) => ouvinte(combinacao);
      ipcRenderer.on('copiloto:atalho', embrulho);
      return () => ipcRenderer.removeListener('copiloto:atalho', embrulho);
    },
  };
}

contextBridge.exposeInMainWorld('haxys', ponte);

// ── Bridge p/ abrir links externos no navegador do sistema ─────────
// O frontend (lib/openExternal) chama window.electronAPI.openExternal,
// que abre via shell.openExternal no main — sem navegar/substituir a janela.
// Importante no Flow, que allow-lista google.com para as abas Gemini/Flow.
contextBridge.exposeInMainWorld('electronAPI', {
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
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
