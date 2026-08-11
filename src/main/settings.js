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
const { EDICAO, EH_INTERNA } = require('./edicao');

// A ordem aqui é a ordem das abas na barra de título.
const CATALOGO = [
  { nome: 'haxys', titulo: 'Haxys Flow', url: 'https://flow2.haxys.com.br/', fixa: true },
  { nome: 'haxyshub', titulo: 'Haxys Hub', url: 'https://hub.haxys.com.br', soInterna: true },
  { nome: 'haxyscore', titulo: 'Haxys Core', url: 'https://core.haxys.com.br', soInterna: true },
  { nome: 'gemini', titulo: 'Gemini', url: 'https://gemini.google.com' },
  { nome: 'googleflow', titulo: 'Google Flow', url: 'https://labs.google/fx/pt/tools/flow' },
];

/** O que ESTA edição tem. Todo o resto do app deriva daqui — não há segunda lista. */
const ABAS = CATALOGO.filter((a) => !a.soInterna || EH_INTERNA);

const NOMES_DAS_ABAS = ABAS.map((a) => a.nome);
const ABA_FIXA = CATALOGO.find((a) => a.fixa).nome;

const MODOS_DE_INICIO = ['window', 'maximized', 'minimized', 'tray'];
const ACOES_DE_FECHAR = ['tray', 'quit'];

const ZOOM_MINIMO = 0.5;
const ZOOM_MAXIMO = 2;

/**
 * O QUE É GRAVADO É O QUE FOI DESLIGADO, não o que está ligado — e a inversão conserta um
 * defeito real.
 *
 * Guardando a lista de LIGADAS, uma aba que não existia quando a pessoa mexeu na tela nasce
 * fora dela e fica invisível para sempre, sem erro nenhum. Acontece em dois casos que vão
 * acontecer: instalar a edição interna por cima da pública (Hub e Core não estariam na lista
 * gravada) e acrescentar uma sexta aba numa versão futura.
 *
 * Guardando as DESLIGADAS, o padrão de qualquer aba nova é aparecer, e a escolha explícita
 * de quem desligou continua valendo. As desligadas de OUTRA edição são preservadas na
 * gravação: desligar o Hub na interna não pode se perder porque o app rodou uma vez na
 * pública, onde aquela aba nem existe.
 *
 * A tela continua falando em `visibleTabs` (é o que ela já sabe pedir); a conversão é aqui.
 */
const PADROES = {
  startWithWindows: false,
  startMode: 'window',
  closeAction: 'tray',
  hiddenTabs: [],
  zoom: {},
  widgetShortcut: 'Ctrl+Shift+G',
  hardwareAcceleration: true,
};

// ── Normalização ─────────────────────────────────────────────────────

function umDe(valor, lista, padrao) {
  return lista.includes(valor) ? valor : padrao;
}

const NOMES_DO_CATALOGO = CATALOGO.map((a) => a.nome);

/**
 * Valida contra o CATÁLOGO INTEIRO, não contra as abas desta edição: rodar a edição pública
 * não pode apagar o "desliguei o Hub" de quem alterna entre as duas.
 *
 * A aba do Flow nunca entra — é ela que hospeda a tela de ajustes, e sem ela o app fica sem
 * caminho de volta (só editando o JSON na mão).
 */
function normalizarAbasOcultas(valor) {
  const lista = Array.isArray(valor) ? valor : [];
  return NOMES_DO_CATALOGO.filter((n) => n !== ABA_FIXA && lista.includes(n));
}

/** As visíveis DESTA edição, derivadas — é o que a tela recebe. */
function visiveisAPartirDeOcultas(ocultas) {
  return NOMES_DAS_ABAS.filter((n) => !ocultas.includes(n));
}

function ocultasAPartirDeVisiveis(visiveis) {
  const lista = Array.isArray(visiveis) ? visiveis : [];
  const deOutrasEdicoes = normalizarAbasOcultas(store.get('hiddenTabs', [])).filter(
    (n) => !NOMES_DAS_ABAS.includes(n),
  );
  const daqui = NOMES_DAS_ABAS.filter((n) => n !== ABA_FIXA && !lista.includes(n));
  return normalizarAbasOcultas([...deOutrasEdicoes, ...daqui]);
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
  hiddenTabs: normalizarAbasOcultas,
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
  saida.visibleTabs = visiveisAPartirDeOcultas(saida.hiddenTabs);
  saida.edicao = EDICAO;
  return saida;
}

/**
 * Grava um ajuste e devolve o estado completo já normalizado — a tela redesenha a partir do
 * que o app REALMENTE gravou, nunca do que ela mandou. É assim que "desmarquei a aba do
 * Flow" aparece como a caixa voltando sozinha, em vez de uma tela mentindo sobre o estado.
 */
function gravarAjuste(chave, valor) {
  // A tela pede em "visíveis"; o disco guarda em "ocultas". Ver o bloco em PADROES.
  if (chave === 'visibleTabs') {
    store.set('hiddenTabs', ocultasAPartirDeVisiveis(valor));
    return lerAjustes();
  }

  if (!Object.prototype.hasOwnProperty.call(PADROES, chave)) {
    throw new Error(`Ajuste desconhecido: ${chave}`);
  }
  store.set(chave, NORMALIZADORES[chave](valor));
  return lerAjustes();
}

/**
 * A 1.1.15 gravava `visibleTabs`. Convertida uma única vez, com o catálogo DESTA edição —
 * o que estava ligado continua ligado, e as abas que a edição de agora nem conhece não são
 * marcadas como escondidas.
 */
function migrarAbasLegadas() {
  if (store.has('hiddenTabs') || !store.has('visibleTabs')) return;
  store.set('hiddenTabs', ocultasAPartirDeVisiveis(store.get('visibleTabs')));
  store.delete('visibleTabs');
  console.log('[HaxysFlow] preferência de abas convertida para o formato novo');
}

migrarAbasLegadas();

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
