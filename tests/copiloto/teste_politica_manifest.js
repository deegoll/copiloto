// Política × manifest (V1, 07/10): o que a extensão pede ao Chrome tem de estar descrito para a loja e para o vendedor, e o que os textos
// descrevem tem de estar no pacote. Em 06/10 a política no ar descreveu o TikTok Shop (scripting, seller-br.tiktok.com) que o pacote do
// ramo não tinha; este teste acusa esse tipo de diferença antes do envio.
//   a) cada permissão (obrigatória e opcional) tem a seção "Permissão: X" no privacidade-loja.txt (o formulário da loja);
//   b) cada site (host_permissions e optional_host_permissions) tem a seção "Host" no privacidade-loja.txt e aparece na política
//      (pelo endereço ou pelo nome do serviço);
//   c) os content_scripts só rodam em site que o manifest já pede;
//   d) nenhum texto (política, formulário, descrição) cita permissão do Chrome ou site de dados que o manifest não pede;
//   e) a ficha e a descrição falam da versão do manifest.
// Rodar: node tests/copiloto/teste_politica_manifest.js
// A política publicada no site, antes de colar o link na loja (o arquivo baixado no lugar do politica-privacidade.html):
//   curl -sL https://especialistaemmarketplace.com.br/sellerhub/copiloto/privacidade.html -o /tmp/pol.html
//   POLITICA=/tmp/pol.html node tests/copiloto/teste_politica_manifest.js
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '../..'), LOJA = path.join(RAIZ, 'deploy/copiloto-chrome-web-store');
let falhas = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) falhas++; };
const ler = f => fs.readFileSync(path.join(LOJA, f), 'utf8');

const man = JSON.parse(fs.readFileSync(path.join(RAIZ, 'extension-copiloto/manifest.json'), 'utf8'));
const perms = [].concat(man.permissions || [], man.optional_permissions || []);
const hosts = [].concat(man.host_permissions || [], man.optional_host_permissions || []);
const dominio = h => String(h).replace(/^\*?:?\/\/|^https?:\/\//, '').replace(/\/.*$/, '');
const dominios = [...new Set(hosts.map(dominio))];
const formulario = ler('privacidade-loja.txt');
const politica = (process.env.POLITICA ? fs.readFileSync(process.env.POLITICA, 'utf8') : ler('politica-privacidade.html')).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
const textos = { 'política': politica, 'formulário': formulario, 'descrição': ler('descricao-loja.txt') };

// Nome do serviço que a política pode usar no lugar do endereço (o vendedor conhece o nome, não o domínio).
const NOME = { 'api.tiny.com.br': /\bTiny\b/, 'app.omie.com.br': /\bOmie\b/, 'www.bling.com.br': /\bBling\b/, 'api.bling.com.br': /\bBling\b/,
    'www.mercadopago.com.br': /Mercado Pago/ };
// Sites citados nos textos que não são acesso a dados: a própria página, o contato, a loja do Chrome e a ajuda pública do ML.
const SEM_ACESSO = /(^|\.)(especialistaemmarketplace\.com\.br|gmail\.com|google\.com|chromewebstore\.google\.com|developers\.mercadolivre\.com\.br)$/;
// Permissões do Chrome que, citadas num texto, querem dizer que a extensão as pede (nomes em inglês: não colidem com o português).
const PERMS_CHROME = ['activeTab', 'alarms', 'background', 'bookmarks', 'clipboardRead', 'clipboardWrite', 'contentSettings', 'contextMenus', 'cookies',
    'debugger', 'declarativeNetRequest', 'desktopCapture', 'downloads', 'geolocation', 'history', 'identity', 'management', 'nativeMessaging',
    'notifications', 'offscreen', 'pageCapture', 'privacy', 'proxy', 'scripting', 'sidePanel', 'storage', 'tabCapture', 'tabGroups', 'tabs',
    'topSites', 'unlimitedStorage', 'webNavigation', 'webRequest'];

console.log('a) permissões no formulário da loja');
perms.forEach(p => ok(new RegExp('Permissão: ' + p + '\\b').test(formulario), p + (man.permissions.indexOf(p) < 0 ? ' (opcional)' : '') + ': tem justificativa'));

console.log('b) sites no formulário e na política');
const cabHost = formulario.split('\n').filter(l => /^\d+\) Host/.test(l)).join('\n');
dominios.forEach(d => {
    ok(cabHost.indexOf(d) >= 0, d + ': tem justificativa de host');
    ok(politica.indexOf(d) >= 0 || (NOME[d] && NOME[d].test(politica)), d + ': a política diz que acessa' + (NOME[d] ? ' (pelo endereço ou pelo nome)' : ''));
});

console.log('c) content_scripts dentro dos sites pedidos');
const casa = (m, h) => dominio(m) === dominio(h) || (dominio(h).startsWith('*.') && dominio(m).endsWith(dominio(h).slice(1)));
(man.content_scripts || []).forEach(cs => (cs.matches || []).forEach(m => ok(hosts.some(h => casa(m, h)), 'content script em ' + m + ' está em host_permissions')));

console.log('d) nada descrito que o manifest não pede');
Object.keys(textos).forEach(nome => {
    const t = textos[nome];
    const permsCitadas = PERMS_CHROME.filter(p => new RegExp('(^|[\\s"“`(])' + p + '($|[\\s"”`),.:;])').test(t));
    const sobra = permsCitadas.filter(p => perms.indexOf(p) < 0);
    ok(!sobra.length, nome + ': só cita permissões do manifest' + (sobra.length ? ' — sobram: ' + sobra.join(', ') : ''));
    const sites = [...new Set((t.match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com\.br|com)\b/gi) || []).map(s => s.toLowerCase()))];
    // Domínio sem subdomínio ("mercadolivre.com.br") vale quando um subdomínio dele está no manifest.
    const fora = sites.filter(s => !SEM_ACESSO.test(s) && dominios.indexOf(s) < 0 && !dominios.some(d => d.endsWith('.' + s)));
    ok(!fora.length, nome + ': só cita sites que o manifest pede' + (fora.length ? ' — sobram: ' + fora.join(', ') : ''));
});

console.log('e) versão');
const v = man.version;
ok(new RegExp('Copiloto ' + v.replace(/\./g, '\\.') + '\\b').test(ler('ficha-loja.txt')), 'ficha-loja.txt é da versão ' + v);
ok(!/copiloto-v(?!'|\$)\d+\.\d+\.\d+\.zip/.test(ler('ficha-loja.txt')) || ler('ficha-loja.txt').indexOf('copiloto-v' + v + '.zip') >= 0, 'ficha-loja.txt manda carregar o copiloto-v' + v + '.zip');

console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nTUDO OK');
process.exit(falhas ? 1 : 0);
