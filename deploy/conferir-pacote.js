// Confere o zip da loja contra a pasta, em qualquer máquina (V3, 07/10). O empacotar.ps1 só roda no Windows; este script refaz as
// conferências dele sem gerar nada:
//   a) a pasta extension-copiloto/ só tem itens da lista fechada ($dentro) ou dos de fora ($fora) do empacotar.ps1;
//   b) o zip tem exatamente os arquivos de $dentro, iguais byte a byte aos da pasta, com caminhos em "/";
//   c) nada fora de .js .html .css .json .png no zip; em icons/, só .png;
//   d) o manifest do zip é da versão pedida e o SHA-256 do zip é o anotado no VERSOES.md.
// Uso: node deploy/conferir-pacote.js            (a versão do manifest.json)
//      node deploy/conferir-pacote.js 3.3.0
// Sem dependências: lê o zip com o zlib do próprio Node.
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const RAIZ = path.join(__dirname, '..'), EXT = path.join(RAIZ, 'extension-copiloto'), LOJA = path.join(__dirname, 'copiloto-chrome-web-store');

// Lê o diretório central do zip: { 'caminho': Buffer } (pastas ficam de fora).
function leZip(b) {
    let fim = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (b.readUInt32LE(i) === 0x06054b50) { fim = i; break; }
    if (fim < 0) throw new Error('zip sem diretório central');
    const total = b.readUInt16LE(fim + 10), arquivos = {};
    let p = b.readUInt32LE(fim + 16);
    for (let n = 0; n < total; n++) {
        if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('zip corrompido no diretório central');
        const metodo = b.readUInt16LE(p + 10), comprimido = b.readUInt32LE(p + 20);
        const lNome = b.readUInt16LE(p + 28), lExtra = b.readUInt16LE(p + 30), lComent = b.readUInt16LE(p + 32), local = b.readUInt32LE(p + 42);
        const nome = b.toString('utf8', p + 46, p + 46 + lNome);
        p += 46 + lNome + lExtra + lComent;
        if (nome.endsWith('/')) continue;
        const ini = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28), dado = b.subarray(ini, ini + comprimido);
        if (metodo === 0) arquivos[nome] = Buffer.from(dado);
        else if (metodo === 8) arquivos[nome] = zlib.inflateRawSync(dado);
        else throw new Error(nome + ': compressão ' + metodo + ' não suportada');
    }
    return arquivos;
}

let falhas = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) falhas++; };

const ps1 = fs.readFileSync(path.join(LOJA, 'empacotar.ps1'), 'utf8');
const lista = nome => { const m = new RegExp('^\\$' + nome + ' = @\\(([^)]*)\\)', 'm').exec(ps1); return m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : []; };
const dentro = lista('dentro'), fora = lista('fora');
const versao = process.argv[2] || JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(versao)) { console.error('uso: node deploy/conferir-pacote.js [X.Y.Z]'); process.exit(2); }
const nomeZip = 'copiloto-v' + versao + '.zip', arqZip = path.join(LOJA, nomeZip);

console.log('a) a pasta × a lista fechada do empacotar.ps1');
ok(dentro.length > 20, '$dentro lido (' + dentro.length + ' itens) e $fora (' + fora.length + ')');
const naPasta = fs.readdirSync(EXT);
const estranhos = naPasta.filter(n => dentro.indexOf(n) < 0 && fora.indexOf(n) < 0);
ok(!estranhos.length, 'nenhum item da pasta fora das duas listas' + (estranhos.length ? ' — decida: ' + estranhos.join(', ') : ''));
const faltam = dentro.filter(n => naPasta.indexOf(n) < 0);
ok(!faltam.length, 'todos os itens de $dentro existem na pasta' + (faltam.length ? ' — faltam: ' + faltam.join(', ') : ''));

console.log('b) o zip × a pasta (' + nomeZip + ')');
if (!fs.existsSync(arqZip)) { ok(false, nomeZip + ' existe em deploy/copiloto-chrome-web-store/'); console.log('\n' + falhas + ' FALHA(S)'); process.exit(1); }
const bruto = fs.readFileSync(arqZip), zip = leZip(bruto), nomes = Object.keys(zip);
const esperado = {};
const anda = rel => { const p = path.join(EXT, rel); if (!fs.existsSync(p)) return; if (fs.statSync(p).isDirectory()) fs.readdirSync(p).forEach(n => anda(rel + '/' + n)); else esperado[rel] = p; };
dentro.forEach(anda);
ok(!nomes.some(n => n.indexOf('\\') >= 0), 'caminhos com "/" (a loja pode recusar "\\")');
const soZip = nomes.filter(n => !esperado[n]), soPasta = Object.keys(esperado).filter(n => !zip[n]);
ok(!soZip.length, 'nada no zip que não venha de $dentro' + (soZip.length ? ' — sobram: ' + soZip.join(', ') : ''));
ok(!soPasta.length, 'todo arquivo de $dentro está no zip' + (soPasta.length ? ' — faltam: ' + soPasta.slice(0, 10).join(', ') : ''));
const difs = nomes.filter(n => esperado[n] && !fs.readFileSync(esperado[n]).equals(zip[n]));
ok(!difs.length, nomes.length + ' arquivos iguais byte a byte à pasta' + (difs.length ? ' — diferentes: ' + difs.join(', ') : ''));

console.log('c) tipos de arquivo');
const tipoRuim = nomes.filter(n => !/\.(js|html|css|json|png)$/i.test(n)), iconeRuim = nomes.filter(n => /^icons\//.test(n) && !/\.png$/i.test(n));
ok(!tipoRuim.length, 'só .js .html .css .json .png' + (tipoRuim.length ? ' — fora do padrão: ' + tipoRuim.join(', ') : ''));
ok(!iconeRuim.length, 'em icons/ só .png' + (iconeRuim.length ? ' — ' + iconeRuim.join(', ') : ''));

console.log('d) versão e SHA-256');
let vZip = '';
try { vZip = JSON.parse(zip['manifest.json'].toString('utf8')).version; } catch (e) { vZip = ''; }
ok(vZip === versao, 'manifest do zip é a ' + versao + (vZip && vZip !== versao ? ' (é a ' + vZip + ')' : ''));
const sha = crypto.createHash('sha256').update(bruto).digest('hex');
const linha = fs.readFileSync(path.join(LOJA, 'VERSOES.md'), 'utf8').split('\n').find(l => new RegExp('^\\|\\s*' + versao.replace(/\./g, '\\.') + '\\s*\\|').test(l)) || '';
const anotado = (/\b[0-9a-f]{64}\b/i.exec(linha) || [''])[0].toLowerCase();
ok(!!anotado && anotado === sha, 'SHA-256 ' + sha + (anotado ? (anotado === sha ? ' = o do VERSOES.md' : ' ≠ o do VERSOES.md (' + anotado + ')') : ' — a ' + versao + ' não tem SHA no VERSOES.md'));

console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nTUDO OK · ' + nomeZip + ' confere com a pasta, a lista fechada e o VERSOES.md');
process.exit(falhas ? 1 : 0);
