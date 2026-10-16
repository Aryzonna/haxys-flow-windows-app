/**
 * AS ABAS DO FLOW — várias telas do Flow abertas ao mesmo tempo, sem nunca sair do Flow.
 *
 * As abas da barra eram uma por SERVIÇO (Flow, Gemini, Google Flow…). O Flow agora pode ter
 * várias, cada uma com a sua view, e só ele: os outros serviços continuam sendo uma aba só.
 *
 * ── NÃO HÁ CAMPO DE ENDEREÇO, E ISSO É A CERCA ──
 * Uma aba do Flow nasce de dois jeitos e só deles: o botão "+" (que abre a raiz, e a raiz
 * leva cada pessoa para a primeira tela que ela alcança) ou um link do PRÓPRIO Flow aberto
 * em aba nova (clique com a rodinha, Ctrl+clique, `target=_blank`). Quem decide se o link é
 * do Flow é `ehEnderecoDoFlow`, pela origem exata — subdomínio vizinho não conta.
 *
 * Este arquivo não fala com o Electron: são as regras, para o teste provar sem abrir janela.
 */

const { ABA_FIXA, ORIGEM_DO_FLOW } = require('./settings');

/**
 * O que a trilha do Flow acrescenta ao título da página (ver `Topbar` no Flow). É a marca de
 * que o título foi escrito pela trilha, e não é o genérico do site ou a URL durante a carga.
 */
const SUFIXO_DA_TRILHA = ' · Haxys Flow';
const NOME_PADRAO = 'Haxys Flow';

/** Id de uma aba do Flow: a primeira é o próprio nome do serviço, as outras ganham número. */
const SEPARADOR = ':';

function servicoDaAba(id) {
  return String(id).split(SEPARADOR)[0];
}

function ehAbaDoFlow(id) {
  return servicoDaAba(id) === ABA_FIXA;
}

function idDeAbaDoFlow(numero) {
  return numero <= 1 ? ABA_FIXA : `${ABA_FIXA}${SEPARADOR}${numero}`;
}

function ehEnderecoDoFlow(url) {
  try {
    return new URL(url).origin === ORIGEM_DO_FLOW;
  } catch {
    return false;
  }
}

/**
 * O nome que a aba mostra, a partir do título da página.
 *
 * Com o sufixo da trilha, é a tela ("Tarefas", o nome do cliente…). Sem ele, o título só
 * serve se for de verdade de uma página: o genérico do site ("Haxys Flow 2.0 | …") e o
 * endereço que o Chromium usa como título enquanto carrega diriam menos que o nome do app.
 */
function nomeDaAba(tituloDaPagina) {
  const titulo = String(tituloDaPagina || '').trim();
  const marca = SUFIXO_DA_TRILHA.trim();
  if (titulo.endsWith(marca)) {
    return titulo.slice(0, -marca.length).trim() || NOME_PADRAO;
  }
  if (!titulo || titulo.startsWith(NOME_PADRAO) || /^[a-z]+:\/\//i.test(titulo) || titulo.includes('haxys.com.br')) {
    return NOME_PADRAO;
  }
  return titulo;
}

/**
 * Link aberto em aba nova vai para a frente ou fica atrás?
 *
 * Como num navegador: rodinha e Ctrl+clique abrem ATRÁS (`background-tab`) — quem faz isso
 * está juntando telas para ver depois, e roubar a tela a cada clique atrapalharia. Link com
 * `target=_blank` e Shift+clique vão para a frente. Janela nova nunca existe aqui: vira aba.
 */
function abreNaFrente(disposition) {
  return disposition !== 'background-tab';
}

/**
 * Onde entra a aba nova na fila das do Flow: logo depois de quem abriu o link (é ali que o
 * olho está), ou no fim, para o "+".
 */
function inserirNaOrdem(ordem, id, depoisDe) {
  const i = depoisDe ? ordem.indexOf(depoisDe) : -1;
  if (i < 0) return [...ordem, id];
  return [...ordem.slice(0, i + 1), id, ...ordem.slice(i + 1)];
}

/**
 * Quem assume a tela quando a aba ativa fecha: a da direita; sem ela, a da esquerda.
 * `null` quando não há outra — e a última aba do Flow não fecha (ver `podeFechar`).
 */
function vizinhaAoFechar(ordem, id) {
  const i = ordem.indexOf(id);
  if (i < 0) return null;
  return ordem[i + 1] || ordem[i - 1] || null;
}

/**
 * A última aba do Flow não fecha: é nela que mora a tela de ajustes do app, e sem ela a
 * janela ficaria só com serviços de terceiro e nenhum caminho de volta (o "+" resolveria,
 * mas uma barra sem Flow nenhum parece defeito).
 */
function podeFechar(ordem, id) {
  return ordem.length > 1 && ordem.includes(id);
}

/** Ctrl+Tab e Ctrl+Shift+Tab: a próxima da fila, dando a volta. */
function vizinhaNaFila(ordem, id, passo) {
  if (!ordem.length) return null;
  const i = ordem.indexOf(id);
  if (i < 0) return ordem[0];
  return ordem[(i + passo + ordem.length) % ordem.length];
}

module.exports = {
  SUFIXO_DA_TRILHA,
  NOME_PADRAO,
  servicoDaAba,
  ehAbaDoFlow,
  idDeAbaDoFlow,
  ehEnderecoDoFlow,
  nomeDaAba,
  abreNaFrente,
  inserirNaOrdem,
  vizinhaAoFechar,
  podeFechar,
  vizinhaNaFila,
};
