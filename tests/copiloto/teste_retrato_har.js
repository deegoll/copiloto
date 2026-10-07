// deploy/retrato-har.js (M2/M3): o HAR do Chrome vira retrato sem dado de cliente nem do vendedor, com a estrutura intacta.
// HAR inventado no formato da Shopee (lista de produtos + pedido com comprador). Só dados inventados.
// Rodar: node tests/copiloto/teste_retrato_har.js
'use strict';
const path = require('path');
const { criaAnonimo, doHar } = require(path.join(__dirname, '../../deploy/retrato-har.js'));
let falhas = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) falhas++; };

const produtos = { code: 0, data: { page_info: { total: 2, page: 1 }, list: [
    { id: 22334455667, name: 'Kit Panela Antiaderente Marca Real 5 Peças', parent_sku: 'PAN-REAL-05', status: 'NORMAL', price_info: { normal_price: '189.90', promotion_price: '159.90' }, stock_detail: { total_available_stock: 42 }, create_time: 1759000000 },
    { id: 22334455668, name: 'Jogo de Facas Inox Marca Real', parent_sku: 'FAC-REAL-06', status: 'UNLIST', price_info: { normal_price: '99.00', promotion_price: '99.00' }, stock_detail: { total_available_stock: 0 }, create_time: 1759100000 }] } };
const pedido = { order_sn: '2510077ABCDEF', buyer_user: { user_name: 'maria.silva77', email: 'maria@gmail.com', phone: '(44) 99912-1785' },
    recipient_address: { name: 'Maria da Silva', full_address: 'Rua das Flores, 123, Maringá', zipcode: '87010-120' },
    item_list: [{ item_id: 22334455667, item_name: 'Kit Panela Antiaderente Marca Real 5 Peças', model_sku: 'PAN-REAL-05', quantity: 2, item_price: 159.9 }],
    order_status: 'READY_TO_SHIP', note: 'cpf 529.982.247-25, ligar antes', total_amount: 319.8, commission_fee: 44.77 };
const ent = (url, corpo, b64) => ({ request: { method: 'GET', url }, response: { status: 200, content: { mimeType: 'application/json', text: b64 ? Buffer.from(JSON.stringify(corpo)).toString('base64') : JSON.stringify(corpo), encoding: b64 ? 'base64' : undefined } } });
const har = { log: { entries: [
    ent('https://seller.shopee.com.br/api/v3/product/list?page=1&shop_id=998877665&SPC_CDS=abc', produtos),
    ent('https://seller.shopee.com.br/api/v3/order/get_one_order?order_sn=2510077ABCDEF', pedido, true),
    { request: { method: 'GET', url: 'https://seller.shopee.com.br/logo.png' }, response: { status: 200, content: { mimeType: 'image/png', text: 'xx' } } }] } };

const an = criaAnonimo(1.25), out = doHar(har, '', an), txt = JSON.stringify(out);
console.log('a) o que sai');
ok(out.length === 2, 'só as respostas JSON (a imagem fica fora): ' + out.length);
ok(out[0].url === 'https://seller.shopee.com.br/api/v3/product/list' && out[0].parametros.join(',') === 'page,shop_id,SPC_CDS', 'URL sem a query (só os nomes dos parâmetros)');
ok(doHar(har, 'order', criaAnonimo(1)).length === 1, 'o filtro de URL escolhe as respostas');

console.log('b) nada real sobra');
['maria', 'Maria', 'gmail', '99912', '87010', 'Flores', 'Maringá', '529.982.247-25', 'Marca Real', 'PAN-REAL', 'FAC-REAL', '22334455667', '998877665', '2510077ABCDEF', '189.9', '159.9', '319.8', 'abc']
    .forEach(s => ok(txt.indexOf(s) < 0, '"' + s + '" não aparece'));

console.log('c) a estrutura fica');
const p0 = out[0].corpo.data.list[0], o = out[1].corpo;
const chaves = v => (v && typeof v === 'object' ? Object.keys(v).sort().map(k => k + '{' + chaves(v[k]) + '}').join(',') : typeof v);
ok(chaves(out[0].corpo) === chaves(produtos) && chaves(o) === chaves(pedido), 'mesmas chaves e tipos em todos os níveis');
ok(p0.status === 'NORMAL' && o.order_status === 'READY_TO_SHIP' && p0.create_time === 1759000000, 'estados e datas ficam');
ok(p0.id === o.item_list[0].item_id && p0.id !== produtos.data.list[0].id, 'o mesmo id real vira o mesmo id inventado na lista e no pedido');
ok(p0.name === o.item_list[0].item_name && /^Produto \d+$/.test(p0.name) && p0.parent_sku === o.item_list[0].model_sku && /^SKU-\d+$/.test(p0.parent_sku), 'título e SKU: "Produto N" e "SKU-N", iguais onde eram iguais');
ok(p0.price_info.normal_price === '237.38' && o.item_list[0].quantity === 3 && o.total_amount === 399.75, 'valores × fator (1,25 aqui): 189,90 → 237,38; em texto continua texto');
ok(o.buyer_user.user_name === '***' && o.buyer_user.email === '***' && o.recipient_address.zipcode === '***' && o.recipient_address.name === '***', 'comprador e endereço: "***"');
ok(!/529|cpf 5/.test(o.note) || o.note.indexOf('***') >= 0, 'CPF no meio de um texto some');

console.log('d) HTML de linhas da lista');
const h = criaAnonimo(2).html('<tr data-item-id="22334455667"><td class="t">Kit Panela Antiaderente Marca Real 5 Peças</td><td class="p">R$ 189,90</td><td>Estoque 42</td><td>maria@gmail.com</td></tr>');
ok(h.indexOf('Marca Real') < 0 && h.indexOf('22334455667') < 0 && h.indexOf('maria@') < 0 && /class="p"/.test(h) && /R\$ 379,80/.test(h) && /data-item-id="9\d+"/.test(h) && /Estoque 84/.test(h),
    'título, id e e-mail somem; classes e rótulos ficam; números × fator: ' + h);

console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nTUDO OK');
process.exit(falhas ? 1 : 0);
