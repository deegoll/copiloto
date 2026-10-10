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

    // 3.3.1 (C2): sem o "Concordo e ligar" do Mercado Livre (cfg.consentimento_ml) esta aba não lê, não busca e não manda
    // nada — nem o que a tela já recebeu, nem o plano B do fundo. O onChanged acompanha a chave de Ajustes na hora: ligou,
    // a leitura começa sem recarregar a página; desligou, as próximas ações já não rodam (o que estiver no ar termina).
    let mlOk = false;
    const consentDe = c => !!(c && c.consentimento_ml);
    try { SHC.mlConsentido(ok => { mlOk = !!ok; inicia(); }); } catch (e) { /* sem storage: fica desligado */ }
    try { chrome.storage.onChanged.addListener((m, area) => { if (area !== 'local' || !m.cfg) return; const era = mlOk; mlOk = consentDe(m.cfg.newValue); if (mlOk && !era) inicia(); }); } catch (e) { /* idem */ }

    function enviaPaginaAtual() {
        if (!mlOk || !/\/anuncios\/lista\/promos/.test(location.pathname)) return;
        const s = document.getElementById('__NORDIC_RENDERING_CTX__');
        const estado = s ? SHC.mlExtraiEstado(s.textContent || '') : null;
        if (!estado) return;
        const dados = SHC.mlPromosDoEstado(estado);
        if (!dados.familias.length) return;
        // V15: leva a conta da página; o fundo descarta se faltar ou se for outra conta do mesmo Chrome.
        try { chrome.runtime.sendMessage({ acao: 'promos_pagina', dados, conta: SHC.mlContaDoEstado(estado) }); } catch (e) { /* extensão recarregada */ }
    }

    // v3.3: experiência de compra que a tela trouxer no estado (o "Analisar desempenho" do anúncio) → o fundo guarda em exp:<conta> (conta conferida).
    function enviaExperiencia() {
        if (!mlOk) return;   // 3.3.1 (C2)
        const s = document.getElementById('__NORDIC_RENDERING_CTX__');
        const estado = s ? SHC.mlExtraiEstado(s.textContent || '') : null;
        const lista = estado && SHC.mlExperienciasDoEstado ? SHC.mlExperienciasDoEstado(estado) : [];
        if (!lista.length) return;
        try { chrome.runtime.sendMessage({ acao: 'experiencia_anuncios', lista, conta: SHC.mlContaDoEstado(estado) }); } catch (e) { /* extensão recarregada */ }
    }

    const espera = ms => new Promise(ok => setTimeout(ok, ms));
    // JSON de uma rota de leitura do painel (só GET, com a sessão desta aba) → objeto | null.
    const getJson = url => fetch(url, Object.assign({ method: 'GET', credentials: 'include', cache: 'no-store', headers: { accept: 'application/json' } },
        typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(30000) } : {}))
        .then(r => (r.ok ? r.json() : null)).catch(() => null);

    // Plano B: o fundo pede uma página do painel e esta aba busca com a sessão dela (só GET, só estas rotas).
    const LEITORES = {
        ler_pagina_promos: { rota: /^\/anuncios\/lista\/promos$/, ler: e => SHC.mlPromosDoEstado(e) },
        ler_pagina_anuncios: { rota: /^\/anuncios(\/lista)?$/, ler: e => SHC.mlPaginaAnuncios(e) },
    };
    chrome.runtime.onMessage.addListener((msg, sender, responder) => {
        if (!mlOk) return false;   // 3.3.1 (C2): ML desligado — o plano B e os GETs com a sessão desta aba não respondem
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
        // v3.2: família fechada / "Ver mais" (o GET do botão "Expandir anúncios"), quando o fundo não leva a sessão. Só esta rota, só GET.
        if (msg && msg.acao === 'ler_json_ml') {
            if (!u || u.origin !== 'https://vendedores.mercadolivre.com.br' || u.pathname !== '/anuncios/api/listing/row/expanded') return false;
            getJson(u.href).then(j => responder(j ? { ok: true, dados: j } : { ok: false }));
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

    // ── v3.2 Editor em massa: leitura PASSIVA. Só quando a seller abre /anuncios/editor-massivo/<sessão>?viewId=listings: lê a grade com os
    // MESMOS GETs que a página usa (lista plana + variações), uma chamada de cada vez, e manda ao fundo (editor:<conta>). Nunca PUT /response,
    // save-* nem .../cells (gravam no ML); não troca aba de colunas (grava preferência). 1 leitura completa a cada 6 h por conta.
    async function lerEditor() {
        if (!mlOk) return;   // 3.3.1 (C2)
        const s = SHC.editorSessao && SHC.editorSessao(location.href);
        if (!s || !s.conta) return;
        // Auditoria 01/10/2026: leitura parcial também espera (1 h desde a última TENTATIVA), e uma 2ª aba do Editor não lê junto.
        const kt = 'editor:tentativa:' + s.conta;
        try {
            const ant = await SHC.lerChave('editor:' + s.conta); if (ant && ant.completo && Date.now() - (ant.ts || 0) < 6 * 3600e3) return;
            const t = (await chrome.storage.local.get(kt))[kt]; if (t && Date.now() - t < 3600e3) return;
        } catch (e) { return; }
        await espera(8000);   // a página carrega primeiro (ela é pesada)
        const a0 = SHC.editorSessao(location.href);
        if (!a0 || a0.sessao !== s.sessao) return;
        try {   // confere de novo depois da espera: outra aba pode ter começado nesse meio tempo
            const t = (await chrome.storage.local.get(kt))[kt]; if (t && Date.now() - t < 3600e3) return;
            await chrome.storage.local.set({ [kt]: Date.now() });
        } catch (e) { return; }
        const d = await SHC.editorLeitura(s.sessao, { get: getJson, pausa: () => espera(1500),
            segue: () => { const a = SHC.editorSessao(location.href); return !!(a && a.sessao === s.sessao); } });
        if (!d || !Object.keys(d.porItem).length) return;
        try { chrome.runtime.sendMessage({ acao: 'editor_anuncios', conta: { sellerId: s.conta }, dados: d }); } catch (e) { /* extensão recarregada */ }
    }

    // 3.3.1 (C2): o 1º envio sai da leitura da cfg lá em cima (e do onChanged quando a chave liga com a página aberta):
    // a página já carregada não perde a leitura por 1 get, e sem o "Concordo e ligar" nada roda.
    function inicia() {
        if (!mlOk) return;
        enviaPaginaAtual();
        try { enviaExperiencia(); } catch (e) { /* tela desconhecida: nada a enviar */ }
        lerEditor().catch(() => {});
    }
})();
