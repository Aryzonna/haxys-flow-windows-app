// ═══════════════════════════════════════════════════════════════════════
// Haxys Flow — Desktop App
// Electron wrapper for flow2.haxys.com.br
// ═══════════════════════════════════════════════════════════════════════

const { app, BrowserWindow, WebContentsView, Menu, ipcMain, session, shell } = require('electron');
const path = require('path');
const https = require('https');
const { createTray } = require('./tray');
const { initAutoUpdater, procurarAtualizacao, instalarAtualizacao } = require('./updater');
const { WidgetManager } = require('./widget');
const {
  registerShortcuts,
  unregisterShortcuts,
  reregisterShortcuts,
  registrarAtalhosDoCopiloto,
  soltarAtalhosDoCopiloto,
} = require('./shortcuts');
const {
  getMainBounds,
  setMainBounds,
  getLastWidgetOpen,
  setLastWidgetOpen,
} = require('./store');
const {
  ABAS,
  ABA_FIXA,
  ZOOM_MINIMO,
  ZOOM_MAXIMO,
  lerAjustes,
  gravarAjuste,
  zoomDaAba,
  gravarZoomDaAba,
  sincronizarInicioComWindows,
  ehPedidoDoFlow,
} = require('./settings');
const { iniciarLog, caminhoDoLog, limparLog } = require('./log');
const { EDICAO } = require('./edicao');

// ── Constants ────────────────────────────────────────────────────────
const SESSION_PARTITION = 'persist:haxysflow';

// As URLs das abas moram no catálogo (settings.js) — aqui só o atalho de leitura, para não
// existir uma segunda lista que envelhece sozinha.
const abaPorNome = (nome) => ABAS.find((a) => a.nome === nome);
const HAXYS_URL = abaPorNome('haxys').url;

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
let mainBoundsTimeout = null;

/**
 * QUEM ABRIU O APP: o Windows no login, ou uma pessoa clicando no ícone?
 *
 * A distinção decide o que fazer com `startMode` — "iniciar minimizado" é sobre o login
 * automático; quem clica no ícone quer a janela na frente, sempre. `--hidden` é o argumento
 * das instalações anteriores a este ajuste e continua sendo aceito: o registro do Windows só
 * é reescrito quando alguém mexer no interruptor de novo.
 */
const arranqueAutomatico = process.argv.some(
  (arg) => arg.includes('--autostart') || arg.includes('--hidden'),
);

/** nome da aba → WebContentsView. Aba desligada não tem view: é esse o ganho do ajuste. */
const views = new Map();
let activeView = ABA_FIXA;

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

iniciarLog();
console.log(`[HaxysFlow] edição ${EDICAO} — abas: ${ABAS.map((a) => a.nome).join(', ')}`);

/**
 * ACELERAÇÃO POR HARDWARE — o único ajuste que precisa ser lido AQUI, antes do `whenReady`.
 * Depois que o app sobe, `disableHardwareAcceleration` não tem efeito nenhum; é por isso que
 * a tela avisa que este interruptor só vale depois de reiniciar, e oferece o botão.
 */
if (lerAjustes().hardwareAcceleration === false) {
  app.disableHardwareAcceleration();
  console.log('[HaxysFlow] aceleração por hardware desligada pelo ajuste do usuário');
}

// ── Single Instance Lock ─────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    // If the second instance was also launched with --hidden, do not show the window.
    // This happens if there are duplicate startup registry entries.
    const secondInstanceHidden = commandLine &&
      commandLine.some(arg => arg.includes('--hidden') || arg.includes('--autostart'));
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
  app.isQuitting = true;
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
  installAppMenu();
  configureSession();
  createMainWindow();

  widgetManager = new WidgetManager();
  tray = createTray(mainWindow, widgetManager, { abrirAjustes: abrirTelaDeAjustes });
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

  // Só as abas LIGADAS viram view. Antes as cinco subiam sempre — cinco renderers do
  // Chromium carregando cinco sites no arranque, inclusive os que a agência não usa.
  for (const nome of lerAjustes().visibleTabs) criarView(nome);

  updateViewBounds();
  mainWindow.on('resize', updateViewBounds);

  const viewDoFlow = views.get(ABA_FIXA);
  if (viewDoFlow) {
    // A janela nasce com `show: false` e só aparece quando o Flow termina de carregar, para
    // ninguém ver a tela preta do shell. Só que `did-finish-load` NÃO acontece quando a
    // carga falha — sem máquina em pé ou sem internet, o app ficaria invisível e a pessoa
    // clicaria no ícone de novo, esbarrando na trava de instância única. Daí as duas redes:
    // falhou, mostra; demorou demais, mostra.
    viewDoFlow.webContents.once('did-finish-load', () => mostrarNoArranque());
    viewDoFlow.webContents.once('did-fail-load', () => mostrarNoArranque());
    setTimeout(() => mostrarNoArranque(), 10000);
  } else {
    mostrarNoArranque();
  }

  // 'on' e não 'once': se o shell recarregar por qualquer motivo (atalho que
  // escapou, crash do renderer, reload programático), a title bar precisa ser
  // reinjetada — senão as abas e a logo somem de vez.
  mainWindow.webContents.on('did-finish-load', () => {
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

  // ── Fechar → bandeja ou sair, conforme o ajuste ────────────────
  // Até aqui o X SEMPRE escondia, e só "Sair" no menu da bandeja encerrava de verdade —
  // quem não conhecia a bandeja fechava o app e ele continuava rodando.
  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    if (lerAjustes().closeAction === 'quit') {
      isQuitting = true;
      app.quit();
      return;
    }
    e.preventDefault();
    mainWindow.hide();
  });

  // Expose reload to tray
  app.reloadContentView = () => reloadActiveView(true);

  // ── Navigation intercept for Update Button ──────────────
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'appaction://install-update/') {
      instalarAtualizacao();
      return { action: 'deny' };
    }
    if (url === 'appaction://hard-reload/') {
      if (app.reloadContentView) app.reloadContentView();
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });

}

// ── Ciclo de vida das views ──────────────────────────────────────────

const VIEW_PREFS = {
  preload: path.join(__dirname, '../preload/preload.js'),
  partition: SESSION_PARTITION,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false,
  additionalArguments: ['--in-view'],
};

const VIEW_CSS = `
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

function criarView(nome) {
  if (views.has(nome)) return views.get(nome);
  const aba = abaPorNome(nome);
  if (!aba || !mainWindow || mainWindow.isDestroyed()) return null;

  const view = new WebContentsView({ webPreferences: VIEW_PREFS });
  views.set(nome, view);

  mainWindow.contentView.addChildView(view);
  view.webContents.setUserAgent(DESKTOP_UA);
  view.setVisible(nome === activeView);
  setupViewNavGuard(view);

  view.webContents.on('did-finish-load', () => {
    view.webContents.insertCSS(VIEW_CSS).catch(() => {});
    // O zoom é reaplicado a cada carga: no Chromium ele é por ORIGEM, então uma navegação
    // para fora do domínio devolve a página ao tamanho padrão. Sem isto, o ajuste "solta"
    // sozinho no meio do uso e parece que não foi salvo.
    aplicarZoom(nome);
  });

  view.webContents.loadURL(aba.url);
  posicionarView(view);
  return view;
}

function destruirView(nome) {
  const view = views.get(nome);
  if (!view) return;

  // Sair de cena ANTES de destruir: desligar a aba aberta não pode deixar a janela vazia.
  if (activeView === nome) {
    activeView = ABA_FIXA;
    const fixa = views.get(ABA_FIXA);
    if (fixa) fixa.setVisible(true);
  }

  views.delete(nome);
  try {
    mainWindow.contentView.removeChildView(view);
  } catch {}
  try {
    view.webContents.close();
  } catch {}
}

function aplicarAbasVisiveis(visiveis) {
  for (const nome of [...views.keys()]) {
    if (!visiveis.includes(nome)) destruirView(nome);
  }
  for (const nome of visiveis) {
    if (!views.has(nome)) criarView(nome);
  }
  updateViewBounds();
  injectTabBar();
}

function posicionarView(view) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const { width, height } = mainWindow.getContentBounds();
  view.setBounds({ x: 0, y: 38, width, height: height - 38 });
}

function updateViewBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  for (const view of views.values()) posicionarView(view);
}

function switchToView(name) {
  if (name === activeView) return;
  // Aba desligada não é destino: ignorar é melhor que esconder todas e mostrar janela vazia.
  if (!views.has(name)) return;
  activeView = name;
  for (const [nome, view] of views) view.setVisible(nome === name);
  injectTabBar();
}

// ── Zoom ─────────────────────────────────────────────────────────────

function aplicarZoom(nome) {
  const view = views.get(nome);
  if (!view || view.webContents.isDestroyed()) return;
  view.webContents.setZoomFactor(zoomDaAba(nome));
}

/**
 * Ctrl+= / Ctrl+− / Ctrl+0 na aba ativa. Existe porque aqui não há barra de navegador: sem
 * isto o único caminho para mudar o tamanho seria a tela de ajustes, e ninguém procura uma
 * tela de configuração para dar um zoom.
 */
function ajustarZoomDaAtiva(passo) {
  const atual = zoomDaAba(activeView);
  const alvo =
    passo === 0
      ? 1
      : Math.min(ZOOM_MAXIMO, Math.max(ZOOM_MINIMO, Number((atual + passo).toFixed(2))));
  gravarZoomDaAba(activeView, alvo);
  aplicarZoom(activeView);
}

// ── Arranque ─────────────────────────────────────────────────────────

/**
 * "Maximizada" vale sempre; "minimizada" e "só na bandeja" valem quando foi o WINDOWS que
 * abriu o app. Quem clica no ícone está pedindo a janela — abrir minimizado nesse caso
 * parece que o clique não funcionou, e a pessoa clica de novo.
 */
let arranqueResolvido = false;

function mostrarNoArranque() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // Três gatilhos disputam esta função (carregou, falhou, estourou o tempo) e só o primeiro
  // vale: sem a trava, o tempo limite chegaria depois e DESMINIMIZARIA a janela que o modo
  // "minimizada" acabou de minimizar.
  if (arranqueResolvido) return;
  arranqueResolvido = true;

  const { startMode } = lerAjustes();
  const modo = arranqueAutomatico ? startMode : startMode === 'maximized' ? 'maximized' : 'window';

  if (modo === 'tray') return;
  if (modo === 'maximized') {
    mainWindow.maximize();
    mainWindow.show();
    return;
  }
  if (modo === 'minimized') {
    mainWindow.showInactive();
    mainWindow.minimize();
    return;
  }
  mainWindow.show();
}

// ── Reload ───────────────────────────────────────────────────────────
// A janela principal é só um shell (about:blank) que hospeda a title bar;
// o conteúdo real vive nas WebContentsView. Recarregar o shell apagaria a
// tab bar, então todo pedido de reload é redirecionado para a view ativa.

function getActiveView() {
  const view = views.get(activeView);
  return view && !view.webContents.isDestroyed() ? view : null;
}

function reloadActiveView(ignoreCache) {
  const view = getActiveView();
  if (!view) return;
  if (ignoreCache) {
    view.webContents.reloadIgnoringCache();
  } else {
    view.webContents.reload();
  }
}

function toggleActiveViewDevTools() {
  const view = getActiveView();
  if (view) view.webContents.toggleDevTools();
}

// O menu padrão do Electron liga Ctrl+R e Ctrl+Shift+R aos roles reload/
// forceReload, que agem na JANELA focada — ou seja, no shell. Substituímos o
// menu para que os atalhos recarreguem a view ativa, independente de onde o
// foco esteja. Os roles de edição continuam presentes para não perder
// copiar/colar. A barra de menu nunca aparece (titleBarStyle: 'hidden').
function installAppMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Editar',
        submenu: [
          { role: 'undo', label: 'Desfazer' },
          { role: 'redo', label: 'Refazer' },
          { type: 'separator' },
          { role: 'cut', label: 'Recortar' },
          { role: 'copy', label: 'Copiar' },
          { role: 'paste', label: 'Colar' },
          { role: 'selectAll', label: 'Selecionar tudo' },
        ],
      },
      {
        label: 'Exibir',
        submenu: [
          { label: 'Recarregar', accelerator: 'CmdOrCtrl+R', click: () => reloadActiveView(false) },
          { label: 'Recarregar', accelerator: 'F5', click: () => reloadActiveView(false) },
          { label: 'Recarregar ignorando cache', accelerator: 'CmdOrCtrl+Shift+R', click: () => reloadActiveView(true) },
          { label: 'Recarregar ignorando cache', accelerator: 'Shift+F5', click: () => reloadActiveView(true) },
          { type: 'separator' },
          // O role padrão abriria o DevTools do shell vazio; aqui vai na view ativa.
          { label: 'Ferramentas do desenvolvedor', accelerator: 'CmdOrCtrl+Shift+I', click: () => toggleActiveViewDevTools() },
          { label: 'Ferramentas do desenvolvedor', accelerator: 'F12', click: () => toggleActiveViewDevTools() },
          { type: 'separator' },
          // Zoom da VIEW ativa, não da janela: os roles padrão agiriam no shell vazio.
          { label: 'Aumentar zoom', accelerator: 'CmdOrCtrl+=', click: () => ajustarZoomDaAtiva(0.1) },
          { label: 'Aumentar zoom', accelerator: 'CmdOrCtrl+Plus', click: () => ajustarZoomDaAtiva(0.1) },
          { label: 'Diminuir zoom', accelerator: 'CmdOrCtrl+-', click: () => ajustarZoomDaAtiva(-0.1) },
          { label: 'Tamanho normal', accelerator: 'CmdOrCtrl+0', click: () => ajustarZoomDaAtiva(0) },
          { type: 'separator' },
          { role: 'togglefullscreen', label: 'Tela cheia' },
        ],
      },
    ])
  );
}

function setupViewNavGuard(view) {
  view.webContents.on('will-navigate', (event, url) => {
    if (isLoginURL(url)) {
      event.preventDefault();
      openLoginPopup(url, view);
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
      openLoginPopup(url, view);
    }
  });

  view.webContents.setWindowOpenHandler(({ url }) => {
    if (isLoginURL(url)) {
      openLoginPopup(url, view);
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
  // Sempre na ordem canônica do catálogo — reativar uma aba não pode jogá-la para o fim da
  // barra só porque a view dela foi criada por último.
  const abasVisiveis = ABAS.filter((a) => views.has(a.nome)).map((a) => ({
    nome: a.nome,
    titulo: a.titulo,
  }));

  mainWindow.webContents.executeJavaScript(`
    (function() {
      var existing = document.getElementById('haxys-tabs');
      if (existing) existing.remove();

      var activeView = '${activeView}';
      var abas = ${JSON.stringify(abasVisiveis)};

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

      abas.forEach(function(aba) {
        bar.appendChild(makeTab(aba.titulo, aba.nome, activeView === aba.nome));
      });

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
        'pointer-events: auto',
        '-webkit-app-region: no-drag',
        'text-transform: uppercase',
        'letter-spacing: 0.5px',
        'transition: all 0.2s ease',
        'margin-right: 8px'
      ].join(' !important;') + ' !important';
      updateBtn.addEventListener('click', function() {
        window.open('appaction://install-update/');
      });
      bar.appendChild(updateBtn);

      var refreshBtn = document.createElement('div');
      refreshBtn.id = 'app-refresh-btn';
      refreshBtn.title = 'Recarregar página (Ctrl+Shift+R)';
      refreshBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>';
      refreshBtn.style.cssText = [
        'display: flex',
        'align-items: center',
        'justify-content: center',
        'width: 28px',
        'height: 28px',
        'color: rgba(255, 255, 255, 0.7)',
        'background: transparent',
        'border-radius: 6px',
        'cursor: pointer',
        'pointer-events: auto',
        '-webkit-app-region: no-drag',
        'transition: background 0.2s, color 0.2s',
        'margin-right: 150px'
      ].join(' !important;') + ' !important';

      refreshBtn.addEventListener('mouseenter', function() {
        this.style.setProperty('background', 'rgba(255, 255, 255, 0.1)', 'important');
        this.style.setProperty('color', '#ffffff', 'important');
      });
      refreshBtn.addEventListener('mouseleave', function() {
        this.style.setProperty('background', 'transparent', 'important');
        this.style.setProperty('color', 'rgba(255, 255, 255, 0.7)', 'important');
      });
      refreshBtn.addEventListener('click', function() {
        window.open('appaction://hard-reload/');
      });
      bar.appendChild(refreshBtn);

      document.documentElement.appendChild(bar);
    })();
  `).catch(() => {});
}

// ── Login Popup ──────────────────────────────────────────────────────
// Google blocks Electron-based browsers from signing in.
// Workaround: open login in a popup with mobile Chrome UA.
// Same session partition → cookies are shared.

function openLoginPopup(loginURL, triggeringView) {
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
        parsed.hostname !== 'apis.google.com' &&
        parsed.hostname !== 'myaccount.google.com'
      ) {
        if (event) event.preventDefault();
        if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
        
        // Load the authenticated URL back into the view that requested it
        // This preserves the session token/cookie set in the redirect URL
        if (triggeringView) {
          triggeringView.webContents.loadURL(url);
        }
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

  // Abre links externos no navegador do sistema (bridge electronAPI.openExternal)
  ipcMain.handle('shell:openExternal', (_event, url) => {
    try {
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
        shell.openExternal(url);
      }
    } catch (e) {}
  });

  setupAjustesIPC();
}

// ── IPC dos ajustes ──────────────────────────────────────────────────

/**
 * Todo handler daqui passa por `ehPedidoDoFlow` ANTES de qualquer efeito. O preload já se
 * recusa a expor a ponte fora da origem do Flow, mas o preload roda no renderer: a checagem
 * que vale é esta, do lado onde a página não tem como mentir sobre quem é.
 */
function apenasDoFlow(canal, handler) {
  ipcMain.handle(canal, (event, ...args) => {
    if (!ehPedidoDoFlow(event)) {
      console.warn(`[HaxysFlow] ${canal} recusado: pedido veio de fora do Flow`);
      throw new Error('Origem não autorizada');
    }
    return handler(event, ...args);
  });
}

/**
 * Aplica no app o que acabou de ser gravado. Fica separado da gravação porque o mesmo efeito
 * precisa valer para quem mexe pela BANDEJA — o menu chama estas funções também.
 */
function aplicarAjustes(chave, ajustes) {
  let aviso = null;

  if (chave === 'startWithWindows') {
    sincronizarInicioComWindows(ajustes);
  }

  if (chave === 'visibleTabs') {
    aplicarAbasVisiveis(ajustes.visibleTabs);
  }

  if (chave === 'zoom') {
    for (const nome of views.keys()) aplicarZoom(nome);
  }

  if (chave === 'widgetShortcut') {
    const ok = reregisterShortcuts();
    if (!ok) {
      aviso = ajustes.widgetShortcut
        ? `Não consegui registrar ${ajustes.widgetShortcut} — outro programa já usa essa combinação.`
        : null;
    }
  }

  if (chave === 'hardwareAcceleration') {
    aviso = 'Só vale depois de reiniciar o aplicativo.';
  }

  return aviso;
}

function setupAjustesIPC() {
  apenasDoFlow('app:versao', () => ({
    versao: app.getVersion(),
    edicao: EDICAO,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  }));

  apenasDoFlow('app:abas', () => ABAS.map((a) => ({ nome: a.nome, titulo: a.titulo, fixa: !!a.fixa })));

  apenasDoFlow('app:ajustes:ler', () => lerAjustes());

  apenasDoFlow('app:ajustes:gravar', (_event, chave, valor) => {
    const ajustes = gravarAjuste(chave, valor);
    const aviso = aplicarAjustes(chave, ajustes);
    if (tray && tray.atualizarMenu) tray.atualizarMenu();
    return { ajustes, aviso };
  });

  apenasDoFlow('app:atualizacao:procurar', () => procurarAtualizacao());
  apenasDoFlow('app:atualizacao:instalar', () => instalarAtualizacao());

  apenasDoFlow('app:manutencao:limpar-cache', async () => {
    await session.fromPartition(SESSION_PARTITION).clearCache();
    return { ok: true };
  });

  /**
   * A PARTIÇÃO É UMA SÓ para as cinco abas — apagar os cookies desloga de TUDO, inclusive do
   * próprio Flow onde o botão foi clicado. Por isso o app se relança em seguida: deixar as
   * views de pé com a sessão apagada mostraria cinco telas de erro e nenhuma explicação.
   * O aviso de que isso vai acontecer é dado na tela, antes.
   */
  apenasDoFlow('app:manutencao:sair-das-contas', async () => {
    await session.fromPartition(SESSION_PARTITION).clearStorageData({
      storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage'],
    });
    reiniciarApp();
    return { ok: true };
  });

  apenasDoFlow('app:manutencao:abrir-pasta', async () => {
    await shell.openPath(app.getPath('userData'));
    return { ok: true };
  });

  apenasDoFlow('app:manutencao:abrir-log', async () => {
    const erro = await shell.openPath(caminhoDoLog());
    return { ok: !erro, mensagem: erro || null };
  });

  apenasDoFlow('app:manutencao:limpar-log', () => ({ ok: limparLog() }));

  apenasDoFlow('app:reiniciar', () => {
    reiniciarApp();
    return { ok: true };
  });

  /**
   * Os atalhos do COPILOTO, registrados em nome da página que pediu.
   *
   * `event.sender` e não a janela principal: é ele que recebe o disparo de volta, e é ele que
   * morre quando a aba recarrega. A limpeza vai junto — sem ela, recarregar o Flow deixaria a
   * combinação presa no sistema apontando para uma página que não existe mais, e o próximo
   * registro da mesma tecla seria recusado até alguém reiniciar o aplicativo.
   */
  apenasDoFlow('app:copiloto:atalhos', (event, combinacoes) => {
    const sender = event.sender;
    if (!sender.__haxysAtalhosLimpando) {
      sender.__haxysAtalhosLimpando = true;
      sender.once('destroyed', () => soltarAtalhosDoCopiloto(sender));
      sender.on('did-start-navigation', (_e, _url, _isInPlace, isMainFrame) => {
        if (isMainFrame) soltarAtalhosDoCopiloto(sender);
      });
    }
    return registrarAtalhosDoCopiloto(combinacoes, sender);
  });
}

function reiniciarApp() {
  isQuitting = true;
  app.relaunch();
  app.quit();
}

/**
 * O caminho de ida do menu da bandeja para a tela de ajustes, que mora no Flow. Vai por
 * `loadURL` mesmo (recarrega a aba): daqui não há como pedir uma navegação de cliente ao
 * roteador do Next, e o caminho de volta é a própria navegação do app.
 */
function abrirTelaDeAjustes() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show();
  mainWindow.focus();
  switchToView(ABA_FIXA);
  const view = views.get(ABA_FIXA);
  if (view && !view.webContents.isDestroyed()) {
    view.webContents.loadURL(new URL('settings/dispositivo', HAXYS_URL).toString());
  }
}
