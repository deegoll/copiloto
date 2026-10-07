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
        await migrarPorFatura(sellerId).catch(() => {});
    }
    const marca = 'ml:cobrancas:' + sellerId, antes = (await SHC.lerChave(marca)) || {}, hoje = SHC.hoje(), atual = hoje.slice(0, 7), anterior = mesAntes(atual, 1);
    const doze = SHC.janelasCobranca(hoje, true), recentes = new Set(SHC.janelasCobranca(hoje, false).map(j => j.mes));
    // Mês já lido (ou cortado pelo limite de páginas) não é relido, fora os dos últimos ~40 dias.
    // v2.10: na retomada vale a lista de ANTES do ciclo (os meses lidos antes da queda entram de novo, vindos do guardado, sem pedido ao ML):
    // o fechamento, o frete por pedido e o "para conferir" saem iguais aos de uma leitura sem queda.
    const base = ciclo && antes.ciclo && antes.ciclo.id === ciclo.id ? antes.ciclo.feitos : [...(antes.mesesLidos || []), ...(antes.incompletos || [])];
    const feitos = new Set(base), marcaCiclo = ciclo ? { id: ciclo.id, feitos: base } : undefined;
    // v2.11: cobranças guardadas do mês atual e do anterior (leitura a partir dos dias novos; o "para conferir" do mês não relido).
    // cortadoEm (v3.3): o dia em que cada mês cortado (80+ páginas) foi lido — marcaReler põe na fila o cortado depois de uma troca de conta.
    const lidoEm = Object.assign({}, antes.lidoEm), cortadoEm = Object.assign({}, antes.cortadoEm), guard = {};
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
        // v3.4: guardadas por versão anterior (sem a fatura de cada cobrança) não servem: o mês é lido inteiro de novo.
        const g = guard[j.mes] && guard[j.mes].linhas.every(c => c && c.fatura !== undefined) ? guard[j.mes] : null;
        const de = g && g.ate >= j.de ? [j.de, diaMenos(g.ate, COB_INC_DIAS)].sort()[1] : j.de;
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
        if (r.cortado) { cortados.add(j.mes); cortadoEm[j.mes] = hoje; } else { cortados.delete(j.mes); delete cortadoEm[j.mes]; lidos.add(j.mes); lidosAgora.push(j.mes); lidoEm[j.mes] = hoje; }
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
            // v3.4: Ads E Publicidade de Seguidores (c.tipo é 'outro' no Seguidores: o tipo do fechamento sai do texto). Antes o Seguidores
            // do último dia sumia do mês lido sozinho (ao vivo: 9,73 de 31/07 fora da publicidade da fatura de agosto).
            if (!px.falha) todas.push(...px.linhas.filter(c => /^ads(_seguidores)?$/.test(SHC.tipoCustoFechamento(c.texto, c.id)) && String(c.dataRef || '').slice(0, 7) === j.mes));
        }
        if (!r.cortado) await gravarFechamento(sellerId, todas, [j.mes]);
        await SHC.salvarPendentes(sellerId, res.pendentes);
        [lidoEm, cortadoEm].forEach(o => Object.keys(o).forEach(m => { if (!doze.some(x => x.mes === m)) delete o[m]; }));
        await SHC.gravarChave(marca, { completo12: doze.every(x => lidos.has(x.mes) || cortados.has(x.mes)), ate: hoje, ts: Date.now(),
            incompletos: [...cortados].sort(), mesesLidos: [...lidos].sort().slice(-13), lidoEm, cortadoEm, ciclo: marcaCiclo, releer: [...releer].sort() });
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
        // Revisão 07/10/2026 (cada centavo): o cheio (antes do desconto do ML) baixa junto, como no SHC.freteDasCobrancas quando lê a tarifa e
        // o estorno juntos (cheio = máx(cobrado, cheio − estornos)); antes ficava inteiro e o estorno aparecia como "Desconto do ML no frete".
        // cheioBruto = o cheio de antes de qualquer estorno (como o bruto): a releitura não desconta 2 vezes. Sem cheio (aprox), fica sem.
        const comCobranca = new Set(cobs.filter(c => c && /^frete/.test(c.tipo) && c.tipo !== 'frete_estorno').map(c => c.orderId));
        cobs.forEach(c => {
            const p = c && c.tipo === 'frete_estorno' && c.orderId && !comCobranca.has(c.orderId) ? pedidos[c.orderId] : null;
            if (!p || (p.cancelado && !p.est)) return;
            const est = Object.assign({}, p.est), bruto = typeof p.bruto === 'number' ? p.bruto : p.cobrado;
            const cheioBruto = typeof p.cheioBruto === 'number' ? p.cheioBruto : typeof p.cheio === 'number' ? p.cheio : null;
            const kEst = c.id || (c.data + '|' + c.valor), linhas = p.linhas && !(kEst in est) ? p.linhas.concat({ t: c.texto, v: c.valor, d: c.data, e: 1 }) : p.linhas;
            est[kEst] = c.valor;
            const somaEst = Object.keys(est).reduce((t, k) => t + est[k], 0), resto = SHC.r2(bruto - somaEst);
            pedidos[c.orderId] = Object.assign({}, p, { bruto, est }, cheioBruto !== null ? { cheioBruto } : {}, linhas ? { linhas } : {}, resto > 0.004
                ? Object.assign({ cobrado: resto, cancelado: false }, cheioBruto !== null ? { cheio: Math.max(resto, SHC.r2(cheioBruto - somaEst)) } : {})
                : { cobrado: 0, cheio: 0, formato: 'cancelado', cancelado: true });
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
    // v3.3: frete do anúncio no dia de cada venda (fh|ml) = a régua do "cobrado a mais" (antes: o frete de hoje para os 30 dias inteiros).
    const idsFr = [...new Set(arr.map(p => p.itemId).concat(varr.map(v => v.itemId)).filter(id => id && porItem[id]))];
    const fretesDia = vendasLidas && idsFr.length && SHC.lerFretes ? await SHC.lerFretes(idsFr).catch(() => null) : null;
    const snap = Object.assign({ ts: Date.now(), fonte: arr.some(p => !p.aprox) ? 'faturamento' : (arr.length ? 'guardado' : 'nada'), aprox: arr.filter(p => p.aprox).length,
        vendasLidas, semLeitura }, hist, { conciliacao: vendasLidas ? SHC.conciliaFrete(arr, porItem, varr, hoje, fretesDia) : null,
        // v3.2: ida = frete de envio da mesma venda; freteEstornado = o ML devolveu o frete do envio (venda cancelada) → contestação da tarifa de devolução.
        devolucoes: SHC.devolucoesResumo(Object.keys(devs).map(k => Object.assign({ pedido: k }, devs[k], pedidos[k] && pedidos[k].cancelado ? { freteEstornado: true }
            : pedidos[k] && pedidos[k].cobrado > 0 ? { ida: pedidos[k].cobrado } : {})), hoje) });
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
    // v3.3: valor = só o que dá para pedir de volta (como o "Dá para recuperar"); as dúvidas ("pode estar certo") contam em qtd, sem R$.
    // 3.3.0, trava do frete: todo frete de envio também (SHC.fech.freteSemChamado), como no total do Fechamento.
    const snap = { ts: Date.now(), meses, qtd: lista.length, valor: SHC.r2(lista.reduce((s, x) => s + (x.duvida || SHC.fech.freteSemChamado(x) ? 0 : x.diferenca || 0), 0)), itens: lista.slice(0, 100) };
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
// ── v3.4: migração ÚNICA por conta (shc:migra:porFatura). O "Confere com a fatura do ML" linha por linha precisa da fatura de cada cobrança
// (fech.porFatura, SHC.fechamentoDasCobrancas). Os 3 meses fechados mais recentes lidos sem ela vão para `releer` (mesmo caminho da
// migrarPorDiaTipo). ponytail: só 3 meses (o cartão mostra a última fatura fechada); fatura mais antiga fica no ciclo por data.
async function migrarPorFatura(conta) {
    const kM = 'shc:migra:porFatura', feitas = (await SHC.lerChave(kM)) || {};
    if (!conta || conta === 'atual' || feitas[conta]) return false;
    const k = 'ml:cobrancas:' + conta, marca = await SHC.lerChave(k), atual = SHC.hoje().slice(0, 7), desde = mesAntes(atual, 3), velhos = [];
    for (const m of ((marca && marca.mesesLidos) || []).filter(m => m < atual && m >= desde)) {
        const f = await SHC.lerChave(SHC.chaveFech(conta, m));
        if (f && (!f.porFatura || f.semFatura) && (!f.porDia || Object.keys(f.porDia).length)) velhos.push(m);   // mês sem cobrança não precisa
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
        const f = fech[m] || { mes: m, porTipo: {}, porDia: {}, estornos: 0, total: 0, qtdVendas: 0, pedidos: {}, tipos: SHC.FECH_TIPOS_VERSAO, porFatura: {} };
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

