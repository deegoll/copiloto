// B2 (3.3.1): ruptura do estoque próprio. O SKU que zerou as vendas do mês porque acabou o estoque sumia do "Precisa de você"
// (SHC.familiasAcoes só olhava os SKUs com venda no mês) e o SHC.recomendaSku dizia "Manter: sem estoque e sem venda".
//   a) vendeu no mês anterior, zerou neste e está sem estoque → "Repor" (com o que está a caminho do Full, se houver);
//   b) zerou com estoque, ou sem venda nos dois meses → fica como antes (não vira "Repor").
// Só dados inventados. Rodar: node tests/copiloto/teste_ruptura_estoque_b2.js
'use strict';
require('./relogio').fixar();
const path = require('path');
global.chrome = { storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } }, runtime: { sendMessage: async () => ({}) } };
const EXT = path.join(__dirname, '../../extension-copiloto');
const SHC = require(path.join(EXT, 'calc.js'));
['store.js', 'ml-extrator.js'].forEach(a => require(path.join(EXT, a)));
let f = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) f++; };

// Família inventada "Casa"; ids e SKUs fictícios. Setembro e agosto lidos inteiros.
const L = (bruto, unidades, sku) => ({ bruto, unidades, sku });
const va = { meses: {
    '2026-09': { completo: true, porAnuncio: { MLB9100000003: L(200, 4, 'CASA-C'), MLB9100000005: L(0, 0, 'CASA-E') } },
    '2026-08': { completo: true, porAnuncio: { MLB9100000001: L(500, 10, 'CASA-A'), MLB9100000002: L(250, 5, 'CASA-B'), MLB9100000003: L(150, 3, 'CASA-C'),
        MLB9100000004: L(90, 3, 'CASA-D') } },
}, itens: {} };
const cat = { porItem: {} };
['1', '2', '3', '4', '5'].forEach(n => { cat.porItem['MLB910000000' + n] = { familia: 'Casa' }; });
const retrato = { itens: [
    { itemId: 'MLB9100000001', sku: 'CASA-A', titulo: 'Produto A', preco: 50, estoque: 0 },    // A: zerou e sem estoque → repor (novo)
    { itemId: 'MLB9100000002', sku: 'CASA-B', titulo: 'Produto B', preco: 50, estoque: 7 },    // B: zerou com estoque → fora, como antes
    { itemId: 'MLB9100000003', sku: 'CASA-C', titulo: 'Produto C', preco: 50, estoque: 0 },    // C: vende e sem estoque → repor (já era)
    { itemId: 'MLB9100000004', sku: 'CASA-D', titulo: 'Produto D', preco: 30, estoque: 0 },    // D: zerou, está no Full com 6 a caminho
    { itemId: 'MLB9100000005', sku: 'CASA-E', titulo: 'Produto E', preco: 30, estoque: 0 },    // E: sem venda nos 2 meses → fora
] };
const full = { produtos: [{ produtoId: 'P910004', itemId: 'MLB9100000004', sku: 'CASA-D', titulo: 'Produto D', aptas: 0, aCaminho: 6 }] };

console.log('a) SHC.familiasAcoes: o SKU que zerou sem estoque entra em "repor"');
const fams = SHC.familias(va, cat, retrato, {}, '2026-09', { hoje: '2026-10-07' });
ok(fams.lido && fams.length === 1 && fams[0].familia === 'Casa', 'família inventada lida (setembro × agosto)');
const ac = SHC.familiasAcoes(fams, retrato.itens, full, { hoje: '2026-10-07' }), rep = ac.repor.map(x => x.sku).sort();
ok(JSON.stringify(rep) === '["CASA-A","CASA-C","CASA-D"]', 'repor = A (zerou sem estoque), C (vende sem estoque) e D (zerou, nada apto no Full) — ' + JSON.stringify(rep));
const a = ac.repor.find(x => x.sku === 'CASA-A') || {}, d = ac.repor.find(x => x.sku === 'CASA-D') || {};
ok(a.motivo === 'Sem estoque e sem venda neste mês; no mês anterior vendeu 10 unidades.', 'motivo de A — ' + a.motivo);
ok(d.motivo === 'Sem estoque e sem venda neste mês; no mês anterior vendeu 3 unidades (6 unidades a caminho do Full).', 'motivo de D com o que está a caminho — ' + d.motivo);
ok(!['repor', 'full', 'baixar', 'liquidar'].some(k => ac[k].some(x => x.sku === 'CASA-B')), 'B (zerou com 7 em estoque) não entra em nenhuma ação, como antes');
ok(!['repor', 'full', 'baixar', 'liquidar'].some(k => ac[k].some(x => x.sku === 'CASA-E')), 'E (sem venda nos 2 meses e sem estoque) não entra');
ok(ac.total === 3 && /^3 SKUs para repor$/.test(ac.texto), 'resumo do sino: "3 SKUs para repor" — ' + ac.texto);

console.log('b) SHC.recomendaSku: só vira "Repor" com venda no mês anterior e estoque lido em zero');
const est0 = { lido: true, total: 0, proprio: 0, full: null, aCaminho: 0 };
ok(SHC.recomendaSku({ unidades: 0, unidadesAnt: 4, variacaoPct: -100 }, est0, 30).acao === 'repor', 'vendeu 4 antes, 0 agora, estoque 0 → repor');
ok(SHC.recomendaSku({ unidades: 0, unidadesAnt: null, variacaoPct: null }, est0, 30).acao === 'manter', 'mês anterior não lido → manter (não supõe ruptura)');
ok(SHC.recomendaSku({ unidades: 0, unidadesAnt: 0, variacaoPct: null }, est0, 30).acao === 'manter', 'sem venda nos 2 meses → manter');
ok(SHC.recomendaSku({ unidades: null, unidadesAnt: 4, variacaoPct: null }, est0, 30).acao === 'manter', 'unidades do mês não lidas → manter');
ok(SHC.recomendaSku({ unidades: 0, unidadesAnt: 4, variacaoPct: -100 }, { lido: false }, 30).acao === 'sem_dado', 'estoque não lido → sem dado (nunca 0 inventado)');
ok(SHC.recomendaSku({ unidades: 0, unidadesAnt: 4, variacaoPct: -100 }, { lido: true, total: 5, proprio: 5, full: null, aCaminho: 0 }, 30).acao === 'baixar', 'zerou com 5 em estoque → baixar, como antes');

console.log(f ? '\n' + f + ' FALHA(S)' : '\nTUDO OK');
process.exit(f ? 1 : 0);
