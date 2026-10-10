// copiloto-nucleo · adaptador do TikTok Shop BR (esqueleto + conversores já testados nos retratos reais).
// Campos: tests/copiloto/MAPEAMENTO-TIKTOK.md (ao vivo, 29–30/09/2026). REGRA: os Termos do Vendedor BR proíbem bot/scraper/"qualquer
// outro meio automatizado" sem permissão por escrito → na extensão, SÓ ler a resposta que a própria tela aberta pela seller recebeu
// (nada de fetch em segundo plano, nada de POST, nada de navegar sozinho). O caminho de volume é o app ISV pelo servidor (TikTokShopAPI.php).
// Dinheiro do financeiro: {amount:"549.9"} (ponto decimal; negativo = sai do vendedor). Pedidos: {format_price:"R$ 546,36"}.
// Datas: financeiro em ms (texto), pedidos em segundos. Ids de 18–19 dígitos: SEMPRE texto.
(function (root, fabrica) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = fabrica(require('../util'), require('../modelo'), require('../tarifas'), require('../adaptador'), require('../motor'));
    else { const CN = root.CopilotoNucleo = root.CopilotoNucleo || {}; (CN.adaptadores = CN.adaptadores || {}).tiktok = fabrica(CN.util, CN.modelo, CN.tarifas, CN.adaptador, CN.motor); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (U, M, T, A, MO) {
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
        [/affiliate.*ads|shop_ads/, 'afiliado_ads'], [/affiliate|_creator\b/, 'afiliado'], [/transaction_fee|payment_fee/, 'pagamento'],
        [/fulfil|fbt|warehouse/, 'armazenagem'], [/return_shipping|reverse_shipping/, 'frete_devolucao'], [/gmv_?pay/, 'ads'],
        // 03/10/2026 (MAPEAMENTO-TIKTOK.md §13.2 e §13.6): "…_revamp_creator" é a comissão do criador (não tem "affiliate") e "…_shop_ads_creator" cai acima.
        // As linhas que NÃO são tarifa (receita e frete do pedido) também saem pela chave: nunca viram tarifa (tipoTarifa devolve 'outro').
        [/_refunds\b/, 'reembolso'], [/_retail_price\b/, 'bruto'], [/_discounts\b/, 'desconto_vendedor'],
        [/forward_shipping/, 'frete_cheio'], [/customer_shipping_payment/, 'frete_cliente'], [/shipping_subsidy/, 'frete_subsidio'],
    ];
    // GMV Pay (ads.tiktok.com/help/article/about-gmv-pay): anúncio pago com o repasse. SUPOSIÇÃO (30/09/2026): a chave e o texto
    // reais nunca foram vistos no extrato desta conta; mapeamos o nome documentado. Sem casar, continua 'outro' (com aviso).
    const PELO_TEXTO = [[/pagamento de gmv para an[uú]ncios|gmv pay/i, 'ads']];
    function tipoTarifa(f) {
        if (f && TIPOS[f.type]) return TIPOS[f.type];
        const k = String((f && f.starling && f.starling.starling_key) || '') + ' ' + String((f && f.type) || '');
        const achou = PELA_CHAVE.find(p => M.TIPOS_TARIFA.indexOf(p[1]) >= 0 && p[0].test(k)) || PELO_TEXTO.find(p => p[0].test(texto(f)));
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
        if (d && Array.isArray(d.breakdown_info)) return transacaoDaGaveta(d, opts);   // 03/10: POST view/order_breakdown
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

    // ══════════ Telas de 03/10/2026 (MAPEAMENTO-TIKTOK.md §13): Finanças só por POST view/*, lido da resposta que a própria tela recebeu ══════════
    // Árvore de nós {item_id, amount, item_express.name.starling_key, sub_item_list}. Lê-se pelo item_id e pela chave, NUNCA pelo texto (muda com o
    // idioma). Dinheiro com o sinal da tela (− = sai do vendedor). Nas listas vêm só os 3 grupos (46 vendas líquidas, 53 frete líquido, 51 taxas);
    // a linha de cada tarifa só vem na gaveta "Exibir detalhes" de cada pedido e no demonstrativo (ciclo).
    const GRUPOS = { 46: 'vendas', 53: 'frete', 51: 'taxas' };
    const LINHA_POR_ITEM = { 311: 'bruto', 312: 'desconto_vendedor', 313: 'reembolso', 412: 'frete_cheio', 414: 'frete_cliente', 413: 'frete_subsidio',
        5065: 'comissao', 123: 'programa_frete', 440: 'taxa_fixa', 113: 'afiliado', 253: 'afiliado_ads' };
    // "Em espera": o código do motivo muda com a rota. stat/info: 1 em trânsito, 2 devolução, 3 entregue. onhold_orders e order_breakdown: 1, 5 e 3.
    // Guardado sempre no código do stat/info (o de MOTIVOS_A_RECEBER).
    const MOTIVO_0310 = { 1: 1, 3: 3, 5: 2 };
    const filhos = n => (n && Array.isArray(n.sub_item_list) && n.sub_item_list.length ? n.sub_item_list : null);
    const chaveDe = n => String((n && n.item_express && n.item_express.name && n.item_express.name.starling_key) || '');
    const classeDaLinha = n => LINHA_POR_ITEM[n.item_id] || (PELA_CHAVE.find(p => p[0].test(chaveDe(n))) || [])[1] || null;
    const neg = v => (v === null ? null : U.r2(-v));
    /** Os 3 grupos de cima da árvore, com o sinal da tela. Grupo zerado pode não vir (o frete em "Em espera"): vale 0 só quando o resto fecha com o total. */
    function tresGrupos(arv, total) {
        const g = {};
        Object.keys(GRUPOS).forEach(id => { const n = (Array.isArray(arv) ? arv : []).find(x => x && String(x.item_id) === id); g[GRUPOS[id]] = n ? dinheiro(n.amount) : null; });
        if (total !== null && Math.abs(U.r2(total - U.soma(Object.keys(g), c => g[c]))) <= 0.01) Object.keys(g).forEach(c => { if (g[c] === null) g[c] = 0; });
        return g;
    }
    /**
     * Abre a árvore até as folhas → { aberta, rec, frete|null, tarifas: [{tipo, valor, no}], avisos }, já no sinal do Copiloto (tarifa + = cobrada).
     * aberta = false quando só vieram os grupos (lista): aí NÃO há tarifa por tipo. Linha que não se conhece entra em "outros"/'outro' com aviso,
     * para a soma continuar igual ao total da tela.
     */
    function abreArvore(arv) {
        const rec = { bruto: 0, desconto_vendedor: 0, reembolso: 0, outros: 0 }, fr = { cheio: 0, cliente: 0, subsidio: 0, outros: 0 }, tarifas = [], avisos = [];
        let abriu = false, fechado = false, temFrete = false;
        (function anda(lista, grupo) {
            (Array.isArray(lista) ? lista : []).forEach(n => {
                if (!n || typeof n !== 'object') return;
                const g = grupo || String(n.item_id);
                if (filhos(n)) { abriu = true; anda(filhos(n), g); return; }
                const v = dinheiro(n.amount), nome = chaveDe(n) || 'item ' + n.item_id;
                if (v === null) { avisos.push('linha sem valor: ' + nome); return; }
                const c = grupo ? classeDaLinha(n) : null;   // grupo de cima sem linhas dentro: não dá para saber o tipo
                if (!grupo && v !== 0) fechado = true;
                if (g === '53') temFrete = true;
                if (c === 'bruto') rec.bruto = U.r2(rec.bruto + v);
                else if (c === 'desconto_vendedor') rec.desconto_vendedor = U.r2(rec.desconto_vendedor - v);
                else if (c === 'reembolso') rec.reembolso = U.r2(rec.reembolso - v);
                else if (c === 'frete_cheio') { temFrete = true; fr.cheio = U.r2(fr.cheio - v); }
                else if (c === 'frete_cliente') { temFrete = true; fr.cliente = U.r2(fr.cliente + v); }
                else if (c === 'frete_subsidio') { temFrete = true; fr.subsidio = U.r2(fr.subsidio + v); }
                else if (c && M.TIPOS_TARIFA.indexOf(c) >= 0) tarifas.push({ tipo: c, valor: U.r2(-v), no: n });
                else if (g === '46') { rec.outros = U.r2(rec.outros + v); if (v) avisos.push('receita não mapeada: ' + nome + ' (' + v + ')'); }
                else if (g === '53') { fr.outros = U.r2(fr.outros + v); if (v) avisos.push('frete não mapeado: ' + nome); }
                else { tarifas.push({ tipo: 'outro', valor: U.r2(-v), no: n }); if (v) avisos.push('tarifa não mapeada: ' + nome); }
            });
        })(arv, '');
        return { aberta: abriu && !fechado, rec, frete: temFrete ? Object.assign(fr, { liquido: U.r2(fr.cheio - fr.cliente - fr.subsidio - fr.outros) }) : null, tarifas, avisos };
    }

    /**
     * Gaveta "Exibir detalhes" do pedido (POST view/order_breakdown) → o MESMO formato do transacaoDoExtrato.
     * A resposta pode vir sem o id e sem a data do pedido: opts.corpo = o que a TELA mandou no pedido ({trade_order_id, fund_order_id, settle_status});
     * opts.data = o dia da venda já lido da lista. Sem um dos dois → naoLido com falta: 'pedido' (não é "a tela mudou").
     */
    function transacaoDaGaveta(d, opts) {
        const c = opts.corpo || {}, conta = opts.conta;
        const pedidoId = idTxt(d.trade_order_id || c.trade_order_id || opts.pedido_id), data = U.dia(d.order_create_time) || U.dia(opts.data);
        if (!pedidoId || !data) return M.naoLido('detalhe do pedido sem ' + (pedidoId ? 'a data da venda' : 'o id do pedido'), { falta: 'pedido' });
        // settle_status do pedido da tela: 2 liquidado, 1 em espera. Sem ele: transaction_status 1 ou os grupos com o nome "estimado".
        const pendente = c.settle_status !== undefined && c.settle_status !== null ? Number(c.settle_status) === 1
            : (Number(d.transaction_status) === 1 || /^on_hold_/.test(chaveDe(d.breakdown_info[0])));
        const a = abreArvore(d.breakdown_info), rec = a.rec, avisos = a.avisos;
        if (!a.aberta) return M.naoLido('detalhe do pedido sem as linhas das tarifas');   // só os 3 grupos: não é detalhe
        const baseT = Object.assign(O(conta, opts.fonte), { pedido_id: pedidoId, data, origem_pagamento: 'venda' });
        const tarifas = a.tarifas.map(t => M.criar('tarifa', Object.assign({}, baseT, { id: pedidoId + '#' + t.no.item_id, tipo: t.tipo, valor: t.valor,
            texto_original: chaveDe(t.no), estimada: pendente, tipo_canal: String(t.no.item_id || '') })));
        let frete = null;
        if (a.frete) {
            frete = M.criar('frete', Object.assign(O(conta, opts.fonte), { pedido_id: pedidoId, cobrado_vendedor: a.frete.liquido, pago_comprador: a.frete.cliente, cheio: a.frete.cheio, subsidio: a.frete.subsidio }));
            tarifas.push(M.criar('tarifa', Object.assign({}, baseT, { id: pedidoId + '#frete', tipo: 'frete_venda', valor: a.frete.liquido, texto_original: 'Frete líquido (custo − cliente − subsídio)', estimada: pendente })));
        }
        const base = U.r2(rec.bruto - rec.desconto_vendedor);
        const afiliados = tarifas.filter(t => t.tipo === 'afiliado' || t.tipo === 'afiliado_ads').map(t => M.criar('afiliado', Object.assign(O(conta, opts.fonte), {
            pedido_id: pedidoId, comissao_valor: t.valor, comissao_pct: base > 0 ? Math.round(t.valor / base * 10000) / 100 : null, via_ads: t.tipo === 'afiliado_ads',
            estado: pendente ? 'estimado' : 'liquidado',
        })));
        const liquidado = dinheiro(d.total_net_amount), fundo = pendente ? null : idTxt(d.fund_order_id || c.fund_order_id);
        const calculado = U.r2(rec.bruto - rec.desconto_vendedor - rec.reembolso + rec.outros - U.soma(tarifas, t => t.valor));
        const repasse = liquidado === null ? M.naoLido('detalhe sem o valor da liquidação') : M.criar('repasse', Object.assign(O(conta, opts.fonte), {
            id: String(fundo || pedidoId + '#extrato'), valor: liquidado, status: pendente ? 'a_liberar' : 'disponivel', estimado: pendente,
            data_liberada: pendente ? null : U.dia(d.settlement_date || d.statement_date), data_prevista: U.dia(d.estimate_settle_time) || null,
            motivo: String(MOTIVO_0310[Number(d.to_settle_reason)] || ''), pedidos: [pedidoId], extrato_id: idTxt(d.statement_id),
        }));
        const diferenca = liquidado === null ? null : U.r2(liquidado - calculado);
        if (diferenca !== null && Math.abs(diferenca) > 0.01) avisos.push('extrato não fecha: calculado ' + calculado + ' × TikTok ' + liquidado);
        return {
            pedido_id: pedidoId, extrato_detalhe_id: fundo, data, receita: rec, tarifas, frete, repasse, afiliados, canal_venda: null,
            linha_zero: rec.bruto === 0 && !tarifas.some(t => t.valor !== 0) && liquidado === 0, pendente, confere: { calculado, extrato: liquidado, diferenca }, avisos,
        };
    }

    /**
     * O detalhe (transações do pedido) cobre TODAS as linhas da lista deste pedido? Só então a tarifa por tipo vale (regra "N de M pedidos com
     * detalhe"). Confere pelos ids (linha da lista = extrato_detalhe_id do detalhe; a linha "em espera" não tem id próprio) e pela soma (até 0,01).
     * repasses = os Repasse das linhas da lista; transacoes = [transacaoDoExtrato…]. Sem linha da lista, basta haver detalhe.
     */
    function pedidoTemDetalhe(repasses, transacoes) {
        const ts = (transacoes || []).filter(t => t && !M.ehNaoLido(t)), j = juntaPorPedido(ts)[0], rs = (repasses || []).filter(r => r && !M.ehNaoLido(r));
        if (!j) return false;
        if (!rs.length) return true;
        const abertos = ts.map(t => t.extrato_detalhe_id).filter(Boolean);
        return !rs.some(r => !/#extrato$/.test(String(r.id)) && abertos.indexOf(r.id) < 0) && Math.abs(U.r2(U.soma(j.repasses, r => r.valor) - U.soma(rs, r => r.valor))) <= 0.01;
    }

    /**
     * Demonstrativo (statement_record de POST view/statements) → tarifas por tipo do ciclo, no sinal do Copiloto (+ = cobrada; frete_venda = frete
     * líquido), ou null quando só vieram os 3 grupos. É a divisão COMPLETA do ciclo: não depende de abrir a gaveta de cada pedido.
     * Só os 3 grupos: o nó de cima fora deles (ajuste, rebate) já está no `ajuste` do demonstrativo e não é tarifa.
     */
    function tiposDoDemonstrativo(s) {
        const a = abreArvore((s && Array.isArray(s.simple_breakdown) ? s.simple_breakdown : []).filter(n => n && GRUPOS[n.item_id])), t = {};
        if (!a.aberta) return null;
        a.tarifas.forEach(x => { t[x.tipo] = U.r2((t[x.tipo] || 0) + x.valor); });
        if (a.frete) t.frete_venda = a.frete.liquido;
        return t;
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
            if (s.total_net_amount !== undefined) return demonstrativo(s, conta);   // 03/10: POST view/statements
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

    /**
     * Demonstrativo de 03/10 (POST view/statements) → o MESMO Repasse do extrato antigo, mais total_pedidos (o total_record: vira o M de "N de M
     * pedidos lidos"), pagamento_id e tipos (tiposDoDemonstrativo). payment_status 4 = "Pagos". Grupo de cima fora de 46/53/51 (ajuste, retenção:
     * nunca visto até 03/10) entra em ajuste, e a conferência continua valor = vendas + frete + taxas + ajuste.
     */
    function demonstrativo(s, conta) {
        const liq = dinheiro(s.total_net_amount), g = tresGrupos(s.simple_breakdown, liq), pago = Number(s.payment_status) === 4, dia = U.dia(s.statement_date);
        const ajuste = U.soma((Array.isArray(s.simple_breakdown) ? s.simple_breakdown : []).filter(n => n && !GRUPOS[n.item_id]), n => dinheiro(n.amount));
        return M.criar('repasse', Object.assign(O(conta), {
            id: String(s.statement_id), valor: liq, status: pago ? 'disponivel' : 'a_liberar', data_liberada: pago ? dia : null, data_prevista: pago ? null : dia,
            motivo: '', pedidos: [], nivel: 'extrato', receita: g.vendas, tarifas: g.taxas, frete: g.frete, ajuste, retido: dinheiro(s.reserve_amount),
            confere: liq === null ? null : U.r2(liq - U.soma(Object.keys(g), c => g[c]) - ajuste),
            total_pedidos: Number.isInteger(s.total_record) ? s.total_record : null, pagamento_id: idTxt(s.payment_order_id), tipos: tiposDoDemonstrativo(s),
        }));
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
        const nova = r => Array.isArray(r.simple_breakdown);   // 03/10: POST view/settled_orders e view/onhold_orders
        return recs.filter(r => r && typeof r === 'object' && (nova(r) ? idTxt(r.trade_order_id || r.expression_order_id) && U.dia(r.placed_time || r.order_create_time)
            : idTxt(r.trade_order_id || r.reference_id) && U.dia(r.placed_time))).map(r => {
            if (nova(r)) return linhaDaLista0310(r, opts);
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

    /**
     * Linha das listas de 03/10 (Demonstrativos › por pedidos e Em espera) → o MESMO registro da lista antiga. Só os 3 grupos: receita = vendas
     * líquidas (46), tarifas_total = taxas (51) e frete = frete líquido (53), os dois POSITIVOS (o que o vendedor paga). Sem canal da venda e sem
     * entrega (a tela não manda mais). A linha "em espera" não tem id próprio (fica <pedido>#extrato); a liquidada usa o fund_order_id.
     */
    function linhaDaLista0310(r, opts) {
        const id = idTxt(r.trade_order_id || r.expression_order_id), espera = r.total_onhold_net_amount !== undefined, status = espera ? 'a_liberar' : 'disponivel';
        const liq = dinheiro(espera ? r.total_onhold_net_amount : r.total_net_amount), g = tresGrupos(r.simple_breakdown, liq);
        const motivo = espera ? MOTIVO_0310[Number(r.to_settle_reason)] || 0 : 0, prevista = U.dia(r.estimate_settle_time) || null;
        const repasse = liq === null ? M.naoLido('pedido sem o valor da liquidação') : M.criar('repasse', Object.assign(O(opts.conta, opts.fonte), {
            id: String((!espera && idTxt(r.fund_order_id)) || id + '#extrato'), valor: liq, status, estimado: espera,
            data_liberada: espera ? null : U.dia(r.settlement_date || r.statement_date), data_prevista: prevista,
            motivo: String(motivo || ''), pedidos: [id], extrato_id: idTxt(r.statement_id),
        }));
        return {
            pedido_id: id, data: U.dia(r.placed_time || r.order_create_time), entrega: null, estimado: espera, status_repasse: status, motivo,
            receita: g.vendas, tarifas_total: neg(g.taxas), frete: neg(g.frete), repasse, extrato_id: idTxt(r.statement_id), data_prevista: prevista, canal_venda: null,
            skus: (Array.isArray(r.sku_records) ? r.sku_records : []).filter(s => s && typeof s === 'object').map(s => {
                const tot = dinheiro(espera ? s.sku_total_onhold_net_amount : s.sku_total_net_amount), gs = tresGrupos(s.simple_breakdown, tot);
                return { sku_id: idTxt(s.sku_id), qtd: Number(s.quantity) > 0 ? Number(s.quantity) : 1,
                    titulo: String(s.product_name || '').slice(0, 120) + (s.sku_name && String(s.sku_name).trim() ? ' · ' + String(s.sku_name).trim() : ''),
                    receita: gs.vendas, repasse: tot, tarifas: neg(gs.taxas), canal_venda: null };
            }),
            confere: liq === null || g.vendas === null ? null : U.r2(liq - (g.vendas + (g.taxas || 0) + (g.frete || 0))),
        };
    }

    /**
     * A receber por motivo (GET /api/v1/pay/statement/stat/info): 1 em trânsito, 2 devolução em andamento, 3 entregue e no prazo.
     * 03/10: a lista "Em espera" (POST view/onhold_orders) dá o mesmo resultado, somando as linhas por motivo (lá a devolução é 5; sai como 2).
     * Lista cortada (a tela trouxe menos linhas do que existem): confere ≠ 0.
     */
    const MOTIVOS_A_RECEBER = { 1: 'em_transito', 2: 'devolucao', 3: 'entregue_no_prazo' };
    function aReceberPorMotivo(j) {
        const d = resposta(j), s = d && d.to_settle_amount_stat;
        if (!s && d && Array.isArray(d.order_records) && d.sum_total_amount !== undefined) {
            const por = {}, total = dinheiro(d.sum_total_amount);
            d.order_records.forEach(r => { const c = (r && MOTIVO_0310[Number(r.to_settle_reason)]) || 0, v = r ? dinheiro(r.total_onhold_net_amount) : null; if (v !== null) por[c] = U.r2((por[c] || 0) + v); });
            const motivos = Object.keys(por).map(Number).sort().map(c => ({ motivo: MOTIVOS_A_RECEBER[c] || 'outro', codigo: c || null, titulo: '', valor: por[c] }));
            return { total, motivos, prazo_dias: null, confere: total === null ? null : U.r2(total - U.soma(motivos, m => m.valor)) };
        }
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

    // ══════════ Demais telas de 03/10/2026 (lista fechada do PLANO-3.3.0, E6). A página já deixa sair só uma lista fechada de campos; aqui se lê
    // sempre pela chave (feature_code, card_title, param_key…), nunca pelo texto da tela. O que não se reconhece vira naoLido, nunca zero. ══════════

    /** Cartões do Resumo financeiro (POST view/amount_summary; cada chamada da tela traz uma parte) → só o que veio | naoLido. */
    function resumoFinanceiro(j) {
        const d = resposta(j), out = {};
        const campos = { em_espera: 'to_settle_amount', pago_periodo: 'payout_success_amount', em_processamento: 'payout_in_progress_amount', saldo: 'base_account_balance', saldo_negativo: 'negative_balance_amount' };
        if (d && typeof d === 'object') Object.keys(campos).forEach(c => { const v = d[campos[c]] === '' ? null : dinheiro(d[campos[c]]); if (v !== null) out[c] = v; });
        return Object.keys(out).length ? out : M.naoLido('resumo financeiro não reconhecido');
    }
    /** Total já pago (GET stat/info?amount_stat_type=3) → { total } | naoLido. */
    function totalPago(j) {
        const d = resposta(j), v = d && d.payment_amount_stat ? dinheiro(d.payment_amount_stat.paid_amount) : null;
        return v === null ? M.naoLido('total pago não reconhecido') : { total: v };
    }

    // feature_code (a chave estável da tela "Avaliação da integridade da conta") → o mesmo id dos indicadores de antes
    const SAUDE_PELA_CHAVE = [[/late_dispatch/, 'late_dispatch_rate'], [/cancel_rate/, 'seller_fault_cancellation_rate'], [/24h/, '24_hour_response_rate']];
    /** Indicadores (POST growth_center/shop/metrics_module/query) → Saude[] | naoLido. operator 5 = "no máximo" (menor é melhor), 3 = "pelo menos". */
    function indicadoresDaLoja(j, conta) {
        const d = resposta(j), gs = d && d.metric_groups, out = [];
        if (!Array.isArray(gs)) return M.naoLido('indicadores da loja não reconhecidos');
        gs.forEach(g => ((g && Array.isArray(g.metrics)) ? g.metrics : []).forEach(i => {
            const fc = String((i && i.feature_code) || ''), achou = SAUDE_PELA_CHAVE.find(p => p[0].test(fc));
            if (!fc) return;
            out.push(M.criar('saude', Object.assign(O(conta), { indicador: achou ? achou[1] : fc.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''), chave: fc,
                valor: typeof i.value === 'number' ? i.value : null, meta: typeof i.target_value === 'number' ? i.target_value : null,
                direcao: Number(i.operator) === 3 ? 'maior_melhor' : (Number(i.operator) === 5 ? 'menor_melhor' : null),
                efeito_se_falhar: i.violation_count > 0 ? 'gera ponto de violação' : '', de: U.dia(i.start_time), ate: U.dia(i.end_time) })));
        }));
        return out;
    }
    /**
     * Pontuação de desempenho da loja (GET experience-score/score-overview) → { avaliada, pedidos_validos, grupos: [{chave, nota}], regua_expresso } | naoLido.
     * Nota vazia ("") é "ainda não avaliado" (nota null), NUNCA 0. regua_expresso = nota mínima do benefício "Liquidação expressa" (settlement1).
     */
    function pontuacaoDaLoja(j) {
        const d = resposta(j), ov = d && d.overview, gs = d && d.metric && d.metric.metricGroups;
        if (!ov || !Array.isArray(gs)) return M.naoLido('pontuação da loja não reconhecida');
        const grupos = gs.filter(g => g && g.groupName).map(g => ({ chave: String(g.groupName), nota: g.score === '' ? null : U.num(g.score) }));
        const ben = ((d.benefitModule && Array.isArray(d.benefitModule.benefitList)) ? d.benefitModule.benefitList : []).find(b => b && /settlement1/.test(String(b.title || '')));
        return { avaliada: grupos.some(g => g.nota !== null), pedidos_validos: typeof ov.totalValidOrderCnt === 'number' ? ov.totalValidOrderCnt : null, grupos,
            regua_expresso: ben ? U.num(ben.Threshold) : null };
    }

    /**
     * Devoluções (POST reverse/component/orders/list): só os contadores e o biz_data de cada linha (nada do cartão da tela, onde vem o texto do cliente).
     * reverseType 2 = só reembolso (o produto não volta), 3 = devolução e reembolso. valor = o reembolso ao cliente (item + frete de ida).
     * → { total, contadores: {esperando_voce (aba 800), esperando_tiktok_ou_cliente (aba 900)}, linhas: [{pedido_id, devolucao_id, valor, produto_volta}] } | naoLido
     */
    function devolucoesDaLista(j) {
        const d = resposta(j), vis = d && d.search_component_overview;
        // Sem devolução nenhuma, a tela omite cards e declara total_count 0 (os contadores vêm zerados): é o vazio, não "tela mudou" (E23, ao vivo 09/10).
        if (d && d.cards === undefined && d.total_count === 0 && vis && typeof vis === 'object') {
            const z = c => (vis[c] && typeof vis[c].order_count === 'number' ? vis[c].order_count : null);
            return { total: 0, contadores: { esperando_voce: z('800'), esperando_tiktok_ou_cliente: z('900') }, linhas: [] };
        }
        if (!d || !Array.isArray(d.cards) || !vis || typeof vis !== 'object') return M.naoLido('lista de devoluções não reconhecida');
        const n = c => (vis[c] && typeof vis[c].order_count === 'number' ? vis[c].order_count : null);
        return { total: typeof d.total_count === 'number' ? d.total_count : null, contadores: { esperando_voce: n('800'), esperando_tiktok_ou_cliente: n('900') },
            linhas: d.cards.map(c => c && c.biz_data).filter(b => b && idTxt(b.main_order_id)).map(b => ({ pedido_id: String(b.main_order_id), devolucao_id: idTxt(b.reverse_main_order_id),
                valor: dinheiro(b.return_price), produto_volta: Number(b.reverseType) === 3 ? true : (Number(b.reverseType) === 2 ? false : null) })) };
    }
    /** Cartões do topo de devoluções (POST reverse/dashboard/get) → { responder_24h (100), aprovado_automatico_7d (500), pode_recorrer (700), disputas (800) } | naoLido. */
    function painelDeDevolucoes(j) {
        const d = resposta(j), cs = d && d.dashboard_columns, nome = { 100: 'responder_24h', 500: 'aprovado_automatico_7d', 700: 'pode_recorrer', 800: 'disputas' }, out = {};
        if (!Array.isArray(cs)) return M.naoLido('cartões de devoluções não reconhecidos');
        cs.forEach(c => { if (c && nome[c.column_id] && typeof c.order_count === 'number') out[nome[c.column_id]] = c.order_count; });
        return out;
    }
    /**
     * Casos em aberto, contados por PEDIDO (main_order_id), não por linha: o mesmo pedido pode ter 2 pedidos de reembolso.
     * dev = { contadores (da última leitura), abas: {'800': {linhas}, '900': {linhas}} } (o que a seller abriu). completo = false quando uma aba com
     * casos ainda não foi lida inteira: aí o número é "pelo menos".
     * → { casos, esperando_voce, valor (o maior reembolso de cada pedido, somado; null sem valor), pedidos: [{pedido_id, valor, esperando_voce, linhas}], completo }
     */
    function devolucoesAbertas(dev) {
        const por = {}, abas = (dev && dev.abas) || {}, cont = (dev && dev.contadores) || {};
        let completo = true;
        [['800', 'esperando_voce'], ['900', 'esperando_tiktok_ou_cliente']].forEach(a => {
            const ls = abas[a[0]] && Array.isArray(abas[a[0]].linhas) ? abas[a[0]].linhas : null;
            if (!ls ? cont[a[1]] !== 0 : (typeof cont[a[1]] === 'number' && cont[a[1]] > ls.length)) completo = false;
            (ls || []).forEach(l => {
                const p = por[l.pedido_id] || (por[l.pedido_id] = { pedido_id: l.pedido_id, valor: null, esperando_voce: false, linhas: 0 });
                p.linhas++;
                if (a[0] === '800') p.esperando_voce = true;
                if (typeof l.valor === 'number' && (p.valor === null || l.valor > p.valor)) p.valor = l.valor;
            });
        });
        const pedidos = Object.keys(por).map(c => por[c]);
        return { casos: pedidos.length, esperando_voce: pedidos.filter(p => p.esperando_voce).length, valor: pedidos.some(p => p.valor === null) ? null : U.soma(pedidos, p => p.valor), pedidos, completo };
    }

    const diaTT = v => U.dia(String(v === undefined || v === null ? '' : v).replace(/[<>]/g, ''));
    const nomePt = x => String((((x && x.language_field_map) || {})['pt-BR'] || {}).campaign_name || (x && x.title) || '').slice(0, 160);
    /** Subcampanha (mesmo formato em parents_campaigns/list, register_task/campaign/list e list_registered/type_campaigns). O cupom (benefit_type 2) é pago pelo TikTok. */
    function subcampanha(c, mae) {
        const cupom = (Array.isArray(c.benefits) ? c.benefits : []).find(b => b && Number(b.benefit_type) === 2 && b.discount_percentage), fx = (cupom && cupom.discount_percentage.range_value) || {};
        return { id: String(c.id), titulo: nomePt(c), campanha: mae ? nomePt(mae) : '', inscrita: !!c.has_joined,
            inscricao_ate: diaTT(c.registration_end_time), inicio: diaTT(c.launch_begin_time), fim: diaTT(c.launch_end_time),
            cupom_min_pct: U.num(fx.min), cupom_max_pct: U.num(fx.max), exige_gmv_max: (Array.isArray(c.play_type) ? c.play_type : []).indexOf(6) >= 0 };
    }
    /** Campanhas abertas (POST parents_campaigns/list: Campanhas e Página inicial) → as subcampanhas, no formato de campanhasAbertas().abertas | naoLido. */
    function campanhasDaTela(j) {
        const d = resposta(j), ms = d && d.campaigns_list;
        if (!Array.isArray(ms)) return M.naoLido('campanhas abertas não reconhecidas');
        return [].concat.apply([], ms.map(m => ((m && Array.isArray(m.com_campaigns_list)) ? m.com_campaigns_list : []).filter(c => c && c.id).map(c => subcampanha(c, m.campaign_info))));
    }
    /**
     * Campanhas em que a loja está (POST mgt/list_registered/type_campaigns) → { lista, inscritas } | naoLido. has_joined vem false mesmo aprovada:
     * vale stat.approved_count (ou registration_infos[].approval_info.status 3).
     */
    function campanhasInscritas(j) {
        const d = resposta(j), cs = d && d.campaign_infos;
        if (!Array.isArray(cs) || cs.some(c => !c || !c.campaign_info)) return M.naoLido('campanhas inscritas não reconhecidas');
        const lista = cs.filter(c => c.campaign_info.id).map(c => {
            const st = c.stat || {}, aprovada = Number(st.approved_count) > 0 || (Array.isArray(c.registration_infos) ? c.registration_infos : []).some(r => r && r.approval_info && Number(r.approval_info.status) === 3);
            return Object.assign(subcampanha(c.campaign_info), { inscrita: aprovada || !!c.campaign_info.has_joined, em_analise: Number(st.under_review_count) > 0 });
        });
        return { lista, inscritas: lista.filter(c => c.inscrita).length };
    }
    /** Convites ("Recomendações", POST register_task/campaign/list) → [subcampanha + produtos convidados] | naoLido. */
    function convitesDeCampanha(j) {
        const d = resposta(j), cs = d && d.campaign_infos;
        if (!Array.isArray(cs) || cs.some(c => !c || !c.com_campaign_info)) return M.naoLido('convites de campanha não reconhecidos');
        return cs.filter(c => c.com_campaign_info.id).map(c => Object.assign(subcampanha(c.com_campaign_info), {
            produtos: (Array.isArray(c.product_info) ? c.product_info : []).filter(p => p && idTxt(p.product_id)).map(p => ({ produto_id: String(p.product_id), titulo: String(p.product_name || '').slice(0, 120) })) }));
    }
    /**
     * Regra de preço da subcampanha (GET campaign/seller/get → registration_criteria): "até N% do que os clientes pagaram nos últimos D dias".
     * Lê pelos parâmetros (wrapper_operate_factor e date_range), nunca pela frase. O bloco se repete na resposta: vale o fator MENOR (o mais apertado).
     * → { fator (0,95 = até 95%), dias } · { fator: null, dias: null } quando a campanha não tem essa regra · naoLido
     */
    function regraDePreco(j) {
        const d = resposta(j), cs = d && d.registration_criteria && d.registration_criteria.registration_criteria_desc;
        if (!Array.isArray(cs)) return M.naoLido('regra de preço da campanha não reconhecida');
        let melhor = { fator: null, dias: null };
        cs.forEach(c => ((c && Array.isArray(c.criteria_desc_detail)) ? c.criteria_desc_detail : []).forEach(x => {
            const p = {};
            ((x && Array.isArray(x.desc_param)) ? x.desc_param : []).forEach(q => { if (q && q.param_key) p[q.param_key] = q.param_value; });
            let f = U.num(p.wrapper_operate_factor);
            // Participação Geral (10.10): a linha dos "D dias" sem value1 e sem fator = até o preço pago nesses dias (fator 1)
            if (f === null && p.date_range !== undefined && p.value1 === undefined) f = 1;
            if (f !== null && f > 0 && f <= 1 && (melhor.fator === null || f < melhor.fator)) melhor = { fator: f, dias: U.num(p.date_range) };
        }));
        return melhor;
    }
    /** Faixa de preço por produto na campanha (POST recommend/list_product) → [{produto_id, titulo, preco: {min, max} (hoje), preco_campanha: {min, max} (o que o cadastro aceita)}] | naoLido. */
    function produtosDaCampanha(j) {
        const d = resposta(j), info = d && d.info;
        // campanha sem produto recomendado: vem {check_list, total_count: null}, sem 'info' (lista vazia, não "a tela mudou")
        if (d && info === undefined && (d.total_count === null || d.total_count === 0)) return [];
        if (!Array.isArray(info)) return M.naoLido('produtos da campanha não reconhecidos');
        const faixa = f => ({ min: f && f.lowest_price ? dinheiro(f.lowest_price) : null, max: f && f.highest_price ? dinheiro(f.highest_price) : null });
        return info.map(x => x && x.recommend_product_info).filter(p => p && idTxt(p.product_id)).map(p => ({ produto_id: String(p.product_id), titulo: String(p.product_name || '').slice(0, 120),
            preco: faixa(p.sale_price_range), preco_campanha: faixa(p.campaign_price_range) }));
    }

    /**
     * Lista de Pedidos (POST /api/fulfillment/order/list): a ligação sku_id → SKU do vendedor. Só main_order_id, payment_time e, de cada SKU, sku_id,
     * seller_sku_name e quantity. O sku_id é o mesmo de Finanças; vários sku_id podem ter o mesmo SKU. Pedido sem payment_time (Pix não pago) não é venda.
     * → { total, tem_mais, pedidos: [{pedido_id, pago_em, itens: [{sku_id, sku, qtd}]}] } | naoLido
     */
    function skusDaListaDePedidos(j) {
        const d = resposta(j), ps = d && d.main_orders;
        // Aba vazia (ex.: "Para enviar" sem pedidos): a tela omite main_orders e declara total_count 0 — é o vazio, não "tela mudou" (E23, ao vivo 09/10).
        if (!Array.isArray(ps)) return d && ps === undefined && d.total_count === 0 ? { total: 0, tem_mais: false, pedidos: [] } : M.naoLido('lista de pedidos não reconhecida');
        return { total: typeof d.total_count === 'number' ? d.total_count : null, tem_mais: d.has_more === true,
            pedidos: ps.filter(p => p && idTxt(p.main_order_id)).map(p => ({ pedido_id: String(p.main_order_id), pago_em: U.dia((p.trade_order_module || {}).payment_time) || null,
                itens: (Array.isArray(p.sku_module) ? p.sku_module : []).filter(s => s && idTxt(s.sku_id)).map(s => ({ sku_id: String(s.sku_id), sku: String(s.seller_sku_name || '').trim(), qtd: Number(s.quantity) > 0 ? Number(s.quantity) : 1 })) })) };
    }
    const skuAnunciado = s => ({ sku_id: String(s.id), sku: String(s.seller_sku || '').trim(), preco: s.base_price ? U.num(s.base_price.sale_price) : null });
    /**
     * Produtos › Gerenciar produtos (GET product/local/products/list; vem 1 SKU por produto até a seller expandir a linha) →
     * [{produto_id, total_skus, comissao_pct (afiliado: commission_rate 1200 = 12%), skus: [{sku_id, sku, preco}]}] | naoLido. Nada do armazém.
     */
    function produtosAnunciados(j) {
        const d = resposta(j), ps = d && d.products;
        if (!Array.isArray(ps)) return M.naoLido('lista de produtos não reconhecida');
        return ps.filter(p => p && idTxt(p.product_id)).map(p => {
            const taxa = p.commission_plan_info ? U.num(p.commission_plan_info.commission_rate) : null;
            return { produto_id: String(p.product_id), total_skus: Number.isInteger(p.total_sku_count) ? p.total_sku_count : null, comissao_pct: taxa === null ? null : taxa / 100,
                skus: (Array.isArray(p.skus) ? p.skus : []).filter(s => s && idTxt(s.id)).map(skuAnunciado) };
        });
    }
    /** Variações de 1 produto (GET product/local/product/skus/list, quando a seller clica em "Expandir") → [{sku_id, sku, preco}] | naoLido. */
    function skusDoProduto(j) {
        const d = resposta(j);
        return Array.isArray(d) ? d.filter(s => s && idTxt(s.id)).map(skuAnunciado) : M.naoLido('variações do produto não reconhecidas');
    }
    /** Lista de tarefas da Página inicial (GET seller/home_task/get): só o contador "Mensagens não lidas de clientes" → { mensagens_nao_lidas } | naoLido. */
    function tarefasDaPaginaInicial(j) {
        const d = resposta(j), cs = d && d.home_cards;
        if (!Array.isArray(cs)) return M.naoLido('lista de tarefas não reconhecida');
        const c = cs.find(x => x && x.card_title === 'home_task_unread_buyer_message_title'), v = c ? U.num(c.card_value) : null;
        return v === null ? M.naoLido('contador de mensagens não veio') : { mensagens_nao_lidas: v };
    }

    /**
     * Ads do TikTok no mês: o gasto do GMV Max fica FORA do repasse, então vem do campo manual de Ajustes ({'AAAA-MM': R$, nao_uso: bool}).
     * Valor do mês; sem valor, 0 só com "não uso Ads no TikTok" (zero informado de propósito); senão null = não informado ("≈"), nunca zero.
     */
    function adsDoMes(adsManual, mes) {
        const a = adsManual || {}, v = U.num(a[mes]);
        return v !== null && v >= 0 ? U.r2(v) : (a.nao_uso === true ? 0 : null);
    }
    const TIPOS_DO_MES = ['comissao', 'taxa_fixa', 'programa_frete', 'afiliado', 'afiliado_ads'];
    /**
     * Mês do TikTok (3.3.0, E6), pela data da VENDA, no formato do mês do ML (ml.mesDaCascata), para o motor.somaCanais.
     * d = { mes, conta, resultados (motor.lucroPedido de cada pedido lido; exato: true = tarifas do detalhe do pedido; status_repasse), ads_manual }.
     * Completo no mês: vendas líquidas (grupo 46: já sem o desconto do vendedor e sem reembolso), taxas (51), frete líquido (53), liquidação e lucro.
     * Por tipo (comissão, SFP, por item, criadores…): só quando TODOS os pedidos do mês têm detalhe; senão as linhas saem null ("—", com
     * n_com_detalhe de n_pedidos) e a soma dos que têm detalhe fica em por_tipo_parcial — nunca como total.
     * Ads: pelo motor.fechamentoMes (ads_nas_tarifas: false). Não informado → aprox ("≈") com o motivo; o lucro sai sem o Ads.
     * → { canal, conta, mes, linhas:[{id, sinal:'total'|'menos'|'info', valor, tipo?}], bruto, cancelado, custosML (taxas + frete + Ads), liquido, produtos,
     *     imposto, lucro, despesas, sobra, faltando, aprox, motivo, ads, taxas, frete, liquidacao, n_pedidos, n_com_detalhe, n_em_espera (valor ainda estimado pelo TikTok),
     *     por_tipo_completo, por_tipo, por_tipo_parcial }
     */
    function mesDosPedidos(d) {
        d = d || {};
        const mes = String(d.mes || ''), res = (d.resultados || []).filter(r => r && U.mes(r.data) === mes), n = res.length, tp = r => r.tarifas_por_tipo || {};
        const lido = n > 0 && res.every(r => typeof r.repasse === 'number'), com = res.filter(r => r.exato), completo = lido && com.length === n;
        const ads = adsDoMes(d.ads_manual, mes), f = MO.fechamentoMes({ mes, resultados: res, ads_mes: ads, ads_nas_tarifas: false });
        const soma = g => (lido ? U.soma(res, g) : null);
        const porTipo = lista => { const t = {}; lista.forEach(r => Object.keys(tp(r)).forEach(c => { if (c !== 'frete_venda') t[c] = U.r2((t[c] || 0) + tp(r)[c]); })); return t; };
        const todos = porTipo(res), tipos = completo ? todos : null, linhas = [];
        const add = (id, sinal, valor, extra) => linhas.push(Object.assign({ id, sinal, valor: valor === null ? null : U.r2(valor) }, extra || {}));
        const bruto = soma(r => r.receita_liquida), taxas = lido ? U.soma(Object.keys(todos), c => todos[c]) : null, frete = soma(r => tp(r).frete_venda || 0);
        const cancelado = completo ? U.soma(res, r => r.reembolso) : null;
        add('bruto', 'total', bruto);
        add('cancelado', 'info', cancelado);   // só informa: o reembolso já está fora das vendas líquidas
        add('taxas', 'menos', taxas);
        TIPOS_DO_MES.concat(Object.keys(tipos || {}).filter(c => TIPOS_DO_MES.indexOf(c) < 0)).forEach(c => add(c, 'info', tipos ? tipos[c] || 0 : null, { tipo: c }));   // o detalhe das taxas
        add('frete_venda', 'menos', frete, { tipo: 'frete_venda' });
        add('ads', 'menos', ads, { tipo: 'ads' });
        const custos = lido ? U.r2(taxas + frete + (ads || 0)) : null, liquido = lido ? U.r2(bruto - custos) : null;
        add('liquido', 'total', liquido);
        const contaFeita = lido && f.pendentes === 0;   // pedido sem custo: o lucro do mês fica "—" (nunca a soma só dos que têm custo)
        const produtos = contaFeita ? U.soma(res, r => (r.custo_rs || 0) + (r.outros_rs || 0)) : null, imposto = soma(r => r.imposto_rs);
        add('produtos', 'menos', produtos);
        add('imposto', 'menos', imposto);
        const lucro = contaFeita ? f.lucro_mes : null;
        add('lucro', 'total', lucro);
        return { canal: 'tiktok', conta: String(d.conta || ''), mes, linhas, bruto, cancelado, custosML: custos, liquido, produtos, imposto, lucro, despesas: null, sobra: null,
            faltando: [lido ? '' : 'pedidos', lido && !contaFeita ? 'custo_produtos' : ''].filter(Boolean), aprox: f.aprox, motivo: f.aprox ? 'Ads do TikTok não informado' : '',
            ads, taxas, frete, liquidacao: soma(r => r.repasse), n_pedidos: n, n_com_detalhe: com.length, n_em_espera: res.filter(r => r.status_repasse === 'a_liberar').length,
            por_tipo_completo: completo, por_tipo: tipos, por_tipo_parcial: completo || !com.length ? null : porTipo(com) };
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
        pedidosDaListaFinanceira, aReceberPorMotivo, saldoDisponivel, pendenciasAfiliados, campanhasAbertas, violacoes, filtroPedidoSemComprador,
        // telas de 03/10/2026 (3.3.0, E6)
        pedidoTemDetalhe, tiposDoDemonstrativo, resumoFinanceiro, totalPago, indicadoresDaLoja, pontuacaoDaLoja, devolucoesDaLista, painelDeDevolucoes, devolucoesAbertas,
        campanhasDaTela, campanhasInscritas, convitesDeCampanha, regraDePreco, produtosDaCampanha, skusDaListaDePedidos, produtosAnunciados, skusDoProduto,
        tarefasDaPaginaInicial, adsDoMes, mesDosPedidos };
});
