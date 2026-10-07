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
    SHC.etqChaves = produtos => {
        const ks = new Set();
        (produtos || []).forEach(p => [p.sku].concat((p.variacoes || []).map(v => v.sku)).forEach(s => { const k = s ? SHC.chaveSku(s) : ''; if (k) ks.add(k); }));
        return [...ks];
    };

    /**
     * produtos (do adaptador do canal: [{produto_id, nome, sku, preco, variacoes}]) + custos ({c|sku|…: {custo, outros}}) + cfg (SHC.lerCfg)
     * → [{ produto_id, nome, sku, skus, classe, texto, detalhe }] para o desenho. hoje = 'AAAA-MM-DD' (a tabela em vigor).
     */
    SHC.etqDosProdutos = function (canal, produtos, custos, cfg, hoje) {
        const E = CN().etiqueta;
        if (!E) return [];
        const c = cfg || {}, custoDe = sku => { const k = SHC.chaveSku(sku), x = k && custos ? custos[k] : null; return x && SHC.num(x.custo) > 0 ? { custo: SHC.num(x.custo), outros: SHC.num(x.outros) || 0 } : null; };
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
