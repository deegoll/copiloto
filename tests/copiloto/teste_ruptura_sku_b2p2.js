// B2 parte 2 (3.3.1): no sino (SHC.anomalias), cada SKU para repor do faturamento por família vira 1 item, com os dias de cobertura.
// Antes era 1 item só ("Faturamento por família: 3 SKUs para repor") e o seller não via qual SKU nem quantos dias o estoque aguenta.
//   a) 1 item por SKU para repor, com o motivo do SHC.recomendaSku ("dá para N dias") e o campo dias;
//   b) o SKU que o aviso do Full já mostra (mesmo SKU ou anúncio) não entra de novo;
//   c) o resumo fica só com o resto (Full, baixar preço, parados) e conta só o resto;
//   d) sem nada para repor, o resumo é o de antes.
// Só dados inventados. Rodar: node tests/copiloto/teste_ruptura_sku_b2p2.js
'use strict';
require('./relogio').fixar();
const path = require('path');
global.chrome = { storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } }, runtime: { sendMessage: async () => ({}) } };
const EXT = path.join(__dirname, '../../extension-copiloto');
const SHC = require(path.join(EXT, 'calc.js'));
['store.js', 'ml-extrator.js'].forEach(a => require(path.join(EXT, a)));
let f = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) f++; };

// Família inventada "Jardim"; ids e SKUs fictícios. Setembro lido até o dia 30, agosto inteiro.
const L = (bruto, unidades, sku) => ({ bruto, unidades, sku });
const va = { meses: {
    '2026-09': { completo: true, porAnuncio: { MLB9200000001: L(600, 30, 'JAR-A'), MLB9200000002: L(400, 20, 'JAR-B'), MLB9200000003: L(300, 15, 'JAR-C'),
        MLB9200000004: L(100, 2, 'JAR-D') } },
    '2026-08': { completo: true, porAnuncio: { MLB9200000001: L(600, 30, 'JAR-A'), MLB9200000002: L(400, 20, 'JAR-B'), MLB9200000003: L(300, 15, 'JAR-C'),
        MLB9200000004: L(500, 10, 'JAR-D'), MLB9200000005: L(250, 5, 'JAR-E') } },
}, itens: {} };
const cat = { porItem: {} };
['1', '2', '3', '4', '5'].forEach(n => { cat.porItem['MLB920000000' + n] = { familia: 'Jardim' }; });
const retrato = { itens: [
    { itemId: 'MLB9200000001', sku: 'JAR-A', titulo: 'Regador A', preco: 20, estoque: 5 },     // vende 1/dia, 5 em estoque → repor (5 dias)
    { itemId: 'MLB9200000002', sku: 'JAR-B', titulo: 'Vaso B', preco: 20, estoque: 0 },        // vende e sem estoque → repor (0 dia)
    { itemId: 'MLB9200000003', sku: 'JAR-C', titulo: 'Pá C', preco: 20, estoque: 0 },          // repor, mas já está no aviso do Full
    { itemId: 'MLB9200000004', sku: 'JAR-D', titulo: 'Tesoura D', preco: 50, estoque: 300 },   // caiu muito com estoque alto → baixar preço
    { itemId: 'MLB9200000005', sku: 'JAR-E', titulo: 'Luva E', preco: 50, estoque: 0 },        // zerou sem estoque (B2 parte 1) → repor
] };
const fams = SHC.familias(va, cat, retrato, {}, '2026-09', { hoje: '2026-10-07' });
const ac = SHC.familiasAcoes(fams, retrato.itens, null, { hoje: '2026-10-07' });
ok(JSON.stringify(ac.repor.map(x => x.sku).sort()) === '["JAR-A","JAR-B","JAR-C","JAR-E"]' && ac.baixar.length === 1, 'família inventada: 4 para repor e 1 para baixar preço');

// O aviso do Full (SHC.alertasDe) já fala do JAR-C.
const alertas = { lista: [{ tipo: 'full', nivel: 'critico', chave: 'full|MLB9200000003|', itemId: 'MLB9200000003', sku: 'JAR-C', titulo: 'Pá C', texto: 'Sem estoque no Full.', aptas: 0 }] };
const an = SHC.anomalias('9200', { alertas, familias: ac }, {});
const rep = an.itens.filter(i => /^anom\|repor\|/.test(i.chave || ''));

console.log('a) 1 item por SKU para repor, com os dias de cobertura');
ok(rep.length === 3, '3 itens de repor (A, B e E; o C está no aviso do Full) — ' + rep.length);
const a = rep.find(i => i.sku === 'JAR-A') || {}, b = rep.find(i => i.sku === 'JAR-B') || {}, e = rep.find(i => i.sku === 'JAR-E') || {};
ok(a.dias === 5 && /dá para 5 dias/.test(a.texto) && /^Repor Regador A \(SKU JAR-A\): /.test(a.texto), 'A: 5 dias de cobertura — ' + a.texto);
ok(b.dias === 0 && /^Repor Vaso B \(SKU JAR-B\): Sem estoque e vende/.test(b.texto), 'B: sem estoque, 0 dia — ' + b.texto);
ok(e.dias === null && /no mês anterior vendeu 5 unidades/.test(e.texto), 'E: zerou sem estoque, sem cobertura inventada — ' + e.texto);
ok(rep.every(i => i.tipo === 'familia' && i.aba === 'geral'), 'tipo família, na aba Geral, como o resumo');
ok(a.itemId === 'MLB9200000001' && a.chave === 'anom|repor|JAR-A', 'chave por SKU e o anúncio do SKU');

console.log('b) o que o aviso do Full já mostra não entra de novo');
ok(!rep.some(i => i.sku === 'JAR-C'), 'JAR-C fica só no aviso do Full');
ok(an.itens.filter(i => i.tipo === 'estoque').length === 1, 'o aviso do Full continua (1 item)');

console.log('c) o resumo fica com o resto e conta só o resto');
const res = an.itens.find(i => i.chave === 'anom|familia') || {};
ok(res.texto === 'Faturamento por família: 1 para baixar preço.', 'resumo sem os SKUs para repor — ' + res.texto);
ok(an.porTipo.familia === 4, 'família = 3 itens de repor + 1 resumo — ' + an.porTipo.familia);

console.log('d) sem nada para repor, o resumo é o de antes');
const so = { repor: [], full: [], baixar: [{ sku: 'JAR-D' }], liquidar: [], sazonal: [], total: 1, texto: '1 para baixar preço', textoSemRepor: '1 para baixar preço' };
const an2 = SHC.anomalias('9200', { familias: so }, {});
ok(an2.itens.length === 1 && an2.itens[0].chave === 'anom|familia' && an2.itens[0].texto === 'Faturamento por família: 1 para baixar preço.', 'só o resumo');
const soRep = SHC.familiasAcoes(fams, retrato.itens.filter(i => i.sku !== 'JAR-D'), null, {});
const an3 = SHC.anomalias('9200', { familias: Object.assign({}, soRep, { baixar: [], total: soRep.repor.length, textoSemRepor: '' }) }, {});
ok(!an3.itens.some(i => i.chave === 'anom|familia') && an3.itens.length === 4, 'só repor (sem o resto): sem resumo vazio, 4 itens');

console.log(f ? '\n' + f + ' FALHA(S)' : '\nTUDO OK');
process.exit(f ? 1 : 0);
