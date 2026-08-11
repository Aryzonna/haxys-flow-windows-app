/**
 * Exercita src/main/settings.js fora do Electron, com um `electron` falso.
 * Não abre janela nenhuma — só prova as normalizações e a cerca de origem.
 */
const Module = require('module');
const os = require('os');
const path = require('path');
const fs = require('fs');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'haxys-prova-'));

let loginItem = null;
const electronFalso = {
  app: {
    getPath: () => userData,
    getName: () => 'haxysflow',
    getVersion: () => '1.1.15',
    setLoginItemSettings: (o) => {
      loginItem = o;
    },
  },
  globalShortcut: { register: () => true, unregister: () => {}, unregisterAll: () => {} },
};

const load = Module._load;
Module._load = function (request, ...resto) {
  if (request === 'electron') return electronFalso;
  return load.call(this, request, ...resto);
};

const base = process.argv[2] || __dirname;
const s = require(path.join(base, 'src/main/settings.js'));

let falhas = 0;
function ok(nome, condicao, extra) {
  if (condicao) {
    console.log(`  ok  ${nome}`);
  } else {
    falhas++;
    console.log(`FALHA  ${nome}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`);
  }
}

console.log('\n— padrões —');
const p = s.lerAjustes();
ok('nasce com as 5 abas', p.visibleTabs.length === 5, p.visibleTabs);
ok('nasce sem iniciar com Windows', p.startWithWindows === false);
ok('atalho padrão', p.widgetShortcut === 'Ctrl+Shift+G', p.widgetShortcut);
ok('aceleração ligada', p.hardwareAcceleration === true);

console.log('\n— a aba do Flow não pode ser desligada (senão o app fica sem tela de volta) —');
let a = s.gravarAjuste('visibleTabs', ['gemini']);
ok('força a aba fixa de volta', a.visibleTabs.includes('haxys'), a.visibleTabs);
ok('ordem canônica', a.visibleTabs.join() === 'haxys,gemini', a.visibleTabs);
a = s.gravarAjuste('visibleTabs', []);
ok('lista vazia vira só o Flow', a.visibleTabs.join() === 'haxys', a.visibleTabs);
a = s.gravarAjuste('visibleTabs', ['inventada', 'haxyshub', 'haxys']);
ok('descarta nome inventado', a.visibleTabs.join() === 'haxys,haxyshub', a.visibleTabs);
a = s.gravarAjuste('visibleTabs', 'não é lista');
ok('valor de tipo errado não quebra', a.visibleTabs.join() === 'haxys', a.visibleTabs);

console.log('\n— enums —');
ok('modo inválido cai no padrão', s.gravarAjuste('startMode', 'lixo').startMode === 'window');
ok('modo válido passa', s.gravarAjuste('startMode', 'tray').startMode === 'tray');
ok('fechar inválido cai no padrão', s.gravarAjuste('closeAction', 42).closeAction === 'tray');
ok('fechar válido passa', s.gravarAjuste('closeAction', 'quit').closeAction === 'quit');

console.log('\n— zoom —');
ok('preso no máximo', s.gravarAjuste('zoom', { haxys: 99 }).zoom.haxys === 2);
ok('preso no mínimo', s.gravarAjuste('zoom', { haxys: 0.01 }).zoom.haxys === 0.5);
ok('1 não é gravado', s.gravarAjuste('zoom', { haxys: 1 }).zoom.haxys === undefined);
ok('aba inventada é descartada', s.gravarAjuste('zoom', { nada: 1.5 }).zoom.nada === undefined);
ok('por aba', s.gravarZoomDaAba('gemini', 1.25).zoom.gemini === 1.25);
ok('zoomDaAba lê', s.zoomDaAba('gemini') === 1.25);
ok('zoomDaAba sem valor é 1', s.zoomDaAba('haxyscore') === 1);

console.log('\n— atalho (o mesmo formato que a tela gera) —');
ok('aceita o padrão', s.gravarAjuste('widgetShortcut', 'Ctrl+Alt+K').widgetShortcut === 'Ctrl+Alt+K');
ok('vazio desliga', s.gravarAjuste('widgetShortcut', '').widgetShortcut === '');
ok('lixo cai no padrão', s.gravarAjuste('widgetShortcut', 'banana').widgetShortcut === 'Ctrl+Shift+G');
ok('sem modificador cai no padrão', s.gravarAjuste('widgetShortcut', 'G').widgetShortcut === 'Ctrl+Shift+G');
ok('Super aceito', s.gravarAjuste('widgetShortcut', 'Super+Space').widgetShortcut === 'Super+Space');
ok('F-key aceito', s.gravarAjuste('widgetShortcut', 'Ctrl+F12').widgetShortcut === 'Ctrl+F12');

console.log('\n— chave desconhecida não entra no store —');
try {
  s.gravarAjuste('rm -rf', true);
  ok('recusa chave desconhecida', false);
} catch {
  ok('recusa chave desconhecida', true);
}

console.log('\n— início com o Windows —');
s.gravarAjuste('startWithWindows', true);
s.sincronizarInicioComWindows();
ok('registra no login', loginItem && loginItem.openAtLogin === true, loginItem);
ok('marca --autostart', loginItem && loginItem.args.includes('--autostart'), loginItem && loginItem.args);

console.log('\n— quem pode falar com os ajustes —');
const evento = (url) => ({ senderFrame: { url }, sender: { getURL: () => url } });
ok('Flow pode', s.ehPedidoDoFlow(evento('https://flow2.haxys.com.br/settings/dispositivo')) === true);
ok('Gemini não pode', s.ehPedidoDoFlow(evento('https://gemini.google.com/app')) === false);
ok('Hub não pode', s.ehPedidoDoFlow(evento('https://hub.haxys.com.br/')) === false);
ok('sósia não pode', s.ehPedidoDoFlow(evento('https://flow2.haxys.com.br.evil.com/')) === false);
ok('http não pode', s.ehPedidoDoFlow(evento('http://flow2.haxys.com.br/')) === false);
ok('sem quadro cai no sender', s.ehPedidoDoFlow({ senderFrame: null, sender: { getURL: () => 'https://flow2.haxys.com.br/' } }) === true);
ok('url quebrada não passa', s.ehPedidoDoFlow({ senderFrame: null, sender: { getURL: () => 'nada' } }) === false);

console.log(`\n${falhas === 0 ? 'TUDO OK' : `${falhas} FALHA(S)`}\n`);
fs.rmSync(userData, { recursive: true, force: true });
process.exit(falhas === 0 ? 0 : 1);
