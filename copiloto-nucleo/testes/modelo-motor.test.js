// Modelo único (fábricas + validação) e motor de lucro: casos de conta completos, "não lido", rateio de Ads, produto e fechamento do mês.
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const CN = require('..');
const M = CN.modelo, MO = CN.motor, U = CN.util, CO = CN.conciliacao;
const O = { canal: 'shopee', conta: 'loja-sp', fonte: 'api' };
const ped = (id, data, itens, x) => M.garantir('pedido', Object.assign({}, O, { id, data_venda: data, status: 'entregue', itens }, x || {}));
const tar = (pedido_id, tipo, valor, x) => M.garantir('tarifa', Object.assign({}, O, { pedido_id, data: '2026-09-10', tipo, valor }, x || {}));

test('util: dinheiro brasileiro, datas em Brasília (ms e segundos) e centavos sem −0', () => {
    assert.equal(U.num('R$ 1.234,56'), 1234.56);
    assert.equal(U.num('−6,00'), -6);
    assert.equal(U.num('549.9'), 549.9);
    assert.equal(U.num('1,234.56'), null);
    assert.equal(U.num('6abc'), null);
    assert.equal(U.dia('1786123946775'), '2026-08-07');   // placed_time do TikTok (ms em texto)
    assert.equal(U.dia(1784788549), '2026-07-23');        // create_time do pedido TikTok (segundos)
    assert.equal(U.dia('2026-02-30'), null);
    assert.equal(Object.is(U.r2(-0.001), 0), true);
    assert.equal(U.somaDias('2026-12-30', 3), '2027-01-02');
});

test('modelo: fábrica normaliza, validação acusa cada campo, id grande só como texto', () => {
    const p = M.pedido(Object.assign({}, O, { id: 'X1', data_venda: '1786123946775', status: 'pago', itens: [{ sku: 'A', qtd: 2, preco_unit: 'R$ 10,50' }] }));
    assert.equal(p.data_venda, '2026-08-07');
    assert.equal(p.itens[0].preco_unit, 10.5);
    assert.equal(p.desconto_vendedor, 0);
    assert.deepEqual(M.validar('pedido', p), []);
    const ruim = M.criar('pedido', { canal: 'aliexpress', conta: '', fonte: 'robo', id: 5779689791199227098, data_venda: 'ontem', status: 'x', itens: [{ qtd: 0 }] });
    const erros = M.validar('pedido', ruim).join(' | ');
    ['pedido.canal', 'pedido.conta', 'pedido.fonte', 'pedido.id: id numérico grande', 'pedido.data_venda', 'pedido.status', 'pedido.itens[0].qtd'].forEach(e => assert.ok(erros.indexOf(e) >= 0, e + ' em ' + erros));
    assert.throws(() => M.garantir('tarifa', Object.assign({}, O, { data: '2026-09-01', tipo: 'tarifa_venda', valor: 1 })), /tipo: valor fora da lista/);
    assert.throws(() => M.garantir('custo_sku', { sku: 'K' }), /custo ou de componentes/);
    assert.throws(() => M.garantir('ads', Object.assign({}, O, { custo: 5 })), /dia ou de periodo/);
    assert.deepEqual(M.TIPOS_TARIFA, ['comissao', 'taxa_fixa', 'programa_frete', 'pagamento', 'frete_venda', 'frete_devolucao', 'afiliado', 'afiliado_ads', 'ads', 'armazenagem', 'imposto_canal', 'assinatura', 'outro']);
    assert.equal(M.ehNaoLido(M.naoLido('sessão caiu')), true);
});

test('conta completa Shopee: 2 SKUs, desconto do vendedor, estorno parcial, imposto, embalagem e Ads por anúncio/dia', () => {
    const p = ped('SP-1', '2026-09-10', [{ sku: 'CAMISA-P', anuncio_id: 'AN1', qtd: 2, preco_unit: 59.9 }, { sku: 'MEIA', anuncio_id: 'AN2', qtd: 1, preco_unit: 19.9 }], { desconto_vendedor: 10 });
    const tarifas = [
        tar('SP-1', 'comissao', 27.96), tar('SP-1', 'taxa_fixa', 12), tar('SP-1', 'frete_venda', 8.5),
        tar('SP-1', 'comissao', -1.2, { texto_original: 'ajuste de comissão (estorno)' }), tar('OUTRO', 'comissao', 99),
    ];
    const custos = [{ sku: 'CAMISA-P', custo: 18, outros: 1.2 }, { sku: 'MEIA', custo: 4 }].map(c => M.garantir('custo_sku', c));
    const ads = [
        M.garantir('ads', Object.assign({}, O, { anuncio_id: 'AN1', dia: '2026-09-10', custo: 9 })),
        M.garantir('ads', Object.assign({}, O, { anuncio_id: 'AN2', dia: '2026-09-11', custo: 3 })),   // dia sem venda: não rateia
    ];
    const rat = MO.rateioAds(ads, [p]);
    assert.equal(rat.total_rateado, 9);
    assert.equal(rat.total_nao_rateado, 3);
    const r = MO.lucroPedido(p, { tarifas, custos, imposto_pct: 8, outros: 2.5, ads: rat.porPedido['SP-1'] });
    assert.equal(r.bruto, 139.7);
    assert.equal(r.receita, 129.7);
    assert.deepEqual(r.tarifas_por_tipo, { comissao: 26.76, taxa_fixa: 12, frete_venda: 8.5 });
    assert.equal(r.repasse, 82.44);                 // 129,70 − 47,26
    assert.equal(r.custo_rs, 40);                   // 2 × 18 + 4
    assert.equal(r.outros_rs, 4.9);                 // 2 × 1,20 + 2,50
    assert.equal(r.imposto_rs, 10.38);              // 8% de 129,70
    assert.equal(r.lucro_antes_ads, 27.16);
    assert.equal(r.lucro_real, 18.16);
    assert.equal(r.margem_pct, 14);
    assert.ok(r.linhas.some(l => l.rotulo === '= Repasse do canal' && l.valor === 82.44));
    const prod = MO.lucroPorProduto([r]);
    const camisa = prod.find(x => x.sku === 'CAMISA-P'), meia = prod.find(x => x.sku === 'MEIA');
    assert.equal(camisa.custo, 36);
    assert.equal(camisa.ads, 9, 'Ads do AN1 fica só na camisa');
    assert.equal(meia.ads, 0);
    assert.equal(camisa.unidades, 2);
    assert.equal(U.r2(camisa.lucro_real + meia.lucro_real), 18.16, 'soma dos produtos = lucro do pedido, no centavo (rateio pelo maior resto)');
    const fech = MO.fechamentoMes({ mes: '2026-09', resultados: [r], tarifas: tarifas.concat([M.garantir('tarifa', Object.assign({}, O, { data: '2026-09-30', tipo: 'assinatura', valor: 49.9, origem_pagamento: 'fatura' }))]), adsNaoRateado: rat.naoRateado });
    assert.equal(fech.lucro_pedidos, 18.16);
    assert.deepEqual(fech.sem_pedido.porTipo, { assinatura: 49.9 });
    assert.equal(fech.ads_nao_rateado, 3);
    assert.equal(fech.lucro_mes, -34.74);           // 18,16 − 49,90 − 3
    assert.equal(fech.completo, true);
});

test('"não lido" nunca vira zero: tarifas, preço e Ads', () => {
    const p = ped('SP-2', '2026-09-12', [{ sku: 'MEIA', qtd: 1, preco_unit: 19.9 }]);
    const custos = [{ sku: 'MEIA', custo: 4 }];
    const semTarifa = MO.lucroPedido(p, { custos });
    assert.equal(semTarifa.status, 'nao_lido');
    assert.deepEqual(semTarifa.faltando, ['tarifas']);
    assert.equal(semTarifa.repasse, null);
    assert.equal(semTarifa.lucro_real, null);
    const falhou = MO.lucroPedido(p, { custos, tarifas: M.naoLido('API fora') });
    assert.equal(falhou.lucro_real, null);
    const adsFalhou = MO.lucroPedido(p, { custos, tarifas: [], ads: M.naoLido('Ads não lido') });
    assert.equal(adsFalhou.lucro_antes_ads, 15.9);
    assert.equal(adsFalhou.lucro_real, null);
    const semPreco = MO.lucroPedido(M.criar('pedido', Object.assign({}, p, { itens: [{ sku: 'MEIA', qtd: 1, preco_unit: null }] })), { custos, tarifas: [] });
    assert.equal(semPreco.status, 'nao_lido');
    assert.ok(semPreco.faltando.indexOf('preco') >= 0);
    // Estimativa explícita pela tabela (Shopee CNPJ 2026: 20% + R$ 4): marcada como estimada.
    const est = MO.lucroPedido(p, { custos, estimar_tarifas: true });
    assert.equal(est.status, 'ok');
    assert.equal(est.tarifas_rs, 7.98);
    assert.equal(est.tarifas_estimadas, true);
    assert.ok(est.avisos.some(a => /estimadas/.test(a)));
    assert.ok(est.avisos.some(a => /imposto não configurado/.test(a)));
    // Canal sem tabela (Magalu ainda sem linha): estimar não inventa tarifa zero.
    const mg = MO.lucroPedido(Object.assign({}, p, { canal: 'magalu' }), { custos, estimar_tarifas: true });
    assert.equal(mg.status, 'nao_lido');
    assert.deepEqual(mg.faltando, ['tabela_tarifa']);
    assert.equal(mg.repasse, null);
    assert.equal(mg.lucro_real, null);
});

test('cancelado: sem receita, sem custo; tarifa cobrada e estornada zera', () => {
    const p = ped('SP-3', '2026-09-12', [{ sku: 'SEM-CUSTO', qtd: 1, preco_unit: 80 }], { status: 'cancelado' });
    const r = MO.lucroPedido(p, { tarifas: [tar('SP-3', 'comissao', 11.2), tar('SP-3', 'comissao', -11.2)], custos: [] });
    assert.equal(r.status, 'cancelado');
    assert.equal(r.receita, 0);
    assert.equal(r.repasse, 0);
    assert.equal(r.lucro_real, 0);
});

test('devolução com frete de volta (só na Devolucao) e produto de volta ao estoque', () => {
    const p = ped('SP-4', '2026-09-12', [{ sku: 'MEIA', qtd: 1, preco_unit: 50 }], { status: 'devolvido' });
    const dev = M.garantir('devolucao', Object.assign({}, O, { pedido_id: 'SP-4', valor_reembolsado: 50, frete_volta: 12.3, produto_voltou: true }));
    const r = MO.lucroPedido(p, { tarifas: [tar('SP-4', 'frete_venda', 9)], devolucoes: [dev], custos: [{ sku: 'MEIA', custo: 4 }], imposto_pct: 6 });
    assert.equal(r.reembolso, 50);
    assert.equal(r.receita_liquida, 0);
    assert.deepEqual(r.tarifas_por_tipo, { frete_venda: 9, frete_devolucao: 12.3 });
    assert.equal(r.custo_rs, 0);
    assert.equal(r.lucro_real, -21.3);
});

test('conciliação: ok, a menor, atrasado, aguardando entrega, grupo e repasse não lido', () => {
    const tt = { canal: 'tiktok', conta: 'tt', fonte: 'api' };
    const P = (id, x) => M.garantir('pedido', Object.assign({}, tt, { id, data_venda: '2026-09-01', status: 'entregue', itens: [{ sku: 'A', qtd: 1, preco_unit: 100 }] }, x || {}));
    const T = id => M.garantir('tarifa', Object.assign({}, tt, { pedido_id: id, data: '2026-09-01', tipo: 'comissao', valor: 16 }));
    const R = (id, valor, pedidos, x) => M.garantir('repasse', Object.assign({}, tt, { id, valor, pedidos, status: 'disponivel', data_liberada: '2026-09-10' }, x || {}));
    const pedidos = [P('ok', { data_entrega: '2026-09-02' }), P('menor', { data_entrega: '2026-09-02' }), P('atrasado', { data_entrega: '2026-09-02' }),
        P('transito', { status: 'enviado' }), P('g1'), P('g2'), P('futuro', { data_entrega: '2026-09-28' })];
    const tarifas = pedidos.map(p => T(p.id));
    const repasses = [R('r1', 84, ['ok']), R('r1', 84, ['ok']), R('r2', 80.5, ['menor']), R('r3', 168, ['g1', 'g2']), R('r9', 50, ['de-outro-periodo'])];
    const c = CO.conciliar({ pedidos, tarifas, repasses, hoje: '2026-09-30' });
    const st = Object.fromEntries(c.pedidos.map(l => [l.pedido_id, l.status]));
    assert.deepEqual(st, { ok: 'ok', menor: 'a_menor', atrasado: 'atrasado', transito: 'aguardando_entrega', g1: 'agrupado', g2: 'agrupado', futuro: 'aguardando' });
    assert.equal(c.pedidos.find(l => l.pedido_id === 'menor').diferenca, -3.5);
    assert.equal(c.pedidos.find(l => l.pedido_id === 'atrasado').data_prevista, '2026-09-09');
    assert.equal(c.grupos[0].status, 'ok');
    assert.equal(c.grupos[0].esperado, 168);
    assert.equal(c.sem_pedido.length, 1);
    assert.equal(c.totais.recebido, 332.5, 'repasse repetido (r1) conta uma vez');
    assert.equal(c.totais.diferenca, -3.5);
    const nl = CO.conciliar({ pedidos, tarifas, repasses: M.naoLido('extratos fora'), hoje: '2026-09-30' });
    assert.ok(nl.pedidos.every(l => l.status === 'nao_lido' || l.status === 'agrupado'));
    assert.equal(nl.totais.repasses_nao_lidos, true);
    const porMes = CO.conciliarPorMes([{ data: '2026-09-01', repasse: 84 }, { data: '2026-09-02', repasse: null }], repasses);
    assert.equal(porMes['2026-09'].pedidos_nao_lidos, 1);
});

test('adaptador: definição errada é erro de programação; ler() separa rejeitados', async () => {
    const A = CN.adaptador;
    assert.throws(() => A.criarAdaptador({ id: 'xyz', nome: 'X', hosts: [] }), /id de canal inválido/);
    assert.throws(() => A.criarAdaptador({ id: 'magalu', nome: 'Magalu', hosts: [], pedidos: 'não é função' }), /precisa ser função/);
    const a = A.criarAdaptador({ id: 'magalu', nome: 'Magalu', hosts: ['magalu.com'], fonte: { pedidos: 'api' },
        pedidos: async () => [ped('MG-1', '2026-09-01', [{ sku: 'A', qtd: 1, preco_unit: 10 }], { canal: 'magalu' }), { id: 'quebrado' }] });
    const r = await a.ler('pedidos');
    assert.equal(r.status, 'ok');
    assert.equal(r.dados.length, 1);
    assert.equal(r.rejeitados.length, 1);
    assert.ok(r.rejeitados[0].erros.length > 3);
    assert.equal(a.naoInforma('repasses'), 'Este canal não informa os repasses.');
    const reg = A.registrar({}, a);
    assert.equal(reg.magalu, a);
});

test('somaCanais ("Todos"): total = soma dos canais ao centavo, % numa conta só, "≈" do canal pendente e do canal sem número', () => {
    const s = MO.somaCanais([{ canal: 'ml', conta: '123', lucro: 810.1 }, { canal: 'tiktok', conta: '765', lucro: 189.2 }]);
    assert.equal(s.total, 999.3);
    assert.deepEqual(s.canais.map(c => [c.canal, c.valor, c.pct, c.aprox]), [['ml', 810.1, 81.1, false], ['tiktok', 189.2, 18.9, false]]);
    assert.equal(s.aprox, false);
    assert.equal(MO.somaCanais([{ canal: 'ml', lucro: 0.1 }, { canal: 'tiktok', lucro: 0.2 }]).total, 0.3, 'centavo exato (0,1 + 0,2 não vira 0,30000000000000004)');
    const tres = MO.somaCanais(['ml', 'tiktok', 'shopee'].map(canal => ({ canal, lucro: 10 })));
    assert.deepEqual(tres.canais.map(c => c.pct), [33.3, 33.3, 33.3], 'valor ÷ total com 1 casa: a coluna pode somar 99,9%');
    // Canal com "≈" entra na soma e põe "≈" no total; canal sem número fica fora, com o motivo.
    const p = MO.somaCanais([{ canal: 'ml', lucro: 500 }, { canal: 'magalu', lucro: 50.55, aprox: true, motivo: 'devoluções ainda não lidas' },
        { canal: 'tiktok', conta: '765', lucro: null, faltando: ['custo_produtos'] }, { canal: 'shopee', lucro: null }]);
    assert.equal(p.total, 550.55);
    assert.equal(p.aprox, true);
    assert.deepEqual(p.motivos, [{ canal: 'magalu', conta: '', motivo: 'devoluções ainda não lidas' }, { canal: 'tiktok', conta: '765', motivo: 'falta: custo dos produtos' },
        { canal: 'shopee', conta: '', motivo: 'não lido' }]);
    assert.equal(MO.somaCanais([{ canal: 'tiktok', lucro: 10, aprox: true }]).motivos[0].motivo, 'valor aproximado', 'com número e "≈" sem motivo: nunca "não lido"');
    assert.deepEqual(p.canais.map(c => [c.canal, c.pct, c.aprox]), [['ml', 90.8, false], ['magalu', 9.2, true], ['tiktok', null, true], ['shopee', null, true]]);
    const nada = MO.somaCanais([{ canal: 'ml', lucro: null }]);
    assert.ok(nada.total === null && nada.aprox, 'nenhum número: total "—", nunca 0');
    const prej = MO.somaCanais([{ canal: 'ml', lucro: 100 }, { canal: 'tiktok', lucro: -300 }]);
    assert.ok(prej.total === -200 && prej.canais.every(c => c.pct === null), 'prejuízo no total: sem %');
    assert.equal(MO.somaCanais([{ canal: 'ml', bruto: 9300, lucro: 1 }, { canal: 'tiktok', bruto: 700, lucro: 2 }], 'bruto').total, 10000, 'outro campo (vendas brutas)');
});
