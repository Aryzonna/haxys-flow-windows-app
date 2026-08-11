/**
 * OS AJUSTES DO APLICATIVO — fonte única, e por que ela precisa existir.
 *
 * Antes deste arquivo havia dois donos para a mesma informação: o menu da bandeja gravava
 * `startWithWindows` no store e chamava `setLoginItemSettings` na mão, e mais ninguém sabia
 * disso. Com a tela de ajustes do Flow entrando como SEGUNDO lugar que mexe nos mesmos
 * valores, duas verdades sobre o mesmo interruptor viraria bug garantido: marcar na tela e
 * ver o menu da bandeja desmarcado.
 *
 * Então tudo passa por aqui — a bandeja e a tela leem e gravam nas mesmas funções.
 *
 * ── OS VALORES VÊM DA TELA, LOGO NÃO SÃO CONFIÁVEIS ──
 * A tela roda num renderer. Todo ajuste é NORMALIZADO na entrada e na saída: enum que não
 * conhece cai no padrão, zoom é preso na faixa, e a aba do Flow é forçada de volta na lista
 * de visíveis. Esta última não é preciosismo: sem a aba do Flow não existe tela de ajustes,
 * e o app fica sem caminho de volta — só reinstalando ou editando o JSON na mão.
 */

const { app } = require('electron');
const { store } = require('./store');

// A ordem aqui é a ordem das abas na barra de título.
const ABAS = [
  { nome: 'haxys', titulo: 'Haxys Flow', url: 'https://flow2.haxys.com.br/', fixa: true },
  { nome: 'haxyshub', titulo: 'Haxys Hub', url: 'https://hub.haxys.com.br' },
  { nome: 'haxyscore', titulo: 'Haxys Core', url: 'https://core.haxys.com.br' },
  { nome: 'gemini', titulo: 'Gemini', url: 'https://gemini.google.com' },
  { nome: 'googleflow', titulo: 'Google Flow', url: 'https://labs.google/fx/pt/tools/flow' },
];

const NOMES_DAS_ABAS = ABAS.map((a) => a.nome);
const ABA_FIXA = ABAS.find((a) => a.fixa).nome;

const MODOS_DE_INICIO = ['window', 'maximized', 'minimized', 'tray'];
const ACOES_DE_FECHAR = ['tray', 'quit'];

const ZOOM_MINIMO = 0.5;
const ZOOM_MAXIMO = 2;

const PADROES = {
  startWithWindows: false,
  startMode: 'window',
  closeAction: 'tray',
  visibleTabs: NOMES_DAS_ABAS,
  zoom: {},
  widgetShortcut: 'Ctrl+Shift+G',
  hardwareAcceleration: true,
};

// ── Normalização ─────────────────────────────────────────────────────

function umDe(valor, lista, padrao) {
  return lista.includes(valor) ? valor : padrao;
}

function normalizarAbas(valor) {
  const lista = Array.isArray(valor) ? valor.filter((n) => NOMES_DAS_ABAS.includes(n)) : [];
  // A aba do Flow entra sempre: é ela que hospeda a tela que desliga as outras.
  if (!lista.includes(ABA_FIXA)) lista.unshift(ABA_FIXA);
  // Devolve na ordem canônica, não na que veio da tela.
  return NOMES_DAS_ABAS.filter((n) => lista.includes(n));
}

function normalizarZoom(valor) {
  const bruto = valor && typeof valor === 'object' ? valor : {};
  const saida = {};
  for (const nome of NOMES_DAS_ABAS) {
    const n = Number(bruto[nome]);
    if (Number.isFinite(n) && n !== 1) {
      saida[nome] = Math.min(ZOOM_MAXIMO, Math.max(ZOOM_MINIMO, n));
    }
  }
  return saida;
}

/**
 * Atalho global. String vazia = desligado, que é um estado legítimo (a pessoa pode preferir
 * a combinação livre para outro programa). Só aceita o formato de acelerador do Electron;
 * qualquer outra coisa vira desligado, porque `globalShortcut.register` LANÇA com string
 * inválida e derrubaria o arranque do app.
 */
function normalizarAtalho(valor) {
  if (typeof valor !== 'string') return PADROES.widgetShortcut;
  const limpo = valor.trim();
  if (limpo === '') return '';
  const ok = /^((Ctrl|Control|Alt|Shift|Super|CommandOrControl|CmdOrCtrl)\+){1,3}([A-Za-z0-9]|F[1-9]|F1[0-2]|Space|Tab|Backspace|Insert|Delete|Home|End|PageUp|PageDown|Up|Down|Left|Right)$/i.test(
    limpo,
  );
  return ok ? limpo : PADROES.widgetShortcut;
}

const NORMALIZADORES = {
  startWithWindows: (v) => v === true,
  startMode: (v) => umDe(v, MODOS_DE_INICIO, PADROES.startMode),
  closeAction: (v) => umDe(v, ACOES_DE_FECHAR, PADROES.closeAction),
  visibleTabs: normalizarAbas,
  zoom: normalizarZoom,
  widgetShortcut: normalizarAtalho,
  hardwareAcceleration: (v) => v !== false,
};

// ── Leitura e escrita ────────────────────────────────────────────────

function lerAjustes() {
  const saida = {};
  for (const chave of Object.keys(PADROES)) {
    saida[chave] = NORMALIZADORES[chave](store.get(chave, PADROES[chave]));
  }
  return saida;
}

/**
 * Grava um ajuste e devolve o estado completo já normalizado — a tela redesenha a partir do
 * que o app REALMENTE gravou, nunca do que ela mandou. É assim que "desmarquei a aba do
 * Flow" aparece como a caixa voltando sozinha, em vez de uma tela mentindo sobre o estado.
 */
function gravarAjuste(chave, valor) {
  if (!Object.prototype.hasOwnProperty.call(PADROES, chave)) {
    throw new Error(`Ajuste desconhecido: ${chave}`);
  }
  store.set(chave, NORMALIZADORES[chave](valor));
  return lerAjustes();
}

function zoomDaAba(nome) {
  return lerAjustes().zoom[nome] || 1;
}

function gravarZoomDaAba(nome, fator) {
  if (!NOMES_DAS_ABAS.includes(nome)) return lerAjustes();
  const zoom = { ...lerAjustes().zoom, [nome]: fator };
  return gravarAjuste('zoom', zoom);
}

// ── Arranque com o Windows ───────────────────────────────────────────

/**
 * O argumento `--autostart` é o que faz o app saber, no arranque, que quem o abriu foi o
 * Windows e não uma pessoa clicando no ícone. A distinção importa: "iniciar minimizado" vale
 * para o login automático; quem clica no ícone quer a janela na frente, sempre.
 *
 * `--hidden` continua sendo aceito na leitura (main.js) porque é o que está gravado no
 * registro das instalações anteriores a este ajuste; ele só some quando esta função rodar.
 */
function sincronizarInicioComWindows(ajustes = lerAjustes()) {
  try {
    app.setLoginItemSettings({
      openAtLogin: ajustes.startWithWindows,
      path: process.execPath,
      args: ['--autostart'],
    });
  } catch (e) {
    console.warn('[HaxysFlow] não consegui gravar o início automático:', e.message);
  }
}

// ── Quem pode falar com estes ajustes ────────────────────────────────

const ORIGEM_DO_FLOW = 'https://flow2.haxys.com.br';

/**
 * O MESMO PRELOAD RODA NAS CINCO ABAS — inclusive no gemini.google.com e no labs.google, que
 * são páginas de terceiro dentro da nossa janela, e no widget flutuante, que também é o
 * Gemini. Sem esta conferência, um script de qualquer uma delas alcançaria os ajustes do
 * app: apagar sessão, desligar abas, trocar o atalho global.
 *
 * O preload já se recusa a expor a ponte fora da origem do Flow; esta é a segunda cerca, do
 * lado de cá, onde a página não tem como mentir sobre quem é.
 */
function ehPedidoDoFlow(event) {
  try {
    const quadro = event.senderFrame;
    const url = (quadro && quadro.url) || event.sender.getURL();
    return new URL(url).origin === ORIGEM_DO_FLOW;
  } catch {
    return false;
  }
}

module.exports = {
  ABAS,
  NOMES_DAS_ABAS,
  ABA_FIXA,
  MODOS_DE_INICIO,
  ACOES_DE_FECHAR,
  ZOOM_MINIMO,
  ZOOM_MAXIMO,
  PADROES,
  lerAjustes,
  gravarAjuste,
  zoomDaAba,
  gravarZoomDaAba,
  sincronizarInicioComWindows,
  ehPedidoDoFlow,
  ORIGEM_DO_FLOW,
};
