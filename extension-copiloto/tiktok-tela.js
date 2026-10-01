// Copiloto · TikTok Shop — roda no mundo ISOLADO da extensão (document_start) em https://seller-br.tiktok.com, junto do tiktok-pagina.js.
// Recebe o postMessage da própria janela (origem e formato conferidos), limita o tamanho (1 MB), manda a mesma resposta repetida uma vez
// só e entrega ao fundo: {acao:'tiktok_captura', tipo, dados, conta, lido_em}. Não desenha nada na página e não chama o TikTok.
(function () {
    'use strict';
    const TIPOS = ['pedidos_fin', 'transacao', 'extratos', 'areceber', 'saldo', 'pedido', 'saude_perf', 'saude_prazo', 'saude_viol', 'afil', 'camp_rec', 'camp_insc'];
    const MAX = 1000000, ultimo = {};
    window.addEventListener('message', e => {
        try {
            if (e.source !== window || e.origin !== location.origin) return;
            const m = e.data;
            if (!m || typeof m !== 'object' || m.copiloto_tt !== 1 || TIPOS.indexOf(m.tipo) < 0 || !m.dados || typeof m.dados !== 'object') return;
            const txt = JSON.stringify(m.dados);
            if (!txt || txt.length > MAX) return;
            const conta = /^\d{5,25}$/.test(String(m.conta || '')) ? String(m.conta) : 'tiktok', chave = m.tipo + '|' + conta;
            if (ultimo[chave] === txt) return;   // a tela pediu a mesma coisa de novo: já foi
            ultimo[chave] = txt;
            const p = chrome.runtime.sendMessage({ acao: 'tiktok_captura', tipo: m.tipo, dados: JSON.parse(txt), conta, lido_em: Date.now() });
            if (p && typeof p.catch === 'function') p.catch(() => { delete ultimo[chave]; });
        } catch (x) { /* extensão recarregada ou resposta estranha: ignora */ }
    });
})();
