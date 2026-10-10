// SellerHub Copiloto v2.3 — custos do Tiny pela API v2 (token colado pelo seller no painel).
// Só LEITURA: produtos.pesquisa.php (codigo = SKU, preco_custo; preco_custo_medio quando o de custo vem 0).
// Token em chrome.storage.local 'erp:tiny' = {token, ultima:{ts, atualizados, semCusto, mantidos, noMl}} — nunca vai para log.
// Funções puras no topo (tests/copiloto/teste_tiny.js); tinyPuxar recebe fetch/espera para rodar em node.
(function (root) {
    'use strict';
    const SHC = root.SHC || (root.SHC = {});
    const URL_API = 'https://api.tiny.com.br/api2/produtos.pesquisa.php';
    SHC.TINY_ORIGEM = 'https://api.tiny.com.br/*';
    SHC.TINY_CHAVE = 'erp:tiny';

    // Tiny manda decimal com ponto ("12.50", "1.500" = 1,5): nunca passa por SHC.num (que leria "1.500" como mil e quinhentos).
    const dec = v => { const n = typeof v === 'number' ? v : parseFloat(String(v === null || v === undefined ? '' : v).trim().replace(',', '.')); return isFinite(n) && n > 0 ? SHC.r2(n) : 0; };

    /** Pedido de uma página (100 produtos) → {url, init} para fetch. */
    SHC.tinyPedido = (token, pagina) => ({
        url: URL_API,
        init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: String(token || '').trim(), formato: 'json', pesquisa: '', pagina: String(pagina || 1) }).toString(),
        },
    });

    /**
     * Resposta → { ok, pagina, paginas, produtos:[{sku, custo, titulo}] } ou { ok:false, erro:'token'|'acesso'|'limite'|'outro', msg }.
     * Erro 20 (nenhum registro) = conta sem produto: ok com lista vazia. Custo 0 nos dois campos = sem custo (custo 0).
     */
    SHC.tinyLerResposta = function (j) {
        const r = j && j.retorno;
        if (!r) return { ok: false, erro: 'outro', msg: 'O Tiny respondeu num formato que o Copiloto não conhece.' };
        if (String(r.status).toUpperCase() !== 'OK') {
            const cod = Number(r.codigo_erro);
            const txt = ((r.erros || [])[0] || {}).erro || '';
            if (cod === 20) return { ok: true, pagina: 1, paginas: 1, produtos: [] };
            if (cod === 2) return { ok: false, erro: 'token', msg: 'O Tiny recusou o token. Confira se copiou o token inteiro.' };
            if (cod === 5) return { ok: false, erro: 'acesso', msg: 'O Tiny bloqueou o acesso pela API. O plano Começar não tem API; confira o seu plano no Tiny.' };
            if (cod === 6 || cod === 11) return { ok: false, erro: 'limite', msg: 'O Tiny pediu para esperar (muitos acessos).' };
            return { ok: false, erro: 'outro', msg: 'O Tiny respondeu com erro' + (cod ? ' ' + cod : '') + (txt ? ': ' + String(txt).slice(0, 120) : '') + '.' };
        }
        // v3.2 (cruzamento ERP × ML): situacao (A/I) e tipoVariacao (P = pai, V = variação) vêm de graça na mesma resposta. O estoque do Tiny
        // é 1 chamada por produto: não é lido (fica null e o "estoque diferente" não compara). ponytail: o pai da variação (produto.obter) também não.
        const produtos = (r.produtos || []).map(x => (x && x.produto) || x || {}).map(p => ({
            id: p.id === undefined || p.id === null ? '' : String(p.id),
            sku: SHC.normalizaSku(p.codigo),
            custo: dec(p.preco_custo) || dec(p.preco_custo_medio),
            titulo: String(p.nome || '').replace(/\s+/g, ' ').trim().slice(0, 120),
            situacao: !p.situacao || p.situacao === 'A' ? 'A' : 'I',
            tipo: p.tipoVariacao === 'P' ? 'pai' : p.tipoVariacao === 'V' ? 'variacao' : 'simples',
            estoque: null,
        })).filter(p => p.sku);
        const pagina = Number(r.pagina) || 1;
        return { ok: true, pagina, paginas: Math.max(pagina, Number(r.numero_paginas) || 1), produtos };
    };

    /**
     * Custo digitado à mão: origem 'manual', custo sem origem (de antes da origem existir) ou origem 'erp' com valor
     * diferente do último que veio do Tiny (custoErp) — a etiqueta e o painel lateral gravam sem trocar a origem.
     */
    SHC.tinyDigitado = a => !!a && SHC.num(a.custo) > 0 && (a.origem === 'manual' || !a.origem
        || (a.origem === 'erp' && a.custoErp !== undefined && SHC.num(a.custo) !== a.custoErp));

    /**
     * O que gravar. atuais = { 'c|sku|X': dados gravados }. Custo digitado (SHC.tinyDigitado) nunca é trocado; SKU sem custo
     * no c|sku mas com custo antigo por anúncio/família (antigos = Set de chaves c|sku) também fica. Custo 0 no Tiny não
     * apaga nada: conta como "sem custo no Tiny". SKU repetido no Tiny: vale o último. → { lote:{chave:dados}, atualizados, semCusto, mantidos }
     * erp = 'tiny' | 'omie' (gravado junto com origem 'erp' para a tabela dizer de qual ERP veio).
     */
    SHC.tinyDecide = function (produtos, atuais, agora, antigos, erp) {
        const ultimo = new Map();
        (produtos || []).forEach(p => { const k = SHC.chaveSku(p.sku); if (k) ultimo.set(k, p); });
        const lote = {}, out = { lote, atualizados: 0, semCusto: 0, mantidos: 0 };
        ultimo.forEach((p, k) => {
            const a = (atuais || {})[k] || {};
            if (!(p.custo > 0)) { out.semCusto++; return; }
            if (SHC.tinyDigitado(a) || (!(SHC.num(a.custo) > 0) && antigos && antigos.has(k))) { out.mantidos++; return; }
            lote[k] = Object.assign({}, a, { custo: p.custo, custoErp: p.custo, origem: 'erp', atualizado: agora || Date.now() }, erp ? { erp } : {}, a.titulo || !p.titulo ? {} : { titulo: p.titulo });
            out.atualizados++;
        });
        return out;
    };

    /**
     * Lê todas as páginas. opts = { fetch, espera(ms), progresso(pagina, paginas), pausa, esperasLimite:[ms…] }.
     * Erro 6/11: espera e tenta a mesma página de novo (até esperasLimite.length vezes). → [produtos]; erro → throw {erro, msg}.
     */
    SHC.tinyPuxar = async function (token, opts) {
        const o = Object.assign({ pausa: 2500, esperasLimite: [15e3, 30e3, 60e3], progresso: () => {} }, opts || {});
        const todos = [];
        let pagina = 1, paginas = 1, tentativa = 0;
        while (pagina <= paginas && pagina <= 500) {
            const p = SHC.tinyPedido(token, pagina);
            let j;
            try { const r = await o.fetch(p.url, p.init); j = await r.json(); } catch (e) { throw { erro: 'rede', msg: 'Não consegui falar com o Tiny. Confira a internet e tente de novo.' }; }
            const r = SHC.tinyLerResposta(j);
            if (!r.ok && r.erro === 'limite' && tentativa < o.esperasLimite.length) { await o.espera(o.esperasLimite[tentativa++]); continue; }
            if (!r.ok) throw { erro: r.erro, msg: r.erro === 'limite' ? 'O Tiny está recebendo muitos acessos agora. Tente de novo em alguns minutos.' : r.msg };
            tentativa = 0;
            todos.push(...r.produtos);
            paginas = r.paginas;
            o.progresso(pagina, paginas);
            if (++pagina <= paginas) await o.espera(o.pausa);   // ponytail: pausa fixa entre páginas; o limite do Tiny é por empresa (dividido com o SellerHub)
        }
        return todos;
    };

    /**
     * Grava o resultado de tinyPuxar em chrome.storage.local (c|sku|…), cruzando com o retrato da conta (SHC.lerAnuncios):
     * SKU sem custo no c|sku cujo anúncio/família já tem custo antigo (c|ml|…, v2.0) fica com o antigo.
     * noMl = quantos custos gravados são de SKU com anúncio no ML (null sem retrato). erp = 'tiny' | 'omie' (fica em c|sku|….erp).
     * → { atualizados, semCusto, mantidos, noMl }
     */
    SHC.tinyGravar = async function (produtos, erp, opc) {
        const chaves = [...new Set((produtos || []).map(p => SHC.chaveSku(p.sku)).filter(Boolean))];
        // v3.3 multi-empresa: lê e grava pelo caminho da empresa (SHC.areaEmpresa): o ERP de uma empresa nunca grava na outra.
        // opc.empresa: a empresa do COMEÇO da leitura do ERP (revisão 07/10/2026: a conta do ML pode mudar durante os minutos da leitura).
        const emp = opc && typeof opc.empresa === 'string' ? opc.empresa : undefined;
        const area = SHC.areaEmpresa ? SHC.areaEmpresa(emp) : chrome.storage.local;
        const atuais = chaves.length ? await area.get(chaves) : {};
        // F17a (auditoria 30/09): os retratos de TODAS as contas (antes só a aberta) e TODOS os SKUs de cada anúncio (antes só o 1º).
        // v3.3: todas as contas DA MESMA EMPRESA (conta separada em Ajustes não entra na conta das outras).
        let cs = [];
        try { cs = SHC.contasDaEmpresa ? await SHC.contasDaEmpresa(emp) : SHC.contas ? await SHC.contas() : []; } catch (e) { cs = []; }
        const contas = cs.length ? cs : [{ sellerId: undefined, nome: '' }];
        const retratos = await Promise.all(contas.map(c => SHC.lerAnuncios(c.sellerId).catch(() => null)));
        const doMl = new Map(), porConta = contas.map(() => new Set());   // c|sku|X → [{familia, itemId}] dos anúncios dos retratos
        let nItens = 0;
        retratos.forEach((r, ci) => ((r && r.itens) || []).forEach(i => {
            nItens++;
            SHC.skusDoAnuncio(i).forEach(s => { const k = SHC.chaveSku(s); if (!k) return; (doMl.get(k) || doMl.set(k, []).get(k)).push({ familia: i.familia, itemId: i.itemId }); porConta[ci].add(k); });
        }));
        const sem = chaves.filter(k => doMl.has(k) && !(SHC.num((atuais[k] || {}).custo) > 0));
        const achou = sem.length ? await SHC.custosDe([].concat(...sem.map(k => doMl.get(k)))) : new Map();
        const antigos = new Set(sem.filter(k => doMl.get(k).some(i => achou.get(i))));
        const d = SHC.tinyDecide(produtos, atuais, Date.now(), antigos, erp);
        if (Object.keys(d.lote).length) await area.set(d.lote);
        const gravadas = Object.keys(d.lote);
        return { atualizados: d.atualizados, semCusto: d.semCusto, mantidos: d.mantidos, noMl: nItens ? gravadas.filter(k => doMl.has(k)).length : null,
            noMlPorConta: contas.length > 1 ? contas.map((c, ci) => ({ nome: c.nome, n: gravadas.filter(k => porConta[ci].has(k)).length })) : null };
    };

    /** "12 custos atualizados (5 nos seus anúncios do Mercado Livre), 3 SKUs sem custo no Tiny, 2 mantidos porque você digitou" */
    SHC.tinyResumo = function (r) {
        const pl = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);
        // F17a: com 2+ contas, por conta ("5 na conta Loja 1, 3 na conta Loja 2").
        const pc = Array.isArray(r.noMlPorConta) && r.noMlPorConta.some(x => x.n) ? r.noMlPorConta.filter(x => x.n).map(x => x.n + ' na conta ' + x.nome).join(', ') : '';
        const ml = typeof r.noMl === 'number' && r.atualizados ? ' (' + (pc || r.noMl + ' nos seus anúncios do Mercado Livre') + ')' : '';
        return [pl(r.atualizados, 'custo atualizado', 'custos atualizados') + ml, pl(r.semCusto, 'SKU sem custo no Tiny', 'SKUs sem custo no Tiny'),
            pl(r.mantidos, 'mantido porque você digitou', 'mantidos porque você digitou')].join(', ')
            + (r.atualizados && r.noMl === 0 ? '. Nenhum código do Tiny é igual ao SKU dos seus anúncios: confira o SKU no Mercado Livre' : '');
    };
    /** Só os 4 últimos caracteres do token: "••••a1b2". */
    SHC.tinyMascara = t => { const s = String(t || ''); return s ? '••••' + s.slice(-4) : ''; };

    if (typeof module !== 'undefined' && module.exports) module.exports = SHC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
