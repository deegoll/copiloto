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
// 02/10: a licença (licenca.js, F1 "Entrar com o SellerHub") está DESLIGADA e fora do pacote (empacotar.ps1, $fora). Sem ela, as
// mensagens licenca_* respondem { ok: false, erro: 'desligado' } e o alarme shc-licenca é tirado. Religar = voltar o arquivo nesta lista.
// 3.3.1: "Tentar de novo esta parte" — {acao:'sincronizar_etapa', etapa} relê SÓ uma etapa (sincronizarEtapa, 08), com as mesmas
// travas da cheia; FN_ETAPA/RESUMO_ETAPA/ERRO_CAMPO_ETAPA (08) são a fonte única das duas. A linha da leitura diz "Etapa N de 13".
importScripts('calc.js', 'store.js', 'segredo.js', 'ml-extrator.js', 'tiny.js', 'omie.js', 'bling.js', 'erp-cruzar.js', 'fechamento.js', 'agenda-canal.js');
// v3.2: TikTok Shop — núcleo (cópia de copiloto-nucleo/src) + tiktok.js. Só LÊ a resposta que a tela aberta pela seller recebeu:
// nenhum fetch, nenhum alarme para o TikTok. Mensagens 'tiktok_captura', 'tiktok_ligar' e 'tiktok_etiqueta' e o registro dos scripts: SHC.tt.instalarFundo.
importScripts('nucleo/util.js', 'nucleo/modelo.js', 'nucleo/tarifas.js', 'nucleo/motor.js', 'nucleo/conciliacao.js', 'nucleo/adaptador.js', 'nucleo/adaptadores/tiktok.js', 'tiktok.js');
// 3.3.0 (E8): TikTok destravado. 'scripting' e o site só como permissões OPCIONAIS (pedidas no clique em Ajustes); os 3 scripts da tela
// só são registrados com as 2 concedidas E cfg.modulos.tiktok === true (SHC.tt.sincronizarScripts). Nenhum content_script fixo no TikTok.
SHC.tt.instalarFundo();

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
    seloAgora().catch(() => {});
    retomarInterrompida().catch(() => {});
    if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
    chrome.alarms.create('shc-sync', { periodInMinutes: INTERVALO_MIN, delayInMinutes: 1 });
    chrome.alarms.create('shc-saude', { periodInMinutes: SAUDE_ALARME_MIN, delayInMinutes: 10 });
    chrome.alarms.create('shc-robo', { periodInMinutes: ROBO_ALARME_MIN, delayInMinutes: 30 });
    // v3.1: Robô do Canal (roboCanal): confere a cada 6 h e monta no máximo 1 vez por dia, só se a seller ligou na Agenda.
    if (chrome.alarms.get) Promise.resolve(chrome.alarms.get('shc-canal')).then(x => { if (!x) chrome.alarms.create('shc-canal', { delayInMinutes: 20, periodInMinutes: 360 }); }, () => {});
    // v3.2: resumo para a equipe (do dia e/ou da semana; Ajustes: resumo_freq e resumo_hora). Um alarme a cada 30 min confere se já passou
    // da hora e o resumo do período ainda não foi gerado (Chrome fechado na hora → gera quando abrir). Substitui o 'shc-semanal' (8h fixo).
    // ponytail: confere de 30 em 30 min (sai até 30 min depois da hora); alarme com hora exata só se a dona pedir.
    chrome.alarms.create('shc-resumo', { periodInMinutes: 30, delayInMinutes: 1 });
    if (chrome.alarms.clear) chrome.alarms.clear('shc-semanal');
    resumosDevidos(Date.now()).catch(() => {});
    // F1 (licenca.js): cria o inst desta instalação e garante o alarme de renovação do passe (só se a seller entrou com o SellerHub).
    if (SHC.licencaPreparar) SHC.licencaPreparar().catch(() => {});
    else if (chrome.alarms.clear) chrome.alarms.clear('shc-licenca');   // 02/10: licença desligada → tira o alarme que a 3.2.1 possa ter deixado
}
// Ícone = anomalias + o "•" do que ainda não foi visto: resumo do dia/da semana e sugestão do robô de promoções (v2.9). Um cálculo só,
// usado por quem refaz o selo fora da sincronização (preparar, alarme do resumo, "visto"); a sincronização faz o mesmo em atualizarAlertas.
async function seloAgora() {
    const a = await SHC.lerAnomalias(), c = (a && a.conta) || await SHC.contaAtual(), tem = c && c !== 'atual';
    const [sem, dn, rp] = tem ? await Promise.all([SHC.lerChave(chaveResumo(c, 'semana')), SHC.lerChave(chaveResumo(c, 'dia')), SHC.lerChave('robopromo:' + c)]) : [];
    const base = a || { total: (((await SHC.lerAlertas()) || {}).criticos) || 0 }, sn = !!(sem && sem.novo), dnv = !!(dn && dn.novo), rn = sn && dnv ? 'ambos' : sn ? true : dnv ? 'dia' : false;
    await selo(rn || (rp && rp.novo) ? Object.assign({}, base, { semanalNovo: rn, promoNovo: !!(rp && rp.novo) }) : (a || base.total));
}
const horaResumo = cfg => { const n = SHC.num(cfg && cfg.resumo_hora); return n !== null && n >= 0 && n <= 23 ? Math.floor(n) : 8; };
// Passou da hora de hoje (dia) ou da segunda nessa hora (semana) e o guardado é de antes disso, não existe ou é do formato antigo
// (v2.7, sem periodo) → gera e marca "novo". Só com as vendas lidas HOJE (vb.ts desde a meia-noite): antes disso ontem está pela metade
// e o texto sairia com uma queda falsa — espera; o fim de sincronizar() chama de novo.
async function resumosDevidos(agora) {
    const c = await SHC.contaAtual();
    if (!c || c === 'atual') return null;
    const cfg = await SHC.lerCfg(), hora = horaResumo(cfg), freq = cfg.resumo_freq || 'ambos', hojeH = new Date(agora), meiaNoite = new Date(agora);
    hojeH.setHours(hora, 0, 0, 0); meiaNoite.setHours(0, 0, 0, 0);
    const vb = await SHC.lerVendasBrutas(c);
    if (!vb || (vb.ts && vb.ts < meiaNoite.getTime())) return false;   // sem vb.ts (leitura antiga) não dá para saber: segue
    const marco = { dia: freq !== 'semana' && hojeH.getTime() <= agora ? hojeH.getTime() : null, semana: freq !== 'dia' ? proximaSegunda8h(agora, hora) - 7 * 864e5 : null };
    for (const per of ['dia', 'semana']) {
        if (marco[per] === null) continue;
        const s = await SHC.lerChave(chaveResumo(c, per));
        if (!s || s.ts < marco[per] || !s.periodo) await gerarResumo(c, per, 'alarme');
    }
    return true;
}
// Próxima segunda-feira às 8h (ou na hora dada; hora local); se hoje é segunda antes dessa hora, hoje mesmo.
function proximaSegunda8h(agora, hora) {
    const d = new Date(agora); d.setHours(hora === undefined ? 8 : hora, 0, 0, 0);
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
    else if (a.name === 'shc-resumo') resumosDevidos(Date.now()).catch(() => {});   // v3.2: resumo do dia/da semana na hora de Ajustes (só gera e marca "novo")
    else if (a.name === 'shc-semanal') SHC.contaAtual().then(c => gerarResumo(c, 'semana', 'alarme')).catch(() => {});   // v2.7: alarme antigo (até o preparar tirar)
    else if (a.name === 'shc-canal') roboCanal().catch(() => {});   // v3.1: Robô do Canal (só monta a agenda; criar no ML é o clique da seller)
    else if (a.name === SHC.LICENCA_ALARME) SHC.licencaRenovar().then(r => SHC.licencaAgendar(r)).catch(() => {});   // F1: renova o passe (1 de cada vez)
});

// Página inteira do painel do vendedor, com a sessão do Chrome → { html } | { login: true } (mandou para o login) | null (ML fora/erro).
