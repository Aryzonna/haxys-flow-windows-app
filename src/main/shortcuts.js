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

/** Combinação → o `webContents` que a pediu. Uma tecla, um dono. */
const atalhosDoCopiloto = new Map();

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
 * SUBSTITUI o conjunto anterior a cada chamada: é o que faz trocar a combinação na tela soltar
 * a antiga, em vez de acumular teclas presas até alguém reiniciar o aplicativo.
 *
 * @param {string[]} combinacoes
 * @param {Electron.WebContents} webContents quem recebe o disparo de volta
 * @returns {{registrados: Record<string, boolean>}}
 */
function registrarAtalhosDoCopiloto(combinacoes, webContents) {
  // Solta o que esta mesma página tinha pedido antes. Só o dela: outra aba do app pode ter as
  // suas, e derrubar tudo faria a última tela aberta desligar o atalho das outras.
  for (const [combinacao, dono] of [...atalhosDoCopiloto]) {
    if (dono !== webContents) continue;
    globalShortcut.unregister(combinacao);
    atalhosDoCopiloto.delete(combinacao);
  }

  const registrados = {};
  for (const combinacao of Array.isArray(combinacoes) ? combinacoes : []) {
    if (typeof combinacao !== 'string' || !combinacao) continue;

    /*
      JÁ REGISTRADA POR OUTRA PÁGINA é `false`, e não uma segunda tentativa: o Electron
      devolveria false de qualquer jeito, e insistir só deixaria o log confuso. Do lado da
      tela, "outro programa usa" e "outra aba do app usa" chegam como a mesma resposta —
      que é a verdade útil: a tecla não é sua.
    */
    if (atalhosDoCopiloto.has(combinacao)) {
      registrados[combinacao] = false;
      continue;
    }

    let ok = false;
    try {
      ok = globalShortcut.register(combinacao, () => {
        const dono = atalhosDoCopiloto.get(combinacao);
        // A página pode ter sido descarregada (recarregamento, aba fechada) sem passar pelo
        // caminho de limpeza. Mandar para um `webContents` morto lança.
        if (!dono || dono.isDestroyed()) return;
        dono.send('copiloto:atalho', combinacao);
      });
    } catch (e) {
      console.warn(`[HaxysFlow] atalho do copiloto inválido (${combinacao}):`, e.message);
      ok = false;
    }

    if (ok) atalhosDoCopiloto.set(combinacao, webContents);
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
  for (const [combinacao, dono] of [...atalhosDoCopiloto]) {
    if (dono !== webContents) continue;
    globalShortcut.unregister(combinacao);
    atalhosDoCopiloto.delete(combinacao);
  }
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
  navegacaoDescartaPagina,
};
