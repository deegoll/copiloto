// Multi-empresa (auditoria de 07/10/2026): o mesmo Chrome com várias contas do ML (empresas diferentes) nunca mistura os dados.
// (a) contaSegue: só diz "trocou" com prova (a página diz o dono e é outro); (b) marcaReler: os meses lidos depois da troca voltam para a fila;
// (c) sincronização em que o login muda no meio: as etapas seguintes param com 'outra_conta' e nada é gravado em nome da conta nova;
// (d) aviso de certificado sem a conta da página só vale com 1 conta no Chrome;
// (e) conta marcada como "outra empresa": custos por SKU, imposto/margem/despesas e ERP só dela (store.js, SHC.empresaSeparada).
// (f) revisão de 07/10/2026: "Esquecer" o ERP numa empresa não apaga o da outra; configurado é da empresa; a importação do ERP grava na
//     empresa do COMEÇO mesmo se o ML trocar de conta no meio; nenhuma tela lê custos/cfg/ERP cru (sem a camada da empresa).
// Rodar: node tests/copiloto/teste_multiconta.js
'use strict';
require('./relogio').fixar();
const montaFundo = require('./fundo_falso'), { B, paginaAnuncios } = montaFundo;
let falhas = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) falhas++; };
const A = '900000001', OUTRA = '900000002';
const ABA = { tab: { id: 3 }, url: B + '/faturacion/certificado' };

(async () => {
    console.log('a) contaSegue: troca só com prova');
    let dono = A;
    const F = montaFundo({ rota: u => (/\/anuncios\/lista/.test(u) ? (dono ? { html: paginaAnuncios([{ itemId: 'MLB1000000001', frete: 20 }], dono) } : { html: '<html></html>' }) : null) });
    ok(await F.ctx.contaSegue(A, true) === true, 'sessão da mesma conta → segue');
    dono = OUTRA;
    ok(await F.ctx.contaSegue(A) === true, 'dentro de 1 minuto vale a conferência guardada (1 GET por minuto no máximo)');
    ok(await F.ctx.contaSegue(A, true) === false, 'página de outra conta → trocou');
    dono = '';
    ok(await F.ctx.contaSegue(A, true) === true, 'página que não diz o dono não é prova de troca');
    ok(await F.ctx.contaSegue('atual') === true && await F.ctx.contaSegue('') === true, 'sem conta conhecida: nada a conferir');

    console.log('b) marcaReler: meses lidos depois da troca voltam para a fila');
    const agora = Date.now(), hojeBr = new Date(agora - 3 * 3600e3).toISOString().slice(0, 10);
    const G = montaFundo({ dados: {
        ['ml:cobrancas:' + A]: { mesesLidos: ['2026-08', '2026-09'], lidoEm: { '2026-08': '2026-09-05', '2026-09': hojeBr }, releer: [],
            incompletos: ['2026-06', '2026-07'], cortadoEm: { '2026-06': '2026-09-01', '2026-07': hojeBr } },
        ['vbAnuncio:' + A]: { meses: { '2026-08': { completo: true, lidoTs: agora - 30 * 864e5 }, '2026-09': { completo: true, lidoTs: agora } }, mesesLidos: ['2026-08', '2026-09'] },
        ['vb:' + A]: { mesesLidos: ['2026-05', '2026-06'], completo13: true, lidoTs: { '2026-05': agora - 30 * 864e5, '2026-06': agora } },
    } });
    await G.ctx.marcaReler(A, agora - 60e3);
    const mc = G.dados['ml:cobrancas:' + A], va = G.dados['vbAnuncio:' + A], vbA = G.dados['vb:' + A];
    ok(JSON.stringify(mc.releer) === '["2026-07","2026-09"]' && mc.mesesLidos.length === 2, 'Faturamento: o mês lido agora e o cortado (80+ páginas) lido agora vão para releer; os de antes ficam');
    ok(va.meses['2026-09'].completo === false && va.meses['2026-08'].completo === true && JSON.stringify(va.mesesLidos) === '["2026-08"]', 'vendas por anúncio: o mês lido agora deixa de contar como lido');
    ok(JSON.stringify(vbA.mesesLidos) === '["2026-05"]' && vbA.completo13 === false, 'vendas brutas: o mês lido depois da troca sai de mesesLidos (volta a ser lido)');
    // Fuso fora de Brasília (Manaus, UTC−4): às 23:30 locais o lidoEm (dia LOCAL, SHC.hoje) é um dia antes do dia de Brasília.
    {
        const path = require('path'), { execFileSync } = require('child_process');
        const prog = 'require(' + JSON.stringify(path.join(__dirname, 'relogio')) + ').fixar();'
            + 'const montaFundo = require(' + JSON.stringify(path.join(__dirname, 'fundo_falso')) + ');'
            + '(async () => { const desde = Date.parse("2026-10-08T03:30:00Z");'
            + 'const G = montaFundo({ dados: { "ml:cobrancas:900000001": { mesesLidos: ["2026-10"], lidoEm: { "2026-10": "2026-10-07" }, releer: [] } } });'
            + 'await G.ctx.marcaReler("900000001", desde); console.log(JSON.stringify(G.dados["ml:cobrancas:900000001"].releer)); })();';
        let saida = '';
        try { saida = execFileSync(process.execPath, ['-e', prog], { env: Object.assign({}, process.env, { TZ: 'America/Manaus' }) }).toString().trim(); } catch (e) { saida = String(e && e.message); }
        ok(saida === '["2026-10"]', 'Manaus às 23:30: o mês lido "hoje" (dia local) volta para a fila (' + saida + ')');
    }
    await G.ctx.marcaReler('atual', agora);
    ok(!G.dados['ml:cobrancas:atual'], 'conta "atual" (sem id): não mexe em nada');

    console.log('c) sincronização com o login trocado no meio');
    const dados = {};
    let pedidosLista = 0;
    // Até a conta ser registrada (fim da leitura dos anúncios), a sessão é da conta A; depois, alguém entrou na outra empresa.
    const H = montaFundo({ dados, hoje: '2026-10-07', rota: u => {
        if (/\/anuncios\/lista/.test(u)) { pedidosLista++; return { html: paginaAnuncios([{ itemId: 'MLB1000000001', frete: 20 }], dados['ml:conta'] ? OUTRA : A) }; }
        return null;
    } });
    await H.ctx.sincronizar('manual');
    const st = dados['shc:status'] || {}, et = st.etapas || {};
    const outra = H.ctx.O_QUE_FAZER ? null : null;   // (O_QUE_FAZER é const de topo: lida pelo texto do erro)
    ok(dados['ml:conta'] === A, 'a conta registrada continua a A');
    ok(st.estado === 'erro' && st.erro === 'outra_conta' && !st.ultimaOk, 'a sincronização termina com "outra_conta" e não conta como sincronizada');
    ok(et.anuncios && et.anuncios.estado === 'ok', 'anúncios lidos com a sessão da A');
    const depois = Object.keys(et).filter(k => k !== 'anuncios');
    ok(depois.length > 5 && depois.every(k => et[k].estado === 'erro' && /mudou de conta/.test(et[k].erro || '')),
        'todas as etapas depois dos anúncios param com "mudou de conta" (' + depois.length + ' etapas)');
    ok(!Object.keys(dados).some(k => k.indexOf(OUTRA) >= 0), 'nenhuma chave gravada com o id da outra conta');
    ok(pedidosLista <= 4, 'a troca foi vista com poucos pedidos à lista (' + pedidosLista + '), sem martelar o ML');
    void outra;

    // 3.3.0 (revisão da junção): a troca DEPOIS da 1ª conferência, com o guardado de 60 s ainda valendo, deixava as etapas seguintes gravarem
    // a outra empresa marcadas 'ok' (só a conferência forçada do fim via). A conferência de depois de cada etapa agora é sem o guardado.
    console.log('c2) login trocado logo depois da 1ª conferência');
    const dados2 = {};
    let pedidos2 = 0;
    const H2 = montaFundo({ dados: dados2, hoje: '2026-10-07', rota: u => {
        if (/\/anuncios\/lista/.test(u)) { pedidos2++; return { html: paginaAnuncios([{ itemId: 'MLB1000000001', frete: 20 }], pedidos2 >= 3 ? OUTRA : A) }; }   // 1º: anúncios; 2º: 1ª conferência
        return null;
    } });
    await H2.ctx.sincronizar('manual');
    const st2 = dados2['shc:status'] || {}, et2 = st2.etapas || {}, depois2 = Object.keys(et2).filter(k => k !== 'anuncios');
    ok(st2.estado === 'erro' && st2.erro === 'outra_conta' && et2.vendasBrutas && et2.vendasBrutas.inicio > 0 && !et2.faturamento.inicio,
        'a 1ª etapa passou pela conferência de antes (sessão da A) e a troca veio no meio dela');
    ok(depois2.length > 5 && depois2.every(k => et2[k].estado === 'erro' && /mudou de conta/.test(et2[k].erro || '')),
        'a etapa da troca e todas as seguintes param com "mudou de conta": nenhuma fica "ok" com a sessão da outra empresa (' + depois2.length + ' etapas)');

    console.log('d) certificado sem a conta da página');
    const C1 = montaFundo({ dados: { 'ml:conta': A, 'ml:contas': { [A]: { visto: 1 } } } });
    const r1 = await C1.envia({ acao: 'certificado', titulo: 'Certificado digital vencido', texto: 'Seu certificado digital venceu.' }, ABA);
    ok(r1 && r1.ok !== false && C1.dados['cert:' + A], '1 conta no Chrome: o aviso sem conta vale (como antes)');
    const C2 = montaFundo({ dados: { 'ml:conta': A, 'ml:contas': { [A]: { visto: 2 }, [OUTRA]: { visto: 1 } } } });
    const r2 = await C2.envia({ acao: 'certificado', titulo: 'Certificado digital vencido', texto: 'Seu certificado digital venceu.' }, ABA);
    ok(r2 && r2.ok === false && r2.motivo === 'conta' && !C2.dados['cert:' + A], '2 contas no Chrome: aviso sem a conta da página é descartado (não marca a empresa errada)');
    const r3 = await C2.envia({ acao: 'certificado', titulo: 'Certificado digital vencido', texto: 'Seu certificado digital venceu.', conta: { sellerId: A } }, ABA);
    ok(r3 && r3.ok !== false && C2.dados['cert:' + A], 'com a conta da página igual à aberta: vale');

    console.log('e) empresa separada: custos por SKU, números da empresa e ERP só da conta marcada');
    {
        const path = require('path'), EXT = path.join(__dirname, '../../extension-copiloto');
        const mem = {}, cp = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
        global.chrome = { storage: { local: {
            get: async k => { const o = {}; (k === null ? Object.keys(mem) : [].concat(k)).forEach(x => { if (x in mem) o[x] = cp(mem[x]); }); return o; },
            set: async o => { Object.keys(o).forEach(x => { mem[x] = cp(o[x]); }); },
            remove: async k => { [].concat(k).forEach(x => delete mem[x]); },
        } }, runtime: { sendMessage: async () => ({}) } };
        const S = require(path.join(EXT, 'calc.js'));
        require(path.join(EXT, 'store.js'));
        const espera = () => new Promise(r => setTimeout(r, 1600));   // o cache da empresa vale 1,5 s
        mem['ml:conta'] = A;
        await S.salvarCustoSku('KIT-01', { custo: 10 });
        await S.salvarCfg({ imposto_pct: 6, margem_alvo_pct: 12 });
        await S.gravarChave('erp:tiny', { token: 'TOKEN-A' });
        mem['ml:conta'] = OUTRA; mem.cfg = Object.assign({}, mem.cfg, { empresaSeparada: { [OUTRA]: true } }); await espera();
        const vazio = await S.lerCustos([S.chaveSku('KIT-01')]);
        ok(!Object.keys(vazio).length, 'conta de outra empresa não vê o custo do mesmo SKU da outra');
        let c = await S.lerCfg();
        ok(c.imposto_pct === 0 && c.margem_alvo_pct === 10 && c.empresa === OUTRA && c.configurado === false,
            'e não herda o imposto, a margem nem o "configurado" da outra (padrões; o 0% não vira imposto informado)');
        ok(await S.lerChave('erp:tiny') === null, 'nem a credencial do ERP da outra');
        await S.salvarCustoSku('KIT-01', { custo: 25 });
        await S.salvarCfg({ imposto_pct: 11.5 });
        await S.gravarChave('erp:tiny', { token: 'TOKEN-B' });
        ok(mem['c|sku|KIT-01'].custo === 10 && mem['c|sku@' + OUTRA + '|KIT-01'].custo === 25, 'gravou na chave dela; o custo da primeira empresa ficou intacto');
        ok(mem.cfg.imposto_pct === 6 && mem.cfg.porConta[OUTRA].imposto_pct === 11.5, 'imposto dela em cfg.porConta; o da primeira empresa intacto');
        ok(mem.cfg.porConta[OUTRA].configurado === true && (await S.lerCfg()).configurado === true, 'e o "configurado" dela também fica em cfg.porConta');
        ok(mem['erp:tiny'].token === 'TOKEN-A' && mem['erp@' + OUTRA + ':tiny'].token === 'TOKEN-B', 'cada empresa com o seu ERP');
        const tudo = await S.lerTudo();
        ok(Object.keys(tudo.custos).length === 1 && tudo.custos['sku|KIT-01'].custo === 25 && tudo.cfg.imposto_pct === 11.5, 'a planilha de custos mostra só os dela, com o imposto dela');
        mem['ml:conta'] = A; await espera();
        ok((await S.lerCustos([S.chaveSku('KIT-01')]))['c|sku|KIT-01'].custo === 10 && (await S.lerCfg()).imposto_pct === 6 && (await S.lerChave('erp:tiny')).token === 'TOKEN-A',
            'voltando à primeira empresa: tudo dela de novo (custo 10, imposto 6%, ERP A)');
        const t2 = await S.lerTudo();
        ok(!Object.keys(t2.custos).some(k => /@/.test(k)) && Object.keys(t2.custos).length === 1, 'e a planilha dela não mostra os custos da outra');
        await S.salvarDespesasFixas([{ nome: 'Aluguel', valor: 1000 }]);
        mem['ml:conta'] = OUTRA; await espera();
        ok(!S.despesasFixas(await S.lerCfg()).length, 'despesas fixas de uma empresa não aparecem na outra');

        console.log('f) revisão 07/10: ERP, configurado e importação presa à empresa do começo');
        // "Esquecer" (painel.js esquecerErp) com a OUTRA aberta: some só o dela; a permissão fica porque a primeira empresa ainda usa o Tiny.
        await S.areaEmpresa().remove('erp:tiny');
        ok(mem['erp:tiny'].token === 'TOKEN-A' && !mem['erp@' + OUTRA + ':tiny'], '"Esquecer" o Tiny na outra empresa não apaga o da primeira');
        ok(await S.erpEmOutraEmpresa('erp:tiny') === true, 'e a permissão do Chrome fica (a primeira empresa ainda usa o Tiny)');
        mem['ml:conta'] = A; await espera();
        await S.areaEmpresa().remove('erp:tiny');
        ok(await S.erpEmOutraEmpresa('erp:tiny') === false, 'nenhuma empresa com o Tiny: a permissão pode sair');
        // configurado: a primeira empresa sem números; salvar os da outra não a marca.
        delete mem.cfg.configurado; delete mem.cfg.imposto_pct;
        mem['ml:conta'] = OUTRA; await espera();
        await S.salvarCfg({ imposto_pct: 9 });
        mem['ml:conta'] = A; await espera();
        ok((await S.lerCfg()).configurado !== true && mem.cfg.configurado === undefined, 'salvar o imposto da outra empresa não marca a primeira como configurada');
        // Empresa forçada: a importação que começou na primeira empresa grava nela mesmo com a outra aberta agora.
        mem['ml:conta'] = OUTRA; await espera();
        ok((await S.contasDaEmpresa('')).every(x => x.sellerId !== OUTRA) && (await S.contasDaEmpresa(OUTRA)).every(x => x.sellerId === OUTRA), 'contasDaEmpresa(empresa) devolve as contas da empresa pedida');
        require(path.join(EXT, 'tiny.js'));
        await S.tinyGravar([{ sku: 'IMP-01', custo: 33 }], 'tiny', { empresa: '' });
        ok(mem['c|sku|IMP-01'] && mem['c|sku|IMP-01'].custo === 33 && !mem['c|sku@' + OUTRA + '|IMP-01'], 'tinyGravar com a empresa do começo: grava nela, mesmo com a outra aberta');
        await S.areaEmpresa('').set({ 'erp:produtos:tiny': { ts: 1, itens: [] } });
        ok(mem['erp:produtos:tiny'] && !mem['erp@' + OUTRA + ':produtos:tiny'], 'SHC.areaEmpresa(empresa) grava na empresa pedida');
        // 2ª revisão: erp@<id> de uma conta que NÃO está mais separada é sobra e não segura a permissão do Chrome.
        mem['ml:conta'] = A; await espera();
        mem['erp@900000099:omie'] = { appKey: 'x', appSecret: 'y' };
        ok(await S.erpEmOutraEmpresa('erp:omie') === false, 'ERP de conta desmarcada (sobra invisível) não impede tirar a permissão');
        // O retrato da tela com a empresa do começo diferente da aberta: grava nela e não pede a conferência (a janela seria da outra empresa).
        const enviados = [];
        global.chrome.runtime.sendMessage = async m => { enviados.push(m); return {}; };
        require(path.join(EXT, 'erp-cruzar.js'));
        await S.erpRetratoDaTela('tiny', [{ sku: 'R1', custo: 1 }], true, OUTRA);
        ok(mem['erp@' + OUTRA + ':produtos:tiny'] && !enviados.some(m => m.acao === 'erp_conferir'), 'retrato do ERP na empresa do começo, sem abrir o resumo na empresa aberta agora');

        // 3.3.0 (revisão da junção): a loja do TikTok (tt:…) também passa pela camada da empresa, como o ERP. Antes a tt:conta era uma só e a
        // loja da empresa principal aparecia na outra, com o lucro pelos custos da empresa aberta.
        console.log('e2) a loja do TikTok é de 1 empresa só: a da conta do ML aberta na 1ª captura');
        const fs = require('fs'), vm = require('vm');
        global.CopilotoNucleo = undefined;
        ['nucleo/util.js', 'nucleo/modelo.js', 'nucleo/tarifas.js', 'nucleo/motor.js', 'nucleo/conciliacao.js', 'nucleo/adaptador.js', 'nucleo/adaptadores/tiktok.js']
            .forEach(f => vm.runInThisContext(fs.readFileSync(path.join(EXT, f), 'utf8'), { filename: f }));
        const TT = require(path.join(EXT, 'tiktok.js'));
        // saldo inventado com a forma do retrato real (retratos_tiktok/ tem dado de cliente e não vai para o GitHub)
        const saldo = { code: 0, message: 'success', data: { amount: { amount: '1000.00', currency: 'BRL', symbol: 'R$',
            format_with_symbol: 'R$ 1.000,00', format_without_symbol: '1.000,00' } } };
        const LA = '7495000000000000001', LB = '7495000000000000002';
        mem['ml:conta'] = A; await espera();
        await TT.gravarCaptura('saldo', saldo, LA, Date.now() - 60e3);
        ok(mem['tt:conta'] === LA && mem['tt:' + LA + ':saldo'] && !Object.keys(mem).some(k => /^tt@/.test(k)), 'empresa principal: as mesmas chaves de sempre (tt:<loja>:…)');
        mem['ml:conta'] = OUTRA; await espera();
        ok(await TT.ler() === null, 'a outra empresa não vê a loja do TikTok da principal');
        await TT.gravarCaptura('saldo', saldo, LB, Date.now() - 60e3);
        ok(mem['tt@' + OUTRA + ':conta'] === LB && mem['tt@' + OUTRA + ':' + LB + ':saldo'] && mem['tt:conta'] === LA && !mem['tt:' + LB + ':saldo'],
            'a loja lida com a outra empresa aberta grava só nela (tt@<conta>:…); a da principal fica intacta');
        const dB = await TT.ler();
        ok(dB && dB.conta === LB && dB.saldo && dB.custos['c|sku|KIT-01'] && dB.custos['c|sku|KIT-01'].custo === 25, 'a outra empresa lê a loja dela, com os custos dela (KIT-01 = R$ 25)');
        // Revisão da junção (achado da reconferência): a loja é da empresa da 1ª captura (tt:lojas), não da conta do ML aberta na hora. Antes, ler
        // a loja da principal com o ML da outra empresa aberto gravava tt@<outra>:<loja>:… e a loja aparecia nas 2, partida e com os custos da outra.
        const emTt = Date.now() - 30e3;
        await TT.gravarCaptura('saldo', saldo, LA, emTt);
        ok(mem['tt:' + LA + ':saldo'].lido_em === emTt && !Object.keys(mem).some(x => x.indexOf('tt@' + OUTRA + ':' + LA + ':') === 0) && mem['tt@' + OUTRA + ':conta'] === LB
            && (await TT.ler()).conta === LB, 'a loja da principal lida com o ML da outra empresa aberto grava só na principal; a outra continua vendo só a loja dela');
        delete mem['tt:lojas'];   // loja com dados de antes do tt:lojas: fica onde os dados estão
        const LC = '7495000000000000003';
        await TT.gravarCaptura('saldo', saldo, LA, emTt); await TT.gravarCaptura('saldo', saldo, LC, emTt);
        ok(mem['tt:lojas'][LA] === '' && mem['tt:lojas'][LC] === OUTRA && !Object.keys(mem).some(x => x.indexOf('tt@' + OUTRA + ':' + LA + ':') === 0) && mem['tt@' + OUTRA + ':' + LC + ':saldo'],
            'sem tt:lojas: a loja que já tem dados fica na empresa deles; a loja nova é da empresa da conta do ML aberta');
        mem['ml:conta'] = A; await espera();
        const dA = await TT.ler();
        ok(dA && dA.conta === LA && dA.custos['c|sku|KIT-01'].custo === 10 && !Object.keys(dA.custos).some(x => /@/.test(x)), 'de volta à principal: a loja dela, com os custos dela (KIT-01 = R$ 10)');
        ok(await TT.apagarDados() >= 4 && !Object.keys(mem).some(k => /^tt[:@]/.test(k)), '"Apagar dados do TikTok" apaga a loja das 2 empresas');
    }

    // Importação pelo fundo: o ML troca para a conta da OUTRA empresa no meio da leitura do Tiny → tudo vai para a empresa do começo.
    {
        const fd = { 'ml:conta': A, 'ml:contas': { [A]: { visto: 2 }, [OUTRA]: { visto: 1 } }, cfg: { empresaSeparada: { [OUTRA]: true } }, 'erp:tiny': { token: 'TOKEN-A' } };
        const I = montaFundo({ dados: fd });
        I.ctx.chrome.permissions.contains = async () => true;
        I.ctx.SHC.tinyPuxar = async () => { fd['ml:conta'] = OUTRA; await new Promise(r => setTimeout(r, 1600)); return [{ sku: 'ERP-01', custo: 12, titulo: 'Peça' }]; };
        const r = await I.ctx.sincronizarCustos('tiny', 0);
        ok(r && r.ok && fd['c|sku|ERP-01'] && fd['c|sku|ERP-01'].custo === 12 && !Object.keys(fd).some(k => k.indexOf('@' + OUTRA) >= 0),
            'custos do Tiny na empresa do começo; nada gravado na empresa que abriu no meio');
        ok(fd['erp:tiny'].ultima && fd['erp:produtos:tiny'] && fd['erp:produtos:tiny'].itens.length === 1, 'o "última importação" e o retrato do ERP também ficam na empresa do começo');
        // A tela manda a empresa do clique: só vale '' ou uma conta AINDA marcada como outra empresa.
        ok(await I.ctx.empresaDoPedido({ empresa: OUTRA }) === OUTRA && await I.ctx.empresaDoPedido({ empresa: '' }) === ''
            && await I.ctx.empresaDoPedido({ empresa: '900000777' }) === undefined && await I.ctx.empresaDoPedido({ empresa: 'x;y' }) === undefined && await I.ctx.empresaDoPedido({}) === undefined,
            'empresa do pedido conferida: conta separada ou a principal; qualquer outra coisa → a empresa aberta agora');
        fd['ml:conta'] = OUTRA; fd['erp:omie'] = { appKey: 'KEY-A-00000', appSecret: 'SEC-A-00000' };
        I.ctx.SHC.omiePuxar = async () => [{ sku: 'OMIE-01', custo: 7 }];
        await new Promise(r => setTimeout(r, 1600));
        const ro = await I.envia({ acao: 'sincronizar_custos', erp: 'omie', empresa: '' });
        ok(ro && ro.ok && fd['c|sku|OMIE-01'] && fd['c|sku|OMIE-01'].custo === 7 && !fd['c|sku@' + OUTRA + '|OMIE-01'], 'importação pedida pela tela com a empresa do clique: grava nela mesmo com a outra aberta');
    }

    // Nenhuma tela lê custos, cfg ou ERP cru (sem a camada da empresa): as leituras que a revisão achou não voltam.
    {
        const fs = require('fs'), path = require('path'), EXT = path.join(__dirname, '../../extension-copiloto');
        const cru = [];
        fs.readdirSync(EXT).filter(a => /\.js$/.test(a) && a !== 'store.js').forEach(a => {
            const t = fs.readFileSync(path.join(EXT, a), 'utf8');
            if (/chrome\.storage\.local\.get\(null\)/.test(t)) cru.push(a + ': get(null)');
            if (/chrome\.storage\.local\.remove\(SHC\.(TINY|OMIE|BLING)_CHAVE/.test(t)) cru.push(a + ': remove do ERP');
            if (/mud\.cfg\.newValue\s*\|\|\s*\{\}\)\s*;?\s*repinta/.test(t) || /Object\.assign\(\{\}, SHC\.PADRAO, mud\.cfg/.test(t)) cru.push(a + ': cfg cru');
        });
        ok(!cru.length, 'nenhuma leitura crua de custos/cfg/ERP fora do store.js' + (cru.length ? ' (' + cru.join('; ') + ')' : ''));
    }

    console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nTUDO OK');
    process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
