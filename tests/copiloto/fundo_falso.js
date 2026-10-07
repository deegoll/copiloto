// background.js de verdade num contexto isolado, com chrome.* e fetch de mentira (usado por teste_posvenda, teste_frete_hist e teste_anomalias).
// op.rota(url) → { html } | { json } | 'login' | 'pendura' | null (404).  op.dados = armazenamento inicial.  op.abas = abas do ML abertas.
// Timers rodam na próxima volta do laço (as pausas de 1,2 s entre páginas não esperam de verdade).
const fs = require('fs'), path = require('path'), vm = require('vm');
const DIR = path.join(__dirname, '../../extension-copiloto');
const copia = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
module.exports = function montaFundo(op) {
    op = op || {};
    const dados = op.dados || {}, envios = [], ouvintes = [], instalados = [], iniciados = [], alarmesOuvintes = [], historico = [], pedidos = [], selos = [], titulos = [], cores = [], alarmes = [];
    const permDadas = [], permTiradas = [], mudancas = [];   // 3.3.0 (E8): ouvintes de permissão e do storage (só o TikTok usa no fundo)
    const chromeF = {
        storage: { local: {
            get: async k => { const o = {}; (k === null ? Object.keys(dados) : [].concat(k)).forEach(x => { if (x in dados) o[x] = copia(dados[x]); }); return o; },
            set: async o => { Object.keys(o).forEach(k => { dados[k] = copia(o[k]); if (k === 'shc:status') historico.push(copia(o[k])); }); },
            remove: async k => { [].concat(k).forEach(x => delete dados[x]); },
        }, onChanged: { addListener: f => mudancas.push(f) } },
        runtime: { id: 'ext', onInstalled: { addListener: f => instalados.push(f) }, onStartup: { addListener: f => iniciados.push(f) }, onMessage: { addListener: f => ouvintes.push(f) },
            getURL: p => p, openOptionsPage() {}, getPlatformInfo: async () => ({}) },
        alarms: { create: (nome, o) => { alarmes.push({ nome, o }); }, onAlarm: { addListener: f => alarmesOuvintes.push(f) } },
        permissions: { contains: async () => false, onAdded: { addListener: f => permDadas.push(f) }, onRemoved: { addListener: f => permTiradas.push(f) } },
        tabs: { create() {}, query: async () => op.abas || [], sendMessage: async () => undefined },
        sidePanel: { setPanelBehavior: async () => {}, open: async () => {} },
        action: { setBadgeText: async o => { selos.push(o.text); }, setBadgeBackgroundColor: async o => { cores.push(o.color); }, setTitle: async o => { titulos.push(o.title); } },
    };
    const fetchF = async (url, o) => {
        pedidos.push(url);
        if (o && o.method) envios.push({ url, metodo: o.method, corpo: o.body });   // POST/PUT: método e corpo (texto), para o teste conferir
        const r = op.rota ? op.rota(url, o) : null;
        if (r === 'pendura') return new Promise(() => {});
        if (r === 'login') return { ok: true, url: 'https://www.mercadolivre.com.br/jms/mlb/lgz/login', text: async () => '', json: async () => ({}) };
        if (!r) return { ok: false, status: 404, url, text: async () => '', json: async () => ({}) };
        return { ok: true, status: 200, url, text: async () => (r.html !== undefined ? r.html : JSON.stringify(r.json)), json: async () => copia(r.json) };
    };
    // op.hoje (opcional, 'AAAA-MM-DD'): congela o relógio do fundo nessa data em vez do dia real da máquina — para um
    // teste que monta datas relativas ("hoje" − N dias) não depender do dia do mês em que roda de verdade.
    let relogio = {};
    if (op.hoje) { const t0 = Date.parse(op.hoje + 'T12:00:00'); class Relogio extends Date { constructor(...a) { super(...(a.length ? a : [t0])); } static now() { return t0; } } relogio = { Date: Relogio }; }
    const ctx = vm.createContext(Object.assign({ chrome: chromeF, fetch: fetchF, console, URL, setTimeout: f => setImmediate(f), setInterval: () => 0, clearInterval() {} }, relogio));
    // op.faltam (opcional, ['licenca.js', …]): arquivos que NÃO estão no pacote da loja; importScripts deles quebra como no Chrome.
    ctx.importScripts = (...arqs) => arqs.forEach(a => {
        if ((op.faltam || []).indexOf(a) >= 0) throw new Error("importScripts: '" + a + "' não está no pacote");
        vm.runInContext(fs.readFileSync(path.join(DIR, a), 'utf8'), ctx, { filename: a });
    });
    // background.js = carregador: importScripts das partes de fundo/ (pelo importScripts acima). op.background (opcional): texto que
    // roda no lugar dele (teste_fundo_dividido.js roda o background.js de antes da divisão, inteiro, para comparar).
    vm.runInContext(op.background || fs.readFileSync(path.join(DIR, 'background.js'), 'utf8'), ctx, { filename: 'background.js' });
    const EXT = { id: 'ext', url: 'chrome-extension://ext/painel-lateral.html' };
    // Resposta do ouvinte; '__sem_resposta' quando ninguém responde (return false sem responder).
    const envia = (msg, sender) => new Promise(res => { let vai = false; ouvintes.forEach(f => { vai = f(msg, sender || EXT, res) || vai; }); if (!vai) setImmediate(() => res('__sem_resposta')); });
    const alarme = nome => alarmesOuvintes.forEach(f => f({ name: nome }));
    const instala = motivo => instalados.forEach(f => f({ reason: motivo }));
    const tique = n => new Promise(r => { let k = 0; const f = () => (++k >= (n || 1) ? r() : setImmediate(f)); setImmediate(f); });
    const registros = { onMessage: ouvintes, onInstalled: instalados, onStartup: iniciados, onAlarm: alarmesOuvintes,   // listeners registrados
        'permissions.onAdded': permDadas, 'permissions.onRemoved': permTiradas, 'storage.onChanged': mudancas };
    return { dados, envios, envia, pedidos, historico, selos, titulos, cores, alarmes, alarme, instala, tique, ctx, EXT, registros };
};
// Texto do fundo inteiro: o background.js (carregador) + as partes de fundo/ na ordem do importScripts dele. Para os testes que
// procuram um trecho no código do fundo (antes liam só o background.js).
module.exports.fonte = () => {
    const c = fs.readFileSync(path.join(DIR, 'background.js'), 'utf8');
    return [c].concat([...c.matchAll(/'(fundo\/[\w.-]+\.js)'/g)].map(m => fs.readFileSync(path.join(DIR, m[1]), 'utf8'))).join('\n');
};
module.exports.html = r => '<html><script id="__NORDIC_RENDERING_CTX__">_n.ctx.r=' + JSON.stringify(r) + ';_n.ctx.a={};</script></html>';
module.exports.B = 'https://vendedores.mercadolivre.com.br';
// Lista de Anúncios (1 página) no formato do ML: its = [{itemId, titulo?, frete (número) | 'comprador', estoque?}], conta = sellerId.
const L = t => ({ lines: [].concat(t).map(label => ({ label })) });
module.exports.paginaAnuncios = (its, conta) => module.exports.html({ appProps: { pageProps: { u: { sellerId: +conta, nickname: 'LOJA_TESTE' }, viewData: {
    grid: { pagination: { total: its.length } },
    rows: its.map(i => ({ metadata: { itemId: i.itemId }, product: { title: i.titulo || 'Produto ' + i.itemId, status: 'Ativo', sku: i.sku || '', stock: [{ label: i.estoque || '10 disponíveis' }] },
        price: L('R$ 200,00'), earnings: L('R$ 150,00'),
        purchaseOptions: L(['Clássico', 'A pagar R$ 20,00'].concat(i.frete === 'comprador' ? ['Envio por conta do comprador'] : ['Você oferece frete grátis', 'A pagar R$ ' + String(i.frete.toFixed(2)).replace('.', ',')])) })),
} } } });
