// B2 parte 3 (3.3.1): no sino (SHC.anomalias), o produto ativo e com estoque no ERP cujo anúncio está "Sem estoque no ML"
// (erpx:<conta>, SHC.erpCruzar → parado com temNoErp) vira 1 item por SKU, com o estoque lido no ERP. Antes só a tela do ERP mostrava.
//   a) 1 item por SKU parado com estoque no ERP, com o número do ERP e o link do anúncio;
//   b) parado sem estoque no ERP, ou pausado pelo seller, não entra;
//   c) o SKU que o aviso do Full ou o "Repor" já mostram não entra de novo;
//   d) trava da conferência fechada (aguardando) = nada; sem erpx = nada.
// Só dados inventados. Rodar: node tests/copiloto/teste_erp_parado_sino_b2p3.js
'use strict';
require('./relogio').fixar();
const path = require('path');
global.chrome = { storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } }, runtime: { sendMessage: async () => ({}) } };
const EXT = path.join(__dirname, '../../extension-copiloto');
const SHC = require(path.join(EXT, 'calc.js'));
['store.js', 'ml-extrator.js', 'erp-cruzar.js'].forEach(a => require(path.join(EXT, a)));
let f = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) f++; };

// ERP inventado ("Bling"); SKUs e MLB fictícios. Anúncios lidos inteiros (trava aberta).
const erp = [
    { sku: 'CAN-01', nome: 'Caneca Azul', situacao: 'A', estoque: 40 },    // anúncio sem estoque no ML → entra
    { sku: 'CAN-02', nome: 'Caneca Verde', situacao: 'A', estoque: 0 },    // sem estoque no ERP também → não entra
    { sku: 'CAN-03', nome: 'Caneca Rosa', situacao: 'A', estoque: 12 },    // pausado pelo seller → não entra
    { sku: 'CAN-04', nome: 'Caneca Lilás', situacao: 'A', estoque: 7 },    // sem estoque no ML, mas o aviso do Full já fala dele
    { sku: 'CAN-05', nome: 'Caneca Cinza', situacao: 'A', estoque: 3 },    // sem estoque no ML, mas já está no "Repor"
    { sku: 'CAN-06', nome: 'Caneca Preta', situacao: 'A', estoque: 9 },    // à venda → não é parado
];
const sem = () => ({ id: 'out_of_stock' });
const anuncios = [
    { itemId: 'MLB9300000001', sku: 'CAN-01', titulo: 'Caneca Azul', status: 'paused', restricao: sem(), estoque: 0 },
    { itemId: 'MLB9300000002', sku: 'CAN-02', titulo: 'Caneca Verde', status: 'paused', restricao: sem(), estoque: 0 },
    { itemId: 'MLB9300000003', sku: 'CAN-03', titulo: 'Caneca Rosa', status: 'paused', restricao: { id: 'paused' }, estoque: 5 },
    { itemId: 'MLB9300000004', sku: 'CAN-04', titulo: 'Caneca Lilás', status: 'paused', restricao: sem(), estoque: 0 },
    { itemId: 'MLB9300000005', sku: 'CAN-05', titulo: 'Caneca Cinza', status: 'paused', restricao: sem(), estoque: 0 },
    { itemId: 'MLB9300000006', sku: 'CAN-06', titulo: 'Caneca Preta', status: 'active', estoque: 9 },
];
const leitura = { completo: true, mlbTotal: 6, mlbLidos: 6 };
const r = SHC.erpCruzar({ erp, anuncios, variacoes: {}, fullSkus: [], leitura });
ok(r.aguardando === null && r.parado.filter(p => p.temNoErp).map(p => p.sku).sort().join() === 'CAN-01,CAN-04,CAN-05', 'cruzamento inventado: 3 parados com estoque no ERP e sem estoque no ML');
const erpx = { ts: Date.now(), erp: 'bling', nome: 'Bling', r };

const alertas = { lista: [{ tipo: 'full', nivel: 'critico', chave: 'full|MLB9300000004|', itemId: 'MLB9300000004', sku: 'CAN-04', titulo: 'Caneca Lilás', texto: 'Sem estoque no Full.', aptas: 0 }] };
const familias = { total: 1, repor: [{ familia: 'Cozinha', sku: 'CAN-05', titulo: 'Caneca Cinza', itemId: 'MLB9300000005', motivo: 'Vende e está sem estoque.', cobertura: 0 }], textoSemRepor: '' };
const an = SHC.anomalias('123456789', { alertas, familias, erpx }, {});
const it = an.itens.filter(i => /^anom\|erpParado\|/.test(i.chave));
ok(it.length === 1 && it[0].sku === 'CAN-01', 'a) 1 item só, do CAN-01 (' + it.map(i => i.sku).join() + ')');
ok(it[0] && it[0].texto === 'Sem estoque no ML e com 40 unidades no Bling: Caneca Azul (SKU CAN-01). Atualize o estoque do anúncio no ML.', 'a) o texto traz o estoque lido no ERP: ' + (it[0] && it[0].texto));
ok(it[0] && it[0].estoqueErp === 40 && it[0].itemId === 'MLB9300000001' && /itemId=MLB9300000001$/.test(it[0].link || ''), 'a) estoque do ERP, anúncio e link do anúncio no item');
ok(it[0] && it[0].aba === 'geral' && SHC.anomalias('123456789', { alertas, familias }, {}).total + 1 === an.total, 'a) conta 1 a mais no número do ícone (aba Geral)');
ok(!an.itens.some(i => /CAN-0[236]/.test(i.texto) && /^anom\|erpParado/.test(i.chave)), 'b) sem estoque no ERP, pausado pelo seller ou à venda: fora');
ok(an.itens.filter(i => /CAN-04|Lilás/.test(i.texto)).length === 1 && an.itens.filter(i => /CAN-05/.test(i.texto)).length === 1, 'c) Full e Repor não repetem o mesmo SKU');

const travado = SHC.erpCruzar({ erp, anuncios, variacoes: {}, fullSkus: [], leitura: { completo: false, mlbTotal: 9, mlbLidos: 6 } });
ok(!SHC.anomalias('123456789', { erpx: { nome: 'Bling', r: travado } }, {}).itens.some(i => /erpParado/.test(i.chave)), 'd) anúncios ainda não lidos inteiros: nada (nunca avisa errado)');
ok(!SHC.anomalias('123456789', { erpx: { nome: 'Bling', r: Object.assign({}, r, { aguardando: { parado: 3 } }) } }, {}).itens.some(i => /erpParado/.test(i.chave)), 'd) aguardando com a lista cheia: nada');
ok(SHC.anomalias('123456789', {}, {}).total === 0, 'd) sem erpx: nada');

console.log(f ? '\n' + f + ' FALHA(S)' : '\nTUDO OK');
process.exit(f ? 1 : 0);
