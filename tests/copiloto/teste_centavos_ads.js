// Centavos do Mercado Ads (pedido da dona: "cada centavo tem que bater, a tela tem que bater 100%").
// Prova, só com dados inventados (ids e valores fictícios), que cada conta de dinheiro do Ads fecha no centavo e que o texto da tela
// (SHC.moeda / A.rs0 / SHC.pctTxt / A.xTxt) é o número da conta:
//   A. régua: centavos inteiros × SHC.moeda (lido de volta), soma passo a passo com SHC.r2 (A.soma), A.rs0 (KPI em R$ inteiro);
//   B. leitores do fundo (ml-extrator: SHC.adsMetricas/adsCampanhas/adsAnuncios/adsResumo/adsShare): custo e receita em centavos,
//      CPC = custo ÷ cliques, CTR = cliques ÷ impressões, ACOS = custo ÷ receita, ROAS = receita ÷ custo; divisão por zero = null;
//   C. ads.js A.metricas: as mesmas razões (+ TACOS com as orgânicas lidas), o 0 do ML sem venda nunca vira ACOS, vazio = "—";
//   D. contas geradas (LCG, semente fixa) → A.analisa: Σ por SKU = Σ anúncios = resumo do ML = Σ campanhas, campo a campo, no centavo;
//      orçamento diário = Σ campanhas ativas; 30 dias antes = Σ campanhas de antes;
//   E. montante por SKU (A.montante) e resultado da conta (A.resultado): lucro = sobra − Ads, Σ por SKU = total, sem custo = null;
//   F. texto da tela de ads.html (KPIs, tabela por SKU, campanhas, "Precisa de você", proposta, leitura da campanha, página inteira);
//   G. painel lateral (P.adsDoAnuncio, adsLigaCatalogo, adsEquilibrio, adsDoItem, adsConta, adsCampanhasLista, adsVereditoDe,
//      adsCampanhaVs, adsFatoCatalogo) e o cruzamento com ads.html (mesmo snapshot → mesmo número);
//   H. Ads do Faturamento (SHC.fechamentoDasCobrancas → P.adsDoFechamento e A.modelos): cobrado − estornado, estorno com sinal −;
//   I. núcleo (copiloto-nucleo): adaptador adsDosAnuncios e motor.rateioAds — o Ads rateado + o não rateado = o Ads lido.
// Casos gerados com semente fixa (LCG): o resultado é o mesmo em toda execução (nada de Math.random).
// Divergências achadas nesta auditoria (fora deste teste para a suíte seguir verde; repro e esperado × obtido no relatório da tarefa):
//   1) ads.js A.rs0 arredonda o negativo para cima (Math.round(−2,5) = −2): lucro de −R$ 2,50 → KPI "−R$ 2", manchete "prejuízo de R$ 3" e
//      o rodapé "sobra R$ 30 − Ads R$ 33" (= −3). Os três arredondamentos independentes também não fecham entre si (sobra − Ads ≠ lucro).
//   2) ads.js: SKU com lucro depois do Ads de R$ 0,00 (Ads = sobra, no centavo) ganha o selo "Acima do equilíbrio" e a ação "Ajustar" por
//      ruído de ponto flutuante (ACOS 23,791193949216638 > margem 23,791193949216634); a manchete diz "Nenhum produto passa do equilíbrio".
//   3) ads.js: SKU com gasto e sem venda entra na contagem da manchete ("1 produto passa do equilíbrio", A.resultado.acima) mas não no
//      filtro "Acima do equilíbrio (0)" (selo só 'semVenda').
//   4) ads.js A.metricas: TACOS sem as vendas orgânicas lidas (o ML não mandou tacos nem organicUnitsAmount) vira o próprio ACOS; o painel
//      não mostra TACOS. E A.soma/A.kpis transformam orgânicas ausentes em "0 un. · R$ 0,00" (sem o resumo do ML, e "0 un." com ele).
//   5) ACOS/ROAS arredondados duas vezes: o fundo grava r2(custo ÷ receita × 100) e r2(receita ÷ custo); a tabela por SKU e o painel
//      calculam de novo → a mesma conta aparece "43,2%" (KPI e campanhas) e "43,1%" (SKU e painel); ROAS 201 ÷ 200 = "1,01x" × "1x".
//   6) Lucro depois do Ads do MESMO anúncio difere entre ads.html (margem % × receita do Ads, todos os anúncios do SKU) e o painel (sobra
//      de hoje × unidades, só anúncio com gasto): vendido abaixo do preço de hoje → "Prejuízo R$ 3,00" × "Lucro R$ 3,00"; e a venda atribuída a
//      um anúncio com gasto R$ 0 (outra campanha) entra só em ads.html → "Lucro R$ 50,00" × "Prejuízo R$ 10,00".
//   7) Sem o resumo do ML (falha da chamada campaigns/metrics): ads.html soma as campanhas e o painel soma os anúncios lidos → Investimento
//      R$ 100,00 × R$ 60,00 com a lista de anúncios em parte, e a linha "Total" do painel (R$ 60,00) ≠ soma das linhas (R$ 100,00).
//   8) P.adsDoFechamento e A.modelos usam Math.abs: mês com estorno de Product Ads maior que a cobrança (porTipo.ads = −15) aparece como
//      R$ 15,00 GASTOS em Product Ads (crédito virou gasto).
//   9) copiloto-nucleo motor.rateioAds: o último pedido leva o resto e o resto fica NEGATIVO quando as partes arredondam para cima
//      (R$ 3,15 em 30 pedidos iguais: 29 × R$ 0,11 e o último −R$ 0,04). A soma fecha, mas um pedido ganha Ads negativo.
// Rodar: node tests/copiloto/teste_centavos_ads.js
'use strict';
require('./relogio').fixar();
const path = require('path');
global.chrome = { storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } }, runtime: { sendMessage: async () => ({}) } };
const EXT = path.join(__dirname, '../../extension-copiloto');
const SHC = require(path.join(EXT, 'calc.js'));
['store.js', 'ml-extrator.js', 'fechamento.js', 'painel-lateral.js'].forEach(a => require(path.join(EXT, a)));
const A = require(path.join(EXT, 'ads.js'));
const NUC = path.join(__dirname, '../../copiloto-nucleo/src');
const MOTOR = require(path.join(NUC, 'motor.js'));
const ADML = require(path.join(NUC, 'adaptadores/ml.js'));
const P = SHC.pl;
let f = 0, nChecks = 0;
const ok = (c, m) => { nChecks++; console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) f++; };
// Propriedade sobre uma lista de casos: fn devolve true ou o texto do caso que falhou (o 1º vai na mensagem).
const prop = (nome, casos, fn) => {
    let ruim = 0, ex = '';
    casos.forEach((c, i) => { let r; try { r = fn(c, i); } catch (e) { r = 'erro: ' + (e && e.message); } if (r !== true) { ruim++; if (!ex) ex = String(r); } });
    ok(!ruim && casos.length > 0, nome + ` (${casos.length} casos)` + (ruim ? ` — ${ruim} falharam, ex.: ${ex}` : ''));
};
const vezes = n => [...Array(n).keys()];

// ── Régua independente do produto: centavos INTEIROS ──
const cent = v => Math.round(v * 100);   // só para valor que já deveria ter 2 casas (emCentavos prova isso)
const emCentavos = v => typeof v === 'number' && isFinite(v) && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
const milhar = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
// O R$ que a tela TEM de mostrar, montado só com inteiros: "R$ 1.234,56", "−R$ 0,05".
const reais = c => { const a = Math.abs(c); return (c < 0 ? '−' : '') + 'R$ ' + milhar(Math.floor(a / 100)) + ',' + String(a % 100).padStart(2, '0'); };
// Texto da tela → centavos inteiros ("R$ 1.234,56" → 123456; "−R$ 5,28" → −528; outra coisa → NaN).
const deMoeda = t => { const m = /^(−?)R\$\s(\d{1,3}(?:\.\d{3})*),(\d\d)$/.exec(String(t).trim()); return m ? (m[1] ? -1 : 1) * (Number(m[2].replace(/\./g, '')) * 100 + Number(m[3])) : NaN; };
// KPI em R$ inteiro ("R$ 1.433", "−R$ 2") → reais inteiros.
const deRs0 = t => { const m = /^(−?)R\$\s(\d{1,3}(?:\.\d{3})*)$/.exec(String(t).trim()); return m ? (m[1] ? -1 : 1) * Number(m[2].replace(/\./g, '')) : NaN; };
const dePct = t => { const m = /^(−?)(\d{1,3}(?:\.\d{3})*(?:,\d+)?)%$/.exec(String(t).trim()); return m ? (m[1] ? -1 : 1) * Number(m[2].replace(/\./g, '').replace(',', '.')) : NaN; };
const deX = t => { const m = /^(\d+(?:\.\d{3})*(?:,\d+)?)x$/.exec(String(t).trim()); return m ? Number(m[1].replace(/\./g, '').replace(',', '.')) : NaN; };
const deInt = t => (/^\d{1,3}(?:\.\d{3})*$/.test(String(t).trim()) ? Number(String(t).trim().replace(/\./g, '')) : NaN);
const semLixo = v => v === null || (typeof v === 'number' && isFinite(v));   // número de verdade ou null; nunca NaN/Infinity/undefined
const textoLimpo = h => !/NaN|undefined|Infinity|\bnull\b|R\$\s(?!\d)/.test(h);   // "R$ " sempre seguido de número ("em R$." é texto)
const tiraTags = s => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const celulas = linha => linha.split('</td>').map(tiraTags);
// Gerador com semente fixa (LCG de Numerical Recipes, 32 bits).
const semente = s => () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
const I = (rnd, a, b) => a + Math.floor(rnd() * (b - a + 1));
const escolhe = (rnd, l) => l[Math.floor(rnd() * l.length)];
// Métricas cruas do Mercado Ads (nomes da API) a partir de centavos inteiros.
const cru = x => ({ cost: x.costC / 100, totalAmount: x.recC / 100, directAmount: x.dirC / 100, indirectAmount: x.indC / 100, prints: x.imp, clicks: x.cli,
    unitsQuantity: x.v, directUnitsQuantity: x.vd, indirectUnitsQuantity: x.vi });
const CAMPOS = ['costC', 'recC', 'dirC', 'indC', 'imp', 'cli', 'v', 'vd', 'vi'];
const somaX = xs => { const s = {}; CAMPOS.forEach(k => { s[k] = xs.reduce((t, x) => t + x[k], 0); }); return s; };
// ads.js (investimento, receita…) × centavos do gerador, campo a campo.
const PAR = [['investimento', 'costC', 100], ['receita', 'recC', 100], ['receitaDireta', 'dirC', 100], ['receitaIndireta', 'indC', 100],
    ['impressoes', 'imp', 1], ['cliques', 'cli', 1], ['vendas', 'v', 1], ['vendasDiretas', 'vd', 1], ['vendasIndiretas', 'vi', 1]];
const bateM = (m, x, onde) => { for (const [k, kx, e] of PAR) { const v = m[k]; if (!(e === 100 ? emCentavos(v) && cent(v) === x[kx] : v === x[kx])) return `${onde}: ${k} ${v} ≠ ${e === 100 ? reais(x[kx]) : x[kx]}`; } return true; };

console.log('A. Régua: centavos inteiros × SHC.moeda, soma com SHC.r2 (A.soma) e A.rs0');
{
    const rnd = semente(101);
    prop('SHC.moeda(c ÷ 100) = texto montado só com inteiros, e lido de volta = c (negativo com "−", milhar com ponto)', vezes(3000), () => {
        const c = I(rnd, -99999999, 99999999), t = SHC.moeda(c / 100);
        return (t === reais(c) && deMoeda(t) === c) || `${c} → ${t}`;
    });
    prop('soma passo a passo com SHC.r2 (como A.soma) = soma em centavos inteiros (nem perde nem cria centavo)', vezes(2000), () => {
        const cs = vezes(I(rnd, 2, 40)).map(() => I(rnd, 0, 500000));
        const s = cs.reduce((t, c) => SHC.r2(t + c / 100), 0), certo = cs.reduce((t, c) => t + c, 0);
        return (emCentavos(s) && cent(s) === certo) || `${cs.join('+')} → ${s}`;
    });
    prop('A.rs0 (KPI em R$ inteiro, valor ≥ 0) = centavos arredondados ao real (meio real para cima)', vezes(2000), () => {
        const c = I(rnd, 0, 99999999), t = A.rs0(c / 100);
        return (deRs0(t) === Math.floor((c + 50) / 100) && t === 'R$ ' + milhar(Math.floor((c + 50) / 100))) || `${c} → ${t}`;
    });
    prop('A.rs0 de valor negativo fora do meio real = −(centavos arredondados) (o meio real é a divergência 1)', vezes(2000), () => {
        let c = -I(rnd, 1, 99999999); if (Math.abs(c) % 100 === 50) c -= 1;
        const t = A.rs0(c / 100), r = Math.floor((-c + 50) / 100);
        return (deRs0(t) === (r ? -r : 0)) || `${c} → ${t}`;
    });
    ok([null, undefined, NaN, Infinity, -Infinity].every(v => SHC.moeda(v) === '—' && A.rs0(v) === '—' && A.xTxt(v) === '—'),
        'vazio, NaN e Infinity viram "—" (SHC.moeda, A.rs0, A.xTxt): nunca "R$ 0,00", "R$ NaN" ou "Infinityx"');
}

console.log('B. Leitores do Mercado Ads no fundo (ml-extrator)');
{
    const rnd = semente(202);
    const casos = vezes(4000).map(() => {
        const imp = rnd() < 0.1 ? 0 : I(rnd, 1, 90000), cli = imp ? I(rnd, 0, Math.min(imp, 2000)) : 0;
        const costC = rnd() < 0.1 ? 0 : I(rnd, 1, 900000), dirC = rnd() < 0.15 ? 0 : I(rnd, 1, 3000000), indC = rnd() < 0.5 ? 0 : I(rnd, 1, 900000);
        const vd = dirC ? I(rnd, 1, 60) : 0, vi = indC ? I(rnd, 1, 20) : 0;
        return { costC, dirC, indC, recC: dirC + indC, imp, cli, vd, vi, v: vd + vi };
    });
    prop('SHC.adsMetricas: custo, receita (= direta + indireta) e vendas no centavo/unidade', casos, x => {
        const m = SHC.adsMetricas(cru(x));
        return (emCentavos(m.custo) && cent(m.custo) === x.costC && cent(m.receita) === x.recC && cent(m.receitaDireta) === x.dirC && cent(m.receitaIndireta) === x.indC
            && cent(m.receita) === cent(m.receitaDireta) + cent(m.receitaIndireta) && m.vendas === x.v && m.vendas === m.vendasDiretas + m.vendasIndiretas) || JSON.stringify(x);
    });
    prop('SHC.adsMetricas: CPC = custo ÷ cliques (em centavos), CTR = cliques ÷ impressões, ACOS = custo ÷ receita, ROAS = receita ÷ custo; ÷0 = null',
        casos, x => {
            const m = SHC.adsMetricas(cru(x)), d = 0.005 + 1e-9;
            const cpc = x.cli ? emCentavos(m.cpc) && Math.abs(m.cpc * 100 - x.costC / x.cli) <= 0.5 + 1e-9 : m.cpc === null;
            const ctr = x.imp ? Math.abs(m.ctr - x.cli / x.imp * 100) <= d : m.ctr === null;
            const acos = x.recC ? Math.abs(m.acos - x.costC / x.recC * 100) <= d : m.acos === null;
            const roas = x.costC ? Math.abs(m.roas - x.recC / x.costC) <= d : m.roas === null;
            return (cpc && ctr && acos && roas && Object.values(m).every(semLixo)) || `${JSON.stringify(x)} → cpc ${m.cpc} ctr ${m.ctr} acos ${m.acos} roas ${m.roas}`;
        });
    const ml = SHC.adsMetricas({ cost: 12.34, totalAmount: 100, prints: 1000, clicks: 10, acos: 12.5, roas: 8.2, ctr: 1.1, cpc: 1.3, tacos: 4.4 });
    ok(ml.acos === 12.5 && ml.roas === 8.2 && ml.ctr === 1.1 && ml.cpc === 1.3 && ml.tacos === 4.4, 'valor que o próprio ML mandou (acos, roas, ctr, cpc, tacos) fica o do ML');
    const semOrg = SHC.adsMetricas({ cost: 10, totalAmount: 50 }), comOrg = SHC.adsMetricas({ cost: 10, totalAmount: 50, organicUnitsQuantity: 0, organicUnitsAmount: 0 });
    ok(semOrg.vendasOrganicas === null && semOrg.receitaOrganica === null && semOrg.tacos === null && comOrg.vendasOrganicas === 0 && comOrg.receitaOrganica === 0,
        'orgânicas e TACOS que o ML não mandou ficam null (não lido); o 0 que o ML mandou fica 0');
    ok(SHC.adsResumo(null) === null && SHC.adsResumo({}) === null && SHC.adsResumo({ summary: {} }) === null,
        'SHC.adsResumo sem o resumo do ML → null (a tela soma as campanhas; nunca um total R$ 0,00)');
    const rs = SHC.adsResumo({ summary: { metricsSummary: { cost: 1234.56, totalAmount: 9876.54, prints: 5, clicks: 2 } }, daily: { results: [{ date: '2026-09-01T00:00:00', cost: 0.01, totalAmount: 0 }, { date: 'x', cost: 9 }] } });
    ok(cent(rs.total.custo) === 123456 && cent(rs.total.receita) === 987654 && rs.diario.length === 1 && rs.diario[0].acos === null && rs.diario[0].roas === 0,
        'SHC.adsResumo: total no centavo; dia sem venda com gasto → ACOS null e ROAS 0; dia sem data fica fora');
    const sh = SHC.adsShare({ impressionShare: 0.6234, lostImpressionShareByBudget: 0.25, lostImpressionShareByAdRank: 0.1266, topImpressionShare: 0.3 });
    ok(sh.ganhas === 62.34 && sh.perdidasOrcamento === 25 && sh.perdidasClassificacao === 12.66 && sh.topo === 30 && SHC.adsShare({}) === null,
        'SHC.adsShare: fração do ML → % com 2 casas (62,34 + 25 + 12,66 = 100); sem dado → null');
    const an = SHC.adsAnuncios({ paging: { total: 2 }, results: [{ id: 'MLB9900000001', title: 'Item teste', cost: 1 }, { id: 'MLB1234567', type: 'catalog', userId: 0, title: 'Catálogo teste', cost: 2.5 }, { id: 'xx', cost: 7 }] });
    ok(an.anuncios.length === 2 && an.anuncios[0].itemId === 'MLB9900000001' && an.anuncios[1].itemId === '' && an.anuncios[1].produtoCatalogoId === 'MLB1234567'
        && cent(an.anuncios[1].custo) === 250 && an.total === 2, 'SHC.adsAnuncios: catálogo sem MLB do seller (itemId vazio), id inválido fica fora, custo no centavo');
}

console.log('C. ads.js A.metricas: ACOS, ROAS, TACOS, CTR e CPC');
{
    const rnd = semente(303);
    const casos = vezes(4000).map(() => {
        const imp = rnd() < 0.1 ? 0 : I(rnd, 1, 90000), cli = imp ? I(rnd, 0, Math.min(imp, 2000)) : 0;
        return { invC: rnd() < 0.1 ? 0 : I(rnd, 1, 900000), recC: rnd() < 0.15 ? 0 : I(rnd, 1, 3000000), orgC: rnd() < 0.2 ? 0 : I(rnd, 1, 9000000), imp, cli };
    });
    prop('ACOS = investimento ÷ receita × 100; ROAS = receita ÷ investimento; TACOS = investimento ÷ (receita + orgânicas) × 100; CTR; CPC; ÷0 = null',
        casos, x => {
            const m = A.metricas({ investimento: x.invC / 100, receita: x.recC / 100, organicasValor: x.orgC / 100, impressoes: x.imp, cliques: x.cli }), e = 1e-9;
            const acos = x.recC ? Math.abs(m.acos - x.invC / x.recC * 100) < e : m.acos === null;
            const roas = x.invC ? Math.abs(m.roas - x.recC / x.invC) < e : m.roas === null;
            const tacos = x.recC + x.orgC ? Math.abs(m.tacos - x.invC / (x.recC + x.orgC) * 100) < e : m.tacos === null;
            const ctr = x.imp ? Math.abs(m.ctr - x.cli / x.imp * 100) < e : m.ctr === null;
            const cpc = x.cli ? Math.abs(m.cpc * 100 - x.invC / x.cli) < 1e-7 : m.cpc === null;
            return (acos && roas && tacos && ctr && cpc && Object.values(m).every(semLixo)) || JSON.stringify(x) + ' → ' + JSON.stringify(m);
        });
    const zero = A.metricas({ cost: 0, totalAmount: 0, acos: 0, roas: 0 }), gastoSemVenda = A.metricas({ cost: 15, totalAmount: 0, acos: 0 }), vendaSemGasto = A.metricas({ cost: 0, totalAmount: 50, roas: 0 });
    ok(zero.acos === null && zero.roas === null, 'sem gasto e sem venda: ACOS e ROAS null mesmo com o 0 do ML (o 0 engana)');
    ok(gastoSemVenda.acos === null && gastoSemVenda.roas === 0 && vendaSemGasto.roas === null && vendaSemGasto.acos === 0,
        'gasto sem venda: ACOS null e ROAS 0; venda sem gasto: ROAS null e ACOS 0 (nunca Infinity)');
    ok(A.metricas(null) === null && A.metricas({}) === null && A.metricas({ total: null }) === null, 'sem número nenhum: null (não um total R$ 0,00)');
    ok(/Sem totais do período/.test(A.htmlKpis({ atual: null, anterior: null })) && /Sem totais do período/.test(A.htmlKpis4({ kpis: { atual: null }, res: {} })),
        'sem totais: a tela diz "Sem totais do período" (nenhum R$ inventado)');
    const vazio = A.metricas({ cost: 10 });
    ok(vazio.receita === null && vazio.acos === null && vazio.roas === null && vazio.cpc === null && vazio.ctr === null && vazio.tacos === null,
        'receita, cliques e impressões não lidos: ACOS, ROAS, CPC, CTR e TACOS null (não 0)');
}

// ── D–G: contas geradas. Cada uma tem campanhas, anúncios (vários por SKU, de catálogo ligado e sem ligação, fora da lista), resumo do ML
// (ou não), 30 dias antes, custos (alguns faltando) e imposto/meta. A verdade de cada número fica em centavos inteiros no gerador. ──
function geraConta(k, rnd) {
    const coerente = rnd() < 0.75;   // receita do Ads = preço de hoje × vendas (sem promoção no período)
    const multi = rnd() < 0.3;       // SKU com mais de um anúncio (MLB)
    const comResumo = rnd() < 0.8, comOrganicas = comResumo && rnd() < 0.5, tacosMl = comOrganicas && rnd() < 0.5, comAnt = rnd() < 0.8;
    const cfg = { imposto_pct: escolhe(rnd, [0, 4, 6.5]), margem_alvo_pct: escolhe(rnd, [0, 10, 15]) };
    const camps = vezes(I(rnd, 1, 4)).map(i => ({ id: 700000 + k * 10 + i, name: `Campanha teste ${k}-${i}`, status: rnd() < 0.75 ? 'A' : 'P',
        strategy: escolhe(rnd, ['PROFITABILITY', 'GROWTH', 'VISIBILITY']), orcC: rnd() < 0.85 ? I(rnd, 500, 30000) : null, roasTarget: I(rnd, 2, 12) }));
    const itens = [], custos = new Map(), ads = [];
    const metr = precoC => {
        const vd = rnd() < 0.25 ? 0 : I(rnd, 1, 6), vi = rnd() < 0.7 ? 0 : I(rnd, 1, 2), imp = rnd() < 0.08 ? 0 : I(rnd, 1, 9000), cli = imp ? I(rnd, 0, Math.min(imp, 400)) : 0;
        const costC = rnd() < 0.1 ? 0 : I(rnd, 1, 60000);
        const pagos = costC > 0;   // anúncio com gasto 0 não tem venda pelo Ads (ver divergência 6)
        const dirC = !pagos || !vd ? 0 : (coerente ? precoC * vd : I(rnd, 1, 90000)), indC = !pagos || !vi ? 0 : (coerente ? precoC * vi : I(rnd, 1, 30000));
        return { costC, dirC, indC, recC: dirC + indC, imp, cli, vd: pagos ? vd : 0, vi: pagos ? vi : 0, v: pagos ? vd + vi : 0 };
    };
    const chaveDe = it => (it.sku ? 'sku:' + it.sku : 'mlb:' + it.itemId);
    const nSku = I(rnd, 1, 8);
    for (let j = 0; j < nSku; j++) {
        const sku = rnd() < 0.85 ? `TST-${k}-${j}` : '';
        for (let m = 0; m < (multi && sku ? I(rnd, 1, 3) : 1); m++) {
            const precoC = I(rnd, 1990, 39990), tarifaC = Math.round(precoC * 0.13) + (precoC < 7900 ? 650 : 0), freteC = precoC >= 7900 ? I(rnd, 0, 2500) : 0;
            const it = { itemId: 'MLB9' + String(k * 1000 + j * 10 + m).padStart(9, '0'), sku, titulo: `Produto teste ${k}-${j}-${m}`, preco: precoC / 100, recebe: (precoC - tarifaC - freteC) / 100, precoC };
            itens.push(it);
            if (rnd() < 0.8) custos.set(it.itemId, { custo: I(rnd, 200, Math.round((precoC - tarifaC - freteC) * 1.1)) / 100, outros: rnd() < 0.3 ? I(rnd, 0, 500) / 100 : 0 });
            const cs = camps.slice().sort(() => rnd() - 0.5).slice(0, I(rnd, 0, Math.min(2, camps.length)));   // até 2 campanhas diferentes
            cs.forEach(c => ads.push(Object.assign(metr(precoC), { raw: { id: it.itemId, title: it.titulo, status: 'active', campaignId: c.id, userId: 123 }, camp: c.id, it, chave: chaveDe(it) })));
        }
    }
    if (rnd() < 0.5) {   // catálogo: id do produto de catálogo, ligado pelo título de um anúncio da lista
        const it = escolhe(rnd, itens), c = escolhe(rnd, camps), id = 'MLB' + (2000000 + k * 10 + 1);
        ads.push(Object.assign(metr(it.precoC), { raw: { id, title: it.titulo, type: 'catalog', userId: 0, status: 'active', campaignId: c.id }, camp: c.id, it, chave: chaveDe(it), catalogo: 'ligado' }));
    }
    if (rnd() < 0.4) {   // catálogo sem ligação (título que nenhum anúncio da lista tem)
        const c = escolhe(rnd, camps), id = 'MLB' + (2000000 + k * 10 + 2);
        ads.push(Object.assign(metr(I(rnd, 1990, 39990)), { raw: { id, title: `Catálogo sem ligação ${k}`, type: 'catalog', userId: 0, status: 'active', campaignId: c.id }, camp: c.id, it: null, chave: 'ad:' + id, catalogo: 'solto' }));
    }
    if (rnd() < 0.3) {   // anúncio fora da lista de Anúncios lida
        const c = escolhe(rnd, camps), id = 'MLB8' + String(k * 1000 + 999).padStart(9, '0');
        ads.push(Object.assign(metr(I(rnd, 1990, 39990)), { raw: { id, title: `Anúncio fora da lista ${k}`, status: 'active', campaignId: c.id, userId: 123 }, camp: c.id, it: null, chave: 'ad:' + id }));
    }
    const porCamp = new Map(camps.map(c => [c.id, somaX(ads.filter(a => a.camp === c.id))]));
    const tot = somaX(ads);
    const orgUn = I(rnd, 0, 300), orgC = I(rnd, 0, 900000);
    const resumoCru = Object.assign(cru(tot), comOrganicas ? { organicUnitsQuantity: orgUn, organicUnitsAmount: orgC / 100 } : {},
        tacosMl && tot.recC + orgC > 0 ? { tacos: SHC.r2(tot.costC / (tot.recC + orgC) * 100) } : {});
    const campsF = SHC.adsCampanhas({ paging: { total: camps.length }, results: camps.map(c => ({ id: c.id, name: c.name, status: c.status, strategy: c.strategy,
        dailyBudget: c.orcC === null ? undefined : c.orcC / 100, roasTarget: c.roasTarget, metrics: cru(porCamp.get(c.id)) })) }).campanhas;
    campsF.forEach(c => { c.share = rnd() < 0.6 ? SHC.adsShare({ impressionShare: 0.5, lostImpressionShareByBudget: escolhe(rnd, [0.05, 0.3]), lostImpressionShareByAdRank: 0.2 }) : null; });
    // 30 dias antes: métricas por campanha (fundo: anterior.campanhas[id] = metricas) e o total do resumo de antes (ou não).
    const antes = new Map(camps.map(c => [c.id, { costC: I(rnd, 0, 200000), recC: I(rnd, 0, 900000), dirC: 0, indC: 0, imp: I(rnd, 0, 50000), cli: I(rnd, 0, 300), v: I(rnd, 0, 40), vd: 0, vi: 0 }]));
    const totAnt = somaX([...antes.values()]);
    const porIdAnt = {};
    SHC.adsCampanhas({ results: camps.map(c => ({ id: c.id, name: c.name, status: c.status, metrics: cru(antes.get(c.id)) })) }).campanhas.forEach(c => { porIdAnt[c.id] = c.metricas; });
    const snap = { ts: Date.parse('2026-09-25T09:00:00-03:00'), temAds: true, periodo: { de: '2026-08-27', ate: '2026-09-25' }, campanhas: campsF,
        anuncios: SHC.adsAnuncios({ paging: { total: ads.length }, results: ads.map(a => Object.assign({}, a.raw, cru(a))) }).anuncios,
        resumo: comResumo ? SHC.adsResumo({ summary: { metricsSummary: resumoCru }, daily: { results: [] } }) : null, completo: true,
        anterior: { periodo: { de: '2026-07-28', ate: '2026-08-26' }, campanhas: porIdAnt, total: comAnt ? SHC.adsMetricas(cru(totAnt)) : null } };
    const custoDe = it => custos.get(it.itemId) || null;
    const sobraDe = it => SHC.sobraAnuncio(it, custoDe(it), cfg);
    const an = A.analisa(snap, itens, custoDe, cfg, []);
    const snapP = P.adsLigaCatalogo(snap, itens), lista = P.adsEquilibrio(snapP, itens, sobraDe);
    return { k, coerente, multi, comResumo, comOrganicas, tacosMl, comAnt, cfg, camps, itens, custos, ads, porCamp, tot, orgUn, orgC, antes, totAnt, snap, custoDe, sobraDe, an, snapP, lista,
        contaP: P.adsConta(snapP), campsP: P.adsCampanhasLista(snapP, lista) };
}
const rndContas = semente(404);
const contas = vezes(120).map(k => geraConta(k, rndContas));
const porChave = c => { const g = new Map(); c.ads.forEach(a => { (g.get(a.chave) || g.set(a.chave, []).get(a.chave)).push(a); }); return new Map([...g].map(([k, l]) => [k, somaX(l)])); };
console.log(`   (${contas.length} contas geradas: ${contas.reduce((t, c) => t + c.ads.length, 0)} anúncios, ${contas.reduce((t, c) => t + c.an.grupos.length, 0)} SKUs, `
    + `${contas.filter(c => !c.comResumo).length} sem o resumo do ML, ${contas.filter(c => c.multi).length} com SKU de vários anúncios)`);

console.log('D. Σ por SKU = Σ anúncios = resumo do ML = Σ campanhas (ads.js A.analisa)');
{
    prop('cada SKU (A.porSku) soma os anúncios dele, campo a campo, no centavo (catálogo ligado pelo título entra no SKU certo)', contas, c => {
        const certo = porChave(c);
        if (c.an.grupos.length !== certo.size) return `conta ${c.k}: ${c.an.grupos.length} SKUs ≠ ${certo.size}`;
        for (const g of c.an.grupos) { if (!certo.has(g.chave)) return `conta ${c.k}: chave ${g.chave} inesperada`; const r = bateM(g.m, certo.get(g.chave), `conta ${c.k} ${g.chave}`); if (r !== true) return r; }
        return true;
    });
    prop('Σ dos SKUs = total da conta (KPI: resumo do ML ou Σ campanhas) = Σ campanhas, campo a campo', contas, c => {
        const s = {}; PAR.forEach(([k]) => { s[k] = SHC.r2(c.an.grupos.reduce((t, g) => t + g.m[k], 0)); });
        const somaG = { costC: cent(s.investimento), recC: cent(s.receita), dirC: cent(s.receitaDireta), indC: cent(s.receitaIndireta), imp: s.impressoes, cli: s.cliques, v: s.vendas, vd: s.vendasDiretas, vi: s.vendasIndiretas };
        const ok1 = CAMPOS.every(k => somaG[k] === c.tot[k]), kp = bateM(c.an.kpis.atual, c.tot, `conta ${c.k} KPI`);
        const camp = c.an.camps.map(x => bateM(x.m, c.porCamp.get(Number(x.id)), `conta ${c.k} campanha ${x.id}`)).find(r => r !== true);
        return (ok1 && kp === true && !camp) || (ok1 ? kp !== true ? kp : camp : `conta ${c.k}: Σ SKUs ≠ total`);
    });
    prop('sem o resumo do ML, o total da conta é a Σ das campanhas (A.kpis); com ele, é o do ML', contas, c => {
        const semRes = A.kpis(Object.assign({}, c.snap, { resumo: null }), c.an.camps).atual;
        return bateM(semRes, c.tot, `conta ${c.k} sem resumo`);
    });
    prop('razões de cada SKU a partir das próprias somas: ACOS = Ads ÷ receita, ROAS = receita ÷ Ads, CTR, CPC (÷0 = null, nunca NaN/Infinity)', contas, c => {
        const certo = porChave(c), e = 1e-9;
        for (const g of c.an.grupos) {
            const x = certo.get(g.chave), m = g.m;
            const bom = (x.recC ? Math.abs(m.acos - x.costC / x.recC * 100) < e : m.acos === null) && (x.costC ? Math.abs(m.roas - x.recC / x.costC) < e : m.roas === null)
                && (x.imp ? Math.abs(m.ctr - x.cli / x.imp * 100) < e : m.ctr === null) && (x.cli ? Math.abs(m.cpc * 100 - x.costC / x.cli) < 1e-7 : m.cpc === null)
                && Object.values(m).every(semLixo);
            if (!bom) return `conta ${c.k} ${g.chave}: ${JSON.stringify(m)}`;
        }
        return true;
    });
    prop('ACOS/ROAS da conta: ACOS = Ads ÷ receita (gravado com 2 casas), ROAS = receita ÷ Ads; TACOS = Ads ÷ (receita + orgânicas) quando as orgânicas foram lidas', contas, c => {
        const a = c.an.kpis.atual, x = c.tot, d = 0.005 + 1e-9;
        const acos = x.recC ? Math.abs(a.acos - x.costC / x.recC * 100) <= d : a.acos === null;
        const roas = x.costC ? Math.abs(a.roas - x.recC / x.costC) <= d : a.roas === null;
        const tacos = !c.comOrganicas ? true : (x.recC + c.orgC ? Math.abs(a.tacos - x.costC / (x.recC + c.orgC) * 100) <= d : a.tacos === null);
        const org = !c.comOrganicas || (cent(a.organicasValor) === c.orgC && a.organicasUn === c.orgUn);
        return (acos && roas && tacos && org) || `conta ${c.k}: ${JSON.stringify(a)}`;
    });
    prop('orçamento diário da conta = Σ orçamento das campanhas ATIVAS (pausada e sem orçamento ficam fora), no centavo', contas, c => {
        const at = c.camps.filter(x => x.status === 'A'), soma = at.filter(x => x.orcC > 0).reduce((t, x) => t + x.orcC, 0), k = c.an.kpis;
        return ((soma ? emCentavos(k.orcamentoDia) && cent(k.orcamentoDia) === soma : k.orcamentoDia === null) && k.campanhasAtivas === at.length) || `conta ${c.k}: ${k.orcamentoDia} ≠ ${reais(soma)}`;
    });
    prop('30 dias antes = resumo de antes ou, sem ele, Σ campanhas de antes (investimento, receita, vendas)', contas, c => {
        const b = c.an.kpis.anterior;
        return (b && cent(b.investimento) === c.totAnt.costC && cent(b.receita) === c.totAnt.recC && b.vendas === c.totAnt.v) || `conta ${c.k}: ${JSON.stringify(b)}`;
    });
}

console.log('E. Montante por SKU e resultado da conta (A.montante, A.resultado)');
{
    const grupos = contas.flatMap(c => c.an.grupos.map(g => ({ c, g })));
    prop('SKU com custo: sobra antes do Ads = margem × receita do Ads (±½ centavo), lucro = sobra − Ads no centavo, Ads = investimento', grupos.filter(x => x.g.margem !== null), ({ c, g }) => {
        const sobraExata = g.m.receita * 100 * g.margem / 100;   // em centavos, sem arredondar
        return (emCentavos(g.sobraRs) && emCentavos(g.lucroRs) && emCentavos(g.adsRs) && cent(g.adsRs) === cent(g.m.investimento)
            && Math.abs(cent(g.sobraRs) - sobraExata) <= 0.5 + 1e-6 && cent(g.lucroRs) === cent(g.sobraRs) - cent(g.adsRs)) || `conta ${c.k} ${g.chave}: ${g.sobraRs} − ${g.adsRs} = ${g.lucroRs}`;
    });
    prop('SKU sem custo ou fora da lista: sobra e lucro null (nunca R$ 0,00), Ads continua o investimento', grupos.filter(x => x.g.margem === null), ({ c, g }) =>
        (g.sobraRs === null && g.lucroRs === null && cent(g.adsRs) === cent(g.m.investimento) && (g.selos.includes('semCusto') || g.selos.includes('semAnuncio'))) || `conta ${c.k} ${g.chave}`);
    prop('margem do SKU = a PIOR sobra ÷ preço dos anúncios dele (SHC.sobraAnuncio; equilíbrio = margem)', grupos.filter(x => x.g.itens.length), ({ c, g }) => {
        const ss = g.itens.map(it => c.sobraDe(it));
        const certo = ss.every(s => s && s.sobra !== null) ? Math.min(...ss.map(s => s.sobra / g.itens[ss.indexOf(s)].preco * 100)) : null;
        return ((certo === null ? g.margem === null : Math.abs(g.margem - certo) < 1e-9) && g.equilibrio === g.margem && ss.every(s => !s || s.sobra === null || emCentavos(s.sobra))) || `conta ${c.k} ${g.chave}`;
    });
    prop('A.resultado: sobra = Σ sobras, Ads = Σ Ads, lucro = sobra − Ads = Σ lucros dos SKUs (com gasto e custo), no centavo', contas, c => {
        const r = c.an.res, cc = c.an.grupos.filter(g => g.m.investimento > 0 && g.lucroRs !== null);
        const s = cc.reduce((t, g) => t + cent(g.sobraRs), 0), a = cc.reduce((t, g) => t + cent(g.adsRs), 0), l = cc.reduce((t, g) => t + cent(g.lucroRs), 0);
        const rec = cc.reduce((t, g) => t + cent(g.m.receita), 0);
        return (r.comCusto === cc.length && cent(r.sobra) === s && cent(r.ads) === a && (cc.length ? cent(r.lucro) === l && l === s - a : r.lucro === null)
            && (rec ? Math.abs(r.equilibrio - s / rec * 100) < 1e-9 : r.equilibrio === null) && r.acima === cc.filter(g => g.lucroRs < 0).length
            && r.semCusto === c.an.grupos.filter(g => g.m.investimento > 0 && g.selos.includes('semCusto')).length) || `conta ${c.k}: ${JSON.stringify(r)}`;
    });
    prop('selo "Acima do equilíbrio" ⇔ lucro depois do Ads < 0 (SKU com custo, gasto e venda; lucro ≠ R$ 0,00 — divergência 2)', grupos.filter(x => x.g.margem !== null && x.g.m.investimento > 0 && x.g.m.receita > 0 && x.g.lucroRs !== 0),
        ({ c, g }) => (g.selos.includes('acima') === (g.lucroRs < 0)) || `conta ${c.k} ${g.chave}: lucro ${g.lucroRs}, selos ${g.selos}`);
    prop('texto do montante (A.textoMontante) = os números: "Ads R$ X · Lucro R$ Y" | "Prejuízo R$ Y" (positivo) | "sem custo"', grupos, ({ c, g }) => {
        const m = /^Ads (.+?) · (?:(Lucro|Prejuízo) (.+)|sem custo)$/.exec(A.textoMontante(g));
        if (!m || deMoeda(m[1]) !== cent(g.adsRs)) return `conta ${c.k} ${g.chave}: ${A.textoMontante(g)}`;
        if (g.lucroRs === null) return !m[2] || A.textoMontante(g);
        return ((g.lucroRs < 0 ? m[2] === 'Prejuízo' && deMoeda(m[3]) === -cent(g.lucroRs) : m[2] === 'Lucro' && deMoeda(m[3]) === cent(g.lucroRs))) || A.textoMontante(g);
    });
}

console.log('F. Texto da tela de ads.html = os números da conta');
{
    const kpi = (h, nome) => { const m = new RegExp('<span class="kn">' + nome + '</span><b>(.*?)</b>(?:<span class="ka">30 dias antes: (.*?)</span>)?').exec(h); return m ? [tiraTags(m[1]), m[2] === undefined ? null : tiraTags(m[2])] : [null, null]; };
    prop('"Todos os números" (A.htmlKpis): Investimento, Receita, CPC e orçamento diário = moeda do número; ROAS, ACOS, impressões e cliques idem; 30 dias antes também', contas, c => {
        const h = A.htmlKpis(c.an.kpis), a = c.an.kpis.atual, b = c.an.kpis.anterior;
        const [inv, invA] = kpi(h, 'Investimento'), [rec, recA] = kpi(h, 'Receita'), [cpc] = kpi(h, 'CPC'), [orc] = kpi(h, 'Orçamento diário total');
        const [roas] = kpi(h, 'ROAS'), [acos] = kpi(h, 'ACOS'), [imp] = kpi(h, 'Impressões'), [cli] = kpi(h, 'Cliques');
        const bom = deMoeda(inv) === c.tot.costC && deMoeda(rec) === c.tot.recC && deMoeda(invA) === c.totAnt.costC && deMoeda(recA) === c.totAnt.recC
            && (a.cpc === null ? cpc === '—' : deMoeda(cpc) === cent(SHC.r2(a.cpc)) && Math.abs(deMoeda(cpc) - c.tot.costC / c.tot.cli) <= 0.5 + 1e-9)
            && (c.an.kpis.orcamentoDia === null ? /^—/.test(orc) : deMoeda(orc.replace(/ \(.*$/, '')) === cent(c.an.kpis.orcamentoDia))
            && (a.roas === null ? roas === '—' : Math.abs(deX(roas) - a.roas) <= 0.005 + 1e-9) && (a.acos === null ? acos === '—' : Math.abs(dePct(acos) - a.acos) <= 0.05 + 1e-9)
            && deInt(imp) === c.tot.imp && deInt(cli) === c.tot.cli && b !== null;
        return (bom && textoLimpo(h)) || `conta ${c.k}: inv ${inv} rec ${rec} cpc ${cpc} orc ${orc} roas ${roas} acos ${acos}`;
    });
    prop('KPIs de cima (A.htmlKpis4): Investimento e Receita em R$ inteiro, lucro = A.rs0(lucro), "sobra R$ a − Ads R$ b" = A.rs0 de cada um, variação vs 30 dias antes', contas, c => {
        const h = A.htmlKpis4(c.an), r = c.an.res, v = l => { const m = new RegExp('<div class="l">' + l + '</div><div class="v">(.*?)</div><div class="s">(.*?)</div>').exec(h); return m ? [tiraTags(m[1]), tiraTags(m[2])] : [null, null]; };
        const [inv, invS] = v('Investimento'), [rec] = v('Receita pelo Ads'), [luc, lucS] = v('Lucro depois do Ads ⓘ');
        const rs0c = cc => Math.sign(cc) * Math.floor((Math.abs(cc) + 50) / 100);
        let bom = deRs0(inv) === rs0c(c.tot.costC) && deRs0(rec) === rs0c(c.tot.recC);
        if (r.lucro === null) bom = bom && luc === '—' && /informe o custo/.test(lucS);
        else {
            const m = /^sobra (.+?) − Ads (R\$ [\d.]+)/.exec(lucS);
            bom = bom && luc === A.rs0(r.lucro) && !!m && m[1] === A.rs0(r.sobra) && m[2] === A.rs0(r.ads) && (Math.abs(cent(r.lucro)) % 100 === 50 || deRs0(luc) === rs0c(cent(r.lucro)));
        }
        const pv = /^([▲▼]) (.+) vs 30 dias antes$/.exec(invS), a0 = c.tot.costC, b0 = c.totAnt.costC;
        bom = bom && (b0 > 0 ? !!pv && pv[1] === (a0 >= b0 ? '▲' : '▼') && Math.abs(dePct(pv[2]) - Math.abs(a0 - b0) / b0 * 100) <= 0.05 + 1e-9 : invS === '');
        return (bom && textoLimpo(h)) || `conta ${c.k}: ${inv} · ${rec} · ${luc} (${lucS}) · ${invS}`;
    });
    prop('manchete: "prejuízo de R$ N" / "lucro de R$ N" = o mesmo número do KPI "Lucro depois do Ads" (fora do meio real — divergência 1)', contas.filter(c => c.an.res.lucro !== null && Math.abs(cent(c.an.res.lucro)) % 100 !== 50), c => {
        const mc = c.an.manchete, r = c.an.res, kp = deRs0(A.rs0(r.lucro));
        const m = /dá (prejuízo|lucro) de (R\$ [\d.]+)/.exec(mc.fato);
        if (r.lucro < 0) return (!!m && m[1] === 'prejuízo' && -deRs0(m[2]) === kp && mc.cls === 'pr') || `conta ${c.k}: ${mc.fato} × KPI ${A.rs0(r.lucro)}`;
        if (r.acima) return (/^O Ads dá lucro, mas/.test(mc.fato) && mc.cls === 'at') || mc.fato;
        return (!!m && m[1] === 'lucro' && deRs0(m[2]) === kp && mc.cls === 'ok') || `conta ${c.k}: ${mc.fato} × KPI ${A.rs0(r.lucro)}`;
    });
    prop('tabela por SKU (A.htmlSkusTabela): impressões, cliques, CPC, investimento, receita, vendas, ROAS e ACOS de cada linha = os números do SKU', contas, c => {
        const linhas = A.htmlSkusTabela(c.an.grupos).split('<tr><td class="tit">').slice(1), certo = porChave(c);
        if (linhas.length !== c.an.grupos.length) return `conta ${c.k}: ${linhas.length} linhas`;
        for (let i = 0; i < linhas.length; i++) {
            const g = c.an.grupos[i], x = certo.get(g.chave), cl = celulas(linhas[i]);
            const bom = deInt(cl[1]) === x.imp && deInt(cl[2]) === x.cli && deMoeda(cl[5]) === x.costC && deMoeda(cl[6]) === x.recC && deInt(cl[7]) === x.v
                && (x.cli ? Math.abs(deMoeda(cl[4]) - x.costC / x.cli) <= 0.5 + 1e-9 : cl[4] === '—')
                && (x.costC ? Math.abs(deX(cl[8]) - x.recC / x.costC) <= 0.005 + 1e-9 : cl[8] === '—') && (x.recC ? Math.abs(dePct(cl[9]) - x.costC / x.recC * 100) <= 0.05 + 1e-9 : cl[9] === '—')
                && (g.margem === null ? cl[10] === '—' && cl[11] === '—' : true);
            if (!bom || !textoLimpo(linhas[i])) return `conta ${c.k} ${g.chave}: ${cl.slice(1).join(' | ')}`;
        }
        return true;
    });
    prop('tabela de campanhas (A.htmlCampanhas): orçamento/dia, investimento e receita = os números da campanha; ROAS e ACOS = os dela', contas, c => {
        const linhas = A.htmlCampanhas(c.an.camps).split('<tr><td class="tit">').slice(1);
        for (let i = 0; i < c.an.camps.length; i++) {
            const k = c.an.camps[i], x = c.porCamp.get(Number(k.id)), cl = celulas(linhas[i].split('</tr>')[0]), orc = c.camps.find(z => String(z.id) === k.id).orcC;
            const bom = deMoeda(cl[10]) === x.costC && deMoeda(cl[11]) === x.recC && (orc === null ? cl[2] === '—' : deMoeda(cl[2]) === orc)
                && (k.m.roas === null ? cl[4] === '—' : Math.abs(deX(cl[4]) - k.m.roas) <= 0.005 + 1e-9) && (k.m.acos === null ? cl[5] === '—' : Math.abs(dePct(cl[5]) - k.m.acos) <= 0.05 + 1e-9);
            if (!bom) return `conta ${c.k} campanha ${k.id}: ${cl.join(' | ')}`;
        }
        return textoLimpo(A.htmlCampanhas(c.an.camps)) || 'lixo no HTML';
    });
    prop('"Precisa de você" (A.acao): o R$ do texto ("Ads R$ X", "gastou R$ X") = investimento do SKU; ROAS sugerido = 1 ÷ margem', contas.flatMap(c => c.an.grupos.filter(g => g.acao).map(g => ({ c, g }))), ({ c, g }) => {
        const tx = g.acao.tx, m = /(?:^Ads|gastou) (R\$ [\d.]+,\d\d)/.exec(tx), r = /mais de (.+)$/.exec(tx);
        if (m && deMoeda(m[1]) !== cent(g.m.investimento)) return `conta ${c.k} ${g.chave}: ${tx}`;
        if (g.acao.tipo === 'ajustar' && !(r && Math.abs(deX(r[1]) - 100 / g.margem) <= 0.005 + 1e-9)) return `conta ${c.k} ${g.chave}: ${tx}`;
        return ((g.acao.tipo === 'custo' || /gastou/.test(tx) ? !!m : true) && textoLimpo(tx)) || tx;
    });
    prop('proposta (A.proposta): ROAS objetivo = 1 ÷ (margem − meta) entre 2x e 35x, com 2 casas, e o texto mostra esse número', contas.flatMap(c => c.an.proposta.map(p => ({ c, p }))), ({ c, p }) => {
        if (p.roas === null) return (!/ROAS objetivo de pelo menos/.test(p.motivo) && textoLimpo(p.motivo)) || p.motivo;
        const folga = p.margem - c.cfg.margem_alvo_pct, certo = Math.min(35, Math.max(2, 100 / folga));
        return (emCentavos(p.roas) && Math.abs(p.roas - certo) <= 0.005 + 1e-9 && p.motivo.indexOf('pelo menos ' + A.xTxt(p.roas)) > 0 && Math.abs(deX(A.xTxt(p.roas)) - p.roas) < 1e-9) || `conta ${c.k}: ${p.roas} ${p.motivo}`;
    });
    // leitura da campanha: "testar orçamento de R$ X para R$ Y" (Y = X × 1,25)
    {
        const casoFixo = A.leituraCampanha({ id: '1', m: { acos: 5, investimento: 10, vendas: 1 }, share: { orcamento: 30 }, orcamentoDia: 33.33 },
            [{ margem: 40, ads: [{ campanhaId: '1', m: { receita: 100 } }] }], { margem_alvo_pct: 10 });
        const leituras = contas.flatMap(c => c.an.camps.map(k => ({ c, k }))).concat([{ c: { k: 'fixo' }, k: { orcamentoDia: 33.33, leitura: casoFixo } }]);
        const comOrc = leituras.filter(({ k }) => k.leitura.linhas.some(t => /testar orçamento/.test(t)));
        prop('leitura da campanha: "orçamento de R$ X para R$ Y por dia" com X = orçamento/dia e Y = X × 1,25 (±½ centavo)', comOrc, ({ c, k }) => {
            const m = /orçamento de (R\$ [\d.]+,\d\d) para (R\$ [\d.]+,\d\d) por dia/.exec(k.leitura.linhas.join(' '));
            return (!!m && deMoeda(m[1]) === cent(k.orcamentoDia) && Math.abs(deMoeda(m[2]) - cent(k.orcamentoDia) * 1.25) <= 0.5 + 1e-9) || `conta ${c.k}: ${k.leitura.linhas.join(' ')}`;
        });
        ok(/de R\$ 33,33 para R\$ 41,66 por dia/.test(casoFixo.linhas.join(' ')) && casoFixo.equilibrio === 40, 'caso fixo: R$ 33,33 × 1,25 = R$ 41,6625 → "R$ 41,66"; equilíbrio = margem pesada pela receita (40%)');
        prop('equilíbrio da campanha = Σ (receita do Ads × margem) ÷ Σ receita dos SKUs com custo (null sem nenhum)', contas.flatMap(c => c.an.camps.map(k => ({ c, k }))), ({ c, k }) => {
            let p = 0, s = 0;
            c.an.grupos.forEach(g => { if (g.margem === null) return; const rec = g.ads.filter(a => a.campanhaId === k.id).reduce((t, a) => t + cent(a.m.receita), 0); if (rec > 0) { p += rec; s += rec * g.margem; } });
            return (p ? Math.abs(k.leitura.equilibrio - s / p) < 1e-9 : k.leitura.equilibrio === null) || `conta ${c.k} campanha ${k.id}`;
        });
    }
    prop('página inteira (A.htmlPagina): sem NaN, undefined, Infinity, null nem "R$" sem número', contas, c => {
        const h = A.htmlPagina({ snap: c.snap, st: {}, agora: Date.parse('2026-09-25T12:00:00-03:00'), an: c.an, filtro: 'todos', conta: '123456789' })
            + A.htmlPagina({ snap: c.snap, st: {}, agora: Date.parse('2026-09-25T12:00:00-03:00'), an: c.an, filtro: 'acima', conta: '123456789' });
        return textoLimpo(h) || `conta ${c.k}: ${(/.{0,60}(NaN|undefined|Infinity|\bnull\b|R\$\s(?!\d)).{0,60}/.exec(h) || [''])[0]}`;
    });
}

console.log('G. Painel lateral (aba Ads) e o cruzamento com ads.html');
{
    prop('P.adsDoAnuncio: gasto, receita e vendas = os do anúncio; catálogo sem ligação fica de fora (null)', contas.flatMap(c => c.ads.map((a, i) => ({ c, a, s: c.snap.anuncios[i] }))), ({ c, a, s }) => {
        const x = P.adsDoAnuncio(s);
        if (a.catalogo) return x === null || `conta ${c.k}: catálogo virou anúncio`;
        return (x && cent(x.gasto) === a.costC && cent(x.receita) === a.recC && x.vendas === a.v && x.cliques === a.cli && x.impressoes === a.imp) || `conta ${c.k} ${a.raw.id}`;
    });
    prop('P.adsLigaCatalogo: catálogo ligado pelo título vira o anúncio do seller; o gasto sem ligação = Σ do catálogo solto, no centavo', contas, c => {
        const solto = c.ads.filter(a => a.catalogo === 'solto').reduce((t, a) => t + a.costC, 0), lig = c.ads.filter(a => a.catalogo === 'ligado').length;
        return (emCentavos(c.snapP.catalogoSemLigacao) && cent(c.snapP.catalogoSemLigacao) === solto && c.snapP.catalogoLigados === lig) || `conta ${c.k}: ${c.snapP.catalogoSemLigacao}`;
    });
    prop('P.adsEquilibrio: sobra antes do Ads = sobra de 1 un. × vendas, depois = antes − Ads (no centavo), acima ⇔ depois < 0; sem custo = null', contas.flatMap(c => c.lista.map(x => ({ c, x }))), ({ c, x }) => {
        if (x.semCusto) return (x.antes === null && x.depois === null && x.margem === null && x.acima === false) || `conta ${c.k} ${x.a.itemId}: sem custo com número`;
        const s = c.sobraDe(x.it);
        return (emCentavos(x.antes) && emCentavos(x.depois) && cent(x.antes) === cent(s.sobra) * x.a.vendas && cent(x.depois) === cent(x.antes) - cent(x.a.gasto)
            && x.acima === (cent(x.depois) < 0) && (x.a.receita > 0 ? Math.abs(x.acos - x.a.gasto / x.a.receita * 100) < 1e-9 : x.acos === null)) || `conta ${c.k} ${x.a.itemId}: ${JSON.stringify([x.antes, x.depois, x.acima])}`;
    });
    prop('"Por produto" do painel: Σ gasto dos anúncios + catálogo sem ligação = investimento da conta = Σ SKUs de ads.html', contas, c => {
        const lista = c.lista.reduce((t, x) => t + cent(x.a.gasto), 0), skus = c.an.grupos.reduce((t, g) => t + cent(g.m.investimento), 0);
        return (lista + cent(c.snapP.catalogoSemLigacao) === c.tot.costC && skus === c.tot.costC && cent(c.contaP.gasto) === c.tot.costC) || `conta ${c.k}: ${lista} + ${c.snapP.catalogoSemLigacao}`;
    });
    prop('P.adsConta = KPIs de ads.html (investimento, receita, vendas, cliques, impressões, orçamento/dia, campanhas ativas) no mesmo snapshot', contas.filter(c => c.ads.length), c => {
        const m = c.contaP, a = c.an.kpis.atual, k = c.an.kpis;
        return (cent(m.gasto) === cent(a.investimento) && cent(m.receita) === cent(a.receita) && m.vendas === a.vendas && m.cliques === a.cliques && m.impressoes === a.impressoes
            && (m.orcamentoDia === null ? k.orcamentoDia === null : cent(m.orcamentoDia) === cent(k.orcamentoDia)) && m.campanhasAtivas === k.campanhasAtivas) || `conta ${c.k}: ${JSON.stringify(m)}`;
    });
    prop('P.adsConta: ACOS = Ads ÷ receita, ROAS = r2(receita ÷ Ads), CPC = r2(Ads ÷ cliques), CTR; ÷0 = null; TACOS só o do ML (nunca inventado)', contas, c => {
        const m = c.contaP, x = c.tot;
        return ((x.recC ? Math.abs(m.acos - x.costC / x.recC * 100) < 1e-9 : m.acos === null) && (x.costC ? emCentavos(m.roas) && Math.abs(m.roas - x.recC / x.costC) <= 0.005 + 1e-9 : m.roas === null)
            && (x.cli ? emCentavos(m.cpc) && Math.abs(m.cpc * 100 - x.costC / x.cli) <= 0.5 + 1e-9 : m.cpc === null) && (x.imp ? Math.abs(m.ctr - x.cli / x.imp * 100) < 1e-9 : m.ctr === null)
            && (c.tacosMl ? m.tacos !== null : m.tacos === null) && Object.keys(m).every(k => semLixo(m[k]))) || `conta ${c.k}: ${JSON.stringify(m)}`;
    });
    prop('ACOS da conta: ads.html e painel diferem no máximo o arredondamento de 2 casas do fundo (a mesma conta; o texto pode diferir — divergência 5)', contas.filter(c => c.tot.recC), c =>
        Math.abs(c.an.kpis.atual.acos - c.contaP.acos) <= 0.005 + 1e-9 || `conta ${c.k}: ${c.an.kpis.atual.acos} × ${c.contaP.acos}`);
    prop('campanhas do painel (P.adsCampanhasLista): gasto/receita de cada linha = os da campanha e Σ linhas = linha "Total" (P.adsConta)', contas, c => {
        const rows = c.campsP, soma = rows.reduce((t, r) => t + cent(r.m.gasto), 0), somaR = rows.reduce((t, r) => t + cent(r.m.receita), 0);
        const cada = rows.every(r => { const x = c.porCamp.get(Number(r.id)); return cent(r.m.gasto) === x.costC && cent(r.m.receita) === x.recC && r.m.vendas === x.v; });
        return (cada && soma === cent(c.contaP.gasto) && somaR === cent(c.contaP.receita)) || `conta ${c.k}: Σ ${reais(soma)} × total ${SHC.moeda(c.contaP.gasto)}`;
    });
    prop('P.adsVereditoDe (conta e campanha): "Compensa" ⇔ Ads < sobra antes do Ads dos anúncios com custo (lucro > 0); equilíbrio = Σ sobra ÷ Σ receita', contas.flatMap(c => [{ c, xs: c.lista, g: c.contaP.gasto }].concat(c.campsP.map(r => ({ c, xs: c.lista.filter(x => x.a.campanhaId === r.id), g: r.m.gasto, v: r.veredito })))), ({ c, xs, g, v }) => {
        const ver = v || P.adsVereditoDe(xs, g), com = xs.filter(x => !x.semCusto);
        if (!(g > 0)) return ver.tipo === 'semGasto' || ver.tipo;
        if (!com.length) return (ver.tipo === 'semCusto' && ver.semCusto === xs.length) || ver.tipo;
        const luc = com.reduce((t, x) => t + cent(x.depois), 0), rec = com.reduce((t, x) => t + cent(x.a.receita), 0);
        if (!rec) return ver.tipo === 'nao' || `conta ${c.k}: sem receita e ${ver.tipo}`;
        if (luc === 0) return true;   // empate no centavo: a comparação é em ponto flutuante (ver divergência 2)
        return ((luc > 0) === (ver.tipo === 'compensa') && ver.semCusto === xs.length - com.length) || `conta ${c.k}: lucro ${reais(luc)} e ${ver.tipo}`;
    });
    prop('P.adsDoItem (detalhe do anúncio): gasto, receita e vendas = Σ dos anúncios daquele MLB (catálogo ligado incluso); ROAS e CPC com 2 casas', contas.flatMap(c => c.itens.map(it => ({ c, it }))), ({ c, it }) => {
        const d = P.adsDoItem(c.snapP, it.itemId), meus = c.ads.filter(a => a.it === it && a.catalogo !== 'solto');
        if (!meus.length) return d.noAds === false || `conta ${c.k} ${it.itemId}: no Ads sem anúncio`;
        const x = somaX(meus), m = d.m;
        return (d.noAds && cent(m.gasto) === x.costC && cent(m.receita) === x.recC && m.vendas === x.v && m.cliques === x.cli
            && (x.costC ? emCentavos(m.roas) && Math.abs(m.roas - x.recC / x.costC) <= 0.005 + 1e-9 : m.roas === null) && (x.cli ? emCentavos(m.cpc) : m.cpc === null)) || `conta ${c.k} ${it.itemId}: ${JSON.stringify(m)}`;
    });
    prop('P.adsCampanhaVs: 30 dias × 30 dias antes da campanha = os números gerados (ACOS de cada período = Ads ÷ receita)', contas.flatMap(c => c.camps.map(k => ({ c, k }))), ({ c, k }) => {
        const vs = P.adsCampanhaVs(c.snap, String(k.id)), a = c.porCamp.get(k.id), b = c.antes.get(k.id);
        return (vs && cent(vs.atual.gasto) === a.costC && cent(vs.atual.receita) === a.recC && cent(vs.antes.gasto) === b.costC && cent(vs.antes.receita) === b.recC
            && (b.recC ? Math.abs(vs.antes.acos - b.costC / b.recC * 100) < 1e-9 : vs.antes.acos === null)) || `conta ${c.k} campanha ${k.id}`;
    });
    ok(P.adsCampanhaVs({ campanhas: [{ id: '1' }] }, '1') === null && P.adsConta(null) === null && P.adsConta({ temAds: false }) === null && P.adsDoFechamento(null) === null,
        'sem a leitura de antes / sem Ads: null (o painel não inventa R$ 0,00)');
    prop('P.adsFatoCatalogo: "Veredito sobre R$ a de R$ b (R$ c de catálogo sem ligação)" com a + c = b = investimento da conta', contas.filter(c => c.snapP.catalogoSemLigacao > 0 && c.contaP.gasto > 0), c => {
        const t = P.adsFatoCatalogo('O Ads leva mais do que sobra.', 'nao', c.contaP.gasto, c.snapP.catalogoSemLigacao);
        const m = /Veredito sobre (−?R\$ [\d.]+,\d\d) de (R\$ [\d.]+,\d\d) \((R\$ [\d.]+,\d\d) de catálogo/.exec(t);
        return (!!m && deMoeda(m[1]) + deMoeda(m[3]) === deMoeda(m[2]) && deMoeda(m[2]) === c.tot.costC) || `conta ${c.k}: ${t}`;
    });
    // Cruzamento: mesmo snapshot, SKU de 1 anúncio, receita = preço de hoje × vendas → ads.html e painel dão o MESMO lucro.
    const cruz = contas.filter(c => c.coerente && !c.multi);
    prop('SKU de 1 anúncio (receita = preço × vendas): lucro depois do Ads de ads.html = Σ "depois" do painel para o anúncio, no centavo', cruz.flatMap(c => c.an.grupos.filter(g => g.lucroRs !== null && g.itens.length === 1).map(g => ({ c, g }))), ({ c, g }) => {
        const xs = c.lista.filter(x => x.a.itemId === g.itens[0].itemId);
        const dep = xs.reduce((t, x) => t + (x.depois === null ? NaN : cent(x.depois)), 0), ant = xs.reduce((t, x) => t + cent(x.antes), 0);
        return (dep === cent(g.lucroRs) && ant === cent(g.sobraRs)) || `conta ${c.k} ${g.chave}: ads.html ${A.textoMontante(g)} × painel ${reais(dep)}`;
    });
    prop('conta (receita = preço × vendas, SKU de 1 anúncio): lucro depois do Ads de ads.html = Σ "depois" do painel ("lucro/prejuízo R$ X depois do Ads")', cruz.filter(c => c.an.res.lucro !== null), c => {
        const dep = SHC.r2(c.lista.filter(x => x.depois !== null).reduce((t, x) => t + x.depois, 0));
        return (cent(dep) === cent(c.an.res.lucro) && SHC.moeda(Math.abs(dep)) === SHC.moeda(Math.abs(c.an.res.lucro))) || `conta ${c.k}: ${c.an.res.lucro} × ${dep}`;
    });
}

console.log('H. Ads do Faturamento (SHC.fechamentoDasCobrancas → P.adsDoFechamento, A.modelos)');
{
    const rnd = semente(505);
    const meses = vezes(150).map(i => {
        const mes = '2026-' + String(1 + (i % 9)).padStart(2, '0'), d = n => mes + '-' + String(n).padStart(2, '0');
        const cob = vezes(I(rnd, 0, 6)).map(() => I(rnd, 1, 250000)), seg = rnd() < 0.4 ? vezes(I(rnd, 1, 3)).map(() => I(rnd, 1, 40000)) : [];
        const totCob = cob.reduce((t, x) => t + x, 0), canc = totCob && rnd() < 0.4 ? [I(rnd, 1, totCob)] : [];   // estorno ≤ cobrado (o líquido ≥ 0)
        const cobs = cob.map((v, j) => ({ id: `${i}|${j}|CPADS`, data: d(1 + j), texto: 'Product Ads', valor: v / 100 }))
            .concat(seg.map((v, j) => ({ id: `${i}|s${j}|CDLIT`, data: d(10 + j), texto: 'Publicidade de Seguidores', valor: v / 100 })))
            .concat(canc.map((v, j) => ({ id: `${i}|c${j}|BPADS`, data: d(20 + j), texto: 'Cancelamento de Product Ads', valor: v / 100 })))
            .concat([{ id: `${i}|t|CVVML`, data: d(5), texto: 'Custo por vender', valor: 12.34 }]);
        return { mes, cob, seg, canc, fech: SHC.fechamentoDasCobrancas(cobs)[mes] };
    });
    prop('porTipo.ads = Σ cobrado − Σ estornado (estorno com sinal −), seguidores à parte, no centavo', meses, x => {
        const pt = x.fech.porTipo, liq = x.cob.reduce((t, v) => t + v, 0) - x.canc.reduce((t, v) => t + v, 0), sg = x.seg.reduce((t, v) => t + v, 0);
        const est = (x.fech.estornosPorTipo || {}).ads;
        return ((x.cob.length ? emCentavos(pt.ads) && cent(pt.ads) === liq : pt.ads === undefined) && (x.seg.length ? cent(pt.ads_seguidores) === sg : pt.ads_seguidores === undefined)
            && (x.canc.length ? cent(est) === -x.canc[0] && est < 0 : est === undefined)) || `${x.mes}: ${JSON.stringify(pt)}`;
    });
    prop('P.adsDoFechamento: Product Ads e Seguidores = o do Faturamento, total = soma no centavo; tipo que não veio = null (nunca 0)', meses, x => {
        const a = P.adsDoFechamento(x.fech), pt = x.fech.porTipo;
        if (!x.cob.length && !x.seg.length) return a === null || JSON.stringify(a);
        return ((pt.ads === undefined ? a.ads === null : cent(a.ads) === cent(pt.ads)) && (pt.ads_seguidores === undefined ? a.seguidores === null : cent(a.seguidores) === cent(pt.ads_seguidores))
            && cent(a.total) === cent(a.ads || 0) + cent(a.seguidores || 0)) || `${x.mes}: ${JSON.stringify(a)}`;
    });
    prop('A.modelos: "No Faturamento de MM/AAAA: R$ X" = porTipo.ads e porTipo.ads_seguidores do mês', meses.filter(x => x.cob.length || x.seg.length), x => {
        const rot = x.mes.slice(5) + '/' + x.mes.slice(0, 4), mods = A.modelos([], [{ mes: rot, porTipo: x.fech.porTipo }]), pt = x.fech.porTipo;
        const pa = mods.find(m => /^Product Ads/.test(m.nome)), sg = mods.find(m => /^Publicidade de Seguidores/.test(m.nome));
        const v = (m, k) => { const r = new RegExp('No Faturamento de ' + rot.replace('/', '\\/') + ': (R\\$ [\\d.]+,\\d\\d)').exec(m ? m.detalhe : ''); return r ? deMoeda(r[1]) : null; };
        return ((cent(pt.ads || 0) ? v(pa, 'ads') === cent(pt.ads) : !pa || v(pa) === null) && (cent(pt.ads_seguidores || 0) ? v(sg) === cent(pt.ads_seguidores) : !sg)) || `${x.mes}: ${mods.map(m => m.detalhe).join(' / ')}`;
    });
}

console.log('I. Núcleo (copiloto-nucleo): adsDosAnuncios e rateio do Ads por pedido');
{
    const rnd = semente(606);
    const casos = vezes(200).map(i => {
        const ads = vezes(I(rnd, 1, 6)).map(j => ({ id: 'MLB97' + String(i * 10 + j).padStart(8, '0'), costC: rnd() < 0.15 ? 0 : I(rnd, 1, 90000), recC: I(rnd, 0, 300000) }));
        const res = SHC.adsAnuncios({ results: ads.map(a => ({ id: a.id, title: 'Teste ' + a.id, cost: a.costC / 100, totalAmount: a.recC / 100 })) });
        const lidos = ADML.adsDosAnuncios(res, { conta: '1', de: '2026-09-01', ate: '2026-09-30' });
        const pedidos = vezes(I(rnd, 0, 40)).map(p => ({ id: 'P' + i + '-' + p, status: rnd() < 0.1 ? 'cancelado' : 'pago', data_venda: '2026-09-' + String(I(rnd, 1, 30)).padStart(2, '0'),
            itens: [{ anuncio_id: escolhe(rnd, ads).id, qtd: I(rnd, 1, 3), preco_unit: I(rnd, 990, 29990) / 100, total: null }] }));
        return { ads, lidos, rat: MOTOR.rateioAds(lidos, pedidos) };
    });
    prop('adsDosAnuncios: um registro por anúncio com gasto, custo e receita no centavo; Σ custo = Σ gasto lido', casos, x => {
        const pagos = x.ads.filter(a => a.costC > 0);
        return (x.lidos.length === pagos.length && x.lidos.every((l, j) => cent(l.custo) === pagos[j].costC && cent(l.receita_atribuida) === pagos[j].recC && l.custo > 0)
            && cent(x.lidos.reduce((t, l) => t + l.custo, 0)) === pagos.reduce((t, a) => t + a.costC, 0)) || JSON.stringify(x.lidos);
    });
    prop('rateioAds: Σ rateado nos pedidos + Σ não rateado = Σ Ads lido, no centavo (nenhum centavo some nem nasce)', casos, x => {
        const tot = x.ads.reduce((t, a) => t + a.costC, 0), rat = Object.values(x.rat.porPedido).reduce((t, p) => t + cent(p.total), 0), nr = x.rat.naoRateado.reduce((t, a) => t + cent(a.custo), 0);
        return (rat + nr === tot && cent(x.rat.total_rateado) === rat && cent(x.rat.total_nao_rateado) === nr) || `rateado ${reais(rat)} + não rateado ${reais(nr)} ≠ ${reais(tot)}`;
    });
    prop('rateioAds: em cada pedido, Σ por anúncio = total do pedido; cada anúncio rateado soma o custo dele', casos, x => {
        const pp = Object.values(x.rat.porPedido);
        if (!pp.every(p => emCentavos(p.total) && Object.values(p.porAnuncio).reduce((t, v) => t + cent(v), 0) === cent(p.total))) return 'pedido com Σ por anúncio ≠ total';
        const porAd = {}; pp.forEach(p => Object.keys(p.porAnuncio).forEach(a => { porAd[a] = (porAd[a] || 0) + cent(p.porAnuncio[a]); }));
        return Object.keys(porAd).every(a => porAd[a] === x.ads.find(z => z.id === a).costC) || JSON.stringify(porAd);
    });
}

console.log(`\n${nChecks} verificações.`);
if (f) { console.log(f + ' FALHA(S)'); process.exit(1); }
console.log('TUDO OK');
