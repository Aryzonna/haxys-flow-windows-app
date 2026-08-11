/**
 * Exercita src/main/settings.js fora do Electron, com um `electron` falso.
 * Não abre janela nenhuma — só prova as normalizações, o modelo de abas e a cerca de origem.
 *
 * Roda as DUAS edições: a pública primeiro e, no fim, ele mesmo se relança com
 * HAXYS_EDICAO=interna. A edição é resolvida uma vez, no carregamento do módulo — num
 * processo só, dava para provar uma delas.
 */
const Module = require('module');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

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
const CAMINHO_SETTINGS = path.join(base, 'src/main/settings.js');

/*
  Fora do Electron o electron-store IGNORA o `userData` do app falso e resolve um caminho
  próprio, estável por usuário — então o run seguinte leria o que este deixou e as
  asserções de PADRÃO falhariam sozinhas (foi o que aconteceu). O estado é zerado antes e
  depois: começa como instalação nova, e não deixa rastro em quem rodou.
*/
const { store } = require(path.join(base, 'src/main/store.js'));
store.clear();

let s = require(CAMINHO_SETTINGS);

const EH_INTERNA = process.env.HAXYS_EDICAO === 'interna';
const EDICAO = EH_INTERNA ? 'interna' : 'publica';
const ABAS_ESPERADAS = EH_INTERNA
  ? ['haxys', 'haxyshub', 'haxyscore', 'gemini', 'googleflow']
  : ['haxys', 'gemini', 'googleflow'];

console.log(`\n=== edição ${EDICAO} === (store de teste: ${store.path})`);

let falhas = 0;
function ok(nome, condicao, extra) {
  if (condicao) {
    console.log(`  ok  ${nome}`);
  } else {
    falhas++;
    console.log(`FALHA  ${nome}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`);
  }
}

console.log('\n— o catálogo é o que separa as duas edições —');
const p = s.lerAjustes();
ok(`abas da edição ${EDICAO}`, p.visibleTabs.join() === ABAS_ESPERADAS.join(), p.visibleTabs);
ok('a edição viaja na leitura', p.edicao === EDICAO, p.edicao);
if (!EH_INTERNA) {
  ok('sem Hub na pública', !p.visibleTabs.includes('haxyshub'));
  ok('sem Core na pública', !p.visibleTabs.includes('haxyscore'));
}
ok('nasce sem iniciar com Windows', p.startWithWindows === false);
ok('atalho padrão', p.widgetShortcut === 'Ctrl+Shift+G', p.widgetShortcut);
ok('aceleração ligada', p.hardwareAcceleration === true);

console.log('\n— a aba do Flow não pode ser desligada (senão o app fica sem tela de volta) —');
let a = s.gravarAjuste('visibleTabs', ['gemini']);
ok('força a aba fixa de volta', a.visibleTabs.includes('haxys'), a.visibleTabs);
ok('ordem canônica', a.visibleTabs.join() === 'haxys,gemini', a.visibleTabs);
a = s.gravarAjuste('visibleTabs', []);
ok('lista vazia vira só o Flow', a.visibleTabs.join() === 'haxys', a.visibleTabs);
a = s.gravarAjuste('visibleTabs', ['inventada', 'gemini', 'haxys']);
ok('descarta nome inventado', a.visibleTabs.join() === 'haxys,gemini', a.visibleTabs);
a = s.gravarAjuste('visibleTabs', 'não é lista');
ok('valor de tipo errado não quebra', a.visibleTabs.join() === 'haxys', a.visibleTabs);

/*
  O ponto do modelo invertido: o disco guarda o que foi DESLIGADO. Aba que a edição de agora
  não conhece continua marcada como escondida — sem isso, rodar a pública uma vez apagaria o
  "desliguei o Hub" de quem alterna entre as duas.
*/
console.log('\n— o que fica gravado é o que foi desligado —');
store.set('hiddenTabs', ['haxyshub']);
a = s.gravarAjuste('visibleTabs', ABAS_ESPERADAS);
ok('tudo ligado nesta edição', a.visibleTabs.join() === ABAS_ESPERADAS.join(), a.visibleTabs);
if (EH_INTERNA) {
  ok('o Hub desligado continua desligado', a.hiddenTabs.length === 0, a.hiddenTabs);
} else {
  ok('preserva o desligado de outra edição', a.hiddenTabs.join() === 'haxyshub', a.hiddenTabs);
}
a = s.gravarAjuste('visibleTabs', ABAS_ESPERADAS.filter((n) => n !== 'googleflow'));
ok('desligar grava a oculta', a.hiddenTabs.includes('googleflow'), a.hiddenTabs);
ok('e some das visíveis', !a.visibleTabs.includes('googleflow'), a.visibleTabs);
ok('a fixa nunca é gravada como oculta', !s.gravarAjuste('visibleTabs', []).hiddenTabs.includes('haxys'));

function recarregarSettings() {
  delete require.cache[require.resolve(CAMINHO_SETTINGS)];
  s = require(CAMINHO_SETTINGS); // migração e catálogo são resolvidos no carregamento
  return s.lerAjustes();
}

/*
  A 1.1.15 tinha UMA edição, com as cinco abas — então ausência na lista gravada por ela
  significa mesmo "desliguei", e a migração tem que respeitar isso, inclusive para Hub e
  Core. Não confundir com o caso de baixo, que é outro.
*/
console.log('\n— migração do formato da 1.1.15 —');
store.clear();
store.set('visibleTabs', ['haxys', 'googleflow']); // desligou gemini (e hub/core, se os via)
const migrado = recarregarSettings();
ok('a escolha antiga sobrevive', !migrado.visibleTabs.includes('gemini'), migrado.visibleTabs);
ok('o que estava ligado continua', migrado.visibleTabs.includes('googleflow'), migrado.visibleTabs);
ok('a chave antiga é apagada', store.has('visibleTabs') === false);
if (EH_INTERNA) {
  ok('o que a 1.1.15 já mostrava e foi desligado continua desligado', !migrado.visibleTabs.includes('haxyshub'), migrado.visibleTabs);
}

/*
  ESTE é o caminho que o pedido cria: a máquina roda a edição pública (o disco fica com o
  formato novo, sem menção a Hub e Core) e a interna é instalada por cima. As abas que ela
  traz têm que APARECER — se dependessem de estar numa lista de ligadas, ficariam invisíveis
  para sempre e pareceria que a edição interna não funcionou.
*/
console.log('\n— instalar a outra edição por cima —');
store.clear();
store.set('hiddenTabs', ['googleflow']); // estado deixado pela edição pública
const trocado = recarregarSettings();
if (EH_INTERNA) {
  ok(
    'Hub e Core aparecem ao instalar a interna',
    trocado.visibleTabs.includes('haxyshub') && trocado.visibleTabs.includes('haxyscore'),
    trocado.visibleTabs,
  );
}
ok('e o que estava desligado continua desligado', !trocado.visibleTabs.includes('googleflow'), trocado.visibleTabs);

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
ok('zoomDaAba sem valor é 1', s.zoomDaAba('haxys') === 1);

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

console.log(`\n[${EDICAO}] ${falhas === 0 ? 'TUDO OK' : `${falhas} FALHA(S)`}`);
store.clear();
fs.rmSync(userData, { recursive: true, force: true });

// A pública roda primeiro e chama a interna; a interna não chama ninguém.
if (falhas === 0 && !EH_INTERNA) {
  const filho = spawnSync(process.execPath, [__filename, base], {
    stdio: 'inherit',
    env: { ...process.env, HAXYS_EDICAO: 'interna' },
  });
  process.exit(filho.status === 0 ? 0 : 1);
}

process.exit(falhas === 0 ? 0 : 1);
