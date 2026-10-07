// Multi-empresa (auditoria de 07/10/2026): o mesmo Chrome com várias contas do ML (empresas diferentes) nunca mistura os dados.
// (a) contaSegue: só diz "trocou" com prova (a página diz o dono e é outro); (b) marcaReler: os meses lidos depois da troca voltam para a fila;
// (c) sincronização em que o login muda no meio: as etapas seguintes param com 'outra_conta' e nada é gravado em nome da conta nova;
// (d) aviso de certificado sem a conta da página só vale com 1 conta no Chrome;
// (e) conta marcada como "outra empresa": custos por SKU, imposto/margem/despesas e ERP só dela (store.js, SHC.empresaSeparada).
// (f) revisão de 07/10/2026: "Esquecer" o ERP numa empresa não apaga o da outra; configurado é da empresa; a importação do ERP grava na
//     empresa do COMEÇO mesmo se o ML trocar de conta no meio; nenhuma tela lê custos/cfg/ERP cru (sem a camada da empresa).
// Bloqueio 5 (rastreio de 07/10/2026): (g) troca no meio de uma etapa / dentro do minuto guardado / na leitura de Anúncios; (h) histórico;
// (i) retomada; (j) leitura avulsa; (k) número do ícone; (l) "Todas as contas" por empresa; (m) Tiny do painel lateral; (n) etiqueta numa
// aba do ML já aberta; (o) as correções que já existiam continuam protegidas (o teste falha se cada uma for desfeita).
// Rodar: node tests/copiloto/teste_multiconta.js
'use strict';
require('./relogio').fixar();
const montaFundo = require('./fundo_falso'), { B, paginaAnuncios, html } = montaFundo;
// Ordem das etapas da sincronização (SHC.SYNC_ETAPAS do fundo).
const SHC_ETAPAS = F => F.ctx.SHC.SYNC_ETAPAS.map(e => e.id);
// O código de verdade de uma tela, tirado do arquivo: de src[ini] até a chave que fecha o 1º bloco (pula textos entre aspas). → texto | ''.
function trecho(src, ini) {
    if (!(ini >= 0)) return '';
    for (let k = src.indexOf('{', ini), prof = 0; k >= 0 && k < src.length; k++) {
        const c = src[k];
        if (c === "'" || c === '"' || c === '`') { for (k++; k < src.length && src[k] !== c; k++) if (src[k] === '\\') k++; continue; }
        if (c === '{') prof++;
        else if (c === '}' && --prof === 0) return src.slice(ini, k + 1);
    }
    return '';
}
// ml-tela.js (a parte do navegador: etiquetas na página do ML) num vm com um DOM mínimo de mentira. op = { dados, url, script (texto do
// __NORDIC_RENDERING_CTX__) }. querySelector de um elemento devolve sempre o mesmo filho por seletor (o '.outra' do aviso, o '.pop input').
function montaTela(op) {
    const fs = require('fs'), path = require('path'), vm = require('vm'), EXT = path.join(__dirname, '../../extension-copiloto');
    const mem = op.dados, cp = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v))), ouvStorage = [], enviados = [], criados = [];
    const novo = tag => {
        const e = { tagName: String(tag || 'div').toUpperCase(), style: {}, dataset: {}, attrs: {}, filhos: [], ouv: {}, textContent: '', value: '', hidden: false, isConnected: true,
            offsetWidth: 0, offsetHeight: 0, parentElement: null, nextElementSibling: null, memo: new Map(),
            classList: { s: new Set(), add(...c) { c.forEach(x => this.s.add(x)); }, remove(...c) { c.forEach(x => this.s.delete(x)); }, toggle(c, f) { if (f === undefined ? !this.s.has(c) : f) this.s.add(c); else this.s.delete(c); }, contains(c) { return this.s.has(c); } },
            setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }, removeAttribute(k) { delete this.attrs[k]; },
            appendChild(c) { this.filhos.push(c); c.parentElement = this; return c; }, append(...c) { c.forEach(x => this.appendChild(x)); }, prepend(c) { this.filhos.unshift(c); }, insertBefore(c) { this.filhos.push(c); return c; },
            insertAdjacentElement(p, c) { return c; }, remove() { this.isConnected = false; },
            addEventListener(t, f) { (this.ouv[t] = this.ouv[t] || []).push(f); }, removeEventListener() {},
            querySelector(sel) { if (!this.memo.has(sel)) this.memo.set(sel, novo('div')); return this.memo.get(sel); }, querySelectorAll() { return []; },
            closest() { return null; }, contains() { return false; }, getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }, getClientRects() { return []; },
            focus() {}, blur() {}, attachShadow() { return novo('#shadow'); }, get childElementCount() { return this.filhos.length; }, get children() { return this.filhos; } };
        Object.defineProperty(e, 'innerHTML', { get() { return ''; }, set() {} });
        criados.push(e);
        return e;
    };
    const linha = novo('div');   // a linha do anúncio na lista do ML (SHC.telaLinhaAnuncio)
    const document = { body: novo('body'), documentElement: novo('html'), readyState: 'complete', createElement: novo, createTextNode: t => ({ textContent: t }),
        getElementById: id => (id === '__NORDIC_RENDERING_CTX__' ? { textContent: op.script } : null),
        querySelector: sel => (/sll-list-grid-row--/.test(sel) ? linha : null), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
    const chrome = { runtime: { id: 'ext', sendMessage: async m => { enviados.push(m); return {}; } },
        storage: { local: {
            get: async k => { const o = {}; (k === null ? Object.keys(mem) : [].concat(k)).forEach(x => { if (x in mem) o[x] = cp(mem[x]); }); return o; },
            set: async o => { Object.keys(o).forEach(x => { mem[x] = cp(o[x]); }); },
            remove: async k => { [].concat(k).forEach(x => delete mem[x]); } },
            onChanged: { addListener: f => ouvStorage.push(f), removeListener() {} } } };
    const ctx = { console, chrome, document, location: { href: op.url, assign() {} }, performance: { now: () => Date.now(), timeOrigin: Date.now() }, innerWidth: 1200, innerHeight: 800,
        MutationObserver: class { observe() {} disconnect() {} }, setTimeout, clearTimeout, fetch: async () => ({ ok: false }), addEventListener() {}, removeEventListener() {}, URL };
    ctx.window = ctx; ctx.globalThis = ctx;
    vm.createContext(ctx);
    ['calc.js', 'store.js', 'ml-extrator.js', 'ml-tela.js'].forEach(a => vm.runInContext(fs.readFileSync(path.join(EXT, a), 'utf8'), ctx, { filename: a }));
    const sr = () => criados.find(e => e.tagName === '#SHADOW'), aviso = () => (sr() ? sr().querySelector('.outra') : null);
    return { criados, enviados, mem, aviso,
        espera: ms => new Promise(r => setTimeout(r, ms || 300)),
        trocaConta: c => { const v = mem['ml:conta']; mem['ml:conta'] = c; ouvStorage.forEach(f => f({ 'ml:conta': { oldValue: v, newValue: c } }, 'local')); },
        // "＋ Informar custo" da etiqueta → digita o valor → "Salvar" (o popover do host). → o texto de erro do popover ('' = salvou).
        salva: async (bt, valor) => {
            (bt.ouv.click || []).forEach(f => f({ preventDefault() {}, stopPropagation() {} }));
            const s = sr();
            s.querySelector('.pop input').value = valor; s.querySelector('.err').textContent = '';
            (s.ouv.click || []).forEach(f => f({ stopPropagation() {}, target: { closest: () => ({ getAttribute: () => 'salvar' }) } }));
            await new Promise(r => setTimeout(r, 300));
            return s.querySelector('.err').textContent;
        } };
}
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
    ok(await F.ctx.confereSessao(A) === '', 'página que não diz o dono: confereSessao → "" (nem troca, nem prova da conta)');
    dono = A;
    ok(await F.ctx.confereSessao(A) === 'mesma', 'página que diz o dono e é a conta: confereSessao → "mesma" (a única prova)');
    dono = '';
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
    let pedidosLista = 0, trocouC = false;
    // Até os anúncios serem lidos e conferidos, a sessão é da conta A; no 1º pedido de outra tela, alguém já entrou na outra empresa.
    const H = montaFundo({ dados, hoje: '2026-10-07', rota: u => {
        if (!/\/anuncios/.test(u) && dados['ml:conta']) trocouC = true;
        if (/\/anuncios\/lista/.test(u)) { pedidosLista++; return { html: paginaAnuncios([{ itemId: 'MLB1000000001', frete: 20 }], trocouC ? OUTRA : A) }; }
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
    // Bloqueio 5: 1 conta conhecida, mas a sessão do ML aberta é de OUTRA empresa (ainda não sincronizou): o aviso sem conta não marca a A.
    const C3 = montaFundo({ dados: { 'ml:conta': A, 'ml:contas': { [A]: { visto: 1 } } }, rota: u => (/\/anuncios\/lista/.test(u) ? { html: paginaAnuncios([{ itemId: 'MLB2000000002', frete: 20 }], OUTRA) } : null) });
    const r4 = await C3.envia({ acao: 'certificado', titulo: 'Certificado digital vencido', texto: 'Seu certificado digital venceu.' }, ABA);
    ok(r4 && r4.ok === false && r4.motivo === 'conta' && !C3.dados['cert:' + A], '1 conta no Chrome e o ML aberto em outra empresa: o aviso sem conta é descartado (1 GET confere a sessão)');

    console.log('g) bloqueio 5: troca de login no meio de uma etapa ou dentro do minuto guardado — nada da outra empresa fica nas chaves da A');
    {   // g1: a sessão vira a da OUTRA no pedido do pós-venda (meio da etapa, 60 s depois da última conferência ainda não passaram)
        const dados = { ['posvenda:' + A]: { reclamacoes: 1, mensagens: 0, devolucoes: 0, ts: 1 } };
        let trocou = false;
        const F = montaFundo({ dados, hoje: '2026-10-07', rota: u => {
            if (/\/anuncios\/lista/.test(u)) return { html: paginaAnuncios([{ itemId: 'MLB1000000001', frete: 20 }], trocou ? OUTRA : A) };
            if (/post-purchase/.test(u)) { trocou = true; return { html: html({ x: [{ value: 'problems-to-manage', text: 'Reclamações', badge: { label: '7' } }] }) }; }
            return null;
        } });
        await F.ctx.sincronizar('manual');
        const st = dados['shc:status'] || {}, et = st.etapas || {}, ids = SHC_ETAPAS(F), depois = ids.slice(ids.indexOf('posvenda'));
        ok(dados['posvenda:' + A] && dados['posvenda:' + A].reclamacoes === 1, 'pós-venda lido com a sessão da OUTRA não fica em posvenda:A (continua o de antes: 1 reclamação)');
        ok(!JSON.stringify(dados['shc:anomalias:' + A] || {}).includes('7 reclamações') && !JSON.stringify(dados['shc:anomalias'] || {}).includes('7 reclamações'), 'e não vira alerta falso na A');
        ok(st.erro === 'outra_conta' && depois.every(k => et[k] && et[k].estado === 'erro' && /mudou de conta/.test(et[k].erro || '')),
            'a etapa da troca e as seguintes saem com "mudou de conta" (nenhuma "ok")');
    }
    {   // g1b (2ª revisão): o diário só desfaz os retratos da leitura do ML; o clique da seller e o TikTok gravados na mesma janela ficam
        const dados = { ['posvenda:' + A]: { reclamacoes: 1, mensagens: 0, devolucoes: 0, ts: 1 }, ['medidas:' + A]: { porItem: {} }, ['resumo:' + A + ':semanal']: { novo: true } };
        let trocou = false, F = null;
        F = montaFundo({ dados, hoje: '2026-10-07', rota: u => {
            if (/\/anuncios\/lista/.test(u)) return { html: paginaAnuncios([{ itemId: 'MLB1000000001', frete: 20 }], trocou ? OUTRA : A) };
            if (/post-purchase/.test(u)) {
                trocou = true;
                // na janela da etapa: a seller marca a medida e o resumo como visto; uma captura do TikTok chega
                F.ctx.chrome.storage.local.set({ ['medidas:' + A]: { porItem: { MLB1000000001: { marca: 'fui_eu' } } }, ['resumo:' + A + ':semanal']: { novo: false }, 'tt:7000000001:saldo': { v: 10 } });
                return { html: html({ x: [{ value: 'problems-to-manage', text: 'Reclamações', badge: { label: '7' } }] }) };
            }
            return null;
        } });
        await F.ctx.sincronizar('manual');
        ok(dados['posvenda:' + A].reclamacoes === 1 && JSON.stringify(dados['medidas:' + A]) === '{"porItem":{"MLB1000000001":{"marca":"fui_eu"}}}'
            && dados['resumo:' + A + ':semanal'].novo === false && dados['tt:7000000001:saldo'] && dados['tt:7000000001:saldo'].v === 10,
            'troca no meio da etapa: o retrato do ML volta (posvenda:A), mas a marca da medida, o resumo visto e o TikTok gravados na janela ficam');
    }
    {   // g2: troca no meio da etapa Alertas (no pedido do Resumo): resumo, perguntas e alertas da OUTRA não ficam na A
        const resumoB = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'fixtures/resumo_content_exemplo.json'), 'utf8'));
        const dados = {};
        let trocou = false;
        const F = montaFundo({ dados, hoje: '2026-10-07', rota: u => {
            if (/\/resumo\/api\/content/.test(u)) { trocou = true; return { json: resumoB }; }
            if (/\/anuncios\/lista/.test(u)) return { html: paginaAnuncios([{ itemId: 'MLB1000000001', frete: 20 }], trocou ? OUTRA : A) };
            return null;
        } });
        await F.ctx.sincronizar('manual');
        const st = dados['shc:status'] || {};
        ok(!dados['resumo:' + A] && !dados['perguntas:' + A] && !dados['shc:anomalias:' + A] && !dados['shc:anomalias'], 'resumo, perguntas e alertas lidos com a sessão da OUTRA: nada gravado na A');
        ok(st.etapas.alertas.estado === 'erro' && /mudou de conta/.test(st.etapas.alertas.erro || '') && st.erro === 'outra_conta', 'etapa Alertas com erro "mudou de conta"');
    }
    {   // g3: troca entre Vendas brutas e Faturamento (dentro do minuto guardado): as cobranças da OUTRA nunca ficam em cob:A
        const cob = (id, dia) => ({ detail_1: 'Tarifa de envio (Por sua conta)', date: dia.slice(8, 10) + '/' + dia.slice(5, 7) + '/2026', amount: { value: { fraction: '-10', cents: '00' } },
            modalTrigger: { entityId: id, conceptId: 'c', type: 'X', documentCloseDate: '2026-10-04' }, permalink: 'MLB-1000000001', detail_2: 'Venda #2000000001' });
        const dados = {}, q = { dono: A, troca: true };
        const mk = () => montaFundo({ dados, rota: u => {
            if (/\/anuncios\/lista/.test(u)) return { html: paginaAnuncios([{ itemId: 'MLB1000000001', frete: 20 }], q.dono) };
            if (/charges-summary/.test(u)) {
                if (q.troca) q.dono = OUTRA;
                const de = /fromDateCustom=(\d{4}-\d{2}-\d{2})/.exec(u)[1], ate = /toDateCustom=(\d{4}-\d{2}-\d{2})/.exec(u)[1], quem = q.dono === OUTRA ? 'O' : 'A';
                return { json: { charges: { data: ['2026-09-10', '2026-09-24', '2026-08-15'].filter(d => d >= de && d <= ate).map((d, k) => cob(quem + '-' + d + '-' + k, d)) } } };
            }
            return null;
        } });
        await mk().ctx.sincronizar('manual');
        const st1 = dados['shc:status'];
        ok(st1.erro === 'outra_conta' && st1.etapas.faturamento.estado === 'erro' && !Object.keys(dados).some(k => /^cob:/.test(k) && JSON.stringify(dados[k]).indexOf('"O-') >= 0),
            '1ª sincronização: o Faturamento lido com a sessão da OUTRA sai com erro e nada dele fica em cob:A');
        q.troca = false; q.dono = A;
        await mk().ctx.sincronizar('manual');
        const ids = ['2026-09', '2026-08'].map(m => ((dados['cob:' + A + ':' + m] || {}).linhas || []).map(c => String(c.id).split('|')[0])).flat();
        ok(dados['shc:status'].estado === 'ok' && ids.length === 3 && ids.every(x => /^A-/.test(x)), '2ª sincronização com a A: só as cobranças dela (' + ids.join(', ') + ')');
    }
    {   // g4: na leitura de Anúncios, a página 2 vem de OUTRO dono → a leitura falha com "outra_conta" e o retrato da A fica como estava
        const L = t => ({ lines: [].concat(t).map(label => ({ label })) });
        const pagina = (itemId, dono, total) => html({ appProps: { pageProps: { u: { sellerId: +dono, nickname: 'LOJA' }, viewData: { grid: { pagination: { total } },
            rows: [{ metadata: { itemId }, product: { title: 'Produto ' + itemId, status: 'Ativo', sku: 'SKU-' + itemId.slice(-2), stock: [{ label: '10 disponíveis' }] },
                price: L('R$ 200,00'), earnings: L('R$ 150,00'), purchaseOptions: L(['Clássico', 'Você oferece frete grátis', 'A pagar R$ 20,00']) }] } } } });
        const antes = { ts: 1, paginas: 2, total: 2, completo: true, itens: [{ itemId: 'MLB1000000001', sku: 'SKU-01' }, { itemId: 'MLB1000000003', sku: 'SKU-03' }] };
        const dados = { 'ml:conta': A, ['ml:anuncios:' + A]: JSON.parse(JSON.stringify(antes)) };
        let pag2 = false;
        const F = montaFundo({ dados, hoje: '2026-10-07', rota: u => {
            if (/\/anuncios\/lista\?page=2/.test(u)) { pag2 = true; return { html: pagina('MLB2000000002', OUTRA, 2) }; }
            if (/\/anuncios\/lista/.test(u)) return { html: pagina(pag2 ? 'MLB2000000002' : 'MLB1000000001', pag2 ? OUTRA : A, 2) };
            return null;
        } });
        await F.ctx.sincronizar('manual');
        const st = dados['shc:status'] || {}, it = (dados['ml:anuncios:' + A].itens || []).map(i => i.itemId);
        ok(JSON.stringify(it) === '["MLB1000000001","MLB1000000003"]' && !Object.keys(dados).some(k => JSON.stringify(dados[k]).indexOf('MLB2000000002') >= 0 && !/^shc:/.test(k)),
            'retrato da A como antes: não perdeu o MLB1000000003 nem ganhou o anúncio da OUTRA (' + it.join(', ') + ')');
        ok(st.etapas.anuncios.estado === 'erro' && /mudou de conta/.test(st.etapas.anuncios.erro || '') && st.erro === 'outra_conta', 'etapa Anúncios com erro "mudou de conta" (não "ok")');
        const S0 = F.ctx.SHC, pg = (id, dono) => ({ dados: S0.mlPaginaAnuncios(S0.mlExtraiEstado(pagina(id, dono, 3))), via: 'fundo' });
        const lc = await S0.mlLeituraCompleta({ ler: async n => (n === 1 ? pg('MLB1000000001', A) : n === 2 ? pg('MLB1000000003', A) : pg('MLB2000000002', OUTRA)), abrir: async () => null });
        ok(lc.falha === 'outra_conta' && !lc.itens, 'SHC.mlLeituraCompleta: página 3 de outro dono → {falha:"outra_conta"}, sem juntar nada');
    }
    {   // g5: os pausados (OMNI_INACTIVE, sem conferência por página) vêm da OUTRA → a conferência forçada no fim dos Anúncios desfaz tudo
        const dados = { 'ml:conta': A, ['ml:anuncios:' + A]: { ts: 1, paginas: 1, total: 1, completo: true, itens: [{ itemId: 'MLB1000000001' }] } };
        let trocou = false;
        const F = montaFundo({ dados, hoje: '2026-10-07', rota: u => {
            if (/OMNI_INACTIVE/.test(u)) { trocou = true; return { html: paginaAnuncios([{ itemId: 'MLB2000000005', frete: 30 }], OUTRA) }; }
            if (/\/anuncios\/lista/.test(u)) return { html: paginaAnuncios([{ itemId: 'MLB1000000001', frete: 20 }], trocou ? OUTRA : A) };
            return null;
        } });
        await F.ctx.sincronizar('manual');
        const st = dados['shc:status'] || {};
        ok(dados['ml:anuncios:' + A].ts === 1 && !Object.keys(dados).some(k => !/^shc:/.test(k) && (k.indexOf('MLB2000000005') >= 0 || JSON.stringify(dados[k]).indexOf('MLB2000000005') >= 0)),
            'pausado da OUTRA (lido depois da troca) não entra no retrato da A: o que a etapa gravou foi desfeito');
        ok(dados['ml:conta'] === A && st.etapas.anuncios.estado === 'erro' && st.erro === 'outra_conta', 'a conta aberta continua a A e a etapa Anúncios sai com erro');
    }
    {   // g6 (revisão 07/10): a conferência depois do Full recebe a lista SEM o dono (verificação de segurança, tela intermediária) e a da etapa
        // seguinte já vem da OUTRA. Página sem dono não prova a conta: o que o Full gravou com a sessão da OUTRA sai e o Full não fica "ok".
        const fullAntes = { ts: 1, produtos: [{ id: 'DA-A' }] }, cobAntes = { mesesLidos: ['2026-04'], lidoEm: { '2026-04': '2026-05-02' }, releer: [] };
        const mk = (dados, s) => {
            const F = montaFundo({ dados, hoje: '2026-10-07', rota: u => {
                if (/\/anuncios\/lista/.test(u)) return s.modo === 'sem' ? { html: '<html><body>Confirme que é você</body></html>' } : { html: paginaAnuncios([{ itemId: 'MLB1000000001', frete: 20 }], s.modo === 'B' ? OUTRA : A) };
                return null;
            } });
            const S = F.ctx.SHC;
            F.ctx.sincronizarVendasBrutas = async () => ({ meses: 0, dias: 0 });
            F.ctx.sincronizarCobrancas = async () => ({ meses: 0, lidas: 0, pedidos: 0, incompletos: [], naoLidos: [] });
            const leMes = async (conta, m) => {   // o mês do Faturamento lido agora (lidoEm = hoje), como o sincronizarCobrancas grava
                const k = 'ml:cobrancas:' + conta, mc = (await S.lerChave(k)) || { mesesLidos: [], lidoEm: {}, releer: [] };
                await S.gravarChave(k, Object.assign({}, mc, { mesesLidos: (mc.mesesLidos || []).concat(m), lidoEm: Object.assign({}, mc.lidoEm, { [m]: S.hoje() }) }));
            };
            return { F, S, leMes };
        };
        let dados = { 'ml:conta': A, ['full:' + A]: fullAntes, ['ml:cobrancas:' + A]: cobAntes };
        let s = { modo: 'A' }, x = mk(dados, s);
        x.F.ctx.sincronizarFullERemessas = async conta => {
            s.modo = 'sem';   // a pessoa entrou na outra empresa: a lista ainda não diz o dono
            await x.S.gravarChave('full:' + conta, { ts: Date.now(), produtos: [{ id: 'DA-OUTRA' }] });
            await x.leMes(conta, '2026-05');
            await x.S.gravarChave('fech:' + conta + ':2026-05', { mes: '2026-05', total: 999 });
            return { temFull: true, produtos: [] };
        };
        x.F.ctx.sincronizarAds = async () => { s.modo = 'B'; return { semAba: true }; };
        await x.F.ctx.sincronizar('manual');
        let st = dados['shc:status'] || {}, mc = dados['ml:cobrancas:' + A] || {};
        ok(JSON.stringify(dados['full:' + A]) === JSON.stringify(fullAntes) && !dados['fech:' + A + ':2026-05'], 'full:A volta ao que era e o fechamento lido com a sessão da OUTRA não fica na A');
        ok(mc.mesesLidos.indexOf('2026-05') < 0 || (mc.releer || []).indexOf('2026-05') >= 0, 'o mês lido com a sessão da OUTRA não fica como lido (ou volta para a fila)');
        ok(st.erro === 'outra_conta' && st.etapas.full.estado === 'erro' && /mudou de conta/.test(st.etapas.full.erro || '') && !st.fullEm,
            'a etapa Full (sem prova da conta depois dela) sai com "mudou de conta", não "ok", e o status não diz "Full lido agora"');
        // g6b: marcaReler fica FORA do diário — o mês lido nesta rodada ANTES da última prova volta para a fila (o desfazDiario do fim o desfazia).
        dados = { 'ml:conta': A, ['ml:cobrancas:' + A]: cobAntes };
        s = { modo: 'A' }; x = mk(dados, s);
        x.F.ctx.sincronizarVendasBrutas = async conta => { await x.leMes(conta, '2026-06'); return { meses: 1, dias: 30 }; };   // conferida depois: A
        x.F.ctx.sincronizarFullERemessas = async () => { s.modo = 'B'; return { temFull: true, produtos: [] }; };
        await x.F.ctx.sincronizar('manual');
        st = dados['shc:status'] || {}; mc = dados['ml:cobrancas:' + A] || {};
        ok(st.erro === 'outra_conta' && st.etapas.vendasBrutas.estado === 'ok' && (mc.releer || []).indexOf('2026-06') >= 0 && (mc.releer || []).indexOf('2026-04') < 0,
            'troca vista no Full: o mês lido nesta rodada vai para releer e fica lá (' + JSON.stringify(mc.releer) + '); o lido em maio não');
    }

    console.log('h) bloqueio 5: histórico em segundo plano com a troca no último minuto');
    {
        let dono = A;
        const dados = { 'ml:conta': A, 'ml:contas': { [A]: { visto: 1 } }, ['ml:cobrancas:' + A]: { mesesLidos: [], lidoEm: {}, releer: [], incompletos: [] } };
        const F = montaFundo({ dados, rota: u => (/\/anuncios\/lista/.test(u) ? { html: paginaAnuncios([{ itemId: 'MLB1000000001', frete: 20 }], dono) } : null) });
        F.ctx.sincronizarCobrancas = async (conta, anda) => {
            await anda({}, {});                 // conferência de verdade (guardado vazio): A
            dono = OUTRA;                        // alguém entra na outra empresa
            await anda({}, { meses: { '2026-05': 'ok' } });   // dentro do minuto guardado: a conferência não vê
            const S = F.ctx.SHC, k = 'ml:cobrancas:' + conta, mc = await S.lerChave(k);
            await S.gravarChave(k, Object.assign({}, mc, { mesesLidos: ['2026-05'], lidoEm: { '2026-05': S.hoje() } }));
            await S.gravarChave('fech:' + conta + ':2026-05', { mes: '2026-05', total: 999, porDia: { '2026-05-10': 999 } });   // o mês fechado da OUTRA
            return { meses: 1 };
        };
        F.ctx.sincronizarVendasAnuncio = async () => ({}); F.ctx.sincronizarNfe = async () => ({}); F.ctx.gravarRateio = async () => {};
        const h = await F.ctx.lerHistorico();
        const mc = dados['ml:cobrancas:' + A];
        ok(h && h.lido && h.lido.erro === 'outra_conta', 'a conferência forçada no fim do histórico vê a troca (lido.erro = outra_conta)');
        ok(mc.mesesLidos.indexOf('2026-05') < 0 && !dados['fech:' + A + ':2026-05'], 'o mês lido com a sessão da OUTRA volta para a fila: não conta como lido e o fechamento dele não fica na A');
    }

    console.log('i) bloqueio 5: retomada de um ciclo que caiu no MEIO dos Anúncios (conta do ciclo ainda vazia) com outra conta aberta');
    {
        const L = t => ({ lines: [].concat(t).map(label => ({ label })) });
        const pagina = (itemId, dono, total) => html({ appProps: { pageProps: { u: { sellerId: +dono, nickname: 'LOJA' }, viewData: { grid: { pagination: { total } },
            rows: [{ metadata: { itemId }, product: { title: 'P ' + itemId, status: 'Ativo', sku: '', stock: [{ label: '10 disponíveis' }] },
                price: L('R$ 200,00'), earnings: L('R$ 150,00'), purchaseOptions: L(['Clássico', 'Você oferece frete grátis', 'A pagar R$ 20,00']) }] } } } });
        const agora = Date.now(), cid = 'c1', F0 = montaFundo({ rota: () => null });
        const pag1A = F0.ctx.SHC.mlPaginaAnuncios(F0.ctx.SHC.mlExtraiEstado(pagina('MLB1000000001', A, 2)));
        const dados = { 'shc:status': { estado: 'interrompida', inicio: agora - 60e3, etapas: {} },
            'shc:ciclo': { id: cid, conta: null, inicio: agora - 60e3, feitas: {}, retomadas: 0, chaves: ['shc:ret:' + cid + ':anuncios:p|1'] },
            ['shc:ret:' + cid + ':anuncios:p|1']: { v: { dados: pag1A, via: 'fundo' } } };
        const F = montaFundo({ dados, rota: u => (/\/anuncios\/lista/.test(u) ? { html: pagina('MLB2000000002', OUTRA, 1) } : null) });
        const st = await F.ctx.sincronizar('retomada');
        ok(!dados['ml:anuncios:' + A] && !Object.keys(dados).some(k => k !== 'ml:anuncios:' + OUTRA && JSON.stringify(dados[k]).indexOf('MLB2000000002') >= 0 && JSON.stringify(dados[k]).indexOf('MLB1000000001') >= 0),
            'a página guardada da conta antiga não se mistura com as da conta aberta');
        ok(st.erro !== 'outra_conta' && dados['ml:conta'] === OUTRA && JSON.stringify((dados['ml:anuncios:' + OUTRA].itens || []).map(i => i.itemId)) === '["MLB2000000002"]'
            && !dados['shc:ret:' + cid + ':anuncios:p|1'], 'recomeça do zero com a conta aberta (ciclo novo, sem a página antiga)');
    }

    console.log('j) bloqueio 5: leitura avulsa (fiscal agora) confere de novo antes de gravar');
    {
        const mkF = (donoPag, depois) => {
            const s = { dono: A };
            const dados = { 'ml:conta': A };
            const F = montaFundo({ dados, hoje: '2026-10-07', rota: u => {
                if (/\/anuncios\/lista/.test(u)) return { html: paginaAnuncios([{ itemId: 'MLB1000000001', frete: 20 }], s.dono) };
                if (/\/anuncios\/api\/tasks/.test(u)) { if (depois) s.dono = OUTRA; return { json: { tasks: [{ id: 'GROUPED_WITHOUT_FISCAL_DATA', cases: 1, title: 't', message: 'm', action: { type: 'filter', filters: 'WITHOUT_FISCAL_DATA' } }] } }; }
                if (/WITHOUT_FISCAL_DATA/.test(u)) return { html: paginaAnuncios([{ itemId: 'MLB2000000002', frete: 20 }], donoPag(s)) };
                return null;
            } });
            return { F, dados };
        };
        let x = mkF(s => s.dono, true);
        let r = await x.F.envia({ acao: 'fiscal_agora' });
        ok(r && r.ok === false && r.motivo === 'outra_conta' && !x.dados['fiscal:' + A], 'troca logo depois da 1ª conferência, página que diz o dono (OUTRA): nada em fiscal:A');
        x = mkF(() => '', true);
        r = await x.F.envia({ acao: 'fiscal_agora' });
        ok(r && r.ok === false && r.motivo === 'outra_conta' && !x.dados['fiscal:' + A], 'página que não diz o dono: a conferência antes de gravar vê a troca; nada em fiscal:A');
        x = mkF(s => s.dono, false);
        r = await x.F.envia({ acao: 'fiscal_agora' });
        ok(r && r.ok === true && x.dados['fiscal:' + A] && x.dados['fiscal:' + A].itens[0] === 'MLB2000000002', 'controle: mesma conta → grava (o teste enxerga a gravação)');
        // Revisão 07/10: vendas brutas do mês ("Tentar agora") e repasse do Mercado Pago — a sessão vira a da OUTRA logo DEPOIS da 1ª conferência.
        const MPH = '<html><body><div>22 de setembro</div><div>10:30</div><div>Venda no Mercado Livre</div><div>Produto teste</div><div>Transação 1234567890</div><div>Aprovado</div><div>+ R$ 249,29</div></body></html>';
        const mkA = troca => {
            const s = { dono: A }, dados = { 'ml:conta': A };
            const F = montaFundo({ dados, hoje: '2026-10-07', rota: u => {
                if (/\/anuncios\/lista/.test(u)) return { html: paginaAnuncios([{ itemId: 'MLB1000000001', frete: 20 }], s.dono) };
                if (/performance-data/.test(u)) { if (troca) s.dono = OUTRA; return { json: { dataset: [{ date: '2026-09-01', gross_sales: 999, sold_units: 1, sell_quantity: 1 }] } }; }
                if (/mercadopago\.com\.br\/activities/.test(u)) { if (troca) s.dono = OUTRA; return { html: /page=1$/.test(u) ? MPH : '<html></html>' }; }
                return null;
            } });
            F.ctx.chrome.permissions.contains = async () => true;
            return { F, dados };
        };
        x = mkA(true);
        r = await x.F.envia({ acao: 'vendas_brutas_mes', mes: '2026-09' });
        const mesesVb = (((x.dados['shc:status'] || {}).etapas || {}).vendasBrutas || {}).meses || {};
        ok(r && r.ok === false && r.motivo === 'outra_conta' && !x.dados['vb:' + A] && !mesesVb['2026-09'], '"Tentar agora" das vendas brutas com a troca logo depois da conferência: nada em vb:A (nem o diagnóstico "ok")');
        x = mkA(false);
        r = await x.F.envia({ acao: 'vendas_brutas_mes', mes: '2026-09' });
        ok(r && r.ok === true && x.dados['vb:' + A], 'controle: mesma conta → vb:A gravado');
        x = mkA(true);
        r = await x.F.envia({ acao: 'sincronizar_repasse' });
        ok(r && r.ok === false && r.motivo === 'outra_conta' && !x.dados['mp:repasse:' + A] && !(x.dados['shc:status'] || {}).repasseEm, 'repasse do Mercado Pago com a troca durante a leitura: nada em mp:repasse:A');
        x = mkA(false);
        r = await x.F.envia({ acao: 'sincronizar_repasse' });
        ok(r && r.ok === true && x.dados['mp:repasse:' + A] && x.dados['mp:repasse:' + A].meses['2026-09'], 'controle: mesma conta → mp:repasse:A gravado');
        // Certificado: a conta conferida é a gravada — ml:conta trocada entre a conferência e a gravação (a sincronização da OUTRA) não leva o aviso para cert:<OUTRA>.
        const cert = { acao: 'certificado', titulo: 'Certificado digital vencido', texto: 'Seu certificado digital venceu.' };
        // ml:conta vira a OUTRA logo depois da conferência: com a conta da página, depois da 1ª leitura de ml:conta; sem ela, depois do GET que confere a sessão.
        for (const [nome, contas, msg] of [['com a conta da página', { [A]: { visto: 2 }, [OUTRA]: { visto: 1 } }, Object.assign({ conta: { sellerId: A } }, cert)], ['sem a conta da página (1 conta)', { [A]: { visto: 1 } }, cert]]) {
            let virou = false;
            const C = montaFundo({ dados: { 'ml:conta': A, 'ml:contas': contas }, rota: u => { if (!/\/anuncios\/lista/.test(u)) return null; virou = true; return { html: paginaAnuncios([{ itemId: 'MLB1000000001', frete: 20 }], A) }; } });
            const orig = C.ctx.SHC.contaAtual;
            C.ctx.SHC.contaAtual = async () => { const c = virou ? OUTRA : A; if (msg.conta) virou = true; return c; };
            const rc = await C.envia(msg, ABA);
            C.ctx.SHC.contaAtual = orig;
            ok(rc && rc.ok !== false && C.dados['cert:' + A] && !C.dados['cert:' + OUTRA], 'certificado ' + nome + ': grava na conta conferida (cert:A), nunca em cert:<OUTRA>');
        }
    }

    console.log('k) bloqueio 5: o número do ícone é o da conta aberta');
    {
        const anomA = { ts: 1, conta: A, total: 5, porTipo: { perguntas: 5 }, vermelho: false, itens: [] }, anomB = { ts: 2, conta: OUTRA, total: 2, porTipo: { perguntas: 2 }, vermelho: false, itens: [] };
        // fundo com storage.onChanged (o fundo_falso não tem): o ouvinte registrado na carga fica em __mudou.
        const bg = 'chrome.storage.onChanged = { addListener: f => { (globalThis.__mudou = globalThis.__mudou || []).push(f); } };\n' + require('fs').readFileSync(require('path').join(__dirname, '../../extension-copiloto/background.js'), 'utf8');
        const F = montaFundo({ background: bg, dados: { 'ml:conta': OUTRA, cfg: {}, 'shc:anomalias': anomA, ['shc:anomalias:' + A]: anomA, ['shc:anomalias:' + OUTRA]: anomB } });
        await F.tique(5);
        await F.ctx.seloAgora(); await F.tique(10);
        ok(F.selos[F.selos.length - 1] === '2', 'aberta a OUTRA e o shc:anomalias guardado ainda da A: o ícone mostra o número da OUTRA (2), não o 5 da A');
        delete F.dados['shc:anomalias:' + OUTRA];
        await F.ctx.seloAgora(); await F.tique(10);
        ok(F.selos[F.selos.length - 1] === '', 'sem alertas lidos da conta aberta: ícone limpo');
        F.dados['shc:anomalias:' + OUTRA] = anomB;
        F.dados['perguntas:' + A] = { pendentes: 7 };
        await F.ctx.atualizarAlertas(A); await F.tique(10);
        ok(F.dados['shc:anomalias'].conta === A && F.dados['shc:anomalias'].ts === 1 && F.selos[F.selos.length - 1] === '2',
            'alertas da A recalculados com a OUTRA aberta (rodada lenta atrasada): a chave geral e o ícone continuam da OUTRA');
        ok(F.dados['shc:anomalias:' + A].ts > 1, 'e os da A ficam guardados só na chave dela (shc:anomalias:<A>)');
        F.dados['ml:conta'] = A; F.dados['shc:anomalias'] = F.dados['shc:anomalias:' + A] = Object.assign({}, anomA, { ts: 3, total: 9, porTipo: { perguntas: 9 } });
        (F.ctx.__mudou || []).forEach(f => f({ 'ml:conta': { oldValue: OUTRA, newValue: A } }, 'local'));
        await F.tique(20);
        ok(F.selos[F.selos.length - 1] === '9', 'trocou a conta aberta (ml:conta): o ícone refaz com o número da conta nova (9)');
    }

    console.log('n) bloqueio 5: aba do ML já aberta quando a conta do Copiloto (ml:conta) muda');
    {
        const pag = paginaAnuncios([{ itemId: 'MLB1000000001', frete: 20, sku: 'KIT-01' }], A), script = /<script id="__NORDIC_RENDERING_CTX__">([\s\S]*?)<\/script>/.exec(pag)[1];
        const T = montaTela({ dados: { 'ml:conta': A, cfg: { empresaSeparada: { [OUTRA]: true } } }, url: B + '/anuncios/lista', script });
        await T.espera(300);
        const botoes = () => T.criados.filter(e => e.textContent === '＋ Informar custo'), bt = botoes()[0];
        ok(bt && (!T.aviso() || T.aviso().style.display !== 'block'), 'página da A com o Copiloto na A: a etiqueta aparece, sem aviso');
        T.trocaConta(OUTRA);   // a sincronização da OUTRA (outra empresa) gravou ml:conta com esta aba aberta
        await T.espera(300);
        ok(T.aviso() && T.aviso().style.display === 'block' && /final 0001/.test(T.aviso().querySelector('.t').textContent) && botoes().length === 1,
            'a conta da página é conferida de novo: aviso "outra conta" e nenhuma etiqueta nova com os números da OUTRA');
        const erro = await T.salva(bt, '25');
        ok(/outra conta/.test(erro) && !Object.keys(T.mem).some(k => /^c\|/.test(k)), 'custo digitado na etiqueta que já estava na tela: não grava (nem na empresa da OUTRA, nem na da A)');
        T.trocaConta(A);
        await T.espera(300);
        ok(T.aviso().style.display === 'none', 'a conta volta a bater: o aviso some sozinho');
        const erro2 = await T.salva(bt, '25');
        ok(!erro2 && T.mem['c|sku|KIT-01'] && T.mem['c|sku|KIT-01'].custo === 25 && !T.mem['c|sku@' + OUTRA + '|KIT-01'], 'controle: com a conta certa o custo grava na empresa da página (a A)');
    }

    console.log('e) empresa separada: custos por SKU, números da empresa e ERP só da conta marcada');
    {
        const path = require('path'), EXT = path.join(__dirname, '../../extension-copiloto');
        const mem = {}, cp = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v))), ouvStore = [];
        global.chrome = { storage: { local: {
            get: async k => { const o = {}; (k === null ? Object.keys(mem) : [].concat(k)).forEach(x => { if (x in mem) o[x] = cp(mem[x]); }); return o; },
            set: async o => { Object.keys(o).forEach(x => { mem[x] = cp(o[x]); }); },
            remove: async k => { [].concat(k).forEach(x => delete mem[x]); },
        }, onChanged: { addListener: f => ouvStore.push(f) } }, runtime: { sendMessage: async () => ({}) } };
        const S = require(path.join(EXT, 'calc.js'));
        require(path.join(EXT, 'store.js'));
        // O cache da empresa (1,5 s) sai quando ml:conta ou cfg mudam (store.js ouve o chrome.storage.onChanged): o teste avisa a mudança.
        const espera = async () => { await new Promise(r => setImmediate(r)); ouvStore.forEach(f => f({ 'ml:conta': {}, cfg: {} }, 'local')); };
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
        // Bloqueio 5: com a lista de contas preenchida (vazia, qualquer filtro passava): 3 contas, a OUTRA separada.
        mem['ml:conta'] = OUTRA; mem['ml:contas'] = { [A]: { visto: 3 }, '900000003': { visto: 2 }, [OUTRA]: { visto: 1 } }; await espera();
        const idsDe = l => l.map(x => x.sellerId).sort().join(',');
        ok(idsDe(await S.contasDaEmpresa('')) === A + ',900000003' && idsDe(await S.contasDaEmpresa(OUTRA)) === OUTRA && idsDe(await S.contasDaEmpresa()) === OUTRA,
            'contasDaEmpresa(empresa) devolve exatamente as contas da empresa pedida (principal: A e a 3ª; separada e aberta: só ela)');
        mem['ml:conta'] = A; await espera();
        ok(idsDe(await S.contasDaEmpresa()) === A + ',900000003', 'com a principal aberta: as duas contas dela, nunca a separada');
        mem['ml:conta'] = OUTRA; await espera();
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
        console.log('l) bloqueio 5: "Todas as contas" nunca soma o faturamento de empresas diferentes');
        require(path.join(EXT, 'ml-extrator.js')); require(path.join(EXT, 'painel-lateral.js'));
        const C3 = '900000003', P = Object.assign({ contasJuntasGrupos: () => [], contaOpcao: () => '' }, S.pl), vbDe = v => ({ dias: { '2026-09-01': { bruto: v, unidades: 1, vendas: 1, cancelado: 0, devolvido: 0 } }, mesesLidos: ['2026-09'] });
        Object.assign(mem, { 'ml:conta': A, 'ml:contas': { [A]: { visto: 3 }, [C3]: { visto: 2 }, [OUTRA]: { visto: 1 } },
            ['vb:' + A]: vbDe(1000), ['vb:' + C3]: vbDe(2000), ['vb:' + OUTRA]: vbDe(5000),
            ['fech:' + A + ':2026-09']: { total: 100 }, ['fech:' + C3 + ':2026-09']: { total: 200 }, ['fech:' + OUTRA + ':2026-09']: { total: 500 },
            ['shc:anomalias:' + A]: { total: 1 }, ['shc:anomalias:' + C3]: { total: 2 }, ['shc:anomalias:' + OUTRA]: { total: 7 } });
        mem.cfg = Object.assign({}, mem.cfg, { empresaSeparada: { [OUTRA]: true }, apelidos: { [A]: 'Loja A', [C3]: 'Loja C', [OUTRA]: 'Empresa 2' } });
        await espera();
        const dc = await S.dadosContas('2026-09'), cj = S.consolidado(dc, '2026-09'), emp = id => (dc.find(x => x.sellerId === id) || {}).empresa;
        ok(emp(A) === '' && emp(C3) === '' && emp(OUTRA) === OUTRA, 'dadosContas diz a empresa de cada conta ("" = principal; a separada, o id dela)');
        const tot = e => (cj.empresas.find(g => g.empresa === e) || {}).total || {};
        ok(cj.total === null && cj.variasEmpresas && cj.empresas.length === 2 && tot('').vendasBrutas === 3000 && tot('').liquido === 2700 && tot('').alertas === 3
            && tot(OUTRA).vendasBrutas === 5000 && tot(OUTRA).liquido === 4500 && tot(OUTRA).alertas === 7,
            'total por empresa (principal 3.000 / outra 5.000) e nenhum total geral somando as duas (nunca 8.000)');
        const grupos = P.contasJuntasGrupos(cj, 'todas', id => (id === OUTRA ? 'Empresa 2' : id));
        ok(grupos.length === 2 && grupos[0].titulo === 'Empresa principal' && grupos[0].linhas.map(x => x.sellerId).sort().join(',') === A + ',' + C3 && grupos[0].total.vendasBrutas === 3000
            && grupos[1].titulo === 'Outra empresa · Empresa 2' && grupos[1].linhas.length === 1 && grupos[1].total.vendasBrutas === 5000, 'o cartão mostra um bloco por empresa, cada um com o total dele');
        const cfgP = await S.lerCfg();
        ok(/\(outra empresa\)$/.test(P.contaOpcao({ sellerId: OUTRA }, cfgP)) && !/outra empresa/.test(P.contaOpcao({ sellerId: C3 }, cfgP)) && /\(aberta no ML\)$/.test(P.contaOpcao({ sellerId: A, atual: true }, cfgP)),
            'no seletor do topo, a conta separada aparece com "(outra empresa)"');
        const um = S.consolidado(dc.map(x => Object.assign({}, x, { empresa: '' })), '2026-09');
        ok(!um.variasEmpresas && um.total && um.total.vendasBrutas === 8000 && P.contasJuntasGrupos(um, 'todas').length === 1 && P.contasJuntasGrupos(um, 'todas')[0].titulo === '',
            'sem conta separada (uma empresa só): o total de todas as contas continua (8.000)');

        console.log('m) bloqueio 5: painel lateral, "Tiny · Puxar custos agora" — a empresa do clique e o token dela');
        {   // O código de verdade do painel-lateral.js (do "let tinyToken" ao listener do botão), com um DOM mínimo.
            const fs = require('fs'), src = fs.readFileSync(path.join(EXT, 'painel-lateral.js'), 'utf8');
            const ini = src.indexOf("    let tinyToken = ''"), fim = src.indexOf("    $('#abrirTiny').addEventListener('click', abrirTiny);");
            const els = {}, $ = s => els[s] || (els[s] = { style: {}, hidden: true, disabled: false, textContent: '', value: '', focus() {} });
            let liberar = null;
            const chromeT = { permissions: { request: () => new Promise(r => { liberar = r; }) } };
            const T = new Function('SHC', '$', 'chrome', 'fetch', src.slice(ini, fim) + '\nreturn { abrirTiny, usa: t => { tinyToken = t; } };')(S, $, chromeT, async () => ({}));
            const lidos = [];
            S.tinyPuxar = async tok => { lidos.push(tok); return [{ sku: 'PECA-01', custo: tok === 'TOKEN-A' ? 11 : 22 }]; };
            const tira = () => Object.keys(mem).filter(k => /^c\|sku(@\d+)?\|PECA-01$/.test(k) || /^erp(@\d+)?:tiny$/.test(k)).forEach(k => delete mem[k]);
            const clica = async () => { const p = T.abrirTiny(); liberar(true); await p; };
            // (1) o painel leu o Tiny com a A aberta (TOKEN-A na memória); o ML trocou para a OUTRA (com o Tiny DELA) antes do painel recarregar.
            tira(); mem['erp:tiny'] = { token: 'TOKEN-A' }; mem['erp@' + OUTRA + ':tiny'] = { token: 'TOKEN-B' };
            mem['ml:conta'] = OUTRA; await espera();
            T.usa('TOKEN-A'); await clica();
            ok(lidos[lidos.length - 1] === 'TOKEN-B' && mem['c|sku@' + OUTRA + '|PECA-01'].custo === 22 && !mem['c|sku|PECA-01'] && mem['erp@' + OUTRA + ':tiny'].token === 'TOKEN-B' && mem['erp:tiny'].token === 'TOKEN-A',
                'clique com a OUTRA aberta: lê o Tiny DELA (token relido da empresa), grava na OUTRA e não sobrescreve o token de ninguém');
            // (2) o clique foi com a A aberta; o ML troca para a OUTRA enquanto o Chrome pergunta a permissão → tudo vai para a empresa do clique.
            tira(); mem['erp:tiny'] = { token: 'TOKEN-A' }; mem['erp@' + OUTRA + ':tiny'] = { token: 'TOKEN-B' };
            mem['ml:conta'] = A; await espera();
            T.usa('TOKEN-A');
            const p2 = T.abrirTiny();
            mem['ml:conta'] = OUTRA; await espera();
            liberar(true); await p2;
            ok(mem['c|sku|PECA-01'] && mem['c|sku|PECA-01'].custo === 11 && !mem['c|sku@' + OUTRA + '|PECA-01'] && mem['erp@' + OUTRA + ':tiny'].token === 'TOKEN-B',
                'a conta trocou durante o pedido de permissão: custos e token ficam na empresa do clique (a A)');
            // (3) a empresa aberta não tem Tiny: não usa o token da outra; pede o token dela.
            tira(); mem['erp:tiny'] = { token: 'TOKEN-A' };
            mem['ml:conta'] = OUTRA; await espera();
            T.usa('TOKEN-A'); const n = lidos.length; await clica();
            ok(lidos.length === n && !mem['c|sku@' + OUTRA + '|PECA-01'] && !mem['erp@' + OUTRA + ':tiny'] && $('#tinyBox').hidden === false, 'empresa sem Tiny: nada lido com o token da outra; o campo do token dela aparece');
            mem['ml:conta'] = A; await espera();
        }

        console.log('o) as correções multi-empresa que já existiam, com o código de verdade das telas (o teste falha se cada uma for desfeita)');
        {
            const fs = require('fs'), PJ = fs.readFileSync(path.join(EXT, 'painel.js'), 'utf8'), PL = fs.readFileSync(path.join(EXT, 'painel-lateral.js'), 'utf8');
            const el = () => ({ style: {}, hidden: true, disabled: false, textContent: '', value: '', className: '', innerHTML: '', focus() {} });
            const dom = () => { const els = {}; return s => els[s] || (els[s] = el()); };
            const cfg0 = JSON.parse(JSON.stringify(mem.cfg || {})), C3 = '900000003';
            mem['ml:contas'] = { [A]: { visto: 3 }, [C3]: { visto: 2 }, [OUTRA]: { visto: 1 } };
            // o1) "Esquecer" o ERP (painel.js esquecerErp): só a credencial da empresa aberta; a permissão do Chrome só sai sem outra empresa usando.
            const removidas = [];
            const esquecer = new Function('SHC', 'chrome', 'return ' + trecho(PJ, PJ.indexOf('async function esquecerErp(')))(S, { storage: global.chrome.storage, permissions: { remove: async p => { removidas.push(p); return true; } } });
            mem.cfg = Object.assign({}, cfg0, { empresaSeparada: { [OUTRA]: true } });
            mem['erp:tiny'] = { token: 'TOKEN-A' }; mem['erp@' + OUTRA + ':tiny'] = { token: 'TOKEN-B' };
            mem['ml:conta'] = OUTRA; await espera();
            await esquecer('erp:tiny', { origins: ['https://api.tiny.com.br/*'] });
            ok(mem['erp:tiny'] && mem['erp:tiny'].token === 'TOKEN-A' && !mem['erp@' + OUTRA + ':tiny'] && !removidas.length, 'painel.js "Esquecer" com a OUTRA aberta: some só o Tiny dela; o da A e a permissão do Chrome ficam');
            mem['ml:conta'] = A; await espera();
            await esquecer('erp:tiny', { origins: ['https://api.tiny.com.br/*'] });
            ok(!mem['erp:tiny'] && removidas.length === 1, 'e com a A aberta (nenhuma outra empresa com o Tiny): a credencial e a permissão saem');
            // o2) seletor de conta da tabela de custos (painel.js contasTab/desenhaContaTab): só as contas da mesma empresa, com a nota.
            const tab = PJ.slice(PJ.indexOf('    let contaVer = '), PJ.indexOf('    async function lerDados()')), $t = dom();
            const T = new Function('SHC', '$', 'esc', tab + '\nreturn { desenhaContaTab };')(S, $t, s => String(s));
            mem['ml:conta'] = A; await espera(); await T.desenhaContaTab();
            const opc = () => ($t('#contaEsc').innerHTML.match(/value="(\d+)"/g) || []).map(x => x.slice(7, -1)).sort().join(',');
            ok(opc() === A + ',' + C3 && /outra empresa/.test($t('#contaTabNota').textContent), 'tabela de custos com a A aberta: só A e a 3ª (nunca a separada), com a nota das outras empresas');
            mem['ml:conta'] = OUTRA; await espera(); await T.desenhaContaTab();
            ok(opc() === OUTRA && $t('#contaEsc').disabled === true, 'com a separada aberta: só ela');
            // o3) "Salvar contas" (painel lateral e painel): marcar "Outra empresa" ou dar apelido não marca o imposto como informado (semMarcar).
            const caixas = [{ dataset: { apelido: A }, value: 'Loja A' }], marcas = [{ checked: true, dataset: { empresa: OUTRA } }, { checked: false, dataset: { empresa: A } }];
            const docC = { querySelectorAll: s => (/apelido/.test(s) ? caixas : marcas), querySelector: () => marcas[0] };
            const salvaL = new Function('SHC', 'P', '$', 'document', 'falhaGravar', 'desenhaConta', 'setTimeout', 'let cfg = null; return (' + trecho(PL, PL.indexOf('async () =>', PL.indexOf("$('#salvarApelidos').addEventListener('click'"))) + ');')(S, S.pl, dom(), docC, e => { throw e; }, () => {}, () => 0);
            const salvaP = new Function('SHC', '$', 'document', 'FALHA', 'setTimeout', 'let cfg = null; return (' + trecho(PJ, PJ.indexOf('async () =>', PJ.indexOf("$('#salvarApelidos').addEventListener('click'"))) + ');')(S, dom(), docC, 'falhou', () => 0);
            for (const [onde, salva] of [['painel lateral', salvaL], ['painel', salvaP]]) {
                mem.cfg = {}; mem['ml:conta'] = A; await espera();
                await salva();
                ok(mem.cfg.empresaSeparada && mem.cfg.empresaSeparada[OUTRA] === true && mem.cfg.apelidos[A] === 'Loja A' && mem.cfg.configurado === undefined && (await S.lerCfg()).configurado !== true,
                    onde + ': "Salvar contas" grava a outra empresa e o apelido sem marcar o imposto como informado');
            }
            // o4) Omie (painel.js puxarOmie): a chave que o Omie recusou sai da empresa do clique — nunca a credencial da outra empresa aberta no meio.
            mem.cfg = Object.assign({}, cfg0, { empresaSeparada: { [OUTRA]: true } }); mem['ml:conta'] = A; await espera();
            delete mem['erp:omie']; mem['erp@' + OUTRA + ':omie'] = { appKey: 'KEY-B-00000', appSecret: 'SEC-B-00000' };
            const omie = new Function('SHC', '$', 'tinyMsg', 'impBarra', 'chrome', 'lerDados', 'desenhaTabela', 'txtPrincipais', 'impResumo', 'FALHA', 'desenhaOmie',
                'let omieRodando = false; return ' + trecho(PJ, PJ.indexOf('async function puxarOmie(')))(S, dom(), () => {}, () => {},
                { runtime: { sendMessage: async () => { mem['ml:conta'] = OUTRA; await espera(); return { ok: false, msg: 'O Omie recusou a chave.' }; } } }, async () => {}, () => {}, () => '', () => {}, 'falhou', async () => {});
            await omie(Promise.resolve(true), { appKey: 'KEY-A-NOVA0', appSecret: 'SEC-A-NOVA0' });
            ok(!mem['erp:omie'] && mem['erp@' + OUTRA + ':omie'] && mem['erp@' + OUTRA + ':omie'].appKey === 'KEY-B-00000', 'Omie recusou a chave da A com a OUTRA aberta no meio: sai a chave da A; a credencial da OUTRA fica');
            mem.cfg = cfg0; mem['ml:conta'] = A; await espera();
        }
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
        // Bling (fundo/09 conectarBling): o code do login do Bling vira tokens na empresa do CLIQUE (a principal), mesmo com a OUTRA aberta.
        fd['erp:bling'] = { clientId: 'CLI-A-00000', clientSecret: 'SEC-A-00000' }; delete fd['erp@' + OUTRA + ':bling'];
        I.ctx.SHC.blingTrocarCodigo = async () => ({ access: 'AC-A', refresh: 'RF-A', expira: Date.now() + 3600e3 });
        I.ctx.SHC.blingPuxar = async () => [{ sku: 'BL-01', custo: 5 }];
        const rb = await I.envia({ acao: 'bling_conectar', code: 'CODE-0001', empresa: '' });
        ok(rb && rb.ok && fd['erp:bling'].refresh === 'RF-A' && fd['c|sku|BL-01'] && !fd['erp@' + OUTRA + ':bling'] && !fd['c|sku@' + OUTRA + '|BL-01'],
            'Bling conectado na empresa do clique (a principal) com a OUTRA aberta: tokens e custos vão para a principal');
    }

    // Nenhuma tela lê custos, cfg ou ERP cru (sem a camada da empresa): as leituras que a revisão achou não voltam.
    // Bloqueio 5: a varredura passa também por fundo/ e nucleo/ e pega get('cfg'), get(['c|sku|…']), get([...chaves]), getKeys() e lerChave('cfg').
    {
        const fs = require('fs'), path = require('path'), EXT = path.join(__dirname, '../../extension-copiloto');
        const CRU = [
            ['get(null)', /chrome\.storage\.local\.get\(\s*null\s*\)/],
            ['get do cfg', /chrome\.storage\.local\.get\(\s*\[?\s*['"`]cfg['"`]/],
            // 2ª revisão: o cfg em qualquer posição da lista (get(['ml:conta', 'cfg'])) e na forma de objeto (get({ cfg: {} }))
            ['get do cfg na lista', /chrome\.storage\.local\.get\(\s*\[[^\]]*,\s*['"`]cfg['"`]/], ['get do cfg em objeto', /chrome\.storage\.local\.get\(\s*\{[^}]*\bcfg\s*:/],
            ['get de custo/ERP', /chrome\.storage\.local\.get\(\s*\[?\s*['"`](c\||erp[:@])/],
            ['get das chaves de custo', /chrome\.storage\.local\.get\(\s*\[\s*\.\.\.\s*chaves/],
            ['getKeys', /chrome\.storage\.local\.getKeys\(/],
            ['lerChave do cfg', /lerChave\(\s*['"`]cfg['"`]\s*\)/],
            ['remove do ERP', /chrome\.storage\.local\.remove\(\s*(SHC\.(TINY|OMIE|BLING)_CHAVE|\[?\s*['"`]erp[:@])/],
            ['cfg cru', /mud\.cfg\.newValue\s*\|\|\s*\{\}\)\s*;?\s*repinta|Object\.assign\(\{\}, SHC\.PADRAO, (mud|tudo|r|t)\.cfg/],
        ];
        // Leituras cruas conferidas que não são de números de empresa (cada uma diz por quê). Revisão 07/10: liberadas UMA A UMA pelo texto exato
        // da linha (antes a liberação valia para o arquivo inteiro: o painel lateral podia voltar a ler o cfg cru e a suíte seguia verde).
        // Nova leitura crua → passa pela camada da empresa ou entra aqui com a linha dela.
        const PODE = [
            ['fundo/01-carga-e-eventos.js', 'get(null)', "const tudo = await chrome.storage.local.get(null), fora = Object.keys(tudo).filter(k => k.indexOf('ad|ml|') === 0);",
                'limparVersaoAntiga: só apaga ad|ml| e o retrato "atual" e limpa o apelido de ml:contas'],
            ['fundo/09-custos-erp.js', 'get do cfg', "const cfg = (await chrome.storage.local.get('cfg')).cfg || {};", 'empresaDoPedido: só lê cfg.empresaSeparada (qual conta é outra empresa), que é de todas'],
            ['painel-lateral.js', 'lerChave do cfg', "const salvarCfgRobo = async patch => SHC.gravarChave('cfg', Object.assign({}, (await SHC.lerChave('cfg')) || {}, patch));",
                'robô de promoções (cfg.robopromo): ainda é um só para todas as empresas'],
        ];
        // Cada ocorrência de cada padrão, com a linha onde começa: só passa a que tem uma liberação com o mesmo arquivo, padrão e texto (1 por liberação).
        const varre = (arqs, ler) => {
            const cru = [];
            arqs.forEach(a => {
                const t = ler(a), linhas = t.split('\n'), usadas = new Set();
                CRU.forEach(([nome, rx]) => {
                    const g = new RegExp(rx.source, 'g');
                    let m;
                    while ((m = g.exec(t))) {
                        const n = t.slice(0, m.index).split('\n').length, linha = linhas[n - 1].trim();
                        const k = PODE.findIndex((x, i) => !usadas.has(i) && x[0] === a && x[1] === nome && x[2] === linha);
                        if (k >= 0) usadas.add(k); else cru.push(a + ':' + n + ': ' + nome);
                        if (!m[0].length) g.lastIndex++;
                    }
                });
            });
            return cru;
        };
        // O detector acusa cada padrão (as leituras que escapavam da trava antiga: rastreio cego_estatico.js).
        const amostras = { 'x.js': "chrome.storage.local.get('cfg')", 'y.js': "chrome.storage.local.get(['c|sku|KIT-01'])", 'z.js': 'chrome.storage.local.getKeys()', 'w.js': "SHC.lerChave('cfg')",
            'v.js': 'chrome.storage.local.get([...chaves])', 'u.js': "chrome.storage.local.remove('erp:tiny')", 'fundo/q.js': 'chrome.storage.local.get(null)', 's.js': 'cfg: Object.assign({}, SHC.PADRAO, tudo.cfg || {})',
            'r.js': "const cfg = (await chrome.storage.local.get(['ml:conta', 'cfg'])).cfg || {}", 'p.js': 'const cfg = (await chrome.storage.local.get({ cfg: {} })).cfg' };
        ok(varre(Object.keys(amostras), a => amostras[a]).length === Object.keys(amostras).length && !varre(['ok.js'], () => "SHC.lerCfg(); SHC.areaEmpresa().get([...chaves]); chrome.storage.local.get('shc:ret:1')").length,
            'a trava acusa get("cfg"), get(["ml:conta", "cfg"]), get({ cfg }), get(["c|sku|…"]), getKeys(), lerChave("cfg"), get([...chaves]), remove("erp:…") e o cfg cru (e não acusa a leitura pela camada)');
        // A liberação vale para a linha, não para o arquivo: a mesma leitura numa 2ª linha do painel lateral (o mutante da revisão) é acusada.
        const pl = "    const salvarCfgRobo = async patch => SHC.gravarChave('cfg', Object.assign({}, (await SHC.lerChave('cfg')) || {}, patch));\n"
            + "        const [c, st] = await Promise.all([SHC.lerChave('cfg'), SHC.lerStatus()]);";
        const dupla = varre(['painel-lateral.js'], () => pl), outroArq = varre(['painel.js'], () => pl.split('\n')[0]);
        ok(dupla.length === 1 && /:2: lerChave do cfg$/.test(dupla[0]) && outroArq.length === 1, 'a liberação é da linha (a 2ª leitura do cfg cru no mesmo arquivo é acusada; a mesma linha em outro arquivo também) (' + dupla.concat(outroArq).join('; ') + ')');
        const lista = d => fs.readdirSync(path.join(EXT, d), { withFileTypes: true }).flatMap(x => (x.isDirectory() ? lista(path.join(d, x.name)) : /\.js$/.test(x.name) ? [path.join(d, x.name).replace(/\\/g, '/')] : []));
        const arqs = lista('.').map(a => a.replace(/^\.\//, '')).filter(a => a !== 'store.js');
        ok(arqs.some(a => /^fundo\//.test(a)) && arqs.some(a => /^nucleo\//.test(a)), 'a varredura passa pela raiz, por fundo/ e por nucleo/ (' + arqs.length + ' arquivos)');
        const cru = varre(arqs, a => fs.readFileSync(path.join(EXT, a), 'utf8'));
        ok(!cru.length, 'nenhuma leitura crua de custos/cfg/ERP fora do store.js' + (cru.length ? ' (' + cru.join('; ') + ')' : ''));
        // Correções das telas que só dá para conferir no texto (o rastreio desfez cada uma e a suíte continuava verde):
        const le = a => fs.readFileSync(path.join(EXT, a), 'utf8');
        ok(/cfg:\s*await SHC\.lerCfg\(\)/.test(le('fechamento.js')), 'Fechamento lê imposto/margem pela camada da empresa (SHC.lerCfg), não o cfg cru');
        ok(/cfg:\s*SHC\.lerCfg \? await SHC\.lerCfg\(\)/.test(le('tiktok.js')), 'TikTok lê o cfg pela camada da empresa (SHC.lerCfg)');
        ok(/const \[c, st, an, g, ct, cts\] = await Promise\.all\(\[SHC\.lerCfg\(\), SHC\.lerStatus\(\)/.test(le('painel-lateral.js')),
            'painel lateral: a leitura principal do cfg é pela camada da empresa (SHC.lerCfg) — a conta "Outra empresa" não vê o imposto e a margem da principal');
        ok(PODE.every(([a, , l]) => le(a).split('\n').some(x => x.trim() === l)), 'cada leitura liberada ainda existe com o mesmo texto (liberação velha não fica na lista)');
        ok(/\[desenhaTiny, desenhaOmie, desenhaBling\]\.forEach/.test(le('painel.js').slice(le('painel.js').indexOf('contasMudou'))), 'painel: os cartões do ERP se redesenham quando a conta/empresa aberta muda');
        const sinc = ['painel.js', 'painel-lateral.js'].flatMap(a => le(a).split('\n').filter(l => /acao: 'sincronizar_custos'/.test(l)).map(l => [a, l]));
        ok(sinc.length >= 4 && sinc.every(([, l]) => /empresa/.test(l)), 'toda importação do ERP pedida pelas telas leva a empresa do clique (' + sinc.length + ' pedidos)');
        ok(/Envie só se \$\{esc\(SHC\.confereExclusao\(/.test(le('painel-lateral.js')), 'pós-venda: o pedido de exclusão diz "Envie só se …" (o que conferir antes de enviar)');
        ok(/textoChamado\(\s*F\.itemDoChamado\(/.test(le('fechamento.js')), 'Fechamento: o texto do chamado copiado sai de F.itemDoChamado (cobrado × esperado do pedido)');
    }

    console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nTUDO OK');
    process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
