// B1 (3.3.1): ruptura que o sino não via. O número do ícone (SHC.alertasDe) e o cartão do Full do painel (P.planoFull + P.saudeFull) têm de
// apontar os MESMOS produtos. Antes o sino tinha a sua previsão (sem a sazonalidade) e só casava o produto pelos MLB do retrato do Full
// (não pelo SKU, como o painel); e o vm|ml guardava 13 meses, sem o mês base da sazonalidade no começo do mês.
//   a) paridade painel × sino num Full inventado (sazonal, produto achado só pelo SKU, variações, parado, saudável, sem estoque, acaba hoje);
//   b) "Acaba hoje" no lugar de "0 dias" (sino e painel);
//   c) o vm|ml guarda 14 meses (07/10 precisa de 2025-09).
// Só dados inventados. Rodar: node tests/copiloto/teste_ruptura_sino_b1.js
'use strict';
require('./relogio').fixar();
const path = require('path');
const mem = {};
global.chrome = { storage: { local: {
    get: async k => { const o = {}; (k === null || k === undefined ? Object.keys(mem) : [].concat(k)).forEach(x => { if (x in mem) o[x] = JSON.parse(JSON.stringify(mem[x])); }); return o; },
    set: async o => { Object.assign(mem, JSON.parse(JSON.stringify(o))); }, remove: async k => { [].concat(k).forEach(x => delete mem[x]); } } }, runtime: { sendMessage: async () => ({}) } };
const EXT = path.join(__dirname, '../../extension-copiloto');
const SHC = require(path.join(EXT, 'calc.js'));
['store.js', 'ml-extrator.js', 'painel-lateral.js'].forEach(a => require(path.join(EXT, a)));
const P = SHC.pl;
let f = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) f++; };
const HOJE = '2026-10-07';   // mês alvo (hoje + 15) um ano antes = 2025-10; mês base (hoje − 15) um ano antes = 2025-09

// Full inventado (ids e SKUs fictícios).
const full = { produtos: [
    // A: sazonal. 20 vendas em 30 dias, 10 aptas. Ano passado set/10 → out/25 (2,5×): previsão 50 → 6 dias. Sem a sazonalidade: 25 → 12 dias.
    { produtoId: 'P900001', itemId: 'MLB9000000001', sku: 'SKU-A', titulo: 'Produto A', aptas: 10, vendas30: 20 },
    // B: o retrato do Full não traz o MLB; o anúncio é achado pelo SKU. Ano passado out/40 → 6 dias. Sem casar pelo SKU: 10 → 24 dias.
    { produtoId: 'P900002', sku: 'SKU-B', titulo: 'Produto B', aptas: 8, vendas30: 10 },
    // C e D: variações do mesmo anúncio (mesmo MLB). C tem 3/4 das vendas → 3/4 do ano passado.
    { produtoId: 'P900003', variacao: 'Azul', itemId: 'MLB9000000003', sku: 'SKU-C', titulo: 'Produto C', aptas: 5, vendas30: 9 },
    { produtoId: 'P900003', variacao: 'Verde', itemId: 'MLB9000000003', sku: 'SKU-D', titulo: 'Produto C', aptas: 30, vendas30: 3 },
    // E: parado (estoque e nenhuma venda): nunca alerta de ruptura.
    { produtoId: 'P900005', itemId: 'MLB9000000005', sku: 'SKU-E', titulo: 'Produto E', aptas: 40, vendas30: 0 },
    // F: saudável.
    { produtoId: 'P900006', itemId: 'MLB9000000006', sku: 'SKU-F', titulo: 'Produto F', aptas: 200, vendas30: 30 },
    // G: sem estoque e com venda: alerta nos dois.
    { produtoId: 'P900007', itemId: 'MLB9000000007', sku: 'SKU-G', titulo: 'Produto G', aptas: 0, vendas30: 6 },
    // H: o ML diz que acaba hoje (0 dias).
    { produtoId: 'P900008', itemId: 'MLB9000000008', sku: 'SKU-H', titulo: 'Produto H', aptas: 1, vendas30: 40, diasAteEsgotar: 0 },
] };
const itens = [
    { itemId: 'MLB9000000001', sku: 'SKU-A', titulo: 'Produto A' }, { itemId: 'MLB9000000002', sku: 'SKU-B', titulo: 'Produto B' },
    { itemId: 'MLB9000000003', sku: 'SKU-C', titulo: 'Produto C' }, { itemId: 'MLB9000000005', sku: 'SKU-E', titulo: 'Produto E' },
    { itemId: 'MLB9000000006', sku: 'SKU-F', titulo: 'Produto F' }, { itemId: 'MLB9000000007', sku: 'SKU-G', titulo: 'Produto G' },
    { itemId: 'MLB9000000008', sku: 'SKU-H', titulo: 'Produto H' },
];
const vm = {
    MLB9000000001: { '2025-09': 10, '2025-10': 25 },
    MLB9000000002: { '2025-10': 40 },
    MLB9000000003: { '2025-10': 48 },
    MLB9000000005: { '2025-10': 30 },
    MLB9000000006: { '2025-10': 20 },
};
const lidos = ['2025-09', '2025-10'];

// Painel: a mesma montagem do planoBase() do painel-lateral.js.
function doPainel() {
    const idsDe = p => [...new Set(P.anunciosDoFull(p, itens).map(it => it.itemId).concat(P.idsDoFull(p)))];
    const pl = P.planoFull(full, { hoje: HOJE, dias: 30, idsDe, mesesLidos: lidos, vmDe: p => { const ids = idsDe(p); return ids.length ? P.somaMeses(ids.map(id => vm[id])) : null; }, lucroDe: () => null });
    pl.linhas.forEach(l => { l.saude = P.saudeFull(l.p, l.prev.qtd, null, null); });
    return pl.linhas;
}
const chaveDe = p => 'full|' + (p.itemId || p.produtoId) + '|' + (p.variacao || '');

console.log('a) paridade painel × sino');
{
    const linhas = doPainel(), sino = SHC.alertasDe({ full, itens: [], anuncios: itens, vm, mesesLidos: lidos, hoje: HOJE });
    const doPainelSet = new Set(linhas.filter(l => l.saude.alerta).map(l => chaveDe(l.p))), doSino = new Set(sino.lista.filter(a => a.tipo === 'full').map(a => a.chave));
    const so = (a, b) => [...a].filter(x => !b.has(x));
    ok(so(doPainelSet, doSino).length === 0 && so(doSino, doPainelSet).length === 0,
        'os mesmos produtos em alerta no painel e no sino (' + [...doPainelSet].sort().join(', ') + ')' + (so(doPainelSet, doSino).length ? ' · só no painel: ' + so(doPainelSet, doSino).join(', ') : '') + (so(doSino, doPainelSet).length ? ' · só no sino: ' + so(doSino, doPainelSet).join(', ') : ''));
    const lin = id => linhas.find(l => (l.p.produtoId + '|' + (l.p.variacao || '')) === id), al = k => sino.lista.find(a => a.chave === k);
    ok(lin('P900001|').prev.fonte === 'sazonal' && al('full|MLB9000000001|') && al('full|MLB9000000001|').dias === 6, 'A sazonal: previsão 50, acaba em 6 dias, no sino também (antes: 12 dias, fora do sino)');
    ok(lin('P900002|').prev.qtd === 40 && al('full|P900002|') && al('full|P900002|').dias === 6, 'B achado pelo SKU: ano passado 40, acaba em 6 dias, no sino também (antes: 24 dias)');
    ok(lin('P900003|Azul').prev.qtd === 36 && !!al('full|MLB9000000003|Azul') && !al('full|MLB9000000003|Verde'), 'variações: Azul fica com 3/4 do ano passado (36) e alerta; Verde (30 aptas) não');
    ok(!al('full|MLB9000000005|') && lin('P900005|').saude.classe === 'parado', 'E parado: sem alerta de ruptura nos dois');
    ok(!al('full|MLB9000000006|') && !!al('full|MLB9000000007|'), 'F saudável fora; G sem estoque e com venda dentro');
    ok(SHC.alertasDe({ full, itens: [], vm, mesesLidos: lidos, hoje: HOJE }).lista.every(a => a.chave !== 'full|P900002|'), 'sem a lista de anúncios o sino não acha o B (por isso o fundo agora passa "anuncios")');
}

console.log('b) "Acaba hoje" no lugar de "0 dias"');
{
    const sino = SHC.alertasDe({ full, itens: [], anuncios: itens, vm, mesesLidos: lidos, hoje: HOJE }), h = sino.lista.find(a => a.chave === 'full|MLB9000000008|');
    ok(h && h.dias === 0 && h.texto === 'Acaba no Full hoje.', 'sino: "Acaba no Full hoje." (era "Acaba no Full em 0 dias.")');
    const l = doPainel().find(x => x.p.produtoId === 'P900008');
    ok(/^Acaba hoje\./.test(P.acaoFull(l)) && !/0 dias/.test(P.acaoFull(l)), 'painel: "Acaba hoje." (era "Acaba em 0 dias.")');
    const a = sino.lista.find(x => x.chave === 'full|MLB9000000001|');
    ok(a && a.texto === 'Acaba no Full em 6 dias.', 'com dias > 0 o texto não muda');
}

console.log('c) o vm|ml guarda 14 meses');
(async () => {
    const meses = []; for (let k = 13; k >= 0; k--) meses.push(new Date(Date.UTC(2026, 9 - k, 1)).toISOString().slice(0, 7));   // 2025-09 … 2026-10
    await SHC.registraVendasMes({ MLB9000000001: Object.fromEntries(meses.map((m, i) => [m, i + 1])) });
    const g = (await SHC.lerVendasMes(['MLB9000000001'])).MLB9000000001 || {};
    ok(Object.keys(g).length === 14 && g['2025-09'] === 1, '14 meses guardados, com 2025-09 (o mês base da sazonalidade em 07/10)');
    await SHC.registraVendasMes({ MLB9000000001: { '2026-11': 9 } });
    const g2 = (await SHC.lerVendasMes(['MLB9000000001'])).MLB9000000001 || {};
    ok(Object.keys(g2).length === 14 && !('2025-09' in g2) && g2['2026-11'] === 9, 'o 15º mês tira o mais velho');
    console.log(f ? '\n' + f + ' falha(s)' : '\nTUDO OK');
    process.exit(f ? 1 : 0);
})();
