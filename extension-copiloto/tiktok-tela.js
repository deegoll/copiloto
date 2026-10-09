// Copiloto · TikTok Shop — roda no mundo ISOLADO da extensão (document_start) em https://seller-br.tiktok.com, junto do tiktok-pagina.js.
// 3.3.0 (E7): canal PRIVADO. Cria um MessageChannel e entrega 1 porta ao tiktok-pagina.js (pelo postMessage da janela, só para isso).
// Depois do aperto de mão (a 1ª mensagem que chega por uma porta), só vale essa porta: as outras fecham e o postMessage da janela nunca
// grava nada. A ordem dos 2 scripts no document_start não é garantida: a página pede a porta ao começar e ganha outra (até 3 no total).
// O que chega pela porta: formato conferido, tamanho limitado (1 MB), a mesma resposta repetida vai uma vez só, e vai ao fundo:
// {acao:'tiktok_captura', tipo, dados, conta, lido_em, pedido}. Não chama o TikTok. 3.4.0: em Gerenciar produtos desenha a etiqueta de ganho (abaixo).
// pedido = os poucos ids que a página leu do pedido que a TELA fez (ex.: de qual pedido é a gaveta): só texto de dígitos, até 6 campos.
(function () {
    'use strict';
    const TIPOS = ['pedidos_fin', 'transacao', 'extratos', 'areceber', 'saldo', 'saude_perf', 'saude_prazo', 'saude_viol', 'afil', 'camp_rec', 'demonstrativos', 'pedidos_liq', 'pedidos_espera', 'detalhe', 'resumo_fin', 'saude_ind', 'saude_sps', 'devolucoes', 'devolucoes_painel', 'camp_mgt', 'camp_abertas', 'camp_detalhe', 'camp_produtos', 'camp_convites', 'pedidos', 'tarefas', 'produtos', 'produtos_skus'];
    const MAX = 1000000, ultimo = {};
    function recebe(m) {
        try {
            if (!m || typeof m !== 'object' || m.copiloto_tt !== 1 || TIPOS.indexOf(m.tipo) < 0 || !m.dados || typeof m.dados !== 'object') return;
            const txt = JSON.stringify(m.dados);
            if (!txt || txt.length > MAX) return;
            const pedido = {}, mp = m.pedido && typeof m.pedido === 'object' ? m.pedido : {};
            Object.keys(mp).slice(0, 6).forEach(c => { if (/^\w{1,40}$/.test(c) && /^\d{1,25}$/.test(String(mp[c]))) pedido[c] = String(mp[c]); });
            const conta = /^\d{5,25}$/.test(String(m.conta || '')) ? String(m.conta) : 'tiktok', chave = m.tipo + '|' + conta, igual = txt + JSON.stringify(pedido);
            if (ultimo[chave] === igual) return;   // a tela pediu a mesma coisa de novo: já foi
            ultimo[chave] = igual;
            if (m.tipo === 'produtos' || m.tipo === 'produtos_skus') etiquetaTT(m.tipo, JSON.parse(txt), pedido).catch(() => {});
            const p = chrome.runtime.sendMessage({ acao: 'tiktok_captura', tipo: m.tipo, dados: JSON.parse(txt), conta, lido_em: Date.now(), pedido });
            if (p && typeof p.catch === 'function') p.catch(() => { delete ultimo[chave]; });
        } catch (x) { /* extensão recarregada ou resposta estranha: ignora */ }
    }
    // 3.4.0 (N-B): etiqueta de ganho em Gerenciar produtos ("Sobra R$ X · margem Y%" por produto), com o custo do cadastro e a tabela oficial
    // do TikTok (etiqueta-canal.js). A lista fica só nesta aba (o que vai ao fundo é a mesma captura de sempre). cfg.etiquetas.tiktok === false desliga.
    const produtosTT = new Map();
    let vezTT = 0;
    async function etiquetaTT(tipo, dados, pedido) {
        const SHC = globalThis.SHC, CN = globalThis.CopilotoNucleo, E = globalThis.__copilotoEtq;
        if (!SHC || !SHC.etqDosProdutos || !CN || !CN.adaptadores || !CN.adaptadores.tiktok || !E) return;
        const N = CN.adaptadores.tiktok;
        if (tipo === 'produtos') {
            const ps = N.produtosAnunciados(dados);
            if (!Array.isArray(ps)) return;
            produtosTT.clear();
            ps.forEach(p => produtosTT.set(p.produto_id, p));
        } else if (tipo === 'produtos_skus') {
            const ss = N.skusDoProduto(dados), p = pedido && produtosTT.get(pedido.product_id);
            if (!Array.isArray(ss) || !p) return;
            p.skus = ss;   // a seller expandiu a linha: todas as variações
        }
        await redesenhaTT();
    }
    async function redesenhaTT() {
        const SHC = globalThis.SHC, E = globalThis.__copilotoEtq, eu = ++vezTT;
        if (!produtosTT.size || !SHC || !E) return;
        const cfg = await SHC.lerCfg();
        if (eu !== vezTT) return;
        if (cfg && cfg.etiquetas && cfg.etiquetas.tiktok === false) { E.limpa(); return; }
        const ps = SHC.etqDoTikTok([...produtosTT.values()]), custos = await SHC.lerCustos(SHC.etqChaves(ps, 'tiktok'));
        if (eu !== vezTT) return;
        E.mostra('tiktok', SHC.etqDosProdutos('tiktok', ps, custos, cfg, SHC.hoje()));
    }
    try {
        chrome.storage.onChanged.addListener((mud, onde) => {
            if (onde === 'local' && produtosTT.size && Object.keys(mud).some(k => k === 'cfg' || /^c\|(sku(@\d+)?|tiktok)\|/.test(k))) redesenhaTT().catch(() => {});
        });
    } catch (x) { /* sem storage: só a 1ª conta */ }
    const portas = [];
    let porta = null;   // a porta do aperto de mão: depois dela, nenhuma outra vale
    function oferece() {
        if (porta || portas.length >= 3) return;
        const c = new MessageChannel();
        portas.push(c.port1);
        c.port1.onmessage = e => {
            if (!porta) { porta = c.port1; portas.forEach(p => { if (p !== porta) p.close(); }); }
            if (porta === c.port1) recebe(e.data);
        };
        window.postMessage({ copiloto_tt_porta: 1 }, location.origin, [c.port2]);
    }
    // Da janela só vale o pedido de porta da página ({copiloto_tt:1, quer_porta:1}); dado que chega por aqui não grava nada.
    window.addEventListener('message', e => {
        try { if (e.source === window && e.origin === location.origin && e.data && e.data.copiloto_tt === 1 && e.data.quer_porta === 1) oferece(); } catch (x) { /* ignora */ }
    });
    try { oferece(); } catch (x) { /* sem MessageChannel: nada é lido */ }
})();
