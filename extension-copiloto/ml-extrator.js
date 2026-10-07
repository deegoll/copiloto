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
        // F6/F15: total que a Central diz ter e as caixas sem a conta do ML (o fundo grava; antes eram descartadas no painel).
        return { familias, propostas, vazio, total: SHC.mlPromosTotal(r), semCalculo: SHC.telaPromosSemCalculo(r) };
    };

    // Textos de um bloco do estado (só primaryText.content), em ordem — o leitor das caixas sem cálculo usa este (o de cima pega mais coisa).
    function textosPrim(o, lim) {
        const out = [];
        (function a(x, p) {
            if (!x || typeof x !== 'object' || p > 12 || out.length >= lim) return;
            if (x.primaryText && typeof x.primaryText.content === 'string') out.push(x.primaryText.content);
            for (const k in x) if (k !== 'totalCharges') a(x[k], p + 1);
        })(o, 0);
        return out;
    }
    function acha(o, teste) {
        let achou = false;
        (function a(x, p) {
            if (achou || !x || typeof x !== 'object' || p > 14) return;
            if (teste(x)) { achou = true; return; }
            for (const k in x) a(x[k], p + 1);
        })(o, 0);
        return achou;
    }
    /**
     * Central de promoções: caixas SEM a conta do ML (aporte / redução de tarifas, sem totalCharges).
     * Caixa = objeto com columns[] numa lista onde outra caixa tem totalCharges, ou com type "…meli…".
     * → [{ familia: 'F…', nome, datas }]. F15 (30/09): mudou de ml-tela.js para cá — o fundo grava estas promoções (semCalculo) no retrato.
     */
    SHC.telaPromosSemCalculo = function (r) {
        const cards = [], caixas = [], visto = new WeakSet();
        const temTC = b => acha(b, x => !!x.totalCharges);
        const ehMeli = b => acha(b, x => typeof x.type === 'string' && /meli|aporte/i.test(x.type));
        (function andar(o, caminho, prof) {
            if (!o || typeof o !== 'object' || prof > 50 || visto.has(o)) return;
            visto.add(o);
            if (o.shippingInfo !== undefined && o.title !== undefined && o.id) cards.push({ caminho, o });
            if (Array.isArray(o)) {
                const bx = o.filter(x => x && Array.isArray(x.columns));
                if (bx.length) {
                    const algumTC = bx.some(temTC);
                    o.forEach((b, i) => {
                        if (!b || !Array.isArray(b.columns) || temTC(b)) return;
                        if (ehMeli(b) || (algumTC && b.columns.length >= 3 && textosPrim(b.columns[0], 1).length)) caixas.push({ caminho: caminho.concat(String(i)), b });
                    });
                }
            }
            for (const k in o) andar(o[k], caminho.concat(k), prof + 1);
        })(r, [], 0);
        const prefixo = (a, b) => { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n; };
        return caixas.map(c => {
            let fam = null, melhor = -1;
            cards.forEach(f => { const n = prefixo(f.caminho, c.caminho); if (n > melhor) { melhor = n; fam = f; } });
            const t = textosPrim(c.b.columns[0], 6);
            return { familia: fam ? 'F' + String(fam.o.id).replace(/\D/g, '') : null, nome: t[0] || 'Promoção', datas: t.slice(1).find(x => /\d/.test(x)) || '' };
        }).filter(c => c.familia);
    };
    // F6: leitura da Central cortada no meio → o lido agora + as famílias do retrato anterior que não vieram (com as propostas delas).
    // lidas = quantas famílias vieram nesta leitura; o painel mostra "Leitura incompleta: lidas de total".
    SHC.juntaPromosParcial = function (ant, novo, o) {
        const chaves = new Set(novo.familias.map(f => f.chave)), velhas = ((ant && ant.familias) || []).filter(f => f && !chaves.has(f.chave)), vc = new Set(velhas.map(f => f.chave));
        const dasVelhas = l => (l || []).filter(p => p && vc.has(p.familia));
        return { paginas: o.paginas, total: o.total, completo: false, falhouPagina: o.falhou, lidas: novo.familias.length, familias: novo.familias.concat(velhas),
            propostas: novo.propostas.concat(dasVelhas(ant && ant.propostas)), semCalculo: (novo.semCalculo || []).concat(dasVelhas(ant && ant.semCalculo)) };
    };
    // F6: total de famílias que a Central diz ter (brick 'pagination' → data.total), para "X de Y" quando uma página falha. null = não veio.
    SHC.mlPromosTotal = function (r) {
        const bricks = (r && r.appProps && r.appProps.pageProps && r.appProps.pageProps.brickTree && r.appProps.pageProps.brickTree.bricks) || [];
        const p = (Array.isArray(bricks) ? bricks : []).find(b => b && b.uiType === 'pagination'), t = p && p.data && SHC.num(p.data.total);
        return t !== null && t !== undefined && t >= 0 ? t : null;
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

    // ── v3.1: competição no catálogo pela tela "Alterar anúncio" (a MESMA leitura de fotos/medidas; mapeado ao vivo em 26/09/2026):
    // brick 'competition_task' > 'buybox_competition_user_product'. Só LEITURA: as ações do brick (competition-push-price = ESCRITA,
    // "Reportar") nunca são chamadas nem guardadas; do botão "Baixar para R$ X" fica só o número (o preço para ganhar).
    const txtDe = v => String((v && (typeof v === 'string' ? v : v.label || v.text)) || '').replace(/\s+/g, ' ').trim();
    const ofertaComp = row => {
        if (!row || typeof row !== 'object') return null;
        const pr = row.price || {}, pub = row.publication || {};
        const preco = SHC.num(pr.amount) !== null ? SHC.num(pr.amount) : SHC.valorRS(txtDe(pr));
        return { itemId: /^MLB\d+$/.test(String(row.itemId || '')) ? String(row.itemId) : '', loja: txtDe(pub.title).slice(0, 60), unidades: txtDe(pub.secondaryLabel).slice(0, 30),
            preco: preco > 0 ? preco : null, parcelamento: txtDe(row.installments).slice(0, 60), frete: txtDe(row.shipping).slice(0, 60),
            logistica: txtDe(row.logistics).replace(/^Envios? no Mercado Livre:\s*/i, '').slice(0, 60), melhor: /melhor oferta/i.test(txtDe(row.tagStatus)) };
    };
    /**
     * Tela "Alterar anúncio" → { itemId, catalogo, estado ('perdendo'|'ganhando'|…), tipo, winRate (% | null), precoGanhar | null, voce, vencedor | null,
     * souVencedor, concorrentes (qtd na tabela), visitas {voce, concorrentes, total, delta, tendencia, dias:[{dia, voce, conc}]} | null, mensagem } | null (sem o brick).
     * voce/vencedor = { itemId, loja, unidades, preco, parcelamento, frete, logistica } (loja = nome público da loja no ML; nada de comprador).
     */
    SHC.mlCompeticaoDoEstado = function (r) {
        if (!r || typeof r !== 'object') return null;
        const t = primeiroEmLargura(r, o => (o.id === 'competition_task' && o.data ? o : undefined), 40);
        if (!t) return null;
        const b = primeiroEmLargura(t, o => (o.id === 'buybox_competition_user_product' && o.data ? o.data : undefined), 8) || {};
        const grupos = ((b.competitionTable || {}).groups || []).filter(g => g && Array.isArray(g.rows));
        const rows = [].concat(...grupos.map(g => g.rows)).filter(x => x && typeof x === 'object');
        const eu = rows.find(x => x.role === 'requester'), vr = rows.find(x => /melhor oferta/i.test(txtDe(x.tagStatus)));
        const voce = ofertaComp(eu), acao = eu && ((eu.price || {}).actions || []).find(a => a && (a.id === 'LOWER_PRICE' || /baixar para/i.test(txtDe(a))));
        const pg = acao ? (SHC.num(acao.priceValue) !== null ? SHC.num(acao.priceValue) : SHC.valorRS(txtDe(acao))) : null;
        const pill = txtDe(((t.data || {}).header || {}).pill).toLowerCase(), show = ((t.data || {}).metrics || {}).show || {};
        const ui = String(b.uiState || show.competitionType || '');
        const estado = pill ? pill.normalize('NFD').replace(/[̀-ͯ]/g, '') : /^losing/.test(ui) ? 'perdendo' : /^winning/.test(ui) ? 'ganhando' : '';
        const vp = b.visitPerformance || {}, pa = vp.participation || {};
        const visitas = Array.isArray(vp.dailyData) || pa.total !== undefined ? {
            voce: SHC.num(pa.myVisits), concorrentes: SHC.num(pa.competitors), total: SHC.num(pa.total), delta: txtDe(pa.deltaLabel).slice(0, 30), tendencia: String(pa.trend || ''),
            dias: (vp.dailyData || []).slice(0, 14).map(d => ({ dia: String((d && d.date) || '').slice(0, 12), voce: SHC.num(d && d.myVisits) || 0, conc: SHC.num(d && d.competitorsVisits) || 0 })),
        } : null;
        const wr = SHC.num(show.winRate) !== null ? SHC.num(show.winRate) : numPct(pa.winRate);   // numPct (mais abaixo): "15%" → 15
        return { itemId: voce ? voce.itemId : '', catalogo: /^MLB\d+$/.test(String(b.productId || '')) ? String(b.productId) : '', estado, tipo: ui.slice(0, 40),
            winRate: wr, precoGanhar: pg > 0 ? pg : null, voce, vencedor: vr && vr !== eu ? ofertaComp(vr) : null, souVencedor: !!(vr && vr === eu),
            concorrentes: rows.filter(x => x.role === 'competitor').length, visitas, mensagem: txtDe(grupos[0] && grupos[0].message).slice(0, 160) };
    };
    const CATCOMP_HIST_MAX = 120;
    /** catcomp:<conta>.porItem[MLB] + leitura nova → entrada { ...leitura, ts, hist:[{d, e, w (winRate), g (preço p/ ganhar), vp (preço do vencedor)}] } (1 por dia; a do dia é trocada). */
    SHC.compCatRegistra = function (ant, leitura, hoje, agora) {
        const h = ((ant && ant.hist) || []).filter(x => x && x.d && x.d !== hoje);
        const v = leitura.vencedor;
        h.push({ d: hoje, e: leitura.estado, w: leitura.winRate, g: leitura.precoGanhar, vp: v ? v.preco : null });
        return Object.assign({}, leitura, { ts: agora || Date.now(), hist: h.sort((a, b) => (a.d < b.d ? -1 : 1)).slice(-CATCOMP_HIST_MAX) });
    };
    /**
     * "O que fazer para ganhar", em ordem → [{ tipo: 'preco'|'logistica'|'parcelamento'|'frete'|'info', cor: 'l'|'a'|'p'|'n', txt }].
     * sg = sobra no preço para ganhar (SHC.sobraAtacado no preço de ganhar: mesma tarifa % e mesmo frete) | null (sem custo).
     * Baixar o preço vem 1º só se ainda sobra lucro; senão, 1º as alavancas que o vencedor tem e você não (colunas da tabela do ML).
     */
    SHC.compCatAcoes = function (c, sg) {
        if (!c || c.souVencedor || c.estado === 'ganhando') return [];
        const out = [], v = c.vencedor, eu = c.voce || {}, pg = c.precoGanhar;
        let preco = null;
        if (pg) {
            if (!sg || sg.sobra === null || sg.sobra === undefined) preco = { tipo: 'preco', cor: 'n', txt: 'Baixar para ' + SHC.moeda(pg) + ': informe o custo para saber se ainda dá lucro.' };
            else if (sg.sobra >= 0) preco = { tipo: 'preco', cor: 'l', txt: 'Baixar para ' + SHC.moeda(pg) + ': ainda sobra ' + SHC.moeda(sg.sobra) + ' (' + SHC.pctTxt(sg.pct) + ') por venda.' };
            else preco = { tipo: 'preco', cor: 'p', txt: 'Baixar para ' + SHC.moeda(pg) + ' dá prejuízo de ' + SHC.moeda(-sg.sobra) + ' por venda: não compensa.' };
        }
        if (preco && preco.cor !== 'p') out.push(preco);
        if (v) {
            const vl = v.logistica.toLowerCase(), el = String(eu.logistica || '').toLowerCase();
            if (/full/.test(vl) && !/full/.test(el)) out.push({ tipo: 'logistica', cor: 'a', txt: 'O vencedor envia pelo Full e você não: mandar ao Full ajuda a ganhar.' });
            else if (/flex/.test(vl) && !/flex/.test(el)) out.push({ tipo: 'logistica', cor: 'a', txt: 'O vencedor tem Flex e você não: habilitar o Flex ajuda a ganhar.' });
            else if (/coleta/.test(vl) && /ag[êe]ncia/.test(el)) out.push({ tipo: 'logistica', cor: 'a', txt: 'O vencedor tem coleta e você agência: Full, Flex ou coleta ajudam a ganhar.' });
            else if (vl && el && vl !== el) out.push({ tipo: 'logistica', cor: 'a', txt: 'Entrega: o vencedor tem “' + v.logistica + '” e você “' + eu.logistica + '”.' });
            if (/premium|sem juros/i.test(v.parcelamento) && !/premium|sem juros/i.test(eu.parcelamento || ''))
                out.push({ tipo: 'parcelamento', cor: 'a', txt: 'O vencedor parcela sem juros e você não: mudar para Premium (a tarifa do Premium é maior).' });
            if (/gr[áa]tis/i.test(v.frete) && !/gr[áa]tis/i.test(eu.frete || '')) out.push({ tipo: 'frete', cor: 'a', txt: 'O vencedor tem frete grátis e você não: oferecer frete grátis.' });
            if (out.every(x => x.tipo === 'preco') && v.preco && eu.preco && v.preco > eu.preco + 0.004)
                out.push({ tipo: 'info', cor: 'n', txt: 'O vencedor cobra mais caro (' + SHC.moeda(v.preco) + '): o ML pesa entrega, parcelamento e reputação, não só o preço.' });
        }
        if (preco && preco.cor === 'p') out.push(preco);
        if (!out.length) out.push({ tipo: 'info', cor: 'n', txt: 'O ML não mostrou o que falta. Confira em “Alterar anúncio”, seção Concorrência.' });
        return out;
    };
    /**
     * Sazonalidade da competição: histórico comp:<conta>[MLB] ([{d, e}], 1 registro por mudança) → [{ mes 'AAAA-MM', ganhando, perdendo, dividindo }]
     * (dias em cada estado, os meses mais novos por último, no máx. `meses`). Antes do 1º registro não se sabe: não conta.
     */
    SHC.compPorMes = function (hist, hoje, meses) {
        const h = (Array.isArray(hist) ? hist : []).filter(x => x && /^\d{4}-\d{2}-\d{2}$/.test(x.d)).sort((a, b) => (a.d < b.d ? -1 : 1));
        const fim = diaUTC(hoje || SHC.hoje()), out = {};
        h.forEach((x, i) => {
            const k = /^(perdendo|restrito)$/.test(x.e) ? 'perdendo' : x.e === 'ganhando' ? 'ganhando' : x.e === 'dividindo' ? 'dividindo' : '';
            const ate = i + 1 < h.length ? diaUTC(h[i + 1].d) : fim;   // hoje não conta: bate com o "há N dias" de compResumo (hoje − desde)
            if (!k) return;
            for (let t = diaUTC(x.d); t < ate && t < fim; t += 864e5) {
                const m = new Date(t).toISOString().slice(0, 7), o = out[m] || (out[m] = { mes: m, ganhando: 0, perdendo: 0, dividindo: 0 });
                o[k]++;
            }
        });
        return Object.keys(out).sort().slice(-(meses || 12)).map(m => out[m]);
    };

    // v3.2 (frente Logística por anúncio): o que a MESMA linha da lista já traz sobre a forma de entrega e o status (retratos AMB MOVE 24-26/09/2026):
    // purchaseOptions "Combine a entrega" (sem Mercado Envios: o frete não sai do "Você recebe"); product.stock[].id ('available' | 'seller_warehouse'…);
    // dynamicCell cellId 'status_restriction' {contentId: out_of_stock | paused | closed_finalized | …, lines:["Inativo", "Não há mais unidades à venda."]};
    // dynamicCell trackData.contentId ME_FLEX_ITEM_OPTIN / UP_ME_FLEX_ITEM_OPTIN = o ML sugere ativar o Flex ("Ofereça envios no mesmo dia").
    function logisticaDaLinha(row, condL) {
        const dc = row.dynamicCell || {}, cid = String(dc.contentId || (dc.trackData || {}).contentId || '');
        const lin = (dc.lines || []).map(l => String((l && l.label) || '').trim()).filter(Boolean);
        return {
            entregaTxt: (condL.find(t => /combin(e|ar) a entrega/i.test(t)) || '').slice(0, 60),
            estoqueOnde: ((row.product || {}).stock || []).map(s => String((s && s.id) || '')).filter(Boolean).slice(0, 4),
            restricao: dc.cellId === 'status_restriction' && cid ? { id: cid.slice(0, 40), txt: lin.join(' · ').slice(0, 160) } : null,
            sugereFlex: /ME_FLEX_ITEM_OPTIN$/.test(cid),
        };
    }
    // ── SKU do anúncio (30/09/2026: "anúncio sem SKU" em anúncio que TEM SKU no ML) ──
    // Documentação oficial do ML (developers.mercadolivre.com.br/pt_br/variacoes, 29/12/2025; itens-e-buscas, 31/08/2026; user-products e
    // preco-variacao, 2026): o SKU do vendedor é o ATRIBUTO SELLER_SKU — do item ou de CADA variação (variations[].attributes, só com
    // include_attributes=all). O seller_custom_field é um campo interno "sem relação" com o SELLER_SKU: só entra se não houver mais nada.
    // EAN/GTIN nunca é SKU. No modelo User Products os anúncios do mesmo user product (MLBU…, ex.: Clássico + Premium) dividem o SKU.
    // O painel web mostra o SELLER_SKU como texto ("SKU 1411" em product.sku) só na linha de anúncio simples: a linha fechada de anúncio com
    // variações (metadata.variationsQuantity > 0, "Expandir variações") não traz SKU, e a linha de dentro (innerRows) do mesmo user product
    // vem sem 'product' (retrato de uma CONTA DE TESTE, anuncios_sem_dados_fiscais_p1.json rows[13] — não é a conta de peças de caminhão
    // do relato; os 5 MLB do print dela ainda não foram vistos em retrato). Linha de FAMÍLIA (metadata.entityType 'family', itemId '',
    // "Expandir anúncios") não é anúncio: os anúncios dela só vêm quando a família está aberta (innerRows); fechada, innerRows = null.
    // ATENÇÃO: nenhuma leitura do Copiloto traz hoje o formato da API (/items com attributes/variations): SHC.skusDoItemML fica pronto
    // para quando uma tela trouxer esse formato; o SKU que chega de verdade é o texto "SKU …" da lista, das vendas por anúncio e do Full.
    const nSku = s => (SHC.normalizaSku ? SHC.normalizaSku(s) : String(s || '').replace(/^\s*SKU[:\s]*/i, '').trim().toUpperCase());
    const unicos = a => a.filter((x, i) => x && a.indexOf(x) === i);
    const atribSku = attrs => ((Array.isArray(attrs) ? attrs : []).filter(a => a && a.id === 'SELLER_SKU')
        .map(a => a.value_name || (Array.isArray(a.values) && a.values[0] && a.values[0].name) || '').find(Boolean)) || '';
    /** Objeto no formato da API do ML (/items) → { sku, skus, fonte } na ordem da documentação. Sem SKU → sku ''. */
    SHC.skusDoItemML = function (o) {
        if (!o || typeof o !== 'object') return { sku: '', skus: [], fonte: '' };
        const vars = Array.isArray(o.variations) ? o.variations.filter(v => v && typeof v === 'object') : [];
        const doItem = nSku(atribSku(o.attributes) || o.seller_sku || '');
        const deVar = unicos(vars.map(v => nSku(atribSku(v.attributes) || v.seller_sku || '')));
        if (doItem) return { sku: doItem, skus: unicos([doItem].concat(deVar)), fonte: 'SELLER_SKU' };
        if (deVar.length) return { sku: deVar[0], skus: deVar, fonte: 'SELLER_SKU das variações' };
        const interno = unicos([nSku(o.seller_custom_field)].concat(vars.map(v => nSku(v.seller_custom_field))));
        return interno.length ? { sku: interno[0], skus: interno, fonte: 'seller_custom_field' } : { sku: '', skus: [], fonte: '' };
    };
    // SKU que a própria linha da lista traz: o texto da tela (product.sku) e, se um dia vier, o formato da API.
    const skuDaLinha = row => nSku((row.product || {}).sku || row.sku || '') || SHC.skusDoItemML(row.product).sku || SHC.skusDoItemML(row).sku;

    SHC.mlAnunciosDoEstado = function (r) {
        const vd = r && r.appProps && r.appProps.pageProps && r.appProps.pageProps.viewData;
        const out = [];
        const linhas = bloco => ((bloco && bloco.lines) || []).map(x => String((x && x.label) || ''));
        (function ler(rows, pai, paiUp) {
            (rows || []).forEach(row => {
                if (!row || typeof row !== 'object') return;
                const md = row.metadata || {}, prod = row.product || {};
                const up = String(md.userProductId || '');
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
                // SKU: o da linha; senão, na linha de dentro do MESMO user product, o do pai (os anúncios do UP dividem o SKU no ML).
                // Linha de dentro de OUTRO user product (família aberta) não herda. Anúncio com variações: o SKU vem das variações
                // abertas (innerRows) ou, depois, de outra tela do ML (SHC.completaSkus); skuForaDaLinha diz que a linha não o mostra.
                // "Expandir variações" = anúncio com variações; "Expandir anúncios" (entityType 'family') = família de anúncios, não variação.
                const expL = String((prod.expandable && prod.expandable.srLabel) || '');
                const variacoes = (+md.variationsQuantity || 0) > 0 || (!!prod.expandable && md.entityType !== 'family' && !/an[úu]ncio/i.test(expL));
                let sku = skuDaLinha(row), skuFonte = sku ? 'lista' : '';
                if (!sku && pai && up && up === paiUp && pai.sku) { sku = pai.sku; skuFonte = 'mesmo produto'; }
                if (pai && pai.variacoes && sku && pai.skus.indexOf(sku) < 0) pai.skus.push(sku);
                const item = {
                    itemId: String(md.itemId || ''), familia: String(md.userProductId || md.familyId || (pai && pai.familia) || ''),
                    // v3.2 (leitura completa 30/09/2026): família (familyId) e user product (MLBU…) separados — "familia" acima continua o de antes.
                    familyId: String(md.familyId || (pai && pai.familyId) || ''), userProductId: up,
                    sku, skus: sku ? [sku] : [], skuFonte, variacoes, skuForaDaLinha: !sku && (variacoes || (!!pai && !row.product)),
                    // Linha de dentro de uma linha aberta (innerRows) não tem 'product': o status vem do botão Pausar/Ativar (statusSwitch) ou do pai.
                    titulo: prod.title || (pai && pai.titulo) || '', tipo,
                    status: prod.status || (row.statusSwitch && typeof row.statusSwitch.checked === 'boolean' ? (row.statusSwitch.checked ? 'active' : 'paused') : '') || (pai && pai.status) || '',
                    preco, precoCheio: promo ? cheio : null, emPromocao: !!promo, tarifa, frete, freteDeduzido, recebe,
                    freteComprador, taxaOperacional,
                    atacado: precoL.some(t => /atacado/i.test(t)), estoque: (((prod.stock || [])[0]) || {}).label || '',
                    dentroDeFamilia: !!pai, catalogoML: md.catalog === true,   // v2.3: metadata.catalog (anúncio de catálogo)
                };
                Object.assign(item, competicaoDaLinha(row), logisticaDaLinha(row, condL));
                if (+md.variationsQuantity > 0) item.qtdVariacoes = +md.variationsQuantity;
                if (item.itemId) out.push(item);
                if (Array.isArray(row.innerRows)) ler(row.innerRows, item, up);
                // Variações abertas: o anúncio fica com os SKUs delas (o 1º é o "sku" do anúncio; todos em skus).
                if (!item.sku && item.skus.length) { item.sku = item.skus[0]; item.skuFonte = 'variações'; item.skuForaDaLinha = false; }
            });
        })(vd && vd.rows, null, '');
        return out;
    };

    /** Famílias de anúncios FECHADAS na lista (entityType 'family', innerRows null: os anúncios de dentro não vêm no HTML) → ['TR…'|'CA…']. */
    SHC.mlFamiliasFechadas = function (r) {
        const vd = r && r.appProps && r.appProps.pageProps && r.appProps.pageProps.viewData;
        return ((vd && vd.rows) || []).filter(x => x && x.metadata && x.metadata.entityType === 'family' && !Array.isArray(x.innerRows))
            .map(x => String(x.metadata.documentId || '')).filter(id => /^[A-Z]{2}\d+$/.test(id));
    };
    /** Família aberta: GET /anuncios/api/listing/row/expanded?id=TR… (o que o botão "Expandir anúncios" do ML chama; visto ao vivo
     *  30/09/2026) → { documentGroup: [linhas no formato da lista, cada uma com innerRows] } → itens de SHC.mlAnunciosDoEstado. */
    // pai (opcional) = item de SHC.mlParaAbrir: dentro da família o product.title é o NOME DA VARIAÇÃO ("Branco"); o título fica o do pai.
    SHC.mlAnunciosDaFamilia = function (j, pai) {
        const rows = j && Array.isArray(j.documentGroup) ? j.documentGroup : [], tit = String((pai && pai.titulo) || '');
        return SHC.mlAnunciosDoEstado({ appProps: { pageProps: { viewData: { rows } } } }).map(i => {
            const nome = tit && i.titulo && i.titulo !== tit ? i.titulo : '';
            // dentroDeFamilia fica o de SHC.mlAnunciosDoEstado (só as innerRows): marcar a linha principal faria P.anunciosReais esconder
            // o último anúncio sem preço da página anterior como se fosse "linha-mãe". A família está em familyId (e em snap.familias).
            return Object.assign(i, tit ? { titulo: tit } : {}, nome ? { nomeVariacao: nome.slice(0, 80) } : {},
                !i.familyId && pai && pai.familyId ? { familyId: pai.familyId } : {});
        });
    };
    /**
     * O que abrir numa página da lista (ao vivo 30/09/2026, MAPA-LEITURA-COMPLETA.md) → [{ id:'TR…', tipo:'familia'|'verMais', familyId, titulo, estoque, esperado }].
     *  família fechada: entityType 'family' e innerRows null → id = documentId, esperado = itemsQuantity;
     *  "Ver mais N opções de venda": linha 'item' com totalItemsQuantity (ou itemsQuantity) > 1 + innerRows → id = parentDocumentId.
     */
    SHC.mlParaAbrir = function (r) {
        const vd = r && r.appProps && r.appProps.pageProps && r.appProps.pageProps.viewData, out = [];
        ((vd && vd.rows) || []).forEach(x => {
            const md = (x && x.metadata) || {}, prod = x.product || {}, q = +md.totalItemsQuantity || +md.itemsQuantity || 0;
            const base = { familyId: String(md.familyId || ''), titulo: String(prod.title || ''), estoque: (((prod.stock || [])[0]) || {}).label || '', esperado: q };
            if (md.entityType === 'family' && !Array.isArray(x.innerRows) && /^[A-Z]{2}\d+$/.test(String(md.documentId || ''))) out.push(Object.assign({ id: String(md.documentId), tipo: 'familia' }, base));
            else if (md.entityType === 'item' && q > 1 + (Array.isArray(x.innerRows) ? x.innerRows.length : 0) && /^[A-Z]{2}\d+$/.test(String(md.parentDocumentId || '')))
                out.push(Object.assign({ id: String(md.parentDocumentId), tipo: 'verMais' }, base));
        });
        return out;
    };
    /** GET que o botão "Expandir anúncios"/"Ver mais" chama. Sem limit=50 o ML corta em 10 anúncios; page pagina (offset/size não). */
    SHC.mlUrlAbrir = (id, page) => '/anuncios/api/listing/row/expanded?filters=&sort=DEFAULT&search=&id=' + encodeURIComponent(id) + '&limit=50' + (page > 1 ? '&page=' + page : '');
    /**
     * Leitura completa da lista de Anúncios (todas as páginas + famílias fechadas + "Ver mais"), uma chamada de cada vez.
     * f = { ler(n) → {dados: SHC.mlPaginaAnuncios}|{falha}, abrir(id, page) → JSON | null, pausa() , progresso(o), maxPaginas }
     * → { itens, familias:[{id, tipo, familyId, titulo, estoque, esperado, itens:[MLB]}], paginas, total, linhas, conta, via, completo } | { falha }.
     * O total do ML conta LINHAS: completo = todas as linhas lidas E toda família/"Ver mais" aberta com os anúncios que ela diz ter.
     */
    SHC.mlLeituraCompleta = async function (f) {
        const itens = [], vistos = new Set(), chaves = new Set(), abrir = new Map(), familias = [];
        let paginas = 0, total = null, conta = null, via = '', completo = true, dePag = null;
        for (let n = 1; ; n++) {
            if (n > (f.maxPaginas || 80)) { completo = false; break; }
            const pag = await f.ler(n);
            if (pag.falha) { if (n === 1) return { falha: pag.falha }; completo = false; break; }
            const d = pag.dados || {}, lidos = Array.isArray(d.itens) ? d.itens : [];
            const ks = Array.isArray(d.chaves) ? d.chaves : lidos.map(i => i && i.itemId);
            if (n === 1) { total = typeof d.total === 'number' ? d.total : null; conta = d.conta || null; via = pag.via || ''; dePag = total !== null && ks.length ? Math.max(1, Math.ceil(total / ks.length)) : null; }
            // Página do meio sem linha nenhuma e sem total do ML: pode ser tela intermediária → leitura incompleta (só junta, não apaga).
            if (!ks.length && n > 1 && total === null) completo = false;
            // Fim = página sem LINHA nova (não "sem MLB novo": página só de famílias fechadas não tem MLB e não é o fim).
            const novas = ks.filter(k => k && !chaves.has(k));
            if (!novas.length) break;
            novas.forEach(k => chaves.add(k));
            lidos.forEach(i => { if (i && i.itemId) vistos.add(i.itemId); });
            itens.push(...lidos);
            (Array.isArray(d.paraAbrir) ? d.paraAbrir : []).forEach(x => { if (x && x.id && !abrir.has(x.id)) abrir.set(x.id, x); });
            paginas = n;
            if (f.progresso) await f.progresso({ paginasAnuncios: n, anuncios: vistos.size }, { feito: n, de: dePag, unidade: dePag ? 'páginas' : null });
            if (total !== null && chaves.size >= total) break;   // última página: não pede mais uma
            if (f.pausa) await f.pausa();
        }
        if (total !== null && chaves.size < total) completo = false;
        let k = 0, falhas = 0;
        for (const x of abrir.values()) {
            // 3 famílias seguidas sem resposta = o ML está recusando (429) ou a sessão caiu: para e fica parcial (só junta).
            if (falhas >= 3) { completo = false; break; }
            const ids = new Set();
            let ok = true;
            for (let p = 1; p <= 5; p++) {
                if (f.pausa) await f.pausa();
                const j = await f.abrir(x.id, p);
                if (!j || !Array.isArray(j.documentGroup)) { ok = false; break; }
                const its = SHC.mlAnunciosDaFamilia(j, x).filter(i => i.itemId), novos = its.filter(i => !ids.has(i.itemId));
                its.forEach(i => { ids.add(i.itemId); vistos.add(i.itemId); });
                itens.push(...its);
                if (!novos.length || ids.size >= x.esperado || j.documentGroup.length === 0) break;
            }
            falhas = ok ? 0 : falhas + 1;
            // Leitura parcial: só junta (nunca apaga MLB conhecido). Sem o itemsQuantity (esperado 0) ou sem anúncio nenhum, não dá para dizer que veio tudo.
            if (!ok || !(x.esperado > 0) || !ids.size || ids.size < x.esperado) completo = false;
            familias.push(Object.assign({}, x, { itens: [...ids] }));
            k++;
            if (f.progresso) await f.progresso({ anuncios: vistos.size, familiasAbertas: k }, { feito: k, de: abrir.size, unidade: 'famílias' });
        }
        return { itens, familias, paginas, total, linhas: chaves.size, conta, via, completo };
    };

    /**
     * SKUs que o Copiloto já leu em OUTRAS telas do ML, por anúncio → { MLB…: { skus:[…], fonte } }.
     *   vbAnuncio = vbAnuncio:<conta> (Métricas › vendas por anúncio: "SKU: 501361" de cada linha, também por variação);
     *   full      = ml:full:<conta> (Full: identifiers.sku de cada produto/variação com as publicações MLB).
     */
    SHC.skusConhecidos = function (o) {
        o = o || {};
        const out = {};
        const add = (id, s, fonte) => {
            id = String(id || ''); s = nSku(s);
            if (!/^MLB\d{6,14}$/.test(id) || !s) return;
            const e = out[id] || (out[id] = { skus: [], fonte });
            if (e.skus.indexOf(s) < 0) e.skus.push(s);
        };
        const vb = o.vbAnuncio || {}, it = vb.itens || {}, M = vb.meses || {};
        Object.keys(it).forEach(id => { const x = it[id] || {}; [x.sku].concat(Array.isArray(x.skus) ? x.skus : []).forEach(s => add(id, s, 'vendas')); });
        Object.keys(M).sort().reverse().forEach(m => { const pa = (M[m] || {}).porAnuncio || {}; Object.keys(pa).forEach(id => add(id, (pa[id] || {}).sku, 'vendas')); });
        (((o.full || {}).produtos) || []).forEach(p => { if (p && Array.isArray(p.itemIds)) p.itemIds.forEach(id => add(id, p.sku, 'full')); });
        // v3.2: Editor em massa (editor:<conta>) — a ÚNICA tela com o SKU de cada variação (resolve "SKU nas variações · ainda não lido").
        const ed = (o.editor && o.editor.porItem) || {};
        Object.keys(ed).forEach(id => { const x = ed[id] || {}; add(id, x.sku, 'editor'); (x.variacoes || []).forEach(v => add(id, v && v.sku, 'editor')); });
        // Ordem estável (alfabética): o ML pode entregar as linhas das variações em outra ordem a cada leitura, e o 1º SKU (it.sku)
        // não pode trocar sozinho entre uma sincronização e outra.
        Object.keys(out).forEach(id => out[id].skus.sort());
        return out;
    };

    /**
     * vbAnuncio.itens de leituras diferentes (mês a mês, ou o gravado × o lido agora) → um só, SEM perder SKU: os skus[] se somam.
     * novos = a leitura mais recente (vale o sku/título dela); base = a mais antiga. Não mexe nos objetos recebidos.
     */
    SHC.juntaItensVendas = function (base, novos) {
        const out = Object.assign({}, base || {});
        Object.keys(novos || {}).forEach(id => {
            const n = novos[id] || {}, o = out[id] || {};
            const skus = unicos([].concat(n.sku ? [n.sku] : [], Array.isArray(n.skus) ? n.skus : [], o.sku ? [o.sku] : [], Array.isArray(o.skus) ? o.skus : []));
            out[id] = Object.assign({}, o, n, { sku: n.sku || o.sku || '', titulo: n.titulo || o.titulo || '', skus });
        });
        return out;
    };

    /**
     * Completa o SKU vazio dos anúncios (a lista de Anúncios não mostra o de anúncio com variações). Ordem: o que o ML mostra em outra
     * tela (conhecidos = SHC.skusConhecidos) → o SKU já lido antes do MESMO anúncio (antes = itens do retrato anterior), este só quando a
     * linha não mostra SKU por formato (skuForaDaLinha): anúncio simples que veio sem SKU fica sem (o vendedor pode ter tirado).
     * As DUAS fontes só entram quando a linha não mostra SKU por formato (skuForaDaLinha): anúncio simples que a lista mostra SEM SKU
     * fica sem, mesmo que as vendas antigas tenham SKU (o vendedor pode ter tirado o SKU no ML).
     * Item que não muda volta o MESMO objeto.
     */
    SHC.completaSkus = function (itens, conhecidos, antes) {
        const velho = new Map();
        (antes || []).forEach(i => { if (i && i.itemId && i.sku) velho.set(i.itemId, i); });
        return (itens || []).map(it => {
            if (!it || typeof it !== 'object' || it.sku || !it.skuForaDaLinha) return it;
            const c = conhecidos && conhecidos[it.itemId];
            if (c && c.skus && c.skus.length) return Object.assign({}, it, { sku: c.skus[0], skus: c.skus.slice(), skuFonte: c.fonte || 'outra tela' });
            const v = it.skuForaDaLinha && velho.get(it.itemId);
            if (v) return Object.assign({}, it, { sku: v.sku, skus: (Array.isArray(v.skus) && v.skus.length ? v.skus : [v.sku]).slice(), skuFonte: v.skuFonte || 'leitura anterior' });
            return it;
        });
    };

    /**
     * Duas leituras do MESMO anúncio (linha da família e linha de dentro, ou a variação aberta): fica a 1ª COM preço (preço, tarifa, frete
     * e "você recebe" saem todos da mesma linha — nunca o preço de uma variação com a tarifa de outra), com os SKUs das duas.
     */
    SHC.juntaMesmoAnuncio = function (ja, novo) {
        if (!ja) return novo;
        const temPreco = x => x.preco !== null && x.preco !== undefined;
        const fica0 = temPreco(ja) || !temPreco(novo) ? ja : novo, outro = fica0 === ja ? novo : ja;
        // v3.2: o que só a outra leitura trouxe (linha da lista × família aberta) não se perde.
        const extra = {};
        ['nomeVariacao', 'familyId', 'userProductId', 'qtdVariacoes'].forEach(k => { if (!fica0[k] && outro[k]) extra[k] = outro[k]; });
        const fica = Object.keys(extra).length ? Object.assign({}, fica0, extra) : fica0;
        // SKUs na ordem da leitura (o 1º visto é o "sku" do anúncio: o da linha principal, depois as variações).
        const skus = unicos([].concat(ja.sku ? [ja.sku] : [], ja.skus || [], novo.sku ? [novo.sku] : [], novo.skus || []));
        if (!skus.length) return fica;
        const dono = ja.sku ? ja : novo;
        return Object.assign({}, fica, { sku: skus[0], skus, skuFonte: dono.skuFonte || 'lista', skuForaDaLinha: false });
    };

    /** Degraus de atacado (/anuncios/api/listing/tooltip?type=tiered_pricing) → [{ qtd, preco, revisar? }] em ordem.
     *  revisar: o ML marcou o degrau com badge "Com preços para revisar" (visto ao vivo 30/09/2026: degrau acima do preço da promoção). */
    SHC.mlAtacadoDoTooltip = function (j) {
        const pl = (j && j.data && j.data.priceList) || (j && j.priceList) || [];
        return (((pl[0] && pl[0].table) || [])
            .map(t => Object.assign({ qtd: parseInt(String(t.label || ''), 10), preco: SHC.valorRS(t.value) },
                /revis/i.test(String((t.badge && t.badge.srLabel) || '')) ? { revisar: true } : {}))
            .filter(t => t.qtd > 0 && t.preco > 0)
            .sort((a, b) => a.qtd - b.qtd));
    };
    /** Degraus vindos da aba (mensagem) → só { qtd inteiro 2..100, preco > 0, revisar? }, no máx. 5 (o ML aceita até 5), em ordem. */
    SHC.atacadoLimpo = d => (Array.isArray(d) ? d : [])
        .map(t => Object.assign({ qtd: Math.floor(SHC.num(t && t.qtd) || 0), preco: SHC.r2(SHC.num(t && t.preco) || 0) }, t && t.revisar ? { revisar: true } : {}))
        .filter(t => t.qtd >= 2 && t.qtd <= 100 && t.preco > 0).sort((a, b) => a.qtd - b.qtd).slice(0, 5);
    /**
     * Degrau de atacado sem lucro calculável, ou que não vale → { curto, txt, revisar? } | null. s = SHC.sobraAnuncio do anúncio | null.
     * Degrau igual ou acima do preço de hoje: o ML marca "Com preços para revisar" e o comprador não vê (visto ao vivo 30/09/2026).
     */
    SHC.atacadoAviso = function (it, g, s) {
        const m = SHC.moeda;
        if (g.revisar || (it.preco > 0 && g.preco >= it.preco)) return { revisar: true, curto: 'Revisar no ML', txt: 'O degrau (' + m(g.preco) + ') não fica abaixo do preço de hoje ('
            + m(it.preco) + (it.emPromocao ? ', o da promoção' : '') + '). O ML marca “Com preços para revisar” e o comprador não vê este preço. Corrija no ML.' };
        if (!(it.preco > 0) || it.recebe === null || it.recebe === undefined) return { curto: 'Lucro: abra a variação', txt: 'O ML não mostra um “Você recebe” único nesta linha (variações, família ou anúncio pausado). Sem ele não dá para calcular o lucro do degrau: abra a variação.' };
        if (it.tarifa === null || it.tarifa === undefined) return { curto: 'Sem a tarifa do ML', txt: 'O ML não mostrou a tarifa desta linha. Sem ela não dá para calcular o degrau.' };
        if (!s || s.sobra === null || s.sobra === undefined) return { curto: 'Informe o custo', txt: 'Informe o custo do produto (botão “＋ Informar custo” do anúncio) para ver o lucro de cada degrau.' };
        return null;
    };

    // Faixas de preço da tabela de custo de envio do ML (Central de Ajuda 40538: peso × faixa de preço; Clássico/Premium não mudam o frete).
    const FAIXAS_FRETE = [0, 19, 49, 79, 100, 120, 150, 200];
    /** preço → { i, de, ate|null } da faixa de frete do ML | null. */
    SHC.faixaFreteML = function (preco) {
        if (!(preco > 0)) return null;
        let i = FAIXAS_FRETE.length - 1;
        while (preco < FAIXAS_FRETE[i]) i--;
        return { i, de: FAIXAS_FRETE[i], ate: i + 1 < FAIXAS_FRETE.length ? FAIXAS_FRETE[i + 1] - 0.01 : null };
    };

    /** Sobra de 1 unidade de um anúncio no preço atual, com os números do ML (lista de Anúncios). */
    SHC.sobraAnuncio = function (item, custoDados, cfg) {
        cfg = Object.assign({}, SHC.PADRAO, cfg || {});
        if (!(item.preco > 0) || item.recebe == null) return null;   // null ou undefined: sem "Você recebe" único
        const custo = custoDados ? SHC.num(custoDados.custo) : null;
        const outros = custoDados ? (SHC.num(custoDados.outros) || 0) : 0;
        const imposto = SHC.r2(item.preco * (SHC.num(cfg.imposto_pct) || 0) / 100);
        if (!(custo > 0)) return { imposto, sobra: null, pct: null, classe: 'sem_custo' };
        const sobra = SHC.r2(item.recebe - custo - outros - imposto);
        const pct = sobra / item.preco * 100;
        const alvo = SHC.num(cfg.margem_alvo_pct) || 0;
        return { imposto, sobra, pct, custo, outros, classe: sobra < 0 ? 'prejuizo' : (pct < alvo ? 'apertado' : 'lucrativo') };
    };

    /**
     * Tarifa (fração do preço) para levar a OUTRO preço (degrau de atacado, preço para ganhar). Em promoção o ML pode cobrar tarifa reduzida
     * (visto ao vivo 30/09: Clássico do HA-14253 a 157,04 com 8% e os outros Clássicos do mesmo SKU com 12%); o atacado não é promoção.
     * → { taxa, reduzida }: reduzida = a % de hoje ficou abaixo da dos anúncios do mesmo SKU e tipo; usa a maior delas (conservador).
     */
    SHC.taxaTarifaFora = function (item, itens) {
        const propria = item.tarifa / item.preco, k = nSku(item.sku);
        if (!item.emPromocao || !k || !item.tipo) return { taxa: propria, reduzida: false };
        // ponytail: só anúncios a partir de R$ 79 (abaixo a tarifa traz o custo fixo e infla a %); 0,5 ponto de folga para arredondamento
        const outras = (itens || []).filter(i => i && i.itemId !== item.itemId && i.tipo === item.tipo && nSku(i.sku) === k && SHC.num(i.preco) >= 79 && SHC.num(i.tarifa) > 0)
            .map(i => i.tarifa / i.preco);
        const max = outras.length ? Math.max.apply(null, outras) : 0;
        return max > propria + 0.005 ? { taxa: max, reduzida: true } : { taxa: propria, reduzida: false };
    };

    /** Sobra por unidade num degrau de atacado: tarifa % do anúncio (SHC.taxaTarifaFora: sem a redução da promoção; itens = retrato),
     *  frete conservador (1 envio por peça) e, em "Envio por conta do comprador", o custo operacional do ML por unidade
     *  (visto ao vivo 25/09: R$ 8,75 num anúncio a R$ 68,44). */
    SHC.sobraAtacado = function (item, degrau, custoDados, cfg, itens) {
        cfg = Object.assign({}, SHC.PADRAO, cfg || {});
        const custo = custoDados ? SHC.num(custoDados.custo) : null;
        if (!(custo > 0) || !(item.preco > 0) || item.tarifa == null) return null;
        const outros = SHC.num(custoDados.outros) || 0;
        const tt = SHC.taxaTarifaFora(item, itens), taxa = tt.taxa;
        const tarifa = SHC.r2(degrau.preco * taxa), frete = item.freteComprador ? 0 : (item.frete || 0);
        const taxaOp = item.freteComprador && SHC.num(item.taxaOperacional) > 0 ? SHC.r2(SHC.num(item.taxaOperacional)) : 0;
        const imposto = SHC.r2(degrau.preco * (SHC.num(cfg.imposto_pct) || 0) / 100);
        const sobra = SHC.r2(degrau.preco - tarifa - frete - taxaOp - custo - outros - imposto);
        const pct = sobra / degrau.preco * 100;
        const alvo = SHC.num(cfg.margem_alvo_pct) || 0;
        // descontoPct: quanto o degrau desconta sobre o preço de venda de hoje (promoção incluída) — o ML define o degrau em %.
        const descontoPct = SHC.r2((1 - degrau.preco / item.preco) * 100);
        return { tarifa, taxaPct: taxa * 100, taxaReduzida: tt.reduzida, taxaHojePct: item.tarifa / item.preco * 100, frete, freteComprador: !!item.freteComprador, taxaOp, imposto, custo, outros, sobra, pct, descontoPct,
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
    // chaves = uma por LINHA da página (documentId ou MLB: o total do ML conta linhas); paraAbrir = famílias fechadas e "Ver mais" (SHC.mlParaAbrir).
    SHC.mlPaginaAnuncios = function (r) {
        const vd = r && r.appProps && r.appProps.pageProps && r.appProps.pageProps.viewData;
        const chaves = ((vd && vd.rows) || []).map(x => x && x.metadata && String(x.metadata.documentId || x.metadata.itemId || '')).filter(Boolean);
        return { itens: SHC.mlAnunciosDoEstado(r), total: SHC.mlTotalAnuncios(r), conta: SHC.mlContaDoEstado(r), chaves, paraAbrir: SHC.mlParaAbrir(r) };
    };

    // F20: resumo da etapa Anúncios no cartão da sincronização. O total do ML conta LINHAS (família fechada = 1 linha): "383 anúncios ·
    // li 155 de 155 linhas do ML"; leitura cortada → "… (leitura em parte)". Sem total do ML: só os anúncios.
    SHC.resumoLeituraAnuncios = function (snap) {
        const n = ((snap && snap.itens) || []).length, base = SHC.qtd(n, 'anúncio', 'anúncios'), t = snap && typeof snap.total === 'number' ? snap.total : null;
        if (t === null) return base;
        const l = typeof snap.linhas === 'number' ? snap.linhas : null;
        return base + ' · li ' + (l === null ? '' : l + ' de ') + SHC.qtd(t, 'linha', 'linhas') + ' do ML' + (snap.completo === false || (l !== null && l < t) ? ' (leitura em parte)' : '');
    };

    /**
     * Junta anúncios no retrato da conta: mesmo itemId → o novo substitui (no mesmo lugar); os outros ficam.
     * Na mesma leva, se o id vier repetido (linha da família e linha de dentro), fica o que tem preço.
     * Não mexe no retrato recebido: devolve um novo {ts, paginas, total, itens, …extra}.
     * SKU (30/09/2026): na mesma leva as duas leituras do mesmo id juntam os SKUs (SHC.juntaMesmoAnuncio); o SKU vazio é completado por
     * SHC.completaSkus com opc.conhecidos (outras telas do ML) e com o retrato anterior (opc.antes, ou o próprio snap) — assim uma
     * leitura sem SKU (linha de dentro, anúncio com variações) não apaga o SKU que o Copiloto já conhecia do mesmo anúncio.
     */
    SHC.mesclaAnuncios = function (snap, itens, extra, opc) {
        opc = opc || {};
        const novos = new Map();
        (itens || []).forEach(i => {
            if (!i || typeof i !== 'object' || !/^[A-Z]{2,5}\d{5,20}$/.test(String(i.itemId || ''))) return;
            const it = Object.assign({}, i, { itemId: String(i.itemId) });
            it.sku = nSku(it.sku);   // a aba pode não ter store.js: normaliza aqui
            if (Array.isArray(it.skus)) it.skus = unicos(it.skus.map(nSku));
            novos.set(it.itemId, SHC.juntaMesmoAnuncio(novos.get(it.itemId), it));
        });
        const anteriores = ((opc.antes || snap || {}).itens) || [];
        const completos = SHC.completaSkus([...novos.values()], opc.conhecidos, anteriores);
        completos.forEach(it => novos.set(it.itemId, it));
        // v3.2.0 (revisão 01/10/2026): leitura MAIS VELHA que a do retrato não substitui (aba aberta às 08h que volta à página 1 sem recarregar
        // manda o estado embutido das 08h, depois da sincronização das 10h) — sem isso vira "Saiu da promoção" falso. opc.lidoEm = quando a página
        // foi lida (padrão: agora); snap.lidoItem = { MLB: quando foi lido }. Retrato antigo sem lidoItem: aceita (como antes).
        const quando = typeof opc.lidoEm === 'number' && isFinite(opc.lidoEm) ? Math.min(opc.lidoEm, Date.now()) : Date.now();
        const lidoItem = Object.assign({}, snap && snap.lidoItem);
        novos.forEach((n, id) => { if ((lidoItem[id] || 0) > quando) novos.delete(id); else lidoItem[id] = quando; });
        const base = (snap && Array.isArray(snap.itens)) ? snap.itens : [];
        const out = base.map(i => { const n = i && novos.get(i.itemId); if (n) { novos.delete(i.itemId); return n; } return i; });
        novos.forEach(n => out.push(n));
        const noRetrato = new Set(out.map(i => i && i.itemId));
        Object.keys(lidoItem).forEach(id => { if (!noRetrato.has(id)) delete lidoItem[id]; });
        // v3.2: famílias (snap.familias, pai separado dos itens): a nova substitui a do mesmo id; as outras ficam (leitura parcial não apaga).
        // Nova lida pela metade (menos anúncios que o esperado: página 1 só, GET que falhou) junta os membros com os da antiga, não encolhe a lista.
        const famAnt = (snap && Array.isArray(snap.familias)) ? snap.familias : [];
        const fam = extra && Array.isArray(extra.familias)
            ? famAnt.filter(x => !extra.familias.some(y => y.id === x.id)).concat(extra.familias.map(y => {
                const a = famAnt.find(x => x.id === y.id), its = Array.isArray(y.itens) ? y.itens : [];
                return a && Array.isArray(a.itens) && its.length < (+y.esperado || 0) ? Object.assign({}, y, { itens: unicos(its.concat(a.itens)) }) : y;
            })) : null;
        return Object.assign({ paginas: 0, total: null }, snap || {}, extra || {}, fam ? { familias: fam } : {}, { ts: Date.now(), itens: out, lidoItem });
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
            // v3.1: "Tarifa de devolução por envio externo ou intermunicipal" (visto na fatura real) é o frete de VOLTA de uma devolução,
            // cobrado no mesmo pedido: não é o frete da venda. Antes caía em 'frete' e inflava o "cobrado a mais" (ex.: 20,75 + 46,49 = 67,24).
            const devolucao = /devolu[çc][ãa]o/i.test(texto);
            const tipo = devolucao ? (estorno ? 'devolucao_estorno' : 'devolucao')
                : estorno ? (envio ? 'frete_estorno' : vende ? 'venda_cancelada' : 'outro')
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
            // v3.4 (01/10, "todas as linhas têm que bater"): fatura = fechamento da fatura em que o ML lançou a cobrança (modalTrigger.documentCloseDate;
            // '' = o ML não mandou). notaCredito = cancelamento feito DEPOIS do fechamento (docType CREDIT_NOTE): o ML devolve nos pagamentos da
            // fatura anterior ("Cancelamentos de tarifas em estornos"), não na linha "Cancelamentos de tarifas". A data sozinha erra a fatura
            // (ao vivo: envios de 03 e 04/08 lançados na fatura que fecha 04/09).
            const fdoc = /^\d{4}-\d{2}-\d{2}/.test(String(mt.documentCloseDate || '')) ? String(mt.documentCloseDate).slice(0, 10) : '';
            out.push(Object.assign({ tipo, estorno, itemId: mlb ? 'MLB' + mlb[1] : '', orderId: ped ? ped[1] : '', data, dataRef: ref || data, valor, cheio, texto, origemPagamento,
                titulo: String(c.description_1 || '').replace(/\s+/g, ' ').trim().slice(0, 200),
                id: mt.entityId ? String(mt.entityId) + '|' + String(mt.conceptId || '') + '|' + String(mt.type || '') : '', fatura: fdoc },
                mt.docType === 'CREDIT_NOTE' ? { notaCredito: true } : {}));
        });
        out.brutas = lista.length;
        return out;
    };
    // v3.1: cobrança gravada antes da separação da devolução (cob:<conta>:<mês> da versão anterior) → o tipo que mlCobrancasDaResposta dá hoje.
    SHC.tipoDevolucao = c => (c && /devolu[çc][ãa]o/i.test(String(c.texto || '')) && !/^devolucao/.test(String(c.tipo || '')))
        ? Object.assign({}, c, { tipo: c.estorno ? 'devolucao_estorno' : 'devolucao' }) : c;

    // ── v3.3: detalhe da venda (/vendas/<pedido>/detalhe; mapa em tests/copiloto/_vendas_etiqueta/MAPA-VENDA.md) ──
    // Lê SÓ os grupos de valores (account_rows-*), o rótulo "Venda por publicidade" e a quantidade de cada produto. buyer_*, address_*,
    // billing_*, notes e account_title (nº do pagamento) nunca são lidos.
    // v3.4 (05/10): veio do ml-tela.js (o Fechamento e o painel conferem a tarifa cobrada no detalhe da venda) e lê a quantidade.
    const txtD = v => typeof v === 'string' ? v : (v && typeof v === 'object' ? String(v.text || v.label || v.title || '') : '');
    const rsSinal = t => { const s = txtD(t), n = SHC.valorRS(s); return n === null ? null : (/^\s*[-−]/.test(s) ? -n : n); };
    /** Estado do detalhe → { preco, tarifa, tarifaPct, acrescimo, frete, fretePagoComprador, cancelada, recebe, ads, pedidos, unidades } | null.
     *  unidades = soma de product_<pedido>_quantity ("2 unidades"); null quando a página não mostra a quantidade. */
    SHC.mlVendaDetalhe = function (r) {
        const pp = r && r.appProps && r.appProps.pageProps, resp = (pp && pp.response) || (r && r.response);
        if (!resp || typeof resp !== 'object') return null;
        const g = k => { const b = resp[k]; return b && typeof b === 'object' ? (b.data || b) : null; };
        const rows = b => (b && Array.isArray(b.rows) ? b.rows : []);
        const prod = g('account_rows-PRODUCT'), ch = g('account_rows-CHARGES'), su = g('account_rows-SURCHARGE'), sh = g('account_rows-SHIPMENT'), tot = g('account_rows-TOTAL');
        if (!prod || !tot) return null;
        const preco = rsSinal(prod.subTotal) !== null ? rsSinal(prod.subTotal) : SHC.r2(rows(prod).reduce((t, x) => t + (rsSinal(x.price) || 0), 0));
        const recebe = rows(tot).length ? rsSinal(rows(tot)[0].price) : rsSinal(tot.subTotal);
        if (!(preco > 0) || recebe === null) return null;
        const pctM = /(\d+(?:,\d+)?)\s*%/.exec(rows(ch).map(x => txtD(x.label)).join(' '));
        const acr = rows(su).find(x => /acr[eé]scimo/i.test(txtD(x.label)));
        const pagoC = rows(sh).find(x => /comprador/i.test(txtD(x.label)) && rsSinal(x.price) > 0);
        const ids = new Set(), ads = Object.keys(resp).some(k => {
            const m = /^product_(\d+)_title_description$/.exec(k);
            if (!m) return false;
            ids.add(m[1]);
            return !!txtD((g(k) || {}).advertisingLabel).trim();
        });
        let unidades = null;
        Object.keys(resp).forEach(k => {
            const m = /^product_(\d+)_/.exec(k);
            if (m) ids.add(m[1]);
            const q = /^product_\d+_quantity$/.test(k) ? parseInt(txtD((g(k) || {}).label || g(k)).replace(/\D+/g, ''), 10) : 0;
            if (q > 0) unidades = (unidades || 0) + q;
        });
        return { preco, tarifa: ch ? -(rsSinal(ch.subTotal) || 0) : 0, tarifaPct: pctM ? parseFloat(pctM[1].replace(',', '.')) : null,
            acrescimo: acr ? Math.abs(rsSinal(acr.price) || 0) : 0, frete: sh ? -(rsSinal(sh.subTotal) || 0) : 0, fretePagoComprador: pagoC ? rsSinal(pagoC.price) : 0,
            cancelada: !!g('account_rows-CANCELLATION'), recebe, ads, pedidos: ids.size, unidades };
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
            if (!c || c.itemId || !c.titulo || !/^(frete|venda|devolucao)/.test(c.tipo)) return c;   // v3.1: devolução também (frete de devoluções por anúncio)
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
    const diaMaisX = (d, n) => diaMenosX(d, -n);
    // Valor ≈ 2×, 3×… o de 1 unidade (±8%): pedido com várias unidades (mesma regra de SHC.fech.conferir).
    const variasUn = razao => { const k = Math.round(razao); return k >= 2 && Math.abs(razao - k) <= 0.08 * k; };
    const medianaX = xs => { const s = xs.slice().sort((a, b) => a - b), h = s.length >> 1; return !s.length ? null : (s.length % 2 ? s[h] : SHC.r2((s[h - 1] + s[h]) / 2)); };
    /**
     * Cobranças (SHC.mlCobrancasDaResposta, já sem repetição) → frete por pedido, somando todas as tarifas de envio do mesmo pedido:
     *   [{ pedido, itemId, data (1ª cobrança), cobrado (cobranças − estornos), cheio (antes do desconto do ML; ≥ cobrado), temExtra,
     *      formato: 'gratis' | 'compartilhado' | 'extra' (só envio extra, sem a tarifa principal) | 'cancelado', cancelado }]
     * Pedido só com estorno (a cobrança caiu fora do período lido) fica de fora.
     * v3.1: linhas = [{t: texto do ML, v: valor, d: dia, e: 1 se estorno}] (a conta linha a linha, igual ao detalhe da venda no ML).
     * A tarifa de devolução (frete de VOLTA) nunca entra aqui: é SHC.devolucoesDasCobrancas.
     */
    const linhaCob = c => (/estorno$/.test(c.tipo) ? { t: c.texto, v: c.valor, d: c.data, e: 1 } : { t: c.texto, v: c.valor, d: c.data });
    SHC.freteDasCobrancas = function (cobs) {
        const g = {};
        (cobs || []).forEach(c => {
            if (!c || !/^frete/.test(c.tipo) || !c.orderId || !(c.valor >= 0)) return;
            const p = g[c.orderId] || (g[c.orderId] = { pedido: c.orderId, itemId: '', data: '', cob: 0, est: 0, cheio: 0, gratis: false, compart: false, extra: false, linhas: [] });
            if (!p.itemId && c.itemId) p.itemId = c.itemId;
            if (p.linhas.length < 12) p.linhas.push(linhaCob(c));
            if (c.tipo === 'frete_estorno') { p.est = SHC.r2(p.est + c.valor); return; }
            p.cob = SHC.r2(p.cob + c.valor);
            p.cheio = SHC.r2(p.cheio + (c.cheio > c.valor ? c.cheio : c.valor));
            if (/extra ou intermunicipal/i.test(c.texto)) p.extra = true; else if (c.tipo === 'frete_parcial') p.compart = true; else p.gratis = true;
            if (c.data && (!p.data || c.data < p.data)) p.data = c.data;
        });
        return Object.keys(g).map(k => g[k]).filter(p => p.data && p.cob > 0).map(p => {
            const cancelado = p.est >= p.cob - 0.004, cobrado = cancelado ? 0 : SHC.r2(p.cob - p.est);
            return { pedido: p.pedido, itemId: p.itemId, data: p.data, cobrado, cheio: cancelado ? 0 : Math.max(cobrado, SHC.r2(p.cheio - p.est)), temExtra: p.extra,
                formato: cancelado ? 'cancelado' : p.compart ? 'compartilhado' : p.gratis ? 'gratis' : 'extra', cancelado, linhas: p.linhas };
        });
    };
    /**
     * v3.1: tarifa de devolução ("Tarifa de devolução por envio externo ou intermunicipal" = frete de VOLTA do produto devolvido) por pedido:
     * [{ pedido, itemId, data (1ª cobrança), valor (cobranças − estornos, ≥ 0), linhas }]. É custo do Fechamento ("Frete de devoluções"),
     * nunca "frete cobrado a mais": não se pede revisão dela.
     */
    SHC.devolucoesDasCobrancas = function (cobs) {
        const g = {};
        (cobs || []).forEach(c => {
            if (!c || !/^devolucao/.test(c.tipo) || !c.orderId || !(c.valor >= 0)) return;
            const p = g[c.orderId] || (g[c.orderId] = { pedido: c.orderId, itemId: '', data: '', valor: 0, linhas: [] });
            if (!p.itemId && c.itemId) p.itemId = c.itemId;
            if (p.linhas.length < 12) p.linhas.push(linhaCob(c));
            p.valor = SHC.r2(p.valor + (c.tipo === 'devolucao_estorno' ? -c.valor : c.valor));
            if (c.tipo === 'devolucao' && c.data && (!p.data || c.data < p.data)) p.data = c.data;
        });
        return Object.keys(g).map(k => g[k]).filter(p => p.data).map(p => Object.assign(p, { valor: Math.max(0, p.valor) }));
    };
    /**
     * Frete de devoluções dos últimos 30 dias (hoje incluso) e dos 30 anteriores. devs = SHC.devolucoesDasCobrancas (ou o guardado).
     * → { ult30: {pedidos, total}, ant30: {pedidos, total}, lista: [os 30 maiores dos últimos 30 dias] }
     */
    SHC.devolucoesResumo = function (devs, hoje) {
        const h = hoje || SHC.hoje(), ini30 = diaMenosX(h, 29), ini60 = diaMenosX(h, 59), r2 = SHC.r2;
        const out = { ult30: { pedidos: 0, total: 0 }, ant30: { pedidos: 0, total: 0 }, lista: [] };
        (devs || []).forEach(p => {
            if (!p || !p.data || p.data > h || !(p.valor > 0)) return;
            const b = p.data >= ini30 ? out.ult30 : p.data >= ini60 ? out.ant30 : null;
            if (!b) return;
            b.pedidos++; b.total = r2(b.total + p.valor);
            // v3.2: ida (frete de envio da mesma venda) e freteEstornado (o ML devolveu o frete do envio) vão junto para a contestação.
            if (b === out.ult30) out.lista.push(Object.assign({ pedido: p.pedido, itemId: p.itemId || '', data: p.data, valor: p.valor, linhas: p.linhas || null },
                p.ida > 0 ? { ida: p.ida } : {}, p.freteEstornado ? { freteEstornado: true } : {}));
        });
        out.lista = out.lista.sort((a, b) => b.valor - a.valor).slice(0, 30);
        return out;
    };

    // ── v3.2 (pedido da dona: "temos como questionar essa tarifa?"): cada tarifa de devolução × o que o pós-venda já leu. Só aponta e
    // deixa o texto pronto: quem abre o chamado é o seller, e quem decide se devolve é o ML (nunca prometer). Sem dado → 🟡, nunca inventado. ──
    const DEV_NAO_RESP = /n[ãa]o (foi|era|é|e) (sua|de sua|tua)?\s*responsabilidade|sem responsabilidade (sua|do vendedor)|n[ãa]o foi (sua )?culpa/i;
    const DEV_FOI_RESP = /(foi|é) (sua|de sua) responsabilidade/i;
    // Limite de palavra em "errad"/"usad" ("causado" não é "usado"); "tamanho" sozinho saiu (quase sempre é escolha do comprador).
    const DEV_CULPA = /defeit|n[ãa]o funcion|parou de funcionar|diferente|\berrad[oa]s?\b|descri[çc]|incomplet|\bfalt|\busad[oa]s?\b|vencid|falsific|n[ãa]o (é|e) original/i;
    const DEV_COMPRADOR = /\b(compr(ei|ou)|escolh(i|eu)|selecion(ei|ou))\b.*(\berrad|\btamanho)|\bpedi(u)? (o )?(tamanho|modelo|cor) errad/i;   // o comprador escolheu errado
    const DEV_ARREP = /arrepend|desist|mudou de ideia|n[ãa]o (quer|quero|gostou|gostei|precisa|precisou)|comprou por engano|n[ãa]o serviu/i;
    const DEV_TRANSP = /danific|embalage|amassad|quebrad|avari|extravi|transport|pacote sem|chegou (aberto|vazio)/i;
    SHC.DEV_COR = { verde: '🟢 dá para questionar', amarelo: '🟡 vale conferir', cinza: '⚪ foi sua responsabilidade' };
    /** posvenda:<conta> → { pedido: {motivo, afetouReputacao, situacao, descricao} } (porPedido; null = pós-venda nunca lido com o nº do pedido). */
    SHC.posvendaPorPedido = pv => (pv && pv.porPedido && typeof pv.porPedido === 'object' ? pv.porPedido : null);
    /** porPedido guardado + casos lidos agora (SHC.posvendaReclamacoesDoFlox) → o novo porPedido (o lido agora vale; até 300 pedidos, os mais novos) | null. */
    SHC.posvendaJuntaPorPedido = function (ant, casos) {
        const novo = {};
        (casos || []).forEach(c => {
            const k = String((c && c.pedido) || '').replace(/\D/g, '');
            if (k.length >= 6 && !novo[k]) novo[k] = { motivo: c.motivo || '', afetouReputacao: c.afetouReputacao === true ? true : c.afetouReputacao === false ? false : null, situacao: c.situacao || '', descricao: c.descricao || '' };
        });
        const velhos = ant && typeof ant === 'object' ? Object.keys(ant).filter(k => !novo[k]) : [];
        const out = {};
        Object.keys(novo).concat(velhos).slice(0, 300).forEach(k => { out[k] = novo[k] || ant[k]; });
        return Object.keys(out).length ? out : null;
    };
    // ── v3.3 Textos de contestação (pedido da dona 07/10/2026: "usar os termos técnicos para brigar com a IA do Mercado Livre e ser mais
    // efetivo nas respostas para remoção"). O atendimento do ML (e a IA que faz a triagem) resolve mais rápido quando o texto tem: assunto,
    // identificação (anúncio, SKU, pedidos), FATOS com números do próprio painel, a REGRA do ML que se aplica (título + link da Central) e um
    // PEDIDO explícito. Só fatos que o Copiloto leu; nada inventado, nada de "pode ser" virando certeza — a dúvida continua só perguntando.
    // Regras conferidas em 07/10/2026 (título e descrição oficiais; as páginas da Central pedem o aceite de cookies para mostrar o texto).
    SHC.REGRAS_ML = {
        frete_tabela: { titulo: 'Central de Ajuda, "Custos dos Envios no Mercado Livre": o custo é calculado pelo peso e pelas medidas do produto na embalagem final e pelo preço', url: 'https://www.mercadolivre.com.br/ajuda/40538' },
        frete_calculo: { titulo: 'Central de Ajuda, "Como calcular o custo de envio": peso físico × peso volumétrico da embalagem', url: 'https://www.mercadolivre.com.br/ajuda/Como-calcular-o-custo-dos-seus_4413' },
        devolucao: { titulo: 'Central de Ajuda, "Como funciona a devolução da minha venda?": condições de devolução, tarifa de devolução e impacto na reputação', url: 'https://www.mercadolivre.com.br/ajuda/devolucoes_3285' },
        exclusao: { titulo: 'Central de Vendedores, "Conheça as regras de exclusão de reclamações"', url: 'https://vendedores.mercadolivre.com.br/aprender/nota/conheca-as-regras-de-exclusao-de-reclamacoes-nuevo' },
        experiencia: { titulo: 'Central de Ajuda, "O que é a experiência de compra?": conta só os problemas de responsabilidade do vendedor', url: 'https://www.mercadolivre.com.br/ajuda/experiencia-de-compra_31968' },
        full_custos: { titulo: 'Central de Vendedores, "Quanto custa vender pelo Full"', url: 'https://vendedores.mercadolivre.com.br/nota/quanto-custa-vender-pelo-full' },
        full_antigo: { titulo: 'Central de Ajuda, "Quais são os custos por estoque antigo" (a partir de 4 meses no Full; 2 em Supermercado)', url: 'https://www.mercadolivre.com.br/ajuda/15731' },
    };
    /**
     * Modelo de contestação da dona (07/10/2026): "Assunto: Contestação de Cobrança Indevida de Frete – SKU – Pedido / Prezada equipe de suporte /
     * os dados / Solicitamos a revisão da cubagem, a correção para envios futuros e o estorno / Seguem em anexo as especificações e a nota fiscal".
     * o = { canal ('ml' padrão | 'shopee' | 'magalu'), assunto, ids:[[rótulo, valor]] (vão no assunto), intro, fatos:[frase], regras:[chave de SHC.REGRAS_ML],
     *       pedido (o que se solicita, sem o "Solicitamos"), anexos?:[o que anexar] } → texto. Sem emoji nem markdown: cola igual no chat, no e-mail e no WhatsApp.
     */
    const SUPORTE = { ml: 'do Mercado Livre', shopee: 'da Shopee', magalu: 'da Magalu' };
    SHC.textoContestacao = function (o) {
        const ids = (o.ids || []).filter(x => x && x[1] !== undefined && x[1] !== null && String(x[1]) !== '').map(x => x[0] + ': ' + x[1]);
        const l = ['Assunto: ' + o.assunto + (ids.length ? ' – ' + ids.join(' – ') : ''), '', 'Prezada equipe de suporte ' + (SUPORTE[o.canal] || SUPORTE.ml) + ','];
        if (o.intro) l.push('', o.intro);
        const fatos = (o.fatos || []).filter(Boolean);
        if (fatos.length) l.push('', 'Dados do meu painel:', ...fatos.map(f => '- ' + f));
        // Regras só do ML (as da Shopee e da Magalu entram quando houver a página oficial conferida).
        const regras = (!o.canal || o.canal === 'ml' ? o.regras || [] : []).map(k => SHC.REGRAS_ML[k]).filter(Boolean);
        if (regras.length) l.push('', 'Regra aplicável:', ...regras.map(r => '- ' + r.titulo + ' (' + r.url + ')'));
        l.push('', 'Solicitamos ' + o.pedido);
        if (o.anexos && o.anexos.length) l.push('', 'Seguem em anexo: ' + o.anexos.join(', ') + '.');
        l.push('', 'Atenciosamente.');
        return l.join('\n');
    };
    /** Texto do chamado de uma tarifa de devolução (pedido, data, valor, o motivo e a regra; pede o estorno do que não é do vendedor). */
    SHC.chamadoDevolucao = function (x) {
        const d = /^\d{4}-\d{2}-\d{2}/.test(x.data || '') ? x.data.slice(8, 10) + '/' + x.data.slice(5, 7) + '/' + x.data.slice(0, 4) : '—';
        // 🟡 (revisão 07/10/2026): sem certeza de quem foi a responsabilidade, o texto pergunta e pede o estorno só se ela não foi nossa.
        if (x.cor === 'amarelo') return SHC.textoContestacao({ assunto: 'Pedido de revisão de tarifa de devolução', ids: [['Pedido', '#' + x.pedido]],
            intro: 'Gostaríamos de entender por que esta tarifa de devolução (frete de volta do produto) foi cobrada de nós e se o valor está correto.',
            fatos: ['Data da cobrança: ' + d, 'Valor cobrado: ' + SHC.moeda(x.valor), x.porque ? 'O que observamos: ' + x.porque : ''],
            regras: ['devolucao'], pedido: 'a confirmação de quem foi a responsabilidade por esta devolução e, se ela não foi nossa, o estorno de ' + SHC.moeda(x.valor) + ' na nossa conta.' });
        const rep = x.recuperar > 0 && x.recuperar < x.valor;
        return SHC.textoContestacao({ assunto: 'Contestação de tarifa de devolução', ids: [['Pedido', '#' + x.pedido]],
            intro: 'Identificamos uma tarifa de devolução (frete de volta do produto) que não deveria ter sido cobrada de nós.',
            fatos: ['Data da cobrança: ' + d, 'Valor cobrado: ' + SHC.moeda(x.valor) + (rep ? ' (valor repetido: ' + SHC.moeda(x.recuperar) + ')' : ''), 'Por quê: ' + x.porque],
            regras: ['devolucao'], pedido: 'a revisão desta tarifa e o estorno de ' + SHC.moeda(x.recuperar > 0 ? x.recuperar : x.valor) + ' na nossa conta, por não ser de nossa responsabilidade.' });
    };
    // v3.3 Exclusão de reclamação: só os casos que as regras do ML aceitam analisar (Central de Vendedores, "Conheça as regras de exclusão de
    // reclamações", lida em 07/10/2026). Defeito, produto diferente, faltando peça, despacho atrasado por nós, falta de estoque, mensagem sem
    // resposta no prazo NÃO entram — o Copiloto nunca pede a retirada do que é responsabilidade do vendedor (black hat, nunca).
    // [núcleo do motivo, a regra do ML, o que o seller confere antes de enviar (o Copiloto não tem como saber), complementos neutros da regra].
    // Auditoria da loja (07/10/2026): erro na COMPRA ("comprei por engano", "comprei errado", "engano na compra") é arrependimento, não
    // "reclamação aberta por engano"; a do transporte exige demora/atraso explícitos (só "Correios" no motivo não basta).
    // Revisão do grupo g (07/10/2026): a trava por lista de palavras proibidas não fechava ("desisti, a tampa veio solta", "quero trocar o
    // modelo, não deu no meu gol", "a postagem atrasou e a entrega demorou" passavam). Agora é o contrário: o motivo só é excluível quando o
    // texto INTEIRO é o núcleo de uma regra + complementos neutros da lista fechada DELA + palavras de ligação. Qualquer outra oração deixa
    // o motivo sem regra (na dúvida, não marca). Os vetos continuam por cima. As regras rodam no texto sem acento e sem pontuação.
    const NAO = '\\b(?:n[ãa]o|naum|num|n)';   // "não", "nao", "naum", "num", "ñ" (sem acento vira "n")
    const LIG = '(?:o|a|os|as|um|uma|de|da|do|das|dos|em|no|na|nos|nas|pra|pro|para|pelo|pela|pelos|e|ja|so|muito|bem|demais|bastante|meu|minha|me|eu)';
    const NOMES = '(?:(?:o|a|os|as|d[oa]s?|n[oa]s?|est[ea]|ess[ea]|dest[ea]|dess[ea]|meu|minha) )?(?:produtos?|compras?|pedidos?|itens|item|mercadorias?|encomendas?|pacotes?)';
    const PEDE = '(?:(?:quero|queria|gostaria de|preciso|posso|vou|desejo|poderia) )?';
    const qualquer = (l, f) => new RegExp('\\b(?:' + [].concat(l).join('|') + ')\\b', f || 'i');   // [padrões] → regex de qualquer um, palavra inteira
    const QTD = '(?:\\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|quinze|vinte|trinta)';
    const TROCA = 'troc(?:ar|a|o|amos)(?: (?:de|o|a|por (?:um |uma )?outr[oa]|pel[oa]))? ';
    const EXCLUIVEL = [
        [qualquer(['arrepend\\w*', 'desist\\w*', NAO + ' (?:quero|quer|queria|desejo|vou querer) mais', 'mud(?:ou|ei|amos)(?: de)? ideia', 'engano (?:na|da) compra',
            'compr(?:ei|ou) (?:isso |isto |o produto |este produto |esse produto )?sem querer',
            // o erro do próprio comprador: o verbo e o erro com até 3 palavras entre eles, nenhuma de recebimento ("comprei mas chegou errado" é do vendedor)
            '(?:compr(?:ei|ou|a|amos)|escolh(?:i|eu)|selecion(?:ei|ou)|pedi(?:u)?)(?: (?!(?:chegou|chegaram|veio|vieram|recebi|recebeu|mand\\w*|envi\\w*|entreg\\w*|mas|porem|so|e|outr[oa]s?)\\b)\\S+){0,3}? (?:errad[oa]s?|por engano)']),
            'o comprador se arrependeu da compra e o produto está em perfeitas condições', 'o produto voltou sem uso e em perfeitas condições',
            ['ter (?:comprado|pedido|feito (?:a|essa|esta) compra)', NAO + ' (?:preciso|precisa|precisamos|precisava|vou precisar|vai precisar)(?: mais)?(?: (?:dele|dela|disso))?',
                '(?:achei|encontrei|vi)(?: (?:um|uma|o|a))?(?: (?:outr[oa]|igual|parecid[oa]|o mesmo|a mesma))?',
                'compr(?:ei|ou|amos)(?: (?:um|uma))? (?:outr[oa]|o mesmo|a mesma|igual|parecid[oa])(?: (?:modelo|marca|cor|produto|igual))?',
                '(?:em|n[ao]|de|d[ao]|num|numa) (?:um |uma )?(?:outr[oa] (?:anuncio|loja|site|lugar|vendedor|plataforma)|loja fisica|mercado|supermercado|shopping)',
                'mais barat[oa]|por menos|mais em conta|(?:com )?(?:preco|valor) (?:melhor|menor)|(?:com )?(?:melhor|menor) (?:preco|valor)', '(?:comprei |foi )?por impulso', '(?:fiquei )?sem (?:dinheiro|grana)',
                '(?:(?:o produto|a caixa|a embalagem|ele|ela) )?(?:(?:esta|ta|continua|segue|vai|volta|voltou|vai voltar|sera devolvid[oa]) )?(?:com (?:o )?lacre(?: intacto)?|lacrad[oa]|intact[oa]|na caixa(?: original)?|sem uso|sem abrir|em perfeitas condicoes|em perfeito estado)',
                'nem (?:abri|usei|cheguei a (?:abrir|usar)|tirei da caixa)(?: (?:a caixa|o produto|a embalagem|o pacote))?',
                '(?:(?:o produto|ele|ela) )?(?:nao|nunca|nem) (?:foi |esta |ta |chegou a ser )?(?:usad[oa]|utilizad[oa]|abert[oa]|instalad[oa])',
                PEDE + 'devolv(?:er|o|endo|i)(?: (?:o produto|ele|ela|a mercadoria))?', PEDE + '(?:o |meu )?(?:reembolso|estorno|dinheiro de volta)',
                NAO + ' (?:gostei|gostou|curti|me agradou|agradou)(?: d[aoe] (?:cor|modelo|estilo|formato|design|produto))?',
                NAO + ' combin(?:ou|a) com (?:o |a )?(?:meu |minha )?(?:sofa|decoracao|ambiente|casa|quarto|sala|cozinha|banheiro|estilo|roupa|look|moveis|movel|parede)',
                PEDE + 'troc(?:ar|a)(?: (?:de|o|a|por (?:um |uma )?outr[oa]))?(?: (?:tamanho|numero|numeracao|modelo|cor))?', '(?:ja )?receb(?:i|eu|emos)(?: (?:o produto|a encomenda|o pedido))?', NOMES]],
        // A reclamação aberta por engano é do COMPRADOR ("foi engano", "engano meu", "abri por engano"); "engano da loja", "engano deles" não entram.
        [qualquer(['foi (?:um |so )?engano', 'engano meu', 'meu engano',
            '(?:abri|abriu|iniciei|iniciou|cliquei|apertei|fiz|abrimos|criei|registrei)(?: (?:a|o|esta|essa|uma|um))?(?: (?:reclamacao|chamado|disputa|solicitacao))? (?:por engano|sem querer|errad[oa])']),
            'o comprador iniciou a reclamação por engano', 'a conversa mostra que a reclamação foi aberta por engano',
            ['(?:pode|podem|favor|por favor) (?:cancelar|encerrar|fechar|desconsiderar)(?: (?:a|esta|essa))?(?: reclamacao)?', '(?:a |esta |essa )?reclamacao',
                '(?:ja )?(?:recebi|chegou)(?: (?:o produto|o pedido))?(?: (?:certinho|certo|direitinho|bem|tudo certo))?', '(?:esta|ta|deu|foi) tudo (?:certo|ok|bem)', 'tudo (?:certo|ok)',
                'desculp(?:e|a|em|as)(?: (?:o|pelo) transtorno)?', '(?:nao (?:tem|teve|houve)|sem) (?:nenhum )?problemas?(?: nenhum)?', NOMES]],
        [qualquer([NAO + ' reconhe\\w*', NAO + ' (?:fiz|realizei|efetuei|autorizei) (?:esta|essa|a|nenhuma) compra']), 'o comprador não reconhece a compra', 'o pedido foi entregue no endereço da compra',
            // "não reconheço o PRODUTO" (o que chegou) não é "não reconheço a compra": produto fica de fora dos complementos
            ['(?:(?:esta|essa|a|o|este|esse|d[ao]|dest[ae]|dess[ae]) )?(?:compra|pedido|transacao|cobranca|venda)', 'nao fui eu(?: (?:que|quem) (?:comprei|fiz|comprou))?',
                '(?:alguem|outra pessoa) (?:comprou|usou|fez)(?: (?:com|n[ao]|usando) (?:minha|meu) (?:conta|cartao))?']],
        [qualquer('(?:aparece|aparecendo|consta|constando|marcad[oa]|esta|ta|diz|mostra|informa|registrad[oa])(?: ' + LIG + '){0,2} como entregue'),
            'o comprador não recebeu o produto, mas o envio aparece como entregue', 'o rastreio mostra a entrega',
            [NAO + ' (?:recebi|recebeu|recebemos|chegou|foi entregue|entregaram)(?: (?:o produto|nada|o pedido|a encomenda|o pacote))?',
                '(?:(?:o comprador|ele|ela|o cliente|a cliente) )?(?:diz|disse|alega|afirma|fala|falou|informa|informou|reclama) que ' + NAO + ' (?:recebeu|chegou)(?: (?:o produto|nada))?',
                '(?:n[oa] )?(?:rastreio|rastreamento|sistema|site|app|aplicativo)', NOMES]],
        // Transporte: só a entrega/chegada (Correios, transportadora). Despacho, postagem, preparo, "só saiu", loja: é do vendedor (fica sem regra).
        [qualquer(['(?:chegou|chegaram|chegando|entregue|entregaram|entregou|entregas?|chegada)(?: ' + LIG + '){0,2} (?:atrasad[oa]s?|com atraso|em atraso|tarde|depois do prazo|fora do prazo|apos o prazo|muito depois)',
            '(?:atras|demor)\\w*(?: ' + LIG + '){0,3} (?:entreg\\w*|cheg\\w*|correios?|transportador\\w*|transporte|mercado envios|frete)',
            '(?:entreg\\w*|chegada|correios?|transportador\\w*|transporte|mercado envios)(?: ' + LIG + '){0,2} (?:atras\\w*|demor\\w*)', 'passou (?:d[oa] )?(?:prazo|data) (?:de|da) entrega',
            '(?:chegou|chegaram|entregue|entregaram|entregou|entregas?|chegada)(?: ' + LIG + '){0,2} com (?:mais de |quase )?' + QTD + ' (?:dias?|semanas?) de atraso']),
            'a reclamação foi aberta pela demora do transporte, com o envio dentro do prazo estabelecido', 'você despachou dentro do prazo',
            // "postado no prazo" só sem negação antes ("não foi postado no prazo" é do vendedor)
            ['(?<!(?:nao|naum|num|\\bn|nem) (?:foi |ja foi )?)(?:o produto |o pedido |a encomenda |o pacote )?(?:foi |ja foi )?(?:enviad|postad|despachad|coletad)[oa]s? (?:no prazo|dentro do prazo|a tempo|em dia|no dia certo)',
                '(?:(?:ficou|esta|ta|estava|ficando) )?parad[oa] (?:n[oa]s? |em )?(?:correios?|agencia(?: dos correios)?|transportadora|centro de distribuicao|centro de tratamento|cd)',
                '(?:(?:os|o|a|pelos|pelo|pela|d[oa]s?|n[oa]s?) )?(?:correios?|transportadora|mercado envios|entregador|transporte|logistica)',
                '(?:(?:ha|faz|por|mais de|quase|uns|umas|em|com|apos|depois de) )?' + QTD + ' (?:dias?|semanas?|mes|meses)(?: (?:uteis|corridos))?(?: de atraso)?',
                '(?:(?:estou|to|tou|fiquei|fico|ainda|estava) )?(?:esperando|aguardando)(?: (?:a entrega|o produto|o pedido|a encomenda|chegar))?', '(?:(?:a|de|da|na|pela) )?(?:entregas?|chegada)(?: (?:previst[oa]|prometid[oa]|informad[oa]))?',
                NAO + ' (?:quero|queria) mais(?: esperar)?', 'desist\\w*', 'arrepend\\w*', PEDE + 'cancel(?:ar|amento)(?: (?:a compra|o pedido|da compra|do pedido))?', NOMES]],
        // Troca: só a troca pura, ou a de tamanho/número com o complemento de vestuário ("ficou pequeno", "não coube"). Qualquer outra oração
        // ("não deu no meu gol", "a rosca não bateu", "pedi 40 e veio 42") deixa o motivo sem regra.
        [qualquer(TROCA + '(?:tamanho|numero|numeracao)'), 'o comprador quer trocar por outro tamanho ou modelo (autopeças, vestuário, bolsas e calçados)',
            'o anúncio é de autopeças, vestuário, bolsas ou calçados e a troca é escolha do comprador (não medida, tabela ou compatibilidade errada no anúncio)',
            ['(?:(?:o|a|ele|ela) )?(?:ficou|ficaram)(?: (?:um pouco|muito|bem|meio))? (?:pequen[oa]s?|grandes?|apertad[oa]s?|larg[oa]s?|curt[oa]s?|comprid[oa]s?|just[oa]s?|folgad[oa]s?)',
                '(?:para|pra|por) (?:um |uma |o |a )?(?:maior|menor|(?:numero|tamanho|numeracao) (?:maior|menor|acima|abaixo)|outr[oa] (?:tamanho|numero|numeracao)|\\d{2}|pp|p|m|g|gg|xg|xgg|eg|egg)',
                NAO + ' (?:serviu|coube|cabe|vestiu|ficou bom|ficou boa)', NOMES]],
        [qualquer(TROCA + 'modelo'), 'o comprador quer trocar por outro tamanho ou modelo (autopeças, vestuário, bolsas e calçados)',
            'o anúncio é de autopeças, vestuário, bolsas ou calçados e a troca é escolha do comprador (não medida, tabela ou compatibilidade errada no anúncio)',
            ['(?:para|pra|por) (?:um |o )?outro(?: modelo)?', NOMES]],
        [qualquer(['meio de contato', 'so (?:queria|quero|gostaria de) (?:falar|perguntar|saber|tirar (?:uma )?duvida)', 'duvidas? sobre', '(?:tenho|era|e) (?:so )?uma duvida']),
            'o comprador usou a reclamação como meio de contato', 'a reclamação só trazia uma pergunta',
            ['(?:sobre )?(?:a |o )?(?:garantia|uso|instalacao|funcionamento|montagem|entrega|prazo de entrega|troca|devolucao|como usar)', NOMES]],
    ].map(([n, regra, confere, comp]) => [n, regra, confere, qualquer(comp, 'gi'), new RegExp(n.source, 'gi')]);
    // Palavras de ligação que podem sobrar depois do núcleo e dos complementos (nenhuma nega nem diz o que aconteceu: "não" nunca sobra).
    const LIGACAO = new Set(('e mas porem entao pois que o a os as um uma uns umas de da do das dos em no na nos nas por pra pro pras pros para com eu me meu minha meus minhas mim '
        + 'ja so ok ai isso isto pq porque q tb tambem agora ele ela se muito bem demais bastante mesmo realmente infelizmente sinceramente comprador compradora cliente '
        + 'quero queria gostaria preciso desejo poderia posso favor ola oi obrigado obrigada voce vc').split(' '));
    // Revisão 07/10/2026: "Me arrependi porque veio com defeito" ou "o vendedor não postou nos Correios" casavam com a 1ª regra parecida.
    // Culpa do vendedor no motivo (a mesma DEV_CULPA das devoluções, fora o erro do próprio comprador; despacho; envio errado; dano no
    // transporte; estoque) VETA antes de qualquer regra. "Não chegou" só entra quando o rastreio diz entregue.
    // 2ª revisão: despacho demorado ("demorou para postar") e mensagem sem resposta também são do vendedor; o engano do vendedor ("enviou por
    // engano", "engano no envio") veta, o do comprador ("foi engano", "engano na compra") não; "não foi usado"/"sem uso" é estado bom, não "usado".
    const EXCL_VETO = new RegExp([NAO + ' (despach|envi|post|mand)', 'enviad[oa] (por engano|errad)', 'envi(ou|aram) (por engano|errad|outr)', 'mand(ou|aram) (por engano|outr[oa]|errad)',
        'veio (outr[oa]|errad)', 'engano (no|do|de) (envio|despacho|separa|vendedor)', 'demor\\w*( \\S+){0,2} (para|pra|a|em) (despach|post|envi|mand|sair|respond)', 'atras\\w* n[oa] (despach|postag)',
        NAO + ' (me )?respond', 'sem resposta', 'estoque', '\\bquebr', 'danific', 'avari', 'amassad', 'extravi', 'r[ée]plica', 'pirat',
        // auditoria da loja: produto que não funcionou, item faltando na caixa, postagem atrasada, falsificado, manchado, pacote violado/aberto, não entregue
        NAO + ' funcion', 'sem (o|a|os|as) (manual|caixa|acess\\w*|pe[çc]as?|cabo|carregador|nota|etiqueta)', 'post\\w* (com atraso|tarde|atrasad)', 'vendedor (demor|atras)',
        'falsific', 'manchad', 'violad', '(chegou|veio|caixa|pacote|embalagem) (\\S+ )?abert', NAO + ' entreg',
        // rastreio 07/10: o que chegou não é o que foi comprado ("comprei mas chegou errado", "recebi o modelo trocado", "recebi por engano outro")
        '(veio|vieram|chegou|chegaram|recebi|recebeu|recebemos|mand(ou|aram)|envi(ou|aram)|entreg(ou|aram))( \\w+){0,3} (outr[oa]s?|errad|trocad|diferent)',
        // revisão do grupo g: o comprador diz o que pediu e o que chegou ("pedi 40 e veio 42", "mandaram 42 e eu pedi 40", "veio 220v")
        'pedi\\w*( \\w+){1,3} (e|mas) (eu )?(veio|vieram|chegou|chegaram|mand(ou|aram)|envi(ou|aram)|recebi)', '(veio|vieram|chegou|chegaram|mand(ou|aram)|envi(ou|aram)|recebi)( \\w+){1,3} (e |mas )?(eu )?(tinha )?pedi',
        '(veio|vieram|chegou|chegaram|mand(ou|aram)|envi(ou|aram)|recebi) (o |a |um |uma |numero |tamanho )?(\\d{1,3}|pp|p|m|g|gg|xg|xgg|eg|egg|bivolt|\\d{3} ?v(olts)?)\\b'].join('|'), 'i');
    // Rastreio 07/10/2026 (bloqueio 4): culpas do vendedor escritas de outro jeito passavam ("desisti, veio trincado", "despachou com atraso",
    // "não serviu no meu carro"). Trava por palavra, com e sem acento e gíria; na dúvida, NÃO é excluível. Roda no texto sem o erro do comprador
    // e sem os complementos neutros da regra ("lacre intacto", "outro anúncio mais barato", "postado no prazo" não vetam).
    const EXCL_CULPA = new RegExp([
        // estado do produto
        'trinc', 'rach(ad|ou|a\\b)', 'lascad', 'risc(ad|ou|os?\\b)', 'arranh', 'amass', 'estrag', 'pif(ou|ad)', 'queim(ou|ad)', 'derret', 'rasg', 'furad', '\\bfuros?\\b',
        'descasc', 'descol', 'desbot', 'manch', 'mof(o|ad)', 'bolor', 'molhad', '\\bumid(o|a|os|as|ade)\\b', 'encharc', 'vaz(and|ament|ou|ad|a\\b)', 'cheir', 'fedo', '\\bfede(\\b|nd)', '\\bodor',
        '\\bsuj(o|a|os|as|eira)\\b', 'encardid', 'enferruj', 'ferrug', 'oxid', 'podre', 'bichad', 'validade', 'deformad', 'empenad', '\\btort[oa]s?\\b', 'zoad', 'zuad', 'detonad',
        'qualidade', 'porcaria', '\\blixo\\b', 'vagabund', 'fajut', 'xing ?ling', 'paragua', 'mal feit', 'fragil|frageis', 'imitac', 'generic', NAO + ' original', 'recondicion', 'remanufat',
        'seminov', 'mostruario', 'lacre', '\\bvazi[oa]s?\\b', 'para(ou|do) de', 'deu (pau|problema|defeito|ruim)', '(com|tem|deu|apresent\\w*) problema', 'falh(a|ou|and)', 'barulh', 'ruido',
        'chiad', 'zumbid', 'superaquec', 'trav(ou|and)',
        NAO + ' (liga|ligou|acend|carreg|encaix|serv|cab(e|ia)|coub|ved|gel|esquent|aquec|conect|pare|le\\b|ler\\b|toc(a|ou)\\b|fech(a|ou)\\b|abr(e|iu)\\b|segur|aguent|prest|deu certo|bat(e|em)\\b|condiz|correspond|confere\\b)',
        NAO + ' (e|eh|era) (o|a|os|as) (que|mesm)',
        // diferente do anúncio, da foto ou do comprado
        'an[úu]nci', '\\bfotos?\\b', 'descrit', 'propaganda', 'engan(ava|ou|aram|os[oa]s?|acao)', 'nada a ver', 'tabela', 'trocad',
        '(cor|modelo|tamanho|voltagem|tensao|marca|numeracao|tecido|material|sabor|versao|tipo|medidas?) (e |eh |era |esta |ta |veio |vieram |ficou |totalmente |completamente |bem |muito )?(outr[oa]|errad|trocad|diferent)',
        'compr(ei|ou|amos)( \\w+){1,3} (e|mas) (veio|vieram|chegou|chegaram|recebi|recebeu|mandaram|mandou|enviaram|enviou)',
        '(veio|vieram|chegou|chegaram|recebi|mandaram|enviaram)( \\w+){0,2} (azul|vermelh|pret[oa]|branc|verde|amarel|rosa|cinza|marrom|bege|rox[oa]|laranja|dourad|pratead)',
        'reconhe\\w*( \\w+){0,3} (produto|item|peca|mercadoria|marca|embalagem|chegou|veio|recebi)',
        'engano (no|do|de|na|da) (envio|despacho|separa|vendedor|cor|modelo|tamanho|produto|item|peca|voltagem|quantidade|entrega)',
        // revisão do grupo g: o engano da loja não é do comprador
        'engano d[oa] (loja|empresa|lojista|vendedor\\w*)', 'engano del[ea]s?\\b', 'se engan(ou|aram)',
        'menos (unidades|pecas|itens|produtos)', 'quantidade (menor|errad|diferent)', '(so|somente|apenas) (veio|vieram|mandaram|mandou|enviaram|enviou|recebi) (um|uma|1|2|3|metade|parte|a caixa|o manual|a capa)\\b',
        '(veio|chegou|recebi|recebemos) sem', 'nota fiscal|\\bnfe?\\b|sem nota', 'sem garantia|' + NAO + ' (tem|tinha|veio com|deram|da|dao|cobre) garantia|garantia (negada|recusada)',
        // autopeças: veículo incompatível é do anúncio (a compatibilidade é do vendedor); revisão do grupo g: ano, furação, rosca, "não deu no meu gol"
        'carro', 'veicul', '\\bmotos?\\b', 'motocicleta', 'caminh(ao|oes|onete)', 'onibus', 'trator', 'automovel', 'compat', 'aplicac',
        '\\banos?\\b', '\\bbat(e|eu|eram|em)\\b', '\\bentr(a|ou|am|aram)\\b', 'furac', 'rosca', NAO + ' (deu|e|eh|era|serve|serviu) (n[oa]|pr[oa]|d[oa]) (meu|minha)',
        // vendedor e despacho (demora do vendedor não é demora do transporte); revisão do grupo g: em qualquer ordem, preparo, "só saiu", loja
        'vendedor', 'lojista', 'cancel(ou|aram)\\b', 'ignor(ou|aram)', NAO + ' (me )?(atend|retorn|ajud)', 'ningu[eé]m (me )?(respond|atend|retorn)', 'sumiu',
        '(despach|post|envi|mand|separ|fatur|emit)\\w*( \\w+){0,3} (com atraso|atrasad|tarde|depois do prazo|fora do prazo|apos o prazo|em atraso|com demora|so depois|dias depois)',
        '(atras|demor)\\w*( \\w+){0,3} (despach|post|envi|mand|separ|fatur|emit|colet|sair)', NAO + ' foi (despach|post|envi|mand|separ|colet|fatur)',
        'ainda ' + NAO + ' (saiu|foi|despach|post|envi)', '(so|somente|apenas) (despach|post|envi|mand)', 'sem (rastr|codigo)',
        'despach', 'postag', 'postad', 'prepar', '\\bsepar', '\\bsaiu\\b', '\\bsair\\b', '\\bloja\\b', 'segur(ou|aram|ando|ei)\\b'].join('|'), 'i');
    const BOM_ESTADO = /(n[ãa]o (foi |era |est[áa] |esta )?|nunca (foi )?|nem )usad[oa]s?|sem uso/gi;
    // O erro do PRÓPRIO comprador sai do texto antes de procurar culpa do vendedor (antes ele anulava o veto inteiro: "comprei errado e veio
    // com defeito" pedia exclusão). Trecho curto: o verbo e o erro com até 3 palavras entre eles — nenhuma delas de recebimento ("comprei mas
    // chegou errado" é culpa do vendedor, não do comprador).
    const TRECHO_COMPRADOR = /\b(compr(ei|ou|a)|escolh(i|eu)|selecion(ei|ou)|pedi(u)?)\b(\s+(?!(chegou|chegaram|veio|vieram|recebi|recebeu|mand\w*|envi\w*|entreg\w*|mas|porem|so|e)\b)\S+){0,3}?\s+(errad[oa]s?|por engano)/gi;
    const semComprador = t => String(t || '').replace(BOM_ESTADO, ' ').replace(TRECHO_COMPRADOR, ' ');
    // Sem acento, sem pontuação e minúsculo: "Não", "nao" e "ñ" caem nas mesmas regras.
    const semAcento = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    const excluivel = t => {
        const s = semAcento(t);
        if (!s || new RegExp(NAO + ' (chegou|recebi|recebeu|foi entregue)', 'i').test(s) && !EXCLUIVEL[3][0].test(s)) return null;
        for (const x of EXCLUIVEL) {
            if (!x[0].test(s)) continue;
            const sobra = s.replace(x[4], ' ').replace(x[3], ' ').split(' ').filter(p => p && !LIGACAO.has(p));
            if (sobra.length) continue;   // sobrou oração que não é desta regra: na dúvida, não marca
            const semC = s.replace(x[3], ' '), sc = semComprador(semC);   // os vetos olham o núcleo e o que não é complemento neutro
            return DEV_CULPA.test(sc) || EXCL_CULPA.test(sc) || EXCL_VETO.test(semC) ? null : x;
        }
        return null;
    };
    /** Motivo do comprador → a regra de exclusão do ML em que ele se encaixa ('' = não é excluível: corrija a causa). */
    SHC.motivoExcluivel = t => { const x = excluivel(t); return x ? x[1] : ''; };
    /** O que o seller confere antes de mandar o pedido de exclusão desse motivo ('' = não é excluível). */
    SHC.confereExclusao = t => { const x = excluivel(t); return x ? x[2] : ''; };
    /**
     * Rastreio 07/10/2026 (R10): situação da reclamação (detail-title do pós-venda) → true com mediação aberta com o ML. A regra de exclusão
     * do ML não analisa reclamação em mediação: ela fica fora do pedido. Na dúvida (o ML analisando/decidindo), também fica fora.
     */
    SHC.emMediacao = s => /mediac|mediand|mediad|mediar\b|disputa|interv(ir|em|eio|indo|enc)|pediu ajuda|ajuda (a|ao|do) mercado livre|mercado livre (esta )?(analis|avali|decid|vai decid)|(decisao|analise) do mercado livre/
        .test(semAcento(s));
    /**
     * Pedido de exclusão (reputação e experiência de compra) para os casos com um motivo excluível. g = { motivo, casos, naReputacao,
     * produtos?:[{sku, titulo} | 'título'], pedidos?:[nº] } (P.grupoExclusao monta no painel, já sem os casos em mediação).
     * '' quando o motivo não está nas regras de exclusão.
     */
    SHC.chamadoExclusao = function (g) {
        const regra = g && SHC.motivoExcluivel(g.motivo);
        if (!regra) return '';
        // Auditoria da loja (07/10/2026): pede a ANÁLISE de cada pedido (com o número) e a exclusão só dos que se enquadrarem — nunca afirma
        // que todos se enquadram nem o estado do produto de cada um (quem confere é o seller: SHC.confereExclusao).
        const peds = (g.pedidos || []).filter(Boolean).slice(0, 20);
        // Rastreio 07/10 (R10): o produto vai com o SKU quando o Copiloto sabe; um SKU só vai também no assunto (modelo da dona: "– SKU – Pedido").
        const ps = (g.produtos || []).filter(Boolean).map(p => (typeof p === 'object' ? p : { titulo: String(p) }));
        const prods = ps.map(p => (p.sku ? 'SKU ' + p.sku + (p.titulo ? ' (' + p.titulo + ')' : '') : p.titulo || '')).filter(Boolean);
        const skus = [...new Set(ps.map(p => p.sku).filter(Boolean))], sku = skus.length === 1 && ps.every(p => p.sku) ? skus[0] : '';
        return SHC.textoContestacao({ assunto: 'Pedido de análise de reclamações para exclusão da reputação', ids: [['SKU', sku], ['Pedido', peds.length === 1 ? '#' + peds[0] : '']],
            intro: 'Recebemos reclamações cujo motivo pode se enquadrar nas regras de exclusão do Mercado Livre. Pedimos a análise de cada pedido abaixo.',
            fatos: ['Motivo informado pelo comprador: “' + String(g.motivo).slice(0, 120) + '” (' + SHC.qtd(g.casos || 0, 'caso', 'casos') + (g.naReputacao ? ', ' + g.naReputacao + ' contando na reputação' : '') + ').',
                'Regra de exclusão em que pode se enquadrar: ' + regra + '.', prods.length ? 'Produtos: ' + prods.slice(0, 5).join('; ') + (prods.length > 5 ? ' e mais ' + (prods.length - 5) : '') + '.' : '',
                peds.length > 1 ? 'Pedidos: ' + peds.map(n => '#' + n).join(', ') + '.' : ''],
            regras: ['exclusao', 'experiencia'],
            pedido: 'a análise de ' + (peds.length > 1 ? 'cada pedido acima' : peds.length ? 'este pedido' : 'cada caso') + ' e, ' + (peds.length > 1 ? 'nos que se enquadrarem' : 'se ele se enquadrar') + ', a exclusão da reclamação do cálculo da nossa reputação e da experiência de compra dos anúncios (Métricas › Atendimento aos seus compradores › Vendas com problemas).' });
    };
    /**
     * v3.3 Remessa do Full com inconformidade (SHC.remessasInconformes) → texto da reclamação por diferenças, produto a produto.
     * Rastreio 07/10/2026 (bloqueio 4, regra da local): sem o detalhe por produto não sai texto ('') — na lista do Full o units_count conta
     * PRODUTOS, não unidades, e "declaradas 3; disponíveis 2" seria uma reclamação firme com número que o Copiloto não leu.
     * Revisão do grupo g: o detalhe lido sem as quantidades por produto (declaredQuantity/processedQuantity, formato A CONFIRMAR) também não
     * gera texto — os totais da remessa voltariam a ser os da lista. Os totais só entram quando os produtos trazem declaradas E aptas.
     */
    SHC.chamadoRemessa = function (r) {
        if (!r || !r.id || r.semDetalhe || !(r.produtos || []).length) return '';
        const temQtd = k => r.produtos.some(p => p && typeof p[k] === 'number');
        if (!temQtd('declaradas') && !temQtd('processadas')) return '';
        const n = v => (typeof v === 'number' ? String(v) : '—'), dt = x => (/^\d{4}-\d{2}-\d{2}/.test(String(x || '')) ? x.slice(8, 10) + '/' + x.slice(5, 7) + '/' + x.slice(0, 4) : '');
        const ps = (r.produtos || []).filter(p => p && ((p.diferencas || 0) !== 0 || (p.naoAptas || 0) > 0));
        const fatos = ps.slice(0, 15).map(p => (p.sku ? 'SKU ' + p.sku : p.itemId || 'produto') + (p.itemId && p.sku ? ' (' + p.itemId + ')' : '') + ': declaradas ' + n(p.declaradas)
            + ', processadas ' + n(p.processadas) + (p.naoAptas ? ', não aptas ' + p.naoAptas : '') + (p.resultado ? ' — ' + p.resultado : '') + '.');
        // 3.3.0 (juntada com a nuvem): sem o detalhe por produto não há texto. Sem detalhe, "declaradas" vem do units_count da lista, que conta
        // PRODUTOS, e "aptas" conta unidades (leitura ao vivo de 06/10).
        if (!ps.length) return '';
        // Auditoria da loja (07/10/2026) e regra da dona: r.custo é o total_charged da remessa = coleta e/ou penalidade — nunca "multa" nem
        // "cobrado pela inconformidade". Só unidade não apta (sem diferença de contagem) não é erro de contagem: pode ter vindo do nosso preparo.
        if (r.custo) fatos.push('Total cobrado pelo Mercado Livre nesta remessa (coleta e/ou penalidade): ' + SHC.moeda(r.custo) + '.');
        if (r.prazo) fatos.push('Prazo para reclamar informado pelo ML: ' + dt(r.prazo) + '.');
        const contagem = ps.some(p => (p.diferencas || 0) !== 0);   // só com o detalhe por produto (sem ele já saiu acima)
        const naoAptas = ps.reduce((s, p) => s + (p.naoAptas || 0), 0), quando = r.quando ? ' (' + dt(r.quando) + ')' : '';
        return SHC.textoContestacao({ assunto: contagem ? 'Reclamação por diferenças na remessa do Full' : 'Pedido de revisão de unidades não aptas na remessa do Full', ids: [['Remessa', '#' + r.id]],
            intro: contagem ? 'A remessa foi recebida com diferença entre as unidades que declaramos e as que o centro de distribuição processou' + quando + '.'
                : 'No processamento da remessa' + quando + ', ' + (naoAptas ? SHC.qtd(naoAptas, 'unidade foi considerada', 'unidades foram consideradas') : 'unidades foram consideradas') + ' não aptas para venda.',
            fatos, regras: ['full_custos'], anexos: contagem ? ['nota fiscal da remessa', 'etiquetas e romaneio das caixas', 'fotos das caixas fechadas antes da coleta'] : ['nota fiscal da remessa', 'fotos das unidades e das etiquetas antes da coleta'],
            pedido: contagem ? 'a recontagem e a conferência das unidades desta remessa, o ajuste do estoque disponível para venda e, se a diferença se confirmar, o estorno do que foi cobrado por ela.'
                : 'o motivo de cada unidade considerada não apta e, se a inaptidão não decorreu do nosso preparo, o ajuste do estoque disponível para venda e o estorno do que foi cobrado por ela.' });
    };
    /**
     * v3.3 Experiência de compra (SHC.mlExperienciaCompra) → pedido de revisão, SÓ com casos excluíveis (casos = [{pedido, motivo}]).
     * Sem caso excluível: '' (o caminho é corrigir a causa; o alerta já diz qual).
     */
    SHC.chamadoExperiencia = function (x, casos) {
        const ok = (casos || []).filter(c => c && SHC.motivoExcluivel(c.motivo));
        if (!x || !ok.length) return '';
        const p0 = (x.problemas || [])[0];
        return SHC.textoContestacao({ assunto: 'Revisão da experiência de compra do anúncio', ids: [[x.up ? 'Produto' : 'Anúncio', x.id]],
            intro: 'A experiência de compra deste anúncio caiu por casos que se enquadram nas regras de exclusão do Mercado Livre, e o anúncio está perdendo exposição.',
            fatos: ['Nota atual: ' + (x.nota === null ? '—' : x.nota + ' de 100') + ' (' + x.faixa + ')' + (x.de && x.ate ? ', período de ' + x.de.split('-').reverse().join('/') + ' a ' + x.ate.split('-').reverse().join('/') : '') + '.',
                p0 && p0.titulo ? 'Problema principal apontado: ' + p0.titulo + (p0.qtd ? ' (' + SHC.qtd(p0.qtd, 'caso', 'casos') + ')' : '') + '.' : '',
                ...ok.slice(0, 15).map(c => 'Pedido #' + c.pedido + ': ' + SHC.motivoExcluivel(c.motivo) + '.')],
            regras: ['experiencia', 'exclusao'],
            pedido: 'a análise dos pedidos acima, a retirada deles do cálculo da experiência de compra e da reputação e a reavaliação da exposição do anúncio.' });
    };
    /**
     * devs = lista de SHC.devolucoesResumo (ou SHC.devolucoesDasCobrancas): [{pedido, itemId, data, valor, linhas?, ida?, freteEstornado?}];
     * porPedido = SHC.posvendaPorPedido(posvenda:<conta>) (null = não lido).
     * → { itens:[{pedido, itemId, data, valor, cor:'verde'|'amarelo'|'cinza', regra, motivo (1 frase), recuperar (R$; 0 no cinza), texto ('' no cinza)}],
     *     verde:{n, valor}, amarelo:{n, valor}, cinza:{n, valor} }  (verde primeiro, depois amarelo e cinza; maior valor primeiro)
     * 🟢 cobrança repetida no mesmo pedido · o ML disse que não foi sua responsabilidade · arrependimento do comprador.
     * ⚪ o ML marcou na reputação / disse que foi sua responsabilidade · defeito, produto diferente/errado, descrição, faltando.
     * 🟡 motivo que pode ser do transporte ou não diz de quem foi · venda cancelada com o frete estornado e esta tarifa não ·
     *    valor mais que o dobro do envio da venda (ou do normal das devoluções) · sem dado do pós-venda para decidir.
     */
    // soPrimeira (F12): o pós-venda tem mais de 1 página e o Copiloto lê só a 1ª — pedido sem dado diz isso, não "sem dado".
    SHC.devolucoesContestar = function (devs, porPedido, soPrimeira) {
        const r2 = SHC.r2, m = v => SHC.moeda(v), lista = (devs || []).filter(p => p && p.pedido && p.valor > 0);
        const vals = lista.map(p => p.valor);
        const out = { itens: [], verde: { n: 0, valor: 0 }, amarelo: { n: 0, valor: 0 }, cinza: { n: 0, valor: 0 } };
        lista.forEach((p, i) => {
            const outros = vals.filter((_, j) => j !== i), tipico = outros.length >= 4 ? medianaX(outros) : null;
            const cobs = (p.linhas || []).filter(l => l && !l.e && l.v > 0), x = porPedido ? porPedido[p.pedido] : null;
            const mot = x && x.motivo ? String(x.motivo).slice(0, 80) : '', resp = x ? [x.situacao, x.descricao].filter(Boolean).join(' ') : '';
            let cor, regra, motivo, porque, recuperar = p.valor;
            // Repetida: 2+ tarifas de devolução do mesmo valor no pedido (sem estorno que as cancele): o que passa da 1ª.
            const rep = cobs.length >= 2 && cobs.every(l => Math.abs(l.v - cobs[0].v) < 0.01) ? r2(p.valor - cobs[0].v) : 0;
            if (rep >= 1) {
                // n = as vezes que continuam cobradas (um estorno já devolvido não entra no texto).
                const n = Math.max(2, Math.round(p.valor / cobs[0].v)), est = cobs.length - n;
                cor = 'verde'; regra = 'repetida'; recuperar = rep;
                motivo = 'A tarifa foi cobrada ' + n + ' vezes no mesmo pedido.';
                porque = 'A mesma tarifa de devolução aparece ' + n + ' vezes neste pedido (' + cobs.slice(0, n).map(l => m(l.v)).join(' + ') + ')'
                    + (est > 0 ? ', já descontado ' + (est === 1 ? '1 estorno' : est + ' estornos') : '') + '.';
            } else if (x && DEV_NAO_RESP.test(resp)) {
                cor = 'verde'; regra = 'nao_resp';
                motivo = 'O ML disse no pós-venda que não foi sua responsabilidade.';
                porque = 'No pós-venda, o Mercado Livre informou que a devolução não foi de minha responsabilidade.';
            } else if (x && (x.afetouReputacao === true || DEV_FOI_RESP.test(resp))) {
                cor = 'cinza'; regra = 'sua_resp';
                motivo = 'O ML contou esta devolução na sua reputação: a tarifa costuma ficar com você.';
            } else if (mot && DEV_CULPA.test(semComprador(mot)) && !DEV_TRANSP.test(mot) && !(DEV_ARREP.test(mot) || DEV_COMPRADOR.test(mot))) {   // a transportadora vence
                cor = 'cinza'; regra = 'motivo';
                motivo = 'Voltou por “' + mot + '”: costuma ser responsabilidade do vendedor.';
            } else if (mot && DEV_CULPA.test(semComprador(mot)) && !DEV_TRANSP.test(mot)) {
                // Auditoria da loja: erro do comprador E problema do produto no mesmo motivo ("comprei errado e veio com defeito") — antes virava
                // arrependimento com contestação firme. Agora é 🟡: o texto pergunta e pede o estorno só se a responsabilidade não foi nossa.
                cor = 'amarelo'; regra = 'motivo_misto';
                motivo = 'O motivo (“' + mot + '”) cita erro do comprador e também um problema no produto: vale conferir.';
                porque = 'O motivo informado foi “' + mot + '”, que cita erro do comprador e também um problema no produto.';
            } else if (mot && (DEV_ARREP.test(mot) || DEV_COMPRADOR.test(mot))) {
                cor = 'verde'; regra = 'arrependimento';
                motivo = 'Voltou por arrependimento do comprador (“' + mot + '”), não por erro seu.';
                porque = 'O motivo informado na devolução foi “' + mot + '” (arrependimento do comprador).';
            } else if (mot && DEV_TRANSP.test(mot)) {
                cor = 'amarelo'; regra = 'transporte';
                motivo = 'Voltou por “' + mot + '”: pode ter sido no transporte.';
                porque = 'O motivo informado foi “' + mot + '”, que pode ter acontecido no transporte.';
            } else if (p.freteEstornado) {
                cor = 'amarelo'; regra = 'cancelada';
                motivo = 'A venda foi cancelada (o frete do envio voltou) e esta tarifa não.';
                porque = 'A venda foi cancelada e o frete do envio foi estornado, mas esta tarifa de devolução não.';
            } else if ((p.ida > 0 && p.valor > 2 * p.ida && p.valor - p.ida >= 5) || (tipico > 0 && p.valor > 2 * tipico && p.valor - tipico >= 5)) {
                const base = p.ida > 0 && p.valor > 2 * p.ida ? 'o envio da venda (' + m(p.ida) + ')' : 'o normal das suas devoluções (' + m(tipico) + ')';
                cor = 'amarelo'; regra = 'valor';
                motivo = 'Custou mais que o dobro d' + base + (x ? '.' : ', e não há dado do pós-venda para decidir.');   // "do envio…" / "do normal…"
                porque = 'O valor ficou acima do normal: ' + (p.ida > 0 && p.valor > 2 * p.ida ? 'o frete do envio desta venda foi ' + m(p.ida) : 'minhas outras devoluções custam em torno de ' + m(tipico)) + '.';
            } else if (x) {
                cor = 'amarelo'; regra = 'motivo_incerto';
                motivo = mot ? 'O motivo (“' + mot + '”) não diz de quem foi a responsabilidade.' : 'O pós-venda não diz o motivo nem de quem foi a responsabilidade.';
                porque = mot ? 'O motivo informado foi “' + mot + '”, que não diz de quem foi a responsabilidade.' : 'O pós-venda não informa o motivo nem de quem foi a responsabilidade.';
            } else {
                cor = 'amarelo'; regra = 'sem_dado';
                motivo = soPrimeira ? 'Reclamação não lida (o Copiloto leu só a 1ª página do pós-venda).' : 'Sem dado do pós-venda para decidir.';
                porque = '';   // o texto 🟡 já pergunta (SHC.chamadoDevolucao)
            }
            if (cor === 'cinza') recuperar = 0;
            const it = { pedido: String(p.pedido), itemId: p.itemId || '', data: p.data || '', valor: p.valor, cor, regra, motivo, recuperar: r2(recuperar) };
            it.texto = cor === 'cinza' ? '' : SHC.chamadoDevolucao(Object.assign({}, it, { porque }));
            out.itens.push(it);
            const b = out[cor]; b.n++; b.valor = r2(b.valor + (cor === 'cinza' ? p.valor : it.recuperar));
        });
        const ord = { verde: 0, amarelo: 1, cinza: 2 };
        out.itens.sort((a, b) => ord[a.cor] - ord[b.cor] || b.valor - a.valor);
        return out;
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
     * no dia da venda (mais de R$ 1 e 5%; fora compartilhado; 2+ unidades e régua de hoje vão para "para conferir"). Não conciliado: semCobrancaAinda (venda sem cobrança
     * de frete lida: o ML lança depois), semFreteNoAnuncio (anúncio fora do retrato ou sem frete). compradorPaga = anúncio com envio
     * por conta do comprador e sem cobrança (nada a conciliar). Cancelado não conta como venda.
     * porPedido = SHC.freteDasCobrancas; retratoPorItem = {MLB: item}; vendas30 = SHC.vendasDasCobrancas; hoje (opcional) = recorta 30 dias.
     * → { vendas, conciliados, pagoAMais:[{pedido, itemId, data, cobrado, esperado, diferenca, formato, talvezUnidades, linhas?, dev?}],
     *     totalAMais (sem os talvezUnidades), talvez:{pedidos, total} (os com *), semCobrancaAinda, pedidosSemCobranca:[pedido] (até 100), semFreteNoAnuncio, compradorPaga, cancelados, freteSemVenda, faltam }
     * v3.3: esperado = frete do anúncio no dia da venda (fretesDia; base:'dia'|'hoje'); múltiplo exato vira talvezUnidades (vezes) em vez de sumir;
     *     porItem:{MLB:{n, v, nt, vt}} (sem o corte de 200: Σv = totalAMais, Σvt = talvez.total); janela:{de, ate}; pagoAMais: contestáveis primeiro.
     */
    // O frete costuma vir com OUTRO número ("Venda #20000147…" no frete × "Pedido #2000018…" no Custo por vender, retrato real de
    // 25/09/2026): sem o mesmo número, o frete casa com a venda do MESMO anúncio, sem par, feita até FRETE_PAR_DIAS antes (a mais próxima).
    // Frete que não achar venda nunca vira venda: conta em freteSemVenda. O par por anúncio+data é aproximado: com 2+ vendas ou 2+ fretes do
    // mesmo anúncio no período, um frete certo pode cair na venda errada (auditoria 07/10/2026: frete de 18/09 casado com a venda de 21/09
    // virava "cobrança indevida"). Par AMBÍGUO (ambiguo) vai para "para conferir" (talvezUnidades); só o par único é contestável.
    SHC.FRETE_PAR_DIAS = 20;
    // v3.3: frete do anúncio no dia d pelo histórico diário ({'AAAA-MM-DD': valor}, fh|ml): o do dia, senão o último guardado antes; null = sem dia.
    const freteNoDia = (h, d) => {
        if (!h || !d) return null;
        if (typeof h[d] === 'number' && h[d] > 0) return h[d];
        const antes = Object.keys(h).filter(x => x < d && typeof h[x] === 'number' && h[x] > 0).sort().pop();
        return antes ? h[antes] : null;
    };
    SHC.freteNoDia = freteNoDia;
    // fretesDia (opcional, v3.3) = SHC.lerFretes(ids) → {MLB: {'AAAA-MM-DD': frete}}: régua de cada pedido = frete do anúncio no dia da venda.
    SHC.conciliaFrete = function (porPedido, retratoPorItem, vendas30, hoje, fretesDia) {
        const ini = hoje ? diaMenosX(hoje, 29) : '', dentro = d => !ini || (!!d && d >= ini && d <= hoje), r2 = SHC.r2;
        const fp = {}, uni = {}, it = retratoPorItem || {}, vend = {}, usada = new Set(), soltos = [], ambiguo = new Set();
        const fretes = (porPedido || []).filter(p => p && p.pedido), numFrete = new Set(fretes.map(p => p.pedido)), porAn = {};
        (vendas30 || []).forEach(v => { if (v && v.pedido && v.data && (!hoje || v.data <= hoje)) vend[v.pedido] = v; });
        Object.keys(vend).forEach(k => { const v = vend[k]; if (!numFrete.has(k) && v.itemId) (porAn[v.itemId] || (porAn[v.itemId] = [])).push(k); });
        // Fretes de cada anúncio que só casam pela data (sem venda com o mesmo número): 2+ no mesmo anúncio = o par pode trocar.
        const semNum = {};
        fretes.forEach(p => { if (!vend[p.pedido] && p.itemId) (semNum[p.itemId] || (semNum[p.itemId] = [])).push(p); });
        fretes.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0)).forEach(p => {
            let k = vend[p.pedido] && !usada.has(p.pedido) ? p.pedido : null, cands = 0;
            if (!k && p.itemId && p.data) {
                const lim = diaMenosX(p.data, SHC.FRETE_PAR_DIAS);
                (porAn[p.itemId] || []).forEach(q => {
                    const v = vend[q];
                    if (usada.has(q) || v.data > p.data || v.data < lim || !!v.cancelada !== !!p.cancelado) return;   // cancelado só com cancelado
                    cands++;
                    if (!k || v.data > vend[k].data) k = q;
                });
                // Ambíguo: outra venda candidata, ou outro frete do anúncio sem número na janela da venda escolhida.
                if (k && (cands > 1 || (semNum[p.itemId] || []).some(o => o !== p && o.data >= vend[k].data && o.data <= diaMaisX(vend[k].data, SHC.FRETE_PAR_DIAS)))) ambiguo.add(k);
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
            // v3.3 (30/09, print da dona): a régua é o frete do anúncio NO DIA da venda (fh|ml, fretesDia), não o de hoje. Sem o dia guardado:
            // o último dia guardado antes da venda; sem nenhum: o frete de hoje (base 'hoje').
            const dv = (vend[k] && vend[k].data) || p.data, bd = a.freteComprador ? null : freteNoDia(fretesDia && fretesDia[id], dv);
            const esperado = a.freteComprador ? 0 : (bd !== null ? bd : a.frete);
            if (!(esperado > 0) || p.formato === 'compartilhado' || p.aprox) return;   // aprox: sem o formato (versão anterior), não aponta
            const dif = r2(p.cobrado - esperado), razao = p.cobrado / esperado;
            // v3.1: linhas = a conta do frete linha a linha (conferir com o ML); dev = tarifa de devolução do pedido, que fica FORA desta conta.
            // v3.3: nada some. Múltiplo exato (2×, 3×… ±8%) e frete ≥ 1,6× o do anúncio vão para "para conferir" (talvezUnidades); vezes = k do múltiplo.
            // B1: régua de HOJE (o dia da venda não foi guardado) também vai para "para conferir": se o frete do anúncio baixou depois da venda,
            // o "a mais" é falso e nunca pode ir para o chamado.
            // talvezUnidades = "para conferir" (fora do total e do chamado): múltiplo, ≥ 1,6×, régua de hoje, ou par por data ambíguo (parAmbiguo).
            if (dif > Math.max(1, esperado * 0.05)) out.pagoAMais.push(Object.assign({ pedido: k, itemId: id, data: p.data, cobrado: p.cobrado, esperado, diferenca: dif, formato: p.formato,
                talvezUnidades: razao >= 1.6 || variasUn(razao) || bd === null || ambiguo.has(k), base: bd !== null ? 'dia' : 'hoje' }, variasUn(razao) ? { vezes: Math.round(razao) } : {},
                p.linhas ? { linhas: p.linhas } : {}, p.dev > 0 ? { dev: p.dev } : {}, k !== p.pedido ? { pedidoFrete: p.pedido } : {}, ambiguo.has(k) ? { parAmbiguo: true } : {}));
        });
        // v3.3: os que dá para contestar primeiro (o corte de 200 nunca tira um deles antes de um "para conferir"), depois o maior "a mais".
        out.pagoAMais.sort((a, b) => ((a.talvezUnidades ? 1 : 0) - (b.talvezUnidades ? 1 : 0)) || (b.diferenca - a.diferenca));
        // v3.1: o total "a mais" é só o que dá para pedir revisão; o pedido com * (frete ≥ 1,6× o do anúncio: pode ter 2+ unidades) fica à parte.
        const talvez = out.pagoAMais.filter(x => x.talvezUnidades);
        out.totalAMais = r2(out.pagoAMais.filter(x => !x.talvezUnidades).reduce((s, x) => s + x.diferenca, 0));
        out.talvez = { pedidos: talvez.length, total: r2(talvez.reduce((s, x) => s + x.diferenca, 0)) };
        // v3.3: soma por anúncio ANTES do corte de 200 (n/v = dá para contestar; nt/vt = para conferir) e a janela dos 30 dias, para a tela fechar a conta.
        out.porItem = {};
        out.pagoAMais.forEach(x => { const g = out.porItem[x.itemId] || (out.porItem[x.itemId] = { n: 0, v: 0, nt: 0, vt: 0 });
            if (x.talvezUnidades) { g.nt++; g.vt = r2(g.vt + x.diferenca); } else { g.n++; g.v = r2(g.v + x.diferenca); } });
        if (ini) out.janela = { de: ini, ate: hoje };
        // B1: números do FRETE (o vd|ml usa esse número) para a tela não contar o mesmo pedido 2 vezes. numsFrete = todos (só quando a lista é
        // cortada em 200); foraJanela = frete cobrado dentro dos 30 dias de uma venda feita ANTES deles (fica fora da lista e da subida).
        if (out.pagoAMais.length > 200) out.numsFrete = out.pagoAMais.map(x => String(fp[x.pedido].pedido));
        out.foraJanela = Object.keys(fp).filter(k => ini && vend[k].data < ini && dentro(fp[k].data)).map(k => String(fp[k].pedido));
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
    // F21: sem paging.total → null (quem lê segue até vir uma página menor que o limite). Antes devolvia o nº lido: 50 de 120 virava "completo".
    const totalPaging = j => { const t = j && j.paging && j.paging.total; return typeof t === 'number' ? t : null; };
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
        return { total: totalPaging(j), campanhas };
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
        return { total: totalPaging(j), anuncios };
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
    // v3.4 (01/10): código do ML (modalTrigger.type, 3º pedaço de c.id) → tipo, para quando o texto não diz (o ML às vezes manda detail_1
    // vazio: 465 cobranças de 26 a 28/08 numa conta). Cancelamento = B + o código cobrado sem o C (BVVML ↔ CVVML). Código desconhecido = ''.
    // v3.4.1 (OK da dona 02/10): DSB = "Tarifa do Mercado Envios" (CDSB) e "Cancelamento da tarifa por envios no Mercado Livre" (BDSB):
    // com o texto já davam 'frete' (linha "Tarifas de envios no Mercado Livre" da fatura); sem o texto caíam em 'outro'.
    const TIPO_POR_CODIGO = { VVML: 'tarifa_venda', VVPRC: 'cobranca_mp', RAD: 'cobranca_mp', VVFN: 'parcelamento', FONPN: 'parcelamento', VVFNU: 'recebimento',
        XDE: 'frete', XD: 'frete', XDI: 'frete', FFE: 'frete', FFI: 'frete', DSB: 'frete', XDED: 'devolucao', DSDB: 'devolucao', PADS: 'ads', DLIT: 'ads_seguidores',
        DIFAL: 'impostos_ml', ESM: 'minha_pagina', FWA: 'full', FBA: 'full', FCBE: 'full', FPB: 'full', FRS: 'full' };
    SHC.codigoCobranca = id => { const t = String(String(id || '').split('|')[2] || '').toUpperCase(); return /^[CB][A-Z]/.test(t) ? t.slice(1) : t; };
    /** detail_1 do Faturamento (+ c.id, opcional) → tipo do fechamento. "Cancelamento …" cai no mesmo tipo (o estorno é o sinal).
     *  Texto que não diz o tipo (vazio ou novo) → pelo código do ML em c.id. */
    SHC.tipoCustoFechamento = function (t, id) {
        const tp = tipoPeloTexto(t);
        return tp === 'outro' && id ? TIPO_POR_CODIGO[SHC.codigoCobranca(id)] || 'outro' : tp;
    };
    function tipoPeloTexto(t) {
        const s = String(t || '').replace(/^\s*cancelamento\s+(d[oa]s?|de)\s+/i, '');
        if (/seguidores/i.test(s)) return 'ads_seguidores';
        if (/product ads|publicidad/i.test(s)) return 'ads';
        // v3.1 (pedido da dona 26/09: "tudo que é pertinente a custo"): nomes vistos ao vivo no resumo da fatura por categoria
        // ("Tarifa pelo serviço de armazenamento Full", "Tarifa por estoque antigo no Full", "Tarifa de manutenção da Minha página",
        // "Cobrança do diferencial de alíquota interestadual (ICMS-DIFAL)", "Tarifa de devolução…"). Antes caíam em 'outro' (ou em frete).
        if (/\bfull\b/i.test(s)) return 'full';
        if (/minha p[áa]gina/i.test(s)) return 'minha_pagina';
        if (/difal|al[íi]quota|\bimpostos?\b/i.test(s)) return 'impostos_ml';
        if (/devolu[çc][ãa]o/i.test(s)) return 'devolucao';
        if (/tarifa (de|por) envio|envios?\b/i.test(s)) return 'frete';
        if (/custo por vender/i.test(s)) return 'tarifa_venda';
        if (/custo por cobrar/i.test(s)) return 'cobranca_mp';
        if (/parcelamento/i.test(s)) return 'parcelamento';
        if (/taxa de recebimento/i.test(s)) return 'recebimento';
        // v3.4: vistos ao vivo e antes em 'outro': "Tarifa de venda" (a fatura põe em "Tarifas de venda"), "Tarifa pelo pagamento do frete no
        // Mercado Pago" (CRAD) e "Tarifa de processamento" (mesma linha da fatura que o "Custo por cobrar no Mercado Pago").
        if (/^tarifa de venda/i.test(s)) return 'tarifa_venda';
        if (/mercado pago|processamento/i.test(s)) return 'cobranca_mp';
        return 'outro';
    }
    SHC.TIPOS_FECHAMENTO = ['tarifa_venda', 'cobranca_mp', 'parcelamento', 'recebimento', 'frete', 'devolucao', 'full', 'ads', 'ads_seguidores', 'minha_pagina', 'impostos_ml', 'outro'];
    // fech.tipos = 2: gravado já com Full, Minha página, impostos e devolução separados de 'outro'/frete (mês lido antes fica sem a marca).
    SHC.FECH_TIPOS_VERSAO = 2;
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
            const mes = d.slice(0, 7), tipo = SHC.tipoCustoFechamento(c.texto, c.id);
            const est = c.estorno !== undefined ? !!c.estorno : /^cancelamento/i.test(c.texto || '');
            const v = est ? -c.valor : c.valor;
            const f = out[mes] || (out[mes] = { mes, porTipo: {}, porOrigem: {}, porDia: {}, estornos: 0, total: 0, qtdVendas: 0, pedidos: {}, tipos: SHC.FECH_TIPOS_VERSAO, porFatura: {} });
            f.porTipo[tipo] = (f.porTipo[tipo] || 0) + v;
            // v3.4: por FATURA do ML (c.fatura), como a tela da fatura: custo[linha] (cobrado), cancel (cancelamento antes do fechamento, ≥ 0) e
            // nc (nota de crédito = "em estornos" da fatura anterior, ≥ 0). A "Taxa de parcelamento" sem "equivalente ao acréscimo" (CVVFN) o ML
            // põe em "Tarifas de venda": chave própria aqui (no porTipo continua 'parcelamento'). semFatura = cobranças sem a fatura (gravadas por
            // versão anterior, ou o ML não mandou): com alguma, o mês não serve para a conferência exata (F.somaFatura → ciclo por data).
            if (!c.fatura) f.semFatura = (f.semFatura || 0) + 1;
            else {
                const pf = f.porFatura[c.fatura] || (f.porFatura[c.fatura] = { custo: {}, cancel: 0, nc: 0 });
                // Pelo código quando há (CVVFN × CFONPN): o texto nem sempre traz o "equivalente" (ao vivo, maio de uma conta).
                const cod = SHC.codigoCobranca(c.id);
                const lf = tipo === 'parcelamento' && (cod === 'VVFN' || (cod !== 'FONPN' && !/equivalente|acr[ée]scimo/i.test(c.texto || ''))) ? 'parcelamento_venda' : tipo;
                if (!est) pf.custo[lf] = SHC.r2((pf.custo[lf] || 0) + v);
                else if (c.notaCredito) pf.nc = SHC.r2(pf.nc - v); else pf.cancel = SHC.r2(pf.cancel - v);
            }
            const o = f.porOrigem[tipo] || (f.porOrigem[tipo] = { venda: 0, fatura: 0 });
            o[c.origemPagamento === 'venda' ? 'venda' : 'fatura'] += v;
            if (/^\d{4}-\d{2}-\d{2}$/.test(c.data || '')) {
                f.porDia[c.data] = (f.porDia[c.data] || 0) + v;
                // v3.1 (29/09): cobrado (sem estorno) por dia DA COBRANÇA e tipo: a conferência soma o ciclo exato da fatura (F.somaCiclo).
                if (!est) { const pd = f.porDiaTipo || (f.porDiaTipo = {}), x = pd[c.data] || (pd[c.data] = {}); x[tipo] = SHC.r2((x[tipo] || 0) + v); }
            }
            f.total += v;
            // v3.1 (29/09): estorno por tipo (≤ 0), como a fatura do ML (tipo ANTES dos cancelamentos + "Cancelamentos de tarifas" à parte).
            if (est) { f.estornos += v; const e = f.estornosPorTipo || (f.estornosPorTipo = {}); e[tipo] = (e[tipo] || 0) + v; }
            if (tipo === 'tarifa_venda') f.qtdVendas += est ? -1 : 1;
            if (c.orderId && desdePedidos && mes >= desdePedidos) { const p = f.pedidos[c.orderId] || (f.pedidos[c.orderId] = {}); p[tipo] = SHC.r2((p[tipo] || 0) + v); }
        });
        Object.keys(out).forEach(m => {
            const f = out[m];
            Object.keys(f.porTipo).forEach(t => { f.porTipo[t] = SHC.r2(f.porTipo[t]); });
            Object.keys(f.porOrigem).forEach(t => { const o = f.porOrigem[t]; o.venda = SHC.r2(o.venda); o.fatura = SHC.r2(o.fatura); o.total = f.porTipo[t]; });
            Object.keys(f.porDia).forEach(d => { f.porDia[d] = SHC.r2(f.porDia[d]); });
            Object.keys(f.estornosPorTipo || {}).forEach(t => { f.estornosPorTipo[t] = SHC.r2(f.estornosPorTipo[t]); });
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
    // 3.2.1 (segurança): link absoluto só do ML/Mercado Pago (linkMLOk); outro domínio → '' (sem botão).
    const linkML = u => (!u ? '' : linkMLOk(u) ? String(u) : /^\/(?!\/)/.test(u) ? 'https://vendedores.mercadolivre.com.br' + u : '');
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

    // ── v3.1: CUSTO NOVO NA FATURA. Resumo da fatura por categoria e por tipo de tarifa, mapeado ao vivo em 26/09/2026:
    // GET /billing/detail/api/billing-info/<AAAAMMDD>/bricks?… (1 pedido por fatura) → account_detail_card.data:
    // pieChartSection.dataset[] {label, value, charges[] {label, value}} (categoria e tipos) e chargeSection {total, sectionIterator[]}.
    SHC.faturaCategoriasUrl = data => 'https://vendedores.mercadolivre.com.br/billing/detail/api/billing-info/' + data
        + '/bricks?site_id=MLB&fromReports=false&fromCxOne=false&society=ml&isMobile=false&fromLegalDocuments=false&fromChargesPaymentInfo=true&selectedCurrency=BRL';
    /** → { total, categorias:[{nome, valor, tipos:[{nome, valor}]}] } | null (formato desconhecido: não grava). Valor = o que a lista da fatura mostra
     *  (antes dos "Cancelamentos de tarifas", que vêm à parte e ficam fora: não são custo). Categoria sem tipos (sem o gráfico) = ela mesma é o tipo. */
    SHC.mlFaturaCategorias = function (j) {
        const d = (j && j.account_detail_card && j.account_detail_card.data) || primeiroEmLargura(j, o => (o.chargeSection && o.chargeSection.sectionIterator ? o : undefined), 6);
        if (!d || typeof d !== 'object') return null;
        const n = v => { const x = typeof v === 'number' ? v : valorCobranca(v); return x === null || !isFinite(x) ? null : SHC.r2(x); };
        const ds = d.pieChartSection && Array.isArray(d.pieChartSection.dataset) ? d.pieChartSection.dataset : null;
        const si = d.chargeSection && Array.isArray(d.chargeSection.sectionIterator) ? d.chargeSection.sectionIterator : null;
        let categorias;
        // v3.1 (29/09): cancelado = "Cancelamentos" da categoria (bonus do gráfico; ao vivo 26/09 a soma bate com "Cancelamentos de tarifas").
        if (ds) categorias = ds.filter(c => c && c.label && n(c.value) !== null).map(c => Object.assign({ nome: String(c.label), valor: n(c.value),
            tipos: (Array.isArray(c.charges) ? c.charges : []).filter(t => t && t.label && n(t.value) !== null).map(t => ({ nome: String(t.label), valor: n(t.value) })) },
            typeof c.bonus === 'number' && isFinite(c.bonus) ? { cancelado: SHC.r2(Math.abs(c.bonus)) } : {}));
        else if (si) categorias = si.filter(s => s && s.link_description && s.link_description.text && !(s.amount && s.amount.negative)).map(s => ({ nome: String(s.link_description.text), valor: n(s.amount), tipos: [] })).filter(c => c.valor !== null);
        else return null;
        // Linhas negativas: "Cancelamentos de tarifas" (na lista de tarifas) e "Cancelamentos de tarifas em estornos" (nos pagamentos: tarifa
        // DESTA fatura cancelada DEPOIS do fechamento; vira nota de crédito com a data da fatura seguinte — provado ao vivo 01/10 nas faturas de
        // agosto e setembro). null = a fatura não mandou a linha (não é zero).
        const neg = (lista, re) => { const xs = (lista || []).filter(s => s && s.amount && s.amount.negative && re.test(String((s.link_description && (s.link_description.link + ' ' + s.link_description.text)) || '')));
            return xs.length ? SHC.r2(xs.reduce((a, s) => a + Math.abs(n(s.amount) || 0), 0)) : null; };
        const ps = d.paymentSection && Array.isArray(d.paymentSection.sectionIterator) ? d.paymentSection.sectionIterator : null;
        return { total: d.chargeSection ? n(d.chargeSection.total) : null, categorias, cancelamentos: neg(si, /cancelamento/i), estornosAnteriores: neg(ps, /credit-applied-notes|cancelamentos de tarifas em estornos/i) };
    };
    // Por que o custo costuma aparecer e como evitar (só o que o nome da tarifa diz; sem entrada = "sem explicação conhecida"). A ordem importa:
    // "Tarifa de devolução por envio…" é devolução antes de ser envio.
    SHC.CUSTO_EXPLICA = [
        [/devolu/i, 'Aparece quando uma venda volta: o ML cobra o envio da devolução.', 'Veja as reclamações e devoluções na aba Pós-venda: descrição, fotos e medidas certas evitam devolução.', 'posvenda'],
        [/multa|penalidade|inconformidade/i, 'Multa por problema numa remessa do Full ou num anúncio.', 'Veja as remessas com problema na aba Full; se não concorda, reclame no ML.', 'full'],
        [/estoque antigo|armazenamento|armazenagem|\bfull\b|coleta|remessa/i, 'Custo do Full: armazenagem, estoque parado há muito tempo ou coleta.', 'Veja na aba Full os produtos parados e envie menos unidades dos que vendem pouco.', 'full'],
        [/envio|frete/i, 'Frete dos envios pelo Mercado Livre: muda com o peso, as medidas do pacote e o destino.', 'Confira as medidas e o peso dos anúncios na aba Saúde e o frete por anúncio na aba Frete.', 'saude'],
        [/assinatura|conte[úu]do digital/i, 'Assinatura de um serviço ou conteúdo no Mercado Livre.', 'Se você não usa, cancele a assinatura no Mercado Livre.', null],
        [/minha p[áa]gina/i, 'Mensalidade da Minha página (a sua loja dentro do ML).', 'Se você não usa a Minha página, cancele no Mercado Livre.', null],
        [/publicidade|product ads|\bads\b/i, 'Custo das campanhas do Mercado Ads.', 'Veja na aba Ads os anúncios acima do equilíbrio e ajuste o orçamento ou o ROAS objetivo.', 'ads'],
        [/parcelamento|parcela/i, 'Taxa das vendas parceladas sem juros para o comprador (anúncio Premium).', 'Confira se a margem aguenta as parcelas sem juros; se não, mude o anúncio para Clássico.', null],
        [/imposto|icms|difal|tribut/i, 'Imposto que o ML recolhe nas suas vendas (veja o nome da tarifa).', 'Confira o seu regime fiscal com o contador e os dados fiscais dos anúncios na aba Saúde.', 'saude'],
        [/recebimento|mercado pago|por cobrar/i, 'Custo do Mercado Pago para receber o dinheiro das vendas.', 'Faz parte de cada venda: confira se o preço cobre essa taxa.', null],
        [/venda|vender/i, 'Tarifa de venda do Mercado Livre (comissão da categoria).', 'Confira se o preço cobre a comissão na aba Catálogo.', 'catalogo'],
    ];
    SHC.custoExplica = nome => { const x = SHC.CUSTO_EXPLICA.find(([re]) => re.test(String(nome || ''))); return x ? { porque: x[1], evitar: x[2], aba: x[3] } : null; };
    SHC.CUSTO_SUBIU_PCT = 50;   // subiu "muito" = mais de 50% E mais de R$ 50 contra a fatura anterior
    SHC.CUSTO_SUBIU_RS = 50;
    SHC.CUSTO_NOVO_MIN = 3;   // faturas lidas seguidas (a atual + 2 anteriores) para dizer "novo: não aparecia antes"
    /**
     * fat = fat:<conta> com categorias {'AAAA-MM' (mês da fatura): {nome, fechamento, aberta, link, total, categorias}}.
     * Olha as 2 faturas mais recentes lidas (a em andamento conta): tipo de tarifa que não aparecia em NENHUMA fatura anterior lida = novo;
     * tipo que estava na fatura anterior e subiu > 50% e > R$ 50 = subiu. Sem fatura anterior lida não compara (nunca "tudo é novo").
     * → { itens:[{chave, tipo, categoria, valor, antes, novo, pct, fatura, nomeFatura, aberta, desde (nome da fatura em que apareceu), link,
     *             porque, evitar, aba}] (os novos primeiro, depois o maior valor), lidas (faturas com categorias), base (tem com o que comparar) }
     */
    SHC.custosNovos = function (fat) {
        const cat = (fat && fat.categorias) || {}, ms = Object.keys(cat).filter(m => /^\d{4}-\d{2}$/.test(m) && cat[m] && Array.isArray(cat[m].categorias)).sort();
        const tiposDe = m => { const o = {}; cat[m].categorias.forEach(c => (c.tipos && c.tipos.length ? c.tipos : [c]).forEach(t => { if (t.valor > 0) o[t.nome] = { valor: SHC.r2((o[t.nome] ? o[t.nome].valor : 0) + t.valor), categoria: c.nome }; })); return o; };
        const out = {}, vistos = new Set(), faltaLer = [];
        // Só compara com o ciclo IMEDIATAMENTE anterior (fatura que não foi lida no meio não pode virar "subiu" contra 2 ciclos atrás) e só
        // diz "novo" com SHC.CUSTO_NOVO_MIN faturas lidas seguidas (com 2 lidas, qualquer tarifa esporádica viraria "não aparecia antes").
        const mAnt = m => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 2, 1)).toISOString().slice(0, 7);
        const seguidas = i => { let n = 1; while (i - n >= 0 && ms[i - n] === mAnt(ms[i - n + 1])) n++; return n; };   // lidas seguidas até ms[i]
        if (ms.length) Object.keys(tiposDe(ms[0])).forEach(t => vistos.add(t));
        for (let i = 1; i < ms.length; i++) {
            const m = ms[i], ag = tiposDe(m), ant = tiposDe(ms[i - 1]), f = cat[m], recente = i >= ms.length - 2;
            const seguido = ms[i - 1] === mAnt(m), podeNovo = seguido && seguidas(i) >= SHC.CUSTO_NOVO_MIN;
            if (recente && !seguido) faltaLer.push(mAnt(m));
            if (recente) Object.keys(ag).forEach(t => {
                const v = ag[t].valor, a = ant[t] ? ant[t].valor : null, novo = !vistos.has(t) && podeNovo;
                const subiu = seguido && !novo && a > 0 && v - a > SHC.CUSTO_SUBIU_RS && (v - a) / a * 100 > SHC.CUSTO_SUBIU_PCT;
                if (v < 1 || (!novo && !subiu)) {
                    if (out[t] && out[t].novo) Object.assign(out[t], { valor: v, fatura: m, nomeFatura: f.nome || m, aberta: !!f.aberta, link: f.link || out[t].link });
                    else if (out[t] && !f.aberta) delete out[t];   // voltou ao normal na fatura fechada (a em andamento ainda está pela metade)
                    return;
                }
                const x = SHC.custoExplica(t) || {};
                out[t] = Object.assign({ chave: 'custo|' + t, tipo: t, categoria: ag[t].categoria, valor: v, antes: novo ? null : a, novo, pct: novo ? null : Math.round((v - a) / a * 100),
                    fatura: m, nomeFatura: f.nome || m, aberta: !!f.aberta, desde: novo ? (f.nome || m) : null, link: f.link || '', porque: x.porque || null, evitar: x.evitar || null, aba: x.aba || null },
                    out[t] && out[t].novo ? { novo: true, antes: null, pct: null, desde: out[t].desde } : {});
            });
            Object.keys(ag).forEach(t => vistos.add(t));
        }
        const itens = Object.keys(out).map(k => out[k]).sort((a, b) => (b.novo - a.novo) || (b.valor - a.valor));
        return { itens, lidas: ms.length, base: itens.length > 0 || (ms.length > 0 && seguidas(ms.length - 1) >= SHC.CUSTO_NOVO_MIN), faltaLer };
    };
    /** Texto curto de um item de SHC.custosNovos: "Tarifa X: R$ 84,00 na fatura de agosto, não aparecia antes." */
    SHC.custoNovoTxt = x => x.tipo + ': ' + SHC.moeda(x.valor) + ' na fatura ' + (x.aberta ? 'em andamento' : 'de ' + x.nomeFatura)
        + (x.novo ? (x.desde && x.desde !== x.nomeFatura ? ', novo desde a fatura de ' + x.desde : ', não aparecia nas faturas anteriores')
            : ', era ' + SHC.moeda(x.antes) + ' na anterior (+' + x.pct + '%)') + '.';

    // ── v2.8: NF-e das SUAS VENDAS (emitidas pelo Faturador ou pelo Full), capturado ao vivo em 25/09/2026 na página
    // /documents/overview/reports?start_date=AAAA-MM-DD&end_date=AAAA-MM-DD&page=N. A lista vem de um POST de CONSULTA (só busca: não cria
    // nem muda nada, como a calculadora do Simulador): SHC.NFE_URL com {startDate, endDate, typeOfReceipt:['NFE'], offset, limit}.
    // Da resposta só ficam dados da NOTA: destinatário (recipient_*), CPF/CNPJ, tipo de cliente e observação NUNCA saem daqui.
    // "Baixar relatório" (Excel) e "Baixar documentos" (PDF/XML) são botões da página do ML: o Copiloto só abre a página no mês certo.
    SHC.NFE_URL = 'https://vendedores.mercadolivre.com.br/documents/overview/api/invoice/search?boUserId=&boSiteId=';
    SHC.NFE_LIMITE = 10;          // o que a própria página do ML pede
    SHC.NFE_MAX_NOTAS = 5000;     // por mês (= NFE_PAGINAS_MAX × 10); acima disso só os totais. v2.11: 5.000 para a leitura incremental valer em conta grande (~1,5 MB guardados)
    const fimMesNfe = m => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
    SHC.nfeLink = m => 'https://vendedores.mercadolivre.com.br/documents/overview/reports?start_date=' + m + '-01&end_date=' + fimMesNfe(m) + '&page=1';
    // v2.11: desde ('AAAA-MM-DD' dentro do mês) = só as notas a partir desse dia (leitura incremental do mês já lido).
    SHC.nfePedido = (m, offset, desde) => ({ startDate: desde || m + '-01', endDate: fimMesNfe(m), typeOfReceipt: ['NFE'], offset: offset || 0, limit: SHC.NFE_LIMITE });
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
        // Mês sem venda (ao vivo 01/10/2026, out/25 a mai/26 da conta de peças): a tabela vem com header + empty_state ("Não há vendas
        // para mostrar neste período.") e SEM content_rows — é tabela vazia, não "formato mudou".
        const tab = primeiroEmLargura(gross, o => ((o.header && (Array.isArray(o.content_rows) || (o.empty_state && typeof o.empty_state === 'object'))) ? o : undefined), 16);
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
        let blocos = 0, outros = 0;
        ld.groups.forEach(g => ((g && Array.isArray(g.items)) ? g.items : []).forEach(i => {
            if (!i || typeof i !== 'object') return;
            blocos++;
            // v3.1 (29/09): tipo desconhecido (crédito, cashback, ajuste… ainda sem retrato real) nunca quebra a leitura: fica fora e só é contado.
            const valor = valorMP(i.amount && typeof i.amount === 'object' ? i.amount : null), code = i.status && typeof i.status === 'object' ? i.status.code : undefined, data = DIA_BRT(i.creationDate);
            const tr = /(\d{4,24})/.exec(String((i.paymentMethod && i.paymentMethod.text) || '')), transacao = tr ? tr[1] : String(i.link || i.id || '');
            sinais.push([data, i.type, valor, transacao].join('/'));
            if (!/^(sale|pack)$/.test(String(i.type || '')) || !/^venda no mercado livre$/i.test(String(i.title || '').trim())) { if (!/^purchase$/.test(String(i.type || ''))) outros++; return; }
            if ((code !== 'approved' && code !== 'refunded') || valor === null || !data) return;
            if (code === 'refunded' && valor > 0) return;   // igual ao plano B: reembolso só ≤ 0 (o positivo fica fora)
            out.push({ data, tipo: code === 'refunded' ? 'reembolso' : 'venda', valor, transacao, titulo: String(i.description || '').slice(0, 200), status: code });
        }));
        out.blocos = blocos;
        out.outros = outros;   // atividades que não são venda nem compra (ex.: créditos, ajustes): não entram no repasse
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
    // v2.11: ordem por PRIORIDADE — o que as telas usam primeiro (vendas, Fechamento, Full, Ads, pós-venda, famílias), depois as etapas
    // leves (promoções, afiliados, saúde) e por último as pesadas (faturas + NF-e, Mercado Pago). Os meses antigos ficam para o histórico.
    SHC.SYNC_ETAPAS = [
        { id: 'anuncios', rotulo: 'Seus anúncios' },
        { id: 'vendasBrutas', rotulo: 'Vendas brutas' },   // antes do Faturamento: o Fechamento soma os dias
        { id: 'faturamento', rotulo: 'Faturamento (tarifas, frete e Ads)' },   // só o mês atual (a partir dos dias novos) e o anterior
        { id: 'full', rotulo: 'Estoque Full' }, { id: 'ads', rotulo: 'Mercado Ads' }, { id: 'posvenda', rotulo: 'Pós-venda' },
        { id: 'vendasAnuncio', rotulo: 'Vendas por anúncio' },   // v2.6: faturamento por família (mês atual e anterior; o resto no histórico)
        { id: 'promos', rotulo: 'Central de promoções' }, { id: 'afiliados', rotulo: 'Afiliados' }, { id: 'saude', rotulo: 'Saúde dos anúncios' },
        { id: 'faturas', rotulo: 'Faturas do ML' },   // + NF-e das vendas (a mais pesada)
        { id: 'repasse', rotulo: 'Mercado Pago' },
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
    // F23: o mesmo SKU pode estar no Full de 2 contas com mínimos diferentes → cad.fullMinUnConta = {sellerId: n} (0 = sem mínimo nesta
    // conta) vale primeiro; o fullMinUn de antes vira o padrão das contas sem valor próprio.
    SHC.fullMinimo = function (prod, cad, prev30, conta) {
        const pc = conta && cad && cad.fullMinUnConta ? cad.fullMinUnConta[conta] : undefined;
        const n = SHC.num(pc !== undefined && pc !== null ? pc : cad && cad.fullMinUn), definido = n !== null && n >= 1, minUn = definido ? Math.round(n) : null;
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
            const tem = Math.max(0, aptas), fm = SHC.fullMinimo(p, cad, prev, dados.sellerId);   // F23: mínimo da conta
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
            const c = SHC.custoDeAnuncio ? SHC.custoDeAnuncio(custos, { sku: it.sku, skus: it.skus, skuFonte: it.skuFonte, itemId: it.itemId, familia: it.familia }) : null;
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
    SHC.achaBrickStack = achaBrickStack;   // v3.1: a lista de Vendas (ml-tela.js) usa o mesmo estado Flox
    // F11: total de vendas que a lista diz ter (brick "pagination" → data.total, visto no retrato de 26/09). null = não veio.
    SHC.mlVendasTotal = function (r) {
        const st = achaBrickStack(r), b = (st && st.brickStack) || {}, p = b.pagination, t = p && p.data ? SHC.num(p.data.total) : null;
        if (t !== null && t !== undefined && t >= 0) return t;
        // Ao vivo em 01/10/2026 a lista veio sem "pagination": o total sai do texto "8 vendas" (brick count_text_<aba>).
        const ct = Object.keys(b).find(k => /^count_text/.test(k) && b[k] && b[k].data && /\d/.test(String(b[k].data.text || '')));
        const m = ct && /([\d.]+)\s+vendas?/i.exec(String(b[ct].data.text));
        return m ? +m[1].replace(/\./g, '') : null;
    };
    // F11: página N da lista de Vendas. ponytail: o nome do parâmetro (?page=N) ainda NÃO foi confirmado ao vivo — o fundo confere
    // sozinho: página que só repete pedidos já lidos = o ML ignorou o parâmetro, e a leitura para ali (fica "lido só em parte").
    SHC.vendasListaPagina = p => SHC.VENDAS_LISTA_URL + (p > 1 ? '?page=' + p : '');
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
                situacao: txt(por['detail-title']).slice(0, 120),
                // v3.2: "O assistente confirmou que não foi sua responsabilidade…" (detail-description): decide se a tarifa de devolução dá para questionar.
                // Só fica quando fala de responsabilidade (outro texto livre do ML não é guardado).
                descricao: (d => (/responsabilidad|culpa/i.test(d) ? d : ''))(txt(por['detail-description']).slice(0, 160)) });
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
            let id = c.titulo && SHC.mlbPorTitulo ? SHC.mlbPorTitulo(c.titulo, itens || []) : null, it = id && porId[id], ids = id ? [id] : [];
            // F12: Clássico + Premium (ou variações) com o MESMO título não casam com um MLB só; se todos têm o mesmo SKU, o caso é desse SKU.
            if (!it && c.titulo) {
                const n = SHC.normalizaTitulo(c.titulo), mesmos = (itens || []).filter(x => x && x.itemId && x.sku && SHC.normalizaTitulo(x.titulo) === n);
                if (mesmos.length > 1 && mesmos.every(x => x.sku === mesmos[0].sku)) { it = mesmos[0]; ids = [...new Set(mesmos.map(x => x.itemId))]; }
            }
            const chave = (it && (it.sku || it.itemId)) || c.titulo || '—';
            const p = porProd[chave] || (porProd[chave] = { chave, sku: (it && it.sku) || '', itemId: (it && it.itemId) || '', itemIds: [], titulo: (it && it.titulo) || c.titulo || '', casos: 0, valor: 0, motivos: {} });
            ids.forEach(x => { if (p.itemIds.indexOf(x) < 0) p.itemIds.push(x); });   // F12: % de vendas soma todos os MLB do produto
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
    const ANOM_TIPOS = ['full', 'estoque', 'frete', 'pagamento', 'custo', 'posvenda', 'ads', 'fiscal', 'visitas', 'medidas', 'perguntas', 'reputacao', 'familia', 'prejuizo', 'promo', 'experiencia'];
    const ANOM_ABA = { full: 'full', estoque: 'full', frete: 'frete', pagamento: 'conciliacao', custo: 'conciliacao', posvenda: 'posvenda',   // v2.9: aba Pós-venda; v3.1: custo novo na fatura
        ads: 'ads', fiscal: 'saude', visitas: 'saude', medidas: 'saude', perguntas: 'saude', reputacao: 'saude', familia: 'geral',
        prejuizo: 'conciliacao',   // v3.2: venda nova no prejuízo (módulo do Fechamento: desligado → não conta)   // v2.9: perguntas e reputação na aba Saúde; v3.1: família na Geral
        promo: 'promo',   // v3.2.0: saiu da promoção / promoção que termina em N dias (SHC.promoAlertas)
        experiencia: 'saude' };   // v3.3: experiência de compra do anúncio (SHC.experienciaAlertas) e os avisos do ML sobre exposição
    /**
     * conta = sellerId; dados = { alertas (SHC.alertasDe), posvenda (posvenda:<conta>), frete (frete:<conta>:hist), conferir (conferir:<conta>),
     *   rateio (fech:<conta>:rateio), cert (cert:<conta>), medidas (medidas:<conta>), nfe? ([nfe:<conta>:<mês>…], v2.8), fatura? (fat:<conta>, custo novo, v3.1), titulos? ({MLB: título}, para o texto), promo? (SHC.promoAlertas, v3.2.0), agora? (ms) }.
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
            if (p.talvezUnidades) return;   // v3.1: pode ter 2+ unidades → o aviso não pede revisão dele (a aba Frete mostra com *)
            const k = p.itemId || 'pedido ' + p.pedido, x = porItem[k] || (porItem[k] = { n: 0, dif: 0 });
            x.n++; x.dif = SHC.r2(x.dif + p.diferenca);
        });
        // 3.3.0, trava do frete (06/10): o aviso diz "para conferir", nunca "a mais": a régua (frete do anúncio de 1 unidade) não sabe a faixa de
        // preço, o peso nem as unidades da venda, e o Copiloto não monta mais chamado de frete até a regra precisa (3.3.1).
        Object.keys(porItem).forEach(k => add('frete', nome(k) + ': frete para conferir em ' + SHC.qtd(porItem[k].n, 'pedido', 'pedidos') + ' (' + SHC.moeda(porItem[k].dif)
            + ' de diferença para o frete do anúncio). Pode estar certo: confira no detalhe da venda.', { chave: 'anom|frete|' + k, itemId: /^MLB/.test(k) ? k : '' }));
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
            // v3.3: dúvida ("pode estar certo") não soma R$: o pedido só com dúvidas aparece sem valor.
            // 3.3.0, trava do frete: o frete fora da curva (regra 'frete') também, mesmo o guardado antes da trava (sem a dúvida), e todo frete de envio
            // pelo tipo (SHC.fech.freteSemChamado: a repetida e a de venda cancelada) onde o fechamento.js está carregado (fundo e Fechamento).
            if (!x.duvida && !(SHC.fech ? SHC.fech.freteSemChamado(x) : x.regra === 'frete')) y.dif = SHC.r2(y.dif + (x.diferenca || 0));
        });
        Object.keys(pedPag).forEach(k => add('pagamento', 'Pedido ' + k + ': ' + (pedPag[k].dif > 0 ? SHC.moeda(pedPag[k].dif) + ' a conferir. ' : 'cobrança para conferir (pode estar certa). ') + (pedPag[k].motivo || ''), { chave: 'anom|pag|' + k, itemId: pedPag[k].itemId || '' }));
        ((d.rateio && d.rateio.faturas) || []).forEach(f => {
            if (!f || f.conferido !== false || f.incompleto || !(Math.abs(SHC.num(f.diferenca) || 0) >= 1)) return;
            add('pagamento', 'Fatura ' + (f.nome || f.fatura) + ': o total não bate com as cobranças lidas (diferença de ' + SHC.moeda(Math.abs(f.diferenca)) + ').', { chave: 'anom|fatura|' + f.fatura, link: f.linkDetalhe || '' });
        });
        // Pós-venda: reclamações/mediações e devoluções em aberto (mensagens ficam só no resumo).
        const pv = d.posvenda || {};
        if (pv.reclamacoes > 0) add('posvenda', SHC.qtd(pv.reclamacoes, 'reclamação ou mediação em aberto', 'reclamações ou mediações em aberto') + ' no pós-venda.', { chave: 'anom|pv|reclamacoes', qtd: pv.reclamacoes, link: SHC.POSVENDA_URL, vermelho: true });
        if (pv.devolucoes > 0) add('posvenda', SHC.qtd(pv.devolucoes, 'devolução pendente', 'devoluções pendentes') + ' no pós-venda.', { chave: 'anom|pv|devolucoes', qtd: pv.devolucoes, link: SHC.POSVENDA_URL });
        // Medidas da embalagem mudadas nos últimos 30 dias (fora as do próprio seller): 1 por anúncio. Rastreio 07/10: "o Mercado Livre mudou" só
        // com a marca de autoria (quem 'ml'); sem ela, a medida mudou e o seller confere se foi ele.
        const mm = d.medidas && d.medidas.porItem && SHC.medidasMudadas ? SHC.medidasMudadas(d.medidas.porItem, agora - 30 * 864e5) : [], mIds = new Set();
        mm.forEach(m => { if (mIds.has(m.itemId)) return; mIds.add(m.itemId); add('medidas', nome(m.itemId) + (m.quem === 'ml' ? ': o Mercado Livre mudou as medidas da embalagem para ' + SHC.medidaTxt(m.depois) + '.' : ': a medida da embalagem mudou para ' + SHC.medidaTxt(m.depois) + '. Se não foi você, peça a revisão ao ML (texto pronto na aba Saúde).'), { chave: 'anom|medidas|' + m.itemId, itemId: m.itemId }); });
        // v2.7: remessas do Full com inconformidade ou multa (SHC.remessasResumo): 1 por remessa.
        const rm = d.remessas || {}, porRem = {};
        (rm.comInconformidade || []).forEach(r => { porRem[r.id] = (r.textos || []).slice(); });
        (rm.comMulta || []).forEach(r => { (porRem[r.id] || (porRem[r.id] = [])).push(r.texto); });
        // v2.9: remessa recebida com inconformidade (90 dias): motivo + o que o ML cobrou; o link abre a remessa, onde se reclama.
        // 3.3.0 (regra da dona): o custo da remessa (total_charged) é coleta e/ou penalidade, nunca "cobrado pela inconformidade": o texto diz.
        // Reclamação já aberta ou o ML não aceita mais reclamar: sai do sino (a multa, se houver, continua).
        const multaIds = new Set((rm.comMulta || []).map(r => String(r.id)));
        (rm.inconformes || []).filter(r => !SHC.remessaPendente(r)).forEach(r => { if (!multaIds.has(r.id)) delete porRem[r.id]; });
        (rm.inconformes || []).filter(SHC.remessaPendente).forEach(r => {
            const t = porRem[r.id] || (porRem[r.id] = []);
            r.motivos.forEach(m => { if (!t.some(x => x.toLowerCase().indexOf(m.toLowerCase()) >= 0)) t.push(m); });   // "3 unidades não aptas…" do detalhe já diz o motivo
            if (r.custo) t.push('o ML cobrou ' + SHC.moeda(r.custo) + ' na remessa (coleta e/ou penalidade)');
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
        // v3.1: custo novo (ou que subiu muito) na fatura (fat:<conta>.categorias): 1 por tipo de tarifa, com o link da fatura.
        if (d.fatura) SHC.custosNovos(d.fatura).itens.forEach(x => add('custo', (x.novo ? 'Custo novo na fatura: ' : 'Custo que subiu na fatura: ') + SHC.custoNovoTxt(x), { chave: 'anom|' + x.chave, link: x.link }));
        // v3.1: faturamento por família — SKUs para repor, enviar ao Full, baixar preço ou parados (SHC.familiasAcoes): 1 item só, com o resumo.
        if (d.familias && d.familias.total > 0) add('familia', 'Faturamento por família: ' + d.familias.texto + '.', { chave: 'anom|familia', qtd: d.familias.total });
        // v3.2: venda nova no prejuízo (prejuizo:<conta>, SHC.vendasPrejuizo): 1 por venda, ou 1 só com todas quando passam de 3. Urgente.
        if (d.prejuizo && SHC.prejuizoAlertas) SHC.prejuizoAlertas(d.prejuizo, agora).forEach(a => add('prejuizo', a.texto, a));
        // v3.2.0: avisos de promoção já montados (SHC.promoAlertas): 1 por anúncio que saiu da promoção e 1 por promoção que está acabando.
        (d.promo || []).forEach(a => add('promo', a.texto, a));
        // v3.3 (pedido da dona 07/10/2026): experiência de compra de cada anúncio (exp:<conta>, SHC.experienciaAlertas): 1 por anúncio/produto,
        // vermelho com pausa/moderação ou nota ruim. + os avisos da lista de Anúncios (fiscal:<conta>.tarefas) que falam de experiência,
        // exposição, moderação ou qualidade — o texto e o link são os do próprio ML.
        if (d.experiencia && SHC.experienciaAlertas) SHC.experienciaAlertas(d.experiencia, { itens: d.itens || [], antes: d.experiencia.antes })
            .forEach(a => add('experiencia', a.texto + ' ' + a.acao, { chave: 'anom|exp|' + a.id, itemId: a.itemId, vermelho: a.vermelho }));
        (d.tarefas || []).filter(t => t && t.qtd > 0 && /experi|exposi|moder|reputa|qualidad|PURCHASE_EXPERIENCE|EXPOSURE|MODERAT|QUALITY/i.test([t.id, t.titulo, t.texto].join(' ')))
            .forEach(t => add('experiencia', [t.titulo, t.texto].filter(Boolean).join(': ') + ' (' + SHC.qtd(t.qtd, 'anúncio', 'anúncios') + ')', { chave: 'anom|tarefa|' + t.id, qtd: t.qtd, link: t.link || '' }));
        // v2.8: módulo desligado pelo seller (Ajustes) → a anomalia dele não conta nem aparece ("N coisas pedem sua atenção" e o ícone).
        const itensVis = itens.filter(i => SHC.moduloLigado(cfg, i.aba));
        const porTipo = {};
        ANOM_TIPOS.forEach(t => { porTipo[t] = 0; });
        itensVis.forEach(i => { porTipo[i.tipo] += i.tipo === 'posvenda' || i.tipo === 'prejuizo' ? i.qtd : 1; });   // v3.2: prejuízo conta cada venda
        const total = ANOM_TIPOS.reduce((s, t) => s + porTipo[t], 0);
        return { conta: conta || '', total, porTipo, vermelho: porTipo.pagamento > 0 || itensVis.some(i => (i.tipo === 'posvenda' || i.tipo === 'perguntas' || i.tipo === 'reputacao' || i.tipo === 'prejuizo' || i.tipo === 'experiencia') && i.vermelho), itens: itensVis };
    };
    const ANOM_NOMES = { full: ['no Full', 'no Full'], estoque: ['sem estoque no Full', 'sem estoque no Full'], frete: ['de frete', 'de frete'],
        pagamento: ['cobrança a conferir', 'cobranças a conferir'], custo: ['custo novo na fatura', 'custos novos na fatura'], posvenda: ['no pós-venda', 'no pós-venda'], ads: ['de Ads', 'de Ads'],
        fiscal: ['fiscal', 'fiscais'], visitas: ['de visitas', 'de visitas'], medidas: ['de medidas', 'de medidas'], perguntas: ['de perguntas', 'de perguntas'], reputacao: ['de reputação', 'de reputação'],
        familia: ['de estoque × venda', 'de estoque × venda'], prejuizo: ['venda no prejuízo', 'vendas no prejuízo'], promo: ['de promoção', 'de promoção'],
        experiencia: ['de experiência de compra', 'de experiência de compra'] };
    /** Título do ícone: "Copiloto: 5 pontos de atenção — 2 no Full, 1 de frete, 2 no pós-venda" (sem nada: "Abrir o Copiloto"). */
    SHC.anomaliasTitulo = function (a) {
        if (!a || !(a.total > 0)) return 'Abrir o Copiloto';
        const partes = ANOM_TIPOS.filter(t => a.porTipo[t] > 0).map(t => a.porTipo[t] + ' ' + ANOM_NOMES[t][a.porTipo[t] === 1 ? 0 : 1]);
        return 'Copiloto: ' + SHC.qtd(a.total, 'ponto de atenção', 'pontos de atenção') + ' — ' + partes.join(', ');
    };

    // ── v3.2 (pesquisa de mercado aprovada pela dona): AVISO DE VENDA NOVA NO PREJUÍZO ──
    // A cada sincronização o fundo lê a 1ª página da lista de Vendas (SHC.mlVendasDaLista: só produto, valor, status e dia; nada do comprador)
    // e faz a MESMA conta da etiqueta de lucro da lista (SHC.telaVendaConta). Venda nova com custo informado que deu prejuízo vira alerta
    // urgente (1 vez por pedido, nunca de novo). Sem custo → não alerta (conta em "sem custo"). Tudo em prejuizo:<conta>; nada é enviado.
    SHC.VENDAS_LISTA_URL = 'https://vendedores.mercadolivre.com.br/vendas/omni/lista';
    const PREJ_GUARDA_MS = 9 * 864e5;   // quanto tempo as vendas no prejuízo ficam em prejuizo:<conta> (resumo da semana = 7 dias + folga)
    SHC.vendaLink = pedido => 'https://www.mercadolivre.com.br/vendas/' + String(pedido).replace(/\D+/g, '') + '/detalhe';
    const MES_CURTO = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
    /** Dia da venda como a lista mostra ("24 set 20:27 hs", "Hoje 14:32", "Ontem") → 'AAAA-MM-DD' | '' (sem ano: o de hoje; data no futuro = ano passado). */
    SHC.dataVendaLista = function (txt, hoje) {
        const t = String(txt || '').toLowerCase(), h = hoje || SHC.hoje();
        if (/\bhoje\b/.test(t)) return h;
        if (/\bontem\b/.test(t)) return diaMenosX(h, 1);
        const m = /(\d{1,2})\s*(?:de\s+)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*\.?(?:\s*(?:de\s+)?(\d{4}))?/.exec(t);
        if (!m || !(+m[1] >= 1 && +m[1] <= 31)) return '';
        const z = n => String(n).padStart(2, '0'), ano = m[3] ? +m[3] : +h.slice(0, 4);
        let d = ano + '-' + z(MES_CURTO[m[2]]) + '-' + z(+m[1]);
        if (!m[3] && d > h) d = (ano - 1) + d.slice(4);
        return d;
    };
    // Nome curto do produto: até ~38 letras, cortado na palavra, sem terminar em "de/com/para…", e com "…" quando cortado.
    const nomeCurto = t => {
        const s = String(t || '').replace(/\s+/g, ' ').trim(); if (s.length <= 38) return s;
        const c = s.slice(0, 37); let r = c.slice(0, c.lastIndexOf(' ') > 15 ? c.lastIndexOf(' ') : 37).replace(/[\s,.;:-]+$/, '');
        while (/\s(de|da|do|das|dos|com|para|p\/|e|em|sem|a|o|na|no|por)$/i.test(r)) r = r.replace(/\s\S+$/, '').replace(/[\s,.;:-]+$/, '');
        return r + '…';
    };
    /**
     * Motivo principal do prejuízo de 1 venda. c = SHC.telaVendaConta; anuncio(MLB) → item do retrato; tipico(MLB) → frete típico por pedido
     * (frete:<conta>:hist, últimos 30 dias) | null. Pesa em R$ o frete acima do de sempre (só com o frete cobrado de verdade) e o desconto
     * contra o preço de hoje do anúncio; sem nenhum dos dois, a tarifa do Premium; senão o custo que não cabe no preço. → texto curto.
     */
    SHC.prejuizoMotivo = function (c, anuncio, tipico) {
        const cands = [], m = SHC.moeda, r2 = SHC.r2;
        if (c.freteFonte === 'faturamento' && c.itens.length === 1) {
            const x = c.itens[0], it = anuncio(x.itemId) || {}, t = tipico ? tipico(x.itemId) : null;
            const base = t > 0 ? t : (it.frete > 0 ? r2(it.frete * x.qtd) : null);
            if (base > 0 && c.frete >= base * 1.3 && c.frete - base >= 5) cands.push({ peso: c.frete - base, txt: 'frete de ' + m(c.frete) + ', maior que o de sempre (' + m(base) + ')' });
        }
        c.itens.forEach(x => {
            const it = anuncio(x.itemId) || {}, un = x.qtd > 0 ? r2(x.valor / x.qtd) : x.valor;
            if (!(it.preco > 0) || !(un < it.preco * 0.97) || it.preco - un < 1) return;
            cands.push({ peso: (it.preco - un) * x.qtd, txt: un < x.custoUn + x.outrosUn ? 'promoção abaixo do custo: vendeu a ' + m(un) + ' e o produto custa ' + m(r2(x.custoUn + x.outrosUn))
                : 'vendeu com desconto (' + m(un) + '; o anúncio está a ' + m(it.preco) + ')' });
        });
        if (cands.length) return cands.sort((a, b) => b.peso - a.peso)[0].txt;
        const pr = c.itens.find(x => /premium/i.test(x.tipo || ''));
        if (pr) return 'tarifa do Premium (' + SHC.pctTxt(pr.taxaPct) + ', ' + m(pr.tarifa) + ')';
        if (c.custo + c.outros > c.recebe) return 'o custo do produto (' + m(r2(c.custo + c.outros)) + ') passa do que o ML repassa (' + m(c.recebe) + ')';
        return 'tarifa, frete, imposto e custo passam do preço';
    };
    /**
     * vendas = SHC.mlVendasDaLista (1ª página da lista); ant = prejuizo:<conta> guardado | null.
     * o = { anuncio(MLB), custoDe(produto), cfg, pedidos (frete:<conta>:pedidos.pedidos), vendasFat (… .vendas: dia pela cobrança), tipico(MLB), hoje, agora,
     *       extras (SHC.vendaExtras: tarifa real, afiliado e Full — os mesmos da etiqueta da tela) }.
     * Nova = pedido nunca visto, do dia da última leitura em diante (ou de ontem, o que vier antes; dia da lista; sem ele, o da cobrança
     * "Custo por vender"). Assim a venda feita depois de uma leitura de manhã e vista só 2 dias depois ainda é conferida. Na 1ª leitura, venda
     * sem dia só é marcada como vista (nunca alerta o passado). Vista de vez: cancelada, sem custo, prejuízo, ou lucro com o frete já cobrado
     * (lucro com frete estimado é refeito na próxima: o frete de verdade pode virar a conta). Anúncio fora do retrato: refeita na próxima.
     * → { ts, dia, desde (1ª leitura), lidos:[dia com leitura, 10 dias], completos:[dia com TODAS as vendas conferidas, 10 dias], cobre (desde que dia
     *   a conferência é contínua), furo (dia desde quando pode faltar venda: 1ª página que não alcançou a leitura anterior; '' = nenhum),
     *   cortes:[dia em que a 1ª página parou no meio], conf:{dia: {c: conferidas com custo, s: sem custo}},
     *   pend:{pedido: dia} (conferida, frete estimado), fora:{pedido: dia} (anúncio fora do retrato: ainda não conferida), vistos:{pedido: dia},
     *   itens:[{pedido, itemId, titulo, sobra, total, motivo, estimado, dia, ts}] (9 dias; sai se aparecer cancelada), semCusto:[pedido] (de hoje), lidas }
     */
    SHC.vendasPrejuizo = function (vendas, ant, o) {
        o = o || {};
        const hoje = o.hoje || SHC.hoje(), agora = o.agora || Date.now(), ontem = diaMenosX(hoje, 1), limite = diaMenosX(hoje, 40), a = ant || {}, primeira = !a.vistos || !!(a.dia && a.dia < limite);   // leitura de 40+ dias atrás = como a 1ª
        // Sem leitura ontem: confere desde o dia da última leitura. Com um "furo" aberto (1ª página que não alcançou a leitura anterior): desde ele.
        const d10 = diaMenosX(hoje, 10), furoAnt = !primeira && a.furo && a.furo >= d10 ? a.furo : '';
        const novaDesde = [ontem, !primeira && a.dia ? a.dia : '', furoAnt].filter(Boolean).sort()[0];
        const vistos = {};
        Object.keys(a.vistos || {}).forEach(p => { if (a.vistos[p] >= limite) vistos[p] = a.vistos[p]; });
        // 9 dias guardados (o "Resumo da semana" lê as vendas no prejuízo dos 7 dias antes de hoje); o alerta continua só das últimas 24 h (SHC.prejuizoAlertas).
        const itens = (a.itens || []).filter(x => x && x.ts > agora - PREJ_GUARDA_MS);
        const semCusto = a.dia === hoje ? (a.semCusto || []).slice() : [];
        // Dias com leitura (10 dias: a semana do resumo + folga) e a 1ª leitura. Nunca apagados pelas leituras seguintes, só pela idade.
        // Leitura antiga sem "lidos": vale o dia dela (a.dia).
        const lidos = [...new Set((a.lidos || (a.dia ? [a.dia] : [])).concat(hoje))].filter(x => x >= d10).sort();
        const desde = !primeira && a.desde ? a.desde : lidos[0];
        // Quantas vendas de cada dia foram conferidas (com custo) e quantas ficaram sem custo: o resumo nunca dá ✅ sem ter conferido nada.
        const poda = m => { const r = {}; Object.keys(m || {}).forEach(k => { if (m[k] >= d10) r[k] = m[k]; }); return r; };
        const conf = {}, pend = poda(a.pend), fora = poda(a.fora);
        Object.keys(a.conf || {}).forEach(k => { if (k >= d10) conf[k] = { c: +(a.conf[k] || {}).c || 0, s: +(a.conf[k] || {}).s || 0 }; });
        const conta = (k, t) => { const x = conf[k] || (conf[k] = { c: 0, s: 0 }); x[t]++; };
        const canceladas = new Set();
        let toca = false, maisVelho = '', semDia1 = false;
        (vendas || []).forEach(v => {
            if (!v || !v.pedido) return;
            const p = v.pedido, fat = o.vendasFat && o.vendasFat[p], dia = SHC.dataVendaLista(v.quando, hoje) || (fat && fat.data) || '';
            if ((a.vistos && a.vistos[p]) || (a.pend && a.pend[p]) || (a.fora && a.fora[p])) toca = true;   // a página alcançou a leitura anterior
            if (dia && (!maisVelho || dia < maisVelho)) maisVelho = dia;
            if (vistos[p]) { vistos[p] = hoje; if (v.cancelada) canceladas.add(p); return; }   // ainda na lista: renova (a poda de 40 dias nunca a faz "nova" de novo); cancelada depois sai do prejuízo
            if (v.cancelada || (dia ? dia < novaDesde : primeira)) { vistos[p] = hoje; delete pend[p]; delete fora[p]; if (!dia && !v.cancelada) semDia1 = true; return; }   // antiga (ou sem dia na 1ª leitura): só marca
            // o.extras = SHC.vendaExtras(...): a mesma tarifa real (cob), afiliado e Full da etiqueta da tela → a mesma conta nos dois lugares.
            const dk = dia || hoje, c = SHC.telaVendaConta ? SHC.telaVendaConta(v, o.anuncio, o.custoDe, o.cfg, o.pedidos, o.extras ? o.extras(v) : null) : null;
            if (!c) { fora[p] = dk; return; }
            delete fora[p];
            if (c.semCusto) { vistos[p] = hoje; conta(dk, 's'); if (semCusto.indexOf(p) < 0) semCusto.push(p); return; }
            if (!pend[p]) conta(dk, 'c');
            if (!(c.sobra < 0)) { if (c.freteFonte !== 'estimado') { vistos[p] = hoje; delete pend[p]; } else pend[p] = dk; return; }
            vistos[p] = hoje; delete pend[p];
            const p0 = v.produtos[0], it = o.anuncio(p0.itemId) || {};
            const titulo = nomeCurto(p0.titulo || it.titulo || p0.itemId) + (v.produtos.length > 1 ? ' e mais ' + (v.produtos.length - 1) : '');
            itens.push({ pedido: p, itemId: p0.itemId, sku: p0.sku || it.sku || '', titulo, sobra: c.sobra, total: c.total, motivo: SHC.prejuizoMotivo(c, o.anuncio, o.tipico), estimado: c.freteFonte === 'estimado', dia: dk, ts: agora });
        });
        // Dias inteiros conferidos. A lista vem da mais nova para a mais velha: se a 1ª página não chegou numa venda já vista (nem num dia antes
        // da leitura anterior), pode ter vendas no meio que nunca foram lidas: só conta inteiro do dia seguinte à venda mais velha da página e
        // abre um "furo" (furo = dia da leitura anterior). O furo fecha quando uma página chega antes dele: as vendas do meio, nunca vistas,
        // são conferidas nessa leitura (novaDesde) e os dias desde o furo passam a contar inteiros.
        const nv = (vendas || []).length, ref = primeira ? ontem : (a.dia || ontem);
        const chegou = !nv || toca || (!!maisVelho && maisVelho < ref), fechou = !!furoAnt && !!maisVelho && maisVelho < furoAnt;
        const base = primeira ? ontem : (a.cobre || a.dia || ontem);
        const cobre = primeira && semDia1 ? hoje : fechou ? furoAnt : chegou ? base : (maisVelho ? diaMenosX(maisVelho, -1) : hoje);
        const furo = fechou ? '' : !chegou ? (furoAnt || ref) : furoAnt;
        const completos = new Set((a.completos || []).filter(x => x >= d10));
        for (let k = cobre > d10 ? cobre : d10; k < hoje; k = diaMenosX(k, -1)) completos.add(k);
        const cortes = (a.cortes || []).filter(x => x >= d10).concat(!chegou && maisVelho && maisVelho < hoje ? [maisVelho] : []);
        const ks = Object.keys(vistos);
        if (ks.length > 800) ks.sort((p, q) => (vistos[p] < vistos[q] ? -1 : 1)).slice(0, ks.length - 800).forEach(p => { delete vistos[p]; });
        return { ts: agora, dia: hoje, desde, lidos, completos: [...completos].sort(), cobre, furo, cortes: [...new Set(cortes)].sort(), conf, pend, fora, vistos,
            itens: itens.filter(x => !canceladas.has(x.pedido)).slice(-200), semCusto: semCusto.slice(-200), lidas: nv };
    };
    /**
     * prejuizo:<conta> → alertas para SHC.anomalias: até 3 vendas, 1 por venda ("Venda no prejuízo: Fone Bluetooth · −R$ 5,77"); mais que isso,
     * 1 só ("5 vendas no prejuízo hoje: −R$ 123,00"). Só as achadas nas últimas 24 h E vendidas ontem ou hoje: a venda de 2 dias atrás achada
     * agora (Chrome fechado no meio) entra só no Resumo da semana, nunca como alerta novo do passado. → [{texto, titulo, motivo, chave, link, itemId?, qtd, vermelho}]
     */
    SHC.prejuizoAlertas = function (snap, agora) {
        const t = agora || Date.now(), ontemA = diaMenosX(diaLocal(t), 1), m = SHC.moeda;
        const its = ((snap && snap.itens) || []).filter(x => x && x.ts > t - 864e5 && x.sobra < 0 && !(x.dia && x.dia < ontemA));
        if (!its.length) return [];
        const nSem = ((snap && snap.semCusto) || []).length;
        // "À parte": as vendas sem custo não são desta venda; "com frete estimado" fica junto do valor do prejuízo (não do último R$ do motivo).
        const sem = nSem ? ' À parte: ' + SHC.qtd(nSem, 'venda nova sem custo informado ficou', 'vendas novas sem custo informado ficaram') + ' de fora.' : '';
        const mot = x => x.motivo.charAt(0).toUpperCase() + x.motivo.slice(1) + '.';
        const perda = x => '−' + m(-x.sobra) + (x.estimado ? ', com frete estimado' : '');
        if (its.length <= 3) return its.map((x, i) => {
            const titulo = 'Venda no prejuízo: ' + x.titulo + ' · ' + perda(x), motivo = mot(x) + (i === 0 ? sem : '');
            return { texto: titulo + '. ' + motivo, titulo, motivo, chave: 'anom|prejuizo|' + x.pedido, link: SHC.vendaLink(x.pedido), itemId: x.itemId, qtd: 1, vermelho: true };
        });
        const soma = SHC.r2(its.reduce((s, x) => s + x.sobra, 0)), pior = its.slice().sort((a, b) => a.sobra - b.sobra)[0];
        const hojeTodas = its.every(x => x.dia === SHC.hoje());
        const titulo = SHC.qtd(its.length, 'venda', 'vendas') + ' no prejuízo ' + (hojeTodas ? 'hoje' : 'nas últimas 24 horas') + ': −' + m(-soma);
        const motivo = 'A pior: ' + pior.titulo + ', ' + perda(pior) + ': ' + pior.motivo + '.' + sem;
        return [{ texto: titulo + '. ' + motivo, titulo, motivo, chave: 'anom|prejuizo|grupo', link: SHC.VENDAS_LISTA_URL, qtd: its.length, vermelho: true }];
    };

    // ── v3.2.0 (pergunta da dona 01/10/2026: "o sistema consegue me avisar quando o produto sai da promoção?"): AVISO DE PROMOÇÃO ──
    // Só o que o Copiloto já guarda (ml:anuncios:<conta> e ml:promos:<conta>): nenhum GET a mais e nada é enviado.
    SHC.PROMOS_URL = 'https://vendedores.mercadolivre.com.br/anuncios/lista/promos';   // Central de promoções (atalho dos avisos)
    SHC.PROMO_AVISO_DIAS = 2;   // padrão do "termina em N dias" (Ajustes: cfg.promo_aviso_dias)
    const PROMO_SAIU_DIAS = 30, PROMO_SAIU_MAX = 200, PROMO_SAIU_ALERTA_DIAS = 3;
    const diaBR = d => String(d).slice(8, 10) + '/' + String(d).slice(5, 7);
    /**
     * "Saiu da promoção". antes = itens do retrato anterior da conta; lidos = os itens DESTA leitura (como ficaram no retrato novo).
     * Só compara o MLB que está nas duas: leitura parcial nunca vira evento do que não veio. Evento = antes em promoção (emPromocao, preço > 0)
     * e agora sem promoção, ATIVO e com preço lido — pausado, encerrado, sem status ou sem preço (faixa de variações) não contam.
     * hist = promoSaiu:<conta> | null → o mesmo hist (nada mudou) ou { ts, eventos:[{itemId, titulo, sku, precoPromo, precoAgora, quando:'AAAA-MM-DD', ts}] }
     * (30 dias, até 200; o mesmo MLB no mesmo dia entra 1 vez).
     */
    SHC.promoSaiuRegistra = function (hist, antes, lidos, agora) {
        const t = agora || Date.now(), hoje = diaLocal(t), ant = {}, todos = (hist && hist.eventos) || [];
        const velhos = todos.filter(e => e && e.ts > t - PROMO_SAIU_DIAS * 864e5);
        (antes || []).forEach(i => { if (i && i.itemId && !ant[i.itemId]) ant[i.itemId] = i; });
        const novos = [], visto = new Set(velhos.filter(e => e.quando === hoje).map(e => e.itemId));
        (lidos || []).forEach(n => {
            const a = n && ant[n.itemId];
            if (!a || visto.has(n.itemId) || !a.emPromocao || !(a.preco > 0) || n.emPromocao || !(n.preco > 0) || !SHC.anuncioAtivo(n)) return;
            visto.add(n.itemId);
            novos.push({ itemId: n.itemId, titulo: String(n.titulo || a.titulo || '').slice(0, 120), sku: n.sku || a.sku || '', precoPromo: a.preco, precoAgora: n.preco, quando: hoje, ts: t });
        });
        if (!novos.length && velhos.length === todos.length) return hist;
        return { ts: t, eventos: velhos.concat(novos).slice(-PROMO_SAIU_MAX) };
    };
    /**
     * Fim da promoção no texto de datas da Central ("24/set a 15/out", "21 a 30/set", "30/set") → 'AAAA-MM-DD' | ''.
     * "10.10", "MES 10" ou vazio são nomes de campanha, SEM data de fim no retrato: '' (nunca inventa). O texto não traz o ano: vale o de hoje;
     * data mais de 180 dias antes de hoje é do ano que vem (hoje em dezembro, fim "5/jan").
     */
    SHC.promoFimData = function (datas, hoje) {
        const h = hoje || SHC.hoje(), ms = [...String(datas || '').toLowerCase().matchAll(/(\d{1,2})\s*\/\s*(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)/g)], m = ms[ms.length - 1];
        if (!m || !(+m[1] >= 1 && +m[1] <= 31)) return '';
        const z = n => String(n).padStart(2, '0'), ano = +h.slice(0, 4);
        const d = ano + '-' + z(MES_CURTO[m[2]]) + '-' + z(+m[1]);
        return d < diaMenosX(h, 180) ? (ano + 1) + d.slice(4) : d;   // ponytail: virada de ano pelos 180 dias; se o ML mandar o ano no texto, usar o dele
    };
    /**
     * "A promoção termina em N dias". O retrato da Central NÃO diz em qual oferta o anúncio está participando: vale a proposta do MESMO MLB com o
     * MESMO preço da promoção ativa no retrato dos anúncios (emPromocao, ativo; ± R$ 0,01). "Nova proposta…" é convite para entrar: só conta se
     * nenhuma outra casar. Mais de uma com data: a que acaba primeiro (avisar cedo é melhor que tarde); oferta com fim já passado não conta.
     * ponytail: casamento pelo preço (conferido no retrato real de 01/10/2026: 152 de 184 casam numa conta); se o ML mandar a oferta ativa com a
     * data de fim, trocar por ela. Sem proposta casada: não avisa. Alguma casada sem data de fim no texto ("10.10", "MES 10", vazio): não avisa e
     * conta em semData (o anúncio pode estar nela). Todas as casadas com fim já passado (retrato da Central velho): não avisa e conta em vencidas.
     * → { itens:[{itemId, titulo, sku, promo, fim, dias, preco}] (0 ≤ dias ≤ limite; quem acaba primeiro em cima), semData, vencidas, casados }
     */
    SHC.promoTermina = function (itens, promos, hoje, limite) {
        const h = hoje || SHC.hoje(), l = SHC.num(limite), lim = l !== null && l >= 0 ? l : SHC.PROMO_AVISO_DIAS, porItem = {};
        ((promos && promos.propostas) || []).forEach(p => { if (p && p.itemId) (porItem[p.itemId] || (porItem[p.itemId] = [])).push(p); });
        const out = [], visto = new Set();
        let semData = 0, vencidas = 0, casados = 0;
        (itens || []).forEach(i => {
            if (!i || !i.emPromocao || !(i.preco > 0) || !SHC.anuncioAtivo(i) || visto.has(i.itemId)) return;
            visto.add(i.itemId);
            const cas = (porItem[i.itemId] || []).filter(p => typeof p.preco === 'number' && Math.abs(p.preco - i.preco) < 0.015);
            if (!cas.length) return;
            casados++;
            const firmes = cas.filter(p => !/^nova proposta/i.test(String(p.promo || '')));
            const cand = (firmes.length ? firmes : cas).map(p => ({ p, fim: SHC.promoFimData(p.datas, h) }));
            // Revisão 01/10/2026: casou também com uma oferta SEM data ("MES 10"): o anúncio pode estar nela → o fim não é conhecido, não avisa.
            if (cand.some(x => !x.fim)) { semData++; return; }
            const comFim = cand.filter(x => x.fim >= h).sort((a, b) => (a.fim < b.fim ? -1 : 1));
            if (!comFim.length) { vencidas++; return; }   // todas as ofertas casadas já acabaram: o retrato da Central está velho (≠ sem data)
            const x = comFim[0], dias = Math.round((Date.parse(x.fim + 'T12:00:00Z') - Date.parse(h + 'T12:00:00Z')) / 864e5);
            if (dias <= lim) out.push({ itemId: i.itemId, titulo: i.titulo || '', sku: i.sku || '', promo: x.p.promo || 'Promoção', fim: x.fim, dias, preco: i.preco });
        });
        return { itens: out.sort((a, b) => a.dias - b.dias), semData, vencidas, casados };
    };
    SHC.promoDiasTxt = n => (n <= 0 ? 'hoje' : n === 1 ? 'amanhã' : 'em ' + n + ' dias');
    /** "Saiu da promoção: <produto> — voltou de R$ X para R$ Y em dd/mm" */
    SHC.promoSaiuTxt = e => 'Saiu da promoção: ' + nomeCurto(e.titulo || e.itemId) + ' — voltou de ' + SHC.moeda(e.precoPromo) + ' para ' + SHC.moeda(e.precoAgora) + ' em ' + diaBR(e.quando);
    /** "A promoção de <produto> termina em 2 dias (03/10)" */
    SHC.promoTerminaTxt = x => 'A promoção de ' + nomeCurto(x.titulo || x.itemId) + ' termina ' + SHC.promoDiasTxt(x.dias) + ' (' + diaBR(x.fim) + ')';
    /**
     * Avisos de promoção para SHC.anomalias (aba Promoções, sino e "Precisa de você hoje" da Geral), com o atalho da Central de promoções:
     * cada saída dos últimos 3 dias (menos a do anúncio que já voltou para promoção no retrato) e cada promoção que termina em até N dias.
     * saiu = promoSaiu:<conta>; termina = SHC.promoTermina; itens = retrato dos anúncios. → [{texto, chave, link, itemId}]
     */
    SHC.promoAlertas = function (saiu, termina, agora, itens) {
        const t = agora || Date.now(), voltou = new Set((itens || []).filter(i => i && i.emPromocao).map(i => i.itemId)), out = [];
        ((saiu && saiu.eventos) || []).filter(e => e && e.ts > t - PROMO_SAIU_ALERTA_DIAS * 864e5 && !voltou.has(e.itemId))
            .forEach(e => out.push({ texto: SHC.promoSaiuTxt(e) + '.', chave: 'anom|promo|saiu|' + e.itemId + '|' + e.quando, link: SHC.PROMOS_URL, itemId: e.itemId }));
        ((termina && termina.itens) || []).forEach(x => out.push({ texto: SHC.promoTerminaTxt(x) + '.', chave: 'anom|promo|fim|' + x.itemId, link: SHC.PROMOS_URL, itemId: x.itemId }));
        return out;
    };
    /**
     * Efeito da saída nas vendas: 7 dias antes × 7 dias depois do dia em que saiu (vd|ml|<MLB>: pedidos lidos no Faturamento; sem q = 1 un.).
     * → { pronto:false } (ainda não passaram 7 dias) | null (sem vendas por anúncio lidas deste MLB: nada inventado) | { pronto:true, antes7, depois7, variacaoPct }
     */
    SHC.promoSaiuEfeito = function (e, vd, hoje) {
        const h = hoje || SHC.hoje();
        if (!e || !e.quando) return null;
        if (!(h > diaMenosX(e.quando, -7))) return { pronto: false };
        if (!vd || !Object.keys(vd).length) return null;
        const porDia = {};
        Object.keys(vd).forEach(k => { const p = vd[k]; if (p && p.d) porDia[p.d] = (porDia[p.d] || 0) + (p.q > 0 ? p.q : 1); });
        let antes7 = 0, depois7 = 0;
        for (let k = 1; k <= 7; k++) { antes7 += porDia[diaMenosX(e.quando, k)] || 0; depois7 += porDia[diaMenosX(e.quando, -k)] || 0; }
        return { pronto: true, antes7, depois7, variacaoPct: antes7 > 0 ? Math.round((depois7 - antes7) / antes7 * 1000) / 10 : null };
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
     * NUNCA lê affiliate{} (nome/apelido/foto do afiliado). Lê o nº do pedido (orderId) só para a comissão na etiqueta da venda (porPedido).
     */
    SHC.afilPedidos = function (j) {
        if (!j || !Array.isArray(j.sales)) return null;
        const pg = j.pagination || {};
        return { pagina: SHC.num(pg.page), paginas: SHC.num(pg.pages), total: SHC.num(pg.total !== undefined ? pg.total : j.total),
            vendas: j.sales.map(v => { const p = (v && v.product) || {}, d = (v && v.saleDetail) || {};
                const fee = SHC.num(v && v.fee);   // 0.04 = 4%
                return { itemId: mlb(p.itemId), sku: String(p.sku || ''), titulo: String(p.productTitle || ''), valor: SHC.num(v && v.saleValue), unidades: SHC.num(p.quantity),
                    comissao: SHC.num(v && v.commissionPerOrder), verificacao: String(d.verificationStatus || ''),
                    pedido: /^\d{6,}$/.test(String(d.orderId || '')) ? String(d.orderId) : '', fee: fee === null ? null : SHC.r2(fee < 1 ? fee * 100 : fee) }; }) };
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
        // v3.3: comissão POR PEDIDO para a etiqueta da lista de Vendas: { nº do pedido: { c, fee (%), st } }. Só o nº do pedido do vendedor; nada do afiliado.
        out.porPedido = {};
        (vendas || []).forEach(v => {   // "outros" (situação que o Copiloto não reconhece, ex. cancelada) não entra: não se sabe se é cobrada
            const st = SHC.afilVerificacao(v.verificacao);
            if (v.pedido && v.comissao > 0 && st !== 'outros') out.porPedido[v.pedido] = { c: r2(v.comissao), fee: v.fee, st: st === 'confirmados' ? 'confirmada' : 'não verificada' };
        });
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
    // ── v3.1: Campanhas exclusivas (menu Venda com afiliados › Campanhas exclusivas), mapeado ao vivo em 29/09/2026. GET da página
    // /seller-affiliates/target-campaign; os dados vêm no estado (appProps.pageProps.targetCampaigns.data), sem XHR. Só leitura. ──
    // Só FINISHED foi visto ao vivo; os outros nomes são A CONFIRMAR. Desconhecido → 'outro' (a tela mostra o texto cru, nunca some).
    SHC.afilExclusivaEstado = s => (/^(active|activated|in_progress|running|started|ongoing)$/i.test(s) ? 'ativa'
        : /^(scheduled|programmed|pending|not_started|upcoming)$/i.test(s) ? 'programada'
        : /^(finished|ended|expired|closed|completed)$/i.test(s) ? 'finalizada' : /^paused$/i.test(s) ? 'pausada' : 'outro');
    const diaIso = d => (/^\d{4}-\d{2}-\d{2}/.test(String(d || '')) ? String(d).slice(0, 10) : null);
    /**
     * Estado da página de campanhas exclusivas → { total, campanhas:[{ id, numero, titulo, status (cru), estado ('ativa'|'programada'|'finalizada'
     * |'pausada'|'outro'), afiliados, produtos, comissaoMin, comissaoMax (% extra), de, ate ('AAAA-MM-DD') }] } | null (sem o caminho).
     */
    SHC.afilExclusivasDoEstado = function (r) {
        const tc = achaChave(r, 'targetCampaigns', 6), d = tc && typeof tc === 'object' ? (tc.data || tc) : null;
        if (!d || !Array.isArray(d.elements)) return null;
        const campanhas = d.elements.filter(e => e && typeof e === 'object').map(e => ({ id: String(e.id || ''), numero: String(e.secondaryId || ''), titulo: String(e.title || ''),
            status: String(e.status || ''), estado: SHC.afilExclusivaEstado(String(e.status || '')), afiliados: SHC.num(e.affiliates), produtos: SHC.num(e.itemsCount),
            comissaoMin: SHC.num(e.minExtraCommission), comissaoMax: SHC.num(e.maxExtraCommission), de: diaIso(e.validFrom), ate: diaIso(e.validTo) }));
        const t = SHC.num(d.totalElements);
        return { total: t !== null && t >= campanhas.length ? t : campanhas.length, campanhas };
    };
    /** "2 campanhas exclusivas · nenhuma ativa agora" (· "1 programada") (· "mostrando 20 de 25") | "Nenhuma campanha exclusiva". */
    SHC.afilExclusivasResumo = function (ex) {
        const l = (ex && ex.campanhas) || [], n = ex && ex.total ? ex.total : l.length, conta = e => l.filter(c => c.estado === e).length;
        if (!n) return 'Nenhuma campanha exclusiva';
        const at = conta('ativa'), pr = conta('programada'), parte = l.length < n;
        return [SHC.qtd(n, 'campanha exclusiva', 'campanhas exclusivas'),
            // lista em parte ou status desconhecido ('outro', pode ser uma ativa com outro nome): não afirma "nenhuma"
            at ? SHC.qtd(at, 'ativa agora', 'ativas agora') : parte || conta('outro') ? '' : 'nenhuma ativa agora',
            pr ? SHC.qtd(pr, 'programada', 'programadas') : '', parte ? 'mostrando ' + l.length + ' de ' + n : ''].filter(Boolean).join(' · ');
    };
    /** Comissão extra: "5%" | "4%–6%" | "" (sem dado). */
    SHC.afilExclusivaComissao = function (c) {
        const a = c.comissaoMin, b = c.comissaoMax;
        if (a === null && b === null) return '';
        return a === null || b === null || a === b ? SHC.pctTxt(a === null ? b : a) : SHC.pctTxt(a) + '–' + SHC.pctTxt(b);
    };
    /** Período: "27/07 a 31/07/2026" (mesmo ano) | "20/12/2025 a 05/01/2026" | "até 31/07/2026" | "". */
    SHC.afilExclusivaPeriodo = function (c) {
        const br = (d, ano) => d.slice(8, 10) + '/' + d.slice(5, 7) + (ano ? '/' + d.slice(0, 4) : '');
        if (c.de && c.ate) return br(c.de, c.de.slice(0, 4) !== c.ate.slice(0, 4)) + ' a ' + br(c.ate, true);
        return c.ate ? 'até ' + br(c.ate, true) : c.de ? 'desde ' + br(c.de, true) : '';
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
    const linkMLOk = u => /^https:\/\/([a-z0-9-]+\.)*(mercadoli[vb]re|mercadopago)\.com\.br\//.test(String(u || ''));

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

    // ── v3.1 Registro do robô (30/09/2026). Com ROBO_ESCRITA_CONFERIDA = false o robô SÓ SUGERE: quem troca as fotos no ML é o seller.
    // robo:<conta>.registro = [{ts, itemId, motivo, antes, novaOrdem, visitas7Antes}] (máx. ROBO_REG_MAX): cada sugestão fica guardada (a lista
    // `sugestoes` é trocada a cada passada). O que aconteceu com ela sai do histórico ('manual': "Já troquei" ou percebido na leitura das fotos)
    // e da ordem das fotos lida depois dela. Nada aqui grava no ML.
    SHC.ROBO_REG_MAX = 300;
    SHC.ROBO_IGNORADA_DIAS = 14;
    const ordemTxt = a => (Array.isArray(a) ? a.join('|') : '');
    /** Junta sugestões ao registro: entra só se a última do mesmo anúncio não for a mesma (mesma ordem de antes e mesma ordem sugerida). */
    SHC.roboRegistroJunta = function (registro, novas) {
        const out = (registro || []).filter(r => r && r.itemId && Array.isArray(r.novaOrdem));
        (novas || []).forEach(s => {
            if (!s || !s.itemId || !Array.isArray(s.novaOrdem) || !s.novaOrdem.length) return;
            const ult = out.filter(r => r.itemId === s.itemId).pop();
            if (ult && ordemTxt(ult.novaOrdem) === ordemTxt(s.novaOrdem) && (!ult.antes || !s.antes || ordemTxt(ult.antes) === ordemTxt(s.antes))) return;
            out.push({ ts: s.ts || Date.now(), itemId: s.itemId, motivo: String(s.motivo || ''), antes: Array.isArray(s.antes) ? s.antes.slice() : null,
                novaOrdem: s.novaOrdem.slice(), visitas7Antes: typeof s.visitas7Antes === 'number' ? s.visitas7Antes : null });
        });
        return out.sort((a, b) => a.ts - b.ts).slice(-SHC.ROBO_REG_MAX);
    };
    /**
     * O que aconteceu com uma sugestão do registro → { estado:'aplicada'|'outra'|'pendente'|'ignorada', em (ts em que foi vista), h (entrada 'manual'), detectado }.
     * prox = a sugestão seguinte do MESMO anúncio (a ordem de antes dela é a que estava no ML naquela hora); f = fotos:<conta>.porItem[MLB].
     * aplicada = a ordem vista depois é a sugerida; outra = as fotos mudaram de outro jeito; ignorada = ROBO_IGNORADA_DIAS sem mudar.
     */
    SHC.roboSugestaoEstado = function (s, prox, f, historico, agora) {
        const fim = prox ? prox.ts : Infinity, nova = ordemTxt(s.novaOrdem), antes = ordemTxt(s.antes);
        const h = (historico || []).find(x => x && x.itemId === s.itemId && x.resultado === 'manual' && x.ts >= s.ts && x.ts < fim && !(antes && ordemTxt(x.depois) === antes));
        if (h) return { estado: ordemTxt(h.depois) === nova ? 'aplicada' : 'outra', em: h.ts, h, detectado: !!h.detectado };
        const lida = prox ? { ids: prox.antes, ts: prox.ts } : f && Array.isArray(f.ids) && (f.ts || 0) > s.ts ? { ids: f.ids, ts: f.ts } : null;
        if (lida && ordemTxt(lida.ids) === nova) return { estado: 'aplicada', em: lida.ts, h: null, detectado: true };
        if (lida && antes && Array.isArray(lida.ids) && ordemTxt(lida.ids) !== antes) return { estado: 'outra', em: lida.ts, h: null, detectado: true };
        return { estado: (agora || Date.now()) - s.ts >= SHC.ROBO_IGNORADA_DIAS * 864e5 ? 'ignorada' : 'pendente', em: null, h: null, detectado: false };
    };
    /**
     * A última sugestão do anúncio foi aplicada (ou as fotos mudaram) sem "Já troquei", e a leitura das fotos mostrou isso → a entrada 'manual'
     * para o histórico (o robô espera o intervalo e o efeito é medido a partir da leitura) | null.
     */
    SHC.roboSugestaoVista = function (registro, itemId, f, historico, agora) {
        const s = (registro || []).filter(r => r && r.itemId === itemId).pop();
        if (!s) return null;
        const e = SHC.roboSugestaoEstado(s, null, f, historico, agora);
        if (e.h || (e.estado !== 'aplicada' && e.estado !== 'outra')) return null;
        return { ts: f.ts, itemId, antes: (s.antes || []).slice(), depois: f.ids.slice(), resultado: 'manual', detectado: true, sugestaoTs: s.ts,
            visitas7Antes: typeof s.visitas7Antes === 'number' ? s.visitas7Antes : null,
            motivo: e.estado === 'aplicada' ? 'Você aplicou a sugestão do robô no Mercado Livre (visto na leitura das fotos).' : 'Você mudou as fotos no Mercado Livre (visto na leitura das fotos).' };
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
            return d && typeof d === 'object' ? { id: o.id, d, modos: modosDeEnvio(o.data.metrics) } : undefined;
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
        return Object.assign({ itemId, alt: f1 ? numMed(sh.d.height) : null, larg: f1 ? numMed(sh.d.width) : null, comp: f1 ? numMed(sh.d.length) : null }, base, { envio, fabrica },
            sh && sh.modos ? { modos: sh.modos } : {});
    };
    // v3.2: modos de envio que o ML libera para o anúncio, na MESMA "Forma de entrega" (retrato de 25/09/2026, MLB4248981180):
    // metrics.confirm.marketplace.modes = { me1:{available}, me2:{available, type:'MANDATORY', availableLogistic:'FULFILLMENT', flexData:{optInStatus}},
    // custom:{available}, notSpecified:{available} } → { me1, me2, custom, combinar (bool | null), me2Obrigatorio, logistica ('fulfillment'…|''), flex ('COMPLETED'…|'') } | null.
    function modosDeEnvio(metrics) {
        const md = (((metrics || {}).confirm || {}).marketplace || {}).modes;
        if (!md || typeof md !== 'object') return null;
        const av = k => (md[k] && typeof md[k].available === 'boolean' ? md[k].available : null), me2 = md.me2 || {};
        return { me1: av('me1'), me2: av('me2'), custom: av('custom'), combinar: av('notSpecified'), me2Obrigatorio: /MANDATORY/i.test(String(me2.type || '')),
            logistica: String(me2.availableLogistic || '').toLowerCase().slice(0, 30), flex: String((me2.flexData || {}).optInStatus || '').slice(0, 20) };
    }
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
    // ── v3.2: Logística por anúncio (regras e fontes em LOGISTICA-ML.md). Só LEITURA: junta o que o Copiloto já lê; o que ele não lê fica "a confirmar". ──
    SHC.LOGISTICA_ROTULO = { me2: 'Mercado Envios', correios: 'Correios', agencia: 'Agência', coleta: 'Coleta', flex: 'Flex', full: 'Full', me1: 'Mercado Envios 1', combinar: 'Entrega a combinar', desconhecida: 'Não identificada' };
    // Limites de pacote. confirmado:false = número da Central de Ajuda do ML ("Dimensões permitidas", /ajuda/Dimensoes-permitidas_3163), lido por
    // busca em 30/09/2026 porque a página bloqueou a leitura direta: a tela mostra "a confirmar". O que o ML diz na tela do anúncio (modos) vale mais.
    const FONTE_LIM = 'Central de ajuda do ML, “Dimensões permitidas” (lida em 30/09/2026; número ainda não conferido)';
    SHC.LOGISTICA_LIMITES = {
        me2: { kg: 30, somaCm: 200, ladoCm: 100, fonte: FONTE_LIM, confirmado: false },
        coleta: { kg: 50, somaCm: 300, ladoCm: 200, fonte: FONTE_LIM, confirmado: false },   // a Central põe “Agências Mercado Livre ou Coleta” juntas
        full: { kg: 25, somaCm: 260, ladoCm: 120, fonte: FONTE_LIM, confirmado: false },
    };
    SHC.LOGISTICA_FRETE_PESADO = 0.25;   // ponytail: regra do Copiloto (não é do ML): frete ≥ 25% do preço = "frete pesado"; ajustar com a dona
    const NFE_MOD = { Full: 'full', Flex: 'flex', Coleta: 'coleta', 'Agência': 'agencia', Correios: 'correios' };   // Correios (drop_off) = limite do envio tradicional (me2)
    /** Notas de venda (nfe:<conta>:<mês>.notas) + vendas {MLB: {pedido: …}} → { MLB: {Full: n, Flex: n, …} } (nota cancelada e devolução não contam). */
    SHC.nfeLogisticaPorItem = function (notas, vendas) {
        const doPedido = {}, out = {};
        Object.keys(vendas || {}).forEach(id => Object.keys(vendas[id] || {}).forEach(p => { doPedido[p] = id; }));
        (notas || []).forEach(n => {
            const id = n && n.logistica && n.tipoOperacao !== 'Devolução' && n.status !== 'Cancelada' ? doPedido[n.venda] : null;
            if (id) { const o = out[id] || (out[id] = {}); o[n.logistica] = (o[n.logistica] || 0) + 1; }
        });
        return out;
    };
    /** Medida {ordenadas (cm, crescentes), pesoKg} × limite → [motivos] (vazio = cabe). */
    SHC.logisticaPassa = function (m, lim) {
        if (!m || !Array.isArray(m.ordenadas) || !lim) return [];
        const o = m.ordenadas, soma = o[0] + o[1] + o[2], out = [], n = v => String(Math.round(v * 10) / 10).replace('.', ',');
        if (o[2] > lim.ladoCm) out.push('maior lado ' + n(o[2]) + ' cm (máx. ' + lim.ladoCm + ')');
        if (soma > lim.somaCm) out.push('soma dos lados ' + n(soma) + ' cm (máx. ' + lim.somaCm + ')');
        if (m.pesoKg > lim.kg) out.push('peso ' + n(m.pesoKg) + ' kg (máx. ' + lim.kg + ')');
        return out;
    };
    // ── v3.2 Editor em massa (leitura PASSIVA: só quando a seller abre a tela; só GET; nunca PUT /response nem save-*; MAPA-LEITURA-COMPLETA.md) ──
    // Página /anuncios/editor-massivo/<sessão>?viewId=listings; a sessão começa com o id da conta ("3400202502-edition-1f13…").
    SHC.EDITOR_API = '/anuncios/editor-massivo/api';
    /** URL da tela → { sessao, conta } | null (só a visão "listings": as outras são outra sessão do ML). */
    SHC.editorSessao = function (url) {
        let u;
        try { u = new URL(url); } catch (e) { return null; }
        const m = /^\/anuncios\/editor-massivo\/([A-Za-z0-9_-]{6,80})\/?$/.exec(u.pathname);
        if (!m || m[1] === 'api' || (u.searchParams.get('viewId') || 'listings') !== 'listings') return null;
        const c = /^(\d{6,15})-/.exec(m[1]);
        return { sessao: m[1], conta: c ? c[1] : '' };
    };
    // Lista plana (useUpGrouping=false): todos os MLB, 50 por página; a ordem muda entre leituras → juntar por id e repetir até o total.
    SHC.editorUrlEstado = (sessao, page) => SHC.EDITOR_API + '/state?gridOnly=true&page=' + page + '&limit=50&viewId=listings&sessionId=' + encodeURIComponent(sessao) + '&useUpGrouping=false';
    SHC.editorUrlVariacoes = (sessao, mlb) => SHC.EDITOR_API + '/items/' + encodeURIComponent(mlb) + '/variations?viewId=listings&sessionId=' + encodeURIComponent(sessao);
    const edSel = c => (((c && c.data && c.data.availableOptions) || []).find(o => o && o.selected)) || null;
    const edNum = c => { const v = c && c.data && c.data.value, n = v && typeof v === 'object' ? +String(v.rawNumber).replace(',', '.') : NaN; return isFinite(n) ? n : null; };
    const edTxt = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n || 80);
    const edOpc = c => { const o = edSel(c), dt = (c && c.data) || {}; return o ? { id: String(o.value || ''), txt: edTxt(o.text) } : dt.text ? { id: '', txt: edTxt(dt.text) } : null; };
    /** Uma linha do /state (ou de /items/<MLB>/variations) → registro curto. Nada do comprador vem nessa grade. */
    SHC.editorLinha = function (row) {
        if (!row || typeof row !== 'object' || !row.cells) return null;
        const c = row.cells, dt = row.data || {}, q = c.item_quality && c.item_quality.data && Array.isArray(c.item_quality.data.comment) ? c.item_quality.data.comment : [];
        const w = (c.warranty && c.warranty.data) || {}, lt = edSel(c.listing_type), vq = c.variation && c.variation.data && +c.variation.data.variationsQuantity;
        const sku = c.sku && c.sku.data && typeof c.sku.data.value === 'string' ? nSku(c.sku.data.value) : '';
        const o = {
            id: String(row.id || ''), status: String(dt.status || ''), ativo: dt.type === 'active', up: String(dt.userProductId || ''), familyId: String(dt.familyId || ''),
            titulo: edTxt(c.title && c.title.data && c.title.data.value, 120), sku, estoque: edNum(c.quantity),
            tipo: lt ? edTxt(lt.text, 20) : '', tarifaTxt: edTxt(lt && Array.isArray(lt.comment) && lt.comment[0] && lt.comment[0].text, 60),
            entrega: edOpc(c.shipping_method), custoEnvio: edOpc(c.shipping_costs), retira: (edSel(c.shipping_type) || {}).value === 'true',
            prazo: edTxt(c.manufacturing_time && c.manufacturing_time.data && c.manufacturing_time.data.value && c.manufacturing_time.data.value.number, 30),
            garantia: edTxt([w.text, typeof w.comment === 'string' ? w.comment : ''].filter(Boolean).join(' · '), 60),
            qualidade: edTxt((q.find(x => x && /^(GOOD|MEDIUM|BAD)$/.test(x.type)) || {}).text, 30),
            qNivel: ((q.find(x => x && /^(GOOD|MEDIUM|BAD)$/.test(x.type)) || {}).type) || '',   // v3.3: o nível (o texto muda com o idioma)
            dicas: q.filter(x => x && /^(REASON|EMPTY)$/.test(x.type) && x.text).map(x => edTxt(x.text, 80)).slice(0, 4),
        };
        if (vq > 0) o.nVar = vq;
        if (row.parentId) {   // linha de variação (/items/<MLB>/variations): nome da variação ("Cor: Vermelho"), estoque Flex/Full
            o.pai = String(row.parentId);
            const cm = c.title && c.title.data && c.title.data.comment;   // às vezes lista [{text}] (como em item_quality)
            o.nome = edTxt(Array.isArray(cm) ? cm[0] && cm[0].text : typeof cm === 'string' ? cm : '', 60);
            o.estoqueFlex = edNum(c.flex_stock_quantity); o.estoqueFull = edNum(c.full_stock_quantity);
        }
        return o.id ? o : null;
    };
    /** Junta uma resposta do /state em porItem ({MLB: registro}) → quantas linhas vieram e o paging.total do ML. */
    SHC.editorJunta = function (porItem, j) {
        const rows = j && Array.isArray(j.rows) ? j.rows : [];
        rows.forEach(r => { const o = SHC.editorLinha(r); if (o && /^MLB\d{6,14}$/.test(o.id)) porItem[o.id] = Object.assign(porItem[o.id] || {}, o); });
        const t = j && j.paging && j.paging.total;
        return { linhas: rows.length, total: typeof t === 'number' ? t : null };
    };
    /** Variações de um anúncio (/items/<MLB>/variations) → [{id, sku, nome, estoque, estoqueFlex, estoqueFull}]. */
    SHC.editorVariacoes = j => ((j && Array.isArray(j.response)) ? j.response : []).map(SHC.editorLinha).filter(Boolean)
        .map(v => ({ id: v.id, sku: v.sku, nome: v.nome, estoque: v.estoque, estoqueFlex: v.estoqueFlex, estoqueFull: v.estoqueFull }));
    /**
     * A leitura inteira do Editor (só GET, uma chamada de cada vez). f = { get(url) → JSON | null, pausa(), segue() → false = a seller saiu da tela }.
     * A ordem da lista plana muda entre leituras (ao vivo: 357 únicos na 1ª passada, 383 na união de 2): junta por id e repete (máx. 3 passadas).
     * → { porItem, total, completo } | null (saiu da tela).
     */
    SHC.EDITOR_VAR_MAX = 400;   // anúncios com variação por leitura (~10 min a 1,5 s; só enquanto a seller está na tela). Passou = leitura parcial.
    SHC.editorLeitura = async function (sessao, f) {
        const porItem = {}, segue = f.segue || (() => true);
        let total = null, falhou = false;
        for (let passada = 0; passada < 3 && !falhou && (total === null || Object.keys(porItem).length < total); passada++) {
            for (let p = 1; p <= 200; p++) {
                if (!segue()) return null;
                if (p > 1 || passada > 0) await f.pausa();
                const j = await f.get(SHC.editorUrlEstado(sessao, p));
                if (!j) { falhou = true; break; }
                const r = SHC.editorJunta(porItem, j);
                if (r.total !== null) total = r.total;
                if (!r.linhas || total === null || p * 50 >= total) break;
            }
        }
        // SKU, estoque e nome de cada variação: a única tela do ML que mostra (44 anúncios → 135 variações na conta lida ao vivo).
        // Completo só se TODAS vierem (auditoria 01/10/2026: com o teto ou um GET que falhou saía completo=true e o fundo apagava as já lidas).
        // A lista plana falhou (pode ser 429) → não pede variações; 2 falhas seguidas → para (o ML está recusando).
        const comVar = Object.keys(porItem).filter(k => porItem[k].nVar > 0);
        let varOk = !falhou && comVar.length <= SHC.EDITOR_VAR_MAX, seguidas = 0;
        for (const id of falhou ? [] : comVar.slice(0, SHC.EDITOR_VAR_MAX)) {
            if (!segue()) return null;
            await f.pausa();
            const j = await f.get(SHC.editorUrlVariacoes(sessao, id)), vs = j ? SHC.editorVariacoes(j) : [];
            if (vs.length) { porItem[id].variacoes = vs; seguidas = 0; continue; }
            // #19 (ao vivo 01/10/2026): anúncio encerrado ou em revisão responde, mas sem variações (13 de 44). É resposta, não falha:
            // sem isto a leitura nunca ficava completa e repetia os ~44 GETs a cada hora. As variações já lidas dele ficam (juntarEditor).
            if (j && Array.isArray(j.response) && porItem[id].status && porItem[id].status !== 'active') { seguidas = 0; continue; }
            varOk = false;
            if (!j && ++seguidas >= 2) break;
        }
        const n = Object.keys(porItem).length;
        return { porItem, total, completo: !falhou && varOk && total !== null && n >= total };
    };
    const EDITOR_MOD = { SHIPPING_ME2: 'me2', SHIPPING_REMOVE: 'combinar', SHIPPING_CUSTOM: 'me1' };
    // Dica do ML na coluna Qualidade → o que ela custa. Texto do Copiloto (orientação, não regra do ML); o que não está aqui aparece com o texto do ML.
    SHC.EDITOR_IMPACTO = {
        'Ofereça envios no mesmo dia': 'O ML sugere o Flex: entrega no mesmo dia aparece com destaque para o comprador.',
        'Adicione preços de atacado': 'Preço de atacado ajuda a vender mais de 1 unidade por pedido.',
        'Preencha as características': 'Ficha técnica incompleta tira o anúncio de filtros da busca.',
        'Adicione mais fotos': 'Poucas fotos costumam converter menos.',
        'Revise seu anúncio para reativá-lo.': 'Anúncio parado: não vende até ser revisado.',
        'Sem garantia': 'Sem garantia passa menos confiança ao comprador.',
    };
    /**
     * Cartão "Pendências dos anúncios" → [{ tipo, n, impacto, itens:[{itemId, titulo}] }], do mais comum ao menos.
     * editor = editor:<conta> ({porItem}); conta só anúncio não finalizado (closed não tem o que corrigir). "Sem garantia" vem da coluna Garantia.
     */
    SHC.editorPendencias = function (editor) {
        const por = (editor && editor.porItem) || {}, g = {};
        Object.keys(por).forEach(id => {
            const o = por[id] || {};
            if (o.status === 'closed') return;
            const tipos = (o.dicas || []).slice();
            if (/^sem garantia/i.test(o.garantia || '')) tipos.push('Sem garantia');
            tipos.forEach(t => { (g[t] || (g[t] = [])).push({ itemId: id, titulo: o.titulo || '' }); });
        });
        return Object.keys(g).map(t => ({ tipo: t, n: g[t].length, impacto: SHC.EDITOR_IMPACTO[t] || '', itens: g[t] })).sort((a, b) => b.n - a.n || (a.tipo < b.tipo ? -1 : 1));
    };
    const ST_ANUNCIO = { active: 'ativo', paused: 'pausado', closed: 'finalizado', under_review: 'sob revisão', inactive: 'inativo' };
    const RESTR_SELLER = { out_of_stock: 'sem estoque', paused: 'pausado', closed_finalized: 'finalizado por você' };
    /**
     * Um anúncio da lista (SHC.mlAnunciosDoEstado) + o que mais o Copiloto tem dele → a logística dele.
     * dados = { medida: medidas:<conta>.porItem[MLB].atual ({ordenadas, pesoKg, modos?}) | null, medidaErp: SHC.medidaDe(…) | null,
     *   nfe: {Full: n, Flex: n, …} (SHC.nfeLogisticaPorItem) | null, noFull: bool (está no estoque do Full), repProblemas: n | null (reputação: top anúncios com problema) }
     * → { modalidade: 'me2'|'correios'|'agencia'|'coleta'|'flex'|'full'|'me1'|'combinar'|'desconhecida', rotulo, fonte, certeza: 'confirmada'|'provavel'|'',
     *     flex: bool | null, status: 'ativo'|'pausado'|…, statusTxt, pausadoPeloML: bool, cabeNaMe2: 'sim'|'nao'|'sem medida', cabeFonte, cabeConfirmado,
     *     prazoDespacho: texto | null, modeloAdequado: bool | null, avisos: [{tipo, nivel: 'pr'|'at'|'n', txt, regra, fonte, confirmado}], motivo }
     */
    SHC.logisticaDoAnuncio = function (it, dados) {
        const i = it || {}, d = dados || {}, modos = (d.medida && d.medida.modos) || null, L = SHC.LOGISTICA_LIMITES;
        const nf = d.nfe || {}, nfTot = Object.keys(nf).reduce((s, k) => s + nf[k], 0), nfTop = Object.keys(nf).sort((a, b) => nf[b] - nf[a])[0];
        let modalidade = 'desconhecida', fonte = '', certeza = '';
        if (d.noFull || SHC.noFull(i)) { modalidade = 'full'; fonte = 'estoque no Full'; certeza = 'confirmada'; }
        else if (nfTop && NFE_MOD[nfTop] && nf[nfTop] * 2 >= nfTot) { modalidade = NFE_MOD[nfTop]; fonte = 'NF-e de ' + SHC.qtd(nfTot, 'venda', 'vendas') + ' (' + nf[nfTop] + ' ' + nfTop + ')'; certeza = 'confirmada'; }
        else if (d.editor && d.editor.entrega && EDITOR_MOD[d.editor.entrega.id]) {   // v3.2: "Forma de entrega" do Editor em massa (lido quando a seller abre a tela)
            modalidade = EDITOR_MOD[d.editor.entrega.id]; fonte = 'Editor em massa do ML: “' + d.editor.entrega.txt + '”'; certeza = 'confirmada';
        } else if (i.entregaTxt) {
            modalidade = modos && modos.me1 === true && modos.combinar === false ? 'me1' : 'combinar';
            fonte = 'lista de Anúncios: “' + i.entregaTxt + '”'; certeza = 'provavel';
        } else if (i.freteComprador || i.frete > 0) { modalidade = 'me2'; fonte = 'lista de Anúncios (frete do Mercado Envios)'; certeza = 'confirmada'; }
        const flex = typeof i.flexBonus === 'number' || (modos && /COMPLETED/i.test(modos.flex)) ? true : (i.sugereFlex ? false : null);
        // Status: o do ML na lista; a faixa "status_restriction" diz o motivo. Motivo que não é do vendedor (nem sem estoque) = restrição do ML.
        const status = ST_ANUNCIO[i.status] || (i.status ? String(i.status).toLowerCase() : 'desconhecido'), rs = i.restricao;
        const pausadoPeloML = status === 'sob revisão' || !!(rs && !RESTR_SELLER[rs.id] && status !== 'ativo');
        const statusTxt = rs ? (RESTR_SELLER[rs.id] || rs.txt || rs.id) : '';
        // Cabe no Mercado Envios 2? 1º o que o ML diz na tela do anúncio; senão a medida × o limite da Central de Ajuda (a confirmar).
        const med = d.medida && Array.isArray(d.medida.ordenadas) ? d.medida : d.medidaErp || null;
        let cabeNaMe2 = 'sem medida', cabeFonte = '', cabeConfirmado = false, passaMe2 = [];
        if (modos && typeof modos.me2 === 'boolean') { cabeNaMe2 = modos.me2 ? 'sim' : 'nao'; cabeFonte = 'tela “Alterar anúncio” do ML (formas de entrega liberadas)'; cabeConfirmado = true; }
        else if (med) { passaMe2 = SHC.logisticaPassa(med, L.me2); cabeNaMe2 = passaMe2.length ? 'nao' : 'sim'; cabeFonte = L.me2.fonte; }
        const avisos = [], av = (tipo, nivel, txt, regra, fte, conf) => avisos.push({ tipo, nivel, txt, regra, fonte: fte, confirmado: !!conf });
        const ehMe2 = /^(me2|correios|agencia|coleta|flex)$/.test(modalidade);
        if ((modalidade === 'combinar' || modalidade === 'me1') && cabeNaMe2 === 'sim')
            av('modelo', 'at', 'Modelo não adequado: cabe no Mercado Envios, mas está fora dele (' + SHC.LOGISTICA_ROTULO[modalidade].toLowerCase() + ').',
                modalidade === 'me1' ? 'O ML não deixa usar o Mercado Envios 1 em anúncio que já tem o Mercado Envios 2 disponível.'
                    : 'Orientação do Copiloto (não é regra do ML): no Mercado Envios o comprador vê prazo e custo no anúncio.',
                (modalidade === 'me1' ? 'developers.mercadolivre.com.br, “Mercado Envios 1” (consultado em 30/09/2026)' : 'lista de Anúncios do ML')
                    + (cabeConfirmado ? '' : ' · limite de medida ainda não conferido'), cabeConfirmado);
        if (ehMe2 && !(modos && modos.me2 === true)) {
            const lim = modalidade === 'coleta' || modalidade === 'agencia' ? L.coleta : L.me2, p = SHC.logisticaPassa(med, lim);
            if (p.length) av('medida', 'pr', 'Modelo não adequado: a medida passa do limite de ' + SHC.LOGISTICA_ROTULO[modalidade] + ' (' + p.join('; ') + ').',
                'Pacote acima do limite da modalidade não pode ser enviado por ela.', lim.fonte, lim.confirmado);
        }
        if (modalidade === 'full') { const p = SHC.logisticaPassa(med, L.full); if (p.length) av('medida', 'pr', 'A medida passa do limite do Full (' + p.join('; ') + ').', 'Pacote acima do limite do Full não entra no centro do ML.', L.full.fonte, L.full.confirmado); }
        if (ehMe2 && i.preco > 0 && i.frete > 0 && i.frete / i.preco >= SHC.LOGISTICA_FRETE_PESADO)
            av('frete', 'at', 'Frete pesado: ' + SHC.pctTxt(i.frete / i.preco * 100) + ' do preço (' + SHC.moeda(i.frete) + ' de ' + SHC.moeda(i.preco) + '). Confira a medida'
                + (flex === false ? ' e o Flex, que o ML sugere para este anúncio' : '') + '.', 'Regra do Copiloto (não é do ML): frete a partir de ' + Math.round(SHC.LOGISTICA_FRETE_PESADO * 100) + '% do preço.', 'lista de Anúncios do ML (frete e preço de hoje)', true);
        else if (flex === false) av('flex', 'n', 'O ML sugere ativar o Flex (envio no mesmo dia) neste anúncio.', 'Sugestão do próprio ML na lista de Anúncios.', 'lista de Anúncios do ML', true);
        if (i.competicaoMotivo === 'entrega') av('entrega', 'pr', 'Restrito para ganhar: outros vendedores oferecem uma forma de entrega melhor.', 'Aviso do ML na competição do catálogo.', 'lista de Anúncios do ML', true);
        if (pausadoPeloML) av('status', 'pr', 'Restrição do ML: ' + String(statusTxt || status).replace(/\.+$/, '') + '.', 'Status do anúncio na lista do ML.', 'lista de Anúncios do ML', true);
        if (d.repProblemas > 0) av('reputacao', 'at', 'Está entre os anúncios com problema na sua reputação (' + SHC.qtd(d.repProblemas, 'caso', 'casos') + ').', 'Anúncios com mais reclamações, cancelamentos ou atrasos.', 'Reputação do ML', true);
        const ruim = avisos.some(a => a.tipo === 'modelo' || a.tipo === 'medida');
        return {
            modalidade, rotulo: SHC.LOGISTICA_ROTULO[modalidade], fonte, certeza, flex, status, statusTxt, pausadoPeloML,
            cabeNaMe2, cabeFonte, cabeConfirmado, prazoDespacho: modalidade === 'full' ? 'O ML despacha do centro dele.' : null,
            modeloAdequado: modalidade === 'desconhecida' ? null : !ruim, avisos,
            motivo: modalidade === 'desconhecida' ? 'A lista do ML não mostrou frete nem forma de entrega deste anúncio.' : 'Fonte: ' + fonte + '.',
        };
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
            envio: soMedida(m.envio), fabrica: soMedida(m.fabrica), entrega: m.alt !== null && m.alt !== undefined ? soMedida(m) : null },
            m.modos || (a0 && a0.modos) ? { modos: m.modos || a0.modos } : {});   // v3.2: modos de envio liberados (a última leitura que trouxe)
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
    // v3.3: com a regra do ML (o frete sai do peso e das medidas da embalagem) e o pedido explícito: corrigir a medida E rever o frete cobrado.
    // Auditoria da loja (07/10/2026): "aumenta o custo de envio" e o estorno só quando o peso CONSIDERADO (o maior entre o físico e o
    // volumétrico) subiu; medida que diminuiu ou ficou igual pede só a correção do cadastro.
    // Rastreio 07/10/2026 (R13): "não foi feita por nós" e "sem que nós mexêssemos" só com a marca de autoria no dado (quem 'ml' de
    // SHC.medidasMudadas). Sem ela, o texto diz que a medida mudou, PERGUNTA quem alterou e pede a revisão.
    // Junção com a 3.3.0 local (trava do frete, regra da dona): o pedido é a REVISÃO do frete cobrado, nunca a devolução do valor; e o
    // "aumenta o custo" não sai (não há o número da diferença do frete).
    SHC.medidasChamado = (mu) => {
        const subiu = SHC.medidaConsiderada(mu.depois) > SHC.medidaConsiderada(mu.antes) + 0.001, ml = mu.quem === 'ml';
        const corrige = mu.correta ? 'a correção das medidas para ' + SHC.medidaTxt(mu.correta) + ' nos envios futuros' : '', desde = ddmm(mu.vistoAte || mu.em);
        return SHC.textoContestacao({ assunto: !ml ? 'Pedido de revisão da cubagem do anúncio' : subiu ? 'Contestação de cubagem alterada no anúncio' : 'Pedido de correção da cubagem do anúncio',
            ids: [['SKU', mu.sku || ''], ['Anúncio', mu.itemId]],
            intro: ml ? 'As medidas da embalagem deste anúncio foram alteradas sem que nós mexêssemos.'
                : 'As medidas da embalagem deste anúncio mudaram' + (subiu ? ' e o peso considerado no frete subiu' : '') + '. Gostaríamos de entender quem fez a alteração e qual medida vale para o cálculo do frete.',
            fatos: ['Medidas da embalagem: de ' + SHC.medidaTxt(mu.antes) + ' para ' + SHC.medidaTxt(mu.depois) + ' ' + SHC.medidasQuando(mu) + '.' + (ml ? ' A alteração não foi feita por nós.' : ''),
                'Peso considerado no frete (o maior entre o físico e o volumétrico): de ' + kgTxt(SHC.medidaConsiderada(mu.antes)) + ' kg para ' + kgTxt(SHC.medidaConsiderada(mu.depois)) + ' kg.',
                mu.correta ? 'Medidas corretas (' + (mu.corretaDe === 'erp' ? 'do nosso cadastro' : 'as que deixamos no anúncio') + '): ' + SHC.medidaTxt(mu.correta) + '.' : ''],
            regras: ['frete_tabela', 'frete_calculo'], anexos: ['especificações técnicas do fabricante (medidas e peso)', 'foto da embalagem com trena e balança', 'nota fiscal do item'],
            pedido: ml ? 'a revisão da cubagem do anúncio' + (corrige ? ', ' + corrige : '') + (subiu ? ' e a revisão do frete cobrado desde ' + desde + '.' : '.')
                : 'a informação de quem alterou as medidas e de qual medida está sendo usada no cálculo do frete, e a revisão da cubagem do anúncio.'
                    + (subiu || corrige ? ' Se a alteração não foi feita por nós, pedimos também ' + [corrige, subiu ? 'a revisão do frete cobrado desde ' + desde : ''].filter(Boolean).join(' e ') + '.' : '') });
    };
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

    // ── v3.3 Mesmo SKU, frete diferente (pedido da dona 30/09: HA-14253 com R$ 45,35 e R$ 58,75 e o Copiloto calado) ──
    // Central de Ajuda do ML (ajuda/40538): o custo de envio = tabela FAIXA DE PESO × FAIXA DE PREÇO (a reputação troca a tabela inteira, igual
    // para a conta). Clássico × Premium NÃO muda o frete. Então: mesmo SKU + mesma faixa de preço + frete diferente = peso/medida diferente no
    // cadastro (ou na medição do ML) de um dos user products. Conferido ao vivo 30/09: 45,35 = 8–9 kg e 58,75 = 9–10 kg na faixa R$ 150–199,99.
    // Limites das faixas de preço (o preço efetivo: o da promoção, quando há).
    // (nome próprio: a linha ~607 já declara FAIXAS_FRETE com o 0 na frente; 2 const iguais derrubavam o arquivo inteiro)
    const LIMITES_FAIXA_FRETE = [19, 49, 79, 100, 120, 150, 200];
    SHC.faixaFrete = p => { const i = LIMITES_FAIXA_FRETE.findIndex(l => p < l); return i < 0 ? LIMITES_FAIXA_FRETE.length : i; };
    // Estoque no Full (mesma regra do SHC.modalidade): o ML mede a caixa na entrada.
    SHC.noFull = i => /\bfull\b/i.test(String((i && i.estoque) || '')) || ((i && i.estoqueOnde) || []).some(x => /fulfil/i.test(x));
    // Kit pelo título → '' (unidade) | 'kit' | 'q2', 'q3'… ("Kit 2 …", "Par de …", "3 unidades", "4 peças"). 1 unidade = ''.
    // ponytail: só o título; peso lido proporcional seria mais certo, quando as medidas de todos estiverem lidas.
    SHC.kitDoTitulo = function (t) {
        const s = String(t || ''), n = /\bkit\s*(?:c\/|com)?\s*(\d{1,3})\b|\b(\d{1,3})\s*(?:un|und|unid|unidades?|p[çc]s|pe[çc]as)\b/i.exec(s);
        const q = n ? +(n[1] || n[2]) : /\bpar\b/i.test(s) ? 2 : 0;
        return q > 1 ? 'q' + q : q === 1 ? '' : /\b(kit|combo)\b/i.test(s) ? 'kit' : '';
    };
    SHC.faixaFreteTxt = i => (i <= 0 ? 'até R$ 18,99' : i >= LIMITES_FAIXA_FRETE.length ? 'a partir de R$ ' + LIMITES_FAIXA_FRETE[LIMITES_FAIXA_FRETE.length - 1]
        : 'R$ ' + LIMITES_FAIXA_FRETE[i - 1] + ' a ' + SHC.moeda(LIMITES_FAIXA_FRETE[i] - 0.01));
    /**
     * itens = retrato (ml:anuncios.itens / SHC.mlAnunciosDoEstado). opc = { medidas: medidas:<conta>.porItem, vendas: {MLB: unidades no mês},
     *   minimo (R$, padrão 2), pct (padrão 5): só acusa diferença ≥ max(minimo, pct% do frete normal) — calibre aqui se aparecer falso alarme }.
     * Só entra anúncio com frete lido na lista (não deduzido), frete > 0 e sem "comprador paga"/"combine a entrega".
     * → [{ sku, faixa, faixaTxt, normal:{frete, itemIds, criterio:'mais_comum'|'mais_barato'}, anuncios:[{itemId, familia, tipo, preco, frete, dif, foge,
     *      vendas, custoMes, titulo, medida:{eu, ref, refId, iguais}|null, medidaTxt}], fogem:[…], porEnvio, custoMes }], do que mais custa por mês.
     */
    SHC.freteMesmoSku = function (itens, opc) {
        const o = opc || {}, vendas = o.vendas || {}, porItem = o.medidas || {}, minimo = o.minimo === undefined ? 2 : o.minimo, pct = o.pct === undefined ? 5 : o.pct;
        const grupos = {}, vistos = new Set();
        (itens || []).forEach(i => {
            if (!i || !i.itemId || vistos.has(i.itemId)) return;
            if (i.status && !SHC.anuncioAtivo(i)) return;   // pausado/finalizado não vira o "normal" nem é acusado (igual ao painel)
            const k = normSku(i.sku), f = SHC.num(i.frete), p = SHC.num(i.preco);
            if (!k || !(f > 0) || !(p > 0) || i.freteDeduzido || i.freteComprador || i.entregaTxt) return;
            vistos.add(i.itemId);
            // Kit/par/N unidades pesa mais; no Full quem mede a caixa é o ML: cada um só se compara com o seu igual.
            const kit = SHC.kitDoTitulo(i.titulo), full = SHC.noFull(i);
            const fx = SHC.faixaFrete(p), gk = k + '|' + fx + '|' + kit + '|' + (full ? 'F' : '');
            const g = grupos[gk] || (grupos[gk] = { sku: String(i.sku).trim(), faixa: fx, full, kit, anuncios: [] });
            g.anuncios.push({ itemId: i.itemId, familia: i.familia || '', tipo: i.tipo || '', preco: p, frete: SHC.r2(f), titulo: i.titulo || '', vendas: +vendas[i.itemId] || 0 });
        });
        const medDe = id => { const a = porItem[id] && porItem[id].atual; return a && Array.isArray(a.ordenadas) ? a : null; };
        const out = [];
        Object.keys(grupos).forEach(k => {
            const g = grupos[k], l = g.anuncios;
            if (l.length < 2) return;
            const cont = {};
            l.forEach(x => { cont[x.frete] = (cont[x.frete] || 0) + 1; });
            const valores = Object.keys(cont).map(Number), max = Math.max.apply(null, valores.map(v => cont[v]));
            const topo = valores.filter(v => cont[v] === max);
            // Normal = o frete que mais se repete; empate → o mais barato (o anúncio que paga mais é o que tem de explicar a diferença).
            const normal = Math.min.apply(null, topo), criterio = topo.length > 1 ? 'mais_barato' : 'mais_comum';
            const iguais = l.filter(x => x.frete === normal), refMed = iguais.map(x => x.itemId).find(medDe) || '';
            l.forEach(x => {
                x.dif = SHC.r2(x.frete - normal);
                // Mínimo em R$ cai em frete baixo (até 10% do normal): abaixo de R$ 79 um degrau de peso vale poucos reais.
                x.foge = x.dif >= Math.max(Math.min(minimo, normal * 0.1), normal * pct / 100);
                x.custoMes = x.foge ? SHC.r2(x.dif * x.vendas) : 0;
                x.medida = null; x.medidaTxt = '';
                if (!x.foge) return;
                const eu = medDe(x.itemId), ref = refMed ? medDe(refMed) : null;
                x.medida = { eu: eu ? SHC.medidaTxt(eu) : null, ref: ref ? SHC.medidaTxt(ref) : null, refId: refMed, iguais: eu && ref ? SHC.medidasIguais(eu, ref) : null };
                x.medidaTxt = g.full ? 'Anúncio no Full: o ML mede a caixa na entrada do estoque. Peça ao ML a revisão da medida.'
                    : !eu || !ref ? 'Medidas ainda não lidas' + (eu || ref ? ' em um dos anúncios' : '') + ': confira em “Alterar anúncio” no ML.'
                    : x.medida.iguais ? 'A medida cadastrada é a mesma nos dois (' + x.medida.eu + '): o ML pode ter medido a embalagem diferente. Peça a revisão.'
                    : 'Medida deste anúncio: ' + x.medida.eu + '. No ' + refMed + ': ' + x.medida.ref + '. Corrija para a medida certa.';
            });
            const fogem = l.filter(x => x.foge);
            if (!fogem.length) return;
            out.push({ sku: g.sku, faixa: g.faixa, faixaTxt: SHC.faixaFreteTxt(g.faixa), normal: { frete: normal, itemIds: iguais.map(x => x.itemId), criterio },
                anuncios: l.sort((a, b) => b.dif - a.dif), fogem, porEnvio: Math.max.apply(null, fogem.map(x => x.dif)),
                custoMes: SHC.r2(fogem.reduce((s, x) => s + x.custoMes, 0)) });
        });
        return out.sort((a, b) => b.custoMes - a.custoMes || b.porEnvio - a.porEnvio || (a.sku < b.sku ? -1 : 1));
    };
    /**
     * O contrário do alerta: outros anúncios do MESMO SKU com frete diferente só porque o preço está em OUTRA faixa da tabela do ML
     * (ex.: HA-14253 a R$ 190 paga 40,85 e a R$ 200 paga 45,25 no mesmo user product). Não é erro: vai no balão, explicado.
     * → [{ faixaTxt, frete, itemIds }] (do frete menor para o maior) | [].
     */
    SHC.freteOutraFaixa = function (it, itens) {
        const k = normSku(it && it.sku), f = SHC.num(it && it.frete), p = SHC.num(it && it.preco);
        if (!k || !(f > 0) || !(p > 0) || it.freteDeduzido || it.freteComprador || it.entregaTxt) return [];
        const fx = SHC.faixaFrete(p), por = {};
        (itens || []).forEach(i => {
            if (!i || !i.itemId || i.itemId === it.itemId || normSku(i.sku) !== k || i.freteDeduzido || i.freteComprador || i.entregaTxt) return;
            const fi = SHC.r2(SHC.num(i.frete)), pi = SHC.num(i.preco), fxi = pi > 0 ? SHC.faixaFrete(pi) : fx;
            if (!(fi > 0) || fxi === fx || Math.abs(fi - f) < 0.01) return;
            const g = por[fxi + '|' + fi] || (por[fxi + '|' + fi] = { faixaTxt: SHC.faixaFreteTxt(fxi), frete: fi, itemIds: [] });
            if (g.itemIds.indexOf(i.itemId) < 0) g.itemIds.push(i.itemId);
        });
        return Object.keys(por).map(c => por[c]).sort((a, b) => a.frete - b.frete);
    };

    // ── v2.6: faturamento por FAMÍLIA (1º nível da categoria do ML), curva ABC, "por que caiu?", sazonalidade × Full e meta do mês ──
    // vbAnuncio:<conta> = { ts, meses:{'AAAA-MM': {porAnuncio:{MLB:{bruto, unidades, vendas, visitas, sku}}, paginas, linhas, completo, lidoEm, lidoTs (hora da leitura)}},
    //                      itens:{MLB:{sku, titulo}} }   (fundo: etapa 'vendasAnuncio')
    // cat:<conta> = { ts, porItem:{MLB:{familia, sub, categoriaId, ts}} }   (fundo: a MESMA leitura da tela "Alterar anúncio" das fotos/medidas)
    // Cores de CATEGORIA, sem vermelho nem verde: essas duas querem dizer ▼ caiu / ▲ subiu no mesmo cartão (ESPEC: cor de situação é a mesma em todo lugar).
    SHC.FAMILIA_PALETA = ['#4E79A7', '#F28E2B', '#3E6E7A', '#9C755F', '#76B7B2', '#EDC948', '#B07AA1', '#6B6ECF'];
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
     * fator3 (no array) = o ritmo do mês contra a média dos 3 meses antes (0 = menos de 1 dia lido).
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
        out.diasCobertos = Math.round(cm.ms / 864e5 * 10) / 10;   // v3.1: dias do mês que a leitura cobre (venda por dia = unidades ÷ isto)
        if (cm.parcial || (lido(ant) && ca.parcial)) {
            Object.assign(out, { comparacao: 'ritmo', dias: cm.ate, diasAnt: ca.parcial ? ca.ate : diasNoMesFam(ant), fator: Math.round(fator * 1000) / 1000,
                antParcial: lido(ant) && ca.parcial, mesParcial: cm.parcial, mesAtual: mes === hoje.slice(0, 7) });
            if (lido(ant) && !compara) out.motivoComp = cm.parcial && cm.ms < 864e5 ? capF(nomeMesFam(mes)) + ' acabou de começar: as setas aparecem amanhã.'
                : capF(nomeMesFam(ant)) + ' foi lido só no começo do mês: as setas aparecem quando ele for lido de novo.';
        }
        const ret = {};
        ((retrato && retrato.itens) || []).forEach(i => { if (i && i.itemId && !ret[i.itemId]) ret[i.itemId] = i; });
        // v3.4 (01/10, conta de cliente: outubro 100% "Sem categoria"): anúncio de CATÁLOGO não traz a categoria na tela "Alterar anúncio" (sem o bloco
        // category_change) → herda do anúncio tradicional de origem ("Sincronizado com #N" = ret[id].catalogo) ou de outro anúncio do mesmo
        // produto (userProductId MLBU…, ret[id].familia). Mesmo produto = mesma família de 1º nível. Nenhum GET a mais.
        const porUP = {};
        Object.keys(ret).forEach(id => { const r = ret[id], f = pc[id] && pc[id].familia;
            [r.familia, r.userProductId].forEach(u => { if (f && u && !porUP[u]) porUP[u] = pc[id]; }); });
        const catDe = id => { if (pc[id] && pc[id].familia) return pc[id];
            const r = ret[id] || {}, o = /^\d{6,14}$/.test(String(r.catalogo || '')) ? pc['MLB' + r.catalogo] : null;
            return (o && o.familia ? o : null) || porUP[r.familia] || porUP[r.userProductId] || null; };
        const famDe = id => (catDe(id) || {}).familia || SHC.FAMILIA_SEM;
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
        out.semCategoria = Object.keys(M[mes].porAnuncio).filter(id => n0((M[mes].porAnuncio[id] || {}).bruto) > 0 && famDe(id) === SHC.FAMILIA_SEM).length;
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
            const c = SHC.custoDeAnuncio(cs, { sku: skuDe(id), skus: r.skus, skuFonte: r.skuFonte, itemId: id, familia: r.familia });
            if (!c) return null;
            const custo = SHC.num(c.dados.custo), outros = SHC.num(c.dados.outros) || 0, tarifaPct = (numF(r.tarifa) || 0) / r.preco, frete = numF(r.frete) || 0;
            // "Envio por conta do comprador": o ML cobra a taxa operacional por venda (a mesma conta da etiqueta, SHC.sobraAnuncio).
            const taxaOp = r.freteComprador && SHC.num(r.taxaOperacional) > 0 ? SHC.num(r.taxaOperacional) : 0;
            return b - b * tarifaPct - u * (frete + taxaOp) - u * (custo + outros) - b * imp;
        };
        const antLido = compara;
        out.fator3 = cm.ms < 864e5 ? 0 : cm.ms / cm.dur;   // ritmo do mês contra a média dos 3 meses antes (o "Por que caiu?" usa na família e na conta)
        grupos.forEach(g => {
            const mb = new Set(g.membros), ids = new Set(), porSku = {}, subs = {};
            [mes, ant].forEach(m => { if (lido(m)) Object.keys(M[m].porAnuncio).forEach(id => { if (mb.has(famDe(id))) ids.add(id); }); });
            ids.forEach(id => {
                // F18: anúncio de VARIAÇÕES (2+ SKUs) é a sua própria linha (chave = MLB), rotulada "Anúncio com N variações: A, B…" —
                // antes aparecia como o 1º SKU com a venda de todas. A venda por variação (porVariacao, F4) fica no mês do vbAnuncio.
                const vs = [...new Set([].concat((ret[id] || {}).sku || [], (ret[id] || {}).skus || [], (info[id] || {}).sku || [], (info[id] || {}).skus || []).map(SHC.normalizaSku).filter(Boolean))];
                const multi = vs.length > 1, sk = multi ? '' : skuDe(id), k = multi ? id : (sk || id);
                const s = porSku[k] || (porSku[k] = { sku: sk, titulo: '', itemIds: [], bruto: 0, brutoAnt: antLido ? 0 : null, unidades: 0, unidadesAnt: antLido ? 0 : null,
                    visitas: 0, visitasAnt: antLido ? 0 : null, lucro: 0, semCusto: false });
                if (multi) Object.assign(s, { skus: vs, rotulo: 'Anúncio com ' + vs.length + ' variações: ' + vs.slice(0, 3).join(', ') + (vs.length > 3 ? '…' : '') });
                s.itemIds.push(id);
                if (!s.titulo) s.titulo = String((info[id] || {}).titulo || (ret[id] || {}).titulo || '').slice(0, 120);
                const x = linha(mes, id), y = linha(ant, id);
                s.bruto += n0(x && x.bruto); s.unidades += n0(x && x.unidades); s.visitas += n0(x && x.visitas);
                if (antLido) { s.brutoAnt += n0(y && y.bruto); s.unidadesAnt += n0(y && y.unidades); s.visitasAnt += n0(y && y.visitas); }
                const l = lucroItem(id, x);
                if (l === null) s.semCusto = true; else s.lucro += l;
                if (n0(x && x.bruto) > 0) { const sb = (catDe(id) || {}).sub || ''; subs[sb] = (subs[sb] || 0) + n0(x.bruto); }
            });
            const skus = Object.keys(porSku).map(k => {
                const s = porSku[k], bruto = SHC.r2(s.bruto), brutoAnt = s.brutoAnt === null ? null : SHC.r2(s.brutoAnt);
                // v3.1 (pedido da dona 27/09): a série do SKU (13 meses; null = mês não lido) para comparar com MAIS de um período.
                const serie = meses.map(m => (lido(m) ? SHC.r2(s.itemIds.reduce((t, id) => t + n0((linha(m, id) || {}).bruto), 0)) : null));
                const tres = serie.slice(9, 12), media3 = tres.every(v => v !== null) && meses.slice(9, 12).every(m => !cobM(m).parcial) ? SHC.r2((tres[0] + tres[1] + tres[2]) / 3) : null;
                return Object.assign(s.skus ? { skus: s.skus, rotulo: s.rotulo } : {}, { sku: s.sku, titulo: s.titulo, itemIds: s.itemIds, bruto, brutoAnt, variacaoPct: varFam(bruto, brutoAnt, fator),
                    'variacaoR$': brutoAnt === null ? null : SHC.r2(bruto - brutoAnt * fator), unidades: s.unidades, unidadesAnt: s.unidadesAnt,
                    precoMedio: s.unidades > 0 ? SHC.r2(bruto / s.unidades) : null, precoMedioAnt: s.unidadesAnt > 0 ? SHC.r2(brutoAnt / s.unidadesAnt) : null,
                    visitas: s.visitas, visitasAnt: s.visitasAnt, lucro: s.semCusto ? null : SHC.r2(s.lucro), semCusto: s.semCusto, fator,
                    serie, media3, variacao3Pct: cm.ms < 864e5 ? null : varFam(bruto, media3, out.fator3), brutoAno: serie[0], variacaoAnoPct: varFam(bruto, serie[0], fatorAno) });
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
            // v3.1: anúncios da família com estoque e SEM venda nos 3 últimos meses (os 3 lidos): candidatos a liquidar/descartar.
            const tres = [mes, ant, mesMenos(mes, 2)];
            // ponytail: só anúncios ATIVOS (o pausado de propósito não vira alerta); anúncio criado há menos de 3 meses também entra (o retrato não tem a data de criação).
            item.parados = !tres.every(lido) ? null : Object.keys(ret).filter(id => mb.has(famDe(id)) && !ids.has(id) && SHC.anuncioAtivo(ret[id]) && tres.every(m => !(n0((linha(m, id) || {}).bruto) > 0)))
                .map(id => ({ itemId: id, sku: SHC.normalizaSku(ret[id].sku || ''), titulo: String(ret[id].titulo || '').slice(0, 120), estoque: inteiro(ret[id].estoque) }))
                .filter(p => p.estoque > 0).sort((a, b) => b.estoque - a.estoque);
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
            // F13c: o produto do Full é da VARIAÇÃO — casa com qualquer SKU do anúncio (k.skus) e o envio leva o SKU da variação, não o 1º do anúncio.
            const ksk = [k.sku].concat(k.skus || []).filter(Boolean);
            prods.filter(p => (p.sku && ksk.indexOf(SHC.normalizaSku(p.sku)) >= 0) || (p.itemIds && p.itemIds.length ? p.itemIds : [p.itemId]).some(x => (k.itemIds || []).indexOf(x) >= 0)).forEach(p => {
                const v30 = unDe(p.vendas30), aptas = Math.max(0, unDe(p.aptas) || 0), cam = Math.max(0, unDe(p.aCaminho) || 0);
                if (unDe(p.aptas) === null && v30 === null) return;
                noFull++;
                if (!(v30 > 0)) return;
                const previsao = Math.ceil(v30 * (1 + subidaPct / 100)), un = previsao - aptas - cam, sku = SHC.normalizaSku(p.sku) || k.sku;
                if (un > 0 && !envios.some(e => e.sku === sku && e.titulo === (p.titulo || k.titulo)))
                    envios.push({ sku, titulo: String(p.titulo || k.titulo || '').slice(0, 120), un, aptas, aCaminho: cam, previsao });
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

    // ══ v3.1 (pedidos da dona 26 e 27/09/2026): faturamento por família VISUAL e INTELIGENTE — estoque × venda de cada SKU, o gargalo da
    // queda comparando com MAIS de um período, e a época forte de compra. Só com o que o Copiloto já lê (vbAnuncio, retrato de anúncios,
    // Full, radar de visitas, competição, frete). Sem dado → diz o que falta; nenhum número inventado. ══
    const capIni = t => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);
    const decTxt = v => String(Math.round(v * 10) / 10).replace('.', ',');
    /**
     * Estoque publicado de UM SKU ({sku, itemIds}) → { lido, full (aptas no Full) | null, proprio (anúncios fora do Full) | null, total | null, aCaminho }.
     * Anúncios do mesmo SKU (itemIds ou o mesmo SKU no retrato) que dividem o produto (familia/MLBU) contam 1 vez. lido false = nem o retrato
     * nem o Full têm este SKU (nunca 0 inventado).
     */
    SHC.estoqueSku = function (s, itens, full) {
        const ids = (s && s.itemIds) || [], sku = (s && s.sku) || '', lista = Array.isArray(itens) ? itens : ((itens && itens.itens) || []);
        const dele = (p, x) => (sku && SHC.normalizaSku(p.sku || '') === sku) || x.some(i => ids.indexOf(i) >= 0);
        const prods = ((full && full.produtos) || []).filter(p => p && dele(p, p.itemIds && p.itemIds.length ? p.itemIds : [p.itemId]));
        const noFull = new Set();
        prods.forEach(p => (p.itemIds && p.itemIds.length ? p.itemIds : [p.itemId]).forEach(x => noFull.add(x)));
        const porProduto = {};
        lista.filter(i => i && i.itemId && !noFull.has(i.itemId) && dele(i, [i.itemId])).forEach(i => {
            const e = /sem estoque/i.test(String(i.estoque || '')) ? 0 : inteiro(i.estoque), k = i.familia || i.itemId;
            if (e !== null) porProduto[k] = Math.max(porProduto[k] || 0, e);
        });
        const ks = Object.keys(porProduto), proprio = ks.length ? ks.reduce((t, k) => t + porProduto[k], 0) : null;
        let fullUn = null, aCaminho = 0;
        prods.forEach(p => { const a = unDe(p.aptas); if (a !== null) fullUn = (fullUn || 0) + Math.max(0, a); aCaminho += Math.max(0, unDe(p.aCaminho) || 0); });
        const lido = proprio !== null || fullUn !== null;
        return { lido, full: fullUn, proprio, total: lido ? (proprio || 0) + (fullUn || 0) : null, aCaminho };
    };
    // Limites das recomendações por SKU (regra da dona): tendência de ±10% contra o mês anterior; estoque "baixo" < 15 dias, "alto" > 60 dias.
    SHC.REC_SKU = { subindo: 10, caindo: -10, coberturaBaixa: 15, coberturaAlta: 60 };
    /**
     * Recomendação de UM SKU (de SHC.familias) com o estoque dele (SHC.estoqueSku) → { acao: 'repor'|'full'|'baixar'|'manter'|'sem_dado',
     *   cor: 'vermelho'|'azul'|'amarelo'|'verde'|'cinza', rotulo, motivo (1 linha), vendaDia | null, cobertura (dias) | null }.
     * dias = dias do mês que a leitura cobre (SHC.familias(...).diasCobertos). Tendência = variacaoPct (contra o mês anterior, pelo ritmo).
     * Vendendo + estoque para menos de 15 dias (ou zerado) → repor; subindo + estoque só com você → enviar ao Full; caindo + estoque para mais de 60 dias
     * (ou sem venda com estoque) → baixar preço/promoção; o resto → manter.
     */
    SHC.recomendaSku = function (s, est, dias) {
        const L = SHC.REC_SKU, un = numF(s && s.unidades), v = numF(s && s.variacaoPct), d = numF(dias) >= 1 ? dias : null;
        const vendaDia = un !== null && d ? un / d : null, out = { vendaDia: vendaDia === null ? null : Math.round(vendaDia * 10) / 10, cobertura: null };
        if (!est || !est.lido) return Object.assign(out, { acao: 'sem_dado', cor: 'cinza', rotulo: 'Sem estoque lido', motivo: 'O estoque deste SKU ainda não foi lido (lista de Anúncios ou Full).' });
        const cob = vendaDia > 0 ? Math.floor(est.total / vendaDia) : null;
        out.cobertura = cob;
        const ritmo = vendaDia > 0 ? 'vende ' + decTxt(vendaDia) + ' por dia' : 'sem venda neste mês', tend = v === null ? '' : 'vendas ' + (v >= 0 ? '▲ ' : '▼ ') + pctTxt(v) + ', ';
        const dura = cob === null ? '' : ' dá para ' + SHC.qtd(cob, 'dia', 'dias');
        // Vendendo e o estoque acaba em menos de 15 dias (ou já acabou) → repor, com vendas subindo ou caindo (sem estoque, a venda cai de qualquer jeito).
        if (vendaDia > 0 && cob < L.coberturaBaixa)
            return Object.assign(out, { acao: 'repor', cor: 'vermelho', rotulo: 'Repor', motivo: (est.total > 0 ? 'Estoque de ' + unTxt(est.total) + dura : 'Sem estoque') + ' e ' + ritmo + '.' });
        if (v !== null && v >= L.subindo && est.proprio > 0 && !(est.full > 0))
            return Object.assign(out, { acao: 'full', cor: 'azul', rotulo: 'Enviar ao Full', motivo: capF(tend) + unTxt(est.proprio) + ' no seu estoque, fora do Full.' });
        if ((v !== null && v <= L.caindo && (cob === null || cob > L.coberturaAlta) && est.total > 0) || (!(vendaDia > 0) && est.total > 0 && un !== null))
            return Object.assign(out, { acao: 'baixar', cor: 'amarelo', rotulo: 'Baixar preço ou promoção', motivo: capF(tend) + 'estoque de ' + unTxt(est.total) + (cob === null ? ' parado' : dura) + '.' });
        return Object.assign(out, { acao: 'manter', cor: 'verde', rotulo: 'Manter', motivo: capF(tend) + (est.total > 0 ? 'estoque de ' + unTxt(est.total) + dura : 'sem estoque e sem venda') + '.' });
    };
    /** Anúncio parado (SHC.familias(...)[i].parados: estoque e nenhuma venda nos 3 últimos meses) → a mesma forma de SHC.recomendaSku. */
    SHC.recomendaParado = p => ({ acao: 'liquidar', cor: 'vermelho', rotulo: 'Liquidar ou descartar', vendaDia: 0, cobertura: null,
        motivo: 'Nenhuma venda nos últimos 3 meses e ' + unTxt((p && p.estoque) || 0) + ' paradas.' });

    const ORDEM_GARGALO = ['estoque', 'anuncio', 'buybox', 'preco', 'visitas', 'sazonal', 'frete', 'ads'];
    /**
     * "Por que caiu?" com indicador de gargalo (pedido da dona 27/09: "compara com outros meses… se é estoque, variação de preço, sazonalidade,
     * buy box… algo visual onde está o gargalo"). sku = item de SHC.familias(...)[i].skus; dados = os de SHC.porQueCaiu + { mes, dias, familia,
     * conta (o array de SHC.familias: variacaoPct/variacao3Pct da conta inteira) }. Sem o mesmo mês do ano passado, a sazonalidade compara com a família e a conta.
     * → { comparacoes: [{ id: 'ant'|'media3'|'ano', rotulo, pct | null, motivo? }],
     *     causas: [{ id: estoque|anuncio|buybox|preco|visitas|sazonal|frete|ads, nome, nivel: 'e'|'contribui'|'nao'|'semdado', texto, curto (poucas palavras + o número) }],
     *     principal (id | null), manchete, resumo ('Gargalo: …' | 'Pode ser: …' | 'Sem causa clara nos dados'), lista (SHC.porQueCaiu) }
     * nivel: 'e' = é essa (vermelho), 'contribui' (amarelo), 'nao' = não é (verde), 'semdado' (cinza). Visitas que caíram JUNTO com estoque, anúncio
     * pausado ou catálogo perdido são consequência ('contribui'). anuncio e ads só aparecem quando há o que dizer. Nunca inventa causa.
     */
    SHC.gargaloQueda = function (sku, dados) {
        const d = dados || {}, s = sku || {}, hoje = d.hoje || SHC.hoje(), mes = /^\d{4}-\d{2}$/.test(String(d.mes || '')) ? d.mes : hoje.slice(0, 7), ant = mesMenos(mes, 1), R = SHC.moeda;
        const lista = SHC.porQueCaiu(s, d), tem = t => (lista.find(c => c.tipo === t) || {}).texto || '';
        const comparacoes = [
            { id: 'ant', rotulo: (s.fator > 0 && s.fator < 0.999 ? 'mesmo período de ' : '') + nomeMesFam(ant), pct: numF(s.variacaoPct) },
            { id: 'media3', rotulo: 'média dos 3 meses antes', pct: numF(s.variacao3Pct) },
            { id: 'ano', rotulo: nomeMesFam(mes) + ' do ano passado', pct: numF(s.variacaoAnoPct) },
        ];
        comparacoes.forEach(c => { if (c.pct === null) c.motivo = c.id === 'ant' ? 'sem ' + nomeMesFam(ant) + ' lido' : c.id === 'media3' ? 'precisa dos 3 meses antes lidos' : (numF(s.brutoAno) === 0 ? 'não vendia no ano passado' : 'sem o ano passado lido'); });
        const causas = [], C = (id, nome, nivel, texto, curto) => causas.push(Object.assign({ id, nome, nivel, texto }, curto ? { curto } : {}));
        const n0f = v => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'), rs0 = v => 'R$ ' + n0f(v);
        const ids = (s.itemIds || []).filter(Boolean), itens = Array.isArray(d.itens) ? d.itens : ((d.itens && d.itens.itens) || []), ret = itens.filter(i => i && ids.indexOf(i.itemId) >= 0);
        // Estoque (hoje: o Copiloto não guarda o estoque dia a dia — só o de agora)
        const est = SHC.estoqueSku(s, itens, d.full), rec = SHC.recomendaSku(s, est, d.dias);
        if (tem('estoque')) C('estoque', 'Estoque', 'e', tem('estoque'));
        else if (est.lido && rec.cobertura !== null && rec.cobertura < 7) C('estoque', 'Estoque', 'contribui', 'Estoque baixo: ' + unTxt(est.total) + ', dá para ' + SHC.qtd(rec.cobertura, 'dia', 'dias') + '.');
        else if (est.lido) C('estoque', 'Estoque', 'nao', 'Tem ' + unTxt(est.total) + ' em estoque agora.');
        else C('estoque', 'Estoque', 'semdado', 'O estoque deste SKU ainda não foi lido.');
        if (tem('pausado')) C('anuncio', 'Anúncio', 'e', tem('pausado'));
        // Buy Box (catálogo)
        const comp = d.comp || {}, noCat = ret.some(r => r.catalogoML || r.competicao) || ids.some(id => comp[id]);
        if (tem('catalogo')) C('buybox', 'Buy Box', 'e', tem('catalogo'));
        else if (noCat) C('buybox', 'Buy Box', 'nao', 'Não está perdendo o catálogo.');
        else if (ret.length) C('buybox', 'Buy Box', 'nao', 'Não é anúncio de catálogo.');
        else C('buybox', 'Buy Box', 'semdado', 'O anúncio não está na lista lida.');
        // Preço
        if (tem('preco_subiu')) C('preco', 'Preço', tem('vendeu_menos') ? 'e' : 'contribui', tem('preco_subiu'));
        else if (tem('mais_barato')) C('preco', 'Preço', 'contribui', tem('mais_barato'));
        else if (numF(s.precoMedio) > 0 && numF(s.precoMedioAnt) > 0) C('preco', 'Preço', 'nao', 'Preço médio parecido: ' + R(s.precoMedio) + ' contra ' + R(s.precoMedioAnt) + '.');
        else {
            // v3.1 (pedido da dona 29/09: "sempre compare com o que já tem"): falta o médio de um dos meses → o preço de HOJE contra o médio que existe.
            const pHoje = Math.max(0, ...ret.map(r => numF(r.preco) || 0)), temM = numF(s.precoMedio) > 0, pBase = temM ? s.precoMedio : numF(s.precoMedioAnt);
            const mB = nomeMesFam(temM ? mes : ant), mF = nomeMesFam(temM ? ant : mes);
            if (pHoje > 0 && pBase > 0) C('preco', 'Preço', pHoje > pBase * 1.03 ? 'contribui' : 'nao', 'O preço de hoje (' + R(pHoje) + ') está ' + (pHoje > pBase * 1.03 ? 'acima do' : pHoje < pBase * 0.97 ? 'abaixo do' : 'parecido com o')
                + ' preço médio de ' + mB + ' (' + R(pBase) + '). Não tenho o preço médio de ' + mF + (temM ? '' : ' (sem venda)') + '.', pHoje > pBase * 1.03 ? 'preço ' + rs0(pBase) + ' → ' + rs0(pHoje) + ' hoje' : 'preço de hoje ' + rs0(pHoje));
            else C('preco', 'Preço', 'semdado', 'Sem o preço médio dos dois meses nem o preço de hoje para comparar.');
        }
        // Visitas (consequência quando junto com estoque, anúncio pausado ou catálogo perdido)
        const outraE = causas.some(c => c.nivel === 'e'), cfgG = Object.assign({}, SHC.PADRAO, d.cfg || {});
        const rvOk = ids.map(id => (d.visitas && d.visitas[id] && d.visitas[id].dias ? SHC.radarVisitas(d.visitas[id].dias, hoje, cfgG.radar_queda_pct) : null)).find(r => r && r.ult7 !== null && r.classe !== 'caindo');
        if (tem('visitas')) C('visitas', 'Visitas', outraE ? 'contribui' : 'e', tem('visitas'));
        else if (numF(s.visitasAnt) > 0 && numF(s.visitas) !== null) C('visitas', 'Visitas', 'nao', 'Visitas no ritmo do mês anterior.');
        else if (rvOk) C('visitas', 'Visitas', 'nao', 'Visitas da última semana: ' + rvOk.ult7 + ' contra ' + rvOk.ant7 + ' na semana antes (não caíram).', 'visitas ok na semana (' + rvOk.ult7 + ')');
        else C('visitas', 'Visitas', 'semdado', 'Sem as visitas dos dois meses para comparar.');
        // Sazonalidade: o mesmo mês no ano passado contra a média daquele ano (a série do SKU; se ele não vendia, a da família)
        const serieSku = Array.isArray(s.serie) ? s.serie : [], fs = ((d.familia && d.familia.serie12) || []).map(p => (p && !p.parcial ? p.bruto : null));
        const usa = serieSku.length === 13 && serieSku[0] > 0 ? { v: serieSku, de: 'este SKU' } : fs.length === 13 && fs[0] > 0 ? { v: fs, de: 'a família' } : null;
        const outros = usa ? usa.v.slice(1, 12).filter(x => x !== null) : [];
        if (usa && outros.length >= 6) {
            const media = outros.reduce((t, x) => t + x, 0) / outros.length, dif = media > 0 ? r1f((usa.v[0] - media) / media * 100) : null;
            if (dif === null) C('sazonal', 'Sazonalidade', 'semdado', 'Sem vendas no ano passado para comparar.');
            else C('sazonal', 'Sazonalidade', dif <= -15 ? 'e' : dif < -5 ? 'contribui' : 'nao', 'No ano passado, ' + nomeMesFam(mes) + ' vendeu ' + pctTxt(dif) + (dif < 0 ? ' abaixo' : ' acima') + ' da média do ano para ' + usa.de
                + (dif <= -15 ? ': é um mês fraco.' : dif < -5 ? ': um pouco mais fraco.' : ': não é um mês fraco.'));
        } else {
            // v3.1 (pedido da dona 29/09: "se não tiver dos 12 meses… sempre é bom mostrar e comparar com o que você já tem"): diz o mês que falta
            // e compara a queda deste SKU com a do RESTO da família e do resto da conta no mesmo período (sem o próprio SKU: senão a queda dele puxa
            // a família para baixo e parece época). Caíram juntos → sinal de época; só o SKU caiu → não é época.
            const mAno = mesMenos(mes, 12), anoTxt = nomeMesFam(mAno) + ' de ' + mAno.slice(0, 4);
            const falta = usa ? 'Tenho ' + anoTxt + ', mas poucos meses lidos depois dele para saber se é mês fraco.'
                : serieSku[0] === 0 ? 'Este SKU não vendia em ' + anoTxt + '.' : 'Não tenho ' + anoTxt + ' deste SKU.';
            const f = d.familia, famOk = f && f.familia !== SHC.FAMILIA_SEM && f.familia !== SHC.FAMILIA_OUTRAS && (f.skus || []).length > 1;
            const mv = p => (p > 0 ? 'subiu ' + pctTxt(p) : p < 0 ? 'caiu ' + pctTxt(p) : 'ficou igual'), seta = p => (p > 0 ? '▲ ' : p < 0 ? '▼ ' : '= ') + pctTxt(p);
            const pts = x => (x && Array.isArray(x.serie12) && x.serie12.length === 13 ? x.serie12 : null), tira = serieSku.length === 13, f3 = numF(d.conta && d.conta.fator3);
            const cps = d.conta && d.conta.length > 1 ? d.conta.map(pts) : [];
            const contaPts = cps.length && cps.every(Boolean) ? cps[0].map((_, i) => (cps.some(p => p[i].bruto === null) ? { bruto: null } : { bruto: cps.reduce((t, p) => t + p[i].bruto, 0), parcial: cps.some(p => p[i].parcial) })) : null;
            // pontos (13) → { variacao3Pct, variacaoPct } do resto (os pontos − este SKU), pelo mesmo ritmo do SKU
            const resto = P => {
                if (!P) return {};
                const v = P.map((p, i) => (p.bruto === null || (tira && serieSku[i] === null) ? null : SHC.r2(p.bruto - (tira ? serieSku[i] : 0)))), t = v.slice(9, 12);
                const m3 = t.every(x => x !== null) && P.slice(9, 12).every(p => !p.parcial) ? (t[0] + t[1] + t[2]) / 3 : null;
                return { variacao3Pct: f3 > 0 ? varFam(v[12], m3, f3) : null, variacaoPct: s.fator > 0 ? varFam(v[12], v[11], s.fator) : null };
            };
            const rF = famOk ? resto(pts(f)) : {}, rC = resto(contaPts), de = tira ? 'o resto da ' : 'a ';
            const bases = [{ k: 'variacao3Pct', txt: 'contra a média dos 3 meses antes' }, { k: 'variacaoPct', txt: 'contra ' + (s.fator > 0 && s.fator < 0.999 ? 'o mesmo período de ' : '') + nomeMesFam(ant) }]
                .map(b => Object.assign(b, { sku: numF(s[b.k]), refs: [{ nome: de + 'família ' + (f && f.familia), curto: 'família', pct: numF(rF[b.k]) }, { nome: de + 'conta', curto: 'conta', pct: numF(rC[b.k]) }]
                    .filter(r => r.pct !== null) }));
            // a base em que o SKU caiu vem primeiro (senão a época vira "o gargalo" de um SKU que subiu na comparação mostrada)
            const b = bases.find(x => x.refs.length && x.sku !== null && x.sku < 0) || bases.find(x => x.refs.length && x.sku !== null) || bases.find(x => x.refs.length);
            if (!b) {
                const bs = bases.find(x => x.sku !== null);
                C('sazonal', 'Sazonalidade', 'semdado', falta + (bs ? ' Este SKU ' + mv(bs.sku) + ' ' + bs.txt + ', mas' : ' E') + ' não tenho a família nem a conta no mesmo período para saber se é época.', 'sem base para comparar');
            } else {
                const r = b.refs[0], pS = b.sku, quem = (tira ? 'o resto da ' : 'a ') + r.curto + (tira ? '' : ' toda');
                const c = b.refs.find(x => x !== r); // a conta, quando r é a família
                const nivel = pS !== null && pS >= 0 ? 'nao' : r.pct <= -15 && (pS === null || r.pct <= pS / 2) ? 'e' : r.pct < -5 ? 'contribui' : 'nao';
                const fecho = nivel === 'e' ? 'Parece época: ' + quem + ' caiu junto.' : nivel === 'contribui' ? (r.pct <= -15 ? 'A época explica só parte: este SKU caiu bem mais.' : 'A época pesa um pouco.')
                    : pS !== null && pS >= 0 ? 'Não parece época: este SKU não caiu.'
                    : c && c.pct <= -15 ? 'Não parece época da família: a conta caiu, a família não.'
                    : c && c.pct < -5 ? 'Não parece época: ' + quem + ' não caiu junto.'
                    : 'Não parece época' + (pS !== null ? ': só este SKU caiu.' : '.');
                C('sazonal', 'Sazonalidade', nivel, falta + ' Comparei ' + nomeMesFam(mes) + ' ' + b.txt + ': ' + b.refs.map(x => x.nome + ' ' + mv(x.pct)).join(', ') + (pS !== null ? ' e este SKU ' + mv(pS) : '') + '. ' + fecho,
                    (nivel === 'e' ? 'parece época' : nivel === 'contribui' ? 'época pesa um pouco' : 'não é época') + ' (' + r.curto + ' ' + seta(r.pct) + ')');
            }
        }
        // Frete (custo seu: pesa na margem e na competitividade, não derruba sozinho a venda)
        const fr = d.fretes || {}, fr1 = ids.map(id => fr[id] || {}).map(h => Object.keys(h).filter(k => k <= hoje && numF(h[k]) !== null).sort().map(k => h[k])).find(v => v.length === 1);
        if (tem('frete')) C('frete', 'Frete', 'contribui', tem('frete'));
        else if (ids.some(id => Object.keys(fr[id] || {}).length >= 2)) C('frete', 'Frete', 'nao', 'O frete que você paga não subiu.');
        else C('frete', 'Frete', 'semdado', fr1 ? 'Só tenho o frete de hoje (' + R(fr1[0]) + '): falta um de antes para comparar.' : 'Sem o histórico do frete deste anúncio.');
        if (tem('ads')) C('ads', 'Mercado Ads', 'contribui', tem('ads'));
        // v3.1 (print da dona 29/09: "muito texto e pouco visual"): cada causa também em poucas palavras COM o número que a prova (etiqueta e manchete da tela).
        const fr0 = s.fator > 0 ? s.fator : 1;
        const CURTO = {
            estoque: c => (c.nivel === 'e' ? (/Full/.test(c.texto) ? 'sem estoque no Full' : 'anúncio sem estoque')
                : c.nivel === 'contribui' ? 'estoque baixo — ' + n0f(est.total) + ' un. (' + SHC.qtd(rec.cobertura, 'dia', 'dias') + ')' : c.nivel === 'nao' ? n0f(est.total) + ' un. em estoque' : 'estoque não lido'),
            anuncio: c => 'anúncio ' + ((/\(([^)]+)\)\.$/.exec(c.texto) || [])[1] || 'inativo'),
            buybox: c => (c.nivel === 'e' ? (/fora da disputa/i.test(c.texto) ? 'fora da disputa do catálogo' : 'perdendo o catálogo') + (/ por preço/.test(c.texto) ? ' (preço)' : / pela forma de entrega/.test(c.texto) ? ' (entrega)' : '')
                : c.nivel === 'nao' ? (noCat ? 'não perde o catálogo' : 'não é catálogo') : 'anúncio não lido'),
            preco: c => (tem('preco_subiu') ? 'preço subiu ' + rs0(s.precoMedioAnt) + ' → ' + rs0(s.precoMedio > s.precoMedioAnt * 1.03 ? s.precoMedio : Math.max(0, ...ret.map(r => numF(r.preco) || 0)))
                : tem('mais_barato') ? 'preço caiu ' + rs0(s.precoMedioAnt) + ' → ' + rs0(s.precoMedio) : c.nivel === 'nao' ? 'preço igual (' + rs0(s.precoMedio) + ')' : 'sem preço dos 2 meses'),
            visitas: c => (c.nivel === 'e' || c.nivel === 'contribui' ? 'visitas ▼ ' + ((/caíram ([\d,]+%)/.exec(c.texto) || [])[1] ? /caíram ([\d,]+%)/.exec(c.texto)[1] + ' na semana' : pctTxt((1 - s.visitas / (s.visitasAnt * fr0)) * 100))
                : c.nivel === 'nao' ? 'visitas no ritmo' : 'visitas não lidas'),
            sazonal: c => { const m = /vendeu ([\d,]+%) abaixo/.exec(c.texto);
                return c.nivel === 'e' ? 'mês fraco (−' + m[1] + ' no ano passado)' : c.nivel === 'contribui' ? 'mês um pouco fraco (−' + m[1] + ')' : c.nivel === 'nao' ? 'não é mês fraco'
                    : 'sem base para comparar'; },
            frete: c => { const m = /de (R\$ [\d.,]+) para (R\$ [\d.,]+)/.exec(c.texto); return m ? 'frete ' + m[1] + ' → ' + m[2] : c.nivel === 'nao' ? 'frete igual' : 'sem histórico do frete'; },
            ads: c => (/verba/.test(c.texto) ? 'Ads sem verba' : 'Ads pausado'),
        };
        causas.forEach(c => { c.curto = c.curto || CURTO[c.id](c); });
        causas.sort((a, b) => ORDEM_GARGALO.indexOf(a.id) - ORDEM_GARGALO.indexOf(b.id));
        const e = causas.find(c => c.nivel === 'e'), ct = causas.find(c => c.nivel === 'contribui');
        const nm = c => (c.id === 'buybox' || c.id === 'ads' ? c.nome : c.nome.toLowerCase());   // nome próprio (Buy Box, Mercado Ads) fica como é
        const manchete = e ? 'O gargalo é ' + nm(e) + ': ' + capIni(e.texto) : ct ? 'Pode ser ' + nm(ct) + ': ' + capIni(ct.texto)
            : 'Os dados que o Copiloto tem não mostram um gargalo claro.';
        // resumo = a manchete em 1 linha curta (sempre visível no cartão do SKU, sem clicar)
        const resumo = e ? 'Gargalo: ' + e.curto : ct ? 'Pode ser: ' + ct.curto : 'Sem causa clara nos dados';
        return { comparacoes, causas, principal: e ? e.id : ct ? ct.id : null, manchete, resumo, lista };
    };

    /**
     * Época forte de compra de UMA família (item de SHC.familias): um dos 2 próximos meses, no ano passado, vendeu 20% ou mais acima da média
     * dos meses inteiros lidos → { aplica: true, mes, acimaPct, ate ('AAAA-MM-DD' | null = o quanto antes), texto } | { aplica: false, motivo }.
     * ate = dia 1º do mês forte − 21 dias (2 semanas para comprar + 1 para a remessa chegar ao Full). Precisa de 10 meses inteiros lidos.
     */
    SHC.sazonalCompra = function (familia, opc) {
        const o = opc || {}, hoje = o.hoje || SHC.hoje(), nome = (familia && familia.familia) || 'a família';
        if (!familia || familia.familia === SHC.FAMILIA_OUTRAS || familia.familia === SHC.FAMILIA_SEM) return { aplica: false, motivo: 'Grupo misto: não mostra sazonalidade.' };
        const s = (familia.serie12 || []).filter(p => p && /^\d{4}-\d{2}$/.test(p.mes)), ult = s[s.length - 1], inteiros = s.filter(p => p.bruto !== null && !p.parcial);
        if (!ult || inteiros.length < 10) return { aplica: false, motivo: 'Para avisar a época forte de compra preciso de pelo menos 10 meses inteiros de histórico (tenho ' + SHC.qtd(inteiros.length, 'mês', 'meses') + ').' };
        const media = inteiros.reduce((t, p) => t + p.bruto, 0) / inteiros.length;
        if (!(media > 0)) return { aplica: false, motivo: 'Sem vendas no último ano.' };
        // Família que parou de vender (os 2 últimos meses lidos zerados) não ganha aviso de compra.
        if (s.slice(-2).every(p => p.bruto !== null && !(p.bruto > 0))) return { aplica: false, motivo: nome + ' não vende nos 2 últimos meses.' };
        for (let k = 1; k <= 2; k++) {
            const alvo = mesMenos(ult.mes, -k), p = s.find(x => x.mes === mesMenos(alvo, 12));
            if (alvo <= hoje.slice(0, 7) || !p || p.bruto === null || p.parcial) continue;   // só meses que ainda vão chegar
            const acimaPct = r1f((p.bruto - media) / media * 100);
            if (acimaPct < 20) continue;
            const lim = diaMenosISO(alvo + '-01', 21), ate = lim >= hoje ? lim : null;
            return { aplica: true, mes: alvo, acimaPct, ate, texto: capF(nomeMesFam(alvo)) + ' costuma ser forte para ' + nome + ': no ano passado vendeu ' + pctTxt(acimaPct) + ' acima da média. '
                + 'Compre e envie ao Full ' + (ate ? 'até ' + ate.slice(8, 10) + '/' + ate.slice(5, 7) : 'o quanto antes') + ' (2 semanas para comprar + 1 para chegar ao Full).' };
        }
        return { aplica: false, motivo: 'Os próximos 2 meses não costumam ser mais fortes para ' + nome + '.' };
    };

    /**
     * O que pede ação no faturamento por família (a linha "Precisa de você" da Geral e o ícone) → { repor, full, baixar, liquidar: [{familia, sku, titulo, itemId, motivo}],
     *   sazonal: [{familia, texto, ate}], total (SKUs), texto ('' sem nada) }. fams = SHC.familias; itens = retrato; full = ml:full:<conta>.
     */
    SHC.familiasAcoes = function (fams, itens, full, opc) {
        const o = opc || {}, out = { repor: [], full: [], baixar: [], liquidar: [], sazonal: [], total: 0, texto: '' };
        if (!fams || !fams.lido) return out;
        (fams || []).forEach(f => {
            (f.skus || []).filter(s => s.bruto > 0).forEach(s => {
                const r = SHC.recomendaSku(s, SHC.estoqueSku(s, itens, full), fams.diasCobertos);
                if (out[r.acao]) out[r.acao].push({ familia: f.familia, sku: s.sku, titulo: s.titulo, itemId: (s.itemIds || [])[0] || '', motivo: r.motivo });
            });
            (f.parados || []).forEach(p => out.liquidar.push({ familia: f.familia, sku: p.sku, titulo: p.titulo, itemId: p.itemId, motivo: SHC.recomendaParado(p).motivo }));
            const sz = SHC.sazonalCompra(f, { hoje: o.hoje });
            if (sz.aplica) out.sazonal.push({ familia: f.familia, texto: sz.texto, ate: sz.ate, mes: sz.mes });
        });
        out.total = out.repor.length + out.full.length + out.baixar.length + out.liquidar.length;
        const partes = [out.repor.length ? SHC.qtd(out.repor.length, 'SKU para repor', 'SKUs para repor') : '', out.full.length ? out.full.length + ' para enviar ao Full' : '',
            out.baixar.length ? out.baixar.length + ' para baixar preço' : '', out.liquidar.length ? SHC.qtd(out.liquidar.length, 'anúncio parado (3 meses sem venda)', 'anúncios parados (3 meses sem venda)') : '',
            out.sazonal.length ? capF(nomeMesFam(out.sazonal[0].mes)) + ' forte para ' + out.sazonal[0].familia + (out.sazonal[0].ate ? ' (compre até ' + out.sazonal[0].ate.slice(8, 10) + '/' + out.sazonal[0].ate.slice(5, 7) + ')' : '') : ''].filter(Boolean);
        out.texto = partes.join(' · ');
        return out;
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
     * → { abertas, fechadas30d, comInconformidade:[{id, statusTexto, quando, textos}], comMulta:[{id, valor, tipo, recebida, texto}], unidadesFaltando,
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
                if (ativa) out.comMulta.push({ id: String(r.id), valor, tipo: r.multaTipo || '', recebida: r.recebida || '', texto: valor !== null ? 'Multa de ' + SHC.moeda(valor) + tipo : 'Multa' + tipo + ' — o valor aparece em Gestão de envios Full' });
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
    const linkDe = o => { const ev = ((o && o.cta && o.cta.events) || (o && o.events) || []).find(e => e && e.type === 'redirect' && e.data && e.data.href); const h = ev ? String(ev.data.href) : ''; return linkMLOk(h) || /^\/(?![/\\])[^\x00-\x1f\x7f\\]*$/.test(h) ? h : ''; };   // 3.2.1: href de outro domínio não entra (nem '//x', barra invertida ou TAB, que o navegador lê como //x)
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
        const texto = SHC.qtd(p.pendentes, 'pergunta sem resposta', 'perguntas sem resposta') + '. O Mercado Livre diz que um bom tempo de resposta aumenta a exposição nos resultados de busca.'
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
                link: v.metric_section && linkMLOk(v.metric_section.url) ? String(v.metric_section.url) : '' };
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

    // ── v3.3 Experiência de compra do anúncio (pedido da dona 07/10/2026: "anúncio no vermelho ou abaixo da média não sai mais, empaca no Full
    // e começa a girar custo de armazenamento") ──
    // Formato oficial (developers.mercadolivre.com.br/pt_br/experiencia-de-compra, lido em 07/10/2026):
    //   anúncio: /reputation/items/<MLB>/purchase_experience/integrators → { item_id, reputation:{color, text, value}, status:{id, assigned_by, text},
    //     freeze:{text, placeholders}, metrics_details:{ problems:[{key, tag, claims, cancellations, quantity, level_two:{key, title},
    //     level_three:{key, title, remedy}}], distribution:{from, to} } };
    //   produto (UP, modelo novo com IA e sem o arrependimento do comprador): /reputation/user_products/<MLBU>/purchase_experience/integrators →
    //     { up_id, reputation, status, freeze, consequence, reasoning, recommendations, principal_actionable }. Sem vendas para calcular: {color 'gray', value -1}.
    // Central de Ajuda (experiencia-de-compra_31968): boa 75–100; mediana 50–74 (perde exposição e corre risco de pausa); ruim ≤ 30 (quase sem
    // exposição, risco de cancelamento). A Central de promoções exige 50 ou mais. Entre 31 e 49 a tabela não classifica: vale a cor que o ML mostra.
    // freeze (Benefício de reputação, verde-claro, acordo comercial…): a nota continua, mas o anúncio não perde exposição nem é pausado por ela.
    // ATENÇÃO (como o SHC.skusDoItemML): o leitor fica pronto para a tela que trouxer este formato; ele mesmo não faz GET nenhum.
    const COR_EXP = { green: 'boa', light_green: 'boa', yellow: 'mediana', orange: 'mediana', red: 'ruim' };
    SHC.EXP_PROMO_MIN = 50;
    SHC.faixaExperiencia = (cor, nota) => {
        const c = String(cor || '').toLowerCase();
        return c === 'gray' || nota === null || nota === undefined ? 'sem' : COR_EXP[c] || (nota >= 75 ? 'boa' : nota >= 50 ? 'mediana' : 'ruim');
    };
    const expTxt = o => String((o && typeof o === 'object' ? o.text : o) || '').replace(/\{\d+\}|\[\d+\]/g, '').replace(/\s+/g, ' ').trim();
    const expLista = o => ((o && Array.isArray(o.subtitles)) ? o.subtitles : []).filter(x => x && typeof x === 'object')
        .sort((a, b) => (+a.order || 0) - (+b.order || 0)).map(expTxt).filter(Boolean);
    /**
     * JSON da experiência de compra (anúncio ou produto) → { id, up, nota (0–100 | null), faixa: boa|mediana|ruim|sem, cor, status: active|paused|moderated|'',
     *   pelaExperiencia (pausa/moderação por causa da nota), congelado, congeladoTxt, problemas:[{chave, grupo, titulo, qtd, reclamacoes, cancelamentos,
     *   principal, remedio}], de, ate, consequencia, motivos:[…], recomendacoes:[…], acaoPrincipal, ts } | null (formato desconhecido).
     * Nada do comprador vem nesse JSON (só contagens e textos do ML).
     */
    SHC.mlExperienciaCompra = function (j) {
        if (!j || typeof j !== 'object') return null;
        const id = String(j.item_id || j.up_id || ''), rp = j.reputation;
        if (!/^[A-Z]{3}U?\d{4,20}$/.test(id) || !rp || typeof rp !== 'object') return null;
        const v = numF(typeof rp.value === 'string' ? Number(rp.value) : rp.value), nota = v !== null && v >= 0 && v <= 100 ? Math.round(v) : null;
        const cor = String(rp.color || '').toLowerCase().slice(0, 20), faixa = SHC.faixaExperiencia(cor, nota);
        const st = j.status || {}, status = /^(active|paused|moderated)$/.test(String(st.id || '')) ? String(st.id) : '';
        const md = j.metrics_details || {}, dist = md.distribution || {}, fz = expTxt(j.freeze);
        const problemas = (Array.isArray(md.problems) ? md.problems : []).filter(p => p && typeof p === 'object').slice(0, 10).map(p => {
            const l2 = p.level_two || {}, l3 = p.level_three || {}, rc = inteiro(p.claims) || 0, cc = inteiro(p.cancellations) || 0;
            return { chave: String(l3.key || l2.key || p.key || '').slice(0, 40), grupo: String(p.key || '').slice(0, 20), titulo: edTxt(expTxt(l3.title) || expTxt(l2.title), 90),
                qtd: rc + cc || inteiro(p.quantity) || 0, reclamacoes: rc, cancelamentos: cc, principal: /principal/i.test(String(p.tag || '')), remedio: edTxt(expTxt(l3.remedy), 160) };
        }).sort((a, b) => (b.principal - a.principal) || (b.qtd - a.qtd));
        const dia = s => (/^\d{4}-\d{2}-\d{2}/.test(String(s || '')) ? String(s).slice(0, 10) : '');
        return { id, up: /^[A-Z]{3}U\d/.test(id), nota, faixa, cor, status,
            // Pausa/moderação por causa da nota: o ML marca assigned_by 'reputation'; sem o campo (formato do produto), pausado com nota abaixo de boa.
            pelaExperiencia: (status === 'paused' || status === 'moderated') && (st.assigned_by ? st.assigned_by === 'reputation' : faixa === 'mediana' || faixa === 'ruim'),
            congelado: !!fz, congeladoTxt: edTxt(fz, 200), problemas, de: dia(dist.from), ate: dia(dist.to),
            consequencia: edTxt(expTxt(j.consequence && j.consequence.title), 200), motivos: expLista(j.reasoning).map(t => edTxt(t, 300)).slice(0, 3),
            recomendacoes: expLista(j.recommendations).map(t => edTxt(t, 160)).slice(0, 3), acaoPrincipal: edTxt(expTxt(j.principal_actionable), 160), ts: Date.now() };
    };
    /**
     * Estado de uma tela do ML → [SHC.mlExperienciaCompra] de todo objeto no formato da experiência de compra (anúncio ou produto) que vier nele
     * (o "Analisar desempenho" do anúncio). Largura primeiro, no máximo 40 níveis e 200 registros. Nenhum GET: só o que a tela já trouxe.
     */
    SHC.mlExperienciasDoEstado = function (r) {
        const out = [], vistos = new Set(), fila = r && typeof r === 'object' ? [[r, 0]] : [];
        let passos = 0;
        while (fila.length && out.length < 200 && passos++ < 200000) {
            const [o, n] = fila.shift();
            if (!o || typeof o !== 'object' || vistos.has(o)) continue;
            vistos.add(o);
            if (!Array.isArray(o) && o.reputation && (o.item_id || o.up_id)) { const x = SHC.mlExperienciaCompra(o); if (x) { out.push(x); continue; } }
            if (n < 40) (Array.isArray(o) ? o : Object.values(o)).forEach(v => { if (v && typeof v === 'object') fila.push([v, n + 1]); });
        }
        return out;
    };
    /**
     * exp:<conta> = { porItem:{MLB: SHC.mlExperienciaCompra}, porUp:{MLBU: …} } → alertas [{id, itemId, nota, faixa, texto, acao, vermelho, cor}], do pior para o melhor.
     * opc = { itens (retrato: título, user product, estoque no Full), antes (exp:<conta> da leitura anterior: queda de nota) }.
     * Vermelho: pausado/moderado pela experiência ou nota ruim. Atenção: mediana, nota que caiu 10 pontos ou mais, protegido pelo benefício.
     * Com estoque no Full e nota abaixo de boa: diz que o estoque vai empacar (sem exposição não vende e o ML cobra a armazenagem e o estoque antigo).
     */
    SHC.experienciaAlertas = function (exp, opc) {
        const o = opc || {}, porItem = (exp && exp.porItem) || {}, porUp = (exp && exp.porUp) || {}, out = [];
        const ant = (o.antes && o.antes.porItem) || {}, antUp = (o.antes && o.antes.porUp) || {}, itens = Array.isArray(o.itens) ? o.itens : [];
        const doItem = id => itens.find(i => i && i.itemId === id) || null;
        const ver = (x, it, velho) => {
            if (!x || x.faixa === 'sem' || x.nota === null) return;
            const caiu = velho && velho.nota !== null && velho.nota !== undefined && velho.nota - x.nota >= 10 ? velho.nota - x.nota : 0;
            if (x.faixa === 'boa' && !caiu && !x.pelaExperiencia) return;
            const full = it && SHC.noFull(it), nome = it && it.titulo ? nomeCurto(it.titulo) : x.id, p0 = x.problemas[0];
            const motivo = p0 && p0.titulo ? ' Problema principal: ' + p0.titulo + (p0.qtd ? ' (' + SHC.qtd(p0.qtd, 'caso', 'casos') + ')' : '') + '.' : x.acaoPrincipal ? ' ' + x.acaoPrincipal : '';
            let texto, vermelho = false, cor = 'at';
            if (x.pelaExperiencia) { texto = nome + ': ' + (x.status === 'moderated' ? 'moderado' : 'pausado') + ' pelo ML por experiência de compra (nota ' + x.nota + ').'; vermelho = true; }
            else if (x.faixa === 'ruim') { texto = nome + ': experiência de compra ruim (nota ' + x.nota + '). Quase sem exposição e com risco de o ML cancelar o anúncio.'; vermelho = !x.congelado; }
            else if (x.faixa === 'mediana') texto = nome + ': experiência de compra mediana (nota ' + x.nota + '). Está perdendo exposição e corre risco de pausa.';
            else texto = nome + ': experiência de compra caiu ' + caiu + ' pontos (nota ' + x.nota + ').';
            if (caiu && x.faixa !== 'boa') texto += ' Caiu ' + caiu + ' pontos desde a última leitura.';
            if (x.nota < SHC.EXP_PROMO_MIN) texto += ' Fora das promoções (a Central de promoções pede nota 50 ou mais).';
            if (x.congelado) { texto += ' Protegido por um benefício do ML por enquanto: corrija antes que a proteção acabe.'; cor = vermelho ? 'pr' : 'at'; }
            if (vermelho) cor = 'pr';
            const acao = (full && x.faixa !== 'boa' ? 'Não mande mais unidades ao Full: sem exposição o estoque empaca e o ML cobra a armazenagem e, depois de 4 meses, o estoque antigo. ' : '')
                + (x.pelaExperiencia ? 'Corrija a causa e reative pela lista de anúncios.' : 'Abra "Analisar desempenho" no anúncio e ataque o problema principal.') + motivo;
            out.push({ id: x.id, itemId: it ? it.itemId : (x.up ? '' : x.id), nota: x.nota, faixa: x.faixa, texto, acao: acao.trim(), vermelho, cor, full: !!full });
        };
        Object.keys(porItem).forEach(id => ver(porItem[id], doItem(id), ant[id]));
        // Produto (UP): um alerta por UP que nenhum anúncio já acusou; o retrato dá o anúncio do UP para o título e o Full.
        Object.keys(porUp).forEach(up => {
            const its = itens.filter(i => i && i.userProductId === up);
            if (its.some(i => porItem[i.itemId])) return;
            ver(porUp[up], its.find(i => SHC.noFull(i)) || its[0] || null, antUp[up]);
        });
        const peso = a => (a.vermelho ? 0 : 1) * 1000 + a.nota;
        return out.sort((a, b) => peso(a) - peso(b));
    };

    const dBR = d => d.slice(8, 10) + '/' + d.slice(5, 7);
    const moedaCurta = v => SHC.moeda(v).replace(',00', '');

    // ── v3.2 (pedido da dona 30/09): RESUMO PARA A EQUIPE (dia ou semana) no formato do WhatsApp: *negrito*, emoji de seção, "▸ " nas linhas.
    // Só números que o Copiloto já tem; seção sem dado não aparece. Nada do comprador. Quem envia é o seller (link wa.me sem número).
    SHC.WA_MAX = 6000;   // tamanho máximo do link wa.me (acima disso o WhatsApp do celular corta; o painel abre até 7.000)
    const DIA_SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
    const diaSemTxt = d => DIA_SEM[new Date(d + 'T12:00:00Z').getUTCDay()] + ' ' + dBR(d);
    const pctR = p => (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p).toLocaleString('pt-BR', { maximumFractionDigits: Math.abs(p) >= 100 ? 0 : 1 }) + '%';
    const skuNome = s => [s.sku, nomeCurto(s.titulo)].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' · ') || s.itemId || '';
    // Variação absurda (+100% ou mais, −90% ou menos) vem com a base, para não assustar: "+1.900% (de R$ 200 para R$ 4.000)".
    // A base é a MESMA grandeza e o MESMO ritmo do % (varFam: R$, mês anterior × fator); mês correndo → o mesmo período do mês passado.
    const varSku = s => { const f = s.fator > 0 ? s.fator : 1, base = numF(s.brutoAnt) !== null && numF(s.bruto) !== null ? SHC.r2(s.brutoAnt * f) : null;
        return pctR(s.variacaoPct) + ((s.variacaoPct >= 100 || s.variacaoPct <= -90) && base !== null
            ? (f < 0.999 ? ' (' + moedaCurta(s.bruto) + ' contra ' + moedaCurta(base) + ' no mesmo período do mês passado)' : ' (de ' + moedaCurta(base) + ' para ' + moedaCurta(s.bruto) + ')') : ''); };
    const EMO_CAUSA = { visitas: '👀', preco: '💲', sazonal: '📅', estoque: '📦', buybox: '🏷️', anuncio: '⏸️', frete: '🚚', ads: '📣' };
    const causaPrincipal = g => (g && g.principal && (g.causas || []).find(c => c.id === g.principal)) || null;
    // Motivo curto de quem sobe: preço mais baixo ou visitas que subiram (dos números do próprio SKU); sem prova, sem motivo.
    const motivoSobe = s => {
        if (numF(s.precoMedio) !== null && numF(s.precoMedioAnt) > 0 && s.precoMedio < s.precoMedioAnt * 0.97) return '💲 preço caiu ' + moedaCurta(s.precoMedioAnt) + ' → ' + moedaCurta(s.precoMedio);
        const f = s.fator > 0 ? s.fator : 1;
        if (numF(s.visitas) !== null && numF(s.visitasAnt) > 0 && s.visitas > s.visitasAnt * f * 1.2) return '👀 visitas ' + pctR(r1f((s.visitas / (s.visitasAnt * f) - 1) * 100));
        return '';
    };
    const CORTE_WA = ['preco', 'promo', 'visitas', 'sazonal', 'crescendo', 'reputacao', 'lucro', 'cobrancas', 'posvenda', 'full', 'caindo'];   // quem sai 1º quando o link passa do limite
    // v3.2: 🔴 Vendas no prejuízo no resumo. Motivo principal de cada venda, lido do texto de SHC.prejuizoMotivo (frete, promoção/desconto,
    // tarifa do Premium = comissão, custo do produto, Ads); nada disso → "vários" (tarifa, frete, imposto e custo juntos).
    const MOTIVO_PREJ = [{ id: 'ads', re: /\bads\b|publicidade/i, emo: '📣' }, { id: 'frete', re: /^frete/i, emo: '🚚' }, { id: 'promocao', re: /promoç|desconto/i, emo: '🏷️' },
        { id: 'comissao', re: /tarifa do premium|comiss/i, emo: '💸' }, { id: 'custo', re: /custo do produto/i, emo: '📦' }];
    SHC.prejuizoMotivoId = txt => MOTIVO_PREJ.find(m => m.re.test(String(txt || ''))) || { id: 'varios', emo: '🧮' };
    // Ação curta pelo motivo que mais tirou R$ no período; q = " do <SKU>" (1 produto só) ou " desses produtos".
    // 3.3.0, trava do frete (06/10): o Fechamento não tem mais chamado de frete; a ação manda conferir na venda.
    const FAZ_PREJ = { frete: q => 'Conferir o frete' + q + ' no detalhe da venda',
        promocao: q => 'Rever a promoção ou o desconto' + q + ' (a venda não paga o custo)', comissao: q => 'Rever o preço' + q + ' no Premium (a tarifa não cabe) ou passar para Clássico',
        custo: q => 'Subir o preço' + q + ': o ML repassa menos do que o produto custa', ads: q => 'Rever o Ads' + q,
        varios: q => 'Rever o preço' + q + ': tarifa, frete, imposto e custo passam do preço' };
    const PREJ_LISTA = 5;   // as piores do período; o link do WhatsApp grande demais encurta para 3 e, no fim, só o total
    /**
     * SHC.resumoExecutivo(conta, dados, hoje, {periodo:'dia'|'semana'}) → { texto, textoWa, waLink (null = grande demais: use Copiar), encurtado:[ids], periodo, de, ate,
     *   vendas:{valor, anterior, variacaoPct, pedidos, ticket}, secoes:[ids] }.
     * dia = ontem contra o mesmo dia da semana passada; semana = os 7 dias antes de hoje contra os 7 anteriores (hoje fica fora: não acabou).
     * dados = { nome, vb (vb:<conta>), lucro:{valor, parcial, cobertoPct}, skus:{subindo:[sku de SHC.familias], caindo:[sku + gargalo (SHC.gargaloQueda)]},
     *   itens (retrato), visitas (visitas:<conta>), comp (comp:<conta>), sazonal:[SHC.sazonalCompra aplica + familia], acoesFam (SHC.familiasAcoes),
     *   anomalias (shc:anomalias:<conta>), remessas (SHC.remessasResumo), posvenda, perguntas, reputacao, conferir, fatura (fat:<conta>), frete (frete:<conta>:hist), cert, cfg,
     *   prejuizo (prejuizo:<conta>: vendas no prejuízo do período → seção 🔴; ✅ só quando não houve, todos os dias foram lidos inteiros e nenhuma venda ficou sem custo),
     *   promoSaiu (promoSaiu:<conta>) e promoTermina (SHC.promoTermina) → seção 🏷️ Promoções (v3.2.0) }
     */
    SHC.resumoExecutivo = function (conta, dados, hoje, opc) {
        const d = dados || {}, h = hoje || SHC.hoje(), dia = !(opc && opc.periodo === 'semana'), vbd = (d.vb && d.vb.dias) || {}, cfg = d.cfg || {};
        const nome = d.nome || ('Conta ID …' + String(conta || '').slice(-4)), S = [], sec = (id, titulo, linhas) => { if (linhas.length) S.push({ id, linhas: [titulo].concat(linhas) }); };
        const de = diaMenosX(h, dia ? 1 : 7), ate = diaMenosX(h, 1), n = dia ? 1 : 7;
        const soma = (a, b) => { let s = 0, p = 0, k0 = 0, pedOk = true; for (let k = a; k <= b; k = diaMenosX(k, -1)) { const x = vbd[k]; if (x && typeof x.bruto === 'number') { s += x.bruto; k0++; if (typeof x.vendas === 'number') p += x.vendas; else pedOk = false; } } return { valor: SHC.r2(s), dias: k0, pedidos: pedOk && k0 ? p : null }; };
        const at = soma(de, ate), an = soma(diaMenosX(de, 7), diaMenosX(ate, 7));
        // Última leitura das vendas antes da meia-noite de hoje = o último dia (ontem) está pela metade: diz até que hora leu e não compara
        // com um dia inteiro (seria uma queda falsa). Sem vb.ts (leitura antiga) não dá para saber: segue como está.
        const lidoTs = numF(d.vb && d.vb.ts), parcial = at.dias > 0 && lidoTs !== null && lidoTs < Date.parse(h + 'T00:00:00');
        const lidoAte = parcial ? (() => { const t = new Date(lidoTs), z = x => String(x).padStart(2, '0'), dl = t.getFullYear() + '-' + z(t.getMonth() + 1) + '-' + z(t.getDate());
            return (dl === ate ? '' : dBR(dl) + ' ') + t.getHours() + 'h'; })() : null;
        // 💰 Faturamento
        const vendas = { valor: at.dias ? at.valor : null, anterior: an.dias === n ? an.valor : null, variacaoPct: null, pedidos: at.pedidos, ticket: at.pedidos > 0 ? SHC.r2(at.valor / at.pedidos) : null, lidoAte };
        const fat = [];
        if (!at.dias) fat.push('▸ ainda não lido (abra o Copiloto e sincronize)');
        else {
            const contra = dia ? 'contra ' + diaSemTxt(diaMenosX(de, 7)) : 'contra a semana anterior';
            if (parcial) fat.push('▸ ' + moedaCurta(at.valor) + ' (lido até ' + lidoAte + ') · sem comparar: ' + (dia ? 'o dia' : 'o último dia') + ' ainda não tinha acabado na última leitura');
            else if (at.dias === n && an.dias === n && an.valor > 0) { vendas.variacaoPct = r1f((at.valor - an.valor) / an.valor * 100); fat.push('▸ ' + moedaCurta(at.valor) + ' · ' + pctR(vendas.variacaoPct) + ' ' + contra + ' (' + moedaCurta(an.valor) + ')'); }
            else fat.push('▸ ' + moedaCurta(at.valor) + (at.dias < n ? ' (só ' + at.dias + ' de 7 dias lidos)' : '') + (an.dias < n ? ' · sem ' + (dia ? 'o mesmo dia da semana passada' : 'a semana anterior inteira') + ' para comparar' : ''));
            if (at.pedidos > 0) fat.push('▸ ' + SHC.qtd(at.pedidos, 'venda', 'vendas') + ' · ticket médio ' + SHC.moeda(vendas.ticket));
        }
        sec('fat', '💰 *Faturamento*', fat);
        // 🧮 Lucro (d.mes = o mês de "ate": no dia 1º é o mês que acabou, dito pelo nome)
        const noMes = d.mes && d.mes !== h.slice(0, 7) ? 'em ' + nomeMesFam(d.mes) : 'no mês';
        const lu = d.lucro;
        if (lu && numF(lu.valor) !== null) sec('lucro', '🧮 *Lucro estimado ' + noMes + '*', ['▸ ' + moedaCurta(lu.valor) + (lu.parcial && numF(lu.cobertoPct) !== null ? ' · só ' + Math.round(lu.cobertoPct) + '% das vendas têm custo informado' : lu.parcial ? ' · só dos produtos com custo informado' : '')]);
        // 🔴 Vendas no prejuízo (prejuizo:<conta>, SHC.vendasPrejuizo): só as vendas do período (dia da venda entre "de" e "ate"), com custo informado.
        // Dia d do período está INTEIRO só se todas as vendas dele foram conferidas (pj.completos, de SHC.vendasPrejuizo: houve leitura depois do
        // fim do dia e a 1ª página alcançou a leitura anterior). Leitura antiga sem "completos": só com leitura em d+1. Leitura no próprio d
        // (ex.: só de manhã) = lido em parte: "⚠️ lido até 8h". Nenhum dia tocado por leitura, ou módulo Conciliação desligado → a seção não
        // aparece. ✅ só com todos os dias inteiros, ao menos 1 venda conferida e nenhuma sem custo (pj.conf); senão ⚠️ dizendo o que faltou.
        const pj = SHC.moduloLigado(cfg, 'conciliacao') ? d.prejuizo : null, pjTs = numF(pj && pj.ts);
        const pjL = pj ? (pj.lidos || [pj.dia || (pjTs !== null ? diaLocal(pjTs) : '')]) : [], dPer = [];
        for (let k = de; k <= ate; k = diaMenosX(k, -1)) dPer.push(k);
        const pjC = pj && Array.isArray(pj.completos) ? pj.completos : null, pjCortes = (pj && pj.cortes) || [];
        const inteiro = k => (pjC ? pjC.indexOf(k) >= 0 : pjL.indexOf(diaMenosX(k, -1)) >= 0);
        const pjOk = dPer.filter(k => inteiro(k) || pjL.indexOf(k) >= 0 || pjCortes.indexOf(k) >= 0);   // dias com alguma leitura
        if (pj && pjTs !== null && pjOk.length) {
            const pjParc = pjTs < Date.parse(h + 'T00:00:00') ? (() => { const t = new Date(pjTs), z = x => String(x).padStart(2, '0'), dl = t.getFullYear() + '-' + z(t.getMonth() + 1) + '-' + z(t.getDate());
                return (dl === ate ? '' : dBR(dl) + ' ') + t.getHours() + 'h'; })() : null;
            const faltam = dPer.filter(k => pjOk.indexOf(k) < 0), ult = pjOk[pjOk.length - 1], pjDiaUlt = diaLocal(pjTs);
            const emParte = dPer.filter(k => pjOk.indexOf(k) >= 0 && !inteiro(k) && !(pjParc && k === pjDiaUlt));   // o dia da última leitura já sai no "até HHh"
            const tudo = !faltam.length && dPer.every(inteiro);
            const pjSo = !faltam.length ? '' : dPer.indexOf(ult) - dPer.indexOf(pjOk[0]) + 1 === pjOk.length
                ? 'lido só ' + (pjOk.length === 1 ? 'em ' + dBR(ult) : 'de ' + dBR(pjOk[0]) + ' a ' + dBR(ult)) : 'sem leitura em ' + faltam.map(dBR).join(', ');
            const ress = [pjSo ? pjSo + (pjParc ? ', até ' + pjParc : '') : (pjParc ? 'lido até ' + pjParc : ''),
                emParte.length ? emParte.map(dBR).join(', ') + ' ' + (emParte.length === 1 ? 'lido' : 'lidos') + ' só em parte' : ''].filter(Boolean).join('; ');
            // Contagem por dia (pj.conf: c = conferidas com custo, s = sem custo; pj.fora = anúncio que o Copiloto ainda não leu). Sem conf = leitura antiga.
            const temConf = !!(pj.conf && typeof pj.conf === 'object');
            let nC = 0, nS = 0, nF = 0;
            if (temConf) dPer.forEach(k => { const x = pj.conf[k] || {}; nC += +x.c || 0; nS += +x.s || 0; });
            Object.keys(pj.fora || {}).forEach(p => { const k = pj.fora[p]; if (k >= de && k <= ate) nF++; });
            const naoTxt = [nS ? SHC.qtd(nS, 'venda sem custo informado', 'vendas sem custo informado') : '',
                nF ? SHC.qtd(nF, 'venda de anúncio que o Copiloto ainda não leu', 'vendas de anúncios que o Copiloto ainda não leu') : ''].filter(Boolean).join(' e ');
            const naoLinha = naoTxt ? ['▸ ⚠️ ' + naoTxt + ': não deu para conferir'] : [];
            const confTxt = temConf ? SHC.qtd(nC, 'venda conferida', 'vendas conferidas') : 'entre as vendas com custo informado';
            const visto = {}, its = (pj.itens || []).filter(x => x && numF(x.sobra) < 0 && x.dia >= de && x.dia <= ate && !(x.pedido && visto[x.pedido]) && (visto[x.pedido] = true))
                .sort((a, b) => a.sobra - b.sobra);
            if (!its.length) {
                const verde = tudo && !naoTxt && (!temConf || nC > 0), obs = [ress, temConf && !nC ? '' : confTxt].filter(Boolean);
                S.push({ id: 'prejuizo', linhas: [verde ? '✅ *Nenhuma venda no prejuízo* (' + confTxt + ')'
                    : '⚠️ *Vendas no prejuízo*: ' + (temConf && !nC ? 'nenhuma venda conferida' : tudo ? 'nenhuma' : 'nenhuma nos dias lidos')
                        + (obs.length ? ' (' + obs.join('; ') + ')' : '')].concat(naoLinha) });
            } else {
                const itemDe = id => (d.itens || []).find(i => i && i.itemId === id) || {}, skuDe = x => x.sku || itemDe(x.itemId).sku || '';
                const perdido = SHC.r2(-its.reduce((s, x) => s + x.sobra, 0)), porMot = {};
                its.forEach(x => { const m = SHC.prejuizoMotivoId(x.motivo).id; porMot[m] = (porMot[m] || 0) - x.sobra; });
                // "quem" só das vendas do motivo escolhido; sem SKU, o título sem o " e mais N" (venda com vários produtos)
                const mot = Object.keys(porMot).sort((a, b) => porMot[b] - porMot[a])[0];
                const quem = [...new Set(its.filter(x => SHC.prejuizoMotivoId(x.motivo).id === mot).map(x => skuDe(x) || String(x.titulo || '').replace(/ e mais \d+$/, '')))];
                const linha = x => { const m = SHC.prejuizoMotivoId(x.motivo);
                    return '▸ ' + skuNome({ sku: skuDe(x), titulo: x.titulo, itemId: x.itemId }) + ': ' + (numF(x.total) > 0 ? 'venda ' + SHC.moeda(x.total) + ' · ' : '') + '−' + SHC.moeda(-x.sobra)
                        + (x.estimado ? ' (frete estimado)' : '') + (x.motivo ? ' · ' + m.emo + ' ' + x.motivo : '') + (dia ? '' : ' em ' + dBR(x.dia)); };
                const monta = n => ['🔴 *Vendas no prejuízo*', '▸ ' + SHC.qtd(its.length, 'venda', 'vendas') + ' · −' + SHC.moeda(perdido) + ' no total' + (ress ? ' (' + ress + ')' : '')]
                    .concat(naoLinha).concat(its.slice(0, n).map(linha)).concat(its.length > n ? ['▸ ' + (n ? 'e mais ' + (its.length - n) + ' no Copiloto' : 'a lista está no Copiloto')] : [])
                    .concat(['▸ 👉 ' + FAZ_PREJ[mot](quem.length === 1 ? ' do ' + quem[0] : ' desses produtos')]);
                const n0 = Math.min(PREJ_LISTA, its.length);
                S.push({ id: 'prejuizo', linhas: monta(n0), lista: n0, versao: monta });
            }
        }
        // 📈 Crescendo / 📉 Caindo (no mês, SHC.familias; o motivo da queda vem do gargalo)
        const sk = d.skus || {};
        sec('crescendo', '📈 *Crescendo ' + noMes + '*',(sk.subindo || []).slice(0, 3).map(s => { const m = motivoSobe(s); return '▸ ' + skuNome(s) + ': ' + varSku(s) + (m ? ' · ' + m : ''); }));
        sec('caindo', '📉 *Caindo ' + noMes + '*',(sk.caindo || []).slice(0, 3).map(s => { const c = causaPrincipal(s.gargalo); return '▸ ' + skuNome(s) + ': ' + varSku(s) + ' · ' + (c ? EMO_CAUSA[c.id] + ' ' + c.curto : 'sem causa clara nos dados'); }));
        // 👀 Visitas (radar: 7 dias × 7 anteriores, anúncios ativos)
        const itens = (d.itens || []).filter(i => i && i.itemId), porId = {}; itens.forEach(i => { porId[i.itemId] = i; });
        const pv = (d.visitas && d.visitas.porItem) || {};
        const quedas = itens.filter(SHC.anuncioAtivo).map(i => Object.assign({ i }, SHC.radarVisitas((pv[i.itemId] || {}).dias, h, cfg.radar_queda_pct))).filter(r => r.classe === 'caindo').sort((a, b) => a.variacaoPct - b.variacaoPct);
        sec('visitas', '👀 *Visitas em queda* (7 dias × 7 anteriores)', quedas.slice(0, 3).map(r => '▸ ' + skuNome(r.i) + ': ' + r.ant7.toLocaleString('pt-BR') + ' → ' + r.ult7.toLocaleString('pt-BR') + ' (' + pctR(r.variacaoPct) + ')')
            .concat(quedas.length > 3 ? ['▸ e mais ' + (quedas.length - 3) + ' no Copiloto'] : []));
        // 💲 Preço (comp:<conta>: 1 registro por mudança; só mudanças de 3% ou mais no período)
        const precos = [];
        Object.keys(d.comp || {}).forEach(id => {
            const hs = (d.comp[id] || []).filter(x => x && x.d);
            for (let k = 1; k < hs.length; k++) { const a = numF(hs[k - 1].p), b = numF(hs[k].p); if (hs[k].d >= de && hs[k].d <= ate && a > 0 && b !== null && Math.abs(b - a) / a >= 0.03) precos.push({ i: porId[id] || { itemId: id }, a, b, d: hs[k].d, pct: r1f((b - a) / a * 100) }); }
        });
        precos.sort((x, y) => Math.abs(y.pct) - Math.abs(x.pct));
        sec('preco', '💲 *Preço mudou*', precos.slice(0, 3).map(x => '▸ ' + skuNome(x.i) + ': ' + SHC.moeda(x.a) + ' → ' + SHC.moeda(x.b) + ' (' + pctR(x.pct) + ')' + (dia ? '' : ' em ' + dBR(x.d))));
        // 🏷️ Promoções (v3.2.0): quem saiu da promoção no período (promoSaiu:<conta>) e a promoção que acaba em até N dias (SHC.promoTermina). Curta: até 3 + 3.
        if (SHC.moduloLigado(cfg, 'promo')) {
            const saiu = ((d.promoSaiu && d.promoSaiu.eventos) || []).filter(e => e && e.quando >= de && e.quando <= ate), fim = (d.promoTermina && d.promoTermina.itens) || [];
            sec('promo', '🏷️ *Promoções*', saiu.slice(-3).reverse().map(e => '▸ ' + skuNome(e) + ': saiu da promoção, ' + SHC.moeda(e.precoPromo) + ' → ' + SHC.moeda(e.precoAgora) + (dia ? '' : ' em ' + dBR(e.quando)))
                .concat(saiu.length > 3 ? ['▸ e mais ' + (saiu.length - 3) + ' no Copiloto'] : [])
                .concat(fim.slice(0, 3).map(x => '▸ ' + skuNome(x) + ': a promoção termina ' + SHC.promoDiasTxt(x.dias) + ' (' + dBR(x.fim) + ')')));
        }
        // 📅 Sazonalidade (SHC.sazonalCompra)
        const saz = (d.sazonal || []).filter(z => z && z.aplica);
        sec('sazonal', '📅 *Sazonalidade*', saz.slice(0, 2).map(z => '▸ ' + capF(nomeMesFam(z.mes)) + ' é forte para ' + z.familia + ' (' + pctR(z.acimaPct) + ' acima da média no ano passado): compre e envie ao Full ' + (z.ate ? 'até ' + dBR(z.ate) : 'o quanto antes')));
        // 📦 Full
        const anT = d.anomalias && (!conta || String(d.anomalias.conta || conta) === String(conta)) ? d.anomalias.porTipo || {} : {}, af = d.acoesFam || {}, rm = d.remessas || {}, full = [];
        if (anT.estoque > 0) full.push('▸ ' + SHC.qtd(anT.estoque, 'produto sem estoque', 'produtos sem estoque'));
        if ((af.full || []).length) full.push('▸ Enviar ao Full: ' + af.full.slice(0, 3).map(skuNome).join(', ') + (af.full.length > 3 ? ' (+' + (af.full.length - 3) + ')' : ''));
        if (anT.full > 0) full.push('▸ ' + SHC.qtd(anT.full, 'aviso do Full', 'avisos do Full'));
        // Janelas longas dizem o período (quem lê o "do dia" no grupo não pode achar que é problema de ontem): multas = remessas dos últimos 90 dias.
        (rm.comMulta || []).slice(0, 3).forEach(r => full.push('▸ Remessa ' + r.id + (r.recebida ? ' (recebida em ' + dBR(r.recebida) + ')' : ' (últimos 90 dias)') + ': ' + r.texto.replace(/ — o valor aparece.*$/, '')));
        const incPend = (rm.inconformes || []).filter(SHC.remessaPendente);
        if (incPend.length) full.push('▸ ' + SHC.qtd(incPend.length, 'remessa com diferença para reclamar', 'remessas com diferença para reclamar') + ' (últimos 90 dias)');
        if ((af.liquidar || []).length) full.push('▸ Estoque parado: ' + SHC.qtd(af.liquidar.length, 'anúncio sem venda há 3 meses', 'anúncios sem venda há 3 meses'));
        sec('full', '📦 *Full*', full);
        // 🔄 Pós-venda
        const po = d.posvenda || {}, pa = SHC.perguntasAlerta(d.perguntas), tm = ((d.perguntas && d.perguntas.tempoMedio) || {}).comercial, pos = [];
        if (po.reclamacoes > 0) pos.push('▸ ' + SHC.qtd(po.reclamacoes, 'reclamação ou mediação aberta', 'reclamações ou mediações abertas'));
        if (po.devolucoes > 0) pos.push('▸ ' + SHC.qtd(po.devolucoes, 'devolução pendente', 'devoluções pendentes'));
        if (po.mensagens > 0) pos.push('▸ ' + SHC.qtd(po.mensagens, 'mensagem no pós-venda', 'mensagens no pós-venda'));
        if (pa) pos.push('▸ ' + SHC.qtd(pa.pendentes, 'pergunta sem resposta', 'perguntas sem resposta') + (typeof tm === 'number' ? ' · tempo médio ' + minutosTxt(tm) : ''));
        sec('posvenda', '🔄 *Pós-venda*', pos);
        // ⭐ Reputação
        const rep = SHC.reputacaoAlertas(d.reputacao);
        sec('reputacao', '⭐ *Reputação*', rep.map(a => '▸ ' + a.texto));
        // 🧾 Cobranças (e certificado)
        // Frete = conciliação dos últimos 30 dias (o total vem de totalAMais: a lista pagoAMais é cortada em 200); conferir = mês atual e anterior (cf.meses).
        const cf = d.conferir || {}, cobr = [], conc = (d.frete || {}).conciliacao || {}, pagos = (conc.pagoAMais || []).filter(p => p && !p.talvezUnidades);
        const fretePago = numF(conc.totalAMais) !== null ? SHC.r2(conc.totalAMais) : SHC.r2(pagos.reduce((s, p) => s + (p.diferenca || 0), 0));
        const nConf = cf.qtd > 0 ? cf.qtd : anT.pagamento > 0 ? anT.pagamento : 0, mesesConf = (cf.qtd > 0 && Array.isArray(cf.meses) ? cf.meses.slice().sort() : []).map(m => nomeMesFam(m).slice(0, 3));
        if (nConf) cobr.push('▸ ' + SHC.qtd(nConf, 'cobrança a conferir', 'cobranças a conferir') + (cf.valor > 0 || mesesConf.length ? ' (' + [cf.valor > 0 ? SHC.moeda(cf.valor) : '', mesesConf.join(' e ')].filter(Boolean).join(', ') + ')' : ''));
        // 3.3.0, trava do frete (06/10): "para conferir" e "de diferença", nunca "cobrado a mais" nem "contestar" (sem chamado até a 3.3.1).
        if (pagos.length) cobr.push('▸ Frete para conferir em ' + SHC.qtd(pagos.length, 'pedido', 'pedidos') + ' (' + SHC.moeda(fretePago) + ' de diferença, últimos 30 dias)');
        const novos = d.fatura ? SHC.custosNovos(d.fatura).itens : [];
        novos.slice(0, 2).forEach(x => cobr.push('▸ ' + (x.novo ? 'Custo novo' : 'Custo que subiu') + ' na fatura: ' + SHC.custoNovoTxt(x)));
        const ce = SHC.certAgora(d.cert, Date.parse(h + 'T12:00:00'));
        const certRuim = ce && (ce.expirou || (typeof ce.dias === 'number' && ce.dias <= 30));
        if (certRuim) cobr.push('▸ Certificado digital ' + (ce.expirou ? 'vencido' : 'vence em ' + SHC.qtd(ce.dias, 'dia', 'dias')));
        sec('cobrancas', '🧾 *Cobranças*', cobr);
        // ✅ O que fazer hoje: urgentes sem R$ (certificado, reclamação), depois pelo R$ em jogo.
        const A = [], acao = (txt, rs, urg) => A.push({ txt, rs: rs || 0, urg: urg || 0 });
        if (certRuim && (ce.expirou || ce.dias <= 7)) acao('Renovar o certificado digital e cadastrar no Faturador', 0, 3);
        if (po.reclamacoes > 0) acao('Responder ' + SHC.qtd(po.reclamacoes, 'reclamação/mediação', 'reclamações/mediações') + ' (pesa na reputação)', 0, 2);
        const FAZ = { estoque: s => 'Repor o estoque do ' + s, preco: s => 'Rever o preço do ' + s, visitas: s => 'Revisar fotos e título do ' + s, buybox: s => 'Recuperar o catálogo do ' + s,
            anuncio: s => 'Reativar o anúncio do ' + s, ads: s => 'Rever o Ads do ' + s, frete: s => 'Conferir o frete do ' + s };
        (sk.caindo || []).forEach(s => { const c = causaPrincipal(s.gargalo); if (!c || !FAZ[c.id]) return; const perda = Math.abs(numF(s['variacaoR$']) || 0);
            acao(FAZ[c.id](s.sku || nomeCurto(s.titulo)) + ' (' + c.curto + (perda ? ' · −' + moedaCurta(perda) + ' no mês' : '') + ')', perda, 0); });
        if (cf.valor > 0) acao('Conferir as cobranças no Fechamento (' + SHC.moeda(cf.valor) + ')', cf.valor, 0);
        if (fretePago > 0) acao('Conferir o frete no detalhe da venda (' + SHC.moeda(fretePago) + ' de diferença)', fretePago, 0);
        (rm.comMulta || []).forEach(r => acao('Ver a multa da remessa ' + r.id + (r.valor > 0 ? ' (' + SHC.moeda(r.valor) + ')' : ''), r.valor || 0, 0));
        // r.custo é a coleta da remessa, não o valor da diferença: sem R$ no texto nem na ordem (o valor da diferença o Copiloto não sabe).
        incPend.slice(0, 1).forEach(r => acao('Reclamar a diferença da remessa ' + r.id, 0, 0));
        if (anT.estoque > 0) acao('Enviar estoque ao Full (' + SHC.qtd(anT.estoque, 'produto zerado', 'produtos zerados') + ')', 0, 0);
        saz.filter(z => z.ate).slice(0, 1).forEach(z => acao('Comprar ' + z.familia + ' até ' + dBR(z.ate) + ' (' + nomeMesFam(z.mes) + ' forte)', 0, 0));
        if (pa) acao('Responder ' + SHC.qtd(pa.pendentes, 'pergunta', 'perguntas'), 0, 0);
        A.sort((a, b) => b.urg - a.urg || b.rs - a.rs);
        sec('acoes', '✅ *O que fazer hoje*', A.slice(0, 5).map((a, k) => (k + 1) + '. ' + a.txt));
        // Monta; o link wa.me tem limite: tira as seções menos importantes (o texto completo continua no Copiloto e no Copiar).
        const cab = '📊 *Resumo ' + (dia ? 'do dia' : 'da semana') + '* · ' + nome + '\n📅 ' + (dia ? diaSemTxt(de) : dBR(de) + ' a ' + dBR(ate));
        const junta = (ss, curto) => [cab].concat(ss.map(s => s.linhas.join('\n'))).concat([(curto ? '_(versão curta: o resumo completo está no Copiloto)_\n' : '') + '— Copiloto']).join('\n\n');
        const link = t => 'https://wa.me/?text=' + encodeURIComponent(t), texto = junta(S, false), encurtado = [];
        let ss = S, textoWa = texto;
        const grande = () => link(textoWa).length > SHC.WA_MAX;
        // 🔴 Vendas no prejuízo nunca sai inteira: 1º a lista encurta (5 → 3); só depois das outras seções, fica só o total e a ação.
        const listaPrej = n => { const i = ss.findIndex(s => s.id === 'prejuizo' && s.versao && s.lista > n); if (i < 0) return;
            ss = ss.slice(); ss[i] = Object.assign({}, ss[i], { linhas: ss[i].versao(n), lista: n }); if (encurtado.indexOf('prejuizo_lista') < 0) encurtado.push('prejuizo_lista'); textoWa = junta(ss, true); };
        if (grande()) listaPrej(3);
        for (let k = 0; k < CORTE_WA.length && grande(); k++) {
            if (!ss.some(s => s.id === CORTE_WA[k])) continue;
            ss = ss.filter(s => s.id !== CORTE_WA[k]); encurtado.push(CORTE_WA[k]); textoWa = junta(ss, true);
        }
        if (grande()) listaPrej(0);
        return { texto, textoWa, waLink: link(textoWa).length <= SHC.WA_MAX ? link(textoWa) : null, encurtado, periodo: dia ? 'dia' : 'semana', de, ate, vendas, secoes: S.map(s => s.id) };
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
