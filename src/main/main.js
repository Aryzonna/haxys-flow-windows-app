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
  definirDestinoDoCopiloto,
  navegacaoDescartaPagina,
} = require('./shortcuts');
const {
  servicoDaAba,
  ehAbaDoFlow,
  idDeAbaDoFlow,
  ehEnderecoDoFlow,
  nomeDaAba,
  NOME_PADRAO,
  abreNaFrente,
  inserirNaOrdem,
  vizinhaAoFechar,
  podeFechar,
  vizinhaNaFila,
} = require('./abas-do-flow');
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

/**
 * id da aba → WebContentsView. Aba desligada não tem view: é esse o ganho do ajuste.
 *
 * O id de um serviço é o nome dele no catálogo. O Flow pode ter VÁRIAS abas (ver
 * abas-do-flow.js): a primeira é `haxys`, as outras `haxys:2`, `haxys:3`… — e tudo que é do
 * serviço e não da aba (zoom, ligar/desligar) passa por `servicoDaAba(id)`.
 */
const views = new Map();
let activeView = ABA_FIXA;

/** As abas do Flow na ordem da barra, o nome de cada uma e a última que esteve na tela. */
let ordemDoFlow = [];
const nomesDasAbas = new Map();
let ultimaDoFlow = ABA_FIXA;
let proximoNumeroDeAba = 2;

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

/**
 * @param {string} id a aba (ver `views`)
 * @param {{ url?: string, depoisDe?: string }} [opcoes] só para as abas do Flow: onde a aba
 *   começa e ao lado de quem ela entra na barra
 */
function criarView(id, opcoes = {}) {
  if (views.has(id)) return views.get(id);
  const aba = abaPorNome(servicoDaAba(id));
  if (!aba || !mainWindow || mainWindow.isDestroyed()) return null;

  const view = new WebContentsView({ webPreferences: VIEW_PREFS });
  views.set(id, view);

  mainWindow.contentView.addChildView(view);
  view.webContents.setUserAgent(DESKTOP_UA);
  view.setVisible(id === activeView);
  setupViewNavGuard(view, id);

  view.webContents.on('did-finish-load', () => {
    view.webContents.insertCSS(VIEW_CSS).catch(() => {});
    // O zoom é reaplicado a cada carga: no Chromium ele é por ORIGEM, então uma navegação
    // para fora do domínio devolve a página ao tamanho padrão. Sem isto, o ajuste "solta"
    // sozinho no meio do uso e parece que não foi salvo.
    aplicarZoom(id);
  });

  if (ehAbaDoFlow(id)) {
    ordemDoFlow = inserirNaOrdem(ordemDoFlow, id, opcoes.depoisDe);
    nomesDasAbas.set(id, NOME_PADRAO);
    // O nome da aba é a TELA em que ela está. Quem escreve o título é a trilha do Flow, a cada
    // troca de tela — inclusive as do roteador, que não recarregam a página.
    view.webContents.on('page-title-updated', (_event, titulo) => {
      const nome = nomeDaAba(titulo);
      if (nomesDasAbas.get(id) === nome) return;
      nomesDasAbas.set(id, nome);
      injectTabBar();
    });
  }

  view.webContents.loadURL(opcoes.url || aba.url);
  posicionarView(view);
  return view;
}

function destruirView(id) {
  const view = views.get(id);
  if (!view) return;

  // Sair de cena ANTES de destruir: desligar a aba aberta não pode deixar a janela vazia.
  if (activeView === id) {
    const destino = ehAbaDoFlow(id) ? vizinhaAoFechar(ordemDoFlow, id) : abaDoFlowEmFoco();
    activeView = destino || ABA_FIXA;
    if (ehAbaDoFlow(activeView)) ultimaDoFlow = activeView;
    const seguinte = views.get(activeView);
    if (seguinte) seguinte.setVisible(true);
  }

  views.delete(id);
  if (ehAbaDoFlow(id)) {
    ordemDoFlow = ordemDoFlow.filter((outra) => outra !== id);
    nomesDasAbas.delete(id);
    if (ultimaDoFlow === id) ultimaDoFlow = ordemDoFlow[0] || ABA_FIXA;
  }
  try {
    mainWindow.contentView.removeChildView(view);
  } catch {}
  try {
    view.webContents.close();
  } catch {}
}

/** Este serviço tem alguma aba aberta? (O Flow pode ter várias, nenhuma delas com o id `haxys`.) */
function servicoAberto(nome) {
  return [...views.keys()].some((id) => servicoDaAba(id) === nome);
}

function aplicarAbasVisiveis(visiveis) {
  for (const id of [...views.keys()]) {
    if (!visiveis.includes(servicoDaAba(id))) destruirView(id);
  }
  for (const nome of visiveis) {
    if (!servicoAberto(nome)) criarView(nome);
  }
  updateViewBounds();
  injectTabBar();
}

// ── Abas do Flow ─────────────────────────────────────────────────────

/** A aba do Flow que está na tela, ou a última que esteve. É ela que os ajustes e o copiloto usam. */
function abaDoFlowEmFoco() {
  if (ehAbaDoFlow(activeView) && views.has(activeView)) return activeView;
  if (views.has(ultimaDoFlow)) return ultimaDoFlow;
  return ordemDoFlow[0] || null;
}

/**
 * Abre uma aba nova do Flow. Sem `url`, é o botão "+": a raiz, que leva cada pessoa à
 * primeira tela que ela alcança — o app não sabe de permissão, e não precisa saber.
 */
function abrirAbaDoFlow({ url, depoisDe, naFrente = true } = {}) {
  if (url && !ehEnderecoDoFlow(url)) return null;
  const id = idDeAbaDoFlow(proximoNumeroDeAba++);
  const view = criarView(id, { url: url || HAXYS_URL, depoisDe });
  if (!view) return null;
  if (naFrente) switchToView(id);
  else injectTabBar();
  return id;
}

function fecharAbaDoFlow(id) {
  if (!podeFechar(ordemDoFlow, id)) return;
  destruirView(id);
  updateViewBounds();
  injectTabBar();
}

/** Ctrl+Tab / Ctrl+Shift+Tab — na ordem da barra, serviços inclusive. */
function irParaAbaVizinha(passo) {
  const destino = vizinhaNaFila(ordemDaBarra(), activeView, passo);
  if (destino) switchToView(destino);
}

/** A ordem em que as abas aparecem: as do Flow, depois os serviços na ordem do catálogo. */
function ordemDaBarra() {
  const servicos = ABAS.filter((a) => a.nome !== ABA_FIXA && views.has(a.nome)).map((a) => a.nome);
  return [...ordemDoFlow, ...servicos];
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
  if (ehAbaDoFlow(name)) ultimaDoFlow = name;
  for (const [nome, view] of views) view.setVisible(nome === name);
  injectTabBar();
  // O foco do teclado vai junto: sem isto, Ctrl+W logo depois de trocar agiria na aba anterior.
  const view = views.get(name);
  if (view && !view.webContents.isDestroyed()) view.webContents.focus();
}

// ── Zoom ─────────────────────────────────────────────────────────────

/** O zoom é do SERVIÇO: todas as abas do Flow têm o mesmo tamanho. */
function aplicarZoom(id) {
  const view = views.get(id);
  if (!view || view.webContents.isDestroyed()) return;
  view.webContents.setZoomFactor(zoomDaAba(servicoDaAba(id)));
}

/**
 * Ctrl+= / Ctrl+− / Ctrl+0 na aba ativa. Existe porque aqui não há barra de navegador: sem
 * isto o único caminho para mudar o tamanho seria a tela de ajustes, e ninguém procura uma
 * tela de configuração para dar um zoom.
 */
function ajustarZoomDaAtiva(passo) {
  const servico = servicoDaAba(activeView);
  const atual = zoomDaAba(servico);
  const alvo =
    passo === 0
      ? 1
      : Math.min(ZOOM_MAXIMO, Math.max(ZOOM_MINIMO, Number((atual + passo).toFixed(2))));
  gravarZoomDaAba(servico, alvo);
  for (const id of views.keys()) if (servicoDaAba(id) === servico) aplicarZoom(id);
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
      {
        // As mesmas teclas também são pegas em `before-input-event` de cada view, que é onde o
        // foco quase sempre está; o menu cobre o resto (foco na barra de abas).
        label: 'Abas',
        submenu: [
          { label: 'Nova aba do Flow', accelerator: 'CmdOrCtrl+T', click: () => abrirAbaDoFlow() },
          { label: 'Fechar aba', accelerator: 'CmdOrCtrl+W', click: () => fecharAbaDoFlow(activeView) },
          { label: 'Próxima aba', accelerator: 'Ctrl+Tab', click: () => irParaAbaVizinha(1) },
          { label: 'Aba anterior', accelerator: 'Ctrl+Shift+Tab', click: () => irParaAbaVizinha(-1) },
        ],
      },
    ])
  );
}

/**
 * As teclas de aba, de dentro da página. Devolve true quando a tecla era de aba.
 *
 * Ctrl+W numa aba que não fecha (a última do Flow, ou um serviço) é engolido mesmo assim:
 * deixá-lo passar entregaria a tecla à página, e "fechar" que às vezes faz outra coisa é pior
 * que "fechar" que às vezes não faz nada.
 */
function teclaDeAba(input) {
  if (!input.control || input.alt || input.meta) return false;
  const tecla = input.key.toLowerCase();
  if (tecla === 't' && !input.shift) {
    abrirAbaDoFlow();
    return true;
  }
  if (tecla === 'w' && !input.shift) {
    fecharAbaDoFlow(activeView);
    return true;
  }
  if (tecla === 'tab') {
    irParaAbaVizinha(input.shift ? -1 : 1);
    return true;
  }
  return false;
}

function setupViewNavGuard(view, id) {
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

  view.webContents.setWindowOpenHandler(({ url, disposition }) => {
    if (isLoginURL(url)) {
      openLoginPopup(url, view);
      return { action: 'deny' };
    }
    // Link do Flow aberto "em outro lugar" (rodinha, Ctrl+clique, target=_blank) vira ABA do
    // Flow — nunca janela, e nunca a página de outro site: a cerca é a origem exata.
    if (ehAbaDoFlow(id) && ehEnderecoDoFlow(url)) {
      abrirAbaDoFlow({ url, depoisDe: id, naFrente: abreNaFrente(disposition) });
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
      if (teclaDeAba(input)) {
        event.preventDefault();
        return;
      }
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
  // As do Flow na ordem em que foram abertas; os serviços sempre na ordem canônica do
  // catálogo — reativar uma aba não pode jogá-la para o fim da barra só porque a view dela
  // foi criada por último.
  const fechaveis = ordemDoFlow.length > 1;
  const abas = ordemDaBarra().map((id) => ({
    id,
    titulo: ehAbaDoFlow(id) ? nomesDasAbas.get(id) || NOME_PADRAO : abaPorNome(id).titulo,
    flow: ehAbaDoFlow(id),
    fechavel: ehAbaDoFlow(id) && fechaveis,
  }));

  mainWindow.webContents.executeJavaScript(`
    (function() {
      var existing = document.getElementById('haxys-tabs');
      // O botão de atualizar é ligado pelo updater DEPOIS de a barra existir. Redesenhar a barra
      // (e ela é redesenhada a cada troca de tela, porque o nome da aba muda) não pode apagá-lo.
      var antigoAtualizar = document.getElementById('app-update-btn');
      var atualizarVisivel = !!antigoAtualizar && antigoAtualizar.style.display === 'block';
      if (existing) existing.remove();

      var activeView = ${JSON.stringify(activeView)};
      var abas = ${JSON.stringify(abas)};

      function estilo(el, regras) {
        el.style.cssText = regras.join(' !important;') + ' !important';
      }

      var bar = document.createElement('div');
      bar.id = 'haxys-tabs';
      estilo(bar, [
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
      ]);

      var icon = document.createElement('img');
      icon.src = '${iconSrc}';
      estilo(icon, [
        'width: 20px',
        'height: 20px',
        'object-fit: contain',
        'display: block',
        'flex-shrink: 0',
        'margin-right: 6px',
        'pointer-events: none'
      ]);
      bar.appendChild(icon);

      // As abas do Flow encolhem quando são muitas, em vez de empurrar os botões da direita
      // para fora da janela.
      var faixa = document.createElement('div');
      estilo(faixa, [
        'display: flex',
        'align-items: center',
        'gap: 2px',
        'min-width: 0',
        'flex: 0 1 auto',
        'overflow: hidden',
        'pointer-events: none'
      ]);
      bar.appendChild(faixa);

      function makeTab(aba, active) {
        var btn = document.createElement('div');
        btn.title = aba.titulo;
        estilo(btn, [
          'display: flex',
          'align-items: center',
          'gap: 4px',
          'background: ' + (active ? 'rgba(255,255,255,0.1)' : 'transparent'),
          'color: rgba(232,234,237,' + (active ? '1' : '0.55') + ')',
          'font-family: "Segoe UI", system-ui, sans-serif',
          'font-size: 12.5px',
          'font-weight: ' + (active ? '600' : '400'),
          'padding: 5px ' + (aba.fechavel ? '6px' : '14px') + ' 5px 14px',
          'border-radius: 8px',
          'cursor: pointer',
          'height: 28px',
          'box-sizing: border-box',
          'line-height: 18px',
          'transition: background 0.15s ease, color 0.15s ease',
          'pointer-events: auto',
          '-webkit-app-region: no-drag',
          'letter-spacing: 0.1px',
          'min-width: ' + (aba.flow ? '56px' : 'auto'),
          'max-width: 200px',
          'flex: ' + (aba.flow ? '0 1 auto' : '0 0 auto'),
          'user-select: none'
        ]);

        var rotulo = document.createElement('span');
        rotulo.textContent = aba.titulo;
        estilo(rotulo, [
          'overflow: hidden',
          'text-overflow: ellipsis',
          'white-space: nowrap',
          'min-width: 0',
          'flex: 1 1 auto'
        ]);
        btn.appendChild(rotulo);

        var fechar = null;
        if (aba.fechavel) {
          fechar = document.createElement('span');
          fechar.title = 'Fechar aba (Ctrl+W)';
          fechar.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"></path></svg>';
          estilo(fechar, [
            'display: flex',
            'align-items: center',
            'justify-content: center',
            'width: 18px',
            'height: 18px',
            'flex-shrink: 0',
            'border-radius: 4px',
            'opacity: ' + (active ? '0.8' : '0'),
            'transition: opacity 0.15s ease, background 0.15s ease'
          ]);
          fechar.addEventListener('mouseenter', function() {
            this.style.setProperty('background', 'rgba(255,255,255,0.12)', 'important');
          });
          fechar.addEventListener('mouseleave', function() {
            this.style.setProperty('background', 'transparent', 'important');
          });
          fechar.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            window.haxys.closeTab(aba.id);
          });
          btn.appendChild(fechar);
        }

        btn.addEventListener('mouseenter', function() {
          if (!active) this.style.setProperty('background', 'rgba(255,255,255,0.06)', 'important');
          if (!active) this.style.setProperty('color', 'rgba(232,234,237,0.8)', 'important');
          if (fechar) fechar.style.setProperty('opacity', '0.8', 'important');
        });
        btn.addEventListener('mouseleave', function() {
          if (!active) this.style.setProperty('background', 'transparent', 'important');
          if (!active) this.style.setProperty('color', 'rgba(232,234,237,0.55)', 'important');
          if (fechar && !active) fechar.style.setProperty('opacity', '0', 'important');
        });
        btn.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          window.haxys.switchTab(aba.id);
        });
        // Rodinha na aba fecha, como em qualquer navegador. O mousedown é engolido para o
        // Chromium não entrar no modo de rolagem automática.
        btn.addEventListener('mousedown', function(e) {
          if (e.button === 1) e.preventDefault();
        });
        btn.addEventListener('auxclick', function(e) {
          if (e.button !== 1 || !aba.fechavel) return;
          e.preventDefault();
          window.haxys.closeTab(aba.id);
        });
        return btn;
      }

      function makeNova() {
        var mais = document.createElement('div');
        mais.title = 'Nova aba (Ctrl+T)';
        mais.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"></path></svg>';
        estilo(mais, [
          'display: flex',
          'align-items: center',
          'justify-content: center',
          'width: 28px',
          'height: 28px',
          'flex-shrink: 0',
          'color: rgba(232,234,237,0.55)',
          'background: transparent',
          'border-radius: 8px',
          'cursor: pointer',
          'pointer-events: auto',
          '-webkit-app-region: no-drag',
          'transition: background 0.15s ease, color 0.15s ease'
        ]);
        mais.addEventListener('mouseenter', function() {
          this.style.setProperty('background', 'rgba(255,255,255,0.06)', 'important');
          this.style.setProperty('color', 'rgba(232,234,237,0.9)', 'important');
        });
        mais.addEventListener('mouseleave', function() {
          this.style.setProperty('background', 'transparent', 'important');
          this.style.setProperty('color', 'rgba(232,234,237,0.55)', 'important');
        });
        mais.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          window.haxys.newTab();
        });
        return mais;
      }

      function makeDivisor() {
        var d = document.createElement('div');
        estilo(d, [
          'width: 1px',
          'height: 16px',
          'flex-shrink: 0',
          'margin: 0 6px',
          'background: rgba(255,255,255,0.12)'
        ]);
        return d;
      }

      // O "+" fica colado na última aba do Flow — é do Flow que ele abre — e os serviços vêm
      // depois de um divisor.
      abas.forEach(function(aba) {
        if (aba.flow) faixa.appendChild(makeTab(aba, activeView === aba.id));
      });
      bar.appendChild(makeNova());
      var servicos = abas.filter(function(a) { return !a.flow; });
      if (servicos.length) {
        bar.appendChild(makeDivisor());
        servicos.forEach(function(aba) {
          bar.appendChild(makeTab(aba, activeView === aba.id));
        });
      }

      var spacer = document.createElement('div');
      spacer.style.flex = '1';
      spacer.style.minWidth = '8px';
      bar.appendChild(spacer);

      var updateBtn = document.createElement('div');
      updateBtn.id = 'app-update-btn';
      updateBtn.textContent = 'Atualizar o App';
      estilo(updateBtn, [
        'display: ' + (atualizarVisivel ? 'block' : 'none'),
        'flex-shrink: 0',
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
      ]);
      updateBtn.addEventListener('click', function() {
        window.open('appaction://install-update/');
      });
      bar.appendChild(updateBtn);

      var refreshBtn = document.createElement('div');
      refreshBtn.id = 'app-refresh-btn';
      refreshBtn.title = 'Recarregar página (Ctrl+Shift+R)';
      refreshBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>';
      estilo(refreshBtn, [
        'display: flex',
        'align-items: center',
        'justify-content: center',
        'flex-shrink: 0',
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
      ]);

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

  /*
    Os pedidos de aba só valem vindos da BARRA (o shell). O preload que os expõe roda também
    no Gemini e no Google Flow — sem esta cerca, script de terceiro abriria e fecharia abas.
  */
  const daBarra = (event) =>
    !!mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents;

  ipcMain.on('tab:switch', (event, id) => {
    if (daBarra(event) && typeof id === 'string') switchToView(id);
  });

  ipcMain.on('tab:new', (event) => {
    if (daBarra(event)) abrirAbaDoFlow();
  });

  ipcMain.on('tab:close', (event, id) => {
    if (daBarra(event) && typeof id === 'string') fecharAbaDoFlow(id);
  });

  // O atalho global do copiloto vai para a aba do Flow que está na tela (ver shortcuts.js).
  definirDestinoDoCopiloto((paginas) => {
    const id = abaDoFlowEmFoco();
    const view = id && views.get(id);
    return view ? paginas.find((p) => p === view.webContents) : undefined;
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
   *
   * QUAL navegação descarta a página é decisão de `navegacaoDescartaPagina`, e não deste
   * arquivo: trocar de tela dentro do Flow não descarta documento nenhum, e soltar as teclas
   * ali matava o atalho global no primeiro clique do menu.
   */
  apenasDoFlow('app:copiloto:atalhos', (event, combinacoes) => {
    const sender = event.sender;
    if (!sender.__haxysAtalhosLimpando) {
      sender.__haxysAtalhosLimpando = true;
      sender.once('destroyed', () => soltarAtalhosDoCopiloto(sender));
      sender.on('did-start-navigation', (detalhes) => {
        if (navegacaoDescartaPagina(detalhes)) soltarAtalhosDoCopiloto(sender);
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
  const id = abaDoFlowEmFoco();
  if (!id) return;
  switchToView(id);
  const view = views.get(id);
  if (view && !view.webContents.isDestroyed()) {
    view.webContents.loadURL(new URL('settings/dispositivo', HAXYS_URL).toString());
  }
}
