// SellerHub Copiloto v3.2 — CRUZAMENTO ERP × ML (Bling, Tiny, Omie). Só leitura do que já está guardado: nenhuma chamada ao ML nem ao ERP.
// Desenho: tests/copiloto/_auditoria/erp_x_ml/cruzar_v2.js (prévia em tests/copiloto/previa-erp-cruzamento/previa.html).
// Roda no fundo (background.js: depois dos custos do ERP, da lista de Anúncios e do Editor em massa) → erpx:<conta> = SHC.erpConferir(…).
// As telas (painel-lateral, painel.html) só desenham erpx:<conta> com as funções *Html daqui. Testes: tests/copiloto/teste_erp_cruzar.js.
//   erpx:<conta> = { ts, erp:'bling'|'tiny'|'omie', nome, r:SHC.erpCruzar, resumo, leitura, avisar }
(function (root) {
    'use strict';
    const SHC = root.SHC || (root.SHC = {});
    const N = s => (SHC.normalizaSku ? SHC.normalizaSku(s) : String(s || '').trim().toUpperCase());
    const un = t => { if (typeof t === 'number') return t; const m = String(t || '').replace(/\./g, '').match(/(\d+)\s*un/); return m ? +m[1] : (/sem estoque/i.test(t) ? 0 : null); };
    // Motivo do ML (restricao.id da linha) → texto simples. Outro id: o texto que o ML mostrou, como veio.
    const MOTIVO = { out_of_stock: 'Sem estoque no ML', paused: 'Pausado por você', closed_finalized: 'Finalizado', under_review: 'Em revisão pelo ML' };
    const motivoDe = l => (l.restricao && MOTIVO[l.restricao.id] ? MOTIVO[l.restricao.id]
        : l.status === 'closed' ? 'Finalizado' : l.status === 'paused' ? 'Pausado'
            : (l.restricao && l.restricao.txt) || 'Inativo no ML');
    const ehFull = a => (a.estoqueOnde || []).some(s => /fulfillment|full/i.test(s));
    SHC.ERPX_MOTIVO = MOTIVO;

    /** Produtos lidos do ERP (tiny/omie/blingPuxar) → itens do retrato erp:produtos:<erp>. paiId (id do pai no ERP) vira o SKU do pai. */
    SHC.erpNormaliza = function (produtos) {
        const ps = (produtos || []).filter(p => p && N(p.sku)), skuDoId = new Map();
        ps.forEach(p => { if (p.id) skuDoId.set(String(p.id), N(p.sku)); });
        return ps.map(p => {
            const pai = p.pai ? N(p.pai) : (p.paiId && skuDoId.get(String(p.paiId))) || '';
            const tipo = ['pai', 'variacao', 'kit'].indexOf(p.tipo) >= 0 ? p.tipo : (pai ? 'variacao' : 'simples');
            return { sku: N(p.sku), nome: String(p.titulo || p.nome || '').slice(0, 120), situacao: p.situacao === 'I' ? 'I' : 'A',
                estoque: typeof p.estoque === 'number' && isFinite(p.estoque) ? p.estoque : null, tipo, pai: tipo === 'variacao' ? pai : '',
                mlbs: Array.isArray(p.mlbs) ? p.mlbs.filter(m => m && /^MLB\d{6,14}$/.test(String(m.itemId || ''))) : [] };
        });
    };

    /** Quanto da lista de Anúncios está lido (ml:anuncios:<conta>) → { completo, mlbTotal, mlbLidos, familiasFechadas }.
     *  O total do ML conta LINHAS (família fechada = 1 linha): o que falta é o itemsQuantity de cada família menos os MLB lidos dela. */
    SHC.erpLeitura = function (snap) {
        const its = (snap && Array.isArray(snap.itens)) ? snap.itens : [], fams = (snap && Array.isArray(snap.familias)) ? snap.familias : [];
        const lidos = new Set(its.map(i => i && i.itemId).filter(Boolean)).size;
        const falta = f => Math.max(0, (+f.esperado || 0) - (Array.isArray(f.itens) ? f.itens.length : 0));
        return { completo: !!snap && snap.completo === true, mlbTotal: lidos + fams.reduce((t, f) => t + falta(f), 0), mlbLidos: lidos,
            familiasFechadas: fams.filter(f => !(+f.esperado > 0) || falta(f) > 0).length };
    };

    /** Variações lidas no Editor em massa (editor:<conta>.porItem[MLB].variacoes) → { MLB: [{variacaoId, sku, estoque, nome, full}] }. */
    SHC.erpVariacoes = function (editor) {
        const pi = (editor && editor.porItem) || {}, out = {};
        Object.keys(pi).forEach(id => {
            const vs = pi[id] && pi[id].variacoes;
            if (!Array.isArray(vs) || !vs.length) return;
            out[id] = vs.filter(Boolean).map(v => ({ variacaoId: String(v.id || ''), sku: v.sku || '', nome: v.nome || '', full: +v.estoqueFull > 0,
                estoque: +v.estoqueFull > 0 ? null : (typeof v.estoque === 'number' ? v.estoque : null) }));
        });
        return out;
    };

    /**
     * O cruzamento. o = { erp:[{sku, nome, situacao, estoque, tipo, pai, mlbs}], anuncios: ml:anuncios.itens, variacoes: SHC.erpVariacoes,
     * fullSkus:[SKU], leitura: SHC.erpLeitura } → { naoPublicado, parado, inativoErp, semErp:{semSku, skuDesconhecido, skuDiferente},
     * estoqueDif, naoConferido, aguardando, ok, totais }.
     * Trava (fail closed): "não publicado" e "parado" só com a lista de Anúncios lida inteira E as variações de todos os anúncios com variação
     * abertas — senão o SKU pode estar num MLB/variação que o Copiloto ainda não viu. Em espera, só a contagem fica (aguardando).
     */
    SHC.erpCruzar = function (o) {
        o = o || {};
        const full = new Set((o.fullSkus || []).map(N));
        // 1) ML em "unidades de venda": 1 por anúncio simples, 1 por VARIAÇÃO (quando as variações foram lidas).
        const linhas = [], naoConferido = [];
        (o.anuncios || []).forEach(a => {
            if (!a || !a.itemId) return;
            const base = { itemId: a.itemId, titulo: a.titulo || '', status: a.status, restricao: a.restricao || null, up: a.familia || '', tipoAnuncio: a.tipo || '' };
            if (a.variacoes) {
                const vs = (o.variacoes || {})[a.itemId];
                if (!vs || !vs.length) {
                    if (a.status === 'closed') return;
                    naoConferido.push({ itemId: a.itemId, titulo: a.titulo || '', estoqueTotal: un(a.estoque) });
                    // SKUs já conhecidos de outras telas (vendas, Full): casam o produto, mas sem estoque por variação e sem tirar da trava.
                    (a.skus || []).map(N).filter(Boolean).forEach(s => linhas.push(Object.assign({}, base, { variacaoId: '', sku: s, estoque: null, full: full.has(s), parcial: true })));
                    return;
                }
                vs.forEach(v => linhas.push(Object.assign({}, base, { variacaoId: v.variacaoId || '', nomeVar: v.nome || '', sku: N(v.sku), estoque: v.estoque == null ? null : +v.estoque, full: !!v.full || full.has(N(v.sku)) })));
            } else linhas.push(Object.assign({}, base, { variacaoId: '', sku: N(a.sku), estoque: un(a.estoque), full: ehFull(a) || full.has(N(a.sku)) }));
        });
        const porSku = new Map(), porId = new Map(), chave = l => l.itemId + '|' + (l.variacaoId || '') + (l.parcial ? '|' + l.sku : '');
        linhas.forEach(l => { if (l.sku) (porSku.get(l.sku) || porSku.set(l.sku, []).get(l.sku)).push(l); if (!l.parcial) { porId.set(chave(l), l); if (!l.variacaoId) porId.set(l.itemId + '|', l); } });

        const erp = (o.erp || []).filter(p => p && N(p.sku));
        const skusErp = new Set(erp.map(p => N(p.sku)));
        const out = { naoPublicado: [], parado: [], inativoErp: [], semErp: { semSku: [], skuDesconhecido: [], skuDiferente: [] }, estoqueDif: [], naoConferido, ok: 0 };
        const vistas = new Set(), linhasDe = new Map();
        // 2) Casa cada produto do ERP: primeiro pelo VÍNCULO do ERP (MLB ou id da variação), depois pelo SKU.
        erp.forEach(p => {
            if (p.tipo === 'pai') return;   // o pai não se vende: quem conta são as variações
            const k = N(p.sku), ls = [];
            (p.mlbs || []).forEach(m => {
                const l = porId.get(m.itemId + '|' + (m.variacaoId || ''));
                if (l && ls.indexOf(l) < 0) { ls.push(l); if (l.sku && l.sku !== k) out.semErp.skuDiferente.push({ itemId: l.itemId, variacaoId: l.variacaoId, titulo: l.titulo, nomeVar: l.nomeVar || '', status: l.status, skuMl: l.sku, skuErp: k }); }
            });
            (porSku.get(k) || []).forEach(l => { if (ls.indexOf(l) < 0) ls.push(l); });
            ls.forEach(l => vistas.add(chave(l)));
            linhasDe.set(k, ls);
        });
        erp.forEach(p => {
            if (p.tipo === 'pai') return;
            const k = N(p.sku), ls = linhasDe.get(k) || [], ativas = ls.filter(l => l.status === 'active');
            const it = { sku: k, nome: p.nome || '', tipo: p.tipo || 'simples', pai: p.pai ? N(p.pai) : '', estoqueErp: p.estoque == null ? null : +p.estoque };
            if (!ls.length) {
                if (p.situacao !== 'A') return;   // inativo no ERP e sem anúncio: tudo certo, não avisa
                // Variação nova de um pai que já tem anúncio: o certo é ADICIONAR a variação no anúncio, não publicar outro.
                const irmao = it.pai && erp.find(q => q !== p && q.pai && N(q.pai) === it.pai && (linhasDe.get(N(q.sku)) || []).length);
                out.naoPublicado.push(Object.assign(it, { acao: irmao ? 'adicionarVariacao' : 'publicar', noAnuncio: irmao ? linhasDe.get(N(irmao.sku))[0].itemId : '' }));
                return;
            }
            if (p.situacao === 'A' && !ativas.length) {
                const an = ls.map(l => ({ itemId: l.itemId, variacaoId: l.variacaoId, motivo: motivoDe(l), tipoAnuncio: l.tipoAnuncio }));
                out.parado.push(Object.assign(it, { anuncios: an, temNoErp: (it.estoqueErp || 0) > 0 && an.some(a => a.motivo === 'Sem estoque no ML') }));
                return;
            }
            if (p.situacao === 'I' && ativas.length) { out.inativoErp.push(Object.assign(it, { anuncios: [...new Set(ativas.map(l => l.itemId))] })); return; }
            if (p.situacao !== 'A') return;
            // Estoque: só anúncio/variação ATIVO, fora do Full, com número. Mesmo SKU em 2 MLB do mesmo UP (Clássico + Premium) = UM estoque: não soma.
            const cmp = ativas.filter(l => !l.full && l.estoque != null);
            const vals = [...new Set(cmp.map(l => l.estoque))];
            if (it.estoqueErp != null && vals.length && vals.indexOf(it.estoqueErp) < 0) out.estoqueDif.push(Object.assign(it, { estoqueMl: vals, anuncios: [...new Set(cmp.map(l => l.itemId))] }));
            else out.ok++;
        });
        // 3) ML sem par no ERP (anúncio ou variação ativo/pausado; finalizado não entra). Linha "parcial" só entra com SKU que o ERP não tem.
        const ja = new Set();
        linhas.forEach(l => {
            if (l.status === 'closed' || vistas.has(chave(l)) || ja.has(chave(l))) return;
            ja.add(chave(l));
            const x = { itemId: l.itemId, variacaoId: l.variacaoId, nomeVar: l.nomeVar || '', titulo: l.titulo, status: l.status };
            if (!l.sku) out.semErp.semSku.push(x);
            else if (!skusErp.has(l.sku)) out.semErp.skuDesconhecido.push(Object.assign(x, { sku: l.sku }));
        });
        // Ordem: dinheiro parado primeiro (mais estoque no ERP no topo).
        const porEst = (a, b) => (b.estoqueErp || 0) - (a.estoqueErp || 0);
        out.naoPublicado.sort(porEst); out.parado.sort((a, b) => (b.temNoErp - a.temNoErp) || porEst(a, b));
        // 4) Trava de leitura completa (sem a informação de leitura = não lida).
        const L = o.leitura || {}, faltam = Math.max(0, (+L.mlbTotal || 0) - (+L.mlbLidos || 0));
        out.aguardando = null;
        if (!L.completo || faltam > 0 || naoConferido.length) {
            out.aguardando = { naoPublicado: out.naoPublicado.length, parado: out.parado.length, mlbFaltando: faltam, mlbTotal: +L.mlbTotal || 0, mlbLidos: +L.mlbLidos || 0,
                familiasFechadas: +L.familiasFechadas || 0, listaIncompleta: !L.completo || faltam > 0, variacoesFaltando: naoConferido.length };
            out.naoPublicado = []; out.parado = [];
        }
        out.totais = { erp: erp.filter(p => p.tipo !== 'pai').length, unidadesMl: linhas.filter(l => !l.parcial).length, anunciosMl: new Set(linhas.map(l => l.itemId).concat(naoConferido.map(x => x.itemId))).size };
        return out;
    };

    const pl = (n, s, p) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' ' + (n === 1 ? s : p);
    const nSemErp = r => r.semErp.semSku.length + r.semErp.skuDesconhecido.length + r.semErp.skuDiferente.length;
    /** O que falta ler para soltar a trava, em 1 frase ("" sem trava). */
    SHC.erpEsperaTxt = function (ag) {
        if (!ag) return '';
        if (ag.listaIncompleta) return 'Ainda falta ler ' + (ag.mlbFaltando ? pl(ag.mlbFaltando, 'anúncio', 'anúncios') : 'parte dos anúncios') + ' do ML'
            + (ag.familiasFechadas ? ' (' + pl(ag.familiasFechadas, 'família ainda fechada', 'famílias ainda fechadas') + ')' : '');
        return 'Ainda falta ler as variações de ' + pl(ag.variacoesFaltando, 'anúncio', 'anúncios') + ': abra o Editor em massa do ML uma vez (o Copiloto só lê)';
    };
    /** Texto do aviso (pt-BR simples). nome = 'Bling' | 'Tiny' | 'Omie'. */
    SHC.erpCruzarResumo = function (r, nome) {
        const sem = nSemErp(r);
        const partes = [
            r.naoPublicado.length && pl(r.naoPublicado.length, 'produto não publicado', 'produtos não publicados'),
            r.parado.length && pl(r.parado.length, 'publicado mas parado', 'publicados mas parados'),
            r.inativoErp.length && pl(r.inativoErp.length, 'à venda mas inativo no ' + nome, 'à venda mas inativos no ' + nome),
            sem && pl(sem, 'anúncio sem par no ' + nome, 'anúncios sem par no ' + nome),
            r.estoqueDif.length && pl(r.estoqueDif.length, 'com estoque diferente', 'com estoque diferente'),
        ].filter(Boolean);
        return 'Conferi ' + pl(r.totais.erp, 'produto', 'produtos') + ' do ' + nome + ' com os seus anúncios. ' +
            (partes.length ? 'Achei: ' + partes.join(', ') + '.' : r.aguardando ? 'Por enquanto, nada fora do lugar.' : 'Está tudo batendo.') +
            (r.naoConferido.length ? ' ' + pl(r.naoConferido.length, 'anúncio com variações ainda não foi conferido', 'anúncios com variações ainda não foram conferidos') + '.' : '') +
            (r.aguardando ? ' ' + SHC.erpEsperaTxt(r.aguardando) + ': "não publicado" e "parado" aparecem quando a leitura terminar.' : '');
    };

    /** Tudo junto (o que o fundo grava em erpx:<conta>). d = { erp, nome, produtos (erp:produtos.itens), snap, editor, full, avisar }. */
    SHC.erpConferir = function (d) {
        const leitura = SHC.erpLeitura(d.snap);
        const fullSkus = (((d.full || {}).produtos) || []).map(p => p && p.sku).filter(Boolean);
        const r = SHC.erpCruzar({ erp: d.produtos, anuncios: (d.snap && d.snap.itens) || [], variacoes: SHC.erpVariacoes(d.editor), fullSkus, leitura });
        return { ts: d.agora || Date.now(), erp: d.erp, nome: d.nome, r, resumo: SHC.erpCruzarResumo(r, d.nome), leitura, avisar: !!d.avisar };
    };

    /** O Tiny lido pela TELA (painel/painel lateral): grava o retrato e pede a conferência ao fundo. avisar = 1ª importação (janela do resumo). */
    SHC.erpRetratoDaTela = async function (erp, produtos, avisar) {
        await SHC.gravarChave('erp:produtos:' + erp, { ts: Date.now(), itens: SHC.erpNormaliza(produtos) });
        try { await chrome.runtime.sendMessage({ acao: 'erp_conferir', avisar: !!avisar }); } catch (e) { /* fundo reiniciando: confere na próxima sincronização */ }
    };

    // ── Telas (só desenham erpx:<conta>). Os botões só ABREM a tela do ML: quem publica, reativa ou corrige é a seller. ──
    const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const mlbOk = id => /^MLB\d{6,14}$/.test(String(id || ''));
    SHC.ERPX_URL_ANUNCIO = id => 'https://vendedores.mercadolivre.com.br/syi/core/modify?itemId=' + encodeURIComponent(id);   // o mesmo de P.medLink
    SHC.ERPX_URL_PUBLICAR = 'https://www.mercadolivre.com.br/anunciar';   // a CONFIRMAR AO VIVO (só GET): tela de anunciar do ML
    // vendedores.* e não www.*: a leitura passiva (copiloto-ml.js) só roda em vendedores.mercadolivre.com.br/* (manifest), e foi ali que o Editor foi lido ao vivo.
    SHC.ERPX_URL_EDITOR = 'https://vendedores.mercadolivre.com.br/anuncios/editor-massivo';
    /** Os 5 grupos: chave, cor do número e os nomes (o do ERP muda: Bling, Tiny ou Omie). */
    SHC.erpxGrupos = nome => [
        { k: 'a', cor: '#B45309', rot: 'No ' + nome + ' e não publicado', curto: 'Não publicados', h: 'No ' + nome + ' e NÃO publicado no ML', p: 'Produto ativo no ' + nome + ' sem nenhum anúncio (nem variação) com esse SKU. Com estoque primeiro.' },
        { k: 'b', cor: '#B91C1C', rot: 'Publicado, mas parado', curto: 'Parados no ML', h: 'Publicado, mas PARADO no ML', p: 'Ativo no ' + nome + ', mas nenhum anúncio desse SKU está à venda. O motivo é o que o ML mostra.' },
        { k: 'c', cor: '#B91C1C', rot: 'À venda, mas inativo no ' + nome, curto: 'À venda, mas inativos no ' + nome, h: 'À venda no ML, mas INATIVO no ' + nome, p: 'O ' + nome + ' diz que o produto está inativo, mas o anúncio segue vendendo. Se parou de vender, pause no ML.' },
        { k: 'd', cor: '#475467', rot: 'No ML sem par no ' + nome, curto: 'Sem par no ' + nome, h: 'No ML sem par no ' + nome, p: 'Anúncio (ou variação) à venda ou pausado cujo SKU está vazio ou não existe no ' + nome + '. Sem o SKU certo, o custo e o estoque não se ligam.' },
        { k: 'e', cor: '#B45309', rot: 'Estoque diferente', curto: 'Estoque diferente', h: 'Estoque diferente ' + nome + ' × ML', p: 'Só anúncio à venda e fora do Full (no Full o estoque está no galpão do ML). O mesmo SKU em 2 anúncios do mesmo produto é 1 estoque só.' },
    ];
    /** Números dos 5 grupos (a e b = null enquanto a trava está fechada) + as frases curtas de cada um. */
    SHC.erpxNumeros = function (x) {
        const r = x.r, nome = x.nome, ag = r.aguardando;
        const comEst = r.naoPublicado.filter(p => p.estoqueErp > 0).length, semEstMl = r.parado.filter(p => p.temNoErp).length;
        const risco = r.estoqueDif.filter(p => p.estoqueErp === 0).length;
        return {
            a: { n: ag ? null : r.naoPublicado.length, txt: ag ? '' : comEst ? pl(comEst, 'tem', 'têm') + ' estoque no ' + nome : '' },
            b: { n: ag ? null : r.parado.length, txt: ag ? '' : semEstMl ? semEstMl + ' sem estoque no ML com estoque no ' + nome : '' },
            c: { n: r.inativoErp.length, txt: r.inativoErp.length ? 'confira se ainda vende' : '' },
            d: { n: nSemErp(r), txt: [r.semErp.semSku.length && pl(r.semErp.semSku.length, 'sem SKU', 'sem SKU'), r.semErp.skuDesconhecido.length + r.semErp.skuDiferente.length && (r.semErp.skuDesconhecido.length + r.semErp.skuDiferente.length) + ' com SKU que não bate'].filter(Boolean).join(' · ') },
            e: { n: r.estoqueDif.length, txt: risco ? pl(risco, 'com risco', 'com risco') + ' de vender sem ter' : '' },
        };
    };
    const quando = ts => { if (!ts) return ''; const d = new Date(ts), h = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        return (new Date().toDateString() === d.toDateString() ? 'hoje' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })) + ' às ' + h; };
    const total = (x, nn) => ['a', 'b', 'c', 'd', 'e'].reduce((t, k) => t + (nn[k].n || 0), 0);

    /** Cartão "Bling × ML" da aba Geral (painel lateral). Linhas com data-erpx="a…e" (abre a lista no painel). */
    SHC.erpxCartaoHtml = function (x) {
        if (!x || !x.r) return '';
        const nn = SHC.erpxNumeros(x), ag = x.r.aguardando, G = SHC.erpxGrupos(x.nome), t = total(x, nn);
        const cor = t ? 'atencao' : ag ? '' : 'ok';
        const it = (g, n, txt, ver) => `<div class="it"><span class="num" style="color:${n === null ? '#98A2B3' : g.cor}">${n === null ? '…' : n}</span><div><b>${esc(g.curto)}</b>${txt ? `<small>${esc(txt)}</small>` : ''}</div>${ver && n ? `<button class="lnk" type="button" data-erpx="${g.k}">Ver</button>` : ''}</div>`;
        const ordem = ['b', 'a', 'e', 'c', 'd'], linhas = [];
        if (ag) linhas.push(`<div class="it"><span class="num" style="color:#98A2B3">…</span><div><b>Não publicados e parados</b><small>${esc('em espera: ' + SHC.erpEsperaTxt(ag).replace(/^Ainda falta ler /, 'falta ler ') + '. Só aparecem quando tudo for lido.')}</small></div></div>`);
        ordem.forEach(k => { if (ag && (k === 'a' || k === 'b')) return; const g = G.find(y => y.k === k); linhas.push(it(g, nn[k].n, nn[k].txt || (ag ? 'já conferido' : ''), true)); });
        const lendo = ag && ag.listaIncompleta && ag.mlbTotal ? `<div class="barra-g"><i style="width:${Math.min(100, Math.round(ag.mlbLidos / ag.mlbTotal * 100))}%;background:#98A2B3"></i></div>` : '';
        const cab = ag && ag.listaIncompleta ? 'lendo os anúncios: ' + ag.mlbLidos + ' de ' + ag.mlbTotal : t ? pl(t, 'coisa para conferir', 'coisas para conferir') : 'tudo batendo';
        return `<div class="card gb" id="cardErpx"><div class="gb-l"><i class="dot ${cor}"></i><b>${esc(x.nome)} × ML</b><span class="gb-v">${esc(cab)}</span><button class="lnk" type="button" data-erpx="">Ver tudo</button></div>`
            + lendo + `<div class="gb-c">${linhas.join('')}</div>`
            + `<p class="det">Conferido ${esc(quando(x.ts))}, com a sincronização.${x.r.naoConferido.length ? ' ' + esc(pl(x.r.naoConferido.length, 'anúncio com variações ainda não conferido', 'anúncios com variações ainda não conferidos')) + '.' : ''}</p></div>`;
    };
    /** Linha em Ajustes › Custos dos produtos. */
    SHC.erpxAjustesHtml = function (x) {
        if (!x || !x.r) return '';
        const nn = SHC.erpxNumeros(x), ag = x.r.aguardando, t = total(x, nn);
        const partes = [nn.a.n && nn.a.n + ' não publicados', nn.b.n && nn.b.n + ' parados', nn.c.n && nn.c.n + ' inativos no ' + x.nome, nn.d.n && nn.d.n + ' sem par', nn.e.n && nn.e.n + ' com estoque diferente'].filter(Boolean);
        return `<div class="recnota ${t ? 'aviso' : 'neutra'}">${esc(x.nome)} × ML: ${esc(partes.length ? partes.join(', ') : 'tudo batendo')}${ag ? esc(' (não publicados e parados em espera)') : ''}. <button class="lnk" type="button" data-erpx="">Ver a conferência</button></div>`;
    };
    /** Janela logo depois de conectar o ERP (bottom sheet). Botões: data-erpx-fechar e data-erpx="" (lista completa). */
    SHC.erpxJanelaHtml = function (x) {
        if (!x || !x.r) return '';
        const nn = SHC.erpxNumeros(x), r = x.r, ag = r.aguardando, G = SHC.erpxGrupos(x.nome);
        const ex = r.naoPublicado.slice(0, 2).map(p => p.nome ? p.nome + ' (' + p.sku + ')' : p.sku);
        const det = { a: [nn.a.txt, ex.length ? 'Ex.: ' + ex.join(', ') : ''].filter(Boolean).join('. '), b: nn.b.txt, c: nn.c.txt, d: nn.d.txt, e: nn.e.txt };
        const grp = k => { const g = G.find(y => y.k === k), n = nn[k].n; return `<div class="grp"><span class="num" style="color:${n === null ? '#98A2B3' : g.cor}">${n === null ? '…' : n}</span><div><b>${esc(g.h.replace(/NÃO/, 'não').replace(/PARADO/, 'parado').replace(/INATIVO/, 'inativo'))}</b>${det[k] ? `<small>${esc(det[k])}.</small>` : n === null ? '<small>em espera até a leitura terminar.</small>' : ''}</div></div>`; };
        return `<h3>✓ ${esc(x.nome)} conectado</h3><p class="sub">${esc('Conferi ' + pl(r.totais.erp, 'produto', 'produtos') + ' do ' + x.nome + ' com ' + pl(r.totais.anunciosMl, 'anúncio', 'anúncios') + ' do Mercado Livre, variação por variação.')}</p>`
            + ['a', 'b', 'c', 'd', 'e'].map(grp).join('')
            + (ag ? `<div class="recnota neutra">${esc(SHC.erpEsperaTxt(ag) + '. "Não publicado" e "parado" aparecem quando a leitura terminar.')}</div>`
                : r.naoConferido.length ? `<div class="recnota neutra">${esc(pl(r.naoConferido.length, 'anúncio com variações ainda não foi conferido', 'anúncios com variações ainda não foram conferidos') + '.')}</div>` : '')
            + `<div class="acoes"><button class="bt leve" type="button" data-erpx-fechar>Depois</button><button class="bt verde" type="button" data-erpx="">Ver a lista completa</button></div>`;
    };

    // Seção da página de custos (painel.html): 5 botões que filtram + o grupo escolhido. filtro = 'a'…'e' ('' = o 1º com algo).
    const est = n => (n === null || n === undefined ? '<span class="est nl">não lido</span>' : `<span class="est ${n > 0 ? 'tem' : 'zero'}">${esc(n)} un.</span>`);
    const bt = (url, txt, cls) => `<a class="bt mini ${cls || ''}" href="${esc(url)}" target="_blank" rel="noopener">${esc(txt)}</a>`;
    const verAn = (id, txt, cls) => (mlbOk(id) ? bt(SHC.ERPX_URL_ANUNCIO(id), txt || 'Ver anúncio', cls) : '');
    const tagTipo = p => (p.tipo === 'kit' ? '<span class="var">Kit</span>' : p.tipo === 'variacao' ? '<span class="var">Variação</span>' : '');
    const STATUS = { active: 'ativo', paused: 'pausado', closed: 'finalizado' };
    const MAX_LINHAS = 300;   // ponytail: a tela mostra até 300 por grupo; a planilha leva todos
    function linhasGrupo(k, x) {
        const r = x.r, nome = x.nome;
        if (k === 'a') return { cab: ['Produto', 'SKU', 'Estoque no ' + nome, ''], ls: r.naoPublicado.map(p => [
            `<b>${tagTipo(p)}${esc(p.nome || p.sku)}</b><span>${esc(p.acao === 'adicionarVariacao' ? 'variação nova: falta no anúncio do pai (' + p.noAnuncio + ')' : p.tipo === 'kit' ? 'kit no ' + nome : p.pai ? 'variação de ' + p.pai : 'produto simples')}</span>`,
            esc(p.sku), est(p.estoqueErp),
            p.acao === 'adicionarVariacao' ? verAn(p.noAnuncio, 'Adicionar variação no ML', 'verde') : bt(SHC.ERPX_URL_PUBLICAR, 'Publicar no ML', p.estoqueErp > 0 ? 'verde' : 'sec')]) };
        if (k === 'b') return { cab: ['Produto', 'SKU', 'Estoque no ' + nome, 'Anúncios no ML', ''], ls: r.parado.map(p => {
            const fin = p.anuncios.every(a => a.motivo === 'Finalizado');
            return [`<b>${tagTipo(p)}${esc(p.nome || p.sku)}</b>`, esc(p.sku), est(p.estoqueErp),
                p.anuncios.slice(0, 4).map(a => `${esc(a.itemId)} <span class="mot${a.motivo === 'Finalizado' ? ' f' : /Pausado/.test(a.motivo) ? ' p' : ''}">${esc(a.motivo)}</span>`).join('<br>')
                    + (p.temNoErp ? `<span class="dica alerta">${esc('Você tem ' + p.estoqueErp + ' no ' + nome + ': ponha o estoque no ML e ele volta a vender.')}</span>` : ''),
                fin ? bt(SHC.ERPX_URL_PUBLICAR, 'Publicar de novo', 'sec') : verAn(p.anuncios[0] && p.anuncios[0].itemId)];
        }) };
        if (k === 'c') return { cab: ['Produto', 'SKU', 'Anúncio no ML', ''], ls: r.inativoErp.map(p => [`<b>${tagTipo(p)}${esc(p.nome || p.sku)}</b><span>${esc('inativo no ' + nome)}</span>`, esc(p.sku), esc(p.anuncios.join(', ')) + ' · à venda', verAn(p.anuncios[0])]) };
        if (k === 'd') {
            const tit = y => `<b>${y.nomeVar ? `<span class="var">${esc(y.nomeVar)}</span>` : ''}${esc(y.titulo || y.itemId)}</b><span>${esc(y.itemId + ' · ' + (y.variacaoId ? 'variação ' : '') + (STATUS[y.status] || y.status || ''))}</span>`;
            return { cab: ['Anúncio', 'SKU no ML', 'O que houve', ''], ls: [].concat(
                r.semErp.semSku.map(y => [tit(y), '(vazio)', 'Anúncio sem SKU', verAn(y.itemId, 'Colocar SKU')]),
                r.semErp.skuDesconhecido.map(y => [tit(y), esc(y.sku), esc('O ' + nome + ' não tem esse SKU'), verAn(y.itemId, 'Corrigir SKU')]),
                r.semErp.skuDiferente.map(y => [tit(y), esc(y.skuMl), `No ${esc(nome)} esse anúncio está ligado ao SKU <b class="sku">${esc(y.skuErp)}</b>`, verAn(y.itemId, 'Corrigir SKU')])) };
        }
        return { cab: ['Produto', 'SKU', 'No ' + nome, 'À venda no ML', ''], ls: r.estoqueDif.map(p => {
            const risco = p.estoqueErp === 0 && p.estoqueMl.some(v => v > 0);
            return [`<b>${tagTipo(p)}${esc(p.nome || p.sku)}</b><span>${esc(p.anuncios.join(', ') + (p.anuncios.length > 1 ? ' (mesmo produto: 1 estoque)' : ''))}</span>`, esc(p.sku), est(p.estoqueErp),
                `<span${risco ? ' class="risco"' : ''}>${esc(p.estoqueMl.join(' / '))} un.</span>${risco ? '<span class="dica alerta">Risco de vender o que não tem.</span>' : ''}`, verAn(p.anuncios[0])];
        }) };
    }
    SHC.erpxSecaoHtml = function (x, filtro) {
        if (!x || !x.r) return '';
        const r = x.r, nn = SHC.erpxNumeros(x), G = SHC.erpxGrupos(x.nome), ag = r.aguardando;
        const f = filtro && nn[filtro] ? filtro : (['a', 'b', 'c', 'd', 'e'].find(k => nn[k].n) || 'a');
        const g = G.find(y => y.k === f), lg = linhasGrupo(f, x), ls = lg.ls.slice(0, MAX_LINHAS);
        const res = G.map(y => `<button type="button" class="${y.k}${y.k === f ? ' on' : ''}" aria-pressed="${y.k === f}" data-erpx-f="${y.k}"><small>${esc(y.rot)}</small><b>${nn[y.k].n === null ? '…' : nn[y.k].n}</b></button>`).join('');
        const espera = ag ? `<div class="nconf"><span><b>${esc(SHC.erpEsperaTxt(ag))}.</b> ${esc('"Não publicado" e "parado" ficam em espera para não avisar errado: o produto pode estar num anúncio que o Copiloto ainda não abriu.')}</span>`
            + (ag.listaIncompleta ? '' : `<a class="bt sec mini" href="${esc(SHC.ERPX_URL_EDITOR)}" target="_blank" rel="noopener">Abrir o Editor em massa</a>`) + '<button class="bt sec mini" type="button" data-erpx-conferir>Conferir agora</button></div>'
            : r.naoConferido.length ? `<div class="nconf"><span><b>${esc(pl(r.naoConferido.length, 'anúncio com variações ainda não conferido', 'anúncios com variações ainda não conferidos'))}.</b> O ML só mostra o SKU de cada variação no Editor em massa.</span><button class="bt sec mini" type="button" data-erpx-conferir>Conferir agora</button></div>` : '';
        const corpo = nn[f].n === null ? `<p class="sub">${esc('Em espera: ' + (f === 'a' ? ag.naoPublicado : ag.parado) + ' até agora. ' + SHC.erpEsperaTxt(ag) + '.')}</p>`
            : !ls.length ? '<p class="sub">✓ Nada aqui.</p>'
                : `<table class="tabela erpx-t"><thead><tr>${lg.cab.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${ls.map(l => `<tr>${l.map((c, i) => `<td${i === 0 ? ' class="tit"' : i === l.length - 1 ? ' class="ac"' : i === 1 ? ' class="sku"' : ''}${lg.cab[i] ? ` data-r="${esc(lg.cab[i])}"` : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`
                    + (lg.ls.length > ls.length ? `<p class="mais">${esc('+ ' + (lg.ls.length - ls.length) + ' na planilha')}</p>` : '');
        return `<h2>${esc(x.nome)} × Mercado Livre</h2><p class="sub">${esc('O que está no ' + x.nome + ' e não está à venda no ML, e o contrário. Conferido ' + quando(x.ts) + ' · ' + pl(r.totais.erp, 'produto', 'produtos') + ' do ' + x.nome + ' · ' + pl(r.totais.anunciosMl, 'anúncio', 'anúncios') + '. O Copiloto só lê: cada botão abre a tela do ML para você fazer.')}</p>`
            + `<div class="res" role="group" aria-label="Filtrar a conferência">${res}</div>${espera}`
            + `<div class="grupo" id="erpx-g-${f}"><h3>${esc(g.h)} <span class="n">${nn[f].n === null ? '…' : nn[f].n}</span></h3><p>${esc(g.p)}</p>${corpo}</div>`
            + `<p class="mais"><button class="lnk" type="button" data-erpx-csv>Baixar a lista (planilha)</button></p>`;
    };
    /** Planilha (CSV ; com BOM) com os 5 grupos inteiros. */
    SHC.erpxCSV = function (x) {
        if (!x || !x.r) return '';
        // 3.2.1: a mesma regra do SHC.paraCSV (store.js) — texto que começa com = + - @ vira fórmula no Excel: apóstrofo na frente.
        const c = v => { let s = String(v === null || v === undefined ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        const r = x.r, G = SHC.erpxGrupos(x.nome), h = k => G.find(y => y.k === k).h, out = [['grupo', 'sku', 'produto', 'anuncio', 'detalhe']];
        r.naoPublicado.forEach(p => out.push([h('a'), p.sku, p.nome, p.noAnuncio, p.acao === 'adicionarVariacao' ? 'adicionar variação' : 'publicar; estoque ' + (p.estoqueErp === null ? '?' : p.estoqueErp)]));
        r.parado.forEach(p => out.push([h('b'), p.sku, p.nome, p.anuncios.map(a => a.itemId).join(' '), p.anuncios.map(a => a.motivo).join(' / ')]));
        r.inativoErp.forEach(p => out.push([h('c'), p.sku, p.nome, p.anuncios.join(' '), 'inativo no ' + x.nome]));
        r.semErp.semSku.forEach(y => out.push([h('d'), '', y.titulo, y.itemId, 'sem SKU' + (y.nomeVar ? ' (' + y.nomeVar + ')' : '')]));
        r.semErp.skuDesconhecido.forEach(y => out.push([h('d'), y.sku, y.titulo, y.itemId, 'SKU que o ' + x.nome + ' não tem']));
        r.semErp.skuDiferente.forEach(y => out.push([h('d'), y.skuMl, y.titulo, y.itemId, 'no ' + x.nome + ' ligado a ' + y.skuErp]));
        r.estoqueDif.forEach(p => out.push([h('e'), p.sku, p.nome, p.anuncios.join(' '), x.nome + ' ' + p.estoqueErp + ' × ML ' + p.estoqueMl.join('/')]));
        r.naoConferido.forEach(y => out.push(['Ainda não conferido', '', y.titulo, y.itemId, 'anúncio com variações']));
        return '﻿' + out.map(l => l.map(c).join(';')).join('\r\n');
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = SHC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
