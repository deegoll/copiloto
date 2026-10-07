// Copiloto · Shopee (etiqueta de ganho, N-C) — roda no MUNDO DA PÁGINA (world MAIN, document_start) de https://seller.shopee.com.br, só
// depois que a seller liga "Etiquetas na Shopee" em Ajustes (permissão opcional; registrado por SHC.etqSp.sincronizarScripts).
// LEITURA PASSIVA, igual ao tiktok-pagina.js: embrulha o fetch e o XMLHttpRequest da própria página; a chamada original acontece igual e a
// página recebe a mesma resposta. O Copiloto lê uma CÓPIA de UMA rota só, a lista de "Meus Produtos" (GET get_product_list), e dela só
// os campos da etiqueta (id, nome, SKU, situação, preço, preço de promoção, estoque e as visualizações, do produto e das variações). Nunca cria requisição,
// nunca navega, nunca altera a página. A cópia vai ao shopee-tela.js só pela porta PRIVADA que ele entrega (MessageChannel).
// Qualquer erro aqui dentro: o embrulho sai do caminho e a tela segue normal.
(function (w) {
    'use strict';
    const MARCA = Symbol.for('copiloto.shopee');
    if (!w || w[MARCA]) return;
    const ROTA = '/api/v3/opt/mpsku/list/v2/get_product_list';
    const PRECO = ['price_min', 'price_max', 'selling_price_min', 'selling_price_max'], MPRECO = ['origin_price', 'promotion_price'];
    const so = (o, cs) => { const x = {}; cs.forEach(c => { const v = o && o[c]; if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') x[c] = v; }); return x; };
    /** Só os campos da etiqueta (retrato M2 de 07/10/2026). */
    function corta(j) {
        const ps = j && j.data && Array.isArray(j.data.products) ? j.data.products : null;
        if (!ps) return null;
        return { code: j.code, data: { products: ps.slice(0, 200).filter(p => p && typeof p === 'object').map(p => Object.assign(so(p, ['id', 'name', 'status', 'parent_sku']), {
            tag: so(p.tag, ['unlist']), price_detail: so(p.price_detail, PRECO), stock_detail: so(p.stock_detail, ['total_available_stock']), statistics: so(p.statistics, ['view_count']),
            model_list: (Array.isArray(p.model_list) ? p.model_list : []).slice(0, 100).filter(m => m && typeof m === 'object').map(m => Object.assign(so(m, ['id', 'name', 'sku']),
                { price_detail: so(m.price_detail, MPRECO), stock_detail: so(m.stock_detail, ['total_available_stock']) })) })) } };
    }
    const eDaRota = (u, metodo) => {
        if (String(metodo || 'GET').toUpperCase() !== 'GET') return false;
        try { const x = new URL(String(u), w.location.href); return x.origin === w.location.origin && (x.pathname === ROTA || x.pathname === ROTA + '/'); } catch (e) { return false; }
    };
    const quieto = f => { try { f(); } catch (e) { /* a página segue normal */ } };
    let porta = null;
    const fila = [];
    function envia(j) {
        const dados = corta(j);
        if (!dados) return;
        const msg = { copiloto_sp: 1, tipo: 'produtos', dados };
        if (porta) porta.postMessage(msg);
        else { fila.push(msg); if (fila.length > 5) fila.shift(); }
    }
    quieto(() => {
        w.addEventListener('message', e => quieto(() => {
            if (porta || e.source !== w || e.origin !== w.location.origin || !e.data || e.data.copiloto_sp_porta !== 1 || !e.ports || !e.ports[0]) return;
            porta = e.ports[0];
            porta.postMessage({ copiloto_sp: 1, ola: 1 });
            fila.splice(0).forEach(m => porta.postMessage(m));
        }));
        w.postMessage({ copiloto_sp: 1, quer_porta: 1 }, w.location.origin);
    });

    const fetchOriginal = w.fetch;
    if (typeof fetchOriginal === 'function') {
        w.fetch = function () {
            const resposta = fetchOriginal.apply(this, arguments), args = arguments;
            quieto(() => {
                const a = args[0], init = args[1] || {};
                const metodo = init.method || (a && typeof a === 'object' && a.method) || 'GET';
                if (!eDaRota(a && typeof a === 'object' && a.url ? a.url : a, metodo)) return;
                resposta.then(r => quieto(() => { if (r && r.ok) r.clone().json().then(j => quieto(() => envia(j)), () => {}); }), () => {});
            });
            return resposta;
        };
    }
    const X = w.XMLHttpRequest && w.XMLHttpRequest.prototype;
    if (X && typeof X.open === 'function' && typeof X.send === 'function') {
        const abrir = X.open, enviar = X.send, marcados = new WeakSet();
        X.open = function (metodo, u) {
            quieto(() => { if (eDaRota(u, metodo)) marcados.add(this); else marcados.delete(this); });
            return abrir.apply(this, arguments);
        };
        X.send = function () {
            quieto(() => {
                const xhr = this;
                if (!marcados.has(xhr)) return;
                xhr.addEventListener('loadend', () => quieto(() => {
                    if (!(xhr.status >= 200 && xhr.status < 300)) return;
                    const rt = xhr.responseType;
                    envia(rt === 'json' ? xhr.response : (rt === '' || rt === 'text' ? JSON.parse(xhr.responseText) : null));
                }));
            });
            return enviar.apply(this, arguments);
        };
    }
    Object.defineProperty(w, MARCA, { value: { corta, eDaRota }, enumerable: false });
})(typeof window !== 'undefined' ? window : null);
