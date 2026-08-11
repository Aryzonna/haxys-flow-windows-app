/**
 * Atualização automática (electron-updater) + o que a tela de ajustes precisa saber.
 *
 * O comportamento de fundo não mudou: baixa sozinho e instala ao sair. O que faltava era
 * VOZ — a pessoa não tinha como ver a versão instalada, saber se já existe uma esperando,
 * nem forçar a checagem. Sem isso, "atualiza sozinho" é indistinguível de "parou de
 * atualizar", e a única saída era reinstalar por cima.
 */

const { EH_INTERNA } = require('./edicao');

let autoUpdater = null;
let versaoBaixada = null;
let janela = null;

/**
 * CADA EDIÇÃO TEM O SEU CANAL, e sem isso as duas se atropelam.
 *
 * As duas são publicadas na MESMA release do GitHub, cada uma com o seu arquivo de
 * atualização (`latest.yml` para a pública, `interna.yml` para a interna). Se a interna
 * lesse o `latest.yml`, o atualizador instalaria a pública por cima na primeira madrugada e
 * as abas do Hub e do Core desapareceriam sozinhas — parecendo bug, não configuração.
 *
 * O canal também é gravado no `app-update.yml` durante o build; repetir aqui é de propósito,
 * para que um pacote gerado sem a marcação não escorregue para o canal errado.
 */
function carregar() {
  if (autoUpdater) return autoUpdater;
  autoUpdater = require('electron-updater').autoUpdater;
  if (EH_INTERNA) autoUpdater.channel = 'interna';
  return autoUpdater;
}

function initAutoUpdater(mainWindow) {
  janela = mainWindow;
  try {
    const updater = carregar();

    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;

    // Check for updates on init
    updater.checkForUpdatesAndNotify();

    // Check every 4 hours
    setInterval(() => {
      updater.checkForUpdatesAndNotify();
    }, 4 * 60 * 60 * 1000);

    updater.on('update-available', (info) => {
      console.log('[HaxysFlow] atualização disponível:', info.version);
    });

    updater.on('update-downloaded', (info) => {
      versaoBaixada = info.version;
      console.log('[HaxysFlow] atualização baixada:', info.version);
      mostrarBotaoDeAtualizar();
    });

    updater.on('error', (err) => {
      console.log('[HaxysFlow] erro do atualizador:', err.message);
    });
  } catch (err) {
    console.log('[HaxysFlow] atualizador indisponível:', err.message);
  }
}

function mostrarBotaoDeAtualizar() {
  if (!janela || janela.isDestroyed()) return;
  janela.webContents
    .executeJavaScript(
      `var appUpdateBtn = document.getElementById('app-update-btn');
       if (appUpdateBtn) appUpdateBtn.style.display = 'block';`,
    )
    .catch(() => {});
}

/**
 * Procura agora e responde em UM objeto, porque quem pergunta é uma tela que precisa
 * escrever uma frase. Os quatro estados são o que a pessoa consegue distinguir na prática:
 * já tem uma pronta para instalar, está vindo uma, está em dia, ou não deu para checar.
 */
async function procurarAtualizacao() {
  if (versaoBaixada) return { estado: 'pronta', versao: versaoBaixada };

  try {
    const updater = carregar();
    const resultado = await updater.checkForUpdates();
    const versao = resultado && resultado.updateInfo ? resultado.updateInfo.version : null;

    // `downloadPromise` só vem quando há mesmo o que baixar — é o sinal mais confiável de
    // "existe versão nova", porque `updateInfo.version` também é preenchido quando a versão
    // encontrada é a que já está rodando.
    if (resultado && resultado.downloadPromise) return { estado: 'baixando', versao };
    return { estado: 'atual', versao };
  } catch (e) {
    return { estado: 'erro', mensagem: e.message };
  }
}

function instalarAtualizacao() {
  try {
    carregar().quitAndInstall(true, true);
    return { ok: true };
  } catch (e) {
    return { ok: false, mensagem: e.message };
  }
}

module.exports = { initAutoUpdater, procurarAtualizacao, instalarAtualizacao };
