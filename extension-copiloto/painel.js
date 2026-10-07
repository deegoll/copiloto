// SellerHub Copiloto — painel: boas-vindas guiadas, configurações, custos por SKU e planilha (backup e ERP).
(function () {
    'use strict';
    const SHC = globalThis.SHC;

    // ── Regras sem tela (testadas em tests/copiloto/teste_csv.js) ─────────────────────────────
    const P = {};
    // Linha-mãe de família (sem preço, seguida dos anúncios de dentro) não é anúncio.
    P.anunciosReais = itens => (itens || []).filter((it, i, a) => !(!it.dentroDeFamilia && it.preco === null && a[i + 1] && a[i + 1].dentroDeFamilia));

    // Linhas da tabela: um SKU por linha (retrato da conta + custos c|sku gravados) e, à parte, os
    // "anúncios sem SKU" (do retrato) e os custos antigos por anúncio (c|ml|F…/MLB…, c|sp|…) que não são de nenhum anúncio do retrato.
    // Custo antigo de um anúncio do retrato (MLB… de anúncio com SKU, ou F… da família dele) vai para l.antigos da linha dele.
    // custos = SHC.lerTudo().custos → { 'sku|X': {canal:'sku', id:'X', custo…}, 'ml|MLB…': {…} }; famDe = { MLB…: 'F…' } (Central de promoções)
    P.montaLinhas = function (itensRetrato, custos, famDe) {
        const skus = {}, anuncios = {}, donos = {}, naFrente = {};
        const novo = (tipo, o) => Object.assign({ tipo, titulo: '', ids: [], precos: [], custo: null, antigos: [] }, o);
        const liga = (k, l) => { const d = donos[k] || (donos[k] = []); if (d.indexOf(l) < 0) d.push(l); };
        // Linha de SKU pela MESMA forma da chave do custo (c|sku|… = SHC.normalizaSku): o SKU lido em telas diferentes (lista, vendas,
        // Full) cai numa linha só, e o custo gravado no SKU acha a linha dele.
        const kSku = s => SHC.normalizaSku(s);
        P.anunciosReais(itensRetrato).forEach(it => {
            // Anúncio com variações de SKUs diferentes (it.skus, 30/09/2026): entra na linha de CADA SKU, não em "anúncio sem SKU".
            // O custo antigo gravado no anúncio (c|ml|MLB…) vira l.antigos dessas linhas ("usar para o SKU"): não some — e, quando ele é o
            // que o lucro do anúncio usa (SHC.mlbNaFrente), a linha mostra os dois valores (prevalece).
            const lista = SHC.skusDoAnuncio(it);
            if (lista.length && SHC.mlbNaFrente(it)) naFrente['ml|' + it.itemId] = true;
            const ls = lista.length ? lista.map(s => skus[kSku(s)] || (skus[kSku(s)] = novo('sku', { sku: s, titulo: it.titulo })))
                : [anuncios['ml|' + it.itemId] || (anuncios['ml|' + it.itemId] = novo('anuncio', { canal: 'ml', id: it.itemId, titulo: it.titulo }))];
            // SKU que a linha da lista não mostra (anúncio com variações ou linha de dentro) e que o Copiloto ainda não leu em outra tela:
            // não é "anúncio sem SKU" (o SKU existe no ML, nas variações).
            if (!lista.length && it.skuForaDaLinha) ls[0].skuNaoLido = it.variacoes ? 'variacoes' : 'linha';
            ls.forEach(l => {
                if (l.ids.indexOf(it.itemId) < 0) l.ids.push(it.itemId);
                if (it.preco > 0) l.precos.push(it.preco);
                if (!l.titulo) l.titulo = it.titulo || '';
                if (it.sku) liga('ml|' + it.itemId, l);
                if (famDe && famDe[it.itemId]) liga('ml|' + famDe[it.itemId], l);
            });
        });
        Object.keys(custos || {}).forEach(k => {
            const c = custos[k];
            if (!(SHC.num(c.custo) > 0)) return;
            let l;
            if (c.canal === 'sku') l = skus[c.id] || (skus[c.id] = novo('sku', { sku: c.id }));   // c.id já é a forma da chave
            else if (anuncios[k]) l = anuncios[k];
            else if (donos[k]) { donos[k].forEach(d => d.antigos.push(Object.assign({}, c, { custo: SHC.num(c.custo) }, naFrente[k] ? { prevalece: true } : {}))); return; }
            else l = anuncios[k] = novo('anuncio', { canal: c.canal, id: c.id, antigo: true });
            l.custo = c;
            if (!l.titulo) l.titulo = c.titulo || '';
        });
        const ordem = (a, b) => String(a.titulo || a.sku || a.id).localeCompare(String(b.titulo || b.sku || b.id), 'pt-BR');
        return { skus: Object.values(skus).sort(ordem), anuncios: Object.values(anuncios).sort(ordem) };
    };
    // Etiqueta da linha de anúncio (sem linha de SKU). "anúncio sem SKU" só quando a lista do ML mostra o anúncio SEM SKU; com variações
    // (ou linha de dentro) o SKU existe no ML e só não foi lido ainda — dizer "sem SKU" ali era falso (relato de 30/09/2026).
    P.EXPLICA_SKU_NAO_LIDO = 'O Mercado Livre não mostra o SKU na linha fechada deste anúncio (o SKU fica em cada variação). O Copiloto completa sozinho quando ler as vendas por anúncio ou o Full desse anúncio. Enquanto isso, o custo informado aqui fica no próprio anúncio.';
    P.etiquetaAnuncio = l => l.antigo ? 'custo antigo por anúncio'
        : l.skuNaoLido === 'variacoes' ? 'SKU nas variações · ainda não lido'
        : l.skuNaoLido ? 'SKU fora da lista · ainda não lido' : 'anúncio sem SKU';
    // Contagem das linhas de anúncio por tipo (rodapé e título do grupo): { semSku, naoLido, antigos }.
    P.contaAnuncios = ls => (ls || []).reduce((o, l) => { o[l.antigo ? 'antigos' : l.skuNaoLido ? 'naoLido' : 'semSku']++; return o; }, { semSku: 0, naoLido: 0, antigos: 0 });
    // " · 2 anúncios sem SKU · 3 com SKU nas variações ainda não lido · 1 custo antigo por anúncio" (só o que existe).
    P.rodapeAnuncios = n => (n.semSku ? ' · ' + SHC.qtd(n.semSku, 'anúncio sem SKU', 'anúncios sem SKU') : '')
        + (n.naoLido ? ' · ' + SHC.qtd(n.naoLido, 'anúncio com SKU ainda não lido', 'anúncios com SKU ainda não lido') : '')
        + (n.antigos ? ' · ' + SHC.qtd(n.antigos, 'custo antigo por anúncio', 'custos antigos por anúncio') : '');
    P.tituloGrupoAnuncios = n => {
        const p = [];
        if (n.semSku) p.push('Anúncios sem SKU');
        if (n.naoLido) p.push((p.length ? 'anúncios' : 'Anúncios') + ' com SKU ainda não lido');
        if (n.antigos) p.push((p.length ? 'custos' : 'Custos') + ' antigos por anúncio');
        return p.length > 1 ? p.slice(0, -1).join(', ') + ' e ' + p[p.length - 1] : (p[0] || 'Anúncios');
    };
    // Linha de SKU com custo cujo anúncio (ou promoção) tem custo próprio DIFERENTE → texto que mostra os dois e qual o lucro usa.
    P.dicaDivergencia = function (l) {
        const cs = SHC.num(l.custo && l.custo.custo), vistos = new Set();
        const txt = (l.antigos || []).filter(a => a.custo > 0 && Math.abs(a.custo - cs) >= 0.005 && !vistos.has(a.id) && vistos.add(a.id)).map(a => /^F/.test(String(a.id))
            ? 'Custo antigo da promoção ' + SHC.moeda(a.custo) + ' (o lucro usa o do SKU)'
            : 'Anúncio ' + a.id + ' tem custo próprio ' + SHC.moeda(a.custo) + (a.prevalece ? ' — o lucro dele usa esse, não o do SKU' : ' (o lucro dele usa o do SKU)'));
        return txt.join(' · ');
    };
    // Anúncios cujo custo próprio ganha do custo do SKU (prevalece) e é diferente dele: botão "usar o do SKU" (apaga só o do anúncio).
    P.idsQuePrevalecem = l => (l.antigos || []).filter(a => a.prevalece && a.custo > 0 && Math.abs(a.custo - SHC.num(l.custo && l.custo.custo)) >= 0.005)
        .map(a => String(a.id)).filter((x, i, a) => a.indexOf(x) === i);
    // Linhas da cópia de segurança (SHC.paraCSV): SKUs, anúncios e também os custos antigos por família/anúncio (l.antigos,
    // V11), um por chave, com a origem (V12). Sem isso o CSV perdia esses custos e eles sumiam ao restaurar.
    // Origem na cópia: custo do Tiny redigitado (custoErp diferente) sai 'manual', senão o restaurar perde custoErp e o Tiny troca.
    const origemCSV = c => !c ? '' : (c.origem === 'erp' && SHC.tinyDigitado && SHC.tinyDigitado(c) ? 'manual' : c.origem);
    P.linhasCSV = function (m) {
        const out = m.skus.map(l => ({ sku: l.sku, titulo: l.titulo, custo: l.custo ? l.custo.custo : '', outros: l.custo ? l.custo.outros : '', origem: origemCSV(l.custo) }));
        const vistos = new Set(), anuncio = (c, titulo) => {
            const k = c.canal + '|' + c.id;
            if (vistos.has(k)) return;
            vistos.add(k);
            out.push({ canal: c.canal, id: c.id, titulo: titulo || c.titulo || '', custo: c.custo, outros: c.outros, frete: c.frete, tipo: c.tipo, origem: origemCSV(c) });
        };
        m.anuncios.forEach(l => anuncio(Object.assign({}, l.custo || {}, { canal: l.canal, id: l.id }), l.titulo));
        m.skus.concat(m.anuncios).forEach(l => l.antigos.forEach(a => anuncio(Object.assign({ canal: 'ml' }, a))));
        return out;
    };
    // Valor digitado na tabela de custos: vazio = apagar (null); texto que não é número = inválido (não apaga nada).
    // "Seus números": as mesmas regras do passo 1 das boas-vindas (vazio ou fora da faixa não grava 0% calado).
    P.validaCfg = function (txtImposto, txtMargem) {
        const imp = SHC.num(txtImposto), mg = SHC.num(txtMargem), FI = SHC.FAIXAS.imposto_pct, FM = SHC.FAIXAS.margem_alvo_pct;   // a mesma faixa dos Ajustes
        if (imp === null || imp < FI[0] || imp > FI[1]) return { erro: imp === null ? 'Digite o imposto (em %). Se não paga, digite 0.' : 'Confira o imposto: use um número entre ' + FI[0] + ' e ' + FI[1] + '.' };
        if (mg === null || mg < FM[0] || mg > FM[1]) return { erro: mg === null ? 'Digite a margem que você quer (em %). Ex.: 10.' : 'Confira a margem: use um número entre ' + FM[0] + ' e ' + FM[1] + '.' };
        return { cfg: { imposto_pct: imp, margem_alvo_pct: mg } };
    };
    P.valorCampo = txt => { const t = String(txt === null || txt === undefined ? '' : txt).trim(); if (t === '') return { ok: true, valor: null }; const v = SHC.num(t); return v === null ? { ok: false } : { ok: true, valor: v }; };
    // Sincronização presa (V17): "sincronizando" sem batimento há mais de 5 min = abandonada (o Chrome fechou no meio).
    P.syncParado = (st, agora) => !!st && (st.estado === 'sincronizando' || st.sincronizando === true) && (agora || Date.now()) - (st.batimento || st.inicio || 0) > 5 * 60000;
    P.CONTATO = 'diegoconsultoriamga@gmail.com';   // o mesmo de privacidade.html
    P.FALHA = 'Não consegui salvar. Baixe uma cópia dos custos e fale com o suporte pelo WhatsApp (botão no fim desta página).';   // chrome.storage cheio ou com erro
    // Tabela reduzida: as n linhas que mais vendem (vendasDe(linha) = unidades na janela do guia); empate mantém a ordem alfabética.
    // Sem vendas lidas (todas 0): as n primeiras. → {linhas, escondidas}
    P.reduzida = function (ls, vendasDe, n) {
        const top = (ls || []).map((l, i) => ({ l, i, v: vendasDe(l) || 0 })).sort((a, b) => (b.v - a.v) || (a.i - b.i)).slice(0, n || 10).map(x => x.l);
        return { linhas: top, escondidas: Math.max(0, (ls || []).length - top.length) };
    };
    // Resumo da importação do ERP (Tiny/Omie) em cartões: r = {atualizados, semCusto, mantidos}; falta = SKUs ainda sem custo.
    P.resumoImportacao = (r, falta) => ({ com: r.atualizados || 0, sem: r.semCusto || 0, mantidos: r.mantidos || 0, falta: falta || 0 });
    // Barra "Importando do Tiny: 120 de 253 SKUs" (shc:status.custosProgresso = {erp, feito, de, unidade?}); '' sem contagem.
    P.textoImportando = function (p) {
        if (!p || !p.erp) return '';
        const nome = { omie: 'Omie', tiny: 'Tiny', bling: 'Bling' }[p.erp] || String(p.erp);
        return 'Importando do ' + nome + (p.de > 0 ? ': ' + (p.feito || 0) + ' de ' + p.de + ' ' + (p.unidade || 'SKUs') : '…');
    };
    // Custo acima do maior preço de venda: provável zero a mais ou coluna errada.
    P.custoSuspeito = (custo, precos) => !!(precos && precos.length && custo > Math.max.apply(null, precos));
    P.passoInicial = g => Math.min(5, Math.max(1, parseInt((g && g.passo) || 1, 10) || 1));
    // Endereço que o painel lateral abre (guia v2.5): #guia-N = boas-vindas no passo N; #guia / #bem-vindo = de onde parou;
    // #custos = seção de custos (Ajustes/ícone: sem barra do guia, não fecha sozinha); #guia-custos = a mesma seção aberta pelo guia
    // (barra fixa no topo e a aba fecha ao salvar);
    // #erp = seção "Custos do ERP". → {guia: N|0} | {custos: true} | {erp: true} | null
    P.lerHash = function (h) {
        const m = /^#(?:bem-vindo|guia)(?:-([1-5]))?$/.exec(h || '');
        if (m) return { guia: m[1] ? +m[1] : 0 };
        if (h === '#guia-custos') return { custos: true, guia: true };
        const x = /^#erpx(?:-([a-e]))?$/.exec(h || '');   // v3.2 cruzamento ERP × ML: #erpx ou #erpx-a … #erpx-e (o grupo)
        if (x) return { erpx: x[1] || '' };
        return h === '#custos' ? { custos: true } : (h === '#erp' ? { erp: true } : null);
    };
    P.textoConta = function (st) {
        if (!st || st.estado !== 'ok') return null;
        const partes = ['Conta aberta neste Chrome'];
        if (st.anuncios > 0) partes.push(st.anuncios + (st.anuncios === 1 ? ' anúncio' : ' anúncios'));
        if (st.familias > 0) partes.push(st.familias + (st.familias === 1 ? ' produto' : ' produtos') + ' nas promoções');
        if (partes.length === 1) partes.push('nenhum anúncio encontrado ainda');
        return partes.join(' · ');
    };

    // Lista de kits (SHC.lerKits): o que vai dentro e o custo que vale. Kit incompleto diz de quais SKUs falta o custo.
    // → [{sku, dentro, custo (o que vale | null), soma (dos itens | null), proprio (custo do kit vale, não a soma), faltam, outros}]
    P.linhasKits = function (lk) {
        return ((lk && lk.kits) || []).map(k => {
            const r = SHC.kitDe(lk.custos, k.dados), c = SHC.custoDeAnuncio(lk.custos, { sku: k.sku });
            return { sku: k.sku, dentro: k.dados.kit.map(i => i.q + '× ' + i.sku).join(' + '), custo: c ? SHC.num(c.dados.custo) : null,
                soma: r.custo, proprio: !!c && c.dados.origem !== 'kit', faltam: r.faltam, outros: SHC.num(k.dados.outros) || 0 };
        });
    };

    // ── v3.2 (A3): custos PAI → VARIAÇÕES + ESTOQUE. Só a tela muda: as linhas de P.montaLinhas, as chaves c|sku|… e o CSV ficam iguais. ──
    // Anúncio finalizado no ML (closed; inclui o antigo "closed_migrated_to_up", que virou família e AINDA mostra estoque) não conta estoque.
    // Mesma regra do painel-lateral.js (P.anuncioFinalizado): status texto ou {id|label}, "closed…" ou "finalizad…".
    P.finalizado = it => { let s = it && it.status; if (s && typeof s === 'object') s = s.id || s.label || ''; return /^(closed|finalizad)/i.test(String(s || '').trim()); };
    P.porId = itens => (itens || []).reduce((o, i) => { if (i && i.itemId) o[i.itemId] = i; return o; }, {});
    // Linha (SKU ou anúncio) cujos anúncios no retrato estão TODOS finalizados: fica fora da tela por padrão ("Mostrar finalizados").
    P.linhaFinalizada = (l, porId) => !!(l.ids && l.ids.length) && l.ids.every(id => P.finalizado(porId[id]));
    // Base do estoque (uma vez por desenho): anúncios não finalizados + a mesma lista com o produto = SKU — o mesmo SKU em 2 user products
    // é o mesmo estoque físico (SHC.estoqueSku soma por UP: 258 + 258 = 516): aqui conta 1 vez, o maior.
    P.baseEstoque = (itens, full) => {
        const ativos = (itens || []).filter(i => i && i.itemId && !P.finalizado(i));
        return { ativos, porSku: ativos.map(i => Object.assign({}, i, { familia: 'sku:' + SHC.normalizaSku(i.sku) })), full: full || null };
    };
    // Estoque de uma linha → { faixa: 'tem'|'zero'|'nl', lido, total, proprio, full, pausa (zerado e pausado), pausado (pausado COM estoque), semAnuncio }.
    // Não lido NUNCA vira 0 (faixa 'nl': só conta em "Todos").
    P.estoqueLinha = function (l, base) {
        const sku = l.tipo === 'sku' ? SHC.normalizaSku(l.sku) : '';
        const e = SHC.estoqueSku({ sku, itemIds: l.ids || [] }, sku ? base.porSku : base.ativos, base.full);
        const meus = base.ativos.filter(i => (l.ids || []).indexOf(i.itemId) >= 0);
        if (!e.lido) return { faixa: 'nl', lido: false, semAnuncio: !meus.length };
        const semEst = i => /sem estoque/i.test(String(i.estoque || '')) || (i.restricao && i.restricao.id === 'out_of_stock');
        return { faixa: e.total > 0 ? 'tem' : 'zero', lido: true, total: e.total, proprio: e.proprio, full: e.full,
            pausa: !(e.total > 0) && meus.some(i => i.status === 'paused' && semEst(i)),
            pausado: e.total > 0 && meus.length > 0 && meus.every(i => i.status === 'paused') };
    };
    const milhar = n => Number(n || 0).toLocaleString('pt-BR');
    // Selos do estoque → [{cls, txt}] ('est tem' verde, 'est full' azul, 'est zero' vermelho, 'est pausa' tracejado, 'est nl' cinza).
    P.selos = function (e) {
        if (!e || e.faixa === 'nl') return e && e.semAnuncio ? [] : [{ cls: 'nl', txt: 'Estoque não lido ainda' }];
        if (e.faixa === 'zero') return [{ cls: e.pausa ? 'pausa' : 'zero', txt: e.pausa ? 'Pausado sem estoque' : 'Zerado' }];
        const out = [];
        if (e.proprio > 0) out.push({ cls: 'tem', txt: 'Com estoque ' + milhar(e.proprio) + (e.pausado ? ' · pausado' : '') });
        if (e.full > 0) out.push({ cls: 'full', txt: 'Full: ' + milhar(e.full) + (e.pausado && !(e.proprio > 0) ? ' · pausado' : '') });
        return out;
    };
    // Grupos: PAI = família do ML (familyId) com 2+ SKUs, ou anúncio antigo com variações de SKUs diferentes; senão a linha fica sozinha.
    // → [{ tipo:'pai'|'solo', chave, titulo, filhos:[linha] }]; no pai cada filho ganha l.nomeVar (nome da variação).
    P.agrupa = function (skus, itens, familias, full) {
        const porId = P.porId(itens), vivo = id => porId[id] && !P.finalizado(porId[id]);
        const chaveDe = l => {
            const ids = (l.ids || []).filter(vivo);
            const f = ids.map(id => porId[id].familyId).find(Boolean);
            if (f) return 'f:' + f;
            const v = ids.find(id => SHC.skusDoAnuncio(porId[id]).length > 1);
            return v ? 'v:' + v : '';
        };
        const mapa = new Map(), out = [];
        (skus || []).forEach(l => {
            const k = chaveDe(l);
            if (!k) { out.push({ tipo: 'solo', chave: 's:' + l.sku, filhos: [l] }); return; }
            let g = mapa.get(k);
            if (!g) { g = { tipo: 'pai', chave: k, filhos: [] }; mapa.set(k, g); out.push(g); }
            g.filhos.push(l);
        });
        return out.map(g => {
            if (g.tipo !== 'pai') return g;
            if (g.filhos.length < 2) return { tipo: 'solo', chave: 's:' + g.filhos[0].sku, filhos: g.filhos };
            const id = g.chave.slice(2), fam = g.chave[0] === 'f' ? (familias || []).find(x => x && String(x.familyId) === id) : null;
            g.titulo = (fam && fam.titulo) || (g.chave[0] === 'v' && porId[id] ? porId[id].titulo : '') || g.filhos[0].titulo || '';
            P.nomeiaVariacoes(g.filhos, porId, full);
            g.filhos.sort((a, b) => a.nomeVar.localeCompare(b.nomeVar, 'pt-BR', { numeric: true }));
            return g;
        });
    };
    // Nome da variação, nesta ordem: o lido do ML (item.nomeVariacao), o do Full (produtos[].variacao), o fim do SKU que muda entre os
    // irmãos (BA-914516-04 / BA-914516-KITCOM06 → "04" / "KITCOM06") e, por último, o próprio SKU.
    P.nomeiaVariacoes = function (filhos, porId, full) {
        const ss = filhos.map(l => SHC.normalizaSku(l.sku));
        let pre = ss[0] || '';
        ss.forEach(s => { while (pre && s.indexOf(pre) !== 0) pre = pre.slice(0, -1); });
        filhos.forEach((l, i) => {
            const doMl = (l.ids || []).map(id => porId[id] && porId[id].nomeVariacao).find(Boolean);
            const p = ((full && full.produtos) || []).find(x => x && x.variacao && SHC.normalizaSku(x.sku) === ss[i]);
            const fim = pre.length >= 3 && ss[i].length > pre.length ? ss[i].slice(pre.length).replace(/^[-_.\s]+/, '') : '';
            l.nomeVar = String(doMl || (p && p.variacao) || fim || l.sku || '').trim();
        });
    };
    // Faixa do grupo: com estoque se algum filho tem; não lido se algum não foi lido; senão zerado.
    P.faixaGrupo = (g, est) => { const fs = g.todosFilhos || g.filhos; return fs.some(l => est(l).faixa === 'tem') ? 'tem' : fs.some(l => est(l).faixa === 'nl') ? 'nl' : 'zero'; };
    // Ordem padrão: com estoque → não lido → zerados; dentro da faixa, quem vende mais (o grupo soma os filhos), empate em ordem alfabética.
    P.ordenaGrupos = function (gs, est, vendasDe) {
        const R = { tem: 0, nl: 1, zero: 2 }, v = g => g.filhos.reduce((t, l) => t + (vendasDe(l) || 0), 0);
        const nome = g => String(g.titulo || g.filhos[0].titulo || g.filhos[0].sku || g.filhos[0].id || '');
        return gs.map(g => ({ g, r: R[P.faixaGrupo(g, est)], v: v(g) })).sort((a, b) => (a.r - b.r) || (b.v - a.v) || nome(a.g).localeCompare(nome(b.g), 'pt-BR')).map(x => x.g);
    };
    // Filtro com hierarquia: passa(l, g) olha cada filho; o pai fica se algum filho passa, só com os que passam (de = quantos tinha).
    P.filtraGrupos = (gs, passa) => gs.map(g => {
        const fs = g.filhos.filter(l => passa(l, g));
        // todosFilhos: o estoque e o "N de M com custo" do pai continuam os do produto inteiro (filtrar Zerados não zera o pai).
        return fs.length ? Object.assign({}, g, { filhos: fs, de: g.filhos.length, todosFilhos: g.todosFilhos || g.filhos }) : null;
    }).filter(Boolean);
    // Chips: contagem por SKU/anúncio → { todos, tem, zero, nl, sem }. Sem anúncio ativo no ML (sem) não promete leitura: fica fora do nl.
    P.contaEstoque = (ls, est) => ls.reduce((o, l) => { const e = est(l); o.todos++; o[e.semAnuncio ? 'sem' : e.faixa]++; return o; }, { todos: 0, tem: 0, zero: 0, nl: 0, sem: 0 });
    // Tem custo = o que a etiqueta usa: o do SKU, a soma do kit ou o antigo da família/anúncio (mesma conta do painel lateral).
    P.temCusto = l => !!l.custo || !!l.kitCalc || (l.antigos || []).some(a => a.custo > 0);
    // "Mesmo custo para todas as variações": só as que NÃO têm custo nenhum (nem do kit, nem antigo do anúncio); com trocarTodos,
    // também as que já têm → [SKU a gravar]. Mesmo critério do "N de M variações com custo" do pai.
    P.aplicaMesmoCusto = (filhos, valor, trocarTodos) => !(valor > 0) ? [] : filhos.filter(l => trocarTodos || !P.temCusto(l)).map(l => l.sku);
    // "Estoque lido do Mercado Livre hoje às 14:20" / "em 28/09 às 09:10"; mais de 24 h: "há N dias: pode ter mudado". Sem retrato: ''.
    P.textoLeituraEstoque = function (ts, agora) {
        if (!ts) return '';
        const d = new Date(ts), h = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'), ms = (agora || Date.now()) - ts;
        if (ms > 86400000) { const n = Math.max(1, Math.floor(ms / 86400000)); return 'Estoque lido há ' + (n === 1 ? '1 dia' : n + ' dias') + ': pode ter mudado.'; }
        const hoje = new Date(agora || Date.now()).toDateString() === d.toDateString();
        return 'Estoque lido do Mercado Livre ' + (hoje ? 'hoje' : 'em ' + String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0')) + ' às ' + h + '.';
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = P;
    if (typeof document === 'undefined') return;

    // ── Tela ──────────────────────────────────────────────────────────────────────────────────
    const $ = s => document.querySelector(s);
    const CAMPOS_CFG = ['imposto_pct', 'margem_alvo_pct'];   // v2: tarifa, comissão e frete vêm do Mercado Livre
    const nf = v => (v === null || v === undefined || v === '') ? '' : String(v).replace('.', ',');
    const nfr = v => (v === null || v === undefined || v === '' || !isFinite(v)) ? '' : Number(v).toFixed(2).replace('.', ',');   // reais: sempre com centavos
    const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const dataBR = ts => ts ? new Date(ts).toLocaleDateString('pt-BR') : '';
    // Origem do custo: 'erp' diz qual (c.erp = 'tiny' | 'omie' | 'bling'); custo do ERP gravado sem dizer qual -> "ERP".
    const ORIGEM = c => c.origem === 'erp' ? ({ tiny: 'Tiny', omie: 'Omie', bling: 'Bling' }[c.erp] || 'ERP') : { manual: 'digitado', planilha: 'planilha' }[c.origem];
    const URL_ANUNCIOS = 'https://vendedores.mercadolivre.com.br/anuncios/lista';
    const URL_ML = 'https://vendedores.mercadolivre.com.br/';
    const FALHA = P.FALHA;

    let cfg = {}, guia = { passo: 0, feitos: {}, tours: {} }, modelo = { skus: [], anuncios: [] }, porChave = new Map(), temRetrato = false;
    let principais = { com: 0, de: 0, comTodos: 0, deTodos: 0, faltam: [] };   // SHC.guiaCustos: os 10 que mais vendem
    let kits = { kits: [], custos: {} };   // SHC.lerKits: kits gravados + custos c|sku (para somar os itens)
    let vendasChave = {}, verTodos = false, peloGuia = false;   // vendas por SKU/anúncio na janela do guia; "Ver todos"; aberta pelo guia (#guia-custos)
    let retrato = { itens: [], familias: [], ts: 0, full: null }, porIdRet = {};   // v3.2: retrato ml:anuncios (itens + famílias) e o Full, para estoque e pai → variações
    // Gravações do progresso uma de cada vez (senão uma apaga a outra).
    let filaGuia = Promise.resolve();
    const gravaGuia = patch => (filaGuia = filaGuia.then(() => SHC.salvarGuia(patch)).then(g => (guia = g), () => guia));

    // Família da Central de promoções (F…) de cada anúncio: é onde ficavam os custos antigos.
    function familiaPorItem(promos) {
        const out = {};
        if (!promos) return out;
        (promos.familias || []).forEach(f => (f.anuncios || []).forEach(id => { out[id] = f.chave; }));
        (promos.propostas || []).forEach(p => { if (p.itemId && p.familia && !out[p.itemId]) out[p.itemId] = p.familia; });
        return out;
    }

    // F16 (auditoria 30/09): a tabela mostra os anúncios de UMA conta — diz qual, e com 2+ contas deixa escolher (o custo do SKU vale para todas).
    let contaVer = '';   // '' = a conta aberta agora no ML
    // v3.3 multi-empresa (revisão 07/10/2026): só as contas da MESMA empresa da conta aberta. Os custos por SKU da tabela são os da empresa
    // aberta: a conta de outra empresa mostraria os anúncios dela com os custos desta (e gravaria nesta o que fosse digitado).
    const contasTab = async () => (SHC.contasDaEmpresa ? SHC.contasDaEmpresa() : SHC.contas ? SHC.contas() : []);
    async function desenhaContaTab() {
        const box = $('#contaTab'), sel = $('#contaEsc'), nota = $('#contaTabNota');
        if (!box || !sel) return;
        let cs = [], todas = 0;
        try { cs = await contasTab(); todas = SHC.contas ? (await SHC.contas()).length : cs.length; } catch (e) { cs = []; }
        box.hidden = !cs.length;
        if (!cs.length) return;
        const atual = contaVer || (cs.find(c => c.atual) || cs[0]).sellerId;
        sel.innerHTML = cs.map(c => `<option value="${esc(c.sellerId)}"${c.sellerId === atual ? ' selected' : ''}>${esc(c.nome)}${c.atual ? ' (aberta agora)' : ''}</option>`).join('');
        sel.disabled = cs.length < 2;
        if (nota) nota.textContent = todas > cs.length
            ? 'O custo do SKU vale para as contas desta empresa. As contas de outra empresa têm os custos delas: abra o Mercado Livre nelas para ver e editar.'
            : 'O custo do SKU vale para todas as contas.';
    }
    async function lerDados() {
        // Conta escolhida que deixou de ser desta empresa (marcada em Ajustes, ou o ML abriu outra conta): volta para a aberta.
        if (contaVer && !(await contasTab().catch(() => [])).some(c => c.sellerId === contaVer)) contaVer = '';
        const cv = contaVer || undefined;
        const [tudo, an, promos, g, full] = await Promise.all([SHC.lerTudo(), SHC.lerAnuncios(cv), SHC.lerPromos(cv), SHC.lerGuia(),
            SHC.lerFull ? SHC.lerFull(cv).catch(() => null) : null]);
        cfg = tudo.cfg; guia = g;
        try { erpx = await SHC.lerChave('erpx:' + (cv || await SHC.contaAtual())); } catch (e) { erpx = null; }   // v3.2 cruzamento ERP × ML
        const itens = (an && an.itens) || [];
        temRetrato = itens.length > 0;
        modelo = P.montaLinhas(itens, tudo.custos, familiaPorItem(promos));
        // v3.2: estoque (retrato + Full) e pai → variações (snap.familias), sem nenhuma chamada nova ao ML.
        retrato = { itens, familias: (an && an.familias) || [], ts: (an && an.ts) || 0, full: full || null };
        porIdRet = P.porId(itens); baseEst = null; cacheEst = new Map();
        const vm = itens.length ? await SHC.lerVendasMes(itens.map(it => it.itemId)) : {}, brutos = {};
        Object.keys(tudo.custos).forEach(k => { brutos['c|' + k] = tudo.custos[k]; });   // lerTudo tira o "c|" da chave
        kits = await SHC.lerKits();
        Object.assign(brutos, kits.custos);   // kit sem custo próprio também conta (soma dos itens)
        modelo.skus.forEach(l => { const c = !l.custo && SHC.custoDeAnuncio(kits.custos, { sku: l.sku }); l.kitCalc = c && c.dados.origem === 'kit' ? c.dados : null; });
        principais = SHC.guiaCustos(itens, brutos, vm);
        // Unidades vendidas por SKU (ou por anúncio sem SKU) na mesma janela do guia (principais.desde): ordem da tabela reduzida.
        vendasChave = {};
        // Anúncio com vários SKUs (variações): as vendas dele contam na linha de cada SKU (igual a SHC.guiaCustos).
        itens.forEach(it => {
            const ss = SHC.skusDoAnuncio(it), v = vm[it.itemId] || {};
            (ss.length ? ss.map(s => 'sku:' + SHC.normalizaSku(s)) : ['mlb:' + it.itemId]).forEach(k => {
                Object.keys(v).forEach(m => { if (m >= principais.desde) vendasChave[k] = (vendasChave[k] || 0) + (Number(v[m]) || 0); });
            });
        });
        porChave = new Map();
        modelo.skus.forEach(l => porChave.set('sku|' + l.sku, l));
        modelo.anuncios.forEach(l => porChave.set(l.canal + '|' + l.id, l));
    }

    async function carregar() {
        await lerDados();
        CAMPOS_CFG.forEach(k => { const el = $('#' + k); if (el) el.value = nf(cfg[k]); });
        desenhaTabela();
        desenhaCopia();
        desenhaMeta();
        desenhaContas().catch(() => {});
        desenhaContaTab().catch(() => {});
        const pedido = P.lerHash(location.hash);
        if (pedido) history.replaceState(null, '', location.pathname);
        if (pedido && pedido.erpx !== undefined) erpxFiltro = pedido.erpx;
        desenhaErpx();
        if (pedido && pedido.erpx !== undefined) { desenhaRetoma(); ($('#erpx').hidden ? $('#erp') : $('#erpx')).scrollIntoView(); }
        else if (pedido && pedido.custos) { peloGuia = !!pedido.guia; if (peloGuia) $('#gBar').hidden = false; desenhaRetoma(); $('#custos').scrollIntoView(); }
        else if (pedido && pedido.erp) { desenhaRetoma(); $('#erp').scrollIntoView(); }
        else if (pedido || (!guia.fim && !guia.fechado && !cfg.configurado)) abrirGuia((pedido && pedido.guia) || (guia.fim ? 1 : P.passoInicial(guia)));
        else desenhaRetoma();
    }
    // ── v3.2 Cruzamento ERP × ML (erpx:<conta>, gravado pelo fundo): 5 botões que filtram o grupo, "Conferir agora" e a planilha. Só lê. ──
    let erpx = null, erpxFiltro = '';
    function desenhaErpx() {
        const el = $('#erpx');
        el.hidden = !(erpx && erpx.r && SHC.erpxSecaoHtml);
        el.innerHTML = el.hidden ? '' : SHC.erpxSecaoHtml(erpx, erpxFiltro);
    }
    $('#erpx').addEventListener('click', async e => {
        const f = e.target.closest('[data-erpx-f]');
        if (f) { erpxFiltro = f.getAttribute('data-erpx-f'); desenhaErpx(); const b = $('#erpx [data-erpx-f="' + erpxFiltro + '"]'); if (b) b.focus(); return; }
        if (e.target.closest('[data-erpx-csv]')) {
            const url = URL.createObjectURL(new Blob([SHC.erpxCSV(erpx)], { type: 'text/csv;charset=utf-8' })), a = document.createElement('a');
            a.href = url; a.download = 'copiloto-' + String(erpx.erp || 'erp') + '-x-ml-' + SHC.hoje() + '.csv'; document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            return;
        }
        const c = e.target.closest('[data-erpx-conferir]');
        if (c) {
            c.disabled = true; c.textContent = 'Conferindo…';
            try { const r = await chrome.runtime.sendMessage({ acao: 'erp_conferir' }); if (r && r.erpx) erpx = r.erpx; } catch (err) { /* fundo reiniciando */ }
            desenhaErpx();
        }
    });
    // Um nome só para a meta ("meta de margem") em toda a página; a legenda das cores usa o valor do seller.
    function desenhaMeta() {
        const v = nf(cfg.margem_alvo_pct === undefined ? 10 : cfg.margem_alvo_pct);
        document.querySelectorAll('.metaTxt').forEach(el => { el.textContent = v; });
    }
    // Aberta pelo guia: "✓ Salvo" e a aba fecha sozinha (foi aberta pela extensão), voltando ao Mercado Livre.
    // Por conta própria: "✓ Salvo" + "Fechar esta página". fechar() = window.close (trocável no teste).
    let fechar = () => { try { window.close(); } catch (e) { /* aba que não pode fechar: fica */ } };
    P._fechar = f => { fechar = f; };
    async function focarML() {
        try {
            if (!chrome.tabs || !chrome.tabs.query) return;
            const abas = await chrome.tabs.query({ url: 'https://vendedores.mercadolivre.com.br/*' });
            const a = abas && abas.sort((x, y) => (y.lastAccessed || 0) - (x.lastAccessed || 0))[0];
            if (a) await chrome.tabs.update(a.id, { active: true });
        } catch (e) { /* sem aba do ML: nada a fazer */ }
    }
    function salvoEFecha(txt) {
        $('#gBar').hidden = false;
        if (!peloGuia) $('#gBarTxt').textContent = '';
        $('#gBarOk').textContent = txt || '✓ Salvo';
        $('#gBarPular').hidden = true; $('#gBarJa').hidden = true; $('#gBarFechar').hidden = peloGuia;
        if (!peloGuia) return;
        setTimeout(async () => { await focarML(); fechar(); }, 1200);
    }
    $('#gBarFechar').addEventListener('click', () => fechar());
    $('#gBarJa').addEventListener('click', async () => { await gravaGuia({ feitos: { custos: SHC.hoje() } }); desenhaPrincipais(); salvoEFecha('✓ Salvo'); });
    $('#gBarPular').addEventListener('click', async () => {
        await gravaGuia({ pulados: { custos: true } });
        salvoEFecha('Sem custo, o Copiloto não calcula o lucro; o guia lembra você depois.');
    });

    // ── Boas-vindas guiadas (5 passos, progresso em shc:guia) ─────────────────────────────────
    let passo = 1, timerIcone = null, verificando = false, esperandoLogin = false, naoSei = false;

    function abrirGuia(n) {
        document.body.classList.add('guiando');
        $('#guia').hidden = false;
        window.scrollTo(0, 0);
        irPasso(n);
    }
    function fecharGuia() {
        pararIcone();
        document.body.classList.remove('guiando');
        $('#guia').hidden = true;
        desenhaRetoma();
    }
    // Faixa "continuar boas-vindas" só para quem começou e não terminou.
    function desenhaRetoma() {
        const falta = !guia.fim && guia.passo > 0 && $('#guia').hidden;
        $('#retoma').hidden = !falta;
        if (falta) $('#retomaTxt').textContent = 'Faltam alguns passos das boas-vindas (passo ' + P.passoInicial(guia) + ' de 5).';
    }

    function irPasso(n) {
        passo = n;
        document.querySelectorAll('#guia .g-p').forEach(el => { el.hidden = Number(el.getAttribute('data-p')) !== n; });
        $('#gPasso').textContent = 'Passo ' + n + ' de 5';
        $('#gProg').style.width = (n * 20) + '%';
        pararIcone();
        if (n === 1) prepararImposto();
        if (n === 2) vigiarIcone();
        if (n === 3) verificarConta(false);
        if (n === 4) $('#gBackupOk').textContent = guia.feitos.backup ? '✓ Cópia baixada' + (guia.ultimoBackup ? ' em ' + dataBR(guia.ultimoBackup) : '') + '.' : '';
        gravaGuia({ passo: n });
    }

    // ① Imposto e margem
    function prepararImposto() {
        $('#gImposto').value = cfg.configurado || cfg.imposto_pct ? nf(cfg.imposto_pct) : '';
        $('#gMargem').value = nf(cfg.margem_alvo_pct === undefined ? 10 : cfg.margem_alvo_pct);
        naoSei = false;
        marcaChip();
    }
    function marcaChip() {
        const v = SHC.num($('#gImposto').value);
        document.querySelectorAll('#gChips button').forEach(b => {
            const d = b.getAttribute('data-v');
            b.classList.toggle('on', d === 'naosei' ? naoSei : (!naoSei && v === Number(d)));
        });
        $('#gNaoSei').hidden = !naoSei;
    }
    $('#gChips').addEventListener('click', e => {
        const b = e.target.closest('button[data-v]');
        if (!b) return;
        const d = b.getAttribute('data-v');
        naoSei = d === 'naosei';
        $('#gImposto').value = naoSei ? '0' : d;
        $('#gErro1').textContent = '';
        marcaChip();
    });
    $('#gImposto').addEventListener('input', () => { naoSei = false; $('#gErro1').textContent = ''; marcaChip(); });
    $('#g1').addEventListener('click', async () => {
        const imp = SHC.num($('#gImposto').value), mg = $('#gMargem').value.trim() === '' ? 10 : SHC.num($('#gMargem').value);
        const v = P.validaCfg($('#gImposto').value, String(mg === null ? '' : mg));   // mesma faixa do "Seus números" e dos Ajustes
        if (v.erro) { $('#gErro1').textContent = imp === null ? 'Escolha uma opção ou digite o percentual.' : v.erro; return; }
        try { cfg = await SHC.salvarCfg({ imposto_pct: imp, margem_alvo_pct: mg }); } catch (e) { $('#gErro1').textContent = FALHA; return; }
        CAMPOS_CFG.forEach(k => { $('#' + k).value = nf(cfg[k]); });
        await gravaGuia({ feitos: { imposto: true } });
        irPasso(2);
    });

    // ② Desenho em 3 quadros: alternam a cada 3 s, bolinhas 1-2-3 clicáveis, pausa com o mouse em cima (ou o foco dentro);
    // com "reduzir movimento" o CSS mostra os 3 empilhados e nada gira. Ícone fixado → para no quadro 3.
    let quadro = 1, timerQuadro = null, quadroPausado = false, fixou = false;
    const reduzMovimento = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    function mostraQuadro(n) {
        quadro = n;
        document.querySelectorAll('#gFix .fx-q, #gFix .fx-dots button').forEach(e => e.classList.toggle('on', Number(e.getAttribute('data-q')) === n));
    }
    function pararQuadros() { if (timerQuadro) clearInterval(timerQuadro); timerQuadro = null; }
    function girarQuadros() {
        pararQuadros();
        if (fixou || reduzMovimento()) return;
        timerQuadro = setInterval(() => { if (!quadroPausado) mostraQuadro(quadro % 3 + 1); }, 3000);
    }
    const gFix = $('#gFix');
    gFix.addEventListener('mouseenter', () => { quadroPausado = true; });
    gFix.addEventListener('mouseleave', () => { quadroPausado = false; });
    gFix.addEventListener('focusin', () => { quadroPausado = true; });
    gFix.addEventListener('focusout', () => { quadroPausado = false; });
    gFix.addEventListener('click', e => {
        const b = e.target.closest && e.target.closest('button[data-q]');
        if (!b) return;
        mostraQuadro(Number(b.getAttribute('data-q')));
        girarQuadros();
    });

    // Ícone fixado: o Chrome avisa (getUserSettings). Confere a cada 2 s enquanto o passo está aberto.
    async function iconeFixado() {
        try { const u = chrome.action && chrome.action.getUserSettings && await chrome.action.getUserSettings(); return !!(u && u.isOnToolbar); } catch (e) { return false; }
    }
    function vigiarIcone() {
        const checa = async () => {
            const sim = await iconeFixado();
            const el = $('#gIcone');
            el.className = 'estado' + (sim ? ' bom' : '');
            el.textContent = sim ? '✓ Ícone fixado. O Copiloto detectou sozinho.' : 'Ainda não fixou? Tudo bem: clique em Continuar.';
            if (sim && !fixou) { fixou = true; pararQuadros(); mostraQuadro(3); }
            if (sim && !guia.feitos.icone) await gravaGuia({ feitos: { icone: true } });
        };
        checa();
        timerIcone = setInterval(checa, 2000);
        girarQuadros();
    }
    function pararIcone() { if (timerIcone) clearInterval(timerIcone); timerIcone = null; pararQuadros(); }
    // Continuar sem fixar = etapa "ícone" pulada no guia (é opcional; o painel lateral não pede de novo).
    $('#g2').addEventListener('click', async () => {
        if (!guia.feitos.icone && !(await iconeFixado())) await gravaGuia({ pulados: { icone: true } });
        irPasso(3);
    });

    // ③ Conta do ML: sincroniza com a sessão aberta e mostra o resultado.
    let tConta = 0;
    function mostraConta(st) {
        $('#gSync').innerHTML = SHC.htmlSync(st, Date.now(), { lista: true });   // selo + barra + "O que o Copiloto já leu"
        if (P.syncParado(st)) st = { estado: 'erro', erro: 'parou' };   // V17: leitura interrompida → "Tentar de novo"
        clearTimeout(tConta);
        if (st && st.estado === 'sincronizando') tConta = setTimeout(async () => { if (passo === 3 && !$('#guia').hidden) mostraConta(await SHC.lerStatus()); }, 60e3);
        const el = $('#gConta'), txt = P.textoConta(st);
        const semSessao = st && st.estado === 'erro' && st.erro === 'sem_sessao';
        el.className = 'estado' + (txt ? ' bom' : (st && st.estado === 'erro' ? ' ruim' : ''));
        if (txt) el.textContent = '✓ ' + txt;
        else if (st && st.estado === 'sincronizando') el.textContent = 'Lendo sua conta no Mercado Livre…' + (st.anuncios ? ' ' + st.anuncios + ' anúncios até agora' : '');
        else if (semSessao) el.textContent = 'Entre no Mercado Livre em outra aba; o Copiloto espera você.';
        else if (st && st.estado === 'erro') el.textContent = st.erro === 'parou' ? 'A leitura da sua conta parou no meio. Clique em Tentar de novo.' : 'Não consegui ler sua conta agora. Tente de novo em instantes.';
        else el.textContent = 'Conferindo sua conta…';
        $('#gContaObs').hidden = !(st && st.estado === 'sincronizando');
        $('#gAbrirML').hidden = !semSessao;
        $('#gVerificar').hidden = !(st && st.estado === 'erro');
        esperandoLogin = semSessao;
        if (txt && !guia.feitos.conta) gravaGuia({ feitos: { conta: true } });
    }
    async function verificarConta(forcar) {
        const st = await SHC.lerStatus();
        // Leitura boa há menos de 10 min: não pede tudo de novo ao ML.
        if (!forcar && st.estado === 'ok' && st.ultimaOk && Date.now() - st.ultimaOk < 10 * 60e3) { mostraConta(st); return; }
        verificando = true;
        mostraConta(st.estado === 'sincronizando' && !P.syncParado(st) ? st : { estado: 'sincronizando', batimento: Date.now() });
        try {
            const r = await chrome.runtime.sendMessage({ acao: 'sincronizar' });
            mostraConta(r && r.estado ? r : await SHC.lerStatus());
        } catch (e) { mostraConta(await SHC.lerStatus()); }
        verificando = false;
    }
    $('#gVerificar').addEventListener('click', () => verificarConta(true));
    $('#gSync').addEventListener('click', e => { if (e.target.closest && e.target.closest('[data-sync]') && !verificando) verificarConta(true); });
    $('#gAbrirML').addEventListener('click', () => { chrome.tabs.create({ url: URL_ML }); });
    // Voltou para esta aba depois de entrar no ML: confere sozinho.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && passo === 3 && esperandoLogin && !verificando && !$('#guia').hidden) verificarConta(true);
    });
    $('#g3').addEventListener('click', () => irPasso(4));

    // ④ Backup
    $('#gBackup').addEventListener('click', async () => {
        await baixarPlanilha();
        $('#gBackupOk').textContent = '✓ Cópia baixada.';
    });
    $('#g4').addEventListener('click', () => irPasso(5));

    // ⑤ (último) Abrir a lista de Anúncios: as boas-vindas terminam aqui; o guia continua no painel lateral e na tela do ML.
    async function concluir() {
        await gravaGuia({ passo: 5, fim: Date.now() });
        fecharGuia();
        $('#custos').scrollIntoView({ behavior: 'smooth' });
    }
    $('#gAnuncios').addEventListener('click', async () => {
        chrome.tabs.create({ url: URL_ANUNCIOS });
        await gravaGuia({ feitos: { anuncios: true } });
        await concluir();
    });
    $('#g5').addEventListener('click', concluir);
    $('#gFechar').addEventListener('click', async () => { await gravaGuia({ fechado: Date.now() }); fecharGuia(); });
    $('#retomaBt').addEventListener('click', () => abrirGuia(P.passoInicial(guia)));
    $('#rever').addEventListener('click', () => abrirGuia(1));
    window.addEventListener('hashchange', () => {
        const pedido = P.lerHash(location.hash);
        if (!pedido) return;
        history.replaceState(null, '', location.pathname);
        if (pedido.erpx !== undefined) { if (!$('#guia').hidden) fecharGuia(); erpxFiltro = pedido.erpx; desenhaErpx(); ($('#erpx').hidden ? $('#erp') : $('#erpx')).scrollIntoView({ behavior: 'smooth' }); }
        else if (pedido.custos) { if (!$('#guia').hidden) fecharGuia(); $('#custos').scrollIntoView({ behavior: 'smooth' }); }
        else abrirGuia(pedido.guia || (guia.fim ? 1 : P.passoInicial(guia)));
    });

    // ── Configurações ──
    $('#salvarCfg').addEventListener('click', async () => {
        const ok = $('#okCfg'), val = P.validaCfg($('#imposto_pct').value, $('#margem_alvo_pct').value);
        if (val.erro) { ok.className = 'msg erro'; ok.textContent = val.erro; return; }
        try { cfg = await SHC.salvarCfg(val.cfg); } catch (e) { ok.className = 'msg erro'; ok.textContent = FALHA; return; }
        ok.className = 'ok';
        ok.textContent = '✓ Salvo. As etiquetas abertas já foram atualizadas.';
        desenhaMeta();
        setTimeout(() => { ok.textContent = ''; }, 4000);
        salvoEFecha('✓ Salvo');
    });
    $('#fcfg').addEventListener('submit', e => { e.preventDefault(); $('#salvarCfg').click(); });
    // ── Suas contas (v2.8): c.nome = apelido de Ajustes OU o nome da própria conta lido do ML OU "Conta ID …1234" (SHC.nomeConta); nunca o e-mail ──
    async function desenhaContas() {
        let cs = [];
        try { cs = SHC.contas ? await SHC.contas() : []; } catch (e) { cs = []; }
        const el = $('#listaContas'), ap = cfg.apelidos || {}, sep = cfg.empresaSeparada || {};
        if (!el) return;
        el.innerHTML = cs.length ? cs.map(c => {
            const nomeAp = ap[c.sellerId];
            return `<div class="campo" style="background:#F8FAFC;border:1px solid var(--linha);border-left:3px solid ${c.atual ? 'var(--verde)' : '#D0D5DD'};border-radius:10px;padding:9px 10px 10px"><div class="conta-linha"><b>${esc(c.nome)}</b><span class="contatag">ID …${esc(c.sellerId.slice(-4))}</span>${c.atual ? '<span class="contatag agora">aberta agora</span>' : ''}</div><label for="ap-${esc(c.sellerId)}" style="font-weight:500;color:var(--suave)">Apelido próprio (opcional; no lugar do nome do ML)</label><input class="inp" id="ap-${esc(c.sellerId)}" data-apelido="${esc(c.sellerId)}" maxlength="40" placeholder="Ex.: Loja 1" value="${esc(nomeAp || '')}">`
                // v3.3 multi-empresa: conta de outra empresa tem custos por SKU, imposto, margem, despesas e ERP só dela (store.js, SHC.empresaSeparada).
                + (cs.length > 1 ? `<label style="display:flex;gap:6px;align-items:flex-start;margin-top:8px;font-weight:500"><input type="checkbox" data-empresa="${esc(c.sellerId)}"${sep[c.sellerId] === true ? ' checked' : ''}>`
                    + `<span>Outra empresa: custos por SKU, imposto, margem, despesas fixas e ERP só desta conta</span></label>` : '') + '</div>';
        }).join('')
            : '<p class="sub">Entre no Mercado Livre e sincronize pelo Copiloto: cada conta em que você entrar neste Chrome aparece aqui.</p>';
        $('#salvarApelidos').hidden = !cs.length;
    }
    $('#salvarApelidos').addEventListener('click', async () => {
        const ok = $('#okApelidos'), txt = {};
        document.querySelectorAll('[data-apelido]').forEach(i => { txt[i.dataset.apelido] = i.value; });
        const sep = {}, temCaixa = !!document.querySelector('[data-empresa]');   // v3.3: contas de outra empresa (só com 2+ contas)
        document.querySelectorAll('[data-empresa]').forEach(i => { if (i.checked && /^\d{6,15}$/.test(i.dataset.empresa)) sep[i.dataset.empresa] = true; });
        try { cfg = await SHC.salvarCfg(Object.assign({ apelidos: SHC.apelidosLimpos(txt) }, temCaixa ? { empresaSeparada: sep } : {}), { semMarcar: true }); } catch (e) { ok.className = 'msg erro'; ok.textContent = FALHA; return; }   // apelido e empresa não são "imposto informado"
        ok.className = 'ok'; ok.textContent = '✓ Salvo';
        setTimeout(() => { ok.textContent = ''; }, 4000);
    });

    // ── Custos por SKU ──
    // Tem custo = o que a etiqueta usa: o do SKU ou, na falta dele, o antigo da família/anúncio (mesma conta do painel lateral).
    const temCusto = P.temCusto;
    // Só o custo antigo (campo vazio, valor em cinza): conta no lucro, mas ainda é para conferir — entra no "Só onde falta o custo".
    const soAntigo = l => !l.custo && !l.kitCalc && temCusto(l);
    const valoresAntigos = l => l.antigos.map(a => a.custo).filter((v, i, a) => a.indexOf(v) === i);
    // Mesma chave de SHC.guiaCustos: SKU normalizado ou, sem SKU, o MLB do anúncio.
    const chaveGuia = l => l.tipo === 'sku' ? 'sku:' + SHC.normalizaSku(l.sku) : 'mlb:' + l.id;
    // Busca, "Só os sem custo", "Só os que mais vendem…" e o chip de estoque, por linha (o pai fica se algum filho passa).
    // A busca também acha pelo título do pai e pelo nome da variação.
    function filtroLinha() {
        const busca = ($('#busca').value || '').trim().toLowerCase();
        const soSem = $('#soSem').checked;
        const falta = $('#soPrinc').checked ? new Set(principais.faltam.map(f => f.sku ? 'sku:' + SHC.normalizaSku(f.sku) : 'mlb:' + f.itemId)) : null;
        return (l, g) => (!soSem || !temCusto(l) || soAntigo(l)) && (!falta || falta.has(chaveGuia(l))) && (filtroEst === 'todos' || est(l).faixa === filtroEst) &&
            (!busca || [l.titulo, l.sku, l.id, l.nomeVar, g && g.titulo].concat(l.ids).join(' ').toLowerCase().indexOf(busca) >= 0);
    }
    // Estoque por linha (cache por desenho; P.estoqueLinha) e o que fica aberto (pai e opções de compra), lembrado neste Chrome.
    let filtroEst = 'todos', verFin = false, mesmoAberto = '', baseEst = null, cacheEst = new Map(), abertos = new Set();
    const est = l => { let e = cacheEst.get(l); if (!e) { e = P.estoqueLinha(l, baseEst || (baseEst = P.baseEstoque(retrato.itens, retrato.full))); cacheEst.set(l, e); } return e; };
    const LS_ABERTOS = 'shc:custos:abertos';
    try { abertos = new Set(JSON.parse(localStorage.getItem(LS_ABERTOS) || '[]')); } catch (e) { abertos = new Set(); }
    const lembraAbertos = () => { try { localStorage.setItem(LS_ABERTOS, JSON.stringify([...abertos].slice(-200))); } catch (e) { /* só conforto */ } };
    const seloHtml = (e, l) => {
        const s = P.selos(e);
        if (!s.length) return '<span class="cinza">—</span>';
        return s.map(x => `<span class="est ${x.cls}"${x.cls === 'nl' ? ' title="O Copiloto lê o estoque quando sincroniza (a cada 3 horas) ou quando você abre a lista de Anúncios do Mercado Livre."' : ''}>${esc(x.txt)}</span>`).join('');
    };
    // o = { cls (classes da linha), de (grupo), nome (nome da variação), achou, abrirOp } — sem o, a linha simples de sempre.
    function linhaHtml(l, o) {
        o = o || {};
        const k = l.tipo === 'sku' ? 'sku|' + l.sku : l.canal + '|' + l.id;
        const c = l.custo || {};
        const vivos = l.ids.filter(id => !P.finalizado(porIdRet[id]));
        // 2 ou mais anúncios do mesmo SKU = opções de compra (Clássico/Premium/catálogo): abrem embaixo, com o custo do SKU.
        const chOp = 'op:' + k, opAberta = vivos.length > 1 && (abertos.has(chOp) || o.abrirOp);
        const qtd = vivos.length > 1 ? `<button class="tag opc" type="button" aria-expanded="${!!opAberta}" data-tog="${esc(chOp)}">${vivos.length} opções de compra ${opAberta ? '▾' : '▸'}</button>`
            : esc(vivos.length ? SHC.qtd(vivos.length, 'anúncio', 'anúncios') : l.ids.length ? SHC.qtd(l.ids.length, 'anúncio finalizado', 'anúncios finalizados') : 'sem anúncio no ML agora');
        const sub = l.tipo === 'sku' ? esc('SKU ' + l.sku + ' · ') + qtd
            : esc((l.canal === 'sp' ? 'Shopee · ' : '') + l.id);
        let dica = '';
        // Custo antigo (v2.0) gravado na família da promoção (F…) ou no anúncio: um valor só → usa no SKU com 1 clique.
        const vs = l.custo ? [] : valoresAntigos(l);
        if (vs.length === 1) dica = `<span class="dica">Custo antigo ${esc(SHC.moeda(vs[0]))} (${l.antigos.some(a => /^F/.test(a.id)) ? 'da promoção' : 'do anúncio'}) · <button class="lnk" data-usar="1">usar ${l.tipo === 'sku' ? 'para o SKU' : 'neste anúncio'}</button></span>`;
        else if (vs.length > 1) dica = `<span class="dica">Custos antigos diferentes nos anúncios: ${esc(vs.map(v => SHC.moeda(v)).join(', '))}. Informe o custo aqui.</span>`;
        else if (l.custo) {
            // O SKU tem custo E algum anúncio dele tem custo próprio diferente: mostra os dois, nunca esconde (P.dicaDivergencia).
            const dv = P.dicaDivergencia(l);
            if (dv) dica = `<span class="dica alerta">${esc(dv)}${P.idsQuePrevalecem(l).map(id => ` · <button class="lnk" data-rm-antigo="${esc(id)}">usar o do SKU em ${esc(id)}</button>`).join('')}</span>`;
        }
        if (l.custo && P.custoSuspeito(SHC.num(c.custo), l.precos)) dica = `<span class="dica alerta">Custo maior que o preço de venda (${esc(SHC.moeda(Math.max.apply(null, l.precos)))}). Confira se não sobrou um zero.</span>` + dica;
        const origem = l.custo ? ((c.origem === 'erp' && SHC.tinyDigitado(c) ? 'digitado' : ORIGEM(c)) ||(l.tipo === 'sku' ? 'digitado' : 'por anúncio')) + (c.atualizado ? ' · ' + dataBR(c.atualizado) : '') : l.kitCalc ? 'kit · soma ' + SHC.moeda(l.kitCalc.custo) : '—';   // sem custo ou só o antigo: o campo e a dica já dizem (não repete na Origem)
        const e = est(l), cls = [o.cls, e.faixa === 'zero' ? 'zerada' : '', o.achou ? 'achou' : ''].filter(Boolean).join(' ');
        const nome = o.nome ? `<b title="${esc(l.titulo || '')}"><span class="var">${esc(o.nome)}</span></b>` : `<b title="${esc(l.titulo || '')}">${esc(l.titulo || '(sem título)')}</b>`;
        const semCusto = !temCusto(l), rot = esc(o.nome || l.sku || l.titulo || l.id);
        let html = `<tr data-k="${esc(k)}"${cls ? ' class="' + cls + '"' : ''}${o.de ? ' data-de="' + esc(o.de) + '"' : ''}>
  <td class="tit">${nome}<span>${l.tipo === 'anuncio' ? '<span class="tag' + (l.canal === 'sp' ? ' sp' : '') + '"' + (l.skuNaoLido ? ' title="' + esc(P.EXPLICA_SKU_NAO_LIDO) + '"' : '') + '>' + esc(P.etiquetaAnuncio(l)) + '</span> ' : ''}${sub}</span></td>
  <td class="estq">${seloHtml(e, l)}</td>
  <td data-r="Custo (R$)"><input class="inp${semCusto ? ' falta' : ''}" data-f="custo" inputmode="decimal" value="${esc(nfr(c.custo))}" placeholder="${semCusto ? 'falta o custo' : vs.length === 1 ? esc(nfr(vs[0])) : l.kitCalc ? esc(nfr(l.kitCalc.custo)) : ''}" aria-label="Custo de ${rot}">${dica}</td>
  <td data-r="Embalagem/outros"><input class="inp" data-f="outros" inputmode="decimal" value="${esc(nfr(c.outros))}" placeholder="0,00" aria-label="Embalagem e outros de ${rot}"></td>
  <td data-r="Origem" style="color:#64748B;font-size:12px;white-space:nowrap">${esc(origem)}</td>
  <td>${l.custo ? '<button class="x" data-rm="1" title="Apagar este custo">×</button>' : ''}</td></tr>`;
        if (opAberta) html += vivos.map((id, i) => {
            const it = porIdRet[id] || {}, a = P.idsQuePrevalecem(l).indexOf(id) >= 0 && l.antigos.find(x => String(x.id) === id);
            const tipo = [it.tipo, it.catalogoML ? 'Catálogo' : '', it.status === 'paused' ? 'pausado' : ''].filter(Boolean).join(' · ');
            const usa = a ? `<span class="dica alerta" style="margin:0">Custo próprio ${esc(SHC.moeda(a.custo))}: o lucro deste anúncio usa esse · <button class="lnk" data-rm-antigo="${esc(id)}">usar o do SKU</button></span>`
                : '<span class="usa">Usa o custo do SKU</span>';
            return `<tr class="${o.de ? 'neto' : 'fil opcl'}${i === vivos.length - 1 ? ' ult' : ''}" data-de="${esc(chOp)}">
  <td class="tit"><b>${esc(id + (tipo ? ' · ' + tipo : ''))}</b>${tipo ? '' : '<span><span class="tag opc">opção de compra</span></span>'}</td>
  <td class="estq"></td>
  <td colspan="3" class="cpai">${usa}</td><td class="vaz"></td></tr>`;
        }).join('');
        return html;
    }
    // Linha do PAI (família do ML / anúncio com variações): título, "N variações", estoque somado, "N de M com custo" e "Mesmo custo para todas".
    function paiHtml(g, aberto) {
        const fs = g.todosFilhos || g.filhos, todos = fs.length, es = fs.map(est), com = fs.filter(temCusto).length, ant = fs.filter(soAntigo).length;   // custo antigo: sem ✓ (ainda é para conferir)
        // Variações que usam o MESMO anúncio (anúncio antigo com variações, grupo 'v:') recebem o estoque do anúncio inteiro: conta 1 vez (o maior).
        // ponytail: dedupe pela lista exata de anúncios; um filho com anúncio compartilhado + um próprio ainda soma o compartilhado.
        const porIds = {}; fs.forEach((l, i) => { const e = es[i]; if (e.lido) { const k = l.ids.slice().sort().join(); porIds[k] = Math.max(porIds[k] || 0, e.total || 0); } });
        const soma = Object.keys(porIds).reduce((t, k) => t + porIds[k], 0);
        const zer = es.filter(e => e.faixa === 'zero').length, faltaLer = es.filter(e => e.faixa === 'nl' && !e.semAnuncio).length, fx = P.faixaGrupo(g, est);
        const anuncios = new Set(); fs.forEach(l => l.ids.forEach(id => { if (!P.finalizado(porIdRet[id])) anuncios.add(id); }));
        const selo = fx === 'zero' ? '<span class="est zero">Zerado</span>' : fx === 'tem' ? `<span class="est tem">Com estoque ${esc(milhar(soma))}</span>` : seloHtml({ faixa: 'nl' });
        // Termo neutro: o filho diz se é "Zerado" ou "Pausado sem estoque"; o pai só conta.
        const avisos = [fx !== 'zero' && zer ? (zer === 1 ? '1 variação sem estoque' : zer + ' variações sem estoque') : '',
            fx === 'tem' && faltaLer ? (faltaLer === 1 ? 'falta ler 1 variação' : 'falta ler ' + faltaLer + ' variações') : ''].filter(Boolean).join(' · ');
        const dicaEst = avisos ? `<span class="dica alerta">${avisos}</span>` : fx === 'zero' ? `<span class="dica">${fs.length === 1 ? 'a variação' : 'as ' + fs.length + ' variações'}</span>` : '';
        // A caixinha usa o MESMO critério do resumo (P.temCusto): custo do kit ou antigo do anúncio conta como "já tem" e só muda marcando.
        const nComCusto = com, semC = fs.length - nComCusto, outros = fs.filter(l => !l.custo && temCusto(l)).length;
        const mesmo = mesmoAberto === g.chave ? `<div class="mesmo"><div class="lin"><b style="font-size:12.5px">Mesmo custo para todas as variações:</b><input class="inp" data-mesmo-val inputmode="decimal" placeholder="R$" aria-label="Custo para todas as variações"><button class="bt verde" type="button" data-mesmo-ok="${esc(g.chave)}">Aplicar</button></div>`
            + (nComCusto ? `<label><input type="checkbox" data-mesmo-todas${semC || outros ? '' : ' checked'}> Trocar também ${nComCusto === 1 ? 'a 1 que já tem' : 'as ' + nComCusto + ' que já têm'} custo${outros ? ' (' + (outros === 1 ? '1 usa' : outros + ' usam') + ' a soma do kit ou o custo do anúncio)' : ''}${semC ? '. Sem marcar, só preenche ' + (semC === 1 ? 'a 1 vazia' : 'as ' + semC + ' vazias') : ''}</label>` : '') + '</div>'
            : `<button class="lnk" type="button" data-mesmo="${esc(g.chave)}">Mesmo custo para todas as variações</button>`;
        return `<tr class="pai${fx === 'zero' ? ' zerada' : ''}" data-pai="${esc(g.chave)}">
  <td class="tit"><div class="cab"><button class="tog" type="button" aria-expanded="${aberto}" aria-label="${aberto ? 'Recolher' : 'Abrir'} variações" data-tog="${esc(g.chave)}">${aberto ? '▾' : '▸'}</button><div>
    <b title="${esc(g.titulo)}">${esc(g.titulo || '(sem título)')}</b><span><span class="tag fam">${todos} variações</span> ${esc(SHC.qtd(anuncios.size, 'anúncio', 'anúncios'))}${g.filhos.length < todos ? ' · mostrando ' + g.filhos.length + ' de ' + todos : ''}</span></div></div></td>
  <td class="estq">${selo}${dicaEst}</td>
  <td class="cpai" colspan="3" data-r="Custo"><span class="resumo"${com < fs.length || ant ? ' style="color:var(--ambar);font-weight:600"' : ''}>${com} de ${fs.length} variações com custo${ant ? ` · <button class="lnk" type="button" data-ver-antigo="${esc(g.chave)}">${ant === 1 ? '1 custo antigo' : ant + ' custos antigos'}</button>` : com === fs.length ? ' ✓' : ''}</span>${mesmo}</td>
  <td class="vaz"></td></tr>`;
    }
    // Um grupo (pai + filhos abertos, ou a linha simples) em HTML. busca = o texto procurado (abre o pai e pinta a variação achada).
    function grupoHtml(g, abrir, busca) {
        if (g.tipo !== 'pai') return linhaHtml(g.filhos[0], { abrirOp: busca && g.filhos[0].ids.some(id => id.toLowerCase().indexOf(busca) >= 0) });
        const aberto = abrir || abertos.has(g.chave);
        let html = paiHtml(g, aberto);
        if (aberto) html += g.filhos.map((l, i) => linhaHtml(l, { cls: 'fil' + (i === g.filhos.length - 1 ? ' ult' : ''), de: g.chave, nome: l.nomeVar,
            achou: !!busca && String(g.titulo || '').toLowerCase().indexOf(busca) < 0, abrirOp: busca && l.ids.some(id => id.toLowerCase().indexOf(busca) >= 0) })).join('');
        return html;
    }
    let redesenharDepois = false, usarAntigos = [];
    // Seção "Custo dos produtos que mais vendem": as 3 formas + progresso dos 10 principais (etapa "custos" do guia).
    const txtPrincipais = () => principais.de ? principais.com + ' de ' + principais.de + ' principais com custo' : '';
    function desenhaPrincipais() {
        const pronto = !!guia.feitos.custos || (principais.de > 0 && principais.com >= principais.de);
        $('#cPrinc').textContent = txtPrincipais() || 'Primeiro o Copiloto precisa ler a sua conta do Mercado Livre.';
        $('#cProg').style.width = (principais.de ? Math.round(principais.com / principais.de * 100) : 0) + '%';   // v3.2.0: uma fração só (o total fica em "Custos por SKU")
        $('#cJa').hidden = pronto;
        $('#cFaltam').hidden = !principais.faltam.length;
        $('#cFaltamLista').innerHTML = principais.faltam.map(f => `<li>${esc(f.titulo || f.sku || f.itemId)}${f.sku ? ' <span class="cinza">SKU ' + esc(f.sku) + '</span>' : ''}</li>`).join('');
        $('#cOk').textContent = pronto ? '✓ Etapa de custos concluída. O guia segue no painel lateral.' : '';
    }
    // "Puxar do ERP ou de planilha ↓": vai para "Custos do ERP" — o único lugar com conectar o ERP e importar planilha (v3.2.0).
    $('#cTiny').addEventListener('click', () => { $('#erp').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    // Mostra na tabela só os principais sem custo, com o campo de custo de cada um.
    $('#cDigitar').addEventListener('click', () => { $('#soPrinc').checked = true; $('#busca').value = ''; desenhaTabela(); $('#lista').scrollIntoView({ behavior: 'smooth' }); });
    $('#cJa').addEventListener('click', async () => { await gravaGuia({ feitos: { custos: SHC.hoje() } }); desenhaPrincipais(); salvoEFecha('✓ Salvo'); });

    // ── Kits (produto composto): SKU do kit = lista de SKUs × quantidade; custo = soma (SHC.kitDe) ──
    let kitsTodos = false;   // "Ver mais (N)" ↔ "Ver menos" da tabela de kits (10 à vista)
    function desenhaKits() {
        const todas = P.linhasKits(kits), ls = kitsTodos ? todas : todas.slice(0, 10);
        const vm = todas.length > 10 ? `<tr><td colspan="4" style="text-align:center"><button class="bt sec" type="button" data-kits-ver aria-expanded="${kitsTodos}">${kitsTodos ? 'Ver menos' : `Ver mais (${todas.length - 10})`}</button></td></tr>` : '';
        $('#kCorpo').innerHTML = ls.length ? ls.map(l => `<tr data-kit="${esc(l.sku)}">
  <td style="word-break:break-all;min-width:80px"><b>${esc(l.sku)}</b></td>
  <td style="font-size:12.5px">${esc(l.dentro)}</td>
  <td>${l.custo !== null ? '<b>' + esc(SHC.moeda(SHC.r2(l.custo + l.outros))) + '</b><span class="dica">' + (l.proprio ? 'custo do próprio kit' + (l.soma !== null ? ' · soma dos itens ' + esc(SHC.moeda(l.soma)) : '') : 'soma dos itens')
        + (l.outros ? ' + ' + esc(SHC.moeda(l.outros)) + ' de embalagem/outros' : '') + '</span>'
        : '<b style="color:var(--ambar)">Falta o custo</b><span class="dica alerta">de: ' + esc(l.faltam.join(', ')) + '</span>'}</td>
  <td style="white-space:nowrap"><button class="lnk" data-kit-ed="1">editar</button> <button class="x" data-kit-rm="1" title="Deixar de ser kit">×</button></td></tr>`).join('') + vm
            : '<tr><td colspan="4" class="vazio">Nenhum kit ainda.</td></tr>';
    }
    $('#kCorpo').addEventListener('click', async e => {
        if (e.target.closest('[data-kits-ver]')) { kitsTodos = !kitsTodos; desenhaKits(); return; }
        const tr = e.target.closest('tr[data-kit]'), k = tr && kits.kits.find(x => x.sku === tr.getAttribute('data-kit'));
        if (!k) return;
        if (e.target.closest('[data-kit-ed]')) {
            $('#kForm').open = true; $('#kSku').value = k.sku;
            $('#kItens').value = k.dados.kit.map(i => i.sku + ' x ' + i.q).join('\n');
            $('#kOutros').value = nfr(k.dados.outros); $('#kSku').focus();
        } else if (e.target.closest('[data-kit-rm]')) {
            try { await SHC.salvarKit(k.sku, [], undefined); } catch (err) { falhaTabela(null); return; }
            await lerDados(); desenhaTabela();
        }
    });
    $('#kSalvar').addEventListener('click', async () => {
        const msg = $('#kMsg'), sku = SHC.normalizaSku($('#kSku').value), r = SHC.lerComposicao($('#kItens').value, sku), o = P.valorCampo($('#kOutros').value);
        const erro = !sku ? 'Digite o SKU do kit.' : r.erros[0] || (!r.itens.length ? 'Diga o que vai dentro do kit (um SKU por linha).' : !o.ok || o.valor < 0 ? 'Embalagem/outros: digite só o número. Ex.: 2,50' : '');
        msg.className = erro ? 'msg erro' : 'ok';
        if (erro) { msg.textContent = erro; return; }
        try { await SHC.salvarKit(sku, r.itens, o.valor || 0); } catch (err) { msg.className = 'msg erro'; msg.textContent = FALHA; return; }
        await lerDados(); desenhaTabela();
        const l = P.linhasKits(kits).find(x => x.sku === sku);
        msg.textContent = l && l.custo !== null ? '✓ Kit salvo: ' + SHC.moeda(l.custo) : '✓ Kit salvo. Falta o custo de: ' + (l ? l.faltam.join(', ') : '');
        $('#kSku').value = ''; $('#kItens').value = ''; $('#kOutros').value = '';
    });

    function desenhaTabela() {
        desenhaPrincipais();
        desenhaKits();
        redesenharDepois = false;
        const todas = modelo.skus.concat(modelo.anuncios);
        // Progresso = SKUs + anúncios sem SKU (igual ao Catálogo do painel lateral). Com retrato, SKU sem anúncio na conta
        // (ex.: produto que só existe no Tiny) e custo só antigo não entram.
        // v3.2: anúncio finalizado no ML (closed) fica fora por padrão — não conta no progresso nem nos chips ("Mostrar finalizados").
        const fin = l => temRetrato && P.linhaFinalizada(l, porIdRet), nFin = todas.filter(fin).length;
        const vivas = l => verFin || !fin(l);
        const base = modelo.skus.filter(l => (!temRetrato || l.ids.length) && !fin(l)).concat(modelo.anuncios.filter(l => !l.antigo && !fin(l)));
        const com = base.filter(temCusto).length;
        // v3.2.0: quem só tem o custo antigo (campo vazio, valor em cinza) fica à parte: "3 de 8 com custo · 5 com custo antigo para conferir".
        // A barra e o % contam só os confirmados — senão "100%" com 5 campos vazios. (A etiqueta continua usando o custo antigo.)
        const antigos = base.filter(soAntigo), nAntigo = antigos.length, conf = com - nAntigo;
        $('#contador').textContent = base.length ? conf + ' de ' + base.length + ' produtos com custo' : 'Nenhum produto ainda';
        // Ação em lote no lugar do texto: grava de uma vez os custos antigos de valor único (os com valores diferentes pedem o custo na linha).
        usarAntigos = antigos.filter(l => valoresAntigos(l).length === 1);
        $('#usarAntigos').hidden = !nAntigo;
        $('#usarAntigos').textContent = usarAntigos.length ? 'Usar ' + (usarAntigos.length === 1 ? 'o 1 custo antigo' : 'os ' + usarAntigos.length + ' custos antigos')
            : SHC.qtd(nAntigo, 'custo antigo', 'custos antigos') + ' para conferir';
        const pctCusto = base.length ? Math.round(conf / base.length * 100) : 0;
        $('#contProg').style.width = pctCusto + '%';
        $('#contPct').textContent = base.length ? pctCusto + '%' : '';
        $('#finLbl').hidden = !nFin;
        $('#finN').textContent = nFin ? '(' + nFin + ')' : '';
        // Chips de estoque (contagem por SKU/anúncio) + quando o estoque foi lido. Sem retrato: some (não há estoque para mostrar).
        // Mesma base do contador (SKU sem anúncio e custo antigo de anúncio fora da lista ficam à parte); com "Mostrar finalizados", eles entram.
        const noContador = l => l.tipo === 'sku' ? (!temRetrato || l.ids.length) : !l.antigo;
        const vivasT = todas.filter(vivas), n = P.contaEstoque(vivasT.filter(noContador), est), semAn = temRetrato ? vivasT.length - n.todos : 0;
        $('#fEst').hidden = !temRetrato;
        $('#fEst').innerHTML = [['todos', 'Todos', n.todos], ['tem', 'Com estoque', n.tem], ['zero', 'Zerados', n.zero]].map(([k, t, q]) =>
            `<button type="button" data-est="${k}" class="${filtroEst === k ? 'on' : ''}" aria-pressed="${filtroEst === k}">${t}<b>${q}</b></button>`).join('')
            + (n.nl ? `<span class="nl">${n.nl === 1 ? '1 ainda sem leitura' : n.nl + ' ainda sem leitura'} de estoque</span>` : '')   // o "· " vem do CSS (some quando quebra a linha)
            + (semAn ? `<span class="nl">${semAn} sem anúncio ativo no ML</span>` : '');
        // Legenda curta das palavras do estoque (as mesmas dos selos); a ordem já aparece na linha "Zerados · no fim da lista".
        // A legenda só aparece quando há as duas palavras na tela (alguma linha "Pausado sem estoque").
        const temPausa = temRetrato && vivasT.some(l => { const e = est(l); return e.faixa === 'zero' && e.pausa; });
        $('#estInfo').textContent = temRetrato ? (temPausa ? 'Zerado = ativo e sem estoque · Pausado sem estoque = parado porque o estoque acabou. ' : '') + P.textoLeituraEstoque(retrato.ts) : '';
        const busca = ($('#busca').value || '').trim().toLowerCase(), passa = filtroLinha();
        // Pai → variações (P.agrupa) e o filtro olhando cada variação; anúncio sem SKU fica no grupo de sempre.
        let gs = P.filtraGrupos(P.agrupa(modelo.skus.filter(vivas), retrato.itens, retrato.familias, retrato.full), passa);
        let ans = P.filtraGrupos(modelo.anuncios.filter(vivas).map(l => ({ tipo: 'solo', chave: 'a:' + l.canal + '|' + l.id, filhos: [l] })), passa);
        const corpo = $('#corpo'), MAX = 400, vendasDe = l => vendasChave[chaveGuia(l)];
        // Sem busca nem filtro: só os 10 que mais vendem (o grupo vale 1, com as vendas somadas), com "Ver mais (N)". A busca e os
        // filtros continuam procurando em todos. Depois: com estoque → não lido → zerados.
        // Qualquer filtro (inclusive o chip de estoque) abre os pais: a variação que bateu (ex.: a zerada) aparece sem precisar abrir.
        const abreTudo = !!busca || $('#soSem').checked || $('#soPrinc').checked || filtroEst !== 'todos';
        const filtrando = abreTudo;
        let escondidas = 0;
        if (!filtrando && !verTodos) {
            const r = P.reduzida(gs.concat(ans), g => g.filhos.reduce((t, l) => t + (vendasDe(l) || 0), 0), 10);
            escondidas = r.escondidas;
            gs = r.linhas.filter(g => g.chave.slice(0, 2) !== 'a:'); ans = r.linhas.filter(g => g.chave.slice(0, 2) === 'a:');
        }
        gs = P.ordenaGrupos(gs, est, vendasDe); ans = P.ordenaGrupos(ans, est, vendasDe);
        if (!gs.length && !ans.length) {
            corpo.innerHTML = `<tr><td colspan="6" class="vazio">${todas.length ? 'Nada encontrado com esse filtro.'
                : 'Nenhum produto ainda. Abra a lista de Anúncios do Mercado Livre neste Chrome: o Copiloto lê seus SKUs sozinho.'}</td></tr>`;
            $('#rodape').textContent = '';
            return;
        }
        let html = '', faixaZero = false;
        gs.slice(0, MAX).forEach(g => {
            if (!faixaZero && temRetrato && P.faixaGrupo(g, est) === 'zero') { faixaZero = true; html += '<tr class="grp"><td colspan="6">Zerados · no fim da lista</td></tr>'; }
            html += grupoHtml(g, abreTudo, busca);
        });
        if (ans.length) html += '<tr class="grp"><td colspan="6">' + esc(P.tituloGrupoAnuncios(P.contaAnuncios(ans.map(g => g.filhos[0])))) + ' · o custo fica gravado no próprio anúncio</td></tr>' + ans.slice(0, MAX).map(g => grupoHtml(g, abreTudo, busca)).join('');
        if (escondidas) html += `<tr><td colspan="6" style="text-align:center"><button class="bt sec" type="button" data-ver-todos="1" aria-expanded="false">Ver mais (${escondidas})</button></td></tr>`;
        else if (verTodos && !filtrando && gs.length + ans.length > 10) html += `<tr><td colspan="6" style="text-align:center"><button class="bt sec" type="button" data-ver-todos="1" aria-expanded="true">Ver menos</button></td></tr>`;
        corpo.innerHTML = html;
        const cortou = gs.length > MAX || ans.length > MAX;
        $('#rodape').textContent = (escondidas ? 'Mostrando os ' + (gs.length + ans.length) + ' que mais vendem · ' : '') + SHC.qtd(modelo.skus.filter(vivas).length, 'SKU', 'SKUs') + P.rodapeAnuncios(P.contaAnuncios(modelo.anuncios.filter(vivas)))
            + (nFin && !verFin ? ' · ' + SHC.qtd(nFin, 'finalizado fora da lista', 'finalizados fora da lista') : '')
            + (cortou ? ' · mostrando até ' + MAX + ' (use a busca)' : '')
            + (temRetrato ? '' : ' · Os SKUs aparecem depois que o Copiloto ler a lista de Anúncios do Mercado Livre.');
    }
    const contaEsc = $('#contaEsc');   // F16: trocar a conta da tabela relê só o retrato dela (nenhum pedido ao ML)
    if (contaEsc && contaEsc.addEventListener) contaEsc.addEventListener('change', async () => { contaVer = contaEsc.value || ''; await lerDados(); desenhaTabela(); desenhaErpx(); desenhaContaTab().catch(() => {}); });
    $('#corpo').addEventListener('click', e => {
        if (!(e.target.closest && e.target.closest('[data-ver-todos]'))) return;
        verTodos = !verTodos; desenhaTabela();
        if (!verTodos) { const l = $('#lista'); if (l && l.scrollIntoView) l.scrollIntoView({ block: 'nearest' }); }   // "Ver menos": volta ao topo da lista
    });
    // Abrir/recolher (pai e opções de compra), "Mesmo custo para todas as variações".
    $('#corpo').addEventListener('click', async e => {
        const t = e.target.closest && e.target.closest('[data-tog]'), m = e.target.closest && e.target.closest('[data-mesmo]'), ok = e.target.closest && e.target.closest('[data-mesmo-ok]');
        if (t) {
            const k = t.getAttribute('data-tog');
            if (abertos.has(k)) abertos.delete(k); else abertos.add(k);
            lembraAbertos(); desenhaTabela();
            return;
        }
        if (m) { mesmoAberto = m.getAttribute('data-mesmo'); abertos.add(mesmoAberto); desenhaTabela(); const i = document.querySelector('[data-mesmo-val]'); if (i && i.focus) i.focus(); return; }
        if (!ok) return;
        const g = P.agrupa(modelo.skus, retrato.itens, retrato.familias, retrato.full).find(x => x.chave === ok.getAttribute('data-mesmo-ok'));
        const caixa = ok.closest('.mesmo'), inp = caixa && caixa.querySelector('[data-mesmo-val]'), todas = caixa && caixa.querySelector('[data-mesmo-todas]');
        const lido = P.valorCampo(inp && inp.value);
        if (!g || !lido.ok || !(lido.valor > 0)) { if (inp) avisa(inp, '#B91C1C', 'Digite só o número. Ex.: 18,40'); msgTabela('Digite o custo (só o número, ex.: 18,40). Nada foi mudado.'); return; }
        const skus = P.aplicaMesmoCusto(g.filhos, lido.valor, !!(todas && todas.checked));
        const kitOuAnuncio = g.filhos.filter(l => skus.indexOf(l.sku) >= 0 && !l.custo && temCusto(l)).length;
        let salvos = 0;
        try {
            for (const s of skus) { const l = g.filhos.find(x => x.sku === s); await SHC.salvarCustoSku(s, Object.assign({ custo: lido.valor, origem: 'manual' }, l && l.custo && l.custo.titulo ? {} : { titulo: (l && l.titulo) || '' })); salvos++; }
        } catch (err) {
            // Parte já foi gravada: redesenha com os valores novos e diz quantas entraram.
            try { await lerDados(); desenhaTabela(); } catch (e2) { /* a mensagem abaixo já avisa */ }
            msgTabela('Salvei ' + salvos + ' de ' + skus.length + ' variações e a gravação parou. Confira e tente de novo.');
            return;
        }
        mesmoAberto = '';
        await lerDados(); desenhaTabela();
        msgTabela(skus.length ? '✓ ' + SHC.qtd(skus.length, 'variação salva', 'variações salvas') + ' com ' + SHC.moeda(lido.valor)
            + (kitOuAnuncio ? ' (' + (kitOuAnuncio === 1 ? '1 usava' : kitOuAnuncio + ' usavam') + ' a soma do kit ou o custo do anúncio: agora usa' + (kitOuAnuncio === 1 ? '' : 'm') + ' este valor)' : '') + '.'
            : 'Todas as variações já tinham custo: marque “Trocar também” para mudar.', !!skus.length);
    });
    $('#busca').addEventListener('input', desenhaTabela);
    $('#soSem').addEventListener('change', desenhaTabela);
    // "1 custo antigo" no pai: abre a família já filtrada em "Só onde falta o custo" (que inclui quem só tem o custo antigo).
    $('#corpo').addEventListener('click', e => {
        const b = e.target.closest && e.target.closest('[data-ver-antigo]');
        if (!b) return;
        $('#soSem').checked = true; abertos.add(b.getAttribute('data-ver-antigo')); lembraAbertos(); desenhaTabela();
        const p = document.querySelector('tr[data-pai="' + CSS.escape(b.getAttribute('data-ver-antigo')) + '"]');
        if (p && p.scrollIntoView) p.scrollIntoView({ block: 'nearest' });
    });
    // "Usar os N custos antigos": grava cada custo antigo de valor único como custo do SKU/anúncio (o mesmo do "usar para o SKU" da linha).
    $('#usarAntigos').addEventListener('click', async () => {
        if (!usarAntigos.length) { $('#soSem').checked = true; desenhaTabela(); return; }   // só valores diferentes: mostra as linhas para digitar
        const ls = usarAntigos.slice();
        let salvos = 0;
        try {
            for (const l of ls) {
                const d = { custo: valoresAntigos(l)[0], titulo: l.titulo || '', origem: 'manual' };
                if (l.tipo === 'sku') await SHC.salvarCustoSku(l.sku, d); else await SHC.salvarCusto(l.canal, l.id, d);
                salvos++;
            }
        } catch (err) {
            try { await lerDados(); desenhaTabela(); } catch (e2) { /* a mensagem abaixo já avisa */ }
            msgTabela('Salvei ' + salvos + ' de ' + ls.length + ' custos antigos e a gravação parou. Confira e tente de novo.');
            return;
        }
        await lerDados(); desenhaTabela();
        msgTabela('✓ ' + SHC.qtd(salvos, 'custo antigo virou custo', 'custos antigos viraram custo') + '. Dá para mudar qualquer um na tabela.', true);
    });
    $('#soPrinc').addEventListener('change', desenhaTabela);
    $('#verFin').addEventListener('change', () => { verFin = !!$('#verFin').checked; desenhaTabela(); });
    $('#fEst').addEventListener('click', e => {
        const b = e.target.closest && e.target.closest('[data-est]');
        if (!b) return;
        filtroEst = b.getAttribute('data-est');
        desenhaTabela();
    });
    function msgTabela(txt, bom) { const m = $('#msgTab'); m.className = bom ? 'ok' : 'msg erro'; m.textContent = txt; }

    function falhaTabela(el) { if (el) avisa(el, '#B91C1C', FALHA); msgTabela(FALHA); }
    function avisa(el, cor, dica) {
        el.style.borderColor = cor;
        el.title = dica || '';
        setTimeout(() => { el.style.borderColor = ''; }, 1200);
    }
    $('#corpo').addEventListener('change', async e => {
        const campo = e.target.getAttribute('data-f');
        const tr = e.target.closest('tr[data-k]');
        const l = tr && porChave.get(tr.getAttribute('data-k'));
        if (!campo || !l) return;
        const lido = P.valorCampo(e.target.value), valor = lido.valor;
        if (!lido.ok || (valor !== null && valor < 0)) {   // texto que não é número não apaga o custo gravado
            e.target.value = nfr(l.custo ? l.custo[campo] : '');
            avisa(e.target, '#B91C1C', lido.ok ? 'Use um valor positivo' : 'Digite só o número. Ex.: 25,90');
            msgTabela(lido.ok ? 'Use um valor positivo.' : 'Valor não entendido: digite só o número, por exemplo 25,90. Nada foi mudado.');
            return;
        }
        const custoAtual = l.custo ? SHC.num(l.custo.custo) : null;
        if (campo === 'outros' && !(custoAtual > 0)) { avisa(e.target, '#B45309', 'Informe o custo primeiro'); return; }
        const titulo = l.custo && l.custo.titulo ? {} : { titulo: l.titulo || '' };
        try {
            if (l.tipo === 'sku') {
                if (campo === 'custo') await SHC.salvarCustoSku(l.sku, valor > 0 ? Object.assign({ custo: valor, origem: 'manual' }, titulo) : { custo: 0 });
                else await SHC.salvarCustoSku(l.sku, { custo: custoAtual, outros: valor === null ? 0 : valor });
            } else if (campo === 'custo' && !(valor > 0)) await SHC.removerCusto(l.canal, l.id);
            else await SHC.salvarCusto(l.canal, l.id, campo === 'custo' ? Object.assign({ custo: valor, origem: 'manual' }, titulo) : { outros: valor === null ? 0 : valor });
        } catch (err) {
            e.target.value = nfr(l.custo ? l.custo[campo] : '');   // volta ao que está gravado
            falhaTabela(e.target);
            return;
        }
        $('#msgTab').textContent = '';
        await lerDados();
        redesenharDepois = true;
        const suspeito = campo === 'custo' && valor > 0 && P.custoSuspeito(valor, l.precos);
        avisa(e.target, suspeito ? '#B45309' : '#10B981', suspeito ? 'Custo maior que o preço de venda. Confira se não sobrou um zero.' : '');
    });
    // Redesenha só quando o seller sai da tabela (não atrapalha quem está digitando).
    $('#corpo').addEventListener('focusout', () => setTimeout(() => {
        if (redesenharDepois && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('#corpo'))) desenhaTabela();
    }, 50));
    $('#corpo').addEventListener('click', async e => {
        const rm = e.target.closest('[data-rm]'), usar = e.target.closest('[data-usar]'), rmAntigo = e.target.closest('[data-rm-antigo]');
        if (!rm && !usar && !rmAntigo) return;
        const tr = e.target.closest('tr[data-k]');
        const l = tr && porChave.get(tr.getAttribute('data-k'));
        if (!l && !rmAntigo) return;   // "usar o do SKU" da linha da opção de compra (sem data-k) só precisa do MLB
        try {
            // Custo próprio do anúncio que ganhava do SKU (P.dicaDivergencia): apaga só o do anúncio; o lucro passa a usar o do SKU.
            // custo 0 (não remove o registro: outros campos dele ficam).
            if (rmAntigo) await SHC.salvarCusto('ml', rmAntigo.getAttribute('data-rm-antigo'), { custo: 0 });
            else if (usar) {   // grava o custo antigo (valor único) como custo do SKU / do anúncio
                const d = { custo: valoresAntigos(l)[0], titulo: l.titulo || '' };
                if (l.tipo === 'sku') await SHC.salvarCustoSku(l.sku, Object.assign(d, { origem: 'manual' }));
                else await SHC.salvarCusto(l.canal, l.id, Object.assign(d, { origem: 'manual' }));
            } else if (l.tipo === 'sku') await SHC.salvarCustoSku(l.sku, { custo: 0 });
            else await SHC.removerCusto(l.canal, l.id);
        } catch (err) { falhaTabela(null); return; }
        $('#msgTab').textContent = '';
        await lerDados();
        desenhaTabela();
    });

    // ── Planilha: backup/modelo e importação com prévia ──
    function desenhaCopia() {
        $('#ultimaCopia').textContent = guia.ultimoBackup ? 'Última cópia baixada em ' + dataBR(guia.ultimoBackup) + '.' : 'Você ainda não baixou uma cópia dos seus custos.';
    }
    async function baixarPlanilha() {
        await lerDados();
        const url = URL.createObjectURL(new Blob([SHC.paraCSV(P.linhasCSV(modelo))], { type: 'text/csv;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'copiloto-custos-' + SHC.hoje() + '.csv';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        await gravaGuia({ feitos: { backup: true }, ultimoBackup: Date.now() });
        desenhaCopia();
    }
    $('#baixar').addEventListener('click', baixarPlanilha);

    let pendente = null;
    const plural = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);
    function cancelaPrevia() { pendente = null; $('#previa').hidden = true; }
    // Erro da planilha: na seção "Planilha" e também na faixa rápida, logo acima da tabela (onde a pessoa soltou o arquivo).
    const erroImp = t => ['#msgImp', '#rMsg'].forEach(s => { $(s).className = 'msg erro'; $(s).textContent = t; });
    // texto (CSV colado/arquivo) ou tabela já em células (.xls do Tiny/Bling via SHC.lerXls)
    async function prepararImportacao(texto, tabela) {
        const msg = $('#msgImp');
        msg.className = 'msg'; msg.textContent = '';
        if (/erro/.test($('#rMsg').className)) { $('#rMsg').className = 'msg'; $('#rMsg').textContent = ''; }
        cancelaPrevia();
        const r = tabela ? SHC.lerTabela(tabela) : SHC.lerCSV(texto);
        const ign = Object.keys(r.ignorados).map(m => r.ignorados[m] + ' ' + m).join(' · ');
        if (!r.itens.length) return erroImp((r.erros[0] && !r.linhas ? r.erros[0] : 'Nenhuma linha com custo para importar.') + (ign ? ' Linhas ignoradas: ' + ign + '.' : ''));
        const nSku = r.itens.filter(i => i.sku).length, nAn = r.itens.length - nSku;
        $('#pvTitulo').textContent = 'Encontrei ' + [nSku ? plural(nSku, 'SKU', 'SKUs') : '', nAn ? plural(nAn, 'anúncio', 'anúncios') : ''].filter(Boolean).join(' e ') + ' com custo';
        $('#pvColunas').textContent = r.formato === 'simples' ? 'Planilha sem cabeçalho: 1ª coluna = código do anúncio (MLB), 2ª = custo.'
            : [r.colunas.sku ? 'Coluna do SKU: “' + r.colunas.sku + '”' : '', r.colunas.id && (r.formato !== 'erp') ? 'Coluna do anúncio: “' + r.colunas.id + '”' : '',
                'Coluna do custo: “' + r.colunas.custo + '”'].filter(Boolean).join(' · ') + '. Confira se são as colunas certas.';
        $('#pvCorpo').innerHTML = r.itens.slice(0, 5).map(it => `<tr><td>${esc(it.sku || it.id)}</td><td class="tit"><b>${esc(it.titulo || '')}</b></td><td>${esc(SHC.moeda(it.custo))}</td></tr>`).join('');
        $('#pvIgnorados').textContent = ign ? 'Ignoradas: ' + ign + '.' + (r.erros.length ? ' Ex.: ' + r.erros.slice(0, 3).join(' · ') : '') : 'Nenhuma linha ignorada.';
        // Quantos já têm custo aqui (vão ser trocados) e quantos custos passam do preço de venda no ML.
        const chaves = r.itens.map(it => it.sku ? SHC.chaveSku(it.sku) : SHC.chave(it.canal, it.id));
        const atuais = await SHC.lerCustos(chaves);
        const ja = chaves.filter(k => atuais[k] && SHC.num(atuais[k].custo) > 0).length;
        const noML = r.itens.filter(it => porChave.get(it.sku ? 'sku|' + it.sku : it.canal + '|' + it.id));
        const semAnuncio = temRetrato ? r.itens.filter(it => it.sku && !((porChave.get('sku|' + it.sku) || {}).ids || []).length).length : 0;
        $('#pvAtualiza').textContent = [ja ? plural(ja, 'já tem custo aqui e vai', 'já têm custo aqui e vão') + ' ser atualizado' + (ja === 1 ? '' : 's') + ' com o valor da planilha.' : '',
            semAnuncio ? plural(semAnuncio, 'SKU não aparece', 'SKUs não aparecem') + ' nos seus anúncios do ML agora: o custo fica guardado para quando aparecer.' : ''].filter(Boolean).join(' ');
        const suspeitos = noML.filter(it => P.custoSuspeito(it.custo, porChave.get(it.sku ? 'sku|' + it.sku : it.canal + '|' + it.id).precos));
        $('#pvSuspeito').hidden = !suspeitos.length;
        if (suspeitos.length) {
            const ex = suspeitos[0], l = porChave.get(ex.sku ? 'sku|' + ex.sku : ex.canal + '|' + ex.id);
            $('#pvSuspeito').textContent = '⚠ ' + plural(suspeitos.length, 'custo é maior', 'custos são maiores') + ' que o preço de venda no Mercado Livre (ex.: ' + (ex.sku || ex.id) + ': custo ' + SHC.moeda(ex.custo) + ', preço ' + SHC.moeda(Math.max.apply(null, l.precos)) + '). Confira se a coluna do custo está certa.';
        }
        pendente = r.itens;
        $('#previa').hidden = false;
        $('#previa').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    $('#pvCancelar').addEventListener('click', () => { cancelaPrevia(); $('#msgImp').textContent = 'Importação cancelada. Nada foi gravado.'; });
    $('#pvImportar').addEventListener('click', async () => {
        if (!pendente) return;
        let n;
        try { n = await SHC.importar(pendente); } catch (e) { $('#msgImp').className = 'msg erro'; $('#msgImp').textContent = FALHA + ' Nada foi importado.'; return; }
        cancelaPrevia();
        await lerDados();
        desenhaTabela();
        $('#msgImp').className = 'msg ok';
        $('#msgImp').textContent = '✓ ' + plural(n, 'custo importado', 'custos importados') + '.' + (txtPrincipais() ? ' Agora: ' + txtPrincipais() + '.' : '');
    });

    // .xls (Excel 97-2003, o que o Tiny exporta) é lido direto. .xlsx ainda não: pede .xls ou CSV.
    // CSV: Excel às vezes salva em ANSI (Windows-1252) — tenta UTF-8 e cai para ANSI.
    async function lerArquivo(f) {
        const buf = await f.arrayBuffer();
        const b = new Uint8Array(buf.slice(0, 4));
        const erro = t => { cancelaPrevia(); erroImp(t); };
        if (b[0] === 0x50 && b[1] === 0x4B) return erro('Este arquivo é .xlsx. No Excel, use Arquivo › Salvar como › “Pasta de Trabalho do Excel 97-2003 (.xls)” ou “CSV” e importe de novo.');
        if (b[0] === 0xD0 && b[1] === 0xCF) {
            let tab;
            try { tab = SHC.lerXls(buf); } catch (err) {
                return erro(/protegida/.test(err.message) ? 'Esta planilha tem senha. Tire a senha no Excel e importe de novo.'
                    : 'Não consegui ler este arquivo do Excel. Salve como CSV e importe de novo.');
            }
            return prepararImportacao('', tab);
        }
        let texto;
        try { texto = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (err) { texto = new TextDecoder('windows-1252').decode(buf); }
        await prepararImportacao(texto);
    }
    $('#arquivo').addEventListener('change', async e => {
        const f = e.target.files && e.target.files[0];
        e.target.value = '';
        if (f) await lerArquivo(f);
    });
    // Arrastar e soltar a planilha em cima da tabela de custos (mesmo leitor: .xls pelo SHC.lerXls, CSV pelo SHC.lerCSV).
    const temArquivo = e => !!(e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0);
    const zona = $('#soltar');
    let arrastes = 0;
    zona.addEventListener('dragenter', e => { if (!temArquivo(e)) return; e.preventDefault(); arrastes++; zona.classList.add('arrastando'); });
    zona.addEventListener('dragover', e => { if (!temArquivo(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; zona.classList.add('arrastando'); });
    zona.addEventListener('dragleave', () => { if (--arrastes <= 0) { arrastes = 0; zona.classList.remove('arrastando'); } });
    zona.addEventListener('drop', async e => {
        e.preventDefault();
        arrastes = 0; zona.classList.remove('arrastando');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) await lerArquivo(f);
    });
    // Arquivo solto fora da tabela: o Chrome abriria o arquivo no lugar da página. Não deixa.
    window.addEventListener('dragover', e => { if (temArquivo(e)) e.preventDefault(); });
    window.addEventListener('drop', e => { if (temArquivo(e)) e.preventDefault(); });
    $('#importarColado').addEventListener('click', () => prepararImportacao($('#colar').value));

    // ── Tiny (API v2 por token, tiny.js): só lê os custos; grava origem 'erp' sem trocar o que o seller digitou ──
    const TINY = { origins: [SHC.TINY_ORIGEM] };
    // v3.3 multi-empresa (revisão 07/10/2026): "Esquecer" apaga só a credencial da empresa da conta aberta (SHC.areaEmpresa), e a permissão
    // do Chrome para o site do ERP (uma só para todas) só sai quando nenhuma outra empresa usa esse ERP.
    async function esquecerErp(chave, perm) {
        await SHC.areaEmpresa().remove(chave);
        if (await SHC.erpEmOutraEmpresa(chave).catch(() => true)) return;
        try { await chrome.permissions.remove(perm); } catch (e) { /* ok */ }
    }
    let tinyRodando = false;
    // A mensagem fica na seção "Custos do ERP" (v3.2.0: saiu a faixa rápida da tabela, que repetia conectar/importar).
    const tinyMsg = (t, erro) => { const m = $('#tinyMsg'); m.className = 'msg' + (erro ? ' erro' : (/^✓/.test(t || '') ? ' ok' : '')); m.textContent = t || ''; };
    const tinyBotoes = off => ['#tinyConectar', '#tinyAtualizar', '#tinyEsquecer'].forEach(s => { $(s).disabled = off; });
    const tinyBarra = (p, n) => impBarra({ erp: 'tiny', feito: p, de: n, unidade: n === 1 ? 'página' : 'páginas' });
    // Importação visual (Tiny, Omie): barra "Importando do Tiny: 120 de 253 SKUs" e, no fim, os cartões do resumo.
    function impBarra(p) {
        const txt = P.textoImportando(p);
        $('#impProgLin').hidden = !txt;
        if (!txt) return;
        $('#impProg').style.width = (p.de > 0 ? Math.round((p.feito || 0) / p.de * 100) : 0) + '%';
        $('#impProgTxt').textContent = txt;
    }
    function impResumo(r, nome) {
        const x = P.resumoImportacao(r, Math.max(0, principais.deTodos - principais.comTodos));
        $('#impResumo').hidden = false;
        $('#impCom').textContent = String(x.com); $('#impSem').textContent = String(x.sem); $('#impMant').textContent = String(x.mantidos); $('#impFalta').textContent = String(x.falta);
        $('#impSemTxt').textContent = 'o ' + nome + ' não tem custo';
        $('#impVerFaltam').hidden = !x.falta;
    }
    $('#impVerFaltam').addEventListener('click', () => { $('#soSem').checked = true; $('#soPrinc').checked = false; $('#busca').value = ''; desenhaTabela(); $('#lista').scrollIntoView({ behavior: 'smooth' }); });
    $('#suporteZap').href = SHC.SUPORTE_WHATSAPP;
    async function desenhaTiny() {
        const t = await SHC.lerChave(SHC.TINY_CHAVE), com = !!(t && t.token);
        $('#tinySem').hidden = com;
        $('#tinyCom').hidden = !com;
        $('#tinyMasc').textContent = com ? SHC.tinyMascara(t.token) : '';
        if (com && t.ultima && !tinyRodando && !$('#tinyMsg').textContent) tinyMsg('Última atualização em ' + dataBR(t.ultima.ts) + ': ' + SHC.tinyResumo(t.ultima) + '.');
    }
    // pedido = chrome.permissions.request(...) chamado DENTRO do clique, antes de qualquer await (senão o Chrome recusa).
    async function puxarTiny(pedido, token) {
        let deu = false;
        try { deu = await pedido; } catch (e) { deu = false; }
        if (!deu) return tinyMsg('Sem a permissão do Chrome o Copiloto não consegue ler o Tiny. Clique de novo e escolha “Permitir”.', true);
        if (tinyRodando) return;
        tinyRodando = true;
        tinyBotoes(true);
        tinyMsg('Lendo os produtos do Tiny…');
        // v3.3 multi-empresa (revisão 07/10/2026): o token é da empresa da conta aberta NO CLIQUE. A leitura leva minutos: se o ML abrir a conta
        // de outra empresa no meio, custos, token e retrato vão mesmo assim para a empresa do clique (SHC.areaEmpresa(e0)).
        try {
            const e0 = await SHC.empresaSeparada(), A = SHC.areaEmpresa(e0);
            const produtos = await SHC.tinyPuxar(token, {
                fetch: (u, i) => fetch(u, i), espera: ms => new Promise(r => setTimeout(r, ms)),
                progresso: (p, n) => { tinyMsg('Lendo os produtos do Tiny… página ' + p + ' de ' + n); tinyBarra(p, n); },
            });
            const r = await SHC.tinyGravar(produtos, 'tiny', { empresa: e0 });
            const antes = (await A.get(SHC.TINY_CHAVE))[SHC.TINY_CHAVE] || null;
            await A.set({ [SHC.TINY_CHAVE]: { token, ultima: Object.assign({ ts: Date.now() }, r) } });   // token só é guardado depois que o Tiny aceitou
            if (SHC.erpRetratoDaTela) await SHC.erpRetratoDaTela('tiny', produtos, !(antes && antes.ultima), e0);   // v3.2: cruzamento ERP × ML
            $('#tinyToken').value = '';
            await lerDados();
            desenhaTabela();
            tinyMsg('✓ ' + SHC.tinyResumo(r) + '.' + (txtPrincipais() ? ' Agora: ' + txtPrincipais() + '.' : ''));
            impResumo(r, 'Tiny');
        } catch (e) {
            tinyMsg((e && e.msg) || FALHA, true);
        } finally {
            tinyRodando = false;
            tinyBotoes(false);
            $('#impProgLin').hidden = true;
            await desenhaTiny();
        }
    }
    // ── Omie: {appKey, appSecret} guardados só neste Chrome (SHC.OMIE_CHAVE, o mesmo que omie.js/background leem); a leitura é do fundo
    // ({acao:'sincronizar_custos', erp:'omie'}), que grava o andamento em shc:status.custosProgresso e responde {ok, atualizados, semCusto, mantidos} | {ok:false, msg}. ──
    const OMIE = { origins: [SHC.OMIE_ORIGEM] };
    let omieRodando = false;
    async function desenhaOmie() {
        const o = await SHC.lerChave(SHC.OMIE_CHAVE), com = !!(o && o.appKey && o.appSecret);
        $('#omieSem').hidden = com;
        $('#omieCom').hidden = !com;
        $('#omieMasc').textContent = com ? (SHC.omieMascara || SHC.tinyMascara)(o.appKey) : '';
    }
    async function puxarOmie(pedido, chaves) {
        let deu = false;
        try { deu = await pedido; } catch (e) { deu = false; }
        if (!deu) return tinyMsg('Sem a permissão do Chrome o Copiloto não consegue ler o Omie. Clique de novo e escolha “Permitir”.', true);
        if (omieRodando) return;
        omieRodando = true;
        ['#omieConectar', '#omieAtualizar', '#omieEsquecer'].forEach(s => { $(s).disabled = true; });
        tinyMsg('Lendo os produtos do Omie…');
        impBarra({ erp: 'omie' });
        try {
            if (chaves) await SHC.gravarChave(SHC.OMIE_CHAVE, chaves);
            const r = await chrome.runtime.sendMessage({ acao: 'sincronizar_custos', erp: 'omie' });
            if (!r || !r.ok) throw Object.assign(new Error('omie'), { msg: (r && r.msg) || 'Não consegui ler o Omie agora. Tente de novo em alguns minutos.' });
            $('#omieKey').value = ''; $('#omieSecret').value = '';
            await lerDados();
            desenhaTabela();
            tinyMsg('✓ Custos do Omie importados.' + (txtPrincipais() ? ' Agora: ' + txtPrincipais() + '.' : ''));
            impResumo(r, 'Omie');
        } catch (e) {
            if (chaves) await SHC.areaEmpresa().remove(SHC.OMIE_CHAVE).catch(() => {});   // chave que o Omie recusou não fica guardada (v3.3: só a desta empresa)
            tinyMsg((e && e.msg) || FALHA, true);
        } finally {
            omieRodando = false;
            ['#omieConectar', '#omieAtualizar', '#omieEsquecer'].forEach(s => { $(s).disabled = false; });
            $('#impProgLin').hidden = true;
            await desenhaOmie();
        }
    }
    $('#omieConectar').addEventListener('click', () => {
        const appKey = $('#omieKey').value.trim(), appSecret = $('#omieSecret').value.trim();
        if (appKey.length < 8 || appSecret.length < 8 || /\s/.test(appKey + appSecret)) return tinyMsg('Cole a App Key e a App Secret inteiras do Omie (Configurações › Aplicativos).', true);
        puxarOmie(chrome.permissions.request(OMIE), { appKey, appSecret });
    });
    $('#omieSecret').addEventListener('keydown', e => { if (e.key === 'Enter') $('#omieConectar').click(); });
    $('#omieAtualizar').addEventListener('click', () => puxarOmie(chrome.permissions.request(OMIE), null));
    $('#omieEsquecer').addEventListener('click', async () => {
        await esquecerErp(SHC.OMIE_CHAVE, OMIE);
        tinyMsg('Chaves esquecidas. Os custos que já vieram do Omie continuam na tabela.');
        desenhaOmie();
    });
    desenhaOmie();
    // ── Bling (v3.1, bling.js): OAuth 2.0 com o aplicativo do PRÓPRIO seller (o Copiloto não tem servidor nem segredo embutido).
    // Client ID/Secret e tokens só em erp:bling, neste Chrome. Conectar: pede identity + bling.com.br (opcionais) no clique →
    // launchWebAuthFlow com state aleatório conferido aqui → o fundo troca o code ({acao:'bling_conectar'}) e já importa os custos.
    const BLING = { permissions: ['identity'], origins: SHC.BLING_ORIGENS };
    let blingRodando = false, blingSalvo = null;   // blingSalvo: o guardado (o clique decide sem esperar o armazenamento)
    const blingBotoes = off => ['#blingConectar', '#blingAtualizar', '#blingEsquecer'].forEach(s => { $(s).disabled = off; });
    async function desenhaBling() {
        const b = (await SHC.lerChave(SHC.BLING_CHAVE)) || {}, com = !!(b.clientId && b.refresh);
        blingSalvo = b.clientId && b.clientSecret ? b : null;
        $('#blingSem').hidden = com;
        $('#blingCom').hidden = !com;
        $('#blingMasc').textContent = com ? SHC.tinyMascara(b.clientId) : '';
        $('#blingRetorno').textContent = SHC.blingRetorno(chrome.runtime.id, chrome.identity);
        if (!com && b.clientId && !$('#blingId').value) $('#blingId').value = b.clientId;
        if (b.reconectar && !blingRodando && !$('#tinyMsg').textContent) tinyMsg('Conecte o Bling de novo: a entrada venceu (30 dias sem uso). Clique em Conectar no cartão do Bling.', true);
    }
    // cred = {clientId, clientSecret} → entra no Bling e importa; null → só importa de novo (já conectado).
    async function puxarBling(pedido, cred) {
        let deu = false;
        try { deu = await pedido; } catch (e) { deu = false; }
        if (!deu) return tinyMsg('Sem a permissão do Chrome o Copiloto não consegue entrar no Bling. Clique de novo e escolha “Permitir”.', true);
        if (blingRodando) return;
        blingRodando = true;
        blingBotoes(true);
        let antes = null;
        try {
            let r;
            if (cred) {
                antes = (await SHC.lerChave(SHC.BLING_CHAVE)) || {};
                await SHC.gravarChave(SHC.BLING_CHAVE, antes.clientId === cred.clientId && antes.clientSecret === cred.clientSecret ? Object.assign({}, antes, cred) : cred);
                tinyMsg('Entre no Bling na janela que abriu e clique em “Autorizar”…');
                const state = SHC.blingEstado();
                let volta = '';
                try { volta = await chrome.identity.launchWebAuthFlow({ url: SHC.blingUrlAutorizar(cred.clientId, state), interactive: true }); }
                catch (e) { throw { msg: 'A entrada no Bling fechou sem autorizar. Confira o Client ID e a URL de redirecionamento do aplicativo (passo 3) e tente de novo.' }; }
                const v = SHC.blingLerVolta(volta, state);
                if (!v.ok) throw { msg: v.msg };
                tinyMsg('Lendo os produtos do Bling…');
                impBarra({ erp: 'bling' });
                r = await chrome.runtime.sendMessage({ acao: 'bling_conectar', code: v.code });
            } else {
                tinyMsg('Lendo os produtos do Bling…');
                impBarra({ erp: 'bling' });
                r = await chrome.runtime.sendMessage({ acao: 'sincronizar_custos', erp: 'bling' });
            }
            if (!r || !r.ok) throw { msg: (r && r.msg) || 'Não consegui ler o Bling agora. Tente de novo em alguns minutos.' };
            $('#blingId').value = ''; $('#blingSecret').value = '';
            await lerDados();
            desenhaTabela();
            tinyMsg('✓ ' + (r.resumo || 'Custos do Bling importados') + '.' + (txtPrincipais() ? ' Agora: ' + txtPrincipais() + '.' : ''));
            impResumo(r, 'Bling');
        } catch (e) {
            // Entrada que não deu certo (e não chegou a conectar): volta o que estava guardado antes (Client ID/Secret e tokens);
            // só apaga quando não havia nada antes.
            if (cred && antes) {
                const b = await SHC.lerChave(SHC.BLING_CHAVE).catch(() => null);
                if (b && !b.refresh) await (antes.clientId ? SHC.gravarChave(SHC.BLING_CHAVE, antes) : SHC.areaEmpresa().remove(SHC.BLING_CHAVE)).catch(() => {});
            }
            tinyMsg((e && e.msg) || FALHA, true);
        } finally {
            blingRodando = false;
            blingBotoes(false);
            $('#impProgLin').hidden = true;
            await desenhaBling();
        }
    }
    $('#blingConectar').addEventListener('click', () => {
        let clientId = $('#blingId').value.trim(), clientSecret = $('#blingSecret').value.trim();
        // Reconectar (a entrada venceu): Client ID igual ao guardado e Secret em branco → usa o guardado.
        if (!clientSecret && blingSalvo && clientId === blingSalvo.clientId) clientSecret = blingSalvo.clientSecret;
        if (clientId.length < 8 || clientSecret.length < 8 || /\s/.test(clientId + clientSecret)) return tinyMsg('Cole o Client ID e o Client Secret inteiros do seu aplicativo do Bling (passo 4).', true);
        puxarBling(chrome.permissions.request(BLING), { clientId, clientSecret });
    });
    $('#blingSecret').addEventListener('keydown', e => { if (e.key === 'Enter') $('#blingConectar').click(); });
    $('#blingAtualizar').addEventListener('click', () => puxarBling(chrome.permissions.request(BLING), null));
    $('#blingCopiar').addEventListener('click', () => {
        const t = $('#blingRetorno').textContent;
        Promise.resolve(navigator.clipboard && navigator.clipboard.writeText(t)).then(() => tinyMsg('Endereço copiado. Cole em “URL de redirecionamento” no aplicativo do Bling.'), () => tinyMsg('Selecione o endereço e copie com Ctrl+C.'));
    });
    $('#blingEsquecer').addEventListener('click', async () => {
        await esquecerErp(SHC.BLING_CHAVE, BLING);
        tinyMsg('Bling desconectado. Os custos que já vieram do Bling continuam na tabela.');
        desenhaBling();
    });
    desenhaBling();
    $('#tinyConectar').addEventListener('click', () => {
        const token = $('#tinyToken').value.trim();
        if (token.length < 10 || /\s/.test(token)) return tinyMsg('Cole o token inteiro do Tiny (Configurações › E-commerce › Token API).', true);
        puxarTiny(chrome.permissions.request(TINY), token);
    });
    $('#tinyToken').addEventListener('keydown', e => { if (e.key === 'Enter') $('#tinyConectar').click(); });
    $('#tinyAtualizar').addEventListener('click', () => {
        const pedido = chrome.permissions.request(TINY);
        SHC.lerChave(SHC.TINY_CHAVE).then(t => (t && t.token ? puxarTiny(pedido, t.token) : desenhaTiny()));
    });
    $('#tinyEsquecer').addEventListener('click', async () => {
        await esquecerErp(SHC.TINY_CHAVE, TINY);
        tinyMsg('Token esquecido. Os custos que já vieram do Tiny continuam na tabela.');
        desenhaTiny();
    });
    desenhaTiny();

    // Mudou algo no armazenamento (etiqueta no ML, painel lateral, sincronização): relê.
    let espera = null, contasMudou = false;
    chrome.storage.onChanged.addListener((mud, area) => {
        if (area !== 'local') return;
        if (mud['shc:status'] && mud['shc:status'].newValue && passo === 3 && !$('#guia').hidden) mostraConta(mud['shc:status'].newValue);
        // Importação pelo fundo (Omie, ou o Tiny a cada sincronização): a barra acompanha shc:status.custosProgresso.
        if (mud['shc:status'] && !tinyRodando) impBarra((mud['shc:status'].newValue || {}).custosProgresso);
        // v3.3: ml:conta (o ML abriu outra conta, talvez de outra empresa): relê custos, cfg e as contas do seletor.
        const relevante = Object.keys(mud).some(k => /^(c\||vm\||ml:anuncios|ml:promos|cfg$|shc:guia$|ml:conta$)/.test(k));
        if (Object.keys(mud).some(k => /^erpx:/.test(k))) (async () => { erpx = await SHC.lerChave('erpx:' + (contaVer || await SHC.contaAtual())); desenhaErpx(); })().catch(() => {});
        if (!relevante) return;
        if (mud['ml:conta'] || mud.cfg) contasMudou = true;
        clearTimeout(espera);
        espera = setTimeout(async () => {
            await lerDados();
            if (contasMudou) { contasMudou = false; desenhaContaTab().catch(() => {}); }
            if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#corpo')) { redesenharDepois = true; return; }
            desenhaTabela();
        }, 300);
    });

    carregar();
})();
