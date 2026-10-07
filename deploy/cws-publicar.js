// Publica o Copiloto na Chrome Web Store pela API oficial: sobe o zip no item e (com --enviar) manda para revisão.
// uso: node deploy/cws-publicar.js <arquivo.zip> [--enviar]
// Precisa de deploy/cws-credentials.json com refresh_token (gerado por cws-autorizar.js). A ficha da loja (textos,
// capturas) continua sendo editada no painel: a API só troca o pacote e envia para revisão.
// Sem o arquivo (ex.: sessão na nuvem), lê as variáveis de ambiente CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN e CWS_ITEM_ID,
// cadastradas nas configurações do ambiente — nunca coladas no chat nem gravadas no repositório.
const fs = require('fs'), path = require('path'), https = require('https');
const ARQ = path.join(__dirname, 'cws-credentials.json'), E = process.env;
const cred = fs.existsSync(ARQ) ? JSON.parse(fs.readFileSync(ARQ, 'utf8'))
  : { client_id: E.CWS_CLIENT_ID, client_secret: E.CWS_CLIENT_SECRET, refresh_token: E.CWS_REFRESH_TOKEN, item_id: E.CWS_ITEM_ID };
const zip = process.argv[2], enviar = process.argv.includes('--enviar');
if (!zip || !fs.existsSync(zip)) { console.error('uso: node deploy/cws-publicar.js <arquivo.zip> [--enviar]'); process.exit(2); }
const falta = ['client_id', 'client_secret', 'refresh_token', 'item_id'].filter(k => !cred[k]);
if (falta.length) { console.error('faltam ' + falta.join(', ') + ' (cws-credentials.json ou CWS_* no ambiente; o refresh_token sai de node deploy/cws-autorizar.js)'); process.exit(2); }

function pede(metodo, url, cabecalhos, corpo) {
  return new Promise((res, rej) => {
    const r = https.request(url, { method: metodo, headers: cabecalhos }, resp => { let t = ''; resp.on('data', d => { t += d; }); resp.on('end', () => res({ status: resp.statusCode, texto: t })); });
    r.on('error', rej); if (corpo) r.write(corpo); r.end();
  });
}
(async () => {
  const c = new URLSearchParams({ client_id: cred.client_id, client_secret: cred.client_secret, refresh_token: cred.refresh_token, grant_type: 'refresh_token' }).toString();
  const tk = await pede('POST', 'https://oauth2.googleapis.com/token', { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(c) }, c);
  const token = (JSON.parse(tk.texto || '{}')).access_token;
  if (!token) { console.error('não consegui o token:', tk.status, tk.texto.slice(0, 200)); process.exit(1); }
  const H = { Authorization: 'Bearer ' + token, 'x-goog-api-version': '2' };
  const dados = fs.readFileSync(zip);
  const up = await pede('PUT', 'https://www.googleapis.com/upload/chromewebstore/v1.1/items/' + cred.item_id, Object.assign({ 'Content-Type': 'application/zip', 'Content-Length': dados.length }, H), dados);
  console.log('upload:', up.status, up.texto.slice(0, 400));
  let j = {}; try { j = JSON.parse(up.texto); } catch (e) {}
  if (j.uploadState !== 'SUCCESS') { console.error('o pacote não foi aceito (veja itemError acima)'); process.exit(1); }
  if (!enviar) { console.log('pacote no rascunho do item. Para mandar para revisão: node deploy/cws-publicar.js ' + zip + ' --enviar'); return; }
  const pub = await pede('POST', 'https://www.googleapis.com/chromewebstore/v1.1/items/' + cred.item_id + '/publish?publishTarget=default', Object.assign({ 'Content-Length': 0 }, H), null);
  console.log('publish:', pub.status, pub.texto.slice(0, 400));
})().catch(e => { console.error('ERRO', e.message); process.exit(1); });
