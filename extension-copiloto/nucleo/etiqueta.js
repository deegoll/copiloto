// copiloto-nucleo · etiqueta de ganho por produto nas listas dos canais (N-B TikTok, N-C Shopee, N-D Magalu; pedido da dona 07/10/2026):
// "Sobra R$ X · margem Y%" ao lado de cada produto, com o custo que a seller cadastrou no Copiloto. É a MESMA conta do "E se eu vender a
// R$ X?" (tarifas.simular, a tabela oficial do canal com vigência): nada de segunda conta.
// Regra de ouro: sem custo → "Informe o custo" (nunca lucro inventado); canal sem tabela na data (Magalu sem a comissão lida) → "não lido"
// (nunca zero); variações com preços diferentes → a faixa da menor à maior sobra.
(function (root, fabrica) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = fabrica(require('./util'), require('./modelo'), require('./tarifas'));
    else { const CN = root.CopilotoNucleo = root.CopilotoNucleo || {}; CN.etiqueta = fabrica(CN.util, CN.modelo, CN.tarifas); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (U, M, T) {
    'use strict';

    const NOME = { ml: 'Mercado Livre', tiktok: 'TikTok Shop', shopee: 'Shopee', magalu: 'Magalu' };
    /** R$ no formato da tela: 1234.5 → "R$ 1.234,50". */
    const moeda = v => 'R$ ' + U.r2(Math.abs(v)).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const pct = v => String(Math.round(v * 10) / 10).replace('.', ',') + '%';

    /**
     * Uma variação (ou o produto de preço único) → { classe, texto, sobra, margem_pct, repasse, tarifas_rs, linhas, avisos, preco }.
     * classe: 'lucrativo' | 'apertado' | 'prejuizo' (como o ML) · 'sem_custo' · 'nao_lido' · 'sem_preco'.
     * ctx = o de tarifas.simular: { custo, imposto_pct, outros, frete, frete_padrao, margem_alvo_pct, comissao_pct, … }.
     */
    // opc.calcular(preco, ctx) → { lucro, margem_pct, classe, repasse, tarifas_rs } | null: a conta da casa, quando ela existe (na extensão,
    // a Shopee usa o SHC.calcular, que respeita a comissão e a taxa que a seller escolheu em Ajustes). Sem ela, o tarifas.simular.
    function daVariacao(canal, preco, ctx, data, opc) {
        const p = U.num(preco);
        if (opc && typeof opc.calcular === 'function' && p > 0) {
            const r = opc.calcular(p, ctx || {});
            if (r) {
                const base = { preco: U.r2(p), custo: U.num((ctx || {}).custo) > 0 ? U.r2(U.num(ctx.custo)) : null, repasse: r.repasse, tarifas_rs: r.tarifas_rs, linhas: r.linhas || [], avisos: (r.avisos || []).slice(), frete_regra: r.frete_regra || null, confianca: r.confianca || null };
                if (r.lucro === null || r.lucro === undefined) return Object.assign(base, { classe: 'sem_custo', texto: 'Informe o custo', sobra: null, margem_pct: null });
                return Object.assign(base, { classe: r.classe, sobra: r.lucro, margem_pct: r.margem_pct,
                    texto: (r.lucro < 0 ? 'Prejuízo ' : 'Sobra ') + moeda(r.lucro) + ' · margem ' + pct(r.margem_pct) });
            }
        }
        if (!(p > 0)) return { classe: 'sem_preco', texto: 'Sem preço na lista', preco: null };
        // Canal sem tabela oficial lida (Magalu: a comissão por categoria só aparece logado) e a seller informou a comissão em Ajustes:
        // a conta usa SÓ essa linha, marcada como "manual" (a etiqueta avisa). Sem ela, "não lido".
        const cm = U.num((ctx || {}).comissao_pct), semTabela = !T.vigentes(canal, data).length;
        const s = semTabela && cm !== null && cm >= 0
            ? T.simular(canal, p, ctx || {}, data, [{ canal, tipo: 'comissao', desde: '2000-01-01', ate: null, faixa: [0, null], pct: cm, fonte: { confianca: 'manual' }, nota: 'comissão informada' }])
            : T.simular(canal, p, ctx || {}, data);
        if (!s) return { classe: 'sem_preco', texto: 'Sem preço na lista', preco: null };
        if (M.ehNaoLido(s)) return { classe: 'nao_lido', texto: 'Tarifa da ' + (NOME[canal] || canal) + ' não lida', motivo: s.motivo, preco: U.r2(p) };
        const base = { preco: s.preco, custo: s.custo_rs, repasse: s.repasse, tarifas_rs: s.tarifas_rs, linhas: s.linhas, avisos: s.avisos.slice(), frete_regra: s.frete_regra, confianca: s.confianca };
        if (semTabela) base.avisos.push('comissão informada por você (a tabela da ' + (NOME[canal] || canal) + ' não foi lida)');
        if (s.lucro === null) return Object.assign(base, { classe: 'sem_custo', texto: 'Informe o custo', sobra: null, margem_pct: null });
        return Object.assign(base, { classe: s.classe, sobra: s.lucro, margem_pct: s.margem_pct,
            texto: (s.lucro < 0 ? 'Prejuízo ' : 'Sobra ') + moeda(s.lucro) + ' · margem ' + pct(s.margem_pct) });
    }

    /**
     * Um produto da lista com as variações → a etiqueta do produto + a de cada variação.
     * produto = { produto_id, nome?, sku?, preco?, variacoes: [{ modelo_id?, sku?, preco }] } (sem variações: o preço do produto vale).
     * custoDe(sku, variação|null) → { custo, outros?, imposto_pct? } | null (o cadastro do Copiloto). cfg = { imposto_pct, margem_alvo_pct, frete_padrao, comissao_pct }.
     * → { produto_id, classe, texto, variacoes: [{ modelo_id, sku, …daVariacao }] }. Variação sem custo não entra na faixa; nenhuma com custo → "Informe o custo".
     */
    function doProduto(canal, produto, custoDe, cfg, data, opc) {
        const c = cfg || {}, vs = (produto.variacoes && produto.variacoes.length ? produto.variacoes : [{ sku: produto.sku, preco: produto.preco }]);
        const vars = vs.map(v => {
            // custoDe(sku, variação): o 2º argumento deixa o canal procurar também pelo id da variação (TikTok: c|tiktok|<sku_id>)
            const cad = (custoDe ? custoDe(v.sku || null, v) : null) || (produto.sku && custoDe && produto.sku !== v.sku ? custoDe(produto.sku, null) : null);
            const ctx = { imposto_pct: cad && U.num(cad.imposto_pct) !== null ? cad.imposto_pct : c.imposto_pct, margem_alvo_pct: c.margem_alvo_pct,
                frete_padrao: c.frete_padrao, comissao_pct: c.comissao_pct, custo: cad ? cad.custo : null, outros: cad ? cad.outros : 0 };
            return Object.assign({ modelo_id: v.modelo_id || null, sku: v.sku || produto.sku || null }, daVariacao(canal, v.preco, ctx, data, opc));
        });
        const comConta = vars.filter(v => typeof v.sobra === 'number');
        if (!comConta.length) {
            const nl = vars.find(v => v.classe === 'nao_lido'), sp = vars.every(v => v.classe === 'sem_preco');
            return { produto_id: produto.produto_id, classe: nl ? 'nao_lido' : sp ? 'sem_preco' : 'sem_custo', texto: nl ? nl.texto : sp ? 'Sem preço na lista' : 'Informe o custo', variacoes: vars };
        }
        const min = comConta.reduce((a, v) => (v.sobra < a.sobra ? v : a)), max = comConta.reduce((a, v) => (v.sobra > a.sobra ? v : a));
        const ordem = ['prejuizo', 'apertado', 'lucrativo'], classe = ordem.find(k => comConta.some(v => v.classe === k));
        const faltam = vars.length - comConta.length;
        const texto = (min.sobra === max.sobra ? min.texto
            : (min.sobra < 0 ? 'De prejuízo ' : 'Sobra de ') + moeda(min.sobra) + (max.sobra < 0 ? ' a prejuízo ' : ' a ') + moeda(max.sobra) + ' · margem ' + pct(min.margem_pct) + ' a ' + pct(max.margem_pct))
            + (faltam ? ' · ' + faltam + (faltam === 1 ? ' variação sem custo' : ' variações sem custo') : '');
        return { produto_id: produto.produto_id, classe, texto, sobra_min: min.sobra, sobra_max: max.sobra, variacoes: vars };
    }

    return { daVariacao, doProduto, moeda, pct };
});
