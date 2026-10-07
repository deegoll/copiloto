// Centavos do motor do núcleo e do TikTok (pedido da dona: "cada centavo tem que bater, a tela tem que bater 100%").
// Prova, só com dados inventados (ids e valores fictícios), que cada conta de dinheiro do copiloto-nucleo e do TikTok da extensão fecha no
// centavo e que o texto da tela (SHC.moeda, aba TikTok) é o número da conta:
//   A. régua: CopilotoNucleo.util (r2, soma, num) × SHC.r2/SHC.moeda; somar milhares de linhas não perde nem cria centavo; a pasta nucleo/ da
//      extensão é cópia byte a byte de copiloto-nucleo/src (testar uma é testar a outra);
//   B. tarifas.js: tarifasDoItem contra a conta em centavos INTEIROS (TikTok antes/depois de 15/07, SFP com teto, Shopee, ML); sem tabela = null;
//      simular: receita − tarifas − frete = repasse; repasse − custo − outros − imposto = lucro; precoMinimo empata e 1 centavo abaixo não;
//   C. motor.lucroPedido gerado: bruto = Σ itens, receita = bruto − desconto, líquida = receita − reembolso, repasse = líquida − Σ tarifas
//      (estorno com sinal −, 'ads' fora do repasse), lucro = repasse − custo − imposto − outros − ads, as linhas somam o repasse e o lucro;
//      não lido / sem custo / Ads não lido nunca viram R$ 0,00; cancelado; kit; vigência; rateio por item;
//   D. rateioAds: Σ partes + não rateado = Σ custo, por anúncio e por pedido;
//   E. lucroPorProduto e fechamentoMes: lucro do mês = lucro dos pedidos − tarifas sem pedido − Ads não rateado; estornos; pendentes;
//   F. conciliação pedido × repasse: diferença = recebido − esperado (sinal), totais = Σ linhas + grupos, repasse repetido conta 1 vez;
//   G. adaptador TikTok (núcleo): extrato do pedido (receita, tarifas, frete líquido = custo − cliente − subsídio, estorno, grupos sub_fees),
//      repasse = preço − tarifas − frete do vendedor (+ subsídios) no centavo; lista do Financeiro; extratos; a receber; saldo; detalhe;
//   H. adaptador Shopee (núcleo): escrow fecha no centavo; frete líquido; desconto do vendedor;
//   I. extensão (tiktok.js): captura → gravado → SHC.tt.resumo: repasse de cada pedido = o do TikTok, Σ por pedido = total do período
//      (KPI, conciliação, linha do tempo, extratos), produto: repasse = receita − tarifas;
//   J. tela (tiktok-aba.js): cada valor da conta do pedido é o número do resultado; as linhas somam o repasse e o lucro; KPI, a receber,
//      recebido, extratos e produtos; valor ausente aparece "—" (nunca R$ 0,00 inventado); nada de NaN/undefined/Infinity.
// Casos gerados com semente fixa (LCG): o resultado é o mesmo em toda execução (nada de Math.random).
// Divergências achadas nesta auditoria (fora deste teste para a suíte seguir verde; repro mínimo de cada uma: scratchpad/centavos/nucleo_repro_NN_*.js):
//   1) CORRIGIDA (#30): tiktok.pedidoDoDetalhe fazia cada linha = r2(origem × total_sku / Σ) sem o resto (R$ 100,00 em 3 × R$ 33,33 → 99,99).
//      Agora pelo maior resto (motor.reparte): Σ itens = preço de origem e o reembolso "total" fecha (seção G).
//   2) CORRIGIDA (#29/#31): motor.rateioAds dava ao último pedido todo o arredondamento dos outros (Ads de R$ 0,05 em 10 pedidos iguais →
//      9 × 0,01 e o último −0,04). Agora reparte pelo maior resto: cada parte a < 1 centavo da exata, nenhuma negativa (seção D).
//   3) CORRIGIDA (#32): motor.lucroPedido.por_item fazia r2(total × participação) em cada item, sem o resto (Σ itens ≠ pedido em ≈40% dos
//      pedidos com 2+ itens; Produtos ≠ KPI por centavos). Agora pelo maior resto: Σ itens = o pedido (seções C, E e I).
//   4) CORRIGIDA (#33): tarifa 'ads' DENTRO do extrato do pedido (GMV Pay, mapeado por suposição; a conta do extrato fecha com ela) deixava
//      o repasse do motor ≠ settlement (84 × 54) e a conciliação "a menor" −R$ 30 falso. Agora o Ads com origem_pagamento 'venda' (o
//      adaptador diz que veio no extrato/escrow do pedido) sai do repasse; a conta na tela mostra "Ads pago com o repasse" (seções G e K).
//   5) CORRIGIDA (#34): frete ilegível virava 0 e {amount:""} virava 0 (Number("") = 0); a extensão usava o detalhe como "exato" assim mesmo
//      (Repasse R$ 100 × R$ 80 pagos, "a menor" falso). Agora vazio → null, frete ilegível = frete não lido com aviso, e o detalhe que não fecha
//      (ou com valor ilegível) nunca é exato: vale a lista do Financeiro, ou o pedido fica "não lido" (seções A, G e K).
//   6) SHC.tt.resumo: o KPI "Lucro 30 dias" (e a receita/margem) soma só status 'ok'; o pedido CANCELADO com tarifa/frete que ficou
//      (lucro −R$ 8,50) entra em Produtos e na conciliação, mas some do KPI: KPI R$ 37,00 × produto R$ 28,50 na mesma tela.
//   7) tarifas.simular: classe pela margem JÁ arredondada a 1 casa: prejuízo de −R$ 0,01 em R$ 300 (margem −0,003% → −0) sai "lucrativo".
//   8) util.r2 (= SHC.r2) não arredonda o meio centavo sempre igual: 6% de R$ 282,25 = 16,935 → 16,93, mas a maioria dos empates sobe
//      (≈4–9% dos empates de tarifa descem); SHC.moeda(16,935) mostra "R$ 16,94".
//   9) Aba TikTok sem nenhum pedido do Financeiro lido (só o saldo, por exemplo): o card Repasse mostra "Recebido: R$ 0,00 · a liberar:
//      R$ 0,00" ao lado de "Abra o Financeiro…" — zero inventado (conciliar() de nada devolve 0, e a aba só esconde null).
//  10) SHC.tt.lucroDoPedido só marca status_repasse/data_prevista pela LISTA do Financeiro: o pedido "Est." lido só no detalhe do extrato
//      entra no "a liberar" da conciliação, mas some da linha do tempo "Previsto" (a soma do Previsto fica menor que o "a liberar").
//  11) conciliar(): pedido com uma linha já liquidada e outra "Est." (venda paga R$ 73 + devolução em andamento −R$ 30 = esperado R$ 43)
//      compara só o recebido com o esperado: status "a maior" e, na tela, "diferença do esperado: R$ 30,00" em vermelho — alarme falso
//      (com o sinal trocado vira "parcial" e a diferença entra no total do mesmo jeito).
// Rodar: node tests/copiloto/teste_centavos_nucleo.js
'use strict';
require('./relogio').fixar();
const path = require('path'), fs = require('fs');
// chrome.storage.local de mentira, com memória (a captura do TikTok grava e o SHC.tt.ler lê de verdade).
const banco = {};
const copia = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
global.chrome = { storage: { local: {
    get: async k => { const o = {}; (k === null || k === undefined ? Object.keys(banco) : [].concat(k)).forEach(x => { if (x in banco) o[x] = copia(banco[x]); }); return o; },
    getKeys: async () => Object.keys(banco),
    set: async o => { Object.keys(o).forEach(k => { banco[k] = copia(o[k]); }); },
    remove: async k => { [].concat(k).forEach(x => delete banco[x]); } } }, runtime: { id: 'copiloto-teste', sendMessage: async () => ({}) } };
const RAIZ = path.join(__dirname, '../..'), EXT = path.join(RAIZ, 'extension-copiloto'), SRC = path.join(RAIZ, 'copiloto-nucleo', 'src');
const SHC = require(path.join(EXT, 'calc.js'));
require(path.join(EXT, 'store.js'));
// Como no navegador: o núcleo (pasta nucleo/ da extensão) em window.CopilotoNucleo, carregado ANTES do tiktok.js.
const NU = f => require(path.join(EXT, 'nucleo', f));
const CN = global.CopilotoNucleo = { util: NU('util.js'), modelo: NU('modelo.js'), tarifas: NU('tarifas.js'), motor: NU('motor.js'), conciliacao: NU('conciliacao.js'),
    adaptador: NU('adaptador.js'), adaptadores: { tiktok: NU('adaptadores/tiktok.js') } };
const SP = require(path.join(SRC, 'adaptadores', 'shopee.js'));   // a Shopee ainda não vai na extensão: vem de copiloto-nucleo/src
const TT = require(path.join(EXT, 'tiktok.js'));
const ABA = require(path.join(EXT, 'tiktok-aba.js'));
const U = CN.util, M = CN.modelo, T = CN.tarifas, MO = CN.motor, CO = CN.conciliacao, N = CN.adaptadores.tiktok;
let f = 0, nChecks = 0;
const ok = (c, m) => { nChecks++; console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) f++; };

// ── Régua independente do produto: centavos INTEIROS ──
const cent = v => Math.round(v * 100);   // só para valor que já deveria ter 2 casas (emCentavos prova isso)
const emCentavos = v => typeof v === 'number' && isFinite(v) && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
const dinOk = v => v === null || emCentavos(v);   // dinheiro do resultado: centavos exatos ou null (não lido) — nunca NaN/undefined
const milhar = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
// O R$ que a tela TEM de mostrar, montado só com inteiros: "R$ 1.234,56", "−R$ 0,05".
const reais = c => { const a = Math.abs(c); return (c < 0 ? '−' : '') + 'R$ ' + milhar(Math.floor(a / 100)) + ',' + String(a % 100).padStart(2, '0'); };
// Texto da tela → centavos inteiros ("R$ 1.234,56" → 123456; "−R$ 5,28" / "+R$ 5,28" → ∓528; "—" → null; outra coisa → NaN).
const deMoeda = t => {
    const s = String(t).trim();
    if (s === '—') return null;
    const m = /^([−+]?)R\$\s(\d{1,3}(?:\.\d{3})*),(\d\d)$/.exec(s);
    return m ? (m[1] === '−' ? -1 : 1) * (Number(m[2].replace(/\./g, '')) * 100 + Number(m[3])) : NaN;
};
// Valor do TikTok: {amount:"-32.99"} (ponto decimal) e {format_price:"R$ 1.234,56"}, montados de centavos inteiros.
const txt = c => (c < 0 ? '-' : '') + Math.floor(Math.abs(c) / 100) + '.' + String(Math.abs(c) % 100).padStart(2, '0');
const amt = c => ({ amount: txt(c), currency: 'BRL' });
const fp = c => ({ format_price: (c < 0 ? '-' : '') + 'R$ ' + milhar(Math.floor(Math.abs(c) / 100)) + ',' + String(Math.abs(c) % 100).padStart(2, '0') });
// Arredondamento "meio para cima" de num/den (inteiros ≥ 0) — a régua dos testes de tarifa.
const meioCima = (num, den) => { const q = Math.floor(num / den), resto = num - q * den; return 2 * resto >= den ? q + 1 : q; };
// Gerador com semente fixa (LCG de Numerical Recipes).
const lcg = s => { let x = s >>> 0; return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296; };
const ent = (r, a, b) => a + Math.floor(r() * (b - a + 1));
const um = (r, xs) => xs[ent(r, 0, xs.length - 1)];
const din = (r, a, b) => ent(r, Math.round(a * 100), Math.round(b * 100)) / 100;   // R$ com 2 casas entre a e b
// Conferência em lote: conta os casos e guarda o 1º que falhou (vira o repro).
const lote = () => { const o = { n: 0, ruim: null, conta(c, ex) { o.n++; if (!c && !o.ruim) o.ruim = ex === undefined ? '(sem detalhe)' : ex; return c; } }; return o; };
const okLote = (l, m) => ok(!l.ruim && l.n > 0, m + ` (${l.n} conferências)` + (l.ruim ? ' — 1º caso: ' + JSON.stringify(l.ruim).slice(0, 700) : ''));
const NADA = [null, undefined, NaN, Infinity, -Infinity];
const somaC = (xs, g) => xs.reduce((s, x) => s + (g ? g(x) : x), 0);   // soma de centavos inteiros
const msDia = (dia, h) => String(Date.parse(dia + 'T' + String(h === undefined ? 12 : h).padStart(2, '0') + ':00:00-03:00'));
const segDia = dia => Math.floor(Date.parse(dia + 'T12:00:00-03:00') / 1000);

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('A. Régua: CopilotoNucleo.util (r2, soma, num) × SHC.r2/SHC.moeda; a pasta nucleo/ é a mesma do copiloto-nucleo/src');
{
    const iguais = ['util.js', 'modelo.js', 'tarifas.js', 'motor.js', 'conciliacao.js', 'adaptador.js', 'adaptadores/tiktok.js']
        .filter(a => fs.readFileSync(path.join(EXT, 'nucleo', a)).equals(fs.readFileSync(path.join(SRC, a))));
    ok(iguais.length === 7 && TT.NUCLEO.length === 7, 'extension-copiloto/nucleo/*.js = copiloto-nucleo/src/*.js byte a byte (7 arquivos de SHC.tt.NUCLEO)');
    const r = lcg(20261007), a1 = lote(), a2 = lote(), a3 = lote(), a4 = lote();
    for (let i = 0; i < 4000; i++) {
        const v = (r() - 0.5) * 2e6 * (r() < 0.5 ? 1e-4 : 1) + Math.round(r() * 1e6) / 1e6, x = U.r2(v);
        a1.conta(emCentavos(x) && Math.abs(x - v) <= 0.005 + 1e-9, { v, x });
        const c = ent(r, -1e9, 1e9);
        a2.conta(U.r2(c / 100) === c / 100, { c, x: U.r2(c / 100) });
        const s = SHC.r2(v);
        a3.conta(x === s || (x === 0 && s === 0), { v, nucleo: x, shc: s });
        a4.conta(deMoeda(SHC.moeda(x)) === cent(x) && SHC.moeda(x) === reais(cent(x)), { v, x, tela: SHC.moeda(x) });
    }
    okLote(a1, 'U.r2: sempre em centavos e a no máximo meio centavo do valor');
    okLote(a2, 'U.r2 não mexe em valor que já tem 2 casas (até ±R$ 10 milhões)');
    okLote(a3, 'U.r2 = SHC.r2 (o núcleo diz "igual ao SHC.r2 do Copiloto")');
    okLote(a4, 'SHC.moeda(U.r2(v)) lido de volta = o número da conta, no formato "R$ 1.234,56"/"−R$ 0,05"');
    ok([-0.004, -0, -1e-9, -0.0049].every(v => Object.is(U.r2(v), 0)) && SHC.moeda(U.r2(-0.004)) === 'R$ 0,00', 'U.r2 nunca devolve −0 (a tela nunca mostra "−R$ 0,00" de arredondamento)');
    ok(NADA.every(v => U.r2(v) === null) && NADA.every(v => SHC.moeda(v) === '—'), 'null/undefined/NaN/±Infinity: U.r2 → null e SHC.moeda → "—" (nunca "R$ NaN" nem R$ 0,00)');

    // Somar muitas linhas: U.soma = soma em centavos inteiros (o erro do ponto flutuante não vira centavo).
    const s1 = lote(), s2 = lote();
    let maiorDeriva = 0;
    for (let t = 0; t < 60; t++) {
        const n = ent(r, 1, 6000), cs = Array.from({ length: n }, () => ent(r, -500000, 900000)), vs = cs.map(c => c / 100), esperado = somaC(cs);
        s1.conta(cent(U.soma(vs)) === esperado && emCentavos(U.soma(vs)), { n, soma: U.soma(vs), esperado });
        // Acumulando com r2 a cada linha (o jeito do motor: porTipo[k] = r2(porTipo[k] + v)): também exato.
        let acc = 0; vs.forEach(v => { acc = U.r2(acc + v); });
        s2.conta(cent(acc) === esperado && emCentavos(acc), { n, acc, esperado });
        maiorDeriva = Math.max(maiorDeriva, Math.abs(vs.reduce((a, v) => a + v, 0) * 100 - esperado));
    }
    okLote(s1, 'U.soma de até 6.000 linhas = soma em centavos inteiros (sem perder nem criar centavo)');
    okLote(s2, 'acumular com r2 linha a linha (porTipo do motor) = soma em centavos inteiros');
    ok(maiorDeriva > 0 && maiorDeriva < 0.5, 'controle: a soma crua em ponto flutuante deriva (' + maiorDeriva.toExponential(1) + ' centavo) e o r2 final corrige');
    ok(U.soma([1.1, null, undefined, NaN, Infinity, 2.2]) === 3.3 && U.soma([]) === 0 && U.soma(null) === 0, 'U.soma ignora null/NaN/Infinity (nunca NaN); quem chama decide se "faltou" (ver C, F)');

    // Texto → número: o jeito brasileiro e o ponto decimal do TikTok; texto que não é número → null (nunca 0).
    const n1 = lote();
    for (let i = 0; i < 3000; i++) {
        const c = ent(r, -9999999, 99999999), tela = reais(c).replace('−', um(r, ['−', '-']));
        n1.conta(U.num(tela) === c / 100 && U.num(txt(c)) === c / 100 && N.dinheiro(amt(c)) === c / 100 && N.dinheiro(fp(c)) === c / 100 && SP.dinheiro(txt(c)) === c / 100, { c, tela });
    }
    okLote(n1, 'U.num("R$ 1.234,56"/"−6,00"/"549.9") e o dinheiro do TikTok ({amount}, {format_price}) e da Shopee = o valor exato');
    ok(['', 'abc', '1,234.56', '6abc', '1.234.5', '1,2,3', 'R$', '1e9'].every(s => U.num(s) === null) && NADA.every(v => U.num(v) === null),
        'U.num: texto que não é número → null (melhor sem número do que com um errado)');
    ok([null, undefined, {}, { amount: 'abc' }, { amount: null }, { amount: { amount: 'x' } }, { format_price: 'grátis' }, 'abc', NaN, Infinity].every(v => N.dinheiro(v) === null),
        'dinheiro do TikTok: ausente/ilegível → null');
    ok([{ amount: '' }, { amount: '   ' }, { amount: { amount: '' } }, '', '  '].every(v => N.dinheiro(v) === null) && N.dinheiro({ amount: '0' }) === 0 && N.dinheiro({ amount: '0.00' }) === 0,
        'dinheiro do TikTok: vazio ({amount:""}, "", só espaço) → null, nunca R$ 0,00 (antes Number("") = 0); "0"/"0.00" continuam 0 — #34');
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('B. Tarifas (tabela com vigência), simular e precoMinimo: a conta em centavos inteiros');
{
    const r = lcg(1507), t1 = lote(), t2 = lote(), t3 = lote(), empates = { sobe: 0, desce: 0 };
    const datas = ['2026-03-01', '2026-07-10', '2026-07-14', '2026-07-15', '2026-09-30', '2026-10-01'];
    for (let i = 0; i < 12000; i++) {
        const canal = um(r, ['tiktok', 'shopee', 'ml']), c = ent(r, 1, 300000), qtd = ent(r, 1, 4), d = um(r, datas);
        const ctx = { qtd, tipo_anuncio: um(r, ['classico', 'premium']), frete_gratis_programa: r() < 0.85 };
        const ls = T.tarifasDoItem(canal, c / 100, ctx, d);
        if (!ls) { t1.conta(canal === 'shopee' && d < '2026-03-01' || false, { canal, d }); continue; }
        ls.forEach(l => {
            // valor = [pct sobre preço × qtd, com teto × qtd] + fixo × qtd, em centavos inteiros; empate de meio centavo: sobe OU desce 1.
            const p10 = Math.round(l.pct * 10), num = c * qtd * Math.abs(p10), den = 1000;
            let pctC = l.pct ? Math.sign(p10) * meioCima(num, den) : 0;
            if (l.teto) pctC = Math.min(pctC, cent(l.teto) * qtd);
            const esperado = pctC + cent(l.fixo || 0) * qtd, obtido = cent(l.valor), empate = l.pct && (num % den) * 2 === den && !(l.teto && cent(l.teto) * qtd <= pctC);
            if (empate) empates[obtido === esperado ? 'sobe' : 'desce']++;
            t1.conta(emCentavos(l.valor) && (obtido === esperado || (empate && obtido === esperado - Math.sign(p10))), { canal, preco: c / 100, qtd, d, l, esperado: esperado / 100 });
        });
        // A tabela certa para o dia: TikTok 6% + R$ 4 até 14/07; desde 15/07 10% + R$ 4 abaixo de R$ 50 e 6% + R$ 6 de R$ 50 para cima; SFP 6% (teto R$ 50/un.).
        if (canal === 'tiktok') {
            const de = t => ls.filter(l => l.tipo === t);
            const [cp, fx] = d <= '2026-07-14' ? [6, 4] : (c < 5000 ? [10, 4] : [6, 6]);
            const sfp = de('programa_frete');
            t2.conta(de('comissao').length === 1 && de('comissao')[0].pct === cp && de('taxa_fixa').length === 1 && cent(de('taxa_fixa')[0].valor) === fx * 100 * qtd
                && (ctx.frete_gratis_programa ? sfp.length === 1 && sfp[0].pct === 6 && cent(sfp[0].valor) <= 5000 * qtd : sfp.length === 0), { c, qtd, d, ls });
        }
        // Σ das linhas = total (o simular soma as mesmas linhas).
        t3.conta(cent(U.soma(ls, l => l.valor)) === somaC(ls, l => cent(l.valor)), { canal, c, ls });
    }
    okLote(t1, 'tarifasDoItem: cada linha = % do preço × qtd (com teto) + fixo × qtd, no centavo (empate de meio centavo à parte)');
    okLote(t2, 'TikTok: a data da venda escolhe a tabela (até 14/07 6% + R$ 4; desde 15/07 10% + R$ 4 / 6% + R$ 6) e o SFP tem teto de R$ 50/un.');
    okLote(t3, 'Σ das linhas da tarifa = total em centavos inteiros');
    ok(empates.sobe + empates.desce > 0, `cobertura: ${empates.sobe + empates.desce} empates de meio centavo gerados (${empates.desce} descem em vez de subir: divergência 8)`);
    ok(T.tarifasDoItem('magalu', 50, {}, '2026-09-30') === null && T.tarifasDoItem('shopee', 50, {}, '2026-02-28') === null && T.tarifasDoItem('tiktok', 50, {}, '2025-12-31') === null
        && M.ehNaoLido(T.simular('tiktok', 50, { custo: 10 }, '2025-12-31')), 'sem tabela na data → null / não lido (nunca tarifa R$ 0,00)');

    // simular: receita − tarifas − frete = repasse; repasse − custo − outros − imposto = lucro. Sem custo → lucro null.
    const s1 = lote(), s2 = lote(), s3 = lote();
    for (let i = 0; i < 6000; i++) {
        const canal = um(r, ['tiktok', 'shopee', 'ml']), d = um(r, datas.slice(1)), qtd = ent(r, 1, 3), preco = din(r, 0.5, 2500);
        const ctx = { qtd, custo: r() < 0.15 ? um(r, [null, 0, '', 'abc']) : din(r, 0.5, 1500), outros: r() < 0.5 ? din(r, 0, 9) : undefined, imposto_pct: um(r, [0, 4, 6, 8.5, 11.25]),
            frete: r() < 0.6 ? din(r, 0, 60) : undefined, full: r() < 0.2, tipo_anuncio: um(r, ['classico', 'premium']), margem_alvo_pct: um(r, [0, 10]) };
        const s = T.simular(canal, preco, ctx, d);
        if (!s || M.ehNaoLido(s)) { s1.conta(false, { canal, preco, d, s }); continue; }
        const rec = cent(preco) * qtd, tar = somaC(s.linhas, l => cent(l.valor)), fr = cent(s.frete_rs);
        const freteC = canal === 'ml' && preco < 79 && !ctx.full ? 0 : (U.num(ctx.frete) !== null ? cent(U.num(ctx.frete)) * qtd : 0);
        const impExato = rec * ctx.imposto_pct / 100;
        s1.conta(cent(s.receita) === rec && cent(s.tarifas_rs) === tar && fr === freteC && cent(s.repasse) === rec - tar - fr && Math.abs(cent(s.imposto_rs) - impExato) <= 0.5 + 1e-6
            && ['receita', 'tarifas_rs', 'frete_rs', 'repasse', 'imposto_rs', 'custo_rs', 'outros_rs', 'lucro'].every(k => dinOk(s[k])), { canal, preco, ctx, d, s });
        const custoC = U.num(ctx.custo) > 0 ? cent(U.num(ctx.custo)) * qtd : null;
        if (custoC === null) s2.conta(s.lucro === null && s.custo_rs === null && s.margem_pct === null && s.classe === 'sem_custo', { ctx, s });
        else s2.conta(cent(s.lucro) === cent(s.repasse) - custoC - cent(s.outros_rs) - cent(s.imposto_rs) && cent(s.outros_rs) === cent(U.num(ctx.outros) || 0) * qtd, { ctx, s });
        if (s.margem_pct !== null) s3.conta((s.margem_pct < 0) === (s.classe === 'prejuizo') && (s.lucro >= 0 || s.margem_pct <= 0), { preco, ctx, s: { lucro: s.lucro, margem: s.margem_pct, classe: s.classe } });
    }
    okLote(s1, 'simular: receita = preço × qtd; Σ linhas = tarifas; frete × qtd (ML < R$ 79 = comprador); repasse = receita − tarifas − frete; imposto ±½ centavo');
    okLote(s2, 'simular: lucro = repasse − custo × qtd − outros × qtd − imposto; sem custo (null/0/""/texto) → lucro, custo e margem null (nunca R$ 0,00)');
    okLote(s3, 'simular: margem negativa ⇔ classe "prejuízo" (o −0 da divergência 7 é o único furo)');
    ok([0, -5, '', 'abc', null, NaN].every(p => T.simular('tiktok', p, { custo: 10 }, '2026-09-30') === null), 'simular: preço inválido → null (não inventa conta)');

    // precoMinimo: o preço achado cumpre a meta e 1 centavo abaixo não (o próprio simular confere).
    const pm = lote();
    for (let i = 0; i < 150; i++) {
        const canal = ['tiktok', 'shopee', 'ml'][i % 3], d = um(r, ['2026-07-10', '2026-09-30', '2026-10-01']), alvo = um(r, [0, 5, 10, 20]);
        const ctx = { custo: din(r, 1, 400), outros: din(r, 0, 5), imposto_pct: um(r, [0, 4, 6, 8.5]), frete: r() < 0.5 ? din(r, 0, 40) : undefined, tipo_anuncio: 'classico' };
        const p = T.precoMinimo(canal, ctx, alvo, d);
        const meta = q => { const s = T.simular(canal, q, ctx, d); return s.lucro - U.r2(alvo / 100 * q); };
        pm.conta(p !== null && emCentavos(p) && meta(p) >= -0.0001 && (p <= 0.01 || meta(U.r2(p - 0.01)) < -0.0001), { canal, d, ctx, alvo, p });
    }
    okLote(pm, 'precoMinimo (TikTok, Shopee, ML): cumpre a meta no centavo e 1 centavo abaixo não cumpre');
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('C. Motor: lucro de 1 pedido (gerado) — cada parte em centavos e as linhas fecham');
const POOL = ['CAMISA-P', 'CAMISA-M', 'MEIA-01', 'BONE-02', 'CANECA-07', 'KIT-01'];
const custosBase = () => [
    { sku: 'CAMISA-P', custo: 18.4, outros: 1.2 }, { sku: 'CAMISA-P', custo: 21.15, outros: 1.2, vigencia_de: '2026-09-15' },
    { sku: 'CAMISA-M', custo: 19.99 }, { sku: 'MEIA-01', custo: 3.33, outros: 0.25 }, { sku: 'BONE-02', custo: 12.5, outros: 0.8 },
    { sku: 'KIT-01', componentes: [{ sku: 'MEIA-01', qtd: 2 }, { sku: 'BONE-02', qtd: 1 }], outros: 1.1 },
].map(c => M.garantir('custo_sku', c));   // CANECA-07 fica sem custo de propósito
const custoUnitC = (sku, dia) => {   // a régua: custo e outros por unidade em centavos (vigência e kit à mão)
    const tab = { 'CAMISA-P': dia >= '2026-09-15' ? [2115, 120] : [1840, 120], 'CAMISA-M': [1999, 0], 'MEIA-01': [333, 25], 'BONE-02': [1250, 80] };
    if (sku === 'KIT-01') return [2 * 333 + 1250, 2 * 25 + 80 + 110];
    return tab[sku] || null;
};
const valorItemC = it => (it.total !== null && it.total !== undefined ? cent(it.total) : (it.preco_unit === null || it.preco_unit === undefined ? null : cent(it.preco_unit) * it.qtd));
function gerarPedidoMotor(r, i) {
    const canal = um(r, ['tiktok', 'shopee', 'ml']), dia = '2026-09-' + String(ent(r, 1, 28)).padStart(2, '0'), n = r() < 0.5 ? 1 : ent(r, 2, 4);
    const itens = Array.from({ length: n }, (_, k) => {
        const qtd = ent(r, 1, 3), modo = r(), pc = ent(r, 199, 59990);
        return Object.assign({ sku: um(r, POOL), anuncio_id: 'AN' + ent(r, 1, 6), qtd }, modo < 0.7 ? { preco_unit: pc / 100 } : { total: ent(r, 199, 99990) / 100 }, r() < 0.02 ? { preco_unit: null, total: null } : {});
    });
    const status = r() < 0.06 ? 'cancelado' : um(r, ['pago', 'enviado', 'entregue', 'entregue']);
    const brutoLidoC = somaC(itens, it => valorItemC(it) || 0);   // o desconto do vendedor nunca passa do preço
    return M.garantir('pedido', { canal, conta: 'conta-teste', fonte: 'api', id: 'PM-' + i, data_venda: dia, status, itens,
        desconto_vendedor: r() < 0.3 ? Math.min(ent(r, 1, 1500), brutoLidoC) / 100 : 0, reembolso: r() < 0.12 ? din(r, 0.01, 400) : 0 });
}
{
    const r = lcg(424242);
    const L = { partes: lote(), tarifas: lote(), repasse: lote(), custo: lote(), lucro: lote(), linhas: lote(), sinais: lote(), formato: lote(), naoLido: lote(), semCusto: lote(),
        cancelado: lote(), margem: lote(), porItem1: lote(), porItemN: lote(), ads: lote() };
    let porItemDiverge = 0, multi = 0;
    for (let i = 0; i < 2500; i++) {
        const p = gerarPedidoMotor(r, i);
        const tipos = ['comissao', 'taxa_fixa', 'programa_frete', 'frete_venda', 'afiliado', 'pagamento', 'frete_devolucao', 'outro'];
        const tarifas = Array.from({ length: ent(r, 0, 6) }, () => ({ pedido_id: p.id, tipo: um(r, tipos), valor: din(r, 0.01, 60), data: p.data_venda }));
        if (r() < 0.25) tarifas.push({ pedido_id: p.id, tipo: um(r, ['comissao', 'taxa_fixa']), valor: -din(r, 0.01, 20), data: p.data_venda, texto_original: 'estorno' });
        if (r() < 0.15) tarifas.push({ pedido_id: p.id, tipo: 'ads', valor: din(r, 0.01, 30), data: p.data_venda });
        tarifas.push({ pedido_id: 'OUTRO-' + i, tipo: 'comissao', valor: 99.99, data: p.data_venda });   // de outro pedido: não entra
        const devs = r() < 0.08 ? [M.garantir('devolucao', { canal: p.canal, conta: p.conta, fonte: 'api', pedido_id: p.id, valor_reembolsado: din(r, 1, 300), frete_volta: r() < 0.5 ? din(r, 1, 25) : null, produto_voltou: um(r, [true, false, null]) })] : [];
        const modoAds = r(), adsCtx = modoAds < 0.3 ? din(r, 0, 25) : modoAds < 0.4 ? M.naoLido('Ads fora') : undefined;
        const modoTar = r(), ctxTar = modoTar < 0.06 ? undefined : modoTar < 0.1 ? M.naoLido('extrato fora') : tarifas;
        const ctx = { tarifas: ctxTar, custos: custosBase(), devolucoes: devs, ads: adsCtx, outros: r() < 0.3 ? din(r, 0.01, 4) : undefined };
        if (r() < 0.5) ctx.imposto_pct = um(r, [0, 4, 6, 8.5, 11.25]); else ctx.impostos = [{ aliquota_pct: 6 }, { aliquota_pct: 8, canal: p.canal, vigencia_de: '2026-09-10' }];
        const res = MO.lucroPedido(p, ctx);
        const canc = p.status === 'cancelado';

        // Formato: todo dinheiro do resultado em centavos ou null (nunca NaN/undefined/Infinity).
        const campos = ['bruto', 'desconto_vendedor', 'receita', 'reembolso', 'receita_liquida', 'tarifas_rs', 'repasse', 'custo_rs', 'outros_rs', 'imposto_rs', 'lucro_antes_ads', 'ads_rs', 'lucro_real'];
        L.formato.conta(campos.every(k => dinOk(res[k])) && Object.keys(res.tarifas_por_tipo).every(k => emCentavos(res.tarifas_por_tipo[k])) && res.linhas.every(l => l.valor === null || emCentavos(l.valor))
            && (res.margem_pct === null || isFinite(res.margem_pct)), { id: p.id, res: campos.map(k => [k, res[k]]) });

        // Receita: bruto = Σ itens; receita = bruto − desconto; reembolso = min(receita, máx(pedido, devoluções)); líquida = receita − reembolso.
        const vis = p.itens.map(valorItemC), falta = vis.some(v => v === null);
        const brutoC = canc ? 0 : somaC(vis, v => v || 0), descC = canc ? 0 : cent(p.desconto_vendedor), recC = brutoC - descC;
        const reembC = canc ? 0 : Math.min(recC, Math.max(cent(p.reembolso), somaC(devs, d => cent(d.valor_reembolsado || 0))));
        L.partes.conta(cent(res.bruto) === brutoC && cent(res.receita) === recC && cent(res.reembolso) === reembC && cent(res.receita_liquida) === recC - reembC, { p, res: [res.bruto, res.receita, res.reembolso, res.receita_liquida] });

        // Tarifas: só as do pedido; Σ por tipo (estorno −); 'ads' fora do repasse; frete de volta da Devolução entra como frete_devolucao.
        if (Array.isArray(ctxTar)) {
            const minhas = tarifas.filter(t => t.pedido_id === p.id);
            const tem = minhas.some(t => t.tipo === 'frete_devolucao'), extra = tem ? [] : devs.filter(d => d.frete_volta > 0).map(d => ({ tipo: 'frete_devolucao', valor: d.frete_volta }));
            const todas = minhas.concat(extra), porTipo = {};
            todas.filter(t => t.tipo !== 'ads').forEach(t => { porTipo[t.tipo] = (porTipo[t.tipo] || 0) + cent(t.valor); });
            const adsC = somaC(todas.filter(t => t.tipo === 'ads'), t => cent(t.valor)) + (typeof adsCtx === 'number' ? cent(adsCtx) : 0);
            const tarC = somaC(Object.keys(porTipo), k => porTipo[k]);
            L.tarifas.conta(Object.keys(porTipo).every(k => cent(res.tarifas_por_tipo[k]) === porTipo[k]) && Object.keys(res.tarifas_por_tipo).every(k => k in porTipo) && cent(res.tarifas_rs) === tarC
                && (M.ehNaoLido(adsCtx) ? res.ads_rs === null : cent(res.ads_rs) === adsC), { p: p.id, porTipo, res: res.tarifas_por_tipo });
            if (falta) L.naoLido.conta(res.status === 'nao_lido' && res.repasse === null && res.lucro_real === null && res.faltando.indexOf('preco') >= 0, { p: p.id, res: res.status });
            else L.repasse.conta(cent(res.repasse) === recC - reembC - tarC, { p: p.id, repasse: res.repasse, esperado: (recC - reembC - tarC) / 100 });
        } else L.naoLido.conta(res.status === 'nao_lido' && res.repasse === null && res.lucro_antes_ads === null && res.lucro_real === null && res.tarifas_rs === null && res.faltando.indexOf('tarifas') >= 0,
            { p: p.id, ctxTar: !!ctxTar, res: [res.status, res.repasse, res.lucro_real] });

        // Custo: custo × qtd por SKU (vigência e kit); cancelado ou reembolso total com produto de volta = 0; SKU sem custo → custo e lucro null.
        const semCusto = !canc && p.itens.some(it => custoUnitC(it.sku, p.data_venda) === null);
        const reembTotal = !canc && reembC > 0 && reembC >= recC - 1, voltou = devs.map(d => d.produto_voltou).find(v => v === true || v === false);
        const zero = canc || (reembTotal && voltou === true);
        const custoC = somaC(p.itens, it => { const c = custoUnitC(it.sku, p.data_venda); return c && !zero ? c[0] * it.qtd : 0; });
        const outrosC = somaC(p.itens, it => { const c = custoUnitC(it.sku, p.data_venda); return c && !zero ? c[1] * it.qtd : 0; }) + (U.num(ctx.outros) ? cent(ctx.outros) : 0);
        if (semCusto) L.semCusto.conta(res.custo_rs === null && res.lucro_antes_ads === null && res.lucro_real === null && res.margem_pct === null && (res.status === 'sem_custo' || res.status === 'nao_lido')
            && res.linhas.some(l => l.rotulo === 'Custo do produto' && l.valor === null), { p: p.id, res: [res.status, res.custo_rs, res.lucro_real] });
        else L.custo.conta(cent(res.custo_rs) === custoC && cent(res.outros_rs) === outrosC, { p: p.id, custo: res.custo_rs, custoC, outros: res.outros_rs, outrosC });

        // Imposto (±½ centavo do exato) e lucro: repasse − custo − imposto − outros (antes do Ads); − Ads = lucro real.
        const pct = ctx.imposto_pct !== undefined ? ctx.imposto_pct : (p.data_venda >= '2026-09-10' ? 8 : 6);
        if (res.repasse !== null) {
            const impOk = Math.abs(cent(res.imposto_rs) - (recC - reembC) * pct / 100) <= 0.5 + 1e-6 && res.imposto_pct === pct;
            const antes = res.lucro_antes_ads, real = res.lucro_real;
            L.lucro.conta(impOk && (semCusto ? antes === null : cent(antes) === cent(res.repasse) - cent(res.custo_rs) - cent(res.imposto_rs) - cent(res.outros_rs))
                && (antes === null || M.ehNaoLido(adsCtx) ? real === null : cent(real) === cent(antes) - cent(res.ads_rs)), { p: p.id, pct, res: [res.repasse, res.custo_rs, res.imposto_rs, res.outros_rs, antes, res.ads_rs, real] });
            if (M.ehNaoLido(adsCtx)) L.ads.conta(res.ads_rs === null && real === null && res.faltando.indexOf('ads') >= 0 && (semCusto || antes !== null), { p: p.id });
        }
        if (res.lucro_real !== null) L.margem.conta(res.receita_liquida > 0 ? res.margem_pct === Math.round(res.lucro_real / res.receita_liquida * 10000) / 100 : res.margem_pct === null, { p: p.id });

        // Linhas da conta (a "explicação" do motor): até "= Repasse" somam o repasse; tudo soma o lucro; sinais: entra +, sai −, estorno +.
        const parcelas = res.linhas.filter(l => !l.total), ateRep = [];
        for (const l of res.linhas) { if (l.rotulo === '= Repasse do canal') break; if (!l.total) ateRep.push(l); }
        if (res.repasse !== null) L.linhas.conta(somaC(ateRep, l => cent(l.valor)) === cent(res.repasse) && res.linhas.some(l => l.rotulo === '= Repasse do canal' && l.valor === res.repasse)
            && (res.lucro_real === null || (somaC(parcelas, l => cent(l.valor || 0)) === cent(res.lucro_real) && res.linhas.some(l => /^= (Lucro|Prejuízo)$/.test(l.rotulo) && l.valor === res.lucro_real))),
            { p: p.id, linhas: res.linhas, repasse: res.repasse, lucro: res.lucro_real });
        if (!falta) L.sinais.conta(res.linhas.every(l => (/^Venda/.test(l.rotulo) ? l.valor >= 0 : /^(Desconto|Reembolso|Custo|Outros|Imposto|Ads)/.test(l.rotulo) ? (l.valor === null || l.valor <= 0) : true))
            && Object.keys(res.tarifas_por_tipo).every(k => res.linhas.some(l => l.rotulo.indexOf('Tarifa: ' + k) === 0 && l.valor === -res.tarifas_por_tipo[k]))
            && (res.lucro_real === null || res.linhas.some(l => l.rotulo === (res.lucro_real < 0 ? '= Prejuízo' : '= Lucro'))), { p: p.id, linhas: res.linhas });
        if (canc) L.cancelado.conta(res.bruto === 0 && res.receita === 0 && res.reembolso === 0 && (res.custo_rs === 0 || res.custo_rs === null) && (res.repasse === null || cent(res.repasse) === -cent(res.tarifas_rs))
            && ['ok', 'nao_lido', 'cancelado'].indexOf(res.status) >= 0 && !res.linhas.some(l => /^Venda/.test(l.rotulo)), { p: p.id, res: [res.status, res.bruto, res.repasse, res.custo_rs] });

        // Rateio por item (lucro por produto), pelo maior resto: Σ itens = o pedido no centavo (receita, tarifas, imposto, outros, Ads) e cada
        // parte a < 1 centavo da exata (total × participação). Antes: r2(total × participação) sem o resto (divergência 3, corrigida: #32).
        const pi = res.por_item, campoItem = [['receita', 'receita_liquida'], ['tarifas', 'tarifas_rs'], ['imposto', 'imposto_rs'], ['outros', 'outros_rs'], ['ads', 'ads_rs']];
        if (res.status === 'ok' && !M.ehNaoLido(adsCtx)) {
            const dif = campoItem.map(([a, b]) => Math.abs(somaC(pi, x => cent(x[a] || 0)) - cent(res[b] || 0)));
            const perto = campoItem.every(([a, b]) => pi.every(x => Math.abs(cent(x[a] || 0) - cent(res[b] || 0) * x.participacao) < 1 - 1e-9));
            if (pi.length === 1) L.porItem1.conta(dif.every(d => d === 0) && cent(pi[0].custo) === cent(res.custo_rs), { p: p.id, pi, res: campoItem.map(([, b]) => res[b]) });
            else {
                multi++; if (dif.some(d => d > 0)) porItemDiverge++;
                L.porItemN.conta(dif.every(d => d === 0) && perto && somaC(pi, x => cent(x.custo)) === cent(res.custo_rs) && Math.abs(pi.reduce((a, x) => a + x.participacao, 0) - 1) < 1e-9,
                    { p: p.id, dif, itens: pi.length });
            }
        }
    }
    okLote(L.formato, 'todo dinheiro do resultado em centavos exatos ou null — nunca NaN, undefined ou Infinity');
    okLote(L.partes, 'bruto = Σ preço × qtd (ou total da linha); receita = bruto − desconto do vendedor; líquida = receita − reembolso (máx. pedido/devolução, até a receita)');
    okLote(L.tarifas, 'tarifas: só as do pedido, Σ por tipo com estorno negativo, tarifas_rs = Σ tipos; Ads (tarifa "ads" + rateio) fora das tarifas');
    okLote(L.repasse, 'repasse = receita líquida − Σ tarifas (no centavo)');
    okLote(L.naoLido, 'tarifas não lidas (undefined ou não lido) ou preço não lido: repasse e lucro null, status "nao_lido" (nunca R$ 0,00)');
    okLote(L.custo, 'custo = Σ custo × qtd com vigência e kit (Σ componentes); outros = embalagem × qtd + outros do pedido; cancelado/devolvido com produto de volta = 0');
    okLote(L.semCusto, 'SKU sem custo: custo, lucro e margem null e a linha "Custo do produto" sem valor (nunca R$ 0,00)');
    okLote(L.lucro, 'imposto = alíquota × receita líquida (±½ centavo; fixa ou a linha em vigor do canal); lucro antes do Ads = repasse − custo − imposto − outros; lucro = − Ads');
    okLote(L.ads, 'Ads não lido: ads_rs e lucro real null; o lucro antes do Ads continua (nunca Ads R$ 0,00 inventado)');
    okLote(L.margem, 'margem = lucro ÷ receita líquida (2 casas); sem receita → null (nunca divisão por zero)');
    okLote(L.linhas, 'linhas da conta: as parcelas até "= Repasse" somam o repasse e todas somam o lucro/prejuízo, no centavo');
    okLote(L.sinais, 'sinais das linhas: venda +, desconto/reembolso/custo/outros/imposto/Ads −, tarifa = −valor (estorno aparece +)');
    okLote(L.cancelado, 'cancelado: sem venda, sem receita e sem custo; o repasse é só o que o canal não devolveu (−tarifas)');
    okLote(L.porItem1, 'por item, pedido de 1 item: receita, tarifas, imposto, outros, Ads e custo = os do pedido, no centavo');
    okLote(L.porItemN, 'por item, 2+ itens (maior resto): Σ receita, tarifas, imposto, outros e Ads dos itens = os do pedido no centavo, cada parte a < 1 centavo da exata; custo exato');
    ok(multi > 0 && porItemDiverge === 0, `cobertura: ${multi} pedidos com 2+ itens, nenhum com Σ itens ≠ pedido (#32)`);

    // Casos escritos à mão: estorno maior que a tarifa, reembolso maior que a receita, Ads por anúncio, devolução só com frete de volta.
    const O = { canal: 'tiktok', conta: 'conta-teste', fonte: 'api' };
    const p1 = M.garantir('pedido', Object.assign({}, O, { id: 'H1', data_venda: '2026-09-20', status: 'devolvido', itens: [{ sku: 'MEIA-01', qtd: 3, preco_unit: 33.33 }], desconto_vendedor: 0.99, reembolso: 500 }));
    const h1 = MO.lucroPedido(p1, { tarifas: [{ pedido_id: 'H1', tipo: 'comissao', valor: 9.99 }, { pedido_id: 'H1', tipo: 'comissao', valor: -12.5 }, { pedido_id: 'H1', tipo: 'programa_frete', valor: 5.94 }],
        custos: custosBase(), imposto_pct: 6, devolucoes: [{ pedido_id: 'H1', produto_voltou: true }] });
    ok(h1.bruto === 99.99 && h1.receita === 99 && h1.reembolso === 99 && h1.receita_liquida === 0 && h1.tarifas_por_tipo.comissao === -2.51 && h1.tarifas_rs === 3.43 && h1.repasse === -3.43
        && h1.custo_rs === 0 && h1.imposto_rs === 0 && h1.lucro_real === -3.43 && h1.margem_pct === null && h1.linhas.some(l => l.rotulo === 'Tarifa: comissao' && l.valor === 2.51),
        'à mão: 3 × R$ 33,33 − R$ 0,99; reembolso R$ 500 vira R$ 99,00 (até a receita); estorno de comissão maior que a cobrança → linha +R$ 2,51; produto voltou → custo 0');
    const p2 = M.garantir('pedido', Object.assign({}, O, { id: 'H2', data_venda: '2026-09-21', status: 'entregue', itens: [{ sku: 'CAMISA-M', anuncio_id: 'AN1', qtd: 1, preco_unit: 100 }, { sku: 'BONE-02', anuncio_id: 'AN2', qtd: 2, preco_unit: 25 }] }));
    const h2 = MO.lucroPedido(p2, { tarifas: [{ pedido_id: 'H2', tipo: 'comissao', valor: 9 }], custos: custosBase(), imposto_pct: 0, ads: { total: 7.77, porAnuncio: { AN1: 7.77 } } });
    ok(h2.ads_rs === 7.77 && h2.por_item[0].ads === 7.77 && h2.por_item[1].ads === 0 && h2.lucro_real === U.r2(150 - 9 - 19.99 - 25 - 1.6 - 7.77) && h2.avisos.some(a => /imposto não configurado/.test(a)) === false,
        'à mão: Ads por anúncio fica no item daquele anúncio; lucro = 150 − 9 − 44,99 − 1,60 − 7,77');
    const h3 = MO.lucroPedido(Object.assign({}, p2, { id: 'H3' }), { tarifas: [], custos: custosBase() });
    ok(h3.imposto_pct === 0 && h3.avisos.some(a => /imposto não configurado: contado como 0%/.test(a)) && h3.repasse === 150, 'sem imposto configurado: conta 0% e AVISA (o 0% não passa calado)');
    const h4 = MO.lucroPedido(M.ehNaoLido(M.naoLido('x')) ? M.naoLido('pedido não lido') : null, {});
    ok(h4.status === 'nao_lido' && h4.repasse === undefined && h4.lucro_real === undefined && SHC.moeda(h4.lucro_real) === '—', 'pedido não lido: nenhum número (a tela mostra "—")');
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('D. Rateio do Ads por anúncio e dia: Σ partes + não rateado = Σ custo');
{
    const r = lcg(777), O = { canal: 'tiktok', conta: 'conta-teste', fonte: 'api' };
    const L = { total: lote(), anuncio: lote(), pedido: lote(), formato: lote(), perto: lote() };
    let longe = 0, partes = 0, negativas = 0;
    for (let t = 0; t < 400; t++) {
        const dias = ['2026-09-10', '2026-09-11', '2026-09-12'];
        const pedidos = Array.from({ length: ent(r, 1, 12) }, (_, i) => M.garantir('pedido', Object.assign({}, O, { id: 'R' + t + '-' + i, data_venda: um(r, dias), status: r() < 0.08 ? 'cancelado' : 'entregue',
            itens: Array.from({ length: ent(r, 1, 3) }, () => ({ sku: um(r, POOL), anuncio_id: 'AN' + ent(r, 1, 4), qtd: ent(r, 1, 3), preco_unit: din(r, 5, 300) })) })));
        const ads = Array.from({ length: ent(r, 1, 8) }, () => {
            const x = r();
            const base = { custo: r() < 0.08 ? 0 : din(r, 0.01, 60) };
            if (x < 0.1) return Object.assign({}, O, base, { dia: um(r, dias) });   // sem anúncio: não rateia
            if (x < 0.3) return Object.assign({}, O, base, { anuncio_id: 'AN' + ent(r, 1, 5), periodo_de: '2026-09-10', periodo_ate: '2026-09-11' });
            return Object.assign({}, O, base, { anuncio_id: 'AN' + ent(r, 1, 5), dia: um(r, dias.concat(['2026-09-13'])) });
        }).map(a => M.garantir('ads', a));
        const rat = MO.rateioAds(ads, pedidos);
        const custoC = somaC(ads.filter(a => a.custo > 0), a => cent(a.custo));
        L.total.conta(cent(rat.total_rateado) + cent(rat.total_nao_rateado) === custoC && somaC(Object.keys(rat.porPedido), k => cent(rat.porPedido[k].total)) === cent(rat.total_rateado)
            && cent(rat.total_nao_rateado) === somaC(rat.naoRateado, a => cent(a.custo)), { t, rat: [rat.total_rateado, rat.total_nao_rateado], custoC });
        // Por anúncio: Σ das partes de cada anúncio nos pedidos = Σ custo das entradas rateadas daquele anúncio.
        const rateados = ads.filter(a => a.custo > 0 && rat.naoRateado.indexOf(a) < 0), porAn = {};
        rateados.forEach(a => { porAn[a.anuncio_id] = (porAn[a.anuncio_id] || 0) + cent(a.custo); });
        L.anuncio.conta(Object.keys(porAn).every(an => somaC(Object.keys(rat.porPedido), k => cent(rat.porPedido[k].porAnuncio[an] || 0)) === porAn[an]), { t, porAn });
        L.pedido.conta(Object.keys(rat.porPedido).every(k => somaC(Object.keys(rat.porPedido[k].porAnuncio), an => cent(rat.porPedido[k].porAnuncio[an])) === cent(rat.porPedido[k].total)
            && pedidos.find(p => p.id === k).status !== 'cancelado'), { t });
        L.formato.conta(Object.keys(rat.porPedido).every(k => emCentavos(rat.porPedido[k].total)) && emCentavos(rat.total_rateado) && emCentavos(rat.total_nao_rateado), { t });
        // Cada entrada sozinha (maior resto): a parte de CADA pedido a menos de 1 centavo da exata (custo × peso ÷ Σ pesos), nunca negativa,
        // e Σ partes = custo. (Antes o último levava todo o arredondamento: −R$ 0,04 com Ads de centavos — divergência 2, corrigida.)
        rateados.forEach(a => {
            const alvo = pedidos.filter(p => p.status !== 'cancelado' && (a.dia ? p.data_venda === a.dia : p.data_venda >= a.periodo_de && p.data_venda <= a.periodo_ate))
                .map(p => ({ p, peso: somaC(p.itens.filter(it => it.anuncio_id === a.anuncio_id), it => cent(it.preco_unit) * it.qtd) })).filter(x => x.peso > 0);
            const W = somaC(alvo, x => x.peso), so = MO.rateioAds([a], pedidos);
            alvo.forEach(x => {
                const exato = cent(a.custo) * x.peso / W, v = cent(so.porPedido[x.p.id].porAnuncio[a.anuncio_id]);
                L.perto.conta(Math.abs(v - exato) < 1 - 1e-9 && v >= 0 && emCentavos(so.porPedido[x.p.id].total), { a, exato, v, n: alvo.length });
                partes++; if (v < 0) negativas++;
            });
            L.perto.conta(somaC(alvo, x => cent(so.porPedido[x.p.id].porAnuncio[a.anuncio_id])) === cent(a.custo), { a, n: alvo.length });
        });
    }
    okLote(L.total, 'total rateado + não rateado = Σ custo do Ads (custo 0 fica fora); Σ dos pedidos = total rateado; não rateado = Σ das entradas que sobraram');
    okLote(L.anuncio, 'por anúncio: Σ das partes nos pedidos = Σ custo das entradas rateadas daquele anúncio');
    okLote(L.pedido, 'por pedido: total = Σ por anúncio; pedido cancelado nunca recebe Ads');
    okLote(L.formato, 'partes e totais do rateio em centavos exatos');
    okLote(L.perto, 'cada entrada sozinha (maior resto): parte de cada pedido a < 1 centavo da exata, nunca negativa, Σ partes = custo');
    ok(partes > 0 && negativas === 0, `cobertura: ${partes} partes geradas, nenhuma negativa`);
    const pequenos = Array.from({ length: 10 }, (_, i) => M.garantir('pedido', Object.assign({}, O, { id: 'Z' + i, data_venda: '2026-09-10', status: 'entregue', itens: [{ sku: 'MEIA-01', anuncio_id: 'AN9', qtd: 1, preco_unit: 10 }] })));
    const rz = MO.rateioAds([M.garantir('ads', Object.assign({}, O, { anuncio_id: 'AN9', dia: '2026-09-10', custo: 0.05 }))], pequenos);
    const pz = pequenos.map(p => cent(rz.porPedido[p.id].total));
    ok(cent(rz.total_rateado) === 5 && somaC(pz) === 5 && pz.join() === '1,1,1,1,1,0,0,0,0,0',
        'Ads de R$ 0,05 em 10 pedidos iguais: 5 × R$ 0,01 + 5 × R$ 0,00 (nunca −R$ 0,04 no último) — #31');
    const trinta = Array.from({ length: 30 }, (_, i) => ({ id: 'T' + i, status: 'pago', data_venda: '2026-09-10', itens: [{ anuncio_id: 'MLB9000000001', qtd: 1, preco_unit: 50, total: null }] }));
    const r30 = MO.rateioAds([{ custo: 3.15, anuncio_id: 'MLB9000000001', periodo_de: '2026-09-01', periodo_ate: '2026-09-30' }], trinta), p30 = trinta.map(p => cent(r30.porPedido[p.id].total));
    ok(somaC(p30) === 315 && p30.filter(c => c === 11).length === 15 && p30.filter(c => c === 10).length === 15 && p30.every(c => c >= 0),
        'Ads de R$ 3,15 em 30 pedidos iguais: 15 × R$ 0,11 + 15 × R$ 0,10, todos ≥ 0 (antes: 29 × R$ 0,11 e o último −R$ 0,04) — #29');
    // reparte (o maior resto do motor): soma = valor; cada parte a < 1 centavo da exata; sinal do valor; pesos 0 → partes iguais; null → null.
    const rp = lote(), rr = lcg(2931);
    for (let i = 0; i < 4000; i++) {
        const C = ent(rr, -200000, 200000), pesos = Array.from({ length: ent(rr, 1, 12) }, () => (rr() < 0.15 ? 0 : din(rr, 0.01, 900))), W = pesos.reduce((a, b) => a + b, 0);
        const ps = MO.reparte(C / 100, pesos), cs = ps.map(cent);
        rp.conta(ps.length === pesos.length && ps.every(emCentavos) && somaC(cs) === C && cs.every((c, k) => Math.abs(c - (W > 0 ? C * pesos[k] / W : C / pesos.length)) < 1 - 1e-9 && (C >= 0 ? c >= 0 : c <= 0)), { C, pesos, cs });
    }
    okLote(rp, 'reparte (maior resto): Σ partes = valor no centavo; cada parte a < 1 centavo da exata e com o sinal do valor (nunca −R$ 0,04 num rateio positivo)');
    ok(MO.reparte(1, [0, 0, 0]).map(cent).join() === '34,33,33' && MO.reparte(null, [1, 2]).every(v => v === null) && MO.reparte(5, []).length === 0 && Object.is(MO.reparte(-0.01, [1, 1])[1], 0),
        'reparte: pesos todos 0 → partes iguais (R$ 1,00 = 0,34 + 0,33 + 0,33); valor não lido → partes null; sem −0');
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('E. Lucro por produto e fechamento do mês');
{
    const r = lcg(31337), O = { canal: 'shopee', conta: 'conta-teste', fonte: 'api' };
    const L = { fech: lote(), semPedido: lote(), prodUn: lote(), prodSoma: lote(), prodUm: lote(), completo: lote() };
    for (let t = 0; t < 120; t++) {
        const meses = ['2026-08', '2026-09'], res = [];
        for (let i = 0; i < ent(r, 1, 25); i++) {
            const p = gerarPedidoMotor(r, t * 100 + i);
            const tarifas = [{ pedido_id: p.id, tipo: 'comissao', valor: din(r, 0.5, 40) }, { pedido_id: p.id, tipo: 'frete_venda', valor: din(r, 0, 25) }];
            if (r() < 0.2) tarifas.push({ pedido_id: p.id, tipo: 'comissao', valor: -din(r, 0.01, 5) });
            res.push(MO.lucroPedido(p, { tarifas: r() < 0.08 ? undefined : tarifas, custos: custosBase(), imposto_pct: um(r, [0, 6]), ads: r() < 0.3 ? din(r, 0, 9) : undefined }));
            if (r() < 0.3) res[res.length - 1].data = '2026-08-' + String(ent(r, 1, 31)).padStart(2, '0');
        }
        const semPed = Array.from({ length: ent(r, 0, 8) }, () => M.garantir('tarifa', Object.assign({}, O, { data: um(r, meses) + '-' + String(ent(r, 1, 28)).padStart(2, '0'), origem_pagamento: 'fatura',
            tipo: um(r, ['assinatura', 'armazenagem', 'ads', 'outro', 'comissao']), valor: r() < 0.25 ? -din(r, 0.01, 30) : din(r, 0.01, 150) })));
        const comPed = [M.garantir('tarifa', Object.assign({}, O, { pedido_id: 'X', data: '2026-09-02', tipo: 'comissao', valor: 1 }))];   // tarifa de pedido: não é "sem pedido"
        const adsN = Array.from({ length: ent(r, 0, 3) }, () => M.garantir('ads', Object.assign({}, O, { anuncio_id: 'AN1', dia: um(r, meses) + '-1' + ent(r, 0, 9), custo: din(r, 0.01, 20) })));
        const mes = '2026-09', rateados = r() < 0.7;
        const fe = MO.fechamentoMes({ mes, resultados: res, tarifas: semPed.concat(comPed), adsNaoRateado: adsN, ads_rateados: rateados ? undefined : false });
        const dentro = res.filter(x => U.mes(x.data) === mes), conta = dentro.filter(x => x.status === 'ok' || x.status === 'cancelado');
        const sp = semPed.filter(x => U.mes(x.data) === mes && (x.tipo !== 'ads' || !rateados)), porTipo = {};
        sp.forEach(x => { porTipo[x.tipo] = (porTipo[x.tipo] || 0) + cent(x.valor); });
        const spC = somaC(sp, x => cent(x.valor)), estC = somaC(sp.filter(x => x.valor < 0), x => cent(x.valor)), adsC = somaC(adsN.filter(a => U.mes(a.dia) === mes), a => cent(a.custo));
        const lucroC = somaC(conta, x => cent(x.lucro_real));
        L.semPedido.conta(cent(fe.sem_pedido.total) === spC && cent(fe.sem_pedido.estornos) === estC && Object.keys(porTipo).every(k => cent(fe.sem_pedido.porTipo[k]) === porTipo[k])
            && Object.keys(fe.sem_pedido.porTipo).length === Object.keys(porTipo).length, { t, fe: fe.sem_pedido, porTipo, rateados });
        L.fech.conta(cent(fe.lucro_pedidos) === lucroC && cent(fe.ads_nao_rateado) === adsC && cent(fe.lucro_mes) === lucroC - spC - adsC
            && cent(fe.receita_liquida) === somaC(conta, x => cent(x.receita_liquida)) && cent(fe.repasse) === somaC(conta, x => cent(x.repasse)) && cent(fe.custo) === somaC(conta, x => cent(x.custo_rs))
            && cent(fe.imposto) === somaC(conta, x => cent(x.imposto_rs)) && cent(fe.ads_rateado) === somaC(conta, x => cent(x.ads_rs)) && fe.pedidos === conta.length && fe.pendentes === dentro.length - conta.length,
            { t, fe, lucroC, spC, adsC });
        L.completo.conta(fe.completo === (fe.pendentes === 0) && MO.fechamentoMes({ mes, resultados: conta, tarifas: M.naoLido('fatura fora') }).completo === false, { t });
        // Produto: unidades = Σ qtd dos pedidos ok; pedidos contados uma vez; pendentes = itens de pedidos sem custo / não lidos.
        const prods = MO.lucroPorProduto(res), okRes = res.filter(x => x.status === 'ok' || x.status === 'cancelado');
        const un = {}; res.filter(x => x.status === 'ok').forEach(x => x.por_item.forEach(it => { un[it.sku] = (un[it.sku] || 0) + it.qtd; }));
        L.prodUn.conta(prods.every(pr => pr.unidades === (un[pr.sku] || 0) && ['receita', 'tarifas', 'custo', 'outros', 'imposto', 'ads', 'lucro_real'].every(k => emCentavos(pr[k])))
            && somaC(prods, pr => pr.pendentes) === somaC(res.filter(x => x.status !== 'ok' && x.status !== 'cancelado'), x => x.por_item.length), { t });
        // Σ produtos × Σ pedidos: exato, também com pedidos de 2+ itens (antes até 2 centavos por item: divergência 3, corrigida #32).
        const umItem = okRes.every(x => x.por_item.length === 1);
        const d = Math.abs(somaC(prods, pr => cent(pr.lucro_real)) - somaC(okRes, x => cent(x.lucro_real))), dr = Math.abs(somaC(prods, pr => cent(pr.receita)) - somaC(okRes, x => cent(x.receita_liquida)));
        (umItem ? L.prodUm : L.prodSoma).conta(d === 0 && dr === 0, { t, d, dr });
    }
    okLote(L.semPedido, 'tarifas SEM pedido do mês: Σ por tipo, total e estornos (os negativos); "ads" sem pedido só quando ads_rateados = false; tarifa de pedido fica fora');
    okLote(L.fech, 'fechamento: lucro do mês = lucro dos pedidos − tarifas sem pedido − Ads não rateado; receita, repasse, custo, imposto e Ads = Σ dos pedidos ok/cancelados do mês');
    okLote(L.completo, 'fechamento "completo" só sem pendentes e com as tarifas lidas (tarifas não lidas → completo = false)');
    okLote(L.prodUn, 'por produto: unidades = Σ qtd dos pedidos ok; dinheiro em centavos; pendentes = itens de pedidos sem custo/não lidos');
    okLote(L.prodUm, 'por produto (só pedidos de 1 item): Σ lucro e Σ receita dos produtos = Σ dos pedidos, no centavo');
    okLote(L.prodSoma, 'por produto (com pedidos de 2+ itens): Σ lucro e Σ receita dos produtos = Σ dos pedidos, no centavo (#32)');
    // O caso do relatório (#32): 3 itens de R$ 10,00 e comissão de R$ 1,00 → tarifas dos itens 0,34 + 0,33 + 0,33 e Σ produtos = lucro do pedido.
    const p32 = M.garantir('pedido', { canal: 'shopee', conta: 'x', fonte: 'api', id: 'P32', data_venda: '2026-09-10', status: 'entregue',
        itens: [{ sku: 'A', qtd: 1, preco_unit: 10 }, { sku: 'B', qtd: 1, preco_unit: 10 }, { sku: 'C', qtd: 1, preco_unit: 10 }] });
    const r32 = MO.lucroPedido(p32, { tarifas: [{ pedido_id: 'P32', tipo: 'comissao', valor: 1 }], custos: [{ sku: 'A', custo: 2 }, { sku: 'B', custo: 2 }, { sku: 'C', custo: 2 }], imposto_pct: 0 });
    const pr32 = MO.lucroPorProduto([r32]);
    ok(r32.lucro_real === 23 && r32.por_item.map(x => cent(x.tarifas)).join() === '34,33,33' && somaC(pr32, x => cent(x.lucro_real)) === 2300 && somaC(pr32, x => cent(x.tarifas)) === 100,
        '3 itens de R$ 10,00 e comissão de R$ 1,00: tarifas por item 0,34 + 0,33 + 0,33 = R$ 1,00 e Σ lucro dos produtos = R$ 23,00 do pedido (antes 0,99 e R$ 23,01) — #32');
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('F. Conciliação pedido × repasse: diferença = recebido − esperado, totais = Σ');
{
    const r = lcg(9090), tt = { canal: 'tiktok', conta: 'conta-teste', fonte: 'api' };
    const L = { linha: lote(), grupo: lote(), totais: lote(), formato: lote(), naoLido: lote(), mes: lote() };
    for (let t = 0; t < 150; t++) {
        const pedidos = [], tarifas = [], repasses = [], esperadoC = {};
        const n = ent(r, 2, 20);
        for (let i = 0; i < n; i++) {
            const id = 'C' + t + '-' + i, preco = ent(r, 990, 49990), tar = ent(r, 0, Math.floor(preco / 3));
            pedidos.push(M.garantir('pedido', Object.assign({}, tt, { id, data_venda: '2026-09-' + String(ent(r, 1, 20)).padStart(2, '0'), status: um(r, ['entregue', 'enviado', 'entregue']),
                data_entrega: r() < 0.7 ? '2026-09-' + String(ent(r, 2, 24)).padStart(2, '0') : null, itens: [{ sku: 'MEIA-01', qtd: 1, preco_unit: preco / 100 }] })));
            tarifas.push(M.garantir('tarifa', Object.assign({}, tt, { pedido_id: id, data: '2026-09-01', tipo: 'comissao', valor: tar / 100 })));
            esperadoC[id] = preco - tar;
        }
        const ids = pedidos.map(p => p.id), livres = ids.slice();
        const pega = () => livres.splice(ent(r, 0, livres.length - 1), 1)[0];
        let k = 0;
        while (livres.length) {
            const x = r(), rid = 'REP-' + t + '-' + (k++);
            if (x < 0.45) { const id = pega(), d = r() < 0.6 ? 0 : ent(r, -500, 300); repasses.push(M.garantir('repasse', Object.assign({}, tt, { id: rid, valor: (esperadoC[id] + d) / 100, pedidos: [id], status: um(r, ['disponivel', 'sacado']), data_liberada: '2026-09-2' + ent(r, 0, 8) }))); }
            else if (x < 0.6) { const id = pega(); repasses.push(M.garantir('repasse', Object.assign({}, tt, { id: rid, valor: (esperadoC[id] + ent(r, -100, 100)) / 100, pedidos: [id], status: um(r, ['a_liberar', 'retido']), data_prevista: '2026-09-30' }))); }
            else if (x < 0.72 && livres.length >= 2) { const g = [pega(), pega()]; repasses.push(M.garantir('repasse', Object.assign({}, tt, { id: rid, valor: (somaC(g, id => esperadoC[id]) + ent(r, -200, 200) * (r() < 0.5 ? 0 : 1)) / 100, pedidos: g, status: um(r, ['disponivel', 'a_liberar']), data_liberada: '2026-09-25' }))); }
            else if (x < 0.82 && livres.length >= 2) {   // repasse com por_pedido: cada pedido com o seu valor
                const g = [pega(), pega()], pp = {}; g.forEach(id => { pp[id] = (esperadoC[id] + (r() < 0.7 ? 0 : ent(r, -300, 300))) / 100; });
                repasses.push(M.garantir('repasse', Object.assign({}, tt, { id: rid, valor: U.soma(g, id => pp[id]), pedidos: g, por_pedido: pp, status: 'disponivel', data_liberada: '2026-09-26' })));
            } else pega();   // sem repasse ainda
        }
        if (repasses.length) repasses.push(copia(repasses[0]));   // o mesmo repasse lido 2 vezes
        repasses.push(M.garantir('repasse', Object.assign({}, tt, { id: 'SEM-' + t, valor: 12.34, pedidos: ['de-outro-periodo'], status: 'disponivel', data_liberada: '2026-09-02' })));
        const tol = um(r, [0, 0.05, 1]);
        const c = CO.conciliar({ pedidos, tarifas, repasses, hoje: '2026-09-27', tolerancia: tol });
        const unicos = repasses.filter((x, i) => repasses.findIndex(y => y.id === x.id) === i && x.pedidos.some(id => ids.indexOf(id) >= 0));
        const lib = x => x.status === 'disponivel' || x.status === 'sacado';
        c.pedidos.forEach(l => {
            L.formato.conta(['esperado', 'recebido', 'a_liberar', 'diferenca'].every(k2 => dinOk(l[k2])), { l });
            if (l.status === 'agrupado') return;
            L.linha.conta(cent(l.esperado) === esperadoC[l.pedido_id]
                && (l.recebido === null || ['ok', 'a_menor', 'a_maior', 'parcial'].indexOf(l.status) >= 0 && cent(l.diferenca) === cent(l.recebido) - esperadoC[l.pedido_id])
                && (l.status !== 'ok' || Math.abs(l.diferenca) <= tol + 1e-9) && (l.status !== 'a_menor' || l.diferenca < -tol) && (l.status !== 'a_maior' || l.diferenca > tol)
                && (['a_liberar', 'retido'].indexOf(l.status) < 0 || cent(l.diferenca) === cent(l.a_liberar) - esperadoC[l.pedido_id]), { l, esperado: esperadoC[l.pedido_id], tol });
        });
        c.grupos.forEach(g => {
            const rep = unicos.find(x => x.id === g.repasse_id), esp = somaC(g.pedidos, id => esperadoC[id]);
            L.grupo.conta(cent(g.esperado) === esp && cent(g.diferenca) === cent(rep.valor) - esp && (lib(rep) ? cent(g.recebido) === cent(rep.valor) && g.a_liberar === null : g.recebido === null && cent(g.a_liberar) === cent(rep.valor))
                && (g.status !== 'a_menor' || g.diferenca < -tol) && (g.status !== 'a_maior' || g.diferenca > tol) && g.pedidos.every(id => c.pedidos.find(l => l.pedido_id === id).status === 'agrupado'), { g, esp });
        });
        const recebidoC = somaC(unicos.filter(lib), x => cent(x.valor)), aLibC = somaC(unicos.filter(x => !lib(x)), x => cent(x.valor));
        const fechadas = c.pedidos.filter(l => ['ok', 'a_menor', 'a_maior', 'parcial'].indexOf(l.status) >= 0);
        const difC = somaC(fechadas, l => cent(l.diferenca)) + somaC(c.grupos.filter(g => g.recebido !== null), g => cent(g.diferenca));
        const espC = somaC(c.pedidos.filter(l => l.status !== 'agrupado'), l => esperadoC[l.pedido_id]) + somaC(c.grupos, g => cent(g.esperado));
        L.totais.conta(cent(c.totais.recebido) === recebidoC && cent(c.totais.a_liberar) === aLibC && cent(c.totais.diferenca) === difC && cent(c.totais.esperado) === espC
            && c.sem_pedido.length === 1 && somaC(Object.keys(c.totais.por_status), s => c.totais.por_status[s]) === n, { t, totais: c.totais, recebidoC, aLibC, difC, espC });
        // Tarifas não lidas: nenhuma linha com esperado inventado; repasses não lidos: idem.
        const nl = CO.conciliar({ pedidos, tarifas: M.naoLido('extrato fora'), repasses, hoje: '2026-09-27' });
        const nr = CO.conciliar({ pedidos, tarifas, repasses: M.naoLido('carteira fora'), hoje: '2026-09-27' });
        L.naoLido.conta(nl.pedidos.every(l => l.esperado === null && l.diferenca === null && (l.status === 'nao_lido' || l.status === 'agrupado')) && nl.grupos.every(g => g.esperado === null && g.diferenca === null && g.status === 'nao_lido')
            && nl.totais.diferenca === 0 && nr.pedidos.every(l => l.status === 'nao_lido' && l.diferenca === null && l.recebido === null) && nr.totais.repasses_nao_lidos === true && nr.totais.recebido === 0, { t });
        // Por mês (ML × Mercado Pago): esperado pelo mês da venda, recebido pelo mês da liberação, diferença = recebido − esperado.
        const resultados = pedidos.map(p => ({ data: p.data_venda, repasse: r() < 0.1 ? null : esperadoC[p.id] / 100 }));
        const pm = CO.conciliarPorMes(resultados, repasses);
        const es = somaC(resultados.filter(x => x.repasse !== null), x => cent(x.repasse)), rec = somaC(repasses.filter((x, i) => repasses.findIndex(y => y.id === x.id) === i && lib(x)), x => cent(x.valor));
        const s = pm['2026-09'];
        L.mes.conta(cent(s.esperado) === es && cent(s.recebido) === rec && cent(s.diferenca) === rec - es && s.pedidos_nao_lidos === resultados.filter(x => x.repasse === null).length, { t, s, es, rec });
    }
    okLote(L.formato, 'linhas da conciliação: esperado, recebido, a liberar e diferença em centavos ou null');
    okLote(L.linha, 'cada pedido: esperado = repasse do motor; diferença = recebido − esperado (a menor −, a maior +, ok dentro da tolerância); a liberar: diferença prevista');
    okLote(L.grupo, 'repasse de vários pedidos sem por_pedido: conciliado pelo grupo (esperado = Σ, diferença = valor − Σ), pedidos "agrupado"');
    okLote(L.totais, 'totais: recebido e a liberar = Σ repasses únicos (o repetido conta 1 vez; o de outro período fica fora); esperado e diferença = Σ linhas + grupos');
    okLote(L.naoLido, 'tarifas ou repasses não lidos: nenhum esperado/diferença inventado (status "nao_lido"; recebido 0 vem com repasses_nao_lidos = true)');
    okLote(L.mes, 'conciliação por mês: esperado = Σ repasses dos pedidos lidos, recebido = Σ liberados (únicos), diferença = recebido − esperado');
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Gerador de pedidos do TikTok (centavos inteiros) e as respostas que a tela do Seller Center recebe — ids e valores fictícios.
const SKU_IDS = ['1730000000000000101', '1730000000000000102', '1730000000000000103', '1730000000000000104', '1730000000000000105', '1730000000000000106'];
const TIPO_TT = { comissao: 'platform_commission', taxa_fixa: 'finance_statement_fee_name_br_fix_commission_fee_tooltip', programa_frete: 'sfp_service_fee',
    afiliado: 'affiliate_commission', afiliado_ads: 'affiliate_ads_commission', pagamento: 'transaction_fee' };
function gerarTT(r, i, o) {
    o = o || {};
    const id = '5770' + String(100000000000000 + i), dia = o.dia || '2026-09-' + String(ent(r, 1, 24)).padStart(2, '0');
    const n = o.nsku || (r() < 0.75 ? 1 : ent(r, 2, 3)), usados = [];
    const skus = Array.from({ length: n }, () => {
        let k; do { k = ent(r, 0, SKU_IDS.length - 1); } while (usados.indexOf(k) >= 0); usados.push(k);
        return { k, sku_id: SKU_IDS[k], seller: POOL[k], qtd: ent(r, 1, 3), unitC: ent(r, 990, 39990) };
    });
    const brutoC = somaC(skus, s => s.unitC * s.qtd), descC = r() < 0.3 ? ent(r, 1, Math.floor(brutoC / 10)) : 0, baseC = brutoC - descC;
    const reembC = o.reemb === 'total' ? baseC : o.reemb === 0 ? 0 : (r() < 0.1 ? ent(r, 1, baseC - 1) : 0);
    const qt = somaC(skus, s => s.qtd), fees = [];
    fees.push({ tipo: 'comissao', c: meioCima(baseC * (baseC / qt < 5000 ? 10 : 6), 100) });
    fees.push({ tipo: 'taxa_fixa', c: (baseC / qt < 5000 ? 400 : 600) * qt });
    fees.push({ tipo: 'programa_frete', c: Math.min(meioCima(baseC * 6, 100), 5000 * qt) });
    if (r() < 0.3) fees.push({ tipo: 'afiliado', c: meioCima(baseC * ent(r, 5, 20), 100) });
    if (r() < 0.08) fees.push({ tipo: 'afiliado_ads', c: meioCima(baseC * ent(r, 2, 8), 100) });
    if (r() < 0.12) fees.push({ tipo: 'comissao', c: -ent(r, 1, fees[0].c) });   // estorno de comissão (o TikTok devolve)
    const cheio = ent(r, 0, 4000), cliente = ent(r, 0, cheio), sub = ent(r, 0, cheio - cliente);
    const frete = { cheio, cliente, sub, liq: cheio - cliente - sub };
    const settlementC = baseC - reembC - somaC(fees, x => x.c) - frete.liq;
    return { i, id, dia, skus, brutoC, descC, baseC, reembC, fees, frete, settlementC, status: o.status || (r() < 0.8 ? 2 : 1), stmt: o.stmt || '880000000' + ent(r, 1, 5),
        sdid: '7700' + String(100000000000000 + i), entrega: U.somaDias(dia, ent(r, 1, 4)) };
}
const earningC = g => g.baseC - g.reembC;
// Divide um total em centavos pelos pesos, com o resto no último (a régua do teste: Σ = total sempre).
const reparte = (totalC, pesos) => { const W = somaC(pesos); let usado = 0; return pesos.map((p, i) => { const v = i === pesos.length - 1 ? totalC - usado : Math.round(totalC * p / W); usado += v; return v; }); };
function respTransacao(g, o) {
    o = o || {};
    const income = [{ type: 'subtotal_before_discount', amount: amt(g.brutoC), statement_item_id: 1 }];
    if (g.descC) income.push({ type: 'seller_discount', amount: amt(-g.descC), statement_item_id: 2 });
    if (g.reembC) income.push({ type: 'subtotal_after_discount_refund', amount: amt(-g.reembC), statement_item_id: 3 });
    const out = g.fees.map((x, k) => ({ type: TIPO_TT[x.tipo], amount: amt(-x.c), statement_item_id: 10 + k, starling: { starling_key: 'k_' + TIPO_TT[x.tipo], starling_text: x.c < 0 ? 'Estorno' : 'Tarifa' } }));
    const ship = [{ type: 'fbm_shipping_fee', amount: amt(-g.frete.cheio), description: '(weight: ' + (100 + g.i % 900) + ' g)' }];
    if (g.frete.cliente) ship.push({ type: 'customer_pay', starling: { starling_key: 'finance_customer_shipping_payment' }, amount: amt(g.frete.cliente) });
    if (g.frete.sub) ship.push({ type: 'shipping_fee_discount', amount: amt(g.frete.sub) });
    // Às vezes o TikTok manda em grupo (sub_fees): só as folhas contam (o grupo somaria duas vezes).
    const agrupa = (lista, tipo) => (o.grupos ? [{ type: tipo, amount: amt(somaC(lista, x => Math.round(Number(x.amount.amount) * 100))), sub_fees: lista }] : lista);
    return { code: 0, message: 'success', data: { order_record: {
        statement_detail_id: g.sdid, statement_id: g.stmt, trade_order_id: g.id, placed_time: msDia(g.dia), settlement_status: g.status,
        settlement_time: g.status === 2 ? msDia(U.somaDias(g.entrega, 7)) : undefined, estimate_settle_time: msDia(U.somaDias(g.entrega, 7)),
        settlement_amount: amt(g.settlementC), source_page_types: [{ starling_text: um(lcg(g.i), ['Live', 'Video', 'Product card']) }],
        in_come: { fee_list: agrupa(income, 'revenue_group') }, out_come: { fee_list: agrupa(out, 'fee_group') }, shipping_fee_detail: { fee_list: agrupa(ship, 'shipping_group') },
    } } };
}
function linhaLista(g) {
    const ganhos = reparte(earningC(g), g.skus.map(s => s.unitC * s.qtd));
    return { trade_order_id: g.id, statement_detail_id: g.sdid, statement_id: g.stmt, placed_time: msDia(g.dia), delivery_time: msDia(g.entrega), settlement_status: g.status,
        settlement_time: g.status === 2 ? msDia(U.somaDias(g.entrega, 7)) : undefined, estimate_settle_time: msDia(U.somaDias(g.entrega, 7)), to_settle_reason: g.status === 1 ? 3 : 0,
        earning_amount: amt(earningC(g)), fees: amt(-somaC(g.fees, x => x.c)), shipping_amount: amt(-g.frete.liq), settlement_amount: amt(g.settlementC),
        source_page_types: [{ starling_text: 'Video' }],
        sku_records: g.skus.map((s, k) => ({ sku_id: s.sku_id, quantity: s.qtd, product_name: 'Produto ' + s.seller, sku_name: '', earning_amount: amt(ganhos[k]) })) };
}
const respLista = gs => ({ code: 0, message: 'success', data: { order_records: gs.map(linhaLista) } });
function respDetalhe(g, o) {
    o = o || {};
    return { code: 0, data: { main_order: {
        main_order_id: g.id, main_order_create_time: segDia(g.dia), main_order_status: 2000, pay_method: 'pix', pick_up_type: 1,
        payment_info: { main_order_origin_sale_price: fp(g.brutoC), subtotal: fp(g.brutoC - g.descC), seller_discount_total: fp(g.descC), platform_discount_total: fp(0) },
        skus: g.skus.map(s => ({ seller_sku_name: s.seller, sku_id: s.sku_id, quantity: s.qtd, product_name: 'Produto ' + s.seller, sku_name: '', unit_price: fp(s.unitC), total_price: fp(s.unitC * s.qtd),
            sku_display_status: o.cancelado ? 140 : 122 })),
        logistic_info: { title: 'Package delivered', time: segDia(g.entrega) },
        buyer_info: { nome: 'NÃO PODE PASSAR' },
    } } };
}

console.log('G. Adaptador TikTok (núcleo): repasse = preço − tarifas − frete do vendedor (+ subsídios), no centavo');
{
    const r = lcg(5770);
    const L = { receita: lote(), tarifas: lote(), frete: lote(), repasse: lote(), sinal: lote(), formato: lote(), grupos: lote(), afil: lote(), lista: lote(), junta: lote() };
    const gs = [];
    for (let i = 0; i < 1500; i++) {
        const g = gerarTT(r, i), t = N.transacaoDoExtrato(respTransacao(g, { grupos: r() < 0.3 }), { conta: '7000000001' });
        gs.push(g);
        L.receita.conta(cent(t.receita.bruto) === g.brutoC && cent(t.receita.desconto_vendedor) === g.descC && cent(t.receita.reembolso) === g.reembC && t.receita.outros === 0, { g: g.i, receita: t.receita });
        const porTipo = {}; g.fees.forEach(x => { porTipo[x.tipo] = (porTipo[x.tipo] || 0) + x.c; });
        const tp = {}; t.tarifas.forEach(x => { tp[x.tipo] = (tp[x.tipo] || 0) + cent(x.valor); });
        L.tarifas.conta(Object.keys(porTipo).every(k => tp[k] === porTipo[k]) && tp.frete_venda === g.frete.liq && Object.keys(tp).length === Object.keys(porTipo).length + 1
            && t.tarifas.every(x => M.validar('tarifa', x).length === 0 && x.pedido_id === g.id && x.data === g.dia && x.estimada === (g.status === 1)), { g: g.i, tp, porTipo, liq: g.frete.liq });
        L.sinal.conta(t.tarifas.filter(x => x.tipo !== 'frete_venda').every((x, k) => cent(x.valor) === g.fees[k].c) && g.fees.some(x => x.c < 0) === t.tarifas.some(x => x.valor < 0 && x.tipo !== 'frete_venda'),
            { g: g.i, fees: g.fees, t: t.tarifas.map(x => x.valor) });
        L.frete.conta(t.frete && cent(t.frete.cheio) === g.frete.cheio && cent(t.frete.pago_comprador) === g.frete.cliente && cent(t.frete.subsidio) === g.frete.sub
            && cent(t.frete.cobrado_vendedor) === g.frete.cheio - g.frete.cliente - g.frete.sub && t.frete.peso_cobrado_g === 100 + g.i % 900, { g: g.i, frete: t.frete, esperado: g.frete });
        L.repasse.conta(cent(t.repasse.valor) === g.settlementC && cent(t.confere.calculado) === g.brutoC - g.descC - g.reembC - somaC(g.fees, x => x.c) - g.frete.liq && t.confere.diferenca === 0
            && t.repasse.status === (g.status === 2 ? 'disponivel' : 'a_liberar') && t.repasse.estimado === (g.status === 1) && t.avisos.length === 0, { g: g.i, confere: t.confere, avisos: t.avisos });
        L.formato.conta([t.receita.bruto, t.receita.desconto_vendedor, t.receita.reembolso, t.repasse.valor, t.confere.calculado].every(emCentavos) && t.tarifas.every(x => emCentavos(x.valor))
            && M.validar('repasse', t.repasse).length === 0 && M.validar('frete', t.frete).length === 0, { g: g.i });
        const af = g.fees.filter(x => x.tipo === 'afiliado' || x.tipo === 'afiliado_ads');
        L.afil.conta(t.afiliados.length === af.length && t.afiliados.every((a, k) => cent(a.comissao_valor) === af[k].c && a.comissao_pct === (g.baseC > 0 ? Math.round(af[k].c / g.baseC * 10000) / 100 : null)), { g: g.i, af: t.afiliados });
        // A lista do Financeiro (1 linha por pedido): tarifas e frete POSITIVOS (o que o vendedor paga) e confere = 0.
        const l = N.pedidosDaListaFinanceira(respLista([g]), { conta: '7000000001' })[0];
        L.lista.conta(cent(l.receita) === earningC(g) && cent(l.tarifas_total) === somaC(g.fees, x => x.c) && cent(l.frete) === g.frete.liq && cent(l.repasse.valor) === g.settlementC && l.confere === 0
            && somaC(l.skus, s => cent(s.receita)) === earningC(g) && l.repasse.pedidos[0] === g.id, { g: g.i, l });
    }
    okLote(L.receita, 'extrato do pedido: preço (subtotal antes do desconto), desconto do vendedor e reembolso = os do TikTok, positivos');
    okLote(L.tarifas, 'extrato: Σ tarifas por tipo = as do TikTok (chave mapeada, nunca o texto); frete_venda = frete líquido; todas válidas no modelo, "estimada" quando a liquidar');
    okLote(L.sinal, 'sinal: tarifa cobrada (−X no TikTok) vira +X; estorno (+X no TikTok) vira −X');
    okLote(L.frete, 'frete: custo do envio, pago pelo cliente e subsídio do TikTok lidos; cobrado do vendedor = custo − cliente − subsídio; peso lido');
    okLote(L.repasse, 'repasse = preço − desconto − reembolso − tarifas − frete do vendedor (+ subsídios) = settlement do TikTok, diferença 0, sem aviso');
    okLote(L.formato, 'extrato: todo dinheiro em centavos e registros válidos no modelo');
    okLote(L.afil, 'afiliado: valor = a tarifa do TikTok e % = valor ÷ (preço − desconto do vendedor)');
    okLote(L.lista, 'lista do Financeiro: receita = ganho, tarifas e frete positivos, repasse = settlement, confere 0, Σ receita dos SKUs = receita do pedido');

    // Mesmo pedido em grupos (sub_fees) ou plano: a mesma conta (o grupo nunca soma duas vezes).
    const gr = lote();
    gs.slice(0, 300).forEach(g => {
        const a = N.transacaoDoExtrato(respTransacao(g, { grupos: false }), { conta: '7000000001' }), b = N.transacaoDoExtrato(respTransacao(g, { grupos: true }), { conta: '7000000001' });
        gr.conta(JSON.stringify(a.receita) === JSON.stringify(b.receita) && U.soma(a.tarifas, x => x.valor) === U.soma(b.tarifas, x => x.valor) && b.confere.diferenca === 0, { g: g.i });
    });
    okLote(gr, 'tarifas em grupo (sub_fees): só as folhas contam — a mesma conta do extrato plano');

    // O mesmo pedido em 2 extratos (venda num, devolução parcial noutro): juntaPorPedido soma; o mesmo extrato lido 2 vezes conta 1.
    const jt = lote();
    gs.slice(0, 400).forEach((g, k) => {
        const devC = Math.min(ent(r, 1, 3000), g.baseC), venda = Object.assign({}, g, { reembC: 0, settlementC: g.baseC - somaC(g.fees, x => x.c) - g.frete.liq });
        const dev = { i: g.i, id: g.id, dia: g.dia, skus: g.skus, brutoC: 0, descC: 0, baseC: 0, reembC: devC, fees: [], frete: { cheio: 0, cliente: 0, sub: 0, liq: 0 }, settlementC: -devC, status: 2, stmt: '889999999', sdid: '7799' + String(100000000000000 + k), entrega: g.entrega };
        const ta = N.transacaoDoExtrato(respTransacao(venda), { conta: '7000000001' }), tb = N.transacaoDoExtrato(respTransacao(dev), { conta: '7000000001' });
        const j = N.juntaPorPedido([ta, tb, ta]);
        jt.conta(j.length === 1 && cent(j[0].receita.bruto) === g.brutoC && cent(j[0].receita.reembolso) === devC && j[0].repasses.length === 2 && cent(U.soma(j[0].repasses, x => x.valor)) === venda.settlementC - devC
            && cent(U.soma(j[0].tarifas, x => x.valor)) === somaC(g.fees, x => x.c) + g.frete.liq, { g: g.i, j: j[0] && j[0].receita });
    });
    okLote(jt, 'pedido em 2 extratos (venda + devolução): juntaPorPedido soma receita, reembolso, tarifas e repasses; o extrato repetido conta 1 vez');

    // Extratos (nível do extrato), a receber por motivo e saldo: a conta do TikTok fecha.
    const ex = lote();
    for (let t = 0; t < 200; t++) {
        const recs = Array.from({ length: ent(r, 1, 6) }, (_, k) => {
            const e = ent(r, 0, 900000), fe = -ent(r, 0, 200000), sh = -ent(r, 0, 50000), ad = ent(r, -5000, 5000);
            return { statement_id: '88' + t + '0' + k, settle_amount: amt(e + fe + sh + ad), earning_amount: amt(e), fee_amount: amt(fe), shipping_amount: amt(sh), adjust_amount: amt(ad), payment_status: um(r, [20, 1]),
                settlement_time: msDia('2026-09-2' + ent(r, 0, 5)), bill_period: msDia('2026-09-1' + ent(r, 0, 9)), _c: [e, fe, sh, ad] };
        });
        const rs = N.repassesDosExtratos({ code: 0, data: { statement_records: recs } }, '7000000001');
        ex.conta(rs.length === recs.length && rs.every((x, k) => x.confere === 0 && cent(x.valor) === somaC(recs[k]._c) && cent(x.receita) === recs[k]._c[0] && cent(x.tarifas) === recs[k]._c[1]
            && cent(x.frete) === recs[k]._c[2] && cent(x.ajuste) === recs[k]._c[3] && x.status === (recs[k].payment_status === 20 ? 'disponivel' : 'a_liberar')), { t });
        const mot = [ent(r, 0, 90000), ent(r, 0, 90000), ent(r, 0, 90000)];
        const ar = N.aReceberPorMotivo({ code: 0, data: { to_settle_amount_stat: { amount: amt(somaC(mot)), reasons_detail: mot.map((v, k) => ({ reason: k + 1, title: { starling_text: 'm' + k }, amount: amt(v) })) }, seller_quality_stat: { bill_finish_period_in_days: 7 } } });
        ex.conta(cent(ar.total) === somaC(mot) && ar.confere === 0 && ar.motivos.map(m => cent(m.valor)).join() === mot.join() && ar.motivos.map(m => m.motivo).join() === 'em_transito,devolucao,entregue_no_prazo', { t, ar });
        const sv = ent(r, -5000, 900000);
        ex.conta(cent(N.saldoDisponivel({ code: 0, data: { amount: amt(sv) } }).valor) === sv, { t, sv });
    }
    okLote(ex, 'extratos: valor = receita + tarifas + frete + ajuste (confere 0); a receber = Σ motivos (confere 0); saldo = o do TikTok');

    // Ausente/ilegível NUNCA vira número: settlement, extrato, lista, a receber e saldo → não lido.
    const g0 = gs[0], semSettle = respTransacao(g0); delete semSettle.data.order_record.settlement_amount;
    const lista0 = respLista([g0]); delete lista0.data.order_records[0].settlement_amount;
    const sl = N.pedidosDaListaFinanceira(lista0, { conta: '7000000001' })[0];
    ok(M.ehNaoLido(N.transacaoDoExtrato(semSettle, { conta: '7000000001' }).repasse) && N.transacaoDoExtrato(semSettle, { conta: '7000000001' }).confere.diferenca === null
        && M.ehNaoLido(sl.repasse) && sl.confere === null && M.ehNaoLido(N.transacaoDoExtrato({ code: 0, data: {} })) && M.ehNaoLido(N.transacaoDoExtrato({ code: 10001, data: { order_record: {} } }))
        && M.ehNaoLido(N.pedidosDaListaFinanceira({ code: 0, data: {} })) && M.ehNaoLido(N.repassesDosExtratos({ code: 0, data: {} })) && M.ehNaoLido(N.aReceberPorMotivo({ code: 0, data: {} }))
        && M.ehNaoLido(N.saldoDisponivel({ code: 0, data: {} })) && M.ehNaoLido(N.saldoDisponivel({ code: 0, data: { amount: { amount: 'abc' } } })),
        'settlement ausente → repasse "não lido" e confere null; resposta não reconhecida / erro do TikTok / saldo ilegível → não lido (nunca R$ 0,00)');
    const ruim = respTransacao(g0); ruim.data.order_record.out_come.fee_list[0].amount = { amount: 'abc' };
    const tr = N.transacaoDoExtrato(ruim, { conta: '7000000001' });
    ok(tr.avisos.some(a => /tarifa sem valor/.test(a)) && tr.avisos.some(a => /extrato não fecha/.test(a)) && tr.confere.diferenca === -U.r2(g0.fees[0].c / 100),
        'tarifa ilegível: o extrato avisa "tarifa sem valor" e "não fecha" com a diferença exata (a extensão não usa esse extrato como exato: seção K)');
    // #34: frete com valor vazio/ilegível → frete não lido (sem valores, sem frete_venda inventado), aviso próprio e o extrato "não fecha";
    // settlement e saldo vazios → não lido (antes {amount:""} virava R$ 0,00).
    const fr = respTransacao(g0); fr.data.order_record.shipping_fee_detail.fee_list[0].amount = { amount: '', currency: 'BRL' };
    const tf = N.transacaoDoExtrato(fr, { conta: '7000000001' }), stV = respTransacao(g0); stV.data.order_record.settlement_amount = { amount: '' };
    ok(tf.avisos.some(a => /^frete sem valor/.test(a)) && tf.frete.cheio === null && tf.frete.cobrado_vendedor === null && !tf.tarifas.some(x => x.tipo === 'frete_venda')
        && (g0.frete.liq === 0 || tf.confere.diferenca !== 0) && M.ehNaoLido(N.transacaoDoExtrato(stV, { conta: '7000000001' }).repasse) && M.ehNaoLido(N.saldoDisponivel({ code: 0, data: { amount: { amount: '' } } })),
        'frete com valor vazio: "frete sem valor", frete não lido e sem frete_venda inventado (antes cheio 0 e −R$ 12 de frete); settlement e saldo vazios → não lido — #34');

    // Detalhe do pedido (Pedidos): preço de origem por SKU. 1 SKU (ou preço cheio por SKU) = exato; vários com desconto: pelo maior resto,
    // Σ itens = preço de origem no centavo (antes cada linha = r2(origem × pago ÷ Σ) sem o resto: divergência 1, corrigida #30).
    const d1 = lote(), dn = lote();
    let perdeu = 0, multi = 0;
    gs.slice(0, 600).forEach(g => {
        const det = N.pedidoDoDetalhe(N.filtroPedidoSemComprador(respDetalhe(g)), { conta: '7000000001' });
        const p = det.pedido;
        d1.conta(!M.ehNaoLido(p) && M.validar('pedido', p).length === 0 && somaC(p.itens, it => cent(it.total)) === g.brutoC && cent(p.desconto_vendedor) === g.descC && p.data_venda === g.dia
            && p.itens.every((it, k) => cent(it.total) === g.skus[k].unitC * g.skus[k].qtd && it.sku === g.skus[k].seller && it.anuncio_id === g.skus[k].sku_id) && !JSON.stringify(det).includes('NÃO PODE PASSAR'), { g: g.i, p });
        // Pago com desconto por SKU (o TikTok manda o preço do SKU sem os descontos): volta ao preço de origem pela participação.
        const comDesc = respDetalhe(g); const pagos = reparte(g.brutoC - g.descC, g.skus.map(s => s.unitC * s.qtd));
        comDesc.data.main_order.skus.forEach((s, k) => { s.total_price = fp(pagos[k]); });
        const p2 = N.pedidoDoDetalhe(comDesc, { conta: '7000000001' }).pedido, dif = Math.abs(somaC(p2.itens, it => cent(it.total)) - g.brutoC);
        if (g.skus.length === 1) d1.conta(dif === 0, { g: g.i, dif });
        else { multi++; if (dif) perdeu++; dn.conta(dif === 0 && p2.itens.every((it, k) => emCentavos(it.total) && Math.abs(cent(it.total) - g.brutoC * pagos[k] / (g.brutoC - g.descC)) < 1 - 1e-9), { g: g.i, dif }); }
    });
    okLote(d1, 'detalhe do pedido: Σ itens = preço de origem e desconto do vendedor no centavo (1 SKU, ou preço cheio por SKU); nada do comprador passa');
    okLote(dn, 'detalhe com vários SKUs e desconto: Σ itens = preço de origem no centavo, cada item a < 1 centavo da parte exata (#30)');
    ok(multi > 0 && perdeu === 0, `cobertura: ${multi} pedidos com vários SKUs e desconto, nenhum com Σ itens ≠ preço de origem (#30)`);
    // Os casos do relatório (#30): 3 SKUs pagos a R$ 33,33 com origem R$ 100,00; 3 × R$ 29,90 com cupom do vendedor de R$ 10 (pagos 26,57/26,57/26,56),
    // entregue e devolvido (reembolso "total" = origem − desconto do vendedor = R$ 79,70, nunca 79,69).
    const det30 = (origemC, descC, pagosC, x) => ({ code: 0, data: { main_order: Object.assign({ main_order_id: '9000000000000000301', main_order_create_time: segDia('2026-09-20'),
        payment_info: { main_order_origin_sale_price: fp(origemC), subtotal: fp(origemC - descC), seller_discount_total: fp(descC), platform_discount_total: fp(0) },
        skus: pagosC.map((c, k) => ({ seller_sku_name: 'PROD-' + k, sku_id: '80000000000000000' + k, quantity: 1, total_price: fp(c), sku_display_status: 122 })) }, x || {}) } });
    const p30a = N.pedidoDoDetalhe(det30(10000, 1, [3333, 3333, 3333]), { conta: '7000000001' }).pedido;
    const p30b = N.pedidoDoDetalhe(det30(8970, 1000, [2657, 2657, 2656], { reverse_info: { reverse_order_id: '4000000000000000030', reverse_status: 100, reverse_type: 1 } }), { conta: '7000000001' }).pedido;
    ok(p30a.itens.map(it => cent(it.total)).join() === '3334,3333,3333' && somaC(p30a.itens, it => cent(it.total)) === 10000
        && somaC(p30b.itens, it => cent(it.total)) === 8970 && p30b.status === 'devolvido' && cent(p30b.reembolso) === 7970,
        'detalhe com 3 SKUs: R$ 100,00 = 33,34 + 33,33 + 33,33 (antes 99,99); 3 × R$ 29,90 com cupom de R$ 10: Σ = R$ 89,70 e o reembolso total do devolvido = R$ 79,70 (antes 89,69 e 79,69) — #30');
    // #33: tarifa 'ads' que veio DENTRO do extrato do pedido (GMV Pay: fixture de suposição, settlement 54 = 100 − 6 − 30 − 10; a conta do extrato
    // fecha com ela, então o TikTok a tirou do repasse) → o repasse do motor = o settlement, a conciliação "ok" e as linhas mostram o Ads.
    {
        const tg = N.transacaoDoExtrato(require(path.join(RAIZ, 'copiloto-nucleo', 'testes', 'fixtures', 'tarifa_gmv_pay_suposicao.json')), { conta: '7000000001' });
        const pg = M.garantir('pedido', { canal: 'tiktok', conta: '7000000001', fonte: 'tela', id: tg.pedido_id, data_venda: tg.data, status: 'entregue', data_entrega: tg.data, itens: [{ sku: 'A', qtd: 1, total: 100 }] });
        const rg = MO.lucroPedido(pg, { tarifas: tg.tarifas, custos: [{ sku: 'A', custo: 10 }], imposto_pct: 0 });
        const cg = CO.conciliar({ pedidos: [pg], tarifas: tg.tarifas, repasses: [tg.repasse], hoje: '2026-10-07' });
        const ateRep = []; for (const l of rg.linhas) { if (l.rotulo === '= Repasse do canal') break; if (!l.total) ateRep.push(l); }
        ok(tg.confere.diferenca === 0 && tg.repasse.valor === 54 && rg.repasse === 54 && rg.ads_no_repasse === 30 && rg.ads_rs === 30 && rg.lucro_antes_ads === 74 && rg.lucro_real === 44
            && cg.pedidos[0].status === 'ok' && cg.pedidos[0].diferenca === 0 && cg.totais.diferenca === 0
            && somaC(ateRep, l => cent(l.valor)) === 5400 && ateRep.some(l => l.rotulo === 'Ads pago com o repasse' && l.valor === -30) && somaC(rg.linhas.filter(l => !l.total), l => cent(l.valor)) === 4400,
            'GMV Pay no extrato (#33): repasse do motor R$ 54,00 = o que o TikTok pagou (antes R$ 84,00), conciliação "ok" (antes "a menor" −R$ 30,00); a linha "Ads pago com o repasse" fecha a conta; lucro R$ 44,00');
        // Controle: Ads sem origem (ou de fatura) continua fora do repasse; Shopee: ads_escrow dentro do escrow sai do repasse igual.
        const rf = MO.lucroPedido(pg, { tarifas: tg.tarifas.map(x => Object.assign({}, x, { origem_pagamento: x.tipo === 'ads' ? 'fatura' : x.origem_pagamento })), custos: [{ sku: 'A', custo: 10 }], imposto_pct: 0 });
        const es = SP.transacaoDoEscrow({ response: { order_sn: 'SPG1', order_income: { order_original_price: '100.00', commission_fee: '20.00', ads_escrow_top_up_fee_or_technical_support_fee: '15.00', escrow_amount: '65.00', actual_shipping_fee: '0' } } }, { conta: 'loja-sp-teste', data: '2026-09-30' });
        const ps = M.garantir('pedido', { canal: 'shopee', conta: 'loja-sp-teste', fonte: 'api', id: 'SPG1', data_venda: '2026-09-30', status: 'entregue', itens: [{ sku: 'A', qtd: 1, total: 100 }] });
        const cs = CO.conciliar({ pedidos: [ps], tarifas: es.tarifas, repasses: [Object.assign({}, es.repasse, { status: 'disponivel' })], hoje: '2026-10-07' });
        ok(rf.repasse === 84 && rf.lucro_real === 44 && rf.ads_no_repasse === 0 && MO.lucroPedido(ps, { tarifas: es.tarifas, custos: [{ sku: 'A', custo: 10 }], imposto_pct: 0 }).repasse === 65 && cs.pedidos[0].status === 'ok',
            'controle: Ads de fatura fica fora do repasse (R$ 84,00, o mesmo lucro R$ 44,00); Shopee com ads_escrow de R$ 15 no escrow: repasse R$ 65,00 = escrow e conciliação "ok"');
    }
    const devol = respDetalhe(gs[1]); devol.data.main_order.reverse_info = { reverse_order_id: '4000000000000000001', reverse_status: 100, reverse_type: 2 };
    const pd = N.pedidoDoDetalhe(N.filtroPedidoSemComprador(devol), { conta: '7000000001' });
    ok(pd.pedido.status === 'devolvido' && cent(pd.pedido.reembolso) === gs[1].brutoC - gs[1].descC && pd.devolucao.produto_voltou === false && pd.devolucao.valor_reembolsado === null,
        'devolvido visto só em Pedidos: reembolso = preço − desconto do vendedor (total); valor reembolsado da devolução fica null (não lido, nunca R$ 0,00)');
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('H. Adaptador Shopee (núcleo): escrow fecha no centavo');
{
    const r = lcg(80), L = { escrow: lote(), frete: lote(), tabela: lote() };
    for (let i = 0; i < 1500; i++) {
        const orig = ent(r, 500, 200000), sd = r() < 0.3 ? ent(r, 1, Math.floor(orig / 10)) : 0, vs = r() < 0.2 ? ent(r, 1, 1000) : 0, coin = r() < 0.1 ? ent(r, 1, 300) : 0;
        const comm = ent(r, 0, Math.floor(orig / 4)), serv = r() < 0.4 ? ent(r, 1, 2600) : 0, ams = r() < 0.3 ? ent(r, 1, Math.floor(orig / 10)) : 0, refund = r() < 0.1 ? ent(r, 1, orig - sd) : 0;
        const actual = ent(r, 0, 4000), buyer = ent(r, 0, actual), rebate = ent(r, 0, actual), adj = r() < 0.15 ? ent(r, -3000, 3000) : 0;
        const liq = actual - buyer - rebate;   // pode ser negativo (a Shopee cobriu mais que o custo)
        const escrowC = orig - sd - vs - coin - refund + adj - comm - serv - ams - liq;
        const sinal = () => (r() < 0.5 ? -1 : 1);   // a Shopee manda desconto/tarifa ora positivo, ora negativo: o adaptador usa o módulo
        const oi = { order_original_price: txt(orig), seller_discount: txt(sinal() * sd), voucher_from_seller: txt(sinal() * vs), seller_coin_cash_back: txt(sinal() * coin),
            commission_fee: txt(comm), service_fee: txt(serv), order_ams_commission_fee: txt(ams), seller_return_refund: txt(sinal() * refund), total_adjustment_amount: txt(adj),
            actual_shipping_fee: txt(actual), buyer_paid_shipping_fee: txt(buyer), shopee_shipping_rebate: txt(rebate), seller_transaction_fee: 0, escrow_amount_after_adjustment: txt(escrowC) };
        const t = SP.transacaoDoEscrow({ response: { order_sn: 'SP' + (260000000 + i), order_income: oi } }, { conta: 'loja-sp-teste', data: '2026-09-30' });
        L.escrow.conta(cent(t.receita.bruto) === orig && cent(t.receita.desconto_vendedor) === sd + vs + coin && cent(t.receita.reembolso) === refund && cent(t.receita.outros) === adj
            && cent(t.repasse.valor) === escrowC && t.confere.diferenca === 0 && t.avisos.length === 0 && t.tarifas.every(x => emCentavos(x.valor) && M.validar('tarifa', x).length === 0)
            && somaC(t.tarifas.filter(x => x.tipo === 'comissao'), x => cent(x.valor)) === comm + serv && somaC(t.tarifas.filter(x => x.tipo === 'afiliado'), x => cent(x.valor)) === ams, { i, oi, t: t.confere, av: t.avisos });
        L.frete.conta(cent(t.frete.cobrado_vendedor) === liq && cent(t.frete.cheio) === actual && cent(t.frete.pago_comprador) === buyer && cent(t.frete.subsidio) === rebate
            && (liq === 0 ? !t.tarifas.some(x => x.tipo === 'frete_venda') : cent(t.tarifas.find(x => x.tipo === 'frete_venda').valor) === liq), { i, liq, frete: t.frete });
        // Tabela × escrow: a comissão cobrada bate com a tabela do dia quando o escrow foi montado pela tabela.
        const preco = ent(r, 500, 150000), qtd = ent(r, 1, 3), ls = SP.tarifaEstimada(preco / 100, { qtd }, '2026-10-01'), tab = somaC(ls.filter(x => x.tipo === 'comissao' || x.tipo === 'taxa_fixa'), x => cent(x.valor));
        const e2 = SP.transacaoDoEscrow({ response: { order_sn: 'SPT' + i, order_income: { order_original_price: txt(preco * qtd), commission_fee: txt(tab), escrow_amount: txt(preco * qtd - tab), actual_shipping_fee: 0 } } }, { conta: 'loja-sp-teste', data: '2026-10-01' });
        const ct = SP.confereTabela(e2, [{ preco_unit: preco / 100, qtd }]);
        L.tabela.conta(e2.confere.diferenca === 0 && cent(ct.tabela) === tab && cent(ct.escrow) === tab && ct.diferenca === 0, { i, preco, qtd, ct });
    }
    okLote(L.escrow, 'escrow: preço, desconto (vendedor + cupom + moedas, em módulo), reembolso e ajuste lidos; repasse = escrow, diferença 0; comissão + serviço e afiliado no centavo');
    okLote(L.frete, 'escrow: frete líquido = custo − pago pelo comprador − subsídio da Shopee (negativo = a Shopee cobriu mais), frete 0 não vira tarifa');
    okLote(L.tabela, 'escrow montado pela tabela de 01/10/2026: confereTabela dá diferença 0');
    const sem = SP.transacaoDoEscrow({ response: { order_sn: 'SPX', order_income: { order_original_price: '50.00', commission_fee: '14.50' } } }, { conta: 'x', data: '2026-10-01' });
    ok(M.ehNaoLido(sem.repasse) && sem.confere.diferenca === null && sem.avisos.some(a => /actual_shipping_fee/.test(a)) && M.ehNaoLido(SP.transacaoDoEscrow({ error: 'auth' }, { data: '2026-10-01' }))
        && M.ehNaoLido(SP.transacaoDoEscrow({ response: { order_sn: 'SPX', order_income: {} } }, {})), 'Shopee: escrow sem valor → repasse não lido; frete não lido avisa; sem data/erro → não lido');
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════
(async () => {
    console.log('I. Extensão (tiktok.js): captura → gravado → SHC.tt.resumo — Σ por pedido = total do período');
    const CONTA = '7000000001', HOJE = '2026-09-25';
    const r = lcg(26092026), gs = [], modos = {}, devs = {};
    // Modos de leitura: lista do Financeiro; lista + detalhe do extrato (exato); só o extrato; lista + Pedidos; só Pedidos (estimado pela tabela);
    // lista2 = o pedido tem 2 linhas no Financeiro (venda + devolução parcial noutro extrato); lista2_trans = idem + o detalhe só da venda.
    for (let i = 0; i < 170; i++) {
        const x = r(), modo = x < 0.26 ? 'lista' : x < 0.52 ? 'exato' : x < 0.62 ? 'trans' : x < 0.76 ? 'lista_det' : x < 0.86 ? 'det' : x < 0.93 ? 'lista2' : 'lista2_trans';
        const g = gerarTT(r, 5000 + i, /det|lista2/.test(modo) ? { reemb: 0 } : {});
        gs.push(g); modos[g.id] = modo;
        // A 2ª linha (devolução parcial) no mesmo estado da venda: liquidadas as duas ou "Est." as duas (o caso misto é a divergência 11).
        if (/lista2/.test(modo)) { const devC = ent(r, 1, Math.max(1, Math.floor(earningC(g) / 2)));
            devs[g.id] = Object.assign({}, g, { sdid: '7799' + String(100000000000000 + g.i), stmt: '889999999', brutoC: 0, descC: 0, baseC: 0, reembC: devC, fees: [],
                frete: { cheio: 0, cliente: 0, sub: 0, liq: 0 }, settlementC: -devC }); }
    }
    // 2 pedidos de devolução total vistos na lista + Pedidos (o TikTok ficou com o SFP e o frete).
    [0, 1].forEach(k => { const g = gerarTT(r, 5900 + k, { reemb: 'total', nsku: 1 }); gs.push(g); modos[g.id] = 'lista_det_dev'; });
    const linhasFin = gs.reduce((a, g) => a.concat([g], devs[g.id] ? [devs[g.id]] : []), []);   // todas as linhas do Financeiro (o TikTok tem todas)
    const naLista = l => /^lista|exato/.test(modos[l.id]), repC = g => g.settlementC + (devs[g.id] ? devs[g.id].settlementC : 0), ganhoC = g => earningC(g) + (devs[g.id] ? earningC(devs[g.id]) : 0);
    const lidoEm = Date.now() - 3600e3;
    let respostas = 0;
    const lista = linhasFin.filter(naLista);
    for (let k = 0; k < lista.length; k += 25) { const rr = await TT.gravarCaptura('pedidos_fin', respLista(lista.slice(k, k + 25)), CONTA, lidoEm); respostas += rr.ok ? 1 : 0; }
    for (const g of gs) {
        if (/^(exato|trans|lista2_trans)$/.test(modos[g.id])) await TT.gravarCaptura('transacao', respTransacao(g, { grupos: g.i % 3 === 0 }), CONTA, lidoEm);
        if (/det/.test(modos[g.id])) {
            const det = respDetalhe(g);
            if (modos[g.id] === 'lista_det_dev') det.data.main_order.reverse_info = { reverse_order_id: '4000000000000000009', reverse_status: 100, reverse_type: 1 };
            await TT.gravarCaptura('pedido', det, CONTA, lidoEm);
        }
    }
    // Extratos (nível do extrato) coerentes com TODAS as linhas; a receber; saldo.
    const stmts = {};
    linhasFin.forEach(l => { (stmts[l.stmt] = stmts[l.stmt] || []).push(l); });
    const recs = Object.keys(stmts).sort().map(id => {
        const s = stmts[id];
        return { statement_id: id, settle_amount: amt(somaC(s, l => l.settlementC)), earning_amount: amt(somaC(s, earningC)), fee_amount: amt(-somaC(s, l => somaC(l.fees, x => x.c))),
            shipping_amount: amt(-somaC(s, l => l.frete.liq)), adjust_amount: amt(0), payment_status: 20, settlement_time: msDia('2026-09-24'), bill_period: msDia('2026-09-23') };
    });
    await TT.gravarCaptura('extratos', { code: 0, data: { statement_records: recs } }, CONTA, lidoEm);
    const mot = reparte(somaC(linhasFin.filter(l => l.status === 1), l => l.settlementC), [3, 1, 6]);
    await TT.gravarCaptura('areceber', { code: 0, data: { to_settle_amount_stat: { amount: amt(somaC(mot)), reasons_detail: mot.map((v, k) => ({ reason: k + 1, title: { starling_text: 'Motivo ' + (k + 1) }, amount: amt(v) })) },
        seller_quality_stat: { bill_finish_period_in_days: 7 } } }, CONTA, lidoEm);
    const saldoC = 1234567;
    await TT.gravarCaptura('saldo', { code: 0, data: { amount: amt(saldoC) } }, CONTA, lidoEm);
    // Custos: pelo SKU do vendedor (c|sku|…) e um "ligar ao SKU" direto no sku_id do TikTok; CANECA-07 fica sem custo.
    banco['c|sku|CAMISA-P'] = { custo: '21,15', outros: '1,20' };
    banco['c|sku|CAMISA-M'] = { custo: 19.99 };
    banco['c|sku|MEIA-01'] = { custo: '3,33', outros: 0.25 };
    banco['c|sku|BONE-02'] = { custo: 12.5, outros: 0.8 };
    banco['c|tiktok|' + SKU_IDS[5]] = { custo: 30.03, outros: 1.1 };
    banco.cfg = { imposto_pct: 6, margem_alvo_pct: 10 };
    const d = await TT.ler(CONTA);
    const vm = TT.resumo(d, { hoje: HOJE });
    ok(respostas > 0 && d.peds.length === gs.length && vm.pedidos.length === gs.length && !vm.vazio, `captura: ${gs.length} pedidos (${linhasFin.length} linhas do Financeiro) gravados por loja e lidos de volta`);

    const porId = {}; vm.pedidos.forEach(x => { porId[x.pedido_id] = x; });
    const L = { repasse: lote(), exato: lote(), estimado: lote(), det: lote(), formato: lote(), dev: lote(), duas: lote() };
    gs.forEach(g => {
        const x = porId[g.id], modo = modos[g.id];
        L.formato.conta(x && ['bruto', 'receita', 'reembolso', 'receita_liquida', 'tarifas_rs', 'repasse', 'custo_rs', 'outros_rs', 'imposto_rs', 'lucro_real'].every(k => dinOk(x[k])), { g: g.id, modo });
        if (modo === 'det') {
            // Só Pedidos: tarifas pela tabela do dia (estimadas), repasse = receita − Σ tabela; nunca entra na conciliação.
            const ls = [].concat.apply([], g.skus.map(s => T.tarifasDoItem('tiktok', (s.unitC * s.qtd - g.descC * s.unitC * s.qtd / g.brutoC) / 100 / s.qtd, { qtd: s.qtd }, g.dia)));
            L.det.conta(x.status !== 'nao_lido' && x.tarifas_estimadas && x.estimado && !x.exato && cent(x.bruto) === g.brutoC && cent(x.receita) === g.brutoC - g.descC
                && cent(x.tarifas_rs) === somaC(ls, l => cent(l.valor)) && cent(x.repasse) === cent(x.receita_liquida) - cent(x.tarifas_rs) && x.status_repasse === null, { g: g.id, x: [x.bruto, x.tarifas_rs, x.repasse] });
            return;
        }
        // Lido no Financeiro (lista, extrato ou os dois; 1 ou 2 linhas): o repasse do Copiloto é o do TikTok, no centavo.
        L.repasse.conta(cent(x.repasse) === repC(g) && cent(x.receita_liquida) - cent(x.tarifas_rs) === repC(g), { g: g.id, modo, repasse: x.repasse, tiktok: repC(g) / 100 });
        if (modo === 'exato' || modo === 'trans') {
            const tp = {}; g.fees.forEach(fe => { tp[fe.tipo] = (tp[fe.tipo] || 0) + fe.c; }); if (g.frete.liq) tp.frete_venda = g.frete.liq;
            L.exato.conta(x.exato && x.tarifas_estimadas === (g.status === 1) && x.estimado === (g.status === 1) && cent(x.bruto) === g.brutoC && cent(x.desconto_vendedor) === g.descC && cent(x.reembolso) === Math.min(g.reembC, g.baseC)
                && Object.keys(tp).every(k => cent(x.tarifas_por_tipo[k]) === tp[k]) && Object.keys(x.tarifas_por_tipo).every(k => k in tp || x.tarifas_por_tipo[k] === 0), { g: g.id, tp, x: x.tarifas_por_tipo });
        } else if (modo === 'lista_det_dev') {
            L.dev.conta(x.status === 'ok' || x.status === 'sem_custo' ? cent(x.reembolso) === g.baseC && x.receita_liquida === 0 && cent(x.repasse) === g.settlementC && x.avisos.some(a => /reembolso total/.test(a)) : false, { g: g.id, x: [x.status, x.reembolso, x.repasse] });
        } else {
            // Só a lista (1 ou 2 linhas): tarifas estimadas pela tabela, o resto em "afiliado/outros" — a soma é o total do TikTok.
            L.estimado.conta(x.tarifas_estimadas && x.estimado && !x.exato && cent(x.tarifas_rs) === ganhoC(g) - repC(g) && (g.frete.liq === 0 || cent(x.tarifas_por_tipo.frete_venda) === g.frete.liq),
                { g: g.id, modo, tarifas: x.tarifas_por_tipo, total: (ganhoC(g) - repC(g)) / 100 });
            if (/lista2/.test(modo)) L.duas.conta(x.extratos.length === 2 && cent(x.receita_liquida) === ganhoC(g) && (modo === 'lista2' || x.avisos.some(a => /cobre só parte/.test(a))), { g: g.id, modo, ext: x.extratos, av: x.avisos });
        }
    });
    okLote(L.formato, 'resultado de cada pedido: dinheiro em centavos ou null (nunca NaN/undefined)');
    okLote(L.repasse, 'pedido lido no Financeiro (lista, extrato, os dois; 1 ou 2 linhas): repasse do Copiloto = Σ settlement do TikTok, no centavo');
    okLote(L.exato, 'com o detalhe do extrato: preço, desconto, reembolso e cada tarifa por tipo (estorno, frete líquido) = os do TikTok; "Est." só quando a liquidar');
    okLote(L.estimado, 'só a lista: Σ tarifas estimadas (tabela + "afiliado/outros") = ganho − repasse do TikTok; frete = o do TikTok');
    okLote(L.duas, 'venda + devolução em 2 extratos: as 2 linhas somadas uma vez; o detalhe só da venda NÃO substitui a lista (avisa "cobre só parte")');
    okLote(L.dev, 'devolução total (lista + Pedidos): reembolso = preço − desconto, receita líquida 0, repasse = o do TikTok (o SFP/frete que ficou), com aviso do custo');
    okLote(L.det, 'só Pedidos: tarifas pela tabela do dia (marcadas estimadas), repasse = receita − Σ tabela, fora da conciliação');

    // Período (30 dias): KPI = Σ dos pedidos ok; conciliação = Σ dos repasses; linha do tempo = Σ a liberar; extratos = Σ pedidos do extrato.
    const desde = U.somaDias(HOJE, -29), mes = vm.pedidos.filter(x => x.dia >= desde && x.dia <= HOJE), okP = mes.filter(x => x.status === 'ok');
    const k = vm.kpis;
    ok(cent(k.lucro_30d) === somaC(okP, x => cent(x.lucro_real)) && cent(k.receita_30d) === somaC(okP, x => cent(x.receita_liquida)) && k.pedidos_30d === mes.length
        && k.margem_pct === Math.round(k.lucro_30d / k.receita_30d * 10000) / 100 && k.sem_custo === mes.filter(x => x.status === 'sem_custo').length && k.sem_custo > 0,
        `KPI: lucro 30 dias = Σ lucro dos ${okP.length} pedidos ok (${SHC.moeda(k.lucro_30d)}), receita = Σ receita líquida, margem = lucro ÷ receita; ${k.sem_custo} sem custo contados à parte`);
    const fin = linhasFin.filter(l => modos[l.id] !== 'det'), libC = somaC(fin.filter(l => l.status === 2), l => l.settlementC), aLibC = somaC(fin.filter(l => l.status === 1), l => l.settlementC);
    ok(cent(vm.conciliacao.recebido) === libC && cent(vm.conciliacao.a_liberar) === aLibC && vm.conciliacao.diferenca === 0 && (vm.conciliacao.por_status.ok || 0) === gs.filter(g => modos[g.id] !== 'det' && g.status === 2).length,
        `conciliação: recebido = Σ linhas liquidadas (${SHC.moeda(libC / 100)}), a liberar = Σ "Est." (${SHC.moeda(aLibC / 100)}), diferença 0 (o esperado de cada pedido é o do TikTok)`);
    // Linha do tempo: cada dia = Σ dos pedidos "a liberar" do resumo com aquela data prevista; nunca mais que o "a liberar" da conciliação.
    const lt = vm.repasse.linha_do_tempo, pendR = vm.pedidos.filter(x => x.status_repasse === 'a_liberar' && x.repasse !== null), porDiaC = {};
    pendR.forEach(x => { const dd = x.data_prevista || 'sem data'; porDiaC[dd] = (porDiaC[dd] || 0) + cent(x.repasse); });
    const soExtrato = gs.filter(g => g.status === 1 && /^trans$/.test(modos[g.id])), ltC = somaC(lt, x => cent(x.valor));
    ok(pendR.length > 0 && lt.every(x => emCentavos(x.valor) && cent(x.valor) === porDiaC[x.dia]) && lt.length === Object.keys(porDiaC).filter(dd => /^\d{4}/.test(dd)).length && ltC <= aLibC
        && pendR.every(x => x.data_prevista === U.somaDias(gs.find(g => g.id === x.pedido_id).entrega, 7)),
        `linha do tempo: cada dia = Σ dos pedidos a liberar com aquela data prevista (${SHC.moeda(ltC / 100)} de ${SHC.moeda(aLibC / 100)}; ${soExtrato.length} "Est." lido(s) só no extrato ficam fora: divergência 10)`);
    const ex = vm.repasse.extratos;
    ok(ex.length === recs.length && ex.every(e => {
        const s = stmts[e.id], lidos = s.filter(naLista);
        return e.conta_fecha === true && cent(e.valor) === somaC(s, l => l.settlementC) && e.pedidos_lidos === lidos.length && (lidos.length ? cent(e.soma_pedidos) === somaC(lidos, l => l.settlementC) : e.soma_pedidos === null)
            && e.pedidos_fecham === (lidos.length ? lidos.length === s.length : null);
    }), 'extratos: valor = Σ repasses das linhas do extrato; Σ das linhas lidas na lista; "fecha" só quando todas foram lidas');
    ok(cent(vm.kpis.a_receber) === somaC(mot) && cent(d.areceber.confere) === 0 && cent(vm.kpis.saldo) === saldoC, 'a receber = Σ motivos (confere 0) e saldo = o do TikTok');
    // Produtos: repasse = receita − tarifas; Σ unidades; Σ lucro = Σ pedidos ok e cancelados, no centavo (também com 2+ SKUs: #32).
    const prods = vm.produtos, okOuC = mes.filter(x => x.status === 'ok' || x.status === 'cancelado');
    ok(prods.every(p => cent(p.repasse) === cent(p.receita) - cent(p.tarifas) && emCentavos(p.lucro_real) && (p.afiliado_pct === null || isFinite(p.afiliado_pct)))
        && somaC(prods, p => p.unidades) === somaC(okP, x => somaC(x.por_item, it => it.qtd)) && somaC(prods, p => cent(p.lucro_real)) === somaC(okOuC, x => cent(x.lucro_real)) && okOuC.some(x => x.por_item.length > 1),
        'produtos: repasse = receita − tarifas; Σ unidades = Σ qtd dos pedidos ok; Σ lucro dos produtos = Σ lucro dos pedidos, no centavo (com pedidos de 2+ SKUs)');
    const okUm = okP.filter(x => x.por_item.length === 1);
    ok(okUm.length > 0 && TT.porProduto(okUm).every(p => { const dele = okUm.filter(x => x.por_item[0].sku === p.sku); return cent(p.lucro_real) === somaC(dele, x => cent(x.lucro_real)) && cent(p.receita) === somaC(dele, x => cent(x.receita_liquida)); }),
        'produtos (pedidos de 1 SKU): lucro e receita do produto = Σ dos pedidos dele, no centavo');
    // Afiliados: comissão paga = Σ (afiliado + afiliado_ads) dos pedidos com o detalhe do extrato, ok, nos 30 dias.
    const exatos = mes.filter(x => x.exato && x.status === 'ok'), afC = somaC(exatos, x => cent((x.tarifas_por_tipo.afiliado || 0) + (x.tarifas_por_tipo.afiliado_ads || 0)));
    ok(cent(vm.afiliados.comissao_rs) === afC && vm.afiliados.pedidos_com_detalhe === exatos.length && afC > 0, `afiliados: comissão paga = Σ afiliado + Shop Ads dos ${exatos.length} pedidos abertos no Financeiro (${SHC.moeda(afC / 100)})`);

    // ── J. Tela ──
    console.log('J. Tela (tiktok-aba.js + SHC.moeda): o texto é o número da conta e as linhas somam');
    const html = ABA.html(vm, { hoje: HOJE, abertos: new Set() });
    ok(!/NaN|undefined|Infinity|null|\[object/.test(html.replace(/data-k="[^"]*"/g, '')), 'a aba inteira sem "NaN", "undefined", "Infinity", "null" nem "[object"');
    const blocos = html.split('<details class="tt-ped" data-k="ped:').slice(1);
    const J = { valores: lote(), repasse: lote(), lucro: lote(), resumo: lote(), ausente: lote() };
    const ROT = {}; Object.keys(ABA.ROT_TARIFA).forEach(t => { ROT[ABA.ROT_TARIFA[t]] = t; });
    blocos.forEach(b => {
        const id = b.slice(0, b.indexOf('"')), x = porId[id], linhas = [];
        b.replace(/<div class="cl[^"]*"><span>(.*?)<\/span><b>(.*?)<\/b><\/div>/g, (m, rot, v) => { linhas.push({ rot: rot.replace(/<[^>]+>/g, '').replace(/\s*estimado$/, '').trim(), c: deMoeda(v), txt: v }); return m; });
        // Cada linha ↔ o campo do resultado (com o sinal da tela: o que sai do vendedor aparece −, estorno +).
        const campo = l => {
            if (l.rot === 'Preço') return (x.faltando || []).indexOf('preco') >= 0 ? null : x.bruto;
            if (l.rot === 'Seu desconto') return -x.desconto_vendedor;
            if (l.rot === 'Reembolso ao cliente') return -x.reembolso;
            if (ROT[l.rot]) return -x.tarifas_por_tipo[ROT[l.rot]];
            if (l.rot === 'Repasse do TikTok') return x.repasse;
            if (l.rot === 'Custo do produto') return x.custo_rs === null ? null : -x.custo_rs;
            if (/^Custo do produto: informe/.test(l.rot) || /^Tarifas: abra/.test(l.rot)) return null;
            if (l.rot === 'Embalagem e outros') return -x.outros_rs;
            if (/^Imposto \(/.test(l.rot)) return -x.imposto_rs;
            if (l.rot === 'Lucro' || l.rot === 'Prejuízo') return x.lucro_real;
            return NaN;
        };
        J.valores.conta(linhas.length >= 3 && linhas.every(l => { const v = campo(l); return v === null ? l.c === null : (typeof v === 'number' && isFinite(v) && l.c === cent(v)); }), { id, linhas, x: [x.bruto, x.repasse, x.lucro_real] });
        // Preço − desconto − reembolso − tarifas = Repasse; Repasse − custo − embalagem − imposto = Lucro (o que a tela mostra fecha).
        const iRep = linhas.findIndex(l => l.rot === 'Repasse do TikTok'), rep = linhas[iRep];
        if (rep && rep.c !== null) J.repasse.conta(somaC(linhas.slice(0, iRep).filter(l => l.c !== null), l => l.c) === rep.c, { id, linhas });
        const luc = linhas.find(l => l.rot === 'Lucro' || l.rot === 'Prejuízo');
        if (luc) J.lucro.conta(rep.c + somaC(linhas.slice(iRep + 1).filter(l => l !== luc && l.c !== null), l => l.c) === luc.c && (luc.rot === 'Prejuízo') === (luc.c < 0), { id, linhas });
        // Resumo da linha: "repasse R$ X" e "Lucro R$ Y (Z%)" / "Prejuízo R$ Y" / "sem custo" / "não lido".
        const sub = (/<small>([^<]*)<\/small>/.exec(b) || [])[1] || '', sob = (/<span class="sobra [^"]*">([^<]*)<\/span>/.exec(b) || [])[1] || '';
        const mrep = /repasse (—|[−]?R\$ [\d.]+,\d\d)/.exec(sub), msob = /^(Lucro|Prejuízo) ([^(]+?)(?: \(([−-]?[\d,]+)%\))?$/.exec(sob);
        J.resumo.conta(mrep && deMoeda(mrep[1]) === (x.repasse === null ? null : cent(x.repasse))
            && (x.lucro_real === null ? sob === (x.status === 'nao_lido' ? 'não lido' : 'sem custo') : msob && (msob[1] === 'Prejuízo' ? -1 : 1) * deMoeda(msob[2]) === cent(x.lucro_real)), { id, sub, sob, lucro: x.lucro_real });
        // Valor ausente: custo não informado aparece "—" e a sobra "sem custo" — nunca "R$ 0,00".
        if (x.custo_rs === null) J.ausente.conta(linhas.some(l => /^Custo do produto: informe/.test(l.rot) && l.txt === '—') && !linhas.some(l => l.rot === 'Lucro' || l.rot === 'Prejuízo') && sob === 'sem custo', { id, linhas });
    });
    ok(blocos.length === vm.pedidos.filter(x => x.dia >= desde && x.dia <= HOJE).length, `um bloco por pedido dos 30 dias (${blocos.length})`);
    okLote(J.valores, 'conta de cada pedido na tela: cada linha = o número do resultado (Preço, desconto, reembolso, tarifas, Repasse, custo, embalagem, imposto, Lucro)');
    okLote(J.repasse, 'na tela: Preço − desconto − reembolso − tarifas (estorno +) = Repasse do TikTok, no centavo');
    okLote(J.lucro, 'na tela: Repasse − custo − embalagem − imposto = Lucro (Prejuízo quando negativo), no centavo');
    okLote(J.resumo, 'resumo de cada pedido: "repasse R$ X" e "Lucro/Prejuízo R$ Y" = os números da conta; sem custo/não lido em texto');
    okLote(J.ausente, 'custo não informado: "—" e "sem custo" (nunca Custo R$ 0,00 nem lucro inventado)');
    const kpiTxt = rot => { const m = new RegExp('<div class="l">' + rot + '</div><div class="v">([^<]*)</div>').exec(html); return m ? m[1] : null; };
    ok(deMoeda(kpiTxt('Lucro 30 dias')) === cent(k.lucro_30d) && deMoeda(kpiTxt('A receber')) === somaC(mot) && deMoeda(kpiTxt('Saldo disponível')) === saldoC
        && kpiTxt('Margem') === String(Math.round(k.margem_pct * 10) / 10).replace('.', ',') + '%', 'KPIs na tela: Lucro 30 dias, A receber, Saldo e Margem = os números do resumo');
    const manchete = (/<p class="manchete">.*?<b>([^<]*)<\/b>/.exec(html) || [])[1] || '';
    ok(new RegExp('^(Lucro|Prejuízo) de ' + reais(Math.abs(cent(k.lucro_30d))).replace(/[$.]/g, '\\$&') + ' em 30 dias no TikTok\\.$').test(manchete), 'manchete: "Lucro de R$ X em 30 dias" = o KPI');
    const tabAr = (/<table class="tb"><tbody>(.*?)<\/tbody><\/table>/.exec(html.slice(html.indexOf('<h3>Repasse</h3>'))) || [])[1] || '';
    const linhasAr = []; tabAr.replace(/<tr><td>(.*?)<\/td><td><b>(.*?)<\/b><\/td><\/tr>/g, (m, a, v) => { linhasAr.push({ a: a.replace(/<[^>]+>/g, ''), c: deMoeda(v) }); return m; });
    const totAr = linhasAr.find(l => l.a === 'A receber'), motAr = linhasAr.filter(l => l.a !== 'A receber' && l.a !== 'Saldo disponível');
    ok(totAr && totAr.c === somaC(mot) && somaC(motAr, l => l.c) === totAr.c && motAr.length === mot.filter(v => v > 0).length, 'Repasse na tela: as linhas por motivo somam o "A receber"');
    const rec = /Recebido: <b>([^<]*)<\/b> · a liberar: <b>([^<]*)<\/b>/.exec(html);
    ok(rec && deMoeda(rec[1]) === libC && deMoeda(rec[2]) === aLibC && !/diferença do esperado/.test(html), 'Recebido e a liberar na tela = Σ da conciliação; sem "diferença do esperado" quando tudo bate');
    const prev = (/Previsto: ([^<]*)<\/p>/.exec(html) || [])[1] || '';
    ok(prev && prev.split(' · ').slice(0, 4).every((p, i) => deMoeda(p.replace(/^\d\d\/\d\d /, '').replace(' …', '')) === cent(lt[i].valor)), 'linha do tempo na tela: "dd/mm R$ X" = o valor de cada dia');
    const exTela = []; html.replace(/<tr><td>[^<]*<span class="sm">[^<]*<\/span><\/td><td>([^<]*)<\/td><td>(.*?)<\/td><\/tr>/g, (m, v, conf) => { exTela.push({ c: deMoeda(v), ok: /selo ok/.test(conf) }); return m; });
    ok(exTela.length === ex.length && exTela.every((e, i) => e.c === cent(ex[i].valor) && e.ok), 'extratos na tela: valor de cada extrato = o do TikTok, todos com ✓');
    const afTela = /Comissão paga em 30 dias: <b>([^<]*)<\/b>/.exec(html);
    ok(afTela && deMoeda(afTela[1]) === cent(vm.afiliados.comissao_rs), 'afiliados na tela: "Comissão paga em 30 dias" = o número do resumo');
    const prodTela = []; html.replace(/<div class="linha-comp"><span class="rlt"><b>[^<]*<\/b><span class="sobra [^"]*">([^<]*)<\/span><\/span><small>([^<]*)<\/small>/g, (m, s, sub) => { prodTela.push({ s, sub }); return m; });
    ok(prodTela.length === prods.length && prodTela.every((pt, i) => {
        const p = prods[i], mr = /receita (−?R\$ [\d.]+,\d\d)/.exec(pt.sub), mp = /repasse (−?R\$ [\d.]+,\d\d)/.exec(pt.sub), ms = /^(Lucro|Prejuízo) ([^(]+?)(?: \(|$)/.exec(pt.s);
        return p.pedidos ? mr && mp && ms && deMoeda(mr[1]) === cent(p.receita) && deMoeda(mp[1]) === cent(p.repasse) && (ms[1] === 'Prejuízo' ? -1 : 1) * deMoeda(ms[2]) === cent(p.lucro_real) : pt.s === 'sem custo';
    }), 'produtos na tela: receita, repasse e Lucro/Prejuízo = os números de cada produto');

    // Valor ausente no resumo inteiro: sem a receber/saldo/lucro → "—" (nunca "R$ 0,00").
    const vazio = TT.resumo({ conta: CONTA, peds: [], custos: {}, cfg: {}, falha: { tipo: 'saldo', tela: 'Financeiro', em: lidoEm } }, { hoje: HOJE });
    const hv = ABA.html(vazio, { hoje: HOJE });
    const hvSemRecebido = hv.replace(/<p class="rs">Recebido: <b>R\$ 0,00<\/b> · a liberar: <b>R\$ 0,00<\/b><\/p>/, '');
    ok(vazio.kpis.lucro_30d === null && vazio.kpis.a_receber === null && vazio.kpis.saldo === null && /<div class="l">Lucro 30 dias<\/div><div class="v">—<\/div>/.test(hv)
        && /<div class="l">A receber<\/div><div class="v">—<\/div>/.test(hv) && /<div class="l">Saldo disponível<\/div><div class="v">—<\/div>/.test(hv) && !/R\$ 0,00/.test(hvSemRecebido),
        'nada lido: Lucro, A receber e Saldo aparecem "—" (o único R$ 0,00 é o "Recebido · a liberar" da divergência 9)');
    // Resposta que não se reconhece não grava nada (nunca vira zero).
    const antes = JSON.stringify(banco);
    const rr = await TT.gravarCaptura('saldo', { code: 0, data: { amount: { amount: 'abc' } } }, CONTA, lidoEm), r2x = await TT.gravarCaptura('pedidos_fin', { code: 0, data: {} }, CONTA, lidoEm);
    const semFalha = JSON.parse(antes); delete semFalha['tt:' + CONTA + ':falha'];
    const depois = JSON.parse(JSON.stringify(banco)); delete depois['tt:' + CONTA + ':falha'];
    ok(rr.ok === false && r2x.ok === false && JSON.stringify(depois) === JSON.stringify(semFalha) && (await TT.ler(CONTA)).saldo.valor === saldoC / 100,
        'resposta ilegível (saldo "abc", lista vazia): nada gravado — o saldo continua o lido antes, nunca R$ 0,00');

    // ── K. Casos da correção dos centavos (TikTok e núcleo, #33–#39): da captura à tela, com dados inventados ──
    console.log('K. Correções do TikTok na extensão: captura → resumo → tela');
    // Linhas da conta de um pedido na tela (rótulo, centavos) e o card inteiro; mesmas regras da seção J.
    const contaTela = (h, id) => {
        const i = h.indexOf('data-k="ped:' + id + '"'), b = i < 0 ? '' : h.slice(i, h.indexOf('</details>', i)), ls = [];
        b.replace(/<div class="cl[^"]*"><span>(.*?)<\/span><b>(.*?)<\/b><\/div>/g, (m, rot, v) => { ls.push({ rot: rot.replace(/<[^>]+>/g, '').replace(/\s*estimado$/, '').trim(), c: deMoeda(v) }); return m; });
        return ls;
    };
    const valorDe = (ls, rot) => (ls.find(l => l.rot === rot) || {}).c;
    {   // #33: GMV Pay no extrato do pedido (fixture de suposição) + o detalhe em Pedidos com o SKU (custo R$ 10, imposto 6% do cfg).
        const C33 = '7000000033', fx = require(path.join(RAIZ, 'copiloto-nucleo', 'testes', 'fixtures', 'tarifa_gmv_pay_suposicao.json'));
        await TT.gravarCaptura('transacao', fx, C33, lidoEm);
        await TT.gravarCaptura('pedido', { code: 0, data: { main_order: { main_order_id: '5770000000000000900', main_order_create_time: segDia('2026-09-29'),
            payment_info: { main_order_origin_sale_price: fp(10000), subtotal: fp(10000), seller_discount_total: fp(0), platform_discount_total: fp(0) },
            skus: [{ seller_sku_name: 'GMV-01', sku_id: '1730000000000000933', quantity: 1, product_name: 'Produto GMV', total_price: fp(10000), sku_display_status: 122 }],
            logistic_info: { title: 'Package delivered', time: segDia('2026-09-30') } } } }, C33, lidoEm);
        banco['c|sku|GMV-01'] = { custo: 10 };
        const v33 = TT.resumo(await TT.ler(C33), { hoje: '2026-10-07' }), p33 = v33.pedidos[0], h33 = ABA.html(v33, { hoje: '2026-10-07' }), ls = contaTela(h33, p33.pedido_id);
        const iRep = ls.findIndex(l => l.rot === 'Repasse do TikTok'), luc = ls.find(l => l.rot === 'Lucro');
        const prod = v33.produtos[0], subProd = (/<small>(SKU GMV-01[^<]*)<\/small>/.exec(h33) || [])[1] || '';
        ok(p33.exato && p33.repasse === 54 && p33.ads_no_repasse === 30 && p33.lucro_real === 38 && v33.conciliacao.diferenca === 0 && v33.conciliacao.por_status.ok === 1
            && valorDe(ls, 'Ads pago com o repasse') === -3000 && valorDe(ls, 'Repasse do TikTok') === 5400 && somaC(ls.slice(0, iRep), l => l.c) === 5400
            && luc && luc.c === 3800 && 5400 + somaC(ls.slice(iRep + 1).filter(l => l !== luc), l => l.c) === 3800 && !/diferença do esperado/.test(h33)
            && cent(prod.repasse) === 5400 && /repasse R\$ 54,00/.test(subProd),
            'GMV Pay na tela (#33): "Ads pago com o repasse −R$ 30,00", Repasse R$ 54,00 = o que o TikTok pagou (antes R$ 84,00 e "a menor" −R$ 30,00); Preço − tarifas − Ads = Repasse; Repasse − custo − imposto = Lucro R$ 38,00; produto com repasse R$ 54,00');
    }

    {   // #34: o extrato do pedido com o custo do frete vazio ({amount:""}), settlement R$ 80,00 e o cliente pagou R$ 12,00.
        const C34 = '7000000034', a34 = v => ({ amount: v, currency: 'BRL' }), id34 = '5770000000000000800';
        const ext34 = { code: 0, data: { order_record: { statement_detail_id: '5770000000000000801', statement_id: '8800000034', trade_order_id: id34, placed_time: msDia('2026-09-20'), settlement_status: 2,
            settlement_time: msDia('2026-09-24'), settlement_amount: a34('80.00'), in_come: { fee_list: [{ type: 'subtotal_before_discount', amount: a34('100.00') }] },
            out_come: { fee_list: [{ type: 'platform_commission', amount: a34('-6.00') }, { type: 'sfp_service_fee', amount: a34('-6.00') }] },
            shipping_fee_detail: { fee_list: [{ type: 'fbm_shipping_fee', amount: a34('') }, { type: 'x', starling: { starling_key: 'customer_shipping_payment' }, amount: a34('12.00') }] } } } };
        await TT.gravarCaptura('transacao', ext34, C34, lidoEm);
        const v34 = TT.resumo(await TT.ler(C34), { hoje: '2026-09-25' }), p34 = v34.pedidos[0], h34 = ABA.html(v34, { hoje: '2026-09-25' }), ls34 = contaTela(h34, id34);
        const sob34 = (new RegExp('data-k="ped:' + id34 + '"><summary><span class="rlt"><b>[^<]*</b><span class="sobra [^"]*">([^<]*)<').exec(h34) || [])[1];
        ok(p34.status === 'nao_lido' && !p34.exato && p34.repasse === null && p34.lucro_real === null && p34.avisos.some(a => /ilegível/.test(a)) && p34.avisos.some(a => /^frete sem valor/.test(a))
            && Object.keys(v34.conciliacao.por_status).length === 0 && sob34 === 'não lido' && valorDe(ls34, 'Repasse do TikTok') === null && valorDe(ls34, 'Preço') === 10000
            && !/R\$ 0,00/.test(h34.slice(h34.indexOf('data-k="ped:' + id34), h34.indexOf('</details>', h34.indexOf('data-k="ped:' + id34))))
            && v34.kpis.nao_lidos === 1,
            'extrato com frete vazio e sem a lista (#34): o pedido fica "não lido" (Repasse "—", nada de R$ 100,00 nem "a menor" −R$ 20,00 falso), com o aviso do núcleo');
        // Com a lista do Financeiro do mesmo pedido: vale a lista (repasse = o do TikTok, tarifas estimadas), nunca o detalhe ilegível.
        await TT.gravarCaptura('pedidos_fin', { code: 0, data: { order_records: [{ trade_order_id: id34, statement_detail_id: '5770000000000000801', statement_id: '8800000034', placed_time: msDia('2026-09-20'),
            delivery_time: msDia('2026-09-21'), settlement_status: 2, settlement_time: msDia('2026-09-24'), earning_amount: a34('100.00'), fees: a34('-12.00'), shipping_amount: a34('-8.00'),
            settlement_amount: a34('80.00'), sku_records: [{ sku_id: '1730000000000000934', quantity: 1, product_name: 'Produto 34', earning_amount: a34('100.00') }] }] } }, C34, lidoEm);
        const q34 = TT.resumo(await TT.ler(C34), { hoje: '2026-09-25' }), r34 = q34.pedidos[0];
        ok(!r34.exato && r34.estimado && r34.repasse === 80 && r34.tarifas_por_tipo.frete_venda === 8 && r34.avisos.some(a => /ilegível/.test(a)) && q34.conciliacao.diferenca === 0 && q34.conciliacao.por_status.ok === 1,
            'o mesmo pedido com a lista do Financeiro (#34): vale a lista — repasse R$ 80,00 = o do TikTok, frete R$ 8,00, "estimado", conciliação ok');
    }

    console.log('\n' + nChecks + ' verificações.');
    if (f) { console.log(f + ' FALHA(S)'); process.exit(1); }
    console.log('TUDO OK');
})().catch(e => { console.error(e); process.exit(1); });
