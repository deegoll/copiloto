// copiloto-nucleo · tabela de tarifas por canal com vigência + simulação de preço (substitui o "if (canal === 'ml')" do calc.js).
// Cada linha diz de onde veio (fonte.url + data + confianca: 'retrato' = visto na conta real, 'codigo' = regra que o SellerHub/Copiloto
// já usa, 'oficial' = página do canal, 'secundaria' = blog/consultoria). Linha secundária é palpite bom, não fato: o painel avisa.
(function (root, fabrica) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = fabrica(require('./util'), require('./modelo'));
    else { const CN = root.CopilotoNucleo = root.CopilotoNucleo || {}; CN.tarifas = fabrica(CN.util, CN.modelo); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (U, M) {
    'use strict';

    const F = {
        ml_codigo: { url: 'extension-copiloto/calc.js (taxaFixaML, comissaoPct) = core/MLCustoVenda.php, fallback 2026', data: '2026-09-30', confianca: 'codigo' },
        // Espelho PHP: core/TarifasCanal.php (mesmos números; tests/Unit/TarifasCanalTest.php compara as duas tabelas linha a linha).
        tt_comissao: { url: 'https://seller-br.tiktok.com/university/essay?knowledge_id=24428156307201&lang=pt-BR', data: '2026-09-30', confianca: 'oficial' },
        tt_sfp: { url: 'https://seller-br.tiktok.com/university/essay?knowledge_id=5665577566734097&lang=pt-BR', data: '2026-09-30', confianca: 'oficial' },
        tt_pagamentos: { url: 'https://seller-br.tiktok.com/university/essay?knowledge_id=1442971112769281&lang=pt-BR', data: '2026-09-30', confianca: 'oficial' },
        sp_tabela: { url: 'https://seller.shopee.com.br/edu/article/18483 · https://seller.shopee.com.br/edu/article/26839', data: '2026-09-30', confianca: 'oficial' },
    };

    /**
     * Linha: { canal, tipo (TIPOS_TARIFA), desde, ate (inclusive; null = em vigor), faixa: [mín inclusive, máx exclusivo | null]
     * (sobre o preço UNITÁRIO já com o desconto do vendedor), pct (sobre a base), fixo (R$ por unidade), teto (R$ por unidade, limita
     * a parte em %), se: {campo do contexto: valor}, fonte, nota }. Fixo reduzido (metade do preço) = taxa_fixa com pct 50.
     */
    const TABELA = [
        // ── Mercado Livre: comissão varia por categoria (o seller ajusta: ctx.comissao_pct); taxa fixa por faixa abaixo de R$ 79 ──
        { canal: 'ml', tipo: 'comissao', desde: '2026-01-01', ate: null, faixa: [0, null], pct: 13, se: { tipo_anuncio: 'classico' }, fonte: F.ml_codigo, nota: 'Clássico, padrão; varia por categoria' },
        { canal: 'ml', tipo: 'comissao', desde: '2026-01-01', ate: null, faixa: [0, null], pct: 16.5, se: { tipo_anuncio: 'premium' }, fonte: F.ml_codigo, nota: 'Premium, padrão; varia por categoria' },
        { canal: 'ml', tipo: 'taxa_fixa', desde: '2026-01-01', ate: null, faixa: [0, 12.5], pct: 50, fonte: F.ml_codigo, nota: 'abaixo de R$ 12,50: metade do preço' },
        { canal: 'ml', tipo: 'taxa_fixa', desde: '2026-01-01', ate: null, faixa: [12.5, 19], fixo: 6, fonte: F.ml_codigo },
        { canal: 'ml', tipo: 'taxa_fixa', desde: '2026-01-01', ate: null, faixa: [19, 49], fixo: 7.5, fonte: F.ml_codigo },
        { canal: 'ml', tipo: 'taxa_fixa', desde: '2026-01-01', ate: null, faixa: [49, 79], fixo: 9.5, fonte: F.ml_codigo },

        // ── TikTok Shop BR: base = preço − desconto do vendedor (o cupom da plataforma não reduz a base) ──
        { canal: 'tiktok', tipo: 'comissao', desde: '2026-01-01', ate: '2026-07-14', faixa: [0, null], pct: 6, fonte: F.tt_comissao, nota: 'até 14/07/2026: 6% + R$ 4' },
        { canal: 'tiktok', tipo: 'taxa_fixa', desde: '2026-01-01', ate: '2026-07-14', faixa: [0, null], fixo: 4, fonte: F.tt_comissao },
        { canal: 'tiktok', tipo: 'comissao', desde: '2026-07-15', ate: null, faixa: [0, 50], pct: 10, fonte: F.tt_comissao, nota: 'abaixo de R$ 50' },
        { canal: 'tiktok', tipo: 'taxa_fixa', desde: '2026-07-15', ate: null, faixa: [0, 50], fixo: 4, fonte: F.tt_comissao },
        { canal: 'tiktok', tipo: 'comissao', desde: '2026-07-15', ate: null, faixa: [50, null], pct: 6, fonte: F.tt_comissao, nota: 'a partir de R$ 50' },
        { canal: 'tiktok', tipo: 'taxa_fixa', desde: '2026-07-15', ate: null, faixa: [50, null], fixo: 6, fonte: F.tt_comissao },
        { canal: 'tiktok', tipo: 'programa_frete', desde: '2026-01-01', ate: null, faixa: [0, null], pct: 6, teto: 50, se: { frete_gratis_programa: true }, fonte: F.tt_sfp, nota: 'SFP: 6% com teto de R$ 50 por produto; não volta na devolução' },

        // ── Shopee (CNPJ), desde 01/03/2026: % + fixo por item, por faixa de preço. Troca de 01/10/2026: fixo R$ 4 → R$ 4,50 e
        //    limite do fixo reduzido (metade do preço) R$ 8 → R$ 9. Conta CPF ou desconhecida usa esta tabela (a Shopee só publica a de CNPJ). ──
        { canal: 'shopee', tipo: 'comissao', desde: '2026-03-01', ate: null, faixa: [0, 80], pct: 20, se: { pessoa: 'cnpj' }, fonte: F.sp_tabela },
        { canal: 'shopee', tipo: 'taxa_fixa', desde: '2026-03-01', ate: '2026-09-30', faixa: [0, 8], pct: 50, se: { pessoa: 'cnpj' }, fonte: F.sp_tabela, nota: 'abaixo de R$ 8: metade do preço' },
        { canal: 'shopee', tipo: 'taxa_fixa', desde: '2026-03-01', ate: '2026-09-30', faixa: [8, 80], fixo: 4, se: { pessoa: 'cnpj' }, fonte: F.sp_tabela },
        { canal: 'shopee', tipo: 'taxa_fixa', desde: '2026-10-01', ate: null, faixa: [0, 9], pct: 50, se: { pessoa: 'cnpj' }, fonte: F.sp_tabela, nota: 'abaixo de R$ 9: metade do preço' },
        { canal: 'shopee', tipo: 'taxa_fixa', desde: '2026-10-01', ate: null, faixa: [9, 80], fixo: 4.5, se: { pessoa: 'cnpj' }, fonte: F.sp_tabela },
        { canal: 'shopee', tipo: 'comissao', desde: '2026-03-01', ate: null, faixa: [80, null], pct: 14, se: { pessoa: 'cnpj' }, fonte: F.sp_tabela },
        { canal: 'shopee', tipo: 'taxa_fixa', desde: '2026-03-01', ate: null, faixa: [80, 100], fixo: 16, se: { pessoa: 'cnpj' }, fonte: F.sp_tabela },
        { canal: 'shopee', tipo: 'taxa_fixa', desde: '2026-03-01', ate: null, faixa: [100, 200], fixo: 20, se: { pessoa: 'cnpj' }, fonte: F.sp_tabela },
        { canal: 'shopee', tipo: 'taxa_fixa', desde: '2026-03-01', ate: null, faixa: [200, null], fixo: 26, se: { pessoa: 'cnpj' }, fonte: F.sp_tabela, nota: 'de R$ 200 para cima (R$ 500 → R$ 96)' },
        // Subsídio Pix (artigo 26839, desde 01/03/2026, mantido em 01/10/2026): −5% no item de R$ 80 para cima, SÓ com ctx.pagamento = 'pix'.
        // Dado neutro (30/09/2026): nenhum chamador passa o pagamento hoje, então nenhuma conta atual muda (teste de controle).
        { canal: 'shopee', tipo: 'subsidio', desde: '2026-03-01', ate: null, faixa: [80, null], pct: -5, se: { pessoa: 'cnpj', pagamento: 'pix' }, fonte: F.sp_tabela, nota: 'subsídio Pix' },
    ];

    /** Contexto padrão por canal (o que vale quando o anúncio não diz). */
    const PADRAO_CTX = {
        ml: { tipo_anuncio: 'classico', full: false },
        tiktok: { frete_gratis_programa: true },   // todo vendedor entra no SFP automaticamente (pode sair); retrato 30/09/2026: a conta paga
        shopee: { pessoa: 'cnpj' },
    };
    /** Quem paga o frete na simulação: ML abaixo de R$ 79 (fora do Full) é o comprador. */
    const FRETE = {
        ml: { comprador_paga_abaixo_de: 79, exceto_full: true, pede_valor: true },
    };
    /** Prazo de repasse (dias depois da ENTREGA). TikTok: settlement_days do /dynamic_settlement (3, 7 ou 31). */
    const PRAZO_REPASSE = {
        tiktok: { dias_apos_entrega: 7, alternativas: [3, 7, 31], fonte: F.tt_pagamentos, nota: 'D+7 = (T+6)+1 é o padrão; D+3 = (T+2)+1 é o expresso (nota acima de 3,5, sem punição e sem risco); liquidação "Adiada" = D+31 (verificação de segurança)' },
    };

    /** Linhas em vigor no dia ('AAAA-MM-DD'). Canal sem linha → []. */
    function vigentes(canal, data, tabela) {
        const d = U.dia(data) || U.hoje();
        return (tabela || TABELA).filter(l => l.canal === canal && l.desde <= d && (!l.ate || d <= l.ate));
    }
    const naFaixa = (l, p) => p >= l.faixa[0] && (l.faixa[1] === null || p < l.faixa[1]);
    const casa = (l, ctx) => !l.se || Object.keys(l.se).every(k => ctx[k] === l.se[k]);

    /**
     * Tarifas de UM item a um preço unitário: [{tipo, valor, pct, fixo, regra, fonte}].
     * ctx: {qtd, tipo_anuncio, comissao_pct (substitui a comissão da tabela), frete_gratis_programa, pessoa, afiliado_pct, afiliado_ads_pct}.
     * null = o canal não tem tabela nessa data (NUNCA zero).
     */
    function tarifasDoItem(canal, precoUnit, ctx, data, tabela) {
        const linhas = vigentes(canal, data, tabela);
        if (!linhas.length) return null;
        const c = Object.assign({}, PADRAO_CTX[canal] || {}, ctx || {}), qtd = c.qtd > 0 ? c.qtd : 1, base = precoUnit * qtd;
        if (canal === 'shopee') c.pessoa = 'cnpj';   // a Shopee só publica a tabela de CNPJ: CPF/desconhecido usa ela (simular() avisa)
        let aplic = linhas.filter(l => naFaixa(l, precoUnit) && casa(l, c));
        const comissao = U.num(c.comissao_pct);
        if (comissao !== null && comissao >= 0) aplic = aplic.filter(l => l.tipo !== 'comissao').concat([{ tipo: 'comissao', pct: comissao, nota: 'comissão informada', fonte: { confianca: 'manual' } }]);
        ['afiliado', 'afiliado_ads'].forEach(t => { const p = U.num(c[t + '_pct']); if (p > 0) aplic.push({ tipo: t, pct: p, nota: t + ' informado', fonte: { confianca: 'manual' } }); });
        return aplic.map(l => ({
            tipo: l.tipo, pct: l.pct || 0, fixo: l.fixo || 0, teto: l.teto > 0 ? l.teto : null,
            valor: U.r2((l.pct ? (l.teto > 0 ? Math.min(U.r2(base * l.pct / 100), U.r2(l.teto * qtd)) : U.r2(base * l.pct / 100)) : 0) + (l.fixo ? l.fixo * qtd : 0)),
            regra: (l.pct ? String(l.pct).replace('.', ',') + '%' : '') + (l.pct && l.fixo ? ' + ' : '') + (l.fixo ? 'R$ ' + l.fixo.toFixed(2).replace('.', ',') + '/un.' : '') + (l.teto > 0 ? ' (teto R$ ' + l.teto.toFixed(2).replace('.', ',') + '/un.)' : '') + (l.nota ? ' (' + l.nota + ')' : ''),
            fonte: l.fonte,
        }));
    }

    function freteSimulado(canal, precoUnit, c) {
        const r = FRETE[canal], informado = U.num(c.frete);
        if (r && r.comprador_paga_abaixo_de && precoUnit < r.comprador_paga_abaixo_de && !(r.exceto_full && c.full))
            return { rs: 0, regra: 'Comprador paga o frete (abaixo de R$ ' + r.comprador_paga_abaixo_de + ')', desconhecido: false };
        if (informado !== null) return { rs: informado, regra: 'Frete que você informou', desconhecido: false };
        const padrao = U.num(c.frete_padrao);
        if (padrao > 0) return { rs: padrao, regra: 'Seu frete médio (configurações)', desconhecido: false };
        return { rs: 0, regra: r && r.pede_valor ? 'Frete: informe quanto você paga' : 'Sem frete informado', desconhecido: !!(r && r.pede_valor) };
    }

    /**
     * "E se eu vender a R$ X?" — mesma conta do SHC.calcular, mas lendo a tabela do canal com vigência.
     * ctx: {qtd, custo, outros, frete, frete_padrao, full, imposto_pct, margem_alvo_pct, + os campos de tarifasDoItem}.
     * → { canal, data, preco, qtd, receita, linhas, tarifas_rs, frete_rs, frete_regra, frete_desconhecido, repasse, imposto_rs, custo_rs,
     *     outros_rs, lucro (null sem custo), margem_pct, classe, confianca } | null (preço inválido) | naoLido (sem tabela na data).
     */
    function simular(canal, preco, ctx, data, tabela) {
        const p = U.num(preco);
        if (!(p > 0)) return null;
        const c = Object.assign({}, PADRAO_CTX[canal] || {}, ctx || {}), qtd = c.qtd > 0 ? c.qtd : 1, d = U.dia(data) || U.hoje();
        const linhas = tarifasDoItem(canal, p, c, d, tabela);
        if (!linhas) return M.naoLido('sem tabela de tarifa para ' + canal + ' em ' + d);
        const fr = freteSimulado(canal, p, c), frete = U.r2(fr.rs * qtd);
        const receita = U.r2(p * qtd), tarifas = U.soma(linhas, l => l.valor);
        const repasse = U.r2(receita - tarifas - frete), impPct = U.num(c.imposto_pct) || 0, imposto = U.r2(receita * impPct / 100);
        const custoUn = U.num(c.custo), temCusto = custoUn !== null && custoUn > 0, outros = U.r2((U.num(c.outros) || 0) * qtd);
        const custo = temCusto ? U.r2(custoUn * qtd) : null;
        const lucro = temCusto ? U.r2(repasse - custo - outros - imposto) : null;
        const margem = lucro !== null ? Math.round(lucro / receita * 1000) / 10 : null, alvo = U.num(c.margem_alvo_pct) || 0;
        const confs = linhas.map(l => (l.fonte && l.fonte.confianca) || 'manual'), avisos = [];
        if (!U.dia(data)) avisos.push('sem data da venda: usei a tarifa de hoje');
        if (canal === 'shopee' && (ctx || {}).pessoa !== 'cnpj') avisos.push('tarifa de CNPJ');
        return {
            avisos,
            canal, data: d, preco: U.r2(p), qtd, receita, linhas, tarifas_rs: tarifas,
            frete_rs: frete, frete_regra: fr.regra, frete_desconhecido: fr.desconhecido,
            repasse, imposto_pct: impPct, imposto_rs: imposto, custo_rs: custo, outros_rs: outros, lucro, margem_pct: margem,
            classe: margem === null ? 'sem_custo' : (margem < 0 ? 'prejuizo' : (margem < alvo ? 'apertado' : 'lucrativo')),
            confianca: confs.indexOf('secundaria') >= 0 ? 'secundaria' : (confs.indexOf('codigo') >= 0 ? 'codigo' : (confs[0] || 'manual')),
        };
    }

    /**
     * Menor preço (unitário) que deixa alvoPct% de lucro (0 = empatar). A conta é linear dentro de cada faixa (a taxa fixa e o
     * frete mudam de degrau): resolve faixa a faixa e confere no centavo com o próprio simular(). null = impossível ou sem custo.
     */
    function precoMinimo(canal, ctx, alvoPct, data, tabela) {
        const c = Object.assign({}, ctx || {}, { qtd: 1 });
        if (!(U.num(c.custo) > 0)) return null;
        const d = U.dia(data) || U.hoje(), alvo = (U.num(alvoPct) || 0) / 100, linhas = vigentes(canal, d, tabela);
        if (!linhas.length) return null;
        const cortes = new Set([0.01, 1e7]);
        linhas.forEach(l => { if (l.faixa[0] > 0) cortes.add(l.faixa[0]); if (l.faixa[1]) cortes.add(l.faixa[1]); if (l.teto > 0 && l.pct > 0) cortes.add(U.r2(l.teto * 100 / l.pct)); });
        if (FRETE[canal] && FRETE[canal].comprador_paga_abaixo_de) cortes.add(FRETE[canal].comprador_paga_abaixo_de);
        const pts = Array.from(cortes).sort((a, b) => a - b);
        const f = p => { const s = simular(canal, p, c, d, tabela); return s && !M.ehNaoLido(s) && s.lucro !== null ? s.lucro - U.r2(alvo * p) : null; };
        for (let i = 0; i < pts.length - 1; i++) {
            const lo = pts[i], hi = pts[i + 1], p1 = lo, p2 = Math.min(lo + (hi - lo) / 2, lo + 1000);
            const f1 = f(p1), f2 = f(p2);
            if (f1 === null || f2 === null) continue;
            const incl = (f2 - f1) / (p2 - p1);
            let p = f1 >= 0 ? lo : (incl > 0 ? p1 - f1 / incl : Infinity);
            if (!(p < hi)) continue;
            p = Math.max(lo, U.r2(Math.ceil(p * 100 - 1e-6) / 100 - 0.10));   // 10 centavos antes: a estimativa por 2 pontos e o arredondamento das tarifas erram por centavos
            for (let k = 0; k < 400 && p < hi; k++, p = U.r2(p + 0.01)) { const v = f(p); if (v !== null && v >= -0.0001) return U.r2(p); }
        }
        return null;
    }

    /** Dia previsto do repasse a partir do dia da entrega (TikTok). null = canal sem regra conhecida ou sem entrega. */
    function dataPrevistaRepasse(canal, dataEntrega, dias) {
        const r = PRAZO_REPASSE[canal], d = U.dia(dataEntrega);
        if (!d || (!r && !(dias > 0))) return null;
        return U.somaDias(d, dias > 0 ? dias : r.dias_apos_entrega);
    }

    return { TABELA, FONTES: F, PADRAO_CTX, FRETE, PRAZO_REPASSE, vigentes, tarifasDoItem, simular, precoMinimo, dataPrevistaRepasse };
});
