// Etiqueta de ganho nas listas da Shopee, do TikTok e da Magalu (N-B, N-C, N-D; pedido da dona 07/10/2026): extension-copiloto/etiqueta-canal.js.
//   a) Shopee: a etiqueta é a MESMA conta do SHC.calcular('sp') (sem escolha em Ajustes = a tabela oficial do núcleo; com escolha = a dela);
//   b) sem custo → "Informe o custo"; com custo pelo SKU do produto ou da variação; imposto e meta da empresa entram;
//   c) a lista real (anonimizada) da Shopee, retrato M2: todo produto vira etiqueta, sem NaN;
//   d) Magalu: "não lido" sem a comissão; com cfg.mg_comissao_pct, a conta sai com o aviso.
// Só dados inventados. Rodar: node tests/copiloto/teste_etiqueta_canais.js
'use strict';
require('./relogio').fixar();
const path = require('path'), fs = require('fs');
global.chrome = { storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } }, runtime: { id: 'copiloto-teste' } };
const RAIZ = path.join(__dirname, '../..'), EXT = path.join(RAIZ, 'extension-copiloto');
const SHC = require(path.join(EXT, 'calc.js'));
require(path.join(EXT, 'store.js'));
const NU = f => require(path.join(EXT, 'nucleo', f));
global.CopilotoNucleo = { util: NU('util.js'), modelo: NU('modelo.js'), tarifas: NU('tarifas.js'), etiqueta: NU('etiqueta.js'), adaptador: NU('adaptador.js'),
    adaptadores: { shopee: NU('adaptadores/shopee.js'), magalu: NU('adaptadores/magalu.js') } };
require(path.join(EXT, 'etiqueta-canal.js'));
const SP = global.CopilotoNucleo.adaptadores.shopee, HOJE = SHC.hoje();   // o dia do relógio dos testes: o SHC.calcular usa a tabela de hoje
let f = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) f++; };

console.log('a) Shopee: a etiqueta = SHC.calcular("sp")');
{
    let difs = 0, n = 0;
    for (let c = 100; c <= 120000; c += 137) {   // R$ 1,00 a R$ 1.200,00, passando pelas faixas da tabela (R$ 9, R$ 80, R$ 100, R$ 200)
        const preco = c / 100, custo = Math.round(preco * 37) / 100;
        const r = SHC.calcular('sp', preco, { custo }, { imposto_pct: 4 });
        const [e] = SHC.etqDosProdutos('shopee', [{ produto_id: '1', sku: 'A', preco }], { [SHC.chaveSku('A')]: { custo } }, { imposto_pct: 4 }, HOJE);
        const simulado = global.CopilotoNucleo.etiqueta.daVariacao('shopee', preco, { custo, imposto_pct: 4 }, HOJE);
        n++;
        if (!(e && r && e.texto === simulado.texto && Math.abs(r.sobra_rs - simulado.sobra) < 1e-9)) { difs++; if (difs < 4) console.log('    ', preco, r && r.sobra_rs, simulado.sobra, e && e.texto); }
    }
    ok(difs === 0, n + ' preços: a etiqueta, o SHC.calcular("sp") e o tarifas.simular do núcleo dão a mesma sobra, ao centavo');
    const escolhido = { sp_comissao_pct: 18, sp_taxa_fixa: 3 };
    const [e] = SHC.etqDosProdutos('shopee', [{ produto_id: '1', sku: 'A', preco: 100 }], { [SHC.chaveSku('A')]: { custo: 50 } }, escolhido, HOJE);
    ok(e.texto === 'Sobra R$ 29,00 · margem 29%', 'comissão escolhida em Ajustes (18% + R$ 3) manda, como no resto do Copiloto: R$ 100 − 21 − 50 = R$ 29 (' + e.texto + ')');
}

console.log('b) custo, imposto e meta');
{
    const ps = [{ produto_id: '1', sku: 'KIT', preco: 500, variacoes: [{ modelo_id: '11', sku: '', preco: 500 }, { modelo_id: '12', sku: 'KIT-AZ', preco: 200 }] }];
    const [sem] = SHC.etqDosProdutos('shopee', ps, {}, {}, HOJE);
    ok(sem.classe === 'sem_custo' && sem.texto === 'Informe o custo', 'sem custo: "Informe o custo", nunca lucro inventado');
    const custos = { [SHC.chaveSku('KIT')]: { custo: 300 }, [SHC.chaveSku('KIT-AZ')]: { custo: 100 } };
    const [com] = SHC.etqDosProdutos('shopee', ps, custos, {}, HOJE);
    ok(com.texto === 'Sobra de R$ 46,00 a R$ 104,00 · margem 23% a 20,8%' && com.skus.join(',') === 'KIT,KIT-AZ',
        'variação sem SKU usa o custo do produto; a outra o dela: a faixa das duas (' + com.texto + ')');
    const [meta] = SHC.etqDosProdutos('shopee', ps, custos, { margem_alvo_pct: 22 }, HOJE);
    ok(meta.classe === 'apertado', 'meta de 22%: uma variação abaixo da meta deixa o produto "apertado" (' + meta.classe + ')');
    ok(SHC.etqChaves(ps).sort().join(',') === [SHC.chaveSku('KIT'), SHC.chaveSku('KIT-AZ')].sort().join(','), 'as chaves lidas do storage são as dos SKUs da lista (nada mais)');
}

console.log('c) a lista real da Shopee (retrato M2, anonimizado)');
{
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'shopee_produtos_2026-10-07.json'), 'utf8'));
    const ps = SP.produtosDaLista(j.respostas.find(x => /get_product_list$/.test(x.url)).corpo);
    const custos = {};
    ps.forEach((p, i) => { if (i % 2 === 0 && p.sku) custos[SHC.chaveSku(p.sku)] = { custo: Math.round(p.preco * 40) / 100 }; });
    const es = SHC.etqDosProdutos('shopee', ps, custos, { imposto_pct: 6 }, HOJE);
    ok(es.length === ps.length && es.length >= 10, es.length + ' produtos, uma etiqueta cada');
    ok(es.every(e => !/NaN|undefined|null/.test(e.texto + e.detalhe)), 'nenhum texto com NaN, undefined ou null');
    ok(es.filter(e => e.classe === 'sem_custo').length > 0 && es.filter(e => /^Sobra|^Prejuízo|^De prejuízo/.test(e.texto)).length > 0,
        'metade com custo (sobra/prejuízo) e metade sem ("Informe o custo")');
}

console.log('d) Magalu');
{
    const [nl] = SHC.etqDosProdutos('magalu', [{ produto_id: '1', sku: 'M', preco: 100 }], { [SHC.chaveSku('M')]: { custo: 50 } }, {}, HOJE);
    ok(nl.classe === 'nao_lido' && /não lida/.test(nl.texto), 'sem a comissão da Magalu: "não lido" (' + nl.texto + ')');
    const [mg] = SHC.etqDosProdutos('magalu', [{ produto_id: '1', sku: 'M', preco: 100 }], { [SHC.chaveSku('M')]: { custo: 50 } }, { mg_comissao_pct: 9.9 }, HOJE);
    ok(mg.texto === 'Sobra R$ 40,10 · margem 40,1%', 'com 9,9% informado em Ajustes: R$ 100 − 9,90 − 50 = R$ 40,10 (' + mg.texto + ')');
}

console.log('d2) TikTok (N-B): a lista de Gerenciar produtos e o custo da aba do TikTok');
{
    const ps = SHC.etqDoTikTok([{ produto_id: '1', total_skus: 1, skus: [{ sku_id: '101', sku: 'CAM-P', preco: 79.9 }] }, { produto_id: '2', total_skus: 1, skus: [{ sku_id: '102', sku: 'BON-1', preco: 39.9 }] }]);
    ok(ps[0].sku === 'CAM-P' && ps[0].variacoes[0].modelo_id === '101' && ps[0].nome === '', 'o produto do TikTok vem com o SKU e o id da variação (o TikTok não manda o nome)');
    ok(SHC.etqChaves(ps, 'tiktok').indexOf('c|tiktok|102') >= 0 && SHC.etqChaves(ps, 'shopee').indexOf('c|tiktok|102') < 0, 'no TikTok também se lê o custo da aba do TikTok (c|tiktok|<sku_id>)');
    // CAM-P R$ 79,90: 6% + R$ 6 + SFP 6% = R$ 15,58; custo R$ 30 pelo SKU; 4% de imposto R$ 3,20 → R$ 31,12.
    // BON-1 R$ 39,90: 10% + R$ 4 + SFP 6% = R$ 10,38; custo R$ 15 digitado na aba do TikTok (manda sobre o do SKU, R$ 99); imposto R$ 1,60 → R$ 12,92.
    const custos = { [SHC.chaveSku('CAM-P')]: { custo: 30 }, [SHC.chaveSku('BON-1')]: { custo: 99 }, 'c|tiktok|102': { custo: 15 } };
    const es = SHC.etqDosProdutos('tiktok', ps, custos, { imposto_pct: 4 }, HOJE);
    ok(es[0].texto === 'Sobra R$ 31,12 · margem 38,9%' && es[1].texto === 'Sobra R$ 12,92 · margem 32,4%', 'as contas do TikTok batem com a tabela oficial (' + es.map(e => e.texto).join(' | ') + ')');
    const lig = SHC.etqDosProdutos('tiktok', ps, { [SHC.chaveSku('KIT-X')]: { custo: 15 }, 'c|tiktok|102': { sku: 'KIT-X' } }, { imposto_pct: 4 }, HOJE);
    ok(lig[1].texto === 'Sobra R$ 12,92 · margem 32,4%' && lig[0].texto === 'Informe o custo', 'variação "ligada ao SKU" na aba do TikTok usa o custo desse SKU; sem nada, "Informe o custo"');
}

console.log('e) o leitor da página da Shopee (shopee-pagina.js) e o "achar o produto na linha" (etiqueta-tela.js)');
{
    const vm = require('vm');
    const roda = (arq, w) => { vm.runInNewContext(fs.readFileSync(path.join(EXT, arq), 'utf8'), { window: w, URL, Symbol, JSON, Object, Array, String, Math }); return w; };
    const ws = roda('shopee-pagina.js', { location: { href: 'https://seller.shopee.com.br/portal/product/list/all', origin: 'https://seller.shopee.com.br' }, addEventListener() {}, postMessage() {} });
    const sp = ws[Symbol.for('copiloto.shopee')];
    ok(sp && sp.eDaRota('/api/v3/opt/mpsku/list/v2/get_product_list?page_number=1', 'GET') && !sp.eDaRota('/api/v3/opt/mpsku/list/v2/get_product_list', 'POST')
        && !sp.eDaRota('/api/v3/order/get_order_list_card_list', 'GET') && !sp.eDaRota('https://outro.site/api/v3/opt/mpsku/list/v2/get_product_list', 'GET'),
        'só a lista de Meus Produtos (GET, mesma origem) é lida; pedidos, outras rotas e outros sites não');
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'shopee_produtos_2026-10-07.json'), 'utf8')).respostas.find(x => /get_product_list$/.test(x.url)).corpo;
    const sujo = JSON.parse(JSON.stringify(j));
    sujo.data.products[0].buyer = { name: 'Fulana', phone: '(44) 99912-0000' };
    sujo.data.products[0].statistics.liked_count = 999;
    const c = sp.corta(sujo), p0 = c.data.products[0];
    ok(c.data.products.length === j.data.products.length && !('buyer' in p0) && Object.keys(p0.statistics).join() === 'view_count' && !('cover_image' in p0) && !('promotion' in p0),
        'da resposta só saem os campos da etiqueta e as visualizações (nada de comprador, curtidas, vendidos, imagem ou campanha)');
    ok(JSON.stringify(SP.produtosDaLista(c)) === JSON.stringify(SP.produtosDaLista(j)), 'o recorte dá a mesma lista que a resposta inteira (a etiqueta não perde nada)');
    const wt = roda('etiqueta-tela.js', { document: {} }), casa = wt.__copilotoEtq._casa;
    const it = { nome: 'Kit Panela 5 Peças', sku: 'PAN-05', skus: ['PAN-05'] };
    ok(casa('Kit Panela 5 Peças', it) === 'nome' && casa('  kit panela 5 pecas ', it) === 'nome' && casa('SKU principal: PAN-05', it) === 'sku' && casa('PAN-05', it) === 'sku'
        && casa('PAN-050', it) === '' && casa('Kit Panela 5 Peças Azul', it) === '' && casa('R$ 609', it) === '',
        'o produto é achado pelo nome inteiro (sem acento e caixa) ou pelo SKU sozinho; texto parecido não casa');
}

console.log('f) visitas e frete com variação (pedido da dona 08/10)');
{
    let h = {};
    [['2026-09-24', 100], ['2026-10-01', 130], ['2026-10-08', 145]].forEach(([d, n]) => { h = SHC.etqHistGrava(h, 'P1', 'vis', d, n); });
    const v = SHC.etqVisitasAcumuladas(h.P1.vis, '2026-10-08');
    ok(v.texto === 'visitas 7 dias: 15 (-50%)' && v.classe === 'cai', 'Shopee: 145 − 130 = 15 nesta semana × 30 na anterior → "visitas 7 dias: 15 (-50%)" em vermelho (' + v.texto + ')');
    const so1 = SHC.etqVisitasAcumuladas(SHC.etqHistGrava({}, 'P', 'vis', '2026-10-08', 36).P.vis, '2026-10-08');
    ok(so1.texto === 'visitas: 36 no total' && /7 dias depois de 08\/10/.test(so1.titulo), 'sem 7 dias de histórico: o total e desde quando compara (nunca um "7 dias" inventado)');
    const velho = SHC.etqHistGrava({ P: { vis: { '2026-09-01': 1 } } }, 'P', 'vis', '2026-10-08', 2);
    ok(!('2026-09-01' in velho.P.vis) && velho.P.vis['2026-10-08'] === 2, 'o histórico guarda só 15 dias');
    ok(SHC.etqVisitasProntas(12, -62).texto === 'visitas 7 dias: 12 (-62%)' && SHC.etqVisitasProntas(4, 311).classe === 'sobe' && SHC.etqVisitasProntas(null, 5) === null,
        'Magalu: as visitas de 7 dias e a variação que o canal já dá');
    let f2 = {};
    [['2026-10-01', 15.06], ['2026-10-08', 16.26]].forEach(([d, n]) => { f2 = SHC.etqHistGrava(f2, 'S', 'frete', d, n); });
    const fr = SHC.etqFreteVariacao(f2.S.frete, '2026-10-08');
    ok(fr.texto === 'frete R$ 16,26 (subiu R$ 1,20 desde 01/10)' && fr.classe === 'cai', 'frete médio subiu R$ 1,20 em 7 dias → vermelho, como o selo do ML (' + fr.texto + ')');
    ok(SHC.etqFreteVariacao({ '2026-10-08': 16.26 }, '2026-10-08').texto === 'frete médio R$ 16,26', 'frete sem histórico: só o valor de hoje');
}

console.log('g) Magalu (N-D): os retratos M3, a comissão do contrato e o leitor da página');
{
    const MG = global.CopilotoNucleo.adaptadores.magalu, L = n => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'));
    const ps = MG.produtosDaLista(L('magalu_produtos_2026-10-07.json').respostas.find(r => /portfolios\/products$/.test(r.url)).corpo);
    ok(ps.length === 10 && ps[0].sku === 'SKU-1' && ps[0].preco === 29.72 && ps[0].frete_medio === 16.26 && ps[0].estoque === 659,
        'lista de produtos: preço em centavos na API → R$ 29,72; frete médio R$ 16,26; estoque 659');
    const fin = L('magalu_financeiro_2026-10-07.json').respostas[0].corpo, com = MG.comissaoDoFinanceiro(fin);
    ok(com.pct === 12 && com.todas_iguais && com.antecipacao === false, 'comissão do contrato: 12% em todas as categorias, sem antecipação (com antecipação seria 15,89%)');
    const fin2 = JSON.parse(JSON.stringify(fin)); fin2.transfer_data.auto_anticipate = true;
    ok(MG.comissaoDoFinanceiro(fin2).pct === 15.89, 'com a antecipação automática ligada, vale 15,89% ("15,89" com vírgula)');
    const fin3 = JSON.parse(JSON.stringify(fin)); fin3.agreements[0].fees_type[0].fees[0].value = '16';
    ok(MG.comissaoDoFinanceiro(fin3).pct === null && MG.comissaoDoFinanceiro(fin3).todas_iguais === false, 'categorias com % diferentes: sem um % só (a etiqueta fica "não lida", nunca suposta)');
    const custos = { [SHC.chaveSku('SKU-1')]: { custo: 10 } };
    const [e] = SHC.etqDosProdutos('magalu', ps.slice(0, 1), custos, { imposto_pct: 4, mg_comissao_pct: com.pct }, HOJE);
    // R$ 29,72 − 12% (3,57) − custo 10 − 4% (1,19) = R$ 14,96
    ok(e.rotulo === 'R$ 29,72 · custo R$ 10,00 · Sobra R$ 14,96 · margem 50,3%', 'etiqueta da Magalu com a comissão do contrato (' + e.rotulo + ')');
    const vm = require('vm'), w = { location: { href: 'https://seller.magalu.com/produtos', origin: 'https://seller.magalu.com' }, addEventListener() {}, postMessage() {} };
    vm.runInNewContext(fs.readFileSync(path.join(EXT, 'magalu-pagina.js'), 'utf8'), { window: w, URL, Symbol, JSON, Object, Array, String, Math });
    const mp = w[Symbol.for('copiloto.magalu')];
    ok(mp.rotaDe('https://api-product-search.magalu.com/seller/v1/portfolios/products?_limit=10', 'GET').tipo === 'produtos'
        && mp.rotaDe('https://api-product.magalu.com/api/v1/product-metrics?sku=SKU-1&id=1', 'GET').sku === 'SKU-1'
        && mp.rotaDe('https://magalu-sellers.magalu.com/ps-financial/api/v1/seller/financial-infos', 'GET').tipo === 'comissao'
        && !mp.rotaDe('https://magalu-sellers.magalu.com/ps-core-order/api/v0/packages', 'GET') && !mp.rotaDe('https://api-product-search.magalu.com/seller/v1/portfolios/products', 'POST')
        && !mp.rotaDe('https://outro.com/seller/v1/portfolios/products', 'GET'), 'só as 3 consultas (produtos, visitas, comissão) por GET; pedidos e outros sites não');
    const cortado = mp.CORTA.comissao(fin), txt = JSON.stringify(cortado);
    ok(!/bank|account|agency|org/.test(txt) && MG.comissaoDoFinanceiro(cortado).pct === 12, 'do Financeiro sai só a comissão e o modo de repasse (nada do banco nem da empresa)');
    const cp = mp.CORTA.produtos(L('magalu_produtos_2026-10-07.json').respostas.find(r => /portfolios\/products$/.test(r.url)).corpo);
    ok(!/images|brand|ncm|dimension|extra_data/.test(JSON.stringify(cp)) && JSON.stringify(MG.produtosDaLista(cp)) === JSON.stringify(ps), 'da lista sai só o que a etiqueta usa, e dá a mesma lista');
}

console.log('h) frete assumido zero, dito no balão (leitura da local 08/10)');
{
    const sp = SHC.etqDosProdutos('shopee', [{ produto_id: '1', sku: 'A', preco: 100 }], {}, {}, HOJE)[0], tt = SHC.etqDosProdutos('tiktok', [{ produto_id: '1', sku: 'A', preco: 100 }], {}, {}, HOJE)[0];
    const mg = SHC.etqDosProdutos('magalu', [{ produto_id: '1', sku: 'A', preco: 100 }], {}, {}, HOJE)[0];
    ok(/Frete assumido R\$ 0/.test(sp.detalhe) && /Programa de Frete/.test(tt.detalhe) && !/Frete assumido/.test(mg.detalhe), 'Shopee e TikTok dizem "frete assumido R$ 0" (com o motivo); a Magalu não (lá o frete depende do peso)');
}

console.log(f ? '\n' + f + ' FALHA(S)' : '\nTUDO OK');
process.exit(f ? 1 : 0);
