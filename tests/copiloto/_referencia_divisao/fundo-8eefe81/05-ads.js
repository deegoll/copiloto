// ── v2.4: Mercado Ads (API pa.mercadolivre.com.br, sessão do Chrome), mapeado ao vivo em 24/09/2026 (AMB MOVE) ──
// Campanhas (30 dias + os 30 anteriores), desempenho ao competir por impressões de cada campanha, anúncios patrocinados (todas
// as páginas, 50 por vez) e totais por dia. Só LÊ: nada de criar/alterar campanha, orçamento ou lance.
// Falhou → o retrato anterior fica e o status ganha erroAds. Nenhuma campanha → {temAds:false}.
const PA = 'https://pa.mercadolivre.com.br/pa/api/admin-pads/ajax';
const ADS_LIMITE = 50, ADS_PAGINAS_MAX = 60, ADS_PASSADAS = 3;   // até 3.000 anúncios patrocinados; a lista é relida até 3 vezes (ordem instável)
const diaMenos = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') - n * 864e5).toISOString().slice(0, 10);
const periodo = (de, ate) => 'dateFrom=' + de + '&dateTo=' + ate;
// Pedido do Ads dentro do ciclo (naCiclo): a resposta boa fica guardada e a retomada depois de uma queda não pede de novo.
// reduz(json) = o que guardar (a lista de anúncios guarda só o que o Copiloto usa). null/login/erro nunca ficam guardados.
// passada (anúncios patrocinados): 2ª e 3ª leitura da mesma URL não podem voltar a resposta guardada da 1ª.
const adsNoCiclo = (url, reduz, passada) => naCiclo('ads', (passada ? 'p' + passada + ':' : '') + url.replace(PA, ''), async () => {
    const b = await buscarJsonPA(url);
    return b && b.json ? { json: reduz ? reduz(b.json) : b.json } : b;
});
// v3.1 (29/09/2026, mapeado ao vivo): o ML passou a desviar (302 → ads.mercadolivre.com.br/accounts) as chamadas ao pa.* que não
// vêm de uma página do ML. Seguir o desvio vira erro de CORS em chrome://extensions → o fundo pede SEM seguir (redirect:'manual');
// desviou (ou 401/403, ou 200 que não é JSON) → a MESMA chamada pela aba aberta do painel (copiloto-ml.js, 'ler_json_pa').
// → { json } | { login: true } | { falha: 'sem_aba' } (nenhuma aba do painel respondeu) | null (ML fora/erro).
let paPelaAba = false;   // desviou uma vez nesta leitura: as próximas chamadas já vão direto pela aba
async function buscarJsonPA(url) {
    if (!paPelaAba) {
        let r;
        try { r = await fetch(url, comTempo({ credentials: 'include', cache: 'no-store', redirect: 'manual', headers: { accept: 'application/json' } })); } catch (e) { return null; }
        if (ehLogin(r.url)) return { login: true };
        const desvio = r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400) || r.status === 401 || r.status === 403;
        if (!desvio && !r.ok) return null;   // 429/500…: o ML não respondeu (o que havia fica)
        if (!desvio) { try { return { json: await r.json() }; } catch (e) { /* HTML no lugar de JSON: tela do desvio → tenta pela aba */ } }
        paPelaAba = true;
    }
    let a = await lerPaginaPorAba('ler_json_pa', url);
    if (a && a.desvio && !a.dados) {
        // A aba nunca diz "login" no 'ler_json_pa' (só desvio): sem sessão do ML o pa.* também desvia. Prova a sessão ANTES de
        // culpar a conta de anúncios (não abre /accounts nem gasta a janela de 6 h) → "Entre no Mercado Livre".
        const s = await buscarHtml(BASE + '/anuncios');
        if (s && s.login) return { login: true };
        if (await liberarContaAds()) a = await lerPaginaPorAba('ler_json_pa', url);
    }
    if (a && a.dados) return { json: a.dados };
    if (!a) return { falha: 'sem_aba' };
    if (a.login) return { login: true };
    return a.desvio ? { falha: adsLiberou ? 'ads_escolher_conta' : 'ads_sem_conta' } : null;
}
// v3.1 (29/09/2026, ao vivo na conta DIASCOM): desvio TAMBÉM pela aba = a conta de anúncios ainda não foi aberta neste Chrome. Abrir
// ads.mercadolivre.com.br/accounts uma vez (o ML desvia para /hub/summary?advertiserId=N e fixa a conta) libera o pa.*. O Copiloto abre
// essa página numa aba em SEGUNDO PLANO, espera carregar (até 15 s), fecha e tenta de novo pela aba do painel. Não clica em nada nem
// escolhe conta. No máximo 1 vez por leitura e 1 vez a cada 6 h por conta. Continuou desviando depois de abrir → o ML quer que a pessoa
// escolha a conta de anúncios (mais de um anunciante) → 'ads_escolher_conta'. ponytail: sem a permissão "tabs" o endereço final da aba
// não é visível (e não é pedida), então "pede escolha" é deduzido do desvio depois de abrir.
const ADS_CONTAS = 'https://ads.mercadolivre.com.br/accounts', ADS_LIBERA_MS = 6 * 3600e3, ADS_LIBERA_ESPERA_MS = 15000;
let adsConta = '', adsLiberou = null;   // null = não tentou nesta leitura · true = abriu agora · false = não abriu (já abriu nas últimas 6 h)
function abrirEmSegundoPlano(url, ms) {
    return new Promise(resolve => {
        let id = null, fim = false;
        // Carregou (ou 15 s): 1,5 s para a página fixar a conta, fecha a aba. Aba já fechada pela pessoa → o remove falha calado.
        const acaba = () => {
            if (fim) return;
            fim = true;
            chrome.tabs.onUpdated.removeListener(ouve);
            espera(1500).then(() => (id !== null ? chrome.tabs.remove(id) : null)).catch(() => {}).then(() => resolve());
        };
        const ouve = (tid, info) => { if (tid === id && info && info.status === 'complete') acaba(); };
        chrome.tabs.onUpdated.addListener(ouve);
        setTimeout(acaba, ms);
        chrome.tabs.create({ url, active: false }).then(t => { id = t.id; if (fim) chrome.tabs.remove(id).catch(() => {}); }, acaba);
    });
}
async function liberarContaAds() {
    if (adsLiberou !== null) return false;
    adsLiberou = false;
    const k = 'shc:adsLibera:' + adsConta, g = (await chrome.storage.local.get(k))[k];
    if (g && Date.now() - g < ADS_LIBERA_MS) return false;
    await chrome.storage.local.set({ [k]: Date.now() });   // antes de abrir: se o fundo cair no meio, não abre de novo em seguida
    await abrirEmSegundoPlano(ADS_CONTAS, ADS_LIBERA_ESPERA_MS);
    return (adsLiberou = true);
}
const falhaAds = b => (b && b.login ? 'login' : (b && b.falha) || 'indisponivel');
const ADS_SEM_ABA = SHC.ADS_SEM_ABA;   // store.js: as telas reconhecem a etapa pulada por este texto
// v3.2: a lista de campanhas também vem em páginas de 50 e a ordem pode mudar entre as páginas (como a dos anúncios, #24):
// junta por id da campanha e relê a lista (até ADS_PASSADAS) até fechar o total. Não fechou → completo:false (a etapa diz "X de Y").
// Falha na 1ª passada = falha da leitura; numa passada extra fica o que já veio.
async function lerCampanhas(de, ate, progresso) {
    const campanhas = [], vistos = new Set();
    let total = null, fim = false;
    for (let passada = 0; passada < ADS_PASSADAS && !(total !== null && campanhas.length >= total); passada++) {
        for (let n = 0; n < 20; n++) {
            if (n || passada) await espera(PAUSA_MS);
            const b = await adsNoCiclo(PA + '/campaigns/search?' + periodo(de, ate) + '&limit=' + ADS_LIMITE + '&offset=' + (n * ADS_LIMITE) + '&filters[statuses]=A,D', null, passada);
            await bateVivo(progresso);
            if (!b || b.login || !b.json || !Array.isArray(b.json.results)) { if (!passada) return { falha: falhaAds(b) }; break; }
            const r = SHC.adsCampanhas(b.json), novas = r.campanhas.filter(c => !vistos.has(c.id));
            if (r.total !== null) total = r.total;
            novas.forEach(c => { vistos.add(c.id); campanhas.push(c); });
            if (!r.campanhas.length || b.json.results.length < ADS_LIMITE || (total !== null && campanhas.length >= total)) { fim = true; break; }   // F21: sem total, até a página curta
            if (total !== null && (n + 1) * ADS_LIMITE >= total) break;   // fim da lista pelo offset
            if (!novas.length && !passada) break;   // 1ª passada com a página inteira repetida: o ML ignora o offset
        }
        if (total === null) break;   // sem total não há como saber o que falta
    }
    return { campanhas, total, completo: total === null ? fim : campanhas.length >= total };
}
// Sem aba do painel para o plano B: etapa pulada (não é erro vermelho) e o ads:<conta> anterior fica.
const semAba = r => (r.falha === 'sem_aba' ? { pulado: true, semAba: true } : r);
async function sincronizarAds(sellerId, progresso) {
    paPelaAba = false;   // cada leitura tenta o fundo de novo (se o ML parar de desviar, volta sozinho)
    adsConta = sellerId; adsLiberou = null;
    const ate = SHC.hoje(), de = diaMenos(ate, 29), antAte = diaMenos(de, 1), antDe = diaMenos(antAte, 29);
    const atual = await lerCampanhas(de, ate, progresso);
    if (atual.falha) return semAba(atual);
    if (!atual.campanhas.length) {
        const snap = { ts: Date.now(), temAds: false, periodo: { de, ate } };
        await SHC.salvarAds(sellerId, snap);
        return snap;
    }
    const campanhas = atual.campanhas;
    for (const c of campanhas) {   // "Desempenho ao competir por impressões": falha numa campanha não derruba o resto
        await espera(PAUSA_MS);
        const b = await adsNoCiclo(PA + '/campaigns/' + encodeURIComponent(c.id) + '/metrics?' + periodo(de, ate));
        c.share = b && b.json ? SHC.adsShare(b.json) : null;
        await progresso({ adsCampanhas: campanhas.length });   // mantém o service worker acordado com muitas campanhas
    }
    const advertiserId = (campanhas.find(c => c.advertiserId) || {}).advertiserId || '';
    const anuncios = [], vistos = new Set();
    let total = null, fim = false;   // F21: fim = a lista acabou de verdade (página curta ou total alcançado)
    const chave = a => (a.itemId || 'cat:' + a.produtoCatalogoId) + '|' + a.campanhaId;   // catálogo vem sem itemId (id do produto)
    // Ao vivo 01/10/2026 (259 anúncios): a ordem muda entre as páginas (offset) — cada página repete uns 7 da anterior e outros nunca
    // aparecem; uma passada trouxe 236 de 259, três trouxeram 258. Junta por anúncio+campanha e repete a lista (como o Editor em massa)
    // até chegar ao total. Falha numa passada extra: fica o que já veio.
    for (let passada = 0; passada < ADS_PASSADAS && !(total !== null && anuncios.length >= total); passada++) {
        for (let n = 0; n < ADS_PAGINAS_MAX; n++) {
            await espera(PAUSA_MS);
            const b = await adsNoCiclo(PA + '/ads?' + periodo(de, ate) + '&limit=' + ADS_LIMITE + '&offset=' + (n * ADS_LIMITE)
                + (advertiserId ? '&advertiserId=' + encodeURIComponent(advertiserId) : '')
                + '&filters%5Bstatuses%5D=A%2CP%2CI%2CG%2CR%2CC%2CS%2CX%2CY%2CM%2CH%2CZ&comparisonDateFrom=' + antDe + '&comparisonDateTo=' + antAte,
                j => (Array.isArray(j.results) ? { results: { length: j.results.length }, lidos: SHC.adsAnuncios(j) } : j), passada);
            if (!b || b.login || !b.json || !(Array.isArray(b.json.results) || b.json.lidos)) { if (!passada) return semAba({ falha: falhaAds(b) }); break; }
            const r = b.json.lidos || SHC.adsAnuncios(b.json), novos = r.anuncios.filter(a => !vistos.has(chave(a)));
            total = r.total;
            novos.forEach(a => { vistos.add(chave(a)); anuncios.push(a); });
            await progresso({ adsAnuncios: anuncios.length }, { feito: anuncios.length, de: total, unidade: total ? 'anúncios' : null });
            if (b.json.results.length < ADS_LIMITE || (total !== null && anuncios.length >= total)) { fim = true; break; }
            if (total !== null && (n + 1) * ADS_LIMITE >= total) break;   // chegou ao fim da lista pelo offset
            if (!novos.length && !passada) break;   // 1ª passada com a página inteira repetida: o ML ignora o offset (nas outras, repetir é o normal)
        }
        if (total === null) break;   // sem total não há como saber o que falta
    }
    const res = await adsNoCiclo(PA + '/campaigns/metrics?' + periodo(de, ate));
    await bateVivo(progresso);
    const ant = await adsNoCiclo(PA + '/campaigns/metrics?' + periodo(antDe, antAte));
    await bateVivo(progresso);
    const campAnt = await lerCampanhas(antDe, antAte, progresso), porId = {};
    (campAnt.campanhas || []).forEach(c => { porId[c.id] = c.metricas; });
    const resumoAnt = ant && ant.json ? SHC.adsResumo(ant.json) : null;
    const snap = { ts: Date.now(), temAds: true, periodo: { de, ate }, advertiserId, campanhas, totalCampanhas: atual.total, campanhasCompleto: atual.completo, anuncios, totalAnuncios: total,
        completo: total === null ? fim : anuncios.length >= total, resumo: res && res.json ? SHC.adsResumo(res.json) : null,
        anterior: { periodo: { de: antDe, ate: antAte }, campanhas: porId, total: resumoAnt ? resumoAnt.total : null } };
    await SHC.salvarAds(sellerId, snap);
    return snap;
}

