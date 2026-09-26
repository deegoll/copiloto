// SellerHub Copiloto v2.4 — painel lateral (abre ao clicar no ícone da extensão, ao lado do Mercado Livre).
// Tudo o que é do anúncio vem da sincronização com a sessão do ML (background.js). O seller só informa
// custo (por SKU) e imposto/meta (Ajustes).
// Parte 1: funções puras (SHC.pl.*) — rodam em teste (node), sem DOM e sem chrome.*.
// Parte 2: a tela.
(function (root) {
    'use strict';
    const SHC = root.SHC || (root.SHC = {});
    const P = SHC.pl = {};
    const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

    // '2026-09' → 'set/26'; '2026-09@15' (parte do mês desde o dia 15, P.freteMensal) → 'set/26, desde o dia 15'
    P.nomeMes = m => MESES[+m.slice(5, 7) - 1] + '/' + m.slice(2, 4) + (m[7] === '@' ? ', desde o dia ' + (+m.slice(8)) : '');
    P.inicioMes = m => m[7] === '@' ? m.slice(0, 7) + '-' + m.slice(8) : m.slice(0, 7) + '-01';
    P.dataBr = d => d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : '';
    P.dias = n => n + (Math.abs(n) === 1 ? ' dia' : ' dias');
    const curto = (t, n) => { const s = String(t || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
    const mais = v => (v > 0 ? '+' : v < 0 ? '−' : '') + SHC.moeda(Math.abs(v));
    const maisPct = v => (v > 0 ? '+' : '') + SHC.pctTxt(v);

    // Linhas "mãe" de família (com innerRows) não são anúncio: o preço vem em faixa e os filhos vêm logo depois.
    P.anunciosReais = itens => (itens || []).filter((it, i, a) => !(!it.dentroDeFamilia && it.preco === null && a[i + 1] && a[i + 1].dentroDeFamilia));

    // Família da Central de promoções (F…) de cada anúncio, pelos anúncios e propostas do retrato de promoções.
    P.familiaPorItem = function (promos) {
        const out = {};
        if (!promos) return out;
        (promos.familias || []).forEach(f => (f.anuncios || []).forEach(id => { out[id] = f.chave; }));
        (promos.propostas || []).forEach(p => { if (p.itemId && p.familia && !out[p.itemId]) out[p.itemId] = p.familia; });
        return out;
    };
    // SKUs de uma família: anúncios dela (e das propostas dela) que aparecem na lista de Anúncios (skuDe = {MLB: SKU}).
    P.skusDaFamilia = function (f, propsFam, skuDe) {
        const ids = (f.anuncios || []).concat((propsFam || []).map(p => p.itemId));
        return [...new Set(ids.map(id => skuDe[id]).filter(Boolean))];
    };

    // Custos do painel numa leitura só. Ordem: SKU → anúncio (MLB) → família da Central (F…, custo antigo).
    // O anúncio vem antes da família: é onde o painel grava sem SKU (e o que as etiquetas da lista leem).
    P.lerCustosPainel = async function (fams, props, grupos, ctx) {
        const famI = {};
        fams.forEach(f => { famI[f.chave] = { familia: f.chave }; });
        const cardI = fams.map(f => { const s = ctx.skusFam[f.chave] || []; return { sku: s.length === 1 ? s[0] : '', itemId: (f.anuncios || [])[0] || '' }; });
        const propI = props.map(p => ({ sku: ctx.skuDe[p.itemId] || '', itemId: p.itemId, familia: p.familia }));   // igual à etiqueta da Central
        const grI = grupos.map(g => ({ sku: g.sku, itemId: g.itens[0].itemId }));
        const res = await SHC.custosDe(Object.values(famI).concat(cardI, propI, grI));
        const deFam = ch => (ch && famI[ch] && res.get(famI[ch])) || null;
        const custoFam = {}, custoProp = new Map(), custoGrupo = {};
        fams.forEach((f, i) => { custoFam[f.chave] = res.get(cardI[i]) || deFam(f.chave); });
        props.forEach((p, i) => { custoProp.set(p, res.get(propI[i]) || custoFam[p.familia] || null); });
        grupos.forEach((g, i) => { custoGrupo[g.chave] = res.get(grI[i]) || deFam(ctx.famDeItem[g.itens[0].itemId]); });
        return { custoFam, custoProp, custoGrupo };
    };
    // Onde gravar: 1 SKU → no SKU; mais de 1 SKU → null (cada SKU no Catálogo); sem SKU → nos anúncios (MLB)
    // e também na família F… se o custo lido veio de lá (a Central de promoções lê a família primeiro).
    P.alvoCusto = function (skus, ids, atual, familia) {
        if (skus.length === 1) return { sku: skus[0] };
        if (skus.length > 1) return null;
        const chaves = [...new Set(ids.filter(Boolean))].map(id => SHC.chaveParaGravar({ itemId: id }));
        if (atual && /^c\|ml\|F/.test(atual.chave) && chaves.indexOf(atual.chave) < 0) chaves.push(atual.chave);
        if (!chaves.length && familia) chaves.push(SHC.chaveParaGravar({ familia }));
        return chaves.length ? { chaves } : null;
    };
    // Digitado aqui = origem 'manual' (a leitura do Tiny não troca, SHC.tinyDigitado); o título gravado antes fica.
    P.gravarCusto = async function (alvo, custo, titulo) {
        const tit = atual => (titulo && !(atual && atual.titulo) ? { titulo } : {});
        if (alvo.sku) return SHC.salvarCustoSku(alvo.sku, Object.assign({ custo, origem: 'manual' }, tit(await SHC.lerChave(SHC.chaveSku(alvo.sku)))));
        for (const k of alvo.chaves) { const a = (await SHC.lerChave(k)) || {}; await SHC.gravarChave(k, Object.assign(a, tit(a), { custo, origem: 'manual', atualizado: Date.now() })); }
    };

    // Histórico diário do frete (fh|ml|MLB) → valor de hoje, última mudança e valor no fim de cada mês.
    P.historicoFrete = function (h) {
        const dias = Object.keys(h || {}).filter(d => SHC.num(h[d]) !== null).sort();
        if (!dias.length) return null;
        const atual = h[dias[dias.length - 1]];
        let anterior = null, ate = null, desde = null;
        for (let i = dias.length - 2; i >= 0; i--) {
            if (Math.abs(h[dias[i]] - atual) > 0.009) { anterior = h[dias[i]]; ate = dias[i]; desde = dias[i + 1]; break; }
        }
        const fim = {};
        dias.forEach(d => { fim[d.slice(0, 7)] = h[d]; });
        const meses = Object.keys(fim).sort().map(m => ({ m, v: fim[m] }));
        const passado = meses.length > 1 ? meses[meses.length - 2] : null;
        return {
            primeiro: dias[0], ultimo: dias[dias.length - 1], atual, anterior, ate, desde,
            varRs: anterior === null ? 0 : SHC.r2(atual - anterior),
            varPct: anterior ? (atual - anterior) / anterior * 100 : 0,
            meses, passado,
            varMesRs: passado ? SHC.r2(atual - passado.v) : null,
            varMesPct: passado && passado.v ? (atual - passado.v) / passado.v * 100 : null,
        };
    };

    P.mesMenos = (m, k) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 - k, 1)).toISOString().slice(0, 7);   // ('2026-09', 11) → '2025-10'

    const mediana = xs => { const s = xs.slice().sort((a, b) => a - b), h = s.length >> 1; return !s.length ? null : (s.length % 2 ? s[h] : SHC.r2((s[h - 1] + s[h]) / 2)); };
    // Subida que conta: mais de R$ 1 e mais de 2% acima da base (menos que isso é ruído da média/arredondamento).
    const subiu = (v, base) => v - base > Math.max(1, base * 0.02) + 0.004;

    // Vendas (vd|ml|MLB, frete por conta do vendedor) por mês → {meses:{'AAAA-MM': {n, frete, medio, tipico, pedidos}}, fora:[…]}.
    // tipico = mediana do frete por pedido no mês: um pedido fora do padrão não cria "subida".
    // O Faturamento não traz a quantidade (vd sem q; a confirmar ao vivo): pedido com frete ≥ 1,8× o típico do mês dele fica
    // fora (possível pedido com mais de 1 unidade) e vai em `fora`. Mês com 1 pedido só não tem como separar.
    // Degrau no meio do mês (V10): a partir de um dia, 2+ pedidos seguidos, TODOS acima de todos os de antes (mais de R$ 1 e 2%)
    // → o mês é separado nesse dia ('AAAA-MM' até a véspera, 'AAAA-MM@DD' desde o dia) e a regra de 1,8× não tira os pedidos novos.
    // Degrau de 1,8× ou mais só separa com 3+ pedidos depois dele: 2 pedidos altos no fim do mês parecem pedidos de 2 unidades
    // (continuam em `fora`, sem chamado). ponytail: só degrau "limpo"; um pedido de 2 unidades antes do degrau impede a separação.
    const partes = lista => {
        const s = lista.slice().sort((a, b) => a.d < b.d ? -1 : (a.d > b.d ? 1 : 0)), u = p => p.f / p.q;
        for (let i = 1; i <= s.length - 2; i++) {
            if (s[i].d === s[i - 1].d) continue;
            const antes = Math.max(...s.slice(0, i).map(u)), depois = Math.min(...s.slice(i).map(u));
            if (subiu(depois, antes) && (depois < 1.8 * antes || s.length - i >= 3)) return [s.slice(0, i), s.slice(i)];
        }
        return [s];
    };
    P.freteMensal = function (vendas) {
        const por = {};
        Object.keys(vendas || {}).forEach(o => {
            const v = vendas[o];
            if (!v || v.pc || !(v.f > 0) || !v.d) return;
            (por[v.d.slice(0, 7)] || (por[v.d.slice(0, 7)] = [])).push({ orderId: o, d: v.d, f: v.f, q: v.q || 1 });
        });
        Object.keys(por).forEach(k => { const ps = partes(por[k]); if (ps.length > 1) { por[k] = ps[0]; por[k + '@' + ps[1][0].d.slice(8, 10)] = ps[1]; } });
        const meses = {}, fora = [];
        Object.keys(por).forEach(k => {
            const ref = por[k].map(p => p.f / p.q).sort((a, b) => a - b)[(por[k].length - 1) >> 1];   // mediana de baixo: [20, 40] → 20
            const bons = por[k].filter(p => { if (p.f / p.q >= 1.8 * ref) { fora.push(p); return false; } return true; });
            const n = bons.reduce((a, p) => a + p.q, 0), frete = SHC.r2(bons.reduce((a, p) => a + p.f, 0));
            meses[k] = { n, frete, medio: SHC.r2(frete / n), tipico: mediana(bons.map(p => p.f / p.q)), pedidos: bons.map(p => p.orderId) };
        });
        return { meses, fora };
    };

    // Lucro perdido com frete: Σ (frete típico do mês − base) × vendas do mês, só nos meses em que o típico passa da base
    // (subiu). base = típico do último mês com vendas antes de `desde` (sem ele: o 1º mês da janela). Subida que continua
    // conta em todo mês; mês que voltou ao normal não conta. linhas = só os meses entre desde e ate (AAAA-MM).
    P.pagoAMaisPorMes = function (vendas, desde, ate) {
        const fm = P.freteMensal(vendas), todos = Object.keys(fm.meses).sort();
        const janela = todos.filter(m => (!desde || m >= desde) && (!ate || m.slice(0, 7) <= ate.slice(0, 7)));   // 'AAAA-MM@DD' é do mês dele
        const antes = todos.filter(m => janela.length && m < janela[0]).pop();
        const mesBase = antes || janela[0] || null, base = mesBase ? fm.meses[mesBase].tipico : null;
        const linhas = janela.map(mes => {
            const x = fm.meses[mes], dif = mes === mesBase ? null : SHC.r2(x.tipico - base);
            return { mes, n: x.n, frete: x.frete, medio: x.medio, tipico: x.tipico, pedidos: x.pedidos, dif, aMais: dif !== null && subiu(x.tipico, base) ? SHC.r2(dif * x.n) : 0 };
        });
        return { linhas, base, mesBase, fora: fm.fora.filter(p => janela.indexOf(p.d.slice(0, 7)) >= 0), total: SHC.r2(linhas.reduce((a, l) => a + l.aMais, 0)) };
    };

    // Ranking "Frete pago a mais" por SKU (sem SKU → por MLB): soma dos anúncios do SKU no mês mais recente com vendas
    // (aMais) e nos 12 meses até ele (total12 = lucro perdido). Ordem: maior lucro perdido em 12 meses.
    P.rankingFrete = function (itens, vendas, mesRef) {
        let ultimo = '';
        (itens || []).forEach(it => Object.keys(P.freteMensal((vendas || {})[it.itemId]).meses).forEach(m => { if (m.slice(0, 7) > ultimo) ultimo = m.slice(0, 7); }));
        const mes = (mesRef || ultimo).slice(0, 7);
        if (!mes) return null;
        const desde = P.mesMenos(mes, 11);
        const grupos = {}, comVendas = new Set();
        (itens || []).forEach(it => {
            const t = P.pagoAMaisPorMes((vendas || {})[it.itemId], desde, mes);
            const ls = t.linhas.filter(x => x.mes.slice(0, 7) === mes), l = ls.length ? { n: ls.reduce((a, x) => a + x.n, 0) } : null;   // mês + partes '@DD'
            const chave = it.sku || it.itemId;
            if (l) comVendas.add(chave);
            const aMais = SHC.r2(ls.reduce((a, x) => a + x.aMais, 0));
            if (!(aMais > 0) && !(t.total > 0)) return;
            const g = grupos[chave] || (grupos[chave] = { chave, sku: it.sku || '', titulo: it.titulo, itemIds: [], n: 0, aMais: 0, total12: 0 });
            g.itemIds.push(it.itemId); if (l) g.n += l.n;
            g.aMais = SHC.r2(g.aMais + aMais); g.total12 = SHC.r2(g.total12 + t.total);
        });
        const lista = Object.values(grupos).map(g => Object.assign(g, { porVenda: g.n ? SHC.r2(g.aMais / g.n) : 0 }))
            .sort((a, b) => (b.total12 - a.total12) || (b.aMais - a.aMais));
        return {
            mes, desde, grupos: lista, comVendas: comVendas.size,
            total: SHC.r2(lista.reduce((a, g) => a + g.aMais, 0)), total12: SHC.r2(lista.reduce((a, g) => a + g.total12, 0)),
        };
    };

    // Chamado: de quanto para quanto o frete foi. Com mudança no histórico diário (fh) → essa, menos com o anúncio em
    // promoção (a lista mostra o frete do preço da promoção; o fh não guarda o preço, então a mudança pode ter vindo dela —
    // a confirmar ao vivo). Senão, pelas vendas: a subida mais recente do frete típico que AINDA vale no último mês com
    // vendas (mais de R$ 1 e 2% acima da base); meses seguidos de subida contam juntos (mudança no meio do mês).
    // → {base, para, desde:'AAAA-MM-DD', fonte, mesAntes?, mes?} | null
    P.baseChamado = function (hist, vendas, item) {
        if (hist && hist.anterior !== null && hist.atual > hist.anterior && !(item && item.emPromocao)) return { base: hist.anterior, para: hist.atual, desde: hist.desde, fonte: 'lista' };
        const fm = P.freteMensal(vendas).meses, ms = Object.keys(fm).sort(), t = ms.map(m => fm[m].tipico);
        const ult = t[t.length - 1], sobe = k => t[k] > t[k - 1] + 0.009;
        for (let i = ms.length - 1; i >= 1; i--) {
            if (!sobe(i)) continue;
            let j = i;
            while (j > 1 && sobe(j - 1)) j--;
            if (subiu(ult, t[j - 1])) return { base: t[j - 1], para: ult, desde: P.inicioMes(ms[j]), fonte: 'vendas', mesAntes: ms[j - 1], mes: ms[ms.length - 1] };
            i = j;
        }
        return null;
    };
    // Pedidos (frete por conta do vendedor) desde a data cobrados acima da base → {peds:[{orderId, d, f, q, dif}] por data,
    // fora:[…]}. fora = cobrados acima mas deixados de fora: frete ≥ 1,8× o típico do mês (possível pedido com mais de 1 unidade).
    P.pedidosAMais = function (vendas, base, desde) {
        const fora = new Set(P.freteMensal(vendas).fora.map(p => p.orderId));
        const acima = Object.keys(vendas || {}).map(o => Object.assign({ orderId: o }, vendas[o]))
            .filter(v => v.d && !v.pc && v.f > 0 && v.d >= desde && v.f / (v.q || 1) > base + 0.009)
            .map(v => ({ orderId: v.orderId, d: v.d, f: v.f, q: v.q || 1, dif: SHC.r2(v.f - base * (v.q || 1)) }))
            .sort((a, b) => a.d < b.d ? -1 : (a.d > b.d ? 1 : 0));
        return { peds: acima.filter(p => !fora.has(p.orderId)), fora: acima.filter(p => fora.has(p.orderId)) };
    };
    // Peso e medidas da embalagem do SKU (c|sku|…, vindos da planilha do ERP) → "12,5 kg, 60 × 45 × 70 cm" ou ''.
    P.medidasTxt = function (d) {
        if (!d) return '';
        const n = v => { const x = SHC.num(v); return x > 0 ? x.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) : null; };
        const kg = n(d.pesoKg), dims = [d.larguraCm, d.alturaCm, d.comprimentoCm].map(n);
        return [kg ? kg + ' kg' : '', dims.every(Boolean) ? dims.join(' × ') + ' cm' : ''].filter(Boolean).join(', ');
    };

    // Unidades vendidas no mês (todas as vendas lidas do anúncio, também as de frete do comprador).
    P.vendasNoMes = (vendas, mes) => Object.keys(vendas || {}).reduce((a, o) => a + (vendas[o] && String(vendas[o].d).slice(0, 7) === mes ? (vendas[o].q || 1) : 0), 0);

    // ── Ads por anúncio (V8): 'ads:<conta>' = {ts, periodo, campanhas, anuncios, resumo, anterior} | {temAds:false}, da API do
    // Mercado Ads (camada de dados). Os nomes dos campos do anúncio seguem a API (cost, amountTotal, soldQuantityTotal…) ou os
    // nomes em português do leitor SHC.adsAnuncios — aceita os dois (a confirmar na integração).
    const numDe = (o, ks) => { for (const k of ks) { const v = SHC.num(o[k]); if (v !== null) return v; } return null; };
    P.adsDoAnuncio = function (a) {
        if (!a) return null;
        const o = Object.assign({}, a.metrics || {}, a.metricas || {}, a);
        // Catálogo: o Mercado Ads manda o id do PRODUTO de catálogo, não o anúncio da seller → fica de fora (não é um anúncio dela).
        if (o.catalogoProduto || o.type === 'catalog') return null;
        const itemId = String(o.itemId || o.id || o.externalId || '');
        if (!/^MLB\d+$/.test(itemId)) return null;
        return {
            itemId, titulo: o.titulo || o.title || '', campanha: (o.campaign && o.campaign.name) || o.campanha || o.campanhaNome || '',
            campanhaId: String(o.campanhaId || (o.campaign && o.campaign.id) || ''),
            gasto: numDe(o, ['cost', 'custo', 'investimento', 'gasto']) || 0, receita: numDe(o, ['amountTotal', 'receita', 'totalAmount']) || 0,
            vendas: numDe(o, ['soldQuantityTotal', 'vendas', 'unidades', 'unitsQuantity']) || 0,
            cliques: numDe(o, ['clicks', 'cliques']), impressoes: numDe(o, ['impressions', 'prints', 'impressoes']),
        };
    };
    // Ponto de equilíbrio por anúncio: sobra antes do Ads = sobra por unidade (preço de hoje) × vendas do Ads; acima = o Ads custou
    // mais que essa sobra. ACOS = Ads ÷ receita do Ads; equilíbrio = margem antes do Ads (sobra ÷ preço). Sem custo → sem selo.
    // → [{a, it, sobraUn, margem, acos, antes, depois, acima, semCusto}] (acima primeiro, depois maior gasto); só anúncio com gasto.
    P.adsEquilibrio = function (snap, itens, sobraDe) {
        const porId = {};
        (itens || []).forEach(it => { porId[it.itemId] = it; });
        return ((snap && snap.anuncios) || []).map(P.adsDoAnuncio).filter(a => a && a.gasto > 0).map(a => {
            const it = porId[a.itemId] || null, s = it ? sobraDe(it) : null, semCusto = !(s && s.sobra !== null);
            const antes = semCusto ? null : SHC.r2(s.sobra * a.vendas);
            return { a, it, semCusto, sobraUn: semCusto ? null : s.sobra, margem: semCusto ? null : s.pct,
                acos: a.receita > 0 ? a.gasto / a.receita * 100 : null, antes, depois: antes === null ? null : SHC.r2(antes - a.gasto),
                acima: !semCusto && a.gasto > antes + 0.004 };
        }).sort((x, y) => (y.acima - x.acima) || (y.a.gasto - x.a.gasto));
    };
    // Ads da conta no mês pelo Faturamento (fech:<conta>:<AAAA-MM>.porTipo): Product Ads e Publicidade de Seguidores.
    // Tipo que não veio = null (não lido), nunca 0. Sinal: o valor gasto, positivo.
    P.adsDoFechamento = function (fech) {
        const pt = (fech && fech.porTipo) || null;
        if (!pt) return null;
        const v = k => (SHC.num(pt[k]) === null ? null : SHC.r2(Math.abs(SHC.num(pt[k]))));
        const ads = v('ads'), seguidores = v('ads_seguidores');
        return ads === null && seguidores === null ? null : { ads, seguidores, total: SHC.r2((ads || 0) + (seguidores || 0)) };
    };

    // ── Saúde do estoque no Full (por produto). prevQtd = previsão de 30 dias (P.previsaoFull).
    // Dias até acabar = o menor entre o que o ML mostra e aptas ÷ previsão. O mínimo compara com aptas + a caminho.
    // Classes: sem_estoque (0 aptas) · critico (acaba em ≤ 7 dias vendendo, ou abaixo do mínimo em unidades que o seller definiu)
    // · parado (tem estoque, 0 vendas em 30 dias) · atencao (≤ 15 dias) · excedente (cobertura > 90 dias ou o ML mostra unidades
    // com tempo de estoque) · saudavel. Campo que o ML não mostrou: sem classe (null), nunca um número inventado.
    // alerta = a mesma regra do número no ícone (SHC.alertasDe): crítico, ou sem estoque com venda prevista ou abaixo do mínimo.
    // cad = c|sku|<SKU> (fullMinUn); mínimo em UNIDADES via SHC.fullMinimo — sem mínimo definido não há "abaixo do mínimo".
    P.CLASSES_FULL = { critico: 'Crítico', atencao: 'Atenção', saudavel: 'Saudável', excedente: 'Excedente', parado: 'Parado', sem_estoque: 'Sem estoque' };
    P.saudeFull = function (p, prevQtd, cad) {
        const aptas = P.un(p.aptas), v30 = P.un(p.vendas30), fm = SHC.fullMinimo(p, cad, prevQtd);
        const out = { classe: null, dias: null, cobertura: null, minUn: fm.minUn, definido: fm.definido, abaixoMin: fm.abaixo, faltam: fm.faltam, sugerido: fm.sugerido, alerta: false };
        if (aptas === null) return out;
        const tem = Math.max(0, aptas);
        if (prevQtd > 0) out.cobertura = Math.floor(tem / (prevQtd / 30));
        const ml = typeof p.diasAteEsgotar === 'number' && isFinite(p.diasAteEsgotar) ? p.diasAteEsgotar : null;
        const ds = [ml, out.cobertura].filter(x => x !== null);
        out.dias = ds.length ? Math.min(...ds) : null;
        if (tem <= 0) out.classe = 'sem_estoque';
        else if ((v30 !== 0 && out.dias !== null && out.dias <= 7) || out.abaixoMin) out.classe = 'critico';
        else if (v30 === 0) out.classe = 'parado';
        else if (out.dias !== null && out.dias <= 15) out.classe = 'atencao';
        else if ((out.cobertura !== null && out.cobertura > 90) || P.un(p.tempoEstoque) > 0) out.classe = 'excedente';
        else if (out.dias !== null) out.classe = 'saudavel';
        out.alerta = out.classe === 'critico' || (out.classe === 'sem_estoque' && (prevQtd > 0 || out.abaixoMin));
        return out;
    };
    // Grava o mínimo em unidades no c|sku|<SKU> sem mexer no custo, na origem, na data do custo nem nas medidas.
    // Não usa SHC.salvarCustoSku: sem custo ele apaga o registro (o mínimo sumiria) e troca a data do custo.
    // un vazio/0 → sem mínimo. O fullMinDias antigo (dias) sai junto.
    P.gravarMinSku = async function (sku, un) {
        const k = SHC.chaveSku(sku);
        if (!k) return false;
        const a = (await SHC.lerChave(k)) || {};
        delete a.fullMinDias;
        if (un > 0) a.fullMinUn = Math.round(un); else delete a.fullMinUn;
        await SHC.gravarChave(k, a);   // ponytail: registro vazio fica ({}); lerTudo já o ignora
        return true;
    };
    // Contagem por classe (linhas = [{saude}]) → {critico: n, …, semDado: n}.
    P.contaClasses = function (linhas) {
        const n = { semDado: 0 };
        Object.keys(P.CLASSES_FULL).forEach(c => { n[c] = 0; });
        (linhas || []).forEach(l => { if (l.saude && l.saude.classe) n[l.saude.classe]++; else n.semDado++; });
        return n;
    };
    // O que fazer com um produto do Full em alerta (texto curto, só com números calculados).
    P.acaoFull = function (l) {
        const s = l.saude, p = l.p || {}, cam = Math.max(0, P.un(p.aCaminho) || 0), falta = s.abaixoMin ? s.faltam : 0;
        // O plano cobre os dias escolhidos na tela; se ele não chega ao mínimo, vale o mínimo.
        const envia = l.qtd > 0 && l.qtd >= falta ? ` Sugestão: enviar ${l.qtd} un.` : (falta > 0 ? ` Envie pelo menos ${falta} un. para chegar ao mínimo.` : '');
        if (s.classe === 'sem_estoque') return `Sem estoque no Full${P.un(p.vendas30) > 0 ? ` e você vendeu ${P.un(p.vendas30)} nos últimos 30 dias` : ''}.${cam ? ` ${cam} un. a caminho.` : ''}${envia}`;
        const acaba = s.dias !== null && s.dias <= 7 ? `Acaba em ${P.dias(s.dias)}.` : '';
        const min = s.abaixoMin ? ` Abaixo do estoque mínimo: mínimo ${s.minUn} un.; você tem ${Math.max(0, P.un(p.aptas))} aptas${cam ? ' + ' + cam + ' a caminho' : ''}.` : '';
        return (acaba + min + envia).trim();
    };
    // Cartão "Alertas": produtos do Full em alerta + anúncios com Ads acima do equilíbrio, cada um com o que fazer.
    // daConta = SHC.alertasConta(ml:full:remessas ou ml:full): certificado vencido / restrição fiscal / penalidade → primeiro, com link.
    // saude = { semFiscal: n, perdendo: n, queda: %, medDiv: SKUs com medidas diferentes, medMud: anúncios com medida mudada } (Saúde dos anúncios): uma linha de resumo para cada um, logo depois dos avisos da conta.
    P.alertas = function (linhasFull, adsEq, daConta, saude) {
        const itens = (daConta || []).map(a => ({ tipo: 'conta', titulo: a.chave === 'conta|certificado' ? 'Certificado Digital vencido' : (a.chave === 'conta|penalidade' ? 'Penalidade no Full' : 'Aviso da conta'), texto: a.texto, link: a.link }));
        const sd = saude || {};
        if (sd.semFiscal > 0) itens.push({ tipo: 'fiscal', titulo: SHC.qtd(sd.semFiscal, 'anúncio sem dados fiscais', 'anúncios sem dados fiscais'),
            texto: 'Sem dados fiscais o Mercado Livre não emite a NF-e dessas vendas.', link: SHC.FISCAL_EDITOR, linkTxt: 'Corrigir no Editor em massa' });
        if (sd.perdendo > 0) itens.push({ tipo: 'visitas', titulo: SHC.qtd(sd.perdendo, 'anúncio perdendo visitas', 'anúncios perdendo visitas'),
            texto: `As visitas caíram ${sd.queda || 20}% ou mais na última semana. Veja o que fazer na aba Saúde.` });
        if (sd.medDiv > 0) itens.push({ tipo: 'medidas', titulo: SHC.qtd(sd.medDiv, 'SKU com medidas diferentes', 'SKUs com medidas diferentes'),
            texto: 'Anúncios do mesmo produto com medidas diferentes podem pagar fretes diferentes. Veja quais na aba Saúde.' });
        // medMudMl = quantos desses o Copiloto sabe que foram do ML (a medida certa do ERP era a de antes); os outros: "se não foi você".
        const soMl = sd.medMudMl >= sd.medMud, nMud = SHC.qtd(sd.medMud, 'anúncio', 'anúncios');
        if (sd.medMud > 0) itens.push({ tipo: 'medmud', titulo: soMl ? 'O ML alterou medidas de ' + nMud : 'A medida mudou em ' + nMud,
            texto: (soMl ? 'Copie' : 'Se não foi você, copie') + ' o texto do chamado na aba Saúde e peça a correção ao Mercado Livre.' });
        (linhasFull || []).filter(l => l.saude && l.saude.alerta).forEach(l => itens.push({ tipo: 'full', titulo: l.p.titulo || l.p.sku || 'Produto do Full', texto: P.acaoFull(l) }));
        (adsEq || []).filter(x => x.acima).forEach(x => itens.push({ tipo: 'ads', titulo: x.a.titulo || (x.it && x.it.titulo) || x.a.itemId,
            texto: `Ads acima do equilíbrio: ${x.acos !== null ? 'ACOS ' + SHC.pctTxt(x.acos) + ' (o Ads levou essa parte do que vendeu)' : 'gastou ' + SHC.moeda(x.a.gasto) + ' sem venda pelo Ads'}; ${x.margem > 0 ? 'sua margem antes do Ads é ' + SHC.pctTxt(x.margem) + '. Suba o ROAS objetivo da campanha ou tire este anúncio dela' : 'o anúncio já dá prejuízo antes do Ads. Tire este anúncio da campanha ou reveja o preço'} no Mercado Ads.` }));
        const n = t => itens.filter(i => i.tipo === t).length;
        return { itens, conta: n('conta'), full: n('full'), ads: n('ads'), saude: n('fiscal') + n('visitas') + n('medidas') + n('medmud'), total: itens.length };
    };

    // ── Saúde dos anúncios (fiscal:/fotos:/visitas:/robo:<conta>, lidos pelo fundo; null = ainda não lido) ──
    const milhar = P.milhar = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    // -35.2 → '−35%', 12 → '+12%', null → ''
    P.varPct = v => (typeof v !== 'number' || !isFinite(v) ? '' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.round(Math.abs(v)) + '%');
    // Sem dados fiscais → { n (linhas do ML; null = não lido), lista:[{itemId, titulo}], familias, completo }
    P.saudeFiscal = function (fiscal, itens) {
        if (!fiscal || typeof fiscal.total !== 'number') return { n: null, lista: [], familias: 0, completo: false };
        const tit = {};
        (itens || []).forEach(i => { if (i && i.itemId && !tit[i.itemId]) tit[i.itemId] = i.titulo || ''; });
        return { n: fiscal.total, lista: (fiscal.itens || []).map(id => ({ itemId: id, titulo: tit[id] || '' })), familias: (fiscal.familias || []).length, completo: !!fiscal.completo };
    };
    P.FAIXAS_FOTOS = [['f1', '1 foto', 1, 1], ['f2', '2 a 4', 2, 4], ['f5', '5 a 8', 5, 8], ['f9', '9 a 12', 9, Infinity]];
    P.fotosTxt = f => (f.max ? f.qtd + ' de ' + f.max + ' fotos' : SHC.qtd(f.qtd, 'foto', 'fotos'));
    // Fotos dos anúncios ATIVOS → { faixas:{f1:[…], f2, f5, f9}, marcadas:[{itemId, titulo, qtd, max, problemas}], lidos, de }. Sem leitura = fora (nunca "0 fotos").
    P.resumoFotos = function (fotos, itens) {
        const por = (fotos && fotos.porItem) || {}, faixas = {}, marcadas = [], vistos = new Set();
        let lidos = 0, de = 0;
        P.FAIXAS_FOTOS.forEach(x => { faixas[x[0]] = []; });
        (itens || []).filter(SHC.anuncioAtivo).forEach(it => {
            if (vistos.has(it.itemId)) return;
            vistos.add(it.itemId); de++;
            const f = por[it.itemId];
            if (!f || !(f.qtd > 0)) return;
            lidos++;
            const l = { itemId: it.itemId, titulo: it.titulo || '', qtd: f.qtd, max: f.max || null, problemas: f.problemas > 0 ? f.problemas : 0 };
            faixas[P.FAIXAS_FOTOS.find(x => l.qtd >= x[2] && l.qtd <= x[3])[0]].push(l);
            if (l.problemas) marcadas.push(l);
        });
        return { faixas, marcadas, lidos, de };
    };
    // Radar dos anúncios com visitas lidas → { caindo (maior queda primeiro), estavel, subindo, poucos: [{itemId, titulo, r}], lidos }
    P.radarLista = function (visitas, itens, cfg, hoje) {
        const por = (visitas && visitas.porItem) || {}, out = { caindo: [], estavel: [], subindo: [], poucos: [], lidos: 0 }, vistos = new Set();
        (itens || []).forEach(it => {
            if (!it || vistos.has(it.itemId) || !por[it.itemId]) return;
            vistos.add(it.itemId); out.lidos++;
            const r = SHC.radarVisitas(por[it.itemId].dias, hoje, cfg && cfg.radar_queda_pct);
            out[r.classe].push({ itemId: it.itemId, titulo: it.titulo || '', r });
        });
        const v = x => (x.r.variacaoPct === null ? Infinity : x.r.variacaoPct);
        out.caindo.sort((a, b) => v(a) - v(b));
        out.subindo.sort((a, b) => v(b) - v(a));
        return out;
    };
    // Resultado de uma troca de fotos (robo:<conta>.historico): 7 dias antes × 7 dias depois (SHC.efeitoMudanca).
    P.efeitoTxt = function (h, dias, hoje) {
        const e = SHC.efeitoMudanca(h.ts, dias, hoje);
        if (!e.pronto) return 'Medindo: o resultado aparece 7 dias depois da troca.';
        return `Antes: ${milhar(e.antes7)} visitas/7 dias · Depois: ${milhar(e.depois7)}${e.variacaoPct !== null ? ' (' + P.varPct(e.variacaoPct) + ')' : ''}`;
    };
    // "Já troquei": registra a troca feita pelo seller no ML (resultado 'manual', para medir o efeito) e tira a sugestão. → robo novo
    P.jaTroquei = (robo, itemId, antes, depois, ult7, agora) => Object.assign({}, robo || {}, {
        historico: ((robo && robo.historico) || []).concat([{ ts: agora, itemId, antes: (antes || []).slice(), depois: (depois || []).slice(),
            motivo: 'Você trocou a ordem das fotos no Mercado Livre.', visitas7Antes: typeof ult7 === 'number' ? ult7 : null, resultado: 'manual' }]).slice(-500),
        sugestoes: ((robo && robo.sugestoes) || []).filter(s => s && s.itemId !== itemId),
    });
    // "Desfazer" só com a escrita conferida, na última troca do robô que chegou ao ML neste anúncio (ok ou incerto).
    P.podeDesfazer = function (historico, h) {
        if (SHC.ROBO_ESCRITA_CONFERIDA !== true || !SHC.roboGravou(h) || h.desfazer) return false;
        const doItem = (historico || []).filter(x => x && x.itemId === h.itemId && (SHC.roboGravou(x) || x.resultado === 'manual'));
        return doItem[doItem.length - 1] === h;
    };
    P.historicoTxt = h => (h.resultado === 'manual' ? 'Você trocou a ordem das fotos' : h.resultado === 'ok' ? (h.desfazer ? 'Troca desfeita' : 'O robô trocou a ordem das fotos (a capa ficou)')
        : h.resultado === 'incerto' ? (h.desfazer ? 'O robô tentou desfazer a troca' : 'O robô tentou trocar a ordem das fotos (a capa fica)') + ', mas não deu para confirmar. Confira as fotos no Mercado Livre.'
        : 'O robô não trocou' + (h.erro ? ': ' + h.erro : '.'));
    // ── Medidas da embalagem (medidas:<conta>, lidas pelo fundo na tela "Alterar anúncio"; null = ainda não lido) ──
    P.MED_DIAS = 30;   // mudança feita pelo ML nos últimos 30 dias: cartão, etiqueta na lista e alerta
    P.medLink = id => 'https://vendedores.mercadolivre.com.br/syi/core/modify?itemId=' + id;
    // Unidades vendidas por anúncio (vm|ml, soma dos meses) → {MLB: n}: desempata a medida de referência pelo anúncio que mais vende.
    P.vendasUn = vm => Object.keys(vm || {}).reduce((o, id) => { o[id] = Object.keys(vm[id] || {}).reduce((s, m) => s + (+vm[id][m] || 0), 0); return o; }, {});
    // Diferença que muda o peso considerado (o que conta no frete): só essas entram no alerta e no número do ícone.
    P.medPesa = g => g.maiorDiferencaKg >= 0.01;
    // → { lidos, de (anúncios ativos), div (SKUs com medidas diferentes), mud (mudanças dos últimos 30 dias que não foram do seller), porItem }
    // vm = vm|ml por anúncio; opc.erpDe = (sku) → medida do ERP | null (diz se a mudança foi do ML e qual é a medida certa).
    P.resumoMedidas = function (medidas, itens, vm, agora, opc) {
        const porItem = (medidas && medidas.porItem) || {}, vistos = new Set();
        let lidos = 0, de = 0;
        (itens || []).filter(SHC.anuncioAtivo).forEach(it => {
            if (vistos.has(it.itemId)) return;
            vistos.add(it.itemId); de++;
            if (porItem[it.itemId] && porItem[it.itemId].atual) lidos++;
        });
        return { lidos, de, porItem, div: SHC.medidasDivergentes(porItem, itens, { vendas: P.vendasUn(vm) }),
            mud: SHC.medidasMudadas(porItem, (agora || Date.now()) - P.MED_DIAS * 864e5, { erpDe: (opc || {}).erpDe }) };
    };
    P.kgTxt = n => String(Math.round(n * 1000) / 1000).replace('.', ',') + ' kg';
    P.cmTxt = m => m.ordenadas.slice().reverse().map(v => String(v).replace('.', ',')).join('×') + ' cm';

    // ── Full (ml:full:<sellerId> = saída de SHC.mlFullDoEstado, lida pelo fundo) ──
    // "100 un.", "1.234 un.", 12 → número; sem número → null.
    P.un = v => { if (typeof v === 'number') return isFinite(v) ? v : null; const m = /-?\d[\d.]*/.exec(String(v === null || v === undefined ? '' : v)); return m ? +m[0].replace(/\./g, '') : null; };
    const semAcento = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    P.normTitulo = t => SHC.normalizaTitulo ? SHC.normalizaTitulo(t) : semAcento(t).replace(/[^a-z0-9]+/g, ' ').trim();
    // Mês que mais pesa nos próximos 30 dias (hoje + 15 dias), um ano antes: 24/09/2026 → '2025-10'.
    P.mesAnoPassado = hoje => P.mesMenos(new Date(Date.parse(hoje + 'T12:00:00Z') + 15 * 864e5).toISOString().slice(0, 7), 12);
    // Previsão de 30 dias = o maior entre as vendas dos últimos 30 dias (ML) e as do mesmo mês do ano passado (vm|ml).
    // Campo que o ML não mostrou fica null (não vira 0): sem os dois números → qtd null (sem sugestão).
    // lidos = meses lidos inteiros no Faturamento (ml:cobrancas mesesLidos): lá, mês sem a chave no vm = 0 vendas.
    P.previsaoFull = function (vendas30, vm, hoje, lidos) {
        const u = P.un(vendas30), ult30 = u === null ? null : Math.max(0, u), mes = P.mesAnoPassado(hoje);
        const a = vm && vm[mes] !== undefined && vm[mes] !== null ? P.un(vm[mes]) : (vm && (lidos || []).indexOf(mes) >= 0 ? 0 : null), ano = a === null ? null : Math.max(0, a);
        const qtd = ult30 === null && ano === null ? null : Math.max(ult30 || 0, ano || 0);
        return { qtd, fonte: ano !== null && (ult30 === null || ano > ult30) ? 'anoPassado' : 'ult30', ult30, mes, anoPassado: ano };
    };
    // Soma {'AAAA-MM': n} de vários anúncios do mesmo produto.
    P.somaMeses = lista => (lista || []).reduce((o, vm) => { Object.keys(vm || {}).forEach(m => { o[m] = (o[m] || 0) + (P.un(vm[m]) || 0); }); return o; }, {});
    // Tamanho do produto ("MÉDIO") → segmento cujo título tem a palavra ("Pequenos e médios"). 1 segmento só → ele. Sem par → null.
    P.segmentoDe = function (tamanho, espaco) {
        const esp = espaco || [], t = semAcento(tamanho).trim();
        if (esp.length === 1) return esp[0].id;
        const s = t && esp.find(e => semAcento(e.titulo).split(/[^a-z]+/).some(w => w && w.replace(/s$/, '') === t));
        return s ? s.id : null;
    };
    // Plano de envio (estimativa). ctx = {hoje, dias (cobertura), vmDe(p) → {'AAAA-MM': n} | null, idsDe(p)? → [MLB],
    // mesesLidos?, lucroDe(p) → sobra por unidade | null | {lucro, motivo:'sem_anuncio'|'sem_custo'|'sem_preco'}}.
    // Quantidade = previsão × dias ÷ 30 − (aptas + a caminho), nunca negativa, e o espaço livre do segmento é dividido
    // na ordem de prioridade: quem vai enviar antes de quem não precisa; prejuízo no fim; depois quem acaba antes
    // (faixas de até 7, 15, 30 e 60 dias); na mesma faixa, quem dá mais lucro por unidade.
    // Sem aptas ou sem vendas (30 dias e ano passado) → qtd null (sem sugestão, semDado diz o campo); a caminho sem número = 0 (dito).
    // Variações do mesmo anúncio (mesmos MLB): o vm|ml é do anúncio inteiro → cada variação fica com a parte dela nas vendas
    // de 30 dias; sem essa parte, o ano passado não entra.
    const FAIXAS = [7, 15, 30, 60];
    P.planoFull = function (full, ctx) {
        const dias = ctx.dias > 0 ? ctx.dias : 30, livre = {}, esp = (full && full.espaco) || [], prods = (full && full.produtos) || [];
        esp.forEach(e => { const l = P.un(e.livre); if (l !== null) livre[e.id] = Math.max(0, l); });
        const temLivre = Object.keys(livre).length > 0, idsDe = ctx.idsDe || P.idsDoFull, irmaos = {};
        const chave = p => idsDe(p).slice().sort().join(',');
        prods.forEach(p => { const k = chave(p); if (k) (irmaos[k] || (irmaos[k] = [])).push(p); });
        const linhas = prods.map(p => {
            const ir = irmaos[chave(p)] || [];
            let vm = ctx.vmDe(p), parte = null;
            if (ir.length > 1) {
                const tot = ir.reduce((a, q) => a + Math.max(0, P.un(q.vendas30) || 0), 0), u = P.un(p.vendas30);
                parte = { n: ir.length, pct: tot > 0 && u !== null ? Math.max(0, u) / tot * 100 : null };
                vm = parte.pct === null ? null : Object.keys(vm || {}).reduce((o, m) => { const v = P.un(vm[m]); if (v !== null) o[m] = Math.round(v * parte.pct / 100); return o; }, {});
            }
            const prev = Object.assign(P.previsaoFull(p.vendas30, vm, ctx.hoje, ctx.mesesLidos), { parte });
            const ua = P.un(p.aptas), uc = P.un(p.aCaminho);
            const semDado = [ua === null ? 'as unidades aptas' : '', prev.qtd === null ? 'as vendas dos últimos 30 dias' : ''].filter(Boolean);
            const aptas = ua === null ? null : Math.max(0, ua), aCaminho = uc === null ? 0 : Math.max(0, uc);
            const alvo = semDado.length ? null : Math.ceil(prev.qtd * dias / 30 - 1e-9), bruto = semDado.length ? null : Math.max(0, alvo - aptas - aCaminho);
            const lx = ctx.lucroDe(p), lo = lx !== null && typeof lx === 'object' ? lx : { lucro: lx === undefined ? null : lx, motivo: '' };
            const lucro = lo.lucro === undefined ? null : lo.lucro, seg = P.segmentoDe(p.tamanho, esp);
            return { p, prev, aptas, aCaminho, semCaminho: uc === null, semDado, alvo, bruto, qtd: bruto, limitado: false, lucro,
                motivoLucro: lucro === null ? (lo.motivo || 'sem_custo') : '', semAnuncio: lo.motivo === 'sem_anuncio', seg, semSegmento: seg === null && temLivre,
                segTitulo: seg !== null ? String((esp.find(e => e.id === seg) || {}).titulo || '').replace(/:.*$/, '') : '',
                esgota: !semDado.length && prev.qtd > 0 ? Math.floor((aptas + aCaminho) / (prev.qtd / 30)) : null };
        });
        const faixa = l => l.esgota === null ? FAIXAS.length + 1 : FAIXAS.filter(f => l.esgota > f).length;
        const lu = l => l.lucro === null ? -1e9 : l.lucro, ruim = l => l.lucro !== null && l.lucro < 0;
        linhas.sort((a, b) => ((b.bruto > 0) - (a.bruto > 0)) || (ruim(a) - ruim(b)) || (faixa(a) - faixa(b)) || (lu(b) - lu(a)));
        linhas.forEach(l => {
            if (l.qtd === null || l.seg === null || livre[l.seg] === undefined) return;
            l.livreAntes = livre[l.seg]; l.qtd = Math.min(l.bruto, livre[l.seg]); livre[l.seg] -= l.qtd; l.limitado = l.qtd < l.bruto;
        });
        return { linhas, livre, dias };
    };
    // Anúncios do retrato que são este produto do Full: pelos MLB (quando o ML traz) ou pelo SKU; sem os dois, pelo título.
    P.idsDoFull = p => [...new Set([].concat(p.itemIds || [], p.itemId ? [p.itemId] : []).filter(Boolean))];
    P.anunciosDoFull = function (p, itens) {
        const sku = SHC.normalizaSku(p.sku || ''), tn = P.normTitulo(p.titulo), ids = P.idsDoFull(p);
        const r = (itens || []).filter(it => ids.indexOf(it.itemId) >= 0 || (sku && SHC.normalizaSku(it.sku) === sku));
        return r.length || !tn || sku || ids.length ? r : (itens || []).filter(it => P.normTitulo(it.titulo) === tn);
    };
    P.explicaFull = function (l, dias) {
        const x = l.prev, nm = P.nomeMes(x.mes), out = [], p = l.p || {};
        const naoLido = l.semAnuncio ? '' : ` As vendas de ${nm} ainda não foram lidas.`;
        if (l.semAnuncio) out.push(`Não achei o anúncio deste produto na sua lista${p.sku ? ' (SKU ' + p.sku + ')' : ''}: sem lucro e sem vendas do ano passado.`);
        if (x.ult30 === null && x.anoPassado === null) out.push('O ML não mostrou as vendas dos últimos 30 dias deste produto.' + naoLido);
        else if (x.ult30 === null) out.push(`O ML não mostrou as vendas dos últimos 30 dias deste produto. Em ${nm} você vendeu ${x.anoPassado}: usei ${nm}, o mesmo mês do ano passado.`);
        else if (x.anoPassado === null) out.push(`Nos últimos 30 dias você vendeu ${x.ult30}.${naoLido} Usei os últimos 30 dias.`);
        else if (x.fonte === 'anoPassado') out.push(`Em ${nm} você vendeu ${x.anoPassado}, mais que nos últimos 30 dias (${x.ult30}). Usei ${nm}, o mesmo mês do ano passado.`);
        else out.push(`Nos últimos 30 dias você vendeu ${x.ult30}; em ${nm}, ${x.anoPassado}. Usei o maior: ${x.ult30}.`);
        if (x.parte) out.push(x.parte.pct === null
            ? `Este anúncio tem ${x.parte.n} variações no Full e as vendas por mês são do anúncio inteiro. Sem vendas nos últimos 30 dias para dividir entre elas, não usei o ano passado.`
            : `Este anúncio tem ${x.parte.n} variações no Full e as vendas por mês são do anúncio inteiro: esta variação ficou com ${SHC.pctTxt(x.parte.pct)}, a parte dela nas vendas dos últimos 30 dias.`);
        if (l.semDado && l.semDado.length) out.push(`Sem sugestão: o ML não mostrou ${l.semDado.join(' nem ')} deste produto.`);
        else {
            const conta = x.qtd * dias / 30;
            out.push(`Para ${dias} dias: ${x.qtd} × ${dias} ÷ 30 = ${l.alvo}${Number.isInteger(SHC.r2(conta)) ? '' : ' (arredondado para cima)'}; menos ${l.aptas} aptas e ${l.aCaminho} a caminho = ${l.bruto}.`
                + (l.semCaminho ? ' O ML não mostrou quantas estão a caminho: contei 0.' : ''));
        }
        if (l.limitado) out.push(`O espaço livre${l.segTitulo ? ' de ' + l.segTitulo : ''} que sobra para este produto é ${l.livreAntes} un.: você pode enviar até ${l.qtd}.`);
        if (l.semSegmento) out.push(`Não sei em qual espaço do Full este produto entra (${p.tamanho ? 'tamanho “' + p.tamanho + '”' : 'o ML não mostrou o tamanho'}): a quantidade não considera o limite de espaço.`);
        if (!l.semAnuncio) out.push(l.lucro !== null ? (l.lucro < 0 ? `Dá prejuízo de ${SHC.moeda(-l.lucro)} por unidade no preço de hoje: fica no fim da fila.` : `Lucro por unidade no preço de hoje: ${SHC.moeda(l.lucro)}.`)
            : (l.motivoLucro === 'sem_preco' ? 'O anúncio deste produto está sem preço na lista: sem lucro por unidade para a ordem.' : 'Sem custo deste produto: informe no Catálogo para eu considerar o lucro na ordem.'));
        return { linhas: out, fonte: 'Estimativa do Copiloto, não é garantia de venda. Vendas, estoque e espaço = Mercado Livre · custo = seu.' };
    };

    // Frete da lista (V9): anúncio com "Envio por conta do comprador" (freteComprador) entra sem histórico nem subida.
    // v2.5.3: pa = frete:<conta>:hist.porAnuncio (frete COBRADO nos pedidos, Faturamento) → l.fa; "subiu" = subiu no cobrado OU na lista.
    P.linhasFrete = (itens, fretes, pa) => (itens || []).map(it => Object.assign(it.freteComprador
        ? { it, h: null, hoje: 0, subiu: false, comprador: true }
        : { it, h: P.historicoFrete((fretes || {})[it.itemId]) }, { fa: (pa && pa[it.itemId]) || null }))
        .filter(l => l.comprador || l.it.frete > 0 || l.h || l.fa)
        .map(l => l.comprador ? l : Object.assign(l, { hoje: l.it.frete !== null && l.it.frete !== undefined ? l.it.frete : (l.h ? l.h.atual : null),
            subiu: !!(l.h && l.h.anterior !== null && l.h.atual > l.h.anterior) || !!(l.fa && l.fa.subiu) }));

    // Sincronização presa (V17): "sincronizando" sem batimento há mais de 5 min = abandonada (o Chrome fechou no meio).
    P.syncParado = (st, agora) => !!st && (st.estado === 'sincronizando' || st.sincronizando === true) && (agora || Date.now()) - (st.batimento || st.inicio || 0) > 5 * 60000;
    // Partes que a última sincronização não conseguiu ler (gravadas no status pelo fundo).
    P.avisosLeitura = st => [['erroPromos', 'promoções'], ['erroCobrancas', 'Faturamento'], ['erroFull', 'Full'], ['erroAds', 'Mercado Ads']]
        .filter(([k]) => st && st[k]).map(([, t]) => t);

    // Cor do anúncio na aba Frete. s = SHC.sobraAnuncio (null = sem custo/preço).
    // ruim (vermelho): frete subiu (mais de R$ 1 e 2%) e/ou dá prejuízo · atencao (amarelo): subiu pouco ou sem custo · ok (verde).
    P.situacaoFrete = function (l, s) {
        const prejuizo = !!(s && s.sobra !== null && s.sobra < 0), semCusto = !(s && s.sobra !== null);
        const muito = !!(l && l.subiu && ((l.fa && l.fa.subiu) || (l.h && subiu(l.h.atual, l.h.anterior))));   // fa.subiu já é "mais de R$ 1 e 2%"
        if (muito || prejuizo) return 'ruim';
        if ((l && l.subiu) || semCusto) return 'atencao';
        return 'ok';
    };
    // Etapa 'faturamento' do status → "vendas: lendo mês 5 de 12 (falta cerca de 3 min)" | "vendas: 12 de 12 meses lidos" | ''.
    P.vendasAndamento = function (st, agora) {
        const e = st && st.etapas && st.etapas.faturamento;
        if (!e) return '';
        if (e.estado === 'lendo') {
            const s = SHC.statusSync(st, agora), c = e.de > 0 ? ` ${e.unidade === 'meses' ? 'mês' : 'parte'} ${Math.min(e.de, (e.feito || 0) + 1)} de ${e.de}` : '';
            return `vendas: lendo${c}${s.estado === 'sincronizando' && s.restante ? ' (' + s.restante + ')' : ''}`;
        }
        if (e.estado === 'ok') return 'vendas: ' + (e.resumo || 'lidas');
        if (e.estado === 'erro') return 'vendas: não li agora, tento de novo na próxima leitura';
        return e.estado === 'fila' ? 'vendas: na fila' : '';
    };
    // Anúncio sem vendas lidas: por que ainda não tem. → texto | '' (Faturamento já lido).
    P.esperaVendas = function (st, agora) {
        const e = st && st.etapas && st.etapas.faturamento;
        if (e && e.estado === 'ok') return '';
        const ets = SHC.SYNC_ETAPAS || [], k = ets.findIndex(x => x.id === 'faturamento') + 1, s = SHC.statusSync(st, agora);
        const falta = s.estado === 'sincronizando' && /falta|menos/.test(s.restante || '') ? ' · ' + s.restante : '';
        return 'As vendas deste anúncio aparecem quando o Faturamento for lido' + (k > 0 ? ` (etapa ${k} de ${ets.length}${falta})` : '') + '.';
    };
    // Pedido a pedido (mais recente primeiro). normal = frete do meio dos pedidos pagos por você; acima = mais de R$ 1 e 2% acima.
    P.pedidosFrete = function (vendas) {
        const todos = Object.keys(vendas || {}).map(o => Object.assign({ orderId: o }, vendas[o])).filter(v => v.d);
        const normal = mediana(todos.filter(v => !v.pc && v.f > 0).map(v => v.f));
        const lista = todos.map(v => ({ orderId: v.orderId, d: v.d, f: v.pc ? 0 : SHC.num(v.f) || 0, comprador: !!v.pc, acima: !v.pc && normal !== null && subiu(v.f, normal) }))
            .sort((a, b) => a.d < b.d ? 1 : (a.d > b.d ? -1 : 0));
        return { normal, lista, acima: lista.filter(p => p.acima).length };
    };

    // ── Ads de UM anúncio (cartão na aba Frete): 'ads:<conta>' → {noAds, status, campanha, m} ──
    const ESTRATEGIA = { PROFITABILITY: 'Rentabilidade', GROWTH: 'Crescimento', VISIBILITY: 'Visibilidade' };
    P.estrategiaTxt = e => ESTRATEGIA[String(e || '').toUpperCase()] || (e ? String(e).toLowerCase() : '');
    const ativoTxt = s => /^(a|active|ativo|ativa)$/i.test(String(s || '')) ? 'ativo' : (/^(p|paused|pausado|pausada)$/i.test(String(s || '')) ? 'pausado' : '');
    // Métricas somadas + razões: CTR, CPC, ROAS, ACOS (sem venda pelo Ads: ACOS null, nunca 0).
    const razoes = m => Object.assign(m, {
        ctr: m.impressoes > 0 && m.cliques !== null ? m.cliques / m.impressoes * 100 : null, cpc: m.cliques > 0 ? SHC.r2(m.gasto / m.cliques) : null,
        roas: m.gasto > 0 ? SHC.r2(m.receita / m.gasto) : null, acos: m.receita > 0 ? m.gasto / m.receita * 100 : null });
    P.adsDoItem = function (snap, itemId) {
        const todos = (snap && snap.anuncios) || [], brutos = todos.filter(a => { const x = P.adsDoAnuncio(a); return x && x.itemId === itemId; });
        if (!brutos.length) return { noAds: false, temCatalogo: todos.some(a => a && (a.catalogoProduto || a.type === 'catalog')) };
        const xs = brutos.map(P.adsDoAnuncio), soma = k => xs.some(x => x[k] !== null) ? SHC.r2(xs.reduce((t, x) => t + (x[k] || 0), 0)) : null;
        const cid = String(brutos[0].campanhaId || (brutos[0].campaign && brutos[0].campaign.id) || '');
        const c = ((snap && snap.campanhas) || []).find(k => String(k.id) === cid) || {};
        return { noAds: true, status: ativoTxt(brutos[0].status),
            campanha: { nome: c.nome || c.name || xs[0].campanha || '', estrategia: P.estrategiaTxt(c.estrategia || c.strategy), roasObjetivo: SHC.num(c.roasObjetivo !== undefined ? c.roasObjetivo : c.roasTarget), status: ativoTxt(c.status) },
            m: razoes({ gasto: soma('gasto') || 0, receita: soma('receita') || 0, vendas: soma('vendas') || 0, cliques: soma('cliques'), impressoes: soma('impressoes') }) };
    };
    // Compensa? eq = SHC.adsEquilibrio (ACOS de equilíbrio = margem antes do Ads) | null (sem custo).
    P.adsVeredito = function (m, eq) {
        if (!m || !(m.gasto > 0)) return { tipo: 'semGasto', texto: 'Sem gasto no período' };
        if (!eq) return { tipo: 'semCusto', texto: 'Informe o custo para saber se compensa' };
        if (m.acos !== null && m.acos < eq.equilibrio) return { tipo: 'compensa', texto: 'Compensa', det: `ACOS ${SHC.pctTxt(m.acos)}, abaixo do equilíbrio de ${SHC.pctTxt(eq.equilibrio)}: o Ads deixa lucro.` };
        return { tipo: 'nao', texto: 'Não compensa', det: m.acos === null ? `Gastou ${SHC.moeda(m.gasto)} sem venda pelo Ads.` : `ACOS ${SHC.pctTxt(m.acos)}, acima do equilíbrio de ${SHC.pctTxt(eq.equilibrio)}: o Ads leva mais do que sobra da venda.` };
    };
    // Visão geral da conta no Mercado Ads: resumo do ML (resumo.total) e, no que faltar, a soma dos anúncios.
    P.adsConta = function (snap) {
        if (!snap || snap.temAds === false) return null;
        const r = snap.resumo ? (snap.resumo.total || snap.resumo) : {}, as = snap.anuncios || [];
        const um = (ks) => { const v = numDe(r, ks); return v !== null ? v : (as.length ? SHC.r2(as.reduce((t, a) => t + (numDe(Object.assign({}, a.metrics || {}, a.metricas || {}, a), ks) || 0), 0)) : null); };
        const m = razoes({ gasto: um(['custo', 'cost', 'investimento', 'gasto']) || 0, receita: um(['receita', 'totalAmount', 'amountTotal']) || 0,
            vendas: um(['vendas', 'unitsQuantity', 'soldQuantityTotal', 'unidades']) || 0, cliques: um(['cliques', 'clicks']), impressoes: um(['impressoes', 'prints', 'impressions']) });
        m.tacos = numDe(r, ['tacos']);
        const ativas = (snap.campanhas || []).filter(c => ativoTxt(c.status) === 'ativo'), orc = ativas.map(orcDia).filter(v => v !== null);
        m.campanhasAtivas = ativas.length;
        m.orcamentoDia = orc.length ? SHC.r2(orc.reduce((t, v) => t + v, 0)) : null;   // orçamento diário somado das campanhas ativas
        m.vendasOrganicas = numDe(r, ['vendasOrganicas']);
        return m;
    };
    const orcDia = c => SHC.num(c.orcamentoDiario !== undefined && c.orcamentoDiario !== null ? c.orcamentoDiario : (c.dailyBudget !== undefined ? c.dailyBudget : c.orcamento));
    // Compensa? de um grupo de anúncios (campanha ou conta) pelo equilíbrio do Copiloto (P.adsEquilibrio): o Ads gastou menos que a
    // sobra das vendas que trouxe. Só os anúncios com custo entram; sem nenhum → 'semCusto'.
    P.adsVereditoDe = function (xs, gastoTotal) {
        const com = (xs || []).filter(x => !x.semCusto), sem = (xs || []).length - com.length;
        if (!(gastoTotal > 0)) return Object.assign(P.adsVeredito(null, null), { semCusto: sem });
        if (!com.length) return { tipo: 'semCusto', texto: 'Sem cálculo', semCusto: sem };
        const s = k => com.reduce((t, x) => t + (k === 'antes' ? x.antes : x.a[k]), 0), g = s('gasto'), r = s('receita');
        return Object.assign(P.adsVeredito(razoes({ gasto: g, receita: r, vendas: 0, cliques: null, impressoes: null }), { equilibrio: r > 0 ? s('antes') / r * 100 : 0 }), { semCusto: sem });
    };
    // Campanhas criadas: status, orçamento/dia, gasto, vendas, ACOS, nº de anúncios, perda de aparições e o selo compensa/não compensa.
    // Métricas: as da campanha no Mercado Ads; sem elas, a soma dos anúncios dela. eq = P.adsEquilibrio. Ativas primeiro, maior gasto.
    P.adsCampanhasLista = function (snap, eq) {
        if (!snap || snap.temAds === false) return [];
        const as = snap.anuncios || [];
        const cid = a => String(a.campanhaId || (a.campaign && a.campaign.id) || '');
        return (snap.campanhas || []).map(c => {
            const id = String(c.id), dela = as.filter(a => cid(a) === id), mt = c.metricas || c.metrics || null;
            const pega = ks => { const v = mt ? numDe(mt, ks) : null; return v !== null ? v : SHC.r2(dela.reduce((t, a) => t + (numDe(Object.assign({}, a.metrics || {}, a.metricas || {}, a), ks) || 0), 0)); };
            const m = razoes({ gasto: pega(['custo', 'cost']), receita: pega(['receita', 'totalAmount', 'amountTotal']), vendas: pega(['vendas', 'unitsQuantity', 'soldQuantityTotal']),
                cliques: pega(['cliques', 'clicks']), impressoes: pega(['impressoes', 'prints', 'impressions']) });
            const sh = c.share || null;
            return { id, nome: String(c.nome || c.name || 'Campanha ' + id), status: ativoTxt(c.status), statusBruto: String(c.status || ''), orcamentoDia: orcDia(c),
                estrategia: P.estrategiaTxt(c.estrategia || c.strategy), anuncios: dela.length, m,
                perdeOrcamento: sh ? SHC.num(sh.perdidasOrcamento) : null, perdeClassificacao: sh ? SHC.num(sh.perdidasClassificacao) : null,
                veredito: P.adsVereditoDe((eq || []).filter(x => x.a.campanhaId === id), m.gasto) };
        }).sort((x, y) => ((y.status === 'ativo') - (x.status === 'ativo')) || (y.m.gasto - x.m.gasto));
    };
    // Filtros do "Ver por produto" sobre P.adsEquilibrio. Escalar = ACOS até 60% da folga (equilíbrio − meta), com venda.
    P.adsFiltros = function (lista, meta) {
        const mt = SHC.num(meta) || 0;
        return {
            acima: lista.filter(x => x.acima),
            escalar: lista.filter(x => !x.semCusto && !x.acima && x.acos !== null && x.a.vendas > 0 && x.margem - mt > 0 && x.acos <= (x.margem - mt) * 0.6),
            semVenda: lista.filter(x => !(x.a.vendas > 0)),
            semCusto: lista.filter(x => x.semCusto),
        };
    };

    // ── Afiliados (afil:<conta>, etapa 'afiliados'): só leitura. Com a lista da campanha lida só em parte (completo !== true), não
    // afirma "fora da campanha". Nomes de afiliados nunca chegam aqui (o fundo não guarda). ──
    const ehAtivo = it => /^(ativo|ativa|active)$/i.test(String((it && it.status) || ''));
    const nulo = v => v === null || v === undefined;
    /**
     * Aba Afiliados → { estado 'sem_dado'|'nao_usa'|'ok', vendas, unidades, qtdVendas, custo, roi, atualizado, naCampanha, comissao, faixa,
     * entradaAutomatica, status, inicio, lidos, listaInteira, pausados, encerrados, comExtra[], fora[] | null, top[], porProduto[], semVenda[],
     * pedidos (soma por SKU/situação | null), comeLucro[{ it, p, titulo, pct, comissaoUn, sobra, depois }] }.
     * sobraDe(it) → { sobra } (SHC.sobraAnuncio do painel); comissão por venda = preço × % da campanha (a do produto, ou a geral).
     */
    P.afilCartao = function (a, itens, sobraDe) {
        if (!a) return { estado: 'sem_dado' };
        if (!a.temAfiliados) return { estado: 'nao_usa' };
        const c = a.campanha || {}, m = a.metricas || {}, prods = c.produtos || [], naCamp = new Set(prods.map(p => p.itemId));
        const listaInteira = c.completo === true, vistos = new Set(), reais = P.anunciosReais(itens || []);
        const fora = listaInteira ? reais.filter(it => it.itemId && ehAtivo(it) && !naCamp.has(it.itemId) && !vistos.has(it.itemId) && vistos.add(it.itemId)) : null;
        const porProduto = (m.porProduto || []).slice().sort((x, y) => (y.vendas || 0) - (x.vendas || 0));
        const top = porProduto.filter(p => p.vendas > 0 || p.unidades > 0);
        const semVenda = porProduto.filter(p => p.cliques > 0 && !(p.vendas > 0) && !(p.unidades > 0)).sort((x, y) => y.cliques - x.cliques);
        const geral = nulo(c.comissaoGeral) ? null : c.comissaoGeral;
        // Fora da campanha o ML não cobra comissão: com a lista inteira, só quem está nela; com a lista em parte, também quem teve comissão estimada.
        const comCusto = new Set(porProduto.filter(p => p.custoEstimado > 0).map(p => p.itemId));
        const pctDe = id => { const p = prods.find(x => x.itemId === id); if (p) return !nulo(p.comissao) ? p.comissao : geral; return !listaInteira && comCusto.has(id) ? geral : null; };
        // Comissão come o lucro: anúncio ativo na campanha (ou que pagou comissão a afiliado) em que sobra − comissão < 0.
        const alvo = new Set([...naCamp, ...comCusto]), porId = {};
        reais.forEach(it => { if (it.itemId && !porId[it.itemId]) porId[it.itemId] = it; });
        const comeLucro = !sobraDe ? [] : [...alvo].map(id => {
            const it = porId[id], pct = pctDe(id), s = it && ehAtivo(it) && it.preco > 0 && !nulo(pct) ? sobraDe(it) : null;
            if (!s || nulo(s.sobra)) return null;
            const comissaoUn = SHC.r2(it.preco * pct / 100), depois = SHC.r2(s.sobra - comissaoUn);
            return depois < 0 ? { it, pct, titulo: it.titulo || id, comissaoUn, sobra: s.sobra, depois } : null;
        }).filter(Boolean).sort((x, y) => x.depois - y.depois);
        const pub = k => prods.filter(p => String(p.publicacao || '').toUpperCase() === k).length;
        return { estado: 'ok', vendas: nulo(m.vendas) ? null : m.vendas, unidades: nulo(m.unidades) ? null : m.unidades, qtdVendas: nulo(m.qtdVendas) ? null : m.qtdVendas,
            custo: nulo(m.custoEstimado) ? null : m.custoEstimado, atualizado: m.ultimaAtualizacao || null, metricasInteiras: m.completo !== false,
            roi: m.custoEstimado > 0 && !nulo(m.vendas) ? SHC.r2(m.vendas / m.custoEstimado) : null,
            naCampanha: nulo(c.totalProdutos) ? prods.length : c.totalProdutos, comissao: geral, faixa: c.faixa || null,
            entradaAutomatica: nulo(c.entradaAutomatica) ? null : c.entradaAutomatica, status: c.status || null, inicio: c.inicio || null,
            lidos: prods.length, listaInteira, pausados: pub('PAUSED'), encerrados: pub('CLOSED') + pub('INACTIVE'),
            comExtra: geral === null ? [] : prods.filter(p => !nulo(p.comissao) && p.comissao > geral).sort((x, y) => y.comissao - x.comissao),
            fora, top, porProduto, semVenda, pedidos: a.pedidos || null, comeLucro };
    };
    /** Produtos da campanha cujo anúncio não está à venda (pausado, encerrado ou inativo). */
    P.anunciosAfilParados = a => ((a && a.campanha && a.campanha.produtos) || []).filter(p => /^(PAUSED|CLOSED|INACTIVE)$/i.test(p.publicacao || ''));
    /** Linha do anúncio: "Afiliados: na campanha (4%) · 1 venda em 30 dias" | "Afiliados: fora da campanha" | null (nada certo a dizer). */
    P.afilDoItem = function (a, itemId) {
        if (!a) return null;
        if (!a.temAfiliados) return 'Afiliados: esta conta não usa';
        const c = a.campanha || {}, m = a.metricas || {};
        const p = (c.produtos || []).find(x => x.itemId === itemId), mp = (m.porProduto || []).find(x => x.itemId === itemId);
        const pct = p && !nulo(p.comissao) ? p.comissao : c.comissaoGeral;
        const camp = p ? 'na campanha' + (nulo(pct) ? '' : ' (' + SHC.pctTxt(pct) + ')') : (c.completo === true ? 'fora da campanha' : '');
        const n = mp ? (mp.qtdVendas || 0) : (Array.isArray(m.porProduto) && m.completo !== false ? 0 : null);
        const vend = nulo(n) ? '' : (n > 0 ? SHC.qtd(n, 'venda', 'vendas') + ' em 30 dias' : 'nenhuma venda em 30 dias');
        if (!camp && !(n > 0)) return null;
        return 'Afiliados: ' + [camp, vend].filter(Boolean).join(' · ');
    };
    /**
     * Simulador de custos do ML (sim:<conta>:<MLB>, até 7 dias): se o "Você recebe" do ML não bate com o do Copiloto (mesmo preço),
     * o painel passa a usar o do ML. → o mesmo item | cópia com recebe do ML e recebeCopiloto (o calculado antes).
     */
    P.comSimulador = function (it, sim, agora) {
        if (!it || !sim || !sim.hoje || !(agora - sim.ts < 7 * 864e5)) return it;
        const cf = SHC.simConfere(sim.hoje, it.recebe, it.preco);
        return cf && cf.bate === false ? Object.assign({}, it, { recebe: cf.recebe, recebeCopiloto: it.recebe }) : it;
    };

    // Catálogo: SKUs sem custo, os que mais vendem primeiro (vm|ml de todos os anúncios do SKU). → [{g, r, vendas}]
    // o = {desde: 'AAAA-MM' (só vendas desse mês em diante), temCusto: g => bool} — a mesma conta do guia (SHC.guiaCustos),
    // para o Catálogo e o "Próximo passo" pedirem os mesmos SKUs. Sem o: classe 'sem_custo' e todos os meses.
    P.semCustoTop = function (resumos, vm, o) {
        o = o || {};
        const semCusto = o.temCusto ? x => !o.temCusto(x.g) : x => x.r.classe === 'sem_custo';
        const soma = v => Object.keys(v).reduce((a, m) => a + (!o.desde || m >= o.desde ? P.un(v[m]) || 0 : 0), 0);
        return (resumos || []).filter(semCusto)
            .map(x => Object.assign({ vendas: x.g.itens.reduce((t, it) => t + soma((vm || {})[it.itemId] || {}), 0) }, x))
            .sort((a, b) => (b.vendas - a.vendas) || String(a.g.titulo).localeCompare(String(b.g.titulo), 'pt-BR'));
    };

    // Barra "Importando do Tiny: 120 de 253 SKUs" (shc:status.custosProgresso = {erp, feito, de, unidade?}); '' sem importação.
    P.textoImportando = function (p) {
        if (!p || !p.erp) return '';
        const nome = p.erp === 'omie' ? 'Omie' : (p.erp === 'tiny' ? 'Tiny' : String(p.erp));
        return 'Importando do ' + nome + (p.de > 0 ? ': ' + (p.feito || 0) + ' de ' + p.de + ' ' + (p.unidade || 'SKUs') : '…');
    };
    // Remessas ao Full (ml:full:remessas:<conta>): as últimas, multas, problemas e o frete de reposição do mês (porMes[mes].custo).
    // → { ultimas:[{id, statusTexto, quando, unidades, custo, multa, problemas:[texto]}], freteMes, multasMes, n } | null
    P.resumoRemessas = function (rem, mes) {
        if (!rem || !Array.isArray(rem.remessas) || !rem.remessas.length) return null;
        const quando = r => r.recebida || r.agendada || r.atualizada || '';
        const probs = r => { const p = r.problemas || {}, o = []; if (p.identificacao) o.push('problema de identificação'); if (p.fiscal) o.push('problema fiscal'); if (p.semSolucao) o.push('problema sem solução'); return o; };
        const ultimas = rem.remessas.slice().sort((a, b) => (quando(b) > quando(a) ? 1 : (quando(b) < quando(a) ? -1 : 0))).slice(0, 5)
            .map(r => ({ id: r.id, statusTexto: r.statusTexto || r.status || '', quando: quando(r), unidades: r.unidades, custo: r.custo || 0, multa: r.multa || 0, problemas: probs(r) }));
        const m = (rem.porMes || {})[mes] || {};
        return { ultimas, freteMes: m.custo || 0, multasMes: m.multas || 0, n: rem.total !== null && rem.total !== undefined ? rem.total : rem.remessas.length };
    };

    // Competição no catálogo (retrato da lista de Anúncios): competicao 'ganhando'|'perdendo'|'restrito'|'dividindo'|'competindo' (antigo)
    // e competicaoMotivo 'preco'|'entrega'|'outro'. Grupos da tela: ganhando · preco · entrega (inclui restrito) · dividindo · outros.
    P.GRUPOS_COMP = [['ganhando', 'Ganhando', 'l'], ['preco', 'Perdendo por preço', 'p'], ['entrega', 'Perdendo pela entrega / Restrito', 'p'], ['dividindo', 'Dividindo o 1º lugar', 'a'], ['outros', 'Outros', 'n']];
    P.grupoComp = function (it) {
        const e = String((it && it.competicao) || ''), m = String((it && it.competicaoMotivo) || '');
        if (!e) return '';
        if (e === 'ganhando' || e === 'dividindo') return e;
        if (e === 'restrito' || (e === 'perdendo' && m === 'entrega')) return 'entrega';
        return e === 'perdendo' && m === 'preco' ? 'preco' : 'outros';
    };
    P.resumoCompeticao = function (itens) {
        const r = { ganhando: [], perdendo: [], competindo: [], temDado: false, grupos: {} };
        P.GRUPOS_COMP.forEach(([k]) => { r.grupos[k] = []; });
        P.anunciosReais(itens).forEach(it => {
            if (it.competicao !== undefined) r.temDado = true;
            if (r[it.competicao]) r[it.competicao].push(it);
            const g = P.grupoComp(it);
            if (g) r.grupos[g].push(it);
        });
        return r;
    };
    // "Perdendo há N dias" pelo histórico comp:<conta> (SHC.compResumo); sem histórico → "desde a última leitura".
    P.tempoPerdendo = function (res) {
        if (!res || !/^(perdendo|restrito)$/.test(res.estado)) return 'Perdendo desde a última leitura';
        if (res.dias < 1) return res.peloMenos ? 'Perdendo desde a última leitura' : 'Perdendo desde hoje';   // peloMenos: o histórico começou agora, não a perda
        return `Perdendo há ${res.peloMenos ? 'pelo menos ' : ''}${P.dias(res.dias)}`;
    };
    // Quem ganha × você (conc:<conta>:<MLB>). vencedor = o que o ML mostra como oferta principal; sem ele, o menor preço da lista.
    P.comparaConc = function (conc, seuPreco) {
        if (!conc || !(conc.ofertas || []).length) return null;
        const v = conc.vencedor || conc.ofertas.slice().sort((a, b) => (a.preco || 1e12) - (b.preco || 1e12))[0];
        const dif = seuPreco > 0 && v.preco > 0 ? SHC.r2(seuPreco - v.preco) : null;
        return { rotulo: conc.vencedor ? 'Quem está ganhando' : 'Menor preço no catálogo', v, dif, difPct: dif !== null ? dif / v.preco * 100 : null, ofertas: conc.ofertas.slice(0, 5) };
    };
    // Mesmo produto em contas diferentes deste Chrome: retratos = {sellerId: itens}. Agrupa por catálogo ("Sincronizado
    // com #…", quando o ML mostra o número), SKU, EAN (planilha do ERP: eanDe(sku)) e título normalizado; só fica o grupo
    // com anúncios de 2+ contas. Grupo contido num já mostrado (nessa ordem) não se repete.
    const ORDEM_COMP = ['catalogo', 'sku', 'ean', 'titulo'];
    P.contasCompetindo = function (retratos, contas, eanDe) {
        const nome = id => { const v = ((contas || {})[id] || {}).apelido; return v || 'ID …' + String(id || '').slice(-4); };
        const g = {};
        Object.keys(retratos || {}).forEach(conta => P.anunciosReais(retratos[conta]).forEach(it => {
            const ean = it.sku && eanDe ? eanDe(it.sku) : '', tn = P.normTitulo(it.titulo);
            [it.catalogo ? 'catalogo:' + it.catalogo : '', it.sku ? 'sku:' + it.sku : '', ean ? 'ean:' + ean : '', tn ? 'titulo:' + tn : ''].filter(Boolean).forEach(k => {
                const x = g[k] || (g[k] = { chave: k, tipo: k.split(':')[0], valor: k.slice(k.indexOf(':') + 1), titulo: it.titulo, itens: [] });
                x.itens.push({ conta, nomeConta: nome(conta), it });
            });
        }));
        // Grupos já mostrados por anúncio ('conta|MLB' → [Set]): cada anúncio está em até 4 grupos, então a busca é O(n).
        const dono = new Map();
        return Object.values(g).filter(x => new Set(x.itens.map(i => i.conta)).size > 1)
            .sort((a, b) => ORDEM_COMP.indexOf(a.tipo) - ORDEM_COMP.indexOf(b.tipo))
            .filter(x => {
                const ids = x.itens.map(i => i.conta + '|' + i.it.itemId);
                if ((dono.get(ids[0]) || []).some(s => ids.every(id => s.has(id)))) return false;
                const s = new Set(ids);
                s.forEach(id => { (dono.get(id) || dono.set(id, []).get(id)).push(s); });
                return true;
            })
            .sort((a, b) => String(a.titulo).localeCompare(String(b.titulo), 'pt-BR'));
    };

    // Meses do gráfico (v2.5.3: nasce das cobranças): frete típico (mediana) cobrado nos pedidos do mês (Faturamento); mês sem venda usa o
    // valor que a lista do ML mostrava no fim do mês. Mês sem dado não entra.
    P.mesesFrete = function (hist, porMes) {
        const m = {};
        ((hist && hist.meses) || []).forEach(x => { m[x.m] = { m: x.m, v: x.v, fonte: 'lista' }; });
        Object.keys(porMes || {}).sort().forEach(k => { m[k.slice(0, 7)] = { m: k.slice(0, 7), v: porMes[k].tipico, fonte: 'vendas' }; });   // partes '@DD': fica a última
        return Object.keys(m).sort().map(k => m[k]);
    };

    // Gráfico em degraus (SVG só com números; nenhum texto do ML entra aqui).
    P.svgFrete = function (meses) {
        if (!meses || !meses.length) return '';
        const W = 320, H = 150, x0 = 38, x1 = 300, y0 = 22, y1 = 118;
        const vs = meses.map(x => x.v);
        let min = Math.min(...vs), max = Math.max(...vs);
        if (max - min < 0.01) { min -= 1; max += 1; }
        const pad = (max - min) * 0.12; min -= pad; max += pad;
        const X = i => meses.length === 1 ? (x0 + x1) / 2 : x0 + (x1 - x0) * i / (meses.length - 1);
        const Y = v => y1 - (v - min) / (max - min) * (y1 - y0);
        const f = n => Math.round(n * 10) / 10;
        let d = 'M' + f(X(0)) + ' ' + f(Y(vs[0]));
        for (let i = 1; i < meses.length; i++) d += ' H' + f(X(i)) + ' V' + f(Y(vs[i]));
        const eixo = [max - pad, (max + min) / 2, min + pad].map(v => `<text x="${x0 - 5}" y="${f(Y(v)) + 3}" text-anchor="end">${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</text><line x1="${x0}" x2="${x1}" y1="${f(Y(v))}" y2="${f(Y(v))}" stroke="#E2E8F0"/>`).join('');
        const passo = meses.length > 7 ? 2 : 1;
        const rot = meses.map((x, i) => (i % passo === 0 || i === meses.length - 1) ? `<text x="${f(X(i))}" y="${H - 14}" text-anchor="middle"${i === meses.length - 1 ? ' font-weight="700" fill="#0F172A"' : ''}>${P.nomeMes(x.m).slice(0, 3)}</text>` : '').join('');
        const pts = meses.map((x, i) => `<circle cx="${f(X(i))}" cy="${f(Y(x.v))}" r="${i === meses.length - 1 ? 4 : 2.6}" fill="${i === meses.length - 1 ? '#fff' : '#DC2626'}" stroke="#DC2626" stroke-width="${i === meses.length - 1 ? 2 : 0}"/>`).join('');
        const ult = meses[meses.length - 1];
        const aria = `Frete de ${SHC.moeda(meses[0].v)} em ${P.nomeMes(meses[0].m)} a ${SHC.moeda(ult.v)} em ${P.nomeMes(ult.m)}`;
        return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}" font-family="Segoe UI,Arial,sans-serif" font-size="9" fill="#64748B">`
            + eixo + `<text x="4" y="12">R$</text>`
            + `<path d="${d}" fill="none" stroke="#DC2626" stroke-width="2"/>` + pts
            + `<text x="${x1}" y="12" text-anchor="end" font-size="10" font-weight="700" fill="#991B1B">${SHC.moeda(ult.v)}</text>` + rot + '</svg>';
    };

    // Catálogo: SKUs do retrato de anúncios (sem SKU → um grupo por MLB).
    P.agrupaSkus = function (itens) {
        const g = {};
        P.anunciosReais(itens).forEach(it => {
            const chave = it.sku ? 'sku:' + it.sku : 'mlb:' + it.itemId;
            (g[chave] || (g[chave] = { chave, sku: it.sku || '', titulo: it.titulo, itens: [] })).itens.push(it);
        });
        return Object.values(g).sort((a, b) => String(a.titulo).localeCompare(String(b.titulo), 'pt-BR'));
    };
    // Resultado de um SKU no ML: SHC.sobraAnuncio em cada anúncio dele; a classe é a do pior anúncio.
    P.resumoSku = function (grupo, custoDados, cfg) {
        const custo = custoDados ? SHC.num(custoDados.custo) : null;
        const linhas = grupo.itens.map(it => ({ it, s: SHC.sobraAnuncio(it, custoDados, cfg) })).filter(l => l.s);
        const maxPreco = Math.max(0, ...grupo.itens.map(it => it.preco || 0));
        if (!(custo > 0)) return { custo: null, linhas, classe: 'sem_custo', maxPreco };
        const com = linhas.filter(l => l.s.sobra !== null).sort((a, b) => a.s.sobra - b.s.sobra);
        return {
            custo, linhas: com, pior: com[0] || null, melhor: com[com.length - 1] || null,
            classe: com.length ? com[0].s.classe : 'sem_preco', maxPreco, suspeito: maxPreco > 0 && custo > maxPreco,
        };
    };

    // ── Explicações por regra (camada 1): só descrevem números que as funções SHC.* já calcularam ──
    const FONTE_PROMO = 'Fonte: preço, tarifa, frete e “você recebe” = Mercado Livre · custo e imposto = seus.';

    P.explicaPromo = function (linhas, rec, cfg, titulo) {
        cfg = Object.assign({}, SHC.PADRAO, cfg || {});
        const meta = SHC.pctTxt(SHC.num(cfg.margem_alvo_pct) || 0);
        const nome = l => '“' + curto(l.p.promo, 50) + '” (' + SHC.moeda(l.p.preco) + ')';
        const res = l => l.sobra < 0 ? 'dá prejuízo de ' + SHC.moeda(-l.sobra) + ' (' + SHC.pctTxt(l.pct) + ')' : 'deixa ' + SHC.moeda(l.sobra) + ' (' + SHC.pctTxt(l.pct) + ')';
        const out = [];
        if (titulo) out.push('Produto: ' + curto(titulo, 70) + '.');
        if (!linhas || !linhas.length) return { linhas: out.concat('O Mercado Livre não tem proposta de promoção para este produto agora.'), fonte: 'Fonte: Central de promoções do Mercado Livre.' };
        if (!rec) return { linhas: out.concat('Informe o custo deste produto para eu comparar as propostas. Preço, tarifa, frete e “você recebe” já vêm do Mercado Livre.'), fonte: FONTE_PROMO };
        const n = linhas.filter(l => l.sobra !== null).length, e = rec.escolha;
        if (rec.tipo === 'ideal') {
            out.push(rec.atingem === 1
                ? `Das ${n} propostas, só ${nome(e)} bate sua meta de ${meta}: ${res(e)} por venda.`
                : `Das ${n} propostas, ${rec.atingem} batem sua meta de ${meta}. A marcada, ${nome(e)}, tem o menor preço entre elas (o maior desconto) e ainda ${res(e)} por venda.`);
        } else if (rec.tipo === 'aproximada') {
            out.push(`Nenhuma das ${n} propostas bate sua meta de ${meta}. A que mais se aproxima é ${nome(e)}: ${res(e)} por venda.`);
        } else {
            out.push(`Todas as ${n} propostas dão prejuízo. A menos ruim é ${nome(e)}: ${res(e)} por venda.`);
        }
        const outras = linhas.filter(l => l !== e && l.sobra !== null).slice(0, 3);
        if (outras.length) out.push(outras.map(l => nome(l) + ' ' + res(l)).join('; ') + '.');
        out.push(`A conta da marcada: o ML repassa ${SHC.moeda(e.p.recebe)}; menos custo, outros e imposto (${SHC.moeda(e.imposto)}) sobram ${SHC.moeda(e.sobra)}.`);
        if (rec.precoMeta) out.push(`Preço mínimo para a meta de ${meta}: ${SHC.moeda(rec.precoMeta)}. É estimativa do Copiloto: supõe a mesma tarifa (%) e o mesmo frete da proposta.`);
        return { linhas: out, fonte: FONTE_PROMO + (rec.precoMeta ? ' Preço mínimo = estimativa.' : '') };
    };

    // "E se minha meta for X%?" — recalcula com uma cfg temporária, nada é salvo.
    P.recalculaFamilia = function (props, custoDe, cfgTemp) {
        const linhas = props.map(p => Object.assign({ p }, SHC.sobraProposta(p, custoDe(p), cfgTemp)));
        // A escolha não depende do custo; o preço mínimo usa o custo da proposta escolhida (o SKU dela).
        let rec = SHC.recomendaPromo(linhas, cfgTemp, null);
        if (rec) rec = SHC.recomendaPromo(linhas, cfgTemp, custoDe(rec.escolha.p));
        return { linhas, rec };
    };
    P.simulaMeta = function (familias, cfg, metaNova) {
        const conta = c => {
            const n = { ideal: 0, aproximada: 0, nenhuma: 0 };
            familias.forEach(f => { const r = P.recalculaFamilia(f.props, f.custoDe, c).rec; if (r) n[r.tipo]++; });
            return n;
        };
        const hoje = conta(cfg), nova = conta(Object.assign({}, cfg, { margem_alvo_pct: metaNova }));
        const comCusto = hoje.ideal + hoje.aproximada + hoje.nenhuma;
        if (!comCusto) return { linhas: ['Ainda não há produto com custo e proposta de promoção para simular. Informe o custo primeiro.'], fonte: FONTE_PROMO, hoje, nova };
        return {
            hoje, nova, fonte: FONTE_PROMO,
            linhas: [
                `Com meta de ${SHC.pctTxt(metaNova)} (hoje ${SHC.pctTxt(SHC.num(cfg.margem_alvo_pct) || 0)}), ${nova.ideal} de ${comCusto} produtos têm proposta que bate a meta (hoje ${hoje.ideal}).`,
                `${nova.aproximada} só chegam perto e ${nova.nenhuma} dão prejuízo em todas as propostas.`,
                'Nada foi salvo. Para mudar a meta de verdade, use Ajustes.',
            ],
        };
    };

    const FONTE_ML_LISTA = 'Fonte: lista de Anúncios do Mercado Livre.';
    // Frete COBRADO do anúncio (frete:<conta>:hist.porAnuncio[MLB]) em 1 frase: 30 dias × 30 anteriores. '' = nenhum pedido com frete.
    P.freteCobTxt = function (fa) {
        const u = fa && fa.ult30, a = fa && fa.ant30;
        if (!u || !a || (!u.pedidos && !a.pedidos)) return '';
        const ant = fa.semLeitura ? 'os 30 dias anteriores ainda não foram lidos por inteiro no Faturamento (tento de novo na próxima sincronização)'
            : a.pedidos ? `nos 30 dias anteriores, ${SHC.moeda(a.medio)} (${SHC.qtd(a.pedidos, 'pedido', 'pedidos')})` : 'nos 30 dias anteriores, nenhum pedido com frete';
        return u.pedidos ? `Nos últimos 30 dias, o ML cobrou em média ${SHC.moeda(u.medio)} de frete por pedido neste anúncio (${SHC.qtd(u.pedidos, 'pedido', 'pedidos')}); ${ant}.`
            : `Nenhum pedido com frete neste anúncio nos últimos 30 dias; ${ant}.`;
    };
    const FONTE_COB = 'Fonte: Faturamento do Mercado Livre (frete cobrado em cada pedido).';
    P.explicaFrete = function (item, hist, fa) {
        // V9: frete do comprador → regra fixa; o fh antigo desse anúncio guarda a taxa operacional, não frete.
        if (item && item.freteComprador) return { linhas: ['Frete por conta do comprador: o ML não cobra frete de você neste anúncio; o “A pagar” é taxa operacional.'], fonte: FONTE_ML_LISTA };
        const deduz = item && item.freteDeduzido, cob = P.freteCobTxt(fa);
        const fonte = 'Fonte: lista de Anúncios do Mercado Livre, guardada pelo Copiloto uma vez por dia' + (deduz ? ' (frete = preço − tarifa − você recebe, números do ML).' : '.') + (cob ? ' ' + FONTE_COB : '');
        // v2.5.3: sem o valor diário da lista, a explicação sai do frete cobrado nos pedidos (não depende do dia da instalação).
        if (!hist && cob) return { linhas: [cob, fa.subiu ? 'O frete típico por pedido subiu mais de R$ 1 e 2%. Se você não mudou peso, medidas nem embalagem, confira os pedidos abaixo e peça ao ML a revisão do cálculo.'
            : 'O frete típico por pedido não subiu: nada a contestar.'], fonte: FONTE_COB };
        if (!hist) return { linhas: ['Ainda não tenho frete cobrado deste anúncio: nenhum pedido com frete nos últimos 60 dias do Faturamento do ML lido até agora.'], fonte };
        if (hist.anterior === null) return { linhas: [`O frete deste anúncio está em ${SHC.moeda(hist.atual)} desde ${P.dataBr(hist.primeiro)}, o primeiro dia guardado. Não mudou desde então.`].concat(cob ? [cob] : []), fonte };
        const sobe = hist.atual > hist.anterior;
        // A lista mostra o frete no preço atual (com promoção, no preço da promoção); o fh não guarda o preço — a confirmar ao vivo.
        const fim = !sobe ? 'O frete caiu: nada a contestar.'
            : item && item.emPromocao
                ? `O anúncio está em promoção (${SHC.moeda(item.preco)}${item.precoCheio > 0 ? ', preço cheio ' + SHC.moeda(item.precoCheio) : ''}): a lista mostra o frete do preço da promoção, e a mudança pode ter vindo dela, sem mudança de peso. O texto do chamado usa só o frete cobrado nas vendas.`
                : 'Se o preço mudou nesse dia (uma promoção começou ou terminou), o frete pode ter mudado por isso. Se o preço não mudou e você não mudou peso, medidas nem embalagem, pode pedir ao ML a revisão do cálculo. O texto pronto está no fim desta tela.';
        return {
            fonte,
            linhas: [
                `Até ${P.dataBr(hist.ate)}, o Mercado Livre mostrava custo de envio de ${SHC.moeda(hist.anterior)} para este anúncio. Desde ${P.dataBr(hist.desde)}, mostra ${SHC.moeda(hist.atual)}: ${mais(hist.varRs)} (${maisPct(hist.varPct)}).`,
                'O ML não mostra o motivo nesta tela. O Copiloto só compara os valores que o ML mostrou em cada dia.',
                fim,
            ].concat(cob ? [cob] : []),
        };
    };

    // Texto do chamado: só números reais. A frase das medidas entra só com a caixa marcada pelo seller.
    // Pedidos: os cobrados acima do frete de antes (número, data, valor, diferença). Medidas do ERP só com a caixa marcada.
    P.textoChamado = function (item, hist, vendas, confirmouMedidas, medidas) {
        const b = P.baseChamado(hist, vendas, item);
        if (!b) return '';
        let t = b.fonte === 'lista'
            ? `Olá. O custo de envio do anúncio ${item.itemId} passou de ${SHC.moeda(b.base)} para ${SHC.moeda(b.para)} em ${P.dataBr(b.desde)}, segundo a lista de Anúncios do meu painel.`
            : `Olá. O frete cobrado por pedido nas vendas do anúncio ${item.itemId} passou de ${SHC.moeda(b.base)} (valor típico em ${P.nomeMes(b.mesAntes)}) para ${SHC.moeda(b.para)} (valor típico em ${P.nomeMes(b.mes)}), segundo o Faturamento do meu painel.`;
        const { peds, fora } = P.pedidosAMais(vendas, b.base, b.desde);
        if (peds.length) {
            t += ` Pedidos cobrados acima de ${SHC.moeda(b.base)} desde ${P.dataBr(b.desde)} (${peds.length}): `
                + peds.slice(0, 10).map(p => `#${p.orderId} de ${P.dataBr(p.d)}: ${SHC.moeda(p.f)} (${SHC.moeda(p.dif)} a mais)`).join('; ')
                + (peds.length > 10 ? ` e mais ${peds.length - 10}` : '')
                + `. Diferença somada: ${SHC.moeda(SHC.r2(peds.reduce((a, p) => a + p.dif, 0)))}.`;
        }
        if (fora.length) t += ` Deixei de fora ${SHC.qtd(fora.length, 'pedido', 'pedidos')} com frete bem maior, que podem ter mais de uma unidade.`;
        if (confirmouMedidas) {
            t += ' Não alterei peso, medidas nem embalagem.';
            if (medidas) t += ` Peso e medidas da embalagem no meu cadastro: ${medidas}.`;
        }
        return t + ' Peço a revisão do peso e das medidas considerados no cálculo do frete. Obrigado.';
    };

    P.respostaSemCusto = function (resumos, comPromo) {
        const sem = resumos.filter(r => r.r.classe === 'sem_custo');
        if (!resumos.length) return { linhas: ['A lista de anúncios ainda não foi lida. Ela chega na próxima sincronização.'], fonte: 'Fonte: lista de Anúncios do Mercado Livre.' };
        if (!sem.length) return { linhas: [`Todos os ${resumos.length} SKUs têm custo.`], fonte: 'Fonte: custos = seus.' };
        const prim = sem.filter(r => comPromo && comPromo.has(r.g.chave)).concat(sem.filter(r => !(comPromo && comPromo.has(r.g.chave))));
        const nomes = prim.slice(0, 5).map(r => curto(r.g.sku || r.g.itens[0].itemId, 30) + ' (' + curto(r.g.titulo, 40) + ')');
        const out = [`Faltam custos em ${sem.length} de ${resumos.length} SKUs: ${nomes.join('; ')}${sem.length > 5 ? ' e mais ' + (sem.length - 5) : ''}.`];
        if (comPromo && prim.some(r => comPromo.has(r.g.chave))) out.push('Comece pelos que têm proposta de promoção aberta (estão no começo da lista).');
        out.push('Preencha no cartão “Custo preenchido”, no alto do Catálogo: os que mais vendem vêm primeiro.');
        return { linhas: out, fonte: 'Fonte: lista de Anúncios do Mercado Livre · custos = seus.' };
    };
    P.respostaPrejuizo = function (resumos) {
        const p = resumos.filter(r => r.r.classe === 'prejuizo');
        if (!p.length) return { linhas: ['Nenhum SKU com custo informado dá prejuízo no preço atual do ML.'], fonte: 'Fonte: preço, tarifa, frete e “você recebe” = Mercado Livre · custo e imposto = seus.' };
        return {
            linhas: [`${SHC.qtd(p.length, 'SKU dá', 'SKUs dão')} prejuízo no preço atual: ` + p.slice(0, 5).map(r => curto(r.g.titulo, 40) + ' (' + SHC.moeda(r.r.pior.s.sobra) + ' por venda)').join('; ') + (p.length > 5 ? ' e mais ' + (p.length - 5) : '') + '.',
                'O prejuízo é o do pior anúncio de cada SKU.'],
            fonte: 'Fonte: preço, tarifa, frete e “você recebe” = Mercado Livre · custo e imposto = seus.',
        };
    };
    P.MSG_CUSTO = 'Digite o custo em reais, por exemplo 25,90.';
    P.alertaCusto = r => r && r.suspeito ? `O custo de ${SHC.moeda(r.custo)} é maior que o preço do anúncio (${SHC.moeda(r.maxPreco)}). Confira se não sobrou um zero.` : '';

    // Ajustes digitados → {patch, erros:{campo: texto}}. Campo vazio não vira 0 sem querer: imposto e meta são obrigatórios (0 vale, digitado).
    // Campo do imposto: 0 salvo aparece "0" (senão o 0% do padrão ou do "Não sei" vira campo vazio e Salvar recusa); nunca salvo → vazio.
    P.txtImposto = cfg => (cfg && (cfg.configurado || cfg.imposto_pct)) ? String(SHC.num(cfg.imposto_pct) || 0).replace('.', ',') : '';
    // regras = [[campo, min, max, rótulo]]; inteiro = só números inteiros → { patch, erros }
    const lerFaixas = (txt, regras, inteiro) => {
        const erros = {}, patch = {};
        regras.forEach(([k, min, max, rot]) => {
            const n = SHC.num(txt[k]);
            if (n === null || n < min || n > max || (inteiro && n !== Math.round(n))) erros[k] = `${rot}: use um número${inteiro ? ' inteiro' : ''} de ${min} a ${max}.`; else patch[k] = n;
        });
        return { patch, erros };
    };
    P.lerAjustes = txt => lerFaixas(txt, [['imposto_pct'].concat(SHC.FAIXAS.imposto_pct, 'Imposto'), ['margem_alvo_pct'].concat(SHC.FAIXAS.margem_alvo_pct, 'Meta')]);   // SHC.FAIXAS: a mesma do painel.html
    // Regras do robô de fotos (Saúde): queda mínima das visitas, intervalo por anúncio e máximo de trocas por dia.
    P.lerRegrasRobo = txt => lerFaixas(txt, [['radar_queda_pct', 5, 90, 'Queda mínima'], ['robo_intervalo_dias', 1, 60, 'Intervalo'], ['robo_max_dia', 1, 50, 'Máximo por dia']], true);

    // ── Painel em abas (v2.5.3): Geral primeiro; cada alerta só na aba do seu módulo ──
    // v2.9: ordem da perfumaria (ESPEC) e a aba nova Pós-venda.
    P.ABAS = ['geral', 'full', 'posvenda', 'promo', 'ads', 'frete', 'catalogo', 'afiliados', 'saude', 'conciliacao', 'canal', 'ajustes'];
    P.ROT_ABA = { geral: 'Geral', posvenda: 'Pós-venda', promo: 'Promoções', frete: 'Frete', catalogo: 'Catálogo', ads: 'Ads', full: 'Full', saude: 'Saúde', conciliacao: 'Conciliação', canal: 'Canal', afiliados: 'Afiliados', ajustes: 'Ajustes' };
    // v2.8 (pedido da dona: "sistema modular, escolher qual função exibir"): 1 linha por módulo desligável em Ajustes (nunca Geral/Ajustes).
    P.MODULOS = SHC.MODULOS;
    P.MODULO_DESC = { promo: 'Promoções e melhor opção de desconto', frete: 'Frete de cada anúncio e o que subiu', catalogo: 'Custo por SKU e competição no catálogo',
        ads: 'Campanhas do Mercado Ads', full: 'Estoque, remessas e a próxima remessa do Full', saude: 'Fotos, dados fiscais, medidas e visitas dos anúncios',
        conciliacao: 'Fechamento do mês, faturas e notas fiscais', canal: 'Agenda do Canal de transmissão', afiliados: 'Vendas e produtos da campanha de afiliados',
        posvenda: 'Reclamações, devoluções e mensagens: motivos e produtos com mais problema' };
    /** Abas visíveis no topo, na ordem de P.ABAS (Geral e Ajustes sempre; o resto só se o módulo estiver ligado). */
    P.abasVisiveis = cfgAtual => P.ABAS.filter(a => a === 'geral' || a === 'ajustes' || SHC.moduloLigado(cfgAtual, a));
    // Alertas calculados no painel (P.alertas) → aba; os do fundo (shc:anomalias) que o painel não calcula: frete, pagamento e pós-venda.
    P.ABA_DO_ALERTA = { conta: 'full', full: 'full', ads: 'ads', fiscal: 'saude', visitas: 'saude', medidas: 'saude', medmud: 'saude' };
    // v2.7: 'perguntas' e 'reputacao' (aba Saúde desde a v2.9) e a remessa do Full com inconformidade/multa (tipo 'full' + remessaId, aba Full) também vêm do fundo.
    const ROT_ANOM = { frete: 'Frete', pagamento: 'Cobrança', posvenda: 'Pós-venda', perguntas: 'Perguntas', reputacao: 'Reputação' };
    const LINK_ANOM = { posvenda: 'Abrir o pós-venda', perguntas: 'Responder no ML', reputacao: 'Ver a reputação no ML', remessa: 'Abrir a remessa no ML' };
    P.ROT_ANOM = ROT_ANOM;
    /** Alertas de UMA aba → [{tipo, rot, titulo, texto, link?, linkTxt?}]. anom só vale se for da conta aberta (anom.conta). */
    P.alertasDaAba = function (aba, al, anom, conta) {
        const rot = { conta: 'Conta', full: 'Full', ads: 'Ads', fiscal: 'Dados fiscais', visitas: 'Visitas', medidas: 'Medidas', medmud: 'Medidas' };
        const daqui = ((al && al.itens) || []).filter(i => P.ABA_DO_ALERTA[i.tipo] === aba).map(i => Object.assign({ rot: rot[i.tipo] || '' }, i));
        const doFundo = anom && String(anom.conta) === String(conta || '') ? (anom.itens || []).filter(i => i && i.aba === aba && (ROT_ANOM[i.tipo] || (i.tipo === 'full' && i.remessaId)))
            .map(i => ({ tipo: i.tipo, rot: i.remessaId ? 'Remessa' : ROT_ANOM[i.tipo], titulo: '', texto: i.texto, link: i.link || '', remessaId: i.remessaId || '',
                linkTxt: LINK_ANOM[i.remessaId ? 'remessa' : i.tipo] || (i.link ? 'Abrir no Mercado Livre' : '') })) : [];
        return daqui.concat(doFundo);
    };

    // ── v2.7: remessas do Full (lista + detalhe), próxima remessa, perguntas, reputação, apelidos das contas ──
    P.remessaLink = id => 'https://vendedores.mercadolivre.com.br/shipping/inbounds/' + encodeURIComponent(String(id)) + '/details';
    const remQuando = r => r.recebida || r.agendada || r.atualizada || '';
    /**
     * Lista (ml:full:remessas:<conta>) + detalhes (remessas:<conta>:detalhe) → linhas para a tela, mais recente primeiro:
     * [{id, statusTexto, quando, unidades:{enviadas, recebidas, faltando} (null = o ML não disse), custo, textos:[inconformidades], multaTexto, link, semDetalhe}]
     */
    P.linhasRemessas = function (rem, det) {
        const rs = (rem && Array.isArray(rem.remessas)) ? rem.remessas : [], porId = (det && det.porId) || {};
        const rr = SHC.remessasResumo(rem, det, null), inc = {}, mul = {};
        rr.comInconformidade.forEach(x => { inc[x.id] = x.textos; });
        rr.comMulta.forEach(x => { mul[x.id] = x.texto; });
        return rs.filter(r => r && r.id).slice().sort((a, b) => (remQuando(b) > remQuando(a) ? 1 : remQuando(b) < remQuando(a) ? -1 : 0)).map(r => {
            const d = porId[r.id] || null, u = (d && d.unidades) || {};
            return { id: String(r.id), statusTexto: (d && d.statusTexto) || r.statusTexto || '', quando: remQuando(r), fechada: !!(d && d.fechada), passo: SHC.passoRemessa(String(r.status || '')),
                aptas: typeof r.aptas === 'number' ? r.aptas : null, agendada: r.agendada || '', inconforme: rr.inconformes.some(x => x.id === String(r.id)),
                unidades: { enviadas: typeof u.enviadas === 'number' ? u.enviadas : (typeof r.unidades === 'number' ? r.unidades : null), recebidas: typeof u.recebidas === 'number' ? u.recebidas : null, faltando: typeof u.faltando === 'number' ? u.faltando : null },
                custo: r.custo || 0, textos: inc[r.id] || [], multaTexto: mul[r.id] || '', link: P.remessaLink(r.id), semDetalhe: !d };
        });
    };
    // ── v2.9 (pedido da dona 26/09): pontuação do Full em medidor, remessa em passos (reservada → recebendo → processada) ──
    /** Faixa de cor de 0–100: 0–49 vermelho, 50–74 âmbar, 75–100 verde. */
    P.faixaPontos = pct => (pct >= 75 ? 'ok' : pct >= 50 ? 'at' : 'pr');
    /** Medidor semicircular (SVG inline, sem biblioteca): 3 faixas de cor + ponteiro no valor. '' quando não há número. */
    P.gaugeSvg = function (valor, max) {
        const v = P.un(valor), m = P.un(max) > 0 ? P.un(max) : 100;
        if (v === null) return '';
        const pct = Math.max(0, Math.min(100, v / m * 100)), arco = 'M12 62A48 48 0 0 1 108 62', ang = Math.round((pct / 100 * 180 - 90) * 10) / 10;
        const nome = { pr: 'vermelha', at: 'amarela', ok: 'verde' }[P.faixaPontos(pct)];
        return `<svg viewBox="0 0 120 70" role="img" aria-label="Pontuação ${v} de ${m}, na faixa ${nome}">`
            + `<path d="${arco}" pathLength="100" fill="none" stroke="#EF4444" stroke-width="12" stroke-dasharray="49.4 200"/>`
            + `<path d="${arco}" pathLength="100" fill="none" stroke="#F59E0B" stroke-width="12" stroke-dasharray="0 50 24.4 200"/>`
            + `<path d="${arco}" pathLength="100" fill="none" stroke="#10B981" stroke-width="12" stroke-dasharray="0 75 25 200"/>`
            + `<line x1="60" y1="62" x2="60" y2="22" stroke="#0F172A" stroke-width="3" stroke-linecap="round" transform="rotate(${ang} 60 62)"/><circle cx="60" cy="62" r="5" fill="#0F172A"/></svg>`;
    };
    const PASSOS_REM = ['Reservada', 'Recebendo', 'Processada'], escR = t => String(t === null || t === undefined ? '' : t).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
    /** Passos da remessa (1 reservada · 2 recebendo · 3 processada); datas só as que o ML deu. passo 0/null → ''. */
    P.passosRem = (passo, datas, mini) => (passo > 0 ? `<ol class="passos rem${mini ? ' mini' : ''}">` + PASSOS_REM.map((n, i) => {
        const c = i + 1 < passo || passo === 3 ? 'ok' : i + 1 === passo ? 'ag' : '';
        return `<li${c ? ` class="${c}"` : ''}><b>${n}</b>${mini ? '' : escR((datas || [])[i] || '—')}</li>`;
    }).join('') + '</ol>' : '');
    /** "O que fazer agora" de uma remessa aberta (texto curto; só datas que o ML deu). */
    P.agoraRem = (passo, agendada, hoje) => passo === 2 ? 'O Mercado Livre está conferindo as unidades. Nada a fazer agora.'
        : !agendada ? 'Termine de preparar a remessa no Mercado Livre.'
        : agendada < hoje ? `A data agendada (${P.dataBr(agendada).slice(0, 5)}) já passou. Confira a remessa no Mercado Livre.`
        : `Deixe as caixas prontas e etiquetadas até ${P.dataBr(agendada).slice(0, 5)}.`;
    /** Resumo do cartão recolhido: "2 abertas · 3 fechadas nos últimos 30 dias · R$ 1.234,00 gastos em remessas este mês". */
    P.remessasResumoTxt = rr => [SHC.qtd(rr.abertas, 'aberta', 'abertas'), SHC.qtd(rr.fechadas30d, 'fechada', 'fechadas') + ' nos últimos 30 dias',
        rr.custoMes !== null && rr.custoMes !== undefined ? SHC.moeda(rr.custoMes) + ' gastos em remessas este mês' : 'o Mercado Livre ainda não cobrou a coleta deste mês'].join(' · ');
    /**
     * Linhas do plano do Full (P.planoFull, qtd > 0) → SKUs para SHC.simulaRemessa: [{sku, qtd, medidas, itemIds, fonteMedida}].
     * qtds = {sku: n} do que a pessoa digitou (vale sobre a sugestão); medidasDe(itemIds, sku) → SHC.medidasParaSimular(...).
     */
    P.skusParaSimular = function (linhas, qtds, medidasDe) {
        const q = qtds || {}, out = [];
        (linhas || []).forEach(l => {
            const sku = (l.p && l.p.sku) || '', k = sku || (l.p && (l.p.itemId || l.p.titulo)) || '';
            if (!k) return;
            const n = q[k] !== undefined ? Math.max(0, Math.round(SHC.num(q[k]) || 0)) : (l.qtd > 0 ? l.qtd : 0);
            if (!n && q[k] === undefined) return;
            const ids = l.itemIds || [], m = medidasDe ? medidasDe(ids, sku) : null;
            out.push({ sku: k, titulo: (l.p && l.p.titulo) || '', qtd: n, medidas: m ? { ordenadas: m.ordenadas, pesoKg: m.pesoKg } : null, fonteMedida: m ? m.fonte : '', itemIds: ids });
        });
        return out;
    };
    /** perguntas:<conta> (+ resumo:<conta>) → {pendentes, texto, cor:'ok'|'atencao'|'ruim'|'neutra', link} | null (nada lido ainda). */
    P.perguntasLinha = function (perg, res) {
        const p = perg || (res && res.perguntas ? { pendentes: res.perguntas.pendentes, link: res.perguntas.link, tempoMedio: null } : null);
        if (!p) return null;
        const n = typeof p.pendentes === 'number' ? p.pendentes : null, tm = (p.tempoMedio || {}).comercial, al = SHC.perguntasAlerta(p);
        const t = n === null ? 'o Mercado Livre não mostrou quantas perguntas estão sem resposta' : (n ? SHC.qtd(n, 'pergunta sem resposta', 'perguntas sem resposta') : '✓ nenhuma pergunta sem resposta');
        const tempo = typeof tm === 'number' ? ' · tempo médio ' + SHC.minutosTxt(tm) + ' (meta: 1 h)' : '';
        return { pendentes: n, texto: t + tempo, cor: n === null ? 'neutra' : (al && al.vermelho ? 'ruim' : (n > 0 ? 'atencao' : 'ok')), link: p.link || 'https://www.mercadolivre.com.br/perguntas/vendedor', lento: typeof tm === 'number' && tm > 60 };
    };
    /** reputacao:<conta> → {nivel, codigo, texto, cor, faixa, faixaNome, lider, barras:[{id, rotulo, pct, limitePct, usoPct, qtd, vendas, falta, cor, cls, link, texto}], proximo, periodo, topItens, linkTop, link} | null.
     *  cor (bolinha da Geral) = a dos alertas (70%+ atenção, 90%+ vermelho); cls de cada barra = regra da aba Saúde (verde < 70%, âmbar 70–99%, vermelho no limite ou acima). */
    P.reputacaoLinha = function (rep) {
        if (!rep || !rep.nivel) return null;
        const al = SHC.reputacaoAlertas(rep), alPor = {}; al.forEach(a => { alPor[a.id] = a; });
        const barras = (rep.variaveis || []).filter(v => v && v.pct !== null).map(v => {
            const uso = v.limitePct > 0 ? Math.round(v.pct / v.limitePct * 100) : null, a = alPor[v.id];
            const curto = v.rotulo + ' ' + String(v.pct).replace('.', ',') + '%' + (v.limitePct !== null ? ' de ' + String(v.limitePct).replace('.', ',') + '%' : '');
            return { id: v.id, rotulo: v.rotulo, pct: v.pct, limitePct: v.limitePct, usoPct: uso, qtd: v.qtd, vendas: v.vendas, falta: P.repFalta(v), cor: a ? (a.vermelho ? 'ruim' : 'atencao') : 'ok',
                cls: P.repCls(uso, v.saude), link: v.link || '', curto, texto: curto + (v.qtd !== null && v.vendas !== null ? ' (' + v.qtd + ' de ' + P.milhar(v.vendas) + ' vendas)' : '') };
        });
        const pior = barras.filter(b => b.cor !== 'ok').sort((a, b) => (b.usoPct || 0) - (a.usoPct || 0))[0] || barras.find(b => b.id === 'claims') || barras[0];
        const px = rep.proximoNivel && rep.proximoNivel.faltam && rep.proximoNivel.faltam.length ? 'Para ' + rep.proximoNivel.texto + ' faltam: ' + rep.proximoNivel.faltam.map(f => f.rotulo + (f.falta ? ' ' + f.falta : '')).join(', ') : '';
        const cod = String(rep.nivel.codigo || ''), fx = P.repFaixa(cod);
        return { nivel: rep.nivel.texto, codigo: cod, texto: rep.nivel.texto + (pior ? ' · ' + pior.curto.replace(/^([^ ]+)/, m => m.toLowerCase()) : ''),   // pelos campos: "Cancelamentos (por você)" tem parêntese
            cor: al.some(a => a.vermelho) ? 'ruim' : (al.length ? 'atencao' : 'ok'), faixa: fx, faixaNome: fx === null ? '' : P.REP_FAIXAS[fx][0], lider: /^green_(silver|gold|platinum)$/.test(cod) ? rep.nivel.texto : '',
            barras, proximo: px, periodo: rep.periodo || null, topItens: (rep.topItens || []).slice(0, 3), linkTop: rep.linkTop || '', link: (pior && pior.link) || P.URL_REPUTACAO };
    };
    P.URL_REPUTACAO = 'https://vendedores.mercadolivre.com.br/reputacao';
    // Termômetro do ML (5 faixas, vermelho → verde). Código da página (green_gold, yellow…) ou da API (5_green, 4_light_green…) → posição 0–4 | null (sem cor ainda).
    P.REP_FAIXAS = [['Vermelha', '#EF4444'], ['Laranja', '#F97316'], ['Amarela', '#FACC15'], ['Verde-clara', '#A3E635'], ['Verde', '#16A34A']];
    P.repFaixa = cod => { const c = String(cod || ''); return /light_green/.test(c) ? 3 : /green/.test(c) ? 4 : /yellow/.test(c) ? 2 : /orange/.test(c) ? 1 : /red/.test(c) ? 0 : null; };
    /** Cor da barra de uma variável: 'pr' no limite ou acima (ou marcada pelo ML), 'at' de 70% a 99%, 'ok' abaixo; '' sem limite conhecido. */
    P.repCls = (uso, saude) => (saude && saude !== 'healthy') || uso >= 100 ? 'pr' : uso === null ? '' : uso >= 70 ? 'at' : 'ok';
    /** Quantos casos ainda cabem até a variável chegar no limite (0 = já chegou; null = sem vendas ou sem limite). */
    P.repFalta = v => (!v || v.limitePct === null || v.limitePct === undefined || !(v.vendas > 0) || v.qtd === null || v.qtd === undefined ? null
        : Math.max(0, Math.ceil(v.limitePct * v.vendas / 100 - v.qtd - 1e-9)));
    /** Manchete da aba Saúde → {cor:'pr'|'at'|'ok'|'', fato, acao}. r = P.reputacaoLinha, q = P.perguntasLinha, nFiscal = anúncios sem dados fiscais (null = não lido). */
    P.saudeManchete = function (r, q, nFiscal) {
        const perg = q && q.pendentes > 0 ? 'Você tem ' + SHC.qtd(q.pendentes, 'pergunta sem resposta.', 'perguntas sem resposta.') : '';
        const fis = nFiscal > 0 ? SHC.qtd(nFiscal, 'anúncio está sem dados fiscais.', 'anúncios estão sem dados fiscais.') : '';
        if (!r) return { cor: perg || fis ? 'at' : '', fato: 'Sua reputação ainda não foi lida.', acao: perg || fis || 'Ela é lida na próxima sincronização.' };
        const ord = { pr: 2, at: 1 }, pior = r.barras.filter(b => ord[b.cls]).sort((a, b) => ord[b.cls] - ord[a.cls] || (b.usoPct || 0) - (a.usoPct || 0))[0];
        const rep = r.faixaNome ? 'Reputação ' + r.faixaNome.toLowerCase() : 'Reputação ainda sem cor';
        if (pior && pior.cls === 'pr') return { cor: 'pr', fato: pior.rotulo + (pior.usoPct !== null && pior.usoPct >= 100 ? ' passaram do limite.' : ' foram marcadas pelo Mercado Livre.'), acao: 'Veja no ML o que fazer para não perder a cor.' };
        if (pior) return { cor: 'at', fato: rep + ', mas ' + pior.rotulo.toLowerCase() + ' estão em ' + pior.usoPct + '% do limite.',
            acao: pior.falta ? 'Mais ' + SHC.qtd(pior.falta, 'caso', 'casos') + ' e você chega ao limite.' : 'Veja no ML o que fazer.' };
        return { cor: perg || fis ? 'at' : 'ok', fato: rep + ', tudo dentro do limite.', acao: perg || fis || 'Continue assim.' };
    };
    /** Campos de apelido {sellerId: texto} → {apelidos} só com ids válidos e texto até 40 letras (vazio = tira o apelido). */
    P.lerApelidos = txt => SHC.apelidosLimpos(txt);
    P.waLinkOk = u => typeof u === 'string' && u.indexOf('https://wa.me/?text=') === 0 && u.length < 7000;
    P.URL_TROCAR_CONTA = 'https://vendedores.mercadolivre.com.br/';
    /** "N coisas pedem sua atenção" da Geral: shc:anomalias da conta aberta → {total, partes:'2 no Full, 1 de frete'} | null (ainda não calculado). */
    P.anomTopo = function (anom, conta) {
        if (!anom || typeof anom.total !== 'number' || String(anom.conta) !== String(conta || '')) return null;
        const t = SHC.anomaliasTitulo ? SHC.anomaliasTitulo(anom) : '';
        return { total: anom.total, partes: t.indexOf(' — ') > 0 ? t.slice(t.indexOf(' — ') + 3) : '', vermelho: !!anom.vermelho };
    };
    /** Etapas da sincronização em dia (lidas ou puladas) → {ok, de}. */
    // Situação da fatura como o ML manda ("A VENCER", "PAGO") → "A vencer", "Paga" (fatura é feminino).
    P.situacaoFatura = function (s) {
        const t = String(s || '').trim().toLowerCase(), fem = { pago: 'paga', vencido: 'vencida', fechado: 'fechada', aberto: 'aberta' }[t] || t;
        return fem.charAt(0).toUpperCase() + fem.slice(1);
    };
    // "25/09 às 14:02" (horário local) de um carimbo em ms.
    P.quando = ts => { const d = new Date(ts), z = n => String(n).padStart(2, '0'); return z(d.getDate()) + '/' + z(d.getMonth() + 1) + ' às ' + z(d.getHours()) + ':' + z(d.getMinutes()); };
    // Cartão "Preparando o Copiloto" (antes da 1ª leitura completa). s = SHC.statusSync. Se a 1ª leitura falhou, diz o motivo e o que fazer.
    P.prepHtml = s => (s && s.estado === 'erro'
        ? '<p class="prep"><b>O Copiloto ainda não conseguiu ler a sua conta.</b> ' + String(s.fazer || 'Tente de novo em alguns minutos.').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';') + '</p>'
        : '<p class="prep"><b>Preparando o Copiloto:</b> lendo a sua conta pela primeira vez. Leva uns minutos; você pode continuar usando o Mercado Livre.</p>');
    P.etapasEmDia = function (st) {
        const ids = (SHC.SYNC_ETAPAS || []).map(e => e.id), es = (st && st.etapas) || {};
        // 'pulado' porque nada foi lido (os anúncios falharam / a leitura parou) não está em dia; o de status antigo só tem o resumo "Não lida…".
        const naoLida = e => e.naoLida || /^Não lida/.test(e.resumo || '');
        // Não lida agora, mas com a última leitura boa guardada (resumoAnterior): o dado dela continua valendo, conta como em dia.
        const valeAinda = e => !!e.resumoAnterior && !/^Não lida/.test(e.resumoAnterior) && e.estado !== 'lendo';
        return { ok: ids.filter(id => es[id] && (es[id].estado === 'ok' || (es[id].estado === 'pulado' && !naoLida(es[id])) || (es[id].estado !== 'ok' && valeAinda(es[id])))).length, de: ids.length };
    };
    /**
     * Linha da sincronização no topo da Geral (pedido da dona: "o que está em sincronismo primeiro"). st = shc:status, prox = hora do
     * próximo alarme 'shc-sync' (ms) ou null. → {estado, cor (dot), rotulo, texto, pct (só lendo), fila: [rótulos na fila]}.
     * Lendo: "Lendo: Faturamento de setembro · 6 de 13 · falta cerca de 3 min". Parada: "✓ Atualizado às 12:23 · próxima às 15:23".
     */
    const MESES_P = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    const rotCurto = id => String(((SHC.SYNC_ETAPAS || []).find(e => e.id === id) || {}).rotulo || 'a sua conta').replace(/\s*\(.*\)$/, '');
    P.syncGeral = function (st, agora, prox) {
        st = st || {};
        const s = SHC.statusSync(st, agora), es = st.etapas || {}, p = st.progresso || {}, hm = SHC.hhmm;
        if (s.estado === 'sincronizando') {
            const e = es[p.etapa] || {}, de = e.de || p.de, feito = e.de ? e.feito : p.feito;
            const mes = /^\d{4}-\d{2}$/.test(e.mesAgora || '') ? ' de ' + MESES_P[+e.mesAgora.slice(5, 7) - 1] : '';
            const k = de > 0 ? Math.min(de, Math.floor(feito || 0) + (mes ? 1 : 0)) + ' de ' + de + (mes ? '' : (e.unidade || p.unidade) ? ' ' + (e.unidade || p.unidade) : '') : '';
            const fila = (SHC.SYNC_ETAPAS || []).filter(x => x.id !== p.etapa && (!es[x.id] || !es[x.id].estado || es[x.id].estado === 'fila')).map(x => rotCurto(x.id));
            // v2.10: retomada → "Continuando | de onde parou: etapa 6 de 13 · Lendo: …" (as etapas lidas antes da queda não voltam para a fila).
            const cont = p.continua ? 'de onde parou: etapa ' + (p.indice || 1) + ' de ' + (p.total || (SHC.SYNC_ETAPAS || []).length) : '';
            return { estado: 'lendo', cor: 'lendo', rotulo: cont ? 'Continuando' : 'Sincronizando', pct: s.pct, fila,
                texto: [cont, 'Lendo: ' + (p.etapa ? rotCurto(p.etapa) + mes : 'a sua conta'), k, s.restante].filter(Boolean).join(' · ') };
        }
        // v2.10: parou no meio e já está continuando sozinho (um instante): âmbar, sem "não sincronizou".
        if (s.interrompida && s.cor === 'amarelo') return { estado: 'erro', cor: 'atencao', rotulo: 'Sincronização', pct: null, fila: [], texto: 'Parou no meio · continuando de onde parou…' };
        if (s.estado === 'erro') {
            const ed = P.etapasEmDia(st);
            return { estado: 'erro', cor: 'ruim', rotulo: 'Sincronização', pct: null, fila: [],
                texto: st.ultimaOk ? 'Não sincronizou agora · os dados de ' + P.quando(st.ultimaOk) + ' continuam valendo' + (st.etapas ? ' · ' + ed.ok + ' de ' + ed.de + ' etapas em dia' : '') : s.texto };
        }
        if (s.estado === 'nunca') return { estado: 'nunca', cor: 'neutra', rotulo: 'Sincronização', pct: null, fila: [], texto: 'Ainda não sincronizado' };
        const probl = Object.keys(es).filter(id => es[id] && (es[id].estado === 'erro' || es[id].naoLida)).length;
        const px = prox && prox > agora ? ' · próxima às ' + hm(prox) : '';
        return { estado: s.estado, cor: probl || s.estado === 'velho' ? 'atencao' : 'ok', rotulo: 'Sincronização', pct: null, fila: [],
            texto: (s.estado === 'velho' ? s.texto : '✓ Atualizado às ' + hm(st.ultimaOk)) + px + (probl ? ' · ' + (probl === 1 ? '1 parte não foi lida' : probl + ' partes não foram lidas') : '') };
    };
    // Geral "conforme a demanda": vermelho → amarelo → verde → cinza (não lido / na fila); na mesma cor, mais R$ em jogo primeiro; empate na ordem das abas.
    // ponytail: R$ em jogo só dos módulos que já têm o valor pronto (frete a mais, Ads acima do equilíbrio, cobranças a conferir, pós-venda); os outros contam 0.
    const PESO_COR = { ruim: 0, atencao: 1, ok: 2, neutra: 3 };
    P.ordemGeral = linhas => linhas.filter(Boolean).slice().sort((a, b) => (PESO_COR[a.cor] ?? 3) - (PESO_COR[b.cor] ?? 3)
        || (b.rs || 0) - (a.rs || 0) || P.ABAS.indexOf(a.id) - P.ABAS.indexOf(b.id));
    /**
     * Certificado digital (cert:<conta>) → {vermelho, texto, velho (dado com mais de 7 dias)} | null (sem leitura).
     * Vermelho: vencido ou vence em até 30 dias. Nunca inventa a data: sem dias nem data, diz só que venceu (quando a tela disse).
     */
    P.certInfo = function (cert, agora) {
        cert = SHC.certAgora(cert, agora);   // dias contados até hoje, não até o dia da leitura
        if (!cert || (cert.dias === null && !cert.data && !cert.expirou)) return null;
        const d = typeof cert.dias === 'number' ? cert.dias : null, venceu = !!cert.expirou || (d !== null && d < 0);
        const data = cert.data ? P.dataBr(cert.data) : '';
        const texto = venceu ? 'Seu certificado digital venceu' + (data ? ' em ' + data : '') + '. Sem ele, você não consegue emitir NF-e e seus anúncios Full podem ser pausados.'
            : 'Seu certificado digital vence ' + (d === 0 ? 'hoje' : d === 1 ? 'amanhã' : d !== null ? 'em ' + d + ' dias' : '') + (data ? (d !== null ? ' (' + data + ')' : 'em ' + data) : '') + '.'
                + (d !== null && d <= 30 ? ' Renove antes: sem ele, você não consegue emitir NF-e e seus anúncios Full podem ser pausados.' : '');
        return { vermelho: venceu || (d !== null && d <= 30), texto, velho: (agora || Date.now()) - (cert.ts || 0) > 7 * 864e5 };
    };
    /**
     * v2.8: NF-e das vendas de um mês (nfe:<conta>:<mês>) → {texto, ruins (rejeitadas + com erro), aviso} | null (nunca lido).
     * "476 notas · 470 autorizadas · 6 canceladas · R$ 30.000,00 em notas autorizadas". Leitura que falhou: o texto é o da anterior, com aviso.
     */
    P.nfeResumo = function (x) {
        if (!x) return null;
        if (typeof x.total !== 'number') return { texto: 'Ainda não consegui ler as notas deste mês. Tento de novo na próxima sincronização.', ruins: 0, aviso: '' };
        const ps = x.porStatus || {}, rot = (st, n) => { const t = st.charAt(0).toLowerCase() + st.slice(1); return n > 1 && /[ae]$/.test(t) ? t + 's' : t; };
        const partes = [SHC.qtd(x.total, 'nota', 'notas')].concat(Object.keys(ps).sort((a, b) => ps[b] - ps[a]).map(st => P.milhar(ps[st]) + ' ' + rot(st, ps[st])));
        if (x.total > 0) partes.push(SHC.moeda(x.somaTotal || 0) + ' em notas autorizadas');
        const avisos = [];
        if (!x.completo) avisos.push('Li ' + P.milhar(x.lidas || 0) + ' de ' + P.milhar(x.total) + ' notas: as somas são só das lidas.');
        if (x.erro) avisos.push('A última leitura não deu certo: estes números são da leitura anterior.');
        return { texto: partes.join(' · '), ruins: (ps.Rejeitada || 0) + (ps['Com erro'] || 0), aviso: avisos.join(' ') };
    };
    /** Pós-venda (posvenda:<conta>) → {cor, resumo} | null. Campo null = aba não achada na página ("—"), nunca 0 inventado. */
    P.posVenda = function (pv) {
        if (!pv) return null;
        const n = v => (typeof v === 'number' ? v : null), r = n(pv.reclamacoes), m = n(pv.mensagens), d = n(pv.devolucoes), t = v => (v === null ? '—' : P.milhar(v));
        return { r, m, d, cor: r > 0 ? 'ruim' : (m > 0 || d > 0 ? 'atencao' : 'ok'),
            resumo: `${t(r)} ${r === 1 ? 'reclamação ou mediação' : 'reclamações ou mediações'} · ${t(m)} ${m === 1 ? 'mensagem' : 'mensagens'} · ${t(d)} ${d === 1 ? 'devolução' : 'devoluções'}` };
    };
    /** Frete da conta (frete:<conta>:hist) → {cor, resumo, conc} | null. Sempre vale conciliados + faltam + compradorPaga = vendas. */
    // Conciliação só vale com as vendas lidas (depois de atualizar a extensão, antes da sincronização, não há vendas: nunca "0 de 0").
    P.concDe = h => (h && h.vendasLidas !== false ? h.conciliacao || null : null);
    // Meses dos 60 dias que o Faturamento não deixou ler → "ago/26 não foi lido (tento de novo na próxima sincronização)"; '' = tudo lido.
    P.freteSemLeitura = h => { const m = (h && h.semLeitura) || []; return m.length ? m.map(P.nomeMes).join(', ') + (m.length > 1 ? ' não foram lidos' : ' não foi lido') + ' no Faturamento (tento de novo na próxima sincronização)' : ''; };
    P.freteConta = function (h) {
        const c = P.concDe(h);
        if (!c || typeof c.vendas !== 'number') return null;
        const pa = (c.pagoAMais || []).length;
        return { cor: pa > 0 ? 'ruim' : (c.faltam > 0 ? 'atencao' : 'ok'), conc: c,
            resumo: `${P.milhar(c.conciliados || 0)} ${c.conciliados === 1 ? 'pedido conciliado' : 'pedidos conciliados'} de ${P.milhar(c.vendas)} · faltam ${P.milhar(c.faltam || 0)}`
                + (pa ? ` · ${pa} com frete a mais (${SHC.moeda(c.totalAMais || 0)})` : '') };
    };
    // ── Aba Frete (v2.5.3): tudo do frete COBRADO nos pedidos (frete:<conta>:hist), desde o 1º uso — sem esperar dias guardados ──
    /** Tem frete de pedido lido (do Faturamento, ou o guardado da versão anterior)? */
    P.temFreteCob = h => !!(h && h.desde && h.conta && h.conta.ult30 && h.conta.ant30);
    const numOu = v => (typeof v === 'number' && isFinite(v) ? v : null);
    const ROT_FMT = [['gratis', 'Frete grátis (por sua conta)'], ['compradorPaga', 'Comprador paga (custo operacional do ML)'], ['compartilhado', 'Compartilhado (sua conta e do comprador)'],
        ['extra', 'Envio extra ou intermunicipal'], ['full', 'Full'], ['flex', 'Flex']];
    const CURTO_FMT = { gratis: 'frete grátis', compartilhado: 'compartilhado', extra: 'envio extra' };
    /** Formatos de frete dos últimos 30 dias (conta.porFormato) → [{id, rot, anuncios, pedidos, total}] só dos que existem; null = sem dado ("—"). */
    P.formatosFrete = pf => ROT_FMT.filter(([k]) => pf && pf[k]).map(([k, rot]) => ({ id: k, rot, anuncios: numOu(pf[k].anuncios), pedidos: numOu(pf[k].pedidos),
        total: numOu(k === 'compradorPaga' ? pf[k].custoOperacional : pf[k].total) }));
    /** Formato com mais pedidos do anúncio (fa.formatos) → 'frete grátis' | 'compartilhado' | 'envio extra' | ''. */
    P.formatoDoAnuncio = fa => { const f = (fa && fa.formatos) || {}, k = Object.keys(f).sort((a, b) => f[b] - f[a])[0]; return k ? CURTO_FMT[k] || '' : ''; };
    /** Conciliação do frete (hist.conciliacao) → {titulo, pct, motivos:[…]} | null. conciliados + faltam + compradorPaga = vendas. */
    P.concFrete = function (c) {
        if (!c || typeof c.vendas !== 'number') return null;
        const q = (n, um, v) => SHC.qtd(n, um, v), motivos = [];
        if (c.semCobrancaAinda) motivos.push(q(c.semCobrancaAinda, 'pedido', 'pedidos') + ': o ML ainda não lançou o frete desses pedidos.');
        if (c.semFreteNoAnuncio) motivos.push(q(c.semFreteNoAnuncio, 'pedido', 'pedidos') + ': anúncio sem dado de frete.');
        if (c.compradorPaga) motivos.push(q(c.compradorPaga, 'pedido', 'pedidos') + ' com frete pago pelo comprador: nada a conciliar.');
        if (c.cancelados) motivos.push(q(c.cancelados, 'pedido cancelado fica', 'pedidos cancelados ficam') + ' fora.');
        if (c.freteSemVenda) motivos.push(q(c.freteSemVenda, 'frete cobrado', 'fretes cobrados') + ' de venda feita antes destes 30 dias: fica fora da conta.');
        return { titulo: c.vendas ? `Pedidos conciliados: ${P.milhar(c.conciliados || 0)} de ${P.milhar(c.vendas)} dos últimos 30 dias · faltam ${P.milhar(c.faltam || 0)}` : 'Nenhum pedido nos últimos 30 dias para conciliar.',
            pct: c.vendas ? Math.round((c.conciliados || 0) / c.vendas * 100) : 0, motivos };
    };
    /** Sem frete de pedido lido: o motivo real (nunca "0"). h = frete:<conta>:hist (ou null), st = shc:status. */
    P.freteSemDado = function (h, st, agora) {
        const e = st && st.etapas && st.etapas.faturamento;
        if (h && h.fonte === 'nada' && (!e || e.estado === 'ok')) return 'O Faturamento do ML não tem frete cobrado de você nos últimos 60 dias.';
        if (e && e.estado === 'erro') return 'Não consegui ler o Faturamento do ML agora. Clique em Sincronizar agora para tentar de novo.';
        const w = P.esperaVendas(st, agora);
        return w ? w.replace('As vendas deste anúncio aparecem', 'O frete de cada pedido aparece') : 'O frete de cada pedido aparece depois da próxima sincronização (Faturamento do ML).';
    };
    // Agenda do Canal (shc:canal:plano:<canal>.plano): "Quinta 25/09 às 19:00".
    const SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    P.quandoCanal = (dia, hora) => SEMANA[new Date(dia + 'T12:00:00Z').getUTCDay()] + ' ' + dia.slice(8, 10) + '/' + dia.slice(5, 7) + ' às ' + String(hora).padStart(2, '0') + ':00';
    /** Transmissões com produto a partir de agora (ms, hora local), a mais próxima primeiro. */
    P.proximasCanal = function (plano, agora) {
        const d = new Date(agora || Date.now()), hoje = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'), h = d.getHours();
        return (plano || []).filter(s => s && s.itemId && /^\d{4}-\d{2}-\d{2}$/.test(s.dia || '') && (s.dia > hoje || (s.dia === hoje && +s.hora >= h)))
            .sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : a.hora - b.hora));
    };
    // Fechamento resumido (Conciliação e Geral): linhas da cascata (SHC.fech.cascata) juntas por grupo. null = não lido ("—").
    const GRUPOS_CONC = [['bruto', 'Vendas brutas', ['bruto']], ['cancelado', 'Canceladas e devolvidas', ['cancelado']],
        ['tarifas', 'Tarifas do ML', ['tarifa_venda', 'cobranca_mp', 'parcelamento', 'recebimento', 'outro']], ['frete', 'Frete por sua conta', ['frete']],
        ['ads', 'Ads', ['ads', 'ads_seguidores']], ['estornos', 'Estornos', ['estornos']], ['liquido', 'Líquido do ML (estimado)', ['liquido']]];
    P.concResumo = function (casc) {
        const por = {};
        ((casc && casc.linhas) || []).forEach(l => { por[l.id] = l; });
        return GRUPOS_CONC.map(([id, rotulo, ids]) => {
            const ls = ids.map(k => por[k]).filter(Boolean), nulo = !ls.length || ls.some(l => l.valor === null || l.parcial);
            return { id, rotulo, tipo: ls[0] ? ls[0].tipo : 'info', valor: nulo ? null : SHC.r2(ls.reduce((s, l) => s + l.valor, 0)) };
        });
    };

    // ── v2.6: faturamento por família (aba Geral). As contas são de SHC.familias / curvaABC / metaMes (ml-extrator.js); aqui só o texto e o desenho. ──
    const MESES_LONGO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    P.mesLongo = m => MESES_LONGO[+String(m).slice(5, 7) - 1] || '';
    P.mesLongoAno = m => P.mesLongo(m) + '/' + String(m).slice(2, 4);
    const pct1 = v => String(Math.abs(Math.round(v * 10) / 10)).replace('.', ',') + '%';
    P.pctFam = v => (typeof v === 'number' && isFinite(v) ? pct1(v) : '');
    // R$ curto para o rótulo do gráfico: 850 → "R$ 850"; 12.345 → "R$ 12,3 mil"; 1.234.567 → "R$ 1,2 mi".
    P.moedaCurta = v => (typeof v !== 'number' || !isFinite(v) ? '' : Math.abs(v) < 1000 ? 'R$ ' + Math.round(v)
        : 'R$ ' + String(Math.round(v / (Math.abs(v) < 1e6 ? 100 : 1e5)) / 10).replace('.', ',') + (Math.abs(v) < 1e6 ? ' mil' : ' mi'));
    /** Seta contra o mês anterior → { txt: '▲ 12%' | '▼ 8%' | '= 0%' | '▲ novo' | '', cls: 'up' | 'down' | 'eq' | '' }. Sem o mês anterior lido → ''. */
    P.famSeta = function (x) {
        if (!x || x.brutoAnt === null || x.brutoAnt === undefined) return { txt: '', cls: '' };
        if (typeof x.variacaoPct !== 'number') return x.bruto > 0 ? { txt: '▲ novo', cls: 'up' } : { txt: '', cls: '' };
        const v = Math.round(x.variacaoPct * 10) / 10;
        return v > 0 ? { txt: '▲ ' + pct1(v), cls: 'up' } : v < 0 ? { txt: '▼ ' + pct1(v), cls: 'down' } : { txt: '= 0%', cls: 'eq' };
    };
    /** O que mudou num SKU (item de SHC.familias(...)[i].skus): 'vendeu menos' | 'vendeu mais barato' | os dois | 'vendeu mais' | ''. */
    P.famVendeu = function (s) {
        const f = s && s.fator > 0 ? s.fator : 1, out = [];
        if (!s || !(s.unidadesAnt > 0)) return '';
        if (s.unidades < s.unidadesAnt * f * 0.95) out.push('vendeu menos');
        if (s.precoMedio > 0 && s.precoMedioAnt > 0 && s.precoMedio < s.precoMedioAnt * 0.97) out.push('vendeu mais barato');
        if (!out.length && s.unidades > s.unidadesAnt * f * 1.05) out.push('vendeu mais');
        return out.join(' e ');
    };
    const chaveSkuFam = s => s.sku || (s.itemIds || [])[0] || '';
    P.chaveSkuFam = chaveSkuFam;
    /**
     * Curva ABC da conta no mês (todos os SKUs de todas as famílias). Pelo lucro quando algum SKU tem custo; senão pelo faturamento.
     * → { criterio: 'lucro' | 'bruto', lista (SHC.curvaABC), de: SKUs com valor no critério, nA, porChave: {sku|MLB: 'A'|'B'|'C'} }
     */
    P.abcConta = function (fams) {
        const skus = [].concat(...(fams || []).map(f => f.skus || [])).filter(s => s.bruto > 0);
        const criterio = skus.some(s => typeof s.lucro === 'number') ? 'lucro' : 'bruto';
        const lista = SHC.curvaABC(skus, criterio), porChave = {};
        lista.forEach(s => { if (s.abc) porChave[chaveSkuFam(s)] = s.abc; });
        return { criterio, lista, de: lista.filter(s => typeof s[criterio] === 'number').length, nA: lista.filter(s => s.abc === 'A').length, porChave };
    };
    /**
     * Colunas empilhadas dos 13 meses (SVG, sem biblioteca): a família escolhida embaixo, na cor dela; as outras juntas, em cinza, em cima.
     * Mês não lido = sem coluna ("não lido" no título). O mês mais forte da família ganha o valor em cima. '' sem família.
     * Mês lido pela metade: "até agora" (o mês de hoje) ou "até dia N" (um mês que fechou depois da leitura).
     * Largura ~320 (a do painel lateral): o SVG não encolhe e os textos de 9 ficam com 9 px na tela.
     */
    P.svgFamilias = function (fams, sel) {
        // O nome da família vem do ML (pode ter & ou <): escapado como no resto do cartão (o esc da tela fica no outro bloco deste arquivo).
        const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const f = (fams || []).find(x => x.familia === sel) || (fams || [])[0];
        if (!f || !Array.isArray(f.serie12) || !f.serie12.length) return '';
        const n = f.serie12.length, colW = 18, gap = 6, alto = 120, topo = 22, W = n * (colW + gap) + gap, H = topo + alto + 30, hojeM = SHC.hoje().slice(0, 7);
        const cols = f.serie12.map((p, i) => {
            const outros = (fams || []).filter(x => x !== f).reduce((s, x) => { const q = (x.serie12 || [])[i]; return s + (q && q.bruto > 0 ? q.bruto : 0); }, 0);
            return { mes: p.mes, eu: p.bruto, outros, lido: p.bruto !== null, parcial: !!p.parcial, ate: p.ate };
        });
        const max = Math.max(1, ...cols.filter(c => c.lido).map(c => c.eu + c.outros));
        const y = v => Math.round(v / max * alto * 10) / 10, ultimo = n - 1;
        const partes = cols.map((c, i) => {
            const x = gap + i * (colW + gap), ponta = i === 0 ? `x="${x}" text-anchor="start"` : i === ultimo ? `x="${x + colW}" text-anchor="end"` : `x="${x + colW / 2}" text-anchor="middle"`, rot = MESES[+c.mes.slice(5, 7) - 1] + (i === 0 || c.mes.slice(5) === '01' ? '/' + c.mes.slice(2, 4) : '');
            const base = topo + alto, forte = c.mes === f.picoMes;
            let g = `<text x="${x + colW / 2}" y="${base + 13}" font-size="9" text-anchor="middle" fill="${c.lido ? '#475467' : '#98A2B3'}"${forte ? ' font-weight="700"' : ''}>${rot}</text>`;
            if (!c.lido) return `<g><title>${P.nomeMes(c.mes)}: não lido</title>${g}<text x="${x + colW / 2 + 3}" y="${base - 4}" font-size="9" transform="rotate(-90 ${x + colW / 2 + 3} ${base - 4})" fill="#667085">não lido</text></g>`;
            const he = y(c.eu), ho = y(c.outros);
            g += `<rect x="${x}" y="${base - he}" width="${colW}" height="${he}" fill="${f.cor}"/>`
                + (ho > 0 ? `<rect x="${x}" y="${base - he - ho}" width="${colW}" height="${ho}" fill="#D0D5DD"/>` : '')
                + (forte ? `<text ${ponta} y="${base - he - ho - 5}" font-size="9" font-weight="700" fill="#0B1220">${P.moedaCurta(c.eu)}</text>` : '')
                + (c.parcial ? `<text ${ponta} y="${base + 24}" font-size="9" fill="#667085">${c.mes === hojeM ? 'até agora' : 'até dia ' + c.ate}</text>` : '');
            return `<g><title>${P.nomeMes(c.mes)}${c.parcial ? (c.mes === hojeM ? ' (até agora)' : ' (lido até o dia ' + c.ate + ')') : ''}: ${esc(f.familia)} ${SHC.moeda(c.eu)} · outras famílias ${SHC.moeda(c.outros)}${forte ? ' · mês mais forte' : ''}</title>${g}</g>`;
        });
        const lbl = `Faturamento de ${n} meses: ${f.familia} em cor, as outras famílias em cinza.` + (f.picoMes ? ` Mês mais forte de ${f.familia}: ${P.mesLongoAno(f.picoMes)}.` : '');
        return `<svg class="fam-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(lbl)}"><line x1="0" x2="${W}" y1="${topo + alto}" y2="${topo + alto}" stroke="#E7EAF0"/>${partes.join('')}</svg>`;
    };
    /** Meta de faturamento do mês (Ajustes): '' = sem meta (null). → { valor: número | null, erro: '' | texto }. */
    P.lerMeta = function (txt) {
        if (!String(txt === null || txt === undefined ? '' : txt).trim()) return { valor: null, erro: '' };
        const n = SHC.num(txt);
        return n > 0 && n <= 1e9 ? { valor: SHC.r2(n), erro: '' } : { valor: null, erro: 'Meta do mês: use um valor em reais, por exemplo 50.000 (ou deixe em branco para ficar sem meta).' };
    };
    /** Linha da meta (SHC.metaMes) → { texto, pct (0–100 do que já vendeu sobre a meta) | null, cor: 'ok' | 'atencao' | 'neutra', semMeta } */
    P.metaTxt = function (mm) {
        if (!mm) return { texto: '', pct: null, cor: 'neutra', semMeta: true };
        const nome = P.mesLongo(mm.mes), semMeta = mm.meta === null;
        if (mm.projecao === null) return { texto: mm.motivo || '', pct: null, cor: 'neutra', semMeta };
        const fecha = 'No ritmo atual você fecha ' + nome + ' em ' + SHC.moeda(mm.projecao);
        if (semMeta) return { texto: fecha + '.', pct: null, cor: 'neutra', semMeta };
        const pct = Math.max(0, Math.min(100, Math.round((mm.ateAgora || 0) / mm.meta * 100)));
        const resto = mm.falta > 0 ? ' · faltam ' + SHC.moeda(mm.falta) + ' (' + SHC.moeda(mm.ritmoNecessarioDia) + ' por dia)' : ' · meta batida';
        return { texto: fecha + ' · meta ' + SHC.moeda(mm.meta) + resto + (mm.falta > 0 ? (mm.vaiBater ? ' · no ritmo de bater' : ' · abaixo do ritmo da meta') : '') + '.', pct, cor: mm.vaiBater ? 'ok' : 'atencao', semMeta };
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = SHC;
})(typeof globalThis !== 'undefined' ? globalThis : this);

(function () {
    'use strict';
    if (typeof document === 'undefined') return;
    const SHC = globalThis.SHC, P = SHC.pl;
    const $ = s => document.querySelector(s);
    const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const nfr = v => (v === null || v === undefined || v === '' || !isFinite(v)) ? '' : Number(v).toFixed(2).replace('.', ',');
    const ROTULO = { lucrativo: 'Dão lucro', apertado: 'Abaixo da meta', prejuizo: 'Prejuízo', sem_custo: 'Sem custo' };
    const URL_PROMOS = 'https://vendedores.mercadolivre.com.br/anuncios/lista/promos';
    const URL_ANUNCIOS = 'https://vendedores.mercadolivre.com.br/anuncios/lista';
    const URL_COMPETINDO = 'https://vendedores.mercadolivre.com.br/anuncios?filters=COMPETING';
    const URL_LUCRO = 'https://vendedores.mercadolivre.com.br/anuncios';
    const URL_AFIL = { campanha: 'https://vendedores.mercadolivre.com.br/seller-affiliates/campaign', hub: 'https://vendedores.mercadolivre.com.br/seller-affiliates' };   // guia: "Ver o lucro nos seus anúncios"
    const ATALHOS = ['ads.html', 'fechamento.html'];   // páginas da extensão feitas por outras frentes
    const PERM_CAT = { origins: ['https://www.mercadolivre.com.br/*', 'https://produto.mercadolivre.com.br/*'] };   // "Ver quem está ganhando"

    let cfg = Object.assign({}, SHC.PADRAO), snap = null, status = {}, anuncios = null, itens = [], guia = { feitos: {}, tours: {} };
    let conta = null, contas = {}, icone = false, famDeItem = {}, skusFam = {}, custoFam = {}, custoProp = new Map();
    let fretes = {}, vendas = {}, grupos = [], resumos = [], custoGrupo = {}, propsPorFam = {}, skuDe = {}, geracao = 0;
    let cadSku = {}, adsSnap = null, fechMes = null, retratos = {}, compAberto = false;
    let compHist = {}, concDe = {}, compGrupo = '', concMsg = {}, permCat = false;   // comp:<conta>, conc:<conta>:<MLB>; filtro e estado do "Ver quem está ganhando"
    let roboPromo = null, roboPromoMsg = '';   // v2.9: robopromo:<conta> (sugestões e histórico do robô de promoções); resposta do Salvar da margem
    let afil = null, simDe = {}, simMsg = {};   // afil:<conta>; sim:<conta>:<MLB> por anúncio; 'lendo' | texto do "Conferir com o Simulador do ML"
    let adsFiltro = 'acima', pedTodos = false, semTodos = false;   // c|sku|… (medidas, fullMinUn), ads:<conta>, fech:<conta>:<mês>, {sellerId: itens}
    let full = null, vm = {}, fullDias = 30, fullClasse = '';    // ml:full:<sellerId>, vm|ml|MLB = {'AAAA-MM': unidades}
    let remessas = null, custosMsg = '';   // ml:full:remessas:<sellerId>; resposta de "Sincronizar custos" (Catálogo)
    let mesesLidos = [], entreContas = [];   // meses lidos inteiros no Faturamento; mesmo produto entre contas (calculado 1 vez por carga)
    // Saúde dos anúncios: fiscal:/fotos:/visitas:/robo:<conta>; permissão de www (fotos); filtros e mensagens da aba
    let fiscal = null, fotos = null, visitas = null, robo = null, permWww = false, saudeMsg = '', roboMsg = '', fotoFaixa = '';
    let medidas = null, medSku = '', medMsg = '', medTxt = -1;   // medidas:<conta>; SKU aberto; resposta do "Conferir agora"/"Copiar"; texto do chamado à mostra
    const saudeVer = { fiscal: false, fotos: false, marcadas: false, estavel: false, subindo: false, medidas: false, medmud: false };
    let regrasAbertas = false;   // <details> "Regras do robô" aberto: continua aberto quando a aba é redesenhada (rodada lenta)
    const PERM_WWW = { origins: ['https://www.mercadolivre.com.br/*'] };   // "Permitir ler fotos e medidas dos anúncios" (tela Alterar anúncio: só GET)
    // v2.9: "Continuar sincronizando com o Chrome fechado" (Ajustes) = permissão OPCIONAL 'background': o Chrome segue rodando escondido
    // depois da última janela (e abre junto com o Windows), enquanto o computador estiver ligado. O seller liga/desliga no clique.
    const PERM_FUNDO = { permissions: ['background'] };
    P.textoFundo = ligado => ligado
        ? 'Ligado: fechando as janelas, o Chrome continua sincronizando escondido enquanto o computador estiver ligado. Se não funcionar, confira nas configurações do Chrome › Sistema: "Continuar executando apps em segundo plano".'
        : 'Desligado: com o Chrome fechado a sincronização para e volta sozinha quando você abrir o Chrome.';
    async function atualizaFundo() {
        let ligado = false;
        try { ligado = !!(chrome.permissions && chrome.permissions.contains && await chrome.permissions.contains(PERM_FUNDO)); } catch (e) { ligado = false; }
        $('#syncFundo').checked = ligado;
        $('#infoFundo').textContent = P.textoFundo(ligado);
    }
    const PERM_TXT = 'Permitir ler fotos e medidas dos anúncios';
    const REGRAS_ROBO = ['radar_queda_pct', 'robo_intervalo_dias', 'robo_max_dia'];
    const fullExpl = new Set();
    // Leitura por anúncio: função da camada de dados (store.js) ou, se ainda não existir, direto da chave (mesmo formato).
    const lerPorId = async (fn, pref, ids) => {
        if (!ids.length) return {};
        if (SHC[fn]) return SHC[fn](ids);
        const r = await chrome.storage.local.get(ids.map(id => pref + id)), o = {};
        ids.forEach(id => { o[id] = r[pref + id] || {}; });
        return o;
    };
    let freteExpl = false, custosMl = {};   // custosMl = c|ml|MLB… dos anúncios do retrato (o guia confere o custo como a etiqueta)
    // Listas longas: 100 linhas por vez (conta com milhares de anúncios).
    const LIM = 100, limite = { promo: LIM, frete: LIM, catalogo: LIM, full: LIM, saude: LIM };
    const botaoMais = (a, resto) => resto > 0 ? `<button class="mais" data-mais-linhas="${a}">Mostrar mais ${Math.min(resto, LIM)} de ${resto}</button>` : '';
    // Memória da sessão (localStorage; pode faltar ou falhar: aí começa tudo recolhido, na Geral).
    const LS = {
        ler(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
        gravar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sem memória: fica só nesta abertura */ } },
    };
    // Cartões recolhidos: só o resumo e "Ver mais"; o que a pessoa abriu fica lembrado.
    const verAberto = new Set(Array.isArray(LS.ler('shc:painel:abertos')) ? LS.ler('shc:painel:abertos') : []);
    const aberto = k => verAberto.has(k);
    const alterna = k => { if (verAberto.has(k)) verAberto.delete(k); else verAberto.add(k); LS.gravar('shc:painel:abertos', [...verAberto].slice(-200)); };
    const btVer = (k, mais, menos) => `<button class="lnk ver" data-ver="${esc(k)}" aria-expanded="${aberto(k)}">${aberto(k) ? (menos || 'Ver menos') : (mais || 'Ver mais')}</button>`;
    // Cartão pronto (<div class="card">cabeçalho…corpo</div>) recolhido: fica o cabeçalho (até fimCab), o resumo e "Ver mais".
    function dobra(html, chave, resumo, fimCab) {
        const f = fimCab || '</b>', i = html.indexOf(f) + f.length;
        if (i < f.length) return html;
        return aberto(chave) ? html.slice(0, i) + btVer(chave) + html.slice(i)
            : html.slice(0, i) + (resumo ? ` <span class="res">· ${resumo}</span>` : '') + btVer(chave) + '</div>';
    }
    let aba = P.ABAS.indexOf(LS.ler('shc:painel:aba')) >= 0 ? LS.ler('shc:painel:aba') : 'geral', filtro = '', busca = '', editando = null, explicando = null, simMeta = {};
    // Leituras da Geral, Conciliação, Canal e pós-venda (camada de dados v2.5.3). null = ainda não lido.
    let posvenda = null, freteHist = null, conferir = null, cert = null, anom = null, rateio = null, fat = null, vb = null, rep = null, fechAnt = null, canalPlano = null;
    let fiscalLendo = false, fiscalMsg = '', fiscalPedidoEm = 0;
    let freteDet = null, freteFiltro = '', freteBusca = '', confirmouMedidas = false;
    let catFiltro = '', catBusca = '', catEditando = null;
    // v2.6: faturamento por família (Geral): vbAnuncio:<conta>, cat:<conta>; mês ('atual' | 'anterior'), família escolhida, Faturamento | Lucro,
    // SKUs com "Por que caiu?" aberto e quantos SKUs aparecem.
    // coresA = cores:<conta> {família: cor}: a cor de cada família fica a mesma entre "Este mês"/"Mês passado" e de um dia para o outro.
    let vbA = null, catA = null, coresA = {}, famMes = 'atual', famSel = '', famModo = 'bruto', famLim = 10;
    // v2.7: perguntas:/resumo:/reputacao:/remessas:<c>:detalhe/resumo:<c>:semanal da conta; contas vistas neste Chrome (SHC.contas) e os dados das outras
    // (SHC.dadosContas, só com mais de 1 conta); vista do topo ('atual' | 'todas' | sellerId de outra conta); quantidades digitadas na próxima remessa.
    let perguntas = null, resumoML = null, reputacao = null, remDet = null, semanal = null, contasLista = [], dadosC = [], vista = 'atual', semanalMsg = '', semanalPedido = false;
    let nfeV = [null, null], nfeCopiada = '';   // v2.8: nfe:<conta>:<mês atual> e <mês anterior>; chave da nota copiada por último
    const simQtd = {};
    const famCausas = new Set();
    const abertos = new Set();

    function tempo(ts) {
        if (!ts) return '';
        const min = Math.round((Date.now() - ts) / 60000);
        if (min < 1) return 'agora';
        if (min < 60) return 'há ' + min + ' min';
        const h = Math.round(min / 60);
        if (h < 24) return 'há ' + h + ' h';
        return 'há ' + P.dias(Math.round(h / 24));
    }
    // Resposta da IA por regra: sempre texto (textContent), nunca HTML.
    function mostraResposta(alvo, r) {
        alvo.textContent = '';
        if (!r) { alvo.hidden = true; return; }
        alvo.hidden = false;
        r.linhas.forEach(t => { const p = document.createElement('p'); p.textContent = t; alvo.appendChild(p); });
        if (r.fonte) { const s = document.createElement('small'); s.textContent = r.fonte; alvo.appendChild(s); }
    }
    const respCorpo = r => r.linhas.map(t => `<p>${esc(t)}</p>`).join('') + (r.fonte ? `<small>${esc(r.fonte)}</small>` : '');
    const respHtml = r => `<div class="ia-resp">${respCorpo(r)}</div>`;

    // Lê tudo e redesenha. Cada chamada ganha um número: se outra começou depois, esta desiste (não grava dado velho).
    async function carregar() {
        const eu = ++geracao;
        const [c, st, an, g, ct, cts] = await Promise.all([SHC.lerCfg(), SHC.lerStatus(), SHC.lerAnuncios(), SHC.lerGuia(), SHC.lerChave('ml:conta'), SHC.lerChave('ml:contas')]);
        const s = await SHC.lerPromos(ct || undefined);   // promoções por conta (ml:promos:<sellerId>, V14)
        if (eu !== geracao) return;
        // Simulador de custos do ML já conferido (sim:<conta>:<MLB>): não bateu → o painel usa o "Você recebe" do ML (P.comSimulador).
        const its0 = P.anunciosReais(an && an.itens), agoraSim = Date.now();
        const sims = ct && its0.length ? await chrome.storage.local.get(its0.map(it => 'sim:' + ct + ':' + it.itemId)) : {};
        if (eu !== geracao) return;
        const its = its0.map(it => P.comSimulador(it, sims['sim:' + ct + ':' + it.itemId], agoraSim));
        const sd = {}, ppf = {}, sf = {};
        its.forEach(it => { if (it.sku) sd[it.itemId] = it.sku; });
        const fams = s ? s.familias : [], props = s ? s.propostas : [];
        props.forEach(p => { (ppf[p.familia] || (ppf[p.familia] = [])).push(p); });
        fams.forEach(f => { sf[f.chave] = P.skusDaFamilia(f, ppf[f.chave], sd); });
        const fdi = P.familiaPorItem(s), grs = P.agrupaSkus(its);
        const cs = await P.lerCustosPainel(fams, props, grs, { skusFam: sf, skuDe: sd, famDeItem: fdi });
        const ids = its.map(it => it.itemId);
        const skus = [...new Set(its.filter(it => it.sku).map(it => SHC.chaveSku(it.sku)))].filter(Boolean);
        const outras = Object.keys(cts || {}).filter(id => id !== String(ct));
        const [fr, vd, ad, fch, rts, fu] = await Promise.all([
            ids.length ? SHC.lerFretes(ids) : {}, ids.length ? SHC.lerVendas(ids) : {},
            // Ads por anúncio (API do Mercado Ads) e Ads da conta no mês (Faturamento): chaves da camada de dados (V8).
            SHC.lerChave('ads:' + (ct || 'atual')), SHC.lerChave('fech:' + (ct || 'atual') + ':' + SHC.hoje().slice(0, 7)),
            Promise.all(outras.map(id => SHC.lerAnuncios(id))),
            SHC.lerFull ? SHC.lerFull(ct || undefined) : SHC.lerChave('ml:full:' + (ct || 'atual')),
        ]);
        const [rem, af, va, cta, cor, rpr] = await Promise.all([SHC.lerChave('ml:full:remessas:' + (ct || 'atual')), SHC.lerChave('afil:' + (ct || 'atual')),
            SHC.lerChave('vbAnuncio:' + (ct || 'atual')), SHC.lerChave('cat:' + (ct || 'atual')), SHC.lerChave('cores:' + (ct || 'atual')), SHC.lerChave('robopromo:' + (ct || 'atual'))]);
        // Custos/medidas/EAN dos SKUs desta conta e das outras (EAN compara produto entre contas); vendas por mês (vm|ml)
        // dos anúncios e dos produtos do Full.
        const skusTodos = new Set(skus);
        rts.forEach(r => ((r && r.itens) || []).forEach(it => { if (it.sku) skusTodos.add(SHC.chaveSku(it.sku)); }));
        ((fu && fu.produtos) || []).forEach(p => { if (p.sku) skusTodos.add(SHC.chaveSku(p.sku)); });   // mínimo do Full por SKU
        Object.values((va && va.itens) || {}).forEach(x => { if (x && x.sku) skusTodos.add(SHC.chaveSku(x.sku)); });   // lucro por família (anúncio que já saiu da lista)
        const idsVm = [...new Set(ids.concat([].concat(...((fu && fu.produtos) || []).map(P.idsDoFull))))];
        const [cad, vms, lidos, cml] = await Promise.all([SHC.lerCustos([...skusTodos].filter(Boolean)), lerPorId('lerVendasMes', 'vm|ml|', idsVm),
            SHC.lerMesesVendasLidos ? SHC.lerMesesVendasLidos(ct || undefined) : SHC.lerChave('ml:cobrancas:' + ct).then(x => (x && x.mesesLidos) || []),
            SHC.lerCustos(ids.map(id => SHC.chave('ml', id)))]);
        let ic = false;
        try { const u = chrome.action && chrome.action.getUserSettings && await chrome.action.getUserSettings(); ic = !!(u && u.isOnToolbar); } catch (e) { ic = false; }
        const foco = await SHC.lerChave('shc:foco');
        const tk = SHC.TINY_CHAVE ? await SHC.lerChave(SHC.TINY_CHAVE) : null;
        // Competição: histórico diário (comp:<conta>) e o que "Ver quem está ganhando" já leu (conc:<conta>:<MLB>).
        const idsComp = its.filter(it => it.competicao && it.competicao !== 'ganhando').map(it => it.itemId);
        const [ch, cc] = await Promise.all([SHC.lerChave('comp:' + (ct || 'atual')), idsComp.length ? chrome.storage.local.get(idsComp.map(id => 'conc:' + ct + ':' + id)) : {}]);
        let pc = false;
        try { pc = !!(chrome.permissions && chrome.permissions.contains && await chrome.permissions.contains(PERM_CAT)); } catch (e) { pc = false; }
        const saudeLida = await lerSaude(ct), ext = await lerExtras(ct);
        if (eu !== geracao) return;
        usaSaude(saudeLida);
        ({ posvenda, freteHist, conferir, cert, anom, rateio, fat, vb, rep, fechAnt, canalPlano, perguntas, resumoML, reputacao, remDet, semanal, contasLista, dadosC, nfeV } = ext);
        if (vista !== 'atual' && vista !== 'todas' && !contasLista.some(x => x.sellerId === vista)) vista = 'atual';
        compHist = ch || {}; concDe = {}; permCat = pc; afil = af || null; roboPromo = rpr || null; vbA = va || null; catA = cta || null; coresA = cor || {};
        simDe = {}; its0.forEach(it => { const x = sims['sim:' + ct + ':' + it.itemId]; if (x && x.hoje) simDe[it.itemId] = x; });
        idsComp.forEach(id => { const x = cc['conc:' + ct + ':' + id]; if (x) concDe[id] = x; });

        carregado = true;
        cfg = c; snap = s; status = statusDoFundo(st); anuncios = an; guia = g; conta = ct; contas = cts || {};
        itens = its; skuDe = sd; propsPorFam = ppf; skusFam = sf; famDeItem = fdi; grupos = grs;
        custoFam = cs.custoFam; custoProp = cs.custoProp; custoGrupo = cs.custoGrupo;
        resumos = grupos.map(gr => ({ g: gr, r: P.resumoSku(gr, (custoGrupo[gr.chave] || {}).dados || null, cfg) }));
        tinyToken = tinyRecusado ? '' : (tk && tk.token) || '';   // token recusado pelo Tiny: pede outro (o velho fica guardado até o novo ser aceito)
        fretes = fr; vendas = vd; icone = ic; cadSku = cad; adsSnap = ad || null; fechMes = fch || null; vm = vms; full = fu || null; remessas = rem || null; mesesLidos = lidos || []; custosMl = cml || {};
        retratos = {}; if (ct) retratos[ct] = its; outras.forEach((id, i) => { if (rts[i]) retratos[id] = rts[i].itens || []; });
        entreContas = P.contasCompetindo(retratos, nomesContas(), sku => (cadSku[SHC.chaveSku(sku)] || {}).ean || '');   // nome = apelido de Ajustes ou "Conta …1234", nunca o do ML

        // Etiqueta no ML → "ver no Copiloto": shc:foco = {aba, itemId}. Vai direto e apaga o foco.
        if (foco) {
            abreAba(P.ABAS.indexOf(foco.aba) >= 0 ? foco.aba : 'frete');
            if (foco.itemId && aba === 'frete') { freteDet = String(foco.itemId); confirmouMedidas = false; freteExpl = false; }
            if (foco.itemId && aba === 'catalogo') { const it = itens.find(x => x.itemId === foco.itemId); catBusca = it ? (it.sku || it.itemId) : String(foco.itemId); $('#buscaCat').value = catBusca; }
            chrome.storage.local.remove('shc:foco');
        }
        desenhaTudo();
    }
    // Saúde dos anúncios: as 5 chaves da conta + a permissão de www (ler fotos e medidas).
    async function lerSaude(ct) {
        const c = ct || undefined, le = (fn, pref) => (SHC[fn] ? SHC[fn](c) : SHC.lerChave(pref + (ct || 'atual')));
        let pw = false;
        try { pw = !!(chrome.permissions && chrome.permissions.contains && await chrome.permissions.contains(PERM_WWW)); } catch (e) { pw = false; }
        return [...await Promise.all([le('lerFiscal', 'fiscal:'), le('lerFotos', 'fotos:'), le('lerVisitas', 'visitas:'), le('lerRobo', 'robo:'), le('lerMedidas', 'medidas:')]), pw];
    }
    function usaSaude(sd) { [fiscal, fotos, visitas, robo, medidas, permWww] = sd; }
    // Chaves da Geral, Conciliação e Canal (a Conciliação resume o mês passado, como o fechamento completo).
    async function lerExtras(ct) {
        const c = ct || 'atual', mesAnt = P.mesMenos(SHC.hoje().slice(0, 7), 1);
        const ks = ['posvenda:' + c, 'frete:' + c + ':hist', 'conferir:' + c, 'cert:' + c, 'shc:anomalias', 'fech:' + c + ':rateio', 'fat:' + c, 'vb:' + c, 'mp:repasse:' + c, 'fech:' + c + ':' + mesAnt, 'shc:canal:sel',
            'perguntas:' + c, 'resumo:' + c, 'reputacao:' + c, 'remessas:' + c + ':detalhe', 'resumo:' + c + ':semanal', 'nfe:' + c + ':' + SHC.hoje().slice(0, 7), 'nfe:' + c + ':' + mesAnt];
        const r = await chrome.storage.local.get(ks), v = k => (r[k] === undefined ? null : r[k]);
        const sf = v('shc:canal:sel'), pl = sf ? await SHC.lerChave('shc:canal:plano:' + sf) : null;
        // Contas vistas neste Chrome (só ids e apelidos dados em Ajustes); os dados das outras só quando há mais de uma.
        let cs = [], dc = [];
        try { cs = SHC.contas ? await SHC.contas() : []; dc = cs.length > 1 && SHC.dadosContas ? await SHC.dadosContas(SHC.hoje().slice(0, 7)) : []; } catch (e) { cs = []; dc = []; }
        return { posvenda: v(ks[0]), freteHist: v(ks[1]), conferir: v(ks[2]), cert: v(ks[3]), anom: v(ks[4]), rateio: v(ks[5]), fat: v(ks[6]), vb: v(ks[7]), rep: v(ks[8]), fechAnt: v(ks[9]),
            canalPlano: pl && Array.isArray(pl.plano) ? pl : null, perguntas: v(ks[11]), resumoML: v(ks[12]), reputacao: v(ks[13]), remDet: v(ks[14]), semanal: v(ks[15]), contasLista: cs, dadosC: dc,
            nfeV: [v(ks[16]), v(ks[17])] };
    }
    // A rodada lenta grava fotos:/visitas: a cada anúncio: aí só a Saúde e os Alertas são redesenhados (sem reler o resto).
    let geracaoSaude = 0;
    async function soSaude(ks) {
        const eu = ++geracaoSaude, sd = await lerSaude(conta), cat = (ks || []).some(k => /^cat:/.test(k)) ? await SHC.lerChave('cat:' + (conta || 'atual')) : undefined;
        if (eu !== geracaoSaude) return;
        usaSaude(sd);
        if (cat !== undefined) { catA = cat || null; if (aba === 'geral') desenhaGeral(); }   // v2.6: a rodada lenta leu a categoria de mais um anúncio
        desenhaAlertas();
        if (aba === 'saude' && !focoEm(REGRAS_ROBO.map(k => '#' + k).join(','))) desenhaSaude();
        if (aba === 'frete' && freteDet && !focoEm('#confMedidas,[data-csku]')) desenhaFrete();   // "No ML" da prova de medida
    }
    let espera = null;
    const recarregar = () => { clearTimeout(espera); espera = setTimeout(carregar, 120); };
    // Durante a sincronização o fundo grava shc:status a cada página: aí só o status é redesenhado.
    async function soStatus() {
        status = statusDoFundo(await SHC.lerStatus());
        desenhaStatus(); desenhaGuia();
        if (!focoEm('[data-apelido]')) desenhaAjustes();   // não recria os campos de apelido enquanto a pessoa digita
        if (aba === 'promo' && (!snap || !snap.familias.length)) desenhaPromo();
        if (aba === 'full' && !focoEm('#fullDias,[data-min-sku]')) desenhaFull();   // erroFull chega só no status
        if (aba === 'saude' && !focoEm(REGRAS_ROBO.map(k => '#' + k).join(','))) desenhaSaude();   // saudeProgresso e erroSaude vêm no status
        const an = document.querySelector('#listaFrete .andam');
        if (an) an.textContent = andamFrete();
    }

    // Topo (todas as abas): conta, 1 linha da sincronização (selo + etapa; barra fina) e os botões. A lista das 12 etapas fica na Geral
    // (cartão "Sincronização", recolhível: "✓ Tudo lido às 07:34 · ver detalhes"), aberta sozinha durante a sincronização. Antes da 1ª leitura
    // completa (primeiraCompleta; ultimaOk para quem sincronizou antes da 2.4) fica aberta e em destaque: "Preparando o Copiloto".
    let syncAberta = null, syncEstadoAnt = '', proxSync = null, proxLido = 0, etapasKey = null;
    // Hora do próximo alarme 'shc-sync' (o fundo sincroniza a cada 3 h): lida no máximo 1 vez por minuto; sem chrome.alarms, fica sem "próxima".
    function lerProxSync() {
        if (Date.now() - proxLido < 60000 || !(chrome.alarms && chrome.alarms.get)) return;
        proxLido = Date.now();
        try {
            Promise.resolve(chrome.alarms.get('shc-sync')).then(a => { const t = (a && a.scheduledTime) || null; if (t !== proxSync) { proxSync = t; desenhaStatus(); } }, () => {});
        } catch (e) { /* sem alarmes */ }
    }
    const preparando = () => !(status.primeiraCompleta || status.ultimaOk);
    // Conta no topo: com 1 conta, o nome + o ID, sempre os dois juntos; com mais de 1, o seletor "Conta atual ▾" + "Todas
    // as contas". v2.8 (pedido da dona: "preciso que seja exibido o nome da conta e o ID dela não somente o ID"): o nome
    // é o apelido dado em Ajustes (se houver) ou o nome da própria conta lido do Mercado Livre (nunca o e-mail); só sem
    // nenhum dos dois é que aparece "Conta sem nome ainda" — nunca só o ID sozinho.
    const contaPartes = id => {
        const ap = id && cfg.apelidos && cfg.apelidos[id] && String(cfg.apelidos[id]).trim();
        const ml = !ap && id && contas && contas[id] && contas[id].nomeMl && String(contas[id].nomeMl).trim();
        return { nome: (ap || ml || 'Conta sem nome ainda').slice(0, 40), idTxt: 'ID …' + String(id || '').slice(-4), doMl: !ap && !!ml };
    };
    const rotuloConta = id => { const p = contaPartes(id); return `${p.nome} · ${p.idTxt}`; };
    function desenhaConta() {
        const el = $('#nomeConta');
        if (!el || focoEm('#selConta')) return;
        if (contasLista.length > 1) {
            el.innerHTML = `<select id="selConta" aria-label="Conta">${contasLista.map(c => { const p = contaPartes(c.sellerId); return `<option value="${esc(c.sellerId)}" title="${esc(rotuloConta(c.sellerId))}"${(vista === 'atual' && c.atual) || vista === c.sellerId ? ' selected' : ''}>${esc(curtoTxt(p.nome, 14) + ' · ' + p.idTxt)}${c.atual ? ' ▾' : ''}</option>`; }).join('')}<option value="todas"${vista === 'todas' ? ' selected' : ''}>Todas as contas</option></select>`;
        } else if (conta) {
            const p = contaPartes(conta);
            el.innerHTML = `<b>${esc(curtoTxt(p.nome, 20))}</b><span class="conta-id">${esc(p.idTxt)}</span>`;
            el.title = `${p.nome} · ${p.idTxt}`;
        } else { el.textContent = 'Mercado Livre'; el.removeAttribute('title'); }
        if (el.parentElement && el.parentElement.classList) el.parentElement.classList.toggle('sem', !(contasLista.length > 1 || conta));   // sem conta conhecida: bolinha cinza
    }
    // Cartão do topo da Geral quando a vista não é a conta aberta: "Todas as contas" (SHC.consolidado) ou outra conta (linha dela + como trocar no ML).
    function cardContasJuntas() {
        if (vista === 'atual' || contasLista.length < 2) return '';
        const mes = SHC.hoje().slice(0, 7), c = SHC.consolidado(dadosC, mes), hoje = SHC.hoje();
        const m = v => (v === null || v === undefined ? '—' : SHC.moeda(v)), linhas = vista === 'todas' ? c.contas : c.contas.filter(x => x.sellerId === vista);
        const outra = vista !== 'todas' ? contasLista.find(x => x.sellerId === vista) : null;
        return `<div class="card" id="cardContasJuntas"><b style="font-size:13px">${outra ? esc(outra.nome) : 'Todas as contas'} · ${esc(P.mesLongo(mes))} até ${esc(P.dataBr(hoje))}</b>
          ${outra ? `<p class="recnota neutra" style="margin:6px 0 0">Você está com outra conta aberta no Mercado Livre. Para ver os detalhes desta, troque de conta lá e sincronize. Abaixo, o que já foi lido dela.</p>` : ''}
          <table class="tabf"><thead><tr><th>Conta</th><th>Vendas brutas</th><th>Líquido</th><th>Alertas</th></tr></thead><tbody>
          ${linhas.map(x => `<tr><td>${esc(x.nome)}${x.parcial ? ' <span class="det">(parcial)</span>' : ''}</td><td>${m(x.vendasBrutas)}</td><td>${m(x.liquido)}</td><td>${x.alertas === null ? '—' : x.alertas}</td></tr>`
            + (x.motivo ? `<tr><td colspan="4" class="det" style="padding-top:0">${esc(x.motivo)}</td></tr>` : '')).join('')}</tbody>
          ${vista === 'todas' ? `<tfoot><tr><td>Total (${c.total.contasComVendas} de ${c.contas.length} contas)</td><td>${m(c.total.vendasBrutas)}</td><td>${m(c.total.liquido)}</td><td>${c.total.alertas === null ? '—' : c.total.alertas}</td></tr></tfoot>` : ''}</table>
          <p class="det">Líquido = vendas brutas − canceladas e devolvidas − tudo o que o Mercado Livre cobrou no mês (a mesma conta do Fechamento). Só entram as contas em que você já entrou neste Chrome; os dados de cada uma são da última sincronização feita nela.</p>
          <div class="acoes" style="justify-content:flex-start;flex-wrap:wrap"><button class="bt leve" data-trocar-conta>Trocar de conta no Mercado Livre</button><button class="lnk" data-ir-aba="ajustes">Dar apelidos às contas</button></div></div>`;
    }
    function desenhaStatus() {
        desenhaConta();
        const agora = Date.now(), s = SHC.statusSync(status, agora), prep = preparando();
        if (s.estado !== syncEstadoAnt) { syncAberta = null; syncEstadoAnt = s.estado; }   // começou ou terminou: volta ao automático
        $('#st').innerHTML = SHC.htmlSync(status, agora);
        const bt = $('#sincronizar');
        bt.textContent = s.estado === 'erro' || syncFalhou ? 'Tentar de novo' : 'Sincronizar agora';
        bt.hidden = s.estado === 'sincronizando';
        // Topo da Geral (pedido da dona): primeiro o que está sincronizando (etapa, mês, barra, tempo, fila); parado, 1 linha
        // "✓ Atualizado às HH:MM · próxima às HH:MM". A lista das 13 etapas fica recolhida ("ver detalhes"), menos na 1ª leitura.
        const alvo = $('#syncLista'), g = P.syncGeral(status, agora, proxSync);
        lerProxSync();
        const semLista = !prep && !status.etapas && s.estado !== 'sincronizando';   // status de antes da 2.4 (sem etapas): só o que não leu
        const aberta = !semLista && (prep || syncAberta === true);
        const lnk = semLista || prep ? '' : ` <button class="lnk" data-sync-lista>${aberta ? 'esconder' : 'ver detalhes'}</button>`;
        const fila = g.fila.length ? `<p class="det sync-fila">Na fila: ${esc(g.fila.slice(0, 3).join(', ') + (g.fila.length > 3 ? ' e mais ' + (g.fila.length - 3) : ''))}</p>` : '';
        const cab = `<p class="gb-l" style="margin:0"><i class="dot ${g.cor}"></i><b>${g.rotulo}</b><span class="gb-v">${esc(g.texto)}</span>${lnk}</p>`
            + (g.pct !== null ? `<div class="prog sync-prog" role="progressbar" aria-label="Sincronização" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${g.pct}"><i style="width:${g.pct}%"></i></div>` : '') + fila;
        if (semLista) {
            const falhou = P.avisosLeitura(status);
            alvo.className = '';
            alvo.innerHTML = cab + (falhou.length ? `<div class="recnota aviso" style="margin:6px 0 0">Não li agora: ${esc(falhou.join(', '))}. Clique em Sincronizar agora.</div>` : '');
        } else {
            alvo.className = (aberta ? '' : 'fechada') + (prep ? ' destaque' : '');
            alvo.innerHTML = cab + (prep ? P.prepHtml(s) : '') + (aberta ? SHC.htmlSync(status, agora, { lista: true }) : '');
        }
        const ek = JSON.stringify(Object.keys(status.etapas || {}).map(k => (status.etapas[k] || {}).estado)) + s.estado;
        if (ek !== etapasKey) { const mudou = etapasKey !== null; etapasKey = ek; if (mudou && aba === 'geral' && carregado) desenhaGeral(); }   // linha "lendo…/na fila" da Geral
        desenhaTopoAba();
    }
    // Aba com dado ainda não lido na 1ª leitura: mostra o que já tem, com a marca "Parcial" e a etapa que falta (no topo da própria aba).
    const ETAPAS_ABA = { promo: ['anuncios', 'promos'], frete: ['anuncios', 'faturamento'], catalogo: ['anuncios'], ads: ['ads'], full: ['full', 'faturamento'], saude: ['saude'],
        conciliacao: ['faturamento', 'vendasBrutas', 'faturas'], canal: ['promos'], afiliados: ['afiliados'], posvenda: ['posvenda'] };
    function parcialHtml() {
        const ids = ETAPAS_ABA[aba], es = status.etapas || {};
        const falta = preparando() && !!ids && ids.some(id => !es[id] || (es[id].estado !== 'ok' && es[id].estado !== 'pulado'));
        const s = SHC.statusSync(status, Date.now()), resto = s.estado === 'erro' ? 'A leitura não terminou. ' + (s.fazer || '') : 'O resto aparece sozinho quando a leitura terminar.';
        return falta ? '<p id="parcial" role="status"><span class="marca">Parcial</span>Esta aba mostra o que já foi lido. ' + esc(resto) + SHC.htmlEtapa(status, ids) + '</p>' : '';
    }
    // Topo de cada aba: "Parcial" (1ª leitura) + o cartão recolhido "3 alertas · Ver" com os alertas só deste módulo.
    let alertasAgora = null;
    function desenhaTopoAba() {
        const el = $('#ta-' + aba);
        if (!el) return;
        const lista = alertasAgora ? P.alertasDaAba(aba, alertasAgora, anom, conta) : [], k = 'al:' + aba;
        // Mesma lógica da Geral em cada aba: a leitura dela (se está rodando agora) no topo, os resultados (já lidos) depois.
        const lendo = !preparando() && ETAPAS_ABA[aba] ? SHC.htmlEtapa(status, ETAPAS_ABA[aba]) : '';
        el.innerHTML = parcialHtml() + lendo + (lista.length ? `<div class="card alab"><div class="gb-l"><i class="dot ruim"></i><b>${esc(SHC.qtd(lista.length, 'alerta', 'alertas'))}</b><span class="gb-v"></span>${btVer(k, 'Ver', 'Esconder')}</div>`
            + (aberto(k) ? '<div class="gb-c">' + lista.map(i => `<div class="linha-comp"><b>${esc(i.rot)}${i.titulo ? ' · ' + esc(curtoTxt(i.titulo, 60)) : ''}</b><small>${esc(i.texto)}</small>`
                + (i.link && /^https:\/\/([a-z]+\.)*mercadolivre\.com\.br\//.test(i.link) ? `<a class="lnk" href="${esc(i.link)}" target="_blank" rel="noopener" style="font-size:11.5px">${esc(i.linkTxt || 'Abrir Gestão de envios Full')}</a>` : '') + '</div>').join('') + '</div>' : '')
            + '</div>' : '');
    }
    const curtoTxt = (t, n) => { const s = String(t || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
    // Nomes das contas para as telas: {id: {apelido}} com o apelido de Ajustes, senão o nome da própria conta lido do ML, senão "Conta ID …1234".
    const nomesContas = () => Object.keys(contas || {}).reduce((o, id) => { o[id] = { apelido: SHC.nomeConta(id, cfg, contas) }; return o; }, {});

    // ── Guia até o fim (SHC.guiaProximo): cartão "Próximo passo" no topo ─────────────────────
    // Etapa que acabou de ficar pronta mostra "✓ Pronto" por ~2 s e o cartão já passa para a próxima.
    let guiaUlt = null, guiaPronto = null, guiaLista = false, guiaTimer = null, carregado = false;
    const estadoGuia = () => SHC.guiaProximo({ cfg, status, anuncios, custos: Object.assign({}, custosMl, cadSku), vm, guia, icone,
        temFull: full ? full.temFull : undefined, temPromos: snap && snap.vazio ? false : undefined });
    function desenhaGuia() {
        if (!carregado) return;   // antes da 1ª leitura o estado é o padrão: não inventa "✓ Pronto"
        const alvo = $('#guia'), r = estadoGuia(), antes = guiaUlt;
        guiaUlt = r.proxima ? r.proxima.id : 'fim';
        const pronta = antes && antes !== guiaUlt && r.etapas.find(e => e.id === antes && (e.feito || e.pulado));
        if (pronta && !guiaPronto) {
            guiaPronto = { titulo: pronta.titulo, fim: r.concluido };
            clearTimeout(guiaTimer);
            guiaTimer = setTimeout(() => { guiaPronto = null; desenhaGuia(); }, r.concluido ? 4000 : 2000);
        }
        if (guiaPronto) {
            alvo.hidden = false;
            alvo.innerHTML = `<p class="g-ok">✓ Pronto: ${esc(guiaPronto.titulo)}</p>` + (guiaPronto.fim ? '<p class="g-fim">Tudo pronto! O Copiloto já está trabalhando para você.</p>' : '');
            return;
        }
        if (r.concluido) {
            const cu = r.etapas.find(e => e.id === 'custos');
            if (!(cu && cu.pulado && !cu.feito)) { alvo.hidden = true; alvo.innerHTML = ''; return; }
            alvo.hidden = false;   // lembrete discreto: custos pulados → sem lucro nas etiquetas
            alvo.innerHTML = `<p class="g-det">Lembrete: você pulou os custos. Sem eles, o Copiloto não calcula o lucro.${cu.detalhe ? ' ' + esc(cu.detalhe) + '.' : ''}</p><div class="g-acoes"><button class="bt leve" data-guia-acao="custos">Informar custos</button></div>`;
            return;
        }
        const p = r.proxima, def = SHC.GUIA_ETAPAS.find(e => e.id === p.id);
        alvo.hidden = false;
        // Compacto: 1 linha (passo, título e os botões) + "Ver etapas", que abre o porquê, o detalhe e a lista.
        alvo.innerHTML = `<div class="g-lin"><small>Próximo passo · ${r.etapas.indexOf(p) + 1} de ${r.total}</small><b>${esc(def.titulo)}</b>`
          + `<button class="bt mini" data-guia-acao="${p.id}">${esc(def.botao)}</button>${def.pular ? `<button class="bt leve mini" data-guia-pular="${p.id}">${esc(def.pular)}</button>` : ''}`
          + `<button class="lnk" data-guia-lista>${guiaLista ? 'Esconder etapas' : 'Ver etapas'}</button></div>`
          + (guiaLista ? `<div class="prog"><i style="width:${Math.round(r.feitas / r.total * 100)}%"></i></div><p class="g-pq">${esc(def.porque)}</p>
          ${p.detalhe ? `<p class="g-det">${esc(p.detalhe)}${p.obs ? ` <span>· ${esc(p.obs)}</span>` : ''}</p>` : ''}`
            + '<div class="g-lista">' + r.etapas.map(e => `<div class="${e.feito || e.pulado ? 'ok' : ''}"><span>${e.feito ? '✓' : (e.pulado ? '–' : '○')}</span>${esc(e.titulo)}${e.pulado ? ' <small>(pulada)</small>' : ''}</div>`).join('') + '</div>' : '');
    }
    const abrePagina = p => chrome.tabs.create({ url: chrome.runtime.getURL(p) });
    // Uma ação por etapa: só navegação (páginas do ML e da extensão) e leitura da conta. Nada escreve no ML.
    const ACAO_GUIA = {
        imposto: () => abrePagina('painel.html#guia-1'),
        icone: () => abrePagina('painel.html#guia-2'),
        conta: () => sincronizar(),
        custos: () => abrePagina('painel.html#guia-custos'),   // pelo guia: barra fixa e a aba fecha ao salvar (Ajustes abre #custos, sem isso)
        lucro: () => chrome.tabs.create({ url: URL_LUCRO }),
        promos: () => chrome.tabs.create({ url: URL_PROMOS }),
        fechamento: () => abrePagina('fechamento.html'),
        ads: () => abrePagina('ads.html'),
        full: () => abreAba('full'),
    };
    // Pular: custos = "Já informei os principais" (feitos.custos); ícone e Full = pulados.<id>.
    async function pularGuia(id) {
        if (!SHC.GUIA_ETAPAS.some(e => e.id === id && e.pular)) return;
        await SHC.salvarGuia(id === 'custos' ? { feitos: { custos: SHC.hoje() } } : { pulados: { [id]: true } });
    }
    // "Rever o guia" (Ajustes): zera feitos/pulados/tours do guia. Custos, imposto e leituras ficam (e continuam valendo).
    async function reverGuia() {
        const zero = {};
        SHC.GUIA_ETAPAS.forEach(e => { zero[e.id] = false; });
        guiaUlt = null; guiaPronto = null; clearTimeout(guiaTimer);
        await SHC.salvarGuia({ feitos: zero, pulados: zero, tours: { anuncios: false, promos: false } });
        $('#okGuia').textContent = '✓ O guia voltou para o topo do painel.';
    }
    async function reverTour() {
        const tours = {};
        Object.keys(guia.tours || {}).concat(['anuncios', 'promos']).forEach(k => { tours[k] = false; });
        $('#okTour').textContent = '✓ O tour aparece de novo na próxima vez que você abrir Anúncios ou a Central de promoções.';
        await SHC.salvarGuia({ tours });
    }

    // ── Promoções ─────────────────────────────────────────────────────────────────────────────
    const custoDaProp = p => { const c = custoProp.get(p); return c ? c.dados : null; };
    function resumoFamilia(f, cfgUsar) {
        const c = cfgUsar || cfg;
        const props = propsPorFam[f.chave] || [];
        const custo = custoFam[f.chave] ? custoFam[f.chave].dados : null;
        const { linhas, rec } = P.recalculaFamilia(props, p => custoDaProp(p) || custo, c);
        let classe = 'sem_custo';
        const com = linhas.filter(l => l.sobra !== null);
        if (com.length) classe = com.reduce((a, b) => (b.sobra > a.sobra ? b : a)).classe;
        if (rec) linhas.sort((a, b) => (b === rec.escolha) - (a === rec.escolha));
        return { f, props: linhas, custo, classe, rec, skus: skusFam[f.chave] || [] };
    }

    function notaRecomendacao(r) {
        const rec = r.rec;
        if (!rec) return '';
        const meta = SHC.pctTxt(SHC.num(cfg.margem_alvo_pct) || 0);
        const pm = rec.precoMeta ? SHC.moeda(rec.precoMeta) : null;
        let txt = '', cls = '';
        if (rec.tipo === 'ideal') {
            txt = rec.atingem > 1
                ? `${rec.atingem} propostas batem sua meta de ${meta}; a marcada tem o maior desconto e mantém a meta.`
                : `A marcada é a única que bate sua meta de ${meta}.`;
            if (pm) txt += ` Preço mínimo para a meta (estimativa): ${pm}.`;
            cls = 'ok';
        } else if (rec.tipo === 'aproximada') {
            txt = `Nenhuma proposta chega na sua meta de ${meta}. A marcada é a que mais se aproxima e ainda dá lucro.` + (pm ? ` Para a meta, o preço mínimo (estimativa) é ${pm}.` : '');
            cls = 'aviso';
        } else {
            txt = 'Todas as propostas dão prejuízo.' + (pm ? ` Para a sua meta de ${meta}, o preço mínimo (estimativa) é ${pm}.` : '');
            cls = 'ruim';
        }
        return `<div class="recnota ${cls}">${esc(txt)}</div>`;
    }

    function caixaExplica(r) {
        const chave = r.f.chave, m = simMeta[chave];
        let resp;
        if (m !== undefined && m !== null) {
            const cTemp = Object.assign({}, cfg, { margem_alvo_pct: m });
            const x = resumoFamilia(r.f, cTemp);
            resp = P.explicaPromo(x.props, x.rec, cTemp);
            resp.linhas.unshift(`Simulação com meta de ${SHC.pctTxt(m)} (nada foi salvo):`);
        } else resp = P.explicaPromo(r.props, r.rec, cfg);
        return `<div class="ia-box">${respHtml(resp)}
          <div class="sim"><label>E se minha meta for</label><input class="inp" data-sim-meta="${esc(chave)}" inputmode="decimal" placeholder="${esc(String(cfg.margem_alvo_pct).replace('.', ','))}" value="${m !== undefined && m !== null ? esc(String(m).replace('.', ',')) : ''}"><span>%</span><button class="bt leve" data-sim="${esc(chave)}">Ver</button></div></div>`;
    }

    // ── v2.9: Robô de promoções — MODO SUGERIR. As sugestões são as mesmas contas da Central (melhor opção, sobra), com a meta =
    // margem mínima do robô; o histórico vem do fundo (robopromo:<conta>, uma passada por sincronização). Não entra em promoção:
    // "Abrir no ML para participar" só abre a Central de promoções; o Automático fica bloqueado (SHC.PROMO_ADESAO_CONFERIDA = false).
    const rpCfg = () => cfg.robopromo || {};
    const sugestoesRobo = () => (snap && rpCfg().ligado ? SHC.roboPromoSugestoes(snap, custoDaProp, cfg) : []);
    function desenhaRoboPromo() {
        const lig = !!rpCfg().ligado, margem = SHC.roboPromoMargem(cfg), mTxt = SHC.pctTxt(margem), sugs = sugestoesRobo();
        const mP = SHC.num(rpCfg().margem_pct), padrao = String(SHC.num(cfg.margem_alvo_pct) || 0).replace('.', ',');
        $('#promoTopo').innerHTML = !lig || !snap ? ''
            : sugs.length ? `<p class="manchete"><span class="pt ok"></span><b>O robô achou ${esc(SHC.qtd(sugs.length, 'promoção que mantém', 'promoções que mantêm'))} a sua margem mínima de ${esc(mTxt)}.</b> Abra no Mercado Livre para participar.</p>`
            : `<p class="manchete"><span class="pt"></span><b>Nenhuma promoção mantém a sua margem mínima de ${esc(mTxt)} agora.</b> O robô confere de novo a cada sincronização.</p>`;
        let h = '';
        if (lig && sugs.length) {
            const n = aberto('robopromo:sug') ? sugs.length : 5;
            h += `<div class="card"><div class="ch"><h3>O robô sugere entrar</h3><span class="selo ok d">${esc(SHC.qtd(sugs.length, 'promoção', 'promoções'))}</span></div><ul class="acoes">`
                + sugs.slice(0, n).map(s => `<li class="acao ok sug"><div class="tx"><b title="${esc(s.titulo + ' · ' + s.promo)}">${esc(curtoTxt(s.titulo || s.itemId, 34) + ' · ' + s.promo)}</b>`
                    + `<span>${s.datas ? `<span class="prazo">${esc(s.datas)}</span> ` : ''}margem ${esc(SHC.pctTxt(s.pct))} · sobra ${esc(SHC.moeda(s.sobra))} por venda</span></div>`
                    + '<button class="bt pq ml" data-abrir-ml>Abrir no ML para participar</button></li>').join('') + '</ul>'
                + (sugs.length > 5 ? `<p class="rs">${esc(SHC.qtd(sugs.length - 5, 'outra promoção', 'outras promoções'))} ${btVer('robopromo:sug')}</p>` : '')
                + '<p class="rs">O Copiloto não entra sozinho: você confere e participa na Central de promoções.</p></div>';
        }
        const hist = ((roboPromo && roboPromo.historico) || []).slice(-30).reverse();
        if (hist.length) h += `<div class="card"><div class="ch"><h3>Histórico do robô</h3></div><p class="rs">${esc(SHC.qtd(hist.length, 'sugestão guardada', 'sugestões guardadas'))} ${btVer('robopromo:hist')}</p>`
            + (aberto('robopromo:hist') ? '<ul class="tl">' + hist.map(x => `<li class="ok"><div class="dt">${esc(P.quando(x.ts))} · sugeriu</div><div class="ev">${esc(curtoTxt(x.titulo || x.itemId, 40) + ' · ' + x.promo)}</div>`
                + `<div class="sub">margem ${esc(SHC.pctTxt(x.pct))} · sobra ${esc(SHC.moeda(x.sobra))} por venda</div></li>`).join('') + '</ul>' : '') + '</div>';
        const auto = SHC.PROMO_ADESAO_CONFERIDA === true;
        h += `<div class="card" id="cardRoboPromo"><div class="robo-top"><div class="nm"><b>Robô de promoções</b><span>${lig ? 'Ligado · mostra só as promoções que mantêm a sua margem mínima' : 'Desligado · ligue para ver as promoções que mantêm a sua margem mínima'}</span></div>`
            + `<input type="checkbox" class="tg" id="roboLigado"${lig ? ' checked' : ''} aria-label="Ligar o robô de promoções"></div>`
            + `<div class="robo-cfg"><label for="margemRobo"><b>Margem mínima</b><span>o que sobra depois de tarifa, frete e imposto${mP === null ? ' · hoje é a sua meta' : ''}</span></label>`
            + `<div class="sufixo"><input class="inp" id="margemRobo" inputmode="decimal" placeholder="${esc(padrao)}" value="${mP === null ? '' : esc(String(mP).replace('.', ','))}"><span>%</span></div><button class="bt pq" data-robopromo-margem>Salvar</button></div>`
            + '<div class="opcs" role="radiogroup" aria-label="O que o robô faz">'
            + '<label class="opc on"><input type="radio" name="modoRoboPromo" checked><span><b>Sugerir</b>Mostra as promoções boas; você participa no Mercado Livre.</span></label>'
            + `<label class="opc off" title="Precisa da sua autorização: o Copiloto ainda não entra sozinho."><input type="radio" name="modoRoboPromo"${auto ? '' : ' disabled'}><span><b>Automático <span class="selo">em breve</span></b>Precisa da sua autorização: o Copiloto ainda não entra sozinho.</span></label></div>`
            + `<p class="det" id="roboPromoMsg" role="status">${esc(roboPromoMsg)}</p></div>`;
        $('#roboPromo').innerHTML = h;
        // Viu as sugestões: tira o ponto do ícone (o fundo guarda novo:false).
        if (roboPromo && roboPromo.novo && aba === 'promo') {
            roboPromo = Object.assign({}, roboPromo, { novo: false });
            try { Promise.resolve(chrome.runtime.sendMessage({ acao: 'robopromo_visto' })).catch(() => {}); } catch (e) { /* fundo reiniciando */ }
        }
    }
    // Liga/desliga e margem mínima: objeto NOVO em cfg.robopromo; não marca "configurado" (salvarCfgRobo) e redesenha já.
    async function mudaRoboPromo(patch, msg) {
        const novo = Object.assign({}, rpCfg(), patch);
        cfg = Object.assign({}, cfg, { robopromo: novo }); roboPromoMsg = msg || '';
        desenhaPromo();
        try { await salvarCfgRobo({ robopromo: novo }); } catch (e) { falhaGravar(e); }
    }
    async function salvarMargemRobo() {
        const txt = String($('#margemRobo').value || '').trim(), [lo, hi] = SHC.FAIXAS.margem_alvo_pct, v = txt === '' ? null : SHC.num(txt);
        if (txt !== '' && (v === null || v < lo || v > hi)) { roboPromoMsg = `Digite uma margem entre ${lo} e ${hi}%.`; $('#roboPromoMsg').textContent = roboPromoMsg; return; }
        $('#margemRobo').blur();
        await mudaRoboPromo({ margem_pct: v }, v === null ? '✓ O robô usa a sua meta de Ajustes.' : '✓ Margem mínima salva.');
    }

    function desenhaPromo() {
        desenhaRoboPromo();
        const alvo = $('#listaPromo');
        // V14: estados sem lista — sem sessão, falha de leitura, lendo agora, nunca lido e "nenhuma promoção aberta" (retrato vazio).
        const falhaPromo = status.erroPromos ? `<div class="recnota aviso" style="margin:0 0 8px">Não consegui ler as promoções na última sincronização.${snap ? ' Mostrando a leitura de ' + esc(tempo(snap.ts)) + '.' : ''}</div>` : '';
        if (!snap || !snap.familias.length) {
            const semSessao = status.erro === 'sem_sessao', lendo = status.estado === 'sincronizando' && !P.syncParado(status);
            const [tit, txt] = semSessao ? ['Entre no Mercado Livre', 'Abra o painel do vendedor do Mercado Livre neste Chrome (logado) e clique em “Sincronizar agora”.']
                : snap ? ['Nenhuma promoção aberta nesta conta', 'A Central de promoções do Mercado Livre não tem proposta para você agora' + (snap.ts ? ' (leitura ' + tempo(snap.ts) + ')' : '') + '.']
                : lendo ? ['Buscando suas promoções…', 'Isso leva alguns segundos na primeira vez.']
                : ['Promoções ainda não lidas', 'Clique em “Sincronizar agora” no alto do painel.'];
            alvo.innerHTML = falhaPromo + `<div class="vazio"><b>${esc(tit)}</b>${esc(txt)}<br><br><button class="bt leve" data-abrir-ml>Abrir a Central de promoções</button></div>`;
            $('#kpis').innerHTML = '';
            $('#promoVer').hidden = true; $('#promoMais').hidden = false;
            return;
        }
        const todos = snap.familias.map(f => resumoFamilia(f));
        // Recolhido: só os números (tocar num número abre a lista filtrada); "Ver os N produtos" abre a lista inteira.
        const ab = aberto('promo:lista'), pv = $('#promoVer');
        pv.hidden = false; pv.textContent = ab ? 'Ver menos' : 'Ver ' + SHC.qtd(todos.length, 'produto', 'produtos');
        $('#promoMais').hidden = !ab;
        const n = c => todos.filter(r => r.classe === c).length;
        $('#kpis').innerHTML = ['lucrativo', 'apertado', 'prejuizo', 'sem_custo'].map(c =>
            `<button class="kpi ${c}${filtro === c ? ' on' : ''}" data-filtro="${c}"><small>${ROTULO[c]}</small><b>${n(c)}</b></button>`).join('');
        const b = busca.trim().toLowerCase();
        const lista = todos.filter(r => (!filtro || r.classe === filtro) && (!b || r.f.titulo.toLowerCase().indexOf(b) >= 0 || r.skus.some(s => s.toLowerCase().indexOf(b) >= 0)));
        alvo._lista = lista;
        if (!ab) { alvo.innerHTML = ''; return; }
        if (!lista.length) { alvo.innerHTML = falhaPromo + '<div class="vazio">Nenhum produto neste filtro.</div>'; return; }
        alvo.innerHTML = falhaPromo + lista.slice(0, limite.promo).map(r => {
            const f = r.f, temCusto = r.custo && SHC.num(r.custo.custo) > 0;
            const chave = f.chave;
            const onde = r.skus.length === 1 ? 'SKU ' + r.skus[0] : (r.skus.length > 1 ? 'Tem ' + r.skus.length + ' SKUs: custos no Catálogo' : '');
            // Mais de 1 SKU: cada SKU tem o seu custo (o mesmo que as propostas usam); edita no Catálogo.
            const custoHtml = r.skus.length > 1
                ? `<div class="custo-ok"><span>${r.skus.map(k => { const c = custoGrupo['sku:' + k]; return esc(k) + ': ' + (c ? SHC.moeda(SHC.num(c.dados.custo)) : 'sem custo'); }).join(' · ')}</span><button data-ir-cat="${esc(chave)}">editar no Catálogo</button></div>`
                : (!temCusto || editando === chave)
                ? `<div class="custo"><label>Custo do produto</label><input class="inp" data-custo="${esc(chave)}" inputmode="decimal" placeholder="R$ 0,00" value="${esc(temCusto ? nfr(SHC.num(r.custo.custo)) : '')}"><button class="bt" data-salvar="${esc(chave)}">Salvar</button></div>`
                : `<div class="custo-ok">Custo <b>${SHC.moeda(SHC.num(r.custo.custo))}</b><button data-editar="${esc(chave)}">editar</button></div>`;
            const mostrar = abertos.has(chave) ? r.props : r.props.slice(0, 3);
            const props = r.props.length ? mostrar.map(l => {
                const p = l.p;
                const sob = l.sobra === null ? '<span class="sobra sem_custo">informe o custo</span>'
                    : `<span class="sobra ${l.classe}">${l.sobra < 0 ? 'Prejuízo' : 'Lucro'} ${SHC.moeda(Math.abs(l.sobra))} · margem ${SHC.pctTxt(l.pct)}</span>`;
                const selo = r.rec && r.rec.escolha === l
                    ? (r.rec.tipo === 'ideal' ? '<span class="selo ideal">★ Ideal para sua meta</span>' : (r.rec.tipo === 'aproximada' ? '<span class="selo aprox">≈ Mais perto da meta</span>' : ''))
                    : '';
                return `<div class="prop${selo ? ' destaque' : ''}">${selo}<div class="l1p"><span class="nome" title="${esc(p.promo)}">${esc(p.promo)}</span><span class="datas">${esc(p.datas)}${p.desconto_txt ? ' · ' + esc(p.desconto_txt) : ''}</span></div>
                  <div class="l2p"><span class="preco">${SHC.moeda(p.preco)}</span><span class="recebe">você recebe ${SHC.moeda(p.recebe)}</span>${sob}</div>
                  <div class="det">Tarifa ${SHC.moeda(p.tarifa)}${p.tipo ? ' (' + esc(p.tipo) + ')' : ''} · Envio ${p.envio ? SHC.moeda(p.envio) : 'do comprador'}${l.imposto ? ' · Imposto ' + SHC.moeda(l.imposto) : ''}</div></div>`;
            }).join('') + (r.props.length > 3 && !abertos.has(chave) ? `<button class="mais" data-abrir="${esc(chave)}">+ ${SHC.qtd(r.props.length - 3, 'proposta', 'propostas')}</button>` : '')
                + notaRecomendacao(r)
                : '<div class="det" style="margin-top:8px">Sem proposta de promoção para este produto agora.</div>';
            const expl = `<button class="lnk explique" data-explique="${esc(chave)}">${explicando === chave ? 'Fechar explicação' : 'Explique: por que esta é a melhor?'}</button>` + (explicando === chave ? caixaExplica(r) : '');
            return `<div class="card"><div class="fam">${f.foto ? `<img src="${esc(f.foto)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<img alt="">'}
              <div style="min-width:0"><div class="tit">${esc(f.titulo)}</div><div class="sub">${esc([onde, f.estoque, f.tipos].filter(Boolean).join(' · '))}</div></div></div>
              ${custoHtml}${props}${expl}</div>`;
        }).join('') + botaoMais('promo', lista.length - limite.promo);
    }

    // ── Frete ─────────────────────────────────────────────────────────────────────────────────
    const linhasFrete = () => P.linhasFrete(itens, fretes, freteHist && freteHist.porAnuncio);
    const varDe = l => (l.fa && typeof l.fa.variacaoPct === 'number' ? l.fa.variacaoPct : (l.h ? l.h.varPct : 0)) || 0;

    // "N anúncios lidos · vendas: lendo mês 5 de 12 (falta cerca de 3 min)"; durante a leitura só esta linha é trocada (soStatus).
    let freteN = 0;
    const andamFrete = () => { const v = P.vendasAndamento(status, Date.now()); return freteN + (freteN === 1 ? ' anúncio lido' : ' anúncios lidos') + (v ? ' · ' + v : ''); };
    // Chip do anúncio na lista: frete COBRADO nos pedidos (30 dias × 30 anteriores); sem pedido, o valor diário da lista do ML.
    function chipFrete(l, cob) {
        if (l.comprador) return '<span class="var igual">Frete por conta do comprador</span>';
        const fa = l.fa, u = fa && fa.ult30, a = fa && fa.ant30;
        if (u && u.pedidos) {
            const v = fa.variacaoPct, f = P.formatoDoAnuncio(fa);
            return `<span class="var ${fa.subiu ? 'sobe' : (typeof v === 'number' && v < 0 ? 'desce' : 'igual')}">médio ${SHC.moeda(u.medio)}${a && a.pedidos ? ' × ' + SHC.moeda(a.medio) + ' antes' : ''}${typeof v === 'number' ? ' (' + esc(P.varPct(v)) + ')' : ''}</span>`
                + `<span class="var igual">${esc(SHC.qtd(u.pedidos, 'pedido', 'pedidos'))}${f ? ' · ' + esc(f) : ''}</span>`;
        }
        if (a && a.pedidos) return `<span class="var igual">sem pedido nos últimos 30 dias · antes ${SHC.moeda(a.medio)}</span>`;
        const h = l.h;
        if (!h) return `<span class="var igual">${cob ? 'sem pedido com frete desde ' + esc(P.dataBr(freteHist.desde).slice(0, 5)) : 'sem histórico ainda'}</span>`;
        return h.anterior === null ? `<span class="var igual">sem variação desde ${esc(P.dataBr(h.primeiro).slice(0, 5))}</span>`
            : `<span class="var ${l.subiu ? 'sobe' : 'desce'}">${esc(mais(h.varRs))} (${esc(maisPct(h.varPct))}) desde ${esc(P.dataBr(h.desde).slice(0, 5))}</span>`;
    }
    function desenhaFrete() {
        const alvo = $('#listaFrete');
        if (!itens.length) {
            alvo.innerHTML = '<div class="vazio"><b>Lista de anúncios ainda não lida</b>O frete de cada anúncio da sua conta aparece aqui depois da próxima sincronização.<br><br><button class="bt leve" data-abrir-anuncios>Abrir meus anúncios no ML</button></div>';
            $('#freteTopo').hidden = true;
            return;
        }
        if (freteDet) { const it = itens.find(x => x.itemId === freteDet); if (it) { $('#freteTopo').hidden = true; return desenhaFreteDetalhe(it); } freteDet = null; }
        $('#freteTopo').hidden = false;
        const cob = P.temFreteCob(freteHist), ct = cob ? freteHist.conta : null, cc = P.concDe(freteHist), conc = P.concFrete(cc), semLer = P.freteSemLeitura(freteHist);
        const linhas = linhasFrete().sort((a, b) => (b.subiu - a.subiu) || (varDe(b) - varDe(a)));
        const subiram = linhas.filter(l => l.subiu).length, pa = (cc && cc.pagoAMais) || [], idsAMais = new Set(pa.map(p => p.itemId));
        const temVendas = itens.some(it => Object.keys(vendas[it.itemId] || {}).length);
        const rk = temVendas ? P.rankingFrete(itens, vendas) : null;
        freteN = linhas.length;
        // KPIs: cada um filtra a lista (tocar de novo tira o filtro).
        const kS = `<button class="kpi${subiram > 0 ? ' prejuizo' : ''}${freteFiltro === 'subiu' ? ' on' : ''}" data-ffiltro="subiu"><small>Frete subiu</small><b>${subiram}</b><span class="k2l">${subiram === 1 ? 'anúncio' : 'anúncios'}</span></button>`;
        let html = `<p class="andam">${esc(andamFrete())}</p>`;
        if (cob) {
            const u = ct.ult30, a = ct.ant30, vp = P.varPct(ct.variacaoPct);
            html += `<div class="kpis${conc ? ' k3' : ' k2'}">
              <button class="kpi${freteFiltro === '' ? ' on' : ''}" data-ffiltro=""><small>Últimos 30 dias</small><b>${SHC.moeda(u.total)}</b><span class="k2l">${esc(SHC.qtd(u.pedidos, 'pedido', 'pedidos'))}${vp ? ' · contra os 30 dias anteriores: ' + esc(vp) + ' por pedido' : ''}</span></button>
              ${kS}${conc ? `<button class="kpi${pa.length ? ' prejuizo' : ''}${freteFiltro === 'amais' ? ' on' : ''}" data-ffiltro="amais"><small>Pago a mais</small><b>${SHC.moeda(cc.totalAMais || 0)}</b><span class="k2l">em ${esc(SHC.qtd(pa.length, 'pedido', 'pedidos'))}</span></button>` : ''}</div>
              <p class="det" style="margin:0 2px 10px">${semLer ? esc(semLer) + ': a comparação com os 30 dias anteriores fica para depois' : '30 dias anteriores: ' + (a.pedidos ? SHC.moeda(a.total) + ' em ' + esc(SHC.qtd(a.pedidos, 'pedido', 'pedidos')) : 'nenhum pedido com frete')}.`
                + (!semLer && u.medio !== null && a.medio !== null ? ` Frete médio por pedido: ${SHC.moeda(a.medio)} → ${SHC.moeda(u.medio)}.` : '')
                + (u.descontoML > 0 ? ` Desconto do ML no frete dos últimos 30 dias: ${SHC.moeda(u.descontoML)}.` : '')
                + ` Dados do Faturamento do ML desde ${esc(P.dataBr(freteHist.desde).slice(0, 5))}.</p>`
                + (!conc && freteHist.vendasLidas === false ? '<p class="nota"><span class="auto"></span><span>A conciliação aparece quando as vendas forem lidas (próxima sincronização).</span></p>' : '');
        } else {
            html += `<div class="kpis k2"><button class="kpi${freteFiltro === '' ? ' on' : ''}" data-ffiltro=""><small>Com frete grátis</small><b>${linhas.filter(l => !l.comprador).length}</b><span class="k2l">anúncios</span></button>${kS}</div>
              <p class="nota"><span class="auto"></span><span>${esc(P.freteSemDado(freteHist, status, Date.now()))}</span></p>`;
        }
        // Conciliação: frete cobrado em cada pedido × frete do anúncio.
        if (conc) {
            html += `<div class="card"><b style="font-size:13px">Conciliação do frete</b>
              <p style="margin:6px 0 0;font-size:12.5px"><b>${esc(conc.titulo)}</b></p>
              ${cc.vendas ? `<div class="barra-g" role="progressbar" aria-label="Pedidos conciliados" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${conc.pct}"><i style="width:${conc.pct}%"></i></div>` : ''}
              <p class="det">Conciliar = comparar o frete cobrado em cada pedido com o frete do anúncio.</p>${conc.motivos.map(m => `<p class="det">${esc(m)}</p>`).join('')}`;
            if (pa.length) {
                html += `<p class="det"><b class="vm">${esc(SHC.qtd(pa.length, 'pedido cobrado', 'pedidos cobrados'))} acima do frete do anúncio: ${SHC.moeda(cc.totalAMais || 0)} a mais.</b> ${btVer('frete:amais', 'Ver os pedidos', 'Esconder')}</p>`;
                if (aberto('frete:amais')) html += `<table class="tabf"><thead><tr><th>Pedido</th><th>Data</th><th>Cobrado</th><th>Anúncio</th><th>A mais</th></tr></thead><tbody>
                    ${pa.slice(0, 20).map(p => `<tr><td>${esc(p.pedido)}${p.talvezUnidades ? '*' : ''}</td><td>${esc(P.dataBr(p.data).slice(0, 5))}</td><td>${SHC.moeda(p.cobrado)}</td><td>${SHC.moeda(p.esperado)}</td><td class="mais">+${SHC.moeda(p.diferenca)}</td></tr>`).join('')}
                  </tbody>${pa.length > 20 ? `<tfoot><tr><td colspan="5">e mais ${SHC.qtd(pa.length - 20, 'pedido', 'pedidos')}: toque em “Pago a mais” para ver os anúncios</td></tr></tfoot>` : ''}</table>`
                    + (pa.some(p => p.talvezUnidades) ? '<p class="det">* Frete bem maior que o do anúncio: o pedido pode ter mais de 1 unidade. Confira antes de reclamar.</p>' : '');
            }
            html += '<p class="det">Fonte: Faturamento do ML (frete cobrado) e lista de Anúncios (frete do anúncio hoje).</p></div>';
        }
        // Formatos de frete dos últimos 30 dias (só os que existem nos dados).
        const fm = cob ? P.formatosFrete(ct.porFormato) : [];
        if (fm.length) {
            const pf = ct.porFormato, cp = pf.compradorPaga, notas = [];
            if (pf.full || pf.flex) notas.push('Full e Flex são a forma de entrega: esses pedidos também contam nas linhas de cima.');
            if (cp) notas.push('Comprador paga: o ML não cobra frete de você; o valor é o custo operacional do ML' + (cp.pedidos === null ? ' (os pedidos aparecem quando as vendas forem lidas)' : '') + '.');
            if (pf.cancelado && pf.cancelado.pedidos) notas.push(SHC.qtd(pf.cancelado.pedidos, 'pedido cancelado', 'pedidos cancelados') + ': o ML devolveu o frete.');
            if (freteHist.aprox > 0) notas.push('Os formatos contam só os pedidos em que o ML informou o tipo de frete.');
            const n = v => (v === null ? '—' : P.milhar(v));
            html += `<div class="card"><b style="font-size:13px">Formatos de frete · últimos 30 dias</b>
              <table class="tabf"><thead><tr><th>Formato</th><th>Anúncios</th><th>Pedidos</th><th>Valor</th></tr></thead><tbody>
                ${fm.map(f => `<tr><td>${esc(f.rot)}</td><td>${n(f.anuncios)}</td><td>${n(f.pedidos)}</td><td>${SHC.moeda(f.total).replace('R$ ', 'R$\u00a0')}</td></tr>`).join('')}
              </tbody></table>${notas.map(t => `<p class="det">${esc(t)}</p>`).join('')}</div>`;
        }
        if (rk && rk.grupos.length) {
            html += dobra(`<div class="card"><b style="font-size:13px">Frete pago a mais por SKU</b>
              <div class="kpis k2" style="margin:8px 0"><div class="kpi prejuizo" style="cursor:default"><small>Lucro perdido em 12 meses</small><b>${SHC.moeda(rk.total12)}</b></div><div class="kpi${rk.total > 0 ? ' prejuizo' : ''}" style="cursor:default"><small>Em ${esc(P.nomeMes(rk.mes))}</small><b>${SHC.moeda(rk.total)}</b></div></div>
              <div class="rank">${rk.grupos.slice(0, 5).map(g => `<button data-frete-det="${esc(g.itemIds[0])}"><b>${esc(g.titulo)}</b><b class="v">${SHC.moeda(g.total12)}</b><small>${esc(g.sku || g.itemIds[0])}${g.itemIds.length > 1 ? ' · ' + g.itemIds.length + ' anúncios' : ''} · ${esc(P.nomeMes(rk.mes))}: ${g.aMais > 0 ? '+' + SHC.moeda(g.aMais) + ' (+' + SHC.moeda(g.porVenda) + '/venda)' : 'sem aumento'}</small></button>`).join('')}</div>
              <p class="det">${SHC.qtd(rk.grupos.length, 'SKU pagou', 'SKUs pagaram')} frete maior de ${esc(P.nomeMes(rk.desde))} a ${esc(P.nomeMes(rk.mes))}. ${CONTA_FRETE} Fonte: Faturamento do Mercado Livre.</p></div>`,
                'frete:rank', esc(SHC.moeda(rk.total12) + ' em 12 meses'));
        } else if (rk) {
            html += `<p class="nota"><span class="auto"></span><span>Nenhum SKU pagou frete maior que o de antes de ${esc(P.nomeMes(rk.desde))} a ${esc(P.nomeMes(rk.mes))}.</span></p>`;
        }
        // Por anúncio: recolhida ("Ver todos"); um filtro ou a busca abrem.
        const b = freteBusca.trim().toLowerCase(), abL = aberto('frete:lista') || !!b;
        const vis = linhas.filter(l => (!freteFiltro || (freteFiltro === 'subiu' ? l.subiu : idsAMais.has(l.it.itemId)))
            && (!b || String(l.it.titulo).toLowerCase().indexOf(b) >= 0 || l.it.itemId.toLowerCase().indexOf(b) >= 0 || String(l.it.sku).toLowerCase().indexOf(b) >= 0));
        const rotF = freteFiltro === 'subiu' ? ' · filtro: frete subiu' : freteFiltro === 'amais' ? ' · filtro: pago a mais' : '';
        html += `<div class="card"><b style="font-size:13px">Frete por anúncio</b> <span class="res">· ${esc(SHC.qtd(linhas.length, 'anúncio', 'anúncios'))}${subiram ? ' · ' + subiram + ' com frete subindo' : ''}${esc(rotF)}</span>`
            + (b ? '' : btVer('frete:lista', 'Ver todos (' + P.milhar(vis.length) + ')', 'Ver menos'))
            + (abL ? '<p class="det">Médio = frete cobrado por pedido nos últimos 30 dias × 30 anteriores (Faturamento do ML). À direita, o frete do anúncio hoje (lista do ML).</p>' : '') + '</div>';
        if (abL) {
            html += '<p class="legenda"><span class="sit-ruim">Frete subiu ou dá prejuízo</span><span class="sit-atencao">Subiu pouco ou sem custo</span><span class="sit-ok">Estável e com lucro</span></p>';
            html += vis.length ? vis.slice(0, limite.frete).map(l => {
                const so = sobraDe(l.it), sit = P.situacaoFrete(l, so);
                const lucro = so && so.sobra !== null ? `<span class="var ${so.sobra < 0 ? 'sobe' : 'desce'}">${so.sobra < 0 ? 'Prejuízo ' + SHC.moeda(-so.sobra) : 'Lucro ' + SHC.moeda(so.sobra)}</span>` : '<span class="var igual">sem custo</span>';
                return `<button class="card linha-fr sit-${sit}" data-frete-det="${esc(l.it.itemId)}"><div class="tit">${esc(l.it.titulo)}</div><div class="sub">${esc(l.it.itemId)}${l.it.sku ? ' · SKU ' + esc(l.it.sku) : ''}</div>
                  <div class="l2p">${chipFrete(l, cob)}${lucro}<span style="margin-left:auto;font-weight:700">${l.comprador || l.hoje === null ? '' : SHC.moeda(l.hoje)}</span><span class="seta">›</span></div></button>`;
            }).join('') + botaoMais('frete', vis.length - limite.frete) : '<div class="vazio">Nenhum anúncio neste filtro.</div>';
        }
        alvo.innerHTML = html;
    }
    const mais = v => (v > 0 ? '+' : v < 0 ? '−' : '') + SHC.moeda(Math.abs(v));
    const maisPct = v => (v > 0 ? '+' : '') + SHC.pctTxt(v);
    const CONTA_FRETE = 'Conta: (frete típico do mês − frete de antes) × vendas do mês, nos meses em que passou mais de R$ 1 e 2% acima; mês que voltou ao normal não conta. Frete típico = o valor do meio dos pedidos do mês.';

    function desenhaFreteDetalhe(it) {
        const alvo = $('#listaFrete');
        const vd = vendas[it.itemId] || {};
        if (it.freteComprador) {   // V9: o valor "A pagar" desse anúncio é taxa operacional do ML, não frete: sem histórico nem chamado
            const tx = SHC.num(it.taxaOperacional);
            alvo.innerHTML = `<button class="lnk" data-voltar-frete>‹ Todos os anúncios</button>
              <div class="card"><div class="tit">${esc(it.titulo)}</div><div class="sub">${esc(it.itemId)}${it.sku ? ' · SKU ' + esc(it.sku) : ''}</div>
                <p style="margin:8px 0 0;font-size:12.5px"><b>Frete por conta do comprador.</b> O Mercado Livre não cobra frete de você neste anúncio.</p>
                ${tx > 0 ? `<p class="det">O ML mostra ${SHC.moeda(tx)} “A pagar” por venda: é uma taxa operacional, não frete. Ela entra na conta do lucro, fora do histórico de frete.</p>` : ''}</div>` + cardSim(it);   // v2.8: aba Frete mostra só o que é de frete — Ads e Afiliados saíram daqui (pedido da dona: "cada função aparecer na sua respectiva tela")
            alvo._item = it; alvo._hist = null; alvo._fa = null;
            return;
        }
        const h = P.historicoFrete(fretes[it.itemId]);
        const porMes = P.freteMensal(vd).meses;
        const temVd = Object.keys(porMes).length > 0;
        const ultMes = (Object.keys(porMes).sort().pop() || '').slice(0, 7);
        const pm = P.pagoAMaisPorMes(vd, ultMes ? P.mesMenos(ultMes, 11) : '', ultMes);   // só a janela; total = lucro perdido em 12 meses
        const hoje = it.frete !== null && it.frete !== undefined ? it.frete : (h ? h.atual : null);
        const varRuim = h && h.varMesRs > 0;
        // v2.5.3: frete COBRADO nos pedidos deste anúncio (30 dias × 30 anteriores, Faturamento do ML), desde o 1º uso.
        const cob = P.temFreteCob(freteHist), fa = cob ? (freteHist.porAnuncio || {})[it.itemId] || null : null;
        const fu = fa && fa.ult30, fx = fa && fa.ant30, temFa = !!(fu && fx && (fu.pedidos || fx.pedidos));
        const ff = temFa ? Object.keys(fa.formatos || {}).sort((a, b) => fa.formatos[b] - fa.formatos[a]).map(k => SHC.qtd(fa.formatos[k], 'pedido', 'pedidos') + ' ' + ({ gratis: 'com frete grátis', compartilhado: 'compartilhados', extra: 'com envio extra' }[k] || '')).join(' · ') : '';
        const kpiFrete = temFa
            ? `<div class="kpi${fa.subiu ? ' prejuizo' : ''}" style="cursor:default"><small>Últimos 30 dias</small><b>${SHC.moeda(fu.medio)}</b><span class="k2l">médio · ${esc(SHC.qtd(fu.pedidos, 'pedido', 'pedidos'))}${typeof fa.variacaoPct === 'number' ? ' · ' + esc(P.varPct(fa.variacaoPct)) : ''}</span></div>
              <div class="kpi" style="cursor:default"><small>30 dias anteriores</small><b>${SHC.moeda(fx.medio)}</b><span class="k2l">médio · ${esc(SHC.qtd(fx.pedidos, 'pedido', 'pedidos'))}</span></div>`
            : `<div class="kpi" style="cursor:default"><small>${h && h.passado ? 'Fim de ' + esc(P.nomeMes(h.passado.m)) : 'Mês passado'}</small><b>${h && h.passado ? SHC.moeda(h.passado.v) : '—'}</b></div>
              <div class="kpi${varRuim ? ' prejuizo' : ''}" style="cursor:default"><small>Variação</small><b style="font-size:13px">${h && h.passado ? esc(mais(h.varMesRs)) + ' · ' + esc(maisPct(h.varMesPct)) : '—'}</b></div>`;
        const expl = (fa && fa.subiu) || (h && h.anterior !== null && h.atual > h.anterior) ? 'Explique: por que o frete subiu?' : h && h.anterior !== null ? 'Explique: por que o frete mudou?' : 'Explique o frete deste anúncio';
        let html = `<button class="lnk" data-voltar-frete>‹ Todos os anúncios</button>
          <div class="card"><div class="tit">${esc(it.titulo)}</div><div class="sub">${esc(it.itemId)}${it.sku ? ' · SKU ' + esc(it.sku) : ''}</div>
            <div class="kpis k2" style="margin:8px 0 0">
              <div class="kpi" style="cursor:default"><small>Frete hoje</small><b>${SHC.moeda(hoje)}</b></div>
              ${kpiFrete}
              <div class="kpi${pm.total > 0 ? ' prejuizo' : ''}" style="cursor:default"><small>Perdido em 12 meses</small><b style="font-size:13px">${temVd ? SHC.moeda(pm.total) : 'sem vendas lidas'}</b></div>
            </div>
            ${temFa ? `<p class="det">${ff ? esc(ff) + ' nos últimos 30 dias. ' : ''}Dados do Faturamento do ML desde ${esc(P.dataBr(freteHist.desde).slice(0, 5))} (frete cobrado em cada pedido).</p>` : ''}
            ${it.freteDeduzido ? '<p class="det">Frete calculado com os números do ML: preço − tarifa − você recebe.</p>' : ''}
            <button class="lnk explique" data-explique-frete>${expl}</button><div class="ia-resp" id="respFreteDet"${freteExpl ? '' : ' hidden'}>${freteExpl ? respCorpo(P.explicaFrete(it, h, fa)) : ''}</div>
          </div>`;
        // Frete por mês: TODOS os meses com venda (e os do histórico diário), do primeiro ao último, com a tabela.
        const meses = P.mesesFrete(h, porMes), pt = P.pagoAMaisPorMes(vd), espera = temVd ? '' : P.esperaVendas(status, Date.now());
        html += `<div class="card"><b style="font-size:13px">Frete por mês</b>${meses.length ? P.svgFrete(meses) + '<p class="det">' + (meses.some(m => m.fonte === 'vendas') ? 'Frete típico cobrado por pedido em cada mês (Faturamento do ML)' + (meses.some(m => m.fonte === 'lista') ? '; mês sem venda: o valor que a lista do ML mostrava no fim do mês' : '') : 'Valor que a lista do ML mostrava no fim de cada mês') + '. Mês sem dado não aparece.</p>' : ''}`
            + (temVd ? `<table class="tabf"><thead><tr><th>Mês</th><th>Frete típico</th><th>Vendas</th><th>A mais que ${SHC.moeda(pt.base)}</th></tr></thead><tbody>
                ${pt.linhas.map(l => `<tr><td>${esc(P.nomeMes(l.mes))}</td><td>${SHC.moeda(l.tipico)}</td><td>${l.n}</td><td class="${l.aMais > 0 ? 'mais' : ''}">${l.aMais > 0 ? '+' + SHC.moeda(l.aMais) : '—'}</td></tr>`).join('')}
               </tbody><tfoot><tr><td colspan="3">Total a mais (${esc(P.nomeMes(pt.linhas[0].mes))} a ${esc(P.nomeMes(pt.linhas[pt.linhas.length - 1].mes))})</td><td class="${pt.total > 0 ? 'mais' : ''}">${SHC.moeda(pt.total)}</td></tr></tfoot></table>
               <p class="det">Base: ${SHC.moeda(pt.base)}, frete típico de ${esc(P.nomeMes(pt.mesBase))}. ${CONTA_FRETE} Vendas com frete pago pelo comprador ficam fora.${pt.fora.length ? ' ' + SHC.qtd(pt.fora.length, 'pedido', 'pedidos') + ' com frete 1,8× ou mais acima do típico do mês ficaram fora: podem ter mais de 1 unidade.' : ''} Fonte: Faturamento do ML.</p>`
            : `<p class="det">${meses.length ? '' : 'Ainda sem dado guardado. '}${esc(espera || 'Nenhuma venda deste anúncio no Faturamento lido.')}</p>`) + '</div>';
        // Vendas × frete cobrado: pedido a pedido, os mais recentes primeiro (20 e "ver todos").
        const pf = P.pedidosFrete(vd), mostra = pedTodos ? pf.lista : pf.lista.slice(0, 20);
        html += `<div class="card"><b style="font-size:13px">Vendas × frete cobrado</b>` + (pf.lista.length
            ? `<p class="det">${SHC.qtd(pf.lista.length, 'venda lida', 'vendas lidas')}. Normal deste anúncio: ${SHC.moeda(pf.normal)} por pedido.${pf.acima ? ` <b class="vm">${pf.acima} acima do normal</b> (em vermelho).` : ''}</p>
               <table class="tabf"><thead><tr><th>Data</th><th>Pedido</th><th>Frete cobrado</th></tr></thead><tbody>
                ${mostra.map(p => `<tr${p.acima ? ' class="acima"' : ''}><td>${esc(P.dataBr(p.d))}</td><td>${esc(p.orderId)}</td><td class="${p.acima ? 'mais' : ''}">${p.comprador ? 'pago pelo comprador' : SHC.moeda(p.f)}</td></tr>`).join('')}
               </tbody></table>${pf.lista.length > 20 ? `<button class="mais" data-ped-todos>${pedTodos ? 'Mostrar só os 20 mais recentes' : 'Ver todos (' + pf.lista.length + ')'}</button>` : ''}
               <p class="det">O Faturamento não mostra quantas unidades cada pedido teve: pedido com mais de 1 unidade tem frete maior.</p>`
            : `<p class="det">${esc(espera || 'Nenhuma venda deste anúncio no Faturamento lido.')}</p>`) + '</div>';
        html += cardSim(it);   // v2.8: aba Frete mostra só o que é de frete — Ads e Afiliados saíram daqui
        const med = medidasDe(it), ma = ((((medidas && medidas.porItem) || {})[it.itemId]) || {}).atual;
        const cad = it.sku ? cadSku[SHC.chaveSku(it.sku)] || {} : {}, erp = SHC.medidaDe([cad.larguraCm, cad.alturaCm, cad.comprimentoCm], cad.pesoKg);
        html += `<div class="card"><b style="font-size:13px">Prova de medida</b><div class="medidas">
            <div><small>No seu ERP (planilha, Tiny ou Omie)</small>${med ? `<b>${esc(med)}</b>` : `<span>${it.sku ? 'Sem peso e medidas do SKU ' + esc(it.sku) + '.' : 'Anúncio sem SKU.'}</span>`}</div>
            <div><small>No ML (embalagem ${ma && ma.secao === 'entrega' ? 'da forma de entrega' : 'de envio, a do frete'})</small>${ma ? `<b>${esc(SHC.medidaTxt(ma))}</b><span style="display:block">Peso considerado: ${esc(P.kgTxt(SHC.medidaConsiderada(ma)))} · conferido ${esc(tempo(ma.ts))}</span>`
                : `<span>${permWww ? 'Ainda não li as medidas deste anúncio.' : 'Falta a permissão para ler as medidas.'}</span>`}</div></div>
            ${ma && erp && !SHC.medidasIguais(ma, erp) ? '<p class="aviso-custo">As medidas no ML são diferentes das do seu ERP. Confira qual é a certa e corrija no ML.</p>' : ''}
            <p class="det">${med ? 'Peso bruto e embalagem (largura × altura × comprimento). Compare com o que você envia.' : 'Importe a planilha do seu ERP (Tiny: “Peso bruto (Kg)” e medidas da embalagem) em Ajustes › Abrir planilha de custos.'}${ma ? ' Peso considerado = o maior entre o peso físico e o volumétrico (comprimento × largura × altura ÷ 6.000).' : ''}</p>
            <div class="acoes" style="justify-content:flex-start;flex-wrap:wrap">${permWww ? `<button class="bt leve" data-med-agora="${esc(it.itemId)}">Conferir agora</button>` : `<button class="bt leve" data-perm-fotos>${PERM_TXT}</button>`}${btMed(it.itemId)}</div>${medMsgDe(it.itemId)}</div>`;
        const txt = P.textoChamado(it, h, vd, confirmouMedidas, med);
        if (txt) {
            const b = P.baseChamado(h, vd, it), { peds, fora } = P.pedidosAMais(vd, b.base, b.desde);
            html += `<div class="card"><b style="font-size:13px">Chamado para o Mercado Livre</b>
              ${peds.length ? `<p class="det">Pedidos cobrados acima de ${SHC.moeda(b.base)} desde ${esc(P.dataBr(b.desde))}:</p>
              <table class="tabf"><thead><tr><th>Pedido</th><th>Data</th><th>Frete</th><th>A mais</th></tr></thead><tbody>
                ${peds.slice(0, 10).map(p => `<tr><td>${esc(p.orderId)}</td><td>${esc(P.dataBr(p.d).slice(0, 5))}</td><td>${SHC.moeda(p.f)}</td><td class="mais">+${SHC.moeda(p.dif)}</td></tr>`).join('')}
              </tbody>${peds.length > 10 ? `<tfoot><tr><td colspan="4">e mais ${SHC.qtd(peds.length - 10, 'pedido', 'pedidos')} no texto abaixo</td></tr></tfoot>` : ''}</table>` : ''}
              <p class="det">O Faturamento não mostra quantas unidades cada pedido teve: pedido com mais de 1 unidade pode ter frete maior. Confira os pedidos antes de enviar.${fora.length ? ` ${SHC.qtd(fora.length, 'pedido', 'pedidos')} com frete 1,8× ou mais acima do típico do mês ficaram fora.` : ''}</p>
              <label class="conf"><input type="checkbox" id="confMedidas"${confirmouMedidas ? ' checked' : ''}> Confirmo que não alterei peso, medidas nem embalagem deste anúncio.</label>
              <textarea id="txtChamado" readonly>${esc(txt)}</textarea>
              <p class="det">O Copiloto não envia nada: você copia e cola no atendimento do ML.</p>
              <div class="acoes"><button class="bt" id="copiar">Copiar texto</button></div></div>`;
        }
        alvo.innerHTML = html;
        alvo._item = it; alvo._hist = h; alvo._fa = fa;
    }
    const medidasDe = it => it.sku ? P.medidasTxt(cadSku[SHC.chaveSku(it.sku)]) : '';
    // Ads deste anúncio no período do Mercado Ads (ads:<conta>) e o equilíbrio (V8). Estimativa: sobra no preço de hoje.
    const ACOS_TXT = 'ACOS = quanto do valor vendido pelo Ads foi gasto em Ads.';
    const sobraDe = it => { const c = custoGrupo[it.sku ? 'sku:' + it.sku : 'mlb:' + it.itemId]; return SHC.sobraAnuncio(it, c ? c.dados : null, cfg); };
    const periodoAds = () => { const p = adsSnap && adsSnap.periodo; const de = p && (p.de || p.dateFrom), ate = p && (p.ate || p.dateTo); return de && ate ? P.dataBr(de).slice(0, 5) + ' a ' + P.dataBr(ate).slice(0, 5) : 'últimos 30 dias'; };
    // Cartão de Ads DO anúncio: está no Ads? campanha, KPIs e o veredito (compensa / não compensa / informe o custo).
    const intTxt = v => v === null || v === undefined ? '—' : Math.round(v).toLocaleString('pt-BR');
    const pctOu = v => v === null || v === undefined || !isFinite(v) ? '—' : SHC.pctTxt(v);
    const xTxt = v => v === null || v === undefined || !isFinite(v) ? '—' : (Math.round(v * 100) / 100).toLocaleString('pt-BR') + 'x';
    const kpiAds = (rot, v) => `<div class="kpi" style="cursor:default"><small>${rot}</small><b style="font-size:13px">${v}</b></div>`;
    const custoDe = it => { const c = custoGrupo[it.sku ? 'sku:' + it.sku : 'mlb:' + it.itemId]; return c ? c.dados : null; };
    const campoCusto = it => { const k = it.sku ? 'sku:' + it.sku : 'mlb:' + it.itemId; return grupos.some(g => g.chave === k)
        ? `<div class="custo"><label>Custo${it.sku ? ' do SKU ' + esc(curtoTxt(it.sku, 20)) : ''}</label><input class="inp" data-csku="${esc(k)}" inputmode="decimal" placeholder="R$ 0,00"><button class="bt" data-csalvar="${esc(k)}">Salvar</button></div>` : ''; };
    function cardAds(it) {
        const cab = '<b style="font-size:13px">Ads deste anúncio</b>';
        if (!adsSnap) return `<div class="card">${cab}<p class="det">Aparece depois da próxima leitura do Mercado Ads.</p></div>`;
        if (adsSnap.temAds === false) return `<div class="card">${cab}<p class="det">No Ads: não. Esta conta não usa o Mercado Ads.</p></div>`;
        const x = P.adsDoItem(adsSnap, it.itemId);
        if (!x.noAds && x.temCatalogo && (it.catalogo || it.competicao)) return `<div class="card">${cab}<p class="det">Anúncio de catálogo: o Mercado Ads não diz qual anúncio seu é.</p></div>`;
        if (!x.noAds) return `<div class="card">${cab}<p style="margin:6px 0 0;font-size:12.5px"><b>No Ads: não.</b> Este anúncio não está em nenhuma campanha do Mercado Ads (${esc(periodoAds())}).</p></div>`;
        const m = x.m, c = x.campanha, v = P.adsVeredito(m, SHC.adsEquilibrio(it, custoDe(it), cfg));
        const cor = { compensa: 'ok', nao: 'ruim', semCusto: 'neutra', semGasto: 'neutra' }[v.tipo];
        return `<div class="card">${cab}
          <p style="margin:6px 0 0;font-size:12.5px"><b>No Ads: sim</b>${x.status ? ' (' + x.status + ')' : ''}${c.nome ? ` · campanha <b>${esc(curtoTxt(c.nome, 40))}</b>` : ''}</p>
          ${c.estrategia || c.roasObjetivo ? `<p class="det">${c.estrategia ? 'Estratégia: ' + esc(c.estrategia) : ''}${c.estrategia && c.roasObjetivo ? ' · ' : ''}${c.roasObjetivo ? 'ROAS objetivo: ' + xTxt(c.roasObjetivo) : ''}</p>` : ''}
          <div class="recnota ${cor}"><b>${esc(v.texto)}</b>${v.det ? ' · ' + esc(v.det) : ''}</div>
          ${v.tipo === 'semCusto' ? campoCusto(it) : ''}
          <div class="kpis k3" style="margin:8px 0 0">${kpiAds('Impressões', intTxt(m.impressoes))}${kpiAds('Cliques', intTxt(m.cliques))}${kpiAds('CTR', pctOu(m.ctr))}
            ${kpiAds('CPC', m.cpc === null ? '—' : SHC.moeda(m.cpc))}${kpiAds('Investimento', SHC.moeda(m.gasto))}${kpiAds('Receita', SHC.moeda(m.receita))}
            ${kpiAds('Vendas pelo Ads', intTxt(m.vendas))}${kpiAds('ROAS', xTxt(m.roas))}${kpiAds('ACOS', pctOu(m.acos))}</div>
          <p class="det">${esc(periodoAds())}. ${ACOS_TXT} ROAS = quanto voltou de venda para cada R$ 1 no Ads. Fonte: Mercado Ads.</p></div>`;
    }

    // Afiliados deste anúncio (1 linha; nada certo a dizer → sem cartão).
    function cardAfil(it) { const l = P.afilDoItem(afil, it.itemId); return l ? `<div class="card"><p style="margin:0;font-size:12.5px">${esc(l)}</p></div>` : ''; }
    // Simulador de custos do ML: confere o "Você recebe" e mostra frete grátis × comprador paga lado a lado (só mostra; quem decide é você).
    function cardSim(it) {
        const x = simDe[it.itemId], msg = simMsg[it.itemId], cab = '<b style="font-size:13px">Simulador de custos do ML</b>';
        const bt = msg === 'lendo' ? '<p class="det">Conferindo com o Simulador do ML…</p>'
            : `<button class="bt leve" data-conf-sim="${esc(it.itemId)}" style="margin-top:8px">${x ? 'Conferir de novo' : 'Conferir com o Simulador do ML'}</button>${msg ? `<p class="det">${esc(msg)}</p>` : ''}`;
        if (!x) return `<div class="card">${cab}<p class="det">Confere o “Você recebe” deste anúncio na calculadora do próprio Mercado Livre.</p>${bt}</div>`;
        const rec = it.recebeCopiloto !== undefined ? it.recebeCopiloto : it.recebe, cf = SHC.simConfere(x.hoje, rec, it.preco), e = SHC.simEse(x.hoje, x.outro);
        let h = `<div class="card">${cab}`;
        if (cf && cf.bate === true) h += `<div class="recnota ok"><b>✓ Conferido com o Simulador do ML: você recebe ${SHC.moeda(cf.recebe)}</b></div>`;
        else if (cf && cf.bate === false) h += `<div class="recnota ruim"><b>Simulador do ML: você recebe ${SHC.moeda(cf.recebe)}</b> · o Copiloto tinha calculado ${SHC.moeda(rec)} · o Copiloto passa a usar o do ML</div>`;
        else if (cf) h += `<div class="recnota neutra">${esc(cf.texto)}</div>`;
        if (e && x.outro) {   // sem a outra opção (recálculo desligado ou falhou) → sem o bloco; o botão abaixo abre o Simulador do ML
            // Frete grátis sempre à esquerda; "hoje" marca como o anúncio está.
            const cols = [[x.hoje, e.linhas[0]], [x.outro, e.linhas[1]]].filter(c => c[0] && c[1]).sort((a, b) => (a[0].freteOpcao === 'free' ? -1 : 1) - (b[0].freteOpcao === 'free' ? -1 : 1));
            h += `<p style="margin:10px 0 2px;font-weight:650;font-size:12.5px">Frete grátis × comprador paga</p><div class="kpis k2" style="margin:4px 0 0">`
                + cols.map(([s, l]) => `<div class="kpi" style="cursor:default"><small>${s.freteOpcao === 'free' ? 'Frete grátis' : 'Comprador paga o frete'}${s === x.hoje ? ' · hoje' : ''}</small><b>${SHC.moeda(s.recebe)}</b><small>você recebe${l.detalhe ? ' · ' + esc(l.detalhe) : ''}</small></div>`).join('')
                + `</div><p class="det">${esc(e.diferenca)}</p>`;
        }
        return h + `<div class="acoes" style="justify-content:flex-start;flex-wrap:wrap"><button class="bt leve" data-abrir-sim="${esc(it.itemId)}">Abrir no Simulador do ML</button></div>`
            + `<p class="det">Lido ${esc(tempo(x.ts))} no Simulador de custos do ML.</p>${bt}</div>`;
    }
    async function conferirSim(itemId) {
        if (simMsg[itemId] === 'lendo') return;
        simMsg[itemId] = 'lendo'; desenhaFrete();
        let r = null;
        try { r = await chrome.runtime.sendMessage({ acao: 'simulador', itemId, forcar: !!simDe[itemId] }); } catch (e) { r = null; }
        if (r && r.ok && r.sim && r.sim.hoje) { delete simMsg[itemId]; simDe[itemId] = r.sim; }
        else simMsg[itemId] = r && r.motivo === 'sem_sessao' ? 'Entre no Mercado Livre neste Chrome e tente de novo.' : 'O Simulador do ML não respondeu. Tente de novo em alguns minutos.';
        desenhaFrete();
    }

    // ── Catálogo ──────────────────────────────────────────────────────────────────────────────
    function desenhaCatalogo() {
        const alvo = $('#listaCat');
        if (!grupos.length) {
            $('#catTopo').innerHTML = ''; $('#catVer').hidden = true; $('#catMais').hidden = false;
            alvo.innerHTML = '<div class="vazio"><b>Lista de anúncios ainda não lida</b>Os SKUs da sua conta aparecem aqui depois da próxima sincronização.</div>';
            return;
        }
        const n = c => resumos.filter(r => r.r.classe === c).length;
        // Custos: barra grossa, aviso fixo, conectar o ERP e os SKUs sem custo minimizados (os 10 que mais vendem + "Ver todos").
        // Mesma conta do guia e dos Ajustes (SHC.guiaCustos): mesmo %, mesma janela de vendas, mesmos SKUs pedidos.
        const custosAll = Object.assign({}, custosMl, cadSku), cu = SHC.guiaCustos(anuncios && anuncios.itens, custosAll, vm);
        const com = cu.comTodos, total = cu.deTodos || resumos.length, pct = total ? Math.round(com / total * 100) : 0;
        const sem = P.semCustoTop(resumos, vm, { desde: cu.desde, temCusto: g => g.itens.some(it => SHC.custoDeAnuncio(custosAll, it)) });
        const desdeTxt = new Date(cu.desde + '-15T12:00:00Z').toLocaleString('pt-BR', { month: 'long', timeZone: 'UTC' });
        const linhaSem = ({ g, vendas: nv }) => `<div class="linha-sem"><span><b>${esc(curtoTxt(g.titulo, 60))}</b><small>${esc(g.sku || g.itens[0].itemId + ' (sem SKU)')}${nv > 0 ? ' · ' + SHC.qtd(nv, 'vendida', 'vendidas') + ' desde ' + desdeTxt : ''}</small></span>
            <span class="cst-ed"><input class="inp" data-csku="${esc(g.chave)}" inputmode="decimal" placeholder="＋ custo"><button class="bt" data-csalvar="${esc(g.chave)}">OK</button></span></div>`;
        $('#catTopo').innerHTML = `<div class="card" id="cardCustosCat"><b style="font-size:13px">Custo preenchido em ${com} de ${total} produtos</b>
          <div class="barra-g" role="progressbar" aria-label="SKUs com custo" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
          <p style="margin:0;font-size:12.5px"><b>${pct}%</b> · ${com} de ${total} SKUs com custo${cu.de ? ` · Principais: ${cu.com} de ${cu.de} que mais vendem` : ''}</p>
          <p class="aviso-custo">Sem o custo, o Copiloto não calcula o lucro nem se o Ads compensa.</p>
          <div class="dois"><button class="bt verde" data-erp="tiny">${tinyToken ? 'Tiny · Puxar custos agora' : 'Tiny · Conectar em 1 minuto'}</button><button class="bt" data-erp="bling">Omie · Conectar</button></div>
          ${status.custosProgresso && status.custosProgresso.erp ? `<p class="det">${esc(P.textoImportando(status.custosProgresso))}</p>` : `<button class="bt leve" data-sync-custos style="margin-top:2px">Sincronizar custos</button>`}${custosMsg ? `<p class="det">${esc(custosMsg)}</p>` : ''}
          ${sem.length ? `<p style="margin:8px 0 2px;font-weight:650;font-size:12.5px">${esc(SHC.qtd(sem.length, 'SKU sem custo', 'SKUs sem custo'))} ${btVer('cat:semcusto', sem.length > 10 ? 'Ver os 10 que mais vendem' : 'Ver quais')}</p>`
            + (aberto('cat:semcusto') ? `${sem.slice(0, 10).map(linhaSem).join('')}
            ${sem.length > 10 ? `<button class="bt leve" data-sem-todos style="margin-top:8px">${catFiltro === 'sem_custo' ? 'Esconder a lista completa' : 'Ver todos os ' + sem.length + ' sem custo'}</button>` : ''}` : '') : ''}
          <div class="canais" style="margin-top:8px">${[['prejuizo', 'p', ' prejuízo'], ['apertado', 'a', ' abaixo da meta']].map(([c, k, t]) => `<button class="${k}${catFiltro === c ? ' on' : ''}" data-cfiltro="${c}">${n(c)}${t}</button>`).join('')}</div></div>` + cardCompeticao();
        // Lista dos SKUs recolhida: abre com "Ver mais", com um filtro ou com a busca (vinda da etiqueta do ML).
        const abL = aberto('cat:lista') || !!catFiltro || !!catBusca.trim(), cv = $('#catVer');
        cv.hidden = false; cv.textContent = abL ? 'Ver menos' : 'Ver a lista de SKUs (' + resumos.length + ')';
        $('#catMais').hidden = !abL;
        if (!abL) { alvo.innerHTML = ''; return; }
        const b = catBusca.trim().toLowerCase();
        // Sem filtro e sem busca, os SKUs sem custo ficam só no cartão acima (minimizados).
        const vis = resumos.filter(r => (catFiltro ? r.r.classe === catFiltro : (b || r.r.classe !== 'sem_custo')) && (!b || String(r.g.titulo).toLowerCase().indexOf(b) >= 0 || r.g.sku.toLowerCase().indexOf(b) >= 0 || r.g.itens.some(it => it.itemId.toLowerCase().indexOf(b) >= 0)));
        alvo.innerHTML = (vis.length ? vis.slice(0, limite.catalogo).map(({ g, r }) => {
            const ed = catEditando === g.chave || !(r.custo > 0);
            const cst = ed
                ? `<span class="cst-ed"><input class="inp" data-csku="${esc(g.chave)}" inputmode="decimal" placeholder="＋ custo" value="${r.custo > 0 ? esc(nfr(r.custo)) : ''}"><button class="bt" data-csalvar="${esc(g.chave)}">OK</button></span>`
                : `<button class="cst" data-ceditar="${esc(g.chave)}" title="Editar custo">${SHC.moeda(r.custo)}</button>`;
            let ml;
            if (!(r.custo > 0)) ml = '<span class="n">digite o custo para ver o lucro</span>';
            else if (!r.pior) ml = '<span class="n">ML: sem preço na lista</span>';
            else {
                const k = r.classe === 'prejuizo' ? 'p' : (r.classe === 'apertado' ? 'a' : 'l');
                const s = r.pior.s, s2 = r.melhor.s;
                ml = `<span class="${k}">ML: ${s.sobra < 0 ? 'Prejuízo' : 'Lucro'} ${SHC.moeda(Math.abs(s.sobra))} · ${SHC.pctTxt(s.pct)}${r.linhas.length > 1 && Math.abs(s2.sobra - s.sobra) > 0.009 ? ' a ' + SHC.moeda(s2.sobra) : ''}</span>`;
            }
            const alerta = P.alertaCusto(r);
            return `<div class="linha-sku"><b>${esc(g.titulo)}</b>${cst}<small>${esc(g.sku || g.itens[0].itemId + ' (sem SKU)')} · ${g.itens.length} anúncio${g.itens.length > 1 ? 's' : ''}</small>
              <div class="canais">${ml}</div>${alerta ? `<div class="alerta">${esc(alerta)}</div>` : ''}</div>`;
        }).join('') + botaoMais('catalogo', vis.length - limite.catalogo) : '<div class="vazio">Nenhum SKU neste filtro.</div>')
            + '<p class="det" style="margin-top:8px">O custo é do SKU. Em cada canal mudam só a comissão e a conta final.</p>';
    }

    // Competição: filtros por estado (P.GRUPOS_COMP), dias perdendo (comp:<conta>), "Ver quem está ganhando" (conc:<conta>:<MLB>)
    // e o mesmo produto em outra conta do ML deste Chrome.
    const COMP = { ganhando: ['l', 'Ganhando'], perdendo: ['p', 'Perdendo'], restrito: ['p', 'Restrito'], dividindo: ['a', 'Dividindo'], competindo: ['n', 'Competindo'] };
    const COMP_EXPLICA = 'O ML mostra uma oferta principal por produto e escolhe pelo conjunto preço + entrega + parcelamento + reputação; quando empata, reveza (Dividindo o 1º lugar). Ganhando = a sua é a principal. Perdendo = outra ficou no lugar. Restrito = outras têm entrega melhor.';
    function linhaCompeticao(it, g) {
        const topo = `<b>${esc(curtoTxt(it.titulo, 60))}</b><small>${esc(it.itemId)}${it.sku ? ' · SKU ' + esc(it.sku) : ''}</small>`;
        if (g === 'ganhando') return `<div class="linha-comp">${topo}<small>Seu preço: <b>${SHC.moeda(it.preco)}</b></small></div>`;
        const res = SHC.compResumo ? SHC.compResumo(compHist[it.itemId], SHC.hoje()) : null;
        const quando = g === 'dividindo' ? 'Dividindo o 1º lugar' : P.tempoPerdendo(res);
        const cmp = P.comparaConc(concDe[it.itemId], it.preco), msg = concMsg[it.itemId];
        let det = '';
        if (cmp) {
            const v = cmp.v, lado = cmp.dif === null ? '' : (cmp.dif > 0.004 ? `o seu está ${SHC.moeda(cmp.dif)} (${SHC.pctTxt(cmp.difPct)}) mais caro` : (cmp.dif < -0.004 ? `o seu está ${SHC.moeda(-cmp.dif)} (${SHC.pctTxt(-cmp.difPct)}) mais barato` : 'mesmo preço que o seu'));
            det = `<div class="conc"><p><b>${esc(cmp.rotulo)}:</b> ${esc(curtoTxt(v.vendedor || 'vendedor não identificado', 40))} · ${SHC.moeda(v.preco)} × seu ${SHC.moeda(it.preco)}${lado ? ' · ' + lado : ''}</p>
              ${concDe[it.itemId].variacaoIncerta ? '<p class="alerta">Compare na mesma variação (cor/voltagem).</p>' : ''}
              <table class="tabf"><thead><tr><th>Vendedor</th><th>Preço</th><th>Parcelas</th><th>Entrega</th></tr></thead><tbody>
              ${cmp.ofertas.map(o => `<tr><td>${esc(curtoTxt(o.vendedor || '—', 26))}</td><td>${SHC.moeda(o.preco)}</td><td>${o.parcelas ? o.parcelas.n + 'x ' + SHC.moeda(o.parcelas.valor) + (o.semJuros ? ' sem juros' : '') : '—'}</td><td>${esc(curtoTxt(o.entrega || '—', 30))}</td></tr>`).join('')}
              </tbody></table><small>Lido ${esc(tempo(concDe[it.itemId].ts))} na página pública do produto no ML.</small></div>`;
        }
        const mud = res && res.mudancas && res.mudancas.length > 1 ? `<div class="linha-tempo">${res.mudancas.slice(-6).reverse().map(x => `<small>${esc(P.dataBr(x.d).slice(0, 5))} · ${esc((COMP[x.e] || ['', x.e || 'sem competição'])[1])}${x.p ? ' · ' + SHC.moeda(x.p) : ''}</small>`).join('')}</div>` : '';
        const bt = msg === 'lendo' ? '<small>Lendo as ofertas do catálogo…</small>'
            : `<button class="bt leve" data-conc="${esc(it.itemId)}" style="margin-top:6px">${cmp ? 'Ler de novo' : 'Ver quem está ganhando'}</button>${msg ? `<small class="erro-conc">${esc(msg)}</small>` : ''}`;
        return `<div class="linha-comp">${topo}<small class="quando">${esc(quando)}${it.preco ? ' · seu preço ' + SHC.moeda(it.preco) : ''}</small>${det}${mud}${bt}</div>`;
    }
    function cardCompeticao() {
        const rc = P.resumoCompeticao(itens), entre = entreContas;
        const nContas = Object.keys(contas).length, semRetrato = Object.keys(contas).filter(id => !retratos[id]);
        const filtros = rc.temDado ? P.GRUPOS_COMP.filter(([k]) => rc.grupos[k].length || k !== 'outros').map(([k, rot, cor]) => `<button class="${cor}${compGrupo === k ? ' on' : ''}" data-cgrupo="${k}">${rc.grupos[k].length} ${esc(rot.toLowerCase())}</button>`).join('') : '<span class="n">sem dado ainda</span>';
        let html = `<div class="card"><button class="lnk" data-comp style="display:flex;width:100%;color:var(--tinta)"><b style="font-size:13px;flex:1">Competição</b><span style="color:var(--azul)">${compAberto ? 'fechar' : 'ver'}</span></button>
          <div class="canais" style="margin-top:6px">${filtros}${entre.length ? `<span class="p">${entre.length} entre suas contas</span>` : ''}</div>`;
        if (!compAberto) return html + '</div>';
        html += `<p class="det">${esc(COMP_EXPLICA)}</p>`;
        if (!rc.temDado) html += '<p class="det">A situação no catálogo aparece depois da próxima leitura da lista de Anúncios.</p>';
        else {
            // Sem filtro escolhido: os que estão perdendo (preço, entrega, outros).
            const gs = compGrupo ? [compGrupo] : ['preco', 'entrega', 'outros'], lista = [].concat(...gs.map(k => rc.grupos[k].map(it => [it, k])));
            const rot = compGrupo ? (P.GRUPOS_COMP.find(x => x[0] === compGrupo) || [])[1] : 'Perdendo';
            html += lista.length ? `<p class="det" style="margin-top:8px">${esc(rot)} (${lista.length}):</p>` + lista.slice(0, 8).map(([it, k]) => linhaCompeticao(it, k)).join('') + (lista.length > 8 ? `<p class="det">e mais ${lista.length - 8}.</p>` : '')
                : `<p class="det" style="margin-top:8px">Nenhum anúncio em “${esc(rot)}”.</p>`;
        }
        html += `<button class="bt leve" data-abrir-competindo style="margin-top:8px">Abrir “Competindo” no ML</button>`;
        html += '<p style="margin:10px 0 2px;font-weight:650;font-size:12.5px">Entre as suas contas</p>';
        if (nContas < 2) html += '<p class="det">Só 1 conta do Mercado Livre conectada neste Chrome. Entre na outra conta do ML neste Chrome e sincronize para comparar.</p>';
        else {
            if (semRetrato.length) html += `<p class="det">Ainda sem anúncios lidos de: ${esc(semRetrato.map(id => SHC.nomeConta(id, cfg, contas)).join(', '))}. Entre nessa conta do ML neste Chrome e sincronize.</p>`;
            html += entre.length ? entre.slice(0, 8).map(g => `<div class="linha-comp"><b>${esc(curtoTxt(g.titulo, 60))}</b><small>Suas contas competem entre si neste produto (${g.tipo === 'titulo' ? 'mesmo título' : ({ catalogo: 'catálogo #', sku: 'SKU ', ean: 'EAN ' }[g.tipo] || '') + esc(g.valor)}):</small>
                ${g.itens.map(x => `<small>• ${esc(curtoTxt(x.nomeConta, 24))}: ${esc(x.it.itemId)} · ${SHC.moeda(x.it.preco)}${COMP[x.it.competicao] ? ' · ' + COMP[x.it.competicao][1] : ''}</small>`).join('')}</div>`).join('') + (entre.length > 8 ? `<p class="det">e mais ${SHC.qtd(entre.length - 8, 'produto', 'produtos')}.</p>` : '')
                : '<p class="det">Nenhum produto igual (mesmo SKU, EAN ou título) em contas diferentes.</p>';
        }
        return html + '<p class="det">Fonte: lista de Anúncios do Mercado Livre de cada conta, lida neste Chrome.</p></div>';
    }
    // "Ver quem está ganhando": sem a permissão opcional, pede DENTRO do clique (antes de qualquer await) e depois pergunta ao fundo.
    async function verConcorrentes(itemId) {
        let pedido = null;
        try { pedido = permCat ? null : chrome.permissions.request(PERM_CAT); } catch (e) { pedido = Promise.resolve(false); }
        concMsg[itemId] = 'lendo'; desenhaCatalogo();
        let r = null;
        try {
            if (pedido && !(await pedido)) { concMsg[itemId] = 'Sem a permissão do Chrome o Copiloto não consegue abrir a página do produto. Clique de novo e escolha “Permitir”.'; return desenhaCatalogo(); }
            if (pedido) permCat = true;
            r = await chrome.runtime.sendMessage({ acao: 'concorrentes', itemId });
        } catch (e) { r = null; }
        if (r && r.semPermissao) { permCat = false; concMsg[itemId] = 'O Chrome ainda não deu a permissão. Clique de novo para permitir.'; }
        else if (r && r.ok) { delete concMsg[itemId]; concDe[itemId] = r; }
        else concMsg[itemId] = (r && r.erro) || 'O Mercado Livre não respondeu. Tente de novo em alguns minutos.';
        desenhaCatalogo();
    }

    // ── Aba Ads (v2.9, pedido da dona): manchete → KPIs → "Precisa de você" → [Ver mais] Campanhas criadas, Resumo da conta, Por produto.
    // Tudo do ads:<conta> (Mercado Ads, só leitura) e do equilíbrio do Copiloto. Criar, pausar ou mudar orçamento é com você, no Mercado Ads. ──
    const FILTROS_ADS = [['acima', 'Acima do equilíbrio', 'p'], ['escalar', 'Dá para escalar', 'l'], ['semVenda', 'Sem venda com gasto', 'a'], ['semCusto', 'Sem custo', 'n']];
    const ROAS_TXT = 'ROAS = quanto voltou de venda para cada R$ 1 no Ads.';
    const SELO_VER = { compensa: ['ok', 'Compensa'], nao: ['pr', 'Não compensa'], semCusto: ['', 'Sem cálculo'], semGasto: ['', 'Sem gasto'] };
    const seloVer = v => { const [c, t] = SELO_VER[v.tipo] || ['', v.texto || '']; return `<span class="selo ${c}"${v.det ? ` title="${esc(v.det)}"` : ''}>${esc(t)}</span>`; };
    const seloCamp = c => c.status === 'ativo' ? '<span class="selo ok">Ativa</span>' : c.status === 'pausado' ? '<span class="selo at">Pausada</span>' : c.statusBruto ? `<span class="selo">${esc(c.statusBruto.toLowerCase())}</span>` : '';
    const perdeTxt = c => {
        const o = c.perdeOrcamento, k = c.perdeClassificacao;
        if (o !== null && o >= 10 && (k === null || o >= k)) return `perde ${SHC.pctTxt(o)} das aparições por falta de orçamento`;
        if (k !== null && k >= 10) return `perde ${SHC.pctTxt(k)} das aparições para anúncios mais bem classificados`;
        return '';
    };
    const porDia = v => (v === null || v === undefined ? '' : SHC.moeda(v).replace(/,00$/, '') + '/dia');
    function cardAdsSku() {
        const fm = P.adsDoFechamento(fechMes), mes = P.nomeMes(SHC.hoje().slice(0, 7));
        const totMes = fm ? `Ads da conta em ${esc(mes)} (Faturamento): ${fm.ads !== null ? SHC.moeda(fm.ads) + ' de Product Ads' : 'Product Ads não lido'}${fm.seguidores ? ' + ' + SHC.moeda(fm.seguidores) + ' de Publicidade de Seguidores' : ''}.` : '';
        const cab = '<div class="ch"><h3>Ads</h3></div>', rodMes = totMes ? `<p class="det">${totMes}</p>` : '';
        if (!adsSnap) return `<div class="card">${cab}<p class="det">Aparece depois da próxima leitura do Mercado Ads.</p>${rodMes}</div>`;
        if (adsSnap.temAds === false) return `<div class="card">${cab}<p class="det">Esta conta não usa o Mercado Ads.</p>${rodMes}</div>`;
        const m = P.adsConta(adsSnap), lista = P.adsEquilibrio(adsSnap, itens, sobraDe), fs = P.adsFiltros(lista, cfg.margem_alvo_pct);
        const camps = P.adsCampanhasLista(adsSnap, lista), ver = P.adsVereditoDe(lista, m.gasto), per = periodoAds(), nAc = fs.acima.length;
        const tit = x => esc(curtoTxt(x.a.titulo || (x.it && x.it.titulo) || x.a.itemId, 40));
        // Manchete (1 frase) e KPIs
        const fato = ver.tipo === 'compensa' ? `O Ads dá lucro (ACOS ${pctOu(m.acos)}).` : ver.tipo === 'nao' ? `O Ads leva mais do que sobra (ACOS ${pctOu(m.acos)}).` : `Ads: ${SHC.moeda(m.gasto)} em 30 dias.`;
        const acao = nAc ? (nAc === 1 ? `${curtoTxt(fs.acima[0].a.titulo || fs.acima[0].a.itemId, 40)} gasta mais do que aguenta.` : `${nAc} produtos gastam mais do que aguentam.`)
            : fs.escalar.length ? `${SHC.qtd(fs.escalar.length, 'produto aguenta', 'produtos aguentam')} investir mais.` : 'Nada pede sua atenção agora.';
        const ptM = ver.tipo === 'nao' ? 'pr' : nAc ? 'at' : ver.tipo === 'compensa' ? 'ok' : '';
        let h = `<p class="manchete"><span class="pt ${ptM}"></span><b>${esc(fato)}</b> ${esc(acao)}</p>
          <div class="kpis k4">${kpiN('', 'Investimento 30 dias', SHC.moeda(m.gasto), esc(per))}${kpiN('', 'Vendas pelo Ads', SHC.moeda(m.receita), esc(SHC.qtd(m.vendas, 'venda', 'vendas')))}`
          + kpiN(ver.tipo === 'compensa' ? 'ok' : ver.tipo === 'nao' ? 'pr' : '', 'ACOS ⓘ', pctOu(m.acos), ver.tipo === 'compensa' ? 'abaixo da sua margem' : ver.tipo === 'nao' ? 'acima da sua margem' : '', ACOS_TXT)
          + kpiN('', 'ROAS ⓘ', xTxt(m.roas), m.roas !== null ? esc('R$ ' + (Math.round(m.roas * 100) / 100).toLocaleString('pt-BR') + ' por R$ 1') : '', ROAS_TXT) + '</div>';
        // Precisa de você: acima do equilíbrio (até 3) e o que dá para escalar (até 2)
        const btV = x => `<button class="bt leve pq" data-frete-det="${esc(x.a.itemId)}">Ver</button>`;
        const pv = fs.acima.slice(0, 3).map(x => `<li class="acao ${x.margem !== null && x.margem <= 0 ? 'pr' : 'at'}"><div class="tx"><b>${tit(x)}</b><span>${x.acos !== null ? 'ACOS ' + esc(SHC.pctTxt(x.acos)) : 'gastou ' + SHC.moeda(x.a.gasto) + ' sem venda'} · ${x.margem > 0 ? 'aguenta até ' + esc(SHC.pctTxt(x.margem)) : 'já dá prejuízo antes do Ads'}</span></div>${btV(x)}</li>`)
            .concat(fs.escalar.slice(0, 2).map(x => `<li class="acao ok"><div class="tx"><b>${tit(x)}</b><span>ACOS ${esc(SHC.pctTxt(x.acos))} · dá para investir mais</span></div>${btV(x)}</li>`));
        if (pv.length) h += `<div class="card"><div class="ch"><h3>Precisa de você</h3></div><ul class="acoes">${pv.join('')}</ul>${nAc > 3 ? `<p class="rs">Mais ${esc(SHC.qtd(nAc - 3, 'produto acima do equilíbrio', 'produtos acima do equilíbrio'))} em “Por produto”.</p>` : ''}</div>`;
        // [Ver mais] Campanhas criadas
        const nAt = camps.filter(c => c.status === 'ativo').length;
        const resCamp = [nAt ? SHC.qtd(nAt, 'ativa', 'ativas') : SHC.qtd(camps.length, 'campanha', 'campanhas')].concat(camps.slice(0, 2).map(c => `${curtoTxt(c.nome, 22)} ACOS ${pctOu(c.m.acos)}`)).join(' · ');
        const linhaCamp = c => {
            const pd = perdeTxt(c), sub = [porDia(c.orcamentoDia), SHC.qtd(c.anuncios, 'anúncio', 'anúncios')].filter(Boolean).map(esc).join(' · ');
            return `<tr><td><b>${esc(curtoTxt(c.nome, 40))}</b><span class="sm">${seloCamp(c)} ${sub}</span>${pd ? `<span class="sm">${esc(pd)}</span>` : ''}`
                + `<span class="sm">${seloVer(c.veredito)}${c.veredito.semCusto ? ' ' + esc(SHC.qtd(c.veredito.semCusto, 'anúncio sem custo', 'anúncios sem custo')) : ''}</span></td>`
                + `<td>${SHC.moeda(c.m.gasto)}</td><td>${SHC.moeda(c.m.receita)}<span class="sm">${esc(SHC.qtd(c.m.vendas, 'venda', 'vendas'))}</span></td>`
                + `<td${c.veredito.tipo === 'nao' ? ' style="color:#991B1B;font-weight:700"' : ''}>${pctOu(c.m.acos)}</td></tr>`;
        };
        h += camps.length ? blocoAf('ads:camp', 'Campanhas criadas', esc(resCamp), `<table class="tb"><thead><tr><th>Campanha</th><th>Gasto</th><th>Vendas</th><th title="${esc(ACOS_TXT)}">ACOS</th></tr></thead><tbody>`
                + camps.map(linhaCamp).join('') + (camps.length > 1 ? `<tr><td><b>Total</b></td><td><b>${SHC.moeda(m.gasto)}</b></td><td><b>${SHC.moeda(m.receita)}</b></td><td><b>${pctOu(m.acos)}</b></td></tr>` : '') + '</tbody></table>'
                + `<p class="det">${esc(per)}. Compensa = o Ads gastou menos do que sobra das vendas que trouxe (pelo custo que você informou).${adsSnap.completo === false ? ' Parte dos anúncios não foi lida.' : ''}</p>`)
            : '<div class="card"><div class="ch"><h3>Campanhas criadas</h3></div><p class="det">Nenhuma campanha lida no Mercado Ads.</p></div>';
        // [Ver mais] Resumo da conta
        const ant = adsSnap.anterior && adsSnap.anterior.total ? adsSnap.anterior.total : null, antG = ant ? SHC.num(ant.custo !== undefined ? ant.custo : ant.cost) : null;
        const lin = (r, v, sub) => `<tr><td>${r}${sub ? `<span class="sm">${sub}</span>` : ''}</td><td><b>${v}</b></td></tr>`;
        const resConta = [m.orcamentoDia !== null ? 'Orçamento ' + porDia(m.orcamentoDia) : '', m.cliques !== null ? SHC.qtd(m.cliques, 'clique', 'cliques') : '', m.tacos !== null ? 'TACOS ' + pctOu(m.tacos) : ''].filter(Boolean).join(' · ') || per;
        h += blocoAf('ads:conta', 'Resumo da conta', esc(resConta), '<table class="tb">'
            + lin('Investimento', SHC.moeda(m.gasto), esc(per) + (antG !== null ? ' · 30 dias antes: ' + SHC.moeda(antG) : ''))
            + lin('Vendas pelo Ads', SHC.moeda(m.receita), esc(SHC.qtd(m.vendas, 'venda', 'vendas')))
            + lin(`<span title="${esc(ACOS_TXT)}">ACOS ⓘ</span>`, pctOu(m.acos), 'parte da venda gasta em Ads')
            + lin(`<span title="${esc(ROAS_TXT)}">ROAS ⓘ</span>`, xTxt(m.roas), 'venda para cada R$ 1 no Ads')
            + (m.tacos !== null ? lin('<span title="TACOS = Ads ÷ todas as suas vendas.">TACOS ⓘ</span>', pctOu(m.tacos), 'Ads ÷ todas as suas vendas') : '')
            + lin('Cliques', intTxt(m.cliques), m.cpc !== null ? esc(SHC.moeda(m.cpc) + ' por clique') : '')
            + lin('Impressões', intTxt(m.impressoes), m.ctr !== null ? esc(SHC.pctTxt(m.ctr) + ' clicaram') : '')
            + lin('Orçamento diário somado', m.orcamentoDia !== null ? porDia(m.orcamentoDia) : '—', esc(SHC.qtd(m.campanhasAtivas, 'campanha ativa', 'campanhas ativas')))
            + (m.vendasOrganicas !== null ? lin('Vendas sem Ads', intTxt(m.vendasOrganicas), 'no mesmo período') : '')
            + '</table>' + (totMes ? `<p class="det">${totMes} Mês do calendário, por isso difere dos 30 dias.</p>` : ''));
        // [Ver mais] Por produto (filtros, equilíbrio e veredito por anúncio)
        const nCat = (adsSnap.anuncios || []).filter(a => a && (a.catalogoProduto || a.type === 'catalog')).length, vis = fs[adsFiltro] || [];
        h += blocoAf('ads:prod', 'Por produto', esc(SHC.qtd(lista.length, 'anúncio com gasto', 'anúncios com gasto') + (nAc ? ' · ' + nAc + ' acima do equilíbrio' : '')),
            `<p class="det" style="margin-top:6px">${SHC.qtd(lista.length, 'anúncio', 'anúncios')} com gasto · ${SHC.moeda(SHC.r2(lista.reduce((t, x) => t + x.a.gasto, 0)))} (${esc(per)})${nCat ? ` · ${nCat} de catálogo fora da lista (o Mercado Ads não diz qual anúncio seu é)` : ''}</p>
              <div class="canais">${FILTROS_ADS.map(([k, rot, cor]) => `<button class="${cor}${adsFiltro === k ? ' on' : ''}" data-adsf="${k}">${fs[k].length} ${esc(rot.toLowerCase())}</button>`).join('')}</div>`
            + (vis.length ? vis.slice(0, 8).map(x => `<button class="linha-comp linha-ads" data-frete-det="${esc(x.a.itemId)}"><b>${esc(curtoTxt(x.a.titulo || (x.it && x.it.titulo) || x.a.itemId, 60))}</b>
                  <small>${esc(x.a.itemId)} · Ads ${SHC.moeda(x.a.gasto)} · ${SHC.qtd(x.a.vendas, 'venda', 'vendas')}${x.acos !== null ? ' · ACOS ' + SHC.pctTxt(x.acos) : ''}${x.margem !== null ? ' · equilíbrio ' + SHC.pctTxt(x.margem) : ''} ›</small></button>`).join('') + (vis.length > 8 ? `<p class="det">e mais ${vis.length - 8}.</p>` : '')
              : '<p class="det">Nenhum anúncio neste filtro.</p>')
            + '<p class="det">Acima do equilíbrio = o Ads custou mais que a sobra das vendas que ele trouxe. Dá para escalar = ACOS bem abaixo do equilíbrio, mesmo com a sua meta.</p>');
        return h + '<p class="det">Fonte: Mercado Ads. Criar, pausar ou mudar o orçamento é com você, no Mercado Ads.</p>';
    }

    function desenhaAds() { $('#listaAds').innerHTML = cardAdsSku(); }
    // ── Aba Afiliados ──
    function desenhaAfil() { $('#listaAfil').innerHTML = cardAfiliados(); }
    // ── Afiliados (afil:<conta>, últimos 30 dias). Só mostra: entrar ou sair da campanha é com você, no ML.
    // v2.9 (perfumaria): manchete → KPIs → "Precisa de você" → blocos com "Ver mais" (o que mais vendeu, campanha, pedidos, fora, clique sem venda). ──
    const moedaOu = v => (v === null || v === undefined ? '—' : SHC.moeda(v));
    const menosMoeda = v => (v < 0 ? '−' + SHC.moeda(-v) : SHC.moeda(v));
    const kpiN = (cls, rot, v, sub, tit) => `<div class="kpi kn ${cls || ''}"${tit ? ` title="${esc(tit)}"` : ''}><div class="l">${esc(rot)}</div><div class="v">${v}</div><div class="s">${sub || '&nbsp;'}</div></div>`;
    // Bloco recolhido: título + resumo de 1 linha com "Ver mais"; o conteúdo só quando aberto.
    const blocoAf = (k, titulo, resumo, dentro) => `<div class="card"><div class="ch"><h3>${esc(titulo)}</h3></div><p class="rs">${resumo}${dentro ? ' ' + btVer(k) : ''}</p>${dentro && aberto(k) ? dentro : ''}</div>`;
    const dataAf = d => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : '');
    const quandoMl = d => (d && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(d) ? d.slice(8, 10) + '/' + d.slice(5, 7) + ' às ' + d.slice(11, 16) : '');
    const statusAfil = s => (/^active$/i.test(s || '') ? '<span class="selo ok">Ativa</span>' : /^paused$/i.test(s || '') ? '<span class="selo at">Pausada</span>' : s ? `<span class="selo">${esc(String(s).toLowerCase())}</span>` : '');
    function cardAfiliados() {
        const x = P.afilCartao(afil, itens, sobraDe), cab = '<b style="font-size:13px">Afiliados</b>';
        if (x.estado === 'sem_dado') return `<div class="card">${cab}<p class="det">${status.erroAfiliados ? 'Não consegui ler os afiliados agora. Sincronize de novo.' : 'Sincronize para ver.'}</p></div>`;
        if (x.estado === 'nao_usa') return `<div class="card">${cab}<p class="det">Esta conta não usa afiliados · <button class="lnk" data-abrir-afil="hub">Conhecer</button></p></div>`;
        const ped = x.pedidos, qPed = x.qtdVendas !== null ? x.qtdVendas : ped ? ped.pedidos : null;
        const pctVendas = x.custo !== null && x.vendas > 0 ? SHC.pctTxt(SHC.r2(x.custo / x.vendas * 100)) + ' das vendas' : '';
        const nCome = x.comeLucro.length, fato = x.vendas !== null ? `Afiliados venderam ${SHC.moeda(x.vendas)} em 30 dias.` : 'Sua campanha de afiliados está lida.';
        const acao = nCome ? (nCome === 1 ? `Em ${curtoTxt(x.comeLucro[0].titulo, 40)} a comissão come o lucro.` : `Em ${nCome} produtos a comissão come o lucro.`)
            : x.fora && x.fora.length ? `${SHC.qtd(x.fora.length, 'produto ativo está', 'produtos ativos estão')} fora da campanha.` : 'Nada pede sua atenção agora.';
        let h = `<p class="manchete"><span class="pt ${nCome ? 'at' : 'ok'}"></span><b>${esc(fato)}</b> ${esc(acao)}</p>
          <div class="kpis k4">${kpiN('', 'Vendas por afiliados', moedaOu(x.vendas), esc([qPed !== null ? SHC.qtd(qPed, 'pedido', 'pedidos') : '', x.unidades !== null ? intTxt(x.unidades) + ' un.' : ''].filter(Boolean).join(' · ')))}`
          + kpiN('', 'Comissão paga', moedaOu(x.custo), esc(pctVendas), 'Comissão que o Mercado Livre estima para os afiliados nos últimos 30 dias.')
          + kpiN(x.roi === null ? '' : x.roi >= 1 ? 'ok' : 'pr', 'Retorno (ROI)', xTxt(x.roi), x.roi === null ? '' : esc('R$ ' + (Math.round(x.roi * 100) / 100).toLocaleString('pt-BR') + ' por R$ 1'), 'ROI = vendas por afiliados ÷ comissão paga.')
          + kpiN(nCome ? 'at' : 'ok', 'Comissão come o lucro', String(nCome), nCome === 1 ? 'produto' : 'produtos', 'Produtos em que o que sobra da venda, menos a comissão do afiliado, fica negativo.') + '</div>'
          + `<p class="det" style="margin:-2px 0 8px">Últimos 30 dias${x.atualizado ? ' · o ML atualizou em ' + esc(quandoMl(x.atualizado)) : ''}${x.metricasInteiras ? '' : ' · lida só em parte'}</p>`;
        // Precisa de você: comissão que come o lucro
        if (nCome) h += `<div class="card"><div class="ch"><h3>Precisa de você</h3></div><ul class="acoes">`
            + x.comeLucro.slice(0, aberto('afil:come') ? 50 : 3).map(l => `<li class="acao at"><div class="tx"><b>${esc(curtoTxt(l.titulo, 40))}</b><span>com a comissão (${esc(SHC.pctTxt(l.pct))}): ${esc(menosMoeda(l.depois))} por venda</span></div><button class="bt leve pq" data-abrir-afil="campanha">Tirar no ML</button></li>`).join('')
            + '</ul>' + (nCome > 3 ? `<p class="rs">${esc(SHC.qtd(nCome - 3, 'outro produto', 'outros produtos'))} ${btVer('afil:come')}</p>` : '') + '</div>';
        // O que mais vendeu (top 3 aberto; o resto no Ver mais)
        const linhaTop = p => `<tr><td><b>${esc(curtoTxt(p.titulo || p.itemId, 40))}</b><span class="sm">${esc(SHC.qtd(p.qtdVendas || 0, 'pedido', 'pedidos'))} · ${esc(SHC.qtd(p.unidades || 0, 'unidade', 'unidades'))}${p.roi > 0 ? ' · ROI ' + esc(xTxt(p.roi)) : ''}</span></td><td>${intTxt(p.cliques)}</td><td>${SHC.moeda(p.vendas || 0)}</td><td>${moedaOu(p.custoEstimado)}</td></tr>`;
        const cabTop = '<thead><tr><th>Produto</th><th>Cliques</th><th>Vendas</th><th>Comissão</th></tr></thead>';
        h += x.top.length ? `<div class="card"><div class="ch"><h3>O que mais vendeu</h3><span class="d det">30 dias</span></div><table class="tb">${cabTop}<tbody>${x.top.slice(0, 3).map(linhaTop).join('')}`
            + (aberto('afil:top') ? x.top.slice(3).map(linhaTop).join('') : '') + '</tbody></table>'
            + (x.top.length > 3 ? `<p class="rs">Mais ${esc(SHC.qtd(x.top.length - 3, 'produto que vendeu', 'produtos que venderam'))} ${btVer('afil:top')}</p>` : '') + '</div>'
            : '<div class="card"><div class="ch"><h3>O que mais vendeu</h3></div><p class="det">Nenhuma venda por afiliados nos últimos 30 dias.</p></div>';
        // Sua campanha
        const faixa = x.faixa && x.faixa.min !== null && x.faixa.max !== null ? ` <span class="det">(o ML permite ${esc(SHC.pctTxt(x.faixa.min))} a ${esc(SHC.pctTxt(x.faixa.max))})</span>` : '';
        const naoVenda = [x.pausados ? SHC.qtd(x.pausados, 'pausado', 'pausados') : '', x.encerrados ? SHC.qtd(x.encerrados, 'encerrado', 'encerrados') : ''].filter(Boolean).join(' · ');
        let camp = `<table class="tb"><tr><td>Comissão geral</td><td><b>${x.comissao !== null ? esc(SHC.pctTxt(x.comissao)) : '—'}</b>${faixa}</td></tr>
          <tr><td>Produtos na campanha</td><td><b>${esc(x.naCampanha.toLocaleString('pt-BR'))}</b>${x.listaInteira ? '' : ` <span class="det">(${esc(SHC.qtd(x.lidos, 'lido', 'lidos'))})</span>`}</td></tr>`
          + (x.entradaAutomatica !== null ? `<tr><td>Anúncios novos entram sozinhos</td><td><b>${x.entradaAutomatica ? 'Sim' : 'Não'}</b></td></tr>` : '')
          + (x.inicio ? `<tr><td>Desde</td><td>${esc(dataAf(x.inicio))}</td></tr>` : '') + '</table>';
        const extra = x.comExtra.length ? `<p class="rs" style="margin-top:6px">${esc(SHC.qtd(x.comExtra.length, 'produto com comissão maior que a geral', 'produtos com comissão maior que a geral'))} ${btVer('afil:extra')}</p>`
            + (aberto('afil:extra') ? '<table class="tb">' + x.comExtra.slice(0, 30).map(p => `<tr><td>${esc(curtoTxt(p.titulo || p.itemId, 40))}</td><td><b>${esc(SHC.pctTxt(p.comissao))}</b></td></tr>`).join('') + '</table>' : '') : '';
        const parados = (x.pausados || x.encerrados) ? `<p class="rs" style="margin-top:6px">${esc(naoVenda)} na campanha: o anúncio não está à venda ${btVer('afil:parados')}</p>`
            + (aberto('afil:parados') ? '<table class="tb">' + P.anunciosAfilParados(afil).slice(0, 30).map(p => `<tr><td>${esc(curtoTxt(p.titulo || p.itemId, 40))}</td><td>${/^PAUSED$/i.test(p.publicacao) ? 'pausado' : 'encerrado'}</td></tr>`).join('') + '</table>' : '') : '';
        h += `<div class="card"><div class="ch"><h3>Sua campanha de afiliados</h3><span class="d">${statusAfil(x.status)}</span></div>${camp}${extra}${parados}
          <div class="acoes" style="justify-content:flex-start;flex-wrap:wrap"><button class="bt leve" data-abrir-afil="campanha">Abrir Venda com afiliados</button></div></div>`;
        // Pedidos por afiliados (recolhido)
        if (ped) {
            const cab = [ped.confirmados.pedidos ? SHC.qtd(ped.confirmados.pedidos, 'confirmado', 'confirmados') : '', ped.aVerificar.pedidos ? ped.aVerificar.pedidos + ' a verificar' : '',
                ped.outros.pedidos ? SHC.qtd(ped.outros.pedidos, 'outro', 'outros') : ''].filter(Boolean).join(' · ') || 'nenhum pedido';
            const tab = `<table class="tb"><thead><tr><th>SKU</th><th>A verificar</th><th>Confirmado</th><th>Comissão</th></tr></thead><tbody>`
                + ped.porSku.slice(0, 40).map(g => `<tr><td><b>${esc(g.sku || g.itemId)}</b><span class="sm">${esc(curtoTxt(g.titulo, 40))} · ${SHC.moeda(g.valor)}</span></td><td>${g.aVerificar}</td><td>${g.confirmados}</td><td>${SHC.moeda(g.comissao)}</td></tr>`).join('')
                + `</tbody></table><p class="det">A verificar: ${SHC.moeda(ped.aVerificar.valor)} em vendas, ${SHC.moeda(ped.aVerificar.comissao)} de comissão. Confirmado: ${SHC.moeda(ped.confirmados.valor)}, ${SHC.moeda(ped.confirmados.comissao)} de comissão.${ped.completo === false ? ' Lidos só em parte.' : ''} O Copiloto não guarda nome de afiliado nem de comprador.</p>`;
            h += blocoAf('afil:pedidos', 'Pedidos por afiliados', esc(cab + (ped.pedidos ? ' · por SKU' : ' em 30 dias')), ped.pedidos ? tab : '');
        } else h += `<div class="card"><div class="ch"><h3>Pedidos por afiliados</h3></div><p class="det">${afil.pedidos === null ? 'Não consegui ler os pedidos agora. Aparecem na próxima sincronização.' : 'Aparecem depois da próxima sincronização.'}</p></div>`;
        // Fora da campanha (recolhido)
        if (x.fora && x.fora.length) h += blocoAf('afil:fora', 'Fora da campanha', esc(SHC.qtd(x.fora.length, 'anúncio ativo que os afiliados não divulgam', 'anúncios ativos que os afiliados não divulgam')),
            '<table class="tb">' + x.fora.slice(0, 40).map(it => `<tr><td>${esc(curtoTxt(it.titulo || it.itemId, 44))}</td><td>${it.preco > 0 ? SHC.moeda(it.preco) : ''}</td></tr>`).join('') + '</table>'
            + (x.fora.length > 40 ? `<p class="det">e mais ${esc(String(x.fora.length - 40))}.</p>` : ''));
        else if (!x.listaInteira) h += `<div class="card"><div class="ch"><h3>Fora da campanha</h3></div><p class="det">Aparece quando a lista inteira da campanha for lida (${esc(SHC.qtd(x.lidos, 'produto lido', 'produtos lidos'))}${x.naCampanha > x.lidos ? ' de ' + esc(x.naCampanha.toLocaleString('pt-BR')) : ''}).</p></div>`;
        // Clique sem venda (recolhido)
        if (x.semVenda.length) h += blocoAf('afil:clique', 'Clique sem venda', esc(SHC.qtd(x.semVenda.length, 'produto', 'produtos') + ' · ' + SHC.qtd(x.semVenda.reduce((t, p) => t + p.cliques, 0), 'clique', 'cliques')),
            '<p class="det" style="margin-top:6px">' + x.semVenda.slice(0, 10).map(p => esc(curtoTxt(p.titulo || p.itemId, 36)) + ' (' + p.cliques + ')').join(' · ') + '</p>');
        return h + '<p class="det">Fonte: Venda com afiliados (Mercado Livre). Entrar ou sair da campanha é com você, no ML.</p>';
    }

    // ── Aba Pós-venda (v2.9, pedido da dona): posvenda:<conta> — o que está em aberto (abas do ML) + motivos e produtos das reclamações
    // que a lista do ML mostra. Nada do comprador; o nº do pedido nem chega aqui. Responder e reclamar é no ML. ──
    const DICA_MOTIVO = [[/diferente|n[ãa]o corresponde/i, 'Revise fotos, cor e descrição do anúncio'], [/sem o produto|incompleto|faltando|faltou/i, 'Confira a separação antes de fechar o pacote'],
        [/danific|quebrad|embalage/i, 'Reforce a embalagem'], [/arrepend/i, 'Deixe medidas e detalhes claros no anúncio'], [/defeito|n[ãa]o funciona/i, 'Teste o lote antes de enviar']];
    /** Motivo do ML → dica curta de ação ('' = sem dica). */
    P.dicaMotivo = m => (DICA_MOTIVO.find(([re]) => re.test(m || '')) || [null, ''])[1];
    /** posvenda:<conta> × anúncios → SHC.posvendaAnalise | null (a lista ainda não foi lida). */
    P.posAnalise = (pv, its) => (pv && Array.isArray(pv.casos) ? SHC.posvendaAnalise(pv.casos, its) : null);
    const ddmmHora = ts => { const d = new Date(ts), z = n => String(n).padStart(2, '0'); return z(d.getDate()) + '/' + z(d.getMonth() + 1) + ' às ' + z(d.getHours()) + ':' + z(d.getMinutes()); };
    function desenhaPos() { $('#listaPos').innerHTML = cardPosVenda(); }
    function cardPosVenda() {
        const pv = P.posVenda(posvenda);
        if (!pv) return `<div class="card"><div class="ch"><h3>Pós-venda</h3></div><p class="det">${status.erroPosVenda ? 'Não consegui ler o pós-venda agora. Sincronize de novo.' : 'Aparece depois da próxima sincronização.'}</p></div>`;
        const a = P.posAnalise(posvenda, itens), t = v => (v === null ? '—' : P.milhar(v)), { r, m, d } = pv;
        const top = a && a.motivos.length ? a.motivos[0].motivo : '';
        const [cor, fato, acao] = r > 0 ? ['pr', SHC.qtd(r, 'reclamação ou mediação em aberto.', 'reclamações ou mediações em aberto.'), 'Responda no ML para proteger a reputação.']
            : d > 0 ? ['at', SHC.qtd(d, 'devolução pendente.', 'devoluções pendentes.'), 'Acompanhe no ML.']
            : m > 0 ? ['at', SHC.qtd(m, 'mensagem sem resposta.', 'mensagens sem resposta.'), 'Responda no ML.']
            : ['ok', 'Nada em aberto no pós-venda.', top ? `O motivo que mais aparece é “${curtoTxt(top, 34)}”.` : ''];
        let h = `<p class="manchete"><span class="pt ${cor}"></span><b>${esc(fato)}</b> ${esc(acao)}</p><div class="kpis k4">`
            + kpiN(r > 0 ? 'pr' : r === 0 ? 'ok' : '', 'Reclamações e mediações', t(r), 'em aberto')
            + kpiN(d > 0 ? 'at' : '', 'Devoluções', t(d), 'pendentes')
            + kpiN(m > 0 ? 'at' : '', 'Mensagens', t(m), 'sem resposta')
            + kpiN(!a ? '' : a.naReputacao ? 'pr' : 'ok', 'Na reputação', a ? String(a.naReputacao) : '—', a ? esc('de ' + SHC.qtd(a.total, 'reclamação lida', 'reclamações lidas')) : '', 'Reclamações da lista do ML que o próprio ML diz que afetaram a sua reputação.') + '</div>';
        // Precisa de você: o que está em aberto agora (o ML não passa o prazo nesta tela: sem prazo inventado).
        const ab = [r > 0 ? ['pr', 'Reclamações e mediações', SHC.qtd(r, 'em aberto', 'em aberto') + ' · responda para proteger a reputação'] : null,
            d > 0 ? ['at', 'Devoluções', SHC.qtd(d, 'pendente', 'pendentes')] : null, m > 0 ? ['at', 'Mensagens', SHC.qtd(m, 'sem resposta', 'sem resposta')] : null].filter(Boolean);
        if (ab.length) h += '<div class="card"><div class="ch"><h3>Precisa de você</h3></div><ul class="acoes">'
            + ab.map(([c, tit, tx]) => `<li class="acao ${c}"><div class="tx"><b>${esc(tit)}</b><span>${esc(tx)}</span></div><button class="bt leve pq" data-abrir-posvenda>Abrir no ML</button></li>`).join('') + '</ul></div>';
        if (!a) return h + '<div class="card"><div class="ch"><h3>Motivos das reclamações</h3></div><p class="det">Os motivos e os produtos com mais reclamação aparecem depois da próxima sincronização.</p></div>';
        if (!a.total) return h + '<div class="card"><div class="ch"><h3>Motivos das reclamações</h3></div><p class="det">✓ Nenhuma reclamação na lista do Mercado Livre.</p></div>';
        // Motivos agrupados: barra = casos ÷ o maior.
        const max = a.motivos[0].casos, nMot = aberto('pos:motivos') ? a.motivos.length : 5;
        h += `<div class="card"><div class="ch"><h3>Motivos das reclamações</h3><span class="d det">${esc(SHC.qtd(a.total, 'reclamação', 'reclamações'))}</span></div>`
            + a.motivos.slice(0, nMot).map((x, i) => `<div class="hb"><div class="l"><b>${esc(curtoTxt(x.motivo, 40))}</b><span class="v">${x.casos}${x.valor > 0 ? ' · <small>' + SHC.moeda(x.valor) + '</small>' : ''}</span></div>`
                + `<div class="medidor"><i class="${i === 0 ? 'pr' : x.casos > 1 ? 'at' : ''}" style="width:${Math.max(4, Math.round(x.casos / max * 100))}%"></i></div></div>`).join('')
            + (a.motivos.length > 5 ? `<p class="rs">${esc(SHC.qtd(a.motivos.length - 5, 'outro motivo', 'outros motivos'))} ${btVer('pos:motivos')}</p>` : '')
            + `<p class="rs">${esc(a.naReputacao + ' de ' + a.total)} contaram na sua reputação.</p></div>`;
        // Produtos que mais dão problema (SKU pelo anúncio achado pelo título; sem anúncio, o título).
        const linhaP = p => {
            const ms = Object.keys(p.motivos).sort((x, y) => p.motivos[y] - p.motivos[x]), dica = P.dicaMotivo(ms[0]);
            return `<tr><td><b>${esc(p.sku || curtoTxt(p.titulo, 40))}</b><span class="sm">${esc((p.sku ? curtoTxt(p.titulo, 36) + ' · ' : '') + ms.map(x => curtoTxt(x, 30) + ' (' + p.motivos[x] + ')').join(' · '))}</span>`
                + `${dica ? `<span class="dica">${esc(dica)}</span>` : ''}</td><td>${p.casos}</td><td>${p.valor > 0 ? SHC.moeda(p.valor) : '—'}</td></tr>`;
        };
        h += '<div class="card"><div class="ch"><h3>Produtos que mais dão problema</h3></div><table class="tb"><thead><tr><th>SKU</th><th>Casos</th><th>Valor</th></tr></thead><tbody>'
            + a.produtos.slice(0, aberto('pos:prod') ? 50 : 3).map(linhaP).join('') + '</tbody></table>'
            + (a.produtos.length > 3 ? `<p class="rs">${esc(SHC.qtd(a.produtos.length - 3, 'outro produto', 'outros produtos'))} ${btVer('pos:prod')}</p>` : '') + '</div>';
        // Todas as reclamações lidas (recolhido): produto, motivo, situação, valor e se contou na reputação. Sem pedido, sem comprador.
        const cs = posvenda.casos;
        h += blocoAf('pos:casos', 'Todas as reclamações lidas', esc(SHC.qtd(cs.length, 'reclamação', 'reclamações') + ' · sem nome do comprador'),
            '<table class="tb">' + cs.slice(0, 60).map(c => `<tr><td><b>${esc(curtoTxt(c.titulo || '—', 40))}</b><span class="sm">${esc([c.motivo, c.situacao].filter(Boolean).map(x => curtoTxt(x, 60)).join(' · '))}</span></td>`
                + `<td>${c.valor > 0 ? SHC.moeda(c.valor) : '—'}<span class="sm">${c.afetouReputacao === true ? 'contou na reputação' : c.afetouReputacao === false ? 'não contou' : ''}</span></td></tr>`).join('') + '</table>');
        return h + `<p class="det">${cs.length === 1 ? 'A reclamação mais recente' : 'As ' + esc(SHC.qtd(cs.length, '', 'reclamações mais recentes'))} que o Mercado Livre mostra${posvenda.paginas > 1 ? '; as outras ficam no pós-venda do ML' : ''}`
            + `${posvenda.casosTs ? ' · lidas em ' + esc(ddmmHora(posvenda.casosTs)) : ''}.</p>`;
    }

    // ── Full: mostra o que o ML mostra, em cada situação da conta; a sugestão de envio é estimativa ──
    const URL_FULL = { estoque: 'https://vendedores.mercadolivre.com.br/metricas/stock-full?target=fbm', envios: 'https://vendedores.mercadolivre.com.br/shipping/inbounds' };
    const semTags = t => String(t === null || t === undefined ? '' : t).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    // Texto do ML: string, ou os textos de um objeto que o Copiloto ainda não conhece (mostra o que o ML mandou).
    const txtML = x => typeof x === 'string' || typeof x === 'number' ? semTags(x)
        : (x && typeof x === 'object' ? semTags([].concat(...Object.values(x)).filter(v => typeof v === 'string' || typeof v === 'number').join(' · ')) : '');
    const fmtUn = v => { const n = P.un(v); return n === null ? '—' : n.toLocaleString('pt-BR'); };
    const LINKS_FULL = `<div class="acoes" style="justify-content:flex-start;flex-wrap:wrap"><button class="bt leve" data-abrir-full="estoque">Abrir Estoque Full</button><button class="bt leve" data-abrir-full="envios">Gestão de envios Full</button></div>`;
    // Plano de envio + saúde do estoque de cada produto (mínimo em unidades do SKU, c|sku|<SKU>.fullMinUn).
    function planoAtual() {
        const pl = planoBase();
        pl.linhas.forEach(l => { l.saude = P.saudeFull(l.p, l.prev.qtd, l.p.sku ? cadSku[SHC.chaveSku(l.p.sku)] : null); });
        return pl;
    }
    function planoBase() {
        const doFull = p => P.anunciosDoFull(p, itens), idsDe = idsDoPlano;
        return P.planoFull(full, {
            hoje: SHC.hoje(), dias: fullDias, idsDe, mesesLidos,
            // Sem nenhum anúncio ligado: vendas do ano passado desconhecidas (null), não "ainda não lidas".
            vmDe: p => { const ids = idsDe(p); return ids.length ? P.somaMeses(ids.map(id => vm[id])) : null; },
            lucroDe: p => {
                const its = doFull(p);
                if (!its.length) return { lucro: null, motivo: 'sem_anuncio' };
                const r = P.resumoSku({ itens: its }, (custoGrupo[its[0].sku ? 'sku:' + its[0].sku : 'mlb:' + its[0].itemId] || {}).dados || null, cfg);
                if (!(r.custo > 0)) return { lucro: null, motivo: 'sem_custo' };
                return r.pior ? { lucro: r.pior.s.sobra, motivo: '' } : { lucro: null, motivo: 'sem_preco' };
            },
        });
    }
    const chaveFull = p => [p.produtoId || '', p.variacao || '', p.itemId || p.sku || p.titulo || ''].join('|');   // variações do mesmo anúncio: uma chave cada
    const idsDoPlano = p => [...new Set(P.anunciosDoFull(p, itens).map(it => it.itemId).concat(P.idsDoFull(p)))];
    // v2.7: remessas (lista + detalhe lido na rodada lenta) — recolhido: "2 abertas · 3 fechadas nos últimos 30 dias · R$ X gastos em remessas este mês".
    function cardRemessas() {
        const rr = remessas ? SHC.remessasResumo(remessas, remDet, SHC.hoje().slice(0, 7)) : null;
        if (!rr || !rr.lidas) return '';
        // v2.9: linha do tempo simples (reservada → recebendo → processada) em vez da lista crua; recolhida por padrão.
        const k = 'full:remessas', ls = P.linhasRemessas(remessas, remDet), dm = d => (d ? P.dataBr(d).slice(0, 5) : '');
        const un = r => {
            const u = r.unidades, t = [u.enviadas !== null ? fmtUn(u.enviadas) + ' enviadas' : '', r.passo === 3 && r.aptas !== null ? fmtUn(r.aptas) + ' à venda' : '',
                u.faltando > 0 ? '<span class="vm">' + fmtUn(u.faltando) + ' faltando</span>' : ''].filter(Boolean);
            return t.length ? t.join(' · ') : (r.semDetalhe ? 'unidades: o detalhe ainda não foi lido' : 'unidades: o ML ainda não informou');
        };
        const resumo = P.remessasResumoTxt(rr) + (rr.custoPorUnidade !== null ? ' · ' + SHC.moeda(rr.custoPorUnidade) + ' por unidade' : '');
        let h = `<div class="card" id="cardRemessas"><div class="ch"><h3>Todas as remessas</h3></div><p class="rs">${esc(resumo)}${rr.multasMes ? ` · <span class="vm">multas ${SHC.moeda(rr.multasMes)}</span>` : ''} ${btVer(k, 'Ver mais', 'Ver menos')}</p>`;
        if (aberto(k)) {
            h += '<ul class="tl">' + ls.map(r => {
                const cls = r.inconforme || r.multaTexto ? 'pr' : r.passo === 3 ? 'ok' : r.passo > 0 ? 'at' : '';
                return `<li${cls ? ` class="${cls}"` : ''}><div class="dt">${esc([dm(r.quando), r.statusTexto].filter(Boolean).join(' · '))}</div>`
                    + `<div class="ev">#${esc(r.id)} · ${un(r)}</div>${P.passosRem(r.passo, null, true)}`
                    + [r.custo ? 'o ML cobrou ' + SHC.moeda(r.custo) : ''].concat(r.textos.map(esc), r.multaTexto ? [esc(r.multaTexto)] : []).filter(Boolean).map(t => `<div class="sub">${t}</div>`).join('')
                    + `<a class="lnk" href="${esc(r.link)}" target="_blank" rel="noopener" style="font-size:11.5px">${r.inconforme ? 'Reclamar no ML' : 'Abrir no ML'}</a></li>`;
            }).join('') + '</ul>'
                + `<p class="det">${rr.lidas}${rr.total !== null && rr.total > rr.lidas ? ' de ' + rr.total : ''} remessas lidas em Gestão de envios Full${rr.semDetalhe ? '; o detalhe de ' + rr.semDetalhe + ' ainda não foi lido (o Copiloto lê aos poucos, com o Chrome aberto)' : ''}. Custo = o que o Mercado Livre cobrou pela coleta, com as multas.</p>`;
        }
        return h + '</div>';
    }
    // v2.9 (pedido da dona 26/09): remessa recebida com inconformidade, em destaque no topo da aba Full, com o botão para reclamar no ML.
    // Prazo só quando o ML manda a data (senão o botão diz só "Reclamar no ML"). Nome do produto vem do seu anúncio (itemId); o detalhe não guarda título.
    const incRemessas = () => (remessas ? SHC.remessasInconformes(remessas, remDet, SHC.hoje()) : []);
    function cardInconformes() {
        const tit = id => { const a = (itens || []).find(i => i && i.itemId === id); return a ? a.titulo : ''; };
        const n = v => (v === null || v === undefined ? '—' : fmtUn(v)), sinal = v => (v > 0 ? '+' + fmtUn(v) : v < 0 ? '−' + fmtUn(-v) : '0');
        return incRemessas().map(r => {
            const k = 'full:inc:' + r.id, temDif = p => (p.diferencas || 0) !== 0 || (p.naoAptas || 0) > 0;
            const ps = r.produtos.slice().sort((a, b) => temDif(b) - temDif(a)), vis = aberto(k) ? ps : ps.slice(0, 4);
            const motivo = r.motivos.join(' · '), pend = SHC.remessaPendente(r), prazo = pend && r.prazo ? P.dataBr(r.prazo).slice(0, 5) : '';
            const cls = r.reclamacaoAberta ? ' at' : pend ? '' : ' nd', tit3 = r.reclamacaoAberta ? 'Remessa #' + r.id + ': reclamação aberta' : 'Remessa #' + r.id + ' veio com diferença';
            let h = `<div class="card inc${cls}"><div class="ch"><h3>${esc(tit3)}</h3>${prazo ? `<span class="prazo pr d">reclame até ${esc(prazo)}</span>` : ''}</div>`
                + `<p class="rs">Processada em ${esc(P.dataBr(r.quando).slice(0, 5))} · <b>${esc(motivo.charAt(0).toUpperCase() + motivo.slice(1))}</b>${r.custo ? ` · o ML cobrou <b>${SHC.moeda(r.custo)}</b>` : ''}</p>`
                + (r.declaradas !== null || r.aptas !== null ? `<p class="rs">${n(r.declaradas)} declaradas · ${n(r.aptas)} aptas para o Full</p>` : '');
            if (ps.length) h += '<table class="tb" style="margin:8px 0 4px"><thead><tr><th>Produto</th><th>Enviou</th><th>Contou</th><th>Aptas</th><th>Dif.</th></tr></thead><tbody>'
                + vis.map(p => `<tr><td>${esc(curtoTxt(tit(p.itemId) || p.sku || p.itemId, 34))}<span class="sm">${esc([p.sku, (p.naoAptas || 0) > 0 ? fmtUn(p.naoAptas) + ' não aptas' : '', p.resultado].filter(Boolean).join(' · '))}</span></td>`
                    + `<td>${n(p.declaradas)}</td><td>${n(p.processadas)}</td><td>${n(p.aptas)}</td><td${p.diferencas ? ' class="vm"' : ''}>${p.diferencas === null || p.diferencas === undefined ? '—' : sinal(p.diferencas)}</td></tr>`).join('')
                + '</tbody></table>' + (ps.length > 4 ? `<p class="rs">${esc(SHC.qtd(ps.length - 4, 'outro produto', 'outros produtos'))} ${btVer(k)}</p>` : '');
            else h += '<p class="det">O detalhe por produto aparece depois da próxima leitura desta remessa.</p>';
            const [bt, dica] = r.reclamacaoAberta ? ['Ver a reclamação no ML', 'Você já abriu a reclamação desta remessa. Acompanhe a resposta no ML.']
                : !pend ? ['Ver a remessa no ML', 'O ML não aceita mais reclamação nesta remessa.']
                : ['Reclamar no ML', 'Abre a remessa no ML: lá, toque em “Iniciar reclamação por diferenças”.'];
            return h + `<div class="linha-bts"><a class="bt ${pend ? 'ml' : 'leve'}" href="${esc(r.link)}" target="_blank" rel="noopener">${esc(bt)}</a></div>`
                + `<p class="det" style="margin:6px 0 0">${esc(dica)}</p></div>`;
        }).join('');
    }
    // v2.9: a próxima remessa aberta em passos + o que fazer agora (só datas que o ML deu).
    function cardCaminho() {
        if (!remessas || !(remessas.remessas || []).length) return '';
        const ab = P.linhasRemessas(remessas, remDet).filter(r => r.passo === 1 || r.passo === 2).sort((a, b) => (a.agendada || '9').localeCompare(b.agendada || '9'));
        if (!ab.length) return '<div class="card"><div class="ch"><h3>Remessa a caminho</h3></div><p class="rs">Nenhuma remessa aberta agora. Veja abaixo o que enviar primeiro.</p></div>';
        const r = ab[0], d = remDet && remDet.porId && remDet.porId[r.id], u = r.unidades.enviadas;
        const info = [u !== null ? fmtUn(u) + ' un.' + (d && d.produtos && d.produtos.length ? ' de ' + SHC.qtd(d.produtos.length, 'produto', 'produtos') : '') : '', d && d.centro ? 'centro ' + d.centro : ''].filter(Boolean).join(' · ');
        return `<div class="card" id="cardCaminho"><div class="ch"><h3>Remessa a caminho</h3><span class="selo d">#${esc(r.id)}</span></div>`
            + P.passosRem(r.passo, [r.agendada ? 'para ' + P.dataBr(r.agendada).slice(0, 5) : '—', r.passo === 2 ? 'agora' : '—', '—'])
            + (info ? `<p class="rs">${esc(info)}</p>` : '')
            + `<ul class="acoes"><li class="acao at"><div class="tx"><b>O que fazer agora</b><span>${esc(P.agoraRem(r.passo, r.agendada, SHC.hoje()))}</span></div><a class="bt leve pq" href="${esc(r.link)}" target="_blank" rel="noopener">Ver no ML</a></li></ul>`
            + (ab.length > 1 ? `<p class="rs">Mais ${esc(SHC.qtd(ab.length - 1, 'remessa aberta', 'remessas abertas'))} em Todas as remessas.</p>` : '') + '</div>';
    }
    // v2.9: pontuação do Full em medidor (0–100, faixas vermelho/amarelo/verde) + as métricas do ML em barras; espaço por mês no "Ver mais".
    function cardPontuacao() {
        const pt = full.pontuacao || {}, cards = pt.cards || [], meses = full.mesesEspaco || [], tot = txtML(pt.total), v = P.un(tot), max = P.un(pt.max) > 0 ? P.un(pt.max) : 100;
        if (!cards.length && !meses.length && !tot) return '';
        const k = 'full:pontos', pct = v === null ? null : Math.max(0, Math.min(100, v / max * 100)), fx = pct === null ? '' : P.faixaPontos(pct);
        const nomeFx = { pr: 'Faixa vermelha', at: 'Faixa amarela', ok: 'Faixa verde' }[fx] || '';
        let h = `<div class="card" id="cardPontos"><div class="ch"><h3>Pontuação no Full</h3>${txtML(pt.titulo) ? `<span class="d det">${esc(txtML(pt.titulo).replace(/^Pontuação e métricas de\s*/i, ''))}</span>` : ''}</div>`;
        h += v !== null ? `<div class="gauge">${P.gaugeSvg(v, max)}<div><div class="gv">${fmtUn(v)}<small> de ${fmtUn(max)}</small></div><div class="fx ${fx}">${nomeFx}</div></div></div>`
            + '<div class="faixas"><span><i style="background:#EF4444"></i>0–49 baixa</span><span><i style="background:#F59E0B"></i>50–74 atenção</span><span><i style="background:#10B981"></i>75–100 boa</span></div>'
            : `<p class="rs">${tot ? esc(tot) : 'O Mercado Livre ainda não mostrou o total.'}</p>`;
        h += cards.map(c => {
            const cm = P.un(c.max), cp = P.un(c.pontos), p = cm > 0 && cp !== null ? Math.max(0, Math.min(100, cp / cm * 100)) : null;
            return `<div class="hb"><div class="l"><b>${esc(txtML(c.titulo))}</b><span class="v">${cm !== null ? fmtUn(c.pontos) + ' / ' + fmtUn(cm) : esc(txtML(c.pontos))}</span></div>`
                + (p !== null ? `<div class="medidor"><i class="${P.faixaPontos(p)}" style="width:${Math.max(3, Math.round(p))}%"></i></div>` : '') + (txtML(c.texto) ? `<small class="det">${esc(txtML(c.texto))}</small>` : '') + '</div>';
        }).join('') + (txtML(pt.dica) ? `<div class="recnota aviso">${esc(txtML(pt.dica))}</div>` : '');
        if (meses.length) h += `<p class="rs" style="margin-top:8px">Espaço por mês (o ML define pela pontuação) ${btVer(k)}</p>`
            + (aberto(k) ? meses.map(m => `<small class="det" style="display:block">• ${esc(txtML(m.mes))}${txtML(m.pill) ? ': ' + esc(txtML(m.pill)) : ''}${(m.segmentos || []).length ? ' (' + esc(m.segmentos.map(g => txtML(g.titulo) + ' ' + fmtUn(g.unidades) + ' un.').join(', ')) + ')' : ''}${txtML(m.motivo) ? ' — ' + esc(txtML(m.motivo)) : ''}</small>`).join('') : '');
        return h + '</div>';
    }
    // v2.9: topo da aba Full — manchete de 1 frase + 3 KPIs (com diferença, enviar agora, pontuação).
    function topoFull(prods) {
        const todas = incRemessas(), inc = todas.filter(SHC.remessaPendente), abertas = todas.filter(r => r.reclamacaoAberta).length, custo = inc.reduce((s, r) => s + (r.custo || 0), 0), pl = prods.length ? planoAtual() : { linhas: [] };
        const env = pl.linhas.filter(l => l.qtd > 0), unEnv = env.reduce((s, l) => s + l.qtd, 0), nc = P.contaClasses(pl.linhas);
        const pt = full.pontuacao || {}, v = P.un(txtML(pt.total)), max = P.un(pt.max) > 0 ? P.un(pt.max) : 100, fx = v === null ? '' : P.faixaPontos(v / max * 100);
        const prazo = inc.find(r => r.prazo), urg = (nc.critico || 0) + (nc.sem_estoque || 0);
        const [cor, fato, acao] = inc.length ? ['pr', SHC.qtd(inc.length, 'remessa veio com diferença.', 'remessas vieram com diferença.'), prazo ? `Reclame no ML até ${P.dataBr(prazo.prazo).slice(0, 5)}.` : 'Confira e reclame no ML.']
            : urg ? ['at', SHC.qtd(urg, 'produto acabando no Full.', 'produtos acabando no Full.'), 'Veja o que enviar primeiro.']
            : abertas ? ['at', SHC.qtd(abertas, 'reclamação de remessa aberta.', 'reclamações de remessa abertas.'), 'Acompanhe no ML.']
            : ['ok', 'Seu Full está em dia.', 'Nada pede sua atenção agora.'];
        return `<p class="manchete"><span class="pt ${cor}"></span><b>${esc(fato)}</b> ${esc(acao)}</p><div class="kpis k3">`
            + kpiN(inc.length ? 'pr' : remessas ? 'ok' : '', 'Com diferença', remessas ? String(inc.length) : '—', esc(inc.length && custo ? 'custo ' + SHC.moeda(custo) : remessas ? 'últimos 90 dias' : 'remessas não lidas'))
            + kpiN(unEnv ? 'at' : prods.length ? 'ok' : '', 'Enviar agora', unEnv ? fmtUn(unEnv) + ' un.' : '0', esc(unEnv ? 'de ' + SHC.qtd(env.length, 'produto', 'produtos') : 'nada urgente'))
            + kpiN(fx, 'Pontuação', v === null ? '—' : fmtUn(v), esc(v === null ? 'não lida' : 'de ' + fmtUn(max) + ' · ' + ({ pr: 'vermelha', at: 'amarela', ok: 'verde' })[fx]), 'Pontuação do Full que o Mercado Livre mostra no Estoque Full.') + '</div>';
    }
    // v2.7: próxima remessa — SKUs e quantidades da sugestão de envio (editáveis), volume, peso, veículo e custo estimado (SHC.simulaRemessa, honesto: aprende com as suas remessas).
    function cardProxRemessa() {
        const pl = planoAtual(), linhas = pl.linhas.filter(l => l.qtd > 0 || simQtd[(l.p && l.p.sku) || (l.p && (l.p.itemId || l.p.titulo)) || ''] !== undefined).map(l => Object.assign({ itemIds: idsDoPlano(l.p) }, l));
        const k = 'full:proxima', skus = P.skusParaSimular(linhas, simQtd, (ids, sku) => SHC.medidasParaSimular(ids, medidas, sku ? cadSku[SHC.chaveSku(sku)] : null));
        const s = SHC.simulaRemessa({ skus, remessasAnteriores: remessas });
        const resumo = !skus.length ? 'nada a enviar para essa cobertura' : `${fmtUn(s.unidades)} un. de ${SHC.qtd(skus.length, 'SKU', 'SKUs')}${s.veiculo ? ' · ' + s.veiculo.replace(/ \(.*$/, '') : ''}${s.custoEstimado ? ' · cerca de ' + SHC.moeda(s.custoEstimado.valor) : ''}`;
        let h = `<div class="card" id="cardProxRemessa"><b style="font-size:13px">Próxima remessa (estimativa)</b>${aberto(k) ? '' : ` <span class="res">· ${esc(resumo)}</span>`}${btVer(k)}`;
        if (!aberto(k)) return h + '</div>';
        if (!skus.length) return h + '<p class="det">Nenhum produto precisa de envio para a cobertura escolhida acima. Mude os dias em Cobrir para simular.</p></div>';
        const fmt3 = v => String(Math.round(v * 1000) / 1000).replace('.', ','), kg = v => String(SHC.r2(v)).replace('.', ',') + ' kg';
        h += `<p class="det" style="margin-top:6px">As quantidades vêm da sugestão de envio acima. Edite e toque em Recalcular. Nada é criado no Mercado Livre.</p>`
            + skus.map(x => { const it = s.itens.find(i => i.sku === x.sku) || {}; return `<div class="minfull"><label><span style="flex:1;min-width:0;white-space:normal;font-weight:600">${esc(curtoTxt(x.titulo || x.sku, 44))}</span><input class="inp" data-sim-sku="${esc(x.sku)}" inputmode="numeric" value="${x.qtd}"></label><span>un.</span></div>`
                + `<small class="det" style="display:block;margin:-2px 0 4px">${x.medidas ? `${it.volumeM3 !== null && it.volumeM3 !== undefined ? fmt3(it.volumeM3) + ' m³' : ''}${it.pesoKg !== null && it.pesoKg !== undefined ? ' · ' + kg(it.pesoKg) : ' · sem peso'} (medidas ${x.fonteMedida === 'ml' ? 'do anúncio no ML' : 'do seu ERP/planilha'})` : 'sem medida: o Copiloto lê as medidas do anúncio na rodada lenta, ou informe na planilha do ERP'}</small>`; }).join('')
            + `<div class="acoes" style="justify-content:flex-start"><button class="bt leve" data-sim-ver>Recalcular</button></div>`
            + `<div class="recnota neutra"><b>${fmtUn(s.unidades)} un.</b> · volume ${fmt3(s.volumeM3)} m³${s.semMedida.length ? ' (sem ' + SHC.qtd(s.semMedida.length, 'SKU', 'SKUs') + ')' : ''} · peso ${kg(s.pesoKg)}${s.semPeso.length ? ' (sem ' + SHC.qtd(s.semPeso.length, 'SKU', 'SKUs') + ')' : ''}${s.volumesEstimados.texto ? ' · ' + esc(s.volumesEstimados.texto) : ''}<br>`
            + `Veículo sugerido: ${s.veiculo ? '<b>' + esc(s.veiculo) + '</b>' : esc(s.veiculoMotivo)}<br>`
            + (s.custoEstimado ? `Custo estimado da coleta: <b>${SHC.moeda(s.custoEstimado.valor)}</b> (de ${SHC.moeda(s.custoEstimado.min)} a ${SHC.moeda(s.custoEstimado.max)}) · ${SHC.moeda(s.custoEstimado.porUnidade)} por unidade, a média das suas últimas ${SHC.qtd(s.custoEstimado.base, 'remessa fechada', 'remessas fechadas')} com cobrança.` : esc(s.custoMotivo)) + '</div>'
            + '<p class="det">O Mercado Livre cobra a coleta por distância e não publica a tabela: o custo aqui é o que ele cobrou nas suas remessas anteriores, por unidade. Volume = a soma das caixas dos produtos, sem folga. Fonte: Estoque Full, Gestão de envios Full e as medidas dos seus anúncios.</p>';
        return h + '</div>';
    }
    function desenhaFull() {
        const alvo = $('#listaFull');
        if (!full) {
            alvo.innerHTML = cardInconformes() + (status.erroFull
                ? '<div class="vazio"><b>Não consegui ler o Full agora</b>O Copiloto tenta de novo na próxima sincronização com o Mercado Livre.</div>'
                : '<div class="vazio"><b>O Full desta conta ainda não foi lido</b>Ele entra na próxima sincronização com o Mercado Livre.</div>') + LINKS_FULL;
            return;
        }
        // Leitura que falhou agora: o retrato de antes continua, com a data dele (não é "agora").
        const quando = full.ts ? 'Leitura do Full ' + tempo(full.ts) + '.' : '';
        const velho = status.erroFull ? `<div class="recnota aviso" style="margin:0 0 8px">Não consegui ler o Full agora. Mostrando a última leitura${full.ts ? ' (' + esc(tempo(full.ts)) + ')' : ''}.</div>` : '';
        if (!full.temFull) {
            // Só afirma "não usa o Full" com a frase do próprio ML; sem ela, a tela pode ter mudado.
            alvo.innerHTML = velho + cardInconformes() + (txtML(full.vazio)
                ? `<div class="card"><b style="font-size:13.5px">Esta conta ainda não usa o Full</b><p style="margin:6px 0 0">O Mercado Livre diz: “${esc(txtML(full.vazio))}”</p>
                  <p class="det">Quando você enviar produtos ao Full, o espaço, a pontuação e a sugestão de envio aparecem aqui.</p></div>`
                : '<div class="card"><b style="font-size:13.5px">Não reconheci a tela do Full desta conta</b><p class="det">Abra o Estoque Full no Mercado Livre para conferir.</p></div>')
                + LINKS_FULL + (quando ? `<p class="det">${esc(quando)}</p>` : '');
            return;
        }
        const prods = full.produtos || [], esp = full.espaco || [];
        const avisos = [...new Set((full.avisos || []).map(txtML).filter(Boolean))];   // da conta; os de cada produto ficam no produto
        let html = velho + avisos.map(a => `<div class="recnota ruim" style="margin:0 0 8px"><b>Aviso do Mercado Livre:</b> ${esc(a)}</div>`).join('')
            + topoFull(prods) + cardInconformes() + cardCaminho() + cardPontuacao() + cardRemessas();
        if (esp.length) {
            const maxPct = Math.max(...esp.map(e => Math.max(0, Math.min(100, P.un(e.pct) || 0))));
            html += dobra(`<div class="card"><b style="font-size:13px">Uso do seu espaço no Full</b>${esp.map(e => {
                const pct = Math.max(0, Math.min(100, P.un(e.pct) || 0)), cor = pct >= 90 ? 'var(--verm)' : (pct >= 70 ? 'var(--ambar)' : 'var(--verde)');
                return `<div style="margin-top:8px"><div style="display:flex;gap:6px;font-size:12px"><span style="flex:1">${esc(semTags(e.titulo).replace(/:.*$/, '') || e.id)}</span><b>${fmtUn(e.usado)} de ${fmtUn(e.capacidade)} un.</b></div>
                  <div class="prog" style="margin:4px 0 2px"><i style="width:${pct}%;background:${cor}"></i></div>
                  <small class="det">${[P.un(e.noFull) !== null ? 'No Full ' + fmtUn(e.noFull) + ' un.' : '', P.un(e.pendente) !== null ? 'entrada pendente ' + fmtUn(e.pendente) + ' un.' : '', P.un(e.livre) !== null ? 'você pode enviar até ' + fmtUn(e.livre) + ' un.' : ''].filter(Boolean).join(' · ')}</small></div>`;
            }).join('')}</div>`, 'full:espaco', esc(maxPct + '% usado' + (esp.length > 1 ? ' no espaço mais cheio' : '')));
        }
        const cea = full.custosEstoqueAntigo, ceaTxt = (Array.isArray(cea) ? cea : (cea && Array.isArray(cea.textos) ? cea.textos : (cea ? [cea] : []))).map(txtML).filter(Boolean);
        if (ceaTxt.length) html += dobra(`<div class="card"><b style="font-size:13px">Custos por estoque antigo</b>${ceaTxt.map(t => `<p class="det" style="margin:4px 0 0">${esc(t)}</p>`).join('')}<p class="det">Texto do Mercado Livre.</p></div>`, 'full:antigo', 'o ML mostra custo de armazenamento');
        html += prods.length ? cardPlanoFull() + cardProxRemessa() : '<div class="card"><b style="font-size:13px">Nenhum produto no Full agora</b><p class="det">Quando você enviar estoque, cada produto aparece aqui com a sugestão de envio.</p></div>';
        alvo.innerHTML = html + LINKS_FULL + `<p class="det">O Copiloto não cria envio nem mexe no seu Full: só mostra. Fonte: Estoque Full do Mercado Livre.${quando ? ' ' + esc(quando) : ''}</p>`;
    }
    const COR_CLASSE = { critico: 'p', sem_estoque: 'p', atencao: 'a', excedente: 'a', saudavel: 'l', parado: 'n' };
    const DICA_CLASSE = { critico: 'acaba em até 7 dias ou está abaixo do estoque mínimo que você definiu', atencao: 'acaba em até 15 dias', saudavel: 'estoque para mais de 15 dias',
        excedente: 'estoque para mais de 90 dias ou o ML mostra estoque antigo (pode ter custo de armazenamento)', parado: 'tem estoque e nenhuma venda em 30 dias', sem_estoque: 'nenhuma unidade apta no Full' };
    function cardPlanoFull() {
        const pl = planoAtual(), total = pl.linhas.reduce((a, l) => a + (l.qtd || 0), 0), nEnv = pl.linhas.filter(l => l.qtd > 0).length;
        const semCusto = pl.linhas.filter(l => l.lucro === null && !l.semAnuncio).length, semAn = pl.linhas.filter(l => l.semAnuncio).length;
        const nc = P.contaClasses(pl.linhas);
        let html = `<div class="card"><b style="font-size:13px">Saúde do estoque no Full</b>
          <div class="canais" style="margin-top:6px">${Object.keys(P.CLASSES_FULL).map(c => `<button class="${COR_CLASSE[c]}${fullClasse === c ? ' on' : ''}" data-fclasse="${c}" title="${esc(DICA_CLASSE[c])}">${nc[c]} ${esc(P.CLASSES_FULL[c].toLowerCase())}</button>`).join('')}${nc.semDado ? `<span class="n">${nc.semDado} sem dado</span>` : ''}</div>
          <p class="det">Crítico = ${esc(DICA_CLASSE.critico)}. O estoque mínimo é por produto, em unidades: defina em cada um abaixo. Toque numa classe para filtrar.</p></div>`;
        html += `<div class="card"><b style="font-size:13px">Sugestão de envio (estimativa)</b>
          <div class="sim"><label for="fullDias">Cobrir</label><input class="inp" id="fullDias" inputmode="numeric" value="${fullDias}"><span>dias</span><button class="bt leve" data-full-dias>Ver</button></div>
          <p style="margin:8px 0 0;font-size:12.5px">${nEnv ? `Enviar <b>${total} un.</b> de ${SHC.qtd(nEnv, 'produto', 'produtos')}, na ordem abaixo.` : 'Nenhum produto precisa de envio para essa cobertura.'}</p>
          <p class="det">Previsão de 30 dias = o maior entre as vendas dos últimos 30 dias e as do mesmo mês do ano passado. Ordem: quem acaba antes; empate, quem dá mais lucro. Com prejuízo, no fim.${semCusto ? ` ${SHC.qtd(semCusto, 'produto', 'produtos')} sem custo: a ordem não considera o lucro deles.` : ''}${semAn ? ` ${SHC.qtd(semAn, 'produto', 'produtos')} sem anúncio ligado na sua lista: sem lucro e sem vendas do ano passado.` : ''}</p></div>`;
        const vis = pl.linhas.filter(l => !fullClasse || (l.saude && l.saude.classe === fullClasse));
        // Produtos recolhidos: "Ver os N produtos" (ou tocar numa classe, que já filtra e abre).
        if (!fullClasse) html += `<button class="mais" data-ver="full:produtos" style="margin:0 0 8px">${aberto('full:produtos') ? 'Ver menos' : 'Ver ' + SHC.qtd(pl.linhas.length, 'produto', 'produtos') + (pl.linhas.length > 1 ? ', um a um' : '')}</button>`;
        if (!fullClasse && !aberto('full:produtos')) return html;
        if (fullClasse && !vis.length) html += '<div class="vazio">Nenhum produto nesta classe.</div>';
        html += vis.slice(0, limite.full).map(l => {
            const i = pl.linhas.indexOf(l), p = l.p, k = chaveFull(p), dML = typeof p.diasAteEsgotar === 'number' ? p.diasAteEsgotar + ' dias' : txtML(p.esgotarTexto || p.diasAteEsgotar);
            const acoes = [...new Set([].concat(p.acaoSugerida || [], p.avisos || []).map(txtML).filter(Boolean))];
            const sug = l.qtd === null ? `Sem sugestão: o ML não mostrou ${esc(l.semDado.join(' nem '))} deste produto`
                : l.qtd > 0 ? `Enviar <b>${l.qtd} un.</b>${l.limitado ? ` (você pode enviar até ${l.qtd}; o cálculo pedia ${l.bruto})` : ''}${l.semSegmento ? ' — sem limite de espaço: não sei em qual espaço do Full ele entra' : ''}`
                : (l.bruto > 0 ? 'Sem espaço livre para este produto agora' : 'Nada a enviar agora');
            return `<div class="card"><div class="tit">${l.qtd > 0 ? (i + 1) + '. ' : ''}${esc(p.titulo)}</div><div class="sub">${esc([p.sku ? 'SKU ' + p.sku : '', txtML(p.variacao), txtML(p.tamanho), txtML(p.status)].filter(Boolean).join(' · '))}</div>
              <div class="mes-grid"><div class="mes"><small>Vendas 30 dias</small><b>${fmtUn(p.vendas30)}</b></div><div class="mes"><small>Aptas</small><b>${fmtUn(p.aptas)}</b></div><div class="mes"><small>A caminho</small><b>${fmtUn(p.aCaminho)}</b></div></div>
              ${dML ? `<div class="det">Tempo até esgotar (ML): ${esc(dML)}</div>` : ''}${acoes.length ? `<div class="recnota aviso">Ação sugerida pelo ML: ${esc(acoes.join(' · '))}</div>` : ''}
              ${saudeHtml(l)}
              <div class="recnota ${l.qtd > 0 ? 'ok' : 'neutra'}">Copiloto: ${sug} <span class="det">(estimativa)</span></div>
              <button class="lnk explique" data-full-expl="${esc(k)}">${fullExpl.has(k) ? 'Fechar explicação' : 'Explique: por que esta quantidade?'}</button>${fullExpl.has(k) ? respHtml(P.explicaFull(l, pl.dias)) : ''}</div>`;
        }).join('') + botaoMais('full', vis.length - limite.full);
        return html;
    }
    // Classe do produto, aviso de estoque mínimo e o campo do mínimo em unidades (por SKU; sem SKU não há onde guardar).
    function saudeHtml(l) {
        const s = l.saude, p = l.p;
        const pill = s.classe ? `<span class="${COR_CLASSE[s.classe]}">${esc(P.CLASSES_FULL[s.classe])}</span>` : '<span class="n">sem dado para classificar</span>';
        const aviso = s.alerta || s.abaixoMin ? `<div class="recnota ruim">${esc(P.acaoFull(l))}</div>` : '';
        const ml = typeof p.diasAteEsgotar === 'number' ? p.diasAteEsgotar : null;
        const acaba = s.dias !== null && s.classe !== 'sem_estoque' ? `<span class="n">acaba em ${esc(P.dias(s.dias))}${ml !== null && s.dias < ml ? ' pela previsão' : ''}</span>` : '';
        const sku = esc(p.sku || '');
        const min = !p.sku ? '<p class="det">Sem SKU: não dá para guardar um estoque mínimo para este produto.</p>'
            : `<div class="minfull"><label>Estoque mínimo no Full: <input class="inp" data-min-sku="${sku}" inputmode="numeric" placeholder="—" value="${s.definido ? s.minUn : ''}"></label><span>un.</span><button class="bt leve" data-min-salvar="${sku}">Salvar</button></div>`
              + (!s.definido && s.sugerido ? `<p class="det" style="margin:3px 0 0">Sugestão: ${s.sugerido} un. (15 dias de venda) · <button class="lnk" style="font-size:11.5px" data-min-usar="${sku}" data-min-n="${s.sugerido}">Usar</button></p>` : '');
        return `<div class="canais" style="margin-top:6px;align-items:center">${pill}${acaba}</div>${aviso}${min}`;
    }

    // ── Ajustes ──
    function desenhaAjustes() {
        if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#ajustes')) return;
        $('#imposto_pct').value = P.txtImposto(cfg);
        $('#margem_alvo_pct').value = String(cfg.margem_alvo_pct).replace('.', ',');
        $('#meta_mes').value = SHC.num(cfg.meta_mes) > 0 ? SHC.moeda(SHC.num(cfg.meta_mes)).replace('R$ ', '') : '';   // v2.6: sem meta = vazio
        // Mesma conta do guia (SHC.guiaCustos): todos os SKUs e os 10 que mais vendem.
        const cu = SHC.guiaCustos(anuncios && anuncios.itens, Object.assign({}, custosMl, cadSku), vm), pct = cu.deTodos ? Math.round(cu.comTodos / cu.deTodos * 100) : 0;
        $('#custosProg').style.width = pct + '%';
        $('#custosBarra').setAttribute('aria-valuenow', String(pct));
        $('#infoCustos').innerHTML = cu.deTodos ? `<b>${pct}%</b> · ${cu.comTodos} de ${cu.deTodos} SKUs com custo` : 'Primeiro o Copiloto precisa ler a sua conta.';
        $('#infoPrincipais').textContent = cu.de ? `Principais: ${cu.com} de ${cu.de} que mais vendem` : '';
        if (!tinyRodando) $('#abrirTiny').textContent = tinyToken ? 'Tiny · Puxar custos agora' : 'Tiny · Conectar em 1 minuto';
        $('#infoSync').textContent = 'Automática a cada 3 horas, com o Mercado Livre deste Chrome.' + (status.ultimaOk ? ' Última: ' + new Date(status.ultimaOk).toLocaleString('pt-BR') + '.' : '');
        atualizaFundo().catch(() => {});
        // v2.8: c.nome já é o apelido de Ajustes (cfg.apelidos) OU o nome da própria conta lido do ML (nomeMl) OU "Conta ID …1234"
        // (SHC.nomeConta). O campo de apelido continua opcional: só para quem prefere um nome próprio no lugar do nome do ML.
        const ap = cfg.apelidos || {};
        $('#listaContasAj').innerHTML = contasLista.length ? contasLista.map(c => {
            const nomeAp = ap[c.sellerId];
            return `<div class="campo" style="background:#F8FAFC;border:1px solid var(--linha);border-left:3px solid ${c.atual ? 'var(--verde)' : '#D0D5DD'};border-radius:10px;padding:9px 10px 10px"><div class="conta-linha"><b>${esc(c.nome)}</b><span class="contatag">ID …${esc(c.sellerId.slice(-4))}</span>${c.atual ? '<span class="contatag agora">aberta agora</span>' : ''}</div><label for="ap-${esc(c.sellerId)}" style="font-weight:500;color:var(--suave)">Apelido próprio (opcional; no lugar do nome do ML)</label><input class="inp" id="ap-${esc(c.sellerId)}" data-apelido="${esc(c.sellerId)}" maxlength="40" placeholder="Ex.: Loja 1" value="${esc(nomeAp || '')}"></div>`;
        }).join('')
            : '<p class="det">Sincronize para o Copiloto saber qual é a sua conta. Cada conta em que você entrar neste Chrome aparece aqui.</p>';
        $('#salvarApelidos').hidden = !contasLista.length;
        // v2.8: módulos ligados/desligados (cfg.modulos[id] === false desliga).
        if (!document.activeElement || !document.activeElement.closest('#listaModulos')) {
            $('#listaModulos').innerHTML = P.MODULOS.map(m => `<label class="conf"><input type="checkbox" id="mod-${esc(m)}"${SHC.moduloLigado(cfg, m) ? ' checked' : ''}> <span><b style="white-space:nowrap">${esc(P.ROT_ABA[m])}</b> — ${esc(P.MODULO_DESC[m] || '')}</span></label>`).join('');
        }
    }

    const focoEm = sel => document.activeElement && document.activeElement.matches && document.activeElement.matches(sel);
    // Só a aba visível é redesenhada; as outras, quando forem abertas.
    function desenhaAba() {
        if (aba === 'geral') desenhaGeral();
        if (aba === 'promo' && !focoEm('[data-custo],[data-sim-meta],#margemRobo')) desenhaPromo();
        if (aba === 'frete' && !focoEm('#confMedidas,[data-csku]')) desenhaFrete();
        if (aba === 'catalogo' && !focoEm('[data-csku]')) desenhaCatalogo();
        if (aba === 'ads' && !focoEm('[data-csku]')) desenhaAds();
        if (aba === 'full' && !focoEm('#fullDias,[data-min-sku],[data-sim-sku]')) desenhaFull();
        if (aba === 'saude' && !focoEm(REGRAS_ROBO.map(k => '#' + k).join(','))) desenhaSaude();
        if (aba === 'conciliacao') desenhaConc();
        if (aba === 'canal') desenhaCanal();
        if (aba === 'afiliados') desenhaAfil();
        if (aba === 'posvenda') desenhaPos();
        if (aba === 'ajustes') desenhaAjustes();
    }
    // ── Alertas: cada um só na aba do seu módulo (Full, Ads, Saúde; frete, cobranças e pós-venda vêm do fundo, shc:anomalias). ──
    // O número no ícone é o do fundo (TODAS as anomalias, shc:anomalias): o painel não mexe nele.
    function desenhaAlertas() {
        const pl = full && full.temFull ? planoAtual() : { linhas: [] };
        const eq = adsSnap && adsSnap.temAds !== false ? P.adsEquilibrio(adsSnap, itens, sobraDe) : [];
        const daConta = SHC.alertasConta ? SHC.alertasConta(remessas || full || {}) : [];
        const rm = resumoMed();
        alertasAgora = P.alertas(pl.linhas, eq, daConta, { semFiscal: P.saudeFiscal(fiscal).n || 0, perdendo: P.radarLista(visitas, itens.filter(SHC.anuncioAtivo), cfg, SHC.hoje()).caindo.length, queda: cfg.radar_queda_pct,
            medDiv: rm.div.filter(P.medPesa).length, medMud: new Set(rm.mud.map(m => m.itemId)).size, medMudMl: new Set(rm.mud.filter(m => m.quem === 'ml').map(m => m.itemId)).size });
        desenhaTopoAba();
    }

    // ── Aba Geral: 1 linha por módulo (número principal + cor) e "Ver mais" (até 3 itens e "Abrir a aba …") ──
    const it3 = linhas => linhas.slice(0, 3).map(l => `<div class="it">${l}</div>`).join('');
    // → {id, cor, rs, html} para P.ordemGeral ('' = módulo desligado). rs = R$ em jogo (ordena dentro da mesma cor).
    function blocoGeral(id, nome, cor, resumo, corpo, irAba, rs) {
        if (P.MODULOS.indexOf(id) >= 0 && !SHC.moduloLigado(cfg, id)) return '';   // v2.8: módulo desligado em Ajustes some também da Geral
        // Sem dado ainda e a sincronização lendo: diz "lendo…" (etapa da aba em leitura) ou "na fila" em vez de "ainda não lido".
        const es = status.etapas || {}, pend = cor === 'neutra' && SHC.statusSync(status, Date.now()).estado === 'sincronizando'
            ? (ETAPAS_ABA[id] || []).filter(x => !es[x] || (es[x].estado !== 'ok' && es[x].estado !== 'pulado')) : [];
        if (pend.length) resumo = pend.some(x => es[x] && es[x].estado === 'lendo') ? 'lendo…' : 'na fila';
        const k = 'geral:' + id;
        return { id, cor, rs: rs || 0, html: `<div class="card gb" id="g-${id}"><div class="gb-l"><i class="dot ${cor}"></i><b>${esc(nome)}</b><span class="gb-v">${resumo}</span>${btVer(k)}</div>`
            + (aberto(k) ? `<div class="gb-c">${corpo || ''}${irAba ? `<button class="lnk ir" data-ir-aba="${irAba}">Abrir a aba ${esc(P.ROT_ABA[irAba])} ›</button>` : ''}</div>` : '') + '</div>' };
    }
    const somaRs = (xs, f) => xs.reduce((t, x) => t + (Number(f(x)) || 0), 0);
    // ── Faturamento por família (topo da Geral). Recolhido: a barra do mês dividida por família e até 5 linhas. Aberto: 13 meses em colunas,
    // o mês mais forte, "Prepare o Full", a lista de SKUs da família (maior queda primeiro, "Por que caiu?") e a curva ABC. ──
    const famSw = cor => `<i class="sw" style="background:${esc(cor)}" aria-hidden="true"></i>`;
    const famSetaHtml = x => { const s = P.famSeta(x); return s.txt ? ` <span class="fseta ${s.cls}">${esc(s.txt)}</span>` : ''; };
    function familiasDoMes() {
        const hoje = SHC.hoje(), atual = hoje.slice(0, 7), mes = famMes === 'anterior' ? P.mesMenos(atual, 1) : atual;
        const fams = SHC.familias(vbA, catA, anuncios, Object.assign({}, custosMl, cadSku), mes, { cfg, hoje, cores: coresA });
        if (fams.coresMudou) { coresA = fams.cores; SHC.gravarChave('cores:' + (conta || 'atual'), coresA).catch(() => {}); }   // família nova ganhou cor: fica para sempre
        return fams;
    }
    function metaHtml() {
        const m = P.metaTxt(SHC.metaMes(vb, SHC.hoje(), cfg.meta_mes));
        if (!m.texto) return '';
        return `<div class="meta-l"><p class="det" style="margin:0;color:#344054">${esc(m.texto)}${m.semMeta ? ' <button class="lnk" data-ir-aba="ajustes">Defina uma meta em Ajustes</button>' : ''}</p>`
            + (m.pct !== null ? `<div class="prog" role="progressbar" aria-label="Quanto já vendeu da meta do mês" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${m.pct}"><i style="width:${m.pct}%;background:${m.cor === 'ok' ? 'var(--verde)' : '#D97706'}"></i></div>`
                + `<p class="det" style="margin:-4px 0 0">${m.pct}% da meta já vendido.</p>` : '') + '</div>';
    }
    function linhaSkuFam(s, abc, ant) {
        const k = P.chaveSkuFam(s), tit = s.titulo || s.sku || (s.itemIds || [])[0] || '', id = (s.itemIds || [])[0] || '', mudou = P.famVendeu(s);
        const caiu = typeof s['variacaoR$'] === 'number' && s['variacaoR$'] < 0, aberta = famCausas.has(k);
        const valor = s.bruto > 0 ? SHC.moeda(s.bruto) : 'sem vendas neste mês' + (s.brutoAnt > 0 ? ` (${esc(ant)}: ${SHC.moeda(s.brutoAnt)})` : '');
        const dif = typeof s['variacaoR$'] === 'number' && s['variacaoR$'] !== 0 ? ` (${s['variacaoR$'] > 0 ? '+' : ''}${SHC.moeda(s['variacaoR$'])})` : '';
        const lucro = famModo === 'lucro' ? `<small>${s.lucro === null ? 'Lucro: sem custo deste SKU (informe no Catálogo)' : 'Lucro estimado: ' + SHC.moeda(s.lucro)}</small>` : '';
        let causas = '';
        if (aberta) {
            const cs = SHC.porQueCaiu(s, { itens, visitas: visitas && visitas.porItem, comp: compHist, fretes, full, ads: adsSnap, cfg, hoje: SHC.hoje() });
            causas = `<ul class="causas">${cs.map(c => `<li>${esc(c.texto)}</li>`).join('')}</ul>`;
        }
        return `<div class="fam-sku"><b>${abc ? `<span class="abc ${abc}" title="Curva ABC: ${abc}">${abc}</span>` : ''}${esc(curtoTxt(tit, 70))}</b>`
            + `<small>${s.sku ? 'SKU ' + esc(s.sku) + ' · ' : ''}${valor}${famSetaHtml(s)}${esc(dif)}${mudou ? ' · ' + esc(mudou) : ''}</small>${lucro}`
            + `<div class="acoes" style="justify-content:flex-start;margin-top:4px;gap:10px">${caiu ? `<button class="lnk" data-fam-causa="${esc(k)}" aria-expanded="${aberta}">${aberta ? 'Esconder os motivos' : 'Por que caiu?'}</button>` : ''}`
            + (/^MLB\d{6,14}$/.test(id) ? `<button class="lnk" data-abrir-anuncio="${esc(id)}">Ver anúncio</button>` : '') + `</div>${causas}</div>`;
    }
    function cardFamilia() {
        const fams = familiasDoMes(), k = 'geral:familia', ab = aberto(k), nome = P.mesLongo(fams.mes), ant = P.mesLongo(P.mesMenos(fams.mes, 1));
        const seg = `<span class="seg" role="group" aria-label="Mês"><button data-fam-mes="atual" aria-pressed="${famMes === 'atual'}">Este mês</button><button data-fam-mes="anterior" aria-pressed="${famMes === 'anterior'}">Mês passado</button></span>`;
        const cab = `<div class="gb-l"><b>Faturamento por família · ${esc(nome)}</b><span class="gb-v"></span>${seg}</div>`;
        const semCat = () => (fams.semCategoria > 0 ? (permWww
            ? `<p class="det">${esc(SHC.qtd(fams.semCategoria, 'anúncio com venda ainda sem categoria', 'anúncios com venda ainda sem categoria'))}: o Copiloto lê aos poucos, começando pelos que mais vendem.</p>`
            : `<p class="det">Para separar por família, o Copiloto precisa ler a categoria de cada anúncio (a mesma leitura das fotos e medidas).</p><button class="bt leve mini" data-perm-fotos>${esc(PERM_TXT)}</button>`) : '');
        if (!fams.lido || !fams.length) {
            const diag = fams.lido ? [] : SHC.textosMeses(((status.etapas || {}).vendasAnuncio || {}).meses || {}).filter(t => t.indexOf(P.nomeMes(fams.mes)) === 0);
            return `<div class="card gb" id="g-familia">${cab}<p class="det">${esc(fams.motivo || 'Sem vendas neste mês.')}${diag.length ? ' ' + esc(diag[0]) + '.' : ''}</p>${metaHtml()}</div>`;
        }
        if (!fams.some(f => f.familia === famSel)) famSel = fams[0].familia;
        const comVenda = fams.filter(f => f.bruto > 0), barra = `<div class="fam-barra" aria-hidden="true">${comVenda.map(f => `<i style="width:${f.pct}%;background:${esc(f.cor)}" title="${esc(f.familia)}: ${SHC.moeda(f.bruto)} (${P.pctFam(f.pct)})"></i>`).join('')}</div>`;
        const ritmo = [fams.mesParcial ? (fams.mesAtual ? `${nome} lido até o dia ${fams.dias}` : `${nome} lido só até o dia ${fams.dias}`) : '', fams.antParcial ? `${ant} lido só até o dia ${fams.diasAnt}` : ''].filter(Boolean).join(' e ');
        const comp = fams.motivoComp || (fams.totalAnt === null ? `Sem ${ant} lido: as setas aparecem quando ele for lido.`
            : 'Setas: contra ' + ant + (fams.comparacao === 'ritmo' ? `, pelo ritmo por dia (${ritmo})` : '') + '.');
        const topo = `<p class="det" style="margin:6px 0 0;color:#344054">Total: <b>${SHC.moeda(fams.total)}</b>${famSetaHtml({ bruto: fams.total, brutoAnt: fams.totalAnt, variacaoPct: fams.totalAnt > 0 ? (fams.total - fams.totalAnt * fams.fator) / (fams.totalAnt * fams.fator) * 100 : null })}</p>${barra}`;
        if (!ab) {
            const cinco = comVenda.slice(0, 5).map(f => `<div class="fam-l">${famSw(f.cor)}<span class="nm">${esc(f.familia)}</span><span class="vl">${SHC.moeda(f.bruto)}</span><span class="pc">${P.pctFam(f.pct)}</span>${famSetaHtml(f)}</div>`).join('');
            const resto = comVenda.length > 5 ? `<p class="det" style="margin:2px 0 0">E mais ${esc(SHC.qtd(comVenda.length - 5, 'família', 'famílias'))}.</p>` : '';
            return `<div class="card gb" id="g-familia">${cab}${topo}${cinco}${resto}<p class="det" style="margin:4px 0 0">${esc(comp)}</p>${semCat()}${metaHtml()}`
                + `<button class="lnk ver" data-ver="${k}" aria-expanded="false" style="margin-top:6px">Ver 13 meses e os SKUs</button></div>`;
        }
        // Aberto
        const f = fams.find(x => x.familia === famSel), lucroModo = famModo === 'lucro';
        const modo = `<span class="seg" role="group" aria-label="Mostrar"><button data-fam-modo="bruto" aria-pressed="${!lucroModo}">Faturamento</button><button data-fam-modo="lucro" aria-pressed="${lucroModo}">Lucro</button></span>`;
        const valorFam = x => (!lucroModo ? SHC.moeda(x.bruto) : x.lucro === null ? 'sem custo' : SHC.moeda(x.lucro) + (x.lucroParcial ? '*' : ''));
        const lista = fams.map(x => `<button class="fam-l" data-fam-sel="${esc(x.familia)}" aria-pressed="${x.familia === famSel}">${famSw(x.cor)}<span class="nm">${esc(x.familia)}</span>`
            + (x.bruto > 0 ? `<span class="vl">${valorFam(x)}</span><span class="pc">${P.pctFam(x.pct)}</span>` : `<span class="pc">sem vendas em ${esc(nome)}</span>`) + `${famSetaHtml(x)}</button>`).join('');
        const nota = lucroModo ? `<p class="det" style="margin:4px 0 0">Lucro estimado = faturamento − tarifa − frete − custo − imposto.${fams.some(x => x.lucroParcial) ? ' * Só dos SKUs com custo; informe os que faltam no Catálogo.' : ''}</p>` : '';
        const pico = f.picoMes ? `<p class="det" style="margin:6px 0 0;color:#344054"><b>${esc(f.familia)}:</b> o mês mais forte do último ano foi ${esc(P.mesLongoAno(f.picoMes))} (${SHC.moeda((f.serie12.find(p => p.mes === f.picoMes) || {}).bruto)}).`
            + (typeof f.variacaoAnoPct === 'number' ? ` Contra ${esc(nome)} do ano passado: <span class="fseta ${f.variacaoAnoPct >= 0 ? 'up' : 'down'}">${f.variacaoAnoPct >= 0 ? '▲' : '▼'} ${P.pctFam(f.variacaoAnoPct)}</span>.` : '') + '</p>'
            : `<p class="det" style="margin:6px 0 0">${esc(f.picoMotivo || 'Ainda não tenho meses suficientes de ' + f.familia + ' para mostrar o mês mais forte.')}</p>`;
        const outras = f.membros && f.membros.length ? `<p class="det" style="margin:4px 0 0">Outras = ${esc(f.membros.join(', '))}.</p>` : '';
        const subs = f.subs && f.subs.filter(x => x.sub).length ? `<p class="det" style="margin:4px 0 0">Dentro de ${esc(f.familia)}: ${esc(f.subs.filter(x => x.sub).slice(0, 3).map(x => x.sub + ' ' + SHC.moeda(x.bruto)).join(' · '))}.</p>` : '';
        // Prepare o Full: a família costuma subir no mês que vem (ano passado) e tem SKU no Full.
        let prep = '';
        if (famMes === 'atual' && full && full.temFull) {
            const sz = fams.filter(x => x.familia !== SHC.FAMILIA_OUTRAS && x.familia !== SHC.FAMILIA_SEM).map(x => ({ x, r: SHC.sazonalFull(x, x.serie12, full, { hoje: SHC.hoje() }) })).filter(o => o.r.aplica);
            prep = sz.map(o => `<div class="recnota aviso"><b>Prepare o Full · ${esc(o.x.familia)}:</b> ${esc(o.r.texto)} <button class="lnk" data-ir-aba="full">Abrir a aba Full ›</button></div>`).join('');
        }
        // Curva ABC da conta (recolhida)
        const abc = P.abcConta(fams), kA = 'geral:famabc', abA = aberto(kA), oQue = abc.criterio === 'lucro' ? 'do lucro' : 'do faturamento';
        const abcHtml = abc.nA ? `<div class="fam-abc"><p style="margin:0;font-size:12px"><b>Curva ABC:</b> ${esc(SHC.qtd(abc.nA, 'SKU faz', 'SKUs fazem'))} 80% ${oQue} de ${esc(nome)}`
            + `${abc.criterio === 'lucro' && abc.de < abc.lista.length ? ' (entre os ' + abc.de + ' com custo)' : ''}. ${btVer(kA, 'Ver quais', 'Esconder')}</p>`
            + (abc.criterio === 'bruto' ? '<p class="det" style="margin:2px 0 0">Informe os custos no Catálogo para ver pelo lucro.</p>' : '')
            + (abA ? abc.lista.filter(s => s.abc === 'A').map(s => `<div class="it"><span class="abc A">A</span>${esc(curtoTxt(s.titulo || s.sku || s.itemIds[0], 60))}<small>${s.sku ? 'SKU ' + esc(s.sku) + ' · ' : ''}${SHC.moeda(s[abc.criterio])} · acumulado ${P.pctFam(s.acumPct)}</small></div>`).join('') : '')
            + '<p class="det" style="margin:2px 0 0">A = os que fazem 80%; B = até 95%; C = o resto.</p></div>' : '';
        const skus = f.skus.slice(0, famLim), resto = f.skus.length - skus.length;
        const skuHtml = `<p style="margin:10px 0 2px;font-size:12.5px"><b>SKUs de ${esc(f.familia)}</b> <span class="det">· ${f.skus.some(s => s['variacaoR$'] !== null) ? 'maior queda em R$ primeiro' : 'maior faturamento primeiro'}</span></p>`
            + (skus.map(s => linhaSkuFam(s, abc.porChave[P.chaveSkuFam(s)], ant)).join('') || '<p class="det">Nenhum SKU com venda.</p>')
            + (resto > 0 ? `<button class="mais" data-fam-mais>Mostrar mais ${Math.min(resto, 10)} de ${resto}</button>` : '');
        return `<div class="card gb" id="g-familia">${cab}${topo}<div class="acoes" style="justify-content:flex-start;margin:0 0 4px">${modo}</div>${lista}${nota}<p class="det" style="margin:4px 0 0">${esc(comp)}</p>${semCat()}${metaHtml()}`
            + `<div class="fam-duas"><div>${P.svgFamilias(fams, famSel)}${pico}${outras}${subs}${prep}${abcHtml}</div><div>${skuHtml}</div></div>`
            + `<button class="lnk ver" data-ver="${k}" aria-expanded="true" style="margin-top:6px">Esconder os detalhes</button></div>`;
    }
    // v2.9 (pedido da dona): reputação e perguntas saem da Geral e vão para a aba Saúde. Reputação por cores: o termômetro do ML (5 faixas,
    // marcando a da conta) e cada variável como barra contra o limite. Só o que o ML dá: nada de prazo nem número inventado.
    const pctR = v => String(Math.round(v * 100) / 100).replace('.', ',') + '%';
    function cardReputacao() {
        const r = P.reputacaoLinha(reputacao);
        if (!r) return '<div class="card" id="rep-saude"><div class="ch"><h3>Sua reputação</h3></div><p class="det">Lida na próxima sincronização. Aqui aparece a cor da sua conta no Mercado Livre e cada item contra o limite.</p></div>';
        const F = P.REP_FAIXAS, sel = r.faixa === null ? '' : `<span class="selo ${r.faixa >= 3 ? 'ok' : r.faixa === 2 ? 'at' : 'pr'}">${esc(F[r.faixa][0])}</span>`;
        const termo = `<div class="termo" role="img" aria-label="${esc(r.faixa === null ? 'Termômetro do Mercado Livre: a conta ainda não tem cor' : 'Termômetro do Mercado Livre: você está na faixa ' + F[r.faixa][0].toLowerCase())}">`
            + F.map(([, c], i) => `<i${i === r.faixa ? ' class="on"' : ''} style="background:${c}"></i>`).join('') + '</div><div class="termo-l"><span>vermelho</span><span>verde</span></div>';
        const per = r.periodo && r.periodo.vendas !== null ? P.milhar(r.periodo.vendas) + ' vendas' + (r.periodo.dias ? ' dos últimos ' + r.periodo.dias + ' dias' : '') + ' · ' : '';
        const vr = b => `<div class="vr"><div class="l"><b>${esc(b.rotulo)}</b><span class="v">${pctR(b.pct)}${b.limitePct !== null ? ` <small>de ${pctR(b.limitePct)}</small>` : ''}</span></div>`
            + (b.usoPct !== null ? `<div class="medidor"><i class="${b.cls}" style="width:${Math.max(2, Math.min(100, b.usoPct))}%"></i></div>` : '')
            + `<div class="q"><span>${b.qtd !== null && b.vendas !== null ? esc(b.qtd + ' de ' + P.milhar(b.vendas) + ' vendas') : ''}</span><span class="${b.cls}">${b.usoPct !== null ? b.usoPct + '% do limite' : ''}</span></div>`
            + (b.cls === 'at' || b.cls === 'pr' ? `<p class="rs ${b.cls}">${b.falta ? esc('Mais ' + SHC.qtd(b.falta, 'caso', 'casos') + ' e chega ao limite.') : b.falta === 0 ? 'Chegou ao limite do Mercado Livre.' : 'O Mercado Livre marcou este item.'}`
                + `${linkML(b.link) ? ` <a class="lnk" href="${esc(b.link)}" target="_blank" rel="noopener">Ver os casos no ML</a>` : ''}</p>` : '') + '</div>';
        const top = r.topItens.filter(t => t && t.itemId).map(t => `<li>${esc(curtoTxt(tituloDe(t.itemId), 44))}<small>${t.problemas !== null ? esc(SHC.qtd(t.problemas, 'problema', 'problemas')) : ''}</small></li>`).join('');
        return `<div class="card" id="rep-saude"><div class="ch"><h3>Sua reputação</h3>${sel}${r.lider ? `<span class="lider">★ ${esc(r.lider)}</span>` : ''}</div>${termo}`
            + `<p class="rs" style="margin:8px 0 4px">${esc(per)}cada item contra o limite do Mercado Livre</p>${r.barras.map(vr).join('')}`
            + '<p class="rs">Cor: verde até 69% do limite · âmbar de 70% a 99% · vermelho no limite ou acima.</p>'
            + (r.proximo ? `<p class="rs"><b>${esc(r.proximo)}.</b></p>` : '')
            + (top ? `<p class="rs" style="margin-top:8px"><b>Anúncios com mais problemas</b>${linkML(r.linkTop) ? ` <a class="lnk" href="${esc(r.linkTop)}" target="_blank" rel="noopener">Ver no ML</a>` : ''}</p><ul class="rep-top">${top}</ul>` : '')
            + `<div class="linha-bts"><a class="bt pq ml" href="${esc(P.URL_REPUTACAO)}" target="_blank" rel="noopener">Ver a reputação no ML</a></div></div>`;
    }
    function cardPerguntas() {
        const q = P.perguntasLinha(perguntas, resumoML);
        if (!q) return '<div class="card" id="perg-saude"><div class="ch"><h3>Perguntas</h3></div><p class="det">Lidas na próxima sincronização. Aqui aparecem quantas perguntas estão sem resposta e o seu tempo médio. O Copiloto não lê o texto das perguntas nem quem perguntou.</p></div>';
        const n = q.pendentes, tm = ((perguntas && perguntas.tempoMedio) || {}).comercial;
        const selo = n === null ? '' : n ? `<span class="selo ${q.cor === 'ruim' ? 'pr' : 'at'} d">${esc(SHC.qtd(n, 'sem resposta', 'sem resposta'))}</span>` : '<span class="selo ok d">em dia</span>';
        return `<div class="card" id="perg-saude"><div class="ch"><h3>Perguntas</h3>${selo}</div>`
            + (typeof tm === 'number' ? `<p class="rs" style="margin:0 0 8px">Tempo médio de resposta: <b${q.lento ? ' class="vm"' : ''}>${esc(SHC.minutosTxt(tm))}</b> (bom: até 1 hora)</p>`
                : `<p class="rs" style="margin:0 0 8px">${n ? 'Responder em até 1 hora ajuda a vender.' : n === 0 ? '✓ Nenhuma pergunta esperando.' : 'O Mercado Livre não mostrou quantas perguntas estão sem resposta.'}</p>`)
            + (linkML(q.link) ? `<a class="bt pq ml" href="${esc(q.link)}" target="_blank" rel="noopener">Responder no ML</a>` : '') + '</div>';
    }
    function cardSemanal() {
        const k = 'geral:semanal', novo = !!(semanal && semanal.novo), s = semanal;
        let h = `<div class="card gb" id="g-semanal"><div class="gb-l"><i class="dot ${novo ? 'atencao' : (s ? 'ok' : '')}"></i><b>Resumo da semana</b><span class="gb-v">${novo ? '<b style="color:var(--ambar)">novo resumo disponível</b>' : (s && s.semana ? esc(P.dataBr(s.semana.de) + ' a ' + P.dataBr(s.semana.ate)) : 'texto pronto para o WhatsApp')}</span>${btVer(k, 'Ver resumo', 'Esconder')}</div>`;
        if (aberto(k)) {
            h += '<div class="gb-c">' + (!s ? `<p class="det">${esc(semanalMsg || 'Montando o resumo com o que já foi lido…')}</p>`
                : `<textarea id="txtSemanal" readonly aria-label="Resumo da semana">${esc(s.texto)}</textarea>
                  <div class="acoes" style="justify-content:flex-start;flex-wrap:wrap"><button class="bt verde" data-semanal-zap${P.waLinkOk(s.waLink) ? '' : ' disabled'}>Enviar pelo WhatsApp</button><button class="bt leve" data-semanal-copiar>Copiar</button><button class="lnk" data-semanal-novo>Gerar de novo</button></div>
                  <p class="det">O WhatsApp abre para você escolher para quem mandar; o Copiloto não envia nada sozinho. Toda segunda de manhã um resumo novo fica pronto aqui.${semanalMsg ? ' ' + esc(semanalMsg) : ''}</p>`) + '</div>';
        }
        return h + '</div>';
    }
    // Pede o resumo ao fundo ({acao:'resumo_semanal'}; agora = gera de novo com o que está guardado, nenhum GET) e tira o "novo" do ícone.
    async function pedirSemanal(agora) {
        if (semanalPedido) return;
        semanalPedido = true;
        let r = null;
        try { r = await chrome.runtime.sendMessage({ acao: 'resumo_semanal', agora: !!agora }); } catch (e) { r = null; }
        semanalPedido = false;
        if (r && r.ok && r.resumo) {
            semanal = r.resumo; semanalMsg = '';
            if (semanal.novo) { semanal = Object.assign({}, semanal, { novo: false }); try { Promise.resolve(chrome.runtime.sendMessage({ acao: 'resumo_semanal_visto' })).catch(() => {}); } catch (e) { /* fundo reiniciando */ } }
        } else semanalMsg = r && r.motivo === 'sem_conta' ? 'Clique em Sincronizar agora: o Copiloto ainda não sabe qual é a sua conta.' : 'Não consegui montar o resumo agora. Tente de novo.';
        if (aba === 'geral') desenhaGeral();
    }
    function desenhaGeral() {
        $('#geralFam').innerHTML = cardFamilia();
        $('#geralContas').innerHTML = cardContasJuntas();
        $('#geralSemanal').innerHTML = cardSemanal();
        const at = P.anomTopo(anom, conta), ci = P.certInfo(cert, Date.now());
        $('#geralTopo').innerHTML = `<div class="card topo-geral">${at ? (at.total ? `<b class="${at.vermelho ? 'vm' : ''}">${esc(SHC.qtd(at.total, 'coisa pede sua atenção', 'coisas pedem sua atenção'))}</b>${at.partes ? `<p class="det" style="margin:2px 0 0">${esc(at.partes)}</p>` : ''}`
                : '<b style="color:var(--verde)">✓ Nada pede sua atenção agora</b>')
            : (SHC.statusSync(status, Date.now()).estado === 'sincronizando' ? '<b>Os alertas aparecem quando esta leitura terminar</b><p' : '<b>Os alertas aparecem depois da próxima sincronização</b><p')
            + ' class="det" style="margin:2px 0 0">O Copiloto junta aqui tudo o que precisa de você: Full, estoque, frete, cobranças, pós-venda, Ads e dados fiscais.</p>'}</div>`
            + (ci && ci.vermelho ? certHtml(ci) : '');
        const b = [];   // v2.9: perguntas e reputação foram para a aba Saúde (entram na linha da Saúde)
        // Promoções
        if (!snap) b.push(blocoGeral('promo', 'Promoções', 'neutra', 'ainda não lidas', '<p class="det">Clique em Sincronizar agora no alto do painel.</p>', 'promo'));
        else if (!snap.familias.length) b.push(blocoGeral('promo', 'Promoções', 'ok', 'nenhuma promoção aberta agora', '', 'promo'));
        else {
            const t = snap.familias.map(f => resumoFamilia(f)), n = c => t.filter(r => r.classe === c).length;
            const ruins = t.filter(r => r.classe === 'prejuizo').concat(t.filter(r => r.classe === 'apertado'), t.filter(r => r.classe === 'sem_custo'));
            b.push(blocoGeral('promo', 'Promoções', n('prejuizo') ? 'ruim' : (n('sem_custo') || n('apertado') ? 'atencao' : 'ok'),
                esc(`${t.length} com proposta · ${n('lucrativo')} dão lucro · ${n('prejuizo')} prejuízo` + ((cfg.robopromo || {}).ligado ? ` · robô sugere ${sugestoesRobo().length}` : '')),
                it3(ruins.map(r => `${esc(curtoTxt(r.f.titulo, 60))}<small>${esc(ROTULO[r.classe])}</small>`)) || '<p class="det">Todas as propostas com custo dão lucro na sua meta.</p>', 'promo'));
        }
        // Frete
        const fc = P.freteConta(freteHist);
        if (!fc && P.temFreteCob(freteHist)) b.push(blocoGeral('frete', 'Frete', 'neutra', esc(`Últimos 30 dias: ${SHC.moeda(freteHist.conta.ult30.total)} · ${SHC.qtd(freteHist.conta.ult30.pedidos, 'pedido', 'pedidos')}`),
            '<p class="det">A conciliação aparece quando as vendas forem lidas (próxima sincronização).</p>', 'frete'));
        else if (!fc) b.push(blocoGeral('frete', 'Frete', 'neutra', 'aparece quando o Faturamento for lido', `<p class="det">${esc(P.freteSemDado(freteHist, status, Date.now()))}</p>`, 'frete'));
        else {
            const c = fc.conc, u = freteHist.conta && freteHist.conta.ult30;
            b.push(blocoGeral('frete', 'Frete', fc.cor, esc(fc.resumo),
                (P.temFreteCob(freteHist) ? `<p class="det">Últimos 30 dias: ${SHC.moeda(u.total)} em frete · ${esc(SHC.qtd(u.pedidos, 'pedido', 'pedidos'))}.${P.freteSemLeitura(freteHist) ? ' ' + esc(P.freteSemLeitura(freteHist)) + '.' : ''}</p>` : '') + it3((c.pagoAMais || []).map(p => `Pedido ${esc(p.pedido)} · ${esc(curtoTxt(tituloDe(p.itemId), 40))}<small>cobrado ${SHC.moeda(p.cobrado)} × ${SHC.moeda(p.esperado)} do anúncio: ${SHC.moeda(p.diferenca)} a mais</small>`))
                + (c.semCobrancaAinda ? `<p class="det">${esc(SHC.qtd(c.semCobrancaAinda, 'pedido', 'pedidos'))}: o ML ainda não lançou o frete desses pedidos.</p>` : '')
                + (c.semFreteNoAnuncio ? `<p class="det">${esc(SHC.qtd(c.semFreteNoAnuncio, 'pedido', 'pedidos'))}: anúncio sem dado de frete.</p>` : '')
                + (u && u.medio !== null && u.medio !== undefined ? `<p class="det">Frete médio por pedido nos últimos 30 dias: ${SHC.moeda(u.medio)}${freteHist.conta.variacaoPct !== null && freteHist.conta.variacaoPct !== undefined ? ' (' + esc(P.varPct(freteHist.conta.variacaoPct)) + ' contra os 30 anteriores)' : ''}.</p>` : ''), 'frete',
                somaRs(c.pagoAMais || [], p => p.diferenca)));
        }
        // Catálogo
        if (!grupos.length) b.push(blocoGeral('catalogo', 'Catálogo', 'neutra', 'lista de anúncios ainda não lida', '', 'catalogo'));
        else {
            const cu = SHC.guiaCustos(anuncios && anuncios.itens, Object.assign({}, custosMl, cadSku), vm), pre = resumos.filter(r => r.r.classe === 'prejuizo');
            b.push(blocoGeral('catalogo', 'Catálogo', pre.length ? 'ruim' : (cu.comTodos < cu.deTodos ? 'atencao' : 'ok'),
                esc(`custo em ${cu.comTodos} de ${cu.deTodos} SKUs · ${pre.length} com prejuízo`),
                it3(pre.map(r => `${esc(curtoTxt(r.g.titulo, 60))}<small>${esc(r.g.sku || r.g.itens[0].itemId)} · prejuízo de ${SHC.moeda(-r.r.pior.s.sobra)} por venda</small>`)) || '<p class="det">Nenhum SKU com custo dá prejuízo no preço de hoje.</p>', 'catalogo'));
        }
        // Ads
        if (!adsSnap) b.push(blocoGeral('ads', 'Ads', 'neutra', 'aparece depois da leitura do Mercado Ads', '', 'ads'));
        else if (adsSnap.temAds === false) b.push(blocoGeral('ads', 'Ads', 'neutra', 'esta conta não usa o Mercado Ads', '', 'ads'));
        else {
            const m = P.adsConta(adsSnap), ac = P.adsEquilibrio(adsSnap, itens, sobraDe).filter(x => x.acima);
            b.push(blocoGeral('ads', 'Ads', ac.length ? 'ruim' : 'ok', esc(`investimento ${SHC.moeda(m.gasto)} · ACOS ${pctOu(m.acos)} · ${ac.length} acima do equilíbrio`),
                it3(ac.map(x => `${esc(curtoTxt(x.a.titulo || (x.it && x.it.titulo) || x.a.itemId, 60))}<small>Ads ${SHC.moeda(x.a.gasto)}${x.acos !== null ? ' · ACOS ' + SHC.pctTxt(x.acos) : ''}${x.margem !== null ? ' · equilíbrio ' + SHC.pctTxt(x.margem) : ''}</small>`)) || '<p class="det">Nenhum anúncio com Ads acima do equilíbrio.</p>', 'ads', somaRs(ac, x => x.a.gasto)));
        }
        // Full
        if (!full) b.push(blocoGeral('full', 'Full', 'neutra', status.erroFull ? 'não consegui ler agora' : 'ainda não lido', '', 'full'));
        else if (!full.temFull) b.push(blocoGeral('full', 'Full', 'neutra', txtML(full.vazio) ? 'esta conta ainda não usa o Full' : 'não reconheci a tela do Full', '', 'full'));
        else {
            const pl = planoAtual(), nc = P.contaClasses(pl.linhas), al = pl.linhas.filter(l => l.saude && l.saude.alerta), inc = incRemessas().filter(SHC.remessaPendente).length;
            b.push(blocoGeral('full', 'Full', inc || nc.critico || nc.sem_estoque ? 'ruim' : (nc.atencao ? 'atencao' : 'ok'),
                esc(`${inc ? SHC.qtd(inc, 'remessa com diferença', 'remessas com diferença') + ' · ' : ''}${nc.critico} crítico · ${nc.sem_estoque} sem estoque · ${nc.atencao} atenção`),
                it3(al.map(l => `${esc(curtoTxt(l.p.titulo || l.p.sku, 60))}<small>${esc(P.acaoFull(l))}</small>`)) || '<p class="det">Nenhum produto acabando no Full.</p>', 'full'));
        }
        // Saúde (v2.9: com a reputação e as perguntas, que saíram da Geral)
        {
            const f = P.saudeFiscal(fiscal, itens), rl = P.radarLista(visitas, itens.filter(SHC.anuncioAtivo), cfg, SHC.hoje()), rm = resumoMed(), rf = P.resumoFotos(fotos, itens);
            const r = P.reputacaoLinha(reputacao), q = P.perguntasLinha(perguntas, resumoML), div = rm.div.filter(P.medPesa).length, ls = [];
            const rb = r ? r.barras.filter(x => x.cls === 'at' || x.cls === 'pr').sort((x, y) => (y.usoPct || 0) - (x.usoPct || 0))[0] : null;
            const repTxt = !r ? 'reputação ainda não lida' : (r.faixaNome ? 'reputação ' + r.faixaNome.toLowerCase() : r.nivel) + (rb && rb.usoPct !== null ? ' · ' + rb.rotulo.toLowerCase() + ' em ' + rb.usoPct + '% do limite' : '');
            ls.push(!r ? 'Reputação: aparece depois da próxima sincronização' : 'Reputação: ' + r.texto);
            if (q) ls.push('Perguntas: ' + q.texto);
            ls.push(f.n === null ? 'Dados fiscais: ainda não lidos' : (f.n ? SHC.qtd(f.n, 'anúncio sem dados fiscais', 'anúncios sem dados fiscais') : '✓ Todos com dados fiscais'));
            if (rl.lidos) ls.push(SHC.qtd(rl.caindo.length, 'anúncio perdendo visitas', 'anúncios perdendo visitas'));
            if (rm.lidos) ls.push(SHC.qtd(div, 'SKU com medidas diferentes', 'SKUs com medidas diferentes'));
            if (rf.lidos) ls.push(SHC.qtd(rf.faixas.f1.length, 'anúncio com 1 foto só', 'anúncios com 1 foto só'));
            const ruim = f.n > 0 || (r && r.cor === 'ruim') || (q && q.cor === 'ruim'), atencao = rl.caindo.length || div || rm.mud.length || (r && r.cor === 'atencao') || (q && q.cor === 'atencao');
            b.push(blocoGeral('saude', 'Saúde', ruim ? 'ruim' : (atencao ? 'atencao' : (f.n === null && !r ? 'neutra' : 'ok')),
                esc(repTxt + (q && q.pendentes ? ' · ' + SHC.qtd(q.pendentes, 'pergunta sem resposta', 'perguntas sem resposta') : '')
                    + ' · ' + (f.n === null ? 'dados fiscais ainda não lidos' : (f.n ? SHC.qtd(f.n, 'sem dados fiscais', 'sem dados fiscais') : 'dados fiscais em dia'))),
                it3(ls.map(esc)), 'saude'));
        }
        // Conciliação
        {
            const x = concMes(), cf = conferir;
            const liq = x.casc.liquido, res = (liq === null ? 'líquido de ' + x.nome + ' ainda não lido por inteiro' : 'líquido de ' + x.nome + ' ' + SHC.moeda(liq))
                + (cf ? ' · ' + (cf.qtd ? SHC.qtd(cf.qtd, 'cobrança a conferir', 'cobranças a conferir') : 'nenhuma cobrança a conferir') : '');
            b.push(blocoGeral('conciliacao', 'Conciliação', (cf && cf.qtd) || (ci && ci.vermelho) ? 'ruim' : (liq === null ? 'neutra' : 'ok'), esc(res),
                it3(((cf && cf.itens) || []).map(i => `Pedido ${esc(i.pedido)} · ${esc(curtoTxt(i.cobranca, 40))}<small>${SHC.moeda(i.diferenca)} a mais · ${esc(curtoTxt(i.motivo, 90))}</small>`))
                + (cf && cf.qtd ? `<p class="det">Pagamento excedente: ${SHC.moeda(cf.valor || 0)} para conferir.</p>` : ''), 'conciliacao', cf && cf.qtd ? cf.valor : 0));
        }
        // Canal
        {
            const px = P.proximasCanal(canalPlano && canalPlano.plano, Date.now());
            b.push(blocoGeral('canal', 'Canal', px.length ? 'ok' : 'neutra', px.length ? esc('próxima: ' + P.quandoCanal(px[0].dia, px[0].hora)) : 'nenhuma transmissão na agenda',
                it3(px.map(s => `${esc(P.quandoCanal(s.dia, s.hora))}<small>${esc(curtoTxt(s.titulo || tituloDe(s.itemId), 60))} · ${s.feito ? 'criada no ML' : 'falta criar no ML'}</small>`)) || '<p class="det">Abra a agenda para programar os produtos em promoção que dão lucro.</p>', 'canal'));
        }
        // Afiliados
        {
            const x = P.afilCartao(afil, itens, sobraDe), come = x.comeLucro ? x.comeLucro.length : 0;
            b.push(blocoGeral('afiliados', 'Afiliados', come ? 'atencao' : 'neutra', x.estado === 'sem_dado' ? 'sincronize para ver' : x.estado === 'nao_usa' ? 'esta conta não usa afiliados'
                : esc(`vendas em 30 dias ${x.vendas === null ? '—' : SHC.moeda(x.vendas)} · ROI ${xTxt(x.roi)}` + (come ? ` · comissão come o lucro em ${SHC.qtd(come, 'produto', 'produtos')}` : '')),
                x.estado === 'ok' ? it3(x.top.map(p => `${esc(curtoTxt(p.titulo || p.itemId, 60))}<small>${SHC.moeda(p.vendas || 0)}</small>`)) : '', 'afiliados'));
        }
        // Pós-venda (v2.9: 1 linha; o detalhe fica na aba Pós-venda)
        {
            const pv = P.posVenda(posvenda), a = P.posAnalise(posvenda, itens);
            b.push(!pv ? blocoGeral('posvenda', 'Pós-venda', 'neutra', status.erroPosVenda ? 'não consegui ler agora' : 'aparece depois da próxima sincronização', '', 'posvenda')
                : blocoGeral('posvenda', 'Pós-venda', pv.cor, esc(pv.resumo), a && a.total ? it3(a.motivos.map(m => `${esc(curtoTxt(m.motivo, 60))}<small>${esc(SHC.qtd(m.casos, 'reclamação', 'reclamações'))}${m.valor > 0 ? ' · ' + SHC.moeda(m.valor) : ''}</small>`)) : '', 'posvenda', a && a.total ? somaRs(a.motivos, m => m.valor) : 0));
        }
        // Conforme a demanda (pedido da dona): o que pede ação primeiro, depois atenção, em dia e por último o que ainda não foi lido.
        $('#listaGeral').innerHTML = P.ordemGeral(b).map(x => x.html).join('');
    }
    // Certificado digital (cert:<conta>): alerta na Geral e na Conciliação, com o Faturador.
    const certHtml = ci => `<div class="recnota ${ci.vermelho ? 'ruim' : 'neutra'}" style="margin:0 0 8px"><b>Certificado digital:</b> ${esc(ci.texto)}`
        + `<div class="acoes" style="justify-content:flex-start;margin-top:6px"><a class="bt leve" href="${esc(SHC.FATURADOR_URL)}" target="_blank" rel="noopener">Abrir o Faturador</a></div>`
        + (ci.velho ? `<small class="det" style="display:block">Lido há mais de 7 dias. <a class="lnk" href="${esc(SHC.FATURADOR_URL)}" target="_blank" rel="noopener">Confira a validade no Faturador</a></small>` : '') + '</div>';

    // ── Aba Conciliação: o Fechamento do mês passado resumido (as contas são as do fechamento completo, SHC.fech) ──
    function concMes() {
        const F = SHC.fech, hoje = SHC.hoje(), mes = P.mesMenos(hoje.slice(0, 7), 1);
        if (!F) return { mes, nome: P.nomeMes(mes), casc: { linhas: [], liquido: null }, vb: null };
        const v = F.vendasBrutas(fechAnt, vb, mes, hoje);
        return { mes, nome: F.nomeMes(mes), vb: v, casc: F.cascata({ fech: fechAnt, vb: v, produtos: null, impostoPct: null, mes }) };
    }
    const linkML = u => /^https:\/\/([a-z]+\.)*mercadolivre\.com\.br\//.test(String(u || ''));
    const NF_VENDAS = [
        ['https://vendedores.mercadolivre.com.br/billing/invoiceissuer/fiscal-hub', 'Emissor de NF-e (Faturador)', 'Emita e consulte as notas das suas vendas.'],
        ['https://vendedores.mercadolivre.com.br/documents/overview/reports', 'Relatórios de notas fiscais de vendas', 'Baixe as notas das vendas por período, inclusive as do Full.'],
        ['https://myaccount.mercadolivre.com.br/invoices/documents/type', 'Outros documentos fiscais', 'Notas de devolução, de remessa ao Full e outras.'],
        ['https://myaccount.mercadolivre.com.br/invoices/documents/cte', 'CT-e emitidos', 'Conhecimentos de transporte dos seus envios.'],
        ['https://myaccount.mercadolivre.com.br/invoices/documents/gnre', 'GNRE emitidas', 'Guias de ICMS das vendas para outros estados.'],
        ['https://myaccount.mercadolivre.com.br/invoices/documents/gnre/unprocessed', 'GNRE pendentes', 'Guias que ainda precisam de você.'],
    ];
    let concCopiado = -1;
    // v2.8: NF-e das vendas por mês (o atual e o anterior): totais, as notas recolhidas (20 mais recentes; "Ver todas") e a página do ML no mês,
    // onde ficam os botões de baixar (Excel, PDF, XML). Nada do comprador: só data, venda, número, status, valor e chave.
    const NFE_VISTAS = 20;
    const linhaNfe = n => `<div class="linha-sem"><span><b>${esc(P.dataBr(n.emitidaEm.slice(0, 10)) + (n.emitidaEm.length > 15 ? ' ' + n.emitidaEm.slice(11, 16) : ''))} · Venda ${esc(n.venda)}</b>`
        + `<small>NF ${esc(n.numero)}${n.serie ? ' série ' + esc(n.serie) : ''} · ${SHC.nfeComProblema(n.status) ? '<b class="vm" style="display:inline">' + esc(n.status) + '</b>' : esc(n.status)} · ${SHC.moeda(n.valorTotal)}${n.logistica ? ' · ' + esc(n.logistica) : ''}${n.cartaCorrecao ? ' · com carta de correção' : ''}</small>`
        + (n.chave ? `<small style="display:block;word-break:break-all">Chave ${esc(n.chave)}</small>` : '') + '</span>'
        + (n.chave ? `<button class="bt leve" data-nfe-copiar="${esc(n.chave)}">${nfeCopiada === n.chave ? '✓ Copiada' : 'Copiar chave'}</button>` : '') + '</div>';
    function nfeHtml() {
        const atual = SHC.hoje().slice(0, 7), meses = [atual, P.mesMenos(atual, 1)];
        const bloco = (x, m) => {
            const r = P.nfeResumo(x), ns = (x && x.notas) || [], k = 'conc:nfe:' + m, kt = k + ':todas';
            return `<div class="linha-comp"><b>${esc(P.nomeMes(m))}</b><small>${esc(r ? r.texto : 'Aparece depois da próxima sincronização.')}</small>`
                + (r && r.ruins ? `<small class="vm">${esc(SHC.qtd(r.ruins, 'nota rejeitada ou com erro', 'notas rejeitadas ou com erro'))}: confira no ML e emita de novo pelo Faturador.</small>` : '')
                + (r && r.aviso ? `<small>${esc(r.aviso)}</small>` : '')
                + (x && x.soTotais ? '<small>Mais de 2.000 notas no mês: aqui ficam só os totais. A lista completa está no Mercado Livre.</small>' : '')
                + `<div class="acoes" style="justify-content:flex-start;margin-top:4px"><a class="bt leve" href="${esc(SHC.nfeLink(m))}" target="_blank" rel="noopener">Abrir no ML (baixar Excel, PDF ou XML)</a>`
                + (ns.length ? btVer(k, 'Ver as notas', 'Esconder as notas') : '') + '</div>'
                + (aberto(k) ? ns.slice(0, aberto(kt) ? ns.length : NFE_VISTAS).map(linhaNfe).join('')
                    + (ns.length > NFE_VISTAS ? btVer(kt, 'Ver todas as ' + P.milhar(ns.length), 'Ver só as ' + NFE_VISTAS + ' mais recentes') : '') : '')
                + '</div>';
        };
        return meses.map((m, i) => bloco(nfeV[i], m)).join('')
            + '<p class="det">As notas que o Faturador ou o Full emitiram nas suas vendas. O download (Excel, PDF ou XML) é feito na página do Mercado Livre.</p>';
    }
    async function copiarNfe(chave) {
        try { await navigator.clipboard.writeText(chave); nfeCopiada = chave; }
        catch (e) { nfeCopiada = ''; avisa('Não consegui copiar sozinho. Selecione a chave e copie.', 8000); }
        desenhaConc();
    }
    function desenhaConc() {
        const F = SHC.fech, x = concMes(), ci = P.certInfo(cert, Date.now()), h = [];
        if (ci && ci.vermelho) h.push(certHtml(ci));
        // Fechamento resumido
        const linhas = P.concResumo(x.casc), liq = x.casc.liquido;
        const vbTxt = !x.vb ? `As vendas brutas de ${x.nome} ainda não foram lidas.` : (!x.vb.completo ? `As vendas brutas de ${x.nome} foram lidas só em parte${typeof x.vb.dias === 'number' ? ' (' + x.vb.dias + ' de ' + x.vb.diasMes + ' dias)' : ''}.` : '');
        const rp = F ? F.comparaRepasse(rep, x.mes, liq) : null;
        h.push(dobra(`<div class="card" id="concFech"><b style="font-size:13px">Fechamento de ${esc(x.nome)}</b>
          <table class="tabf"><tbody>${linhas.map(l => `<tr${l.id === 'liquido' ? ' style="font-weight:800"' : ''}><td>${esc(l.rotulo)}</td><td>${l.valor === null ? '—' : (l.tipo === 'menos' ? '− ' : (l.tipo === 'mais' ? '+ ' : (l.tipo === 'info' ? '(' : ''))) + SHC.moeda(l.valor) + (l.tipo === 'info' ? ')' : '')}</td></tr>`).join('')}</tbody></table>
          ${vbTxt ? `<p class="det">${esc(vbTxt)} Sem o mês inteiro, o líquido fica “—”.</p>` : ''}${!fechAnt ? `<p class="det">As cobranças de ${esc(x.nome)} ainda não foram lidas do Faturamento.</p>` : ''}
          <p class="det"><b>Mercado Pago:</b> ${esc(rp ? rp.frase : (rep ? 'o Mercado Pago de ' + x.nome + ' ainda não foi lido.' : 'conecte o Mercado Pago no fechamento completo para comparar o que entrou com o líquido.'))}</p>
          <p class="det">“—” = ainda não lido (não é zero). Estornos entre parênteses já estão descontados nas linhas de cima. Líquido = estimativa.</p></div>`,
          'conc:fech', liq === null ? 'líquido ainda não lido por inteiro' : 'líquido ' + SHC.moeda(liq)));
        // Pagamento excedente (cobranças para conferir: a mesma regra do fechamento completo, gravada pelo fundo)
        const cf = conferir, its = (cf && cf.itens) || [];
        h.push(dobra(`<div class="card" id="concConferir"><b style="font-size:13px">Cobranças para conferir</b>
          <p class="det">Cobranças acima do esperado, estornos que não vieram e faturas que não batem. O Copiloto só aponta: o chamado é você que abre, com o texto pronto.</p>
          ${its.slice(0, 3).map((i, n) => `<div class="linha-comp"><b>Pedido ${esc(i.pedido)} · ${esc(curtoTxt(i.cobranca, 50))}</b><small>Cobrado ${SHC.moeda(i.valor)} × esperado ${SHC.moeda(i.esperado)}: <b class="vm">${SHC.moeda(i.diferenca)} a mais</b></small><small>${esc(i.motivo)}</small>
            <div class="acoes" style="justify-content:flex-start;margin-top:4px"><button class="bt leve" data-conc-copiar="${n}">${concCopiado === n ? '✓ Copiado' : 'Copiar texto do chamado'}</button>${F ? `<a class="lnk" href="${esc(F.URL.cobranca(i.pedido))}" target="_blank" rel="noopener">Abrir a cobrança</a>` : ''}</div></div>`).join('')}
          ${its.length > 3 ? `<p class="det">E mais ${its.length - 3} no fechamento completo.</p>` : ''}
          ${((rateio && rateio.faturas) || []).filter(f => f && f.conferido === false && !f.incompleto && Math.abs(SHC.num(f.diferenca) || 0) >= 1).map(f => `<div class="linha-comp"><b>Fatura ${esc(f.nome || f.fatura)}</b><small>A soma das cobranças não bate com o total da fatura: diferença de ${SHC.moeda(Math.abs(f.diferenca))}. Pode ser estorno de fatura anterior; confira na fatura.</small></div>`).join('')}</div>`,
          'conc:conferir', !cf ? 'aparece depois da próxima leitura do Faturamento' : (cf.qtd ? '<b class="vm">' + esc(SHC.qtd(cf.qtd, 'cobrança', 'cobranças') + ' · ' + SHC.moeda(cf.valor || 0) + ' a conferir') + '</b>' : '✓ nenhuma cobrança fora do normal')));
        // Faturas do ML e o rateio por ciclo
        const fs = ((fat && fat.faturas) || []).slice(0, 3), rat = (rateio && rateio.faturas) || [];
        h.push(dobra(`<div class="card" id="concFaturas"><b style="font-size:13px">Faturas do ML</b>
          ${fs.map(f => { const r = rat.find(x => x && (x.fatura === f.mes || x.nome === f.nome)); return `<div class="linha-comp"><b>${esc(f.nome || f.mes)}${f.status ? ' · ' + esc(P.situacaoFatura(f.status)) : ''}</b><small>Total ${SHC.num(f.total) === null ? '—' : SHC.moeda(f.total)} · pago ${SHC.num(f.quitado) === null ? '—' : SHC.moeda(f.quitado)} · a pagar ${SHC.num(f.aPagar) === null ? '—' : SHC.moeda(f.aPagar)}${f.vencimento ? ' · vence ' + esc(P.dataBr(f.vencimento)) : ''}</small>`
            + (r ? `<small>${Object.keys(r.porMes || {}).sort().map(m => esc(P.nomeMes(m)) + ': ' + SHC.moeda(r.porMes[m])).join(' · ')}${r.incompleto ? ' · parte do ciclo ainda não lida' : r.conferido ? ' · ✓ bate com o total da fatura' : ''}</small>` : '')
            + (linkML(f.linkDetalhe) ? `<a class="lnk" href="${esc(f.linkDetalhe)}" target="_blank" rel="noopener" style="font-size:11.5px">Abrir a fatura</a>` : '') + '</div>'; }).join('') || '<p class="det">As faturas aparecem depois da próxima sincronização.</p>'}
          <p class="det">A fatura fecha num dia do mês: ela junta cobranças de dois meses do calendário. Por mês = rateio do ciclo.</p></div>`,
          'conc:faturas', fs.length ? esc((fs[0].nome || fs[0].mes) + ' · ' + (SHC.num(fs[0].total) === null ? '—' : SHC.moeda(fs[0].total)) + (fs[0].status ? ' · ' + P.situacaoFatura(fs[0].status) : '')) : 'ainda não lidas'));
        // Notas fiscais: (a) as do ML (tarifas) por mês, o mais recente à vista; (b) as das suas vendas (Faturador e Full), atalhos.
        const notas = (fat && fat.notas) || {}, meses = Object.keys(notas).filter(m => Array.isArray(notas[m]) && notas[m].length).sort().reverse().slice(0, 6);
        const linkNf = m => { const u = ((fat && fat.linkNotas) || {})[m] || ((((fat && fat.faturas) || []).find(f => f.mes === m) || {}).notas || {}).url; return linkML(u) ? u : 'https://vendedores.mercadolivre.com.br/billing/resume'; };
        const linhaNf = m => `<div class="linha-sem"><span><b>${esc(P.nomeMes(m))}</b><small>${esc(SHC.qtd(notas[m].length, 'nota', 'notas'))} · ${SHC.moeda(SHC.r2(notas[m].reduce((s, n) => s + (SHC.num(n.amount) || 0), 0)))}</small></span><a class="bt leve" href="${esc(linkNf(m))}" target="_blank" rel="noopener">Baixar</a></div>`;
        h.push(`<div class="card" id="concNotas"><b style="font-size:13px">Notas fiscais</b>
          <p style="margin:8px 0 2px;font-weight:650;font-size:12.5px">Notas fiscais do Mercado Livre (tarifas)</p>
          ${meses.length ? linhaNf(meses[0]) + (meses.length > 1 ? ' ' + btVer('conc:notas', 'Ver os meses anteriores') + (aberto('conc:notas') ? meses.slice(1).map(linhaNf).join('') : '') : '')
            : '<p class="det">As notas das tarifas aparecem depois da próxima leitura das faturas do ML.</p>'}
          <p class="det">As notas que o ML emite para você pelas tarifas de cada fatura. O arquivo é baixado na própria fatura do ML.</p>
          <p style="margin:10px 0 2px;font-weight:650;font-size:12.5px">Notas fiscais das suas vendas (Faturador e Full)</p>
          ${nfeHtml()}
          <p class="det" style="margin-top:8px">Outros atalhos do Mercado Livre:</p>
          <div class="atalho-nf">${NF_VENDAS.map(([u, t, d]) => `<a href="${esc(u)}" target="_blank" rel="noopener"><b>${esc(t)}</b><small>${esc(d)}</small></a>`).join('')}</div>
          ${ci && !ci.vermelho ? `<p class="det">Certificado digital: ${esc(ci.texto)}${ci.velho ? ` <a class="lnk" href="${esc(SHC.FATURADOR_URL)}" target="_blank" rel="noopener">Confira a validade no Faturador</a>` : ''}</p>` :(!ci ? '<p class="det">Validade do certificado digital: abra o Faturador uma vez e o Copiloto lê o aviso da própria tela do ML.</p>' : '')}</div>`);
        $('#listaConc').innerHTML = h.join('');
    }
    async function copiarConc(n) {
        const x = ((conferir && conferir.itens) || [])[n];
        if (!x || !SHC.fech) return;
        try { await navigator.clipboard.writeText(SHC.fech.textoChamado(x)); concCopiado = n; }
        catch (e) { concCopiado = -1; avisa('Não consegui copiar sozinho. Abra o fechamento completo e copie o texto de lá.', 8000); }
        desenhaConc();
    }

    // ── Aba Canal: a agenda montada na página "Agenda do Canal de transmissão" (shc:canal:plano:<canal>) ──
    function desenhaCanal() {
        const pl = canalPlano && canalPlano.plano, px = P.proximasCanal(pl, Date.now()), h = [];
        const feitas = (pl || []).filter(s => s.itemId && s.feito).length, comProd = (pl || []).filter(s => s.itemId).length;
        h.push(dobra(`<div class="card" id="canalProx"><b style="font-size:13px">Próximas transmissões</b>
          ${px.slice(0, 10).map(s => `<div class="linha-comp"><b>${esc(P.quandoCanal(s.dia, s.hora))}</b><small>${esc(curtoTxt(s.titulo || tituloDe(s.itemId), 60))} · ${s.feito ? '✓ criada no ML' : 'falta criar no ML'}</small></div>`).join('')
            || `<p class="det">${pl ? 'Nenhuma transmissão daqui para frente na agenda.' : 'A agenda ainda não foi montada.'} Clique em “Abrir a agenda”.</p>`}
          ${comProd ? `<p class="det">${feitas} de ${comProd} comunicações da agenda já criadas no ML.</p>` : ''}</div>`,
          'canal:prox', px.length ? esc('próxima: ' + P.quandoCanal(px[0].dia, px[0].hora)) : (pl ? 'nenhuma daqui para frente' : 'agenda ainda não montada')));
        // Produtos que dão lucro na promoção (a mesma conta da aba Promoções): os candidatos para programar.
        const bons = snap ? snap.familias.map(f => resumoFamilia(f)).filter(r => r.classe === 'lucrativo') : [];
        h.push(dobra(`<div class="card" id="canalProd"><b style="font-size:13px">Produtos que dão lucro para programar</b>
          ${bons.slice(0, 5).map(r => { const e = r.rec && r.rec.escolha; return `<div class="linha-comp"><b>${esc(curtoTxt(r.f.titulo, 60))}</b><small>${e && e.sobra !== null ? 'Lucro de ' + SHC.moeda(e.sobra) + ' na promoção “' + esc(curtoTxt(e.p.promo, 40)) + '”' : 'Dá lucro na sua meta'}</small></div>`; }).join('')
            || `<p class="det">${snap ? 'Nenhum produto em promoção dá lucro na sua meta agora (ou falta o custo).' : 'As promoções ainda não foram lidas.'}</p>`}
          <p class="det">A agenda escolhe entre os produtos em promoção que dão lucro. Quem cria cada transmissão no ML é você.</p></div>`,
          'canal:prod', snap ? esc(SHC.qtd(bons.length, 'produto dá lucro', 'produtos dão lucro') + ' na promoção') : 'promoções ainda não lidas'));
        $('#listaCanal').innerHTML = h.join('');
    }

    // ── Aba Saúde: dados fiscais, fotos, radar de visitas e robô de fotos ──
    const andandoSaude = () => { const p = status.saudeProgresso; return !!(p && p.de > 0 && Date.now() - (p.ts || 0) < 2 * 60000); };   // ts velho = parado
    const tituloDe = id => { const it = itens.find(x => x.itemId === id); return (it && it.titulo) || id; };
    const btFotos = (id, txt) => `<button class="lnk" data-abrir-fotos="${esc(id)}">${esc(txt || 'Abrir no ML')}</button>`;
    function desenhaSaude() {
        const hoje = SHC.hoje(), p = status.saudeProgresso;
        const rm = resumoMed(), f = P.saudeFiscal(fiscal, itens), rf = P.resumoFotos(fotos, itens), rl = P.radarLista(visitas, itens.filter(SHC.anuncioAtivo), cfg, hoje);
        talvezFiscal();
        const nSug = ((robo && robo.sugestoes) || []).length;
        // Cada cartão recolhido: o título, 1 linha de resumo e "Ver mais".
        const mc = P.saudeManchete(P.reputacaoLinha(reputacao), P.perguntasLinha(perguntas, resumoML), f.n);
        $('#listaSaude').innerHTML = `<p class="manchete"><span class="pt ${mc.cor}"></span><b>${esc(mc.fato)}</b> ${esc(mc.acao)}</p>` + cardReputacao() + cardPerguntas()
            + (andandoSaude() ? `<p class="andam">Conferindo fotos, medidas e visitas: ${p.feito || 0} de ${p.de} anúncios nesta rodada…</p>` : '')
            + (saudeMsg ? `<p class="recnota neutra" role="status" style="margin:0 0 8px">${esc(saudeMsg)}</p>` : '')
            + dobra(cardResumoML(), 'saude:resumo', resumoML ? (resumoML.cartoes.length ? esc(SHC.qtd(resumoML.cartoes.length, 'pendência', 'pendências')) : '✓ nada pendente') : 'aparece depois da próxima sincronização')
            + dobra(cardFiscal(), 'saude:fiscal', f.n === null ? (fiscalLendo ? 'Lendo os dados fiscais…' : esc(fiscalMsg || 'ainda não lidos') + ' <button class="lnk" data-fiscal-agora>Ler agora</button>') : (f.n ? '<b class="vm">' + esc(SHC.qtd(f.n, 'anúncio sem dados fiscais', 'anúncios sem dados fiscais')) + '</b>' : '✓ todos com dados fiscais'))
            + dobra(cardFotos(), 'saude:fotos', rf.lidos ? esc(P.milhar(rf.lidos) + ' de ' + P.milhar(rf.de) + ' conferidos · ' + rf.faixas.f1.length + ' com 1 foto') : (permWww ? 'lendo aos poucos' : 'falta a permissão para ler'))
            + dobra(cardMedidas(rm), 'saude:medidas', rm.lidos ? (rm.div.length ? esc(SHC.qtd(rm.div.length, 'SKU com medidas diferentes', 'SKUs com medidas diferentes')) : '✓ nenhuma diferença') : (permWww ? 'lendo aos poucos' : 'falta a permissão para ler'))
            + (rm.lidos ? dobra(cardMudMed(rm), 'saude:mudmed', rm.mud.length ? esc(SHC.qtd(rm.mud.length, 'mudança', 'mudanças') + ' nos últimos ' + P.MED_DIAS + ' dias') : 'nenhuma mudança') : '')
            + dobra(cardRadar(hoje), 'saude:radar', rl.lidos ? (rl.caindo.length ? '<b class="vm">' + esc(SHC.qtd(rl.caindo.length, 'anúncio perdendo visitas', 'anúncios perdendo visitas')) + '</b>' : 'nenhum perdendo visitas') : 'lendo aos poucos')
            + dobra(cardRobo(hoje), 'saude:robo', (cfg.robo_ligado ? 'ligado' : 'desligado') + (nSug ? ' · ' + esc(SHC.qtd(nSug, 'sugestão', 'sugestões')) : ''), '</div>');
    }
    // Dados fiscais sem leitura (ou com mais de 6 h): pede só a parte fiscal ao fundo ({acao:'fiscal_agora'}), 1 vez a cada 10 min.
    function talvezFiscal(forcar) {
        const velho = !fiscal || Date.now() - (fiscal.ts || 0) > 6 * 3600e3;
        if (fiscalLendo || !velho || (!forcar && Date.now() - fiscalPedidoEm < 10 * 60e3)) return;
        fiscalLendo = true; fiscalMsg = ''; fiscalPedidoEm = Date.now();
        const pede = SHC.fech && SHC.fech.pedirAoFundo ? SHC.fech.pedirAoFundo({ acao: 'fiscal_agora' }, 90000) : Promise.resolve(chrome.runtime.sendMessage({ acao: 'fiscal_agora' })).catch(() => null);
        Promise.resolve(pede).then(r => {
            fiscalLendo = false;
            if (r && r.fiscal) fiscal = r.fiscal;
            fiscalMsg = r && r.ok ? '' : !r ? 'O Copiloto não respondeu agora. Clique em Ler agora.'
                : r.motivo === 'sem_sessao' ? 'Entre no Mercado Livre neste Chrome e clique em Ler agora.'
                : r.motivo === 'sem_conta' ? 'Clique em Sincronizar agora: o Copiloto ainda não sabe qual é a sua conta.'
                : r.motivo === 'outra_conta' ? 'O Mercado Livre aberto neste Chrome é de outra conta. Clique em Sincronizar agora para trocar de conta.'
                : 'O Mercado Livre não respondeu agora. Tente de novo em alguns minutos.';
            if (aba === 'saude') desenhaSaude();
            desenhaAlertas();
        });
    }
    // v2.7: os cartões de pendência do Resumo do vendedor (próximos a serem pausados, anúncios a melhorar, preço alto, Full…), com o link de cada um.
    function cardResumoML() {
        const cab = '<b style="font-size:13px">Do Resumo do Mercado Livre</b>', cs = (resumoML && resumoML.cartoes) || [];
        if (!resumoML) return `<div class="card" id="cardResumoML">${cab}<p class="det">Os cartões de pendência do Resumo do vendedor aparecem depois da próxima sincronização.</p></div>`;
        let h = `<div class="card" id="cardResumoML">${cab}`;
        h += cs.length ? cs.map(c => `<div class="linha-comp"><b${c.cor === 'red' ? ' class="vm"' : ''}>${fmtUn(c.qtd)} · ${esc(c.texto)}</b><small>${esc(c.grupo)}${linkML(c.link) ? ` · <a class="lnk" href="${esc(c.link)}" target="_blank" rel="noopener" style="font-size:11px">Abrir no ML</a>` : ''}</small></div>`).join('')
            : '<p class="recnota ok">✓ Nenhuma pendência no Resumo do vendedor.</p>';
        const fu = (resumoML.full || []).filter(f => f.nome);
        if (fu.length) h += `<p class="det" style="margin-top:6px">Full: ${esc(fu.map(f => f.nome + (f.pct !== null ? ' ' + String(f.pct).replace('.', ',') + '%' : (f.texto ? ' ' + f.texto : ''))).join(' · '))}</p>`;
        return h + `<p class="det">Os mesmos cartões da página Resumo do vendedor${resumoML.ts ? ', lidos ' + esc(tempo(resumoML.ts)) : ''}. Fonte: Mercado Livre.</p></div>`;
    }
    function cardFiscal() {
        const f = P.saudeFiscal(fiscal, itens), cab = '<b style="font-size:13px">Dados fiscais</b>';
        const erro = status.erroSaude ? `<p class="det">${status.erroSaude === 'sem_sessao' ? 'Entre no Mercado Livre neste Chrome para o Copiloto ler os avisos.' : 'Não consegui ler os avisos do Mercado Livre agora. Tento de novo na próxima sincronização.'}${f.n !== null ? ' Mostrando a leitura de ' + esc(tempo(fiscal.ts)) + '.' : ''}</p>` : '';
        if (f.n === null) return `<div class="card" id="cardFiscal">${cab}${fiscalLendo ? '<p class="det">Lendo os dados fiscais…</p>'
            : `<p class="det">${esc(fiscalMsg || 'Os dados fiscais ainda não foram lidos.')}</p><button class="bt leve" data-fiscal-agora>Ler agora</button>`}</div>`;
        if (!f.n) return `<div class="card" id="cardFiscal">${cab}<p class="recnota ok">✓ Todos os seus anúncios têm dados fiscais.</p>${erro}</div>`;
        const vis = f.lista.slice(0, saudeVer.fiscal ? limite.saude : 5);
        return `<div class="card" id="cardFiscal">${cab}
          <p style="margin:6px 0 2px;font-size:14px;font-weight:750;color:var(--verm)">${esc(SHC.qtd(f.n, 'anúncio sem dados fiscais', 'anúncios sem dados fiscais'))}</p>
          <p class="det">Sem os dados fiscais (NCM, origem, regra tributária…), o Mercado Livre não emite a NF-e dessas vendas.</p>${erro}
          ${vis.map(l => `<div class="linha-sem"><span><b>${esc(curtoTxt(l.titulo || l.itemId, 60))}</b><small>${esc(l.itemId)}</small></span></div>`).join('')}
          ${saudeVer.fiscal ? botaoMais('saude', f.lista.length - vis.length) : ''}
          ${f.lista.length > 5 ? `<button class="mais" data-saude-ver="fiscal">${saudeVer.fiscal ? 'Ver menos' : 'Ver todos (' + P.milhar(f.lista.length) + ')'}</button>` : ''}
          ${f.familias ? `<p class="det">E ${esc(SHC.qtd(f.familias, 'produto com variações', 'produtos com variações'))} (cada um aparece como 1 linha no Mercado Livre).</p>` : ''}
          ${f.completo ? '' : '<p class="det">A lista ainda não está completa: o resto aparece na próxima sincronização.</p>'}
          <div class="acoes" style="justify-content:flex-start"><button class="bt" data-abrir-fiscal>Corrigir no Editor em massa</button></div></div>`;
    }
    // Lista da aba Saúde minimizada: n linhas + "Ver todos (N)"; aberta, 100 por vez com "Mostrar mais" (como o cartão Dados fiscais).
    function listaVer(k, l, n, linha) {
        const vis = l.slice(0, saudeVer[k] ? limite.saude : n);
        return vis.map(linha).join('') + (saudeVer[k] ? botaoMais('saude', l.length - vis.length) : '')
            + (l.length > n ? `<button class="mais" data-saude-ver="${k}">${saudeVer[k] ? 'Ver menos' : 'Ver todos (' + P.milhar(l.length) + ')'}</button>` : '');
    }
    function cardFotos() {
        const r = P.resumoFotos(fotos, itens);
        let h = '<div class="card" id="cardFotos"><b style="font-size:13px">Fotos</b>';
        if (!permWww) h += btPerm();
        if (!r.lidos) return h + (permWww ? `<p class="det">${andandoSaude() ? 'Contando as fotos…' : 'As fotos aparecem aos poucos: o Copiloto confere alguns anúncios por hora, com o Chrome aberto.'}</p>` : '') + '</div>';
        if (r.lidos < r.de && permWww) {
            const pct = Math.round(r.lidos / r.de * 100);
            h += `<div class="barra-g" role="progressbar" aria-label="Fotos conferidas" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div><p class="det" style="margin:0">Fotos conferidas: ${r.lidos} de ${r.de} anúncios ativos</p>`;
        }
        h += '<div class="kpis" style="margin:8px 0 6px">' + P.FAIXAS_FOTOS.map(([k, rot]) => `<button class="kpi${fotoFaixa === k ? ' on' : ''}" data-foto-faixa="${k}"><small>${rot}</small><b>${r.faixas[k].length}</b></button>`).join('') + '</div>';
        if (fotoFaixa) {
            const l = r.faixas[fotoFaixa];
            h += l.length ? listaVer('fotos', l, 8, x => `<div class="linha-sem"><span><b>${esc(curtoTxt(x.titulo || x.itemId, 60))}</b><small>${esc(x.itemId)} · ${esc(P.fotosTxt(x))}</small></span>${btFotos(x.itemId)}</div>`)
                : '<p class="det">Nenhum anúncio nesta faixa.</p>';
        }
        if (r.marcadas.length) h += `<p style="margin:10px 0 2px;font-weight:650;font-size:12.5px">Com fotos marcadas pelo ML (${r.marcadas.length})</p>`
            + listaVer('marcadas', r.marcadas, 8, x => `<div class="linha-sem"><span><b>${esc(curtoTxt(x.titulo || x.itemId, 60))}</b><small class="vm">${x.problemas} de ${x.qtd} fotos marcadas pelo ML</small></span>${btFotos(x.itemId)}</div>`);
        return h + '<p class="det">Fonte: tela “Alterar anúncio” do Mercado Livre, conferida a cada 7 dias. A 1ª foto é a capa.</p></div>';
    }
    const btPerm = () => `<p class="det">Para ler as fotos e as medidas, o Copiloto abre a tela “Alterar anúncio” de cada anúncio, só para ler (não muda nada). O Chrome pede a sua permissão uma vez.</p><button class="bt" data-perm-fotos>${PERM_TXT}</button>`;
    const MED_FRASE = 'Anúncios do mesmo produto com medidas diferentes podem pagar fretes diferentes; corrija para a medida certa.';
    const medMsgDe = id => (medMsg && medMsg.id === id ? `<small class="det" role="status" style="display:block">${esc(medMsg.txt)}</small>` : '');
    const btMed = id => `<button class="lnk" data-abrir-med="${esc(id)}">Alterar no ML</button>`;
    // Medidas do ERP (c|sku|…) do SKU: dizem se a mudança foi do ML e qual é a medida certa no chamado.
    const erpDe = sku => { const c = sku ? cadSku[SHC.chaveSku(sku)] : null; return c ? SHC.medidaDe([c.larguraCm, c.alturaCm, c.comprimentoCm], c.pesoKg) : null; };
    const resumoMed = () => P.resumoMedidas(medidas, itens, vm, Date.now(), { erpDe });
    // Medidas da embalagem: SKUs cujos anúncios têm medidas diferentes (os 5 de maior diferença; "Ver todos"). Clicar no SKU abre a tabela.
    function cardMedidas(rm) {
        let h = '<div class="card" id="cardMedidas"><b style="font-size:13px">Medidas da embalagem</b>';
        if (!permWww) h += btPerm();
        if (!rm.lidos) return h + (permWww ? '<p class="det">O Copiloto está lendo as medidas de cada anúncio; aparece aqui em alguns minutos.</p>' : '') + '</div>';
        if (rm.lidos < rm.de && permWww) {
            const pct = Math.round(rm.lidos / rm.de * 100);
            h += `<div class="barra-g" role="progressbar" aria-label="Medidas conferidas" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div><p class="det" style="margin:0">Medidas conferidas: ${P.milhar(rm.lidos)} de ${P.milhar(rm.de)} anúncios ativos</p>`;
        }
        const l = rm.div;
        h += l.length ? `<p style="margin:6px 0 2px;font-size:14px;font-weight:750;color:${l.some(P.medPesa) ? 'var(--verm)' : 'inherit'}">${esc(SHC.qtd(l.length, 'SKU com medidas diferentes entre anúncios', 'SKUs com medidas diferentes entre anúncios'))}</p><p class="det">${MED_FRASE}</p>`
            : '<p class="recnota ok">✓ Nenhum SKU com medidas diferentes entre os anúncios conferidos.</p>';
        // Resposta do "Conferir agora" de um anúncio que saiu da lista (a medida ficou igual): aparece aqui em cima.
        const aberto = l.find(g => g.sku === medSku);
        if (medMsg && /^MLB/.test(medMsg.id) && !(aberto && aberto.anuncios.some(a => a.itemId === medMsg.id))) h += medMsgDe(medMsg.id);
        h += listaVer('medidas', l, 5, g => linhaSkuMed(g, rm.porItem));
        return h + '<p class="det">Fonte: tela “Alterar anúncio” do Mercado Livre. Quem vendeu nos últimos 3 dias é conferido todo dia; os demais, a cada 7 dias. Peso considerado = o maior entre o peso físico e o volumétrico (comprimento × largura × altura ÷ 6.000).</p></div>';
    }
    function linhaSkuMed(g, porItem) {
        const pesa = P.medPesa(g);
        let h = `<div class="linha-comp"><button class="lnk" data-med-sku="${esc(g.sku)}" style="font-weight:700;text-align:left">SKU ${esc(g.sku)} · ${g.anuncios.length} anúncios</button>
          <small>${pesa ? `Diferença de até <b class="vm">${P.kgTxt(g.maiorDiferencaKg)}</b> no peso considerado (o que conta no frete)` : 'Mesmo peso considerado; só as medidas da caixa diferem'}</small>`;
        if (medSku !== g.sku) return h + '</div>';
        h += `<small>${esc(g.resumo)}${pesa ? ' Em vermelho: anúncio com medida diferente da ' + (g.referencia.criterio === 'mais_comum' ? 'mais comum' : 'de referência') + '.' : ''}</small>
          <table class="tabf"><thead><tr><th>Anúncio</th><th>Medidas</th><th>Peso</th><th>Considerado</th></tr></thead><tbody>`;
        g.anuncios.forEach(a => {
            const tit = tituloDe(a.itemId), at = (porItem[a.itemId] || {}).atual || {}, verm = a.foge && pesa;
            h += `<tr${verm ? ' class="acima"' : ''}><td><b>${esc(a.itemId)}</b>${tit !== a.itemId ? `<small style="display:block">${esc(curtoTxt(tit, 40))}</small>` : ''}<small style="display:block">${btMed(a.itemId)} · <button class="lnk" data-med-agora="${esc(a.itemId)}">Conferir agora</button></small>${medMsgDe(a.itemId)}</td>
              <td class="${verm ? 'mais' : ''}">${esc(P.cmTxt(a))}</td><td>${esc(P.kgTxt(a.pesoKg))}</td><td class="${verm ? 'mais' : ''}">${esc(P.kgTxt(a.consideradoKg))}</td></tr>`;
            // As duas medidas que o ML calcula, quando diferem: a de envio (a do frete) e a de fábrica.
            if (at.envio && at.fabrica && !SHC.medidasIguais(at.envio, at.fabrica)) h += `<tr><td colspan="4" style="text-align:left"><small>Embalagem de envio (a do frete): ${esc(SHC.medidaTxt(at.envio))} · Embalagem de fábrica: ${esc(SHC.medidaTxt(at.fabrica))}</small></td></tr>`;
        });
        return h + '</tbody></table></div>';
    }
    // Mudanças de medida dos últimos 30 dias (fora as do seller), com o texto do chamado pronto para copiar e o "Fui eu que mudei".
    const dataBr = ts => new Date(ts).toLocaleDateString('pt-BR');
    function cardMudMed(rm) {
        if (!rm.lidos) return '';
        let h = '<div class="card" id="cardMudMed"><b style="font-size:13px">Medidas que mudaram</b>';
        h += medMsg && medMsg.id === 'fui' ? medMsgDe('fui') : '';
        if (!rm.mud.length) return h + `<p class="det">Nenhuma mudança de medida nos últimos ${P.MED_DIAS} dias nos anúncios conferidos.</p></div>`;
        h += `<p class="det">Mudanças nos últimos ${P.MED_DIAS} dias. Se não foi você, copie o texto e cole no atendimento do Mercado Livre (o Copiloto não envia nada). Se foi você, clique em “Fui eu que mudei”.</p>`;
        h += listaVer('medmud', rm.mud, 5, (m, i) => `<div class="linha-comp"><b>${esc(curtoTxt(tituloDe(m.itemId), 60))}</b>
            <small>${esc(m.itemId)}${m.sku ? ' · SKU ' + esc(m.sku) : ''} · ${m.vistoAte && dataBr(m.vistoAte) !== dataBr(m.em) ? 'entre ' + esc(dataBr(m.vistoAte)) + ' e ' + esc(dataBr(m.em)) : esc(dataBr(m.em))}</small>
            <small><b>${m.quem === 'ml' ? 'O ML alterou' : 'A medida mudou'}</b> · Antes: ${esc(SHC.medidaTxt(m.antes))} → agora: <span class="vm">${esc(SHC.medidaTxt(m.depois))}</span></small>
            ${m.correta ? `<small>Medida certa (${m.corretaDe === 'erp' ? 'do seu ERP' : 'a que você deixou'}): ${esc(SHC.medidaTxt(m.correta))}</small>` : ''}
            <div class="acoes" style="justify-content:flex-start;flex-wrap:wrap;margin-top:4px"><button class="bt leve" data-med-copiar="${i}">Copiar texto do chamado</button>${btMed(m.itemId)}<button class="lnk" data-med-fui="${esc(m.itemId)}|${m.em}">Fui eu que mudei</button></div>
            ${medTxt === i ? medMsgDe('copiar') + `<textarea readonly>${esc(m.chamado)}</textarea>` : ''}</div>`);
        return h + '</div>';
    }
    // "Conferir agora": relê as medidas de 1 anúncio no fundo ({acao:'medidas_agora'}); a resposta aparece na linha do anúncio.
    async function medidasAgora(id) {
        medMsg = { id, txt: 'Conferindo as medidas no Mercado Livre…' }; desenhaAba();
        let r = null;
        try { r = await chrome.runtime.sendMessage({ acao: 'medidas_agora', itemId: id }); } catch (e) { r = null; }
        if (r && r.ok && r.medidas && r.medidas.atual) {
            medidas = Object.assign({}, medidas || {}, { porItem: Object.assign({}, (medidas && medidas.porItem) || {}, { [id]: r.medidas }) });
            // Mudança que parece do seller (voltou a uma medida antiga, igual ao ERP ou aos outros anúncios do SKU, logo depois de "Alterar no ML"): sem aviso.
            const mu = r.mudou && r.mudanca ? SHC.medidasMudadas(medidas.porItem, r.mudanca.em, { erpDe, itemId: id })[0] : null;
            medMsg = { id, txt: mu ? (mu.quem === 'ml' ? 'O ML mudou as medidas deste anúncio' : 'A medida deste anúncio mudou') + ': de ' + SHC.medidaTxt(mu.antes) + ' para ' + SHC.medidaTxt(mu.depois)
                    + '. ' + (mu.quem === 'ml' ? 'O' : 'Se não foi você, o') + ' texto do chamado está em “Medidas que mudaram”, na aba Saúde.'
                : '✓ Conferido agora: ' + SHC.medidaTxt(r.medidas.atual) + '.' };
        } else medMsg = { id, txt: r && r.motivo === 'semPermissao' ? 'Clique em “' + PERM_TXT + '” e tente de novo.'
            : r && r.motivo === 'sem_sessao' ? 'Entre no Mercado Livre neste Chrome e tente de novo.' : 'Não consegui ler as medidas agora. Tente de novo em alguns minutos.' };
        desenhaAba(); desenhaAlertas();
    }
    // Marca do seller ({acao:'medidas_marca'}): 'alterar' ao abrir "Alterar no ML" (mudança vista até 48 h depois = dele); 'fui_eu' tira a mudança do aviso.
    async function marcaMedida(id, tipo, em) {
        let r = null;
        try { r = await chrome.runtime.sendMessage({ acao: 'medidas_marca', itemId: id, tipo, em }); } catch (e) { r = null; }
        if (r && r.ok && r.medidas) medidas = Object.assign({}, medidas || {}, { porItem: Object.assign({}, (medidas && medidas.porItem) || {}, { [id]: r.medidas }) });
        if (tipo !== 'fui_eu') return;
        medMsg = { id: 'fui', txt: r && r.ok ? '✓ Anotado: essa mudança foi sua e saiu dos avisos.' : 'Não consegui anotar agora. Tente de novo.' };
        medTxt = -1;
        desenhaSaude(); desenhaAlertas();
    }
    async function copiarChamadoMed(i) {
        const m = resumoMed().mud[i];
        if (!m) return;
        medTxt = i;
        try { await navigator.clipboard.writeText(m.chamado); medMsg = { id: 'copiar', txt: '✓ Texto copiado. Cole no atendimento do Mercado Livre.' }; }
        catch (e) { medMsg = { id: 'copiar', txt: 'Não consegui copiar sozinho: selecione o texto abaixo e copie.' }; }
        desenhaSaude();
    }
    function linhaRadar(x, caindo) {
        const r = x.r, on = !!(cfg.robo_itens || {})[x.itemId];
        return `<div class="linha-comp"><b>${esc(curtoTxt(x.titulo || x.itemId, 60))}</b>
          <small>Últimos 7 dias: ${P.milhar(r.ult7)} visitas · 7 dias antes: ${P.milhar(r.ant7)}${r.variacaoPct !== null ? ` · <span class="${caindo ? 'vm' : ''}">${P.varPct(r.variacaoPct)}</span>` : ''}</small>
          ${caindo ? `<small>O que fazer: ${btFotos(x.itemId, 'Trocar a ordem das fotos (a capa fica)')} · ${btFotos(x.itemId, 'Revisar título')} · ${btFotos(x.itemId, 'Revisar preço')} · <button class="lnk" data-atalho="ads.html">Ver no Ads</button></small>
          <label class="conf" style="margin:4px 0 0"><input type="checkbox" data-robo-item="${esc(x.itemId)}"${on ? ' checked' : ''}> Robô de fotos neste anúncio${cfg.robo_ligado ? '' : ' (ligue o robô abaixo)'}</label>` : ''}</div>`;
    }
    function cardRadar(hoje) {
        const rl = P.radarLista(visitas, itens.filter(SHC.anuncioAtivo), cfg, hoje);
        let h = `<div class="card" id="cardRadar"><b style="font-size:13px">Radar de visitas</b>
          <p class="recnota neutra">O Mercado Livre não publica que mexer no anúncio melhora a posição. O Copiloto mede antes e depois para você ver se funciona na sua conta.</p>`;
        if (!rl.lidos) return h + `<p class="det">${andandoSaude() ? 'Lendo as visitas…' : 'As visitas aparecem aos poucos: o Copiloto lê alguns anúncios por hora, com o Chrome aberto.'}</p><button class="bt leve" data-saude-agora>Ler agora</button></div>`;
        h += `<p style="margin:8px 0 2px;font-weight:650;font-size:12.5px">Perdendo visitas (${rl.caindo.length})</p>`;
        h += rl.caindo.length ? rl.caindo.slice(0, limite.saude).map(x => linhaRadar(x, true)).join('') + botaoMais('saude', rl.caindo.length - limite.saude)
            : `<p class="det">Nenhum anúncio perdeu ${cfg.radar_queda_pct || 20}% ou mais das visitas na última semana.</p>`;
        [['estavel', 'Estáveis'], ['subindo', 'Subindo']].forEach(([k, rot]) => {
            if (!rl[k].length) return;
            h += `<button class="mais" data-saude-ver="${k}">${saudeVer[k] ? 'Esconder' : 'Ver'} ${rot.toLowerCase()} (${rl[k].length})</button>`;
            if (saudeVer[k]) h += rl[k].slice(0, limite.saude).map(x => linhaRadar(x, false)).join('') + botaoMais('saude', rl[k].length - limite.saude);
        });
        if (rl.poucos.length) h += `<p class="det">${esc(SHC.qtd(rl.poucos.length, 'anúncio', 'anúncios'))} com poucas visitas para comparar (menos de 30 em 2 semanas).</p>`;
        return h + '<p class="det">Compara as visitas dos últimos 7 dias com as dos 7 anteriores. Fonte: métricas de cada anúncio no Mercado Livre, relidas uma vez por dia, alguns anúncios por hora, com o Chrome aberto.</p></div>';
    }
    function cardRobo(hoje) {
        const ligado = !!cfg.robo_ligado, auto = SHC.ROBO_ESCRITA_CONFERIDA === true;
        const escreve = auto && cfg.robo_modo === 'automatico';   // só true quando a escrita no ML for conferida e o modo Automático estiver ligado
        const nItens = Object.keys(cfg.robo_itens || {}).filter(k => cfg.robo_itens[k]).length;
        const val = k => esc(String(SHC.num(cfg[k]) !== null ? cfg[k] : SHC.PADRAO[k]));
        let h = `<div class="card" id="cardRobo"><div style="display:flex;align-items:center;gap:8px"><b style="font-size:13px">Robô de fotos</b><span class="var ${ligado ? 'desce' : 'igual'}">${ligado ? 'Ligado' : 'Desligado'}</span>
            <button class="bt${ligado ? ' leve' : ''}" data-robo-geral style="margin-left:auto">${ligado ? 'Desligar' : 'Ligar o robô'}</button></div>
          <p class="det">${escreve ? 'Quando as visitas de um anúncio caem, troca a ordem das fotos para ver se ajuda.' : 'Quando as visitas de um anúncio caem, sugere uma nova ordem das fotos. Quem troca no Mercado Livre é você.'}</p>
          <ul class="vant"><li>A foto de capa nunca sai do lugar.</li><li>Não mexe se o Mercado Livre marcou alguma foto do anúncio.</li>
            <li>No máximo 1 ${escreve ? 'mudança' : 'sugestão'} a cada ${val('robo_intervalo_dias')} dias por anúncio.</li><li>No máximo ${val('robo_max_dia')} ${escreve ? 'mudanças' : 'sugestões'} por dia na conta.</li>
            <li>Só ${escreve ? 'age nos' : 'olha os'} anúncios que você ligar, quando as visitas caem ${val('radar_queda_pct')}% ou mais e o anúncio tem 3 fotos ou mais.</li></ul>`;
        if (ligado && !permWww) h += `<p class="aviso-custo">Para o robô funcionar, o Copiloto precisa ler as fotos dos anúncios.</p><button class="bt" data-perm-fotos>${PERM_TXT}</button>`;
        if (ligado && !nItens) h += '<p class="aviso-custo">Agora ligue o robô nos anúncios que quiser, na lista “Perdendo visitas” do Radar.</p>';
        if (auto) h += `<div class="acoes" style="justify-content:flex-start;flex-wrap:wrap">${[['sugerir', 'Só sugerir'], ['automatico', 'Automático']].map(([m, t]) => `<button class="bt${cfg.robo_modo === m ? '' : ' leve'}" data-robo-modo="${m}">${t}</button>`).join('')}</div>`;
        h += `<details id="regrasRobo" style="margin-top:8px"${regrasAbertas ? ' open' : ''}><summary style="cursor:pointer;font-weight:650;font-size:12px">Regras do robô</summary>
            <div class="minfull"><label for="radar_queda_pct">Queda mínima das visitas (%)</label><input class="inp" id="radar_queda_pct" inputmode="numeric" value="${val('radar_queda_pct')}"></div>
            <div class="minfull"><label for="robo_intervalo_dias">Intervalo por anúncio (dias)</label><input class="inp" id="robo_intervalo_dias" inputmode="numeric" value="${val('robo_intervalo_dias')}"></div>
            <div class="minfull"><label for="robo_max_dia">Máximo de ${escreve ? 'mudanças' : 'sugestões'} por dia</label><input class="inp" id="robo_max_dia" inputmode="numeric" value="${val('robo_max_dia')}"></div>
            <div class="minfull"><button class="bt" data-robo-salvar>Salvar regras</button></div></details>`;
        const sug = (robo && robo.sugestoes) || [];
        if (sug.length) h += `<p style="margin:10px 0 2px;font-weight:650;font-size:12.5px">Sugestões (${sug.length})</p>` + sug.slice(0, 20).map(s => `<div class="linha-comp"><b>${esc(curtoTxt(tituloDe(s.itemId), 60))}</b><small>${esc(s.motivo)}</small>
            <div class="acoes" style="justify-content:flex-start;margin-top:4px"><button class="bt leve" data-abrir-fotos="${esc(s.itemId)}">Trocar no ML</button><button class="bt leve" data-ja-troquei="${esc(s.itemId)}">Já troquei</button></div></div>`).join('');
        if (ligado) h += '<button class="bt leve" data-robo-rodar style="margin-top:8px">Procurar sugestões agora</button>';
        h += `<p class="det" id="roboMsg" role="status">${esc(roboMsg)}</p>`;
        const hist = (robo && robo.historico) || [], ult = hist.slice(-10).reverse(), porId = (visitas && visitas.porItem) || {};
        if (ult.length) h += '<p style="margin:10px 0 2px;font-weight:650;font-size:12.5px">Mudanças e resultado</p>' + ult.map(x => `<div class="linha-comp"><b>${esc(curtoTxt(tituloDe(x.itemId), 60))}</b>
            <small>${esc(new Date(x.ts).toLocaleDateString('pt-BR'))} · ${esc(P.historicoTxt(x))}</small>${SHC.roboGravou(x) || x.resultado === 'manual' ? `<small>${esc(P.efeitoTxt(x, (porId[x.itemId] || {}).dias, hoje))}</small>` : ''}
            ${P.podeDesfazer(hist, x) ? `<button class="lnk" data-robo-desfazer="${esc(x.itemId)}">Desfazer</button>` : ''}</div>`).join('');
        return h + '</div>';
    }
    // "Permitir ler fotos e medidas dos anúncios": pede a permissão DENTRO do clique (antes de qualquer await) e depois começa a leitura.
    function permitirFotos() {
        let pedido;
        try { pedido = chrome.permissions.request(PERM_WWW); } catch (e) { pedido = Promise.resolve(false); }
        return Promise.resolve(pedido).catch(() => false).then(async deu => {
            if (!deu) { saudeMsg = 'Sem a permissão do Chrome o Copiloto não consegue ler as fotos e as medidas. Clique de novo e escolha “Permitir”.'; return aba === 'saude' ? desenhaSaude() : desenhaAba(); }
            permWww = true; saudeMsg = 'Pronto! O Copiloto vai ler as fotos e as medidas aos poucos, alguns anúncios por hora.';
            desenhaAba();
            try { await chrome.runtime.sendMessage({ acao: 'saude_agora' }); } catch (e) { /* a leitura da hora cheia conta depois */ }
        });
    }
    async function lerSaudeAgora() {
        let r = null;
        try { r = await chrome.runtime.sendMessage({ acao: 'saude_agora' }); } catch (e) { r = null; }
        saudeMsg = r && r.emCurso ? 'Já estou lendo. Os números aparecem aos poucos.' : 'Lendo agora. Os números aparecem aos poucos.';
        desenhaSaude();
    }
    // "Já troquei": relê as fotos do anúncio (para guardar a ordem nova) e registra a troca no histórico, para medir o efeito.
    async function jaTroquei(id) {
        const antes = (((fotos && fotos.porItem) || {})[id] || {}).ids || [], s = ((robo && robo.sugestoes) || []).find(x => x && x.itemId === id);
        roboMsg = 'Registrando a troca…'; desenhaSaude();
        let r = null;
        try { r = await chrome.runtime.sendMessage({ acao: 'saude_agora', itemId: id }); } catch (e) { r = null; }
        const lidas = r && r.ok && r.fotos && Array.isArray(r.fotos.ids) ? r.fotos.ids : null;
        const radar = SHC.radarVisitas((((visitas && visitas.porItem) || {})[id] || {}).dias, SHC.hoje(), cfg.radar_queda_pct);
        const k = 'robo:' + (conta || 'atual');
        try {
            // ponytail: ler-mudar-gravar fora da fila do fundo; a janela é de milissegundos (o fundo só grava robo: na passada e no desfazer).
            await SHC.gravarChave(k, P.jaTroquei(await SHC.lerChave(k), id, antes, lidas || (s && s.novaOrdem) || antes, radar.ult7, Date.now()));
        } catch (e) { return falhaGravar(e); }
        roboMsg = '✓ Troca registrada. O resultado aparece em “Mudanças e resultado” 7 dias depois.';
        desenhaSaude();
    }
    async function roboAcao(msg) {
        roboMsg = 'Um momento…'; desenhaSaude();
        let r = null;
        try { r = await chrome.runtime.sendMessage(msg); } catch (e) { r = null; }
        if (msg.acao === 'robo_rodar_agora') roboMsg = !r ? 'Não consegui agora. Tente de novo em alguns minutos.' : r.desligado ? 'Ligue o robô primeiro.'
            : (r.sugestoes ? SHC.qtd(r.sugestoes, 'sugestão nova', 'sugestões novas') + '.' : 'Nenhuma troca a sugerir agora.') + (r.feitos && r.feitos.length ? ' ' + SHC.qtd(r.feitos.filter(f => f && f.ok).length, 'troca feita', 'trocas feitas') + '.' : '')
                + (r.semFotos > 0 ? ' Ainda faltam as fotos de ' + SHC.qtd(r.semFotos, 'anúncio', 'anúncios') + (permWww ? ': o Copiloto conta alguns por hora, com o Chrome aberto.' : ': clique em “' + PERM_TXT + '”.') : '');
        else roboMsg = r && r.ok ? '✓ Troca desfeita: as fotos voltaram para a ordem de antes.'
            : r && r.resultado === 'semPermissao' ? 'Para desfazer, o Copiloto precisa abrir as fotos do anúncio: clique em “' + PERM_TXT + '”.'
            : r && r.resultado === 'incerto' ? 'Não deu para confirmar se as fotos voltaram. Confira no Mercado Livre.'
            : (r && r.erro) || 'Não consegui desfazer agora. Tente de novo em alguns minutos.';
        desenhaSaude();
    }
    async function salvarRegrasRobo() {
        const txt = {};
        REGRAS_ROBO.forEach(k => { txt[k] = $('#' + k).value; $('#' + k).style.borderColor = ''; });
        const r = P.lerRegrasRobo(txt), errs = Object.keys(r.erros);
        if (errs.length) { errs.forEach(k => { $('#' + k).style.borderColor = '#DC2626'; }); roboMsg = errs.map(k => r.erros[k]).join(' '); return desenhaSaudeMsg(); }
        REGRAS_ROBO.forEach(k => $('#' + k).blur());
        try { await salvarCfgRobo(r.patch); } catch (e) { return falhaGravar(e); }
        cfg = Object.assign({}, cfg, r.patch); roboMsg = '✓ Regras salvas.';
        desenhaSaude();
    }
    // Erro nas regras: só a mensagem muda (o que o seller digitou fica no campo).
    function desenhaSaudeMsg() { $('#roboMsg').textContent = roboMsg; }
    // Liga/desliga (geral, por anúncio, modo) e regras: grava no cfg (objeto NOVO em robo_itens) e redesenha já, sem esperar a releitura.
    // Não usa SHC.salvarCfg: ele marca configurado = true, e o guia leria isso como "imposto informado" (o campo do imposto viraria 0).
    const salvarCfgRobo = async patch => SHC.gravarChave('cfg', Object.assign({}, (await SHC.lerChave('cfg')) || {}, patch));
    async function mudaRobo(patch) {
        cfg = Object.assign({}, cfg, patch); roboMsg = '';
        desenhaSaude();
        try { await salvarCfgRobo(patch); } catch (e) { falhaGravar(e); }
    }
    function desenhaTudo() {
        desenhaStatus();
        desenhaGuia();
        desenhaAlertas();
        atualizaAbasVisiveis();
        desenhaAba();
        $('#notaPromo').textContent = !cfg.configurado
            ? 'Preço, tarifa, frete e “você recebe” vêm do Mercado Livre. Informe seu imposto em Ajustes e o custo de cada produto.'
            : 'Preço, tarifa, frete e “você recebe” vêm do próprio Mercado Livre. Você só informa o custo.';
    }

    // ── Perguntas prontas por aba (camada 1: regra, sem modelo de linguagem, sem servidor) ─────
    const FONTE_ML = 'Fonte: Mercado Livre.';
    const PERGUNTAS = {
        promo: [
            ['Por que esta é a melhor?', () => {
                const r = ($('#listaPromo')._lista || []).find(x => x.rec) || null;
                if (!r) return { linhas: ['Nenhum produto da lista tem custo e proposta ao mesmo tempo. Informe o custo de um produto com proposta para eu comparar.'], fonte: FONTE_PROMO_TXT };
                return P.explicaPromo(r.props, r.rec, cfg, r.f.titulo);
            }],
            ['E se minha meta for X%?', () => 'meta'],
            ['Quais dão prejuízo?', () => {
                const t = snap ? snap.familias.map(f => resumoFamilia(f)).filter(r => r.classe === 'prejuizo') : [];
                return { linhas: [t.length ? `${SHC.qtd(t.length, 'produto dá', 'produtos dão')} prejuízo em todas as propostas: ` + t.slice(0, 5).map(r => curtoTxt(r.f.titulo, 40)).join('; ') + (t.length > 5 ? ' e mais ' + (t.length - 5) : '') + '.' : 'Nenhum produto com custo informado dá prejuízo em todas as propostas.', 'Produtos sem custo não entram nesta conta.'], fonte: FONTE_PROMO_TXT };
            }],
            ['De onde vêm os números?', () => ({ linhas: ['Preço, tarifa, frete e “você recebe” são os que o próprio Mercado Livre mostra na Central de promoções.', 'Custo e imposto são os que você informou. Sobra = você recebe − custo − outros − imposto.', 'O preço mínimo para a meta é estimativa do Copiloto.'], fonte: FONTE_PROMO_TXT })],
        ],
        frete: [
            ['Por que o frete subiu?', () => {
                const pa = (freteHist && freteHist.porAnuncio) || {}, cob = P.temFreteCob(freteHist), semLer = P.freteSemLeitura(freteHist);
                const FT = 'Fonte: Faturamento do Mercado Livre (frete cobrado em cada pedido)', FL = 'Fonte: lista de Anúncios do Mercado Livre';
                if (freteDet) { const it = itens.find(x => x.itemId === freteDet); if (it) return P.explicaFrete(it, P.historicoFrete(fretes[it.itemId]), pa[it.itemId] || null); }
                const sub = linhasFrete().filter(l => l.subiu).sort((a, b) => varDe(b) - varDe(a));
                if (!sub.length) return { linhas: [semLer ? semLer + ': a comparação com os 30 dias anteriores fica para depois.'
                    : cob ? 'Nenhum anúncio teve o frete aumentado: últimos 30 dias contra os 30 dias anteriores.' : 'Nenhum anúncio teve o frete aumentado até agora. O frete de cada pedido aparece depois da próxima sincronização (Faturamento do ML).'],
                    fonte: (cob ? FT : FL) + '.' };
                const pelaFatura = l => l.fa && l.fa.subiu && l.fa.ult30 && l.fa.ant30;
                return { linhas: sub.slice(0, 4).map(l => pelaFatura(l)
                    ? `${curtoTxt(l.it.titulo, 40)}: frete típico por pedido de ${SHC.moeda(l.fa.ant30.tipico)} (30 dias anteriores) para ${SHC.moeda(l.fa.ult30.tipico)} (últimos 30 dias, ${SHC.qtd(l.fa.ult30.pedidos, 'pedido', 'pedidos')}).`
                    : `${curtoTxt(l.it.titulo, 40)}: de ${SHC.moeda(l.h.anterior)} para ${SHC.moeda(l.h.atual)} em ${P.dataBr(l.h.desde)} (lista de Anúncios do ML).`)
                    .concat('O ML não mostra o motivo nesta tela. Abra um anúncio para ver o histórico e o texto do chamado.'),
                    fonte: [sub.some(pelaFatura) ? FT : '', sub.some(l => !pelaFatura(l)) ? FL : ''].filter(Boolean).join(' · ') + '.' };
            }],
            ['Quanto paguei a mais?', () => {
                const rk = itens.some(it => Object.keys(vendas[it.itemId] || {}).length) ? P.rankingFrete(itens, vendas) : null;
                if (!rk) return { linhas: ['Ainda não disponível: as vendas entram na próxima etapa da sincronização. Sem vendas, não dá para saber quanto foi pago a mais.'], fonte: '' };
                return { linhas: [`De ${P.nomeMes(rk.desde)} a ${P.nomeMes(rk.mes)}: ${SHC.moeda(rk.total12)} de lucro perdido com frete maior que o de antes, em ${SHC.qtd(rk.grupos.length, 'SKU', 'SKUs')}.`, `Só em ${P.nomeMes(rk.mes)}: ${SHC.moeda(rk.total)}.`, CONTA_FRETE + ' Só com frete por sua conta.'], fonte: 'Fonte: Faturamento do Mercado Livre.' };
            }],
            ['De onde vem o frete?', () => ({ linhas: ['O frete de cada pedido vem do Faturamento do Mercado Livre: o que o ML cobrou de você em cada venda. Já na primeira sincronização o Copiloto lê os últimos 30 dias e compara com os 30 dias anteriores.',
                'O frete do anúncio hoje é o custo de envio que o ML mostra na lista de Anúncios, no preço atual. É com ele que cada pedido é conciliado.', 'Vendas com frete pago pelo comprador ficam fora das contas.'], fonte: 'Fonte: Faturamento e lista de Anúncios do Mercado Livre.' })],
            ['Como peço a revisão?', () => ({ linhas: ['Abra o anúncio cujo frete subiu. No fim da tela há um texto pronto com as datas e os valores.', 'Marque a caixa das medidas só se você realmente não mudou peso, medidas nem embalagem.', 'Copie e cole no atendimento do Mercado Livre. O Copiloto não envia nada por você.'], fonte: '' })],
        ],
        catalogo: [
            ['Quais SKUs estão sem custo?', () => P.respostaSemCusto(resumos, skusComPromo())],
            ['Quais dão prejuízo?', () => P.respostaPrejuizo(resumos)],
            ['O frete entra no custo?', () => ({ linhas: ['Não. O frete já vem do Mercado Livre e é descontado antes do “você recebe”. No custo vai só o que você paga no produto.'], fonte: FONTE_ML })],
            ['Por que o custo é por SKU?', () => ({ linhas: ['O mesmo produto pode ter vários anúncios (Clássico, Premium, variações). Você digita o custo uma vez no SKU e ele vale para todos.', 'Em cada canal mudam só a comissão e a conta final.'], fonte: '' })],
        ],
    };
    const FONTE_PROMO_TXT = 'Fonte: preço, tarifa, frete e “você recebe” = Mercado Livre · custo e imposto = seus.';
    function skusComPromo() {
        const s = new Set();
        const noRetrato = new Set(itens.map(x => x.itemId));
        if (snap) snap.propostas.forEach(p => { if (skuDe[p.itemId]) s.add('sku:' + skuDe[p.itemId]); else if (noRetrato.has(p.itemId)) s.add('mlb:' + p.itemId); });
        return s;
    }
    function montaPerguntas() {
        Object.keys(PERGUNTAS).forEach(a => {
            const box = document.createElement('div');
            box.className = 'ia';
            box.innerHTML = '<div class="chips"></div><div class="sim" hidden><label>Meta de</label><input class="inp" inputmode="decimal" placeholder="15"><span>%</span><button class="bt leve">Ver</button></div><div class="ia-resp" hidden></div>';
            const chips = box.querySelector('.chips'), resp = box.querySelector('.ia-resp'), sim = box.querySelector('.sim');
            PERGUNTAS[a].forEach(([txt, fn]) => {
                const b = document.createElement('button');
                b.className = 'chip'; b.textContent = txt;
                b.addEventListener('click', () => {
                    const r = fn();
                    if (r === 'meta') { sim.hidden = false; mostraResposta(resp, null); sim.querySelector('input').focus(); return; }
                    sim.hidden = true; mostraResposta(resp, r);
                    if (a === 'promo') marcaPromos();
                });
                chips.appendChild(b);
            });
            const rodaSim = () => {
                const m = SHC.num(sim.querySelector('input').value);
                if (m === null || m < 0 || m > 90) { sim.querySelector('input').style.borderColor = '#DC2626'; return; }
                sim.querySelector('input').style.borderColor = '';
                const fams = snap ? snap.familias.map(f => { const props = propsPorFam[f.chave] || [], c = custoFam[f.chave] ? custoFam[f.chave].dados : null; return { props, custoDe: p => custoDaProp(p) || c }; }) : [];
                mostraResposta(resp, P.simulaMeta(fams, cfg, m));
            };
            sim.querySelector('button').addEventListener('click', rodaSim);
            sim.querySelector('input').addEventListener('keydown', e => { if (e.key === 'Enter') rodaSim(); });
            const antes = { promo: '#listaPromo', frete: '#listaFrete', catalogo: '#listaCat' }[a];
            $(antes).parentElement.insertBefore(box, $(antes));
        });
    }
    // "Conferir as promoções" (guia) fica feito quando o seller usa a aba Promoções com dados.
    function marcaPromos() { if (snap && snap.familias.length && !guia.feitos.promos) SHC.salvarGuia({ feitos: { promos: SHC.hoje() } }); }

    // Botão e seção da aba em uso (também na abertura do painel, com a aba lembrada: o HTML vem com a Geral marcada).
    function marcaAba() {
        document.querySelectorAll('#abas button').forEach(x => x.classList.toggle('on', x.dataset.a === aba));
        document.querySelectorAll('.aba').forEach(s => s.classList.toggle('on', s.id === aba));
        $('#st').classList.toggle('so-selo', aba === 'geral');   // na Geral a barra e a etapa já estão no cartão do topo: o selo não repete
    }
    function abreAba(a) {
        aba = P.ABAS.indexOf(a) >= 0 && SHC.moduloLigado(cfg, a) ? a : 'geral';   // v2.8: aba de módulo desligado nunca abre
        LS.gravar('shc:painel:aba', aba);
        if (aba === 'full' && !guia.feitos.full) SHC.salvarGuia({ feitos: { full: SHC.hoje() } }).catch(() => {});   // guia: aba Full aberta
        marcaAba();
        desenhaTopoAba();
        desenhaAba();
    }
    // v2.8: esconde do topo os botões dos módulos que o seller desligou em Ajustes; se a aba aberta acabou de sumir, volta pra Geral.
    function atualizaAbasVisiveis() {
        const vis = new Set(P.abasVisiveis(cfg));
        document.querySelectorAll('#abas button[data-a]').forEach(b => { b.hidden = !vis.has(b.dataset.a); });
        if (!vis.has(aba)) abreAba('geral');
    }

    // ── Eventos ──
    $('#abas').addEventListener('click', e => {
        const b = e.target.closest('button[data-a]');
        if (b) abreAba(b.dataset.a);
    });
    // Aviso no topo (erro): some sozinho depois de ms (0 = fica até a próxima ação).
    let avisoTimer = null;
    function avisa(t, ms) {
        const a = $('#aviso');
        clearTimeout(avisoTimer);
        a.textContent = t || ''; a.hidden = !t;
        if (t && ms) avisoTimer = setTimeout(() => { a.hidden = true; }, ms);
    }
    // "Sincronizar agora": a tela marca "sincronizando" na hora; se em 20 s o fundo não bater (shc:status 'sincronizando' com batimento
    // depois do clique) nem responder {ok:true, iniciou|emCurso}, volta ao status de antes e pede para tentar de novo (nunca fica parada em 0%).
    let syncEspera = null, syncFalhou = false;
    function sincronizar() {
        if (syncEspera) return;
        const clique = Date.now();
        syncEspera = { clique, antes: status, respondeu: false, timer: setTimeout(semResposta, 20000) };
        syncFalhou = false; avisa('');
        status = Object.assign({}, status, { estado: 'sincronizando', batimento: clique });
        desenhaStatus(); desenhaGuia();
        let p;
        try { p = chrome.runtime.sendMessage({ acao: 'sincronizar' }); } catch (e) { p = null; }
        Promise.resolve(p).then(r => {
            if (!syncEspera || syncEspera.clique !== clique) return;
            if (r && r.ok) syncEspera.respondeu = true;   // o andamento chega pelo shc:status
            else if (r && r.ok === false) semResposta();
        }, () => { /* sem resposta: espera a batida até os 20 s */ });
    }
    function semResposta() {
        const e = syncEspera;
        if (!e) return;
        clearTimeout(e.timer); syncEspera = null;
        if (e.respondeu) return;
        if (status.batimento === e.clique) status = e.antes;   // ainda é a marca da tela (nada novo do fundo): volta ao de antes
        syncFalhou = true;
        avisa('O Copiloto não respondeu. Clique em Tentar de novo.');
        desenhaStatus(); desenhaGuia();
    }
    // shc:status lido do armazenamento. Batida (ou fim) depois do clique = o fundo está lendo ou já terminou: a espera e o aviso acabam.
    // Sem batida nova durante a espera, a tela continua com a marca "sincronizando" do clique.
    function statusDoFundo(st) {
        const e = syncEspera;
        if (e && !((st.batimento || 0) > e.clique || (st.fim || 0) > e.clique)) return status;
        if (e) { clearTimeout(e.timer); syncEspera = null; }
        if (syncFalhou && st.estado === 'sincronizando' && !P.syncParado(st)) { syncFalhou = false; avisa(''); }
        return st;
    }
    $('#sincronizar').addEventListener('click', sincronizar);

    // ── Tela cheia / Minimizar: o Chrome não deixa mudar a largura do painel lateral; a tela cheia é o MESMO painel numa aba. ──
    const TELA = location.hash === '#tela';
    let minhaJanela = null, minhaAba = null;
    try { if (chrome.windows && chrome.windows.getCurrent) Promise.resolve(chrome.windows.getCurrent()).then(w => { minhaJanela = w ? w.id : null; }, () => {}); } catch (e) { /* sem janela */ }
    try { if (TELA && chrome.tabs && chrome.tabs.getCurrent) Promise.resolve(chrome.tabs.getCurrent()).then(t => { minhaAba = t ? t.id : null; }, () => {}); } catch (e) { /* sem aba */ }
    function largura() {
        const larga = TELA || (typeof innerWidth === 'number' && innerWidth >= 900);
        if (document.body && document.body.classList) document.body.classList.toggle('larga', larga);
    }
    largura();
    try { addEventListener('resize', largura); } catch (e) { /* sem janela */ }
    if (TELA) { $('#telaCheia').hidden = true; $('#minimizar').hidden = true; $('#voltarLateral').hidden = false; }
    async function telaCheia() {
        const url = chrome.runtime.getURL('painel-lateral.html#tela');
        try {   // já aberta? volta para ela em vez de abrir outra
            const cs = chrome.runtime.getContexts ? await chrome.runtime.getContexts({ contextTypes: ['TAB'] }) : [];
            const c = (cs || []).find(x => x && x.tabId > 0 && String(x.documentUrl || '').indexOf(url) === 0);
            if (c) { await chrome.tabs.update(c.tabId, { active: true }); if (chrome.windows && c.windowId > 0) await chrome.windows.update(c.windowId, { focused: true }); return; }
        } catch (e) { /* abre uma nova */ }
        chrome.tabs.create({ url });
    }
    // Chrome sem sidePanel.close (antes do 141): window.close() pode não fechar o painel lateral; se o painel continuar aberto, diz como fechar.
    function fechaJanela() {
        window.close();
        setTimeout(() => avisa('Para fechar, clique no X no alto do painel lateral.', 8000), 600);
    }
    function minimizar() {
        try { if (chrome.sidePanel && chrome.sidePanel.close && minhaJanela !== null) { Promise.resolve(chrome.sidePanel.close({ windowId: minhaJanela })).catch(fechaJanela); return; } } catch (e) { /* fecha a janela do painel */ }
        fechaJanela();
    }
    // Precisa do clique (gesto): sidePanel.open sai sem await antes; depois fecha esta aba.
    function voltarLateral() {
        let p = null;
        try { if (chrome.sidePanel && chrome.sidePanel.open && minhaJanela !== null) p = chrome.sidePanel.open({ windowId: minhaJanela }); } catch (e) { p = null; }
        Promise.resolve(p).then(() => { if (minhaAba !== null && chrome.tabs && chrome.tabs.remove) chrome.tabs.remove(minhaAba); else window.close(); },
            () => avisa('Não consegui abrir o painel lateral. Clique no ícone do Copiloto na barra do Chrome.', 8000));
    }
    $('#telaCheia').addEventListener('click', telaCheia);
    $('#minimizar').addEventListener('click', minimizar);
    $('#voltarLateral').addEventListener('click', voltarLateral);
    $('#busca').addEventListener('input', e => { busca = e.target.value; desenhaPromo(); });
    $('#buscaFrete').addEventListener('input', e => { freteBusca = e.target.value; desenhaFrete(); });
    $('#buscaCat').addEventListener('input', e => { catBusca = e.target.value; desenhaCatalogo(); });

    // Dias de cobertura do Full (padrão 30): só muda a conta na tela, nada é salvo.
    function mudaDias() {
        const inp = $('#fullDias'), d = SHC.num(inp.value);
        if (!(d >= 1 && d <= 180)) { inp.style.borderColor = '#DC2626'; return; }
        fullDias = Math.round(d); inp.blur(); desenhaFull();
    }
    async function salvarCustoFamilia(chave) {
        const inp = document.querySelector(`[data-custo="${CSS.escape(chave)}"]`), v = SHC.num(inp.value);
        if (!(v > 0)) { inp.style.borderColor = '#DC2626'; inp.focus(); return; }
        const f = snap.familias.find(x => x.chave === chave);
        const alvo = P.alvoCusto(skusFam[chave] || [], ((f && f.anuncios) || []).concat((propsPorFam[chave] || []).map(p => p.itemId)), custoFam[chave], chave);
        if (!alvo) return;
        editando = null;
        inp.blur();   // com o foco no campo, o redesenho depois de salvar seria pulado
        try { await P.gravarCusto(alvo, v, f ? f.titulo : ''); } catch (e) { editando = chave; return falhaGravar(e); }
        marcaPromos();
    }
    // bt = o botão clicado: o mesmo SKU pode ter campo no cartão de cima e na lista (lê o campo ao lado do botão).
    async function salvarCustoGrupo(chave, bt) {
        const perto = bt && bt.parentElement && bt.parentElement.querySelector && bt.parentElement.querySelector('[data-csku]');
        const inp = perto || document.querySelector(`[data-csku="${CSS.escape(chave)}"]`), v = SHC.num(inp.value);
        if (!(v > 0)) { inp.style.borderColor = '#DC2626'; inp.title = P.MSG_CUSTO; avisa(P.MSG_CUSTO, 8000); inp.focus(); return; }   // só a borda vermelha não diz o que fazer
        const g = grupos.find(x => x.chave === chave);
        if (!g) return;
        catEditando = null;
        inp.blur();
        // Sem SKU: grava no anúncio (MLB), que a leitura procura antes da família.
        try { await P.gravarCusto(P.alvoCusto(g.sku ? [g.sku] : [], [g.itens[0].itemId], null), v, g.titulo); } catch (e) { catEditando = chave; return falhaGravar(e); }
    }
    // Gravação que falhou (ex.: armazenamento do Chrome cheio): avisa em vez de falhar em silêncio.
    function falhaGravar(e) {
        avisa('Não consegui salvar. Tente de novo; se continuar, feche e abra o Chrome.' + (e && e.message ? ' (' + String(e.message).slice(0, 80) + ')' : ''), 8000);
        desenhaAba();
    }
    // inp = o campo do PRÓPRIO cartão (o mesmo SKU pode aparecer em mais de um cartão do Full).
    async function salvarMinSku(inp) {
        if (!inp) return;
        const sku = inp.dataset.minSku, txt = String(inp.value || '').trim(), d = SHC.num(txt);
        if (txt && !(d >= 1 && d <= 100000)) { inp.style.borderColor = '#DC2626'; inp.focus(); return; }
        inp.blur();
        try { await P.gravarMinSku(sku, txt ? d : 0); } catch (e) { return falhaGravar(e); }
    }

    document.body.addEventListener('click', async e => {
        const t = e.target;
        // Recolher/abrir (lembrado na sessão) e ir para a aba de um módulo (Geral)
        const vr = t.closest('[data-ver]');
        if (vr) {
            const k = vr.dataset.ver;
            if (k === 'cat:lista' && (catFiltro || catBusca.trim())) { catFiltro = ''; catBusca = ''; $('#buscaCat').value = ''; if (aberto(k)) alterna(k); }
            else alterna(k);
            if (/^al:/.test(k)) desenhaTopoAba(); else desenhaAba();
            if (k === 'geral:semanal' && aberto(k) && (!semanal || semanal.novo)) pedirSemanal(false);   // abriu "Ver resumo": pede ao fundo (e tira o "novo")
            return;
        }
        // v2.7: resumo da semana (copiar / WhatsApp / gerar de novo), contas juntas e próxima remessa
        if (t.closest('[data-semanal-novo]')) { semanal = null; desenhaGeral(); pedirSemanal(true); return; }
        if (t.closest('[data-semanal-copiar]')) {
            if (!semanal) return;
            try { await navigator.clipboard.writeText(semanal.texto); semanalMsg = '✓ Texto copiado.'; } catch (e) { semanalMsg = 'Não consegui copiar sozinho: selecione o texto e copie.'; }
            desenhaGeral(); return;
        }
        if (t.closest('[data-semanal-zap]')) { if (semanal && P.waLinkOk(semanal.waLink)) chrome.tabs.create({ url: semanal.waLink }); return; }
        if (t.closest('[data-trocar-conta]')) { chrome.tabs.create({ url: P.URL_TROCAR_CONTA }); return; }
        if (t.closest('[data-sim-ver]')) { document.querySelectorAll('[data-sim-sku]').forEach(i => { simQtd[i.dataset.simSku] = i.value; }); desenhaFull(); return; }
        // Faturamento por família (Geral): mês, Faturamento | Lucro, família escolhida, "Por que caiu?", mais SKUs e o anúncio no ML
        const fms = t.closest('[data-fam-mes]');
        if (fms) { famMes = fms.dataset.famMes === 'anterior' ? 'anterior' : 'atual'; famLim = 10; famCausas.clear(); desenhaGeral(); return; }
        const fmo = t.closest('[data-fam-modo]');
        if (fmo) { famModo = fmo.dataset.famModo === 'lucro' ? 'lucro' : 'bruto'; desenhaGeral(); return; }
        const fse = t.closest('[data-fam-sel]');
        if (fse) { famSel = String(fse.dataset.famSel || ''); famLim = 10; famCausas.clear(); desenhaGeral(); return; }
        const fca = t.closest('[data-fam-causa]');
        if (fca) { const k = fca.dataset.famCausa; if (famCausas.has(k)) famCausas.delete(k); else famCausas.add(k); desenhaGeral(); return; }
        if (t.closest('[data-fam-mais]')) { famLim += 10; desenhaGeral(); return; }
        const aan = t.closest('[data-abrir-anuncio]');
        if (aan && /^MLB\d{6,14}$/.test(aan.dataset.abrirAnuncio)) { chrome.tabs.create({ url: 'https://produto.mercadolivre.com.br/MLB-' + aan.dataset.abrirAnuncio.slice(3) }); return; }
        const ia = t.closest('[data-ir-aba]');
        if (ia && P.ABAS.indexOf(ia.dataset.irAba) >= 0) { abreAba(ia.dataset.irAba); $('.corpo').scrollTop = 0; return; }
        if (t.closest('[data-abrir-posvenda]')) { chrome.tabs.create({ url: SHC.POSVENDA_URL }); return; }
        const ccp = t.closest('[data-conc-copiar]');
        if (ccp) { await copiarConc(+ccp.dataset.concCopiar); return; }
        const ncp = t.closest('[data-nfe-copiar]');
        if (ncp && /^\d{44}$/.test(ncp.dataset.nfeCopiar)) { await copiarNfe(ncp.dataset.nfeCopiar); return; }
        if (t.closest('[data-fiscal-agora]')) { talvezFiscal(true); desenhaSaude(); return; }
        // Guia (cartão do topo)
        const ga = t.closest('[data-guia-acao]');
        if (ga && ACAO_GUIA[ga.dataset.guiaAcao]) { ACAO_GUIA[ga.dataset.guiaAcao](); return; }
        const gp = t.closest('[data-guia-pular]');
        if (gp) { await pularGuia(gp.dataset.guiaPular); return; }
        if (t.closest('[data-guia-lista]')) { guiaLista = !guiaLista; desenhaGuia(); return; }
        if (t.closest('[data-sync-lista]')) { syncAberta = /fechada/.test($('#syncLista').className); desenhaStatus(); return; }
        if (t.closest('[data-sync]')) { sincronizar(); return; }
        const kpi = t.closest('[data-filtro]');
        if (kpi && kpi.closest('#promo')) { filtro = filtro === kpi.dataset.filtro ? '' : kpi.dataset.filtro; if (filtro && !aberto('promo:lista')) alterna('promo:lista'); desenhaPromo(); return; }
        if (t.closest('[data-abrir-ml]')) { chrome.tabs.create({ url: URL_PROMOS }); return; }
        if (t.closest('[data-abrir-anuncios]')) { chrome.tabs.create({ url: URL_ANUNCIOS }); return; }
        if (t.closest('[data-abrir-competindo]')) { chrome.tabs.create({ url: URL_COMPETINDO }); return; }
        const cfs = t.closest('[data-conf-sim]');
        if (cfs) { await conferirSim(cfs.dataset.confSim); return; }
        const as = t.closest('[data-abrir-sim]');
        if (as && /^MLB\d{6,14}$/.test(as.dataset.abrirSim)) { chrome.tabs.create({ url: SHC.simLink(as.dataset.abrirSim) }); return; }
        const aa = t.closest('[data-abrir-afil]');
        if (aa && URL_AFIL[aa.dataset.abrirAfil]) { chrome.tabs.create({ url: URL_AFIL[aa.dataset.abrirAfil] }); return; }
        if (t.closest('[data-comp]')) { compAberto = !compAberto; desenhaCatalogo(); return; }
        const at = t.closest('[data-atalho]');   // páginas da própria extensão (Ads por SKU, Fechamento do mês)
        if (at && ATALHOS.indexOf(at.dataset.atalho) >= 0) { chrome.tabs.create({ url: chrome.runtime.getURL(at.dataset.atalho) }); return; }
        if (t.closest('[data-ir-full]')) { abreAba('full'); return; }
        // Saúde dos anúncios (só navegação e leitura; o robô só grava a ordem das fotos pelo fundo, com as travas dele)
        if (t.closest('[data-ir-saude]')) { abreAba('saude'); return; }
        if (t.closest('[data-abrir-fiscal]')) { chrome.tabs.create({ url: SHC.FISCAL_EDITOR }); return; }
        const afo = t.closest('[data-abrir-fotos]'), mlb = x => /^MLB\d{6,14}$/.test(String(x || ''));
        if (afo && mlb(afo.dataset.abrirFotos)) { chrome.tabs.create({ url: SHC.fotosLink(afo.dataset.abrirFotos) }); return; }
        if (t.closest('[data-perm-fotos]')) { permitirFotos(); return; }   // a permissão é pedida já no clique
        if (t.closest('[data-saude-agora]')) { await lerSaudeAgora(); return; }
        // Medidas da embalagem: abrir o SKU, conferir 1 anúncio agora (só leitura), abrir "Alterar anúncio" e copiar o texto do chamado.
        const msk = t.closest('[data-med-sku]');
        if (msk) { medSku = medSku === msk.dataset.medSku ? '' : msk.dataset.medSku; desenhaSaude(); return; }
        const mag = t.closest('[data-med-agora]');
        if (mag && mlb(mag.dataset.medAgora)) { await medidasAgora(mag.dataset.medAgora); return; }
        const amd = t.closest('[data-abrir-med]');
        if (amd && mlb(amd.dataset.abrirMed)) { chrome.tabs.create({ url: P.medLink(amd.dataset.abrirMed) }); marcaMedida(amd.dataset.abrirMed, 'alterar'); return; }
        const mfu = t.closest('[data-med-fui]'), fui = mfu ? String(mfu.dataset.medFui).split('|') : [];
        if (mfu && mlb(fui[0]) && +fui[1] > 0) { await marcaMedida(fui[0], 'fui_eu', +fui[1]); return; }
        const mcp = t.closest('[data-med-copiar]');
        if (mcp) { await copiarChamadoMed(+mcp.dataset.medCopiar); return; }
        const sve = t.closest('[data-saude-ver]');
        if (sve && sve.dataset.saudeVer in saudeVer) { saudeVer[sve.dataset.saudeVer] = !saudeVer[sve.dataset.saudeVer]; limite.saude = LIM; desenhaSaude(); return; }
        const ffx = t.closest('[data-foto-faixa]');
        if (ffx) { fotoFaixa = fotoFaixa === ffx.dataset.fotoFaixa ? '' : ffx.dataset.fotoFaixa; saudeVer.fotos = false; limite.saude = LIM; desenhaSaude(); return; }
        const rit = t.closest('[data-robo-item]');
        if (rit && mlb(rit.dataset.roboItem)) {
            const id = rit.dataset.roboItem, novo = Object.assign({}, cfg.robo_itens || {});
            if (novo[id]) delete novo[id]; else novo[id] = true;
            await mudaRobo({ robo_itens: novo }); return;
        }
        if (t.closest('#roboLigado')) { await mudaRoboPromo({ ligado: !!t.closest('#roboLigado').checked }); return; }
        if (t.closest('[data-robopromo-margem]')) { await salvarMargemRobo(); return; }
        if (t.closest('[data-robo-geral]')) { await mudaRobo({ robo_ligado: !cfg.robo_ligado }); return; }
        const rmo = t.closest('[data-robo-modo]');
        if (rmo && SHC.ROBO_ESCRITA_CONFERIDA === true && ['sugerir', 'automatico'].indexOf(rmo.dataset.roboModo) >= 0) { await mudaRobo({ robo_modo: rmo.dataset.roboModo }); return; }
        if (t.closest('[data-robo-salvar]')) { await salvarRegrasRobo(); return; }
        const jtr = t.closest('[data-ja-troquei]');
        if (jtr && mlb(jtr.dataset.jaTroquei)) { await jaTroquei(jtr.dataset.jaTroquei); return; }
        if (t.closest('[data-robo-rodar]')) { await roboAcao({ acao: 'robo_rodar_agora' }); return; }
        const rds = t.closest('[data-robo-desfazer]');
        if (rds && mlb(rds.dataset.roboDesfazer)) { await roboAcao({ acao: 'robo_desfazer', itemId: rds.dataset.roboDesfazer }); return; }
        const fc = t.closest('[data-fclasse]');
        if (fc) { fullClasse = fullClasse === fc.dataset.fclasse ? '' : fc.dataset.fclasse; limite.full = LIM; desenhaFull(); return; }
        const mu = t.closest('[data-min-usar]');   // "Usar" a sugestão de mínimo (15 dias de venda)
        if (mu) { try { await P.gravarMinSku(mu.dataset.minUsar, SHC.num(mu.dataset.minN)); } catch (err) { falhaGravar(err); } return; }
        const ms = t.closest('[data-min-salvar]');
        if (ms) { await salvarMinSku(ms.parentElement.querySelector('[data-min-sku]')); return; }
        const af = t.closest('[data-abrir-full]');
        if (af && URL_FULL[af.dataset.abrirFull]) { chrome.tabs.create({ url: URL_FULL[af.dataset.abrirFull] }); return; }
        const fx = t.closest('[data-full-expl]');
        if (fx) { const k = fx.dataset.fullExpl; if (fullExpl.has(k)) fullExpl.delete(k); else fullExpl.add(k); desenhaFull(); return; }
        if (t.closest('[data-full-dias]')) { mudaDias(); return; }
        if (t.closest('[data-abrir-agenda]')) { chrome.tabs.create({ url: chrome.runtime.getURL('agenda-canal.html') }); return; }
        const ml = t.closest('[data-mais-linhas]');
        if (ml) { limite[ml.dataset.maisLinhas] += LIM; desenhaAba(); return; }
        if (t.closest('[data-ir-cat]')) { catFiltro = ''; abreAba('catalogo'); return; }
        const ab = t.closest('[data-abrir]');
        if (ab) { abertos.add(ab.dataset.abrir); desenhaPromo(); return; }
        const ed = t.closest('[data-editar]');
        if (ed) { editando = ed.dataset.editar; desenhaPromo(); const i = document.querySelector(`[data-custo="${CSS.escape(editando)}"]`); if (i) i.focus(); return; }
        const sv = t.closest('[data-salvar]');
        if (sv) { await salvarCustoFamilia(sv.dataset.salvar); return; }
        const ex = t.closest('[data-explique]');
        if (ex) { explicando = explicando === ex.dataset.explique ? null : ex.dataset.explique; marcaPromos(); desenhaPromo(); return; }
        const sm = t.closest('[data-sim]');
        if (sm) {
            const inp = document.querySelector(`[data-sim-meta="${CSS.escape(sm.dataset.sim)}"]`), m = SHC.num(inp.value);
            simMeta[sm.dataset.sim] = (m === null || m < 0 || m > 90) ? null : m;
            inp.blur(); desenhaPromo(); return;
        }
        // Custos no Catálogo: conectar o ERP (o mesmo fluxo de Ajustes) e a lista completa dos sem custo
        const erp = t.closest('[data-erp]');
        if (erp) { if (erp.dataset.erp !== 'tiny') { abrePagina('painel.html#erp'); return; } abreAba('ajustes'); abrirTiny(); const c = $('#cardCustos'); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'start' }); return; }
        if (t.closest('[data-sync-custos]')) {   // ERP conectado: o fundo importa de novo (só leitura) e responde o resumo
            custosMsg = 'Importando os custos do ERP…'; desenhaCatalogo();
            // Qual ERP: os que têm chave guardada (Tiny: token; Omie: appKey + appSecret); os dois → um depois do outro; nenhum → o fundo responde {semToken}.
            const erps = [];
            try { if (((await SHC.lerChave(SHC.TINY_CHAVE)) || {}).token) erps.push('tiny'); } catch (e) { /* sem chave */ }
            try { const o = await SHC.lerChave(SHC.OMIE_CHAVE); if (o && o.appKey && o.appSecret) erps.push('omie'); } catch (e) { /* sem chave */ }
            const partes = [];
            for (const erp of erps.length ? erps : [null]) {
                let r = null;
                try { r = await chrome.runtime.sendMessage(erp ? { acao: 'sincronizar_custos', erp } : { acao: 'sincronizar_custos' }); } catch (e) { r = null; }
                partes.push(r && r.ok ? '✓ ' + (r.resumo || 'Custos importados') + '.' : (r && r.semToken ? 'Conecte o Tiny ou o Omie primeiro: o custo entra sozinho.' : (r && r.msg) || 'Não consegui importar agora. Tente de novo em alguns minutos.'));
            }
            custosMsg = partes.join(' ');
            desenhaCatalogo(); return;
        }
        if (t.closest('[data-sem-todos]')) { catFiltro = catFiltro === 'sem_custo' ? '' : 'sem_custo'; limite.catalogo = LIM; desenhaCatalogo(); return; }
        // Competição e Ads (Catálogo)
        const cg = t.closest('[data-cgrupo]');
        if (cg) { compGrupo = compGrupo === cg.dataset.cgrupo ? '' : cg.dataset.cgrupo; compAberto = true; desenhaCatalogo(); return; }
        const cc = t.closest('[data-conc]');
        if (cc) { verConcorrentes(cc.dataset.conc); return; }   // a permissão é pedida já no clique, antes de qualquer await
        const af2 = t.closest('[data-adsf]');
        if (af2) { adsFiltro = af2.dataset.adsf; desenhaAds(); return; }
        // Frete
        if (t.closest('[data-ped-todos]')) { pedTodos = !pedTodos; desenhaFrete(); return; }
        const ff = t.closest('[data-ffiltro]');
        if (ff) { freteFiltro = freteFiltro === ff.dataset.ffiltro ? '' : ff.dataset.ffiltro; if (freteFiltro && !aberto('frete:lista')) alterna('frete:lista'); desenhaFrete(); return; }
        const fd = t.closest('[data-frete-det]');
        if (fd) { freteDet = fd.dataset.freteDet; confirmouMedidas = false; freteExpl = false; pedTodos = false; if (aba !== 'frete') abreAba('frete'); else desenhaFrete(); $('.corpo').scrollTop = 0; return; }
        if (t.closest('[data-voltar-frete]')) { freteDet = null; desenhaFrete(); return; }
        if (t.closest('[data-explique-frete]')) { freteExpl = !freteExpl; const a = $('#listaFrete'); mostraResposta($('#respFreteDet'), freteExpl ? P.explicaFrete(a._item, a._hist, a._fa) : null); return; }
        if (t.id === 'copiar') { navigator.clipboard.writeText($('#txtChamado').value).then(() => { $('#copiar').textContent = '✓ Copiado'; }); return; }
        // Catálogo
        const cf = t.closest('[data-cfiltro]');
        if (cf) { catFiltro = catFiltro === cf.dataset.cfiltro ? '' : cf.dataset.cfiltro; desenhaCatalogo(); return; }
        const ce = t.closest('[data-ceditar]');
        if (ce) { catEditando = ce.dataset.ceditar; desenhaCatalogo(); const i = document.querySelector(`[data-csku="${CSS.escape(catEditando)}"]`); if (i) i.focus(); return; }
        const cs = t.closest('[data-csalvar]');
        if (cs) { await salvarCustoGrupo(cs.dataset.csalvar, cs); return; }
    });
    // "Regras do robô" aberto/fechado pelo seller (toggle não sobe: escuta na captura).
    document.body.addEventListener('toggle', e => { if (e.target && e.target.id === 'regrasRobo') regrasAbertas = !!e.target.open; }, true);
    document.body.addEventListener('change', e => {
        if (e.target.id === 'confMedidas') { confirmouMedidas = e.target.checked; const a = $('#listaFrete'); $('#txtChamado').value = P.textoChamado(a._item, a._hist, vendas[a._item.itemId] || {}, confirmouMedidas, medidasDe(a._item)); }
    });
    document.body.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        if (e.target.matches('[data-custo]')) { const b = document.querySelector(`[data-salvar="${CSS.escape(e.target.dataset.custo)}"]`); if (b) b.click(); }
        if (e.target.matches('[data-csku]')) { const b = (e.target.parentElement && e.target.parentElement.querySelector('[data-csalvar]')) || document.querySelector(`[data-csalvar="${CSS.escape(e.target.dataset.csku)}"]`); if (b) b.click(); }
        if (e.target.id === 'fullDias') mudaDias();
        if (e.target.matches('[data-min-sku]')) salvarMinSku(e.target);
        if (REGRAS_ROBO.indexOf(e.target.id) >= 0) salvarRegrasRobo();
        if (e.target.id === 'margemRobo') salvarMargemRobo();
        if (e.target.matches('[data-sim-meta]')) { const b = document.querySelector(`[data-sim="${CSS.escape(e.target.dataset.simMeta)}"]`); if (b) b.click(); }
    });
    $('#salvarCfg').addEventListener('click', async () => {
        const campos = ['imposto_pct', 'margem_alvo_pct'], txt = {};
        campos.forEach(k => { txt[k] = $('#' + k).value; $('#' + k).style.borderColor = ''; });
        const r = P.lerAjustes(txt), errs = Object.keys(r.erros), meta = P.lerMeta($('#meta_mes').value);
        $('#meta_mes').style.borderColor = '';
        if (meta.erro) { r.erros.meta_mes = meta.erro; errs.push('meta_mes'); }
        if (errs.length) { errs.forEach(k => { $('#' + k).style.borderColor = '#DC2626'; }); $('#okCfg').textContent = ''; $('#erroCfg').textContent = errs.map(k => r.erros[k]).join(' '); return; }
        $('#erroCfg').textContent = '';
        try { await SHC.salvarCfg(Object.assign(r.patch, { meta_mes: meta.valor })); } catch (e) { return falhaGravar(e); }
        $('#okCfg').textContent = '✓ Salvo';
        setTimeout(() => { $('#okCfg').textContent = ''; }, 2500);
    });
    $('#abrirPainel').addEventListener('click', () => abrePagina('painel.html#custos'));
    // v2.7: apelidos das contas (objeto NOVO em cfg.apelidos; vazio tira o apelido)
    $('#salvarApelidos').addEventListener('click', async () => {
        const txt = {};
        document.querySelectorAll('[data-apelido]').forEach(i => { txt[i.dataset.apelido] = i.value; });
        try { cfg = await SHC.salvarCfg({ apelidos: P.lerApelidos(txt) }); } catch (e) { return falhaGravar(e); }
        $('#okApelidos').textContent = '✓ Salvo';
        setTimeout(() => { $('#okApelidos').textContent = ''; }, 2500);
        desenhaConta();
    });
    // v2.8: módulos que aparecem no dia a dia (objeto NOVO em cfg.modulos; desmarcado = false, marcado = sem a chave = ligado).
    $('#syncFundo').addEventListener('change', e => {
        const ligar = e.target.checked;
        let pedido;   // request/remove DENTRO do clique, antes de qualquer await (senão o Chrome recusa)
        try { pedido = ligar ? chrome.permissions.request(PERM_FUNDO) : chrome.permissions.remove(PERM_FUNDO); } catch (x) { pedido = Promise.resolve(false); }
        Promise.resolve(pedido).catch(() => false).then(ok => {
            if (!ok) avisa(ligar ? 'O Chrome não deixou ligar agora. Tente de novo.' : 'O Chrome não deixou desligar agora. Tente de novo.', 8000);
            return atualizaFundo();
        }).catch(() => {});
    });
    $('#salvarModulos').addEventListener('click', async () => {
        const modulos = {};
        P.MODULOS.forEach(m => { if (!$('#mod-' + m).checked) modulos[m] = false; });
        try { cfg = await SHC.salvarCfg({ modulos }); } catch (e) { return falhaGravar(e); }
        atualizaAbasVisiveis();
        $('#okModulos').textContent = '✓ Salvo';
        setTimeout(() => { $('#okModulos').textContent = ''; }, 2500);
    });
    // Seletor de conta no topo: outra conta ou "Todas as contas" → cartão no topo da Geral.
    $('#nomeConta').addEventListener('change', e => {
        const s = e.target.closest('#selConta');
        if (!s) return;
        const v = String(s.value || 'atual'), at = contasLista.find(c => c.atual);
        vista = v === 'todas' ? 'todas' : (at && at.sellerId === v ? 'atual' : v);
        if (aba !== 'geral') abreAba('geral'); else desenhaGeral();
        $('.corpo').scrollTop = 0;
    });

    // ── Tiny direto aqui (tiny.js, o mesmo fluxo do painel de custos): conectado → puxa com 1 clique; sem token → passo a passo
    // com o campo do token. Só lê o custo; o token só é guardado depois que o Tiny aceitou.
    let tinyToken = '', tinyRodando = false, tinyRecusado = false;
    const tinyMsg = (t, erro) => { const m = $('#tinyMsg'); m.textContent = t || ''; m.style.color = erro ? 'var(--verm)' : ''; };
    // pedido = chrome.permissions.request(...) feito DENTRO do clique, antes de qualquer await (senão o Chrome recusa).
    async function puxarTiny(pedido, token) {
        let deu = false;
        try { deu = await pedido; } catch (e) { deu = false; }
        if (!deu) return tinyMsg('Sem a permissão do Chrome o Copiloto não consegue ler o Tiny. Clique de novo e escolha “Permitir”.', true);
        if (tinyRodando) return;
        tinyRodando = true;
        ['#abrirTiny', '#tinyConectar'].forEach(x => { $(x).disabled = true; });
        tinyMsg('Lendo os produtos do Tiny…');
        $('#tinyProg').hidden = false; $('#tinyBarra').style.width = '0%'; $('#tinyPct').textContent = '';
        try {
            const produtos = await SHC.tinyPuxar(token, { fetch: (u, i) => fetch(u, i), espera: ms => new Promise(r => setTimeout(r, ms)),
                progresso: (pg, n) => { const pc = n ? Math.round(pg / n * 100) : 0; $('#tinyBarra').style.width = pc + '%'; $('#tinyPct').textContent = pc + '% · ' + pg + ' de ' + n + (n === 1 ? ' página' : ' páginas'); } });
            const r = await SHC.tinyGravar(produtos, 'tiny');
            await SHC.gravarChave(SHC.TINY_CHAVE, { token, ultima: Object.assign({ ts: Date.now() }, r) });
            tinyToken = token; tinyRecusado = false; $('#tinyToken').value = ''; $('#tinyBox').hidden = true;
            tinyMsg('✓ ' + SHC.tinyResumo(r) + '.');
        } catch (e) {
            tinyMsg((e && e.msg) || 'Não consegui ler o Tiny agora. Tente de novo em alguns minutos.', true);
            // Token trocado ou revogado no Tiny: volta a mostrar o campo para colar o token novo.
            if (e && (e.erro === 'token' || e.erro === 'acesso')) {
                tinyRecusado = true; tinyToken = '';
                $('#abrirTiny').textContent = 'Tiny · Conectar em 1 minuto';
                $('#tinyBox').hidden = false; $('#tinyToken').focus();
            }
        } finally {
            tinyRodando = false; $('#tinyProg').hidden = true;
            ['#abrirTiny', '#tinyConectar'].forEach(x => { $(x).disabled = false; });
        }
    }
    const TINY = () => ({ origins: [SHC.TINY_ORIGEM] });
    function abrirTiny() {
        if (tinyToken) return puxarTiny(chrome.permissions.request(TINY()), tinyToken);
        $('#tinyBox').hidden = false; $('#tinyToken').focus();
    }
    $('#abrirTiny').addEventListener('click', abrirTiny);
    $('#tinyConectar').addEventListener('click', () => {
        const token = $('#tinyToken').value.trim();
        if (token.length < 10 || /\s/.test(token)) return tinyMsg('Cole o token inteiro do Tiny (passo 2 acima).', true);
        puxarTiny(chrome.permissions.request(TINY()), token);
    });
    $('#tinyToken').addEventListener('keydown', e => { if (e.key === 'Enter') $('#tinyConectar').click(); });
    $('#abrirBling').addEventListener('click', () => abrePagina('painel.html#erp'));
    // Ajuda: WhatsApp do suporte e a apresentação
    $('#suporteZap').addEventListener('click', () => chrome.tabs.create({ url: SHC.SUPORTE_WHATSAPP }));
    $('#conhecerCopiloto').addEventListener('click', () => abrePagina('apresentacao.html'));

    // ── SellerHub: convite + a cópia dos custos (a mesma planilha do painel de custos: SKU, anúncio, custo, outros, origem) ──
    $('#conhecerSH').addEventListener('click', () => chrome.tabs.create({ url: 'https://especialistaemmarketplace.com.br/sellerhub/' }));
    $('#levarDados').addEventListener('click', async () => {
        try {
            const tudo = await SHC.lerTudo();
            // Custo do Tiny redigitado sai 'manual' (como no painel de custos), senão ao restaurar o Tiny troca.
            const orig = c => (c.origem === 'erp' && SHC.tinyDigitado && SHC.tinyDigitado(c) ? 'manual' : c.origem);
            const linhas = Object.values(tudo.custos).filter(c => SHC.num(c.custo) > 0).map(c => c.canal === 'sku'
                ? { sku: c.id, titulo: c.titulo || '', custo: c.custo, outros: c.outros, origem: orig(c) }
                : { canal: c.canal, id: c.id, titulo: c.titulo || '', custo: c.custo, outros: c.outros, frete: c.frete, tipo: c.tipo, origem: orig(c) });
            const url = URL.createObjectURL(new Blob([SHC.paraCSV(linhas)], { type: 'text/csv;charset=utf-8' }));
            const a = document.createElement('a');
            a.href = url; a.download = 'copiloto-custos-' + SHC.hoje() + '.csv';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            $('#levarMsg').textContent = '✓ Arquivo baixado (' + linhas.length + (linhas.length === 1 ? ' custo' : ' custos') + '). Importe este arquivo no SellerHub para não digitar os custos de novo.';
            await SHC.salvarGuia({ feitos: { backup: true }, ultimoBackup: Date.now() });
        } catch (e) { falhaGravar(e); }
    });

    // ── Aula geral (tour.js): cada aba, cada bloco com 1 frase; no fim, as aulas das outras telas ──
    const aba$ = a => () => abreAba(a);
    const AULA = [
        { sel: '.topo .sync', titulo: 'Leitura da sua conta', texto: 'Mostra se o Copiloto está em dia com o Mercado Livre. Verde = atualizado.' },
        { sel: '#guia:not([hidden])', titulo: 'Próximo passo', texto: 'O que falta para o Copiloto trabalhar completo. Um passo por vez.' },
        { sel: '#telaCheia:not([hidden])', titulo: 'Tela cheia', texto: 'Abre o Copiloto numa aba inteira, para ver melhor. O botão ao lado fecha o painel.' },
        { sel: '#selConta', titulo: 'Suas contas', texto: 'Você usa mais de uma conta neste Chrome. Escolha uma ou Todas as contas para ver vendas, líquido e alertas lado a lado.' },
        { sel: '#abas', titulo: 'Abas', texto: 'Cada assunto na sua aba. A Geral resume tudo. Vamos passar por todas.' },
        { sel: '#geralTopo', antes: aba$('geral'), titulo: 'Geral', texto: 'Quantas coisas pedem sua atenção e 1 linha de cada assunto. Toque em Ver mais para os detalhes.' },
        { sel: '#g-semanal', antes: aba$('geral'), titulo: 'Resumo da semana', texto: 'Toda segunda um texto pronto com as vendas, o lucro e o que pede atenção. Copie ou mande pelo WhatsApp para quem você quiser.' },
        { sel: '#geralFam', antes: aba$('geral'), titulo: 'Faturamento por família', texto: 'Qual família de produtos puxa o faturamento do mês e qual está caindo. Toque em Ver 13 meses e os SKUs para o histórico e os produtos.' },
        { sel: '#listaFull', antes: aba$('full'), titulo: 'Full', texto: 'No topo, a remessa que chegou com diferença e o botão para reclamar no ML; depois a pontuação do Full no medidor, a saúde do estoque e quanto enviar de cada produto.' },
        { sel: '#cardRemessas', antes: aba$('full'), titulo: 'Remessas', texto: 'Cada remessa ao Full: o que chegou, o que faltou, multas e quanto você gasta por mês para repor. Abrir no ML leva ao detalhe.' },
        { sel: '#cardProxRemessa', antes: aba$('full'), titulo: 'Próxima remessa', texto: 'Volume, peso, veículo e custo estimado da próxima remessa, com as quantidades que o Copiloto sugere. Edite e recalcule.' },
        { sel: '#listaPos', antes: aba$('posvenda'), titulo: 'Pós-venda', texto: 'As reclamações em aberto, os motivos mais comuns e os produtos com mais problema, para você corrigir o anúncio ou a embalagem. Nada do comprador aparece aqui.' },
        { sel: '#kpis', antes: aba$('promo'), titulo: 'Promoções', texto: 'Quantos produtos dão lucro, ficam abaixo da meta ou dão prejuízo nas promoções. Toque num número para ver quais.' },
        { sel: '#cardRoboPromo', antes: aba$('promo'), titulo: 'Robô de promoções', texto: 'Diga a margem mínima e o robô mostra as promoções em que ainda sobram pelo menos essa margem. Ele só sugere: quem entra na promoção é você, no ML.' },
        { sel: '#listaAds', antes: aba$('ads'), titulo: 'Ads', texto: 'Quanto o Ads gastou e vendeu, e quais anúncios gastam mais do que sobra da venda.' },
        { sel: '#listaFrete', antes: aba$('frete'), titulo: 'Frete', texto: 'O frete de cada anúncio e quando ele subiu. Abra um anúncio para ver o histórico e o texto do chamado.' },
        { sel: '#catTopo', antes: aba$('catalogo'), titulo: 'Catálogo', texto: 'Custo por SKU (vale para todos os anúncios do SKU) e a competição no catálogo.' },
        { sel: '#listaAfil', antes: aba$('afiliados'), titulo: 'Afiliados', texto: 'Quanto os afiliados venderam, o custo e o retorno, e os produtos fora da campanha.' },
        { sel: '#rep-saude', antes: aba$('saude'), titulo: 'Reputação', texto: 'A cor da sua conta no termômetro do Mercado Livre e cada item (reclamações, mediações, cancelamentos, atrasos) contra o limite: verde, âmbar ou vermelho.' },
        { sel: '#perg-saude', antes: aba$('saude'), titulo: 'Perguntas', texto: 'Quantas perguntas estão sem resposta e o seu tempo médio. Responder em até 1 hora ajuda a vender.' },
        { sel: '#listaSaude', antes: aba$('saude'), titulo: 'Saúde dos anúncios', texto: 'Quantas fotos tem cada anúncio, quais estão sem dados fiscais, SKUs com medidas diferentes, quem está perdendo visitas e o robô de fotos (a capa nunca sai do lugar).' },
        { sel: '#cardResumoML', antes: aba$('saude'), titulo: 'Do Resumo do Mercado Livre', texto: 'Os cartões de pendência do Resumo do vendedor: próximos a serem pausados, anúncios a melhorar, preço alto e o Full. Cada um com o link.' },
        { sel: '#listaConc', antes: aba$('conciliacao'), titulo: 'Conciliação', texto: 'O fechamento do mês resumido, as cobranças para conferir, as faturas e as notas fiscais.' },
        { sel: '#listaCanal', antes: aba$('canal'), titulo: 'Canal de transmissão', texto: 'As próximas transmissões da sua agenda e os produtos que dão lucro para programar.' },
        { sel: '#cardImposto', antes: aba$('ajustes'), titulo: 'Imposto e meta', texto: 'Entram na conta de quanto sobra em cada venda.' },
        { sel: '#cardCustos', antes: aba$('ajustes'), titulo: 'Custos', texto: 'Quanto já tem custo e os jeitos rápidos de trazer do Tiny, do Omie ou da planilha do Bling.' },
        { sel: '#cardModulos', antes: aba$('ajustes'), titulo: 'Quais módulos você usa', texto: 'Desmarque o que você não usa no dia a dia: a aba some do topo, mas nada do que já foi lido é apagado.' },
        { sel: '#cardContas', antes: aba$('ajustes'), titulo: 'Suas contas', texto: 'O Copiloto já mostra o nome de cada conta do Mercado Livre que você usa aqui, junto com o ID. Se quiser, dê um apelido próprio em vez do nome do ML.' },
        { sel: '#cardSellerHub', antes: aba$('ajustes'), titulo: 'SellerHub', texto: 'Todos os seus marketplaces num painel só, quando você quiser.' },
        { sel: '#aulaMais', antes: () => { aba$('ajustes')(); $('#aulaMais').hidden = false; }, titulo: 'Continue a aula', texto: 'Veja também as aulas de Ads por SKU, do Fechamento e da tela de Anúncios do ML.' },
    ];
    $('#aulaGeral').addEventListener('click', () => {
        if (!globalThis.SHCTour) return;
        globalThis.SHCTour.iniciar(AULA, { aoTerminar: () => { abreAba('ajustes'); $('#aulaMais').hidden = false; } });
    });
    document.body.addEventListener('click', async e => {
        const b = e.target.closest('[data-aula]');
        if (!b) return;
        if (b.dataset.aula === 'ads') abrePagina('ads.html#aula');
        else if (b.dataset.aula === 'fechamento') abrePagina('fechamento.html#aula');
        else if (b.dataset.aula === 'ml') { await reverTour(); chrome.tabs.create({ url: URL_LUCRO }); }
    });
    $('#reverTourAjustes').addEventListener('click', reverTour);
    $('#reverGuia').addEventListener('click', reverGuia);

    montaPerguntas();
    marcaAba();
    let pedeAlertas = null;
    chrome.storage.onChanged.addListener((mud, area) => {
        if (area !== 'local') return;
        const ks = Object.keys(mud).filter(k => !/^cores:/.test(k));   // cores: é gravada pela própria tela (já está na memória)
        if (!ks.length) return;
        if (ks.length === 1 && ks[0] === 'shc:status') soStatus();
        else if (ks.every(k => /^(fiscal|fotos|visitas|robo|medidas|cat):/.test(k))) soSaude(ks);   // rodada lenta: 1 gravação por anúncio (cat: = família, v2.6)
        else recarregar();
        // Custo, mínimo do Full ou ajustes mudaram aqui: o fundo refaz as anomalias (número do ícone) sem esperar a próxima sincronização.
        if (ks.some(k => k === 'cfg' || k.indexOf('c|') === 0)) { clearTimeout(pedeAlertas); pedeAlertas = setTimeout(() => { try { Promise.resolve(chrome.runtime.sendMessage({ acao: 'recalcular_alertas' })).catch(() => {}); } catch (e) { /* fundo reiniciando */ } }, 3000); }
    });
    // Ícone fixado/desafixado na barra (Chrome 130+): o guia confere de novo sem recarregar o painel.
    try { if (chrome.action && chrome.action.onUserSettingsChanged) chrome.action.onUserSettingsChanged.addListener(recarregar); } catch (e) { /* Chrome antigo */ }
    setInterval(desenhaStatus, 60000);
    carregar().then(() => {
        // Última sincronização completa há mais de 30 min (ou nunca): sincroniza sozinho. Conta sem promoção não repete a cada
        // abertura (a idade é a da sincronização, não a do retrato); "sincronizando" abandonado não trava.
        const lendo = status.estado === 'sincronizando' && !P.syncParado(status);
        if (!lendo && Date.now() - (status.ultimaOk || 0) > 30 * 60000) Promise.resolve(chrome.runtime.sendMessage({ acao: 'sincronizar' })).catch(() => {});
    });
})();
