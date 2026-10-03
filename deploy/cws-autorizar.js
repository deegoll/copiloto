// Autorização única da API da Chrome Web Store: abre a tela do Google, recebe o código no endereço local
// http://127.0.0.1:8787/ e troca por um refresh_token, gravado em cws-credentials.json. Rodar UMA vez.
// uso: node deploy/cws-autorizar.js   (imprime o endereço para abrir no Chrome logado na conta da loja)
const http = require('http'), fs = require('fs'), path = require('path'), https = require('https');
const ARQ = path.join(__dirname, 'cws-credentials.json');
const cred = JSON.parse(fs.readFileSync(ARQ, 'utf8'));
const REDIRECT = 'http://127.0.0.1:8787/';
const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: cred.client_id, redirect_uri: REDIRECT, response_type: 'code', access_type: 'offline', prompt: 'consent',
  scope: 'https://www.googleapis.com/auth/chromewebstore',
});
fs.writeFileSync(path.join(__dirname, 'cws-autorizar.url'), url);
console.log('ABRA NO CHROME:', url);
const srv = http.createServer((req, res) => {
  const q = new URL(req.url, REDIRECT).searchParams, code = q.get('code');
  if (!code) { res.writeHead(400); return res.end('sem codigo'); }
  const corpo = new URLSearchParams({ code, client_id: cred.client_id, client_secret: cred.client_secret, redirect_uri: REDIRECT, grant_type: 'authorization_code' }).toString();
  const r = https.request('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(corpo) } }, resp => {
    let t = ''; resp.on('data', d => { t += d; }); resp.on('end', () => {
      let j = {}; try { j = JSON.parse(t); } catch (e) {}
      if (j.refresh_token) {
        cred.refresh_token = j.refresh_token; fs.writeFileSync(ARQ, JSON.stringify(cred, null, 2));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<h2 style="font-family:sans-serif">Copiloto autorizado. Pode fechar esta aba.</h2>');
        console.log('OK: refresh_token gravado'); setTimeout(() => process.exit(0), 500);
      } else { res.writeHead(500); res.end('falhou: ' + t.slice(0, 200)); console.log('FALHA', resp.statusCode, t.slice(0, 300)); }
    });
  });
  r.on('error', e => { res.writeHead(500); res.end('erro'); console.log('ERRO', e.message); });
  r.end(corpo);
});
srv.listen(8787, '127.0.0.1', () => console.log('esperando o codigo em ' + REDIRECT));
