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
            out[r.classe].push({ itemId: it.itemId, titulo: it.titulo || '', sku: it.sku || '', r });
        });
        const v = x => (x.r.variacaoPct === null ? Infinity : x.r.variacaoPct);
        out.caindo.sort((a, b) => v(a) - v(b));
        out.subindo.sort((a, b) => v(b) - v(a));
        return out;
    };
    // Radar por SKU (sem SKU: o próprio MLB): soma das visitas 7 × 7 dias dos anúncios lidos do SKU, maior queda primeiro.
    // Mesma régua do SHC.radarVisitas (limiar %). Anúncios com poucas visitas ficam de fora da soma. → [{sku, itemId, titulo, n, ult7, ant7, variacaoPct, classe}]
    P.radarPorSku = function (rl, limiar) {
        const lim = SHC.num(limiar) > 0 ? SHC.num(limiar) : 20, g = {};
        ['caindo', 'estavel', 'subindo'].forEach(k => (rl[k] || []).forEach(x => {
            const ch = x.sku || x.itemId, o = g[ch] || (g[ch] = { sku: x.sku || '', itemId: x.itemId, titulo: x.titulo || '', n: 0, ult7: 0, ant7: 0 });
            o.n++; o.ult7 += x.r.ult7; o.ant7 += x.r.ant7;
        }));
        const v = o => (o.variacaoPct === null ? Infinity : o.variacaoPct);
        return Object.values(g).map(o => {
            const p = o.ant7 ? Math.round((o.ult7 - o.ant7) / o.ant7 * 1000) / 10 : null;
            return Object.assign(o, { variacaoPct: p, classe: p === null || p >= lim ? 'subindo' : p <= -lim ? 'caindo' : 'estavel' });
        }).sort((a, b) => v(a) - v(b));
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
    /** Pós-venda, % das vendas (v3.1, imagem tela-posvenda): casos ÷ unidades vendidas do anúncio no mês atual + o anterior (vm|ml) → número | null (sem anúncio ou sem venda lida: "—"). */
    P.posPctVendas = function (casos, itemId, vmx, hoje) {
        const o = itemId && vmx && vmx[itemId], m = String(hoje || SHC.hoje()).slice(0, 7);
        const un = o ? (+o[m] || 0) + (+o[P.mesMenos(m, 1)] || 0) : 0;
        return un > 0 ? Math.round(casos / un * 1000) / 10 : null;
    };
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
    // v3.1 (imagem tela-frete aprovada): a subida de UM anúncio em números, para a manchete e o "Precisa de você" da aba Frete.
    // De/para/data = os mesmos do chamado (P.baseChamado); sem eles, o frete cobrado 30 dias × 30 anteriores (sem data).
    // porMes = diferença × pedidos dos últimos 30 dias (Faturamento; senão as vendas lidas). Sem pedido → null (nunca inventado).
    // → {de, para, dif, pct, desde|null, n30|null, porMes|null} | null
    P.subidaFrete = function (l, vendas, hoje) {
        if (!l || !l.subiu || l.comprador) return null;
        const b = P.baseChamado(l.h, vendas, l.it), fa = l.fa, u = fa && fa.ult30, a = fa && fa.ant30;
        let de, para, desde = null;
        if (b) { de = b.base; para = b.para; desde = b.desde; }
        else if (fa && fa.subiu && u && a && u.medio > 0 && a.medio > 0) { de = a.medio; para = u.medio; }
        else return null;
        const dif = SHC.r2(para - de), ini = hoje ? new Date(Date.parse(hoje + 'T12:00:00Z') - 30 * 864e5).toISOString().slice(0, 10) : '';
        const n30 = u && u.pedidos ? u.pedidos : Object.keys(vendas || {}).filter(o => { const v = vendas[o]; return v && v.d && v.d > ini && !v.pc && v.f > 0; }).length;
        return { de, para, dif, pct: de > 0 ? Math.round(dif / de * 1000) / 10 : null, desde, n30: n30 || null, porMes: n30 ? SHC.r2(dif * n30) : null };
    };

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

    // ── Ads de UM anúncio (detalhe na aba Ads): 'ads:<conta>' → {noAds, status, campanha, m} ──
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
            campanha: { id: cid, nome: c.nome || c.name || xs[0].campanha || '', estrategia: P.estrategiaTxt(c.estrategia || c.strategy), roasObjetivo: SHC.num(c.roasObjetivo !== undefined ? c.roasObjetivo : c.roasTarget), status: ativoTxt(c.status) },
            m: razoes({ gasto: soma('gasto') || 0, receita: soma('receita') || 0, vendas: soma('vendas') || 0, cliques: soma('cliques'), impressoes: soma('impressoes') }) };
    };
    // Campanha do anúncio: 30 dias × os 30 dias antes (ads:<conta>.anterior.campanhas[id], lido pelo fundo). O Mercado Ads não manda
    // o histórico por anúncio: a comparação é da campanha inteira. Sem a leitura de antes → null (nunca inventa zero).
    P.adsCampanhaVs = function (snap, cid) {
        const c = ((snap && snap.campanhas) || []).find(k => String(k.id) === String(cid)), ant = cid && snap && snap.anterior && snap.anterior.campanhas ? snap.anterior.campanhas[cid] : null;
        if (!c || !ant) return null;
        const m = o => { o = o || {}; const g = numDe(o, ['custo', 'cost']), r = numDe(o, ['receita', 'totalAmount', 'amountTotal']);
            return { gasto: g, receita: r, vendas: numDe(o, ['vendas', 'unitsQuantity', 'soldQuantityTotal']), acos: g !== null && r > 0 ? g / r * 100 : null }; };
        const a = m(c.metricas || c.metrics), b = m(ant.metricas || ant.metrics || ant);
        return a.gasto === null || b.gasto === null ? null : { atual: a, antes: b };
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
    // Cor da barra "entrou × custou" (Afiliados e Ads), pela sobra que o Copiloto já calcula (sobraAntes = sobra das vendas ANTES desse gasto).
    // 'pr' não compensa (o gasto passou da sobra, a mesma regra do "acima do equilíbrio") · 'at' apertado (levou ≥ 80% da sobra, ou a margem
    // depois dele fica abaixo da sua meta) · 'ok' compensa · '' sem custo informado (sem base, sem cor).
    P.saudeRetorno = function (entrou, custou, sobraAntes, meta) {
        if (sobraAntes === null || sobraAntes === undefined || isNaN(sobraAntes)) return '';
        const g = custou > 0 ? custou : 0;
        if (g > sobraAntes + 0.004) return 'pr';
        return g >= sobraAntes * 0.8 || (entrou > 0 && (sobraAntes - g) / entrou * 100 < (SHC.num(meta) || 0)) ? 'at' : 'ok';
    };
    P.SAUDE_RET = { ok: 'Compensa', at: 'Apertado', pr: 'Não compensa', '': 'Sem custo' };

    // ── Afiliados (afil:<conta>, etapa 'afiliados'): só leitura. Com a lista da campanha lida só em parte (completo !== true), não
    // afirma "fora da campanha". Nomes de afiliados nunca chegam aqui (o fundo não guarda). ──
    const ehAtivo = it => /^(ativo|ativa|active)$/i.test(String((it && it.status) || ''));
    const nulo = v => v === null || v === undefined;
    /**
     * Aba Afiliados → { estado 'sem_dado'|'nao_usa'|'ok', vendas, unidades, qtdVendas, custo, roi, atualizado, naCampanha, comissao, faixa,
     * entradaAutomatica, status, inicio, lidos, listaInteira, pausados, encerrados, comExtra[], fora[] | null, top[], porProduto[], semVenda[],
     * pedidos (soma por SKU/situação | null), comeLucro[{ it, p, titulo, pct, comissaoUn, sobra, depois }] }.
     * sobraDe(it) → { sobra } (SHC.sobraAnuncio do painel); comissão por venda = preço × % da campanha (a do produto, ou a geral).
     * top[] traz também sku, sobraAntes e cor (P.saudeRetorno com a meta de margem).
     */
    P.afilCartao = function (a, itens, sobraDe, meta) {
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
        // "O que mais vendeu" com SKU e a cor da barra: sobra antes da comissão = sobra por unidade (preço de hoje) × unidades vendidas.
        // Quem está no "come o lucro" fica vermelho aqui também. Sem custo informado → cor '' (sem base).
        const come = new Set(comeLucro.map(l => l.it.itemId));
        const topCor = top.map(p => {
            const it = porId[p.itemId], s = sobraDe && it && it.preco > 0 && p.unidades > 0 ? sobraDe(it) : null;
            const sobraAntes = s && !nulo(s.sobra) ? SHC.r2(s.sobra * p.unidades) : null;
            return Object.assign({}, p, { sku: (it && it.sku) || '', sobraAntes, cor: come.has(p.itemId) ? 'pr' : P.saudeRetorno(p.vendas, p.custoEstimado, sobraAntes, meta) });
        });
        const pub = k => prods.filter(p => String(p.publicacao || '').toUpperCase() === k).length;
        return { estado: 'ok', vendas: nulo(m.vendas) ? null : m.vendas, unidades: nulo(m.unidades) ? null : m.unidades, qtdVendas: nulo(m.qtdVendas) ? null : m.qtdVendas,
            custo: nulo(m.custoEstimado) ? null : m.custoEstimado, atualizado: m.ultimaAtualizacao || null, metricasInteiras: m.completo !== false,
            roi: m.custoEstimado > 0 && !nulo(m.vendas) ? SHC.r2(m.vendas / m.custoEstimado) : null,
            naCampanha: nulo(c.totalProdutos) ? prods.length : c.totalProdutos, comissao: geral, faixa: c.faixa || null,
            entradaAutomatica: nulo(c.entradaAutomatica) ? null : c.entradaAutomatica, status: c.status || null, inicio: c.inicio || null,
            lidos: prods.length, listaInteira, pausados: pub('PAUSED'), encerrados: pub('CLOSED') + pub('INACTIVE'),
            comExtra: geral === null ? [] : prods.filter(p => !nulo(p.comissao) && p.comissao > geral).sort((x, y) => y.comissao - x.comissao),
            fora, top: topCor, porProduto, semVenda, pedidos: a.pedidos || null, comeLucro };
    };
    /** Produtos da campanha cujo anúncio não está à venda (pausado, encerrado ou inativo). */
    P.anunciosAfilParados = a => ((a && a.campanha && a.campanha.produtos) || []).filter(p => /^(PAUSED|CLOSED|INACTIVE)$/i.test(p.publicacao || ''));
    /** v3.1 Campanha exclusiva → etiqueta { cls, txt }: verde ativa, azul programada, cinza finalizada; desconhecido → texto cru em minúsculas. */
    P.exclusivaSelo = c => ({ ativa: { cls: 'ok', txt: 'Ativa' }, programada: { cls: 'az', txt: 'Programada' }, finalizada: { cls: 'cz', txt: 'Finalizada' }, pausada: { cls: 'at', txt: 'Pausada' } }[c.estado]
        || { cls: 'cz', txt: /^draft$/i.test(c.status) ? 'rascunho' : String(c.status || 'sem estado').toLowerCase() });
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
        const nome = { omie: 'Omie', tiny: 'Tiny', bling: 'Bling' }[p.erp] || String(p.erp);
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
    P.GRUPOS_COMP = [['ganhando', 'Ganhando', 'l'], ['preco', 'Perdendo por preço', 'p'], ['entrega', 'Perdendo pela entrega / Restrito', 'p'], ['dividindo', 'Dividindo o 1º lugar', 'a'], ['outros', 'Perdendo por outro motivo', 'n']];   // antes "1 outros": sem concordância e sem dizer que está perdendo
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
    // v3.1 (imagem tela-ajustes): descrição curta, em minúscula, embaixo do nome da aba no interruptor de "Abas que aparecem".
    P.MODULO_DESC = { full: 'remessas, pontuação, envio', posvenda: 'reclamações, devoluções, mensagens', promo: 'com o robô de promoções',
        ads: 'resumo da conta e campanhas', frete: 'linha do tempo, anúncios, pedidos', catalogo: 'custos e competição', afiliados: 'vendas, comissão, pedidos',
        saude: 'reputação, perguntas, fotos, fiscal', conciliacao: 'fechamento do mês', canal: 'agenda da semana' };
    /** Abas visíveis no topo, na ordem de P.ABAS (Geral e Ajustes sempre; o resto só se o módulo estiver ligado). */
    P.abasVisiveis = cfgAtual => P.ABAS.filter(a => a === 'geral' || a === 'ajustes' || SHC.moduloLigado(cfgAtual, a));
    // Alertas calculados no painel (P.alertas) → aba; os do fundo (shc:anomalias) que o painel não calcula: frete, pagamento e pós-venda.
    P.ABA_DO_ALERTA = { conta: 'full', full: 'full', ads: 'ads', fiscal: 'saude', visitas: 'saude', medidas: 'saude', medmud: 'saude' };
    // v2.7: 'perguntas' e 'reputacao' (aba Saúde desde a v2.9) e a remessa do Full com inconformidade/multa (tipo 'full' + remessaId, aba Full) também vêm do fundo.
    // v3.1: certificado/NF-e (fiscal) e custo novo na fatura ficam na Conciliação; o fiscal da Saúde é o do painel (P.ABA_DO_ALERTA), nunca em dobro.
    const ROT_ANOM = { frete: 'Frete', pagamento: 'Cobrança', posvenda: 'Pós-venda', perguntas: 'Perguntas', reputacao: 'Reputação', fiscal: 'Fiscal', custo: 'Fatura' };
    const LINK_ANOM = { posvenda: 'Abrir o pós-venda', perguntas: 'Responder no ML', reputacao: 'Ver a reputação no ML', remessa: 'Abrir a remessa no ML' };
    P.ROT_ANOM = ROT_ANOM;
    /** Alertas de UMA aba → [{tipo, rot, titulo, texto, link?, linkTxt?}]. anom só vale se for da conta aberta (anom.conta). */
    P.alertasDaAba = function (aba, al, anom, conta) {
        const rot = { conta: 'Conta', full: 'Full', ads: 'Ads', fiscal: 'Dados fiscais', visitas: 'Visitas', medidas: 'Medidas', medmud: 'Medidas' };
        const daqui = ((al && al.itens) || []).filter(i => P.ABA_DO_ALERTA[i.tipo] === aba).map(i => Object.assign({ rot: rot[i.tipo] || '' }, i));
        const doFundo = anom && String(anom.conta) === String(conta || '') ? (anom.itens || []).filter(i => i && i.aba === aba && ((ROT_ANOM[i.tipo] && P.ABA_DO_ALERTA[i.tipo] !== aba) || (i.tipo === 'full' && i.remessaId)))
            .map(i => ({ tipo: i.tipo, rot: i.remessaId ? 'Remessa' : ROT_ANOM[i.tipo], titulo: '', texto: i.texto, link: i.link || '', remessaId: i.remessaId || '', qtd: i.qtd, vermelho: !!i.vermelho,
                linkTxt: LINK_ANOM[i.remessaId ? 'remessa' : i.tipo] || (i.link ? 'Abrir no Mercado Livre' : '') })) : [];
        return daqui.concat(doFundo);
    };
    // ── v3.1 topo (ESPEC §3): contador de cada aba e sino, da MESMA conta do número do ícone (shc:anomalias, SHC.anomalias) ──
    /**
     * shc:anomalias da conta aberta → { porAba: {aba: {n, cor:'pr'|'at'}}, total, urgentes } só das abas visíveis. Vermelho (pr) = o que o
     * próprio ícone já trata como urgente (item.vermelho: reclamação/mediação, perguntas, reputação, certificado; e cobrança a conferir);
     * o resto é âmbar (at). Pós-venda conta as unidades (qtd), como SHC.anomalias. Ainda não lido ou de outra conta → null (sem bolinha, nunca 0 inventado).
     * extra = {aba: {n, cor}} das abas que o fundo não conta (Promoções: produtos com prejuízo; Catálogo: anúncios perdendo o 1º lugar), com o
     * mesmo número que a própria aba mostra. Só a bolinha da aba: o total do sino continua o do ícone (lido = shc:anomalias da conta aberta).
     * al = P.alertas do painel (já calculado): a bolinha de cada aba passa a contar a MESMA lista do bloco "Alertas desta aba" (P.alertasDaAba),
     * na mesma unidade (P.nAlerta) — assim Full e Saúde, que o painel calcula, também ganham número.
     */
    P.nAlerta = i => (i.tipo === 'posvenda' ? Math.max(1, Math.round(SHC.num(i.qtd) || 0)) : 1);
    const alertaUrg = i => !!i.vermelho || i.tipo === 'pagamento';
    P.contadoresAbas = function (anom, conta, visiveis, extra, al) {
        const lido = !!(anom && Array.isArray(anom.itens) && String(anom.conta) === String(conta || ''));
        const vis = new Set(visiveis || P.ABAS), porAba = {}, ex = Object.keys(extra || {}).filter(a => vis.has(a) && extra[a] && extra[a].n > 0);
        const soma = (x, i, n) => { x.n += n; if (alertaUrg(i)) x.cor = 'pr'; };
        if (al) vis.forEach(a => P.alertasDaAba(a, al, anom, conta).forEach(i => soma(porAba[a] || (porAba[a] = { n: 0, cor: 'at' }), i, P.nAlerta(i))));
        if (!lido && !ex.length && !Object.keys(porAba).length) return null;
        let total = 0, urgentes = 0;
        (lido ? anom.itens : []).forEach(i => {
            if (!i || !vis.has(i.aba)) return;
            const n = P.nAlerta(i);
            total += n;
            if (alertaUrg(i)) urgentes += n;
            if (!al) soma(porAba[i.aba] || (porAba[i.aba] = { n: 0, cor: 'at' }), i, n);
        });
        ex.forEach(a => { if (!porAba[a]) porAba[a] = { n: Math.round(extra[a].n), cor: extra[a].cor === 'pr' ? 'pr' : 'at' }; });
        return { porAba, total, urgentes, lido };
    };
    /** Iniciais da pílula da conta: "Loja Exemplo" → "LE"; "Casa" → "CA"; sem apelido → "". */
    P.iniciais = nome => {
        const ps = String(nome || '').trim().split(/\s+/).filter(Boolean).map(p => p.replace(/[^0-9A-Za-zÀ-ÿ]/g, '')).filter(Boolean);
        return (ps.length > 1 ? ps[0][0] + ps[1][0] : (ps[0] || '').slice(0, 2)).toUpperCase();
    };
    /**
     * Pílula da conta (topo): o nome é SÓ o apelido dado em Ajustes (nunca o nome da conta do ML); sem apelido → "Dê um nome a esta conta".
     * O ID vai inteiro, sempre ("ID 100200300"): quando falta espaço, o CSS corta o nome e nunca o ID.
     */
    P.contaTopo = (id, cfg) => {
        const ap = id && cfg && cfg.apelidos && cfg.apelidos[id] ? String(cfg.apelidos[id]).trim().slice(0, 40) : '';
        return { nome: ap, temNome: !!ap, idTxt: id ? 'ID ' + String(id) : '', iniciais: P.iniciais(ap) };
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
    // Pedaço de um resumo da Geral que diz um problema ("2 acima do equilíbrio", "faltam 4", "1 com frete a mais"); "0 …" nunca é problema.
    P.RE_PROBLEMA = /^(?!0\s)(?=.*(acima|falta|prejuízo|a mais|reclama|media|abaixo|caiu|caindo|perdend|venc|atras|pendente|diferen|conferir|parad|repor|rejeit|erro|devolu|sem |limite))/i;
    // vis = abas visíveis agora: total, urgentes e partes contam só os itens delas, com a regra do sino (P.contadoresAbas) — o fundo só
    // recalcula shc:anomalias na próxima sincronização, e a Geral não pode contar alerta de módulo que a dona acabou de desligar.
    P.anomTopo = function (anom, conta, vis) {
        if (!anom || typeof anom.total !== 'number' || String(anom.conta) !== String(conta || '')) return null;
        let a = anom, urgentes = null, vermelho = !!anom.vermelho;
        if (vis && Array.isArray(anom.itens)) {
            const porTipo = {}, its = anom.itens.filter(i => i && vis.indexOf(i.aba) >= 0);
            its.forEach(i => { porTipo[i.tipo] = (porTipo[i.tipo] || 0) + P.nAlerta(i); });
            a = { total: its.reduce((s, i) => s + P.nAlerta(i), 0), porTipo };
            urgentes = its.filter(alertaUrg).reduce((s, i) => s + P.nAlerta(i), 0);
            vermelho = urgentes > 0;
        }
        const t = SHC.anomaliasTitulo ? SHC.anomaliasTitulo(a) : '';
        return { total: a.total, urgentes, partes: t.indexOf(' — ') > 0 ? t.slice(t.indexOf(' — ') + 3) : '', vermelho };
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
        // v2.11: meses antigos em segundo plano (shc:status.historico): "histórico: 7 de 12 meses lidos" enquanto faltar mês.
        const hi = st.historico, ht = hi && hi.de > 0 && (hi.lendo || hi.falta > 0) ? ' · ' + (hi.lendo ? 'lendo o histórico: ' : 'histórico: ') + hi.feitos + ' de ' + hi.de + ' meses' + (hi.lendo ? '' : ' lidos') : '';
        return { estado: s.estado, cor: probl || s.estado === 'velho' ? 'atencao' : 'ok', rotulo: 'Sincronização', pct: null, fila: [], historico: !!ht,
            texto: (s.estado === 'velho' ? s.texto : '✓ Atualizado às ' + hm(st.ultimaOk)) + px + (probl ? ' · ' + (probl === 1 ? '1 parte não foi lida' : probl + ' partes não foram lidas') : '') + ht };
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
        const pa = (c.pagoAMais || []).filter(p => p && !p.talvezUnidades).length;   // v3.1: o com * (pode ter 2+ unidades) não conta como "a mais"
        return { cor: pa > 0 ? 'ruim' : (c.faltam > 0 ? 'atencao' : 'ok'), conc: c,
            resumo: `${P.milhar(c.conciliados || 0)} ${c.conciliados === 1 ? 'pedido conciliado' : 'pedidos conciliados'} de ${P.milhar(c.vendas)} · faltam ${P.milhar(c.faltam || 0)}`
                + (pa ? ` · ${pa} com frete a mais (${SHC.moeda(c.totalAMais || 0)})` : '') };
    };
    /**
     * v3.1: a conta do frete de UM pedido, linha a linha como no detalhe da venda do ML ("Envios −R$ 20,75 · Tarifa do Mercado Envios (por sua conta)").
     * p = item de conciliacao.pagoAMais ({cobrado, esperado, diferenca, linhas?, dev?}) → [{rot, val (texto), cls: ''|'est'|'tot'|'fora'|'mais'}].
     * Sem linhas (lido pela versão anterior) → só o total. A tarifa de devolução (dev) aparece à parte, marcada "fora da conta".
     */
    P.contaFretePedido = function (p) {
        if (!p) return [];
        const out = [], m = v => SHC.moeda(v);
        (p.linhas || []).forEach(l => out.push({ rot: String(l.t || 'Tarifa de envio'), val: (l.e ? '+' : '−') + m(l.v), cls: l.e ? 'est' : '' }));
        if (!(p.linhas || []).length) out.push({ rot: 'Detalhe por linha: aparece quando este mês for lido de novo no Faturamento', val: '', cls: 'fora' });
        out.push({ rot: 'Frete da venda cobrado (tarifas − estornos)', val: m(p.cobrado), cls: 'tot' });
        if (typeof p.esperado === 'number') out.push({ rot: 'Frete do anúncio', val: m(p.esperado), cls: '' });
        if (typeof p.diferenca === 'number') out.push({ rot: p.talvezUnidades ? 'A mais (pode ter mais de 1 unidade: confira)' : 'A mais', val: '+' + m(p.diferenca), cls: 'mais' });
        if (p.dev > 0) out.push({ rot: 'Tarifa de devolução (frete de volta do produto): fora desta conta', val: m(p.dev), cls: 'fora' });
        return out;
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
    /**
     * v3.1 Aba Canal = Agenda: "para programar" vem SÓ do registro da Agenda (reg.prontos, da regra única SHC.canalRanking).
     * Proposta da Central que daria lucro mas ainda não é promoção confirmada fica à parte: "proposta: aceite no ML para entrar".
     * propostas = [{itemId, titulo, lucro, promo}]. → { prontos: [...] | null (agenda nunca montada), propostas: [...] sem os prontos }
     */
    P.canalParaProgramar = function (reg, propostas) {
        const prontos = reg && Array.isArray(reg.prontos) ? reg.prontos : null, ja = new Set((prontos || []).map(x => x.itemId));
        return { prontos, propostas: (propostas || []).filter(x => x && !ja.has(x.itemId)) };
    };
    // Fechamento resumido (Conciliação e Geral): linhas da cascata (SHC.fech.cascata) juntas por grupo. null = não lido ("—").
    const GRUPOS_CONC = [['bruto', 'Vendas brutas', ['bruto']], ['cancelado', 'Canceladas e devolvidas', ['cancelado']],
        // v3.1: Full, Minha página e impostos do ML (tipos novos do Fechamento) entram nas tarifas; o frete de devoluções tem linha própria (nunca no frete das vendas).
        ['tarifas', 'Tarifas do ML', ['tarifa_venda', 'cobranca_mp', 'parcelamento', 'recebimento', 'full', 'minha_pagina', 'impostos_ml', 'outro']], ['frete', 'Frete por sua conta', ['frete']],
        ['devolucao', 'Frete de devoluções', ['devolucao']], ['ads', 'Ads', ['ads', 'ads_seguidores']], ['estornos', 'Estornos', ['estornos']], ['liquido', 'Líquido do ML (estimado)', ['liquido']]];
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
    /**
     * v3.1 (pedido da dona 26/09: "histórico mês a mês para construir a sazonalidade"): mini-histórico de 13 meses de UMA família em barrinhas
     * (SVG, sem biblioteca) na linha da família. Mês forte (inteiro e 20% ou mais acima da média dos meses inteiros, com 6+ meses) na cor cheia;
     * os outros mais claros; mês lido pela metade bem claro; mês não lido = tracinho cinza. '' sem série.
     */
    P.sparkFam = function (f) {
        const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const s = (f && f.serie12) || [];
        if (!s.length) return '';
        const inteiros = s.filter(p => p.bruto !== null && !p.parcial), media = inteiros.length ? inteiros.reduce((t, p) => t + p.bruto, 0) / inteiros.length : 0;
        const max = Math.max(1, ...s.filter(p => p.bruto !== null).map(p => p.bruto)), w = 4, g = 1, H = 18, fortes = [];
        const barras = s.map((p, i) => {
            const x = i * (w + g);
            if (p.bruto === null) return `<rect x="${x}" y="${H - 1}" width="${w}" height="1" fill="#D0D5DD"/>`;
            const h = Math.max(1, Math.round(p.bruto / max * H)), forte = !p.parcial && inteiros.length >= 6 && media > 0 && p.bruto >= media * 1.2;
            if (forte) fortes.push(P.mesLongoAno(p.mes));
            return `<rect x="${x}" y="${H - h}" width="${w}" height="${h}" rx="1" fill="${esc(f.cor || '#667085')}" opacity="${forte ? 1 : p.parcial ? 0.3 : 0.5}"/>`;
        }).join('');
        const W = s.length * (w + g) - g, lbl = s.length + ' meses de ' + f.familia + (fortes.length ? '; meses fortes: ' + fortes.join(', ') : '');
        return `<svg class="fam-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(lbl)}"><title>${esc(lbl)}</title>${barras}</svg>`;
    };
    /** v3.1: seta contra o MESMO mês do ano passado → { txt: 'ano ▲ 12%' | 'ano ▼ 8%', cls } | { txt: '' } (sem o ano passado lido). */
    P.famSetaAno = function (x) {
        const v = x && typeof x.variacaoAnoPct === 'number' && isFinite(x.variacaoAnoPct) ? Math.round(x.variacaoAnoPct * 10) / 10 : null;
        return v === null ? { txt: '', cls: '' } : { txt: 'ano ' + (v > 0 ? '▲ ' : v < 0 ? '▼ ' : '= ') + pct1(v), cls: v > 0 ? 'up' : v < 0 ? 'down' : 'eq' };
    };
    // ── v3.1 (print da dona 29/09: "muito texto e pouco visual… mostra a variação, por que caiu"): peças do cartão de SKU e dos filtros. ──
    const escF = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    P.rs0 = v => (v < 0 ? '−' : '') + 'R$ ' + P.milhar(Math.abs(Math.round(v)));   // R$ sem centavos: 4680 → "R$ 4.680"
    const mesAb = m => MESES[+String(m).slice(5, 7) - 1] || '';
    /** Variação do SKU/família em 1 linha → { de: 'ago R$ 4.680' | '' (sem o mês anterior lido), para: 'set R$ 0', pct: '▼ 100%' | '', cls: 'up'|'down'|'eq'|'' }. */
    P.famVarTxt = function (s, mes) {
        const ant = P.mesMenos(mes, 1), sa = P.famSeta(s), temAnt = s && typeof s.brutoAnt === 'number';
        return { de: temAnt ? mesAb(ant) + ' ' + P.rs0(s.brutoAnt) : '', para: mesAb(mes) + ' ' + P.rs0((s && s.bruto) || 0), pct: sa.txt, cls: sa.cls };
    };
    /**
     * Mini gráfico de barras dos 6 últimos meses de UM SKU (s.serie de SHC.familias, R$ por mês), o mês escolhido destacado na cor da variação
     * (vermelho caiu, verde subiu). Mês não lido = tracinho cinza ("não lido" no título). '' sem série ou sem nenhum mês lido.
     */
    P.miniSku = function (s, mes) {
        const serie = (s && Array.isArray(s.serie) ? s.serie : []).slice(-6);
        if (!serie.length || serie.every(v => v === null) || !/^\d{4}-\d{2}$/.test(String(mes || ''))) return '';
        const n = serie.length, w = 15, g = 4, H = 28, W = n * (w + g) - g, max = Math.max(1, ...serie.filter(v => v !== null));
        const v = s.variacaoPct, cor = typeof v === 'number' && v < 0 ? '#DC2626' : typeof v === 'number' && v > 0 ? '#059669' : '#334155';
        const ms = serie.map((x, i) => P.mesMenos(mes, n - 1 - i));
        const partes = serie.map((x, i) => {
            const bx = i * (w + g), ult = i === n - 1;
            const txt = `<text x="${bx + w / 2}" y="${H + 11}" font-size="9" text-anchor="middle" fill="${ult ? '#0B1220' : '#667085'}"${ult ? ' font-weight="700"' : ''}>${mesAb(ms[i])}</text>`;
            if (x === null) return `<g><title>${P.nomeMes(ms[i])}: não lido</title><rect x="${bx}" y="${H - 1}" width="${w}" height="1" fill="#D0D5DD"/>${txt}</g>`;
            const h = x > 0 ? Math.max(2, Math.round(x / max * H)) : 1;
            return `<g><title>${P.nomeMes(ms[i])}: ${escF(SHC.moeda(x))}</title><rect x="${bx}" y="${H - h}" width="${w}" height="${h}" rx="2" fill="${ult ? cor : '#CBD5E1'}"/>${txt}</g>`;
        }).join('');
        const lbl = 'Vendas por mês: ' + serie.map((x, i) => mesAb(ms[i]) + ' ' + (x === null ? 'não lido' : P.rs0(x))).join(', ');
        return `<svg class="fk-mini" viewBox="0 0 ${W} ${H + 13}" width="${W}" height="${H + 13}" role="img" aria-label="${escF(lbl)}">${partes}</svg>`;
    };
    // As etiquetas do gargalo (SHC.gargaloQueda), na ordem da tela: as 6 de sempre + Anúncio e Ads quando há o que dizer.
    P.GARGALO_ORDEM = ['estoque', 'anuncio', 'preco', 'sazonal', 'buybox', 'visitas', 'frete', 'ads'];
    P.GARGALO_NOME = { estoque: 'Estoque', anuncio: 'Anúncio', preco: 'Preço', sazonal: 'Sazonal', buybox: 'Buy box', visitas: 'Visitas', frete: 'Frete', ads: 'Ads' };
    const pesa = c => c.nivel === 'e' || c.nivel === 'contribui';
    /**
     * Filtros por causa → [{ id, nome, n (SKUs em que a causa é "é essa" ou "contribui"), nivel: 'e' (algum é essa) | 'contribui' }] pelo n (maior 1º),
     * mais { id: 'sem', nome: 'Sem causa clara', n, nivel: 'semdado' } no fim. gar = Map(chave do SKU → SHC.gargaloQueda) só dos que caíram.
     */
    P.famFiltros = function (skus, gar) {
        const n = {}, niv = {};
        let sem = 0;
        (skus || []).forEach(s => {
            const g = gar && gar.get(chaveSkuFam(s)), cs = g ? g.causas.filter(pesa) : null;
            if (!g) return;
            if (!cs.length) { sem++; return; }
            cs.forEach(c => { n[c.id] = (n[c.id] || 0) + 1; niv[c.id] = c.nivel === 'e' || niv[c.id] === 'e' ? 'e' : 'contribui'; });
        });
        const out = P.GARGALO_ORDEM.filter(id => n[id]).map(id => ({ id, nome: P.GARGALO_NOME[id], n: n[id], nivel: niv[id] })).sort((a, b) => b.n - a.n);
        return sem ? out.concat({ id: 'sem', nome: 'Sem causa clara', n: sem, nivel: 'semdado' }) : out;
    };
    /** A lista de SKUs com o filtro ('' = todos; 'sem' = caíram sem causa clara; id = a causa pesa: é essa ou contribui). */
    P.famFiltra = (skus, gar, filtro) => (!filtro ? (skus || []).slice() : (skus || []).filter(s => {
        const g = gar && gar.get(chaveSkuFam(s));
        return !!g && (filtro === 'sem' ? !g.principal : g.causas.some(c => c.id === filtro && pesa(c)));
    }));
    /** Curva ABC (P.abcConta) → { A, B, C, sem } (quantos SKUs em cada faixa; sem = SKUs sem custo, fora da curva pelo lucro). */
    P.abcContagem = abc => ((abc && abc.lista) || []).reduce((o, s) => { o[s.abc === null || s.abc === undefined ? 'sem' : s.abc]++; return o; }, { A: 0, B: 0, C: 0, sem: 0 });
    /** Barra da família: mês anterior (cinza) × este mês (na cor da família), com R$ e a seta. '' sem o mês anterior lido. */
    P.famBarraMes = function (f, mes, fams) {
        if (!f || typeof f.brutoAnt !== 'number') return '';
        const ant = P.mesMenos(mes, 1), max = Math.max(1, f.bruto || 0, f.brutoAnt), sa = P.famSeta(f), rotEu = mesAb(mes) + (fams && fams.mesParcial ? ' até dia ' + fams.dias : '');
        const l = (rot, v, cor, p) => `<span>${escF(rot)}</span><span class="fk-tr"><i style="width:${Math.max(1, Math.round(v / max * 100))}%;background:${escF(cor)}"></i></span><b>${P.rs0(v)}</b><span class="fseta ${p ? sa.cls : ''}">${p ? escF(sa.txt) : ''}</span>`;
        return `<div class="fk-fam" role="img" aria-label="${escF(f.familia + ': ' + P.mesLongo(ant) + ' ' + P.rs0(f.brutoAnt) + ', ' + rotEu + ' ' + P.rs0(f.bruto || 0) + (sa.txt ? ' (' + sa.txt + ')' : ''))}">`
            + l(mesAb(ant), f.brutoAnt, '#CBD5E1', false) + l(rotEu, f.bruto || 0, f.cor || '#334155', true) + '</div>';
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
    const URL_AFIL = { campanha: 'https://vendedores.mercadolivre.com.br/seller-affiliates/campaign', hub: 'https://vendedores.mercadolivre.com.br/seller-affiliates',
        exclusivas: 'https://vendedores.mercadolivre.com.br/seller-affiliates/target-campaign' };   // guia: "Ver o lucro nos seus anúncios"
    const ATALHOS = ['ads.html', 'fechamento.html'];   // páginas da extensão feitas por outras frentes
    const PERM_CAT = { origins: ['https://www.mercadolivre.com.br/*', 'https://produto.mercadolivre.com.br/*'] };   // "Ver quem está ganhando"

    let cfg = Object.assign({}, SHC.PADRAO), snap = null, status = {}, anuncios = null, itens = [], guia = { feitos: {}, tours: {} };
    let conta = null, contas = {}, icone = false, famDeItem = {}, skusFam = {}, custoFam = {}, custoProp = new Map();
    let fretes = {}, vendas = {}, grupos = [], resumos = [], custoGrupo = {}, propsPorFam = {}, skuDe = {}, geracao = 0;
    let cadSku = {}, adsSnap = null, fechMes = null, retratos = {}, compAberto = false;
    let compHist = {}, concDe = {}, compGrupo = '', concMsg = {}, permCat = false, compCat = {};   // comp:<conta>, conc:<conta>:<MLB>; filtro e estado do "Ver quem está ganhando"; compCat = catcomp:<conta>.porItem (v3.1)
    let roboPromo = null, roboPromoMsg = '';   // v2.9: robopromo:<conta> (sugestões e histórico do robô de promoções); resposta do Salvar da margem
    let afil = null, simDe = {}, simMsg = {};   // afil:<conta>; sim:<conta>:<MLB> por anúncio; 'lendo' | texto do "Conferir com o Simulador do ML"
    let adsFiltro = 'acima', adsDet = null, pedTodos = false, semTodos = false;   // adsDet = MLB aberto no detalhe da aba Ads; c|sku|… (medidas, fullMinUn), ads:<conta>, fech:<conta>:<mês>, {sellerId: itens}
    let full = null, vm = {}, fullDias = 30, fullClasse = '';    // ml:full:<sellerId>, vm|ml|MLB = {'AAAA-MM': unidades}
    let remessas = null, custosMsg = '';   // ml:full:remessas:<sellerId>; resposta de "Sincronizar custos" (Catálogo)
    let mesesLidos = [], entreContas = [];   // meses lidos inteiros no Faturamento; mesmo produto entre contas (calculado 1 vez por carga)
    // Saúde dos anúncios: fiscal:/fotos:/visitas:/robo:<conta>; permissão de www (fotos); filtros e mensagens da aba
    let fiscal = null, fotos = null, visitas = null, robo = null, permWww = false, saudeMsg = '', roboMsg = '', fotoFaixa = '', radarBusca = '';
    let medidas = null, medSku = '', medMsg = '', medTxt = -1;   // medidas:<conta>; SKU aberto; resposta do "Conferir agora"/"Copiar"; texto do chamado à mostra
    const saudeVer = { fiscal: false, fotos: false, marcadas: false, estavel: false, subindo: false, medidas: false, medmud: false };
    let regrasAbertas = false;   // <details> "Regras do robô" aberto: continua aberto quando a aba é redesenhada (rodada lenta)
    const PERM_WWW = { origins: ['https://www.mercadolivre.com.br/*'] };   // "Permitir ler fotos e medidas dos anúncios" (tela Alterar anúncio: só GET)
    // v2.9: "Continuar sincronizando com o Chrome fechado" (Ajustes) = permissão OPCIONAL 'background': o Chrome segue rodando escondido
    // depois da última janela (e abre junto com o Windows), enquanto o computador estiver ligado. O seller liga/desliga no clique.
    const PERM_FUNDO = { permissions: ['background'] };
    // v3.1 (imagem tela-ajustes): 1 linha curta embaixo do interruptor; o "se não funcionar" foi para o "?" do cartão.
    P.textoFundo = ligado => ligado
        ? 'Ligado · enquanto o computador estiver ligado'
        : 'Desligado · volta quando você abrir o Chrome';
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
    let posvenda = null, freteHist = null, conferir = null, cert = null, anom = null, rateio = null, fat = null, vb = null, rep = null, fechAnt = null, fechAnt2 = null, canalPlano = null, fechAtual = null;
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
        let blg = null; try { blg = await SHC.lerChave(SHC.BLING_CHAVE || 'erp:bling'); } catch (e) { blg = null; }   // bling.js não é carregado aqui: a chave é 'erp:bling'
        // Competição: histórico diário (comp:<conta>) e o que "Ver quem está ganhando" já leu (conc:<conta>:<MLB>).
        const idsComp = its.filter(it => it.competicao && it.competicao !== 'ganhando').map(it => it.itemId);
        const [ch, cc, kc] = await Promise.all([SHC.lerChave('comp:' + (ct || 'atual')), idsComp.length ? chrome.storage.local.get(idsComp.map(id => 'conc:' + ct + ':' + id)) : {}, SHC.lerChave('catcomp:' + (ct || 'atual'))]);
        let pc = false;
        try { pc = !!(chrome.permissions && chrome.permissions.contains && await chrome.permissions.contains(PERM_CAT)); } catch (e) { pc = false; }
        const saudeLida = await lerSaude(ct), ext = await lerExtras(ct);
        if (eu !== geracao) return;
        usaSaude(saudeLida);
        ({ posvenda, freteHist, conferir, cert, anom, rateio, fat, vb, rep, fechAnt, fechAnt2, fechAtual, canalPlano, perguntas, resumoML, reputacao, remDet, semanal, contasLista, dadosC, nfeV } = ext);
        if (vista !== 'atual' && vista !== 'todas' && !contasLista.some(x => x.sellerId === vista)) vista = 'atual';
        compHist = ch || {}; concDe = {}; permCat = pc; compCat = (kc && kc.porItem) || {}; afil = af || null; roboPromo = rpr || null; vbA = va || null; catA = cta || null; coresA = cor || {};
        simDe = {}; its0.forEach(it => { const x = sims['sim:' + ct + ':' + it.itemId]; if (x && x.hoje) simDe[it.itemId] = x; });
        idsComp.forEach(id => { const x = cc['conc:' + ct + ':' + id]; if (x) concDe[id] = x; });

        carregado = true;
        cfg = c; snap = s; status = statusDoFundo(st); anuncios = an; guia = g; conta = ct; contas = cts || {};
        itens = its; skuDe = sd; propsPorFam = ppf; skusFam = sf; famDeItem = fdi; grupos = grs;
        custoFam = cs.custoFam; custoProp = cs.custoProp; custoGrupo = cs.custoGrupo;
        resumos = grupos.map(gr => ({ g: gr, r: P.resumoSku(gr, (custoGrupo[gr.chave] || {}).dados || null, cfg) }));
        blingLigado = !!(blg && blg.clientId && blg.clientSecret && blg.refresh);
        tinyToken = tinyRecusado ? '' : (tk && tk.token) || '';   // token recusado pelo Tiny: pede outro (o velho fica guardado até o novo ser aceito)
        fretes = fr; vendas = vd; icone = ic; cadSku = cad; adsSnap = ad || null; fechMes = fch || null; vm = vms; full = fu || null; remessas = rem || null; mesesLidos = lidos || []; custosMl = cml || {};
        retratos = {}; if (ct) retratos[ct] = its; outras.forEach((id, i) => { if (rts[i]) retratos[id] = rts[i].itens || []; });
        entreContas = P.contasCompetindo(retratos, nomesContas(), sku => (cadSku[SHC.chaveSku(sku)] || {}).ean || '');   // nome = apelido de Ajustes ou "Conta …1234", nunca o do ML

        // Etiqueta no ML → "ver no Copiloto": shc:foco = {aba, itemId}. Vai direto e apaga o foco.
        if (foco) {
            abreAba(P.ABAS.indexOf(foco.aba) >= 0 ? foco.aba : 'frete');
            if (foco.itemId && aba === 'frete') { freteDet = String(foco.itemId); confirmouMedidas = false; freteExpl = false; }
            if (foco.itemId && aba === 'ads') adsDet = String(foco.itemId);
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
            'perguntas:' + c, 'resumo:' + c, 'reputacao:' + c, 'remessas:' + c + ':detalhe', 'resumo:' + c + ':semanal', 'nfe:' + c + ':' + SHC.hoje().slice(0, 7), 'nfe:' + c + ':' + mesAnt, 'fech:' + c + ':' + P.mesMenos(mesAnt, 1), 'fech:' + c + ':' + SHC.hoje().slice(0, 7)];
        const r = await chrome.storage.local.get(ks), v = k => (r[k] === undefined ? null : r[k]);
        const sf = v('shc:canal:sel'), pl = sf ? await SHC.lerChave('shc:canal:plano:' + sf) : null;
        // Contas vistas neste Chrome (só ids e apelidos dados em Ajustes); os dados das outras só quando há mais de uma.
        let cs = [], dc = [];
        try { cs = SHC.contas ? await SHC.contas() : []; dc = cs.length > 1 && SHC.dadosContas ? await SHC.dadosContas(SHC.hoje().slice(0, 7)) : []; } catch (e) { cs = []; dc = []; }
        return { posvenda: v(ks[0]), freteHist: v(ks[1]), conferir: v(ks[2]), cert: v(ks[3]), anom: v(ks[4]), rateio: v(ks[5]), fat: v(ks[6]), vb: v(ks[7]), rep: v(ks[8]), fechAnt: v(ks[9]),
            canalPlano: pl && Array.isArray(pl.plano) ? pl : null, perguntas: v(ks[11]), resumoML: v(ks[12]), reputacao: v(ks[13]), remDet: v(ks[14]), semanal: v(ks[15]), contasLista: cs, dadosC: dc,
            nfeV: [v(ks[16]), v(ks[17])], fechAnt2: v(ks[18]), fechAtual: v(ks[19]) };   // v3.1: mês retrasado (comparar os custos); o atual (ciclo da fatura)
    }
    // A rodada lenta grava fotos:/visitas: a cada anúncio: aí só a Saúde e os Alertas são redesenhados (sem reler o resto).
    let geracaoSaude = 0;
    async function soSaude(ks) {
        const eu = ++geracaoSaude, sd = await lerSaude(conta), cat = (ks || []).some(k => /^cat:/.test(k)) ? await SHC.lerChave('cat:' + (conta || 'atual')) : undefined;
        if (eu !== geracaoSaude) return;
        usaSaude(sd);
        if (cat !== undefined) { catA = cat || null; if (aba === 'geral') desenhaGeral(); if (aba === 'conciliacao') $('#geralFam').innerHTML = cardFamilia(); }   // v2.6: a rodada lenta leu a categoria de mais um anúncio
        if ((ks || []).some(k => /^catcomp:/.test(k))) { const kc = await SHC.lerChave('catcomp:' + (conta || 'atual')); if (eu !== geracaoSaude) return; compCat = (kc && kc.porItem) || {}; if (aba === 'catalogo' && compAberto) desenhaCatalogo(); }   // v3.1: competição lida na tela "Alterar anúncio"
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
    // as contas" (v2.8, pedido da dona: "preciso que seja exibido o nome da conta e o ID dela não somente o ID").
    // v3.1 (ESPEC §3, imagem tela-catalogo): pílula com iniciais, bolinha verde, APELIDO de Ajustes em negrito e "ID <inteiro>" embaixo
    // (P.contaTopo: nunca o nome da conta do ML; sem apelido → "Dê um nome a esta conta", que abre o campo de apelido em Ajustes).
    // Com 2+ contas, um <select> transparente por cima da pílula troca a vista (conta aberta, outra conta, Todas as contas).
    const DAR_NOME = 'Dê um nome a esta conta';
    const pilula = (ini, nome, temNome, sub) => `<span class="av" aria-hidden="true">${esc(ini || '✎')}</span><span class="ct"><b${temNome ? '' : ' class="pede"'}>${esc(nome)}</b><small>${esc(sub)}</small></span>`;
    function desenhaConta() {
        const el = $('#nomeConta');
        if (!el || focoEm('#selConta')) return;
        const chev = '<svg class="i chev" aria-hidden="true"><use href="#i-chev"/></svg>';
        if (contasLista.length > 1) {
            const vid = vista === 'atual' ? ((contasLista.find(c => c.atual) || {}).sellerId || conta) : vista;
            const p = vista === 'todas' ? null : P.contaTopo(vid, cfg);
            const vis = p ? pilula(p.iniciais, p.temNome ? p.nome : DAR_NOME, p.temNome, p.idTxt) : pilula(String(contasLista.length), 'Todas as contas', true, contasLista.length + ' contas');
            el.innerHTML = `<span class="conta-in" aria-hidden="true">${vis}${chev}</span><select id="selConta" aria-label="Conta: ${esc(p ? (p.nome || 'sem nome') + ', ' + p.idTxt : 'Todas as contas')}. Trocar de conta">`
                + contasLista.map(c => { const q = P.contaTopo(c.sellerId, cfg); return `<option value="${esc(c.sellerId)}"${(vista === 'atual' && c.atual) || vista === c.sellerId ? ' selected' : ''}>${esc((q.nome || 'Sem nome') + ' · ' + q.idTxt)}${c.atual ? ' (aberta no ML)' : ''}</option>`; }).join('')
                + `<option value="todas"${vista === 'todas' ? ' selected' : ''}>Todas as contas</option><option value="nomes">Dar nome às contas…</option></select>`;
            el.title = p ? `${p.nome || 'Sem nome'} · ${p.idTxt}` : 'Todas as contas';
        } else if (conta) {
            const p = P.contaTopo(conta, cfg);
            el.innerHTML = `<button type="button" class="conta-in" data-ir-apelido aria-label="${esc(p.temNome ? 'Conta ' + p.nome + ', ' + p.idTxt + '. Mudar o nome' : DAR_NOME + ', ' + p.idTxt)}">${pilula(p.iniciais, p.temNome ? p.nome : DAR_NOME, p.temNome, p.idTxt)}</button>`;
            el.title = p.temNome ? `${p.nome} · ${p.idTxt} · toque para mudar o nome` : `${DAR_NOME} · ${p.idTxt}`;
        } else { el.innerHTML = `<span class="conta-in">${pilula('', 'Conta não lida', true, 'abra o ML e sincronize')}</span>`; el.title = ''; }
        if (el.classList) el.classList.toggle('sem', !(contasLista.length > 1 || conta));   // sem conta conhecida: bolinha cinza
    }
    // "Dê um nome a esta conta" → Ajustes, com o campo de apelido desta conta em foco (#cardContas).
    function irApelido() {
        abreAba('ajustes');
        setTimeout(() => {
            const c = $('#cardContas'), i = (conta && document.querySelector('[data-apelido="' + String(conta).replace(/[^0-9]/g, '') + '"]')) || document.querySelector('[data-apelido]');
            if (c && c.scrollIntoView) c.scrollIntoView({ block: 'start' });
            if (i && i.focus) i.focus();
        }, 60);
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
        // v3.1 topo, linha 2: "✓ Atualizado às HH:MM · próxima às HH:MM" (a próxima só quando o alarme já foi lido).
        $('#st').innerHTML = SHC.htmlSync(status, agora) + (s.estado === 'ok' && proxSync && proxSync > agora ? `<span class="st-px">· próxima às ${esc(SHC.hhmm(proxSync))}</span>` : '');
        stGeral();
        const bt = $('#sincronizar');
        bt.textContent = s.estado === 'erro' || syncFalhou ? 'Tentar de novo' : 'Sincronizar agora';
        bt.title = bt.textContent;   // em 320 px o botão vira ↻: o title diz o que ele faz
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
    // Topo de cada aba: só "Parcial" (1ª leitura) e a etapa lendo — a página começa pela manchete (ESPEC §3).
    // Os alertas só deste módulo vão para o fim da aba (#fa-<aba>), recolhidos, com o MESMO número da bolinha da aba (P.nAlerta).
    let alertasAgora = null;
    function desenhaTopoAba() {
        desenhaContadores();   // v3.1: contador de cada aba, sino e "Todas"
        const el = $('#ta-' + aba);
        if (!el) return;
        // Mesma lógica da Geral em cada aba: a leitura dela (se está rodando agora) no topo, os resultados (já lidos) depois.
        let lendo = !preparando() && ETAPAS_ABA[aba] ? SHC.htmlEtapa(status, ETAPAS_ABA[aba]) : '';
        if (aba === 'ads' && !lendo) lendo = SHC.htmlAdsSemAba(status);   // Ads pulado: não havia aba do painel do vendedor aberta
        el.innerHTML = parcialHtml() + lendo;
        const fim = $('#fa-' + aba);
        if (!fim) return;
        const lista = alertasAgora ? P.alertasDaAba(aba, alertasAgora, anom, conta) : [], k = 'al:' + aba, n = lista.reduce((s, i) => s + P.nAlerta(i), 0);
        const urg = lista.some(i => !!i.vermelho || i.tipo === 'pagamento');
        fim.innerHTML = lista.length ? `<div class="card alab"><div class="gb-l"><i class="dot ${urg ? 'ruim' : 'atencao'}"></i><b>Alertas desta aba</b><span class="gb-v">${esc(SHC.qtd(n, 'alerta', 'alertas'))}</span>${btVer(k, 'Ver', 'Esconder')}</div>`
            + (aberto(k) ? '<div class="gb-c">' + lista.map(i => `<div class="linha-comp"><b>${esc(i.rot)}${i.titulo ? ' · ' + esc(i.titulo) : ''}</b><small>${esc(i.texto)}</small>`
                + (i.link && /^https:\/\/([a-z]+\.)*mercadolivre\.com\.br\//.test(i.link) ? `<a class="lnk" href="${esc(i.link)}" target="_blank" rel="noopener" style="font-size:11.5px">${esc(i.linkTxt || 'Abrir Gestão de envios Full')}</a>` : '') + '</div>').join('') + '</div>' : '')
            + '</div>' : '';
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
    // v3.1 perfumaria (29/09): etiqueta com o mesmo vocabulário e cores da tela do ML (Dá lucro / Abaixo da meta / Prejuízo).
    const SIT_PROMO = { lucrativo: 'ok', apertado: 'at', prejuizo: 'pr', sem_custo: '' };
    const ETQ_PROMO = { lucrativo: 'Dá lucro', apertado: 'Abaixo da meta', prejuizo: 'Prejuízo' };
    const etqPromo = (classe, sobra, pct) => sobra === null || sobra === undefined ? '<span class="etq ne"><span class="st">+ Informar custo</span></span>'
        : `<span class="etq ${SIT_PROMO[classe] || 'ne'}"><span class="st">${ETQ_PROMO[classe] || 'Sem cálculo'}</span><span class="vl">${esc(SHC.moeda(sobra))} <small>· ${esc(SHC.pctTxt(pct))}</small></span></span>`;
    const melhorLinha = r => r.props.filter(l => l.sobra !== null).reduce((a, b) => (!a || b.sobra > a.sobra ? b : a), null);
    // Nome curto sem cortar palavra no meio ("Caixa de som portátil"), para caber na manchete e no KPI.
    const nomeCurto = (t, n) => { const ps = String(t || '').split(/\s+/); let s = ps[0] || ''; for (let i = 1; i < ps.length && (s + ' ' + ps[i]).length <= n; i++) s += ' ' + ps[i]; return s.length > n ? curtoTxt(s, n) : s; };
    // Manchete: 1 frase com a pior situação da aba (prejuízo > abaixo da meta > ok); o robô, quando ligado, abre a frase.
    function manchetePromo(todos, lig, sugs, mTxt) {
        if (!todos || !todos.length) return '';
        const pr = todos.filter(r => r.classe === 'prejuizo'), at = todos.filter(r => r.classe === 'apertado'), sc = todos.filter(r => r.classe === 'sem_custo');
        const lu = todos.length - pr.length - at.length - sc.length, meta = SHC.pctTxt(SHC.num(cfg.margem_alvo_pct) || 0);
        const pt = pr.length ? 'pr' : (at.length ? 'at' : (lu ? 'ok' : ''));
        const nome1 = r => nomeCurto(r.f.titulo, 24);
        const resto = pr.length ? (pr.length === 1 ? `${nome1(pr[0])} dá prejuízo ${pr[0].props.length > 1 ? 'em todas' : 'na promoção'}.` : `${SHC.qtd(pr.length, 'produto dá', 'produtos dão')} prejuízo em todas.`)
            : at.length ? `${SHC.qtd(at.length, 'produto fica', 'produtos ficam')} abaixo da meta.` : sc.length ? `Falta o custo de ${SHC.qtd(sc.length, 'produto', 'produtos')}.` : 'Entre pelo Mercado Livre.';
        if (lig) return sugs.length ? `<p class="manchete"><span class="pt ${pt}"></span><b>O robô achou ${esc(SHC.qtd(sugs.length, 'promoção que mantém', 'promoções que mantêm'))} a sua margem mínima de ${esc(mTxt)}.</b> ${esc(resto)}</p>`
            : `<p class="manchete"><span class="pt ${pt}"></span><b>Nenhuma promoção mantém a sua margem mínima de ${esc(mTxt)} agora.</b> ${esc(pr.length || at.length || sc.length ? resto : 'O robô confere de novo a cada sincronização.')}</p>`;
        const [fato, acao] = pr.length ? [`${SHC.qtd(pr.length, 'produto dá', 'produtos dão')} prejuízo nas promoções.`, 'Não entre nelas.']
            : at.length ? [`${SHC.qtd(at.length, 'produto fica', 'produtos ficam')} abaixo da meta de ${meta}.`, 'Veja a melhor opção de cada um.']
            : lu ? [`${SHC.qtd(lu, 'produto dá', 'produtos dão')} lucro nas promoções.`, 'Ligue o robô para ver as melhores.']
            : [`Falta o custo de ${SHC.qtd(sc.length, 'produto', 'produtos')}.`, 'Informe para ver o lucro.'];
        return `<p class="manchete"><span class="pt ${pt}"></span><b>${esc(fato)}</b> ${esc(acao)}</p>`;
    }
    // "Precisa de você": produtos em que nenhuma proposta dá lucro (vermelho) + "Abaixo da sua meta" atrás do Ver mais.
    function precisaPromo(todos) {
        if (!todos || !todos.length) return '';
        const pr = todos.filter(r => r.classe === 'prejuizo'), at = todos.filter(r => r.classe === 'apertado');
        const linha = (r, cls) => {
            const m = melhorLinha(r), n = r.props.length;
            const sub = cls === 'pr' ? (n > 1 ? `nenhuma das ${n} propostas dá lucro` : 'a proposta dá prejuízo') : (m ? `a melhor: ${m.p.promo} · margem ${SHC.pctTxt(m.pct)}` : '');
            return `<li class="acao ${cls}"><div class="tx"><b title="${esc(r.f.titulo)}">${esc(r.f.titulo)}</b><span>${esc(sub)}</span></div>`
                + (m ? `<div class="pr-v ${cls}"><b>${esc(SHC.moeda(m.sobra))}</b><small>${cls === 'pr' ? 'na melhor' : 'por venda'}</small></div>` : '') + '</li>';
        };
        let h = '<div class="card" id="promoPrecisa"><div class="ch"><h3>Precisa de você</h3><button class="ajuda" type="button" title="Produtos em que nenhuma proposta de promoção dá lucro, depois de tarifa, frete, imposto e custo. Não entre nelas." aria-label="Ajuda: Precisa de você">?</button></div>';
        if (pr.length) {
            const n = aberto('promo:prj') ? pr.length : 3;
            h += '<ul class="acoes">' + pr.slice(0, n).map(r => linha(r, 'pr')).join('') + '</ul>'
                + (pr.length > 3 ? `<p class="rs">${esc(SHC.qtd(pr.length - 3, 'outro produto', 'outros produtos'))} com prejuízo ${btVer('promo:prj')}</p>` : '');
        } else h += `<p class="est vazio"><span><b>Nenhum produto dá prejuízo.</b> ${at.length ? 'Confira os que ficam abaixo da meta.' : 'Todos com custo batem a sua meta.'}</span></p>`;
        if (at.length) h += `<div class="pr-mais"><span>Abaixo da sua meta (${at.length})</span>${btVer('promo:abaixo')}</div>`
            + (aberto('promo:abaixo') ? '<ul class="acoes pr-abaixo">' + at.map(r => linha(r, 'at')).join('') + '</ul>' : '');
        return h + '</div>';
    }
    function desenhaRoboPromo(todos) {
        const lig = !!rpCfg().ligado, margem = SHC.roboPromoMargem(cfg), mTxt = SHC.pctTxt(margem), sugs = sugestoesRobo();
        const mP = SHC.num(rpCfg().margem_pct), padrao = String(SHC.num(cfg.margem_alvo_pct) || 0).replace('.', ',');
        const meta = SHC.num(cfg.margem_alvo_pct) || 0;
        $('#promoTopo').innerHTML = snap ? manchetePromo(todos, lig, sugs, mTxt) : '';
        let h = '';
        const hist = ((roboPromo && roboPromo.historico) || []).slice(-30).reverse();
        const histHtml = !hist.length ? '' : `<div class="hist-l"><span>Histórico do robô · ${esc(SHC.qtd(hist.length, 'sugestão guardada', 'sugestões guardadas'))}</span>${btVer('robopromo:hist')}</div>`
            + (aberto('robopromo:hist') ? '<ul class="tl">' + hist.map(x => `<li class="ok"><div class="dt">${esc(P.quando(x.ts))} · sugeriu</div><div class="ev">${esc((x.titulo || x.itemId) + ' · ' + x.promo)}</div>`
                + `<div class="sub">margem ${esc(SHC.pctTxt(x.pct))} · sobra ${esc(SHC.moeda(x.sobra))} por venda</div></li>`).join('') + '</ul>' : '');
        if (lig && sugs.length) {
            const n = aberto('robopromo:sug') ? sugs.length : 5;
            h += `<div class="card" id="promoSugere"><div class="ch"><h3>O robô sugere entrar</h3><span class="selo ok">${esc(SHC.qtd(sugs.length, 'promoção', 'promoções'))}</span></div><ul class="acoes">`
                + sugs.slice(0, n).map(s => {
                    const cl = s.pct >= meta ? 'lucrativo' : (s.sobra > 0 ? 'apertado' : 'prejuizo');
                    return `<li class="acao ${SIT_PROMO[cl]} sug"><div class="tx"><b title="${esc(s.titulo + ' · ' + s.promo)}">${esc(s.titulo || s.itemId)}</b><span>${esc(s.promo)}</span>`
                        + `<div class="lin">${s.datas ? `<span class="prazo">${esc(s.datas)}</span>` : ''}${etqPromo(cl, s.sobra, s.pct)}</div></div>`
                        + '<button class="bt pq ml" data-abrir-ml title="Abre a Central de promoções do Mercado Livre. Quem entra é você.">Entrar no ML</button></li>';
                }).join('') + '</ul>'
                + (sugs.length > 5 ? `<p class="rs">${esc(SHC.qtd(sugs.length - 5, 'outra promoção', 'outras promoções'))} ${btVer('robopromo:sug')}</p>` : '')
                + histHtml + '</div>';
        } else if (hist.length) h += `<div class="card">${histHtml}</div>`;
        const auto = SHC.PROMO_ADESAO_CONFERIDA === true;
        const robo = `<div class="card" id="cardRoboPromo"><div class="robo-top${lig ? '' : ' off'}"><span class="ic" aria-hidden="true"><svg><use href="#ip-robo"></use></svg></span><div class="nm"><b>Robô de promoções</b><span>${lig ? 'Ligado · só mostra o que deixa a sua margem' : 'Desligado · ligue para ver o que deixa a sua margem'}</span></div>`
            + `<input type="checkbox" class="tg" id="roboLigado"${lig ? ' checked' : ''} aria-label="Ligar o robô de promoções"></div>`
            + `<div class="robo-cfg"><label for="margemRobo"><b>Margem mínima</b><span>depois de tarifa, frete e imposto${mP === null ? ' · hoje é a sua meta' : ''}</span></label>`
            + `<div class="sufixo"><input class="inp" id="margemRobo" inputmode="decimal" placeholder="${esc(padrao)}" value="${mP === null ? '' : esc(String(mP).replace('.', ','))}"><span>%</span></div><button class="bt pq" data-robopromo-margem>Salvar</button></div>`
            + '<div class="opcs" role="radiogroup" aria-label="O que o robô faz">'
            + '<label class="opc on"><input type="radio" name="modoRoboPromo" checked><span><b>Sugerir</b>Mostra as promoções boas; você entra com 1 toque no ML.</span></label>'
            + `<label class="opc off" title="Precisa da sua autorização: o Copiloto ainda não entra sozinho."><input type="radio" name="modoRoboPromo"${auto ? '' : ' disabled'}><span><b>Entrar sozinho <span class="selo">em breve</span></b>Precisa da sua autorização: o Copiloto ainda não entra sozinho.</span></label></div>`
            + `<p class="det" id="roboPromoMsg" role="status">${esc(roboPromoMsg)}</p></div>`;
        const esq = precisaPromo(todos) + h;
        $('#roboPromo').innerHTML = esq ? `<div class="pr-grade"><div class="pr-col">${esq}</div><div class="pr-col">${robo}</div></div>` : robo;
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
        const todos = snap && snap.familias.length ? snap.familias.map(f => resumoFamilia(f)) : null;
        desenhaRoboPromo(todos);
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
            $('#promoVer').hidden = true; $('#promoTodos').hidden = true; $('#promoMais').hidden = false;
            return;
        }
        // Recolhido: só os números (tocar num número abre a lista filtrada); "Ver os N produtos" abre a lista inteira.
        const ab = aberto('promo:lista'), pv = $('#promoVer');
        pv.hidden = false; pv.textContent = ab ? 'Ver menos' : 'Ver ' + SHC.qtd(todos.length, 'produto', 'produtos');
        $('#promoTodos').hidden = false;
        $('#promoTodosRs').textContent = SHC.qtd(todos.reduce((s, r) => s + r.props.length, 0), 'proposta', 'propostas') + ' · busca · “por que esta é a melhor?”';
        $('#promoMais').hidden = !ab;
        // KPIs com a cor da situação; cada um filtra a lista (tocar de novo tira o filtro).
        const n = c => todos.filter(r => r.classe === c).length, um = c => { const x = todos.filter(r => r.classe === c); return x.length === 1 ? nomeCurto(x[0].f.titulo, 22) : ''; };
        const subK = { lucrativo: 'de ' + SHC.qtd(todos.length, 'produto', 'produtos'), apertado: 'meta ' + SHC.pctTxt(SHC.num(cfg.margem_alvo_pct) || 0),
            prejuizo: um('prejuizo') || (n('prejuizo') ? 'em todas as propostas' : 'nenhum'), sem_custo: um('sem_custo') || (n('sem_custo') ? 'informe o custo' : 'todos com custo') };
        $('#kpis').innerHTML = ['lucrativo', 'apertado', 'prejuizo', 'sem_custo'].map(c =>
            `<button class="kpi kn ${n(c) ? SIT_PROMO[c] : ''}${filtro === c ? ' on' : ''}" data-filtro="${c}" aria-pressed="${filtro === c}"><span class="l">${ROTULO[c]}</span><span class="v">${n(c)}</span><span class="s">${esc(subK[c])}</span></button>`).join('');
        const b = busca.trim().toLowerCase();
        const lista = todos.filter(r => (!filtro || r.classe === filtro) && (!b || r.f.titulo.toLowerCase().indexOf(b) >= 0 || r.skus.some(s => s.toLowerCase().indexOf(b) >= 0)));
        alvo._lista = lista;
        if (!ab) { alvo.innerHTML = ''; return; }
        if (!lista.length) { alvo.innerHTML = falhaPromo + '<div class="vazio">Nenhum produto neste filtro.</div>'; return; }
        // v3.1 (imagem aprovada): chip "Robô: entrar (≥ 10%)" na proposta que o robô sugere (mesma conta do cartão "O robô sugere entrar").
        const sugRobo = new Set(sugestoesRobo().map(s => s.itemId + '|' + s.promo + '|' + s.preco));
        const chipRobo = sugRobo.size ? `<span class="robo-chip" title="O robô de promoções sugere entrar: fica acima da sua margem mínima.">Robô: entrar (≥ ${esc(SHC.pctTxt(SHC.roboPromoMargem(cfg)))})</span>` : '';
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
                // v3.1: etiqueta igual à da Central de promoções no ML; tarifa, envio e imposto só no "Ver a conta".
                const selo = r.rec && r.rec.escolha === l
                    ? (r.rec.tipo === 'ideal' ? '<span class="melhor">★ Melhor opção</span>' : (r.rec.tipo === 'aproximada' ? '<span class="melhor aprox">≈ Mais perto da meta</span>' : ''))
                    : '';
                return `<div class="prop${selo ? ' destaque' : ''}"><div class="l1p"><span class="nome" title="${esc(p.promo)}">${esc(p.promo)}</span><span class="datas">${esc(p.datas)}${p.desconto_txt ? ' · ' + esc(p.desconto_txt) : ''}</span></div>
                  <div class="l2p"><span class="preco">${SHC.moeda(p.preco)}</span><span class="recebe">você recebe ${SHC.moeda(p.recebe)}</span></div>
                  <div class="l3p">${etqPromo(l.classe, l.sobra, l.pct)}${selo}${sugRobo.has(p.itemId + '|' + p.promo + '|' + p.preco) ? chipRobo : ''}</div>
                  <details class="pdet"><summary>Ver a conta</summary><div class="det">Tarifa ${SHC.moeda(p.tarifa)}${p.tipo ? ' (' + esc(p.tipo) + ')' : ''} · Envio ${p.envio ? SHC.moeda(p.envio) : 'do comprador'}${l.imposto ? ' · Imposto ' + SHC.moeda(l.imposto) : ''}</div></details></div>`;
            }).join('') + (r.props.length > 3 && !abertos.has(chave) ? `<button class="mais" data-abrir="${esc(chave)}">+ ${SHC.qtd(r.props.length - 3, 'proposta', 'propostas')}</button>` : '')
                + notaRecomendacao(r)
                : '<div class="det" style="margin-top:8px">Sem proposta de promoção para este produto agora.</div>';
            const expl = `<button class="lnk explique" data-explique="${esc(chave)}">${explicando === chave ? 'Fechar explicação' : (r.rec && r.rec.tipo === 'ideal' ? 'Por que esta é a melhor?' : 'Explique estas propostas')}</button>` + (explicando === chave ? caixaExplica(r) : '');
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
    // v3.1 (imagem tela-frete aprovada pela dona): KPI em R$ inteiro, variação com sinal e o bloco recolhido "título + resumo · Ver mais".
    const rs0 = v => 'R$ ' + Math.round(v).toLocaleString('pt-BR');
    const pctSin = v => (v > 0 ? '+' : v < 0 ? '−' : '') + SHC.pctTxt(Math.abs(v));
    const blocoFr = (k, titulo, resumo, dentro) => `<div class="card fr-bl"><div class="fr-cab"><div class="fr-t"><h3>${esc(titulo)}</h3><span>${resumo}</span></div>${dentro ? btVer(k) : ''}</div>${dentro && aberto(k) ? '<div class="fr-in">' + dentro + '</div>' : ''}</div>`;
    // Selo de variação de cada anúncio na lista (sit = P.situacaoFrete): subiu (vermelho/âmbar), caiu, estável, sem histórico, pelo comprador.
    function seloFrete(l, sit) {
        if (l.comprador) return '<span class="selo cz">pelo comprador</span>';
        const fa = l.fa, cobV = fa && fa.ult30 && fa.ult30.pedidos && typeof fa.variacaoPct === 'number' ? fa.variacaoPct : null;
        const v = cobV !== null ? cobV : (l.h && l.h.anterior !== null ? l.h.varPct : null);
        if (l.subiu) return `<span class="selo ${sit === 'ruim' ? 'pr' : 'at'}">subiu${typeof v === 'number' ? ' ' + esc(pctSin(v)) : ''}</span>`;
        if (typeof v === 'number' && v < 0) return `<span class="selo ok">caiu ${esc(pctSin(v))}</span>`;
        return (fa && fa.ult30 && fa.ult30.pedidos) || l.h ? '<span class="selo cz">estável</span>' : '';   // sem dado: o chip ao lado já diz "sem pedido/sem histórico"
    }
    function desenhaFrete() {
        const alvo = $('#listaFrete'), topo = $('#freteTopo');
        if (!itens.length) {
            alvo.innerHTML = '<div class="vazio"><b>Lista de anúncios ainda não lida</b>O frete de cada anúncio da sua conta aparece aqui depois da próxima sincronização.<br><br><button class="bt leve" data-abrir-anuncios>Abrir meus anúncios no ML</button></div>';
            topo.innerHTML = ''; topo.hidden = true;
            return;
        }
        if (freteDet) { const it = itens.find(x => x.itemId === freteDet); if (it) { topo.hidden = true; return desenhaFreteDetalhe(it); } freteDet = null; }
        topo.hidden = false;
        // A busca fica dentro da lista redesenhada: guarda o foco e o cursor para devolver depois.
        const ae = document.activeElement, foco = ae && ae.id === 'buscaFrete' ? (ae.selectionStart || 0) : null;
        const cob = P.temFreteCob(freteHist), ct = cob ? freteHist.conta : null, cc = P.concDe(freteHist), conc = P.concFrete(cc), semLer = P.freteSemLeitura(freteHist);
        const linhas = linhasFrete().sort((a, b) => (b.subiu - a.subiu) || (varDe(b) - varDe(a)));
        const subiram = linhas.filter(l => l.subiu).length, pa = (cc && cc.pagoAMais) || [], idsAMais = new Set(pa.map(p => p.itemId));
        const paSeguro = pa.filter(p => !p.talvezUnidades).length, paTalvez = pa.length - paSeguro;   // v3.1: * = pode ter 2+ unidades (fora do total)
        const temVendas = itens.some(it => Object.keys(vendas[it.itemId] || {}).length);
        const rk = temVendas ? P.rankingFrete(itens, vendas) : null;
        freteN = linhas.length;
        // Subidas em números (as mesmas do chamado) e o lucro de hoje de cada anúncio.
        const hojeD = SHC.hoje(), subs = linhas.filter(l => l.subiu).map(l => ({ l, s: P.subidaFrete(l, vendas[l.it.itemId], hojeD), so: sobraDe(l.it) })).filter(x => x.s);
        const prej = x => !!(x.so && x.so.sobra !== null && x.so.sobra < 0), dd = d => P.dataBr(d).slice(0, 5);
        // Manchete: 1 frase, a pior situação primeiro.
        const x0 = subs[0];
        const [ptM, fato, acao] = subiram ? [subs.some(prej) ? 'pr' : 'at', SHC.qtd(subiram, 'frete subiu', 'fretes subiram') + ':',
                x0 ? `${nomeCurto(x0.l.it.titulo, 22)} ${mais(x0.s.dif)} por envio${x0.s.desde ? ' desde ' + dd(x0.s.desde) : ''}${x0.s.porMes > 0 ? ` (${rs0(x0.s.porMes)} a mais por mês)` : ''}.` : 'Veja os anúncios em “Frete por anúncio”.']
            : paSeguro ? ['at', SHC.qtd(paSeguro, 'pedido cobrado', 'pedidos cobrados') + ' acima do frete do anúncio.', `Confira e peça revisão (${SHC.moeda(cc.totalAMais || 0)}).`]
            : cob ? ['ok', 'Nenhum frete subiu.', `Últimos 30 dias: ${rs0(ct.ult30.total)} em ${SHC.qtd(ct.ult30.pedidos, 'pedido', 'pedidos')}.`]
            : ['', 'Nenhum frete subiu na lista do ML.', 'O frete de cada pedido chega com o Faturamento.'];
        // KPIs (#freteTopo): cada um filtra a lista "Frete por anúncio" (tocar de novo tira o filtro).
        const kB = (f, cls, rot, v, s) => `<button class="kpi kn ${cls}${f && freteFiltro === f ? ' on' : ''}" data-ffiltro="${f}" aria-pressed="${!!f && freteFiltro === f}"><span class="l">${rot}</span><span class="v">${v}</span><span class="s">${s}</span></button>`;
        const nComp = linhas.filter(l => l.comprador).length, d1 = subiram === 1 && x0 && x0.s.desde ? ' · ' + dd(x0.s.desde) : '';
        const kSub = kB('subiu', subiram ? (subs.some(prej) ? 'pr' : 'at') : '', 'Frete subiu', String(subiram), esc((subiram === 1 ? 'anúncio' : 'anúncios') + d1));
        const kGra = f => kB(f, '', 'Frete grátis', `${linhas.length - nComp} de ${linhas.length}`, esc(nComp ? nComp + ' pelo comprador' : 'todos por sua conta'));
        let kp;
        if (cob) {
            const u = ct.ult30, vp = P.varPct(ct.variacaoPct);
            kp = kB('', '', 'Últimos 30 dias', rs0(u.total), esc(SHC.qtd(u.pedidos, 'pedido', 'pedidos') + (vp && !semLer ? ' · ' + vp + ' por pedido' : ''))) + kSub
                + (conc ? kB('amais', paSeguro ? 'pr' : '', 'Pago a mais', SHC.moeda(cc.totalAMais || 0), esc('em ' + SHC.qtd(paSeguro, 'pedido', 'pedidos'))) : kGra('gratis'));
        } else kp = '<div class="kpi kn"><span class="l">Últimos 30 dias</span><span class="v">—</span><span class="s">ainda não lido</span></div>' + kSub + kGra('gratis');
        topo.innerHTML = `<p class="manchete"><span class="pt ${ptM}"></span><b>${esc(fato)}</b> ${esc(acao)}</p><div class="kpis k3">${kp}</div>`
            + (cob ? '' : `<p class="nota"><span class="auto"></span><span>${esc(P.freteSemDado(freteHist, status, Date.now()))}</span></p>`);
        // [A] Precisa de você: cada frete que subiu (de → para, data, lucro de hoje) + "Pedir revisão ao ML" (abre o chamado pronto).
        const liSub = (x, bt) => { const c = prej(x) ? 'pr' : 'at', s = x.s, t = x.l.it.titulo;
            return `<li class="acao ${c}"><div class="tx"><b title="${esc(t)}">${esc(t)}</b><span>${SHC.moeda(s.de)} → ${SHC.moeda(s.para)}${s.desde ? ' em ' + dd(s.desde) : ''} · ${x.so && x.so.sobra !== null ? (prej(x) ? 'dá prejuízo' : 'ainda dá lucro') : 'sem custo'}</span></div>`
                + `<div class="fr-v ${c}"><b>${s.pct !== null ? esc(pctSin(s.pct)) : esc(mais(s.dif))}</b><small>${esc(mais(s.dif))}/envio</small></div>${bt ? `<button class="bt pq" data-frete-det="${esc(x.l.it.itemId)}" data-frete-ir="frChamado">Revisão</button>` : ''}</li>`; };
        let A = '<div class="card" id="fretePrecisa"><div class="ch"><h3>Precisa de você</h3><button class="ajuda" type="button" title="O ML recalcula o frete pelo peso e pelas medidas do anúncio. Se você não mudou nada, peça a revisão com o texto pronto." aria-label="Ajuda: Precisa de você">?</button></div>';
        if (subs.length) {
            const um = subs.length === 1, id = esc(subs[0].l.it.itemId);
            A += '<ul class="acoes">' + subs.slice(0, 3).map(x => liSub(x, !um)).join('') + '</ul>'
                + (subs.length > 3 ? `<p class="rs">Mais ${esc(SHC.qtd(subs.length - 3, 'anúncio', 'anúncios'))} em “Frete por anúncio”.</p>` : '')
                + (um ? `<div class="linha-bts"><button class="bt pq" data-frete-det="${id}" data-frete-ir="frChamado">Pedir revisão ao ML</button><button class="bt pq leve" data-abrir-anuncio="${id}">Ver o anúncio</button></div>` : '');
        } else if (subiram) A += `<p class="est"><span><b>${esc(SHC.qtd(subiram, 'frete subiu', 'fretes subiram'))} só na lista do ML.</b> Sem pedido que mostre a subida ainda.</span></p>`;
        else if (paSeguro) A += `<p class="est"><span><b>Nenhum frete subiu.</b> Confira os pedidos cobrados a mais, logo abaixo.</span></p>`;
        else A += `<p class="est vazio"><span><b>Nenhum frete subiu.</b> Nada para contestar agora.</span></p>`;
        A += '</div>';
        // [A] Cobrado a mais (conciliação por pedido), em barras por anúncio; os pedidos com * (talvez 2+ unidades) ficam fora do total.
        if (conc && pa.length) {
            const g = {}; pa.filter(p => !p.talvezUnidades).forEach(p => { const y = g[p.itemId] = g[p.itemId] || { id: p.itemId, n: 0, v: 0 }; y.n++; y.v = SHC.r2(y.v + (p.diferenca || 0)); });
            const gs = Object.keys(g).map(k => g[k]).sort((a, b) => b.v - a.v), mx = gs.length ? gs[0].v : 0;
            A += `<div class="card" id="freteAMais"><div class="ch"><h3>Cobrado a mais</h3><button class="ajuda" type="button" title="Pedido em que o ML cobrou de frete mais do que o frete do anúncio. Toque no número do pedido para ver a conta linha a linha, igual ao detalhe da venda no ML." aria-label="Ajuda: Cobrado a mais">?</button></div>`
                + (paSeguro ? `<p class="fr-tot"><b class="vm">${SHC.moeda(cc.totalAMais || 0)}</b> em ${esc(SHC.qtd(paSeguro, 'pedido cobrado', 'pedidos cobrados'))} acima do frete do anúncio</p>` : '')
                + gs.slice(0, 5).map(y => `<button class="hb fr-hb" data-frete-det="${esc(y.id)}"><span class="l"><b title="${esc(tituloDe(y.id))}">${esc(tituloDe(y.id))}</b><span class="v">${SHC.moeda(y.v)} <small>· ${esc(SHC.qtd(y.n, 'pedido', 'pedidos'))}</small></span></span><span class="medidor"><i class="pr" style="width:${mx > 0 ? Math.max(4, Math.round(y.v / mx * 100)) : 0}%"></i></span></button>`).join('')
                + (paTalvez ? `<p class="det">${esc(SHC.qtd(paTalvez, 'pedido', 'pedidos'))} com * (${SHC.moeda((cc.talvez && cc.talvez.total) || 0)}): frete bem maior, pode ter mais de 1 unidade. Confira antes de reclamar.</p>` : '')
                + `<p class="rs">${btVer('frete:amais', 'Ver os pedidos', 'Esconder')}</p>`;
            if (aberto('frete:amais')) A += `<table class="tabf"><thead><tr><th>Pedido</th><th>Data</th><th>Cobrado</th><th>Anúncio</th><th>A mais</th></tr></thead><tbody>
                    ${pa.slice(0, 20).map(p => `<tr><td><button class="lnk" data-ver="fped:${esc(p.pedido)}" aria-expanded="${aberto('fped:' + p.pedido)}" title="Ver a conta deste frete">${esc(p.pedido)}${p.talvezUnidades ? '*' : ''}</button></td><td>${esc(P.dataBr(p.data).slice(0, 5))}</td><td>${SHC.moeda(p.cobrado)}</td><td>${SHC.moeda(p.esperado)}</td><td class="mais">+${SHC.moeda(p.diferenca)}</td></tr>`
                        + (aberto('fped:' + p.pedido) ? `<tr class="conta-ped"><td colspan="5">${P.contaFretePedido(p).map(l => `<div class="cl ${l.cls}"><span>${esc(l.rot)}</span><b>${esc(l.val)}</b></div>`).join('')}</td></tr>` : '')).join('')}
                  </tbody>${pa.length > 20 ? `<tfoot><tr><td colspan="5">e mais ${SHC.qtd(pa.length - 20, 'pedido', 'pedidos')}: toque em “Pago a mais” para ver os anúncios</td></tr></tfoot>` : ''}</table>
                  <p class="det">Toque no número do pedido para ver a conta linha a linha, igual ao detalhe da venda no ML.</p>`
                    + (paTalvez ? '<p class="det">* Frete bem maior que o do anúncio: o pedido pode ter mais de 1 unidade. Confira antes de reclamar.</p>' : '');
            A += '</div>';
        }
        // [V] Pedidos afetados: os cobrados acima do frete de antes, desde a subida (os mesmos do chamado).
        const af = subs.filter(x => x.s.desde).map(x => ({ x, p: P.pedidosAMais(vendas[x.l.it.itemId], x.s.de, x.s.desde).peds })).filter(y => y.p.length);
        const nAf = af.reduce((t, y) => t + y.p.length, 0), vAf = SHC.r2(af.reduce((t, y) => t + y.p.reduce((s, p) => s + p.dif, 0), 0));
        const dAf = af.map(y => y.x.s.desde).sort()[0];
        const bAf = af.length ? blocoFr('frete:afet', 'Pedidos afetados', esc(`${SHC.qtd(nAf, 'pedido', 'pedidos')} desde ${dd(dAf)} · ${SHC.moeda(vAf)} a mais`),
            '<table class="tb">' + af.map(y => `<tr><td><button class="lnk" data-frete-det="${esc(y.x.l.it.itemId)}">${esc(y.x.l.it.titulo)}</button><span class="sm">desde ${esc(dd(y.x.s.desde))} · acima de ${SHC.moeda(y.x.s.de)}</span></td><td>${esc(SHC.qtd(y.p.length, 'pedido', 'pedidos'))} · ${SHC.moeda(SHC.r2(y.p.reduce((s, p) => s + p.dif, 0)))}</td></tr>`).join('') + '</table>'
            + '<p class="det">Toque no anúncio para ver cada pedido e o texto pronto do chamado.</p>') : '';
        // [V] Frete de devoluções (tarifa de devolução = frete de VOLTA): separado do frete das vendas e do "pago a mais".
        const dv = cob && freteHist.devolucoes, du = dv && dv.ult30;
        let bDev = '';
        if (du && du.pedidos) {
            const da = dv.ant30 || {}, lista = dv.lista || [];
            bDev = blocoFr('frete:dev', 'Frete de devoluções', esc(`${SHC.moeda(du.total)} em ${SHC.qtd(du.pedidos, 'pedido', 'pedidos')} · 30 dias`) + (da.pedidos ? ` <span class="fr-ant">· antes ${SHC.moeda(da.total)}</span>` : ''),
                '<p class="det">É o frete de volta do produto devolvido. Fica fora do frete das vendas e do “pago a mais”; no Fechamento entra como custo do mês. Para gastar menos, veja no Pós-venda por que os produtos voltam.</p>'
                + (da.pedidos ? `<p class="det">30 dias anteriores: ${SHC.moeda(da.total)} em ${esc(SHC.qtd(da.pedidos, 'pedido', 'pedidos'))}.</p>` : '')
                + (lista.length ? `<table class="tabf"><thead><tr><th>Pedido</th><th>Data</th><th>Anúncio</th><th>Devolução</th></tr></thead><tbody>
                ${lista.slice(0, 20).map(p => `<tr><td>${esc(p.pedido)}</td><td>${esc(P.dataBr(p.data).slice(0, 5))}</td><td>${esc(tituloDe(p.itemId) || p.itemId || '—')}</td><td>${SHC.moeda(p.valor)}</td></tr>`).join('')}
              </tbody></table>` : '') + '<p class="det">Fonte: Faturamento do ML (Tarifa de devolução).</p>');
        }
        // [V] Conciliação: frete cobrado em cada pedido × frete do anúncio.
        const bConc = conc ? blocoFr('frete:conc', 'Conciliação do frete', esc(cc.vendas ? `${P.milhar(cc.conciliados || 0)} de ${P.milhar(cc.vendas)} pedidos conferidos · faltam ${P.milhar(cc.faltam || 0)}` : 'nenhum pedido nos últimos 30 dias'),
            `<p class="fr-tot"><b>${esc(conc.titulo)}</b></p>${cc.vendas ? `<div class="barra-g" role="progressbar" aria-label="Pedidos conciliados" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${conc.pct}"><i style="width:${conc.pct}%"></i></div>` : ''}
              <p class="det">Conciliar = comparar o frete cobrado em cada pedido com o frete do anúncio.</p>${conc.motivos.map(m => `<p class="det">${esc(m)}</p>`).join('')}
              <p class="det">Fonte: Faturamento do ML (frete cobrado) e lista de Anúncios (frete do anúncio hoje).</p>`) : '';
        // [V] Formatos de frete dos últimos 30 dias (só os que existem nos dados).
        const fm = cob ? P.formatosFrete(ct.porFormato) : [];
        let bFmt = '';
        if (fm.length) {
            const pf = ct.porFormato, cp = pf.compradorPaga, notas = [];
            if (pf.full || pf.flex) notas.push('Full e Flex são a forma de entrega: esses pedidos também contam nas linhas de cima.');
            if (cp) notas.push('Comprador paga: o ML não cobra frete de você; o valor é o custo operacional do ML' + (cp.pedidos === null ? ' (os pedidos aparecem quando as vendas forem lidas)' : '') + '.');
            if (pf.cancelado && pf.cancelado.pedidos) notas.push(SHC.qtd(pf.cancelado.pedidos, 'pedido cancelado', 'pedidos cancelados') + ': o ML devolveu o frete.');
            if (freteHist.aprox > 0) notas.push('Os formatos contam só os pedidos em que o ML informou o tipo de frete.');
            const n = v => (v === null ? '—' : P.milhar(v));
            bFmt = blocoFr('frete:fmt', 'Formatos de frete', esc(fm.slice(0, 3).map(f => f.rot.replace(/ \(.*\)$/, '') + (f.pedidos !== null ? ' ' + P.milhar(f.pedidos) : '')).join(' · ')),
                `<table class="tabf"><thead><tr><th>Formato</th><th>Anúncios</th><th>Pedidos</th><th>Valor</th></tr></thead><tbody>
                ${fm.map(f => `<tr><td>${esc(f.rot)}</td><td>${n(f.anuncios)}</td><td>${n(f.pedidos)}</td><td>${SHC.moeda(f.total).replace('R$ ', 'R$\u00a0')}</td></tr>`).join('')}
              </tbody></table>${notas.map(t => `<p class="det">${esc(t)}</p>`).join('')}<p class="det">Últimos 30 dias.</p>`);
        }
        // [V] Frete a mais por SKU em 12 meses (lucro perdido).
        const bRk = rk && rk.grupos.length ? blocoFr('frete:rank', 'Frete a mais por SKU', esc(SHC.moeda(rk.total12) + ' em 12 meses · ' + SHC.qtd(rk.grupos.length, 'SKU', 'SKUs')),
            `<div class="rank">${rk.grupos.slice(0, 5).map(g => `<button data-frete-det="${esc(g.itemIds[0])}"><b>${esc(g.titulo)}</b><b class="v">${SHC.moeda(g.total12)}</b><small>${esc(g.sku || g.itemIds[0])}${g.itemIds.length > 1 ? ' · ' + g.itemIds.length + ' anúncios' : ''} · ${esc(P.nomeMes(rk.mes))}: ${g.aMais > 0 ? '+' + SHC.moeda(g.aMais) + ' (+' + SHC.moeda(g.porVenda) + '/venda)' : 'sem aumento'}</small></button>`).join('')}</div>
              <p class="det">${SHC.qtd(rk.grupos.length, 'SKU pagou', 'SKUs pagaram')} frete maior de ${esc(P.nomeMes(rk.desde))} a ${esc(P.nomeMes(rk.mes))} (${esc(P.nomeMes(rk.mes))}: ${SHC.moeda(rk.total)}). ${CONTA_FRETE} Fonte: Faturamento do Mercado Livre.</p>`) : '';
        // [V] Frete por anúncio: selo de variação em cada um; um filtro (KPI) ou a busca abrem.
        const b = freteBusca.trim().toLowerCase(), abL = aberto('frete:lista') || !!b;
        const vis = linhas.filter(l => (!freteFiltro || (freteFiltro === 'subiu' ? l.subiu : freteFiltro === 'gratis' ? !l.comprador : idsAMais.has(l.it.itemId)))
            && (!b || String(l.it.titulo).toLowerCase().indexOf(b) >= 0 || l.it.itemId.toLowerCase().indexOf(b) >= 0 || String(l.it.sku).toLowerCase().indexOf(b) >= 0));
        const rotF = freteFiltro === 'subiu' ? ' · filtro: frete subiu' : freteFiltro === 'amais' ? ' · filtro: pago a mais' : freteFiltro === 'gratis' ? ' · filtro: frete grátis' : '';
        let lst = `<div class="card fr-bl" id="freteAnuncios"><div class="fr-cab"><div class="fr-t"><h3>Frete por anúncio</h3><span>${esc(SHC.qtd(linhas.length, 'anúncio', 'anúncios') + (subiram ? ' · ' + subiram + ' subiu' : '') + (nComp ? ' · ' + nComp + ' pelo comprador' : '') + rotF)}</span></div>`
            + (b ? '' : btVer('frete:lista', 'Ver todos (' + P.milhar(vis.length) + ')', 'Ver menos')) + '</div>';
        if (abL) {
            lst += `<div class="fr-in"><input class="busca" id="buscaFrete" placeholder="Buscar anúncio, MLB ou SKU" value="${esc(freteBusca)}" aria-label="Buscar anúncio">`
                + '<p class="legenda"><span class="sit-ruim">Frete subiu ou dá prejuízo</span><span class="sit-atencao">Subiu pouco ou sem custo</span><span class="sit-ok">Estável e com lucro</span></p>';
            lst += vis.length ? vis.slice(0, limite.frete).map(l => {
                const so = sobraDe(l.it), sit = P.situacaoFrete(l, so);
                const lucro = so && so.sobra !== null ? `<span class="var ${so.sobra < 0 ? 'sobe' : 'desce'}">${so.sobra < 0 ? 'Prejuízo ' + SHC.moeda(-so.sobra) : 'Lucro ' + SHC.moeda(so.sobra)}</span>` : '<span class="var igual">sem custo</span>';
                return `<button class="card linha-fr sit-${sit}" data-frete-det="${esc(l.it.itemId)}"><div class="tit">${esc(l.it.titulo)} ${seloFrete(l, sit)}</div><div class="sub">${esc(l.it.itemId)}${l.it.sku ? ' · SKU ' + esc(l.it.sku) : ''}</div>
                  <div class="l2p">${chipFrete(l, cob)}${lucro}<span style="margin-left:auto;font-weight:700">${l.comprador || l.hoje === null ? '' : SHC.moeda(l.hoje)}</span><span class="seta">›</span></div></button>`;
            }).join('') + botaoMais('frete', vis.length - limite.frete) : '<div class="vazio">Nenhum anúncio neste filtro.</div>';
            lst += '<p class="det">Médio = frete cobrado por pedido nos últimos 30 dias × 30 anteriores (Faturamento do ML). À direita, o frete do anúncio hoje (lista do ML).</p></div>';
        }
        lst += '</div>';
        // [V] Ferramentas: prova de medida, chamado pronto e simulador ficam dentro de cada anúncio; os botões abrem o que mais pede atenção.
        const alvoF = (x0 && x0.l.it) || (linhas.find(l => !l.comprador) || linhas[0] || {}).it;
        const bFer = alvoF ? blocoFr('frete:ferr', 'Ferramentas', 'Prova de medida · Chamado pronto · Simulador',
            `<div class="linha-bts">${[['frMed', 'Prova de medida'], ['frChamado', 'Chamado pronto'], ['frSim', 'Simulador']].map(([k, t]) => `<button class="bt pq leve" data-frete-det="${esc(alvoF.itemId)}" data-frete-ir="${k}">${t}</button>`).join('')}</div>
              <p class="det">De: ${esc(alvoF.titulo)}. Para outro anúncio, toque nele em “Frete por anúncio”.</p>`) : '';
        // Rodapé: a base dos números (30 dias anteriores, fonte) e a leitura em andamento.
        let rod = '';
        if (cob) {
            const u = ct.ult30, a = ct.ant30;
            rod = `<p class="det fr-rod">${semLer ? esc(semLer) + ': a comparação com os 30 dias anteriores fica para depois' : '30 dias anteriores: ' + (a.pedidos ? SHC.moeda(a.total) + ' em ' + esc(SHC.qtd(a.pedidos, 'pedido', 'pedidos')) : 'nenhum pedido com frete')}.`
                + (!semLer && u.medio !== null && a.medio !== null ? ` Frete médio por pedido: ${SHC.moeda(a.medio)} → ${SHC.moeda(u.medio)}.` : '')
                + (u.descontoML > 0 ? ` Desconto do ML no frete dos últimos 30 dias: ${SHC.moeda(u.descontoML)}.` : '')
                + ` Dados do Faturamento do ML desde ${esc(P.dataBr(freteHist.desde).slice(0, 5))}.</p>`
                + (!conc && freteHist.vendasLidas === false ? '<p class="nota"><span class="auto"></span><span>A conciliação aparece quando as vendas forem lidas (próxima sincronização).</span></p>' : '');
        }
        alvo.innerHTML = `<div class="fr-grade"><div class="fr-a">${A}</div><div class="fr-b">${bAf}${lst}${bDev}${bConc}${bFmt}${bRk}${bFer}</div></div>${rod}<p class="andam">${esc(andamFrete())}</p>`;
        if (foco !== null) { const i = $('#buscaFrete'); if (i && i.focus) { i.focus(); try { i.setSelectionRange(foco, foco); } catch (e) { /* campo sem cursor */ } } }
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
        html += `<div class="card" id="frMed"><b style="font-size:13px">Prova de medida</b><div class="medidas">
            <div><small>No seu ERP (planilha, Tiny ou Omie)</small>${med ? `<b>${esc(med)}</b>` : `<span>${it.sku ? 'Sem peso e medidas do SKU ' + esc(it.sku) + '.' : 'Anúncio sem SKU.'}</span>`}</div>
            <div><small>No ML (embalagem ${ma && ma.secao === 'entrega' ? 'da forma de entrega' : 'de envio, a do frete'})</small>${ma ? `<b>${esc(SHC.medidaTxt(ma))}</b><span style="display:block">Peso considerado: ${esc(P.kgTxt(SHC.medidaConsiderada(ma)))} · conferido ${esc(tempo(ma.ts))}</span>`
                : `<span>${permWww ? 'Ainda não li as medidas deste anúncio.' : 'Falta a permissão para ler as medidas.'}</span>`}</div></div>
            ${ma && erp && !SHC.medidasIguais(ma, erp) ? '<p class="aviso-custo">As medidas no ML são diferentes das do seu ERP. Confira qual é a certa e corrija no ML.</p>' : ''}
            <p class="det">${med ? 'Peso bruto e embalagem (largura × altura × comprimento). Compare com o que você envia.' : 'Importe a planilha do seu ERP (Tiny: “Peso bruto (Kg)” e medidas da embalagem) em Ajustes › Abrir planilha de custos.'}${ma ? ' Peso considerado = o maior entre o peso físico e o volumétrico (comprimento × largura × altura ÷ 6.000).' : ''}</p>
            <div class="acoes" style="justify-content:flex-start;flex-wrap:wrap">${permWww ? `<button class="bt leve" data-med-agora="${esc(it.itemId)}">Conferir agora</button>` : `<button class="bt leve" data-perm-fotos>${PERM_TXT}</button>`}${btMed(it.itemId)}</div>${medMsgDe(it.itemId)}</div>`;
        const txt = P.textoChamado(it, h, vd, confirmouMedidas, med);
        if (txt) {
            const b = P.baseChamado(h, vd, it), { peds, fora } = P.pedidosAMais(vd, b.base, b.desde);
            html += `<div class="card" id="frChamado"><b style="font-size:13px">Chamado para o Mercado Livre</b>
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
    const custoDe = it => { const c = custoGrupo[it.sku ? 'sku:' + it.sku : 'mlb:' + it.itemId]; return c ? c.dados : null; };
    const campoCusto = it => { const k = it.sku ? 'sku:' + it.sku : 'mlb:' + it.itemId; return grupos.some(g => g.chave === k)
        ? `<div class="custo"><label>Custo${it.sku ? ' do SKU ' + esc(curtoTxt(it.sku, 20)) : ''}</label><input class="inp" data-csku="${esc(k)}" inputmode="decimal" placeholder="R$ 0,00"><button class="bt" data-csalvar="${esc(k)}">Salvar</button></div>` : ''; };
    // v3.1 (pedido da dona: "quando eu clico no produto [no Ads] ele vai para a tela do frete; tinha que abrir a tela do Ads do anúncio"):
    // o clique num produto da aba Ads abre ESTE detalhe na própria aba Ads (adsDet). Link: só a lista de campanhas do Mercado Ads está
    // mapeada (ads.js A.URL.campanhas); o endereço de uma campanha ou de um anúncio dentro do Mercado Ads não está, então o botão abre a lista.
    const ADS_URL_CAMPANHAS = 'https://ads.mercadolivre.com.br/product-ads/admin/campaigns';
    // Seta 30 dias × 30 dias antes. bom = 'sobe' | 'cai' | '' (neutro: cinza). Sem o valor de antes → nada.
    const setaAds = (agora, antes, bom) => {
        if (agora === null || antes === null || agora === undefined || antes === undefined) return '';
        if (!(antes > 0)) return agora > 0 ? ' <span class="fseta eq">▲ novo</span>' : '';
        const p = Math.round((agora - antes) / antes * 1000) / 10;
        if (p === 0) return ' <span class="fseta eq">= 0%</span>';
        const cls = !bom ? 'eq' : (p > 0) === (bom === 'sobe') ? 'up' : 'down';
        return ` <span class="fseta ${cls}">${p > 0 ? '▲' : '▼'} ${esc(SHC.pctTxt(Math.abs(p)))}</span>`;
    };
    function cardAds(it) {
        const cab = '<div class="ch"><h3>Ads deste anúncio</h3></div>', abrir = `<div class="acoes" style="justify-content:flex-start;flex-wrap:wrap;margin-top:8px"><a class="bt" href="${ADS_URL_CAMPANHAS}" target="_blank" rel="noopener">Abrir no Mercado Ads</a></div>`;
        if (!adsSnap) return `<div class="card">${cab}<p class="det">Aparece depois da próxima leitura do Mercado Ads.</p></div>`;
        if (adsSnap.temAds === false) return `<div class="card">${cab}<p class="det">No Ads: não. Esta conta não usa o Mercado Ads.</p></div>`;
        const x = P.adsDoItem(adsSnap, it.itemId);
        if (!x.noAds && x.temCatalogo && (it.catalogo || it.competicao)) return `<div class="card">${cab}<p class="det">Anúncio de catálogo: o Mercado Ads não diz qual anúncio seu é.</p>${abrir}</div>`;
        if (!x.noAds) return `<div class="card">${cab}<p style="margin:6px 0 0;font-size:12.5px"><b>No Ads: não.</b> Este anúncio não está em nenhuma campanha do Mercado Ads (${esc(periodoAds())}).</p>${abrir}</div>`;
        const m = x.m, c = x.campanha, eq = it._soAds ? null : SHC.adsEquilibrio(it, custoDe(it), cfg), v = P.adsVeredito(m, eq);
        const cor = { compensa: 'ok', nao: 'ruim', semCusto: 'neutra', semGasto: 'neutra' }[v.tipo], kc = { compensa: 'ok', nao: 'pr' }[v.tipo] || '';
        const selo = (s, a) => s === 'ativo' ? ` <span class="selo ok">Ativ${a}</span>` : s === 'pausado' ? ` <span class="selo at">Pausad${a}</span>` : '';   // anúncio (o) e campanha (a)
        const vs = P.adsCampanhaVs(adsSnap, c.id), ap = adsSnap.anterior && adsSnap.anterior.periodo;
        const lin = (r, a, b, fmt, bom) => `<tr><td>${r}</td><td><b>${a === null ? '—' : fmt(a)}</b>${setaAds(a, b, bom)}</td><td>${b === null ? '—' : fmt(b)}</td></tr>`;
        const hist = vs ? `<div class="card"><div class="ch"><h3>Campanha: 30 dias × 30 dias antes</h3></div>
            <table class="tb"><thead><tr><th>${esc(c.nome || 'Campanha')}</th><th>${esc(periodoAds())}</th><th>${ap && ap.de && ap.ate ? esc(P.dataBr(ap.de).slice(0, 5) + ' a ' + P.dataBr(ap.ate).slice(0, 5)) : '30 dias antes'}</th></tr></thead><tbody>`
            + lin('Investimento', vs.atual.gasto, vs.antes.gasto, SHC.moeda, '') + lin('Vendas pelo Ads', vs.atual.receita, vs.antes.receita, SHC.moeda, 'sobe')
            + lin('ACOS', vs.atual.acos, vs.antes.acos, pctOu, 'cai') + '</tbody></table>'
            + '<p class="det">O Mercado Ads não manda o histórico de cada anúncio: esta comparação é da campanha inteira. ▲▼ verde = melhorou, vermelho = piorou.</p></div>' : '';
        return `<div class="card">${cab}
          <p style="margin:6px 0 0;font-size:12.5px"><b>No Ads: sim</b>${selo(x.status, 'o')}${c.nome ? ` · campanha <b>${esc(c.nome)}</b>${selo(c.status, 'a')}` : ''}</p>
          ${c.estrategia || c.roasObjetivo ? `<p class="det">${c.estrategia ? 'Estratégia: ' + esc(c.estrategia) : ''}${c.estrategia && c.roasObjetivo ? ' · ' : ''}${c.roasObjetivo ? 'ROAS objetivo: ' + xTxt(c.roasObjetivo) : ''}</p>` : ''}
          <div class="recnota ${cor}"><b>${esc(v.texto)}</b>${v.det ? ' · ' + esc(v.det) : ''}</div>
          ${v.tipo === 'semCusto' && !it._soAds ? campoCusto(it) : ''}
          <div class="kpis k3" style="margin:8px 0 0">${kpiN('', 'Investimento', SHC.moeda(m.gasto), esc(periodoAds()))}${kpiN('', 'Vendas pelo Ads', SHC.moeda(m.receita), esc(SHC.qtd(m.vendas, 'venda', 'vendas')))}`
          + kpiN(kc, 'ACOS ⓘ', pctOu(m.acos), eq ? esc('equilíbrio ' + SHC.pctTxt(eq.equilibrio)) : '', ACOS_TXT)
          + kpiN('', 'ROAS ⓘ', xTxt(m.roas), m.roas !== null ? esc('R$ ' + (Math.round(m.roas * 100) / 100).toLocaleString('pt-BR') + ' por R$ 1') : '', ROAS_TXT)
          + kpiN('', 'Cliques', intTxt(m.cliques), m.cpc !== null ? esc(SHC.moeda(m.cpc) + ' por clique') : '') + kpiN('', 'Impressões', intTxt(m.impressoes), m.ctr !== null ? esc(SHC.pctTxt(m.ctr) + ' clicaram') : '') + `</div>
          ${abrir}<p class="det">Abre a lista de campanhas do Mercado Ads${c.nome ? `: procure “${esc(c.nome)}”` : ''}. Criar, pausar ou mudar o orçamento é com você, lá. Fonte: Mercado Ads.</p></div>` + hist;
    }
    // Detalhe de Ads de um anúncio (aba Ads). Anúncio fora da lista lida (só no Mercado Ads) → título do Ads, sem o cálculo de equilíbrio.
    function desenhaAdsDetalhe(id) {
        const it = itens.find(x => x.itemId === id) || (() => { const a = ((adsSnap && adsSnap.anuncios) || []).map(P.adsDoAnuncio).find(y => y && y.itemId === id); return a ? { itemId: id, titulo: a.titulo || id, _soAds: true } : null; })();
        if (!it) return false;
        $('#listaAds').innerHTML = `<button class="lnk" data-voltar-ads>‹ Todos os produtos do Ads</button>
          <div class="card"><div class="tit">${esc(it.titulo)}</div><div class="sub">${esc(it.itemId)}${it.sku ? ' · SKU ' + esc(it.sku) : ''}${it._soAds ? ' · fora da lista de anúncios lida' : ''}</div></div>` + cardAds(it);
        return true;
    }

    // Afiliados deste anúncio (1 linha; nada certo a dizer → sem cartão).
    function cardAfil(it) { const l = P.afilDoItem(afil, it.itemId); return l ? `<div class="card"><p style="margin:0;font-size:12.5px">${esc(l)}</p></div>` : ''; }
    // Simulador de custos do ML: confere o "Você recebe" e mostra frete grátis × comprador paga lado a lado (só mostra; quem decide é você).
    function cardSim(it) {
        const x = simDe[it.itemId], msg = simMsg[it.itemId], cab = '<b style="font-size:13px">Simulador de custos do ML</b>';
        const bt = msg === 'lendo' ? '<p class="det">Conferindo com o Simulador do ML…</p>'
            : `<button class="bt leve" data-conf-sim="${esc(it.itemId)}" style="margin-top:8px">${x ? 'Conferir de novo' : 'Conferir com o Simulador do ML'}</button>${msg ? `<p class="det">${esc(msg)}</p>` : ''}`;
        if (!x) return `<div class="card" id="frSim">${cab}<p class="det">Confere o “Você recebe” deste anúncio na calculadora do próprio Mercado Livre.</p>${bt}</div>`;
        const rec = it.recebeCopiloto !== undefined ? it.recebeCopiloto : it.recebe, cf = SHC.simConfere(x.hoje, rec, it.preco), e = SHC.simEse(x.hoje, x.outro);
        let h = `<div class="card" id="frSim">${cab}`;
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
        const linhaSem = ({ g, vendas: nv }) => `<div class="linha-sem"><span><b>${esc(g.titulo)}</b><small>${esc(g.sku || g.itens[0].itemId + ' (sem SKU)')}${nv > 0 ? ' · ' + SHC.qtd(nv, 'vendida', 'vendidas') + ' desde ' + desdeTxt : ''}</small></span>
            <span class="cst-ed"><input class="inp" data-csku="${esc(g.chave)}" inputmode="decimal" placeholder="＋ custo"><button class="bt" data-csalvar="${esc(g.chave)}">OK</button></span></div>`;
        $('#catTopo').innerHTML = `<div class="card" id="cardCustosCat"><b style="font-size:13px">Custo preenchido em ${com} de ${total} produtos</b>
          <div class="barra-g" role="progressbar" aria-label="SKUs com custo" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
          <p style="margin:0;font-size:12.5px"><b>${pct}%</b> · ${com} de ${total} SKUs com custo${cu.de ? ` · Principais: ${cu.com} de ${cu.de} que mais vendem` : ''}</p>
          <p class="aviso-custo">Sem o custo, o Copiloto não calcula o lucro nem se o Ads compensa.</p>
          <div class="dois"><button class="bt verde" data-erp="tiny">${tinyToken ? 'Tiny · Puxar custos agora' : 'Tiny · Conectar em 1 minuto'}</button><button class="bt" data-erp="omie">Omie · Conectar</button><button class="bt" data-erp="bling">${blingLigado ? 'Bling · Puxar custos agora' : 'Bling · Conectar'}</button></div>
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
            // v3.1: catálogo perdido (catcomp:) → quem ganha em destaque, já na lista.
            const kv = g.itens.map(it => compCat[it.itemId]).find(k => k && k.vencedor && k.estado && !k.souVencedor && k.estado !== 'ganhando'), vv = kv && kv.vencedor;
            const quem = vv ? `<div class="cc-quem">Perdendo para <b>${esc(curtoTxt(vv.loja || 'outra loja', 40))}</b>${vv.preco ? ' · ' + SHC.moeda(vv.preco) : ''}</div>` : '';
            return `<div class="linha-sku"><b>${esc(g.titulo)}</b>${cst}<small>${esc(g.sku || g.itens[0].itemId + ' (sem SKU)')} · ${g.itens.length} anúncio${g.itens.length > 1 ? 's' : ''}</small>
              <div class="canais">${ml}</div>${quem}${alerta ? `<div class="alerta">${esc(alerta)}</div>` : ''}</div>`;
        }).join('') + botaoMais('catalogo', vis.length - limite.catalogo) : '<div class="vazio">Nenhum SKU neste filtro.</div>')
            + '<p class="det" style="margin-top:8px">O custo é do SKU. Em cada canal mudam só a comissão e a conta final.</p>';
    }

    // Competição: filtros por estado (P.GRUPOS_COMP), dias perdendo (comp:<conta>), "Ver quem está ganhando" (conc:<conta>:<MLB>)
    // e o mesmo produto em outra conta do ML deste Chrome.
    const COMP = { ganhando: ['l', 'Ganhando'], perdendo: ['p', 'Perdendo'], restrito: ['p', 'Restrito'], dividindo: ['a', 'Dividindo'], competindo: ['n', 'Competindo'] };
    const COMP_EXPLICA = 'O ML mostra uma oferta principal por produto e escolhe pelo conjunto preço + entrega + parcelamento + reputação; quando empata, reveza (Dividindo o 1º lugar). Ganhando = a sua é a principal. Perdendo = outra ficou no lugar. Restrito = outras têm entrega melhor.';
    function linhaCompeticao(it, g) {
        const topo = `<b>${esc(it.titulo)}</b><small>${esc(it.itemId)}${it.sku ? ' · SKU ' + esc(it.sku) : ''}</small>`;
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
        const kc = compCat[it.itemId], km = catMsg[it.itemId];
        // v3.1: com a leitura da tela "Alterar anúncio" (catcomp:) o bloco novo substitui a página pública (conc:) e o "Ver quem está ganhando".
        if (kc && kc.estado) return `<div class="linha-comp">${topo}<small class="quando">${esc(quando)}${it.preco ? ' · seu preço ' + SHC.moeda(it.preco) : ''}</small>${blocoCompCat(it, kc, res)}
            ${km === 'lendo' ? '<small>Lendo a concorrência no ML…</small>' : `<div class="acoes" style="justify-content:flex-start;flex-wrap:wrap;margin-top:6px"><button class="bt leve pq" data-catler="${esc(it.itemId)}">Ler de novo</button></div>${km ? `<small class="erro-conc">${esc(km)}</small>` : ''}`}</div>`;
        const bt = msg === 'lendo' ? '<small>Lendo as ofertas do catálogo…</small>'
            : `<button class="bt leve" data-conc="${esc(it.itemId)}" style="margin-top:6px">${cmp ? 'Ler de novo' : 'Ver quem está ganhando'}</button>${msg ? `<small class="erro-conc">${esc(msg)}</small>` : ''}`;
        const bt2 = km === 'lendo' ? '<small>Lendo a concorrência no ML…</small>' : `<button class="lnk" data-catler="${esc(it.itemId)}" style="margin-top:4px;font-size:11.5px">Ler preço para ganhar e o que falta</button>${km ? `<small class="erro-conc">${esc(km)}</small>` : ''}`;
        return `<div class="linha-comp">${topo}<small class="quando">${esc(quando)}${it.preco ? ' · seu preço ' + SHC.moeda(it.preco) : ''}</small>${det}${mud}${bt}${bt2}</div>`;
    }
    // v3.1 (pedido da dona): quem ganha, preço para ganhar (e se ainda dá lucro nele), "O que fazer para ganhar" e a linha do tempo.
    // Sobra no preço para ganhar = SHC.sobraAtacado num degrau de 1 un.: mesma tarifa (%) e mesmo frete de hoje (estimativa).
    const sobraNoPreco = (it, preco) => { const c = custoGrupo[it.sku ? 'sku:' + it.sku : 'mlb:' + it.itemId]; return SHC.sobraAtacado(it, { qtd: 1, preco }, c ? c.dados : null, cfg); };
    const COR_ACAO = { l: 'ok', a: 'at', p: 'pr', n: '' };
    // v3.1 (pedido da dona 29/09): vantagens do vencedor (colunas da tabela do ML) × as suas: ✓ você tem / ✗ você não tem / sem o seu dado → não dá para saber.
    // [nome, campo, o vencedor tem, você também tem (coleta: Full ou Flex contam como tendo)]
    const VANT = [['Full', 'logistica', /full/i], ['Flex', 'logistica', /flex/i], ['Coleta', 'logistica', /coleta/i, /coleta|full|flex/i],
        ['Parcela sem juros', 'parcelamento', /premium|sem juros/i], ['Frete grátis', 'frete', /gr[áa]tis/i]];
    const vantagensComp = (v, eu) => VANT.filter(([, c, re]) => re.test(String(v[c] || ''))).map(([n, c, re, re2]) => ({ n, voce: eu && eu[c] ? (re2 || re).test(String(eu[c])) : null }));
    // "O que fazer para ganhar" em cartões: verbo forte + impacto em 1 linha + botão que só ABRE a página do ML (nada é alterado pelo Copiloto).
    function cartaoAcao(a, i, it, kc, sg) {
        const v = kc.vencedor || {}, eu = kc.voce || {};
        let t, imp, url = SHC.fotosLink(it.itemId), bt = 'Abrir no ML';
        if (a.tipo === 'preco') {
            t = 'Baixar preço para ' + SHC.moeda(kc.precoGanhar);
            imp = !sg || sg.sobra === null || sg.sobra === undefined ? 'informe o custo para saber se ainda dá lucro'
                : sg.sobra >= 0 ? 'lucro ' + SHC.moeda(sg.sobra) + ' (' + SHC.pctTxt(sg.pct) + ') por venda' : 'prejuízo ' + SHC.moeda(-sg.sobra) + ' por venda: não compensa';
        } else if (a.tipo === 'logistica') {
            if (/pelo Full/.test(a.txt)) { t = 'Enviar ao Full'; imp = 'o vencedor envia pelo Full e você não'; url = URL_FULL.envios; bt = 'Abrir o Full'; }
            else if (/tem Flex/.test(a.txt)) { t = 'Ativar o Flex'; imp = 'o vencedor tem Flex e você não'; }
            else if (/coleta e você agência/.test(a.txt)) { t = 'Trocar agência por coleta'; imp = 'o vencedor tem coleta e você agência; Full ou Flex também ajudam'; }
            else { t = 'Mudar a entrega'; imp = 'o vencedor: ' + curtoTxt(v.logistica || '—', 30) + ' · você: ' + curtoTxt(eu.logistica || '—', 30); }
        } else if (a.tipo === 'parcelamento') { t = 'Mudar para Premium'; imp = 'o vencedor parcela sem juros · a tarifa do Premium é maior'; }
        else if (a.tipo === 'frete') { t = 'Oferecer frete grátis'; imp = 'o vencedor tem frete grátis e você não'; }
        else { t = 'Conferir no ML'; imp = a.txt; }
        return `<li class="cc-acao ${COR_ACAO[a.cor] || 'n'}${i === 0 ? ' prim' : ''}"><span class="cc-n">${i + 1}</span><div class="tx"><b>${esc(t)}</b><span>${esc(imp)}</span></div>`
            + `<a class="bt pq ${i === 0 ? 'ml' : 'leve'}" href="${esc(url)}" target="_blank" rel="noopener">${esc(bt)}</a></li>`;
    }
    function blocoCompCat(it, kc, res) {
        const v = kc.vencedor, pg = kc.precoGanhar, sg = pg ? sobraNoPreco(it, pg) : null, vi = kc.visitas;
        const souVenc = kc.souVencedor || kc.estado === 'ganhando';
        // "Quem está ganhando": nome da loja grande, preço dele × o seu, diferença em R$ e % (sobre o preço dele) e as vantagens dele × as suas.
        let venc = '<p><b>Outra oferta está na frente.</b></p>';
        if (souVenc) venc = '<p class="cc-sua">✓ A oferta principal é a sua.</p>';
        else if (v) {
            const dif = v.preco && it.preco ? SHC.r2(it.preco - v.preco) : null;
            const difH = dif === null ? '<p class="cc-dif">Diferença de preço: não dá para saber.</p>'
                : dif > 0.004 ? `<p class="cc-dif pr">o seu está ${SHC.moeda(dif)} (${SHC.pctTxt(dif / v.preco * 100)}) mais caro</p>`
                : dif < -0.004 ? `<p class="cc-dif at">o seu está ${SHC.moeda(-dif)} (${SHC.pctTxt(-dif / v.preco * 100)}) mais barato: o ML pesa também entrega e parcela</p>`
                : '<p class="cc-dif at">mesmo preço que o seu: o ML pesa também entrega e parcela</p>';
            const vt = vantagensComp(v, kc.voce);
            venc = `<div class="cc-venc"><small class="cc-rot">Quem está ganhando</small><b class="cc-loja">${esc(curtoTxt(v.loja || 'outra loja', 60))}</b>`
              + `<div class="cc-pr"><span><small>Vencedor</small><b>${v.preco ? SHC.moeda(v.preco) : '—'}</b></span><i>×</i><span><small>Você</small><b${dif > 0.004 ? ' class="pr"' : ''}>${SHC.moeda(it.preco)}</b></span></div>${difH}`
              + (vt.length ? `<ul class="cc-vant">${vt.map(x => `<li class="${x.voce === true ? 'ok' : x.voce === false ? 'pr' : ''}"><b>${esc(x.n)}</b> ${x.voce === true ? '✓ você tem' : x.voce === false ? '✗ você não tem' : 'você: não dá para saber'}</li>`).join('')}</ul>` : '')
              + '</div>';
        }
        const kpiPg = pg ? `<div class="kpi kn ${!sg ? '' : sg.sobra >= 0 ? 'ok' : 'pr'}"><div class="l">Preço para ganhar</div><div class="v">${SHC.moeda(pg)}</div><div class="s">${!sg ? 'informe o custo' : (sg.sobra >= 0 ? 'lucro ' : 'prejuízo ') + SHC.moeda(Math.abs(sg.sobra))}</div></div>` : '';
        const kpiVi = vi && vi.total ? `<div class="kpi kn${kc.winRate !== null && kc.winRate < 50 ? ' at' : ''}" title="${esc('Parte das visitas do catálogo que foram para o seu anúncio nos últimos 7 dias' + (vi.delta ? ' (' + (vi.tendencia === 'down' ? 'caiu ' : 'subiu ') + vi.delta + ')' : '') + '.')}"><div class="l">Visitas 7 dias</div><div class="v">${kc.winRate !== null ? esc(SHC.pctTxt(kc.winRate)) : '—'}</div><div class="s">${esc('suas: ' + (vi.voce || 0) + ' de ' + vi.total)}</div></div>` : '';
        const kpiDias = res && /^(perdendo|restrito)$/.test(res.estado) ? `<div class="kpi kn pr"><div class="l">Perdendo há</div><div class="v">${esc(P.dias(res.dias))}</div><div class="s">desde ${esc(P.dataBr(res.desde).slice(0, 5))}${res.peloMenos ? ' (1ª leitura)' : ''}</div></div>` : '';
        const kpis = [kpiPg, kpiVi, kpiDias].filter(Boolean);
        const acoes = SHC.compCatAcoes(kc, sg);
        const oq = acoes.length ? `<p class="cc-t">O que fazer para ganhar</p><ul class="cc-acoes">${acoes.map((a, i) => cartaoAcao(a, i, it, kc, sg)).join('')}</ul>` : '';
        // Linha do tempo: dias ganhando × perdendo por mês (comp:<conta>, 1 registro por mudança) + a participação nas visitas de cada leitura.
        const pm = SHC.compPorMes(compHist[it.itemId] || kc.hist, SHC.hoje(), 6);   // sem comp: (lista), a leitura diária da tela
        const barras = pm.length ? `<div class="cc-meses">${pm.map(m => { const t = m.ganhando + m.perdendo + m.dividindo || 1;
            return `<div class="cc-mes" title="${esc(P.nomeMes(m.mes) + ': ' + m.ganhando + ' dias ganhando, ' + m.perdendo + ' perdendo' + (m.dividindo ? ', ' + m.dividindo + ' dividindo' : ''))}"><small class="m">${esc(P.nomeMes(m.mes).split('/')[0].slice(0, 3))}</small><span class="cc-b"><i class="g" style="width:${Math.round(m.ganhando / t * 100)}%"></i><i class="d" style="width:${Math.round(m.dividindo / t * 100)}%"></i><i class="p" style="width:${Math.round(m.perdendo / t * 100)}%"></i></span><small class="q">${m.perdendo}d perdendo</small></div>`; }).join('')}</div>`
            + `<div class="cc-leg"><span><i class="g"></i>ganhando</span>${pm.some(m => m.dividindo) ? '<span><i class="d"></i>dividindo</span>' : ''}<span><i class="p"></i>perdendo</span><span>1 barra = 1 mês</span></div>` : '';
        const ws = (kc.hist || []).filter(h => h.w !== null && h.w !== undefined).slice(-6).reverse();
        const wtxt = ws.length > 1 ? `<small>Suas visitas por leitura: ${ws.map(h => esc(P.dataBr(h.d).slice(0, 5)) + ' ' + esc(SHC.pctTxt(h.w))).join(' · ')}</small>` : '';
        const linhaT = barras || wtxt ? `<p class="cc-t">Linha do tempo</p>${barras}${wtxt}${pm.length ? '<small>Dias contados desde a 1ª leitura do Copiloto; compare os meses para ver a época em que você perde.</small>' : ''}` : '';
        const outro = `<p class="cc-t">Outro catálogo com margem?</p><small>O ML não deixa um anúncio trocar de catálogo sozinho. Se ele foi agrupado no produto errado, reporte no ML: na tela “Alterar anúncio”, seção Concorrência.</small>
            <a class="lnk" href="${esc(SHC.fotosLink(it.itemId))}" target="_blank" rel="noopener" style="font-size:11.5px">Seu anúncio foi mal agrupado? Reportar no ML</a>`;
        return `<div class="conc cc">${venc}${kpis.length ? `<div class="kpis cc-k">${kpis.join('')}</div>` : ''}${oq}${linhaT}${souVenc ? '' : outro}
            <small>Lido ${esc(tempo(kc.ts))} na tela “Alterar anúncio” do ML${pg ? '. Lucro no preço para ganhar: estimativa com a mesma tarifa (%) e o mesmo frete de hoje' : ''}.</small></div>`;
    }
    // "Ler de novo" / "Ler preço para ganhar": o fundo relê a tela "Alterar anúncio" deste anúncio ({acao:'catalogo_agora'}; permissão de www, a mesma das fotos).
    const catMsg = {};
    async function catalogoAgora(itemId) {
        let pedido = null;
        try { pedido = chrome.permissions.request(PERM_WWW); } catch (e) { pedido = Promise.resolve(false); }   // no clique, antes de qualquer await
        catMsg[itemId] = 'lendo'; desenhaCatalogo();
        let r = null;
        try { r = (await pedido) ? await chrome.runtime.sendMessage({ acao: 'catalogo_agora', itemId }) : { ok: false, motivo: 'semPermissao' }; } catch (e) { r = null; }
        if (r && r.ok && r.comp) { delete catMsg[itemId]; compCat = Object.assign({}, compCat, { [itemId]: r.comp }); }
        else catMsg[itemId] = r && r.motivo === 'semPermissao' ? 'Sem a permissão do Chrome o Copiloto não abre a tela do anúncio. Clique de novo e escolha “Permitir”.'
            : r && r.motivo === 'sem_sessao' ? 'Entre no Mercado Livre neste Chrome e tente de novo.'
            : r && r.motivo === 'sem_catalogo' ? 'O ML não mostrou concorrência neste anúncio agora.' : 'O Mercado Livre não respondeu. Tente de novo em alguns minutos.';
        desenhaCatalogo();
    }
    function cardCompeticao() {
        const rc = P.resumoCompeticao(itens), entre = entreContas;
        const nContas = Object.keys(contas).length, semRetrato = Object.keys(contas).filter(id => !retratos[id]);
        const filtros = rc.temDado ? P.GRUPOS_COMP.filter(([k]) => rc.grupos[k].length || k !== 'outros').map(([k, rot, cor]) => `<button class="${cor}${compGrupo === k ? ' on' : ''}" data-cgrupo="${k}">${rc.grupos[k].length} ${esc(rot.toLowerCase())}</button>`).join('') : '<span class="n">sem dado ainda</span>';
        let html = `<div class="card"><button class="lnk" data-comp style="display:flex;width:100%;color:var(--tinta)"><b style="font-size:13px;flex:1">Competição</b><span style="color:var(--azul)">${compAberto ? 'fechar' : 'ver'}</span></button>
          <div class="canais" style="margin-top:6px">${filtros}${entre.length ? `<span class="p">${entre.length} entre suas contas</span>` : ''}</div>`;
        // v3.1: quantos anúncios perdendo dá para ganhar baixando o preço e ainda com lucro (catcomp: + custo).
        const daGanhar = [].concat(rc.grupos.preco, rc.grupos.entrega, rc.grupos.outros).filter(it => { const k = compCat[it.itemId], pg = k && k.estado && !k.souVencedor && k.precoGanhar, sg = pg ? sobraNoPreco(it, pg) : null; return sg && sg.sobra >= 0; }).length;
        if (daGanhar) html += `<p class="rs"><b class="vv">${esc(SHC.qtd(daGanhar, 'anúncio', 'anúncios'))}</b>: dá para ganhar baixando o preço e ainda com lucro.</p>`;
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
            html += entre.length ? entre.slice(0, 8).map(g => `<div class="linha-comp"><b>${esc(g.titulo)}</b><small>Suas contas competem entre si neste produto (${g.tipo === 'titulo' ? 'mesmo título' : ({ catalogo: 'catálogo #', sku: 'SKU ', ean: 'EAN ' }[g.tipo] || '') + esc(g.valor)}):</small>
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
    // Barra "entrou × custou" (pedido da dona, 27/09), na MESMA escala da lista (max): verde = o que entrou; por cima, a partir da esquerda,
    // o que custou (âmbar; vermelho quando não compensa). A cor da saúde (P.saudeRetorno) vai no número à direita e na palavra do rodapé.
    const larguraRet = (v, max) => (v > 0 && max > 0 ? Math.max(1.5, Math.min(100, v / max * 100)).toFixed(1) : '0');
    const barraRet = (entrou, custou, max, cor) => `<span class="rb" aria-hidden="true"><i class="e" style="width:${larguraRet(entrou, max)}%"></i><i class="c${cor === 'pr' ? ' pr' : ''}" style="width:${larguraRet(custou, max)}%"></i></span>`;
    const legRet = custo => `<p class="rleg"><i class="e"></i>vendas <i class="c"></i>${esc(custo)} · mesma escala em todas as linhas</p>`;
    const escalaRet = (xs, f) => xs.reduce((mx, x) => Math.max(mx, ...f(x).map(v => (v > 0 ? v : 0))), 0);
    const saudeTxt = cor => `<b class="rv ${cor}">${esc(P.SAUDE_RET[cor] || P.SAUDE_RET[''])}</b>`;
    // v3.1 (imagem aprovada, igual Frete/Full): bloco recolhido "título + resumo" à esquerda e "Ver mais" à direita.
    const blocoAd = (k, titulo, resumo, dentro) => `<div class="card ad-bl"><div class="ad-cab"><div class="ad-t"><h3>${esc(titulo)}</h3><span>${resumo}</span></div>${dentro ? btVer(k) : ''}</div>${dentro && aberto(k) ? '<div class="ad-in">' + dentro + '</div>' : ''}</div>`;
    function cardAdsSku() {
        const fm = P.adsDoFechamento(fechMes), mes = P.nomeMes(SHC.hoje().slice(0, 7));
        const totMes = fm ? `Ads da conta em ${esc(mes)} (Faturamento): ${fm.ads !== null ? SHC.moeda(fm.ads) + ' de Product Ads' : 'Product Ads não lido'}${fm.seguidores ? ' + ' + SHC.moeda(fm.seguidores) + ' de Publicidade de Seguidores' : ''}.` : '';
        const cab = '<div class="ch"><h3>Ads</h3></div>', rodMes = totMes ? `<p class="det">${totMes}</p>` : '';
        if (!adsSnap) return `<div class="card">${cab}<p class="det">Aparece depois da próxima leitura do Mercado Ads.</p>${rodMes}</div>`;
        if (adsSnap.temAds === false) return `<div class="card">${cab}<p class="det">Esta conta não usa o Mercado Ads.</p>${rodMes}</div>`;
        const m = P.adsConta(adsSnap), lista = P.adsEquilibrio(adsSnap, itens, sobraDe), fs = P.adsFiltros(lista, cfg.margem_alvo_pct);
        const camps = P.adsCampanhasLista(adsSnap, lista), ver = P.adsVereditoDe(lista, m.gasto), per = periodoAds(), nAc = fs.acima.length;
        const tit = x => esc(x.a.titulo || (x.it && x.it.titulo) || x.a.itemId);
        // Manchete (1 frase) e KPIs
        const fato = ver.tipo === 'compensa' ? `O Ads dá lucro (ACOS ${pctOu(m.acos)}).` : ver.tipo === 'nao' ? `O Ads leva mais do que sobra (ACOS ${pctOu(m.acos)}).` : `Ads: ${SHC.moeda(m.gasto)} em 30 dias.`;
        const acao = nAc ? (nAc === 1 ? `${fs.acima[0].a.titulo || fs.acima[0].a.itemId} gasta mais do que aguenta.` : `${ver.tipo === 'compensa' ? 'Só ' : ''}${nAc} produtos gastam mais do que aguentam.`)
            : fs.escalar.length ? `${SHC.qtd(fs.escalar.length, 'produto aguenta', 'produtos aguentam')} investir mais.` : 'Nada pede sua atenção agora.';
        const ptM = ver.tipo === 'nao' ? 'pr' : nAc ? 'at' : ver.tipo === 'compensa' ? 'ok' : '';
        // v3.1 (imagem aprovada): KPI em R$ inteiro ("R$ 1.433", ESPEC §5); ACOS e ROAS com a cor do veredito da conta.
        const kR = v => SHC.moeda(Math.round(v || 0)).replace(/,00$/, ''), corV = ver.tipo === 'compensa' ? 'ok' : ver.tipo === 'nao' ? 'pr' : '';
        let h = `<p class="manchete"><span class="pt ${ptM}"></span><b>${esc(fato)}</b> ${esc(acao)}</p>
          <div class="kpis k4">${kpiN('', 'Investimento 30 dias', kR(m.gasto), esc(per))}${kpiN('', 'Vendas pelo Ads', kR(m.receita), esc(SHC.qtd(m.vendas, 'venda', 'vendas')))}`
          + kpiN(corV, 'ACOS ⓘ', pctOu(m.acos), ver.tipo === 'compensa' ? 'abaixo da sua margem' : ver.tipo === 'nao' ? 'acima da sua margem' : '', ACOS_TXT)
          + kpiN(m.roas !== null ? corV : '', 'ROAS ⓘ', xTxt(m.roas), m.roas !== null ? esc('R$ ' + (Math.round(m.roas * 100) / 100).toLocaleString('pt-BR') + ' por R$ 1') : '', ROAS_TXT) + '</div>';
        // Precisa de você: acima do equilíbrio (até 3; primeiro o que já dá prejuízo antes do Ads) e o que dá para escalar (até 2).
        // Tirar / Ajustar / Ver só ABREM o Ads do anúncio (detalhe na própria aba): mudar a campanha é com você, no Mercado Ads.
        const btV = (x, rot) => `<button class="bt leve pq" title="Abre o Ads deste anúncio. Mudar a campanha é com você, no Mercado Ads." data-ads-det="${esc(x.a.itemId)}">${rot}</button>`;
        const acimaOrd = fs.acima.slice().sort((x, y) => (x.margem > 0) - (y.margem > 0));
        const pv = acimaOrd.slice(0, 3).map(x => `<li class="acao ${x.margem !== null && x.margem <= 0 ? 'pr' : 'at'}"><div class="tx"><b>${tit(x)}</b><span>${x.acos !== null ? 'ACOS ' + esc(SHC.pctTxt(x.acos)) : 'gastou ' + SHC.moeda(x.a.gasto) + ' sem venda'} · ${x.margem > 0 ? 'aguenta até ' + esc(SHC.pctTxt(x.margem)) : 'já dá prejuízo antes do Ads'}</span></div>${btV(x, x.margem > 0 ? 'Ajustar' : 'Tirar')}</li>`)
            .concat(fs.escalar.slice(0, 2).map(x => `<li class="acao ok"><div class="tx"><b>${tit(x)}</b><span>ACOS ${esc(SHC.pctTxt(x.acos))} · dá para investir mais</span></div>${btV(x, 'Ver')}</li>`));
        if (pv.length) h += `<div class="card"><div class="ch"><h3>Precisa de você</h3></div><ul class="acoes">${pv.join('')}</ul>${nAc > 3 ? `<p class="rs">Mais ${esc(SHC.qtd(nAc - 3, 'produto acima do equilíbrio', 'produtos acima do equilíbrio'))} em “Por produto”.</p>` : ''}</div>`;
        else if (lista.some(x => !x.semCusto)) h += `<div class="card"><div class="ch"><h3>Precisa de você</h3></div><p class="est vazio"><span><b>Nenhum produto passa do equilíbrio.</b> ${esc(per)}</span></p></div>`;   // ESPEC §4: vazio com ✓ (sem custo → não dá para afirmar)
        // [Ver mais] Campanhas criadas
        const nAt = camps.filter(c => c.status === 'ativo').length;
        const resCamp = [nAt ? SHC.qtd(nAt, 'ativa', 'ativas') : SHC.qtd(camps.length, 'campanha', 'campanhas')].concat(camps.slice(0, 2).map(c => `${c.nome} ACOS ${pctOu(c.m.acos)}`)).join(' · ');
        // Cor da campanha: a mesma conta do selo (anúncios dela com custo: vendas, Ads e sobra antes do Ads), agora com o "apertado".
        const corCamp = c => {
            const xs = lista.filter(x => x.a.campanhaId === c.id && !x.semCusto), s = k => xs.reduce((t, x) => t + (k === 'antes' ? x.antes : x.a[k]), 0);
            return xs.length ? P.saudeRetorno(s('receita'), s('gasto'), s('antes'), cfg.margem_alvo_pct) : '';
        };
        const maxC = escalaRet(camps, c => [c.m.receita, c.m.gasto]);
        const linhaCamp = c => {
            const pd = perdeTxt(c), sub = [porDia(c.orcamentoDia), SHC.qtd(c.anuncios, 'anúncio', 'anúncios')].filter(Boolean).map(esc).join(' · '), cor = corCamp(c);
            return `<tr><td><b>${esc(c.nome)}</b><span class="sm">${seloCamp(c)} ${sub}</span>${pd ? `<span class="sm">${esc(pd)}</span>` : ''}`
                + `<span class="sm">${seloVer(c.veredito)}${c.veredito.semCusto ? ' ' + esc(SHC.qtd(c.veredito.semCusto, 'anúncio sem custo', 'anúncios sem custo')) : ''}</span></td>`
                + `<td>${SHC.moeda(c.m.gasto)}</td><td>${SHC.moeda(c.m.receita)}<span class="sm">${esc(SHC.qtd(c.m.vendas, 'venda', 'vendas'))}</span></td>`
                + `<td class="rv ${cor}">${pctOu(c.m.acos)}</td></tr>`
                + `<tr class="rbl"><td colspan="4">${barraRet(c.m.receita, c.m.gasto, maxC, cor)}</td></tr>`;
        };
        h += camps.length ? blocoAd('ads:camp', 'Campanhas criadas', esc(resCamp), legRet('investimento no Ads') + `<table class="tb"><thead><tr><th>Campanha</th><th>Gasto</th><th>Vendas</th><th title="${esc(ACOS_TXT)}">ACOS</th></tr></thead><tbody>`
                + camps.map(linhaCamp).join('') + (camps.length > 1 ? `<tr><td><b>Total</b></td><td><b>${SHC.moeda(m.gasto)}</b></td><td><b>${SHC.moeda(m.receita)}</b></td><td><b>${pctOu(m.acos)}</b></td></tr>` : '') + '</tbody></table>'
                + `<p class="det">${esc(per)}. Compensa = o Ads gastou menos do que sobra das vendas que trouxe (pelo custo que você informou).${adsSnap.completo === false ? ' Parte dos anúncios não foi lida.' : ''}</p>`)
            : blocoAd('ads:camp', 'Campanhas criadas', 'Nenhuma campanha lida no Mercado Ads.', '');
        // [Ver mais] Resumo da conta
        const ant = adsSnap.anterior && adsSnap.anterior.total ? adsSnap.anterior.total : null, antG = ant ? SHC.num(ant.custo !== undefined ? ant.custo : ant.cost) : null;
        const lin = (r, v, sub, cor) => `<tr><td>${r}${sub ? `<span class="sm">${sub}</span>` : ''}</td><td><b${cor ? ` class="rv ${cor}"` : ''}>${v}</b></td></tr>`;
        const resConta = [m.orcamentoDia !== null ? 'Orçamento ' + porDia(m.orcamentoDia) : '', m.cliques !== null ? SHC.qtd(m.cliques, 'clique', 'cliques') : '', m.tacos !== null ? 'TACOS ' + pctOu(m.tacos) : ''].filter(Boolean).join(' · ') || per;
        h += blocoAd('ads:conta', 'Resumo da conta', esc(resConta), '<table class="tb">'
            + lin('Investimento', SHC.moeda(m.gasto), esc(per) + (antG !== null ? ' · 30 dias antes: ' + SHC.moeda(antG) : ''))
            + lin('Vendas pelo Ads', SHC.moeda(m.receita), esc(SHC.qtd(m.vendas, 'venda', 'vendas')))
            + lin(`<span title="${esc(ACOS_TXT)}">ACOS ⓘ</span>`, pctOu(m.acos), 'parte da venda gasta em Ads', m.acos !== null ? corV : '')
            + lin(`<span title="${esc(ROAS_TXT)}">ROAS ⓘ</span>`, xTxt(m.roas), 'venda para cada R$ 1 no Ads', m.roas !== null ? corV : '')
            + (m.tacos !== null ? lin('<span title="TACOS = Ads ÷ todas as suas vendas.">TACOS ⓘ</span>', pctOu(m.tacos), 'Ads ÷ todas as suas vendas') : '')
            + lin('Cliques', intTxt(m.cliques), m.cpc !== null ? esc(SHC.moeda(m.cpc) + ' por clique') : '')
            + lin('Impressões', intTxt(m.impressoes), m.ctr !== null ? esc(SHC.pctTxt(m.ctr) + ' clicaram') : '')
            + lin('Orçamento diário somado', m.orcamentoDia !== null ? porDia(m.orcamentoDia) : '—', esc(SHC.qtd(m.campanhasAtivas, 'campanha ativa', 'campanhas ativas')))
            + (m.vendasOrganicas !== null ? lin('Vendas sem Ads', intTxt(m.vendasOrganicas), 'no mesmo período') : '')
            + '</table>' + (totMes ? `<p class="det">${totMes} Mês do calendário, por isso difere dos 30 dias.</p>` : ''));
        // [Ver mais] Por produto (filtros, equilíbrio e veredito por anúncio)
        // v3.1 (imagem aprovada + pedido da dona): barra em R$ do que o Ads custou (âmbar) e do que sobrou de lucro (verde) ou virou
        // prejuízo (vermelho) depois dele, na mesma escala em todas as linhas. Sem custo → só o Ads, sem lucro inventado.
        const nCat = (adsSnap.anuncios || []).filter(a => a && (a.catalogoProduto || a.type === 'catalog')).length, vis = fs[adsFiltro] || [];
        const maxP = escalaRet(vis.slice(0, 8), y => [y.a.gasto + (y.depois === null ? 0 : Math.abs(y.depois))]);
        const barraLuc = x => { const wg = larguraRet(x.a.gasto, maxP), d = x.depois;
            return `<span class="rb rbl2" aria-hidden="true"><i class="c" style="width:${wg}%"></i>${d ? `<i class="${d > 0 ? 'l' : 'p'}" style="left:${wg}%;width:${larguraRet(Math.abs(d), maxP)}%"></i>` : ''}</span>`; };
        const comCusto = lista.filter(x => x.depois !== null), depTot = SHC.r2(comCusto.reduce((t, x) => t + x.depois, 0));
        const resProd = SHC.qtd(lista.length, 'anúncio com gasto', 'anúncios com gasto') + (nAc ? ' · ' + nAc + ' acima do equilíbrio' : '')
            + (comCusto.length ? ' · ' + (depTot < 0 ? 'prejuízo ' + SHC.moeda(-depTot) : 'lucro ' + SHC.moeda(depTot)) + ' depois do Ads' : '');
        h += blocoAd('ads:prod', 'Por produto', esc(resProd),
            `<p class="det" style="margin-top:6px">${SHC.qtd(lista.length, 'anúncio', 'anúncios')} com gasto · ${SHC.moeda(SHC.r2(lista.reduce((t, x) => t + x.a.gasto, 0)))} (${esc(per)})${nCat ? ` · ${nCat} de catálogo fora da lista (o Mercado Ads não diz qual anúncio seu é)` : ''}</p>
              <div class="canais">${FILTROS_ADS.map(([k, rot, cor]) => `<button class="${cor}${adsFiltro === k ? ' on' : ''}" data-adsf="${k}">${fs[k].length} ${esc(rot.toLowerCase())}</button>`).join('')}</div>`
            + (vis.length ? '<p class="rleg"><i class="c"></i>Ads <i class="l"></i>lucro <i class="p"></i>prejuízo · mesma escala em todas as linhas</p>' + vis.slice(0, 8).map(x => { const cor = P.saudeRetorno(x.a.receita, x.a.gasto, x.antes, cfg.margem_alvo_pct);
                const res = x.depois === null ? 'lucro sem cálculo (sem custo)' : x.depois < 0 ? `<b class="rv pr">Prejuízo ${SHC.moeda(-x.depois)}</b>` : `<b class="rv ok">Lucro ${SHC.moeda(x.depois)}</b>`;
                return `<button class="linha-comp linha-ads" data-ads-det="${esc(x.a.itemId)}"><span class="rlt"><b>${esc(x.a.titulo || (x.it && x.it.titulo) || x.a.itemId)}</b><span class="rv ${cor}">${x.acos !== null ? 'ACOS ' + SHC.pctTxt(x.acos) : 'sem venda'}</span></span>
                  <small>${x.it && x.it.sku ? 'SKU ' + esc(x.it.sku) : esc(x.a.itemId)} · ${SHC.qtd(x.a.vendas, 'venda', 'vendas')}${x.a.receita > 0 ? ' (' + SHC.moeda(x.a.receita) + ')' : ''}${x.margem !== null ? ' · equilíbrio ' + SHC.pctTxt(x.margem) : ''} ›</small>`
                  + `${barraLuc(x)}<small>Ads ${SHC.moeda(x.a.gasto)} · ${res} · ${saudeTxt(cor)}</small></button>`; }).join('') + (vis.length > 8 ? `<p class="det">e mais ${vis.length - 8}.</p>` : '')
              : '<p class="det">Nenhum anúncio neste filtro.</p>')
            + '<p class="det">Acima do equilíbrio = o Ads custou mais que a sobra das vendas que ele trouxe. Dá para escalar = ACOS bem abaixo do equilíbrio, mesmo com a sua meta.</p>');
        return h + '<p class="det">Fonte: Mercado Ads. Criar, pausar ou mudar o orçamento é com você, no Mercado Ads.</p>';
    }

    function desenhaAds() {
        if (adsDet && desenhaAdsDetalhe(adsDet)) return;
        adsDet = null; $('#listaAds').innerHTML = cardAdsSku();
    }
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
    // v3.1 (pedido da dona, 29/09): Campanhas exclusivas — só quando houver alguma (sem nenhuma ou sem leitura → nada).
    function cardExclusivas(ex) {
        const l = (ex && ex.campanhas) || [];
        if (!l.length) return '';
        const linha = c => { const s = P.exclusivaSelo(c), com = SHC.afilExclusivaComissao(c), per = SHC.afilExclusivaPeriodo(c);
            const sub = [c.numero ? '#' + c.numero : '', c.afiliados !== null ? SHC.qtd(c.afiliados, 'afiliado', 'afiliados') : '', c.produtos !== null ? SHC.qtd(c.produtos, 'produto', 'produtos') : '',
                com ? 'comissão extra ' + com : '', per].filter(Boolean).join(' · ');
            return `<div class="rl"><span class="rlt"><b>${esc(c.titulo || 'Sem título')}</b><span class="selo ${s.cls}">${esc(s.txt)}</span></span><span class="sm">${esc(sub)}</span></div>`; };
        return `<div class="card"><div class="ch"><h3>Campanhas exclusivas</h3></div><p class="rs">${esc(SHC.afilExclusivasResumo(ex))}</p>${l.slice(0, 3).map(linha).join('')}`
            + (aberto('afil:excl') ? l.slice(3).map(linha).join('') : '') + (l.length > 3 ? `<p class="rs">${esc(SHC.qtd(l.length - 3, 'outra campanha', 'outras campanhas'))} ${btVer('afil:excl')}</p>` : '')
            + '<div class="acoes" style="justify-content:flex-start"><button class="bt leve" data-abrir-afil="exclusivas">Ver no ML</button></div></div>';
    }
    function cardAfiliados() {
        const x = P.afilCartao(afil, itens, sobraDe, cfg.margem_alvo_pct), cab = '<b style="font-size:13px">Afiliados</b>';
        if (x.estado === 'sem_dado') return `<div class="card">${cab}<p class="det">${status.erroAfiliados ? 'Não consegui ler os afiliados agora. Sincronize de novo.' : 'Sincronize para ver.'}</p></div>`;
        if (x.estado === 'nao_usa') return `<div class="card">${cab}<p class="det">Esta conta não usa afiliados · <button class="lnk" data-abrir-afil="hub">Conhecer</button></p></div>`;
        const ped = x.pedidos, qPed = x.qtdVendas !== null ? x.qtdVendas : ped ? ped.pedidos : null;
        const pctVendas = x.custo !== null && x.vendas > 0 ? SHC.pctTxt(SHC.r2(x.custo / x.vendas * 100)) + ' das vendas' : '';
        const nCome = x.comeLucro.length, fato = x.vendas !== null ? `Afiliados venderam ${SHC.moeda(x.vendas)} em 30 dias.` : 'Sua campanha de afiliados está lida.';
        const acao = nCome ? (nCome === 1 ? `Em ${x.comeLucro[0].titulo} a comissão come o lucro.` : `Em ${nCome} produtos a comissão come o lucro.`)
            : x.fora && x.fora.length ? `${SHC.qtd(x.fora.length, 'produto ativo está', 'produtos ativos estão')} fora da campanha.` : 'Nada pede sua atenção agora.';
        let h = `<p class="manchete"><span class="pt ${nCome ? 'at' : 'ok'}"></span><b>${esc(fato)}</b> ${esc(acao)}</p>
          <div class="kpis k4">${kpiN('', 'Vendas por afiliados', moedaOu(x.vendas), esc([qPed !== null ? SHC.qtd(qPed, 'pedido', 'pedidos') : '', x.unidades !== null ? intTxt(x.unidades) + ' un.' : ''].filter(Boolean).join(' · ')))}`
          + kpiN('', 'Comissão paga', moedaOu(x.custo), esc(pctVendas), 'Comissão que o Mercado Livre estima para os afiliados nos últimos 30 dias.')
          + kpiN(x.roi === null ? '' : x.roi >= 1 ? 'ok' : 'pr', 'Retorno (ROI)', xTxt(x.roi), x.roi === null ? '' : esc('R$ ' + (Math.round(x.roi * 100) / 100).toLocaleString('pt-BR') + ' por R$ 1'), 'ROI = vendas por afiliados ÷ comissão paga.')
          + kpiN(nCome ? 'at' : 'ok', 'Comissão come o lucro', String(nCome), nCome === 1 ? 'produto' : 'produtos', 'Produtos em que o que sobra da venda, menos a comissão do afiliado, fica negativo.') + '</div>'
          + `<p class="det" style="margin:-2px 0 8px">Últimos 30 dias${x.atualizado ? ' · o ML atualizou em ' + esc(quandoMl(x.atualizado)) : ''}${x.metricasInteiras ? '' : ' · lida só em parte'}</p>`;
        // Precisa de você: comissão que come o lucro
        if (nCome) h += `<div class="card"><div class="ch"><h3>Precisa de você</h3></div><ul class="acoes">`
            + x.comeLucro.slice(0, aberto('afil:come') ? 50 : 3).map(l => `<li class="acao at"><div class="tx"><b>${esc(l.titulo)}</b><span>com a comissão (${esc(SHC.pctTxt(l.pct))}): ${esc(menosMoeda(l.depois))} por venda</span></div><button class="bt leve pq" data-abrir-afil="campanha">Tirar no ML</button></li>`).join('')
            + '</ul>' + (nCome > 3 ? `<p class="rs">${esc(SHC.qtd(nCome - 3, 'outro produto', 'outros produtos'))} ${btVer('afil:come')}</p>` : '') + '</div>';
        // O que mais vendeu (top 3 aberto; o resto no Ver mais)
        // v3.1 (pedido da dona, 27/09): SKU abaixo do título e a barra vendas × comissão, na mesma escala de todas as linhas (abertas ou não).
        const maxTop = escalaRet(x.top, p => [p.vendas, p.custoEstimado]);
        const linhaTop = p => {
            const roi = p.custoEstimado > 0 && p.vendas > 0 ? SHC.r2(p.vendas / p.custoEstimado) : null;
            const sub = [p.sku ? 'SKU ' + p.sku : '', SHC.qtd(p.qtdVendas || 0, 'pedido', 'pedidos'), SHC.qtd(p.unidades || 0, 'unidade', 'unidades'), p.cliques !== null && p.cliques !== undefined ? SHC.qtd(p.cliques, 'clique', 'cliques') : ''].filter(Boolean).join(' · ');
            return `<div class="rl"><span class="rlt"><b>${esc(p.titulo || p.itemId)}</b><span class="rv ${p.cor}">${roi !== null ? 'ROI ' + esc(xTxt(roi)) : p.custoEstimado === 0 ? 'sem comissão' : 'ROI —'}</span></span>`
                + `<span class="sm">${esc(sub)}</span>${barraRet(p.vendas, p.custoEstimado, maxTop, p.cor)}<span class="sm">${SHC.moeda(p.vendas || 0)} em vendas · ${moedaOu(p.custoEstimado)} de comissão · ${saudeTxt(p.cor)}</span></div>`;
        };
        h += x.top.length ? `<div class="card"><div class="ch"><h3>O que mais vendeu</h3><span class="d det">30 dias</span></div>${legRet('comissão')}${x.top.slice(0, 3).map(linhaTop).join('')}`
            + (aberto('afil:top') ? x.top.slice(3).map(linhaTop).join('') : '')
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
            + (aberto('afil:extra') ? '<table class="tb">' + x.comExtra.slice(0, 30).map(p => `<tr><td>${esc(p.titulo || p.itemId)}</td><td><b>${esc(SHC.pctTxt(p.comissao))}</b></td></tr>`).join('') + '</table>' : '') : '';
        const parados = (x.pausados || x.encerrados) ? `<p class="rs" style="margin-top:6px">${esc(naoVenda)} na campanha: o anúncio não está à venda ${btVer('afil:parados')}</p>`
            + (aberto('afil:parados') ? '<table class="tb">' + P.anunciosAfilParados(afil).slice(0, 30).map(p => `<tr><td>${esc(p.titulo || p.itemId)}</td><td>${/^PAUSED$/i.test(p.publicacao) ? 'pausado' : 'encerrado'}</td></tr>`).join('') + '</table>' : '') : '';
        h += `<div class="card"><div class="ch"><h3>Sua campanha de afiliados</h3><span class="d">${statusAfil(x.status)}</span></div>${camp}${extra}${parados}
          <div class="acoes" style="justify-content:flex-start;flex-wrap:wrap"><button class="bt leve" data-abrir-afil="campanha">Abrir Venda com afiliados</button></div></div>`;
        h += cardExclusivas(afil.exclusivas);
        // Pedidos por afiliados (recolhido)
        if (ped) {
            const cab = [ped.confirmados.pedidos ? SHC.qtd(ped.confirmados.pedidos, 'confirmado', 'confirmados') : '', ped.aVerificar.pedidos ? ped.aVerificar.pedidos + ' a verificar' : '',
                ped.outros.pedidos ? SHC.qtd(ped.outros.pedidos, 'outro', 'outros') : ''].filter(Boolean).join(' · ') || 'nenhum pedido';
            const tab = `<table class="tb"><thead><tr><th>SKU</th><th>A verificar</th><th>Confirmado</th><th>Comissão</th></tr></thead><tbody>`
                + ped.porSku.slice(0, 40).map(g => `<tr><td><b>${esc(g.sku || g.itemId)}</b><span class="sm">${esc(g.titulo)} · ${SHC.moeda(g.valor)}</span></td><td>${g.aVerificar}</td><td>${g.confirmados}</td><td>${SHC.moeda(g.comissao)}</td></tr>`).join('')
                + `</tbody></table><p class="det">A verificar: ${SHC.moeda(ped.aVerificar.valor)} em vendas, ${SHC.moeda(ped.aVerificar.comissao)} de comissão. Confirmado: ${SHC.moeda(ped.confirmados.valor)}, ${SHC.moeda(ped.confirmados.comissao)} de comissão.${ped.completo === false ? ' Lidos só em parte.' : ''} O Copiloto não guarda nome de afiliado nem de comprador.</p>`;
            h += blocoAf('afil:pedidos', 'Pedidos por afiliados', esc(cab + (ped.pedidos ? ' · por SKU' : ' em 30 dias')), ped.pedidos ? tab : '');
        } else h += `<div class="card"><div class="ch"><h3>Pedidos por afiliados</h3></div><p class="det">${afil.pedidos === null ? 'Não consegui ler os pedidos agora. Aparecem na próxima sincronização.' : 'Aparecem depois da próxima sincronização.'}</p></div>`;
        // Fora da campanha (recolhido)
        if (x.fora && x.fora.length) h += blocoAf('afil:fora', 'Fora da campanha', esc(SHC.qtd(x.fora.length, 'anúncio ativo que os afiliados não divulgam', 'anúncios ativos que os afiliados não divulgam')),
            '<table class="tb">' + x.fora.slice(0, 40).map(it => `<tr><td>${esc(it.titulo || it.itemId)}</td><td>${it.preco > 0 ? SHC.moeda(it.preco) : ''}</td></tr>`).join('') + '</table>'
            + (x.fora.length > 40 ? `<p class="det">e mais ${esc(String(x.fora.length - 40))}.</p>` : ''));
        else if (!x.listaInteira) h += `<div class="card"><div class="ch"><h3>Fora da campanha</h3></div><p class="det">Aparece quando a lista inteira da campanha for lida (${esc(SHC.qtd(x.lidos, 'produto lido', 'produtos lidos'))}${x.naCampanha > x.lidos ? ' de ' + esc(x.naCampanha.toLocaleString('pt-BR')) : ''}).</p></div>`;
        // Clique sem venda (recolhido)
        if (x.semVenda.length) h += blocoAf('afil:clique', 'Clique sem venda', esc(SHC.qtd(x.semVenda.length, 'produto', 'produtos') + ' · ' + SHC.qtd(x.semVenda.reduce((t, p) => t + p.cliques, 0), 'clique', 'cliques')),
            '<p class="det" style="margin-top:6px">' + x.semVenda.slice(0, 10).map(p => esc(p.titulo || p.itemId) + ' (' + p.cliques + ')').join(' · ') + '</p>');
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
        // Precisa de você: o que está em aberto agora (o ML não passa o prazo nesta tela: sem data inventada). v3.1: em destaque, na pílula
        // de prazo, quantas reclamações lidas o ML marca "Aguardando sua resposta"; "Abrir no ML" na 1ª linha.
        const esp = (posvenda.casos || []).filter(c => c && /aguardando sua resposta/i.test(c.situacao || '')).length;
        const ab = [r > 0 ? ['pr', 'Reclamações e mediações', SHC.qtd(r, 'em aberto', 'em aberto') + ' · responda para proteger a reputação', esp ? esp + (esp === 1 ? ' aguarda você' : ' aguardam você') : ''] : null,
            d > 0 ? ['at', 'Devoluções', SHC.qtd(d, 'pendente', 'pendentes')] : null, m > 0 ? ['at', 'Mensagens', SHC.qtd(m, 'sem resposta', 'sem resposta')] : null].filter(Boolean);
        if (ab.length) h += '<div class="card" id="posPrecisa"><div class="ch"><h3>Precisa de você</h3></div><ul class="acoes">'
            + ab.map(([c, tit, tx, pz], i) => `<li class="acao ${c}"><div class="tx"><b>${pz ? `<span class="prazo pr">${esc(pz)}</span>` : ''}${esc(tit)}</b><span>${esc(tx)}</span></div>`
                + `${i === 0 ? '<button class="bt ml pq" data-abrir-posvenda>Abrir no ML</button>' : ''}</li>`).join('') + '</ul></div>';
        if (!a) return h + '<div class="card"><div class="ch"><h3>Motivos das reclamações</h3></div><p class="det">Os motivos e os produtos com mais reclamação aparecem depois da próxima sincronização.</p></div>';
        if (!a.total) return h + '<div class="card"><div class="ch"><h3>Motivos das reclamações</h3></div><p class="det">✓ Nenhuma reclamação na lista do Mercado Livre.</p></div>';
        // Motivos agrupados: barra = casos ÷ o maior.
        const max = a.motivos[0].casos, nMot = aberto('pos:motivos') ? a.motivos.length : 5;
        h += `<div class="card" id="posMotivos"><div class="ch"><h3>Motivos das reclamações</h3><span class="d det">${esc(SHC.qtd(a.total, 'caso', 'casos'))}</span></div>`
            + a.motivos.slice(0, nMot).map((x, i) => `<div class="hb"><div class="l"><b>${esc(curtoTxt(x.motivo, 40))}</b><span class="v">${x.casos}${x.valor > 0 ? ' · <small>' + SHC.moeda(x.valor) + '</small>' : ''}</span></div>`
                + `<div class="medidor"><i class="${i === 0 ? 'pr' : x.casos > 1 ? 'at' : ''}" style="width:${Math.max(4, Math.round(x.casos / max * 100))}%"></i></div></div>`).join('')
            + (a.motivos.length > 5 ? `<p class="rs">${esc(SHC.qtd(a.motivos.length - 5, 'outro motivo', 'outros motivos'))} ${btVer('pos:motivos')}</p>` : '')
            + `<p class="rs">${esc(a.naReputacao + ' de ' + a.total)} contaram na sua reputação.</p></div>`;
        // Produtos que mais dão problema (SKU pelo anúncio achado pelo título; sem anúncio, o título). v3.1 (imagem tela-posvenda): % das vendas
        // em vermelho acima de 5% (ESPEC §6), barra = casos ÷ o maior na cor da situação, e a dica em 1 linha.
        const maxP = a.produtos[0].casos, hj = SHC.hoje();
        const linhaP = (p, i) => {
            const ms = Object.keys(p.motivos).sort((x, y) => p.motivos[y] - p.motivos[x]), dica = P.dicaMotivo(ms[0]), pc = P.posPctVendas(p.casos, p.itemId, vm, hj);
            const cor = pc === null ? (i === 0 ? 'pr' : p.casos > 1 ? 'at' : '') : pc > 5 ? 'pr' : pc >= 2 ? 'at' : 'ok';
            return `<tr><td title="${esc(p.titulo)}"><b>${esc(p.sku || p.titulo)}</b><span class="sm">${esc(ms.map(x => x + ' (' + p.motivos[x] + ')').join(' · '))}</span>`
                + `<span class="medidor"><i class="${cor}" style="width:${Math.max(4, Math.round(p.casos / maxP * 100))}%"></i></span>`
                + `${dica ? `<span class="dica">${esc(dica)}</span>` : ''}</td><td>${p.casos}</td><td class="pc ${pc !== null && pc > 5 ? 'pr' : ''}">${pc === null ? '—' : String(pc).replace('.', ',') + '%'}</td></tr>`;
        };
        const ajP = 'SKU pelo anúncio achado pelo título da reclamação. % vendas = casos ÷ unidades vendidas do anúncio neste mês e no anterior; acima de 5% fica em vermelho. "—" = sem venda lida.';
        h += `<div class="card" id="posProdutos"><div class="ch"><h3>Produtos que mais dão problema</h3><button class="ajuda" type="button" title="${esc(ajP)}" aria-label="Ajuda: produtos que mais dão problema">?</button></div><table class="tb"><thead><tr><th>SKU</th><th>Casos</th><th>% vendas</th></tr></thead><tbody>`
            + a.produtos.slice(0, aberto('pos:prod') ? 50 : 3).map(linhaP).join('') + '</tbody></table>'
            + (a.produtos.length > 3 ? `<p class="rs">${esc(SHC.qtd(a.produtos.length - 3, 'outro produto', 'outros produtos'))} ${btVer('pos:prod')}</p>` : '') + '</div>';
        // Todas as reclamações lidas (recolhido): produto, motivo, situação, valor e se contou na reputação. Sem pedido, sem comprador.
        const cs = posvenda.casos;
        h += blocoAf('pos:casos', 'Todas as reclamações lidas', esc(SHC.qtd(cs.length, 'reclamação', 'reclamações') + ' · sem nome do comprador'),
            '<table class="tb">' + cs.slice(0, 60).map(c => `<tr><td><b>${esc(c.titulo || '—')}</b><span class="sm">${esc([c.motivo, c.situacao].filter(Boolean).map(x => curtoTxt(x, 60)).join(' · '))}</span></td>`
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
        let h = `<div class="card" id="cardRemessas"><div class="fu-cab"><div class="fu-t"><h3>Todas as remessas</h3><span>${esc(resumo)}${rr.multasMes ? ` · <span class="vm">multas ${SHC.moeda(rr.multasMes)}</span>` : ''}</span></div>${btVer(k, 'Ver mais', 'Ver menos')}</div>`;
        if (aberto(k)) {
            const incs = incRemessas();   // a mesma regra do cartão de cima: reclamação já aberta → "Ver a reclamação"; prazo vencido → "Abrir no ML"
            const rotulo = r => { const x = incs.find(i => String(i.id) === String(r.id)); return x ? (x.reclamacaoAberta ? 'Ver a reclamação' : SHC.remessaPendente(x) ? 'Reclamar no ML' : 'Abrir no ML') : r.inconforme ? 'Reclamar no ML' : 'Abrir no ML'; };
            h += '<ul class="tl">' + ls.map(r => {
                const cls = r.inconforme || r.multaTexto ? 'pr' : r.passo === 3 ? 'ok' : r.passo > 0 ? 'at' : '';
                return `<li${cls ? ` class="${cls}"` : ''}><div class="dt">${esc([dm(r.quando), r.statusTexto].filter(Boolean).join(' · '))}</div>`
                    + `<div class="ev">#${esc(r.id)} · ${un(r)}</div>`   // v3.1: a etapa já está no título e na cor do ponto (imagem aprovada), sem os passos repetidos em cada linha
                    + [r.custo ? 'o ML cobrou ' + SHC.moeda(r.custo) : ''].concat(r.textos.map(esc), r.multaTexto ? [esc(r.multaTexto)] : []).filter(Boolean).map(t => `<div class="sub">${t}</div>`).join('')
                    + `<a class="lnk" href="${esc(r.link)}" target="_blank" rel="noopener" style="font-size:11.5px">${rotulo(r)}</a></li>`;
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
            // Fechado: só os produtos com diferença (imagem tela-full); "Ver a remessa" abre todos.
            const ps = r.produtos.slice().sort((a, b) => temDif(b) - temDif(a)), comDif = ps.filter(temDif), vis = aberto(k) || !comDif.length ? ps : comDif.slice(0, 4);
            const motivo = r.motivos.join(' · '), pend = SHC.remessaPendente(r), prazo = pend && r.prazo ? P.dataBr(r.prazo).slice(0, 5) : '';
            const cls = r.reclamacaoAberta ? ' at' : pend ? '' : ' nd', tit3 = r.reclamacaoAberta ? 'Remessa #' + r.id + ': reclamação aberta' : 'Remessa #' + r.id + ' veio com diferença';
            // v3.1 (imagem aprovada tela-full): tabela Enviou × Contou × Diferença; "Ver a remessa" abre aqui mesmo o resto (todos os produtos e declaradas × aptas).
            const decl = r.declaradas !== null || r.aptas !== null ? `<p class="rs">${n(r.declaradas)} declaradas · ${n(r.aptas)} aptas para o Full</p>` : '';
            let h = `<div class="card inc${cls}"><div class="ch"><h3>${esc(tit3)}</h3>${prazo ? `<span class="prazo pr d">reclame até ${esc(prazo)}</span>` : ''}</div>`
                + `<p class="rs">Processada em ${esc(P.dataBr(r.quando).slice(0, 5))} · <b>${esc(motivo.charAt(0).toUpperCase() + motivo.slice(1))}</b>${r.custo ? ` · o ML cobrou <b>${SHC.moeda(r.custo)}</b>` : ''}</p>`
                + (ps.length ? '' : decl);
            if (ps.length) h += '<table class="tb" style="margin:8px 0 4px"><thead><tr><th>Produto</th><th>Enviou</th><th>Contou</th><th>Diferença</th></tr></thead><tbody>'
                + vis.map(p => `<tr><td>${esc(tit(p.itemId) || p.sku || p.itemId)}<span class="sm">${esc([p.sku, (p.naoAptas || 0) > 0 ? fmtUn(p.naoAptas) + ' não aptas' : '', p.resultado].filter(Boolean).join(' · '))}</span></td>`
                    + `<td>${n(p.declaradas)}</td><td>${n(p.processadas)}</td><td${p.diferencas || p.naoAptas > 0 ? ' class="vm"' : ''}>${!p.diferencas && p.naoAptas > 0 ? sinal(-p.naoAptas) : p.diferencas === null || p.diferencas === undefined ? '—' : sinal(p.diferencas)}</td></tr>`).join('')
                + '</tbody></table>' + (aberto(k) ? decl : ps.length > vis.length ? `<p class="rs">e mais ${esc(SHC.qtd(ps.length - vis.length, 'produto', 'produtos'))}${comDif.length && comDif.length <= 4 ? ' sem diferença' : ''}</p>` : '');
            else h += '<p class="det">O detalhe por produto aparece depois da próxima leitura desta remessa.</p>';
            const [bt, dica] = r.reclamacaoAberta ? ['Ver a reclamação no ML', 'Você já abriu a reclamação desta remessa. Acompanhe a resposta no ML.']
                : !pend ? ['Ver a remessa no ML', 'O ML não aceita mais reclamação nesta remessa.']
                : ['Reclamar no ML', 'Abre a remessa no ML: lá, toque em “Iniciar reclamação por diferenças”.'];
            const ver = ps.length && (ps.length > vis.length || aberto(k) || decl) ? `<button class="bt leve" data-ver="${esc(k)}" aria-expanded="${aberto(k)}">${aberto(k) ? 'Ver menos' : 'Ver a remessa'}</button>` : '';
            return h + `<div class="linha-bts"><a class="bt ${pend ? 'ml' : 'leve'}" href="${esc(r.link)}" target="_blank" rel="noopener">${esc(bt)}</a>${ver}</div>`
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
        // O último mês de espaço que o ML mostra (ex.: "Outubro: 600 + 40 un. (estimado)"), só com as unidades que ele deu.
        const mU = meses[meses.length - 1], segU = ((mU && mU.segmentos) || []).map(g => P.un(g.unidades)).filter(u => u !== null);
        const m0 = mU && txtML(mU.mes) && segU.length ? `${txtML(mU.mes)}: ${segU.map(fmtUn).join(' + ')} un.${txtML(mU.pill) ? ' (' + txtML(mU.pill).toLowerCase() + ')' : ''}` : '';
        h += v !== null ? `<div class="gauge">${P.gaugeSvg(v, max)}<div><div class="gv">${fmtUn(v)}<small> de ${fmtUn(max)}</small></div><div class="fx ${fx}">${nomeFx}</div>${m0 ? `<div class="fu-mes">${esc(m0)}</div>` : ''}</div></div>`
            + '<div class="faixas"><span><i style="background:#EF4444"></i>0–49 baixa</span><span><i style="background:#F59E0B"></i>50–74 atenção</span><span><i style="background:#10B981"></i>75–100 boa</span></div>'
            : `<p class="rs">${tot ? esc(tot) : 'O Mercado Livre ainda não mostrou o total.'}</p>`;
        h += '<div class="fu-met">' + cards.map(c => {
            const cm = P.un(c.max), cp = P.un(c.pontos), p = cm > 0 && cp !== null ? Math.max(0, Math.min(100, cp / cm * 100)) : null;
            return `<div class="hb"><div class="l"><b>${esc(txtML(c.titulo))}</b><span class="v${p !== null ? ' ' + P.faixaPontos(p) : ''}">${cm !== null ? fmtUn(c.pontos) + ' / ' + fmtUn(cm) : esc(txtML(c.pontos))}</span></div>`
                + (p !== null ? `<div class="medidor"><i class="${P.faixaPontos(p)}" style="width:${Math.max(3, Math.round(p))}%"></i></div>` : '') + (txtML(c.texto) ? `<small class="det">${esc(txtML(c.texto))}</small>` : '') + '</div>';
        }).join('') + '</div>' + (txtML(pt.dica) ? `<div class="recnota aviso">${esc(txtML(pt.dica))}</div>` : '');
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
    // v3.1 (imagem aprovada tela-full): "O que enviar primeiro" — 1 quantidade por produto (quem acaba antes no topo), 30/45 dias e quanto ainda cabe.
    // Os botões só abrem o ML (Gestão de envios / Estoque Full): o Copiloto não cria envio.
    function cardEnviar(pl) {
        const env = pl.linhas.filter(l => l.qtd > 0), esp = full.espaco || [];
        const chips = [30, 45].concat([30, 45].includes(fullDias) ? [] : [fullDias]).map(d => `<button class="chip${d === fullDias ? ' on' : ''}" data-full-dias="${d}" aria-pressed="${d === fullDias}">${d === fullDias ? d + ' dias' : 'Mudar para ' + d + ' dias'}</button>`).join('');
        const cor = l => { const c = l.saude && l.saude.classe; return c === 'critico' || c === 'sem_estoque' ? ' pr' : c === 'atencao' ? ' at' : ''; };
        const sub = l => {
            const s = l.saude || {}, ap = P.un(l.p.aptas), v = P.un(l.p.vendas30);
            if (ap === 0 || s.classe === 'sem_estoque') return ['sem estoque', v !== null ? 'vendeu ' + fmtUn(v) + ' em 30 dias' : ''].filter(Boolean).join(' · ');
            return [ap !== null ? fmtUn(ap) + ' no Full' : '', s.dias !== null && s.dias !== undefined ? 'acaba em ' + P.dias(s.dias) : ''].filter(Boolean).join(' · ');
        };
        const cabe = esp.filter(e => P.un(e.livre) !== null).map(e => fmtUn(e.livre) + ' un. em ' + (semTags(e.titulo).replace(/:.*$/, '') || e.id).toLowerCase());
        const ajuda = `Quantidade para ${fullDias} dias de venda (estimativa do Copiloto). Previsão = o maior entre as vendas dos últimos 30 dias e as do mesmo mês do ano passado. Quem acaba antes vem no topo. Espaço, pontuação e estoque vêm do Estoque Full do Mercado Livre.`;
        let h = `<div class="card" id="cardEnviar"><div class="ch"><h3>O que enviar primeiro</h3><button class="ajuda" title="${esc(ajuda)}" aria-label="${esc(ajuda)}">?</button></div><div class="chips">${chips}</div>`;
        h += env.length ? '<ul class="acoes">' + env.slice(0, 3).map(l => `<li class="acao${cor(l)}"><div class="tx"><b>${esc(l.p.titulo || l.p.sku || 'Produto do Full')}</b><span>${esc(sub(l))}</span></div><div class="val">${fmtUn(l.qtd)} un.</div></li>`).join('') + '</ul>'
            + (env.length > 3 ? `<p class="rs">e mais ${esc(SHC.qtd(env.length - 3, 'produto', 'produtos'))} em “Todos os produtos”</p>` : '')
            : `<p class="est vazio">Nada a enviar para cobrir ${fullDias} dias.</p>`;
        if (cabe.length) h += `<p class="rs">Ainda cabe: ${esc(cabe.join(' · '))}</p>`;
        h += cardProxRemessa();   // ESPEC §6 Full 4: a Próxima remessa é o rodapé deste cartão (um cartão só)
        return h + '<div class="linha-bts"><button class="bt" data-abrir-full="envios">Criar envio no ML</button><button class="bt leve" data-abrir-full="estoque">Estoque Full</button></div></div>';
    }
    // v2.7: próxima remessa — SKUs e quantidades da sugestão de envio (editáveis), volume, peso, veículo e custo estimado (SHC.simulaRemessa, honesto: aprende com as suas remessas).
    function cardProxRemessa() {
        const pl = planoAtual(), linhas = pl.linhas.filter(l => l.qtd > 0 || simQtd[(l.p && l.p.sku) || (l.p && (l.p.itemId || l.p.titulo)) || ''] !== undefined).map(l => Object.assign({ itemIds: idsDoPlano(l.p) }, l));
        const k = 'full:proxima', skus = P.skusParaSimular(linhas, simQtd, (ids, sku) => SHC.medidasParaSimular(ids, medidas, sku ? cadSku[SHC.chaveSku(sku)] : null));
        const s = SHC.simulaRemessa({ skus, remessasAnteriores: remessas });
        // As unidades já estão no KPI "Enviar agora" e na lista acima: o rodapé diz só o que é novo (veículo e custo da coleta).
        const resumo = !skus.length ? 'nada a enviar para essa cobertura' : [s.veiculo ? s.veiculo.replace(/ \(.*$/, '') : '', s.custoEstimado ? 'cerca de ' + SHC.moeda(s.custoEstimado.valor) : ''].filter(Boolean).join(' · ') || 'volume, peso e custo da coleta';
        let h = `<div class="fu-prox" id="cardProxRemessa"><div class="fu-cab"><div class="fu-t"><b>Próxima remessa (estimativa)</b><span>${esc(resumo)}</span></div>${btVer(k)}</div>`;
        if (!aberto(k)) return h + '</div>';
        if (!skus.length) return h + '<p class="det">Nenhum produto precisa de envio para a cobertura escolhida acima. Mude os dias em Cobrir para simular.</p></div>';
        const fmt3 = v => String(Math.round(v * 1000) / 1000).replace('.', ','), kg = v => String(SHC.r2(v)).replace('.', ',') + ' kg';
        h += `<p class="det" style="margin-top:6px">As quantidades vêm de “O que enviar primeiro”. Edite e toque em Recalcular. Nada é criado no Mercado Livre.</p>`
            + skus.map(x => { const it = s.itens.find(i => i.sku === x.sku) || {}; return `<div class="minfull"><label><span style="flex:1;min-width:0;white-space:normal;overflow-wrap:anywhere;font-weight:600">${esc(x.titulo || x.sku)}</span><input class="inp" data-sim-sku="${esc(x.sku)}" inputmode="numeric" value="${x.qtd}"></label><span>un.</span></div>`
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
        // v3.1 (imagem aprovada tela-full): manchete e KPIs em cima; à esquerda o que pede ação (remessa com diferença → o que enviar → a caminho),
        // à direita o retrato (pontuação → saúde do estoque → remessas → espaço → produtos). Em 400 px vira uma coluna, nessa ordem.
        const pl = prods.length ? planoAtual() : null, nomeEsp = e => semTags(e.titulo).replace(/:.*$/, '') || e.id;
        let esq = cardInconformes() + (pl ? cardEnviar(pl) : '') + cardCaminho(), dir = cardPontuacao() + (pl ? cardSaudeFull(pl) : '') + cardRemessas();
        if (esp.length) {
            dir += blocoFull('full:espaco', 'Espaço no Full', esp.map(e => `${nomeEsp(e)} ${fmtUn(e.usado)}/${fmtUn(e.capacidade)}`).join(' · '), esp.map(e => {
                const pct = Math.max(0, Math.min(100, P.un(e.pct) || 0)), cor = pct >= 90 ? 'var(--verm)' : (pct >= 70 ? 'var(--ambar)' : 'var(--verde)');
                return `<div style="margin-top:8px"><div style="display:flex;gap:6px;font-size:12px"><span style="flex:1">${esc(nomeEsp(e))}</span><b>${fmtUn(e.usado)} de ${fmtUn(e.capacidade)} un.</b></div>
                  <div class="prog" style="margin:4px 0 2px"><i style="width:${pct}%;background:${cor}"></i></div>
                  <small class="det">${[P.un(e.noFull) !== null ? 'No Full ' + fmtUn(e.noFull) + ' un.' : '', P.un(e.pendente) !== null ? 'entrada pendente ' + fmtUn(e.pendente) + ' un.' : '', P.un(e.livre) !== null ? 'você pode enviar até ' + fmtUn(e.livre) + ' un.' : ''].filter(Boolean).join(' · ')}</small></div>`;
            }).join(''));
        }
        const cea = full.custosEstoqueAntigo, ceaTxt = (Array.isArray(cea) ? cea : (cea && Array.isArray(cea.textos) ? cea.textos : (cea ? [cea] : []))).map(txtML).filter(Boolean);
        if (ceaTxt.length) dir += blocoFull('full:antigo', 'Custos por estoque antigo', 'o ML mostra custo de armazenamento', ceaTxt.map(t => `<p class="det" style="margin:4px 0 0">${esc(t)}</p>`).join('') + '<p class="det">Texto do Mercado Livre.</p>');
        dir += pl ? cardProdutosFull(pl) : '<div class="card"><b style="font-size:13px">Nenhum produto no Full agora</b><p class="det">Quando você enviar estoque, cada produto aparece aqui com a sugestão de envio.</p></div>';
        const cols = [esq, dir].filter(Boolean);
        alvo.innerHTML = velho + avisos.map(a => `<div class="recnota ruim" style="margin:0 0 8px"><b>Aviso do Mercado Livre:</b> ${esc(a)}</div>`).join('') + topoFull(prods)
            + `<div class="fu-grade${cols.length < 2 ? ' um' : ''}">${cols.map(c => `<div class="fu-col">${c}</div>`).join('')}</div>` + (pl ? '' : LINKS_FULL)
            + `<p class="det">O Copiloto não cria envio nem mexe no seu Full: só mostra. Fonte: Estoque Full e Gestão de envios Full do Mercado Livre.${quando ? ' ' + esc(quando) : ''}</p>`;
    }
    // Bloco recolhido da aba Full: título + resumo de 1 linha e "Ver mais" à direita; aberto, o corpo vem embaixo.
    function blocoFull(k, tit, resumo, corpo) {
        return `<div class="card"><div class="fu-cab"><div class="fu-t"><h3>${esc(tit)}</h3><span>${esc(resumo)}</span></div>${btVer(k)}</div>${aberto(k) ? '<div class="fu-in">' + corpo + '</div>' : ''}</div>`;
    }
    const COR_CLASSE = { critico: 'p', sem_estoque: 'p', atencao: 'a', excedente: 'a', saudavel: 'l', parado: 'n' };
    const DICA_CLASSE = { critico: 'acaba em até 7 dias ou está abaixo do estoque mínimo que você definiu', atencao: 'acaba em até 15 dias', saudavel: 'estoque para mais de 15 dias',
        excedente: 'estoque para mais de 90 dias ou o ML mostra estoque antigo (pode ter custo de armazenamento)', parado: 'tem estoque e nenhuma venda em 30 dias', sem_estoque: 'nenhuma unidade apta no Full' };
    // v3.1 (ESPEC §2 "Saúde do estoque"): 6 números grandes que filtram "Todos os produtos" + o estoque parado/sobrando em barras (maior = 100%).
    const ORDEM_CLASSE = ['critico', 'sem_estoque', 'atencao', 'saudavel', 'excedente', 'parado'], TINTA_CLASSE = { critico: 'pr', sem_estoque: 'pr', atencao: 'at', saudavel: 'ok' };
    function cardSaudeFull(pl) {
        const nc = P.contaClasses(pl.linhas);
        const par = pl.linhas.filter(l => l.saude && (l.saude.classe === 'parado' || l.saude.classe === 'excedente') && P.un(l.p.aptas) > 0).sort((a, b) => P.un(b.p.aptas) - P.un(a.p.aptas));
        const ajuda = `Crítico = ${DICA_CLASSE.critico}. Parado = ${DICA_CLASSE.parado}. Excedente = ${DICA_CLASSE.excedente}. Toque num número para ver só esses produtos.`;
        let h = `<div class="card" id="cardSaudeFull"><div class="ch"><h3>Saúde do estoque</h3><span class="d det">${esc(SHC.qtd(pl.linhas.length, 'produto', 'produtos'))}</span><button class="ajuda" title="${esc(ajuda)}" aria-label="${esc(ajuda)}">?</button></div>`
            + '<ul class="estq">' + ORDEM_CLASSE.map(c => `<li${TINTA_CLASSE[c] ? ` class="${TINTA_CLASSE[c]}"` : ''}><button${fullClasse === c ? ' class="on"' : ''} data-fclasse="${c}" title="${esc(DICA_CLASSE[c])}" aria-pressed="${fullClasse === c}">${nc[c]} <span>${esc(P.CLASSES_FULL[c].toLowerCase())}</span></button></li>`).join('') + '</ul>'
            + (nc.semDado ? `<p class="rs">${esc(SHC.qtd(nc.semDado, 'produto', 'produtos'))} sem dado para classificar</p>` : '');
        if (par.length) {
            const mx = P.un(par[0].p.aptas);
            h += '<p class="rs fu-sub">Parado ou sobrando no Full</p>' + par.slice(0, 3).map(l => {
                const a = P.un(l.p.aptas), v = P.un(l.p.vendas30), vt = v === null ? '' : v > 0 ? ' · ' + SHC.qtd(v, 'venda', 'vendas') + ' em 30 dias' : ' · nenhuma venda em 30 dias';
                return `<div class="hb"><div class="l"><b>${esc(l.p.titulo || l.p.sku || 'Produto do Full')}</b><span class="v">${fmtUn(a)} un.</span></div><div class="medidor"><i class="${l.saude.classe === 'parado' ? 'at' : ''}" style="width:${Math.max(3, Math.round(a / mx * 100))}%"></i></div>`
                    + `<small class="det">${esc(P.CLASSES_FULL[l.saude.classe].toLowerCase() + vt)}</small></div>`;
            }).join('') + (par.length > 3 ? `<p class="rs">e mais ${esc(SHC.qtd(par.length - 3, 'produto', 'produtos'))}: toque em parado ou excedente</p>` : '');
        }
        return h + '</div>';
    }
    // "Todos os N produtos": recolhido (título + resumo · Ver mais); aberto ou filtrado por uma classe, a cobertura em dias e um cartão por produto.
    function cardProdutosFull(pl) {
        const total = pl.linhas.reduce((a, l) => a + (l.qtd || 0), 0), nEnv = pl.linhas.filter(l => l.qtd > 0).length;
        const semCusto = pl.linhas.filter(l => l.lucro === null && !l.semAnuncio).length, semAn = pl.linhas.filter(l => l.semAnuncio).length;
        const vis = pl.linhas.filter(l => !fullClasse || (l.saude && l.saude.classe === fullClasse)), n = pl.linhas.length;
        const resumo = fullClasse ? `só ${P.CLASSES_FULL[fullClasse].toLowerCase()}: ${SHC.qtd(vis.length, 'produto', 'produtos')}` : 'Estoque mínimo, vendas e sugestão por produto';
        let html = `<div class="card" id="fuProdutos"><div class="fu-cab"><div class="fu-t"><h3>${n === 1 ? 'O produto no Full' : 'Todos os ' + n + ' produtos'}</h3><span>${esc(resumo)}</span></div>`
            + (fullClasse ? `<button class="lnk ver" data-fclasse="${esc(fullClasse)}">Ver todos</button>` : btVer('full:produtos')) + '</div>';
        if (!fullClasse && !aberto('full:produtos')) return html + '</div>';
        html += `<div class="fu-in"><div class="sim" style="margin-top:0"><label for="fullDias">Cobrir</label><input class="inp" id="fullDias" inputmode="numeric" value="${fullDias}"><span>dias</span><button class="bt leve" data-full-dias>Ver</button></div>
          <p style="margin:8px 0 0;font-size:12.5px">${nEnv ? `Enviar <b>${total} un.</b> de ${SHC.qtd(nEnv, 'produto', 'produtos')}, na ordem abaixo.` : 'Nenhum produto precisa de envio para essa cobertura.'}</p>
          <p class="det">Ordem: quem acaba antes; empate, quem dá mais lucro. Com prejuízo, no fim.${semCusto ? ` ${SHC.qtd(semCusto, 'produto', 'produtos')} sem custo: a ordem não considera o lucro deles.` : ''}${semAn ? ` ${SHC.qtd(semAn, 'produto', 'produtos')} sem anúncio ligado na sua lista: sem lucro e sem vendas do ano passado.` : ''}</p></div></div>`;
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
        // v3.1 (imagem tela-ajustes): "40.000" (centavos só quando há); sem meta = vazio.
        $('#meta_mes').value = SHC.num(cfg.meta_mes) > 0 ? SHC.num(cfg.meta_mes).toLocaleString('pt-BR', { minimumFractionDigits: SHC.num(cfg.meta_mes) % 1 ? 2 : 0, maximumFractionDigits: 2 }) : '';
        // Mesma conta do guia (SHC.guiaCustos): todos os SKUs e os 10 que mais vendem.
        const cu = SHC.guiaCustos(anuncios && anuncios.itens, Object.assign({}, custosMl, cadSku), vm), pct = cu.deTodos ? Math.round(cu.comTodos / cu.deTodos * 100) : 0;
        $('#custosProg').style.width = pct + '%';
        $('#custosBarra').setAttribute('aria-valuenow', String(pct));
        $('#infoCustos').innerHTML = cu.deTodos ? `<b>${pct}%</b> · ${cu.comTodos} de ${cu.deTodos} SKUs com custo` : 'Primeiro o Copiloto precisa ler a sua conta.';
        $('#infoPrincipais').textContent = cu.de ? `Principais: ${cu.com} de ${cu.de} que mais vendem` : '';
        $('#custosRes').textContent = cu.deTodos ? `${cu.comTodos} de ${cu.deTodos} com custo · planilha ou ERP` : 'Lido na próxima sincronização';   // resumo do bloco recolhido
        if (!tinyRodando) $('#abrirTiny').textContent = tinyToken ? 'Tiny · Puxar custos agora' : 'Tiny · Conectar em 1 minuto';
        const ult = status.ultimaOk ? new Date(status.ultimaOk) : null;
        $('#infoSync').textContent = 'Automática a cada 3 horas' + (ult ? ` · última em ${ult.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${ult.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : '') + '.';
        atualizaFundo().catch(() => {});
        // v3.1 (ESPEC §6 Ajustes, "Sua conta"): iniciais, APELIDO (o mesmo do topo, P.contaTopo; nunca o nome do ML), ID inteiro com copiar e o campo do apelido.
        $('#listaContasAj').innerHTML = contasLista.length ? contasLista.map(c => {
            const p = P.contaTopo(c.sellerId, cfg), id = esc(c.sellerId);
            return `<div class="aj-uma"><div class="aj-conta"><span class="av${p.temNome ? '' : ' sem'}" aria-hidden="true">${esc(p.iniciais || '✎')}</span><div class="ct"><b${p.temNome ? '' : ' class="pede"'}>${esc(p.temNome ? p.nome : DAR_NOME)}</b>`
                + `<span class="id">${esc(p.idTxt)}<button type="button" class="aj-copia" data-copiar-id="${id}" aria-label="Copiar o ID ${id}" title="Copiar o ID"><svg class="i" aria-hidden="true"><use href="#i-copiar"/></svg></button></span></div>${c.atual ? '<span class="contatag agora">aberta agora</span>' : ''}</div>`
                + `<div class="campo"><label for="ap-${id}">Apelido (só você vê)</label><input class="inp" id="ap-${id}" data-apelido="${id}" maxlength="40" placeholder="Ex.: Loja 1" value="${esc(p.nome)}"></div></div>`;
        }).join('')
            : '<p class="det">Sincronize para o Copiloto saber qual é a sua conta. Cada conta em que você entrar neste Chrome aparece aqui.</p>';
        $('#salvarApelidos').hidden = !contasLista.length;
        $('#salvarApelidos').textContent = contasLista.length > 1 ? 'Salvar apelidos' : 'Salvar apelido';
        $('#tituloContas').textContent = contasLista.length > 1 ? 'Suas contas' : 'Sua conta';
        // v2.8: módulos ligados/desligados (cfg.modulos[id] === false desliga). v3.1: interruptor por aba, na ordem das abas; Geral travada.
        if (!document.activeElement || !document.activeElement.closest('#listaModulos')) {
            const linha = (a, dentro, trava) => `<label class="aj-sw${trava ? ' trava' : ''}"><svg class="i" aria-hidden="true"><use href="#i-${esc(a)}"/></svg><span class="nm"><b>${esc(P.ROT_ABA[a])}</b><small>${esc(trava ? 'sempre ligada' : P.MODULO_DESC[a] || '')}</small></span>${dentro}</label>`;
            $('#listaModulos').innerHTML = linha('geral', '<input type="checkbox" class="tg" checked disabled aria-label="Geral: sempre ligada">', true)
                + P.ABAS.filter(a => P.MODULOS.indexOf(a) >= 0).map(m => linha(m, `<input type="checkbox" class="tg" id="mod-${esc(m)}"${SHC.moduloLigado(cfg, m) ? ' checked' : ''}>`)).join('');
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

    // ── Aba Geral, "Cada aba em 1 linha" (v3.1, ESPEC §2 ul.mods): bolinha, ícone, nome e o número principal; tocar na linha abre a aba ──
    // → {id, nome, cor, resumo, rs, html} para P.ordemGeral ('' = módulo desligado). resumo já vem escapado. rs = R$ em jogo (ordena dentro da mesma cor).
    function blocoGeral(id, nome, cor, resumo, rs) {
        if (P.MODULOS.indexOf(id) >= 0 && !SHC.moduloLigado(cfg, id)) return '';   // v2.8: módulo desligado em Ajustes some também da Geral
        // Sem dado ainda e a sincronização lendo: diz "lendo…" (etapa da aba em leitura) ou "na fila" em vez de "ainda não lido".
        const es = status.etapas || {}, pend = cor === 'neutra' && SHC.statusSync(status, Date.now()).estado === 'sincronizando'
            ? (ETAPAS_ABA[id] || []).filter(x => !es[x] || (es[x].estado !== 'ok' && es[x].estado !== 'pulado')) : [];
        if (pend.length) resumo = pend.some(x => es[x] && es[x].estado === 'lendo') ? 'lendo…' : 'na fila';
        return { id, nome, cor, resumo, rs: rs || 0, html: `<li class="mod" data-ir-aba="${id}" tabindex="0" role="link" id="g-${id}"><div class="gb-l"><i class="dot ${cor}"></i><b>${esc(nome)}</b><span class="gb-v">${resumo}</span>`
            + `<svg class="i" aria-hidden="true"><use href="#i-${id}"/></svg><span class="seta" aria-hidden="true">›</span></div></li>` };
    }
    const somaRs = (xs, f) => xs.reduce((t, x) => t + (Number(f(x)) || 0), 0);
    // ── Faturamento por família (topo da Geral). Recolhido: a barra do mês dividida por família e até 5 linhas. Aberto: 13 meses em colunas,
    // o mês mais forte, "Prepare o Full", a lista de SKUs da família (maior queda primeiro, "Por que caiu?") e a curva ABC. ──
    const famSw = cor => `<i class="sw" style="background:${esc(cor)}" aria-hidden="true"></i>`;
    const famSetaHtml = x => { const s = P.famSeta(x); return s.txt ? ` <span class="fseta ${s.cls}">${esc(s.txt)}</span>` : ''; };
    const famSetaAnoHtml = x => { const s = P.famSetaAno(x); return s.txt ? ` <span class="fseta ${s.cls}" title="Contra o mesmo mês do ano passado">${esc(s.txt)}</span>` : ''; };
    function familiasDoMes() {
        const hoje = SHC.hoje(), atual = hoje.slice(0, 7), mes = famMes === 'anterior' ? P.mesMenos(atual, 1) : atual;
        const cs = Object.assign({}, custosMl, cadSku);
        let fams = SHC.familias(vbA, catA, anuncios, cs, mes, { cfg, hoje, cores: coresA });
        // v3.1 (print da dona 26/09): o mês atual ainda não lido não deixa o cartão vazio — mostra o último mês lido, dizendo isso.
        if (!fams.lido && famMes === 'atual') {
            const alt = SHC.familias(vbA, catA, anuncios, cs, P.mesMenos(atual, 1), { cfg, hoje, cores: fams.cores });
            if (alt.lido && alt.length) { alt.naoLido = mes; alt.motivoNaoLido = fams.motivo; fams = alt; }
        }
        if (fams.coresMudou) { coresA = fams.cores; SHC.gravarChave('cores:' + (conta || 'atual'), coresA).catch(() => {}); }   // família nova ganhou cor: fica para sempre
        return fams;
    }
    // v3.1: por que o mês não foi lido, em 1 frase curta (o motivo exato do fundo: "o ML demorou demais…"; sem ele, "sincronize para ler").
    function motivoMesFam(mes) {
        const d = SHC.textosMeses(((status.etapas || {}).vendasAnuncio || {}).meses || {}).find(t => t.indexOf(P.nomeMes(mes)) === 0);
        return d ? d.slice(d.indexOf(':') + 2) : '';
    }
    // v3.1 (pedido da dona 27/09): "Por que caiu?" com o gargalo visual — 3 comparações (mês anterior, média de 3 meses, ano passado) e cada
    // causa com a cor: vermelho = é essa, amarelo = contribui, verde = não é, cinza = sem dado (SHC.gargaloQueda).
    const NIVEL_G = { e: ['ruim', 'é essa'], contribui: ['atencao', 'contribui'], nao: ['ok', 'não é'], semdado: ['', 'sem dado'] };
    // conta = fams: sem o mesmo mês do ano passado, a sazonalidade compara a queda do SKU com a da família e a da conta (pedido da dona 29/09).
    const gargaloDe = (s, fams, f) => SHC.gargaloQueda(s, { mes: fams.mes, dias: fams.diasCobertos, familia: f, conta: fams, itens, visitas: visitas && visitas.porItem, comp: compHist, fretes, full, ads: adsSnap, cfg, hoje: SHC.hoje() });
    // v3.1 (print da dona 29/09: "mostra a variação, por que caiu"): o painel do "Por que caiu?" é VISUAL — barras em R$ deste mês × mês anterior ×
    // média de 3 meses × mesmo mês do ano passado (com a % de cada comparação) e cada causa com a cor e o número que a prova.
    function gargaloHtml(g, s, fams) {
        const mes = fams.mes, cmp = id => g.comparacoes.find(c => c.id === id) || {};
        const linhas = [{ rot: P.mesLongo(mes) + (fams.mesParcial ? ' até dia ' + fams.dias : ''), v: s.bruto, eu: true },
            { rot: P.mesLongo(P.mesMenos(mes, 1)), v: s.brutoAnt, c: cmp('ant') }, { rot: 'média 3 meses', v: s.media3, c: cmp('media3') }]
            // o mesmo mês do ano passado só aparece se foi lido (print da dona 29/09: "setembro/25 —" sem dado confundia)
            .concat(typeof s.brutoAno === 'number' ? [{ rot: P.mesLongoAno(P.mesMenos(mes, 12)), v: s.brutoAno, c: cmp('ano') }] : []);
        const max = Math.max(1, ...linhas.map(l => (typeof l.v === 'number' ? l.v : 0)));
        const bars = linhas.map(l => {
            const tem = typeof l.v === 'number', p = l.c && typeof l.c.pct === 'number' ? l.c.pct : null;
            return `<span class="gq-r">${esc(l.rot)}</span><span class="gq-t">${tem ? `<i class="${l.eu ? 'eu ' + (s.variacaoPct < 0 ? 'down' : 'up') : ''}" style="width:${Math.max(1, Math.round(l.v / max * 100))}%"></i>` : ''}</span>`
                + `<b class="gq-v">${tem ? esc(P.rs0(l.v)) : '—'}</b><span class="gq-p ${p === null ? '' : p < 0 ? 'down' : 'up'}"${l.c && l.c.motivo ? ` title="${esc(l.c.motivo)}"` : ''}>${l.eu ? '' : p === null ? '' : (p > 0 ? '▲ ' : p < 0 ? '▼ ' : '= ') + esc(P.pctFam(p))}</span>`;
        }).join('');
        const causas = P.GARGALO_ORDEM.map(x => g.causas.find(c => c.id === x)).filter(Boolean).map(c => `<li class="gq-${c.nivel}"><i class="dot ${NIVEL_G[c.nivel][0]}" aria-hidden="true"></i><b>${esc(c.nome)}</b><span class="gq-n">${NIVEL_G[c.nivel][1]}</span><small>${esc(c.texto)}</small></li>`).join('');
        return `<div class="gq"><div class="gq-bars" role="img" aria-label="${esc('Vendas em R$: ' + linhas.map(l => l.rot + ' ' + (typeof l.v === 'number' ? P.rs0(l.v) : 'sem dado')).join(', '))}">${bars}</div><ul class="gq-l">${causas}</ul></div>`;
    }
    const REC_COR = { vermelho: 'pr', azul: 'az', amarelo: 'at', verde: 'ok', cinza: 'ne' };
    // v3.1: a ação do SKU é um botão colorido que abre a página certa do ML (só abre: quem mexe é a dona). Manter = só a etiqueta.
    const ACAO_URL = { repor: id => (/^MLB\d{6,14}$/.test(id) ? P.medLink(id) : URL_ANUNCIOS), full: () => URL_FULL.envios, baixar: () => URL_PROMOS, liquidar: () => URL_PROMOS };
    const acaoSku = (r, id) => (r.acao === 'sem_dado' ? '' : ACAO_URL[r.acao]
        ? `<a class="rec ${REC_COR[r.cor] || 'ne'} fk-bt" href="${esc(ACAO_URL[r.acao](id))}" target="_blank" rel="noopener" title="${esc(r.motivo)}">${esc(r.rotulo)} ›</a>`
        : `<span class="rec ${REC_COR[r.cor] || 'ne'}" title="${esc(r.motivo)}">${esc(r.rotulo)}</span>`);
    const capP = t => String(t || '').charAt(0).toUpperCase() + String(t || '').slice(1);
    function metaHtml() {
        const m = P.metaTxt(SHC.metaMes(vb, SHC.hoje(), cfg.meta_mes));
        if (!m.texto) return '';
        return `<div class="meta-l"><p class="det" style="margin:0;color:#344054">${esc(m.texto)}${m.semMeta ? ' <button class="lnk" data-ir-aba="ajustes">Defina uma meta em Ajustes</button>' : ''}</p>`
            + (m.pct !== null ? `<div class="prog" role="progressbar" aria-label="Quanto já vendeu da meta do mês" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${m.pct}"><i style="width:${m.pct}%;background:${m.cor === 'ok' ? 'var(--verde)' : '#D97706'}"></i></div>`
                + `<p class="det" style="margin:-4px 0 0">${m.pct}% da meta já vendido.</p>` : '') + '</div>';
    }
    // v3.1 (print da dona 29/09: "muito texto e pouco visual"): cada SKU é um cartão curto — título + SKU, mini gráfico dos 6 últimos meses,
    // a variação GRANDE ("ago R$ 4.680 → set R$ 0 ▼ 100%"), a linha do gargalo sempre à vista (etiquetas coloridas + a causa em 1 frase)
    // e a ação como botão colorido que abre a página certa do ML. g = SHC.gargaloQueda (só dos SKUs que caíram) | null.
    function linhaSkuFam(s, abc, fams, g) {
        const k = P.chaveSkuFam(s), tit = s.titulo || s.sku || (s.itemIds || [])[0] || '', id = (s.itemIds || [])[0] || '', aberta = !!g && famCausas.has(k);
        const vr = P.famVarTxt(s, fams.mes);
        const varHtml = `<p class="fk-var ${vr.cls}"${s.fator > 0 && s.fator < 0.999 ? ' title="% pelo ritmo por dia (o mês ainda corre)"' : ''}>${vr.de ? `<span>${esc(vr.de)}</span> → ` : ''}<span>${esc(vr.para)}</span>${vr.pct ? ` <b>${esc(vr.pct)}</b>` : ''}</p>`;
        const lucro = famModo === 'lucro' ? `<small>${s.lucro === null ? 'Lucro: sem custo deste SKU (informe no Catálogo)' : 'Lucro estimado: ' + SHC.moeda(s.lucro)}</small>` : '';
        const rec = SHC.recomendaSku(s, SHC.estoqueSku(s, itens, full), fams.diasCobertos);
        const pr = g && g.principal ? g.causas.find(c => c.id === g.principal) : null;
        const gar = g ? `<div class="fk-g" role="list" aria-label="Onde está o gargalo">${P.GARGALO_ORDEM.map(x => g.causas.find(c => c.id === x)).filter(Boolean)
            .map(c => `<span class="gt ${c.nivel}${c === pr ? ' pri' : ''}" role="listitem" title="${esc(c.nome + ': ' + NIVEL_G[c.nivel][1] + ' — ' + c.texto)}">${esc(P.GARGALO_NOME[c.id])}</span>`).join('')}</div>`
            + `<p class="fk-m ${pr ? pr.nivel : 'sem'}">${esc(g.resumo)}</p>` : '';
        return `<div class="fam-sku${g ? ' fk-caiu' : ''}"><div class="fk-top"><div class="fk-t"><b>${abc ? `<span class="abc ${abc}" title="Curva ABC: ${abc}">${abc}</span>` : ''}${esc(tit)}</b>`
            + `${s.sku ? `<small>SKU ${esc(s.sku)}</small>` : ''}</div>${P.miniSku(s, fams.mes)}</div>${varHtml}${gar}${lucro}`
            + `<div class="acoes fk-ac">${acaoSku(rec, id)}${g ? `<button class="lnk" data-fam-causa="${esc(k)}" aria-expanded="${aberta}">${aberta ? 'Esconder' : 'Por que caiu?'}</button>` : ''}`
            + (/^MLB\d{6,14}$/.test(id) ? `<button class="lnk" data-abrir-anuncio="${esc(id)}">Ver anúncio</button>` : '') + `</div>${aberta ? gargaloHtml(g, s, fams) : ''}</div>`;
    }
    let famFiltro = '';   // v3.1: filtro da lista de SKUs por causa do gargalo ('' = todos; 'sem' = sem causa clara)
    function cardFamilia() {
        const fams = familiasDoMes(), k = 'geral:familia', ab = aberto(k), nome = P.mesLongo(fams.mes), ant = P.mesLongo(P.mesMenos(fams.mes, 1));
        const seg = `<span class="seg" role="group" aria-label="Mês"><button data-fam-mes="atual" aria-pressed="${famMes === 'atual'}">Este mês</button><button data-fam-mes="anterior" aria-pressed="${famMes === 'anterior'}">Mês passado</button></span>`;
        const cab = `<div class="gb-l"><b>Faturamento por família · ${esc(nome)}</b><span class="gb-v"></span>${seg}</div>`;
        const semCat = () => (fams.semCategoria > 0 ? (permWww
            ? `<p class="det">${esc(SHC.qtd(fams.semCategoria, 'anúncio com venda ainda sem categoria', 'anúncios com venda ainda sem categoria'))}: o Copiloto lê aos poucos, começando pelos que mais vendem.</p>`
            : `<p class="det">Para separar por família, o Copiloto precisa ler a categoria de cada anúncio (a mesma leitura das fotos e medidas).</p><button class="bt leve mini" data-perm-fotos>${esc(PERM_TXT)}</button>`) : '');
        if (!fams.lido || !fams.length) {
            const diag = fams.lido ? '' : motivoMesFam(fams.mes);
            return `<div class="card gb" id="g-familia">${cab}<p class="det">${esc(fams.motivo || 'Sem vendas neste mês.')}${diag ? ' ' + esc(capP(diag)) + '.' : ''}</p>${metaHtml()}</div>`;
        }
        if (!fams.some(f => f.familia === famSel)) famSel = fams[0].familia;
        // v3.1: mês atual ainda não lido → mostra o último lido e diz por quê (sem cartão vazio)
        const naoLidoTxt = fams.naoLido ? `<p class="recnota neutra" style="margin:6px 0 0">${esc(String(fams.motivoNaoLido || '').replace(/ — sincronize para ler\.$/, ''))}`
            + `${motivoMesFam(fams.naoLido) ? ' (' + esc(motivoMesFam(fams.naoLido)) + ')' : ''}. Mostrando ${esc(nome)}.</p>` : '';
        // v3.1: "Precisa de você" — SKUs para repor, enviar ao Full, baixar preço, parados e a época forte de compra (1 linha)
        const acoes = SHC.familiasAcoes(fams, itens, full, { hoje: SHC.hoje() });
        const aviso = acoes.texto ? `<p class="fam-aviso"><b>Precisa de você:</b> ${esc(acoes.texto)}</p>` : '';
        const comVenda = fams.filter(f => f.bruto > 0), barra = `<div class="fam-barra" aria-hidden="true">${comVenda.map(f => `<i style="width:${f.pct}%;background:${esc(f.cor)}" title="${esc(f.familia)}: ${SHC.moeda(f.bruto)} (${P.pctFam(f.pct)})"></i>`).join('')}</div>`;
        const ritmo = [fams.mesParcial ? (fams.mesAtual ? `${nome} lido até o dia ${fams.dias}` : `${nome} lido só até o dia ${fams.dias}`) : '', fams.antParcial ? `${ant} lido só até o dia ${fams.diasAnt}` : ''].filter(Boolean).join(' e ');
        const comp = fams.motivoComp || (fams.totalAnt === null ? `Sem ${ant} lido: as setas aparecem quando ele for lido.`
            : 'Setas: contra ' + ant + (fams.comparacao === 'ritmo' ? `, pelo ritmo por dia (${ritmo})` : '') + '.');
        const topo = `<p class="det" style="margin:6px 0 0;color:#344054">Total: <b>${SHC.moeda(fams.total)}</b>${famSetaHtml({ bruto: fams.total, brutoAnt: fams.totalAnt, variacaoPct: fams.totalAnt > 0 ? (fams.total - fams.totalAnt * fams.fator) / (fams.totalAnt * fams.fator) * 100 : null })}</p>${barra}`;
        if (!ab) {
            // v3.1: cada família com a barra do tamanho dela, ▲▼ contra o mês anterior e contra o ano passado, e o mini-histórico de 13 meses
            const maxB = Math.max(1, ...comVenda.map(f => f.bruto));
            // v3.1 (pedido da dona 29/09): tocar numa família já abre o detalhe com os SKUs DELA (antes só o "Ver 13 meses e os SKUs" abria).
            const cinco = comVenda.slice(0, 5).map(f => `<div class="fam-v" role="button" tabindex="0" data-fam-sel="${esc(f.familia)}" data-fam-abrir="${k}" title="Ver os SKUs de ${esc(f.familia)}"><div class="fam-l">${famSw(f.cor)}<span class="nm">${esc(f.familia)}</span><span class="vl">${SHC.moeda(f.bruto)}</span><span class="pc">${P.pctFam(f.pct)}</span></div>`
                + `<div class="fam-vb"><i style="width:${Math.max(2, Math.round(f.bruto / maxB * 100))}%;background:${esc(f.cor)}"></i></div><div class="fam-vs">${famSetaHtml(f).replace('">', `" title="Contra ${esc(ant)}">mês `)}${famSetaAnoHtml(f)}${P.sparkFam(f)}</div></div>`).join('');
            const resto = comVenda.length > 5 ? `<p class="det" style="margin:2px 0 0">E mais ${esc(SHC.qtd(comVenda.length - 5, 'família', 'famílias'))}.</p>` : '';
            return `<div class="card gb" id="g-familia">${cab}${naoLidoTxt}${aviso}${topo}${cinco}${resto}<p class="det" style="margin:4px 0 0">${esc(comp)}</p>${semCat()}${metaHtml()}`
                + `<button class="lnk ver" data-ver="${k}" aria-expanded="false" style="margin-top:6px">Ver 13 meses e os SKUs</button></div>`;
        }
        // Aberto
        const f = fams.find(x => x.familia === famSel), lucroModo = famModo === 'lucro';
        const modo = `<span class="seg" role="group" aria-label="Mostrar"><button data-fam-modo="bruto" aria-pressed="${!lucroModo}">Faturamento</button><button data-fam-modo="lucro" aria-pressed="${lucroModo}">Lucro</button></span>`;
        const valorFam = x => (!lucroModo ? SHC.moeda(x.bruto) : x.lucro === null ? 'sem custo' : SHC.moeda(x.lucro) + (x.lucroParcial ? '*' : ''));
        const lista = fams.map(x => `<button class="fam-l" data-fam-sel="${esc(x.familia)}" aria-pressed="${x.familia === famSel}">${famSw(x.cor)}<span class="nm">${esc(x.familia)}</span>`
            + (x.bruto > 0 ? `<span class="vl">${valorFam(x)}</span><span class="pc">${P.pctFam(x.pct)}</span>` : `<span class="pc">sem vendas em ${esc(nome)}</span>`) + `${famSetaHtml(x)}${P.sparkFam(x)}</button>`).join('');
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
        // v3.1: época forte de compra da família escolhida (quando o "Prepare o Full" não disse nada dela): aviso ou o que falta para avisar
        if (famMes === 'atual' && prep.indexOf('Prepare o Full · ' + esc(f.familia) + ':') < 0) {
            const sc = SHC.sazonalCompra(f, { hoje: SHC.hoje() });
            prep += sc.aplica ? `<div class="recnota aviso"><b>Época forte · ${esc(f.familia)}:</b> ${esc(sc.texto)}</div>`
                : f.familia !== SHC.FAMILIA_OUTRAS && f.familia !== SHC.FAMILIA_SEM && /histórico/.test(sc.motivo) ? `<p class="det" style="margin:4px 0 0">${esc(sc.motivo)}</p>` : '';
        }
        // v3.1: anúncios ativos da família com estoque e nenhuma venda nos 3 últimos meses → liquidar ou descartar (botão que abre as promoções do ML)
        const parados = (f.parados || []).slice(0, 5).map(p => `<div class="fam-sku"><div class="fk-t"><b>${esc(p.titulo || p.itemId)}</b><small>${p.sku ? 'SKU ' + esc(p.sku) + ' · ' : ''}${esc(P.milhar(p.estoque))} un. paradas</small></div>`
            + `<div class="acoes fk-ac">${acaoSku(SHC.recomendaParado(p), p.itemId)}<button class="lnk" data-abrir-anuncio="${esc(p.itemId)}">Ver anúncio</button></div></div>`).join('');
        const paradosHtml = parados ? `<p style="margin:10px 0 2px;font-size:12.5px"><b>Parados há 3 meses</b> <span class="det">· ${esc(SHC.qtd((f.parados || []).length, 'anúncio', 'anúncios'))} com estoque</span></p>${parados}` : '';
        // Curva ABC da conta (recolhida): uma barra A/B/C com as contagens; "Ver os A" abre a lista.
        const abc = P.abcConta(fams), kA = 'geral:famabc', abA = aberto(kA), oQue = abc.criterio === 'lucro' ? 'do lucro' : 'do faturamento', nAbc = P.abcContagem(abc);
        const abcHtml = abc.nA ? `<div class="fam-abc"><p style="margin:0;font-size:12px"><b>Curva ABC</b> <span class="det">${oQue} de ${esc(nome)}</span> ${btVer(kA, 'Ver os A', 'Esconder')}</p>`
            + `<div class="abc-bar" role="img" aria-label="${esc(['A', 'B', 'C'].map(x => x + ': ' + SHC.qtd(nAbc[x], 'SKU', 'SKUs')).join(', ') + (nAbc.sem ? ', sem custo: ' + SHC.qtd(nAbc.sem, 'SKU', 'SKUs') : ''))}">`
            + `${['A', 'B', 'C'].filter(x => nAbc[x]).map(x => `<i class="abc ${x}" style="flex:${nAbc[x]}">${x} ${nAbc[x]}</i>`).join('')}${nAbc.sem ? `<i class="abc sem" style="flex:${nAbc.sem}" title="Sem custo: fora da curva do lucro (informe no Catálogo)">sem custo ${nAbc.sem}</i>` : ''}</div>`
            + `<p class="det" style="margin:0">A = 80% ${oQue} · B até 95% · C o resto${abc.criterio === 'bruto' ? ' · informe os custos no Catálogo para ver pelo lucro' : ''}</p>`
            + (abA ? abc.lista.filter(s => s.abc === 'A').map(s => `<div class="it"><span class="abc A">A</span>${esc(s.titulo || s.sku || s.itemIds[0])}<small>${s.sku ? 'SKU ' + esc(s.sku) + ' · ' : ''}${SHC.moeda(s[abc.criterio])} · acumulado ${P.pctFam(s.acumPct)}</small></div>`).join('') : '') + '</div>' : '';
        // v3.1 (print da dona 29/09): o gargalo de cada SKU que caiu (sempre à vista), os filtros por causa e a barra da família (mês × mês anterior).
        // ponytail: calcula o gargalo de TODOS os SKUs que caíram da família a cada desenho (os filtros precisam); com milhares de SKUs, guardar por geração.
        const gar = new Map();
        f.skus.forEach(s => { if (typeof s['variacaoR$'] === 'number' && s['variacaoR$'] < 0) gar.set(P.chaveSkuFam(s), gargaloDe(s, fams, f)); });
        const filtros = P.famFiltros(f.skus, gar);
        if (famFiltro && !filtros.some(x => x.id === famFiltro)) famFiltro = '';
        const lstF = P.famFiltra(f.skus, gar, famFiltro), skus = lstF.slice(0, famLim), resto = lstF.length - skus.length;
        const chips = filtros.length ? `<div class="fk-fil" role="group" aria-label="Filtrar por causa"><button data-fam-filtro="" aria-pressed="${!famFiltro}">Todos <b>${f.skus.length}</b></button>`
            + filtros.map(x => `<button class="${x.nivel}" data-fam-filtro="${x.id}" aria-pressed="${famFiltro === x.id}">${esc(x.nome)} <b>${x.n}</b></button>`).join('') + '</div>'
            + '<p class="fk-leg" aria-hidden="true"><span><i class="e"></i>é essa</span><span><i class="contribui"></i>contribui</span><span><i class="nao"></i>não é</span><span><i class="semdado"></i>sem dado</span></p>' : '';
        const famBar = P.famBarraMes(f, fams.mes, fams);
        const skuHtml = `<p style="margin:10px 0 2px;font-size:12.5px"><b>SKUs de ${esc(f.familia)}</b> <span class="det">· ${f.skus.some(s => s['variacaoR$'] !== null) ? 'maior queda em R$ primeiro' : 'maior faturamento primeiro'}</span></p>${famBar}${chips}`
            + (skus.map(s => linhaSkuFam(s, abc.porChave[P.chaveSkuFam(s)], fams, gar.get(P.chaveSkuFam(s)) || null)).join('') || '<p class="det">Nenhum SKU com venda.</p>')
            + (resto > 0 ? `<button class="mais" data-fam-mais>Mostrar mais ${Math.min(resto, 10)} de ${resto}</button>` : '') + paradosHtml;
        return `<div class="card gb" id="g-familia">${cab}${naoLidoTxt}${aviso}${topo}<div class="acoes" style="justify-content:flex-start;margin:0 0 4px">${modo}</div>${lista}${nota}<p class="det" style="margin:4px 0 0">${esc(comp)}</p>${semCat()}${metaHtml()}`
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
        const top = r.topItens.filter(t => t && t.itemId).map(t => `<li>${esc(tituloDe(t.itemId))}<small>${t.problemas !== null ? esc(SHC.qtd(t.problemas, 'problema', 'problemas')) : ''}</small></li>`).join('');
        // v3.1 (imagem tela-saude): a explicação sai do cartão e vai para o "?" (ESPEC §5: uma vez por bloco).
        const ajuda = `<button class="ajuda" type="button" title="${esc(per + 'cada item contra o limite do Mercado Livre. Cor: verde até 69% do limite · âmbar de 70% a 99% · vermelho no limite ou acima.')}" aria-label="Como ler a reputação">?</button>`;
        return `<div class="card" id="rep-saude"><div class="ch"><h3>Sua reputação</h3>${sel}${r.lider ? `<span class="lider">★ ${esc(r.lider)}</span>` : ''}${ajuda}</div>${termo}`
            + `<div class="vrs">${r.barras.map(vr).join('')}</div>`
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
        const ci = P.certInfo(cert, Date.now());
        const b = [];   // v2.9: perguntas e reputação foram para a aba Saúde (entram na linha da Saúde)
        // Promoções
        if (!snap) b.push(blocoGeral('promo', 'Promoções', 'neutra', 'ainda não lidas'));
        else if (!snap.familias.length) b.push(blocoGeral('promo', 'Promoções', 'ok', 'nenhuma promoção aberta agora'));
        else {
            const t = snap.familias.map(f => resumoFamilia(f)), n = c => t.filter(r => r.classe === c).length;
            b.push(blocoGeral('promo', 'Promoções', n('prejuizo') ? 'ruim' : (n('sem_custo') || n('apertado') ? 'atencao' : 'ok'),
                esc(`${t.length} com proposta · ${n('lucrativo')} dão lucro · ${n('prejuizo')} prejuízo` + ((cfg.robopromo || {}).ligado ? ` · robô sugere ${sugestoesRobo().length}` : ''))));
        }
        // Frete
        const fc = P.freteConta(freteHist);
        if (!fc && P.temFreteCob(freteHist)) b.push(blocoGeral('frete', 'Frete', 'neutra', esc(`últimos 30 dias: ${SHC.moeda(freteHist.conta.ult30.total)} · ${SHC.qtd(freteHist.conta.ult30.pedidos, 'pedido', 'pedidos')}`)));
        else if (!fc) b.push(blocoGeral('frete', 'Frete', 'neutra', 'aparece quando o Faturamento for lido'));
        else b.push(blocoGeral('frete', 'Frete', fc.cor, esc(fc.resumo), somaRs((fc.conc.pagoAMais || []).filter(p => !p.talvezUnidades), p => p.diferenca)));   // v3.1: o * (pode ter 2+ unidades) fica fora
        // Catálogo
        if (!grupos.length) b.push(blocoGeral('catalogo', 'Catálogo', 'neutra', 'lista de anúncios ainda não lida'));
        else {
            const cu = SHC.guiaCustos(anuncios && anuncios.itens, Object.assign({}, custosMl, cadSku), vm), pre = resumos.filter(r => r.r.classe === 'prejuizo');
            b.push(blocoGeral('catalogo', 'Catálogo', pre.length ? 'ruim' : (cu.comTodos < cu.deTodos ? 'atencao' : 'ok'), esc(`custo em ${cu.comTodos} de ${cu.deTodos} SKUs · ${pre.length} com prejuízo`)));
        }
        // Ads
        if (!adsSnap) b.push(blocoGeral('ads', 'Ads', 'neutra', 'aparece depois da leitura do Mercado Ads'));
        else if (adsSnap.temAds === false) b.push(blocoGeral('ads', 'Ads', 'neutra', 'esta conta não usa o Mercado Ads'));
        else {
            const m = P.adsConta(adsSnap), ac = P.adsEquilibrio(adsSnap, itens, sobraDe).filter(x => x.acima);
            b.push(blocoGeral('ads', 'Ads', ac.length ? 'ruim' : 'ok', esc(`investimento ${SHC.moeda(m.gasto)} · ACOS ${pctOu(m.acos)} · ${ac.length} acima do equilíbrio`), somaRs(ac, x => x.a.gasto)));
        }
        // Full
        if (!full) b.push(blocoGeral('full', 'Full', 'neutra', status.erroFull ? 'não consegui ler agora' : 'ainda não lido'));
        else if (!full.temFull) b.push(blocoGeral('full', 'Full', 'neutra', txtML(full.vazio) ? 'esta conta ainda não usa o Full' : 'não reconheci a tela do Full'));
        else {
            const nc = P.contaClasses(planoAtual().linhas), inc = incRemessas().filter(SHC.remessaPendente).length;
            b.push(blocoGeral('full', 'Full', inc || nc.critico || nc.sem_estoque ? 'ruim' : (nc.atencao ? 'atencao' : 'ok'),
                esc(`${inc ? SHC.qtd(inc, 'remessa com diferença', 'remessas com diferença') + ' · ' : ''}${nc.critico} crítico · ${nc.sem_estoque} sem estoque · ${nc.atencao} atenção`)));
        }
        // Saúde (v2.9: com a reputação e as perguntas, que saíram da Geral)
        {
            const f = P.saudeFiscal(fiscal, itens), rl = P.radarLista(visitas, itens.filter(SHC.anuncioAtivo), cfg, SHC.hoje()), rm = resumoMed();
            const r = P.reputacaoLinha(reputacao), q = P.perguntasLinha(perguntas, resumoML), div = rm.div.filter(P.medPesa).length;
            const rb = r ? r.barras.filter(x => x.cls === 'at' || x.cls === 'pr').sort((x, y) => (y.usoPct || 0) - (x.usoPct || 0))[0] : null;
            const repTxt = !r ? 'reputação ainda não lida' : (r.faixaNome ? 'reputação ' + r.faixaNome.toLowerCase() : r.nivel) + (rb && rb.usoPct !== null ? ' · ' + rb.rotulo.toLowerCase() + ' em ' + rb.usoPct + '% do limite' : '');
            const ruim = f.n > 0 || (r && r.cor === 'ruim') || (q && q.cor === 'ruim'), atencao = rl.caindo.length || div || rm.mud.length || (r && r.cor === 'atencao') || (q && q.cor === 'atencao');
            b.push(blocoGeral('saude', 'Saúde', ruim ? 'ruim' : (atencao ? 'atencao' : (f.n === null && !r ? 'neutra' : 'ok')),
                esc(repTxt + (q && q.pendentes ? ' · ' + SHC.qtd(q.pendentes, 'pergunta sem resposta', 'perguntas sem resposta') : '')
                    + ' · ' + (f.n === null ? 'dados fiscais ainda não lidos' : (f.n ? SHC.qtd(f.n, 'sem dados fiscais', 'sem dados fiscais') : 'dados fiscais em dia')))));
        }
        // Conciliação
        const x = concMes();
        {
            const cf = conferir, cn = SHC.custosNovos(fat).itens;   // v3.1: custo novo na fatura
            const liq = x.casc.liquido, res = (liq === null ? 'líquido de ' + x.nome + ' ainda não lido por inteiro' : 'líquido de ' + x.nome + ' ' + SHC.moeda(liq))
                + (cf ? ' · ' + (cf.qtd ? SHC.qtd(cf.qtd, 'cobrança a conferir', 'cobranças a conferir') : 'nenhuma cobrança a conferir') : '')
                + (cn.length ? ' · ' + SHC.qtd(cn.length, 'custo novo', 'custos novos') : '');
            b.push(blocoGeral('conciliacao', 'Conciliação', (cf && cf.qtd) || (ci && ci.vermelho) ? 'ruim' : cn.length ? 'atencao' : (liq === null ? 'neutra' : 'ok'), esc(res), cf && cf.qtd ? cf.valor : 0));
        }
        // Canal
        {
            const px = P.proximasCanal(canalPlano && canalPlano.plano, Date.now());
            b.push(blocoGeral('canal', 'Canal', px.length ? 'ok' : 'neutra', px.length ? esc('próxima: ' + P.quandoCanal(px[0].dia, px[0].hora)) : 'nenhuma transmissão na agenda'));
        }
        // Afiliados
        {
            const af = P.afilCartao(afil, itens, sobraDe), come = af.comeLucro ? af.comeLucro.length : 0;
            b.push(blocoGeral('afiliados', 'Afiliados', come ? 'atencao' : 'neutra', af.estado === 'sem_dado' ? 'sincronize para ver' : af.estado === 'nao_usa' ? 'esta conta não usa afiliados'
                : esc(`vendas em 30 dias ${af.vendas === null ? '—' : SHC.moeda(af.vendas)} · ROI ${xTxt(af.roi)}` + (come ? ` · comissão come o lucro em ${SHC.qtd(come, 'produto', 'produtos')}` : ''))));
        }
        // Pós-venda (v2.9: 1 linha; o detalhe fica na aba Pós-venda)
        {
            const pv = P.posVenda(posvenda), a = P.posAnalise(posvenda, itens);
            b.push(!pv ? blocoGeral('posvenda', 'Pós-venda', 'neutra', status.erroPosVenda ? 'não consegui ler agora' : 'aparece depois da próxima sincronização')
                : blocoGeral('posvenda', 'Pós-venda', pv.cor, esc(pv.resumo), a && a.total ? somaRs(a.motivos, m => m.valor) : 0));
        }
        // Conforme a demanda (pedido da dona): o que pede ação primeiro, depois atenção, em dia e por último o que ainda não foi lido.
        const ls = P.ordemGeral(b);
        $('#listaGeral').innerHTML = `<div class="card"><div class="ch"><h3>Cada aba em 1 linha</h3></div><ul class="mods">${ls.map(l => l.html).join('')}</ul></div>`;
        $('#geralTopo').innerHTML = topoGeral(ls, x, ci);
    }
    // ── v3.1 topo da Geral (ESPEC §6 e a imagem tela-geral): manchete → KPIs (meta do mês, lucro do mês passado, alertas) → "Precisa de você hoje".
    // Os alertas são os do sino (shc:anomalias da conta aberta). Antes da 1ª conta deles, as linhas vermelhas/âmbar da Geral. Sem dado → "—", nunca 0.
    function topoGeral(ls, x, ci) {
        const vis = P.abasVisiveis(cfg), at = P.anomTopo(anom, conta, vis), lendo = SHC.statusSync(status, Date.now()).estado === 'sincronizando';
        const urg = i => !!i.vermelho || i.tipo === 'pagamento';   // a mesma regra da bolinha vermelha das abas (P.contadoresAbas)
        const lista = at ? (anom.itens || []).filter(i => i && vis.indexOf(i.aba) >= 0).map(i => {
            const t = String(i.texto || ''), k = t.indexOf(': '), corta = k > 0 && k < 60, rem = i.remessaId ? incRemessas().find(r => String(r.id) === String(i.remessaId)) : null;
            const pend = !!(rem && SHC.remessaPendente(rem));
            const tit = (corta ? t.slice(0, k) : t).replace(/\.$/, '');
            const abaI = i.tipo === 'familia' && vis.indexOf('conciliacao') >= 0 ? 'conciliacao' : i.aba;   // o Faturamento por família fica na Conciliação
            return { c: urg(i) ? 'pr' : 'at', aba: abaI, tit: esc(tit), curto: tit.length <= 48 ? esc(tit) : '', sub: esc(corta ? t.slice(k + 2) : ''), prazo: pend && rem.prazo ? P.dataBr(rem.prazo).slice(0, 5) : '',
                link: linkML(i.link) ? i.link : '', bt: pend ? 'Reclamar' : i.tipo === 'perguntas' ? 'Responder' : 'Abrir' };
        }).sort((p, q) => (p.c === 'pr' ? 0 : 1) - (q.c === 'pr' ? 0 : 1))
            : ls.filter(l => l.cor === 'ruim' || l.cor === 'atencao').map(l => {
                // Sem shc:anomalias: o título é a parte do resumo que diz o problema ("2 acima do equilíbrio", "faltam 4 · 2 com frete a mais"), nunca "investimento R$ …".
                const ps = l.resumo.split(' · '), ruim = ps.filter(p => P.RE_PROBLEMA.test(p)), tit = (ruim.length ? ruim : ps.slice(0, 1)).join(' · ');
                return { c: l.cor === 'ruim' ? 'pr' : 'at', aba: l.id, tit: tit.charAt(0).toUpperCase() + tit.slice(1), sub: ps.filter(p => (ruim.length ? ruim : ps.slice(0, 1)).indexOf(p) < 0).join(' · '), prazo: '', link: '', bt: 'Ver' };
            });
        const nUrg = at && at.urgentes !== null ? at.urgentes : lista.filter(a => a.c === 'pr').length, kM = 'geral:mais';
        const li = a => `<li class="acao ${a.c}"><div class="tx"><b title="${a.tit.replace(/<[^>]*>/g, '')}">${a.tit}</b><span><span class="tag">${esc(P.ROT_ABA[a.aba] || '')}</span>${a.prazo ? `<span class="prazo${a.c === 'pr' ? ' pr' : ''}">até ${esc(a.prazo)}</span>` : ''}${a.sub}</span></div>`
            + (a.link ? `<a class="bt pq ml" href="${esc(a.link)}" target="_blank" rel="noopener">${a.bt}</a>` : `<button class="bt leve pq" data-ir-aba="${a.aba}">${a.bt === 'Abrir' ? 'Ver' : a.bt}</button>`) + '</li>';
        // Manchete: o fato em negrito e por onde começar.
        // Nunca cortado com "…": o título do 1º alerta quando é curto; senão o nome da aba dele.
        const comeco = lista[0] ? ' Comece por: ' + ((at && lista[0].curto) || esc(P.ROT_ABA[lista[0].aba] || '')) + '.' : '';
        const man = at ? (at.total ? `<span class="pt ${nUrg ? 'pr' : 'at'}"></span><b class="${at.vermelho ? 'vm' : ''}">${esc(SHC.qtd(at.total, 'coisa pede sua atenção', 'coisas pedem sua atenção'))}</b>.${comeco}` : '<span class="pt ok"></span><b>Nada pede sua atenção agora.</b>')
            : lista.length ? `<span class="pt ${nUrg ? 'pr' : 'at'}"></span><b>${esc(SHC.qtd(lista.length, 'aba pede sua atenção', 'abas pedem sua atenção'))}</b>.${comeco}`
                : `<span class="pt"></span><b>Os alertas aparecem ${lendo ? 'quando esta leitura terminar' : 'depois da próxima sincronização'}.</b>`;
        // KPI 1: o mês no ritmo (projeção pelas vendas brutas lidas) com a barra da meta e a seta contra o mês passado
        const mm = SHC.metaMes(vb, SHC.hoje(), cfg.meta_mes), nomeM = capP(P.mesLongo(mm.mes)), brAnt = x.casc && typeof x.casc.bruto === 'number' ? x.casc.bruto : null;
        const pctM = mm.meta && mm.projecao !== null ? Math.round(mm.projecao / mm.meta * 100) : null;
        const kMeta = `<div class="kpi meta${pctM === null ? '' : mm.vaiBater ? ' ok' : ' at'}"><div class="lin"><span class="l">${esc(nomeM)} no ritmo</span><span class="s">${mm.meta ? 'meta ' + esc(P.rs0(mm.meta)) : '<button class="lnk" data-ir-aba="ajustes">sem meta · definir</button>'}</span></div>`
            + `<div class="v">${mm.projecao === null ? '—' : esc(P.rs0(mm.projecao)) + ' <small>previsão</small>'}${mm.projecao !== null && brAnt ? setaAds(mm.projecao, brAnt, 'sobe') : ''}</div>`
            + (pctM !== null ? `<div class="medidor" role="progressbar" aria-label="Previsão sobre a meta do mês" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, pctM)}"><i class="az" style="width:${Math.min(100, pctM)}%"></i></div>` : '')
            + `<div class="s">${mm.projecao === null ? esc(mm.motivo || 'sem dado') : [pctM !== null ? pctM + '% da meta' : '', mm.ateAgora !== null ? 'vendido até hoje ' + P.rs0(mm.ateAgora) : '', brAnt ? 'contra ' + P.mesLongo(x.mes) : ''].filter(Boolean).map(esc).join(' · ')}</div></div>`;
        // KPI 2: lucro do mês passado (sem o custo dos produtos: o líquido do ML), com a seta contra o mês anterior a ele
        const temL = typeof x.casc.lucro === 'number', v2 = temL ? x.casc.lucro : x.casc.liquido, a2 = x.b && x.b.casc ? (temL ? x.b.casc.lucro : x.b.casc.liquido) : null;
        const kLuc = `<div class="kpi kn${typeof v2 !== 'number' ? '' : v2 < 0 ? ' pr' : ' ok'}"><div class="l">${temL ? 'Lucro' : 'Líquido do ML'} de ${esc(P.mesLongo(x.mes))}</div>`
            + `<div class="v">${typeof v2 === 'number' ? esc(P.rs0(v2)) : '—'}</div><div class="s">${typeof v2 !== 'number' ? 'ainda não lido por inteiro' : (typeof a2 === 'number' ? setaAds(v2, a2, 'sobe') + ' contra ' + esc(P.mesLongo(P.mesMenos(x.mes, 1))) : temL ? 'depois de custos e imposto' : 'falta o custo dos produtos')}</div></div>`;
        // KPI 3: alertas (os do sino)
        const kAl = `<div class="kpi kn${nUrg ? ' pr' : lista.length ? ' at' : at ? ' ok' : ''}"><div class="l">${at ? 'Alertas' : 'Abas com alerta'}</div>`
            + `<div class="v">${at ? at.total : lista.length || '—'}${nUrg ? ` <small>${esc(SHC.qtd(nUrg, 'urgente', 'urgentes'))}</small>` : ''}</div>`
            + `<div class="s">${at ? (at.total ? esc(at.partes) : 'tudo em dia') : lista.length ? 'veja cada aba abaixo' : 'depois da sincronização'}</div></div>`;
        const precisa = !lista.length ? '' : `<div class="card" id="geralPrecisa"><div class="ch"><h3>Precisa de você hoje</h3>${nUrg ? `<span class="selo pr">${esc(SHC.qtd(nUrg, 'urgente', 'urgentes'))}</span>` : ''}</div>`
            + `<ul class="acoes">${lista.slice(0, aberto(kM) ? lista.length : 3).map(li).join('')}</ul>`
            + (lista.length > 3 ? `<p class="rs">${aberto(kM) ? '' : esc('Mais ' + SHC.qtd(lista.length - 3, 'alerta', 'alertas') + '.') + ' '}${btVer(kM)}</p>` : '') + '</div>';
        const zap = aberto('geral:semanal') ? '' : '<button class="lnk zap" data-ver="geral:semanal">Resumo p/ WhatsApp</button>';
        return `<p class="manchete">${zap}${man}</p>` + (ci && ci.vermelho ? certHtml(ci) : '') + `<div class="kpis gk">${kMeta}${kLuc}${kAl}</div>` + precisa;
    }
    // Certificado digital (cert:<conta>): alerta na Geral e na Conciliação, com o Faturador.
    const certHtml = ci => `<div class="recnota ${ci.vermelho ? 'ruim' : 'neutra'}" style="margin:0 0 8px"><b>Certificado digital:</b> ${esc(ci.texto)}`
        + `<div class="acoes" style="justify-content:flex-start;margin-top:6px"><a class="bt leve" href="${esc(SHC.FATURADOR_URL)}" target="_blank" rel="noopener">Abrir o Faturador</a></div>`
        + (ci.velho ? `<small class="det" style="display:block">Lido há mais de 7 dias. <a class="lnk" href="${esc(SHC.FATURADOR_URL)}" target="_blank" rel="noopener">Confira a validade no Faturador</a></small>` : '') + '</div>';

    // ── Aba Conciliação: o Fechamento do mês passado resumido (as contas são as do fechamento completo, SHC.fech) ──
    function concMes() {
        const F = SHC.fech, hoje = SHC.hoje(), mes = P.mesMenos(hoje.slice(0, 7), 1);
        if (!F) return { mes, nome: P.nomeMes(mes), casc: { linhas: [], liquido: null }, vb: null, custos: null };
        // v3.1: o mês passado e o retrasado com TODOS os custos (produtos = custo por SKU/anúncio × vendas do mês; imposto dos Ajustes).
        // ponytail: custo cadastrado só na família (F…) não entra aqui (o fechamento completo acha): o custo dos produtos fica "falta o custo".
        const custos = Object.assign({}, cadSku, custosMl), imp = cfg.configurado ? SHC.num(cfg.imposto_pct) : null, af = afil && afil.temAfiliados ? afil.metricas : null;
        const um = (m, fech) => {
            const v = F.vendasBrutas(fech, vb, m, hoje), produtos = F.custoProdutos(itens, vm, custos, m, fech ? fech.qtdVendas : null);
            return { m, fech, vb: v, produtos, impostoPct: imp, casc: F.cascata({ fech, vb: v, produtos, impostoPct: imp, afil: af, mes: m }) };
        };
        const a = um(mes, fechAnt), b = um(P.mesMenos(mes, 1), fechAnt2);
        return { mes, nome: F.nomeMes(mes), vb: a.vb, casc: a.casc, a, b, custos: F.custosTopicos(a, b, F.motivosMes(a)) };
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
    let concCopiado = -1, concNoRec = new Set();   // índices do "para conferir" já mostrados (com o botão) em Dá para recuperar
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
    // v3.1 (pedido da dona 26/09): custo novo na fatura (tipo de tarifa que não aparecia, ou que subiu > 50% e > R$ 50): o quê, quanto, desde quando,
    // por que costuma aparecer e como evitar (SHC.CUSTO_EXPLICA) e o link da fatura para contestar. Sem 2 faturas lidas não compara: não mostra nada.
    const CN_VISTOS = 3;
    function custoNovoHtml() {
        const cn = SHC.custosNovos(fat), its = cn.itens;
        if (!cn.base) return '';
        // Todos na mesma fatura: 1 botão só no pé do cartão (antes: 1 "Abrir a fatura" igual em cada custo).
        const umLink = its.length > 1 && its.every(x => x.link === its[0].link) && linkML(its[0].link) ? its[0] : null;
        const fl = (cn.faltaLer || []).length ? ` A fatura de ${cn.faltaLer.map(m => P.nomeMes(m)).join(' e ')} não foi lida: sem comparação com ela.` : '';
        if (!its.length) return `<p class="recnota ok" id="concCustoNovo" style="margin:0 0 8px">✓ Nenhum custo novo nas faturas (comparei ${cn.lidas} faturas).${esc(fl)}</p>`;
        const li = x => `<li class="acao sug ${x.novo ? 'pr' : 'at'}"><div class="tx"><b title="${esc(x.tipo)}">${esc(x.tipo)}</b>`
            + `<span>${SHC.moeda(x.valor)} na fatura ${esc(x.aberta ? 'em andamento' : 'de ' + x.nomeFatura)} · ${x.novo ? '<b class="vm" style="display:inline">novo</b>' + esc(x.desde && x.desde !== x.nomeFatura ? ' desde a fatura de ' + x.desde : ', não aparecia antes') : `<span class="var sobe">▲ ${x.pct}%</span> (era ${SHC.moeda(x.antes)})`}</span>`
            + (x.porque ? `<span>Por quê: ${esc(x.porque)}</span><span>Como evitar: ${esc(x.evitar)}</span>` : '<span>Custo novo sem explicação conhecida: confira no detalhe da fatura. Não reconhece este custo? Conteste no ML.</span>')
            + '</div>'
            + (!umLink && linkML(x.link) ? `<a class="bt ml pq" href="${esc(x.link)}" target="_blank" rel="noopener">Abrir a fatura</a>` : '') + '</li>';
        const k = 'conc:custonovo', n = its.filter(x => x.novo).length;
        return `<div class="card" id="concCustoNovo"><div class="ch"><h3>${n ? 'Custo novo na fatura' : 'Custo que subiu na fatura'}</h3><span class="selo ${n ? 'pr' : 'at'}">${esc(SHC.qtd(its.length, 'custo', 'custos'))}</span></div>`
            + `<ul class="acoes">${its.slice(0, aberto(k) ? its.length : CN_VISTOS).map(li).join('')}</ul>`
            + (its.length > CN_VISTOS ? btVer(k, 'Ver mais ' + (its.length - CN_VISTOS), 'Ver menos') : '')
            + (fl ? `<p class="det">${esc(fl.trim())}</p>` : '')
            + (umLink ? `<div class="acoes" style="justify-content:flex-start;margin-top:6px"><span class="det" style="margin:0">Não reconhece algum? Conteste no ML.</span><a class="bt ml pq" href="${esc(umLink.link)}" target="_blank" rel="noopener">Abrir a fatura${umLink.aberta ? '' : ' de ' + esc(umLink.nomeFatura)}</a></div><p class="det">Sai do seu lucro. Quem decide se devolve é o ML.</p></div>`
                : '<p class="det">Sai do seu lucro. Não reconhece algum? Conteste no ML pela fatura; quem decide se devolve é o ML.</p></div>');
    }
    // v3.1 (pedido da dona 26/09): manchete com o custo que mais subiu → KPIs → "Dá para recuperar" (estimativa, com a origem) → custos × mês anterior.
    function concTopo(x) {
        const F = SHC.fech, t = x.custos, cf = (conferir && conferir.itens) || [];
        concNoRec = new Set();
        if (!F || !t) return '';
        const rec = F.recuperar({ conc: P.concDe(freteHist), conferir: cf, inconformes: incRemessas() }), recLido = !!(P.concDe(freteHist) || conferir || remessas);
        const c = x.casc, lucro = c.lucro, bruto = c.bruto, Nome = x.nome.charAt(0).toUpperCase() + x.nome.slice(1).replace(/ de \d{4}$/, '');
        // Com as vendas dos 2 meses, a cor segue o peso nas vendas (como os tópicos logo abaixo): subir junto com as vendas = cinza.
        const bAnt = x.b.casc.bruto, cAnt = x.b.casc.custosML;
        const m = t.maior, cmp = Object.assign(F.compara(c.custosML, cAnt), { pp: c.custosML !== null && cAnt !== null && bruto > 0 && bAnt > 0 ? (c.custosML / bruto - cAnt / bAnt) * 100 : null }), sML = F.setaCusto(cmp);
        const fato = m ? F.fraseMaior(m, x.b.m, true) : lucro !== null ? `${Nome} fechou com ${SHC.moeda(lucro)} de lucro${bruto > 0 ? ' (' + SHC.pctTxt(lucro / bruto * 100) + ')' : ''}.`
            : c.liquido !== null ? `${Nome}: líquido do ML de ${SHC.moeda(c.liquido)}.` : `${Nome}: cobranças ainda não lidas por inteiro.`;
        const acao = rec.total > 0 ? `Dá para recuperar cerca de ${SHC.moeda(rec.total)}.` : m ? F.ACAO_CURTA[m.id] : t.comparou ? 'Nenhum custo subiu.' : '';
        const cor = m ? (m.dir === 'novo' || (m.pp !== null ? m.pp >= 1 : m.difPct >= 20) ? 'pr' : 'at') : lucro !== null ? (lucro < 0 ? 'pr' : 'ok') : '';
        const lp = t.linhas.find(l => l.id === 'produtos');
        let h = `<p class="manchete"><span class="pt ${cor}"></span><b>${esc(fato)}</b> ${esc(acao)}</p><div class="kpis k3">`
            + kpiN(lucro === null ? '' : lucro < 0 ? 'pr' : 'ok', 'Lucro de ' + P.mesLongo(x.mes), lucro === null ? '—' : SHC.moeda(lucro), esc(lucro !== null ? (bruto > 0 ? SHC.pctTxt(lucro / bruto * 100) + ' das vendas' : '') : (lp && lp.valor === null ? lp.motivo : 'ainda não lido')))
            + kpiN(sML.cls === 'sobe' ? 'pr' : sML.cls === 'desce' ? 'ok' : '', 'Custos do ML', c.custosML === null ? '—' : SHC.moeda(c.custosML),
                esc([c.custosML !== null && bruto > 0 ? SHC.pctTxt(c.custosML / bruto * 100) + (sML.txt ? '' : ' das vendas') : '', sML.txt].filter(Boolean).join(' · ')), 'Custos do ML em % das vendas e a mudança contra ' + P.mesLongo(x.b.m))
            + kpiN(rec.total > 0 ? 'at' : recLido ? 'ok' : '', 'Dá para recuperar', rec.total > 0 ? SHC.moeda(rec.total) : recLido ? 'nada' : '—', rec.total > 0 ? 'estimativa' : recLido ? 'nas cobranças lidas' : 'ainda não lido') + '</div>';
        h += custoNovoHtml();   // v3.1: logo depois dos números: custo novo na fatura
        // Dá para recuperar: até 3 itens por parcela, cada um com o botão certo (chamado do frete, texto copiado, reclamar a remessa).
        if (rec.parcelas.length) {
            const it = (p, y) => {
                if (p.id === 'frete') return `<li class="acao at"><div class="tx"><b title="${esc(tituloDe(y.itemId) || y.itemId)}">${esc(tituloDe(y.itemId) || y.itemId)}</b><span>pedido ${esc(y.pedido)} · ${SHC.moeda(y.valor)} a mais</span></div><button class="bt leve pq" data-frete-det="${esc(y.itemId)}">Chamado</button></li>`;
                if (p.id === 'full') return `<li class="acao ${y.prazo ? 'pr' : 'at'}"><div class="tx"><b>Remessa ${esc(y.id)}</b><span>${esc(y.motivos[0] || '')} · ${SHC.moeda(y.valor)}${y.prazo ? ' · até ' + esc(P.dataBr(y.prazo).slice(0, 5)) : ''}</span></div><a class="bt ml pq" href="${esc(y.link)}" target="_blank" rel="noopener">Reclamar no ML</a></li>`;
                const n = cf.indexOf(cf.find(z => z.pedido === y.pedido && z.regra === y.regra && z.cobranca === y.cobranca));
                if (n >= 0) concNoRec.add(n);
                return `<li class="acao at"><div class="tx"><b>Pedido ${esc(y.pedido)}</b><span>${esc(curtoTxt(y.cobranca, 34))} · ${SHC.moeda(y.valor)} a mais</span></div><button class="bt leve pq" data-conc-copiar="${n}">${concCopiado === n ? '✓ Copiado' : 'Copiar chamado'}</button></li>`;
            };
            h += `<div class="card" id="concRec"><div class="ch"><h3>Dá para recuperar</h3><span class="selo at">estimativa</span></div>`
                + rec.parcelas.map(p => `<p class="rs" style="margin:8px 0 2px"><b>${esc(p.rotulo)}</b> · ${SHC.moeda(p.valor)} · <span title="${esc('Origem: ' + p.origem)}">${esc(p.curta)}</span></p><ul class="acoes">${p.itens.slice(0, 3).map(y => it(p, y)).join('')}</ul>`
                    + (p.itens.length > 3 ? `<p class="rs">e mais ${p.itens.length - 3}${p.id === 'frete' ? ' na aba Frete' : p.id === 'full' ? ' na aba Full' : ' em “Cobranças para conferir”'}</p>` : '')).join('')
                + '<p class="det">Quem decide o que devolve é o ML; o chamado só pede a revisão. Devoluções do pós-venda ficam fora: o ML não informa se o dinheiro voltou.</p></div>';
        }
        // Custos × mês anterior: uma linha por custo, ▲ vermelho quando sobe, ▼ verde quando cai, e o peso em % das vendas.
        const { vis, zerados } = F.custosVisiveis(t);
        h += `<div class="card" id="concCustos"><div class="ch"><h3>Custos de ${esc(P.mesLongo(x.mes))} × ${esc(P.mesLongo(x.b.m))}</h3></div><table class="tb">${vis.map(l => {
            // v3.1 (29/09): o R$ da mudança escrito ("subiu R$ 120"), além da seta em %; custo que era 0 = "custo novo este mês".
            const s = F.setaCusto(l), sub = l.valor === null ? l.motivo : [l.dir === 'novo' ? 'custo novo este mês' : (l.dir === 'sobe' || l.dir === 'desce') && l.dif !== null ? (l.dif > 0 ? 'subiu ' : 'caiu ') + SHC.moeda(Math.abs(l.dif)) : '',
                l.pct !== null ? SHC.pctTxt(l.pct) + ' das vendas' : '', l.pp !== null ? 'era ' + SHC.pctTxt(l.pctAntes) : '', l.estimativa ? '30 dias, fora da conta' : '', l.semSep ? 'sem comparação' : '', l.parcialSem ? 'mês em andamento: sem comparação' : ''].filter(Boolean).join(' · ');
            return `<tr><td>${esc(l.rotulo)}${sub ? `<span class="sm">${esc(sub)}</span>` : ''}</td><td>${l.valor === null ? '—' : SHC.moeda(l.valor)}</td><td>${s.txt ? `<span class="var ${s.cls}">${esc(s.txt)}</span>` : ''}</td></tr>`;
        }).join('')}</table>${zerados.length ? `<p class="det">Sem cobrança nos 2 meses: ${esc(zerados.map(l => l.rotulo).join(', '))}.</p>` : ''}`
            + '<p class="det">▲ vermelho = o custo subiu · ▼ verde = caiu · ▲ cinza = mudou junto com as vendas (o peso nas vendas ficou igual). “—” = ainda não lido (não é zero).</p></div>';
        return h;
    }
    function desenhaConc() {
        $('#geralFam').innerHTML = cardFamilia();   // v3.1 (ESPEC §6): "Faturamento por família" saiu da Geral e fica aqui, com o mesmo id
        const F = SHC.fech, x = concMes(), ci = P.certInfo(cert, Date.now()), h = [];
        h.push(concTopo(x) || custoNovoHtml());   // sem o fechamento: o custo novo aparece mesmo assim
        if (ci && ci.vermelho) h.push(certHtml(ci));
        // Fechamento resumido
        const linhas = P.concResumo(x.casc), liq = x.casc.liquido;
        const vbTxt = !x.vb ? `As vendas brutas de ${x.nome} ainda não foram lidas.` : (!x.vb.completo ? `As vendas brutas de ${x.nome} foram lidas só em parte${typeof x.vb.dias === 'number' ? ' (' + x.vb.dias + ' de ' + x.vb.diasMes + ' dias)' : ''}.` : '');
        const rp = F ? F.comparaRepasse(rep, x.mes, liq) : null;
        h.push(dobra(`<div class="card" id="concFech"><b style="font-size:13px">Fechamento de ${esc(x.nome)}</b>
          <table class="tabf"><tbody>${linhas.map(l => `<tr${l.id === 'liquido' ? ' style="font-weight:800"' : ''}><td>${esc(l.rotulo)}</td><td>${l.valor === null ? '—' : (l.tipo === 'menos' ? '− ' : (l.tipo === 'mais' ? '+ ' : (l.tipo === 'info' ? '(' : ''))) + SHC.moeda(l.valor) + (l.tipo === 'info' ? ')' : '')}</td></tr>`).join('')}</tbody></table>
          ${vbTxt ? `<p class="det">${esc(vbTxt)} Sem o mês inteiro, o líquido fica “—”.</p>` : ''}${!fechAnt ? `<p class="det">As cobranças de ${esc(x.nome)} ainda não foram lidas do Faturamento.</p>` : ''}
          <p class="det"><b>Mercado Pago:</b> ${esc(rp ? rp.frase : (rep ? 'o Mercado Pago de ' + x.nome + ' ainda não foi lido.' : 'conecte o Mercado Pago no fechamento completo para comparar o que entrou com o líquido.'))}</p>
          ${F && F.MP_LE ? `<p class="det">${esc(F.MP_LE)}</p>` : ''}
          <p class="det">“—” = ainda não lido (não é zero). Estornos entre parênteses já estão descontados nas linhas de cima. Líquido = estimativa.</p></div>`,
          'conc:fech', liq === null ? 'líquido ainda não lido por inteiro' : 'líquido ' + SHC.moeda(liq)));
        // v3.1 (29/09, pergunta da dona "está puxando igual ao ML?"): a última fatura fechada × o Copiloto, categoria por categoria (SHC.fech.dadosConf),
        // e a fatura × a anterior (por que subiu ou caiu). O desenho e o CSS são os do fechamento completo.
        if (F && F.dadosConf) {
            F.porCss(document);
            const fechs = {}; fechs[P.mesMenos(x.mes, 1)] = fechAnt2; fechs[x.mes] = fechAnt; fechs[SHC.hoje().slice(0, 7)] = fechAtual;
            const dc = F.dadosConf(fat, fechs, vb, SHC.hoje());
            if (dc.conf) h.push(`<div class="card" id="concConfere"><b style="font-size:13px">Confere com a fatura do ML</b>${F.htmlConfere(dc.conf)}</div>`);
            if (dc.vs) h.push(dobra(`<div class="card" id="concFaturaVs"><b style="font-size:13px">Fatura de ${esc(P.mesLongo(dc.vs.mesFat))} × ${esc(P.mesLongo(dc.vs.mAnt))}</b>${F.htmlFaturaVs(dc.vs)}</div>`,
                'conc:faturavs', esc(dc.vs.manchete || '')));
        }
        // Pagamento excedente (cobranças para conferir: a mesma regra do fechamento completo, gravada pelo fundo)
        const cf = conferir, its = (cf && cf.itens) || [], resto = its.map((i, n) => [i, n]).filter(([, n]) => !concNoRec.has(n));
        h.push(dobra(`<div class="card" id="concConferir"><b style="font-size:13px">Cobranças para conferir</b>
          <p class="det">Cobranças acima do esperado, estornos que não vieram e faturas que não batem. O Copiloto só aponta: o chamado é você que abre, com o texto pronto.</p>
          ${concNoRec.size ? `<p class="det">${esc(SHC.qtd(concNoRec.size, 'pedido já está', 'pedidos já estão'))} em “Dá para recuperar”, acima, com o texto do chamado.</p>` : ''}
          ${resto.slice(0, 3).map(([i, n]) => `<div class="linha-comp"><b>Pedido ${esc(i.pedido)} · ${esc(curtoTxt(i.cobranca, 50))}</b><small>Cobrado ${SHC.moeda(i.valor)} × esperado ${SHC.moeda(i.esperado)}: <b class="vm">${SHC.moeda(i.diferenca)} a mais</b></small><small>${esc(i.motivo)}</small>
            <div class="acoes" style="justify-content:flex-start;margin-top:4px"><button class="bt leve" data-conc-copiar="${n}">${concCopiado === n ? '✓ Copiado' : 'Copiar texto do chamado'}</button>${F ? `<a class="lnk" href="${esc(F.URL.cobranca(i.pedido))}" target="_blank" rel="noopener">Abrir a cobrança</a>` : ''}</div></div>`).join('')}
          ${resto.length > 3 ? `<p class="det">E mais ${resto.length - 3} no fechamento completo.</p>` : ''}
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
          ${px.slice(0, 10).map(s => `<div class="linha-comp"><b>${esc(P.quandoCanal(s.dia, s.hora))}${(SHC.CANAL_TIPOS || {})[s.tipo] ? ` · <span class="tipo-canal t-${esc(s.tipo)}">${esc(SHC.CANAL_TIPOS[s.tipo])}</span>` : ''}</b><small>${esc(s.titulo || tituloDe(s.itemId))} · ${s.feito ? '✓ criada no ML' : 'falta criar no ML'}</small></div>`).join('')
            || `<p class="det">${pl ? 'Nenhuma transmissão daqui para frente na agenda.' : 'A agenda ainda não foi montada.'} Clique em “Abrir a agenda”.</p>`}
          ${comProd ? `<p class="det">${feitas} de ${comProd} comunicações da agenda já criadas no ML.</p>` : ''}</div>`,
          'canal:prox', px.length ? esc('próxima: ' + P.quandoCanal(px[0].dia, px[0].hora)) : (pl ? 'nenhuma daqui para frente' : 'agenda ainda não montada')));
        // v3.1: "para programar" = a MESMA regra da Agenda (registro shc:canal:plano:<canal>.prontos). Proposta da Central que daria lucro
        // ainda não é promoção: fica à parte, "proposta: aceite no ML para entrar".
        const props = (snap ? snap.familias.map(f => resumoFamilia(f)).filter(r => r.classe === 'lucrativo') : []).map(r => {
            const e = r.rec && r.rec.escolha; return e && e.p ? { itemId: e.p.itemId, titulo: r.f.titulo, lucro: e.sobra, promo: e.p.promo } : null;
        }).filter(Boolean);
        const pp = P.canalParaProgramar(canalPlano, props), pr = pp.prontos || [];
        const aviso = SHC.canalAvisoRobo && canalPlano ? SHC.canalAvisoRobo(canalPlano, new Date()) : null;
        if (aviso) h.unshift(`<div class="card" id="canalRobo"><b style="font-size:13px">✓ ${esc(aviso)}</b><p class="det">O robô montou; quem cria cada transmissão no ML é você.</p><button class="bt" data-abrir-agenda>Abrir a agenda</button></div>`);
        h.push(dobra(`<div class="card" id="canalProd"><b style="font-size:13px">Produtos que dão lucro para programar</b>
          ${pr.slice(0, 5).map(x => `<div class="linha-comp"><b>${esc(x.titulo || tituloDe(x.itemId))}</b><small>Lucro de ${esc(SHC.moeda(x.lucro))} · ${x.semVaga ? 'sem horário livre em ' + esc(P.quandoCanal(x.dia, 0).replace(/ às .*/, '')) : x.feito ? 'criada no ML' : 'na agenda em ' + esc(P.quandoCanal(x.dia, 0).replace(/ às .*/, ''))}</small></div>`).join('')
            || `<p class="det">${pp.prontos ? 'Nenhum produto pode entrar na agenda agora.' : 'Abra a agenda para conferir quais produtos podem entrar.'}</p>`}
          ${canalPlano && canalPlano.fora && canalPlano.fora.resumo ? `<p class="det">${esc(canalPlano.fora.resumo)} — veja o porquê na agenda.</p>` : ''}
          ${pp.propostas.slice(0, 3).map(x => `<div class="linha-comp"><b>${esc(x.titulo)}</b><small>proposta: aceite no ML para entrar · lucro de ${esc(SHC.moeda(x.lucro))} em “${esc(x.promo)}”</small></div>`).join('')}
          <p class="det">A agenda só põe produto conferido no dia. Quem cria cada transmissão no ML é você.</p></div>`,
          'canal:prod', pp.prontos ? esc(SHC.qtd(pr.length, 'produto pode entrar', 'produtos podem entrar') + (pp.propostas.length ? ' · ' + SHC.qtd(pp.propostas.length, 'proposta', 'propostas') + ' para aceitar' : '')) : pl ? 'abra a agenda para conferir' : 'agenda ainda não montada'));
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
        const csRes = (resumoML && resumoML.cartoes) || [];
        $('#listaSaude').innerHTML = `<p class="manchete"><span class="pt ${mc.cor}"></span><b>${esc(mc.fato)}</b> ${esc(mc.acao)}</p>` + cardReputacao() + cardPerguntas()
            + (andandoSaude() ? `<p class="andam">Conferindo fotos, medidas e visitas: ${p.feito || 0} de ${p.de} anúncios nesta rodada…</p>` : '')
            + (saudeMsg ? `<p class="recnota neutra" role="status" style="margin:0 0 8px">${esc(saudeMsg)}</p>` : '')
            + blocoS(cardResumoML(), 'saude:resumo', resumoML ? (csRes.length ? esc(SHC.qtd(csRes.length, 'pendência', 'pendências')) : '✓ nada pendente') : 'aparece depois da próxima sincronização',
                !resumoML ? '' : csRes.some(c => c.cor === 'red') ? 'pr' : csRes.length ? 'at' : 'ok')
            + blocoS(cardFiscal(), 'saude:fiscal', f.n === null ? (fiscalLendo ? 'Lendo os dados fiscais…' : esc(fiscalMsg || 'ainda não lidos') + ' <button class="lnk" data-fiscal-agora>Ler agora</button>') : (f.n ? '<b class="vm">' + esc(SHC.qtd(f.n, 'anúncio sem dados fiscais', 'anúncios sem dados fiscais')) + '</b>' : '✓ todos com dados fiscais'),
                f.n === null ? '' : f.n ? 'pr' : 'ok')
            // ESPEC §6 "Fotos e medidas (um bloco só)": sem a permissão, 1 cartão com "Permitir" e o porquê no "?"; Fotos e Medidas só com permissão ou leitura.
            + (permWww ? '' : `<div class="card sb" id="cardPerm"><span class="pt at"></span><b class="sb-t">Fotos e medidas</b>${btPerm()}</div>`)
            + (permWww || rf.lidos ? blocoS(cardFotos(), 'saude:fotos', rf.lidos ? esc(P.milhar(rf.lidos) + ' de ' + P.milhar(rf.de) + ' conferidos · ' + rf.faixas.f1.length + ' com 1 foto') : 'lendo aos poucos',
                !rf.lidos ? '' : rf.faixas.f1.length || rf.marcadas.length ? 'at' : 'ok') : '')
            + (permWww || rm.lidos ? blocoS(cardMedidas(rm), 'saude:medidas', rm.lidos ? (rm.div.length ? esc(SHC.qtd(rm.div.length, 'SKU com medidas diferentes', 'SKUs com medidas diferentes')) : '✓ nenhuma diferença') : 'lendo aos poucos',
                !rm.lidos ? '' : rm.div.some(P.medPesa) ? 'pr' : rm.div.length ? 'at' : 'ok') : '')
            + (rm.lidos ? blocoS(cardMudMed(rm), 'saude:mudmed', rm.mud.length ? esc(SHC.qtd(rm.mud.length, 'mudança', 'mudanças') + ' nos últimos ' + P.MED_DIAS + ' dias') : 'nenhuma mudança', rm.mud.length ? 'pr' : 'ok') : '')
            // Radar recolhido: manchete e os 3 números por cor ficam à vista; "Ver mais" abre o detalhe por SKU.
            + blocoS(cardRadar(hoje), 'saude:radar', '', !rl.lidos ? '' : rl.caindo.length ? 'pr' : 'ok', RADAR_FIM)
            + blocoS(cardRobo(hoje), 'saude:robo', esc([cfg.robo_ligado && !(SHC.ROBO_ESCRITA_CONFERIDA === true && cfg.robo_modo === 'automatico') ? 'só sugere' : '', nSug ? SHC.qtd(nSug, 'sugestão', 'sugestões') : ''].filter(Boolean).join(' · ')),
                cfg.robo_ligado ? (nSug ? 'at' : 'ok') : '', '</div>');
    }
    // v3.1 (imagem tela-saude, ESPEC §2 "Ver mais"): cada bloco da Saúde com a bolinha de estado (pr/at/ok; cinza = ainda não lido), o título,
    // o resumo embaixo e "Ver mais" à direita (grade .card.sb no CSS). O cabeçalho é o 1º <b> do cartão (o do robô já vem com .sb-h).
    function blocoS(html, k, resumo, cor, fim) {
        const h = html.replace('class="card"', 'class="card sb"').replace('<b style="font-size:13px">', `<span class="pt ${cor}"></span><b class="sb-t">`).replace('<div class="sb-h">', `<div class="sb-h"><span class="pt ${cor}"></span>`);
        return dobra(h, k, resumo, fim).replace('<span class="res">· ', '<span class="res">');
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
            fiscalMsg = r && r.ok ? '' : !r ? 'O Copiloto não respondeu agora.'
                : r.motivo === 'sem_sessao' ? 'Entre no Mercado Livre neste Chrome.'
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
          ${vis.map(l => `<div class="linha-sem"><span><b>${esc(l.titulo || l.itemId)}</b><small>${esc(l.itemId)}</small></span></div>`).join('')}
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
        if (!r.lidos) return h + `<p class="det">${!permWww ? 'Aguardando a permissão (acima).' : andandoSaude() ? 'Contando as fotos…' : 'As fotos aparecem aos poucos: o Copiloto confere alguns anúncios por hora, com o Chrome aberto.'}</p></div>`;
        if (r.lidos < r.de && permWww) {
            const pct = Math.round(r.lidos / r.de * 100);
            h += `<div class="barra-g" role="progressbar" aria-label="Fotos conferidas" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div><p class="det" style="margin:0">Fotos conferidas: ${r.lidos} de ${r.de} anúncios ativos</p>`;
        }
        h += '<div class="kpis" style="margin:8px 0 6px">' + P.FAIXAS_FOTOS.map(([k, rot]) => `<button class="kpi${r.faixas[k].length ? ' ' + ({ f1: 'pr', f2: 'at' }[k] || 'ok') : ''}${fotoFaixa === k ? ' on' : ''}" data-foto-faixa="${k}"><small>${rot}</small><b>${r.faixas[k].length}</b></button>`).join('') + '</div>';
        if (fotoFaixa) {
            const l = r.faixas[fotoFaixa];
            h += l.length ? listaVer('fotos', l, 8, x => `<div class="linha-sem"><span><b>${esc(x.titulo || x.itemId)}</b><small>${esc(x.itemId)} · ${esc(P.fotosTxt(x))}</small></span>${btFotos(x.itemId)}</div>`)
                : '<p class="det">Nenhum anúncio nesta faixa.</p>';
        }
        if (r.marcadas.length) h += `<p style="margin:10px 0 2px;font-weight:650;font-size:12.5px">Com fotos marcadas pelo ML (${r.marcadas.length})</p>`
            + listaVer('marcadas', r.marcadas, 8, x => `<div class="linha-sem"><span><b>${esc(x.titulo || x.itemId)}</b><small class="vm">${x.problemas} de ${x.qtd} fotos marcadas pelo ML</small></span>${btFotos(x.itemId)}</div>`);
        return h + '<p class="det">Fonte: tela “Alterar anúncio” do Mercado Livre, conferida a cada 7 dias. A 1ª foto é a capa.</p></div>';
    }
    const btPerm = () => `<button class="ajuda" type="button" aria-label="Por que pedir esta permissão" title="Para ler as fotos e as medidas, o Copiloto abre a tela “Alterar anúncio” de cada anúncio, só para ler (não muda nada). O Chrome pede a sua permissão uma vez.">?</button>`
        + `<span class="res">falta 1 permissão</span><button class="bt" data-perm-fotos>${PERM_TXT}</button>`;
    const MED_FRASE = 'Anúncios do mesmo produto com medidas diferentes podem pagar fretes diferentes; corrija para a medida certa.';
    const medMsgDe = id => (medMsg && medMsg.id === id ? `<small class="det" role="status" style="display:block">${esc(medMsg.txt)}</small>` : '');
    const btMed = id => `<button class="lnk" data-abrir-med="${esc(id)}">Alterar no ML</button>`;
    // Medidas do ERP (c|sku|…) do SKU: dizem se a mudança foi do ML e qual é a medida certa no chamado.
    const erpDe = sku => { const c = sku ? cadSku[SHC.chaveSku(sku)] : null; return c ? SHC.medidaDe([c.larguraCm, c.alturaCm, c.comprimentoCm], c.pesoKg) : null; };
    const resumoMed = () => P.resumoMedidas(medidas, itens, vm, Date.now(), { erpDe });
    // Medidas da embalagem: SKUs cujos anúncios têm medidas diferentes (os 5 de maior diferença; "Ver todos"). Clicar no SKU abre a tabela.
    function cardMedidas(rm) {
        let h = '<div class="card" id="cardMedidas"><b style="font-size:13px">Medidas da embalagem</b>';
        if (!rm.lidos) return h + `<p class="det">${permWww ? 'O Copiloto está lendo as medidas de cada anúncio; aparece aqui em alguns minutos.' : 'Aguardando a permissão (acima).'}</p></div>`;
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
            h += `<tr${verm ? ' class="acima"' : ''}><td><b>${esc(a.itemId)}</b>${tit !== a.itemId ? `<small style="display:block">${esc(tit)}</small>` : ''}<small style="display:block">${btMed(a.itemId)} · <button class="lnk" data-med-agora="${esc(a.itemId)}">Conferir agora</button></small>${medMsgDe(a.itemId)}</td>
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
        h += listaVer('medmud', rm.mud, 5, (m, i) => `<div class="linha-comp"><b>${esc(tituloDe(m.itemId))}</b>
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
    // Ações de um anúncio que perdeu visitas (só nele): Abrir no ML · Ver no Ads · robô de fotos. multi = o SKU tem mais de 1 anúncio.
    function acoesRadar(x, multi) {
        const on = !!(cfg.robo_itens || {})[x.itemId];
        return `<small>${multi ? esc(x.itemId) + (x.r.variacaoPct !== null ? ` · <span class="vm">${P.varPct(x.r.variacaoPct)}</span>` : '') + ' · ' : ''}${btFotos(x.itemId, 'Abrir no ML')}${SHC.moduloLigado(cfg, 'ads') ? ` · <button class="lnk" data-ads-det="${esc(x.itemId)}">Ver no Ads</button>` : ''}</small>
          <label class="conf" style="margin:4px 0 0"><input type="checkbox" data-robo-item="${esc(x.itemId)}"${on ? ' checked' : ''}> Robô de fotos neste anúncio${cfg.robo_ligado ? '' : ' (ligue o robô abaixo)'}</label>`;
    }
    // Linha do radar por SKU: 7 dias antes → agora, variação com seta e cor (vermelho caindo, verde subindo). caindo = os anúncios deste SKU
    // que perderam visitas: as ações ficam aqui mesmo (antes havia uma 2ª lista "Perdendo visitas" repetindo os mesmos anúncios).
    function linhaRadarSku(s, caindo) {
        const cor = s.classe === 'caindo' ? 'vm' : s.classe === 'subindo' ? 'vv' : '', seta = s.classe === 'caindo' ? '▼ ' : s.classe === 'subindo' ? '▲ ' : '';
        return `<div class="linha-comp rd ${s.classe}" data-radar-sku="${esc((s.sku + ' ' + s.titulo).toLowerCase())}"${radarBusca && (s.sku + ' ' + s.titulo).toLowerCase().indexOf(radarBusca.toLowerCase()) < 0 ? ' hidden' : ''}><b>${esc(s.sku ? 'SKU ' + s.sku : s.itemId)}${s.n > 1 ? ' <span class="res">· ' + esc(SHC.qtd(s.n, 'anúncio', 'anúncios')) + '</span>' : ''}</b>
          <small>${esc(s.titulo)}</small><small>7 dias antes: ${P.milhar(s.ant7)} → agora: ${P.milhar(s.ult7)} visitas${s.variacaoPct !== null ? ` · <span class="${cor}">${seta}${P.varPct(s.variacaoPct)}</span>` : ''}</small>${(caindo || []).map(x => acoesRadar(x, s.n > 1)).join('')}</div>`;
    }
    const RADAR_FIM = '<!--radar-resumo-->';   // até aqui, o que fica à vista com o cartão recolhido
    function cardRadar(hoje) {
        const rl = P.radarLista(visitas, itens.filter(SHC.anuncioAtivo), cfg, hoje);
        let h = `<div class="card" id="cardRadar"><b style="font-size:13px">Radar de visitas</b>`;
        if (!rl.lidos) return h + `<p class="det">${andandoSaude() ? 'Lendo as visitas…' : 'As visitas aparecem aos poucos: o Copiloto lê alguns anúncios por hora, com o Chrome aberto.'}</p><button class="bt leve" data-saude-agora>Ler agora</button></div>`;
        const nc = rl.caindo.length;
        const tot = (l, k) => l.reduce((a, x) => a + x.r[k], 0), varDe = l => (tot(l, 'ant7') ? P.varPct((tot(l, 'ult7') - tot(l, 'ant7')) / tot(l, 'ant7') * 100) : '');
        h += `<p class="manchete" style="margin:6px 0 8px"><span class="pt ${nc ? 'pr' : 'ok'}"></span><b>${esc(nc ? SHC.qtd(nc, 'anúncio perdeu visitas.', 'anúncios perderam visitas.') : 'Nenhum anúncio perdeu visitas.')}</b> ${nc ? 'Revise a capa, o título e o preço de cada um.' : 'Últimos 7 dias contra os 7 anteriores.'}</p>
          <div class="kpis k3"><div class="kpi kn${nc ? ' pr' : ''}"><div class="l">Caindo</div><div class="v">${nc}</div><div class="s">${nc ? '▼ ' + esc(varDe(rl.caindo)) + ' juntos' : '&nbsp;'}</div></div>
          <div class="kpi kn"><div class="l">Estáveis</div><div class="v">${rl.estavel.length}</div><div class="s">&nbsp;</div></div>
          <div class="kpi kn${rl.subindo.length ? ' ok' : ''}"><div class="l">Subindo</div><div class="v">${rl.subindo.length}</div><div class="s">${rl.subindo.length ? '▲ ' + esc(varDe(rl.subindo)) + ' juntos' : '&nbsp;'}</div></div></div>${RADAR_FIM}`;
        // Uma lista só, por SKU (do que mais caiu ao que mais subiu); os anúncios que perderam visitas trazem as ações na própria linha.
        const porSku = P.radarPorSku(rl, cfg.radar_queda_pct), caiPor = {};
        rl.caindo.forEach(x => { (caiPor[x.sku || x.itemId] || (caiPor[x.sku || x.itemId] = [])).push(x); });
        if (porSku.length) h += `<p style="margin:8px 0 2px;font-weight:650;font-size:12.5px">Por SKU (${porSku.length})</p>`
            + (porSku.length > 3 ? `<input class="busca" data-radar-busca placeholder="Buscar SKU ou título" aria-label="Buscar SKU" value="${esc(radarBusca)}" style="margin-bottom:0">` : '')
            + porSku.slice(0, limite.saude).map(s => linhaRadarSku(s, caiPor[s.sku || s.itemId])).join('') + botaoMais('saude', porSku.length - limite.saude);
        if (!rl.caindo.length) h += `<p class="det">Nenhum anúncio perdeu ${cfg.radar_queda_pct || 20}% ou mais das visitas na última semana.</p>`;
        if (rl.poucos.length) h += `<p class="det">${esc(SHC.qtd(rl.poucos.length, 'anúncio', 'anúncios'))} com poucas visitas para comparar (menos de 30 em 2 semanas).</p>`;
        return h + '<p class="det">Compara as visitas dos últimos 7 dias com as dos 7 anteriores. Fonte: métricas de cada anúncio no Mercado Livre, relidas uma vez por dia, alguns anúncios por hora, com o Chrome aberto. O Mercado Livre não publica que mexer no anúncio melhora a posição. O Copiloto mede antes e depois para você ver se funciona na sua conta.</p></div>';
    }
    function cardRobo(hoje) {
        const ligado = !!cfg.robo_ligado, auto = SHC.ROBO_ESCRITA_CONFERIDA === true;
        const escreve = auto && cfg.robo_modo === 'automatico';   // só true quando a escrita no ML for conferida e o modo Automático estiver ligado
        const nItens = Object.keys(cfg.robo_itens || {}).filter(k => cfg.robo_itens[k]).length;
        const val = k => esc(String(SHC.num(cfg[k]) !== null ? cfg[k] : SHC.PADRAO[k]));
        // v3.1 (imagem tela-radar): ícone + selo "Ligado · só sugere"; a sugestão em caixa azul com "Trocar no ML" e "Já troquei";
        // o resultado de cada troca em 2 barras (7 dias antes × 7 depois); as travas do robô ficam dentro de "Regras do robô".
        let h = `<div class="card" id="cardRobo"><div class="sb-h"><svg class="ir" aria-hidden="true"><use href="#ip-robo"/></svg><b class="sb-t">Robô de fotos</b><span class="selo ${ligado ? 'ok' : 'cz'} d">${ligado ? 'Ligado' : 'Desligado'}</span>
            <button class="bt pq${ligado ? ' leve' : ''}" data-robo-geral>${ligado ? 'Desligar' : 'Ligar o robô'}</button></div>
          <p class="det">${escreve ? 'Quando as visitas de um anúncio caem, troca a ordem das fotos para ver se ajuda.' : 'Quando as visitas de um anúncio caem, sugere uma nova ordem das fotos. Quem troca no Mercado Livre é você.'}</p>`;
        if (ligado && !permWww) h += '<p class="aviso-custo">Para o robô funcionar, o Copiloto precisa ler as fotos dos anúncios. Permita em “Fotos e medidas”, acima.</p>';
        if (ligado && !nItens) h += '<p class="aviso-custo">Agora ligue o robô nos anúncios que quiser, nos SKUs que estão caindo, no Radar.</p>';
        if (auto) h += `<div class="acoes" style="justify-content:flex-start;flex-wrap:wrap">${[['sugerir', 'Só sugerir'], ['automatico', 'Automático']].map(([m, t]) => `<button class="bt${cfg.robo_modo === m ? '' : ' leve'}" data-robo-modo="${m}">${t}</button>`).join('')}</div>`;
        const sug = (robo && robo.sugestoes) || [];
        if (sug.length) h += `<p class="rb-t">Sugestões (${sug.length})</p>` + sug.slice(0, 20).map(s => `<div class="sug"><b>${esc(tituloDe(s.itemId))}</b><p>${esc(s.motivo)}</p>
            <div class="linha-bts"><button class="bt pq ml" data-abrir-fotos="${esc(s.itemId)}">Trocar no ML</button><button class="bt pq leve" data-ja-troquei="${esc(s.itemId)}">Já troquei</button></div></div>`).join('');
        if (ligado) h += '<button class="bt leve" data-robo-rodar style="margin-top:8px">Procurar sugestões agora</button>';
        h += `<p class="det" id="roboMsg" role="status">${esc(roboMsg)}</p>`;
        const hist = (robo && robo.historico) || [], ult = hist.slice(-10).reverse(), porId = (visitas && visitas.porItem) || {};
        // 7 dias antes × 7 depois em barras (mesma escala; depois verde se subiu, vermelho se caiu). Sem os 14 dias lidos: só o texto "Medindo…".
        const barras = x => {
            const e = SHC.efeitoMudanca(x.ts, (porId[x.itemId] || {}).dias, hoje), mx = Math.max(e.antes7, e.depois7);
            if (!e.pronto || !mx) return '';
            const w = n => Math.max(2, Math.round(n / mx * 100)), c = e.depois7 > e.antes7 ? 'ok' : e.depois7 < e.antes7 ? 'pr' : '';
            return `<div class="ef" role="img" aria-label="${esc('Visitas: ' + P.milhar(e.antes7) + ' nos 7 dias antes e ' + P.milhar(e.depois7) + ' nos 7 dias depois da troca')}">`
                + `<div class="ef-l"><span>7 dias antes</span><div class="medidor"><i style="width:${w(e.antes7)}%"></i></div><b>${P.milhar(e.antes7)}</b></div>`
                + `<div class="ef-l"><span>7 dias depois</span><div class="medidor"><i class="${c}" style="width:${w(e.depois7)}%"></i></div><b class="${c}">${P.milhar(e.depois7)}</b></div></div>`;
        };
        if (ult.length) h += '<p class="rb-t">Mudanças e resultado</p>' + ult.map(x => `<div class="linha-comp"><b>${esc(tituloDe(x.itemId))}</b>
            <small>${esc(new Date(x.ts).toLocaleDateString('pt-BR'))} · ${esc(P.historicoTxt(x))}</small>${SHC.roboGravou(x) || x.resultado === 'manual' ? barras(x) + `<small>${esc(P.efeitoTxt(x, (porId[x.itemId] || {}).dias, hoje))}</small>` : ''}
            ${P.podeDesfazer(hist, x) ? `<button class="lnk" data-robo-desfazer="${esc(x.itemId)}">Desfazer</button>` : ''}</div>`).join('');
        h += `<details id="regrasRobo" style="margin-top:8px"${regrasAbertas ? ' open' : ''}><summary style="cursor:pointer;font-weight:650;font-size:12px">Regras do robô</summary>
            <ul class="vant"><li>A foto de capa nunca sai do lugar.</li><li>Não mexe se o Mercado Livre marcou alguma foto do anúncio.</li>
            <li>No máximo 1 ${escreve ? 'mudança' : 'sugestão'} a cada ${val('robo_intervalo_dias')} dias por anúncio.</li><li>No máximo ${val('robo_max_dia')} ${escreve ? 'mudanças' : 'sugestões'} por dia na conta.</li>
            <li>Só ${escreve ? 'age nos' : 'olha os'} anúncios que você ligar, quando as visitas caem ${val('radar_queda_pct')}% ou mais e o anúncio tem 3 fotos ou mais.</li></ul>
            <div class="minfull"><label for="radar_queda_pct">Queda mínima das visitas (%)</label><input class="inp" id="radar_queda_pct" inputmode="numeric" value="${val('radar_queda_pct')}"></div>
            <div class="minfull"><label for="robo_intervalo_dias">Intervalo por anúncio (dias)</label><input class="inp" id="robo_intervalo_dias" inputmode="numeric" value="${val('robo_intervalo_dias')}"></div>
            <div class="minfull"><label for="robo_max_dia">Máximo de ${escreve ? 'mudanças' : 'sugestões'} por dia</label><input class="inp" id="robo_max_dia" inputmode="numeric" value="${val('robo_max_dia')}"></div>
            <div class="minfull"><button class="bt" data-robo-salvar>Salvar regras</button></div></details>`;
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
                return { linhas: [t.length ? `${SHC.qtd(t.length, 'produto dá', 'produtos dão')} prejuízo em todas as propostas: ` + t.slice(0, 5).map(r => r.f.titulo).join('; ') + (t.length > 5 ? ' e mais ' + (t.length - 5) : '') + '.' : 'Nenhum produto com custo informado dá prejuízo em todas as propostas.', 'Produtos sem custo não entram nesta conta.'], fonte: FONTE_PROMO_TXT };
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
                    ? `${l.it.titulo}: frete típico por pedido de ${SHC.moeda(l.fa.ant30.tipico)} (30 dias anteriores) para ${SHC.moeda(l.fa.ult30.tipico)} (últimos 30 dias, ${SHC.qtd(l.fa.ult30.pedidos, 'pedido', 'pedidos')}).`
                    : `${l.it.titulo}: de ${SHC.moeda(l.h.anterior)} para ${SHC.moeda(l.h.atual)} em ${P.dataBr(l.h.desde)} (lista de Anúncios do ML).`)
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
            if (a === 'frete') $(antes).parentElement.appendChild(box);   // v3.1 (imagem tela-frete): as perguntas vão para o fim da aba, depois dos blocos
            else $(antes).parentElement.insertBefore(box, $(antes));
        });
    }
    // "Conferir as promoções" (guia) fica feito quando o seller usa a aba Promoções com dados.
    function marcaPromos() { if (snap && snap.familias.length && !guia.feitos.promos) SHC.salvarGuia({ feitos: { promos: SHC.hoje() } }); }

    // Botão e seção da aba em uso (também na abertura do painel, com a aba lembrada: o HTML vem com a Geral marcada).
    function marcaAba() {
        // v3.1: a faixa (role=tab, aria-selected, só a ativa no Tab) e a grade "Todas" marcam a mesma aba.
        document.querySelectorAll('#abas button[data-a],#menuAbas button[data-a]').forEach(x => {
            const on = x.dataset.a === aba;
            x.classList.toggle('on', on);
            if (!x.setAttribute) return;
            if (x.closest && x.closest('#menuAbas')) x.setAttribute('aria-current', on ? 'page' : 'false');
            else { x.setAttribute('aria-selected', on ? 'true' : 'false'); x.tabIndex = on ? 0 : -1; }
        });
        document.querySelectorAll('.aba').forEach(s => s.classList.toggle('on', s.id === aba));
        $('#st').classList.toggle('so-selo', aba === 'geral');   // na Geral a barra e a etapa já estão no cartão do topo: o selo não repete
        stGeral();
        mostraAbaAtiva();
    }
    // ── v3.1 topo: a aba ativa sempre visível na faixa; contador por aba; sino; "Todas" (grade 3×4) abaixo de 900 px ──
    function mostraAbaAtiva() {
        const b = document.querySelector('#abas button.on');
        if (b && typeof b.scrollIntoView === 'function' && !(document.body.classList && document.body.classList.contains && document.body.classList.contains('larga'))) {
            try { b.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch (e) { /* navegador antigo */ }
        }
        atualizaTodas();
    }
    var contAbas = null;   // var: desenhaTopoAba pode rodar antes desta linha na abertura
    // Bolinhas das abas que o fundo não conta, com o número que a própria aba mostra: Promoções = produtos com prejuízo em todas as
    // propostas ("Precisa de você"); Catálogo = anúncios perdendo o 1º lugar (P.resumoCompeticao). Não lido → sem bolinha.
    var promoCont = { de: null, n: 0 };   // var: pode rodar antes desta linha na abertura; refeito só quando os dados mudam (o status grava a cada página)
    function contadoresExtra() {
        const ex = {};
        try {
            if (snap && snap.familias && snap.familias.length) {
                const de = [snap, cfg, custoFam, custoProp, propsPorFam];
                if (!promoCont.de || de.some((x, i) => x !== promoCont.de[i])) promoCont = { de, n: snap.familias.map(f => resumoFamilia(f)).filter(r => r.classe === 'prejuizo').length };
                ex.promo = { n: promoCont.n, cor: 'pr' };
            }
        } catch (e) { /* abertura: promoções ainda não montadas */ }
        const rc = P.resumoCompeticao(itens || []);
        if (rc.temDado) ex.catalogo = { n: rc.grupos.preco.length + rc.grupos.entrega.length + rc.grupos.outros.length, cor: 'pr' };
        return ex;
    }
    function desenhaContadores() {
        contAbas = P.contadoresAbas(anom, conta, P.abasVisiveis(cfg), contadoresExtra(), alertasAgora);
        const pa = (contAbas && contAbas.porAba) || {};
        document.querySelectorAll('#abas button[data-a],#menuAbas button[data-a]').forEach(b => {
            const x = pa[b.dataset.a], s = b.querySelector && b.querySelector('.b'), rot = P.ROT_ABA[b.dataset.a] || '';
            if (s) { s.hidden = !x; s.className = 'b' + (x ? ' ' + x.cor : ''); s.textContent = x ? (x.n > 99 ? '99+' : String(x.n)) : ''; }
            if (b.setAttribute) b.setAttribute('aria-label', x ? `${rot}: ${SHC.qtd(x.n, 'alerta', 'alertas')}${x.cor === 'pr' ? ', com urgente' : ''}` : rot);
        });
        const sn = $('#sinoN'), sb = $('#sino'), t = contAbas ? contAbas.total : 0;
        if (sn) { sn.hidden = !t; sn.className = 'n' + (contAbas && contAbas.urgentes ? ' pr' : ''); sn.textContent = t > 99 ? '99+' : t ? String(t) : ''; }
        if (sb) {
            const txt = !contAbas || !contAbas.lido ? 'Alertas: ainda não lidos' : t ? SHC.qtd(t, 'alerta', 'alertas') + (contAbas.urgentes ? ' (' + SHC.qtd(contAbas.urgentes, 'urgente', 'urgentes') + ')' : '') + ' · ver todos' : 'Nenhum alerta agora';
            sb.title = txt; if (sb.setAttribute) sb.setAttribute('aria-label', txt);
        }
        atualizaTodas();
    }
    // "Todas": soma os contadores das abas que ficaram fora da faixa (inteiras ou cortadas pela borda).
    function atualizaTodas() {
        const f = $('#abas'), t = $('#todasAbas');
        if (!f || !t || typeof f.getBoundingClientRect !== 'function') return;
        const r = f.getBoundingClientRect(), pa = (contAbas && contAbas.porAba) || {};
        let n = 0, pr = false;
        document.querySelectorAll('#abas button[data-a]').forEach(b => {
            const x = pa[b.dataset.a];
            if (b.hidden || !x || !b.getBoundingClientRect) return;
            const q = b.getBoundingClientRect();
            if (q.left < r.left - 1 || q.right > r.right - 20) { n += x.n; if (x.cor === 'pr') pr = true; }
        });
        const s = t.querySelector && t.querySelector('.b');
        if (s) { s.hidden = !n; s.className = 'b' + (n ? (pr ? ' pr' : ' at') : ''); s.textContent = n > 99 ? '99+' : n ? String(n) : ''; }
        t.title = n ? `Ver todas as abas (${SHC.qtd(n, 'alerta', 'alertas')} nas que estão fora da faixa)` : 'Ver todas as abas';
        if (t.setAttribute) t.setAttribute('aria-label', t.title);
    }
    function menuAbas(abrir) {
        const m = $('#menuAbas'), t = $('#todasAbas');
        if (!m || !t) return;
        m.hidden = !abrir;
        if (t.setAttribute) t.setAttribute('aria-expanded', abrir ? 'true' : 'false');
        if (abrir && m.querySelector) { const b = m.querySelector('button.on') || m.querySelector('button[data-a]'); if (b && b.focus) b.focus(); }
    }
    // Na Geral, parado e em dia: o cartão do topo já diz "✓ Atualizado às HH:MM · próxima às HH:MM" → o selo some (fica só o botão).
    function stGeral() {
        const e = SHC.statusSync(status, Date.now()).estado;
        let falhou = false; try { falhou = syncFalhou; } catch (x) { /* ainda não declarado na abertura */ }
        $('#st').classList.toggle('geral-ok', aba === 'geral' && (e === 'ok' || e === 'velho') && !falhou);
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
        document.querySelectorAll('#abas button[data-a],#menuAbas button[data-a]').forEach(b => { b.hidden = !vis.has(b.dataset.a); });
        if (!vis.has(aba)) abreAba('geral');
        desenhaContadores();
    }

    // ── Eventos ──
    $('#abas').addEventListener('click', e => {
        const b = e.target.closest('button[data-a]');
        if (b && b.dataset.a === 'ads') adsDet = null;   // tocar na aba Ads volta para a visão da conta
        if (b) abreAba(b.dataset.a);
    });
    // v3.1 topo: setas/Home/End andam pelas abas (padrão de role=tablist); a faixa rolada ou a janela mudando recontam o "Todas".
    $('#abas').addEventListener('keydown', e => {
        const k = e.key, passo = { ArrowRight: 1, ArrowLeft: -1 }[k];
        if (!passo && k !== 'Home' && k !== 'End') return;
        const bs = Array.from(document.querySelectorAll('#abas button[data-a]')).filter(b => !b.hidden), i = bs.indexOf(document.activeElement);
        if (!bs.length) return;
        const b = bs[k === 'Home' ? 0 : k === 'End' ? bs.length - 1 : (Math.max(i, 0) + passo + bs.length) % bs.length];
        e.preventDefault();
        if (b.dataset.a === 'ads') adsDet = null;
        abreAba(b.dataset.a);
        if (b.focus) b.focus();
    });
    let todasTimer = null;
    const recontaTodas = () => { clearTimeout(todasTimer); todasTimer = setTimeout(atualizaTodas, 80); };
    $('#abas').addEventListener('scroll', recontaTodas, { passive: true });
    try { addEventListener('resize', recontaTodas); } catch (e) { /* sem janela */ }
    $('#todasAbas').addEventListener('click', () => { const m = $('#menuAbas'); menuAbas(!!(m && m.hidden)); });
    $('#menuAbas').addEventListener('click', e => {
        const b = e.target && e.target.closest && e.target.closest('button[data-a]');
        if (!b) return;
        menuAbas(false);
        if (b.dataset.a === 'ads') adsDet = null;
        abreAba(b.dataset.a);
        const t = document.querySelector('#abas button.on');
        if (t && t.focus) t.focus();
    });
    // Esc fecha a grade; setas andam por ela (3 colunas); tocar fora fecha.
    $('#menuAbas').addEventListener('keydown', e => {
        if (e.key === 'Escape') { menuAbas(false); const t = $('#todasAbas'); if (t && t.focus) t.focus(); return; }
        const passo = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 3, ArrowUp: -3 }[e.key];
        if (!passo) return;
        const bs = Array.from(document.querySelectorAll('#menuAbas button[data-a]')).filter(b => !b.hidden), i = bs.indexOf(document.activeElement);
        const j = i + passo;
        if (i < 0 || j < 0 || j >= bs.length) return;
        e.preventDefault(); bs[j].focus();
    });
    $('#todasAbas').addEventListener('keydown', e => { if (e.key === 'Escape') menuAbas(false); });
    document.body.addEventListener('pointerdown', e => {
        const m = $('#menuAbas');
        if (m && !m.hidden && e.target && e.target.closest && !e.target.closest('#menuAbas,#todasAbas')) menuAbas(false);
    });
    // Sino: abre a Geral no "Precisa de você" (todas as anomalias da conta).
    $('#sino').addEventListener('click', () => {
        abreAba('geral');
        const c = $('.corpo'); if (c) c.scrollTop = 0;
        setTimeout(() => { const p = document.querySelector('#geralPrecisa') || $('#geralTopo'); if (p && p.scrollIntoView) p.scrollIntoView({ block: 'start' }); }, 60);
    });
    // Pílula da conta com 1 conta: abre o campo de apelido em Ajustes ("Dê um nome a esta conta" / mudar o nome).
    $('#nomeConta').addEventListener('click', e => { if (e.target && e.target.closest && e.target.closest('[data-ir-apelido]')) irApelido(); });
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
    // v3.1: a busca do Frete fica dentro de "Frete por anúncio" (redesenhado a cada letra; desenhaFrete devolve o foco).
    $('#listaFrete').addEventListener('input', e => { if (e.target && e.target.id === 'buscaFrete') { freteBusca = e.target.value; desenhaFrete(); } });
    $('#buscaCat').addEventListener('input', e => { catBusca = e.target.value; desenhaCatalogo(); });
    document.body.addEventListener('input', e => {
        if (!e.target || !e.target.matches || !e.target.matches('[data-radar-busca]')) return;
        radarBusca = e.target.value;
        const q = radarBusca.trim().toLowerCase();
        document.querySelectorAll('[data-radar-sku]').forEach(el => { el.hidden = !!q && el.dataset.radarSku.indexOf(q) < 0; });
    });

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
            if (k === 'geral:semanal' && aberto(k) && vr.closest('.manchete')) { const s = $('#g-semanal'); if (s && s.scrollIntoView) s.scrollIntoView({ block: 'nearest' }); }   // v3.1: "Resumo p/ WhatsApp" da manchete
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
        if (fms) { famMes = fms.dataset.famMes === 'anterior' ? 'anterior' : 'atual'; famLim = 10; famFiltro = ''; famCausas.clear(); desenhaGeral(); return; }
        const fmo = t.closest('[data-fam-modo]');
        if (fmo) { famModo = fmo.dataset.famModo === 'lucro' ? 'lucro' : 'bruto'; desenhaGeral(); return; }
        const fse = t.closest('[data-fam-sel]');
        if (fse) {
            famSel = String(fse.dataset.famSel || ''); famLim = 10; famFiltro = ''; famCausas.clear();
            const abrir = fse.dataset.famAbrir;   // linha da família no cartão fechado: abre o detalhe já nela e rola até os SKUs
            if (abrir && !aberto(abrir)) alterna(abrir);
            desenhaGeral();
            if (abrir) { const s = document.querySelector('#g-familia .fam-duas > div:last-child'); if (s && s.scrollIntoView) s.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
            return;
        }
        const ffi = t.closest('[data-fam-filtro]');   // v3.1: filtro por causa (clicar no ativo volta a "Todos")
        if (ffi) { const v = String(ffi.dataset.famFiltro || ''); famFiltro = v === famFiltro ? '' : v; famLim = 10; desenhaGeral(); return; }
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
        if (fc) {
            fullClasse = fullClasse === fc.dataset.fclasse ? '' : fc.dataset.fclasse; limite.full = LIM; desenhaFull();
            if (fullClasse) try { $('#fuProdutos').scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { /* sem rolagem: a lista filtrada está logo abaixo */ }
            return;
        }
        const mu = t.closest('[data-min-usar]');   // "Usar" a sugestão de mínimo (15 dias de venda)
        if (mu) { try { await P.gravarMinSku(mu.dataset.minUsar, SHC.num(mu.dataset.minN)); } catch (err) { falhaGravar(err); } return; }
        const ms = t.closest('[data-min-salvar]');
        if (ms) { await salvarMinSku(ms.parentElement.querySelector('[data-min-sku]')); return; }
        const af = t.closest('[data-abrir-full]');
        if (af && URL_FULL[af.dataset.abrirFull]) { chrome.tabs.create({ url: URL_FULL[af.dataset.abrirFull] }); return; }
        const fx = t.closest('[data-full-expl]');
        if (fx) { const k = fx.dataset.fullExpl; if (fullExpl.has(k)) fullExpl.delete(k); else fullExpl.add(k); desenhaFull(); return; }
        const fdi = t.closest('[data-full-dias]');   // chip "30 dias"/"Mudar para 45 dias" (valor no botão) ou o "Ver" do campo Cobrir
        if (fdi) { if (+fdi.dataset.fullDias > 0) { fullDias = +fdi.dataset.fullDias; desenhaFull(); } else mudaDias(); return; }
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
        if (erp && erp.dataset.erp === 'bling' && blingLigado) {   // Bling já conectado: "Puxar custos agora" importa aqui mesmo (só leitura)
            custosMsg = 'Importando os custos do Bling…'; desenhaCatalogo();
            let r = null;
            try { r = await chrome.runtime.sendMessage({ acao: 'sincronizar_custos', erp: 'bling' }); } catch (e) { r = null; }
            custosMsg = r && r.ok ? '✓ ' + (r.resumo || 'Custos importados') + '.' : (r && r.msg) || 'Não consegui importar agora. Tente de novo em alguns minutos.';
            desenhaCatalogo(); return;
        }
        if (erp) { if (erp.dataset.erp !== 'tiny') { abrePagina('painel.html#erp'); return; } abreAba('ajustes'); abrirTiny(); const c = $('#cardCustos'); if (c) c.open = true; if (c && c.scrollIntoView) c.scrollIntoView({ block: 'start' }); return; }
        if (t.closest('[data-sync-custos]')) {   // ERP conectado: o fundo importa de novo (só leitura) e responde o resumo
            custosMsg = 'Importando os custos do ERP…'; desenhaCatalogo();
            // Qual ERP: os que têm chave guardada (Tiny: token; Omie: appKey + appSecret; Bling: Client ID/Secret + refresh); vários → um depois
            // do outro; nenhum → o fundo responde {semToken}.
            const erps = [];
            let blingVenceu = false;
            try { if (((await SHC.lerChave(SHC.TINY_CHAVE)) || {}).token) erps.push('tiny'); } catch (e) { /* sem chave */ }
            try { const o = await SHC.lerChave(SHC.OMIE_CHAVE); if (o && o.appKey && o.appSecret) erps.push('omie'); } catch (e) { /* sem chave */ }
            try { const b = await SHC.lerChave(SHC.BLING_CHAVE || 'erp:bling'); if (b && b.clientId && b.clientSecret && b.refresh) erps.push('bling'); else blingVenceu = !!(b && b.reconectar); } catch (e) { /* sem chave */ }
            const partes = [];
            for (const erp of erps.length ? erps : [null]) {
                let r = null;
                try { r = await chrome.runtime.sendMessage(erp ? { acao: 'sincronizar_custos', erp } : { acao: 'sincronizar_custos' }); } catch (e) { r = null; }
                partes.push(r && r.ok ? '✓ ' + (r.resumo || 'Custos importados') + '.' : (r && r.semToken ? (blingVenceu ? 'Conecte o Bling de novo: a entrada venceu (30 dias sem uso).' : 'Conecte o Tiny, o Omie ou o Bling primeiro: o custo entra sozinho.') : (r && r.msg) || 'Não consegui importar agora. Tente de novo em alguns minutos.'));
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
        const kl = t.closest('[data-catler]');
        if (kl) { catalogoAgora(kl.dataset.catler); return; }   // v3.1: idem (tela "Alterar anúncio")
        const af2 = t.closest('[data-adsf]');
        if (af2) { adsFiltro = af2.dataset.adsf; desenhaAds(); return; }
        const adt = t.closest('[data-ads-det]');   // produto do Ads → detalhe de Ads do anúncio, na aba Ads (não no Frete)
        if (adt) { adsDet = adt.dataset.adsDet; if (aba !== 'ads') abreAba('ads'); else desenhaAds(); $('.corpo').scrollTop = 0; return; }
        if (t.closest('[data-voltar-ads]')) { adsDet = null; desenhaAds(); return; }
        // Frete
        if (t.closest('[data-ped-todos]')) { pedTodos = !pedTodos; desenhaFrete(); return; }
        const ff = t.closest('[data-ffiltro]');
        if (ff) { freteFiltro = freteFiltro === ff.dataset.ffiltro ? '' : ff.dataset.ffiltro; if (freteFiltro && !aberto('frete:lista')) alterna('frete:lista'); desenhaFrete(); return; }
        const fd = t.closest('[data-frete-det]');
        if (fd) {
            freteDet = fd.dataset.freteDet; confirmouMedidas = false; freteExpl = false; pedTodos = false; if (aba !== 'frete') abreAba('frete'); else desenhaFrete(); $('.corpo').scrollTop = 0;
            // v3.1: "Pedir revisão ao ML" / Ferramentas → rola até o chamado pronto, a prova de medida ou o simulador do anúncio.
            const ir = fd.dataset.freteIr && $('#' + fd.dataset.freteIr);
            if (ir && ir.scrollIntoView) ir.scrollIntoView({ block: 'start' });
            return;
        }
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
        if (e.target.matches('li.mod[data-ir-aba], .fam-v[data-fam-abrir]')) e.target.click();   // v3.1: linha da Geral e da família pelo teclado
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
    // v3.1 (ESPEC §6 Ajustes): botão de copiar o ID inteiro da conta.
    $('#listaContasAj').addEventListener('click', async e => {
        const b = e.target && e.target.closest && e.target.closest('[data-copiar-id]');
        if (!b) return;
        try { await navigator.clipboard.writeText(b.dataset.copiarId); avisa('✓ ID copiado.', 2500); } catch (x) { avisa('Não consegui copiar: selecione o ID e copie.', 5000); }
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
        if (v === 'nomes') { if (s.blur) s.blur(); irApelido(); setTimeout(desenhaConta, 120); return; }   // v3.1: "Dar nome às contas…" → apelidos em Ajustes
        vista = v === 'todas' ? 'todas' : (at && at.sellerId === v ? 'atual' : v);
        if (s.blur) s.blur(); desenhaConta();   // a pílula mostra a conta escolhida
        if (aba !== 'geral') abreAba('geral'); else desenhaGeral();
        $('.corpo').scrollTop = 0;
    });

    // ── Tiny direto aqui (tiny.js, o mesmo fluxo do painel de custos): conectado → puxa com 1 clique; sem token → passo a passo
    // com o campo do token. Só lê o custo; o token só é guardado depois que o Tiny aceitou.
    let tinyToken = '', tinyRodando = false, tinyRecusado = false, blingLigado = false;
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
        { sel: '#geralTopo', antes: aba$('geral'), titulo: 'Geral', texto: 'O mais urgente primeiro, a meta do mês e 1 linha de cada aba. Toque numa linha para abrir a aba.' },
        { sel: '#g-semanal', antes: aba$('geral'), titulo: 'Resumo da semana', texto: 'Toda segunda um texto pronto com as vendas, o lucro e o que pede atenção. Copie ou mande pelo WhatsApp para quem você quiser.' },
        { sel: '#listaFull', antes: aba$('full'), titulo: 'Full', texto: 'No topo, a remessa que chegou com diferença e o botão para reclamar no ML; depois o que enviar primeiro, a pontuação do Full no medidor e a saúde do estoque.' },
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
        { sel: '#geralFam', antes: aba$('conciliacao'), titulo: 'Faturamento por família', texto: 'Qual família de produtos puxa o faturamento do mês e qual está caindo. Toque em Ver 13 meses e os SKUs para o histórico e os produtos.' },   // v3.1: saiu da Geral (ESPEC §6)
        { sel: '#listaCanal', antes: aba$('canal'), titulo: 'Canal de transmissão', texto: 'As próximas transmissões da sua agenda e os produtos que dão lucro para programar.' },
        // v3.1: a ordem dos cartões de Ajustes (imagem tela-ajustes); Custos, Aprender e Ajuda ficam recolhidos (<details>).
        { sel: '#cardContas', antes: aba$('ajustes'), titulo: 'Sua conta', texto: 'O ID da conta e o apelido que aparece no topo. Só você vê o apelido.' },
        { sel: '#cardImposto', antes: aba$('ajustes'), titulo: 'Seus números', texto: 'Imposto, meta de margem e meta do mês entram no lucro de todas as telas.' },
        { sel: '#cardModulos', antes: aba$('ajustes'), titulo: 'Abas que aparecem', texto: 'Desligue o que você não usa: a aba some do topo, da Geral e do sino. Nada do que já foi lido é apagado.' },
        { sel: '#cardCustos', antes: aba$('ajustes'), titulo: 'Custos', texto: 'Quanto já tem custo e os jeitos rápidos de trazer do Tiny, do Omie ou do Bling.' },
        { sel: '#cardAjuda', antes: aba$('ajustes'), titulo: 'Ajuda e SellerHub', texto: 'Suporte no WhatsApp e, quando quiser, todos os seus marketplaces num painel só.' },
        { sel: '#aulaMais', antes: () => { aba$('ajustes')(); $('#cardAprender').open = true; $('#aulaMais').hidden = false; }, titulo: 'Continue a aula', texto: 'Veja também as aulas de Ads por SKU, do Fechamento e da tela de Anúncios do ML.' },
    ];
    $('#aulaGeral').addEventListener('click', () => {
        if (!globalThis.SHCTour) return;
        globalThis.SHCTour.iniciar(AULA, { aoTerminar: () => { abreAba('ajustes'); $('#cardAprender').open = true; $('#aulaMais').hidden = false; } });
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
        else if (ks.every(k => /^(fiscal|fotos|visitas|robo|medidas|cat|catcomp):/.test(k))) soSaude(ks);   // rodada lenta: 1 gravação por anúncio (cat: = família, v2.6)
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
