// Copiloto · TikTok Shop — roda no MUNDO DA PÁGINA (world MAIN, document_start) de https://seller-br.tiktok.com, só depois que a
// seller liga o TikTok (permissão opcional; registrado por SHC.tt.sincronizarScripts).
// LEITURA PASSIVA: embrulha o fetch e o XMLHttpRequest da própria página. A chamada original acontece igual, com os mesmos argumentos,
// e a página recebe a mesma resposta. O Copiloto só lê uma CÓPIA (response.clone() / o texto do XHR no loadend) das rotas da lista
// fechada abaixo, e só de GET. Ele NUNCA cria uma requisição, nunca navega e nunca altera a página.
// Antes de sair da página, tira tudo que é do comprador (nomes de campo abaixo). O fundo filtra de novo pela lista do que PODE passar.
// Qualquer erro aqui dentro: o embrulho sai do caminho e a tela segue normal.
(function (w) {
    'use strict';
    const MARCA = Symbol.for('copiloto.tiktok');
    if (!w || w[MARCA]) return;
    const ROTAS = [
        ['pedidos_fin', '/api/v1/pay/statement/order/list'],
        ['transacao', '/api/v1/pay/statement/transaction/detail'],
        ['extratos', '/api/v1/pay/statement/list/detail'],
        ['areceber', '/api/v1/pay/statement/stat/info'],
        ['saldo', '/api/v1/pay/settlement/balance/get'],
        ['pedido', '/api/v1/trade/orders/get'],
        ['saude_perf', '/api/v1/seller/growth_center/performance/list'],
        ['saude_prazo', '/api/v1/seller/growth_center/dynamic_settlement/get'],
        ['saude_viol', '/api/v1/seller/growth_center/violation/overview/get'],
        ['afil', '/api/v1/affiliate/backend/homepage/todo_dashboard/get'],
        ['camp_rec', '/api/v1/promotion/campaign/seller/recommend_campaign/list'],
        ['camp_insc', '/api/v1/promotion/campaign/seller/list_registered_campaigns'],
    ];
    // Campo do comprador/entrega (em qualquer nível) nunca sai da página. product_name, sku_name e seller_sku_name passam.
    // Também cliente/usuário (customer*, user_id/user_info/username), documento (cnpj, tax_id, id_number, document) e recado (remark, note).
    const DO_COMPRADOR = /^(buyer|recipient|receiver|consignee|contact|tracking|provider|customer)|phone|mobile|e_?mail|address|endereco|cpf|cnpj|zipcode|zip_code|postal|nickname|avatar|user_?name|user_?(id|info)|full_name|first_name|last_name|tax_?(id|num|no|code)|taxpayer|document|id_?number|id_?card|remark|(^|_)notes?($|_)/i;

    const url = u => { try { return new URL(String(u), w.location.href); } catch (e) { return null; } };
    const idLoja = u => { const v = u && u.searchParams.get('oec_seller_id'); return v && /^\d{5,25}$/.test(v) ? v : ''; };
    let conta = idLoja(url(w.location.href));
    /** Tipo da rota (lista fechada) ou '' — só do próprio TikTok. Toda URL vista serve para saber a loja (oec_seller_id). */
    function tipoDe(u) {
        const x = url(u);
        if (!x || !/(^|\.)tiktok\.com$/.test(x.hostname)) return '';
        conta = idLoja(x) || conta;
        const r = ROTAS.find(r => x.pathname === r[1] || x.pathname === r[1] + '/');
        return r ? r[0] : '';
    }
    function limpa(v, nivel) {
        if (nivel > 40 || v === null || typeof v !== 'object') return v;
        if (Array.isArray(v)) return v.map(x => limpa(x, nivel + 1));
        const o = {};
        Object.keys(v).forEach(c => { if (!DO_COMPRADOR.test(c)) o[c] = limpa(v[c], nivel + 1); });
        return o;
    }
    function envia(tipo, j) {
        if (!j || typeof j !== 'object') return;
        w.postMessage({ copiloto_tt: 1, tipo, conta: conta || 'tiktok', dados: limpa(j, 0) }, w.location.origin);
    }
    const quieto = f => { try { f(); } catch (e) { /* a página segue normal */ } };

    const fetchOriginal = w.fetch;
    if (typeof fetchOriginal === 'function') {
        w.fetch = function () {
            const resposta = fetchOriginal.apply(this, arguments);
            const args = arguments;
            quieto(() => {
                const a = args[0], init = args[1] || {};
                const metodo = String(init.method || (a && typeof a === 'object' && a.method) || 'GET').toUpperCase();
                const tipo = metodo === 'GET' ? tipoDe(a && typeof a === 'object' && a.url ? a.url : a) : '';
                if (tipo) resposta.then(r => quieto(() => { if (r && r.ok) r.clone().json().then(j => quieto(() => envia(tipo, j)), () => {}); }), () => {});
            });
            return resposta;
        };
    }

    const X = w.XMLHttpRequest && w.XMLHttpRequest.prototype;
    if (X && typeof X.open === 'function' && typeof X.send === 'function') {
        const abrir = X.open, enviar = X.send, marcados = new WeakMap();
        X.open = function (metodo, u) {
            quieto(() => { const t = String(metodo || 'GET').toUpperCase() === 'GET' ? tipoDe(u) : ''; if (t) marcados.set(this, t); else marcados.delete(this); });
            return abrir.apply(this, arguments);
        };
        X.send = function () {
            quieto(() => {
                const tipo = marcados.get(this), xhr = this;
                if (tipo) xhr.addEventListener('loadend', () => quieto(() => {
                    if (!(xhr.status >= 200 && xhr.status < 300)) return;
                    const rt = xhr.responseType;
                    envia(tipo, rt === 'json' ? xhr.response : (rt === '' || rt === 'text' ? JSON.parse(xhr.responseText) : null));
                }));
            });
            return enviar.apply(this, arguments);
        };
    }
    Object.defineProperty(w, MARCA, { value: { tipoDe, limpa, ROTAS }, enumerable: false });
})(typeof window !== 'undefined' ? window : null);
