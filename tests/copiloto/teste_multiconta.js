// Multi-empresa (auditoria de 07/10/2026): o mesmo Chrome com várias contas do ML (empresas diferentes) nunca mistura os dados.
// (a) contaSegue: só diz "trocou" com prova (a página diz o dono e é outro); (b) marcaReler: os meses lidos depois da troca voltam para a fila;
// (c) sincronização em que o login muda no meio: as etapas seguintes param com 'outra_conta' e nada é gravado em nome da conta nova;
// (d) aviso de certificado sem a conta da página só vale com 1 conta no Chrome;
// (e) conta marcada como "outra empresa": custos por SKU, imposto/margem/despesas e ERP só dela (store.js, SHC.empresaSeparada).
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
        ['ml:cobrancas:' + A]: { mesesLidos: ['2026-08', '2026-09'], lidoEm: { '2026-08': '2026-09-05', '2026-09': hojeBr }, releer: [] },
        ['vbAnuncio:' + A]: { meses: { '2026-08': { completo: true, lidoTs: agora - 30 * 864e5 }, '2026-09': { completo: true, lidoTs: agora } }, mesesLidos: ['2026-08', '2026-09'] },
    } });
    await G.ctx.marcaReler(A, agora - 60e3);
    const mc = G.dados['ml:cobrancas:' + A], va = G.dados['vbAnuncio:' + A];
    ok(JSON.stringify(mc.releer) === '["2026-09"]' && mc.mesesLidos.length === 2, 'Faturamento: só o mês lido agora vai para releer (o fechado antes fica)');
    ok(va.meses['2026-09'].completo === false && va.meses['2026-08'].completo === true && JSON.stringify(va.mesesLidos) === '["2026-08"]', 'vendas por anúncio: o mês lido agora deixa de contar como lido');
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
        ok(c.imposto_pct === 0 && c.margem_alvo_pct === 10 && c.empresa === OUTRA && c.empresaSemNumeros === true, 'e não herda o imposto nem a margem da outra (padrões + aviso "sem números")');
        ok(await S.lerChave('erp:tiny') === null, 'nem a credencial do ERP da outra');
        await S.salvarCustoSku('KIT-01', { custo: 25 });
        await S.salvarCfg({ imposto_pct: 11.5 });
        await S.gravarChave('erp:tiny', { token: 'TOKEN-B' });
        ok(mem['c|sku|KIT-01'].custo === 10 && mem['c|sku@' + OUTRA + '|KIT-01'].custo === 25, 'gravou na chave dela; o custo da primeira empresa ficou intacto');
        ok(mem.cfg.imposto_pct === 6 && mem.cfg.porConta[OUTRA].imposto_pct === 11.5, 'imposto dela em cfg.porConta; o da primeira empresa intacto');
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
    }

    console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nTUDO OK');
    process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
