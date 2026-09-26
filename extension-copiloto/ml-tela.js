// SellerHub Copiloto v2.1 — etiquetas DENTRO do Mercado Livre (lista de Anúncios e Central de promoções).
// Só LÊ a página do ML e INSERE elementos próprios (prefixo shc). Nunca clica, preenche nem envia nada do ML.
// Números: sempre do próprio ML (preço, tarifa, frete, "você recebe") + custo e imposto do seller (SHC.sobra*).
// O topo do arquivo não toca no DOM: as funções SHC.tela* são puras e rodam em node (tests/copiloto/teste_tela.js).
(function (root) {
    'use strict';
    const SHC = root.SHC || (root.SHC = {});
    const moeda = v => SHC.moeda(v);
    const pct = v => SHC.pctTxt(v);
    const r2 = v => SHC.r2(v);
    const metaDe = cfg => SHC.num(Object.assign({}, SHC.PADRAO, cfg || {}).margem_alvo_pct) || 0;

    // ── Lógica pura (testada em node) ────────────────────────────────────────────────────────

    /** Qual tela do ML é esta: 'anuncios' | 'promos' | null. */
    SHC.telaDe = function (url) {
        let p = '';
        try { p = new URL(url).pathname; } catch (e) { return null; }
        if (/^\/anuncios\/lista\/promos\/?$/.test(p)) return 'promos';
        if (/^\/anuncios(\/lista)?\/?$/.test(p)) return 'anuncios';   // o ML redireciona /anuncios/lista → /anuncios (visto em 24/09/2026)
        return null;
    };

    // ── Certificado digital: o aviso do Faturador ("Seu certificado digital vence em 18 dias") é montado no navegador; só a tela tem. ──
    SHC.telaEhFaturador = function (url) {
        try { return /^\/billing\/invoiceissuer\/fiscal-hub\/?$/.test(new URL(url).pathname); } catch (e) { return false; }
    };
    /** Título e texto de um aviso da tela → {acao:'certificado', titulo (≤ 300), texto (≤ 1000)} | null (não fala do certificado). Nada além do aviso sai da página. */
    SHC.telaMsgCertificado = function (titulo, texto) {
        const limpa = s => String(s || '').replace(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g, '').replace(/\s+/g, ' ').trim();   // um CNPJ no texto não sai da página
        const t = limpa(titulo), x = limpa(texto);
        if (!/certificado digital/i.test(t + ' ' + x)) return null;
        return { acao: 'certificado', titulo: t.slice(0, 300), texto: x.slice(0, 1000) };
    };

    SHC.telaDataCurta = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? d.slice(8, 10) + '/' + d.slice(5, 7) : '';

    /** Etiqueta do anúncio (saída de SHC.sobraAnuncio) → { cls: luc|ate|pre|sem, titulo, sub }. */
    SHC.telaChip = function (s) {
        if (!s || s.sobra === null || s.sobra === undefined) return { cls: 'sem', titulo: '＋ Informar custo', sub: '' };
        const cls = s.classe === 'prejuizo' ? 'pre' : (s.classe === 'apertado' ? 'ate' : 'luc');
        return { cls, titulo: (s.sobra < 0 ? 'Prejuízo ' : 'Lucro ') + moeda(Math.abs(s.sobra)), sub: 'margem ' + pct(s.pct) };
    };

    /** Linha de veredito da conta (tooltip): "Lucro · margem 25,5% · acima da sua meta de 10%". */
    SHC.telaResultado = function (s, cfg) {
        const meta = pct(metaDe(cfg));
        if (s.sobra < 0) return 'Prejuízo · margem ' + pct(s.pct);
        return 'Lucro · margem ' + pct(s.pct) + ' · ' + (s.classe === 'apertado' ? 'abaixo' : 'acima') + ' da sua meta de ' + meta;
    };
    SHC.telaClasseRes = classe => classe === 'prejuizo' ? 'pr' : (classe === 'apertado' ? 'at' : 'ok');

    /** Veredito de uma proposta da Central de promoções → { cls: ok|at|pr|sc|sem, txt, sub }. */
    SHC.telaVeredito = function (classe, s) {
        if (classe === 'sem_calculo') return { cls: 'sc', txt: 'Sem cálculo do ML', sub: 'O ML só mostra a conta depois que você escolhe o desconto' };
        if (classe === 'sem_custo' || !s || s.sobra === null || s.sobra === undefined) return { cls: 'sem', txt: '＋ Informar custo', sub: 'para saber se compensa' };
        const sub = (s.sobra < 0 ? 'Prejuízo ' : 'Lucro ') + moeda(Math.abs(s.sobra)) + ' · ' + pct(s.pct);
        if (classe === 'lucrativo') return { cls: 'ok', txt: '✓ Dá para entrar', sub };
        if (classe === 'apertado') return { cls: 'at', txt: '≈ Abaixo da meta', sub };
        return { cls: 'pr', txt: '✗ Prejuízo: não entre', sub };
    };

    /** Selo da recomendação (SHC.recomendaPromo) → { txt, nota } ou null. */
    SHC.telaMelhor = function (rec) {
        if (!rec || rec.tipo === 'nenhuma') return null;
        if (rec.tipo === 'ideal') return {
            txt: '★ Melhor opção',
            nota: rec.atingem > 1
                ? '★ Melhor opção: entre as ' + rec.atingem + ' propostas que batem a sua meta, é a de menor preço para o comprador.'
                : '★ Melhor opção: é a única proposta deste produto que bate a sua meta.',
        };
        return { txt: '≈ Mais perto da meta', nota: '≈ Nenhuma proposta deste produto bate a sua meta. Esta é a que deixa a maior margem.' };
    };

    const gastosTxt = outros => outros > 0 ? 'custo, outros gastos e imposto' : 'custo + imposto';

    /**
     * Explicação de 1 frase por REGRA (IA camada 1: sem modelo de linguagem). Só usa números que já vieram
     * das funções SHC.* e sempre diz a fonte. tipo: anuncio | atacado | proposta | sem_calculo | frete.
     * → { frase, fonte }
     */
    SHC.telaExplica = function (tipo, d, cfg) {
        const meta = pct(metaDe(cfg));
        const FONTE_ML = 'Fonte: preço, tarifa, frete e "você recebe" são do Mercado Livre; custo e imposto são seus.';
        if (tipo === 'sem_calculo') return {
            frase: 'Nesta promoção o ML só mostra a conta depois que você escolhe o desconto, então o Copiloto não calcula esta proposta.',
            fonte: 'Fonte: Mercado Livre (promoção com redução de tarifas ou aporte do ML).',
        };
        if (tipo === 'frete') {
            const v = d;
            if (!v) return null;
            const fonte = 'Fonte: frete do Mercado Livre nesta tela, registrado pelo Copiloto uma vez por dia desde a instalação.';
            if (v.tipo === 'igual') return { frase: 'O frete deste anúncio está igual (' + moeda(v.agora) + ') desde ' + SHC.telaDataCurta(v.desde) + ', o primeiro dia registrado.', fonte };
            return {
                frase: 'O frete deste anúncio ' + (v.tipo === 'sobe' ? 'subiu ' : 'caiu ') + moeda(Math.abs(v.dif)) + ' por venda em ' + SHC.telaDataCurta(v.desde)
                    + ': era ' + moeda(v.antes) + ' e agora é ' + moeda(v.agora) + '.',
                fonte,
            };
        }
        const s = d.s;
        if (!s || s.sobra === null || s.sobra === undefined) return { frase: 'Falta o custo deste produto. Com ele, o Copiloto mostra quanto sobra de cada venda.', fonte: FONTE_ML };
        if (tipo === 'atacado') {
            const g = d.degrau;
            return {
                frase: 'No degrau de ' + g.qtd + ' un. a ' + moeda(g.preco) + ', a estimativa é de ' + (s.sobra < 0 ? 'prejuízo' : 'lucro') + ' de '
                    + moeda(Math.abs(s.sobra)) + ' por unidade (' + pct(s.pct) + '); num pedido de ' + g.qtd + ' un., ' + moeda(Math.abs(s.pedido)) + '.',
                fonte: 'Fonte: preço do atacado é do ML; tarifa (mesma % do anúncio) e frete (um envio por peça) são estimativa do Copiloto; custo e imposto são seus.',
            };
        }
        const recebe = tipo === 'anuncio' ? d.item.recebe : d.p.recebe;
        const soma = r2(recebe - s.sobra);                       // = custo + outros + imposto (os mesmos da conta)
        const outros = SHC.num(s.outros) || 0;
        const quem = tipo === 'anuncio' ? 'Este anúncio' : 'Nesta promoção você';
        if (s.sobra < 0) return {
            frase: (tipo === 'anuncio' ? 'Este anúncio perde ' : 'Nesta promoção você perderia ') + moeda(-s.sobra) + ' por venda: o ML repassa '
                + moeda(recebe) + ' e ' + gastosTxt(outros) + ' somam ' + moeda(soma) + '.',
            fonte: FONTE_ML,
        };
        const posicao = s.classe === 'apertado' ? 'abaixo da sua meta de ' + meta : 'o que bate a sua meta de ' + meta;
        return {
            frase: (tipo === 'anuncio' ? 'Este anúncio deixa ' : quem + ' fica com ') + moeda(s.sobra) + ' por venda (' + pct(s.pct) + '), ' + posicao
                + ': o ML repassa ' + moeda(recebe) + ' e ' + gastosTxt(outros) + ' somam ' + moeda(soma) + '.',
            fonte: FONTE_ML,
        };
    };

    /**
     * Variação do frete a partir do histórico fh|ml|MLB ({'AAAA-MM-DD': valor}) + o frete de hoje na tela.
     * → null (menos de 2 dias registrados) | { tipo: sobe|desce|igual, antes, agora, dif, pctDif, desde, dias, pontos:[{d,v}] }
     */
    SHC.telaVariacaoFrete = function (hist, agora, hoje) {
        const h = Object.assign({}, hist || {});
        if (typeof agora === 'number' && isFinite(agora) && hoje) h[hoje] = agora;
        const dias = Object.keys(h).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && typeof h[d] === 'number' && isFinite(h[d])).sort();
        if (dias.length < 2) return null;
        const pontos = [];
        dias.forEach(d => { if (!pontos.length || Math.abs(pontos[pontos.length - 1].v - h[d]) >= 0.005) pontos.push({ d, v: h[d] }); });
        const ult = pontos[pontos.length - 1];
        if (pontos.length === 1) return { tipo: 'igual', antes: ult.v, agora: ult.v, dif: 0, pctDif: 0, desde: dias[0], dias: dias.length, pontos };
        const antes = pontos[pontos.length - 2].v, dif = r2(ult.v - antes);
        return { tipo: dif > 0 ? 'sobe' : 'desce', antes, agora: ult.v, dif, pctDif: antes > 0 ? dif / antes * 100 : 0, desde: ult.d, dias: dias.length, pontos };
    };

    /** Texto do selo do frete: "▲ +R$ 0,90 · 08/09", "▼ −R$ 0,50 · 08/09", "= sem variação". */
    SHC.telaSeloFrete = function (v) {
        if (!v) return null;
        if (v.tipo === 'igual') return { cls: 'igual', txt: '= sem variação' };
        return { cls: v.tipo, txt: (v.tipo === 'sobe' ? '▲ +' : '▼ −') + moeda(Math.abs(v.dif)) + ' · ' + SHC.telaDataCurta(v.desde) };
    };

    /**
     * Etiquetas de saúde do anúncio → [{cls: fo|fi|cai|est|sobe, txt, extra?, titulo, tip, link?}]. Só o que já foi lido (nunca "0 fotos").
     * d = { fiscal: fiscal:<conta>, fotos: fotos:<conta>, visitas: visitas:<conta>, cfg, hoje,
     *       medidas: medidas:<conta>, medDiv: SHC.medidasDivergentes(...) (SKUs com medidas diferentes), agora? (ms) }
     */
    SHC.telaSaude = function (itemId, d) {
        const x = d || {}, out = [], f = x.fotos && x.fotos.porItem && x.fotos.porItem[itemId];
        if (f && f.qtd > 0) out.push({ cls: 'fo', txt: f.max ? f.qtd + ' de ' + f.max + ' fotos' : SHC.qtd(f.qtd, 'foto', 'fotos'), extra: f.problemas > 0 ? f.problemas + ' com problema' : '',
            titulo: 'Fotos do anúncio', tip: 'A 1ª foto é a capa.' + (f.max ? ' O Mercado Livre aceita até ' + f.max + ' fotos.' : '')
                + (f.problemas > 0 ? ' O Mercado Livre marcou ' + SHC.qtd(f.problemas, 'foto', 'fotos') + ' deste anúncio: abra “Alterar anúncio” para ver.' : '') });
        if (x.fiscal && Array.isArray(x.fiscal.itens) && x.fiscal.itens.indexOf(itemId) >= 0) out.push({ cls: 'fi', txt: 'Sem dados fiscais', titulo: 'Sem dados fiscais',
            tip: 'Sem dados fiscais o ML não emite a NF-e desta venda. Corrija no Editor em massa.', link: SHC.FISCAL_EDITOR });
        const v = x.visitas && x.visitas.porItem && x.visitas.porItem[itemId], r = v ? SHC.radarVisitas(v.dias, x.hoje, x.cfg && x.cfg.radar_queda_pct) : null;
        if (r && r.classe !== 'poucos' && r.variacaoPct !== null) {
            const p = (r.variacaoPct > 0 ? '+' : r.variacaoPct < 0 ? '−' : '') + Math.round(Math.abs(r.variacaoPct)) + '%';
            out.push({ cls: r.classe === 'caindo' ? 'cai' : r.classe === 'subindo' ? 'sobe' : 'est', txt: 'Visitas ' + p + ' em 7 dias', titulo: 'Visitas do anúncio',
                tip: 'Últimos 7 dias: ' + SHC.qtd(r.ult7, 'visita', 'visitas') + '. Nos 7 dias antes: ' + SHC.qtd(r.ant7, 'visita', 'visitas') + '.'
                    + (r.classe === 'caindo' ? ' No painel do Copiloto, aba Saúde, veja o que fazer.' : '') });
        }
        // Medidas da embalagem: diferente de outro anúncio do mesmo SKU (balão com as duas medidas) e mudança feita pelo ML nos últimos 30 dias.
        // Vermelho só para o anúncio que foge da medida de referência (e só quando a diferença pesa no frete); o da referência ganha a amarela.
        const g = (x.medDiv || []).find(d => d.anuncios.some(a => a.itemId === itemId));
        if (g) {
            const eu = g.anuncios.find(a => a.itemId === itemId), outro = eu.foge ? g.referencia : g.anuncios.find(a => a.foge), pesa = g.maiorDiferencaKg >= 0.01;
            out.push({ cls: eu.foge && pesa ? 'md' : 'mdr', txt: eu.foge ? 'Medidas diferentes de outro anúncio do mesmo SKU' : 'Outro anúncio do SKU tem medida diferente', titulo: 'Medidas da embalagem',
                tip: 'Este anúncio: ' + SHC.medidaTxt(eu) + '. Outro anúncio do SKU ' + g.sku + ' (' + outro.itemId + '): ' + SHC.medidaTxt(outro) + '. '
                    + (pesa ? 'Anúncios do mesmo produto com medidas diferentes podem pagar fretes diferentes; corrija para a medida certa.' : 'Mesmo peso considerado; só as medidas da caixa diferem.') });
        }
        const mu = x.medidas && x.medidas.porItem && x.medidas.porItem[itemId] ? SHC.medidasMudadas(x.medidas.porItem, (x.agora || Date.now()) - 30 * 864e5, { itemId })[0] : null;
        if (mu) {
            const ml = mu.quem === 'ml', quando = SHC.medidasQuando(mu);
            out.push({ cls: 'mm', txt: (ml ? 'O ML alterou as medidas ' : 'A medida mudou ') + quando, titulo: ml ? 'O ML alterou as medidas' : 'A medida da embalagem mudou',
                tip: 'Antes: ' + SHC.medidaTxt(mu.antes) + '. Agora: ' + SHC.medidaTxt(mu.depois) + '. ' + (ml ? 'O' : 'Se não foi você, o') + ' texto do chamado está no painel do Copiloto, aba Saúde.' });
        }
        return out;
    };

    /** Linhas do ML na conta de 1 venda (V9: frete do comprador + custo operacional). Preço − linhas negativas = você recebe. */
    SHC.telaAnuncioLinhas = function (it) {
        const taxa = it.tarifa !== null && it.preco ? ' (' + pct(it.tarifa / it.preco * 100) + (it.tipo ? ' · ' + it.tipo : '') + ')' : '';
        const op = SHC.num(it.taxaOperacional);
        const l = [{ cls: 'ml', rot: it.emPromocao ? 'Preço em promoção (cheio ' + moeda(it.precoCheio) + ')' : 'Preço', v: it.preco }];
        if (it.tarifa !== null) l.push({ cls: 'ml', rot: 'Tarifa de venda do ML' + taxa, v: it.tarifa, neg: 1 });
        l.push(it.freteComprador ? { cls: 'ml', rot: 'Frete: por conta do comprador', v: 0, neg: 1 }
            : { cls: 'ml', rot: 'Frete por sua conta' + (it.freteDeduzido ? '*' : ''), v: it.frete || 0, neg: 1 });
        if (op > 0) l.push({ cls: 'ml', rot: 'Custo operacional do ML (vale mesmo com frete do comprador)', v: op, neg: 1 });
        l.push({ cls: 'ml tot', rot: '= Você recebe (ML)', v: it.recebe });
        return l;
    };

    /** Colunas do atacado no tooltip: por unidade e pedido de N un. (sa = SHC.sobraAtacado). */
    SHC.telaAtacadoLinhas = function (degrau, sa) {
        const q = degrau.qtd, x = v => r2(v * q);
        const op = SHC.num(sa.taxaOp) || 0, recebe = r2(degrau.preco - sa.tarifa - sa.frete - op);
        const l = [
            { cls: 'ml', rot: 'Preço', un: degrau.preco, ped: x(degrau.preco) },
            { cls: 'ml', rot: 'Tarifa de venda do ML (' + pct(sa.taxaPct) + ')*', un: sa.tarifa, ped: x(sa.tarifa), neg: 1 },
        ];
        if (sa.freteComprador) l.push({ cls: 'ml', rot: 'Frete: o comprador paga', un: 0, ped: 0, neg: 1 });
        else l.push({ cls: 'ml', rot: 'Frete por sua conta**', un: sa.frete, ped: x(sa.frete), neg: 1 });
        if (op > 0) l.push({ cls: 'ml', rot: 'Custo operacional do ML', un: op, ped: x(op), neg: 1 });   // V9: "Envio por conta do comprador"
        l.push(
            { cls: 'ml tot', rot: '= Você recebe do ML', un: recebe, ped: x(recebe) },
            { cls: 'seu', rot: 'Custo do produto', un: sa.custo, ped: x(sa.custo), neg: 1 });
        if (sa.outros > 0) l.push({ cls: 'seu', rot: 'Outros custos', un: sa.outros, ped: x(sa.outros), neg: 1 });
        l.push({ cls: 'seu', rot: 'Imposto', un: sa.imposto, ped: x(sa.imposto), neg: 1 });
        l.push({ cls: 'tot', rot: sa.sobra < 0 ? '= Prejuízo' : '= Sobra', un: Math.abs(sa.sobra), ped: Math.abs(sa.pedido) });
        return l;
    };

    // Textos de um bloco do estado (primaryText.content), em ordem.
    function textos(o, lim) {
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
     * → [{ familia: 'F…', nome, datas }]
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
                        if (ehMeli(b) || (algumTC && b.columns.length >= 3 && textos(b.columns[0], 1).length)) caixas.push({ caminho: caminho.concat(String(i)), b });
                    });
                }
            }
            for (const k in o) andar(o[k], caminho.concat(k), prof + 1);
        })(r, [], 0);
        const prefixo = (a, b) => { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n; };
        return caixas.map(c => {
            let fam = null, melhor = -1;
            cards.forEach(f => { const n = prefixo(f.caminho, c.caminho); if (n > melhor) { melhor = n; fam = f; } });
            const t = textos(c.b.columns[0], 6);
            return { familia: fam ? 'F' + String(fam.o.id).replace(/\D/g, '') : null, nome: t[0] || 'Promoção', datas: t.slice(1).find(x => /\d/.test(x)) || '' };
        }).filter(c => c.familia);
    };

    /** Contagem da barra: linhas = [{ classe, familia }] (classe de sobraProposta ou 'sem_calculo'). */
    SHC.telaContagem = function (linhas) {
        const c = { total: 0, produtos: 0, entrar: 0, abaixo: 0, prejuizo: 0, semCalculo: 0, semCusto: 0 };
        const fams = new Set();
        (linhas || []).forEach(l => {
            c.total++;
            if (l.familia) fams.add(l.familia);
            if (l.classe === 'lucrativo') c.entrar++;
            else if (l.classe === 'apertado') c.abaixo++;
            else if (l.classe === 'prejuizo') c.prejuizo++;
            else if (l.classe === 'sem_calculo') c.semCalculo++;
            else c.semCusto++;
        });
        c.produtos = fams.size;
        return c;
    };
    /** Textos da barra a partir da contagem. */
    SHC.telaBarra = function (c) {
        const pl = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);
        const itens = [
            { cls: 'ok', txt: pl(c.entrar, 'dá para entrar', 'dão para entrar') },
            { cls: 'at', txt: c.abaixo + ' abaixo da meta' },
            { cls: 'pr', txt: c.prejuizo + ' prejuízo' },
            { cls: 'sc', txt: c.semCalculo + ' sem cálculo do ML' },
        ];
        if (c.semCusto) itens.push({ cls: 'sem', txt: c.semCusto + ' sem custo' });
        return { titulo: 'Copiloto · ' + pl(c.total, 'proposta', 'propostas') + ' em ' + pl(c.produtos, 'produto', 'produtos'), itens };
    };

    /** Pausa a tela quando o layout do ML mudou: ≥ 5 falhas e nenhum acerto no passe. */
    SHC.telaDevePausar = res => !!res && res.falha >= 5 && res.ok === 0;

    /** Custo digitado na etiqueta → dados para gravar (V12: origem 'manual', que o Tiny nunca troca). */
    SHC.telaCustoDigitado = (custo, titulo) => ({ custo, titulo: String(titulo || '').slice(0, 120), origem: 'manual' });
    /** Mensagem da página para o fundo (V15): leva a conta do estado; sem ela o fundo descarta. */
    SHC.telaMsgPagina = (acao, r, extra) => Object.assign({ acao, conta: SHC.mlContaDoEstado ? SHC.mlContaDoEstado(r) : null }, extra);

    // ── Guia na tela do ML: tour que leva até o alvo + cartão "Próximo passo" (lógica pura) ──
    // Ordem: "Informe o custo" vem antes; "Quanto sobra" e "Passe o mouse" só aparecem quando já existe etiqueta de lucro.
    SHC.TOUR_PASSOS = {
        anuncios: [
            { id: 'custo', sel: '.shc-w .shc-add', t: 'Informe o custo aqui', x: 'Neste botão você digita o custo do produto. Termine o tour e depois clique nele. Vale para todos os anúncios desse SKU.' },
            { id: 'sobra', sel: '.shc-w .shc-r', t: 'Quanto sobra', x: 'Aqui aparece quanto sobra de cada venda, já tirando tarifa, frete, custo e imposto.' },
            { id: 'mouse', sel: '.shc-w .shc-r', t: 'Passe o mouse e veja a conta', x: 'Passe o mouse em cima da etiqueta para ver a conta completa. Amarelo: números do ML. Azul: seus números.' },
            { id: 'frete', sel: '.shc-w .shc-fr', t: 'Selo do frete', x: 'Mostra se o frete deste anúncio mudou. Clique para ver o histórico no painel do Copiloto.' },
        ],
        promos: [
            { id: 'veredito', sel: '.shc-w .shcp.ok, .shc-w .shcp.at, .shc-w .shcp.pr', t: 'Veredito', x: 'Cada proposta ganha um veredito: dá para entrar, abaixo da sua meta ou prejuízo.' },
            { id: 'melhor', sel: '.shc-w .shcp-ideal', t: 'Melhor opção', x: 'A estrela marca a proposta de menor preço que ainda bate a sua meta.' },
            { id: 'filtro', sel: '.shcp-bar .shcp-filtro', t: 'Filtro', x: 'Mostre só os produtos com proposta que dá para entrar. O filtro só esconde; não muda nada no Mercado Livre.' },
        ],
    };
    /** Passos do tour ainda não vistos que têm o que apontar agora. tem(sel) → existe na página. */
    SHC.telaPassosTour = (tela, vistos, tem) => (SHC.TOUR_PASSOS[tela] || []).filter(p => !(vistos && vistos.has(p.id)) && tem(p.sel));
    /** Retângulo fora (mesmo em parte) da área visível? */
    SHC.telaForaDaVista = (r, vw, vh) => r.top < 8 || r.bottom > vh - 8 || r.left < 0 || r.right > vw;
    /** Rola o alvo para o centro só se ele estiver fora da vista. Devolve true se rolou. */
    SHC.telaLevaAoAlvo = function (el, vw, vh) {
        if (!SHC.telaForaDaVista(el.getBoundingClientRect(), vw, vh)) return false;
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        return true;
    };
    /** Balão ao lado do alvo: embaixo se couber, senão em cima; sempre dentro da tela. seta = x da setinha no balão. */
    SHC.telaPosBalao = function (r, w, h, vw, vh) {
        const m = 8, gap = 12, cabeBaixo = vh - r.bottom - gap >= h + m, cabeCima = r.top - gap >= h + m;
        const baixo = cabeBaixo || (!cabeCima && vh - r.bottom >= r.top);
        const y = Math.max(m, Math.min(baixo ? r.bottom + gap : r.top - gap - h, vh - h - m));
        const cx = r.left + r.width / 2, x = Math.max(m, Math.min(cx - w / 2, vw - w - m));
        return { x: Math.round(x), y: Math.round(y), lado: baixo ? 'baixo' : 'cima', seta: Math.round(Math.max(14, Math.min(cx - x, w - 14))) };
    };
    /** Grava feitos.lucro (etapa "Ver o lucro nos seus anúncios") só se ainda não estiver gravado. */
    SHC.telaMarcaLucro = async function () {
        const g = await SHC.lerGuia();
        if (g.feitos && g.feitos.lucro) return false;
        await SHC.salvarGuia({ feitos: { lucro: SHC.hoje() } });
        return true;
    };
    const URL_ML = 'https://vendedores.mercadolivre.com.br';
    /** Cartão "Próximo passo" a partir de SHC.guiaProximo(ctx). null = não mostra (concluído ou "depois" por 24 h). */
    SHC.telaCartaoGuia = function (res, guia, agora, tela) {
        if (!res || res.concluido || !res.proxima) return null;
        if (guia && guia.cartaoAte > agora) return null;
        // A página do ML não sabe se o ícone está fixado: a etapa opcional 'icone' não trava o cartão.
        const etapas = res.etapas || [], p = res.proxima.id !== 'icone' ? res.proxima : etapas.find(e => e.id !== 'icone' && !e.feito && !e.pulado);
        if (!p) return null;
        const n = (etapas.findIndex(e => e.id === p.id) + 1) || (res.feitas || 0) + 1;
        const c = { id: p.id, topo: 'Copiloto · Próximo passo (' + n + ' de ' + (res.total || etapas.length) + ')', titulo: p.titulo, botao: null, dica: '' };
        if (p.id === 'lucro') {
            if (tela === 'anuncios') c.dica = 'Clique em "＋ Informar custo" em um anúncio desta lista.';
            else c.botao = { txt: 'Abrir meus anúncios', url: URL_ML + '/anuncios' };
        } else if (p.id === 'promos') {
            if (tela === 'promos') c.dica = 'Veja o veredito do Copiloto em cada proposta desta página.';
            else c.botao = { txt: 'Abrir a Central de promoções', url: URL_ML + '/anuncios/lista/promos' };
        } else c.dica = 'Abra o painel do Copiloto no ícone da barra do Chrome (ou na peça de quebra-cabeça).';
        return c;
    };
    /** A etapa que o cartão mostrava ficou pronta? → cartão "✓ Pronto" por ~2 s (ou "Tudo pronto!" no fim). */
    SHC.telaCartaoPronto = function (anterior, res) {
        if (!anterior || !res) return null;
        const e = (res.etapas || []).find(x => x.id === anterior.id);
        if (!e || !(e.feito || e.pulado)) return null;
        return { id: 'pronto', topo: 'Copiloto', titulo: '✓ Pronto: ' + anterior.titulo, botao: null, fim: !!res.concluido,
            dica: res.concluido ? 'Tudo pronto! O Copiloto já está trabalhando para você.' : 'Já vem o próximo passo.' };
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = SHC;

    // ── Daqui para baixo: só no navegador (content script) ──────────────────────────────────
    if (typeof window === 'undefined' || typeof document === 'undefined' || !root.chrome || !chrome.runtime || !chrome.storage) return;
    if (window.__SHC_TELA__) return;
    window.__SHC_TELA__ = true;

    const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const norm = t => String(t || '').replace(/\s+/g, ' ').trim();
    const ocioso = f => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => f(), { timeout: 1000 }) : setTimeout(f, 16));
    const vivo = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; } };
    const manda = msg => { try { const p = chrome.runtime.sendMessage(msg); if (p && p.catch) p.catch(() => {}); } catch (e) { /* extensão recarregada */ } };

    const hrefCarga = location.href;
    let hrefAtual = location.href, geracao = 0, parado = false, pausado = false, falhasSeguidas = 0;
    let rodando = false, pendente = false, timer = 0, desde = 0;
    let estado = null;                         // { url, r, itens|promos }
    let cfgC = null, custosC = null, fretesC = null, skuC = null, versao = 0;
    let saudeC = null;                   // {fiscal, fotos, visitas} da conta (etiquetas de saúde); null = reler
    const ultimaBusca = new Map();             // url → ts do último fetch (máx. 1 a cada 30 s)
    const linhas = new Map();                  // anúncios: itemId → { el, sig, els }
    const grupos = new Map();                  // promos: chave da família → { grupo, sig, els, viavel }
    const degraus = new Map(), pedidosAt = new Set(), filaAt = [];
    let filaRodando = false, soViaveis = false, barra = null, tourVisto = {};
    const tips = new WeakMap();                // elemento nosso → () => html do tooltip

    // ── Host com Shadow DOM: tooltip, popover, tour e aviso de pausa ──
    let H = null, SR = null, tipEl = null, tipAlvo = null;
    const CSS_SR = `
      :host{all:initial}
      *{box-sizing:border-box;font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
      .tip{position:fixed;display:none;max-width:470px;background:#0F172A;color:#E2E8F0;border-radius:12px;padding:12px 14px;font-size:12.5px;line-height:1.45;box-shadow:0 14px 40px rgba(0,0,0,.35);pointer-events:none}
      .tip h5{margin:0 0 2px;font-size:13.5px;color:#fff}.tip .sub{color:#94A3B8;font-size:11.5px;margin-bottom:8px}
      .tip table{border-collapse:collapse;width:100%}.tip td,.tip th{padding:2px 0 2px 14px;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
      .tip td:first-child,.tip th:first-child{text-align:left;padding-left:0;white-space:normal}
      .tip th{font-size:11px;color:#94A3B8;font-weight:600;border-bottom:1px solid #334155;padding-bottom:4px}
      .tip tr.ml td{color:#FDE68A}.tip tr.seu td{color:#93C5FD}.tip tr.tot td{border-top:1px solid #334155;font-weight:700;color:#fff;padding-top:4px}.tip tr.sobe td{color:#FCA5A5}
      .tip .res{margin-top:8px;border-radius:8px;padding:6px 8px;font-weight:700}.tip .res.ok{background:#064E3B;color:#6EE7B7}.tip .res.at{background:#78350F;color:#FDE68A}.tip .res.pr{background:#7F1D1D;color:#FCA5A5}.tip .res.sc{background:#1E293B;color:#CBD5E1}
      .tip .exp{margin-top:8px;color:#F1F5F9}.tip .nota{margin-top:6px;font-size:11px;color:#94A3B8}
      .pop{position:fixed;display:none;width:270px;background:#fff;color:#1F2937;border:1px solid #CBD5E1;border-radius:10px;padding:12px;box-shadow:0 12px 32px rgba(15,23,42,.25);font-size:12.5px}
      .pop b{display:block;font-size:13px;margin-bottom:2px}.pop small{display:block;color:#64748B;margin-bottom:8px;line-height:1.35}
      .pop .lin{display:flex;gap:6px;align-items:center}.pop .rs{font-weight:700;color:#334155}
      .pop input{flex:1;min-width:0;border:1px solid #94A3B8;border-radius:6px;padding:6px 8px;font-size:13px}
      .pop input:focus{outline:2px solid #3483FA;border-color:#3483FA}
      .pop .err{color:#B91C1C;font-size:11.5px;min-height:15px;margin-top:4px}
      .pop .acoes{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
      button{cursor:pointer;border-radius:6px;font-size:12.5px;font-weight:700;padding:6px 12px;border:1px solid #0F172A}
      button.pri{background:#0F172A;color:#fff}button.sec{background:#fff;color:#0F172A;border-color:#CBD5E1}button:disabled{opacity:.6;cursor:default}
      .tip,.pop,.pausa{z-index:2}
      .tour{position:fixed;inset:0;display:none;z-index:3}
      .tour .buraco{position:fixed;border-radius:8px;box-shadow:0 0 0 9999px rgba(15,23,42,.55);pointer-events:none;transition:width .15s,height .15s}
      .tour .balao .seta{position:absolute;left:var(--seta,24px);width:12px;height:12px;background:#fff;transform:translateX(-50%) rotate(45deg)}
      .tour .balao.baixo .seta{top:-6px}.tour .balao.cima .seta{bottom:-6px}
      .cartao{position:fixed;left:16px;bottom:16px;z-index:1;display:none;width:260px;background:#fff;color:#1F2937;border:1px solid #CBD5E1;border-left:4px solid #3483FA;border-radius:10px;padding:10px 12px;box-shadow:0 8px 24px rgba(15,23,42,.2);font-size:12.5px;line-height:1.4}
      .cartao .topo{font-size:11px;color:#64748B;font-weight:700}.cartao .tit{display:block;font-size:13.5px;margin:2px 0 4px}
      .cartao .dica{margin:0 0 6px;color:#475569}.cartao .acoes{display:flex;gap:8px;align-items:center}
      .cartao button.lnk{border:0;background:none;color:#64748B;font-weight:600;padding:6px 4px;text-decoration:underline}
      .tour .balao{position:fixed;width:290px;background:#fff;color:#1F2937;border-radius:10px;padding:12px;box-shadow:0 10px 24px rgba(0,0,0,.3);font-size:12.5px;line-height:1.45}
      .tour .balao .n{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#0F172A;color:#FDE047;font-weight:800;margin-right:6px}
      .tour .balao b{font-size:13px}.tour .balao p{margin:6px 0 10px}
      .tour .balao .acoes{display:flex;justify-content:space-between;align-items:center}
      .pausa{position:fixed;right:16px;bottom:16px;display:none;max-width:330px;background:#0F172A;color:#E2E8F0;border-radius:10px;padding:10px 12px;font-size:12.5px;line-height:1.45;box-shadow:0 10px 30px rgba(0,0,0,.35)}
      .pausa button{margin-top:8px;background:#fff;color:#0F172A;border-color:#fff}`;

    function host() {
        if (H && H.isConnected) return SR;
        H = document.createElement('div');
        H.id = 'shc-host';
        H.setAttribute('style', 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647');
        SR = H.attachShadow({ mode: 'closed' });
        SR.innerHTML = '<style>' + CSS_SR + '</style><div class="tip" role="tooltip"></div>'
            + '<div class="pop" role="dialog" aria-label="Informar custo"><b>Custo do produto</b><small class="q"></small>'
            + '<div class="lin"><span class="rs">R$</span><input type="text" inputmode="decimal" placeholder="Ex.: 250,00" aria-label="Custo do produto em reais"></div>'
            + '<div class="err" aria-live="polite"></div><div class="acoes"><button type="button" class="sec" data-a="cancelar">Cancelar</button><button type="button" class="pri" data-a="salvar">Salvar</button></div></div>'
            + '<div class="cartao" role="status"><div class="topo"></div><b class="tit"></b><p class="dica"></p>'
            + '<div class="acoes"><button type="button" class="pri" data-a="ir"></button><button type="button" class="lnk" data-a="depois">depois</button></div></div>'
            + '<div class="tour"><div class="buraco"></div><div class="balao" role="dialog"><i class="seta"></i><div><span class="n"></span><b class="t"></b></div><p class="x"></p>'
            + '<div class="acoes"><button type="button" class="sec" data-a="pular">Pular tour</button><button type="button" class="pri" data-a="proximo">Próximo</button></div></div></div>'
            + '<div class="pausa" role="status"><div>Copiloto pausado nesta tela — o Mercado Livre mudou a página. Os números continuam no painel do Copiloto.</div><button type="button" data-a="tentar">Tentar de novo</button></div>';
        tipEl = SR.querySelector('.tip');
        // Teclas e cliques dentro do host não vazam para os atalhos do ML.
        ['keydown', 'keyup', 'keypress', 'click', 'mousedown'].forEach(t => SR.addEventListener(t, e => e.stopPropagation()));
        SR.addEventListener('click', e => {
            const a = e.target.closest && e.target.closest('[data-a]');
            if (!a) return;
            const acao = a.getAttribute('data-a');
            if (acao === 'salvar') salvaCusto();
            else if (acao === 'cancelar') fechaPop();
            else if (acao === 'pular') fimTour('pulou');
            else if (acao === 'proximo') passoTour(tour.i + 1);
            else if (acao === 'tentar') retomar();
            else if (acao === 'ir' && /^https:\/\/vendedores\.mercadolivre\.com\.br\//.test(a.dataset.url || '')) location.assign(a.dataset.url);
            else if (acao === 'depois') { cartao.atual = null; desenhaCartao(); try { SHC.salvarGuia({ cartaoAte: Date.now() + 864e5 }).catch(() => {}); } catch (e) { /* extensão recarregada */ } }
        });
        SR.querySelector('.pop input').addEventListener('keydown', e => { if (e.key === 'Enter') salvaCusto(); else if (e.key === 'Escape') fechaPop(); });
        document.documentElement.appendChild(H);
        return SR;
    }

    // ── Tooltip (um listener delegado; só lê layout ao posicionar) ──
    function posiciona(caixa, alvo, lado) {
        const r = alvo.getBoundingClientRect(), w = caixa.offsetWidth, h = caixa.offsetHeight;
        let x, y;
        if (lado === 'baixo') { x = r.left; y = r.bottom + 8; if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 8); }
        else { x = r.right + 10; y = r.top - 8; if (x + w > innerWidth - 8) x = Math.max(8, r.left - w - 10); if (y + h > innerHeight - 8) y = Math.max(8, innerHeight - h - 8); }
        x = Math.max(8, Math.min(x, innerWidth - w - 8));
        caixa.style.left = Math.round(x) + 'px';
        caixa.style.top = Math.round(Math.max(8, y)) + 'px';
    }
    function mostraTip(el) {
        const f = tips.get(el);
        if (!f || tour.ativo) return;
        let html = '';
        try { html = f(); } catch (e) { return; }
        host();
        tipAlvo = el;
        tipEl.innerHTML = html;          // montado só com esc() e números formatados
        tipEl.style.display = 'block';
        posiciona(tipEl, el);
    }
    function escondeTip() { tipAlvo = null; if (tipEl) tipEl.style.display = 'none'; }
    function sobre(e) {
        const el = e.target && e.target.closest ? e.target.closest('[data-shc-tip]') : null;
        if (el && el !== tipAlvo) mostraTip(el);
    }
    function fora(e) {
        if (!tipAlvo) return;
        const para = e.relatedTarget;
        if (para && tipAlvo.contains(para)) return;
        const de = e.target && e.target.closest ? e.target.closest('[data-shc-tip]') : null;
        if (de === tipAlvo) escondeTip();
    }

    // ── Popover "Informar custo" ──
    let popItem = null;
    function abrePop(btn, item) {
        const sr = host(), pop = sr.querySelector('.pop');
        popItem = item;
        escondeTip();
        sr.querySelector('.q').textContent = item.sku
            ? 'SKU ' + item.sku + '. Vale para todos os anúncios desse SKU e para outros canais.'
            : (item.familia ? 'Este produto não tem SKU aqui: o custo vale para todas as propostas dele.' : 'Este anúncio não tem SKU: o custo fica só nele.');
        sr.querySelector('.err').textContent = '';
        const inp = sr.querySelector('.pop input');
        inp.value = '';
        pop.style.display = 'block';
        posiciona(pop, btn, 'baixo');
        inp.focus();
        setTimeout(() => document.addEventListener('mousedown', foraDoPop, true), 0);
    }
    function foraDoPop(e) { if (e.target !== H) fechaPop(); }
    function fechaPop() {
        popItem = null;
        document.removeEventListener('mousedown', foraDoPop, true);
        if (SR) SR.querySelector('.pop').style.display = 'none';
    }
    async function salvaCusto() {
        if (!popItem || !vivo()) return fechaPop();
        const inp = SR.querySelector('.pop input'), err = SR.querySelector('.err'), bt = SR.querySelector('[data-a="salvar"]');
        const v = SHC.num(inp.value);
        if (!(v > 0)) { err.textContent = 'Digite um valor maior que zero. Ex.: 250,00'; return; }
        bt.disabled = true;
        try {
            const titulo = popItem.titulo;
            // V12: digitado na etiqueta = 'manual' (o Tiny e a planilha nunca trocam por cima)
            if (popItem.sku) await SHC.salvarCustoSku(popItem.sku, SHC.telaCustoDigitado(v, titulo));
            else await SHC.salvarCusto('ml', popItem.chave, SHC.telaCustoDigitado(v, titulo));
            fechaPop();
            invalida('custos');
            agenda(0);                    // todas as linhas do mesmo SKU mudam juntas
        } catch (e) {
            err.textContent = 'Não consegui salvar. Recarregue a página e tente de novo.';
        } finally { bt.disabled = false; }
    }

    // ── Elementos próprios na página do ML ──
    function mk(tag, cls, txt) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (txt !== undefined) e.textContent = txt;
        return e;
    }
    function nossoW(tag) {                  // embrulho: cliques aqui não chegam na linha do ML
        const w = mk(tag, 'shc-w');
        w.addEventListener('click', e => e.stopPropagation());
        w.addEventListener('mousedown', e => e.stopPropagation());
        return w;
    }
    function comTip(el, f) { el.setAttribute('data-shc-tip', '1'); el.tabIndex = 0; tips.set(el, f); return el; }
    function folhas(el) {
        return Array.prototype.filter.call(el.querySelectorAll('span,p,div,b,strong,a,label,small'),
            e => e.childElementCount === 0 && !(e.closest && e.closest('.shc-w,.shcp-bar')));
    }
    const LEGENDA = '<div class="nota"><span style="color:#FDE68A">■</span> números do Mercado Livre &nbsp; <span style="color:#93C5FD">■</span> seus números</div>';
    const tr = (cls, rot, vals, neg) => '<tr class="' + cls + '"><td>' + esc(rot) + '</td>'
        + vals.map(v => '<td>' + (neg ? '− ' : '') + esc(typeof v === 'number' ? moeda(v) : v) + '</td>').join('') + '</tr>';
    const expl = ex => ex ? '<div class="exp">' + esc(ex.frase) + '</div><div class="nota">' + esc(ex.fonte) + '</div>' : '';

    // ── Anúncios ──
    function tipAnuncio(it, s, cfg) {
        return '<h5>Resultado de 1 venda</h5><div class="sub">' + esc([it.itemId, it.sku ? 'SKU ' + it.sku : '', it.tipo].filter(Boolean).join(' · ')) + '</div><table>'
            + SHC.telaAnuncioLinhas(it).map(l => tr(l.cls, l.rot, [l.v], l.neg)).join('')
            + tr('seu', it.sku ? 'Custo do SKU ' + it.sku : 'Custo do produto', [s.custo], 1)
            + (s.outros > 0 ? tr('seu', 'Outros custos', [s.outros], 1) : '')
            + tr('seu', 'Imposto (' + pct(SHC.num(cfg.imposto_pct) || 0) + ' do preço)', [s.imposto], 1)
            + tr('tot', s.sobra < 0 ? '= Prejuízo' : '= Sobra', [Math.abs(s.sobra)]) + '</table>'
            + '<div class="res ' + SHC.telaClasseRes(s.classe) + '">' + esc(SHC.telaResultado(s, cfg)) + '</div>'
            + simHtml(it)
            + expl(SHC.telaExplica('anuncio', { item: it, s }, cfg))
            + (it.freteDeduzido ? '<div class="nota">* Frete calculado: preço − tarifa − você recebe.</div>' : '') + LEGENDA;
    }
    // Simulador de custos do ML: o balão NÃO pede nada ao ML; só lê o que o painel já conferiu (sim:<conta>:<MLB>, até 24 h) e mostra
    // uma linha. Não bateu com o Copiloto → mostra o valor do ML (nunca esconde a diferença). A conferência é no painel › Frete.
    const SIM_RECENTE_MS = 24 * 3600e3;
    const sims = new Map();                    // itemId → 'lendo' | { sim|null, lidoEm }
    function pedeSim(id) {
        const x = sims.get(id);
        if (x && (x === 'lendo' || Date.now() - x.lidoEm < 30e3)) return x;
        sims.set(id, 'lendo');
        Promise.resolve().then(async () => { const c = await SHC.contaAtual(); return c ? SHC.lerChave('sim:' + c + ':' + id) : null; })
            .then(v => v, () => null)
            .then(v => { sims.set(id, { sim: v && v.hoje && Date.now() - v.ts < SIM_RECENTE_MS ? v : null, lidoEm: Date.now() });
                if (v && v.hoje && tipAlvo && tipAlvo.isConnected && tipAlvo.getAttribute('data-shc-sim') === id) { const el = tipAlvo; tipAlvo = null; mostraTip(el); } });
        return 'lendo';
    }
    // → '' | uma linha. soConferido: só a linha "Conferido ✓" (balão do atacado, que é estimativa em outro preço).
    function simHtml(it, soConferido) {
        const x = pedeSim(it.itemId);
        if (x === 'lendo' || !x.sim) return '';
        const cf = SHC.simConfere(x.sim.hoje, it.recebe, it.preco);
        if (cf && cf.bate === true) return '<div class="nota">Conferido com o Simulador do ML ✓</div>';
        return cf && cf.bate === false && !soConferido ? '<div class="nota">' + esc(cf.texto) + '</div>' : '';
    }
    function tipAtacado(it, g, sa, cfg) {
        const ls = SHC.telaAtacadoLinhas(g, sa);
        const desc = sa.descontoPct > 0 ? ' (' + esc(pct(sa.descontoPct)) + ' de desconto sobre ' + esc(moeda(it.preco)) + (it.emPromocao ? ', o preço da promoção' : '') + ')' : '';
        return '<h5>Preço de atacado: a partir de ' + g.qtd + ' unidades</h5><div class="sub">Quem compra ' + g.qtd + ' ou mais paga ' + esc(moeda(g.preco))
            + ' por unidade' + desc + '.</div><table><tr><th></th><th>por unidade</th><th>pedido de ' + g.qtd + ' un.</th></tr>'
            + ls.map(l => tr(l.cls, l.rot, [l.un, l.ped], l.neg)).join('') + '</table>'
            + '<div class="res ' + SHC.telaClasseRes(sa.classe) + '">' + esc(SHC.telaResultado(sa, cfg)) + ' (estimativa)</div>'
            + simHtml(it, true)
            + expl(SHC.telaExplica('atacado', { degrau: g, s: sa }, cfg))
            + '<div class="nota">* Mesma % de tarifa do preço atual.' + (sa.freteComprador ? ' Neste anúncio o comprador paga o frete; o ML cobra o custo operacional por unidade.' : ' ** Frete conservador: um envio por peça.') + '</div>' + LEGENDA;
    }
    function tipFrete(it, v) {
        const pts = v.pontos.slice(-6);
        return '<h5>Frete deste anúncio</h5><div class="sub">' + esc([it.itemId, it.sku ? 'SKU ' + it.sku : ''].filter(Boolean).join(' · ')) + ' · frete cobrado de você por venda</div>'
            + '<table><tr><th>Desde</th><th>frete por venda</th></tr>'
            + pts.map((p, i) => tr(i && p.v > pts[i - 1].v ? 'sobe' : 'ml', SHC.telaDataCurta(p.d), [p.v])).join('')
            + tr('tot', 'Hoje (esta tela)', [v.agora]) + '</table>'
            + '<div class="res ' + (v.tipo === 'sobe' ? 'at' : 'ok') + '">' + esc(v.tipo === 'igual' ? 'Sem variação desde ' + SHC.telaDataCurta(v.desde)
                : (v.tipo === 'sobe' ? 'Subiu ' : 'Caiu ') + moeda(Math.abs(v.dif)) + ' por venda (' + pct(v.pctDif) + ') em ' + SHC.telaDataCurta(v.desde)) + '</div>'
            + expl(SHC.telaExplica('frete', v)) + '<div class="nota">Clique no selo para ver o frete no painel do Copiloto.</div>';
    }

    function renderAnuncio(it, ctx) {
        const el = document.getElementById(it.itemId);
        if (!el) return 'skip';
        const sd = SHC.telaSaude(it.itemId, ctx.saude);   // na assinatura: só a linha cujas etiquetas mudaram é redesenhada
        const sig = ctx.v0 + '|' + (degraus.has(it.itemId) ? 'd' : '') + '|' + sd.map(c => c.cls + c.txt + (c.extra || '')).join(',');
        const st = linhas.get(it.itemId);
        if (st && st.completo && st.el === el && st.sig === sig && st.els.every(e => e.isConnected)) return 'ok';
        if (st) st.els.forEach(e => e.remove());
        linhas.delete(it.itemId);
        const fs = folhas(el);
        const alvoTxt = norm(moeda(it.recebe));
        let alvo = null;
        for (let i = fs.length - 1; i >= 0; i--) if (norm(fs[i].textContent) === alvoTxt) { alvo = fs[i]; break; }
        if (!alvo) return 'falha';
        const els = [], c = ctx.custos.get(it.itemId), cfg = ctx.cfg;
        let completo = true;              // falhou alguma âncora (atacado/frete) → tenta de novo no próximo passe
        const s = SHC.sobraAnuncio(it, c && c.dados, cfg);
        const w = nossoW('div');
        if (s && s.sobra !== null) {
            const ch = SHC.telaChip(s), b = mk('span', 'shc-r ' + ch.cls);
            b.appendChild(mk('b', '', ch.titulo));
            b.appendChild(mk('i', '', ch.sub));
            b.setAttribute('data-shc-sim', it.itemId);
            w.appendChild(comTip(b, () => tipAnuncio(it, s, cfg)));
        } else {
            const bt = mk('button', 'shc-add', '＋ Informar custo');
            bt.type = 'button';
            bt.addEventListener('click', e => { e.preventDefault(); abrePop(bt, { sku: it.sku, chave: it.itemId, titulo: it.titulo }); });
            w.appendChild(bt);
        }
        // Saúde: fotos, dados fiscais (link para o Editor em massa) e radar de visitas, embaixo do lucro.
        if (sd.length) {
            const box = mk('span', 'shc-sd');
            sd.forEach(c => {
                const el = mk(c.link ? 'a' : 'span', 'shc-s ' + c.cls, c.txt);
                if (c.extra) { el.appendChild(document.createTextNode(' · ')); el.appendChild(mk('b', '', c.extra)); }
                if (c.link) { el.href = c.link; el.target = '_blank'; el.rel = 'noopener'; }
                box.appendChild(comTip(el, () => '<h5>' + esc(c.titulo) + '</h5><div class="exp">' + esc(c.tip) + '</div>'));
            });
            w.appendChild(box);
        }
        alvo.insertAdjacentElement('afterend', w);
        els.push(w);

        // Atacado: um chip por degrau, alinhado com a linha "preço de atacado" da coluna Preço.
        if (it.atacado && s && s.sobra !== null) {
            const dg = degraus.get(it.itemId);
            if (!dg) pedeDegraus(it.itemId);
            else if (dg.length) {
                const pe = fs.find(e => /pre[çc]os? de atacado/i.test(e.textContent || ''));
                const linhaP = pe && pe.closest('.sll-list-text-line');
                let ref = linhaP && el.contains(linhaP) ? linhaP : (pe && pe.parentElement);
                if (!ref) completo = false;
                else dg.forEach(g => {
                    const sa = SHC.sobraAtacado(it, g, c.dados, cfg);
                    if (!sa) return;
                    const box = nossoW('div'), at = mk('span', 'shc-at'), cls = sa.classe === 'prejuizo' ? 'pre' : (sa.classe === 'apertado' ? 'ate' : 'luc');
                    at.appendChild(document.createTextNode('≥ ' + g.qtd + ' un. · margem ' + pct(sa.pct)));
                    at.appendChild(mk('b', cls, (sa.sobra < 0 ? 'Prejuízo ' : 'Lucro ') + moeda(Math.abs(sa.sobra)) + '/un.'));
                    at.setAttribute('data-shc-sim', it.itemId);
                    box.appendChild(comTip(at, () => tipAtacado(it, g, sa, cfg)));
                    ref.insertAdjacentElement('afterend', box);
                    ref = box;
                    els.push(box);
                });
            }
        }

        // Selo do frete, ao lado do valor exato do frete (a folha "R$ 106,85" depois de "frete grátis").
        if (!it.freteDeduzido && it.frete !== null) {
            const v = SHC.telaVariacaoFrete(ctx.fretes[it.itemId], it.frete, ctx.hoje), selo = SHC.telaSeloFrete(v);
            if (selo) {
                const m = norm(moeda(it.frete));
                const i0 = fs.findIndex(e => /frete/i.test(e.textContent || ''));
                const fl = i0 < 0 ? null : fs.slice(i0).find(e => { const t = norm(e.textContent); return t === m || t.endsWith(' ' + m); });
                if (fl) {
                    const w2 = nossoW('span'), bt = mk('button', 'shc-fr ' + selo.cls, selo.txt);
                    bt.type = 'button';
                    bt.addEventListener('click', e => { e.preventDefault(); manda({ acao: 'abrir_frete', itemId: it.itemId }); });
                    w2.appendChild(comTip(bt, () => tipFrete(it, v)));
                    fl.insertAdjacentElement('afterend', w2);
                    els.push(w2);
                } else completo = false;
            }
        }
        linhas.set(it.itemId, { el, sig, els, completo });
        return 'ok';
    }

    // Degraus de atacado: GET same-origin, 1 por item por tela, espaçados.
    function pedeDegraus(id) {
        if (pedidosAt.has(id) || !/^MLB\d+$/.test(id)) return;
        pedidosAt.add(id);
        filaAt.push(id);
        rodaFila();
    }
    async function rodaFila() {
        if (filaRodando) return;
        filaRodando = true;
        const g = geracao;
        while (filaAt.length && g === geracao && !parado) {
            const id = filaAt.shift();
            let dg = [];
            try {
                const r = await fetch('/anuncios/api/listing/tooltip?type=tiered_pricing&documentId=' + encodeURIComponent(id), { credentials: 'include', headers: { accept: 'application/json' } });
                if (r.ok) dg = SHC.mlAtacadoDoTooltip(await r.json());
            } catch (e) { /* sem degraus */ }
            if (g !== geracao) break;
            degraus.set(id, dg);
            if (dg.length) agenda(150);
            await new Promise(ok => setTimeout(ok, 400));
        }
        filaRodando = false;
        if (filaAt.length && !parado) rodaFila();   // itens postos por uma tela nova enquanto o laço antigo terminava
    }

    // ── Central de promoções ──
    function tipProposta(p, l, fam, cfg, melhor) {
        const custo = l.custoDados ? SHC.num(l.custoDados.custo) : null, outros = l.custoDados ? (SHC.num(l.custoDados.outros) || 0) : 0;
        return '<h5>' + esc(p.promo) + '</h5><div class="sub">' + esc([p.datas, p.desconto_txt ? 'desconto sugerido ' + p.desconto_txt : '', fam ? fam.titulo : ''].filter(Boolean).join(' · ')) + '</div><table>'
            + tr('ml', 'Preço final da promoção', [p.preco])
            + tr('ml', 'Tarifa de venda do ML (' + pct(p.tarifa / p.preco * 100) + (p.tipo ? ' · ' + p.tipo : '') + ')', [p.tarifa], 1)
            + tr('ml', 'Frete por sua conta', [p.envio || 0], 1)
            + tr('ml tot', '= Você recebe do ML', [p.recebe])
            + tr('seu', 'Custo do produto', [custo], 1)
            + (outros > 0 ? tr('seu', 'Outros custos', [outros], 1) : '')
            + tr('seu', 'Imposto (' + pct(SHC.num(cfg.imposto_pct) || 0) + ')', [l.imposto], 1)
            + tr('tot', l.sobra < 0 ? '= Prejuízo' : '= Sobra', [Math.abs(l.sobra)]) + '</table>'
            + '<div class="res ' + SHC.telaClasseRes(l.classe) + '">' + esc(SHC.telaResultado(l, cfg)) + '</div>'
            + expl(SHC.telaExplica('proposta', { p, s: Object.assign({ outros }, l) }, cfg))
            + (melhor ? '<div class="nota">' + esc(melhor.nota) + '</div>' : '') + LEGENDA;
    }
    function tipSemCalculo(b) {
        const ex = SHC.telaExplica('sem_calculo');
        return '<h5>' + esc(b.nome) + '</h5>' + (b.datas ? '<div class="sub">' + esc(b.datas) + '</div>' : '')
            + '<div class="res sc">Sem cálculo do ML</div>' + expl(ex);
    }
    function chipProposta(v) {
        const ch = mk('span', 'shcp ' + v.cls);
        ch.appendChild(mk('b', '', v.txt));
        ch.appendChild(mk('span', '', v.sub));
        return ch;
    }

    function renderFamilia(f, ctx) {
        const ls = ctx.porFam.get(f.chave) || [], sc = ctx.scPorFam.get(f.chave) || [];
        if (!ls.length && !sc.length) return 'skip';
        const tEl = ctx.titulos.find(e => !ctx.usadosT.has(e) && norm(e.textContent) === norm(f.titulo));
        const grupo = tEl && tEl.closest('.sc-list-row-group');
        if (!grupo) return 'falha';
        ctx.usadosT.add(tEl);
        const viavel = ls.some(l => l.classe === 'lucrativo');
        const st = grupos.get(f.chave);
        if (st && st.completo && st.grupo === grupo && st.sig === ctx.v0 && st.els.every(e => e.isConnected)) { st.viavel = viavel; return 'ok'; }
        if (st) st.els.forEach(e => e.remove());
        const els = [], usados = new Set(), fs = folhas(grupo), cfg = ctx.cfg;
        const rec = SHC.recomendaPromo(ls.filter(l => l.sobra !== null), cfg, (ls.find(l => l.custoDados) || {}).custoDados);
        const melhor = SHC.telaMelhor(rec);
        ls.forEach(l => {
            const p = l.p, m = norm(moeda(p.preco)), rcb = moeda(p.recebe).replace('R$ ', '');
            const cand = fs.filter(e => !usados.has(e) && norm(e.textContent) === m && e.closest('.sc-list-row'));
            const alvo = cand.find(e => (e.closest('.sc-list-row').textContent || '').indexOf(rcb) >= 0)
                || cand.find(e => /você recebe/i.test(e.closest('.sc-list-row').textContent || ''));
            if (!alvo) return;
            usados.add(alvo);
            const w = nossoW('div'), v = SHC.telaVeredito(l.classe, l);
            if (l.classe === 'sem_custo') {
                const bt = mk('button', 'shcp sem');
                bt.type = 'button';
                bt.appendChild(mk('b', '', v.txt));
                bt.appendChild(mk('span', '', v.sub));
                bt.addEventListener('click', e => { e.preventDefault(); abrePop(bt, { sku: l.sku, chave: f.chave, familia: f.chave, titulo: f.titulo }); });
                w.appendChild(bt);
            } else {
                const ehMelhor = rec && melhor && rec.escolha === l;
                w.appendChild(comTip(chipProposta(v), () => tipProposta(p, l, f, cfg, ehMelhor ? melhor : null)));
                if (ehMelhor) { const d = mk('div'); d.appendChild(mk('span', 'shcp-ideal', melhor.txt)); w.appendChild(d); }
            }
            alvo.insertAdjacentElement('afterend', w);
            els.push(w);
        });
        sc.forEach(b => {
            const alvo = fs.find(e => !usados.has(e) && norm(e.textContent) === norm(b.nome));
            if (!alvo) return;
            usados.add(alvo);
            const w = nossoW('div');
            w.appendChild(comTip(chipProposta(SHC.telaVeredito('sem_calculo')), () => tipSemCalculo(b)));
            alvo.insertAdjacentElement('afterend', w);
            els.push(w);
        });
        // guarda sempre (para remover no próximo passe), mas só vale como cache se todas as etiquetas entraram
        grupos.set(f.chave, { grupo, sig: ctx.v0, els, viavel, completo: els.length === ls.length + sc.length });
        return els.length ? 'ok' : 'falha';
    }

    function desenhaBarra(cont) {
        const grid = document.querySelector('.sc-list-grid');
        if (!grid || !grid.parentElement) return;
        if (!barra || !barra.isConnected) {
            barra = mk('div', 'shcp-bar');
            barra.addEventListener('click', e => e.stopPropagation());
            const bt = mk('button', 'shcp-filtro', 'Mostrar só as que dão para entrar');
            bt.type = 'button';
            bt.addEventListener('click', e => { e.preventDefault(); soViaveis = !soViaveis; aplicaFiltro(); });
            barra.appendChild(mk('span', 'lg'));
            barra.appendChild(mk('span', 'cs'));
            barra.appendChild(bt);
            grid.parentElement.insertBefore(barra, grid);
        }
        const t = SHC.telaBarra(cont), cs = barra.querySelector('.cs');
        barra.querySelector('.lg').textContent = t.titulo;
        cs.textContent = '';
        t.itens.forEach(i => cs.appendChild(mk('span', 'c ' + i.cls, i.txt)));
        const bt = barra.querySelector('.shcp-filtro');
        bt.textContent = soViaveis ? 'Mostrar todas' : 'Mostrar só as que dão para entrar';
        bt.classList.toggle('on', soViaveis);
    }
    // O filtro só esconde grupos (classe shcp-oculto); não clica em nada do ML.
    function aplicaFiltro() {
        const ok = new Set();
        grupos.forEach(g => { if (g.viavel) ok.add(g.grupo); });
        document.querySelectorAll('.sc-list-row-group').forEach(g => g.classList.toggle('shcp-oculto', soViaveis && !ok.has(g)));
        if (barra) {
            const bt = barra.querySelector('.shcp-filtro');
            bt.textContent = soViaveis ? 'Mostrar todas' : 'Mostrar só as que dão para entrar';
            bt.classList.toggle('on', soViaveis);
        }
    }

    // ── Dados (estado do ML + o que o seller informou) ──
    async function buscaEstado() {
        const url = location.href, t = ultimaBusca.get(url) || 0;
        if (Date.now() - t < 30000) return null;
        ultimaBusca.set(url, Date.now());
        try {
            const r = await fetch(url, { credentials: 'include' });
            return r.ok ? SHC.mlExtraiEstado(await r.text()) : null;
        } catch (e) { return null; }
    }
    function estadoDoScript() {
        const s = document.getElementById('__NORDIC_RENDERING_CTX__');
        return s ? SHC.mlExtraiEstado(s.textContent || '') : null;
    }
    function usaEstado(tela, r) {
        if (tela === 'anuncios') {
            const itens = SHC.mlAnunciosDoEstado(r), porId = new Map();
            itens.forEach(i => { if (!porId.has(i.itemId) || (i.preco !== null && porId.get(i.itemId).preco === null)) porId.set(i.itemId, i); });
            estado = { url: location.href, tela, r, itens: [...porId.values()], porId };
            custosC = null; fretesC = null;
            if (itens.length) manda(SHC.telaMsgPagina('anuncios_pagina', r, { url: location.href, itens }));
        } else {
            estado = { url: location.href, tela, r, promos: SHC.mlPromosDoEstado(r), semCalc: SHC.telaPromosSemCalculo(r) };
            custosC = null;
        }
    }
    async function garanteEstado(tela) {
        if (estado && estado.url === location.href && estado.tela === tela) return true;
        let r = location.href === hrefCarga ? estadoDoScript() : null;
        if (!r) r = await buscaEstado();
        if (!r) return false;
        usaEstado(tela, r);
        return true;
    }
    // A tela mostra MLB que não está nos dados (troca de página/busca sem recarregar) → busca de novo.
    const semSolucao = new Set();              // URL em que buscar de novo não trouxe os MLB da tela
    const mlbFaltando = () => Array.prototype.filter.call(document.querySelectorAll('[id^="MLB"]'), e => /^MLB\d+$/.test(e.id) && !estado.porId.has(e.id));
    async function confereAnunciosNovos() {
        const url = location.href;
        if (semSolucao.has(url) || !mlbFaltando().length) return;
        const r = await buscaEstado();
        if (!r || SHC.telaDe(location.href) !== 'anuncios' || location.href !== url) return;
        usaEstado('anuncios', r);
        if (mlbFaltando().length) semSolucao.add(url);   // não insiste: no máx. 1 busca extra por URL
        agenda(0);
    }

    function invalida(o) {
        versao++;
        if (o === 'custos' || o === 'tudo') { custosC = null; cfgC = null; }
        if (o === 'fretes' || o === 'tudo') fretesC = null;
        if (o === 'sku' || o === 'tudo') { skuC = null; custosC = null; saudeC = null; }   // saudeC: SKUs com medidas diferentes vêm do retrato
    }
    async function cfgAtual() { if (!cfgC) cfgC = await SHC.lerCfg(); return cfgC; }

    async function ctxAnuncios() {
        if (!(await garanteEstado('anuncios'))) return null;
        const itens = estado.itens.filter(i => i.preco !== null && i.recebe !== null);
        if (!custosC) {
            const infos = itens.map(i => ({ sku: i.sku, familia: i.familia, itemId: i.itemId }));
            const m = await SHC.custosDe(infos), out = new Map();
            infos.forEach(i => out.set(i.itemId, m.get(i)));
            custosC = out;
        }
        if (!fretesC) fretesC = await SHC.lerFretes(itens.map(i => i.itemId));
        if (!saudeC) {
            const [fiscal, fotos, visitas, medidas, snap] = await Promise.all([SHC.lerFiscal(), SHC.lerFotos(), SHC.lerVisitas(), SHC.lerMedidas(), SHC.lerAnuncios()]).catch(() => [null, null, null, null, null]);
            // SKUs com medidas diferentes: com o retrato da conta inteira (a tela mostra só uma página de anúncios). Desempate pelas
            // vendas (vm|ml, unidades por mês), igual ao painel: os dois apontam a mesma referência.
            const ids = medidas && medidas.porItem ? Object.keys(medidas.porItem) : [];
            const vm = ids.length ? await SHC.lerVendasMes(ids).catch(() => ({})) : {};
            const vendas = {};
            ids.forEach(id => { vendas[id] = Object.keys(vm[id] || {}).reduce((s, m) => s + (+vm[id][m] || 0), 0); });
            const medDiv = ids.length ? SHC.medidasDivergentes(medidas.porItem, (snap && snap.itens) || [], { vendas }) : [];
            saudeC = { fiscal, fotos, visitas, medidas, medDiv };
        }
        const cfg = await cfgAtual();
        return { cfg, custos: custosC, fretes: fretesC, hoje: SHC.hoje(), itens, saude: Object.assign({ cfg, hoje: SHC.hoje() }, saudeC) };
    }

    async function ctxPromos() {
        if (!(await garanteEstado('promos'))) return null;
        const cfg = await cfgAtual(), { familias, propostas } = estado.promos;
        if (!skuC) {                     // a Central não mostra SKU: vem do retrato da lista de Anúncios
            skuC = new Map();
            try { const snap = await SHC.lerAnuncios(); ((snap && snap.itens) || []).forEach(i => { if (i.itemId && i.sku) skuC.set(i.itemId, i.sku); }); } catch (e) { /* sem retrato */ }
        }
        if (!custosC) {
            const infos = new Map();
            propostas.forEach(p => { if (!infos.has(p.itemId)) infos.set(p.itemId, { sku: skuC.get(p.itemId) || '', familia: p.familia, itemId: p.itemId }); });
            const m = await SHC.custosDe([...infos.values()]), out = new Map();
            infos.forEach((i, id) => out.set(id, m.get(i)));
            custosC = out;
        }
        const porFam = new Map(), scPorFam = new Map(), classes = [];
        propostas.forEach(p => {
            const c = custosC.get(p.itemId), s = SHC.sobraProposta(p, c && c.dados, cfg);
            const l = Object.assign({ p, custoDados: c ? c.dados : null, sku: skuC.get(p.itemId) || '' }, s);
            (porFam.get(p.familia) || porFam.set(p.familia, []).get(p.familia)).push(l);
            classes.push({ classe: s.classe, familia: p.familia });
        });
        estado.semCalc.forEach(b => {
            (scPorFam.get(b.familia) || scPorFam.set(b.familia, []).get(b.familia)).push(b);
            classes.push({ classe: 'sem_calculo', familia: b.familia });
        });
        return { cfg, familias, porFam, scPorFam, cont: SHC.telaContagem(classes), titulos: [...document.querySelectorAll('p.sc-list-description__title')], usadosT: new Set() };
    }

    // ── Passe: agenda só depois de 250 ms sem mutação, roda ocioso e em fatias de ≤ 8 ms ──
    function agenda(ms) {
        if (parado) return;
        const agora = Date.now();
        if (!desde) desde = agora;
        clearTimeout(timer);
        const espera = agora - desde > 2500 ? 0 : (ms === undefined ? 250 : ms);   // ML mexendo sem parar: roda mesmo assim
        timer = setTimeout(() => { desde = 0; ocioso(passe); }, espera);
    }
    async function fatias(jobs, g) {
        const res = { ok: 0, falha: 0, erros: 0 };
        let i = 0;
        while (i < jobs.length) {
            await new Promise(ok => ocioso(ok));
            if (g !== geracao || parado) return null;
            const t0 = performance.now();
            do {
                try { const x = jobs[i](); if (x === 'ok') res.ok++; else if (x === 'falha') res.falha++; }
                catch (e) { res.erros++; res.falha++; }
                i++;
            } while (i < jobs.length && performance.now() - t0 < 8);
        }
        return res;
    }
    async function passe() {
        if (parado) return;
        if (!vivo()) return parar();
        if (rodando) { pendente = true; return; }
        rodando = true;
        try {
            if (location.href !== hrefAtual) trocaTela();
            const tela = SHC.telaDe(location.href);
            if (!tela || pausado) return;
            const g = geracao, v0 = versao;   // versão do começo: se mudar no meio, as linhas ficam velhas e são redesenhadas
            const ctx = tela === 'anuncios' ? await ctxAnuncios() : await ctxPromos();
            if (!ctx || g !== geracao) return;
            ctx.v0 = v0;
            const jobs = tela === 'anuncios' ? ctx.itens.map(it => () => renderAnuncio(it, ctx)) : ctx.familias.map(f => () => renderFamilia(f, ctx));
            const res = await fatias(jobs, g);
            if (!res || g !== geracao) return;
            if (tela === 'promos') { desenhaBarra(ctx.cont); aplicaFiltro(); }
            if (SHC.telaDevePausar(res)) {
                if (++falhasSeguidas >= 2) return pausar();
                agenda(2000);             // pode ser a tela ainda montando: confere de novo antes de pausar
            } else falhasSeguidas = 0;
            if (res.ok > 0) talvezTour(tela);
            if (tela === 'anuncios' && !lucroMarcado && document.querySelector('.shc-w .shc-r')) {   // 1ª etiqueta de lucro/prejuízo vista
                lucroMarcado = true;
                SHC.telaMarcaLucro().catch(() => { lucroMarcado = false; });
            }
            if (tela === 'anuncios') confereAnunciosNovos().catch(() => {});
        } catch (e) {
            if (/context invalidated/i.test(String(e && e.message))) parar();
        } finally {
            rodando = false;
            if (pendente && !parado) { pendente = false; agenda(250); }
        }
    }

    function limpaPagina() {
        document.querySelectorAll('.shc-w,.shcp-bar').forEach(e => e.remove());
        document.querySelectorAll('.shcp-oculto').forEach(e => e.classList.remove('shcp-oculto'));
        linhas.clear(); grupos.clear(); barra = null;
    }
    function trocaTela() {
        geracao++;
        hrefAtual = location.href;
        estado = null; custosC = null; fretesC = null; saudeC = null;
        degraus.clear(); pedidosAt.clear(); filaAt.length = 0;
        soViaveis = false; pausado = false; falhasSeguidas = 0;
        escondeTip(); fechaPop(); fimTour(true);
        if (SR) SR.querySelector('.pausa').style.display = 'none';
        limpaPagina();
        agendaCartao(300);                // a dica do cartão depende da tela
    }
    function pausar() {
        pausado = true;
        limpaPagina();
        escondeTip(); fechaPop(); fimTour(true);
        host().querySelector('.pausa').style.display = 'block';
    }
    function retomar() {
        pausado = false; falhasSeguidas = 0;
        if (SR) SR.querySelector('.pausa').style.display = 'none';
        estado = null; invalida('tudo');
        agenda(0);
    }

    // ── Tour do primeiro uso (uma vez por tela; estado em shc:guia). Passos em SHC.TOUR_PASSOS. ──
    const NUM = ['①', '②', '③', '④', '⑤'];
    const tour = { ativo: false, tela: null, passos: [], i: 0, alvo: null, raf: 0 };
    const visivel = e => !!e && e.isConnected && e.getClientRects().length > 0;
    const naVista = e => { const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.width > 0; };
    // Alvo do passo: o primeiro que já está na tela; senão o primeiro da página (a lista do ML é virtualizada).
    const alvoDe = sel => { const els = Array.prototype.filter.call(document.querySelectorAll(sel), visivel); return els.find(naVista) || els[0] || null; };
    async function talvezTour(tela) {
        if (tourVisto[tela] || tour.ativo || popItem) return;
        tourVisto[tela] = true;
        // Tour progressivo: mostra só os passos ainda não vistos que têm o que apontar agora
        // (sem etiqueta de lucro → "Informe o custo"; com etiqueta → "Quanto sobra" e "Passe o mouse").
        let vistos;
        try { const g = await SHC.lerGuia(); const t = g.tours && g.tours[tela]; if (t === true) return; vistos = new Set(Array.isArray(t) ? t : []); } catch (e) { return; }
        if (SHC.telaDe(location.href) !== tela || pausado) return;
        const passos = SHC.telaPassosTour(tela, vistos, sel => !!document.querySelector(sel));   // sem ler layout aqui
        if (!passos.length) { tourVisto[tela] = false; return; }    // nada para apontar: tenta no próximo passe
        Object.assign(tour, { ativo: true, tela, passos, i: 0, vistos });
        escondeTip();
        host().querySelector('.tour').style.display = 'block';
        desenhaCartao();
        addEventListener('scroll', reposTour, { passive: true, capture: true });
        addEventListener('resize', reposTour, { passive: true });
        passoTour(0);
    }
    function passoTour(i) {
        if (!tour.ativo) return;
        if (i >= tour.passos.length) return fimTour();
        tour.i = i;
        const p = tour.passos[i];
        tour.alvo = alvoDe(p.sel);
        if (!tour.alvo) return passoTour(i + 1);
        const bal = SR.querySelector('.balao');
        bal.querySelector('.n').textContent = NUM[i] || String(i + 1);
        bal.querySelector('.t').textContent = (i + 1) + ' de ' + tour.passos.length + ' · ' + p.t;
        bal.querySelector('.x').textContent = p.x;
        SR.querySelector('[data-a="proximo"]').textContent = i === tour.passos.length - 1 ? 'Entendi' : 'Próximo';
        SHC.telaLevaAoAlvo(tour.alvo, innerWidth, innerHeight);
        reposTour();
    }
    function reposTour() {
        if (!tour.ativo || tour.raf) return;
        tour.raf = requestAnimationFrame(() => {
            tour.raf = 0;
            if (!tour.ativo) return;
            // Alvo saiu da tela (rolagem) ou sumiu (lista virtualizada): troca por outro do mesmo tipo que esteja na vista.
            if (!visivel(tour.alvo) || !naVista(tour.alvo)) {
                const outro = alvoDe(tour.passos[tour.i].sel);
                if (outro && (naVista(outro) || !visivel(tour.alvo))) { tour.alvo = outro; SHC.telaLevaAoAlvo(outro, innerWidth, innerHeight); }
            }
            if (!visivel(tour.alvo)) return passoTour(tour.i + 1);
            // Mede o ALVO (não o destaque, que anima) e põe o balão ao lado dele, com a setinha apontando.
            const r = tour.alvo.getBoundingClientRect(), bur = SR.querySelector('.buraco'), bal = SR.querySelector('.balao');
            const d = { left: r.left - 4, top: r.top - 4, right: r.right + 4, bottom: r.bottom + 4, width: r.width + 8, height: r.height + 8 };
            Object.assign(bur.style, { left: d.left + 'px', top: d.top + 'px', width: d.width + 'px', height: d.height + 'px' });
            const pos = SHC.telaPosBalao(d, bal.offsetWidth, bal.offsetHeight, innerWidth, innerHeight);
            bal.className = 'balao ' + pos.lado;
            bal.style.left = pos.x + 'px';
            bal.style.top = pos.y + 'px';
            bal.style.setProperty('--seta', pos.seta + 'px');
        });
    }
    function fimTour(semSalvar) {
        if (!tour.ativo) return;
        const tela = tour.tela;
        tour.ativo = false;
        removeEventListener('scroll', reposTour, { capture: true });
        removeEventListener('resize', reposTour);
        if (SR) SR.querySelector('.tour').style.display = 'none';
        desenhaCartao();
        if (semSalvar === true) { tourVisto[tela] = false; return; }
        // "Pular tour" = não mostrar mais nesta tela; "Entendi" = só os passos mostrados ficam vistos.
        const valor = semSalvar === 'pulou' ? true : [...new Set([...(tour.vistos || []), ...tour.passos.map(p => p.id)])];
        const todos = Array.isArray(valor) && SHC.TOUR_PASSOS[tela].every(p => valor.indexOf(p.id) >= 0);
        // Ainda faltam passos (ex.: só viu "Informe o custo"): depois de gravar, libera o próximo passe para mostrar os novos.
        try { SHC.salvarGuia({ tours: { [tela]: todos ? true : valor } }).then(() => { if (Array.isArray(valor) && !todos) tourVisto[tela] = false; }).catch(() => {}); } catch (e) { /* extensão recarregada */ }
    }

    // ── Cartão "Próximo passo" (canto inferior esquerdo; some no tour e quando o guia termina) ──
    const cartao = { atual: null, prox: null, t: 0, ate: 0 };
    let lucroMarcado = false;
    async function ctxGuia() {
        const conta = await SHC.contaAtual();
        const [cfg, guia, status, anuncios, full, promos] = await Promise.all([SHC.lerCfg(), SHC.lerGuia(), SHC.lerStatus(), SHC.lerAnuncios(conta), SHC.lerFull(conta), SHC.lerPromos(conta)]);
        const itens = (anuncios && anuncios.itens) || [], chaves = new Set();
        itens.forEach(i => { if (i.sku) chaves.add(SHC.chaveSku(i.sku)); if (i.familia) chaves.add(SHC.chave('ml', i.familia)); if (i.itemId) chaves.add(SHC.chave('ml', i.itemId)); });
        chaves.delete('');
        const ids = [...new Set(itens.map(i => i.itemId).filter(Boolean))];
        const [custos, vm] = await Promise.all([chaves.size ? chrome.storage.local.get([...chaves]) : {}, ids.length ? SHC.lerVendasMes(ids) : {}]);
        // icone: a página do ML não sabe se o ícone está fixado; SHC.telaCartaoGuia não deixa essa etapa opcional travar o cartão.
        return { cfg, guia, status, anuncios, custos, vm, temFull: full ? full.temFull : undefined,
            temPromos: promos && promos.vazio ? false : undefined, icone: null, hoje: SHC.hoje() };   // mesmo ctx do painel lateral
    }
    async function atualizaCartao() {
        if (parado || !vivo() || typeof SHC.guiaProximo !== 'function') return;
        let res = null, ctx = null;
        try { ctx = await ctxGuia(); res = SHC.guiaProximo(ctx); } catch (e) { return; }
        const novo = SHC.telaCartaoGuia(res, ctx.guia, Date.now(), SHC.telaDe(location.href));
        const pronto = cartao.atual && cartao.atual.id !== 'pronto' && (!novo || novo.id !== cartao.atual.id) ? SHC.telaCartaoPronto(cartao.atual, res) : null;
        if (pronto) {                     // "✓ Pronto" por ~2 s e já mostra a próxima (ou some, se acabou)
            cartao.atual = pronto; cartao.prox = novo; desenhaCartao();
            cartao.ate = setTimeout(() => { cartao.atual = cartao.prox; desenhaCartao(); }, pronto.fim ? 4000 : 2000);
            return;
        }
        if (cartao.atual && cartao.atual.id === 'pronto') { cartao.prox = novo; return; }   // deixa o "✓ Pronto" terminar
        cartao.atual = novo; desenhaCartao();
    }
    function desenhaCartao() {
        const c = cartao.atual;
        if (!c && !SR) return;
        const el = host().querySelector('.cartao');
        if (!c || tour.ativo || parado) { el.style.display = 'none'; return; }
        el.querySelector('.topo').textContent = c.topo;
        el.querySelector('.tit').textContent = c.titulo;
        el.querySelector('.dica').textContent = c.dica || '';
        el.querySelector('.dica').hidden = !c.dica;
        const ir = el.querySelector('[data-a="ir"]');
        ir.hidden = !c.botao;
        ir.textContent = c.botao ? c.botao.txt : '';
        ir.dataset.url = c.botao ? c.botao.url : '';
        el.querySelector('[data-a="depois"]').hidden = c.id === 'pronto';
        el.style.display = 'block';
    }
    const agendaCartao = ms => { clearTimeout(cartao.t); cartao.t = setTimeout(() => atualizaCartao().catch(() => {}), ms === undefined ? 800 : ms); };
    const CHAVES_GUIA = /^(shc:guia|shc:status|cfg|ml:conta)$|^(c\||ml:anuncios:|ml:full:|ml:promos:|vm\|ml\|)/;

    // ── Ligações: observador, navegação, storage ──
    const nosso = n => n.nodeType === 1 && (n.id === 'shc-host' || (typeof n.className === 'string' && /(^|\s)shc/.test(n.className)));
    function relevante(m) {
        const t = m.target;
        if (t && t.nodeType === 1 && t.closest && t.closest('.shc-w,.shcp-bar')) return false;
        for (const n of m.addedNodes) if (!nosso(n)) return true;
        for (const n of m.removedNodes) if (!nosso(n)) return true;
        return false;
    }
    // Faturador (/billing/invoiceissuer/fiscal-hub): lê o aviso do certificado digital (título + texto do .andes-message) e manda ao fundo,
    // 1 vez por aviso diferente. O fundo guarda só dias, data e se venceu (cert:<conta>).
    // Página carregada e, 10 s depois, sem aviso nenhum → {semAviso:true} (certificado renovado: o fundo tira o alerta). Se o aviso aparecer
    // depois, ele é mandado normalmente e volta a valer.
    let certEnviado = '', certT = 0, semAvisoT = 0;
    function avisoCertificado() {
        for (const el of document.querySelectorAll('.andes-message__title')) {
            const caixa = el.closest('.andes-message') || el.parentElement, corpo = caixa && caixa.querySelector('.andes-message__text');
            const msg = SHC.telaMsgCertificado(el.textContent, String((corpo || caixa || {}).textContent || '').slice(0, 2000));
            if (msg) return msg;
        }
        return null;
    }
    function confereCertificado() {
        if (parado || !vivo() || !SHC.telaEhFaturador(location.href)) return;
        const msg = avisoCertificado();
        if (msg) {
            const sig = msg.titulo + '|' + msg.texto;
            if (sig !== certEnviado) { certEnviado = sig; manda(comContaDaPagina(msg)); }
            return;
        }
        if (!certEnviado && !semAvisoT) semAvisoT = setTimeout(() => {
            if (parado || !vivo() || !SHC.telaEhFaturador(location.href) || document.readyState !== 'complete' || certEnviado || avisoCertificado()) { semAvisoT = 0; return; }
            certEnviado = 'sem aviso';
            manda(comContaDaPagina({ acao: 'certificado', semAviso: true }));   // sem a conta da página o fundo descarta (não apaga alerta de outra conta)
        }, 10000);
    }
    // A conta da página (estado do ML), quando a página tiver: o fundo confere se é a conta aberta no Copiloto.
    function comContaDaPagina(msg) { let c = null; try { const r = estadoDoScript(); c = r ? SHC.mlContaDoEstado(r) : null; } catch (e) { c = null; } return c ? Object.assign({}, msg, { conta: c }) : msg; }
    const agendaCert = () => { clearTimeout(certT); certT = setTimeout(confereCertificado, 800); };
    const obs = new MutationObserver(lista => {
        if (parado) return;
        if (SHC.telaEhFaturador(location.href)) agendaCert();
        for (const m of lista) if (relevante(m)) { agenda(250); return; }
    });
    function aoMudarStorage(mud, area) {
        if (area !== 'local' || parado) return;
        if (!vivo()) return parar();
        const ks = Object.keys(mud);
        if (ks.some(k => CHAVES_GUIA.test(k))) agendaCartao();
        let o = null;
        if (ks.some(k => k === 'cfg' || k.indexOf('c|') === 0)) o = 'custos';
        if (ks.some(k => k.indexOf('ml:anuncios:') === 0)) o = o ? 'tudo' : 'sku';
        if (ks.some(k => k.indexOf('fh|ml|') === 0)) o = o ? 'tudo' : 'fretes';
        // Saúde (fiscal:/fotos:/visitas:/medidas:): sem mudar a versão; a assinatura de cada linha diz qual redesenhar.
        if (ks.some(k => /^(fiscal|fotos|visitas|medidas):/.test(k))) { saudeC = null; if (!o) return agenda(1000); }
        if (!o) return;
        invalida(o);
        agenda(o === 'fretes' ? 400 : 100);
    }
    const aoNavegar = () => agenda(0);
    function parar() {
        if (parado) return;
        parado = true;
        geracao++;
        clearTimeout(timer); clearTimeout(cartao.t); clearTimeout(cartao.ate); clearTimeout(certT); clearTimeout(semAvisoT);
        try { obs.disconnect(); } catch (e) { /* ok */ }
        document.removeEventListener('mouseover', sobre, true);
        document.removeEventListener('mouseout', fora, true);
        document.removeEventListener('focusin', sobre, true);
        document.removeEventListener('focusout', fora, true);
        document.removeEventListener('mousedown', foraDoPop, true);
        removeEventListener('popstate', aoNavegar);
        try { chrome.storage.onChanged.removeListener(aoMudarStorage); } catch (e) { /* extensão recarregada */ }
        try { limpaPagina(); if (H) H.remove(); } catch (e) { /* ok */ }
    }

    document.addEventListener('mouseover', sobre, { capture: true, passive: true });
    document.addEventListener('mouseout', fora, { capture: true, passive: true });
    document.addEventListener('focusin', sobre, { capture: true, passive: true });
    document.addEventListener('focusout', fora, { capture: true, passive: true });
    addEventListener('popstate', aoNavegar);
    try { chrome.storage.onChanged.addListener(aoMudarStorage); } catch (e) { /* ok */ }
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
    agenda(0);
    agendaCartao(1500);
    agendaCert();
})(typeof globalThis !== 'undefined' ? globalThis : this);
