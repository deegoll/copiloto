// SellerHub Copiloto v2.1 — sincronização em segundo plano com a sessão do Mercado Livre que já está no Chrome.
// Lê TODAS as páginas da lista de Anúncios (/anuncios/lista?page=N) e da Central de promoções
// (/anuncios/lista/promos?page=N), com os números que o PRÓPRIO ML calcula (tarifa, frete, "Você recebe").
// Guarda o retrato da conta inteira (ml:anuncios:<conta>) e o histórico do frete de cada anúncio no preço atual.
// v2.2: lê também o Faturamento (cobranças) → frete cobrado em cada venda (vd|ml) e custo de Product Ads por mês (ad|ml).
// v2.3: das mesmas cobranças, vendas por mês (vm|ml); frete sem MLB resolvido pelo título (vd|pend); Full da conta (ml:full:<conta>).
// v2.4: Mercado Ads por anúncio (API pa.mercadolivre.com.br → ads:<conta>), fechamento do mês por tipo de cobrança
// (fech:<conta>:<AAAA-MM>), faturas (fat:<conta>), vendas brutas (vb:<conta>), repasse do Mercado Pago (mp:repasse:<conta>, só com
// a permissão opcional) e alertas no ícone (shc:alertas + chrome.action.setBadgeText). O Ads do Faturamento não vai mais para ad|ml.
// Andamento: shc:status.etapas (12 etapas de SHC.SYNC_ETAPAS desde a v2.5: fila → lendo → ok/erro/pulado, com resumo; ficam depois do fim),
// shc:status.progresso (%, etapa, contagem e tempo que falta; null ao terminar), duracoes e primeiraCompleta.
// v2.4.1: Faturamento um mês por vez, do atual para trás, com 60 s por chamada; mês lento/vazio ou com erro é lido em 15 e 7 dias,
// e o que não responder fica "não lido" (nunca zero). O avanço é gravado por mês. Faturas com notas fiscais (fat:<conta>.notas).
// Não pede senha, não clica em nada, não altera nada na conta: só lê páginas com GET.
// v2.4.2: competição pelo código do ML (badges buybox-*) + histórico comp:<conta>; remessas do Full (ml:full:remessas:<conta>) na etapa
// Estoque Full; concorrentes do catálogo sob demanda ({acao:'concorrentes'}, permissão opcional de www/produto.mercadolivre.com.br).
// v2.4.3: custos do Tiny pelo fundo (mesmo tiny.js do painel, com o token já salvo): depois de cada sincronização e por {acao:'sincronizar_custos'}.
// v2.4.4: vendas brutas mês a mês (13 meses na 1ª leitura, com ?start_period=custom; depois só o atual e o anterior); rateio das faturas por
// mês do calendário (fech:<conta>:rateio); custos do Omie pelo fundo (omie.js) com andamento em shc:status.custosProgresso.
// v2.4.5: etapa Afiliados (afil:<conta>: campanha + métricas por produto de 30 dias; só leitura). Simulador de custos do ML sob demanda
// ({acao:'simulador', itemId} → sim:<conta>:<MLB>): só 1 GET da página. O recálculo da outra opção de frete (POST na calculadora,
// refresh-calculator) fica DESLIGADO (SIM_OUTRA_OPCAO) até a dona aprovar a exceção ao "só GET".
// v2.5: SIM_OUTRA_OPCAO ligado (a dona aprovou: é a calculadora do ML, não grava nada). Etapa 'saude' (avisos da lista + anúncios sem dados
// fiscais → fiscal:<conta>). Rodada lenta de fotos e visitas (alarme 'shc-saude', fora da sincronização → fotos:<conta>, visitas:<conta>,
// andamento em shc:status.saudeProgresso) e robô de fotos (alarme 'shc-robo' → robo:<conta>). A gravação da ordem das fotos só existe com
// SHC.ROBO_ESCRITA_CONFERIDA (false até conferir ao vivo): sem ela, o robô só sugere.
// v2.5.2: monitor de medidas. A MESMA leitura da tela "Alterar anúncio" das fotos (mesmo GET, mesma permissão de www) guarda as medidas da
// embalagem (SHC.mlMedidasDoEstado → medidas:<conta>, com histórico e mudanças). Quem vendeu nos últimos 3 dias é relido todo dia; os demais
// a cada 7 dias. {acao:'medidas_agora', itemId} relê 1 anúncio na hora. Só leitura.
// v2.5.3: etapa 'posvenda' (totais de reclamações/mediações, mensagens e devoluções → posvenda:<conta>); frete por pedido das cobranças
// (frete:<conta>:hist e :pedidos, 30 × 30 dias, formatos e conciliação); pagamento excedente (conferir:<conta>, a MESMA regra do Fechamento);
// certificado digital (cert:<conta>, do Faturador pela aba ou da remessa do Full); TODAS as anomalias no ícone (shc:anomalias); sincronização
// que responde na hora ({ok, iniciou}) e que, interrompida, é retomada 1 vez; "Tentar agora" das vendas brutas nunca recusa; {acao:'fiscal_agora'}.
// v2.6: faturamento por família. Etapa própria 'vendasAnuncio' (13ª, antes dos Alertas: não atrasa nenhuma outra) → vbAnuncio:<conta> (vendas
// por anúncio mês a mês, gross-sales-data com &page_number=N, até 3 pedidos juntos); categoria de cada anúncio na MESMA leitura da tela
// "Alterar anúncio" da rodada lenta → cat:<conta> (sem GET a mais; quem vendeu nos 13 meses e está fora dos ativos entra só pela categoria).
// v2.7: radar leve dentro da etapa Alertas (3 GETs: Resumo → resumo:<conta> + perguntas pendentes; /perguntas/vendedor → perguntas:<conta>;
// /reputacao → reputacao:<conta>); detalhe das remessas do Full na rodada lenta (1 a cada ~3 s, só as abertas e as dos últimos 90 dias, 1 vez por
// fechada → remessas:<conta>:detalhe); anomalias 'perguntas', 'reputacao' e remessa com inconformidade/multa; resumo semanal (alarme 'shc-semanal',
// segunda 8h: só gera o texto e marca "novo" no ícone — nunca envia nada; {acao:'resumo_semanal'}); shc:anomalias:<conta> para as contas juntas.
// O apelido/nome da conta que vem do ML não é mais guardado (o seller dá o apelido em Ajustes: cfg.apelidos).
// v2.8: NF-e das vendas (Faturador e Full) na etapa 'faturas' → nfe:<conta>:<AAAA-MM> (mês atual e anterior). POST de CONSULTA na busca da
// página "Notas fiscais" do ML (só lê); nada do comprador é guardado. Nota rejeitada/com erro vira anomalia fiscal.
// v2.10: retomada de onde parou (shc:ciclo + shc:ret:*): worker que morre no meio continua na hora, sem refazer etapa nem página já lida
// (ver "RETOMADA DE ONDE PAROU" perto de sincronizar()).
// v2.11: sincronização por prioridade (o que as telas usam primeiro: vendas, Fechamento do mês atual e do anterior, Full, Ads, pós-venda,
// famílias; as etapas leves antes das pesadas), mês atual lido só a partir dos dias novos (cob:<conta>:<mês>, nfe incremental), mês fechado
// lido 1 vez e nunca relido inteiro, e os 11 meses antigos (Faturamento, vendas por anúncio, NF-e do mês passado) em SEGUNDO PLANO
// (lerHistorico + alarme 'shc-historico', shc:status.historico = "7 de 12 meses"), sem travar a sincronização.
importScripts('calc.js', 'store.js', 'ml-extrator.js', 'tiny.js', 'omie.js', 'bling.js', 'fechamento.js', 'agenda-canal.js');

const BASE = 'https://vendedores.mercadolivre.com.br';
const PAGINAS_MAX = 40;          // promoções: 25 famílias por página → até 1.000 produtos
const PAGINAS_ANUNCIOS_MAX = 80; // anúncios: 30 linhas por página → até 2.400 linhas
const INTERVALO_MIN = 180;       // sincroniza sozinho a cada 3 horas (Chrome aberto)
const PAUSA_MS = 1200;           // gentileza com o servidor do ML entre páginas

const espera = ms => new Promise(r => setTimeout(r, ms));
// Batida a cada página: grava o andamento (progresso) ou, sem ele, uma chamada barata à API da extensão. Sem chamada chrome.* por
// 30 s o Chrome derruba o service worker no meio da etapa (fetch pendente não conta).
const bateVivo = progresso => (progresso ? progresso({}) : chrome.runtime.getPlatformInfo ? chrome.runtime.getPlatformInfo().catch(() => {}) : null);
// V17: nenhum fetch fica pendurado (Chrome fechado/rede caída não prende a sincronização).
const TEMPO_MS = 25000;
const comTempo = (o, ms) => Object.assign(o, (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? { signal: AbortSignal.timeout(ms || TEMPO_MS) } : {});

function preparar() {
    // Antes da 1ª conta nova: o número antigo. + o "•" do resumo da semana ainda não visto (shc:anomalias é gravado sem ele).
    SHC.lerAnomalias().then(async a => {
        const c = (a && a.conta) || await SHC.contaAtual(), sem = c && c !== 'atual' ? await SHC.lerChave('resumo:' + c + ':semanal') : null;
        const rp = c && c !== 'atual' ? await SHC.lerChave('robopromo:' + c) : null;   // v2.9: sugestão nova do robô de promoções ainda não vista
        const base = a || { total: (((await SHC.lerAlertas()) || {}).criticos) || 0 };
        selo((sem && sem.novo) || (rp && rp.novo) ? Object.assign({}, base, { semanalNovo: !!(sem && sem.novo), promoNovo: !!(rp && rp.novo) }) : (a || base.total));
    }).catch(() => {});
    retomarInterrompida().catch(() => {});
    if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
    chrome.alarms.create('shc-sync', { periodInMinutes: INTERVALO_MIN, delayInMinutes: 1 });
    chrome.alarms.create('shc-saude', { periodInMinutes: SAUDE_ALARME_MIN, delayInMinutes: 10 });
    chrome.alarms.create('shc-robo', { periodInMinutes: ROBO_ALARME_MIN, delayInMinutes: 30 });
    // v3.1: Robô do Canal (roboCanal): confere a cada 6 h e monta no máximo 1 vez por dia, só se a seller ligou na Agenda.
    if (chrome.alarms.get) Promise.resolve(chrome.alarms.get('shc-canal')).then(x => { if (!x) chrome.alarms.create('shc-canal', { delayInMinutes: 20, periodInMinutes: 360 }); }, () => {});
    // v2.7: resumo da semana (só marca "novo"). Recriar a cada abertura trocaria o alarme que ficou para trás (Chrome fechado na segunda 8h)
    // pelo da semana seguinte: só cria se ainda não existe; e a semana perdida é gerada agora (semanalAtrasado).
    const criaSemanal = () => chrome.alarms.create('shc-semanal', { when: proximaSegunda8h(Date.now()), periodInMinutes: 7 * 24 * 60 });
    if (chrome.alarms.get) Promise.resolve(chrome.alarms.get('shc-semanal')).then(x => { if (!x) criaSemanal(); }, criaSemanal); else criaSemanal();
    semanalAtrasado(Date.now()).catch(() => {});
}
// Já passou da segunda 8h desta semana e o resumo guardado é de antes disso (ou não existe) → gera o da semana, como o alarme faria.
async function semanalAtrasado(agora) {
    const c = await SHC.contaAtual();
    if (!c || c === 'atual') return null;
    const s = await SHC.lerChave('resumo:' + c + ':semanal'), ultimaSegunda = proximaSegunda8h(agora) - 7 * 864e5;
    if (s && s.ts >= ultimaSegunda) return null;
    return gerarResumoSemanal(c, 'alarme');
}
// Próxima segunda-feira às 8h (hora local); se hoje é segunda antes das 8h, hoje mesmo.
function proximaSegunda8h(agora) {
    const d = new Date(agora); d.setHours(8, 0, 0, 0);
    let dias = (8 - d.getDay()) % 7;   // 0 = segunda
    if (dias === 0 && d.getTime() <= agora) dias = 7;
    d.setDate(d.getDate() + dias);
    return d.getTime();
}

// v2.4: na atualização, tira o que ficou órfão — ad|ml| (o Ads agora vem por anúncio em ads:<conta>) e o retrato "atual"
// quando a conta já é conhecida.
async function limparVersaoAntiga() {
    const tudo = await chrome.storage.local.get(null), fora = Object.keys(tudo).filter(k => k.indexOf('ad|ml|') === 0);
    if (tudo['ml:conta'] && tudo['ml:conta'] !== 'atual' && tudo['ml:anuncios:atual']) fora.push('ml:anuncios:atual');
    if (fora.length) await chrome.storage.local.remove(fora);
    // v2.7: apelido vindo do ML não fica guardado (o seller dá o dele em Ajustes).
    const contas = tudo['ml:contas'];
    if (contas && Object.keys(contas).some(id => contas[id] && contas[id].apelido !== undefined)) {
        Object.keys(contas).forEach(id => { contas[id] = { visto: (contas[id] || {}).visto || 0 }; });
        await chrome.storage.local.set({ 'ml:contas': contas });
    }
}
chrome.runtime.onInstalled.addListener(d => {
    preparar();
    if (d.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('apresentacao.html') });   // "Conheça o Copiloto"; o "Começar" dela abre painel.html#bem-vindo
    if (d.reason === 'update') limparVersaoAntiga().catch(() => {});
    // v2.5.3: a 1ª sincronização depois de instalar/atualizar lê os dados fiscais logo no começo (não espera as outras etapas)
    // e o frete dos últimos 60 dias já sai do que estava guardado (vd|ml), antes mesmo de sincronizar.
    if (d.reason === 'install' || d.reason === 'update') SHC.gravarChave('shc:fiscalPrimeiro', true).catch(() => {});
    // v3.1: na 1ª vez, a migração do frete de devoluções (refaz o frete por pedido); depois, só o guardado.
    if (d.reason === 'update') SHC.contaAtual().then(async c => { if (c !== 'atual' && !(await migrarFreteDevolucao(c))) await gravarFreteHist(c, null, []); }).then(() => atualizarAlertas()).catch(() => {});
});
chrome.runtime.onStartup.addListener(preparar);
chrome.alarms.onAlarm.addListener(a => {
    if (a.name === 'shc-sync') sincronizar('automatica');
    else if (a.name === 'shc-retoma') sincronizar('retomada');   // 1 vez, depois de uma leitura interrompida (retomarInterrompida)
    else if (a.name === 'shc-orfa') retomarInterrompida().catch(() => {});
    else if (a.name === 'shc-historico') lerHistorico().catch(() => {});   // v2.11: meses antigos em segundo plano (continua de onde parou)
    else if (a.name === 'shc-saude' && !emAndamento && !historicoEm) SHC.contaAtual().then(c => rodadaSaude(c)).catch(() => {});   // não disputa com a sincronização nem com o histórico
    else if (a.name === 'shc-robo') SHC.contaAtual().then(c => roboPassada(c, false)).catch(() => {});
    else if (a.name === 'shc-semanal') SHC.contaAtual().then(c => gerarResumoSemanal(c, 'alarme')).catch(() => {});   // v2.7: só gera e marca "novo"
    else if (a.name === 'shc-canal') roboCanal().catch(() => {});   // v3.1: Robô do Canal (só monta a agenda; criar no ML é o clique da seller)
});

// Página inteira do painel do vendedor, com a sessão do Chrome → { html } | { login: true } (mandou para o login) | null (ML fora/erro).
const ehLogin = u => /login|registration|\/lgz\//i.test(u || '');
async function buscarHtml(url) {
    try {
        const r = await SHC.buscarVendo(url, comTempo({ credentials: 'include', cache: 'no-store' }));   // login sem CORS → url de login
        if (ehLogin(r.url)) return { login: true };
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

// Gravações do retrato da conta uma de cada vez (sincronização e abas não se atropelam).
let filaRetrato = Promise.resolve();
const emFila = fn => (filaRetrato = filaRetrato.then(fn, fn));

// Lista de Anúncios, todas as páginas. progresso() grava o andamento (e mantém o service worker acordado).
async function sincronizarAnuncios(progresso) {
    const itens = [], vistos = new Set();
    let paginas = 0, total = null, conta = null, via = '', completo = true, dePag = null;
    for (let n = 1; ; n++) {
        if (n > PAGINAS_ANUNCIOS_MAX) { completo = false; break; }
        const url = BASE + '/anuncios/lista' + (n > 1 ? '?page=' + n : '');
        const pag = await lerPaginaML(url, 'ler_pagina_anuncios', SHC.mlPaginaAnuncios, n === 1 ? d => !d.itens.length : null);
        if (pag.falha) { if (n === 1) return { falha: pag.falha }; completo = false; break; }
        const d = pag.dados || {}, lidos = Array.isArray(d.itens) ? d.itens : [];
        if (n === 1) { total = typeof d.total === 'number' ? d.total : null; conta = d.conta || null; via = pag.via; dePag = total !== null && lidos.length ? Math.max(1, Math.ceil(total / lidos.length)) : null; }
        // Página do meio sem linha nenhuma e sem total do ML: pode ser tela intermediária → leitura incompleta (só junta, não apaga).
        if (!lidos.length && n > 1 && total === null) completo = false;
        if (!lidos.some(i => i && i.itemId && !vistos.has(i.itemId))) break;   // passou da última página
        lidos.forEach(i => { if (i && i.itemId) vistos.add(i.itemId); });
        itens.push(...lidos);
        paginas = n;
        await progresso({ paginasAnuncios: n, anuncios: vistos.size }, { feito: n, de: dePag, unidade: dePag ? 'páginas' : null });
        await espera(PAUSA_MS);
    }
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
    // Página do meio sem linhas (tela intermediária do ML) não é "fim da lista": leu menos que o ML diz → só junta.
    if (total !== null && vistos.size < total) completo = false;

    const sellerId = conta && conta.sellerId ? conta.sellerId : 'atual';
    if (conta && conta.sellerId) await SHC.registraConta(conta.sellerId, conta.apelido);   // v2.8: guarda também o nome da própria conta (nunca o e-mail)
    // Nenhum anúncio lido e o ML não disse "0": pode ser tela mudada. Não apaga o retrato que já existe.
    if (!itens.length && total !== 0) return { sellerId, snap: await SHC.lerAnuncios(sellerId), paginas, total, via, completo: false };
    // Leitura completa substitui o retrato (anúncio excluído some); leitura interrompida só junta.
    const snap = await emFila(async () => {
        const s = SHC.mesclaAnuncios(completo ? null : await SHC.lerAnuncios(sellerId), itens, { paginas, total, completo });
        await SHC.salvarAnuncios(sellerId, s);
        return s;
    });
    await emFila(() => gravarFretes(itens));   // F4: frete só da lista de Anúncios, no preço atual (na fila das gravações)
    // Histórico da competição (comp:<conta>): um registro por anúncio só quando o estado, o motivo ou o preço muda.
    await emFila(async () => { const k = 'comp:' + sellerId; await SHC.gravarChave(k, SHC.compRegistra(await SHC.lerChave(k), itens, SHC.hoje())); });
    return { sellerId, snap, paginas, total, via, completo };
}

// Central de promoções, todas as páginas. O frete NÃO sai daqui (preços de proposta ≠ preço atual).
// v2.4 (V14): grava em ml:promos:<conta>. 0 famílias: retrato vazio só com a frase do ML ("sem promoções"); senão falha e o anterior fica.
async function sincronizarPromos(conta, progresso) {
    const familias = [], propostas = [];
    let paginas = 0, via = '', vazio = false;
    for (let n = 1; n <= PAGINAS_MAX; n++) {
        const url = BASE + '/anuncios/lista/promos' + (n > 1 ? '?page=' + n : '');
        // Página lida neste ciclo fica guardada (naCiclo): a retomada depois de uma queda não pede de novo.
        const pag = await naCiclo('promos', 'p|' + n, () => lerPaginaML(url, 'ler_pagina_promos', SHC.mlPromosDoEstado, n === 1 ? d => !d.familias.length : null));
        if (pag.falha) { if (n === 1) return { falha: pag.falha }; break; }
        if (n === 1) { via = pag.via; vazio = !!pag.dados.vazio; }
        const novas = pag.dados.familias.filter(f => !familias.some(x => x.chave === f.chave));
        if (!novas.length) break;                         // passou da última página
        familias.push(...novas);
        propostas.push(...pag.dados.propostas.filter(p => novas.some(f => f.chave === p.familia)));
        paginas = n;
        await progresso({ paginas: n });
        await espera(PAUSA_MS);
    }
    if (familias.length) await SHC.salvarPromos(conta, { ts: Date.now(), paginas, familias, propostas });
    else if (vazio) await SHC.salvarPromos(conta, { ts: Date.now(), paginas: 1, familias: [], propostas: [], vazio: true });
    else return { falha: 'indisponivel' };   // 0 famílias sem o sinal do ML: pode ser tela mudada — não apaga o que havia
    return { familias: familias.length, propostas: propostas.length, paginas, via, vazio: !familias.length };
}

// ── v2.2: Faturamento → frete cobrado em CADA venda (vd|ml|MLB) e custo de Product Ads por anúncio/mês (ad|ml|MLB) ──
// JSON de cobranças por período (mapeado ao vivo em 24/09/2026). 12 meses na 1ª vez, depois só os últimos ~40 dias.
const COB_LIMITE = 500;          // máximo por página que o ML aceita
const COB_PAGINAS_MAX = 20;      // por janela de 30 dias → até 10.000 cobranças (todos os tipos, ~3 a 4 por pedido)
const COB_PAGINA_1 = 1;          // "page" começa em 1 (page=0 → HTTP 422): confirmado ao vivo em 25/09/2026
const urlCobrancas = (de, ate, page) => BASE + '/billing/cnc/api/charges-summary/charges-summary-provider/bricks?siteId=MLB&platformId=ML'
    + '&isBackoffice=false&searchText=&searchLimit=' + COB_LIMITE + '&idDate=custom&fromDateCustom=' + de + 'T00:00:00.000Z'
    + '&toDateCustom=' + ate + 'T23:59:59.999Z&page=' + page;

// → { json } | { login: true } | null (ML fora/erro/resposta que não é JSON). tempoMs: limite próprio (Faturamento: 60 s).
async function buscarJson(url, tempoMs) {
    // Chamada longa: uma chamada barata à API da extensão a cada 20 s mantém o service worker acordado enquanto o ML responde.
    const vivo = tempoMs > TEMPO_MS && typeof setInterval === 'function'
        ? setInterval(() => { if (chrome.runtime.getPlatformInfo) chrome.runtime.getPlatformInfo().catch(() => {}); }, 20000) : null;
    try {
        const r = await SHC.buscarVendo(url, comTempo({ credentials: 'include', cache: 'no-store', headers: { accept: 'application/json' } }, tempoMs));
        if (ehLogin(r.url)) return { login: true };
        return r.ok ? { json: await r.json() } : null;
    } catch (e) { return null; } finally { if (vivo) clearInterval(vivo); }
}

// Ao vivo (25/09/2026): uma janela cheia leva até ~31 s, e o ML às vezes desiste e devolve charges.data=[] (dez/25: 30,9 s).
const COB_TEMPO_MS = 60000;      // limite próprio das chamadas do Faturamento
const COB_SUSPEITA_MS = SHC.COB_SUSPEITA_MS;   // vazio depois de mais de 15 s = o ML desistiu, não "sem cobranças"
const COB_PARA_APOS = 4;         // meses seguidos sem resposta, com NENHUM mês lido nesta sincronização: ML fora → para e tenta o resto na próxima
const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mesCurto = m => MES_CURTO[+m.slice(5, 7) - 1] + '/' + m.slice(2, 4);   // '2025-12' → 'dez/25'

// Um período, todas as páginas → { linhas, ids, cortado? } | { falha: 'login'|'sem resposta'|'formato mudou'|'vazio' }.
// v2.5.1: a 1ª página sozinha e depois 3 ao mesmo tempo (SHC.paginasEmParalelo); para na página com menos de 500.
// Nada entra em "vistos" aqui: só quando o mês inteiro deu certo. aoLer(n) = linhas de cada página (andamento).
const COB_PARALELO = 3;
// v2.11: parar() → true = o histórico em segundo plano deve dar a vez à sincronização: a página não é pedida ({ falha: 'parado' }).
async function lerPeriodoCobrancas(de, ate, vistos, aoLer, parar) {
    const r = await SHC.paginasEmParalelo(async p => {
        if (parar && parar()) return { falha: 'parado' };
        // v2.10: página já lida neste ciclo vem do que ficou guardado (naCiclo): a retomada não pede de novo. A pausa de gentileza
        // é ANTES do pedido: a página lida é guardada assim que chega (nenhuma pausa entre chegar e guardar).
        const x = await naCiclo('faturamento', 'cob|' + de + '|' + ate + '|' + p, async () => {
            await espera(PAUSA_MS);
            const t0 = Date.now(), b = await buscarJson(urlCobrancas(de, ate, COB_PAGINA_1 - 1 + p), COB_TEMPO_MS);
            if (!b) return { falha: 'sem resposta' };
            if (b.login) return { falha: 'login' };
            const lidas = SHC.mlCobrancasDaResposta(b.json);
            // Sem charges.data (formato mudado, erro com status 200) ou vazio depois de > 15 s (o ML desistiu): falhou (nunca vira zero).
            if (!lidas.reconhecida) return { falha: 'formato mudou' };
            if (!lidas.brutas && Date.now() - t0 > COB_SUSPEITA_MS) return { falha: 'vazio' };
            return { linhas: lidas.slice(), brutas: lidas.brutas };
        });
        if (x.falha) return x;
        const lidas = x.linhas;
        lidas.brutas = x.brutas;
        if (aoLer) aoLer(lidas.length);
        return lidas;
    }, { limite: COB_LIMITE, max: COB_PAGINAS_MAX, paralelo: COB_PARALELO });
    if (r.falha) return r;
    const linhas = r.linhas.filter(c => !c.id || !vistos.has(c.id)), ids = new Set();
    linhas.forEach(c => { if (c.id) ids.add(c.id); });
    return { linhas, ids, cortado: r.cortado };   // cortado: bateu no máximo de páginas, o mês fica pela metade
}

// Período que falhou é lido em 2 metades (~15 dias) e, se ainda falhar, em pedaços de 7 dias. Um pedaço que não respondeu nem
// assim → { falha } (o mês fica "não lido"; o resto dele nem é lido). peso = fração do mês, para o progresso em meses.
async function lerDividindo(de, ate, vistos, nivel, peso, andou, aoLer, parar) {
    const r = await lerPeriodoCobrancas(de, ate, vistos, aoLer, parar);
    if (!r.falha || r.falha === 'login' || r.falha === 'parado' || nivel >= 2) { await andou(peso); return r; }
    const dias = Math.round((Date.parse(ate + 'T12:00:00Z') - Date.parse(de + 'T12:00:00Z')) / 864e5) + 1, passo = nivel ? 7 : Math.ceil(dias / 2);
    const junto = { linhas: [], ids: new Set(), cortado: false };
    for (let i = 0; i < dias; i += passo) {
        const k = Math.min(passo, dias - i);
        const x = await lerDividindo(diaMenos(de, -i), diaMenos(de, -(i + k - 1)), vistos, nivel + 1, peso * k / dias, andou, aoLer, parar);
        if (x.falha) { await andou(peso * (dias - i - k) / dias); return x; }
        junto.linhas.push(...x.linhas); x.ids.forEach(id => junto.ids.add(id)); junto.cortado = junto.cortado || !!x.cortado;
    }
    return junto;
}

/// Um mês por vez, do ATUAL para trás, e grava o avanço a cada mês lido (o service worker pode morrer no meio: a próxima
// sincronização retoma só o que faltou). Mês que não respondeu nem em pedaços fica "não lido": nada dele é gravado (nunca zero)
// e é tentado de novo na próxima. Sem plano B pela aba: o fundo já leva a sessão.
// v2.11: modo 'recentes' (a sincronização): só os meses dos últimos ~40 dias que precisam de leitura — o atual a partir dos dias novos
// (cob:<conta>:<mês>), o anterior só até ser lido FECHADO_GRACA dias depois de fechar. Modo 'historico' (lerHistorico, em segundo plano):
// os meses mais antigos que ainda não foram lidos, parando quando a sincronização pede a vez (histParar).
const FECHADO_GRACA = 3;   // dias depois do fim do mês: cobrança/venda lançada com atraso ainda entra; depois disso o mês fechado não muda
const COB_INC_DIAS = 2;    // o mês atual é relido a partir de 2 dias antes da última leitura (cobrança lançada com atraso)
const fechadoDesde = m => diaMenos(fimDoMes(m), -FECHADO_GRACA);   // 1º dia em que uma leitura vale como "mês fechado lido"
const chaveCob = (conta, m) => 'cob:' + conta + ':' + m;
async function sincronizarCobrancas(sellerId, progresso, modo) {
    const hist = modo === 'historico';
    if (!hist) {   // v3.1: 1 vez por conta, antes de ler a marca (ela ganha os meses a reler)
        await migrarFreteDevolucao(sellerId).catch(() => {});
        await migrarPorDiaTipo(sellerId).catch(() => {});
    }
    const marca = 'ml:cobrancas:' + sellerId, antes = (await SHC.lerChave(marca)) || {}, hoje = SHC.hoje(), atual = hoje.slice(0, 7), anterior = mesAntes(atual, 1);
    const doze = SHC.janelasCobranca(hoje, true), recentes = new Set(SHC.janelasCobranca(hoje, false).map(j => j.mes));
    // Mês já lido (ou cortado pelo limite de páginas) não é relido, fora os dos últimos ~40 dias.
    // v2.10: na retomada vale a lista de ANTES do ciclo (os meses lidos antes da queda entram de novo, vindos do guardado, sem pedido ao ML):
    // o fechamento, o frete por pedido e o "para conferir" saem iguais aos de uma leitura sem queda.
    const base = ciclo && antes.ciclo && antes.ciclo.id === ciclo.id ? antes.ciclo.feitos : [...(antes.mesesLidos || []), ...(antes.incompletos || [])];
    const feitos = new Set(base), marcaCiclo = ciclo ? { id: ciclo.id, feitos: base } : undefined;
    // v2.11: cobranças guardadas do mês atual e do anterior (leitura a partir dos dias novos; o "para conferir" do mês não relido).
    const lidoEm = Object.assign({}, antes.lidoEm), guard = {};
    for (const m of [atual, anterior]) { const g = await SHC.lerChave(chaveCob(sellerId, m)); if (g && g.ate && Array.isArray(g.linhas)) guard[m] = g; }
    const fechadoLido = m => m < atual && feitos.has(m) && (lidoEm[m] || '') >= fechadoDesde(m) && (m !== anterior || !!guard[m]);
    // v3.1: releer = meses lidos pela versão que somava a tarifa de devolução ao frete (migrarFreteDevolucao): lidos de novo 1 vez.
    const releer = new Set((antes.releer || []).filter(m => doze.some(j => j.mes === m)));
    const janelas = doze.filter(j => (hist ? !recentes.has(j.mes) && (!feitos.has(j.mes) || releer.has(j.mes)) : recentes.has(j.mes) && (!fechadoLido(j.mes) || releer.has(j.mes))));
    // mesesLidos (v2.3): meses lidos do dia 1º ao fim (o atual até hoje) → no vm|ml, mês lido sem a chave = 0 vendas.
    const lidos = new Set(antes.mesesLidos || []), cortados = new Set((antes.incompletos || []).filter(m => !janelas.some(j => j.mes === m)));
    const cobs = [], todas = [], vistos = new Set(), naoLidos = [], lidosAgora = [];   // todas: TODOS os tipos, para o fechamento do mês
    // v2.3: frete/venda sem permalink → MLB pelo título no retrato de anúncios; o frete que não casar fica em vd|pend
    // (junto com os pendentes de antes que não foram relidos agora) para a próxima sincronização.
    const antigos = await SHC.lerPendentes(sellerId), itensAn = ((await SHC.lerAnuncios(sellerId)) || {}).itens;
    let feito = 0, lidasTotal = 0, noMes = 0, seguidas = 0, algum = hist && antes.ate === hoje, res = null, vm = {}, pedidos = 0, parado = false;   // histórico: o ML respondeu hoje na sincronização
    // Andamento: "Lendo agosto (3 de 13 meses) · 6.722 cobranças · falta cerca de N min" (SHC.etapaDaPagina); o tempo sai do ritmo desta leitura.
    const inicio = Date.now();
    // O mês do andamento sai de `feito` (meses em ordem): mês acabado nunca aparece como "Lendo agosto (3 de 13)".
    const conta = () => ({ feito: Math.floor(feito + 1e-9), de: janelas.length, unidade: 'meses', cobrancas: lidasTotal + noMes,
        mesAgora: (janelas[Math.min(Math.floor(feito + 1e-9), janelas.length - 1)] || {}).mes || null,
        restanteSeg: SHC.estimaMeses(inicio, feito, janelas.length, Date.now()) });
    const andou = async peso => { feito += peso; await progresso({ cobrancasLidas: lidasTotal }, conta()); };
    const aoLer = n => { noMes += n; progresso({}, conta()).catch(() => {}); };
    const diag = (m, d) => progresso({}, Object.assign(conta(), { meses: { [m]: d } }));
    await progresso({}, conta());
    for (let k = 0; k < janelas.length; k++) {
        const j = janelas[k];
        noMes = 0;
        if (hist && histParar) { parado = true; break; }
        // Só desiste quando nada respondeu: mês atual e anterior sempre lentos (conta grande) não impedem a leitura dos mais antigos.
        if (seguidas >= COB_PARA_APOS && !algum) { naoLidos.push(j.mes); await diag(j.mes, 'sem resposta'); await andou(1); continue; }
        await progresso({}, conta());
        // v2.11: mês com as cobranças guardadas de uma leitura inteira → só a partir dos dias novos (2 dias antes da última leitura).
        const g = guard[j.mes], de = g && g.ate >= j.de ? [j.de, diaMenos(g.ate, COB_INC_DIAS)].sort()[1] : j.de;
        const r = await lerDividindo(de, j.ate, vistos, 0, 1, andou, aoLer, hist ? () => histParar : null);
        noMes = 0;
        if (r.falha === 'parado') { parado = true; break; }   // histórico parou para a sincronização: o mês fica para a próxima vez
        await diag(j.mes, r.falha ? (r.falha === 'indisponivel' ? 'sem resposta' : r.falha) : r.cortado ? 'cortado' : 'ok');
        if (r.falha === 'login') return { falha: 'login' };
        if (r.falha) { naoLidos.push(j.mes); seguidas++; continue; }   // o que já estava guardado desse mês fica
        if (de > j.de) {   // junta com as guardadas de antes de `de` (a lida agora vale por cima: mesmo id)
            const velhas = g.linhas.filter(c => String(c.data || '') < de && !(c.id && (r.ids.has(c.id) || vistos.has(c.id))));
            velhas.forEach(c => { if (c.id) r.ids.add(c.id); });
            r.linhas = velhas.concat(r.linhas);
        }
        seguidas = 0; algum = true;
        r.ids.forEach(id => vistos.add(id));
        lidasTotal += r.linhas.length;
        todas.push(...r.linhas);
        cobs.push(...r.linhas.filter(c => /^(frete|ads|venda)/.test(c.tipo)));   // as outras cobranças não são usadas
        // Bateu no máximo de páginas: o mês ficou pela metade → fech e vm dele não são regravados (ficariam menores).
        if (r.cortado) cortados.add(j.mes); else { cortados.delete(j.mes); lidos.add(j.mes); lidosAgora.push(j.mes); lidoEm[j.mes] = hoje; }
        releer.delete(j.mes);
        if (!r.cortado && (j.mes === atual || j.mes === anterior)) {
            guard[j.mes] = { ate: j.ate, linhas: r.linhas };
            await SHC.gravarChave(chaveCob(sellerId, j.mes), { ts: Date.now(), ate: j.ate, linhas: r.linhas });
        }
        // Recalcula com TUDO o que foi lido nesta sincronização (cobrança e estorno do mesmo pedido podem cair em meses diferentes).
        // v2.4 (V8): o Ads do Faturamento vem por dia e para a conta toda (sem anúncio) → vai só para o fechamento do mês (porTipo.ads).
        res = SHC.resolveCobrancasPorTitulo(cobs.concat(antigos.filter(c => !c.id || !vistos.has(c.id))), itensAn);
        const { vendas } = SHC.vendasEAdsDasCobrancas(res.cobs);
        // vm|ml e fech trocam o mês inteiro: só mês lido do dia 1º ao fim nesta leitura (cobrança de antes do início por borda de
        // fuso, ou de mês cortado, não substitui o total guardado).
        vm = SHC.vendasPorMes(res.cobs);
        Object.keys(vm).forEach(id => {
            Object.keys(vm[id]).forEach(m => { if (lidosAgora.indexOf(m) < 0) delete vm[id][m]; });
            if (!Object.keys(vm[id]).length) delete vm[id];
        });
        // ponytail: regrava vd|ml de todos os pedidos lidos até aqui a cada mês (até ~13×); filtrar pelos pedidos do mês se pesar.
        await SHC.registraVendas(vendas);
        await SHC.registraVendasMes(vm);
        await SHC.registraUltimaVenda(SHC.ultimaVendaDasCobrancas(res.cobs));   // v2.5.2: quem vendeu nos últimos 3 dias (com ou sem frete cobrado)
        // B5: o Ads do último dia do mês é cobrado no dia 1º do seguinte. Mês fechado lido sem o seguinte nesta sincronização
        // (retentativa de um mês antigo) → lê só o dia 1º do seguinte e fica com o Ads cujas visitas são deste mês.
        // ponytail: se esse dia não responder, o mês fica sem o Ads do último dia (como antes); 1 pedido a mais por mês relido sozinho.
        // v2.11: o dia 1º que já está nas cobranças guardadas do mês seguinte não é pedido de novo.
        const prox = mesAntes(j.mes, -1);
        if (!r.cortado && j.mes < atual && lidosAgora.indexOf(prox) < 0) {
            const px = guard[prox] ? { linhas: guard[prox].linhas.filter(c => String(c.data || '') === prox + '-01') }
                : await lerPeriodoCobrancas(prox + '-01', prox + '-01', vistos, null, null);   // sem `parar`: 1 GET pequeno; parar aqui gravava o mês sem o Ads do último dia
            if (!px.falha) todas.push(...px.linhas.filter(c => c.tipo === 'ads' && String(c.dataRef || '').slice(0, 7) === j.mes));
        }
        if (!r.cortado) await gravarFechamento(sellerId, todas, [j.mes]);
        await SHC.salvarPendentes(sellerId, res.pendentes);
        Object.keys(lidoEm).forEach(m => { if (!doze.some(x => x.mes === m)) delete lidoEm[m]; });
        await SHC.gravarChave(marca, { completo12: doze.every(x => lidos.has(x.mes) || cortados.has(x.mes)), ate: hoje, ts: Date.now(),
            incompletos: [...cortados].sort(), mesesLidos: [...lidos].sort().slice(-13), lidoEm, ciclo: marcaCiclo, releer: [...releer].sort() });
        pedidos =Object.keys(vendas).reduce((n, id) => n + Object.keys(vendas[id]).filter(o => vendas[id][o]).length, 0);
    }
    // v2.5.3: frete por pedido (30 × 30 dias, formatos, conciliação) e pagamento excedente, com o lido agora + o que já estava guardado.
    // Derivados: se falharem, a etapa continua valendo. v2.11: o "para conferir" do mês que não foi relido sai das cobranças guardadas dele;
    // no histórico, só o frete (e só se leu mês dos últimos 62 dias).
    if (!hist || lidosAgora.some(m => m >= diaMenos(hoje, FRETE_DIAS).slice(0, 7))) {
        try { await gravarFreteHist(sellerId, SHC.resolveCobrancasPorTitulo(todas, itensAn).cobs, lidosAgora); } catch (e) { /* o painel mostra o motivo pela falta de frete:<conta>:hist */ }
    }
    if (!hist) {
        const mesesConf = [atual, anterior].filter(m => lidosAgora.indexOf(m) >= 0 || guard[m]);
        const conf = todas.concat(...[atual, anterior].filter(m => lidosAgora.indexOf(m) < 0 && guard[m]).map(m => guard[m].linhas));
        try { await gravarConferir(sellerId, conf, mesesConf, itensAn); } catch (e) { /* idem conferir:<conta> */ }
        // Cobranças guardadas só do mês atual e do anterior.
        try { await chrome.storage.local.remove([chaveCob(sellerId, mesAntes(atual, 2)), chaveCob(sellerId, mesAntes(atual, 3))]); } catch (e) { /* só espaço */ }
    }
    if (janelas.length && naoLidos.length === janelas.length) return { falha: 'indisponivel' };   // nenhum mês respondeu: nada foi gravado
    const semLer = hist ? 0 : doze.filter(j => !recentes.has(j.mes) && !lidos.has(j.mes) && !cortados.has(j.mes)).length;   // ficam para o histórico
    return { meses: janelas.length - naoLidos.length, de: janelas.length, naoLidos, lidas: lidasTotal, pedidos, fechamentoMeses: lidosAgora.slice().sort(),
        incompletos: [...cortados].sort(), anunciosVendas: Object.keys(vm).length, porTitulo: res ? res.resolvidas : 0, pendentes: res ? res.pendentes.length : 0,
        historicoFalta: semLer, parado };
}
// ── v2.5.3: frete por pedido → frete:<conta>:pedidos (62 dias de frete, 31 de vendas) e frete:<conta>:hist (SHC.freteHistorico + SHC.conciliaFrete).
// cobs = cobranças lidas agora (TODOS os tipos) e mesesLidos = meses lidos inteiros agora: eles substituem o que havia desses meses; o resto
// fica do guardado. Pedido que ainda não existe em lugar nenhum mas está no vd|ml (versão anterior) entra com aprox:true (sem o formato).
// cobs null = só o guardado (atualização da extensão: o frete aparece antes da próxima sincronização).
// Vendas também 62 dias: o frete dos 30 dias casa com a venda até 20 dias antes dele (SHC.conciliaFrete, número diferente).
const FRETE_DIAS = 62, VENDAS_DIAS = 62;
async function gravarFreteHist(conta, cobs, mesesLidos) {
    const hoje = SHC.hoje(), limF = diaMenos(hoje, FRETE_DIAS), limV = diaMenos(hoje, VENDAS_DIAS), kP = 'frete:' + conta + ':pedidos';
    const antes = (await SHC.lerChave(kP)) || {}, lidos = new Set(mesesLidos || []);
    const itens = ((await SHC.lerAnuncios(conta)) || {}).itens || [], porItem = {};
    itens.forEach(i => { if (i && i.itemId && !porItem[i.itemId]) porItem[i.itemId] = i; });
    const pedidos = {}, vendas = {}, devs = {}, relido = d => lidos.has(String(d || '').slice(0, 7));
    Object.keys(antes.pedidos || {}).forEach(k => { const p = antes.pedidos[k]; if (p && p.data >= limF && !relido(p.data)) pedidos[k] = p; });
    Object.keys(antes.vendas || {}).forEach(k => { const v = antes.vendas[k]; if (v && v.data >= limV && !relido(v.data)) vendas[k] = v; });
    // v3.1: frete de devoluções por pedido (tarifa de devolução = frete de VOLTA; fora do frete da venda e do "cobrado a mais").
    Object.keys(antes.devolucoes || {}).forEach(k => { const p = antes.devolucoes[k]; if (p && p.data >= limF && !relido(p.data)) devs[k] = p; });
    if (cobs && cobs.length) {
        SHC.freteDasCobrancas(cobs).forEach(p => { if (p.data >= limF) pedidos[p.pedido] = { itemId: p.itemId, data: p.data, cobrado: p.cobrado, bruto: p.cobrado, cheio: p.cheio, formato: p.formato, cancelado: p.cancelado, temExtra: p.temExtra, linhas: p.linhas }; });
        SHC.vendasDasCobrancas(cobs).forEach(v => { if (v.data >= limV) vendas[v.pedido] = { itemId: v.itemId, data: v.data, cancelada: v.cancelada }; });
        SHC.devolucoesDasCobrancas(cobs).forEach(p => { if (p.data >= limF) devs[p.pedido] = { itemId: p.itemId, data: p.data, valor: p.valor, linhas: p.linhas }; });
        // Estorno lido agora de um pedido cobrado num mês que não foi relido: desconta do valor BRUTO guardado, uma vez por estorno
        // (est = {id do estorno: valor}; o mesmo estorno relido a cada 3 h não desconta de novo).
        const comCobranca = new Set(cobs.filter(c => c && /^frete/.test(c.tipo) && c.tipo !== 'frete_estorno').map(c => c.orderId));
        cobs.forEach(c => {
            const p = c && c.tipo === 'frete_estorno' && c.orderId && !comCobranca.has(c.orderId) ? pedidos[c.orderId] : null;
            if (!p || (p.cancelado && !p.est)) return;
            const est = Object.assign({}, p.est), bruto = typeof p.bruto === 'number' ? p.bruto : p.cobrado;
            const kEst = c.id || (c.data + '|' + c.valor), linhas = p.linhas && !(kEst in est) ? p.linhas.concat({ t: c.texto, v: c.valor, d: c.data, e: 1 }) : p.linhas;
            est[kEst] = c.valor;
            const resto = SHC.r2(bruto - Object.keys(est).reduce((t, k) => t + est[k], 0));
            pedidos[c.orderId] = Object.assign({}, p, { bruto, est }, linhas ? { linhas } : {}, resto > 0.004 ? { cobrado: resto, cancelado: false } : { cobrado: 0, cheio: 0, formato: 'cancelado', cancelado: true });
        });
    }
    // Versão anterior: frete por pedido só em vd|ml|<MLB> ({d, f, pc}). Entra o que não está em lugar nenhum (nunca por cima do que foi lido).
    const ids = [...new Set(itens.map(i => i && i.itemId).filter(id => /^MLB\d{6,14}$/.test(String(id || ''))))];
    const vd = ids.length ? await SHC.lerVendas(ids) : {};
    Object.keys(vd).forEach(id => Object.keys(vd[id] || {}).forEach(o => {
        const v = vd[id][o];
        if (!v || !v.d || v.d < limF || pedidos[o] || relido(v.d) || !(v.f >= 0)) return;
        pedidos[o] = { itemId: id, data: v.d, cobrado: v.f, cheio: null, formato: v.pc ? 'compartilhado' : null, cancelado: false, aprox: true };
    }));
    // dev = tarifa de devolução do mesmo pedido: só para mostrar ao lado (nunca soma no frete).
    const arr = Object.keys(pedidos).map(k => Object.assign({ pedido: k }, pedidos[k], devs[k] && devs[k].valor > 0 ? { dev: devs[k].valor } : {})), varr = Object.keys(vendas).map(k => Object.assign({ pedido: k }, vendas[k]));
    await SHC.gravarChave(kP, { ts: Date.now(), pedidos, vendas, devolucoes: devs });
    // Meses dos 60 dias que nunca foram lidos inteiros (não responderam/cortados): sem eles a comparação 30 × 30 não vale (nunca "0 pedidos").
    const marca = (await SHC.lerChave('ml:cobrancas:' + conta)) || {}, jaLidos = new Set(marca.mesesLidos || []), semLeitura = [];
    for (let m = diaMenos(hoje, 59).slice(0, 7); m <= hoje.slice(0, 7); m = mesAntes(m, -1)) if (!jaLidos.has(m)) semLeitura.push(m);
    // Vendas lidas: alguma venda guardada, ou o mês atual lido agora (conta sem venda). Sem isso a conciliação não é calculada (nunca "0 de 0").
    const vendasLidas = varr.length > 0 || (!!cobs && lidos.has(hoje.slice(0, 7)));
    const hist = SHC.freteHistorico(arr, hoje, itens, varr.length ? varr : null);
    if (semLeitura.length) {
        hist.conta.variacaoPct = null;
        Object.keys(hist.porAnuncio).forEach(id => Object.assign(hist.porAnuncio[id], { variacaoPct: null, subiu: false, semLeitura: true }));
    }
    const snap = Object.assign({ ts: Date.now(), fonte: arr.some(p => !p.aprox) ? 'faturamento' : (arr.length ? 'guardado' : 'nada'), aprox: arr.filter(p => p.aprox).length,
        vendasLidas, semLeitura }, hist, { conciliacao: vendasLidas ? SHC.conciliaFrete(arr, porItem, varr, hoje) : null,
        devolucoes: SHC.devolucoesResumo(Object.keys(devs).map(k => Object.assign({ pedido: k }, devs[k])), hoje) });
    await SHC.gravarChave('frete:' + conta + ':hist', snap);
    return snap;
}
// Pagamento excedente: a MESMA regra do Fechamento ("Cobranças para conferir", SHC.fech.conferir) no mês atual e no anterior, quando lidos agora.
async function gravarConferir(conta, cobs, lidosAgora, itens) {
    const atual = SHC.hoje().slice(0, 7), meses = [atual, mesAntes(atual, 1)].filter(m => (lidosAgora || []).indexOf(m) >= 0);
    if (!meses.length || !SHC.fech || !SHC.fech.conferir) return null;
    const porId = {};
    (itens || []).forEach(i => { if (i && i.itemId && !porId[i.itemId]) porId[i.itemId] = i; });
    const lista = SHC.fech.conferir((cobs || []).filter(c => c && meses.indexOf(String(c.data || '').slice(0, 7)) >= 0), porId);
    const snap = { ts: Date.now(), meses, qtd: lista.length, valor: SHC.r2(lista.reduce((s, x) => s + (x.diferenca || 0), 0)), itens: lista.slice(0, 100) };
    await SHC.gravarChave('conferir:' + conta, snap);
    return snap;
}

// ── v3.1: migração ÚNICA por conta (marca em shc:migra:freteDev = {conta: ts}). A versão anterior somava a "Tarifa de devolução por envio…"
// (frete de VOLTA da devolução) ao frete da venda (print da dona: 20,75 + 46,49 = "cobrado 67,24"). O mês atual e o anterior são refeitos
// AGORA a partir das cobranças guardadas (cob:<conta>:<mês>, sem pedido ao ML); os meses mais antigos já lidos vão para `releer` e são lidos
// de novo 1 vez (o histórico em segundo plano; os dos últimos 40 dias, a sincronização). Nada é apagado antes de ter o novo: o frete por
// pedido desses meses só é trocado pelo recalculado, e o vd|ml de um pedido só sai quando nele só havia a tarifa de devolução.
async function migrarFreteDevolucao(conta) {
    const kM = 'shc:migra:freteDev', feitas = (await SHC.lerChave(kM)) || {};
    if (!conta || conta === 'atual' || feitas[conta]) return false;
    const hoje = SHC.hoje(), atual = hoje.slice(0, 7), anterior = mesAntes(atual, 1), linhas = [], meses = [];
    for (const m of [atual, anterior]) {
        const g = await SHC.lerChave(chaveCob(conta, m));
        if (!g || !g.ate || !Array.isArray(g.linhas)) continue;
        const novas = g.linhas.map(SHC.tipoDevolucao);
        if (novas.some((c, i) => c !== g.linhas[i])) await SHC.gravarChave(chaveCob(conta, m), Object.assign({}, g, { linhas: novas }));
        linhas.push(...novas); meses.push(m);
    }
    const itens = ((await SHC.lerAnuncios(conta)) || {}).itens, k = 'ml:cobrancas:' + conta, marca = await SHC.lerChave(k);
    if (meses.length) {
        const cobs = SHC.resolveCobrancasPorTitulo(linhas, itens).cobs, { vendas } = SHC.vendasEAdsDasCobrancas(cobs);
        const comFrete = new Set(cobs.filter(c => /^frete/.test(c.tipo) && c.orderId).map(c => c.orderId));
        cobs.forEach(c => { if (/^devolucao/.test(c.tipo) && c.orderId && /^MLB\d{6,14}$/.test(c.itemId) && !comFrete.has(c.orderId)) (vendas[c.itemId] || (vendas[c.itemId] = {}))[c.orderId] = null; });
        await SHC.registraVendas(vendas);
        await gravarFreteHist(conta, cobs, meses);
        await gravarConferir(conta, cobs, meses, itens).catch(() => {});
    } else if (marca) await gravarFreteHist(conta, null, []);   // conta nova (nada lido ainda): não há o que refazer
    // O mês passado também: está "fechado e lido", ninguém o relê → o fech dele ficaria no formato antigo (sem tipos 2). Relido 1 vez a
    // partir dos dias novos (cob guardado já migrado acima), o fech é regravado com a devolução separada.
    const velhos = ((marca && marca.mesesLidos) || []).filter(m => m < atual);
    if (velhos.length) await SHC.gravarChave(k, Object.assign({}, marca, { releer: [...new Set([...(marca.releer || []), ...velhos])].sort() }));
    feitas[conta] = 1;   // versão da migração (sem hora: a retomada grava exatamente o mesmo que uma leitura sem queda)
    await SHC.gravarChave(kM, feitas);
    return true;
}
// ── v3.1: migração ÚNICA por conta (marca em shc:migra:porDiaTipo = {conta: 1}). O fech de mês fechado lido antes desta versão não tem
// porDiaTipo (cobrança por dia E tipo) → o cartão "Confere com a fatura do ML" (F.somaCiclo) fica no modo 'misto'. Esses meses vão para
// `releer` (mesmo caminho da migrarFreteDevolucao: o mês passado pela sincronização, os mais antigos pelo histórico); o fech antigo só é
// trocado quando o mês é relido inteiro. O mês atual já é regravado inteiro a cada sincronização.
async function migrarPorDiaTipo(conta) {
    const kM = 'shc:migra:porDiaTipo', feitas = (await SHC.lerChave(kM)) || {};
    if (!conta || conta === 'atual' || feitas[conta]) return false;
    const k = 'ml:cobrancas:' + conta, marca = await SHC.lerChave(k), atual = SHC.hoje().slice(0, 7), velhos = [];
    for (const m of ((marca && marca.mesesLidos) || []).filter(m => m < atual)) {
        const f = await SHC.lerChave(SHC.chaveFech(conta, m));   // mesma regra da F.somaCiclo (mês sem cobrança nenhuma não precisa)
        if (f && !f.porDiaTipo && (!f.porDia || Object.keys(f.porDia).length)) velhos.push(m);
    }
    if (velhos.length) await SHC.gravarChave(k, Object.assign({}, marca, { releer: [...new Set([...(marca.releer || []), ...velhos])].sort() }));
    feitas[conta] = 1;
    await SHC.gravarChave(kM, feitas);
    return true;
}

// Resumo da etapa: "11 de 12 meses lidos · dez/25 não respondeu (tento de novo na próxima)".
function resumoFaturamento(r) {
    const nl = r.naoLidos || [];
    if (!nl.length) return SHC.qtd(r.meses, 'mês', 'meses') + ' · ' + SHC.qtd(r.lidas, 'cobrança', 'cobranças');
    const nomes = nl.slice(0, 3).map(mesCurto).concat(nl.length > 3 ? ['mais ' + (nl.length - 3)] : []);
    return r.meses + ' de ' + r.de + ' meses lidos · ' + (nomes.length > 1 ? nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1] : nomes[0])
        + (nl.length > 1 ? ' não responderam' : ' não respondeu') + ' (tento de novo na próxima)';
}

// ── v2.4: fechamento do mês (fech:<conta>:<AAAA-MM>) com TODAS as cobranças lidas, por tipo; estorno com sinal negativo ──
const mesAntes = (m, k) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 - k, 1)).toISOString().slice(0, 7);
const fimDoMes = m => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
// meses = os lidos inteiros agora (o atual até hoje).
async function gravarFechamento(sellerId, todas, meses) {
    const hoje = SHC.hoje(), atual = hoje.slice(0, 7), desdePedidos = mesAntes(atual, 2);   // pedidos: só os últimos 3 meses
    const fech = SHC.fechamentoDasCobrancas(todas, desdePedidos), vb = await SHC.lerVendasBrutas(sellerId), gravar = {};
    // Mês lido inteiro (ou o atual até hoje) sem cobrança nenhuma = 0 de verdade: grava zerado (porDia vazio = lido; sem ele o rateio e o
    // "Confere com a fatura" achavam que o mês não foi lido).
    for (const m of meses) {
        const f = fech[m] || { mes: m, porTipo: {}, porDia: {}, estornos: 0, total: 0, qtdVendas: 0, pedidos: {}, tipos: SHC.FECH_TIPOS_VERSAO };
        const b = vb && SHC.vendasBrutasDoMes(vb.dias, m);
        if (b) f.vendasBrutas = b;   // soma dos dias lidos ({valor, dias, …}): a página marca "parcial (N de M dias)" se faltar dia
        gravar[m] = Object.assign(f, { parcial: m === atual, ate: m === atual ? hoje : fimDoMes(m), ts: Date.now() });
    }
    // O mês que saiu da janela de 3 meses perde os pedidos (economiza espaço).
    const velho = mesAntes(atual, 3);
    if (!gravar[velho]) {
        const v = await SHC.lerChave(SHC.chaveFech(sellerId, velho));
        if (v && v.pedidos && Object.keys(v.pedidos).length) gravar[velho] = Object.assign(v, { pedidos: {} });
    }
    await SHC.salvarFechamentos(sellerId, gravar);
    return Object.keys(gravar).sort();
}

// ── v2.4.4: rateio das faturas por mês do calendário → fech:<conta>:rateio = {ts, dia (fechamento da conta), faturas:[SHC.rateioFaturas…]}.
// Junta o porDia de todos os fech:<conta>:<mês> guardados com as faturas de fat:<conta>. Sem faturas (ou sem dia) → grava vazio. ──
async function gravarRateio(sellerId) {
    const fat = (await SHC.lerFaturas(sellerId)) || {}, dia = SHC.diaFechamento(fat.faturas);
    // Mês gravado por versão anterior (sem porDia) conta como não lido: o rateio dele fica "incompleto" até o Faturamento ser relido.
    const j = SHC.porDiaDosFechs(await SHC.lerFechamentos(sellerId, 14));
    const faturas = dia ? SHC.rateioFaturas(j.porDia, fat.faturas, dia, j.lidos) : [];
    await SHC.gravarChave('fech:' + sellerId + ':rateio', { ts: Date.now(), dia, faturas });
    return faturas;
}

// ── v2.4: faturas por mês (Faturamento › Resumo). userId na URL é obrigatório (sem ele → 422): confirmado ao vivo em 25/09/2026. ──
// v2.4: + notas fiscais de cada fatura fechada dos últimos 12 meses (1 GET por fatura, com pausa) → fat:<conta>.notas['AAAA-MM']
// = [SHC.mlNotasFiscais…] e linkNotas['AAAA-MM'] (aba ?fiscalTab=true). Relê só a fatura sem notas ou com nota que não está DONE;
// a que o ML ainda não emitiu ("Vamos te avisar quando…") fica para depois. Falha numa fatura não apaga as notas que havia.
const dataDaFatura = f => ((/\/detail\/(\d{8})/.exec((f.notas && f.notas.url) || f.linkDetalhe || '') || [])[1]) || String(f.fechamento || '').replace(/-/g, '');
async function sincronizarFaturas(sellerId, progresso) {
    const q = '?userId=' + encodeURIComponent(sellerId) + '&userType=default_user&roadmap=';
    // v2.10: o resumo lido neste ciclo fica guardado (naCiclo): a retomada no meio da NF-e não pede as faturas de novo.
    const r = await naCiclo('faturas', 'resumo', async () => {
        const g1 = await buscarJson(BASE + '/billing/resume/api/initial-group-one' + q + 'cdnCommunication,debtPeriod,currentPeriod');
        await bateVivo(progresso);   // dois pedidos de até 25 s seguidos: o worker não pode ficar 30 s sem chamada à extensão
        const g2 = await buscarJson(BASE + '/billing/resume/api/initial-group-two' + q + 'access,closedPeriod');
        await bateVivo(progresso);
        const x = SHC.mlFaturas(g1 && g1.json, g2 && g2.json);
        return !x.faturas.length && !x.atual ? { falha: (g1 && g1.login) || (g2 && g2.login) ? 'login' : 'indisponivel' } : x;
    });
    if (r.falha) return r;
    const antes = (await SHC.lerFaturas(sellerId)) || {}, desde = mesAntes(SHC.hoje().slice(0, 7), 12), notas = {}, linkNotas = {}, categorias = {};
    Object.keys(antes.notas || {}).forEach(m => { if (m >= desde) notas[m] = antes.notas[m]; });
    Object.keys(antes.categorias || {}).forEach(m => { if (m >= desde) categorias[m] = antes.categorias[m]; });
    r.faturas.forEach(f => { if (f.mes >= desde && f.notas && f.notas.url) linkNotas[f.mes] = f.notas.url; });
    const salvar = () => SHC.salvarFaturas(sellerId, Object.assign({ ts: Date.now() }, r, { notas, linkNotas, categorias }));
    await salvar();   // as faturas primeiro; as notas vêm depois, uma fatura por vez
    const faltam = r.faturas.filter(f => f.mes >= desde && f.notas && !f.notas.pendente && /^\d{8}$/.test(dataDaFatura(f))
        && !((notas[f.mes] || []).length && notas[f.mes].every(n => n.status === 'DONE')));
    for (let k = 0; k < faltam.length; k++) {
        const lidas = await naCiclo('faturas', 'notas|' + dataDaFatura(faltam[k]), async () => {
            await espera(PAUSA_MS);
            const b = await buscarJson(BASE + '/billing/detail/api/filters-downloads-info/' + dataDaFatura(faltam[k]) + '/bricks?userId=' + encodeURIComponent(sellerId));
            return b && b.json ? SHC.mlNotasFiscais(b.json) : null;
        });
        if (lidas) notas[faltam[k].mes] = lidas;
        await progresso({}, { feito: k + 1, de: faltam.length, unidade: 'faturas' });
    }
    // v3.1: resumo por categoria/tipo de tarifa de cada fatura (custo novo: SHC.custosNovos). 1 GET por fatura, uma por vez com pausa:
    // a fechada é lida 1 vez (não muda mais; a lida enquanto estava em andamento é relida 1 vez depois de fechar); a em andamento, a cada
    // sincronização. A mais recente primeiro. Falha numa fatura não apaga o que havia; formato desconhecido não grava.
    // A fechada lida antes da linha 'cancelamentos' (a leitura nova sempre grava a chave, mesmo null) é relida 1 vez.
    const at = r.atual && /^\d{4}-\d{2}/.test(String(r.atual.fechamento || '')) && /^\d{8}$/.test(dataDaFatura({ linkDetalhe: r.atual.linkDetalhe })) ? r.atual : null;
    const cats = (at ? [{ mes: at.fechamento.slice(0, 7), nome: at.nome, fechamento: at.fechamento, linkDetalhe: at.linkDetalhe, aberta: true }] : [])
        .concat(r.faturas.filter(f => f.mes >= desde && /^\d{8}$/.test(dataDaFatura({ linkDetalhe: f.linkDetalhe })) && (!categorias[f.mes] || categorias[f.mes].aberta || categorias[f.mes].cancelamentos === undefined))
            .sort((a, b) => (a.mes < b.mes ? 1 : -1)).map(f => ({ mes: f.mes, nome: f.nome, fechamento: f.fechamento, linkDetalhe: f.linkDetalhe, aberta: false })));
    for (const f of cats) {
        const data = dataDaFatura({ linkDetalhe: f.linkDetalhe });
        const c = await naCiclo('faturas', 'cat|' + data, async () => {
            await espera(PAUSA_MS);
            const b = await buscarJson(SHC.faturaCategoriasUrl(data));
            return b && b.json ? SHC.mlFaturaCategorias(b.json) : null;
        });
        if (c && Array.isArray(c.categorias)) categorias[f.mes] = Object.assign({ nome: f.nome || '', fechamento: f.fechamento || '', aberta: f.aberta, link: f.linkDetalhe || '', lidoEm: Date.now() }, c);
        await bateVivo(progresso);
    }
    if (faltam.length || cats.length) await salvar();
    return Object.assign({}, r, { notasFiscais: Object.keys(notas).reduce((n, m) => n + notas[m].length, 0) });
}

// ── v2.8: NF-e das SUAS VENDAS (Faturador e Full), mês atual e anterior → nfe:<conta>:<AAAA-MM> = SHC.nfeMes + ts (dentro da etapa 'faturas').
// POST de CONSULTA em SHC.NFE_URL (a busca da página "Notas fiscais" do ML: só lê, não cria nem muda nada; exceção documentada ao "só GET",
// como a calculadora do Simulador). Páginas de SHC.NFE_LIMITE, 3 ao mesmo tempo, até o total. Mês que falhar → o anterior fica, com erro.
const NFE_PAGINAS_MAX = 500;   // ponytail: até 5.000 notas por mês; acima disso fica completo:false (somas das lidas)
async function buscarNfe(corpo) {
    try {
        const r = await fetch(SHC.NFE_URL, comTempo({ method: 'POST', credentials: 'include', cache: 'no-store',
            headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(corpo) }));
        if (ehLogin(r.url)) return { login: true };
        return r.ok ? { json: await r.json() } : null;
    } catch (e) { return null; }
}
// progresso (o da sincronização): a cada página grava a batida e "N de M notas" (sem isso a tela acha que parou depois de 5 min).
// igual(total da 1ª página) → true: o mês guardado continua valendo e as outras páginas não são lidas (mês anterior sem mudança).
// v2.10: cada página lida no ciclo fica guardada (naCiclo, já reduzida por SHC.nfeVendasDaResposta): a retomada não pede de novo.
const nfePagina = (mes, off, desde) => naCiclo('faturas', 'nfe|' + mes + '|' + (desde ? desde + '|' : '') + off, async () => {
    if (off) await espera(PAUSA_MS);
    const b = await buscarNfe(SHC.nfePedido(mes, off, desde)), r = b && b.json ? SHC.nfeVendasDaResposta(b.json) : null;
    return r && (off || r.total !== null) ? r : { falha: b && b.login ? 'login' : 'indisponivel' };   // a 1ª página precisa do total
});
// Páginas 2..N de uma consulta (r1 = a 1ª, com o total), 3 ao mesmo tempo → { notas, paginas } | { falha }.
async function nfeResto(mes, desde, r1, progresso, parar) {
    const paginas = Math.min(Math.ceil(r1.total / SHC.NFE_LIMITE), NFE_PAGINAS_MAX), lidas = [r1.notas];
    let prox = 1, erro = null, feitas = 1;
    const anda = () => bateVivo(progresso && (x => progresso(x, { feito: Math.min(feitas * SHC.NFE_LIMITE, r1.total), de: r1.total, unidade: 'notas' })));
    await anda();   // a 1ª página (até 25 s) e o 1º lote de 3 (até 25 s) não podem somar 30 s sem chamada à extensão
    const vai = async () => {
        while (!erro && prox < paginas) {
            if (parar && parar()) { erro = { falha: 'parado' }; return; }
            const k = prox++;
            const r = await nfePagina(mes, k * SHC.NFE_LIMITE, desde);
            if (r.falha) { erro = r; return; }
            lidas[k] = r.notas; feitas++;
            await anda();
        }
    };
    await Promise.all([vai(), vai(), vai()]);
    return erro || { notas: [].concat(...lidas), paginas };
}
// v2.11: mês com a lista de notas guardada de uma leitura inteira → só as notas a partir de 2 dias antes da última leitura. Só vale se
// as notas de antes desse dia já estavam resolvidas (autorizada/cancelada: não mudam mais) e se a conta bate com o ML: total do mês =
// notas guardadas de antes + total dos dias novos. Não bateu → lê o mês inteiro, como antes.
const NFE_INC_DIAS = 2;
function nfeDesde(antes, mes) {
    if (!antes || !antes.ts || !antes.completo || antes.erro || antes.soTotais || !Array.isArray(antes.notas) || antes.notas.length !== antes.lidas) return null;
    const desde = diaMenos(new Date(antes.ts - 3 * 3600e3).toISOString().slice(0, 10), NFE_INC_DIAS);   // dia (hora de Brasília) da última leitura
    if (desde.slice(0, 7) !== mes || desde <= mes + '-01') return null;
    return antes.notas.every(n => String(n.emitidaEm || '').slice(0, 10) >= desde || NFE_RESOLVIDA[n.status]) ? desde : null;
}
async function lerNfeMes(mes, progresso, igual, antes, parar) {
    const r1 = await nfePagina(mes, 0);
    if (r1.falha) return r1;
    if (igual && igual(r1.total)) return { igual: true };
    const desde = nfeDesde(antes, mes);
    if (desde) {
        const w1 = await nfePagina(mes, 0, desde);
        const w = w1.falha ? w1 : await nfeResto(mes, desde, w1, progresso, parar);
        if (w.falha === 'parado') return w;
        if (!w.falha) {
            const velhas = antes.notas.filter(n => String(n.emitidaEm || '').slice(0, 10) < desde);
            if (velhas.length + w1.total === r1.total) return SHC.nfeMes(mes, r1.total, velhas.concat(w.notas), w.paginas * SHC.NFE_LIMITE >= w1.total);
        }
    }
    if (parar && parar()) return { falha: 'parado' };
    const t = await nfeResto(mes, null, r1, progresso, parar);
    if (t.falha) return t;
    return SHC.nfeMes(mes, r1.total, t.notas, t.paginas * SHC.NFE_LIMITE >= r1.total);
}
// Mês anterior (já fechado) só é relido inteiro se o total mudou, se a leitura guardada ficou incompleta/com erro ou se tem nota ainda
// não resolvida (pendente, rejeitada, com erro, sem status). Senão 1 página basta para conferir.
// v2.11: modo 'historico' = só o mês anterior ainda nunca lido (a 1ª leitura dele sai da sincronização e vai para o segundo plano);
// a sincronização lê o atual e, se já existe leitura guardada, confere o anterior.
const NFE_RESOLVIDA = { Autorizada: 1, Cancelada: 1 };
const nfeFechado = g => !!g && g.ts && g.completo && !g.erro && typeof g.total === 'number' && Object.keys(g.porStatus || {}).every(k => NFE_RESOLVIDA[k]);
async function sincronizarNfe(sellerId, progresso, modo) {
    const atual = SHC.hoje().slice(0, 7), out = { notas: 0, erros: 0, historico: 0 }, hist = modo === 'historico';
    for (const mes of [atual, mesAntes(atual, 1)]) {
        const k = 'nfe:' + sellerId + ':' + mes, antes = await SHC.lerChave(k), nunca = !antes;   // nunca tentado (nem com erro): fica para o histórico
        if (hist ? mes === atual || !nunca : mes !== atual && nunca && modo === 'recentes') { if (!hist) out.historico++; continue; }
        if (hist && histParar) break;
        const r = await lerNfeMes(mes, progresso, mes !== atual && nfeFechado(antes) ? t => t === antes.total : null, antes, hist ? () => histParar : null);
        if (r.falha === 'parado') break;   // a sincronização pediu a vez: nada gravado (nem erro), o mês fica para a próxima
        if (r.igual) { await SHC.gravarChave(k, Object.assign({}, antes, { ts: Date.now() })); out.notas += antes.total; continue; }
        if (r.falha) { await SHC.gravarChave(k, Object.assign({ mes }, await SHC.lerChave(k), { erro: r.falha, erroEm: Date.now() })); out.erros++; continue; }
        await SHC.gravarChave(k, Object.assign({ ts: Date.now() }, r));
        out.notas += r.total;
    }
    // O mês que saiu da janela perde a lista de notas (os totais ficam).
    const kv = 'nfe:' + sellerId + ':' + mesAntes(atual, 2), v = await SHC.lerChave(kv);
    if (v && v.notas && v.notas.length) await SHC.gravarChave(kv, Object.assign(v, { notas: [] }));
    return out;
}

// ── v2.4: vendas brutas (Métricas), dia a dia. v2.4.4: UM MÊS POR PEDIDO com ?start_period=custom&from_current=AAAA-MM-01T03:00:00.000Z
// &to_current=AAAA-MM-<último>T03:00:00.000Z (o formato da própria tela; confirmado ao vivo em 25/09/2026 para ago/26, mai/26 e dez/25).
// 1ª leitura: 13 meses (do atual para trás, com pausa); depois só o atual e o anterior. Mês que falhar fica para a próxima (não derruba os
// outros). Os dias lidos se acumulam em vb:<conta> e o fechamento soma os do mês (mês com dia faltando = parcial). ──
const VB_MESES = 13;
const vbPeriodo = mes => '?start_period=custom&from_current=' + mes + '-01T03:00:00.000Z&to_current=' + fimDoMes(mes) + 'T03:00:00.000Z';
// soMeses (botão "Tentar agora" do Fechamento): lê só esses meses. diag de cada mês vai para shc:status.etapas.vendasBrutas.meses.
async function sincronizarVendasBrutas(sellerId, progresso, soMeses) {
    const antes = (await SHC.lerVendasBrutas(sellerId)) || {}, hoje = SHC.hoje(), atual = hoje.slice(0, 7);
    const treze = []; for (let k = 0; k < VB_MESES; k++) treze.push(mesAntes(atual, k));
    const lidos = new Set(antes.mesesLidos || []);
    // O atual e o anterior sempre (mudam); os outros só enquanto não foram lidos (1ª leitura = os 13; depois só os que falharam).
    const meses = soMeses ? treze.filter(m => soMeses.indexOf(m) >= 0) : treze.filter((m, k) => k < 2 || !lidos.has(m));
    const novos = {}, lidosAgora = [], diag = {};
    let resumo = null, porAnuncio = null, login = false, ultimoDia = '', primeiroDia = '';
    const inicio = Date.now();   // tempo que falta pelo ritmo desta leitura (SHC.estimaMeses), como no Faturamento
    const conta = async (feito, extra) => { if (progresso) await progresso({}, Object.assign({ feito, de: meses.length, unidade: 'meses', mesAgora: meses[Math.min(feito, meses.length - 1)],
        restanteSeg: SHC.estimaMeses(inicio, feito, meses.length, Date.now()) }, extra)); };
    await conta(0);
    // Um mês → { r (SHC.mlVendasBrutas), dataset (o JSON trouxe a lista de dias), gross (veio a tabela por anúncio) } | { login } | null (sem resposta).
    // v2.10: na sincronização, o mês lido neste ciclo fica guardado (naCiclo): a retomada não pede de novo. O "Tentar agora" (soMeses) lê sempre.
    const lerMes = async (m, k) => {
        if (k) await espera(PAUSA_MS);
        // O mês inteiro numa chamada pode demorar: mesmo limite do Faturamento (60 s), não os 25 s das páginas.
        const perf = await buscarJson(BASE + '/api/sc-business-metrics/performance-data' + vbPeriodo(m), COB_TEMPO_MS);
        if (!perf || perf.login) return perf;
        // Por anúncio (gross-sales-data) só do mês atual: é o retrato "vendas por anúncio" que o painel mostra.
        const gross = m === atual ? await buscarJson(BASE + '/api/sc-business-metrics/gross-sales-data' + vbPeriodo(m)) : null;
        return { r: SHC.mlVendasBrutas(perf.json, gross && gross.json), dataset: JSON.stringify(perf.json || {}).indexOf('"dataset"') >= 0, gross: !!(gross && gross.json) };
    };
    for (let k = 0; k < meses.length; k++) {
        const m = meses[k];
        await conta(k);
        const x = soMeses ? await lerMes(m, k) : await naCiclo('vendasBrutas', 'vb|' + m, () => lerMes(m, k));
        if (x && x.login) { login = true; diag[m] = 'login'; await conta(k + 1, { meses: { [m]: 'login' } }); break; }   // sessão caiu: guarda o que já leu e para
        const r = x ? x.r : null, dias = r ? Object.keys(r.dias).sort() : [], gross = x && x.gross;
        // Diagnóstico: sem resposta (erro/tempo), formato mudou (JSON sem a lista de dias), vazio (lista sem dia nenhum).
        diag[m] = !x ? 'sem resposta' : dias.length ? 'ok' : !x.dataset ? 'formato mudou' : 'vazio';
        await conta(k + 1, { meses: { [m]: diag[m] } });
        if (!dias.length) continue;   // mês que não respondeu (ou sem dia nenhum): fica "não lido" (nunca zero), tenta na próxima
        Object.assign(novos, r.dias);
        lidos.add(m); lidosAgora.push(m);
        if (m === atual) { resumo = r.resumo; if (gross) porAnuncio = r.porAnuncio; }
        if (!ultimoDia) ultimoDia = dias[dias.length - 1];
        primeiroDia = dias[0];
    }
    const naoLidos = meses.filter(m => lidosAgora.indexOf(m) < 0);
    if (!lidosAgora.length) return { falha: login ? 'login' : 'indisponivel', diag };   // nada respondeu: o que havia fica
    // v2.5.3: grava JUNTANDO com o vb:<conta> de agora (na fila): o "Tentar agora" de um mês e a sincronização podem ler ao mesmo tempo
    // e um não apaga os dias que o outro acabou de gravar. Só os dias lidos agora entram por cima.
    const limite = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
    const salvo = await emFilaVb(async () => {
        const v = (await SHC.lerVendasBrutas(sellerId)) || {}, todos = Object.assign({}, v.dias || {}, novos), jaLidos = new Set((v.mesesLidos || []).concat(lidosAgora));
        Object.keys(todos).forEach(d => { if (d < limite) delete todos[d]; });
        const mesesLidos = treze.filter(m => jaLidos.has(m));
        const nl = [...new Set((soMeses ? (v.naoLidos || []) : []).concat(naoLidos))].filter(m => lidosAgora.indexOf(m) < 0 && treze.indexOf(m) >= 0);
        const snap = { ts: Date.now(), dias: todos, resumo: resumo || v.resumo || {}, porAnuncio: porAnuncio || v.porAnuncio || [], mesesLidos, completo13: mesesLidos.length === VB_MESES,
            naoLidos: nl, periodoLido: soMeses && v.periodoLido ? v.periodoLido : { de: primeiroDia, ate: ultimoDia, lidoEm: hoje } };
        await SHC.salvarVendasBrutas(sellerId, snap);
        return snap;
    });
    const valores = {};
    lidosAgora.forEach(m => { const s = SHC.vendasBrutasDoMes(salvo.dias, m); if (s) valores[m] = s.valor; });
    return { dias: Object.keys(novos).length, meses: lidosAgora.length, de: meses.length, naoLidos, diag, valores };
}
let filaVb = Promise.resolve();
const emFilaVb = fn => (filaVb = filaVb.then(fn, fn));
// Diagnóstico por mês: o novo por cima do guardado; só os 14 meses mais novos.
function juntaMeses(antes, novos) {
    const m = Object.assign({}, antes || {}, novos || {});
    Object.keys(m).sort().reverse().slice(14).forEach(k => delete m[k]);
    return m;
}
// → {ok:true, mes, diag:'ok', dias, valor (R$ das vendas brutas do mês)} | {ok:false, mes?, diag?, motivo:'mes'|'login'|'indisponivel'}. O diagnóstico
// do mês vai para shc:status.etapas.vendasBrutas.meses. v2.5.3: NUNCA recusa por causa da sincronização: lê o mês agora, em paralelo (1 GET;
// a gravação junta com a da sincronização, emFilaVb). O mesmo mês pedido 2× ao mesmo tempo = 1 leitura só.
const vbEmCurso = new Map();
function vendasBrutasMes(mes) {
    const atual = SHC.hoje().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(mes) || mes > atual || mes < mesAntes(atual, VB_MESES - 1)) return Promise.resolve({ ok: false, motivo: 'mes' });
    if (!vbEmCurso.has(mes)) vbEmCurso.set(mes, lerVbMes(mes).finally(() => vbEmCurso.delete(mes)));
    return vbEmCurso.get(mes);
}
async function lerVbMes(mes) {
    const conta = await SHC.contaAtual(), sessao = conta === 'atual' ? '' : await confereSessao(conta);
    if (sessao === 'outra_conta' || sessao === 'login') return { ok: false, mes, motivo: sessao };   // não mistura as vendas de outra conta
    const r = await sincronizarVendasBrutas(conta, null, [mes]), diag = (r.diag || {})[mes] || 'sem resposta';
    const marca = st => { const es = st.etapas || (st.etapas = {}), e = es.vendasBrutas || (es.vendasBrutas = {}); e.meses = juntaMeses(e.meses, { [mes]: diag }); };
    if (stSync && gravarSync) { marca(stSync); await gravarSync(); }   // sincronização rodando: o status dela (em memória) ganha o diagnóstico
    else await emFilaStatus(async () => { const st = await SHC.lerStatus(); marca(st); await SHC.salvarStatus(st); });
    const valor = r.valores && typeof r.valores[mes] === 'number' ? r.valores[mes] : null;
    return r.falha ? { ok: false, mes, diag, motivo: r.falha } : { ok: true, mes, diag, dias: r.dias, valor };
}
// "13 meses · 395 dias" ou "11 de 13 meses lidos · dez/25 e mai/26 não responderam (tento de novo na próxima)"
function resumoVendasBrutas(r) {
    const nl = r.naoLidos || [];
    if (!nl.length) return SHC.qtd(r.meses || 0, 'mês', 'meses') + ' · ' + SHC.qtd(r.dias || 0, 'dia', 'dias');
    return resumoFaturamento({ meses: r.meses, de: r.de, naoLidos: nl, lidas: 0 });
}

// ── v2.6: vendas POR ANÚNCIO mês a mês (faturamento por família). Mesma API das vendas brutas (gross-sales-data, mês inteiro com
// ?start_period=custom), 30 linhas por página com &page_number=N; o total de páginas vem em page_quantity ("page=" NÃO pagina: devolve
// sempre a 1ª — confirmado ao vivo em 25/09/2026). 13 meses, do mais novo para o mais velho; em cada mês a 1ª página sozinha e depois até
// 3 ao mesmo tempo (SHC.paginasEmParalelo: nunca mais de 3 pedidos juntos). Mês fechado já lido (inteiro ou cortado no teto) DEPOIS de fechar não é lido de
// novo (o atual e o anterior sempre). Mês que falha (qualquer página, 1 nova tentativa por página) fica "não lido" (nunca zero): o que
// havia fica, e o motivo vai para o diagnóstico da etapa (shc:status.etapas.vendasAnuncio.meses).
// Etapa PRÓPRIA 'vendasAnuncio', no fim da sincronização (antes dos Alertas): são até ~65 GETs e nenhuma outra etapa espera por ela.
// Mês com mais de VA_PAGINAS_MAX páginas (page_quantity): lê as VA_PAGINAS_MAX e grava completo:false, diag 'cortado' ("lido só em parte"):
// nunca passa por mês inteiro. A cada página, uma batida (progresso): o mês leva até ~2 min e o worker não pode ficar mudo.
// → vbAnuncio:<conta> = { ts, meses:{'AAAA-MM': {porAnuncio:{MLB:{bruto, unidades, vendas, visitas, sku}}, paginas, linhas, completo, lidoEm, lidoTs}},
//   itens:{MLB:{sku, titulo}}, mesesLidos:[…], naoLidos:[…] }
const VA_PAGINAS_MAX = 80, VA_LINHAS = 30, VA_PARALELO = 3;   // até 2.400 anúncios com venda no mês (o mesmo teto da lista de Anúncios)
const urlVendasAnuncio = (m, p) => BASE + '/api/sc-business-metrics/gross-sales-data' + vbPeriodo(m) + '&page_number=' + p;
// v3.1 (a dona viu "set/26: o ML não respondeu" com o ML respondendo em 0,5 s): o buscarJson junta toda falha em null e a página tinha
// só 1 nova tentativa 1,2 s depois — um "calma" do ML (429/503) ou um engasgo de 2 pedidos seguidos derrubava o mês inteiro.
// Aqui o motivo exato de cada falha → { json } | { login: true } | { falha: 'ocupado' (429/503), espera (ms do Retry-After, até 60 s) } |
//   { falha: 'tempo' (passou do limite) | 'erro NNN' (outro status) | 'sem resposta' (rede) | 'formato mudou' (200 que não é JSON) }.
async function buscarJsonMotivo(url, tempoMs) {
    const vivo = tempoMs > TEMPO_MS && typeof setInterval === 'function'
        ? setInterval(() => { if (chrome.runtime.getPlatformInfo) chrome.runtime.getPlatformInfo().catch(() => {}); }, 20000) : null;
    const tempo = e => !!e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    try {
        const r = await SHC.buscarVendo(url, comTempo({ credentials: 'include', cache: 'no-store', headers: { accept: 'application/json' } }, tempoMs));
        if (ehLogin(r.url)) return { login: true };
        if (r.ok) { try { return { json: await r.json() }; } catch (e) { return { falha: tempo(e) ? 'tempo' : 'formato mudou' }; } }
        if (r.status === 429 || r.status === 503) { const s = +((r.headers && r.headers.get && r.headers.get('retry-after')) || 0); return { falha: 'ocupado', espera: s > 0 ? Math.min(60, s) * 1000 : 0 }; }
        return { falha: r.status ? 'erro ' + r.status : 'sem resposta' };
    } catch (e) { return { falha: tempo(e) ? 'tempo' : 'sem resposta' }; } finally { if (vivo) clearInterval(vivo); }
}
// Esperas antes de cada nova tentativa de uma página (espera crescente; "ocupado" usa o Retry-After do ML se for maior). Limite por pedido: 45 s.
const VA_ESPERAS_MS = [2000, 6000, 15000], VA_TEMPO_MS = 45000;
// Um mês → { porAnuncio, itens, paginas, linhas, cortado } | { falha: 'login'|'sem resposta'|'tempo'|'ocupado'|'erro NNN'|'formato mudou'|'vazio'|'incompleto' }.
// vbMes = SHC.vendasBrutasDoMes do vb:<conta> (lista vazia só vale como "sem venda" quando a conta também vendeu R$ 0 no mês).
// cortado = o ML tem mais páginas que VA_PAGINAS_MAX (não dá para usar r.cortado de paginasEmParalelo: a última página cheia também "corta").
// parar (histórico): a sincronização pediu a vez → { falha: 'parado' } antes da próxima página (o mês pela metade não é gravado).
async function lerMesVendasAnuncio(m, vbMes, progresso, parar) {
    let paginas = 1, cortado = false;
    // v2.10: página lida neste ciclo fica guardada (naCiclo, só as linhas por anúncio): a retomada não pede de novo.
    const pagina = async p => {
        if (parar && parar()) return { falha: 'parado' };
        const r = await naCiclo('vendasAnuncio', 'va|' + m + '|' + p, async () => {
            let b = await buscarJsonMotivo(urlVendasAnuncio(m, p), VA_TEMPO_MS);
            // Até 3 novas tentativas (2 s, 6 s, 15 s; o Retry-After do ML quando ele pede calma), com batida antes de cada uma. Sessão caída não repete.
            for (let k = 0; b.falha && k < VA_ESPERAS_MS.length && !(parar && parar()); k++) {
                await bateVivo(progresso);
                await espera(Math.max(VA_ESPERAS_MS[k], b.espera || 0));
                b = await buscarJsonMotivo(urlVendasAnuncio(m, p), VA_TEMPO_MS);
            }
            await bateVivo(progresso);
            if (b.login) return { falha: 'login' };
            if (b.falha && parar && parar()) return { falha: 'parado' };
            if (b.falha || !b.json) return { falha: b.falha || 'sem resposta' };
            const x = SHC.mlVendasBrutas(null, b.json);
            return x.temTabela ? { paginas: x.paginas, porAnuncio: x.porAnuncio } : { falha: 'formato mudou' };
        });
        if (r.falha) return r;
        if (p === 1 && r.paginas) { paginas = Math.min(VA_PAGINAS_MAX, r.paginas); cortado = r.paginas > VA_PAGINAS_MAX; }
        return r.porAnuncio.map(a => Object.assign({ id: a.itemId }, a));
    };
    const p1 = await pagina(1);
    if (p1.falha) return p1;
    const r = await SHC.paginasEmParalelo(p => (p === 1 ? Promise.resolve(p1) : pagina(p)), { limite: VA_LINHAS, max: paginas, paralelo: VA_PARALELO });
    if (r.falha) return { falha: r.falha };
    if (!r.linhas.length) return vbMes && vbMes.valor === 0 ? { porAnuncio: {}, itens: {}, paginas, linhas: 0 } : { falha: 'vazio' };
    if (paginas > 1 && r.linhas.length <= (paginas - 1) * VA_LINHAS) return { falha: 'incompleto' };   // o ML repetiu ou pulou página
    const porAnuncio = {}, itens = {};
    r.linhas.forEach(a => {
        porAnuncio[a.itemId] = { bruto: a.bruto, unidades: a.unidades, vendas: a.vendas, visitas: a.visitas, sku: a.sku || '' };
        itens[a.itemId] = { sku: a.sku || '', titulo: a.titulo || '' };
    });
    return { porAnuncio, itens, paginas, linhas: r.linhas.length, cortado };
}
// Mês de vendas por anúncio lido DEPOIS de fechar (inteiro ou no teto de páginas): não é relido. O MESMO critério no filtro da leitura e na
// conta do "quanto falta" do histórico (antes: mês lido antes de fechar contava como pronto e ficava cortado para sempre).
const fechadoLidoVA = (M, m) => !!(M[m] && String(M[m].lidoEm || '') > fimDoMes(m) && (M[m].completo || M[m].paginas >= VA_PAGINAS_MAX));
// v2.11: modo 'recentes' (a sincronização) = só o atual e o anterior (este só até ser lido fechado); 'historico' (lerHistorico) = os
// meses antigos ainda não lidos fechados, gravando a cada mês e parando quando a sincronização pede a vez (histParar). Sem modo: todos.
async function sincronizarVendasAnuncio(sellerId, progresso, modo) {
    const k = 'vbAnuncio:' + sellerId, M0 = (((await SHC.lerChave(k)) || {}).meses) || {}, hoje = SHC.hoje(), atual = hoje.slice(0, 7), hist = modo === 'historico';
    const treze = []; for (let i = 0; i < VB_MESES; i++) treze.push(mesAntes(atual, i));
    // Mês fechado lido DEPOIS de fechar não é relido: inteiro, ou cortado no teto (o page_quantity de mês fechado não muda; reler
    // gastaria as mesmas VA_PAGINAS_MAX páginas a cada sincronização para dar de novo "lido só em parte"). Como o Faturamento.
    const fechadoLido = m => fechadoLidoVA(M0, m);
    // v3.1: o histórico também tenta o mês atual e o anterior que a sincronização não conseguiu ler (nunca lidos), PRIMEIRO: a tela de
    // famílias não fica 3 h em "não respondeu" esperando a próxima sincronização.
    const meses = treze.filter((m, i) => (hist ? (i >= 2 ? !fechadoLido(m) : !M0[m]) : modo === 'recentes' ? i === 0 || (i === 1 && !fechadoLido(m)) : i < 2 || !fechadoLido(m)));
    const vb = await SHC.lerVendasBrutas(sellerId), inicio = Date.now(), novos = {}, itens = {}, diag = {}, naoLidos = [], cortados = [];
    let login = false, parado = false, seguidas = 0;
    const grava = () => mudaChave(k, v => {
        v.meses = Object.assign({}, v.meses || {}, novos);
        Object.keys(v.meses).forEach(m => { if (treze.indexOf(m) < 0) delete v.meses[m]; });
        v.itens = Object.assign({}, v.itens || {}, itens);
        Object.keys(v.itens).forEach(id => { if (!treze.some(m => v.meses[m] && v.meses[m].porAnuncio && v.meses[m].porAnuncio[id])) delete v.itens[id]; });
        Object.assign(v, { ts: Date.now(), naoLidos, mesesLidos: treze.filter(m => v.meses[m] && v.meses[m].completo) });
    });
    for (let i = 0; i < meses.length; i++) {
        const m = meses[i];
        if (hist && histParar) { parado = true; break; }   // a sincronização pediu a vez: o resto fica para a próxima
        if (i) await espera(PAUSA_MS);
        if (progresso) await progresso({}, { feito: i, de: meses.length, unidade: 'meses', mesAgora: m, restanteSeg: SHC.estimaMeses(inicio, i, meses.length, Date.now()) });
        const r = await lerMesVendasAnuncio(m, vb && SHC.vendasBrutasDoMes(vb.dias, m), progresso, hist ? () => histParar : null);
        if (r.falha === 'parado') { parado = true; break; }   // a sincronização pediu a vez no meio do mês: ele fica para a próxima
        diag[m] = r.falha || (r.cortado ? 'cortado' : 'ok');
        if (progresso) await progresso({}, { feito: i + 1, de: meses.length, unidade: 'meses', meses: { [m]: diag[m] } });
        if (r.falha) {
            naoLidos.push(m);
            if (r.falha === 'login') { login = true; naoLidos.push(...meses.slice(i + 1)); break; }   // sessão caiu: guarda o que já leu e para
            // v3.1: 2 meses seguidos sem resposta (cada página já tentou 4 vezes) e nada lido agora = o ML está fora: o resto fica para a próxima.
            if (++seguidas >= 2 && !Object.keys(novos).length) { naoLidos.push(...meses.slice(i + 1)); break; }
            continue;
        }
        seguidas = 0;
        if (r.cortado) cortados.push(m);   // lido só em parte: grava o que leu (completo:false, a tela avisa); fechado, não é relido
        novos[m] = { porAnuncio: r.porAnuncio, paginas: r.paginas, linhas: r.linhas, completo: !r.cortado, lidoEm: hoje, lidoTs: Date.now() };   // lidoTs: até que hora o mês foi lido (ritmo)
        Object.assign(itens, r.itens);
        if (hist) await grava();   // segundo plano (sem ciclo): o mês lido fica gravado mesmo se o worker morrer no próximo
    }
    const lidos = Object.keys(novos);
    if (!lidos.length && meses.length && !parado) return { falha: login ? 'login' : 'indisponivel', diag };   // nada respondeu: o que havia fica
    const snap = await grava();
    const noAtual = ((snap.meses[atual] || {}).porAnuncio) || {};
    return { meses: lidos.length - cortados.length, de: meses.length, naoLidos, cortados, diag, mesesLidos: snap.mesesLidos.length, parado,
        anuncios: Object.keys(noAtual).filter(id => (+(noAtual[id] || {}).bruto || 0) > 0).length };
}
// "13 meses · 142 anúncios com venda no mês" ou "11 de 13 meses lidos · dez/25 e mai/26 não responderam (tento de novo na próxima)"
// Mês cortado (vendas demais): " · set/26 lido só em parte (vendas demais para ler inteiro)".
function resumoVendasAnuncio(r) {
    const nl = r.naoLidos || [], ct = r.cortados || [];
    const parte = ct.length ? ' · ' + ct.map(mesCurto).join(' e ') + ' lido' + (ct.length > 1 ? 's' : '') + ' só em parte (vendas demais para ler inteiro)' : '';
    if (nl.length) return resumoFaturamento({ meses: r.meses, de: r.de, naoLidos: nl, lidas: 0 }) + parte;
    return SHC.qtd(r.mesesLidos || 0, 'mês', 'meses') + ' · ' + SHC.qtd(r.anuncios || 0, 'anúncio com venda no mês', 'anúncios com venda no mês') + parte;
}

// ── v2.4: Mercado Ads (API pa.mercadolivre.com.br, sessão do Chrome), mapeado ao vivo em 24/09/2026 (AMB MOVE) ──
// Campanhas (30 dias + os 30 anteriores), desempenho ao competir por impressões de cada campanha, anúncios patrocinados (todas
// as páginas, 50 por vez) e totais por dia. Só LÊ: nada de criar/alterar campanha, orçamento ou lance.
// Falhou → o retrato anterior fica e o status ganha erroAds. Nenhuma campanha → {temAds:false}.
const PA = 'https://pa.mercadolivre.com.br/pa/api/admin-pads/ajax';
const ADS_LIMITE = 50, ADS_PAGINAS_MAX = 60;   // até 3.000 anúncios patrocinados
const diaMenos = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') - n * 864e5).toISOString().slice(0, 10);
const periodo = (de, ate) => 'dateFrom=' + de + '&dateTo=' + ate;
// Pedido do Ads dentro do ciclo (naCiclo): a resposta boa fica guardada e a retomada depois de uma queda não pede de novo.
// reduz(json) = o que guardar (a lista de anúncios guarda só o que o Copiloto usa). null/login/erro nunca ficam guardados.
const adsNoCiclo = (url, reduz) => naCiclo('ads', url.replace(PA, ''), async () => {
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
async function lerCampanhas(de, ate, progresso) {
    const campanhas = [];
    for (let n = 0; n < 20; n++) {
        const b = await adsNoCiclo(PA + '/campaigns/search?' + periodo(de, ate) + '&limit=' + ADS_LIMITE + '&offset=' + (n * ADS_LIMITE) + '&filters[statuses]=A,D');
        await bateVivo(progresso);
        if (!b || b.login || !b.json || !Array.isArray(b.json.results)) return { falha: falhaAds(b) };
        const r = SHC.adsCampanhas(b.json);
        campanhas.push(...r.campanhas);
        if (!r.campanhas.length || campanhas.length >= r.total) break;
        await espera(PAUSA_MS);
    }
    return { campanhas };
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
    let total = null;
    for (let n = 0; n < ADS_PAGINAS_MAX; n++) {
        await espera(PAUSA_MS);
        const b = await adsNoCiclo(PA + '/ads?' + periodo(de, ate) + '&limit=' + ADS_LIMITE + '&offset=' + (n * ADS_LIMITE)
            + (advertiserId ? '&advertiserId=' + encodeURIComponent(advertiserId) : '')
            + '&filters%5Bstatuses%5D=A%2CP%2CI%2CG%2CR%2CC%2CS%2CX%2CY%2CM%2CH%2CZ&comparisonDateFrom=' + antDe + '&comparisonDateTo=' + antAte,
            j => (Array.isArray(j.results) ? { results: { length: j.results.length }, lidos: SHC.adsAnuncios(j) } : j));
        if (!b || b.login || !b.json || !(Array.isArray(b.json.results) || b.json.lidos)) return semAba({ falha: falhaAds(b) });
        const chave = a => (a.itemId || 'cat:' + a.produtoCatalogoId) + '|' + a.campanhaId;   // catálogo vem sem itemId (id do produto)
        const r = b.json.lidos || SHC.adsAnuncios(b.json), novos = r.anuncios.filter(a => !vistos.has(chave(a)));
        total = r.total;
        novos.forEach(a => { vistos.add(chave(a)); anuncios.push(a); });
        await progresso({ adsAnuncios: anuncios.length }, { feito: anuncios.length, de: total, unidade: total ? 'anúncios' : null });
        if (!novos.length || b.json.results.length < ADS_LIMITE || anuncios.length >= total) break;   // fim, ou o ML repetiu a página
    }
    const res = await adsNoCiclo(PA + '/campaigns/metrics?' + periodo(de, ate));
    await bateVivo(progresso);
    const ant = await adsNoCiclo(PA + '/campaigns/metrics?' + periodo(antDe, antAte));
    await bateVivo(progresso);
    const campAnt = await lerCampanhas(antDe, antAte, progresso), porId = {};
    (campAnt.campanhas || []).forEach(c => { porId[c.id] = c.metricas; });
    const resumoAnt = ant && ant.json ? SHC.adsResumo(ant.json) : null;
    const snap = { ts: Date.now(), temAds: true, periodo: { de, ate }, advertiserId, campanhas, anuncios, totalAnuncios: total,
        completo: total === null || anuncios.length >= total, resumo: res && res.json ? SHC.adsResumo(res.json) : null,
        anterior: { periodo: { de: antDe, ate: antAte }, campanhas: porId, total: resumoAnt ? resumoAnt.total : null } };
    await SHC.salvarAds(sellerId, snap);
    return snap;
}

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
// Pedidos por afiliados (page começa em 0). A resposta traz o afiliado e o número do pedido: o Copiloto só guarda a SOMA por SKU e por situação.
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
// Pedidos por afiliados do período, todas as páginas → soma por SKU e por situação (SHC.afilPedidosAgrega) | { falha }.
async function lerPedidosAfiliados(de, ate, progresso) {
    const vendas = [];
    let completo = true, total = null;
    for (let p = 0; ; p++) {
        if (p >= AFIL_PED_PAGINAS_MAX) { completo = false; break; }
        const pg = await naCiclo('afiliados', 'pedidos|' + de + '|' + ate + '|' + p, async () => {
            if (p) await espera(PAUSA_MS);
            const b = await buscarJson(urlAfilPedidos(de, ate, p)), x = b && b.json ? SHC.afilPedidos(b.json) : null;   // só SKU, valor e situação: nada do afiliado
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

// ── v2.4: alertas críticos (Full acabando + Ads acima do equilíbrio) → shc:alertas e o número no ícone ──
// v2.5.3: o número é o de TODAS as anomalias (SHC.anomalias); vermelho com reclamação/mediação em aberto ou pagamento a conferir, âmbar no resto.
// O título do ícone diz quanto de cada tipo. Aceita também um número (compatível com o shc:alertas antigo).
// v2.7: a.semanalNovo (resumo da semana ainda não visto) → sem anomalia o ícone mostra "•" âmbar; o título avisa.
function selo(a) {
    if (!chrome.action || !chrome.action.setBadgeText) return;
    const n = typeof a === 'number' ? a : (a && a.total) || 0, novo = !!(a && typeof a === 'object' && (a.semanalNovo || a.promoNovo));
    chrome.action.setBadgeText({ text: n > 0 ? (n > 99 ? '99+' : String(n)) : (novo ? '•' : '') }).catch(() => {});
    if ((n > 0 || novo) && chrome.action.setBadgeBackgroundColor) chrome.action.setBadgeBackgroundColor({ color: n > 0 && (typeof a === 'number' || (a && a.vermelho)) ? '#D93025' : '#B06000' }).catch(() => {});
    if (chrome.action.setTitle) chrome.action.setTitle({ title: typeof a === 'number' ? 'Abrir o Copiloto' : SHC.anomaliasTitulo(a) + (a && a.semanalNovo ? ' · novo resumo da semana' : '')
        + (a && a.promoNovo ? ' · o robô achou promoção que mantém a sua margem mínima' : '') }).catch(() => {});
}
async function atualizarAlertas(conta) {
    const c = conta || await SHC.contaAtual();
    const [full, ads, an, cfg, lidos] = await Promise.all([SHC.lerFull(c), SHC.lerAds(c), SHC.lerAnuncios(c), SHC.lerCfg(), SHC.lerMesesVendasLidos(c)]);
    const comAds = new Set(((ads && ads.anuncios) || []).filter(a => a.custo > 0).map(a => a.itemId));
    const itens = ((an && an.itens) || []).filter(i => comAds.has(i.itemId)), chaves = new Set(), ids = new Set();
    itens.forEach(i => { if (i.sku) chaves.add(SHC.chaveSku(i.sku)); chaves.add(SHC.chave('ml', i.itemId)); if (i.familia) chaves.add(SHC.chave('ml', i.familia)); });
    ((full && full.produtos) || []).forEach(p => { if (p.sku) chaves.add(SHC.chaveSku(p.sku)); (p.itemIds && p.itemIds.length ? p.itemIds : [p.itemId]).forEach(id => { if (id) ids.add(id); }); });
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
    const r = SHC.alertasDe({ full, ads, itens, custos, cfg, vm, mesesLidos: lidos, hoje, conta: naConta, saude });
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
    const anom = SHC.anomalias(c, { alertas: r, posvenda: pvd, frete: frh, conferir: cnf, rateio: rat, cert, medidas: med, titulos, perguntas: perg, reputacao: rep, remessas, nfe, fatura, familias }, cfg);   // v2.8: módulos desligados não contam
    const snapAnom = Object.assign({ ts: Date.now() }, anom, { itens: anom.itens.slice(0, 200) });
    await chrome.storage.local.set({ 'shc:anomalias': snapAnom, ['shc:anomalias:' + c]: snapAnom });   // por conta também: "suas contas juntas" (SHC.dadosContas)
    const rp = await roboPromoPassada(c, cfg).catch(() => null);   // v2.9: robô de promoções (só sugere; nenhum GET a mais)
    selo(Object.assign({}, anom, { semanalNovo: !!(sem && sem.novo), promoNovo: !!(rp && rp.novo) }));
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
    const skuDe = {};
    ((an && an.itens) || []).forEach(i => { if (i && i.sku && i.itemId) skuDe[i.itemId] = i.sku; });
    // Custo como a etiqueta da Central e o painel: SKU do anúncio → anúncio (MLB) → família.
    const infos = promos.propostas.map(p => ({ sku: skuDe[p.itemId] || '', itemId: p.itemId, familia: p.familia }));
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

// ── v2.10: RETOMADA DE ONDE PAROU. A sincronização trabalha em ciclos (shc:ciclo = {id, conta, inicio, feitas:{etapa:{estado, resumo,
// inicio, fim, patch}}, retomadas, chaves, fechado}). Cada etapa concluída fica marcada com a hora; se o worker morre no meio (Chrome
// fechou, extensão recarregada), a próxima sincronização CONTINUA o ciclo: pula as etapas feitas e, dentro das longas
// (Faturamento, faturas + NF-e, vendas brutas, vendas por anúncio, afiliados, Full), não pede de novo a página/mês já lido — cada resposta
// boa fica em shc:ret:<ciclo>:<etapa>:<chave> (já reduzida ao que o Copiloto usa: nada de comprador/afiliado) e sai quando a etapa termina.
// Um ciclo vale CICLO_MS = 3 h, o mesmo ritmo da sincronização automática: continuar nunca deixa um dado mais velho do que ele ficaria
// esperando a próxima automática. Passou disso, ou a sincronização chegou ao fim → ciclo novo (tudo lido de novo).
const CICLO_MS = INTERVALO_MIN * 60e3;
const RETOMA_MAX = 3;   // retomadas automáticas por ciclo (worker que cai sempre no mesmo ponto não fica em laço)
let ciclo = null;
let filaCiclo = Promise.resolve();
const salvaCiclo = () => { const c = ciclo; return c ? (filaCiclo = filaCiclo.then(() => SHC.gravarChave('shc:ciclo', c), () => SHC.gravarChave('shc:ciclo', c))) : Promise.resolve(); };
// Resposta de uma página/mês dentro do ciclo: guardada → devolve sem pedir ao ML; senão pede (fn) e guarda a boa (nunca falha/login/nada).
// ponytail: as páginas ficam até a ETAPA terminar (a retomada refaz as contas com tudo, igual a uma leitura sem queda). No 1º Faturamento de
// conta grande são dezenas de MB temporários (unlimitedStorage); se pesar, soltar os meses antigos já gravados em fech:/vm|ml assim que lidos.
async function naCiclo(etapaId, chave, fn) {
    const c = ciclo;
    if (!c) return fn();
    const k = 'shc:ret:' + c.id + ':' + etapaId + ':' + chave, g = (await chrome.storage.local.get(k))[k];
    if (g && 'v' in g) return g.v;
    const v = await fn();
    if (v && !v.falha && !v.login && ciclo === c) {
        await chrome.storage.local.set({ [k]: { v } });
        if (c.chaves.indexOf(k) < 0) { c.chaves.push(k); await salvaCiclo(); }
    }
    return v;
}
// Tira as respostas guardadas de uma etapa (ela terminou) ou de todas (ciclo novo).
async function limpaCiclo(c, etapaId) {
    if (!c || !c.chaves || !c.chaves.length) return;
    const pre = 'shc:ret:' + c.id + ':' + (etapaId ? etapaId + ':' : ''), fora = c.chaves.filter(k => k.indexOf(pre) === 0);
    if (!fora.length) return;
    c.chaves = c.chaves.filter(k => k.indexOf(pre) !== 0);
    await chrome.storage.local.remove(fora);
}
// Campos do shc:status que cada etapa atualiza quando dá certo (guardados no ciclo: a etapa pulada na retomada não perde os dela).
const PATCH_ETAPA = {
    anuncios: an => (an && an.snap ? { conta: an.sellerId, via: an.via, anuncios: an.snap.itens.length, paginasAnuncios: an.paginas, totalAnunciosML: an.total,
        anunciosCompleto: an.completo, statusAnuncios: SHC.anunciosPorStatus(an.snap.itens) } : null),
    promos: pr => ({ familias: pr.familias, propostas: pr.propostas, paginas: pr.paginas, promosVazio: !!pr.vazio }),
    faturamento: co => ({ vendasMeses: co.meses, cobrancasLidas: co.lidas, pedidosFrete: co.pedidos, fechamentoMeses: co.fechamentoMeses, cobrancasEm: Date.now(),
        cobrancasIncompletas: co.incompletos.length ? co.incompletos : null, cobrancasNaoLidas: co.naoLidos.length ? co.naoLidos : null,
        anunciosComVendasMes: co.anunciosVendas, fretesPorTitulo: co.porTitulo, fretesPendentes: co.pendentes }),
    full: fu => ({ temFull: fu.temFull, fullProdutos: fu.produtos.length, fullEm: Date.now() }),
    ads: ad => (ad.semAba ? null : { temAds: ad.temAds, adsCampanhas: (ad.campanhas || []).length, adsAnuncios: (ad.anuncios || []).length, adsEm: Date.now() }),   // sem aba: o status do Ads anterior fica
    repasse: rp => Object.assign({ repasseConectado: !rp.semPermissao }, rp.semPermissao ? {} : { repasseEm: Date.now(), repassePaginas: rp.paginas }),
    afiliados: af => ({ temAfiliados: !!af.temAfiliados, afiliadosEm: Date.now() }),
    alertas: al => ({ alertasCriticos: al.criticos, anomalias: al.anomalias ? al.anomalias.total : null }),
    posvenda: pv => ({ posvendaEm: pv.ts }),
};
// Ciclo da sincronização que começa agora: continua o que PAROU NO MEIO (worker morto → 'interrompida', ou 'sincronizando' gravado por
// ele) — seja pela retomada automática, pelo "Tentar de novo" ou pela automática das 3 h. Sincronização que chegou ao fim (mesmo com
// alguma etapa com erro) fecha o ciclo: o próximo "Sincronizar agora" lê tudo de novo.
// Só o armazenamento (nada de pedido): o ciclo que pode continuar, ou null.
async function cicloAberto(anterior, agora) {
    const c = await SHC.lerChave('shc:ciclo');
    return c && c.id && !c.fechado && agora - (c.inicio || 0) < CICLO_MS && (anterior.estado === 'interrompida' || anterior.estado === 'sincronizando') ? c : null;
}
async function cicloNovo(agora) {
    await limpaCiclo(await SHC.lerChave('shc:ciclo'), null).catch(() => {});   // respostas guardadas de um ciclo que não vai continuar
    return { id: agora + '-' + Math.random().toString(36).slice(2, 8), conta: null, inicio: agora, feitas: {}, retomadas: 0, chaves: [] };
}

let emAndamento = null;   // no máximo 1 sincronização por vez
let stSync = null;        // status em memória da sincronização em andamento (o "Tentar agora" das vendas brutas marca o diagnóstico nele)
let aoBater = null;       // avisa iniciarSync() da 1ª batida gravada
// Texto curto do que fazer quando uma etapa falha (shc:status.etapas[id].erro).
const O_QUE_FAZER = {
    sem_sessao: 'Entre no Mercado Livre neste Chrome e sincronize de novo.',
    ml_indisponivel: 'O Mercado Livre não respondeu. Tente de novo em alguns minutos.',
    sem_login_mp: 'Entre no Mercado Pago neste Chrome e sincronize de novo.',
    ads_sem_conta: 'Abra o Mercado Ads uma vez neste Chrome e clique em Sincronizar agora.',   // v3.1: conta de anúncios não liberada
    ads_escolher_conta: 'Abra o Mercado Ads e escolha a conta de anúncios. Depois clique em Sincronizar agora.',
};
async function sincronizar(origem) {
    if (emAndamento) return emAndamento;
    emAndamento = (async () => {
        // v2.11: o histórico em segundo plano dá a vez (para antes do próximo pedido ao ML) — nunca dois leitores ao mesmo tempo.
        histParar = true;
        if (historicoEm) await historicoEm.catch(() => {});
        const anterior = await SHC.lerStatus(), agora = Date.now(), ETAPAS = SHC.SYNC_ETAPAS;
        // Etapas (ficam gravadas depois do fim): todas na fila, com o resumo da última vez em resumoAnterior.
        const etapas = {};
        const naFila = id => {
            const a = (anterior.etapas || {})[id] || {};
            etapas[id] = { estado: 'fila', feito: null, de: null, unidade: null, resumo: null, erro: null, inicio: null, fim: null, resumoAnterior: (!a.naoLida && a.resumo) || a.resumoAnterior || null,   // "Não lida…" não é leitura: guarda a última boa
                meses: a.meses || null };   // diagnóstico por mês (Vendas brutas e Faturamento): fica de uma sincronização para a outra
        };
        ETAPAS.forEach(({ id }) => naFila(id));
        // V17: sincronizando + batimento. O painel trata "sincronizando" com batimento de mais de 5 min como abandonado
        // (Chrome fechado no meio) e mostra "Tentar de novo".
        const progresso0 = k => ({ etapa: ETAPAS[k].id, indice: k + 1, total: ETAPAS.length, rotulo: ETAPAS[k].rotulo, feito: null, de: null, unidade: null,
            pct: SHC.progressoPct(k + 1, 0, 0, ETAPAS.length), inicio: agora, inicioEtapa: agora, restanteSeg: null });
        const st = Object.assign({}, anterior, { estado: 'sincronizando', sincronizando: true, batimento: agora, inicio: agora, origem, erro: null, etapas, interrompidaEm: null, retomaEm: null,
            progresso: progresso0(0) });
        // v2.10: ciclo que parou no meio (só o armazenamento, nada de pedido) → as etapas já feitas nele entram como lidas (com a hora) e a
        // barra começa na 1ª que falta, já na 1ª gravação ("Continuando de onde parou: etapa 6 de 13").
        let cic = null;
        try { cic = await cicloAberto(anterior, agora); } catch (x) { cic = null; }
        const marcaFeitas = () => {
            const feitas = ETAPAS.filter(({ id }) => cic.feitas[id]);
            feitas.forEach(({ id }) => { const f = cic.feitas[id]; Object.assign(st.etapas[id], { estado: f.estado, resumo: f.resumo, inicio: f.inicio, fim: f.fim, feito: f.feito, de: f.de, unidade: f.unidade, jaLida: true }); });
            if (!feitas.length) return;
            const k = Math.max(0, ETAPAS.findIndex(({ id }) => !cic.feitas[id]));
            st.progresso = Object.assign(progresso0(k), { continua: { feitas: feitas.length, desde: cic.inicio } });
        };
        if (cic) marcaFeitas();
        // Grava no máximo 1 vez por segundo (o painel redesenha a cada gravação); nas outras chamadas, uma chamada barata
        // à API da extensão mantém o service worker acordado. pct nunca volta para trás.
        // Gravação pulada agenda UMA gravação atrasada: a troca de etapa ("lendo" e a etapa atual) chega ao painel em até ~1 s,
        // mesmo em etapa que não chama progresso() no meio (Vendas brutas, Faturas, Alertas). O timer regrava pelo mesmo limite.
        let gravado = 0, atrasada = false, acabou = false;
        // O andamento dos custos do ERP é de outra rotina: nunca sai deste `st` velho, sempre do valor atual (custosAgora); senão a barra
        // "Importando do Omie" ficava presa quando o ERP terminava no meio de uma sincronização.
        const salvar = () => { Object.assign(st, andamentos); return emFilaStatus(() => SHC.salvarStatus(st)); };
        gravarSync = () => gravar();
        const gravar = async forca => {
            const p = st.progresso, t = Date.now();
            st.batimento = t;
            if (p) { p.pct = Math.max(p.pct || 0, SHC.progressoPct(p.indice, p.feito, p.de, p.total)); p.restanteSeg = SHC.estimaRestante(p, anterior.duracoes, t); }
            if (forca || t - gravado >= 1000) { gravado = t; await salvar(); return; }
            if (!atrasada) {
                atrasada = true;
                setTimeout(() => { atrasada = false; if (!acabou) gravar().catch(() => {}); }, Math.max(0, 1000 - (t - gravado)));
            }
            if (chrome.runtime.getPlatformInfo) await chrome.runtime.getPlatformInfo().catch(() => {});
        };
        // progresso(campos antigos do status, { feito, de, unidade } da etapa atual quando o total é conhecido)
        // conta.meses = diagnóstico de meses ({'AAAA-MM': 'ok'|…}): junta com o que a etapa já tinha (juntaMeses).
        const progresso = async (patch, conta) => {
            Object.assign(st, patch || {});
            if (conta && st.progresso) {
                const c = Object.assign({}, conta), e = st.etapas[st.progresso.etapa], meses = c.meses;
                delete c.meses;
                Object.assign(st.progresso, c); Object.assign(e, c);
                if (meses) e.meses = juntaMeses(e.meses, meses);
            }
            await gravar();
        };
        const comeca = async id => {
            const k = ETAPAS.findIndex(e => e.id === id), t = Date.now();
            Object.assign(st.etapas[id], { estado: 'lendo', inicio: t });
            Object.assign(st.progresso, { etapa: id, indice: k + 1, rotulo: ETAPAS[k].rotulo, feito: null, de: null, unidade: null, inicioEtapa: t });
            await gravar();
        };
        // v2.10: etapa concluída (ok/pulada) fica marcada no ciclo com a hora e os campos do status (patch); as respostas guardadas dela saem.
        const termina = async (id, estado, resumo, erroCod, r) => {
            const e = st.etapas[id];
            Object.assign(e, { estado, resumo: resumo || null, erro: erroCod ? (O_QUE_FAZER[erroCod] || O_QUE_FAZER.ml_indisponivel) : null, fim: Date.now() });
            if (e.de && estado === 'ok') e.feito = st.progresso.feito = e.de;   // contagem fechada (a próxima etapa já começa em seguida)
            if (cic && estado !== 'erro') {
                const patch = r && PATCH_ETAPA[id] ? PATCH_ETAPA[id](r) : null;
                if (patch) Object.assign(st, patch);
                cic.feitas[id] = { estado, resumo: e.resumo, inicio: e.inicio, fim: e.fim, feito: e.feito, de: e.de, unidade: e.unidade, patch };
                await limpaCiclo(cic, id).catch(() => {});
                await salvaCiclo();
            }
            await gravar();
        };
        await gravar(true);
        stSync = st;
        if (aoBater) { aoBater(); aoBater = null; }   // D5a: 1ª batida gravada → o clique já recebe {ok, iniciou}
        // Continuar sem ler os anúncios de novo: 1 GET confere que a sessão do ML ainda é a mesma conta (nunca mistura contas).
        // Outra conta aberta → ciclo novo, tudo na fila de novo.
        try {
            if (cic && cic.conta && cic.conta !== 'atual' && (await confereSessao(cic.conta)) === 'outra_conta') {
                cic = null;
                ETAPAS.forEach(({ id }) => naFila(id));
                st.progresso = progresso0(0);
                await gravar(true);
            }
            if (cic) { cic.chaves = cic.chaves || []; if (origem === 'retomada') cic.retomadas = (cic.retomadas || 0) + 1; }
            else cic = await cicloNovo(agora);
        } catch (x) { cic = null; }
        ciclo = cic;
        if (cic) await salvaCiclo();
        const feita = id => !!(cic && cic.feitas[id]);
        const codigo = falha => (falha === 'login' ? 'sem_sessao' : /^ads_/.test(falha) ? falha : 'ml_indisponivel');
        // Cada etapa depois dos anúncios falha sozinha: o que ela tinha gravado antes fica, e o status ganha erro<Etapa>.
        // resumo(r) = texto curto do que foi lido; r.semPermissao = etapa pulada (não é erro).
        // v2.10: etapa já feita neste ciclo não roda de novo (os campos do status dela voltam do ciclo no fim).
        const etapa = async (id, fn, resumo, erroDe) => {
            if (feita(id)) return { pulou: true };
            await comeca(id);
            let e;
            try { const r = await fn(); e = r && r.falha ? { erro: codigo(r.falha) } : { r }; } catch (x) { e = { erro: 'ml_indisponivel' }; }
            if (e.erro) await termina(id, 'erro', null, erroDe ? erroDe(e.erro) : e.erro);
            else await termina(id, e.r && (e.r.semPermissao || e.r.pulado) ? 'pulado' : 'ok', resumo(e.r || {}), null, e.r);
            return e;
        };
        const Q = SHC.qtd, mpErro = x => (x === 'sem_sessao' ? 'sem_login_mp' : x);
        let erro = null, erroPromos = null, erroCobrancas = null, erroFull = null, erroAds = null, erroFaturas = null, erroVendasBrutas = null, erroRepasse = null, erroAfiliados = null, erroSaude = null;
        let an = null, pr = null, co = null, fu = null, ad = null, rp = null, af = null, al = null, pv = null, erroPosVenda = null, fiscalCedo = null, erroVendasAnuncio = null;
        try {
            if (feita('anuncios')) an = { sellerId: cic.conta, retomada: true };   // v2.10: anúncios já lidos neste ciclo
            else {
                await comeca('anuncios');
                an = await sincronizarAnuncios(progresso);
            }
            if (an.falha) { erro = codigo(an.falha); await termina('anuncios', 'erro', null, erro); }   // 'sem_sessao' só quando o ML mandou para o login
            else {
                if (cic && !an.retomada) cic.conta = an.sellerId;
                if (!an.retomada) await termina('anuncios', 'ok', Q(an.snap ? an.snap.itens.length : 0, 'anúncio', 'anúncios'), null, an);
                const conta = an.sellerId;
                // v2.5.3 (D6): 1ª sincronização depois de instalar/atualizar, ou conta ainda sem dados fiscais → a parte fiscal começa JÁ, junto
                // com as promoções (sem o andamento: a barra é da etapa atual). A etapa 'saude' depois só usa o resultado.
                try {
                    if ((await SHC.lerChave('shc:fiscalPrimeiro')) || !(await SHC.lerChave('fiscal:' + conta))) {
                        fiscalCedo = fiscalCompartilhado(conta, null);
                        fiscalCedo.catch(() => {});
                        await chrome.storage.local.remove('shc:fiscalPrimeiro');
                    }
                } catch (x) { fiscalCedo = null; }
                // v2.11: ordem por prioridade — o que as telas usam primeiro (vendas, Fechamento, Full, Ads, pós-venda, famílias) e as etapas
                // leves antes das pesadas (promoções, fiscal, faturas + NF-e). Os meses antigos ficam para o histórico (lerHistorico).
                let e = await etapa('vendasBrutas', () => sincronizarVendasBrutas(conta, progresso), resumoVendasBrutas);   // antes das cobranças: o fechamento soma os dias
                erroVendasBrutas = e.erro || null;
                e = await etapa('faturamento', () => sincronizarCobrancas(conta, progresso, 'recentes'), resumoFaturamento);
                co = e.r || null; erroCobrancas = e.erro || null;
                e = await etapa('full', () => sincronizarFullERemessas(conta, progresso), resumoFull);
                fu = e.r || null; erroFull = e.erro || null;
                e = await etapa('ads', () => sincronizarAds(conta, progresso),
                    r => (r.semAba ? ADS_SEM_ABA : r.temAds ? Q((r.campanhas || []).length, 'campanha', 'campanhas') + ' · ' + Q((r.anuncios || []).length, 'anúncio', 'anúncios') : 'Nenhuma campanha no Mercado Ads'));
                ad = e.r || null; erroAds = e.erro || null;
                e = await etapa('posvenda', () => sincronizarPosVenda(conta), resumoPosVenda);
                pv = e.r || null; erroPosVenda = e.erro || null;
                e = await etapa('vendasAnuncio', () => sincronizarVendasAnuncio(conta, progresso, 'recentes'), resumoVendasAnuncio);   // v2.6: famílias
                erroVendasAnuncio = e.erro || null;
                e = await etapa('promos', () => sincronizarPromos(conta, progresso),   // anúncios lidos: a sincronização vale
                    r => (r.vazio ? 'Nenhuma promoção disponível' : Q(r.propostas, 'proposta', 'propostas') + ' em ' + Q(r.familias, 'produto', 'produtos')));
                pr = e.r || null; erroPromos = e.erro || null;
                // v2.9: Afiliados logo depois das promoções (1 página + poucos GETs).
                e = await etapa('afiliados', () => sincronizarAfiliados(conta, progresso), SHC.afilResumo);
                af = e.r || null; erroAfiliados = e.erro || null;
                e = await etapa('saude', async () => {
                    const cedo = fiscalCedo ? await fiscalCedo.catch(() => null) : null;
                    if (cedo && !cedo.falha) return cedo;
                    const x = ultimoFiscal && ultimoFiscal.conta === conta && ultimoFiscal.ts >= st.inicio ? ultimoFiscal.r : null;   // {acao:'fiscal_agora'} durante esta sincronização
                    if (x) return x;
                    // v2.10: lida já neste ciclo (a parte fiscal que começou cedo, antes de o worker cair) → não lê de novo.
                    const f = cic ? await SHC.lerChave('fiscal:' + conta) : null;
                    return f && f.ts >= cic.inicio ? f : fiscalCompartilhado(conta, progresso);
                }, resumoSaude);
                erroSaude = e.erro || null;
                // v2.8: + NF-e das vendas (sincronizarNfe): falha dela não derruba as faturas (o erro fica em nfe:<conta>:<mês>).
                e = await etapa('faturas', async () => {
                    const r = await sincronizarFaturas(conta, progresso);
                    let nf = null;
                    try { nf = await sincronizarNfe(conta, progresso, 'recentes'); } catch (x) { nf = null; }
                    return r && r.falha ? r : Object.assign({}, r, { nfeVendas: nf });
                }, r => Q((r.faturas || []).length, 'fatura', 'faturas') + (r.notasFiscais ? ' · ' + Q(r.notasFiscais, 'nota fiscal', 'notas fiscais') : '')
                    + (r.nfeVendas && r.nfeVendas.notas ? ' · ' + Q(r.nfeVendas.notas, 'nota de venda', 'notas de venda') : ''));
                erroFaturas = e.erro || null;
                try { await gravarRateio(conta); } catch (x) { /* rateio é derivado: sem ele a página só não mostra a conferência */ }
                e = await etapa('repasse', () => sincronizarRepasse(conta, progresso),
                    r => (r.semPermissao ? 'Mercado Pago não conectado' : r.semItens ? 'Nenhuma venda nova no Mercado Pago' : Q(r.meses, 'mês', 'meses') + ' de repasse'), mpErro);
                rp = e.r || null;
                erroRepasse = e.erro ? mpErro(e.erro) : null;   // sem permissão não é erro: "conecte para comparar"
                // v2.7: radar leve (Resumo, perguntas, reputação: 3 GETs) antes de contar as anomalias; se falhar, o anterior fica e a etapa continua.
                e = await etapa('alertas', async () => { try { await sincronizarRadar(conta, progresso); } catch (x) { /* radar é derivado */ } return atualizarAlertas(conta); },
                    r => (r.anomalias && r.anomalias.total ? SHC.qtd(r.anomalias.total, 'ponto de atenção', 'pontos de atenção') : 'Nada pede sua atenção agora'));
                al = e.r || null;
            }
        } catch (e) { erro = String((e && e.message) || e); }

        // Fim: etapa que ficou lendo (exceção) vira erro; as da fila (anúncios não lidos) viram puladas.
        const fim = Date.now();
        acabou = true; gravarSync = null; stSync = null;   // a gravação atrasada que ainda estiver na fila não regrava "sincronizando"
        ETAPAS.forEach(({ id }) => {
            const x = st.etapas[id];
            if (x.estado === 'lendo') Object.assign(x, { estado: 'erro', erro: O_QUE_FAZER.ml_indisponivel, fim });
            else if (x.estado === 'fila') Object.assign(x, { estado: 'pulado', naoLida: true, resumo: 'Não lida: os anúncios não foram lidos', fim });
        });
        // Sincronização que rodou as 12 etapas: guarda quanto cada uma levou (estimativa da próxima) e marca a primeira completa.
        // Anúncios sem leitura (erro) não conta: as outras 11 nem rodaram.
        if (!erro) {
            st.duracoes = {};
            ETAPAS.forEach(({ id }) => { const x = st.etapas[id]; st.duracoes[id] = x.inicio && x.fim ? Math.max(0, x.fim - x.inicio) : 0; });
            if (!st.primeiraCompleta) st.primeiraCompleta = fim;
        }
        st.progresso = null;
        // Com erro: os números da última leitura boa continuam no status.
        Object.assign(st, { estado: erro ? 'erro' : 'ok', sincronizando: false, batimento: Date.now(), erro, erroPromos, erroCobrancas, erroFull, erroAds,
            erroFaturas, erroVendasBrutas, erroRepasse, erroAfiliados, erroSaude, erroPosVenda, erroVendasAnuncio, fim: Date.now(), interrompidaEm: null, retomaEm: null, ultimaOk: erro ? (anterior.ultimaOk || null) : Date.now(), origem });
        // Campos de cada etapa que deu certo, lida agora ou antes neste ciclo (PATCH_ETAPA, guardados no ciclo); sem ciclo, os lidos agora.
        if (cic) ETAPAS.forEach(({ id }) => { const f = cic.feitas[id]; if (f && f.patch) Object.assign(st, f.patch); });
        else [['anuncios', an], ['promos', pr], ['faturamento', co], ['full', fu], ['ads', ad], ['repasse', rp], ['afiliados', af], ['alertas', al], ['posvenda', pv]]
            .forEach(([id, r]) => { const x = r && !r.falha && !r.retomada ? PATCH_ETAPA[id](r) : null; if (x) Object.assign(st, x); });
        // Chegou ao fim (com ou sem erro em alguma etapa): o ciclo fecha e a próxima sincronização lê tudo de novo.
        if (cic && ciclo === cic) {
            cic.fechado = true;
            await limpaCiclo(cic, null).catch(() => {});
            await salvaCiclo();
        }
        if (ciclo === cic) ciclo = null;
        // v2.11: andamento do histórico ("7 de 12 meses") no mesmo status, só com o que está gravado; a leitura vem 1 min depois (alarme).
        histFalta = false;
        if (an && an.sellerId && an.sellerId !== 'atual') {
            try { const h = await historicoConta(an.sellerId); st.historico = Object.assign(h, { lendo: false, rodadas: 0 }); histFalta = h.falta > 0; } catch (x) { /* fica o de antes */ }
        }
        await salvar();
        return st;
    })();
    try { return await emAndamento; } finally {
        emAndamento = null;
        // v2.11: os meses antigos (Faturamento, vendas por anúncio, NF-e do mês passado) vêm em segundo plano, 1 min depois (alarme
        // 'shc-historico'), sem travar a barra. O andamento ("7 de 12 meses") já fica no status agora, só com o que está gravado.
        histParar = false;
        if (histFalta) alarmeHist(true, 1);
        // Custos do ERP junto: no botão Sincronizar (no máximo a cada 10 min) e na automática (a cada 6 h). Não segura a sincronização.
        const iv = origem === 'manual' ? 10 * 60e3 : 6 * 3600e3;
        sincronizarCustos('tiny', iv).catch(() => {}).then(() => sincronizarCustos('omie', iv).catch(() => {})).then(() => sincronizarCustos('bling', iv).catch(() => {}));
    }
}

// ── v2.11: HISTÓRICO EM SEGUNDO PLANO. A sincronização lê só o que as telas usam agora (mês atual e anterior); os 11 meses mais antigos do
// Faturamento e das vendas por anúncio e a 1ª leitura da NF-e do mês passado vêm depois, aqui, sem travar a barra da sincronização.
// Começa 1 min depois de cada sincronização (agendarHistorico); o alarme 'shc-historico' (a cada HIST_ALARME_MIN) só existe enquanto falta mês: se o
// worker morrer, ela continua de onde parou (o que já foi gravado por mês não é lido de novo). A sincronização que começa pede a vez
// (histParar): o histórico para antes do próximo pedido ao ML e o mês pela metade fica para a próxima vez (nunca vira zero).
// Andamento em shc:status.historico = { feitos, de (os 12 meses antes do atual), falta, lendo, ts }: "Histórico: 7 de 12 meses lidos".
const HIST_ALARME_MIN = 5, HIST_RODADAS_MAX = 3;
let historicoEm = null, histParar = false, histFalta = false;
// Só o armazenamento: feitos = meses antes do atual com o Faturamento lido (ou cortado no teto); falta = o que ainda há para tentar (meses do
// Faturamento, meses das vendas por anúncio do 2º para trás, e a NF-e do mês passado se nunca foi tentada). Até HIST_RODADAS_MAX rodadas por
// sincronização: o que continuar falhando fica para depois da próxima (nunca fica martelando o ML a cada 5 min).
async function historicoConta(conta) {
    const atual = SHC.hoje().slice(0, 7), meses = SHC.janelasCobranca(SHC.hoje(), true).map(j => j.mes).filter(m => m < atual);
    const cob = (await SHC.lerChave('ml:cobrancas:' + conta)) || {}, fat = new Set([...(cob.mesesLidos || []), ...(cob.incompletos || [])]);
    const va = ((await SHC.lerChave('vbAnuncio:' + conta)) || {}).meses || {};
    // v3.1: o mês anterior e o atual que a sincronização nunca conseguiu ler também contam (o histórico tenta de novo em 5 min).
    const vaOk = m => (m === mesAntes(atual, 1) ? !!va[m] : fechadoLidoVA(va, m));
    const feitos = meses.filter(m => fat.has(m)).length, vaFalta = meses.filter(m => !vaOk(m)).length + (va[atual] ? 0 : 1);
    const nfe = await SHC.lerChave('nfe:' + conta + ':' + mesAntes(atual, 1));
    // v3.1: meses a reler 1 vez (frete de devoluções, migrarFreteDevolucao); os dos últimos 40 dias ficam com a sincronização.
    const recentes = new Set(SHC.janelasCobranca(SHC.hoje(), false).map(j => j.mes)), releer = (cob.releer || []).filter(m => meses.indexOf(m) >= 0 && !recentes.has(m)).length;
    return { feitos, de: meses.length, falta: meses.length - feitos + vaFalta + (nfe ? 0 : 1) + releer, ts: Date.now() };   // NF-e já tentada (mesmo com erro) fica para a sincronização
}
// diag = {etapa: {'AAAA-MM': 'ok'|…}} lido no histórico: entra no diagnóstico por mês da etapa (o "ver detalhes" mostra o mês que não respondeu).
const gravaHistorico = (h, diag) => emFilaStatus(async () => {
    const st = await SHC.lerStatus();
    st.historico = h;
    Object.keys(diag || {}).forEach(id => { const e = (st.etapas || (st.etapas = {}))[id] || (st.etapas[id] = {}); e.meses = juntaMeses(e.meses, diag[id]); });
    await SHC.salvarStatus(st);
});
// v3.1: alertas recalculados FORA da sincronização (o histórico trouxe meses novos: parados, família) → o número do status acompanha o do ícone.
async function atualizaAlertasStatus(conta) {
    const al = await atualizarAlertas(conta);
    await emFilaStatus(async () => { const st = await SHC.lerStatus(); Object.assign(st, PATCH_ETAPA.alertas(al)); await SHC.salvarStatus(st); });
}
const alarmeHist = (liga, emMin) => { try { if (liga) chrome.alarms.create('shc-historico', { delayInMinutes: emMin || HIST_ALARME_MIN, periodInMinutes: HIST_ALARME_MIN }); else if (chrome.alarms.clear) chrome.alarms.clear('shc-historico'); } catch (e) { /* sem alarme: começa de novo no fim da próxima sincronização */ } };
function lerHistorico() {
    if (emAndamento) return Promise.resolve(null);   // a sincronização chama de novo quando terminar
    if (historicoEm) return historicoEm;
    historicoEm = (async () => {
        const conta = await SHC.contaAtual();
        if (!conta || conta === 'atual') return null;
        const rodadas = (((await SHC.lerStatus()).historico) || {}).rodadas || 0;
        let h = await historicoConta(conta);
        if (!h.falta || rodadas >= HIST_RODADAS_MAX) { alarmeHist(false); await gravaHistorico(Object.assign(h, { lendo: false, rodadas })); return h; }
        // 1 GET: a sessão do ML aberta agora ainda é desta conta (nunca grava o histórico de uma conta na outra).
        // Sessão caída (login/indisponível/outra conta): conta a rodada e desliga o alarme no teto (antes: 1 GET a cada 5 min sem fim).
        if (await confereSessao(conta)) { await gravaHistorico(Object.assign(h, { lendo: false, rodadas: rodadas + 1 })); if (rodadas + 1 >= HIST_RODADAS_MAX) alarmeHist(false); return h; }
        alarmeHist(true);
        await gravaHistorico(Object.assign(h, { lendo: true, rodadas }));
        // Andamento: recalcula "N de 12" no máximo a cada 3 s; nas outras chamadas só mantém o worker acordado. O diagnóstico por mês
        // (conta.meses) vai para a etapa correspondente do status.
        let ultima = Date.now(), etapaHist = 'faturamento';
        const diag = {};
        const anda = async (patch, conta_) => {
            if (conta_ && conta_.meses) diag[etapaHist] = juntaMeses(diag[etapaHist], conta_.meses);
            if (Date.now() - ultima < 3000 || histParar) return bateVivo(null);
            ultima = Date.now();
            await gravaHistorico(Object.assign(await historicoConta(conta), { lendo: true, rodadas }), diag);
        };
        const lido = {};
        try {
            lido.cobrancas = await sincronizarCobrancas(conta, anda, 'historico');
            etapaHist = 'vendasAnuncio';
            if (!histParar) lido.vendasAnuncio = await sincronizarVendasAnuncio(conta, anda, 'historico');
            etapaHist = 'faturas';
            if (!histParar) lido.nfe = await sincronizarNfe(conta, anda, 'historico');
            if (!histParar) await gravarRateio(conta).catch(() => {});   // meses novos no rateio das faturas
        } catch (e) { lido.erro = String((e && e.message) || e); /* o que foi gravado por mês fica; o resto na próxima vez */ }
        h = await historicoConta(conta);
        h.lido = lido;
        await gravaHistorico(Object.assign(h, { lendo: false, rodadas: histParar ? rodadas : rodadas + 1 }), diag);
        if (!histParar) { if (!h.falta || rodadas + 1 >= HIST_RODADAS_MAX) alarmeHist(false); if (!emAndamento) await atualizaAlertasStatus(conta).catch(() => {}); }   // mês que não respondeu: mais 1 rodada em 5 min (até 3); depois só na próxima sincronização
        return h;
    })().finally(() => { historicoEm = null; histParar = false; });
    return historicoEm;
}

// ── Custos do ERP pelo fundo (Tiny: token; Omie: app_key + app_secret), com o que o seller já colou no painel (erp:tiny / erp:omie).
// Só leitura no ERP; custo digitado à mão nunca é trocado (SHC.tinyGravar vale para os dois: origem 'erp'). Andamento em
// shc:status.custosProgresso = {erp, feito, de, unidade:'páginas'} (null ao terminar); resumo final ganha faltam = SKUs dos seus anúncios
// que continuam sem custo. → {ok, resumo, atualizados, semCusto, mantidos, faltam…} | {semToken} | {semPermissao} | {recente} | {ok:false, msg}
const ERPS = {
    tiny: { chave: () => SHC.TINY_CHAVE, origem: () => SHC.TINY_ORIGEM, cred: t => (t && t.token ? t.token : null), nome: 'Tiny',
        puxar: (c, o) => SHC.tinyPuxar(c, o), resumo: r => SHC.tinyResumo(r), mesma: (a, b) => a === b },
    omie: { chave: () => SHC.OMIE_CHAVE, origem: () => SHC.OMIE_ORIGEM, cred: t => (t && t.appKey && t.appSecret ? { appKey: t.appKey, appSecret: t.appSecret } : null), nome: 'Omie',
        puxar: (c, o) => SHC.omiePuxar(c, o), resumo: r => SHC.omieResumo(r), mesma: (a, b) => !!a && !!b && a.appKey === b.appKey && a.appSecret === b.appSecret },
    // Bling (v3.1, bling.js): OAuth do aplicativo do próprio seller. Tokens renovados no meio da leitura vão logo para erp:bling (salvarBling).
    bling: { chave: () => SHC.BLING_CHAVE, origem: () => SHC.BLING_ORIGENS, cred: t => (t && t.clientId && t.clientSecret && t.refresh ? t : null), nome: 'Bling',
        puxar: (c, o) => SHC.blingPuxar(c, Object.assign({ salvar: tk => salvarBling(c, tk) }, o)), resumo: r => SHC.blingResumo(r),
        mesma: (a, b) => !!a && !!b && a.clientId === b.clientId && a.clientSecret === b.clientSecret },
};
// Grava tokens novos do Bling só se o seller não desconectou/trocou de aplicativo no meio. tk = null → apaga os tokens (refresh vencido: "Conecte de novo").
async function salvarBling(cred, tk) {
    const agora = await SHC.lerChave(SHC.BLING_CHAVE);
    if (!agora || agora.clientId !== cred.clientId || agora.clientSecret !== cred.clientSecret) return;
    const x = Object.assign({}, agora, tk || { reconectar: true });
    if (!tk) ['access', 'refresh', 'expira', 'renovado'].forEach(k => delete x[k]); else delete x.reconectar;
    await SHC.gravarChave(SHC.BLING_CHAVE, x);
}
// {acao:'bling_conectar', code}: o painel fez o launchWebAuthFlow (state conferido lá) e já guardou Client ID/Secret; aqui o code vira tokens
// (só em erp:bling) e os custos são importados na hora. → a resposta de sincronizarCustos('bling') | {ok:false, msg}.
async function conectarBling(code) {
    const t = await SHC.lerChave(SHC.BLING_CHAVE);
    if (!t || !t.clientId || !t.clientSecret) return { ok: false, erp: 'bling', msg: 'Cole o Client ID e o Client Secret do seu aplicativo do Bling.' };
    try {
        const tk = await SHC.blingTrocarCodigo(t, code, { fetch: (u, i) => fetch(u, comTempo(i)) });
        await salvarBling(t, tk);
    } catch (e) { return { ok: false, erp: 'bling', erro: (e && e.erro) || 'outro', msg: (e && e.msg) || 'Não consegui falar com o Bling. Tente de novo.' }; }
    return sincronizarCustos('bling', 0);
}
// SKUs dos anúncios da conta ainda sem custo (depois da importação) → número. null sem retrato.
async function skusSemCusto() {
    const itens = ((await SHC.lerAnuncios()) || {}).itens || [];
    if (!itens.length) return null;
    const chaves = [...new Set(itens.map(i => i.sku && SHC.chaveSku(i.sku)).filter(Boolean))];
    const c = chaves.length ? await chrome.storage.local.get(chaves) : {};
    return chaves.filter(k => !(SHC.num((c[k] || {}).custo) > 0)).length;
}
// Gravações do status (sincronização e andamento dos custos) uma de cada vez: ler-mudar-gravar de uma nunca apaga o que a outra gravou.
let filaStatus = Promise.resolve();
const emFilaStatus = fn => (filaStatus = filaStatus.then(fn, fn));
// Andamento atual dos custos (o mesmo service worker roda as duas rotinas). Com sincronização em andamento, quem grava é ela (≤1 s, com o
// resto do status); fora dela, ler-mudar-gravar na fila. Worker reiniciado no meio de uma importação: a próxima gravação zera o andamento.
// v2.5: o mesmo vale para a rodada lenta de fotos e visitas (saudeProgresso).
const andamentos = { custosProgresso: null, saudeProgresso: null };
let gravarSync = null;   // gravarSync: a gravação (≤1 s) da sincronização em andamento
function andamento(campo, p) {
    andamentos[campo] = p;
    if (gravarSync) return gravarSync();
    return emFilaStatus(async () => { const st = await SHC.lerStatus(); st[campo] = p; await SHC.salvarStatus(st); });
}
const custosProgresso = p => andamento('custosProgresso', p);
// Service worker (re)começando: nenhuma rotina está rodando nele ainda → andamento gravado por um worker que morreu no meio é velho.
emFilaStatus(async () => {
    const st = await SHC.lerStatus();
    if (!st.saudeProgresso && !st.custosProgresso) return;
    Object.assign(st, { saudeProgresso: null, custosProgresso: null });
    await SHC.salvarStatus(st);
}).catch(() => {});
// v2.5.3 (D5b): e uma sincronização que ficou "sincronizando" num worker que morreu vira 'interrompida' (e é retomada 1 vez).
retomarInterrompida().catch(() => {});
let custosAndando = null;
function sincronizarCustos(erp, intervaloMs) {
    const E = ERPS[erp] || ERPS.tiny;
    // Outro ERP lendo agora: espera ele acabar e então lê ESTE (a resposta é sempre do ERP pedido, nunca a do outro).
    if (custosAndando) return custosAndando.catch(() => {}).then(() => sincronizarCustos(erp, intervaloMs));
    custosAndando = (async () => {
        const t = await SHC.lerChave(E.chave()), cred = E.cred(t);
        if (!cred) return { semToken: true, erp };
        let pode = false;
        try { pode = !!(chrome.permissions && await chrome.permissions.contains({ origins: [].concat(E.origem()) })); } catch (e) { /* sem permissão */ }
        if (!pode) return { semPermissao: true, erp };
        if (intervaloMs && t.ultima && Date.now() - (t.ultima.ts || 0) < intervaloMs) return { recente: true, erp, ultima: t.ultima };
        try {
            await custosProgresso({ erp, feito: 0, de: null, unidade: 'páginas' });
            const produtos = await E.puxar(cred, { fetch: (u, i) => fetch(u, comTempo(i)), espera, progresso: (pg, pgs) => { custosProgresso({ erp, feito: pg, de: pgs, unidade: 'páginas' }).catch(() => {}); } });
            const r = await SHC.tinyGravar(produtos, erp);   // a tabela mostra de qual ERP veio
            r.faltam = await skusSemCusto();
            const agora = await SHC.lerChave(E.chave());   // desconectou no meio: não volta a guardar a credencial
            if (E.mesma(E.cred(agora), cred)) await SHC.gravarChave(E.chave(), Object.assign({}, agora, { ultima: Object.assign({ ts: Date.now() }, r) }));
            if (r.atualizados) await atualizarAlertas().catch(() => {});
            return Object.assign({ ok: true, erp, resumo: E.resumo(r) }, r);
        } catch (e) {
            if (erp === 'bling' && e && e.erro === 'reconectar') await salvarBling(cred, null).catch(() => {});   // refresh vencido: some o token, o painel pede "Conectar de novo"
            return { ok: false, erp, erro: (e && e.erro) || 'outro', msg: (e && e.msg) || 'Não consegui falar com o ' + E.nome + '. Tente de novo em alguns minutos.' };
        }
        finally { await custosProgresso(null).catch(() => {}); }
    })();
    return custosAndando.finally(() => { custosAndando = null; });
}

// ── v2.5: Saúde dos anúncios — etapa 'saude' da sincronização (mapeado ao vivo em 25/09/2026). Só GET.
// Avisos da lista (/anuncios/api/tasks) + as páginas do filtro WITHOUT_FISCAL_DATA (30 por página, inclui pausados) até o total.
// → fiscal:<conta> = { ts, total, itens:[MLB], familias:[familyId], completo, tarefas:[{id, qtd, titulo, texto, link}] }. Falhou → o anterior fica
// (erroSaude). total = linhas do ML (família fechada é 1 linha sem MLB → vai em familias); completo = leu todas as linhas.
const lerPaginaFiscal = r => Object.assign(SHC.mlPaginaAnuncios(r), SHC.mlLinhasDaPagina(r));
async function sincronizarSaude(sellerId, progresso) {
    // v2.11: cada resposta fica guardada no ciclo (naCiclo): a parte fiscal que começa cedo não é relida se o worker cair no meio.
    const t = await naCiclo('saude', 'tasks', () => buscarJson(BASE + '/anuncios/api/tasks')), tarefas = t && t.json ? SHC.mlTarefasAnuncios(t.json) : null;
    if (!tarefas) return { falha: t && t.login ? 'login' : 'indisponivel' };
    let total = SHC.mlSemFiscal(tarefas), linhas = 0;
    const itens = [], familias = [], vistos = new Set();
    for (let n = 1; total > 0 && n <= PAGINAS_ANUNCIOS_MAX; n++) {
        if (n > 1) await espera(PAUSA_MS);
        // Página 1 sem linha nenhuma pode ser tela intermediária: tenta a aba (como sincronizarAnuncios).
        const pag = await naCiclo('saude', 'fiscal|' + n, () => lerPaginaML(BASE + '/anuncios?filters=WITHOUT_FISCAL_DATA&page=' + n, 'ler_pagina_anuncios', lerPaginaFiscal,
            n === 1 ? d => !(d.itens || []).length && !(d.familias || []).length : null));
        if (pag.falha) { if (n === 1) return { falha: pag.falha }; break; }
        const d = pag.dados || {};
        if (n === 1 && typeof d.total === 'number') total = d.total;
        const novos = (d.itens || []).map(i => i && i.itemId).filter(id => id && !vistos.has(id)), novasF = (d.familias || []).filter(f => !vistos.has('F' + f));
        if (!novos.length && !novasF.length) break;   // passou da última página (ou o ML repetiu)
        novos.forEach(id => { vistos.add(id); itens.push(id); });
        novasF.forEach(f => { vistos.add('F' + f); familias.push(f); });
        linhas += typeof d.linhas === 'number' ? d.linhas : novos.length;   // pela aba só vêm os MLB
        await progresso({}, { feito: n, de: Math.ceil(total / 30), unidade: 'páginas' });
        if (linhas >= total) break;
    }
    // O ML diz que há anúncios sem dados fiscais, mas nenhuma linha veio: não apaga a lista boa anterior.
    if (total > 0 && !itens.length && !familias.length) return { falha: 'indisponivel' };
    const completo = linhas >= total;
    if (!completo) {   // leitura pela metade: junta com a anterior em vez de substituir (o resto vem na próxima sincronização)
        const ant = (await SHC.lerChave('fiscal:' + sellerId)) || {};
        (ant.itens || []).forEach(id => { if (!vistos.has(id)) { vistos.add(id); itens.push(id); } });
        (ant.familias || []).forEach(f => { if (!vistos.has('F' + f)) { vistos.add('F' + f); familias.push(f); } });
    }
    const snap = { ts: Date.now(), total, itens, familias, completo, tarefas };
    await SHC.gravarChave('fiscal:' + sellerId, snap);
    return snap;
}
const resumoSaude = r => (r.total > 0 ? SHC.qtd(r.total, 'anúncio sem dados fiscais', 'anúncios sem dados fiscais') : 'Todos com dados fiscais');

// ── v2.5.3 (D6): parte fiscal compartilhada — a etapa 'saude', o começo da 1ª sincronização e {acao:'fiscal_agora'} usam a MESMA leitura:
// pedida de novo enquanto uma está no ar, recebe a mesma promessa (nunca duas leituras juntas). ultimoFiscal = a última que deu certo. ──
let fiscalEmCurso = null, ultimoFiscal = null;
function fiscalCompartilhado(conta, progresso) {
    if (fiscalEmCurso && fiscalEmCurso.conta === conta) return fiscalEmCurso.p;
    const p = sincronizarSaude(conta, progresso || (async () => {})).then(r => {
        if (r && !r.falha) ultimoFiscal = { conta, ts: Date.now(), r };
        return r;
    }).finally(() => { if (fiscalEmCurso && fiscalEmCurso.p === p) fiscalEmCurso = null; });
    fiscalEmCurso = { conta, p };
    return p;
}
// {acao:'fiscal_agora'} → { ok:true, fiscal (fiscal:<conta>) } | { ok:false, motivo:'sem_conta'|'sem_sessao'|'ml_indisponivel', fiscal (o anterior, se houver) }
// Leitura avulsa (fora da sincronização) grava na conta da ÚLTIMA sincronização (ml:conta). Se o ML aberto agora for outra conta, gravaria os
// dados dela na errada. 1 GET da 1ª página de Anúncios diz a conta da sessão. → '' (mesma conta, ou a página não diz) | 'outra_conta' | 'login' | 'indisponivel'.
async function confereSessao(conta) {
    const b = await buscarHtml(BASE + '/anuncios/lista');
    if (!b) return 'indisponivel';
    if (b.login) return 'login';
    const c = SHC.mlContaDoEstado(SHC.mlExtraiEstado(b.html) || {}), id = c && c.sellerId;
    return id && String(id) !== String(conta) ? 'outra_conta' : '';
}
async function fiscalAgora() {
    const conta = await SHC.contaAtual();
    if (conta === 'atual') return { ok: false, motivo: 'sem_conta', fiscal: null };
    const sessao = await confereSessao(conta);
    if (sessao === 'login' || sessao === 'outra_conta') return { ok: false, motivo: sessao === 'login' ? 'sem_sessao' : 'outra_conta', fiscal: await SHC.lerChave('fiscal:' + conta) };
    let r;
    try { r = await fiscalCompartilhado(conta, null); } catch (e) { r = { falha: 'indisponivel' }; }
    if (r && r.falha) return { ok: false, motivo: r.falha === 'login' ? 'sem_sessao' : 'ml_indisponivel', fiscal: await SHC.lerChave('fiscal:' + conta) };
    if (!emAndamento) atualizarAlertas(conta).catch(() => {});   // com sincronização rodando, a etapa Alertas dela recalcula
    return { ok: true, fiscal: r };
}

// ── v2.5.3 (D3): pós-venda — 1 GET da página (pesada: 1 vez por sincronização) → posvenda:<conta> = {ts, reclamacoes, mensagens, devolucoes,
// v2.9: casos?:[{titulo, valor, unidades, motivo, afetouReputacao, situacao}], paginas?, casosTs?}.
// Falhou → o anterior fica (erroPosVenda). Só os totais das abas; nada do comprador. ──
async function sincronizarPosVenda(sellerId) {
    const b = await buscarHtml(SHC.POSVENDA_URL);
    if (!b || b.login) return { falha: b && b.login ? 'login' : 'indisponivel' };
    const est = SHC.mlExtraiEstado(b.html), r = SHC.mlPosVendaDoEstado(est);
    if (!r) return { falha: 'indisponivel' };   // tela mudada: não afirma "nada pendente"
    // v2.9: reclamações da lista (mesma página, nenhum GET a mais). O nº do pedido e o id da reclamação não são guardados. Sem a lista agora → fica a da leitura anterior.
    const fl = SHC.posvendaReclamacoesDoFlox(est);
    if (fl && fl.lista) Object.assign(r, { casos: fl.casos.map(c => { const x = Object.assign({}, c); delete x.pedido; delete x.claimId; return x; }), paginas: fl.paginas, casosTs: r.ts });
    else { const ant = await SHC.lerChave('posvenda:' + sellerId); if (ant && Array.isArray(ant.casos)) Object.assign(r, { casos: ant.casos, paginas: ant.paginas || null, casosTs: ant.casosTs || ant.ts }); }
    await SHC.gravarChave('posvenda:' + sellerId, r);
    return r;
}
function resumoPosVenda(r) {
    const p = [];
    if (r.reclamacoes > 0) p.push(SHC.qtd(r.reclamacoes, 'reclamação ou mediação', 'reclamações ou mediações'));
    if (r.mensagens > 0) p.push(SHC.qtd(r.mensagens, 'mensagem', 'mensagens'));
    if (r.devolucoes > 0) p.push(SHC.qtd(r.devolucoes, 'devolução', 'devoluções'));
    return (p.length ? p.join(' · ') + ' em aberto' : 'Nada pendente no pós-venda') + (Array.isArray(r.casos) && r.casosTs === r.ts ? ' · ' + SHC.qtd(r.casos.length, 'reclamação lida', 'reclamações lidas') : '');
}

// ── v2.5.3 (D5): sincronização que nunca trava ──
// (a) {acao:'sincronizar'} responde assim que a 1ª batida é gravada (até ~1 s): {ok:true, iniciou:true} | {ok:true, iniciou:false, emCurso:true} | {ok:false, motivo:'erro'}.
async function iniciarSync(origem) {
    if (emAndamento) return { ok: true, iniciou: false, emCurso: true };
    const batida = new Promise(r => { aoBater = r; });
    const fim = sincronizar(origem);
    fim.catch(() => {});
    const r = await Promise.race([batida.then(() => 'ok'), fim.then(() => 'ok', () => 'erro'), espera(1000).then(() => 'ok')]);
    return r === 'erro' ? { ok: false, motivo: 'erro' } : { ok: true, iniciou: true };
}
// (b) Service worker (re)começando: 'sincronizando' gravado sem sincronização rodando NESTE worker é de um worker que morreu (extensão
// recarregada, Chrome fechado) — só existe um worker por vez e só ele grava 'sincronizando'. v2.10: marca 'interrompida' e CONTINUA na hora
// (sincronizar('retomada') pula as etapas e páginas já lidas no ciclo), sem os 60 s + 1 min de alarme de antes. Até RETOMA_MAX retomadas
// por ciclo; passou disso, espera o "Tentar de novo" (ou a automática). 'shc-orfa'/'shc-retoma' de versões antigas caem aqui/em sincronizar.
function retomarInterrompida() {
    return emFilaStatus(async () => {
        if (emAndamento) return;
        const st = await SHC.lerStatus();
        if (!(st.estado === 'sincronizando' || st.sincronizando === true)) return;
        const c = await SHC.lerChave('shc:ciclo'), fim = Date.now();
        const retoma = !(c && !c.fechado && (c.retomadas || 0) >= RETOMA_MAX);
        Object.keys(st.etapas || {}).forEach(id => {
            const x = st.etapas[id];
            if (x && x.estado === 'lendo') Object.assign(x, { estado: 'erro', erro: 'A leitura parou no meio (a extensão foi recarregada ou o Chrome fechou). ' + (retoma ? 'Continuo de onde parou.' : 'Clique em Tentar de novo: continuo de onde parou.'), fim });
            else if (x && x.estado === 'fila') Object.assign(x, { estado: 'pulado', naoLida: true, resumo: 'Não lida: a leitura parou no meio', fim });
        });
        Object.assign(st, { estado: 'interrompida', sincronizando: false, progresso: null, fim, interrompidaEm: fim, retomaEm: retoma ? fim : null });
        await SHC.salvarStatus(st);
        // Fora da fila do status (a sincronização grava por ela): começa depois que esta gravação sair.
        if (retoma) setTimeout(() => { sincronizar('retomada').catch(() => {}); }, 0);
    });
}

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
async function gravarCertificado(msg) {
    // Faturador aberto e sem o aviso do certificado (renovado): {ok:true} tira o alerta; uma remessa do Full mais nova ainda pode marcar vencido.
    const c = msg && msg.semAviso === true ? { ok: true, ts: Date.now(), fonte: 'faturador' } : certDaMsg(msg || {});
    if (!c) return { ok: false, motivo: 'texto' };
    const conta = await SHC.contaAtual();
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
//   sugestoes:[{itemId, motivo, novaOrdem, ts}], ultimaPassada:'AAAA-MM-DD' }. O JWT da tela nunca é guardado.
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
            const d = SHC.roboDecide({ item, fotos: f, radar, cfg, historico: ((await SHC.lerChave(k)) || {}).historico || [], agora: Date.now() });
            if (d.registrar) await roboRegistra(conta, { ts: Date.now(), itemId: item.itemId, antes: d.registrar.antes, depois: d.registrar.depois, motivo: d.motivo, visitas7Antes: radar.ult7, resultado: 'manual' });
            if (d.acao !== 'girar') continue;
            if (!grava) { sugestoes.push({ itemId: item.itemId, motivo: d.motivo, novaOrdem: d.novaOrdem, ts: Date.now() }); continue; }
            if (feitos.length) await espera(ROBO_PAUSA_MS);
            feitos.push(await roboExecuta(conta, item.itemId, d.novaOrdem, d.motivo, { esperado: f.ids, visitas7Antes: radar.ult7 }));
        }
        await mudaChave(k, r => { r.sugestoes = sugestoes; r.ultimaPassada = hoje; });
        return { ok: true, sugestoes: sugestoes.length, feitos, semFotos };
    })();
    try { return await roboEmCurso; } finally { roboEmCurso = null; }
}
Object.assign(SHC, { roboExecuta, roboDesfazer, roboPassada, rodadaSaude });   // para os testes

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

// ── v2.7: resumo da semana para o WhatsApp. Gera o TEXTO (SHC.resumoSemanal) com o que já está guardado (nenhum GET) → resumo:<conta>:semanal =
// {ts, semana, texto, waLink, novo, origem}. O alarme de segunda 8h só marca novo:true (o ícone mostra "•"); quem envia é o seller, pelo link wa.me sem número. ──
async function gerarResumoSemanal(conta, origem) {
    if (!conta || conta === 'atual') return { ok: false, motivo: 'sem_conta' };
    const hoje = SHC.hoje(), mes = hoje.slice(0, 7);
    const [vb, va, cat, an, cfg, anom, perg, rep, cert, rem, remDet, contasMl] = await Promise.all([SHC.lerVendasBrutas(conta), SHC.lerChave('vbAnuncio:' + conta), SHC.lerChave('cat:' + conta), SHC.lerAnuncios(conta),
        SHC.lerCfg(), SHC.lerChave('shc:anomalias:' + conta), SHC.lerChave('perguntas:' + conta), SHC.lerChave('reputacao:' + conta), SHC.lerChave('cert:' + conta), SHC.lerChave('ml:full:remessas:' + conta), SHC.lerChave('remessas:' + conta + ':detalhe'), SHC.lerChave('ml:contas')]);
    // Lucro estimado e SKUs subindo/caindo no mês: a MESMA conta da aba Famílias (SHC.familias), com os custos por SKU/anúncio já guardados.
    let lucro = null, skus = null;
    try {
        const itens = (an && an.itens) || [], chaves = new Set();
        itens.forEach(i => { if (i && i.sku) chaves.add(SHC.chaveSku(i.sku)); if (i && i.itemId) chaves.add(SHC.chave('ml', i.itemId)); if (i && i.familia) chaves.add(SHC.chave('ml', i.familia)); });
        chaves.delete('');
        const custos = chaves.size ? await SHC.lerCustos([...chaves]) : {};
        const fam = SHC.familias(va, cat, an, custos, mes, { cfg, hoje });
        if (fam.lido) {
            const com = fam.filter(f => typeof f.lucro === 'number');
            if (com.length) {
                const total = fam.reduce((s, f) => s + (f.bruto || 0), 0), coberto = com.reduce((s, f) => s + (f.bruto || 0), 0);
                lucro = { valor: SHC.r2(com.reduce((s, f) => s + f.lucro, 0)), parcial: com.length < fam.length || fam.some(f => f.lucroParcial), cobertoPct: total > 0 ? coberto / total * 100 : null };
            }
            const todos = fam.flatMap(f => f.skus || []).filter(s => s && typeof s.variacaoPct === 'number' && s.brutoAnt > 0);
            skus = { subindo: todos.filter(s => s.variacaoPct > 0).sort((a, b) => b.variacaoPct - a.variacaoPct).slice(0, 3), caindo: todos.filter(s => s.variacaoPct < 0).sort((a, b) => a.variacaoPct - b.variacaoPct).slice(0, 3) };
        }
    } catch (e) { lucro = null; skus = null; }
    const r = SHC.resumoSemanal(conta, { nome: SHC.nomeConta(conta, cfg, contasMl), vb, lucro, skus, anomalias: anom, perguntas: perg, reputacao: rep, cert,
        remessas: rem ? SHC.remessasResumo(rem, remDet, mes, hoje) : null }, hoje);
    const ant = await SHC.lerChave('resumo:' + conta + ':semanal');
    const snap = { ts: Date.now(), semana: r.semana, texto: r.texto, waLink: r.waLink, vendas: r.vendas, novo: origem === 'alarme' ? true : !!(ant && ant.novo), origem: origem || 'pedido' };
    await SHC.gravarChave('resumo:' + conta + ':semanal', snap);
    if (origem === 'alarme') { const a = await SHC.lerAnomalias(); if (!a || String(a.conta) === String(conta)) selo(Object.assign({}, a || { total: 0 }, { semanalNovo: true })); }
    return { ok: true, resumo: snap };
}

// A aba aberta na Central de promoções manda o que está na tela (mais fresco que a última sincronização). Mesma fila das gravações.
async function juntarPagina(conta, dados) {
    const familias = Array.isArray(dados.familias) ? dados.familias : [], propostas = Array.isArray(dados.propostas) ? dados.propostas : [];
    await emFila(async () => {
        const snap = (await SHC.lerPromos(conta)) || { ts: Date.now(), paginas: 0, familias: [], propostas: [] };
        const chaves = new Set(familias.map(f => f.chave));
        snap.familias = snap.familias.filter(f => !chaves.has(f.chave)).concat(familias);
        snap.propostas = snap.propostas.filter(p => !chaves.has(p.familia)).concat(propostas);
        snap.ts = Date.now();
        if (snap.familias.length) delete snap.vazio;
        await SHC.salvarPromos(conta, snap);
    });
}

// A aba na lista de Anúncios manda a página que está na tela: entra no retrato da conta dela (já conferida).
async function juntarAnuncios(conta, itens) {
    const lote = itens.slice(0, 500);
    const snap = await emFila(async () => {
        const antes = await SHC.lerAnuncios(conta);
        const s = SHC.mesclaAnuncios(antes, lote);
        if (SHC.retratoMudou(antes, s)) await SHC.salvarAnuncios(conta, s);   // nada novo: não regrava (nem avisa as abas)
        return s;
    });
    await emFila(() => gravarFretes(lote));
    return snap.itens.length;
}

// v3.1 Agenda do Canal ({acao:'canal_ler_anuncios', itemIds}): lê só os anúncios que faltam no retrato, com a MESMA leitura da lista de
// Anúncios da sincronização (lerPaginaML + SHC.mlPaginaAnuncios), buscando pelo código. Só GET. Visto ao vivo em 29/09/2026: /anuncios/lista
// desvia (302) para /anuncios; /anuncios?search=MLB… traz o anúncio. Só vale a linha com o mesmo código, e nunca junta página de outra conta
// (dono diferente da conta aberta no Copiloto; página sem dono = a sessão deste Chrome, como em confereSessao).
// → { ok:true, lidos:[MLB…] } | { ok:false, motivo:'login'|'outra_conta'|'indisponivel', lidos:[] }
async function lerAnunciosPorId(ids) {
    const conta = await SHC.contaAtual(), achados = [];
    const alvo = [...new Set((ids || []).map(String).filter(i => /^MLB\d{6,14}$/.test(i)))].slice(0, 20);
    let falhas = 0, login = false, outra = false;
    for (const id of alvo) {
        const pag = await lerPaginaML(BASE + '/anuncios?search=' + id, 'ler_pagina_anuncios', SHC.mlPaginaAnuncios, null);
        if (pag.falha) { falhas++; login = login || pag.falha === 'login'; continue; }
        const d = pag.dados || {}, dono = d.conta && d.conta.sellerId;
        if (dono && conta !== 'atual' && String(dono) !== String(conta)) { outra = true; continue; }
        achados.push(...(d.itens || []).filter(i => i && i.itemId === id));
        await espera(PAUSA_MS / 2);
    }
    if (achados.length) await juntarAnuncios(conta, achados);
    const lidos = [...new Set(achados.map(i => i.itemId))];
    if (!lidos.length && (outra || (alvo.length && falhas === alvo.length))) return { ok: false, motivo: outra ? 'outra_conta' : login ? 'login' : 'indisponivel', lidos };
    return { ok: true, lidos };
}

// v3.1 Robô do Canal (alarme 'shc-canal'): com shc:canal:robo.ligado, 1 vez por dia monta a agenda dos próximos dias do canal escolhido na
// Agenda (shc:canal:sel) com a MESMA regra da tela (SHC.canalRoboPassada) e guarda em shc:canal:plano:<canal> (o painel avisa).
// Só GET; não cria nada no ML: quem clica "Criar" em cada transmissão é a seller.
async function roboCanal() {
    const sf = await SHC.lerChave('shc:canal:sel'), k = 'shc:canal:plano:' + sf, agora = new Date();
    const salvo = sf ? await SHC.lerChave(k) : null;
    if (!sf || !SHC.canalRoboDeveRodar(await SHC.lerChave('shc:canal:robo'), salvo, agora)) return { ok: false };
    const buscar = async (caminho, json) => {
        bateVivo();
        const r = await SHC.buscarVendo(BASE + caminho, comTempo({ credentials: 'include', cache: 'no-store' }));
        if (ehLogin(r.url) || !r.ok) throw new Error('ml');
        return json ? r.json() : r.text();
    };
    const reg = await SHC.canalRoboPassada(buscar, sf, salvo, agora);
    await SHC.gravarChave(k, reg);
    return { ok: true, n: reg.robo.n };
}

// Selo de frete na tela do ML → abre o painel lateral já na aba Frete daquele anúncio.
// O painel é aberto na hora (sem await antes), para não perder o clique do seller.
function abrirFrete(itemId, tabId) {
    chrome.storage.local.set({ 'shc:foco': { aba: 'frete', itemId, ts: Date.now() } }).catch(() => {});
    if (chrome.sidePanel && chrome.sidePanel.open) chrome.sidePanel.open({ tabId }).catch(() => {});
}

const daAbaDoML = s => !!(s && s.tab && /^https:\/\/vendedores\.mercadolivre\.com\.br\//.test(s.url || s.tab.url || ''));
// V15: a aba manda a conta da página (SHC.mlContaDoEstado → {sellerId} ou o número). Só vale se for a conta aberta agora.
const contaDaMsg = m => { const c = m && m.conta, id = c && typeof c === 'object' ? c.sellerId : c; return /^\d{6,15}$/.test(String(id || '').trim()) ? String(id).trim() : ''; };
async function daContaAtual(msg) { const c = contaDaMsg(msg); return c && c === await SHC.contaAtual() ? c : ''; }

// ── Concorrentes do catálogo (sob demanda, fora da sincronização). Permissão OPCIONAL de www/produto.mercadolivre.com.br, pedida
// pelo painel no clique. Só GET e SEM cookies (credentials 'omit'): a página não traz o endereço de entrega do usuário ("Enviar para…"),
// e o leitor ainda descarta tudo antes da 1ª oferta. A CONFIRMAR AO VIVO: se o ML responde igual sem a sessão.
const WWW = 'https://www.mercadolivre.com.br', PRODUTO = 'https://produto.mercadolivre.com.br';
async function temPermissaoCatalogo() {
    try { return !!(chrome.permissions && chrome.permissions.contains && await chrome.permissions.contains({ origins: [WWW + '/*', PRODUTO + '/*'] })); } catch (e) { return false; }
}
async function buscarPublico(url) {
    try { const r = await fetch(url, comTempo({ credentials: 'omit', cache: 'no-store' })); return r.ok ? { url: r.url || '', html: await r.text() } : null; } catch (e) { return null; }
}
async function lerConcorrentes(itemId) {
    if (!(await temPermissaoCatalogo())) return { semPermissao: true };
    const conta = await SHC.contaAtual();
    const p = await buscarPublico(PRODUTO + '/MLB-' + itemId.slice(3));   // redireciona para …/p/MLB<catálogo>?pdp_filters=item_id:…
    if (!p) return { ok: false, erro: 'O Mercado Livre não respondeu. Tente de novo em alguns minutos.' };
    const cat = (/\/p\/(MLB\d+)/.exec(p.url) || [])[1];
    if (!cat) return { ok: false, semCatalogo: true, erro: 'Este anúncio não está num produto de catálogo.' };
    const s = await buscarPublico(WWW + '/p/' + cat + '/s');
    const lidas = s ? SHC.mlOfertasCatalogo(s.html) : null;
    if (!lidas || !lidas.ofertas.length) return { ok: false, catalogo: cat, erro: 'Não consegui ler as ofertas do catálogo. Tente de novo mais tarde.' };
    const it = (((await SHC.lerAnuncios(conta)) || {}).itens || []).find(i => i && i.itemId === itemId) || {};
    const seu = { preco: typeof it.preco === 'number' ? it.preco : null };
    const snap = Object.assign({ ts: Date.now(), catalogo: cat, ofertas: lidas.ofertas, variacaoIncerta: lidas.variacaoIncerta, seu }, SHC.posicaoNoCatalogo(lidas.ofertas, seu.preco));
    await SHC.gravarChave('conc:' + conta + ':' + itemId, snap);
    return Object.assign({ ok: true }, snap);
}
const daExtensao = s => !!(s && s.id === chrome.runtime.id && /^chrome-extension:\/\//.test(s.url || ''));

chrome.runtime.onMessage.addListener((msg, sender, responder) => {
    if (!msg) return false;
    if (msg.acao === 'concorrentes') {
        if (!(daExtensao(sender) || daAbaDoML(sender)) || !/^MLB\d{6,14}$/.test(String(msg.itemId || ''))) return false;
        lerConcorrentes(String(msg.itemId)).then(responder, () => responder({ ok: false, erro: 'O Mercado Livre não respondeu. Tente de novo em alguns minutos.' }));
        return true;
    }
    // v2.5.3 (D5a): responde logo depois da 1ª batida ({ok, iniciou} — o andamento vem por shc:status). esperar:true = responde o status final.
    if (msg.acao === 'sincronizar') {
        (msg.esperar ? sincronizar('manual') : iniciarSync('manual')).then(responder, () => responder({ ok: false, motivo: 'erro' }));
        return true;
    }
    // v2.5.3 (D6): {acao:'fiscal_agora'} → só a parte fiscal, agora (fiscalAgora).
    if (msg.acao === 'fiscal_agora') {
        if (!(daExtensao(sender) || daAbaDoML(sender))) return false;
        fiscalAgora().then(responder, () => responder({ ok: false, motivo: 'ml_indisponivel' }));
        return true;
    }
    // v2.5.3 (D7): {acao:'certificado', dias, data, expirou} ou {acao:'certificado', titulo, texto} da aba do Faturador (conta?: a da página, se souber).
    if (msg.acao === 'certificado') {
        if (!daAbaDoML(sender)) return false;
        // semAviso APAGA o alerta: só com a conta da página e se for a aberta agora. O aviso com texto sem conta ainda vale (a CONFIRMAR AO VIVO se o Faturador traz o id).
        (msg.conta || msg.semAviso ? daContaAtual(msg) : Promise.resolve('ok')).then(ok => (ok ? gravarCertificado(msg) : { ok: false, motivo: 'conta' }))
            .then(responder, () => responder({ ok: false, motivo: 'erro' }));
        return true;
    }
    // v2.5.1: Fechamento, "Tentar agora": {acao:'vendas_brutas_mes', mes:'AAAA-MM'} → lê só esse mês das vendas brutas agora.
    if (msg.acao === 'vendas_brutas_mes') {
        if (!daExtensao(sender)) return false;
        vendasBrutasMes(String(msg.mes || '')).then(responder, () => responder({ ok: false, motivo: 'indisponivel' }));
        return true;
    }
    if (msg.acao === 'sincronizar_custos') {   // botão "Sincronizar custos" em qualquer tela da extensão ou na aba do ML; erp: 'tiny' (padrão) | 'omie' | 'bling'
        if (!(daExtensao(sender) || daAbaDoML(sender))) return false;
        // Sem erp (painel lateral sem Tiny/Omie guardado): o Tiny, ou o Bling se só ele estiver conectado.
        const escolhe = async () => (['tiny', 'omie', 'bling'].indexOf(msg.erp) >= 0 ? msg.erp : (!((await SHC.lerChave(SHC.TINY_CHAVE)) || {}).token && ERPS.bling.cred(await SHC.lerChave(SHC.BLING_CHAVE)) ? 'bling' : 'tiny'));
        escolhe().then(erp => sincronizarCustos(erp, 0).then(responder, () => responder({ ok: false, erp, msg: 'Não consegui falar com o ' + ERPS[erp].nome + '. Tente de novo em alguns minutos.' })));
        return true;
    }
    if (msg.acao === 'bling_conectar') {   // só o painel (a extensão): o code do launchWebAuthFlow vira tokens aqui no fundo
        if (!daExtensao(sender) || !/^[\w.~-]{4,512}$/.test(String(msg.code || ''))) return false;
        conectarBling(String(msg.code)).then(responder, () => responder({ ok: false, erp: 'bling', msg: 'Não consegui falar com o Bling. Tente de novo.' }));
        return true;
    }
    if ((msg.acao === 'promos_pagina' && msg.dados) || (msg.acao === 'anuncios_pagina' && Array.isArray(msg.itens))) {
        if (!daAbaDoML(sender)) return false;
        daContaAtual(msg).then(conta => {
            if (!conta) return { ok: false, motivo: 'conta' };   // conta faltando ou de outra conta do mesmo Chrome: descarta
            return msg.acao === 'promos_pagina' ? juntarPagina(conta, msg.dados).then(() => ({ ok: true }))
                : juntarAnuncios(conta, msg.itens).then(n => ({ ok: true, anuncios: n }));
        }).then(responder, () => responder({ ok: false }));
        return true;
    }
    if (msg.acao === 'canal_ler_anuncios') {   // v3.1: Agenda do Canal lê os anúncios que o Copiloto ainda não tinha (só GET)
        if (!daExtensao(sender) || !Array.isArray(msg.itemIds)) return false;
        lerAnunciosPorId(msg.itemIds).then(responder, () => responder({ ok: false, lidos: [] }));
        return true;
    }
    if (msg.acao === 'recalcular_alertas') { atualizarAlertas().then(r => responder({ ok: true, criticos: r.criticos, anomalias: r.anomalias ? r.anomalias.total : null }), () => responder({ ok: false })); return true; }
    if (msg.acao === 'sincronizar_repasse') {   // página de Fechamento, logo depois de o seller conceder a permissão do Mercado Pago
        if (emAndamento) { responder({ ok: false, motivo: 'sincronizando' }); return false; }
        SHC.contaAtual().then(async conta => {
            if (conta !== 'atual' && await confereSessao(conta) === 'outra_conta') return { ok: false, motivo: 'outra_conta' };   // repasse de outra conta não entra nesta
            const r = await sincronizarRepasse(conta, async () => {});
            await emFilaStatus(async () => {
                const st = await SHC.lerStatus();
                Object.assign(st, r.falha ? { erroRepasse: r.falha === 'login' ? 'sem_login_mp' : 'ml_indisponivel' }
                    : { erroRepasse: null, repasseConectado: !r.semPermissao }, r.falha || r.semPermissao ? {} : { repasseEm: Date.now(), repassePaginas: r.paginas });
                await SHC.salvarStatus(st);
            });
            return Object.assign({ ok: !r.falha }, r);
        }).then(responder, () => responder({ ok: false }));
        return true;
    }
    if (msg.acao === 'abrir_frete' && sender && sender.tab && /^MLB\d{6,14}$/.test(String(msg.itemId || ''))) {
        abrirFrete(String(msg.itemId), sender.tab.id);
        responder({ ok: true });
        return false;
    }
    if (msg.acao === 'simulador') {   // painel/etiqueta: {acao:'simulador', itemId, forcar?} → { ok, sim:{ts, itemId, hoje, outro} }
        if (!(daExtensao(sender) || daAbaDoML(sender))) return false;
        if (!/^MLB\d{6,14}$/.test(String(msg.itemId || ''))) { responder({ ok: false, motivo: 'item' }); return false; }
        simulador(msg.itemId, !!msg.forcar).then(responder, () => responder({ ok: false, motivo: 'ml_indisponivel' }));
        return true;
    }
    // v2.5: {acao:'saude_agora', itemId?} → com itemId: lê fotos e visitas do anúncio agora ({ok, itemId, fotos, visitas, radar, semPermissao});
    // sem itemId: começa a rodada lenta ({ok, iniciado} | {ok, emCurso}); o andamento vai em shc:status.saudeProgresso.
    if (msg.acao === 'saude_agora') {
        if (!(daExtensao(sender) || daAbaDoML(sender))) return false;
        if (msg.itemId !== undefined && !/^MLB\d{6,14}$/.test(String(msg.itemId || ''))) { responder({ ok: false, motivo: 'item' }); return false; }
        if (!msg.itemId) {
            const emCurso = !!saudeEmCurso;
            SHC.contaAtual().then(c => rodadaSaude(c)).catch(() => {});
            responder({ ok: true, iniciado: !emCurso, emCurso });
            return false;
        }
        SHC.contaAtual().then(c => saudeAgora(c, String(msg.itemId))).then(responder, () => responder({ ok: false, motivo: 'ml_indisponivel' }));
        return true;
    }
    // v2.5.2: {acao:'medidas_agora', itemId} → relê as medidas do anúncio agora (medidasAgora).
    if (msg.acao === 'medidas_agora') {
        if (!(daExtensao(sender) || daAbaDoML(sender))) return false;
        if (!/^MLB\d{6,14}$/.test(String(msg.itemId || ''))) { responder({ ok: false, motivo: 'item' }); return false; }
        SHC.contaAtual().then(c => medidasAgora(c, String(msg.itemId)).then(r => { if (r.ok) atualizarAlertas(c).catch(() => {}); return r; })).then(responder, () => responder({ ok: false, motivo: 'ml_indisponivel' }));
        return true;
    }
    // v3.1: {acao:'catalogo_agora', itemId} → compCatAgora (1 GET da tela "Alterar anúncio"; só leitura).
    if (msg.acao === 'catalogo_agora') {
        if (!(daExtensao(sender) || daAbaDoML(sender))) return false;
        if (!/^MLB\d{6,14}$/.test(String(msg.itemId || ''))) { responder({ ok: false, motivo: 'item' }); return false; }
        SHC.contaAtual().then(c => compCatAgora(c, String(msg.itemId))).then(responder, () => responder({ ok: false, motivo: 'ml_indisponivel' }));
        return true;
    }
    // v2.5.2: {acao:'medidas_marca', itemId, tipo:'alterar'|'fui_eu', em (só no fui_eu)} → medidasMarca.
    if (msg.acao === 'medidas_marca') {
        if (!(daExtensao(sender) || daAbaDoML(sender))) return false;
        if (!/^MLB\d{6,14}$/.test(String(msg.itemId || '')) || !/^(alterar|fui_eu)$/.test(String(msg.tipo || '')) || (msg.tipo === 'fui_eu' && !(+msg.em > 0))) {
            responder({ ok: false, motivo: 'item' }); return false;
        }
        SHC.contaAtual().then(c => medidasMarca(c, String(msg.itemId), msg.tipo, +msg.em).then(r => { if (r.ok) atualizarAlertas(c).catch(() => {}); return r; })).then(responder, () => responder({ ok: false, motivo: 'nada' }));
        return true;
    }
    // {acao:'robo_rodar_agora'} → {ok, sugestoes (quantas), feitos:[entradas do histórico], desligado?}
    // {acao:'robo_desfazer', itemId} → a entrada gravada no histórico ({ok, resultado, erro?…}) | {ok:false, resultado:'nada'|'desligado'|'limite'|'semPermissao'|'item'}
    if (msg.acao === 'robo_rodar_agora' || msg.acao === 'robo_desfazer') {
        if (!(daExtensao(sender) || daAbaDoML(sender))) return false;
        if (msg.acao === 'robo_desfazer' && !/^MLB\d{6,14}$/.test(String(msg.itemId || ''))) { responder({ ok: false, resultado: 'item' }); return false; }
        SHC.contaAtual().then(c => (msg.acao === 'robo_desfazer' ? roboDesfazer(c, String(msg.itemId)) : roboPassada(c, true)))
            .then(responder, () => responder({ ok: false, resultado: 'falhou' }));
        return true;
    }
    // v2.7: {acao:'resumo_semanal', agora?:true} → {ok, resumo} (guardado; agora = gera de novo com o que está guardado, nenhum GET);
    // {acao:'resumo_semanal_visto'} → tira o "novo" (o ícone volta ao número das anomalias). Nada é enviado a ninguém.
    if (msg.acao === 'resumo_semanal' || msg.acao === 'resumo_semanal_visto') {
        if (!daExtensao(sender)) return false;
        SHC.contaAtual().then(async c => {
            if (msg.acao === 'resumo_semanal_visto') {
                const k = 'resumo:' + c + ':semanal', s = await SHC.lerChave(k);
                if (s && s.novo) { await SHC.gravarChave(k, Object.assign(s, { novo: false })); const a = await SHC.lerAnomalias(); selo(a || 0); }
                return { ok: true };
            }
            const s = msg.agora ? null : await SHC.lerChave('resumo:' + c + ':semanal');
            return s ? { ok: true, resumo: s } : gerarResumoSemanal(c, 'pedido');
        }).then(responder, () => responder({ ok: false, motivo: 'erro' }));
        return true;
    }
    // v2.9: {acao:'robopromo_visto'} → o seller viu as sugestões do robô de promoções: tira o ponto do ícone. Nada vai ao ML.
    if (msg.acao === 'robopromo_visto') {
        if (!daExtensao(sender)) return false;
        SHC.contaAtual().then(async c => {
            const k = 'robopromo:' + c, s = await SHC.lerChave(k);
            if (s && s.novo) {
                await SHC.gravarChave(k, Object.assign({}, s, { novo: false }));
                const [a, sem] = await Promise.all([SHC.lerAnomalias(), SHC.lerChave('resumo:' + c + ':semanal')]);
                selo(sem && sem.novo ? Object.assign({}, a || { total: 0 }, { semanalNovo: true }) : (a || 0));
            }
            return { ok: true };
        }).then(responder, () => responder({ ok: false }));
        return true;
    }
    if (msg.acao === 'abrir_painel') { chrome.runtime.openOptionsPage(); responder({ ok: true }); return false; }
    return false;
});
