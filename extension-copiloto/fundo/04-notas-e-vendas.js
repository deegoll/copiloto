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
        // F4: id = MLB|SKU — a tabela traz uma linha por variação do mesmo MLB; com id = MLB, as variações sumiam como "repetidas".
        return r.porAnuncio.map(a => Object.assign({ id: a.itemId + '|' + (a.sku || '') }, a));
    };
    const p1 = await pagina(1);
    if (p1.falha) return p1;
    const r = await SHC.paginasEmParalelo(p => (p === 1 ? Promise.resolve(p1) : pagina(p)), { limite: VA_LINHAS, max: paginas, paralelo: VA_PARALELO });
    if (r.falha) return { falha: r.falha };
    if (!r.linhas.length) return vbMes && vbMes.valor === 0 ? { porAnuncio: {}, itens: {}, paginas, linhas: 0 } : { falha: 'vazio' };
    if (paginas > 1 && r.linhas.length <= (paginas - 1) * VA_LINHAS) return { falha: 'incompleto' };   // o ML repetiu ou pulou página
    const porAnuncio = {}, itens = {};
    // A tabela pode trazer uma linha por variação (mesmo MLB, SKU de cada uma): SOMA no MLB (F4; antes a última linha sobrescrevia)
    // e guarda cada variação em porVariacao[SKU] = {bruto, unidades}. As visitas são do anúncio: a maior, não a soma.
    r.linhas.forEach(a => {
        const n = v => SHC.num(v) || 0, pa = porAnuncio[a.itemId];
        if (!pa) porAnuncio[a.itemId] = { bruto: a.bruto, unidades: a.unidades, vendas: a.vendas, visitas: a.visitas, sku: a.sku || '' };
        else Object.assign(pa, { bruto: SHC.r2(n(pa.bruto) + n(a.bruto)), unidades: n(pa.unidades) + n(a.unidades), vendas: n(pa.vendas) + n(a.vendas), visitas: Math.max(n(pa.visitas), n(a.visitas)) });
        if (a.sku) { const p = porAnuncio[a.itemId], v = (p.porVariacao || (p.porVariacao = {}))[a.sku] || (p.porVariacao[a.sku] = { bruto: 0, unidades: 0 }); v.bruto = SHC.r2(v.bruto + n(a.bruto)); v.unidades += n(a.unidades); }
        const x = itens[a.itemId] || (itens[a.itemId] = { sku: '', titulo: a.titulo || '', skus: [] });
        if (a.sku) { if (!x.sku) x.sku = a.sku; if (x.skus.indexOf(a.sku) < 0) x.skus.push(a.sku); }
    });
    // porVariacao só quando há mais de uma variação (anúncio simples fica igual ao de antes).
    Object.values(porAnuncio).forEach(p => { if (p.porVariacao && Object.keys(p.porVariacao).length < 2) delete p.porVariacao; });
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
    const vb = await SHC.lerVendasBrutas(sellerId), inicio = Date.now(), novos = {}, itens = {}, diag = {}, naoLidos = [], cortados = [], vazios = [];
    let login = false, parado = false, seguidas = 0;
    const grava = () => mudaChave(k, v => {
        v.meses = Object.assign({}, v.meses || {}, novos);
        Object.keys(v.meses).forEach(m => { if (treze.indexOf(m) < 0) delete v.meses[m]; });
        v.itens = SHC.juntaItensVendas(v.itens || {}, itens);   // soma os skus[] do gravado e do lido agora (não troca o anúncio inteiro)
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
        // #23 (ao vivo 01/10/2026): no dia 1º o mês atual vem com a tabela vazia ("Não há vendas para mostrar neste período") e era o
        // único mês da sincronização → "o ML não respondeu" em toda sincronização do dia. Tabela vazia é resposta: não conta como ML fora.
        if (r.falha === 'vazio') { vazios.push(m); seguidas = 0; continue; }
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
        Object.assign(itens, SHC.juntaItensVendas(r.itens, itens));   // os meses vêm do mais novo ao mais antigo: vale o sku/título do mais novo, os skus[] se somam
        if (hist) await grava();   // segundo plano (sem ciclo): o mês lido fica gravado mesmo se o worker morrer no próximo
    }
    const lidos = Object.keys(novos);
    if (!lidos.length && naoLidos.length && !parado) return { falha: login ? 'login' : 'indisponivel', diag };   // nada respondeu: o que havia fica
    const snap = await grava();
    const noAtual = ((snap.meses[atual] || {}).porAnuncio) || {};
    return { meses: lidos.length - cortados.length, de: meses.length, naoLidos, cortados, vazios, diag, mesesLidos: snap.mesesLidos.length, parado,
        anuncios: Object.keys(noAtual).filter(id => (+(noAtual[id] || {}).bruto || 0) > 0).length };
}
// "13 meses · 142 anúncios com venda no mês" ou "11 de 13 meses lidos · dez/25 e mai/26 não responderam (tento de novo na próxima)"
// Mês cortado (vendas demais): " · set/26 lido só em parte (vendas demais para ler inteiro)".
function resumoVendasAnuncio(r) {
    const nl = r.naoLidos || [], ct = r.cortados || [];
    const parte = (ct.length ? ' · ' + ct.map(mesCurto).join(' e ') + ' lido' + (ct.length > 1 ? 's' : '') + ' só em parte (vendas demais para ler inteiro)' : '')
        + ((r.vazios || []).length ? ' · ' + r.vazios.slice(0, 3).map(mesCurto).join(', ') + (r.vazios.length > 3 ? ' e mais ' + (r.vazios.length - 3) : '') + ': o ML ainda não mostra venda por anúncio' : '');
    if (nl.length) return resumoFaturamento({ meses: r.meses, de: r.de, naoLidos: nl, lidas: 0 }) + parte;
    return SHC.qtd(r.mesesLidos || 0, 'mês', 'meses') + ' · ' + SHC.qtd(r.anuncios || 0, 'anúncio com venda no mês', 'anúncios com venda no mês') + parte;
}

