// copiloto-nucleo · adaptador da Shopee BR (preparação: conversores no formato da Open Platform, sem tela na extensão ainda).
// Campos: tests/copiloto/MAPEAMENTO-SHOPEE.md. A referência de nomes é a Open Platform v2 (payment.get_escrow_detail e
// order.get_order_detail) — os MESMOS nomes que o SellerHub já lê no servidor (cron_shopee_escrow_sync.php, probe de 82 campos).
// O formato das telas do Seller Centre NÃO é conhecido: onde ele importa, o código diz "mapear ao vivo".
// REGRA: igual ao TikTok — na extensão, SÓ ler o que a tela aberta pela seller recebeu (nada de fetch em segundo plano, nada de POST).
// O caminho de volume é a API pelo servidor (core/ShopeeAPI.php). Nada do comprador passa (filtroPedidoSemComprador).
(function (root, fabrica) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = fabrica(require('../util'), require('../modelo'), require('../tarifas'), require('../adaptador'));
    else { const CN = root.CopilotoNucleo = root.CopilotoNucleo || {}; (CN.adaptadores = CN.adaptadores || {}).shopee = fabrica(CN.util, CN.modelo, CN.tarifas, CN.adaptador); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (U, M, T, A) {
    'use strict';

    const O = (conta, fonte) => ({ canal: 'shopee', conta: String(conta || ''), fonte: fonte || 'api' });
    /** Número da API (12.5, "12.50") ou da tela ("R$ 12,50"). Sem número → null. */
    const dinheiro = v => { const n = U.num(v); return n === null ? null : U.r2(n); };
    const abs = v => { const n = dinheiro(v); return n === null ? 0 : Math.abs(n); };
    const tem = (o, k) => o && o[k] !== undefined && o[k] !== null && o[k] !== '';
    /** {response:{…}} da Open Platform, {error:"…"} = falha, objeto solto = já desembrulhado. */
    const resposta = j => (j && typeof j === 'object' ? (j.error ? null : (j.response || j)) : null);

    /**
     * order_income → tarifa padronizada. Valores vêm POSITIVOS (o vendedor paga); usamos o módulo (igual ao cron PHP).
     * MAPEAR AO VIVO: em qual campo cai o fixo por item de 2026 (commission_fee junto com o %, ou service_fee) — por isso os dois
     * viram 'comissao' (a soma é a mesma; o motor não separa % e fixo na Shopee até ver um escrow real).
     */
    const CAMPOS_TARIFA = [
        ['commission_fee', 'comissao'],
        ['service_fee', 'comissao'],
        ['seller_transaction_fee', 'pagamento'],   // a Shopee diz que a comissão já contempla a transação: deve vir 0
        ['order_ams_commission_fee', 'afiliado'],
        ['ads_escrow_top_up_fee_or_technical_support_fee', 'ads'],
        ['cross_border_tax', 'imposto_canal'],
        ['shipping_seller_protection_fee_amount', 'outro'],
        ['delivery_seller_protection_fee_premium_amount', 'outro'],
        ['campaign_fee', 'outro'],
        ['reverse_shipping_fee', 'frete_devolucao'],
        ['final_return_to_seller_shipping_fee', 'frete_devolucao'],
    ];

    /**
     * Escrow de UM pedido (payment.get_escrow_detail) → { pedido_id, data, receita, tarifas, frete, repasse, afiliados, confere, avisos } | naoLido.
     * opts: { conta, fonte, data (dia da venda: o escrow não traz), pedido_id }.
     * Receita: bruto = original_price; desconto do vendedor = seller_discount + voucher_from_seller + seller_coin_cash_back;
     * reembolso = seller_return_refund + drc_adjustable_refund; outros = total_adjustment_amount (ajuste da carteira, ±).
     * Frete da ida = actual_shipping_fee − buyer_paid_shipping_fee − shopee_shipping_rebate (o que sobra para o vendedor).
     * Repasse = escrow_amount_after_adjustment (ou escrow_amount). A conta fecha? → confere.diferenca (aviso quando não fecha).
     */
    function transacaoDoEscrow(j, opts) {
        opts = opts || {};
        const d = resposta(j), oi = d && d.order_income;
        if (!oi || typeof oi !== 'object') return M.naoLido('escrow do pedido não reconhecido' + (j && j.error ? ' (' + j.error + ')' : ''));
        const pedidoId = String(d.order_sn || opts.pedido_id || '') || null;
        const data = U.dia(opts.data);
        if (!pedidoId) return M.naoLido('escrow sem order_sn');
        if (!data) return M.naoLido('escrow sem a data da venda (passe opts.data)');
        const conta = opts.conta, fonte = opts.fonte || 'api', avisos = [];
        const bruto = dinheiro(tem(oi, 'order_original_price') ? oi.order_original_price : oi.original_price);
        if (bruto === null) avisos.push('escrow sem original_price');
        const rec = {
            bruto: bruto || 0,
            desconto_vendedor: U.r2(abs(tem(oi, 'seller_discount') ? oi.seller_discount : oi.order_seller_discount) + abs(oi.voucher_from_seller) + abs(oi.seller_coin_cash_back)),
            reembolso: U.r2(abs(oi.seller_return_refund) + abs(oi.drc_adjustable_refund)),
            outros: dinheiro(oi.total_adjustment_amount) || 0,
        };
        const baseT = Object.assign(O(conta, fonte), { pedido_id: pedidoId, data, origem_pagamento: 'venda', estimada: false });
        const tarifas = [];
        CAMPOS_TARIFA.forEach(([k, tipo]) => {
            const v = abs(oi[k]);
            if (v) tarifas.push(M.criar('tarifa', Object.assign({}, baseT, { id: pedidoId + '#' + k, tipo, valor: v, texto_original: k, tipo_canal: k })));
        });
        if (abs(oi.seller_transaction_fee)) avisos.push('seller_transaction_fee veio ' + abs(oi.seller_transaction_fee) + ': a Shopee diz que a comissão já inclui a transação');

        let frete = null;
        if (tem(oi, 'actual_shipping_fee')) {
            const cheio = abs(oi.actual_shipping_fee), cliente = abs(oi.buyer_paid_shipping_fee), subsidio = abs(oi.shopee_shipping_rebate);
            const liquido = U.r2(cheio - cliente - subsidio);
            frete = M.criar('frete', Object.assign(O(conta, fonte), { pedido_id: pedidoId, cobrado_vendedor: liquido, pago_comprador: cliente, cheio, subsidio,
                descricao: 'actual_shipping_fee − buyer_paid_shipping_fee − shopee_shipping_rebate' }));
            if (liquido !== 0) tarifas.push(M.criar('tarifa', Object.assign({}, baseT, { id: pedidoId + '#frete', tipo: 'frete_venda', valor: liquido, texto_original: 'Frete líquido (custo − cliente − subsídio)' })));
        } else avisos.push('escrow sem actual_shipping_fee: frete da ida não lido');

        const afiliados = tarifas.filter(t => t.tipo === 'afiliado').map(t => M.criar('afiliado', Object.assign(O(conta, fonte), {
            pedido_id: pedidoId, comissao_valor: t.valor, estado: 'liquidado',
            comissao_pct: rec.bruto - rec.desconto_vendedor > 0 ? Math.round(t.valor / (rec.bruto - rec.desconto_vendedor) * 10000) / 100 : null,
        })));

        const liquidado = dinheiro(tem(oi, 'escrow_amount_after_adjustment') ? oi.escrow_amount_after_adjustment : oi.escrow_amount);
        const calculado = U.r2(rec.bruto - rec.desconto_vendedor - rec.reembolso + rec.outros - U.soma(tarifas, t => t.valor));
        const repasse = liquidado === null ? M.naoLido('escrow sem escrow_amount') : M.criar('repasse', Object.assign(O(conta, fonte), {
            id: pedidoId + '#escrow', valor: liquidado, status: 'a_liberar', pedidos: [pedidoId], estimado: false,
            motivo: 'status do repasse: mapear ao vivo (carteira)',
        }));
        const diferenca = liquidado === null ? null : U.r2(liquidado - calculado);
        if (diferenca !== null && Math.abs(diferenca) > 0.01) avisos.push('escrow não fecha: calculado ' + calculado + ' × Shopee ' + liquidado + ' (campo não mapeado — mapear ao vivo)');
        return { pedido_id: pedidoId, data, receita: rec, tarifas, frete, repasse, afiliados, confere: { calculado, escrow: liquidado, diferenca }, avisos };
    }

    /**
     * Escrow × tabela oficial (tarifas.js): a comissão cobrada (comissao + pagamento) bate com a tabela do dia?
     * itens: [{preco_unit, qtd}] (preço já com o desconto do vendedor; kit formal = 1 item). → { tabela, escrow, diferenca } | null.
     * Serve para trocar a confiança da tabela de 'oficial' para 'retrato' quando bater no escrow real.
     */
    function confereTabela(t, itens, ctx) {
        if (!t || M.ehNaoLido(t) || !Array.isArray(itens) || !itens.length) return null;
        let tabela = 0;
        for (const it of itens) {
            const ls = tarifaEstimada(it.preco_unit, Object.assign({}, ctx || {}, { qtd: it.qtd }), t.data);
            if (!ls) return null;
            tabela += U.soma(ls.filter(l => l.tipo === 'comissao' || l.tipo === 'taxa_fixa'), l => l.valor);
        }
        tabela = U.r2(tabela);
        const escrow = U.soma(t.tarifas.filter(x => x.tipo === 'comissao' || x.tipo === 'pagamento'), x => x.valor);
        return { tabela, escrow, diferenca: U.r2(escrow - tabela) };
    }

    // Fontes da regra do CPF (o tarifas.js força CNPJ; o adicional de R$ 3 fica aqui para não mexer no espelho PHP core/TarifasCanal.php).
    const F_CPF = { url: 'https://seller.shopee.com.br/edu/article/18484 · https://seller.shopee.com.br/edu/article/26839', data: '2026-09-30', confianca: 'oficial' };

    /**
     * Tarifas de UM item pela tabela oficial (T.tarifasDoItem) + a regra do CPF: R$ 3 por item SÓ quando ctx.pessoa = 'cpf' E
     * ctx.cpf_acima_450 === true (a loja passou de 450 pedidos em 90 dias — a dona informa; a Shopee não publica isso por API).
     * CPF abaixo de R$ 12: o fixo é regressivo, mas não há tabela oficial completa → mantém a de CNPJ e o aviso fica na linha.
     */
    function tarifaEstimada(precoUnit, ctx, data) {
        const c = ctx || {}, ls = T.tarifasDoItem('shopee', precoUnit, c, data);
        if (!ls) return null;
        if (c.pessoa === 'cpf' && c.cpf_acima_450 === true) {
            const qtd = c.qtd > 0 ? c.qtd : 1;
            ls.push({ tipo: 'taxa_fixa', pct: 0, fixo: 3, teto: null, valor: U.r2(3 * qtd), fonte: F_CPF,
                regra: 'R$ 3,00/un. (CPF com mais de 450 pedidos em 90 dias)' + (precoUnit < 12 ? ' · abaixo de R$ 12 o fixo do CPF é regressivo: conferir no escrow' : '') });
        }
        return ls;
    }

    // order_status da Open Platform → status padronizado. UNPAID não entra (ainda não é venda).
    const STATUS = { READY_TO_SHIP: 'pago', PROCESSED: 'pago', RETRY_SHIP: 'pago', IN_CANCEL: 'pago', SHIPPED: 'enviado',
        TO_CONFIRM_RECEIVE: 'entregue', COMPLETED: 'entregue', TO_RETURN: 'entregue', CANCELLED: 'cancelado' };

    /**
     * Detalhe do pedido (order.get_order_detail, um order_list[i]) → { pedido, avisos } | pedido naoLido. Nada do comprador é lido.
     * Item: model_sku (ou item_sku), quantidade e model_discounted_price (preço com o desconto do vendedor) — model_original_price fica de reserva.
     */
    function pedidoDoDetalhe(o, opts) {
        opts = opts || {};
        if (!o || !o.order_sn) return { pedido: M.naoLido('detalhe do pedido não reconhecido'), avisos: [] };
        const avisos = [], st = String(o.order_status || '');
        if (st === 'UNPAID') return { pedido: M.naoLido('pedido não pago (UNPAID)'), avisos };
        const status = STATUS[st] || 'pago';
        if (!STATUS[st]) avisos.push('order_status não mapeado: ' + st);
        if (st === 'IN_CANCEL') avisos.push('cancelamento em andamento');
        if (st === 'TO_RETURN') avisos.push('devolução em andamento');
        const itens = (Array.isArray(o.item_list) ? o.item_list : []).filter(i => i && typeof i === 'object').map(i => {
            const qtd = Number(i.model_quantity_purchased || i.quantity_purchased) || 1;
            const unit = dinheiro(tem(i, 'model_discounted_price') ? i.model_discounted_price : i.model_original_price);
            return { sku: String(i.model_sku || i.item_sku || ''), anuncio_id: String(i.item_id || ''), titulo: String(i.item_name || '').slice(0, 200) + (i.model_name ? ' · ' + i.model_name : ''),
                qtd, preco_unit: unit, total: unit === null ? null : U.r2(unit * qtd) };
        });
        const pedido = M.criar('pedido', Object.assign(O(opts.conta, opts.fonte), {
            id: String(o.order_sn), data_venda: U.dia(o.create_time), status, itens,
            logistica: null,   // FULL/coleta/agência: mapear ao vivo (fulfillment_flag / shipping_carrier)
            pagamento: /pix/i.test(String(o.payment_method || '')) ? 'pix' : String(o.payment_method || ''),
        }));
        return { pedido, avisos };
    }

    /**
     * O que PODE passar do get_order_detail. Lista fechada; NUNCA passa buyer_user_id, buyer_username, recipient_address,
     * message_to_seller, note, invoice_data, dropshipper*, package_list (rastreio). → { order_list: [...] } enxuto | null.
     */
    const PODE_PEDIDO = ['order_sn', 'order_status', 'create_time', 'update_time', 'pay_time', 'payment_method', 'total_amount', 'actual_shipping_fee',
        'estimated_shipping_fee', 'currency', 'cod', 'days_to_ship', 'fulfillment_flag', 'shipping_carrier', 'cancel_reason', 'cancel_by'];
    const PODE_ITEM = ['item_id', 'item_name', 'item_sku', 'model_id', 'model_name', 'model_sku', 'model_quantity_purchased', 'model_original_price',
        'model_discounted_price', 'weight', 'promotion_type', 'promotion_id', 'is_add_on_deal', 'is_main_item'];
    const escalar = v => v === null || ['string', 'number', 'boolean'].indexOf(typeof v) >= 0;
    const pega = (o, campos) => { const x = {}; campos.forEach(k => { if (o && escalar(o[k])) x[k] = o[k]; }); return x; };
    function filtroPedidoSemComprador(j) {
        const d = resposta(j), lista = d && d.order_list;
        if (!Array.isArray(lista)) return null;
        return { order_list: lista.filter(o => o && typeof o === 'object').map(o => {
            const x = pega(o, PODE_PEDIDO);
            if (Array.isArray(o.item_list)) x.item_list = o.item_list.filter(i => i && typeof i === 'object').map(i => pega(i, PODE_ITEM));
            return x;
        }) };
    }

    /**
     * Lista de produtos do Seller Centre (GET /api/v3/opt/mpsku/list/v2/get_product_list, tela "Meus Produtos"; retrato M2 de 07/10/2026,
     * tests/copiloto/fixtures/shopee_produtos_2026-10-07.json) → [{ produto_id, nome, sku, ativo, preco, preco_cheio, estoque, visualizacoes (acumuladas), variacoes }] | naoLido.
     * preço = o que o comprador paga hoje (promoção em andamento quando há; senão o cheio). Variação: model_list[i] (o SKU da variação; sem SKU,
     * vale o do produto). Só sai o que a etiqueta precisa: nada de estatísticas, imagens ou campanhas.
     */
    function produtosDaLista(j) {
        const d = j && typeof j === 'object' ? (j.data || resposta(j)) : null, ps = d && d.products;
        if (!Array.isArray(ps)) return M.naoLido('lista de produtos da Shopee não reconhecida');
        const idTxt = v => ((typeof v === 'number' || typeof v === 'string') && /^\d{1,25}$/.test(String(v)) ? String(v) : null);
        return ps.filter(p => p && idTxt(p.id)).map(p => {
            const pd = p.price_detail || {}, sd = p.stock_detail || {}, sku = typeof p.parent_sku === 'string' && p.parent_sku.trim() ? p.parent_sku.trim() : null;
            const variacoes = (Array.isArray(p.model_list) ? p.model_list : []).filter(m => m && idTxt(m.id)).map(m => {
                const mp = m.price_detail || {}, cheio = dinheiro(mp.origin_price), promo = dinheiro(mp.promotion_price);
                return { modelo_id: String(m.id), nome: typeof m.name === 'string' ? m.name : '', sku: typeof m.sku === 'string' && m.sku.trim() ? m.sku.trim() : sku,
                    preco: promo !== null && promo > 0 ? promo : cheio, preco_cheio: cheio, estoque: U.num((m.stock_detail || {}).total_available_stock) };
            });
            const cheio = dinheiro(pd.price_min), venda = dinheiro(pd.selling_price_min);
            return { produto_id: String(p.id), nome: typeof p.name === 'string' ? p.name : '', sku, ativo: !(p.tag && p.tag.unlist) && p.status === 1,
                preco: venda !== null && venda > 0 ? venda : cheio, preco_cheio: cheio, estoque: U.num(sd.total_available_stock),
                visualizacoes: U.num((p.statistics || {}).view_count), variacoes };
        });
    }

    /**
     * Esqueleto do adaptador Shopee. fontes (async, janela) → respostas CRUAS da Open Platform vindas do servidor:
     *   { escrows: [{data, resposta get_escrow_detail}…], pedidos: [order_list[i] do get_order_detail…] }
     * Ads, saúde, carteira e promoções: mapear ao vivo (MAPEAMENTO-SHOPEE.md §5) → "este canal não informa" até lá.
     */
    function criarAdaptadorShopee(o) {
        o = o || {};
        const f = o.fontes || {}, conta = o.conta, fonte = o.fonte || 'api';
        const def = {
            id: 'shopee', nome: 'Shopee',
            hosts: [/^seller\.shopee\.com\.br$/],
            fonte: {}, tarifa: T.TABELA.filter(l => l.canal === 'shopee'),
            avisos_regra: ['Termos da Shopee: proibido robô/scraper/meio automatizado — só leitura passiva da tela aberta pela seller ou API oficial pelo servidor.'],
        };
        if (typeof f.escrows === 'function') {
            const ler = async j => { const es = await f.escrows(j); return Array.isArray(es) ? es.map(e => transacaoDoEscrow(e && e.resposta, { conta, fonte, data: e && e.data })).filter(t => !M.ehNaoLido(t)) : null; };
            const junta = (campo, plano) => async j => { const ts = await ler(j); if (!ts) return M.naoLido('escrows não lidos'); return ts.reduce((a, t) => a.concat(plano ? [t[campo]] : t[campo]), []).filter(x => x && !M.ehNaoLido(x)); };
            def.tarifas = junta('tarifas'); def.repasses = junta('repasse', true); def.fretes = junta('frete', true); def.afiliados = junta('afiliados');
            ['tarifas', 'repasses', 'fretes', 'afiliados'].forEach(m => { def.fonte[m] = fonte; });
        }
        if (typeof f.pedidos === 'function') {
            def.pedidos = async j => { const ps = await f.pedidos(j); return Array.isArray(ps) ? ps.map(p => pedidoDoDetalhe(p, { conta, fonte }).pedido).filter(p => !M.ehNaoLido(p)) : M.naoLido('pedidos não lidos'); };
            def.fonte.pedidos = fonte;
        }
        return A.criarAdaptador(def);
    }

    return { dinheiro, CAMPOS_TARIFA, STATUS, produtosDaLista, transacaoDoEscrow, confereTabela, tarifaEstimada, pedidoDoDetalhe, filtroPedidoSemComprador, criarAdaptadorShopee };
});
