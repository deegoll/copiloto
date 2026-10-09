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
        if (/^\/vendas\/omni\/lista\/?$/.test(p)) return 'vendas';     // v3.1: lista de Vendas (lucro de cada venda)
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

    /** A linha de um anúncio na lista de Anúncios. Ao vivo 01/10/2026: o ML põe id="MLB…" só na linha principal, e ela CONTÉM as linhas
     *  de dentro (Clássico/Premium do mesmo produto, família aberta, "Ver mais"), que não têm id. Cada anúncio, principal ou de dentro, tem
     *  o seu bloco de colunas 'sll-list-grid-row--<número>' (preço, condições, "Você recebe"). Usar o bloco: a linha de dentro ganha a
     *  etiqueta dela e a principal não acha o "Você recebe" da de dentro. Sem o bloco (outro layout do ML), o id como antes. */
    SHC.telaLinhaAnuncio = function (doc, itemId) {
        const m = /^MLB(\d+)$/.exec(String(itemId || ''));
        return m ? doc.querySelector('.sll-list-grid-row--' + m[1]) || doc.getElementById(itemId) : null;
    };

    SHC.telaDataCurta = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? d.slice(8, 10) + '/' + d.slice(5, 7) : '';

    /** Etiqueta do anúncio (saída de SHC.sobraAnuncio) → { cls: luc|ate|pre|sem, st, vl }. Mesmas palavras da lateral (ESPEC item 10):
     *  "Dá lucro" · "Abaixo da meta" · "Prejuízo" + "R$ 152,97 · 25,5%" (negativo: "−R$ 5,28 · −5,9%"). */
    SHC.telaChip = function (s) {
        if (!s || s.sobra === null || s.sobra === undefined) return { cls: 'sem', st: '＋ Informar custo', vl: '' };
        const cls = s.classe === 'prejuizo' || s.sobra < 0 ? 'pre' : (s.classe === 'apertado' ? 'ate' : 'luc');
        return { cls, st: cls === 'pre' ? 'Prejuízo' : cls === 'ate' ? 'Abaixo da meta' : 'Dá lucro', vl: (s.sobra < 0 ? '−' : '') + moeda(Math.abs(s.sobra)) + ' · ' + pct(s.pct) };
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
        // Fotos: só quando falta foto ou o ML marcou alguma (anúncio com todas as fotos não ganha etiqueta: menos texto na linha).
        if (f && f.qtd > 0 && !(f.max && f.qtd >= f.max && !(f.problemas > 0))) out.push({ cls: 'fo', txt: f.max ? f.qtd + '/' + f.max + ' fotos' : SHC.qtd(f.qtd, 'foto', 'fotos'), extra: f.problemas > 0 ? f.problemas + ' com erro' : '',
            titulo: 'Fotos do anúncio', tip: 'A 1ª foto é a capa.' + (f.max ? ' O Mercado Livre aceita até ' + f.max + ' fotos.' : '')
                + (f.problemas > 0 ? ' O Mercado Livre marcou ' + SHC.qtd(f.problemas, 'foto', 'fotos') + ' deste anúncio: abra “Alterar anúncio” para ver.' : '') });
        if (x.fiscal && Array.isArray(x.fiscal.itens) && x.fiscal.itens.indexOf(itemId) >= 0) out.push({ cls: 'fi', txt: 'Sem dado fiscal', titulo: 'Sem dados fiscais',
            tip: 'Sem dados fiscais o ML não emite a NF-e desta venda. Corrija no Editor em massa.', link: SHC.FISCAL_EDITOR });
        const v = x.visitas && x.visitas.porItem && x.visitas.porItem[itemId], r = v ? SHC.radarVisitas(v.dias, x.hoje, x.cfg && x.cfg.radar_queda_pct) : null;
        if (r && r.classe !== 'poucos' && r.variacaoPct !== null) {
            const p = (r.variacaoPct > 0 ? '+' : r.variacaoPct < 0 ? '−' : '') + Math.round(Math.abs(r.variacaoPct)) + '%';
            out.push({ cls: r.classe === 'caindo' ? 'cai' : r.classe === 'subindo' ? 'sobe' : 'est', txt: 'Visitas ' + p, titulo: 'Visitas do anúncio (7 dias)',
                tip: 'Últimos 7 dias: ' + SHC.qtd(r.ult7, 'visita', 'visitas') + '. Nos 7 dias antes: ' + SHC.qtd(r.ant7, 'visita', 'visitas') + '.'
                    + (r.classe === 'caindo' ? ' No painel do Copiloto, aba Saúde, veja o que fazer.' : '') });
        }
        // Medidas da embalagem: diferente de outro anúncio do mesmo SKU (balão com as duas medidas) e mudança feita pelo ML nos últimos 30 dias.
        // Vermelho só para o anúncio que foge da medida de referência (e só quando a diferença pesa no frete); o da referência ganha a amarela.
        // O chip já diz QUAL anúncio está diferente ("Medida ≠ #4248981180", clicável: abre esse anúncio no ML); com 2 ou mais, a lista vai no balão.
        const g = (x.medDiv || []).find(d => d.anuncios.some(a => a.itemId === itemId));
        if (g) {
            const eu = g.anuncios.find(a => a.itemId === itemId), pesa = g.maiorDiferencaKg >= 0.01;
            const outros = eu.foge ? [g.referencia] : g.anuncios.filter(a => a.foge && a.itemId !== itemId);
            const um = outros.length === 1 ? outros[0] : null, num = id => String(id).replace(/^MLB/, '');
            out.push({ cls: eu.foge && pesa ? 'md' : 'mdr', txt: um ? 'Medida ≠ #' + num(um.itemId) : 'Medida ≠ ' + outros.length + ' anúncios', titulo: 'Medidas da embalagem',
                link: um && /^MLB\d+$/.test(um.itemId) ? 'https://produto.mercadolivre.com.br/MLB-' + num(um.itemId) : undefined,
                tip: 'Este anúncio: ' + SHC.medidaTxt(eu) + '. '
                    + (um ? 'Outro anúncio do SKU ' + g.sku + ' (' + um.itemId + '): ' + SHC.medidaTxt(um) + '. '
                        : 'Outros anúncios do SKU ' + g.sku + ' com medida diferente: ' + outros.map(a => a.itemId + ' (' + SHC.medidaTxt(a) + ')').join('; ') + '. ')
                    + (pesa ? 'Anúncios do mesmo produto com medidas diferentes podem pagar fretes diferentes; corrija para a medida certa.' : 'Mesmo peso considerado; só as medidas da caixa diferem.')
                    + (um ? ' Clique para abrir o ' + um.itemId + '.' : '') });
        }
        // v3.3: frete maior que o de outro anúncio do MESMO SKU na mesma faixa de preço (SHC.freteMesmoSku): quase sempre peso/medida errada.
        const gf = (x.freteDiv || []).find(g => g.fogem.some(a => a.itemId === itemId));
        if (gf) {
            const a = gf.fogem.find(y => y.itemId === itemId), ns = gf.normal.itemIds.slice(0, 3).map(id => '#' + String(id).replace(/^MLB/, '')).join(', ');
            out.push({ cls: 'md', txt: 'Frete +' + moeda(a.dif) + ' ≠ mesmo SKU', titulo: 'Frete acima do mesmo SKU',
                link: /^MLB\d+$/.test(itemId) ? 'https://produto.mercadolivre.com.br/MLB-' + itemId.replace(/^MLB/, '') : undefined,
                tip: 'Este anúncio paga ' + moeda(a.frete) + ' de frete por envio. Outros anúncios do SKU ' + gf.sku + ' na mesma faixa de preço (' + gf.faixaTxt + ') pagam '
                    + moeda(gf.normal.frete) + ' (' + ns + (gf.normal.itemIds.length > 3 ? ' e mais ' + (gf.normal.itemIds.length - 3) : '') + '). São ' + moeda(a.dif) + ' a mais por envio. '
                    + 'O ML cobra o frete pelo peso e pelas medidas da embalagem, não pelo Clássico/Premium. ' + a.medidaTxt + ' Detalhes no painel do Copiloto, aba Frete.' });
        }
        const mu = x.medidas && x.medidas.porItem && x.medidas.porItem[itemId] ? SHC.medidasMudadas(x.medidas.porItem, (x.agora || Date.now()) - 30 * 864e5, { itemId })[0] : null;
        if (mu) {
            const ml = mu.quem === 'ml', quando = SHC.medidasQuando(mu);
            out.push({ cls: 'mm', txt: (ml ? 'ML mudou a medida ' : 'Medida mudou ') + quando, titulo: ml ? 'O ML alterou as medidas' : 'A medida da embalagem mudou',
                tip: 'Antes: ' + SHC.medidaTxt(mu.antes) + '. Agora: ' + SHC.medidaTxt(mu.depois) + '. ' + (ml ? 'O' : 'Se não foi você, o') + ' texto do chamado está no painel do Copiloto, aba Saúde.' });
        }
        return out;
    };

    /**
     * v3.1: etiqueta do catálogo no anúncio que está PERDENDO (catcomp:<conta>.porItem[MLB], lida há até 7 dias na tela "Alterar anúncio").
     * → { l1: 'Perdendo p/ <loja>', l2: 'ganhar: R$ X', res: 'lucro R$ Y' | 'prejuízo R$ Y' | 'informe o custo' | '', resCls: ok|pr|'', titulo, tip } | null.
     * sg = sobra no preço para ganhar (SHC.sobraAtacado num degrau de 1 un.: mesma tarifa % e mesmo frete) | null (sem custo).
     * A lista do ML dizendo "ganhando" agora vale mais que a leitura antiga.
     */
    SHC.telaCatalogo = function (it, kc, sg, agora) {
        if (!kc || !/^perdendo/.test(String(kc.estado || '')) || kc.souVencedor || (it && it.competicao === 'ganhando')) return null;
        if (!(kc.ts > (agora || Date.now()) - 7 * 864e5)) return null;
        const v = kc.vencedor, pg = kc.precoGanhar, acoes = SHC.compCatAcoes ? SHC.compCatAcoes(kc, sg) : [];
        const semCusto = !sg || sg.sobra === null || sg.sobra === undefined;
        const res = !pg ? '' : semCusto ? 'informe o custo' : (sg.sobra >= 0 ? 'lucro ' : 'prejuízo ') + moeda(Math.abs(sg.sobra));
        const ALAV = { logistica: 'entrega melhor', parcelamento: 'Premium', frete: 'frete grátis' };
        const alav = acoes.find(a => ALAV[a.tipo]);
        // Baixar para o preço do ML dá prejuízo e há outra alavanca (entrega, Premium, frete): a etiqueta diz a alavanca, como o painel;
        // o preço com prejuízo fica só no balão.
        const naoCompensa = !!pg && !semCusto && sg.sobra < 0 && !!alav;
        const l2 = naoCompensa ? 'ganhar: ' + ALAV[alav.tipo] : pg ? 'ganhar: ' + moeda(pg).replace(' ', ' ') : alav ? 'ganhar: ' + ALAV[alav.tipo] : 'ver no painel';
        const tip = (v ? 'Quem ganha: ' + (v.loja || 'outra loja') + (v.preco ? ' a ' + moeda(v.preco) : '') + (v.logistica ? ' (' + v.logistica + ')' : '') + '. ' : '')
            + (kc.voce && kc.voce.preco ? 'Você: ' + moeda(kc.voce.preco) + (kc.voce.logistica ? ' (' + kc.voce.logistica + ')' : '') + '. ' : '')
            + (pg ? 'Preço para ganhar (do ML): ' + moeda(pg) + (semCusto ? '. Informe o custo para saber se ainda dá lucro. ' : ' → ' + res + ' por venda (estimativa: mesma tarifa % e mesmo frete). ') : '')
            + (kc.winRate !== null && kc.winRate !== undefined ? 'Suas visitas no catálogo (7 dias): ' + pct(kc.winRate) + '. ' : '')
            + (acoes.length ? 'O que fazer: ' + acoes.map((a, i) => (i + 1) + ') ' + a.txt).join(' ') + ' ' : '')
            + (kc.hist && kc.hist.length ? 'Lido em ' + SHC.telaDataCurta(kc.hist[kc.hist.length - 1].d) + '. ' : '') + 'Linha do tempo no painel do Copiloto, aba Catálogo.';
        return { l1: 'Perdendo p/ ' + (v && v.loja ? v.loja : 'outra loja'), l2, res: naoCompensa ? '' : res, resCls: naoCompensa || !pg || semCusto ? '' : sg.sobra >= 0 ? 'ok' : 'pr', titulo: 'Concorrência no catálogo', tip };
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

    /**
     * v3.2 Opções de compra do MESMO produto (Clássico e Premium do mesmo user product; cada linha com o preço, a promoção, a tarifa e o
     * frete DELA e o custo do SKU, herdado na linha de dentro) → { txt: 'Mesmo custo do SKU HA-14253: R$ 50,00 · Clássico dá R$ 22,57 ·
     * Premium dá R$ 19,22', linhas:[{itemId, tipo, custo, sobra}] } | null (menos de 2 linhas do mesmo user product). custoDe(item) → dados | null.
     */
    SHC.telaOpcoesCompra = function (it, itens, custoDe, cfg) {
        const upDe = x => String((x && (x.userProductId || (/^MLBU/.test(String(x.familia || '')) ? x.familia : ''))) || '');
        const up = upDe(it), vistos = new Set();
        if (!up) return null;
        const irmaos = (itens || []).filter(x => x && x.itemId && upDe(x) === up && !vistos.has(x.itemId) && vistos.add(x.itemId));
        if (irmaos.length < 2) return null;
        const linhas = irmaos.map(x => {
            const c = custoDe(x) || null, s = SHC.sobraAnuncio(x, c, cfg), tem = !!c && SHC.num(c.custo) > 0;
            return { itemId: x.itemId, tipo: x.tipo || x.itemId, custo: tem ? SHC.num(c.custo) : null, outros: tem ? SHC.num(c.outros) || 0 : 0,
                doAnuncio: tem && /^c\|ml\|/.test(String(c.chave || '')), sobra: s && s.sobra !== null ? s.sobra : null };
        });
        const rep = t => linhas.filter(l => l.tipo === t).length > 1, nome = l => (rep(l.tipo) ? l.tipo + ' #' + l.itemId.replace(/^MLB/, '') : l.tipo);
        const parte = l => nome(l) + (l.sobra !== null ? ' dá ' + (l.sobra < 0 ? '−' : '') + moeda(Math.abs(l.sobra)) : l.custo === null ? ': sem custo' : ': sem “Você recebe”');
        // "Mesmo custo" só quando TODAS as opções têm o mesmo custo e os mesmos outros custos; senão diz qual opção usa qual valor.
        const l0 = linhas[0], iguais = linhas.every(l => l.custo !== null && l.custo === l0.custo && l.outros === l0.outros);
        const usa = l => nome(l) + (l.custo === null ? ' sem custo' : ' usa ' + moeda(l.custo) + (l.doAnuncio ? ' do anúncio' : it.sku ? ' do SKU' : '')
            + (l.outros > 0 ? ' + ' + moeda(l.outros) + ' de outros custos' : ''));
        const ini = iguais ? 'Mesmo custo' + (it.sku ? ' do SKU ' + it.sku : '') + ': ' + moeda(l0.custo) + (l0.outros > 0 ? ' + ' + moeda(l0.outros) + ' de outros custos' : '')
            : linhas.some(l => l.custo !== null) ? 'Custo diferente entre as opções: ' + linhas.map(usa).join(', ') : 'Sem custo informado';
        return { txt: ini + ' · ' + linhas.map(parte).join(' · '), linhas };
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

    // SHC.telaPromosSemCalculo (caixas da Central sem a conta do ML) mudou para ml-extrator.js (F15): o fundo também usa e não carrega este arquivo.

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

    // Dinheiro escrito pelo ML. Visto ao vivo (29/09/2026, MLB1274479372): "R$ 251" redondo, SEM ",00" — comparar com moeda(v)
    // ("R$ 251,00") deixava a linha sem faixa. Aceita também "R$ 1.234,56", nbsp/espaço fino, "R$251" e os centavos numa folha à
    // parte (o DOM é lido com espaço entre as folhas: "R$ 251 05").
    const NUM_RS = '(\\d{1,3}(?:\\.\\d{3})+|\\d+)(?:\\s?,\\s?(\\d{1,2})|\\s(\\d{2}))?';
    const RE_RS = { todo: new RegExp('^[−-]?\\s?R\\$\\s?' + NUM_RS + '$'), fim: new RegExp('(?:^|\\s)[−-]?\\s?R\\$\\s?' + NUM_RS + '$'),
        faixa: new RegExp('^R\\$\\s?' + NUM_RS + '\\s(?:a|até|-|–)\\s(?:R\\$\\s?)?' + NUM_RS + '$'),
        // solto: centavos em folha à parte também ("R$ 251 05"); ponto final depois do valor vale; "R$ 251 10% OFF" não vira 251,10.
        solto: new RegExp('R\\$\\s?' + NUM_RS + '(?![\\d%])', 'g') };
    const rsDe = (m, i) => +m[i].replace(/\./g, '') + ((m[i + 1] || m[i + 2]) ? +(m[i + 1] || m[i + 2]).padEnd(2, '0') / 100 : 0);
    const txtRS = t => String(t === null || t === undefined ? '' : t).replace(/\s+/g, ' ').trim();
    const mesmoRS = (x, v) => v !== null && v !== undefined && isFinite(v) && Math.abs(x - Math.abs(v)) < 0.005;
    /** O texto do ML É o valor v ("R$ 251", "R$ 251,00"…)? noFim: o texto termina no valor ("A pagar R$ 27,05"). */
    SHC.telaEhValor = function (txt, v, noFim) {
        const m = (noFim ? RE_RS.fim : RE_RS.todo).exec(txtRS(txt));
        return !!m && mesmoRS(rsDe(m, 1), v);
    };
    /** O texto do ML tem o valor v em algum lugar ("Tarifa −R$ 41,39 … Você recebe R$ 251")? */
    SHC.telaTemValor = function (txt, v) {
        const re = new RegExp(RE_RS.solto.source, 'g'), t = txtRS(txt);
        for (let m = re.exec(t); m; m = re.exec(t)) if (mesmoRS(rsDe(m, 1), v)) return true;
        return false;
    };
    /** Faixa de valores do ML ("R$ 200 a R$ 251": família com Clássico e Premium / variações). */
    SHC.telaEhFaixaRS = txt => RE_RS.faixa.test(txtRS(txt));

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
    /**
     * v3.3 multi-empresa: de quem é a página aberta (estado do ML, r) × a conta aberta no Copiloto (ml:conta). → '' (a mesma, a página não diz
     * o dono ou o Copiloto ainda não leu conta nenhuma) | o id da OUTRA conta. A etiqueta confere ao montar a página E na hora de gravar.
     */
    SHC.telaOutraConta = async function (r) {
        let id = '', atual = '';
        try { const c = SHC.mlContaDoEstado(r); id = String((c && typeof c === 'object' ? c.sellerId : c) || ''); atual = String(await SHC.contaAtual()); } catch (e) { return ''; }
        return /^\d{6,15}$/.test(id) && atual && atual !== 'atual' && id !== atual ? id : '';
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

    // ── v3.1: lista de Vendas (/vendas/omni/lista) — "aqui tinha que mostrar se deu lucro ou não" (dona, 26/09/2026) ──
    // Estado Flox visto ao vivo em 26/09: 1 brick "row-<pack>_<pedido>" por venda, com identificationData {id "#<pedido>", date, shippingType}
    // e productData {price, quantity, products[] {label, price, quantity, sku "SKU: X", url com o MLB}}. Lê SÓ esses blocos (e o status, para
    // não somar venda cancelada): nome, apelido e endereço do comprador ficam em outros bricks e nunca são lidos. Nada é guardado.
    const txtF = v => typeof v === 'string' ? v : (v && typeof v === 'object' ? String(v.text || v.label || v.title || '') : '');
    const unF = v => { const x = parseInt(txtF(v).replace(/\D+/g, ''), 10); return x > 0 ? x : 1; };   // "1 unidade", "2 unidades"
    /** Estado da lista de Vendas → [{ pedido, idTxt, envio, preco, precoTxt, unidades, cancelada, produtos:[{itemId, sku, titulo, preco, qtd}] }] | null (sem estado Flox). */
    SHC.mlVendasDaLista = function (r) {
        const st = SHC.achaBrickStack ? SHC.achaBrickStack(r) : null;
        if (!st) return null;
        const b = st.brickStack, out = [];
        Object.keys(b).forEach(k => {
            const m = /^row-(?:(\d*)_)?(\d{6,})$/.exec(k), d = m && b[k] && b[k].data;
            if (!d || !d.productData) return;
            const idd = d.identificationData || {}, pd = d.productData;
            const lista = Array.isArray(pd.products) && pd.products.length ? pd.products : [pd];
            const produtos = lista.map(p => {
                const mm = /MLB-?(\d{6,14})/i.exec(String(p.url || ''));
                return { itemId: mm ? 'MLB' + mm[1] : '', sku: SHC.normalizaSku ? SHC.normalizaSku(txtF(p.sku)) : txtF(p.sku), titulo: txtF(p.label).slice(0, 120),
                    preco: SHC.valorRS(txtF(p.price)), qtd: unF(p.quantity) };
            });
            const stTxt = txtF((d.statusActionsData || {}).status), cancelada = /cancelad/i.test(stTxt);
            out.push({ pedido: m[2], pack: m[1] && m[1] !== m[2] ? m[1] : '', idTxt: txtF(idd.id).replace(/\D+/g, '') || m[2], envio: txtF(idd.shippingType), preco: SHC.valorRS(txtF(pd.price)), precoTxt: txtF(pd.price),
                unidades: unF(pd.quantity), cancelada, produtos,
                enviada: !cancelada && /entreg|a caminho|tr[aâ]nsito|saiu para|devolv|enviad/i.test(stTxt),   // v3.3: o aviso "frete ainda não confirmado" só antes do envio
                quando: txtF(idd.date).slice(0, 40) });   // v3.2: "24 set 20:27 hs" (dia da venda; o aviso de venda nova no prejuízo usa)
        });
        // v3.3: o Faturamento grava o frete com o nº do PACOTE (detalhe: "Venda #<pacote>"). Pacote com 2+ pedidos na página: o frete é do pacote
        // inteiro, então nenhum deles usa (fica estimado). ponytail: só olha esta página; um irmão em outra página não é visto.
        const nPack = {};
        out.forEach(v => { if (v.pack) nPack[v.pack] = (nPack[v.pack] || 0) + 1; });
        out.forEach(v => { if (v.pack && nPack[v.pack] > 1) v.pack = ''; });
        return out;
    };

    // v3.4: SHC.mlVendaDetalhe (detalhe da venda) foi para o ml-extrator.js: o Fechamento e o painel também conferem a tarifa nele.
    /** Linhas cob (Faturamento › cobranças) → { orderId: { venda (CVVML), mp (CVVPRC), parc (CVVFN) } }, estornos (B…) descontados. */
    SHC.cobPorPedido = function (linhas) {
        const out = {}, campo = { VVML: 'venda', VVPRC: 'mp', VVFN: 'parc' };
        (linhas || []).forEach(l => {
            const m = l && l.orderId && /\|([CB])(VVML|VVPRC|VVFN)$/.exec(String(l.id || ''));
            if (!m || !(+l.valor)) return;
            const o = out[l.orderId] || (out[l.orderId] = { venda: 0, mp: 0, parc: 0 });
            o[campo[m[2]]] = r2(o[campo[m[2]]] + (m[1] === 'B' ? -1 : 1) * Math.abs(+l.valor));
        });
        return out;
    };
    /**
     * Full: armazenagem (CFWA) + coleta (CFCBE) dos últimos 30 dias ÷ unidades vendidas pelo Full em 30 dias (ml:full produtos[].vendas30).
     * Essas cobranças não têm pedido: é rateio, sempre "estimado". → { un, custo, unidades } | null.
     */
    SHC.fullRateioUn = function (linhas, produtos, hoje, totalProdutos) {
        // Lista do Full lida só em parte (ex.: 60 de 77 produtos): menos unidades no divisor = rateio inflado. Sem rateio até ler tudo.
        if (totalProdutos > 0 && (produtos || []).length < totalProdutos) return null;
        const d = new Date((hoje || SHC.hoje()) + 'T12:00:00'); d.setDate(d.getDate() - 30);
        const desde = d.toISOString().slice(0, 10);
        const custo = r2((linhas || []).reduce((t, l) => {
            const m = l && /\|([CB])(FWA|FCBE)$/.exec(String(l.id || ''));
            return m && String(l.data || '') >= desde ? t + (m[1] === 'B' ? -1 : 1) * Math.abs(+l.valor || 0) : t;
        }, 0));
        const unidades = (produtos || []).reduce((t, p) => t + (+(p && p.vendas30) || 0), 0);
        return custo > 0 && unidades > 0 ? { un: r2(custo / unidades), custo, unidades } : null;
    };
    /** ACOS para a venda que veio de publicidade: o do anúncio (ads:<conta>.anuncios) ou, sem ele, o da conta → { pct, base } | null. */
    SHC.adsAcosDe = function (ads, itemId) {
        if (!ads) return null;
        const a = (ads.anuncios || []).find(x => x && x.itemId && x.itemId === itemId && x.acos > 0);
        if (a) return { pct: a.acos, base: 'ACOS do anúncio (' + pct(a.acos) + ')' };
        const t = ads.resumo && ads.resumo.total;
        return t && t.acos > 0 ? { pct: t.acos, base: 'ACOS da conta (' + pct(t.acos) + ')' } : null;
    };
    /**
     * Dados guardados da conta → (v, det) → o x de SHC.telaVendaConta. A etiqueta da tela e o aviso do fundo (SHC.vendasPrejuizo) usam
     * ESTE mesmo montador: tarifa real (cob), afiliado e Full iguais nos dois. g = { cobs:[cob:<conta>:<mês>], ads, afil (afil:<conta>), full (ml:full:<conta>), hoje }.
     */
    SHC.vendaExtras = function (g) {
        g = g || {};
        const cobL = [].concat(...(g.cobs || []).map(c => (c && c.linhas) || [])), cob = SHC.cobPorPedido(cobL);
        const afil = (g.afil && g.afil.pedidos && g.afil.pedidos.porPedido) || {};
        const full = g.full && g.full.temFull ? SHC.fullRateioUn(cobL, g.full.produtos, g.hoje, g.full.totalProdutos) : null;
        const acos = id => SHC.adsAcosDe(g.ads, id);
        // Afiliados: não se sabe ainda se saleDetail.orderId é o pedido ou o pacote (A CONFIRMAR ao vivo): procura pelos dois, como o frete.
        return (v, det) => ({ det: det || null, cob: cob[v.pedido] || null, acos, afil: afil[v.pedido] || (v.pack && afil[v.pack]) || null, full });
    };
    // A lista mostra o preço UNITÁRIO: "R$ 49,40 | 2 unidades" (print da dona, 01/10/2026, venda Full). Tratar como o total da venda dava
    // custo × 2 contra 1 preço só (2 unidades = "Prejuízo R$ 13,20"). Regra única: preço × qtd. (A heurística pelo preço de hoje do anúncio
    // errava depois de uma promoção: 49,40 → 70 tratava os 49,40 como o total.) Carrinho cujo preço por produto já é o da linha: ver abaixo.
    const valorDaLinha = (x, qtd) => (qtd > 1 && x > 0 ? r2(x * qtd) : x);
    SHC.FRETE_GRATIS_ML = SHC.FRETE_GRATIS_ML || 79;   // ML: frete grátis (pago pelo vendedor) a partir de R$ 79 — o mesmo limite de calc.js

    /**
     * Conta de 1 venda (v3.3). O detalhe da venda do ML, quando lido, é a verdade: preço, tarifa de venda total, frete e "Você recebe" (Total).
     * Sem ele: tarifa REAL pelas cobranças do pedido (cob: CVVML + CVVPRC + CVVFN, chegam no dia da venda) ou a mesma % do anúncio no retrato
     * (estimado); frete cobrado no Faturamento pelo pedido ou pelo pacote (frete:<conta>:pedidos), senão o de hoje do anúncio (estimado).
     * Líquido = você recebe − Ads (ACOS × venda, só venda por publicidade, estimado) − afiliado (comissão do pedido) − Full (rateio, estimado).
     * Lucro = líquido − imposto − custo × unidades − outros.
     * anuncio(MLB) → item do retrato | null; custoDe(produto) → dados do custo | null; pedidos = frete:<conta>:pedidos.pedidos;
     * x = { det (SHC.mlVendaDetalhe), cob ({venda, mp, parc} do pedido), acos(MLB) → {pct, base}, afil {c, fee, st}, full {un, custo, unidades} } (tudo opcional).
     * → null (sem base: anúncio fora do retrato e sem detalhe; valores que não fecham) | cancelada (ver SHC.telaVendaCancelada) | a conta
     *   (semCusto:[produto] quando falta custo: sobra null, o líquido continua valendo; freteFalta: o frete grátis passou a ser seu e o
     *   valor ainda não foi lido → a sobra é um TETO, "lucro até").
     */
    SHC.telaVendaConta = function (v, anuncio, custoDe, cfg, pedidos, x) {
        cfg = Object.assign({}, SHC.PADRAO, cfg || {});
        x = x || {};
        if (!v || !(v.produtos || []).length) return null;
        const packMulti = !!(x.det && x.det.pedidos > 1);
        let det = x.det && !packMulti && x.det.preco > 0 ? x.det : null;   // pacote com 2+ pedidos: o detalhe soma todos, não serve para esta linha
        // Frete do Faturamento pelo pedido ou pelo pacote; o do pacote não vale quando o detalhe já disse que o pacote tem 2+ pedidos.
        const fp = pedidos && (pedidos[v.pedido] || (v.pack && !packMulti && pedidos[v.pack]));
        if (v.cancelada || (det && det.cancelada)) return SHC.telaVendaCancelada(v, det, fp);
        const ps = v.produtos.filter(p => /^MLB\d+$/.test(p.itemId));
        if (ps.length !== v.produtos.length) return null;
        const its = ps.map(p => anuncio(p.itemId));
        const temRet = its.every(it => it && it.preco > 0 && typeof it.tarifa === 'number');
        if (!temRet && !det) return null;
        const soma = a => r2(a.reduce((t, n) => t + n, 0));
        let val, total;
        if (ps.length === 1) {
            total = det ? det.preco : valorDaLinha(v.preco > 0 ? v.preco : ps[0].preco, ps[0].qtd);
            val = [total];
        } else {
            val = ps.map(p => valorDaLinha(p.preco > 0 ? p.preco : 0, p.qtd));
            total = v.preco > 0 ? v.preco : soma(val);
            if (Math.abs(soma(val) - total) > 0.05) {           // o preço de cada produto pode ser o da linha (não o unitário)
                if (Math.abs(soma(ps.map(p => p.preco || 0)) - total) > 0.05) return null;
                val = ps.map(p => p.preco);
            }
            if (det && Math.abs(det.preco - total) > 0.05) det = null;
        }
        if (!(total > 0)) return null;
        const unidades = ps.reduce((t, p) => t + (p.qtd || 1), 0);
        const cs = ps.map(p => custoDe(p)), semCusto = ps.filter((p, i) => !(SHC.num((cs[i] || {}).custo) > 0));
        // Tarifa: detalhe (total real) > cobranças do pedido (real) > % do anúncio no retrato (estimado).
        const cob = x.cob && x.cob.venda > 0 ? x.cob : null, cobT = cob ? r2(cob.venda + cob.mp + cob.parc) : 0;
        let tarifa, tarifaFonte;
        if (det) { tarifa = det.tarifa; tarifaFonte = 'detalhe'; }
        else if (cob) { tarifa = cobT; tarifaFonte = 'cobrancas'; }
        else { tarifa = soma(ps.map((p, i) => val[i] * its[i].tarifa / its[i].preco)); tarifaFonte = 'estimado'; }
        const split = cob && Math.abs(cobT - tarifa) <= 0.05 ? { venda: cob.venda, mp: cob.mp, parc: cob.parc } : null;
        const tarifaPct = det && det.tarifaPct > 0 ? det.tarifaPct : r2(tarifa / total * 100);
        const itens = ps.map((p, i) => ({ itemId: p.itemId, sku: p.sku || (its[i] && its[i].sku) || '', qtd: p.qtd, valor: r2(val[i]), tarifa: r2(tarifa * val[i] / total),
            taxaPct: tarifaPct, tipo: (its[i] && its[i].tipo) || '', custoUn: SHC.num((cs[i] || {}).custo) || 0, outrosUn: SHC.num((cs[i] || {}).outros) || 0 }));
        // Frete: detalhe (já no dia da venda) > Faturamento pelo pedido ou pelo pacote > o de hoje do anúncio (estimado).
        let frete, taxaOp = 0, freteFonte, freteFalta = false;
        if (det) { frete = det.frete; freteFonte = 'detalhe'; }
        else if (fp && typeof fp.cobrado === 'number') { frete = fp.cancelado ? 0 : fp.cobrado; freteFonte = 'faturamento'; }
        else {
            freteFonte = 'estimado';
            frete = soma(ps.map((p, i) => its[i].freteComprador ? 0 : (its[i].frete || 0) * p.qtd));
            // "Comprador paga" no retrato vale para o preço UNITÁRIO abaixo de R$ 79. O pedido (2 × 49,40 = 98,80) passou de R$ 79: o frete grátis
            // é do vendedor e o retrato não diz quanto → frete a confirmar (o detalhe da venda traz o valor). ponytail: regra do ML pelo total do
            // pedido (como em calc.js/agenda-canal.js); confirmar ao vivo numa venda de 2+ unidades.
            freteFalta = total >= SHC.FRETE_GRATIS_ML && ps.some((p, i) => its[i].freteComprador && its[i].preco < SHC.FRETE_GRATIS_ML);
            taxaOp = freteFalta ? 0 : soma(ps.map((p, i) => its[i].freteComprador && SHC.num(its[i].taxaOperacional) > 0 ? SHC.num(its[i].taxaOperacional) * p.qtd : 0));
        }
        const recebe = det ? det.recebe : r2(total - tarifa - frete - taxaOp);
        const full = /full|fulfil/i.test(v.envio || '');
        const viaAds = !!(det && det.ads), ac = viaAds && x.acos ? x.acos(ps[0].itemId) : null;
        const ads = ac && ac.pct > 0 ? r2(total * ac.pct / 100) : 0;
        const af = x.afil && x.afil.c > 0 ? x.afil : null, afil = af ? r2(af.c) : 0;
        const fullV = full && x.full && x.full.un > 0 ? r2(x.full.un * unidades) : 0;
        const liquido = r2(recebe - ads - afil - fullV);
        const liqEst = tarifaFonte === 'estimado' || freteFonte === 'estimado' || ads > 0 || fullV > 0 || (afil > 0 && af.st !== 'confirmada');
        const impostoPct = SHC.num(cfg.imposto_pct) || 0, imposto = r2(total * impostoPct / 100);
        const custo = soma(itens.map(i => i.custoUn * i.qtd)), outros = soma(itens.map(i => i.outrosUn * i.qtd));
        const sobra = semCusto.length ? null : r2(liquido - custo - outros - imposto), pctV = sobra === null ? null : sobra / total * 100, alvo = SHC.num(cfg.margem_alvo_pct) || 0;
        return { total, unidades, tarifa, tarifaFonte, tarifaPct, split, frete, taxaOp, freteFonte, freteFalta, enviada: !!v.enviada, fretePagoComprador: det ? det.fretePagoComprador || 0 : 0,
            freteComprador: temRet && its.every(it => !!it.freteComprador), acrescimo: det ? det.acrescimo || 0 : 0, detalhe: !!det, full,
            recebe, viaAds, ads, adsBase: ac ? ac.base : '', afil, afilFee: af ? af.fee : null, afilSt: af ? af.st || '' : '', fullV, fullBase: fullV && x.full ? x.full : null,
            liquido, liqEst, custo, outros, impostoPct, imposto, sobra, pct: pctV, itens, semCusto: semCusto.length ? semCusto : null,
            classe: sobra === null ? 'semcusto' : sobra < 0 ? 'prejuizo' : freteFalta ? 'semfrete' : (pctV < alvo ? 'apertado' : 'lucrativo') };
    };
    const moNb = v => moeda(v).split('R$ ').join('R$ ');   // "R$" nunca quebra longe do número numa coluna estreita (só desenho; nada compara com o ML)
    /**
     * Venda cancelada → { cancelada, total, recebe, freteFica, sabe, detalhe, freteDet, unidades }. Antes do envio o ML devolve tudo (Total R$ 0,00).
     * Com o pacote já despachado o ML cobra o envio sem o desconto e NÃO devolve (fechamento.js: "sem_estorno"): o Total do detalhe fica
     * negativo e o Faturamento mostra o frete sem estorno. sabe = false: nem detalhe nem Faturamento ainda (nunca afirma que o frete voltou).
     */
    SHC.telaVendaCancelada = function (v, det, fp) {
        const ps = v.produtos || [];
        const total = det && det.preco > 0 ? det.preco : ps.length === 1 ? valorDaLinha(v.preco > 0 ? v.preco : ps[0].preco || 0, ps[0].qtd) : (v.preco > 0 ? v.preco : 0);
        let recebe = 0, sabe = false;
        if (det) { recebe = det.recebe; sabe = true; }
        else if (fp && typeof fp.cobrado === 'number') { recebe = fp.cancelado || !(fp.cobrado > 0) ? 0 : -r2(fp.cobrado); sabe = true; }
        return { cancelada: true, total, recebe, freteFica: recebe < 0 ? r2(-recebe) : 0, sabe, detalhe: !!det, freteDet: det ? det.frete : null, unidades: v.unidades || 1 };
    };
    /**
     * Linha da venda (v3.3, pedido da dona 01/10: "não precisa trazer como tag, só nas informações ao passar o mouse") →
     * { cls (luc|ate|pre|liq|can), st, vl, pc, nt, falta, txt, chips:[{t, v, d, est}], aria }. No texto do ML: "● {st} **{vl}** · {pc} · {nt}".
     * "● Lucro ≈ R$ 26,37 · 26,7%" | sem custo "● Recebe R$ 456,66 · sem custo" (falta = o link do custo) | "● Cancelada −R$ 75,65".
     * Textos curtos e fixos (nunca cortados no meio): na coluna estreita do ML (~80 px) o pc e o nt somem inteiros e o número desce para a 2ª linha.
     * chips: o que sai do Recebe (frete, Ads, afiliado, Full) — não vão para a tela (vivem no balão); só no aria-label e na assinatura.
     * "≈", "~" e "pendente" marcam o que não é número firme do ML — nunca só a cor.
     */
    SHC.telaChipVenda = function (c) {
        if (!c) return null;
        const L = o => Object.assign(o, { pc: o.pc || '', nt: o.nt || '', falta: !!o.falta, txt: o.st + ' ' + o.vl + (o.pc ? ' · ' + o.pc : '') + (o.nt ? ' · ' + o.nt : '') });
        if (c.cancelada) {   // rótulo curto ("Cancelada"): o motivo (frete não devolvido / devolvido) fica no balão e no aria
            if (c.freteFica > 0) return L({ cls: 'pre', st: 'Cancelada', vl: '−' + moNb(c.freteFica), chips: [],
                aria: 'Venda cancelada, mas o frete de ' + moeda(c.freteFica) + ' não foi devolvido.' });
            return L({ cls: 'can', st: 'Cancelada', vl: (c.sabe ? '' : '≈ ') + moNb(0), chips: [],
                aria: 'Venda cancelada. Você recebe ' + (c.sabe ? '' : 'cerca de ') + moeda(0) + '.' });
        }
        const rE = c.tarifaFonte === 'estimado' || c.freteFonte === 'estimado', rec = (rE ? '≈ ' : '') + moNb(c.recebe), chips = [], fr = r2(c.frete + c.taxaOp);
        if (c.freteFalta) chips.push({ t: 'Frete', v: '', d: 'por sua conta, falta o valor', est: 1 });
        else if (fr > 0) chips.push(c.freteFonte === 'estimado' ? { t: '− Frete', v: '~' + moNb(fr), est: 1 } : { t: c.full ? '− Frete Full' : '− Frete cobrado', v: moNb(c.frete) });
        if (c.viaAds) chips.push({ t: c.ads > 0 ? '− Ads' : 'Via Ads', v: c.ads > 0 ? '~' + moNb(c.ads) : '', est: 1 });
        if (c.afil > 0) { const conf = c.afilSt === 'confirmada'; chips.push({ t: '− Afiliado', v: moNb(c.afil), d: conf ? '' : 'pendente', est: conf ? 0 : 1 }); }
        if (c.fullV > 0) chips.push({ t: '− Armaz. Full', v: '~' + moNb(c.fullV), est: 1 });
        const resto = chips.map(k => [k.t, k.v, k.d].filter(Boolean).join(' ')).join('. ').replace(/− /g, 'menos ');
        const apos = [c.ads > 0 ? 'Ads' : '', c.afil > 0 ? 'afiliado' : '', c.fullV > 0 ? 'Full' : ''].filter(Boolean).join('/');
        if (c.sobra === null) {
            const lq = apos ? (c.liqEst ? '≈ ' : '') + moNb(c.liquido) : '';
            return L({ cls: 'liq', st: 'Recebe', vl: rec, nt: 'sem custo', falta: true, chips,
                aria: 'Você recebe ' + rec + (lq ? ', ' + lq + ' depois de ' + apos.replace(/\//g, ', ') : '') + '. Falta o custo para saber o lucro.' + (resto ? ' ' + resto + '.' : '') });
        }
        if (c.freteFalta && c.sobra >= 0) return L({ cls: 'liq', st: 'Lucro até', vl: moNb(c.sobra), nt: 'sem frete', chips,
            aria: 'Falta o frete: o pedido passou de R$ 79 e o frete grátis é seu. Lucro de até ' + moeda(c.sobra) + '.' + (resto ? ' ' + resto + '.' : '') });
        const cls = c.sobra < 0 ? 'pre' : (c.classe === 'apertado' ? 'ate' : 'luc'), st = cls === 'pre' ? 'Prejuízo' : 'Lucro';
        const vl = (c.liqEst ? '≈ ' : '') + (c.sobra < 0 ? '−' : '') + moNb(Math.abs(c.sobra)), pc = pct(c.pct);
        return L({ cls, st, vl, pc, chips, aria: (cls === 'ate' ? 'Lucro abaixo da meta' : st) + ': ' + vl + ' · ' + pc + '. Você recebe ' + rec + '.' + (resto ? ' ' + resto + '.' : '') });
    };
    /**
     * Conta linha a linha do balão da venda → [{ cls, rot, v (null = "—"), neg, o (r = ML, e = estimado, s = seu, '' = sem etiqueta) }].
     * Ordem: preço − tarifa − frete − parcelamento = você recebe − Ads − afiliado − Full = líquido − imposto − custo = lucro.
     */
    SHC.telaVendaLinhas = function (c) {
        const l = [], E = (cls, rot, v, neg, o) => l.push({ cls, rot, v: v === undefined ? null : v, neg: !!neg, o: o || '' });
        if (c.cancelada) {
            E('ml', 'Preço da venda' + (c.unidades > 1 ? ' (' + c.unidades + ' unidades)' : ''), c.total, 0, 'r');
            E('ml', 'Cancelamento: o preço volta ao comprador', c.total, 1, 'r');
            // Só diz "devolvidos" quando o detalhe (Total) ou o Faturamento mostram que voltou de fato.
            if (c.freteFica > 0) E('ml', !c.detalhe || Math.abs(c.freteFica - (c.freteDet || 0)) <= 0.05 ? 'Frete cobrado e não devolvido' : 'Cobranças não devolvidas (tarifa ou frete)', c.freteFica, 1, 'r');
            else E('nd', c.sabe ? 'Tarifa e frete: devolvidos' : 'Tarifa e frete: o Copiloto ainda não leu o detalhe desta venda', null);
            E('tot', '= Você recebe', Math.abs(c.recebe), c.recebe < 0, c.sabe ? 'r' : 'e');
            return l;
        }
        const tE = c.tarifaFonte === 'estimado', fE = c.freteFonte === 'estimado', tp = c.tarifaPct > 0 ? ' (' + pct(c.tarifaPct) + ')' : '';
        E('ml', 'Preço da venda' + (c.unidades > 1 ? ' (' + c.unidades + ' unidades)' : ''), c.total, 0, 'r');
        if (c.split) {
            E('ml', 'Tarifa de venda' + tp, r2(c.split.venda + c.split.mp), 1, 'r');
            E('ml sb', 'venda ' + moeda(c.split.venda) + ' · Mercado Pago ' + moeda(c.split.mp), null);
        } else E('ml' + (tE ? ' est' : ''), 'Tarifa de venda' + tp, c.tarifa, 1, tE ? 'e' : 'r');
        if (c.frete < 0) E('ml', 'Frete: o comprador pagou mais que a tarifa de envio', -c.frete, 0, 'r');
        else if (c.freteFalta) E('ml est', 'Frete: o pedido passou de R$ 79, o frete grátis é seu (valor ainda não lido)', null, 0, 'e');
        else if (fE && c.freteComprador && !(c.frete > 0)) E('ml est', 'Frete: por conta do comprador', 0, 1, 'e');
        else E('ml' + (fE ? ' est' : ''), c.full ? 'Frete Full deste pedido' : fE ? 'Frete (o de hoje do anúncio)' : 'Frete cobrado de você', c.frete, 1, fE ? 'e' : 'r');
        if (c.fretePagoComprador > 0 && c.frete > 0) E('ml sb', 'o comprador pagou ' + moeda(c.fretePagoComprador) + ' de ' + moeda(r2(c.frete + c.fretePagoComprador)), null);
        if (c.taxaOp > 0) E('ml est', 'Custo operacional do ML', c.taxaOp, 1, 'e');
        if (c.split && c.split.parc > 0) E('ml', 'Parcelamento sem juros (você oferece)', c.split.parc, 1, 'r');
        if (c.acrescimo > 0) E('ml', 'Parcelamento: acréscimo de ' + moeda(c.acrescimo) + ' pago pelo comprador', 0, 0, 'r');
        const rE = tE || fE;
        E('tot', '= Você recebe do ML' + (rE ? ' (estimado)' : ''), c.recebe, 0, rE ? 'e' : 'r');
        if (c.viaAds) E('ml est', 'Ads: venda por publicidade', c.ads > 0 ? c.ads : null, c.ads > 0, 'e');
        else if (c.detalhe) E('nd', 'Ads: não veio de publicidade', null);
        if (c.afil > 0) { const conf = c.afilSt === 'confirmada'; E('ml' + (conf ? '' : ' est'), 'Afiliado (' + [c.afilFee > 0 ? pct(c.afilFee) : '', c.afilSt].filter(Boolean).join(', ') + ')', c.afil, 1, conf ? 'r' : 'e'); }
        if (c.fullV > 0) E('ml est', 'Armazenagem Full (armazenagem e coleta, rateio)', c.fullV, 1, 'e');
        if (c.ads > 0 || c.afil > 0 || c.fullV > 0) E('tot', '= Líquido' + (c.liqEst ? ' (≈)' : ''), c.liquido, 0, c.liqEst ? 'e' : 'r');
        E('seu', 'Imposto (' + pct(c.impostoPct) + ' da venda)', c.imposto, 1, 's');
        c.itens.forEach(i => E('seu', 'Custo' + (i.sku ? ' do SKU ' + i.sku : ' do produto') + (i.qtd > 1 ? ' × ' + i.qtd : ''), i.custoUn > 0 ? r2(i.custoUn * i.qtd) : null, i.custoUn > 0, 's'));
        if (c.outros > 0) E('seu', 'Outros custos', c.outros, 1, 's');
        E('tot', c.sobra !== null && c.sobra < 0 ? '= Prejuízo' + (c.freteFalta ? ' (antes do frete)' : '') : c.freteFalta ? '= Lucro antes do frete' : '= Lucro', c.sobra === null ? null : Math.abs(c.sobra), 0, c.sobra === null ? '' : 's');
        return l;
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

    const hrefCarga = location.href, cargaEm = Date.now();
    let hrefAtual = location.href, geracao = 0, parado = false, pausado = false, falhasSeguidas = 0;
    let rodando = false, pendente = false, timer = 0, desde = 0;
    let estado = null;                         // { url, r, itens|promos }
    let cfgC = null, custosC = null, fretesC = null, skuC = null, skuRetC = null, versao = 0;
    let saudeC = null;                   // {fiscal, fotos, visitas} da conta (etiquetas de saúde); null = reler
    let vendasC = null;                  // lista de Vendas: { porId (retrato dos anúncios), pedidos (frete:<conta>:pedidos) }; null = reler
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
      .tip td.o{padding-left:10px}.tip .o span{display:inline-block;font-size:10px;font-weight:700;line-height:15px;padding:0 5px;border-radius:4px}
      .tip .o .r{background:#422006;color:#FDE68A}.tip .o .e{border:1px dashed #94A3B8;color:#CBD5E1}.tip .o .s{background:#172554;color:#93C5FD}
      .tip tr.sb td{font-size:11px;color:#94A3B8;padding-top:0}.tip tr.sb td:first-child{padding-left:12px}.tip tr.est td:nth-child(2){font-style:italic}.tip tr.nd td{color:#64748B}
      .tip .aviso{margin-top:8px;padding:6px 8px;border-radius:8px;background:#1E293B;color:#FDE68A;font-size:11.5px}
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
      .pausa button{margin-top:8px;background:#fff;color:#0F172A;border-color:#fff}
      .outra{position:fixed;right:16px;bottom:16px;display:none;max-width:340px;background:#7C2D12;color:#FFF7ED;border-radius:10px;padding:10px 12px;font-size:12.5px;line-height:1.45;box-shadow:0 10px 30px rgba(0,0,0,.35)}
      .outra button{margin-top:8px;background:#fff;color:#7C2D12;border-color:#fff}`;

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
            + '<div class="pausa" role="status"><div>Copiloto pausado nesta tela — o Mercado Livre mudou a página. Os números continuam no painel do Copiloto.</div><button type="button" data-a="tentar">Tentar de novo</button></div>'
            + '<div class="outra" role="status"><div class="t"></div><button type="button" data-a="outra-ok">Entendi</button></div>';
        tipEl = SR.querySelector('.tip');
        // Teclas e cliques dentro do host não vazam para os atalhos do ML.
        // 3.2.1: input/beforeinput também (o e.data do custo digitado não sobe para a página na fase de bolha; a captura a página ainda vê).
        ['keydown', 'keyup', 'keypress', 'click', 'mousedown', 'input', 'beforeinput'].forEach(t => SR.addEventListener(t, e => e.stopPropagation()));
        SR.addEventListener('click', e => {
            const a = e.target.closest && e.target.closest('[data-a]');
            if (!a) return;
            const acao = a.getAttribute('data-a');
            if (acao === 'salvar') salvaCusto();
            else if (acao === 'cancelar') fechaPop();
            else if (acao === 'pular') fimTour('pulou');
            else if (acao === 'proximo') passoTour(tour.i + 1);
            else if (acao === 'tentar') retomar();
            else if (acao === 'outra-ok') SR.querySelector('.outra').style.display = 'none';
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
        sr.querySelector('.q').textContent = item.skusVar
            ? 'Este anúncio tem variações com SKUs diferentes (' + item.skusVar.slice(0, 4).join(', ') + (item.skusVar.length > 4 ? '…' : '') + '): o custo fica só neste anúncio.'
            : item.sku
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
            // v3.3 multi-empresa (bloqueio 5): a conta da página é conferida de novo na hora de gravar — a conta do Copiloto pode ter trocado com
            // esta página aberta, e o custo iria para a empresa da conta nova (SHC.salvarCustoSku grava na empresa de ml:conta).
            const r = estado && estado.url === location.href ? estado.r : location.href === hrefCarga ? estadoDoScript() : null;
            if (r && await SHC.telaOutraConta(r)) { err.textContent = 'Esta página é de outra conta do Mercado Livre: o custo não foi salvo, para não misturar as empresas. Sincronize com esta conta aberta.'; return; }
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
    function comTip(el, f, semFoco) { el.setAttribute('data-shc-tip', '1'); if (!semFoco) el.tabIndex = 0; tips.set(el, f); return el; }
    function folhas(el) {
        return Array.prototype.filter.call(el.querySelectorAll('span,p,div,b,strong,a,label,small'),
            e => e.childElementCount === 0 && !(e.closest && e.closest('.shc-w,.shcp-bar')));
    }
    // Texto com espaço entre as folhas: "R$" + "251" + "05" em 3 spans → "R$ 251 05" (o textContent colaria "R$25105").
    function textoSep(e) {
        const tc = e.textContent || '';
        if (!e.childElementCount) return tc;
        let s = '';
        const tw = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
        for (let n = tw.nextNode(); n; n = tw.nextNode()) s += ' ' + n.nodeValue;
        return s;
    }
    // O elemento da linha cujo texto é o valor (teste), o último da linha e o mais de dentro (o "Você recebe" vem depois do preço).
    function achaValor(el, teste) {
        let achou = null;
        for (const e of el.querySelectorAll('*')) {
            const tc = e.textContent || '';
            if (tc.length > 40 || tc.indexOf('$') < 0 || !teste(textoSep(e)) || e.closest('.shc-w,.shcp-bar')) continue;
            achou = e;                            // ordem do documento: o de dentro vem depois do de fora
        }
        return achou;
    }
    // Sem o valor na linha: a faixa vai no FIM do bloco onde entrou na última linha achada (mesmo caminho de filhos a partir da
    // linha); sem referência ainda, no fim da célula do último valor em R$ da linha. Nunca some calado.
    let caminhoFaixa = null;
    const filhos = a => Array.prototype.filter.call(a.children, x => !x.classList.contains('shc-w'));
    function caminhoAte(de, ate) {
        const p = [];
        for (let a = ate; a && a !== de; a = a.parentElement) p.unshift(filhos(a.parentElement).indexOf(a));
        return p;
    }
    function fimDaCelula(el) {
        if (caminhoFaixa) {
            let a = el;
            for (const i of caminhoFaixa) { const f = filhos(a)[i]; if (!f) break; a = f; }
            return a;
        }
        const rs = folhas(el).filter(e => /R\$/.test(e.textContent || ''));
        let a = rs[rs.length - 1];
        if (!a) return el;
        while (a.parentElement && a.parentElement !== el) a = a.parentElement;
        return a;
    }
    const LEGENDA = '<div class="nota"><span style="color:#FDE68A">■</span> números do Mercado Livre &nbsp; <span style="color:#93C5FD">■</span> seus números</div>';
    const tr = (cls, rot, vals, neg) => '<tr class="' + cls + '"><td>' + esc(rot) + '</td>'
        + vals.map(v => '<td>' + (neg ? '− ' : '') + esc(typeof v === 'number' ? moeda(v) : v) + '</td>').join('') + '</tr>';
    const expl = ex => ex ? '<div class="exp">' + esc(ex.frase) + '</div><div class="nota">' + esc(ex.fonte) + '</div>' : '';

    // ── Anúncios ──
    // ctx (opcional): as outras opções de compra do mesmo produto na tela e o frete do mesmo SKU em outra faixa de preço (não é erro).
    function tipAnuncio(it, s, cfg, ctx) {
        const cDe = x => { const e = ctx.custos.get(x.itemId); return e && e.dados ? Object.assign({ chave: e.chave }, e.dados) : null; };
        const oc = ctx ? SHC.telaOpcoesCompra(it, ctx.itens, cDe, cfg) : null;
        // O custo pode vir do próprio anúncio (c|ml|…, na frente do SKU na linha de dentro): o rótulo diz de onde veio.
        const chC = ctx ? String((ctx.custos.get(it.itemId) || {}).chave || '') : '';
        const rotC = /^c\|ml\|/.test(chC) ? (chC === 'c|ml|' + it.itemId ? 'Custo deste anúncio' : 'Custo do anúncio ' + chC.slice(5)) : it.sku ? 'Custo do SKU ' + it.sku : 'Custo do produto';
        const of = ctx && SHC.freteOutraFaixa ? SHC.freteOutraFaixa(it, (ctx.saude && ctx.saude.retrato && ctx.saude.retrato.length ? ctx.saude.retrato : ctx.itens)) : [];
        const ofTxt = of.length ? 'Frete: outros anúncios do SKU ' + it.sku + ' pagam ' + of.map(o => moeda(o.frete) + ' (' + o.faixaTxt + ')').join(', ')
            + '. Este está na faixa ' + SHC.faixaFreteTxt(SHC.faixaFrete(it.preco)) + '. O ML cobra o frete pelo peso e pela faixa de preço: essa diferença vem do preço, não é erro.' : '';
        return '<h5>Resultado de 1 venda</h5><div class="sub">' + esc([it.itemId, it.sku ? 'SKU ' + it.sku : '', it.tipo].filter(Boolean).join(' · ')) + '</div>'
            + (oc ? '<div class="nota"><b>' + esc(oc.txt) + '</b></div>' : '') + '<table>'
            + SHC.telaAnuncioLinhas(it).map(l => tr(l.cls, l.rot, [l.v], l.neg)).join('')
            + tr('seu', rotC, [s.custo], 1)
            + (s.outros > 0 ? tr('seu', 'Outros custos', [s.outros], 1) : '')
            + tr('seu', 'Imposto (' + pct(SHC.num(cfg.imposto_pct) || 0) + ' do preço)', [s.imposto], 1)
            + tr('tot', s.sobra < 0 ? '= Prejuízo' : '= Sobra', [Math.abs(s.sobra)]) + '</table>'
            + '<div class="res ' + SHC.telaClasseRes(s.classe) + '">' + esc(SHC.telaResultado(s, cfg)) + '</div>'
            + simHtml(it)
            + expl(SHC.telaExplica('anuncio', { item: it, s }, cfg))
            + (ofTxt ? '<div class="nota">' + esc(ofTxt) + '</div>' : '')
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
    const ATACADO_QUEM = 'Só compradores com CNPJ validado pelo ML veem o preço de atacado.';
    // Degrau sem conta (sem custo, sem "Você recebe" único, sem tarifa) ou que não vale (acima do preço de hoje): o que falta, sem número inventado.
    function tipAtacadoSem(it, g, av) {
        return '<h5>Preço de atacado: a partir de ' + g.qtd + ' unidades</h5><div class="sub">Quem compra ' + g.qtd + ' ou mais paga ' + esc(moeda(g.preco)) + ' por unidade.</div>'
            + '<div class="exp">' + esc(av.txt) + '</div><div class="nota">' + esc(ATACADO_QUEM) + '</div>';
    }
    function tipAtacado(it, g, sa, cfg, av) {
        const ls = SHC.telaAtacadoLinhas(g, sa);
        const desc = sa.descontoPct > 0 ? ' (' + esc(pct(sa.descontoPct)) + ' de desconto sobre ' + esc(moeda(it.preco)) + (it.emPromocao ? ', o preço da promoção' : '') + ')' : '';
        return '<h5>Preço de atacado: a partir de ' + g.qtd + ' unidades</h5><div class="sub">Quem compra ' + g.qtd + ' ou mais paga ' + esc(moeda(g.preco))
            + ' por unidade' + desc + '.</div><table><tr><th></th><th>por unidade</th><th>pedido de ' + g.qtd + ' un.</th></tr>'
            + ls.map(l => tr(l.cls, l.rot, [l.un, l.ped], l.neg)).join('') + '</table>'
            + '<div class="res ' + SHC.telaClasseRes(sa.classe) + '">' + esc(SHC.telaResultado(sa, cfg)) + ' (estimativa)</div>'
            + (av ? '<div class="exp">' + esc(av.txt) + '</div>' : '')
            + simHtml(it, true)
            + expl(SHC.telaExplica('atacado', { degrau: g, s: sa }, cfg))
            + '<div class="nota">* ' + (sa.taxaReduzida ? 'Tarifa de ' + esc(pct(sa.taxaPct)) + ': a de hoje (' + esc(pct(sa.taxaHojePct))
                + ') vem reduzida pela promoção e o atacado não é promoção; vale a dos outros anúncios ' + esc(it.tipo || '') + ' do mesmo SKU.' : 'Mesma % de tarifa do preço atual.') + (sa.freteComprador ? ' Neste anúncio o comprador paga o frete; o ML cobra o custo operacional por unidade.'
                : ' ** Frete conservador: um envio por peça (o ML calcula o frete do atacado sobre o pedido inteiro; costuma sair menos).') + ' ' + ATACADO_QUEM + '</div>' + LEGENDA;
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

    // Onde entra a faixa do Copiloto: depois da LINHA do valor "Você recebe", nunca entre o valor e o ⓘ do ML (o ⓘ caía sozinho
    // embaixo das etiquetas). 1º a linha do ML (.sll-list-text-line, a mesma âncora do atacado); senão, sobe só por embrulhos do
    // próprio valor e pula os irmãos sem texto (ícones) que vêm logo depois; sem ícone nenhum, fica logo depois do valor (como antes).
    function depoisDoValor(alvo, cel) {
        const linha = alvo.closest && alvo.closest('.sll-list-text-line');
        if (linha && linha !== cel && cel.contains(linha)) return linha;
        const txt = norm(alvo.textContent), semTexto = e => e && !norm(e.textContent) && !(e.closest && e.closest('.shc-w'));
        for (let a = alvo; a && a !== cel; a = a.parentElement) {
            let ref = a;
            while (semTexto(ref.nextElementSibling)) ref = ref.nextElementSibling;
            if (ref !== a) {
                // valor + ⓘ numa linha flex sem quebra: a faixa vai depois da linha inteira (dentro dela seria espremida ao lado do ⓘ).
                // ponytail: heurística sem retrato da coluna no ML; se o ML trocar o DOM, o plano A (.sll-list-text-line) é o que vale.
                const P = ref.parentElement, cs = P && getComputedStyle(P);
                return P && P !== cel && P.parentElement !== cel && /flex/.test(cs.display) && cs.flexWrap === 'nowrap' ? P : ref;
            }
            const p = a.parentElement;
            if (!p || p === cel || p.childElementCount !== 1 || norm(p.textContent) !== txt) break;
        }
        return alvo;
    }

    function renderAnuncio(it, ctx) {
        const el = SHC.telaLinhaAnuncio(document, it.itemId);
        if (!el) return 'skip';
        const sd = SHC.telaSaude(it.itemId, ctx.saude);   // na assinatura: só a linha cujas etiquetas mudaram é redesenhada
        // v3.1: catálogo perdendo (catcomp:) → "Perdendo p/ <loja>" + "ganhar: R$ X · lucro/prejuízo" (sobra no preço para ganhar, como o atacado).
        const kc = ((ctx.saude && ctx.saude.catcomp && ctx.saude.catcomp.porItem) || {})[it.itemId], cK = kc && kc.precoGanhar ? ctx.custos.get(it.itemId) : null;
        // Os outros anúncios do mesmo SKU/tipo: a tarifa de outro preço não leva a redução da promoção (SHC.taxaTarifaFora).
        const lista = ctx.saude && ctx.saude.retrato && ctx.saude.retrato.length ? ctx.saude.retrato : ctx.itens;
        const cp = SHC.telaCatalogo(it, kc, kc && kc.precoGanhar ? SHC.sobraAtacado(it, { qtd: 1, preco: kc.precoGanhar }, cK && cK.dados, ctx.cfg, lista) : null);
        const sig = ctx.v0 + '|' + it.recebe + '|' + (degraus.has(it.itemId) ? 'd' : '') + '|' + sd.map(c => c.cls + c.txt + (c.extra || '')).join(',') + (cp ? '|' + cp.l1 + cp.l2 + cp.res : '');
        const st = linhas.get(it.itemId);
        if (st && st.completo && st.el === el && st.sig === sig && st.els.every(e => e.isConnected)) return 'ok';
        if (st) st.els.forEach(e => e.remove());
        linhas.delete(it.itemId);
        const fs = folhas(el);
        // "Você recebe": "R$ 251,00" ou "R$ 251" (redondo); família/variações vêm como faixa ("R$ 200 a R$ 251", recebe = null).
        const alvo = achaValor(el, it.recebe !== null ? t => SHC.telaEhValor(t, it.recebe) : SHC.telaEhFaixaRS);
        const els = [], c = ctx.custos.get(it.itemId), cfg = ctx.cfg;
        let completo = true;              // falhou alguma âncora (atacado/frete) → tenta de novo no próximo passe
        const s = SHC.sobraAnuncio(it, c && c.dados, cfg);
        const temCusto = !!(c && c.dados && SHC.num(c.dados.custo) > 0);
        const w = nossoW('div');
        w.classList.add('shc-an');           // uma faixa só: etiquetas lado a lado, quebrando na largura da coluna
        if (s && s.sobra !== null) {
            const ch = SHC.telaChip(s), b = mk('span', 'shc-r ' + ch.cls);
            b.appendChild(mk('span', 'st', ch.st));
            b.appendChild(mk('span', 'vl', ch.vl));
            b.setAttribute('data-shc-sim', it.itemId);
            w.appendChild(comTip(b, () => tipAnuncio(it, s, cfg, ctx)));
        } else if (!temCusto) {            // com custo e sem "Você recebe" (pausado, família): sem lucro na tela, nunca número inventado
            const bt = mk('button', 'shc-add', '＋ Informar custo');
            bt.type = 'button';
            // Variações com SKUs diferentes: um custo para o anúncio inteiro fica no anúncio (c|ml|MLB, que o lucro dele usa primeiro).
            const skusVar = Array.isArray(it.skus) && it.skus.length > 1 ? it.skus : null;
            bt.addEventListener('click', e => { e.preventDefault(); abrePop(bt, { sku: skusVar ? '' : it.sku, skusVar, chave: it.itemId, titulo: it.titulo }); });
            w.appendChild(bt);
        } else {                           // tem custo, mas o ML não deu um "Você recebe" único: etiqueta neutra, sem número
            const el = mk('span', 'shc-s', 'Lucro: não dá para saber');
            w.appendChild(comTip(el, () => '<h5>Lucro: não dá para saber</h5><div class="exp">O ML não mostra um "Você recebe" único nesta linha '
                + '(anúncio pausado, variações ou Clássico e Premium com valores diferentes). Sem ele, o Copiloto não calcula o lucro.</div>'));
        }
        // Saúde: fotos, dados fiscais (link para o Editor em massa), visitas e medidas (link para o outro anúncio), na mesma faixa do lucro.
        sd.forEach(c => {
            const el = mk(c.link ? 'a' : 'span', 'shc-s ' + c.cls, c.txt);
            if (c.extra) { el.appendChild(document.createTextNode(' · ')); el.appendChild(mk('b', '', c.extra)); }
            if (c.link) { el.href = c.link; el.target = '_blank'; el.rel = 'noopener'; }
            w.appendChild(comTip(el, () => '<h5>' + esc(c.titulo) + '</h5><div class="exp">' + esc(c.tip) + '</div>'));
        });
        if (cp) {
            const k = mk('span', 'shc-cp'), l2 = mk('span', 'l2', cp.l2);
            k.appendChild(mk('span', 'l1', cp.l1));
            if (cp.res) { l2.appendChild(document.createTextNode(' · ')); l2.appendChild(mk('b', cp.resCls, cp.res)); }
            k.appendChild(l2);
            w.appendChild(comTip(k, () => '<h5>' + esc(cp.titulo) + '</h5><div class="exp">' + esc(cp.tip) + '</div>'));
        }
        let res = 'ok';
        if (!w.childElementCount) {        // nada a mostrar (tem custo, sem "Você recebe" e sem aviso de saúde)
            linhas.set(it.itemId, { el, sig, els, completo: true });
            return alvo ? 'ok' : 'skip';
        }
        if (alvo) {
            const ref = depoisDoValor(alvo, el);
            caminhoFaixa = caminhoAte(el, ref.parentElement);
            ref.insertAdjacentElement('afterend', w);
        } else {
            // Valor não achado: a faixa vai no fim da célula e tenta de novo no próximo passe. Só conta como falha (pausa com ≥ 5 e
            // nenhum acerto) quando o ML deu um "Você recebe" único e ele não está na tela; pausado/sem valor/fora do retrato não pausa.
            const semRef = !caminhoFaixa;
            fimDaCelula(el).appendChild(w);
            if (it.recebe !== null) { res = 'falha'; completo = false; } else if (semRef) completo = false;
        }
        els.push(w);

        // Atacado: um chip por degrau, alinhado com a linha "preço de atacado" da coluna Preço. v3.2: também nas linhas de dentro e sem
        // custo — aí o chip diz o que falta (custo, "Você recebe" único, tarifa) ou que o degrau não vale (acima do preço de hoje).
        if (it.atacado) {
            const dg = degraus.get(it.itemId);
            if (!dg) pedeDegraus(it.itemId);
            else if (dg.length) {
                const pe = fs.find(e => /pre[çc]os? de atacado/i.test(e.textContent || ''));
                const linhaP = pe && pe.closest('.sll-list-text-line');
                let ref = linhaP && el.contains(linhaP) ? linhaP : (pe && pe.parentElement);
                if (!ref) completo = false;
                else dg.forEach(g => {
                    const sa = s && s.sobra !== null && c ? SHC.sobraAtacado(it, g, c.dados, cfg, lista) : null, av = SHC.atacadoAviso(it, g, s);
                    if (!sa && !av) return;
                    const box = nossoW('div'), at = mk('span', 'shc-at');
                    if (sa) {
                        const cls = sa.classe === 'prejuizo' ? 'pre' : (sa.classe === 'apertado' ? 'ate' : 'luc');
                        at.appendChild(document.createTextNode('≥ ' + g.qtd + ' un. · margem ' + pct(sa.pct)));
                        at.appendChild(mk('b', cls, (sa.sobra < 0 ? 'Prejuízo ' : 'Lucro ') + moeda(Math.abs(sa.sobra)) + '/un.'));
                        if (av) at.appendChild(mk('b', 'ate', av.curto));
                        at.setAttribute('data-shc-sim', it.itemId);
                        box.appendChild(comTip(at, () => tipAtacado(it, g, sa, cfg, av)));
                    } else {
                        at.appendChild(document.createTextNode('≥ ' + g.qtd + ' un. · ' + moeda(g.preco) + '/un.'));
                        at.appendChild(mk('b', av.revisar ? 'ate' : '', av.curto));
                        box.appendChild(comTip(at, () => tipAtacadoSem(it, g, av)));
                    }
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
                const i0 = fs.findIndex(e => /frete/i.test(e.textContent || ''));
                const fl = i0 < 0 ? null : fs.slice(i0).find(e => SHC.telaEhValor(e.textContent, it.frete, true));   // "R$ 27,05" ou "A pagar R$ 27"
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
        return res;
    }

    // ── Vendas: 1 etiqueta por venda, depois do valor da venda. A linha é achada pelo nº da venda ("#2000…" ou o link do detalhe);
    // sobe até o maior bloco que só tem essa venda. ponytail: sem retrato do DOM da lista de Vendas; se o ML mudar, a venda fica sem
    // etiqueta (nunca aviso de erro nem número inventado).
    const semEsp = s => String(s || '').replace(/\s+/g, '');
    function idsNaTela(quero) {
        const m = new Map();
        folhas(document.body).forEach(e => {
            const t = e.textContent || '';
            if (t.length > 60) return;
            const x = /(\d{10,})/.exec(t);
            if (x && quero.has(x[1]) && !m.has(x[1])) m.set(x[1], e);
        });
        quero.forEach(id => { if (!m.has(id)) { const a = document.querySelector('a[href*="/vendas/' + id + '/"]'); if (a) m.set(id, a); } });
        return m;
    }
    function linhaDaVenda(el, quero) {
        let a = el;
        while (a.parentElement && a.parentElement !== document.body) {
            const ns = new Set((a.parentElement.textContent || '').match(/\d{10,}/g) || []);
            let n = 0;
            ns.forEach(x => { if (quero.has(x)) n++; });
            if (n > 1) break;
            a = a.parentElement;
        }
        return a;
    }
    /** A menor caixa em volta do preço que também tem a quantidade ("R$ 49,40 | 2 unidades") | null (sem quantidade perto: plano de antes). */
    function linhaDoPreco(pe, row) {
        for (let a = pe; a && a !== row; a = a.parentElement) {
            const t = a.textContent || '';
            if (/\d{10,}/.test(t)) return null;    // subiu até o nº da venda: a linha inteira, longe demais
            if (/\bunidades?\b/i.test(t)) return a;
        }
        return null;
    }
    function precoDaVenda(row, v) {
        const alvo = semEsp(v.precoTxt);
        if (!alvo) return null;
        let achou = null;
        for (const e of row.querySelectorAll('*')) {
            if (semEsp(e.textContent) !== alvo || e.closest('.shc-w')) continue;
            if (!achou || achou.contains(e)) achou = e;
            else break;
        }
        return achou;
    }
    const ORIGEM = { r: '<span class="r">ML</span>', e: '<span class="e">estimado</span>', s: '<span class="s">seu</span>' };
    const trV = l => '<tr class="' + l.cls + '"><td>' + esc(l.rot) + '</td><td>' + (l.v === null ? (/\bsb\b/.test(l.cls) ? '' : '—') : (l.neg ? '− ' : '') + esc(moeda(l.v)))
        + '</td><td class="o">' + (ORIGEM[l.o] || '') + '</td></tr>';
    function tipVenda(v, c, cfg) {
        const sub = [c.unidades > 1 ? c.unidades + ' unidades' : '1 unidade', (c.itens || []).map(x => x.sku ? 'SKU ' + x.sku : x.itemId).join(', '),
            c.viaAds ? 'venda por publicidade' : '', c.afil > 0 ? 'venda por afiliado' : '', c.full ? 'Full' : ''].filter(Boolean).join(' · ');
        const cab = '<h5>Resultado desta venda</h5><div class="sub">' + esc(sub) + '</div><table>' + SHC.telaVendaLinhas(c).map(trV).join('') + '</table>';
        if (c.cancelada) return cab + (c.freteFica > 0
            ? '<div class="res pr">Cancelada, mas o ML ficou com ' + esc(moeda(c.freteFica)) + ': entra como custo do mês.</div><div class="nota">Quando o pacote já tinha saído, o ML cobra o envio sem o desconto e não devolve. '
                + 'Se o cancelamento não foi por sua causa (extravio, não entregue), vale pedir a revisão: confira no detalhe da venda.</div>'
            : '<div class="res sc">Cancelada: não entra no lucro do mês.</div>' + (c.sabe ? '' : '<div class="nota">O Copiloto ainda não leu o detalhe desta venda: se o pacote já tinha saído, o frete pode não voltar.</div>'));
        const p0 = c.semCusto && c.semCusto[0];
        const res = c.sobra === null ? '<div class="res sc">Falta o custo ' + esc(p0 && p0.sku ? 'do SKU ' + p0.sku : 'do produto') + ' para saber o lucro. O que você recebe já está acima.</div>'
            : c.freteFalta && c.sobra >= 0 ? '<div class="res sc">Lucro de até ' + esc(moeda(c.sobra)) + ', antes do frete: o pedido passou de R$ 79 e o frete grátis é seu.</div>'
            : '<div class="res ' + SHC.telaClasseRes(c.classe) + '">' + esc(SHC.telaResultado(c, cfg)) + (c.liqEst ? ' (≈)' : '') + '</div>';
        const n = c.sobra === null && c.semCusto ? ['<div class="nota">Clique na linha (ou Enter) para informar o custo.</div>'] : [];
        // Aviso do frete: só quando o detalhe falhou (dizer isso, sem prometer) ou antes do envio com frete a pagar. Venda já entregue com
        // "frete por conta do comprador R$ 0,00" não ganha aviso (a promessa "lê em seguida" não se cumpria quando o detalhe falhava).
        if (c.freteFonte === 'estimado' && detFalhou.has(v.pedido)) n.push('<div class="aviso">Não deu para ler o detalhe desta venda no ML: o frete' + (c.tarifaFonte === 'estimado' ? ' e a tarifa ficam' : ' fica') + ' estimado' + (c.tarifaFonte === 'estimado' ? 's' : '') + '.</div>');
        else if (c.freteFonte === 'estimado' && !c.enviada && (c.frete + c.taxaOp > 0 || c.freteFalta)) n.push('<div class="aviso">Frete ainda não confirmado: o Copiloto está lendo o detalhe desta venda no ML.</div>');
        if (c.tarifaFonte === 'estimado') n.push('<div class="nota">~ Tarifa: a mesma % que o ML cobra hoje neste anúncio (lista de Anúncios).</div>');
        if (c.viaAds) n.push('<div class="nota">~ Ads: ' + esc(c.adsBase ? c.adsBase + ' × valor da venda' : 'sem ACOS lido ainda (abra Ads no painel)') + '. O ML não diz quanto custou esta venda.</div>');
        if (c.afil > 0) n.push('<div class="nota">Afiliado: comissão deste pedido no painel de Afiliados do ML' + (c.afilSt ? ' (' + esc(c.afilSt) + ')' : '') + '.</div>');
        if (c.fullBase) n.push('<div class="nota">~ Full: armazenagem e coleta dos últimos 30 dias (' + esc(moeda(c.fullBase.custo)) + ') ÷ ' + c.fullBase.unidades + ' unidades vendidas pelo Full. Essas cobranças não vêm por pedido.</div>');
        if (c.split && c.split.parc > 0) n.push('<div class="nota">O ML mostra a tarifa e o parcelamento juntos: Tarifa de venda total ' + esc(moeda(c.tarifa)) + '.</div>');
        if (c.detalhe) n.push('<div class="nota">Números do ML lidos no detalhe desta venda.</div>');
        else if (c.tarifaFonte === 'cobrancas') n.push('<div class="nota">Tarifa lida nas cobranças deste pedido (Faturamento do ML).</div>');
        return cab + res + n.join('');
    }
    function renderVenda(x, ctx) {
        const v = x.v, c = x.c;
        if (!c) return 'skip';                      // sem base (anúncio fora do retrato e sem detalhe): sem etiqueta
        const idEl = ctx.idEls.get(v.idTxt);
        if (!idEl) return 'skip';
        const row = linhaDaVenda(idEl, ctx.quero), ch = SHC.telaChipVenda(c), chave = 'v' + v.pedido;
        if (!c.detalhe) pedeDetalhe(v, naVista(row));   // cancelada também: o Total do detalhe diz se o frete voltou
        const sig = ctx.v0 + '|' + ch.cls + ch.txt + ch.chips.map(k => k.t + k.v).join(','), st = linhas.get(chave);
        if (st && st.el === row && st.sig === sig && st.els.every(e => e.isConnected)) return 'ok';
        if (st) st.els.forEach(e => e.remove());
        // Uma linha só, no texto do ML: "● Lucro ≈ R$ 26,37 · 26,7%". Frete, Ads, Full, afiliado, imposto e custo ficam no balão (mouse ou Tab).
        const w = nossoW('div'), tip = () => tipVenda(v, c, ctx.cfg);
        w.classList.add('shc-vd');
        // Nada corta no meio: "● Lucro ≈" + [número · % · sem custo]. Coluna estreita (~80 px no ML): o grupo desce para a 2ª linha e o
        // que não cabe ao lado do número (%, "sem custo") some inteiro (2ª linha escondida do .shc-vx). Máximo 2 linhas; o balão mostra tudo.
        const b = mk('span', 'shc-vl ' + ch.cls), est = /^≈/.test(ch.vl), nx = mk('span', 'shc-vx');
        b.appendChild(mk('span', 'shc-vr', ch.st));   // classes com prefixo: ".st"/".nt" genéricas pegavam estilo da página
        if (est) b.appendChild(mk('span', 'shc-va', '≈'));   // item próprio: fica com o rótulo ("Lucro ≈") ou desce com o número ("Cancelada" / "≈ R$ 0,00")
        nx.appendChild(mk('b', '', ch.vl.replace(/^≈\s*/, '')));
        if (ch.pc) nx.appendChild(mk('span', 'shc-vp', ch.pc));             // o "· " vem do CSS (::before)
        if (ch.nt) {
            if (ch.falta && c.semCusto) {           // "sem custo": link que abre o campo do custo (sem botão grande)
                const p = c.semCusto[0], bt = mk('button', 'shc-lk', ch.nt), abre = e => { e.preventDefault(); abrePop(bt, { sku: p.sku, chave: p.itemId, titulo: p.titulo }); };
                bt.type = 'button';
                nx.appendChild(bt);
                // Coluna estreita esconde o link: a linha inteira abre o campo do custo (clique, ou Enter com a linha em foco).
                b.classList.add('ck');
                b.addEventListener('click', abre);
                b.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === b) abre(e); });
            } else nx.appendChild(mk('span', 'shc-vp', ch.nt));
        }
        b.appendChild(nx);
        b.setAttribute('role', 'group');
        b.setAttribute('aria-label', ch.aria);
        w.appendChild(comTip(b, tip));
        // Depois da linha inteira "R$ 49,40 | 2 unidades": entre o preço e a quantidade, o lucro de 2 unidades parecia o de 1.
        const pe = precoDaVenda(row, v);
        (linhaDoPreco(pe, row) || depoisDoValor(pe || idEl, row)).insertAdjacentElement('afterend', w);
        linhas.set(chave, { el: row, sig, els: [w] });
        return 'ok';
    }
    // Detalhe da venda: 1 GET same-origin por venda que está na tela (as que estão à vista primeiro), espaçados, 1 nova tentativa quando o HTML
    // vem sem o estado (2 de 32 leituras ao vivo). Cache por pedido enquanto a aba vive; só relê se a lista passar a dizer "cancelada".
    // Só os valores ficam (SHC.mlVendaDetalhe); nada é guardado nem vai para o fundo.
    const detC = new Map(), detPedido = new Set(), filaDet = [], detFalhou = new Set();
    let detRodando = false;
    function pedeDetalhe(v, frente) {
        const k = v.pedido + (v.cancelada ? '|c' : '');
        if (detPedido.has(k) || (detC.has(v.pedido) && !v.cancelada) || !/^\d{6,}$/.test(v.pedido)) return;
        detPedido.add(k);
        if (frente) filaDet.unshift(v.pedido); else filaDet.push(v.pedido);
        rodaDet();
    }
    async function rodaDet() {
        if (detRodando) return;
        detRodando = true;
        const espera = ms => new Promise(ok => setTimeout(ok, ms));
        while (filaDet.length && !parado) {
            const p = filaDet.shift();
            let d = null;
            for (let t = 0; t < 2 && !d && !parado; t++) {
                try {
                    const r = await fetch('/vendas/' + p + '/detalhe', { credentials: 'include' });
                    if (r.ok) { const e = SHC.mlExtraiEstado(await r.text()); d = e ? SHC.mlVendaDetalhe(e) : null; }
                } catch (e) { /* sem detalhe: a etiqueta fica com o que já tem */ }
                if (!d) await espera(800);
            }
            if (d) { detC.set(p, d); detFalhou.delete(p); agenda(300); } else if (!parado) detFalhou.add(p);
            await espera(600);
        }
        detRodando = false;
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
            let dg = [], lido = false;
            try {
                const r = await fetch('/anuncios/api/listing/tooltip?type=tiered_pricing&documentId=' + encodeURIComponent(id), { credentials: 'include', headers: { accept: 'application/json' } });
                if (r.ok) { dg = SHC.mlAtacadoDoTooltip(await r.json()); lido = true; } else lido = r.status === 424;   // 424 = anúncio sem atacado
            } catch (e) { /* sem degraus */ }
            if (g !== geracao) break;
            if (lido && estado && estado.r) manda(SHC.telaMsgPagina('atacado_degraus', estado.r, { itemId: id, degraus: dg }));   // v3.2: os degraus vão para o retrato (painel › detalhe do anúncio)
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
            const p = l.p;                   // preço e "você recebe" como o ML escreve: "R$ 318" ou "R$ 318,00"
            const cand = fs.filter(e => !usados.has(e) && SHC.telaEhValor(e.textContent, p.preco) && e.closest('.sc-list-row'));
            const alvo = cand.find(e => SHC.telaTemValor(textoSep(e.closest('.sc-list-row')), p.recebe))
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
        if (Date.now() - t < 30000) return undefined;   // cedo demais (≠ null: buscou e não veio)
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
    // v3.2 (leitura completa): famílias fechadas e "Ver mais N opções de venda" desta página → o MESMO GET do botão "Expandir anúncios"
    // (SHC.mlUrlAbrir, só GET, uma de cada vez com 1,2 s entre elas). Os anúncios de dentro vão para o retrato da conta e ganham etiqueta
    // quando a seller abre a família. 1 vez por página (URL).
    const abertasEm = new Map();   // URL → anúncios de dentro já lidos (voltam para o estado quando a página é buscada de novo)
    async function abreFamilias(r, url) {
        const fams = SHC.mlParaAbrir ? SHC.mlParaAbrir(r).slice(0, 30) : [];
        if (!fams.length || abertasEm.has(url)) return;
        const itens = [], familias = [], lidoEm = Date.now();
        abertasEm.set(url, itens);
        // Família com mais de 50 anúncios: pede as páginas seguintes (até 5, como a sincronização). A seller saiu da página no meio:
        // manda o que leu e libera a URL para ler de novo quando ela voltar.
        fora: for (const x of fams) {
            const ids = new Set();
            for (let p = 1; p <= 5; p++) {
                await new Promise(ok => setTimeout(ok, 1200));
                if (parado || location.href !== url) { abertasEm.delete(url); break fora; }
                let j = null;
                try { const resp = await fetch(SHC.mlUrlAbrir(x.id, p), { method: 'GET', credentials: 'include', cache: 'no-store', headers: { accept: 'application/json' } }); j = resp.ok ? await resp.json() : null; } catch (e) { j = null; }
                if (!j || !Array.isArray(j.documentGroup)) break;
                const its = SHC.mlAnunciosDaFamilia(j, x).filter(i => i.itemId), novos = its.filter(i => !ids.has(i.itemId));
                its.forEach(i => ids.add(i.itemId));
                itens.push(...its);
                if (estado && estado.url === url && estado.porId) its.forEach(i => { const ja = estado.porId.get(i.itemId); estado.porId.set(i.itemId, ja ? SHC.juntaMesmoAnuncio(ja, i) : i); });
                if (!novos.length || ids.size >= (+x.esperado || 0) || !j.documentGroup.length) break;
            }
            if (ids.size) familias.push(Object.assign({}, x, { itens: [...ids] }));   // pela metade: o retrato junta com a lista antiga (SHC.mesclaAnuncios)
        }
        if (!itens.length) return;
        if (estado && estado.url === url && estado.porId) { estado.itens = [...estado.porId.values()]; agenda(0); }
        manda(SHC.telaMsgPagina('anuncios_pagina', r, { url, itens, familias, lidoEm }));
    }
    // lidoEm = quando o estado foi lido: o embutido na página é do CARREGAMENTO (navegar dentro da página não o atualiza); o buscado é de agora.
    // Vai junto para o fundo: leitura mais velha que o retrato não entra (evita "Saiu da promoção" falso vindo de aba antiga).
    function usaEstado(tela, r, lidoEm) {
        if (lidoEm === undefined) lidoEm = Date.now();
        if (tela === 'anuncios') {
            const itens = SHC.mlAnunciosDoEstado(r), porId = new Map();
            // Mesmo id repetido (linha da família e de dentro, variação aberta): fica a 1ª com preço, com os SKUs das duas (SHC.juntaMesmoAnuncio).
            itens.concat(abertasEm.get(location.href) || []).forEach(i => {
                const ja = porId.get(i.itemId);
                porId.set(i.itemId, !ja ? i : SHC.juntaMesmoAnuncio ? SHC.juntaMesmoAnuncio(ja, i) : (i.preco !== null && ja.preco === null ? i : ja));
            });
            estado = { url: location.href, tela, r, itens: [...porId.values()], porId };
            custosC = null; fretesC = null;
            if (itens.length) manda(SHC.telaMsgPagina('anuncios_pagina', r, { url: location.href, itens, lidoEm }));
            abreFamilias(r, location.href).catch(() => {});
        } else if (tela === 'vendas') {
            estado = { url: location.href, tela, r, vendas: SHC.mlVendasDaLista(r) || [] };   // nada vai para o fundo: nada da venda é guardado
            custosC = null;
        } else {
            estado = { url: location.href, tela, r, promos: SHC.mlPromosDoEstado(r), semCalc: SHC.telaPromosSemCalculo(r) };
            custosC = null;
        }
    }
    async function garanteEstado(tela) {
        if (estado && estado.url === location.href && estado.tela === tela) {
            if (!estado.reconferir) return true;
            if (!(await mesmaConta(estado.r))) return false;   // a conta do Copiloto trocou e a página é de outra: sem etiqueta, com o aviso
            estado.reconferir = false;
            return true;
        }
        let r = location.href === hrefCarga ? estadoDoScript() : null, lidoEm;
        if (r) lidoEm = Math.round((typeof performance !== 'undefined' && performance.timeOrigin) || cargaEm);
        else r = await buscaEstado();
        if (!r) return false;
        if (!(await mesmaConta(r))) return false;   // v3.3: página de outra empresa não ganha os números desta
        usaEstado(tela, r, lidoEm);
        return true;
    }
    // v3.3 (multi-empresa, auditoria 07/10/2026): com o login do ML trocado, a página era de uma empresa e as etiquetas (custo, lucro, frete,
    // alertas) eram de outra. Página de OUTRA conta (o dono que ela diz ≠ ml:conta) não ganha etiqueta nenhuma e avisa 1 vez por página.
    // Página que não diz o dono, ou Copiloto que ainda não leu conta nenhuma: segue como antes.
    // Bloqueio 5: a conta conferida vale até a conta do Copiloto (ml:conta) mudar (aoMudarStorage zera o estado) e o aviso some quando volta a bater.
    let avisoConta = '';
    async function mesmaConta(r) {
        const id = await SHC.telaOutraConta(r);
        if (!id) { if (SR) SR.querySelector('.outra').style.display = 'none'; return true; }
        if (avisoConta !== location.href) {
            avisoConta = location.href;
            const sr = host(), el = sr.querySelector('.outra'), atual = String(await SHC.contaAtual());
            el.querySelector('.t').textContent = 'Esta página é de outra conta do Mercado Livre (final ' + id.slice(-4) + '). Os números do Copiloto são da conta final '
                + atual.slice(-4) + ': não mostro aqui para não misturar as empresas. Sincronize com esta conta aberta para ver os números dela.';
            el.style.display = 'block';
        }
        return false;
    }
    // A tela mostra MLB que não está nos dados (troca de página/busca sem recarregar) → busca de novo.
    const semSolucao = new Set();              // URL em que buscar de novo não trouxe os MLB da tela
    const mlbFaltando = () => Array.prototype.filter.call(document.querySelectorAll('[id^="MLB"]'), e => /^MLB\d+$/.test(e.id) && !estado.porId.has(e.id));
    async function confereAnunciosNovos() {
        const url = location.href;
        if (semSolucao.has(url) || !mlbFaltando().length) return;
        const r = await buscaEstado();
        if (SHC.telaDe(location.href) !== 'anuncios' || location.href !== url) return;
        if (r === null) { semSolucao.add(url); return agenda(0); }   // buscou e não veio: as linhas faltando ganham a faixa só da tela
        if (!r || !(await mesmaConta(r))) return;
        usaEstado('anuncios', r);
        if (mlbFaltando().length) semSolucao.add(url);   // não insiste: no máx. 1 busca extra por URL
        agenda(0);
    }

    function invalida(o) {
        versao++;
        if (o === 'custos' || o === 'tudo') { custosC = null; cfgC = null; }
        if (o === 'fretes' || o === 'tudo') fretesC = null;
        if (o === 'sku' || o === 'tudo') { skuC = null; skuRetC = null; custosC = null; saudeC = null; vendasC = null; }   // saudeC: SKUs com medidas diferentes vêm do retrato
    }
    async function cfgAtual() { if (!cfgC) cfgC = await SHC.lerCfg(); return cfgC; }

    async function ctxAnuncios() {
        if (!(await garanteEstado('anuncios'))) return null;
        // Todas as linhas ganham faixa: também as sem preço/"Você recebe" (pausada, família com faixa de valores) e, se buscar de novo
        // não trouxe o anúncio (confereAnunciosNovos), a linha só da tela (SKU lido da própria linha) — sem lucro, só "＋ Informar custo".
        // SKU que a linha não mostra (anúncio com variações, linha de dentro): o MESMO SKU completado que o painel usa — o do retrato da
        // conta, que o fundo completa com as vendas por anúncio e o Full (SHC.completaSkus). Sem isso a página dizia "sem SKU" e o custo
        // digitado aqui ia para o anúncio enquanto o painel já mostrava o anúncio na linha do SKU.
        if (!skuRetC) {
            skuRetC = new Map();
            try { const snap = await SHC.lerAnuncios(); ((snap && snap.itens) || []).forEach(i => { if (i && i.itemId && i.sku) skuRetC.set(i.itemId, i); }); } catch (e) { /* sem retrato */ }
        }
        const itens = estado.itens.map(i => {
            const r = !i.sku && i.skuForaDaLinha && skuRetC.get(i.itemId);
            return r ? Object.assign({}, i, { sku: r.sku, skus: (Array.isArray(r.skus) && r.skus.length ? r.skus : [r.sku]).slice(), skuFonte: r.skuFonte || 'leitura anterior' }) : i;
        });
        if (semSolucao.has(location.href)) mlbFaltando().forEach(e => {
            const f = folhas(e).map(x => /^\s*SKU:?\s*(\S.*?)\s*$/i.exec(x.textContent || '')).find(Boolean);
            const sku = f ? (SHC.normalizaSku ? SHC.normalizaSku(f[1]) : f[1]) : '';
            itens.push({ itemId: e.id, sku, familia: '', titulo: '', tipo: '', preco: null, tarifa: null, frete: null, recebe: null });
        });
        if (!custosC || itens.some(i => !custosC.has(i.itemId))) {
            const infos = itens.map(i => ({ sku: i.sku, skus: i.skus, skuFonte: i.skuFonte, familia: i.familia, itemId: i.itemId }));
            const m = await SHC.custosDe(infos), out = new Map();
            infos.forEach(i => out.set(i.itemId, m.get(i)));
            custosC = out;
        }
        if (!fretesC) fretesC = await SHC.lerFretes(itens.map(i => i.itemId));
        if (!saudeC) {
            const [fiscal, fotos, visitas, medidas, snap, catcomp] = await Promise.all([SHC.lerFiscal(), SHC.lerFotos(), SHC.lerVisitas(), SHC.lerMedidas(), SHC.lerAnuncios(), SHC.lerCatComp()]).catch(() => [null, null, null, null, null, null]);
            // SKUs com medidas diferentes: com o retrato da conta inteira (a tela mostra só uma página de anúncios). Desempate pelas
            // vendas (vm|ml, unidades por mês), igual ao painel: os dois apontam a mesma referência.
            const ids = medidas && medidas.porItem ? Object.keys(medidas.porItem) : [];
            const vm = ids.length ? await SHC.lerVendasMes(ids).catch(() => ({})) : {};
            const vendas = {};
            ids.forEach(id => { vendas[id] = Object.keys(vm[id] || {}).reduce((s, m) => s + (+vm[id][m] || 0), 0); });
            const medDiv = ids.length ? SHC.medidasDivergentes(medidas.porItem, (snap && snap.itens) || [], { vendas }) : [];
            // v3.2: mesmo SKU com frete diferente na mesma faixa de preço — a conta inteira (retrato), com os números desta página na frente.
            // Retrato velho (preço/frete podem ter mudado) não entra: só a página. ponytail: idade do retrato inteiro, não de cada anúncio.
            const snapOk = snap && Array.isArray(snap.itens) && Date.now() - (+snap.ts || 0) < 2 * 864e5;   // até 2 dias
            const retrato = itens.filter(i => i.preco !== null).concat((snapOk ? snap.itens : []).filter(i => i && !estado.porId.has(i.itemId)));
            const freteDiv = SHC.freteMesmoSku ? SHC.freteMesmoSku(retrato, { medidas: medidas && medidas.porItem, vendas }) : [];
            saudeC = { fiscal, fotos, visitas, medidas, medDiv, catcomp, freteDiv, retrato };
        }
        const cfg = await cfgAtual();
        return { cfg, custos: custosC, fretes: fretesC, hoje: SHC.hoje(), itens, saude: Object.assign({ cfg, hoje: SHC.hoje() }, saudeC) };
    }

    // Lista de Vendas: retrato dos anúncios (tarifa %, frete, SKU) + frete cobrado por pedido (Faturamento) + custos. Só leitura do que já existe.
    async function ctxVendas() {
        if (!(await garanteEstado('vendas'))) return null;
        const cfg = await cfgAtual();
        if (!vendasC) {
            const conta = await SHC.contaAtual(), hoje = SHC.hoje(), mes = hoje.slice(0, 7);
            const [ano, mm] = mes.split('-').map(Number), mesAnt = mm === 1 ? (ano - 1) + '-12' : ano + '-' + String(mm - 1).padStart(2, '0');
            // v3.3: cobranças do mês e do anterior (tarifa real por pedido e Full), Ads (ACOS), afiliados (comissão por pedido) e o Full.
            const [snap, fp, cob1, cob0, ads, afil, full] = await Promise.all([SHC.lerAnuncios(conta), SHC.lerChave('frete:' + conta + ':pedidos'),
                SHC.lerChave('cob:' + conta + ':' + mes), SHC.lerChave('cob:' + conta + ':' + mesAnt), SHC.lerChave('ads:' + conta), SHC.lerChave('afil:' + conta), SHC.lerChave('ml:full:' + conta)]);
            const porId = new Map();
            ((snap && snap.itens) || []).forEach(i => { if (i && i.itemId && !porId.has(i.itemId)) porId.set(i.itemId, i); });
            vendasC = { porId, pedidos: (fp && fp.pedidos) || {}, extras: SHC.vendaExtras({ cobs: [cob0, cob1], ads, afil, full, hoje }) };
            custosC = null;
        }
        const chaveP = p => p.itemId + '|' + p.sku;
        if (!custosC) {
            const infos = new Map();
            estado.vendas.forEach(v => v.produtos.forEach(p => {
                const it = vendasC.porId.get(p.itemId);
                // A venda traz o SKU da variação vendida: custo DELA. Sem SKU na venda: o anúncio inteiro (todas as variações, F3).
                if (!infos.has(chaveP(p))) infos.set(chaveP(p), p.sku ? { sku: p.sku, familia: (it && it.familia) || '', itemId: p.itemId }
                    : { sku: (it && it.sku) || '', skus: (it && it.skus) || [], skuFonte: (it && it.skuFonte) || '', familia: (it && it.familia) || '', itemId: p.itemId });
            }));
            const m = await SHC.custosDe([...infos.values()]), out = new Map();
            infos.forEach((i, k) => out.set(k, m.get(i)));
            custosC = out;
        }
        const custoDe = p => (custosC.get(chaveP(p)) || {}).dados || null, anuncio = id => vendasC.porId.get(id) || null;
        return { cfg, vendas: estado.vendas.map(v => ({ v, c: SHC.telaVendaConta(v, anuncio, custoDe, cfg, vendasC.pedidos, vendasC.extras(v, detC.get(v.pedido))) })) };
    }

    async function ctxPromos() {
        if (!(await garanteEstado('promos'))) return null;
        const cfg = await cfgAtual(), { familias, propostas } = estado.promos;
        if (!skuC) {                     // a Central não mostra SKU: vem do retrato da lista de Anúncios
            skuC = new Map();
            // F3: guarda o item inteiro (todos os SKUs + skuFonte), não só o 1º SKU.
            try { const snap = await SHC.lerAnuncios(); ((snap && snap.itens) || []).forEach(i => { if (i.itemId && SHC.skusDoAnuncio(i).length && !skuC.has(i.itemId)) skuC.set(i.itemId, i); }); } catch (e) { /* sem retrato */ }
        }
        if (!custosC) {
            const infos = new Map();
            propostas.forEach(p => { const i = skuC.get(p.itemId) || {}; if (!infos.has(p.itemId)) infos.set(p.itemId, { sku: i.sku || '', skus: i.skus || [], skuFonte: i.skuFonte || '', familia: p.familia, itemId: p.itemId }); });
            const m = await SHC.custosDe([...infos.values()]), out = new Map();
            infos.forEach((i, id) => out.set(id, m.get(i)));
            custosC = out;
        }
        const porFam = new Map(), scPorFam = new Map(), classes = [];
        propostas.forEach(p => {
            const c = custosC.get(p.itemId), s = SHC.sobraProposta(p, c && c.dados, cfg);
            const l = Object.assign({ p, custoDados: c ? c.dados : null, sku: (skuC.get(p.itemId) || {}).sku || '' }, s);
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
            const ctx = tela === 'anuncios' ? await ctxAnuncios() : tela === 'vendas' ? await ctxVendas() : await ctxPromos();
            if (!ctx || g !== geracao) return;
            ctx.v0 = v0;
            if (tela === 'vendas') { ctx.quero = new Set(ctx.vendas.map(x => x.v.idTxt)); ctx.idEls = idsNaTela(ctx.quero); }
            const jobs = tela === 'anuncios' ? ctx.itens.map(it => () => renderAnuncio(it, ctx)) : tela === 'vendas' ? ctx.vendas.map(x => () => renderVenda(x, ctx))
                : ctx.familias.map(f => () => renderFamilia(f, ctx));
            const res = await fatias(jobs, g);
            if (!res || g !== geracao) return;
            if (tela === 'promos') { desenhaBarra(ctx.cont); aplicaFiltro(); }
            if (SHC.telaDevePausar(res)) {
                if (++falhasSeguidas >= 2) return pausar();
                agenda(2000);             // pode ser a tela ainda montando: confere de novo antes de pausar
            } else falhasSeguidas = 0;
            if (res.ok > 0 && SHC.TOUR_PASSOS[tela]) talvezTour(tela);   // Vendas não tem tour
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
        estado = null; custosC = null; fretesC = null; saudeC = null; vendasC = null;
        degraus.clear(); pedidosAt.clear(); filaAt.length = 0; filaDet.length = 0; detPedido.clear();   // detC (o que já foi lido) fica: cache por pedido
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
        const [custos, vm] = await Promise.all([chaves.size ? SHC.areaEmpresa().get([...chaves]) : {}, ids.length ? SHC.lerVendasMes(ids) : {}]);   // v3.3: custos da empresa da conta
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
        // v3.3 multi-empresa (bloqueio 5): a conta do Copiloto trocou com esta página aberta → a conta da página é conferida de novo (o estado foi
        // conferido com a conta de antes) e as etiquetas, os custos e o imposto da empresa de antes saem.
        if (ks.indexOf('ml:conta') >= 0) { if (estado) estado.reconferir = true; avisoConta = ''; limpaPagina(); invalida('tudo'); return agenda(100); }
        let o = null;
        if (ks.some(k => k === 'cfg' || k.indexOf('c|') === 0)) o = 'custos';
        if (ks.some(k => k.indexOf('ml:anuncios:') === 0)) o = o ? 'tudo' : 'sku';
        if (ks.some(k => k.indexOf('fh|ml|') === 0)) o = o ? 'tudo' : 'fretes';
        // Saúde (fiscal:/fotos:/visitas:/medidas:): sem mudar a versão; a assinatura de cada linha diz qual redesenhar.
        if (ks.some(k => /^(fiscal|fotos|visitas|medidas|catcomp):/.test(k))) { saudeC = null; if (!o) return agenda(1000); }
        if (ks.some(k => /^(frete:.*:pedidos|cob:.*|ads:.*|afil:.*|ml:full:\d+)$/.test(k))) { vendasC = null; if (!o) { versao++; return agenda(1000); } }   // frete/cobranças/Ads/afiliados/Full lidos: a etiqueta da venda refaz a conta
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

    // 3.3.1 (C2): sem o "Concordo e ligar" do Mercado Livre (cfg.consentimento_ml) nenhuma etiqueta entra na página e nada é
    // lido dela. Desligou com a página aberta: para tudo e limpa o que estava na tela (parar). Ligou: a próxima navegação inicia.
    let telaOn = false;
    const iniciaTela = () => {
        if (telaOn || parado) return;
        telaOn = true;
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
    };
    try { SHC.mlConsentido(ok => { if (ok) iniciaTela(); }); } catch (e) { /* sem storage: não inicia */ }
    try { chrome.storage.onChanged.addListener((m, area) => {
        if (area !== 'local' || !m.cfg || !telaOn || parado) return;
        if (!(m.cfg.newValue && m.cfg.newValue.consentimento_ml)) parar();   // desligou em Ajustes: as etiquetas saem na hora
    }); } catch (e) { /* ok */ }
})(typeof globalThis !== 'undefined' ? globalThis : this);
