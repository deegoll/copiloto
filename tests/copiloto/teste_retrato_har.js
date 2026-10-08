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
    recipient_address: { name: 'Maria da Silva', full_address: 'Rua das Flores, 123, Maringá', zipcode: '87010-120', state: 'Paraná' },
    seller_address: { name: 'Loja Real', state: 'Paraná', city: 'Maringá' },
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
['maria', 'Maria', 'gmail', '99912', '87010', 'Flores', 'Maringá', 'Paraná', 'Loja Real', '529.982.247-25', 'Marca Real', 'PAN-REAL', 'FAC-REAL', '22334455667', '998877665', '2510077ABCDEF', '189.9', '159.9', '319.8', 'abc']
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

console.log('e) o que escapou no retrato M3 da Magalu (08/10)');
{
    const an2 = criaAnonimo(1), o = an2.json({
        custom_fields: [{ key: 'customer_name', value: 'Fulana de Tal' }, { name: 'cpf', value: '529.982.247-25' }, { key: 'canal', value: 'site' }],
        bank_account: { bank_code: '341', bank_agency: '1234', account: '56789-0', holder: 'Loja Real Ltda' },
        org: { name: 'Loja Real', cnpj: '11.222.333/0001-81' }, org_id: 'loja-real-123', financial_email: 'financeiro@lojareal.com.br',
        images: [{ url: 'https://a-static.mlcdn.com.br/280x210/kit-panela/lojareal/123/abc.jpg' }], link: 'https://www.magazineluiza.com.br/kit-panela/p/abc123/',
        api: 'https://api-product.magalu.com/api/v1/product-metrics?sku=X' });
    const t = JSON.stringify(o);
    ok(o.custom_fields[0].value === '***' && o.custom_fields[1].value === '***' && o.custom_fields[2].value === 'site', 'pares {key, value}: nome e CPF do cliente viram "***"; o par que não é pessoal fica');
    ok(o.bank_account.bank_code === '***' && o.bank_account.holder === '***' && o.org.name === '***' && o.org_id === '***' && !/Loja Real|56789|lojareal/.test(t.replace(/exemplo\.invalid/g, '')),
        'banco, empresa, org_id e e-mail financeiro: só a estrutura');
    ok(o.images[0].url === 'https://exemplo.invalid/imagem.jpg' && o.link === 'https://exemplo.invalid/pagina' && o.api === 'https://api-product.magalu.com/api/v1/product-metrics',
        'imagem e página do produto do vendedor viram exemplo.invalid; a URL da API do canal fica (sem a query)');
}

console.log('f) o que escapou nos retratos de pedidos (Shopee/TikTok/Magalu, 08/10)');
{
    const an3 = criaAnonimo(2), o = an3.json({
        identifiers: [{ name: 'customer_name', values: ['Fulana de Tal'] }, { key: 'customer_document', display_value: '529.982.247-25' }, { name: 'delivery_type', values: ['conventional'] }],
        creator_info_name: 'Influencer Real', creator: { handle: '@influ.real', unique_id: 'influ.real' }, warehouse_name: 'Depósito Loja Real Maringá',
        payout: undefined, bank_name: 'Banco Real', account_number: '56789-0', agency: '1234', card_last4: '4321',
        price_module: { format_price: 'R$ 1.234,56', format_total: 'R$ 99,90', sale_price: '189.90', discount_text: '-12,5%' },
        pix_discount: 4.07, field_name: 'PIX_DISCOUNT', display_name: 'Taxa de comissão líquida' });
    const t = JSON.stringify(o);
    ok(o.identifiers[0].values[0] === '***' && o.identifiers[1].display_value === '***' && o.identifiers[2].values[0] === 'conventional', 'par {name, values} e {key, display_value}: o valor pessoal some; o par comum fica');
    ok(o.creator_info_name === '***' && o.creator.handle === '***' && o.creator.unique_id === '***' && o.warehouse_name === '***', 'criador/afiliado (@ e nome) e depósito: "***"');
    ok(o.bank_name === '***' && o.account_number === '***' && o.agency === '***' && o.card_last4 === '***', 'banco, conta, agência e cartão fora de um bloco "bank": "***"');
    ok(o.price_module.format_price === 'R$ 2469,12' && o.price_module.format_total === 'R$ 199,80' && o.price_module.sale_price === '379.8' && o.price_module.discount_text === '-25,0%',
        'valores já formatados passam pelo fator (2 aqui): ' + JSON.stringify(o.price_module));
    ok(!/Influencer|influ\.real|Loja Real|Banco Real|56789|1234,56|4321|Fulana|529\.982/.test(t), 'nenhum texto real sobra');
    ok(o.pix_discount === 8.14 && o.field_name === 'PIX_DISCOUNT' && o.display_name === 'Taxa de comissão líquida', 'linhas da renda (Pix, rótulos) ficam: o código precisa delas');
    ok(an3.json({ seller: { nota: '@loja.real' } }).seller.nota === '@***', '@ solto em qualquer campo vira "@***"');
}

console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nTUDO OK');
process.exit(falhas ? 1 : 0);
