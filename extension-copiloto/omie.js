// SellerHub Copiloto v2.4.4 — custos do Omie ERP (app_key + app_secret da própria conta do seller, colados no painel).
// Só CONSULTA: POST https://app.omie.com.br/api/v1/estoque/consulta/ {call:'ListarPosEstoque'} (a chamada só lê a posição de estoque;
// nada é criado ou alterado no Omie). Custo = nCMC (custo médio contábil) por cCodigo (= SKU). Paginação por nTotPaginas, 250 ms entre páginas.
// Formato do Omie conferido pela doc oficial (https://app.omie.com.br/api/v1/estoque/consulta/) e por core/ERPOmie.php do SellerHub;
// testar com uma conta real do Omie.
// Credenciais só em chrome.storage.local 'erp:omie' = {appKey, appSecret, ultima:{ts, atualizados, semCusto, mantidos, faltam}} — nunca vão para log,
// planilha ou backup. Funções puras no topo (tests/copiloto/teste_custos_fundo.js); omiePuxar recebe fetch/espera para rodar em node.
(function (root) {
    'use strict';
    const SHC = root.SHC || (root.SHC = {});
    const URL_API = 'https://app.omie.com.br/api/v1/estoque/consulta/';
    SHC.OMIE_ORIGEM = 'https://app.omie.com.br/*';
    SHC.OMIE_CHAVE = 'erp:omie';
    const POR_PAGINA = 500;

    const dec = v => { const n = typeof v === 'number' ? v : parseFloat(String(v === null || v === undefined ? '' : v).trim().replace(',', '.')); return isFinite(n) && n > 0 ? SHC.r2(n) : 0; };
    const dataBR = d => { const s = String(d || ''); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : s; };

    /** Pedido de uma página (500 produtos) → {url, init} para fetch. dataPosicao = 'AAAA-MM-DD' (hoje por padrão). */
    SHC.omiePedido = (cred, pagina, dataPosicao) => ({
        url: URL_API,
        init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                call: 'ListarPosEstoque', app_key: String((cred && cred.appKey) || '').trim(), app_secret: String((cred && cred.appSecret) || '').trim(),
                param: [{ nPagina: pagina || 1, nRegPorPagina: POR_PAGINA, dDataPosicao: dataBR(dataPosicao || SHC.hoje()), cExibeTodos: 'S' }],
            }),
        },
    });

    /**
     * Resposta → { ok, pagina, paginas, produtos:[{sku, custo, titulo}] } ou { ok:false, erro:'credenciais'|'limite'|'outro', msg (pt-BR) }.
     * Erro do Omie vem como {faultstring, faultcode}. Custo 0 (ou sem nCMC) = sem custo no Omie.
     */
    SHC.omieLerResposta = function (j, status) {
        if (status === 425) return { ok: false, erro: 'limite', msg: 'O Omie bloqueou o acesso por 30 minutos (muitos erros seguidos). Tente de novo mais tarde.' };
        if (!j || typeof j !== 'object') return { ok: false, erro: 'outro', msg: 'O Omie respondeu num formato que o Copiloto não conhece.' };
        if (j.faultstring || j.faultcode) {
            const txt = String(j.faultstring || '').trim();
            if (/app_key|app_secret|chave|inv[áa]lid|n[ãa]o autoriz|acesso negado/i.test(txt))
                return { ok: false, erro: 'credenciais', msg: 'O Omie recusou a chave. Confira o App Key e o App Secret no Omie (Configurações › Aplicativos).' };
            if (/limite|bloquead|muitas requisi/i.test(txt)) return { ok: false, erro: 'limite', msg: 'O Omie pediu para esperar (muitos acessos). Tente de novo em alguns minutos.' };
            return { ok: false, erro: 'outro', msg: 'O Omie respondeu com erro' + (txt ? ': ' + txt.slice(0, 120) : '') + '.' };
        }
        if (!Array.isArray(j.produtos)) return { ok: false, erro: 'outro', msg: 'O Omie respondeu num formato que o Copiloto não conhece.' };
        const produtos = j.produtos.map(p => p || {}).map(p => ({
            sku: SHC.normalizaSku(p.cCodigo),
            custo: dec(p.nCMC),
            titulo: String(p.cDescricao || '').replace(/\s+/g, ' ').trim().slice(0, 120),
        })).filter(p => p.sku);
        const pagina = Number(j.nPagina) || 1;
        return { ok: true, pagina, paginas: Math.max(pagina, Number(j.nTotPaginas) || 1), produtos };
    };

    /**
     * Lê todas as páginas. opts = { fetch, espera(ms), progresso(pagina, paginas), pausa (250 ms) }.
     * → [produtos]; erro → throw {erro, msg}. Só POST de consulta (ListarPosEstoque).
     */
    SHC.omiePuxar = async function (cred, opts) {
        const o = Object.assign({ pausa: 250, progresso: () => {} }, opts || {});
        if (!cred || !String(cred.appKey || '').trim() || !String(cred.appSecret || '').trim()) throw { erro: 'credenciais', msg: 'Informe o App Key e o App Secret do Omie.' };
        const todos = [];
        let pagina = 1, paginas = 1;
        while (pagina <= paginas && pagina <= 200) {
            const p = SHC.omiePedido(cred, pagina);
            let j, status = 0;
            try { const r = await o.fetch(p.url, p.init); status = r.status; j = await r.json(); } catch (e) { throw { erro: 'rede', msg: 'Não consegui falar com o Omie. Confira a internet e tente de novo.' }; }
            const r = SHC.omieLerResposta(j, status);
            if (!r.ok) throw { erro: r.erro, msg: r.msg };
            todos.push(...r.produtos);
            paginas = r.paginas;
            o.progresso(pagina, paginas);
            if (++pagina <= paginas) await o.espera(o.pausa);
        }
        return todos;
    };

    /** "12 custos atualizados (…), 3 SKUs sem custo no Omie, 2 mantidos porque você digitou" (mesma regra do Tiny). */
    SHC.omieResumo = r => SHC.tinyResumo(r).replace(/Tiny/g, 'Omie');
    /** Só os 4 últimos caracteres da chave: "••••a1b2". */
    SHC.omieMascara = t => { const s = String(t || ''); return s ? '••••' + s.slice(-4) : ''; };

    if (typeof module !== 'undefined' && module.exports) module.exports = SHC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
