// Centavos do frete e da conciliação (pedido da dona: "cada centavo tem que bater, a tela tem que bater 100%").
// Prova, só com dados inventados, que cada conta de dinheiro do frete fecha no centavo e que a tela (SHC.moeda) mostra o número da conta:
//   A. SHC.r2 / SHC.moeda (a régua dos centavos);
//   B. SHC.freteDasCobrancas × SHC.vendasEAdsDasCobrancas (cobrado = cobranças − estornos, o mesmo no frete:pedidos e no vd|ml);
//   C. SHC.conciliaFrete num caso feito à mão (Σ diferença dos contestáveis = totalAMais, Σ porItem = totais, pedido × pedidoFrete) e as telas
//      que saem dele (P.freteCobrado, P.freteConta, P.concFrete, SHC.fech.recuperar, chamados, P.contaFretePedido, P.freteSubidaJanela);
//   D. SHC.conciliaFrete em casos gerados (oráculo em centavos inteiros + invariantes; também acima do corte de 200);
//   E. P.pedidosAMais e a "Diferença somada" do P.textoChamado (caso à mão e gerados);
//   F. P.freteSubidaJanela (não conta 2 vezes o que já está em "Frete cobrado a mais");
//   G. SHC.freteHistorico (Σ por anúncio = conta, formatos + aproximados = total, médio, desconto do ML);
//   H. P.pagoAMaisPorMes / P.rankingFrete (total = Σ das partes);
//   I. SHC.vendasPorMes e SHC.registraVendas;
//   J. fundo/03-faturamento.js gravarFreteHist: estorno lido num mês depois da tarifa (cobrado e cheio, desconto do ML, releitura).
// Casos gerados com semente fixa (LCG): o resultado é o mesmo em toda execução (nada de Math.random).
// Divergências achadas nesta auditoria (fora deste teste para a suíte seguir verde; repro no relatório da tarefa):
//   1) (corrigida; caso do corte em D) SHC.fech.recuperar somava o "Frete cobrado a mais (confirmado)" da lista guardada (cortada em 200), e a
//      aba Frete soma o totalAMais (sem corte): com mais de 200 pedidos contestáveis em 30 dias as duas telas mostravam valores diferentes;
//   2) SHC.freteHistorico: "Comprador paga" com a taxa operacional não lida soma R$ 0 por pedido (custoOperacional R$ 0,00 inventado).
//   3) (corrigida; caso J) fundo/03-faturamento.js gravarFreteHist: estorno parcial lido num mês depois da tarifa baixava o cobrado mas não o
//      cheio, e a diferença aparecia como "Desconto do ML no frete" (o mesmo estorno lido junto com a tarifa, em SHC.freteDasCobrancas, baixa os dois).
// Rodar: node tests/copiloto/teste_centavos_frete.js
'use strict';
require('./relogio').fixar();
const path = require('path');
// chrome.storage.local de mentira, com memória (o registraVendas lê e grava de verdade).
const banco = {};
const copia = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
global.chrome = { storage: { local: {
    get: async k => { const o = {}; (k === null ? Object.keys(banco) : [].concat(k)).forEach(x => { if (x in banco) o[x] = copia(banco[x]); }); return o; },
    set: async o => { Object.keys(o).forEach(k => { banco[k] = copia(o[k]); }); },
    remove: async k => { [].concat(k).forEach(x => delete banco[x]); } } }, runtime: { sendMessage: async () => ({}) } };
const EXT = path.join(__dirname, '../../extension-copiloto');
const SHC = require(path.join(EXT, 'calc.js'));
['store.js', 'ml-extrator.js', 'fechamento.js', 'painel-lateral.js'].forEach(a => require(path.join(EXT, a)));
const P = SHC.pl, F = SHC.fech, r2 = SHC.r2, montaFundo = require('./fundo_falso');
let f = 0, nChecks = 0;
const ok = (c, m) => { nChecks++; console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) f++; };

// ── Régua independente do produto: centavos INTEIROS ──
const cent = v => Math.round(v * 100);   // só para valor que já deveria ter 2 casas (emCentavos prova isso)
const emCentavos = v => typeof v === 'number' && isFinite(v) && Math.abs(v * 100 - Math.round(v * 100)) < 1e-3;   // sobra < 0,001 centavo (folga do double em milhões)
// O R$ que a tela TEM de mostrar, montado só com inteiros: "R$ 1.234,56", "−R$ 0,05".
const reais = c => { const a = Math.abs(c); return (c < 0 ? '−' : '') + 'R$ ' + String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + String(a % 100).padStart(2, '0'); };
const somaC = xs => xs.reduce((s, v) => s + cent(v), 0);
// Gerador com semente fixa (LCG de Numerical Recipes).
const lcg = s => { let x = s >>> 0; return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296; };
const ent = (r, a, b) => a + Math.floor(r() * (b - a + 1));
const HOJE = '2026-09-25';
const dia = (n, base) => new Date(Date.parse((base || HOJE) + 'T12:00:00Z') - n * 864e5).toISOString().slice(0, 10);
const dataBr = d => d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4);
// Conferência em lote: conta os casos e guarda o 1º que falhou (vira o repro).
const lote = () => { const o = { n: 0, ruim: null, conta(c, ex) { o.n++; if (!c && !o.ruim) o.ruim = ex === undefined ? '(sem detalhe)' : ex; return c; } }; return o; };
const okLote = (l, m) => ok(!l.ruim && l.n > 0, m + ` (${l.n} conferências)` + (l.ruim ? ' — 1º caso: ' + JSON.stringify(l.ruim).slice(0, 500) : ''));
// Regras do frete reescritas aqui (oráculo): frete do anúncio no dia e "várias unidades" (2×, 3×… ±8%).
const noDia = (h, d) => { if (!h || !d) return null; if (typeof h[d] === 'number' && h[d] > 0) return h[d];
    const a = Object.keys(h).filter(x => x < d && typeof h[x] === 'number' && h[x] > 0).sort().pop(); return a ? h[a] : null; };
const varias = q => { const k = Math.round(q); return k >= 2 && Math.abs(q - k) <= 0.08 * k; };

console.log('A. Régua dos centavos: SHC.r2 e SHC.moeda (o texto da tela é o número da conta)');
{
    const r = lcg(20261007), a = lote(), s = lote();
    let acc = 0, accC = 0;
    for (let i = 0; i < 4000; i++) {
        const c = (i % 3 ? ent(r, -500000000, 500000000) : 0) + ent(r, -99999, 99999);   // de centavos a milhões, com sinal
        a.conta(SHC.moeda(c / 100) === reais(c) && r2(c / 100) === c / 100, { c, tela: SHC.moeda(c / 100) });
        acc = r2(acc + c / 100); accC += c;
        s.conta(emCentavos(acc) && cent(acc) === accC, { i, acc, accC });
    }
    okLote(a, 'SHC.moeda(c/100) = R$ montado com inteiros (milhar com ponto, vírgula, "−" no negativo) e r2 não mexe em valor de 2 casas');
    okLote(s, 'somar com r2 a cada parcela (como porItem, totais e chamados) não perde nem cria centavo');
    ok([null, undefined, NaN, Infinity, -Infinity].every(v => SHC.moeda(v) === '—'), 'null, undefined, NaN e ±Infinity viram "—" (nunca "R$ NaN" nem "R$ 0,00")');
}

console.log('B. Frete de cada pedido no Faturamento: cobrado = cobranças − estornos (SHC.freteDasCobrancas × vd|ml)');
{
    const TXT = { frete: 'Tarifa do Mercado Envios (Por sua conta)', frete_parcial: 'Tarifa do Mercado Envios (Por sua conta e por conta do comprador)',
        frete_estorno: 'Cancelamento da tarifa do Mercado Envios', devolucao: 'Tarifa de devolução por envio externo ou intermunicipal', extra: 'Tarifa de envio extra ou intermunicipal (Por sua conta)' };
    const cob = (tipo, orderId, itemId, data, valor, mais) => Object.assign({ tipo, orderId, itemId, data, valor, texto: TXT[tipo] }, mais || {});
    const cs = [
        cob('frete', '2000000201', 'MLB9200000001', '2026-09-10', 45.35, { cheio: 90.70 }),
        cob('frete', '2000000201', 'MLB9200000001', '2026-09-11', 6.65, { texto: TXT.extra }),
        cob('frete_estorno', '2000000201', 'MLB9200000001', '2026-09-12', 6.65),
        cob('frete', '2000000202', 'MLB9200000001', '2026-09-13', 30.10), cob('frete_estorno', '2000000202', 'MLB9200000001', '2026-09-14', 30.10),
        cob('frete_estorno', '2000000203', 'MLB9200000001', '2026-09-15', 12.00),
        cob('frete_parcial', '2000000204', 'MLB9200000002', '2026-09-16', 12.34),
        cob('devolucao', '2000000205', 'MLB9200000002', '2026-09-17', 23.90),
        cob('frete', '2000000206', 'MLB9200000002', '2026-09-18', 0.01), cob('frete', '2000000206', 'MLB9200000002', '2026-09-18', 0.02),
    ];
    const por = {};
    SHC.freteDasCobrancas(cs).forEach(p => { por[p.pedido] = p; });
    const p1 = por['2000000201'];
    ok(p1.cobrado === 45.35 && p1.cheio === 90.70 && p1.temExtra === true && p1.formato === 'gratis' && p1.linhas.length === 3,
        '45,35 + 6,65 (extra) − 6,65 (estorno do extra) = 45,35; cheio = 90,70 + 6,65 − 6,65 = 90,70; as 3 linhas guardadas');
    ok(por['2000000202'].cancelado === true && por['2000000202'].cobrado === 0 && por['2000000202'].cheio === 0 && por['2000000202'].formato === 'cancelado',
        'frete estornado inteiro (30,10 − 30,10): cancelado com cobrado 0 (número, nunca undefined)');
    ok(!por['2000000203'] && !por['2000000205'], 'pedido só com estorno e tarifa de devolução (frete de VOLTA) ficam fora do frete da venda');
    ok(por['2000000204'].cobrado === 12.34 && por['2000000204'].formato === 'compartilhado', 'frete compartilhado: 12,34, formato compartilhado');
    ok(por['2000000206'].cobrado === 0.03 && emCentavos(por['2000000206'].cobrado), '0,01 + 0,02 = 0,03 exato (sem 0,030000000000000002)');
    const vd = SHC.vendasEAdsDasCobrancas(cs).vendas;
    ok(vd.MLB9200000001['2000000201'].f === 45.35 && vd.MLB9200000001['2000000202'] === null && !('2000000203' in vd.MLB9200000001)
        && vd.MLB9200000002['2000000204'].f === 12.34 && vd.MLB9200000002['2000000204'].pc === true && vd.MLB9200000002['2000000206'].f === 0.03 && !('2000000205' in vd.MLB9200000002),
        'vd|ml: o mesmo frete por pedido (45,35 · null no estornado · 12,34 compartilhado · 0,03); devolução e estorno solto fora');

    // Frete de VOLTA (tarifa de devolução): fica fora do frete da venda e tem a sua conta (cobranças − estornos, nunca abaixo de 0).
    const dv = SHC.devolucoesDasCobrancas([cob('devolucao', '2000000205', 'MLB9200000002', '2026-09-17', 23.90), cob('devolucao', '2000000205', 'MLB9200000002', '2026-09-18', 23.90),
        cob('devolucao_estorno', '2000000205', 'MLB9200000002', '2026-09-19', 23.90), cob('devolucao', '2000000207', 'MLB9200000002', '2026-09-19', 10.00),
        cob('devolucao_estorno', '2000000207', 'MLB9200000002', '2026-09-20', 15.00), cob('frete', '2000000208', 'MLB9200000002', '2026-09-20', 30.00)]);
    const dr = SHC.devolucoesResumo(dv, HOJE);
    ok(dv.length === 2 && dv.find(p => p.pedido === '2000000205').valor === 23.9 && dv.find(p => p.pedido === '2000000207').valor === 0
        && dr.ult30.pedidos === 1 && dr.ult30.total === 23.9 && dr.lista.length === 1, 'devolução: 23,90 + 23,90 − 23,90 = 23,90; estorno maior que a tarifa = 0 (não negativo) e fica fora do total; o frete da venda não entra');
    // Gerados: 600 pedidos com 1 a 3 tarifas, 0 a 2 estornos (o valor exato de uma tarifa ou um valor qualquer) e devoluções no meio.
    const r = lcg(777), cobs = [], esp = {};
    for (let i = 0; i < 600; i++) {
        const ped = String(2210000000 + i), id = 'MLB92100000' + (i % 7), d0 = ent(r, 5, 55), parcial = r() < 0.1;
        const vals = [], ests = [];
        for (let j = ent(r, 1, 3); j > 0; j--) {
            const v = ent(r, 1, 30000) / 100, extra = r() < 0.15;
            vals.push(v);
            cobs.push(cob(parcial ? 'frete_parcial' : 'frete', ped, id, dia(d0 - j % 2), v, Object.assign(extra && !parcial ? { texto: TXT.extra } : {}, r() < 0.3 ? { cheio: r2(v + ent(r, 1, 5000) / 100) } : {})));
        }
        for (let j = ent(r, 0, 2); j > 0; j--) {
            const v = r() < 0.6 ? vals[ent(r, 0, vals.length - 1)] : ent(r, 1, 30000) / 100;
            ests.push(v); cobs.push(cob('frete_estorno', ped, id, dia(d0 - 2), v));
        }
        if (r() < 0.1) cobs.push(cob('devolucao', ped, id, dia(d0 - 3), ent(r, 100, 9000) / 100));
        esp[ped] = { id, cob: somaC(vals), est: somaC(ests) };
    }
    for (let i = 0; i < 20; i++) cobs.push(cob('frete_estorno', String(2219000000 + i), 'MLB921000000', dia(9), ent(r, 1, 9000) / 100));   // estorno sem a tarifa
    const fr = SHC.freteDasCobrancas(cobs), vds = SHC.vendasEAdsDasCobrancas(cobs).vendas, L = lote(), V = lote(), X = lote();
    fr.forEach(p => {
        const e = esp[p.pedido];
        if (!X.conta(!!e, { foraDoEsperado: p.pedido })) return;
        const canc = e.est >= e.cob, deve = canc ? 0 : e.cob - e.est;
        L.conta(p.cancelado === canc && emCentavos(p.cobrado) && cent(p.cobrado) === deve && emCentavos(p.cheio) && p.cheio >= p.cobrado
            && (canc || somaC(p.linhas.filter(l => !l.e).map(l => l.v)) - somaC(p.linhas.filter(l => l.e).map(l => l.v)) === deve), { pedido: p.pedido, e, p: { cobrado: p.cobrado, cheio: p.cheio } });
        const v = (vds[e.id] || {})[p.pedido];
        V.conta(canc ? v === null : (!!v && emCentavos(v.f) && cent(v.f) === deve && v.f === p.cobrado), { pedido: p.pedido, vd: v, cobrado: p.cobrado });
    });
    X.conta(fr.length === 600, { pedidos: fr.length });
    okLote(L, 'cada pedido: cobrado = Σ tarifas − Σ estornos em centavos (estorno ≥ tarifa = cancelado com 0), cheio ≥ cobrado, e as linhas da tela somam o cobrado');
    okLote(V, 'vd|ml (chamado do anúncio) tem o MESMO frete do pedido que a conciliação usa, e null só no cancelado');
    okLote(X, '600 pedidos com tarifa saem, nenhum a mais (estorno solto e devolução não criam pedido)');
}

// ── C. Conciliação feita à mão ──
// Janela: 27/08 a 25/09/2026. A: frete do anúncio 40,00 desde 01/08. B: 20,00 hoje, sem o dia guardado. C: 30,00 desde 01/09 (33,00 hoje).
// D: fora do retrato. E: comprador paga.
const A = 'MLB9300000001', B = 'MLB9300000002', C = 'MLB9300000003', D = 'MLB9300000004', E = 'MLB9300000005';
const V = n => '20000003' + String(n).padStart(2, '0');
const retratoC = { [A]: { itemId: A, frete: 40 }, [B]: { itemId: B, frete: 20 }, [C]: { itemId: C, frete: 33 }, [E]: { itemId: E, freteComprador: true, frete: 0 } };
const fretesDiaC = { [A]: { '2026-08-01': 40 }, [C]: { '2026-09-01': 30 } };
const venda = (n, item, data, canc) => ({ pedido: V(n), itemId: item, data, cancelada: !!canc });
const vendasC = [venda(1, A, '2026-09-10'), venda(2, A, '2026-09-11'), venda(3, A, '2026-09-12'), venda(4, A, '2026-09-13'), venda(5, A, '2026-09-14'),
    venda(6, A, '2026-09-15'), venda(7, A, '2026-09-16', true), venda(8, B, '2026-09-17'), venda(9, B, '2026-09-18'), venda(10, C, '2026-09-05'),
    venda(11, D, '2026-09-19'), venda(12, E, '2026-09-20'), venda(14, C, '2026-08-20')];
const frete = (pedido, item, data, cobrado, mais) => Object.assign({ pedido, itemId: item, data, cobrado, formato: 'gratis', cancelado: false }, mais || {});
const fretesC = [
    frete(V(1), A, '2026-09-10', 52.37, { linhas: [{ t: 'Tarifa do Mercado Envios (Por sua conta)', v: 58.02, d: '2026-09-10' }, { t: 'Cancelamento da tarifa do Mercado Envios', v: 5.65, d: '2026-09-11', e: 1 }], dev: 23.9 }),
    frete(V(2), A, '2026-09-11', 41.50), frete(V(3), A, '2026-09-12', 80.00), frete(V(4), A, '2026-09-13', 64.99),
    frete(V(5), A, '2026-09-14', 60.00, { formato: 'compartilhado' }), frete(V(6), A, '2026-09-15', 60.00, { formato: null, aprox: true }),
    frete(V(7), A, '2026-09-16', 0, { formato: 'cancelado', cancelado: true }), frete(V(9), B, '2026-09-18', 25.55),
    frete('9100000310', C, '2026-09-07', 34.44), frete(V(11), D, '2026-09-19', 50.00), frete('9100000313', A, '2026-09-20', 47.00), frete(V(14), C, '2026-08-29', 45.00)];
const concC = SHC.conciliaFrete(fretesC, retratoC, vendasC, HOJE, fretesDiaC);

console.log('C. Conciliação feita à mão (SHC.conciliaFrete) e as telas que saem dela');
{
    const c = concC, pa = c.pagoAMais, ach = k => pa.find(p => p.pedido === V(k));
    ok(c.vendas === 11 && c.cancelados === 1 && c.conciliados === 8 && c.semCobrancaAinda === 1 && c.semFreteNoAnuncio === 1 && c.compradorPaga === 1 && c.faltam === 2
        && c.vendas === c.conciliados + c.faltam + c.compradorPaga && JSON.stringify(c.pedidosSemCobranca) === JSON.stringify([V(8)]),
        '11 vendas = 8 conciliadas + 2 sem conciliar (1 sem frete lançado, 1 anúncio fora do retrato) + 1 comprador paga; a cancelada fica fora');
    ok(JSON.stringify(pa.map(p => p.pedido)) === JSON.stringify([V(1), V(10), V(3), V(4), V(9)]), 'pagoAMais: contestáveis primeiro (12,37 e 4,44), depois os para conferir (40,00, 24,99, 5,55)');
    ok(c.totalAMais === 16.81 && cent(c.totalAMais) === cent(ach(1).diferenca) + cent(ach(10).diferenca), 'totalAMais = 12,37 + 4,44 = 16,81 (só os contestáveis)');
    ok(c.talvez.pedidos === 3 && c.talvez.total === 70.54 && cent(c.talvez.total) === somaC(pa.filter(p => p.talvezUnidades).map(p => p.diferenca)), 'para conferir: 3 pedidos, 40,00 + 24,99 + 5,55 = 70,54');
    const ordena = o => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));
    ok(ordena(c.porItem) === ordena({ [A]: { n: 1, v: 12.37, nt: 2, vt: 64.99 }, [B]: { n: 0, v: 0, nt: 1, vt: 5.55 }, [C]: { n: 1, v: 4.44, nt: 0, vt: 0 } }),
        'porItem: A 12,37 + (40,00 + 24,99) · B 5,55 para conferir · C 4,44');
    ok(ach(1).esperado === 40 && ach(1).base === 'dia' && ach(1).diferenca === 12.37 && !ach(1).talvezUnidades && ach(1).dev === 23.9,
        '52,37 − 40,00 (frete do anúncio no dia) = 12,37 contestável; a devolução (23,90) vai junto só para mostrar');
    ok(ach(3).vezes === 2 && ach(3).talvezUnidades && ach(4).talvezUnidades && !ach(4).vezes && ach(9).base === 'hoje' && ach(9).talvezUnidades,
        '80,00 = 2× (pode ser 2 unidades), 64,99 ≥ 1,6×, e 25,55 contra o frete de HOJE: os três só "para conferir"');
    ok(ach(10).pedidoFrete === '9100000310' && ach(10).esperado === 30 && ach(10).cobrado === 34.44 && ach(10).diferenca === 4.44 && !ach(10).parAmbiguo,
        'frete com OUTRO número (#9100000310) casado com a única venda do anúncio: contestável, régua do dia da venda (30,00)');
    ok(!pa.some(p => [V(2), V(5), V(6), V(7), V(14), '9100000313'].indexOf(p.pedido) >= 0) && c.freteSemVenda === 1 && JSON.stringify(c.foraJanela) === JSON.stringify([V(14)]),
        'fora da conta: 1,50 a mais (abaixo de R$ 2,00 = 5%), compartilhado, aproximado, cancelado, venda de antes da janela (foraJanela) e frete sem venda (freteSemVenda)');
    ok(c.janela.de === '2026-08-27' && c.janela.ate === HOJE, 'janela dos 30 dias: 27/08 a 25/09 (hoje incluso)');

    const fc = P.freteCobrado(c, HOJE, 5);
    ok(fc.total === 87.35 && fc.n === 5 && fc.contestar.v === c.totalAMais && fc.contestar.n === 2 && fc.conferir.v === c.talvez.total && fc.conferir.n === 3
        && fc.de === '2026-08-27' && fc.ate === HOJE, 'cartão "Frete cobrado a mais": 87,35 = confirmado 16,81 + para conferir 70,54, em 5 pedidos, na mesma janela');
    ok(JSON.stringify(fc.produtos.map(y => [y.id, y.tot, y.v, y.vt])) === JSON.stringify([[A, 77.36, 12.37, 64.99], [B, 5.55, 0, 5.55], [C, 4.44, 4.44, 0]])
        && fc.resto === null && cent(fc.total) === somaC(fc.produtos.map(y => y.tot)), 'por anúncio: 77,36 + 5,55 + 4,44 = 87,35 (a barra fecha o total)');
    const fc2 = P.freteCobrado(c, HOJE, 1);
    ok(fc2.resto && fc2.resto.v === 9.99 && fc2.resto.pedidos === 2 && fc2.resto.anuncios === 2 && cent(fc2.total) === cent(fc2.produtos[0].tot) + cent(fc2.resto.v),
        'com 1 anúncio por linha: 77,36 + "9,99 em 2 pedidos nos outros anúncios" = 87,35');
    const fcc = P.freteConta({ conciliacao: c, vendasLidas: true });
    ok(fcc.total === 87.35 && fcc.cor === 'ruim' && fcc.resumo === '8 pedidos conciliados de 11 · 2 sem conciliar · 5 pedidos cobrados a mais no frete (R$ 87,35, 3 para conferir)',
        'Geral: o MESMO R$ 87,35 do cartão, com os 3 para conferir');
    const cf = P.concFrete(c);
    ok(cf.titulo === 'Pedidos conciliados: 8 de 11 dos últimos 30 dias · faltam 2' && cf.pct === 73 && cf.motivos.length === 5, 'conciliação: 8 de 11, faltam 2, e um motivo para cada pedaço que ficou fora');
    const lixo = SHC.conciliaFrete([frete('2000000501', A, '2026-09-10', undefined), frete('2000000502', A, '2026-09-10', NaN), frete('2000000503', A, '2026-09-10', null),
        frete('2000000504', 'MLB9300000009', '2026-09-10', 99)], { [A]: { itemId: A, frete: 40 }, MLB9300000009: { itemId: 'MLB9300000009' } },
        [venda(501, A, '2026-09-10'), { pedido: '2000000502', itemId: A, data: '2026-09-10' }, { pedido: '2000000503', itemId: A, data: '2026-09-10' }, { pedido: '2000000504', itemId: 'MLB9300000009', data: '2026-09-10' }],
        HOJE, { [A]: { '2026-09-01': NaN } });
    const lixoTela = P.freteConta({ conciliacao: lixo, vendasLidas: true });
    ok(lixo.pagoAMais.length === 0 && lixo.totalAMais === 0 && lixo.talvez.total === 0 && lixo.semFreteNoAnuncio === 1 && !/NaN|undefined|Infinity/.test(JSON.stringify(lixo) + lixoTela.resumo),
        'frete sem valor (undefined, NaN, null) ou anúncio sem frete: nenhuma linha "a mais", nenhum NaN/undefined na conta nem no texto da Geral');
    ok(P.freteConta({ conciliacao: c, vendasLidas: false }) === null && P.freteCobrado(null) === null && P.freteCobrado({ pagoAMais: [] }) === null,
        'sem as vendas lidas (ou sem conciliação) não há número: null, nunca "R$ 0,00"');

    const conferir = [
        { regra: 'frete', pedido: '9100000310', itemId: C, data: '2026-09-07', valor: 34.44, esperado: 30.5, diferenca: 3.94, cobranca: 'Tarifa do Mercado Envios (Por sua conta)', estimado: 'mediana' },
        { regra: 'frete', pedido: '2000000399', itemId: C, data: '2026-09-08', valor: 50, esperado: 30.5, diferenca: 19.5, cobranca: 'Tarifa do Mercado Envios (Por sua conta)', estimado: 'mediana' }];
    const rec = F.recuperar({ conc: c, conferir }), pf = rec.parcelas.find(p => p.id === 'frete'), pc = rec.parcelas.find(p => p.id === 'cobrancas');
    ok(pf.valor === c.totalAMais && pf.itens.length === 2 && pf.itens.every(x => !ach(Number(x.pedido.slice(-2))).talvezUnidades),
        'Dá para recuperar › Frete cobrado a mais (confirmado) = totalAMais (16,81), sem os "para conferir"');
    ok(pc.valor === 19.5 && pc.itens.length === 1 && rec.total === 36.31 && cent(rec.total) === cent(pf.valor) + cent(pc.valor),
        'o frete #9100000310 no "para conferir" do Fechamento NÃO conta de novo (é o pedidoFrete do contestável): total 16,81 + 19,50 = 36,31');
    const txt1 = F.chamadoFrete(pf.itens[0], 'Bomba teste'), txt10 = F.chamadoFrete(pf.itens[1], '');
    ok(/- Valor cobrado: R\$ 52,37\n- Valor devido: R\$ 40,00\n- Diferença: R\$ 12,37\n/.test(txt1) && /estorno da diferença de R\$ 12,37 na nossa conta/.test(txt1)
        && /A tarifa de devolução deste pedido \(R\$ 23,90\) não está nesta conta/.test(txt1), 'chamado do pedido: cobrado 52,37 − devido 40,00 = 12,37, e a devolução fica fora da conta');
    ok(/– Pedido: #2000000310 – Frete: #9100000310/.test(txt10) && /- Diferença: R\$ 4,44\n/.test(txt10), 'chamado do frete com outro número cita a venda E o frete, com os 4,44');
    const lote2 = P.chamadoFreteLote(pa, () => 'Produto');
    ok(lote2.split('\n\n----------\n\n').length === 2 && /Diferença: R\$ 12,37/.test(lote2) && /Diferença: R\$ 4,44/.test(lote2) && !/R\$ 40,00\n- Diferença: R\$ 40,00/.test(lote2) && !/24,99|5,55/.test(lote2),
        'texto em lote: só os 2 contestáveis (16,81), nenhum "para conferir"');
    const linhas = P.contaFretePedido(ach(1)), val = cls => linhas.filter(l => l.cls === cls).map(l => l.val);
    ok(JSON.stringify(linhas.map(l => l.val)) === JSON.stringify(['−R$ 58,02', '+R$ 5,65', 'R$ 52,37', 'R$ 40,00', '+R$ 12,37', 'R$ 23,90'])
        && val('tot')[0] === SHC.moeda(ach(1).cobrado) && val('mais')[0] === '+' + SHC.moeda(ach(1).diferenca),
        'conta linha a linha: −58,02 + 5,65 = 52,37 cobrado; 40,00 do anúncio; +12,37 a mais; devolução 23,90 à parte');
}

console.log('D. Conciliação em casos gerados (semente fixa): oráculo em centavos inteiros + invariantes');
{
    // misto = fretes com OUTRO número (casam por anúncio e data) e fretes soltos; senão todo frete tem o número da venda (oráculo exato).
    const cenario = (r, s, misto) => {
        const it = {}, fd = {}, vendas = [], fretes = [], ids = [];
        for (let i = ent(r, 1, 5); i > 0; i--) {
            const id = 'MLB96' + String(s).padStart(4, '0') + String(i).padStart(4, '0'), base = ent(r, 990, 9990) / 100, t = r();
            if (t < 0.65) it[id] = { itemId: id, frete: base };
            else if (t < 0.75) it[id] = { itemId: id, freteComprador: true, frete: 0 };
            else if (t < 0.85) it[id] = { itemId: id, frete: NaN };   // frete não lido: tem de virar "sem frete no anúncio", nunca R$
            if (r() < 0.6) { const h = {}; for (let j = ent(r, 1, 3); j > 0; j--) h[dia(ent(r, 0, 70))] = r() < 0.1 ? 0 : ent(r, 990, 9990) / 100; fd[id] = h; }
            ids.push({ id, base });
        }
        let seq = 0;
        const num = pre => pre + String(s).padStart(4, '0') + String(seq++).padStart(4, '0');
        ids.forEach(({ id, base }) => {
            for (let j = ent(r, 0, 30); j > 0; j--) {
                const ped = num('22'), o = ent(r, 0, 45), canc = r() < 0.05;
                vendas.push({ pedido: ped, itemId: id, data: dia(o), cancelada: canc });
                if (r() >= 0.82) continue;   // venda sem frete lançado
                const fat = [1, 1, 1.01, 1.03, 1.06, 1.1, 1.3, 1.59, 1.6, 1.62, 2, 2.05, 3, 0.9][ent(r, 0, 13)];
                const cobr = Math.max(0.01, r2(base * fat + ent(r, -50, 150) / 100)), fc = canc && r() < 0.8, aprox = !fc && r() < 0.05;
                const fmt = fc ? 'cancelado' : aprox ? (r() < 0.5 ? null : 'compartilhado') : r() < 0.07 ? 'compartilhado' : r() < 0.05 ? 'extra' : 'gratis';
                fretes.push(Object.assign({ pedido: misto && r() < 0.3 ? num('91') : ped, itemId: r() < 0.05 ? '' : id, data: dia(Math.max(-1, o - ent(r, 0, 3))),
                    cobrado: fc ? 0 : cobr, formato: fmt, cancelado: fc }, aprox ? { aprox: true } : {}, r() < 0.1 ? { dev: ent(r, 100, 5000) / 100 } : {}));
            }
        });
        if (misto) for (let j = ent(r, 0, 4); j > 0; j--) { const x = ids[ent(r, 0, ids.length - 1)]; fretes.push({ pedido: num('93'), itemId: x.id, data: dia(ent(r, 0, 40)), cobrado: r2(x.base * 1.2), formato: 'gratis', cancelado: false }); }
        return { it, fd, vendas, fretes };
    };
    // Oráculo (só com o mesmo número): a regra do frete reescrita em centavos inteiros.
    const oraculo = (c) => {
        const ini = dia(29), vend = {}, fr = {}, o = { vendas: 0, cancelados: 0, conciliados: 0, compradorPaga: 0, semCobrancaAinda: 0, semFreteNoAnuncio: 0, lista: {} };
        c.vendas.forEach(v => { if (v.data <= HOJE) vend[v.pedido] = v; });
        c.fretes.forEach(p => { fr[p.pedido] = p; });
        Object.keys(vend).forEach(k => {
            const v = vend[k], p = fr[k];
            if (v.data < ini) return;
            if ((p && p.cancelado) || v.cancelada) { o.cancelados++; return; }
            o.vendas++;
            const id = (p && p.itemId) || v.itemId, a = c.it[id];
            if (!p) { if (a && a.freteComprador) o.compradorPaga++; else o.semCobrancaAinda++; return; }
            if (!a || (!a.freteComprador && !(typeof a.frete === 'number' && isFinite(a.frete)))) { o.semFreteNoAnuncio++; return; }
            o.conciliados++;
            const bd = a.freteComprador ? null : noDia(c.fd[id], v.data), esp = a.freteComprador ? 0 : (bd !== null ? bd : a.frete);
            if (!(esp > 0) || p.formato === 'compartilhado' || p.aprox) return;
            const difC = cent(p.cobrado) - cent(esp), q = p.cobrado / esp;
            if (difC / 100 > Math.max(1, esp * 0.05)) o.lista[k] = { difC, talvez: q >= 1.6 || varias(q) || bd === null, base: bd !== null ? 'dia' : 'hoje' };
        });
        return o;
    };
    const Or = lote(), Iv = lote(), Lin = lote(), Un = lote(), Tela = lote(), Rec = lote(), Txt = lote(), Ord = lote();
    let comAMais = 0, comConferir = 0, comOutroNumero = 0;
    const confere = (c, cc, s, misto) => {
        const pa = cc.pagoAMais, cortado = !!cc.numsFrete, totalN = cortado ? cc.numsFrete.length : pa.length;
        const pi = Object.keys(cc.porItem).map(k => cc.porItem[k]);
        // Invariantes de conta.
        Iv.conta(cc.vendas === cc.conciliados + cc.faltam + cc.compradorPaga && cc.faltam === cc.semCobrancaAinda + cc.semFreteNoAnuncio
            && [cc.totalAMais, cc.talvez.total].every(emCentavos) && pi.every(g => emCentavos(g.v) && emCentavos(g.vt) && g.v >= 0 && g.vt >= 0)
            && cent(cc.totalAMais) === somaC(pi.map(g => g.v)) && cent(cc.talvez.total) === somaC(pi.map(g => g.vt))
            && pi.reduce((t, g) => t + g.n + g.nt, 0) === totalN && pi.reduce((t, g) => t + g.nt, 0) === cc.talvez.pedidos
            && (cortado || (cent(cc.totalAMais) === somaC(pa.filter(p => !p.talvezUnidades).map(p => p.diferenca)) && cent(cc.talvez.total) === somaC(pa.filter(p => p.talvezUnidades).map(p => p.diferenca)))),
            { s, misto, totalAMais: cc.totalAMais, talvez: cc.talvez, porItem: cc.porItem });
        // Cada linha: números de 2 casas, sinal certo, cobrado − esperado = diferença, o cobrado é o do frete lido.
        const porNum = {};
        c.fretes.forEach(p => { porNum[p.pedido] = p; });
        pa.forEach(p => {
            const lido = porNum[p.pedidoFrete || p.pedido];
            Lin.conta(lido && [p.cobrado, p.esperado, p.diferenca].every(emCentavos) && p.diferenca > 0 && p.esperado > 0 && p.cobrado === lido.cobrado
                && cent(p.cobrado) - cent(p.esperado) === cent(p.diferenca) && p.diferenca > Math.max(1, p.esperado * 0.05) && !!p.itemId, { s, p });
            if (p.pedidoFrete) comOutroNumero++;
        });
        // Nada contado 2 vezes: cada venda e cada frete uma vez só; o número do frete nunca é a venda de outra linha; nada da venda de antes da janela.
        const vendasL = pa.map(p => p.pedido), fretesL = pa.map(p => p.pedidoFrete || p.pedido), fora = new Set(cc.foraJanela);
        Un.conta(new Set(vendasL).size === pa.length && new Set(fretesL).size === pa.length && !pa.some(p => p.pedidoFrete && vendasL.indexOf(p.pedidoFrete) >= 0)
            && !pa.some(p => fora.has(p.pedido) || fora.has(p.pedidoFrete || p.pedido)) && (!cortado || new Set(cc.numsFrete).size === cc.numsFrete.length),
            { s, vendasL, fretesL, fora: cc.foraJanela });
        const iT = pa.findIndex(p => p.talvezUnidades);
        Ord.conta(iT < 0 || !pa.slice(iT).some(p => !p.talvezUnidades), { s, ordem: pa.map(p => p.talvezUnidades) });
        // As telas: cartão, Geral e "Dá para recuperar" com os mesmos centavos.
        const fc = P.freteCobrado(cc, HOJE, 3);
        Tela.conta(fc && fc.contestar.v === cc.totalAMais && fc.conferir.v === cc.talvez.total && cent(fc.total) === cent(cc.totalAMais) + cent(cc.talvez.total)
            && fc.n === totalN && fc.contestar.n + fc.conferir.n === fc.n && fc.conferir.n === cc.talvez.pedidos
            && cent(fc.total) === somaC(fc.produtos.map(y => y.tot)) + (fc.resto ? cent(fc.resto.v) : 0)
            && fc.n === fc.produtos.reduce((t, y) => t + y.n + y.nt, 0) + (fc.resto ? fc.resto.pedidos : 0)
            && fc.todos.every(y => cent(y.tot) === cent(y.v) + cent(y.vt)), { s, fc: fc && { total: fc.total, n: fc.n, contestar: fc.contestar, conferir: fc.conferir, resto: fc.resto } });
        const geral = P.freteConta({ conciliacao: cc, vendasLidas: true });
        Tela.conta(geral.total === fc.total && (fc.n === 0 ? !/cobrados? a mais/.test(geral.resumo) : geral.resumo.indexOf('(' + reais(cent(fc.total))) > 0), { s, resumo: geral.resumo, total: fc.total });
        {   // também acima do corte de 200: valor = totalAMais e contagem = Σ porItem.n (antes do corte); itens = os da lista (os chamados)
            const rec = F.recuperar({ conc: cc }), pf = rec.parcelas.find(p => p.id === 'frete'), nL = pa.filter(p => !p.talvezUnidades).length;
            const nC = Object.keys(cc.porItem).reduce((t, k) => t + cc.porItem[k].n, 0);
            Rec.conta(cc.totalAMais > 0 ? (pf && pf.valor === cc.totalAMais && pf.n === nC && pf.itens.length === nL && rec.total === cc.totalAMais
                && (nC > nL ? pf.resto.n === nC - nL && cent(pf.resto.valor) === cent(cc.totalAMais) - somaC(pf.itens.map(x => x.valor)) : !pf.resto)) : (!pf && rec.total === 0),
                { s, totalAMais: cc.totalAMais, rec: rec.total, n: pf && pf.n, nC });
            if (pf) pf.itens.slice(0, 5).forEach(x => {
                const t = F.chamadoFrete(x, '');
                Txt.conta(t.indexOf('- Valor cobrado: ' + reais(cent(x.cobrado)) + '\n- Valor devido: ' + reais(cent(x.esperado)) + '\n- Diferença: ' + reais(cent(x.valor)) + '\n') > 0
                    && t.indexOf('estorno da diferença de ' + reais(cent(x.valor)) + ' na nossa conta.') > 0, { s, x, texto: t.slice(0, 300) });
            });
        }
        pa.slice(0, 5).forEach(p => {
            const l = P.contaFretePedido(p), tot = l.find(x => x.cls === 'tot'), mais = l.find(x => x.cls === 'mais');
            Txt.conta(tot.val === reais(cent(p.cobrado)) && mais.val === '+' + reais(cent(p.diferenca)) && l.every(x => !/NaN|undefined|Infinity/.test(x.val)), { s, linhas: l });
        });
        if (cc.totalAMais > 0) comAMais++;
        if (cc.talvez.pedidos) comConferir++;
    };
    const r = lcg(30092026);
    for (let s = 0; s < 120; s++) {
        const misto = s % 2 === 1, c = cenario(r, s, misto);
        if (!misto) c.vendas = c.vendas.filter(v => v.data <= HOJE);   // venda de amanhã faria o frete casar por data: o oráculo é só do mesmo número
        const cc = SHC.conciliaFrete(c.fretes, c.it, c.vendas, HOJE, c.fd);
        if (!misto) {
            const o = oraculo(c), lst = Object.keys(o.lista), por = {};
            cc.pagoAMais.forEach(p => { por[p.pedido] = p; });
            Or.conta(['vendas', 'cancelados', 'conciliados', 'compradorPaga', 'semCobrancaAinda', 'semFreteNoAnuncio'].every(k => cc[k] === o[k])
                && cc.pagoAMais.length === lst.length && lst.every(k => por[k] && cent(por[k].diferenca) === o.lista[k].difC && por[k].talvezUnidades === o.lista[k].talvez && por[k].base === o.lista[k].base)
                && cent(cc.totalAMais) === lst.filter(k => !o.lista[k].talvez).reduce((t, k) => t + o.lista[k].difC, 0)
                && cent(cc.talvez.total) === lst.filter(k => o.lista[k].talvez).reduce((t, k) => t + o.lista[k].difC, 0)
                && cc.talvez.pedidos === lst.filter(k => o.lista[k].talvez).length, { s, produto: { vendas: cc.vendas, conc: cc.conciliados, total: cc.totalAMais, talvez: cc.talvez, n: cc.pagoAMais.length }, oraculo: { vendas: o.vendas, conc: o.conciliados, n: lst.length } });
        }
        confere(c, cc, s, misto);
    }
    ok(comAMais > 20 && comConferir > 20 && comOutroNumero > 5, `os casos gerados cobrem contestável (${comAMais}), para conferir (${comConferir}) e frete com outro número (${comOutroNumero})`);

    // Acima do corte de 200: 260 contestáveis + 30 para conferir no mesmo anúncio (régua do dia 40,00).
    const it = { MLB9700000001: { itemId: 'MLB9700000001', frete: 40 } }, fd = { MLB9700000001: { '2026-08-01': 40 } }, vs = [], fs = [], rg = lcg(4242);
    let esperado = 0, espT = 0;
    for (let i = 0; i < 290; i++) {
        const ped = String(2300000000 + i), d = dia(i % 29), talvez = i >= 260, cobr = talvez ? ent(rg, 6600, 7400) / 100 : ent(rg, 4201, 4999) / 100;
        vs.push({ pedido: ped, itemId: 'MLB9700000001', data: d }); fs.push({ pedido: ped, itemId: 'MLB9700000001', data: d, cobrado: cobr, formato: 'gratis' });
        if (talvez) espT += cent(cobr) - 4000; else esperado += cent(cobr) - 4000;
    }
    const cc = SHC.conciliaFrete(fs, it, vs, HOJE, fd), g = cc.porItem.MLB9700000001, fc = P.freteCobrado(cc, HOJE);
    ok(cc.pagoAMais.length === 200 && cc.pagoAMais.every(p => !p.talvezUnidades) && cc.numsFrete.length === 290 && cent(cc.totalAMais) === esperado && cent(cc.talvez.total) === espT
        && g.n === 260 && g.nt === 30 && cent(g.v) === esperado && cent(g.vt) === espT,
        `corte de 200: a lista guarda os 200 maiores contestáveis, mas totalAMais (${SHC.moeda(cc.totalAMais)}) e porItem somam os 260 + 30`);
    ok(fc.contestar.v === cc.totalAMais && fc.contestar.n === 260 && fc.conferir.n === 30 && cent(fc.total) === esperado + espT && fc.n === 290,
        'cartão "Frete cobrado a mais" usa o porItem (sem o corte): confirmado = totalAMais, 290 pedidos');
    confere({ fretes: fs }, cc, 'corte', false);   // o caso do corte entra nas mesmas conferências abaixo
    // "Dá para recuperar" (Fechamento e Conciliação) = a aba Frete: 260 pedidos e totalAMais (antes: só os 200 da lista). A tela fecha:
    // 200 itens + "Mais 60 pedidos" = a parcela = o total do topo, "em 260 itens".
    const rc = F.recuperar({ conc: cc }), pfc = rc.parcelas.find(p => p.id === 'frete'), hc = F.htmlRecuperar(rc, () => 'Produto', true);
    const numsTela = [...hc.matchAll(/<b class="num">([^<]*)<\/b>/g)].map(m => cent(SHC.num(m[1].replace(/[R$\s.]/g, '').replace(',', '.'))));
    ok(rc.total === cc.totalAMais && pfc.n === 260 && pfc.itens.length === 200 && pfc.resto.n === 60 && hc.indexOf('<b>' + reais(esperado) + '</b> em 260 itens') > 0
        && hc.indexOf('Mais 60 pedidos') > 0 && numsTela[0] === esperado && numsTela.slice(1).reduce((t, v) => t + v, 0) === esperado,
        `"Dá para recuperar" acima do corte: ${SHC.moeda(rc.total)} em 260 pedidos (= totalAMais), e na tela 200 itens + "Mais 60 pedidos" fecham com a parcela`);
    // Frete confirmado FORA da lista (posição 250) também no "para conferir" do Fechamento (regra 'frete'): não conta 2 vezes; o de um
    // "para conferir" da conciliação (posição 270) continua no "para conferir".
    const cfx = (i, dif) => ({ regra: 'frete', pedido: cc.numsFrete[i], itemId: 'MLB9700000001', data: '2026-09-01', cobranca: 'Tarifa de envio', valor: 60, esperado: 60 - dif, diferenca: dif, motivo: 'm', estimado: 'mediana' });
    const rx = F.recuperar({ conc: cc, conferir: [cfx(250, 7), cfx(270, 9)] }), pcx = rx.parcelas.find(p => p.id === 'cobrancas');
    ok(cent(rx.total) === esperado + 900 && pcx && pcx.itens.length === 1 && pcx.itens[0].pedido === cc.numsFrete[270],
        'frete confirmado fora da lista não entra de novo pelo "para conferir" (o "para conferir" da conciliação entra): ' + SHC.moeda(rx.total));
    okLote(Or, '60 casos com o mesmo número: contagens, cada diferença, quem é "para conferir", totalAMais e talvez.total = oráculo em centavos inteiros');
    okLote(Iv, 'Σ porItem.v = totalAMais, Σ porItem.vt = talvez.total, Σ n+nt = pedidos, e Σ diferença dos contestáveis = totalAMais (120 casos gerados + o do corte)');
    okLote(Lin, 'cada pedido a mais: 2 casas, diferença > 0, cobrado − esperado = diferença, cobrado = o frete lido (pelo pedidoFrete quando o número é outro)');
    okLote(Un, 'nada contado 2 vezes: cada venda e cada número de frete uma vez só, pedidoFrete nunca é a venda de outra linha, nada da venda de antes da janela');
    okLote(Ord, 'contestáveis sempre antes dos "para conferir" (o corte de 200 nunca tira um contestável antes de uma dúvida)');
    okLote(Tela, 'cartão (P.freteCobrado) e Geral (P.freteConta): contestar = totalAMais, conferir = talvez.total, Σ anúncios + resto = total, e o resumo mostra esse R$');
    okLote(Rec, '"Dá para recuperar" (SHC.fech.recuperar) = totalAMais e a contagem de antes do corte, em cada caso (também no do corte de 200)');
    okLote(Txt, 'textos dos chamados e a conta linha a linha mostram os mesmos centavos (cobrado, devido, diferença, estorno)');
}

console.log('E. Chamado do anúncio: P.pedidosAMais e a "Diferença somada" do P.textoChamado');
{
    const item = { itemId: 'MLB9400000001', sku: 'TESTE-01', frete: 58.75 };
    const h = P.historicoFrete({ '2026-09-01': 45.35, '2026-09-19': 45.35, '2026-09-20': 58.75, '2026-09-25': 58.75 });
    const vd = {}, add = (o, d, fv, mais) => { vd[String(3000000400 + o)] = Object.assign({ d, f: fv }, mais || {}); };
    add(1, '2026-09-02', 45.35); add(2, '2026-09-05', 45.35); add(3, '2026-09-10', 45.35);   // antes da subida
    add(11, '2026-09-20', 58.75); add(12, '2026-09-20', 58.80); add(13, '2026-09-21', 46.00); add(14, '2026-09-21', 45.35); add(15, '2026-09-21', 45.36);
    add(16, '2026-09-22', 117.50); add(17, '2026-09-22', 59.99); add(18, '2026-09-22', 60.01); add(19, '2026-09-23', 47.47); add(20, '2026-09-23', 58.75, { pc: true });
    add(21, '2026-09-23', 52.00); add(22, '2026-09-24', 49.99); add(23, '2026-09-24', 50.00); add(24, '2026-09-24', 51.11); add(25, '2026-09-25', 53.33);
    const b = P.baseChamado(h, vd, item), { peds, fora } = P.pedidosAMais(vd, b.base, b.desde);
    ok(b.base === 45.35 && b.desde === '2026-09-20' && b.fonte === 'lista', 'régua do chamado: R$ 45,35 até 19/09 (lista de Anúncios)');
    ok(peds.length === 12 && JSON.stringify(fora.map(p => p.orderId)) === JSON.stringify(['3000000416']) && !peds.some(p => ['3000000414', '3000000420', '3000000403'].indexOf(p.orderId) >= 0),
        '12 pedidos acima; fora: o de 117,50 (2 unidades?); não entram o de 45,35 (igual), o compartilhado e o de antes da subida');
    ok(peds.every(p => emCentavos(p.dif) && p.dif > 0 && cent(p.dif) === cent(p.f) - 4535) && peds.find(p => p.orderId === '3000000415').dif === 0.01,
        'cada diferença = frete − 45,35 em centavos (o de 45,36 entra com R$ 0,01, nunca 0 nem negativo)');
    const t = P.textoChamado(item, h, vd, true, '');
    const listados = [...t.matchAll(/#(\d+) de (\d\d\/\d\d\/\d{4}): (R\$ [\d.,]+) \((R\$ [\d.,]+) a mais\)/g)];
    ok(listados.length === 10 && / e mais 2\./.test(t) && /Pedidos cobrados acima de R\$ 45,35 desde 20\/09\/2026 \(12\):/.test(t), 'o texto lista 10 pedidos, "e mais 2", e diz 12 no total');
    ok(listados.every(m => { const p = peds.find(x => x.orderId === m[1]); return p && m[3] === reais(cent(p.f)) && m[4] === reais(cent(p.dif)) && m[2] === dataBr(p.d); }),
        'cada pedido do texto: número, data, frete e "a mais" iguais à conta');
    ok(/Diferença somada: R\$ 88,61\./.test(t) && /estorno da diferença cobrada nos pedidos acima \(R\$ 88,61\) na nossa conta\./.test(t)
        && cent(88.61) === somaC(peds.map(p => p.dif)) && somaC(peds.slice(0, 10).map(p => p.dif)) + somaC(peds.slice(10).map(p => p.dif)) === 8861,
        'Diferença somada = R$ 88,61 = os 10 listados (74,87) + os 2 de "e mais" (13,74); o estorno pede o mesmo valor');
    ok(/Deixei de fora 1 pedido com frete bem maior/.test(t) && t.indexOf('117,50') < 0, 'o de 117,50 fica fora da soma e o texto avisa');
    const sc = P.textoChamado(item, h, vd, false, '');
    ok(/Diferença somada: R\$ 88,61\./.test(sc) && /e o estorno da diferença cobrada nos pedidos acima \(R\$ 88,61\)/.test(sc), 'pedido de revisão (sem a caixa marcada): o mesmo R$ 88,61');
    const comQ = P.pedidosAMais({ '3000000501': { d: '2026-09-21', f: 120.00, q: 2 }, '3000000502': { d: '2026-09-21', f: 90.70, q: 2 } }, 45.35, '2026-09-20');
    ok(comQ.peds.length === 1 && comQ.peds[0].dif === 29.3 && comQ.peds[0].orderId === '3000000501', 'com a quantidade: 120,00 − 2 × 45,35 = 29,30; 90,70 = 2 × 45,35 não é "a mais"');
    ok(P.textoChamado(item, null, {}, true, '') === '' && P.textoChamado(item, P.historicoFrete({ '2026-09-01': 45.35, '2026-09-25': 45.35 }), {}, true, '') === '',
        'sem subida não há chamado (nenhum R$ inventado)');

    // Gerados: 200 anúncios com subida pela lista ou pelas vendas, pedidos ruidosos, compartilhados e de 2 unidades.
    const r = lcg(1909), Tx = lote(), Pd = lote();
    let comTexto = 0, comMais10 = 0, pelaLista = 0, pelasVendas = 0;
    for (let i = 0; i < 200; i++) {
        const b0 = ent(r, 1990, 6990) / 100, b1 = r2(b0 + ent(r, 120, 2500) / 100), sub = ent(r, 3, 70), id = 'MLB94' + String(i).padStart(8, '0');
        const usaLista = r() < 0.55, fh = usaLista ? { [dia(90)]: b0, [dia(sub + 1)]: b0, [dia(sub)]: b1, [HOJE]: b1 } : null;
        const vd2 = {};
        for (let j = ent(r, 0, 40); j > 0; j--) {
            const o = ent(r, 0, 100), base = o > sub ? b0 : b1, x = r();
            const fv = x < 0.08 ? r2(base * 2) : x < 0.13 ? r2(base * 2.4) : Math.max(0.01, r2(base + ent(r, -60, 90) / 100));
            vd2[String(3100000000 + i * 100 + j)] = Object.assign({ d: dia(o), f: fv }, r() < 0.05 ? { pc: true } : {});
        }
        const it2 = { itemId: id, sku: 'SKU-' + i, frete: b1 }, h2 = fh ? P.historicoFrete(fh) : null, bb = P.baseChamado(h2, vd2, it2);
        const t2 = P.textoChamado(it2, h2, vd2, r() < 0.5, '');
        if (!Pd.conta(!!bb === !!t2, { i, base: bb, texto: !!t2 }) || !bb) continue;
        if (bb.fonte === 'lista') pelaLista++; else pelasVendas++;
        const foraS = new Set(P.freteMensal(vd2).fora.map(p => p.orderId));
        const acima = Object.keys(vd2).filter(o => { const v = vd2[o]; return v.d && !v.pc && v.f > 0 && v.d >= bb.desde && v.f > bb.base + 0.009; });
        const ps = acima.filter(o => !foraS.has(o)).sort((a, c) => (vd2[a].d < vd2[c].d ? -1 : vd2[a].d > vd2[c].d ? 1 : 0));
        const difs = ps.map(o => cent(vd2[o].f) - cent(bb.base)), soma = difs.reduce((s, v) => s + v, 0);
        const lst = [...t2.matchAll(/#(\d+) de (\d\d\/\d\d\/\d{4}): (R\$ [\d.,]+) \((R\$ [\d.,]+) a mais\)/g)];
        const r0 = P.pedidosAMais(vd2, bb.base, bb.desde);
        Pd.conta(emCentavos(bb.base) && JSON.stringify(r0.peds.map(p => p.orderId)) === JSON.stringify(ps) && r0.peds.every((p, k) => cent(p.dif) === difs[k] && p.dif > 0), { i, base: bb.base, ps, peds: r0.peds });
        if (ps.length) comTexto++;
        if (ps.length > 10) comMais10++;
        Tx.conta(ps.length ? (t2.indexOf(`Diferença somada: ${reais(soma)}.`) > 0 && t2.indexOf(`nos pedidos acima (${reais(soma)}) na nossa conta.`) > 0
            && t2.indexOf(`(${ps.length}): `) > 0 && lst.length === Math.min(10, ps.length) && lst.every((m, k) => m[1] === ps[k] && m[3] === reais(cent(vd2[ps[k]].f)) && m[4] === reais(difs[k]))
            && (ps.length > 10 ? t2.indexOf(` e mais ${ps.length - 10}.`) > 0 : !/ e mais \d+\./.test(t2)))
            : !/Diferença somada|a mais\)/.test(t2), { i, soma, n: ps.length, texto: t2.slice(0, 400) });
    }
    okLote(Pd, 'P.pedidosAMais nos gerados: os mesmos pedidos e as mesmas diferenças (centavos inteiros) que a régua independente');
    okLote(Tx, '"Diferença somada", o estorno pedido e cada "(R$ X a mais)" do texto = a conta em centavos inteiros (até 10 listados + "e mais N")');
    ok(comTexto > 60 && comMais10 > 5 && pelaLista > 30 && pelasVendas > 10, `os gerados cobrem texto com pedidos (${comTexto}), mais de 10 (${comMais10}), régua da lista (${pelaLista}) e das vendas (${pelasVendas})`);
}

console.log('F. "Frete do anúncio subiu" sem contar 2 vezes o que já está em "Frete cobrado a mais" (P.freteSubidaJanela)');
{
    const ids = P.idsCobradoAMais(concC), fora = new Set(concC.foraJanela);
    ok(['2000000301', '2000000310', '9100000310', '2000000303', '2000000304', '2000000309'].every(x => ids.has(x)) && ids.size === 6, 'ids da lista de cima: a venda E o número do frete (#9100000310)');
    const vd = { [C]: { '9100000310': { d: '2026-09-07', f: 34.44 }, '9100000320': { d: '2026-09-12', f: 36.10 }, '2000000314': { d: '2026-08-29', f: 45.00 }, '9100000321': { d: '2026-09-13', f: 30.00 } } };
    const subs = [{ l: { it: { itemId: C } }, s: { de: 30, para: 34.44, desde: '2026-08-25' } }];
    const sj = P.freteSubidaJanela(subs, vd, ids, '2026-08-27', fora);
    ok(sj.n === 1 && sj.v === 6.1 && sj.jaEmCima === 1 && sj.anuncios.length === 1 && sj.anuncios[0].v === 6.1 && sj.anuncios[0].n === 1,
        'só o #9100000320 (36,10 − 30,00 = 6,10) entra; o #9100000310 já está em cima (pedidoFrete) e o da venda de antes da janela fica fora');
    // Gerados: ids e fora sorteados; v = Σ dos novos, nenhum novo repetido em cima.
    const r = lcg(2509), G = lote();
    for (let i = 0; i < 150; i++) {
        const base = ent(r, 1990, 5990) / 100, desde = dia(ent(r, 5, 40)), vds = {}, idsS = new Set(), foraS = new Set(), subsS = [];
        for (let k = ent(r, 1, 4); k > 0; k--) {
            const id = 'MLB95' + String(i).padStart(4, '0') + String(k).padStart(4, '0'), m = {};
            for (let j = ent(r, 0, 25); j > 0; j--) {
                const o = String(3200000000 + i * 1000 + k * 100 + j);
                m[o] = { d: dia(ent(r, 0, 60)), f: Math.max(0.01, r2(base + ent(r, -200, 900) / 100)) };
                const x = r(); if (x < 0.25) idsS.add(o); else if (x < 0.35) foraS.add(o);
            }
            vds[id] = m; subsS.push({ l: { it: { itemId: id } }, s: { de: base, para: r2(base + 3), desde } });
        }
        const de = dia(29), sjS = P.freteSubidaJanela(subsS, vds, idsS, de, foraS);
        let nE = 0, vE = 0, jaE = 0;
        subsS.forEach(x => {
            const ds = de > x.s.desde ? de : x.s.desde, rr = P.pedidosAMais(vds[x.l.it.itemId], x.s.de, ds);
            const novos = rr.peds.filter(p => !idsS.has(p.orderId) && !foraS.has(p.orderId));
            nE += novos.length; vE += novos.reduce((t, p) => t + cent(vds[x.l.it.itemId][p.orderId].f) - cent(x.s.de), 0);
            jaE += rr.peds.concat(rr.fora).filter(p => idsS.has(p.orderId)).length;
        });
        G.conta(sjS.n === nE && cent(sjS.v) === vE && emCentavos(sjS.v) && sjS.jaEmCima === jaE && cent(sjS.v) === somaC(sjS.anuncios.map(a => a.v)) && sjS.n === sjS.anuncios.reduce((t, a) => t + a.n, 0),
            { i, sj: { n: sjS.n, v: sjS.v, ja: sjS.jaEmCima }, esperado: { nE, vE, jaE } });
    }
    okLote(G, 'gerados: n e R$ da subida = Σ dos pedidos que não estão em cima nem fora da janela; Σ anúncios = total');
}

console.log('G. Frete cobrado nos últimos 30 × 30 dias (SHC.freteHistorico): Σ das partes = total');
{
    const r = lcg(6062026), ps = [], itens = [], fulls = new Set(), flexs = new Set(), taxas = {};
    for (let i = 0; i < 12; i++) {
        const id = 'MLB98000000' + String(i).padStart(2, '0'), x = r();
        const it = { itemId: id };
        if (x < 0.2) { it.estoque = 'Full'; fulls.add(id); } else if (x < 0.35) { it.flexBonus = 5; flexs.add(id); }
        if (i >= 10) { it.freteComprador = true; it.taxaOperacional = ent(r, 500, 1500) / 100; taxas[id] = it.taxaOperacional; }
        itens.push(it);
    }
    for (let i = 0; i < 500; i++) {
        const o = ent(r, -2, 75), x = r(), canc = x < 0.07, aprox = !canc && x < 0.14, item = r() < 0.05 ? '' : itens[ent(r, 0, 9)].itemId, cobr = ent(r, 1, 25000) / 100;
        ps.push(Object.assign({ pedido: String(3300000000 + i), itemId: item, data: dia(o), cobrado: canc ? 0 : cobr, cancelado: canc,
            formato: canc ? 'cancelado' : aprox ? (r() < 0.5 ? null : 'compartilhado') : ['gratis', 'gratis', 'compartilhado', 'extra'][ent(r, 0, 3)] },
            aprox ? { aprox: true } : {}, !canc && r() < 0.3 ? { cheio: r2(cobr + ent(r, 1, 5000) / 100) } : {}));
    }
    const vendas30 = [];
    for (let i = 0; i < 40; i++) vendas30.push({ pedido: String(3390000000 + i), itemId: itens[10 + (i % 2)].itemId, data: dia(ent(r, -1, 40)), cancelada: r() < 0.1 });
    const h = SHC.freteHistorico(ps, HOJE, itens, vendas30), ini30 = dia(29), ini60 = dia(59), u = h.conta.ult30, a = h.conta.ant30;
    const vale = p => !p.cancelado && p.data <= HOJE, em30 = p => vale(p) && p.data >= ini30, emAnt = p => vale(p) && p.data < ini30 && p.data >= ini60;
    const u30 = ps.filter(em30), a30 = ps.filter(emAnt);
    ok(u.pedidos === u30.length && cent(u.total) === somaC(u30.map(p => p.cobrado)) && a.pedidos === a30.length && cent(a.total) === somaC(a30.map(p => p.cobrado))
        && emCentavos(u.total) && emCentavos(a.total), `conta: ${u.pedidos} pedidos e ${SHC.moeda(u.total)} nos 30 dias = Σ dos fretes lidos (cancelados e de amanhã fora)`);
    ok(u.medio === r2(u.total / u.pedidos) && a.medio === r2(a.total / a.pedidos) && cent(u.descontoML) === u30.filter(p => p.cheio > p.cobrado).reduce((s, p) => s + cent(p.cheio) - cent(p.cobrado), 0),
        'médio = total ÷ pedidos (2 casas) e desconto do ML = Σ (cheio − cobrado)');
    const pa = Object.keys(h.porAnuncio).map(k => h.porAnuncio[k]);
    ok(cent(u.total) === somaC(pa.map(x => x.ult30.total)) + somaC(u30.filter(p => !p.itemId).map(p => p.cobrado)) && u.pedidos === pa.reduce((t, x) => t + x.ult30.pedidos, 0) + u30.filter(p => !p.itemId).length
        && cent(a.total) === somaC(pa.map(x => x.ant30.total)) + somaC(a30.filter(p => !p.itemId).map(p => p.cobrado)),
        'Σ por anúncio + pedidos sem anúncio = conta (30 dias e 30 anteriores)');
    const pf = h.conta.porFormato, fmts = ['gratis', 'compartilhado', 'extra'].filter(k => pf[k]);
    ok(cent(u.total) === somaC(fmts.map(k => pf[k].total)) + somaC(u30.filter(p => p.aprox).map(p => p.cobrado)) && fmts.every(k => pf[k].pedidos === u30.filter(p => !p.aprox && p.formato === k).length)
        && pf.cancelado.pedidos === ps.filter(p => p.cancelado && p.data >= ini30 && p.data <= HOJE).length, 'formatos (grátis + compartilhado + extra) + aproximados (sem formato) = total; cancelados contados à parte');
    ok(cent(pf.full.total) === somaC(u30.filter(p => fulls.has(p.itemId)).map(p => p.cobrado)) && cent(pf.flex.total) === somaC(u30.filter(p => flexs.has(p.itemId)).map(p => p.cobrado)),
        'Full e Flex = Σ do frete dos anúncios de cada um');
    const cpV = vendas30.filter(v => !v.cancelada && v.data >= ini30 && v.data <= HOJE);
    ok(pf.compradorPaga.pedidos === cpV.length && cent(pf.compradorPaga.custoOperacional) === cpV.reduce((s, v) => s + cent(taxas[v.itemId]), 0)
        && pf.compradorPaga.taxaMedia === r2((taxas[itens[10].itemId] + taxas[itens[11].itemId]) / 2), 'comprador paga (taxa lida): custo operacional = Σ taxa × pedido');
    const pt = P.formatosFrete(pf);
    ok(pt.every(x => x.total === null || emCentavos(x.total)) && pt.filter(x => x.total !== null).every(x => SHC.moeda(x.total) === reais(cent(x.total))), 'tabela "Formatos de frete": cada valor da tela = o da conta');
    const vazio = SHC.freteHistorico([], HOJE);
    ok(vazio.conta.ult30.medio === null && vazio.conta.ult30.tipico === null && vazio.conta.variacaoPct === null && SHC.moeda(vazio.conta.ult30.medio) === '—',
        'sem pedido: médio e típico null ("—"), nunca R$ 0,00 inventado');
}

console.log('H. Frete pago a mais por mês e por SKU (P.pagoAMaisPorMes, P.rankingFrete): total = Σ das partes');
{
    const r = lcg(1210), itens = [], vendas = {}, M = lote(), R = lote();
    for (let i = 0; i < 60; i++) {
        const id = 'MLB99' + String(i).padStart(8, '0'), b0 = ent(r, 1990, 5990) / 100, b1 = r2(b0 + ent(r, 50, 1800) / 100), sub = ent(r, 20, 300), m = {};
        for (let j = ent(r, 0, 50); j > 0; j--) { const o = ent(r, 0, 360); m[String(3400000000 + i * 100 + j)] = { d: dia(o), f: Math.max(0.01, r2((o > sub ? b0 : b1) + ent(r, -40, 60) / 100)) }; }
        vendas[id] = m; itens.push({ itemId: id, sku: i % 3 === 0 ? '' : 'SKU-' + (i % 11), titulo: 'Produto ' + i });
    }
    itens.forEach(it => {
        const t = P.pagoAMaisPorMes(vendas[it.itemId], P.mesMenos('2026-09', 11), '2026-09');
        M.conta(t.linhas.every(l => emCentavos(l.aMais) && l.aMais >= 0 && (l.aMais === 0 || (l.dif !== null && cent(l.aMais) === cent(l.dif) * l.n))) && cent(t.total) === somaC(t.linhas.map(l => l.aMais)),
            { id: it.itemId, total: t.total, linhas: t.linhas });
    });
    const rk = P.rankingFrete(itens, vendas);
    R.conta(cent(rk.total) === somaC(rk.grupos.map(g => g.aMais)) && cent(rk.total12) === somaC(rk.grupos.map(g => g.total12)), { total: rk.total, total12: rk.total12 });
    rk.grupos.forEach(g => {
        const t12 = g.itemIds.reduce((s, id) => s + cent(P.pagoAMaisPorMes(vendas[id], rk.desde, rk.mes).total), 0);
        const am = g.itemIds.reduce((s, id) => s + somaC(P.pagoAMaisPorMes(vendas[id], rk.desde, rk.mes).linhas.filter(l => l.mes.slice(0, 7) === rk.mes).map(l => l.aMais)), 0);
        R.conta(cent(g.total12) === t12 && cent(g.aMais) === am && (g.n ? g.porVenda === r2(g.aMais / g.n) : g.porVenda === 0), { g });
    });
    okLote(M, 'por mês: a mais = (típico − base) × vendas em centavos, e o total dos 12 meses = Σ dos meses');
    okLote(R, 'por SKU: Σ dos anúncios do SKU = linha do SKU, e o total do ranking = Σ das linhas (mês e 12 meses)');
    ok(rk.grupos.length > 5, `o ranking gerado tem ${rk.grupos.length} SKUs com frete a mais`);
}

(async () => {
    console.log('I. Vendas por mês e vd|ml (SHC.vendasPorMes, SHC.registraVendas)');
    {
        const v = (tipo, orderId, itemId, data) => ({ tipo, orderId, itemId, data, valor: 10 });
        const vm = SHC.vendasPorMes([v('venda', '1', 'MLB9900000001', '2026-08-10'), v('venda_cancelada', '1', 'MLB9900000001', '2026-08-12'),
            v('venda', '2', 'MLB9900000001', '2026-08-11'), v('venda', '2', 'MLB9900000001', '2026-08-11'), v('venda', '3', 'MLB9900000001', '2026-09-01'),
            v('venda_cancelada', '4', 'MLB9900000001', '2026-09-02'), v('venda', '5', 'MLB9900000002', '2026-09-03'), v('venda_cancelada', '5', 'MLB9900000002', '2026-09-04'),
            v('venda_cancelada', '5', 'MLB9900000002', '2026-09-05')]);
        ok(JSON.stringify(vm) === JSON.stringify({ MLB9900000001: { '2026-08': 2, '2026-09': 1 }, MLB9900000002: { '2026-09': 0 } }),
            'agosto: 1 − 1 + 2 = 2; setembro: 1 (cancelamento sem a venda fica fora); 2 cancelamentos de 1 venda = 0, nunca −1');
        const r = lcg(31), cobs = [], esp = {};
        for (let i = 0; i < 400; i++) {
            const id = 'MLB99000000' + String(i % 9).padStart(2, '0'), d = dia(ent(r, 0, 120)), nv = ent(r, 0, 3), nc = ent(r, 0, 3), o = String(3500000000 + i);
            for (let j = 0; j < nv; j++) cobs.push(v('venda', o, id, d));
            for (let j = 0; j < nc; j++) cobs.push(v('venda_cancelada', o, id, d));
            if (nv) { const m = (esp[id] || (esp[id] = {})); m[d.slice(0, 7)] = (m[d.slice(0, 7)] || 0) + Math.max(0, nv - nc); }
        }
        ok(JSON.stringify(SHC.vendasPorMes(cobs)) === JSON.stringify(esp), 'gerados (400 pedidos): unidades do mês = Σ max(0, vendas − cancelamentos), inteiras e nunca negativas');
        banco['vd|ml|MLB9900000003'] = { '3600000001': { d: '2026-09-01', f: 45.35 }, '3600000002': { d: '2025-01-10', f: 9.99 }, '3600000003': { d: '2026-09-02', f: 7.77, pc: true } };
        await SHC.registraVendas({ MLB9900000003: { '3600000003': null, '3600000004': { d: '2026-09-20', f: 12.34, pc: false } } });
        const lido = (await SHC.lerVendas(['MLB9900000003'])).MLB9900000003;
        ok(JSON.stringify(lido) === JSON.stringify({ '3600000001': { d: '2026-09-01', f: 45.35 }, '3600000004': { d: '2026-09-20', f: 12.34, pc: false } }),
            'registraVendas: junta sem mexer nos centavos (45,35 e 12,34), null apaga o cancelado e o pedido de mais de 400 dias sai');
        const pf = P.pedidosFrete(lido);
        ok(pf.lista.map(p => SHC.moeda(p.f)).join(' ') === 'R$ 12,34 R$ 45,35' && pf.normal === r2((12.34 + 45.35) / 2), '"Vendas × frete cobrado": a tabela mostra os mesmos R$ guardados');
    }
    console.log('J. Fundo (gravarFreteHist): estorno lido num mês depois da tarifa baixa o cobrado E o cheio (não vira "Desconto do ML")');
    {
        // Tarifa de 31/08 guardada na sincronização de agosto; em 25/09 só setembro é relido e traz o estorno PARCIAL de R$ 10,00 do mesmo pedido.
        const CONTA = '123456789', MLB = 'MLB9800000777', PED = '2000000777', TX = 'Tarifa do Mercado Envios (Por sua conta)';
        const monta = cheio => montaFundo({ hoje: HOJE, dados: { 'ml:conta': CONTA, ['ml:anuncios:' + CONTA]: { itens: [{ itemId: MLB, frete: 50 }] },
            ['ml:cobrancas:' + CONTA]: { mesesLidos: ['2026-07', '2026-08', '2026-09'] },
            ['frete:' + CONTA + ':pedidos']: { ts: 1, pedidos: { [PED]: { itemId: MLB, data: '2026-08-31', cobrado: 50, bruto: 50, cheio, formato: 'gratis', cancelado: false,
                linhas: [{ t: TX, v: 50, d: '2026-08-31' }] } }, vendas: { [PED]: { itemId: MLB, data: '2026-08-31', cancelada: false } } } } });
        const est = { tipo: 'frete_estorno', estorno: true, orderId: PED, itemId: MLB, data: '2026-09-02', valor: 10, texto: 'Cancelamento da tarifa do Mercado Envios', id: 'est-1' };
        const ped = fu => fu.dados['frete:' + CONTA + ':pedidos'].pedidos[PED];
        const junto = cheio => SHC.freteDasCobrancas([{ tipo: 'frete', orderId: PED, itemId: MLB, data: '2026-08-31', valor: 50, cheio, texto: TX }, est])[0];   // tarifa + estorno no mesmo lote
        // Sem desconto do ML (cheio = cobrado = 50): separado dá o mesmo que junto — cobrado 40, cheio 40, nenhum desconto; reler não muda.
        const a = monta(50), a1 = await a.ctx.gravarFreteHist(CONTA, [est], ['2026-09']), pa = ped(a), a2 = await a.ctx.gravarFreteHist(CONTA, [est], ['2026-09']);
        ok(pa.cobrado === 40 && pa.cheio === 40 && junto(50).cobrado === 40 && junto(50).cheio === 40 && a1.conta.ult30.total === 40 && a1.conta.ult30.descontoML === 0
            && ped(a).cobrado === 40 && ped(a).cheio === 40 && a2.conta.ult30.total === 40 && a2.conta.ult30.descontoML === 0,
            'tarifa R$ 50,00 + estorno de R$ 10,00 lido em setembro: cobrado 40,00 e cheio 40,00 (igual a ler os dois juntos), "Desconto do ML" R$ 0,00 (antes R$ 10,00); reler não muda');
        // Com desconto do ML de verdade (cheio 60, cobrado 50): o desconto continua R$ 10,00, e reler o mesmo estorno não desconta o cheio de novo.
        const b = monta(60), b1 = await b.ctx.gravarFreteHist(CONTA, [est], ['2026-09']), pb = ped(b), b2 = await b.ctx.gravarFreteHist(CONTA, [est], ['2026-09']);
        ok(pb.cobrado === 40 && pb.cheio === 50 && junto(60).cheio === 50 && b1.conta.ult30.descontoML === 10 && ped(b).cheio === 50 && b2.conta.ult30.descontoML === 10 && b2.conta.ult30.total === 40,
            'com desconto do ML (cheio 60, cobrado 50) e estorno de 10: cobrado 40, cheio 50, desconto R$ 10,00 (antes R$ 20,00) — também na releitura');
        // Tarifa e estorno lidos JUNTOS em 04/09 (agosto e setembro); em 05/09 só setembro é relido e traz o mesmo estorno sem a tarifa:
        // não desconta de novo (antes: cobrado 40 → 30 e o frete dos 30 dias R$ 10,00 menor).
        const tarifa = cheio => ({ tipo: 'frete', orderId: PED, itemId: MLB, data: '2026-08-31', valor: 50, cheio, texto: TX, id: 'tar-1' });
        for (const cheio of [50, 60]) {
            const c = montaFundo({ hoje: '2026-09-04', dados: { 'ml:conta': CONTA, ['ml:anuncios:' + CONTA]: { itens: [{ itemId: MLB, frete: 50 }] }, ['ml:cobrancas:' + CONTA]: { mesesLidos: ['2026-07', '2026-08', '2026-09'] } } });
            await c.ctx.gravarFreteHist(CONTA, [tarifa(cheio), est], ['2026-08', '2026-09']);
            const p1 = ped(c), c2 = montaFundo({ hoje: '2026-09-05', dados: c.dados }), s2 = await c2.ctx.gravarFreteHist(CONTA, [est], ['2026-09']), p2 = ped(c2);
            ok(p1.cobrado === 40 && p1.cheio === cheio - 10 && p2.cobrado === 40 && p2.cheio === cheio - 10 && s2.conta.ult30.total === 40 && s2.conta.ult30.descontoML === cheio - 50
                && p2.linhas.filter(l => l.e).length === 1,
                'tarifa + estorno lidos juntos (cheio ' + cheio + ') e o estorno relido sozinho no dia seguinte: cobrado 40, cheio ' + (cheio - 10) + ', 1 linha de estorno (antes cobrado 30)');
        }
    }
    console.log(f ? `\n${f} FALHA(S) em ${nChecks} conferências` : `\n${nChecks} conferências de centavos.\nTUDO OK`);
    process.exit(f ? 1 : 0);
})();
