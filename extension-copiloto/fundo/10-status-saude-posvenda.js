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
// empresa (opcional, v3.3): a empresa do começo (SHC.empresaSeparada). Revisão 07/10/2026: a leitura do ERP leva minutos e a conta do ML pode
// mudar no meio — credencial, retrato do ERP e custos são lidos e gravados SEMPRE na empresa do começo (SHC.areaEmpresa(empresa)).
function sincronizarCustos(erp, intervaloMs, empresa) {
    const E = ERPS[erp] || ERPS.tiny;
    // Outro ERP lendo agora: espera ele acabar e então lê ESTE (a resposta é sempre do ERP pedido, nunca a do outro).
    if (custosAndando) return custosAndando.catch(() => {}).then(() => sincronizarCustos(erp, intervaloMs, empresa));
    custosAndando = (async () => {
        const e0 = typeof empresa === 'string' ? empresa : await SHC.empresaSeparada(), A = SHC.areaEmpresa(e0);
        const ler = async k => (await A.get(k))[k] || null, gravar = (k, v) => A.set({ [k]: v });
        const t = await ler(E.chave()), cred = E.cred(t);
        if (!cred) return { semToken: true, erp };
        let pode = false;
        try { pode = !!(chrome.permissions && await chrome.permissions.contains({ origins: [].concat(E.origem()) })); } catch (e) { /* sem permissão */ }
        if (!pode) return { semPermissao: true, erp };
        if (intervaloMs && t.ultima && Date.now() - (t.ultima.ts || 0) < intervaloMs) return { recente: true, erp, ultima: t.ultima };
        try {
            await custosProgresso({ erp, feito: 0, de: null, unidade: 'páginas' });
            const produtos = await E.puxar(cred, { fetch: (u, i) => fetch(u, comTempo(i)), espera, empresa: e0, progresso: (pg, pgs) => { custosProgresso({ erp, feito: pg, de: pgs, unidade: 'páginas' }).catch(() => {}); } });
            // v3.2: retrato do ERP para o cruzamento ERP × ML (erp:produtos:<erp>, mesma forma nos 3 ERPs). SKU repetido: o ATIVO vale por
            // último no custo (o Bling agora traz também os inativos, criterio=5).
            await gravar('erp:produtos:' + erp, { ts: Date.now(), itens: SHC.erpNormaliza(produtos) });
            produtos.sort((a, b) => (b.situacao === 'I') - (a.situacao === 'I'));   // inativos primeiro (sort estável)
            const r = await SHC.tinyGravar(produtos, erp, { empresa: e0 });   // a tabela mostra de qual ERP veio
            if (produtos.porFaixa) r.porFaixa = produtos.porFaixa;   // F5: Bling — quantos vieram com estoque positivo, zerado e negativo
            // SKUs sem custo e cruzamento ERP × ML: só com a mesma empresa aberta (são da conta aberta; a outra empresa tem o ERP dela).
            const mesma = (await SHC.empresaSeparada()) === e0;
            r.faltam = mesma ? await skusSemCusto() : null;
            const agora = await ler(E.chave());   // desconectou no meio: não volta a guardar a credencial
            if (E.mesma(E.cred(agora), cred)) await gravar(E.chave(), Object.assign({}, agora, { ultima: Object.assign({ ts: Date.now() }, r) }));
            // Cruzamento ERP × ML em todas as contas. 1ª importação depois de conectar (sem "ultima" antes): o painel abre a janela do resumo.
            if (mesma) await erpConferirTodas({ avisar: !(t && t.ultima) }).catch(() => {});
            if (r.atualizados && mesma) await atualizarAlertas().catch(() => {});
            return Object.assign({ ok: true, erp, resumo: E.resumo(r) }, r);
        } catch (e) {
            if (erp === 'bling' && e && e.erro === 'reconectar') await salvarBling(cred, null, e0).catch(() => {});   // refresh vencido: some o token, o painel pede "Conectar de novo"
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
// v3.3 (multi-empresa, auditoria 07/10/2026): trocar o login do ML no meio da sincronização (ou do histórico em segundo plano) fazia a conta
// nova ser gravada nas chaves da antiga — e o mês fechado lido assim não era mais relido. contaSegue(conta) confere a sessão (confereSessao)
// no máximo 1 vez a cada CONTA_CONFERE_MS; false só com PROVA de outra conta (a página diz o dono e é outro). Sessão caída não é troca.
const CONTA_CONFERE_MS = 60e3;
let contaConferida = { conta: '', ts: 0, ok: true };
async function contaSegue(conta, forcar) {
    if (!conta || conta === 'atual') return true;
    const agora = Date.now();
    if (!forcar && contaConferida.conta === conta && agora - contaConferida.ts < CONTA_CONFERE_MS) return contaConferida.ok;
    let r = '';
    try { r = await confereSessao(conta); } catch (e) { r = 'indisponivel'; }
    contaConferida = { conta, ts: Date.now(), ok: r !== 'outra_conta' };
    return contaConferida.ok;
}
// Depois de uma troca de conta no meio da leitura: os meses lidos desde `desde` (ms) podem ter dados da outra conta → voltam para a fila de
// leitura desta conta (ml:cobrancas.releer e vbAnuncio.meses[m].completo = false). Nada é apagado: a próxima leitura da conta certa substitui.
async function marcaReler(conta, desde) {
    if (!conta || conta === 'atual' || !(desde > 0)) return;
    // lidoEm/cortadoEm são o dia LOCAL do Chrome (SHC.hoje). Revisão 07/10/2026: comparar com o dia de Brasília perdia, fora do UTC−3, os meses
    // lidos perto da meia-noite → vale o MENOR dos dois (na dúvida, relê a mais).
    const d = new Date(desde), local = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const dia = [local, new Date(desde - 3 * 3600e3).toISOString().slice(0, 10)].sort()[0];
    const kc = 'ml:cobrancas:' + conta, mc = await SHC.lerChave(kc);
    if (mc) {
        const desdeDia = o => Object.keys(o || {}).filter(m => String(o[m] || '') >= dia);
        const re = desdeDia(mc.lidoEm).concat(desdeDia(mc.cortadoEm));   // cortado (80+ páginas) também: tem cobranças da conta errada
        if (re.length) await SHC.gravarChave(kc, Object.assign({}, mc, { releer: [...new Set((mc.releer || []).concat(re))].sort() }));
    }
    // Vendas brutas (vb:<conta>): mês lido depois da troca sai de mesesLidos (o atual e o anterior já são relidos sempre). Na fila do vb.
    await emFilaVb(async () => {
        const kb = 'vb:' + conta, vb = await SHC.lerChave(kb), ts = (vb && vb.lidoTs) || {};
        const sai = Object.keys(ts).filter(m => ts[m] >= desde);
        if (!sai.length) return;
        const mesesLidos = (vb.mesesLidos || []).filter(m => sai.indexOf(m) < 0);
        await SHC.gravarChave(kb, Object.assign({}, vb, { mesesLidos, completo13: false }));
    }).catch(() => {});
    const kv = 'vbAnuncio:' + conta, va = await SHC.lerChave(kv);
    if (va && va.meses) {
        let mudou = false;
        const meses = Object.assign({}, va.meses);
        Object.keys(meses).forEach(m => { const x = meses[m]; if (x && x.completo && (x.lidoTs || 0) >= desde) { meses[m] = Object.assign({}, x, { completo: false }); mudou = true; } });
        if (mudou) await SHC.gravarChave(kv, Object.assign({}, va, { meses, mesesLidos: (va.mesesLidos || []).filter(m => !(meses[m] && meses[m].completo === false)) }));
    }
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
    const fl = SHC.posvendaReclamacoesDoFlox(est), ant = await SHC.lerChave('posvenda:' + sellerId);
    if (fl && fl.lista) Object.assign(r, { casos: fl.casos.map(c => { const x = Object.assign({}, c); delete x.pedido; delete x.claimId; delete x.descricao; return x; }), paginas: fl.paginas, casosTs: r.ts });
    else if (ant && Array.isArray(ant.casos)) Object.assign(r, { casos: ant.casos, paginas: ant.paginas || null, casosTs: ant.casosTs || ant.ts });
    // v3.2: nº do pedido (da venda do seller, não do comprador) → motivo/responsabilidade, só para cruzar com a tarifa de devolução do mesmo pedido.
    const pp = SHC.posvendaJuntaPorPedido(ant && ant.porPedido, fl && fl.lista ? fl.casos : []);
    if (pp) r.porPedido = pp;
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

