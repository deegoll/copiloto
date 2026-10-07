// Copiloto · etiqueta de ganho nas listas de produtos dos outros canais (N-B TikTok, N-C Shopee, N-D Magalu; pedido da dona 07/10/2026).
// Junta o cadastro do Copiloto (custo por SKU, imposto e meta da empresa) com a conta da etiqueta do núcleo (CopilotoNucleo.etiqueta).
// Shopee: a conta é o SHC.calcular('sp'), a MESMA do resto do Copiloto (respeita a comissão e a taxa escolhidas em Ajustes; sem escolha, a
// tabela oficial do núcleo). TikTok: tarifas.simular do núcleo (o SHC.calcular não tem TikTok). Magalu: sem tabela lida → "não lido",
// a não ser que a seller informe a comissão em Ajustes (cfg.mg_comissao_pct).
// Só lê o storage e calcula: não grava nada e não chama o canal.
(function (root) {
    'use strict';
    const SHC = root.SHC = root.SHC || {};
    const CN = () => root.CopilotoNucleo || {};
    const CANAL_SHC = { shopee: 'sp' };

    /** opc.calcular da etiqueta para a Shopee: o SHC.calcular('sp') → o formato do núcleo. */
    SHC.etqCalcularSp = cfg => (preco, ctx) => {
        const r = SHC.calcular(CANAL_SHC.shopee, preco, { custo: ctx.custo, outros: ctx.outros }, Object.assign({}, cfg, { imposto_pct: ctx.imposto_pct }));
        if (!r) return null;
        return { lucro: r.sobra_rs, margem_pct: r.sobra_pct, classe: r.classe, repasse: r.recebe_rs, tarifas_rs: SHC.r2(r.comissao_rs + r.taxa_fixa_rs),
            frete_regra: r.frete_regra, avisos: r.tarifa_aviso ? [r.tarifa_aviso] : [], confianca: r.tarifa_regra ? 'oficial' : 'manual' };
    };

    /** SKUs (do produto e das variações) → as chaves c|sku|… do cadastro. */
    SHC.etqChaves = (produtos, canal) => {
        const ks = new Set();
        (produtos || []).forEach(p => {
            [p.sku].concat((p.variacoes || []).map(v => v.sku)).forEach(s => { const k = s ? SHC.chaveSku(s) : ''; if (k) ks.add(k); });
            if (canal === 'tiktok') (p.variacoes || []).forEach(v => { if (v.modelo_id) ks.add('c|tiktok|' + v.modelo_id); });
        });
        return [...ks];
    };
    /** TikTok › Gerenciar produtos (o que o núcleo lê: N.produtosAnunciados / N.skusDoProduto) → os produtos da etiqueta (sem o nome: o TikTok não manda). */
    SHC.etqDoTikTok = lista => (Array.isArray(lista) ? lista : []).filter(p => p && p.produto_id).map(p => {
        const vs = (p.skus || []).map(s => ({ modelo_id: s.sku_id, sku: s.sku || null, preco: s.preco }));
        return { produto_id: p.produto_id, nome: '', sku: (vs.find(v => v.sku) || {}).sku || null, variacoes: vs, total_skus: p.total_skus };
    });

    /**
     * produtos (do adaptador do canal: [{produto_id, nome, sku, preco, variacoes}]) + custos ({c|sku|…: {custo, outros}}) + cfg (SHC.lerCfg)
     * → [{ produto_id, nome, sku, skus, classe, texto, detalhe }] para o desenho. hoje = 'AAAA-MM-DD' (a tabela em vigor).
     */
    SHC.etqDosProdutos = function (canal, produtos, custos, cfg, hoje) {
        const E = CN().etiqueta;
        if (!E) return [];
        // O custo como no resto do Copiloto: SHC.custoDeAnuncio (o SKU, e o kit pela soma dos SKUs de dentro). TikTok: antes, o custo digitado
        // ou ligado na aba do TikTok para a variação (c|tiktok|<sku_id>), como o TT.lucroDoPedido.
        const cs = custos || {}, deDados = x => (x && SHC.num(x.custo) > 0 ? { custo: SHC.num(x.custo), outros: SHC.num(x.outros) || 0 } : null);
        const doSku = sku => {
            if (!sku) return null;
            if (SHC.custoDeAnuncio) { const r = SHC.custoDeAnuncio(cs, { sku }); return r ? deDados(r.dados) : null; }
            const k = SHC.chaveSku(sku); return k ? deDados(cs[k]) : null;
        };
        const custoDe = (sku, v) => {
            if (canal === 'tiktok' && v && v.modelo_id) {
                const lig = cs['c|tiktok|' + v.modelo_id];
                if (lig && SHC.num(lig.custo) > 0) return deDados(lig);
                if (lig && lig.sku) return doSku(lig.sku);
            }
            return doSku(sku);
        };
        const c = cfg || {};
        const base = { imposto_pct: SHC.num(c.imposto_pct) || 0, margem_alvo_pct: SHC.num(c.margem_alvo_pct) || 0, comissao_pct: canal === 'magalu' ? SHC.num(c.mg_comissao_pct) : undefined };
        const opc = canal === 'shopee' && SHC.calcular ? { calcular: SHC.etqCalcularSp(c) } : null;
        return (produtos || []).map(p => {
            const e = E.doProduto(canal, p, custoDe, base, hoje, opc);
            const skus = [...new Set([p.sku].concat((p.variacoes || []).map(v => v.sku)).filter(Boolean))];
            const detalhe = e.variacoes.map(v => (v.sku ? v.sku + ': ' : '') + v.texto + (typeof v.preco === 'number' ? ' (a ' + E.moeda(v.preco) + ')' : '')).join('\n');
            return { produto_id: p.produto_id, nome: p.nome || '', sku: p.sku || '', skus, classe: e.classe, texto: e.texto, detalhe };
        });
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);
