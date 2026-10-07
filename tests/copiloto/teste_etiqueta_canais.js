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
    adaptadores: { shopee: NU('adaptadores/shopee.js') } };
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

console.log(f ? '\n' + f + ' FALHA(S)' : '\nTUDO OK');
process.exit(f ? 1 : 0);
