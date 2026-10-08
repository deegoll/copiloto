// B3 (3.3.1): no sino (SHC.anomalias), o anúncio ATIVO que perdeu a Buy Box do catálogo (competicao 'perdendo' ou 'restrito', o selo do ML
// na lista de Anúncios) vira 1 item do tipo 'catalogo', aba Catálogo. Vermelho quando o anúncio tem estoque apto no Full (ml:full).
//   a) 1 item por anúncio perdendo ou restrito, com o motivo (preço / forma de entrega);
//   b) ganhando, dividindo, 'competindo' (texto antigo, sem selo), pausado e sem competição não entram; o mesmo MLB 2× conta 1;
//   c) vermelho só com aptas > 0 no Full do mesmo MLB, e o texto diz quantas;
//   d) módulo Catálogo desligado: não conta; o título do ícone diz "de catálogo".
// Só dados inventados. Rodar: node tests/copiloto/teste_buybox_sino_b3.js
'use strict';
require('./relogio').fixar();
const path = require('path');
global.chrome = { storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } }, runtime: { sendMessage: async () => ({}) } };
const EXT = path.join(__dirname, '../../extension-copiloto');
const SHC = require(path.join(EXT, 'calc.js'));
['store.js', 'ml-extrator.js'].forEach(a => require(path.join(EXT, a)));
let f = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) f++; };

// Anúncios inventados (MLB fictícios).
const itens = [
    { itemId: 'MLB9400000001', titulo: 'Garrafa Azul', status: 'active', competicao: 'perdendo', competicaoMotivo: 'preco' },
    { itemId: 'MLB9400000002', titulo: 'Garrafa Verde', status: 'active', competicao: 'restrito', competicaoMotivo: 'entrega' },
    { itemId: 'MLB9400000003', titulo: 'Garrafa Rosa', status: 'active', competicao: 'ganhando' },
    { itemId: 'MLB9400000004', titulo: 'Garrafa Lilás', status: 'active', competicao: 'dividindo' },
    { itemId: 'MLB9400000005', titulo: 'Garrafa Cinza', status: 'active', competicao: 'competindo' },
    { itemId: 'MLB9400000006', titulo: 'Garrafa Preta', status: 'paused', competicao: 'perdendo', competicaoMotivo: 'preco' },
    { itemId: 'MLB9400000007', titulo: 'Garrafa Branca', status: 'active' },
    { itemId: 'MLB9400000001', titulo: 'Garrafa Azul (variação)', status: 'active', competicao: 'perdendo', competicaoMotivo: 'preco' },
    { itemId: 'MLB9400000008', titulo: 'Garrafa Laranja', status: 'active', competicao: 'perdendo', competicaoMotivo: 'outro' },
];
const full = { produtos: [
    { itemId: 'MLB9400000001', sku: 'GAR-01', aptas: 12 },
    { itemIds: ['MLB9400000001'], sku: 'GAR-01B', aptas: 3 },
    { itemId: 'MLB9400000002', sku: 'GAR-02', aptas: 0 },
    { itemId: 'MLB9400000003', sku: 'GAR-03', aptas: 50 },
] };
const an = SHC.anomalias('123456789', { itens, full }, {});
const cat = an.itens.filter(i => i.tipo === 'catalogo');
const de = id => cat.find(i => i.itemId === id);
ok(cat.length === 3 && cat.every(i => i.aba === 'catalogo'), 'a) 3 itens na aba Catálogo (' + cat.map(i => i.itemId).join() + ')');
ok(de('MLB9400000001') && de('MLB9400000001').texto === 'Garrafa Azul: perdendo a Buy Box do catálogo por preço. Sem ela o anúncio quase não vende. Você tem 15 unidades aptas no Full.',
    'a/c) perdendo por preço, com as aptas do Full somadas: ' + (de('MLB9400000001') || {}).texto);
ok(de('MLB9400000002') && de('MLB9400000002').texto === 'Garrafa Verde: fora da disputa do catálogo pela forma de entrega. Sem ela o anúncio quase não vende.',
    'a) restrito pela entrega: ' + (de('MLB9400000002') || {}).texto);
ok(de('MLB9400000008') && de('MLB9400000008').texto === 'Garrafa Laranja: perdendo a Buy Box do catálogo. Sem ela o anúncio quase não vende.', 'a) motivo desconhecido: sem inventar o porquê');
ok(!['MLB9400000003', 'MLB9400000004', 'MLB9400000005', 'MLB9400000006', 'MLB9400000007'].some(de), 'b) ganhando, dividindo, competindo, pausado e sem competição: fora');
ok(cat.filter(i => i.itemId === 'MLB9400000001').length === 1, 'b) o mesmo MLB 2× = 1 item');
ok(de('MLB9400000001').vermelho === true && de('MLB9400000002').vermelho === false && de('MLB9400000008').vermelho === false, 'c) vermelho só com estoque apto no Full');
ok(an.vermelho === true && SHC.anomalias('123456789', { itens, full: { produtos: [] } }, {}).vermelho === false, 'c) o ícone fica vermelho por causa do Full, e só por ele');
ok(an.porTipo.catalogo === 3 && an.total === 3, 'd) conta 3 no número do ícone');
ok(SHC.anomalias('123456789', { itens, full }, { modulos: { catalogo: false } }).total === 0, 'd) módulo Catálogo desligado: nada');
ok(/3 de catálogo/.test(SHC.anomaliasTitulo(an)), 'd) título do ícone: ' + SHC.anomaliasTitulo(an));
ok(SHC.anomalias('123456789', {}, {}).total === 0, 'sem anúncios lidos: nada');

console.log(f ? '\n' + f + ' FALHA(S)' : '\nTUDO OK');
process.exit(f ? 1 : 0);
