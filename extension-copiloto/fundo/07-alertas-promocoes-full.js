// ── v2.4: alertas críticos (Full acabando + Ads acima do equilíbrio) → shc:alertas e o número no ícone ──
// v2.5.3: o número é o de TODAS as anomalias (SHC.anomalias); vermelho com reclamação/mediação em aberto ou pagamento a conferir, âmbar no resto.
// O título do ícone diz quanto de cada tipo. Aceita também um número (compatível com o shc:alertas antigo).
// v2.7: a.semanalNovo (resumo da semana ainda não visto) → sem anomalia o ícone mostra "•" âmbar; o título avisa.
// v3.3 multi-empresa (bloqueio 5): o número é SEMPRE o da conta aberta (ml:conta). Alertas de outra conta (a.conta ≠ aberta: rodada lenta
// que terminou depois da troca, shc:anomalias ainda da conta anterior) → o guardado da aberta (shc:anomalias:<aberta>), ou ícone limpo.
const pintaSelo = a => {
    const n = typeof a === 'number' ? a : (a && a.total) || 0, novo = !!(a && typeof a === 'object' && (a.semanalNovo || a.promoNovo));
    chrome.action.setBadgeText({ text: n > 0 ? (n > 99 ? '99+' : String(n)) : (novo ? '•' : '') }).catch(() => {});
    if ((n > 0 || novo) && chrome.action.setBadgeBackgroundColor) chrome.action.setBadgeBackgroundColor({ color: n > 0 && (typeof a === 'number' || (a && a.vermelho)) ? '#D93025' : '#B06000' }).catch(() => {});
    if (chrome.action.setTitle) chrome.action.setTitle({ title: typeof a === 'number' ? 'Abrir o Copiloto' : SHC.anomaliasTitulo(a) + (a && a.semanalNovo ? ' · novo resumo ' + (a.semanalNovo === 'dia' ? 'do dia' : a.semanalNovo === 'ambos' ? 'do dia e da semana' : 'da semana') : '')
        + (a && a.promoNovo ? ' · o robô achou promoção que mantém a sua margem mínima' : '') }).catch(() => {});
};
function selo(a) {
    if (!chrome.action || !chrome.action.setBadgeText) return;
    if (!(a && typeof a === 'object' && a.conta)) return pintaSelo(a);
    // devolve a promessa: quem pinta o ícone espera ele (o selo fica certo quando a etapa Alertas termina)
    return SHC.contaAtual().then(async c => (c === 'atual' || c === String(a.conta) ? pintaSelo(a) : pintaSelo((await SHC.lerChave('shc:anomalias:' + c)) || 0))).catch(() => {});
}
// Quem trocou de conta no ML (ml:conta) vê no ícone o número da conta nova logo, sem esperar a etapa Alertas dela.
if (chrome.storage && chrome.storage.onChanged) chrome.storage.onChanged.addListener((m, area) => { if (area === 'local' && m && m['ml:conta']) seloAgora().catch(() => {}); });
async function atualizarAlertas(conta) {
    const c = conta || await SHC.contaAtual();
    const [full, ads, an, cfg, lidos] = await Promise.all([SHC.lerFull(c), SHC.lerAds(c), SHC.lerAnuncios(c), SHC.lerCfg(), SHC.lerMesesVendasLidos(c)]);
    // Catálogo ligado pelo título (SHC.adsLigaCatalogo, a ligação do painel): o custo do anúncio ligado também é lido para o aviso do Ads.
    const comAds = new Set((((ads && SHC.adsLigaCatalogo(ads, an && an.itens)) || {}).anuncios || []).filter(a => a && a.custo > 0).map(a => a.itemId));
    const itens = ((an && an.itens) || []).filter(i => comAds.has(i.itemId)), chaves = new Set(), ids = new Set();
    // F2: o custo de TODAS as variações (antes só o 1º SKU: o alerta lia o lucro inflado).
    itens.forEach(i => { SHC.skusDoAnuncio(i).forEach(s => chaves.add(SHC.chaveSku(s))); chaves.add(SHC.chave('ml', i.itemId)); if (i.familia) chaves.add(SHC.chave('ml', i.familia)); });
    // vm|ml dos anúncios de cada produto do Full: os MLB do Full + os do mesmo SKU no retrato (SHC.idsDoProdutoFull, a regra do painel).
    const todos = (an && an.itens) || [];
    ((full && full.produtos) || []).forEach(p => { if (!p) return; if (p.sku) chaves.add(SHC.chaveSku(p.sku)); SHC.idsDoProdutoFull(p, todos).forEach(id => ids.add(id)); });
    chaves.delete('');
    const [custos, vm] = await Promise.all([SHC.lerCustos([...chaves]), ids.size ? SHC.lerVendasMes([...ids]) : {}]);
    // Restrição fiscal / penalidade do Full: campos fiscal (fiscal_restriction_name) e penalidade (active_penalty_by_uwsd) que a leitura
    // das remessas grava em ml:full:<conta>.
    // das remessas grava em ml:full:<conta> (e em ml:full:remessas:<conta>, que vale também quando o retrato do Full não existe).
    const rem = await SHC.lerChave('ml:full:remessas:' + c), fl = rem || full;
    const naConta = fl ? { fiscal: fl.fiscal, penalidade: fl.penalidade, fullAviso: full && full.fullAviso } : null;
    // Saúde dos anúncios: a mesma conta do cartão Alertas do painel (sem dados fiscais + anúncios ATIVOS com visitas caindo).
    const [fiscal, vis] = await Promise.all([SHC.lerChave('fiscal:' + c), SHC.lerChave('visitas:' + c)]);
    const pv = (vis && vis.porItem) || {}, hoje = SHC.hoje();
    const perdendo = [...new Set(((an && an.itens) || []).filter(i => i && SHC.anuncioAtivo(i) && pv[i.itemId]).map(i => i.itemId))]
        .filter(id => SHC.radarVisitas(pv[id].dias, hoje, cfg.radar_queda_pct).classe === 'caindo').length;
    const saude = { semFiscal: fiscal && typeof fiscal.total === 'number' ? fiscal.total : 0, perdendo };
    // itens: todos os anúncios (o Full liga os do mesmo SKU; o Ads só olha os que gastaram, cujo custo foi lido acima).
    const r = SHC.alertasDe({ full, ads, itens: todos, custos, cfg, vm, mesesLidos: lidos, hoje, conta: naConta, saude, sellerId: c });   // sellerId: mínimo do Full por conta (F23)
    await SHC.salvarAlertas({ ts: Date.now(), conta: c, criticos: r.criticos, full: r.full, ads: r.ads, contaFull: r.contaFull, saude: r.saude, lista: r.lista.slice(0, 200) });
    // v2.5.3: TODAS as anomalias (Full, estoque, frete, pagamento excedente, pós-venda, Ads, fiscal/certificado, visitas, medidas) → shc:anomalias e o ícone.
    // Certificado vencido numa remessa do Full (FF_SHIPPING_EXPIRED_CERTIFICATE) vira cert:<conta> quando o Faturador não disse nada mais novo.
    let cert = await SHC.lerChave('cert:' + c);
    // Vencido só pela remessa e a remessa lida não traz mais a restrição → o alerta sai.
    if (cert && cert.fonte === 'remessa' && fl && !/EXPIRED_CERTIFICATE/i.test(String(fl.fiscal || ''))) { await chrome.storage.local.remove('cert:' + c); cert = null; }
    if (/EXPIRED_CERTIFICATE/i.test(String((fl && fl.fiscal) || '')) && (!cert || (cert.fonte === 'remessa' ? !cert.expirou : (cert.ts || 0) < ((fl && fl.ts) || 0) && !cert.expirou))) {
        cert = { dias: null, data: null, expirou: true, ts: (fl && fl.ts) || Date.now(), fonte: 'remessa' };
        await SHC.gravarChave('cert:' + c, cert);
    }
    const [pvd, frh, cnf, rat, med, perg, rep, remDet, sem] = await Promise.all([SHC.lerChave('posvenda:' + c), SHC.lerChave('frete:' + c + ':hist'), SHC.lerChave('conferir:' + c),
        SHC.lerChave('fech:' + c + ':rateio'), SHC.lerChave('medidas:' + c), SHC.lerChave('perguntas:' + c), SHC.lerChave('reputacao:' + c), SHC.lerChave('remessas:' + c + ':detalhe'), SHC.lerChave('resumo:' + c + ':semanal')]);
    const titulos = {};
    ((an && an.itens) || []).forEach(i => { if (i && i.itemId && i.titulo && !titulos[i.itemId]) titulos[i.itemId] = String(i.titulo).slice(0, 80); });
    // v2.7: perguntas, reputação e remessas do Full com inconformidade/multa (lista + detalhes já lidos).
    const remessas = rem ? SHC.remessasResumo(rem, remDet, hoje.slice(0, 7), hoje) : null;
    const nfe = await Promise.all([hoje.slice(0, 7), mesAntes(hoje.slice(0, 7), 1)].map(m => SHC.lerChave('nfe:' + c + ':' + m)));   // v2.8: nota de venda rejeitada/com erro
    const fatura = await SHC.lerFaturas(c);   // v3.1: custo novo na fatura
    // v3.1 (pedido da dona 26/09): SKUs que pedem ação no faturamento por família (repor, enviar ao Full, baixar preço, parados) — só o que já está guardado.
    let familias = null;
    try {
        const [va, cat, cores] = await Promise.all([SHC.lerChave('vbAnuncio:' + c), SHC.lerChave('cat:' + c), SHC.lerChave('cores:' + c)]);
        if (va) familias = SHC.familiasAcoes(SHC.familias(va, cat, an, {}, hoje.slice(0, 7), { cfg, hoje, cores: cores || {} }), (an && an.itens) || [], full, { hoje });
    } catch (e) { familias = null; /* derivado: nunca derruba os alertas */ }
    const prejuizo = await SHC.lerChave('prejuizo:' + c);   // v3.2: venda nova no prejuízo (sincronizarVendasPrejuizo)
    // v3.2.0: saiu da promoção (promoSaiu:<conta>) e promoção que termina em até N dias (retrato da Central × retrato dos anúncios).
    let promo = [];
    try {
        const [saiu, promos] = await Promise.all([SHC.lerChave('promoSaiu:' + c), SHC.lerPromos(c)]), its = (an && an.itens) || [];
        promo = SHC.promoAlertas(saiu, SHC.promoTermina(its, promos, hoje, cfg.promo_aviso_dias), Date.now(), its);
    } catch (e) { promo = []; /* derivado: nunca derruba os alertas */ }
    const erpx = await SHC.lerChave('erpx:' + c);   // B2 parte 3: parado do ERP com estoque (SHC.erpConferir, gravado pelo 09-custos-erp)
    const experiencia = await SHC.lerChave('exp:' + c);   // v3.3: experiência de compra (juntarExperiencia); tarefas = avisos da lista de Anúncios (fiscal:<conta>)
    const anom = SHC.anomalias(c, { alertas: r, posvenda: pvd, frete: frh, conferir: cnf, rateio: rat, cert, medidas: med, titulos, perguntas: perg, reputacao: rep, remessas, nfe, fatura, familias, prejuizo, promo,
        experiencia, erpx, itens: (an && an.itens) || [], tarefas: (fiscal && fiscal.tarefas) || [] }, cfg);   // v2.8: módulos desligados não contam
    const snapAnom = Object.assign({ ts: Date.now() }, anom, { itens: anom.itens.slice(0, 200) });
    // Por conta também ("suas contas juntas", SHC.dadosContas). v3.3 (bloqueio 5): a chave geral (ícone e painel) só com a conta ABERTA agora.
    const aberta = (await SHC.contaAtual()) === c;
    await chrome.storage.local.set(Object.assign({ ['shc:anomalias:' + c]: snapAnom }, aberta ? { 'shc:anomalias': snapAnom } : {}));
    const rp = await roboPromoPassada(c, cfg).catch(() => null);   // v2.9: robô de promoções (só sugere; nenhum GET a mais)
    const diaNovo = !!((await SHC.lerChave(chaveResumo(c, 'dia'))) || {}).novo;   // v3.2: resumo do dia ainda não visto
    await selo(Object.assign({}, anom, { semanalNovo: sem && sem.novo ? true : diaNovo ? 'dia' : false, promoNovo: !!(rp && rp.novo) }));
    r.anomalias = anom;
    return r;
}

// ── v2.9: Robô de promoções — MODO SUGERIR. Ligado (cfg.robopromo.ligado, módulo Promoções ligado): com o retrato ml:promos:<conta>
// já lido e os custos do seller, lista as propostas em que a sobra fica ≥ a margem mínima (SHC.roboPromoSugestoes) e guarda em
// robopromo:<conta> as sugestões e o histórico. NÃO entra em promoção nenhuma: SHC.PROMO_ADESAO_CONFERIDA = false e não existe
// chamada de adesão. Desligado: devolve o que estava guardado (o histórico fica), sem ponto novo no ícone.
async function roboPromoPassada(c, cfg) {
    const k = 'robopromo:' + c, ant = await SHC.lerChave(k);
    if (!((cfg.robopromo || {}).ligado) || !SHC.moduloLigado(cfg, 'promo')) return ant ? Object.assign({}, ant, { novo: false }) : null;
    const [promos, an] = await Promise.all([SHC.lerPromos(c), SHC.lerAnuncios(c)]);
    if (!promos) return ant;
    const itemDe = {};
    ((an && an.itens) || []).forEach(i => { if (i && i.itemId && !itemDe[i.itemId]) itemDe[i.itemId] = i; });
    // Custo como a etiqueta da Central e o painel: SKU do anúncio → anúncio (MLB) → família.
    // F3: o item inteiro (todos os SKUs + skuFonte), para variação usar o maior custo e não só o do 1º SKU.
    const infos = promos.propostas.map(p => { const i = itemDe[p.itemId] || {}; return { sku: i.sku || '', skus: i.skus || [], skuFonte: i.skuFonte || '', itemId: p.itemId, familia: p.familia || i.familia || '' }; });
    const custos = await SHC.custosDe(infos), porProp = new Map(promos.propostas.map((p, i) => [p, (custos.get(infos[i]) || {}).dados || null]));
    const novo = SHC.roboPromoPassada(ant, SHC.roboPromoSugestoes(promos, p => porProp.get(p), cfg), SHC.roboPromoMargem(cfg), Date.now());
    await SHC.gravarChave(k, novo);
    return novo;
}

// ── v2.3: Full (Métricas › Estoque Full + Gestão de estoque Full), JSON pela sessão; mapeado ao vivo em 24/09/2026 ──
// page-data primeiro; a tabela por produto (todas as páginas) só se a conta tiver Full. Falhou → o retrato anterior fica.
const FULL_LIMITE = 20;          // o que a tela do ML pede por página
const FULL_PAGINAS_MAX = 50;     // → até 1.000 produtos no Full
const URL_FULL_PAGINA = BASE + '/metricas/stock-full/api/metrics/page-data?siteId=MLB&locale=pt-BR&target=fbm';
const urlFullTabela = off => BASE + '/stock-management/space-management/api/content?offset=' + off + '&limit=' + FULL_LIMITE;

async function sincronizarFull(sellerId, progresso) {
    const falha = b => ({ falha: b && b.login ? 'login' : 'indisponivel' });
    // v2.10: cada resposta lida neste ciclo fica guardada (naCiclo): a retomada no meio do Full não pede de novo.
    const pg = await naCiclo('full', 'pagina', () => buscarJson(URL_FULL_PAGINA));
    if (!pg || pg.login) return falha(pg);
    const antes = await SHC.lerFull(sellerId);
    let full = SHC.mlFullDoEstado(pg.json, null);
    // Sem Full e sem a frase do ML dizendo isso: page-data num formato desconhecido, ou conta que tinha Full → tela mudada, não grava.
    if (!full.temFull && !full.vazio && (!full.pageDataLido || (antes && antes.temFull))) return { falha: 'indisponivel' };
    // A tabela é lida sempre (1 página basta quando o page-data diz que não há Full: produto na tabela = tem Full).
    const paginas = [];
    let primeiro = '';
    for (let n = 0; n < FULL_PAGINAS_MAX; n++) {
        const t = await naCiclo('full', 'tabela|' + n, async () => { await espera(PAUSA_MS); return buscarJson(urlFullTabela(n * FULL_LIMITE)); });
        const lida = t && t.json ? SHC.mlFullDoEstado(null, t.json) : null;
        if (!lida || !lida.tabelaLida) {
            // Sem tabela reconhecida: conta que o page-data diz sem Full → fica o estado vazio; senão o retrato anterior fica.
            if (n === 0 && !full.temFull && !(t && t.login)) break;
            return falha(t);
        }
        const p0 = JSON.stringify(lida.produtos[0] || null);
        if (paginas.length && lida.produtos.length && p0 === primeiro) break;   // ML repetiu a página (offset ignorado)
        primeiro = p0;
        paginas.push(t.json);
        if (!full.temFull && !lida.temFull) break;
        const dePg = lida.totalProdutos > 0 ? Math.ceil(lida.totalProdutos / FULL_LIMITE) : null;
        await progresso({ fullProdutos: paginas.length * FULL_LIMITE }, { feito: paginas.length, de: dePg, unidade: dePg ? 'páginas' : null });
        if (lida.produtos.length < FULL_LIMITE || (lida.totalProdutos !== null && (n + 1) * FULL_LIMITE >= lida.totalProdutos)) break;
    }
    full = SHC.mlFullDoEstado(pg.json, paginas);
    // F22: teto de FULL_PAGINAS_MAX (1.000 produtos) com o ML dizendo que há mais → parcial (a aba diz "1.000 de 1.050 lidos").
    if (full.totalProdutos > ((full.produtos || []).length)) full.parcial = true;
    await SHC.salvarFull(sellerId, Object.assign({ ts: Date.now() }, full));
    return full;
}

// ── Remessas do Full (Gestão de envios Full, /shipping/inbounds: estado embutido, 20 por página), visto ao vivo em 25/09/2026 ──
// A CONFIRMAR AO VIVO: paginação por ?offset=N&limit=20. Se o ML ignorar (página repetida) ou falhar no meio, fica o que foi lido e
// parcial:true. Grava ml:full:remessas:<conta> e as flags fiscal/penalidade também em ml:full:<conta> (alertas da conta).
const REM_PAGINAS_MAX = 25;   // → até 500 remessas
async function sincronizarRemessas(sellerId, progresso) {
    const remessas = [], vistos = new Set();
    let total = null, parcial = false, flags = null;
    for (let n = 0; n < REM_PAGINAS_MAX; n++) {
        const d = await naCiclo('full', 'remessas|' + n, async () => {
            if (n) await espera(PAUSA_MS);
            const b = await buscarHtml(BASE + '/shipping/inbounds' + (n ? '?offset=' + n * FULL_LIMITE + '&limit=' + FULL_LIMITE : ''));
            const x = b && b.html ? SHC.mlRemessasFull(SHC.mlExtraiEstado(b.html)) : null;
            return x && x.reconhecida ? x : { falha: b && b.login ? 'login' : 'indisponivel' };
        });
        if (d.falha) { if (!n) return d; parcial = true; break; }
        if (!n) { total = d.total; flags = { fiscal: d.fiscal, penalidade: d.penalidade }; }
        const novas = d.remessas.filter(r => !vistos.has(r.id));
        if (!novas.length) break;   // esvaziou ou repetiu (offset ignorado): parcial se ficou abaixo do total
        novas.forEach(r => { vistos.add(r.id); remessas.push(r); });
        await progresso({});   // mantém o service worker acordado
        if (total === null || remessas.length >= total) break;
    }
    if (total !== null && remessas.length < total) parcial = true;
    const snap = Object.assign({ ts: Date.now(), total, parcial, remessas, porMes: SHC.remessasPorMes(remessas) }, flags);
    await SHC.gravarChave('ml:full:remessas:' + sellerId, snap);
    const full = await SHC.lerFull(sellerId);
    if (full) await SHC.salvarFull(sellerId, Object.assign(full, flags));
    return snap;
}
// Etapa 'full': estoque e remessas. Remessa que falhar não derruba o estoque (o retrato anterior das remessas fica).
async function sincronizarFullERemessas(sellerId, progresso) {
    const f = await sincronizarFull(sellerId, progresso);
    let rm = null;
    try { rm = await sincronizarRemessas(sellerId, progresso); } catch (e) { rm = null; }
    return f.falha ? f : Object.assign({}, f, { remessas: rm && !rm.falha ? rm : null });
}
function resumoFull(r) {
    const base = r.temFull ? SHC.qtd((r.produtos || []).length, 'produto no Full', 'produtos no Full') : 'Esta conta não usa o Full', rm = r.remessas;
    if (!rm || !rm.remessas.length) return base;
    const mes = (rm.porMes[SHC.hoje().slice(0, 7)] || {}).custo || 0;   // 0 = o ML ainda não cobrou nada: não vira "R$ 0,00"
    return base + ' · ' + SHC.qtd(rm.total !== null ? rm.total : rm.remessas.length, 'remessa', 'remessas') + (mes > 0 ? ' · ' + SHC.moeda(mes) + ' em coletas este mês' : ' · o Mercado Livre ainda não cobrou coleta este mês');
}

