// SellerHub Copiloto — página "Ads por SKU" (abre em aba: chrome.runtime.getURL('ads.html')).
// SÓ LÊ. Nada aqui cria, pausa ou muda campanha, orçamento ou lance: o Copiloto propõe e abre a tela do Mercado Ads;
// quem muda é o seller, com o próprio clique no Mercado Ads.
// Fontes: 'ads:<conta>' (gravado pelo fundo a partir da API do Mercado Ads, pa.mercadolivre.com.br), retrato de anúncios
// (ml:anuncios:<conta>: SKU, preço, tarifa, frete, você recebe), custos por SKU, cfg (imposto e meta) e 'fech:<conta>:<AAAA-MM>'.
// As contas ficam em funções puras (SHC.ads.*), testadas em tests/copiloto/teste_ads.js com os retratos reais.
(function (root) {
    'use strict';
    const SHC = root.SHC || (root.SHC = {});
    const A = SHC.ads = {};

    // Limiares (pontos percentuais). Mexer aqui muda a leitura da tela inteira.
    A.PERDE_MIN = 10;        // perde 10%+ das impressões por orçamento/classificação → vale falar
    A.FOLGA_MIN = 3;         // margem antes do Ads − meta abaixo disto = sem espaço para Ads
    A.FOLGA_ALTA = 15;       // a partir disto = margem alta (Crescimento, ROAS objetivo mais baixo); abaixo = Rentabilidade (ROAS mais alto)
    A.ESCALA = 0.6;          // ACOS até 60% da folga (equilíbrio − meta) = "bem abaixo"
    A.ROAS_MIN = 2; A.ROAS_MAX = 35;
    A.URL = {
        campanhas: 'https://ads.mercadolivre.com.br/product-ads/admin/campaigns',
        criar: 'https://ads.mercadolivre.com.br/publicidade/product-ads/admin/sales/campaigns/create',   // a confirmar ao vivo (host)
    };

    const pega = (o, ks) => { if (!o) return undefined; for (const k of ks) if (o[k] !== undefined && o[k] !== null) return o[k]; return undefined; };
    const n = (o, ...ks) => { const v = SHC.num(pega(o, ks)); return v === null || v === undefined ? null : v; };
    const lista = x => Array.isArray(x) ? x : (x && Array.isArray(x.results) ? x.results : (x && x.resposta ? lista(x.resposta) : []));

    // Campos-base que se somam (os nomes aceitos cobrem a resposta crua da API e o formato normalizado do fundo).
    const BASE = {
        investimento: ['cost', 'custo', 'investimento', 'gasto'],
        receita: ['totalAmount', 'amountTotal', 'receita'],
        receitaDireta: ['directAmount', 'amountDirect', 'receitaDireta'],
        receitaIndireta: ['indirectAmount', 'amountIndirect', 'receitaIndireta'],
        impressoes: ['prints', 'impressions', 'impressoes'],
        cliques: ['clicks', 'cliques'],
        vendas: ['unitsQuantity', 'soldQuantityTotal', 'vendas', 'unidades'],
        vendasDiretas: ['directUnitsQuantity', 'soldQuantityDirect', 'vendasDiretas'],
        vendasIndiretas: ['indirectUnitsQuantity', 'soldQuantityIndirect', 'vendasIndiretas'],
        organicasUn: ['organicUnitsQuantity', 'organicasUn', 'vendasOrganicas'],
        organicasValor: ['organicUnitsAmount', 'organicasValor', 'receitaOrganica'],
    };

    /**
     * Métricas de campanha, anúncio ou resumo → números + ROAS/ACOS/TACOS/CTR/CPC.
     * Usa o valor que o ML mandou quando existe; senão calcula. Sem venda, ACOS fica null (o ML manda 0, que engana).
     */
    A.metricas = function (o) {
        // resumo do fundo (SHC.adsResumo) = {total, diario}: as métricas ficam em total
        const m = (o && (o.metrics || o.metricas || o.metricsSummary || (o.summary && o.summary.metricsSummary) || (o.total && typeof o.total === 'object' ? o.total : null))) || o || {};
        const out = {};
        Object.keys(BASE).forEach(k => { out[k] = n(m, ...BASE[k]); });
        const inv = out.investimento, rec = out.receita, imp = out.impressoes, cli = out.cliques;
        if (Object.keys(BASE).every(k => out[k] === null)) return null;
        out.ctr = imp > 0 && cli !== null ? cli / imp * 100 : n(m, 'ctr');
        out.cpc = cli > 0 && inv !== null ? inv / cli : (cli === 0 ? null : n(m, 'cpc'));
        out.roas = inv > 0 ? (n(m, 'roas') ?? (rec !== null ? rec / inv : null)) : null;
        out.acos = rec > 0 ? (n(m, 'acos') ?? (inv !== null ? inv / rec * 100 : null)) : null;
        const total = (rec || 0) + (out.organicasValor || 0);
        out.tacos = total > 0 ? (n(m, 'tacos') ?? (inv !== null ? inv / total * 100 : null)) : null;
        return out;
    };
    // Soma métricas-base (para SKU e para o total sem resumo) e recalcula as razões.
    A.soma = function (lst) {
        const s = {}; let algum = false;
        Object.keys(BASE).forEach(k => { s[k] = 0; });
        lst.filter(Boolean).forEach(m => { algum = true; Object.keys(BASE).forEach(k => { s[k] = SHC.r2(s[k] + (m[k] || 0)); }); });
        return algum ? A.metricas(s) : null;
    };

    /** "Desempenho ao competir por impressões" → {ganhas, orcamento, classificacao, topo} em %. Aceita fração (0,03) ou % (3). */
    A.share = function (s) {
        if (!s || typeof s !== 'object') return null;
        const g = n(s, 'impressionShare', 'ganhas'), o = n(s, 'lostImpressionShareByBudget', 'perdidasOrcamento'),
            c = n(s, 'lostImpressionShareByAdRank', 'perdidasClassificacao'), t = n(s, 'topImpressionShare', 'topo');
        if (g === null && o === null && c === null) return null;
        const f = s.ganhas !== undefined || (g || 0) + (o || 0) + (c || 0) > 1.5 ? 1 : 100;   // formato do fundo (SHC.adsShare) já vem em %
        const p = v => v === null ? null : Math.round(v * f * 10) / 10;
        return { ganhas: p(g), orcamento: p(o), classificacao: p(c), topo: p(t) };
    };
    // semBaixarRoas: o ACOS já passa do equilíbrio → não sugerir baixar o ROAS objetivo (aumentaria o prejuízo)
    A.leituraShare = function (sh, semBaixarRoas) {
        if (!sh) return [];
        const out = [];
        if (sh.ganhas !== null) out.push(`Aparece em ${SHC.pctTxt(sh.ganhas)} das vezes em que poderia aparecer.`);
        if (sh.orcamento >= A.PERDE_MIN) out.push(`Perde ${SHC.pctTxt(sh.orcamento)} por orçamento: o orçamento acaba antes do fim do dia.`);
        if (sh.classificacao >= A.PERDE_MIN) out.push(`Perde ${SHC.pctTxt(sh.classificacao)} por classificação: o anúncio perde o leilão. Melhore preço, reputação e qualidade do anúncio${semBaixarRoas ? '' : ', ou baixe o ROAS objetivo'}.`);
        return out;
    };

    const ESTRATEGIA = { PROFITABILITY: 'Rentabilidade', GROWTH: 'Crescimento', VISIBILITY: 'Visibilidade' };   // GROWTH/VISIBILITY: a confirmar ao vivo
    A.estrategiaTxt = e => { const s = String(e || ''); return ESTRATEGIA[s.toUpperCase()] || (s ? (/^[A-Z_]+$/.test(s) ? 'Outra (' + s.toLowerCase() + ')' : s) : '—'); };
    const STATUS_CAMP = { active: 'Ativa', paused: 'Pausada', A: 'Ativa', P: 'Pausada', D: 'Pausada' };

    /** Campanhas do retrato → [{id, nome, ativa, statusTxt, estrategia, estrategiaTxt, orcamentoDia, roasObjetivo, acosObjetivo, m, share}] */
    A.campanhas = function (snap) {
        const shares = (snap && (snap.share || snap.shares)) || {};
        return lista(snap && snap.campanhas).filter(c => c && typeof c === 'object').map(c => {
            const id = String(pega(c, ['id', 'campanhaId']) ?? '');
            const st = String(pega(c, ['status']) ?? '');
            const estr = pega(c, ['strategy', 'estrategia']) || '';
            return {
                id, nome: String(pega(c, ['name', 'nome']) || 'Campanha ' + id), status: st,
                ativa: /^(active|A|ativa)$/i.test(st), statusTxt: STATUS_CAMP[st] || st || '—',
                estrategia: estr, estrategiaTxt: A.estrategiaTxt(estr),
                orcamentoDia: n(c, 'dailyBudget', 'budget', 'orcamentoDia', 'orcamentoDiario', 'orcamento'), orcamentoAuto: !!pega(c, ['automaticBudget', 'orcamentoAutomatico', 'orcamentoAuto']),
                roasObjetivo: n(c, 'roasTarget', 'roasObjetivo'), acosObjetivo: n(c, 'acosTarget', 'acosObjetivo'),
                m: A.metricas(c.metrics || c.metricas || c),
                share: A.share(c.share || shares[id] || c) || A.share(Object.values(c).find(v => v && typeof v === 'object' && !Array.isArray(v) && A.share(v))),
            };
        });
    };

    /** Anúncios patrocinados → [{id, titulo, status, campanhaId, campanhaNome, catalogo, preco, m}] */
    // fundo (SHC.adsAnuncios): catálogo vem com itemId '' e o id do produto em produtoCatalogoId
    A.anuncios = function (snap) {
        return lista(snap && snap.anuncios).filter(a => a && typeof a === 'object').map(a => {
            const camp = [a.campaign, a.campanha].find(x => x && typeof x === 'object') || {};   // no fundo, a.campanha é o nome (texto)
            const cid = String(pega(a, ['campaignId', 'campanhaId']) ?? pega(camp, ['id']) ?? '');
            return {
                id: String(pega(a, ['id', 'externalId']) || a.itemId || a.produtoCatalogoId || ''), titulo: String(pega(a, ['title', 'titulo']) || ''),
                status: String(pega(a, ['status']) || ''), campanhaId: cid === '0' ? '' : cid,
                campanhaNome: String(pega(camp, ['name', 'nome']) || (typeof a.campanha === 'string' ? a.campanha : '') || pega(a, ['campanhaNome']) || ''),
                catalogo: pega(a, ['type', 'tipo']) === 'catalog' || a.catalogo === true || a.catalogoProduto === true, preco: n(a, 'price', 'preco'),
                m: A.metricas(a.metricas || a),
            };
        }).filter(a => a.id);
    };

    /** Totais do período: resumo do ML (ou a soma das campanhas), anterior para comparar e orçamento diário das ativas. */
    A.kpis = function (snap, camps) {
        const somaCamps = A.soma(camps.map(c => c.m));
        const atual = (snap && A.metricas(snap.resumo)) || somaCamps;
        if (atual && atual.organicasUn === null && somaCamps) atual.organicasUn = somaCamps.organicasUn;
        const ant = snap && snap.anterior;
        // anterior = {resumo} | {total, campanhas:{id: métricas}} (fundo) | resumo cru
        const campsAnt = ant && ant.campanhas ? (Array.isArray(ant.campanhas) ? A.campanhas(ant).map(c => c.m) : Object.values(ant.campanhas).map(A.metricas)) : [];
        const anterior = ant ? A.metricas(ant.resumo || ant.total || ant) || A.soma(campsAnt) : null;
        const ativas = camps.filter(c => c.ativa && c.orcamentoDia > 0);
        return { atual, anterior, orcamentoDia: ativas.length ? SHC.r2(ativas.reduce((s, c) => s + c.orcamentoDia, 0)) : null, campanhasAtivas: camps.filter(c => c.ativa).length };
    };

    /**
     * Junta os anúncios patrocinados pelo SKU do retrato (MLB igual; senão título normalizado igual, só se for único no retrato).
     * O índice de títulos é montado UMA vez (1.000 × 1.000 em milissegundos). Anúncio de catálogo também tenta o título:
     * o id dele é o do produto de catálogo e nunca casa pelo MLB.
     * custoDe(itemDoRetrato) → dados do custo ou null. Margem antes do Ads = SHC.sobraAnuncio (preço de hoje, números do ML);
     * no SKU com mais de um anúncio vale a PIOR margem (conservador). ACOS de equilíbrio = essa margem.
     */
    A.porSku = function (ads, itens, custoDe, cfg, camps) {
        itens = (itens || []).filter(i => i && i.itemId);
        const porId = new Map(itens.map(i => [i.itemId, i]));
        const campPorId = new Map((camps || []).map(c => [c.id, c]));
        const norm = SHC.normalizaTitulo || (t => String(t || '').toLowerCase().trim());
        const porTitulo = new Map();   // título → itemId ('' = mais de um anúncio com esse título: não chuta)
        itens.forEach(i => { const t = norm(i.titulo); if (t) porTitulo.set(t, porTitulo.has(t) && porTitulo.get(t) !== i.itemId ? '' : i.itemId); });
        const meta = SHC.num((cfg || {}).margem_alvo_pct) || 0;
        const grupos = new Map();
        ads.forEach(ad => {
            let it = porId.get(ad.id), via = it ? 'id' : '';
            if (!it) { const id = porTitulo.get(norm(ad.titulo)); if (id) { it = porId.get(id); via = 'titulo'; } }
            const chave = it ? (it.sku ? 'sku:' + it.sku : 'mlb:' + it.itemId) : 'ad:' + ad.id;
            let g = grupos.get(chave);
            if (!g) grupos.set(chave, g = { chave, sku: (it && it.sku) || '', titulo: it ? it.titulo : ad.titulo, itens: [], ads: [], via: new Set() });
            g.ads.push(ad);
            if (it && g.itens.indexOf(it) < 0) g.itens.push(it);
            if (via) g.via.add(via);
        });
        return [...grupos.values()].map(g => {
            const m = A.soma(g.ads.map(a => a.m)) || A.metricas({ cost: 0 });
            const ss = g.itens.map(it => SHC.sobraAnuncio(it, custoDe ? custoDe(it) : null, cfg)).filter(Boolean);
            const comMargem = ss.filter(s => s.sobra !== null);
            const margem = g.itens.length && comMargem.length === ss.length && ss.length ? Math.min(...comMargem.map(s => s.pct)) : null;
            const campIds = [...new Set(g.ads.map(a => a.campanhaId).filter(Boolean))];
            const campanhas = campIds.map(id => (campPorId.get(id) || {}).nome || g.ads.find(a => a.campanhaId === id).campanhaNome || 'Campanha ' + id);
            const perdeOrc = campIds.some(id => { const c = campPorId.get(id); return c && c.share && c.share.orcamento >= A.PERDE_MIN; });
            const selos = [];
            if (!g.itens.length) selos.push('semAnuncio');
            else if (margem === null) selos.push('semCusto');
            if (m.investimento > 0 && !(m.vendas > 0)) selos.push('semVenda');
            if (margem !== null && m.investimento > 0 && (margem <= 0 || (m.acos !== null && m.acos > margem))) selos.push('acima');
            const folga = margem === null ? null : margem - meta;   // o que o Ads pode levar sem furar a meta
            if (folga > 0 && m.acos > 0 && m.acos <= folga * A.ESCALA && perdeOrc) selos.push('escalar');
            return { chave: g.chave, sku: g.sku, titulo: g.titulo, itens: g.itens, ads: g.ads, porTitulo: g.via.has('titulo') && !g.via.has('id'),
                m, margem, equilibrio: margem, campIds, campanhas, perdeOrc, selos };
        }).sort((a, b) => (b.m.investimento || 0) - (a.m.investimento || 0) || (b.m.impressoes || 0) - (a.m.impressoes || 0) || String(a.titulo).localeCompare(String(b.titulo)));
    };

    /** ROAS objetivo que ainda deixa a meta: 1 / (margem − meta), limitado a A.ROAS_MIN..A.ROAS_MAX. */
    A.roasSugerido = (margem, meta) => {
        const folga = margem - meta;
        if (!(folga > 0)) return null;
        return SHC.r2(Math.min(A.ROAS_MAX, Math.max(A.ROAS_MIN, 100 / folga)));
    };

    /**
     * Proposta de organização por SKU (NÃO executa nada): rentabilidade | crescimento | fora | semCusto | semAnuncio,
     * com a campanha atual × a sugerida, o ROAS objetivo sugerido e o motivo em português.
     */
    A.proposta = function (grupos, cfg) {
        const meta = SHC.num((cfg || {}).margem_alvo_pct) || 0, mt = SHC.pctTxt(meta);
        return grupos.map(g => {
            const atual = g.campanhas.length ? g.campanhas.join(', ') : 'Sem campanha';
            const base = { chave: g.chave, sku: g.sku, titulo: g.titulo, atual, margem: g.margem, roas: null };
            if (!g.itens.length) return Object.assign(base, { grupo: 'semAnuncio', motivo: 'Não achamos este anúncio na sua lista de Anúncios lida pelo Copiloto (anúncio de catálogo ou de outra página). Sincronize a lista de Anúncios.' });
            if (g.margem === null) return Object.assign(base, { grupo: 'semCusto', motivo: 'Informe o custo deste produto para o Copiloto sugerir.' });
            const mg = SHC.pctTxt(g.margem), folga = g.margem - meta;
            if (g.margem <= 0) return Object.assign(base, { grupo: 'fora', motivo: `Dá prejuízo antes do Ads (${mg}). Anunciar só aumenta o prejuízo.` });
            if (folga < A.FOLGA_MIN) return Object.assign(base, { grupo: 'fora', motivo: `Sobram ${mg} antes do Ads e sua meta é ${mt}: não sobra espaço para pagar Ads sem ficar abaixo da meta.` });
            const roas = A.roasSugerido(g.margem, meta), ft = SHC.pctTxt(folga);
            // No Mercado Ads, Rentabilidade = ROAS objetivo alto (folga média); Crescimento = ROAS mais baixo (folga alta). A confirmar com o dono.
            return Object.assign(base, { grupo: folga >= A.FOLGA_ALTA ? 'crescimento' : 'rentabilidade', roas,
                motivo: `Sobram ${mg} antes do Ads. Para manter sua meta de ${mt}, o Ads pode levar até ${ft} da venda: ROAS objetivo de pelo menos ${A.xTxt(roas)}.` });
        });
    };
    A.NOME_GRUPO = { rentabilidade: 'Rentabilidade', crescimento: 'Crescimento', fora: 'Fora do Ads', semCusto: 'Falta o custo', semAnuncio: 'Sem ligação com seus anúncios' };

    /** Leitura de cada campanha: impressões perdidas + ACOS × equilíbrio dos produtos dela + orçamento sugerido (só texto). */
    A.leituraCampanha = function (c, grupos, cfg) {
        const meta = SHC.num((cfg || {}).margem_alvo_pct) || 0;
        // Equilíbrio da campanha = margem dos SKUs dela, pesada pela receita de Ads de cada um.
        let peso = 0, soma = 0;
        grupos.forEach(g => {
            if (g.margem === null) return;
            const rec = g.ads.filter(a => a.campanhaId === c.id).reduce((s, a) => s + ((a.m && a.m.receita) || 0), 0);
            if (rec > 0) { peso += rec; soma += rec * g.margem; }
        });
        const eq = peso > 0 ? soma / peso : null, acos = c.m && c.m.acos;
        const out = A.leituraShare(c.share, eq !== null && acos !== null && acos > eq);
        if (eq !== null && acos !== null) {
            if (acos > eq) out.push(`ACOS de ${SHC.pctTxt(acos)} acima do equilíbrio dos produtos (${SHC.pctTxt(eq)}): o Ads come mais que a sobra. Suba o ROAS objetivo ou tire os produtos marcados.`);
            else if (acos > eq - meta) out.push(`ACOS de ${SHC.pctTxt(acos)} abaixo do equilíbrio (${SHC.pctTxt(eq)}): dá lucro, mas fica abaixo da sua meta de ${SHC.pctTxt(meta)}. Não aumente o orçamento; suba um pouco o ROAS objetivo.`);
            else if (acos <= (eq - meta) * A.ESCALA && c.share && c.share.orcamento >= A.PERDE_MIN && c.orcamentoDia > 0)
                out.push(`ACOS de ${SHC.pctTxt(acos)} bem abaixo do equilíbrio (${SHC.pctTxt(eq)}) mesmo com a sua meta, e perdendo por orçamento: dá para testar orçamento de ${SHC.moeda(c.orcamentoDia)} para ${SHC.moeda(SHC.r2(c.orcamentoDia * 1.25))} por dia e conferir em 7 dias.`);
        } else if (c.m && c.m.investimento > 0 && !(c.m.vendas > 0)) out.push('Gastou sem nenhuma venda no período.');
        return { linhas: out, equilibrio: eq };
    };

    /** Modelos de Ads que a conta usa e o que o Copiloto acompanha de cada um. fechs = [{mes, porTipo}] (Faturamento). */
    A.modelos = function (camps, fechs) {
        const out = [];
        const porEstr = {};
        camps.forEach(c => { porEstr[c.estrategiaTxt] = (porEstr[c.estrategiaTxt] || 0) + 1; });
        const fat = k => (fechs || []).filter(f => f && f.porTipo && Math.abs(SHC.num(f.porTipo[k]) || 0) > 0).map(f => ({ mes: f.mes, valor: Math.abs(SHC.num(f.porTipo[k])) }));
        const pa = fat('ads'), seg = fat('ads_seguidores');
        if (camps.length || pa.length) out.push({
            nome: 'Product Ads (Aumentar suas vendas)',
            detalhe: (camps.length ? SHC.qtd(camps.length, 'campanha', 'campanhas') + ': ' + Object.keys(porEstr).map(k => porEstr[k] + ' em ' + k).join(', ') + '.' : 'Nenhuma campanha lida no Mercado Ads.')
                + pa.map(x => ` No Faturamento de ${x.mes}: ${SHC.moeda(x.valor)}.`).join(''),
            acompanha: 'Investimento, receita, ROAS, ACOS, TACOS, impressões perdidas, resultado por SKU e ponto de equilíbrio.',
        });
        if (seg.length) out.push({
            nome: 'Publicidade de Seguidores (Aumentar os seguidores)',
            detalhe: seg.map(x => `No Faturamento de ${x.mes}: ${SHC.moeda(x.valor)}.`).join(' '),
            acompanha: 'Só o gasto, que vem do Faturamento. O resultado (seguidores) fica no Mercado Ads.',
        });
        return out;
    };

    /** Estado da tela: 'vazio' (sincronize), 'sincronizando', 'semAds' ou 'ok'. "sincronizando" sem batimento há 5 min = abandonado. */
    A.estado = function (snap, st, agora) {
        const rodando = !!(st && st.estado === 'sincronizando' && (agora || Date.now()) - (st.batimento || st.inicio || 0) < 5 * 60e3);
        if (!snap) return rodando ? 'sincronizando' : 'vazio';
        if (snap.temAds === false) return 'semAds';
        return 'ok';
    };

    /** Tudo o que a tela mostra, a partir dos dados guardados. */
    A.analisa = function (snap, itens, custoDe, cfg, fechs) {
        const camps = A.campanhas(snap), ads = A.anuncios(snap);
        const grupos = A.porSku(ads, itens, custoDe, cfg, camps);
        camps.forEach(c => { c.leitura = A.leituraCampanha(c, grupos, cfg); });
        return { camps, ads, grupos, kpis: A.kpis(snap, camps), proposta: A.proposta(grupos, cfg), modelos: A.modelos(camps, fechs) };
    };

    // ── Texto e HTML (strings; todo texto externo passa por esc) ──
    const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    A.esc = esc;
    A.xTxt = v => v === null || v === undefined || !isFinite(v) ? '—' : (Math.round(v * 100) / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + 'x';
    const int = v => v === null || v === undefined ? '—' : Math.round(v).toLocaleString('pt-BR');
    const pct = v => v === null || v === undefined || !isFinite(v) ? '—' : SHC.pctTxt(v);
    const rs = v => v === null || v === undefined ? '—' : SHC.moeda(v);
    const dataBR = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? m[3] + '/' + m[2] : ''; };

    A.SIGLAS = {
        investimento: 'Quanto você gastou com anúncios no período.',
        receita: 'Vendas que o Mercado Livre atribui aos seus anúncios.',
        roas: 'ROAS: quantos reais de venda voltam para cada R$ 1 gasto em anúncios.',
        acos: 'ACOS: quanto das vendas pelos anúncios foi gasto com o anúncio.',
        tacos: 'TACOS: gasto com anúncios dividido por TODAS as suas vendas (anúncios + orgânicas).',
        orcamento: 'Soma do orçamento diário das campanhas ativas.',
        impressoes: 'Quantas vezes seus anúncios apareceram.',
        cliques: 'Quantas vezes clicaram nos seus anúncios.',
        ctr: 'CTR: de cada 100 pessoas que viram o anúncio, quantas clicaram.',
        cpc: 'CPC: quanto você pagou, em média, por clique.',
        atribuidas: 'Diretas: compraram o produto do anúncio. Indiretas: compraram outro produto seu depois do clique.',
        organicas: 'Vendas que não vieram de clique em anúncio.',
        equilibrio: 'ACOS de equilíbrio: o máximo que o Ads pode levar da venda antes de dar prejuízo (= sobra antes do Ads).',
    };
    const KPI = [
        ['investimento', 'Investimento', m => rs(m.investimento)],
        ['receita', 'Receita', m => rs(m.receita)],
        ['roas', 'ROAS', m => A.xTxt(m.roas)],
        ['acos', 'ACOS', m => pct(m.acos)],
        ['tacos', 'TACOS', m => pct(m.tacos)],
        ['impressoes', 'Impressões', m => int(m.impressoes)],
        ['cliques', 'Cliques', m => int(m.cliques)],
        ['ctr', 'CTR', m => pct(m.ctr)],
        ['cpc', 'CPC', m => rs(m.cpc === null ? null : SHC.r2(m.cpc))],
        ['atribuidas', 'Vendas pelos anúncios', m => m.vendas === null ? '—' : int(m.vendas) + (m.vendasDiretas !== null ? ` <small>(${int(m.vendasDiretas)} diretas · ${int(m.vendasIndiretas || 0)} indiretas)</small>` : '')],
        ['organicas', 'Vendas orgânicas', m => (m.organicasUn !== null ? int(m.organicasUn) + ' un. · ' : '') + rs(m.organicasValor)],
    ];

    A.htmlKpis = function (k) {
        const a = k.atual, b = k.anterior;
        if (!a) return '<p class="sub">Sem totais do período.</p>';
        const cel = (id, nome, valor, antes) => `<div class="kpi"><span class="kn">${esc(nome)}</span><b>${valor}</b>${antes !== null ? `<span class="ka">30 dias antes: ${antes}</span>` : ''}<span class="kx">${esc(A.SIGLAS[id])}</span></div>`;
        return '<div class="kpis">' + KPI.map(([id, nome, f]) => cel(id, nome, f(a), b ? f(b) : null)).join('')
            + cel('orcamento', 'Orçamento diário total', rs(k.orcamentoDia) + (k.campanhasAtivas ? ` <small>(${SHC.qtd(k.campanhasAtivas, 'ativa', 'ativas')})</small>` : ''), null) + '</div>';
    };

    A.htmlBarra = function (sh) {
        if (!sh) return '<small class="sub">Sem dado de impressões perdidas.</small>';
        const w = v => Math.max(0, Math.min(100, v || 0));
        return `<div class="barra-sh" role="img" aria-label="Ganhas ${pct(sh.ganhas)}, perdidas por orçamento ${pct(sh.orcamento)}, perdidas por classificação ${pct(sh.classificacao)}">`
            + `<i class="g" style="width:${w(sh.ganhas)}%"></i><i class="o" style="width:${w(sh.orcamento)}%"></i><i class="c" style="width:${w(sh.classificacao)}%"></i></div>`
            + `<small class="leg-sh"><span class="g">ganhas ${pct(sh.ganhas)}</span> · <span class="o">orçamento ${pct(sh.orcamento)}</span> · <span class="c">classificação ${pct(sh.classificacao)}</span></small>`;
    };

    A.htmlCampanhas = function (camps) {
        if (!camps.length) return '<p class="sub">Nenhuma campanha no período.</p>';
        return '<div class="rola"><table class="tabela"><thead><tr><th>Campanha</th><th>Estratégia</th><th>Orçamento/dia</th><th>ROAS objetivo</th><th>ROAS</th><th>ACOS</th><th>TACOS</th><th>CTR</th><th>Cliques</th><th>Impressões</th><th>Investimento</th><th>Receita</th><th>Competindo por impressões</th></tr></thead><tbody>'
            + camps.map(c => {
                const m = c.m || {};
                return `<tr><td class="tit"><b>${esc(c.nome)}</b><span>${esc(c.statusTxt)}</span></td><td>${esc(c.estrategiaTxt)}</td><td>${rs(c.orcamentoDia)}${c.orcamentoAuto ? ' <small>(automático)</small>' : ''}</td>`
                    + `<td>${A.xTxt(c.roasObjetivo)}</td><td>${A.xTxt(m.roas)}</td><td>${pct(m.acos)}</td><td>${pct(m.tacos)}</td><td>${pct(m.ctr)}</td><td>${int(m.cliques)}</td><td>${int(m.impressoes)}</td>`
                    + `<td>${rs(m.investimento)}</td><td>${rs(m.receita)}</td><td class="sh">${A.htmlBarra(c.share)}</td></tr>`
                    + (c.leitura && c.leitura.linhas.length ? `<tr class="leit"><td colspan="13">${c.leitura.linhas.map(t => '• ' + esc(t)).join('<br>')}</td></tr>` : '');
            }).join('') + '</tbody></table></div>';
    };

    A.SELO = {
        acima: ['ruim', 'Acima do equilíbrio'], escalar: ['bom', 'Dá para escalar'], semVenda: ['ruim', 'Sem venda com gasto'],
        semCusto: ['neutro', 'Sem custo'], semAnuncio: ['neutro', 'Sem ligação com seus anúncios'],
    };
    A.FILTROS = [['todos', 'Todos'], ['acima', 'Acima do equilíbrio'], ['escalar', 'Dá para escalar'], ['semVenda', 'Sem venda com gasto'], ['semCusto', 'Sem custo']];

    A.htmlSkus = function (grupos, filtro) {
        const ativos = grupos.filter(g => g.m.impressoes > 0 || g.m.investimento > 0);
        const conta = id => ativos.filter(g => g.selos.indexOf(id) >= 0).length;
        const vis = !filtro || filtro === 'todos' ? ativos : ativos.filter(g => g.selos.indexOf(filtro) >= 0);
        let html = '<div class="chips">' + A.FILTROS.map(([id, nome]) => `<button data-filtro="${id}" class="${(filtro || 'todos') === id ? 'on' : ''}">${esc(nome)}${id === 'todos' ? '' : ' (' + conta(id) + ')'}</button>`).join('') + '</div>';
        if (!vis.length) return html + `<p class="sub">${ativos.length ? 'Nenhum produto neste filtro.' : 'Nenhum anúncio com impressões no período.'}</p>`;
        html += '<div class="rola"><table class="tabela"><thead><tr><th>Produto</th><th>Impressões</th><th>Cliques</th><th>CTR</th><th>CPC</th><th>Investimento</th><th>Receita</th><th>Vendas</th><th>ROAS</th><th>ACOS</th><th>Sobra antes do Ads</th><th>ACOS de equilíbrio</th></tr></thead><tbody>'
            + vis.map(g => {
                const m = g.m;
                const id = g.sku || (g.itens[0] ? g.itens[0].itemId + ' (sem SKU)' : g.ads[0].id);
                const selos = g.selos.map(s => `<span class="selo ${A.SELO[s][0]}">${esc(A.SELO[s][1])}</span>`).join('');
                const acao = g.selos.indexOf('semCusto') >= 0 ? ' <button class="lnk" data-custos>informar custo</button>' : '';
                return `<tr><td class="tit"><b title="${esc(g.titulo)}">${esc(g.titulo)}</b><span>${esc(id)}${g.campanhas.length ? ' · ' + esc(g.campanhas.join(', ')) : ''}${g.porTitulo ? ' · ligado pelo título' : ''}</span>${selos}${acao}</td>`
                    + `<td>${int(m.impressoes)}</td><td>${int(m.cliques)}</td><td>${pct(m.ctr)}</td><td>${rs(m.cpc === null ? null : SHC.r2(m.cpc))}</td><td>${rs(m.investimento)}</td><td>${rs(m.receita)}</td>`
                    + `<td>${int(m.vendas)}</td><td>${A.xTxt(m.roas)}</td><td>${pct(m.acos)}</td><td>${pct(g.margem)}</td><td>${g.margem === null ? '—' : (g.margem <= 0 ? 'sem espaço' : pct(g.equilibrio))}</td></tr>`;
            }).join('') + '</tbody></table></div>';
        const parados = grupos.length - ativos.length;
        return html + (parados ? `<p class="sub">${SHC.qtd(parados, 'produto sem impressões no período fica', 'produtos sem impressões no período ficam')} fora desta tabela (aparecem na proposta abaixo).</p>` : '');
    };

    A.htmlProposta = function (prop) {
        const ordem = ['crescimento', 'rentabilidade', 'fora', 'semCusto', 'semAnuncio'];
        const DESC = {
            rentabilidade: 'Margem média: campanha de Rentabilidade, com ROAS objetivo mais alto para não passar da sua meta.',
            crescimento: 'Margem alta: campanha de Crescimento, com ROAS objetivo mais baixo. Dá para buscar mais vendas e ainda ficar na meta.',
            fora: 'Prejuízo ou sem margem para pagar Ads: melhor deixar fora das campanhas até o preço ou o custo mudar.',
            semCusto: 'Sem o custo não dá para saber o equilíbrio.', semAnuncio: 'Não deu para ligar ao seu SKU.',
        };
        return ordem.map(gr => {
            const l = prop.filter(p => p.grupo === gr);
            if (!l.length) return '';
            return `<div class="grp"><h3>${esc(A.NOME_GRUPO[gr])} <small>(${l.length})</small></h3><p class="sub">${esc(DESC[gr])}</p>`
                + '<div class="rola"><table class="tabela"><thead><tr><th>Produto</th><th>Campanha hoje</th><th>Sugerida</th><th>ROAS objetivo</th><th>Por quê</th></tr></thead><tbody>'
                + l.slice(0, 30).map(p => `<tr><td class="tit"><b title="${esc(p.titulo)}">${esc(p.titulo)}</b><span>${esc(p.sku || 'sem SKU')}</span></td><td>${esc(p.atual)}</td><td>${esc(A.NOME_GRUPO[p.grupo])}</td><td>${p.roas ? 'pelo menos ' + A.xTxt(p.roas) : '—'}</td><td class="mot">${esc(p.motivo)}</td></tr>`).join('')
                + '</tbody></table></div>' + (l.length > 30 ? `<p class="sub">e mais ${l.length - 30}.</p>` : '') + '</div>';
        }).join('');
    };

    A.htmlModelos = function (mods) {
        const lst = mods.map(x => `<div class="mod"><b>${esc(x.nome)}</b><p>${esc(x.detalhe)}</p><small>O Copiloto acompanha: ${esc(x.acompanha)}</small></div>`).join('');
        return (lst || '<p class="sub">Nenhum modelo de Ads com gasto lido.</p>')
            + '<p class="sub">Se a sua conta usa outros modelos (Brand Ads, Display), o Copiloto ainda não lê: confira no Mercado Ads.</p>';
    };

    /** Selo da sincronização + botão "Sincronizar agora" e, embaixo e menor, quando os números foram lidos. */
    A.htmlSyncCaixa = function (st, agora, rodando, lidos) {
        const botao = `<button class="bt" data-sync${rodando ? ' disabled' : ''}>${rodando ? 'Sincronizando…' : 'Sincronizar agora'}</button>`;
        return `<div class="sync-caixa"><div class="sync-topo">${SHC.htmlSync(st, agora)}${botao}</div>${lidos ? `<small class="sync-lido">${esc(lidos)}</small>` : ''}</div>`;
    };

    /** Página inteira (string). d = {snap, st, agora, an (A.analisa), filtro, conta} */
    A.htmlPagina = function (d) {
        const est = A.estado(d.snap, d.st, d.agora), rodando = est === 'sincronizando' || SHC.statusSync(d.st, d.agora).estado === 'sincronizando';
        const etapa = SHC.htmlEtapa(d.st, ['ads'], d.agora);
        const caixa = lidos => A.htmlSyncCaixa(d.st, d.agora, rodando, lidos);
        if (est === 'vazio' || est === 'sincronizando')
            return `<section class="card vazio" id="a-periodo"><h2>${etapa ? 'Lendo as suas campanhas' : 'Sincronize para ver'}</h2><p class="sub">O Copiloto lê as suas campanhas no Mercado Ads com a sessão do Mercado Livre aberta neste Chrome. Leva alguns minutos.</p>${etapa}${caixa('')}${d.st && d.st.erroAds && !etapa ? '<p class="msg erro">A última leitura do Mercado Ads falhou. Abra o Mercado Livre, confira se está logado e tente de novo.</p>' : ''}</section>`;
        if (est === 'semAds')
            return `<section class="card vazio" id="a-periodo"><h2>Sua conta não tem campanhas no Mercado Ads</h2><p class="sub">Quando você criar uma, o Copiloto mostra aqui o resultado por SKU.</p><a class="bt sec" href="${A.URL.criar}" target="_blank" rel="noopener">Abrir no Mercado Ads</a> ${caixa('')}</section>`;
        const an = d.an, p = d.snap.periodo || {};
        const de = dataBR(p.de || p.dateFrom || p.inicio), ate = dataBR(p.ate || p.dateTo || p.fim);
        const quando = d.snap.ts ? new Date(d.snap.ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
        return `<section class="card" id="a-periodo"><div class="cab"><div><h2>Últimos 30 dias${de && ate ? ` <small>(${de} a ${ate})</small>` : ''}</h2><p class="sub">Números do Mercado Ads. A comparação é com os 30 dias anteriores.</p></div>${caixa(quando ? 'Mercado Ads lido em ' + quando : '')}</div>`
            + (etapa || (d.st && d.st.erroAds ? '<p class="aviso">A última leitura do Mercado Ads falhou: os números abaixo são da leitura anterior.</p>' : ''))
            + A.htmlKpis(an.kpis) + '</section>'
            + `<section class="card" id="a-campanhas"><h2>Campanhas</h2><p class="sub">"Competindo por impressões": das vezes em que o anúncio poderia aparecer, quantas ele ganhou e por que perdeu as outras.</p>${A.htmlCampanhas(an.camps)}</section>`
            + `<section class="card" id="a-sku"><h2>Por produto (SKU)</h2><p class="sub">${esc(A.SIGLAS.equilibrio)} Sobra no preço de hoje, com a tarifa e o frete do ML, o seu custo e o seu imposto.</p>${A.htmlSkus(an.grupos, d.filtro)}</section>`
            + `<section class="card" id="a-proposta"><h2>Proposta de organização por SKU</h2><p class="sub"><b>O Copiloto não muda nada nas suas campanhas.</b> Você faz a mudança no Mercado Ads.</p>`
            + `<div class="acoes"><a class="bt" href="${A.URL.campanhas}" target="_blank" rel="noopener">Abrir no Mercado Ads</a><a class="bt sec" href="${A.URL.criar}" target="_blank" rel="noopener">Criar campanha no Mercado Ads</a></div>${A.htmlProposta(an.proposta)}</section>`
            + `<section class="card" id="a-modelos"><h2>Modelos de Ads da conta</h2>${A.htmlModelos(an.modelos)}</section>`
            + '<p class="fonte">Fonte: Mercado Ads e lista de Anúncios do Mercado Livre (lidas neste Chrome) · custo e imposto = seus. Sobra e equilíbrio são estimativas no preço de hoje.</p>';
    };

    // Aula guiada (tour.js): um balão por parte da tela. Alvo que não está na tela é pulado.
    A.AULA = [
        { sel: '#a-periodo', titulo: 'Números do período', texto: 'Quanto você gastou em Ads nos últimos 30 dias e quanto vendeu com eles. Embaixo de cada número: o mesmo número 30 dias antes.' },
        { sel: '#a-campanhas', titulo: 'Suas campanhas', texto: 'Cada campanha com orçamento, ROAS e ACOS. Embaixo, o que o Copiloto viu nela.' },
        { sel: '.barra-sh', titulo: 'Impressões perdidas', texto: 'Verde: vezes em que o anúncio apareceu. Amarelo: perdeu porque o orçamento acabou. Cinza: perdeu o leilão.' },
        { sel: '#a-sku', titulo: 'Por produto e equilíbrio', texto: 'O resultado de cada SKU. "ACOS de equilíbrio" é o máximo que o Ads pode levar da venda sem dar prejuízo.' },
        { sel: '#a-proposta', titulo: 'Proposta de organização', texto: 'Em que campanha cada produto ficaria melhor e com qual ROAS objetivo. Quem muda é você, no Mercado Ads.' },
        { sel: '#a-modelos', titulo: 'Modelos de Ads', texto: 'Os tipos de Ads que a sua conta usa e o que o Copiloto acompanha em cada um.' },
    ];

    // ── Na página (navegador) ──
    function iniciar() {
        try { SHC.salvarGuia({ feitos: { ads: SHC.hoje() } }).catch(() => {}); } catch (e) { /* guia: página aberta */ }
        const app = document.getElementById('app');
        let filtro = 'todos', conta = null, pendente = null, soStatus = true, ultimo = null, querAula = location.hash === '#aula';
        const aula = () => { if (root.SHCTour) root.SHCTour.iniciar(A.AULA); };
        const btAula = document.getElementById('verAula');
        if (btAula) btAula.addEventListener('click', aula);
        if (querAula) history.replaceState(null, '', location.pathname);
        // Redesenha com o que já foi lido e calculado (clique no filtro, gravação só do status): não relê nem recalcula.
        const pinta = soSync => { const h = A.htmlPagina(Object.assign({}, ultimo, { agora: Date.now(), filtro, conta })); if (soSync) SHC.trocarSoSync(app, h); else app.innerHTML = h; };
        const mesAnt = (mes, k) => { const d = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1 - k, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
        async function desenha() {
            try {
                conta = await SHC.contaAtual();
                const hoje = SHC.hoje().slice(0, 7), meses = [mesAnt(hoje, 1), hoje];
                const r = await chrome.storage.local.get(['ads:' + conta, 'shc:status'].concat(meses.map(m => 'fech:' + conta + ':' + m)));
                const snap = r['ads:' + conta] || null, st = r['shc:status'] || {};
                const itens = ((await SHC.lerAnuncios(conta)) || {}).itens || [];
                const cfg = await SHC.lerCfg();
                const custos = await SHC.custosDe(itens);
                const custoDe = it => { const c = custos.get(it); return c ? c.dados : null; };
                const fechs = meses.map(m => Object.assign({ mes: m.slice(5) + '/' + m.slice(0, 4) }, r['fech:' + conta + ':' + m] || {}));
                const an = snap && snap.temAds !== false ? A.analisa(snap, itens, custoDe, cfg, fechs) : null;
                ultimo = { snap, st, an };
                pinta();
                if (querAula) { querAula = false; aula(); }
            } catch (e) {
                app.innerHTML = '<section class="card"><p class="msg erro">Não deu para montar a página: ' + esc((e && e.message) || e) + '</p></section>';
            }
        }
        app.addEventListener('click', ev => {
            const b = ev.target.closest('button');
            if (!b) return;
            if (b.hasAttribute('data-filtro')) { filtro = b.getAttribute('data-filtro'); if (ultimo) pinta(); else desenha(); }
            else if (b.hasAttribute('data-custos')) chrome.runtime.openOptionsPage();
            else if (b.hasAttribute('data-sync')) {
                b.disabled = true; b.textContent = 'Sincronizando…';
                chrome.runtime.sendMessage({ acao: 'sincronizar' }).catch(() => {}).then(desenha);
            }
        });
        // Sincronização gravou algo novo: redesenha (juntando rajadas de gravação).
        chrome.storage.onChanged.addListener((mud, area) => {
            if (area !== 'local') return;
            const ks = Object.keys(mud);
            if (!ks.some(k => k === 'shc:status' || k === 'cfg' || k === 'ml:conta' || /^(ads:|fech:|ml:anuncios:|c\|)/.test(k))) return;
            if (ks.some(k => k !== 'shc:status')) soStatus = false;
            clearTimeout(pendente);
            pendente = setTimeout(async () => {
                const leve = soStatus && ultimo; soStatus = true;
                if (!leve) return desenha();
                try { ultimo.st = (await chrome.storage.local.get('shc:status'))['shc:status'] || {}; pinta(true); } catch (e) { desenha(); }
            }, 400);
        });
        desenha();
    }

    if (typeof module !== 'undefined' && module.exports) module.exports = A;
    else if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', iniciar);
})(typeof globalThis !== 'undefined' ? globalThis : this);
