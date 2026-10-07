// "Cada centavo tem que bater" (pedido da dona, 07/10/2026): toda conta de dinheiro do FECHAMENTO DO MÊS fecha no centavo, e a tela
// (SHC.moeda) mostra o mesmo número da conta.
//   • SHC.r2 / SHC.moeda: centavo nunca some nem aparece ao somar; nada vazio, NaN ou Infinity vira "R$".
//   • F.vendasBrutas, F.custoProdutos, F.cascata (vendas − canceladas − tarifas − frete − Ads − … − produtos − imposto − despesas = sobra),
//     SHC.despesasFixasDoMes (proporcional), F.recuperar ("Quanto dá para recuperar"), F.comparaRepasse, F.ondeFoi, F.tabelaTipos,
//     F.custosTopicos, F.gargalo, F.somaDias/F.htmlCiclo, F.conferirFatura (pela fatura de cada cobrança), F.faturaVsAnterior e os textos de chamado.
//   • Cada conta é refeita aqui em CENTAVOS INTEIROS (sem ponto flutuante) e comparada com a do Copiloto e com o texto da tela.
// Casos gerados: gerador congruencial (LCG) com semente fixa — o teste dá sempre o mesmo resultado. Ids e valores são inventados.
// Divergências encontradas no produto (registradas para a equipe, com repro em scratchpad/centavos/). As marcadas "corrigida" têm caso
// próprio que falhava antes da correção; as outras ficam FORA das asserções:
//   1. (corrigida) F.conferir + F.recuperar somavam 2 regras sobre a MESMA cobrança (repetida + sem estorno; repetida + tarifa acima) → recuperar > cobrado;
//   2. (corrigida) F.recuperar contava o custo inteiro da remessa do Full (coleta) como "dá para recuperar";
//   3. SHC.r2 perde 1 centavo em parte dos empates de meio centavo (ex.: imposto de 5% sobre R$ 42,70 = 2,135 → R$ 2,13);
//   4. (corrigida; caso em teste_centavos_frete.js, D) F.recuperar usava a lista pagoAMais cortada em 200: o frete confirmado acima disso sumia do total;
//   5. (corrigida) F.conferirFatura no modo exato (pela fatura) aceitava R$ 0,01 de diferença como "✓ bate" (tela: ML R$ 100,01 · Copiloto R$ 100,00 ✓);
//   6. (corrigida) F.motivoTotal só citava o resto que passa de R$ 1: total ✗ por R$ 0,50 com o motivo "Diferença nos custos (+R$ 0,00).";
//   7. Rateio (SHC.rateioFaturas → F.htmlRateio): "✓ bate com o total da fatura" com até R$ 1,00 de diferença (partes por mês ≠ total mostrado).
// Rodar: node tests/copiloto/teste_centavos_fechamento.js
'use strict';
require('./relogio').fixar();
const path = require('path');
global.chrome = { storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } }, runtime: { sendMessage: async () => ({}) } };
const EXT = path.join(__dirname, '../../extension-copiloto');
const SHC = require(path.join(EXT, 'calc.js'));
['store.js', 'ml-extrator.js', 'fechamento.js'].forEach(a => require(path.join(EXT, a)));
const F = SHC.fech;
let f = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) f++; };

// ── Ferramentas ──
// Gerador congruencial (Numerical Recipes): mesma semente = mesma sequência.
const lcg = semente => { let s = semente >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; };
const inteiro = (rnd, a, b) => a + Math.floor(rnd() * (b - a + 1));
const escolhe = (rnd, l) => l[Math.floor(rnd() * l.length)];
const C = v => Math.round(v * 100);                 // reais (já em centavos) → centavos inteiros
const R = c => c / 100;                              // centavos inteiros → reais
const soma = l => l.reduce((s, x) => s + x, 0);
// Texto da tela → centavos inteiros (NaN se não for o formato do SHC.moeda: "R$ 1.234,56" ou "−R$ 1.234,56").
const lerMoeda = t => { const m = /^(−?)R\$ (\d{1,3}(?:\.\d{3})*),(\d{2})$/.exec(String(t).trim()); return m ? (m[1] ? -1 : 1) * (parseInt(m[2].replace(/\./g, ''), 10) * 100 + parseInt(m[3], 10)) : NaN; };
const RX_MOEDA = /−?R\$ \d{1,3}(?:\.\d{3})*,\d{2}/g;
const moedasDe = t => (String(t).match(RX_MOEDA) || []).map(lerMoeda);
const semLixo = h => !/NaN|Infinity|undefined|R\$ null|R\$ -/.test(h);
const tiraTags = h => String(h).replace(/<[^>]*>/g, '');
// ok() de muitos casos gerados: 1 linha com o 1º caso que falhou.
function todos(n, gera, checa, msg) {
    let ruim = null;
    for (let i = 0; i < n && !ruim; i++) { const x = gera(i), r = checa(x); if (r !== true) ruim = { i, r, x }; }
    ok(!ruim, msg + ' (' + n + ' casos)' + (ruim ? ' — caso ' + ruim.i + ': ' + ruim.r : ''));
    if (ruim) console.log('     ', JSON.stringify(ruim.x).slice(0, 600));
}
const TIPOS = SHC.TIPOS_FECHAMENTO;

console.log('SHC.r2 e SHC.moeda: centavo não some nem aparece');
{
    const rnd = lcg(20261007);
    todos(20000, () => inteiro(rnd, -1e9, 1e9), c => (SHC.r2(R(c)) === R(c) ? true : 'r2(' + R(c) + ') = ' + SHC.r2(R(c))),
        'r2 de um valor já em centavos devolve o mesmo valor (de −R$ 10 milhões a R$ 10 milhões)');
    todos(3000, () => Array.from({ length: inteiro(rnd, 1, 400) }, () => inteiro(rnd, -500000, 2000000)), l => {
        const passo = l.reduce((s, c) => SHC.r2(s + R(c)), 0), bruto = SHC.r2(l.reduce((s, c) => s + R(c), 0));
        return C(passo) === soma(l) && C(bruto) === soma(l) ? true : 'Σ ' + soma(l) + ' centavos; r2 a cada passo ' + C(passo) + ', r2 no fim ' + C(bruto);
    }, 'somar centavos com r2 a cada passo ou só no fim dá a soma exata (nenhum centavo perdido ou criado)');
    todos(20000, () => inteiro(rnd, -1e10, 1e10), c => (lerMoeda(SHC.moeda(R(c))) === c ? true : SHC.moeda(R(c)) + ' ≠ ' + c),
        'SHC.moeda mostra exatamente o valor (sinal, milhar e centavos) e o texto volta ao mesmo número');
    ok(SHC.moeda(-12.5) === '−R$ 12,50' && SHC.moeda(12.5) === 'R$ 12,50', 'negativo com o sinal "−" na frente do R$; positivo sem sinal');
    ok(SHC.moeda(-0) === 'R$ 0,00' && SHC.moeda(SHC.r2(-0.004)) === 'R$ 0,00', 'zero negativo não vira "−R$ 0,00"');
    ok([null, undefined, NaN, Infinity, -Infinity, 0 / 0].every(v => SHC.moeda(v) === '—'), 'null, undefined, NaN e Infinity viram "—" (nunca "R$ NaN" nem "R$ 0,00")');
    todos(5000, () => inteiro(rnd, -1e8, 1e8) + 0.5, cmeio => { const v = R(cmeio), d = Math.abs(C(SHC.r2(v)) - cmeio); return d === 0.5 ? true : 'r2(' + v + ') = ' + SHC.r2(v); },
        'r2 de meio centavo nunca erra mais que meio centavo (o lado do empate: ver as divergências no topo)');
}

console.log('F.vendasBrutas: a soma dos dias, sem inventar mês inteiro');
{
    const rnd = lcg(11);
    const geraMes = (mes, nDias, diasLidos) => {
        const dias = {}, tot = { b: 0, c: 0, d: 0 };
        for (let d = 1; d <= nDias; d++) {
            if (diasLidos && diasLidos.indexOf(d) < 0) continue;
            const b = inteiro(rnd, 0, 900000), c = inteiro(rnd, 0, Math.floor(b / 10)), dv = inteiro(rnd, 0, Math.floor(b / 20));
            dias[mes + '-' + String(d).padStart(2, '0')] = { bruto: R(b), cancelado: R(c), devolvido: R(dv), unidades: inteiro(rnd, 0, 50), vendas: inteiro(rnd, 0, 40) };
            tot.b += b; tot.c += c; tot.d += dv;
        }
        // dias de OUTRO mês na mesma chave (vb:<conta> guarda 13 meses): não entram
        dias[F.mesAntes(mes, 1) + '-28'] = { bruto: 999.99, cancelado: 1, devolvido: 1 }; dias[F.mesAntes(mes, -1) + '-01'] = { bruto: 777.77, cancelado: 1, devolvido: 1 };
        return { dias, tot };
    };
    todos(200, () => geraMes('2026-09', 30), ({ dias, tot }) => {
        const v = F.vendasBrutas(null, { dias }, '2026-09', '2026-10-07');
        return v && v.completo && C(v.valor) === tot.b && C(v.cancelado) === tot.c && C(v.devolvido) === tot.d && v.dias === 30 ? true : JSON.stringify(v) + ' × ' + JSON.stringify(tot);
    }, 'setembro inteiro: valor, canceladas e devolvidas = a soma dos 30 dias em centavos (dias de agosto e outubro ficam fora)');
    const furado = geraMes('2026-09', 30, Array.from({ length: 29 }, (_, i) => i + 1));
    const vf = F.vendasBrutas(null, { dias: furado.dias }, '2026-09', '2026-10-07');
    ok(vf.completo === false && vf.naoLidoInteiro === true && C(vf.valor) === furado.tot.b, 'mês que acabou com 1 dia faltando: o valor lido fica, mas completo:false (não entra na cascata)');
    const andamento = geraMes('2026-10', 7);
    const va = F.vendasBrutas(null, { dias: andamento.dias }, '2026-10', '2026-10-07');
    ok(va.completo === true && C(va.valor) === andamento.tot.b, 'mês em andamento lido até hoje (7 de 31 dias): completo, valor = soma dos 7 dias');
    ok(F.vendasBrutas(null, null, '2026-09', '2026-10-07') === null && F.vendasBrutas({}, { dias: {} }, '2026-09', '2026-10-07') === null, 'sem leitura: null (nunca R$ 0,00)');
    const soNum = F.vendasBrutas({ vendasBrutas: '12.345,67' }, null, '2026-09', '2026-10-07');
    ok(soNum.valor === 12345.67 && soNum.completo === false && soNum.cancelado === null, 'fech.vendasBrutas só com o número ("12.345,67"): R$ 12.345,67, sem "mês inteiro" e sem canceladas inventadas');
    const zerado = F.vendasBrutas({ vendasBrutas: { valor: 0, dias: 30, cancelado: 0, devolvido: 0 } }, null, '2026-09', '2026-10-07');
    ok(zerado.valor === 0 && zerado.completo === true, 'mês lido inteiro sem venda: R$ 0,00 de verdade (lido)');
}

console.log('F.custoProdutos: unidades × (custo + outros) no centavo');
{
    const rnd = lcg(77);
    const MES = '2026-09';
    const gera = () => {
        const itens = [], vm = {}, custos = {};
        let esperado = 0, unidades = 0;
        const n = inteiro(rnd, 1, 40);
        for (let i = 0; i < n; i++) {
            const itemId = 'MLB9' + String(100000000 + i * 7919).slice(-9), sku = 'SKU-T' + i, un = inteiro(rnd, 0, 120);
            const custo = inteiro(rnd, 1, 300000), outros = rnd() < 0.4 ? inteiro(rnd, 1, 5000) : 0;
            itens.push({ itemId, sku, titulo: 'Produto teste ' + i });
            custos[SHC.chaveSku(sku)] = Object.assign({ custo: R(custo) }, outros ? { outros: R(outros) } : {});
            vm[itemId] = { [MES]: un, '2026-08': inteiro(rnd, 0, 99) };
            esperado += un * (custo + outros); unidades += un;
        }
        return { itens, vm, custos, esperado, unidades };
    };
    todos(300, gera, x => {
        const p = F.custoProdutos(x.itens, x.vm, x.custos, MES, null, null);
        return C(p.valor) === x.esperado && p.unidades === x.unidades && !p.semCusto.length ? true : 'valor ' + p.valor + ' × ' + R(x.esperado);
    }, 'custo do mês = Σ unidades × (custo + outros), só as vendas de setembro');
    // Variações (vbAnuncio, mês inteiro): cada variação com o custo do SKU dela; sem custo próprio, o do anúncio; o resto, o do anúncio.
    const itens = [{ itemId: 'MLB9000000101', sku: 'VAR-A', titulo: 'Camiseta' }];
    const custos = { [SHC.chaveSku('VAR-A')]: { custo: 10.37, outros: 0.5 }, [SHC.chaveSku('VAR-B')]: { custo: 12.99 } };
    const va = { meses: { [MES]: { completo: true, porAnuncio: { MLB9000000101: { unidades: 10, vendas: 8, porVariacao: { 'VAR-A': { unidades: 3 }, 'VAR-B': { unidades: 4 }, 'VAR-C': { unidades: 2 } } } } } } };
    const pv = F.custoProdutos(itens, {}, custos, MES, 8, va);
    // A: 3 × 10,87 · B: 4 × 12,99 · C (sem custo): 2 × 10,87 · sem variação: 1 × 10,87
    ok(C(pv.valor) === 3 * 1087 + 4 * 1299 + 2 * 1087 + 1 * 1087 && pv.unidades === 10 && pv.completo, 'variações: 3×A + 4×B + 2×C(custo do anúncio) + 1 sem variação = ' + SHC.moeda(pv.valor));
    const semC = F.custoProdutos([{ itemId: 'MLB9000000102', sku: 'SEM-CUSTO' }, { itemId: 'MLB9000000101', sku: 'VAR-A' }], { MLB9000000102: { [MES]: 3 }, MLB9000000101: { [MES]: 2 } }, custos, MES, null, null);
    ok(!semC.completo && semC.semCusto.length === 1 && C(semC.valor) === 2 * 1087, 'anúncio vendido sem custo: fica de fora, aparece em semCusto e o total não é "completo"');
    const casc = F.cascata({ fech: { porTipo: {} }, vb: { valor: 100, cancelado: 0, devolvido: 0, completo: true }, produtos: semC, impostoPct: 0 });
    ok(casc.linhas.find(l => l.id === 'produtos').valor === null && casc.lucro === null, '…e a cascata mostra "—" no custo dos produtos e no lucro (nunca R$ 0,00 inventado)');
    const nada = F.custoProdutos([], {}, {}, MES, null, null), zero = F.custoProdutos([], {}, {}, MES, 0, null);
    ok(nada.completo === false && zero.completo === true && zero.valor === 0, 'sem venda achada e sem a contagem do Faturamento: incompleto; Faturamento diz 0 vendas: R$ 0,00 de verdade');
    const falta = F.custoProdutos(itens, { MLB9000000101: { [MES]: 5 } }, custos, MES, 40, null);
    ok(falta.faltamDemais && !falta.completo, 'Faturamento com 40 vendas e só 5 achadas: custo dos produtos sem valor (não mostra um custo pela metade)');
}

// Mês aleatório: cobrado (≥ 0) e estornado (≥ 0) por tipo, em centavos; vb completo; produtos; imposto; despesas.
const MES_C = '2026-09', HOJE = '2026-10-07';
function mesAleatorio(rnd, comEpt) {
    const bruto = inteiro(rnd, 0, 60000000), cancel = inteiro(rnd, 0, Math.floor(bruto / 8)), devol = inteiro(rnd, 0, Math.floor(bruto / 20));
    const cob = {}, est = {};
    TIPOS.forEach(t => { cob[t] = rnd() < 0.15 ? 0 : inteiro(rnd, 0, Math.floor(bruto / 12) + 100); est[t] = rnd() < 0.5 ? 0 : inteiro(rnd, 0, Math.floor(cob[t] / 3)); });
    const porTipo = {}, ept = {};
    TIPOS.forEach(t => { if (cob[t] || est[t]) porTipo[t] = R(cob[t] - est[t]); if (est[t]) ept[t] = R(-est[t]); });
    const totEst = soma(TIPOS.map(t => est[t]));
    const fech = Object.assign({ porTipo, estornos: R(-totEst) }, comEpt && totEst ? { estornosPorTipo: ept } : {});
    const vb = { valor: R(bruto), cancelado: R(cancel), devolvido: R(devol), dias: 30, diasMes: 30, completo: true };
    const prod = inteiro(rnd, 0, Math.floor(bruto / 3));
    const impostoPct = escolhe(rnd, [0, 4, 5, 6, 6.5, 8.93, 11.33, 15.5, null]);
    const despesas = rnd() < 0.7 ? SHC.despesasFixasDoMes(Array.from({ length: inteiro(rnd, 1, 6) }, (_, i) => ({ nome: 'Despesa ' + i, valor: R(inteiro(rnd, 0, 2000000)) })), MES_C, HOJE) : null;
    return { fech, vb, produtos: { valor: R(prod), completo: true }, impostoPct, despesas, mes: MES_C, cent: { bruto, cancel: cancel + devol, cob, est, totEst, prod } };
}
// Desce a cascata como a tela: total = valor corrido; menos subtrai; mais soma; info fica fora. → '' (fecha) | o que não fechou.
function desce(linhas, valorDe) {
    let corre = null;
    for (const l of linhas) {
        const v = valorDe(l);
        if (l.tipo === 'info') continue;
        if (l.tipo === 'total') {
            if (v === null) { corre = null; continue; }
            if (corre !== null && v !== corre) return l.id + ': mostra ' + v + ', a conta dá ' + corre;
            corre = v; continue;
        }
        if (v === null || corre === null) { corre = null; continue; }
        corre = l.tipo === 'menos' ? corre - v : corre + v;
    }
    return '';
}
// Linhas da tabela da cascata (F.htmlCascata) → [{tipo, rotulo, txt, valor (centavos, com o sinal da própria linha) | null, sinal}]
function linhasDaTela(html) {
    const out = [], rx = /<tr class="(total|menos|mais|info)"><td class="rot"><b>([^<]*)<\/b>[\s\S]*?<\/td><td class="bar">[\s\S]*?<\/td><td class="num">([\s\S]*?)<\/td><td class="num pc">/g;
    let m;
    while ((m = rx.exec(html))) {
        const txt = m[3].replace(/<span class="mini">[\s\S]*?<\/span>/, '');
        const s = /^(− |\+ |\()?(.*?)(\))?$/.exec(txt);
        out.push({ tipo: m[1], rotulo: m[2], txt, sinal: s[1] || '', valor: txt === '—' ? null : lerMoeda(s[2]) });
    }
    return out;
}

console.log('F.cascata: vendas − canceladas − tarifas − frete − Ads − … − produtos − imposto − despesas = sobra, no centavo');
{
    const rnd = lcg(4242);
    for (const comEpt of [true, false]) {
        const rot = comEpt ? 'mês lido com o estorno por tipo (linhas antes dos cancelamentos + "Estornos")' : 'mês lido sem o estorno por tipo (linhas já líquidas; "Estornos" só informativo)';
        todos(600, () => mesAleatorio(rnd, comEpt), d => {
            const c = F.cascata(d), L = {}; c.linhas.forEach(l => { L[l.id] = l; });
            const k = d.cent, temEpt = !!d.fech.estornosPorTipo;
            // cada linha de tarifa: cobrado (com ept) ou cobrado − estornado (sem ept)
            for (const t of TIPOS) { const e = temEpt ? k.cob[t] : k.cob[t] - k.est[t]; if (C(L[t].valor) !== e) return t + ': ' + L[t].valor + ' × ' + R(e); }
            const liq = k.bruto - k.cancel - soma(TIPOS.map(t => k.cob[t] - k.est[t]));
            if (C(c.liquido) !== liq) return 'líquido ' + c.liquido + ' × ' + R(liq);
            if (C(c.custosML) !== soma(TIPOS.map(t => k.cob[t] - k.est[t]))) return 'custosML ' + c.custosML;
            if (C(L.estornos.valor) !== k.totEst || L.estornos.tipo !== (temEpt ? 'mais' : 'info')) return 'estornos ' + L.estornos.valor + ' ' + L.estornos.tipo;
            if (d.impostoPct === null) { if (L.imposto.valor !== null || c.lucro !== null) return 'sem imposto informado e mesmo assim tem imposto/lucro'; }
            else {
                const base = k.bruto - k.cancel, pc = Math.round(d.impostoPct * 100);   // imposto exato = base × pc / 10000 centavos
                if (Math.abs(C(L.imposto.valor) * 10000 - base * pc) > 5000) return 'imposto ' + L.imposto.valor + ' longe de ' + (base * pc / 1e6);
                if (C(c.lucro) !== liq - k.prod - C(L.imposto.valor)) return 'lucro ' + c.lucro;
            }
            if (d.despesas) {
                if (C(c.despesas) !== C(d.despesas.valor) || (c.lucro !== null && C(c.sobra) !== C(c.lucro) - C(d.despesas.valor))) return 'sobra ' + c.sobra;
                if (c.lucro === null && c.sobra !== null) return 'sobra sem lucro';
            } else if (L.despesas || L.sobra || c.sobra !== null) return 'sem despesas e com a linha da sobra';
            const r = desce(c.linhas, l => (l.valor === null ? null : C(l.valor)));
            return r || true;
        }, 'conta: ' + rot);
        todos(300, () => mesAleatorio(rnd, comEpt), d => {
            const c = F.cascata(d), h = F.htmlCascata(c), tela = linhasDaTela(h);
            if (!semLixo(h)) return 'NaN/undefined no HTML';
            if (tela.length !== c.linhas.length) return tela.length + ' linhas na tela × ' + c.linhas.length;
            for (let i = 0; i < tela.length; i++) {
                const l = c.linhas[i], t = tela[i];
                if (t.rotulo !== l.rotulo) return 'rótulo ' + t.rotulo;
                if (l.valor === null) { if (t.txt !== '—') return l.id + ' sem valor e a tela mostra ' + t.txt; continue; }
                if (t.valor !== C(l.valor)) return l.id + ': tela ' + t.txt + ' × conta ' + l.valor;
                if (t.sinal !== { menos: '− ', mais: '+ ', info: '(', total: '' }[l.tipo]) return l.id + ': sinal "' + t.sinal + '"';
            }
            const r = desce(tela.map((t, i) => Object.assign({}, c.linhas[i], { v: t.valor })), l => l.v);
            return r ? 'tela: ' + r : true;
        }, 'tela: ' + rot + ' — cada linha mostra o número da conta, com o sinal, e a cascata da tela fecha');
    }
    // O mesmo mês lido pelas 2 versões dá o mesmo líquido, lucro e sobra (só muda a apresentação dos estornos).
    todos(300, () => mesAleatorio(rnd, true), d => {
        const a = F.cascata(d), b = F.cascata(Object.assign({}, d, { fech: Object.assign({}, d.fech, { estornosPorTipo: undefined }) }));
        return a.liquido === b.liquido && a.lucro === b.lucro && a.sobra === b.sobra && a.custosML === b.custosML ? true : a.liquido + ' × ' + b.liquido;
    }, 'com e sem o estorno por tipo: o mesmo líquido, lucro, custos do ML e sobra');
    // Nada inventado: o que não foi lido é "—" na tela, e o que depende dele também.
    const base = mesAleatorio(lcg(5), true);
    const semFech = F.cascata(Object.assign({}, base, { fech: null }));
    ok(TIPOS.every(t => semFech.linhas.find(l => l.id === t).valor === null) && semFech.liquido === null && semFech.lucro === null && semFech.custosML === null
        && (semFech.sobra === null), 'Faturamento não lido: todas as tarifas, o líquido, o lucro e a sobra ficam "—"');
    const hSem = F.htmlCascata(semFech);
    const depende = TIPOS.concat(['estornos', 'liquido', 'lucro', 'sobra']);
    ok(linhasDaTela(hSem).every((t, i) => depende.indexOf(semFech.linhas[i].id) < 0 || t.txt === '—') && semLixo(hSem), '…e a tela mostra "—" (nunca "R$ 0,00") em cada linha que depende do Faturamento');
    const parcial = F.cascata(Object.assign({}, base, { vb: Object.assign({}, base.vb, { completo: false, dias: 29, diasMes: 30 }) }));
    const lp = linhasDaTela(F.htmlCascata(parcial));
    ok(parcial.bruto === null && parcial.liquido === null && lp[0].valor === C(base.vb.valor) && /parcial \(29 de 30 dias\)/.test(F.htmlCascata(parcial)) && parcial.linhas.find(l => l.id === 'imposto').valor === null,
        'vendas com dia faltando: mostra o valor lido marcado "parcial (29 de 30 dias)", e líquido, imposto e lucro ficam "—"');
    const semCancel = F.cascata(Object.assign({}, base, { vb: Object.assign({}, base.vb, { cancelado: null }) }));
    ok(semCancel.linhas.find(l => l.id === 'cancelado').valor === null && semCancel.liquido === null, 'canceladas não lidas: "—" (nunca R$ 0,00) e sem líquido');
    const imp0 = F.cascata(Object.assign({}, base, { impostoPct: 0 }));
    ok(imp0.linhas.find(l => l.id === 'imposto').valor === 0 && imp0.lucro !== null, 'imposto 0% informado: R$ 0,00 de verdade e o lucro aparece');
    const comAf = F.cascata(Object.assign({}, base, { afil: { custoEstimado: '1.234,56', periodo: { de: '2026-09-01', ate: '2026-09-30' } } }));
    ok(comAf.linhas.find(l => l.id === 'afiliados').valor === 1234.56 && comAf.liquido === F.cascata(base).liquido, 'afiliados (estimativa do ML): aparece entre parênteses e fica fora da conta');
    // Sinal: custo é positivo (a linha "menos" tira); estorno é positivo na linha "mais" (soma de volta).
    const s = mesAleatorio(lcg(9), true), cs = F.cascata(s);
    ok(TIPOS.every(t => cs.linhas.find(l => l.id === t).valor >= 0) && cs.linhas.find(l => l.id === 'estornos').valor >= 0 && cs.linhas.find(l => l.id === 'estornos').tipo === 'mais',
        'sinais: cada tarifa ≥ 0 numa linha "menos" e os estornos ≥ 0 numa linha "mais"');
}

console.log('SHC.despesasFixasDoMes: proporcional até hoje e o mensal no mês cheio');
{
    const rnd = lcg(31);
    const lista = () => Array.from({ length: inteiro(rnd, 1, 8) }, (_, i) => ({ nome: 'Conta ' + i, valor: R(inteiro(rnd, 0, 5000000)) }));
    todos(400, () => ({ l: lista(), mes: escolhe(rnd, ['2025-02', '2024-02', '2026-04', '2026-09', '2026-01']) }), x => {
        const d = SHC.despesasFixasDoMes(x.l, x.mes, HOJE), m = soma(x.l.map(y => C(y.valor)));
        return d && !d.proporcional && C(d.valor) === m && C(d.mensal) === m && d.dias === d.diasMes ? true : JSON.stringify(d) + ' × ' + m;
    }, 'mês que já acabou (28, 29, 30 ou 31 dias): o valor é o mensal inteiro = Σ das despesas em centavos');
    const dm = { '2026-02': 28, '2028-02': 29, '2026-04': 30, '2026-10': 31 };
    todos(400, () => ({ l: lista(), mes: escolhe(rnd, Object.keys(dm)) }), x => {
        const D = dm[x.mes], m = soma(x.l.map(y => C(y.valor)));
        let antes = -1;
        for (let dia = 1; dia <= D; dia++) {
            const d = SHC.despesasFixasDoMes(x.l, x.mes, x.mes + '-' + String(dia).padStart(2, '0'));
            if (!d.proporcional || d.dias !== dia || d.diasMes !== D || C(d.mensal) !== m) return 'dia ' + dia + ': ' + JSON.stringify(d);
            const v = C(d.valor);
            if (Math.abs(v * D - m * dia) * 2 > D) return 'dia ' + dia + ': ' + d.valor + ' longe de ' + (m * dia / D / 100);   // ≤ meio centavo do exato
            if (v < antes) return 'dia ' + dia + ': caiu de ' + antes + ' para ' + v;
            antes = v;
        }
        return antes === m ? true : 'último dia: ' + antes + ' × mensal ' + m;
    }, 'mês em andamento: cada dia = mensal × dia ÷ dias do mês (no meio centavo), nunca diminui, e no último dia é o mensal inteiro');
    ok(SHC.despesasFixasDoMes([], '2026-09', HOJE) === null && SHC.despesasFixasDoMes(lista(), '2026-11', HOJE) === null, 'sem despesa ou mês que ainda não começou: null (sem a linha, nunca R$ 0,00)');
    const desde = SHC.despesasFixasDoMes([{ nome: 'Aluguel', valor: 1500, desde: '2026-09' }, { nome: 'Sistema', valor: 99.9, desde: '2026-10' }], '2026-09', HOJE);
    ok(desde.valor === 1500 && desde.n === 1, 'despesa cadastrada em outubro não entra em setembro');
    const limpas = SHC.despesasFixas({ despesas_fixas: [{ nome: 'Aluguel', valor: '1.500,50' }, { nome: 'Vazia', valor: '' }, { nome: 'Negativa', valor: -10 }, { nome: '', valor: 5 }, { nome: 'NaN', valor: NaN }] });
    ok(limpas.length === 1 && limpas[0].valor === 1500.5, 'só despesa com nome e valor ≥ 0 entra (vazio, negativo e NaN ficam fora, nunca viram R$ 0,00)');
    // Na cascata: a linha mostra o proporcional e o texto diz o mensal, os dois iguais à conta.
    const out = SHC.despesasFixasDoMes([{ nome: 'Aluguel', valor: 3100 }, { nome: 'Contador', valor: 455.55 }], '2026-10', HOJE);
    const c = F.cascata({ fech: { porTipo: {} }, vb: { valor: 1000, cancelado: 0, devolvido: 0, completo: true }, produtos: { valor: 100, completo: true }, impostoPct: 6, despesas: out });
    const ld = c.linhas.find(l => l.id === 'despesas');
    ok(out.valor === SHC.r2(3555.55 * 7 / 31) && ld.valor === out.valor && ld.ajuda.indexOf('(7 de 31 dias) de ' + SHC.moeda(3555.55) + ' por mês') > 0 && C(c.sobra) === C(c.lucro) - C(out.valor),
        'outubro até dia 7: ' + SHC.moeda(out.valor) + ' (7 de 31 dias de R$ 3.555,55) na linha, no texto e na sobra');
}

console.log('Do Faturamento cru à tela: SHC.fechamentoDasCobrancas → cascata, tipos, para onde foi, custos × mês anterior');
// Cobranças inventadas: cobrança (≥ 0) e cancelamento (estorno) por tipo, origem venda/fatura, dia do mês.
const TEXTOS = { tarifa_venda: 'Custo por vender', cobranca_mp: 'Custo por cobrar', parcelamento: 'Taxa de parcelamento', recebimento: 'Taxa de recebimento',
    frete: 'Tarifa de envio', devolucao: 'Tarifa de devolução', full: 'Tarifa pelo serviço de armazenamento Full', ads: 'Product Ads', ads_seguidores: 'Publicidade de Seguidores',
    minha_pagina: 'Tarifa de manutenção da Minha página', impostos_ml: 'Cobrança do ICMS-DIFAL', outro: 'Assinatura mensal' };
function cobrancasAleatorias(rnd, mes, n, fatura) {
    const cobs = [], cent = {}, est = {}, venda = {}, fat = {};
    TIPOS.forEach(t => { cent[t] = 0; est[t] = 0; venda[t] = 0; fat[t] = 0; });
    for (let i = 0; i < n; i++) {
        const t = escolhe(rnd, TIPOS), v = inteiro(rnd, 1, 250000), estorno = rnd() < 0.15, origem = rnd() < 0.6 ? 'venda' : 'fatura';
        const dia = mes + '-' + String(inteiro(rnd, 1, 28)).padStart(2, '0');
        cobs.push(Object.assign({ texto: (estorno ? 'Cancelamento do ' : '') + TEXTOS[t], valor: R(v), data: dia, estorno, origemPagamento: origem, orderId: '20000' + inteiro(rnd, 10000, 99999), itemId: 'MLB9' + inteiro(rnd, 100000000, 999999999) }, fatura ? { fatura } : {}));
        if (estorno) est[t] += v; else cent[t] += v;
        (origem === 'venda' ? venda : fat)[t] += estorno ? -v : v;
    }
    return { cobs, cent, est, venda, fat };
}
{
    const rnd = lcg(808);
    todos(150, () => cobrancasAleatorias(rnd, MES_C, inteiro(rnd, 0, 900)), g => {
        const fech = SHC.fechamentoDasCobrancas(g.cobs)[MES_C];
        if (!g.cobs.length) return fech === undefined ? true : 'mês sem cobrança gerou fech';
        for (const t of TIPOS) {
            const liq = g.cent[t] - g.est[t];
            if ((fech.porTipo[t] === undefined ? 0 : C(fech.porTipo[t])) !== liq) return t + ': porTipo ' + fech.porTipo[t] + ' × ' + R(liq);
            if (g.est[t] && C((fech.estornosPorTipo || {})[t]) !== -g.est[t]) return t + ': estorno ' + (fech.estornosPorTipo || {})[t];
            const o = fech.porOrigem[t];
            if (o && (C(o.venda) !== g.venda[t] || C(o.fatura) !== g.fat[t] || C(o.venda) + C(o.fatura) !== C(fech.porTipo[t]))) return t + ': venda + fatura ≠ total';
        }
        const tot = soma(TIPOS.map(t => g.cent[t] - g.est[t])), totEst = soma(TIPOS.map(t => g.est[t]));
        if (C(fech.total) !== tot || C(fech.estornos) !== -totEst || fech.estornos > 0) return 'total ' + fech.total + ' / estornos ' + fech.estornos;
        if (C(soma(Object.keys(fech.porDia).map(d => C(fech.porDia[d])).map(R))) !== tot) return 'Σ porDia ≠ total';
        return true;
    }, 'por tipo = cobrado − cancelado; estornos ≤ 0 e = Σ estorno por tipo; descontado nas vendas + na fatura = o total do tipo; Σ dias = total do mês');
    todos(150, () => cobrancasAleatorias(rnd, MES_C, inteiro(rnd, 1, 600)), g => {
        const fech = SHC.fechamentoDasCobrancas(g.cobs)[MES_C], tot = soma(TIPOS.map(t => g.cent[t] - g.est[t]));
        // Custos por tipo (F.tabelaTipos / F.htmlTipos): cada linha e o total.
        const ls = F.tabelaTipos(fech), h = F.htmlTipos(fech);
        if (C(soma(ls.map(l => C(l.total)).map(R))) !== tot) return 'Σ tabelaTipos ≠ total do mês';
        if (ls.some(l => l.venda !== null && C(l.venda) + C(l.fatura) !== C(l.total))) return 'linha com venda + fatura ≠ total';
        const rows = [...h.matchAll(/<tr(?: class="total")?><td>(?:<b>)?([^<]*)(?:<\/b>)?<\/td><td class="num">([^<]*)<\/td><td class="num">([^<]*)<\/td><td class="num"><b>([^<]*)<\/b><\/td><\/tr>/g)];
        const corpo = rows.slice(0, -1), fim = rows[rows.length - 1];
        if (corpo.length !== ls.length || fim[1] !== 'Total') return 'tabela com ' + corpo.length + ' linhas';
        if (soma(corpo.map(r => lerMoeda(r[4]))) !== lerMoeda(fim[4]) || lerMoeda(fim[4]) !== tot) return 'total da tela ' + fim[4];
        if (soma(corpo.map(r => lerMoeda(r[2]))) !== lerMoeda(fim[2]) || soma(corpo.map(r => lerMoeda(r[3]))) !== lerMoeda(fim[3])) return 'colunas da tela não somam';
        if (lerMoeda(fim[2]) + lerMoeda(fim[3]) !== lerMoeda(fim[4])) return 'descontado + na fatura ≠ total na tela';
        if (!/Os dois lados somam o total do mês/.test(h)) return 'sem a frase dos 2 lados';
        return semLixo(h) || 'lixo no HTML';
    }, '"Custos por tipo": a tela soma linha a linha, e descontado nas vendas + na fatura = o total (como a frase promete)');
    todos(150, () => ({ g: cobrancasAleatorias(rnd, MES_C, inteiro(rnd, 1, 600)), b: inteiro(rnd, 1, 80000000), c: inteiro(rnd, 0, 900000), pct: escolhe(rnd, [null, 0, 6, 11.33]) }), x => {
        const fech = SHC.fechamentoDasCobrancas(x.g.cobs)[MES_C];
        const casc = F.cascata({ fech, vb: { valor: R(x.b), cancelado: R(x.c), devolvido: 0, completo: true }, produtos: { valor: 0, completo: true }, impostoPct: x.pct, mes: MES_C });
        const o = F.ondeFoi(casc);
        if (!o) return 'sem "para onde foi"';
        if (soma(o.partes.map(p => C(p.valor))) !== x.b) return 'Σ partes ' + soma(o.partes.map(p => C(p.valor))) + ' × vendas ' + x.b;
        const h = F.htmlOndeFoi(casc, 'setembro'), tela = [...h.matchAll(/<span class="od-r">[^<]*<\/span><b>([^<]*)<\/b>/g)].map(m => lerMoeda(m[1]));
        if (tela.length !== 6 || soma(tela) !== x.b) return 'Σ tela ' + soma(tela);
        if (tela[5] !== C(casc.liquido)) return 'sobrou na tela ' + tela[5] + ' × líquido ' + casc.liquido;
        // "Custos de setembro × agosto" (F.custosTopicos): vendas − Σ tópicos = lucro (quando há lucro).
        const t = F.custosTopicos({ casc, fech }, null, {});
        const vs = t.linhas.filter(l => !l.estimativa).map(l => l.valor);
        if (casc.lucro !== null && (vs.some(v => v === null) || x.b - soma(vs.map(C)) !== C(casc.lucro))) return 'vendas − Σ tópicos ≠ lucro';
        if (casc.lucro === null && t.linhas.find(l => l.id === 'imposto').valor !== null) return 'imposto sem informar';
        return semLixo(h) || 'lixo';
    }, '"Para onde foi o dinheiro": as 6 partes somam as vendas brutas (tela e conta) e "Sobrou" = o líquido; vendas − Σ dos custos por tópico = lucro');
    // Gargalo e custos × mês anterior: a frase mostra o mesmo número da linha.
    const ga = SHC.fechamentoDasCobrancas(cobrancasAleatorias(lcg(3), MES_C, 400).cobs)[MES_C], gb = SHC.fechamentoDasCobrancas(cobrancasAleatorias(lcg(4), '2026-08', 400).cobs)['2026-08'];
    const ca = F.cascata({ fech: ga, vb: { valor: 300000, cancelado: 1000, devolvido: 0, completo: true }, produtos: { valor: 0, completo: true }, impostoPct: 6 });
    const cb = F.cascata({ fech: gb, vb: { valor: 250000, cancelado: 900, devolvido: 0, completo: true }, produtos: { valor: 0, completo: true }, impostoPct: 6 });
    const g = F.gargalo(ca, cb), top = ca.linhas.filter(l => l.tipo === 'menos' && F.ACOES[l.id]).sort((a, b) => b.liq - a.liq)[0];
    ok(g.maior && g.maior.id === top.id && g.maior.valor === top.liq && moedasDe(g.maior.frase.replace(/ /g, ' '))[0] === C(top.liq), 'maior gargalo: ' + g.maior.frase.replace(/ /g, ' '));
    if (g.subiu) ok(moedasDe(g.subiu.frase).join() === [C(cb.linhas.find(l => l.id === g.subiu.id).liq), C(ca.linhas.find(l => l.id === g.subiu.id).liq)].join(), 'o que mais subiu: ' + g.subiu.frase);
    const t = F.custosTopicos({ casc: ca, fech: ga }, { casc: cb, fech: gb }, {});
    ok(t.linhas.every(l => l.dif === null || C(l.dif) === C(l.valor) - C(l.antes)), 'custos × mês anterior: cada "mudou" = setembro − agosto, no centavo');
    const h = F.htmlCustos(t, MES_C, '2026-08');
    ok(semLixo(h) && t.linhas.filter(l => l.dif !== null && l.dir !== 'igual' && (l.valor !== 0 || l.antes > 0)).every(l => h.indexOf((l.dif < 0 ? '−' : '+') + SHC.moeda(Math.abs(l.dif))) > 0),
        '…e a tela mostra cada diferença com o sinal (+ subiu, − caiu)');
}

console.log('F.recuperar: "Quanto dá para recuperar" = Σ das parcelas = Σ dos itens');
// Bases inventadas, cada pedido numa base só (as sobreposições têm teste próprio abaixo).
function basesRecuperar(rnd) {
    let ped = 3000000000 + inteiro(rnd, 0, 1000000);
    const prox = () => String(++ped);
    const conc = { pagoAMais: [] }, conferir = [], inconformes = [], dev = { itens: [] }, esp = { frete: 0, cobrancas: 0, estorno: 0, devolucao: 0, amarelo: 0 }, n = { frete: 0, cobrancas: 0, estorno: 0, devolucao: 0 };
    let nFull = 0;   // remessas do Full com diferença: "para conferir", fora do total e sem valor (a cobrança é coleta e/ou penalidade)
    for (let i = inteiro(rnd, 0, 30); i > 0; i--) {
        const esperado = inteiro(rnd, 500, 9000), dif = inteiro(rnd, -300, 4000), talvez = rnd() < 0.25;
        conc.pagoAMais.push({ pedido: prox(), itemId: 'MLB9' + inteiro(rnd, 1e8, 9e8), data: '2026-09-' + String(inteiro(rnd, 10, 28)), cobrado: R(esperado + dif), esperado: R(esperado), diferenca: R(dif), talvezUnidades: talvez });
        if (dif > 0 && !talvez) { esp.frete += dif; n.frete++; }
    }
    for (let i = inteiro(rnd, 0, 30); i > 0; i--) {
        const regra = escolhe(rnd, ['repetida', 'tarifa', 'frete', 'sem_estorno']), valor = inteiro(rnd, 100, 20000), dif = inteiro(rnd, 0, valor), duvida = rnd() < 0.2, devol = rnd() < 0.1;
        const x = { pedido: prox(), data: '2026-09-' + String(inteiro(rnd, 10, 28)), itemId: 'MLB9' + inteiro(rnd, 1e8, 9e8), titulo: 'Produto', cobranca: devol ? 'Tarifa de devolução' : 'Custo por vender',
            valor: R(valor), esperado: R(valor - dif), diferenca: R(dif), motivo: 'Motivo de teste.', regra };
        if (duvida) x.duvida = 'Pergunta de teste?';
        conferir.push(x);
        if (!duvida && dif > 0 && !devol) { if (regra === 'sem_estorno') { esp.estorno += dif; n.estorno++; } else { esp.cobrancas += dif; n.cobrancas++; } }
    }
    for (let i = inteiro(rnd, 0, 6); i > 0; i--) {
        const custo = rnd() < 0.2 ? null : inteiro(rnd, 0, 30000), pode = rnd() < 0.8, aberta = rnd() < 0.15;
        inconformes.push({ id: '6' + inteiro(rnd, 1e7, 9e7), quando: '2026-09-20', prazo: '2026-10-20', motivos: ['unidades diferentes das declaradas'], link: 'https://www.mercadolivre.com.br/x', custo: custo === null ? null : R(custo), podeReclamar: pode, reclamacaoAberta: aberta });
        if (custo > 0 && pode && !aberta) nFull++;
    }
    for (let i = inteiro(rnd, 0, 12); i > 0; i--) {
        const cor = escolhe(rnd, ['verde', 'amarelo', 'cinza']), valor = inteiro(rnd, 500, 9000), rec = cor === 'cinza' ? 0 : inteiro(rnd, 0, valor);
        dev.itens.push({ pedido: prox(), itemId: 'MLB9' + inteiro(rnd, 1e8, 9e8), data: '2026-09-15', valor: R(valor), recuperar: R(rec), cor, regra: 'x', motivo: 'Motivo.', texto: 'Texto.' });
        if (cor === 'verde' && rec > 0) { esp.devolucao += rec; n.devolucao++; }
        if (cor === 'amarelo' && rec > 0) esp.amarelo += rec;
    }
    return { d: { conc, conferir, inconformes, devolucoes: dev }, esp, n, nFull };
}
{
    const rnd = lcg(1717);
    todos(500, () => basesRecuperar(rnd), x => {
        const r = F.recuperar(x.d), por = {}; r.parcelas.forEach(p => { por[p.id] = p; });
        for (const id of Object.keys(x.n)) {
            const p = por[id];
            if (!x.esp[id]) { if (p) return id + ': parcela de ' + p.valor + ' sem nada a recuperar'; continue; }
            if (!p || C(p.valor) !== x.esp[id] || p.itens.length !== x.n[id]) return id + ': ' + (p && p.valor) + ' × ' + R(x.esp[id]);
            if (soma(p.itens.map(i => C(i.valor))) !== C(p.valor) || p.itens.some(i => !(i.valor > 0))) return id + ': Σ itens ≠ parcela';
        }
        const tot = soma(Object.keys(x.n).map(k => x.esp[k]));
        if (C(r.total) !== tot || soma(r.parcelas.map(p => C(p.valor))) !== C(r.total)) return 'total ' + r.total + ' × ' + R(tot);
        if (C(r.devConferir.valor) !== x.esp.amarelo) return '🟡 ' + r.devConferir.valor;
        if (r.parcelas.some(p => p.id === 'full') || r.fullConferir.itens.length !== x.nFull || r.fullConferir.itens.some(i => 'valor' in i)) return 'remessas do Full: ' + JSON.stringify(r.fullConferir);
        return true;
    }, 'total = Σ parcelas = Σ itens (só diferença > 0; dúvida, "para conferir", devolução no Faturamento, remessa do Full, já reclamada ou não, e 🟡/⚪ fora)');
    todos(300, () => basesRecuperar(rnd), x => {
        const r = F.recuperar(x.d), h = F.htmlRecuperar(r, id => 'Título ' + id, true);
        if (!semLixo(h)) return 'lixo no HTML';
        if (!r.parcelas.length) return /Nada para recuperar/.test(h) ? true : 'sem parcela e sem "nada para recuperar"';
        const tot = /<p class="rec-tot"><b>([^<]*)<\/b> em ([\d.]+) (itens|item)<\/p>/.exec(h);
        if (!tot || lerMoeda(tot[1]) !== C(r.total) || +tot[2].replace(/\./g, '') !== soma(r.parcelas.map(p => p.itens.length))) return 'cabeçalho ' + (tot && tot[0]);
        const blocos = h.split('<div class="parc ').slice(1);
        const daParcela = blocos.filter(b => !/^(devconf|fullconf)/.test(b));
        if (daParcela.length !== r.parcelas.length) return daParcela.length + ' blocos';
        let somaTela = 0;
        for (let i = 0; i < daParcela.length; i++) {
            const nums = [...daParcela[i].matchAll(/<b class="num">([^<]*)<\/b>/g)].map(m => lerMoeda(m[1]));
            if (nums[0] !== C(r.parcelas[i].valor) || soma(nums.slice(1)) !== nums[0] || nums.length - 1 !== r.parcelas[i].itens.length) return r.parcelas[i].id + ': tela ' + nums.join(',');
            somaTela += nums[0];
        }
        if (somaTela !== lerMoeda(tot[1])) return 'Σ parcelas na tela ≠ total na tela';
        const dc = blocos.find(b => /^devconf/.test(b));
        if (dc) { const nums = [...dc.matchAll(/<b class="num">([^<]*)<\/b>/g)].map(m => lerMoeda(m[1])); if (nums[0] !== C(r.devConferir.valor) || soma(nums.slice(1)) !== nums[0]) return '🟡 na tela'; }
        const fl = blocos.find(b => /^fullconf/.test(b));
        if (!!fl !== x.nFull > 0 || (fl && (/R\$/.test(tiraTags(fl)) || (fl.match(/>Reclamar no ML</g) || []).length !== x.nFull))) return 'remessas do Full na tela';
        return true;
    }, 'tela: o total do topo = Σ dos valores das parcelas = Σ de cada item (também os escondidos no "Ver mais"); o 🟡 fecha à parte, fora do total');
    // O texto do chamado de cada item pede o mesmo valor que a tela mostra (cobrado − devido = diferença = o item).
    todos(300, () => basesRecuperar(rnd), x => {
        const r = F.recuperar(x.d);
        for (const p of r.parcelas) for (const it of p.itens) {
            if (p.id === 'devolucao') continue;
            const t = p.id === 'frete' ? F.chamadoFrete(it, 'Produto') : F.textoChamado(F.itemDoChamado(it));
            const cob = /Valor cobrado: (\S+ [\d.,]+)/.exec(t), dev = /Valor (?:devido|esperado \(estimativa nossa\)): (\S+ [\d.,]+)/.exec(t), dif = /Diferença: (\S+ [\d.,]+)/.exec(t);
            if (!cob || !dev || !dif) return p.id + ': texto sem os 3 valores';
            const [a, b, c] = [cob[1], dev[1], dif[1]].map(lerMoeda);
            if (a - b !== c || c !== C(it.valor) || a !== C(it.cobrado)) return p.id + ' #' + it.pedido + ': ' + [a, b, c, C(it.valor)].join(' ');
            if (moedasDe(t.slice(t.indexOf('Solicitamos'))).some(v => v !== c)) return p.id + ': o pedido de estorno cita outro valor';
        }
        return true;
    }, 'texto do chamado: cobrado − devido = diferença = o valor do item na tela, e o estorno pedido é esse mesmo valor');
    // Sem contar 2 vezes o mesmo frete: na conciliação (frete do anúncio) e no "para conferir" (regra 'frete').
    const conc = { pagoAMais: [{ pedido: '2000000019', pedidoFrete: '9100000003', itemId: 'MLB8000000001', data: '2026-09-23', cobrado: 58.75, esperado: 45.35, diferenca: 13.4 },
        { pedido: '2000000020', itemId: 'MLB8000000002', data: '2026-09-24', cobrado: 30, esperado: 20, diferenca: 10 }] };
    const conferir = [{ pedido: '9100000003', itemId: 'MLB8000000001', data: '2026-09-23', cobranca: 'Tarifa de envio', valor: 58.75, esperado: 40, diferenca: 18.75, regra: 'frete', motivo: 'm' },
        { pedido: '9100000777', itemId: 'MLB8000000002', data: '2026-09-24', cobranca: 'Tarifa de envio', valor: 30, esperado: 22, diferenca: 8, regra: 'frete', motivo: 'm' },
        { pedido: '9100000888', itemId: 'MLB8000000009', data: '2026-09-24', cobranca: 'Custo por vender', valor: 30, esperado: 25, diferenca: 5, regra: 'tarifa', motivo: 'm' }];
    const r = F.recuperar({ conc, conferir });
    ok(r.total === 13.4 + 10 + 5 && r.parcelas.find(p => p.id === 'cobrancas').itens.length === 1, 'o frete já na conciliação (pelo número do frete ou por anúncio + data + valor) não entra de novo no "para conferir": ' + SHC.moeda(r.total));
    ok(F.recuperar({}).total === 0 && F.recuperar({}).parcelas.length === 0 && /Aparece depois/.test(F.htmlRecuperar(F.recuperar({}), null, false)), 'nada lido: total 0 sem parcelas e a tela diz que ainda não leu (não mostra "R$ 0,00 para recuperar")');
    // Remessa do Full: 6 unidades faltando e R$ 27,00 cobrados (coleta e/ou penalidade). O chamado só pede o estorno "se a diferença se
    // confirmar", sem valor; a tela não pode pôr os R$ 27,00 como "dá para recuperar" (antes: total R$ 27,00).
    const rem = { id: '61234567', quando: '2026-09-28', prazo: '2026-10-12', motivos: ['unidades diferentes das declaradas'], link: 'https://www.mercadolivre.com.br/x', custo: 27, podeReclamar: true, reclamacaoAberta: false };
    const rf = F.recuperar({ inconformes: [rem, Object.assign({}, rem, { id: '61234568', reclamacaoAberta: true })] }), hf = F.htmlRecuperar(rf, null, true);
    ok(rf.total === 0 && !rf.parcelas.length && rf.fullConferir.itens.length === 1 && rf.fullConferir.itens[0].id === '61234567' && hf.indexOf('27,00') < 0
        && /Remessas do Full com diferença: para conferir/.test(hf) && /reclamar até 12\/10/.test(hf) && /coleta e\/ou penalidade/.test(hf) && !/multa/i.test(hf)
        && !/estorno de R\$ 27,00/.test(SHC.chamadoRemessa(rem)),
        'remessa do Full com R$ 27,00 cobrados: fora do "dá para recuperar" (total R$ 0,00), listada "para conferir" sem valor e com o prazo; a já reclamada não aparece');
    // F.conferir → F.recuperar, cada pedido com UMA regra só: o que dá para recuperar nunca passa do que foi cobrado a mais.
    const cobs = [], porId = { MLB9100000001: { tarifa: 8, preco: 60, titulo: 'Bomba' } };
    const c = (o, it, texto, v, op, extra) => cobs.push(Object.assign({ orderId: o, itemId: it, data: '2026-09-1' + (cobs.length % 9), texto, valor: v, id: o + '|' + op + '|C' }, extra || {}));
    c('2000000101', 'MLB9100000001', 'Custo por vender', 14.5, 'P101');                                                 // tarifa acima (8 esperado)
    c('2000000102', 'MLB9100000002', 'Custo por vender', 7.25, 'P102'); c('2000000102', 'MLB9100000002', 'Custo por vender', 7.25, 'P102');   // repetida
    c('2000000103', 'MLB9100000003', 'Custo por vender', 9.9, 'P103'); c('2000000103', 'MLB9100000003', 'Cancelamento do Custo por vender', 9.9, 'P103', { estorno: true });
    c('2000000103', 'MLB9100000003', 'Custo por cobrar', 3.33, 'PAG103');                                               // cancelada sem estorno
    const cf = F.conferir(cobs, porId), rr = F.recuperar({ conferir: cf });
    ok(cf.length === 3 && C(rr.total) === 650 + 725 + 333 && cf.every(x => x.diferenca <= x.valor && C(x.valor) - C(x.esperado) === C(x.diferenca)),
        'F.conferir → F.recuperar (1 regra por pedido): 6,50 + 7,25 + 3,33 = ' + SHC.moeda(rr.total) + ', e cada item tem cobrado − esperado = diferença ≤ cobrado');
    const textos = rr.parcelas.reduce((l, p) => l.concat(p.itens), []).map(x => [x, F.textoChamado(F.itemDoChamado(x))]);
    ok(textos.length === 3 && textos.every(([x, t]) => { const v = moedasDe(t.slice(t.indexOf('Dados do meu painel'), t.indexOf('Como estimamos') > 0 ? t.indexOf('Como estimamos') : t.indexOf('Por quê')));
        return v.length === 3 && v[0] - v[1] === v[2] && v[2] === C(x.valor) && moedasDe(t.slice(t.indexOf('Solicitamos'))).every(y => y === C(x.valor)); })
        && /Valor esperado \(estimativa nossa\): R\$ 8,00/.test(textos.find(([x]) => x.regra === 'tarifa')[1]),
        'chamados dessas 3 (inclusive o da tarifa "esperado = estimativa"): cobrado − esperado = diferença = o valor do item, e o estorno pedido é ele');
}

console.log('F.conferir: cada cobrança para conferir fecha (cobrado − esperado = diferença) e a tabela mostra os mesmos números');
{
    const rnd = lcg(6060);
    const TX = ['Custo por vender', 'Custo por cobrar', 'Taxa de parcelamento', 'Tarifa de envio'], VAL = [3.33, 7.25, 9.9, 12.5, 18.4, 45.35, 58.75];
    const gera = () => {
        const cobs = [], porId = {}, itens = ['MLB9200000001', 'MLB9200000002', 'MLB9200000003'];
        itens.forEach(i => { porId[i] = { tarifa: escolhe(rnd, [3, 6.5, 8, 11]), preco: 60, titulo: 'Produto ' + i.slice(-1) }; });
        for (let p = inteiro(rnd, 1, 60); p > 0; p--) {
            const o = String(2000001000 + inteiro(rnd, 0, 99999)), it = escolhe(rnd, itens);
            const doPedido = [];
            for (let k = inteiro(rnd, 1, 6); k > 0; k--) {
                // cancelamento = de uma cobrança do próprio pedido (mesmo texto e valor; o conceptId pode vir outro, como no ML)
                const base = doPedido.length && rnd() < 0.2 ? escolhe(rnd, doPedido) : null, t = base ? base.texto : escolhe(rnd, TX);
                const c = { orderId: o, itemId: it, data: '2026-09-' + String(inteiro(rnd, 1, 28)).padStart(2, '0'), texto: (base ? 'Cancelamento do ' : '') + t, valor: base ? base.valor : escolhe(rnd, VAL), estorno: !!base,
                    id: o + '|' + escolhe(rnd, ['A', 'B']) + o + '|' + (base ? 'B' : 'C') + 'X' };
                cobs.push(c); if (!base) doPedido.push(c);
            }
        }
        return { cobs, porId };
    };
    todos(300, gera, x => {
        const cf = F.conferir(x.cobs, x.porId);
        for (const it of cf) {
            const net = soma(x.cobs.filter(c => c.orderId === it.pedido && c.itemId === it.itemId && SHC.tipoCustoFechamento(c.texto) === SHC.tipoCustoFechamento(it.cobranca)).map(c => (c.estorno ? -1 : 1) * C(c.valor)));
            if (C(it.valor) - C(it.esperado) !== C(it.diferenca) || !(it.diferenca > 0) || C(it.diferenca) > net) return it.regra + ' #' + it.pedido + ': ' + [it.valor, it.esperado, it.diferenca, R(net)].join(' ');
        }
        const h = F.htmlConferir(cf), rows = [...h.matchAll(/<td class="num">([^<]*)<\/td>(?:<td class="num">([^<]*)<\/td><td class="num"><b>([^<]*)<\/b><\/td>|<td class="num">—<\/td><td class="num">pode estar certo<\/td>)/g)];
        if (rows.length !== cf.length || !semLixo(h)) return 'tabela com ' + rows.length + ' linhas';
        for (let i = 0; i < rows.length; i++) {
            if (lerMoeda(rows[i][1]) !== C(cf[i].valor)) return 'cobrado na tela';
            if (cf[i].duvida) { if (rows[i][2] !== undefined) return 'dúvida com número na tela'; continue; }
            if (lerMoeda(rows[i][1]) - lerMoeda(rows[i][2]) !== lerMoeda(rows[i][3]) || lerMoeda(rows[i][3]) !== C(cf[i].diferenca)) return 'linha ' + i + ' na tela';
        }
        return true;
    }, 'cada item: cobrado − esperado = diferença > 0 e nunca mais que o cobrado (líquido) daquele tipo no pedido; na tabela, Cobrado − Esperado = Diferença (dúvida: "pode estar certo", sem número)');
}

console.log('2 regras na MESMA cobrança (repetida + cancelada sem estorno / tarifa acima): conta 1 vez só, nunca acima do cobrado');
{
    // Cada pedido: tarifa de venda 1 a 3 vezes (às vezes 1 cancelada), "Custo por cobrar" 0 a 3 vezes no mesmo pagamento; o anúncio paga
    // uma tarifa de hoje inventada. entityId diferente a cada cobrança e o mesmo conceptId (como uma cobrança em dobro de verdade).
    const rnd = lcg(7007);
    const gera = () => {
        const cobs = [], porId = {};
        for (let p = inteiro(rnd, 1, 40); p > 0; p--) {
            const o = String(2000300000 + inteiro(rnd, 0, 99999)), it = 'MLB93000000' + inteiro(rnd, 10, 99), tv = escolhe(rnd, [7.25, 10, 14.5, 20, 33.9]), cc = escolhe(rnd, [3.33, 5, 8.9]);
            porId[it] = { tarifa: escolhe(rnd, [3, 6, 7.25, 9.9, 25]), preco: 60, titulo: 'Produto ' + it.slice(-2) };
            const add = (texto, valor, op, extra) => cobs.push(Object.assign({ orderId: o, itemId: it, data: '2026-09-' + String(inteiro(rnd, 1, 28)).padStart(2, '0'), texto, valor,
                id: inteiro(rnd, 1e8, 9e8) + '|' + op + '|' + (extra ? 'B' : 'C') + 'X' }, extra || {}));
            for (let k = inteiro(rnd, 1, 3); k > 0; k--) add('Custo por vender', tv, 'P' + o);
            if (rnd() < 0.5) add('Cancelamento do Custo por vender', tv, 'B' + o, { estorno: true });
            for (let k = inteiro(rnd, 0, 3); k > 0; k--) add('Custo por cobrar', cc, 'PAG' + o);
        }
        return { cobs, porId };
    };
    const chave = x => x.pedido + '|' + SHC.tipoCustoFechamento(x.cobranca) + '|' + x.itemId;
    const pedido = t => moedasDe(t.slice(t.indexOf('Solicitamos')))[0] || 0;   // o estorno que o texto do chamado pede (dúvida: nenhum)
    const netDe = cobs => { const net = {}; cobs.forEach(c => { const k = c.orderId + '|' + SHC.tipoCustoFechamento(c.texto) + '|' + c.itemId; net[k] = (net[k] || 0) + (c.estorno ? -1 : 1) * C(c.valor); }); return net; };
    const confere = (x, cf, rec) => {
        const net = netDe(x.cobs), dif = {}, txt = {}, dRec = {}, tRec = {};
        cf.filter(i => !i.duvida).forEach(i => { const k = chave(i); dif[k] = (dif[k] || 0) + C(i.diferenca); txt[k] = (txt[k] || 0) + pedido(F.textoChamado(i)); });
        rec.parcelas.forEach(p => p.itens.forEach(i => { const k = chave(i); dRec[k] = (dRec[k] || 0) + C(i.valor); tRec[k] = (tRec[k] || 0) + pedido(F.textoChamado(F.itemDoChamado(i))); }));
        for (const k of Object.keys(dif)) {
            if (dif[k] > net[k] || txt[k] > net[k]) return k + ': para conferir pede ' + dif[k] + ' (textos ' + txt[k] + ') de ' + net[k] + ' cobrados';
            if (dRec[k] !== dif[k] || tRec[k] !== dif[k]) return k + ': recuperar ' + dRec[k] + ' (textos ' + tRec[k] + ') × para conferir ' + dif[k];
        }
        if (cf.some(i => C(i.valor) - C(i.esperado) !== C(i.diferenca))) return 'cobrado − esperado ≠ diferença';
        if (C(rec.total) !== soma(Object.values(dRec))) return 'total ' + rec.total;
        return true;
    };
    let comDuas = 0;
    todos(400, gera, x => {
        const cf = F.conferir(x.cobs, x.porId), r = confere(x, cf, F.recuperar({ conferir: cf }));
        if (r === true && cf.some(i => /Também aparece repetida/.test(i.motivo))) comDuas++;
        return r;
    }, 'por cobrança (pedido + tipo + anúncio): Σ diferenças, Σ estornos pedidos nos textos e o "Dá para recuperar" ≤ o cobrado líquido, sem contar 2 vezes');
    ok(comDuas > 50, 'os casos gerados têm 2 regras na mesma cobrança (' + comDuas + ' de 400)');
    // Revisão da correção (07/10/2026): estorno de OUTRO valor que a cobrança repetida (parcial, de outra coisa). O teto cortava a repetida e
    // inventava o "valor devido" (esperado = cobrado − teto); e a "tarifa acima" (estimativa) que ganhava da repetida deixava a cobrança em
    // dobro fora do texto do chamado. Agora: todo "Valor devido" é um valor lido (o de 1 cobrança ou R$ 0 da venda cancelada); a repetida só
    // pede quando o cobrado líquido cobre todas as cópias (o resto vira dúvida, sem número, ou sai); a repetição absorvida aparece no texto.
    const rnd2 = lcg(7008);
    const gera2 = () => {
        const cobs = [], porId = {};
        for (let p = inteiro(rnd2, 1, 30); p > 0; p--) {
            const o = String(2000400000 + inteiro(rnd2, 0, 99999)), it = 'MLB94000000' + inteiro(rnd2, 10, 99), tv = escolhe(rnd2, [7.25, 10, 14.5, 20]), cc = escolhe(rnd2, [3.33, 5, 8.9]);
            porId[it] = { tarifa: escolhe(rnd2, [3, 6, 7.25, 9.9, 25]), preco: 60, titulo: 'Produto ' + it.slice(-2) };
            const add = (texto, valor, op, extra) => cobs.push(Object.assign({ orderId: o, itemId: it, data: '2026-09-' + String(inteiro(rnd2, 1, 28)).padStart(2, '0'), texto, valor,
                id: inteiro(rnd2, 1e8, 9e8) + '|' + op + '|' + (extra ? 'B' : 'C') + 'X' }, extra || {}));
            for (let k = inteiro(rnd2, 1, 3); k > 0; k--) add('Custo por vender', tv, 'P' + o);
            if (rnd2() < 0.4) add('Cancelamento do Custo por vender', rnd2() < 0.5 ? tv : escolhe(rnd2, [2.5, 6, 15, 30]), 'B' + o, { estorno: true });
            for (let k = inteiro(rnd2, 0, 3); k > 0; k--) add('Custo por cobrar', cc, 'PAG' + o);
            if (rnd2() < 0.5) add('Cancelamento do Custo por cobrar', escolhe(rnd2, [1, 2.5, 4, 8, 12.5]), 'PAG' + o, { estorno: true });
        }
        return { cobs, porId };
    };
    let nDuv = 0, nAbs = 0;
    todos(400, gera2, x => {
        const cf = F.conferir(x.cobs, x.porId), r = confere(x, cf, F.recuperar({ conferir: cf }));
        if (r !== true) return r;
        const net = netDe(x.cobs), lidos = {}, repV = {};
        x.cobs.forEach(c => { const k = c.orderId + '|' + SHC.tipoCustoFechamento(c.texto) + '|' + c.itemId; if (!c.estorno) (lidos[k] || (lidos[k] = new Set([0]))).add(C(c.valor)); });
        for (const i of cf) {
            const k = chave(i), t = F.textoChamado(i);
            if (i.duvida) { if (/Valor devido|Diferença:|Solicitamos/.test(t)) return k + ': dúvida com número no texto'; nDuv++; continue; }
            const dv = /- Valor devido: (R\$ [\d.]+,\d{2})\n/.exec(t);
            if (dv && !lidos[k].has(lerMoeda(dv[1]))) return k + ': "Valor devido" ' + dv[1] + ' não foi lido em nenhuma cobrança';
            if (i.regra === 'repetida') repV[k] = (repV[k] || 0) + C(i.valor);
            if (i.repetida) { nAbs++; if (t.indexOf(i.repetida) < 0) return k + ': o texto não cita a repetição (' + i.repetida + ')'; }
        }
        for (const k of Object.keys(repV)) if (repV[k] > net[k]) return k + ': repetida pedida com ' + net[k] + ' líquidos de ' + repV[k] + ' cobrados (houve estorno)';
        return true;
    }, 'estorno de outro valor: "Valor devido" sempre lido, repetida só com o líquido cobrindo as cópias, a repetição absorvida no texto (e o resto de cima)');
    ok(nDuv > 20 && nAbs > 20, 'os casos gerados têm repetida que vira dúvida (' + nDuv + ') e repetida absorvida por outra regra (' + nAbs + ')');
    // Os 2 casos do relatório (07/10/2026): cancelada + "Custo por cobrar" 2× (R$ 10 cobrados) e tarifa 2× com R$ 6 no anúncio (R$ 20 cobrados).
    const cob = (o, texto, valor, id, extra) => Object.assign({ orderId: o, itemId: 'MLB1000000001', data: '2026-09-10', texto, valor, id }, extra || {});
    const a = F.conferir([cob('9000000001', 'Custo por vender', 10, '9000000001|P1|CVVML'), cob('9000000001', 'Cancelamento do Custo por vender', 10, '9000000001|P1|BVVML', { estorno: true }),
        cob('9000000001', 'Custo por cobrar', 5, '1|PAG1|CVVPRC'), cob('9000000001', 'Custo por cobrar', 5, '2|PAG1|CVVPRC')], {});
    const b = F.conferir([cob('9000000002', 'Custo por vender', 10, '9000000002|9000000002|CVVML'), cob('9000000002', 'Custo por vender', 10, '9000000002|9000000002|CVVML')],
        { MLB1000000001: { tarifa: 6, preco: 50, titulo: 'X' } });
    ok(a.length === 1 && a[0].regra === 'sem_estorno' && a[0].diferenca === 10 && F.recuperar({ conferir: a }).total === 10 && pedido(F.textoChamado(a[0])) === 1000
        && /mas esta cobrança não\. Também aparece repetida neste pedido: R\$ 5,00 × 2\.$/.test(a[0].motivo),
        'cancelada + "Custo por cobrar" 2× de R$ 5: 1 item de R$ 10,00 (o cobrado; antes R$ 15,00), e o motivo diz que também veio repetida');
    ok(b.length === 1 && b[0].regra === 'tarifa' && b[0].diferenca === 14 && F.recuperar({ conferir: b }).total === 14 && pedido(F.textoChamado(b[0])) === 1400,
        'tarifa de R$ 10 lançada 2× e R$ 6 no anúncio: 1 item de R$ 14,00 (20 − 6; antes R$ 24,00)');
    const c2 = F.conferir([cob('9000000003', 'Custo por vender', 20, '1|9000000003|CVVML'), cob('9000000003', 'Custo por vender', 20, '2|9000000003|CVVML')], { MLB1000000001: { tarifa: 25, preco: 200 } });
    ok(c2.length === 1 && c2[0].regra === 'repetida' && c2[0].diferenca === 20, 'repetida maior que a "tarifa acima" (R$ 20 × R$ 15): fica a repetida, 1 vez só');
    // Lista guardada pela versão anterior (conferir:<conta>) com as 2 regras no mesmo pedido: o "Dá para recuperar" conta 1 vez só.
    const velha = [{ pedido: '9000000001', itemId: 'MLB1000000001', data: '2026-09-10', cobranca: 'Custo por cobrar', regra: 'sem_estorno', valor: 10, esperado: 0, diferenca: 10, motivo: 'm' },
        { pedido: '9000000001', itemId: 'MLB1000000001', data: '2026-09-10', cobranca: 'Custo por cobrar', regra: 'repetida', valor: 10, esperado: 5, diferenca: 5, motivo: 'm' }];
    const rv = F.recuperar({ conferir: velha });
    ok(rv.total === 10 && rv.parcelas.length === 1 && rv.parcelas[0].id === 'estorno' && rv.parcelas[0].itens.length === 1 && velha[1].diferenca === 5,
        'lista guardada antes da correção (sem estorno R$ 10 + repetida R$ 5): "Dá para recuperar" R$ 10,00, não R$ 15,00 (a lista guardada não é alterada)');
    // Os casos da revisão da correção (07/10/2026), com estorno de OUTRO valor que a cópia repetida.
    const d1 = F.conferir([cob('9000000005', 'Custo por vender', 10, 'A1|9000000005|CVVML'), cob('9000000005', 'Cancelamento do Custo por vender', 10, 'A2|9000000005|BVVML', { estorno: true }),
        cob('9000000005', 'Custo por cobrar', 5, 'A3|PAG1|CVVPRC'), cob('9000000005', 'Custo por cobrar', 5, 'A4|PAG1|CVVPRC'), cob('9000000005', 'Custo por cobrar', 5, 'A5|PAG1|CVVPRC'),
        cob('9000000005', 'Cancelamento do Custo por cobrar', 8, 'A6|PAG1|BVVPRC', { estorno: true })], {});
    const t1 = d1.length === 1 ? F.textoChamado(d1[0]) : '';
    ok(d1.length === 1 && d1[0].regra === 'sem_estorno' && d1[0].valor === 7 && d1[0].esperado === 0 && d1[0].diferenca === 7 && F.recuperar({ conferir: d1 }).total === 7
        && /- Valor devido: R\$ 0,00\n/.test(t1) && /venda foi cancelada/.test(t1) && /Também aparece repetida neste pedido: R\$ 5,00 × 3\./.test(t1),
        'cancelada + "Custo por cobrar" 3× de R$ 5 + estorno de R$ 8: fica a venda cancelada (R$ 7 ainda cobrados, devido R$ 0) com a repetição no texto (antes: repetida com "Valor devido R$ 8,00", que ninguém leu)');
    const d2 = F.conferir([cob('9000000006', 'Custo por vender', 10, 'B1|9000000006|CVVML'), cob('9000000006', 'Custo por vender', 10, 'B2|9000000006|CVVML'),
        cob('9000000006', 'Cancelamento do Custo por vender', 15, 'B3|9000000006|BVVML', { estorno: true })], {});
    ok(d2.length === 0 && F.recuperar({ conferir: d2 }).total === 0,
        'tarifa de R$ 10 lançada 2× e estorno de R$ 15: ficaram R$ 5, menos que 1 cobrança, nada a pedir (antes: "Valor devido R$ 15,00" e pedia R$ 5,00)');
    const d3 = F.conferir([cob('9000000007', 'Custo por cobrar', 5, 'C1|PAG7|CVVPRC'), cob('9000000007', 'Custo por cobrar', 5, 'C2|PAG7|CVVPRC'), cob('9000000007', 'Custo por cobrar', 5, 'C3|PAG7|CVVPRC'),
        cob('9000000007', 'Cancelamento do Custo por cobrar', 3, 'C4|PAG7|BVVPRC', { estorno: true })], {});
    const t3 = d3.length === 1 ? F.textoChamado(d3[0]) : '';
    ok(d3.length === 1 && d3[0].regra === 'repetida' && !!d3[0].duvida && F.recuperar({ conferir: d3 }).total === 0 && /^Olá! Tenho uma dúvida/.test(t3) && /R\$ 5,00 × 3/.test(t3)
        && /estorno/.test(t3) && !/Valor devido|Diferença|Solicitamos/.test(t3) && /ficaram R\$ 12,00 cobrados/.test(d3[0].motivo),
        '"Custo por cobrar" 3× de R$ 5 e estorno de R$ 3: o que o estorno acertou não se sabe → dúvida, o texto só pergunta (antes: pedia R$ 10,00 sem citar o estorno)');
    // A "tarifa acima" (estimativa pelo preço de hoje) ganha da repetida (fato): o texto que fica cita a cobrança em dobro e pede ao menos a cópia.
    const e1 = F.conferir([cob('9000000008', 'Custo por vender', 7.25, 'E5|9000000008|CVVML'), cob('9000000008', 'Custo por vender', 7.25, 'E6|9000000008|CVVML')],
        { MLB1000000001: { tarifa: 6, preco: 50, titulo: 'X' } });
    const te = e1.length === 1 ? F.textoChamado(e1[0]) : '', re = F.recuperar({ conferir: e1 }), tre = re.parcelas.length ? F.textoChamado(F.itemDoChamado(re.parcelas[0].itens[0])) : '';
    ok(e1.length === 1 && e1[0].regra === 'tarifa' && e1[0].diferenca === 8.5 && /^Assunto: Pedido de revisão de cobrança/.test(te) && te === tre && re.total === 8.5
        && /- Como estimamos: [^\n]*\n- A mesma cobrança foi lançada mais de uma vez neste pedido: R\$ 7,25 × 2\n/.test(te) && pedido(te) === 850
        && /se a diferença se confirmar, o estorno de R\$ 8,50 na nossa conta\. Se não se confirmar, pedimos ao menos o estorno da cobrança lançada em duplicidade \(R\$ 7,25\)\./.test(te),
        'tarifa de R$ 7,25 lançada 2× e R$ 6 no anúncio: 1 item (R$ 8,50, estimativa) e o texto cita a cobrança em dobro e pede ao menos R$ 7,25 (antes: a repetição ficava fora do texto)');
    ok(/- A mesma cobrança foi lançada mais de uma vez neste pedido: R\$ 10,00 × 2\n/.test(F.textoChamado(b[0])), 'o mesmo no caso de R$ 10 × 2 com R$ 6 no anúncio');
}

console.log('F.comparaRepasse: o que entrou no Mercado Pago × o líquido estimado');
{
    const rnd = lcg(55);
    todos(400, () => {
        const itens = [], cent = { entrou: 0, reemb: 0 };
        for (let i = inteiro(rnd, 1, 300); i > 0; i--) {
            const reemb = rnd() < 0.15, v = inteiro(rnd, reemb ? 0 : 1, 300000), tr = 'T' + inteiro(rnd, 1e9, 9e9);
            itens.push({ data: '2026-09-' + String(inteiro(rnd, 1, 30)).padStart(2, '0'), tipo: reemb ? 'reembolso' : 'venda', valor: reemb ? R(-v) : R(v), transacao: tr });
            if (reemb) cent.reemb -= v; else cent.entrou += v;
            if (rnd() < 0.05) itens.push(Object.assign({}, itens[itens.length - 1]));   // a mesma transação lida 2 vezes: conta 1
        }
        return { itens, cent, liq: inteiro(rnd, -100000, 30000000) };
    }, x => {
        const meses = SHC.repassePorMes(x.itens), m = meses['2026-09'], real = x.cent.entrou + x.cent.reemb;
        if (C(m.entrou) !== x.cent.entrou || C(m.reembolsos) !== x.cent.reemb || m.reembolsos > 0 || C(m.liquido) !== real) return 'repasse ' + JSON.stringify(m);
        const c = F.comparaRepasse({ meses }, '2026-09', R(x.liq));
        if (C(c.real) !== real || C(c.diferenca) !== real - x.liq || c.estimado !== R(x.liq)) return 'diferença ' + c.diferenca;
        const dif = real - x.liq, nums = moedasDe(c.frase);
        if (dif === 0) return /bate/.test(c.frase) ? true : c.frase;
        if (nums[0] !== Math.abs(dif) || (dif < 0) !== /a menos/.test(c.frase) || (dif > 0) !== /a mais/.test(c.frase)) return c.frase;
        const h = F.htmlRepasse({ temMP: true, st: {}, agora: Date.now(), rep: { meses }, mes: '2026-09' }, R(x.liq));
        const k = [...h.matchAll(/<span class="kn">([^<]*)<\/span><b>([^<]*)<\/b>/g)].map(y => lerMoeda(y[2]));
        if (k.length !== 3 || k[0] !== real || k[1] !== x.liq || k[2] !== dif || k[0] - k[1] !== k[2]) return 'tela ' + k.join(' ');
        return semLixo(h) || 'lixo';
    }, 'entrou = vendas + reembolsos (reembolso negativo, mesma transação 1 vez); diferença = entrou − líquido; a frase e os 3 números da tela batem');
    const meses = SHC.repassePorMes([{ data: '2026-09-02', tipo: 'venda', valor: 100, transacao: 'T1' }]);
    ok(F.comparaRepasse({ meses }, '2026-09', null).diferenca === null && /Falta o líquido/.test(F.comparaRepasse({ meses }, '2026-09', null).frase), 'sem o líquido estimado: sem diferença (não compara com R$ 0,00)');
    ok(F.comparaRepasse({ meses, desde: '2026-09-02' }, '2026-09', 50).diferenca === null, 'Mercado Pago lido só em parte no mês: não compara');
    ok(F.comparaRepasse({ meses }, '2026-08', 50) === null, 'mês sem repasse lido: null');
}

console.log('Ciclo da fatura (F.somaDias / F.htmlCiclo): vendas − canceladas − fatura = sobra, na tela');
{
    const rnd = lcg(99);
    todos(200, () => {
        const dias = {}, k = { b: 0, cd: 0 };
        for (let d = new Date('2026-08-23T12:00:00Z'); d <= new Date('2026-09-22T12:00:00Z'); d = new Date(+d + 864e5)) {
            const dia = d.toISOString().slice(0, 10), b = inteiro(rnd, 0, 800000), c = inteiro(rnd, 0, 20000), dv = inteiro(rnd, 0, 9000);
            dias[dia] = { bruto: R(b), cancelado: R(c), devolvido: R(dv) }; k.b += b; k.cd += c + dv;
        }
        dias['2026-08-22'] = { bruto: 1, cancelado: 0, devolvido: 0 }; dias['2026-09-23'] = { bruto: 1, cancelado: 0, devolvido: 0 };   // fora do ciclo
        return { dias, k, total: inteiro(rnd, 0, 5000000) };
    }, x => {
        const s = F.somaDias(x.dias, '2026-08-23', '2026-09-22');
        if (!s.completo || s.n !== 31 || C(s.valor) !== x.k.b || C(s.cancelado) + C(s.devolvido) !== x.k.cd) return JSON.stringify(s);
        const h = F.htmlCiclo({ mes: '2026-09', nome: 'Setembro', de: '2026-08-23', ate: '2026-09-22', dia: 22, total: R(x.total), status: 'Paga', link: 'https://vendedores.mercadolivre.com.br/billing/resume' }, { dias: x.dias });
        const k = [...h.matchAll(/<span class="kn">[^<]*<\/span><b>([^<]*)<\/b>/g)].map(m => lerMoeda(m[1]));
        return k.length === 4 && k[0] === x.k.b && k[1] === x.k.cd && k[2] === x.total && k[0] - k[1] - k[2] === k[3] ? true : 'tela ' + k.join(' ');
    }, 'os 4 números do ciclo (dias de outro ciclo fora) fecham: vendas − canceladas e devolvidas − total da fatura = sobra');
    const furado = F.htmlCiclo({ mes: '2026-09', nome: 'Setembro', de: '2026-08-23', ate: '2026-09-22', dia: 22, total: 500, status: '', link: 'x' }, { dias: { '2026-09-01': { bruto: 10 } } });
    ok(/parcial \(1 de 31 dias\)/.test(furado) && /Sobra antes do custo dos produtos<\/span><b>—<\/b>/.test(furado), 'ciclo com dia faltando: vendas "parcial" e a sobra "—" (nunca uma sobra pela metade)');
}

console.log('Confere com a fatura do ML (pela fatura de cada cobrança): cada linha e o total no centavo');
{
    const rnd = lcg(2468);
    const FECH = '2026-09-05', CAT_DO = { tarifa_venda: 'Tarifas de venda', cobranca_mp: 'Tarifas de venda', recebimento: 'Tarifas de venda', parcelamento: 'Taxas de parcelamento',
        frete: 'Tarifas de envios', devolucao: 'Tarifas de envios', full: 'Tarifas de envios Full', ads: 'Publicidade', ads_seguidores: 'Publicidade',
        minha_pagina: 'Minha página', impostos_ml: 'Impostos (DIFAL)', outro: 'Outras tarifas' };
    todos(150, () => {
        const a = cobrancasAleatorias(rnd, '2026-08', inteiro(rnd, 1, 300), FECH), b = cobrancasAleatorias(rnd, '2026-09', inteiro(rnd, 0, 20), FECH);
        b.cobs.forEach(c => { c.data = '2026-09-0' + inteiro(rnd, 1, 5); });
        return { a, b };
    }, x => {
        const cobs = x.a.cobs.concat(x.b.cobs).map(c => (/^Taxa de parcelamento/.test(c.texto.replace(/^Cancelamento do /, '')) ? Object.assign({}, c, { texto: c.texto + ' equivalente ao acréscimo' }) : c));
        const fechs = SHC.fechamentoDasCobrancas(cobs), cat = { nome: 'Setembro', fechamento: FECH, categorias: [], cancelamentos: 0, total: 0 };
        // mês lido sem cobrança: o fundo grava zerado (gravarFechamento), como aqui
        if (!fechs['2026-09']) fechs['2026-09'] = { mes: '2026-09', porTipo: {}, porDia: {}, estornos: 0, total: 0, qtdVendas: 0, pedidos: {}, tipos: SHC.FECH_TIPOS_VERSAO, porFatura: {} };
        const porCat = {};
        let canc = 0;
        cobs.forEach(c => { const t = SHC.tipoCustoFechamento(c.texto), v = C(c.valor); if (c.estorno) canc += v; else porCat[CAT_DO[t]] = (porCat[CAT_DO[t]] || 0) + v; });
        Object.keys(porCat).forEach(n => cat.categorias.push({ nome: n, valor: R(porCat[n]) }));
        cat.cancelamentos = R(canc); cat.total = R(soma(Object.values(porCat)) - canc);
        const soma0 = F.somaFatura(fechs, FECH, null);
        if (!soma0) return 'sem a soma pela fatura';
        const r = F.conferirFatura(cat, null, '2026-09', soma0, null, [], null);
        if (r.modo !== 'fatura' || !r.ok || !r.linhas.every(l => l.ok && l.dif === 0) || (r.cancel && r.cancel.dif !== 0) || r.total.dif !== 0) return 'não bate: ' + r.manchete;
        if (C(r.total.cop) !== soma(r.linhas.map(l => C(l.cop))) - (r.cancel ? C(r.cancel.cop) : 0)) return 'Σ linhas − cancelamentos ≠ total (Copiloto)';
        if (C(r.total.ml) !== soma(r.linhas.map(l => C(l.ml))) - (r.cancel ? C(r.cancel.ml) : 0)) return 'Σ linhas − cancelamentos ≠ total (ML)';
        // 2 centavos a mais numa categoria do ML: a linha e o total não batem, e a tela diz R$ 0,02 (1 centavo: caso feito à mão logo abaixo).
        const um = JSON.parse(JSON.stringify(cat)); um.categorias[0].valor = SHC.r2(um.categorias[0].valor + 0.02); um.total = SHC.r2(um.total + 0.02);
        const r1 = F.conferirFatura(um, null, '2026-09', soma0, null, [], null);
        if (r1.ok || r1.linhas.filter(l => !l.ok).length !== 1 || r1.linhas.find(l => !l.ok).dif !== -0.02 || r1.total.ok || r1.total.dif !== -0.02 || !/^Diferença de R\$ 0,02 em /.test(r1.manchete)) return '2 centavos: ' + r1.manchete;
        const h = F.htmlConfere(r);
        const ns = [...h.matchAll(/<small class="cf-n">ML ([^<·]*) · Copiloto ([^<]*)<\/small>/g)].map(m => [lerMoeda(m[1]), lerMoeda(m[2])]);
        const linhasTela = r.linhas.length + (r.cancel ? 1 : 0) + 1;
        return ns.length === linhasTela && ns.every(([m, c]) => m === c) && /bate linha por linha/.test(h) && semLixo(h) ? true : 'tela ' + JSON.stringify(ns);
    }, 'fatura montada das mesmas cobranças: todas as linhas e o total batem (ML = Copiloto na tela); 2 centavos a mais viram "Diferença de R$ 0,02"');
    // Pela fatura, 1 centavo já não bate (a folga de R$ 1 é só do que é estimado): antes saía "✓ bate · ML R$ 100,01 · Copiloto R$ 100,00".
    const cobs1 = [{ texto: 'Custo por vender', valor: 100, data: '2026-08-15', orderId: '2000000001', itemId: 'MLB9000000001', fatura: FECH },
        { texto: 'Tarifa de envio', valor: 50, data: '2026-08-16', orderId: '2000000002', itemId: 'MLB9000000002', fatura: FECH }];
    const f1 = SHC.fechamentoDasCobrancas(cobs1);
    f1['2026-09'] = { mes: '2026-09', porTipo: {}, porFatura: {}, estornos: 0, total: 0 };
    const s1 = F.somaFatura(f1, FECH, null), cat1 = (venda, envio, total) => ({ nome: 'Setembro', fechamento: FECH,
        categorias: [{ nome: 'Tarifas de venda', valor: venda }, { nome: 'Tarifas de envios', valor: envio }], cancelamentos: 0, total });
    const um1 = F.conferirFatura(cat1(100.01, 50, 150.01), null, '2026-09', s1, null, [], null), lv = um1.linhas.find(l => l.id === 'venda'), h1 = F.htmlConfere(um1);
    ok(um1.modo === 'fatura' && !um1.ok && !lv.ok && lv.dif === -0.01 && !um1.total.ok && um1.total.dif === -0.01 && um1.manchete === 'Diferença de R$ 0,01 em tarifas de venda.'
        && /✗<\/span><b>Tarifas de venda<\/b><span class="cf-v">−R\$ 0,01<\/span>/.test(h1) && !/bate linha por linha/.test(h1)
        && h1.split('<div class="cf-l ').filter(x => /<b>(Tarifas de venda|Total da fatura)<\/b>/.test(x)).every(x => /^x/.test(x) && !/>bate</.test(x)),
        'pela fatura, R$ 0,01 de diferença não "bate": ✗ em Tarifas de venda e no total (−R$ 0,01), sem "bate linha por linha"');
    const troca = F.conferirFatura(cat1(100.01, 49.99, 150), null, '2026-09', s1, null, [], null);
    ok(!troca.ok && troca.linhas.filter(l => !l.ok).length === 2 && troca.total.ok, '1 centavo trocado de linha (+0,01 em venda, −0,01 em envios, total igual): as 2 linhas ✗ e a fatura não bate');
    const igual = F.conferirFatura(cat1(100, 50, 150), null, '2026-09', s1, null, [], null);
    ok(igual.ok && igual.linhas.every(l => l.ok && l.dif === 0) && igual.total.ok && /bate linha por linha/.test(F.htmlConfere(igual)), 'os mesmos centavos: tudo ✓ e "bate linha por linha"');
    // Total ✗ pela fatura: o motivo fecha com o número mostrado (diferença nas linhas + "os outros R$ X"), também abaixo de R$ 1.
    const so = F.conferirFatura(cat1(100, 50, 150.5), null, '2026-09', s1, null, [], null), mix = F.conferirFatura(cat1(105, 50, 155.5), null, '2026-09', s1, null, [], null);
    ok(!so.total.ok && so.total.dif === -0.5 && /Os outros R\$ 0,50 não dá para saber de onde vêm/.test(so.total.motivo) && F.htmlConfere(so).indexOf('Os outros R$ 0,50') > 0
        && !mix.total.ok && mix.total.dif === -5.5 && /^Diferença nos custos \(−R\$ 5,00\)\. Os outros R\$ 0,50 não dá/.test(mix.total.motivo)
        && /Os outros R\$ 0,01 /.test(F.conferirFatura(cat1(100, 50, 150.01), null, '2026-09', s1, null, [], null).total.motivo),
        'pela fatura, total ✗ com sobra de R$ 0,01 a R$ 1,00: o motivo cita "os outros R$ X" (0,50 sozinho; 5,00 nas linhas + 0,50; 0,01)');
}

console.log('Fatura × a anterior (F.faturaVsAnterior): agora − antes, linha a linha e no total');
{
    const rnd = lcg(1357);
    const NOMES = ['Tarifas de venda', 'Taxas de parcelamento', 'Tarifas de envios', 'Tarifas de envios Full', 'Publicidade', 'Minha página', 'Outras tarifas'];
    todos(300, () => {
        const cat = () => ({ categorias: NOMES.filter(() => rnd() < 0.7).map(n => ({ nome: n, valor: R(inteiro(rnd, 0, 3000000)) })), cancelamentos: R(inteiro(rnd, 0, 50000)) });
        const a = Object.assign({ nome: 'Setembro', fechamento: '2026-09-05' }, cat()), b = Object.assign({ nome: 'Agosto', fechamento: '2026-08-05' }, cat());
        [a, b].forEach(x => { x.total = R(soma(x.categorias.map(c => C(c.valor))) - C(x.cancelamentos)); });
        return { categorias: { '2026-09': a, '2026-08': b } };
    }, fat => {
        const v = F.faturaVsAnterior(fat, '2026-09', null), a = fat.categorias['2026-09'], b = fat.categorias['2026-08'];
        const val = (x, id) => soma(x.categorias.filter(c => F.grupoFatura(c.nome)[0] === id).map(c => C(c.valor)));
        for (const l of v.linhas) if (C(l.agora) - C(l.antes) !== C(l.dif) || (l.dif === null)) return l.id + ': dif ' + l.dif;
        if (C(v.total.dif) !== C(a.total) - C(b.total) || soma(v.linhas.map(l => C(l.agora))) !== soma(a.categorias.map(c => C(c.valor)))) return 'total';
        if (v.total.dir !== 'igual' && moedasDe(v.manchete)[0] !== Math.abs(C(v.total.dif))) return v.manchete;
        if (v.total.dir !== 'igual' && (v.total.dif < 0) !== / menor /.test(v.manchete)) return 'sinal da manchete: ' + v.manchete;
        for (const l of v.linhas) if (C(l.agora) !== val(a, l.id) || C(l.antes) !== val(b, l.id)) return l.rotulo + ': agora/antes ≠ a fatura';
        const h = F.htmlFaturaVs(v);
        // Cada linha da tela: "Agosto R$ a → Setembro R$ b · ±R$ d" com b − a = d (sem o "·" quando não mudou).
        const tela = [...h.matchAll(/<small class="cf-n">Agosto ([^<→]*) → Setembro ([^<·]*)(?: · ([^<]*))?<\/small>/g)];
        if (tela.length !== v.linhas.length + (v.cancel ? 1 : 0) + 1) return tela.length + ' linhas na tela';
        for (const m of tela.slice(0, -1)) { const d = m[3] === undefined ? 0 : (m[3][0] === '−' ? -1 : 1) * lerMoeda(m[3].slice(1)); if (lerMoeda(m[2]) - lerMoeda(m[1]) !== d) return 'tela: ' + m[0]; }
        const ft = tela[tela.length - 1];   // total: antes → agora (a variação vai no selo ▲/▼)
        if (lerMoeda(ft[1]) !== C(b.total) || lerMoeda(ft[2]) !== C(a.total)) return 'total na tela: ' + ft[0];
        return semLixo(h) ? true : 'lixo';
    }, 'cada categoria e o total: diferença = agora − antes; a tela mostra antes → agora · ±diferença; a manchete mostra |diferença| com "maior"/"menor" certo');
}

console.log('Faturas × meses (rateio): as partes por mês somam o total das cobranças do ciclo');
{
    const rnd = lcg(4321);
    todos(200, () => {
        const ga = cobrancasAleatorias(rnd, '2026-08', inteiro(rnd, 1, 400)), gs = cobrancasAleatorias(rnd, '2026-09', inteiro(rnd, 1, 400));
        const fechs = SHC.fechamentoDasCobrancas(ga.cobs.concat(gs.cobs));
        const fat = { faturas: [{ mes: '2026-09', nome: 'Setembro', fechamento: '2026-09-22', total: R(inteiro(rnd, 0, 9000000)), linkDetalhe: '' }, { mes: '2026-08', nome: 'Agosto', fechamento: '2026-08-22', total: 1 }] };
        return { fechs, fat, cobs: ga.cobs.concat(gs.cobs) };
    }, x => {
        const r = F.rateios(x.fat, x.fechs).find(y => y.fatura === '2026-09');
        const noCiclo = c => c.data >= '2026-08-23' && c.data <= '2026-09-22';
        const ciclo = soma(x.cobs.filter(noCiclo).map(c => (c.estorno ? -1 : 1) * C(c.valor)));
        const porMes = m => soma(x.cobs.filter(c => noCiclo(c) && c.data.slice(0, 7) === m).map(c => (c.estorno ? -1 : 1) * C(c.valor)));
        if (C(r.total) !== ciclo || C(r.porMes['2026-08']) !== porMes('2026-08') || C(r.porMes['2026-09']) !== porMes('2026-09')) return 'rateio ' + JSON.stringify(r.porMes) + ' total ' + r.total;
        if (C(r.diferenca) !== ciclo - C(x.fat.faturas[0].total)) return 'diferença ' + r.diferenca;
        const h = F.htmlRateio(x.fat, x.fechs), lin = h.split('<tr>').find(s => s.indexOf('Setembro') >= 0);
        const ns = moedasDe(tiraTags(lin).replace(/agosto: |setembro: /g, ''));
        if (ns[0] !== C(x.fat.faturas[0].total) || ns[1] + ns[2] !== C(r.total)) return 'tela ' + ns.join(' ');
        if (!r.conferido && (ns[3] !== C(r.total) || ns[4] !== C(r.totalFatura) || ns[3] - ns[4] !== ns[5])) return 'frase da diferença: ' + ns.join(' ');
        return semLixo(h) || 'lixo';
    }, 'cada fatura: agosto + setembro = Σ das cobranças do ciclo (23/08 a 22/09); diferença = Σ − total da fatura; a frase da tela fecha (soma − fatura = diferença)');
}

console.log(f ? '\n' + f + ' FALHA(S)' : '\nTUDO OK');
process.exit(f ? 1 : 0);
