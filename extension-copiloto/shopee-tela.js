// Copiloto · Shopee (etiqueta de ganho, N-C) — mundo ISOLADO da extensão (document_start) em https://seller.shopee.com.br, junto do
// shopee-pagina.js. Canal PRIVADO como no tiktok-tela.js: entrega 1 porta (MessageChannel) e, depois do aperto de mão, só ela vale.
// O que chega (a lista de "Meus Produtos", já cortada aos campos da etiqueta) vira etiqueta: adaptador da Shopee do núcleo → custo por SKU,
// imposto e meta do cadastro (SHC.lerCustos, SHC.lerCfg) → SHC.etqDosProdutos → o desenho (etiqueta-tela.js). NADA é gravado e o fundo não
// recebe nada: a lista fica só nesta aba. Só o total de visualizações de cada produto por dia é guardado (etq:hist:shopee, 15 dias), para as
// visitas de 7 dias. O custo mudou no painel → a etiqueta refaz sozinha.
(function () {
    'use strict';
    const MAX = 2000000, HIST = 'etq:hist:shopee';
    let ultima = null, conta = 0;
    async function desenha() {
        const SHC = globalThis.SHC, CN = globalThis.CopilotoNucleo, E = globalThis.__copilotoEtq;
        if (!ultima || !SHC || !CN || !CN.adaptadores || !CN.adaptadores.shopee || !E) return;
        const minha = ++conta, ps = CN.adaptadores.shopee.produtosDaLista(ultima);
        if (!Array.isArray(ps)) return;
        const [custos, cfg, h] = await Promise.all([SHC.lerCustos(SHC.etqChaves(ps, 'shopee')), SHC.lerCfg(), chrome.storage.local.get(HIST)]);
        if (minha !== conta) return;   // chegou outra lista no meio: vale a nova
        // Visitas (pedido da dona 08/10): o total de visualizações de cada dia, para as visitas de 7 dias e a variação (SHC.etqVisitasAcumuladas)
        const dia = SHC.hoje();
        let hist = h[HIST] || {};
        ps.forEach(p => { if (p.visualizacoes !== null) hist = SHC.etqHistGrava(hist, p.produto_id, 'vis', dia, p.visualizacoes); });
        const ids = Object.keys(hist);
        if (ids.length > 3000) ids.slice(0, ids.length - 3000).forEach(k => delete hist[k]);   // teto: lojas enormes
        chrome.storage.local.set({ [HIST]: hist }).catch(() => {});
        const es = SHC.etqDosProdutos('shopee', ps, custos, cfg, dia);
        es.forEach(e => { const v = SHC.etqVisitasAcumuladas((hist[e.produto_id] || {}).vis, dia); if (v) e.extras.push(v); });
        E.mostra('shopee', es);
    }
    function recebe(m) {
        try {
            if (!m || typeof m !== 'object' || m.copiloto_sp !== 1 || m.tipo !== 'produtos' || !m.dados || typeof m.dados !== 'object') return;
            const txt = JSON.stringify(m.dados);
            if (!txt || txt.length > MAX) return;
            ultima = JSON.parse(txt);
            desenha().catch(() => {});
        } catch (x) { /* resposta estranha ou extensão recarregada: ignora */ }
    }
    const portas = [];
    let porta = null;
    function oferece() {
        if (porta || portas.length >= 3) return;
        const c = new MessageChannel();
        portas.push(c.port1);
        c.port1.onmessage = e => {
            if (!porta) { porta = c.port1; portas.forEach(p => { if (p !== porta) p.close(); }); }
            if (porta === c.port1) recebe(e.data);
        };
        window.postMessage({ copiloto_sp_porta: 1 }, location.origin, [c.port2]);
    }
    window.addEventListener('message', e => {
        try { if (e.source === window && e.origin === location.origin && e.data && e.data.copiloto_sp === 1 && e.data.quer_porta === 1) oferece(); } catch (x) { /* ignora */ }
    });
    try { oferece(); } catch (x) { /* sem MessageChannel: nada é lido */ }
    // Custo, imposto ou meta mudaram no painel: refaz com a última lista (sem esperar a Shopee mandar de novo).
    try {
        chrome.storage.onChanged.addListener((mud, onde) => {
            if (onde !== 'local' || !ultima) return;
            // c|sku|… (custo por SKU) e c|sku@<empresa>|… (o da conta de outra empresa, store.js ESPACOS)
            if (Object.keys(mud).some(k => k === 'cfg' || /^c\|sku(@\d+)?\|/.test(k))) desenha().catch(() => {});
        });
    } catch (x) { /* sem storage: só a 1ª conta */ }
})();
