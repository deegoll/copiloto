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
// ── v3.3 multi-empresa (bloqueio 5, 07/10/2026): DIÁRIO das gravações desde a última conferência BOA da conta. O login do ML trocado no meio
// de uma etapa gravava a outra empresa nas chaves desta (pós-venda, resumo, cobranças, alertas) e a troca só era vista depois. Toda gravação
// do fundo passa por chrome.storage.local (o store.js também): com um diário aberto, a 1ª gravação de cada chave guarda o valor de ANTES.
// Conferência acusou outra conta → desfazDiario (cada chave volta ao que era; a que não existia some); conferência boa → o diário recomeça.
// Fora do diário: o status, o ciclo e as respostas guardadas nele, e o que não vem da sessão do ML (cfg, custos, ERP, vistos).
const FORA_DO_DIARIO = /^(shc:status$|shc:ciclo$|shc:ret:|cfg$|c\||v\||erp[:@])/;
// 2ª revisão (07/10): o embrulho é global, então o diário anota SÓ os retratos que a leitura do ML grava (lista fechada). Fora dele ficam os
// cliques da seller e os outros canais gravados na mesma janela: medidas (marca "fui eu"), robô, robopromo, cert, erpx, fotos, tt: (TikTok),
// licença. Desfazer um deles apagaria o que a seller fez. Dentro: vendas por anúncio (vd|, vm|, vu|) e as marcas de migração (shc:migra:).
const NO_DIARIO = /^(?:fh|ad|cob|ads|vd|vm|vu)\||^shc:migra:|^(?:ml:cobrancas|ml:full|full|ml:promos|ml:anuncios|cob|visitas|vbAnuncio|vb|fiscal|cat|catcomp|remessas|perguntas|frete|editor|reputacao|promoSaiu|prejuizo|conferir|shc:anomalias|shc:alertas|resumo|posvenda|nfe|fech|fat|exp|ads|afil|mp:repasse|comp)(?::|$)/;
const noDiario = k => NO_DIARIO.test(k) && !FORA_DO_DIARIO.test(k);   // resumo:<c>:dia/:semanal ficam DENTRO: desfazer só traz o "novo" de volta
const diarios = new Set();
let armazem = null;   // get/set/remove de verdade do chrome.storage.local (o diário embrulha set e remove na 1ª abertura)
const anotaDiario = ks => Promise.all([...diarios].map(d => {
    const novas = ks.filter(k => typeof k === 'string' && noDiario(k) && !d.antes.has(k));
    if (novas.length) { const p = armazem.get(novas).catch(() => null); novas.forEach(k => d.antes.set(k, p.then(o => (!o ? { falhou: true } : k in o ? { v: o[k] } : null)))); }
    return Promise.all(ks.map(k => d.antes.get(k)));
}));
const abreDiario = () => {
    if (!armazem) {
        const L = chrome.storage.local, set = L.set.bind(L), remove = L.remove.bind(L);
        const setD = (o, ...x) => (diarios.size && o ? anotaDiario(Object.keys(o)).then(() => set(o, ...x)) : set(o, ...x));
        const removeD = (ks, ...x) => (diarios.size ? anotaDiario([].concat(ks)).then(() => remove(ks, ...x)) : remove(ks, ...x));
        armazem = { get: L.get.bind(L), set, remove, ok: false };
        try { L.set = setD; L.remove = removeD; armazem.ok = L.set === setD && L.remove === removeD; } catch (e) { armazem.ok = false; }   // sem embrulho: vale a conferência + marcaReler
    }
    const d = { antes: new Map() };
    if (armazem.ok) diarios.add(d);
    return d;
};
const fechaDiario = d => { if (d) diarios.delete(d); };
// Desfaz o que foi gravado desde a última conferência boa; o diário continua aberto (o que vier depois também é anotado). → quantas chaves.
const desfazDiario = async d => {
    if (!d || !d.antes.size) return 0;
    const ks = [...d.antes.keys()], vs = await Promise.all(ks.map(k => d.antes.get(k)));
    d.antes = new Map();
    const volta = {}, some = [];
    ks.forEach((k, i) => { const x = vs[i]; if (x && x.falhou) return; if (x) volta[k] = x.v; else some.push(k); });
    if (some.length) await armazem.remove(some);
    if (Object.keys(volta).length) await armazem.set(volta);
    return ks.length;
};
// Conta da página 1 dos Anúncios guardada no ciclo (o ciclo caiu no meio dos Anúncios: cic.conta ainda vazio) → sellerId | ''.
const contaDoCiclo = async c => { const k = 'shc:ret:' + c.id + ':anuncios:p|1', g = (await chrome.storage.local.get(k))[k], d = g && g.v && g.v.dados; return String((d && d.conta && d.conta.sellerId) || ''); };
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
    // v3.3 (multi-empresa): o login do ML mudou no meio da leitura — parei para não gravar uma empresa na outra.
    outra_conta: 'O Mercado Livre deste Chrome mudou de conta no meio da leitura. Parei para não misturar as empresas: sincronize de novo com a conta certa aberta.',
    // 3.3.1 (C2): o canal foi desligado em Ajustes no meio da leitura — o que faltava não é lido.
    sem_consentimento: 'O Mercado Livre foi desligado em Ajustes › Canais de venda. Ligue de novo para o Copiloto ler.',
};
async function sincronizar(origem) {
    if (emAndamento) return emAndamento;
    // 3.3.1 (C2): sem o "Concordo e ligar" do Mercado Livre (cfg.consentimento_ml) NADA é lido — nem o status mexe.
    // A chave do canal em Ajustes é a única porta: alarme, retomada e o botão Sincronizar passam por aqui.
    if (!(await SHC.mlPermitidoAgora())) return { ok: false, motivo: 'sem_consentimento' };
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
        // → os campos do status de ANTES do patch (a troca de conta vista depois desfaz a etapa: desfazTroca os devolve).
        const termina = async (id, estado, resumo, erroCod, r) => {
            const e = st.etapas[id], antes = {};
            Object.assign(e, { estado, resumo: resumo || null, erro: erroCod ? (O_QUE_FAZER[erroCod] || O_QUE_FAZER.ml_indisponivel) : null, fim: Date.now() });
            if (e.de && estado === 'ok') e.feito = st.progresso.feito = e.de;   // contagem fechada (a próxima etapa já começa em seguida)
            if (cic && estado !== 'erro') {
                const patch = r && PATCH_ETAPA[id] ? PATCH_ETAPA[id](r) : null;
                if (patch) { Object.keys(patch).forEach(k => { antes[k] = st[k]; }); Object.assign(st, patch); }
                cic.feitas[id] = { estado, resumo: e.resumo, inicio: e.inicio, fim: e.fim, feito: e.feito, de: e.de, unidade: e.unidade, patch };
                await limpaCiclo(cic, id).catch(() => {});
                await salvaCiclo();
            }
            await gravar();
            return antes;
        };
        await gravar(true);
        stSync = st;
        if (aoBater) { aoBater(); aoBater = null; }   // D5a: 1ª batida gravada → o clique já recebe {ok, iniciou}
        // Continuar sem ler os anúncios de novo: 1 GET confere que a sessão do ML ainda é a mesma conta (nunca mistura contas).
        // Outra conta aberta → ciclo novo, tudo na fila de novo.
        // v3.3 (bloqueio 5): o ciclo que caiu no MEIO dos Anúncios ainda não tem conta (cic.conta vazio), mas já guardou páginas: vale a conta
        // da página 1 guardada — página da conta antiga + página da nova no mesmo retrato nunca. Troca vista → os meses lidos voltam à fila.
        const recomeca = async () => { cic = null; ETAPAS.forEach(({ id }) => naFila(id)); st.progresso = progresso0(0); await gravar(true); };
        try {
            const dono = cic ? cic.conta || await contaDoCiclo(cic) : '';
            if (dono && dono !== 'atual' && (await confereSessao(dono)) === 'outra_conta') {
                await marcaReler(dono, cic.inicio).catch(() => {});
                await recomeca();
            }
            if (cic) { cic.chaves = cic.chaves || []; if (origem === 'retomada') cic.retomadas = (cic.retomadas || 0) + 1; }
            else cic = await cicloNovo(agora);
        } catch (x) {   // sem a conferência: nada do ciclo antigo é aproveitado
            if (cic) await recomeca().catch(() => {});
            try { cic = await cicloNovo(agora); } catch (y) { cic = null; }
        }
        ciclo = cic;
        if (cic) await salvaCiclo();
        const feita = id => !!(cic && cic.feitas[id]);
        const codigo = falha => (falha === 'login' ? 'sem_sessao' : falha === 'sem_consentimento' || /^ads_/.test(falha) || falha === 'outra_conta' ? falha : 'ml_indisponivel');   // 3.3.1 (C2): sem_consentimento chega ao status com a frase dele
        // Cada etapa depois dos anúncios falha sozinha: o que ela tinha gravado antes fica, e o status ganha erro<Etapa>.
        // resumo(r) = texto curto do que foi lido; r.semPermissao = etapa pulada (não é erro).
        // v2.10: etapa já feita neste ciclo não roda de novo (os campos do status dela voltam do ciclo no fim).
        // v3.3 (multi-empresa): antes de cada etapa, a sessão do ML ainda é da conta desta sincronização (contaSegue, guardado de 1 min).
        // Bloqueio 5 (07/10/2026): DEPOIS de cada etapa a conferência é FORÇADA (1 GET leve por etapa): a troca no meio da etapa, ou dentro do
        // minuto guardado, não passa. Trocou: o que foi gravado desde a última conferência que PROVOU a conta é desfeito (diário), as etapas
        // terminadas nesse meio e a da troca saem com erro, as próximas param ('outra_conta') e, no fim, FORA do diário, os meses lidos nesta
        // rodada voltam para a fila (marcaReler). Revisão 07/10/2026: só a página que diz o dono e é esta conta ('mesma') prova; a página sem
        // dono (verificação de segurança, tela intermediária) não confirma nada — o diário continua aberto até a próxima prova.
        let contaSync = null, trocou = false, diario = null, provada = false, semProva = [];   // semProva: [{id, antes}] terminadas sem prova depois
        const provou = c => contaConferida.conta === c && contaConferida.r === 'mesma';
        const desfazTroca = async () => {
            trocou = true;
            await desfazDiario(diario).catch(() => {});
            // O que estas etapas gravaram acabou de sair: nenhuma fica "ok" (nem conta como feita numa retomada); os campos do status voltam.
            semProva.slice().reverse().forEach(x => { Object.assign(st.etapas[x.id], { estado: 'erro', erro: O_QUE_FAZER.outra_conta, resumo: null }); Object.assign(st, x.antes || {}); if (cic) delete cic.feitas[x.id]; });
            if (semProva.length && cic) await salvaCiclo().catch(() => {});
            semProva = [];
        };
        const conferirConta = async forcar => {
            provada = false;
            if (trocou) return false;
            if (!contaSync || await contaSegue(contaSync, forcar)) {
                if (forcar && contaSync && provou(contaSync)) { provada = true; semProva = []; if (diario) diario.antes = new Map(); }   // PROVA: o gravado fica
                return true;
            }
            await desfazTroca();
            return false;
        };
        const etapa = async (id, fn, resumo, erroDe) => {
            if (feita(id)) return { pulou: true };
            // 3.3.1 (C2): o ML desligado em Ajustes no meio da leitura para as próximas etapas (o já lido com o consentimento da época fica).
            if (!(await SHC.mlPermitidoAgora())) { await termina(id, 'pulado', 'Não lida: o Mercado Livre foi desligado em Ajustes › Canais de venda.'); return { erro: 'sem_consentimento' }; }
            if (!(await conferirConta())) { await termina(id, 'erro', null, 'outra_conta'); return { erro: 'outra_conta' }; }
            await comeca(id);
            let e;
            try { const r = await fn(); e = r && r.falha ? { erro: codigo(r.falha) } : { r }; } catch (x) { e = { erro: 'ml_indisponivel' }; }
            // A própria etapa viu página de outro dono (prova) ou a conferência forçada acusou: as respostas guardadas no ciclo saem.
            if (e.erro === 'outra_conta' || !(await conferirConta(true))) {
                e = { erro: 'outra_conta' };
                if (!trocou) await desfazTroca();
                if (cic) await limpaCiclo(cic, id).catch(() => {});
            }
            if (e.erro) await termina(id, 'erro', null, erroDe && e.erro !== 'outra_conta' ? erroDe(e.erro) : e.erro);
            else {
                const antes = await termina(id, e.r && (e.r.semPermissao || e.r.pulado) ? 'pulado' : 'ok', resumo(e.r || {}), null, e.r);
                if (!provada) semProva.push({ id, antes });   // sem prova depois dela: a troca vista mais tarde desfaz esta também
            }
            return e;
        };
        const Q = SHC.qtd, mpErro = x => (x === 'sem_sessao' ? 'sem_login_mp' : x);
        let erro = null, erroPromos = null, erroCobrancas = null, erroFull = null, erroAds = null, erroFaturas = null, erroVendasBrutas = null, erroRepasse = null, erroAfiliados = null, erroSaude = null;
        let an = null, pr = null, co = null, fu = null, ad = null, rp = null, af = null, al = null, pv = null, erroPosVenda = null, fiscalCedo = null, erroVendasAnuncio = null;
        try {
            diario = abreDiario();
            if (feita('anuncios')) an = { sellerId: cic.conta, retomada: true };   // v2.10: anúncios já lidos neste ciclo
            else if (!(await SHC.mlPermitidoAgora())) an = { falha: 'sem_consentimento' };   // 3.3.1 (C2): desligou em Ajustes entre a entrada e aqui
            else {
                await comeca('anuncios');
                an = await sincronizarAnuncios(progresso);
                // Bloqueio 5: as famílias abertas (JSON sem dono) e os pausados não dizem a conta → conferência forçada antes de valer.
                // Outra conta (ou página de outro dono no meio da leitura): nada do que a etapa gravou fica (diário).
                if (an.falha === 'outra_conta' || (!an.falha && an.sellerId && an.sellerId !== 'atual' && !(await contaSegue(an.sellerId, true)))) {
                    await desfazDiario(diario).catch(() => {});
                    if (cic) await limpaCiclo(cic, 'anuncios').catch(() => {});
                    an = { falha: 'outra_conta' };
                } else if (!an.falha && provou(an.sellerId)) { provada = true; diario.antes = new Map(); }   // só 'mesma' prova (página sem dono não)
            }
            if (an.falha) { erro = codigo(an.falha); await termina('anuncios', 'erro', null, erro); }   // 'sem_sessao' só quando o ML mandou para o login
            else {
                if (cic && !an.retomada) cic.conta = an.sellerId;
                if (!an.retomada) { const antes = await termina('anuncios', 'ok', SHC.resumoLeituraAnuncios(an.snap), null, an); if (!provada) semProva.push({ id: 'anuncios', antes }); }   // F20: "… · li X de Y linhas do ML"
                const conta = an.sellerId;
                contaSync = conta;
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
                    r => (r.semAba ? ADS_SEM_ABA : r.temAds ? (r.campanhasCompleto === false && r.totalCampanhas ? (r.campanhas || []).length + ' de ' + r.totalCampanhas + ' campanhas (leitura parcial)' : Q((r.campanhas || []).length, 'campanha', 'campanhas')) + ' · ' + Q((r.anuncios || []).length, 'anúncio', 'anúncios')
                        + (r.completo === false && r.totalAnuncios ? ' de ' + r.totalAnuncios + ' (leitura parcial)' : '') : 'Nenhuma campanha no Mercado Ads'));   // #24: parcial não passa por completo
                ad = e.r || null; erroAds = e.erro || null;
                e = await etapa('posvenda', () => sincronizarPosVenda(conta), resumoPosVenda);
                pv = e.r || null; erroPosVenda = e.erro || null;
                e = await etapa('vendasAnuncio', () => sincronizarVendasAnuncio(conta, progresso, 'recentes'), resumoVendasAnuncio);   // v2.6: famílias
                erroVendasAnuncio = e.erro || null;
                try { await completarSkusRetrato(conta); } catch (x) { /* só completa SKU: falha não para a sincronização */ }
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
                // v3.2: + 1 GET da lista de Vendas (venda nova no prejuízo → prejuizo:<conta>); se falhar, fica o de antes.
                e = await etapa('alertas', async () => { try { await sincronizarRadar(conta, progresso); } catch (x) { /* radar é derivado */ }
                    try { await sincronizarVendasPrejuizo(conta, progresso); } catch (x) { /* derivado: nunca derruba os alertas */ }
                    return atualizarAlertas(conta); },
                    r => (r.anomalias && r.anomalias.total ? SHC.qtd(r.anomalias.total, 'ponto de atenção', 'pontos de atenção') : 'Nada pede sua atenção agora'));
                al = e.r || null;
                // v3.3 multi-empresa: no fim, 1 conferência SEM o guardado (a troca entre duas conferências não passa sem ser vista).
                await conferirConta(true);
                if (trocou) erro = 'outra_conta';
            }
        } catch (e) { erro = String((e && e.message) || e); }
        // Diário: com a troca, o que ainda foi gravado depois dela (entre etapas) também sai; o ícone volta ao número guardado.
        if (trocou) { await desfazDiario(diario).catch(() => {}); seloAgora().catch(() => {}); }
        fechaDiario(diario);
        // Revisão 07/10/2026: os meses lidos nesta rodada voltam para a fila só agora, com o diário FECHADO (dentro dele, o desfazDiario do fim
        // desfazia o próprio marcaReler e o mês lido com a sessão da outra conta continuava "lido").
        if (trocou && contaSync) await marcaReler(contaSync, st.inicio || Date.now()).catch(() => {});

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
            .forEach(([id, r]) => { const x = r && !r.falha && !r.retomada && st.etapas[id].estado !== 'erro' ? PATCH_ETAPA[id](r) : null; if (x) Object.assign(st, x); });   // desfeita pela troca: fora
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
        resumosDevidos(Date.now()).catch(() => {});   // v3.2: o resumo que esperava as vendas de hoje (vb.ts) sai agora
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
        // 3.3.1 (C2): sem o "Concordo e ligar" do ML o histórico também não lê — e o alarme para de tentar.
        if (!(await SHC.mlPermitidoAgora())) { alarmeHist(false); return null; }
        const conta = await SHC.contaAtual();
        if (!conta || conta === 'atual') return null;
        const rodadas = (((await SHC.lerStatus()).historico) || {}).rodadas || 0;
        let h = await historicoConta(conta);
        if (!h.falta || rodadas >= HIST_RODADAS_MAX) { alarmeHist(false); await gravaHistorico(Object.assign(h, { lendo: false, rodadas })); return h; }
        // 1 GET: a sessão do ML aberta agora ainda é desta conta (nunca grava o histórico de uma conta na outra).
        // Sessão caída (login/indisponível/outra conta): conta a rodada e desliga o alarme no teto (antes: 1 GET a cada 5 min sem fim).
        const sessao0 = await confereSessao(conta);
        if (sessao0 && sessao0 !== 'mesma') { await gravaHistorico(Object.assign(h, { lendo: false, rodadas: rodadas + 1 })); if (rodadas + 1 >= HIST_RODADAS_MAX) alarmeHist(false); return h; }
        alarmeHist(true);
        await gravaHistorico(Object.assign(h, { lendo: true, rodadas }));
        // Andamento: recalcula "N de 12" no máximo a cada 3 s; nas outras chamadas só mantém o worker acordado. O diagnóstico por mês
        // (conta.meses) vai para a etapa correspondente do status.
        let ultima = Date.now(), etapaHist = 'faturamento', trocouHist = false;
        const inicioHist = Date.now(), diag = {};
        const anda = async (patch, conta_) => {
            if (conta_ && conta_.meses) diag[etapaHist] = juntaMeses(diag[etapaHist], conta_.meses);
            // v3.3 (multi-empresa): o login mudou no meio do histórico → para antes do próximo pedido (histParar) e os meses desta rodada voltam à fila.
            if (!histParar && !(await contaSegue(conta))) { histParar = true; trocouHist = true; }
            if (Date.now() - ultima < 3000 || histParar) return bateVivo(null);
            ultima = Date.now();
            await gravaHistorico(Object.assign(await historicoConta(conta), { lendo: true, rodadas }), diag);
        };
        const lido = {}, diario = abreDiario();   // bloqueio 5: o que esta rodada grava, para desfazer se a sessão era de outra conta
        try {
            lido.cobrancas = await sincronizarCobrancas(conta, anda, 'historico');
            etapaHist = 'vendasAnuncio';
            if (!histParar) lido.vendasAnuncio = await sincronizarVendasAnuncio(conta, anda, 'historico');
            etapaHist = 'faturas';
            if (!histParar) lido.nfe = await sincronizarNfe(conta, anda, 'historico');
            if (!histParar) await gravarRateio(conta).catch(() => {});   // meses novos no rateio das faturas
        } catch (e) { lido.erro = String((e && e.message) || e); /* o que foi gravado por mês fica; o resto na próxima vez */ }
        // Bloqueio 5: no fim, 1 conferência SEM o guardado de 1 min (a troca no último minuto da rodada passava): mês lido com a sessão de
        // outra conta não fica como lido nesta — o gravado na rodada é desfeito e os meses voltam para a fila.
        if (!trocouHist && !(await contaSegue(conta, true))) { histParar = true; trocouHist = true; }
        if (trocouHist) await desfazDiario(diario).catch(() => {});
        fechaDiario(diario);
        if (trocouHist) { await marcaReler(conta, inicioHist).catch(() => {}); lido.erro = 'outra_conta'; }
        h = await historicoConta(conta);
        h.lido = lido;
        await gravaHistorico(Object.assign(h, { lendo: false, rodadas: histParar ? rodadas : rodadas + 1 }), diag);
        if (!histParar) { if (!h.falta || rodadas + 1 >= HIST_RODADAS_MAX) alarmeHist(false); if (!emAndamento) await atualizaAlertasStatus(conta).catch(() => {}); }   // mês que não respondeu: mais 1 rodada em 5 min (até 3); depois só na próxima sincronização
        return h;
    })().finally(() => { historicoEm = null; histParar = false; });
    return historicoEm;
}

