// Adaptador Shopee com os exemplos NUMÉRICOS das regras oficiais (seller.shopee.com.br/edu/article/18483, 18484, 22528, 26839; lidas em
// 30/09/2026). O escrow segue os nomes da Open Platform (payment.get_escrow_detail). Onde o campo exato é desconhecido (em qual campo cai
// o fixo por item), o teste confere a SOMA — o resto fica "mapear ao vivo" no MAPEAMENTO-SHOPEE.md.
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const CN = require('..');
const { transacaoDoEscrow, confereTabela, tarifaEstimada, pedidoDoDetalhe, filtroPedidoSemComprador, criarAdaptadorShopee } = CN.adaptadores.shopee;
const M = CN.modelo;
const CONTA = 'loja-sp-1';
const escrow = (sn, oi) => ({ response: { order_sn: sn, order_income: Object.assign({ seller_discount: 0, voucher_from_seller: 0, seller_transaction_fee: 0,
    actual_shipping_fee: 0, buyer_paid_shipping_fee: 0, shopee_shipping_rebate: 0 }, oi) } });
const porTipo = ts => ts.reduce((a, t) => { a[t.tipo] = Math.round(((a[t.tipo] || 0) + t.valor) * 100) / 100; return a; }, {});
const total = ls => Math.round(ls.reduce((a, l) => a + l.valor, 0) * 100) / 100;

test('exemplo oficial: item de R$ 500 paga R$ 96 de comissão e a loja recebe R$ 404 — escrow fecha e bate com a tabela', () => {
    const t = transacaoDoEscrow(escrow('SP500', { original_price: 500, commission_fee: 96, escrow_amount: 404 }), { conta: CONTA, data: '2026-09-30' });
    assert.equal(t.pedido_id, 'SP500');
    assert.deepEqual(t.receita, { bruto: 500, desconto_vendedor: 0, reembolso: 0, outros: 0 });
    assert.deepEqual(porTipo(t.tarifas), { comissao: 96 });
    assert.equal(t.repasse.valor, 404);
    assert.equal(t.confere.diferenca, 0);
    assert.deepEqual(t.avisos, []);
    assert.deepEqual(confereTabela(t, [{ preco_unit: 500, qtd: 1 }]), { tabela: 96, escrow: 96, diferenca: 0 });
    t.tarifas.forEach(x => assert.deepEqual(M.validar('tarifa', x), []));
    assert.deepEqual(M.validar('repasse', t.repasse), []);
    assert.deepEqual(M.validar('frete', t.frete), []);
});

test('fixo em service_fee ou em commission_fee: a soma é a mesma (campo exato: mapear ao vivo)', () => {
    const t = transacaoDoEscrow(escrow('SP500B', { original_price: 500, commission_fee: 70, service_fee: 26, escrow_amount: 404 }), { conta: CONTA, data: '2026-09-30' });
    assert.deepEqual(porTipo(t.tarifas), { comissao: 96 });
    assert.equal(t.confere.diferenca, 0);
});

test('R$ 50 (até R$ 79,99): 20% + R$ 4 até 30/09/2026 e 20% + R$ 4,50 desde 01/10/2026 — a data da venda manda', () => {
    const e = escrow('SP50', { original_price: 50, commission_fee: 14.5, escrow_amount: 35.5 });
    const out = transacaoDoEscrow(e, { conta: CONTA, data: '2026-10-01' }), set = transacaoDoEscrow(e, { conta: CONTA, data: '2026-09-30' });
    assert.equal(out.confere.diferenca, 0);
    assert.deepEqual(confereTabela(out, [{ preco_unit: 50, qtd: 1 }]), { tabela: 14.5, escrow: 14.5, diferenca: 0 });
    assert.deepEqual(confereTabela(set, [{ preco_unit: 50, qtd: 1 }]), { tabela: 14, escrow: 14.5, diferenca: 0.5 });
});

test('kit formal: comissão e fixo como 1 item só (R$ 120 → 14% + R$ 20 = R$ 36,80, não 3 × (20% + R$ 4,50))', () => {
    assert.equal(total(tarifaEstimada(120, { qtd: 1 }, '2026-10-01')), 36.8);
    assert.equal(total(tarifaEstimada(40, { qtd: 3 }, '2026-10-01')), 37.5);
});

test('CPF: tabela do CNPJ; + R$ 3 por item só quando a loja passa de 450 pedidos em 90 dias', () => {
    assert.equal(total(tarifaEstimada(30, { pessoa: 'cpf' }, '2026-10-01')), 10.5);
    assert.equal(total(tarifaEstimada(30, { pessoa: 'cpf', cpf_acima_450: true }, '2026-10-01')), 13.5);
    assert.equal(total(tarifaEstimada(79.99, { pessoa: 'cpf', cpf_acima_450: true, qtd: 2 }, '2026-10-01')), 47);   // 2 × (16 + 4,50 + 3)
    assert.equal(total(tarifaEstimada(30, { pessoa: 'cnpj', cpf_acima_450: true }, '2026-10-01')), 10.5, 'CNPJ nunca paga o adicional');
    assert.match(tarifaEstimada(10, { pessoa: 'cpf', cpf_acima_450: true }, '2026-10-01').find(l => l.fixo === 3).regra, /regressivo/);
    assert.equal(tarifaEstimada(50, {}, '2026-01-10'), null, 'antes de 01/03/2026 não há tabela: usar o escrow real');
});

test('desconto do vendedor, cupom do vendedor, frete grátis coberto pela Shopee e afiliado: tudo entra e fecha', () => {
    // Item de R$ 150, R$ 10 de desconto e R$ 5 de cupom do vendedor → base R$ 135: 14% = 18,90 + R$ 20 = 38,90. Afiliado de 10% = 13,50.
    // Frete de R$ 22 coberto pelo cupom de frete grátis (até R$ 30 de R$ 80 a R$ 199,99): sobra 0 para a loja.
    const t = transacaoDoEscrow(escrow('SP150', { original_price: 150, seller_discount: 10, voucher_from_seller: 5, commission_fee: 38.9,
        order_ams_commission_fee: 13.5, actual_shipping_fee: 22, shopee_shipping_rebate: 22, escrow_amount: 82.6 }), { conta: CONTA, data: '2026-10-01' });
    assert.equal(t.receita.desconto_vendedor, 15);
    assert.deepEqual(porTipo(t.tarifas), { comissao: 38.9, afiliado: 13.5 });
    assert.equal(t.frete.cobrado_vendedor, 0);
    assert.equal(t.frete.subsidio, 22);
    assert.equal(t.afiliados.length, 1);
    assert.equal(t.afiliados[0].comissao_pct, 10);
    assert.equal(t.confere.diferenca, 0);
    assert.deepEqual(confereTabela(t, [{ preco_unit: 135, qtd: 1 }]), { tabela: 38.9, escrow: 38.9, diferenca: 0 });
});

test('devolução com frete reverso e ajuste da carteira; escrow que não fecha vira aviso; falha vira naoLido (nunca zero)', () => {
    const t = transacaoDoEscrow(escrow('SPDEV', { original_price: 60, commission_fee: 0, seller_return_refund: -60, reverse_shipping_fee: 18,
        total_adjustment_amount: 0, escrow_amount_after_adjustment: -18, escrow_amount: 0 }), { conta: CONTA, data: '2026-10-01' });
    assert.equal(t.receita.reembolso, 60);
    assert.deepEqual(porTipo(t.tarifas), { frete_devolucao: 18 });
    assert.equal(t.repasse.valor, -18);
    assert.equal(t.confere.diferenca, 0);
    const torto = transacaoDoEscrow(escrow('SPX', { original_price: 50, commission_fee: 14.5, escrow_amount: 30 }), { conta: CONTA, data: '2026-10-01' });
    assert.equal(torto.confere.diferenca, -5.5);
    assert.match(torto.avisos.join(' '), /não fecha/);
    assert.ok(M.ehNaoLido(transacaoDoEscrow({ error: 'error_auth', message: 'x' }, { data: '2026-10-01' })));
    assert.ok(M.ehNaoLido(transacaoDoEscrow(escrow('SP1', { original_price: 1, escrow_amount: 1 }), {})), 'sem data da venda');
});

const DETALHE = { response: { order_list: [{
    order_sn: 'SPPED1', order_status: 'COMPLETED', create_time: 1790000000, payment_method: 'PIX', total_amount: 135,
    buyer_user_id: 999, buyer_username: 'comprador', recipient_address: { name: 'X', phone: '1', full_address: 'Rua' }, message_to_seller: 'oi', note: 'n',
    item_list: [{ item_id: 1, item_name: 'Produto', item_sku: 'PAI', model_sku: 'SKU-1', model_name: 'Azul', model_quantity_purchased: 2, model_original_price: 80, model_discounted_price: 67.5 }],
}] } };

test('detalhe do pedido: nada do comprador passa; SKU, quantidade, preço e Pix sim', () => {
    const f = filtroPedidoSemComprador(DETALHE), s = JSON.stringify(f);
    ['buyer_user_id', 'buyer_username', 'recipient_address', 'message_to_seller', 'note', 'Rua', 'comprador'].forEach(k => assert.ok(s.indexOf(k) < 0, k));
    const { pedido, avisos } = pedidoDoDetalhe(f.order_list[0], { conta: CONTA });
    assert.equal(pedido.status, 'entregue');
    assert.equal(pedido.pagamento, 'pix');
    assert.deepEqual(pedido.itens.map(i => [i.sku, i.qtd, i.preco_unit, i.total]), [['SKU-1', 2, 67.5, 135]]);
    assert.deepEqual(M.validar('pedido', pedido), []);
    assert.deepEqual(avisos, []);
    assert.ok(M.ehNaoLido(pedidoDoDetalhe({ order_sn: 'U', order_status: 'UNPAID' }).pedido));
    assert.match(pedidoDoDetalhe({ order_sn: 'Z', order_status: 'NOVO', create_time: 1790000000, item_list: [{ model_quantity_purchased: 1, model_discounted_price: 10 }] }).avisos[0], /não mapeado/);
});

test('adaptador: lê tarifas/repasses/pedidos pela API do servidor e diz o que ainda não informa', async () => {
    const a = criarAdaptadorShopee({ conta: CONTA, fontes: {
        escrows: async () => [{ data: '2026-09-30', resposta: escrow('SP500', { original_price: 500, commission_fee: 96, escrow_amount: 404 }) }],
        pedidos: async () => DETALHE.response.order_list,
    } });
    const tar = await a.ler('tarifas'), rep = await a.ler('repasses'), ped = await a.ler('pedidos');
    assert.equal(tar.status, 'ok');
    assert.equal(total(tar.dados), 96);
    assert.equal(rep.dados[0].valor, 404);
    assert.equal(ped.dados[0].id, 'SPPED1');
    assert.equal((await a.ler('ads')).status, 'nao_informa');
    assert.ok(a.hostLido('seller.shopee.com.br'));
    assert.ok(a.tarifa.length > 0 && a.tarifa.every(l => l.canal === 'shopee'));
});
