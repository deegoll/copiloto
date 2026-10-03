// Tabela de tarifas com vigência + simulação de preço. Paridade com o SHC.calcular / SHC.precoMinimo do Copiloto (ML) quando a
// extensão está ao lado (só leitura do calc.js; se não estiver, esses testes são pulados).
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('path'), fs = require('fs');
const CN = require('..');
const T = CN.tarifas, M = CN.modelo;
const CALC = path.join(__dirname, '..', '..', 'extension-copiloto', 'calc.js');
const temExtensao = fs.existsSync(CALC);

test('vigência: TikTok muda em 15/07/2026 (antes 6% + R$ 4; depois 6% + R$ 6 acima de R$ 50)', () => {
    const antes = T.tarifasDoItem('tiktok', 549.9, {}, '2026-07-10'), depois = T.tarifasDoItem('tiktok', 549.9, {}, '2026-07-23');
    const v = (ls, t) => ls.filter(l => l.tipo === t).reduce((a, l) => a + l.valor, 0);
    assert.equal(v(antes, 'taxa_fixa'), 4);
    assert.equal(v(depois, 'taxa_fixa'), 6);
    assert.equal(v(depois, 'comissao'), 32.99);
    assert.equal(v(depois, 'programa_frete'), 32.99, 'SFP 6% (padrão da conta observada)');
    const barato = T.tarifasDoItem('tiktok', 39.9, {}, '2026-09-30');
    assert.equal(v(barato, 'comissao'), 3.99);
    assert.equal(v(barato, 'taxa_fixa'), 4);
    assert.equal(T.tarifasDoItem('tiktok', 549.9, { frete_gratis_programa: false }, '2026-09-30').some(l => l.tipo === 'programa_frete'), false);
});

test('sem tabela na data = não lido (nunca tarifa zero)', () => {
    assert.equal(T.tarifasDoItem('shopee', 50, {}, '2026-01-10'), null);
    const s = T.simular('shopee', 50, { custo: 10 }, '2026-01-10');
    assert.equal(M.ehNaoLido(s), true);
    assert.equal(T.tarifasDoItem('magalu', 50, {}, '2026-09-30'), null);
});

test('Shopee CNPJ desde 03/2026: degraus 20% + R$ 4 → 14% + R$ 16/20/26 (oficial: R$ 500 → R$ 96)', () => {
    const t = p => T.simular('shopee', p, {}, '2026-09-30').tarifas_rs;
    assert.equal(t(50), 14);        // 10 + 4
    assert.equal(t(79.99), 20);     // 16 + 4
    assert.equal(t(80), 27.2);      // 11,20 + 16
    assert.equal(t(150), 41);       // 21 + 20
    assert.equal(t(300), 68);       // 42 + 26
    assert.equal(t(1000), 166);     // 140 + 26
    assert.equal(T.simular('shopee', 50, {}, '2026-09-30').confianca, 'oficial');
});

test('casos de controle (mesmo arquivo do teste PHP tests/Unit/TarifasCanalTest.php)', () => {
    const casos = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'tarifas_casos.json'), 'utf8')).casos;
    assert.ok(casos.length >= 20);
    const v = (ls, t) => Math.round(ls.filter(l => l.tipo === t).reduce((a, l) => a + l.valor, 0) * 100) / 100;
    casos.forEach(k => {
        const ls = T.tarifasDoItem(k.canal, k.preco, k.ctx || {}, k.data);
        assert.ok(ls && ls.length, k.nome);
        assert.equal(v(ls, 'comissao'), k.comissao, k.nome + ' (comissão)');
        assert.equal(v(ls, 'taxa_fixa'), k.fixo, k.nome + ' (fixo)');
        assert.equal(v(ls, 'programa_frete'), k.sfp, k.nome + ' (SFP)');
        assert.equal(Math.round(ls.reduce((a, l) => a + l.valor, 0) * 100) / 100, k.total, k.nome + ' (total)');
    });
});

test('controle 30/09/2026: % efetivo da Shopee e a data da venda manda (15/07 no TikTok, 01/10 na Shopee)', () => {
    const pct = (c, p, d) => Math.round(T.tarifasDoItem(c, p, {}, d).reduce((a, l) => a + l.valor, 0) / p * 1000) / 10;
    assert.equal(pct('shopee', 30, '2026-09-30'), 33.3);
    assert.equal(pct('shopee', 79.99, '2026-10-01'), 25.6);
    assert.equal(pct('shopee', 549.9, '2026-09-30'), 18.7);
    assert.notEqual(pct('shopee', 30, '2026-09-30'), pct('shopee', 30, '2026-10-01'));
    assert.notEqual(pct('tiktok', 549.9, '2026-07-14'), pct('tiktok', 549.9, '2026-07-15'));
});

test('subsídio Pix é dado neutro: sem ctx.pagamento nenhum caso atual muda', () => {
    const casos = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'tarifas_casos.json'), 'utf8')).casos;
    casos.filter(k => !(k.ctx && k.ctx.pagamento)).forEach(k => assert.equal(T.tarifasDoItem(k.canal, k.preco, k.ctx || {}, k.data).some(l => l.tipo === 'subsidio'), false, k.nome));
    const pix = T.tarifasDoItem('shopee', 100, { pagamento: 'pix' }, '2026-09-30').find(l => l.tipo === 'subsidio');
    assert.equal(pix.valor, -5);
    assert.equal(T.tarifasDoItem('shopee', 79.99, { pagamento: 'pix' }, '2026-09-30').some(l => l.tipo === 'subsidio'), false, 'abaixo de R$ 80 não tem');
});

test('troca de 01/10/2026 da Shopee sai só da tabela; SFP do TikTok tem teto; avisos de CNPJ e de data', () => {
    const fixo = (p, d) => T.tarifasDoItem('shopee', p, {}, d).filter(l => l.tipo === 'taxa_fixa').reduce((a, l) => a + l.valor, 0);
    assert.equal(fixo(50, '2026-09-30'), 4);
    assert.equal(fixo(50, '2026-10-01'), 4.5);
    assert.equal(fixo(7.98, '2026-09-30'), 3.99);   // abaixo de R$ 8: metade do preço
    assert.equal(fixo(8, '2026-09-30'), 4);
    assert.equal(fixo(8.98, '2026-10-01'), 4.49);   // abaixo de R$ 9 desde 01/10: metade do preço
    assert.equal(fixo(9, '2026-10-01'), 4.5);
    const sfp = T.tarifasDoItem('tiktok', 2000, {}, '2026-09-30').find(l => l.tipo === 'programa_frete');
    assert.equal(sfp.valor, 50);
    assert.equal(sfp.teto, 50);
    assert.equal(T.tarifasDoItem('tiktok', 2000, { qtd: 2 }, '2026-09-30').find(l => l.tipo === 'programa_frete').valor, 100, 'teto por produto');
    assert.deepEqual(T.simular('shopee', 30, { pessoa: 'cpf' }, '2026-09-30').avisos, ['tarifa de CNPJ']);
    assert.deepEqual(T.simular('shopee', 30, { pessoa: 'cnpj' }, '2026-09-30').avisos, []);
    assert.ok(T.simular('tiktok', 30, {}).avisos.indexOf('sem data da venda: usei a tarifa de hoje') >= 0);
    assert.equal(T.simular('tiktok', 39.9, {}, '2026-09-30').confianca, 'oficial');
    assert.equal(/1442971112769281/.test(T.PRAZO_REPASSE.tiktok.fonte.url), true);
    assert.equal(T.TABELA.some(l => l.fonte && l.fonte.confianca === 'secundaria'), false);
});

test('precoMinimo com o teto do SFP: acha o preço e confere no centavo', () => {
    const ctx = { custo: 700, imposto_pct: 6 };
    const p = T.precoMinimo('tiktok', ctx, 0, '2026-09-30');
    assert.ok(p > 800 && p < 1000, String(p));
    assert.ok(T.simular('tiktok', p, ctx, '2026-09-30').lucro >= 0);
    assert.ok(T.simular('tiktok', Math.round((p - 0.01) * 100) / 100, ctx, '2026-09-30').lucro < 0);
});

test('simular: comissão informada substitui a da tabela; afiliado entra sobre a mesma base', () => {
    const s = T.simular('tiktok', 569.9, { comissao_pct: 8, afiliado_pct: 12, custo: 250, imposto_pct: 6 }, '2026-09-30');
    const c = s.linhas.find(l => l.tipo === 'comissao');
    assert.equal(c.valor, 45.59);
    assert.equal(s.linhas.find(l => l.tipo === 'afiliado').valor, 68.39);
    assert.equal(s.tarifas_rs, 154.17);   // 45,59 + 6 + 34,19 (SFP) + 68,39
    assert.equal(s.repasse, 415.73);
    assert.equal(s.lucro, 131.54);          // 415,73 − 250 − 34,19
});

test('precoMinimo: o preço achado empata e 1 centavo abaixo dá prejuízo', () => {
    ['tiktok', 'shopee', 'ml'].forEach(canal => {
        const ctx = { custo: 40, outros: 2, imposto_pct: 6, frete: 20 };
        const p = T.precoMinimo(canal, ctx, 0, '2026-09-30');
        assert.ok(p > 0, canal);
        assert.ok(T.simular(canal, p, ctx, '2026-09-30').lucro >= 0, canal + ' empata em ' + p);
        const abaixo = T.simular(canal, Math.round((p - 0.01) * 100) / 100, ctx, '2026-09-30');
        assert.ok(abaixo.lucro < 0 || p <= 0.01, canal + ' 1 centavo abaixo');
    });
    assert.equal(T.precoMinimo('tiktok', { custo: 0 }, 0, '2026-09-30'), null);
});

test('prazo do repasse TikTok: entrega + 7 dias (ou o settlement_days da conta)', () => {
    assert.equal(T.dataPrevistaRepasse('tiktok', '2026-08-13'), '2026-08-20');
    assert.equal(T.dataPrevistaRepasse('tiktok', '2026-08-13', 31), '2026-09-13');
    assert.equal(T.dataPrevistaRepasse('ml', '2026-08-13'), null);
});

test('paridade com SHC.calcular do Copiloto (ML): recebe e sobra iguais em 300 cenários', { skip: !temExtensao && 'extension-copiloto/calc.js não encontrado' }, () => {
    const SHC = require(CALC);
    let n = 0;
    const precos = [5, 12.49, 12.5, 18.99, 19, 35, 48.99, 49, 60, 78.99, 79, 99.9, 150, 549.9, 1234.56];
    const itens = [
        { custo: 3 }, { custo: 20, outros: 1.5 }, { custo: 50, tipo: 'premium' }, { custo: 30, frete: 25 }, { custo: 30, frete: 25, full: true },
        { custo: 30, comissao_pct: 11.5 }, { custo: 100, tipo: 'premium', frete: 40 }, { custo: 8, full: true, frete: 12 }, {}, { custo: 60, frete: 0 },
    ];
    const cfgs = [{ imposto_pct: 0 }, { imposto_pct: 6 }];
    precos.forEach(p => itens.forEach(it => cfgs.forEach(cfg => {
        const a = SHC.calcular('ml', p, it, cfg);
        const b = T.simular('ml', p, { custo: it.custo, outros: it.outros, frete: it.frete, full: it.full, tipo_anuncio: it.tipo || 'classico', comissao_pct: it.comissao_pct, imposto_pct: cfg.imposto_pct }, '2026-09-30');
        assert.equal(b.repasse, a.recebe_rs, JSON.stringify({ p, it, cfg }));
        assert.equal(b.lucro, a.sobra_rs, JSON.stringify({ p, it, cfg }));
        assert.equal(b.frete_rs, a.frete_rs);
        n++;
    })));
    assert.equal(n, 300);
});

test('paridade com SHC.precoMinimo do Copiloto (ML)', { skip: !temExtensao && 'extension-copiloto/calc.js não encontrado' }, () => {
    const SHC = require(CALC);
    [{ custo: 20 }, { custo: 45, frete: 22 }, { custo: 45, frete: 22, full: true }, { custo: 3 }, { custo: 150, tipo: 'premium', frete: 35 }].forEach(it => [0, 10, 25].forEach(alvo => [0, 6].forEach(imp => {
        const a = SHC.precoMinimo('ml', it, { imposto_pct: imp }, alvo);
        const b = T.precoMinimo('ml', { custo: it.custo, frete: it.frete, full: it.full, tipo_anuncio: it.tipo || 'classico', imposto_pct: imp }, alvo, '2026-09-30');
        assert.equal(b, a, JSON.stringify({ it, alvo, imp }));
    })));
});
