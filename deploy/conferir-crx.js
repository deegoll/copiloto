// Confere se o CRX que a Chrome Web Store distribui tem o mesmo código do zip enviado.
// Uso: node deploy/conferir-crx.js 3.2.1                 (baixa o CRX da loja)
//      node deploy/conferir-crx.js 3.2.1 copiloto.crx    (usa um CRX já baixado)
// A loja acrescenta só a pasta _metadata/ (assinatura) e a linha "update_url" no manifest.json: as duas ficam de fora da comparação.
// Sem dependências: lê o zip com o zlib do próprio Node.
const fs = require('fs'), path = require('path'), https = require('https'), zlib = require('zlib');

const ITEM = 'fggodhhoencenpjoeppdlbabmhghilci';
const URL_CRX = 'https://clients2.google.com/service/update2/crx?response=redirect&prodversion=130.0&acceptformat=crx2,crx3&x=id%3D' + ITEM + '%26uc';

function baixa(url, saltos) {
  return new Promise((res, rej) => {
    https.get(url, resp => {
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location && saltos > 0) { resp.resume(); return res(baixa(resp.headers.location, saltos - 1)); }
      if (resp.statusCode !== 200) { resp.resume(); return rej(new Error('download do CRX: HTTP ' + resp.statusCode)); }
      const partes = []; resp.on('data', d => partes.push(d)); resp.on('end', () => res(Buffer.concat(partes)));
    }).on('error', rej);
  });
}

// CRX3: "Cr24", versão (4 bytes), tamanho do cabeçalho (4 bytes), cabeçalho, zip.
function zipDoCrx(b) {
  if (b.toString('latin1', 0, 4) !== 'Cr24') throw new Error('o arquivo não é um CRX');
  if (b.readUInt32LE(4) !== 3) throw new Error('CRX versão ' + b.readUInt32LE(4) + ' (esperado 3)');
  return b.subarray(12 + b.readUInt32LE(8));
}

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
    const nome = b.toString('utf8', p + 46, p + 46 + lNome).replace(/\\/g, '/');
    p += 46 + lNome + lExtra + lComent;
    if (nome.endsWith('/')) continue;
    const ini = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28), dado = b.subarray(ini, ini + comprimido);
    if (metodo === 0) arquivos[nome] = Buffer.from(dado);
    else if (metodo === 8) arquivos[nome] = zlib.inflateRawSync(dado);
    else throw new Error(nome + ': compressão ' + metodo + ' não suportada');
  }
  return arquivos;
}

function semUpdateUrl(buf) { return buf.toString('utf8').replace(/^"update_url": "[^"]*",\r?\n(\r?\n)?/m, ''); }

async function main() {
  const versao = process.argv[2], crxLocal = process.argv[3];
  if (!/^\d+\.\d+\.\d+$/.test(versao || '')) { console.error('uso: node deploy/conferir-crx.js X.Y.Z [arquivo.crx]'); process.exit(2); }
  const zipEnviado = path.join(__dirname, 'copiloto-chrome-web-store', 'copiloto-v' + versao + '.zip');
  const enviado = leZip(fs.readFileSync(zipEnviado));
  const loja = leZip(zipDoCrx(crxLocal ? fs.readFileSync(crxLocal) : await baixa(URL_CRX, 5)));
  const problemas = [];
  const versaoLoja = JSON.parse(loja['manifest.json'].toString('utf8')).version;
  if (versaoLoja !== versao) problemas.push('a loja distribui a versão ' + versaoLoja + ', não a ' + versao);
  const nomes = new Set(Object.keys(enviado).concat(Object.keys(loja).filter(n => !n.startsWith('_metadata/'))));
  for (const n of [...nomes].sort()) {
    if (!enviado[n]) problemas.push('só no CRX: ' + n);
    else if (!loja[n]) problemas.push('só no zip: ' + n);
    else if (n === 'manifest.json' ? semUpdateUrl(loja[n]) !== enviado[n].toString('utf8') : !loja[n].equals(enviado[n])) problemas.push('conteúdo diferente: ' + n);
  }
  if (problemas.length) { console.log(problemas.join('\n')); console.log('DIFERENTE · o CRX da loja não bate com ' + path.basename(zipEnviado)); process.exit(1); }
  console.log('IGUAL · ' + Object.keys(enviado).length + ' arquivos do CRX da loja (versão ' + versaoLoja + ') iguais, byte a byte, a ' + path.basename(zipEnviado) + ' (fora _metadata/ e update_url, que a loja acrescenta)');
}

main().catch(e => { console.error('erro: ' + e.message); process.exit(2); });
