#!/usr/bin/env node
/**
 * PUBLICA AS DUAS EDIÇÕES DE UMA VEZ.
 *
 * O pedido que originou este script é "toda atualização tem que valer para as duas". O jeito
 * de garantir isso não é lembrar de rodar dois comandos — é não existir um comando que
 * publique só uma. Por isso o build é sempre o par, e a release só é criada depois de os
 * SEIS arquivos existirem.
 *
 * A falha que ele impede é silenciosa: publicar só a pública deixa a interna sem nada para
 * ler no canal dela, e o app simplesmente para de se atualizar — sem erro, sem aviso, até
 * alguém reparar meses depois que está numa versão velha.
 *
 * Uso:  node scripts/release.mjs [--notas <arquivo.md>] [--rascunho]
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8'));
const versao = pkg.version;
const tag = `v${versao}`;
const REPO = `${pkg.build.publish.owner}/${pkg.build.publish.repo}`;

const args = process.argv.slice(2);
const arquivoDeNotas = args.includes('--notas') ? args[args.indexOf('--notas') + 1] : null;
const rascunho = args.includes('--rascunho');

function passo(texto) {
  console.log(`\n[36m▸ ${texto}[0m`);
}

function morrer(texto) {
  console.error(`\n[31m✗ ${texto}[0m\n`);
  process.exit(1);
}

function git(...argumentos) {
  return execFileSync('git', argumentos, { cwd: raiz, encoding: 'utf8' }).trim();
}

// ── Conferências antes de gastar cinco minutos empacotando ───────────

passo(`Conferindo o repositório (${REPO}, ${tag})`);

if (git('status', '--porcelain')) {
  morrer('Há alterações não commitadas. Uma release construída a partir delas não se reproduz.');
}

git('fetch', 'origin', '--tags');

if (git('tag', '--list', tag)) {
  morrer(`A tag ${tag} já existe. Suba a versão em package.json antes de publicar de novo.`);
}

const local = git('rev-parse', 'HEAD');
const remoto = git('rev-parse', 'origin/main');
if (local !== remoto) {
  morrer('HEAD e origin/main estão diferentes — dê push antes de publicar.');
}

// ── Build das duas edições ───────────────────────────────────────────

passo('Empacotando as duas edições (pública e interna)');
execSync('npm run dist', { cwd: raiz, stdio: 'inherit' });

const ESPERADOS = [
  ['pública', 'dist/publica/HaxysFlow-Setup.exe'],
  ['pública', 'dist/publica/HaxysFlow-Setup.exe.blockmap'],
  ['pública', 'dist/publica/latest.yml'],
  ['interna', 'dist/interna/HaxysFlow-Interna-Setup.exe'],
  ['interna', 'dist/interna/HaxysFlow-Interna-Setup.exe.blockmap'],
  ['interna', 'dist/interna/interna.yml'],
];

passo('Conferindo os seis arquivos');
const caminhos = [];
for (const [edicao, relativo] of ESPERADOS) {
  const caminho = join(raiz, relativo);
  if (!existsSync(caminho)) morrer(`Faltou o arquivo da edição ${edicao}: ${relativo}`);
  console.log(`  ${relativo} — ${(statSync(caminho).size / 1024 / 1024).toFixed(1)} MB`);
  caminhos.push(caminho);
}

// O canal é o que separa as duas atualizações; se ele não estiver no yml da interna, ela
// acabaria lendo o da pública e se autoinstalando por cima.
const ymlInterna = readFileSync(join(raiz, 'dist/interna/interna.yml'), 'utf8');
if (!ymlInterna.includes(`version: ${versao}`)) {
  morrer('O interna.yml não aponta para a versão deste package.json.');
}
if (!ymlInterna.includes('HaxysFlow-Interna-Setup.exe')) {
  morrer('O interna.yml aponta para o instalador errado — as edições se atropelariam.');
}

// ── Release ──────────────────────────────────────────────────────────

passo(`Criando a release ${tag}`);
const notas = arquivoDeNotas
  ? ['--notes-file', arquivoDeNotas]
  : ['--notes', `Atualização ${versao} — pública e interna.`];

execFileSync(
  'gh',
  [
    'release',
    'create',
    tag,
    '--repo',
    REPO,
    '--title',
    versao,
    ...(rascunho ? ['--draft'] : []),
    ...notas,
    ...caminhos,
  ],
  { cwd: raiz, stdio: 'inherit' },
);

console.log(`\n[32m✓ ${tag} publicada nas duas edições.[0m`);
console.log('  pública → latest.yml   ·   interna → interna.yml\n');
