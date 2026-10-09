// copiloto-nucleo · adaptador da Magalu (N-D, etiqueta de ganho; retratos M3 da local, 07/10/2026: tests/copiloto/fixtures/magalu_*.json).
// Só o que a etiqueta usa: a lista de produtos do Portal do Seller, as visitas de 7 dias do produto e a comissão do contrato (Financeiro).
// REGRA: na extensão, só ler o que a tela aberta pela seller recebeu (nada de chamada própria). Nada do comprador; do Financeiro, só a
// comissão (nunca os dados do banco).
(function (root, fabrica) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = fabrica(require('../util'), require('../modelo'));
    else { const CN = root.CopilotoNucleo = root.CopilotoNucleo || {}; (CN.adaptadores = CN.adaptadores || {}).magalu = fabrica(CN.util, CN.modelo); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (U, M) {
    'use strict';
    const centavos = v => { const n = U.num(v); return n === null ? null : U.r2(n / 100); };
    const txt = v => (typeof v === 'string' && v.trim() ? v.trim() : null);

    /**
     * GET api-product-search.magalu.com/seller/v1/portfolios/products → [{ produto_id (o SKU: a Magalu indexa por ele), nome, sku, ativo, preco,
     * preco_cheio, preco_pix, estoque, frete_medio, variacoes: [] }] | naoLido. Preços em CENTAVOS na API (4510 = R$ 45,10); frete médio
     * (score.average_shipping_cost) já em reais. Estoque: a soma de stocks[].available (o resumo por SKU às vezes vem 0 com estoque: não usamos).
     */
    function produtosDaLista(j) {
        const rs = j && Array.isArray(j.results) ? j.results : null;
        if (!rs) return M.naoLido('lista de produtos da Magalu não reconhecida');
        return rs.filter(p => p && txt(p.sku)).map(p => {
            const pr = (Array.isArray(p.prices) ? p.prices : [])[0] || {}, of = p.price_offer || {};
            const st = (Array.isArray(p.stocks) ? p.stocks : []).map(s => U.num(s && s.available)).filter(n => n !== null);
            return { produto_id: txt(p.sku), nome: txt(p.title) || '', sku: txt(p.sku), ativo: p.active !== false && p.status === 'PUBLISHED',
                preco: centavos(pr.price), preco_cheio: centavos(pr.list_price), preco_pix: centavos(of.price_pix),
                estoque: st.length ? st.reduce((a, n) => a + n, 0) : null, frete_medio: U.num((p.score || {}).average_shipping_cost), variacoes: [] };
        });
    }

    /**
     * GET magalu-sellers.magalu.com/ps-financial/api/v1/seller/financial-infos → a comissão do contrato:
     * { pct (a do modo de repasse da conta: com ou sem antecipação automática; null se as categorias diferem), todas_iguais, valores, antecipacao } | naoLido.
     * Os % vêm com vírgula ("15,89"). Nada do banco sai daqui.
     */
    function comissaoDoFinanceiro(j) {
        const ags = j && Array.isArray(j.agreements) ? j.agreements : null, c = ags && ags.find(a => a && a.name === 'commission');
        const fees = c && Array.isArray(c.fees_type) ? [].concat.apply([], c.fees_type.filter(t => t && t.type === 'percentage').map(t => t.fees || [])) : null;
        if (!fees || !fees.length) return M.naoLido('comissão do contrato não encontrada no Financeiro');
        const ant = !!(j.transfer_data && j.transfer_data.auto_anticipate === true);
        const valores = [...new Set(fees.filter(f => f && !!f.auto_anticipate === ant).map(f => U.num(String(f.value).replace(',', '.'))).filter(n => n !== null))].sort((a, b) => a - b);
        if (!valores.length) return M.naoLido('comissão do modo de repasse da conta não encontrada');
        return { pct: valores.length === 1 ? valores[0] : null, todas_iguais: valores.length === 1, valores, antecipacao: ant };
    }

    /** GET api-product.magalu.com/api/v1/product-metrics?sku=… → { visitas, variacao_pct, dias } | null (sem visitas no período). */
    function visitasDasMetricas(j) {
        const v = j && Array.isArray(j.visits) ? j.visits.find(x => x && U.num(x.quantity) !== null) : null;
        return v ? { visitas: U.num(v.quantity), variacao_pct: U.num(v.growth_rate), dias: U.num(v.days) } : null;
    }

    return { produtosDaLista, comissaoDoFinanceiro, visitasDasMetricas };
});
