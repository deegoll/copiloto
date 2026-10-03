// Teste 3.2.1 "blindada" (auditoria de segurança de 01/10/2026): cada correção da extensão tem aqui um teste que falha sem ela.
// Planilha ERP × ML sem fórmula, links do ML só para o ML/Mercado Pago, remetente conferido no fundo, Agenda do Canal fora do
// alcance das páginas do ML, dados da aba com teto e faixa, certificado vencido da remessa, avisos de "só leitura" nas telas do ERP.
// Rodar:  node tests/copiloto/teste_seguranca_321.js
require('./relogio').fixar();
const fs = require('fs'), path = require('path');
global.chrome = { storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } }, runtime: { sendMessage: async () => ({}) } };
const EXT = path.join(__dirname, '../../extension-copiloto');
const SHC = require(path.join(EXT, 'calc.js'));
['store.js', 'ml-extrator.js', 'erp-cruzar.js'].forEach(a => require(path.join(EXT, a)));
const montaFundo = require('./fundo_falso.js'), { B } = montaFundo;
const le = a => fs.readFileSync(path.join(EXT, a), 'utf8');
let f = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) f++; };

(async () => {
    console.log('Planilha ERP × ML (SHC.erpxCSV): célula que começa com = + - @ não vira fórmula');
    const r = SHC.erpCruzar({ erp: [{ sku: '=1+1', nome: '@SOMA(A1)', situacao: 'A', estoque: 1 }, { sku: 'X-2', nome: '-5', situacao: 'A', estoque: 1 }], anuncios: [], leitura: { completo: true } });
    const csv = SHC.erpxCSV({ nome: 'Bling', r });
    ok(/;'=1\+1;'@SOMA\(A1\);/.test(csv) && /;X-2;'-5;/.test(csv), "sku '=1+1' → '=1+1, nome '@SOMA(A1)' → '@SOMA(A1), nome '-5' → '-5 (o mesmo apóstrofo do paraCSV)");
    ok(csv.split('\r\n')[0] === '﻿grupo;sku;produto;anuncio;detalhe' && !/'X-2/.test(csv), 'cabeçalho e texto comum não mudam');
    // Revisão de 02/10: TAB e CR antes do = (o Excel ignora e lê a fórmula) também saem com apóstrofo.
    const r2 = SHC.erpCruzar({ erp: [{ sku: 'T-1', nome: '\t=1+1', situacao: 'A', estoque: 1 }, { sku: 'T-2', nome: '\r=2+2', situacao: 'A', estoque: 1 }], anuncios: [], leitura: { completo: true } });
    const csv2 = SHC.erpxCSV({ nome: 'Bling', r: r2 });
    ok(csv2.indexOf(";'\t=1+1;") >= 0 && csv2.indexOf(';"\'\r=2+2";') >= 0, "nome com TAB ou CR antes do = → apóstrofo na frente (o CR ainda vai entre aspas)");

    console.log('Links que vêm do JSON do ML: só ML/Mercado Pago (o painel não leva a um site falso)');
    const g2 = u => ({ closedPeriod: { results: [{ key: '2026-09-22', monthName: 'Setembro', redirection: { url: u }, balanceInformation: {} }] } });
    ok(SHC.mlFaturas(null, g2('https://evil.example/billing')).faturas[0].linkDetalhe === '' && SHC.mlFaturas(null, g2('//evil.example/x')).faturas[0].linkDetalhe === '',
        'fatura: link de outro domínio (ou //outro) → sem link');
    ok(SHC.mlFaturas(null, g2('/billing/detail/20260922')).faturas[0].linkDetalhe === B + '/billing/detail/20260922'
        && SHC.mlFaturas(null, g2(B + '/billing/x')).faturas[0].linkDetalhe === B + '/billing/x', 'fatura: link relativo e do ML continuam');
    const resTxt = fs.readFileSync(path.join(__dirname, 'fixtures/resumo_content_exemplo.json'), 'utf8');
    // Resumo adulterado: os cartões de Anúncios apontam para outro site e o de Vendas para //outro site; os de Pós-venda ficam no ML.
    const resMau = SHC.mlResumoDoConteudo(JSON.parse(resTxt.split('"href":"https://www.mercadolivre.com.br/anuncios').join('"href":"https://evil.example/anuncios')
        .split('"href":"https://www.mercadolivre.com.br/vendas').join('"href":"//evil.example/vendas')));
    ok(resMau && !/evil\.example/.test(JSON.stringify(resMau)) && resMau.cartoes.filter(x => !x.link).length === 11
        && resMau.cartoes.filter(x => /^https:\/\/www\.mercadolivre\.com\.br\/post-purchase\//.test(x.link)).length === 2, 'Resumo: cartões com href de outro domínio ficam sem link; os do ML ficam');
    // Revisão final 02/10: '/\t/x' e '/\x' o navegador lê como '//x' (outro site). Caminho relativo normal continua.
    const resumoCom = h => SHC.mlResumoDoConteudo(JSON.parse(resTxt.split('"href":"https://www.mercadolivre.com.br/anuncios').join('"href":' + JSON.stringify(h + '/anuncios').slice(0, -1))));
    ok(['/\t/evil.example', '/\\evil.example', '/\n/evil.example'].every(h => !/evil\.example/.test(JSON.stringify(resumoCom(h))))
        && resumoCom('/vendas').cartoes.some(x => /^\/vendas\/anuncios/.test(x.link)), 'Resumo: href com TAB, quebra de linha ou barra invertida → sem link; relativo normal fica');
    const rep = u => SHC.mlReputacaoDoEstado({ appProps: { pageProps: { variablesData: { variables: [{ id: 'claims', percentage: 1, metric_section: { url: u } }] } } } }).variaveis[0].link;
    ok(rep('https://evil.example/x') === '' && /^https:\/\/www\.mercadolivre\.com\.br\//.test(rep('https://www.mercadolivre.com.br/metricas/x')), 'Reputação: link do ML fica, de outro domínio sai');

    console.log('Fundo: cada ação confere quem mandou');
    const CONTA = '900009560', ABA = { tab: { id: 3 }, url: B + '/anuncios/lista' }, SITE = { tab: { id: 4 }, url: 'https://exemplo.com/' };
    let F = montaFundo({ dados: { 'ml:conta': CONTA } });
    const abertas = [], opcoes = [];
    F.ctx.chrome.tabs.create = o => { abertas.push(o.url); };
    F.ctx.chrome.runtime.openOptionsPage = () => { opcoes.push(1); };
    for (const a of ['sincronizar', 'recalcular_alertas', 'sincronizar_repasse', 'abrir_painel']) ok(await F.envia({ acao: a }, ABA) === '__sem_resposta', a + ' da aba do ML → ignorada (só as telas da extensão)');
    ok(!opcoes.length, 'abrir_painel recusado não abre nada');
    // Revisão de 02/10: as ações que só o painel lateral e o painel mandam (nenhum content script) também saem da aba do ML.
    const soPainel = ['concorrentes', 'fiscal_agora', 'sincronizar_custos', 'simulador', 'saude_agora', 'medidas_agora', 'catalogo_agora', 'medidas_marca', 'robo_rodar_agora', 'robo_desfazer'];
    const nPed = F.pedidos.length, IT = 'MLB1234567890';
    for (const a of soPainel) ok(await F.envia({ acao: a, itemId: IT, tipo: 'alterar', erp: 'tiny' }, ABA) === '__sem_resposta', a + ' da aba do ML → ignorada (só as telas da extensão)');
    ok(await F.envia({ acao: 'saude_agora' }, ABA) === '__sem_resposta' && F.pedidos.length === nPed, 'nenhuma leitura no ML nem no ERP por pedido da aba (nem a rodada lenta da Saúde)');
    ok((await F.envia({ acao: 'medidas_marca', itemId: IT, tipo: 'fui_eu' })).motivo === 'item', 'o painel lateral (chrome-extension://) continua passando');
    const semComentario = t => t.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    const ctScripts = JSON.parse(le('manifest.json')).content_scripts.flatMap(c => c.js).map(a => semComentario(le(a))).join('\n');
    ok(soPainel.every(a => ctScripts.indexOf("'" + a + "'") < 0), 'nenhum content script manda essas ações');
    ok(await F.envia({ acao: 'abrir_frete', itemId: 'MLB1234567890' }, SITE) === '__sem_resposta', 'abrir_frete de uma aba que não é do ML → ignorada');
    ok((await F.envia({ acao: 'abrir_frete', itemId: 'MLB1234567890' }, ABA)).ok === true, 'abrir_frete da aba do ML continua');
    ok(await F.envia({ acao: 'abrir_agenda' }, SITE) === '__sem_resposta' && await F.envia({ acao: 'abrir_agenda' }) === '__sem_resposta' && !abertas.length, 'abrir_agenda só da aba do ML');
    const canal = { tab: { id: 5 }, url: B + '/marketing/canal-de-transmissao/lista' };
    ok((await F.envia({ acao: 'abrir_agenda' }, canal)).ok === true && abertas.join() === 'agenda-canal.html', 'abrir_agenda da página do Canal → o fundo abre a agenda-canal.html numa aba');

    console.log('Agenda do Canal: a página não fica exposta ao ML');
    const man = JSON.parse(le('manifest.json')), canalJs = le('ml-canal.js');
    ok(!man.web_accessible_resources, 'manifest sem web_accessible_resources (a Agenda não entra em iframe de página do ML nem denuncia a extensão)');
    ok(!/window\.open\(/.test(canalJs) && /sendMessage\(\{ acao: 'abrir_agenda' \}\)/.test(canalJs), 'ml-canal.js pede ao fundo para abrir a Agenda');

    console.log('Dados que a aba do ML manda: teto e faixa (promos_pagina)');
    const muitas = Array.from({ length: 10000 }, (_, i) => ({ chave: 'F' + i, titulo: 'x' }));
    const props = [{ familia: 'F1', itemId: 'MLB1', preco: 100, tarifa: 300, recebe: 1 }, { familia: 'F1', itemId: 'MLB2', preco: 100, tarifa: 16, recebe: 84 }, { familia: 'F1', itemId: 'MLB3', preco: -5, tarifa: 0, recebe: 1 }];
    const rp = await F.envia({ acao: 'promos_pagina', dados: { familias: muitas.concat([null, { chave: 7 }]), propostas: props }, conta: CONTA }, ABA);
    const pr = F.dados['ml:promos:' + CONTA] || { familias: [], propostas: [] };
    ok(rp.ok === true && pr.familias.length === 500 && pr.familias.every(x => typeof x.chave === 'string'), '10.000 famílias → guarda no máximo 500, só as com chave');
    ok(pr.propostas.map(p => p.itemId).join() === 'MLB2', 'proposta com tarifa de 300% ou preço negativo é descartada; a normal entra');
    // Revisão de 02/10: texto e NaN passavam no !(p.tarifa < 0) && !(p.tarifa > p.preco).
    const props2 = [{ familia: 'G1', itemId: 'MLB4', preco: 100, tarifa: 'abc', recebe: 'zzz' }, { familia: 'G1', itemId: 'MLB5', preco: 100, tarifa: NaN, recebe: 84 },
        { familia: 'G1', itemId: 'MLB6', preco: 100, tarifa: 16, recebe: 1e9 }, { familia: 'G1', itemId: 'MLB7', preco: 100, tarifa: 16, recebe: 70, envio: -14 },
        { familia: 'G1', itemId: 'MLB8', preco: 100, tarifa: 16, recebe: 70, envio: 14 }, { familia: 'G1', itemId: 'MLB9', preco: 100, tarifa: null, recebe: 84 }];
    await F.envia({ acao: 'promos_pagina', dados: { familias: [{ chave: 'G1' }], propostas: props2 }, conta: CONTA }, ABA);
    const pr2 = (F.dados['ml:promos:' + CONTA].propostas || []).filter(p => p.familia === 'G1');
    ok(pr2.map(p => p.itemId).join() === 'MLB8,MLB9', "tarifa 'abc', tarifa NaN, recebe 1e9 e envio negativo → descartadas; a normal e a sem tarifa entram");

    console.log('Dados que a aba do ML manda: faixa dos números (anuncios_pagina e editor_anuncios)');
    const IT2 = 'MLB1234567891', IT3 = 'MLB1234567892';
    const ra = await F.envia({ acao: 'anuncios_pagina', conta: CONTA, itens: [{ itemId: IT, titulo: 'Falso', preco: -50, tarifa: 9999, recebe: 1e9 },
        { itemId: IT2, titulo: 'Normal', preco: 100, tarifa: 16, recebe: 70, frete: 14, taxaOperacional: 2 },
        { itemId: IT3, titulo: 'Texto', preco: 100, tarifa: 'abc', recebe: NaN, frete: 5000, taxaOperacional: 2000, precoCheio: -1, qtdVariacoes: 'x', skus: 'A' },
        { itemId: 'MLB1234567893', titulo: 'Barato', preco: 9.9, tarifa: 4.95, recebe: 0, frete: 0, freteComprador: true, taxaOperacional: 12.5 }] }, ABA);
    const an = ((F.dados['ml:anuncios:' + CONTA] || {}).itens || []), ach = id => an.find(i => i && i.itemId === id) || {};
    ok(ra.ok === true && an.length === 4, 'os 4 anúncios entram (o número impossível sai, o anúncio fica)');
    ok(ach('MLB1234567893').taxaOperacional === 12.5 && ach('MLB1234567893').recebe === 0 && ach(IT3).taxaOperacional === null,
        'anúncio barato: taxa operacional maior que o preço continua (até R$ 1.000); taxa de R$ 2.000 num anúncio de R$ 100 → null');
    ok(ach(IT).preco === null && ach(IT).tarifa === null && ach(IT).recebe === null && ach(IT).titulo === 'Falso', 'preço −50, tarifa 9999 e recebe 1e9 → null (sem preço não há como conferir tarifa e recebe)');
    ok(ach(IT2).preco === 100 && ach(IT2).tarifa === 16 && ach(IT2).recebe === 70 && ach(IT2).frete === 14 && ach(IT2).taxaOperacional === 2, 'anúncio normal fica como veio');
    ok(ach(IT3).preco === 100 && ach(IT3).tarifa === null && ach(IT3).recebe === null && ach(IT3).frete === null && ach(IT3).precoCheio === null
        && !('qtdVariacoes' in ach(IT3)) && Array.isArray(ach(IT3).skus), "tarifa 'abc', recebe NaN, frete 5000 num anúncio de R$ 100, preço cheio −1 → null; qtdVariacoes texto sai; skus texto vira []");
    const fh = JSON.stringify(Object.keys(F.dados).filter(k => /^fh/.test(k)).map(k => F.dados[k]));
    ok(fh.indexOf('5000') < 0 && JSON.stringify(F.dados['fh|ml|' + IT2] || {}).indexOf(':14') >= 0, 'o frete impossível não entra no histórico de frete; o normal entra');
    // editor_anuncios: variacoes como texto travava o fontesSku (e com ele toda leitura de Anúncios); dicas como texto travava o cartão de pendências.
    const re = await F.envia({ acao: 'editor_anuncios', conta: { sellerId: CONTA }, dados: { total: 1, completo: false, porItem: {
        [IT]: { id: IT, sku: 'SKU-A', nVar: 2, variacoes: 'x', dicas: 'abc', estoque: -5, entrega: 'ME2' },
        [IT2]: { id: IT2, sku: 7, estoque: 3, variacoes: [{ id: 1, sku: 'V1', estoque: 'muito' }, 'lixo'], dicas: ['Adicione mais fotos', 9] } } } }, ABA);
    const ed = (F.dados['editor:' + CONTA] || {}).porItem || {};
    ok(re.ok === true && !('variacoes' in ed[IT]) && Array.isArray(ed[IT].dicas) && !ed[IT].dicas.length && ed[IT].estoque === null && ed[IT].entrega === null,
        'Editor: variacoes texto sai, dicas texto vira [], estoque −5 → null, entrega texto → null');
    ok(ed[IT2].sku === '' && ed[IT2].estoque === 3 && ed[IT2].variacoes.length === 1 && ed[IT2].variacoes[0].id === '' && ed[IT2].variacoes[0].sku === 'V1'
        && ed[IT2].variacoes[0].estoque === null && ed[IT2].dicas.join() === 'Adicione mais fotos', 'Editor: SKU número → vazio, variação lixo sai, estoque texto → null, a dica de texto fica');
    ok(SHC.editorPendencias({ porItem: ed }).length === 1, 'o cartão de pendências monta com o que foi guardado');
    const ra2 = await F.envia({ acao: 'anuncios_pagina', conta: CONTA, itens: [{ itemId: IT2, titulo: 'Normal', preco: 100, tarifa: 16, recebe: 70, frete: 14 }] }, ABA);
    ok(ra2.ok === true && ra2.anuncios === 4, 'depois do Editor adulterado a leitura de Anúncios continua (o fontesSku não trava)');
    // Revisão final 02/10: título como objeto quebrava a busca do painel lateral (titulo.toLowerCase()) até a próxima sincronização.
    await F.envia({ acao: 'anuncios_pagina', conta: CONTA, itens: [{ itemId: IT3, titulo: { x: 1 }, status: 7, sku: ['A'], skus: ['S1', 9], preco: 100 }] }, ABA);
    const lista3 = (F.dados['ml:anuncios:' + CONTA] || {}).itens || [], an3 = lista3.find(i => i && i.itemId === IT3) || {};
    ok(typeof an3.titulo === 'string' && typeof an3.status === 'string' && typeof an3.sku === 'string' && (an3.skus || []).every(s => typeof s === 'string'),
        'anúncio com título objeto, status número e SKU lista → os textos ficam texto (a busca do painel não quebra)');
    ok((lista3.find(i => i && i.itemId === IT2) || {}).titulo === 'Normal', 'o título de verdade continua igual');

    console.log('Certificado: o vencido que veio da remessa do Full não some pela tela');
    F = montaFundo({ dados: { 'ml:conta': CONTA, ['cert:' + CONTA]: { dias: null, data: null, expirou: true, ts: Date.now(), fonte: 'remessa' } } });
    const rc = await F.envia({ acao: 'certificado', semAviso: true, conta: { sellerId: CONTA } }, { tab: { id: 3 }, url: B + '/billing/invoiceissuer/fiscal-hub' });
    ok(rc.ok === true && F.dados['cert:' + CONTA].expirou === true && F.dados['cert:' + CONTA].fonte === 'remessa', 'semAviso não apaga o vencido da remessa (só a remessa relida tira)');

    console.log('Campo do custo e telas do ERP');
    ok(/\['keydown', 'keyup', 'keypress', 'click', 'mousedown', 'input', 'beforeinput'\]\.forEach\(t => SR\.addEventListener\(t, e => e\.stopPropagation\(\)\)\)/.test(le('ml-tela.js')),
        'custo digitado: input/beforeinput também param no balão fechado');
    const ph = le('painel.html'), bloco = id => (ph.split('id="' + id + 'Sem"')[1] || '').split('</div>')[0];
    ok(/só de leitura/.test(bloco('tiny')) && /só de leitura/.test(bloco('omie')) && /só com leitura de Produtos/.test(bloco('bling')) && /usuário só de leitura/.test(le('painel-lateral.html')),
        'Tiny, Omie e Bling: linha de segurança "só de leitura" na tela de conectar (painel e painel lateral)');

    console.log('Pacote da loja e rascunho da política');
    const emp = fs.readFileSync(path.join(__dirname, '../../deploy/copiloto-chrome-web-store/empacotar.ps1'), 'utf8');
    ok(/Arquivo fora do padrão no pacote/.test(emp) && /Get-FileHash \$zip -Algorithm SHA256/.test(emp), 'empacotar.ps1 confere icons/ e nucleo/ e imprime o SHA-256 do zip');
    ok(/Join-Path \$tmp 'icons'[^\n]*-ne '\.png'/.test(emp) && /Em icons\/ só entra \.png/.test(emp), 'empacotar.ps1: em icons/ só entra .png (icons/x.js ou x.json travam o pacote)');
    const pol = fs.readFileSync(path.join(__dirname, '../../deploy/seguranca/copiloto/privacidade-copiloto-RASCUNHO.html'), 'utf8');
    ok(['RASCUNHO', 'CNPJ', 'Encarregado', 'Base legal', 'Por quanto tempo', 'Seus direitos', 'só neste Chrome', 'Quando o login', '13.709', 'número da venda'].every(t => pol.indexOf(t) >= 0),
        'rascunho: controlador com CNPJ a preencher, encarregado, base legal, retenção, direitos, chaves do ERP, login futuro, LGPD, afiliados');

    console.log(f ? '\n' + f + ' FALHA(S)' : '\nTUDO OK');
    process.exitCode = f ? 1 : 0;
})().catch(e => { console.error(e); console.log('\n1 FALHA(S)'); process.exitCode = 1; });
