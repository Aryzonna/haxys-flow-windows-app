/**
 * A TELA ESCONDIDA DO JARVIS — onde mora a escuta do Jarvis quando o Flow roda neste app.
 *
 * Uma janela que ninguém vê, carregando `/jarvis-escuta` do próprio Flow: o MESMO código de escuta
 * e de voz das abas (a manutenção fica toda no Flow), só que viva o tempo inteiro — com o app
 * minimizado, na bandeja, ou com a pessoa em outra aba. As abas do Flow perguntam `jarvisEscondido()`
 * e, com `true`, não pegam o microfone: só mostram e comandam.
 *
 * O que este arquivo garante:
 *  - não dorme: `backgroundThrottling: false` (timers e áudio seguem com a janela oculta);
 *  - fala sem clique: `autoplayPolicy` liberado, porque ninguém vai clicar numa janela invisível;
 *  - volta sozinha: caiu o processo, falhou a carga, ou caiu no login (sem sessão) → tenta de novo,
 *    com espera crescente até 1 min. Fazer login numa aba do Flow chama `recarregar()` na hora.
 */
const { BrowserWindow } = require('electron');

const CAMINHO = '/jarvis-escuta';
const ESPERA_MAXIMA_MS = 60_000;

/**
 * @param {{ origem: string, webPreferences: object, userAgent: string, log?: (msg: string) => void }} opcoes
 */
function criarJarvisEscondido({ origem, webPreferences, userAgent, log = console.log }) {
  const url = new URL(CAMINHO, origem).toString();
  /** @type {BrowserWindow | null} */
  let janela = null;
  let viva = false;
  let tentativas = 0;
  let timer = null;
  let encerrado = false;

  const ehDaEscuta = (endereco) => {
    try {
      const u = new URL(endereco);
      return u.origin === new URL(origem).origin && u.pathname === CAMINHO;
    } catch {
      return false;
    }
  };

  function agendar(motivo) {
    viva = false;
    if (encerrado) return;
    clearTimeout(timer);
    const espera = Math.min(ESPERA_MAXIMA_MS, 5_000 * 2 ** Math.min(tentativas, 4));
    tentativas += 1;
    log(`[Jarvis] tela escondida fora (${motivo}); nova tentativa em ${Math.round(espera / 1000)} s`);
    timer = setTimeout(carregar, espera);
  }

  function carregar() {
    if (encerrado) return;
    if (!janela || janela.isDestroyed()) return abrir();
    janela.webContents.loadURL(url).catch(() => {});
  }

  function abrir() {
    if (encerrado) return;
    janela = new BrowserWindow({
      show: false,
      width: 480,
      height: 320,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        ...webPreferences,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
      },
    });
    const wc = janela.webContents;
    wc.setUserAgent(userAgent);

    wc.on('did-finish-load', () => {
      viva = ehDaEscuta(wc.getURL());
      if (viva) {
        tentativas = 0;
        log('[Jarvis] tela escondida no ar');
      } else {
        agendar(`parou em ${wc.getURL()}`); // sem sessão o Flow manda para o login
      }
    });
    wc.on('did-fail-load', (_e, codigo, descricao, _url, principal) => {
      if (principal) agendar(`falha ${codigo} ${descricao}`);
    });
    wc.on('render-process-gone', (_e, detalhes) => {
      agendar(`processo caiu: ${detalhes && detalhes.reason}`);
      if (janela && !janela.isDestroyed()) janela.destroy();
    });
    // Nada de abrir janela nova a partir daqui.
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    janela.on('closed', () => {
      janela = null;
      if (!encerrado) agendar('janela fechada');
    });

    wc.loadURL(url).catch(() => {});
  }

  return {
    iniciar: abrir,
    /** A escuta está carregada na página certa (logada) agora? */
    viva: () => viva && !!janela && !janela.isDestroyed(),
    /** Tentar já (ex.: a pessoa acabou de entrar na conta numa aba). */
    recarregar() {
      if (encerrado || this.viva()) return;
      tentativas = 0;
      clearTimeout(timer);
      carregar();
    },
    encerrar() {
      encerrado = true;
      viva = false;
      clearTimeout(timer);
      if (janela && !janela.isDestroyed()) janela.destroy();
      janela = null;
    },
  };
}

module.exports = { criarJarvisEscondido, CAMINHO_DA_ESCUTA: CAMINHO };
