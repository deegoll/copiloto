// Copiloto · Magalu (etiqueta de ganho, N-D) — MUNDO DA PÁGINA (world MAIN, document_start) do Portal do Seller da Magalu, só depois que a
// seller liga "Etiquetas na Magalu" em Ajustes (permissão opcional; registrado por SHC.etqSincronizar). LEITURA PASSIVA, como o shopee-pagina.js:
// embrulha o fetch e o XMLHttpRequest da página; a chamada original acontece igual. Copia a resposta de 3 rotas GET (retratos M3) e, de cada uma,
// só o que a etiqueta usa:
//   · produtos (api-product-search.magalu.com/seller/v1/portfolios/products): SKU, título, situação, preços, estoque e o frete médio;
//   · visitas (api-product.magalu.com/api/v1/product-metrics?sku=…): as visitas de 7 dias e a variação, com o SKU da consulta;
//   · comissão (magalu-sellers.magalu.com/ps-financial/api/v1/seller/financial-infos): SÓ os % de comissão e o modo de repasse (nunca o banco).
// Nunca cria requisição, nunca navega, nunca altera a página. Envia pela porta PRIVADA do magalu-tela.js (MessageChannel).
(function (w) {
    'use strict';
    const MARCA = Symbol.for('copiloto.magalu');
    if (!w || w[MARCA]) return;
    const ROTAS = [
        ['produtos', 'api-product-search.magalu.com', '/seller/v1/portfolios/products'],
        ['visitas', 'api-product.magalu.com', '/api/v1/product-metrics'],
        ['comissao', 'magalu-sellers.magalu.com', '/ps-financial/api/v1/seller/financial-infos'],
    ];
    const so = (o, cs) => { const x = {}; cs.forEach(c => { const v = o && o[c]; if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') x[c] = v; }); return x; };
    const lista = (v, f, max) => (Array.isArray(v) ? v.slice(0, max || 200).filter(x => x && typeof x === 'object').map(f) : []);
    const CORTA = {
        produtos: j => (j && Array.isArray(j.results) ? { results: lista(j.results, p => Object.assign(so(p, ['sku', 'title', 'status', 'active']), {
            prices: lista(p.prices, x => so(x, ['price', 'list_price']), 5), price_offer: so(p.price_offer, ['lowest_price', 'price_pix']),
            stocks: lista(p.stocks, x => so(x, ['type', 'available']), 10), score: so(p.score, ['average_shipping_cost']) })) } : null),
        visitas: j => (j && Array.isArray(j.visits) ? { visits: lista(j.visits, x => so(x, ['days', 'quantity', 'growth_rate']), 5) } : null),
        comissao: j => (j && Array.isArray(j.agreements) ? { transfer_data: so(j.transfer_data, ['auto_anticipate']),
            agreements: lista(j.agreements, a => ({ name: a.name, fees_type: lista(a.fees_type, t => ({ type: t.type, level: t.level, fees: lista(t.fees, f => so(f, ['value', 'auto_anticipate']), 500) }), 10) }), 10) } : null),
    };
    function rotaDe(u, metodo) {
        if (String(metodo || 'GET').toUpperCase() !== 'GET') return null;
        try {
            const x = new URL(String(u), w.location.href);
            if (x.protocol !== 'https:') return null;
            const r = ROTAS.find(r => x.hostname === r[1] && (x.pathname === r[2] || x.pathname === r[2] + '/'));
            return r ? { tipo: r[0], sku: r[0] === 'visitas' ? (x.searchParams.get('sku') || '').slice(0, 80) : '' } : null;
        } catch (e) { return null; }
    }
    const quieto = f => { try { f(); } catch (e) { /* a página segue normal */ } };
    let porta = null;
    const fila = [];
    function envia(rota, j) {
        const dados = CORTA[rota.tipo](j);
        if (!dados) return;
        const msg = { copiloto_mg: 1, tipo: rota.tipo, dados };
        if (rota.sku) msg.sku = rota.sku;
        if (porta) porta.postMessage(msg);
        else { fila.push(msg); if (fila.length > 60) fila.shift(); }
    }
    quieto(() => {
        w.addEventListener('message', e => quieto(() => {
            if (porta || e.source !== w || e.origin !== w.location.origin || !e.data || e.data.copiloto_mg_porta !== 1 || !e.ports || !e.ports[0]) return;
            porta = e.ports[0];
            porta.postMessage({ copiloto_mg: 1, ola: 1 });
            fila.splice(0).forEach(m => porta.postMessage(m));
        }));
        w.postMessage({ copiloto_mg: 1, quer_porta: 1 }, w.location.origin);
    });
    const fetchOriginal = w.fetch;
    if (typeof fetchOriginal === 'function') {
        w.fetch = function () {
            const resposta = fetchOriginal.apply(this, arguments), args = arguments;
            quieto(() => {
                const a = args[0], init = args[1] || {};
                const rota = rotaDe(a && typeof a === 'object' && a.url ? a.url : a, init.method || (a && typeof a === 'object' && a.method) || 'GET');
                if (!rota) return;
                resposta.then(r => quieto(() => { if (r && r.ok) r.clone().json().then(j => quieto(() => envia(rota, j)), () => {}); }), () => {});
            });
            return resposta;
        };
    }
    const X = w.XMLHttpRequest && w.XMLHttpRequest.prototype;
    if (X && typeof X.open === 'function' && typeof X.send === 'function') {
        const abrir = X.open, enviar = X.send, marcados = new WeakMap();
        X.open = function (metodo, u) {
            quieto(() => { const r = rotaDe(u, metodo); if (r) marcados.set(this, r); else marcados.delete(this); });
            return abrir.apply(this, arguments);
        };
        X.send = function () {
            quieto(() => {
                const xhr = this, rota = marcados.get(xhr);
                if (!rota) return;
                xhr.addEventListener('loadend', () => quieto(() => {
                    if (!(xhr.status >= 200 && xhr.status < 300)) return;
                    const rt = xhr.responseType;
                    envia(rota, rt === 'json' ? xhr.response : (rt === '' || rt === 'text' ? JSON.parse(xhr.responseText) : null));
                }));
            });
            return enviar.apply(this, arguments);
        };
    }
    Object.defineProperty(w, MARCA, { value: { rotaDe, CORTA }, enumerable: false });
})(typeof window !== 'undefined' ? window : null);
