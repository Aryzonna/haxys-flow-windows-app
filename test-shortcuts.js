/**
 * Exercita src/main/shortcuts.js fora do Electron, com um `electron` falso.
 * Não abre janela nenhuma — só prova a regra de quem fica com cada tecla e qual navegação
 * descarta a página que a pediu.
 *
 * A REGRA DE NAVEGAÇÃO É O MOTIVO DESTE ARQUIVO EXISTIR. `did-start-navigation` dispara tanto
 * para "a página foi embora" quanto para "a página trocou de tela sem recarregar" — e tratar as
 * duas igual desregistrava o atalho global do copiloto no primeiro clique do menu do Flow, com
 * o atalho continuando a funcionar dentro da janela. Um defeito invisível no log, que só
 * aparece com o app minimizado. Os valores aqui foram medidos no Electron 35, o do app.
 */
const Module = require('module');

const registrados = new Map();
const electronFalso = {
  globalShortcut: {
    register: (combinacao, callback) => {
      if (registrados.has(combinacao)) return false; // é o que o Electron faz: uma tecla, um dono
      registrados.set(combinacao, callback);
      return true;
    },
    unregister: (combinacao) => registrados.delete(combinacao),
    unregisterAll: () => registrados.clear(),
  },
};

const load = Module._load;
Module._load = function (request, ...resto) {
  if (request === 'electron') return electronFalso;
  // Os ajustes só servem ao atalho do WIDGET, que não é o assunto daqui.
  if (request === './settings') return { lerAjustes: () => ({ widgetShortcut: '' }) };
  return load.call(this, request, ...resto);
};

const s = require('./src/main/shortcuts');

let falhas = 0;
const ok = (rotulo, condicao, extra) => {
  if (condicao) return console.log(`  ok   ${rotulo}`);
  falhas += 1;
  console.log(`  FALHA ${rotulo}${extra === undefined ? '' : ` → ${JSON.stringify(extra)}`}`);
};

/* O formato que o Electron 35 entrega no primeiro argumento de `did-start-navigation`. */
const navegacao = (isMainFrame, isSameDocument) => ({
  url: 'https://flow2.haxys.com.br/tasks',
  isMainFrame,
  isSameDocument,
});

console.log('\n— qual navegação descarta a página —');
ok(
  'trocar de tela no Flow (pushState) NÃO descarta',
  s.navegacaoDescartaPagina(navegacao(true, true)) === false,
);
ok('recarregar descarta', s.navegacaoDescartaPagina(navegacao(true, false)) === true);
ok('ir para outro endereço descarta', s.navegacaoDescartaPagina(navegacao(true, false)) === true);
ok('navegação de iframe não descarta', s.navegacaoDescartaPagina(navegacao(false, false)) === false);
ok('sem detalhes não descarta', s.navegacaoDescartaPagina(undefined) === false);

console.log('\n— uma tecla, um dono —');
const paginaA = { isDestroyed: () => false };
const paginaB = { isDestroyed: () => false };

let r = s.registrarAtalhosDoCopiloto(['Alt+X'], paginaA);
ok('a primeira página fica com a tecla', r.registrados['Alt+X'] === true);

r = s.registrarAtalhosDoCopiloto(['Alt+X'], paginaB);
ok('a segunda ouve não', r.registrados['Alt+X'] === false);

r = s.registrarAtalhosDoCopiloto(['Alt+C'], paginaA);
ok('trocar a combinação registra a nova', r.registrados['Alt+C'] === true);
ok('e solta a antiga', registrados.has('Alt+X') === false);

r = s.registrarAtalhosDoCopiloto(['Alt+X'], paginaB);
ok('aí a outra página consegue a antiga', r.registrados['Alt+X'] === true);

s.soltarAtalhosDoCopiloto(paginaB);
ok('soltar leva só as da página que morreu', registrados.has('Alt+X') === false && registrados.has('Alt+C') === true);

console.log('\n— o pedido vazio —');
r = s.registrarAtalhosDoCopiloto([], paginaA);
ok('desliga as teclas da página', registrados.size === 0);
ok('e não inventa resposta', Object.keys(r.registrados).length === 0);

console.log(`\n${falhas === 0 ? 'TUDO OK' : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
