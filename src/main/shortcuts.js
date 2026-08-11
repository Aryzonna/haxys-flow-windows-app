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

function unregisterShortcuts() {
  globalShortcut.unregisterAll();
  atalhoAtual = null;
}

module.exports = { registerShortcuts, reregisterShortcuts, unregisterShortcuts };
