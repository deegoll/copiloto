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
        puxar: (c, o) => SHC.blingPuxar(c, Object.assign({ salvar: tk => salvarBling(c, tk, o && o.empresa) }, o)), resumo: r => SHC.blingResumo(r),
        mesma: (a, b) => !!a && !!b && a.clientId === b.clientId && a.clientSecret === b.clientSecret },
};
// Grava tokens novos do Bling só se o seller não desconectou/trocou de aplicativo no meio. tk = null → apaga os tokens (refresh vencido: "Conecte de novo").
// empresa (v3.3): a do começo da leitura — o token renovado no meio volta para o erp:bling da MESMA empresa, mesmo se o ML trocou de conta.
async function salvarBling(cred, tk, empresa) {
    const A = SHC.areaEmpresa(typeof empresa === 'string' ? empresa : undefined), agora = await SHC.erpLer(SHC.BLING_CHAVE, A);
    if (!agora || agora.clientId !== cred.clientId || agora.clientSecret !== cred.clientSecret) return;
    const x = Object.assign({}, agora, tk || { reconectar: true });
    if (!tk) ['access', 'refresh', 'expira', 'renovado'].forEach(k => delete x[k]); else delete x.reconectar;
    await SHC.erpGravar(SHC.BLING_CHAVE, x, A);
}
// {acao:'bling_conectar', code}: o painel fez o launchWebAuthFlow (state conferido lá) e já guardou Client ID/Secret; aqui o code vira tokens
// (só em erp:bling) e os custos são importados na hora. → a resposta de sincronizarCustos('bling') | {ok:false, msg}.
async function conectarBling(code, empresa) {
    const e0 = typeof empresa === 'string' ? empresa : await SHC.empresaSeparada(), t = await SHC.erpLer(SHC.BLING_CHAVE, SHC.areaEmpresa(e0));   // v3.3: a empresa do clique
    if (!t || !t.clientId || !t.clientSecret) return { ok: false, erp: 'bling', msg: 'Cole o Client ID e o Client Secret do seu aplicativo do Bling.' };
    try {
        const tk = await SHC.blingTrocarCodigo(t, code, { fetch: (u, i) => fetch(u, comTempo(i)) });
        await salvarBling(t, tk, e0);
    } catch (e) { return { ok: false, erp: 'bling', erro: (e && e.erro) || 'outro', msg: (e && e.msg) || 'Não consegui falar com o Bling. Tente de novo.' }; }
    return sincronizarCustos('bling', 0, e0);
}
// v3.3 multi-empresa: a empresa que a tela mandou junto com o pedido ({empresa}: '' ou o sellerId de uma conta marcada como outra empresa).
// Ausente ou inválida (ex.: id que não está mais separado) → undefined: sincronizarCustos usa a empresa da conta aberta agora.
async function empresaDoPedido(msg) {
    const e = msg && msg.empresa;
    if (e === '') return '';
    if (typeof e !== 'string' || !/^\d{6,15}$/.test(e)) return undefined;
    const cfg = (await chrome.storage.local.get('cfg')).cfg || {};
    return (cfg.empresaSeparada || {})[e] === true ? e : undefined;
}
// v3.2 Cruzamento ERP × ML (erp-cruzar.js): só o que já está guardado (erp:produtos:<erp>, ml:anuncios, editor, ml:full), nenhuma chamada.
// O ERP é o conectado com o retrato mais novo; sem ERP conectado, o erpx:<conta> velho sai. → erpx:<conta> | null.
// opc.avisar = 1ª conferência depois de conectar (a janela do painel lateral); fica até a seller fechar ({acao:'erp_visto'}).
async function erpConferir(conta, opc) {
    conta = conta || await SHC.contaAtual();
    let melhor = null;
    for (const e of Object.keys(ERPS)) {
        const ret = await SHC.lerChave('erp:produtos:' + e);
        if (ret && Array.isArray(ret.itens) && ERPS[e].cred(await SHC.erpLer(ERPS[e].chave())) && (!melhor || (ret.ts || 0) > (melhor.ret.ts || 0))) melhor = { e, ret };
    }
    const k = 'erpx:' + conta;
    if (!melhor) { if (await SHC.lerChave(k)) await chrome.storage.local.remove(k); return null; }
    const [snap, editor, full, ant] = await Promise.all([SHC.lerAnuncios(conta), SHC.lerChave('editor:' + conta), SHC.lerFull(conta), SHC.lerChave(k)]);
    if (!snap || !Array.isArray(snap.itens) || !snap.itens.length) return null;
    const x = SHC.erpConferir({ erp: melhor.e, nome: ERPS[melhor.e].nome, produtos: melhor.ret.itens, snap, editor, full,
        avisar: !!(opc && opc.avisar) || !!(ant && ant.avisar && ant.erp === melhor.e) });
    await SHC.gravarChave(k, x);
    return x;
}
async function erpConferirTodas(opc) {
    let cs = [];
    // v3.3 multi-empresa: o ERP guardado é o da empresa da conta aberta → só as contas dessa empresa são conferidas com ele.
    try { cs = SHC.contasDaEmpresa ? await SHC.contasDaEmpresa() : await SHC.contas(); } catch (e) { cs = []; }
    const ids = cs.length ? cs.map(c => c.sellerId) : [await SHC.contaAtual()];
    for (const id of ids) await erpConferir(id, opc).catch(() => null);
}
// SKUs dos anúncios da conta ainda sem custo (depois da importação) → número. null sem retrato.
async function skusSemCusto() {
    const itens = ((await SHC.lerAnuncios()) || {}).itens || [];
    if (!itens.length) return null;
    // F27: todos os SKUs de cada anúncio (variações) e a mesma regra do lucro (SHC.custosDe: SKU, kit, custo no anúncio, família) —
    // antes só o 1º SKU e só c|sku (kit somado ou custo digitado no anúncio contavam como "sem custo").
    const infos = [];
    itens.forEach(i => SHC.skusDoAnuncio(i).forEach(s => { const n = SHC.normalizaSku(s); if (n) infos.push({ sku: n, itemId: i.itemId, familia: i.familia }); }));
    if (!infos.length) return 0;
    const m = await SHC.custosDe(infos), com = new Set();
    infos.forEach(x => { if (m.get(x)) com.add(x.sku); });
    return new Set(infos.map(x => x.sku).filter(s => !com.has(s))).size;
}
// Gravações do status (sincronização e andamento dos custos) uma de cada vez: ler-mudar-gravar de uma nunca apaga o que a outra gravou.
