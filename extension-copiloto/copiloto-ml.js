// SellerHub Copiloto v2 — roda no painel do vendedor do Mercado Livre (vendedores.mercadolivre.com.br).
// 1) Na Central de promoções, manda para a extensão os números que o ML já calculou para cada proposta.
// 2) Serve de "plano B" da sincronização: busca páginas do painel (promoções e lista de Anúncios) com a sessão desta aba.
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
