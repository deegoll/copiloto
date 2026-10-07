// Centavos do lucro por anúncio e das etiquetas (pedido da dona: "cada centavo tem que bater, a tela tem que bater 100%").
// Prova, só com dados inventados, que cada conta de dinheiro do anúncio fecha no centavo e que o texto da tela (SHC.moeda/SHC.pctTxt) é o
// número da conta:
//   A. régua: SHC.r2 (erro ≤ meio centavo, não mexe em valor de 2 casas) e SHC.moeda (lido de volta = o número; vazio = "—");
//   B. SHC.calcular (ML) à mão: recebe = preço − comissão − taxa fixa − frete; sobra = recebe − custo − outros − imposto; faixas da taxa fixa;
//      frete do comprador abaixo de R$ 79; custo/preço ausente nunca vira R$ 0,00;
//   C. SHC.calcular (ML) gerado: as mesmas contas em centavos inteiros, a margem e a calculadora do popup (os textos somam a sobra);
//   D. Shopee: SHC.calcular('sp') = CopilotoNucleo.tarifas.simular (repasse, lucro, tarifas), com e sem a tabela;
//   E. SHC.precoMinimo (ML e Shopee) contra a busca centavo a centavo com o próprio SHC.calcular;
//   F. kits (store.js): custo = Σ componente × q (+ outros do kit), incompleto = sem custo, digitado ganha, P.linhasKits, SHC.custosDe;
//   G. lista de Anúncios (SHC.mlAnunciosDoEstado) → balão "Resultado de 1 venda" (SHC.telaAnuncioLinhas) → etiqueta (SHC.sobraAnuncio,
//      SHC.telaChip, SHC.telaResultado, SHC.telaExplica): preço − tarifa − frete − custo operacional = você recebe; − custo − outros − imposto = sobra;
//   H. atacado (SHC.sobraAtacado, SHC.telaAtacadoLinhas, chip "Lucro R$ X/un."): as duas colunas (por unidade e pedido de N un.) fecham;
//   I. promoções (SHC.mlPromosDoEstado, SHC.sobraProposta, SHC.recomendaPromo, SHC.telaVeredito, P.explicaPromo, SHC.roboPromoSugestoes,
//      SHC.canalLucro);
//   J. catálogo e opções de compra (SHC.telaCatalogo, SHC.compCatAcoes, SHC.telaOpcoesCompra, P.resumoSku, SHC.adsEquilibrio).
// Casos gerados com semente fixa (LCG): o resultado é o mesmo em toda execução (nada de Math.random).
// Divergências achadas nesta auditoria (fora deste teste para a suíte seguir verde; repro no relatório da tarefa):
//   1) SHC.precoMinimo (calc.js): o 1º preço testado não passa por r2 → às vezes devolve um preço 1 centavo abaixo da meta (a R$ 163,30
//      sobram R$ 8,16 e 5% são R$ 8,17) ou alguns centavos acima do menor (273,41 em vez de 273,40). O CopilotoNucleo.tarifas.precoMinimo acerta.
//   2) [corrigida, #9] SHC.calcular: a classe usava a margem JÁ arredondada: prejuízo pequeno (−R$ 0,07 em R$ 227,15 = −0,03% → "−0") virava
//      "lucrativo"/"apertado" e 9,98% passava na meta de 10%. Agora compara sem arredondar, como SHC.sobraAnuncio/sobraProposta (B e C).
//   3) [corrigida, #11] Custo/outros/frete digitados com 3+ casas ("12,345": etiqueta, painel, planilha) entravam crus na conta; a tela mostrava
//      o arredondado e as linhas não fechavam (1 centavo). SHC.kitDe arredondava com Math.round(x*100)/100 (1,005 → 1,00). Agora entram e são
//      gravados em centavos (SHC.r2): SHC.calcular, sobraAnuncio/Atacado/Proposta, kitDe, salvarCustoSku, lerTabela e a etiqueta (B, C, F, G).
//   4) [corrigida, #4/#13/#36] SHC.r2 não arredondava o meio centavo do mesmo jeito: r2(2,145) = 2,15 mas r2(2,175) = 2,17 (imposto de 6% em
//      R$ 36,25) e r2(−1,285) = −1,28; SHC.moeda(2,175) mostrava "R$ 2,18". Agora r2, o r2 do núcleo e o SHC.moeda: meio centavo para longe do zero (A).
//   5) SHC.recomendaPromo: precoMeta (fórmula fechada) erra até 2 centavos (≈12% dos casos fica 1 centavo abaixo da meta); e a proposta
//      sem a tarifa do ML (sale_fee) vira tarifa 0% no preço mínimo para a meta.
//   6) Balão da lista de Anúncios: "Você recebe" maior que preço − tarifa (aporte do ML) → frete deduzido 0 e a conta não fecha; tarifa não
//      lida → "Frete por sua conta − R$ 0,00" inventado.
//   7) SHC.calcular: frete grátis sem valor (≥ R$ 79 ou Full) entra como R$ 0,00 e a sobra sai como número firme (só com "⚠").
//   8) SHC.valorRS/dinheiro tiram o sinal: "Você recebe −R$ 63,00" (frete grátis maior que preço − tarifa) é lido +63 e a etiqueta diz "Dá lucro".
//   9) painel.js: "✓ Kit salvo: R$ X" mostra o custo SEM embalagem/outros; a tabela de kits mostra custo + outros.
//  10) Abaixo de R$ 79: SHC.calcular (popup) usa a taxa fixa por faixa (9,50) e SHC.canalLucro a % + o custo operacional do anúncio.
// Rodar: node tests/copiloto/teste_centavos_lucro.js
'use strict';
require('./relogio').fixar();
const path = require('path');
// chrome.storage.local de mentira, com memória (SHC.custosDe, SHC.salvarKit e SHC.lerKits leem e gravam de verdade).
const banco = {};
const copia = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
global.chrome = { storage: { local: {
    get: async k => { const o = {}; (k === null || k === undefined ? Object.keys(banco) : [].concat(k)).forEach(x => { if (x in banco) o[x] = copia(banco[x]); }); return o; },
    set: async o => { Object.keys(o).forEach(k => { banco[k] = copia(o[k]); }); },
    remove: async k => { [].concat(k).forEach(x => delete banco[x]); } } }, runtime: { sendMessage: async () => ({}) } };
const EXT = path.join(__dirname, '../../extension-copiloto');
const SHC = require(path.join(EXT, 'calc.js'));
['store.js', 'ml-extrator.js', 'ml-tela.js', 'fechamento.js', 'painel-lateral.js', 'agenda-canal.js'].forEach(a => require(path.join(EXT, a)));
const PN = require(path.join(EXT, 'painel.js'));   // P do painel.html (P.linhasKits); a parte de tela só roda com document
const TARIFAS = require(path.join(EXT, 'nucleo/tarifas.js'));
global.CopilotoNucleo = { tarifas: TARIFAS };      // como no navegador: o calc.js lê a tabela da Shopee na hora da conta
const P = SHC.pl, r2 = SHC.r2;
let f = 0, nChecks = 0;
const ok = (c, m) => { nChecks++; console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) f++; };

// ── Régua independente do produto: centavos INTEIROS ──
const cent = v => Math.round(v * 100);   // só para valor que já deveria ter 2 casas (emCentavos prova isso)
const emCentavos = v => typeof v === 'number' && isFinite(v) && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
// O R$ que a tela TEM de mostrar, montado só com inteiros: "R$ 1.234,56", "−R$ 0,05".
const reais = c => { const a = Math.abs(c); return (c < 0 ? '−' : '') + 'R$ ' + String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + String(a % 100).padStart(2, '0'); };
// Texto da tela → centavos inteiros ("R$ 1.234,56" → 123456; "−R$ 5,28" → −528; outra coisa → NaN).
const deMoeda = t => { const m = /^(−?)R\$\s(\d{1,3}(?:\.\d{3})*),(\d\d)$/.exec(String(t).trim()); return m ? (m[1] ? -1 : 1) * (Number(m[2].replace(/\./g, '')) * 100 + Number(m[3])) : NaN; };
// "25,5%" / "−0,03%" → número.
const dePct = t => { const m = /^(−?)([\d.]+(?:,\d+)?)%$/.exec(String(t).trim()); return m ? (m[1] ? -1 : 1) * Number(m[2].replace(/\./g, '').replace(',', '.')) : NaN; };
// Gerador com semente fixa (LCG de Numerical Recipes).
const lcg = s => { let x = s >>> 0; return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296; };
const ent = (r, a, b) => a + Math.floor(r() * (b - a + 1));
const um = (r, xs) => xs[ent(r, 0, xs.length - 1)];
const din = (r, a, b) => ent(r, Math.round(a * 100), Math.round(b * 100)) / 100;   // R$ com 2 casas entre a e b
// Conferência em lote: conta os casos e guarda o 1º que falhou (vira o repro).
const lote = () => { const o = { n: 0, ruim: null, conta(c, ex) { o.n++; if (!c && !o.ruim) o.ruim = ex === undefined ? '(sem detalhe)' : ex; return c; } }; return o; };
const okLote = (l, m) => ok(!l.ruim && l.n > 0, m + ` (${l.n} conferências)` + (l.ruim ? ' — 1º caso: ' + JSON.stringify(l.ruim).slice(0, 600) : ''));
const NADA = [null, undefined, NaN, Infinity, -Infinity];
// Linhas de uma conta [{v, neg}] → centavos com sinal (neg = sai do valor).
const somaLinhas = ls => ls.reduce((s, l) => s + (l.neg ? -1 : 1) * cent(l.v), 0);

console.log('A. Régua dos centavos: SHC.r2 e SHC.moeda (o texto da tela é o número da conta)');
{
    const r = lcg(20261007), a = lote(), e = lote();
    for (let i = 0; i < 3000; i++) {
        const c = (i % 3 ? ent(r, -99999999, 99999999) : 0) + ent(r, -9999, 9999);
        a.conta(deMoeda(SHC.moeda(c / 100)) === c && SHC.moeda(c / 100) === reais(c) && r2(c / 100) === c / 100, { c, tela: SHC.moeda(c / 100) });
        const v = ent(r, -9999999, 9999999) / 10000;   // 4 casas (custo de planilha, % sobre preço)
        e.conta(emCentavos(r2(v)) && Math.abs(r2(v) - v) <= 0.005 + 1e-9, { v, r2: r2(v) });
    }
    okLote(a, 'SHC.moeda(c/100) lido de volta = c (milhar com ponto, vírgula, "−" no negativo) e r2 não mexe em valor de 2 casas');
    okLote(e, 'SHC.r2 de valor com 4 casas fica em centavos e a no máximo meio centavo do valor (nunca perde 1 centavo inteiro)');
    ok(NADA.every(v => SHC.moeda(v) === '—'), 'null, undefined, NaN e ±Infinity viram "—" (nunca "R$ NaN" nem "R$ 0,00")');
    ok(SHC.moeda(-0) === 'R$ 0,00' && SHC.moeda(r2(-0.004)) === 'R$ 0,00' && SHC.moeda(-0.01) === '−R$ 0,01', 'zero negativo aparece como R$ 0,00 (sem "−"); −0,01 mantém o sinal');
    ok(SHC.pctTxt(25.5) === '25,5%' && SHC.pctTxt(-5.94) === '−5,9%' && SHC.pctTxt(0.034) === '0,03%' && SHC.pctTxt(-0.001) === '0%', 'SHC.pctTxt: 1 casa, 2 casas abaixo de 1%, "−0%" nunca aparece');
    // #4/#13/#36: meio centavo sempre para longe do zero e igual nos dois sinais — SHC.r2, o r2 do núcleo (as 2 cópias) e o SHC.moeda.
    const U1 = require(path.join(EXT, 'nucleo/util.js')), U2 = require(path.join(__dirname, '../../copiloto-nucleo/src/util.js'));
    const meios = [[2.135, 2.14], [-1.285, -1.29], [1.285, 1.29], [16.935, 16.94], [1.005, 1.01], [2.175, 2.18], [2.145, 2.15], [-2.175, -2.18], [0.005, 0.01], [-0.005, -0.01],
        [617.135, 617.14], [36.25 * 6 / 100, 2.18], [282.25 * 6 / 100, 16.94], [42.7 * 5 / 100, 2.14], [1012.06 / 28, 36.15], [1000000.005, 1000000.01]];
    ok(meios.every(([v, e]) => r2(v) === e && U1.r2(v) === e && U2.r2(v) === e && SHC.moeda(v) === reais(Math.round(e * 100))),
        'meio centavo: 2,135 → 2,14; −1,285 → −1,29; 16,935 → 16,94; 1,005 → 1,01; 6% de 36,25 → 2,18; 1.012,06 ÷ 28 → 36,15 (r2, núcleo e SHC.moeda iguais)');
    ok([-0.004, -0.0049, -1e-9, -0].every(v => Object.is(r2(v), 0) && Object.is(U1.r2(v), 0)) && SHC.moeda(-0.004) === 'R$ 0,00' && r2(null) === 0 && Number.isNaN(r2(undefined)) && U1.r2(null) === null,
        'r2 nunca devolve −0 e SHC.moeda(−0,004) é "R$ 0,00" (nunca "−R$ 0,00"); r2(null) = 0 e r2(undefined) = NaN como antes; núcleo: null');
    // Imposto/tarifa = preço × % ÷ 100 (a conta do produto) contra o arredondamento comercial exato em inteiros (BigInt), positivo e negativo.
    const rm = lcg(36), M2 = lote(), T2 = lote();
    let empates = 0;
    for (const p100 of [400, 500, 600, 650, 800, 950, 1133, 1333, 1650])
        for (let c = 1; c < 40000; c++) {
            const v = c / 100 * (p100 / 100) / 100, n = BigInt(c) * BigInt(p100), q = n / 10000n, ex = Number(n % 10000n * 2n >= 10000n ? q + 1n : q);
            if (n % 10000n === 5000n) empates++;
            const bom = Math.round(r2(v) * 100) === ex && r2(-v) === -r2(v) && U1.r2(v) === r2(v) && U1.r2(-v) === -r2(v);
            M2.conta(bom, bom || { c, pct: p100 / 100, v, r2: r2(v), menos: r2(-v), nucleo: U1.r2(v), esperado: ex / 100 });
        }
    for (let i = 0; i < 4000; i++) {
        const c = ent(rm, 1, 99999999), p100 = um(rm, [500, 600, 1333]), v = c / 100 * (p100 / 100) / 100, n = BigInt(c) * BigInt(p100), q = n / 10000n, ex = Number(n % 10000n * 2n >= 10000n ? q + 1n : q);
        T2.conta(SHC.moeda(v) === reais(ex) && SHC.moeda(-v) === reais(-ex) && SHC.moeda(v) === SHC.moeda(r2(v)), { c, v, tela: SHC.moeda(v), esperado: reais(ex) });
    }
    okLote(M2, `% de 4 a 16,5 sobre R$ 0,01 a R$ 399,99 (${empates} empates de meio centavo): r2 = arredondamento comercial exato, r2(−v) = −r2(v), núcleo = SHC.r2`);
    okLote(T2, 'SHC.moeda(v) = o mesmo arredondamento do r2 (a tela e a conta nunca ficam 1 centavo longe), nos dois sinais');
}

console.log('B. SHC.calcular (Mercado Livre) — casos feitos à mão');
{
    const cfg = { imposto_pct: 6, margem_alvo_pct: 10 };
    const c1 = SHC.calcular('ml', 100, { custo: 40, outros: 2.5, frete: 25, tipo: 'classico' }, cfg);
    ok(c1.preco === 100 && c1.comissao_pct === 13 && c1.comissao_rs === 13 && c1.taxa_fixa_rs === 0 && c1.frete_rs === 25 && c1.recebe_rs === 62
        && c1.imposto_rs === 6 && c1.custo_rs === 40 && c1.outros_rs === 2.5 && c1.sobra_rs === 13.5 && c1.sobra_pct === 13.5 && c1.classe === 'lucrativo',
        'R$ 100 Clássico, frete 25: recebe 100 − 13 − 0 − 25 = 62,00; sobra 62 − 40 − 2,50 − 6,00 (6%) = 13,50 (13,5%)');
    const c2 = SHC.calcular('ml', 50, { custo: 20, frete: 25 }, cfg);
    ok(c2.frete_rs === 0 && /Comprador paga/.test(c2.frete_regra) && c2.taxa_fixa_rs === 9.5 && c2.comissao_rs === 6.5 && c2.recebe_rs === 34 && c2.imposto_rs === 3 && c2.sobra_rs === 11 && c2.sobra_pct === 22,
        'R$ 50 (abaixo de R$ 79): o comprador paga o frete (o informado não entra), taxa fixa 9,50 → recebe 34,00, sobra 11,00');
    const c3 = SHC.calcular('ml', 50, { custo: 20, frete: 12, full: true }, cfg);
    ok(c3.frete_rs === 12 && c3.recebe_rs === 22 && c3.sobra_rs === -1 && c3.sobra_pct === -2 && c3.classe === 'prejuizo',
        'Full abaixo de R$ 79: o frete informado entra (50 − 6,50 − 9,50 − 12 = 22,00); sobra −1,00 é prejuízo (sinal negativo)');
    const c4 = SHC.calcular('ml', 68.44, { custo: 30, tipo: 'premium' }, {});
    ok(c4.comissao_pct === 16.5 && c4.comissao_rs === 11.29 && c4.taxa_fixa_rs === 9.5 && c4.recebe_rs === 47.65 && c4.sobra_rs === 17.65 && c4.imposto_rs === 0,
        'Premium 16,5% de 68,44 = 11,2926 → 11,29; recebe 68,44 − 11,29 − 9,50 = 47,65');
    const fx = [[0.5, 0.25], [12.48, 6.24], [12.5, 6], [18.99, 6], [19, 7.5], [48.99, 7.5], [49, 9.5], [78.99, 9.5], [79, 0], [1500, 0]];
    ok(fx.every(([p, t]) => SHC.taxaFixaML(p) === t && SHC.calcular('ml', p, {}, {}).taxa_fixa_rs === t),
        'taxa fixa por faixa: metade do preço abaixo de 12,50; 6,00 até 18,99; 7,50 até 48,99; 9,50 até 78,99; 0 a partir de 79');
    const semCusto = [{}, { custo: 0 }, { custo: '' }, { custo: 'abc' }, { custo: -5 }, { custo: null }].map(it => SHC.calcular('ml', 120, Object.assign({ frete: 20 }, it), cfg));
    ok(semCusto.every(c => c.sobra_rs === null && c.custo_rs === null && c.sobra_pct === null && c.classe === 'sem_custo' && c.recebe_rs === 84.4 && SHC.moeda(c.sobra_rs) === '—'),
        'sem custo (vazio, 0, texto, negativo): sobra null ("—"), nunca R$ 0,00; o "você recebe" (84,40) continua valendo');
    ok([0, -1, '', null, undefined, 'abc', NaN, Infinity, '1,2,3', '1.234.5'].every(p => SHC.calcular('ml', p, { custo: 10 }, cfg) === null), 'preço 0, negativo, vazio ou que não é número: sem conta (null), nunca R$ 0,00');
    const c5 = SHC.calcular('ml', '1.234,56', { custo: '500,00', frete: 'R$ 45,35' }, cfg);
    ok(c5.preco === 1234.56 && c5.comissao_rs === 160.49 && c5.frete_rs === 45.35 && c5.recebe_rs === 1028.72 && c5.imposto_rs === 74.07 && c5.sobra_rs === 454.65,
        'preço, custo e frete no jeito brasileiro ("1.234,56", "R$ 45,35"): 1.234,56 − 160,49 − 45,35 = 1.028,72; − 500 − 74,07 = 454,65');
    const c6 = SHC.calcular('ml', 150, { custo: 50 }, cfg), c7 = SHC.calcular('ml', 150, { custo: 50 }, Object.assign({ ml_frete_padrao: 22.9 }, cfg));
    ok(c6.frete_desconhecido === true && /informe/i.test(c6.frete_regra) && c7.frete_desconhecido === false && c7.frete_rs === 22.9 && c7.recebe_rs === 107.6,
        'frete grátis sem valor: marcado como desconhecido (a tela avisa "⚠"); com o frete médio das configurações (22,90) ele entra na conta');
    const c8 = SHC.calcular('ml', 200, { custo: 50, frete: 30, comissao_pct: 11.5 }, cfg), c9 = SHC.calcular('ml', 200, { custo: 50, frete: 30, comissao_pct: 0 }, cfg),
        c10 = SHC.calcular('ml', 200, { custo: 50, frete: 30, comissao_pct: -3 }, cfg);
    ok(c8.comissao_rs === 23 && c8.recebe_rs === 147 && c9.comissao_rs === 0 && c9.recebe_rs === 170 && c10.comissao_pct === 13 && c10.comissao_rs === 26,
        'comissão do anúncio (11,5%) ganha da configuração; 0% informado vale 0; negativa é ignorada (volta para os 13%)');
    const c11 = SHC.calcular('ml', 100, { custo: 95, frete: 25 }, cfg);
    ok(c11.recebe_rs === 62 && c11.sobra_rs === -39 && c11.sobra_pct === -39 && c11.classe === 'prejuizo' && SHC.moeda(c11.sobra_rs) === '−R$ 39,00'
        && [c11.comissao_rs, c11.taxa_fixa_rs, c11.frete_rs, c11.imposto_rs, c11.custo_rs, c11.outros_rs].every(v => v >= 0),
        'prejuízo: 62,00 − 95,00 − 6,00 = −R$ 39,00 (sinal negativo) e todos os custos positivos (o sinal fica só no resultado)');
    // #9: a classe vem da sobra e da margem sem arredondar; o % da tela tem 1 casa e nunca é −0.
    const c12 = SHC.calcular('ml', 227.15, { custo: 177.69, frete: 20 }, { margem_alvo_pct: 0 }), c13 = SHC.calcular('ml', 227.15, { custo: 177.69, frete: 20 }, { margem_alvo_pct: 5 });
    const c14 = SHC.calcular('ml', 183.93, { custo: 121.67, frete: 20 }, { margem_alvo_pct: 10 }), c15 = SHC.calcular('ml', 183.93, { custo: 121.67, frete: 20 }, { margem_alvo_pct: 9.97 });
    ok(c12.sobra_rs === -0.07 && Object.is(c12.sobra_pct, 0) && c12.classe === 'prejuizo' && c13.classe === 'prejuizo'
        && c14.sobra_rs === 18.35 && c14.sobra_pct === 10 && c14.classe === 'apertado' && c15.classe === 'lucrativo',
        'R$ 227,15 com sobra −R$ 0,07 (−0,03%, a tela mostra 0%) é prejuízo; margem de 9,977% (a tela mostra 10%) fica abaixo da meta de 10% e passa na de 9,97%');
    // #11: custo, outros e frete com 3+ casas entram em centavos (o que a tela mostra), e as linhas fecham com o resultado.
    const c16 = SHC.calcular('ml', 100, { custo: 10, frete: 12.345 }, {}), c17 = SHC.calcular('ml', 100, { custo: '10,004', outros: 10.004 }, {}), c18 = SHC.calcular('ml', 100, { custo: 1.005 }, {});
    const c19 = SHC.calcular('ml', 150, { custo: 50 }, { ml_frete_padrao: '22,905' });
    ok(c16.frete_rs === 12.35 && c16.recebe_rs === 74.65 && c17.custo_rs === 10 && c17.outros_rs === 10 && c17.recebe_rs === 87 && c17.sobra_rs === 67
        && c18.custo_rs === 1.01 && c18.sobra_rs === 85.99 && c19.frete_rs === 22.91 && c19.recebe_rs === 107.59,
        'frete 12,345 → 12,35 e recebe 100 − 13 − 12,35 = 74,65; custo e outros 10,004 → 10,00 e sobra 87 − 10 − 10 = 67,00; custo 1,005 → 1,01 (sobra 85,99); frete médio 22,905 → 22,91');
}

console.log('C. SHC.calcular (Mercado Livre) — casos gerados: as contas em centavos inteiros e a calculadora do popup');
{
    const r = lcg(4401), L = lote(), M = lote(), K = lote(), T = lote(), S = lote();
    for (let i = 0; i < 4000; i++) {
        const preco = um(r, [din(r, 0.5, 12.49), din(r, 12.5, 78.99), din(r, 79, 400), din(r, 400, 9999.99)]);
        const tipo = um(r, ['classico', 'premium']), full = r() < 0.2;
        const item = { custo: r() < 0.9 ? din(r, 0.5, 3000) : null, outros: r() < 0.3 ? din(r, 0, 25) : 0, frete: r() < 0.7 ? din(r, 0, 80) : null, tipo, full,
            comissao_pct: r() < 0.25 ? ent(r, 50, 220) / 10 : undefined };
        const cfg = { imposto_pct: um(r, [0, 4, 6, 9.5, 13.33]), margem_alvo_pct: um(r, [0, 5, 10, 20]), ml_frete_padrao: r() < 0.2 ? din(r, 10, 40) : 0 };
        const c = SHC.calcular('ml', preco, item, cfg);
        const pct = item.comissao_pct !== undefined ? item.comissao_pct : (tipo === 'premium' ? 16.5 : 13);
        const vals = [c.preco, c.comissao_rs, c.taxa_fixa_rs, c.frete_rs, c.imposto_rs, c.recebe_rs, c.outros_rs].concat(c.custo_rs === null ? [] : [c.custo_rs, c.sobra_rs]);
        L.conta(vals.every(emCentavos) && cent(c.recebe_rs) === cent(c.preco) - cent(c.comissao_rs) - cent(c.taxa_fixa_rs) - cent(c.frete_rs)
            && (c.custo_rs === null ? c.sobra_rs === null : cent(c.sobra_rs) === cent(c.recebe_rs) - cent(c.custo_rs) - cent(c.outros_rs) - cent(c.imposto_rs)), { preco, item, cfg, c });
        // Arredondamento: cada parte fica a no máximo meio centavo da conta exata; frete do comprador abaixo de R$ 79 (fora do Full).
        const freteEsp = !full && preco < 79 ? 0 : item.frete !== null ? item.frete : cfg.ml_frete_padrao > 0 ? cfg.ml_frete_padrao : 0;
        M.conta(c.comissao_pct === pct && Math.abs(c.comissao_rs - preco * pct / 100) <= 0.005 + 1e-9 && Math.abs(c.imposto_rs - preco * cfg.imposto_pct / 100) <= 0.005 + 1e-9
            && c.taxa_fixa_rs === SHC.taxaFixaML(preco) && c.frete_rs === freteEsp && c.frete_desconhecido === ((full || preco >= 79) && item.frete === null && !(cfg.ml_frete_padrao > 0)),
            { preco, item, cfg, c: [c.comissao_rs, c.imposto_rs, c.taxa_fixa_rs, c.frete_rs] });
        // Margem: o % da tela é a sobra ÷ preço com 1 casa; sinal e classe (fora da faixa em que o arredondamento decide).
        if (c.sobra_rs !== null) {
            const m = c.sobra_rs / preco * 100;
            K.conta(c.sobra_pct === Math.round(m * 10) / 10 && !Object.is(c.sobra_pct, -0)
                && c.classe === (c.sobra_rs < 0 ? 'prejuizo' : m < cfg.margem_alvo_pct ? 'apertado' : 'lucrativo'), { preco, item, cfg, sobra: c.sobra_rs, pct: c.sobra_pct, classe: c.classe });
            // Calculadora do popup: "Sobra no final R$ X (p%)" + "Comissão R$ · taxa fixa R$ · frete R$ · imposto R$" e o custo digitado.
            const txt = { sobra: SHC.moeda(c.sobra_rs), com: SHC.moeda(c.comissao_rs), fixa: c.taxa_fixa_rs ? SHC.moeda(c.taxa_fixa_rs) : 'R$ 0,00',
                frete: SHC.moeda(c.frete_rs), imp: c.imposto_rs ? SHC.moeda(c.imposto_rs) : 'R$ 0,00', custo: SHC.moeda(c.custo_rs), outros: SHC.moeda(c.outros_rs) };
            T.conta(deMoeda(txt.sobra) === cent(preco) - deMoeda(txt.com) - deMoeda(txt.fixa) - deMoeda(txt.frete) - deMoeda(txt.imp) - deMoeda(txt.custo) - deMoeda(txt.outros),
                { preco, item, cfg, txt });
        } else S.conta(c.custo_rs === null && c.sobra_pct === null && c.classe === 'sem_custo' && emCentavos(c.recebe_rs), { preco, item, c });
    }
    okLote(L, 'recebe = preço − comissão − taxa fixa − frete e sobra = recebe − custo − outros − imposto, em centavos inteiros (tudo com 2 casas)');
    okLote(M, 'comissão e imposto a no máximo meio centavo do % exato; taxa fixa da faixa; frete do comprador abaixo de R$ 79; frete sem valor marcado');
    okLote(K, 'margem da tela = sobra ÷ preço (1 casa, nunca −0); classe pela sobra e pela margem SEM arredondar (sobra < 0 = prejuízo; abaixo da meta = apertado)');
    okLote(T, 'popup: os R$ da tela (comissão, taxa fixa, frete, imposto, custo, outros) somam exatamente a "Sobra no final"');
    okLote(S, 'sem custo: sobra, custo e % ficam null (a tela mostra "—"/"＋ custo"), o "você recebe" continua em centavos');
    // #11 gerados: custo, outros e frete com 3 ou 4 casas (planilha do ERP, custo de caixa ÷ unidades).
    const r3 = lcg(1111), Q = lote();
    for (let i = 0; i < 3000; i++) {
        const preco = um(r3, [din(r3, 20, 78.99), din(r3, 79, 900)]), casas = um(r3, [1000, 10000]), d4 = (a, b) => ent(r3, a * casas, b * casas) / casas;
        const item = { custo: d4(1, 500), outros: r3() < 0.5 ? d4(0, 20) : 0, frete: d4(5, 60), full: r3() < 0.2 }, cfg = { imposto_pct: um(r3, [0, 6, 13.33]) };
        const c = SHC.calcular('ml', preco, item, cfg), linhas = [c.comissao_rs, c.taxa_fixa_rs, c.frete_rs, c.imposto_rs, c.custo_rs, c.outros_rs];
        Q.conta(linhas.every(emCentavos) && c.custo_rs === r2(item.custo) && c.outros_rs === r2(item.outros) && (c.frete_rs === 0 || c.frete_rs === r2(item.frete))
            && cent(c.recebe_rs) === cent(preco) - cent(c.comissao_rs) - cent(c.taxa_fixa_rs) - cent(c.frete_rs)
            && cent(c.sobra_rs) === cent(c.recebe_rs) - cent(c.custo_rs) - cent(c.outros_rs) - cent(c.imposto_rs)
            && deMoeda(SHC.moeda(c.sobra_rs)) === cent(preco) - linhas.reduce((t, v) => t + deMoeda(SHC.moeda(v)), 0), { preco, item, cfg, c });
    }
    okLote(Q, 'custo/outros/frete com 3 ou 4 casas: cada linha da tela em centavos e as linhas (R$ da tela) somam exatamente o "você recebe" e a sobra');
}

console.log('D. Shopee: SHC.calcular(\'sp\') = CopilotoNucleo.tarifas.simular (a mesma tabela, a mesma conta)');
{
    const r = lcg(5501), L = lote();
    for (let i = 0; i < 3000; i++) {
        const p = um(r, [din(r, 1, 8.99), din(r, 9, 79.99), din(r, 80, 99.99), din(r, 100, 199.99), din(r, 200, 3000)]);
        const item = { custo: r() < 0.9 ? din(r, 1, 900) : null, outros: r() < 0.3 ? din(r, 0, 9) : 0, frete: r() < 0.3 ? din(r, 0, 30) : null, comissao_pct: r() < 0.1 ? ent(r, 50, 220) / 10 : undefined };
        const cfg = { imposto_pct: um(r, [0, 4, 6, 9.5]) };
        const a = SHC.calcular('sp', p, item, cfg);
        const b = TARIFAS.simular('shopee', p, { custo: item.custo, outros: item.outros, frete: item.frete, imposto_pct: cfg.imposto_pct, comissao_pct: item.comissao_pct });
        L.conta(a.recebe_rs === b.repasse && a.sobra_rs === b.lucro && r2(a.comissao_rs + a.taxa_fixa_rs) === b.tarifas_rs && a.frete_rs === b.frete_rs && a.imposto_rs === b.imposto_rs
            && cent(a.recebe_rs) === cent(a.preco) - cent(a.comissao_rs) - cent(a.taxa_fixa_rs) - cent(a.frete_rs)
            && (a.sobra_rs === null ? item.custo === null : cent(a.sobra_rs) === cent(a.recebe_rs) - cent(a.custo_rs) - cent(a.outros_rs) - cent(a.imposto_rs))
            && a.tarifa_regra === 'tabela da Shopee (estimado)' && a.tarifa_aviso === null, { p, item, cfg, a: [a.recebe_rs, a.sobra_rs], b: [b.repasse, b.lucro] });
    }
    okLote(L, 'repasse, lucro, tarifas, frete e imposto iguais aos do núcleo, e a conta fecha em centavos inteiros');
    const t = SHC.calcular('sp', 50, { custo: 20 }, {});
    ok(t.comissao_rs === 10 && t.taxa_fixa_rs === 4 && t.recebe_rs === 36 && t.sobra_rs === 16, 'R$ 50 na Shopee (25/09): 20% + R$ 4 = 14,00 → recebe 36,00, sobra 16,00');
    const esc = SHC.calcular('sp', 100, { custo: 40 }, { sp_comissao_pct: 18, sp_taxa_fixa: 3 });
    ok(esc.comissao_rs === 18 && esc.taxa_fixa_rs === 3 && esc.recebe_rs === 79 && esc.tarifa_regra === null, 'comissão e taxa escolhidas pela seller (18% + R$ 3) mandam: recebe 100 − 18 − 3 = 79,00');
    const guarda = global.CopilotoNucleo;
    global.CopilotoNucleo = undefined;
    const sem = SHC.calcular('sp', 100, { custo: 40 }, {});
    global.CopilotoNucleo = guarda;
    ok(sem.comissao_rs === 20 && sem.taxa_fixa_rs === 0 && sem.recebe_rs === 80 && /sem a tabela/.test(sem.tarifa_aviso || ''), 'sem o núcleo carregado: % único (20%), sem fixo, COM o aviso na tela (nunca em silêncio)');
}

console.log('E. SHC.precoMinimo: o menor preço que deixa a meta (busca centavo a centavo com o próprio SHC.calcular)');
{
    // Piso honesto da busca: toda tarifa, frete e imposto é ≥ 0 e cada r2 erra ≤ meio centavo → preço ≥ (custo + outros − 0,0151) ÷ (1 − com − imp − meta).
    const menorPreco = (canal, item, cfg, alvo, comMin) => {
        const den = 1 - comMin - (SHC.num(cfg.imposto_pct) || 0) / 100 - alvo / 100;
        if (!(den > 0)) return null;
        const okP = p => { const c = SHC.calcular(canal, p, item, cfg); return !!c && c.sobra_rs !== null && c.sobra_rs >= r2(alvo / 100 * p) - 0.0001; };
        for (let c = Math.max(1, Math.floor(((SHC.num(item.custo) || 0) + (SHC.num(item.outros) || 0) - 0.0151) / den * 100) - 2), fim = c + 500000; c < fim; c++) if (okP(c / 100)) return c / 100;
        return null;
    };
    const falta = (canal, p, item, cfg, alvo) => { const c = SHC.calcular(canal, p, item, cfg); return r2(r2(alvo / 100 * p) - c.sobra_rs); };
    const r = lcg(6601), N = lote(), C = lote(), S = lote();
    for (let i = 0; i < 120; i++) {
        const item = { custo: din(r, 1, 250), outros: r() < 0.4 ? din(r, 0, 8) : 0, frete: r() < 0.6 ? din(r, 0, 60) : null, tipo: um(r, ['premium', 'classico']), full: r() < 0.2,
            comissao_pct: r() < 0.2 ? ent(r, 80, 190) / 10 : undefined };
        const cfg = { imposto_pct: um(r, [0, 4, 6, 9.5, 13.33]), ml_frete_padrao: r() < 0.2 ? din(r, 10, 30) : 0 }, alvo = um(r, [0, 5, 10, 17.5]);
        const com = (item.comissao_pct !== undefined ? item.comissao_pct : item.tipo === 'premium' ? 16.5 : 13) / 100;
        const menor = menorPreco('ml', item, cfg, alvo, com);
        const pn = TARIFAS.precoMinimo('ml', { custo: item.custo, outros: item.outros, frete: item.frete, frete_padrao: cfg.ml_frete_padrao, full: item.full, tipo_anuncio: item.tipo,
            comissao_pct: item.comissao_pct, imposto_pct: cfg.imposto_pct }, alvo, '2026-09-30');
        N.conta(menor !== null && pn === menor, { item, cfg, alvo, nucleo: pn, menor });
        const pm = SHC.precoMinimo('ml', item, cfg, alvo);
        // calc.js: a divergência exata (1 centavo abaixo da meta ou alguns centavos acima do menor) está registrada como bug; aqui vale o que ele garante hoje.
        C.conta(emCentavos(pm) && pm > 0 && falta('ml', pm, item, cfg, alvo) <= 0.01 && cent(pm) - cent(menor) >= -2 && cent(pm) - cent(menor) <= 10, { item, cfg, alvo, pm, menor });
    }
    for (let i = 0; i < 60; i++) {
        const item = { custo: din(r, 1, 250), outros: r() < 0.3 ? din(r, 0, 8) : 0, frete: r() < 0.3 ? din(r, 0, 30) : null };
        const cfg = { imposto_pct: um(r, [0, 4, 6, 9.5]) }, alvo = um(r, [0, 5, 10]);
        const menor = menorPreco('sp', item, cfg, alvo, 0.14);
        S.conta(menor !== null && SHC.precoMinimo('sp', item, cfg, alvo) === menor, { item, cfg, alvo, menor, pm: SHC.precoMinimo('sp', item, cfg, alvo) });
    }
    okLote(N, 'ML pelo núcleo (tarifas.precoMinimo): exatamente o menor preço em centavos que deixa a meta');
    okLote(C, 'ML pelo calc.js (popup): em centavos, > 0, no máximo 1 centavo abaixo da meta e entre −2 e +10 centavos do menor preço');
    okLote(S, 'Shopee (calc.js → núcleo): exatamente o menor preço em centavos que deixa a meta');
    ok(SHC.precoMinimo('ml', {}, {}, 0) === null && SHC.precoMinimo('ml', { custo: 0 }, {}, 0) === null && SHC.precoMinimo('ml', { custo: 10 }, { imposto_pct: 50 }, 40) === null,
        'sem custo ou meta impossível (comissão + imposto + meta ≥ 100%): sem preço (null), nunca R$ 0,00');
}

(async () => {
    console.log('F. Kits (store.js): custo = Σ componente × quantidade (+ outros do kit)');
    {
        const cs = { 'c|sku|A': { custo: 12.34, outros: 0.9 }, 'c|sku|B': { custo: 5.55 }, 'c|sku|C': {}, 'c|sku|KIT': { kit: [{ sku: 'A', q: 2 }, { sku: 'B', q: 3 }], outros: 1.5 },
            'c|sku|KIT2': { kit: [{ sku: 'A', q: 1 }, { sku: 'C', q: 1 }] }, 'c|sku|KIT3': { kit: [{ sku: 'A', q: 1 }, { sku: 'C', q: 2 }], custo: 30, origem: 'erp', custoErp: 30 },
            'c|sku|KIT4': { kit: [{ sku: 'A', q: 1 }], custo: 50, origem: 'manual' }, 'c|sku|KIT5': { kit: [{ sku: 'A', q: 1 }, { sku: 'B', q: 1 }], custo: 99, origem: 'erp', custoErp: 99 } };
        const k1 = SHC.kitDe(cs, cs['c|sku|KIT']), d1 = SHC.custoDeAnuncio(cs, { sku: 'KIT' });
        ok(k1.custo === 41.33 && !k1.faltam.length && d1.dados.custo === 41.33 && d1.dados.origem === 'kit' && d1.dados.outros === 1.5,
            '2 × 12,34 + 3 × 5,55 = 41,33 (os "outros" do componente A não entram); o kit leva os R$ 1,50 de outros dele');
        const s1 = SHC.sobraAnuncio({ preco: 100, recebe: 70 }, d1.dados, { imposto_pct: 6 });
        ok(s1.sobra === 21.17 && cent(s1.sobra) === 7000 - 4133 - 150 - 600, 'lucro do anúncio do kit: 70,00 − 41,33 − 1,50 − 6,00 = 21,17');
        const k2 = SHC.kitDe(cs, cs['c|sku|KIT2']);
        ok(k2.custo === null && k2.faltam.join() === 'C' && SHC.custoDeAnuncio(cs, { sku: 'KIT2' }) === null && SHC.sobraAnuncio({ preco: 100, recebe: 70 }, null, {}).sobra === null,
            'componente sem custo: kit sem custo (null, "falta C"), nunca a soma parcial nem R$ 0,00');
        ok(SHC.custoDeAnuncio(cs, { sku: 'KIT3' }).dados.custo === 30 && SHC.custoDeAnuncio(cs, { sku: 'KIT4' }).dados.custo === 50 && SHC.custoDeAnuncio(cs, { sku: 'KIT5' }).dados.custo === 17.89,
            'kit incompleto usa o custo do próprio kit (30,00 do ERP); custo digitado no kit (50,00) ganha da soma; ERP com soma completa: vale a soma (17,89)');
        ok(SHC.custoDeAnuncio(cs, { sku: 'B', skus: ['B', 'KIT'] }).dados.custo === 41.33 && SHC.custoDeAnuncio(cs, { sku: 'KIT2', itemId: 'MLB9100000001' }) === null,
            'anúncio com vários SKUs usa o MAIOR custo (41,33 do kit, não 5,55): o lucro nunca sai inflado');
        const lk = PN.linhasKits({ kits: [{ sku: 'KIT', dados: cs['c|sku|KIT'] }, { sku: 'KIT2', dados: cs['c|sku|KIT2'] }, { sku: 'KIT4', dados: cs['c|sku|KIT4'] }], custos: cs });
        ok(lk[0].custo === 41.33 && lk[0].soma === 41.33 && lk[0].outros === 1.5 && lk[0].proprio === false && SHC.moeda(r2(lk[0].custo + lk[0].outros)) === 'R$ 42,83'
            && lk[1].custo === null && lk[1].faltam.join() === 'C' && lk[2].custo === 50 && lk[2].proprio === true && lk[2].soma === 12.34,
            'tabela de kits (P.linhasKits): "R$ 42,83" = 41,33 + 1,50; incompleto = "Falta o custo de: C"; digitado = custo do próprio kit e a soma dos itens ao lado');
        const r = lcg(7701), G = lote();
        for (let i = 0; i < 2000; i++) {
            const n = ent(r, 1, 6), cs2 = {}, kit = [];
            for (let j = 0; j < n; j++) { const sku = 'P' + i + '-' + j; cs2['c|sku|' + sku] = { custo: din(r, 0.01, 999.99) }; kit.push({ sku, q: ent(r, 1, 12) }); }
            const outros = r() < 0.5 ? din(r, 0, 9.99) : 0;
            cs2['c|sku|K' + i] = Object.assign({ kit }, outros ? { outros } : {});
            const esp = kit.reduce((s, c) => s + cent(cs2['c|sku|' + c.sku].custo) * c.q, 0), d = SHC.custoDeAnuncio(cs2, { sku: 'K' + i });
            const preco = din(r, 10, 9999), recebe = r2(preco * 0.8), cfg = { imposto_pct: um(r, [0, 6, 9.5]) }, s = SHC.sobraAnuncio({ preco, recebe }, d && d.dados, cfg);
            G.conta(!!d && emCentavos(d.dados.custo) && cent(d.dados.custo) === esp && (SHC.num(d.dados.outros) || 0) === outros
                && cent(s.sobra) === cent(recebe) - esp - cent(outros) - cent(s.imposto), { kit, outros, custo: d && d.dados.custo, esp });
        }
        okLote(G, 'kits gerados (1 a 6 itens, 1 a 12 unidades): custo = Σ custo × q em centavos inteiros e o lucro tira custo + outros do kit');
        // #11: componente com 3+ casas entra pelo valor da tela (SHC.r2): 1 × 1,005 = 1,01 (antes 1,00); 0,145 → 0,15; 3 × 0,285 = 3 × 0,29.
        const ck = { 'c|sku|A': { custo: 1.005 }, 'c|sku|B': { custo: 0.145 }, 'c|sku|C': { custo: 0.285 }, 'c|sku|D': { custo: '12,3449' } };
        const kd = (...xs) => SHC.kitDe(ck, { kit: xs.map(([sku, q]) => ({ sku, q })) }).custo;
        ok(kd(['A', 1]) === 1.01 && kd(['B', 1]) === 0.15 && kd(['C', 3]) === 0.87 && kd(['A', 2], ['B', 1], ['D', 1]) === 14.51 && SHC.moeda(kd(['A', 1])) === SHC.moeda(1.005),
            'kit com componente de 3+ casas: soma o valor que a tela mostra (1 × 1,005 = 1,01; 0,145 → 0,15; 3 × 0,285 = 0,87; 2 × 1,01 + 0,15 + 12,34 = 14,51)');
        const r4 = lcg(7702), G4 = lote();
        for (let i = 0; i < 1500; i++) {
            const n = ent(r4, 1, 5), cs4 = {}, kit = [];
            for (let j = 0; j < n; j++) { const sku = 'Q' + i + '-' + j; cs4['c|sku|' + sku] = { custo: ent(r4, 1, 9999999) / 10000 }; kit.push({ sku, q: ent(r4, 1, 12) }); }
            const esp = kit.reduce((t, c) => t + cent(r2(cs4['c|sku|' + c.sku].custo)) * c.q, 0), k = SHC.kitDe(cs4, { kit });
            G4.conta(k.custo !== null && emCentavos(k.custo) && cent(k.custo) === esp && deMoeda(SHC.moeda(k.custo)) === kit.reduce((t, c) => t + deMoeda(SHC.moeda(cs4['c|sku|' + c.sku].custo)) * c.q, 0), { kit, cs4, custo: k.custo, esp });
        }
        okLote(G4, 'kits gerados com custos de 4 casas: custo do kit = Σ (R$ que a tela mostra do componente) × q, em centavos inteiros');
        // Gravado no chrome.storage: o kit e os componentes (SHC.custosDe busca os componentes que a tela não pediu).
        banco['c|sku|PEÇA-1'] = { custo: 7.35, origem: 'manual' }; banco['c|sku|PEÇA-2'] = { custo: 2.1, origem: 'erp', custoErp: 2.1 };
        await SHC.salvarKit('kit-azul', [{ sku: 'peça-1', q: 2 }, { sku: 'PEÇA-2', q: 4 }], '0,80');
        const m = await SHC.custosDe([{ sku: 'KIT-AZUL', itemId: 'MLB9100000002' }]), x = [...m.values()][0], lks = await SHC.lerKits();
        ok(banco['c|sku|KIT-AZUL'].outros === 0.8 && x && x.dados.custo === 23.1 && x.dados.outros === 0.8 && lks.kits.length === 1 && SHC.kitDe(lks.custos, lks.kits[0].dados).custo === 23.1,
            'gravado: SHC.custosDe traz os componentes junto (2 × 7,35 + 4 × 2,10 = 23,10) e os R$ 0,80 de outros do kit');
        await SHC.salvarCustoSku('PEÇA-2', { custo: 0 });
        const y = [...(await SHC.custosDe([{ sku: 'KIT-AZUL' }])).values()][0];
        ok(y === null, 'apagou o custo de um componente: o kit volta a ficar sem custo (null), não vira 2 × 7,35');
        // #11: o que é gravado já vai em centavos (etiqueta, painel, planilha): o custo guardado é o que a tela mostra.
        await SHC.salvarCustoSku('CX-1', { custo: '12,345', outros: 0.125, origem: 'manual' });
        await SHC.salvarCustoSku('CX-2', { custo: 0.004 });
        const tb = SHC.lerTabela([['SKU', 'Custo médio', 'Outros'], ['AB-1', '10,0040', '0,1250'], ['AB-2', '0,0040', '']]);
        const ta = SHC.lerTabela([['canal', 'id', 'custo', 'outros', 'frete'], ['ml', 'MLB9100000009', '7,777', '1,005', '19,995']]);
        ok(banco['c|sku|CX-1'].custo === 12.35 && banco['c|sku|CX-1'].outros === 0.13 && !('c|sku|CX-2' in banco)
            && tb.itens.length === 1 && tb.itens[0].custo === 10 && tb.itens[0].outros === 0.13 && ta.itens[0].custo === 7.78 && ta.itens[0].outros === 1.01 && ta.itens[0].frete === 20,
            'grava em centavos: custo "12,345" → 12,35 e outros 0,125 → 0,13; custo 0,004 vira 0 (não é custo); planilha "10,0040" → 10,00, "1,005" → 1,01, frete "19,995" → 20,00');
    }

    console.log('G. Lista de Anúncios → balão "Resultado de 1 venda" → etiqueta (números do ML + custo e imposto do seller)');
    const L = (...xs) => ({ lines: xs.map(x => (typeof x === 'string' ? { label: x } : x)) });
    const linha = (id, preco, recebe, cond) => ({ metadata: { itemId: id, userProductId: 'MLBU9000000' + id.slice(-3) }, product: { title: 'Produto de teste ' + id, sku: 'SKU-' + id.slice(-4), status: 'active' },
        price: L(...[].concat(preco)), earnings: L(recebe), purchaseOptions: L(...cond) });
    const lista = rows => SHC.mlAnunciosDoEstado({ appProps: { pageProps: { viewData: { rows } } } });
    const cfgG = { imposto_pct: 6, margem_alvo_pct: 10 };
    {
        const its = lista([
            linha('MLB9200000001', 'R$ 100,00', 'R$ 70,00', ['Clássico', 'A pagar R$ 13,00', 'Frete grátis', 'A pagar R$ 17,00']),
            linha('MLB9200000002', 'R$ 100,00', 'R$ 70,00', ['Clássico', 'A pagar R$ 13,00']),
            linha('MLB9200000003', 'R$ 60,00', 'R$ 43,55', ['Premium', 'A pagar R$ 9,70', 'Envio por conta do comprador', { label: 'A pagar R$ 6,75', tooltip: { type: 'operational-cost' } }]),
            linha('MLB9200000004', ['R$ 165,00', 'em promoção a R$ 156,75'], 'R$ 120,00', ['Clássico', 'A pagar R$ 18,81', 'Frete grátis', 'A pagar R$ 17,94']),
            linha('MLB9200000005', 'R$ 200 a R$ 251', 'R$ 150 a R$ 200', ['Clássico']),
            linha('MLB9200000006', 'R$ 1.234,56', 'R$ 1.000,00', ['Premium', 'A pagar R$ 203,70']),
        ]);
        const por = {}; its.forEach(i => { por[i.itemId] = i; });
        const a = por.MLB9200000001, b = por.MLB9200000002, c = por.MLB9200000003, d = por.MLB9200000004, e = por.MLB9200000005, g = por.MLB9200000006;
        ok(a.preco === 100 && a.tarifa === 13 && a.frete === 17 && !a.freteDeduzido && a.recebe === 70 && b.frete === 17 && b.freteDeduzido === true,
            'frete lido ("A pagar R$ 17,00" depois de "Frete grátis") e frete deduzido (100 − 13 − 70 = 17,00) dão o mesmo número');
        ok(c.frete === 0 && c.freteComprador === true && c.taxaOperacional === 6.75 && c.tarifa === 9.7 && d.preco === 156.75 && d.precoCheio === 165 && d.emPromocao
            && g.preco === 1234.56 && g.frete === 30.86 && e.preco === null && e.recebe === null && e.frete === null,
            'comprador paga: frete 0 + custo operacional 6,75; promoção: a conta usa 156,75 (cheio 165,00); "R$ 1.234,56"; faixa da família: sem número (null)');
        const fecha = it => { const ls = SHC.telaAnuncioLinhas(it), tot = ls[ls.length - 1]; return somaLinhas(ls.slice(0, -1)) === cent(tot.v) && tot.v === it.recebe; };
        ok([a, b, c, d, g].every(fecha), 'balão: preço − tarifa − frete − custo operacional = "Você recebe (ML)" em cada linha (a conta do ML fecha)');
        const cd = { custo: 30, outros: 2.5 }, s = SHC.sobraAnuncio(c, cd, cfgG), ch = SHC.telaChip(s), ex = SHC.telaExplica('anuncio', { item: c, s }, cfgG);
        ok(s.imposto === 3.6 && s.sobra === 7.45 && cent(s.sobra) === 4355 - 3000 - 250 - 360 && ch.cls === 'luc' && ch.vl === 'R$ 7,45 · 12,4%' && ch.st === 'Dá lucro'
            && /o ML repassa R\$ 43,55 e custo, outros gastos e imposto somam R\$ 36,10\./.test(ex.frase) && SHC.telaResultado(s, cfgG) === 'Lucro · margem 12,4% · acima da sua meta de 10%',
            'etiqueta: 43,55 − 30,00 − 2,50 − 3,60 = "R$ 7,45 · 12,4%"; a frase soma 36,10 = 30 + 2,50 + 3,60');
        const sp = SHC.sobraAnuncio(a, { custo: 80 }, cfgG), cp = SHC.telaChip(sp);
        ok(sp.sobra === -16 && sp.classe === 'prejuizo' && cp.cls === 'pre' && cp.st === 'Prejuízo' && cp.vl === '−R$ 16,00 · −16%' && /perde R\$ 16,00 por venda/.test(SHC.telaExplica('anuncio', { item: a, s: sp }, cfgG).frase),
            'prejuízo: 70 − 80 − 6 = −16,00 → "Prejuízo −R$ 16,00 · −16%" (o sinal vai junto do número)');
        // #11: custo e outros com 3+ casas: a etiqueta tira o que mostra (R$ 30,00 e R$ 2,50), e a frase "somam" fecha com a sobra.
        const s3 = SHC.sobraAnuncio(c, { custo: 30.004, outros: '2,4951' }, cfgG), x3 = SHC.telaExplica('anuncio', { item: c, s: s3 }, cfgG).frase;
        const sa3 = SHC.sobraAtacado({ preco: 100, tarifa: 13, frete: 17, recebe: 70, sku: 'AT-3', tipo: 'Clássico' }, { qtd: 2, preco: 90 }, { custo: 40.005, outros: 1.994 }, cfgG, []);
        const sp3 = SHC.sobraProposta({ preco: 100, tarifa: 13, envio: 17, recebe: 70 }, { custo: 30.005, outros: 0.125 }, cfgG);
        ok(s3.custo === 30 && s3.outros === 2.5 && s3.sobra === 7.45 && /somam R\$ 36,10\./.test(x3) && sa3.custo === 40.01 && sa3.outros === 1.99 && sa3.sobra === 13.9
            && sp3.sobra === r2(70 - 30.01 - 0.13 - 6) && sp3.sobra === 33.86,
            'custo 30,004 e outros 2,4951 → 30,00 e 2,50: etiqueta R$ 7,45 e "somam R$ 36,10"; atacado 40,005/1,994 → 40,01/1,99 (sobra 13,90); proposta 70 − 30,01 − 0,13 − 6 = 33,86');
        ok(SHC.sobraAnuncio(e, { custo: 50 }, cfgG) === null && SHC.telaChip(null).vl === '' && SHC.sobraAnuncio(a, null, cfgG).sobra === null && SHC.sobraAnuncio(a, { custo: 0 }, cfgG).classe === 'sem_custo'
            && SHC.telaChip(SHC.sobraAnuncio(a, null, cfgG)).st === '＋ Informar custo',
            'sem "Você recebe" único (família) ou sem custo: nenhum número na etiqueta ("＋ Informar custo"), nunca R$ 0,00');
        // Gerados: o ML escreve as linhas; o Copiloto lê, deduz o frete quando falta e a etiqueta usa o "Você recebe".
        const r = lcg(8801), A = lote(), B = lote(), C = lote();
        const txt = v => reais(cent(v));
        for (let i = 0; i < 1500; i++) {
            const preco = um(r, [din(r, 5, 78.99), din(r, 79, 600), din(r, 600, 12000)]), taxa = um(r, [0.105, 0.115, 0.12, 0.13, 0.145, 0.165, 0.17, 0.19]);
            const tarifa = r2(preco * taxa), modo = ent(r, 0, 2);   // 0 = frete escrito · 1 = frete deduzido · 2 = comprador paga (+ custo operacional)
            // "Você recebe" ≥ 0 aqui (o negativo é lido sem o sinal: divergência registrada).
            const frete = modo === 2 ? 0 : din(r, 0, Math.min(90, preco - tarifa)), op = modo === 2 && r() < 0.8 ? din(r, 0.01, Math.min(12.5, preco - tarifa)) : 0;
            const recebe = r2(preco - tarifa - frete - op), id = 'MLB93' + String(i).padStart(8, '0');
            const cond = modo === 0 ? ['Clássico', 'A pagar ' + txt(tarifa), 'Frete grátis', 'A pagar ' + txt(frete)] : modo === 1 ? ['Premium', 'A pagar ' + txt(tarifa)]
                : ['Clássico', 'A pagar ' + txt(tarifa), 'Envio por conta do comprador'].concat(op ? [{ label: 'A pagar ' + txt(op), tooltip: { type: 'operational-cost' } }] : []);
            const it = lista([linha(id, txt(preco), txt(recebe), cond)])[0];
            A.conta(it.preco === preco && it.tarifa === tarifa && it.recebe === recebe && it.frete === frete && it.freteDeduzido === (modo === 1) && (SHC.num(it.taxaOperacional) || 0) === op
                && (() => { const ls = SHC.telaAnuncioLinhas(it); return somaLinhas(ls.slice(0, -1)) === cent(recebe); })(), { preco, tarifa, frete, op, modo, it });
            const cd2 = { custo: din(r, 0.5, preco), outros: r() < 0.3 ? din(r, 0, 9) : 0 }, cfg = { imposto_pct: um(r, [0, 4, 6, 9.5, 13.33]), margem_alvo_pct: um(r, [0, 5, 10, 20]) };
            const s2 = SHC.sobraAnuncio(it, cd2, cfg), ch2 = SHC.telaChip(s2), pp = s2.sobra / preco * 100;
            B.conta(emCentavos(s2.imposto) && Math.abs(s2.imposto - preco * cfg.imposto_pct / 100) <= 0.005 + 1e-9 && cent(s2.sobra) === cent(recebe) - cent(cd2.custo) - cent(cd2.outros) - cent(s2.imposto)
                && ch2.vl.split(' · ')[0] === SHC.moeda(s2.sobra) && deMoeda(ch2.vl.split(' · ')[0]) === cent(s2.sobra) && ch2.vl.split(' · ')[1] === SHC.pctTxt(pp)
                && Math.abs(dePct(ch2.vl.split(' · ')[1]) - pp) <= (Math.abs(pp) < 1 ? 0.005 : 0.05) + 1e-9
                && s2.classe === (s2.sobra < 0 ? 'prejuizo' : pp < cfg.margem_alvo_pct ? 'apertado' : 'lucrativo') && ch2.cls === (s2.sobra < 0 ? 'pre' : pp < cfg.margem_alvo_pct ? 'ate' : 'luc')
                && SHC.telaResultado(s2, cfg).indexOf('margem ' + SHC.pctTxt(pp)) >= 0 && /^(Lucro|Prejuízo)/.test(SHC.telaResultado(s2, cfg)) && (s2.sobra < 0) === /^Prejuízo/.test(SHC.telaResultado(s2, cfg)),
                { recebe, cd2, cfg, s2, ch2 });
            const fr = SHC.telaExplica('anuncio', { item: it, s: s2 }, cfg).frase, mm = /repassa (−?R\$ [\d.,]+) e .* somam (−?R\$ [\d.,]+)\./.exec(fr);
            C.conta(!!mm && deMoeda(mm[1]) === cent(recebe) && deMoeda(mm[2]) === cent(cd2.custo) + cent(cd2.outros) + cent(s2.imposto)
                && fr.indexOf(SHC.moeda(Math.abs(s2.sobra))) >= 0, { fr, recebe, cd2, s2 });
        }
        okLote(A, 'gerados: preço, tarifa, frete (escrito, deduzido ou do comprador) e custo operacional lidos no centavo; o balão fecha no "Você recebe"');
        okLote(B, 'gerados: sobra = recebe − custo − outros − imposto; a etiqueta mostra esse R$ e esse %; classe pela margem SEM arredondar');
        okLote(C, 'gerados: a frase da etiqueta ("o ML repassa X e … somam Y") usa os mesmos números (X − Y = a sobra)');
    }

    console.log('H. Preço de atacado: lucro por unidade e no pedido de N unidades (SHC.sobraAtacado, SHC.telaAtacadoLinhas)');
    {
        const it = { itemId: 'MLB9400000001', sku: 'AT-1', tipo: 'Clássico', preco: 100, tarifa: 13, frete: 17, recebe: 70 };
        const sa = SHC.sobraAtacado(it, { qtd: 3, preco: 90 }, { custo: 40, outros: 2 }, { imposto_pct: 6, margem_alvo_pct: 10 }, [it]);
        ok(sa.tarifa === 11.7 && sa.frete === 17 && sa.imposto === 5.4 && sa.sobra === 13.9 && sa.pedido === 41.7 && sa.descontoPct === 10 && Math.abs(sa.pct - 13.9 / 90 * 100) < 1e-9,
            '3 un. a R$ 90: tarifa 13% = 11,70; 90 − 11,70 − 17 − 40 − 2 − 5,40 = 13,90 por unidade; pedido 3 × 13,90 = 41,70; 10% de desconto');
        const ls = SHC.telaAtacadoLinhas({ qtd: 3, preco: 90 }, sa), rec = ls.find(l => /Você recebe/.test(l.rot)), tot = ls[ls.length - 1];
        ok(rec.un === 61.3 && rec.ped === 183.9 && tot.un === 13.9 && tot.ped === 41.7 && /= Sobra/.test(tot.rot), 'tabela: você recebe 61,30 (183,90 no pedido); "= Sobra" 13,90 (41,70 no pedido)');
        const op = Object.assign({}, it, { itemId: 'MLB9400000002', preco: 60, tarifa: 9.7, frete: 0, freteComprador: true, taxaOperacional: 6.75, recebe: 43.55 });
        const so = SHC.sobraAtacado(op, { qtd: 2, preco: 55 }, { custo: 30 }, {}, [op]);
        ok(so.frete === 0 && so.taxaOp === 6.75 && so.tarifa === r2(55 * 9.7 / 60) && so.sobra === r2(55 - so.tarifa - 6.75 - 30) && so.pedido === r2(so.sobra * 2),
            'comprador paga o frete: sem frete, mas com o custo operacional (6,75) por unidade');
        const promo = Object.assign({}, it, { itemId: 'MLB9400000003', preco: 157.04, tarifa: 12.56, emPromocao: true }), irmao = Object.assign({}, it, { itemId: 'MLB9400000004', preco: 165.3, tarifa: 19.84 });
        const sr = SHC.sobraAtacado(promo, { qtd: 2, preco: 150 }, { custo: 60 }, {}, [promo, irmao]);
        ok(sr.taxaReduzida === true && Math.abs(sr.taxaPct - 19.84 / 165.3 * 100) < 1e-9 && sr.tarifa === r2(150 * 19.84 / 165.3), 'promoção com tarifa reduzida (8%): o atacado (que não é promoção) usa a % dos outros anúncios do SKU (12%)');
        ok(SHC.sobraAtacado(it, { qtd: 3, preco: 90 }, null, {}, []) === null && SHC.sobraAtacado(Object.assign({}, it, { tarifa: null }), { qtd: 3, preco: 90 }, { custo: 40 }, {}, []) === null
            && SHC.atacadoAviso(Object.assign({}, it, { recebe: null }), { qtd: 3, preco: 90 }, null).curto === 'Lucro: abra a variação' && SHC.atacadoAviso(it, { qtd: 3, preco: 100 }, null).revisar === true
            && P.atacadoDegraus(it, [{ qtd: 3, preco: 90 }], null, {}, [it])[0].sa === null,
            'sem custo, sem tarifa ou sem "Você recebe": nada de lucro inventado (o chip diz o que falta); degrau ≥ preço de hoje: "Revisar no ML"');
        const r = lcg(9901), G = lote();
        for (let i = 0; i < 2000; i++) {
            const preco = din(r, 20, 900), taxa = um(r, [0.115, 0.13, 0.165, 0.19]), tarifa = r2(preco * taxa), fc = r() < 0.25;
            const frete = fc ? 0 : din(r, 0, 60), opV = fc && r() < 0.7 ? din(r, 3, 13) : null;
            const item = { itemId: 'MLB95' + String(i).padStart(8, '0'), sku: 'S' + (i % 50), tipo: 'Clássico', preco, tarifa, frete, recebe: r2(preco - tarifa - frete - (opV || 0)), freteComprador: fc, taxaOperacional: opV };
            const g = { qtd: ent(r, 2, 100), preco: r2(preco * (1 - ent(r, 1, 40) / 100)) }, cd = { custo: din(r, 0.5, preco), outros: r() < 0.3 ? din(r, 0, 9) : 0 };
            const cfg = { imposto_pct: um(r, [0, 4, 6, 9.5]), margem_alvo_pct: um(r, [0, 10, 20]) };
            const s = SHC.sobraAtacado(item, g, cd, cfg, [item]), l = SHC.telaAtacadoLinhas(g, s), rc = l.find(x => /Você recebe/.test(x.rot)), t = l[l.length - 1], ir = l.indexOf(rc);
            const sinal = s.sobra < 0 ? -1 : 1, semRec = l.slice(0, -1).filter(x => x !== rc);
            const chip = (s.sobra < 0 ? 'Prejuízo ' : 'Lucro ') + SHC.moeda(Math.abs(s.sobra)) + '/un.', fx = SHC.telaExplica('atacado', { degrau: g, s }, cfg).frase;
            G.conta([s.tarifa, s.imposto, s.sobra, s.pedido].every(emCentavos) && s.tarifa >= 0 && s.imposto >= 0 && s.frete >= 0 && s.taxaOp >= 0
                && cent(s.sobra) === cent(g.preco) - cent(s.tarifa) - cent(s.frete) - cent(s.taxaOp) - cent(cd.custo) - cent(cd.outros) - cent(s.imposto)
                && cent(s.pedido) === cent(s.sobra) * g.qtd && Math.abs(s.pct - s.sobra / g.preco * 100) < 1e-9
                && somaLinhas(l.slice(0, ir).map(x => ({ v: x.un, neg: x.neg }))) === cent(rc.un) && somaLinhas(l.slice(0, ir).map(x => ({ v: x.ped, neg: x.neg }))) === cent(rc.ped)
                && somaLinhas(semRec.map(x => ({ v: x.un, neg: x.neg }))) === sinal * cent(t.un) && somaLinhas(semRec.map(x => ({ v: x.ped, neg: x.neg }))) === sinal * cent(t.ped)
                && (s.sobra < 0) === /Prejuízo/.test(t.rot) && deMoeda(chip.replace(/^(Lucro|Prejuízo) /, '').replace('/un.', '')) === Math.abs(cent(s.sobra))
                && fx.indexOf((s.sobra < 0 ? 'prejuízo' : 'lucro') + ' de ' + SHC.moeda(Math.abs(s.sobra)) + ' por unidade (' + SHC.pctTxt(s.pct) + ')') >= 0 && fx.indexOf(g.qtd + ' un., ' + SHC.moeda(Math.abs(s.pedido)) + '.') >= 0
                && s.classe === (s.sobra < 0 ? 'prejuizo' : s.pct < cfg.margem_alvo_pct ? 'apertado' : 'lucrativo'), { item, g, cd, cfg, s, fx });
        }
        okLote(G, 'gerados: as duas colunas (por unidade e pedido de N un.) fecham no "Você recebe" e na sobra; pedido = sobra × N; chip "Lucro R$ X/un." e a frase do balão = a sobra');
    }

    console.log('I. Promoções: Central (SHC.mlPromosDoEstado) → proposta (SHC.sobraProposta) → melhor opção e preço para a meta');
    {
        const caixa = (nome, preco, tarifa, envio, recebe, itemId) => ({ columns: [[{ primaryText: { content: nome } }, { primaryText: { content: '01/10 a 05/10' } }], [{ primaryText: { content: 'R$ 10 (10%)' } }],
            { totalCharges: { detail: { costs: [{ id: 'price', value: preco }, { id: 'sale_fee', value: tarifa, description: 'Clássico' }].concat(envio ? [{ id: 'shipping', value: envio }] : []), summary: { value: recebe } } }, itemId }] });
        const est = { appProps: { pageProps: { brickTree: { bricks: [{ uiType: 'grid', data: { rows: [
            { id: '#9600000001', title: 'Produto promo A', shippingInfo: 'Frete grátis', price: 'R$ 120', caixas: [
                caixa('Oferta do dia', 'R$ 100,00', 'R$ 13,00', 'R$ 17,00', 'R$ 70,00', 'MLB9600000011'),
                caixa('Oferta relâmpago', 'R$ 90,00', 'R$ 11,70', 'R$ 17,00', 'R$ 61,30', 'MLB9600000011'),
                caixa('Campanha', 'R$ 1.080,00', 'R$ 140,40', null, 'R$ 939,60', 'MLB9600000012')] }] } }] } } } };
        const pr = SHC.mlPromosDoEstado(est), ps = pr.propostas;
        ok(ps.length === 3 && ps[0].preco === 100 && ps[0].tarifa === 13 && ps[0].envio === 17 && ps[0].recebe === 70 && ps[2].preco === 1080 && ps[2].envio === 0 && ps[2].recebe === 939.6
            && ps.every(p => cent(p.preco) - cent(p.tarifa) - cent(p.envio) === cent(p.recebe)) && ps.every(p => p.familia === 'F9600000001'),
            'Central: preço, tarifa, frete e "Você recebe" lidos no centavo (sem frete = 0); a conta do balão fecha: preço − tarifa − frete = você recebe');
        const cfg = { imposto_pct: 6, margem_alvo_pct: 10 }, custo = { custo: 30, outros: 2 };
        const ls = ps.slice(0, 2).map(p => Object.assign({ p }, SHC.sobraProposta(p, custo, cfg)));
        ok(ls[0].imposto === 6 && ls[0].sobra === 32 && ls[0].pct === 32 && ls[1].imposto === 5.4 && ls[1].sobra === 23.9 && ls[1].pct === 26.6 && ls.every(l => l.classe === 'lucrativo'),
            'proposta: 70 − 30 − 2 − 6 (6% de 100) = 32,00; 61,30 − 30 − 2 − 5,40 = 23,90 (imposto sobre o preço DA PROMOÇÃO)');
        const v = SHC.telaVeredito(ls[1].classe, ls[1]), rec = SHC.recomendaPromo(ls, cfg, custo);
        ok(v.txt === '✓ Dá para entrar' && v.sub === 'Lucro R$ 23,90 · 26,6%' && rec.tipo === 'ideal' && rec.escolha === ls[1] && rec.atingem === 2,
            'chip da proposta "Lucro R$ 23,90 · 26,6%"; melhor opção = a de menor preço entre as que batem a meta (R$ 90)');
        const ex = P.explicaPromo(ls, rec, cfg, 'Produto promo A'), conta = ex.linhas.find(t => /A conta da marcada/.test(t)), mm = /repassa (R\$ [\d.,]+); menos custo, outros e imposto \((R\$ [\d.,]+)\) sobram (−?R\$ [\d.,]+)\./.exec(conta || '');
        ok(!!mm && deMoeda(mm[1]) - 3000 - 200 - deMoeda(mm[2]) === deMoeda(mm[3]) && deMoeda(mm[3]) === 2390, 'texto do painel: "o ML repassa R$ 61,30; … imposto (R$ 5,40) sobram R$ 23,90" fecha (61,30 − 30 − 2 − 5,40)');
        const semCusto = SHC.sobraProposta(ps[0], null, cfg);
        ok(semCusto.sobra === null && semCusto.classe === 'sem_custo' && SHC.telaVeredito('sem_custo', semCusto).sub === 'para saber se compensa' && SHC.recomendaPromo([Object.assign({ p: ps[0] }, semCusto)], cfg, null) === null,
            'sem custo: nenhuma sobra (null), "＋ Informar custo", sem recomendação (nunca R$ 0,00)');
        // Gerados: famílias com 1 a 5 propostas; a escolha segue a regra e o preço para a meta fica a até 2 centavos do menor preço que a bate.
        const r = lcg(1201), E = lote(), Q = lote(), R = lote();
        for (let i = 0; i < 1500; i++) {
            const cfgI = { imposto_pct: um(r, [0, 4, 6, 9.5]), margem_alvo_pct: um(r, [0, 5, 10, 15, 25]) }, cd = { custo: din(r, 1, 300), outros: r() < 0.3 ? din(r, 0, 9) : 0 };
            const taxa = um(r, [0.115, 0.13, 0.145, 0.165, 0.19]), envio = r() < 0.5 ? 0 : din(r, 5, 60), base = din(r, 20, 900), props = [];
            for (let j = ent(r, 1, 5); j > 0; j--) { const preco = r2(base * (1 - ent(r, 0, 45) / 100)), tarifa = r2(preco * taxa); props.push({ promo: 'P' + j, itemId: 'MLB97' + String(i).padStart(8, '0'), preco, tarifa, envio, recebe: r2(preco - tarifa - envio) }); }
            const lsI = props.map(p => Object.assign({ p }, SHC.sobraProposta(p, cd, cfgI)));
            E.conta(lsI.every(l => emCentavos(l.sobra) && cent(l.sobra) === cent(l.p.recebe) - cent(cd.custo) - cent(cd.outros) - cent(l.imposto) && Math.abs(l.imposto - l.p.preco * cfgI.imposto_pct / 100) <= 0.005 + 1e-9
                && l.pct === Math.round(l.sobra / l.p.preco * 1000) / 10 && l.classe === (l.sobra < 0 ? 'prejuizo' : l.sobra / l.p.preco * 100 < cfgI.margem_alvo_pct ? 'apertado' : 'lucrativo')
                && SHC.telaVeredito(l.classe, l).sub === (l.sobra < 0 ? 'Prejuízo ' : 'Lucro ') + SHC.moeda(Math.abs(l.sobra)) + ' · ' + SHC.pctTxt(l.pct)
                && (() => { const mm = /repassa (−?R\$ [\d.,]+) e .* somam (−?R\$ [\d.,]+)\./.exec(SHC.telaExplica('proposta', { p: l.p, s: Object.assign({ outros: cd.outros }, l) }, cfgI).frase);
                    return !!mm && deMoeda(mm[1]) === cent(l.p.recebe) && deMoeda(mm[1]) - deMoeda(mm[2]) === cent(l.sobra); })()), { cd, cfgI, props });
            const recI = SHC.recomendaPromo(lsI, cfgI, cd), bate = lsI.filter(l => l.sobra / l.p.preco * 100 >= cfgI.margem_alvo_pct);
            const espTipo = bate.length ? 'ideal' : Math.max(...lsI.map(l => l.pct)) >= 0 && lsI.reduce((a, b) => (b.pct > a.pct ? b : a)).sobra >= 0 ? 'aproximada' : 'nenhuma';
            Q.conta(recI.tipo === espTipo && recI.atingem === bate.length && (bate.length ? recI.escolha.p.preco === Math.min(...bate.map(l => l.p.preco)) && bate.indexOf(recI.escolha) >= 0
                : recI.escolha.pct === Math.max(...lsI.map(l => l.pct))), { cfgI, props, tipo: recI.tipo, esp: espTipo });
            if (recI.precoMeta !== null) {
                const pe = recI.escolha.p, rr = pe.tarifa / pe.preco, den = 1 - rr - cfgI.imposto_pct / 100 - cfgI.margem_alvo_pct / 100;
                const bateEm = q => { const s = SHC.sobraProposta({ preco: q, recebe: r2(q - r2(q * rr) - envio) }, cd, cfgI); return s.sobra / q * 100 >= cfgI.margem_alvo_pct; };
                let menor = null; for (let c = Math.max(1, Math.floor((envio + cd.custo + cd.outros - 0.0151) / den * 100) - 2), fim = c + 200000; c < fim; c++) if (bateEm(c / 100)) { menor = c / 100; break; }
                R.conta(emCentavos(recI.precoMeta) && menor !== null && Math.abs(cent(recI.precoMeta) - cent(menor)) <= 2, { pe, cd, cfgI, precoMeta: recI.precoMeta, menor });
            }
        }
        okLote(E, 'gerados: sobra = você recebe − custo − outros − imposto (sobre o preço da promoção); % e classe da sobra exata; chip e frase com o mesmo R$ e %');
        okLote(Q, 'gerados: "★ Melhor opção" = a de menor preço entre as que batem a meta; sem nenhuma, a de maior margem (aproximada/nenhuma)');
        okLote(R, 'gerados: "Preço mínimo para a meta" (estimativa: mesma tarifa % e mesmo frete) a até 2 centavos do menor preço que bate a meta');
        const sug = SHC.roboPromoSugestoes({ familias: [{ chave: 'F9600000001', titulo: 'Produto promo A' }], propostas: ps.slice(0, 2) }, () => custo, cfg);
        ok(sug.length === 1 && sug[0].preco === 90 && sug[0].sobra === ls[1].sobra && sug[0].pct === ls[1].pct, 'robô de promoções: a sugestão leva a mesma sobra (23,90) e % da proposta');
        // Agenda do canal: lucro no preço da promoção (mesma % de tarifa, mesmo frete) e no preço do retrato.
        const it = { itemId: 'MLB9600000021', preco: 100, tarifa: 13, frete: 17, recebe: 70 };
        const l1 = SHC.canalLucro(it, custo, cfg, 89.9), l2 = SHC.canalLucro(it, custo, cfg, null), l3 = SHC.canalLucro(Object.assign({}, it, { preco: 70, tarifa: 9.1, frete: 0, recebe: 60.9 }), custo, cfg, 85);
        ok(l1.fonte === 'promocao' && l1.recebe === r2(89.9 - r2(89.9 * 0.13) - 17) && l1.recebe === 61.21 && l1.sobra === r2(61.21 - 30 - 2 - r2(89.9 * 0.06)) && cent(l1.sobra) === 6121 - 3200 - 539
            && l2.fonte === 'retrato' && l2.sobra === 32 && l3.sobra === null && /frete grátis passa a ser seu/.test(l3.motivo),
            'agenda: a R$ 89,90 recebe 89,90 − 11,69 − 17 = 61,21 e sobra 61,21 − 32 − 5,39 = 23,82; abaixo de 79 → acima sem frete: sem número (motivo)');
    }

    console.log('J. Catálogo, opções de compra, resultado por SKU e Ads: os mesmos números da etiqueta');
    {
        const cfg = { imposto_pct: 6, margem_alvo_pct: 10 }, agora = Date.now();
        const it = { itemId: 'MLB9800000001', sku: 'CT-1', tipo: 'Clássico', preco: 120, tarifa: 15.6, frete: 20, recebe: 84.4, userProductId: 'MLBU9800000001' };
        const kc = { estado: 'perdendo', precoGanhar: 109.9, vencedor: null, voce: { preco: 120 }, ts: agora - 3600e3, hist: [{ d: '2026-09-25' }] };
        const sg = SHC.sobraAtacado(it, { qtd: 1, preco: 109.9 }, { custo: 50 }, cfg, [it]), cp = SHC.telaCatalogo(it, kc, sg, agora);
        ok(sg.sobra === r2(109.9 - r2(109.9 * 0.13) - 20 - 50 - r2(109.9 * 0.06)) && cp.res === 'lucro ' + SHC.moeda(sg.sobra) && cp.resCls === 'ok'
            && SHC.compCatAcoes(kc, sg)[0].txt === 'Baixar para R$ 109,90: ainda sobra ' + SHC.moeda(sg.sobra) + ' (' + SHC.pctTxt(sg.pct) + ') por venda.',
            'catálogo: "ganhar: R$ 109,90 · lucro R$ ' + SHC.moeda(sg.sobra).slice(3) + '" = a mesma sobra do preço para ganhar (mesma tarifa % e frete)');
        const sp = SHC.sobraAtacado(it, { qtd: 1, preco: 70 }, { custo: 50 }, cfg, [it]), acp = SHC.compCatAcoes(Object.assign({}, kc, { precoGanhar: 70 }), sp);
        ok(sp.sobra < 0 && acp[acp.length - 1].txt === 'Baixar para R$ 70,00 dá prejuízo de ' + SHC.moeda(-sp.sobra) + ' por venda: não compensa.' && SHC.telaCatalogo(it, Object.assign({}, kc, { precoGanhar: 70 }), sp, agora).res === 'prejuízo ' + SHC.moeda(-sp.sobra),
            'catálogo com prejuízo: "dá prejuízo de R$ X" com o valor positivo e a palavra prejuízo (sem sinal duplicado)');
        ok(SHC.telaCatalogo(it, kc, null, agora).res === 'informe o custo', 'catálogo sem custo: "informe o custo", nunca R$ 0,00');
        const irmao = { itemId: 'MLB9800000002', sku: 'CT-1', tipo: 'Premium', preco: 135, tarifa: 22.95, frete: 20, recebe: 92.05, userProductId: 'MLBU9800000001' };
        const oc = SHC.telaOpcoesCompra(it, [it, irmao], () => ({ custo: 50, outros: 1.5 }), cfg);
        const s1 = SHC.sobraAnuncio(it, { custo: 50, outros: 1.5 }, cfg), s2 = SHC.sobraAnuncio(irmao, { custo: 50, outros: 1.5 }, cfg);
        ok(oc.linhas[0].sobra === s1.sobra && oc.linhas[1].sobra === s2.sobra && oc.txt === 'Mesmo custo do SKU CT-1: R$ 50,00 + R$ 1,50 de outros custos · Clássico dá ' + SHC.moeda(s1.sobra) + ' · Premium dá ' + SHC.moeda(s2.sobra),
            'Clássico × Premium do mesmo produto: "Clássico dá R$ ' + SHC.moeda(s1.sobra).slice(3) + ' · Premium dá R$ ' + SHC.moeda(s2.sobra).slice(3) + '" = a sobra de cada etiqueta');
        const rs = P.resumoSku({ itens: [it, irmao] }, { custo: 50, outros: 1.5 }, cfg);
        ok(rs.pior.s.sobra === Math.min(s1.sobra, s2.sobra) && rs.melhor.s.sobra === Math.max(s1.sobra, s2.sobra) && rs.classe === rs.pior.s.classe && P.resumoSku({ itens: [it] }, null, cfg).custo === null,
            'resultado do SKU no painel: pior e melhor anúncio com as mesmas sobras; sem custo, custo null');
        const eq = SHC.adsEquilibrio(it, { custo: 50, outros: 1.5 }, cfg);
        ok(eq.sobraAntes === s1.sobra && eq.equilibrio === s1.pct && SHC.adsEquilibrio(it, null, cfg) === null, 'Ads: ACOS de equilíbrio = a margem da etiqueta; sobra antes do Ads = a sobra da etiqueta; sem custo, null');
    }

    console.log(f ? `\n${f} FALHA(S) em ${nChecks} conferências` : `\n${nChecks} conferências de centavos.\nTUDO OK`);
    process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
