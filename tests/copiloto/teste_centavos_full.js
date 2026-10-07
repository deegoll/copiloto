// Centavos do Full (pedido da dona: "cada centavo tem que bater, a tela tem que bater 100%").
// Prova, só com dados inventados, que cada conta de dinheiro e cada quantidade do Full fecha, e que a tela (SHC.moeda) mostra o número da conta:
//   A. a régua (SHC.r2 / SHC.moeda) nos valores do Full;
//   B. SHC.mlRemessasFull: custo = total_charged no centavo (número, "1.234,56", "R$ …"); ausente/lixo = null, nunca R$ 0,00;
//      multa SÓ pelo with_penalties numérico (total_charged nunca vira "multa");
//   C. SHC.remessasPorMes: Σ do mês = Σ das remessas do mês (custo, multas, unidades, contagem) e = Σ das linhas da tela (P.linhasRemessas);
//   D. SHC.remessasResumo + P.remessasResumoTxt: custo do mês, custo por unidade, multas do mês e o texto da tela;
//   E. SHC.mlRemessaDetalheDoEstado: multa = Σ das cobranças de penalidade; unidades ausentes = null;
//   F. SHC.remessasInconformes, SHC.chamadoRemessa e o sino (SHC.anomalias): declaradas/aptas = Σ dos produtos, "o ML cobrou" = total_charged;
//   G. SHC.simulaRemessa (custo estimado da coleta) e P.skusParaSimular (quantidades inteiras ≥ 0);
//   H. SHC.fullRateioUn (armazenagem + coleta dos últimos 30 dias ÷ unidades vendidas pelo Full);
//   I. SHC.fechamentoDasCobrancas: armazenagem, estoque antigo e coleta do Full no mês (estorno negativo, total = Σ dos tipos);
//   J. P.previsaoFull (oráculo em inteiros: 30 dias, ano passado, índice sazonal, parado);
//   K. P.planoFull + P.explicaFull: quantidade = alvo − aptas − a caminho (nunca negativa), espaço livre, e o texto da conta;
//   L. P.saudeFull, P.acaoParado e SHC.fullMinimo (unidades sobrando, faltam, sugerido; armazenagem sem R$ inventado);
//   M. ícone × painel (SHC.alertasDe × P.saudeFull): o mesmo produto em alerta, com a mesma previsão (também a sazonal) e os mesmos dias;
//   N. quantidades lidas da tela do ML (SHC.mlFullDoEstado / P.un): "1.234 un." = 1234, "—" = null (nunca 0);
//   O. linha da sincronização (resumoFull, no fundo): mês sem cobrança não vira "R$ 0,00".
// Casos gerados com semente fixa (LCG): o resultado é o mesmo em toda execução (nada de Math.random). Ids e valores inventados.
// Divergências achadas nesta auditoria (repro em scratchpad/centavos/ e no relatório da tarefa). As corrigidas viraram asserção (#n):
//   1) #16 CORRIGIDA: o gasto do mês é um só (SHC.remessasPorMes) no cabeçalho do cartão, nas linhas "o ML cobrou" e na sincronização, com
//      remessa vencida, cancelada ou aberta já cobrada (antes: R$ 120,50 no cartão × R$ 200,50 na sincronização) — seção O;
//   2) #17 CORRIGIDA: SHC.simulaRemessa usa só remessas recebidas (closed_ok/closed_with_changes) no custo da coleta, o filtro do cartão
//      (antes REM_FECHADA, com cancelada e vencida: R$ 1,60/un. na simulação × R$ 1,21/un. no cartão) — seção G;
//   3) #18 CORRIGIDA: custo por unidade do mês = cobrança ÷ unidades só das remessas recebidas COM unidades (antes R$ 2,00/un. em vez de
//      R$ 1,00: somava o custo da remessa sem units_count e não as unidades dela) — seção D;
//   4) #19 CORRIGIDA: SHC.alertasDe (número do ícone e sino) usa a MESMA previsão do painel (SHC.previsaoFull, com o índice sazonal e o parado
//      da v3.3; variação pela mesma SHC.vmDaParte). Antes o painel dizia "Crítico, acaba em 4 dias" e o ícone não contava o produto — seção M;
//   5) #20 CORRIGIDA: dias até acabar = ⌊aptas × 30 ÷ previsão⌋ no painel, no plano e no ícone (antes ⌊aptas ÷ (previsão ÷ 30)⌋ perdia 1 dia
//      na conta exata: 23 aptas, 23 vendas → 29 dias, não 30) — seções K e L;
//   6) simulador: "R$ 5,24 por unidade" × 100 un. = R$ 524,00, mas o custo estimado mostrado é R$ 523,81 (média sem arredondar × un.);
//   7) #21 CORRIGIDA: P.explicaFull sazonal mostra a conta que fecha: "usei 7 × 1,33 = 9,31 → 10 (arredondado para cima)" (antes "= 10",
//      com 7 × 1,33 = 9,31 arredondado sem dizer) — seção J.
// Rodar: node tests/copiloto/teste_centavos_full.js
'use strict';
require('./relogio').fixar();
const path = require('path');
global.chrome = { storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } }, runtime: { sendMessage: async () => ({}) } };
const EXT = path.join(__dirname, '../../extension-copiloto');
const SHC = require(path.join(EXT, 'calc.js'));
['store.js', 'ml-extrator.js', 'ml-tela.js', 'painel-lateral.js'].forEach(a => require(path.join(EXT, a)));
const P = SHC.pl, montaFundo = require('./fundo_falso');
let f = 0, nChecks = 0, nLote = 0;
const ok = (c, m) => { nChecks++; console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) f++; };

// ── Régua independente do produto: centavos e unidades INTEIROS ──
const cent = v => Math.round(v * 100);   // só para valor que já deveria ter 2 casas (emCentavos prova isso)
const emCentavos = v => typeof v === 'number' && isFinite(v) && Math.abs(v * 100 - Math.round(v * 100)) < 1e-3;
// O R$ que a tela TEM de mostrar, montado só com inteiros: "R$ 1.234,56", "−R$ 0,05".
const milhar = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const reais = c => { const a = Math.abs(c); return (c < 0 ? '−' : '') + 'R$ ' + milhar(Math.floor(a / 100)) + ',' + String(a % 100).padStart(2, '0'); };
const brTxt = c => reais(c).replace(/^R\$ /, '');                                   // "1.234,56" (como o ML escreve)
const ptTxt = c => Math.floor(c / 100) + '.' + String(c % 100).padStart(2, '0');    // "1234.56"
const ceilDiv = (a, b) => Math.floor((a + b - 1) / b);                              // a ≥ 0, b > 0
// a ÷ b arredondado meio para cima (a ≥ 0, b > 0) → { q, empate } (no empate exato o r2 do produto pode cair para baixo: aceitamos os dois).
const divMeio = (a, b) => ({ q: Math.floor(a / b) + (2 * (a % b) >= b ? 1 : 0), empate: 2 * (a % b) === b });
const bateMeio = (cents, a, b) => { const d = divMeio(a, b); return cents === d.q || (d.empate && cents === d.q - 1); };
const limpo = t => typeof t === 'string' && !/NaN|Infinity|undefined|\bnull\b|\[object/.test(t);
const inteiroNN = v => Number.isInteger(v) && v >= 0;
// Gerador com semente fixa (LCG de Numerical Recipes).
const lcg = s => { let x = s >>> 0; return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296; };
const ent = (r, a, b) => a + Math.floor(r() * (b - a + 1));
const pega = (r, xs) => xs[Math.floor(r() * xs.length)];
const HOJE = '2026-09-25';   // o relógio dos testes (relogio.js)
const dia = (n, base) => new Date(Date.parse((base || HOJE) + 'T12:00:00Z') - n * 864e5).toISOString().slice(0, 10);
const mesMenos12 = m => (+m.slice(0, 4) - 1) + m.slice(4);
// Conferência em lote: conta os casos e guarda o 1º que falhou (vira o repro).
const lote = () => { const o = { n: 0, ruim: null, conta(c, ex) { o.n++; if (!c && !o.ruim) o.ruim = ex === undefined ? '(sem detalhe)' : ex; return c; } }; return o; };
const okLote = (l, m) => (nLote += l.n, ok(!l.ruim && l.n > 0, m + ` (${l.n} conferências)` + (l.ruim ? ' — 1º caso: ' + JSON.stringify(l.ruim).slice(0, 600) : '')));

(async () => {
console.log('A. Régua dos centavos no Full: SHC.r2 e SHC.moeda');
{
    ok([null, undefined, NaN, Infinity, -Infinity].every(v => SHC.moeda(v) === '—'), 'valor ausente, NaN ou infinito: "—" na tela (nunca "R$ NaN" nem "R$ 0,00")');
    const r = lcg(20261007), t = lote(), s = lote();
    for (let k = 0; k < 3000; k++) {
        const c = ent(r, -50000000, 50000000);
        t.conta(SHC.moeda(c / 100) === reais(c), { c, tela: SHC.moeda(c / 100), deveria: reais(c) });
    }
    for (let k = 0; k < 600; k++) {   // soma acumulada como o produto faz (m.custo = r2(m.custo + v)): nenhum centavo some nem aparece
        const xs = Array.from({ length: ent(r, 1, 60) }, () => ent(r, 0, 2000000));
        let acc = 0; xs.forEach(c => { acc = SHC.r2(acc + c / 100); });
        s.conta(emCentavos(acc) && cent(acc) === xs.reduce((a, c) => a + c, 0), { xs: xs.slice(0, 8), acc });
    }
    okLote(t, 'SHC.moeda(v) = o R$ montado em centavos inteiros (milhar com ponto, vírgula, "−" no negativo)');
    okLote(s, 'r2 acumulado (como remessasPorMes/remessasResumo somam) = Σ em centavos inteiros');
}

// ── Gerador de remessas no formato do ML (GET /shipping/inbounds) com o oráculo em centavos ──
const STS = ['closed_ok', 'closed_with_changes', 'cancelled', 'expired', 'pending', 'scheduled', 'in_transit', 'receiving', 'working'];
const estadoRem = (results, total) => ({ appProps: { pageProps: { data: { results, paging: { total: total === undefined ? results.length : total, offset: 0 } } } } });
function geraRemessaML(r, id) {
    const st = pega(r, STS), fechada = /^closed_/.test(st), x = { id, shipment_type: 'pickup', status: st }, o = { id: String(id), status: st };
    // Datas: recebida (fechadas, quase sempre), agendada, última mudança; às vezes nenhuma.
    const d1 = dia(ent(r, 0, 150)), d2 = dia(ent(r, 0, 150)), d3 = dia(ent(r, 0, 150)), qd = ent(r, 0, 9);
    if (fechada && qd > 1) x.reception_date = d1 + 'T1' + ent(r, 0, 9) + ':00:00.000Z';
    if (qd > 2 || !fechada) x.appointment = { date: d2 + 'T08:00:00.000-03:00' };
    if (qd !== 0) x.last_updated = d3 + 'T20:00:00.000Z';
    o.quando = (x.reception_date ? d1 : '') || (x.appointment ? d2 : '') || (x.last_updated ? d3 : '');
    // Unidades: fechada sempre com número (o custo por unidade do mês precisa delas; o caso sem número é a divergência 3, à parte).
    if (fechada || ent(r, 0, 3)) { x.units_count = ent(r, 0, 800); o.unidades = x.units_count; } else o.unidades = null;
    // total_charged: número, "1.234,56", "R$ 1.234,56", "1234.56", null, sem a chave, lixo; inbound_charges às vezes nem vem.
    const c = ent(r, 0, 400000), fmt = ent(r, 0, 9), ch = {};
    o.custoC = null;
    if (fmt <= 3) { ch.total_charged = c / 100; o.custoC = c; }
    else if (fmt === 4) { ch.total_charged = brTxt(c); o.custoC = c; }
    else if (fmt === 5) { ch.total_charged = 'R$ ' + brTxt(c); o.custoC = c; }
    else if (fmt === 6) { ch.total_charged = ptTxt(c); o.custoC = c; }
    else if (fmt === 7) ch.total_charged = null;
    else if (fmt === 8) ch.total_charged = pega(r, ['abc', NaN, Infinity, -Infinity, '', '1,2,3', {}, true]);
    // fmt 9: sem a chave
    // with_penalties: false, true (FLAG), número, "15,00", 0, sem a chave; last_penalty_type às vezes.
    const pf = ent(r, 0, 6), p = ent(r, 1, 60000);
    o.multaC = null; o.flag = false;
    if (pf === 0) ch.with_penalties = false;
    else if (pf === 1) { ch.with_penalties = true; o.flag = true; }
    else if (pf === 2) { ch.with_penalties = p / 100; o.multaC = p; o.flag = true; }
    else if (pf === 3) { ch.with_penalties = brTxt(p); o.multaC = p; o.flag = true; }
    else if (pf === 4) ch.with_penalties = 0;
    if (!ent(r, 0, 4)) { ch.last_penalty_type = pega(r, ['LABEL_PROBLEM', 'NO_SHOW', 'LATE', 'MISSING_UNITS']); o.flag = true; }
    if (ent(r, 0, 11)) x.inbound_charges = ch; else { o.custoC = null; o.multaC = null; o.flag = false; }
    return { x, o };
}
const rGer = lcg(77001);
const GER = Array.from({ length: 500 }, (_, k) => geraRemessaML(rGer, 83000000 + k));
const LISTA = SHC.mlRemessasFull(estadoRem(GER.map(g => g.x), 512));
const ORA = {}; GER.forEach(g => { ORA[g.o.id] = g.o; });
const SNAP = { total: LISTA.total, remessas: LISTA.remessas, porMes: SHC.remessasPorMes(LISTA.remessas) };

console.log('B. Remessas da lista (SHC.mlRemessasFull): custo = total_charged no centavo; multa só pelo with_penalties');
{
    const R = (id, charges, extra) => Object.assign({ id, shipment_type: 'pickup', status: 'closed_ok', reception_date: '2026-09-10T10:00:00.000Z', units_count: 10, products_count: 10, on_sale_units: 10 },
        charges === undefined ? {} : { inbound_charges: charges }, extra || {});
    const x = SHC.mlRemessasFull(estadoRem([
        R(81000001, { total_charged: 312.4, with_penalties: false }),
        R(81000002, { total_charged: '1.234,56', with_penalties: true, last_penalty_type: 'LABEL_PROBLEM' }),
        R(81000003, { total_charged: null, with_penalties: 45.5 }),
        R(81000004, undefined, { units_count: undefined, products_count: null, on_sale_units: 'x' }),
        R(81000005, { total_charged: 'abc' }), R(81000006, { total_charged: NaN }), R(81000007, { total_charged: Infinity }),
        R(81000008, { total_charged: 0.1 + 0.2, with_penalties: '15,00' }),
        R(81000009, { total_charged: 0, with_penalties: 0 }),
    ]));
    const de = id => x.remessas.find(r => r.id === String(id));
    ok(x.reconhecida && x.remessas.length === 9, 'lê as 9 remessas do estado da tela');
    ok(de(81000001).custo === 312.4 && de(81000001).multa === null && de(81000001).multaFlag === false && SHC.moeda(de(81000001).custo) === 'R$ 312,40',
        'R$ 312,40 cobrados e sem penalidade: custo R$ 312,40, multa nenhuma (total_charged NUNCA vira multa)');
    ok(de(81000002).custo === 1234.56 && de(81000002).multa === null && de(81000002).multaFlag === true && de(81000002).multaTipo === 'LABEL_PROBLEM' && SHC.moeda(de(81000002).custo) === 'R$ 1.234,56',
        '"1.234,56" do ML = R$ 1.234,56; with_penalties true é só o aviso (multa sem valor, não os R$ 1.234,56)');
    ok(de(81000003).custo === null && de(81000003).multa === 45.5, 'total_charged null = ainda não cobrou (null, não 0); with_penalties 45,5 = multa de R$ 45,50');
    ok(de(81000004).custo === null && de(81000004).multa === null && de(81000004).multaFlag === false && de(81000004).unidades === null && de(81000004).declaradas === null && de(81000004).aptas === null,
        'sem inbound_charges e sem unidades: tudo null (nada de R$ 0,00 nem 0 un. inventados)');
    ok([81000005, 81000006, 81000007].every(id => de(id).custo === null), '"abc", NaN e Infinity no total_charged: null (nunca "R$ NaN")');
    ok(de(81000008).custo === 0.3 && emCentavos(de(81000008).custo) && de(81000008).multa === 15, '0,1 + 0,2 (0,30000000000000004) vira R$ 0,30; "15,00" = multa de R$ 15,00');
    ok(de(81000009).custo === 0 && de(81000009).multa === null && de(81000009).multaFlag === false, 'o ML mandou 0: custo 0 (é zero de verdade) e with_penalties 0 não é multa');
    const l = lote(), u = lote();
    LISTA.remessas.forEach(rm => {
        const o = ORA[rm.id];
        l.conta(o && (o.custoC === null ? rm.custo === null : emCentavos(rm.custo) && cent(rm.custo) === o.custoC)
            && (o.multaC === null ? rm.multa === null : emCentavos(rm.multa) && cent(rm.multa) === o.multaC) && rm.multaFlag === o.flag,
            { id: rm.id, custo: rm.custo, multa: rm.multa, flag: rm.multaFlag, oraculo: o });
        u.conta(o && (o.unidades === null ? rm.unidades === null : rm.unidades === o.unidades) && [rm.recebida, rm.agendada, rm.atualizada].every(d => d === '' || /^\d{4}-\d{2}-\d{2}$/.test(d)),
            { id: rm.id, un: rm.unidades, o: o && o.unidades, datas: [rm.recebida, rm.agendada, rm.atualizada] });
    });
    okLote(l, '500 remessas geradas: custo e multa = oráculo em centavos (ausente/lixo = null; multa nunca sai do total_charged)');
    okLote(u, 'unidades da lista: inteiro do ML ou null (ausente nunca vira 0); datas no formato AAAA-MM-DD ou vazias');
    ok(LISTA.total === 512 && LISTA.remessas.length === 500, 'total do ML (paging.total) guardado à parte do que foi lido');
}

console.log('C. Totais por mês (SHC.remessasPorMes) = Σ das remessas = Σ das linhas da tela');
{
    const esperado = {}, linhas = P.linhasRemessas(SNAP, null);
    let semData = 0;
    LISTA.remessas.forEach(rm => {
        const o = ORA[rm.id];
        if (!o.quando) { semData++; return; }
        const m = esperado[o.quando.slice(0, 7)] || (esperado[o.quando.slice(0, 7)] = { remessas: 0, unidades: 0, custoC: 0, multasC: 0 });
        m.remessas++; m.unidades += o.unidades || 0; m.custoC += o.custoC || 0; m.multasC += o.multaC || 0;
    });
    const pm = SNAP.porMes, ks = Object.keys(pm).sort(), l = lote();
    ok(JSON.stringify(ks) === JSON.stringify(Object.keys(esperado).sort()) && ks.length >= 5, 'os meses do total = os meses das remessas (' + ks.join(', ') + ')');
    ks.forEach(m => {
        const a = pm[m], e = esperado[m] || {};
        l.conta(emCentavos(a.custo) && cent(a.custo) === e.custoC && emCentavos(a.multas) && cent(a.multas) === e.multasC && inteiroNN(a.unidades) && a.unidades === e.unidades
            && inteiroNN(a.remessas) && a.remessas === e.remessas, { m, produto: a, oraculo: e });
    });
    okLote(l, 'cada mês: custo, multas (centavos), unidades e remessas = Σ das remessas do mês');
    const somaM = ks.reduce((s, m) => s + pm[m].remessas, 0);
    ok(somaM + semData === LISTA.remessas.length && semData > 0, `Σ das remessas por mês (${somaM}) + sem nenhuma data (${semData}) = todas as lidas (${LISTA.remessas.length})`);
    ok(ks.reduce((s, m) => s + cent(pm[m].custo), 0) === Object.values(esperado).reduce((s, e) => s + e.custoC, 0), 'Σ de todos os meses = Σ do total_charged das remessas com data (nenhum centavo some)');
    // A tela (cartão "Todas as remessas"): cada linha mostra "o ML cobrou R$ X" (custo || 0); por mês, Σ das linhas = porMes.custo.
    const porMesLinhas = {}, ll = lote();
    linhas.forEach(x => { if (x.quando) porMesLinhas[x.quando.slice(0, 7)] = (porMesLinhas[x.quando.slice(0, 7)] || 0) + cent(x.custo); });
    ks.forEach(m => ll.conta(porMesLinhas[m] === cent(pm[m].custo), { m, linhas: porMesLinhas[m], porMes: pm[m].custo }));
    okLote(ll, 'P.linhasRemessas: Σ do "o ML cobrou" das linhas do mês = porMes[mês].custo');
    ok(linhas.length === LISTA.remessas.length && linhas.every(x => typeof x.custo === 'number' && isFinite(x.custo) && (x.custo !== 0 || ORA[x.id].custoC === null || ORA[x.id].custoC === 0)),
        'linha sem cobrança fica com custo 0 e a tela esconde (nunca "o ML cobrou R$ 0,00" inventado); com cobrança, o número do ML');
    const ord = linhas.map(x => x.quando);
    ok(ord.every((q, i) => !i || ord[i - 1] >= q), 'linhas da mais recente para a mais antiga');
}

console.log('D. Resumo do mês das remessas (SHC.remessasResumo + P.remessasResumoTxt)');
{
    // À mão: 1 recebida (R$ 120,50, 100 un.), 1 recebida com mudanças (R$ 80,00, 40 un.), 1 a caminho, 1 recebida sem cobrança ainda,
    // 1 recebida com R$ 300,00 e sem penalidade, 1 com penalidade de R$ 45,50 (lista) e 1 com o aviso só no detalhe (R$ 49,90).
    const rs = [
        { id: '8400001', status: 'closed_ok', recebida: '2026-09-10', unidades: 100, custo: 120.5 },
        { id: '8400002', status: 'closed_with_changes', recebida: '2026-09-12', unidades: 40, custo: 80 },
        { id: '8400003', status: 'in_transit', agendada: '2026-09-28', unidades: 60, custo: null },
        { id: '8400004', status: 'closed_ok', recebida: '2026-09-20', unidades: 15, custo: null },
        { id: '8400005', status: 'closed_ok', recebida: '2026-08-20', unidades: 50, custo: 300, multa: null, multaFlag: false },
        { id: '8400006', status: 'closed_ok', recebida: '2026-08-21', unidades: 10, custo: 99.9, multa: 45.5, multaFlag: true, multaTipo: 'LABEL_PROBLEM' },
        { id: '8400007', status: 'closed_ok', recebida: '2026-08-22', unidades: 10, custo: 50, multa: null, multaFlag: true },
    ];
    const det = { porId: { 8400007: { multa: { ativa: true, tipo: 'PENALTY_LABEL', valor: 49.9 }, unidades: {}, inconformidades: [], produtos: [] } } };
    const set = SHC.remessasResumo(rs, det, '2026-09', HOJE), ago = SHC.remessasResumo(rs, det, '2026-08', HOJE), out = SHC.remessasResumo(rs, det, '2026-10', HOJE);
    ok(set.custoMes === 200.5 && set.unidadesMes === 140 && set.custoPorUnidade === 1.43 && SHC.moeda(set.custoPorUnidade) === 'R$ 1,43',
        'setembro: R$ 120,50 + R$ 80,00 = R$ 200,50 por 140 un. → R$ 1,43 por unidade (a caminho e sem cobrança não entram)');
    ok(P.remessasResumoTxt(set) === '1 aberta · 3 fechadas nos últimos 30 dias · R$ 200,50 gastos em remessas este mês', 'texto da tela: "' + P.remessasResumoTxt(set) + '"');
    ok(out.custoMes === null && out.custoPorUnidade === null && out.multasMes === 0 && /ainda não cobrou/.test(P.remessasResumoTxt(out)) && !/R\$/.test(P.remessasResumoTxt(out)),
        'mês sem cobrança: custo null e a tela diz "o Mercado Livre ainda não cobrou a coleta deste mês" (nunca "R$ 0,00 gastos")');
    ok(ago.custoMes === 449.9 && ago.multasMes === 95.4, 'agosto: custo R$ 300,00 + R$ 99,90 + R$ 50,00 = R$ 449,90; multas R$ 45,50 (lista) + R$ 49,90 (detalhe) = R$ 95,40');
    const cm = id => set.comMulta.find(x => x.id === id);
    ok(!cm('8400005') && cm('8400006').valor === 45.5 && cm('8400006').texto === 'Multa de R$ 45,50 (problema de etiqueta)' && cm('8400007').valor === 49.9 && /^Multa de R\$ 49,90$/.test(cm('8400007').texto),
        'R$ 300,00 cobrados sem penalidade NÃO viram multa; multa da lista (R$ 45,50) e do detalhe (R$ 49,90) com o valor certo no texto');
    const so = SHC.remessasResumo([{ id: '8400008', status: 'closed_ok', recebida: '2026-09-01', unidades: 5, custo: 70, multa: null, multaFlag: true, multaTipo: 'NO_SHOW' }], null, '2026-09', HOJE);
    ok(so.comMulta[0].valor === null && !/R\$/.test(so.comMulta[0].texto) && /o valor aparece em Gestão de envios Full/.test(so.comMulta[0].texto) && so.multasMes === 0,
        'só o aviso de penalidade (sem número): "Multa (remessa não entregue) — o valor aparece…", sem R$ e sem somar nas multas do mês (os R$ 70,00 do total_charged não viram multa)');
    // Gerados (a mesma lista de B). Custo do mês: só com remessas cobradas que já foram RECEBIDAS — remessa vencida/cancelada/aberta com
    // cobrança é a divergência 1 (fica fora daqui para o teste valer antes e depois da correção). Multas: a lista inteira.
    const fechadaOk = st => st === 'closed_ok' || st === 'closed_with_changes', l = lote(), t = lote(), mu = lote();
    const REC = LISTA.remessas.filter(x => fechadaOk(x.status) || !(x.custo > 0)), SO_REC = { total: REC.length, remessas: REC };
    const lim90 = dia(90), meses = [...new Set(LISTA.remessas.map(x => (ORA[x.id].quando || '').slice(0, 7)).filter(Boolean))].concat(['2026-10', '2025-01']);
    meses.forEach(mes => {
        const rr = SHC.remessasResumo(SO_REC, null, mes, HOJE), rt = SHC.remessasResumo(SNAP, null, mes, HOJE);
        let cC = 0, nC = 0, cU = 0, uC = 0, mC = 0;
        REC.forEach(x => {
            const o = ORA[x.id];
            if ((o.quando || '').slice(0, 7) !== mes || !(o.custoC > 0)) return;
            cC += o.custoC; nC++;
            if (o.unidades > 0) { cU += o.custoC; uC += o.unidades; }   // #18: R$/un. só das remessas com unidades
        });
        LISTA.remessas.forEach(x => { const o = ORA[x.id]; if ((o.quando || '').slice(0, 7) === mes) mC += o.multaC || 0; });
        l.conta((nC ? emCentavos(rr.custoMes) && cent(rr.custoMes) === cC : rr.custoMes === null) && rr.unidadesMes === uC && emCentavos(rt.multasMes) && cent(rt.multasMes) === mC
            && (uC > 0 ? emCentavos(rr.custoPorUnidade) && bateMeio(cent(rr.custoPorUnidade), cU, uC) : rr.custoPorUnidade === null),
            { mes, custoMes: rr.custoMes, oraculo: cC, un: rr.unidadesMes, uC, cpu: rr.custoPorUnidade, multas: rt.multasMes, mC });
        const tx = P.remessasResumoTxt(rr);
        t.conta(limpo(tx) && (nC ? tx.indexOf(reais(cC) + ' gastos em remessas este mês') >= 0 : !/R\$/.test(tx)), { mes, tx });
        rt.comMulta.forEach(c => {
            const x = LISTA.remessas.find(y => y.id === c.id), o = ORA[c.id];
            mu.conta(o.flag && (o.multaC === null ? c.valor === null && !/R\$/.test(c.texto) : cent(c.valor) === o.multaC && c.texto.indexOf('Multa de ' + reais(o.multaC)) === 0)
                && (!/^closed|cancel|expired/.test(x.status) || (o.quando || '') >= lim90), { c, o });
        });
        LISTA.remessas.forEach(x => { const o = ORA[x.id]; if (o.custoC > 0 && !o.flag) mu.conta(!rt.comMulta.some(c => c.id === x.id), { semMulta: x.id }); });
    });
    okLote(l, REC.length + ' remessas recebidas ou sem cobrança, por mês: custo do mês, unidades, custo por unidade e multas = oráculo em centavos (nada cobrado = null)');
    okLote(t, 'texto da tela: o mesmo R$ do custo do mês (ou "ainda não cobrou", sem R$)');
    okLote(mu, 'multas: só com penalidade do ML; valor = with_penalties; total_charged nunca vira multa');
    // #18: custo por unidade = cobrança ÷ unidades só das recebidas COM unidades (a remessa sem units_count somava R$ sem somar unidade: R$ 2,00/un.).
    const u18 = SHC.remessasResumo([{ id: '8400011', status: 'closed_ok', recebida: '2026-09-10', unidades: 100, custo: 100 }, { id: '8400012', status: 'closed_ok', recebida: '2026-09-12', unidades: null, custo: 100 },
        { id: '8400013', status: 'closed_with_changes', recebida: '2026-09-13', unidades: 0, custo: 50 }], null, '2026-09', HOJE);
    ok(u18.custoMes === 250 && u18.unidadesMes === 100 && u18.custoPorUnidade === 1 && SHC.moeda(u18.custoPorUnidade) === 'R$ 1,00' && /R\$ 250,00 gastos em remessas este mês$/.test(P.remessasResumoTxt(u18)),
        'R$ 100,00 com 100 un. + R$ 100,00 sem unidades + R$ 50,00 com 0 un.: gasto do mês R$ 250,00; R$ 1,00 por unidade (só a que tem unidades), não R$ 2,50');
    const r18 = lcg(1818), g18 = lote();
    let semUn = 0;
    for (let k = 0; k < 400; k++) {
        const rs = Array.from({ length: ent(r18, 1, 7) }, (_, j) => ({ id: String(8410000 + k * 10 + j), status: pega(r18, ['closed_ok', 'closed_with_changes', 'expired', 'in_transit']),
            recebida: dia(ent(r18, 0, 40)), unidades: pega(r18, [null, 0, ent(r18, 1, 500), ent(r18, 1, 500)]), custo: ent(r18, 0, 4) ? ent(r18, 1, 150000) / 100 : null }));
        const rr = SHC.remessasResumo(rs, null, '2026-09', HOJE), base = rs.filter(x => x.recebida.slice(0, 7) === '2026-09' && /^closed_/.test(x.status) && x.custo > 0);
        const com = base.filter(x => x.unidades > 0), cU = com.reduce((s, x) => s + cent(x.custo), 0), uU = com.reduce((s, x) => s + x.unidades, 0);
        if (base.length > com.length) semUn++;
        g18.conta(rr.unidadesMes === uU && (uU > 0 ? emCentavos(rr.custoPorUnidade) && bateMeio(cent(rr.custoPorUnidade), cU, uU) : rr.custoPorUnidade === null), { k, rs, cpu: rr.custoPorUnidade, cU, uU });
    }
    okLote(g18, `#18 custo por unidade (${semUn} meses com remessa recebida sem unidades): Σ cobrança ÷ Σ unidades só das recebidas com unidades (meio centavo)`);
}

console.log('E. Detalhe da remessa (SHC.mlRemessaDetalheDoEstado): multa = Σ das penalidades; o que não veio = null');
{
    const d = SHC.mlRemessaDetalheDoEstado({ appProps: { pageProps: { view: { data: {
        inboundId: 8200001, status: 'closed_with_changes', unitsDetail: { sent: 50, received: 47, missing: 3 }, volumesDetail: [],
        units: [{ itemId: 'MLB7500000001', sku: 'SKU-T1', declaredQuantity: 30, processedQuantity: 28, differencesQuantity: -2, readyToFullQuantity: 27, notReadyToFullQuantity: 1 },
            { itemId: 'MLB7500000002', sku: 'SKU-T2', declaredQuantity: 20, processedQuantity: 19, differencesQuantity: -1, readyToFullQuantity: 19, notReadyToFullQuantity: 0 }],
        charges: [{ type: 'COLLECTION', amount: 120.1 }, { type: 'PENALTY_LABEL', amount: 30.2 }, { type: 'penalty', amount: '19,70' }, { type: 'FINE', amount: null }, { type: 'X', amount: 'abc' }],
    } } } } });
    ok(d.cobrancas.length === 3 && d.cobrancas.map(c => c.valor).join('|') === '120.1|30.2|19.7', 'cobranças com número (R$ 120,10 · R$ 30,20 · "19,70"); null e "abc" ficam de fora');
    ok(d.multa.ativa && d.multa.valor === 49.9 && SHC.moeda(d.multa.valor) === 'R$ 49,90', 'multa = Σ das cobranças de penalidade = R$ 30,20 + R$ 19,70 = R$ 49,90 (a coleta de R$ 120,10 não é multa)');
    ok(d.unidades.enviadas === 50 && d.unidades.recebidas === 47 && d.unidades.faltando === 3 && d.unidades.inesperadas === null, 'unidades do ML; "a mais" que não veio = null (não 0)');
    const v = SHC.mlRemessaDetalheDoEstado({ inboundId: 8200002, status: 'receiving', units: [{ itemId: 'MLB7500000003' }] });
    ok(v.multa.ativa === false && v.multa.valor === null && v.cobrancas.length === 0 && Object.values(v.unidades).every(x => x === null)
        && ['declaradas', 'processadas', 'diferencas', 'aptas', 'naoAptas'].every(k => v.produtos[0][k] === null), 'detalhe sem cobrança nem contagem: tudo null (nada de R$ 0,00 nem 0 un.)');
    const r = lcg(55003), l = lote();
    for (let k = 0; k < 400; k++) {
        const charges = [], n = ent(r, 0, 6);
        let pen = 0, temPen = false, num = 0;
        for (let j = 0; j < n; j++) {
            const tipo = pega(r, ['COLLECTION', 'STORAGE', 'pickup', 'PENALTY_LABEL', 'multa por atraso', 'FINE_NO_SHOW']), c = ent(r, 0, 90000), fm = ent(r, 0, 5);
            const val = fm <= 2 ? c / 100 : fm === 3 ? brTxt(c) : fm === 4 ? null : 'x';
            const campo = pega(r, ['amount', 'value', 'total']);
            charges.push({ type: tipo, [campo]: val });
            if (fm <= 3) { num++; if (/penal|multa|fine/i.test(tipo)) { pen += c; temPen = true; } }
        }
        const x = SHC.mlRemessaDetalheDoEstado({ inboundId: 8300000 + k, status: 'closed_ok', charges });
        l.conta(x.cobrancas.length === num && x.cobrancas.every(c => typeof c.valor === 'number' && isFinite(c.valor))
            && (temPen ? x.multa.ativa && emCentavos(x.multa.valor) && cent(x.multa.valor) === pen : !x.multa.ativa && x.multa.valor === null), { charges, multa: x.multa, pen });
    }
    okLote(l, 'detalhes gerados: multa = Σ das penalidades em centavos; sem penalidade = null; cobrança sem número fica de fora');
}

console.log('F. Remessa com diferença: SHC.remessasInconformes, SHC.chamadoRemessa e o sino (SHC.anomalias)');
{
    const det = { porId: { 8200001: SHC.mlRemessaDetalheDoEstado({ inboundId: 8200001, status: 'closed_with_changes', unitsDetail: { sent: 50, received: 47, missing: 3 },
        claims: { typesClaimsAvailable: [{ type: 'RECOUNT', enabledToClaim: true }], claimsList: [] },
        units: [{ itemId: 'MLB7500000001', sku: 'SKU-T1', declaredQuantity: 30, processedQuantity: 28, differencesQuantity: -2, readyToFullQuantity: 27, notReadyToFullQuantity: 1 },
            { itemId: 'MLB7500000002', sku: 'SKU-T2', declaredQuantity: 20, processedQuantity: 19, differencesQuantity: -1, readyToFullQuantity: 19, notReadyToFullQuantity: 0 }] }) } };
    const lista = [{ id: '8200001', status: 'closed_with_changes', recebida: '2026-09-10', unidades: 50, aptas: 46, custo: 312.4, multa: null, multaFlag: false },
        { id: '8200009', status: 'closed_with_changes', recebida: '2026-09-11', unidades: 10, aptas: 8, custo: 0, multa: null, multaFlag: false }];
    const inc = SHC.remessasInconformes(lista, det, HOJE), a = inc.find(x => x.id === '8200001'), b = inc.find(x => x.id === '8200009');
    ok(a.declaradas === 50 && a.aptas === 46 && a.custo === 312.4, 'declaradas = 30 + 20 = 50; aptas = 27 + 19 = 46 (Σ dos produtos); o ML cobrou R$ 312,40');
    ok(b.custo === null && b.declaradas === 10 && b.aptas === 8, 'remessa sem cobrança (0): custo null, não R$ 0,00');
    const ta = SHC.chamadoRemessa(a), tb = SHC.chamadoRemessa(b);
    ok(ta.indexOf('Total cobrado pelo Mercado Livre nesta remessa (coleta e/ou penalidade): R$ 312,40.') >= 0 && !/multa/i.test(ta) && limpo(ta),
        'reclamação: "Total cobrado … (coleta e/ou penalidade): R$ 312,40." e nunca "multa"');
    ok(!/Total cobrado/.test(tb) && !/R\$/.test(tb) && /declaradas: 10; disponíveis para venda: 8/.test(tb), 'sem cobrança: a reclamação não inventa "R$ 0,00" e usa as unidades da lista');
    const an = SHC.anomalias('900000001', { remessas: SHC.remessasResumo(lista, det, '2026-09', HOJE) });
    const it = an.itens.find(x => x.remessaId === '8200001'), ib = an.itens.find(x => x.remessaId === '8200009');
    ok(it && /o ML cobrou R\$ 312,40/.test(it.texto) && !/multa/i.test(it.texto) && ib && !/R\$/.test(ib.texto), 'sino: "o ML cobrou R$ 312,40" (não "multa"); a sem cobrança não mostra R$');
    // Gerados: declaradas/aptas = Σ dos produtos; custo = total_charged > 0 ou null.
    const r = lcg(66011), l = lote(), lt = [], dt = { porId: {} }, ora = {};
    for (let k = 0; k < 300; k++) {
        const id = String(8600000 + k), ps = [], nP = ent(r, 0, 5);
        let sd = 0, sa = 0, temD = false, temA = false;
        for (let j = 0; j < nP; j++) {
            const dq = ent(r, 0, 3) ? ent(r, 0, 200) : null, rq = ent(r, 0, 3) ? ent(r, 0, 200) : null;
            if (dq !== null) { sd += dq; temD = true; } if (rq !== null) { sa += rq; temA = true; }
            ps.push({ itemId: 'MLB76' + String(k * 10 + j).padStart(8, '0'), sku: 'G' + k + '-' + j, declaredQuantity: dq, processedQuantity: rq, differencesQuantity: dq !== null && rq !== null ? rq - dq : null,
                readyToFullQuantity: rq, notReadyToFullQuantity: ent(r, 0, 4) ? 0 : ent(r, 1, 5) });
        }
        const c = ent(r, 0, 3) ? ent(r, 1, 300000) : pega(r, [0, null]), un = ent(r, 1, 900), ap = ent(r, 0, un);
        lt.push({ id, status: pega(r, ['closed_ok', 'closed_with_changes']), recebida: dia(ent(r, 0, 80)), unidades: un, aptas: ap, custo: c === null ? null : c / 100 });
        if (nP && ent(r, 0, 3)) dt.porId[id] = SHC.mlRemessaDetalheDoEstado({ inboundId: id, status: 'closed_with_changes', units: ps });
        ora[id] = { sd: temD ? sd : null, sa: temA ? sa : null, c, un, ap, comDet: !!dt.porId[id] };
    }
    const g = SHC.remessasInconformes(lt, dt, HOJE);
    g.forEach(x => {
        const o = ora[x.id], dEsp = o.comDet && o.sd !== null ? o.sd : o.un, aEsp = o.comDet && o.sa !== null ? o.sa : o.ap;
        const tx = SHC.chamadoRemessa(x);
        l.conta(x.declaradas === dEsp && x.aptas === aEsp && inteiroNN(x.declaradas) && inteiroNN(x.aptas)
            && (o.c > 0 ? cent(x.custo) === o.c && tx.indexOf('(coleta e/ou penalidade): ' + reais(o.c) + '.') >= 0 : x.custo === null && !/R\$/.test(tx)) && !/multa/i.test(tx) && limpo(tx),
            { id: x.id, x: { d: x.declaradas, a: x.aptas, c: x.custo }, o });
    });
    okLote(l, g.length + ' remessas com diferença geradas: declaradas/aptas = Σ dos produtos (ou a lista), o R$ do texto = total_charged, sem "multa"');
}

console.log('G. Próxima remessa: SHC.simulaRemessa (custo estimado da coleta) e P.skusParaSimular');
{
    const base = [{ id: '1', status: 'closed_ok', recebida: '2026-09-01', unidades: 30, custo: 100 }, { id: '2', status: 'closed_with_changes', recebida: '2026-09-02', unidades: 7, custo: 50 },
        { id: '3', status: 'in_transit', agendada: '2026-09-30', unidades: 9, custo: 999 }, { id: '4', status: 'closed_ok', recebida: '2026-09-03', unidades: 0, custo: 10 },
        { id: '5', status: 'closed_ok', recebida: '2026-09-04', unidades: 20, custo: null }];
    const s = SHC.simulaRemessa({ skus: [{ sku: 'S1', qtd: 100, medidas: { ordenadas: [10, 10, 10], pesoKg: 1 } }], remessasAnteriores: base });
    const ce = s.custoEstimado;
    ok(ce && ce.base === 2 && ce.valor === 523.81 && ce.min === 333.33 && ce.max === 714.29 && ce.porUnidade === 5.24,
        'média por unidade só das fechadas com cobrança e unidades (R$ 100/30 e R$ 50/7): R$ 523,81 para 100 un. (de R$ 333,33 a R$ 714,29)');
    ok(ce.min <= ce.valor && ce.valor <= ce.max && [ce.valor, ce.min, ce.max, ce.porUnidade].every(emCentavos), 'mín ≤ estimado ≤ máx, tudo em centavos');
    const sem = SHC.simulaRemessa({ skus: [{ sku: 'S1', qtd: 5 }], remessasAnteriores: [base[2]] });
    ok(sem.custoEstimado === null && !/R\$/.test(sem.custoMotivo) && /ainda não há remessa fechada com cobrança/.test(sem.custoMotivo), 'sem remessa fechada com cobrança: sem custo (nada de R$ 0,00), com o motivo');
    const sk = P.skusParaSimular([{ p: { sku: 'A', titulo: 'A' }, qtd: 7 }, { p: { sku: 'B', titulo: 'B' }, qtd: 3 }, { p: { sku: 'C', titulo: 'C' }, qtd: 0 }, { p: { sku: 'D', titulo: 'D' }, qtd: 4 }],
        { A: '2,6', B: '-4', D: 'abc' }, null);
    ok(sk.map(x => x.sku + '=' + x.qtd).join(' ') === 'A=3 B=0 D=0', 'quantidade digitada: "2,6" → 3, "-4" → 0, "abc" → 0; sem envio nem digitação fica de fora (C)');
    const s2 = SHC.simulaRemessa({ skus: [{ sku: 'X', qtd: '2,6' }, { sku: 'Y', qtd: -3 }, { sku: 'Z', qtd: 'abc' }, { sku: 'W', qtd: 4.4 }] });
    ok(s2.unidades === 7 && s2.itens.map(i => i.qtd).join('|') === '3|4', 'o simulador soma só unidades inteiras ≥ 0 (2,6 → 3; 4,4 → 4; −3 e "abc" saem)');
    const r = lcg(44021), l = lote();
    for (let k = 0; k < 300; k++) {
        const rs = Array.from({ length: ent(r, 0, 9) }, (_, j) => ({ id: String(j), status: pega(r, ['closed_ok', 'closed_with_changes', 'in_transit', 'receiving']), recebida: dia(ent(r, 0, 200)),
            unidades: ent(r, 0, 3) ? ent(r, 0, 500) : null, custo: ent(r, 0, 3) ? ent(r, 0, 300000) / 100 : null }));
        const un = ent(r, 0, 900), x = SHC.simulaRemessa({ skus: [{ sku: 'K', qtd: un }], remessasAnteriores: { remessas: rs } });
        const bs = rs.filter(q => /^closed_/.test(q.status) && q.custo > 0 && q.unidades > 0).sort((a, b) => b.recebida.localeCompare(a.recebida)).slice(0, 5);
        const c = x.custoEstimado;
        if (!bs.length || !un) { l.conta(c === null && limpo(x.custoMotivo), { k, c }); continue; }
        const pu = bs.map(q => q.custo / q.unidades), med = pu.reduce((a, b) => a + b, 0) / pu.length;
        l.conta(c && c.base === bs.length && [c.valor, c.min, c.max, c.porUnidade].every(emCentavos) && Math.abs(c.valor - med * un) <= 0.005 + 1e-9
            && c.min <= c.valor && c.valor <= c.max && Math.abs(c.porUnidade - med) <= 0.005 + 1e-9 && Math.abs(c.porUnidade * un - c.valor) <= 0.005 * un + 0.005 + 1e-9, { k, un, bs, c });
    }
    okLote(l, 'simulações geradas: estimado = média por unidade × un. (meio centavo), mín ≤ estimado ≤ máx, e "por unidade" × un. difere no máximo meio centavo por unidade');
    // #17: só remessas RECEBIDAS entram no custo da coleta (o mesmo filtro do R$/un. do cartão); a cobrança de remessa vencida ou cancelada
    // (penalidade de remessa que nem foi coletada) não vira custo de coleta. Antes: R$ 160,25 (R$ 1,60/un.) em vez de R$ 120,50.
    const v17 = [{ id: '9100001', status: 'closed_ok', recebida: '2026-09-10', unidades: 100, custo: 120.5 },
        { id: '9100002', status: 'expired', agendada: '2026-09-15', unidades: 40, custo: 80, multaFlag: true, multaTipo: 'NO_SHOW' },
        { id: '9100003', status: 'cancelled', agendada: '2026-09-16', unidades: 10, custo: 35 }];
    const c17 = SHC.simulaRemessa({ skus: [{ sku: 'S1', qtd: 100, medidas: { ordenadas: [10, 10, 10], pesoKg: 1 } }], remessasAnteriores: v17 }).custoEstimado;
    ok(c17 && c17.base === 1 && c17.valor === 120.5 && c17.min === 120.5 && c17.max === 120.5 && c17.porUnidade === 1.21
        && c17.porUnidade === SHC.remessasResumo(v17, null, '2026-09', HOJE).custoPorUnidade,
        'recebida R$ 120,50/100 un. + vencida R$ 80,00 + cancelada R$ 35,00: custo estimado R$ 120,50 (R$ 1,21/un., o mesmo R$/un. do cartão de remessas)');
    ok(SHC.simulaRemessa({ skus: [{ sku: 'S1', qtd: 5 }], remessasAnteriores: v17.slice(1) }).custoEstimado === null, 'só vencida e cancelada cobradas: sem custo estimado (nenhuma coleta recebida para aprender)');
    const r17 = lcg(1717), g17 = lote();
    let comPen = 0;
    for (let k = 0; k < 400; k++) {
        const rs = Array.from({ length: ent(r17, 0, 9) }, (_, j) => ({ id: String(j), status: pega(r17, STS.concat(['canceled'])), recebida: dia(ent(r17, 0, 200)),
            unidades: ent(r17, 0, 3) ? ent(r17, 0, 500) : null, custo: ent(r17, 0, 3) ? ent(r17, 0, 300000) / 100 : null }));
        const un = ent(r17, 1, 900), x = SHC.simulaRemessa({ skus: [{ sku: 'K', qtd: un }], remessasAnteriores: rs });
        const bs = rs.filter(q => /^closed_(ok|with_changes)$/.test(q.status) && q.custo > 0 && q.unidades > 0).sort((a, b) => b.recebida.localeCompare(a.recebida)).slice(0, 5);
        if (rs.some(q => /cancel|expired/.test(q.status) && q.custo > 0 && q.unidades > 0)) comPen++;
        if (!bs.length) { g17.conta(x.custoEstimado === null, { k, rs, c: x.custoEstimado }); continue; }
        const pu = bs.map(q => q.custo / q.unidades), med = pu.reduce((a, b) => a + b, 0) / pu.length, c = x.custoEstimado;
        g17.conta(c && c.base === bs.length && Math.abs(c.valor - med * un) <= 0.005 + 1e-9 && Math.abs(c.min - Math.min(...pu) * un) <= 0.005 + 1e-9
            && Math.abs(c.max - Math.max(...pu) * un) <= 0.005 + 1e-9, { k, rs, un, c });
    }
    okLote(g17, `#17 simulações com todos os status (${comPen} com vencida/cancelada cobrada): só as recebidas entram no custo da coleta`);
}

console.log('H. Rateio do Full na etiqueta (SHC.fullRateioUn): armazenagem + coleta de 30 dias ÷ unidades vendidas');
{
    const linhas = [{ id: '1|1|CFWA', data: dia(3), valor: 150.25 }, { id: '2|2|BFWA', data: dia(2), valor: 20.25 }, { id: '3|3|CFCBE', data: dia(10), valor: 70 },
        { id: '4|4|CFWA', data: dia(40), valor: 999 }, { id: '5|5|CVVML', data: dia(1), valor: 500 }];
    const x = SHC.fullRateioUn(linhas, [{ vendas30: 40 }, { vendas30: 60 }], HOJE, 2);
    ok(x && x.custo === 200 && x.unidades === 100 && x.un === 2 && SHC.moeda(x.un) === 'R$ 2,00',
        'R$ 150,25 − R$ 20,25 (estorno) + R$ 70,00 = R$ 200,00 ÷ 100 un. = R$ 2,00 (fora dos 30 dias e tarifa de venda não entram)');
    ok(SHC.fullRateioUn(linhas, [{ vendas30: 40 }], HOJE, 2) === null, 'lista do Full lida só em parte (1 de 2): sem rateio (menos unidades = rateio inflado)');
    ok(SHC.fullRateioUn([linhas[1]], [{ vendas30: 10 }], HOJE, 1) === null && SHC.fullRateioUn(linhas, [{ vendas30: 0 }], HOJE, 1) === null, 'só estorno ou nenhuma venda: sem rateio (nunca R$ 0,00 nem divisão por zero)');
    const desde = (() => { const d = new Date(HOJE + 'T12:00:00'); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); })();
    const r = lcg(31337), l = lote();
    for (let k = 0; k < 500; k++) {
        const ls = [], n = ent(r, 0, 25);
        let cC = 0;
        for (let j = 0; j < n; j++) {
            const cod = pega(r, ['CFWA', 'BFWA', 'CFCBE', 'BFCBE', 'CVVML', 'CXD', 'CFBA']), d = dia(ent(r, 0, 45)), c = ent(r, 0, 80000);
            ls.push({ id: 'E' + k + '|' + j + '|' + cod, data: d, valor: c / 100 });
            if (/^[CB](FWA|FCBE)$/.test(cod) && d >= desde) cC += cod[0] === 'B' ? -c : c;
        }
        const ps = Array.from({ length: ent(r, 1, 6) }, () => ({ vendas30: ent(r, 0, 4) ? ent(r, 0, 300) : null })), uC = ps.reduce((s, p) => s + (p.vendas30 || 0), 0);
        const tot = ent(r, 0, 5) ? ps.length : ps.length + 1, x = SHC.fullRateioUn(ls, ps, HOJE, tot);
        if (tot > ps.length || cC <= 0 || uC <= 0) { l.conta(x === null, { k, x, cC, uC }); continue; }
        l.conta(x && emCentavos(x.custo) && cent(x.custo) === cC && x.unidades === uC && emCentavos(x.un) && bateMeio(cent(x.un), cC, uC)
            && Math.abs(x.un * uC - x.custo) <= 0.005 * uC + 1e-9, { k, x, cC, uC });
    }
    okLote(l, 'rateios gerados: custo = Σ cobranças − Σ estornos (FWA/FCBE, 30 dias) em centavos; R$/un. = custo ÷ unidades (meio centavo); senão null');
}

console.log('I. Custos do Full no fechamento do mês (SHC.fechamentoDasCobrancas): armazenagem, estoque antigo e coleta');
{
    const cobs = [
        { id: 'E1|1|CFWA', data: '2026-09-03', valor: 12.34, texto: 'Tarifa pelo serviço de armazenamento Full', estorno: false },
        { id: 'E2|2|BFWA', data: '2026-09-05', valor: 2.34, texto: 'Cancelamento da tarifa pelo serviço de armazenamento Full' },
        { id: 'E3|3|CFBA', data: '2026-09-07', valor: 45.67, texto: 'Tarifa por estoque antigo no Full', estorno: false },
        { id: 'E4|4|CFCBE', data: '2026-09-08', valor: 88.8, texto: '', estorno: false },
        { id: 'E5|5|CVVML', data: '2026-09-09', valor: 10.01, texto: 'Custo por vender', estorno: false },
    ];
    const m = SHC.fechamentoDasCobrancas(cobs)['2026-09'];
    ok(m.porTipo.full === 144.47 && m.estornosPorTipo.full === -2.34 && m.porTipo.tarifa_venda === 10.01 && m.total === 154.48 && m.estornos === -2.34,
        'Full = R$ 12,34 − R$ 2,34 (estorno, negativo) + R$ 45,67 (estoque antigo) + R$ 88,80 (coleta, pelo código) = R$ 144,47; total = Σ dos tipos');
    const r = lcg(90210), cs = [], ora = {};
    const TX = [['Tarifa pelo serviço de armazenamento Full', 'FWA'], ['Tarifa por estoque antigo no Full', 'FBA'], ['', 'FCBE'], ['', 'FPB'], ['Tarifa de envios Full', 'FRS'],
        ['Custo por vender', 'VVML'], ['Tarifa de envio', 'XD'], ['Product Ads', 'PADS']];
    for (let k = 0; k < 600; k++) {
        const [t, cod] = pega(r, TX), est = !ent(r, 0, 4), c = ent(r, 0, 300000), d = '2026-0' + ent(r, 6, 9) + '-' + String(ent(r, 1, 28)).padStart(2, '0');
        const modo = ent(r, 0, 2);   // estorno pela chave, pelo texto "Cancelamento …" ou os dois
        const texto = est && modo !== 0 && t ? 'Cancelamento da ' + t.charAt(0).toLowerCase() + t.slice(1) : t;
        const cb = { id: 'G' + k + '|' + k + '|' + (est ? 'B' : 'C') + cod, data: d, valor: c / 100, texto };
        if (!(est && modo === 1 && t)) cb.estorno = est;
        cs.push(cb);
        const o = ora[d.slice(0, 7)] || (ora[d.slice(0, 7)] = { full: 0, estFull: 0, total: 0, est: 0 });
        const tipo = SHC.tipoCustoFechamento(texto, cb.id), v = est ? -c : c;
        o.total += v; if (est) o.est += v;
        if (tipo === 'full') { o.full += v; if (est) o.estFull += v; }
        if (/^(FWA|FBA|FCBE|FPB|FRS)$/.test(cod) && tipo !== 'full') o.erroTipo = cb;
    }
    const fm = SHC.fechamentoDasCobrancas(cs), l = lote();
    Object.keys(ora).forEach(mes => {
        const a = fm[mes], o = ora[mes], somaTipos = Object.keys(a.porTipo).reduce((s, t) => s + cent(a.porTipo[t]), 0);
        l.conta(!o.erroTipo && emCentavos(a.porTipo.full) && cent(a.porTipo.full) === o.full && cent((a.estornosPorTipo || {}).full || 0) === o.estFull && o.estFull <= 0
            && cent(a.total) === o.total && somaTipos === o.total && cent(a.estornos) === o.est, { mes, a: { full: a.porTipo.full, est: a.estornosPorTipo, total: a.total }, o });
    });
    okLote(l, 'meses gerados: Full = Σ cobranças − Σ estornos (por texto ou código), estorno ≤ 0, total = Σ dos tipos, em centavos');
}

console.log('J. Previsão de 30 dias (P.previsaoFull) contra o oráculo em inteiros');
{
    const oraculo = (v30, vm, hoje, lidos, aptas) => {
        const ult30 = v30 === null ? null : Math.max(0, v30);
        const mm = d => d.slice(0, 7), mes = mesMenos12(mm(dia(-15, hoje))), base = mesMenos12(mm(dia(15, hoje)));
        const doMes = m => (vm && vm[m] !== undefined && vm[m] !== null ? vm[m] : (vm && lidos.indexOf(m) >= 0 ? 0 : null));
        const a = doMes(mes), ano = a === null ? null : Math.max(0, a);
        if (ult30 === 0 && aptas > 0) return { qtd: 0, fonte: 'parado' };
        const b = base === mes ? null : doMes(base);
        const ic = ult30 > 0 && ano !== null && b >= 3 && ano > b ? divMeio(ano * 100, b) : null;   // índice em centésimos
        const idx = ic ? { q: Math.min(300, ic.q), empate: ic.empate && ic.q <= 300 } : null;
        const saz = idx ? ceilDiv(ult30 * idx.q, 100) : null;
        const qtd = ult30 === null && ano === null ? null : Math.max(ult30 || 0, ano || 0, saz || 0);
        const fonte = saz !== null && qtd === saz && saz > Math.max(ult30 || 0, ano || 0) ? 'sazonal' : ano !== null && (ult30 === null || ano > ult30) ? 'anoPassado' : 'ult30';
        return { qtd, fonte, idx, mes, base };
    };
    const r = lcg(12021), l = lote(), inv = lote();
    let saz = 0, par = 0;
    for (let k = 0; k < 4000; k++) {
        const hoje = dia(ent(r, 0, 400)), v30 = ent(r, 0, 5) ? ent(r, -2, 200) : null, aptas = ent(r, 0, 2) ? ent(r, 0, 300) : null, lidos = [], vm = ent(r, 0, 6) ? {} : null;
        const o0 = oraculo(0, {}, hoje, [], 0);
        if (vm) [o0.mes, o0.base].forEach(m => { const t = ent(r, 0, 4); if (t === 0) lidos.push(m); else if (t > 1) vm[m] = ent(r, 0, 3) ? ent(r, 0, 300) : ent(r, -5, 2); });
        const x = P.previsaoFull(v30, vm, hoje, lidos, { aptas }), o = oraculo(v30, vm, hoje, lidos, aptas);
        // empate exato de meio centésimo no índice: o r2 do produto pode ir para baixo (registrado na auditoria do fechamento) — aceita o vizinho.
        const vizinho = o.idx && o.idx.empate && x.indice !== null && cent(x.indice) === o.idx.q - 1;
        const bate = vizinho ? x.qtd === Math.max(v30 || 0, x.anoPassado || 0, ceilDiv(Math.max(0, v30) * (o.idx.q - 1), 100)) : x.qtd === o.qtd && x.fonte === o.fonte && (o.idx ? cent(x.indice) === o.idx.q : x.indice === null);
        l.conta(bate, { hoje, v30, aptas, vm, lidos, produto: x, oraculo: o });
        inv.conta(x.qtd === null ? (v30 === null && x.anoPassado === null) : inteiroNN(x.qtd) && (x.fonte === 'parado' ? x.qtd === 0 : x.qtd >= (x.ult30 || 0) && x.qtd >= (x.anoPassado || 0) && x.qtd <= Math.max(x.anoPassado || 0, 3 * (x.ult30 || 0))),
            { v30, x });
        if (x.fonte === 'sazonal') saz++; if (x.fonte === 'parado') par++;
    }
    okLote(l, `previsões geradas = oráculo (${saz} sazonais, ${par} paradas): o maior entre 30 dias, ano passado e 30 dias × índice (até 3×, arredondado para cima)`);
    okLote(inv, 'previsão: inteiro ≥ 0; ≥ 30 dias e ≥ ano passado; ≤ 3× os 30 dias (ou o ano passado); null só sem os dois números; parado = 0');
    // #21: a explicação sazonal mostra a conta que fecha, com os números da conta (oráculo em centésimos): "U × I = C → Q (arredondado para cima)"
    // e, quando U × I é inteiro, "U × I = Q". Antes: "usei 7 × 1,33 = 10" (7 × 1,33 = 9,31).
    const virg = c => String(Math.floor(c / 100)) + (c % 100 ? ',' + (c % 10 ? String(c % 100).padStart(2, '0') : String(c % 100 / 10)) : '');
    const rs = lcg(2121), ts = lote();
    let inteiras = 0;
    for (let k = 0; k < 3000; k++) {
        const u = ent(rs, 1, 400), b = ent(rs, 3, 120), a = b + ent(rs, 1, 2 * b), vm = { '2025-09': b, '2025-10': a };
        const x = P.previsaoFull(u, vm, HOJE, [], { aptas: ent(rs, 0, 50) });
        if (x.fonte !== 'sazonal') continue;
        const ic = cent(x.indice), c = u * ic, q = ceilDiv(c, 100), e = P.explicaFull({ prev: x, p: {}, semDado: ['as unidades aptas'], lucro: null }, 30).linhas[0];
        if (c % 100 === 0) inteiras++;
        const fim = `usei ${u} × ${virg(ic)} = ` + (c % 100 ? `${virg(c)} → ${q} (arredondado para cima).` : `${q}.`);
        ts.conta(x.qtd === q && limpo(e) && e.endsWith(fim) && e.indexOf(`(${virg(ic)}×)`) >= 0, { u, vm, x, e, fim });
    }
    okLote(ts, `#21 explicação sazonal: "U × I = C → Q (arredondado para cima)" com a conta exata em centésimos (${inteiras} contas inteiras: "U × I = Q")`);
    const ex21 = (u, b, a) => P.explicaFull({ prev: P.previsaoFull(u, { '2025-09': b, '2025-10': a }, HOJE, [], {}), p: {}, semDado: ['as unidades aptas'], lucro: null }, 30).linhas[0];
    const e7 = ex21(7, 3, 4), e6 = ex21(6, 4, 6);
    ok(e7 === 'Nos últimos 30 dias você vendeu 7. No ano passado, out/25 vendeu 4 contra 3 em set/25 (1,33×): usei 7 × 1,33 = 9,31 → 10 (arredondado para cima).'
        && /usei 6 × 1,5 = 9\.$/.test(e6), 'à mão: "usei 7 × 1,33 = 9,31 → 10 (arredondado para cima)" (antes "= 10") e "usei 6 × 1,5 = 9." — ' + e7.replace(/^.*usei /, 'usei '));
}

console.log('K. Plano de envio (P.planoFull + P.explicaFull): quantidade = alvo − aptas − a caminho, nunca negativa');
{
    const r = lcg(424242), l = lote(), esp = lote(), tx = lote(), ordem = lote(), es = lote();
    let exatos = 0, limitados = 0, travados = 0, cautelas = 0, semDado = 0;
    for (let k = 0; k < 400; k++) {
        const nP = ent(r, 1, 12), pool = Array.from({ length: Math.max(1, nP - ent(r, 0, 3)) }, (_, j) => 'MLB77' + String(k * 100 + j).padStart(8, '0'));
        const unTxt = v => (v === null ? pega(r, [null, '—', 'sem dado']) : pega(r, [v, v, v + ' un.', milhar(v) + ' un.']));
        const prods = Array.from({ length: nP }, (_, j) => {
            const ap = ent(r, 0, 9) ? ent(r, -3, 400) : null, ac = ent(r, 0, 3) ? ent(r, 0, 120) : null, v = ent(r, 0, 7) ? ent(r, 0, 200) : null;
            return { titulo: 'Produto ' + k + '-' + j, sku: ent(r, 0, 4) ? 'SKU-' + k + '-' + j : '', itemIds: [pega(r, pool)], aptas: unTxt(ap), aCaminho: unTxt(ac), vendas30: unTxt(v),
                tamanho: pega(r, ['PEQUENO', 'MÉDIO', 'GRANDE', '']), _ap: ap, _ac: ac };
        });
        const espaco = ent(r, 0, 2) ? [{ id: 'S1', titulo: 'Pequenos e médios', livre: ent(r, 0, 3) ? ent(r, 0, 600) : null }, { id: 'S2', titulo: 'Grandes', livre: ent(r, 0, 300) }] : [];
        const dias = pega(r, [15, 30, 45, 60, 0]), vms = {}, saudes = {}, lucros = {};
        prods.forEach(p => {
            const t = ent(r, 0, 5);
            saudes[p.titulo] = t === 0 ? { bloqueia: ['Experiência de compra ruim (nota 20 de 100): o anúncio fica quase sem exposição e o estoque empaca no Full.'], reduz: [] }
                : t === 1 ? { bloqueia: [], reduz: ['Experiência de compra mediana (nota 60 de 100): o anúncio perde exposição.'] } : { bloqueia: [], reduz: [] };
            vms[p.titulo] = ent(r, 0, 2) ? { '2025-09': ent(r, 0, 80), '2025-10': ent(r, 0, 120), '2025-08': ent(r, 0, 50) } : null;
            const lu = ent(r, 0, 4);
            lucros[p.titulo] = lu === 0 ? null : lu === 1 ? { lucro: null, motivo: pega(r, ['sem_anuncio', 'sem_custo', 'sem_preco']) } : ent(r, -5000, 9000) / 100;
        });
        const pl = P.planoFull({ produtos: prods, espaco }, { hoje: HOJE, dias, vmDe: p => vms[p.titulo], lucroDe: p => lucros[p.titulo], saudeDe: p => saudes[p.titulo] });
        const D = dias > 0 ? dias : 30, livre0 = {};
        espaco.forEach(e => { if (e.livre !== null) livre0[e.id] = e.livre; });
        pl.linhas.forEach(x => {
            const p = x.p, ua = p._ap, uc = p._ac, sd = ua === null || x.prev.qtd === null;
            if (sd) { semDado++; l.conta(x.qtd === null && x.alvo === null && x.bruto === null && x.semDado.length > 0, { t: p.titulo, x: { qtd: x.qtd, sd: x.semDado } }); return; }
            const aptas = Math.max(0, ua), cam = uc === null ? 0 : Math.max(0, uc);
            const trava = saudes[p.titulo].bloqueia.length > 0, cautela = !trava && saudes[p.titulo].reduz.length > 0, du = cautela ? Math.min(D, P.FULL_DIAS_CAUTELA) : D;
            const alvo = trava ? 0 : ceilDiv(x.prev.qtd * du, 30), bruto = Math.max(0, alvo - aptas - cam);
            if (trava) travados++; if (cautela) cautelas++;
            l.conta(x.aptas === aptas && x.aCaminho === cam && x.semCaminho === (uc === null) && x.diasUsados === du && x.alvo === alvo && x.bruto === bruto
                && inteiroNN(x.qtd) && x.qtd <= x.bruto && (trava ? x.qtd === 0 : true), { t: p.titulo, ua, uc, du, prev: x.prev.qtd, x: { alvo: x.alvo, bruto: x.bruto, qtd: x.qtd }, alvo, bruto });
            if (x.seg === null || livre0[x.seg] === undefined) esp.conta(x.qtd === x.bruto && !x.limitado, { t: p.titulo, seg: x.seg, qtd: x.qtd, bruto: x.bruto });
            else { esp.conta(x.livreAntes >= 0 && x.qtd === Math.min(x.bruto, x.livreAntes) && x.limitado === (x.qtd < x.bruto), { t: p.titulo, x }); if (x.limitado) limitados++; }
            // Dias até acabar (aptas + a caminho ÷ previsão de 1 dia): oráculo em inteiros ⌊(aptas + a caminho) × 30 ÷ previsão⌋ — #20: a conta exata
            // não perde mais 1 dia (antes o teste aceitava o −1 nas contas exatas).
            if (x.prev.qtd > 0) {
                const exato = ((aptas + cam) * 30) % x.prev.qtd === 0, o = Math.floor((aptas + cam) * 30 / x.prev.qtd);
                if (exato) exatos++;
                es.conta(Number.isInteger(x.esgota) && x.esgota >= 0 && x.esgota === o, { aptas, cam, prev: x.prev.qtd, esgota: x.esgota, o });
            } else es.conta(x.esgota === null, { prev: x.prev.qtd, esgota: x.esgota });
            // O texto da tela: os mesmos números da conta.
            const e = P.explicaFull(x, D).linhas.join(' ');
            const conta = `Para ${du} dias: ${x.prev.qtd} × ${du} ÷ 30 = ${alvo}${(x.prev.qtd * du) % 30 ? ' (arredondado para cima)' : ''}; menos ${aptas} aptas e ${cam} a caminho = ${bruto}.`;
            const lu = x.lucro;
            tx.conta(limpo(e) && (trava ? e.indexOf('Não sugeri envio: ') >= 0 && e.indexOf('Para ') < 0 : e.indexOf(conta) >= 0)
                && (!x.limitado || e.indexOf(`você pode enviar até ${x.qtd}.`) >= 0) && (uc !== null || trava || e.indexOf('contei 0') >= 0)
                && (x.semAnuncio || (lu === null ? !/R\$/.test(e) : e.indexOf(lu < 0 ? `prejuízo de ${SHC.moeda(-lu)} por unidade` : `Lucro por unidade no preço de hoje: ${SHC.moeda(lu)}.`) >= 0)),
                { t: p.titulo, e, conta });
        });
        Object.keys(livre0).forEach(s => {
            const usado = pl.linhas.filter(x => x.seg === s && x.qtd !== null).reduce((a, x) => a + x.qtd, 0);
            esp.conta(usado <= livre0[s] && pl.livre[s] === livre0[s] - usado && pl.livre[s] >= 0, { s, livre0: livre0[s], usado, sobra: pl.livre[s] });
        });
        const pos = pl.linhas.map(x => (x.bruto > 0 ? 1 : 0));
        ordem.conta(pos.every((v, i) => !i || pos[i - 1] >= v), { k, pos });
    }
    okLote(l, `linhas geradas (${travados} travadas, ${cautelas} com cautela, ${semDado} sem dado): alvo = ⌈previsão × dias ÷ 30⌉, quantidade = máx(0, alvo − aptas − a caminho), inteira, ≤ bruto; sem dado = null (nunca 0)`);
    okLote(esp, `espaço livre (${limitados} limitadas): cada linha ≤ o que sobra, Σ do segmento ≤ livre e sobra = livre − Σ (nunca negativa)`);
    okLote(es, `#20 dias até acabar = ⌊(aptas + a caminho) × 30 ÷ previsão⌋, também nas ${exatos} contas exatas`);
    okLote(tx, 'P.explicaFull: "Para D dias: Q × D ÷ 30 = alvo; menos A aptas e C a caminho = quantidade" com os números da linha; lucro/prejuízo no mesmo R$; sem lucro, sem R$');
    okLote(ordem, 'ordem: quem precisa enviar vem antes de quem não precisa');
    // Variações do mesmo anúncio: cada uma fica com a parte dela (nas vendas de 30 dias) e a soma das partes fica a meia unidade por variação do total.
    const vari = P.planoFull({ produtos: [{ titulo: 'V1', itemIds: ['MLB7800000001'], aptas: 0, aCaminho: 0, vendas30: 1 }, { titulo: 'V2', itemIds: ['MLB7800000001'], aptas: 0, aCaminho: 0, vendas30: 1 },
        { titulo: 'V3', itemIds: ['MLB7800000001'], aptas: 0, aCaminho: 0, vendas30: 2 }], espaco: [] }, { hoje: '2026-10-07', dias: 30, vmDe: () => ({ '2025-10': 40 }), lucroDe: () => null });
    const partes = vari.linhas.map(x => x.prev.anoPassado);
    ok(partes.slice().sort((a, b) => a - b).join('|') === '10|10|20' && partes.reduce((a, b) => a + b, 0) === 40 && vari.linhas.every(x => inteiroNN(x.qtd)),
        '3 variações (1, 1 e 2 vendas): o ano passado do anúncio (40) vira 10 + 10 + 20 = 40 e cada quantidade é inteira ≥ 0');
}

console.log('L. Saúde do estoque (P.saudeFull, P.acaoParado, SHC.fullMinimo): unidades sobrando e mínimo');
{
    const r = lcg(5150), l = lote(), t = lote(), m = lote();
    let parados = 0, excedentes = 0, exatos = 0;
    for (let k = 0; k < 3000; k++) {
        const ap = ent(r, 0, 9) ? ent(r, -2, 900) : null, ac = ent(r, 0, 2) ? ent(r, 0, 100) : null, v = ent(r, 0, 6) ? ent(r, 0, 120) : null;
        const prev = ent(r, 0, 6) ? ent(r, 0, 150) : null, mn = ent(r, 0, 2) ? null : pega(r, [ent(r, 1, 300), '40', 0, -5, 'x']);
        const p = { aptas: ap, aCaminho: ac, vendas30: v, tempoEstoque: ent(r, 0, 5) ? 0 : ent(r, 1, 50), diasAteEsgotar: ent(r, 0, 3) ? null : ent(r, 0, 90) };
        const s = P.saudeFull(p, prev, mn === null ? null : { fullMinUn: mn }, '');
        if (ap === null) { l.conta(s.classe === null && s.dias === null && s.cobertura === null && !(s.excesso > 0) && P.acaoParado({ p, saude: s }) === '', { p, s }); continue; }
        const tem = Math.max(0, ap), cob = prev > 0 ? Math.floor(tem * 30 / prev) : null, exato = prev > 0 && (tem * 30) % prev === 0;
        const exc = s.classe === 'parado' ? tem : s.classe === 'excedente' && prev > 0 ? Math.max(0, tem - ceilDiv(prev * 90, 30)) : 0;
        if (s.classe === 'parado') parados++; if (s.classe === 'excedente') excedentes++;
        if (exato) exatos++;
        l.conta(inteiroNN(s.excesso) && s.excesso === exc && s.cobertura === cob, { p, prev, s, exc, cob });   // #20: sem o −1 nas contas exatas
        const a = P.acaoParado({ p, saude: s, travas: [] });
        t.conta(exc > 0 ? a.indexOf(exc + ' un. ') === 0 && !/R\$/.test(a) && limpo(a) : a === '', { exc, a });
        const n = SHC.num(mn), def = n !== null && n >= 1, minUn = def ? Math.round(n) : null, temM = tem + (ac === null ? 0 : Math.max(0, ac)), abaixo = def && temM < minUn;
        const fm = SHC.fullMinimo(p, mn === null ? null : { fullMinUn: mn }, prev, '');
        m.conta(fm.minUn === minUn && fm.tem === temM && fm.abaixo === abaixo && fm.faltam === (abaixo ? minUn - temM : 0) && inteiroNN(fm.faltam)
            && fm.sugerido === (!def && prev > 0 ? ceilDiv(prev * 15, 30) : null), { p, mn, prev, fm });
    }
    okLote(l, `unidades sobrando (${parados} parados, ${excedentes} excedentes): parado = todas as aptas; excedente = aptas − ⌈90 dias de venda⌉; inteiras ≥ 0; cobertura = ⌊aptas × 30 ÷ previsão⌋ (${exatos} exatas)`);
    okLote(t, 'P.acaoParado: o texto começa com o mesmo número ("N un. …") e não inventa R$ de armazenagem (o ML não mostra a tarifa por produto)');
    okLote(m, 'SHC.fullMinimo: faltam = mínimo − (aptas + a caminho), sugerido = ⌈previsão × 15 ÷ 30⌉, mínimo inválido = sem mínimo');
    // #20: conta exata não perde 1 dia por ponto flutuante (23 ÷ (23 ÷ 30) = 29,999… virava 29): painel, plano e ícone.
    const d20 = [[23, 23, 30], [46, 23, 60], [93, 31, 90], [23, 46, 15], [55, 66, 25]].map(([ap, pv, esp]) => {
        const s = P.saudeFull({ aptas: ap, vendas30: pv }, pv, null, ''), it = 'MLB7950000' + String(ap).padStart(3, '0');
        const pl = P.planoFull({ produtos: [{ titulo: 'D' + ap, itemIds: [it], aptas: ap, aCaminho: 0, vendas30: pv }], espaco: [] }, { hoje: HOJE, dias: 30, vmDe: () => null, lucroDe: () => null });
        const a = SHC.alertasDe({ full: { produtos: [{ produtoId: 'D' + ap, sku: 'SKU-D' + ap, itemId: it, itemIds: [it], aptas: ap, aCaminho: 0, vendas30: pv }] }, vm: {}, hoje: HOJE, itens: [],
            custos: { [SHC.chaveSku('SKU-D' + ap)]: { fullMinUn: 999 } } });   // mínimo alto: o ícone lista o produto e mostra os dias
        return s.dias === esp && s.cobertura === esp && pl.linhas[0].esgota === esp && a.lista[0] && a.lista[0].dias === esp;
    });
    ok(d20.every(Boolean), '23 aptas/previsão 23 → 30 dias; 46/23 → 60; 93/31 → 90; 23/46 → 15; 55/66 → 25 (P.saudeFull, P.planoFull e SHC.alertasDe) — ' + d20.join(','));
    const pr = { p: { aptas: 60, vendas30: 0 } }; pr.saude = P.saudeFull(pr.p, 0, null, '');
    ok(pr.saude.excesso === 60 && /^60 un\. paradas/.test(P.acaoParado(pr)) && !/R\$/.test(P.acaoParado(pr)), 'à mão: 60 aptas sem venda → "60 un. paradas…", sem R$');
}

console.log('M. Ícone × painel: SHC.alertasDe conta o mesmo produto que P.saudeFull marca como alerta (mesma previsão)');
{
    const r = lcg(8086), l = lote();
    let sazonais = 0;
    for (let k = 0; k < 2500; k++) {
        const id = 'MLB79' + String(k).padStart(8, '0'), ap = ent(r, 0, 120), v = ent(r, 0, 5) ? ent(r, 0, 150) : null, ac = ent(r, 0, 40);
        const vm = { [id]: {} }; if (ent(r, 0, 2)) vm[id]['2025-10'] = ent(r, 0, 200); if (ent(r, 0, 2)) vm[id]['2025-09'] = ent(r, 0, 100);
        const mn = ent(r, 0, 3) ? null : ent(r, 1, 200), cad = mn === null ? null : { fullMinUn: mn }, sku = 'SKU-M' + k;
        const p = { produtoId: 'P' + k, titulo: 'Produto M' + k, sku, itemId: id, itemIds: [id], aptas: ap, aCaminho: ac, vendas30: v, diasAteEsgotar: ent(r, 0, 4) ? null : ent(r, 0, 60) };
        const prev = P.previsaoFull(v, vm[id], HOJE, [], { aptas: ap }), s = P.saudeFull(p, prev.qtd, cad, '');
        const a = SHC.alertasDe({ full: { produtos: [p] }, vm, hoje: HOJE, itens: [], custos: cad ? { [SHC.chaveSku(sku)]: cad } : {} });
        if (prev.fonte === 'sazonal') sazonais++;
        l.conta((a.full > 0) === s.alerta && a.full <= 1, { p, prev, s: { classe: s.classe, dias: s.dias, alerta: s.alerta }, icone: a.lista.map(x => x.texto) });
        if (a.full) { const it = a.lista[0]; l.conta(it.aptas === ap && it.aCaminho === ac && inteiroNN(it.faltam) && it.dias === s.dias && it.sugerido === s.sugerido, { it, s }); }
    }
    // #19: antes o lote pulava os casos sazonais (71 de 395 com ícone ≠ painel); agora eles entram na asserção.
    okLote(l, `#19 ícone = painel em todos os casos, também nos ${sazonais} com previsão sazonal: o mesmo produto em alerta, as mesmas unidades e os mesmos dias`);
    // À mão (o repro): 12 aptas, 40 vendas em 30 dias; out/25 = 20 e set/25 = 10 → índice 2, previsão 80, acaba em ⌊12 × 30 ÷ 80⌋ = 4 dias.
    // Pelo caminho de verdade de cada lado: painel = P.planoFull → P.saudeFull → P.alertas; ícone = SHC.alertasDe.
    const id19 = 'MLB7300000001', p19 = { produtoId: 'P19', titulo: 'Produto X', sku: 'SKU-X19', itemId: id19, itemIds: [id19], aptas: 12, aCaminho: 0, vendas30: 40 };
    const vm19 = { [id19]: { '2025-09': 10, '2025-10': 20 } }, ctx19 = { hoje: HOJE, dias: 30, vmDe: q => P.somaMeses(P.idsDoFull(q).map(i => vm19[i])), lucroDe: () => null };
    const pl19 = P.planoFull({ produtos: [p19], espaco: [] }, ctx19); pl19.linhas.forEach(x => { x.saude = P.saudeFull(x.p, x.prev.qtd, null, ''); });
    const pa19 = P.alertas(pl19.linhas, [], [], {}), a19 = SHC.alertasDe({ full: { produtos: [p19] }, vm: vm19, hoje: HOJE, itens: [], custos: {} }), x19 = pl19.linhas[0];
    ok(x19.prev.qtd === 80 && x19.prev.fonte === 'sazonal' && x19.saude.classe === 'critico' && x19.saude.dias === 4 && pa19.full === 1
        && a19.full === 1 && a19.lista[0].dias === 4 && a19.lista[0].texto === 'Acaba no Full em 4 dias.',
        `à mão: previsão sazonal 80 (índice 2) → painel "Crítico, acaba em 4 dias" e o ícone conta o produto (ícone ${a19.full}, painel ${pa19.full}; antes o ícone dava 0)`);
    // Variações do mesmo anúncio: o vm|ml é do anúncio inteiro e cada uma fica com a parte dela nas vendas de 30 dias, nos dois lados.
    // 30 + 10 vendas; o anúncio vendeu 8 em set/25 e 24 em out/25 → a de 30 fica com 6 e 18 (índice 3, previsão 90: 20 aptas = 6 dias, crítico);
    // a de 10 fica com 2 e 6 (mês base < 3: sem índice; previsão 10: 60 dias). Antes o ícone dava previsão 30 (20 dias) para a primeira.
    const idv = 'MLB7300000002', vmv = { [idv]: { '2025-09': 8, '2025-10': 24 } };
    const pv = [{ produtoId: 'PV', variacao: 'Azul', titulo: 'Produto V Azul', sku: 'SKU-VA', itemId: idv, itemIds: [idv], aptas: 20, aCaminho: 0, vendas30: 30 },
        { produtoId: 'PV', variacao: 'Verde', titulo: 'Produto V Verde', sku: 'SKU-VV', itemId: idv, itemIds: [idv], aptas: 20, aCaminho: 0, vendas30: 10 }];
    const plv = P.planoFull({ produtos: pv, espaco: [] }, Object.assign({}, ctx19, { vmDe: q => P.somaMeses(P.idsDoFull(q).map(i => vmv[i])) }));
    plv.linhas.forEach(x => { x.saude = P.saudeFull(x.p, x.prev.qtd, null, ''); });
    const av = SHC.alertasDe({ full: { produtos: pv }, vm: vmv, hoje: HOJE, itens: [], custos: {} }), az = plv.linhas.find(x => x.p.variacao === 'Azul'), ve = plv.linhas.find(x => x.p.variacao === 'Verde');
    ok(az.prev.qtd === 90 && az.prev.indice === 3 && az.saude.alerta && az.saude.dias === 6 && ve.prev.qtd === 10 && !ve.saude.alerta
        && av.full === 1 && av.lista[0].sku === 'SKU-VA' && av.lista[0].dias === 6 && P.alertas(plv.linhas, [], [], {}).full === 1,
        'variações (30 + 10 vendas, anúncio com set/25 = 8 e out/25 = 24): a Azul fica com 6 e 18 (índice 3, previsão 90, 6 dias) no painel e no ícone; a Verde, previsão 10, sem alerta');
    // No service worker (fundo/07, sem o painel carregado): atualizarAlertas lê ml:full e vm|ml e chega ao mesmo número do painel.
    const C19 = '900000019', F19 = montaFundo({ hoje: HOJE, dados: { 'ml:conta': C19, ['ml:full:' + C19]: { produtos: [p19] }, ['vm|ml|' + id19]: vm19[id19] } });
    const an19 = await F19.ctx.atualizarAlertas(C19);
    ok(!F19.ctx.SHC.pl && typeof F19.ctx.SHC.previsaoFull === 'function' && an19.full === 1 && an19.lista[0].dias === 4 && F19.dados['shc:alertas'].full === 1,
        `fundo (service worker): a previsão sazonal vem do ml-extrator.js (sem o painel) — shc:alertas conta ${F19.dados['shc:alertas'] && F19.dados['shc:alertas'].full} produto do Full, acaba em 4 dias`);
}

console.log('N. Quantidades lidas da tela do ML (SHC.mlFullDoEstado, P.un)');
{
    const prod = (id, sku, mlb, cols) => ({ id, columns: [{ id: 'product', data: { title: 'Kit ' + id, identifiers: { sku: { codes: [{ value: sku }] }, publications: { codes: [{ value: '#' + mlb }] } } } }]
        .concat(Object.keys(cols).map(k => ({ id: k, data: { text: cols[k] } }))) });
    const content = { stockTable: { headers: [{ id: 'product', text: 'Produto' }, { id: 'sales', text: 'Vendas' }, { id: 'suitable', text: 'Aptas' }, { id: 'not_suitable', text: 'Não aptas' }, { id: 'on_the_way', text: 'A caminho' }],
        products: [prod('P1', 'SKU-N1', '7600000001', { sales: '1.234 un.', suitable: '56 un.', not_suitable: '2', on_the_way: '—' }),
            prod('P2', 'SKU-N2', '7600000002', { sales: '0', suitable: '0 un.', not_suitable: '', on_the_way: '12' })] } };
    const fu = SHC.mlFullDoEstado({}, content), a = fu.produtos[0], b = fu.produtos[1];
    ok(a.vendas30 === 1234 && a.aptas === 56 && a.naoAptas === 2 && a.aCaminho === null && a.itemIds[0] === 'MLB7600000001', '"1.234 un." = 1.234 vendas; "56 un." = 56 aptas; "—" a caminho = null (não 0)');
    ok(b.vendas30 === 0 && b.aptas === 0 && b.naoAptas === null && b.aCaminho === 12, '"0" é 0 de verdade; texto vazio = null');
    ok([[12, 12], ['1.234 un.', 1234], ['—', null], [null, null], [undefined, null], [NaN, null], [Infinity, null], ['-3 un.', -3], ['sem dado', null]].every(([v, e]) => P.un(v) === e),
        'P.un: número, "1.234 un." e "−3" lidos; "—", vazio, NaN e infinito = null');
    const pl = P.planoFull(fu, { hoje: HOJE, dias: 30, vmDe: () => null, lucroDe: () => null });
    const la = pl.linhas.find(x => x.p.sku === 'SKU-N1');
    ok(la.aCaminho === 0 && la.semCaminho && la.alvo === 1234 && la.qtd === 1178 && /O ML não mostrou quantas estão a caminho: contei 0\./.test(P.explicaFull(la, 30).linhas.join(' ')),
        'plano: 1.234 − 56 aptas − 0 a caminho (não lido, dito na tela) = 1.178');
}

console.log('O. Linha da sincronização (resumoFull, no fundo): o R$ do mês e o "ainda não cobrou"');
{
    const F = montaFundo({});
    const so = [{ id: '8500001', status: 'in_transit', agendada: '2026-09-28', unidades: 10, custo: null }, { id: '8500002', status: 'closed_ok', recebida: '2026-08-02', unidades: 5, custo: 40 }];
    const t0 = F.ctx.resumoFull({ temFull: true, produtos: [{}, {}], remessas: { total: 2, remessas: so, porMes: SHC.remessasPorMes(so) } });
    ok(t0 === '2 produtos no Full · 2 remessas · o Mercado Livre ainda não cobrou coleta este mês', 'setembro sem cobrança: "' + t0 + '" (nunca "R$ 0,00 em coletas")');
    const r = lcg(2718), l = lote();
    for (let k = 0; k < 300; k++) {
        const rs = Array.from({ length: ent(r, 1, 8) }, (_, j) => ({ id: String(8510000 + k * 10 + j), status: pega(r, ['closed_ok', 'closed_with_changes']),
            recebida: dia(ent(r, 0, 60)), unidades: ent(r, 1, 300), custo: ent(r, 0, 3) ? ent(r, 1, 200000) / 100 : null }));
        const snap = { total: rs.length, remessas: rs, porMes: SHC.remessasPorMes(rs) }, txt = F.ctx.resumoFull({ temFull: true, produtos: [{}], remessas: snap });
        const c = rs.filter(x => x.recebida.slice(0, 7) === '2026-09' && x.custo > 0).reduce((s, x) => s + cent(x.custo), 0), rr = SHC.remessasResumo(snap, null, '2026-09', HOJE);
        l.conta(limpo(txt) && (c > 0 ? txt.endsWith(' · ' + reais(c) + ' em coletas este mês') && rr.custoMes !== null && cent(rr.custoMes) === c
            : /ainda não cobrou coleta este mês$/.test(txt) && !/R\$/.test(txt) && rr.custoMes === null), { k, txt, c, custoMes: rr.custoMes });
    }
    okLote(l, 'só remessas recebidas: o R$ da sincronização = o R$ do cartão "Todas as remessas" (sem cobrança no mês: nenhum R$)');
    // #16: o gasto do mês é um só — cabeçalho do cartão = Σ do "o ML cobrou" das linhas do mês = linha da sincronização, também com remessa
    // vencida, cancelada ou aberta que o ML já cobrou (ex.: NO_SHOW). Antes o cartão dizia R$ 120,50 e a sincronização R$ 200,50.
    const mes = SHC.hoje().slice(0, 7), venc = { id: '8520002', status: 'expired', agendada: '2026-09-15', unidades: 40, custo: 80, multaFlag: true, multaTipo: 'NO_SHOW' };
    const v16 = [{ id: '8520001', status: 'closed_ok', recebida: '2026-09-10', unidades: 100, custo: 120.5 }, venc];
    const s16 = { total: 2, remessas: v16, porMes: SHC.remessasPorMes(v16) }, r16 = SHC.remessasResumo(s16, null, mes, HOJE);
    const l16 = P.linhasRemessas(s16, null).filter(x => x.quando.slice(0, 7) === mes && x.custo).map(x => 'o ML cobrou ' + SHC.moeda(x.custo)).join(' + ');
    const sync16 = F.ctx.resumoFull({ temFull: true, produtos: [{}], remessas: s16 });
    ok(r16.custoMes === 200.5 && P.remessasResumoTxt(r16).endsWith(' · R$ 200,50 gastos em remessas este mês') && l16 === 'o ML cobrou R$ 80,00 + o ML cobrou R$ 120,50'
        && sync16.endsWith(' · R$ 200,50 em coletas este mês') && r16.custoPorUnidade === 1.21,
        'recebida R$ 120,50 + vencida (NO_SHOW) R$ 80,00: cartão "R$ 200,50 gastos" = linhas R$ 80,00 + R$ 120,50 = sincronização "R$ 200,50" (R$ 1,21/un. só da recebida)');
    const so16 = SHC.remessasResumo([venc], null, mes, HOJE);
    ok(so16.custoMes === 80 && /R\$ 80,00 gastos em remessas este mês$/.test(P.remessasResumoTxt(so16)) && so16.custoPorUnidade === null
        && F.ctx.resumoFull({ temFull: true, produtos: [{}], remessas: { total: 1, remessas: [venc], porMes: SHC.remessasPorMes([venc]) } }).endsWith(' · R$ 80,00 em coletas este mês'),
        'só a vencida cobrada: o cartão diz "R$ 80,00 gastos" como a sincronização (nunca "ainda não cobrou" ao lado de "o ML cobrou R$ 80,00"); sem recebida, sem R$/un.');
    const r16g = lcg(1616), g16 = lote();
    let foraRec = 0;
    for (let k = 0; k < 400; k++) {
        const rs = Array.from({ length: ent(r16g, 1, 8) }, (_, j) => {
            const st = pega(r16g, STS), c = ent(r16g, 0, 4) ? ent(r16g, 1, 200000) : pega(r16g, [null, 0]);
            return { id: String(8530000 + k * 10 + j), status: st, [/^closed_/.test(st) ? 'recebida' : 'agendada']: dia(ent(r16g, -10, 50)), unidades: ent(r16g, 0, 3) ? ent(r16g, 0, 300) : null, custo: c === null ? null : c / 100 };
        });
        const snap = { total: rs.length, remessas: rs, porMes: SHC.remessasPorMes(rs) }, rr = SHC.remessasResumo(snap, null, mes, HOJE);
        const doMes = rs.filter(x => (x.recebida || x.agendada).slice(0, 7) === mes && x.custo > 0), c = doMes.reduce((s, x) => s + cent(x.custo), 0);
        if (doMes.some(x => !/^closed_(ok|with_changes)$/.test(x.status))) foraRec++;
        const linhas = P.linhasRemessas(snap, null).filter(x => x.quando.slice(0, 7) === mes).reduce((s, x) => s + cent(x.custo), 0);
        const tx = P.remessasResumoTxt(rr), sync = F.ctx.resumoFull({ temFull: true, produtos: [{}], remessas: snap });
        g16.conta(linhas === c && (c > 0 ? emCentavos(rr.custoMes) && cent(rr.custoMes) === c && tx.endsWith(' · ' + reais(c) + ' gastos em remessas este mês') && sync.endsWith(' · ' + reais(c) + ' em coletas este mês')
            : rr.custoMes === null && !/R\$/.test(tx) && /ainda não cobrou coleta este mês$/.test(sync)), { k, rs, c, linhas, custoMes: rr.custoMes, tx, sync });
    }
    okLote(g16, `#16 todos os status (${foraRec} meses com remessa não recebida cobrada): cartão = Σ das linhas do mês = sincronização, no centavo`);
}

console.log(`\n${nChecks} verificações (${nLote} conferências em lote, casos gerados com semente fixa)`);
console.log(f ? '\n' + f + ' FALHA(S)' : '\nTUDO OK');
process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
