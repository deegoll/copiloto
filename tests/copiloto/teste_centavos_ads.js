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
//   I. núcleo (copiloto-nucleo): adaptador adsDosAnuncios e motor.rateioAds — o Ads rateado + o não rateado = o Ads lido;
//   J. os casos fixos (e gerados) das divergências corrigidas (#22–#28): cada um falha no código antigo e passa no novo.
// Casos gerados com semente fixa (LCG): o resultado é o mesmo em toda execução (nada de Math.random).
// Divergências achadas nesta auditoria (as corrigidas são provadas na parte J; as outras ficam fora deste teste para a suíte seguir verde):
//   1) [corrigida, #22] ads.js A.rs0 arredondava o negativo para cima (Math.round(−2,5) = −2): lucro de −R$ 2,50 → KPI "−R$ 2", manchete
//      "prejuízo de R$ 3". Agora o meio real vai para longe do zero nos dois sinais e o rodapé mostra a conta em centavos, fechando
//      ("sobra R$ 30,00 − Ads R$ 32,50 = −R$ 2,50").
//   2) [corrigida, #23] ads.js: SKU com lucro depois do Ads de R$ 0,00 (Ads = sobra, no centavo) ganhava o selo "Acima do equilíbrio" e a ação
//      "Ajustar" por ruído de ponto flutuante (ACOS 23,791193949216638 > margem 23,791193949216634). Agora o selo segue o lucro em centavos.
//      Revisão 2: o painel (cartão "Ads deste anúncio", campanha e conta, P.adsVeredito/P.adsVereditoDe) e a leitura da campanha em ads.html
//      também decidem pelo lucro no centavo; R$ 0,00 = "No equilíbrio" (antes "Não compensa … acima"). A campanha em ads.html usa a base do
//      painel, só os produtos com custo (antes o ACOS da campanha inteira contra o equilíbrio só dos com custo dava vereditos opostos).
//   3) [corrigida junto com a 6, #26] ads.js: SKU com gasto e sem venda entrava na contagem da manchete ("1 produto passa do equilíbrio")
//      mas não no filtro "Acima do equilíbrio (0)". Agora ganha o selo "acima", como no painel.
//   4) [corrigida, #24] ads.js A.metricas: TACOS sem as vendas orgânicas lidas virava o próprio ACOS, e A.soma/A.kpis transformavam orgânicas
//      ausentes em "0 un. · R$ 0,00". Agora sem as orgânicas (e sem o tacos do ML) TACOS e "Vendas orgânicas" = "—", como o painel.
//   5) [corrigida, #25] ACOS/ROAS arredondados duas vezes: o fundo gravava r2(custo ÷ receita × 100) e r2(receita ÷ custo) e a tabela por SKU
//      e o painel calculavam de novo → "43,2%" × "43,1%"; ROAS 201 ÷ 200 = "1,01x" × "1x". Agora o fundo grava cru, ads.html calcula da base
//      (o do ML só sem a base) e o texto arredonda uma vez só (SHC.pctTxt; ROAS com SHC.r2, como o painel).
//   6) [corrigida, #26] Lucro depois do Ads do MESMO anúncio diferia entre ads.html (margem % × receita do Ads) e o painel (sobra de
//      hoje × unidades): vendido abaixo do preço de hoje → "Prejuízo R$ 3,00" × "Lucro R$ 3,00". Agora as duas telas usam SHC.adsLucro (margem ×
//      receita, por anúncio, no centavo). O aviso do fundo (SHC.alertasDe: ícone e sino) também usa SHC.adsLucro e conta o mesmo anúncio que o
//      cartão Alertas do painel (antes: sobra de hoje × unidades, discordava nos dois sentidos). Revisão 2: o anúncio em várias campanhas (também
//      numa em que gastou R$ 0 e o ML atribuiu venda) é UMA entrada no painel e um aviso no ícone, com as campanhas somadas, como ads.html e o
//      cartão do anúncio (antes "Lucro R$ 50,00" × "Prejuízo R$ 10,00"); "dá para investir mais" olha só o que foi pago.
//   7) [corrigida, #27] Sem o resumo do ML (falha da chamada campaigns/metrics): ads.html somava as campanhas e o painel os anúncios lidos →
//      R$ 100,00 × R$ 60,00 com a lista de anúncios em parte, e a linha "Total" do painel ≠ soma das linhas. Agora o painel soma as campanhas
//      (P.adsConta) e a linha Total é a soma das linhas (P.adsCampanhasTotal).
//   8) [corrigida, #28] P.adsDoFechamento e A.modelos usavam Math.abs: mês com estorno de Product Ads maior que a cobrança (porTipo.ads = −15)
//      aparecia como R$ 15,00 GASTOS. Agora o valor líquido fica com o sinal ("−R$ 15,00 … estornos maiores que as cobranças").
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
// Texto do ROAS no painel: cópia do xTxt de painel-lateral.js (função local, não exportada).
const xPainel = v => v === null || v === undefined || !isFinite(v) ? '—' : (Math.round(v * 100) / 100).toLocaleString('pt-BR') + 'x';
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
    prop('A.rs0 de valor negativo = −(centavos arredondados), meio real para longe do zero (#22)', vezes(2000), () => {
        const c = -I(rnd, 1, 99999999), t = A.rs0(c / 100), r = Math.floor((-c + 50) / 100);
        return (deRs0(t) === (r ? -r : 0) && (r ? t === '−' + A.rs0(-c / 100) : t === 'R$ 0')) || `${c} → ${t}`;
    });
    prop('A.rs0 simétrico no meio real: −R$ X,50 = "−" + o texto de +R$ X,50 (nunca "−R$ 2" × "R$ 3") (#22)', vezes(1000), () => {
        const c = I(rnd, 0, 999999) * 100 + 50;
        return (A.rs0(-c / 100) === '−' + A.rs0(c / 100) && deRs0(A.rs0(c / 100)) === (c + 50) / 100) || `${c} → ${A.rs0(-c / 100)} × ${A.rs0(c / 100)}`;
    });
    ok(A.rs0(-2.5) === '−R$ 3' && A.rs0(2.5) === 'R$ 3' && A.rs0(-127.5) === '−R$ 128' && A.rs0(-1433.5) === '−R$ 1.434' && A.rs0(-0.4) === 'R$ 0' && A.rs0(-0.5) === '−R$ 1',
        'A.rs0: −2,50 → "−R$ 3", −1.433,50 → "−R$ 1.434", −0,40 → "R$ 0" (sem "−R$ 0") (#22)');
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
    prop('ACOS/ROAS da conta: ACOS = Ads ÷ receita e ROAS = receita ÷ Ads, crus (sem as 2 casas do fundo, #25); TACOS = Ads ÷ (receita + orgânicas) quando as orgânicas foram lidas', contas, c => {
        const a = c.an.kpis.atual, x = c.tot, d = 0.005 + 1e-9, e = 1e-9;
        const acos = x.recC ? Math.abs(a.acos - x.costC / x.recC * 100) < e : a.acos === null;
        const roas = x.costC ? Math.abs(a.roas - x.recC / x.costC) < e : a.roas === null;
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
    prop('SKU com custo: sobra antes do Ads = margem × receita de cada anúncio, somada (±½ centavo por anúncio, #26), lucro = sobra − Ads no centavo, Ads = investimento', grupos.filter(x => x.g.margem !== null), ({ c, g }) => {
        const sobraExata = g.ads.reduce((t, a) => t + cent(a.m.receita || 0) * g.margem / 100, 0);   // em centavos, sem arredondar
        return (emCentavos(g.sobraRs) && emCentavos(g.lucroRs) && emCentavos(g.adsRs) && cent(g.adsRs) === cent(g.m.investimento)
            && Math.abs(cent(g.sobraRs) - sobraExata) <= 0.5 * g.ads.length + 1e-6 && cent(g.lucroRs) === cent(g.sobraRs) - cent(g.adsRs)) || `conta ${c.k} ${g.chave}: ${g.sobraRs} − ${g.adsRs} = ${g.lucroRs}`;
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
    prop('selo "Acima do equilíbrio" ⇔ lucro depois do Ads < 0 (SKU com custo e gasto; lucro R$ 0,00 incluso, #23; gasto sem venda passa, como o painel, #26)', grupos.filter(x => x.g.margem !== null && x.g.m.investimento > 0),
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
    prop('KPIs de cima (A.htmlKpis4): Investimento e Receita em R$ inteiro, lucro = A.rs0(lucro), rodapé "sobra R$ a − Ads R$ b = R$ c" em centavos e fechando, variação vs 30 dias antes', contas, c => {
        const h = A.htmlKpis4(c.an), r = c.an.res, v = l => { const m = new RegExp('<div class="l">' + l + '</div><div class="v">(.*?)</div><div class="s">(.*?)</div>').exec(h); return m ? [tiraTags(m[1]), tiraTags(m[2])] : [null, null]; };
        const [inv, invS] = v('Investimento'), [rec] = v('Receita pelo Ads'), [luc, lucS] = v('Lucro depois do Ads ⓘ');
        const rs0c = cc => Math.sign(cc) * Math.floor((Math.abs(cc) + 50) / 100);
        let bom = deRs0(inv) === rs0c(c.tot.costC) && deRs0(rec) === rs0c(c.tot.recC);
        if (r.lucro === null) bom = bom && luc === '—' && /informe o custo/.test(lucS);
        else {
            const m = /^sobra (.+?) − Ads (R\$ [\d.]+,\d\d) = (−?R\$ [\d.]+,\d\d)/.exec(lucS);
            bom = bom && luc === A.rs0(r.lucro) && !!m && deMoeda(m[1]) === cent(r.sobra) && deMoeda(m[2]) === cent(r.ads) && deMoeda(m[3]) === cent(r.lucro)
                && deMoeda(m[1]) - deMoeda(m[2]) === deMoeda(m[3]) && deRs0(luc) === rs0c(cent(r.lucro));
        }
        const pv = /^([▲▼]) (.+) vs 30 dias antes$/.exec(invS), a0 = c.tot.costC, b0 = c.totAnt.costC;
        bom = bom && (b0 > 0 ? !!pv && pv[1] === (a0 >= b0 ? '▲' : '▼') && Math.abs(dePct(pv[2]) - Math.abs(a0 - b0) / b0 * 100) <= 0.05 + 1e-9 : invS === '');
        return (bom && textoLimpo(h)) || `conta ${c.k}: ${inv} · ${rec} · ${luc} (${lucS}) · ${invS}`;
    });
    prop('manchete: "prejuízo de R$ N" / "lucro de R$ N" = o mesmo número do KPI "Lucro depois do Ads" (meio real incluso, #22)', contas.filter(c => c.an.res.lucro !== null), c => {
        const mc = c.an.manchete, r = c.an.res, kp = deRs0(A.rs0(r.lucro));
        const m = /dá (prejuízo|lucro) de (R\$ [\d.]+)/.exec(mc.fato);
        if (r.lucro < 0) return (!!m && m[1] === 'prejuízo' && -deRs0(m[2]) === kp && mc.cls === 'pr') || `conta ${c.k}: ${mc.fato} × KPI ${A.rs0(r.lucro)}`;
        if (r.lucro === 0) return (/^O Ads empata/.test(mc.fato) && mc.cls === 'at') || mc.fato;   // R$ 0,00 no centavo (#23)
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
        // o Ads da campanha está nos anúncios dela (a leitura usa as linhas dos produtos com custo, #23)
        const casoFixo = A.leituraCampanha({ id: '1', m: { acos: 5, investimento: 5, vendas: 1 }, share: { orcamento: 30 }, orcamentoDia: 33.33 },
            [{ margem: 40, ads: [{ campanhaId: '1', m: { receita: 100, investimento: 5 } }] }], { margem_alvo_pct: 10 });
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
    prop('P.adsEquilibrio: sobra antes do Ads = margem (sobra de 1 un. ÷ preço) × receita do Ads (±½ centavo por campanha, #26), depois = antes − Ads (no centavo), acima ⇔ depois < 0 ⇔ ACOS acima do equilíbrio; sem custo = null', contas.flatMap(c => c.lista.map(x => ({ c, x }))), ({ c, x }) => {
        if (x.semCusto) return (x.antes === null && x.depois === null && x.margem === null && x.acima === false) || `conta ${c.k} ${x.a.itemId}: sem custo com número`;
        const s = c.sobraDe(x.it), exata = cent(x.a.receita) * s.sobra / x.it.preco, nr = x.linhas.filter(y => y.a.receita > 0).length;   // centavos, sem arredondar
        const ex = cent(x.antes) - exata;   // erro de arredondar a sobra de cada campanha
        return (emCentavos(x.antes) && emCentavos(x.depois) && Math.abs(ex) <= 0.5 * Math.max(1, nr) + 1e-6 && cent(x.depois) === cent(x.antes) - cent(x.a.gasto)
            && x.acima === (cent(x.depois) < 0) && (cent(x.depois) === 0 || nr > 1 || x.acima === (x.acos === null || x.acos > x.margem))
            && cent(x.a.gasto) === x.linhas.reduce((t, y) => t + cent(y.a.gasto), 0) && cent(x.a.receita) === x.linhas.reduce((t, y) => t + cent(y.a.receita), 0)
            && (x.a.receita > 0 ? Math.abs(x.acos - x.a.gasto / x.a.receita * 100) < 1e-9 : x.acos === null)) || `conta ${c.k} ${x.a.itemId}: ${JSON.stringify([x.antes, x.depois, x.acima, x.acos, x.margem])}`;
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
    prop('ACOS e ROAS da conta: ads.html e painel com o mesmo número e o mesmo texto (#25)', contas.filter(c => c.tot.recC), c => {
        const a = c.an.kpis.atual, p = c.contaP;
        return (Math.abs(a.acos - p.acos) < 1e-9 && SHC.pctTxt(a.acos) === SHC.pctTxt(p.acos) && A.xTxt(a.roas) === xPainel(p.roas)) || `conta ${c.k}: ${a.acos} × ${p.acos} · ${A.xTxt(a.roas)} × ${xPainel(p.roas)}`;
    });
    prop('campanhas do painel (P.adsCampanhasLista): gasto/receita de cada linha = os da campanha e Σ linhas = linha "Total" (P.adsConta)', contas, c => {
        const rows = c.campsP, soma = rows.reduce((t, r) => t + cent(r.m.gasto), 0), somaR = rows.reduce((t, r) => t + cent(r.m.receita), 0);
        const cada = rows.every(r => { const x = c.porCamp.get(Number(r.id)); return cent(r.m.gasto) === x.costC && cent(r.m.receita) === x.recC && r.m.vendas === x.v; });
        return (cada && soma === cent(c.contaP.gasto) && somaR === cent(c.contaP.receita)) || `conta ${c.k}: Σ ${reais(soma)} × total ${SHC.moeda(c.contaP.gasto)}`;
    });
    prop('P.adsVereditoDe (conta e campanha): "Compensa" ⇔ Ads < sobra antes do Ads dos anúncios com custo (lucro > 0); equilíbrio = Σ sobra ÷ Σ receita', contas.flatMap(c => [{ c, xs: c.lista, g: c.contaP.gasto }].concat(c.campsP.map(r => ({ c, xs: P.adsLinhas(c.lista).filter(x => x.a.campanhaId === r.id), g: r.m.gasto, v: r.veredito })))), ({ c, xs, g, v }) => {
        const ver = v || P.adsVereditoDe(xs, g), com = xs.filter(x => !x.semCusto), semC = xs.filter(x => x.semCusto && x.a.gasto > 0).length;
        if (!(g > 0)) return ver.tipo === 'semGasto' || ver.tipo;
        if (!com.some(x => x.a.gasto > 0)) return (ver.tipo === 'semCusto' && ver.semCusto === semC) || ver.tipo;
        const luc = com.reduce((t, x) => t + cent(x.depois), 0), rec = com.reduce((t, x) => t + cent(x.a.receita), 0);
        if (!rec) return ver.tipo === 'nao' || `conta ${c.k}: sem receita e ${ver.tipo}`;
        if (luc === 0) return (ver.tipo === 'empate' && ver.semCusto === semC) || `conta ${c.k}: lucro R$ 0,00 e ${ver.tipo}`;   // empate no centavo (#23)
        return ((luc > 0) === (ver.tipo === 'compensa') && ver.semCusto === semC) || `conta ${c.k}: lucro ${reais(luc)} e ${ver.tipo}`;
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
    // Cruzamento: mesmo snapshot, SKU de 1 anúncio (MLB) → ads.html e painel dão o MESMO lucro e o mesmo selo, com ou sem venda abaixo do
    // preço de hoje no período (#26: as duas telas usam SHC.adsLucro, margem × receita do Ads, somada por anúncio no centavo).
    const cruz = contas.filter(c => !c.multi);
    prop('SKU de 1 anúncio (com ou sem promoção no período, #26): lucro e sobra de ads.html = Σ "depois"/"antes" do painel para o anúncio, no centavo, e o mesmo selo "acima"', contas.flatMap(c => c.an.grupos.filter(g => g.lucroRs !== null && g.itens.length === 1 && g.m.investimento > 0).map(g => ({ c, g }))), ({ c, g }) => {
        const xs = c.lista.filter(x => x.a.itemId === g.itens[0].itemId);
        const dep = xs.reduce((t, x) => t + (x.depois === null ? NaN : cent(x.depois)), 0), ant = xs.reduce((t, x) => t + cent(x.antes), 0);
        return (dep === cent(g.lucroRs) && ant === cent(g.sobraRs) && g.selos.includes('acima') === dep < 0 && (xs.length !== 1 || xs[0].acima === g.selos.includes('acima')))
            || `conta ${c.k} ${g.chave}: ads.html ${A.textoMontante(g)} (${g.selos}) × painel ${reais(dep)} (${xs.map(x => x.acima)})`;
    });
    prop('conta (SKU de 1 anúncio, com ou sem promoção no período, #26): lucro depois do Ads de ads.html = Σ "depois" do painel ("lucro/prejuízo R$ X depois do Ads")', cruz.filter(c => c.an.res.lucro !== null), c => {
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
        const v = (m, k) => { const r = new RegExp('No Faturamento de ' + rot.replace('/', '\\/') + ': (−?R\\$ [\\d.]+,\\d\\d)').exec(m ? m.detalhe : ''); return r ? deMoeda(r[1]) : null; };
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

console.log('J. Divergências corrigidas: os casos fixos dos repros (#22–#28)');
// Conta de 1 tela: anúncios crus (nomes da API) → retrato como o fundo grava; campanhas = Σ dos anúncios dela; resumo = Σ de todos (ou sem ele).
const somaCru = l => { const s = {}; ['cost', 'totalAmount', 'prints', 'clicks', 'unitsQuantity'].forEach(k => { s[k] = SHC.r2(l.reduce((t, a) => t + (a[k] || 0), 0)); }); return s; };
const contaFixa = (ads, o) => {
    o = o || {};
    const ids = [...new Set(ads.map(a => a.campaignId))];
    return { temAds: true, completo: o.completo !== false, anterior: { campanhas: {}, total: null },
        campanhas: SHC.adsCampanhas({ results: ids.map(id => ({ id, name: 'Campanha teste ' + id, status: 'A', dailyBudget: 10, metrics: (o.campMetr || {})[id] || somaCru(ads.filter(a => a.campaignId === id)) })) }).campanhas,
        anuncios: SHC.adsAnuncios({ results: ads }).anuncios,
        resumo: o.semResumo ? null : SHC.adsResumo({ summary: { metricsSummary: Object.assign(somaCru(ads), o.resumoExtra || {}) } }) };
};
const kpiLucro = an => { const v = /Lucro depois do Ads ⓘ<\/div><div class="v">(.*?)<\/div><div class="s">(.*?)<\/div>/.exec(A.htmlKpis4(an)); return v ? [v[1], v[2]] : [null, null]; };
{
    const cfg = { imposto_pct: 0, margem_alvo_pct: 10 };
    const it = [{ itemId: 'MLB9000000001', sku: 'TST-1', titulo: 'Produto teste', preco: 100, recebe: 80 }];
    const an = A.analisa(contaFixa([{ id: 'MLB9000000001', title: 'Produto teste', campaignId: 111, cost: 32.5, totalAmount: 100, prints: 1000, clicks: 20, unitsQuantity: 1 }]), it, () => ({ custo: 50 }), cfg, []);
    const [v, s] = kpiLucro(an);
    ok(an.res.lucro === -2.5 && an.manchete.fato === 'O Ads dá prejuízo de R$ 3 no período.' && v === '−R$ 3' && s === 'sobra R$ 30,00 − Ads R$ 32,50 = −R$ 2,50',
        `#22 lucro −R$ 2,50: manchete "prejuízo de R$ 3", KPI "−R$ 3" e o rodapé "sobra R$ 30,00 − Ads R$ 32,50 = −R$ 2,50" (obtido: ${an.manchete.fato} | ${v} | ${s})`);
    const an2 = A.analisa(contaFixa([{ id: 'MLB9000000001', title: 'Produto teste', campaignId: 111, cost: 0.6, totalAmount: 100, prints: 1000, clicks: 20, unitsQuantity: 1 }]), it, () => ({ custo: 69.6 }), cfg, []);
    const [v2, s2] = kpiLucro(an2);
    ok(an2.res.lucro === 9.8 && an2.manchete.fato === 'O Ads dá lucro de R$ 10 nos produtos com custo.' && v2 === 'R$ 10' && s2 === 'sobra R$ 10,40 − Ads R$ 0,60 = R$ 9,80',
        `#22 sobra 10,40 − Ads 0,60: o rodapé fecha em centavos (= R$ 9,80) e o KPI/manchete mostram R$ 10 (obtido: ${an2.manchete.fato} | ${v2} | ${s2})`);
}
{   // #23: Ads = sobra antes do Ads no centavo → lucro R$ 0,00, sem selo "acima" e sem ação (como a manchete e o painel)
    const cfg = { imposto_pct: 0, margem_alvo_pct: 10 }, it = [{ itemId: 'MLB9000000031', sku: 'TST-E', titulo: 'Produto E', preco: 148.08, recebe: 85.23 }];
    const sku = (cost, totalAmount) => A.analisa(contaFixa([{ id: 'MLB9000000031', title: 'Produto E', campaignId: 3, cost, totalAmount, prints: 3000, clicks: 60, unitsQuantity: 6 }]), it, () => ({ custo: 50 }), cfg, []);
    const an = sku(211.38, 888.48), g = an.grupos[0];
    ok(A.textoMontante(g) === 'Ads R$ 211,38 · Lucro R$ 0,00' && !g.selos.includes('acima') && g.acao === null && an.res.acima === 0 && /Nenhum produto passa do equilíbrio/.test(an.manchete.acao)
        && A.htmlSkus(an.grupos, 'todos').indexOf('Acima do equilíbrio (0)') > 0, `#23 lucro R$ 0,00: sem selo "acima", sem ação e o filtro "Acima do equilíbrio (0)" (obtido: ${A.textoMontante(g)} · selos ${g.selos} · ${g.acao && g.acao.tx})`);
    const quase = sku(211.38, 888.47).grupos[0], perde = sku(211.39, 888.48).grupos[0], ganha = sku(211.37, 888.48).grupos[0];
    ok(quase.lucroRs === 0 && !quase.selos.includes('acima') && perde.lucroRs === -0.01 && perde.selos.includes('acima') && perde.acao.tipo === 'ajustar'
        && ganha.lucroRs === 0.01 && !ganha.selos.includes('acima') && ganha.acao === null,
        `#23 o selo segue o lucro em centavos: R$ 0,00 (ACOS um fio acima) sem selo · −R$ 0,01 "acima" e "Ajustar" · +R$ 0,01 sem selo (obtido: ${[quase, perde, ganha].map(A.textoMontante).join(' | ')})`);
    const rnd = semente(723);
    prop('#23 Ads = sobra × vendas no centavo (lucro R$ 0,00): nunca "acima"; 1 centavo a mais de Ads: sempre "acima" e "Ajustar"', vezes(400), () => {
        const precoC = I(rnd, 3000, 40000), recebeC = Math.round(precoC * 0.8) - I(rnd, 0, 900), custoC = I(rnd, 100, recebeC - 100), v = I(rnd, 1, 12);
        const its = [{ itemId: 'MLB9000000032', sku: 'TST-G', titulo: 'Produto G', preco: precoC / 100, recebe: recebeC / 100 }], adsC = (recebeC - custoC) * v;
        const g0 = A.analisa(contaFixa([{ id: 'MLB9000000032', title: 'Produto G', campaignId: 4, cost: adsC / 100, totalAmount: precoC * v / 100, prints: 900, clicks: 9, unitsQuantity: v }]), its, () => ({ custo: custoC / 100 }), cfg, []).grupos[0];
        const g1 = A.analisa(contaFixa([{ id: 'MLB9000000032', title: 'Produto G', campaignId: 4, cost: (adsC + 1) / 100, totalAmount: precoC * v / 100, prints: 900, clicks: 9, unitsQuantity: v }]), its, () => ({ custo: custoC / 100 }), cfg, []).grupos[0];
        return (g0.lucroRs === 0 && !g0.selos.includes('acima') && g0.acao === null && g1.lucroRs === -0.01 && g1.selos.includes('acima') && g1.acao.tipo === 'ajustar')
            || `preço ${precoC} recebe ${recebeC} custo ${custoC} × ${v}: ${A.textoMontante(g0)} ${g0.selos} | ${A.textoMontante(g1)} ${g1.selos}`;
    });
}
{   // #23, revisão 2: o veredito do painel (cartão "Ads deste anúncio", campanha e conta) e a leitura da campanha em ads.html pelo lucro no
    // centavo, não por ACOS × equilíbrio em ponto flutuante. Lucro R$ 0,00 = "No equilíbrio" (nem "Compensa" nem "acima"), como ads.html.
    const cfg = { imposto_pct: 0, margem_alvo_pct: 10 }, it = [{ itemId: 'MLB9000000031', sku: 'TST-E', titulo: 'Produto E', preco: 148.08, recebe: 85.23 }];
    const custo = () => ({ custo: 50 }), sobraDe = x => SHC.sobraAnuncio(x, custo(), cfg);
    const telas = (rows, its, custoDe) => {
        its = its || it; custoDe = custoDe || custo;
        const snap = P.adsLigaCatalogo(contaFixa(rows), its), an = A.analisa(snap, its, custoDe, cfg, []), l = P.adsEquilibrio(snap, its, x => SHC.sobraAnuncio(x, custoDe(x), cfg));
        const d = P.adsDoItem(snap, its[0].itemId), eq = SHC.adsEquilibrio(its[0], custoDe(its[0]), cfg);
        return { g: an.grupos.find(g => g.itens[0] === its[0]), an, l, card: P.adsVeredito(d.m, eq, SHC.adsLucro(eq.equilibrio, d.linhas)), camps: P.adsCampanhasLista(snap, l),
            conta: P.adsVereditoDe(l, P.adsConta(snap).gasto), leit: id => an.camps.find(c => c.id === id).leitura.linhas.join(' ') };
    };
    const sku = (cost, totalAmount) => telas([{ id: 'MLB9000000031', title: 'Produto E', campaignId: 3, cost, totalAmount, prints: 3000, clicks: 60, unitsQuantity: 6 }]);
    const e = sku(211.38, 888.48), c3 = e.camps[0].veredito;
    ok(A.textoMontante(e.g) === 'Ads R$ 211,38 · Lucro R$ 0,00' && e.l[0].depois === 0 && !e.l[0].acima && e.card.tipo === 'empate' && !/acima/.test(e.card.det) && c3.tipo === 'empate'
        && e.conta.tipo === 'empate' && /no equilíbrio dos produtos/.test(e.leit('3')) && !/acima/.test(e.leit('3')),
        `#23 os dados do repro (Ads R$ 211,38 = sobra no centavo): ads.html "Lucro R$ 0,00"; cartão do anúncio, campanha e conta "No equilíbrio" no painel; leitura da campanha em ads.html sem "acima" (obtido: cartão ${e.card.tipo} · ${e.card.det} · campanha ${c3.tipo} · conta ${e.conta.tipo} · ads.html "${e.leit('3')}")`);
    const corK = (an, rot) => (new RegExp('<div class="kpi ([a-z]*)" title="[^"]*"><div class="l">' + rot).exec(A.htmlKpis4(an)) || [])[1];
    ok(/^O Ads empata/.test(e.an.manchete.fato) && e.an.manchete.cls === 'at' && corK(e.an, 'ROAS · ACOS') === 'at' && corK(e.an, 'Lucro depois do Ads') === 'at',
        `#23 a conta em ads.html no empate: a manchete "O Ads empata" e o ACOS e o lucro em âmbar, como "No equilíbrio" no painel; nunca vermelho (obtido: ${e.an.manchete.fato} · ACOS ${corK(e.an, 'ROAS · ACOS')} · lucro ${corK(e.an, 'Lucro depois do Ads')})`);
    const p1 = sku(211.39, 888.48), g1 = sku(211.37, 888.48);
    ok(p1.card.tipo === 'nao' && p1.camps[0].veredito.tipo === 'nao' && p1.conta.tipo === 'nao' && /acima do equilíbrio/.test(p1.leit('3')) && p1.g.selos.includes('acima')
        && g1.card.tipo === 'compensa' && g1.camps[0].veredito.tipo === 'compensa' && g1.conta.tipo === 'compensa' && /abaixo do equilíbrio/.test(g1.leit('3')) && !g1.g.selos.includes('acima')
        && p1.an.manchete.cls === 'pr' && corK(p1.an, 'ROAS · ACOS') === 'pr' && g1.an.manchete.cls === 'ok' && corK(g1.an, 'ROAS · ACOS') !== 'pr',
        `#23 um centavo a mais de Ads (−R$ 0,01): "Não compensa" e "acima" em todas as telas; um a menos (+R$ 0,01): "Compensa" e "abaixo" (obtido: ${p1.card.tipo}/${p1.camps[0].veredito.tipo}/${p1.conta.tipo} · ${g1.card.tipo}/${g1.camps[0].veredito.tipo}/${g1.conta.tipo})`);
    // Campanha com um produto sem custo: ads.html comparava o ACOS da campanha INTEIRA com o equilíbrio só dos com custo; agora a base do painel.
    const its2 = [{ itemId: 'MLB9000000033', sku: 'TST-H', titulo: 'Produto H', preco: 100, recebe: 80 }, { itemId: 'MLB9000000034', sku: 'TST-I', titulo: 'Produto I', preco: 100, recebe: 80 }];
    const sc = telas([{ id: 'MLB9000000033', title: 'Produto H', campaignId: 5, cost: 25, totalAmount: 100, prints: 10, clicks: 1, unitsQuantity: 1 },
        { id: 'MLB9000000034', title: 'Produto I', campaignId: 5, cost: 50, totalAmount: 50, prints: 10, clicks: 1, unitsQuantity: 1 }], its2, x => (x.sku === 'TST-H' ? custo() : null));
    ok(sc.camps[0].veredito.tipo === 'compensa' && sc.camps[0].veredito.semCusto === 1 && /^ACOS de 25% abaixo do equilíbrio \(30%\)/.test(sc.leit('5')) && /Só os produtos com custo entram/.test(sc.leit('5')) && !/acima/.test(sc.leit('5')),
        `#23 campanha com 1 produto sem custo (R$ 50 de Ads): os dois lados julgam só o com custo (Ads R$ 25 × sobra R$ 30) e dizem que o sem custo ficou fora (obtido: painel ${sc.camps[0].veredito.tipo} · ads.html "${sc.leit('5')}")`);
    const rnd = semente(7231);
    prop('#23 Ads = sobra no centavo (lucro R$ 0,00), em 1 a 3 campanhas: "No equilíbrio" no cartão, na conta e na campanha (painel e ads.html), nunca "acima"; 1 centavo a mais: "Não compensa"/"acima" em todas', vezes(300), () => {
        const precoC = I(rnd, 3000, 40000), recebeC = Math.round(precoC * 0.8) - I(rnd, 0, 900), custoC = I(rnd, 100, recebeC - 100), its = [{ itemId: 'MLB9000000035', sku: 'TST-J', titulo: 'Produto J', preco: precoC / 100, recebe: recebeC / 100 }];
        const cd = () => ({ custo: custoC / 100 }), m = SHC.sobraAnuncio(its[0], cd(), cfg).pct, nc = I(rnd, 1, 3);
        const rows = vezes(nc).map(j => { const v = I(rnd, 1, 5); return { id: 'MLB9000000035', title: 'Produto J', campaignId: 40, cost: 0, totalAmount: precoC * v / 100 + (j ? I(rnd, 0, 99) / 100 : 0), prints: 10, clicks: 1, unitsQuantity: v }; });
        rows.forEach((r, j) => { r.campaignId = 40 + j; r.cost = SHC.r2(r.totalAmount * m / 100); });
        if (!rows.every(r => r.cost > 0)) return true;
        const t0 = telas(rows, its, cd), r1 = rows.map((r, j) => Object.assign({}, r, j === 0 ? { cost: SHC.r2(r.cost + 0.01) } : {})), t1 = telas(r1, its, cd);
        const tipos0 = [t0.card.tipo, t0.conta.tipo].concat(t0.camps.map(c => c.veredito.tipo)), l0 = t0.an.camps.map(c => c.leitura.linhas.join(' '));
        return (t0.g.lucroRs === 0 && tipos0.every(x => x === 'empate') && l0.every(x => /no equilíbrio dos produtos/.test(x) && !/acima/.test(x))
            && t1.g.lucroRs === -0.01 && t1.card.tipo === 'nao' && t1.conta.tipo === 'nao' && t1.camps.find(c => c.id === '40').veredito.tipo === 'nao' && /acima do equilíbrio/.test(t1.leit('40')))
            || `preço ${precoC} recebe ${recebeC} custo ${custoC} × ${nc} campanhas: ${tipos0} · ${l0.join(' | ')} · +1 centavo ${t1.card.tipo}`;
    });
}
{   // #24: sem as orgânicas lidas (e sem o tacos do ML), TACOS e "Vendas orgânicas" = "—"; nunca o ACOS nem "0 un. · R$ 0,00"
    const kp = (h, nome) => (new RegExp('<span class="kn">' + nome + '</span><b>(.*?)</b>').exec(h) || [])[1];
    const met = { cost: 50, totalAmount: 200, prints: 1000, clicks: 10, unitsQuantity: 2 };
    const res = SHC.adsResumo({ summary: { metricsSummary: met } }), m = A.metricas(res);
    const camps = SHC.adsCampanhas({ results: [{ id: 1, name: 'C1', status: 'A', dailyBudget: 10, metrics: met }] }).campanhas;
    const semRes = { temAds: true, campanhas: camps, anuncios: [], resumo: null, anterior: { campanhas: {}, total: null } }, hb = A.htmlKpis(A.kpis(semRes, A.campanhas(semRes)));
    const comRes = Object.assign({}, semRes, { resumo: res }), kc = A.kpis(comRes, A.campanhas(comRes)), hc = A.htmlKpis(kc);
    ok(m.acos === 25 && m.tacos === null && kp(hb, 'TACOS') === '—' && kp(hb, 'Vendas orgânicas') === '—' && kc.atual.organicasUn === null && kp(hc, 'Vendas orgânicas') === '—' && kp(hc, 'TACOS') === '—'
        && P.adsConta(comRes).tacos === null, `#24 resumo sem orgânicas, sem resumo e sem organicUnitsQuantity: TACOS "—" (como o painel) e "Vendas orgânicas —" (obtido: TACOS ${m.tacos}; ${kp(hb, 'Vendas orgânicas')} · ${kp(hb, 'TACOS')}; ${kp(hc, 'Vendas orgânicas')})`);
    const comOrg = A.metricas(SHC.adsResumo({ summary: { metricsSummary: Object.assign({ organicUnitsQuantity: 3, organicUnitsAmount: 300 }, met) } })), comTacos = A.metricas(SHC.adsResumo({ summary: { metricsSummary: Object.assign({ tacos: 9.87 }, met) } }));
    ok(comOrg.tacos === 10 && comOrg.organicasUn === 3 && comOrg.organicasValor === 300 && comTacos.tacos === 9.87,
        '#24 com as orgânicas lidas: TACOS = Ads ÷ (receita + orgânicas) = 50 ÷ 500 = 10%; com o tacos do ML: o do ML');
    const parte = A.soma([A.metricas({ cost: 10, totalAmount: 40, organicUnitsQuantity: 2, organicUnitsAmount: 60 }), A.metricas({ cost: 10, totalAmount: 40 })]);
    ok(parte.organicasUn === null && parte.organicasValor === null && parte.tacos === null && parte.investimento === 20 && parte.receita === 80,
        '#24 A.soma: orgânicas de só uma parte das campanhas ficam null (não a soma parcial), os outros campos somam');
    prop('#24 contas geradas sem as orgânicas do ML: TACOS e "Vendas orgânicas" = "—" na conta e em cada campanha', contas.filter(c => !c.comOrganicas), c => {
        const a = c.an.kpis.atual, h = A.htmlKpis(c.an.kpis);
        return (a.tacos === null && a.organicasUn === null && a.organicasValor === null && kp(h, 'TACOS') === '—' && kp(h, 'Vendas orgânicas') === '—' && c.an.camps.every(k => !k.m || k.m.tacos === null))
            || `conta ${c.k}: TACOS ${a.tacos} · ${kp(h, 'Vendas orgânicas')}`;
    });
}
{   // #25: ACOS e ROAS arredondados uma vez só, no texto: KPI, campanha, tabela por SKU e painel iguais
    const tela = (cost, totalAmount, extra) => {
        const snap = contaFixa([{ id: 'MLB9000000021', title: 'Produto D', campaignId: 5, cost, totalAmount, prints: 1000, clicks: 10, unitsQuantity: 1 }], { resumoExtra: extra });
        const an = A.analisa(snap, [{ itemId: 'MLB9000000021', sku: 'TST-D', titulo: 'Produto D', preco: 100, recebe: 80 }], () => null, {}, []), p = P.adsConta(snap);
        const k4 = /ROAS · ACOS ⓘ<\/div><div class="v">(.*?) <small>· (.*?)<\/small>/.exec(A.htmlKpis4(an)), cl = celulas(A.htmlCampanhas(an.camps).split('<tr><td class="tit">')[1].split('</tr>')[0]);
        const sk = celulas(A.htmlSkusTabela(an.grupos).split('<tr><td class="tit">')[1]);
        return { roas: [k4[1], cl[4], sk[8], xPainel(p.roas)], acos: [k4[2], cl[5], sk[9], SHC.pctTxt(p.acos)] };
    };
    const igual = l => l.every(t => t === l[0]);
    const a = tela(43.21, 100.14), b = tela(200, 201), c = tela(43.21, 100.14, { acos: 43.15, roas: 2.32 });
    ok(igual(a.acos) && a.acos[0] === '43,1%' && igual(a.roas) && a.roas[0] === '2,32x', `#25 Ads R$ 43,21 ÷ R$ 100,14: "43,1%" e "2,32x" no KPI, na campanha, no SKU e no painel (obtido: ${a.acos.join(' | ')} · ${a.roas.join(' | ')})`);
    ok(igual(b.roas) && b.roas[0] === '1,01x' && igual(b.acos), `#25 ROAS 201 ÷ 200 = 1,005: "1,01x" nas quatro telas (obtido: ${b.roas.join(' | ')})`);
    ok(igual(c.acos) && c.acos[0] === '43,1%', `#25 o ML manda o acos com 2 casas (43,15): a tela calcula de novo do custo e da receita → "43,1%" em todas (obtido: ${c.acos.join(' | ')})`);
    const g = SHC.adsMetricas({ cost: 43.21, totalAmount: 100.14 });
    ok(g.acos === 43.21 / 100.14 * 100 && g.roas === 100.14 / 43.21, '#25 o fundo grava ACOS e ROAS calculados crus (sem as 2 casas)');
    const rnd = semente(725);
    prop('#25 pares custo × receita em centavos: o texto do ACOS e do ROAS é o mesmo no KPI, na campanha, no SKU e no painel', vezes(300), () => {
        const cC = I(rnd, 1, 500000), rC = I(rnd, 1, 2000000), t = tela(cC / 100, rC / 100);
        return (igual(t.acos) && igual(t.roas) && Math.abs(dePct(t.acos[0]) - cC / rC * 100) <= 0.05 + 1e-9 && Math.abs(deX(t.roas[0]) - rC / cC) <= 0.005 + 1e-9) || `${cC} ÷ ${rC}: ${t.acos.join(' | ')} · ${t.roas.join(' | ')}`;
    });
}
{   // #26: o mesmo lucro depois do Ads e o mesmo selo do anúncio em ads.html e no painel (SHC.adsLucro nas duas telas)
    const cfg = { imposto_pct: 0, margem_alvo_pct: 10 }, custo = () => ({ custo: 50 }), sobraDe = it => SHC.sobraAnuncio(it, custo(), cfg);
    const it = [{ itemId: 'MLB9000000002', sku: 'TST-F', titulo: 'Produto F', preco: 100, recebe: 80 }];   // sobra hoje R$ 30/un. (30%)
    const duas = rows => { const snap = P.adsLigaCatalogo(contaFixa(rows, { semResumo: true }), it), an = A.analisa(snap, it, custo, cfg, []), l = P.adsEquilibrio(snap, it, sobraDe); return { g: an.grupos[0], l, an, snap }; };
    const a = duas([{ id: 'MLB9000000002', title: 'Produto F', campaignId: 7, cost: 57, totalAmount: 180, prints: 500, clicks: 12, unitsQuantity: 2 }]);   // 2 vendas a R$ 90
    ok(A.textoMontante(a.g) === 'Ads R$ 57,00 · Prejuízo R$ 3,00' && a.g.selos.includes('acima') && a.l.length === 1 && a.l[0].depois === -3 && a.l[0].antes === 54 && a.l[0].acima === true
        && a.l[0].acos > a.l[0].margem, `#26 vendido a R$ 90 com o preço de hoje R$ 100 (Ads R$ 57): "Prejuízo R$ 3,00" e "acima" nas duas telas, e o painel coerente com ACOS 31,7% > equilíbrio 30% (obtido: ${A.textoMontante(a.g)} × painel ${a.l[0].depois} ${a.l[0].acima})`);
    const sv = duas([{ id: 'MLB9000000002', title: 'Produto F', campaignId: 7, cost: 12, totalAmount: 0, prints: 500, clicks: 12, unitsQuantity: 0 }]);
    ok(sv.g.selos.includes('acima') && sv.g.selos.includes('semVenda') && sv.l[0].acima === true && sv.g.acao.tipo === 'tirar' && sv.an.res.acima === 1
        && A.htmlSkus(sv.an.grupos, 'todos').indexOf('Acima do equilíbrio (1)') > 0 && /^1 produto passa do equilíbrio/.test(sv.an.manchete.acao),
        `#26 gastou sem venda: "acima" nas duas telas (o painel já marcava) e a contagem da manchete = o filtro "Acima do equilíbrio (1)" (obtido: selos ${sv.g.selos} · ${sv.an.manchete.acao})`);
    const rnd = semente(726);
    prop('#26 preço do período ≠ preço de hoje (promoção): o lucro e o selo do anúncio são os mesmos nas duas telas, no centavo', vezes(400), () => {
        const v = I(rnd, 1, 8), recC = I(rnd, 1, 12000) * v, costC = I(rnd, 1, recC);
        const r = duas([{ id: 'MLB9000000002', title: 'Produto F', campaignId: 7, cost: costC / 100, totalAmount: recC / 100, prints: 500, clicks: 12, unitsQuantity: v }]);
        return (r.l.length === 1 && cent(r.g.lucroRs) === cent(r.l[0].depois) && cent(r.g.sobraRs) === cent(r.l[0].antes) && r.g.selos.includes('acima') === r.l[0].acima
            && Math.abs(cent(r.l[0].antes) - recC * 0.3) <= 0.5 + 1e-6) || `${v} vendas · receita ${recC} · Ads ${costC}: ${A.textoMontante(r.g)} × painel ${r.l[0].depois}`;
    });
    // #26 (revisão): o aviso do fundo (SHC.alertasDe → número do ícone, sino e "N coisas pedem sua atenção") usa a mesma conta do cartão
    // Alertas do painel (P.alertas de P.adsEquilibrio) e de ads.html. Antes usava sobra de hoje × unidades e discordava nos dois sentidos.
    const avisos = r => ({ ic: SHC.alertasDe({ ads: r.snap, itens: it, custos: { [SHC.chaveSku('TST-F')]: custo() }, cfg, hoje: '2026-10-07', full: { produtos: [] } }), card: P.alertas([], r.l, [], {}) });
    const va = avisos(a), ac = duas([{ id: 'MLB9000000002', title: 'Produto F', campaignId: 7, cost: 62, totalAmount: 220, prints: 500, clicks: 12, unitsQuantity: 2 }]), vb = avisos(ac);   // 2 vendas a R$ 110
    ok(va.ic.ads === 1 && va.card.ads === 1 && va.ic.lista[0].texto === 'O Ads gastou R$ 57,00 e a sobra dessas vendas antes do Ads era R$ 54,00 (margem de 30%).' && va.ic.lista[0].excesso === 3,
        `#26 vendido a R$ 90 (Ads R$ 57, "Prejuízo R$ 3,00" em ads.html): o ícone conta 1 como o cartão Alertas, sobra antes do Ads R$ 54,00 (obtido: ícone ${va.ic.ads} · cartão ${va.card.ads} · ${va.ic.lista.map(x => x.texto).join('')})`);
    ok(A.textoMontante(ac.g) === 'Ads R$ 62,00 · Lucro R$ 4,00' && !ac.g.selos.includes('acima') && vb.ic.ads === 0 && vb.card.ads === 0 && vb.ic.criticos === 0,
        `#26 vendido a R$ 110 (Ads R$ 62, "Lucro R$ 4,00" em ads.html): nem o ícone nem o cartão Alertas avisam (obtido: ícone ${vb.ic.ads} ${vb.ic.lista.map(x => x.texto).join('')} · cartão ${vb.card.ads})`);
    const rnd2 = semente(7262);
    prop('#26 preço do período ≠ preço de hoje: o ícone (SHC.alertasDe) avisa ⇔ o cartão Alertas do painel avisa ⇔ ads.html dá o selo "acima", e a sobra do aviso = "antes" do painel', vezes(400), () => {
        const v = I(rnd2, 0, 8), recC = v ? I(rnd2, 1, 12000) * v : 0, costC = I(rnd2, 1, Math.max(recC, 500));
        const r = duas([{ id: 'MLB9000000002', title: 'Produto F', campaignId: 7, cost: costC / 100, totalAmount: recC / 100, prints: 500, clicks: 12, unitsQuantity: v }]), x = avisos(r), sel = r.g.selos.includes('acima') ? 1 : 0;
        return (x.ic.ads === sel && x.card.ads === sel && (!sel || cent(x.ic.lista[0].excesso) === costC - cent(r.l[0].antes))) || `${v} vendas · receita ${recC} · Ads ${costC}: ${A.textoMontante(r.g)} · ícone ${x.ic.ads} · cartão ${x.card.ads}`;
    });
}
{   // #26 (b), revisão 2: o anúncio em várias campanhas, também numa em que gastou R$ 0 e o ML atribuiu venda. Regra: o lucro do anúncio é o das
    // campanhas somadas (a venda atribuída ao Ads entra mesmo sem gasto naquela campanha), como ads.html (por SKU) e o cartão "Ads deste anúncio"
    // já faziam. O painel junta as linhas do anúncio numa entrada só, e o ícone também. A campanha continua com a conta só das linhas dela, e
    // "dá para investir mais" olha só o que foi pago (a venda grátis não diz que vale pôr mais dinheiro).
    const cfg = { imposto_pct: 0, margem_alvo_pct: 10 }, custo = () => ({ custo: 50 }), sobraDe = it => SHC.sobraAnuncio(it, custo(), cfg);
    const it = [{ itemId: 'MLB9000000002', sku: 'TST-F', titulo: 'Produto F', preco: 100, recebe: 80 }];   // sobra hoje R$ 30/un. (30%)
    const linha = (campaignId, cost, totalAmount, unitsQuantity) => ({ id: 'MLB9000000002', title: 'Produto F', campaignId, cost, totalAmount, prints: 500, clicks: 12, unitsQuantity });
    const telas = (rows, perde) => {
        const snap0 = contaFixa(rows, { semResumo: true });
        if (perde) snap0.campanhas.forEach(c => { c.share = SHC.adsShare({ impressionShare: 0.5, lostImpressionShareByBudget: 0.3, lostImpressionShareByAdRank: 0.2 }); });
        const snap = P.adsLigaCatalogo(snap0, it), an = A.analisa(snap, it, custo, cfg, []), l = P.adsEquilibrio(snap, it, sobraDe), d = P.adsDoItem(snap, 'MLB9000000002');
        const ic = SHC.alertasDe({ ads: snap, itens: it, custos: { [SHC.chaveSku('TST-F')]: custo() }, cfg, hoje: '2026-10-07', full: { produtos: [] } });
        return { g: an.grupos[0], an, l, ic, card: P.alertas([], l, [], {}), ver: P.adsVeredito(d.m, SHC.adsEquilibrio(it[0], custo(), cfg)), fs: P.adsFiltros(l, cfg.margem_alvo_pct),
            camps: P.adsCampanhasLista(snap, l), conta: P.adsVereditoDe(l, P.adsConta(snap).gasto) };
    };
    const b = telas([linha(7, 40, 100, 1), linha(8, 0, 200, 2)]);
    const c7 = b.camps.find(c => c.id === '7'), c8 = b.camps.find(c => c.id === '8'), h7 = b.an.camps.find(c => c.id === '7').leitura.linhas.join(' ');
    ok(A.textoMontante(b.g) === 'Ads R$ 40,00 · Lucro R$ 50,00' && !b.g.selos.includes('acima') && b.l.length === 1 && b.l[0].antes === 90 && b.l[0].depois === 50 && b.l[0].acima === false
        && b.l[0].a.gasto === 40 && b.l[0].a.receita === 300 && b.l[0].linhas.length === 2 && b.ic.ads === 0 && b.card.ads === 0 && b.ver.tipo === 'compensa' && b.conta.tipo === 'compensa',
        `#26 (b) C7 Ads R$ 40 (R$ 100) + C8 Ads R$ 0 (R$ 200 atribuídos): "Lucro R$ 50,00" e sem "acima" em ads.html, no painel (1 entrada), no cartão Alertas, no ícone e no cartão do anúncio (obtido: ${A.textoMontante(b.g)} · painel ${b.l.map(x => x.depois + (x.acima ? ' acima' : '')).join(' | ')} · ícone ${b.ic.ads} · cartão ${b.ver.tipo})`);
    ok(c7.veredito.tipo === 'nao' && /acima do equilíbrio/.test(h7) && c8.veredito.tipo === 'semGasto',
        `#26 (b) a campanha fica com a conta dela: C7 (Ads R$ 40, sobra R$ 30) "Não compensa" no painel e "acima do equilíbrio" em ads.html; C8 sem gasto (obtido: ${c7.veredito.tipo} · ${h7} · ${c8.veredito.tipo})`);
    const d2 = telas([linha(1, 50, 100, 1), linha(2, 10, 300, 3)]);
    ok(A.textoMontante(d2.g) === 'Ads R$ 60,00 · Lucro R$ 60,00' && d2.l.length === 1 && d2.l[0].depois === 60 && !d2.l[0].acima && d2.ic.ads === 0 && d2.card.ads === 0 && d2.fs.acima.length === 0
        && d2.camps.find(c => c.id === '1').veredito.tipo === 'nao' && d2.camps.find(c => c.id === '2').veredito.tipo === 'compensa',
        `#26 o mesmo anúncio em 2 campanhas com gasto (C1 −R$ 20, C2 +R$ 80): 1 entrada com "Lucro R$ 60,00" no painel e em ads.html, sem aviso no ícone (antes: o anúncio duas vezes, uma "acima") (obtido: ${d2.l.map(x => x.depois).join(' | ')} · ícone ${d2.ic.ads})`);
    const e1 = telas([linha(7, 30, 100, 1), linha(8, 0, 500, 5)], true), e2 = telas([linha(7, 5, 100, 1), linha(8, 0, 100, 1)], true);
    ok(e1.fs.escalar.length === 0 && !e1.g.selos.includes('escalar') && e1.l[0].acos === 5 && e1.l[0].acosPago === 30
        && e2.fs.escalar.length === 1 && e2.g.selos.includes('escalar') && e2.l[0].acosPago === 5,
        `#26 "dá para investir mais" só pelo que foi pago: Ads R$ 30 em R$ 100 (ACOS pago 30%) + R$ 500 atribuídos sem gasto (ACOS 5%) não entra; ACOS pago 5% entra (obtido: ${e1.fs.escalar.length} [${e1.g.selos}] · ${e2.fs.escalar.length} [${e2.g.selos}])`);
    const rnd = semente(7263);
    prop('#26 anúncio em 1 a 3 campanhas, com linhas sem gasto que trouxeram venda: ads.html, o painel (1 entrada), o cartão Alertas, o ícone e o cartão do anúncio com o mesmo lucro e o mesmo "acima"; a campanha no painel × ads.html', vezes(500), () => {
        const rows = [7, 8, 9].slice(0, I(rnd, 1, 3)).map(c => { const v = I(rnd, 0, 6), recC = v ? I(rnd, 1, 15000) * v : 0; return linha(c, (rnd() < 0.35 ? 0 : I(rnd, 1, Math.max(recC, 900))) / 100, recC / 100, v); });
        if (!rows.some(r => r.cost > 0)) rows[0].cost = 0.5;
        const t = telas(rows), x = t.l[0], ac = t.g.selos.includes('acima'), tag = `${JSON.stringify(rows.map(r => [r.campaignId, r.cost, r.totalAmount]))}: ${A.textoMontante(t.g)} · painel ${t.l.map(y => y.depois).join('|')} · ícone ${t.ic.ads} · cartão ${t.ver.tipo}`;
        const camps = t.camps.every(c => { const rs = rows.filter(r => String(r.campaignId) === c.id), luc = rs.reduce((s, r) => s + cent(SHC.r2(r.totalAmount * 0.3)) - cent(r.cost), 0), h = t.an.camps.find(k => k.id === c.id).leitura.linhas.join(' ');
            return !rs.some(r => r.cost > 0) ? c.veredito.tipo === 'semGasto' : luc === 0 || ((luc < 0) === (c.veredito.tipo === 'nao') && (luc < 0) === /acima do equilíbrio|Gastou sem nenhuma venda/.test(h)); });
        return (t.l.length === 1 && cent(x.depois) === cent(t.g.lucroRs) && cent(x.antes) === cent(t.g.sobraRs) && x.acima === ac && (t.ic.ads === 1) === ac && (t.card.ads === 1) === ac
            && (t.g.lucroRs === 0 || (t.ver.tipo === 'nao') === ac) && camps) || tag;
    });
}
{   // #27: sem o resumo do ML (campaigns/metrics falhou) e com a lista de anúncios em parte: o mesmo Investimento nas duas telas e Total = Σ campanhas
    const conta = (cs, ads, resumo) => ({ temAds: true, completo: false, anterior: { campanhas: {}, total: null }, resumo: resumo ? SHC.adsResumo({ summary: { metricsSummary: resumo } }) : null,
        campanhas: SHC.adsCampanhas({ paging: { total: cs.length }, results: cs.map(([id, cost, totalAmount, prints, clicks, unitsQuantity]) => ({ id, name: 'C' + id, status: 'A', metrics: { cost, totalAmount, prints, clicks, unitsQuantity } })) }).campanhas,
        anuncios: SHC.adsAnuncios({ paging: { total: ads.length + 1 }, results: ads.map(([id, campaignId, cost, totalAmount, prints, clicks, unitsQuantity]) => ({ id, title: 'Anúncio ' + id, campaignId, cost, totalAmount, prints, clicks, unitsQuantity })) }).anuncios });
    const tela = s => { const k = A.kpis(s, A.campanhas(s)).atual, m = P.adsConta(s), t = P.adsCampanhasTotal(P.adsCampanhasLista(s, [])); return { k, m, t }; };
    const a = tela(conta([[1, 70, 300, 900, 30, 3], [2, 30, 100, 400, 8, 1]], [['MLB9000000011', 1, 40, 200, 500, 20, 2], ['MLB9000000012', 2, 20, 60, 300, 5, 1]]));
    ok(a.k.investimento === 100 && a.m.gasto === 100 && a.k.receita === 400 && a.m.receita === 400 && SHC.pctTxt(a.m.acos) === '25%' && SHC.pctTxt(a.k.acos) === '25%' && a.t.gasto === 100 && a.t.receita === 400 && SHC.pctTxt(a.t.acos) === '25%',
        `#27 sem o resumo: Investimento R$ 100,00 · Receita R$ 400,00 · ACOS 25% em ads.html, no painel e na linha Total (C1 R$ 70 + C2 R$ 30) (obtido: painel ${a.m.gasto} · Total ${a.t.gasto})`);
    const b = tela(conta([[1, 70, 300, 900, 30, 3], [2, 20, 60, 300, 5, 1]], [['MLB9000000011', 1, 40, 200, 500, 20, 2], ['MLB9000000012', 2, 20, 60, 300, 5, 1]]));
    ok(b.k.investimento === 90 && b.m.gasto === 90 && b.m.receita === 360 && b.k.receita === 360 && b.t.gasto === 90 && b.m.vendas === 4 && b.m.cliques === 35,
        `#27 C1 = R$ 70 (anúncio de R$ 30 não lido) + C2 = R$ 20: as duas telas e o Total = R$ 90,00 (obtido: painel ${b.m.gasto} · Total ${b.t.gasto})`);
    const c = tela(conta([[1, 70, 300, 900, 30, 3], [2, 30, 100, 400, 8, 1]], [], { cost: 101, totalAmount: 401, prints: 1300, clicks: 38, unitsQuantity: 4 }));
    ok(c.m.gasto === 101 && c.k.investimento === 101 && c.t.gasto === 100 && c.t.receita === 400, '#27 com o resumo do ML: a conta é a do ML nas duas telas, e a linha Total continua a soma das linhas (R$ 70 + R$ 30)');
    prop('#27 contas geradas sem o resumo e com metade dos anúncios: o total da conta (P.adsConta = A.kpis) é a Σ das campanhas, e a linha Total = Σ das linhas', contas, c => {
        const s = Object.assign({}, c.snap, { resumo: null, completo: false, anuncios: c.snap.anuncios.filter((_, i) => i % 2 === 0) }), sp = P.adsLigaCatalogo(s, c.itens);
        const k = A.kpis(s, A.campanhas(s)).atual, m = P.adsConta(sp), rows = P.adsCampanhasLista(sp, []), t = P.adsCampanhasTotal(rows);
        return (cent(m.gasto) === c.tot.costC && cent(k.investimento) === c.tot.costC && cent(m.receita) === c.tot.recC && cent(k.receita) === c.tot.recC && m.vendas === c.tot.v && m.cliques === c.tot.cli
            && m.impressoes === c.tot.imp && cent(t.gasto) === rows.reduce((x, r) => x + cent(r.m.gasto), 0) && cent(t.gasto) === c.tot.costC && cent(t.receita) === c.tot.recC)
            || `conta ${c.k}: painel ${m.gasto} · ads.html ${k.investimento} · Total ${t.gasto} × ${reais(c.tot.costC)}`;
    });
}
{   // #28: Product Ads líquido negativo no mês (estorno maior que a cobrança) é crédito, não gasto: o sinal − fica
    const f = SHC.fechamentoDasCobrancas([{ id: '1|2|CPADS', data: '2026-09-05', texto: 'Product Ads', valor: 10 }, { id: '1|3|BPADS', data: '2026-09-06', texto: 'Cancelamento de Product Ads', valor: 25 }])['2026-09'];
    const a = P.adsDoFechamento(f), mod = A.modelos([], [{ mes: '09/2026', porTipo: f.porTipo }])[0];
    ok(f.porTipo.ads === -15 && a.ads === -15 && a.total === -15 && a.texto === '−R$ 15,00 de Product Ads (estornos maiores que as cobranças)'
        && mod.detalhe === 'Nenhuma campanha lida no Mercado Ads. No Faturamento de 09/2026: −R$ 15,00 (estornos maiores que as cobranças no mês).',
        `#28 Product Ads R$ 10,00 − estorno R$ 25,00: "−R$ 15,00" no painel e em ads.html, nunca R$ 15,00 de gasto (obtido: ${JSON.stringify(a)} | ${mod.detalhe})`);
    const b = P.adsDoFechamento({ porTipo: { ads: 120.5, ads_seguidores: -7.25 } });
    ok(b.ads === 120.5 && b.seguidores === -7.25 && b.total === 113.25 && b.texto === 'R$ 120,50 de Product Ads e −R$ 7,25 de Publicidade de Seguidores (estornos maiores que as cobranças)'
        && P.adsDoFechamento({ porTipo: { ads: 30, ads_seguidores: 5 } }).texto === 'R$ 30,00 de Product Ads + R$ 5,00 de Publicidade de Seguidores',
        `#28 seguidores com estorno líquido: total = R$ 120,50 − R$ 7,25 = R$ 113,25 e o texto com o sinal (obtido: ${b.texto})`);
    const rnd = semente(728);
    prop('#28 meses com estorno até 3× a cobrança: Ads do Faturamento (painel e ads.html) = cobrado − estornado com o sinal, no centavo', vezes(300), i => {
        const cobC = I(rnd, 1, 50000), canC = I(rnd, 1, cobC * 3), segC = rnd() < 0.5 ? I(rnd, -20000, 20000) : 0, liq = cobC - canC;
        const fx = SHC.fechamentoDasCobrancas([{ id: `${i}|1|CPADS`, data: '2026-08-03', texto: 'Product Ads', valor: cobC / 100 }, { id: `${i}|2|BPADS`, data: '2026-08-04', texto: 'Cancelamento de Product Ads', valor: canC / 100 }])['2026-08'];
        const pt = Object.assign({}, fx.porTipo, segC ? { ads_seguidores: segC / 100 } : {}), x = P.adsDoFechamento({ porTipo: pt });
        const det = (A.modelos([], [{ mes: '08/2026', porTipo: pt }]).map(m => m.detalhe).join(' ').match(/No Faturamento de 08\/2026: (−?R\$ [\d.]+,\d\d)/g) || []).map(t => deMoeda(t.replace(/^.*: /, '')));
        const esperado = [liq, segC].filter(Boolean);
        return (cent(x.ads) === liq && (segC ? cent(x.seguidores) === segC : !x.seguidores) && cent(x.total) === liq + segC && x.texto.indexOf(reais(liq) + ' de Product Ads') === 0
            && JSON.stringify(det) === JSON.stringify(esperado)) || `cobrado ${cobC} estorno ${canC} seguidores ${segC}: ${JSON.stringify(x)} · ${det}`;
    });
}

console.log(`\n${nChecks} verificações.`);
if (f) { console.log(f + ' FALHA(S)'); process.exit(1); }
console.log('TUDO OK');
