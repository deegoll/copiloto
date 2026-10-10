// ── v2.5.3 (D7): certificado digital lido pela aba do Faturador (content script) → cert:<conta> = {dias, data, expirou, ts, fonte:'faturador'}.
// Aceita {dias, data, expirou} já lidos ou {titulo, texto} (lidos aqui por SHC.certificadoDoTexto). Nunca guarda razão social nem CNPJ. ──
function certDaMsg(m) {
    const t = m.titulo !== undefined || m.texto !== undefined ? SHC.certificadoDoTexto(String(m.titulo || '').slice(0, 300), String(m.texto || '').slice(0, 1000)) : null;
    const dias = t ? t.dias : (Number.isInteger(m.dias) && Math.abs(m.dias) <= 3650 ? m.dias : null);
    const data = t ? t.data : (/^\d{4}-\d{2}-\d{2}$/.test(String(m.data || '')) ? String(m.data) : null);
    const expirou = t ? t.expirou : m.expirou === true || (dias !== null && dias < 0);
    if (dias === null && data === null && !expirou) return null;
    return { dias, data, expirou, ts: Date.now(), fonte: 'faturador' };
}
// conta = a já conferida pelo fundo/14 (a da página igual à aberta, ou a única conta com a sessão conferida): nunca relida aqui (ml:conta pode
// ter mudado entre a conferência e a gravação).
async function gravarCertificado(msg, conta) {
    // Faturador aberto e sem o aviso do certificado (renovado): {ok:true} tira o alerta; uma remessa do Full mais nova ainda pode marcar vencido.
    const c = msg && msg.semAviso === true ? { ok: true, ts: Date.now(), fonte: 'faturador' } : certDaMsg(msg || {});
    if (!c) return { ok: false, motivo: 'texto' };
    if (!conta) return { ok: false, motivo: 'conta' };
    // 3.2.1: o "vencido" que veio da remessa do Full (lida pelo fundo) só sai pela própria remessa, não pela tela sem o aviso.
    const ant = c.ok ? await SHC.lerChave('cert:' + conta) : null;
    if (ant && ant.fonte === 'remessa' && ant.expirou) return { ok: true, cert: ant };
    await SHC.gravarChave('cert:' + conta, c);
    await atualizarAlertas(conta).catch(() => {});
    return { ok: true, cert: c };
}

// ── v2.5: rodada lenta de fotos e visitas (alarme 'shc-saude', só com o Chrome aberto; nunca dentro da sincronização). Anúncios ATIVOS do
// retrato, dos que mais vendem para os que menos vendem; 1 anúncio a cada ~3 s, no máximo 60 por rodada. Fotos: tela "Alterar anúncio"
// (GET; só com a permissão opcional de www.mercadolivre.com.br), relidas a cada 7 dias. Visitas por dia: a cada 24 h.
// fotos:<conta> = { ts, porItem:{MLB:{qtd, max, capaId, ids, problemas, visitasTotal, vendidasTotal, ts}}, lidos, de, semPermissao }
// visitas:<conta> = { ts, porItem:{MLB:{ts, dias:{'AAAA-MM-DD': visitas totais}, total30, unicas30, variacaoPct, conversao}} } (até 60 dias)
// Andamento: shc:status.saudeProgresso = {feito, de, ts} | null (pela mesma fila do status: nunca prende nem briga com a sincronização).
const SAUDE_ALARME_MIN = 60, SAUDE_PAUSA_MS = 3000, SAUDE_MAX = 60, FOTOS_VALIDO_MS = 7 * 864e5, VISITAS_VALIDO_MS = 864e5;
async function temPermissaoWww() {
    try { return !!(chrome.permissions && chrome.permissions.contains && await chrome.permissions.contains({ origins: ['https://www.mercadolivre.com.br/*'] })); } catch (e) { return false; }
}
// Tela "Alterar anúncio" (1 GET) → { f (fotos) | null, m (medidas, v2.5.2) | null, c (categoria, v2.6) | null, r, html } | { falha: 'login'|'indisponivel' }
async function lerTelaAnuncio(itemId) {
    const b = await buscarHtml(SHC.fotosLink(itemId));
    if (!b || b.login) return { falha: b && b.login ? 'login' : 'indisponivel' };
    const r = SHC.mlExtraiEstado(b.html), f = r ? SHC.mlFotosDoEstado(r, b.html) : null, m = r ? SHC.mlMedidasDoEstado(r) : null;
    // A categoria não traz o MLB: só vale se a tela é deste anúncio (fotos/medidas, quando vieram, dizem o mesmo MLB).
    const c = r && (!f || !f.itemId || f.itemId === itemId) && (!m || !m.itemId || m.itemId === itemId) ? SHC.mlCategoriaDoEstado(r) : null;
    // v3.1: competição no catálogo (brick competition_task) da MESMA leitura; só vale se a linha "Seu anúncio" é este MLB.
    const k = r ? SHC.mlCompeticaoDoEstado(r) : null;
    return { f: f && !(f.itemId && f.itemId !== itemId) ? f : null, m: m && !(m.itemId && m.itemId !== itemId) ? m : null, c, k: k && k.itemId === itemId ? k : null, r, html: b.html };
}
// Só as fotos (robô) → { f (SHC.mlFotosDoEstado), jwt e csrf (só em memória, para gravar AGORA) } | { falha }
async function lerFotosAnuncio(itemId) {
    const t = await lerTelaAnuncio(itemId);
    if (t.falha) return { falha: t.falha };
    if (!t.f) return { falha: 'indisponivel' };
    return { f: t.f, jwt: SHC.mlJwtDoEstado(t.r), csrf: SHC.mlCsrfDoHtml(t.html) };
}
// ler-mudar-gravar de fotos:/visitas:/robo: na fila das gravações (rodada, leitura na hora e robô não se atropelam)
const mudaChave = (k, fn) => emFila(async () => { const v = (await SHC.lerChave(k)) || {}; fn(v); await SHC.gravarChave(k, v); return v; });
const guardaFotos = (conta, id, f) => mudaChave('fotos:' + conta, v => { v.porItem = v.porItem || {}; v.porItem[id] = SHC.fotosParaGuardar(f); });
// Leitura de fotos (ou medidas) que falhou (tela sem elas, redirecionou…): marca {falhaTs, falhas} (a leitura boa anterior fica) → recuo de 24 h que dobra.
const falhaEm = (k, id) => mudaChave(k, v => { v.porItem = v.porItem || {}; const a = v.porItem[id] || {}; v.porItem[id] = Object.assign({}, a, { falhaTs: Date.now(), falhas: (a.falhas || 0) + 1 }); });
const falhaFotos = (conta, id) => falhaEm('fotos:' + conta, id);
// v2.5.2: medidas:<conta> = { ts, porItem:{MLB: SHC.medidasRegistra(...).entrada (+ falhaTs/falhas)}, mudancas:[mudanca] (máx. 100, a mais nova 1º), lidos, de, semPermissao }
const guardaMedidas = (conta, id, sku, m) => {
    let res = null;
    return mudaChave('medidas:' + conta, v => {
        v.porItem = v.porItem || {};
        res = SHC.medidasRegistra(v.porItem[id], m, { itemId: id, sku, agora: Date.now() });
        v.porItem[id] = res.entrada;
        if (res.mudanca) v.mudancas = [res.mudanca].concat(v.mudancas || []).slice(0, 100);
        v.ts = Date.now();
    }).then(() => res);
};
// v2.6: cat:<conta> = { ts, porItem:{MLB:{familia, sub, categoriaId, ts} (+ falhaTs/falhas quando a tela não trouxe a categoria)} }
const guardaCategoria = (conta, id, c) => mudaChave('cat:' + conta, v => {
    v.porItem = v.porItem || {}; v.porItem[id] = { familia: c.familia, sub: c.sub || '', categoriaId: c.categoriaId || '', ts: Date.now() }; v.ts = Date.now();
});
// v3.1: catcomp:<conta> = { ts, porItem:{MLB: SHC.compCatRegistra(...)} } — quem ganha o catálogo, preço para ganhar, alavancas e winRate por dia.
const guardaCompCat = (conta, id, k) => mudaChave('catcomp:' + conta, v => { v.porItem = v.porItem || {}; v.porItem[id] = SHC.compCatRegistra(v.porItem[id], k, SHC.hoje()); v.ts = Date.now(); });
const COMPCAT_VALIDO_MS = 864e5;   // anúncio perdendo no catálogo: a tela é relida 1 vez por dia (linha do tempo do winRate)
const perdeCatalogo = it => !!it && /^(perdendo|restrito|dividindo)$/.test(String(it.competicao || ''));
const guardaVisitas = (conta, id, lida) => mudaChave('visitas:' + conta, v => { v.porItem = v.porItem || {}; v.porItem[id] = SHC.visitasJunta(v.porItem[id], lida, SHC.hoje()); v.ts = Date.now(); });
const vencido = (e, ms) => !e || !(Date.now() - (e.ts || 0) < ms);
const FOTOS_RECUO_MS = 864e5;
const emRecuo = e => !!(e && e.falhaTs) && Date.now() - e.falhaTs < Math.min(FOTOS_VALIDO_MS, FOTOS_RECUO_MS * 2 ** Math.min(3, Math.max(0, (e.falhas || 1) - 1)));
const fotosVencidas = e => vencido(e, FOTOS_VALIDO_MS) && !emRecuo(e);
// Medidas: quem vendeu nos últimos 3 dias (é depois do despacho que o ML costuma mudar a medida) → todo dia; os demais → a cada 7 dias.
const MEDIDAS_RECENTE_MS = 864e5, MEDIDAS_VALIDO_MS = 7 * 864e5;
const medidasVencidas = (e, recente) => vencido(e && e.atual, recente ? MEDIDAS_RECENTE_MS : MEDIDAS_VALIDO_MS) && !emRecuo(e);
const temFotos = e => !!e && typeof e.qtd === 'number';
const semCategoria = e => !(e && e.familia) && !emRecuo(e);   // v2.6: ainda sem categoria lida (e fora do recuo de quem falhou)

// Um anúncio: fotos e medidas (se pode e se uma delas venceu: a MESMA leitura traz as duas) e visitas (se venceu). forcar = lê tudo agora.
// med = { ant (medidas:<conta>.porItem[MLB]), sku, recente (vendeu nos últimos 3 dias), semCat (v2.6: ainda sem categoria lida),
// soCategoria (v2.6: anúncio fora dos ativos que vendeu nos 13 meses: só a categoria, sem fotos/medidas/visitas) }.
// → { login?, erros } (medida ausente não conta como erro). A categoria vem da MESMA leitura (nenhum GET a mais quando a tela já seria lida).
async function lerSaudeItem(conta, id, perm, fotosAnt, visAnt, forcar, med) {
    let erros = 0;
    const md = med || {}, so = !!md.soCategoria, querFotos = !so && (forcar || fotosVencidas(fotosAnt)), querMed = !so && (forcar || medidasVencidas(md.ant, md.recente));
    const querCat = so || !!md.semCat, querComp = !so && !!md.comp;
    if (perm && (querFotos || querMed || querCat || querComp)) {
        const t = await lerTelaAnuncio(id);
        if (t.falha === 'login') return { login: true, erros };
        if (t.k && !so) await guardaCompCat(conta, id, t.k); else if (querComp && !t.falha) await falhaEm('catcomp:' + conta, id);   // sem o brick: recuo de 24 h que dobra
        if (t.f) { if (!so) await guardaFotos(conta, id, t.f); } else if (querFotos) { erros++; await falhaFotos(conta, id); }
        if (t.m) { if (!so) await guardaMedidas(conta, id, md.sku, t.m); } else if (querMed) await falhaEm('medidas:' + conta, id);
        if (t.c) await guardaCategoria(conta, id, t.c); else if (querCat && !t.falha) await falhaEm('cat:' + conta, id);
    }
    if (!so && (forcar || vencido(visAnt, VISITAS_VALIDO_MS))) {
        const b = await buscarJson(SHC.visitasLink(id));
        if (b && b.login) return { login: true, erros };
        const lida = b && b.json ? SHC.mlVisitasDoEstado(b.json) : null;
        if (lida) await guardaVisitas(conta, id, lida); else erros++;
    }
    return { erros };
}
let saudeEmCurso = null;
async function rodadaSaude(conta) {
    if (saudeEmCurso) return saudeEmCurso;
    saudeEmCurso = (async () => {
        const [an, fs, vs, ms, perm, cs, va, kc] = await Promise.all([SHC.lerAnuncios(conta), SHC.lerChave('fotos:' + conta), SHC.lerChave('visitas:' + conta),
            SHC.lerChave('medidas:' + conta), temPermissaoWww(), SHC.lerChave('cat:' + conta), SHC.lerChave('vbAnuncio:' + conta), SHC.lerChave('catcomp:' + conta)]);
        const pf = (fs && fs.porItem) || {}, pv = (vs && vs.porItem) || {}, pm = (ms && ms.porItem) || {}, pc = (cs && cs.porItem) || {}, pk = (kc && kc.porItem) || {}, sku = {}, comp = {};
        ((an && an.itens) || []).filter(SHC.anuncioAtivo).forEach(i => { if (!(i.itemId in sku)) sku[i.itemId] = i.sku || ''; if (perdeCatalogo(i) && vencido(pk[i.itemId], COMPCAT_VALIDO_MS) && !emRecuo(pk[i.itemId])) comp[i.itemId] = true; });
        const ativos = Object.keys(sku);
        const [vm, vd, vu] = ativos.length ? await Promise.all([SHC.lerVendasMes(ativos), SHC.lerVendas(ativos), SHC.lerUltimaVenda()]) : [{}, {}, {}];
        const vendas = id => Object.keys(vm[id] || {}).reduce((s, m) => s + (+vm[id][m] || 0), 0);
        // Vendeu nos últimos 3 dias (Faturamento: cobrança de venda em vu|ml, ou de frete em vd|ml): passa na frente e tem as medidas relidas todo dia.
        const desde3 = diaMenos(SHC.hoje(), 3), recente = {};
        ativos.forEach(id => { recente[id] = vu[id] >= desde3 || Object.keys(vd[id] || {}).some(o => vd[id][o] && vd[id][o].d >= desde3); });
        // v2.6: faturamento de cada anúncio nos 13 meses (vbAnuncio) → desempata a fila e acha quem vendeu mas não está ativo (esses: só a categoria).
        const fatVA = {};
        Object.values((va && va.meses) || {}).forEach(x => Object.keys((x && x.porAnuncio) || {}).forEach(id => { fatVA[id] = (fatVA[id] || 0) + (+(x.porAnuncio[id] || {}).bruto || 0); }));
        const extras = perm ? Object.keys(fatVA).filter(id => !(id in sku) && fatVA[id] > 0 && semCategoria(pc[id])).sort((a, b) => fatVA[b] - fatVA[a]) : [];
        const soCat = new Set(extras);
        const alvo = ativos.map((id, k) => ({ id, k, v: vendas(id), f: fatVA[id] || 0, r: recente[id] ? 1 : 0 })).sort((a, b) => b.r - a.r || b.v - a.v || b.f - a.f || a.k - b.k).map(x => x.id)
            .filter(id => (perm && (fotosVencidas(pf[id]) || medidasVencidas(pm[id], recente[id]) || semCategoria(pc[id]) || comp[id])) || vencido(pv[id], VISITAS_VALIDO_MS))
            .concat(extras).slice(0, SAUDE_MAX);
        let feito = 0, erros = 0, login = false;
        try {
            if (alvo.length) await andamento('saudeProgresso', { feito: 0, de: alvo.length, ts: Date.now() });
            for (const id of alvo) {
                if (feito) await espera(SAUDE_PAUSA_MS);
                const r = soCat.has(id) ? await lerSaudeItem(conta, id, perm, null, null, false, { soCategoria: true })
                    : await lerSaudeItem(conta, id, perm, pf[id], pv[id], false, { ant: pm[id], sku: sku[id], recente: recente[id], semCat: semCategoria(pc[id]), comp: comp[id] });
                erros += r.erros;
                if (r.login) { login = true; break; }   // sessão caiu: para e tenta na próxima rodada
                feito++;
                await andamento('saudeProgresso', { feito, de: alvo.length, ts: Date.now() });
            }
        } finally { await andamento('saudeProgresso', null).catch(() => {}); }
        // v2.7: detalhe das remessas do Full (abertas + últimos 90 dias, 1 vez por fechada), no mesmo ritmo lento. Falha não derruba a rodada.
        if (!login) try { await lerDetalhesRemessas(conta); } catch (e) { /* o painel mostra "detalhe ainda não lido" pela falta em remessas:<conta>:detalhe */ }
        const fim = await mudaChave('fotos:' + conta, v => {
            v.porItem = v.porItem || {};
            Object.assign(v, { ts: Date.now(), lidos: ativos.filter(id => temFotos(v.porItem[id])).length, de: ativos.length, semPermissao: !perm });
        });
        await mudaChave('medidas:' + conta, v => {
            v.porItem = v.porItem || {};
            Object.assign(v, { lidos: ativos.filter(id => v.porItem[id] && v.porItem[id].atual).length, de: ativos.length, semPermissao: !perm });
        });
        if (feito) await atualizarAlertas(conta).catch(() => {});   // visitas novas → o número do ícone ("perdendo visitas") acompanha
        return { lidos: feito, de: alvo.length, erros, login, semPermissao: !perm, fotosLidas: fim.lidos };
    })();
    try { return await saudeEmCurso; } finally { saudeEmCurso = null; }
}
// Um anúncio na hora (painel/etiqueta): lê fotos e visitas agora → { ok, itemId, fotos, visitas, radar, semPermissao } | { ok:false, motivo }
async function saudeAgora(conta, itemId) {
    const perm = await temPermissaoWww(), r = await lerSaudeItem(conta, itemId, perm, null, null, true, { sku: await skuDoAnuncio(conta, itemId) });
    if (r.login) return { ok: false, motivo: 'sem_sessao' };
    const [fs, vs, cfg] = await Promise.all([SHC.lerChave('fotos:' + conta), SHC.lerChave('visitas:' + conta), SHC.lerCfg()]);
    const f0 = ((fs && fs.porItem) || {})[itemId], fotos = temFotos(f0) ? f0 : null, visitas = ((vs && vs.porItem) || {})[itemId] || null;
    if (r.erros && !fotos && !visitas) return { ok: false, motivo: 'ml_indisponivel', semPermissao: !perm };
    return { ok: true, itemId, fotos, visitas, radar: SHC.radarVisitas(visitas && visitas.dias, SHC.hoje(), cfg.radar_queda_pct), semPermissao: !perm };
}

const skuDoAnuncio = async (conta, itemId) => ((((await SHC.lerAnuncios(conta)) || {}).itens || []).find(i => i && i.itemId === itemId) || {}).sku || '';
// v2.5.2: "Conferir agora" — relê as medidas de 1 anúncio (o mesmo GET da tela "Alterar anúncio"; as fotos lidas nele também ficam).
// → { ok:true, itemId, medidas (medidas:<conta>.porItem[MLB]), mudou, mudanca | null } | { ok:false, motivo:'semPermissao'|'sem_sessao'|'ml_indisponivel' }
async function medidasAgora(conta, itemId) {
    if (!(await temPermissaoWww())) return { ok: false, motivo: 'semPermissao' };
    const sku = await skuDoAnuncio(conta, itemId), t = await lerTelaAnuncio(itemId);
    if (t.falha === 'login') return { ok: false, motivo: 'sem_sessao' };
    if (t.f) await guardaFotos(conta, itemId, t.f);
    if (t.c) await guardaCategoria(conta, itemId, t.c);
    if (t.k) await guardaCompCat(conta, itemId, t.k);
    if (!t.m) { await falhaEm('medidas:' + conta, itemId); return { ok: false, motivo: 'ml_indisponivel' }; }
    const res = await guardaMedidas(conta, itemId, sku, t.m);
    return { ok: true, itemId, medidas: res.entrada, mudou: !!res.mudanca, mudanca: res.mudanca };
}
// v3.1: "Ler a concorrência agora" (aba Catálogo): o mesmo GET da tela "Alterar anúncio" (fotos/medidas/categoria que vierem nele também ficam).
// → { ok:true, itemId, comp (catcomp:<conta>.porItem[MLB]) } | { ok:false, motivo:'semPermissao'|'sem_sessao'|'sem_catalogo'|'ml_indisponivel' }
async function compCatAgora(conta, itemId) {
    if (!(await temPermissaoWww())) return { ok: false, motivo: 'semPermissao' };
    const t = await lerTelaAnuncio(itemId);
    if (t.falha) return { ok: false, motivo: t.falha === 'login' ? 'sem_sessao' : 'ml_indisponivel' };
    if (t.f) await guardaFotos(conta, itemId, t.f);
    if (t.c) await guardaCategoria(conta, itemId, t.c);
    if (!t.k) return { ok: false, motivo: 'sem_catalogo' };
    const v = await guardaCompCat(conta, itemId, t.k);
    return { ok: true, itemId, comp: v.porItem[itemId] };
}
// v2.5.2: marca do seller num anúncio (SHC.medidasMarca): 'alterar' = clicou em "Alterar no ML"; 'fui_eu' = a mudança vista em `em`
// foi dele (sai do aviso e do chamado). Só guarda na extensão; nada vai ao ML. → { ok:true, itemId, medidas } | { ok:false, motivo:'nada' }
async function medidasMarca(conta, itemId, tipo, em) {
    let ent = null;
    await mudaChave('medidas:' + conta, v => {
        v.porItem = v.porItem || {};
        ent = SHC.medidasMarca(v.porItem[itemId], tipo, em, Date.now());
        if (ent) v.porItem[itemId] = ent;
    });
    return ent ? { ok: true, itemId, medidas: ent } : { ok: false, motivo: 'nada' };
}

// ── v2.5: robô de fotos. Liga por conta (cfg.robo_ligado) E por anúncio (cfg.robo_itens[MLB]); nunca mexe na capa. Decide com SHC.roboDecide
// (radar de visitas caindo, sem foto marcada pelo ML, ≥ 3 fotos, intervalo e limite por dia). Grava a ordem (PUT event-request, M5) só com
// SHC.ROBO_ESCRITA_CONFERIDA === true E cfg.robo_modo === 'automatico'; senão só gera sugestões.
// robo:<conta> = { historico:[{ts, itemId, antes, depois, motivo, visitas7Antes, resultado:'ok'|'incerto'|'falhou'|'abortado'|'manual', pedido? (incerto), erro?, desfazer?}] (máx. 500),
//   sugestoes:[{itemId, motivo, novaOrdem, ts, antes, visitas7Antes}], registro:[sugestões guardadas, SHC.roboRegistroJunta], ultimaPassada:'AAAA-MM-DD' }.
//   O JWT da tela nunca é guardado. 'manual' com detectado:true = sugestão vista aplicada na leitura das fotos (SHC.roboSugestaoVista).
const ROBO_ALARME_MIN = 180, ROBO_PAUSA_MS = 5000, ROBO_HIST_MAX = 500;
const roboRegistra = (conta, e) => mudaChave('robo:' + conta, v => { v.historico = (v.historico || []).concat([e]).slice(-ROBO_HIST_MAX); });
const roboMaxDia = cfg => { const n = SHC.num(cfg.robo_max_dia); return n !== null && n >= 0 ? n : 5; };
// extra: { esperado: ordem que a decisão viu (a tela tem que estar igual), visitas7Antes, desfazer }
// Desfazer é pedido do seller: não passa pelas travas do robô ligado/modo/limite do dia (vale mesmo depois de ele desligar o robô);
// continua exigindo a constante, a permissão, a tela igual ao esperado e a mesma capa.
async function roboExecuta(conta, itemId, novaOrdem, motivo, extra) {
    const x = extra || {}, cfg = await SHC.lerCfg();
    if (SHC.ROBO_ESCRITA_CONFERIDA !== true) return { ok: false, resultado: 'desligado' };
    if (!x.desfazer && !(cfg.robo_modo === 'automatico' && cfg.robo_ligado && (cfg.robo_itens || {})[itemId])) return { ok: false, resultado: 'desligado' };
    if (!(await temPermissaoWww())) return { ok: false, resultado: 'semPermissao' };
    if (!x.desfazer && SHC.roboFeitasHoje(((await SHC.lerChave('robo:' + conta)) || {}).historico) >= roboMaxDia(cfg)) return { ok: false, resultado: 'limite' };
    let antes = (x.esperado || []).slice();
    // depois = a ordem lida no ML (ou a pedida, se não deu para ler); incerto guarda também a pedida.
    const reg = async (resultado, erro, lida) => {
        const e = Object.assign({ ts: Date.now(), itemId, antes, depois: (lida || novaOrdem).slice(), motivo, visitas7Antes: typeof x.visitas7Antes === 'number' ? x.visitas7Antes : null, resultado },
            resultado === 'incerto' ? { pedido: novaOrdem.slice() } : {}, erro ? { erro } : {}, x.desfazer ? { desfazer: true } : {});
        await roboRegistra(conta, e);
        return Object.assign({ ok: resultado === 'ok' }, e);
    };
    const a = await lerFotosAnuncio(itemId);   // sessão e JWT novos, logo antes de gravar
    if (!a.f) return reg('falhou', 'Não consegui abrir as fotos do anúncio no Mercado Livre.');
    antes = a.f.ids.slice();
    if (x.esperado && antes.join('|') !== x.esperado.join('|')) return reg('abortado', 'As fotos mudaram desde a última leitura. O robô não mexeu.');
    if (!SHC.roboOrdemValida(antes, novaOrdem)) return reg('abortado', 'A nova ordem mexeria na capa ou nas fotos. O robô não mexeu.');
    if (!x.desfazer && a.f.problemas > 0) return reg('abortado', 'O Mercado Livre marcou fotos deste anúncio. Corrija as fotos marcadas primeiro.');
    if (!a.jwt || !a.csrf || !a.f.ev) return reg('falhou', 'A tela de fotos do Mercado Livre mudou. O robô não mexeu.');
    const porId = new Map(a.f.brutas.map(b => [b.id, b]));
    let resp = null;
    try {
        resp = await fetch(SHC.ROBO_URL, comTempo({ method: 'PUT', credentials: 'include', cache: 'no-store',
            headers: { 'content-type': 'application/json', accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'x-csrf-token': a.csrf },
            body: JSON.stringify(SHC.roboCorpo(a.f.ev, a.jwt, novaOrdem.map(id => porId.get(id)))) }));
    } catch (e) { resp = null; }   // rede/tempo: o PUT pode ter chegado ao ML → confere relendo (abaixo)
    if (resp && (!resp.ok || ehLogin(resp.url))) return reg('falhou', 'O Mercado Livre não aceitou a troca.');
    await espera(PAUSA_MS);
    const b = await lerFotosAnuncio(itemId);   // confere o que ficou gravado
    if (b.f) await guardaFotos(conta, itemId, b.f);
    // O PUT saiu mas a releitura não confirmou (o ML demora a mostrar, a releitura caiu ou gravou outra ordem): conta como troca feita
    // (limite do dia e intervalo), com a ordem realmente lida, e pode ser desfeita.
    if (!b.f || b.f.ids.join('|') !== novaOrdem.join('|')) return reg('incerto', 'Não deu para confirmar a troca. Confira as fotos no Mercado Livre.', b.f && b.f.ids);
    return reg('ok');
}
// Volta à ordem de antes da última troca do robô neste anúncio (mesmo caminho e travas de roboExecuta; sem o gatilho do radar).
async function roboDesfazer(conta, itemId) {
    const hist = (((await SHC.lerChave('robo:' + conta)) || {}).historico || []).filter(h => h && h.itemId === itemId && (SHC.roboGravou(h) || h.resultado === 'manual'));
    const ult = hist[hist.length - 1];
    if (!ult || !SHC.roboGravou(ult) || ult.desfazer) return { ok: false, resultado: 'nada', erro: 'Não há troca do robô para desfazer neste anúncio.' };
    // Incerto: a ordem atual é a última lida (fotos:<conta>), se ela for uma das que o robô conhece; senão a lida logo depois da troca.
    let esperado = ult.depois;
    if (ult.resultado === 'incerto') {
        const lida = ((((await SHC.lerChave('fotos:' + conta)) || {}).porItem || {})[itemId] || {}).ids;
        if (Array.isArray(lida) && SHC.roboOrdensDa(ult).indexOf(lida.join('|')) >= 0) esperado = lida;
    }
    if ((esperado || []).join('|') === (ult.antes || []).join('|')) return { ok: false, resultado: 'nada', erro: 'As fotos já estão na ordem de antes.' };
    return roboExecuta(conta, itemId, ult.antes, 'Troca desfeita a seu pedido.', { esperado, desfazer: true });
}
// Uma passada (alarme: no máximo 1 por dia; manual = botão "Rodar agora"). → { ok, sugestoes, feitos, semFotos (ligados e ativos ainda sem as fotos lidas), desligado?, jaRodouHoje? }
let roboEmCurso = null;
async function roboPassada(conta, manual) {
    if (roboEmCurso) return roboEmCurso;
    roboEmCurso = (async () => {
        const cfg = await SHC.lerCfg(), k = 'robo:' + conta, hoje = SHC.hoje();
        if (!cfg.robo_ligado) return { ok: true, desligado: true, sugestoes: 0, feitos: [] };
        if (!manual && ((await SHC.lerChave(k)) || {}).ultimaPassada === hoje) return { ok: true, jaRodouHoje: true, sugestoes: 0, feitos: [] };
        const [an, fs, vs] = await Promise.all([SHC.lerAnuncios(conta), SHC.lerChave('fotos:' + conta), SHC.lerChave('visitas:' + conta)]);
        const itens = ((an && an.itens) || []).filter(i => i && (cfg.robo_itens || {})[i.itemId]), vistos = new Set(), sugestoes = [], feitos = [];
        let semFotos = 0;
        const grava = SHC.ROBO_ESCRITA_CONFERIDA === true && cfg.robo_modo === 'automatico';
        for (const item of itens) {
            if (vistos.has(item.itemId)) continue;
            vistos.add(item.itemId);
            const f = ((fs && fs.porItem) || {})[item.itemId], v = ((vs && vs.porItem) || {})[item.itemId];
            if (SHC.anuncioAtivo(item) && !(f && Array.isArray(f.ids) && f.ids.length)) semFotos++;
            const radar = SHC.radarVisitas(v && v.dias, hoje, cfg.radar_queda_pct);
            // v3.1 registro: a última sugestão deste anúncio já aparece aplicada (ou as fotos mudaram) na leitura das fotos, sem "Já troquei"
            // → vira 'manual' no histórico (o robô espera o intervalo e o efeito é medido). Só grava no robo:<conta> do Chrome, nunca no ML.
            const r0 = (await SHC.lerChave(k)) || {}, vista = f ? SHC.roboSugestaoVista(r0.registro, item.itemId, f, r0.historico, Date.now()) : null;
            if (vista) await roboRegistra(conta, vista);
            const d = SHC.roboDecide({ item, fotos: f, radar, cfg, historico: ((await SHC.lerChave(k)) || {}).historico || [], agora: Date.now() });
            if (d.registrar) await roboRegistra(conta, { ts: Date.now(), itemId: item.itemId, antes: d.registrar.antes, depois: d.registrar.depois, motivo: d.motivo, visitas7Antes: radar.ult7, resultado: 'manual' });
            if (d.acao !== 'girar') continue;
            if (!grava) { sugestoes.push({ itemId: item.itemId, motivo: d.motivo, novaOrdem: d.novaOrdem, ts: Date.now(), antes: f.ids.slice(), visitas7Antes: radar.ult7 }); continue; }
            if (feitos.length) await espera(ROBO_PAUSA_MS);
            feitos.push(await roboExecuta(conta, item.itemId, d.novaOrdem, d.motivo, { esperado: f.ids, visitas7Antes: radar.ult7 }));
        }
        await mudaChave(k, r => { r.sugestoes = sugestoes; r.registro = SHC.roboRegistroJunta(r.registro, sugestoes); r.ultimaPassada = hoje; });
        return { ok: true, sugestoes: sugestoes.length, feitos, semFotos };
    })();
    try { return await roboEmCurso; } finally { roboEmCurso = null; }
}
Object.assign(SHC, { roboExecuta, roboDesfazer, roboPassada, rodadaSaude });   // para os testes

