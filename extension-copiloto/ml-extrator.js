// SellerHub Copiloto — leitor dos dados que o PRÓPRIO Mercado Livre põe na página do vendedor.
// Mapeado ao vivo em 24/09/2026 (painel logado, vendedores.mercadolivre.com.br):
//   • o painel é renderizado no servidor e embute o estado em  _n.ctx.r = {...}  (script
//     #__NORDIC_RENDERING_CTX__). O código MLB NÃO aparece no texto da tela — só aqui.
//   • Central de promoções (/anuncios/lista/promos?page=N, 25 famílias por página):
//       família (card)  → { id:"#<número>", title, price, extraInfo, info, shippingInfo, pictures }
//       proposta        → { type, totalCharges:{ detail:{ costs:[price, sale_fee, shipping], summary:"Você recebe" } }, itemId:"MLB…" }
//       caixa da promo  → { columns:[ [nome, datas], [desconto sugerido], [preço], [totalCharges], … ] }
//   • Detalhe da venda (/vendas/<id>/detalhe): response["account_rows-CHARGES"|"account_rows-SHIPMENT"].
// Funções puras (sem chrome.*): rodam no service worker, no content script e em teste (node).
(function (root) {
    'use strict';
    const SHC = root.SHC || (root.SHC = {});

    // Recorta o objeto  _n.ctx.r = {...}  do HTML casando chaves e respeitando strings.
    // (O script tem mais coisa depois — p.ex. "new Set(...)" — que não é JSON.)
    SHC.mlExtraiEstado = function (html) {
        const i = html.indexOf('_n.ctx.r=');
        if (i < 0) return null;
        const p = html.indexOf('{', i);
        if (p < 0) return null;
        let prof = 0, str = false, esc = false;
        for (let j = p; j < html.length; j++) {
            const c = html[j];
            if (str) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') str = false; continue; }
            if (c === '"') str = true;
            else if (c === '{') prof++;
            else if (c === '}') { prof--; if (prof === 0) { try { return JSON.parse(html.slice(p, j + 1)); } catch (e) { return null; } } }
        }
        return null;
    };

    const dinheiro = v => { const n = SHC.num(v); return n === null ? null : Math.abs(n); };

    // Todos os textos visíveis de um bloco (primaryText.content), em ordem.
    function textos(o, lim) {
        const out = [];
        (function a(x, p) {
            if (!x || typeof x !== 'object' || p > 12 || out.length >= (lim || 30)) return;
            if (x.primaryText && typeof x.primaryText.content === 'string') out.push(x.primaryText.content);
            else if (typeof x.content === 'string' && x.content.length < 140) out.push(x.content);
            for (const k in x) if (k !== 'totalCharges' && k !== 'tracks') a(x[k], p + 1);
        })(o, 0);
        return out;
    }

    function fotoDe(pics) {
        const p = Array.isArray(pics) ? pics[0] : pics;
        if (!p) return '';
        if (typeof p === 'string') return p;
        return p.url || p.secure_url || p.src || p.thumbnail || '';
    }

    const chaveFamilia = id => 'F' + String(id || '').replace(/\D/g, '');

    /**
     * Central de promoções → { familias:[…], propostas:[…] }.
     * Cada proposta é ligada à família pelo caminho na árvore (o maior prefixo em comum).
     */
    SHC.mlPromosDoEstado = function (r) {
        const cards = [], props = [];
        const pilha = [];
        const visto = new WeakSet();
        (function andar(o, caminho, prof) {
            if (!o || typeof o !== 'object' || prof > 50 || visto.has(o)) return;
            visto.add(o);
            pilha.push(o);
            if (o.shippingInfo !== undefined && o.title !== undefined && o.id) cards.push({ caminho, o });
            if (o.totalCharges && o.totalCharges.detail && Array.isArray(o.totalCharges.detail.costs)) {
                let caixa = null;
                for (let k = pilha.length - 2; k >= 0; k--) { if (Array.isArray(pilha[k].columns)) { caixa = pilha[k]; break; } }
                props.push({ caminho, o, caixa });
            }
            for (const k in o) andar(o[k], caminho.concat(k), prof + 1);
            pilha.pop();
        })(r, [], 0);

        const familias = cards.map(c => ({
            chave: chaveFamilia(c.o.id), id: String(c.o.id).replace(/^#/, ''), titulo: c.o.title || '',
            foto: fotoDe(c.o.pictures), preco_txt: c.o.price || '', tipos: c.o.extraInfo || '',
            estoque: c.o.info || '', envio_txt: c.o.shippingInfo || '', anuncios: [], _caminho: c.caminho,
        }));

        const prefixo = (a, b) => { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n; };
        const propostas = props.map(p => {
            const d = p.o.totalCharges.detail;
            const g = id => (d.costs.find(c => c && c.id === id) || {});
            let fam = null, melhor = -1;
            familias.forEach(f => { const n = prefixo(f._caminho, p.caminho); if (n > melhor) { melhor = n; fam = f; } });
            const cols = p.caixa ? p.caixa.columns.map(c => textos(c, 6)) : [];
            const nome = (cols[0] || [])[0] || 'Promoção';
            const datas = (cols[0] || []).slice(1).find(t => /\d/.test(t)) || '';
            // Desconto sugerido: só vale texto com cara de número ("R$ 90", "(11%)"), nunca frase de marketing.
            let desconto = '';
            cols.forEach(c => { if (!desconto && c.some(t => /desconto/i.test(t))) desconto = c.find(t => /R\$\s?\d|\d+\s?%/.test(t)) || ''; });
            const itemId = String(p.o.itemId || '');
            if (fam && itemId && fam.anuncios.indexOf(itemId) < 0) fam.anuncios.push(itemId);
            const envio = g('shipping');
            return {
                familia: fam ? fam.chave : null, itemId, promo: nome, datas, desconto_txt: desconto,
                preco: dinheiro(g('price').value), tarifa: dinheiro(g('sale_fee').value), tipo: g('sale_fee').description || '',
                envio: envio.value !== undefined ? dinheiro(envio.value) : 0, envio_desc: envio.description || '',
                recebe: dinheiro(d.summary && d.summary.value), recebe_obs: (d.summary && d.summary.description) || '',
            };
        }).filter(p => p.preco && p.recebe !== null);

        familias.forEach(f => { delete f._caminho; });
        // v2.4 (V14): "sem promoções" só com sinal POSITIVO do ML. 0 famílias sem o sinal = tela mudada/erro: o fundo mantém o
        // retrato anterior. Sinal confirmado ao vivo em 25/09/2026: brickTree.bricks com uiType 'empty_state' e 'pagination' com
        // data.total 0, sem 'grid' (página normal: grid_header, grid, pagination). A frase fica como alternativa.
        const bricks = (r && r.appProps && r.appProps.pageProps && r.appProps.pageProps.brickTree && r.appProps.pageProps.brickTree.bricks) || [];
        const brick = t => (Array.isArray(bricks) ? bricks : []).find(b => b && b.uiType === t);
        const vazioEstrutura = !!brick('empty_state') && !brick('grid') && ((brick('pagination') || {}).data || {}).total === 0;
        const vazio = !familias.length && (vazioEstrutura || textosDe(r, 400).some(t => /n[ãa]o (h[áa]|tem|temos|encontramos) (nenhuma )?(promo|oferta|proposta)|nenhuma (promo|oferta|proposta)|sem (promo[çc][õo]es|ofertas|propostas)( dispon| abert| ativ|$)/i.test(t)));
        return { familias, propostas, vazio };
    };

    /**
     * Sobra de uma proposta, com os números do ML: "Você recebe" − custo − outros − imposto sobre o preço.
     */
    SHC.sobraProposta = function (prop, custoFam, cfg) {
        cfg = Object.assign({}, SHC.PADRAO, cfg || {});
        const custo = custoFam ? SHC.num(custoFam.custo) : null;
        const outros = custoFam ? (SHC.num(custoFam.outros) || 0) : 0;
        const impPct = SHC.num(cfg.imposto_pct) || 0;
        const imposto = SHC.r2(prop.preco * impPct / 100);
        if (!(custo > 0)) return { imposto, sobra: null, pct: null, classe: 'sem_custo' };
        const sobra = SHC.r2(prop.recebe - custo - outros - imposto);
        const pct = Math.round(sobra / prop.preco * 1000) / 10;
        const alvo = SHC.num(cfg.margem_alvo_pct) || 0;
        // v2.4: a meta compara a margem SEM arredondar (9,96% não vira 10% e passa na meta de 10%).
        return { imposto, sobra, pct, classe: sobra < 0 ? 'prejuizo' : (sobra / prop.preco * 100 < alvo ? 'apertado' : 'lucrativo') };
    };

    /**
     * Promoção ideal para a meta de sobra do seller.
     *   linhas: [{ p: proposta, sobra, pct, classe }] (saída de sobraProposta por proposta)
     *   → { tipo: 'ideal'|'aproximada'|'nenhuma', escolha, precoMeta, atingem }
     * 'ideal'      = entre as que batem a meta, a de MENOR preço (maior desconto → mais venda sem perder a meta);
     * 'aproximada' = nenhuma bate a meta: a de maior % que ainda dá lucro;
     * 'nenhuma'    = todas dão prejuízo.
     * precoMeta = menor preço que ainda entrega a meta, com a mesma tarifa (%) e o mesmo frete da proposta.
     */
    SHC.recomendaPromo = function (linhas, cfg, custoFam) {
        cfg = Object.assign({}, SHC.PADRAO, cfg || {});
        const meta = SHC.num(cfg.margem_alvo_pct) || 0;
        const com = (linhas || []).filter(l => l.sobra !== null && l.sobra !== undefined);
        if (!com.length) return null;
        const atingem = com.filter(l => l.p && l.p.preco > 0 && l.sobra / l.p.preco * 100 >= meta);   // sem arredondar, como o selo de sobraProposta
        let escolha, tipo;
        if (atingem.length) { escolha = atingem.reduce((a, b) => (b.p.preco < a.p.preco ? b : a)); tipo = 'ideal'; }
        else { escolha = com.reduce((a, b) => (b.pct > a.pct ? b : a)); tipo = escolha.sobra >= 0 ? 'aproximada' : 'nenhuma'; }
        const p = escolha.p;
        const custo = custoFam ? SHC.num(custoFam.custo) : null;
        const outros = custoFam ? (SHC.num(custoFam.outros) || 0) : 0;
        const r = p.preco ? p.tarifa / p.preco : 0;
        const imp = (SHC.num(cfg.imposto_pct) || 0) / 100;
        const den = 1 - r - imp - meta / 100;
        const precoMeta = (custo > 0 && den > 0) ? Math.ceil(((p.envio || 0) + custo + outros) / den * 100) / 100 : null;
        return { tipo, escolha, precoMeta, atingem: atingem.length };
    };

    // ── v2.9: Robô de promoções — MODO SUGERIR (pedido da dona de 26/09/2026). Só lê o retrato ml:promos:<conta> que já foi lido.
    // O clique "Participar" da Central NÃO foi mapeado: é escrita na conta. Até a dona autorizar e o clique estar em MAPEAMENTO-ML.md,
    // esta constante fica false e NÃO existe código que entre sozinho numa promoção (nenhum POST/PUT).
    SHC.PROMO_ADESAO_CONFERIDA = false;
    /** Margem mínima do robô (%): cfg.robopromo.margem_pct; sem ela, a meta de Ajustes (margem_alvo_pct). */
    SHC.roboPromoMargem = function (cfg) {
        const m = SHC.num(((cfg && cfg.robopromo) || {}).margem_pct);
        return m !== null && m >= 0 ? m : (SHC.num(cfg && cfg.margem_alvo_pct) || 0);
    };
    /**
     * Propostas em que a sobra no preço da promoção fica ≥ a margem mínima. Por produto (família da Central), a MESMA melhor opção
     * da Central (SHC.recomendaPromo com a meta = margem mínima): só entra quando ela é 'ideal' (bate a margem).
     * custoDe(proposta) → {custo, outros} | null. → [{itemId, familia, titulo, promo, datas, preco, sobra, pct}], maior sobra primeiro.
     */
    SHC.roboPromoSugestoes = function (promos, custoDe, cfg) {
        const c = Object.assign({}, cfg || {}, { margem_alvo_pct: SHC.roboPromoMargem(cfg) }), porFam = {}, titulo = {};
        ((promos && promos.familias) || []).forEach(f => { titulo[f.chave] = f.titulo || ''; });
        ((promos && promos.propostas) || []).forEach(p => { const k = p.familia || p.itemId; (porFam[k] || (porFam[k] = [])).push(p); });
        const out = [];
        Object.keys(porFam).forEach(k => {
            const rec = SHC.recomendaPromo(porFam[k].map(p => Object.assign({ p }, SHC.sobraProposta(p, custoDe(p), c))), c, null);
            if (!rec || rec.tipo !== 'ideal') return;
            const e = rec.escolha;
            out.push({ itemId: e.p.itemId, familia: e.p.familia || null, titulo: titulo[k] || '', promo: e.p.promo, datas: e.p.datas || '', preco: e.p.preco, sobra: e.sobra, pct: e.pct });
        });
        return out.sort((a, b) => b.sobra - a.sobra);
    };
    /**
     * Uma passada do robô (a cada sincronização): guarda as sugestões de agora e, no histórico, as que são novas (data, anúncio,
     * promoção, margem). novo = há sugestão que o seller ainda não viu (ponto no ícone). Nada é gravado no ML.
     * ant = robopromo:<conta> anterior | null. → {ts, margem, sugestoes, historico (até 200), novo}
     */
    const chaveSugPromo = s => s.itemId + '|' + s.promo + '|' + s.preco;
    SHC.roboPromoPassada = function (ant, sugestoes, margem, agora) {
        const a = ant || {}, antes = new Set((a.sugestoes || []).map(chaveSugPromo));
        const novas = sugestoes.filter(s => !antes.has(chaveSugPromo(s)));
        const historico = (a.historico || []).concat(novas.map(s => ({ ts: agora, itemId: s.itemId, titulo: s.titulo, promo: s.promo, preco: s.preco, sobra: s.sobra, pct: s.pct }))).slice(-200);
        return { ts: agora, margem, sugestoes, historico, novo: novas.length > 0 || (!!a.novo && sugestoes.length > 0) };
    };

    // Valor em R$ dentro de um texto qualquer: "A pagar R$ 68,99", "-R$ 60,94", "$ 618" (atacado vem sem centavos).
    SHC.valorRS = function (t) {
        const s = String(t === null || t === undefined ? '' : t);
        let m = /R\$\s?(-?[\d.]+,\d{2})/.exec(s) || /(-?\d[\d.]*,\d{2})/.exec(s);
        if (m) return Math.abs(parseFloat(m[1].replace(/\./g, '').replace(',', '.')));
        m = /\$\s?(\d[\d.]*)/.exec(s);
        return m ? parseFloat(m[1].replace(/\./g, '')) : null;
    };
    const ehFaixa = t => /\d\s+a\s+R?\$/.test(String(t || ''));   // "R$ 689,90 a R$ 749,90" = família

    /**
     * Lista de Anúncios (/anuncios/lista) → um item por ANÚNCIO, incluindo os de dentro das famílias (innerRows).
     * Números do próprio ML no preço atual: preço, tarifa ("A pagar" antes do frete), frete ("A pagar" depois de
     * "frete grátis") e "Você recebe". Frete que o ML não mostra separado sai de preço − tarifa − você recebe.
     */
    // Textos soltos de uma linha da lista (label/text/title/content/description), fora do produto e das linhas
    // de dentro. Catálogo, competição e bônus Flex vêm assim (A CONFIRMAR AO VIVO: em qual célula cada frase vem).
    function textosDaLinha(row) {
        const out = [];
        (function a(x, p) {
            if (!x || typeof x !== 'object' || p > 8 || out.length >= 60) return;
            for (const k in x) {
                if (k === 'innerRows' || k === 'product' || k === 'metadata') continue;
                const v = x[k];
                if (typeof v === 'string') { if (/^(label|text|title|content|description)$/.test(k) && v.length < 200) out.push(v.trim()); }
                else a(v, p + 1);
            }
        })(row, 0);
        return out;
    }
    // "Sincronizado com #3545161785", "Ganhando"/"Perdendo", "Você oferece condições melhores do que outros vendedores.",
    // "Você receberá até R$ 3,50 por usar o Flex" (bônus, não é frete) → campos novos do anúncio.
    // Competição pelo CÓDIGO do ML (dynamicCell do buy_box, visto ao vivo em 25/09/2026): badges[].id → estado + motivo.
    const COMP_CODIGOS = { 'BUYBOX-WINNING': ['ganhando', ''], 'BUYBOX-LOSING_BY_PRICE': ['perdendo', 'preco'],
        'BUYBOX-LOSING_BY_SHIPPING_MODE': ['restrito', 'entrega'], 'BUYBOX-SHARING_FIRST_PLACE': ['dividindo', ''] };
    function competicaoDoCodigo(row) {
        for (const k in row) {
            const c = k === 'innerRows' ? null : row[k], b = c && Array.isArray(c.badges) && c.badges.find(x => x && /^buybox-/i.test(String(x.id || '')));
            if (!b) continue;
            const id = String(b.id), m = COMP_CODIGOS[id.toUpperCase()] || ['perdendo', 'outro'];
            const frase = ((c.lines || []).map(l => String((l && l.label) || '').trim()).filter(Boolean).join(' ')).slice(0, 160);
            return { competicao: m[0], competicaoMotivo: m[1], competicaoCodigo: id, competicaoTexto: frase };
        }
        return null;
    }
    function competicaoDaLinha(row) {
        const t = textosDaLinha(row), acha = re => t.find(x => re.test(x)) || '';
        const sinc = row && row.product && row.product.synchronized;   // visto ao vivo (AMB MOVE): product.synchronized.label
        const cat = /Sincronizado com #\s?(\d{5,20})/i.exec(acha(/Sincronizado com #/i) || (sinc && typeof sinc.label === 'string' ? sinc.label : ''));
        // v2.3 (AMB MOVE, 24/09): product.synchronized {label:"Sincronizado", tooltip:"…compartilham estoque…"} SEM número de catálogo
        const sincronizado = !!(sinc && (sinc === true || sinc.label || sinc.tooltip)) || !!cat;
        const estado = /^(Ganhando|Perdendo|Competindo)\b/i.exec(acha(/^(Ganhando|Perdendo|Competindo)\b/i));
        const frase = acha(/outros vendedores|condi[çc][õo]es (melhores|piores|iguais)/i);
        const flex = acha(/receber[áa] at[ée] R\$.*Flex/i);
        return Object.assign({
            catalogo: cat ? cat[1] : '',
            sincronizado,
            competicao: estado ? estado[1].toLowerCase() : (frase ? 'competindo' : ''),
            competicaoTexto: frase.slice(0, 160), competicaoMotivo: '', competicaoCodigo: '',
            flexBonus: flex ? SHC.valorRS(flex) : null,
        }, competicaoDoCodigo(row) || {});   // sem badge do ML: fica a leitura por texto (como antes)
    }

    // ── Histórico diário da competição: comp:<conta> = { MLB: [{d, e, m, p}] }, um registro só quando muda (máx. 120 por anúncio) ──
    const COMP_MAX = 120;
    /** Retrato de anúncios lido agora → novo histórico (não mexe no recebido). Anúncio sem competição e sem histórico não entra. */
    SHC.compRegistra = function (hist, itens, hoje) {
        const out = Object.assign({}, hist || {});
        (itens || []).forEach(i => {
            if (!i || !/^MLB\d{6,14}$/.test(String(i.itemId || ''))) return;
            const h = out[i.itemId] || [], u = h[h.length - 1], e = String(i.competicao || ''), m = String(i.competicaoMotivo || '');
            const p = typeof i.preco === 'number' && isFinite(i.preco) ? i.preco : null;
            if (!u ? !e : (u.e === e && (u.m || '') === m && u.p === p)) return;
            out[i.itemId] = h.concat([{ d: hoje, e, m, p }]).slice(-COMP_MAX);
        });
        return out;
    };
    const diasEntre = (de, ate) => Math.round((diaUTC(ate) - diaUTC(de)) / 864e5);
    /**
     * Histórico de UM anúncio → { estado, motivo, preco, desde, peloMenos, dias, diasPerdendo, mudancas } | null.
     * desde = dia da última mudança PARA o estado atual; peloMenos = o estado vem desde a 1ª leitura ("desde pelo menos <desde>").
     * dias = hoje − desde; diasPerdendo = dias quando o estado é perdendo/restrito (senão 0). mudancas = registros (antigo → novo).
     */
    SHC.compResumo = function (hist, hoje) {
        const h = (Array.isArray(hist) ? hist : []).filter(x => x && x.d);
        if (!h.length) return null;
        const u = h[h.length - 1];
        let k = h.length - 1;
        while (k > 0 && h[k - 1].e === u.e) k--;
        const dias = Math.max(0, diasEntre(h[k].d, hoje || SHC.hoje()));
        return { estado: u.e, motivo: u.m || '', preco: u.p === undefined ? null : u.p, desde: h[k].d, peloMenos: k === 0, dias,
            diasPerdendo: /^(perdendo|restrito)$/.test(u.e) ? dias : 0, mudancas: h.map(x => Object.assign({}, x)) };
    };

    SHC.mlAnunciosDoEstado = function (r) {
        const vd = r && r.appProps && r.appProps.pageProps && r.appProps.pageProps.viewData;
        const out = [];
        const linhas = bloco => ((bloco && bloco.lines) || []).map(x => String((x && x.label) || ''));
        (function ler(rows, pai) {
            (rows || []).forEach(row => {
                if (!row || typeof row !== 'object') return;
                const md = row.metadata || {}, prod = row.product || {};
                const precoL = linhas(row.price), recebeL = linhas(row.earnings), condL = linhas(row.purchaseOptions);
                // Com promoção ativa o ML mostra "R$ 165,00" + "em promoção a R$ 156,75", e a tarifa, o frete e o
                // "você recebe" já são do preço da promoção (conferido ao vivo em 24/09/2026) — a conta usa esse.
                const cheio = ehFaixa(precoL[0]) ? null : SHC.valorRS(precoL[0]);
                const linhaPromo = precoL.find(t => /em promo[çc][ãa]o a/i.test(t));
                const promo = linhaPromo ? SHC.valorRS(linhaPromo) : null;
                const preco = promo || cheio;
                const recebe = ehFaixa(recebeL[0]) ? null : SHC.valorRS(recebeL[0]);
                let tarifa = null, frete = null, viuFrete = false, tipo = '', freteComprador = false, taxaOperacional = null;
                const condRaw = (row.purchaseOptions && row.purchaseOptions.lines) || [];
                condL.forEach((t, i) => {
                    if (i === 0 && /Clássico|Premium/.test(t)) tipo = t;
                    // v2.4 (V9): "Envio por conta do comprador" → frete 0; o "A pagar" com tooltip 'operational-cost' é a taxa
                    // operacional do ML (não é frete; fica fora do histórico de frete).
                    // CONFERIDO no Simulador de custos do ML (25/09/2026, MLB5280904452 a R$ 68,44 Premium 17%): comprador paga
                    // → 68,44 − 11,63 − 8,75 = 48,06 = "Você recebe" da lista (os R$ 12,50 que o simulador mostra riscados são o
                    // custo operacional cheio, antes do desconto de reputação; o frete que o comprador paga NÃO sai do vendedor).
                    // Frete grátis no mesmo anúncio: frete 30,10 com 50% coberto pela reputação = 15,05 → recebe 41,76.
                    if (/envio por conta do comprador/i.test(t)) { freteComprador = true; viuFrete = true; }
                    if (/frete/i.test(t)) viuFrete = true;
                    const op = ((condRaw[i] || {}).tooltip || {}).type === 'operational-cost';
                    if (/A pagar|Você paga/i.test(t)) {
                        const v = SHC.valorRS(t);
                        if (op) { if (taxaOperacional === null) taxaOperacional = v; }
                        else if (viuFrete) { if (frete === null && !freteComprador) frete = v; } else if (tarifa === null) tarifa = v;
                    }
                });
                if (freteComprador) frete = 0;
                let freteDeduzido = false;
                if (frete === null && preco !== null && tarifa !== null && recebe !== null) { frete = Math.max(0, SHC.r2(preco - tarifa - recebe)); freteDeduzido = true; }
                const item = {
                    itemId: String(md.itemId || ''), familia: String(md.userProductId || md.familyId || (pai && pai.familia) || ''),
                    sku: SHC.normalizaSku ? SHC.normalizaSku(prod.sku) : String(prod.sku || ''),
                    // Linha de dentro de uma linha aberta (innerRows) não tem 'product': o status vem do botão Pausar/Ativar (statusSwitch) ou do pai.
                    titulo: prod.title || (pai && pai.titulo) || '', tipo,
                    status: prod.status || (row.statusSwitch && typeof row.statusSwitch.checked === 'boolean' ? (row.statusSwitch.checked ? 'active' : 'paused') : '') || (pai && pai.status) || '',
                    preco, precoCheio: promo ? cheio : null, emPromocao: !!promo, tarifa, frete, freteDeduzido, recebe,
                    freteComprador, taxaOperacional,
                    atacado: precoL.some(t => /atacado/i.test(t)), estoque: (((prod.stock || [])[0]) || {}).label || '',
                    dentroDeFamilia: !!pai, catalogoML: md.catalog === true,   // v2.3: metadata.catalog (anúncio de catálogo)
                };
                Object.assign(item, competicaoDaLinha(row));
                if (item.itemId) out.push(item);
                if (Array.isArray(row.innerRows)) ler(row.innerRows, item);
            });
        })(vd && vd.rows, null);
        return out;
    };

    /** Degraus de atacado (/anuncios/api/listing/tooltip?type=tiered_pricing) → [{ qtd, preco }] em ordem. */
    SHC.mlAtacadoDoTooltip = function (j) {
        const pl = (j && j.data && j.data.priceList) || (j && j.priceList) || [];
        return (((pl[0] && pl[0].table) || [])
            .map(t => ({ qtd: parseInt(String(t.label || ''), 10), preco: SHC.valorRS(t.value) }))
            .filter(t => t.qtd > 0 && t.preco > 0)
            .sort((a, b) => a.qtd - b.qtd));
    };

    /** Sobra de 1 unidade de um anúncio no preço atual, com os números do ML (lista de Anúncios). */
    SHC.sobraAnuncio = function (item, custoDados, cfg) {
        cfg = Object.assign({}, SHC.PADRAO, cfg || {});
        if (!(item.preco > 0) || item.recebe === null) return null;
        const custo = custoDados ? SHC.num(custoDados.custo) : null;
        const outros = custoDados ? (SHC.num(custoDados.outros) || 0) : 0;
        const imposto = SHC.r2(item.preco * (SHC.num(cfg.imposto_pct) || 0) / 100);
        if (!(custo > 0)) return { imposto, sobra: null, pct: null, classe: 'sem_custo' };
        const sobra = SHC.r2(item.recebe - custo - outros - imposto);
        const pct = sobra / item.preco * 100;
        const alvo = SHC.num(cfg.margem_alvo_pct) || 0;
        return { imposto, sobra, pct, custo, outros, classe: sobra < 0 ? 'prejuizo' : (pct < alvo ? 'apertado' : 'lucrativo') };
    };

    /** Sobra por unidade num degrau de atacado: mesma tarifa (%) do anúncio, frete conservador (1 envio por peça) e, em
     *  "Envio por conta do comprador", o custo operacional do ML por unidade (visto ao vivo 25/09: R$ 8,75 num anúncio a R$ 68,44). */
    SHC.sobraAtacado = function (item, degrau, custoDados, cfg) {
        cfg = Object.assign({}, SHC.PADRAO, cfg || {});
        const custo = custoDados ? SHC.num(custoDados.custo) : null;
        if (!(custo > 0) || !(item.preco > 0) || item.tarifa === null) return null;
        const outros = SHC.num(custoDados.outros) || 0;
        const taxa = item.tarifa / item.preco;
        const tarifa = SHC.r2(degrau.preco * taxa), frete = item.freteComprador ? 0 : (item.frete || 0);
        const taxaOp = item.freteComprador && SHC.num(item.taxaOperacional) > 0 ? SHC.r2(SHC.num(item.taxaOperacional)) : 0;
        const imposto = SHC.r2(degrau.preco * (SHC.num(cfg.imposto_pct) || 0) / 100);
        const sobra = SHC.r2(degrau.preco - tarifa - frete - taxaOp - custo - outros - imposto);
        const pct = sobra / degrau.preco * 100;
        const alvo = SHC.num(cfg.margem_alvo_pct) || 0;
        // descontoPct: quanto o degrau desconta sobre o preço de venda de hoje (promoção incluída) — o ML define o degrau em %.
        const descontoPct = SHC.r2((1 - degrau.preco / item.preco) * 100);
        return { tarifa, taxaPct: taxa * 100, frete, freteComprador: !!item.freteComprador, taxaOp, imposto, custo, outros, sobra, pct, descontoPct,
            pedido: SHC.r2(sobra * degrau.qtd), classe: sobra < 0 ? 'prejuizo' : (pct < alvo ? 'apertado' : 'lucrativo') };
    };

    /** Margem com 2 casas abaixo de 1% (evita "−0%"). */
    SHC.pctTxt = function (v) {
        const a = Math.abs(v), casas = a < 1 ? 2 : 1;
        const t = (Math.round(a * Math.pow(10, casas)) / Math.pow(10, casas)).toLocaleString('pt-BR', { maximumFractionDigits: casas });
        return (v < 0 && t !== '0' ? '−' : '') + t + '%';
    };

    /** Detalhe da venda → { tarifa, tarifa_label, envio, envio_label } (valores positivos em R$). */
    SHC.mlVendaDoEstado = function (r) {
        const resp = r && r.appProps && r.appProps.pageProps && r.appProps.pageProps.response;
        if (!resp) return null;
        // As linhas de conta trazem strings em title/subTotal/label/price (ex.: "Tarifa de 11,5%", "-R$ 80,38").
        const campos = o => {
            const out = {};
            (function a(x, p) {
                if (!x || typeof x !== 'object' || p > 12) return;
                for (const k in x) { const v = x[k]; if (typeof v === 'string' && v.length < 140) (out[k] = out[k] || []).push(v); else a(v, p + 1); }
            })(o, 0);
            return out;
        };
        const le = k => {
            const s = campos(resp[k] || {});
            const val = (s.subTotal || s.price || []).map(x => SHC.num(x)).find(n => n !== null);
            return { valor: val === undefined || val === null ? null : Math.abs(val), label: (s.label || [])[0] || '' };
        };
        const ch = le('account_rows-CHARGES'), sh = le('account_rows-SHIPMENT');
        return { tarifa: ch.valor, tarifa_label: ch.label, envio: sh.valor, envio_label: sh.label };
    };

    // ── v2.1: conta do vendedor, total da lista e retrato da conta inteira (sincronização em segundo plano) ──

    // Busca em largura (o mais perto da raiz ganha), com limite de nós e de profundidade.
    function primeiroEmLargura(r, teste, profMax) {
        const fila = [[r, 0]], visto = new Set();
        for (let i = 0; i < fila.length && i < 50000; i++) {
            const o = fila[i][0], p = fila[i][1];
            if (!o || typeof o !== 'object' || visto.has(o)) continue;
            visto.add(o);
            const achou = Array.isArray(o) ? undefined : teste(o);
            if (achou !== undefined) return achou;
            if (p < profMax && fila.length < 50000) for (const k in o) if (o[k] && typeof o[k] === 'object') fila.push([o[k], p + 1]);
        }
        return null;
    }

    const CHAVES_ID = ['sellerId', 'seller_id', 'userId', 'user_id', 'custId', 'cust_id'];
    const CHAVES_APELIDO = ['nickname', 'nickName'];
    /**
     * Conta do ML no estado de uma página do painel → { sellerId:'123456789', apelido } ou null.
     * Confirmado ao vivo em 25/09/2026: Anúncios → pageProps.initialAppContext.user.userId; Central de promoções →
     * pageProps.appState.userId (e sellerId, mesmo número). Esses caminhos vêm primeiro; senão, o primeiro número plausível
     * (6 a 15 dígitos) numa das chaves conhecidas, em largura. O apelido só vale se estiver no MESMO objeto do id
     * (não pega apelido de comprador de outro lugar da página).
     */
    SHC.mlContaDoEstado = function (r) {
        const pp = r && r.appProps && r.appProps.pageProps;
        const fixos = [pp && pp.initialAppContext && pp.initialAppContext.user, pp && pp.appState];
        for (const o of fixos) { const c = o && typeof o === 'object' ? contaDe(o) : undefined; if (c) return c; }
        return primeiroEmLargura(r, contaDe, 10);
    };
    function contaDe(o) {
        for (const k of CHAVES_ID) {
            const v = o[k];
            if ((typeof v === 'number' || typeof v === 'string') && /^\d{6,15}$/.test(String(v).trim())) {
                const ap = CHAVES_APELIDO.map(c => o[c]).find(x => typeof x === 'string' && x.trim()) || '';
                return { sellerId: String(v).trim(), apelido: ap.trim().slice(0, 60) };
            }
        }
        return undefined;
    }

    /** Total que o ML informa na lista de Anúncios (grid.pagination.total) ou null. */
    SHC.mlTotalAnuncios = function (r) {
        return primeiroEmLargura(r, o => {
            const t = o.pagination && o.pagination.total;
            return (typeof t === 'number' && t >= 0) ? t : undefined;
        }, 8);
    };

    /** Uma página da lista de Anúncios → { itens, total, conta } (fundo e aba usam a mesma leitura). */
    SHC.mlPaginaAnuncios = function (r) {
        return { itens: SHC.mlAnunciosDoEstado(r), total: SHC.mlTotalAnuncios(r), conta: SHC.mlContaDoEstado(r) };
    };

    /**
     * Junta anúncios no retrato da conta: mesmo itemId → o novo substitui (no mesmo lugar); os outros ficam.
     * Na mesma leva, se o id vier repetido (linha da família e linha de dentro), fica o que tem preço.
     * Não mexe no retrato recebido: devolve um novo {ts, paginas, total, itens, …extra}.
     */
    SHC.mesclaAnuncios = function (snap, itens, extra) {
        const novos = new Map();
        (itens || []).forEach(i => {
            if (!i || typeof i !== 'object' || !/^[A-Z]{2,5}\d{5,20}$/.test(String(i.itemId || ''))) return;
            const it = Object.assign({}, i, { itemId: String(i.itemId) });
            if (SHC.normalizaSku) it.sku = SHC.normalizaSku(it.sku);   // a aba não tem store.js: normaliza aqui
            const ja = novos.get(it.itemId);
            if (!ja || !(ja.preco !== null && ja.preco !== undefined && (it.preco === null || it.preco === undefined))) novos.set(it.itemId, it);
        });
        const base = (snap && Array.isArray(snap.itens)) ? snap.itens : [];
        const out = base.map(i => { const n = i && novos.get(i.itemId); if (n) { novos.delete(i.itemId); return n; } return i; });
        novos.forEach(n => out.push(n));
        return Object.assign({ paginas: 0, total: null }, snap || {}, extra || {}, { ts: Date.now(), itens: out });
    };

    /**
     * Frete conhecido de cada anúncio da lista de Anúncios, no preço atual → { MLB…: frete }.
     * Vale o frete que o ML mostra ("A pagar" depois de "frete grátis"); o deduzido (preço − tarifa − você recebe)
     * só entra quando não há o explícito. Deduzido abaixo de R$ 1 é arredondamento: conta como 0.
     * O 0 (frete por conta do comprador) só vai para o histórico de quem já tem histórico (ver fretesQueMudaram).
     */
    SHC.fretesParaGravar = function (itens) {
        const exp = {}, ded = {};
        (itens || []).forEach(i => {
            if (!i || i.freteComprador || !/^MLB\d{6,14}$/.test(String(i.itemId || '')) || typeof i.frete !== 'number' || !isFinite(i.frete) || i.frete < 0) return;   // V9: comprador paga → sem histórico
            if (!i.freteDeduzido) { if (exp[i.itemId] === undefined) exp[i.itemId] = SHC.r2(i.frete); }
            else if (ded[i.itemId] === undefined) ded[i.itemId] = i.frete >= 1 ? SHC.r2(i.frete) : 0;
        });
        return Object.assign(ded, exp);
    };

    const diaUTC = d => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
    /**
     * Só o que precisa ir para o histórico fh (economiza espaço e o aviso de mudança para as abas):
     * valor diferente do último ponto, ou último ponto com 7 dias ou mais. Sem histórico: só frete > 0.
     * mapa = fretesParaGravar(…), hist = SHC.lerFretes(ids), hoje = 'AAAA-MM-DD' → novo mapa.
     */
    SHC.fretesQueMudaram = function (mapa, hist, hoje) {
        const out = {};
        Object.keys(mapa || {}).forEach(id => {
            const v = mapa[id], h = (hist && hist[id]) || {};
            const dias = Object.keys(h).filter(d => typeof h[d] === 'number' && isFinite(h[d])).sort();
            if (!dias.length) { if (v > 0) out[id] = v; return; }
            const ult = dias[dias.length - 1];
            if (Math.abs(h[ult] - v) >= 0.005 || !(diaUTC(hoje) - diaUTC(ult) < 7 * 864e5)) out[id] = v;
        });
        return out;
    };

    /** O retrato mudou? (mesclaAnuncios mantém a ordem: compara item a item; o ts novo não conta.) */
    SHC.retratoMudou = function (antes, depois) {
        const a = (antes && antes.itens) || [], b = (depois && depois.itens) || [];
        return a.length !== b.length || b.some((it, k) => JSON.stringify(it) !== JSON.stringify(a[k]));
    };

    /** Contagem por status do anúncio como o ML escreve ("ativo", "pausado", …) → { status: n }. */
    SHC.anunciosPorStatus = function (itens) {
        const c = {};
        (itens || []).forEach(i => {
            let s = i && i.status;
            if (s && typeof s === 'object') s = s.label || s.text || s.id || '';
            s = String(s || '').trim().toLowerCase().slice(0, 40) || 'sem status';
            c[s] = (c[s] || 0) + 1;
        });
        return c;
    };

    // ── v2.2: Faturamento — cobranças por período (charges-summary-provider/bricks, JSON), mapeado ao vivo em 24/09/2026 ──
    // + abreviações em espanhol que o ML às vezes manda (só as que diferem do português): sem elas, mlDataPt devolve
    // '' e o dia da visita cai no da cobrança (dia seguinte) — o Ads do último dia do mês migra para o mês seguinte.
    const MESES_PT = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
        ene: 1, may: 5, sep: 9, oct: 10, dic: 12 };
    // "24/set/2026" (ou "24/09/2026") → '2026-09-24' | ''
    SHC.mlDataPt = function (t) {
        const m = /(\d{1,2})\/([a-zç]{3}|\d{1,2})[a-zç.]*\/(\d{4})/i.exec(String(t || ''));
        if (!m) return '';
        const mes = /^\d/.test(m[2]) ? +m[2] : MESES_PT[m[2].toLowerCase()];
        if (!(mes >= 1 && mes <= 12) || !(+m[1] >= 1 && +m[1] <= 31)) return '';
        return m[3] + '-' + String(mes).padStart(2, '0') + '-' + String(+m[1]).padStart(2, '0');
    };
    // amount.value {fraction:"-6", cents:"65"} → 6.65 (sempre positivo; o tipo diz se é cobrança ou estorno)
    function valorCobranca(a) {
        const v = a && (a.value !== undefined ? a.value : a);
        if (v && typeof v === 'object' && v.fraction !== undefined) {
            const f = parseInt(String(v.fraction).replace(/\D/g, ''), 10) || 0;
            const c = parseInt(String(v.cents || '0').replace(/\D/g, '').slice(0, 2).padEnd(2, '0'), 10) || 0;
            return SHC.r2(f + c / 100);
        }
        const n = typeof v === 'number' ? v : SHC.valorRS(v);
        return n === null || !isFinite(n) ? null : Math.abs(n);
    }

    /**
     * Resposta de /billing/cnc/api/charges-summary/charges-summary-provider/bricks → uma cobrança por linha:
     *   [{ tipo:'frete'|'frete_parcial'|'frete_estorno'|'venda'|'venda_cancelada'|'ads'|'outro', itemId:'MLB…'|'', orderId:'…'|'', data:'AAAA-MM-DD', valor, texto, titulo, id }]
     * "Custo por vender no Mercado Livre" = venda (1 linha por venda); "Cancelamento do Custo por vender…" = venda_cancelada.
     * tipo sai do detail_1: "Tarifa de envio … (Por sua conta)" = frete; "… (Por sua conta e por conta do comprador)" = frete_parcial;
     * Estorno = modalTrigger.type "BXDE" (confirmado ao vivo) ou texto "Cancelamento…": de envio → frete_estorno (valor positivo); de outra coisa → outro.
     * "Tarifa por campanha de publicidade de Product Ads" = ads.
     * A CONFIRMAR AO VIVO: se "Tarifa de envio extra ou intermunicipal" é o frete INTEIRO da venda ou só um complemento
     * (exemplo do MAPEAMENTO: R$ 6,65 aqui × "Tarifa do Mercado Envios" R$ 91,95 no detalhe da venda). Conferir, para o mesmo
     * "Venda #", o subTotal de account_rows-SHIPMENT (/vendas/<id>/detalhe) com a soma das cobranças de envio daqui.
     * MLB do permalink, pedido do detail_2 ("Venda #…"). id = modalTrigger.entityId (tira repetição entre páginas).
     * out.brutas = linhas que vieram na página (antes de tirar as sem valor): é o que decide se há próxima página.
     */
    // Ao vivo (25/09/2026): o ML às vezes desiste e devolve charges.data=[] depois de ~30 s. Vazio depois de mais de 15 s = falhou, não "sem cobranças".
    SHC.COB_SUSPEITA_MS = 15000;
    SHC.mlCobrancasDaResposta = function (j) {
        const achada = (j && j.charges && Array.isArray(j.charges.data)) ? j.charges.data
            : primeiroEmLargura(j, o => (o.charges && Array.isArray(o.charges.data)) ? o.charges.data : undefined, 6);
        const lista = achada || [], out = [];
        out.reconhecida = Array.isArray(achada);   // sem charges.data = formato mudado/erro com 200: o fundo não grava zero por cima
        lista.forEach(c => {
            if (!c || typeof c !== 'object') return;
            const texto = String(c.detail_1 || '').replace(/\s+/g, ' ').trim().slice(0, 140);
            const envio = /tarifa (de|por) envio|mercado envios/i.test(texto), mt = c.modalTrigger || {};   // "Tarifa do Mercado Envios" (AMB MOVE, 24/09) também é frete
            const estorno = mt.type === 'BXDE' || mt.detailType === 'BONUS' || /^cancelamento/i.test(texto), vende = /custo por vender/i.test(texto);   // v2.3: 1 por venda (sazonalidade)
            const tipo = estorno ? (envio ? 'frete_estorno' : vende ? 'venda_cancelada' : 'outro')
                : envio ? (/conta do comprador/i.test(texto) ? 'frete_parcial' : 'frete')
                : vende ? 'venda' : /product ads/i.test(texto) ? 'ads' : 'outro';
            const mlb = /MLB-?(\d{6,14})/i.exec(String(c.permalink || ''));
            const ped = /(?:Venda|Pedido)\s*#\s*(\d{6,20})/i.exec(String(c.detail_2 || ''));   // AMB MOVE: "Pedido #…" também
            const valor = valorCobranca(c.amount);
            if (valor === null) return;
            // titulo (description_1) = título do anúncio: resolve o MLB quando o ML não manda o permalink (SHC.resolveCobrancasPorTitulo)
            // v2.4: Ads vem cobrado no dia seguinte ("Visitas recibidas el 23/set/2026"): dataRef = dia das visitas (fechamento do mês).
            const data = SHC.mlDataPt(c.date), ref = /visitas/i.test(String(c.detail_2 || '')) ? SHC.mlDataPt(c.detail_2) : '';
            // v2.4.4: como a cobrança é paga — 'venda' = descontada na própria venda (pill "Cobrado na operação" ou prepaid), 'fatura' = o resto
            // (pill "Pós-operação": entra na fatura/débito). As duas fazem parte do total da fatura (visto ao vivo em 25/09/2026).
            const pill = String((c.paymentTypeStatus && c.paymentTypeStatus.pill) || '');
            const origemPagamento = mt.prepaid === true || /cobrad[oa] na opera/i.test(pill) ? 'venda' : 'fatura';
            // v2.5.3: cheio = discount_amount (o valor antes do desconto que o ML dá no frete); null quando o ML não manda.
            const cheio = c.discount_amount ? valorCobranca(c.discount_amount) : null;
            out.push({ tipo, estorno, itemId: mlb ? 'MLB' + mlb[1] : '', orderId: ped ? ped[1] : '', data, dataRef: ref || data, valor, cheio, texto, origemPagamento,
                titulo: String(c.description_1 || '').replace(/\s+/g, ' ').trim().slice(0, 200),
                id: mt.entityId ? String(mt.entityId) + '|' + String(mt.conceptId || '') + '|' + String(mt.type || '') : '' });
        });
        out.brutas = lista.length;
        return out;
    };

    /**
     * Janelas para ler o Faturamento, UMA POR MÊS de calendário (o mês atual vai até hoje), do mês ATUAL para trás
     * (o Fechamento e o frete do mês aparecem primeiro): 12 meses na 1ª vez (desde o dia 1º do mês de 365 dias atrás),
     * depois só os meses dos últimos 40 dias. Mês por janela = o que falhar fica "não lido" só naquele mês.
     * hoje = 'AAAA-MM-DD' → [{ mes, de, ate }] do mais novo ao mais antigo.
     */
    SHC.janelasCobranca = function (hoje, primeiraVez) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(hoje || '');
        if (!m) return [];
        const fim = Date.UTC(+m[1], +m[2] - 1, +m[3]), ini = new Date(fim - (primeiraVez ? 365 : 40) * 864e5);
        const iso = t => new Date(t).toISOString().slice(0, 10), limite = Date.UTC(ini.getUTCFullYear(), ini.getUTCMonth(), 1), out = [];
        for (let k = +m[2] - 1; Date.UTC(+m[1], k, 1) >= limite; k--) {   // Date.UTC aceita mês negativo (volta o ano)
            const t = Date.UTC(+m[1], k, 1);
            out.push({ mes: iso(t).slice(0, 7), de: iso(t), ate: iso(Math.min(fim, Date.UTC(+m[1], k + 1, 0))) });
        }
        return out;
    };

    /**
     * v2.5.1: páginas de UM período do Faturamento com vários pedidos ao mesmo tempo (medido ao vivo em 25/09/2026: 3,7–7,6 s por
     * página de 500; o ML aguentou 8 em paralelo). A 1ª página vai sozinha (mês pequeno = 1 pedido só); depois `paralelo` de cada vez.
     * Página com menos de `limite` linhas (ou que repete outra: o ML ignorou o número da página) = a última: as seguintes não são pedidas.
     * ler(p) → Promise<lista com .brutas (SHC.mlCobrancasDaResposta) | { falha }>.
     * → { linhas (em ordem de página, sem repetir id), cortado (bateu em `max` sem achar a última) } | { falha } (a da 1ª página que faltou).
     */
    SHC.paginasEmParalelo = async function (ler, o) {
        const limite = o.limite, max = o.max || 20, n = Math.max(1, o.paralelo || 3), res = [];
        const primeiroId = r => (r.find(c => c && c.id) || {}).id;
        let fim = max, achou = false, prox = 2, parar = false, algumaFalha = null;
        const guarda = (p, r) => {
            res[p] = r = r || { falha: 'sem resposta' };
            if (r.falha) { parar = true; algumaFalha = algumaFalha || r.falha; return; }
            const id = primeiroId(r), b = typeof r.brutas === 'number' ? r.brutas : r.length;
            const repete = !!id && res.some((x, q) => q !== p && x && !x.falha && primeiroId(x) === id);
            if (b < limite || repete) { achou = true; fim = Math.min(fim, p); }
        };
        guarda(1, await ler(1));
        const vai = async () => { while (!parar && prox <= fim) { const p = prox++; guarda(p, await ler(p)); } };
        if (!res[1].falha) await Promise.all(Array.from({ length: n }, vai));
        const linhas = [], ids = new Set();
        for (let p = 1; p <= fim; p++) {
            const r = res[p];
            if (!r || r.falha) return { falha: (r && r.falha) || algumaFalha || 'sem resposta' };
            // página que repete outra: tudo dela já foi visto (o filtro abaixo tira)
            r.forEach(c => { if (!c.id || !ids.has(c.id)) { if (c.id) ids.add(c.id); linhas.push(c); } });
        }
        return { linhas, cortado: !achou };
    };

    /**
     * Cobranças (já sem repetição) → o que vai para o armazenamento:
     *   vendas: { MLB: { orderId: { d, f, pc } | null } }  f = frete cobrado − estorno do mesmo pedido; d = dia da cobrança;
     *           pc = true se o frete foi "por sua conta e por conta do comprador" (parcial). Sem q: o Faturamento não traz a quantidade.
     *           null = venda cancelada (estorno ≥ cobrança): SHC.registraVendas apaga o pedido (não conta como venda).
     *   ads:    { MLB: { 'AAAA-MM': custo de Product Ads no mês } }
     * Estorno sem a cobrança no mesmo período fica de fora (não dá para saber de qual valor tirar).
     */
    SHC.vendasEAdsDasCobrancas = function (cobs) {
        const ped = {}, ads = {};
        (cobs || []).forEach(c => {
            if (!c || !/^MLB\d{6,14}$/.test(c.itemId) || !c.data || !(c.valor >= 0)) return;
            if (c.tipo === 'ads') {
                const a = ads[c.itemId] || (ads[c.itemId] = {}), mes = (c.dataRef || c.data).slice(0, 7);   // v2.4: mês das visitas
                a[mes] = SHC.r2((a[mes] || 0) + c.valor);
                return;
            }
            if (!/^frete/.test(c.tipo) || !c.orderId) return;
            const k = c.itemId + '|' + c.orderId, p = ped[k] || (ped[k] = { itemId: c.itemId, orderId: c.orderId, d: '', cobrado: 0, estorno: 0, pc: false });
            if (c.tipo === 'frete_estorno') { p.estorno = SHC.r2(p.estorno + c.valor); return; }
            p.cobrado = SHC.r2(p.cobrado + c.valor);
            if (c.tipo === 'frete_parcial') p.pc = true;
            if (!p.d || c.data < p.d) p.d = c.data;
        });
        const vendas = {};
        Object.keys(ped).forEach(k => {
            const p = ped[k];
            if (!p.d) return;   // só estorno
            (vendas[p.itemId] || (vendas[p.itemId] = {}))[p.orderId] = p.estorno >= p.cobrado ? null : { d: p.d, f: SHC.r2(p.cobrado - p.estorno), pc: p.pc };
        });
        return { vendas, ads };
    };

    // ── v2.3: MLB pelo título (cobrança sem permalink: 2 de 23 fretes da AMB MOVE em 24/09) ──
    // minúsculas, sem acento, sem pontuação, espaços únicos
    SHC.normalizaTitulo = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const indiceTitulos = itens => (itens || []).filter(i => i && /^MLB\d{6,14}$/.test(String(i.itemId || '')))
        .map(i => ({ t: SHC.normalizaTitulo(i.titulo), id: String(i.itemId) })).filter(x => x.t);
    // Casa se igual; senão se um contém o outro e o menor tem 25+ caracteres. Mais de um anúncio possível = não casa (não chuta).
    function casaTitulo(n, indice) {
        if (!n) return '';
        const iguais = new Set(), contem = new Set();
        indice.forEach(x => {
            if (x.t === n) iguais.add(x.id);
            else if (Math.min(x.t.length, n.length) >= 25 && (x.t.indexOf(n) >= 0 || n.indexOf(x.t) >= 0)) contem.add(x.id);
        });
        const s = iguais.size ? iguais : contem;
        return s.size === 1 ? [...s][0] : '';
    }
    /** Título → MLB do retrato de anúncios (itens de ml:anuncios) ou ''. */
    SHC.mlbPorTitulo = (titulo, itens) => casaTitulo(SHC.normalizaTitulo(titulo), indiceTitulos(itens));
    /**
     * Cobranças de frete/venda sem MLB → MLB pelo título no retrato de anúncios.
     * → { cobs: cópias com itemId (porTitulo:true nas resolvidas), resolvidas, pendentes: [as de frete que não casaram] }
     */
    SHC.resolveCobrancasPorTitulo = function (cobs, itens) {
        const indice = indiceTitulos(itens), cache = {}, pendentes = [];
        let resolvidas = 0;
        const out = (cobs || []).map(c => {
            if (!c || c.itemId || !c.titulo || !/^(frete|venda)/.test(c.tipo)) return c;
            const n = SHC.normalizaTitulo(c.titulo);
            const id = n in cache ? cache[n] : (cache[n] = casaTitulo(n, indice));
            if (id) { resolvidas++; return Object.assign({}, c, { itemId: id, porTitulo: true }); }
            if (/^frete/.test(c.tipo)) pendentes.push(c);
            return c;
        });
        return { cobs: out, resolvidas, pendentes };
    };

    /**
     * Vendas por mês de cada anúncio (sazonalidade) → { MLB: { 'AAAA-MM': unidades líquidas } }.
     * 1 linha "venda" = 1 venda, no mês da cobrança; "venda_cancelada" do MESMO pedido tira 1 (nunca abaixo de 0).
     * Cancelamento sem a venda no mesmo período fica de fora (igual ao estorno de frete).
     */
    function pedidosDeVenda(cobs) {
        const ped = {};
        (cobs || []).forEach(c => {
            if (!c || !/^venda/.test(c.tipo) || !/^MLB\d{6,14}$/.test(c.itemId) || !c.data) return;
            const k = c.itemId + '|' + (c.orderId || c.id), p = ped[k] || (ped[k] = { itemId: c.itemId, d: '', n: 0, canc: 0 });
            if (c.tipo === 'venda_cancelada') { p.canc++; return; }
            p.n++;
            if (!p.d || c.data < p.d) p.d = c.data;
        });
        return Object.keys(ped).map(k => ped[k]).filter(p => p.d);
    }
    SHC.vendasPorMes = function (cobs) {
        const out = {};
        pedidosDeVenda(cobs).forEach(p => {
            const m = out[p.itemId] || (out[p.itemId] = {}), mes = p.d.slice(0, 7);
            m[mes] = (m[mes] || 0) + Math.max(0, p.n - p.canc);
        });
        return out;
    };
    /**
     * Dia da venda mais recente de cada anúncio (cobranças "venda", com ou sem frete cobrado do seller; pedido cancelado não conta)
     * → { MLB: 'AAAA-MM-DD' }. É o que diz quem vendeu nos últimos 3 dias (medidas relidas todo dia).
     */
    SHC.ultimaVendaDasCobrancas = function (cobs) {
        const out = {};
        pedidosDeVenda(cobs).forEach(p => { if (p.n > p.canc && !(out[p.itemId] >= p.d)) out[p.itemId] = p.d.slice(0, 10); });
        return out;
    };

    // ── v2.5.3: frete de CADA pedido a partir das cobranças do Faturamento (a verdade do que foi cobrado; o fh|ml do retrato
    // continua sendo o "preço do frete do anúncio hoje"). Rótulos reais (AMB MOVE, 30 dias): "Tarifa do Mercado Envios (Por sua conta)"
    // = frete grátis pago por você; "… (Por sua conta e por conta do comprador)" = compartilhado; "Tarifa de envio extra ou intermunicipal
    // (Por sua conta)" = envio extra; "Cancelamento da tarifa…" = estorno. ──
    const diaMenosX = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') - n * 864e5).toISOString().slice(0, 10);
    // Valor ≈ 2×, 3×… o de 1 unidade (±8%): pedido com várias unidades (mesma regra de SHC.fech.conferir).
    const variasUn = razao => { const k = Math.round(razao); return k >= 2 && Math.abs(razao - k) <= 0.08 * k; };
    const medianaX = xs => { const s = xs.slice().sort((a, b) => a - b), h = s.length >> 1; return !s.length ? null : (s.length % 2 ? s[h] : SHC.r2((s[h - 1] + s[h]) / 2)); };
    /**
     * Cobranças (SHC.mlCobrancasDaResposta, já sem repetição) → frete por pedido, somando todas as tarifas de envio do mesmo pedido:
     *   [{ pedido, itemId, data (1ª cobrança), cobrado (cobranças − estornos), cheio (antes do desconto do ML; ≥ cobrado), temExtra,
     *      formato: 'gratis' | 'compartilhado' | 'extra' (só envio extra, sem a tarifa principal) | 'cancelado', cancelado }]
     * Pedido só com estorno (a cobrança caiu fora do período lido) fica de fora.
     */
    SHC.freteDasCobrancas = function (cobs) {
        const g = {};
        (cobs || []).forEach(c => {
            if (!c || !/^frete/.test(c.tipo) || !c.orderId || !(c.valor >= 0)) return;
            const p = g[c.orderId] || (g[c.orderId] = { pedido: c.orderId, itemId: '', data: '', cob: 0, est: 0, cheio: 0, gratis: false, compart: false, extra: false });
            if (!p.itemId && c.itemId) p.itemId = c.itemId;
            if (c.tipo === 'frete_estorno') { p.est = SHC.r2(p.est + c.valor); return; }
            p.cob = SHC.r2(p.cob + c.valor);
            p.cheio = SHC.r2(p.cheio + (c.cheio > c.valor ? c.cheio : c.valor));
            if (/extra ou intermunicipal/i.test(c.texto)) p.extra = true; else if (c.tipo === 'frete_parcial') p.compart = true; else p.gratis = true;
            if (c.data && (!p.data || c.data < p.data)) p.data = c.data;
        });
        return Object.keys(g).map(k => g[k]).filter(p => p.data && p.cob > 0).map(p => {
            const cancelado = p.est >= p.cob - 0.004, cobrado = cancelado ? 0 : SHC.r2(p.cob - p.est);
            return { pedido: p.pedido, itemId: p.itemId, data: p.data, cobrado, cheio: cancelado ? 0 : Math.max(cobrado, SHC.r2(p.cheio - p.est)), temExtra: p.extra,
                formato: cancelado ? 'cancelado' : p.compart ? 'compartilhado' : p.gratis ? 'gratis' : 'extra', cancelado };
        });
    };
    /** Cobranças "Custo por vender" → pedidos vendidos [{ pedido, itemId, data, cancelada }] (cancelada = "Cancelamento do custo por vender" ≥ vendas). */
    SHC.vendasDasCobrancas = function (cobs) {
        const g = {};
        (cobs || []).forEach(c => {
            if (!c || !/^venda/.test(c.tipo) || !c.orderId || !c.data) return;
            const p = g[c.orderId] || (g[c.orderId] = { pedido: c.orderId, itemId: '', data: '', n: 0, canc: 0 });
            if (!p.itemId && c.itemId) p.itemId = c.itemId;
            if (c.tipo === 'venda_cancelada') { p.canc++; return; }
            p.n++;
            if (!p.data || c.data < p.data) p.data = c.data;
        });
        return Object.keys(g).map(k => g[k]).filter(p => p.data).map(p => ({ pedido: p.pedido, itemId: p.itemId, data: p.data, cancelada: p.canc >= p.n }));
    };
    /**
     * Frete por pedido → comparação dos últimos 30 dias (hoje incluso) com os 30 anteriores, por anúncio e da conta.
     * porPedido = SHC.freteDasCobrancas (pedido com aprox:true = veio do vd|ml antigo, sem o formato: entra nos totais, não nos formatos).
     * itens (opcional) = retrato de anúncios → compradorPaga (freteComprador, com o custo operacional), full e flex (quando o retrato diz).
     * vendas30 (opcional) = SHC.vendasDasCobrancas → pedidos dos anúncios em que o comprador paga o frete.
     * → { hoje, desde (1º pedido lido), porAnuncio:{MLB:{ult30, ant30, variacaoPct, subiu, dias:{'AAAA-MM-DD': médio}, formatos:{formato: pedidos}}},
     *     conta:{ ult30, ant30, variacaoPct, cancelados30, porFormato:{gratis, compartilhado, extra, cancelado, compradorPaga?, full?, flex?} } }
     * bloco = { pedidos, total, medio (null sem pedido), tipico (mediana por pedido), descontoML (cheio − cobrado dos pedidos com o valor cheio) }.
     * subiu: típico dos 30 dias > típico dos 30 anteriores em mais de R$ 1 e 2% (mediana: pedido de 2 unidades não cria "subida").
     */
    SHC.freteHistorico = function (porPedido, hoje, itens, vendas30) {
        const h = hoje || SHC.hoje(), ini30 = diaMenosX(h, 29), ini60 = diaMenosX(h, 59), r2 = SHC.r2;
        const bloco = () => ({ pedidos: 0, total: 0, medio: null, tipico: null, descontoML: 0, _v: [] });
        const soma = (b, p) => { b.pedidos++; b.total = r2(b.total + p.cobrado); b._v.push(p.cobrado); if (typeof p.cheio === 'number' && p.cheio > p.cobrado) b.descontoML = r2(b.descontoML + p.cheio - p.cobrado); };
        const fecha = b => { b.medio = b.pedidos ? r2(b.total / b.pedidos) : null; b.tipico = medianaX(b._v); delete b._v; return b; };
        const varPct = (a, b) => (a.medio !== null && b.medio > 0 ? r2((a.medio - b.medio) / b.medio * 100) : null);
        const porAnuncio = {}, conta = { ult30: bloco(), ant30: bloco(), cancelados30: 0 }, fmt = {}, fmtIds = {};
        let desde = '';
        (porPedido || []).forEach(p => {
            if (!p || !p.data || p.data > h) return;
            if (!desde || p.data < desde) desde = p.data;
            if (p.cancelado) { if (p.data >= ini30) conta.cancelados30++; return; }
            const a = p.itemId ? (porAnuncio[p.itemId] || (porAnuncio[p.itemId] = { ult30: bloco(), ant30: bloco(), dias: {}, formatos: {}, _d: {} })) : null;
            if (a) { const d = a._d[p.data] || (a._d[p.data] = { t: 0, n: 0 }); d.t += p.cobrado; d.n++; }
            if (p.data >= ini30) {
                soma(conta.ult30, p);
                if (a) soma(a.ult30, p);
                if (p.formato && !p.aprox) {
                    const f = fmt[p.formato] || (fmt[p.formato] = { pedidos: 0, total: 0, anuncios: 0 });
                    f.pedidos++; f.total = r2(f.total + p.cobrado);
                    if (p.itemId) (fmtIds[p.formato] || (fmtIds[p.formato] = new Set())).add(p.itemId);
                    if (a) a.formatos[p.formato] = (a.formatos[p.formato] || 0) + 1;
                }
            } else if (p.data >= ini60) { soma(conta.ant30, p); if (a) soma(a.ant30, p); }
        });
        Object.keys(fmt).forEach(k => { fmt[k].anuncios = fmtIds[k] ? fmtIds[k].size : 0; });
        if (conta.cancelados30) fmt.cancelado = { pedidos: conta.cancelados30 };
        Object.keys(porAnuncio).forEach(id => {
            const a = porAnuncio[id];
            Object.keys(a._d).sort().forEach(d => { a.dias[d] = r2(a._d[d].t / a._d[d].n); });
            delete a._d;
            fecha(a.ult30); fecha(a.ant30);
            a.variacaoPct = varPct(a.ult30, a.ant30);
            const u = a.ult30.tipico, b = a.ant30.tipico;
            a.subiu = u !== null && b !== null && u - b > Math.max(1, b * 0.02) + 0.004;
        });
        fecha(conta.ult30); fecha(conta.ant30);
        conta.variacaoPct = varPct(conta.ult30, conta.ant30);
        // Logística e "comprador paga" pelo retrato (outra visão: um anúncio Full também aparece em "frete grátis").
        const vistos = new Set(), cp = { anuncios: 0, comTaxa: 0, somaTaxa: 0, ids: new Set() }, full = new Set(), flex = new Set();
        (itens || []).forEach(i => {
            if (!i || !i.itemId || vistos.has(i.itemId)) return;
            vistos.add(i.itemId);
            if (i.freteComprador) { cp.anuncios++; cp.ids.add(i.itemId); const t = SHC.num(i.taxaOperacional); if (t > 0) { cp.comTaxa++; cp.somaTaxa += t; } }
            if (/\bfull\b/i.test(String(i.estoque || ''))) full.add(i.itemId);
            if (typeof i.flexBonus === 'number') flex.add(i.itemId);
        });
        if (cp.anuncios) {
            const ped = vendas30 ? (vendas30 || []).filter(v => v && !v.cancelada && v.data >= ini30 && v.data <= h && cp.ids.has(v.itemId)) : null;
            const taxaDe = id => { const i = (itens || []).find(x => x && x.itemId === id); const t = i ? SHC.num(i.taxaOperacional) : null; return t > 0 ? t : 0; };
            fmt.compradorPaga = { anuncios: cp.anuncios, taxaMedia: cp.comTaxa ? r2(cp.somaTaxa / cp.comTaxa) : null,
                pedidos: ped ? ped.length : null, custoOperacional: ped ? r2(ped.reduce((s, v) => s + taxaDe(v.itemId), 0)) : null };
        }
        const porLog = ids => {
            const o = { anuncios: ids.size, pedidos: 0, total: 0 };
            ids.forEach(id => { const a = porAnuncio[id]; if (a) { o.pedidos += a.ult30.pedidos; o.total = r2(o.total + a.ult30.total); } });
            return o;
        };
        if (full.size) fmt.full = porLog(full);
        if (flex.size) fmt.flex = porLog(flex);
        conta.porFormato = fmt;
        return { hoje: h, desde: desde || null, porAnuncio, conta };
    };
    /**
     * Conciliação do frete dos últimos 30 dias. CONCILIADO = pedido vendido cuja cobrança de frete já foi lida no Faturamento E cujo
     * anúncio tem o frete conhecido no retrato (comparado com ele). pagoAMais = conciliado com frete cobrado acima do frete do anúncio
     * hoje (mais de R$ 1 e 5%; fora compartilhado e pedido de 2+ unidades exatas). Não conciliado: semCobrancaAinda (venda sem cobrança
     * de frete lida: o ML lança depois), semFreteNoAnuncio (anúncio fora do retrato ou sem frete). compradorPaga = anúncio com envio
     * por conta do comprador e sem cobrança (nada a conciliar). Cancelado não conta como venda.
     * porPedido = SHC.freteDasCobrancas; retratoPorItem = {MLB: item}; vendas30 = SHC.vendasDasCobrancas; hoje (opcional) = recorta 30 dias.
     * → { vendas, conciliados, pagoAMais:[{pedido, itemId, data, cobrado, esperado, diferenca, formato, talvezUnidades}], totalAMais,
     *     semCobrancaAinda, pedidosSemCobranca:[pedido] (até 100), semFreteNoAnuncio, compradorPaga, cancelados, freteSemVenda, faltam }
     */
    // O frete costuma vir com OUTRO número ("Venda #20000147…" no frete × "Pedido #2000018…" no Custo por vender, retrato real de
    // 25/09/2026): sem o mesmo número, o frete casa com a venda do MESMO anúncio, sem par, feita até FRETE_PAR_DIAS antes (a mais próxima).
    // Frete que não achar venda nunca vira venda: conta em freteSemVenda. ponytail: par por anúncio+data é aproximado (2 vendas do mesmo
    // anúncio no mesmo dia podem trocar de frete); o Fechamento continua casando só pelo número (nunca aponta cobrança por um par suposto).
    SHC.FRETE_PAR_DIAS = 20;
    SHC.conciliaFrete = function (porPedido, retratoPorItem, vendas30, hoje) {
        const ini = hoje ? diaMenosX(hoje, 29) : '', dentro = d => !ini || (!!d && d >= ini && d <= hoje), r2 = SHC.r2;
        const fp = {}, uni = {}, it = retratoPorItem || {}, vend = {}, usada = new Set(), soltos = [];
        const fretes = (porPedido || []).filter(p => p && p.pedido), numFrete = new Set(fretes.map(p => p.pedido)), porAn = {};
        (vendas30 || []).forEach(v => { if (v && v.pedido && v.data && (!hoje || v.data <= hoje)) vend[v.pedido] = v; });
        Object.keys(vend).forEach(k => { const v = vend[k]; if (!numFrete.has(k) && v.itemId) (porAn[v.itemId] || (porAn[v.itemId] = [])).push(k); });
        fretes.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0)).forEach(p => {
            let k = vend[p.pedido] && !usada.has(p.pedido) ? p.pedido : null;
            if (!k && p.itemId && p.data) {
                const lim = diaMenosX(p.data, SHC.FRETE_PAR_DIAS);
                (porAn[p.itemId] || []).forEach(q => {
                    const v = vend[q];
                    if (usada.has(q) || v.data > p.data || v.data < lim || !!v.cancelada !== !!p.cancelado) return;   // cancelado só com cancelado
                    if (!k || v.data > vend[k].data) k = q;
                });
            }
            if (k) { usada.add(k); fp[k] = p; } else if (dentro(p.data)) soltos.push(p);
        });
        Object.keys(vend).forEach(k => { const v = vend[k]; if (dentro(v.data)) uni[k] = { itemId: v.itemId || '', cancelada: !!v.cancelada }; });
        const out = { vendas: 0, conciliados: 0, pagoAMais: [], totalAMais: 0, semCobrancaAinda: 0, pedidosSemCobranca: [], semFreteNoAnuncio: 0, compradorPaga: 0, cancelados: 0, faltam: 0 };
        Object.keys(uni).sort().forEach(k => {
            const p = fp[k], u = uni[k], id = (p && p.itemId) || u.itemId, a = id ? it[id] : null;
            if ((p && p.cancelado) || u.cancelada) { out.cancelados++; return; }   // venda cancelada com frete não devolvido: é o Fechamento que aponta
            out.vendas++;
            if (!p) {
                if (a && a.freteComprador) out.compradorPaga++;
                else { out.semCobrancaAinda++; if (out.pedidosSemCobranca.length < 100) out.pedidosSemCobranca.push(k); }
                return;
            }
            if (!a || (!a.freteComprador && !(typeof a.frete === 'number' && isFinite(a.frete)))) { out.semFreteNoAnuncio++; return; }
            out.conciliados++;
            const esperado = a.freteComprador ? 0 : a.frete;
            if (!(esperado > 0) || p.formato === 'compartilhado' || p.aprox) return;   // aprox: sem o formato (versão anterior), não aponta
            const dif = r2(p.cobrado - esperado), razao = p.cobrado / esperado;
            if (dif > Math.max(1, esperado * 0.05) && !variasUn(razao)) out.pagoAMais.push({ pedido: k, itemId: id, data: p.data, cobrado: p.cobrado, esperado, diferenca: dif, formato: p.formato, talvezUnidades: razao >= 1.6 });
        });
        out.pagoAMais.sort((a, b) => b.diferenca - a.diferenca);
        out.totalAMais = r2(out.pagoAMais.reduce((s, x) => s + x.diferenca, 0));
        out.pagoAMais = out.pagoAMais.slice(0, 200);
        out.freteSemVenda = soltos.filter(p => !p.cancelado).length;   // venda fora do período lido (ou sem o anúncio): não é venda nova
        out.faltam = out.semCobrancaAinda + out.semFreteNoAnuncio;
        return out;
    };

    // ── v2.3: Full (Métricas › Estoque Full + Gestão de estoque Full), mapeado ao vivo em 24/09/2026 (AMB MOVE) ──
    // Cada conta mostra o Full de um jeito: nada de posição fixa; lê por id/título e guarda o texto do ML quando não reconhece.
    const semTags = s => String(s === null || s === undefined ? '' : s).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' ')
        .replace(/\*\*/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 300);
    const inteiro = t => { const m = /-?\d[\d.]*/.exec(String(t === null || t === undefined ? '' : t)); return m ? parseInt(m[0].replace(/\./g, ''), 10) : null; };
    // Textos curtos de um bloco (title/text/label/description/content), em largura
    function textosDe(o, lim) {
        const out = [], fila = [o];
        for (let i = 0; i < fila.length && i < 5000 && out.length < lim; i++) {
            const x = fila[i];
            if (!x || typeof x !== 'object') continue;
            for (const k in x) {
                const v = x[k];
                if (typeof v === 'string') { if (/^(title|text|label|description|content)$/.test(k) && v.trim()) out.push(semTags(v)); }
                else if (v && typeof v === 'object') fila.push(v);
            }
        }
        return out.filter(Boolean).slice(0, lim);
    }
    // Colunas da tabela de estoque → campo (por id da coluna ou pelo texto do cabeçalho). A ordem importa (não aptas antes de aptas).
    const COLUNAS_FULL = [
        ['produto', /^(product|produto)$/], ['vendas30', /sales|^vendas/], ['estoqueMedio', /average|estoque medio/],
        ['aCaminho', /on the way|a caminho/], ['naoAptas', /not suitable|nao aptas/], ['aptas', /suitable|aptas/],
        ['diasAteEsgotar', /sell out|esgotar/], ['tempoEstoque', /aging|tempo de estoque/], ['acaoSugerida', /recom|^acao/],
    ];
    const campoFull = t => { const n = SHC.normalizaTitulo(t); if (!n) return ''; const c = COLUNAS_FULL.find(x => x[1].test(n)); return c ? c[0] : ''; };

    function produtoFull(p, headers) {
        const porId = {};
        headers.forEach(h => { if (h && h.id) porId[h.id] = h; });
        const col = {}, outras = [];
        (p.columns || []).forEach((c, k) => {
            if (!c || typeof c !== 'object') return;
            const h = porId[c.id] || headers[k] || {};
            const f = campoFull(c.id) || campoFull(h.text) || campoFull(h.id);
            const d = c.data || {};
            if (f && !(f in col)) col[f] = d;
            else if (!f && d.text !== undefined) outras.push({ titulo: semTags(h.text || c.id), texto: semTags(d.text) });
        });
        const pd = col.produto || {}, idf = pd.identifiers || {};
        const codigos = x => ((x && x.codes) || []).map(c => String((c && c.value) || '').trim()).filter(v => v && v !== '#');
        const itemIds = codigos(idf.publications).map(v => /^#?(?:MLB)?-?(\d{6,14})$/i.exec(v)).filter(Boolean).map(m => 'MLB' + m[1]);
        const txt = f => (col[f] && col[f].text !== undefined ? semTags(col[f].text) : '');
        const un = f => (col[f] ? inteiro(col[f].text) : null);
        const recs = ((col.acaoSugerida && col.acaoSugerida.recommendations) || []).map(r => semTags(r && (r.text || r.label))).filter(Boolean);
        if (!recs.length && txt('acaoSugerida')) recs.push(txt('acaoSugerida'));
        const esgota = txt('diasAteEsgotar'), dias = /(\d+)\s*dia/i.exec(esgota);
        return {
            produtoId: String(p.id || ''), itemId: itemIds[0] || '', itemIds,
            titulo: semTags(pd.title), sku: codigos(idf.sku)[0] || '',
            ean: codigos(idf.universalCode).map(v => v.replace(/\D/g, '')).find(v => /^\d{8,14}$/.test(v)) || '',
            variacao: (Array.isArray(pd.variationDetail) ? pd.variationDetail : []).map(semTags).filter(Boolean).join(' · '),
            vendas30: un('vendas30'), estoqueMedio: un('estoqueMedio'), aCaminho: un('aCaminho'), naoAptas: un('naoAptas'), aptas: un('aptas'),
            tempoEstoque: un('tempoEstoque'), diasAteEsgotar: dias ? +dias[1] : null, esgotarTexto: esgota,   // "Sem estoque" fica no texto
            acaoSugerida: recs[0] || '', status: semTags(pd.productStatus && (pd.productStatus.label || pd.productStatus.text)),
            tamanho: semTags(pd.segmentPill && pd.segmentPill.text), avisos: recs, colunasML: outras,
            _recIds: ((col.acaoSugerida && col.acaoSugerida.recommendations) || []).map(r => String((r && r.id) || '')),
        };
    }

    /**
     * Full da conta → { temFull, vazio, espaco, mesesEspaco, pontuacao, produtos, totalProdutos, avisos, custosEstoqueAntigo? }
     *   pageData = JSON de /metricas/stock-full/api/metrics/page-data (ou o estado que o contém);
     *   content  = JSON de /stock-management/space-management/api/content, ou uma lista de páginas dele.
     * Números como o ML mostra (unidades, pontos); o que não é número fica no texto do ML.
     */
    SHC.mlFullDoEstado = function (pageData, content) {
        const pd = primeiroEmLargura(pageData, o => (o.newStorageSpace || o.purchasedAssignedSpaceSummary || o.newCurrentQualityStock) ? o : undefined, 6) || {};
        const paginas = [].concat(content || []).map(c => primeiroEmLargura(c, o => (o.stockTable || o.stockDistributionSpaceFcv) ? o : undefined, 6)).filter(Boolean);

        // Uso do espaço: page-data (com ids e o "Você pode enviar até"); senão o resumo da tela de estoque.
        const segs = (pd.newStorageSpace && Array.isArray(pd.newStorageSpace.segments)) ? pd.newStorageSpace.segments
            : ((paginas[0] && paginas[0].stockDistributionSpaceFcv && paginas[0].stockDistributionSpaceFcv.segmentsSection) || {}).segments || [];
        const espaco = segs.filter(s => s && typeof s === 'object').map(s => {
            const tituloML = semTags(s.title || s.segmentTitle);
            const cap = /(\d[\d.]*)\s*un\.?\s*de\s*(\d[\d.]*)/i.exec(String(s.capacityText || s.segmentCapacityText || ''));
            const cel = String((s.tooltip && s.tooltip.content) || '').match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [], linhas = {};
            for (let k = 0; k + 1 < cel.length; k += 2) linhas[SHC.normalizaTitulo(semTags(cel[k]))] = inteiro(semTags(cel[k + 1]));
            const pct = typeof s.percentage === 'number' ? s.percentage : inteiro((/(-?\d+)\s*%/.exec(tituloML) || [])[1]);
            return {
                id: String(s.id || ''), titulo: tituloML.replace(/:\s*-?\d+([.,]\d+)?\s*%\s*$/, ''), usado: cap ? inteiro(cap[1]) : null, capacidade: cap ? inteiro(cap[2]) : null,
                pct, livre: linhas['voce pode enviar ate'] !== undefined ? linhas['voce pode enviar ate'] : null,
                noFull: linhas['no full'] !== undefined ? linhas['no full'] : null, pendente: linhas['entrada pendente'] !== undefined ? linhas['entrada pendente'] : null,
                status: String(s.occupationStatus || ''),
            };
        });

        const pa = pd.purchasedAssignedSpaceSummary || {};
        const mesesEspaco = (pa.cards || []).filter(c => c && typeof c === 'object').map(c => ({
            mes: semTags(c.title), pill: semTags(c.subtitlePill && c.subtitlePill.text),
            motivo: semTags(c.subtitlePill && c.subtitlePill.tooltip && c.subtitlePill.tooltip.content),
            segmentos: (c.segments || []).filter(Boolean).map(s => ({ id: String(s.id || ''), titulo: semTags(s.title), unidades: inteiro(s.units) })),
        }));

        // Pontuação ("Desempenho no Full"): cards da aba com cards; senão a tabela de descrição.
        const qs = pd.newCurrentQualityStock || {}, aba = (qs.tabs || []).find(t => t && Array.isArray(t.cards)) || {};
        const score = aba.newScoreQualityStock || ((qs.tabs || []).find(t => t && t.newScoreQualityStock) || {}).newScoreQualityStock || {};
        const pontosDe = t => { const m = /(-?\d+)\s*(?:\/|de)\s*(\d+)/.exec(String(t || '')); return m ? { pontos: +m[1], max: +m[2] } : { pontos: null, max: null }; };
        const cards = (aba.cards || []).filter(Boolean).map(c => Object.assign({ titulo: semTags(c.title) }, pontosDe(c.pill || c.altPill),
            { texto: semTags(c.description || c.altDescription || ''), periodo: semTags(c.timePeriod) }));
        if (!cards.length) (score.descriptionTable || []).filter(Boolean).forEach(d => cards.push(Object.assign({ titulo: semTags(d.text) }, pontosDe(d.value), { texto: '', periodo: '' })));
        const cm = (score.speedometer && score.speedometer.centeredMetric) || {};
        const pontuacao = { cards, titulo: semTags(score.title) };
        if (inteiro(cm.value) !== null) { pontuacao.total = inteiro(cm.value); pontuacao.max = inteiro((/de\s*(\d+)/.exec(String(cm.srLabel || '')) || [])[1]) || 100; }
        const ban = score.improveYourScoreBanner;
        if (ban && !ban.disabled && ban.title) pontuacao.dica = semTags(ban.title + ' ' + (ban.description || ''));

        // Produtos de todas as páginas (sem repetir), colunas pelo cabeçalho.
        const produtos = [], vistos = new Set();
        let totalProdutos = null;
        paginas.forEach(pg => {
            const st = pg.stockTable || {}, headers = Array.isArray(st.headers) ? st.headers : [];
            (st.products || []).forEach(p => {
                if (!p || typeof p !== 'object') return;
                const x = produtoFull(p, headers), k = x.produtoId + '|' + x.variacao + '|' + x.titulo;
                if (!vistos.has(k)) { vistos.add(k); produtos.push(x); }
            });
            const rc = pg.filterCounterSection && pg.filterCounterSection.resultsCounter;
            if (rc && typeof rc.value === 'number' && totalProdutos === null) totalProdutos = rc.value;
        });
        // Avisos da CONTA (ex.: "Resolva o problema fiscal da conta."): recomendação que fala da conta, sem repetir.
        const avisos = [];
        produtos.forEach(p => {
            p.avisos.forEach((t, i) => { if ((/seller/i.test(p._recIds[i] || '') || /\bconta\b/i.test(t)) && avisos.indexOf(t) < 0) avisos.push(t); });
            delete p._recIds;
        });

        const temFull = espaco.some(s => s.capacidade > 0 || s.usado > 0) || produtos.length > 0 || mesesEspaco.some(m => m.segmentos.some(s => s.unidades > 0));
        // pageDataLido/tabelaLida: o ML respondeu num formato conhecido (o fundo não grava por cima do retrato sem isso).
        const out = { temFull, vazio: '', espaco, mesesEspaco, pontuacao, produtos, totalProdutos, avisos,
            pageDataLido: Object.keys(pd).length > 0, tabelaLida: paginas.some(p => p.stockTable) };
        // Sem Full (ex.: "Faça seu primeiro envio para o Full"): guarda a frase do próprio ML — só a frase de estado vazio,
        // nunca um texto qualquer com "Full" (tela mudada não pode virar "esta conta não usa o Full").
        if (!temFull) out.vazio = textosDe(pageData, 60).concat(textosDe(content, 60)).find(x => /primeiro envio|ainda n[ãa]o (usa|tem)|comece a usar/i.test(x)) || '';
        // "Custos por estoque antigo": bloco ainda não visto com dados (A CONFIRMAR AO VIVO) — guarda os textos do ML.
        const antigo = primeiroEmLargura([pageData, content], o => Object.keys(o).some(k => typeof o[k] === 'string' && /estoque antigo/i.test(o[k])) ? o : undefined, 8);
        if (antigo) out.custosEstoqueAntigo = { textos: textosDe(antigo, 20) };
        return out;
    };

    // ══ v2.4: Mercado Ads, fechamento do mês, faturas, vendas brutas, repasse do Mercado Pago e alertas ══
    // Mercado Ads: tela em ads.mercadolivre.com.br, dados em https://pa.mercadolivre.com.br/pa/api/admin-pads/ajax/… (JSON pela
    // sessão), mapeado ao vivo em 24/09/2026 (AMB MOVE). Os leitores recebem a RESPOSTA da API (não o retrato com {conta,url}).
    const numOuNull = v => SHC.num(v);
    const n0 = v => SHC.num(v) || 0;
    const dia10 = v => { const s = String(v || ''); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : ''; };
    // Métricas no nome do ML → nomes do Copiloto. ctr, acos, tacos, cvr, sov já vêm em % (0,32 = 0,32%); roas em "x".
    function metricasAds(m) {
        m = m || {};
        const alt = (a, b) => (m[a] !== undefined ? m[a] : m[b]);
        const impressoes = n0(alt('prints', 'impressions')), cliques = n0(m.clicks), custo = SHC.r2(n0(m.cost));
        const receita = SHC.r2(n0(alt('totalAmount', 'amountTotal')));
        const ou = (v, calc) => { const n = numOuNull(v); return n !== null ? n : calc; };
        return {
            impressoes, cliques, custo, cpc: ou(m.cpc, cliques ? SHC.r2(custo / cliques) : null),
            ctr: ou(m.ctr, impressoes ? SHC.r2(cliques / impressoes * 100) : null),
            receita, receitaDireta: SHC.r2(n0(alt('directAmount', 'amountDirect'))), receitaIndireta: SHC.r2(n0(alt('indirectAmount', 'amountIndirect'))),
            vendas: n0(alt('unitsQuantity', 'soldQuantityTotal')), vendasDiretas: n0(alt('directUnitsQuantity', 'soldQuantityDirect')),
            vendasIndiretas: n0(alt('indirectUnitsQuantity', 'soldQuantityIndirect')),
            vendasOrganicas: numOuNull(m.organicUnitsQuantity), receitaOrganica: numOuNull(m.organicUnitsAmount),
            acos: ou(m.acos, receita > 0 ? SHC.r2(custo / receita * 100) : null),
            tacos: numOuNull(m.tacos), roas: ou(m.roas, custo > 0 ? SHC.r2(receita / custo) : null),
            cvr: numOuNull(m.cvr), sov: numOuNull(m.sov),
        };
    }
    SHC.adsMetricas = metricasAds;
    const listaResultados = j => (j && Array.isArray(j.results)) ? j.results : [];
    const totalPaging = (j, n) => { const t = j && j.paging && j.paging.total; return typeof t === 'number' ? t : n; };
    const idTxt = v => (v !== undefined && v !== null ? String(v) : '');

    /** campaigns/search → { total, campanhas:[{id, nome, status, estrategia, acosObjetivo, roasObjetivo, orcamentoDiario, …, metricas}] } */
    SHC.adsCampanhas = function (j) {
        const campanhas = listaResultados(j).filter(c => c && c.id !== undefined).map(c => ({
            id: String(c.id), nome: String(c.name || '').slice(0, 120), status: String(c.status || ''), estrategia: String(c.strategy || ''),
            acosObjetivo: numOuNull(c.acosTarget), roasObjetivo: numOuNull(c.roasTarget),
            orcamento: numOuNull(c.budget), orcamentoDiario: numOuNull(c.dailyBudget !== undefined ? c.dailyBudget : c.budget),
            orcamentoAutomatico: c.automaticBudget === true, canal: String(c.channel || ''),
            criada: dia10(c.dateCreated), atualizada: dia10(c.lastUpdated), advertiserId: idTxt(c.advertiserId),
            gruposVisiveis: numOuNull(c.visibleAdGroupCount), metricas: metricasAds(c.metrics),
        }));
        return { total: totalPaging(j, campanhas.length), campanhas };
    };

    /** ads (anúncios patrocinados, POR ANÚNCIO) → { total, anuncios:[{itemId, titulo, status, campanhaId, campanha, …métricas}] } */
    // Anúncio de catálogo: a API manda o id do PRODUTO de catálogo (MLB + até 8 dígitos, type 'catalog', userId 0, sem permalink),
    // não o MLB do anúncio do seller → itemId vazio, produtoCatalogoId com o id, catalogoProduto true (os consumidores dizem
    // "anúncio de catálogo: o ML não diz qual anúncio seu é"). A CONFIRMAR AO VIVO: se alguma resposta traz o MLB do seller.
    SHC.adsAnuncios = function (j) {
        const anuncios = listaResultados(j).filter(a => a && /^[A-Z]{3}\d{6,14}$/.test(String(a.id || a.externalId || ''))).map(a => {
            const id = String(a.id || a.externalId), cat = a.type === 'catalog' || (/^MLB\d{1,8}$/.test(id) && Number(a.userId) === 0);
            return Object.assign({
            itemId: cat ? '' : id, catalogoProduto: cat, produtoCatalogoId: cat ? id : '', titulo: String(a.title || '').slice(0, 200), status: String(a.status || ''),
            nivel: String(a.currentLevel || ''), tipo: String(a.type || ''), catalogo: a.catalogListing === true, ganhaBuyBox: a.buyBoxWinner === true,
            campanhaId: idTxt(a.campaignId !== undefined ? a.campaignId : (a.campaign && a.campaign.id)),
            campanha: String((a.campaign && a.campaign.name) || '').slice(0, 120),
            foto: /^https:\/\//.test(String(a.thumbnail || '')) ? String(a.thumbnail) : '',
            tags: (a.item && Array.isArray(a.item.tags)) ? a.item.tags.map(String).slice(0, 10) : [],
            precoParaGanhar: a.item ? numOuNull(a.item.priceToWin) : null, advertiserId: idTxt(a.advertiserId),
            }, metricasAds(a));
        });
        return { total: totalPaging(j, anuncios.length), anuncios };
    };

    /** campaigns/<id>/metrics → "Desempenho ao competir por impressões" em % (0,03 → 3%). */
    SHC.adsShare = function (j) {
        if (!j || typeof j !== 'object' || j.impressionShare === undefined) return null;
        const vals = [j.impressionShare, j.lostImpressionShareByBudget, j.lostImpressionShareByAdRank, j.topImpressionShare].map(numOuNull);
        const fracao = vals.every(v => v === null || v <= 1);   // a API manda fração; se um dia vier em %, não multiplica
        const pc = v => (v === null ? null : Math.round((fracao ? v * 100 : v) * 100) / 100);
        return { ganhas: pc(vals[0]), perdidasOrcamento: pc(vals[1]), perdidasClassificacao: pc(vals[2]), topo: pc(vals[3]) };
    };

    /** campaigns/metrics (e …/comparison) → { total: métricas do período, diario:[{data, …métricas}] } | null */
    SHC.adsResumo = function (j) {
        const s = j && j.summary && j.summary.metricsSummary;
        if (!s) return null;
        const diario = ((j.daily && j.daily.results) || []).filter(d => d && dia10(d.date)).map(d => Object.assign({ data: dia10(d.date) }, metricasAds(d)));
        return { total: metricasAds(s), diario };
    };

    /**
     * ACOS de equilíbrio de um anúncio = % do preço que sobra ANTES do Ads (SHC.sobraAnuncio). Gastar mais que isso em Ads = prejuízo.
     * → { equilibrio (%), sobraAntes (R$ por venda) } ou null sem custo/preço.
     */
    SHC.adsEquilibrio = function (item, custoDados, cfg) {
        const s = item ? SHC.sobraAnuncio(item, custoDados, cfg) : null;
        return s && s.sobra !== null ? { equilibrio: s.pct, sobraAntes: s.sobra } : null;
    };

    // ── Fechamento do mês: TODAS as cobranças do Faturamento por tipo (estorno com sinal negativo) ──
    /** detail_1 do Faturamento → tipo do fechamento. "Cancelamento …" cai no mesmo tipo (o estorno é o sinal). */
    SHC.tipoCustoFechamento = function (t) {
        const s = String(t || '').replace(/^\s*cancelamento\s+(d[oa]s?|de)\s+/i, '');
        if (/seguidores/i.test(s)) return 'ads_seguidores';
        if (/product ads|publicidad/i.test(s)) return 'ads';
        if (/tarifa (de|por) envio|envios?\b/i.test(s)) return 'frete';
        if (/custo por vender/i.test(s)) return 'tarifa_venda';
        if (/custo por cobrar/i.test(s)) return 'cobranca_mp';
        if (/parcelamento/i.test(s)) return 'parcelamento';
        if (/taxa de recebimento/i.test(s)) return 'recebimento';
        return 'outro';
    };
    SHC.TIPOS_FECHAMENTO = ['tarifa_venda', 'cobranca_mp', 'parcelamento', 'recebimento', 'frete', 'ads', 'ads_seguidores', 'outro'];
    /**
     * Cobranças de SHC.mlCobrancasDaResposta (TODAS, sem filtro) → { 'AAAA-MM': {mes, porTipo, estornos, total, qtdVendas, pedidos} }.
     * porTipo = cobrado − estornado de cada tipo; estornos ≤ 0; total = soma de porTipo. Ads no mês do dia das visitas (dataRef).
     * pedidos {orderId: {tipo: valor}} só dos meses ≥ desdePedidos ('AAAA-MM'). qtdVendas = "Custo por vender" − cancelamentos do mês.
     * v2.4.4: porOrigem[tipo] = {venda, fatura} (o mesmo valor de porTipo[tipo] dividido por origemPagamento; sem origem = 'fatura') e
     * porDia['AAAA-MM-DD'] = total do dia da COBRANÇA (c.data), para o rateio das faturas. porTipo[tipo] continua número (quem lê não muda).
     */
    SHC.fechamentoDasCobrancas = function (cobs, desdePedidos) {
        const out = {};
        (cobs || []).forEach(c => {
            const d = c && (c.dataRef || c.data);
            if (!d || !/^\d{4}-\d{2}/.test(d) || !(c.valor >= 0)) return;
            const mes = d.slice(0, 7), tipo = SHC.tipoCustoFechamento(c.texto);
            const est = c.estorno !== undefined ? !!c.estorno : /^cancelamento/i.test(c.texto || '');
            const v = est ? -c.valor : c.valor;
            const f = out[mes] || (out[mes] = { mes, porTipo: {}, porOrigem: {}, porDia: {}, estornos: 0, total: 0, qtdVendas: 0, pedidos: {} });
            f.porTipo[tipo] = (f.porTipo[tipo] || 0) + v;
            const o = f.porOrigem[tipo] || (f.porOrigem[tipo] = { venda: 0, fatura: 0 });
            o[c.origemPagamento === 'venda' ? 'venda' : 'fatura'] += v;
            if (/^\d{4}-\d{2}-\d{2}$/.test(c.data || '')) f.porDia[c.data] = (f.porDia[c.data] || 0) + v;
            f.total += v;
            if (est) f.estornos += v;
            if (tipo === 'tarifa_venda') f.qtdVendas += est ? -1 : 1;
            if (c.orderId && desdePedidos && mes >= desdePedidos) { const p = f.pedidos[c.orderId] || (f.pedidos[c.orderId] = {}); p[tipo] = SHC.r2((p[tipo] || 0) + v); }
        });
        Object.keys(out).forEach(m => {
            const f = out[m];
            Object.keys(f.porTipo).forEach(t => { f.porTipo[t] = SHC.r2(f.porTipo[t]); });
            Object.keys(f.porOrigem).forEach(t => { const o = f.porOrigem[t]; o.venda = SHC.r2(o.venda); o.fatura = SHC.r2(o.fatura); o.total = f.porTipo[t]; });
            Object.keys(f.porDia).forEach(d => { f.porDia[d] = SHC.r2(f.porDia[d]); });
            f.total = SHC.r2(f.total); f.estornos = SHC.r2(f.estornos); f.qtdVendas = Math.max(0, f.qtdVendas);
        });
        return out;
    };

    // ── v2.4.4: fatura × mês do calendário (rateio). A fatura fecha num dia fixo por conta (AMB MOVE: 22), nunca no fim do mês. ──
    /** Dia de fechamento da conta = o dia que mais se repete nas faturas (fechamento 'AAAA-MM-DD'); null sem faturas. */
    SHC.diaFechamento = function (faturas) {
        const n = {};
        (faturas || []).forEach(f => { const d = /^\d{4}-\d{2}-(\d{2})$/.exec(String((f && f.fechamento) || '')); if (d) n[+d[1]] = (n[+d[1]] || 0) + 1; });
        const dias = Object.keys(n).map(Number).sort((a, b) => (n[b] - n[a]) || (b - a));   // empate: o mais recente costuma ser o maior (mês curto)
        return dias.length ? dias[0] : null;
    };
    const diaISO = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);   // Date.UTC aceita mês fora de 0..11 e dia > fim do mês
    const ultimoDia = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    /** Ciclo da fatura do mês 'AAAA-MM' que fecha no dia N: {de: dia N+1 do mês anterior, ate: dia N do mês} (dia além do fim do mês = último dia). */
    SHC.cicloFatura = function (dia, mesFatura) {
        const m = /^(\d{4})-(\d{2})/.exec(String(mesFatura || ''));
        if (!m || !(dia >= 1)) return null;
        const y = +m[1], k = +m[2] - 1;
        const ate = diaISO(y, k, Math.min(dia, ultimoDia(y, k))), de = diaISO(y, k - 1, Math.min(dia, ultimoDia(y, k - 1)) + 1);
        return { de, ate };
    };
    /**
     * Rateio: cada fatura = soma das cobranças do ciclo, por mês do calendário, conferida com o total da fatura (billAmount).
     * cobrancasPorDia = {'AAAA-MM-DD': valor líquido do dia} (porDia dos fech:<conta>:<mês> juntados); faturas = SHC.mlFaturas().faturas;
     * dia = SHC.diaFechamento; mesesLidos (opcional) = meses do Faturamento lidos inteiros — mês do ciclo fora deles → incompleto.
     * → [{fatura (mês), nome, fechamento, ciclo:{de, ate}, total, porMes:{'AAAA-MM': valor}, totalFatura, conferido, diferenca, incompleto, linkDetalhe}]
     * diferença > R$ 1 = aviso (pode ser estorno de fatura anterior, cobrança de outro dia); nunca é "erro" do ML.
     */
    /** porDia de todos os fech (fechs = {'AAAA-MM': fech|null}) SOMADO: o mesmo dia aparece em 2 meses (Ads do dia 1º vai para o mês das visitas).
     *  Mês sem porDia (versão anterior) = não lido. → { porDia, lidos } */
    SHC.porDiaDosFechs = function (fechs) {
        const porDia = {}, lidos = [];
        Object.keys(fechs || {}).forEach(m => {
            const f = fechs[m]; if (!f || !f.porDia) return;
            lidos.push(m);
            Object.keys(f.porDia).forEach(d => { porDia[d] = SHC.r2((porDia[d] || 0) + (SHC.num(f.porDia[d]) || 0)); });
        });
        return { porDia, lidos };
    };
    SHC.rateioFaturas = function (cobrancasPorDia, faturas, dia, mesesLidos) {
        const pd = cobrancasPorDia || {}, lidos = Array.isArray(mesesLidos) ? new Set(mesesLidos) : null;
        return (faturas || []).filter(f => f && /^\d{4}-\d{2}$/.test(String(f.mes || ''))).map(f => {
            const ciclo = SHC.cicloFatura(dia, f.mes);
            if (!ciclo) return null;
            const porMes = {};
            let total = 0, incompleto = false;
            for (let t = Date.parse(ciclo.de + 'T12:00:00Z'); ; t += 864e5) {
                const d = new Date(t).toISOString().slice(0, 10);
                if (d > ciclo.ate) break;
                const m = d.slice(0, 7);
                if (lidos && !lidos.has(m)) incompleto = true;
                const v = SHC.num(pd[d]) || 0;
                porMes[m] = SHC.r2((porMes[m] || 0) + v);
                total += v;
            }
            total = SHC.r2(total);
            const tf = SHC.num(f.total), diferenca = tf === null ? null : SHC.r2(total - tf);
            return { fatura: f.mes, nome: f.nome || '', fechamento: f.fechamento || '', ciclo, total, porMes, totalFatura: tf,
                conferido: !incompleto && diferenca !== null && Math.abs(diferenca) <= 1, diferenca, incompleto, linkDetalhe: f.linkDetalhe || '' };
        }).filter(Boolean);
    };

    // ── Faturas por mês (/billing/resume/api/initial-group-one e initial-group-two), mapeado ao vivo em 24/09/2026 ──
    const valorDe = (dados, txt) => { const v = dados ? valorCobranca(dados) : null; return v !== null ? v : (txt ? SHC.valorRS(txt) : null); };
    const linkML = u => (!u ? '' : /^https:\/\//.test(u) ? String(u) : /^\//.test(u) ? 'https://vendedores.mercadolivre.com.br' + u : '');
    /**
     * → { faturas:[{mes, nome, fechamento, vencimento, total, divida, pago, aPagar, quitado, status, aberta, linkDetalhe,
     *               notas:{titulo, url (aba ?fiscalTab=true), pendente (o ML ainda não emitiu: "Vamos te avisar quando…")} | null}],
     *     atual:{nome, fechamento, vencimento, acumulado, valor, status, linkDetalhe} | null (fatura EM ANDAMENTO), aDebitar (debtPeriod) | null }
     * aPagar = divida (amountData) e quitado = pago (paymentsAmountData, sempre positivo): nomes da tela, os antigos continuam.
     */
    SHC.mlFaturas = function (g1, g2) {
        const cp = g1 && g1.currentPeriod, cl = g2 && g2.closedPeriod, dp = g1 && g1.debtPeriod;
        const faturas = ((cl && cl.results) || []).filter(Boolean).map(r => {
            const b = r.balanceInformation || {}, mi = b.moreInfo || {}, bd = r.downloadDocsInfo && r.downloadDocsInfo.billDocs;
            const divida = valorDe(b.amountData, b.amount), pago = valorDe(mi.paymentsAmountData, mi.paymentsAmount);
            return {
                mes: /^\d{4}-\d{2}/.test(String(r.key || '')) ? String(r.key).slice(0, 7) : '', nome: String(r.monthName || ''),
                fechamento: SHC.mlDataPt(r.closeInformation && r.closeInformation.date), vencimento: SHC.mlDataPt(r.expirationInformation && r.expirationInformation.date),
                total: valorDe(mi.billAmountData, mi.billAmount), divida, pago, aPagar: divida, quitado: pago,
                status: String((r.status && r.status.label) || ''), aberta: r.isOpen === true, linkDetalhe: linkML(r.redirection && r.redirection.url),
                notas: bd ? { titulo: String(bd.title || ''), url: linkML(bd.url), pendente: /vamos te avisar quando/i.test(String((bd.tooltip && bd.tooltip.text) || '')) } : null,
            };
        }).filter(f => f.mes);
        const bi = (cp && cp.balanceInformation) || {}, acumulado = valorDe(bi.amountData, bi.amount);
        const atual = cp ? {
            nome: String(cp.monthName || ''), fechamento: SHC.mlDataPt(cp.closeInformation && cp.closeInformation.date),
            vencimento: SHC.mlDataPt(cp.expirationInformation && cp.expirationInformation.date),
            acumulado, valor: acumulado, status: String((cp.status && cp.status.label) || ''), linkDetalhe: linkML(cp.redirection && cp.redirection.url),
        } : null;
        return { faturas, atual, aDebitar: dp ? valorDe(dp.amountData, dp.amount) : null };
    };

    /**
     * Notas fiscais de UMA fatura (GET /billing/detail/api/filters-downloads-info/<AAAAMMDD do fechamento>/bricks?userId=<conta>),
     * mapeado ao vivo em 25/09/2026: filters_and_downloads.data.searchInfo.invoices[]. O download é um botão do ML (sem URL fixa):
     * o Copiloto lista e leva à aba ?fiscalTab=true da fatura.
     * → [{concept, amount, emissao, de, ate, numero, municipio, tipo, arquivo, status, cancelamento}] | null (formato desconhecido: não grava)
     */
    const dataNota = t => { const s = String(t || ''); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : (SHC.mlDataPt(s) || s); };
    SHC.mlNotasFiscais = function (j) {
        const si = j && j.filters_and_downloads && j.filters_and_downloads.data && j.filters_and_downloads.data.searchInfo;
        const lista = si && Array.isArray(si.invoices) ? si.invoices
            : primeiroEmLargura(j, o => (o.searchInfo && Array.isArray(o.searchInfo.invoices)) ? o.searchInfo.invoices : undefined, 6);
        if (!Array.isArray(lista)) return null;
        return lista.filter(n => n && typeof n === 'object').map(n => {
            const extra = [].concat(n.file_additional_info || []).find(x => x && x.type === 'MUNICIPALITY');
            const v = typeof n.amount === 'number' ? n.amount : valorCobranca(n.amount);
            return { concept: String(n.concept || ''), amount: v === null ? null : SHC.r2(v), emissao: dataNota(n.file_date), de: dataNota(n.dateFrom), ate: dataNota(n.dateTo),
                numero: String(n.referenceNumber || ''), municipio: extra ? String(extra.value || '') : '', tipo: String(n.invoiceType || ''),
                arquivo: String(n.fileType || ''), status: String(n.status || ''), cancelamento: n.isCancellation === true };
        });
    };

    // ── v2.8: NF-e das SUAS VENDAS (emitidas pelo Faturador ou pelo Full), capturado ao vivo em 25/09/2026 na página
    // /documents/overview/reports?start_date=AAAA-MM-DD&end_date=AAAA-MM-DD&page=N. A lista vem de um POST de CONSULTA (só busca: não cria
    // nem muda nada, como a calculadora do Simulador): SHC.NFE_URL com {startDate, endDate, typeOfReceipt:['NFE'], offset, limit}.
    // Da resposta só ficam dados da NOTA: destinatário (recipient_*), CPF/CNPJ, tipo de cliente e observação NUNCA saem daqui.
    // "Baixar relatório" (Excel) e "Baixar documentos" (PDF/XML) são botões da página do ML: o Copiloto só abre a página no mês certo.
    SHC.NFE_URL = 'https://vendedores.mercadolivre.com.br/documents/overview/api/invoice/search?boUserId=&boSiteId=';
    SHC.NFE_LIMITE = 10;          // o que a própria página do ML pede
    SHC.NFE_MAX_NOTAS = 2000;     // por mês; acima disso só os totais
    const fimMesNfe = m => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
    SHC.nfeLink = m => 'https://vendedores.mercadolivre.com.br/documents/overview/reports?start_date=' + m + '-01&end_date=' + fimMesNfe(m) + '&page=1';
    SHC.nfePedido = (m, offset) => ({ startDate: m + '-01', endDate: fimMesNfe(m), typeOfReceipt: ['NFE'], offset: offset || 0, limit: SHC.NFE_LIMITE });
    // O ML manda o status em espanhol ("Aprobada"). Status que não reconhecemos fica com o texto do ML.
    const NFE_STATUS = [[/aprob|autoriz/i, 'Autorizada'], [/cancel|anulad/i, 'Cancelada'], [/rechaz|rejeit|deneg/i, 'Rejeitada'], [/error|erro|falh/i, 'Com erro'], [/pend|proces/i, 'Pendente']];
    SHC.nfeStatusTxt = s => { const t = String(s || '').trim(), x = NFE_STATUS.find(([re]) => re.test(t)); return x ? x[1] : (t || 'Sem status'); };
    SHC.nfeComProblema = st => st === 'Rejeitada' || st === 'Com erro';
    const NFE_LOGISTICA = { fulfillment: 'Full', self_service: 'Flex', xd_drop_off: 'Agência', drop_off: 'Correios', cross_docking: 'Coleta' };
    const NFE_OPERACAO = { sale: 'Venda', return: 'Devolução' };
    /** Resposta do POST de consulta → { total, notas:[{emitidaEm, venda, status, numero, serie, tipoOperacao, logistica, valorProdutos (total − frete),
     *  valorEnvio, valorTotal, chave, temPdf, temXml, cartaCorrecao}] } | null (formato desconhecido). Nada de destinatário. */
    SHC.nfeVendasDaResposta = function (j) {
        if (!j || !Array.isArray(j.invoices)) return null;
        const v = x => { const n = SHC.num(x); return n === null ? null : SHC.r2(n); };
        const notas = j.invoices.filter(n => n && typeof n === 'object').map(n => {
            const total = v(n.total_amount), envio = v(n.ship_amount), op = String(n.fiscal_data_transaction_type || '');
            return { emitidaEm: String(n.emission_date || ''), venda: String(n.sale_number || ''), status: SHC.nfeStatusTxt(n.status),
                numero: String(n.invoice_number || ''), serie: String(n.serie || ''), tipoOperacao: NFE_OPERACAO[op] || (op ? 'Outra operação' : ''),
                logistica: NFE_LOGISTICA[n.logistic_type] || (n.logistic_type ? 'Outro envio' : ''),
                valorProdutos: total === null ? null : SHC.r2(total - (envio || 0)), valorEnvio: envio, valorTotal: total,
                chave: /^\d{44}$/.test(String(n.invoice_key || '')) ? String(n.invoice_key) : '', temPdf: n.has_pdf === true, temXml: n.has_xml === true,
                cartaCorrecao: n.has_correction_letter === true };
        });
        const total = SHC.num(j.total);
        return { total: total === null ? null : total, notas };
    };
    /** Notas lidas de um mês (todas as páginas) → o que vai para nfe:<conta>:<AAAA-MM>. Soma só as autorizadas; repetida (série + número) conta 1 vez. */
    SHC.nfeMes = function (mes, total, notas, completo) {
        const vistas = new Set(), lista = [], porStatus = {};
        let somaProdutos = 0, somaEnvio = 0, somaTotal = 0;
        (notas || []).forEach(n => {
            const k = n.serie + '-' + n.numero;
            if (!n.numero || vistas.has(k)) return;
            vistas.add(k); lista.push(n);
            porStatus[n.status] = (porStatus[n.status] || 0) + 1;
            if (n.status === 'Autorizada') { somaProdutos += n.valorProdutos || 0; somaEnvio += n.valorEnvio || 0; somaTotal += n.valorTotal || 0; }
        });
        lista.sort((a, b) => (a.emitidaEm < b.emitidaEm ? 1 : a.emitidaEm > b.emitidaEm ? -1 : 0));
        const cabe = lista.length <= SHC.NFE_MAX_NOTAS;
        return { mes, total, lidas: lista.length, completo: !!completo, porStatus, somaProdutos: SHC.r2(somaProdutos), somaEnvio: SHC.r2(somaEnvio),
            somaTotal: SHC.r2(somaTotal), notas: cabe ? lista : [], soTotais: !cabe };
    };

    // ── Vendas brutas (/api/sc-business-metrics/performance-data e gross-sales-data, formato "flox bricks") ──
    // "Vendas brutas = receita total do período sem descontar cancelamentos nem devoluções" (texto do ML).
    // Período (confirmado ao vivo em 25/09/2026): sem parâmetro = 7 dias; ?start_period=lastMonth = 31 dias; ?start_period=custom&from_current=
    // AAAA-MM-01T03:00:00.000Z&to_current=AAAA-MM-<último>T03:00:00.000Z = o mês inteiro, dia a dia (o fundo lê assim, um mês por pedido).
    /** → { dias:{'AAAA-MM-DD': {bruto, unidades, vendas, cancelado, devolvido}}, resumo:{bruto, unidades, vendas, cancelado, devolvido, visitas}, porAnuncio:[…],
     *      paginas (page_quantity da tabela por anúncio | null), temTabela (a resposta gross-sales-data trouxe a tabela) } */
    SHC.mlVendasBrutas = function (perf, gross) {
        const dias = {}, resumo = {};
        const ds = primeiroEmLargura(perf, o => (Array.isArray(o.dataset) ? o.dataset : undefined), 16) || [];
        ds.forEach(p => {
            const d = p && dia10(p.date);
            if (d) dias[d] = { bruto: n0(p.gross_sales), unidades: n0(p.sold_units), vendas: n0(p.sell_quantity), cancelado: n0(p.cancelled_gross_sales), devolvido: n0(p.returns_gross_sales) };
        });
        const itens = primeiroEmLargura(perf, o => ((Array.isArray(o.items) && o.items.some(i => i && i.id === 'gross_sales')) ? o.items : undefined), 16) || [];
        const MAP = { gross_sales: 'bruto', sold_units: 'unidades', sell_quantity: 'vendas', cancelled_gross_sales: 'cancelado', returns_gross_sales: 'devolvido', visits: 'visitas' };
        itens.forEach(i => { if (i && MAP[i.id]) resumo[MAP[i.id]] = numOuNull(i.value); });
        const tab = primeiroEmLargura(gross, o => ((o.header && Array.isArray(o.content_rows)) ? o : undefined), 16);
        const cab = ((tab && tab.header && tab.header.columns) || []).map(c => SHC.normalizaTitulo((c && c.data && c.data.label) || ''));
        const porAnuncio = ((tab && tab.content_rows) || []).filter(r => r && Array.isArray(r.columns)).map(r => {
            const prod = (r.columns.find(c => c && c.type === 'product') || {}).data || {}, it = (prod.item || [])[0] || {};
            const col = nome => { const k = cab.indexOf(nome), c = k >= 0 ? r.columns[k] : null; return c && c.data ? numOuNull(c.data.label) : null; };
            const id = /(\d{6,14})/.exec(String(it.label || ''));
            return { itemId: id ? 'MLB' + id[1] : '', titulo: String((prod.label && prod.label.text) || '').slice(0, 200), sku: SHC.normalizaSku ? SHC.normalizaSku(it.sku) : String(it.sku || ''),
                bruto: col('vendas brutas'), vendas: col('quantidade de vendas'), participacao: col('de participacao'), visitas: col('visitas'),
                unidades: col('unidades vendidas'), conversao: col('conversao') };
        }).filter(a => a.itemId);
        // v2.6: total de páginas da tabela (brick "pagination": page_quantity; 30 linhas por página, ?page_number=N) e se a tabela veio.
        const pg = primeiroEmLargura(gross, o => ((o.id === 'pagination' || o.ui_type === 'pagination') && o.data && o.data.page_quantity !== undefined ? o.data : undefined), 16);
        const paginas = pg ? numOuNull(pg.page_quantity) : null;
        return { dias, resumo, porAnuncio, paginas: paginas > 0 ? Math.round(paginas) : null, temTabela: !!tab };
    };
    /** Soma dos dias lidos de um mês → { valor, dias (quantos dias lidos), cancelado, devolvido, unidades, vendas } | null */
    SHC.vendasBrutasDoMes = function (dias, mes) {
        const ks = Object.keys(dias || {}).filter(d => d.slice(0, 7) === mes);
        if (!ks.length) return null;
        const s = { valor: 0, dias: ks.length, cancelado: 0, devolvido: 0, unidades: 0, vendas: 0 };
        ks.forEach(d => { const x = dias[d] || {}; s.valor += n0(x.bruto); s.cancelado += n0(x.cancelado); s.devolvido += n0(x.devolvido); s.unidades += n0(x.unidades); s.vendas += n0(x.vendas); });
        ['valor', 'cancelado', 'devolvido'].forEach(k => { s[k] = SHC.r2(s[k]); });
        return s;
    };

    // ── Repasse real do Mercado Pago (tela "Atividade" https://www.mercadopago.com.br/activities?operation=sales&page=N) ──
    // Confirmado ao vivo em 25/09/2026: estado embutido (_n.ctx.r) → appProps.pageProps.listData = {total, pages, groups:[{title, items}]}.
    // Item: type sale|pack|purchase…, title "Venda no Mercado Livre", status.code approved|refunded|rejected|pending,
    // amount.fraction COM SINAL ("-562") + amount.cents, creationDate ISO UTC, paymentMethod.text "Transação N".
    // Reembolso = a própria venda com status 'refunded' e valor negativo (ou 0,00). Entram só sale/pack "Venda no Mercado Livre"
    // approved (+) e refunded (−); purchase, rejected e pending ficam fora. Dia = data em Brasília (UTC−3).
    const DIA_BRT = s => { const t = Date.parse(s || ''); return isFinite(t) ? new Date(t - 3 * 3600e3).toISOString().slice(0, 10) : ''; };
    function valorMP(a) {
        if (!a || a.fraction === undefined || a.fraction === null) return null;
        const f = String(a.fraction).trim(), inteiro = f.replace(/\D/g, ''), cent = String(a.cents || '0').replace(/\D/g, '').padEnd(2, '0').slice(0, 2);
        if (!inteiro) return null;
        return SHC.r2((/^[-−]/.test(f) ? -1 : 1) * (+inteiro + +cent / 100));
    }
    /** Estado da Atividade → itens (com .blocos, .assinatura, .paginas) ou null se o estado não tem listData. */
    SHC.mpAtividadesDoEstado = function (r) {
        const ld = r && r.appProps && r.appProps.pageProps && r.appProps.pageProps.listData;
        if (!ld || !Array.isArray(ld.groups)) return null;
        const out = [], sinais = [];
        let blocos = 0;
        ld.groups.forEach(g => ((g && Array.isArray(g.items)) ? g.items : []).forEach(i => {
            if (!i || typeof i !== 'object') return;
            blocos++;
            const valor = valorMP(i.amount), code = i.status && i.status.code, data = DIA_BRT(i.creationDate);
            const tr = /(\d{4,24})/.exec(String((i.paymentMethod && i.paymentMethod.text) || '')), transacao = tr ? tr[1] : String(i.link || i.id || '');
            sinais.push([data, i.type, valor, transacao].join('/'));
            if (!/^(sale|pack)$/.test(i.type) || !/^venda no mercado livre$/i.test(String(i.title || '').trim())) return;
            if ((code !== 'approved' && code !== 'refunded') || valor === null || !data) return;
            if (code === 'refunded' && valor > 0) return;   // igual ao plano B: reembolso só ≤ 0 (o positivo fica fora)
            out.push({ data, tipo: code === 'refunded' ? 'reembolso' : 'venda', valor, transacao, titulo: String(i.description || '').slice(0, 200), status: code });
        }));
        out.blocos = blocos;
        out.assinatura = sinais.slice(0, 5).join('|');
        out.paginas = +ld.pages || 0;
        return out;
    };

    // Plano B (estado sem listData / tela mudada): leitor de texto tolerante —
    // dia ("22 de setembro"), hora, "Venda no Mercado Livre" | "Reembolso", título, "Transação <n>", status, "+ R$ 249,29" / "- R$ 562,99".
    // Só entram "Venda no Mercado Livre" e "Reembolso" não recusados/cancelados; "Compra" e o resto ficam de fora.
    const MESES_LONGOS = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
    function linhasDoHtml(html) {
        return String(html || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<(br|\/?(div|p|li|span|h\d|td|tr|a|section|article|button|time))\b[^>]*>/gi, '\n')
            .replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&')
            .split('\n').map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
    }
    function linhasDoEstado(r) {
        const out = [];
        (function a(x, p) {
            if (!x || typeof x !== 'object' || p > 30 || out.length > 20000) return;
            for (const k in x) {
                const v = x[k];
                if (typeof v === 'string') { const t = v.replace(/\s+/g, ' ').trim(); if (t && t.length < 200 && !/^https?:/.test(t)) out.push(t); } else a(v, p + 1);
            }
        })(r, 0);
        return out;
    }
    const novoItemMP = contado => ({ tipo: '', valor: null, transacao: '', titulo: '', status: '', fora: false, contado: !!contado });
    /** Linhas de texto da tela de Atividade → [{data, tipo:'venda'|'reembolso', valor (com sinal), transacao, titulo, status}] */
    SHC.mpAtividadesDasLinhas = function (linhas, hoje) {
        const h = /^(\d{4})-(\d{2})/.exec(hoje || '') || [0, String(new Date().getFullYear()), String(new Date().getMonth() + 1)];
        const out = [];
        let dia = '', cur = null, blocos = 0;   // blocos = atividades vistas (de qualquer tipo): 0 = página sem atividade
        const sinais = [];   // assinatura da página com TODAS as atividades (também as de fora), para o fundo ver página repetida
        const fecha = () => {
            if (cur && cur.contado) sinais.push([dia, cur.tipo || (cur.fora ? 'fora' : ''), cur.valor, cur.transacao].join('/'));
            // Reembolso só com valor NEGATIVO (dinheiro que sai); o positivo é estorno de compra do seller e fica fora, como Compra.
            if (cur && cur.tipo === 'reembolso' && !(cur.valor < 0)) cur.fora = true;
            if (cur && cur.tipo && cur.valor !== null && dia && !cur.fora) out.push({ data: dia, tipo: cur.tipo, valor: cur.valor, transacao: cur.transacao, titulo: cur.titulo, status: cur.status });
            cur = null;
        };
        (linhas || []).forEach(t => {
            const md = /^(?:hoje,?\s*|ontem,?\s*)?(\d{1,2}) de ([a-zç]+)(?: de (\d{4}))?$/i.exec(t);
            const mes = md ? MESES_LONGOS[SHC.normalizaTitulo(md[2])] : 0;
            if (md && mes) {
                fecha();
                const y = md[3] ? +md[3] : (mes > +h[2] ? +h[1] - 1 : +h[1]);   // sem ano: mês depois do atual = ano passado
                dia = y + '-' + String(mes).padStart(2, '0') + '-' + String(+md[1]).padStart(2, '0');
                return;
            }
            if (/^\d{1,2}:\d{2}( h)?$/.test(t)) { fecha(); cur = novoItemMP(true); blocos++; return; }
            if (!cur) cur = novoItemMP();
            const tipo = /^venda no mercado livre$/i.test(t) ? 'venda' : (/^reembolso\b/i.test(t) ? 'reembolso' : '');
            if (tipo) { if (cur.tipo) { fecha(); cur = novoItemMP(); } if (!cur.contado) { cur.contado = true; blocos++; } cur.tipo = tipo; return; }
            if (/^compra\b/i.test(t) && !cur.tipo) { cur.fora = true; if (!cur.contado) { cur.contado = true; blocos++; } return; }   // compra de cartão: nunca entra
            const tr = /transa[çc][ãa]o\s*#?\s*(\d{6,24})/i.exec(t);
            if (tr) { cur.transacao = tr[1]; return; }
            if (/^(aprovad[oa]|recusad[oa]|cancelad[oa]|pendente|em an[áa]lise|devolvid[oa])$/i.test(t)) { cur.status = t; if (/recusad|cancelad|pendente|an[áa]lise/i.test(t)) cur.fora = true; return; }
            const v = /^([+\-−])\s*R\$\s*([\d.]+(?:,\d{1,2})?)$/.exec(t);
            if (v) { cur.valor = SHC.r2((v[1] === '+' ? 1 : -1) * SHC.num(v[2])); return; }
            if (cur.tipo && !cur.titulo && t.length > 3 && !/^R\$/.test(t)) cur.titulo = t.slice(0, 200);
        });
        fecha();
        out.blocos = blocos;
        out.assinatura = sinais.slice(0, 5).join('|');
        return out;
    };
    /** HTML de uma página de Atividade → itens. listData do estado embutido (Nordic) primeiro; senão os textos do estado ou da página. */
    SHC.mpAtividadesDoHtml = function (html, hoje) {
        const r = SHC.mlExtraiEstado(String(html || ''));
        const lista = SHC.mpAtividadesDoEstado(r);
        if (lista) return lista;
        const doEstado = r ? SHC.mpAtividadesDasLinhas(linhasDoEstado(r), hoje) : [];
        return doEstado.length ? doEstado : SHC.mpAtividadesDasLinhas(linhasDoHtml(html), hoje);
    };
    /** Itens (vendas + e reembolsos −) → { 'AAAA-MM': {entrou, reembolsos (≤ 0), liquido, n} }, sem repetir a mesma transação. */
    SHC.repassePorMes = function (itens) {
        const out = {}, vistos = new Set();
        (itens || []).forEach(i => {
            if (!i || !i.data || typeof i.valor !== 'number' || !isFinite(i.valor)) return;
            const k = i.tipo + '|' + (i.transacao || '') + '|' + i.data + '|' + i.valor;
            if (i.transacao && vistos.has(k)) return;
            vistos.add(k);
            const mes = i.data.slice(0, 7), m = out[mes] || (out[mes] = { entrou: 0, reembolsos: 0, liquido: 0, n: 0 });
            // Reembolso de R$ 0,00 (visto ao vivo) conta como reembolso, não como venda.
            if (i.valor >= 0 && i.tipo !== 'reembolso') m.entrou = SHC.r2(m.entrou + i.valor); else m.reembolsos = SHC.r2(m.reembolsos + i.valor);
            m.liquido = SHC.r2(m.entrou + m.reembolsos); m.n++;
        });
        return out;
    };

    // ── Andamento da sincronização (shc:status.etapas / .progresso): ordem fixa, o painel desenha por aqui ──
    SHC.SYNC_ETAPAS = [
        { id: 'anuncios', rotulo: 'Seus anúncios' }, { id: 'promos', rotulo: 'Central de promoções' },
        { id: 'afiliados', rotulo: 'Afiliados' },   // v2.9: logo depois das promoções (leve); no fim ela não rodava quando o Faturamento demorava
        { id: 'vendasBrutas', rotulo: 'Vendas brutas' },
        { id: 'faturamento', rotulo: 'Faturamento (tarifas, frete e Ads)' }, { id: 'faturas', rotulo: 'Faturas do ML' }, { id: 'full', rotulo: 'Estoque Full' },
        { id: 'ads', rotulo: 'Mercado Ads' }, { id: 'repasse', rotulo: 'Mercado Pago' },
        { id: 'saude', rotulo: 'Saúde dos anúncios' }, { id: 'posvenda', rotulo: 'Pós-venda' },
        { id: 'vendasAnuncio', rotulo: 'Vendas por anúncio' },   // v2.6: 13 meses por anúncio (faturamento por família); no fim, não atrasa as outras
        { id: 'alertas', rotulo: 'Alertas' },
    ];
    /** "1.051 anúncios" / "1 anúncio" (milhar com ponto, plural certo). */
    SHC.qtd = (n, um, varios) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' ' + (n === 1 ? um : varios);
    /** % inteiro da sincronização: etapas inteiras antes da atual + a fração dela (feito/de, quando o total é conhecido). */
    SHC.progressoPct = function (indice, feito, de, total) {
        total = total || SHC.SYNC_ETAPAS.length;
        const frac = de > 0 && feito > 0 ? Math.min(1, feito / de) : 0;
        return Math.max(0, Math.min(100, Math.floor(((indice - 1) + frac) / total * 100)));
    };
    /**
     * Segundos que faltam (ou null). Com duracoes (ms por etapa da última sincronização completa): etapas que faltam + o que falta
     * da atual (pela fração feito/de, senão pelo tempo que ela já leva). Sem histórico: com ≥ 10 s e pct ≥ 5, extrapola o decorrido.
     */
    SHC.estimaRestante = function (p, duracoes, agoraMs) {
        if (!p) return null;
        const agora = agoraMs || Date.now(), ids = SHC.SYNC_ETAPAS.map(e => e.id);
        const temHist = duracoes && ids.some(id => typeof duracoes[id] === 'number');
        if (temHist) {
            const d = id => Math.max(0, +duracoes[id] || 0), i = ids.indexOf(p.etapa);
            let ms = ids.slice(i + 1).reduce((s, id) => s + d(id), 0);
            if (i >= 0) ms += p.de > 0 ? d(p.etapa) * (1 - Math.min(1, (p.feito || 0) / p.de)) : Math.max(0, d(p.etapa) - (agora - (p.inicioEtapa || agora)));
            return Math.round(ms / 1000);
        }
        const dec = agora - (p.inicio || agora);
        return dec >= 10e3 && p.pct >= 5 ? Math.round(dec * (100 - p.pct) / p.pct / 1000) : null;
    };

    /**
     * Estoque mínimo do Full EM UNIDADES (c|sku|<SKU>.fullMinUn, inteiro ≥ 1; ausente = sem mínimo). fullMinDias e cfg.full_min_dias
     * não valem mais. → { minUn, definido, tem (aptas + a caminho), abaixo, faltam, sugerido (só sem mínimo: 15 dias da previsão) }.
     */
    SHC.fullMinimo = function (prod, cad, prev30) {
        const n = SHC.num(cad && cad.fullMinUn), definido = n !== null && n >= 1, minUn = definido ? Math.round(n) : null;
        const un = v => { const x = unDe(v); return x === null ? 0 : Math.max(0, x); };
        const tem = un(prod && prod.aptas) + un(prod && prod.aCaminho), abaixo = definido && tem < minUn;
        return { minUn, definido, tem, abaixo, faltam: abaixo ? minUn - tem : 0, sugerido: !definido && prev30 > 0 ? Math.ceil(prev30 * 15 / 30 - 1e-9) : null };
    };

    // ── Alertas (selo no ícone): Full acabando e Ads acima do equilíbrio ──
    // Mesma regra do cartão "Alertas" do painel lateral (P.saudeFull / P.adsEquilibrio), para o número do ícone bater com a lista.
    const unDe = v => (typeof v === 'number' ? (isFinite(v) ? v : null) : inteiro(v));
    const mesMenos = (m, k) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 - k, 1)).toISOString().slice(0, 7);
    /**
     * dados = { full: ml:full, ads: ads:<conta>, itens: anúncios do retrato, custos: {chave: dados} (c|sku|…, c|ml|…), cfg,
     *           vm?: {MLB: {'AAAA-MM': vendas}} (vm|ml), mesesLidos?: ['AAAA-MM'], hoje: 'AAAA-MM-DD',
     *           saude?: { semFiscal: n (fiscal:<conta>.total), perdendo: n (anúncios ativos com radar 'caindo') } }
     * → { criticos, full, ads, lista:[{tipo:'full'|'ads', nivel:'critico', chave, itemId, sku, titulo, texto, …}] }
     * Full (produto com alerta): previsão de 30 dias = maior entre vendas30 e o mesmo mês do ano passado (vm). Alerta = acaba em
     *   ≤ 7 dias (ML ou aptas ÷ previsão; sem estoque e com previsão = acabou) ou aptas + a caminho abaixo do mínimo em unidades
     *   do SKU (SHC.fullMinimo; sem mínimo definido não há "abaixo do mínimo").
     * Ads (acima do equilíbrio): gasto > sobra por unidade antes do Ads × vendas do Ads. Sem custo do produto não alerta.
     */
    SHC.alertasDe = function (dados) {
        dados = dados || {};
        const cfg = Object.assign({}, SHC.PADRAO, dados.cfg || {}), custos = dados.custos || {}, lista = [];
        const hoje = dados.hoje || SHC.hoje(), vm = dados.vm || {}, lidos = dados.mesesLidos || [];
        const mesAno = mesMenos(new Date(Date.parse(hoje + 'T12:00:00Z') + 15 * 864e5).toISOString().slice(0, 7), 12);
        // Variações do mesmo anúncio (mesmos MLB): o vm|ml é do anúncio inteiro → cada uma fica com a parte dela nas vendas de 30 dias
        // (mesma conta de P.planoFull); sem essa parte, o ano passado não entra.
        const prods = ((dados.full && dados.full.produtos) || []).filter(Boolean);
        const idsDe = p => [...new Set((p.itemIds && p.itemIds.length ? p.itemIds : [p.itemId]).filter(Boolean))];
        const irmaos = {};
        prods.forEach(p => { const k = idsDe(p).sort().join(','); if (k) { const g = irmaos[k] || (irmaos[k] = { n: 0, v: 0 }); g.n++; g.v += Math.max(0, unDe(p.vendas30) || 0); } });
        prods.forEach(p => {
            const aptas = unDe(p.aptas), v30 = unDe(p.vendas30), cam = Math.max(0, unDe(p.aCaminho) || 0);
            if (aptas === null) return;
            const ids = idsDe(p), g = irmaos[ids.slice().sort().join(',')];
            const comMes = ids.filter(id => vm[id] && vm[id][mesAno] !== undefined && vm[id][mesAno] !== null);
            let ano = comMes.length ? Math.max(0, comMes.reduce((n, id) => n + (unDe(vm[id][mesAno]) || 0), 0)) : (ids.length && lidos.indexOf(mesAno) >= 0 ? 0 : null);
            if (g && g.n > 1) ano = g.v > 0 && v30 !== null && ano !== null ? Math.round(ano * Math.max(0, v30) / g.v) : null;
            const ult30 = v30 === null ? null : Math.max(0, v30), prev = ult30 === null && ano === null ? null : Math.max(ult30 || 0, ano || 0);
            const cad = p.sku && SHC.chaveSku ? custos[SHC.chaveSku(p.sku)] : null;
            const tem = Math.max(0, aptas), fm = SHC.fullMinimo(p, cad, prev);
            const cobertura = prev > 0 ? Math.floor(tem / (prev / 30)) : null;
            const ml = typeof p.diasAteEsgotar === 'number' && isFinite(p.diasAteEsgotar) ? p.diasAteEsgotar : null;
            const ds = [ml, cobertura].filter(x => x !== null), dias = ds.length ? Math.min(...ds) : null;
            // Acaba em ≤ 7 dias (vendendo) OU abaixo do mínimo em unidades que o seller definiu. Sem mínimo nunca é "abaixo do mínimo".
            const semEstoque = tem <= 0, acaba = semEstoque ? prev > 0 : v30 !== 0 && dias !== null && dias <= 7;
            if (!(acaba || fm.abaixo)) return;
            const texto = fm.abaixo ? 'Estoque no Full abaixo do mínimo: mínimo ' + fm.minUn + ' un.; você tem ' + SHC.qtd(tem, 'apta', 'aptas')
                    + (cam ? ' (+ ' + cam + ' a caminho)' : '') + '. Envie pelo menos ' + fm.faltam + ' un.'
                : semEstoque ? 'Sem estoque no Full' + (v30 > 0 ? ' e você vendeu ' + v30 + ' nos últimos 30 dias.' : '.')
                : 'Acaba no Full em ' + dias + (dias === 1 ? ' dia.' : ' dias.');
            lista.push({ tipo: 'full', nivel: 'critico', chave: 'full|' + (p.itemId || p.produtoId) + '|' + (p.variacao || ''), itemId: p.itemId || '', sku: p.sku || '',
                titulo: p.titulo || '', texto, dias, aptas: tem, aCaminho: cam, vendas30: v30, minUn: fm.minUn, abaixoMin: fm.abaixo, faltam: fm.faltam, sugerido: fm.sugerido });
        });
        const porId = new Map((dados.itens || []).filter(i => i && i.itemId).map(i => [String(i.itemId), i]));
        ((dados.ads && dados.ads.anuncios) || []).forEach(a => {
            if (!a || !(a.custo > 0)) return;
            const it = porId.get(a.itemId);
            if (!it) return;
            const c = SHC.custoDeAnuncio ? SHC.custoDeAnuncio(custos, { sku: it.sku, itemId: it.itemId, familia: it.familia }) : null;
            const eq = SHC.adsEquilibrio(it, c && c.dados, cfg);
            if (!eq) return;
            const antes = SHC.r2(eq.sobraAntes * (a.vendas || 0));
            if (!(a.custo > antes + 0.004)) return;
            lista.push({ tipo: 'ads', nivel: 'critico', chave: 'ads|' + a.itemId, itemId: a.itemId, sku: it.sku || '', titulo: a.titulo || it.titulo || '',
                texto: eq.equilibrio <= 0 ? 'Este anúncio já dá prejuízo antes do Ads e ainda gastou ' + SHC.moeda(a.custo) + ' em Ads.'
                    : 'O Ads gastou ' + SHC.moeda(a.custo) + ' e a sobra dessas vendas antes do Ads era ' + SHC.moeda(antes) + ' (margem de ' + SHC.pctTxt(eq.equilibrio) + ').',
                gasto: a.custo, receita: a.receita, vendas: a.vendas, acos: a.acos, equilibrio: eq.equilibrio, excesso: SHC.r2(a.custo - antes), campanhaId: a.campanhaId });
        });
        const dd = x => (typeof x.dias === 'number' ? x.dias : 99), ordem = { conta: 0, full: 1, ads: 2 };
        const daConta = SHC.alertasConta(dados.conta);   // restrição fiscal / penalidade do Full: travam a conta inteira → primeiro
        lista.sort((x, y) => (ordem[x.tipo] - ordem[y.tipo]) || (dd(x) - dd(y)) || ((y.excesso || 0) - (x.excesso || 0)));
        lista.unshift(...daConta);
        // Saúde dos anúncios (mesma regra do cartão Alertas do painel, P.alertas): 1 item "Dados fiscais" e 1 item "Visitas", logo depois da conta.
        const sd = dados.saude || {}, saude = [];
        if (sd.semFiscal > 0) saude.push({ tipo: 'fiscal', nivel: 'critico', chave: 'saude|fiscal', qtd: sd.semFiscal,
            texto: SHC.qtd(sd.semFiscal, 'anúncio sem dados fiscais', 'anúncios sem dados fiscais') + '. Sem dados fiscais o Mercado Livre não emite a NF-e dessas vendas.' });
        if (sd.perdendo > 0) saude.push({ tipo: 'visitas', nivel: 'critico', chave: 'saude|visitas', qtd: sd.perdendo,
            texto: SHC.qtd(sd.perdendo, 'anúncio perdendo visitas', 'anúncios perdendo visitas') + ' na última semana.' });
        lista.splice(daConta.length, 0, ...saude);
        const full = lista.filter(a => a.tipo === 'full').length, ads = lista.filter(a => a.tipo === 'ads').length;
        return { criticos: lista.length, full, ads, contaFull: daConta.length, saude: saude.length, lista };
    };

    /**
     * Alertas da conta no Full (remessas: fiscal_restriction_name e active_penalty_by_uwsd; fullAviso = texto do ML, opcional).
     * → [{tipo:'conta', nivel:'critico', chave, texto, link}] (contam no número do ícone como críticos).
     */
    const URL_ENVIOS_FULL = 'https://vendedores.mercadolivre.com.br/shipping/inbounds';
    SHC.alertasConta = function (d) {
        d = d || {};
        const out = [], fiscal = String(d.fiscal || '').trim(), add = (chave, texto) => out.push({ tipo: 'conta', nivel: 'critico', chave, texto, link: URL_ENVIOS_FULL });
        if (/EXPIRED_CERTIFICATE/i.test(fiscal)) add('conta|certificado', 'Seu Certificado Digital venceu: o Full não recebe seu estoque até você atualizar. Atualize em Gestão de envios Full.');
        else if (fiscal) add('conta|fiscal', 'Há uma restrição fiscal na conta que trava o Full. Confira em Gestão de envios Full.');
        const p = d.penalidade;   // true, ou objeto/lista com a penalidade (vazio / false / null = sem penalidade)
        if (p === true || (p && typeof p === 'object' && Object.keys(p).length > 0)) add('conta|penalidade', 'Há uma penalidade ativa no Full. Confira em Gestão de envios Full.');
        const aviso = String(d.fullAviso || '').trim();
        if (aviso && !out.length) add('conta|aviso', aviso.slice(0, 200));   // o texto do ML só quando não explica o mesmo problema acima
        return out;
    };

    // ── v2.5.3: Pós-venda (GET /post-purchase/post-sales/, estado embutido), visto ao vivo em 25/09/2026. Só os TOTAIS das abas principais:
    // {value:'problems-to-manage'|'messages'|'returns', text, badge?:{label}} (badge.label = pendentes; sem badge = 0; "Mensagens 1" no texto = reserva).
    // Nada do comprador (nome, apelido, mensagem) é lido nem guardado. ──
    SHC.POSVENDA_URL = 'https://vendedores.mercadolivre.com.br/post-purchase/post-sales/';
    const ABAS_POSVENDA = { 'problems-to-manage': 'reclamacoes', messages: 'mensagens', returns: 'devolucoes' };
    /** Estado da página do pós-venda → { reclamacoes, mensagens, devolucoes (null = aba não achada), ts } | null (nenhuma aba reconhecida). */
    SHC.mlPosVendaDoEstado = function (r) {
        const achou = {};
        let nos = 0;
        (function andar(o, p) {
            if (!o || typeof o !== 'object' || p > 40 || ++nos > 300000) return;
            if (Array.isArray(o)) { o.forEach(x => andar(x, p + 1)); return; }
            const campo = typeof o.value === 'string' && ABAS_POSVENDA[o.value];
            if (campo && typeof o.text === 'string') {
                const b = o.badge && typeof o.badge === 'object' ? inteiro(o.badge.label) : null, t = /(\d+)\)?\s*$/.exec(o.text.trim());
                // Sem badge e sem número no texto: 0 só onde foi conferido (reclamações/devoluções). Mensagens: a tela mostrava
                // "Mensagens 1" com o estado sem badge (retrato de 25/09/2026) → null ("—"), nunca 0 inventado.
                const n = b !== null && b >= 0 ? b : t ? +t[1] : (campo === 'mensagens' ? null : 0);
                achou[campo] = n === null ? (campo in achou ? achou[campo] : null) : Math.max(achou[campo] || 0, n);   // a mesma aba aparece várias vezes: fica o maior
            }
            for (const k in o) if (k !== 'badge') andar(o[k], p + 1);
        })(r, 0);
        if (!Object.keys(achou).length) return null;
        const v = k => (k in achou ? achou[k] : null);
        return { reclamacoes: v('reclamacoes'), mensagens: v('mensagens'), devolucoes: v('devolucoes'), ts: Date.now() };
    };

    // ── v2.9: reclamações da lista do pós-venda (mesma página, Flox: pageProps…floxPreloadedState['@meli/web/flox/FLOX_STATE'].brickStack),
    // visto ao vivo em 26/09/2026. Um card por reclamação: card-CLAIM_<id>, dentro de um main-list-item com product-id (#pedido),
    // product-name(-link), product-price, product-quantity, buyer-reason-text (motivo), reputation e detail-title (situação).
    // NUNCA lê block-buyer-* nem o menu do card (item-options-menu-*: traz o id do comprador). A paginação do ML é POST: só a 1ª página. ──
    const achaBrickStack = r => {
        let achou = null, nos = 0;
        (function andar(o, p) {
            if (achou || !o || typeof o !== 'object' || p > 30 || ++nos > 200000) return;
            if (o.brickStack && typeof o.brickStack === 'object' && !Array.isArray(o.brickStack)) { achou = o; return; }
            for (const k in o) andar(o[k], p + 1);
        })(r, 0);
        return achou;
    };
    const PROIBIDO_PV = /^(block-buyer|item-options-menu|item-note)/;
    /**
     * Estado da página do pós-venda (ou {brickStack}) → { casos:[{claimId, pedido, titulo, valor, unidades, motivo, afetouReputacao (true|false|null), situacao}],
     *   paginas (do brick pagination; null = não veio), lista (true = a lista do ML veio, mesmo vazia) } | null (sem estado Flox).
     * pedido serve só para contar (a tela não mostra). Nada do comprador sai daqui.
     */
    SHC.posvendaReclamacoesDoFlox = function (r) {
        const st = achaBrickStack(r);
        if (!st) return null;
        const b = st.brickStack, txt = k => { const d = b[k] && b[k].data; return d && typeof d.text === 'string' ? d.text.replace(/\s+/g, ' ').trim() : ''; };
        const casos = [], vistos = new Set();
        Object.keys(b).forEach(k => {
            const m = /^card-CLAIM_(\d+)$/.exec(k);
            if (!m || vistos.has(m[1])) return;
            vistos.add(m[1]);
            let item = k;   // sobe até o item da lista (o produto fica no mesmo item, fora do card da reclamação)
            for (let i = 0; i < 12 && b[item] && !/^main-list-item-(?!wrapper)/.test(item); i++) item = b[item].parentBrick;
            if (!b[item]) item = k;
            const por = {};
            (function desce(id, p) {
                if (!b[id] || p > 20 || PROIBIDO_PV.test(id)) return;
                const pre = /^([a-z]+(?:-[a-z]+)*?)-(?:[0-9a-f]{8}-|CLAIM_)/.exec(id);
                if (pre && !(pre[1] in por)) por[pre[1]] = id;
                (b[id].childrenBricks || []).forEach(c => desce(c, p + 1));
            })(item, 0);
            const rep = txt(por.reputation), ped = por['product-id'] && b[por['product-id']].data;
            casos.push({ claimId: m[1], pedido: ped && ped.value ? String(ped.value) : '',
                titulo: (txt(por['product-name-link']) || txt(por['product-name'])).slice(0, 120),
                valor: SHC.num(txt(por['product-price'])), unidades: inteiro(txt(por['product-quantity'])),
                motivo: txt(por['buyer-reason-text']).slice(0, 80), afetouReputacao: !rep ? null : /n[ãa]o afetou|n[ãa]o afeta/i.test(rep) ? false : /afet/i.test(rep) ? true : null,
                situacao: txt(por['detail-title']).slice(0, 120) });
        });
        const pg = b.pagination && b.pagination.data;
        return { casos, paginas: pg && typeof pg.totalPages === 'number' ? pg.totalPages : null, lista: !!b['main-list'] || casos.length > 0 };
    };
    /**
     * Casos do pós-venda × anúncios → { total, naReputacao, motivos:[{motivo, casos, valor}] (mais casos primeiro),
     *   produtos:[{chave, sku, itemId, titulo, casos, valor, motivos:{motivo: n}}] (mais casos, depois mais R$) }.
     * O SKU vem do anúncio achado pelo título (SHC.mlbPorTitulo); sem anúncio, fica o título.
     */
    SHC.posvendaAnalise = function (casos, itens) {
        const l = (casos || []).filter(Boolean), porMot = {}, porProd = {}, porId = {};
        (itens || []).forEach(it => { if (it && it.itemId) porId[it.itemId] = it; });
        l.forEach(c => {
            const mot = c.motivo || 'Sem motivo informado', v = c.valor > 0 ? c.valor : 0;
            const m = porMot[mot] || (porMot[mot] = { motivo: mot, casos: 0, valor: 0 });
            m.casos++; m.valor = SHC.r2(m.valor + v);
            const id = c.titulo && SHC.mlbPorTitulo ? SHC.mlbPorTitulo(c.titulo, itens || []) : null, it = id && porId[id];
            const chave = (it && (it.sku || it.itemId)) || c.titulo || '—';
            const p = porProd[chave] || (porProd[chave] = { chave, sku: (it && it.sku) || '', itemId: (it && it.itemId) || '', titulo: (it && it.titulo) || c.titulo || '', casos: 0, valor: 0, motivos: {} });
            p.casos++; p.valor = SHC.r2(p.valor + v); p.motivos[mot] = (p.motivos[mot] || 0) + 1;
        });
        const ord = (a, b) => b.casos - a.casos || b.valor - a.valor;
        return { total: l.length, naReputacao: l.filter(c => c.afetouReputacao === true).length, motivos: Object.values(porMot).sort(ord), produtos: Object.values(porProd).sort(ord) };
    };

    // ── v2.5.3: certificado digital (aviso do Faturador, montado no navegador: o content script lê o texto da tela) ──
    SHC.FATURADOR_URL = 'https://vendedores.mercadolivre.com.br/billing/invoiceissuer/fiscal-hub';
    /**
     * Título e texto do aviso ("Seu certificado digital vence em 18 dias", "… vence em 13/10/2026", "Seu certificado digital expirou")
     * → { dias (até vencer; negativo = venceu há N dias; null = a tela não disse), data 'AAAA-MM-DD' | null, expirou } | null (não é aviso do certificado).
     * Nada além disso é lido (razão social e CNPJ nunca).
     */
    SHC.certificadoDoTexto = function (titulo, texto, hoje) {
        const t = (String(titulo || '') + ' ' + String(texto || '')).replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ');
        if (!/certificado/i.test(t)) return null;
        const h = hoje || SHC.hoje(), dif = d => Math.round((Date.parse(d + 'T12:00:00Z') - Date.parse(h + 'T12:00:00Z')) / 864e5);
        const md = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(t);
        let data = md && +md[2] >= 1 && +md[2] <= 12 && +md[1] >= 1 && +md[1] <= 31 ? md[3] + '-' + String(+md[2]).padStart(2, '0') + '-' + String(+md[1]).padStart(2, '0') : null;
        const mn = /vence(?:r[áa])? em (\d{1,4}) dias?\b/i.exec(t);
        let dias = mn ? +mn[1] : /vence hoje/i.test(t) ? 0 : /vence amanh[ãa]/i.test(t) ? 1 : null;
        const expirouTxt = /(expirou|venceu|est[áa] vencido|expirado)/i.test(t);
        if (dias === null && data) dias = dif(data);
        if (!data && dias !== null && !expirouTxt) data = diaMenosX(h, -dias);
        if (dias === null && !data && !expirouTxt) return null;
        return { dias, data, expirou: expirouTxt || (dias !== null && dias < 0) };
    };

    /**
     * cert:<conta> → o mesmo com dias RECALCULADOS para hoje (os gravados valem para o dia da leitura): pela data do vencimento, ou, sem ela,
     * dias − dias corridos desde a leitura. expirou = a tela disse que venceu ou dias < 0. {ok:true} (Faturador sem aviso) ou nada → null.
     */
    SHC.certAgora = function (c, agora) {
        if (!c || c.ok) return null;
        const d = new Date(agora || Date.now()), hoje = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
        let dias = typeof c.dias === 'number' ? c.dias : null;
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(c.data || ''))) dias = Math.round((Date.parse(c.data + 'T00:00:00Z') - hoje) / 864e5);
        else if (dias !== null && c.ts) { const l = new Date(c.ts); dias -= Math.round((hoje - Date.UTC(l.getFullYear(), l.getMonth(), l.getDate())) / 864e5); }
        return Object.assign({}, c, { dias, expirou: !!c.expirou || (dias !== null && dias < 0) });
    };

    // ── v2.5.3: TODAS as anomalias da conta (número do ícone e "N coisas pedem sua atenção" do painel) ──
    // v2.7: + 'perguntas' (perguntas:<conta>) e 'reputacao' (reputacao:<conta>); remessas do Full com inconformidade/multa entram em 'full'.
    const ANOM_TIPOS = ['full', 'estoque', 'frete', 'pagamento', 'posvenda', 'ads', 'fiscal', 'visitas', 'medidas', 'perguntas', 'reputacao'];
    const ANOM_ABA = { full: 'full', estoque: 'full', frete: 'frete', pagamento: 'conciliacao', posvenda: 'posvenda',   // v2.9: aba Pós-venda
        ads: 'ads', fiscal: 'saude', visitas: 'saude', medidas: 'saude', perguntas: 'saude', reputacao: 'saude' };   // v2.9: perguntas e reputação na aba Saúde
    /**
     * conta = sellerId; dados = { alertas (SHC.alertasDe), posvenda (posvenda:<conta>), frete (frete:<conta>:hist), conferir (conferir:<conta>),
     *   rateio (fech:<conta>:rateio), cert (cert:<conta>), medidas (medidas:<conta>), nfe? ([nfe:<conta>:<mês>…], v2.8), titulos? ({MLB: título}, para o texto), agora? (ms) }.
     *   Tudo opcional: o que não foi lido não conta.
     * → { conta, total, porTipo:{full, estoque, frete, pagamento, posvenda, ads, fiscal, visitas, medidas}, vermelho, itens:[{tipo, aba, texto, chave, link?, itemId?, qtd?}] }
     * Sem contar a mesma coisa 2×: Full = 1 por anúncio (sem estoque vale mais que "acabando" → tipo 'estoque'); frete = 1 por anúncio (pago a mais
     * ou frete que subiu); pagamento = 1 por pedido do Fechamento (fora o frete de um pedido que já está em frete) + 1 por fatura que não bate;
     * certificado = 1 (Faturador ou remessa do Full); dados fiscais e visitas = 1 cada (como no cartão Alertas); pós-venda = reclamações + devoluções
     * em aberto. vermelho = reclamação/mediação em aberto ou pagamento a conferir (cor do número no ícone).
     */
    SHC.anomalias = function (conta, dados, cfg) {
        const d = dados || {}, itens = [], agora = d.agora || Date.now(), lista = ((d.alertas && d.alertas.lista) || []).filter(Boolean), tit = d.titulos || {}, nome = id => tit[id] || id;
        const add = (tipo, texto, extra) => itens.push(Object.assign({ tipo, aba: ANOM_ABA[tipo], texto }, extra || {}));
        // Full: 1 por anúncio.
        const porAnuncio = {};
        lista.filter(a => a.tipo === 'full').forEach(a => {
            const k = a.itemId || a.chave, x = porAnuncio[k];
            if (!x || (a.aptas <= 0 && !(x.aptas <= 0))) porAnuncio[k] = a;
        });
        Object.keys(porAnuncio).forEach(k => { const a = porAnuncio[k]; add(a.aptas <= 0 ? 'estoque' : 'full', (a.titulo ? a.titulo + ': ' : '') + a.texto, { chave: 'anom|full|' + k, itemId: a.itemId || '' }); });
        // Conta do Full (restrição fiscal / penalidade / aviso); o certificado vai para 'fiscal' (junto com o do Faturador).
        let certRemessa = false;
        lista.filter(a => a.tipo === 'conta').forEach(a => {
            if (a.chave === 'conta|certificado') { certRemessa = true; return; }
            add('full', a.texto, { chave: 'anom|' + a.chave, link: a.link });
        });
        lista.filter(a => a.tipo === 'ads').forEach(a => add('ads', (a.titulo ? a.titulo + ': ' : '') + a.texto, { chave: 'anom|ads|' + a.itemId, itemId: a.itemId }));
        lista.filter(a => a.tipo === 'fiscal' || a.tipo === 'visitas').forEach(a => add(a.tipo, a.texto, { chave: 'anom|' + a.chave, qtd: a.qtd }));
        // Certificado digital: Faturador (cert:<conta>) ou remessa do Full com FF_SHIPPING_EXPIRED_CERTIFICATE.
        const c = SHC.certAgora(d.cert, agora);
        const certVale = c && (c.expirou || (typeof c.dias === 'number' && c.dias <= 30));
        if (certVale || certRemessa) {
            const venceu = certRemessa || c.expirou || c.dias < 0;
            add('fiscal', venceu ? 'Seu certificado digital venceu: sem ele o Mercado Livre não emite as notas fiscais e o Full pode ser pausado. Renove e cadastre no Faturador.'
                : 'Seu certificado digital vence ' + (c.dias === 0 ? 'hoje' : c.dias === 1 ? 'amanhã' : 'em ' + c.dias + ' dias') + (c.data ? ' (' + c.data.slice(8, 10) + '/' + c.data.slice(5, 7) + '/' + c.data.slice(0, 4) + ')' : '')
                    + '. Sem ele o Mercado Livre não emite as notas fiscais e o Full pode ser pausado.',
            { chave: 'anom|certificado', aba: 'conciliacao', link: SHC.FATURADOR_URL, vermelho: true });
        }
        // Frete: 1 por anúncio (pago a mais nos pedidos dos últimos 30 dias, ou frete que subiu).
        const fr = d.frete || {}, conc = fr.conciliacao || {}, porItem = {}, pedidosFrete = new Set();
        (conc.pagoAMais || []).forEach(p => {
            pedidosFrete.add(String(p.pedido));
            const k = p.itemId || 'pedido ' + p.pedido, x = porItem[k] || (porItem[k] = { n: 0, dif: 0 });
            x.n++; x.dif = SHC.r2(x.dif + p.diferenca);
        });
        Object.keys(porItem).forEach(k => add('frete', nome(k) + ': frete cobrado acima do frete do anúncio em ' + SHC.qtd(porItem[k].n, 'pedido', 'pedidos') + ' (' + SHC.moeda(porItem[k].dif) + ' a mais).',
            { chave: 'anom|frete|' + k, itemId: /^MLB/.test(k) ? k : '' }));
        Object.keys(fr.porAnuncio || {}).forEach(id => {
            const a = fr.porAnuncio[id];
            if (!a || !a.subiu || porItem[id]) return;
            add('frete', nome(id) + ': o frete subiu de ' + SHC.moeda(a.ant30.tipico) + ' para ' + SHC.moeda(a.ult30.tipico) + ' por pedido (últimos 30 dias contra os 30 anteriores).', { chave: 'anom|frete|' + id, itemId: id });
        });
        // Pagamento excedente: "cobranças para conferir" do Fechamento (SHC.fech.conferir, gravado pelo fundo) + fatura que não bate com as cobranças.
        const pedPag = {};
        ((d.conferir && d.conferir.itens) || []).forEach(x => {
            if (!x || (x.regra === 'frete' && pedidosFrete.has(String(x.pedido)))) return;
            const k = String(x.pedido), y = pedPag[k] || (pedPag[k] = { dif: 0, motivo: x.motivo, itemId: x.itemId });
            y.dif = SHC.r2(y.dif + (x.diferenca || 0));
        });
        Object.keys(pedPag).forEach(k => add('pagamento', 'Pedido ' + k + ': ' + SHC.moeda(pedPag[k].dif) + ' a conferir. ' + (pedPag[k].motivo || ''), { chave: 'anom|pag|' + k, itemId: pedPag[k].itemId || '' }));
        ((d.rateio && d.rateio.faturas) || []).forEach(f => {
            if (!f || f.conferido !== false || f.incompleto || !(Math.abs(SHC.num(f.diferenca) || 0) >= 1)) return;
            add('pagamento', 'Fatura ' + (f.nome || f.fatura) + ': o total não bate com as cobranças lidas (diferença de ' + SHC.moeda(Math.abs(f.diferenca)) + ').', { chave: 'anom|fatura|' + f.fatura, link: f.linkDetalhe || '' });
        });
        // Pós-venda: reclamações/mediações e devoluções em aberto (mensagens ficam só no resumo).
        const pv = d.posvenda || {};
        if (pv.reclamacoes > 0) add('posvenda', SHC.qtd(pv.reclamacoes, 'reclamação ou mediação em aberto', 'reclamações ou mediações em aberto') + ' no pós-venda.', { chave: 'anom|pv|reclamacoes', qtd: pv.reclamacoes, link: SHC.POSVENDA_URL, vermelho: true });
        if (pv.devolucoes > 0) add('posvenda', SHC.qtd(pv.devolucoes, 'devolução pendente', 'devoluções pendentes') + ' no pós-venda.', { chave: 'anom|pv|devolucoes', qtd: pv.devolucoes, link: SHC.POSVENDA_URL });
        // Medidas da embalagem mudadas nos últimos 30 dias (fora as do próprio seller): 1 por anúncio.
        const mm = d.medidas && d.medidas.porItem && SHC.medidasMudadas ? SHC.medidasMudadas(d.medidas.porItem, agora - 30 * 864e5) : [], mIds = new Set();
        mm.forEach(m => { if (mIds.has(m.itemId)) return; mIds.add(m.itemId); add('medidas', nome(m.itemId) + ': o Mercado Livre mudou as medidas da embalagem para ' + SHC.medidaTxt(m.depois) + '.', { chave: 'anom|medidas|' + m.itemId, itemId: m.itemId }); });
        // v2.7: remessas do Full com inconformidade ou multa (SHC.remessasResumo): 1 por remessa.
        const rm = d.remessas || {}, porRem = {};
        (rm.comInconformidade || []).forEach(r => { porRem[r.id] = (r.textos || []).slice(); });
        (rm.comMulta || []).forEach(r => { (porRem[r.id] || (porRem[r.id] = [])).push(r.texto); });
        // v2.9: remessa recebida com inconformidade (90 dias): motivo + o que o ML cobrou; o link abre a remessa, onde se reclama.
        // Reclamação já aberta ou o ML não aceita mais reclamar: sai do sino (a multa, se houver, continua).
        const multaIds = new Set((rm.comMulta || []).map(r => String(r.id)));
        (rm.inconformes || []).filter(r => !SHC.remessaPendente(r)).forEach(r => { if (!multaIds.has(r.id)) delete porRem[r.id]; });
        (rm.inconformes || []).filter(SHC.remessaPendente).forEach(r => {
            const t = porRem[r.id] || (porRem[r.id] = []);
            r.motivos.forEach(m => { if (!t.some(x => x.toLowerCase().indexOf(m.toLowerCase()) >= 0)) t.push(m); });   // "3 unidades não aptas…" do detalhe já diz o motivo
            if (r.custo) t.push('o ML cobrou ' + SHC.moeda(r.custo));
        });
        Object.keys(porRem).forEach(id => add('full', 'Remessa ' + id + ' do Full: ' + [...new Set(porRem[id])].join('; ') + '.', { chave: 'anom|remessa|' + id, link: SHC.remessaLink(id), remessaId: id }));
        // v2.7: perguntas sem resposta (1 item; vermelho > 5 ou tempo médio comercial > 1 h) e reputação (1 por variável no alerta; vermelho ≥ 90% do limite).
        const pa = SHC.perguntasAlerta(d.perguntas);
        if (pa) add('perguntas', pa.texto, { chave: 'anom|perguntas', qtd: pa.pendentes, link: pa.link, vermelho: pa.vermelho });
        SHC.reputacaoAlertas(d.reputacao).forEach(a => add('reputacao', a.texto, { chave: 'anom|reputacao|' + a.id, link: a.link, vermelho: a.vermelho }));
        // v2.8: NF-e de venda rejeitada ou com erro (nfe:<conta>:<mês>, o atual e o anterior): 1 item fiscal, com a página do mês no ML.
        const nfeRuim = [].concat(d.nfe || []).filter(x => x && x.porStatus).map(x => ({ mes: x.mes, n: (x.porStatus.Rejeitada || 0) + (x.porStatus['Com erro'] || 0) })).filter(x => x.n > 0);
        const nNfe = nfeRuim.reduce((s, x) => s + x.n, 0);
        if (nNfe) add('fiscal', SHC.qtd(nNfe, 'nota fiscal de venda rejeitada ou com erro', 'notas fiscais de venda rejeitadas ou com erro') + '. Confira no Mercado Livre e emita de novo pelo Faturador.',
            { chave: 'anom|nfe', aba: 'conciliacao', link: /^\d{4}-\d{2}$/.test(String(nfeRuim[0].mes)) ? SHC.nfeLink(nfeRuim[0].mes) : SHC.FATURADOR_URL, qtd: nNfe });
        // v2.8: módulo desligado pelo seller (Ajustes) → a anomalia dele não conta nem aparece ("N coisas pedem sua atenção" e o ícone).
        const itensVis = itens.filter(i => SHC.moduloLigado(cfg, i.aba));
        const porTipo = {};
        ANOM_TIPOS.forEach(t => { porTipo[t] = 0; });
        itensVis.forEach(i => { porTipo[i.tipo] += i.tipo === 'posvenda' ? i.qtd : 1; });
        const total = ANOM_TIPOS.reduce((s, t) => s + porTipo[t], 0);
        return { conta: conta || '', total, porTipo, vermelho: porTipo.pagamento > 0 || itensVis.some(i => (i.tipo === 'posvenda' || i.tipo === 'perguntas' || i.tipo === 'reputacao') && i.vermelho), itens: itensVis };
    };
    const ANOM_NOMES = { full: ['no Full', 'no Full'], estoque: ['sem estoque no Full', 'sem estoque no Full'], frete: ['de frete', 'de frete'],
        pagamento: ['cobrança a conferir', 'cobranças a conferir'], posvenda: ['no pós-venda', 'no pós-venda'], ads: ['de Ads', 'de Ads'],
        fiscal: ['fiscal', 'fiscais'], visitas: ['de visitas', 'de visitas'], medidas: ['de medidas', 'de medidas'], perguntas: ['de perguntas', 'de perguntas'], reputacao: ['de reputação', 'de reputação'] };
    /** Título do ícone: "Copiloto: 5 pontos de atenção — 2 no Full, 1 de frete, 2 no pós-venda" (sem nada: "Abrir o Copiloto"). */
    SHC.anomaliasTitulo = function (a) {
        if (!a || !(a.total > 0)) return 'Abrir o Copiloto';
        const partes = ANOM_TIPOS.filter(t => a.porTipo[t] > 0).map(t => a.porTipo[t] + ' ' + ANOM_NOMES[t][a.porTipo[t] === 1 ? 0 : 1]);
        return 'Copiloto: ' + SHC.qtd(a.total, 'ponto de atenção', 'pontos de atenção') + ' — ' + partes.join(', ');
    };

    // ── Remessas do Full (GET /shipping/inbounds → estado embutido appProps.pageProps.data), visto ao vivo em 25/09/2026 ──
    const STATUS_REMESSA = { expired: 'Vencida', closed_ok: 'Recebida', closed_with_changes: 'Recebida com mudanças', cancelled: 'Cancelada',
        canceled: 'Cancelada', pending: 'Pendente', scheduled: 'Agendada', confirmed: 'Agendada', in_transit: 'A caminho', shipping_in_progress: 'A caminho', receiving: 'Em recebimento', working: 'Em andamento' };
    // Status que a tela não conhece: texto genérico em pt-BR (nunca o código em inglês do ML).
    const statusRemessaTxt = st => STATUS_REMESSA[st] || 'Em andamento';
    /**
     * pageData (o data da página, ou o estado que o contém) → { reconhecida, total, offset, remessas:[…], fiscal, penalidade } .
     * remessa = { id, tipo, status, statusTexto, agendada, recebida, unidades, declaradas, aptas, custo, multa, multaTipo, problemas, centro }.
     */
    SHC.mlRemessasFull = function (pageData) {
        const d = (pageData && pageData.appProps && pageData.appProps.pageProps && pageData.appProps.pageProps.data)
            || primeiroEmLargura(pageData, o => (Array.isArray(o.results) && o.paging ? o : undefined), 6) || {};
        const pg = d.paging || {}, num = v => { const n = SHC.num(v); return n === null ? null : n; };
        const remessas = (Array.isArray(d.results) ? d.results : []).filter(r => r && r.id !== undefined && r.id !== null).map(r => {
            const ap = r.appointment || {}, ch = r.inbound_charges || {}, pb = r.inbound_problems || {}, st = String(r.status || '');
            // with_penalties é um FLAG (true/false ao vivo); o valor da multa só quando o ML mandar número. total_charged null = ainda não cobrou (não é 0).
            const wp = ch.with_penalties, multaFlag = wp === true || SHC.num(wp) > 0 || !!ch.last_penalty_type;
            return { id: String(r.id), tipo: String(r.shipment_type || ''), status: st, subStatus: String(r.sub_status || ''), statusTexto: statusRemessaTxt(st),
                agendada: dia10(ap.date), recebida: dia10(r.reception_date), atualizada: dia10(r.last_updated),
                unidades: num(r.units_count), declaradas: num(r.products_count), aptas: num(r.on_sale_units),
                custo: num(ch.total_charged) === null ? null : SHC.r2(num(ch.total_charged)), multa: SHC.num(wp) > 0 ? SHC.r2(SHC.num(wp)) : null, multaFlag, multaTipo: String(ch.last_penalty_type || ''),
                problemas: { identificacao: pb.has_identification_problems === true, semSolucao: pb.has_unsolvable_problems === true, fiscal: pb.has_fiscal_problems === true },
                centro: String(r.logistic_center_id || '') };
        });
        return { reconhecida: Array.isArray(d.results), total: typeof pg.total === 'number' ? pg.total : null, offset: typeof pg.offset === 'number' ? pg.offset : null,
            remessas, fiscal: d.fiscal_restriction_name ? String(d.fiscal_restriction_name) : '', penalidade: d.active_penalty_by_uwsd === undefined ? null : d.active_penalty_by_uwsd };
    };
    /** Remessas → { 'AAAA-MM': {remessas, unidades, custo, multas} } pelo mês do recebimento (senão o agendado, senão a última mudança). */
    SHC.remessasPorMes = function (remessas) {
        const out = {};
        (remessas || []).forEach(r => {
            const dt = r && (r.recebida || r.agendada || r.atualizada);
            if (!dt) return;
            const m = out[dt.slice(0, 7)] || (out[dt.slice(0, 7)] = { remessas: 0, unidades: 0, custo: 0, multas: 0 });
            m.remessas++; m.unidades += r.unidades || 0; m.custo = SHC.r2(m.custo + (r.custo || 0)); m.multas = SHC.r2(m.multas + (r.multa || 0));
        });
        return out;
    };

    // ── Ofertas do catálogo (www.mercadolivre.com.br/p/MLB<cat>/s), leitor de TEXTO tolerante. Visto ao vivo (25/09/2026), 1 oferta por bloco:
    // "Novo R$ 409 3x R$ 161 , 95 Chegará terça-feira 13 de outubro Loja oficial Denteck Ar Condicionado +5 mil vendas Comprar agora Adicionar ao carrinho".
    // Tudo antes do 1º preço (onde fica "Enviar para <endereço>") é descartado e nenhum texto cru é guardado.
    const precoTxt = s => { const m = /R\$\s*(\d[\d.]*)(?:\s*,\s*(\d{2}))?/.exec(s); return m ? SHC.r2(+m[1].replace(/\./g, '') + (m[2] ? +m[2] / 100 : 0)) : null; };
    /** HTML ou texto → { ofertas:[{preco, parcelas:{n, valor}|null, semJuros, entrega, vendedor, lojaOficial, vendas}], variacaoIncerta } */
    SHC.mlOfertasCatalogo = function (textoOuHtml) {
        const s0 = String(textoOuHtml || '');
        const txt = (/<[a-z!]/i.test(s0) ? linhasDoHtml(s0).join(' ') : s0).replace(/\s+/g, ' ');
        const ofertas = [];
        // Oferta = pedaço que termina no botão. O resto depois do último "Adicionar ao carrinho" (rodapé, "Frete grátis a partir
        // de R$ 79") não é oferta; se a página só tiver "Comprar agora", vale até o último "Comprar agora".
        const blocos = txt.split(/Adicionar ao carrinho/i), resto = blocos.pop(), ultimo = /^([\s\S]*)Comprar agora/i.exec(resto);
        if (ultimo) blocos.push(ultimo[1]);
        blocos.forEach(bloco => {
            const ini = bloco.search(/(?:\b(?:Novo|Usado|Recondicionado)\s+)?R\$\s*\d/);
            if (ini < 0) return;
            const b = bloco.slice(ini).replace(/Comprar agora/gi, ' ').trim();
            const pc = /(\d{1,2})\s*x\s*(R\$\s*\d[\d.]*(?:\s*,\s*\d{2})?)/i.exec(b);
            const antes = pc ? b.slice(0, pc.index) : b.split(/Cheg|Receb|Entrega|Loja oficial|vendas/i)[0];
            const precos = (antes.match(/R\$\s*\d[\d.]*(?:\s*,\s*\d{2})?/g) || []).map(precoTxt);
            if (!precos.length) return;
            const ent = /((?:Chegar[áa]|Receba|Entrega)\s.*?)(?=\s*(?:Loja oficial|Vendido por|\+\s*\d|MercadoL[ií]der|$))/i.exec(b);
            const vd = /(\+?\s*(\d+)\s*(mil)?\s+vendas)/i.exec(b);
            const depois = b.slice(ent ? ent.index + ent[1].length : (pc ? pc.index + pc[0].length : 0), vd ? vd.index : undefined);
            const vendedor = depois.replace(/sem juros|Loja oficial|Vendido por|MercadoL[ií]der\s*\w*/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
            ofertas.push({ preco: precos[precos.length - 1], parcelas: pc ? { n: +pc[1], valor: precoTxt(pc[2]) } : null, semJuros: /sem juros/i.test(b),
                entrega: ent ? ent[1].trim().slice(0, 80) : '', vendedor, lojaOficial: /Loja oficial/i.test(b), vendas: vd ? +vd[2] * (vd[3] ? 1000 : 1) : null });
        });
        // A CONFIRMAR AO VIVO: a lista pode misturar variações (voltagem/cor). Se a página pede a variação, a comparação é incerta.
        return { ofertas, variacaoIncerta: /selecione (uma )?varia/i.test(txt) };
    };
    /** Ofertas + seu preço → { menorPreco, posicao (1 = o mais barato; empate não passa você para trás) } */
    SHC.posicaoNoCatalogo = function (ofertas, seuPreco) {
        const ps = (ofertas || []).map(o => o && o.preco).filter(p => p > 0);
        return { menorPreco: ps.length ? Math.min(...ps) : null, posicao: seuPreco > 0 ? 1 + ps.filter(p => p < seuPreco - 0.004).length : null };
    };

    // ── Afiliados (Venda com afiliados), mapeado ao vivo em 25/09/2026. Só leitura: o Copiloto nunca cria nem altera campanha e
    // nunca adiciona produtos. Nomes/apelidos de afiliados NUNCA são lidos nem guardados (só quantidade, vendas e custo). ──
    const mlb = v => { const d = String(v === null || v === undefined ? '' : v).replace(/^MLB/i, '').replace(/\D/g, ''); return d ? 'MLB' + d : ''; };
    function achaChave(o, k, prof) {
        if (!o || typeof o !== 'object' || prof < 0) return undefined;
        if (Object.prototype.hasOwnProperty.call(o, k)) return o[k];
        for (const x in o) { const v = achaChave(o[x], k, prof - 1); if (v !== undefined) return v; }
        return undefined;
    }
    // Produto da campanha (estado embutido ou API paginada): status = na campanha; publicacao = situação do anúncio (ACTIVE|PAUSED|CLOSED|INACTIVE).
    const itemAfil = x => ({ itemId: mlb(x.itemId || x.id), titulo: String(x.title || ''), comissao: SHC.num(x.extraCommission),
        status: String(x.status || x.publicationStatus || ''), publicacao: String(x.publicationStatus || ''), inicio: x.startDate || null });
    // Faixa de comissão que o ML permite (commissionSettings; nomes com e sem "Percentage") → { min, max, padrao, alerta } | null.
    const faixaAfil = cs => {
        if (!cs || typeof cs !== 'object') return null;
        const n = (a, b) => { const v = SHC.num(cs[a]); return v !== null ? v : SHC.num(cs[b]); };
        const f = { min: n('minimumPercentage', 'min'), max: n('maximumPercentage', 'max'), padrao: n('defaultPercentage', 'default'), alerta: n('warningThresholdPercentage', 'warningThreshold') };
        return f.min === null && f.max === null ? null : f;
    };
    const simNao = v => (v === true || v === false ? v : null);
    /**
     * Campanha com afiliados (/seller-affiliates/campaign → /campaign/<uuid>, estado embutido) → { status, comissaoGeral (%), inicio,
     * faixa {min,max,padrao,alerta} | null, entradaAutomatica (bool | null), produtos:[{ itemId 'MLB…', titulo, comissao (% extraCommission),
     * status, publicacao, inicio }], totalProdutos (currentCampaignItems.countItems; null se não vier) } | null.
     * O estado traz só a 1ª página (20 produtos): o resto vem de SHC.afilCampanhaApi.
     */
    SHC.afilCampanhaDoEstado = function (r) {
        const cd = achaChave(r, 'campaignDetail', 8);
        if (!cd || typeof cd !== 'object') return null;
        const ci = cd.currentCampaignItems || {}, lista = Array.isArray(ci.list) ? ci.list : [];
        const produtos = lista.map(itemAfil).filter(p => p.itemId);
        const pag = ci.paging || ci.pagination || {};
        const total = [ci.countItems, ci.total, ci.totalItems, ci.totalCount, pag.total, cd.totalItems].map(SHC.num).find(n => n !== null && n >= 0);
        const campo = k => (cd[k] !== undefined ? cd[k] : (cd.campaign || {})[k]);
        const inicios = produtos.map(p => p.inicio).filter(Boolean).sort();
        return { status: campo('status') || null, comissaoGeral: SHC.num(campo('generalExtraCommission')), inicio: campo('startDate') || inicios[0] || null,
            faixa: faixaAfil(campo('commissionSettings')), entradaAutomatica: simNao(campo('enableAutomaticNewItems')),
            produtos, totalProdutos: total === undefined ? null : total };
    };
    /**
     * Uma página da lista da campanha pela API (GET /meliconnect/api/seller-affiliates/campaigns/<uuid>?page=N&orderBy=extra_commission
     * &order=desc&countExec=false&countVal=<total>, mapeado ao vivo em 26/09/2026) → { status, comissaoGeral, faixa, entradaAutomatica,
     * pagina, porPagina, totalProdutos, produtos } | null (formato desconhecido).
     */
    SHC.afilCampanhaApi = function (j) {
        const il = j && j.itemList;
        if (!il || !Array.isArray(il.list)) return null;
        const t = SHC.num(il.countItems);
        return { status: j.status || null, comissaoGeral: SHC.num(j.generalExtraCommission), faixa: faixaAfil(j.commissionSettings), entradaAutomatica: simNao(j.enableAutomaticNewItems),
            pagina: SHC.num(il.page), porPagina: SHC.num(il.itemsPerPage), totalProdutos: t !== null && t >= 0 ? t : null, produtos: il.list.map(itemAfil).filter(p => p.itemId) };
    };
    /**
     * Pedidos por afiliados, uma página (GET /meliconnect/api/seller-affiliates/orders/detail, 10 por página, page começa em 0) →
     * { pagina, paginas, total, vendas:[{ itemId, sku, titulo, valor, unidades, comissao, verificacao }] } | null.
     * NUNCA lê affiliate{} (nome/apelido/foto do afiliado) nem o número do pedido.
     */
    SHC.afilPedidos = function (j) {
        if (!j || !Array.isArray(j.sales)) return null;
        const pg = j.pagination || {};
        return { pagina: SHC.num(pg.page), paginas: SHC.num(pg.pages), total: SHC.num(pg.total !== undefined ? pg.total : j.total),
            vendas: j.sales.map(v => { const p = (v && v.product) || {}, d = (v && v.saleDetail) || {};
                return { itemId: mlb(p.itemId), sku: String(p.sku || ''), titulo: String(p.productTitle || ''), valor: SHC.num(v && v.saleValue), unidades: SHC.num(p.quantity),
                    comissao: SHC.num(v && v.commissionPerOrder), verificacao: String(d.verificationStatus || '') }; }) };
    };
    // verificationStatus: 'not_verified' visto ao vivo; os outros nomes são A CONFIRMAR (o que não for reconhecido vai para "outros").
    SHC.afilVerificacao = s => (/^not_|pend|to_verify|a_verificar/i.test(s) ? 'aVerificar' : /^(verified|approved|confirmed|confirmado)$/i.test(s) ? 'confirmados' : 'outros');
    /**
     * Soma dos pedidos por afiliados → { pedidos, unidades, valor, comissao, aVerificar|confirmados|outros: { pedidos, valor, comissao },
     * porSku:[{ sku, itemId, titulo, pedidos, unidades, valor, comissao, aVerificar, confirmados, outros }] (maior valor primeiro) }.
     */
    SHC.afilPedidosAgrega = function (vendas) {
        const r2 = SHC.r2, zero = () => ({ pedidos: 0, valor: 0, comissao: 0 }), out = { pedidos: 0, unidades: 0, valor: 0, comissao: 0, aVerificar: zero(), confirmados: zero(), outros: zero() };
        const por = {};
        (vendas || []).forEach(v => {
            const k = v.sku || v.itemId || '?', st = SHC.afilVerificacao(v.verificacao), g = out[st];
            const s = por[k] = por[k] || { sku: v.sku, itemId: v.itemId, titulo: v.titulo, pedidos: 0, unidades: 0, valor: 0, comissao: 0, aVerificar: 0, confirmados: 0, outros: 0 };
            s.pedidos++; s[st]++; s.unidades += v.unidades || 0; s.valor += v.valor || 0; s.comissao += v.comissao || 0;
            g.pedidos++; g.valor += v.valor || 0; g.comissao += v.comissao || 0;
            out.pedidos++; out.unidades += v.unidades || 0; out.valor += v.valor || 0; out.comissao += v.comissao || 0;
        });
        ['valor', 'comissao'].forEach(k => { out[k] = r2(out[k]); ['aVerificar', 'confirmados', 'outros'].forEach(g => { out[g][k] = r2(out[g][k]); }); });
        out.porSku = Object.keys(por).map(k => Object.assign(por[k], { valor: r2(por[k].valor), comissao: r2(por[k].comissao) })).sort((a, b) => b.valor - a.valor);
        return out;
    };
    /**
     * Métricas por produto (GET /meliconnect/api/seller-affiliates/dashboard/products, confirmado ao vivo) → { vendas, unidades, qtdVendas,
     * custoEstimado (comissão estimada), ultimaAtualizacao, pagina, paginas, porProduto:[{ itemId, titulo, preco, cliques, vendas, unidades,
     * qtdVendas, custoEstimado, roi }] } | null (formato desconhecido).
     */
    SHC.afilMetricas = function (j) {
        const s = j && j.summary, it = j && j.items;
        if (!s || !it || !Array.isArray(it.products)) return null;
        const v = x => SHC.num(x && typeof x === 'object' ? x.value : x), pg = it.pagination || {};
        return { vendas: v(s.totalSales), unidades: SHC.num(s.soldUnits), qtdVendas: SHC.num(s.salesCount), custoEstimado: v(s.fee), ultimaAtualizacao: s.lastUpdate || null,
            pagina: SHC.num(pg.page), paginas: SHC.num(pg.pages),
            porProduto: it.products.map(p => ({ itemId: mlb(p.itemId), titulo: String(p.itemName || ''), preco: SHC.num(p.itemPrice), cliques: SHC.num(p.clicks),
                vendas: SHC.num(p.salesAmount), unidades: SHC.num(p.soldUnits), qtdVendas: SHC.num(p.salesCount), custoEstimado: SHC.num(p.estimatedCommission), roi: SHC.num(p.roi) }))
                .filter(p => p.itemId) };
    };
    /** Resumo da etapa: "1.379 produtos na campanha · 4% · R$ 316,69 em vendas (30 dias)" | "Esta conta não usa afiliados". */
    SHC.afilResumo = function (a) {
        if (!a || !a.temAfiliados) return 'Esta conta não usa afiliados';
        const c = a.campanha || {}, m = a.metricas || {}, n = c.totalProdutos !== null && c.totalProdutos !== undefined ? c.totalProdutos : (c.produtos || []).length;
        return [SHC.qtd(n, 'produto na campanha', 'produtos na campanha'), c.comissaoGeral !== null && c.comissaoGeral !== undefined ? SHC.pctTxt(c.comissaoGeral) : '',
            m.vendas !== null && m.vendas !== undefined ? SHC.moeda(m.vendas) + ' em vendas (30 dias)' : ''].filter(Boolean).join(' · ');
    };

    // ── Simulador de custos do ML (/simulador-de-custos?itemId=<MLB>), mapeado ao vivo em 25/09/2026. Estado embutido
    // appProps.pageProps.initialState.calculator (bricks); o recálculo (POST /simulador-de-custos/api/refresh-calculator) devolve
    // o MESMO array de bricks. Conta do ML: preço − tarifa − (frete com desconto | custo operacional com desconto) = você recebe. ──
    SHC.SIM_URL = 'https://vendedores.mercadolivre.com.br/simulador-de-custos';
    SHC.simLink = itemId => SHC.SIM_URL + '?itemId=' + encodeURIComponent(itemId);
    function calculadora(r) {
        if (Array.isArray(r)) return { bricks: r };
        const c = r && (((((r.appProps || {}).pageProps || r.pageProps || {}).initialState) || r.initialState || {}).calculator);
        return c || (r && Array.isArray(r.bricks) ? r : null);
    }
    function bricksPorId(bricks) {
        const m = {};
        (function a(l) { (l || []).forEach(b => { if (!b) return; if (b.id) m[b.id] = b.data || {}; if (b.bricks) a(b.bricks); }); })(bricks);
        return m;
    }
    const numPct = t => { const m = /(\d+(?:[.,]\d+)?)\s*%/.exec(String(t || '').replace(/<[^>]*>/g, '')); return m ? SHC.num(m[1]) : null; };
    /**
     * Estado do Simulador (ou a resposta do recálculo) → { itemId, preco, tarifa, tarifaPct, tipo, freteOpcao 'free'|'not_free',
     * frete {cheio, comDesconto} (só free), operacional {cheio, comDesconto} (só not_free), subsidioPct, custos, recebe, confere } | null.
     * confere = preço − tarifa − envio com desconto (tem que dar o "Você recebe" do ML; o teste garante com o retrato real).
     */
    SHC.mlSimuladorDoEstado = function (r, itemId) {
        const c = calculadora(r);
        if (!c || !Array.isArray(c.bricks)) return null;
        const b = bricksPorId(c.bricks), d = id => b[id] || {}, rs = t => SHC.valorRS(t);
        const opcao = d('shipping_col1_row2').default_selected;
        if (opcao !== 'free' && opcao !== 'not_free') return null;
        const par = x => { const com = rs(x.new_price), cheio = rs(x.previous_price); return com === null ? null : { cheio: cheio === null ? com : cheio, comDesconto: com }; };
        const envio = par(d('shipping_col1_row2_discount'));
        const preco = SHC.num(d('selling_price_ML').value) !== null ? SHC.num(d('selling_price_ML').value) : rs(d('summary_col0_row0').text);
        const out = { itemId: mlb(itemId || (c.body && c.body.item_id)) || null, preco, tarifa: rs(d('listing_types_col1_row2_SUB2').new_price),
            tarifaPct: numPct(d('listing_types_col1_row2_SUB3').text), tipo: d('listing_type_col0_row3').default_selected || null, freteOpcao: opcao,
            frete: opcao === 'free' ? envio : null, operacional: opcao === 'not_free' ? envio : null, subsidioPct: numPct(d('shipping_col1_row2_percentage').text),
            custos: rs(d('summary_col0_row1').text), recebe: rs(d('summary_col0_row3').text) };
        if (out.preco === null || out.recebe === null || out.tarifa === null) return null;
        out.confere = SHC.r2(out.preco - out.tarifa - (envio ? envio.comDesconto : 0));
        return out;
    };
    /**
     * Corpo do recálculo (o mesmo que a página do ML manda), trocando só shipping_col1_row2 = opcao ('free' | 'not_free').
     * Usa o body da calculadora quando vier; senão monta pelos bricks do estado inicial. → objeto | null.
     */
    SHC.simPedido = function (r, itemId, opcao) {
        const c = calculadora(r), troca = opcao ? { shipping_col1_row2: opcao } : {};
        if (!c) return null;
        if (c.body && typeof c.body === 'object' && c.body.item_id) return Object.assign({}, c.body, troca);
        if (!Array.isArray(c.bricks)) return null;
        const b = bricksPorId(c.bricks), d = id => b[id] || {}, raiz = b.cost_calculator_table || {};
        const id = mlb(itemId), preco = SHC.num(d('selling_price_ML').value);
        if (!id || !raiz.category_id || preco === null) return null;
        return Object.assign({ item_id: id, category_id: raiz.category_id, domain_id: raiz.domain_id, listing_type_id: d('listing_type_col0_row3').default_selected,
            listing_types_col1_row2_SUB1: d('listing_types_col1_row2_SUB1').value, shipping_channel: d('shipping_col0_row2').default_selected,
            shipping_col1_row2: d('shipping_col1_row2').default_selected, channels: [].concat(raiz.channels || []).join(','), condition: raiz.condition,
            currency_id: raiz.currency_id, selling_price_ML: String(preco), selling_price_MS: '0', internal_charges: '0', full_send_units: '0',
            full_projection_weekly_sales: '0', is_internal_charges_omitted: false, is_internal_charges_filled: false }, troca);
    };
    /**
     * Conferência com o "Você recebe" do Copiloto (tolerância R$ 0,05). Não bateu → mostra os dois e vale o do ML (nunca esconde).
     * → { bate true|false|null (null = não dá para comparar), recebe (o do ML), dif, texto } | null.
     */
    SHC.simConfere = function (sim, recebe, preco) {
        if (!sim || sim.recebe === null || sim.recebe === undefined) return null;
        if (preco > 0 && sim.preco > 0 && Math.abs(sim.preco - preco) > 0.005)
            return { bate: null, recebe: sim.recebe, dif: null, texto: 'O Simulador do ML usou o preço ' + SHC.moeda(sim.preco) + ' (hoje o anúncio está a ' + SHC.moeda(preco) + '): lá você recebe ' + SHC.moeda(sim.recebe) + '.' };
        if (recebe === null || recebe === undefined || !isFinite(recebe)) return { bate: null, recebe: sim.recebe, dif: null, texto: 'Simulador do ML: você recebe ' + SHC.moeda(sim.recebe) + '.' };
        const dif = SHC.r2(sim.recebe - recebe);
        if (Math.abs(dif) <= 0.05) return { bate: true, recebe: sim.recebe, dif, texto: 'Conferido com o Simulador do ML: você recebe ' + SHC.moeda(sim.recebe) + ' ✓' };
        return { bate: false, recebe: sim.recebe, dif, texto: 'O Simulador do ML diz que você recebe ' + SHC.moeda(sim.recebe) + '; o Copiloto calculou ' + SHC.moeda(recebe) + '. Vale o do ML.' };
    };
    /**
     * Cartão "E se eu oferecer frete grátis?" / "E se o comprador pagar o frete?" (o contrário do que o anúncio usa hoje). Só mostra;
     * quem decide é o seller. → { titulo, linhas:[{ rotulo, recebe, detalhe, texto }], dif, diferenca, link } | null.
     */
    SHC.simEse = function (hoje, outro) {
        if (!hoje) return null;
        const gratis = hoje.freteOpcao === 'free';
        const detalhe = s => {
            if (s.freteOpcao === 'free') {
                const f = s.frete;
                if (!f) return '';
                const desc = f.cheio > f.comDesconto + 0.004, pct = s.subsidioPct || (desc ? Math.round((1 - f.comDesconto / f.cheio) * 100) : null);
                return 'frete ' + SHC.moeda(f.cheio) + (desc ? ', o ML cobre ' + SHC.pctTxt(pct) + ' pela sua reputação → ' + SHC.moeda(f.comDesconto) : '');
            }
            const o = s.operacional;
            if (!o) return '';
            return 'custo operacional ' + (o.cheio > o.comDesconto + 0.004 ? SHC.moeda(o.cheio) + ' → ' + SHC.moeda(o.comDesconto) + ' com desconto' : SHC.moeda(o.comDesconto));
        };
        const linha = (s, rotulo, comDetalhe) => {
            const det = detalhe(s);
            return { rotulo, recebe: s.recebe, detalhe: det, texto: rotulo + ': você recebe ' + SHC.moeda(s.recebe) + (comDetalhe && det ? ' (' + det + ')' : '') };
        };
        const rotOutro = gratis ? 'Com o comprador pagando o frete' : 'Com frete grátis';
        const out = { titulo: gratis ? 'E se o comprador pagar o frete?' : 'E se eu oferecer frete grátis?', linhas: [linha(hoje, gratis ? 'Hoje (frete grátis)' : 'Hoje (comprador paga)', false)],
            dif: null, diferenca: '', link: hoje.itemId ? SHC.simLink(hoje.itemId) : SHC.SIM_URL };
        if (!outro || outro.freteOpcao === hoje.freteOpcao || outro.recebe === null) {
            out.diferenca = 'Não consegui simular a outra opção agora. Confira no Simulador do ML.';
            return out;
        }
        out.linhas.push(linha(outro, rotOutro, true));
        out.dif = SHC.r2(outro.recebe - hoje.recebe);
        out.diferenca = out.dif === 0 ? rotOutro + ', você recebe o mesmo valor por venda.'
            : rotOutro + ', você recebe ' + SHC.moeda(Math.abs(out.dif)) + (out.dif < 0 ? ' a menos' : ' a mais') + ' por venda.';
        return out;
    };

    // ── v2.5: Saúde dos anúncios (mapeado ao vivo em 25/09/2026, conta real) ──
    // Avisos da lista (GET /anuncios/api/tasks), anúncios sem dados fiscais (/anuncios?filters=WITHOUT_FISCAL_DATA), fotos do anúncio
    // (tela "Alterar anúncio": GET www.mercadolivre.com.br/syi/core/modify?itemId=, abrir não altera nada) e visitas por dia
    // (/metricas/performance-item/api/item/<MLB>/evolutionary/bricks). Funções puras; quem busca é o background.js.
    SHC.FISCAL_EDITOR = 'https://www.mercadolivre.com.br/anuncios/editor-massivo?viewId=fiscal-information&filters=WITHOUT_FISCAL_DATA';
    SHC.fotosLink = itemId => 'https://www.mercadolivre.com.br/syi/core/modify?itemId=' + encodeURIComponent(itemId);
    SHC.visitasLink = itemId => 'https://vendedores.mercadolivre.com.br/metricas/performance-item/api/item/' + encodeURIComponent(itemId)
        + '/evolutionary/bricks?variation.id=&start_period_evolutionary=lastThirtyDays&finish_period_evolutionary=lastPeriod&';
    const linkMLOk = u => /^https:\/\/([a-z]+\.)?mercadoli[vb]re\.com\.br\//.test(String(u || ''));

    /** Avisos da lista de Anúncios → [{id, qtd, titulo, texto, link}] | null (resposta que não é a lista de avisos: nunca "0"). */
    SHC.mlTarefasAnuncios = function (j) {
        const arr = Array.isArray(j) ? j : (j && Array.isArray(j.tasks) ? j.tasks : null);
        if (!arr) return null;
        return arr.filter(t => t && typeof t.id === 'string' && t.id).map(t => {
            const a = t.action || {}, q = inteiro(t.cases);
            const link = a.type === 'filter' && a.filters ? 'https://vendedores.mercadolivre.com.br/anuncios?filters=' + encodeURIComponent(String(a.filters))
                : linkMLOk(a.href) ? String(a.href) : t.id === 'GROUPED_WITHOUT_FISCAL_DATA' ? SHC.FISCAL_EDITOR : '';
            return { id: t.id, qtd: q !== null && q > 0 ? q : 0, titulo: String(t.title || '').slice(0, 120), texto: String(t.message || '').slice(0, 240), link };
        });
    };
    /**
     * Linhas de uma página da lista filtrada (o total do ML conta LINHAS: 30 por página). Família fechada vem sem MLB (metadata.itemId '')
     * → { linhas, familias:[familyId] }. Os MLB saem de SHC.mlPaginaAnuncios (inclui os de dentro das linhas abertas).
     */
    SHC.mlLinhasDaPagina = function (r) {
        const vd = r && r.appProps && r.appProps.pageProps && r.appProps.pageProps.viewData, rows = ((vd && vd.rows) || []).filter(x => x && x.metadata);
        return { linhas: rows.length, familias: rows.filter(x => !x.metadata.itemId && x.metadata.familyId && !(Array.isArray(x.innerRows) && x.innerRows.length)).map(x => String(x.metadata.familyId)) };
    };
    /** Quantos anúncios sem dados fiscais (aviso GROUPED_WITHOUT_FISCAL_DATA; sem o aviso = 0). null = avisos não lidos. */
    SHC.mlSemFiscal = function (tarefas) {
        if (!Array.isArray(tarefas)) return null;
        const t = tarefas.find(x => x && x.id === 'GROUPED_WITHOUT_FISCAL_DATA');
        return t ? t.qtd : 0;
    };

    // Fotos: brick 'picture_uploader_task' (botão Confirmar) com o filho 'picture_uploader' (data.defaultValue = fotos NA ORDEM; a 1ª é a capa).
    const achaBrick = (r, id, prof) => primeiroEmLargura(r, o => (o.id === id && o.data && typeof o.data === 'object' ? o : undefined), prof || 40);
    const eventoConfirmar = task => ((((task && task.data && task.data.footer) || {}).primaryButton || {}).event || {}).data || null;
    /**
     * Tela "Alterar anúncio" → { itemId, qtd, max, capaId, ids[], problemas, fotos[{id, problema}], visitasTotal, vendidasTotal, ev, brutas } | null.
     * ev = evento do botão Confirmar SEM o JWT (headers: []). brutas = as fotos como o ML mandou (só em memória, para gravar a ordem; NÃO guardar).
     * html (opcional): o texto "23297 visitas e 1653 unidades vendidas no total" é procurado no estado e, se não estiver lá, na página.
     */
    SHC.mlFotosDoEstado = function (r, html) {
        const task = r && achaBrick(r, 'picture_uploader_task');
        const up = task && primeiroEmLargura(task, o => (o.id === 'picture_uploader' && o.data && Array.isArray(o.data.defaultValue) ? o : undefined), 12);
        if (!up) return null;
        const brutas = up.data.defaultValue.filter(f => f && typeof f.id === 'string' && f.id).map(f => JSON.parse(JSON.stringify(f)));
        const fotos = brutas.map(f => ({ id: f.id, problema: !!(f.hasModeration || f.hasPerformanceWarning) }));
        const e0 = eventoConfirmar(task);
        const ev = e0 && typeof e0.path === 'string' ? Object.assign(JSON.parse(JSON.stringify(e0)), { headers: [] }) : null;
        const itemId = (/[?&]item_id=(MLB\d+)/.exec((ev && ev.path) || '') || [])[1] || '';
        let m = null;
        try { m = RE_VISITAS.exec(JSON.stringify(r)); } catch (e) { m = null; }
        if (!m && html) m = RE_VISITAS.exec(String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '));
        const max = inteiro(up.data.maxPhotosQuantity);
        return { itemId, qtd: fotos.length, max: max > 0 ? max : null, capaId: fotos.length ? fotos[0].id : '', ids: fotos.map(f => f.id),
            problemas: fotos.filter(f => f.problema).length, fotos, visitasTotal: m ? inteiro(m[1]) : null, vendidasTotal: m ? inteiro(m[2]) : null, ev, brutas };
    };
    const RE_VISITAS = /(\d[\d.]*)\s+visitas?\s+e\s+(\d[\d.]*)\s+unidades?\s+vendidas?\s+no\s+total/i;
    /** JWT do botão Confirmar (header Authorization). Só para gravar NA HORA: nunca guardar. */
    SHC.mlJwtDoEstado = function (r) {
        const e = eventoConfirmar(r && achaBrick(r, 'picture_uploader_task')), h = ((e && e.headers) || []).find(x => x && /^authorization$/i.test(String(x.key || '')));
        return h && typeof h.value === 'string' && h.value ? h.value : null;
    };
    /** O que fica guardado de uma leitura de fotos (fotos:<conta>.porItem[MLB]). */
    SHC.fotosParaGuardar = f => ({ qtd: f.qtd, max: f.max, capaId: f.capaId, ids: f.ids.slice(), problemas: f.problemas,
        visitasTotal: f.visitasTotal, vendidasTotal: f.vendidasTotal, ts: Date.now() });

    /**
     * Visitas por dia do anúncio (evolutionary/bricks) → { dias:{'AAAA-MM-DD': visitas}, total, unicas, variacaoPct, conversao } | null.
     * Conferido no retrato: total_visits = "Total de visitas" (soma 1.538) e visits_chart = "Visitas únicas" (1.136). dias usa as TOTAIS.
     * variacaoPct = a do "Total de visitas" contra o período anterior (+89,6); conversao em % (8,7).
     */
    SHC.mlVisitasDoEstado = function (j) {
        const graf = primeiroEmLargura(j, o => (o.id === 'evolutionary_chart' && o.data && Array.isArray(o.data.dataset) ? o.data : undefined), 20);
        if (!graf) return null;
        const dias = {};
        graf.dataset.forEach(p => { const d = p && dia10(p.date), v = p ? SHC.num(p.total_visits) : null; if (d && v !== null) dias[d] = Math.max(0, Math.round(v)); });
        if (!Object.keys(dias).length) return null;
        const grid = primeiroEmLargura(j, o => (o.id === 'evolutionary_metrics_grid' && o.data && Array.isArray(o.data.metrics) ? o.data : undefined), 20);
        const met = id => ((grid && grid.metrics) || []).find(x => x && x.id === id) || null;
        const tv = met('total_visits'), un = met('visits_chart'), cv = met('conversion');
        const pv = tv && tv.pill ? numPct(tv.pill.value) : null;
        const soma = Object.keys(dias).reduce((s, d) => s + dias[d], 0);
        return { dias, total: tv && inteiro(tv.value) !== null ? inteiro(tv.value) : soma, unicas: un ? inteiro(un.value) : null,
            variacaoPct: pv === null ? null : (tv.pill.state === 'down' ? -pv : pv), conversao: cv ? numPct(cv.value) : null };
    };
    /** Junta a leitura nova no que estava guardado (visitas:<conta>.porItem[MLB]). O dia da leitura ainda não acabou: fica fora. Máx. 60 dias. */
    SHC.visitasJunta = function (ant, lida, hoje) {
        const dias = Object.assign({}, (ant && ant.dias) || {}, lida.dias);
        delete dias[hoje || SHC.hoje()];
        Object.keys(dias).sort().slice(0, -60).forEach(d => { delete dias[d]; });
        return { ts: Date.now(), dias, total30: lida.total, unicas30: lida.unicas, variacaoPct: lida.variacaoPct, conversao: lida.conversao };
    };

    // ── Radar de visitas e robô de fotos (puros) ──
    const diaMenosISO = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') - n * 864e5).toISOString().slice(0, 10);
    const diaLocal = ts => { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    const pctVar = (agora, antes) => (antes > 0 ? Math.round((agora - antes) / antes * 1000) / 10 : null);
    /**
     * Últimos 7 dias completos × os 7 anteriores. Referência = o último dia guardado antes de hoje (hoje ainda não acabou);
     * se ele tiver mais de 2 dias, ou faltar dia nas 2 semanas, ou forem menos de 30 visitas juntas → 'poucos' (não julgar).
     * → { ult7, ant7, variacaoPct, classe:'caindo'|'estavel'|'subindo'|'poucos', ate }
     */
    SHC.radarVisitas = function (dias, hoje, limiarPct) {
        const d = dias || {}, h = hoje || SHC.hoje(), lim = SHC.num(limiarPct) > 0 ? SHC.num(limiarPct) : 20;
        const ref = Object.keys(d).filter(x => x < h).sort().pop() || '';
        let ult7 = 0, ant7 = 0, falta = !ref || ref < diaMenosISO(h, 2);
        for (let k = 0; k < 14 && !falta; k++) { const v = d[diaMenosISO(ref, k)]; if (typeof v !== 'number') falta = true; else if (k < 7) ult7 += v; else ant7 += v; }
        if (falta) return { ult7: null, ant7: null, variacaoPct: null, classe: 'poucos', ate: ref || null };
        const variacaoPct = pctVar(ult7, ant7);
        const classe = ult7 + ant7 < 30 ? 'poucos' : ant7 === 0 || variacaoPct >= lim ? 'subindo' : variacaoPct <= -lim ? 'caindo' : 'estavel';
        return { ult7, ant7, variacaoPct, classe, ate: ref };
    };
    /** Efeito de uma mudança: 7 dias antes do dia da mudança × os 7 depois dele. pronto = os 7 dias depois já passaram e foram lidos. */
    SHC.efeitoMudanca = function (mudancaTs, dias, hoje) {
        const d = dias || {}, d0 = diaLocal(mudancaTs), h = hoje || SHC.hoje();
        let antes7 = 0, depois7 = 0, lidosDepois = 0;
        for (let k = 1; k <= 7; k++) {
            antes7 += +d[diaMenosISO(d0, k)] || 0;
            const v = d[diaMenosISO(d0, -k)];
            if (typeof v === 'number') { depois7 += v; lidosDepois++; }
        }
        return { antes7, depois7, variacaoPct: pctVar(depois7, antes7), pronto: h > diaMenosISO(d0, -7) && lidosDepois === 7 };
    };
    /** Anúncio ativo no retrato (status 'active' do ML). */
    SHC.anuncioAtivo = i => { let s = i && i.status; if (s && typeof s === 'object') s = s.id || s.label || ''; return /^(active|ativo)$/i.test(String(s || '').trim()); };

    // Gravar a ordem das fotos (M5) só com esta constante em true. Formato do corpo = o da gravação capturada ao vivo em 25/09/2026
    // (tests/copiloto/fixtures/robo_salvar_fotos_capturado.json): body.output.value = fotos em snake_case + header x-csrf-token.
    SHC.ROBO_ESCRITA_CONFERIDA = false;
    SHC.ROBO_CHAVE = 'value';
    SHC.ROBO_URL = 'https://vendedores.mercadolivre.com.br/publicaciones/app/modificar/omni/api/event-request';
    /** Uma foto do defaultValue da tela (camelCase) → como a tela manda no PUT (snake_case, loading:false, remedies:[]). */
    SHC.roboFotoSaida = b => ({ id: b.id, max_size: b.maxSize, url: b.url, secure_url: b.secureUrl, quality: b.quality, size: b.size,
        has_moderation: !!b.hasModeration, name: b.name, has_performance_warning: !!b.hasPerformanceWarning, loading: false, remedies: [] });
    /** Corpo do PUT event-request, como a tela monta: {...ev, body:{...ev.body, output:{value: fotos na nova ordem}}, headers:{}, queryParams:{}, jwtEvent}. */
    SHC.roboCorpo = (ev, jwt, brutas) => Object.assign({}, ev, { body: Object.assign({}, ev.body || {}, { output: { [SHC.ROBO_CHAVE]: brutas.map(SHC.roboFotoSaida) } }), headers: {}, queryParams: {}, jwtEvent: jwt });
    /** <meta name="csrf-token" content="…"> da tela "Alterar anúncio" (vai no header x-csrf-token). Só em memória: nunca guardar. */
    SHC.mlCsrfDoHtml = function (html) {
        const m = /<meta\b[^>]*\bname=["']csrf-token["'][^>]*>/i.exec(String(html || '')), c = m && /\bcontent=["']([^"']+)["']/i.exec(m[0]);
        return c ? c[1] : null;
    };
    /** Nova ordem: a capa (1ª) fica; a 2ª vai para o fim. Menos de 3 fotos → null (não mexe). */
    SHC.roboGira = ids => (Array.isArray(ids) && ids.length >= 3 ? [ids[0]].concat(ids.slice(2), [ids[1]]) : null);
    /** A nova ordem é só a mesma lista em outra ordem, com a MESMA capa? */
    SHC.roboOrdemValida = (atual, nova) => Array.isArray(atual) && Array.isArray(nova) && atual.length >= 2 && nova.length === atual.length
        && nova[0] === atual[0] && nova.slice().sort().join('|') === atual.slice().sort().join('|') && nova.join('|') !== atual.join('|');
    const intervaloDias = c => { const n = SHC.num(c.robo_intervalo_dias); return n > 0 ? n : 7; };
    const maxDia = c => { const n = SHC.num(c.robo_max_dia); return n >= 0 && n !== null ? n : 5; };
    /** Gravação que chegou ao ML: 'ok' (conferida) ou 'incerto' (o PUT saiu, mas a releitura não confirmou). As duas contam no limite e no intervalo. */
    SHC.roboGravou = h => !!h && (h.resultado === 'ok' || h.resultado === 'incerto');
    /** Trocas feitas pelo robô hoje (na conta). */
    SHC.roboFeitasHoje = (historico, agora) => (historico || []).filter(h => SHC.roboGravou(h) && diaLocal(h.ts) === diaLocal(agora || Date.now())).length;
    /** Ordens que o robô conhece para a entrada: a lida depois; se incerto, também a pedida e a de antes (o ML pode ter aplicado ou não). */
    SHC.roboOrdensDa = h => [h.depois].concat(h.resultado === 'incerto' ? [h.pedido, h.antes] : []).filter(Array.isArray).map(o => o.join('|'));
    /**
     * Decide o que o robô faz num anúncio → { acao:'girar'|'nada', motivo (pt-BR), novaOrdem, registrar? }.
     * registrar = {antes, depois}: o seller mudou as fotos depois da última troca do robô → o fundo registra (resultado 'manual') e o
     * intervalo recomeça. fotos = fotos:<conta>.porItem[MLB]; radar = SHC.radarVisitas; historico = robo:<conta>.historico.
     */
    SHC.roboDecide = function (x) {
        const c = Object.assign({}, SHC.PADRAO, (x && x.cfg) || {}), item = (x && x.item) || {}, id = item.itemId, f = x && x.fotos;
        const radar = (x && x.radar) || {}, agora = (x && x.agora) || Date.now(), dias = intervaloDias(c);
        const nada = (motivo, extra) => Object.assign({ acao: 'nada', motivo, novaOrdem: null }, extra || {});
        if (!c.robo_ligado) return nada('O robô de fotos está desligado.');
        if (!(c.robo_itens || {})[id]) return nada('O robô está desligado neste anúncio.');
        if (!SHC.anuncioAtivo(item)) return nada('O anúncio não está ativo.');
        if (!f || !Array.isArray(f.ids) || !f.ids.length) return nada('Ainda não li as fotos deste anúncio.');
        const doItem = ((x && x.historico) || []).filter(h => h && h.itemId === id && (SHC.roboGravou(h) || h.resultado === 'manual'));
        const ult = doItem[doItem.length - 1];
        if (ult && !((f.ts || 0) > ult.ts)) return nada('Esperando a próxima leitura das fotos.');
        if (ult && SHC.roboOrdensDa(ult).indexOf(f.ids.join('|')) < 0)
            return nada('Você mudou as fotos deste anúncio. O robô espera ' + dias + ' dias antes de mexer de novo.', { registrar: { antes: (ult.depois || []).slice(), depois: f.ids.slice() } });
        if (radar.classe !== 'caindo') return nada(radar.classe === 'subindo' ? 'As visitas estão subindo.' : radar.classe === 'estavel' ? 'As visitas estão estáveis.'
            : 'Poucas visitas para comparar (menos de 30 em 2 semanas).');
        if (f.problemas > 0) return nada('O Mercado Livre marcou ' + SHC.qtd(f.problemas, 'foto', 'fotos') + ' deste anúncio. Corrija as fotos marcadas pelo ML primeiro.');
        const nova = SHC.roboGira(f.ids);
        if (!nova) return nada('O anúncio tem menos de 3 fotos: não dá para trocar a ordem sem mexer na capa.');
        // Troca que o seller desfez (entrada desfazer: antes = a ordem do robô que ele recusou): o robô não repete a mesma ordem.
        if (doItem.some(h => h.desfazer && (h.antes || []).join('|') === nova.join('|'))) return nada('Você desfez esta troca antes. O robô não repete a mesma troca neste anúncio.');
        if (ult && agora - ult.ts < dias * 864e5) return nada('A última troca foi há menos de ' + dias + ' dias. Esperando o resultado dela.');
        if (SHC.roboFeitasHoje(x && x.historico, agora) >= maxDia(c)) return nada('Limite de ' + maxDia(c) + ' trocas por dia alcançado. Continua amanhã.');
        return { acao: 'girar', novaOrdem: nova,
            motivo: 'As visitas caíram ' + String(Math.abs(radar.variacaoPct)).replace('.', ',') + '% na última semana (' + radar.ult7 + ' contra ' + radar.ant7 + '). Troca da ordem das fotos; a capa fica.' };
    };

    // ── v2.5.2: Monitor de medidas (mapeado ao vivo em 25/09/2026). MESMA tela "Alterar anúncio" das fotos (mesmo GET, mesma permissão de www):
    //   F1 "Forma de entrega": brick id 'shipping_task_<MLB>' → data.metrics.show.dimensions = {height, width, length (cm), weight (GRAMAS)};
    //   "Embalagem de envio" (id 'pyme_package_task', a que o frete usa) e "Embalagem de fábrica" (id 'pyme_factory_task'):
    //   data.header.collapsedSubtitles[0].text = "Medidas e peso calculados pelo Mercado Livre: 39 x 9 x 7 cm e 1.77 kg.".
    // A planilha do ML troca altura e largura em relação à tela: compara-se SEMPRE as 3 medidas ORDENADAS + o peso.
    // Peso volumétrico do ML = (L × A × P) / 6000; peso considerado = o maior entre o físico e o volumétrico.
    const numMed = v => { const n = parseFloat(String(v === null || v === undefined ? '' : v).replace(',', '.')); return isFinite(n) && n > 0 ? n : null; };
    const r3 = n => Math.round(n * 1000) / 1000;
    const volumetrico = o => r3(o[0] * o[1] * o[2] / 6000);
    /** 3 medidas (cm, em qualquer ordem) + peso (kg) → { ordenadas (crescentes), pesoKg, volumetricoKg, consideradoKg } | null. */
    SHC.medidaDe = function (dims, pesoKg) {
        const o = (dims || []).map(numMed), p = numMed(pesoKg);
        if (o.length !== 3 || o.some(x => x === null) || p === null) return null;
        o.sort((a, b) => a - b);
        const volumetricoKg = volumetrico(o);
        return { ordenadas: o, pesoKg: r3(p), volumetricoKg, consideradoKg: Math.max(r3(p), volumetricoKg) };
    };
    /** Peso considerado de uma medida guardada ({ordenadas, pesoKg}). */
    SHC.medidaConsiderada = m => Math.max(m.pesoKg, volumetrico(m.ordenadas));
    const RE_MEDIDA = /(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*cm\s+e\s+(\d+(?:[.,]\d+)?)\s*kg/i;
    // Seção de embalagem (o objeto com data.header; o mesmo id também aparece antes como simples referência de evento, sem data).
    function medidaDaEmbalagem(r, id, filho) {
        const t = primeiroEmLargura(r, o => (o.id === id && o.data && o.data.header ? o : undefined), 40);
        if (!t) return null;
        const m = RE_MEDIDA.exec(String((((t.data.header.collapsedSubtitles || [])[0]) || {}).text || ''));
        if (m) return SHC.medidaDe([m[1], m[2], m[3]], m[4]);
        // Sem o texto: os campos do filho (envio: opção escolhida; sem opção com campos, as medidas de fábrica).
        const c = primeiroEmLargura(t, o => (o.id === filho && o.data ? o.data : undefined), 12);
        if (!c) return null;
        const op = (c.options || []).find(x => x && x.inputType === c.selectedOption);
        const campos = op && Array.isArray(op.attributes) ? op.attributes.map(a => a && a.selectedValue) : c.factoryMeasures;
        const v = k => ((campos || []).find(a => a && a.id === 'SELLER_PACKAGE_' + k) || {}).valueName;
        return SHC.medidaDe([v('WIDTH'), v('HEIGHT'), v('LENGTH')], v('WEIGHT'));
    }
    /**
     * Tela "Alterar anúncio" → { itemId, alt, larg, comp (cm), pesoKg, ordenadas, volumetricoKg, consideradoKg, envio, fabrica } | null.
     * Os campos de cima vêm da "Forma de entrega" (F1; weight em gramas → kg). envio/fabrica = {ordenadas, pesoKg, volumetricoKg, consideradoKg} | null.
     * Sem F1 mas com a embalagem de envio: os de cima vêm do envio (alt/larg/comp null). Nenhuma das duas → null.
     */
    SHC.mlMedidasDoEstado = function (r) {
        if (!r || typeof r !== 'object') return null;
        const sh = primeiroEmLargura(r, o => {
            const d = typeof o.id === 'string' && /^shipping_task_MLB\d+$/.test(o.id) && o.data && o.data.metrics
                && ((o.data.metrics.show || {}).dimensions || (o.data.metrics.additionalInfo || {}).dimensions);
            return d && typeof d === 'object' ? { id: o.id, d } : undefined;
        }, 40);
        const envio = medidaDaEmbalagem(r, 'pyme_package_task', 'pyme_package_container'), fabrica = medidaDaEmbalagem(r, 'pyme_factory_task', 'pyme_factory_container');
        const f1 = sh ? SHC.medidaDe([sh.d.height, sh.d.width, sh.d.length], numMed(sh.d.weight) === null ? null : numMed(sh.d.weight) / 1000) : null;
        const base = f1 || envio;
        if (!base) return null;
        let itemId = sh ? sh.id.replace('shipping_task_', '') : '';
        if (!itemId) {
            const t = primeiroEmLargura(r, o => (o.id === 'pyme_package_task' && o.data && o.data.header ? o : undefined), 40);
            itemId = (/[?&]item_id=(MLB\d+)/.exec(((eventoConfirmar(t) || {}).path) || '') || [])[1] || '';
        }
        return Object.assign({ itemId, alt: f1 ? numMed(sh.d.height) : null, larg: f1 ? numMed(sh.d.width) : null, comp: f1 ? numMed(sh.d.length) : null }, base, { envio, fabrica });
    };
    /**
     * v2.6: categoria do anúncio na MESMA leitura da tela "Alterar anúncio" (confirmado ao vivo em 25/09/2026): brick com
     * data.metrics.path '/category_change' (id 'category_change_task') → data.header.collapsedSubtitles[0].text = "Ferramentas > Ferramentas
     * Manuais > Extração > Extratores para Polia"; o id (MLB274751) em data.metrics.show.categoryId do brick com metrics.path '/universal_code'.
     * → { categoriaId ('' se não veio), caminho:[níveis], familia (1º nível), sub (2º nível | '') } | null (a tela não trouxe o caminho)
     */
    SHC.mlCategoriaDoEstado = function (r) {
        if (!r || typeof r !== 'object') return null;
        const txt = primeiroEmLargura(r, o => {
            const d = o.data;
            if (!d || typeof d !== 'object' || !((d.metrics && d.metrics.path === '/category_change') || o.id === 'category_change_task')) return undefined;
            const s = ((d.header && d.header.collapsedSubtitles) || [])[0], t = typeof s === 'string' ? s : s && s.text;
            return typeof t === 'string' && t.trim() ? t : undefined;
        }, 40);
        const caminho = String(txt || '').replace(/<[^>]*>/g, '').split(/\s*>\s*/).map(x => x.trim()).filter(Boolean);
        if (!caminho.length) return null;
        const id = primeiroEmLargura(r, o => {
            const m = o.data && o.data.metrics, c = m && m.path === '/universal_code' && m.show && m.show.categoryId;
            return c && /^[A-Z]{3}\d+$/.test(String(c)) ? String(c) : undefined;
        }, 40);
        return { categoriaId: id || '', caminho, familia: caminho[0], sub: caminho[1] || '' };
    };
    SHC.MEDIDAS_TOLERANCIA = { cm: 0.5, g: 20 };
    /** Mesma medida? As 3 ordenadas dentro de tol.cm (0,5 cm) e o peso dentro de tol.g (20 g). */
    SHC.medidasIguais = function (a, b, tol) {
        const t = Object.assign({}, SHC.MEDIDAS_TOLERANCIA, tol || {});
        return !!(a && b && Array.isArray(a.ordenadas) && Array.isArray(b.ordenadas)) && a.ordenadas.every((v, k) => Math.abs(v - b.ordenadas[k]) <= t.cm + 1e-9)
            && Math.abs(a.pesoKg - b.pesoKg) * 1000 <= t.g + 1e-6;
    };
    const soMedida = m => (m ? { ordenadas: m.ordenadas.slice(), pesoKg: m.pesoKg } : null);
    /**
     * Junta uma leitura (SHC.mlMedidasDoEstado) no histórico do anúncio (medidas:<conta>.porItem[MLB]) → { entrada, mudanca | null }.
     * A medida que vale é a da embalagem de ENVIO (a que o frete usa); sem ela, a da Forma de entrega. As três ficam em atual.envio/fabrica/entrega.
     * Igual à anterior (SHC.medidasIguais) → só atualiza atual.ts. Diferente → fecha o período anterior no historico (máx. 20) e registra a mudança.
     * Leituras de seções diferentes (a de envio não veio numa delas) comparam só o que as duas têm (a Forma de entrega); sem nada em comum,
     * só atualiza a leitura (sem mudança). Sem a de envio nesta leitura, a de envio anterior continua valendo.
     * entrada = { sku, atual:{ordenadas, pesoKg, fonte:'tela', secao:'envio'|'entrega', de, ts, envio, fabrica, entrega, quem?}, historico:[{ordenadas, pesoKg,
     *   de, ate (leitura que viu a mudança), vistoAte (última leitura ainda igual), fonte, quem?}], alterar?:[ts dos cliques em "Alterar no ML"] }
     * mudanca = { itemId, sku, antes:{ordenadas, pesoKg}, depois:{ordenadas, pesoKg}, em, vistoAte, fonte:'tela' }
     */
    SHC.medidasRegistra = function (ant, m, o) {
        const x = o || {}, agora = x.agora || Date.now(), a0 = ant && ant.atual;
        const atual = Object.assign(soMedida(m.envio || m), { fonte: 'tela', secao: m.envio ? 'envio' : 'entrega', de: agora, ts: agora,
            envio: soMedida(m.envio), fabrica: soMedida(m.fabrica), entrega: m.alt !== null && m.alt !== undefined ? soMedida(m) : null });
        const sku = x.sku || (ant && ant.sku) || '', historico = ((ant && ant.historico) || []).slice();
        const entrada = (at, h) => Object.assign({ sku, atual: at, historico: h }, ant && Array.isArray(ant.alterar) ? { alterar: ant.alterar.slice() } : {});
        if (!a0) return { entrada: entrada(atual, historico), mudanca: null };
        const mesma = !a0.secao || a0.secao === atual.secao;
        const par = mesma ? [a0, atual] : a0.entrega && atual.entrega ? [a0.entrega, atual.entrega] : null;
        const fica = Object.assign({ de: a0.de || a0.ts || agora }, a0.quem ? { quem: a0.quem } : {});
        if (!par || SHC.medidasIguais(par[0], par[1])) {
            if (mesma) Object.assign(atual, soMedida(a0), fica);                       // igual: fica a de antes (não "anda" dentro da tolerância)
            else if (a0.secao === 'envio') Object.assign(atual, soMedida(a0), { secao: 'envio', envio: a0.envio }, fica);   // a de envio não veio: vale a de antes
            else Object.assign(atual, fica);                                           // a de envio apareceu: passa a valer, sem mudança
            return { entrada: entrada(atual, historico), mudanca: null };
        }
        if (!mesma) Object.assign(atual, soMedida(par[1]), { secao: 'entrega' });
        const vistoAte = a0.ts || fica.de;
        historico.push(Object.assign(soMedida(par[0]), { de: fica.de, ate: agora, vistoAte, fonte: a0.fonte || 'tela' }, a0.quem ? { quem: a0.quem } : {}));
        return { entrada: entrada(atual, historico.slice(-20)),
            mudanca: { itemId: x.itemId || '', sku, antes: soMedida(par[0]), depois: soMedida(par[1]), em: agora, vistoAte, fonte: 'tela' } };
    };
    /**
     * Marca do seller no anúncio (entrada de medidas:<conta>.porItem, ou null) → a entrada nova | null (nada a marcar).
     * tipo 'alterar' = clicou em "Alterar no ML" (guarda os 5 últimos cliques); 'fui_eu' = a mudança vista em `em` foi feita pelo seller.
     */
    SHC.medidasMarca = function (ent, tipo, em, agora) {
        const e = JSON.parse(JSON.stringify(ent || {}));
        if (tipo === 'alterar') { e.alterar = (e.alterar || []).concat([agora || Date.now()]).slice(-5); return e; }
        if (tipo !== 'fui_eu') return null;
        const per = (e.historico || []).concat(e.atual ? [e.atual] : []), k = per.findIndex((p, j) => j > 0 && (per[j - 1].ate || p.de) === +em);
        if (k < 0) return null;
        per[k].quem = 'seller';
        return e;
    };
    const kgTxt = n => { let s = r3(n).toFixed(3); if (/0$/.test(s)) s = s.slice(0, -1); return s.replace('.', ','); };
    const cmTxt = n => String(r3(n)).replace('.', ',');
    /** "39×9×7 cm e 1,76 kg" */
    SHC.medidaTxt = m => m.ordenadas.slice().reverse().map(cmTxt).join('×') + ' cm e ' + kgTxt(m.pesoKg) + ' kg';
    const ddmm = ts => { const d = new Date(ts); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0'); };
    /** Quando a medida mudou: "entre 11/09 e 18/09" (última conferência igual e a que viu a mudança) ou "em 18/09". */
    SHC.medidasQuando = mu => (mu.vistoAte && ddmm(mu.vistoAte) !== ddmm(mu.em) ? 'entre ' + ddmm(mu.vistoAte) + ' e ' + ddmm(mu.em) : 'em ' + ddmm(mu.em));
    /**
     * Texto pronto do chamado (sem dado pessoal). A medida certa só entra quando se sabe qual é: a do ERP (corretaDe 'erp') ou a última
     * que o seller confirmou (corretaDe 'seller'). O frete é revisto desde a última conferência igual.
     */
    SHC.medidasChamado = (mu) => 'O anúncio ' + mu.itemId + (mu.sku ? ' (SKU ' + mu.sku + ')' : '') + ' teve as medidas da embalagem alteradas de ' + SHC.medidaTxt(mu.antes)
        + ' para ' + SHC.medidaTxt(mu.depois) + ' ' + SHC.medidasQuando(mu) + '. Não fui eu que alterei. '
        + (mu.correta ? 'As medidas corretas são ' + (mu.corretaDe === 'erp' ? 'as do meu cadastro' : 'as que eu tinha deixado no anúncio') + ' (' + SHC.medidaTxt(mu.correta) + '); peço a correção'
            : 'Peço a conferência das medidas deste anúncio')
        + ' e a revisão do frete cobrado desde ' + ddmm(mu.vistoAte || mu.em) + '.';
    SHC.MEDIDAS_SELLER_MS = 48 * 36e5;   // mudança vista até 48 h depois de um clique em "Alterar no ML" = provavelmente do seller
    /**
     * Mudanças de medida desde `desde` (ms), tiradas do histórico de cada anúncio → [{ itemId, sku, antes, depois, em, vistoAte, fonte,
     * quem:'ml'|'?', correta, corretaDe:'erp'|'seller'|'', chamado }], da mais nova à mais velha. Ficam de fora as que parecem do seller:
     * marcadas "Fui eu", volta a uma medida que o anúncio já teve, igual à do ERP, igual à de todos os outros anúncios do SKU, ou vista
     * até 48 h depois de um clique em "Alterar no ML". quem 'ml' = a medida certa (a do ERP ou a última do seller) era a de antes; '?' = não dá para saber.
     * opc = { erpDe: (sku, itemId) → {ordenadas, pesoKg} | null (medidas do ERP), itemId: só esse anúncio }
     */
    SHC.medidasMudadas = function (porItem, desde, opc) {
        const o = opc || {}, pi = porItem || {}, out = [], d0 = +desde || 0, porSku = {};
        Object.keys(pi).forEach(id => { const e = pi[id], k = e && e.atual && normSku(e.sku); if (k) (porSku[k] = porSku[k] || []).push(id); });
        (o.itemId ? [o.itemId] : Object.keys(pi)).forEach(id => {
            const e = pi[id], per = ((e && e.historico) || []).concat(e && e.atual ? [e.atual] : []);
            if (per.length < 2) return;
            const erp = (o.erpDe && o.erpDe(e.sku || '', id)) || null, cliques = e.alterar || [];
            const outros = (porSku[normSku(e.sku)] || []).filter(j => j !== id).map(j => pi[j].atual);
            let confirmada = null;
            for (let k = 1; k < per.length; k++) {
                const a = per[k - 1], d = per[k], em = a.ate || d.de, vistoAte = a.vistoAte || null;
                const doSeller = d.quem === 'seller' || per.slice(0, k).some(p => SHC.medidasIguais(p, d)) || (erp && SHC.medidasIguais(d, erp))
                    || (outros.length && outros.every(x => SHC.medidasIguais(x, d)))
                    || cliques.some(c => c <= em && c >= (vistoAte || em) - SHC.MEDIDAS_SELLER_MS);
                if (doSeller) { confirmada = soMedida(d); continue; }
                if (!(em >= d0)) continue;
                const ref = erp || confirmada;
                const mu = { itemId: id, sku: (e && e.sku) || '', antes: soMedida(a), depois: soMedida(d), em, vistoAte, fonte: d.fonte || 'tela',
                    quem: ref && SHC.medidasIguais(a, ref) ? 'ml' : '?', correta: ref ? soMedida(ref) : null, corretaDe: erp ? 'erp' : ref ? 'seller' : '' };
                out.push(Object.assign(mu, { chamado: SHC.medidasChamado(mu) }));
            }
        });
        return out.sort((a, b) => b.em - a.em || (a.itemId < b.itemId ? -1 : 1));
    };
    const statusTxt = i => { let s = i && i.status; if (s && typeof s === 'object') s = s.id || s.label || ''; return String(s || '').trim(); };
    const normSku = s => (SHC.normalizaSku ? SHC.normalizaSku(s) : String(s || '').trim().toUpperCase());
    /**
     * SKUs com 2+ anúncios (ativos; opc.incluirPausados junta os pausados) e medidas lidas → [{ sku, anuncios:[{itemId, ordenadas, pesoKg, consideradoKg,
     * vendas, foge}], referencia:{itemId, ordenadas, pesoKg, consideradoKg, emQuantos, criterio:'mais_comum'|'mais_vendas'|'empate'}, maiorDiferencaKg,
     * diverge, resumo }], da maior diferença de peso considerado (o que pesa no frete) para a menor.
     * Referência = a medida que mais se repete; empate entre medidas diferentes → a do anúncio com mais vendas (opc.vendas = {MLB: unidades}).
     * Padrão: só os SKUs com medida diferente; opc.todos = todos os SKUs com 2+ anúncios lidos.
     */
    SHC.medidasDivergentes = function (porItem, anuncios, opc) {
        const o = opc || {}, tol = o.tolerancia, vendas = o.vendas || {}, grupos = {}, vistos = new Set();
        const entra = i => SHC.anuncioAtivo(i) || (!!o.incluirPausados && /^(paused|pausado|inativo|inactive)$/i.test(statusTxt(i)));
        (anuncios || []).forEach(i => {
            const id = i && i.itemId, e = id && porItem && porItem[id], a = e && e.atual;
            if (!a || !Array.isArray(a.ordenadas) || vistos.has(id) || !entra(i)) return;
            const bruto = String(i.sku || e.sku || '').trim(), k = normSku(bruto);
            if (!k) return;
            vistos.add(id);
            (grupos[k] = grupos[k] || { sku: bruto, anuncios: [] }).anuncios.push({ itemId: id, ordenadas: a.ordenadas.slice(), pesoKg: a.pesoKg,
                consideradoKg: r3(SHC.medidaConsiderada(a)), vendas: +vendas[id] || 0 });
        });
        const out = [];
        Object.keys(grupos).forEach(k => {
            const g = grupos[k], l = g.anuncios;
            if (l.length < 2) return;
            const conta = c => l.filter(x => SHC.medidasIguais(x, c, tol)).length;
            const cont = l.map(conta), max = Math.max.apply(null, cont);
            const empatados = l.filter((x, j) => cont[j] === max);
            const ref = empatados.slice().sort((a, b) => b.vendas - a.vendas)[0];
            const reais = empatados.filter(x => !SHC.medidasIguais(x, ref, tol));   // empate de verdade = medidas DIFERENTES com a mesma contagem
            const criterio = !reais.length ? 'mais_comum' : reais.some(x => x.vendas === ref.vendas) ? 'empate' : 'mais_vendas';
            l.forEach(x => { x.foge = !SHC.medidasIguais(x, ref, tol); });
            const cs = l.map(x => x.consideradoKg), diverge = l.some(x => x.foge);
            const referencia = { itemId: ref.itemId, ordenadas: ref.ordenadas.slice(), pesoKg: ref.pesoKg, consideradoKg: ref.consideradoKg, emQuantos: max, criterio };
            const txt = SHC.medidaTxt(ref);
            const resumo = !diverge ? 'Os ' + l.length + ' anúncios têm a mesma medida: ' + txt + '.'
                : criterio === 'mais_comum' ? 'A medida mais comum (em ' + max + ' de ' + l.length + ' anúncios) é ' + txt + '.'
                : criterio === 'mais_vendas' ? 'Nenhuma medida se repete mais que as outras: vale a do anúncio que mais vende (' + ref.itemId + '), ' + txt + '.'
                : 'Nenhuma medida se repete mais que as outras e as vendas empatam. Confira qual é a certa; usei a do ' + ref.itemId + ', ' + txt + '.';
            if (diverge || o.todos) out.push({ sku: g.sku, anuncios: l, referencia, maiorDiferencaKg: r3(Math.max.apply(null, cs) - Math.min.apply(null, cs)), diverge, resumo });
        });
        return out.sort((a, b) => b.maiorDiferencaKg - a.maiorDiferencaKg || b.anuncios.length - a.anuncios.length || (a.sku < b.sku ? -1 : 1));
    };

    // ── v2.6: faturamento por FAMÍLIA (1º nível da categoria do ML), curva ABC, "por que caiu?", sazonalidade × Full e meta do mês ──
    // vbAnuncio:<conta> = { ts, meses:{'AAAA-MM': {porAnuncio:{MLB:{bruto, unidades, vendas, visitas, sku}}, paginas, linhas, completo, lidoEm, lidoTs (hora da leitura)}},
    //                      itens:{MLB:{sku, titulo}} }   (fundo: etapa 'vendasAnuncio')
    // cat:<conta> = { ts, porItem:{MLB:{familia, sub, categoriaId, ts}} }   (fundo: a MESMA leitura da tela "Alterar anúncio" das fotos/medidas)
    SHC.FAMILIA_PALETA = ['#4E79A7', '#F28E2B', '#59A14F', '#E15759', '#76B7B2', '#EDC948', '#B07AA1', '#FF9DA7'];
    SHC.FAMILIA_OUTRAS = 'Outras';
    SHC.FAMILIA_SEM = 'Sem categoria ainda';
    SHC.FAMILIA_COR_OUTRAS = '#9AA0A6';
    SHC.FAMILIA_COR_SEM = '#C7CBD1';
    const MES_NOME_FAM = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    const nomeMesFam = m => MES_NOME_FAM[+String(m).slice(5, 7) - 1] || String(m);
    const capF = t => t.charAt(0).toUpperCase() + t.slice(1);
    const diasNoMesFam = m => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
    const r1f = v => Math.round(v * 10) / 10;
    const numF = v => (typeof v === 'number' && isFinite(v) ? v : null);
    const pctTxt = v => String(Math.abs(r1f(v))).replace('.', ',') + '%';
    const unTxt = n => SHC.qtd(Math.round(n), 'unidade', 'unidades');
    const mesLidoVA = (M, m) => !!(M[m] && M[m].completo === true && M[m].porAnuncio && typeof M[m].porAnuncio === 'object');
    // Variação de `agora` contra `antes` × fator (fator < 1 = mês atual ainda correndo: compara pelo ritmo por dia).
    const varFam = (agora, antes, fator) => (typeof agora === 'number' && typeof antes === 'number' && antes * fator > 0 ? r1f((agora - antes * fator) / (antes * fator) * 100) : null);
    // Quanto do mês a leitura cobre. O ML fecha o dia no horário de Brasília (from_current = AAAA-MM-01T03:00Z).
    // lidoTs (hora da leitura) → exato; só lidoEm (leitura antiga, sem hora) → só os dias COMPLETOS antes dele; sem nenhum → mês inteiro.
    // → { ms, dur, parcial, ate (último dia do mês que a leitura pegou) }
    const iniMesTs = m => Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1, 1, 3);
    const coberturaMes = (x, m) => {
        const ini = iniMesTs(m), dur = iniMesTs(mesMenos(m, -1)) - ini, le = String((x && x.lidoEm) || '');
        let ms = dur, ate = diasNoMesFam(m);
        if (numF(x && x.lidoTs) !== null) { ms = x.lidoTs - ini; ate = new Date(x.lidoTs - 3 * 36e5).getUTCDate(); }
        else if (/^\d{4}-\d{2}-\d{2}/.test(le) && le.slice(0, 7) <= m) { ms = le.slice(0, 7) < m ? 0 : (+le.slice(8, 10) - 1) * 864e5; ate = +le.slice(8, 10) - 1; }
        ms = Math.max(0, Math.min(dur, ms));
        return { ms, dur, parcial: ms < dur, ate: ms < dur ? ate : diasNoMesFam(m) };
    };
    // Fator do ritmo de `a` contra `b` (coberturas): os dois inteiros → 1; algum pela metade → tempo lido de a ÷ tempo lido de b;
    // menos de 1 dia lido em algum → 0 (não compara: poucas horas enganam).
    const fatorRitmo = (a, b) => (!a.parcial && !b.parcial ? 1 : a.ms < 864e5 || b.ms < 864e5 ? 0 : a.ms / b.ms);

    /**
     * SHC.familias(vbAnuncio, cat, retrato, custos, mes, opc?) → [{ familia, cor, membros (só em "Outras": as famílias juntadas), bruto, pct, brutoAnt,
     *   variacaoPct (vs mês anterior), variacaoAnoPct (vs o mesmo mês do ano anterior, se lido), lucro | null, lucroParcial, lucroCobertoPct,
     *   serie12:[13 × {mes, bruto | null, parcial?, ate?}] (do mais velho ao `mes`; mês não lido = null, sem ponto; lido pela metade = parcial + ate),
     *   picoMes | null (único e 10% acima da média; nunca em "Outras"/"Sem categoria ainda"), picoMotivo (o porquê de não ter), subs:[{sub, bruto}], skus:[…] }]
     * No próprio array: mes, lido, motivo ('' ou o porquê de não ter dado), total, totalAnt, comparacao ('mes' | 'ritmo'), dias, diasAnt, fator,
     *   mesesLidos, semCategoria (anúncios com venda no mês ainda sem categoria lida), mesParcial, antParcial, mesAtual, motivoComp ('' ou por que não há setas),
     *   cores (mapa família → cor, com as novas), coresMudou (a tela grava cores:<conta>).
     * opc = { cfg (imposto_pct), hoje, cores (cores:<conta>) }. custos = {chave: dados} (c|sku|…, c|ml|…) como em SHC.custoDeAnuncio; retrato = ml:anuncios:<conta>.
     * Cor fixa (opc.cores): as 8 famílias que mais faturaram nos 13 meses lidos aparecem com a cor delas (família nova ganha a 1ª livre); da 9ª em diante viram "Outras" (cinza);
     *   anúncio sem categoria lida → "Sem categoria ainda". Ordem: faturamento do mês (maior 1º), depois "Outras" e "Sem categoria ainda".
     * Mês lido pela metade (o atual, ou um fechado lido antes de acabar — lidoTs/lidoEm): compara pelo RITMO (comparacao 'ritmo';
     *   fator = tempo que a leitura cobre ÷ tempo do outro mês). Menos de 1 dia lido → sem setas (motivoComp).
     * skus: [{ sku, titulo, itemIds, bruto, brutoAnt, variacaoPct, variacaoR$, unidades, unidadesAnt, precoMedio, precoMedioAnt, visitas, visitasAnt,
     *   lucro | null, semCusto, fator }] pela maior QUEDA em R$ (sem o mês anterior lido: no fim, pelo faturamento).
     * Lucro ESTIMADO: faturamento − tarifa (a % de hoje no retrato) − (frete ou, se o comprador paga o frete, a taxa operacional) × unidades
     *   − (custo + outros) × unidades − imposto.
     *   SKU sem custo ou fora do retrato → lucro null e a família fica com lucroParcial (lucroCobertoPct = parte do faturamento com lucro).
     */
    SHC.familias = function (vbAnuncio, cat, retrato, custos, mes, opc) {
        const o = opc || {}, cfg = Object.assign({}, SHC.PADRAO, o.cfg || {}), hoje = o.hoje || SHC.hoje();
        const out = [];
        Object.assign(out, { mes, lido: false, motivo: '', total: null, totalAnt: null, comparacao: 'mes', dias: null, diasAnt: null, fator: 1, mesesLidos: [], semCategoria: 0,
            mesParcial: false, antParcial: false, mesAtual: false, motivoComp: '', cores: Object.assign({}, o.cores || {}), coresMudou: false });
        if (!/^\d{4}-\d{2}$/.test(String(mes || ''))) { out.motivo = 'Escolha um mês para ver.'; return out; }
        const M = (vbAnuncio && vbAnuncio.meses) || {}, pc = (cat && cat.porItem) || {}, info = (vbAnuncio && vbAnuncio.itens) || {}, cs = custos || {};
        const meses = []; for (let k = 12; k >= 0; k--) meses.push(mesMenos(mes, k));
        const lido = m => mesLidoVA(M, m), ant = mesMenos(mes, 1), ano = mesMenos(mes, 12);
        out.lido = lido(mes); out.mesesLidos = meses.filter(lido);
        if (!out.lido) {
            out.motivo = (M[mes] && M[mes].completo === false ? 'As vendas por anúncio de ' + nomeMesFam(mes) + ' foram lidas só em parte' : 'Ainda não li as vendas por anúncio de ' + nomeMesFam(mes))
                + ' — sincronize para ler.';
            return out;
        }
        // Mês lido pela metade (o atual, ou um que fechou mas foi lido antes de acabar): compara pelo ritmo, pelo TEMPO que a leitura cobre.
        const cobM = m => coberturaMes(M[m], m), cm = cobM(mes), ca = cobM(ant);
        const fator = lido(ant) ? fatorRitmo(cm, ca) : 1, fatorAno = lido(ano) ? fatorRitmo(cm, cobM(ano)) : 1;
        const compara = lido(ant) && fator > 0;
        if (cm.parcial || (lido(ant) && ca.parcial)) {
            Object.assign(out, { comparacao: 'ritmo', dias: cm.ate, diasAnt: ca.parcial ? ca.ate : diasNoMesFam(ant), fator: Math.round(fator * 1000) / 1000,
                antParcial: lido(ant) && ca.parcial, mesParcial: cm.parcial, mesAtual: mes === hoje.slice(0, 7) });
            if (lido(ant) && !compara) out.motivoComp = cm.parcial && cm.ms < 864e5 ? capF(nomeMesFam(mes)) + ' acabou de começar: as setas aparecem amanhã.'
                : capF(nomeMesFam(ant)) + ' foi lido só no começo do mês: as setas aparecem quando ele for lido de novo.';
        }
        const ret = {};
        ((retrato && retrato.itens) || []).forEach(i => { if (i && i.itemId && !ret[i.itemId]) ret[i.itemId] = i; });
        const famDe = id => (pc[id] && pc[id].familia) || SHC.FAMILIA_SEM;
        const linha = (m, id) => (lido(m) ? M[m].porAnuncio[id] || null : null);
        const porFam = {};
        meses.forEach(m => {
            if (!lido(m)) return;
            const pa = M[m].porAnuncio;
            Object.keys(pa).forEach(id => { const f = famDe(id), x = porFam[f] || (porFam[f] = {}); x[m] = (x[m] || 0) + n0(pa[id] && pa[id].bruto); });
        });
        const noMes = (fams, m) => (lido(m) ? SHC.r2(fams.reduce((s, f) => s + ((porFam[f] || {})[m] || 0), 0)) : null);
        const todas = Object.keys(porFam);
        out.total = noMes(todas, mes); out.totalAnt = compara ? noMes(todas, ant) : null;
        out.semCategoria = Object.keys(M[mes].porAnuncio).filter(id => n0((M[mes].porAnuncio[id] || {}).bruto) > 0 && !(pc[id] && pc[id].familia)).length;
        if (!(out.total > 0)) { out.motivo = 'Nenhuma venda em ' + nomeMesFam(mes) + ' nas vendas por anúncio do Mercado Livre.'; return out; }

        const soma = f => meses.reduce((s, m) => s + ((porFam[f] || {})[m] || 0), 0);
        const nomes = todas.filter(f => f !== SHC.FAMILIA_SEM && soma(f) > 0).sort((a, b) => soma(b) - soma(a) || (a < b ? -1 : 1));
        // Cor FIXA por família (cores:<conta>, gravada pela tela): quem já tem cor fica com ela; família nova ganha a 1ª cor livre, pela ordem
        // de faturamento. As 8 cores já com dono → pega a de uma família que saiu das 8 de agora.
        // ponytail: só 8 cores; com mais de 8 famílias revezando no topo, a que volta pode ganhar outra cor.
        const cores = out.cores, top = nomes.slice(0, 8), okCor = c => SHC.FAMILIA_PALETA.indexOf(c) >= 0;
        top.forEach(f => {
            if (okCor(cores[f])) return;
            const usadas = new Set(Object.keys(cores).map(x => cores[x]));
            let c = SHC.FAMILIA_PALETA.find(x => !usadas.has(x));
            if (!c) { const dono = Object.keys(cores).find(x => top.indexOf(x) < 0 && okCor(cores[x])); c = cores[dono]; delete cores[dono]; }
            cores[f] = c; out.coresMudou = true;
        });
        const grupos = top.map(f => ({ familia: f, cor: cores[f], membros: [f] }));
        if (nomes.length > 8) grupos.push({ familia: SHC.FAMILIA_OUTRAS, cor: SHC.FAMILIA_COR_OUTRAS, membros: nomes.slice(8) });
        if (soma(SHC.FAMILIA_SEM) > 0) grupos.push({ familia: SHC.FAMILIA_SEM, cor: SHC.FAMILIA_COR_SEM, membros: [SHC.FAMILIA_SEM] });

        const skuDe = id => SHC.normalizaSku(((linha(mes, id) || linha(ant, id) || {}).sku) || (info[id] || {}).sku || (ret[id] || {}).sku || '');
        const imp = (SHC.num(cfg.imposto_pct) || 0) / 100;
        // Lucro de 1 anúncio no mês (x = linha do mês) → R$ | null (sem retrato, sem unidades ou sem custo). Sem venda → 0.
        const lucroItem = (id, x) => {
            const b = n0(x && x.bruto);
            if (!(b > 0)) return 0;
            const r = ret[id], u = numF(x.unidades);
            if (!r || !(r.preco > 0) || u === null) return null;
            const c = SHC.custoDeAnuncio(cs, { sku: skuDe(id), itemId: id, familia: r.familia });
            if (!c) return null;
            const custo = SHC.num(c.dados.custo), outros = SHC.num(c.dados.outros) || 0, tarifaPct = (numF(r.tarifa) || 0) / r.preco, frete = numF(r.frete) || 0;
            // "Envio por conta do comprador": o ML cobra a taxa operacional por venda (a mesma conta da etiqueta, SHC.sobraAnuncio).
            const taxaOp = r.freteComprador && SHC.num(r.taxaOperacional) > 0 ? SHC.num(r.taxaOperacional) : 0;
            return b - b * tarifaPct - u * (frete + taxaOp) - u * (custo + outros) - b * imp;
        };
        const antLido = compara;
        grupos.forEach(g => {
            const mb = new Set(g.membros), ids = new Set(), porSku = {}, subs = {};
            [mes, ant].forEach(m => { if (lido(m)) Object.keys(M[m].porAnuncio).forEach(id => { if (mb.has(famDe(id))) ids.add(id); }); });
            ids.forEach(id => {
                const sk = skuDe(id), k = sk || id;
                const s = porSku[k] || (porSku[k] = { sku: sk, titulo: '', itemIds: [], bruto: 0, brutoAnt: antLido ? 0 : null, unidades: 0, unidadesAnt: antLido ? 0 : null,
                    visitas: 0, visitasAnt: antLido ? 0 : null, lucro: 0, semCusto: false });
                s.itemIds.push(id);
                if (!s.titulo) s.titulo = String((info[id] || {}).titulo || (ret[id] || {}).titulo || '').slice(0, 120);
                const x = linha(mes, id), y = linha(ant, id);
                s.bruto += n0(x && x.bruto); s.unidades += n0(x && x.unidades); s.visitas += n0(x && x.visitas);
                if (antLido) { s.brutoAnt += n0(y && y.bruto); s.unidadesAnt += n0(y && y.unidades); s.visitasAnt += n0(y && y.visitas); }
                const l = lucroItem(id, x);
                if (l === null) s.semCusto = true; else s.lucro += l;
                if (n0(x && x.bruto) > 0) { const sb = (pc[id] && pc[id].sub) || ''; subs[sb] = (subs[sb] || 0) + n0(x.bruto); }
            });
            const skus = Object.keys(porSku).map(k => {
                const s = porSku[k], bruto = SHC.r2(s.bruto), brutoAnt = s.brutoAnt === null ? null : SHC.r2(s.brutoAnt);
                return { sku: s.sku, titulo: s.titulo, itemIds: s.itemIds, bruto, brutoAnt, variacaoPct: varFam(bruto, brutoAnt, fator),
                    'variacaoR$': brutoAnt === null ? null : SHC.r2(bruto - brutoAnt * fator), unidades: s.unidades, unidadesAnt: s.unidadesAnt,
                    precoMedio: s.unidades > 0 ? SHC.r2(bruto / s.unidades) : null, precoMedioAnt: s.unidadesAnt > 0 ? SHC.r2(brutoAnt / s.unidadesAnt) : null,
                    visitas: s.visitas, visitasAnt: s.visitasAnt, lucro: s.semCusto ? null : SHC.r2(s.lucro), semCusto: s.semCusto, fator };
            }).filter(s => s.bruto > 0 || s.brutoAnt > 0).sort((a, b) => {
                const va = a['variacaoR$'], vb = b['variacaoR$'];
                if (va === null || vb === null) return (va === null) - (vb === null) || b.bruto - a.bruto;
                return va - vb || b.bruto - a.bruto;
            });
            const serie12 = meses.map(m => {
                const p = { mes: m, bruto: noMes(g.membros, m) }, c = cobM(m);
                if (p.bruto !== null && c.parcial) Object.assign(p, { parcial: true, ate: c.ate });   // lido pela metade: não entra no mês mais forte
                return p;
            });
            const bruto = noMes(g.membros, mes), brutoAnt = compara ? noMes(g.membros, ant) : null, brutoAno = noMes(g.membros, ano);
            const comValor = skus.filter(s => s.bruto > 0), cob = comValor.filter(s => s.lucro !== null);
            // Mês mais forte: só entre meses inteiros, só se for ÚNICO e ficar 10% acima da média. "Sem categoria ainda" e "Outras" mudam
            // de tamanho conforme as categorias são lidas: não têm mês mais forte.
            const pontos = serie12.filter(p => p.bruto !== null && !p.parcial), maxB = pontos.length ? Math.max(...pontos.map(p => p.bruto)) : 0;
            const mediaB = pontos.length ? pontos.reduce((s, p) => s + p.bruto, 0) / pontos.length : 0, grupoMisto = g.familia === SHC.FAMILIA_SEM || g.familia === SHC.FAMILIA_OUTRAS;
            const pico = !grupoMisto && pontos.length >= 2 && maxB > 0 && maxB > mediaB * 1.1 && pontos.filter(p => p.bruto === maxB).length === 1 ? pontos.find(p => p.bruto === maxB) : null;
            const picoMotivo = pico ? '' : grupoMisto ? (g.familia === SHC.FAMILIA_SEM ? 'Estes anúncios ainda não têm a categoria lida: o histórico deles não mostra sazonalidade.' : '"Outras" junta famílias diferentes: o histórico não mostra sazonalidade.')
                : pontos.length < 2 ? 'Ainda não tenho meses suficientes de ' + g.familia + ' para mostrar o mês mais forte.' : 'Os meses de ' + g.familia + ' ficaram parecidos: não há um mês claramente mais forte.';
            const item = { familia: g.familia, cor: g.cor, bruto, pct: r1f(bruto / out.total * 100), brutoAnt, variacaoPct: varFam(bruto, brutoAnt, fator),
                variacaoAnoPct: varFam(bruto, brutoAno, fatorAno), lucro: cob.length ? SHC.r2(cob.reduce((s, x) => s + x.lucro, 0)) : null,
                lucroParcial: cob.length < comValor.length, lucroCobertoPct: bruto > 0 ? r1f(cob.reduce((s, x) => s + x.bruto, 0) / bruto * 100) : null,
                serie12, picoMes: pico ? pico.mes : null, picoMotivo,
                subs: Object.keys(subs).map(sb => ({ sub: sb, bruto: SHC.r2(subs[sb]) })).sort((a, b) => b.bruto - a.bruto), skus };
            if (g.familia === SHC.FAMILIA_OUTRAS) item.membros = g.membros.slice();
            out.push(item);
        });
        const fim = f => (f === SHC.FAMILIA_SEM ? 2 : f === SHC.FAMILIA_OUTRAS ? 1 : 0);
        out.sort((a, b) => fim(a.familia) - fim(b.familia) || b.bruto - a.bruto || (a.familia < b.familia ? -1 : 1));
        return out;
    };

    /**
     * Curva ABC → cópia dos SKUs ordenada pelo critério ('lucro' | 'bruto'), cada um com abc e acumPct (% acumulado até ele).
     * A = os que juntos fazem os primeiros 80%; B = até 95%; C = o resto. Lucro ≤ 0 → 'C' (não contribui). Lucro null (sem custo) → abc null, no fim.
     */
    SHC.curvaABC = function (skus, criterio) {
        const k = criterio === 'lucro' ? 'lucro' : 'bruto', val = s => numF(s && s[k]);
        const lista = (skus || []).filter(Boolean), pos = lista.filter(s => val(s) > 0).sort((a, b) => val(b) - val(a));
        const tot = pos.reduce((s, x) => s + val(x), 0);
        let acum = 0;
        const out = pos.map(s => { const antes = acum / tot * 100; acum += val(s); return Object.assign({}, s, { abc: antes < 80 ? 'A' : antes < 95 ? 'B' : 'C', acumPct: r1f(acum / tot * 100) }); });
        return out.concat(lista.filter(s => val(s) !== null && !(val(s) > 0)).sort((a, b) => val(b) - val(a)).map(s => Object.assign({}, s, { abc: 'C', acumPct: null })),
            lista.filter(s => val(s) === null).map(s => Object.assign({}, s, { abc: null, acumPct: null })));
    };

    const STATUS_ANUNCIO_TXT = { paused: 'pausado', closed: 'finalizado', inactive: 'inativo', under_review: 'em revisão', payment_required: 'aguardando pagamento' };
    /**
     * "Por que caiu?" de UM SKU (um item de SHC.familias(...)[i].skus) → [{ tipo, texto }] em pt-BR, só com o que os dados mostram.
     * dados = { itens (retrato: ml:anuncios.itens), visitas (visitas:<conta>.porItem), comp (comp:<conta>), fretes ({MLB: fh|ml|MLB}),
     *           full (ml:full:<conta>), ads (ads:<conta>), cfg, hoje }. Tudo opcional: o que não vier não entra.
     * tipos: vendeu_menos, mais_barato, preco_subiu, pausado, visitas, catalogo, frete, estoque, ads; nada encontrado → [{tipo:'sem_causa'}].
     */
    SHC.porQueCaiu = function (sku, dados) {
        const d = dados || {}, s = sku || {}, hoje = d.hoje || SHC.hoje(), cfg = Object.assign({}, SHC.PADRAO, d.cfg || {}), causas = [];
        const ids = (s.itemIds || []).filter(Boolean), f = s.fator > 0 ? s.fator : 1, R = SHC.moeda, parcial = f < 0.999;
        const itens = Array.isArray(d.itens) ? d.itens : ((d.itens && d.itens.itens) || []);
        const ret = ids.map(id => itens.find(i => i && i.itemId === id)).filter(Boolean);
        const add = (tipo, texto) => { if (!causas.some(c => c.texto === texto)) causas.push({ tipo, texto }); };
        // Vendeu menos (unidades) × vendeu mais barato (preço médio)
        if (numF(s.unidadesAnt) > 0 && numF(s.unidades) !== null && s.unidades < s.unidadesAnt * f * 0.95)
            add('vendeu_menos', 'Vendeu menos: ' + unTxt(s.unidades) + (parcial ? ' até agora; no ritmo do mês anterior seriam ' + unTxt(s.unidadesAnt * f) : ' contra ' + unTxt(s.unidadesAnt) + ' no mês anterior') + '.');
        if (numF(s.precoMedio) > 0 && numF(s.precoMedioAnt) > 0) {
            if (s.precoMedio < s.precoMedioAnt * 0.97) add('mais_barato', 'Vendeu mais barato: preço médio de ' + R(s.precoMedio) + ' contra ' + R(s.precoMedioAnt) + ' no mês anterior.');
            else if (s.precoMedio > s.precoMedioAnt * 1.03) add('preco_subiu', 'O preço médio subiu de ' + R(s.precoMedioAnt) + ' para ' + R(s.precoMedio) + '.');
        }
        ret.forEach(r => {
            if (numF(r.preco) > 0 && numF(s.precoMedioAnt) > 0 && r.preco > s.precoMedioAnt * 1.03 && !causas.some(c => c.tipo === 'preco_subiu'))
                add('preco_subiu', 'O preço de hoje do ' + r.itemId + ' (' + R(r.preco) + ') está acima do preço médio do mês anterior (' + R(s.precoMedioAnt) + ').');
            let st = r.status; if (st && typeof st === 'object') st = st.id || st.label || '';
            st = String(st || '').trim();
            if (st && !SHC.anuncioAtivo(r)) add('pausado', 'O anúncio ' + r.itemId + ' não está ativo (' + (STATUS_ANUNCIO_TXT[st.toLowerCase()] || st.toLowerCase()) + ').');
        });
        // Visitas: radar da semana (visitas:<conta>) e, sem ele, as do mês (vendas por anúncio)
        const pv = d.visitas || {};
        ids.forEach(id => {
            const v = pv[id], rv = v ? SHC.radarVisitas(v.dias, hoje, cfg.radar_queda_pct) : null;
            if (rv && rv.classe === 'caindo') add('visitas', 'As visitas do ' + id + ' caíram ' + pctTxt(rv.variacaoPct) + ' na última semana (' + rv.ult7 + ' contra ' + rv.ant7 + ').');
        });
        if (!causas.some(c => c.tipo === 'visitas') && numF(s.visitasAnt) > 0 && numF(s.visitas) !== null && s.visitas < s.visitasAnt * f * 0.85)
            add('visitas', 'Recebeu menos visitas: ' + s.visitas + (parcial ? ' até agora; no ritmo do mês anterior seriam ' + Math.round(s.visitasAnt * f) : ' contra ' + s.visitasAnt + ' no mês anterior') + '.');
        // Catálogo: histórico da competição (comp:<conta>); sem histórico, o retrato de hoje
        const comp = d.comp || {};
        ids.forEach(id => {
            const c = SHC.compResumo ? SHC.compResumo(comp[id], hoje) : null, r = ret.find(x => x.itemId === id);
            const estado = c ? c.estado : r ? String(r.competicao || '') : '', motivo = c ? c.motivo : r ? String(r.competicaoMotivo || '') : '';
            if (!/^(perdendo|restrito)$/.test(estado)) return;
            add('catalogo', (estado === 'restrito' ? 'Ficou fora da disputa do catálogo' : 'Está perdendo o catálogo') + (motivo === 'preco' ? ' por preço' : motivo === 'entrega' ? ' pela forma de entrega' : '')
                + (c && c.dias > 0 ? (c.peloMenos ? ' há pelo menos ' : ' há ') + SHC.qtd(c.dias, 'dia', 'dias') : '') + ' (' + id + ').');
        });
        // Frete que o seller paga (histórico do retrato fh|ml): hoje × o de ~30 dias atrás
        const fr = d.fretes || {};
        ids.forEach(id => {
            const h = fr[id] || {}, ks = Object.keys(h).filter(k => k <= hoje && numF(h[k]) !== null).sort();
            if (ks.length < 2) return;
            const kAnt = ks.filter(k => k <= diaMenosISO(hoje, 30)).pop() || ks[0], agora = h[ks[ks.length - 1]], antes = h[kAnt];
            if (antes > 0 && agora > antes * 1.05 && agora - antes >= 1) add('frete', 'O frete que você paga no ' + id + ' subiu de ' + R(antes) + ' para ' + R(agora) + '.');
        });
        // Estoque: Full zerado ou anúncio sem estoque
        const prods = ((d.full && d.full.produtos) || []).filter(p => p && ((s.sku && SHC.normalizaSku(p.sku) === s.sku)
            || (p.itemIds && p.itemIds.length ? p.itemIds : [p.itemId]).some(x => ids.indexOf(x) >= 0)));
        if (prods.some(p => unDe(p.aptas) !== null && unDe(p.aptas) <= 0)) add('estoque', 'Ficou sem estoque no Full' + (s.sku ? ' (' + s.sku + ')' : '') + '.');
        else ret.forEach(r => { const e = /sem estoque/i.test(String(r.estoque || '')) ? 0 : inteiro(r.estoque); if (e === 0) add('estoque', 'O anúncio ' + r.itemId + ' está sem estoque.'); });
        // Mercado Ads: anúncio pausado, campanha pausada ou sem verba (impressões perdidas por orçamento)
        const ads = d.ads || {}, camp = {};
        (ads.campanhas || []).forEach(c => { if (c && c.id) camp[c.id] = c; });
        (ads.anuncios || []).filter(a => a && ids.indexOf(a.itemId) >= 0).forEach(a => {
            if (/^(P|paused)$/i.test(String(a.status || ''))) add('ads', 'O ' + a.itemId + ' está pausado no Mercado Ads.');
            const c = camp[a.campanhaId], nome = c && c.nome ? ' "' + c.nome + '"' : '';
            if (c && /^(P|D|paused)$/i.test(String(c.status || ''))) add('ads', 'A campanha' + nome + ' do Mercado Ads está pausada.');
            const po = c && c.share ? numF(c.share.perdidasOrcamento) : null;
            if (po >= 20) add('ads', 'A campanha' + nome + ' perdeu ' + pctTxt(po) + ' das impressões por falta de verba.');
        });
        if (causas.length) return causas;
        // Nada encontrado: diz só o que foi conferido de verdade e o que ainda não dá para conferir (nunca "sem mudança" no que não leu).
        const conferi = [], falta = [], marca = (tem, nome) => (tem ? conferi : falta).push(nome);
        marca(numF(s.unidadesAnt) > 0 && numF(s.unidades) !== null, 'unidades vendidas');
        marca(numF(s.precoMedio) > 0 && numF(s.precoMedioAnt) > 0, 'preço');
        marca(ids.some(id => pv[id] && pv[id].dias) || (numF(s.visitasAnt) > 0 && numF(s.visitas) !== null), 'visitas');
        marca(ret.length > 0 || ids.some(id => comp[id]), 'catálogo');
        marca(ids.some(id => Object.keys(fr[id] || {}).length >= 2), 'frete');
        marca(ret.length > 0 || prods.length > 0, 'estoque');
        if (!(d.ads && d.ads.temAds === false)) marca(!!(d.ads && Array.isArray(d.ads.anuncios)), 'Mercado Ads');   // conta sem Ads: não entra
        const e = l => (l.length > 1 ? l.slice(0, -1).join(', ') + ' e ' + l[l.length - 1] : l[0]);
        return [{ tipo: 'sem_causa', texto: (conferi.length ? 'Os dados que o Copiloto tem não mostram um motivo claro. Conferi ' + e(conferi) + ': sem mudança.' : 'O Copiloto ainda não tem dados para explicar a queda.')
            + (falta.length ? ' Ainda não tenho como conferir ' + e(falta) + '.' : '') }];
    };

    /**
     * Sazonalidade × Full de UMA família: o próximo mês depois do último da série, no ano passado, subiu quanto sobre o mês de antes?
     * serie12 = SHC.familias(...)[i].serie12; full = ml:full:<conta>; opc = { hoje, minPct (10), diasAntes (7: prazo para a remessa chegar) }.
     * → { aplica:true, mes, subidaPct, texto, envios:[{sku, titulo, un, aptas, aCaminho, previsao}], ate ('AAAA-MM-DD' | null = o quanto antes) }
     *   | { aplica:false, motivo }   (sem o mês do ano passado, subida pequena, ou nenhum SKU da família no Full)
     * Previsão por SKU = vendas dos últimos 30 dias no Full × (1 + subida); enviar = previsão − (aptas + a caminho), só quando falta.
     */
    SHC.sazonalFull = function (familia, serie12, full, opc) {
        const o = opc || {}, hoje = o.hoje || SHC.hoje(), minPct = numF(o.minPct) !== null ? o.minPct : 10, diasAntes = numF(o.diasAntes) !== null ? o.diasAntes : 7;
        const s = (serie12 || []).filter(p => p && /^\d{4}-\d{2}$/.test(p.mes)), ult = s[s.length - 1];
        if (!ult) return { aplica: false, motivo: 'Ainda não tenho o histórico desta família.' };
        const alvo = mesMenos(ult.mes, -1), base = s.find(p => p.mes === mesMenos(ult.mes, 12)), prox = s.find(p => p.mes === mesMenos(alvo, 12));
        if (!base || !prox || base.bruto === null || prox.bruto === null || base.parcial || prox.parcial) return { aplica: false, motivo: 'Ainda não tenho ' + nomeMesFam(alvo) + ' do ano passado para comparar.' };
        if (!(base.bruto > 0)) return { aplica: false, motivo: 'A família não vendeu em ' + nomeMesFam(base.mes) + ' do ano passado: não dá para medir a subida.' };
        const subidaPct = r1f((prox.bruto - base.bruto) / base.bruto * 100);
        if (subidaPct < minPct) return { aplica: false, motivo: 'No ano passado a família não subiu em ' + nomeMesFam(alvo) + ' (' + (subidaPct < 0 ? '−' : '') + pctTxt(subidaPct) + ').' };
        const skus = (familia && familia.skus) || [], prods = ((full && full.produtos) || []).filter(Boolean), envios = [];
        let noFull = 0;
        skus.forEach(k => {
            prods.filter(p => (k.sku && SHC.normalizaSku(p.sku) === k.sku) || (p.itemIds && p.itemIds.length ? p.itemIds : [p.itemId]).some(x => (k.itemIds || []).indexOf(x) >= 0)).forEach(p => {
                const v30 = unDe(p.vendas30), aptas = Math.max(0, unDe(p.aptas) || 0), cam = Math.max(0, unDe(p.aCaminho) || 0);
                if (unDe(p.aptas) === null && v30 === null) return;
                noFull++;
                if (!(v30 > 0)) return;
                const previsao = Math.ceil(v30 * (1 + subidaPct / 100)), un = previsao - aptas - cam;
                if (un > 0 && !envios.some(e => e.sku === (k.sku || p.sku) && e.titulo === (p.titulo || k.titulo)))
                    envios.push({ sku: k.sku || SHC.normalizaSku(p.sku), titulo: String(p.titulo || k.titulo || '').slice(0, 120), un, aptas, aCaminho: cam, previsao });
            });
        });
        if (!noFull) return { aplica: false, motivo: 'Nenhum SKU desta família está no Full.' };
        const lim = diaMenosISO(alvo + '-01', diasAntes), ate = lim >= hoje ? lim : null, quando = ate ? 'até ' + ate.slice(8, 10) + '/' + ate.slice(5, 7) : 'o quanto antes';
        envios.sort((a, b) => b.un - a.un);
        const lista = envios.slice(0, 3).map(e => e.un + ' un. de ' + (e.sku || e.titulo)).join(', ') + (envios.length > 3 ? ' e mais ' + (envios.length - 3) : '');
        const texto = 'Em ' + nomeMesFam(alvo) + ' a família costuma subir ' + pctTxt(subidaPct) + ' (ano passado). '
            + (envios.length ? 'Envie ' + lista + ' para o Full ' + quando + '.' : 'O estoque no Full já cobre essa subida.');
        return { aplica: true, mes: alvo, subidaPct, texto, envios, ate };
    };

    /**
     * Meta do mês com projeção pelas vendas brutas da conta (vb:<conta>.dias). meta = cfg.meta_mes (R$; editável em Ajustes).
     * → { mes, ateAgora, diasLidos, diasNoMes, ritmoDia, projecao, meta, falta, ritmoNecessarioDia, pctMeta, vaiBater, motivo }
     * Ritmo = média dos dias COMPLETOS lidos (hoje ainda não acabou); projeção = dias completos + ritmo × dias que faltam (hoje incluso).
     * Sem dia lido no mês → projecao null e motivo. Sem meta → meta/falta/ritmoNecessarioDia null e motivo "defina a meta".
     */
    SHC.metaMes = function (vb, hoje, meta) {
        const h = hoje || SHC.hoje(), mes = h.slice(0, 7), dias = (vb && vb.dias) || {}, dn = diasNoMesFam(mes), diaHoje = +h.slice(8, 10);
        const m = SHC.num(meta) > 0 ? SHC.num(meta) : null;
        const ks = Object.keys(dias).filter(d => d.slice(0, 7) === mes && d <= h).sort(), completos = ks.filter(d => d < h);
        const out = { mes, ateAgora: null, diasLidos: completos.length, diasNoMes: dn, ritmoDia: null, projecao: null, meta: m, falta: null, ritmoNecessarioDia: null, pctMeta: null, vaiBater: null, motivo: '' };
        if (ks.length) out.ateAgora = SHC.r2(ks.reduce((s, d) => s + n0(dias[d] && dias[d].bruto), 0));
        if (completos.length) {
            const soma = completos.reduce((s, d) => s + n0(dias[d] && dias[d].bruto), 0);
            out.ritmoDia = SHC.r2(soma / completos.length);
            out.projecao = SHC.r2(soma + out.ritmoDia * (dn - completos.length));
        } else out.motivo = diaHoje === 1 ? 'O mês começou hoje: a projeção aparece amanhã.' : 'Ainda não li as vendas brutas deste mês — sincronize para ler.';
        if (m === null) { if (!out.motivo) out.motivo = 'Defina a meta do mês em Ajustes para ver quanto falta.'; return out; }
        out.falta = SHC.r2(Math.max(0, m - (out.ateAgora || 0)));
        out.ritmoNecessarioDia = SHC.r2(out.falta / Math.max(1, dn - diaHoje + 1));
        if (out.projecao !== null) { out.pctMeta = Math.round(out.projecao / m * 100); out.vaiBater = out.projecao >= m; }
        return out;
    };

    // ══ v2.7 (pedido da dona em 25/09/2026): detalhe das remessas do Full, simulador da próxima remessa, perguntas, reputação, resumo
    // semanal para o WhatsApp e as contas juntas. Só leitura; nada de nome, apelido, mensagem ou pergunta de comprador é guardado. ══

    // ── Detalhe de UMA remessa (GET /shipping/inbounds/<id>/details → _n.ctx.r.appProps.pageProps.view.data), visto ao vivo em 25/09/2026 ──
    const REM_FECHADA = /^(closed_ok|closed_with_changes|cancelled|canceled|expired)$/;
    const gramas = s => { const m = /([\d.,]+)\s*(kg|g)\b/i.exec(String(s || '')); if (!m) return null; const v = SHC.num(m[1]); return v === null ? null : (m[2].toLowerCase() === 'kg' ? v : v / 1000); };
    /**
     * Estado da tela (ou o próprio data) → { id, status, subStatus, statusTexto, agendadaPara, tipoColeta, centro, coletaPorDistancia,
     *   unidades:{enviadas, recebidas, faltando, inesperadas} (null = o ML ainda não informou; nunca 0 inventado),
     *   volumes:[{tipo:'PACKAGE'|'PALLET', subTipo, enviados, recebidos, faltando, comProblema, rejeitados}] (só os que têm volume),
     *   toleranciaPct, cobrancas:[{tipo, valor}] (charges[] — formato A CONFIRMAR ao vivo numa remessa cobrada; vazio no retrato),
     *   multa:{ativa, tipo, valor} (SÓ por um item de penalidade em charges[]; activePenaltyByUwsd/ByTier são da conta, não desta remessa),
     *   inconformidades:[texto pt-BR], reclamacoesDisponiveis:['RECOUNT'…] (as que dá para abrir agora), reclamacoesAbertas,
     *   produtos:[{itemId, sku, declaradas, processadas, diferencas, aptas, naoAptas, volumeCm3, volumeEstimado, pesoKg}] } | null (tela desconhecida).
     * Nome de quem enviou, transportadora e endereço NÃO são lidos.
     */
    SHC.mlRemessaDetalheDoEstado = function (r) {
        const pp = r && r.appProps && r.appProps.pageProps, v = pp && pp.view && pp.view.data;
        const d = (v && v.inboundId !== undefined ? v : null) || (r && r.inboundId !== undefined ? r : null)
            || primeiroEmLargura(r, o => (o.inboundId !== undefined && (o.unitsDetail || o.volumesDetail || o.units) ? o : undefined), 8);
        if (!d) return null;
        const nn = x => (typeof x === 'number' && isFinite(x) ? x : null), ap = d.appointment || {}, ud = d.unitsDetail || {}, st = String(d.status || '');
        const unidades = { enviadas: nn(ud.sent), recebidas: nn(ud.received), faltando: nn(ud.missing), inesperadas: nn(ud.unexpected) };
        const volumes = (Array.isArray(d.volumesDetail) ? d.volumesDetail : []).filter(x => x && ((x.sent || 0) > 0 || (x.received || 0) > 0)).map(x => ({
            tipo: String(x.type || ''), subTipo: String(x.subType || ''), enviados: nn(x.sent), recebidos: nn(x.received), faltando: nn(x.missing), comProblema: nn(x.withProblems),
            rejeitados: Array.isArray(x.rejectedVolumes) ? x.rejectedVolumes.length : 0 }));
        const produtos = (Array.isArray(d.units) ? d.units : []).filter(u => u && (u.itemId || u.sku)).map(u => {
            const dm = u.dimensions || {}, vol = dm.volume || {};
            return { itemId: String(u.itemId || ''), sku: String(u.sku || ''), declaradas: nn(u.declaredQuantity), processadas: nn(u.processedQuantity), diferencas: nn(u.differencesQuantity),
                aptas: nn(u.readyToFullQuantity), naoAptas: nn(u.notReadyToFullQuantity), identificado: u.identified !== false,
                volumeCm3: nn(vol.value), volumeEstimado: vol.estimated === true, pesoKg: gramas(dm.weight), resultado: resultadoTxt(u.processResults) };
        });
        const cobrancas = (Array.isArray(d.charges) ? d.charges : []).map(c => (c && typeof c === 'object' ? { tipo: String(c.type || c.description || c.name || c.label || ''),
            valor: SHC.num(c.amount !== undefined ? c.amount : c.value !== undefined ? c.value : c.total) } : null)).filter(c => c && c.valor !== null);
        const inc = [];
        if (unidades.faltando > 0) inc.push('Faltando ' + SHC.qtd(unidades.faltando, 'unidade', 'unidades'));
        if (unidades.inesperadas > 0) inc.push(SHC.qtd(unidades.inesperadas, 'unidade a mais do que o declarado', 'unidades a mais do que o declarado'));
        const rej = volumes.reduce((s, x) => s + x.rejeitados, 0), vf = volumes.reduce((s, x) => s + (x.faltando || 0), 0), vp = volumes.reduce((s, x) => s + (x.comProblema || 0), 0);
        if (rej > 0) inc.push(SHC.qtd(rej, 'volume rejeitado', 'volumes rejeitados'));
        if (vf > 0) inc.push(SHC.qtd(vf, 'volume que não chegou', 'volumes que não chegaram'));
        if (vp > 0) inc.push(SHC.qtd(vp, 'volume com problema', 'volumes com problema'));
        const semId = produtos.filter(p => !p.identificado).length, naoAptas = produtos.reduce((s, p) => s + (p.naoAptas || 0), 0);
        if (semId > 0) inc.push(SHC.qtd(semId, 'produto sem identificação', 'produtos sem identificação'));
        if (naoAptas > 0) inc.push(SHC.qtd(naoAptas, 'unidade não apta para o Full', 'unidades não aptas para o Full'));
        // Diferença por produto (differencesQuantity) só quando o ML não deu o faltando/a mais da remessa inteira (senão contaria 2×).
        const dif = produtos.reduce((s, p) => s + Math.abs(p.diferencas || 0), 0);
        if (dif > 0 && !(unidades.faltando > 0) && !(unidades.inesperadas > 0)) inc.push(SHC.qtd(dif, 'unidade diferente da declarada', 'unidades diferentes das declaradas'));
        const cl = d.claims || {}, tipos = Array.isArray(cl.typesClaimsAvailable) ? cl.typesClaimsAvailable : [];
        // Prazo para reclamar: só se o ML mandar uma DATA em sla_to_claim (formato A CONFIRMAR ao vivo; número de dias ou texto não vira prazo).
        const infoClaim = k => { for (const t of tipos) for (const i of (t && Array.isArray(t.additionalInformation) ? t.additionalInformation : [])) if (i && i.key === k && i.value) return String(i.value); return ''; };
        const prazo = /^\d{4}-\d{2}-\d{2}/.test(infoClaim('sla_to_claim')) ? dia10(infoClaim('sla_to_claim')) : null;
        // Multa DESTA remessa só com evidência própria: um item de penalidade em charges[]. activePenaltyByUwsd/ByTier são do programa de
        // penalidade da CONTA (o mesmo active_penalty_by_uwsd da lista, que vira o alerta "conta|penalidade") — não dizem que esta remessa foi multada.
        const cobMulta = cobrancas.filter(c => /penal|multa|fine/i.test(c.tipo));
        return { id: String(d.inboundId), status: st, subStatus: String(d.subStatus || ''), statusTexto: statusRemessaTxt(st), fechada: REM_FECHADA.test(st),
            agendadaPara: dia10(ap.scheduledDate), chegouEm: dia10(ap.arrivalDate), tipoColeta: String(ap.type || ''), centro: String((d.warehouse || {}).id || ''),
            coletaPorDistancia: d.pricingByDistanceEnabled === true, unidades, volumes, toleranciaPct: nn(d.divergenceTolerancePercentage), cobrancas,
            multa: { ativa: cobMulta.length > 0, tipo: cobMulta.length ? cobMulta[0].tipo : '', valor: cobMulta.length ? SHC.r2(cobMulta.reduce((s, c) => s + c.valor, 0)) : null },
            inconformidades: inc, reclamacoesDisponiveis: tipos.filter(t => t && t.enabledToClaim === true).map(t => String(t.type)),
            reclamacoesAbertas: Array.isArray(cl.claimsList) ? cl.claimsList.length : 0, prazoReclamar: prazo, produtos };
    };
    // "Resultado do processamento" de um produto (processResults[], formato A CONFIRMAR: vazio no retrato). Só texto do ML; nada inventado.
    function resultadoTxt(pr) {
        const t = (Array.isArray(pr) ? pr : []).map(x => (typeof x === 'string' ? x : x && typeof x === 'object' ? [x.description, x.title, x.text, x.label, x.message].find(v => typeof v === 'string' && v.trim()) : ''))
            .filter(v => v && /[a-zá-ú]/i.test(v)).map(v => v.trim());
        return [...new Set(t)].join(' · ');
    }
    const MULTA_TIPO = { LABEL_PROBLEM: 'problema de etiqueta', IDENTIFICATION_PROBLEM: 'problema de identificação', UNSOLVABLE_PROBLEM: 'problema sem solução', FISCAL_PROBLEM: 'problema fiscal',
        MISSING_UNITS: 'unidades faltando', DIVERGENCE: 'divergência na contagem', NO_SHOW: 'remessa não entregue', LATE: 'atraso' };
    const multaTxt = t => MULTA_TIPO[String(t || '').toUpperCase()] || String(t || '').toLowerCase().replace(/_/g, ' ');
    /** Flags da LISTA (inbound_problems) → textos pt-BR. */
    const problemasTxt = p => [p && p.identificacao ? 'Produtos com problema de identificação (etiqueta)' : '', p && p.fiscal ? 'Problema fiscal na remessa' : '', p && p.semSolucao ? 'Problema que o Mercado Livre marcou como sem solução' : ''].filter(Boolean);
    /**
     * lista = ml:full:remessas:<conta> (ou só o array remessas); detalhes = remessas:<conta>:detalhe ({porId}) | null; mes 'AAAA-MM'; hoje opcional.
     * → { abertas, fechadas30d, comInconformidade:[{id, statusTexto, quando, textos}], comMulta:[{id, valor, tipo, texto}], unidadesFaltando,
     *   custoMes (null = o ML ainda não cobrou nada no mês), unidadesMes, custoPorUnidade (null sem cobrança), custoMotivo, multasMes,
     *   semDetalhe (remessas ainda sem o detalhe lido), total, lidas }
     * Inconformidades, multas e unidades faltando: só das remessas abertas ou fechadas nos últimos 90 dias (a mesma janela do detalhe).
     * custoMes/unidadesMes: só remessas RECEBIDAS (closed_ok/closed_with_changes) com cobrança > 0 — o mesmo filtro de SHC.simulaRemessa;
     * remessa aberta ou ainda sem cobrança não vira "R$ 0,00". O total_charged já inclui a coleta e as multas; as multas saem à parte em multasMes.
     */
    SHC.remessasResumo = function (lista, detalhes, mes, hoje) {
        const rs = Array.isArray(lista) ? lista : ((lista && lista.remessas) || []), porId = (detalhes && detalhes.porId) || {}, h = hoje || SHC.hoje();
        const lim30 = diaMenosX(h, 30), lim90 = diaMenosX(h, 90), quando = r => r.recebida || r.agendada || r.atualizada || '';
        const out = { abertas: 0, fechadas30d: 0, comInconformidade: [], comMulta: [], unidadesFaltando: 0, custoMes: null, multasMes: 0, unidadesMes: 0, custoPorUnidade: null,
            custoMotivo: '', semDetalhe: 0, total: lista && typeof lista.total === 'number' ? lista.total : rs.length, lidas: rs.length };
        rs.forEach(r => {
            if (!r || !r.id) return;
            const d = porId[r.id] || null, st = String(r.status || ''), fechada = REM_FECHADA.test(st), recente = !fechada || quando(r) >= lim90;
            if (!fechada) out.abertas++; else if (quando(r) >= lim30) out.fechadas30d++;
            if (!d) out.semDetalhe++;
            // Valor da multa: número da lista (quando o ML manda) ou o item de penalidade do detalhe; sem número, só o aviso (nunca R$ 0,00).
            const dm = (d && d.multa) || {}, valor = r.multa > 0 ? r.multa : (dm.valor > 0 ? dm.valor : null), ativa = !!r.multaFlag || valor !== null || dm.ativa === true;
            if (recente) {
                const textos = problemasTxt(r.problemas).concat(d ? d.inconformidades : []);
                if (textos.length) out.comInconformidade.push({ id: String(r.id), statusTexto: r.statusTexto || '', quando: quando(r), textos: [...new Set(textos)] });
                const tipo = r.multaTipo ? ' (' + multaTxt(r.multaTipo) + ')' : '';
                if (ativa) out.comMulta.push({ id: String(r.id), valor, tipo: r.multaTipo || '', texto: valor !== null ? 'Multa de ' + SHC.moeda(valor) + tipo : 'Multa' + tipo + ' — o valor aparece em Gestão de envios Full' });
                if (d && d.unidades && d.unidades.faltando > 0) out.unidadesFaltando += d.unidades.faltando;
            }
            if (mes && quando(r).slice(0, 7) === mes) {
                out.multasMes = SHC.r2(out.multasMes + (valor || 0));
                if (/^closed_(ok|with_changes)$/.test(st) && r.custo > 0) { out.custoMes = SHC.r2((out.custoMes || 0) + r.custo); out.unidadesMes += r.unidades || 0; }
            }
        });
        out.custoPorUnidade = out.custoMes !== null && out.unidadesMes > 0 ? SHC.r2(out.custoMes / out.unidadesMes) : null;
        if (mes && out.custoMes === null) out.custoMotivo = 'o Mercado Livre ainda não cobrou a coleta de nenhuma remessa recebida neste mês';
        out.inconformes = SHC.remessasInconformes(rs, detalhes, h);
        return out;
    };
    /** Link do detalhe da remessa no ML (lá fica o botão "Iniciar reclamação por diferenças"). */
    SHC.remessaLink = id => URL_ENVIOS_FULL + '/' + encodeURIComponent(String(id)) + '/details';
    /**
     * v2.9 (pedido da dona 26/09): remessas RECEBIDAS nos últimos 90 dias que vieram com inconformidade, a mais nova primeiro →
     * [{ id, quando, statusTexto, declaradas, aptas, custo (o que o ML cobrou; null = nada), motivos:[pt-BR], produtos:[{itemId, sku, declaradas,
     *    processadas, diferencas, aptas, naoAptas, resultado}], prazo ('AAAA-MM-DD' só se o ML mandar), podeReclamar (null sem detalhe),
     *    reclamacaoAberta, semDetalhe, link }]. Sem detalhe lido, vale a lista (declaradas × à venda, status com mudanças).
     */
    SHC.remessasInconformes = function (lista, detalhes, hoje) {
        const rs = Array.isArray(lista) ? lista : ((lista && lista.remessas) || []), porId = (detalhes && detalhes.porId) || {};
        const lim = diaMenosX(hoje || SHC.hoje(), 90), soma = (ps, k) => (ps.some(p => typeof p[k] === 'number') ? ps.reduce((s, p) => s + (p[k] || 0), 0) : null);
        return rs.filter(r => r && r.id && /^closed_(ok|with_changes)$/.test(String(r.status || '')) && (r.recebida || r.atualizada || '') >= lim).map(r => {
            const d = porId[r.id] || null, ps = (d && d.produtos) || [], u = (d && d.unidades) || {};
            const declaradas = soma(ps, 'declaradas') !== null ? soma(ps, 'declaradas') : typeof u.enviadas === 'number' ? u.enviadas : typeof r.unidades === 'number' ? r.unidades : null;
            const aptas = soma(ps, 'aptas') !== null ? soma(ps, 'aptas') : typeof r.aptas === 'number' ? r.aptas : null;
            const dif = ps.reduce((s, p) => s + Math.abs(p.diferencas || 0), 0) + (u.faltando > 0 ? u.faltando : 0) + (u.inesperadas > 0 ? u.inesperadas : 0);
            const naoAptas = ps.reduce((s, p) => s + (p.naoAptas || 0), 0), motivos = [];
            if (dif > 0) motivos.push('unidades diferentes das declaradas');
            if (naoAptas > 0) motivos.push('unidades não aptas para o Full');
            if (!motivos.length && (r.status === 'closed_with_changes' || /differen/i.test(r.subStatus || '') || (declaradas !== null && aptas !== null && aptas < declaradas))) motivos.push('unidades com diferenças');
            if (!motivos.length) return null;
            return { id: String(r.id), quando: r.recebida || r.atualizada || '', statusTexto: r.statusTexto || '', declaradas, aptas, custo: r.custo > 0 ? r.custo : null, motivos,
                produtos: ps.map(p => ({ itemId: p.itemId, sku: p.sku, declaradas: p.declaradas, processadas: p.processadas, diferencas: p.diferencas, aptas: p.aptas, naoAptas: p.naoAptas, resultado: p.resultado || '' })),
                prazo: (d && d.prazoReclamar) || null, podeReclamar: d ? (d.reclamacoesDisponiveis || []).length > 0 : null, reclamacaoAberta: !!(d && d.reclamacoesAbertas > 0),
                semDetalhe: !d, link: SHC.remessaLink(r.id) };
        }).filter(Boolean).sort((a, b) => (a.quando < b.quando ? 1 : a.quando > b.quando ? -1 : 0));
    };
    /** Remessa com diferença que ainda pede ação do seller: o ML ainda aceita reclamação (ou sem detalhe para saber) e nenhuma foi aberta. */
    SHC.remessaPendente = r => !!r && r.podeReclamar !== false && !r.reclamacaoAberta;
    /** Passo da remessa na linha do tempo: 1 reservada · 2 recebendo · 3 processada · 0 cancelada/vencida · null (status que a tela não conhece). */
    const PASSO_REMESSA = { pending: 1, scheduled: 1, confirmed: 1, in_transit: 1, shipping_in_progress: 1, receiving: 2, working: 2, closed_ok: 3, closed_with_changes: 3, cancelled: 0, canceled: 0, expired: 0 };
    SHC.passoRemessa = st => (Object.prototype.hasOwnProperty.call(PASSO_REMESSA, st) ? PASSO_REMESSA[st] : null);

    // ── Simulador da próxima remessa (honesto: o ML cobra a coleta por distância e não publica a tabela; o Copiloto aprende com as remessas da conta) ──
    const VEICULOS = [   // ordem: do menor para o maior; cabe quando volume E peso cabem
        { nome: 'utilitário (até 1,5 m³/600 kg)', m3: 1.5, kg: 600 }, { nome: 'van (até 5 m³/1,2 t)', m3: 5, kg: 1200 },
        { nome: 'caminhão 3/4 (até 15 m³/3,5 t)', m3: 15, kg: 3500 }, { nome: 'truck (até 40 m³/12 t)', m3: 40, kg: 12000 }];
    const CAIXA_M3 = 0.1, CAIXA_KG = 25, PALLET_M3 = 1;
    /**
     * Medidas de um SKU para o simulador: 1º as do ML já lidas (medidas:<conta>.porItem[MLB].atual), senão as do ERP/planilha (c|sku).
     * → { ordenadas:[3 cm], pesoKg, fonte:'ml'|'erp' } | null
     */
    SHC.medidasParaSimular = function (itemIds, medidasSnap, cad) {
        const pi = (medidasSnap && medidasSnap.porItem) || {};
        for (const id of [].concat(itemIds || [])) { const a = pi[id] && pi[id].atual; if (a && Array.isArray(a.ordenadas) && a.ordenadas.length === 3) return { ordenadas: a.ordenadas.slice(), pesoKg: numF(a.pesoKg), fonte: 'ml' }; }
        const c = cad || {}, dims = [SHC.num(c.larguraCm), SHC.num(c.alturaCm), SHC.num(c.comprimentoCm)];
        if (dims.every(x => x > 0)) return { ordenadas: dims.slice().sort((a, b) => a - b), pesoKg: SHC.num(c.pesoKg) > 0 ? SHC.num(c.pesoKg) : null, fonte: 'erp' };
        return null;
    };
    /**
     * { skus:[{sku, qtd, medidas:{ordenadas:[cm], pesoKg}|null}], remessasAnteriores: ml:full:remessas:<conta> (ou o array) }
     * → { itens, unidades, volumeM3, pesoKg, semMedida:[sku], semPeso:[sku], volumesEstimados:{caixas, pallets, texto}, veiculo,
     *     custoEstimado:{valor, min, max, porUnidade, base (remessas usadas), fonte:'suas remessas anteriores'} | null, custoMotivo }
     * Volume = soma das caixas dos produtos (sem folga de empilhamento: é o mínimo). Caixas de até 25 kg / 0,1 m³; pallet quando passa de 1 m³.
     */
    SHC.simulaRemessa = function (o) {
        const skus = (o && o.skus) || [], rem = o && o.remessasAnteriores, rs = Array.isArray(rem) ? rem : ((rem && rem.remessas) || []);
        let vol = 0, peso = 0, un = 0;
        const semMedida = [], semPeso = [], itens = [];
        skus.forEach(s => {
            const q = Math.max(0, Math.round(SHC.num(s && s.qtd) || 0)), m = s && s.medidas;
            if (!q) return;
            un += q;
            const cm = m && Array.isArray(m.ordenadas) && m.ordenadas.length === 3 && m.ordenadas.every(x => x > 0) ? m.ordenadas : null;
            const v1 = cm ? cm[0] * cm[1] * cm[2] / 1e6 : null, p1 = m && numF(m.pesoKg) > 0 ? m.pesoKg : null;
            if (v1 === null) semMedida.push(s.sku || ''); else vol += v1 * q;
            if (p1 === null) semPeso.push(s.sku || ''); else peso += p1 * q;
            itens.push({ sku: s.sku || '', qtd: q, volumeM3: v1 === null ? null : SHC.r2(v1 * q * 1000) / 1000, pesoKg: p1 === null ? null : SHC.r2(p1 * q) });
        });
        vol = Math.round(vol * 1000) / 1000; peso = SHC.r2(peso);
        const pallets = vol > PALLET_M3 ? Math.ceil(vol / PALLET_M3) : 0, caixas = pallets ? 0 : Math.max(un ? 1 : 0, Math.ceil(vol / CAIXA_M3), Math.ceil(peso / CAIXA_KG));
        const volumes = { caixas, pallets, texto: pallets ? SHC.qtd(pallets, 'pallet', 'pallets') + ' (cerca de ' + String(vol).replace('.', ',') + ' m³)' : caixas ? 'cerca de ' + SHC.qtd(caixas, 'caixa', 'caixas') : '' };
        const completo = un > 0 && !semMedida.length, cabe = VEICULOS.find(v => vol <= v.m3 && peso <= v.kg);
        const veiculo = !completo ? null : (cabe ? cabe.nome : 'mais de um truck (acima de 40 m³/12 t)');
        // Custo: média por unidade das remessas FECHADAS com cobrança (total_charged ÷ units_count), faixa mín–máx das últimas 5.
        const base = rs.filter(r => r && REM_FECHADA.test(String(r.status || '')) && r.custo > 0 && r.unidades > 0)
            .sort((a, b) => String(b.recebida || b.agendada || '').localeCompare(String(a.recebida || a.agendada || ''))).slice(0, 5);
        let custo = null, custoMotivo = '';
        if (base.length && un > 0) {
            const pu = base.map(r => r.custo / r.unidades), med = pu.reduce((s, x) => s + x, 0) / pu.length;
            custo = { valor: SHC.r2(med * un), min: SHC.r2(Math.min(...pu) * un), max: SHC.r2(Math.max(...pu) * un), porUnidade: SHC.r2(med), base: base.length, fonte: 'suas remessas anteriores' };
        } else custoMotivo = 'O Mercado Livre cobra a coleta por distância, mas não publica a tabela; o Copiloto aprende com as suas remessas' + (un > 0 ? ' — ainda não há remessa fechada com cobrança nesta conta.' : '.');
        return { itens, unidades: un, volumeM3: vol, pesoKg: peso, semMedida, semPeso, volumesEstimados: volumes, veiculo,
            veiculoMotivo: veiculo ? '' : (!un ? 'Informe as quantidades.' : 'Falta a medida de ' + SHC.qtd(semMedida.length, 'SKU', 'SKUs') + ' (o Copiloto lê as medidas do ML na rodada lenta, ou use a planilha do ERP).'),
            custoEstimado: custo, custoMotivo };
    };

    // ── Resumo do vendedor (GET /resumo/api/content), visto ao vivo em 25/09/2026: cartões "Perguntas N", "Anúncios a melhorar", Full para repor… ──
    const linkDe = o => { const ev = ((o && o.cta && o.cta.events) || (o && o.events) || []).find(e => e && e.type === 'redirect' && e.data && e.data.href); return ev ? String(ev.data.href) : ''; };
    /**
     * JSON do Resumo → { perguntas:{pendentes, link} | null (cartão não achado), cartoes:[{id, grupo, texto, qtd, cor, link}], full:[{nome, pct, texto}], vendas7:{valor, variacaoPct}|null, reputacao:{texto}|null }
     * Só quantidades, textos dos cartões e links (nada de pessoa).
     */
    SHC.mlResumoDoConteudo = function (j) {
        const cards = (j && (j.cards || (j.resposta && j.resposta.cards))) || null;
        if (!cards || typeof cards !== 'object') return null;
        const lista = [].concat(((cards.pending_pre_sales_task_card || {}).data || {}).list || [], ((cards.pending_pos_sales_task_card || {}).data || {}).list || []);
        const q = cards.pending_pre_sales_task_card ? lista.find(c => c && c.id === 'question_task_card') : null;
        // pendentes null = o ML não mostrou o número (nunca vira 0)
        const perguntas = q ? { pendentes: inteiro(q.summary && q.summary.value), link: linkDe(q) || 'https://www.mercadolivre.com.br/perguntas/vendedor' } : null;
        const cartoes = [];
        lista.forEach(c => {
            if (!c || c.id === 'question_task_card') return;
            const grupo = String((c.group && c.group.value) || '');
            (Array.isArray(c.content) ? c.content : []).forEach(x => {
                const n = inteiro(x && x.badge && x.badge.text);
                if (!x || !x.id || n === null) return;
                cartoes.push({ id: String(x.id), grupo, texto: String((x.text && x.text.value) || ''), qtd: n, cor: String((x.badge && x.badge.color) || ''), link: linkDe(x) });
            });
        });
        const sf = ((cards.stock_full_card || {}).data || {}).general || [];
        const full = sf.map(g => ({ nome: String((g.description && g.description.value) || ''), pct: SHC.num(String((g.title && g.title.value) || '').replace('%', '')), texto: String((g.progressBar && g.progressBar.caption) || '') })).filter(f => f.nome);
        const mg = (((cards.metrics_card || {}).data || {}).general || [])[0], at = mg && mg.amountTitle;
        const vendas7 = at && SHC.num(at.fraction) !== null ? { valor: SHC.num(at.fraction), variacaoPct: at.badge && at.badge.text ? (/(down|baixo)/i.test(String((at.badge.icon || {}).name || '')) ? -1 : 1) * (SHC.num(String(at.badge.text).replace('%', '')) || 0) : null } : null;
        const rg = (((cards.reputation_card || {}).data || {}).general || [])[0];
        return { perguntas, cartoes, full, vendas7, reputacao: rg && rg.title && rg.title.value ? { texto: String(rg.title.value) } : null, ts: Date.now() };
    };

    // ── Perguntas (GET /perguntas/vendedor, estado embutido), visto ao vivo em 25/09/2026. Só contagem e prazos: nem o texto da pergunta nem quem perguntou. ──
    /** "1:55 h" → 115; "20 h" → 1200; "4 dias" → 5760; "45 min" → 45; senão null. */
    SHC.tempoEmMinutos = function (s) {
        const t = String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
        let m = /^(\d{1,3}):(\d{2}) ?h/.exec(t); if (m) return +m[1] * 60 + +m[2];
        m = /^([\d,.]+) ?(dias?|d)\b/.exec(t); if (m) return Math.round(SHC.num(m[1]) * 1440);
        m = /^([\d,.]+) ?(h|horas?)\b/.exec(t); if (m) return Math.round(SHC.num(m[1]) * 60);
        m = /^([\d,.]+) ?(min|minutos?)\b/.exec(t); if (m) return Math.round(SHC.num(m[1]));
        return null;
    };
    const faixaDe = l => (/9 ?[àa]s ?18/.test(l) ? 'comercial' : /18 ?[àa]s|noite/.test(l) ? 'noite' : /s[áa]bado|domingo|fim de semana/.test(l) ? 'fimDeSemana' : '');
    /**
     * Estado da página → { pendentes (label_counter com "A responder" + período "Todas as perguntas"; null se a tela não disse ou o período corta), media:{texto, minutos},
     *   tempoMedio:{comercial, noite, fimDeSemana} (minutos | null), faixas:[{faixa, rotulo, texto, minutos}], amostra:'Últimos 14 dias', ts } | null (tela desconhecida).
     */
    SHC.mlPerguntasDoEstado = function (r) {
        const pp = (r && r.appProps && r.appProps.pageProps) || r, rt = pp && pp.responseTimeData, bricks = pp && pp.bricks && pp.bricks.list;
        if (!rt && !bricks) return null;
        const info = (rt && rt.informationSection) || {}, ranges = (rt && rt.chart && Array.isArray(rt.chart.ranges)) ? rt.chart.ranges : [];
        const faixas = ranges.map(x => { const rot = String(x.label || '').replace(/<[^>]+>/g, ''); return { faixa: faixaDe(rot.toLowerCase()), rotulo: rot, texto: String(x.averageTimeLabel || ''), minutos: SHC.tempoEmMinutos(x.averageTimeLabel) }; });
        const tm = { comercial: null, noite: null, fimDeSemana: null };
        faixas.forEach(f => { if (f.faixa && tm[f.faixa] === null) tm[f.faixa] = f.minutos; });
        let pendentes = null;
        if (bricks) {
            const filtro = k => { const f = bricks[k], sel = f && f.data && (f.data.optionValues || []).find(o => o && o.selected); return sel ? sel.value : (f && f.data ? f.data.defaultValue : ''); };
            const val = filtro('filter_container_status'), periodo = filtro('filter_container_period');
            const lc = bricks.label_counter && bricks.label_counter.data && bricks.label_counter.data.label;
            // O contador obedece também ao período (padrão do ML: "Últimos 15 dias"): só vale como total pendente com "Todas as perguntas";
            // senão fica null e o cartão "Perguntas N" do Resumo (total) completa.
            if (val === 'unanswered' && (!periodo || periodo === 'all') && typeof lc === 'string') pendentes = inteiro(lc);
        }
        return { pendentes, media: info.average ? { texto: String(info.average), minutos: SHC.tempoEmMinutos(info.average) } : null, tempoMedio: tm, faixas, amostra: String(info.sampleLabel || ''), ts: Date.now() };
    };
    /** perguntas:<conta> → aviso pt-BR ou null. Vermelho com mais de 5 pendentes ou tempo médio comercial acima de 1 h. */
    SHC.perguntasAlerta = function (p) {
        if (!p || !(p.pendentes > 0)) return null;
        const tm = (p.tempoMedio || {}).comercial, lento = typeof tm === 'number' && tm > 60;
        const texto = SHC.qtd(p.pendentes, 'pergunta sem resposta', 'perguntas sem resposta') + '. O Mercado Livre diz que responder em até 1 hora vende até 10% mais.'
            + (lento ? ' Seu tempo médio em horário comercial: ' + minutosTxt(tm) + '.' : '');
        return { texto, pendentes: p.pendentes, vermelho: p.pendentes > 5 || lento, link: p.link || 'https://www.mercadolivre.com.br/perguntas/vendedor' };
    };
    const minutosTxt = m => (m === null || m === undefined ? '—' : m >= 1440 ? SHC.qtd(Math.round(m / 1440), 'dia', 'dias') : m >= 60 ? Math.floor(m / 60) + 'h' + (m % 60 ? String(m % 60).padStart(2, '0') : '') : m + ' min');
    SHC.minutosTxt = minutosTxt;

    // ── Reputação (GET /reputacao, estado embutido _n.ctx.r.appProps.pageProps), visto ao vivo em 25/09/2026 ──
    const NIVEL_REP = { green_platinum: 'MercadoLíder Platinum', green_gold: 'MercadoLíder Gold', green_silver: 'MercadoLíder', green: 'Verde', yellow: 'Amarela', orange: 'Laranja', red: 'Vermelha', newbie: 'Sem reputação ainda' };
    const ROTULO_REP = { claims: 'Reclamações', disputes: 'Mediações', cancellations: 'Cancelamentos (por você)', delayed_handling_time: 'Envios atrasados', delays: 'Envios atrasados' };
    const ROTULO_REQ = { gmv: 'faturamento', fulfilled_transactions: 'vendas concluídas', sales: 'vendas', claims: 'reclamações', disputes: 'mediações', cancellations: 'cancelamentos', delayed_handling_time: 'envios atrasados', antiquety: 'tempo de conta', documentation: 'documentação' };
    const pctNum = v => { const n = SHC.num(String(v === null || v === undefined ? '' : v).replace('%', '')); return n === null ? null : n; };
    /**
     * → { nivel:{codigo, texto}, periodo:{dias, vendas}, variaveis:[{id, rotulo, pct, qtd, vendas, limitePct, proximoNivelPct, saude, link}],
     *     topItens:[{itemId, problemas}], proximoNivel:{codigo, texto, faltam:[{id, rotulo, falta}]} | null, ts } | null (tela desconhecida).
     * Só números e ids de anúncio (o nome da loja e o link do perfil não são guardados).
     */
    SHC.mlReputacaoDoEstado = function (r) {
        const pp = (r && r.appProps && r.appProps.pageProps) || (r && r.dados) || r;
        const vd = pp && pp.variablesData, sd = (pp && pp.summaryData) || {};
        if (!vd || !Array.isArray(vd.variables)) return null;
        const cod = String((sd.levels && sd.levels.level) || (pp.levels && pp.levels.level) || (pp.requirementsData && pp.requirementsData.current && pp.requirementsData.current.level) || '');
        const variaveis = vd.variables.filter(v => v && v.id).map(v => {
            const th = v.thresholds || {};
            return { id: String(v.id), rotulo: ROTULO_REP[v.id] || String(v.id).replace(/_/g, ' '), pct: pctNum(v.percentage), qtd: inteiro(v.quantity), vendas: inteiro(v.transactions),
                limitePct: pctNum(th.quality && th.quality.percentage), proximoNivelPct: pctNum(th.next && th.next.percentage), saude: String(v.health || ''),
                link: v.metric_section && v.metric_section.url ? String(v.metric_section.url) : '' };
        });
        const top = ((pp.topItemProblemsData || {}).items || []).filter(i => i && i.id).map(i => ({ itemId: String(i.id), problemas: inteiro(i.quantity) }));
        const rq = pp.requirementsData, push = rq && rq.push && rq.push.level && rq.push.level !== cod ? rq.push.level : '';
        const proximo = push ? { codigo: push, texto: NIVEL_REP[push] || push, faltam: (rq.incomplete || []).filter(x => x && x.name).map(x => ({ id: String(x.name), rotulo: ROTULO_REQ[x.name] || String(x.name), falta: String(x.formatQuantity || x.quantity || '') })) } : null;
        return { nivel: { codigo: cod, texto: NIVEL_REP[cod] || cod || '—' }, periodo: { dias: inteiro(pp.periodDays || (sd.periods && sd.periods.quantity)), vendas: inteiro(sd.variables && sd.variables.sales) },
            variaveis, topItens: top, proximoNivel: proximo, linkTop: String((pp.topItemProblemsData || {}).url_metrics || ''), ts: Date.now() };
    };
    const pctBR = v => String(Math.round(v * 100) / 100).replace('.', ',') + '%';
    /**
     * reputacao:<conta> → [{id, rotulo, texto, pct, limitePct, usoPct, vermelho, link}]: variável em 70% ou mais do limite, ou saúde ≠ healthy.
     * Texto: "Reclamações: 0,24% (3 de 1.204 vendas) · limite 1%". Vermelho em 90% ou mais (ou saúde ruim).
     */
    SHC.reputacaoAlertas = function (rep, opc) {
        const lim = numF(opc && opc.avisoPct) !== null ? opc.avisoPct : 70, out = [];
        ((rep && rep.variaveis) || []).forEach(v => {
            if (!v || v.pct === null) return;
            const uso = v.limitePct > 0 ? v.pct / v.limitePct * 100 : null, ruim = !!v.saude && v.saude !== 'healthy';
            if (!ruim && !(uso !== null && uso >= lim)) return;
            const texto = v.rotulo + ': ' + pctBR(v.pct) + (v.qtd !== null && v.vendas !== null ? ' (' + v.qtd + ' de ' + SHC.qtd(v.vendas, 'venda', 'vendas') + ')' : '')
                + (v.limitePct !== null ? ' · limite ' + pctBR(v.limitePct) : '') + (uso !== null && uso >= 100 ? ' — passou do permitido' : uso !== null && uso >= 90 ? ' — quase no limite' : ruim ? ' — o Mercado Livre marcou esta variável' : ' — passou de ' + lim + '% do limite');
            out.push({ id: v.id, rotulo: v.rotulo, texto, pct: v.pct, limitePct: v.limitePct, usoPct: uso === null ? null : Math.round(uso), vermelho: ruim || (uso !== null && uso >= 90), link: v.link || '' });
        });
        return out;
    };

    // ── Resumo semanal para o WhatsApp (só texto; quem envia é o seller). Nada de dado pessoal. ──
    const dBR = d => d.slice(8, 10) + '/' + d.slice(5, 7);
    const moedaCurta = v => SHC.moeda(v).replace(',00', '');
    const sinal = p => (p > 0 ? '+' : p < 0 ? '−' : '') + String(Math.abs(Math.round(p * 10) / 10)).replace('.', ',') + '%';
    /**
     * dados = { nome (apelido da conta ou "Conta …1234"), vb (vb:<conta>), lucro:{valor, parcial, cobertoPct}|null, skus:{subindo:[{sku, titulo, variacaoPct, bruto}], caindo:[…]}|null,
     *   anomalias (shc:anomalias da conta), perguntas (perguntas:<conta>), reputacao (reputacao:<conta>), cert (cert:<conta>), remessas (SHC.remessasResumo) }
     * → { texto, semana:{de, ate}, vendas:{semana, anterior, variacaoPct, diasLidos}, linhas, waLink } — hoje fica fora (o dia não acabou): semana = os 7 dias antes de hoje.
     */
    SHC.resumoSemanal = function (conta, dados, hoje) {
        const d = dados || {}, h = hoje || SHC.hoje(), dias = (d.vb && d.vb.dias) || {};
        const de = diaMenosX(h, 7), ate = diaMenosX(h, 1), deAnt = diaMenosX(h, 14), ateAnt = diaMenosX(h, 8);
        const soma = (a, b) => { let s = 0, n = 0; for (let k = a; k <= b; k = diaMenosX(k, -1)) { if (dias[k] && typeof dias[k].bruto === 'number') { s += dias[k].bruto; n++; } } return { valor: SHC.r2(s), dias: n }; };
        const sem = soma(de, ate), ant = soma(deAnt, ateAnt), nome = d.nome || ('Conta ID …' + String(conta || '').slice(-4));
        const L = ['Resumo da semana · ' + nome + ' · ' + dBR(de) + ' a ' + dBR(ate)];
        let variacao = null;
        if (!sem.dias) L.push('Vendas: ainda não li as vendas desta semana. Abra o Copiloto e sincronize.');
        else {
            let t = 'Vendas: ' + moedaCurta(sem.valor) + (sem.dias < 7 ? ' (só ' + sem.dias + ' de 7 dias lidos)' : '');
            if (ant.dias === 7 && sem.dias === 7 && ant.valor > 0) { variacao = Math.round((sem.valor - ant.valor) / ant.valor * 1000) / 10; t += ' · ' + sinal(variacao) + ' contra a semana anterior (' + moedaCurta(ant.valor) + ')'; }
            else if (ant.dias < 7) t += ' · sem a semana anterior inteira para comparar';
            L.push(t);
        }
        const lu = d.lucro;
        if (lu && typeof lu.valor === 'number') L.push('Lucro estimado no mês: ' + moedaCurta(lu.valor) + (lu.parcial ? ' (só dos produtos com custo informado' + (typeof lu.cobertoPct === 'number' ? ', ' + Math.round(lu.cobertoPct) + '% das vendas' : '') + ')' : ''));
        else L.push('Lucro estimado: informe o custo dos produtos no Copiloto para ver.');
        const sk = d.skus || {}, fmt = x => (x.sku || x.titulo || '').slice(0, 30) + ' (' + sinal(x.variacaoPct) + ')';
        if ((sk.subindo || []).length) L.push('Subindo no mês: ' + sk.subindo.slice(0, 3).map(fmt).join(', '));
        if ((sk.caindo || []).length) L.push('Caindo no mês: ' + sk.caindo.slice(0, 3).map(fmt).join(', '));
        const at = [], an = d.anomalias && (!conta || String(d.anomalias.conta || conta) === String(conta)) ? d.anomalias.porTipo || {} : {};
        if (an.estoque > 0) at.push(SHC.qtd(an.estoque, 'produto sem estoque no Full', 'produtos sem estoque no Full'));
        if (an.full > 0) at.push(SHC.qtd(an.full, 'aviso do Full', 'avisos do Full'));
        if (an.pagamento > 0) at.push(SHC.qtd(an.pagamento, 'cobrança a conferir', 'cobranças a conferir'));
        if (an.posvenda > 0) at.push(SHC.qtd(an.posvenda, 'pendência no pós-venda', 'pendências no pós-venda'));
        const pa = SHC.perguntasAlerta(d.perguntas);
        if (pa) at.push(SHC.qtd(pa.pendentes, 'pergunta sem resposta', 'perguntas sem resposta'));
        SHC.reputacaoAlertas(d.reputacao).forEach(a => at.push(a.rotulo.toLowerCase() + ' em ' + pctBR(a.pct) + (a.limitePct !== null ? ' (limite ' + pctBR(a.limitePct) + ')' : '')));
        const c = SHC.certAgora(d.cert, Date.parse(h + 'T12:00:00'));
        if (c && (c.expirou || c.dias <= 30)) at.push(c.expirou ? 'certificado digital vencido' : 'certificado digital vence em ' + SHC.qtd(c.dias, 'dia', 'dias'));
        const rm = d.remessas || {};
        if ((rm.comMulta || []).length) at.push(SHC.qtd(rm.comMulta.length, 'remessa do Full com multa', 'remessas do Full com multa'));
        L.push(at.length ? 'Atenção: ' + at.join(' · ') : 'Nada pede sua atenção agora.');
        L.push('Gerado pelo Copiloto');
        const texto = L.join('\n');
        return { texto, semana: { de, ate }, vendas: { semana: sem.dias ? sem.valor : null, anterior: ant.dias === 7 ? ant.valor : null, variacaoPct: variacao, diasLidos: sem.dias }, linhas: L,
            waLink: 'https://wa.me/?text=' + encodeURIComponent(texto) };
    };

    // ── Contas juntas (só sellerIds e apelidos dados pelo seller em Ajustes; nada de nome do ML) ──
    /** Apelido da conta: cfg.apelidos[sellerId] ou "Conta …1234" (definido em store.js, que carrega antes; aqui só por segurança). */
    SHC.nomeConta = SHC.nomeConta || ((sellerId, cfg) => { const ap = cfg && cfg.apelidos && cfg.apelidos[sellerId]; return ap && String(ap).trim() ? String(ap).trim().slice(0, 40) : 'Conta ID …' + String(sellerId || '').slice(-4); });
    /**
     * contas = [{sellerId, nome, vb (vb:<conta>), fech (fech:<conta>:<mes>), anomalias (shc:anomalias:<conta> | null)}], mes 'AAAA-MM'
     * → { mes, contas:[{sellerId, nome, vendasBrutas|null, parcial, liquido|null, alertas|null, motivo}], total:{vendasBrutas, liquido, alertas, contasComVendas, contasComLiquido}, faltando:[nome] }
     * Líquido = vendas brutas − canceladas/devolvidas − tudo o que o ML cobrou no mês (fech.total), a mesma conta do Fechamento. Sem o dado, null e o motivo (nunca 0).
     */
    SHC.consolidado = function (contas, mes) {
        const out = { mes, contas: [], total: { vendasBrutas: 0, liquido: 0, alertas: 0, contasComVendas: 0, contasComLiquido: 0, contasComAlertas: 0 }, faltando: [] };
        (contas || []).forEach(c => {
            if (!c || !c.sellerId) return;
            const nome = c.nome || SHC.nomeConta(c.sellerId), vbm = c.vb && c.vb.dias ? SHC.vendasBrutasDoMes(c.vb.dias, mes) : null, f = c.fech;
            const lido = !!(c.vb && (c.vb.mesesLidos || []).indexOf(mes) >= 0), parcial = !!vbm && !lido;
            const bruto = vbm ? vbm.valor : null, custos = f && typeof f.total === 'number' ? f.total : null;
            const liquido = bruto !== null && custos !== null ? SHC.r2(bruto - (vbm.cancelado || 0) - (vbm.devolvido || 0) - custos) : null;
            const alertas = c.anomalias && typeof c.anomalias.total === 'number' ? c.anomalias.total : null;
            const motivo = bruto === null ? 'Ainda não li as vendas desta conta neste mês. Entre nela no Mercado Livre e sincronize.' : custos === null ? 'O Faturamento deste mês ainda não foi lido nesta conta.' : '';
            out.contas.push({ sellerId: String(c.sellerId), nome, vendasBrutas: bruto, parcial, liquido, alertas, motivo });
            if (bruto !== null) { out.total.vendasBrutas = SHC.r2(out.total.vendasBrutas + bruto); out.total.contasComVendas++; } else out.faltando.push(nome);
            if (liquido !== null) { out.total.liquido = SHC.r2(out.total.liquido + liquido); out.total.contasComLiquido++; }
            if (alertas !== null) { out.total.alertas += alertas; out.total.contasComAlertas++; }
        });
        out.contas.sort((a, b) => (b.vendasBrutas || 0) - (a.vendasBrutas || 0));
        if (!out.total.contasComVendas) out.total.vendasBrutas = null;
        if (!out.total.contasComLiquido) out.total.liquido = null;
        if (!out.total.contasComAlertas) out.total.alertas = null;
        return out;
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = SHC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
