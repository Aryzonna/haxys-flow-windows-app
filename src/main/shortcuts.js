const { globalShortcut } = require('electron');
const { lerAjustes } = require('./settings');

let atalhoAtual = null;
let gerente = null;

/**
 * Registra o atalho global do widget, lendo a combinação dos ajustes.
 *
 * A COMBINAÇÃO PODE SIMPLESMENTE NÃO SER NOSSA: `globalShortcut.register` devolve false
 * quando outro programa já segurou a tecla (é o sistema todo disputando, não só este app).
 * Antes isso virava um `console.warn` que ninguém lia e o atalho ficava morto sem
 * explicação — agora o retorno sobe até a tela, que consegue dizer "essa combinação já está
 * em uso" enquanto a pessoa ainda está olhando para o campo.
 *
 * @returns {boolean} true = registrado (ou desligado de propósito), false = recusado.
 */
function registerShortcuts(widgetManager) {
  if (widgetManager) gerente = widgetManager;

  const desejado = lerAjustes().widgetShortcut;

  if (atalhoAtual === desejado) return true;
  if (atalhoAtual) {
    globalShortcut.unregister(atalhoAtual);
    atalhoAtual = null;
  }

  // String vazia é estado legítimo: a pessoa pode querer a combinação livre para outro app.
  if (!desejado) {
    console.log('[HaxysFlow] atalho global do widget desligado');
    return true;
  }

  let ok = false;
  try {
    ok = globalShortcut.register(desejado, () => {
      if (gerente) gerente.toggle();
    });
  } catch (e) {
    console.warn(`[HaxysFlow] atalho global inválido (${desejado}):`, e.message);
    return false;
  }

  if (ok) {
    atalhoAtual = desejado;
    console.log(`[HaxysFlow] atalho global ${desejado} registrado`);
  } else {
    console.warn(`[HaxysFlow] atalho global ${desejado} recusado — outro programa já usa`);
  }
  return ok;
}

/** Reaplica depois que a tela troca a combinação. */
function reregisterShortcuts() {
  return registerShortcuts(null);
}

// ── Atalhos do COPILOTO, pedidos pela página ─────────────────────────────────

/**
 * Combinação → as páginas que a pediram. A TECLA é registrada uma vez só no sistema.
 *
 * ERA UMA TECLA, UM DONO — e isso quebrou com as abas do Flow. Cada aba é uma página inteira,
 * com a sua barra do topo, e cada uma pede as mesmas combinações. Com um dono só, a segunda
 * aba ouvia "não" e mostrava o aviso de que OUTRO PROGRAMA usava a tecla, que era mentira — e
 * ainda gravava a recusa nos ajustes. Agora as páginas do app compartilham a tecla, e quem
 * recebe o disparo é escolhido na hora (`definirDestinoDoCopiloto`).
 */
const atalhosDoCopiloto = new Map();

/** Entre as páginas que pediram a tecla, qual recebe o disparo. O main.js troca isto. */
let escolherDestino = (paginas) => paginas[paginas.length - 1];

/**
 * O main.js diz quem recebe: a aba do Flow que está na tela. Sem isso o disparo cairia numa
 * aba escondida, e a pessoa ligaria o copiloto numa tela que nem está vendo.
 */
function definirDestinoDoCopiloto(escolher) {
  if (typeof escolher === 'function') escolherDestino = escolher;
}

function soltarPedidosDe(webContents) {
  for (const [combinacao, paginas] of [...atalhosDoCopiloto]) {
    if (!paginas.delete(webContents) || paginas.size) continue;
    globalShortcut.unregister(combinacao);
    atalhosDoCopiloto.delete(combinacao);
  }
}

function disparar(combinacao) {
  const paginas = atalhosDoCopiloto.get(combinacao);
  if (!paginas) return;
  // A página pode ter sido descarregada (recarregamento, aba fechada) sem passar pelo caminho
  // de limpeza. Mandar para um `webContents` morto lança.
  const vivas = [...paginas].filter((p) => !p.isDestroyed());
  if (!vivas.length) return;
  const destino = escolherDestino(vivas);
  (vivas.includes(destino) ? destino : vivas[vivas.length - 1]).send('copiloto:atalho', combinacao);
}

/**
 * Registra, em nome da PÁGINA, as combinações que acionam o copiloto de voz.
 *
 * ── POR QUE ESTAS NÃO MORAM NOS AJUSTES, COMO A DO WIDGET ──────────────────────
 * A do widget é do aplicativo: ela está no `settings.json` e a ação acontece aqui dentro.
 * Estas são do copiloto, que vive na página — e a página é a única que sabe o que a pessoa
 * escolheu, porque o ajuste é editado lá (inclusive por quem abre o Flow no navegador, onde
 * aplicativo nenhum existe). Guardar uma cópia aqui criaria duas verdades sobre a mesma tecla,
 * e a divergência apareceria como "funciona com a janela aberta, não funciona minimizado".
 *
 * SUBSTITUI o conjunto anterior desta página a cada chamada: é o que faz trocar a combinação
 * na tela soltar a antiga, em vez de acumular teclas presas até alguém reiniciar o aplicativo.
 * A tecla só sai do sistema quando a ÚLTIMA página que a pedia desiste dela.
 *
 * @param {string[]} combinacoes
 * @param {Electron.WebContents} webContents quem pode receber o disparo de volta
 * @returns {{registrados: Record<string, boolean>}}
 */
function registrarAtalhosDoCopiloto(combinacoes, webContents) {
  soltarPedidosDe(webContents);

  const registrados = {};
  for (const combinacao of Array.isArray(combinacoes) ? combinacoes : []) {
    if (typeof combinacao !== 'string' || !combinacao) continue;

    // Outra página do app já segurou a tecla no sistema: esta entra na fila, e a resposta é
    // sim — a tecla É do app. "Não" fica para quando outro PROGRAMA a segura.
    const jaNoSistema = atalhosDoCopiloto.get(combinacao);
    if (jaNoSistema) {
      jaNoSistema.add(webContents);
      registrados[combinacao] = true;
      continue;
    }

    let ok = false;
    try {
      ok = globalShortcut.register(combinacao, () => disparar(combinacao));
    } catch (e) {
      console.warn(`[HaxysFlow] atalho do copiloto inválido (${combinacao}):`, e.message);
      ok = false;
    }

    if (ok) atalhosDoCopiloto.set(combinacao, new Set([webContents]));
    else console.warn(`[HaxysFlow] atalho do copiloto ${combinacao} recusado — já está em uso`);
    registrados[combinacao] = ok;
  }

  return { registrados };
}

/**
 * Esta navegação DESCARTA a página que pediu os atalhos?
 *
 * A limpeza existe para um caso só: a página sumiu sem soltar as teclas dela. Recarregamento,
 * ou uma navegação que troca o documento inteiro — aí o registro fica preso no sistema
 * apontando para um documento que não existe mais, e o próximo pedido da mesma tecla é
 * recusado até alguém reiniciar o aplicativo.
 *
 * MAS `did-start-navigation` também dispara para navegação DENTRO do mesmo documento, e é
 * assim que o Flow troca de tela: o roteador do Next chama `history.pushState`, sem recarregar
 * nada. Ali não há página para descartar — o JavaScript continua vivo e o ouvinte do atalho
 * continua inscrito. Soltar a tecla ali apaga um registro que NINGUÉM vai refazer, porque quem
 * o pediu mora na barra do topo, que não remonta ao navegar.
 *
 * O defeito que isso causava é o pior tipo: o atalho global funcionava ao abrir o app e morria
 * na primeira troca de tela, sem nada na tela e sem nada no log — dentro da janela ele
 * continuava respondendo, então parecia intermitência do sistema.
 *
 * Lê do objeto `details` (o primeiro argumento) e não dos argumentos soltos que o Electron
 * ainda manda depois dele: aqueles são o formato antigo, mantido por compatibilidade, e
 * `isSameDocument` é o nome de hoje.
 */
function navegacaoDescartaPagina(detalhes) {
  return Boolean(detalhes && detalhes.isMainFrame && !detalhes.isSameDocument);
}

/** Solta tudo que uma página havia pedido — chamado quando ela morre. */
function soltarAtalhosDoCopiloto(webContents) {
  soltarPedidosDe(webContents);
}

function unregisterShortcuts() {
  globalShortcut.unregisterAll();
  atalhoAtual = null;
  atalhosDoCopiloto.clear();
}

module.exports = {
  registerShortcuts,
  reregisterShortcuts,
  unregisterShortcuts,
  registrarAtalhosDoCopiloto,
  soltarAtalhosDoCopiloto,
  definirDestinoDoCopiloto,
  navegacaoDescartaPagina,
};
