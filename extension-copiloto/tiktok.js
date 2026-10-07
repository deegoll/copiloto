// Copiloto · TikTok Shop (3.2.0): o que a captura passiva recebe vira dado guardado por loja e a conta de lucro e repasse.
// REGRA DO CANAL (Termos do Vendedor BR: nada de robô): o Copiloto NÃO chama o TikTok, nem GET, NÃO navega sozinho e NÃO tem alarme
// para o TikTok. Ele só lê a resposta que a própria tela do Seller Center já recebeu (tiktok-pagina.js → tiktok-tela.js → aqui).
// As contas são do copiloto-nucleo: a pasta nucleo/ é uma CÓPIA byte a byte de copiloto-nucleo/src (o Chrome só carrega arquivos de
// dentro da extensão; teste_tiktok_nucleo.js confere). Mudou o núcleo? Copie de novo os 7 arquivos de SHC.tt.NUCLEO.
// Carregar DEPOIS de nucleo/*.js (CopilotoNucleo) e de calc.js + store.js (SHC: custo por SKU e kit).
//
// Gravado por loja (a aba lê por SHC.tt.ler + SHC.tt.resumo; tiktok-aba.js só desenha):
//   tt:conta                  → última loja vista (oec_seller_id da URL; sem ele, 'tiktok')
//   tt:<loja>:ped:<pedido>    → { id, data, lido_em, tela, linhas: {<statement_detail_id>: linha do Financeiro (pedidosDaListaFinanceira)},
//                                 trans: {<id>: extrato do pedido (transacaoDoExtrato)}, trans_sku: {…page_type 9}, det: {pedido, devolucao} (pedidoDoDetalhe) }
//                                 (uma chave por pedido; até 180 dias / 3.000 pedidos)
//   tt:<loja>:extratos        → { lista: Repasse[], lido_em, tela }        tt:<loja>:saldo → { valor, lido_em, tela }
//   tt:<loja>:areceber        → { total, motivos:[{motivo:'em_transito'|'devolucao'|'entregue_no_prazo', codigo:1|2|3, titulo, valor}], prazo_dias, confere, lido_em, tela }
//   tt:<loja>:saude           → { indicadores: Saude[], pontos|null, perf, prazo, viol, lido_em, tela }
//   tt:<loja>:afil            → { mensagens, sem_amostra, amostras, itens, lido_em, tela }
//   tt:<loja>:camp            → { abertas:[{id, titulo, inscrita, inscricao_ate, inicio, fim}], inscritas, lido_em, tela }
//   tt:<loja>:skumap          → { <sku_id>: '<SKU do vendedor>' }
//   c|tiktok|<sku_id>         → custo digitado na aba ({custo, outros?}) ou "ligar ao SKU" ({sku})
// Nada do comprador é guardado (tiktok-pagina.js tira os campos; aqui o filtro do núcleo passa só a lista do que PODE).
(function (root) {
    'use strict';
    const SHC = root.SHC || (root.SHC = {});
    const CN = root.CopilotoNucleo, N = CN.adaptadores.tiktok, U = CN.util, M = CN.modelo;
    const area = () => root.chrome.storage.local;
    const TT = SHC.tt = {};

    TT.ORIGEM = 'https://seller-br.tiktok.com/*';
    TT.NUCLEO = ['nucleo/util.js', 'nucleo/modelo.js', 'nucleo/tarifas.js', 'nucleo/motor.js', 'nucleo/conciliacao.js', 'nucleo/adaptador.js', 'nucleo/adaptadores/tiktok.js'];
    /** Tipos que a captura aceita (lista FECHADA, igual à de tiktok-pagina.js e tiktok-tela.js) → nome da tela de origem. */
    TT.TELA = {
        pedidos_fin: 'Financeiro', transacao: 'Financeiro (detalhe do pedido)', extratos: 'Financeiro (extratos)', areceber: 'Financeiro', saldo: 'Financeiro',
        pedido: 'Pedidos', saude_perf: 'Saúde da conta', saude_prazo: 'Saúde da conta', saude_viol: 'Saúde da conta', afil: 'Afiliados',
        camp_rec: 'Promoções', camp_insc: 'Promoções',
    };
    TT.TIPOS = Object.keys(TT.TELA);
    TT.MAX_DIAS = 180;
    TT.MAX_PEDIDOS = 3000;
    TT.contaValida = c => /^(tiktok|\d{5,25})$/.test(String(c || ''));
    const k = (conta, s) => SHC.chaveConta(s, conta, 'tiktok');   // tt:<loja>:<s> (regra do canal na chave: store.js)
    const valores = o => (o && typeof o === 'object' ? Object.keys(o).map(x => o[x]) : []);
    const num = v => (SHC.num ? SHC.num(v) : U.num(v));
    const normSku = s => (SHC.normalizaSku ? SHC.normalizaSku(s) : String(s || '').trim().toUpperCase());

    // Gravações uma de cada vez (duas respostas do mesmo pedido chegando juntas não se atropelam).
    let fila = Promise.resolve();
    const emFila = f => { const p = fila.then(() => f()); fila = p.catch(() => {}); return p; };

    async function chavesCom() {   // chaves que começam com qualquer um dos prefixos (getKeys: Chrome 130+; o mínimo é 137)
        const a = area(), todas = typeof a.getKeys === 'function' ? await a.getKeys() : Object.keys(await a.get(null)), pre = [].slice.call(arguments);
        return todas.filter(x => pre.some(p => x.indexOf(p) === 0));
    }
    let podadoEm = 0;
    /** Guarda no máximo 180 dias e 3.000 pedidos por loja (os mais novos ficam). */
    async function podar(conta, forcar) {
        if (!forcar && Date.now() - podadoEm < 10 * 60e3) return 0;
        podadoEm = Date.now();
        const ks = await chavesCom(k(conta, 'ped:'));
        if (ks.length === 0) return 0;
        const lidos = await area().get(ks), limite = U.somaDias(U.hoje(), -TT.MAX_DIAS);
        const fora = ks.map(x => [x, String((lidos[x] && lidos[x].data) || '')]).sort((a, b) => b[1].localeCompare(a[1]))
            .filter((x, i) => i >= TT.MAX_PEDIDOS || !x[1] || x[1] < limite).map(x => x[0]);
        if (fora.length) await area().remove(fora);
        return fora.length;
    }
    TT.podar = podar;

    /** As linhas do Financeiro do MESMO pedido (ex.: devolução −32,99 num extrato e linha zerada em outro) somadas uma vez. */
    TT.finDoPedido = function (ped) {
        const ls = valores(ped && ped.linhas);
        if (!ls.length) return null;
        const soma = f => (ls.some(l => f(l) === null || f(l) === undefined) ? null : U.soma(ls, f));
        const comSku = ls.filter(l => l.skus && l.skus.length).sort((a, b) => Math.abs(b.receita || 0) - Math.abs(a.receita || 0))[0];
        const reps = ls.map(l => l.repasse), principal = ls.slice().sort((a, b) => Math.abs((b.repasse && b.repasse.valor) || 0) - Math.abs((a.repasse && a.repasse.valor) || 0))[0];
        const pend = ls.find(l => l.estimado);
        return {
            pedido_id: ls[0].pedido_id, data: ls.map(l => l.data).sort()[0], entrega: ls.map(l => l.entrega).filter(Boolean)[0] || null,
            estimado: !!pend, motivo: (pend || principal).motivo || 0, receita: soma(l => l.receita), tarifas_total: soma(l => l.tarifas_total), frete: soma(l => l.frete),
            repasse: reps.some(r => M.ehNaoLido(r)) ? null : U.soma(reps, r => r.valor), repasses: reps.filter(r => !M.ehNaoLido(r)),
            extrato_id: principal.extrato_id || null, extratos: ls.map(l => l.extrato_id).filter(Boolean),
            data_prevista: ls.map(l => l.data_prevista).filter(Boolean).sort().pop() || null,
            canal_venda: ls.map(l => l.canal_venda).filter(Boolean)[0] || null, skus: comSku ? comSku.skus : [], lido_em: Math.max.apply(null, ls.map(l => l.lido_em || 0)),
        };
    };
    const juntaTrans = ped => { const ts = valores(ped && ped.trans); return ts.length ? N.juntaPorPedido(ts)[0] || null : null; };

    /** Dia do pedido (a mais antiga das fontes: é por ele que a poda corta) e de onde veio a leitura mais nova. */
    function carimba(ped) {
        const f = TT.finDoPedido(ped), j = juntaTrans(ped), det = ped.det || null;
        const fontes = [f && { em: f.lido_em, tela: TT.TELA.pedidos_fin }, j && { em: Math.max.apply(null, valores(ped.trans).map(t => t.lido_em || 0)), tela: TT.TELA.transacao },
            det && { em: det.lido_em, tela: TT.TELA.pedido }].filter(Boolean).sort((a, b) => b.em - a.em);
        return Object.assign(ped, { data: [f && f.data, j && j.data, det && det.pedido.data_venda].filter(Boolean).sort()[0] || null,
            lido_em: fontes.length ? fontes[0].em : null, tela: fontes.length ? fontes[0].tela : '' });
    }

    /**
     * Uma resposta capturada → gravada por loja. Resposta que não se reconhece NÃO grava nada (nunca vira zero).
     * → { ok, n (registros), motivo? }
     */
    TT.gravarCaptura = (tipo, dados, conta, lidoEm) => emFila(async () => {
        const r = await gravar(tipo, dados, conta, lidoEm);
        // O TikTok mudou o formato de uma tela: guarda a última falha (só tipo, tela e hora) para a aba avisar. Leu de novo: some.
        try {
            const kf = k(conta, 'falha');
            if (r.motivo === 'nao_reconhecido') await area().set({ [kf]: { tipo, tela: TT.TELA[tipo], em: Date.now() } });
            else if (r.ok) { const x = (await area().get(kf))[kf]; if (x && x.tipo === tipo) await area().remove(kf); }
        } catch (e) { /* o aviso é extra: nunca atrapalha a gravação */ }
        return r;
    });
    async function gravar(tipo, dados, conta, lidoEm) {
        if (TT.TIPOS.indexOf(tipo) < 0 || !TT.contaValida(conta) || !dados || typeof dados !== 'object') return { ok: false, motivo: 'formato' };
        const em = Number(lidoEm) > 0 ? Math.min(Number(lidoEm), Date.now()) : Date.now();
        // Resposta de erro do TikTok (sessão caiu, limite etc.) não é "tela mudou": não vira aviso.
        const falhou = typeof dados.code === 'number' && dados.code !== 0 ? { ok: false, motivo: 'erro_tiktok' } : { ok: false, motivo: 'nao_reconhecido' };
        const carimbo = { lido_em: em, tela: TT.TELA[tipo] }, grava = {};
        const ler = async key => (await area().get(key))[key] || null;
        let n = 1;

        if (tipo === 'pedidos_fin' || tipo === 'transacao' || tipo === 'pedido') {
            let mapa = (await ler(k(conta, 'skumap'))) || {}, novoMapa = false;
            const mexe = {};   // pedido_id → função que altera as fontes guardadas
            if (tipo === 'pedidos_fin') {
                const regs = N.pedidosDaListaFinanceira(dados, { conta });
                if (M.ehNaoLido(regs)) return falhou;
                regs.forEach(r => { const antes = mexe[r.pedido_id]; mexe[r.pedido_id] = p => { if (antes) antes(p); p.linhas = Object.assign({}, p.linhas, { [M.ehNaoLido(r.repasse) ? r.pedido_id : r.repasse.id]: Object.assign(r, carimbo) }); }; });
                n = regs.length;
            } else if (tipo === 'transacao') {
                const t = N.transacaoDoExtrato(dados, { conta });
                if (M.ehNaoLido(t) || !t.pedido_id) return falhou;
                const d = dados.data || {}, campo = d.sku_record && !d.order_record ? 'trans_sku' : 'trans';   // page_type 9 (1 SKU) não soma com o pedido
                mexe[t.pedido_id] = p => { p[campo] = Object.assign({}, p[campo], { [t.extrato_detalhe_id || 'sem_id']: Object.assign(t, carimbo) }); };
            } else {
                const r = N.pedidoDoDetalhe(N.filtroPedidoSemComprador(dados), { conta });   // o filtro passa só o que PODE (nada do comprador)
                if (M.ehNaoLido(r.pedido)) return falhou;
                mexe[r.pedido.id] = p => { p.det = Object.assign({ pedido: r.pedido, devolucao: r.devolucao, avisos: r.avisos }, carimbo); };
                r.pedido.itens.forEach(it => { if (it.sku && it.anuncio_id && mapa[it.anuncio_id] !== it.sku) { mapa = Object.assign({}, mapa, { [it.anuncio_id]: it.sku }); novoMapa = true; } });
            }
            const ids = Object.keys(mexe), keys = ids.map(id => k(conta, 'ped:' + id)), atual = await area().get(keys);
            ids.forEach((id, i) => { const p = Object.assign({ id }, atual[keys[i]] || {}); mexe[id](p); grava[keys[i]] = carimba(p); });
            if (novoMapa) grava[k(conta, 'skumap')] = mapa;
        } else if (tipo === 'extratos') {
            const rs = N.repassesDosExtratos(dados, conta);
            if (M.ehNaoLido(rs)) return falhou;
            const cur = (await ler(k(conta, 'extratos'))) || {}, porId = {};
            (cur.lista || []).concat(rs).forEach(r => { porId[r.id] = r; });
            const lista = valores(porId).sort((a, b) => String(b.data_liberada || b.data_prevista || '').localeCompare(String(a.data_liberada || a.data_prevista || ''))).slice(0, 200);
            grava[k(conta, 'extratos')] = Object.assign({ lista }, carimbo);
            n = rs.length;
        } else if (tipo === 'areceber') {
            const a = N.aReceberPorMotivo(dados);
            if (M.ehNaoLido(a)) return falhou;
            grava[k(conta, 'areceber')] = Object.assign(a, carimbo);
        } else if (tipo === 'saldo') {
            const s = N.saldoDisponivel(dados);
            if (M.ehNaoLido(s)) return falhou;
            grava[k(conta, 'saldo')] = Object.assign(s, carimbo);
        } else if (tipo === 'afil') {
            const it = N.pendenciasAfiliados(dados);
            if (M.ehNaoLido(it)) return falhou;
            const de = m => { const x = it.find(i => i.metrica === m); return x ? x.num : null; };
            grava[k(conta, 'afil')] = Object.assign({ mensagens: de('creator_message_count'), sem_amostra: de('products_without_sample_count'), amostras: de('sample_request_count'), itens: it }, carimbo);
        } else if (tipo.indexOf('saude_') === 0) {
            const parte = tipo.slice(6), cur = (await ler(k(conta, 'saude'))) || {};
            let x;
            if (parte === 'viol') x = N.violacoes(dados);
            else { const it = N.saudeDaConta(parte === 'perf' ? { performance_list: dados } : { dynamic_settlement: dados }, conta); x = it.length ? { itens: it } : M.naoLido('vazio'); }
            if (M.ehNaoLido(x)) return falhou;
            cur[parte] = Object.assign(x, carimbo);
            cur.indicadores = [].concat((cur.perf && cur.perf.itens) || [], (cur.prazo && cur.prazo.itens) || []);
            cur.pontos = cur.viol ? cur.viol.pontos : null;
            grava[k(conta, 'saude')] = Object.assign(cur, carimbo);
        } else {   // camp_rec | camp_insc
            const c = N.campanhasAbertas(tipo === 'camp_rec' ? dados : null, tipo === 'camp_insc' ? dados : null);
            if (tipo === 'camp_rec' ? c.abertas === null : c.inscritas === null) return falhou;
            const cur = (await ler(k(conta, 'camp'))) || {};
            if (tipo === 'camp_rec') cur.abertas = c.abertas; else cur.inscritas = c.inscritas;
            grava[k(conta, 'camp')] = Object.assign(cur, carimbo);
        }
        grava['tt:conta'] = conta;
        await area().set(grava);
        if (tipo === 'pedidos_fin') await podar(conta);
        return { ok: true, n };
    }

    /** Tudo o que está guardado da loja (padrão: a última vista) + custos (c|sku|, c|tiktok|) e cfg. */
    TT.ler = async function (conta) {
        conta = conta || (await area().get('tt:conta'))['tt:conta'] || null;
        if (!TT.contaValida(conta)) return null;
        // v3.3 multi-empresa (revisão 07/10/2026): custos por SKU e cfg da empresa da conta do ML aberta, como no painel ('c|sku' pega também
        // 'c|sku@<conta>|'; SHC.chaveLogica devolve a chave lógica da empresa aberta e null para a da outra).
        const e = SHC.empresaSeparada ? await SHC.empresaSeparada() : '', logica = x => (SHC.chaveLogica ? SHC.chaveLogica(x, e) : x);
        const pre = k(conta, ''), ks = (await chavesCom(pre, 'c|sku', 'c|tiktok|')).concat(['cfg']);
        const t = await area().get(ks), d = { conta, peds: [], custos: {}, cfg: SHC.lerCfg ? await SHC.lerCfg() : Object.assign({}, SHC.PADRAO || {}, t.cfg || {}) };
        Object.keys(t).forEach(x => {
            if (x.indexOf('c|') === 0) { const l = logica(x); if (l !== null) d.custos[l] = t[x]; }
            else if (x.indexOf(pre + 'ped:') === 0) d.peds.push(t[x]);
            else if (x.indexOf(pre) === 0) d[x.slice(pre.length)] = t[x];
        });
        return d;
    };

    // ── Lucro pelo motor do núcleo ────────────────────────────────────────────────────────────────────────────
    function skuDoItem(skuId, ctx) {
        const lig = (skuId && ctx.custos['c|tiktok|' + skuId]) || null;
        const sku = normSku((lig && lig.sku) || (skuId && ctx.skumap[skuId]) || '');
        return { chave: sku || (skuId ? 'tiktok:' + skuId : ''), sku, lig };
    }
    function custoDoItem(s, ctx) {
        if (s.lig && num(s.lig.custo) > 0) return { custo: num(s.lig.custo), outros: num(s.lig.outros) || 0 };
        const r = s.sku && SHC.custoDeAnuncio ? SHC.custoDeAnuncio(ctx.custos, { sku: s.sku }) : null;
        return r ? { custo: num(r.dados.custo), outros: num(r.dados.outros) || 0 } : null;
    }
    /**
     * Sem o detalhe do pedido: o total de tarifas do TikTok dividido pela tabela do núcleo (comissão, fixo, SFP), com o que sobra em
     * "afiliado/outros (estimado)". Tudo marcado estimado. A soma é SEMPRE o total que o TikTok mostrou (o repasse bate no centavo).
     */
    // fica = parte da venda que ficou com o vendedor (1 = sem reembolso). Com reembolso, comissão e fixo só sobre essa parte; o SFP fica sobre o
    // preço original (regra oficial: não volta na devolução). Item de receita 0 (SKU reembolsado) não gera tarifa (nada de R$ 4 × qtd).
    function tarifasEstimadas(f, itens, id, data, fica) {
        fica = fica >= 0 && fica < 1 ? fica : 1;
        const total = U.r2(f.receita > 0 ? f.receita - f.repasse : -f.repasse), frete = f.frete || 0, semFrete = U.r2(total - frete);
        const base = { pedido_id: id, data, estimada: true }, out = [];
        let est = [];
        itens.forEach(it => {
            if (!est || !(it.total > 0) || !(it.qtd > 0)) return;
            const ls = CN.tarifas.tarifasDoItem('tiktok', it.total / it.qtd, { qtd: it.qtd }, data);
            if (!ls) { est = null; return; }
            ls.forEach(l => { const v = l.tipo === 'programa_frete' ? l.valor : U.r2(l.valor * fica); if (v) est.push({ tipo: l.tipo, valor: v, regra: l.regra + (v !== l.valor ? ' (só a parte que ficou)' : '') }); });
        });
        if (est && est.length && U.soma(est, l => l.valor) <= semFrete + 0.01) {
            est.forEach(l => out.push(Object.assign({ tipo: l.tipo, valor: l.valor, texto_original: 'tabela: ' + l.regra }, base)));
            const resto = U.r2(semFrete - U.soma(est, l => l.valor));
            if (resto !== 0) out.push(Object.assign({ tipo: 'outro', valor: resto, texto_original: fica < 1 ? 'devolução: frete, afiliado e outros (estimado)' : 'afiliado/outros (estimado)' }, base));
        } else if (semFrete !== 0) out.push(Object.assign({ tipo: 'outro', valor: semFrete, texto_original: 'tarifas do TikTok (total)' }, base));
        if (frete !== 0) out.push(Object.assign({ tipo: 'frete_venda', valor: frete, texto_original: 'frete (total do TikTok)' }, base));
        return out;
    }

    /**
     * Lucro de 1 pedido guardado. ctx = { conta, custos (mapa c|…), cfg, skumap }.
     * Com o detalhe do extrato (transaction/detail): tarifas EXATAS. Só com a lista do Financeiro: tarifas estimadas ("estimado").
     * lucro = repasse − custo × qtd − imposto% × (preço − desconto do vendedor) − outros/embalagem. Sem custo → status 'sem_custo'.
     * → resultado do CopilotoNucleo.motor.lucroPedido + { dia, canal_venda, estimado, exato, lido_em, tela, extratos, data_prevista, status_repasse, itens, _modelo }
     */
    /**
     * O detalhe do extrato (transaction/detail) só vale no lugar da lista do Financeiro quando cobre TODAS as linhas dela deste pedido.
     * Ex.: venda de 477,92 aberta no detalhe + estorno de −188 em outro extrato, lido só pela lista: o detalhe sozinho daria R$ 188 a mais.
     * Confere pelos ids (linha da lista = statement_detail_id = extrato_detalhe_id do detalhe) e pela soma dos repasses (até 0,01).
     * Extrato com valor vazio/ilegível ou que não fecha com o settlement do TikTok (aviso do núcleo) NUNCA vale como exato: ilegivel = true.
     * → { usar, parcial, ilegivel }
     */
    TT.detalheCobre = function (ped, f, j) {
        if (!j) return { usar: false, parcial: false, ilegivel: false };
        const fecha = t => !!(t.confere && typeof t.confere.diferenca === 'number' && Math.abs(t.confere.diferenca) <= 0.01) && !(t.avisos || []).some(a => /sem valor/.test(a));
        if (!valores(ped && ped.trans).every(fecha)) return { usar: false, parcial: false, ilegivel: true };
        if (!f || f.repasse === null) return { usar: true, parcial: false, ilegivel: false };
        const abertos = valores(ped && ped.trans).map(t => t.extrato_detalhe_id).filter(Boolean);
        const falta = f.repasses.some(r => !/#extrato$/.test(String(r.id)) && abertos.indexOf(r.id) < 0);
        const parcial = falta || Math.abs(U.r2(U.soma(j.repasses, r => r.valor) - f.repasse)) > 0.01;
        return { usar: !parcial, parcial, ilegivel: false };
    };
    const AVISO_VOLTOU = 'reembolso total sem saber se o produto voltou: o custo do produto foi contado';
    const AVISO_ILEGIVEL = 'o detalhe do extrato tem valor vazio/ilegível ou não fecha com o que o TikTok pagou';

    TT.lucroDoPedido = function (ped, ctx) {
        ctx = Object.assign({ custos: {}, cfg: {}, skumap: {} }, ctx || {});
        const f = TT.finDoPedido(ped), det = ped && ped.det, j0 = juntaTrans(ped), cob = TT.detalheCobre(ped, f, j0), j = cob.usar ? j0 : null;
        const id = String((ped && ped.id) || (f && f.pedido_id) || (j0 && j0.pedido_id) || ''), data = (f && f.data) || (j0 && j0.data) || (det && det.pedido.data_venda) || null;
        const base = f && f.skus.length ? f.skus.map(s => ({ sku_id: s.sku_id, qtd: s.qtd, titulo: s.titulo, peso: s.receita, canal_venda: s.canal_venda }))
            : det ? det.pedido.itens.map(it => ({ sku_id: it.anuncio_id || null, qtd: it.qtd, titulo: it.titulo, peso: it.total }))
                : [{ sku_id: null, qtd: 1, titulo: '', peso: 1 }];
        const lista = !j && !!f && f.receita !== null && f.repasse !== null, avisos = [];
        // Receita que o detalhe do pedido mostra (preço de origem − desconto do vendedor): com ela, a lista revela o reembolso.
        const detIt = det ? det.pedido.itens : [];
        const detReceita = detIt.length && detIt.every(it => typeof it.total === 'number') ? U.r2(U.soma(detIt, it => it.total) - (det.pedido.desconto_vendedor || 0)) : null;
        let bruto = null, desconto = 0, reembolso = 0, tarifas, estimar = false, devolveu = false;
        if (j) {
            bruto = j.receita.bruto; desconto = j.receita.desconto_vendedor; reembolso = j.receita.reembolso;
            tarifas = j.tarifas.slice();
            if (j.receita.outros) tarifas.push({ tipo: 'outro', valor: U.r2(-j.receita.outros), pedido_id: id, data, texto_original: 'receita não mapeada' });
        } else if (lista) {
            const ganho = Math.max(f.receita, 0);
            if (detReceita !== null && detReceita - ganho > 0.01) { bruto = detReceita; reembolso = U.r2(detReceita - ganho); } else bruto = ganho;
            // Só a lista: ganho 0 com repasse negativo = reembolso total (o TikTok ficou com o SFP/frete). Ganho menor que a venda = reembolso.
            devolveu = (f.receita <= 0 && f.repasse < 0) || (reembolso > 0 && reembolso >= bruto - 0.01);
            if (reembolso > 0 && !devolveu) avisos.push('reembolso parcial de ' + String(reembolso.toFixed(2)).replace('.', ',') + ' (lista do Financeiro × detalhe do pedido)');
            if (cob.parcial) avisos.push('o detalhe do extrato cobre só parte das linhas deste pedido: vale a lista do Financeiro (tarifas estimadas)');
            if (cob.ilegivel) avisos.push(AVISO_ILEGIVEL + ': vale a lista do Financeiro (tarifas estimadas)');
        } else if (cob.ilegivel) {
            // Só o detalhe do extrato, com valor ilegível ou sem fechar: "não lido" (nada de frete/tarifa R$ 0,00 inventado nem repasse a mais).
            const recLida = !j0.avisos.some(a => /receita sem valor/.test(a));
            bruto = det ? U.soma(det.pedido.itens, it => it.total) : (recLida ? j0.receita.bruto : null);
            desconto = det ? det.pedido.desconto_vendedor || 0 : (recLida ? j0.receita.desconto_vendedor : 0);
            tarifas = M.naoLido(AVISO_ILEGIVEL);
            avisos.push(AVISO_ILEGIVEL); avisos.push.apply(avisos, j0.avisos);
        } else if (det) {
            bruto = U.soma(det.pedido.itens, it => it.total); desconto = det.pedido.desconto_vendedor || 0; estimar = true;
            // Devolvido e visto só em Pedidos: o detalhe não traz o valor do reembolso → total (o motor deixa só o SFP, que não volta).
            if (det.pedido.status === 'devolvido' && det.devolucao) reembolso = det.pedido.reembolso > 0 ? det.pedido.reembolso : U.r2(bruto - desconto);
        }
        // Divide o valor entre os SKUs pelo peso (receita do SKU); o último fica com o resto (a soma bate no centavo).
        const somaPeso = U.soma(base, b => (b.peso > 0 ? b.peso : 0)), somaQtd = U.soma(base, b => b.qtd);
        let usado = 0;
        const itens = base.map((b, i) => {
            const s = skuDoItem(b.sku_id, ctx), part = somaPeso > 0 ? (b.peso > 0 ? b.peso : 0) / somaPeso : b.qtd / somaQtd;
            const total = bruto === null ? null : (i === base.length - 1 ? U.r2(bruto - usado) : U.r2(bruto * part));
            if (total !== null) usado = U.r2(usado + total);
            return { s, it: { sku: s.chave, anuncio_id: b.sku_id || '', titulo: b.titulo || '', qtd: b.qtd, total: total === null ? null : Math.max(0, total) } };
        });
        if (lista) tarifas = tarifasEstimadas(f, itens.map(x => x.it), id, data, bruto > 0 ? Math.max(f.receita, 0) / bruto : 1);
        const status = det && det.pedido.status === 'cancelado' ? 'cancelado' : devolveu ? 'devolvido' : det ? det.pedido.status
            : (reembolso > 0 && reembolso >= bruto - desconto - 0.01 ? 'devolvido' : ((f && f.entrega) ? 'entregue' : 'pago'));
        const pedido = M.criar('pedido', { canal: 'tiktok', conta: String(ctx.conta || 'tiktok'), fonte: 'tela', id, data_venda: data,
            data_entrega: (f && f.entrega) || (det && det.pedido.data_entrega) || null, status, itens: itens.map(x => x.it),
            desconto_vendedor: desconto, reembolso, canal_venda: (f && f.canal_venda) || (j && j.canal_venda) || null });
        const custos = [];
        itens.forEach(x => { const c = custoDoItem(x.s, ctx); if (c && x.it.sku && !custos.some(y => y.sku === x.it.sku)) custos.push({ sku: x.it.sku, custo: c.custo, outros: c.outros }); });
        const devolucoes = det && det.devolucao ? [Object.assign({}, det.devolucao, { pedido_id: id })] : [];
        const r = CN.motor.lucroPedido(pedido, { tarifas: estimar ? undefined : tarifas, estimar_tarifas: estimar, custos, devolucoes,
            imposto_pct: num(ctx.cfg.imposto_pct), margem_alvo_pct: num(ctx.cfg.margem_alvo_pct) });
        // Reembolso total visto só pela lista (sem o preço de origem, a receita já vem 0): o motor não percebe o reembolso → o aviso vem daqui.
        const voltou = devolucoes.map(d => d.produto_voltou).find(v => v === true || v === false);
        r.avisos = (r.avisos || []).concat(avisos);
        if (devolveu && voltou === undefined && r.avisos.indexOf(AVISO_VOLTOU) < 0) r.avisos.push(AVISO_VOLTOU);
        return Object.assign(r, {
            dia: data, canal_venda: pedido.canal_venda || null,
            estimado: !!((f && f.estimado) || (j && j.repasses.some(x => x.estimado)) || estimar || r.tarifas_estimadas || cob.parcial),
            exato: !!j, lido_em: ped.lido_em || null, tela: j || (cob.ilegivel && !lista) ? TT.TELA.transacao : (f ? TT.TELA.pedidos_fin : TT.TELA.pedido),
            // Situação e data prevista do repasse: da lista do Financeiro; sem ela, do detalhe do extrato (o "Est." lido só lá entra no "Previsto").
            extratos: f ? f.extratos : [], data_prevista: (f && f.data_prevista) || (j && j.repasses.map(x => x.data_prevista).filter(Boolean).sort().pop()) || null,
            status_repasse: f ? (f.estimado ? 'a_liberar' : 'disponivel') : (j && j.repasses.length ? (j.repasses.some(x => x.estimado) ? 'a_liberar' : 'disponivel') : null),
            itens: itens.map((x, i) => ({ sku: x.it.sku, sku_vendedor: x.s.sku || null, sku_id: x.it.anuncio_id || null, titulo: x.it.titulo, qtd: x.it.qtd, canal_venda: base[i].canal_venda || pedido.canal_venda || null })),
            _modelo: { pedido, tarifas: Array.isArray(tarifas) ? tarifas : [], repasses: j ? j.repasses : (f ? f.repasses : []), devolucoes },
        });
    };

    /** Por produto (SKU do vendedor; sem ligação, o sku_id do TikTok): vendas, receita, repasse, lucro, margem, % de afiliado e canais. */
    TT.porProduto = function (resultados) {
        const ps = CN.motor.lucroPorProduto(resultados), extra = {};
        resultados.forEach(r => (r.por_item || []).forEach((x, i) => {
            const e = extra[x.sku] || (extra[x.sku] = { titulo: '', sku_id: null, sku_vendedor: null, canais: {}, afiliado: 0, receita_exata: 0, aproximado: false });
            const it = (r.itens || [])[i] || {};
            // Pedido com vários SKUs: as tarifas são repartidas pela receita do item, mas no TikTok o fixo é por unidade e o afiliado muda
            // por SKU → a margem desse produto é aproximada. Tarifa estimada (só a lista) também.
            if ((r.por_item || []).length > 1 || r.tarifas_estimadas) e.aproximado = true;
            e.titulo = e.titulo || it.titulo || ''; e.sku_id = e.sku_id || it.sku_id; e.sku_vendedor = e.sku_vendedor || it.sku_vendedor;
            if (it.canal_venda) e.canais[it.canal_venda] = (e.canais[it.canal_venda] || 0) + 1;
            if (r.exato && r.status === 'ok') {
                const af = U.r2((r.tarifas_por_tipo.afiliado || 0) + (r.tarifas_por_tipo.afiliado_ads || 0));
                e.afiliado = U.r2(e.afiliado + af * x.participacao); e.receita_exata = U.r2(e.receita_exata + x.receita);
            }
        }));
        return ps.map(p => {
            const e = extra[p.sku] || {};
            return Object.assign(p, { titulo: e.titulo || '', sku_id: e.sku_id || null, sku_vendedor: e.sku_vendedor || null, canais: e.canais || {}, aproximado: !!e.aproximado,
                repasse: U.r2(p.receita - p.tarifas - (p.ads_repasse || 0)), afiliado_rs: e.afiliado || 0,   // o Ads tirado do repasse (GMV Pay) também sai
                afiliado_pct: e.receita_exata > 0 ? Math.round(e.afiliado / e.receita_exata * 10000) / 100 : null });
        });
    };

    /** Cada extrato: settle = earning + fees + shipping + adjust (conta do TikTok) e Σ repasse dos pedidos lidos do extrato = settle. */
    TT.conferirExtratos = function (ext, peds) {
        if (!ext || !Array.isArray(ext.lista)) return null;
        const soma = {}, qtd = {};
        (peds || []).forEach(p => valores(p.linhas).forEach(l => {
            if (!l.extrato_id || M.ehNaoLido(l.repasse)) return;
            soma[l.extrato_id] = U.r2((soma[l.extrato_id] || 0) + l.repasse.valor); qtd[l.extrato_id] = (qtd[l.extrato_id] || 0) + 1;
        }));
        return ext.lista.map(e => {
            const contaFecha = e.confere !== null && e.confere !== undefined && Math.abs(e.confere) <= 0.01, s = soma[e.id];
            const pedidosFecham = s === undefined ? null : Math.abs(U.r2(e.valor - s)) <= 0.01;
            return { id: e.id, valor: e.valor, status: e.status, data_prevista: e.data_prevista, data_liberada: e.data_liberada, receita: e.receita, tarifas: e.tarifas,
                frete: e.frete, ajuste: e.ajuste, conta_fecha: contaFecha, soma_pedidos: s === undefined ? null : s, pedidos_lidos: qtd[e.id] || 0, pedidos_fecham: pedidosFecham,
                fecha: contaFecha && pedidosFecham !== false };
        });
    };

    /**
     * Lucro e repasse da loja pelo motor do núcleo, a partir de TT.ler(). opts.hoje ('AAAA-MM-DD') para teste.
     * → { conta, vazio, kpis, pedidos, produtos, repasse, saude, afiliados, campanhas, conciliacao }
     */
    TT.resumo = function (d, opts) {
        opts = opts || {};
        if (!d) return { vazio: true };
        const hoje = U.dia(opts.hoje) || U.hoje(), desde = U.somaDias(hoje, -29);
        const ctx = { conta: d.conta, custos: d.custos || {}, cfg: d.cfg || {}, skumap: d.skumap || {} };
        const pedidos = (d.peds || []).map(p => TT.lucroDoPedido(p, ctx)).sort((a, b) => String(b.dia || '').localeCompare(String(a.dia || '')));
        // KPI com os mesmos pedidos da aba Produtos e do fechamento (motor): 'ok' e 'cancelado' (o frete/tarifa que ficou no cancelado é prejuízo).
        const mes = pedidos.filter(r => r.dia && r.dia >= desde && r.dia <= hoje), ok = mes.filter(r => r.status === 'ok' || r.status === 'cancelado');
        const lucro = ok.length ? U.soma(ok, r => r.lucro_real) : null, receita = U.soma(ok, r => r.receita_liquida);
        const margem = lucro !== null && receita > 0 ? Math.round(lucro / receita * 10000) / 100 : null, alvo = num(ctx.cfg.margem_alvo_pct) || 0;
        const sau = d.saude || {}, prazo = (sau.indicadores || []).find(x => x.indicador === 'prazo_repasse_dias') || null;
        const exatos = mes.filter(r => r.exato && r.status === 'ok');
        const comissao = U.soma(exatos, r => (r.tarifas_por_tipo.afiliado || 0) + (r.tarifas_por_tipo.afiliado_ads || 0)), recExata = U.soma(exatos, r => r.receita_liquida);
        // Conciliação só de quem tem tarifa lida do Financeiro (lista ou detalhe): o pedido visto só em Pedidos não tem repasse esperado.
        const modelos = pedidos.filter(r => r.status !== 'nao_lido' && (r.exato || r.status_repasse)).map(r => r._modelo);
        const junta = c => [].concat.apply([], modelos.map(m => m[c]));
        const conc = CN.conciliacao.conciliar({ pedidos: junta('pedido'), tarifas: junta('tarifas'), repasses: junta('repasses'), devolucoes: junta('devolucoes'), hoje,
            prazo_dias: prazo && prazo.valor > 0 ? { tiktok: prazo.valor } : undefined });
        // "Previsto": só o que ainda está a liberar, linha a linha (venda paga + devolução "Est." → só a devolução; o que já foi pago não é previsto).
        const porDia = {}, liberado = x => x.status === 'disponivel' || x.status === 'sacado';
        pedidos.filter(r => r.status_repasse === 'a_liberar' && r.repasse !== null).forEach(r => (r._modelo.repasses || []).filter(x => !liberado(x)).forEach(x => {
            const dd = x.data_prevista || r.data_prevista || 'sem data'; porDia[dd] = U.r2((porDia[dd] || 0) + x.valor); }));
        return {
            conta: d.conta, vazio: !(d.peds || []).length && !['extratos', 'areceber', 'saldo', 'saude', 'afil', 'camp', 'falha'].some(c => d[c]),
            kpis: {
                lucro_30d: lucro, margem_pct: margem, receita_30d: receita, pedidos_30d: mes.length,
                sem_custo: mes.filter(r => r.status === 'sem_custo').length, nao_lidos: mes.filter(r => r.status === 'nao_lido').length, estimados: mes.filter(r => r.estimado).length,
                classe: lucro === null ? 'sem_custo' : (lucro < 0 ? 'prejuizo' : (margem !== null && margem < alvo ? 'apertado' : 'lucrativo')),
                a_receber: d.areceber ? d.areceber.total : null, saldo: d.saldo ? d.saldo.valor : null,
            },
            pedidos, produtos: TT.porProduto(mes),
            repasse: { a_receber: d.areceber || null, saldo: d.saldo || null, extratos: TT.conferirExtratos(d.extratos, d.peds),
                linha_do_tempo: Object.keys(porDia).sort().map(dia => ({ dia, valor: porDia[dia] })) },
            saude: { itens: sau.indicadores || [], violacoes: sau.viol || null, lido_em: sau.lido_em || null,
                aviso_d3: prazo && prazo.meta !== null && prazo.valor > prazo.meta && prazo.efeito_se_falhar
                    ? prazo.efeito_se_falhar.replace(/^para receber mais rápido falta/, 'Para receber em D+' + prazo.meta + ' falta') : null },
            afiliados: { pendencias: d.afil || null, comissao_rs: comissao, comissao_pct: recExata > 0 ? Math.round(comissao / recExata * 10000) / 100 : null, pedidos_com_detalhe: exatos.length },
            campanhas: d.camp || null,
            conciliacao: conc.totais,
            falha: d.falha || null,   // { tipo, tela, em }: a última tela que o Copiloto não reconheceu (o TikTok mudou o formato)
        };
    };

    /** "E se eu vender a R$ X?" no TikTok (tabela com vigência do núcleo). */
    TT.simular = (preco, ctx, cfg) => CN.tarifas.simular('tiktok', preco, Object.assign({ imposto_pct: num((cfg || {}).imposto_pct), margem_alvo_pct: num((cfg || {}).margem_alvo_pct) }, ctx || {}));

    // ── Fundo (background.js): mensagens e registro dos scripts de captura ─────────────────────────────────────────
    TT.SCRIPTS = [
        { id: 'copiloto-tt-pagina', matches: [TT.ORIGEM], js: ['tiktok-pagina.js'], runAt: 'document_start', world: 'MAIN', persistAcrossSessions: true },
        { id: 'copiloto-tt-tela', matches: [TT.ORIGEM], js: ['tiktok-tela.js'], runAt: 'document_start', persistAcrossSessions: true },
    ];
    /**
     * As 2 permissões OPCIONAIS do TikTok, pedidas juntas no mesmo clique em Ajustes e devolvidas juntas ao desligar:
     * 'scripting' (registrar a leitura da tela) + o site do Seller Center. A 3.1.0 não pedia nenhuma das duas.
     */
    TT.PERM = { permissions: ['scripting'], origins: [TT.ORIGEM] };
    const moduloLigado = cfg => (SHC.moduloLigado ? SHC.moduloLigado(cfg, 'tiktok') : !!(cfg && cfg.modulos && cfg.modulos.tiktok === true));
    /**
     * Scripts registrados ⇔ permissões concedidas E o TikTok ligado e SALVO em Ajustes (cfg.modulos.tiktok === true).
     * Marcou a caixa e não salvou, desligou ou nunca ligou: nenhum script no TikTok (nada é lido nem gravado).
     */
    TT.sincronizarScripts = () => emFila(async () => {
        const ch = root.chrome;
        if (!ch.scripting || !ch.scripting.registerContentScripts || !ch.permissions || !ch.permissions.contains) return { ok: false, motivo: 'sem_scripting' };
        const cfg = (await area().get('cfg')).cfg || {};
        const tem = (await ch.permissions.contains(TT.PERM)) && moduloLigado(cfg), ids = TT.SCRIPTS.map(s => s.id);
        const ja = (await ch.scripting.getRegisteredContentScripts({ ids })).map(s => s.id);
        if (tem) {
            const falta = TT.SCRIPTS.filter(s => ja.indexOf(s.id) < 0);
            if (falta.length) await ch.scripting.registerContentScripts(falta);
            return { ok: true, ligado: true };
        }
        if (ja.length) await ch.scripting.unregisterContentScripts({ ids: ja });
        return { ok: true, ligado: false };
    });
    /** Tira a leitura ANTES de devolver as permissões (sem 'scripting' o fundo não consegue mais desregistrar). */
    TT.desligarLeitura = () => emFila(async () => {
        const ch = root.chrome;
        if (!ch.scripting || !ch.scripting.getRegisteredContentScripts) return { ok: true, ligado: false };
        const ja = (await ch.scripting.getRegisteredContentScripts({ ids: TT.SCRIPTS.map(s => s.id) })).map(s => s.id);
        if (ja.length) await ch.scripting.unregisterContentScripts({ ids: ja });
        return { ok: true, ligado: false };
    });
    /** "Apagar dados do TikTok": tudo o que o Copiloto guardou do TikTok neste Chrome (tt:* e os custos c|tiktok|*). → quantas chaves saíram */
    TT.apagarDados = () => emFila(async () => {
        const ks = await chavesCom('tt:', 'c|tiktok|');
        if (ks.length) await area().remove(ks);
        return ks.length;
    });
    TT.daAbaDoTikTok = s => !!(s && s.id === root.chrome.runtime.id && s.tab && /^https:\/\/seller-br\.tiktok\.com\//.test(s.url || s.tab.url || ''));
    const daExtensao = s => !!(s && s.id === root.chrome.runtime.id && /^chrome-extension:\/\//.test(s.url || ''));

    TT.instalarFundo = function () {
        const ch = root.chrome;
        ch.runtime.onMessage.addListener((msg, sender, responder) => {
            if (!msg) return false;
            if (msg.acao === 'tiktok_captura') {   // da aba do Seller Center: {tipo, dados, conta, lido_em}
                if (!TT.daAbaDoTikTok(sender)) return false;
                // Script que ficou para trás com o TikTok desligado em Ajustes: não grava nada.
                area().get('cfg').then(o => (moduloLigado((o && o.cfg) || {}) ? TT.gravarCaptura(msg.tipo, msg.dados, msg.conta, msg.lido_em) : { ok: false, motivo: 'desligado' }))
                    .then(responder, () => responder({ ok: false }));
                return true;
            }
            if (msg.acao === 'tiktok_ligar' || msg.acao === 'tiktok_desligar') {   // o painel pede/devolve as permissões no clique; aqui só registra/tira
                if (!daExtensao(sender)) return false;
                (msg.acao === 'tiktok_ligar' ? TT.sincronizarScripts() : TT.desligarLeitura()).then(responder, () => responder({ ok: false }));
                return true;
            }
            return false;
        });
        if (ch.permissions && ch.permissions.onAdded) {
            ch.permissions.onAdded.addListener(() => { TT.sincronizarScripts().catch(() => {}); });
            ch.permissions.onRemoved.addListener(() => { TT.sincronizarScripts().catch(() => {}); });
        }
        // Salvou Ajustes (ligou ou desligou o TikTok): a leitura acompanha.
        if (ch.storage && ch.storage.onChanged) ch.storage.onChanged.addListener((mud, onde) => {
            if (onde !== 'local' || !mud.cfg) return;
            if (moduloLigado(mud.cfg.oldValue || {}) !== moduloLigado(mud.cfg.newValue || {})) TT.sincronizarScripts().catch(() => {});
        });
        TT.sincronizarScripts().catch(() => {});   // a cada início do fundo (depois de atualizar a extensão, os scripts voltam)
    };

    if (typeof module === 'object' && module.exports) module.exports = TT;
})(typeof globalThis !== 'undefined' ? globalThis : this);
