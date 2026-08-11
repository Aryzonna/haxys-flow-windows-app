/**
 * AS DUAS EDIÇÕES DO MESMO APLICATIVO.
 *
 * `publica` é a que vai para as agências: Flow, Gemini e Google Flow.
 * `interna` é a de uso próprio: as mesmas três MAIS Haxys Hub e Haxys Core.
 *
 * É UM CÓDIGO SÓ, e essa é a exigência de verdade: toda correção precisa valer nas duas sem
 * ninguém ter que lembrar de repetir nada. Por isso a diferença é UM DADO (o catálogo de
 * abas filtrado por esta constante), nunca um arquivo separado — dois arquivos divergem no
 * terceiro mês, e o primeiro a perceber é quem estiver usando a edição menos testada.
 *
 * ── O PADRÃO É `publica`, E A DIREÇÃO IMPORTA ──
 * Quem esquecer a marcação erra para o lado seguro: a edição interna nasce sem Hub e Core
 * (some uma aba de quem sabe onde procurar) em vez de a pública nascer COM eles (as
 * ferramentas internas apareceriam na máquina do cliente). A escolha da falha é o que
 * decide o padrão.
 *
 * A variável de ambiente só vale FORA do pacote, para `npm run start:interna` durante o
 * desenvolvimento. No app instalado quem manda é o `haxysEdicao` gravado no package.json
 * pelo electron-builder (`--config.extraMetadata.haxysEdicao=…`).
 */

const { app } = require('electron');

const PUBLICA = 'publica';
const INTERNA = 'interna';

function resolver() {
  let doPacote;
  try {
    doPacote = require('../../package.json').haxysEdicao;
  } catch {
    doPacote = undefined;
  }

  const empacotado = app && typeof app.isPackaged === 'boolean' ? app.isPackaged : false;
  const doAmbiente = empacotado ? undefined : process.env.HAXYS_EDICAO;

  return (doAmbiente || doPacote) === INTERNA ? INTERNA : PUBLICA;
}

const EDICAO = resolver();

module.exports = {
  EDICAO,
  EH_INTERNA: EDICAO === INTERNA,
  PUBLICA,
  INTERNA,
};
