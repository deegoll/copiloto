// Etiqueta de ganho por produto (N-B TikTok, N-C Shopee, N-D Magalu): a mesma conta do tarifas.simular, com os exemplos das regras
// oficiais e a lista real (anonimizada) da Shopee: tests/copiloto/fixtures/shopee_produtos_2026-10-07.json (retrato M2, 07/10/2026).
'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('path'), fs = require('fs');
const CN = require('..');
const E = CN.etiqueta, { produtosDaLista } = CN.adaptadores.shopee;
const DIA = '2026-10-07';

test('Shopee, exemplo oficial: item de R$ 500 paga R$ 96 (14% + R$ 26) e recebe R$ 404; com custo R$ 300 sobra R$ 104 · margem 20,8%', () => {
    const e = E.daVariacao('shopee', 500, { custo: 300 }, DIA);
    assert.equal(e.tarifas_rs, 96);
    assert.equal(e.repasse, 404);
    assert.equal(e.sobra, 104);
    assert.equal(e.texto, 'Sobra R$ 104,00 · margem 20,8%');
    assert.equal(e.classe, 'lucrativo');
});

test('sem custo: "Informe o custo", nunca lucro inventado (o repasse aparece)', () => {
    const e = E.daVariacao('shopee', 500, {}, DIA);
    assert.equal(e.classe, 'sem_custo');
    assert.equal(e.texto, 'Informe o custo');
    assert.equal(e.sobra, null);
    assert.equal(e.repasse, 404);
});

test('prejuízo e imposto: R$ 50 na Shopee (20% + R$ 4,50 = R$ 14,50) com custo R$ 33 e 6% de imposto → prejuízo R$ 0,50', () => {
    const e = E.daVariacao('shopee', 50, { custo: 33, imposto_pct: 6 }, DIA);
    assert.equal(e.tarifas_rs, 14.5);
    assert.equal(e.sobra, -0.5);
    assert.equal(e.classe, 'prejuizo');
    assert.equal(e.texto, 'Prejuízo R$ 0,50 · margem -1%');
});

test('TikTok depois de 15/07/2026: R$ 100 paga 6% + R$ 6 e o SFP 6% (R$ 18) → recebe R$ 82', () => {
    const e = E.daVariacao('tiktok', 100, { custo: 50 }, DIA);
    assert.equal(e.tarifas_rs, 18);
    assert.equal(e.repasse, 82);
    assert.equal(e.sobra, 32);
});

test('Magalu sem tabela lida: "não lido" (nunca zero); com a comissão informada em Ajustes, a conta sai', () => {
    const e = E.daVariacao('magalu', 100, { custo: 50 }, DIA);
    assert.equal(e.classe, 'nao_lido');
    assert.match(e.texto, /Magalu não lida/);
    assert.equal(e.sobra, undefined);
    // 9,9% (comissão de novos vendedores, docs/canais/magalu.md) informada em Ajustes: R$ 100 − 9,90 − 50 = R$ 40,10, com o aviso de "manual".
    const i = E.daVariacao('magalu', 100, { custo: 50, comissao_pct: 9.9 }, DIA);
    assert.equal(i.sobra, 40.1);
    assert.equal(i.confianca, 'manual');
    assert.match(i.avisos.join(' '), /comissão informada por você/);
    assert.equal(E.daVariacao('shopee', 500, { custo: 300, comissao_pct: 99 }, DIA).sobra, 104 - (500 * 0.99 - 70), 'na Shopee a comissão manual substitui a da tabela (regra do tarifasDoItem)');
});

test('produto com variações de preços diferentes: a faixa da menor à maior sobra; variação sem custo é contada à parte', () => {
    const custos = { A: { custo: 300 }, B: { custo: 100 } };
    const p = { produto_id: '1', variacoes: [{ sku: 'A', preco: 500 }, { sku: 'B', preco: 200 }, { sku: 'C', preco: 200 }] };
    const r = E.doProduto('shopee', p, s => custos[s] || null, {}, DIA);
    // A: 500 − 96 − 300 = 104 · B: 200 − (14% de 200 = 28 + 26) − 100 = 46
    assert.equal(r.sobra_min, 46);
    assert.equal(r.sobra_max, 104);
    assert.equal(r.texto, 'Sobra de R$ 46,00 a R$ 104,00 · margem 23% a 20,8% · 1 variação sem custo');
    assert.equal(r.classe, 'lucrativo');
    const nada = E.doProduto('shopee', p, () => null, {}, DIA);
    assert.equal(nada.texto, 'Informe o custo');
});

test('lista real da Shopee (retrato M2): todo produto vira etiqueta; o custo pelo SKU do produto vale para as variações sem SKU', () => {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, '../../tests/copiloto/fixtures/shopee_produtos_2026-10-07.json'), 'utf8'));
    const r = j.respostas.find(x => /get_product_list$/.test(x.url));
    const ps = produtosDaLista(r.corpo);
    assert.ok(Array.isArray(ps) && ps.length >= 10, 'produtos lidos: ' + (ps && ps.length));
    const p = ps.find(x => x.produto_id === '90000000003');
    assert.equal(p.sku, 'SKU-1');
    assert.equal(p.preco, 609, 'preço de promoção em andamento');
    assert.equal(p.preco_cheio, 641.15);
    assert.equal(p.variacoes.length, 1);
    assert.equal(p.variacoes[0].sku, 'SKU-1', 'variação sem SKU usa o do produto');
    assert.equal(p.variacoes[0].preco, 609);
    ps.forEach(x => {
        const e = E.doProduto('shopee', x, s => (s === x.sku ? { custo: 10 } : null), {}, DIA);
        assert.ok(['lucrativo', 'apertado', 'prejuizo', 'sem_custo', 'sem_preco'].indexOf(e.classe) >= 0, x.produto_id + ': ' + e.classe);
        assert.ok(!/NaN|undefined|null/.test(e.texto), x.produto_id + ': ' + e.texto);
    });
    assert.equal(produtosDaLista({ code: 0, data: {} }).nao_lido, true, 'formato desconhecido → não lido');
});
