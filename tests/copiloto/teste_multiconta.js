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
