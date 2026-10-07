// ── v2.7: detalhe das remessas do Full (GET /shipping/inbounds/<id>/details, estado embutido). Só as abertas e as dos últimos 90 dias; remessa
// fechada é lida 1 vez (relê só aberta/em andamento, a cada 24 h); 1 a cada ~3 s, até REM_DET_MAX por rodada → remessas:<conta>:detalhe = {ts, porId:{id:{…, ts}}}.
const REM_DET_MAX = 15, REM_DET_DIAS = 90, REM_DET_ABERTA_MS = 864e5;
async function lerDetalhesRemessas(conta) {
    const [lista, det] = await Promise.all([SHC.lerChave('ml:full:remessas:' + conta), SHC.lerChave('remessas:' + conta + ':detalhe')]);
    const porId = (det && det.porId) || {}, lim = diaMenos(SHC.hoje(), REM_DET_DIAS), agora = Date.now();
    const fechada = r => /^(closed_ok|closed_with_changes|cancelled|canceled|expired)$/.test(String(r.status || ''));
    const alvo = ((lista && lista.remessas) || []).filter(r => r && r.id && (!fechada(r) || (r.recebida || r.agendada || r.atualizada || '') >= lim))
        .filter(r => { const d = porId[r.id]; return !d || (!fechada(r) && agora - (d.ts || 0) >= REM_DET_ABERTA_MS); })
        .sort((a, b) => (fechada(a) - fechada(b)) || String(b.agendada || '').localeCompare(String(a.agendada || ''))).slice(0, REM_DET_MAX);
    let lidas = 0;
    for (const r of alvo) {
        if (lidas) await espera(SAUDE_PAUSA_MS);
        const b = await buscarHtml(BASE + '/shipping/inbounds/' + encodeURIComponent(r.id) + '/details');
        if (!b || b.login) { if (b && b.login) break; continue; }
        const d = SHC.mlRemessaDetalheDoEstado(SHC.mlExtraiEstado(b.html));
        if (!d || d.id !== String(r.id)) continue;   // tela desconhecida ou de outra remessa: não grava
        lidas++;
        await mudaChave('remessas:' + conta + ':detalhe', v => {
            v.porId = v.porId || {};
            v.porId[d.id] = Object.assign(d, { ts: Date.now() });
            // Só as que ainda estão na lista e dentro dos 90 dias (as outras saem, para não crescer sem fim).
            const vale = new Set(((lista && lista.remessas) || []).filter(x => x && x.id && (!fechada(x) || (x.recebida || x.agendada || x.atualizada || '') >= lim)).map(x => String(x.id)));
            Object.keys(v.porId).forEach(id => { if (!vale.has(id)) delete v.porId[id]; });
            v.ts = Date.now();
        });
    }
    if (lidas) await atualizarAlertas(conta).catch(() => {});
    return { lidas, de: alvo.length };
}

// ── v3.2: VENDA NOVA NO PREJUÍZO (etapa Alertas). 1 GET da 1ª página da lista de Vendas (estado embutido, só produto/valor/status/dia:
// SHC.mlVendasDaLista) + a MESMA conta da etiqueta da lista (SHC.telaVendaConta: retrato dos anúncios, frete cobrado por pedido, custos).
// Venda nova com custo que deu prejuízo → prejuizo:<conta> (SHC.vendasPrejuizo) e o alerta urgente no ícone e na Geral (SHC.anomalias).
// Nada do comprador é lido nem guardado; só o nº do pedido (para nunca repetir) e o link da venda no ML. Módulo Conciliação desligado → nem lê.
importScripts('ml-tela.js');   // só a parte pura (SHC.mlVendasDaLista, SHC.telaVendaConta): o resto do arquivo só roda numa página
async function sincronizarVendasPrejuizo(conta, progresso) {
    const k = 'prejuizo:' + conta, [cfg, ant] = await Promise.all([SHC.lerCfg(), SHC.lerChave(k)]);
    if (!conta || conta === 'atual' || !SHC.moduloLigado(cfg, 'conciliacao') || !SHC.mlVendasDaLista || !SHC.vendasPrejuizo) return ant;
    await bateVivo(progresso);
    await espera(PAUSA_MS);
    // F11: antes só a 1ª página (~25 vendas). Agora segue as páginas (só GET) até alcançar a leitura anterior (pedido já visto ou venda
    // de antes do último dia lido), o total da lista ou o teto de 10. Página que falha ou só repete pedidos (o ML ignorou o parâmetro,
    // ainda a confirmar ao vivo) para a leitura: os dias não alcançados ficam "lidos só em parte" (furo/cortes de SHC.vendasPrejuizo).
    const lePag = async n => { const h = await buscarHtml(SHC.vendasListaPagina ? SHC.vendasListaPagina(n) : SHC.VENDAS_LISTA_URL); const e = h && h.html ? SHC.mlExtraiEstado(h.html) : null; return e ? { v: SHC.mlVendasDaLista(e), t: SHC.mlVendasTotal ? SHC.mlVendasTotal(e) : null } : null; };
    const p1 = await lePag(1), vendas = p1 && p1.v;
    if (!vendas) return ant;   // não leu (sessão, formato mudado): fica o de antes, nunca "nenhuma venda"
    const hoje0 = SHC.hoje(), ate = [diaMenos(hoje0, 1), ant && ant.dia].filter(Boolean).sort()[0], ped = new Set(vendas.map(v => v.pedido));
    const alcancou = () => vendas.some(v => (ant && ant.vistos && ant.vistos[v.pedido]) || ((SHC.dataVendaLista(v.quando, hoje0) || '9') < ate));
    let paginasV = 1, cortadoV = false;
    for (let n = 2; p1.t !== null && vendas.length < p1.t && !alcancou(); n++) {
        if (n > 10) { cortadoV = true; break; }
        await bateVivo(progresso);
        await espera(PAUSA_MS);
        const x = await lePag(n), novas = x && x.v ? x.v.filter(v => v && v.pedido && !ped.has(v.pedido)) : [];
        if (!novas.length) { cortadoV = true; break; }
        novas.forEach(v => { ped.add(v.pedido); vendas.push(v); });
        paginasV = n;
    }
    // v3.3: as mesmas cobranças (mês e anterior), Ads, afiliados e Full da etiqueta da tela (SHC.vendaExtras) → aviso e etiqueta com a mesma conta.
    const hojeX = SHC.hoje(), [anoX, mmX] = hojeX.slice(0, 7).split('-').map(Number), mesAntX = mmX === 1 ? (anoX - 1) + '-12' : anoX + '-' + String(mmX - 1).padStart(2, '0');
    const [snap, fp, fh, cob1, cob0, adsX, afilX, fullX] = await Promise.all([SHC.lerAnuncios(conta), SHC.lerChave('frete:' + conta + ':pedidos'), SHC.lerChave('frete:' + conta + ':hist'),
        SHC.lerChave('cob:' + conta + ':' + hojeX.slice(0, 7)), SHC.lerChave('cob:' + conta + ':' + mesAntX), SHC.lerChave('ads:' + conta), SHC.lerChave('afil:' + conta), SHC.lerChave('ml:full:' + conta)]);
    const extras = SHC.vendaExtras ? SHC.vendaExtras({ cobs: [cob0, cob1], ads: adsX, afil: afilX, full: fullX, hoje: hojeX, itens: snap && snap.itens }) : null;
    const porId = new Map();
    ((snap && snap.itens) || []).forEach(i => { if (i && i.itemId && !porId.has(i.itemId)) porId.set(i.itemId, i); });
    const anuncio = id => porId.get(id) || null, chaveP = x => x.itemId + '|' + x.sku, infos = new Map();
    vendas.forEach(v => (v.produtos || []).forEach(x => {
        const it = porId.get(x.itemId);
        // Venda com o SKU da variação vendida: custo dela. Sem SKU: o anúncio inteiro (todas as variações, F3).
        if (!infos.has(chaveP(x))) infos.set(chaveP(x), x.sku ? { sku: x.sku, familia: (it && it.familia) || '', itemId: x.itemId }
            : { sku: (it && it.sku) || '', skus: (it && it.skus) || [], skuFonte: (it && it.skuFonte) || '', familia: (it && it.familia) || '', itemId: x.itemId });
    }));
    const m = infos.size ? await SHC.custosDe([...infos.values()]) : new Map(), custos = new Map();
    infos.forEach((i, kk) => custos.set(kk, m.get(i)));
    const custoDe = x => (custos.get(chaveP(x)) || {}).dados || null;
    const tipico = id => { const a = fh && fh.porAnuncio && fh.porAnuncio[id], t = a && a.ult30 && a.ult30.tipico; return t > 0 ? t : null; };
    const novo = SHC.vendasPrejuizo(vendas, ant, { anuncio, custoDe, cfg, pedidos: (fp && fp.pedidos) || {}, vendasFat: (fp && fp.vendas) || {}, tipico, extras, hoje: SHC.hoje(), agora: Date.now() });
    Object.assign(novo, { paginas: paginasV, cortado: cortadoV });   // F11: quantas páginas da lista de Vendas e se parou antes de alcançar a leitura anterior
    await SHC.gravarChave(k, novo);
    return novo;
}

// ── v2.7: radar leve (etapa Alertas): Resumo (JSON), perguntas e reputação (estado embutido). Cada leitura é independente: a que falhar deixa a anterior.
// Só quantidades, tempos, ids de anúncio e links; nada de texto de pergunta nem de comprador. ──
async function sincronizarRadar(conta, progresso) {
    const out = { resumo: false, perguntas: false, reputacao: false };
    const j = await buscarJson(BASE + '/resumo/api/content');
    const res = j && j.json ? SHC.mlResumoDoConteudo(j.json) : null;
    if (res) { await SHC.gravarChave('resumo:' + conta, res); out.resumo = true; }
    if (j && j.login) return out;   // sessão caiu: não insiste
    await bateVivo(progresso);   // pedido de até 25 s + pausa + o próximo: sem batida o worker cai no meio
    await espera(PAUSA_MS);
    const p = await buscarHtml(BASE + '/perguntas/vendedor');
    const perg = p && p.html ? SHC.mlPerguntasDoEstado(SHC.mlExtraiEstado(p.html)) : null;
    if (perg || (res && res.perguntas)) {
        const ant = (await SHC.lerChave('perguntas:' + conta)) || {};
        // Contagem: 1º o cartão "Perguntas N" do Resumo (total pendente); a da página só como reserva (o contador dela obedece ao período).
        const doResumo = res && res.perguntas && typeof res.perguntas.pendentes === 'number';
        const pend = doResumo ? res.perguntas.pendentes : (perg && perg.pendentes !== null ? perg.pendentes : null);
        await SHC.gravarChave('perguntas:' + conta, Object.assign({}, perg || { tempoMedio: ant.tempoMedio || null, faixas: ant.faixas || [], media: ant.media || null, amostra: ant.amostra || '' },
            { pendentes: pend, link: (res && res.perguntas && res.perguntas.link) || 'https://www.mercadolivre.com.br/perguntas/vendedor', fonte: doResumo ? 'resumo' : 'perguntas', ts: Date.now() }));
        out.perguntas = true;
    }
    if (p && p.login) return out;
    await bateVivo(progresso);
    await espera(PAUSA_MS);
    const r = await buscarHtml(BASE + '/reputacao');
    const rep = r && r.html ? SHC.mlReputacaoDoEstado(SHC.mlExtraiEstado(r.html)) : null;
    if (rep) { await SHC.gravarChave('reputacao:' + conta, rep); out.reputacao = true; }
    return out;
}

// ── v2.7 → v3.2: RESUMO PARA A EQUIPE (pedido da dona 30/09). Gera o TEXTO (SHC.resumoExecutivo) com o que já está guardado (nenhum GET) →
// resumo:<conta>:dia (ontem, toda manhã) e resumo:<conta>:semanal (segunda) = {ts, periodo, de, ate, semana, texto, textoWa, waLink, encurtado, vendas, novo, origem}.
// O alarme só gera e marca novo:true (o ícone mostra "•"); quem envia é o seller, pelo link wa.me sem número. ──
const chaveResumo = (conta, periodo) => 'resumo:' + conta + ':' + (periodo === 'dia' ? 'dia' : 'semanal');
async function gerarResumo(conta, periodo, origem) {
    if (!conta || conta === 'atual') return { ok: false, motivo: 'sem_conta' };
    // mes = o mês de ONTEM (o último dia do resumo): no dia 1º o lucro e o crescendo/caindo são do mês que acabou, não do mês novo quase sem dado.
    const hoje = SHC.hoje(), mes = diaMenos(hoje, 1).slice(0, 7), per = periodo === 'dia' ? 'dia' : 'semana', L = k => SHC.lerChave(k);
    const [vb, va, cat, an, cfg, anom, perg, rep, cert, rem, remDet, contasMl, visitas, comp, full, posvenda, conferir, fatura, frete, prejuizo] = await Promise.all([SHC.lerVendasBrutas(conta),
        L('vbAnuncio:' + conta), L('cat:' + conta), SHC.lerAnuncios(conta), SHC.lerCfg(), L('shc:anomalias:' + conta), L('perguntas:' + conta), L('reputacao:' + conta), L('cert:' + conta),
        L('ml:full:remessas:' + conta), L('remessas:' + conta + ':detalhe'), L('ml:contas'), L('visitas:' + conta), L('comp:' + conta), L('ml:full:' + conta), L('posvenda:' + conta),
        L('conferir:' + conta), L('fat:' + conta), L('frete:' + conta + ':hist'), L('prejuizo:' + conta)]);   // v3.2: prejuizo = vendas no prejuízo (seção 🔴 do resumo)
    const itens = (an && an.itens) || [];
    // v3.2.0: seção 🏷️ Promoções (saiu da promoção no período + promoção que acaba em até N dias)
    let promoSaiu = null, promoTermina = null;
    try { const [ps, pr] = await Promise.all([L('promoSaiu:' + conta), SHC.lerPromos(conta)]); promoSaiu = ps; promoTermina = SHC.promoTermina(itens, pr, hoje, cfg.promo_aviso_dias); } catch (e) { promoSaiu = null; promoTermina = null; }
    // Lucro, SKUs subindo/caindo (com o gargalo de quem caiu), sazonalidade e ações do Full: a MESMA conta da aba Famílias (SHC.familias).
    let lucro = null, skus = null, sazonal = [], acoesFam = null;
    try {
        const chaves = new Set();
        // F2: o custo de todas as variações, não só o do 1º SKU.
        itens.forEach(i => { if (i) SHC.skusDoAnuncio(i).forEach(s => chaves.add(SHC.chaveSku(s))); if (i && i.itemId) chaves.add(SHC.chave('ml', i.itemId)); if (i && i.familia) chaves.add(SHC.chave('ml', i.familia)); });
        chaves.delete('');
        const custos = chaves.size ? await SHC.lerCustos([...chaves]) : {};
        const fam = SHC.familias(va, cat, an, custos, mes, { cfg, hoje });
        if (fam.lido) {
            const com = fam.filter(f => typeof f.lucro === 'number');
            if (com.length) {
                const total = fam.reduce((s, f) => s + (f.bruto || 0), 0), coberto = com.reduce((s, f) => s + (f.bruto || 0), 0);
                lucro = { valor: SHC.r2(com.reduce((s, f) => s + f.lucro, 0)), parcial: com.length < fam.length || fam.some(f => f.lucroParcial), cobertoPct: total > 0 ? coberto / total * 100 : null };
            }
            // Top 3 pelo R$ que ganhou/perdeu (não pelo %: +1.800% de R$ 20 não é o que mais importa).
            const todos = fam.flatMap(f => (f.skus || []).map(s => ({ s, f }))).filter(x => x.s && typeof x.s.variacaoPct === 'number' && x.s.brutoAnt > 0), rs = x => x.s['variacaoR$'] || 0;
            const gar = x => { try { return SHC.gargaloQueda(x.s, { mes: fam.mes, dias: fam.diasCobertos, familia: x.f, conta: fam, itens, visitas: visitas && visitas.porItem, comp, full, cfg, hoje }); } catch (e) { return null; } };
            skus = { subindo: todos.filter(x => x.s.variacaoPct > 0).sort((a, b) => rs(b) - rs(a)).slice(0, 3).map(x => x.s),
                caindo: todos.filter(x => x.s.variacaoPct < 0).sort((a, b) => rs(a) - rs(b)).slice(0, 3).map(x => Object.assign({}, x.s, { gargalo: gar(x) })) };
            sazonal = fam.map(f => Object.assign({ familia: f.familia }, SHC.sazonalCompra(f, { hoje }))).filter(z => z.aplica);
            acoesFam = SHC.familiasAcoes(fam, itens, full, { hoje });
        }
    } catch (e) { lucro = null; skus = null; }
    const r = SHC.resumoExecutivo(conta, { nome: SHC.nomeConta(conta, cfg, contasMl), mes, vb, lucro, skus, itens, visitas, comp, sazonal, acoesFam, anomalias: anom, perguntas: perg,
        reputacao: rep, cert, posvenda, conferir, fatura, frete, cfg, prejuizo, promoSaiu, promoTermina, remessas: rem ? SHC.remessasResumo(rem, remDet, mes, hoje) : null }, hoje, { periodo: per });
    const k = chaveResumo(conta, per), ant = await SHC.lerChave(k);
    const snap = { ts: Date.now(), periodo: per, de: r.de, ate: r.ate, semana: { de: r.de, ate: r.ate }, texto: r.texto, textoWa: r.textoWa, waLink: r.waLink, encurtado: r.encurtado, vendas: r.vendas,
        novo: origem === 'alarme' ? true : !!(ant && ant.novo), origem: origem || 'pedido' };
    await SHC.gravarChave(k, snap);
    if (origem === 'alarme') await seloAgora();   // o "•" do robô de promoções não se perde
    return { ok: true, resumo: snap };
}

