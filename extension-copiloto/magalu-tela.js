// Copiloto · Magalu (etiqueta de ganho, N-D) — mundo ISOLADO, junto do magalu-pagina.js. Canal PRIVADO como no shopee-tela.js.
// Produtos → etiqueta "R$ X · custo R$ Y · ≈ Sobra R$ Z · margem W%" (comissão do contrato, lida no Financeiro: estimativa, a Magalu ajusta
// por pedido), + visitas de 7 dias e frete médio com a variação (selos, como no ML). Guardado no Chrome, só: a comissão do contrato
// (etq:mg:comissao) e o frete médio de cada produto por dia (etq:hist:magalu, 15 dias). Nada do comprador; nada do banco.
(function () {
    'use strict';
    const MAX = 2000000, HIST = 'etq:hist:magalu', COM = 'etq:mg:comissao';
    let ultima = null, conta = 0;
    const visitas = {};   // sku → {visitas, variacao_pct}: chegam uma a uma, quando a tela consulta cada produto
    async function desenha() {
        const SHC = globalThis.SHC, CN = globalThis.CopilotoNucleo, E = globalThis.__copilotoEtq;
        if (!ultima || !SHC || !CN || !CN.adaptadores || !CN.adaptadores.magalu || !E) return;
        const minha = ++conta, ps = CN.adaptadores.magalu.produtosDaLista(ultima);
        if (!Array.isArray(ps)) return;
        const [custos, cfg, g] = await Promise.all([SHC.lerCustos(SHC.etqChaves(ps, 'magalu')), SHC.lerCfg(), chrome.storage.local.get([HIST, COM])]);
        if (minha !== conta) return;
        const dia = SHC.hoje(), com = g[COM];
        let hist = g[HIST] || {};
        ps.forEach(p => { if (p.frete_medio !== null) hist = SHC.etqHistGrava(hist, p.produto_id, 'frete', dia, p.frete_medio); });
        chrome.storage.local.set({ [HIST]: hist }).catch(() => {});
        // A comissão: a que a seller digitou em Ajustes manda; senão a do contrato (Financeiro). Sem as duas: "não lida" (nunca suposta).
        const manual = SHC.num(cfg.magalu_comissao_pct) !== null ? SHC.num(cfg.magalu_comissao_pct) : SHC.num(cfg.mg_comissao_pct), contrato = com && SHC.num(com.pct);
        const es = SHC.etqDosProdutos('magalu', ps, custos, Object.assign({}, cfg, { mg_comissao_pct: manual !== null ? manual : contrato }), dia);
        es.forEach(e => {
            if (manual === null && contrato !== null && /^Sobra|^Prejuízo|^De prejuízo|^Sobra de/.test(e.texto)) {
                e.rotulo = e.rotulo.replace(e.texto, '≈ ' + e.texto);
                e.detalhe += '\nComissão de ' + String(contrato).replace('.', ',') + '% do seu contrato (Financeiro da Magalu): estimativa. A Magalu ajusta a comissão em cada pedido.';
            }
            const v = visitas[e.sku];
            const ev = v ? SHC.etqVisitasProntas(v.visitas, v.variacao_pct) : null;
            if (ev) e.extras.push(ev);
            const fr = SHC.etqFreteVariacao((hist[e.produto_id] || {}).frete, dia);
            if (fr) { fr.titulo += ' Fora da conta da sobra: a Magalu não informa quanto do frete é seu.'; e.extras.push(fr); }
        });
        E.mostra('magalu', es);
    }
    function recebe(m) {
        try {
            if (!m || typeof m !== 'object' || m.copiloto_mg !== 1 || !m.dados || typeof m.dados !== 'object') return;
            const txt = JSON.stringify(m.dados);
            if (!txt || txt.length > MAX) return;
            const CN = globalThis.CopilotoNucleo, A = CN && CN.adaptadores && CN.adaptadores.magalu;
            if (m.tipo === 'produtos') { ultima = JSON.parse(txt); desenha().catch(() => {}); }
            else if (m.tipo === 'visitas' && A && typeof m.sku === 'string' && m.sku) {
                const v = A.visitasDasMetricas(JSON.parse(txt));
                if (v) { visitas[m.sku] = v; if (ultima) desenha().catch(() => {}); }
            } else if (m.tipo === 'comissao' && A) {
                const c = A.comissaoDoFinanceiro(JSON.parse(txt));
                if (c && !c.nao_lido) chrome.storage.local.set({ [COM]: { pct: c.pct, todas_iguais: c.todas_iguais, valores: c.valores.slice(0, 20), antecipacao: c.antecipacao, lido_em: Date.now() } }).catch(() => {});
            }
        } catch (x) { /* ignora */ }
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
        window.postMessage({ copiloto_mg_porta: 1 }, location.origin, [c.port2]);
    }
    window.addEventListener('message', e => {
        try { if (e.source === window && e.origin === location.origin && e.data && e.data.copiloto_mg === 1 && e.data.quer_porta === 1) oferece(); } catch (x) { /* ignora */ }
    });
    try { oferece(); } catch (x) { /* sem MessageChannel: nada é lido */ }
    try {
        chrome.storage.onChanged.addListener((mud, onde) => {
            if (onde === 'local' && ultima && Object.keys(mud).some(k => k === 'cfg' || k === COM || /^c\|sku(@\d+)?\|/.test(k))) desenha().catch(() => {});
        });
    } catch (x) { /* sem storage */ }
})();
