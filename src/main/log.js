/**
 * O LOG EM ARQUIVO — existe para o botão "Ver log" da tela de ajustes ter o que abrir.
 *
 * Em desenvolvimento o `console.log` do processo principal vai para o terminal; no app
 * instalado ele não vai a lugar nenhum. Ou seja: todo aviso que este app já escreve
 * ("atalho global falhou, outro programa está usando", "não consegui gravar o início
 * automático", erro do atualizador) EXISTIA e era invisível justamente para a pessoa que
 * precisava dele. Sem arquivo, suporte remoto vira adivinhação.
 *
 * Só espelha — o `console` original continua funcionando, para não perder o terminal em
 * desenvolvimento.
 */

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const TAMANHO_MAXIMO = 1024 * 1024; // 1 MB
let caminho = null;

function caminhoDoLog() {
  if (!caminho) caminho = path.join(app.getPath('userData'), 'haxysflow.log');
  return caminho;
}

/**
 * Rotação de UM arquivo só (.log → .log.1). Dois arquivos bastam para o uso real — ninguém
 * vai ler o terceiro mais antigo — e um limite fixo impede que o log encha o disco de quem
 * deixa o app aberto por semanas.
 */
function rotacionarSePreciso(arquivo) {
  try {
    const info = fs.statSync(arquivo);
    if (info.size < TAMANHO_MAXIMO) return;
    fs.renameSync(arquivo, `${arquivo}.1`);
  } catch {
    // Não existe ainda, ou está em uso: nos dois casos seguir escrevendo é o certo.
  }
}

function escrever(nivel, args) {
  try {
    const arquivo = caminhoDoLog();
    rotacionarSePreciso(arquivo);
    const texto = args
      .map((a) => {
        if (typeof a === 'string') return a;
        if (a instanceof Error) return `${a.message}\n${a.stack || ''}`;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(' ');
    fs.appendFileSync(arquivo, `${new Date().toISOString()} [${nivel}] ${texto}\n`);
  } catch {
    // Log que derruba o app é pior que log nenhum.
  }
}

let ligado = false;

function iniciarLog() {
  if (ligado) return;
  ligado = true;

  for (const nivel of ['log', 'warn', 'error']) {
    const original = console[nivel].bind(console);
    console[nivel] = (...args) => {
      original(...args);
      escrever(nivel.toUpperCase(), args);
    };
  }

  console.log(`[HaxysFlow] versão ${app.getVersion()} — Electron ${process.versions.electron}`);
}

function limparLog() {
  try {
    fs.writeFileSync(caminhoDoLog(), '');
    try {
      fs.unlinkSync(`${caminhoDoLog()}.1`);
    } catch {}
    return true;
  } catch {
    return false;
  }
}

module.exports = { iniciarLog, caminhoDoLog, limparLog };
