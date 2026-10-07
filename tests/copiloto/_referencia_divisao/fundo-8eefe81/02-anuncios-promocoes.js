const ehLogin = u => /login|registration|\/lgz\//i.test(u || '');
async function buscarHtml(url) {
    try {
        const r = await SHC.buscarVendo(url, comTempo({ credentials: 'include', cache: 'no-store' }));   // login sem CORS → url de login
        // 401 = sessão pedindo login/verificação sem desviar (Mercado Pago ao vivo 01/10/2026: /activities → 401 com a sessão em
        // "Escolha um método de verificação"); antes virava null → "o Mercado Livre não respondeu" (#23).
        if (ehLogin(r.url) || r.status === 401) return { login: true };
        return r.ok ? { html: await r.text() } : null;
    } catch (e) { return null; }
}

// Plano B: se o fundo não levar a sessão, pede para uma aba aberta do painel buscar a página.
// → { dados } | { login } (a aba respondeu sem dados; login = também caiu no login) | null (nenhuma aba respondeu).
async function lerPaginaPorAba(acao, url) {
    const abas = await chrome.tabs.query({ url: BASE + '/*' });
    let semDados = null;
    for (const aba of abas) {
        try {
            // A aba tem 25 s para o fetch dela; 30 s sem resposta = a aba travou: segue para a próxima (a etapa não fica presa sem batida).
            const resp = await Promise.race([chrome.tabs.sendMessage(aba.id, { acao, url }), espera(30000).then(() => undefined)]);
            if (resp && resp.ok) return { dados: resp.dados };
            if (resp) semDados = { login: !!resp.login || !!(semDados && semDados.login), desvio: !!resp.desvio || !!(semDados && semDados.desvio) };   // desvio: só 'ler_json_pa'
        } catch (e) { /* aba sem o content script (recarregar resolve) */ }
    }
    return semDados;
}

// Uma página: primeiro pelo fundo; na 1ª página vazia, tenta a aba. Conta sem nada ≠ sem sessão.
// → { dados, via } | { falha: 'login' | 'indisponivel' }. Se uma aba respondeu, ela diz se foi login.
async function lerPaginaML(url, acaoAba, ler, vazia) {
    const b = await buscarHtml(url);
    const estado = b && b.html ? SHC.mlExtraiEstado(b.html) : null;
    const doFundo = estado ? ler(estado) : null;
    if (doFundo && !(vazia && vazia(doFundo))) return { dados: doFundo, via: 'fundo' };
    const porAba = await lerPaginaPorAba(acaoAba, url);
    if (porAba && porAba.dados) return { dados: porAba.dados, via: 'aba' };
    if (doFundo) return { dados: doFundo, via: 'fundo' };
    return { falha: (porAba ? porAba.login : !!(b && b.login)) ? 'login' : 'indisponivel' };
}

// Histórico do frete: só grava o que mudou (ou está com 7 dias ou mais), para não encher o armazenamento.
async function gravarFretes(itens) {
    const mapa = SHC.fretesParaGravar(itens), ids = Object.keys(mapa);
    if (!ids.length) return;
    await SHC.registraFretes(SHC.fretesQueMudaram(mapa, await SHC.lerFretes(ids), SHC.hoje()));
}

// v3.2.0 (pergunta da dona 01/10): "Saiu da promoção" — o retrato novo contra o anterior, só os MLB lidos AGORA (SHC.promoSaiuRegistra)
// → promoSaiu:<conta>. Chamar dentro da fila das gravações. Derivado: nunca derruba a leitura. → quantos eventos novos.
async function gravarPromoSaiu(conta, antes, depois, lote) {
    try {
        const t = Date.now(), ids = new Set((lote || []).map(i => i && i.itemId)), k = 'promoSaiu:' + conta, ant = await SHC.lerChave(k);
        const novo = SHC.promoSaiuRegistra(ant, antes && antes.itens, ((depois && depois.itens) || []).filter(i => i && ids.has(i.itemId)), t);
        if (!novo || novo === ant) return 0;
        await SHC.gravarChave(k, novo);
        return novo.eventos.filter(e => e.ts === t).length;
    } catch (e) { return 0; }
}

// Gravações do retrato da conta uma de cada vez (sincronização e abas não se atropelam).
let filaRetrato = Promise.resolve();
const emFila = fn => (filaRetrato = filaRetrato.then(fn, fn));

// SKU que a lista de Anúncios não mostra (anúncio com variações): o que o Copiloto já leu em outras telas do ML (vendas por anúncio,
// Full) + o retrato anterior. Só leitura do que já está guardado. → opc de SHC.mesclaAnuncios.
async function fontesSku(conta, antes) {
    let vb = null, full = null, editor = null;
    try { [vb, full, editor] = await Promise.all([SHC.lerChave('vbAnuncio:' + conta), SHC.lerFull(conta), SHC.lerChave('editor:' + conta)]); } catch (e) { /* sem as outras telas: só o retrato */ }
    return { antes, conhecidos: SHC.skusConhecidos({ vbAnuncio: vb, full, editor }) };
}
// Depois de ler vendas por anúncio e Full: completa o SKU vazio do retrato já gravado (sem esperar a próxima leitura dos Anúncios).
async function completarSkusRetrato(conta) {
    await emFila(async () => {
        const snap = await SHC.lerAnuncios(conta);
        if (!snap || !Array.isArray(snap.itens) || !snap.itens.some(i => i && !i.sku)) return;
        const itens = SHC.completaSkus(snap.itens, (await fontesSku(conta, null)).conhecidos);
        if (itens.some((it, i) => it !== snap.itens[i])) await SHC.salvarAnuncios(conta, Object.assign({}, snap, { itens }));
    });
}

// Lista de Anúncios, todas as páginas. progresso() grava o andamento (e mantém o service worker acordado).
// v3.2 (auditoria 30/09/2026: o Copiloto via ~170 de 383 MLB): as páginas + as famílias fechadas + os "Ver mais N opções de venda", pelo
// MESMO GET que a página usa (SHC.mlLeituraCompleta, uma chamada de cada vez com a pausa de sempre). O total do ML conta LINHAS.
// Auditoria 01/10/2026: o ML pediu calma (429/503) → espera o Retry-After (mín. 10 s) e NÃO repete o GET em cada aba (seria 1 + N abas sem pausa).
// 200 com documentGroup vazio pode ser o fundo sem o contexto da sessão → tenta a aba também; se ela não ajudar, devolve o que o fundo trouxe.
async function abrirNaLista(id, page) {
    const url = BASE + SHC.mlUrlAbrir(id, page), b = await buscarJsonMotivo(url);
    if (b.json && Array.isArray(b.json.documentGroup) && b.json.documentGroup.length) return b.json;
    if (b.falha === 'ocupado') { await espera(Math.max(10000, b.espera || 0)); return null; }
    const a = await lerPaginaPorAba('ler_json_ml', url);   // plano B: a aba aberta do painel busca com a sessão dela
    return a && a.dados ? a.dados : (b.json || null);
}
async function sincronizarAnuncios(progresso) {
    // Cada página e cada família lida fica guardada no ciclo (naCiclo): a etapa leva ~9 min e a retomada depois de uma queda não volta do zero.
    // Família que veio vazia não é guardada (a retomada pede de novo).
    const abrir = async (id, p) => {
        const v = await naCiclo('anuncios', 'abre|' + id + '|' + p, async () => {
            const j = await abrirNaLista(id, p);
            return j ? (Array.isArray(j.documentGroup) && j.documentGroup.length ? { j } : { j, falha: 'vazio' }) : null;
        });
        return v ? v.j : null;
    };
    const lc = await SHC.mlLeituraCompleta({
        maxPaginas: PAGINAS_ANUNCIOS_MAX, progresso, pausa: () => espera(PAUSA_MS), abrir,
        ler: n => naCiclo('anuncios', 'p|' + n, () => lerPaginaML(BASE + '/anuncios/lista' + (n > 1 ? '?page=' + n : ''), 'ler_pagina_anuncios', SHC.mlPaginaAnuncios, n === 1 ? d => !(d.chaves || d.itens).length : null)),
    });
    if (lc.falha) return { falha: lc.falha };
    const itens = lc.itens, vistos = new Set(itens.map(i => i && i.itemId).filter(Boolean)), { paginas, total, conta, via, familias } = lc;
    const completo = lc.completo;
    // Pausados/inativos/restritos: filtro OMNI_INACTIVE (mapeado ao vivo em 24/09/2026; o frete deles aparece igual).
    for (let n = 1; n <= 20 && paginas > 0; n++) {
        const url = BASE + '/anuncios?filters=OMNI_INACTIVE&page=' + n + '&sort=DEFAULT';
        const pag = await lerPaginaML(url, 'ler_pagina_anuncios', SHC.mlPaginaAnuncios, null);
        const lidos = (!pag.falha && pag.dados && Array.isArray(pag.dados.itens)) ? pag.dados.itens : [];
        const novos = lidos.filter(i => i && i.itemId && !vistos.has(i.itemId));
        if (!novos.length) break;
        novos.forEach(i => vistos.add(i.itemId));
        itens.push(...novos);
        await progresso({ anuncios: vistos.size });
        await espera(PAUSA_MS);
    }
    const sellerId = conta && conta.sellerId ? conta.sellerId : 'atual';
    if (conta && conta.sellerId) await SHC.registraConta(conta.sellerId, conta.apelido);   // v2.8: guarda também o nome da própria conta (nunca o e-mail)
    // Nenhum anúncio lido e o ML não disse "0": pode ser tela mudada. Não apaga o retrato que já existe.
    if (!itens.length && total !== 0) return { sellerId, snap: await SHC.lerAnuncios(sellerId), paginas, total, via, completo: false };
    // Leitura completa substitui o retrato (anúncio excluído some); leitura interrompida só junta. O SKU que a lista não mostra
    // (anúncio com variações) é completado com o das outras telas e com o já conhecido do mesmo anúncio (fontesSku).
    const snap = await emFila(async () => {
        const antes = await SHC.lerAnuncios(sellerId);
        const s = SHC.mesclaAnuncios(completo ? null : antes, itens, { paginas, total, linhas: lc.linhas, completo, familias }, await fontesSku(sellerId, antes));
        await SHC.salvarAnuncios(sellerId, s);
        await gravarPromoSaiu(sellerId, antes, s, itens);   // v3.2.0: o sino vem na etapa Alertas desta sincronização
        return s;
    });
    await emFila(() => gravarFretes(itens));   // F4: frete só da lista de Anúncios, no preço atual (na fila das gravações)
    // Histórico da competição (comp:<conta>): um registro por anúncio só quando o estado, o motivo ou o preço muda.
    await emFila(async () => { const k = 'comp:' + sellerId; await SHC.gravarChave(k, SHC.compRegistra(await SHC.lerChave(k), itens, SHC.hoje())); });
    // v3.2: degraus de atacado dos anúncios que a lista marca "Com N preço(s) de atacado" (o MESMO GET do balão do ML) → atacado:<conta>.
    await lerAtacado(sellerId, itens.filter(i => i && i.atacado).map(i => i.itemId));
    await erpConferir(sellerId).catch(() => {});   // v3.2: cruzamento ERP × ML com a lista nova (só o que já está guardado)
    return { sellerId, snap, paginas, total, via, completo };
}

// v3.2 Preço de atacado: atacado:<conta> = { ts, porItem:{ MLB: { degraus:[{qtd, preco, revisar?}], ts } } } (degraus [] = lido, sem atacado).
// Só GET, um de cada vez com a pausa de sempre; o ML responde 424 para anúncio sem atacado. ponytail: teto de 40 por sincronização.
const ATACADO_MAX = 40;
async function lerAtacado(conta, ids) {
    const porItem = {};
    for (const id of [...new Set(ids)].slice(0, ATACADO_MAX)) {
        if (!/^MLB\d{6,14}$/.test(String(id))) continue;
        const b = await buscarJsonMotivo(BASE + '/anuncios/api/listing/tooltip?type=tiered_pricing&documentId=' + id);
        if (b.json) porItem[id] = SHC.mlAtacadoDoTooltip(b.json);
        else if (b.falha === 'erro 424') porItem[id] = [];
        else if (b.login || b.falha === 'ocupado') break;
        await espera(PAUSA_MS);
    }
    await gravarAtacado(conta, porItem);
}
async function gravarAtacado(conta, porItem) {
    const ids = Object.keys(porItem);
    if (!ids.length) return;
    await emFila(async () => {
        const k = 'atacado:' + conta, ant = await SHC.lerChave(k), p = Object.assign({}, (ant && ant.porItem) || {}), ts = Date.now();
        ids.forEach(id => { p[id] = { degraus: SHC.atacadoLimpo(porItem[id]), ts }; });
        await SHC.gravarChave(k, { ts, porItem: p });
    });
}

// Central de promoções, todas as páginas. O frete NÃO sai daqui (preços de proposta ≠ preço atual).
// v2.4 (V14): grava em ml:promos:<conta>. 0 famílias: retrato vazio só com a frase do ML ("sem promoções"); senão falha e o anterior fica.
// F6 (auditoria 30/09): página do MEIO que falha não corta o retrato calada — grava completo:false com o total da Central, junta com o
// retrato anterior (as famílias que não vieram agora ficam) e devolve falha (o painel diz "X de Y"). F15: caixas sem a conta do ML
// (aporte/redução de tarifa) entram como semCalculo [{familia, promo, datas}] — antes sumiam do painel.
async function sincronizarPromos(conta, progresso) {
    const familias = [], propostas = [], semCalculo = [];
    let paginas = 0, via = '', vazio = false, total = null, falhou = 0;
    for (let n = 1; n <= PAGINAS_MAX; n++) {
        const url = BASE + '/anuncios/lista/promos' + (n > 1 ? '?page=' + n : '');
        // Página lida neste ciclo fica guardada (naCiclo): a retomada depois de uma queda não pede de novo.
        const pag = await naCiclo('promos', 'p|' + n, () => lerPaginaML(url, 'ler_pagina_promos', SHC.mlPromosDoEstado, n === 1 ? d => !d.familias.length : null));
        if (pag.falha) { if (n === 1) return { falha: pag.falha }; falhou = n; break; }
        if (n === 1) { via = pag.via; vazio = !!pag.dados.vazio; total = typeof pag.dados.total === 'number' ? pag.dados.total : null; }
        const novas = pag.dados.familias.filter(f => !familias.some(x => x.chave === f.chave));
        if (!novas.length) break;                         // passou da última página
        familias.push(...novas);
        propostas.push(...pag.dados.propostas.filter(p => novas.some(f => f.chave === p.familia)));
        semCalculo.push(...(pag.dados.semCalculo || []).filter(c => novas.some(f => f.chave === c.familia)).map(c => ({ familia: c.familia, promo: c.nome, datas: c.datas, semCalculo: true })));
        paginas = n;
        await progresso({ paginas: n });
        await espera(PAUSA_MS);
    }
    if (falhou) {
        const ant = await SHC.lerPromos(conta), snap = SHC.juntaPromosParcial(ant, { familias, propostas, semCalculo }, { paginas, total, falhou });
        await SHC.salvarPromos(conta, Object.assign({ ts: Date.now() }, snap));
        return { falha: 'indisponivel', familias: snap.familias.length, total };
    }
    if (familias.length) await SHC.salvarPromos(conta, { ts: Date.now(), paginas, familias, propostas, semCalculo, total, completo: true });
    else if (vazio) await SHC.salvarPromos(conta, { ts: Date.now(), paginas: 1, familias: [], propostas: [], semCalculo: [], vazio: true, completo: true });
    else return { falha: 'indisponivel' };   // 0 famílias sem o sinal do ML: pode ser tela mudada — não apaga o que havia
    return { familias: familias.length, propostas: propostas.length, paginas, via, vazio: !familias.length };
}

