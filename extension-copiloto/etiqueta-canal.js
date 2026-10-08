// Copiloto · etiqueta de ganho nas listas de produtos dos outros canais (N-B TikTok, N-C Shopee, N-D Magalu; pedido da dona 07/10/2026).
// Junta o cadastro do Copiloto (custo por SKU, imposto e meta da empresa) com a conta da etiqueta do núcleo (CopilotoNucleo.etiqueta).
// Shopee: a conta é o SHC.calcular('sp'), a MESMA do resto do Copiloto (respeita a comissão e a taxa escolhidas em Ajustes; sem escolha, a
// tabela oficial do núcleo). TikTok: tarifas.simular do núcleo (o SHC.calcular não tem TikTok). Magalu: sem tabela lida → "não lido",
// a não ser que a seller informe a comissão em Ajustes (cfg.mg_comissao_pct).
// Só lê o storage e calcula: não grava nada e não chama o canal.
(function (root) {
    'use strict';
    const SHC = root.SHC = root.SHC || {};
    const CN = () => root.CopilotoNucleo || {};
    const CANAL_SHC = { shopee: 'sp' };
    // Leitores de tela de cada canal (shopee-lista.js, tiktok-lista.js, magalu-lista.js, da sessão local, conferidos ao vivo em 07/10): eles se
    // apresentam por SHC.etiquetaCanal.iniciar({canal, urlOk, linhas, ler}); aqui só guardamos para o desenho (etiqueta-tela.js) pôr a etiqueta
    // ao lado do PREÇO de cada linha. Os números da etiqueta vêm da resposta que a tela recebeu (os *-tela.js), não do texto da página.
    SHC.etqListas = SHC.etqListas || {};
    SHC.etiquetaCanal = SHC.etiquetaCanal || { iniciar: a => { if (a && a.canal) SHC.etqListas[a.canal] = a; } };

    /** opc.calcular da etiqueta para a Shopee: o SHC.calcular('sp') → o formato do núcleo. */
    SHC.etqCalcularSp = cfg => (preco, ctx) => {
        const r = SHC.calcular(CANAL_SHC.shopee, preco, { custo: ctx.custo, outros: ctx.outros }, Object.assign({}, cfg, { imposto_pct: ctx.imposto_pct }));
        if (!r) return null;
        return { lucro: r.sobra_rs, margem_pct: r.sobra_pct, classe: r.classe, repasse: r.recebe_rs, tarifas_rs: SHC.r2(r.comissao_rs + r.taxa_fixa_rs),
            frete_regra: r.frete_regra, avisos: r.tarifa_aviso ? [r.tarifa_aviso] : [], confianca: r.tarifa_regra ? 'oficial' : 'manual' };
    };

    /** SKUs (do produto e das variações) → as chaves c|sku|… do cadastro. */
    SHC.etqChaves = (produtos, canal) => {
        const ks = new Set();
        (produtos || []).forEach(p => {
            [p.sku].concat((p.variacoes || []).map(v => v.sku)).forEach(s => { const k = s ? SHC.chaveSku(s) : ''; if (k) ks.add(k); });
            if (canal === 'tiktok') (p.variacoes || []).forEach(v => { if (v.modelo_id) ks.add('c|tiktok|' + v.modelo_id); });
        });
        return [...ks];
    };
    /** TikTok › Gerenciar produtos (o que o núcleo lê: N.produtosAnunciados / N.skusDoProduto) → os produtos da etiqueta (sem o nome: o TikTok não manda). */
    SHC.etqDoTikTok = lista => (Array.isArray(lista) ? lista : []).filter(p => p && p.produto_id).map(p => {
        const vs = (p.skus || []).map(s => ({ modelo_id: s.sku_id, sku: s.sku || null, preco: s.preco }));
        return { produto_id: p.produto_id, nome: '', sku: (vs.find(v => v.sku) || {}).sku || null, variacoes: vs, total_skus: p.total_skus };
    });

    // ── Visitas e frete com variação (pedido da dona 08/10: "a métrica de visitas e a variação de frete, igual ao ML") ──
    // Histórico só no Chrome (etq:hist:<canal>): por produto, o número do dia (visualizações acumuladas da Shopee; frete médio da Magalu),
    // até 15 dias. Nada do comprador. Desligar a etiqueta apaga.
    SHC.ETQ_HIST_DIAS = 15;
    const menosDias = (dia, n) => new Date(Date.parse(dia + 'T12:00:00Z') - n * 864e5).toISOString().slice(0, 10);
    const ddmm = dia => dia.slice(8, 10) + '/' + dia.slice(5, 7);
    /** Grava o número do dia (o último do dia vale) e corta o que passou de 15 dias. hist = {id: {campo: {dia: n}}} (objeto NOVO). */
    SHC.etqHistGrava = function (hist, id, campo, dia, valor) {
        const h = Object.assign({}, hist), n = SHC.num(valor);
        if (!id || n === null || !/^\d{4}-\d{2}-\d{2}$/.test(dia || '')) return h;
        const p = Object.assign({}, h[id]), c = Object.assign({}, p[campo], { [dia]: n }), corte = menosDias(dia, SHC.ETQ_HIST_DIAS);
        Object.keys(c).forEach(d => { if (d < corte) delete c[d]; });
        p[campo] = c; h[id] = p;
        return h;
    };
    // O dia guardado mais recente que é <= limite.
    const ateDia = (serie, limite) => Object.keys(serie || {}).filter(d => d <= limite).sort().pop() || null;
    /**
     * Visitas de 7 dias pelo total acumulado (Shopee: view_count): hoje − o de 7+ dias atrás; e a semana anterior quando há 14 dias.
     * → {texto, classe, titulo} | null. Sem 7 dias de histórico: o total e desde quando compara (nunca um "7 dias" inventado).
     */
    SHC.etqVisitasAcumuladas = function (serie, dia) {
        const hoje = serie && serie[dia];
        if (typeof hoje !== 'number') return null;
        const d7 = ateDia(serie, menosDias(dia, 7)), d14 = ateDia(serie, menosDias(dia, 14));
        if (!d7) { const prim = Object.keys(serie).sort()[0]; return { texto: 'visitas: ' + hoje + ' no total', classe: '', titulo: 'A conta de 7 dias começa a valer 7 dias depois de ' + ddmm(prim) + ' (o Copiloto guarda o total de cada dia).' }; }
        const ult = Math.max(0, hoje - serie[d7]);
        if (!d14 || d14 === d7) return { texto: 'visitas 7 dias: ' + ult, classe: '', titulo: 'Visualizações de ' + ddmm(d7) + ' a ' + ddmm(dia) + '.' };
        const ant = Math.max(0, serie[d7] - serie[d14]), v = ant > 0 ? Math.round((ult - ant) / ant * 100) : null;
        return { texto: 'visitas 7 dias: ' + ult + (v === null ? '' : ' (' + (v > 0 ? '+' : '') + v + '%)'), classe: v === null ? '' : v <= -20 ? 'cai' : v >= 20 ? 'sobe' : '',
            titulo: 'Visualizações: ' + ult + ' de ' + ddmm(d7) + ' a ' + ddmm(dia) + ' × ' + ant + ' na semana anterior.' };
    };
    /** Visitas de 7 dias que o canal já dá prontas (Magalu: product-metrics, com a variação). */
    SHC.etqVisitasProntas = (qtd, variacaoPct) => (SHC.num(qtd) === null ? null : {
        texto: 'visitas 7 dias: ' + SHC.num(qtd) + (SHC.num(variacaoPct) === null ? '' : ' (' + (variacaoPct > 0 ? '+' : '') + Math.round(variacaoPct) + '%)'),
        classe: SHC.num(variacaoPct) === null ? '' : variacaoPct <= -20 ? 'cai' : variacaoPct >= 20 ? 'sobe' : '', titulo: 'Visitas dos últimos 7 dias e a variação, como o canal mostra.' });
    /** Frete médio do dia × o de 7+ dias atrás (o mais antigo guardado, se ainda não há 7). Subiu → vermelho (como o selo do ML). */
    SHC.etqFreteVariacao = function (serie, dia) {
        const hoje = serie && serie[dia];
        if (typeof hoje !== 'number') return null;
        const antes = ateDia(serie, menosDias(dia, 7)) || Object.keys(serie).sort()[0];
        const dif = antes && antes !== dia ? SHC.r2(hoje - serie[antes]) : 0;
        if (!dif) return { texto: 'frete médio ' + SHC.moeda(hoje), classe: '', titulo: 'Frete médio do produto, como o canal mostra' + (antes && antes !== dia ? '; igual desde ' + ddmm(antes) : '') + '.' };
        return { texto: 'frete ' + SHC.moeda(hoje) + ' (' + (dif > 0 ? 'subiu ' : 'caiu ') + SHC.moeda(Math.abs(dif)) + ' desde ' + ddmm(antes) + ')', classe: dif > 0 ? 'cai' : 'sobe',
            titulo: 'Frete médio: ' + SHC.moeda(serie[antes]) + ' em ' + ddmm(antes) + ' → ' + SHC.moeda(hoje) + ' hoje.' };
    };

    /**
     * produtos (do adaptador do canal: [{produto_id, nome, sku, preco, variacoes}]) + custos ({c|sku|…: {custo, outros}}) + cfg (SHC.lerCfg)
     * → [{ produto_id, nome, sku, skus, classe, texto, detalhe }] para o desenho. hoje = 'AAAA-MM-DD' (a tabela em vigor).
     */
    SHC.etqDosProdutos = function (canal, produtos, custos, cfg, hoje) {
        const E = CN().etiqueta;
        if (!E) return [];
        // O custo como no resto do Copiloto: SHC.custoDeAnuncio (o SKU, e o kit pela soma dos SKUs de dentro). TikTok: antes, o custo digitado
        // ou ligado na aba do TikTok para a variação (c|tiktok|<sku_id>), como o TT.lucroDoPedido.
        const cs = custos || {}, deDados = x => (x && SHC.num(x.custo) > 0 ? { custo: SHC.num(x.custo), outros: SHC.num(x.outros) || 0 } : null);
        const doSku = sku => {
            if (!sku) return null;
            if (SHC.custoDeAnuncio) { const r = SHC.custoDeAnuncio(cs, { sku }); return r ? deDados(r.dados) : null; }
            const k = SHC.chaveSku(sku); return k ? deDados(cs[k]) : null;
        };
        const custoDe = (sku, v) => {
            if (canal === 'tiktok' && v && v.modelo_id) {
                const lig = cs['c|tiktok|' + v.modelo_id];
                if (lig && SHC.num(lig.custo) > 0) return deDados(lig);
                if (lig && lig.sku) return doSku(lig.sku);
            }
            return doSku(sku);
        };
        const c = cfg || {};
        const base = { imposto_pct: SHC.num(c.imposto_pct) || 0, margem_alvo_pct: SHC.num(c.margem_alvo_pct) || 0, comissao_pct: canal === 'magalu' ? (SHC.num(c.magalu_comissao_pct) !== null ? SHC.num(c.magalu_comissao_pct) : SHC.num(c.mg_comissao_pct)) : undefined };
        const opc = canal === 'shopee' && SHC.calcular ? { calcular: SHC.etqCalcularSp(c) } : null;
        return (produtos || []).map(p => {
            const e = E.doProduto(canal, p, custoDe, base, hoje, opc);
            const skus = [...new Set([p.sku].concat((p.variacoes || []).map(v => v.sku)).filter(Boolean))];
            const detalhe = e.variacoes.map(v => (v.sku ? v.sku + ': ' : '') + v.texto + (typeof v.preco === 'number' ? ' (a ' + E.moeda(v.preco) + ')' : '')
                + (typeof v.custo === 'number' ? ', custo ' + E.moeda(v.custo) : '') + (typeof v.tarifas_rs === 'number' ? ', tarifas ' + E.moeda(v.tarifas_rs) : '')).join('\n');
            // O rótulo da etiqueta: preço · custo · sobra e margem (como a etiqueta do ML). Faixa quando as variações diferem.
            const faixa = ns => { const l = ns.filter(n => typeof n === 'number'); if (!l.length) return null; const a = Math.min(...l), b = Math.max(...l); return a === b ? E.moeda(a) : E.moeda(a) + ' a ' + E.moeda(b); };
            const preco = faixa(e.variacoes.map(v => v.preco)), custo = faixa(e.variacoes.map(v => v.custo));
            const rotulo = [preco, custo ? 'custo ' + custo : null, e.texto].filter(Boolean).join(' · ');
            return { produto_id: p.produto_id, nome: p.nome || '', sku: p.sku || '', skus, classe: e.classe, texto: e.texto, rotulo, detalhe, extras: [] };
        });
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);
