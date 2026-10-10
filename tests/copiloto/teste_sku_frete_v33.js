// Teste v3.3 (SKU e frete por SKU), com dados inventados no formato do ML. Cada caso é um relato da dona:
//   30/09 "anúncio sem SKU" em anúncio que TEM SKU (Premium sem SKU ao lado do Clássico; variações; SKU só nas vendas/Editor),
//   30/09 HA-14253 com R$ 45,35 e R$ 58,75 e o Copiloto calado (mesmo SKU, mesma faixa de preço, frete diferente).
// Rodar:  node tests/copiloto/teste_sku_frete_v33.js
require('./relogio').fixar();
const path = require('path');
global.chrome = { storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } }, runtime: { sendMessage: async () => ({}) } };
const EXT = path.join(__dirname, '../../extension-copiloto');
const SHC = require(path.join(EXT, 'calc.js'));
['store.js', 'ml-extrator.js', 'painel-lateral.js'].forEach(a => require(path.join(EXT, a)));
let f = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) f++; };

// Linha da lista de Anúncios no formato do estado da página (/anuncios/lista).
const linha = (o) => ({
    metadata: Object.assign({ itemId: o.id, userProductId: o.up || '' }, o.md || {}),
    product: o.semProduto ? undefined : Object.assign({ title: o.titulo || 'Produto', sku: o.sku || '' }, o.expandable ? { expandable: o.expandable } : {}),
    price: { lines: [{ label: 'R$ ' + String(o.preco).replace('.', ',') }] },
    earnings: { lines: [{ label: 'R$ 100,00' }] },
    purchaseOptions: { lines: [{ label: o.tipo || 'Clássico' }, { label: 'Frete grátis' }, { label: 'A pagar R$ ' + String(o.frete).replace('.', ',') }] },
    innerRows: o.dentro,
});
const estado = rows => ({ appProps: { pageProps: { viewData: { rows } } } });

console.log('SKU: Premium do MESMO user product herda o SKU da Clássico (os anúncios do UP dividem o SKU no ML)');
{
    const its = SHC.mlAnunciosDoEstado(estado([linha({ id: 'MLB1000000001', up: 'MLBU77', sku: 'HA-14253', preco: 189.9, frete: 45.35,
        dentro: [linha({ id: 'MLB1000000002', up: 'MLBU77', preco: 199.9, frete: 45.35, tipo: 'Premium', semProduto: true })] })]));
    const p = its.find(i => i.itemId === 'MLB1000000002');
    ok(p && p.sku === 'HA-14253' && p.skuFonte === 'mesmo produto', 'linha de dentro sem SKU, mesmo MLBU → SKU HA-14253 (fonte "mesmo produto")');
    const outro = SHC.mlAnunciosDoEstado(estado([linha({ id: 'MLB1000000003', up: 'MLBU77', sku: 'HA-14253', preco: 189.9, frete: 45.35,
        dentro: [linha({ id: 'MLB1000000004', up: 'MLBU99', preco: 199.9, frete: 45.35, semProduto: true })] })])).find(i => i.itemId === 'MLB1000000004');
    ok(outro && outro.sku === '' && outro.skuForaDaLinha === true, 'linha de dentro de OUTRO user product não herda (fica "SKU ainda não lido")');
}

console.log('SKU: anúncio com variações — a linha fechada não mostra; vendas, Full e Editor completam');
{
    const fechado = SHC.mlAnunciosDoEstado(estado([linha({ id: 'MLB2000000001', preco: 59.9, frete: 0.01, md: { variationsQuantity: 3 } })]))[0];
    ok(fechado.sku === '' && fechado.variacoes === true && fechado.skuForaDaLinha === true, 'linha fechada com 3 variações: sem SKU, marcada skuForaDaLinha');
    const conhecidos = SHC.skusConhecidos({
        vbAnuncio: { itens: { MLB2000000001: { sku: 'cam-p', skus: ['CAM-M'] } } },
        editor: { porItem: { MLB2000000001: { sku: '', variacoes: [{ sku: 'CAM-G' }, { sku: 'cam-p' }] } } },
        full: { produtos: [{ sku: 'X-9', itemIds: ['MLB2000000009'] }] },
    });
    ok(JSON.stringify(conhecidos.MLB2000000001.skus) === JSON.stringify(['CAM-G', 'CAM-M', 'CAM-P']), 'vendas + Editor juntam os SKUs das variações, sem repetir e em ordem estável');
    ok(conhecidos.MLB2000000009 && conhecidos.MLB2000000009.skus[0] === 'X-9', 'Full: SKU do produto vai para cada MLB dele');
    const [c] = SHC.completaSkus([fechado], conhecidos, []);
    ok(c.sku === 'CAM-G' && c.skus.length === 3 && c !== fechado, 'completaSkus preenche o SKU do anúncio com variações');
    const simples = { itemId: 'MLB2000000005', sku: '', skuForaDaLinha: false };
    ok(SHC.completaSkus([simples], { MLB2000000005: { skus: ['VELHO'] } }, [])[0] === simples, 'anúncio simples que a lista mostra SEM SKU fica sem (o vendedor pode ter tirado)');
    const antes = [{ itemId: 'MLB2000000001', sku: 'CAM-P', skus: ['CAM-P'] }];
    const r = SHC.mesclaAnuncios({ itens: antes }, [fechado], {}, { antes: { itens: antes } });
    ok(r.itens[0].sku === 'CAM-P', 'nova leitura sem SKU não apaga o SKU já conhecido do mesmo anúncio');
}

console.log('Frete: mesmo SKU + mesma faixa de preço + frete diferente = alerta (HA-14253)');
{
    const a = (id, preco, frete, extra) => Object.assign({ itemId: id, sku: 'HA-14253', preco, frete, titulo: 'Cilindro HA', status: 'active', tipo: 'Clássico' }, extra || {});
    const itens = [a('MLB3000000001', 189.9, 45.35), a('MLB3000000002', 194.9, 45.35, { tipo: 'Premium' }), a('MLB3000000003', 189.9, 58.75)];
    const r = SHC.freteMesmoSku(itens, { vendas: { MLB3000000003: 10 } });
    ok(r.length === 1 && r[0].normal.frete === 45.35 && r[0].fogem.length === 1 && r[0].fogem[0].itemId === 'MLB3000000003', 'o de R$ 58,75 foge do normal (R$ 45,35, o mais comum)');
    ok(r[0].fogem[0].dif === 13.4 && r[0].custoMes === 134, 'diferença R$ 13,40 por envio × 10 vendas = R$ 134,00 por mês');
    ok(r[0].faixaTxt === 'R$ 150 a R$ 199,99', 'faixa de preço explicada: R$ 150 a R$ 199,99');
    ok(SHC.freteMesmoSku([itens[0], itens[1]]).length === 0, 'Clássico × Premium com o mesmo frete: sem alerta');
    ok(SHC.freteMesmoSku([itens[0], a('MLB3000000004', 189.9, 46.35)]).length === 0, 'diferença de R$ 1,00 (abaixo do mínimo): sem falso alarme');
    ok(SHC.freteMesmoSku([itens[0], a('MLB3000000005', 189.9, 58.75, { status: 'paused' })]).length === 0, 'anúncio pausado não entra');
    ok(SHC.freteMesmoSku([itens[0], a('MLB3000000006', 189.9, 58.75, { titulo: 'Kit 2 Cilindro HA' })]).length === 0, 'kit (2 unidades) só se compara com kit');
    ok(SHC.freteMesmoSku([itens[0], a('MLB3000000007', 189.9, 58.75, { freteDeduzido: true })]).length === 0, 'frete deduzido (não lido na lista) não acusa');
    const outra = SHC.freteOutraFaixa(itens[0], [itens[0], a('MLB3000000008', 210, 49.9)]);
    ok(outra.length === 1 && outra[0].frete === 49.9 && /a partir de R\$ 200/.test(outra[0].faixaTxt), 'preço em OUTRA faixa: não é erro, vai explicado no balão');
}

console.log('Cartão "Cobrado a mais": a conta fecha (contestar + conferir = total; linhas + resto = total)');
{
    const P = SHC.pl;
    let seed = 7, erradas = 0, barras = 0;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let t = 0; t < 2000; t++) {
        const pa = [];
        for (let i = 0, n = 1 + Math.floor(rnd() * 40); i < n; i++)
            pa.push({ itemId: 'MLB' + (4000000 + Math.floor(rnd() * 9)), pedido: String(i), diferenca: Math.round(rnd() * 3000) / 100, talvezUnidades: rnd() < 0.3 });
        const fc = P.freteCobrado({ vendas: 100, pagoAMais: pa }, '2026-10-07');
        const linhas = SHC.r2(fc.produtos.reduce((s, y) => s + y.tot, 0) + (fc.resto ? fc.resto.v : 0));
        if (linhas !== fc.total || SHC.r2(fc.contestar.v + fc.conferir.v) !== fc.total || fc.n !== pa.length) erradas++;
        if (fc.produtos.some(y => y.pctC + y.pctT > 100.05)) barras++;
    }
    ok(!erradas, '2.000 cenários: nenhum total que não fecha (pedido contado uma vez só)');
    ok(!barras, 'barra de cada anúncio nunca passa de 100% do total');
    const so = P.freteCobrado({ vendas: 3, pagoAMais: [{ itemId: 'MLB4000000001', pedido: '1', diferenca: 9.9, talvezUnidades: true }] }, '2026-10-07');
    ok(so.contestar.n === 0 && so.conferir.n === 1 && so.total === 9.9, 'só pedido "pode ser 2 unidades": vai inteiro para "Para conferir", nada para contestar');
}

console.log('Experiência de compra (formato oficial do ML, exemplos da documentação de 03/02/2026)');
{
    const item = SHC.mlExperienciaCompra({ item_id: 'MLB5000000001', reputation: { color: 'orange', text: 'Média', value: 50 }, status: { id: 'active' },
        metrics_details: { problems: [{ order: 0, key: 'PRODUCT', quantity: '1 problema', cancellations: 1, claims: 0, tag: 'PROBLEMA PRINCIPAL',
            level_two: { key: 'POOR_CONDITION', title: { text: 'Estavam em mau estado' } },
            level_three: { key: 'BROKEN_PRODUCT', title: { text: 'O produto chegou aberto e/ou danificado' }, remedy: { text: 'Revise o produto e a embalagem antes de enviar.' } } }],
            distribution: { from: '2026-04-04T19:08:56Z', to: '2026-10-04T19:08:56Z' } } });
    ok(item && item.nota === 50 && item.faixa === 'mediana' && item.status === 'active' && !item.pelaExperiencia, 'anúncio nota 50 laranja → mediana, ativo');
    ok(item.problemas[0].chave === 'BROKEN_PRODUCT' && item.problemas[0].principal && item.problemas[0].qtd === 1 && item.de === '2026-04-04', 'problema principal, contagem e período lidos');
    const up = (cor, nota, st, extra) => SHC.mlExperienciaCompra(Object.assign({ up_id: 'MLBU600000001', reputation: { color: cor, text: '', value: nota }, status: st ? { id: st } : undefined }, extra || {}));
    ok(up('red', 30, 'moderated').pelaExperiencia === true && up('red', 30, 'moderated').faixa === 'ruim', 'produto moderado com nota 30 → ruim, moderado pela experiência');
    ok(up('orange', 50, 'paused').pelaExperiencia === true, 'produto pausado com nota 50 → pausado pela experiência');
    ok(SHC.mlExperienciaCompra({ item_id: 'MLB5000000002', reputation: { color: 'orange', value: 60 }, status: { id: 'paused', assigned_by: 'other' } }).pelaExperiencia === false,
        'pausado por outro motivo (assigned_by other) não é culpa da experiência');
    const cong = up('orange', 50, 'active', { freeze: { text: 'Por enquanto esta publicação não perderá exposição. {0}Evite problemas.{1}', placeholders: ['', ''] } });
    ok(cong.congelado && !/\{\d\}/.test(cong.congeladoTxt), 'congelado pelo benefício: texto sem os {0} {1}');
    ok(up('gray', -1).faixa === 'sem' && up('gray', -1).nota === null, 'sem vendas para calcular (gray, -1) → sem nota, sem alerta');
    ok(up('green', 100, 'active').faixa === 'boa' && up('', 40).faixa === 'ruim' && up('', 74).faixa === 'mediana', 'sem cor: 75+ boa, 50–74 mediana, abaixo de 50 ruim');
    ok(SHC.mlExperienciaCompra({ item_id: 'xyz', reputation: {} }) === null && SHC.mlExperienciaCompra({ item_id: 'MLB5000000003' }) === null, 'formato desconhecido → null');

    const itens = [{ itemId: 'MLB5000000001', titulo: 'Cilindro HA 14253', estoque: 'Full: 40 un.', userProductId: 'MLBU600000009' },
        { itemId: 'MLB5000000004', titulo: 'Bomba d’água', userProductId: 'MLBU600000001' }];
    const al = SHC.experienciaAlertas({ porItem: { MLB5000000001: item }, porUp: { MLBU600000001: up('red', 30, 'moderated'), MLBU600000002: up('green', 100, 'active') } },
        { itens, antes: { porItem: { MLB5000000001: { nota: 75 } } } });
    ok(al.length === 2 && al[0].vermelho && /moderado pelo ML/.test(al[0].texto) && al[0].itemId === 'MLB5000000004', 'produto moderado vem primeiro, vermelho, no anúncio do UP');
    ok(/mediana \(nota 50\)/.test(al[1].texto) && /Caiu 25 pontos/.test(al[1].texto) && /Não mande mais unidades ao Full/.test(al[1].acao) && /chegou aberto/.test(al[1].acao),
        'mediana: queda de 25 pontos, aviso de Full empacando e o problema principal na ação');
    ok(!al.some(a => a.id === 'MLBU600000002'), 'nota boa sem queda: sem alerta');
    ok(/Fora das promoções/.test(SHC.experienciaAlertas({ porItem: { MLB5000000005: SHC.mlExperienciaCompra({ item_id: 'MLB5000000005', reputation: { color: 'red', value: 40 } }) } })[0].texto),
        'nota 40: avisa que sai das promoções (pede 50)');
}

console.log(f ? '\n' + f + ' FALHA(S)' : '\nTUDO OK');
process.exit(f ? 1 : 0);
