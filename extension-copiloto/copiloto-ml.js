// SellerHub Copiloto v2 — roda no painel do vendedor do Mercado Livre (vendedores.mercadolivre.com.br).
// 1) Na Central de promoções, manda para a extensão os números que o ML já calculou para cada proposta.
// 2) Serve de "plano B" da sincronização: busca páginas do painel (promoções e lista de Anúncios) e o JSON do Mercado Ads com a sessão desta aba.
// Só lê. Não clica, não preenche, não envia nada para fora do navegador.
(function () {
    'use strict';
    if (window.__SHC_ML__) return;
    window.__SHC_ML__ = true;
    const SHC = globalThis.SHC;
    if (!SHC || !SHC.mlExtraiEstado) return;

    function enviaPaginaAtual() {
        if (!/\/anuncios\/lista\/promos/.test(location.pathname)) return;
        const s = document.getElementById('__NORDIC_RENDERING_CTX__');
        const estado = s ? SHC.mlExtraiEstado(s.textContent || '') : null;
        if (!estado) return;
        const dados = SHC.mlPromosDoEstado(estado);
        if (!dados.familias.length) return;
        // V15: leva a conta da página; o fundo descarta se faltar ou se for outra conta do mesmo Chrome.
        try { chrome.runtime.sendMessage({ acao: 'promos_pagina', dados, conta: SHC.mlContaDoEstado(estado) }); } catch (e) { /* extensão recarregada */ }
    }

    // Plano B: o fundo pede uma página do painel e esta aba busca com a sessão dela (só GET, só estas rotas).
    const LEITORES = {
        ler_pagina_promos: { rota: /^\/anuncios\/lista\/promos$/, ler: e => SHC.mlPromosDoEstado(e) },
        ler_pagina_anuncios: { rota: /^\/anuncios(\/lista)?$/, ler: e => SHC.mlPaginaAnuncios(e) },
    };
    chrome.runtime.onMessage.addListener((msg, sender, responder) => {
        const leitor = msg && LEITORES[msg.acao];
        let u = null;
        try { u = new URL(String(msg && msg.url)); } catch (e) { /* url inválida */ }
        // v3.1: Mercado Ads (pa.mercadolivre.com.br) só responde a quem vem de uma página do ML → o fundo pede o JSON por aqui.
        // Só GET, só a API de leitura do Ads; sem seguir desvio (redirect:'manual': nada de erro de CORS no console da página).
        if (msg && msg.acao === 'ler_json_pa') {
            if (!u || u.origin !== 'https://pa.mercadolivre.com.br' || u.pathname.indexOf('/pa/api/admin-pads/ajax/') !== 0) return false;
            fetch(u.href, Object.assign({ method: 'GET', credentials: 'include', cache: 'no-store', redirect: 'manual', headers: { accept: 'application/json' } }, typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(25000) } : {}))
                .then(async r => {
                    // Desvio daqui (29/09/2026, ao vivo): para ads.mercadolivre.com.br/accounts = conta de anúncios ainda não aberta neste
                    // Chrome (a sessão está ok: o Ads só roda depois da lista de Anúncios lida). O fundo decide o que fazer.
                    if (r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400)) return { ok: false, desvio: true };
                    if (!r.ok) return { ok: false, status: r.status };
                    try { return { ok: true, dados: await r.json() }; } catch (e) { return { ok: false, formato: true }; }   // HTML no lugar de JSON
                })
                .then(responder, err => responder({ ok: false, erro: String(err && err.name || err) }));
            return true;
        }
        if (!leitor || !u || u.origin !== 'https://vendedores.mercadolivre.com.br' || !leitor.rota.test(u.pathname)) return false;
        SHC.buscarVendo(u.href, Object.assign({ credentials: 'include', cache: 'no-store' }, typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(25000) } : {}))
            .then(r => /login|registration|\/lgz\//i.test(r.url) ? { login: true } : { html: r.ok ? r.text() : '' })
            .then(async b => {
                const html = await b.html, e = html ? SHC.mlExtraiEstado(html) : null;
                responder(e ? { ok: true, dados: leitor.ler(e) } : { ok: false, login: !!b.login });   // login: o fundo mostra "entre no ML"
            })
            .catch(err => responder({ ok: false, erro: String(err) }));
        return true;
    });

    enviaPaginaAtual();
})();
