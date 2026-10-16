/**
 * Exercita src/main/abas-do-flow.js fora do Electron. Não abre janela nenhuma — prova as
 * regras: que link vira aba, que nome a aba mostra, onde a aba nova entra e quem assume a
 * tela quando uma fecha.
 *
 * A CERCA É O MOTIVO PRINCIPAL DESTE ARQUIVO. As abas existem "sem nunca sair do Flow": quem
 * decide isso é `ehEnderecoDoFlow`, e um subdomínio vizinho ou um endereço parecido passando
 * por ela abriria outro site numa aba que tem a ponte do app.
 */
const Module = require('module');

const load = Module._load;
Module._load = function (request, ...resto) {
  if (request === './settings') {
    return { ABA_FIXA: 'haxys', ORIGEM_DO_FLOW: 'https://flow2.haxys.com.br' };
  }
  return load.call(this, request, ...resto);
};

const a = require('./src/main/abas-do-flow');

let falhas = 0;
const ok = (rotulo, condicao, extra) => {
  if (condicao) return console.log(`  ok   ${rotulo}`);
  falhas += 1;
  console.log(`  FALHA ${rotulo}${extra === undefined ? '' : ` → ${JSON.stringify(extra)}`}`);
};

console.log('\n— só o Flow vira aba —');
ok('tela do Flow', a.ehEnderecoDoFlow('https://flow2.haxys.com.br/tasks?x=1'));
ok('raiz do Flow', a.ehEnderecoDoFlow('https://flow2.haxys.com.br/'));
ok('subdomínio vizinho não', !a.ehEnderecoDoFlow('https://hub.haxys.com.br/'));
ok('endereço parecido não', !a.ehEnderecoDoFlow('https://flow2.haxys.com.br.golpe.com/'));
ok('http sem s não', !a.ehEnderecoDoFlow('http://flow2.haxys.com.br/'));
ok('outro site não', !a.ehEnderecoDoFlow('https://gemini.google.com/'));
ok('lixo não', !a.ehEnderecoDoFlow('não é url') && !a.ehEnderecoDoFlow(undefined));

console.log('\n— o nome da aba é a tela —');
ok('título da trilha', a.nomeDaAba('Tarefas · Haxys Flow') === 'Tarefas');
ok('nome de cliente com ponto', a.nomeDaAba('Dra. Neli · Haxys Flow') === 'Dra. Neli');
ok('genérico do site vira o nome do app', a.nomeDaAba('Haxys Flow 2.0 | AI Agency') === a.NOME_PADRAO);
ok('endereço durante a carga vira o nome do app', a.nomeDaAba('flow2.haxys.com.br/tasks') === a.NOME_PADRAO);
ok('url completa vira o nome do app', a.nomeDaAba('https://flow2.haxys.com.br/') === a.NOME_PADRAO);
ok('vazio vira o nome do app', a.nomeDaAba('') === a.NOME_PADRAO && a.nomeDaAba(undefined) === a.NOME_PADRAO);
ok('título próprio de página sem trilha fica', a.nomeDaAba('Proposta comercial') === 'Proposta comercial');
ok('sufixo sozinho vira o nome do app', a.nomeDaAba(' · Haxys Flow') === a.NOME_PADRAO);

console.log('\n— ids —');
ok('a primeira é o nome do serviço', a.idDeAbaDoFlow(1) === 'haxys');
ok('as outras ganham número', a.idDeAbaDoFlow(3) === 'haxys:3');
ok('serviço de uma aba numerada', a.servicoDaAba('haxys:3') === 'haxys');
ok('aba numerada é do Flow', a.ehAbaDoFlow('haxys:7') && a.ehAbaDoFlow('haxys'));
ok('serviço não é aba do Flow', !a.ehAbaDoFlow('gemini'));

console.log('\n— frente ou atrás —');
ok('rodinha abre atrás', a.abreNaFrente('background-tab') === false);
ok('target=_blank abre na frente', a.abreNaFrente('foreground-tab') === true);
ok('janela nova vira aba na frente', a.abreNaFrente('new-window') === true);

console.log('\n— ordem —');
ok('link entra logo depois de quem abriu', a.inserirNaOrdem(['x', 'y', 'z'], 'n', 'x').join() === 'x,n,y,z');
ok('o + entra no fim', a.inserirNaOrdem(['x', 'y'], 'n').join() === 'x,y,n');
ok('quem abriu sumiu: entra no fim', a.inserirNaOrdem(['x'], 'n', 'fantasma').join() === 'x,n');

console.log('\n— fechar —');
ok('assume a da direita', a.vizinhaAoFechar(['x', 'y', 'z'], 'y') === 'z');
ok('na ponta, assume a da esquerda', a.vizinhaAoFechar(['x', 'y', 'z'], 'z') === 'y');
ok('sozinha não tem vizinha', a.vizinhaAoFechar(['x'], 'x') === null);
ok('a última do Flow não fecha', !a.podeFechar(['x'], 'x'));
ok('com outra aberta, fecha', a.podeFechar(['x', 'y'], 'x'));
ok('serviço não fecha por aqui', !a.podeFechar(['x', 'y'], 'gemini'));

console.log('\n— Ctrl+Tab —');
ok('próxima', a.vizinhaNaFila(['x', 'y', 'z'], 'y', 1) === 'z');
ok('dá a volta para a frente', a.vizinhaNaFila(['x', 'y', 'z'], 'z', 1) === 'x');
ok('dá a volta para trás', a.vizinhaNaFila(['x', 'y', 'z'], 'x', -1) === 'z');

console.log(`\n${falhas === 0 ? 'TUDO OK' : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
