// copiloto-nucleo · adaptador do TikTok Shop BR (esqueleto + conversores já testados nos retratos reais).
// Campos: tests/copiloto/MAPEAMENTO-TIKTOK.md (ao vivo, 29–30/09/2026). REGRA: os Termos do Vendedor BR proíbem bot/scraper/"qualquer
// outro meio automatizado" sem permissão por escrito → na extensão, SÓ ler a resposta que a própria tela aberta pela seller recebeu
// (nada de fetch em segundo plano, nada de POST, nada de navegar sozinho). O caminho de volume é o app ISV pelo servidor (TikTokShopAPI.php).
// Dinheiro do financeiro: {amount:"549.9"} (ponto decimal; negativo = sai do vendedor). Pedidos: {format_price:"R$ 546,36"}.
// Datas: financeiro em ms (texto), pedidos em segundos. Ids de 18–19 dígitos: SEMPRE texto.
(function (root, fabrica) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = fabrica(require('../util'), require('../modelo'), require('../tarifas'), require('../adaptador'));
    else { const CN = root.CopilotoNucleo = root.CopilotoNucleo || {}; (CN.adaptadores = CN.adaptadores || {}).tiktok = fabrica(CN.util, CN.modelo, CN.tarifas, CN.adaptador); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (U, M, T, A) {
    'use strict';

    const O = (conta, fonte) => ({ canal: 'tiktok', conta: String(conta || ''), fonte: fonte || 'tela' });
    /** {amount:"-32.99"} → −32.99 · {format_price:"R$ 546,36"} → 546.36 · número → número · resto → null. */
    function dinheiro(a) {
        if (a === null || a === undefined) return null;
        if (typeof a === 'number') return isFinite(a) ? a : null;
        if (typeof a === 'object') {
            if (a.amount !== undefined) { const n = typeof a.amount === 'object' ? dinheiro(a.amount) : Number(String(a.amount).trim()); return n === null || !isFinite(n) ? null : U.r2(n); }
            if (a.format_price !== undefined) return U.num(a.format_price);
            return null;
        }
        const n = Number(String(a).trim());
        return isFinite(n) ? U.r2(n) : U.num(a);
    }
    const idTxt = v => (v === null || v === undefined || v === '' || v === '0' ? null : String(v));
    const resposta = j => (j && j.data && typeof j.code === 'number') ? (j.code === 0 ? j.data : null) : j;

    /** type (ou starling_key) da tarifa → tipo padronizado. Mapeado pela chave, nunca pelo texto em inglês. */
    const TIPOS = {
        platform_commission: 'comissao',
        finance_statement_fee_name_br_fix_commission_fee_tooltip: 'taxa_fixa',
        sfp_service_fee: 'programa_frete',
        affiliate_commission: 'afiliado',
        affiliate_ads_commission: 'afiliado_ads',
        transaction_fee: 'pagamento',
        fbt_fulfillment_fee: 'armazenagem',
    };
    const PELA_CHAVE = [
        [/platform_commission/, 'comissao'], [/fee_per_item_sold|fix_commission/, 'taxa_fixa'], [/_sfp\b|sfp_/, 'programa_frete'],
        [/affiliate.*ads|shop_ads/, 'afiliado_ads'], [/affiliate/, 'afiliado'], [/transaction_fee|payment_fee/, 'pagamento'],
        [/fulfil|fbt|warehouse/, 'armazenagem'], [/return_shipping|reverse_shipping/, 'frete_devolucao'], [/gmv_?pay/, 'ads'],
    ];
    // GMV Pay (ads.tiktok.com/help/article/about-gmv-pay): anúncio pago com o repasse. SUPOSIÇÃO (30/09/2026): a chave e o texto
    // reais nunca foram vistos no extrato desta conta; mapeamos o nome documentado. Sem casar, continua 'outro' (com aviso).
    const PELO_TEXTO = [[/pagamento de gmv para an[uú]ncios|gmv pay/i, 'ads']];
    function tipoTarifa(f) {
        if (f && TIPOS[f.type]) return TIPOS[f.type];
        const k = String((f && f.starling && f.starling.starling_key) || '') + ' ' + String((f && f.type) || '');
        const achou = PELA_CHAVE.find(p => p[0].test(k)) || PELO_TEXTO.find(p => p[0].test(texto(f)));
        return achou ? achou[1] : 'outro';
    }
    /** Folhas da árvore de tarifas (grupo com sub_fees não conta: senão soma duas vezes). */
    function folhas(lista) {
        const out = [];
        (lista || []).forEach(f => { if (!f || typeof f !== 'object') return; if (Array.isArray(f.sub_fees) && f.sub_fees.length) out.push.apply(out, folhas(f.sub_fees)); else out.push(f); });
        return out;
    }
    const texto = f => String((f && f.starling && f.starling.starling_text) || (f && f.type) || '');
    /** source_page_types → "Live", "Video", "Product card" (juntos com " + "). */
    const canalVendaDe = l => (Array.isArray(l) ? l : []).map(s => (s && s.starling_text) || '').filter(Boolean).join(' + ') || null;
    /** settlement_status 2 = liquidado; 1 = a liquidar ("Est."). */
    const statusRepasse = s => (Number(s) === 2 ? 'disponivel' : (Number(s) === 1 ? 'a_liberar' : 'retido'));

    /**
     * Extrato de UM pedido (GET /api/v1/pay/statement/transaction/detail, page_type 8 — ou o sku_record da page_type 9) →
     * { pedido_id, extrato_detalhe_id, data, receita: {bruto, desconto_vendedor, reembolso, outros}, tarifas: Tarifa[], frete: Frete|null,
     *   repasse: Repasse, afiliados: Afiliado[], canal_venda, linha_zero, confere: {calculado, extrato, diferenca}, avisos } | naoLido.
     * Conferido nos 4 casos reais: settlement_amount = receita − tarifas (frete líquido incluso).
     */
    function transacaoDoExtrato(j, opts) {
        opts = opts || {};
        const d = resposta(j);
        const r = d && (d.order_record || d.sku_record || (d.statement_detail_id || d.statement_sku_detail_id ? d : null));
        if (!r) return M.naoLido('extrato do pedido não reconhecido' + (j && j.code ? ' (code ' + j.code + ')' : ''));
        const conta = opts.conta, avisos = [];
        const pedidoId = idTxt(r.trade_order_id || r.reference_id || opts.pedido_id);
        const data = U.dia(r.placed_time) || U.dia(opts.data);
        if (!data) return M.naoLido('extrato sem data do pedido');
        const pendente = Number(r.settlement_status) === 1;

        const rec = { bruto: 0, desconto_vendedor: 0, reembolso: 0, outros: 0 };
        folhas(r.in_come && r.in_come.fee_list).forEach(f => {
            const v = dinheiro(f.amount);
            if (v === null) { avisos.push('receita sem valor: ' + texto(f)); return; }
            if (f.type === 'subtotal_before_discount') rec.bruto = U.r2(rec.bruto + v);
            else if (f.type === 'seller_discount') rec.desconto_vendedor = U.r2(rec.desconto_vendedor - v);
            else if (f.type === 'subtotal_after_discount_refund') rec.reembolso = U.r2(rec.reembolso - v);
            else { rec.outros = U.r2(rec.outros + v); avisos.push('receita não mapeada: ' + (f.type || texto(f)) + ' (' + v + ')'); }
        });
        const tarifas = [];
        const baseT = Object.assign(O(conta, opts.fonte), { pedido_id: pedidoId, data, origem_pagamento: 'venda' });
        folhas(r.out_come && r.out_come.fee_list).forEach(f => {
            const v = dinheiro(f.amount);
            if (v === null) { avisos.push('tarifa sem valor: ' + texto(f)); return; }
            const tipo = tipoTarifa(f);
            if (tipo === 'outro') avisos.push('tarifa não mapeada: ' + (f.type || (f.starling && f.starling.starling_key) || texto(f)));
            tarifas.push(M.criar('tarifa', Object.assign({}, baseT, { id: f.statement_item_id !== undefined ? pedidoId + '#' + f.statement_item_id : null, tipo, valor: U.r2(-v),
                texto_original: texto(f), estimada: pendente || /^est\./i.test(texto(f)), tipo_canal: f.type || '' })));
        });

        // Frete: custo do envio (−), pago pelo cliente (+), coberto pelo TikTok (+). Líquido = o que sobra para o vendedor.
        let frete = null;
        const sf = r.shipping_fee_detail && Array.isArray(r.shipping_fee_detail.fee_list) ? folhas(r.shipping_fee_detail.fee_list) : null;
        if (sf) {
            let cheio = 0, cliente = 0, subsidio = 0, outros = 0, peso = null, desc = '';
            sf.forEach(f => {
                const v = dinheiro(f.amount) || 0, k = String((f.starling && f.starling.starling_key) || '');
                if (f.type === 'fbm_shipping_fee' || /forward_shipping/.test(k)) {
                    cheio = U.r2(cheio - v);
                    const m = /weight\s*:\s*(\d+)\s*g/i.exec(String(f.description || '') + ' ' + String((f.extra && f.extra.weight) || ''));
                    if (m) peso = Number(m[1]);
                    desc = String(f.description || '').replace(/[()]/g, '').trim();
                } else if (/customer_shipping_payment/.test(k)) cliente = U.r2(cliente + v);
                else if (f.type === 'shipping_fee_discount' || /covered|subsid/.test(k)) subsidio = U.r2(subsidio + v);
                else { outros = U.r2(outros + v); avisos.push('frete não mapeado: ' + (f.type || k)); }
            });
            const liquido = U.r2(cheio - cliente - subsidio - outros);
            frete = M.criar('frete', Object.assign(O(conta, opts.fonte), { pedido_id: pedidoId, cobrado_vendedor: liquido, pago_comprador: cliente, cheio, subsidio, peso_cobrado_g: peso, descricao: desc }));
            tarifas.push(M.criar('tarifa', Object.assign({}, baseT, { id: pedidoId + '#frete', tipo: 'frete_venda', valor: liquido, texto_original: 'Frete líquido (custo − cliente − subsídio)', estimada: pendente })));
        } else {
            const ship = dinheiro(r.shipping_amount);
            if (ship !== null && ship !== 0) tarifas.push(M.criar('tarifa', Object.assign({}, baseT, { id: pedidoId + '#frete', tipo: 'frete_venda', valor: U.r2(-ship), texto_original: 'shipping_amount', estimada: pendente })));
        }

        const base = U.r2(rec.bruto - rec.desconto_vendedor);
        const afiliados = tarifas.filter(t => t.tipo === 'afiliado' || t.tipo === 'afiliado_ads').map(t => M.criar('afiliado', Object.assign(O(conta, opts.fonte), {
            pedido_id: pedidoId, comissao_valor: t.valor, comissao_pct: base > 0 ? Math.round(t.valor / base * 10000) / 100 : null, via_ads: t.tipo === 'afiliado_ads',
            estado: pendente ? 'estimado' : 'liquidado',
        })));

        const liquidado = dinheiro(r.settlement_amount);
        const calculado = U.r2(rec.bruto - rec.desconto_vendedor - rec.reembolso + rec.outros - U.soma(tarifas, t => t.valor));
        const status = statusRepasse(r.settlement_status);
        if ([1, 2].indexOf(Number(r.settlement_status)) < 0) avisos.push('settlement_status desconhecido: ' + r.settlement_status);
        const canalVenda = canalVendaDe(r.source_page_types);
        const repasse = liquidado === null ? M.naoLido('extrato sem settlement_amount') : M.criar('repasse', Object.assign(O(conta, opts.fonte), {
            id: String(r.statement_detail_id || r.statement_sku_detail_id || pedidoId + '#extrato'), valor: liquidado, status, estimado: pendente,
            data_liberada: status === 'disponivel' ? U.dia(r.settlement_time) : null,
            data_prevista: U.dia(r.estimate_settle_time) || null,
            motivo: String(r.to_settle_reason || ''), pedidos: pedidoId ? [pedidoId] : [], extrato_id: idTxt(r.statement_id),
        }));
        const zero = rec.bruto === 0 && !tarifas.some(t => t.valor !== 0) && liquidado === 0;
        const diferenca = liquidado === null ? null : U.r2(liquidado - calculado);
        if (diferenca !== null && Math.abs(diferenca) > 0.01) avisos.push('extrato não fecha: calculado ' + calculado + ' × TikTok ' + liquidado);
        return {
            pedido_id: pedidoId, extrato_detalhe_id: idTxt(r.statement_detail_id || r.statement_sku_detail_id), data, receita: rec, tarifas, frete, repasse,
            afiliados, canal_venda: canalVenda, linha_zero: zero, pendente, confere: { calculado, extrato: liquidado, diferenca }, avisos,
        };
    }

    /**
     * Junta várias transações do MESMO pedido (o TikTok pode lançar o pedido em mais de um extrato: devolução = linha −32,99 e depois
     * linha zerada). Soma por pedido e tira repetição pelo extrato_detalhe_id. → [{pedido_id, receita, tarifas, repasses, frete, afiliados}]
     */
    function juntaPorPedido(transacoes) {
        const g = {}, vistos = new Set();
        (transacoes || []).forEach(t => {
            if (!t || M.ehNaoLido(t) || !t.pedido_id) return;
            if (t.extrato_detalhe_id) { if (vistos.has(t.extrato_detalhe_id)) return; vistos.add(t.extrato_detalhe_id); }
            const p = g[t.pedido_id] || (g[t.pedido_id] = { pedido_id: t.pedido_id, data: t.data, receita: { bruto: 0, desconto_vendedor: 0, reembolso: 0, outros: 0 }, tarifas: [], repasses: [], frete: null, afiliados: [], canal_venda: null, avisos: [] });
            if (t.linha_zero) { if (!M.ehNaoLido(t.repasse)) p.repasses.push(t.repasse); return; }
            Object.keys(p.receita).forEach(k => { p.receita[k] = U.r2(p.receita[k] + (t.receita[k] || 0)); });
            p.tarifas.push.apply(p.tarifas, t.tarifas);
            if (!M.ehNaoLido(t.repasse)) p.repasses.push(t.repasse);
            if (t.frete && !p.frete) p.frete = t.frete;
            p.afiliados.push.apply(p.afiliados, t.afiliados);
            p.canal_venda = p.canal_venda || t.canal_venda;
            p.avisos.push.apply(p.avisos, t.avisos);
        });
        return Object.keys(g).map(k => g[k]);
    }

    // Códigos do Open API (Order Status). O Seller Center usa códigos internos (ex.: main_order_status 2000): mapeamos pelo que é
    // inequívoco (reembolso concluído, entregue, cancelado) e marcamos o resto como 'pago' com aviso.
    const STATUS_OPEN_API = { 100: 'pago', 105: 'pago', 111: 'pago', 112: 'enviado', 121: 'enviado', 122: 'entregue', 130: 'entregue', 140: 'cancelado' };

    /**
     * Detalhe do pedido (GET /api/v1/trade/orders/get?main_order_id=) → { pedido, devolucao|null, avisos }. Nada do comprador é lido.
     * Receita do vendedor = preço de origem − desconto do vendedor (o cupom da plataforma não sai dele).
     */
    function pedidoDoDetalhe(j, opts) {
        opts = opts || {};
        const d = resposta(j), m = d && d.main_order;
        if (!m || !m.main_order_id) return { pedido: M.naoLido('detalhe do pedido não reconhecido'), devolucao: null, avisos: [] };
        const avisos = [], pi = m.payment_info || {}, skus = Array.isArray(m.skus) ? m.skus : [];
        const origem = dinheiro(pi.main_order_origin_sale_price), subtotal = dinheiro(pi.subtotal), plat = dinheiro(pi.platform_discount_total) || 0;
        const descVend = dinheiro(pi.seller_discount_total) || 0;
        const somaUnit = U.soma(skus, s => (dinheiro(s.total_price) !== null ? dinheiro(s.total_price) : (dinheiro(s.unit_price) || 0) * (s.quantity || 1)));
        const itens = skus.map(s => {
            const tot = dinheiro(s.total_price) !== null ? dinheiro(s.total_price) : U.r2((dinheiro(s.unit_price) || 0) * (s.quantity || 1));
            // O preço do SKU já vem SEM o cupom da plataforma e SEM o desconto do vendedor: volta ao preço de origem pela participação.
            const linha = origem !== null && somaUnit > 0 ? U.r2(origem * tot / somaUnit) : null;
            return { sku: String(s.seller_sku_name || ''), anuncio_id: idTxt(s.sku_id) || '', titulo: String(s.product_name || '').slice(0, 200) + (s.sku_name ? ' · ' + s.sku_name : ''),
                qtd: Number(s.quantity) || 1, total: linha, preco_unit: linha === null ? null : U.r2(linha / (Number(s.quantity) || 1)) };
        });
        if (skus.length > 1) avisos.push('vários SKUs: preço de origem rateado pelo preço pago');
        if (origem !== null && subtotal !== null && Math.abs(origem - descVend - plat - subtotal) > 0.05) avisos.push('preço de origem − descontos ≠ subtotal (' + origem + ' − ' + descVend + ' − ' + plat + ' ≠ ' + subtotal + ')');
        const rv = m.reverse_info || null, refundOk = (m.trans_histories || []).some(h => h && /refund complete/i.test(String(h.description || '')));
        const entregue = m.logistic_info && /delivered/i.test(String(m.logistic_info.title || ''));
        let status = STATUS_OPEN_API[(skus[0] || {}).sku_display_status] || null;
        if (rv && (refundOk || Number(rv.reverse_status) === 100)) status = 'devolvido';
        else if (!status) { status = entregue ? 'entregue' : 'pago'; if (!entregue) avisos.push('status não mapeado: ' + m.main_order_status + '/' + m.main_order_display_status); }
        // Devolvido (reembolso concluído ou reverse_status 100): o detalhe não traz o valor → considerado TOTAL (origem − desconto do vendedor).
        // Assim o motor tira comissão e fixo e deixa só o SFP, que não volta. Com o Financeiro lido, vale o valor dele (a extensão compara).
        const reembolso = status === 'devolvido' && itens.length && itens.every(it => it.total !== null) ? Math.max(0, U.r2(U.soma(itens, it => it.total) - descVend)) : 0;
        const pick = Number(m.pick_up_type || ((skus[0] || {}).package_pickup_detail || {}).pick_up_type);
        const pedido = M.criar('pedido', Object.assign(O(opts.conta, opts.fonte), {
            id: String(m.main_order_id), data_venda: U.dia(m.main_order_create_time), data_entrega: entregue ? U.dia(m.logistic_info.time) : null,
            status, itens, desconto_vendedor: descVend, desconto_plataforma: plat, reembolso,
            logistica: pick === 2 ? 'agencia' : (pick === 1 ? 'coleta' : null), pagamento: String(m.pay_method || ''),
        }));
        // reverse_type 2 = reembolso sem devolução do produto (conferido: "não recebi" → suporte reembolsou 100%; o vendedor perde o produto).
        const devolucao = rv ? M.criar('devolucao', Object.assign(O(opts.conta, opts.fonte), {
            pedido_id: String(m.main_order_id), motivo: String(rv.reverse_reason || ''), estado: refundOk ? 'reembolsado' : String(rv.reverse_status || ''),
            produto_voltou: Number(rv.reverse_type) === 2 ? false : null, reverse_id: idTxt(rv.reverse_order_id),
        })) : null;
        return { pedido, devolucao, avisos };
    }

    /**
     * Lista de extratos (GET /api/v1/pay/statement/list/detail) → Repasse[] no nível do EXTRATO (pedidos: [] — ligue pelos pedidos do
     * extrato). payment_status 20 = pago, 1 = aguardando. Confere settle = earning + fees + shipping + adjust (aviso quando não fecha).
     */
    function repassesDosExtratos(j, conta) {
        const d = resposta(j), recs = d && d.statement_records;
        if (!Array.isArray(recs)) return M.naoLido('lista de extratos não reconhecida');
        return recs.filter(s => s && typeof s === 'object' && !Array.isArray(s) && s.statement_id).map(s => {
            const liq = dinheiro(s.settle_amount !== undefined ? s.settle_amount : s.payable_amount);
            const calc = U.r2((dinheiro(s.earning_amount) || 0) + (dinheiro(s.fee_amount) || 0) + (dinheiro(s.shipping_amount) || 0) + (dinheiro(s.adjust_amount) || 0));
            const pago = Number(s.payment_status) === 20;
            return M.criar('repasse', Object.assign(O(conta), {
                id: String(s.statement_id), valor: liq, status: pago ? 'disponivel' : 'a_liberar', data_liberada: pago ? U.dia(s.settlement_time) : null,
                data_prevista: U.dia(Number(s.bill_period)) ? U.somaDias(U.dia(Number(s.bill_period)), 1) : null,
                motivo: String(s.payment_pending_reason || ''), pedidos: [], nivel: 'extrato',
                receita: dinheiro(s.earning_amount), tarifas: dinheiro(s.fee_amount), frete: dinheiro(s.shipping_amount), ajuste: dinheiro(s.adjust_amount),
                retido: dinheiro(s.total_reserve_amount), confere: liq === null ? null : U.r2(liq - calc),
            }));
        });
    }

    /** Saúde (growth_center/performance/list + dynamic_settlement) → Saude[]. operator le = menor é melhor. */
    function saudeDaConta(j, conta) {
        const out = [];
        const pl = resposta(j && j.performance_list), ds = resposta(j && j.dynamic_settlement);
        ((pl && pl.indicators) || []).forEach(i => {
            if (!i || !i.title) return;
            const id = String(i.title).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
            out.push(M.criar('saude', Object.assign(O(conta), { indicador: id, titulo: String(i.title), valor: typeof i.value === 'number' ? i.value : null,
                meta: typeof i.target_value === 'number' ? i.target_value : null, direcao: i.operator === 'ge' ? 'maior_melhor' : (i.operator === 'le' ? 'menor_melhor' : null),
                efeito_se_falhar: i.has_related_violation ? 'gera ponto de violação' : '' })));
        });
        if (ds && typeof ds.settlement_days === 'number') {
            const falta = (ds.items || []).filter(x => x && x.valid === false).map(x => x.property_display + (x.current_value ? ' (hoje ' + String(x.current_value).replace('.', ',') + ')' : '')).join('; ');
            out.push(M.criar('saude', Object.assign(O(conta), { indicador: 'prazo_repasse_dias', titulo: 'Dias entre a entrega e o repasse', valor: ds.settlement_days,
                meta: typeof ds.better_settlement_days === 'number' ? ds.better_settlement_days : null, direcao: 'menor_melhor',
                efeito_se_falhar: falta ? 'para receber mais rápido falta: ' + falta : '' })));
        }
        const v = violacoes(j && j.violation_overview);
        if (!M.ehNaoLido(v)) out.push(M.criar('saude', Object.assign(O(conta), { indicador: 'pontos_violacao', titulo: 'Pontos de violação', valor: v.pontos,
            meta: v.faixa_baixo_risco, direcao: 'menor_melhor', efeito_se_falhar: v.pontos > 0 ? 'pontos altos limitam a loja' : '' })));
        return out;
    }

    /** violation/overview/get → { pontos, faixa_baixo_risco, novas, tipos: [{tipo, qtd, pontos}] } | naoLido. */
    function violacoes(j) {
        const d = resposta(j);
        if (!d || typeof d.violation_score !== 'number') return M.naoLido('violações não lidas');
        const baixo = (d.section_infos || []).find(s => s && /low/i.test(String(s.risk_level || '')));
        return {
            pontos: d.violation_score, faixa_baixo_risco: baixo && typeof baixo.right_node === 'number' ? baixo.right_node : null,
            novas: !!(d.has_new_violation || d.has_new_warning),
            tipos: (d.violation_points_v2 || []).filter(x => x && typeof x === 'object').map(x => ({ tipo: String(x.violation_type_str || x.violation_type_key || ''), qtd: Number(x.count) || 0, pontos: Number(x.violation_score) || 0 })),
        };
    }

    /**
     * Lista de pedidos do Financeiro (GET /api/v1/pay/statement/order/list) → um registro por pedido | naoLido.
     * NÃO traz o SKU do vendedor (só o sku_id do TikTok): a ligação vem do detalhe do pedido ou do "ligar ao SKU".
     * receita = earning_amount (já sem o desconto do vendedor); tarifas_total e frete saem POSITIVOS (o que o vendedor paga).
     * confere = settlement − (earning + fees + shipping): 0 quando o pedido fecha.
     */
    function pedidosDaListaFinanceira(j, opts) {
        opts = opts || {};
        const d = resposta(j), recs = d && d.order_records;
        if (!Array.isArray(recs)) return M.naoLido('lista de pedidos do financeiro não reconhecida');
        const neg = v => (v === null ? null : U.r2(-v));
        return recs.filter(r => r && typeof r === 'object' && idTxt(r.trade_order_id || r.reference_id) && U.dia(r.placed_time)).map(r => {
            const id = idTxt(r.trade_order_id || r.reference_id), status = statusRepasse(r.settlement_status), pendente = status === 'a_liberar';
            const receita = dinheiro(r.earning_amount), fees = dinheiro(r.fees), frete = dinheiro(r.shipping_amount), liq = dinheiro(r.settlement_amount);
            const repasse = liq === null ? M.naoLido('pedido sem settlement_amount') : M.criar('repasse', Object.assign(O(opts.conta, opts.fonte), {
                id: String(r.statement_detail_id || id + '#extrato'), valor: liq, status, estimado: pendente,
                data_liberada: status === 'disponivel' ? U.dia(r.settlement_time) : null, data_prevista: U.dia(r.estimate_settle_time) || null,
                motivo: String(r.to_settle_reason || ''), pedidos: [id], extrato_id: idTxt(r.statement_id),
            }));
            return {
                pedido_id: id, data: U.dia(r.placed_time), entrega: U.dia(r.delivery_time), estimado: pendente, status_repasse: status, motivo: Number(r.to_settle_reason) || 0,
                receita, tarifas_total: neg(fees), frete: neg(frete), repasse,
                extrato_id: idTxt(r.statement_id), data_prevista: U.dia(r.estimate_settle_time) || null, canal_venda: canalVendaDe(r.source_page_types),
                skus: (Array.isArray(r.sku_records) ? r.sku_records : []).filter(s => s && typeof s === 'object').map(s => ({
                    sku_id: idTxt(s.sku_id), qtd: Number(s.quantity) > 0 ? Number(s.quantity) : 1,
                    titulo: String(s.product_name || '').slice(0, 120) + (s.sku_name && String(s.sku_name).trim() ? ' · ' + String(s.sku_name).trim() : ''),
                    receita: dinheiro(s.earning_amount), repasse: dinheiro(s.settlement_amount), tarifas: neg(dinheiro(s.fees)), canal_venda: canalVendaDe(s.source_page_types),
                })),
                confere: liq === null || receita === null ? null : U.r2(liq - (receita + (fees || 0) + (frete || 0))),
            };
        });
    }

    /** A receber por motivo (GET /api/v1/pay/statement/stat/info): 1 em trânsito, 2 devolução em andamento, 3 entregue e no prazo. */
    const MOTIVOS_A_RECEBER = { 1: 'em_transito', 2: 'devolucao', 3: 'entregue_no_prazo' };
    function aReceberPorMotivo(j) {
        const d = resposta(j), s = d && d.to_settle_amount_stat;
        if (!s) return M.naoLido('a receber não reconhecido');
        const motivos = (s.reasons_detail || []).filter(x => x && typeof x === 'object').map(x => ({
            motivo: MOTIVOS_A_RECEBER[x.reason] || 'outro', codigo: Number(x.reason) || null, titulo: texto(x.title), valor: dinheiro(x.amount),
        }));
        const total = dinheiro(s.amount), q = d.seller_quality_stat || {};
        return { total, motivos, prazo_dias: typeof q.bill_finish_period_in_days === 'number' ? q.bill_finish_period_in_days : null,
            confere: total === null ? null : U.r2(total - U.soma(motivos, m => m.valor)) };
    }

    /** Saldo (GET /api/v1/pay/settlement/balance/get) → { valor } | naoLido. */
    function saldoDisponivel(j) {
        const d = resposta(j), v = d && dinheiro(d.amount);
        return v === null || v === undefined ? M.naoLido('saldo não lido') : { valor: v };
    }

    /** Pendências de afiliados (GET /api/v1/affiliate/backend/homepage/todo_dashboard/get) → [{metrica, titulo, num}] | naoLido. */
    function pendenciasAfiliados(j) {
        const d = resposta(j), itens = d && d.dashboard && d.dashboard.items;
        if (!Array.isArray(itens)) return M.naoLido('pendências de afiliados não reconhecidas');
        return itens.filter(x => x && typeof x === 'object' && x.metric_key).map(x => ({ metrica: String(x.metric_key), titulo: String(x.title || ''), num: U.num(x.num) }));
    }

    /**
     * Campanhas (recommend_campaign/list + list_registered_campaigns) → { abertas: [{id, titulo, inscrita, inscricao_ate, inicio, fim}], inscritas }.
     * Só leitura: inscrever-se é ação da seller, na tela do TikTok.
     */
    function campanhasAbertas(recomendadas, inscritas) {
        const diaTT = v => U.dia(String(v === undefined || v === null ? '' : v).replace(/[<>]/g, ''));
        const r = resposta(recomendadas), i = resposta(inscritas);
        const lista = r && Array.isArray(r.campaign_list) ? r.campaign_list : null;
        return {
            abertas: lista ? lista.map(c => (c && c.product_campaign) || c).filter(c => c && c.id).map(c => ({
                id: String(c.id), titulo: String(c.title || '').slice(0, 160), inscrita: !!c.has_joined,
                inscricao_ate: diaTT(c.registration_end_time), inicio: diaTT(c.launch_begin_time), fim: diaTT(c.launch_end_time),
            })) : null,
            inscritas: i && typeof i.amount === 'number' ? i.amount : null,
        };
    }

    /**
     * O que PODE passar do detalhe do pedido (GET /api/v1/trade/orders/get). Lista fechada: id, datas, status, payment_info, SKUs
     * (SKU do vendedor, sku_id, qtd e preços), medidas do pacote, serviço de envio, devolução e o "Refund complete".
     * NUNCA passa: buyer_info, buyer_note, phone_number, contact_buyer_link, tracking_*, provider*, endereço. → resposta enxuta | null.
     */
    const PODE_PEDIDO = ['main_order_id', 'main_order_create_time', 'main_order_update_time', 'main_order_status', 'main_order_display_status', 'pay_method', 'pick_up_type', 'logistics_service_name'];
    const PODE_SKU = ['seller_sku_name', 'sku_id', 'quantity', 'product_name', 'sku_name', 'sku_display_status'];
    const PODE_REVERSO = ['reverse_order_id', 'reverse_status', 'reverse_type', 'reverse_reason', 'reverse_order_create_time'];
    const escalar = v => v === null || ['string', 'number', 'boolean'].indexOf(typeof v) >= 0;
    const pega = (o, campos) => { const x = {}; campos.forEach(k => { if (o && escalar(o[k])) x[k] = o[k]; }); return x; };
    const preco = v => (v && typeof v === 'object' && v.format_price !== undefined ? { format_price: String(v.format_price) } : undefined);
    function filtroPedidoSemComprador(j) {
        const d = resposta(j), m = d && d.main_order;
        if (!m || typeof m !== 'object') return null;
        const o = pega(m, PODE_PEDIDO);
        if (m.payment_info && typeof m.payment_info === 'object') {
            o.payment_info = {};
            Object.keys(m.payment_info).forEach(k => { const p = preco(m.payment_info[k]); if (p) o.payment_info[k] = p; });
        }
        if (Array.isArray(m.skus)) o.skus = m.skus.filter(s => s && typeof s === 'object').map(s => {
            const x = pega(s, PODE_SKU);
            ['unit_price', 'total_price'].forEach(k => { const p = preco(s[k]); if (p) x[k] = p; });
            if (s.package_pickup_detail && escalar(s.package_pickup_detail.pick_up_type)) x.package_pickup_detail = { pick_up_type: s.package_pickup_detail.pick_up_type };
            return x;
        });
        if (Array.isArray(m.pkg_attr_list)) o.pkg_attr_list = m.pkg_attr_list.filter(p => p && p.pkg_element).map(p => ({ pkg_element: {
            dimension: pega(p.pkg_element.dimension, ['length', 'width', 'height', 'unit']), weight: pega(p.pkg_element.weight, ['weight', 'unit']) } }));
        if (m.reverse_info && typeof m.reverse_info === 'object') o.reverse_info = pega(m.reverse_info, PODE_REVERSO);
        if (m.logistic_info && typeof m.logistic_info === 'object') o.logistic_info = pega(m.logistic_info, ['time', 'title']);
        if (Array.isArray(m.trans_histories)) o.trans_histories = m.trans_histories.some(h => h && /refund complete/i.test(String(h.description || ''))) ? [{ description: 'Refund complete' }] : [];
        return { code: 0, data: { main_order: o } };
    }

    /**
     * Esqueleto do adaptador TikTok. fontes (async, janela) → respostas CRUAS do TikTok, vindas do servidor (app ISV / ext_copiloto_api.php
     * 'canal_dados') ou do que a tela aberta pela seller recebeu:
     *   { transacoes: [resposta transaction/detail…], pedidos: [resposta orders/get…], extratos: resposta statement/list, saude: {performance_list, dynamic_settlement} }
     * Ads NÃO entra: o gasto fica no TikTok Ads Manager (outra origem) → "este canal não informa o gasto com anúncios" até existir fonte.
     */
    function criarAdaptadorTikTok(o) {
        o = o || {};
        const f = o.fontes || {}, conta = o.conta, fonte = o.fonte || 'tela';
        const def = {
            id: 'tiktok', nome: 'TikTok Shop',
            hosts: [/^seller-br\.tiktok\.com$/],
            fonte: {}, tarifa: T.TABELA.filter(l => l.canal === 'tiktok'),
            avisos_regra: ['Termos do Vendedor BR: proibido bot/scraper/meio automatizado sem permissão escrita — só leitura passiva da tela aberta pela seller ou API do app ISV.'],
        };
        const trans = async j => { const ts = await f.transacoes(j); return Array.isArray(ts) ? ts.map(t => transacaoDoExtrato(t, { conta, fonte })) : null; };
        if (typeof f.transacoes === 'function') {
            def.tarifas = async j => { const ts = await trans(j); if (!ts) return M.naoLido('extratos não lidos'); return juntaPorPedido(ts).reduce((a, p) => a.concat(p.tarifas), []); };
            def.repasses = async j => { const ts = await trans(j); if (!ts) return M.naoLido('extratos não lidos'); return juntaPorPedido(ts).reduce((a, p) => a.concat(p.repasses), []); };
            def.fretes = async j => { const ts = await trans(j); if (!ts) return M.naoLido('extratos não lidos'); return juntaPorPedido(ts).map(p => p.frete).filter(Boolean); };
            def.afiliados = async j => { const ts = await trans(j); if (!ts) return M.naoLido('extratos não lidos'); return juntaPorPedido(ts).reduce((a, p) => a.concat(p.afiliados), []); };
            ['tarifas', 'repasses', 'fretes', 'afiliados'].forEach(m => { def.fonte[m] = fonte; });
        }
        if (typeof f.pedidos === 'function') {
            def.pedidos = async j => { const ps = await f.pedidos(j); return Array.isArray(ps) ? ps.map(p => pedidoDoDetalhe(p, { conta, fonte }).pedido).filter(p => !M.ehNaoLido(p)) : M.naoLido('pedidos não lidos'); };
            def.devolucoes = async j => { const ps = await f.pedidos(j); return Array.isArray(ps) ? ps.map(p => pedidoDoDetalhe(p, { conta, fonte }).devolucao).filter(Boolean) : M.naoLido('pedidos não lidos'); };
            def.fonte.pedidos = def.fonte.devolucoes = fonte;
        }
        if (typeof f.saude === 'function') { def.saude = async j => saudeDaConta(await f.saude(j), conta); def.fonte.saude = fonte; }
        return A.criarAdaptador(def);
    }

    return { dinheiro, TIPOS, tipoTarifa, transacaoDoExtrato, juntaPorPedido, pedidoDoDetalhe, repassesDosExtratos, saudeDaConta, criarAdaptadorTikTok,
        pedidosDaListaFinanceira, aReceberPorMotivo, saldoDisponivel, pendenciasAfiliados, campanhasAbertas, violacoes, filtroPedidoSemComprador };
});
