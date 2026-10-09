// ── v2.4: repasse real do Mercado Pago (Atividade). Só com a permissão opcional (pedida no clique "Conectar Mercado Pago" da
// página de Fechamento) e o login no Mercado Pago. Atividade filtrada só em vendas (?operation=sales&page=N) com o listData do
// estado embutido (confirmado ao vivo em 25/09/2026); para em listData.pages. A CONFIRMAR: cookies do MP no fetch do fundo. ──
const MP = 'https://www.mercadopago.com.br';
const MP_PAGINAS_MAX = 40;
async function temPermissaoMP() {
    try { return !!(chrome.permissions && chrome.permissions.contains && await chrome.permissions.contains({ origins: [MP + '/*'] })); } catch (e) { return false; }
}
async function sincronizarRepasse(sellerId, progresso) {
    if (!(await temPermissaoMP())) return { semPermissao: true };
    const itens = [];
    let paginas = 0, assinatura = '', inteira = false, ultPag = 0;   // inteira = chegou ao fim da Atividade (não parou por erro nem pelo limite)
    for (let n = 1; n <= MP_PAGINAS_MAX; n++) {
        const b = await buscarHtml(MP + '/activities?operation=sales&page=' + n);
        if (!b || b.login) { if (n === 1) return { falha: b && b.login ? 'login' : 'indisponivel' }; break; }
        const lidos = SHC.mpAtividadesDoHtml(b.html, SHC.hoje());
        // Fim: página sem atividade nenhuma, ou o MP repetiu a página (assinatura com TODAS as atividades, também as compras).
        // Antes da última página que o MP informou (listData.pages), página vazia/repetida é leitura cortada (espera, anti-robô), não o fim.
        if (!lidos.blocos || lidos.assinatura === assinatura) { inteira = !(ultPag && n <= ultPag); break; }
        assinatura = lidos.assinatura; itens.push(...lidos); paginas = n; ultPag = lidos.paginas || ultPag;
        await progresso({ repassePaginas: n }, { feito: n, de: ultPag || null, unidade: ultPag ? 'páginas' : null });
        if (lidos.paginas && n >= lidos.paginas) { inteira = true; break; }   // última página segundo o MP (listData.pages)
        await espera(PAUSA_MS);
    }
    if (!paginas) return { falha: 'indisponivel' };   // nada reconhecido na 1ª página: tela mudada (não grava)
    const meses = SHC.repassePorMes(itens), desde = itens.reduce((d, i) => (!d || i.data < d ? i.data : d), '');
    // Leitura cortada (limite de páginas ou erro no meio): o mês mais antigo lido está pela metade → fica fora da comparação.
    if (!inteira && desde) delete meses[desde.slice(0, 7)];
    const ks = Object.keys(meses).sort().slice(-13), out = {};
    ks.forEach(m => { out[m] = meses[m]; });
    // Nenhuma venda/reembolso (só compras, ou só o mês cortado): não grava por cima — o repasse anterior fica.
    if (!ks.length) return { paginas, meses: 0, semItens: true };
    await SHC.salvarRepasse(sellerId, { ts: Date.now(), meses: out, paginas, desde, completo: inteira, aConfirmar: true });
    return { paginas, meses: ks.length };
}

// ── v2.4.5: Afiliados (Venda com afiliados), mapeado ao vivo em 25/09/2026. Só LÊ: nunca cria/altera campanha nem adiciona produtos;
// nomes/apelidos de afiliados nunca são lidos nem guardados. Campanha: estado embutido de /seller-affiliates/campaign (o ML redireciona
// para /campaign/<uuid>). Métricas por produto dos últimos 30 dias: /meliconnect/api/seller-affiliates/dashboard/products (page começa em 0).
// Falhou → afil:<conta> anterior fica e status.erroAfiliados. Sem campanha (404, ou "Criar campanha" numa tela de estado vazio) → {temAfiliados:false},
// etapa pulada — mas nunca por cima de um afil:<conta> que já tinha afiliados (aí é falha e o anterior fica). ──
const AFIL_PAGINAS_MAX = 100;       // lista da campanha: 20 produtos por página → até 2.000
const AFIL_MET_PAGINAS_MAX = 50;
const AFIL_PED_PAGINAS_MAX = 100;   // pedidos por afiliados: 10 por página → até 1.000 pedidos em 30 dias
const urlAfilProdutos = (de, ate, p) => BASE + '/meliconnect/api/seller-affiliates/dashboard/products?date_from=' + de + '&date_to=' + ate
    + '&sales_type=net_sales&campaign_sales=false&page=' + p;
// v2.9 (mapeado ao vivo em 26/09/2026): a lista da campanha pagina por esta API; "?page=N" na página devolve sempre a 1ª.
const urlAfilCampanha = (uuid, p, total) => BASE + '/meliconnect/api/seller-affiliates/campaigns/' + encodeURIComponent(uuid) + '?page=' + p
    + '&orderBy=extra_commission&order=desc&countExec=false&countVal=' + (total || 0);
// Pedidos por afiliados (page começa em 0). A resposta traz o afiliado e o número do pedido: o Copiloto guarda a SOMA por SKU e por situação
// e, por 30 dias, o número, a comissão e a situação de cada venda com afiliado (porPedido, para a etiqueta da venda). Nunca o afiliado.
const urlAfilPedidos = (de, ate, p) => BASE + '/meliconnect/api/seller-affiliates/orders/detail?date_from=' + de + '&date_to=' + ate + '&page=' + p + '&campaign_sales=false';
// Preparado, NÃO chamado: métricas por campanha e por afiliado. Os valores dos parâmetros não foram confirmados ao vivo (net_sales|all|false|0
// deram HTTP 400). Confirmar o que a tela manda antes de ligar; por afiliado, guardar só quantidade/vendas/custo, nunca nome ou apelido.
// const urlAfilCampanhas = (de, ate, p) => BASE + '/meliconnect/api/seller-affiliates/dashboard/campaigns?date_from=' + de + '&date_to=' + ate + '&sales_type=?&campaign_type=?&page=' + p;
// const urlAfilPorAfiliado = (de, ate, p) => BASE + '/meliconnect/api/seller-affiliates/dashboard/metrics-affiliates?date_from=' + de + '&date_to=' + ate
//     + '&sales_type=?&campaign_sales=?&campaign_type=?&chat_enabled=?&page=' + p;
// "Criar campanha" sozinho não basta (aparece no menu, em links para "Campanhas exclusivas" e nas traduções dentro dos <script>): só vale no
// texto visível junto de um marcador de estado vazio. ponytail: marcador A CONFIRMAR ao vivo numa conta sem campanha; sem ele → erroAfiliados.
function telaSemCampanha(html) {
    const v = String(html || '').replace(/<script[\s\S]*?<\/script>/gi, '');
    return /criar campanha/i.test(v) && /empty[-_]?state|ainda n[ãa]o (tem|criou)|nenhuma campanha|n[ãa]o tem campanha/i.test(v);
}
async function lerCampanhaAfiliados(progresso) {
    // v2.10: a página da campanha e cada página das listas lidas neste ciclo ficam guardadas (naCiclo, já reduzidas: sem nome de afiliado).
    const ini = await naCiclo('afiliados', 'campanha', async () => {
        let r;
        try { r = await SHC.buscarVendo(BASE + '/seller-affiliates/campaign', comTempo({ credentials: 'include', cache: 'no-store' })); } catch (e) { return { falha: 'indisponivel' }; }
        if (ehLogin(r.url)) return { falha: 'login' };
        if (r.status === 404) return { semCampanha: true };
        if (!r.ok) return { falha: 'indisponivel' };
        const html = await r.text(), c = SHC.afilCampanhaDoEstado(SHC.mlExtraiEstado(html));
        if (!c) return telaSemCampanha(html) ? { semCampanha: true } : { falha: 'indisponivel' };   // tela desconhecida: não afirma "sem afiliados"
        return { c, url: String(r.url || '') };
    });
    if (!ini.c) return ini;
    const c = ini.c;
    // Lista inteira pela API paginada (1..N, mesma ordem em todas as páginas); a 1ª página do estado entra junto (sem repetir).
    const produtos = c.produtos.slice(), vistos = new Set(produtos.map(p => p.itemId)), uuid = (/\/campaign\/([^/?#]+)/.exec(ini.url) || [])[1];
    let total = c.totalProdutos, info = null;
    const junta = l => l.filter(p => !vistos.has(p.itemId)).forEach(p => { vistos.add(p.itemId); produtos.push(p); });
    for (let n = 1; uuid && !(total !== null && produtos.length >= total && n > 1) && n <= AFIL_PAGINAS_MAX; n++) {
        const pg = await naCiclo('afiliados', 'lista|' + n + '|' + total, async () => {
            await espera(PAUSA_MS);
            const b = await buscarJson(urlAfilCampanha(uuid, n, total));
            return b && b.json ? SHC.afilCampanhaApi(b.json) : null;
        });
        await bateVivo(progresso);
        if (!pg || !pg.produtos.length) break;
        info = info || pg;
        if (pg.totalProdutos !== null) total = pg.totalProdutos;   // o total da API vale mais que o do estado (mais novo)
        const antes = produtos.length;
        junta(pg.produtos);
        if (produtos.length === antes && n > 1) break;   // página repetida: o resto não vem (lida só em parte)
        await progresso({}, { feito: Math.min(produtos.length, total || produtos.length), de: total, unidade: total ? 'produtos' : null });
        if (pg.porPagina && pg.produtos.length < pg.porPagina) break;   // última página
    }
    const d = k => (info && info[k] !== null && info[k] !== undefined ? info[k] : c[k]);
    return { status: d('status'), comissaoGeral: d('comissaoGeral'), inicio: c.inicio, faixa: d('faixa'), entradaAutomatica: d('entradaAutomatica'),
        produtos, totalProdutos: total, completo: total !== null ? produtos.length >= total : null };
}
async function lerMetricasAfiliados(de, ate, progresso) {
    let m0 = null, completo = true;
    const porProduto = [];
    for (let p = 0; ; p++) {
        if (p >= AFIL_MET_PAGINAS_MAX) { completo = false; break; }   // teto: o resto fica sem ler (lida só em parte)
        const m = await naCiclo('afiliados', 'metricas|' + de + '|' + ate + '|' + p, async () => {
            if (p) await espera(PAUSA_MS);
            const b = await buscarJson(urlAfilProdutos(de, ate, p)), x = b && b.json ? SHC.afilMetricas(b.json) : null;
            return x || { falha: b && b.login ? 'login' : 'indisponivel' };
        });
        await bateVivo(progresso);
        if (m.falha) { if (!p) return m; completo = false; break; }
        m0 = m0 || m;
        porProduto.push(...m.porProduto);
        if (!(m.paginas > p + 1)) break;
    }
    return { periodo: { de, ate }, vendas: m0.vendas, unidades: m0.unidades, qtdVendas: m0.qtdVendas, custoEstimado: m0.custoEstimado,
        ultimaAtualizacao: m0.ultimaAtualizacao, porProduto, completo };
}
// Pedidos por afiliados do período, todas as páginas → soma por SKU e por situação + comissão por nº da venda (porPedido, para a etiqueta) (SHC.afilPedidosAgrega) | { falha }.
async function lerPedidosAfiliados(de, ate, progresso) {
    const vendas = [];
    let completo = true, total = null;
    for (let p = 0; ; p++) {
        if (p >= AFIL_PED_PAGINAS_MAX) { completo = false; break; }
        const pg = await naCiclo('afiliados', 'pedidos|' + de + '|' + ate + '|' + p, async () => {
            if (p) await espera(PAUSA_MS);
            const b = await buscarJson(urlAfilPedidos(de, ate, p)), x = b && b.json ? SHC.afilPedidos(b.json) : null;   // SKU, valor, situação e nº da venda (comissão na etiqueta): nada do afiliado
            return x && (x.pagina === null || x.pagina === p) ? x : { falha: b && b.login ? 'login' : 'indisponivel' };
        });
        await bateVivo(progresso);
        if (pg.falha) { if (!p) return pg; completo = false; break; }
        if (total === null) total = pg.total;
        vendas.push(...pg.vendas);
        if (!pg.vendas.length || !(pg.paginas > p + 1)) break;
    }
    return Object.assign(SHC.afilPedidosAgrega(vendas), { periodo: { de, ate }, total, completo: completo && (total === null || vendas.length >= total) });
}
// v3.1: Campanhas exclusivas (estado da página, 1 GET). ponytail: só a 1ª página (20); não se sabe se a página aceita ?page=N —
// a tela diz "mostrando 20 de N". Confirmar ao vivo numa conta com mais de 20 antes de paginar. → SHC.afilExclusivasDoEstado | null.
async function lerExclusivasAfiliados() {
    return naCiclo('afiliados', 'exclusivas', async () => {
        const r = await SHC.buscarVendo(BASE + '/seller-affiliates/target-campaign', comTempo({ credentials: 'include', cache: 'no-store' }));
        return r.ok && !ehLogin(r.url) ? SHC.afilExclusivasDoEstado(SHC.mlExtraiEstado(await r.text())) : null;
    });
}
async function sincronizarAfiliados(sellerId, progresso) {
    const c = await lerCampanhaAfiliados(progresso);
    if (c.falha) return c;
    if (c.semCampanha) {
        const ant = await SHC.lerChave('afil:' + sellerId);
        if (ant && ant.temAfiliados) return { falha: 'indisponivel' };   // tinha afiliados: 404/tela vazia agora é sinal fraco, o anterior fica
        await SHC.gravarChave('afil:' + sellerId, { ts: Date.now(), temAfiliados: false });
        return { temAfiliados: false, pulado: true };
    }
    const ate = SHC.hoje(), de = diaMenos(ate, 29), m = await lerMetricasAfiliados(de, ate, progresso);   // 30 dias com hoje, como no Mercado Ads
    if (m.falha) return m;
    // Pedidos: falha deles não derruba a etapa (a tela diz "não consegui ler os pedidos agora").
    let pe = null, ex = null;
    try { await espera(PAUSA_MS); pe = await lerPedidosAfiliados(de, ate, progresso); } catch (x) { pe = null; }
    try { await espera(PAUSA_MS); ex = await lerExclusivasAfiliados(); } catch (x) { ex = null; }   // v3.1: falha aqui também não derruba a etapa
    const snap = { ts: Date.now(), temAfiliados: true, campanha: c, metricas: m, pedidos: pe && !pe.falha ? pe : null, exclusivas: ex };
    await SHC.gravarChave('afil:' + sellerId, snap);
    return snap;
}

// ── v2.4.5: Simulador de custos do ML, sob demanda (painel e etiqueta; nunca na sincronização geral). Estado da página (GET).
// O recálculo da outra opção de frete é um POST em /simulador-de-custos/api/refresh-calculator (a CALCULADORA do simulador: só calcula,
// não grava nada no anúncio). EXCEÇÃO DOCUMENTADA ao "só GET" (aprovada pela dona em 25/09/2026: ela quer ver as duas opções de frete).
// → sim:<conta>:<MLB> = { ts, itemId, hoje, outro (null se o recálculo falhar) }.
const SIM_OUTRA_OPCAO = true;
const SIM_VALIDO_MS = 6 * 3600e3;
const simEmCurso = new Map();
async function lerSimulador(itemId) {
    const b = await buscarHtml(SHC.simLink(itemId));
    if (!b || b.login) return { falha: b && b.login ? 'login' : 'indisponivel' };
    const r = SHC.mlExtraiEstado(b.html), hoje = r ? SHC.mlSimuladorDoEstado(r, itemId) : null;
    if (!hoje) return { falha: 'indisponivel' };
    const opcao = hoje.freteOpcao === 'free' ? 'not_free' : 'free', pedido = SHC.simPedido(r, itemId, opcao);
    let outro = null;
    if (SIM_OUTRA_OPCAO && pedido) try {
        const p = await fetch(SHC.SIM_URL + '/api/refresh-calculator', comTempo({ method: 'POST', credentials: 'include', cache: 'no-store',
            headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(pedido) }));
        if (p.ok && !ehLogin(p.url)) outro = SHC.mlSimuladorDoEstado(await p.json(), itemId);
    } catch (e) { outro = null; }
    return { ts: Date.now(), itemId, hoje, outro: outro && outro.freteOpcao === opcao ? outro : null };
}
// → { ok, sim, cache? } | { ok:false, motivo, sim (o anterior, se houver) }
async function simulador(itemId, forcar) {
    const k = 'sim:' + await SHC.contaAtual() + ':' + itemId, ant = await SHC.lerChave(k);
    if (!forcar && ant && Date.now() - ant.ts < SIM_VALIDO_MS) return { ok: true, sim: ant, cache: true };
    if (!simEmCurso.has(k)) simEmCurso.set(k, lerSimulador(itemId).finally(() => simEmCurso.delete(k)));
    const s = await simEmCurso.get(k);
    if (s.falha) return { ok: false, motivo: s.falha === 'login' ? 'sem_sessao' : 'ml_indisponivel', sim: ant };
    await SHC.gravarChave(k, s);
    return { ok: true, sim: s };
}

