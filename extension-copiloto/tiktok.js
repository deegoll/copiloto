// Copiloto · TikTok Shop (3.2.0; telas de 03/10/2026 na 3.3.0): o que a captura passiva recebe vira dado guardado por loja e a conta de lucro e repasse.
// REGRA DO CANAL (Termos do Vendedor BR: nada de robô): o Copiloto NÃO chama o TikTok, nem GET, NÃO navega sozinho e NÃO tem alarme
// para o TikTok. Ele só lê a resposta que a própria tela do Seller Center já recebeu (tiktok-pagina.js → tiktok-tela.js → aqui).
// As contas são do copiloto-nucleo: a pasta nucleo/ é uma CÓPIA byte a byte de copiloto-nucleo/src (o Chrome só carrega arquivos de
// dentro da extensão; teste_tiktok_nucleo.js confere). Mudou o núcleo? Copie de novo os 7 arquivos de SHC.tt.NUCLEO.
// Carregar DEPOIS de nucleo/*.js (CopilotoNucleo) e de calc.js + store.js (SHC: custo por SKU e kit).
//
// Gravado por loja (a aba lê por SHC.tt.ler + SHC.tt.resumo; tiktok-aba.js só desenha):
//   tt:conta                  → última loja vista (oec_seller_id da URL; sem ele, 'tiktok'), por empresa
//   tt:lojas                  → { <loja>: '' (empresa principal) | <sellerId> }: a empresa dona de cada loja, fixada na 1ª captura (3.3.0)
//   tt:<loja>:ped:<pedido>    → { id, data, lido_em, tela, linhas: {<statement_detail_id>: linha do Financeiro (pedidosDaListaFinanceira)},
//                                 trans: {<id>: extrato do pedido (transacaoDoExtrato)}, trans_sku: {…page_type 9}, det: {pedido, devolucao} (pedidoDoDetalhe) }
//                                 (uma chave por pedido; até 400 dias / 3.000 pedidos). 03/10: linhas e trans vêm das listas e da gaveta de Finanças
//                                 (POST view/*), no mesmo formato; a linha "em espera" e o detalhe estimado saem quando o pedido liquida
//   tt:<loja>:extratos        → { lista: Repasse[] (03/10: + total_pedidos, pagamento_id, tipos), lido_em, tela }   tt:<loja>:saldo → { valor, lido_em, tela }
//   tt:<loja>:listas          → { <tipo>: { lidos, total, parcial, ids, lido_em, tela } }   lido menos linhas do que existem = "lido em parte"
//   tt:<loja>:pago            → { total, … }   tt:<loja>:resumo_fin → { em_espera, pago_periodo, em_processamento, saldo, saldo_negativo, … }
//   tt:<loja>:dev             → { contadores, abas: {<aba>: {linhas:[{pedido_id, devolucao_id, valor, produto_volta}], total, …}}, painel, … }
//   tt:<loja>:anuncios        → { produtos: {<product_id>: {total_skus, comissao_pct, expandido?, skus: {<sku_id>: {sku, preco}}, lido_em}}, … }
//   tt:<loja>:tarefas         → { mensagens_nao_lidas, … }   (só o contador da Página inicial; o chat não é lido)
//   tt:<loja>:ads_manual      → { 'AAAA-MM': R$, nao_uso: bool }   Ads digitado em Ajustes (SHC.tt.salvarAds); não vem de tela nenhuma
//   tt:<loja>:areceber        → { total, motivos:[{motivo:'em_transito'|'devolucao'|'entregue_no_prazo', codigo:1|2|3, titulo, valor}], prazo_dias, confere, lido_em, tela }
//   tt:<loja>:saude           → { indicadores: Saude[], pontos|null, perf, ind, prazo, viol, sps, lido_em, tela }
//   tt:<loja>:afil            → { mensagens, sem_amostra, amostras, itens, lido_em, tela }
//   tt:<loja>:camp            → { abertas:[{id, titulo, inscrita, inscricao_ate, inicio, fim, …}], inscritas, inscritas_lista, convites,
//                                 regras: {<subcampanha>: {fator, dias}}, produtos: {<campanha>: {lista}}, lido_em, tela }
//   tt:<loja>:skumap          → { <sku_id>: '<SKU do vendedor>' }   (da lista de Pedidos e de Gerenciar produtos)
//   c|tiktok|<sku_id>         → custo digitado na aba ({custo, outros?}) ou "ligar ao SKU" ({sku})
// Nada do comprador é guardado (tiktok-pagina.js deixa sair só a lista fechada de campos; aqui só se grava o que os conversores do núcleo leem).
(function (root) {
    'use strict';
    const SHC = root.SHC || (root.SHC = {});
    const CN = root.CopilotoNucleo, N = CN.adaptadores.tiktok, U = CN.util, M = CN.modelo;
    // 3.3.0 (junção, multi-empresa): tt:* passa pela camada da empresa (store.js): a leitura é da empresa da conta do ML aberta e o lucro usa
    // os custos dela. A gravação vai para a empresa DONA da loja (areaDaLoja). Com 1 empresa, as mesmas chaves de sempre.
    const crua = () => root.chrome.storage.local, area = () => (SHC.areaEmpresa ? SHC.areaEmpresa() : crua());
    const DE_TODAS = ['tt:', 'tt@', 'c|tiktok|'];   // "Apagar dados do TikTok": de todas as empresas
    const TT = SHC.tt = {};

    TT.ORIGEM = 'https://seller-br.tiktok.com/*';
    TT.NUCLEO = ['nucleo/util.js', 'nucleo/modelo.js', 'nucleo/tarifas.js', 'nucleo/motor.js', 'nucleo/conciliacao.js', 'nucleo/adaptador.js', 'nucleo/adaptadores/tiktok.js'];
    /** Tipos que a captura aceita (lista FECHADA, igual à de tiktok-pagina.js e tiktok-tela.js) → nome da tela de origem. */
    TT.TELA = {
        pedidos_fin: 'Financeiro', transacao: 'Financeiro (detalhe do pedido)', extratos: 'Financeiro (extratos)', areceber: 'Financeiro', saldo: 'Financeiro',
        saude_perf: 'Saúde da conta', saude_prazo: 'Saúde da conta', saude_viol: 'Saúde da conta', afil: 'Afiliados', camp_rec: 'Promoções',
        // 3.3.0 (E6): as telas de 03/10/2026, com o nome que elas têm hoje. Saíram 'pedido' (GET trade/orders/get) e 'camp_insc'
        // (GET list_registered_campaigns): nenhuma tela chama mais; a ligação do SKU vem de 'pedidos' e as inscritas de 'camp_mgt'.
        demonstrativos: 'Finanças › Demonstrativos', pedidos_liq: 'Finanças › Demonstrativos', pedidos_espera: 'Finanças › Em espera', detalhe: 'Finanças › detalhe do pedido',
        resumo_fin: 'Finanças › Resumo financeiro', saude_ind: 'Avaliação da integridade da conta', saude_sps: 'Pontuação de desempenho da loja',
        devolucoes: 'Gerenciar devoluções e reembolsos', devolucoes_painel: 'Gerenciar devoluções e reembolsos',
        camp_mgt: 'Campanhas', camp_abertas: 'Campanhas', camp_detalhe: 'Campanhas', camp_produtos: 'Campanhas', camp_convites: 'Campanhas',
        pedidos: 'Pedidos', tarefas: 'Página inicial', produtos: 'Gerenciar produtos', produtos_skus: 'Gerenciar produtos',
    };
    TT.TIPOS = Object.keys(TT.TELA);
    TT.MAX_DIAS = 400;   // 3.3.0: os "12 meses" da ficha do SKU e da aba Canal
    TT.MAX_PEDIDOS = 3000;
    TT.contaValida = c => /^(tiktok|\d{5,25})$/.test(String(c || ''));
    const k = (conta, s) => SHC.chaveConta(s, conta, 'tiktok');   // tt:<loja>:<s> (regra do canal na chave: store.js)
    const valores = o => (o && typeof o === 'object' ? Object.keys(o).map(x => o[x]) : []);
    const num = v => (SHC.num ? SHC.num(v) : U.num(v));
    const normSku = s => (SHC.normalizaSku ? SHC.normalizaSku(s) : String(s || '').trim().toUpperCase());

    // Gravações uma de cada vez (duas respostas do mesmo pedido chegando juntas não se atropelam).
    let fila = Promise.resolve();
    const emFila = f => { const p = fila.then(() => f()); fila = p.catch(() => {}); return p; };

    async function chavesCom() { return chavesEm(area(), [].slice.call(arguments)); }
    async function chavesEm(a, pre) {   // chaves que começam com qualquer um dos prefixos (getKeys só no Chrome 130+; o mínimo do manifest é 116, por isso o get(null) de reserva)
        const todas = typeof a.getKeys === 'function' ? await a.getKeys() : Object.keys(await a.get(null));
        return todas.filter(x => pre.some(p => x.indexOf(p) === 0));
    }
    // 3.3.0 (revisão da junção, "o sistema tem que ser assertivo para não misturar os dados"): a loja é de UMA empresa, fixada na 1ª captura
    // em tt:lojas = {<loja>: '' (principal) | <sellerId>} (fora da camada da empresa). Antes ela ia para a empresa da conta do ML aberta na hora:
    // ler a loja da A com o ML da B aberto gravava a loja nas 2 empresas. Loja sem dono com dados já guardados fica onde eles estão; empresa
    // desmarcada em Ajustes volta para a principal (como os custos dela). ponytail: a 1ª captura decide; escolher a empresa em Ajustes se pedirem.
    const LOJAS = 'tt:lojas';
    async function empresaDaLoja(loja) {
        const t = await crua().get([LOJAS, 'cfg']), m = t[LOJAS] || {}, sep = (t.cfg && t.cfg.empresaSeparada) || {};
        let e = m[loja];
        if (typeof e !== 'string') {
            const ja = (await chavesEm(crua(), ['tt:', 'tt@'])).map(x => /^tt(?:@(\d+))?:([^:]+):/.exec(x) || []).find(r => r[2] === loja);
            e = ja ? ja[1] || '' : (SHC.empresaSeparada ? await SHC.empresaSeparada() : '');
            await crua().set({ [LOJAS]: Object.assign({}, m, { [loja]: e }) });
        }
        return e && sep[e] === true ? e : '';
    }
    const areaDaLoja = async loja => (SHC.areaEmpresa ? SHC.areaEmpresa(await empresaDaLoja(loja)) : crua());
    let podadoEm = 0;
    /** Guarda no máximo 400 dias e 3.000 pedidos por loja (os mais novos ficam). a = a área da empresa da loja (padrão: areaDaLoja). */
    async function podar(conta, forcar, a) {
        if (!forcar && Date.now() - podadoEm < 10 * 60e3) return 0;
        podadoEm = Date.now();
        a = a || await areaDaLoja(conta);
        const ks = await chavesEm(a, [k(conta, 'ped:')]);
        if (ks.length === 0) return 0;
        const lidos = await a.get(ks), limite = U.somaDias(U.hoje(), -TT.MAX_DIAS);
        const fora = ks.map(x => [x, String((lidos[x] && lidos[x].data) || '')]).sort((a, b) => b[1].localeCompare(a[1]))
            .filter((x, i) => i >= TT.MAX_PEDIDOS || !x[1] || x[1] < limite).map(x => x[0]);
        if (fora.length) await a.remove(fora);
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
    /** A leitura mais nova de um grupo (linhas da lista ou detalhes): { em, tela } — a tela é a que a gravou. */
    const maisNova = (o, padrao) => { const x = valores(o).sort((a, b) => (b.lido_em || 0) - (a.lido_em || 0))[0]; return { em: (x && x.lido_em) || 0, tela: (x && x.tela) || padrao }; };

    /** Dia do pedido (a mais antiga das fontes: é por ele que a poda corta) e de onde veio a leitura mais nova. */
    function carimba(ped) {
        const f = TT.finDoPedido(ped), j = juntaTrans(ped), det = ped.det || null;
        const fontes = [f && maisNova(ped.linhas, TT.TELA.pedidos_fin), j && maisNova(ped.trans, TT.TELA.transacao),
            det && { em: det.lido_em, tela: 'Pedidos' }].filter(Boolean).sort((a, b) => b.em - a.em);
        return Object.assign(ped, { data: [f && f.data, j && j.data, det && det.pedido.data_venda].filter(Boolean).sort()[0] || null,
            lido_em: fontes.length ? fontes[0].em : null, tela: fontes.length ? fontes[0].tela : '' });
    }

    // ── 3.3.0 (E7): faixa dos números, como no ML (fundo/13-aba-do-ml-e-canal.js): o que vem da página não é verdade por si. ──
    // Dinheiro em texto tem de ser número e ficar abaixo de R$ 10 milhões; os ids (pedido, demonstrativo, SKU, produto, pagamento, campanha)
    // seguem ^\d{5,25}$; o dia da venda, da entrega, do demonstrativo e da liquidação fica entre 2024 e hoje. Fora disso nada é gravado e conta
    // como "tela mudou". Um número possível e errado continua passando (NOVIDADES-3.3.0.md, "Riscos que ficam"). Vazio, null e "0" são
    // "não veio" (o núcleo lê assim) e passam; "BRL 549.9" (moeda na frente) é número.
    // ponytail: "hoje" com 7 dias de folga (fuso, relógio do computador atrasado e os retratos de 29/09–01/10 que os testes da 3.2.0 gravam com o
    // relógio parado em 25/09). Barra 2099, 1970 e texto; para apertar, trocar a folga por 1 e o relógio desses testes.
    const FOLGA_DIAS = 7;
    const F_DIN = /^(amount|format_price|\w+_amount|\w+_price)$/;
    const F_ID = /^(id|trade_order_id|expression_order_id|fund_order_id|main_order_id|reverse_main_order_id|reverse_order_id|statement_id|statement_detail_id|reference_id|sku_id|product_id|payment_order_id|payment_id|campaign_id|sub_campaign_id)$/;
    const F_DIA = /^(placed_time|order_create_time|order_delivery_time|delivery_time|payment_time|statement_date|settlement_date|settlement_time)$/;
    function naFaixa(v, campo, nivel) {
        if (nivel > 40) return false;
        if (Array.isArray(v)) return v.every(x => naFaixa(x, campo, nivel + 1));
        if (v && typeof v === 'object') return Object.keys(v).every(c => naFaixa(v[c], c, nivel + 1));
        if (v === null || v === undefined || v === '' || (typeof v !== 'string' && typeof v !== 'number')) return true;
        if (F_DIN.test(campo)) { const n = U.num(String(v).replace(/^[A-Z]{3}\s*/, '')); return n !== null && Math.abs(n) < 1e7; }
        if (v === 0 || v === '0') return true;
        if (F_ID.test(campo)) return /^\d{5,25}$/.test(String(v));
        if (F_DIA.test(campo)) { const d = U.dia(v); return !!d && d >= '2024-01-01' && d <= U.somaDias(U.hoje(), FOLGA_DIAS); }
        return true;
    }
    TT.naFaixa = (dados, pedido) => naFaixa(dados, '', 0) && naFaixa(pedido || {}, '', 0);

    /**
     * Uma resposta capturada → gravada por loja. Resposta que não se reconhece NÃO grava nada (nunca vira zero).
     * → { ok, n (registros), motivo? }
     */
    TT.gravarCaptura = (tipo, dados, conta, lidoEm, pedido) => emFila(async () => {
        if (!TT.contaValida(conta)) return { ok: false, motivo: 'formato' };
        const a = await areaDaLoja(conta), r = await gravar(tipo, dados, conta, lidoEm, pedido, a);
        // O TikTok mudou o formato de uma tela: guarda a última falha (só tipo, tela e hora) para a aba avisar. Leu de novo: some.
        try {
            const kf = k(conta, 'falha');
            if (r.motivo === 'nao_reconhecido') await a.set({ [kf]: { tipo, tela: TT.TELA[tipo], em: Date.now() } });
            else if (r.ok) { const x = (await a.get(kf))[kf]; if (x && x.tipo === tipo) await a.remove(kf); }
        } catch (e) { /* o aviso é extra: nunca atrapalha a gravação */ }
        return r;
    });
    const DA_LISTA = ['pedidos_fin', 'pedidos_liq', 'pedidos_espera'], DO_DETALHE = ['transacao', 'detalhe'];
    const sem = (o, f) => { const x = {}; Object.keys(o || {}).forEach(c => { if (!f(o[c])) x[c] = o[c]; }); return x; };
    // pedido = os ids que a página leu do pedido que a TELA fez (tiktok-pagina.js): de qual pedido é a gaveta, qual aba, qual campanha.
    async function gravar(tipo, dados, conta, lidoEm, pedido, a) {
        if (TT.TIPOS.indexOf(tipo) < 0 || !TT.contaValida(conta) || !dados || typeof dados !== 'object') return { ok: false, motivo: 'formato' };
        const em = Number(lidoEm) > 0 ? Math.min(Number(lidoEm), Date.now()) : Date.now();
        // Resposta de erro do TikTok (sessão caiu, limite etc.) não é "tela mudou": não vira aviso.
        const falhou = typeof dados.code === 'number' && dados.code !== 0 ? { ok: false, motivo: 'erro_tiktok' } : { ok: false, motivo: 'nao_reconhecido' };
        const semPedido = { ok: false, motivo: 'sem_pedido' };   // faltou o id do pedido da tela (ou a lista ainda não foi lida): também não é "tela mudou"
        const carimbo = { lido_em: em, tela: TT.TELA[tipo] }, grava = {}, ped = {};
        Object.keys(pedido && typeof pedido === 'object' ? pedido : {}).forEach(c => { if (/^\d{1,25}$/.test(String(pedido[c]))) ped[c] = String(pedido[c]); });   // só ids (dígitos)
        if (!TT.naFaixa(dados, ped)) return { ok: false, motivo: 'nao_reconhecido' };   // E7: fora da faixa = "tela mudou"
        const ler = async key => (await a.get(key))[key] || null;
        let n = 1;
        // sku_id → SKU do vendedor, por sku_id (vários sku_id podem ter o mesmo SKU). SKU vazio não apaga o que já se sabe.
        const ligaSkus = async pares => {
            let mapa = (await ler(k(conta, 'skumap'))) || {}, mudou = false;
            pares.forEach(p => { if (p[0] && p[1] && mapa[p[0]] !== p[1]) { mapa = Object.assign({}, mapa, { [p[0]]: p[1] }); mudou = true; } });
            if (mudou) grava[k(conta, 'skumap')] = mapa;
        };
        // A tela pede 50 por vez: se ela diz que existem mais do que já foi lido, fica anotado "lido em parte" (o Copiloto NÃO pede a 2ª página).
        // As páginas que a seller abrir somam pelas linhas (ids) enquanto o total da tela for o mesmo; total diferente = outra busca, recomeça.
        const anotaLista = async ids => {
            const total = Number((dados.data || {}).total_count), cur = (await ler(k(conta, 'listas'))) || {}, antes = cur[tipo] || {};
            const vistos = Array.from(new Set((antes.total === total && Array.isArray(antes.ids) ? antes.ids : []).concat(ids)));
            grava[k(conta, 'listas')] = Object.assign({}, cur, { [tipo]: Object.assign({ lidos: vistos.length, total: total >= 0 ? total : null, parcial: total > vistos.length, ids: vistos }, carimbo) });
        };

        if (DA_LISTA.indexOf(tipo) >= 0 || DO_DETALHE.indexOf(tipo) >= 0) {
            const mexe = {};   // pedido_id → função que altera as fontes guardadas
            if (DA_LISTA.indexOf(tipo) >= 0) {
                const regs = N.pedidosDaListaFinanceira(dados, { conta });
                if (M.ehNaoLido(regs)) return falhou;
                regs.forEach(r => { const antes = mexe[r.pedido_id]; mexe[r.pedido_id] = p => {
                    if (antes) antes(p);
                    // um pedido guarda as linhas de UM formato só (o GET de antes ou as listas de 03/10): a leitura nova troca as do outro formato
                    p.linhas = sem(p.linhas, l => (l.tela === TT.TELA.pedidos_fin) !== (tipo === 'pedidos_fin'));
                    // 03/10: o pedido liquidou → a linha "em espera" e o detalhe estimado dele saem (senão o mesmo dinheiro contaria 2 vezes)
                    if (tipo === 'pedidos_liq') { p.linhas = sem(p.linhas, l => l.estimado); if (p.trans) p.trans = sem(p.trans, t => t.pendente); }
                    p.linhas = Object.assign({}, p.linhas, { [M.ehNaoLido(r.repasse) ? r.pedido_id : r.repasse.id]: Object.assign(r, carimbo) });
                }; });
                n = regs.length;
                if (tipo !== 'pedidos_fin' && !ped.expression_order_id) await anotaLista(regs.map(r => (M.ehNaoLido(r.repasse) ? r.pedido_id : r.repasse.id)));   // a busca de 1 pedido só (ao abrir a gaveta) não é a lista
            } else {
                let opts = { conta };
                if (tipo === 'detalhe') {   // a gaveta pode vir sem o id e sem a data: o id vem do pedido da tela e a data, do que já foi lido da lista
                    const id = String((dados.data && dados.data.trade_order_id) || ped.trade_order_id || ''), guardado = id ? await ler(k(conta, 'ped:' + id)) : null;
                    opts = { conta, corpo: ped, data: guardado && guardado.data };
                }
                const t = N.transacaoDoExtrato(dados, opts);
                if (M.ehNaoLido(t) || !t.pedido_id) return t && t.falta === 'pedido' ? semPedido : falhou;
                const d = dados.data || {}, campo = d.sku_record && !d.order_record ? 'trans_sku' : 'trans';   // page_type 9 (1 SKU) não soma com o pedido
                mexe[t.pedido_id] = p => {
                    if (tipo === 'detalhe' && !t.pendente) p.trans = sem(p.trans, x => x.pendente);   // liquidou: o detalhe estimado sai
                    p[campo] = Object.assign({}, p[campo], { [t.extrato_detalhe_id || 'sem_id']: Object.assign(t, carimbo) });
                };
            }
            const ids = Object.keys(mexe), keys = ids.map(id => k(conta, 'ped:' + id)), atual = await a.get(keys);
            ids.forEach((id, i) => { const p = Object.assign({ id }, atual[keys[i]] || {}); mexe[id](p); grava[keys[i]] = carimba(p); });
        } else if (tipo === 'extratos' || tipo === 'demonstrativos') {
            const rs = N.repassesDosExtratos(dados, conta);
            if (M.ehNaoLido(rs)) return falhou;
            const cur = (await ler(k(conta, 'extratos'))) || {}, porId = {};
            (cur.lista || []).concat(rs).forEach(r => { porId[r.id] = r; });
            const lista = valores(porId).sort((a, b) => String(b.data_liberada || b.data_prevista || '').localeCompare(String(a.data_liberada || a.data_prevista || ''))).slice(0, 200);
            grava[k(conta, 'extratos')] = Object.assign({ lista }, carimbo);
            n = rs.length;
            if (tipo === 'demonstrativos') await anotaLista(rs.map(r => r.id));
        } else if (tipo === 'areceber') {
            const pago = N.totalPago(dados);   // 03/10: a mesma rota com amount_stat_type=3 traz o total já pago
            if (!M.ehNaoLido(pago)) grava[k(conta, 'pago')] = Object.assign(pago, carimbo);
            else {
                const a = N.aReceberPorMotivo(dados);
                if (M.ehNaoLido(a)) return falhou;
                grava[k(conta, 'areceber')] = Object.assign(a, carimbo);
            }
        } else if (tipo === 'saldo') {
            const s = N.saldoDisponivel(dados);
            if (M.ehNaoLido(s)) return falhou;
            grava[k(conta, 'saldo')] = Object.assign(s, carimbo);
        } else if (tipo === 'resumo_fin') {   // cada chamada da tela traz uma parte dos cartões: junta
            const r = N.resumoFinanceiro(dados);
            if (M.ehNaoLido(r)) return falhou;
            grava[k(conta, 'resumo_fin')] = Object.assign({}, await ler(k(conta, 'resumo_fin')), r, carimbo);
        } else if (tipo === 'afil') {
            const it = N.pendenciasAfiliados(dados);
            if (M.ehNaoLido(it)) return falhou;
            const de = m => { const x = it.find(i => i.metrica === m); return x ? x.num : null; };
            grava[k(conta, 'afil')] = Object.assign({ mensagens: de('creator_message_count'), sem_amostra: de('products_without_sample_count'), amostras: de('sample_request_count'), itens: it }, carimbo);
        } else if (tipo.indexOf('saude_') === 0) {
            const parte = tipo.slice(6), cur = (await ler(k(conta, 'saude'))) || {};
            let x;
            if (parte === 'viol') x = N.violacoes(dados);
            else if (parte === 'sps') x = N.pontuacaoDaLoja(dados);
            else {
                const it = parte === 'ind' ? N.indicadoresDaLoja(dados, conta) : N.saudeDaConta(parte === 'perf' ? { performance_list: dados } : { dynamic_settlement: dados }, conta);
                x = Array.isArray(it) && it.length ? { itens: it } : M.naoLido('vazio');
            }
            if (M.ehNaoLido(x)) return falhou;
            cur[parte] = Object.assign(x, carimbo);
            // indicadores: os da tela de 03/10 (ind) ou os de antes (perf), o que foi lido por último
            const ind = [cur.ind, cur.perf].filter(Boolean).sort((a, b) => (b.lido_em || 0) - (a.lido_em || 0))[0];
            cur.indicadores = [].concat((ind && ind.itens) || [], (cur.prazo && cur.prazo.itens) || []);
            cur.pontos = cur.viol ? cur.viol.pontos : null;
            grava[k(conta, 'saude')] = Object.assign(cur, carimbo);
        } else if (tipo === 'devolucoes' || tipo === 'devolucoes_painel') {
            const cur = (await ler(k(conta, 'dev'))) || {};
            if (tipo === 'devolucoes_painel') {
                const p = N.painelDeDevolucoes(dados);
                if (M.ehNaoLido(p)) return falhou;
                cur.painel = Object.assign(p, carimbo);
            } else {
                const l = N.devolucoesDaLista(dados);
                if (M.ehNaoLido(l)) return falhou;
                cur.contadores = l.contadores;   // os contadores do topo não dependem da aba
                // sem saber a aba (aguardando você, aguardando o TikTok/cliente, tudo…) a linha não diz se está em aberto: só os contadores
                if (ped.tab) cur.abas = Object.assign({}, cur.abas, { [ped.tab]: Object.assign({ linhas: l.linhas, total: l.total }, carimbo) });
                n = ped.tab ? l.linhas.length : 0;
            }
            grava[k(conta, 'dev')] = Object.assign(cur, carimbo);
        } else if (tipo.indexOf('camp_') === 0) {
            const cur = (await ler(k(conta, 'camp'))) || {};
            if (tipo === 'camp_rec') {
                const c = N.campanhasAbertas(dados, null);
                if (c.abertas === null) return falhou;
                cur.abertas = c.abertas;
            } else if (tipo === 'camp_abertas') {
                const a = N.campanhasDaTela(dados);
                if (M.ehNaoLido(a)) return falhou;
                if (ped.campaign_id) return { ok: false, motivo: 'filtro' };   // a busca de 1 campanha só (tela de detalhe) não troca a lista inteira
                cur.abertas = a;
            } else if (tipo === 'camp_mgt') {
                const i = N.campanhasInscritas(dados);
                if (M.ehNaoLido(i)) return falhou;
                cur.inscritas = i.inscritas; cur.inscritas_lista = i.lista;
            } else if (tipo === 'camp_convites') {
                const c = N.convitesDeCampanha(dados);
                if (M.ehNaoLido(c)) return falhou;
                cur.convites = c;
            } else {   // camp_detalhe (regra de preço da subcampanha) | camp_produtos (faixa de preço por produto): guardados pelo id da campanha
                const x = tipo === 'camp_detalhe' ? N.regraDePreco(dados) : N.produtosDaCampanha(dados), id = tipo === 'camp_detalhe' ? ped.sub_campaign_id : ped.campaign_id;
                if (M.ehNaoLido(x)) return falhou;
                if (!id) return semPedido;
                const onde = tipo === 'camp_detalhe' ? 'regras' : 'produtos';
                cur[onde] = Object.assign({}, cur[onde], { [id]: Object.assign(Array.isArray(x) ? { lista: x } : x, carimbo) });
            }
            // has_joined vem false mesmo inscrita: a campanha aberta que está em "Gerencie suas campanhas" como aprovada é inscrita
            const dentro = (cur.inscritas_lista || []).filter(c => c.inscrita).map(c => c.id);
            if (Array.isArray(cur.abertas)) cur.abertas = cur.abertas.map(c => (dentro.indexOf(c.id) >= 0 && !c.inscrita ? Object.assign({}, c, { inscrita: true }) : c));
            grava[k(conta, 'camp')] = Object.assign(cur, carimbo);
        } else if (tipo === 'pedidos') {   // lista de Pedidos: só a ligação sku_id → SKU do vendedor (nada do comprador chega aqui)
            const l = N.skusDaListaDePedidos(dados);
            if (M.ehNaoLido(l)) return falhou;
            await ligaSkus([].concat.apply([], l.pedidos.map(p => p.itens.map(it => [it.sku_id, it.sku]))));
            n = l.pedidos.length;
        } else if (tipo === 'produtos' || tipo === 'produtos_skus') {   // o que está anunciado: por produto, os SKUs lidos (1 por produto até a seller expandir)
            const ps = tipo === 'produtos' ? N.produtosAnunciados(dados) : N.skusDoProduto(dados);
            if (M.ehNaoLido(ps)) return falhou;
            if (tipo === 'produtos_skus' && !ped.product_id) return semPedido;
            const cur = (await ler(k(conta, 'anuncios'))) || {}, produtos = Object.assign({}, cur.produtos);
            (tipo === 'produtos' ? ps : [{ produto_id: ped.product_id, skus: ps, expandido: true }]).forEach(p => {
                const antes = produtos[p.produto_id] || {}, skus = Object.assign({}, antes.skus);
                p.skus.forEach(s => { skus[s.sku_id] = { sku: s.sku, preco: s.preco }; });
                produtos[p.produto_id] = Object.assign({}, antes, p.expandido ? { expandido: true } : { total_skus: p.total_skus, comissao_pct: p.comissao_pct }, { skus, lido_em: em });
            });
            grava[k(conta, 'anuncios')] = Object.assign({ produtos }, carimbo);
            await ligaSkus([].concat.apply([], (tipo === 'produtos' ? ps : [{ skus: ps }]).map(p => p.skus.map(s => [s.sku_id, s.sku]))));
            n = ps.length;
        } else {   // tarefas: só o contador de mensagens não lidas de clientes (Página inicial)
            const t = N.tarefasDaPaginaInicial(dados);
            if (M.ehNaoLido(t)) return falhou;
            grava[k(conta, 'tarefas')] = Object.assign(t, carimbo);
        }
        grava['tt:conta'] = conta;   // a última loja vista DESTA empresa
        await a.set(grava);
        if (DA_LISTA.indexOf(tipo) >= 0) await podar(conta, false, a);
        return { ok: true, n };
    }

    /** Tudo o que está guardado da loja (padrão: a última vista) + custos (c|sku|, c|tiktok|) e cfg. */
    TT.ler = async function (conta) {
        conta = conta || (await area().get('tt:conta'))['tt:conta'] || null;
        if (!TT.contaValida(conta)) return null;
        // v3.3 multi-empresa (revisão 07/10/2026): custos por SKU e cfg da empresa da conta do ML aberta, como no painel. 3.3.0 (junção): a
        // camada da empresa (area) já devolve só as chaves dela, com o nome lógico ('c|sku|X' guardado como 'c|sku@<conta>|X' na outra empresa).
        const pre = k(conta, ''), ks = (await chavesCom(pre, 'c|sku', 'c|tiktok|')).concat(['cfg']);
        const t = await area().get(ks), d = { conta, peds: [], custos: {}, cfg: SHC.lerCfg ? await SHC.lerCfg() : Object.assign({}, SHC.PADRAO || {}, t.cfg || {}) };
        Object.keys(t).forEach(x => {
            if (x.indexOf('c|') === 0) d.custos[x] = t[x];
            else if (x.indexOf(pre + 'ped:') === 0) d.peds.push(t[x]);
            else if (x.indexOf(pre) === 0) d[x.slice(pre.length)] = t[x];
        });
        return d;
    };
    /** 3.3.0 (E20): só a saúde da loja (tt:<loja>:saude) da última loja vista — 2 chaves, sem passar pelos pedidos. → objeto | null (nada lido). */
    TT.lerSaude = async function (conta) {
        conta = conta || (await area().get('tt:conta'))['tt:conta'] || null;
        if (!TT.contaValida(conta)) return null;
        const ch = k(conta, 'saude');
        return (await area().get(ch))[ch] || null;
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
        // C1 (#34): extrato com valor vazio/ilegível ou que não fecha com o settlement do TikTok nunca vale como exato.
        const fecha = t => !!(t.confere && typeof t.confere.diferenca === 'number' && Math.abs(t.confere.diferenca) <= 0.01) && !(t.avisos || []).some(a => /sem valor/.test(a));
        if (!valores(ped && ped.trans).every(fecha)) return { usar: false, parcial: false, ilegivel: true };
        if (!f || f.repasse === null) return { usar: true, parcial: false, ilegivel: false };
        const usar = N.pedidoTemDetalhe(f.repasses, valores(ped && ped.trans));   // a mesma regra do "N de M pedidos com detalhe" (núcleo)
        return { usar, parcial: !usar, ilegivel: false };
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
            exato: !!j, lido_em: ped.lido_em || null, tela: j || (cob.ilegivel && !lista) ? maisNova(ped.trans, TT.TELA.transacao).tela : (f ? maisNova(ped.linhas, TT.TELA.pedidos_fin).tela : 'Pedidos'),
            extratos: f ? f.extratos : [], data_prevista: (f && f.data_prevista) || null, status_repasse: f ? (f.estimado ? 'a_liberar' : 'disponivel') : null,
            itens: itens.map((x, i) => ({ sku: x.it.sku, sku_vendedor: x.s.sku || null, sku_id: x.it.anuncio_id || null, titulo: x.it.titulo, qtd: x.it.qtd, canal_venda: base[i].canal_venda || pedido.canal_venda || null })),
            skus_lista: f && f.skus.length ? f.skus : null,   // os 3 grupos de cada SKU da linha da lista (TT.porGrupo)
            _modelo: { pedido, tarifas: Array.isArray(tarifas) ? tarifas : [], repasses: j ? j.repasses : (f ? f.repasses : []), devolucoes },
        });
    };

    /**
     * Pedido com mais de 1 SKU: vendas, taxas e imposto de cada SKU pelos 3 grupos dele (sku_records[].simple_breakdown da lista de Finanças, r.skus_lista)
     * no lugar do rateio pela venda. → por_item (o mesmo, com 1 SKU ou cancelado) | null (sem os grupos ou sem bater com o pedido: fica o rateio, "≈").
     * Regra única do lucro por SKU: a ficha, o Catálogo, a Geral e a aba Canal passam por aqui (TT.porProduto).
     */
    TT.porGrupo = function (r) {
        const its = r.por_item || [], gs = r.skus_lista || [];
        if (its.length < 2 || r.status === 'cancelado') return its;
        const bate = gs.length === its.length && gs.every((g, i) => g && String(g.sku_id || '') === String(its[i].anuncio_id || '') && typeof g.receita === 'number' && typeof g.repasse === 'number')
            && typeof r.repasse === 'number' && Math.abs(U.soma(gs, g => g.receita) - r.receita_liquida) <= 0.01 && Math.abs(U.soma(gs, g => g.repasse) - r.repasse) <= 0.01;
        // o imposto também pela venda do grupo (o motor rateia pela venda bruta); o último grupo fica com o resto: a soma do pedido não muda
        let resto = r.imposto_rs || 0;
        return bate ? its.map((x, i) => { const imposto = i === its.length - 1 ? U.r2(resto) : U.r2(gs[i].receita * (r.imposto_pct || 0) / 100); resto -= imposto;
            return Object.assign({}, x, { receita: gs[i].receita, tarifas: U.r2(gs[i].receita - gs[i].repasse), imposto }); }) : null;
    };

    /** Por produto (SKU do vendedor; sem ligação, o sku_id do TikTok): vendas, receita, repasse, lucro, margem, % de afiliado e canais. */
    TT.porProduto = function (resultados) {
        // pedido com mais de 1 SKU pelos grupos de cada SKU (TT.porGrupo); sem eles, o rateio pela venda (rateado: "≈")
        resultados = resultados.map(r => { const p = TT.porGrupo(r); return p === r.por_item ? r : Object.assign({}, r, p ? { por_item: p } : { rateado: true }); });
        const ps = CN.motor.lucroPorProduto(resultados), extra = {};
        // pela chave do lucroPorProduto (SKU normalizado): 2 grafias do mesmo SKU juntam também o título, os canais e o afiliado
        resultados.forEach(r => (r.por_item || []).forEach((x, i) => {
            const ks = U.normalizaSku(x.sku), e = extra[ks] || (extra[ks] = { titulo: '', sku_id: null, sku_vendedor: null, canais: {}, afiliado: 0, receita_exata: 0, aproximado: false });
            const it = (r.itens || [])[i] || {};
            // Pedido com vários SKUs sem os grupos: as tarifas são repartidas pela receita do item, mas no TikTok o fixo é por unidade e o
            // afiliado muda por SKU → o lucro desse produto é aproximado ("≈", como na ficha).
            if (r.rateado) e.aproximado = true;
            e.titulo = e.titulo || it.titulo || ''; e.sku_id = e.sku_id || it.sku_id; e.sku_vendedor = e.sku_vendedor || it.sku_vendedor;
            if (it.canal_venda) e.canais[it.canal_venda] = (e.canais[it.canal_venda] || 0) + 1;
            if (r.exato && r.status === 'ok') {
                const af = U.r2((r.tarifas_por_tipo.afiliado || 0) + (r.tarifas_por_tipo.afiliado_ads || 0));
                e.afiliado = U.r2(e.afiliado + af * x.participacao); e.receita_exata = U.r2(e.receita_exata + x.receita);
            }
        }));
        return ps.map(p => {
            const e = extra[U.normalizaSku(p.sku)] || {};
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
        const mes = pedidos.filter(r => r.dia && r.dia >= desde && r.dia <= hoje), ok = mes.filter(r => r.status === 'ok');
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
        const porDia = {};
        pedidos.filter(r => r.status_repasse === 'a_liberar' && r.repasse !== null).forEach(r => { const x = r.data_prevista || 'sem data'; porDia[x] = U.r2((porDia[x] || 0) + r.repasse); });
        return {
            conta: d.conta, vazio: !(d.peds || []).length && !['extratos', 'areceber', 'saldo', 'saude', 'afil', 'camp', 'falha', 'dev', 'anuncios', 'tarefas', 'resumo_fin', 'pago', 'listas'].some(c => d[c]),
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

    /**
     * Ads do TikTok digitado em Ajustes, por mês (o gasto do GMV Max fica FORA do repasse: Marketing › Anúncios da loja, "Custo líquido").
     * Grava tt:<loja>:ads_manual = {'AAAA-MM': R$, nao_uso: bool}. mudanca = {'AAAA-MM': valor | null (apaga), nao_uso: true|false}.
     * Campo vazio é "não informado" ("≈"), nunca 0; "não uso Ads no TikTok" (nao_uso) é o zero informado de propósito. Valor negativo é recusado.
     */
    TT.salvarAds = (conta, mudanca) => emFila(async () => {
        if (!TT.contaValida(conta) || !mudanca || typeof mudanca !== 'object') return { ok: false, motivo: 'formato' };
        const a = await areaDaLoja(conta), key = k(conta, 'ads_manual'), cur = Object.assign({}, (await a.get(key))[key]);
        for (const c of Object.keys(mudanca)) {
            const v = mudanca[c], x = num(v);
            if (c === 'nao_uso') cur.nao_uso = v === true;
            else if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(c)) return { ok: false, motivo: 'mes' };
            else if (v === null || v === undefined || v === '') delete cur[c];
            else if (x === null || x < 0) return { ok: false, motivo: 'valor' };
            else cur[c] = U.r2(x);
        }
        await a.set({ [key]: cur });
        return { ok: true, ads_manual: cur };
    });

    /**
     * Mês do TikTok ('AAAA-MM', pela data da venda) no MESMO formato do mês do ML (nucleo: adaptadores.ml.mesDaCascata), para o motor.somaCanais.
     * d = TT.ler(). A conta é do núcleo (adaptadores.tiktok.mesDosPedidos): vendas, taxas, frete, liquidação e lucro completos; tarifa por tipo só
     * com TODOS os pedidos do mês com detalhe (por_tipo_completo, n_com_detalhe de n_pedidos); Ads pelo campo manual (sem ele: aprox, "≈").
     */
    TT.mes = function (d, mes) {
        if (!d || !/^\d{4}-\d{2}$/.test(String(mes || ''))) return null;
        const ctx = { conta: d.conta, custos: d.custos || {}, cfg: d.cfg || {}, skumap: d.skumap || {} };
        const m = N.mesDosPedidos({ mes, conta: d.conta, resultados: (d.peds || []).map(p => TT.lucroDoPedido(p, ctx)), ads_manual: d.ads_manual });
        // ponytail: a lista cortada (a tela trouxe 50 de N e o Copiloto não pede a 2ª página; some quando a seller abre as outras) põe "≈" em TODOS os meses, porque não dá para saber
        // de que mês são os pedidos que faltam. Para afinar: conferir por demonstrativo (extratos.lista[].total_pedidos × linhas lidas dele).
        const cortadas = ['pedidos_liq', 'pedidos_espera'].map(t => (d.listas || {})[t]).filter(l => l && l.parcial);
        if (cortadas.length) Object.assign(m, { aprox: true, motivo: [m.motivo, 'o TikTok mostrou ' + cortadas.map(l => l.lidos + ' de ' + l.total).join(' e ') + ' pedidos'].filter(Boolean).join('; ') });
        return m;
    };

    /** "E se eu vender a R$ X?" no TikTok (tabela com vigência do núcleo). */
    TT.simular = (preco, ctx, cfg) => CN.tarifas.simular('tiktok', preco, Object.assign({ imposto_pct: num((cfg || {}).imposto_pct), margem_alvo_pct: num((cfg || {}).margem_alvo_pct) }, ctx || {}));

    // ── Fundo (background.js): mensagens e registro dos scripts de captura ─────────────────────────────────────────
    // world: 'MAIN' no registerContentScripts pede o Chrome 102+ (o mínimo do manifest continua 116).
    TT.SCRIPTS = [
        { id: 'copiloto-tt-pagina', matches: [TT.ORIGEM], js: ['tiktok-pagina.js'], runAt: 'document_start', world: 'MAIN', persistAcrossSessions: true },
        { id: 'copiloto-tt-tela', matches: [TT.ORIGEM], js: ['tiktok-tela.js'], runAt: 'document_start', persistAcrossSessions: true },
    ];
    /**
     * As 2 permissões OPCIONAIS do TikTok, pedidas juntas no mesmo clique em Ajustes e devolvidas juntas ao desligar:
     * 'scripting' (registrar a leitura da tela) + o site do Seller Center. A 3.1.0 não pedia nenhuma das duas.
     */
    TT.PERM = { permissions: ['scripting'], origins: [TT.ORIGEM] };
    // 3.3.0 (C1): sem o "Concordo e ligar" do quadro de Ajustes (cfg.consentimento_tiktok) nada é lido, mesmo com o resto ligado.
    const moduloLigado = cfg => !!(cfg && cfg.consentimento_tiktok) && (SHC.moduloLigado ? SHC.moduloLigado(cfg, 'tiktok') : !!(cfg && cfg.modulos && cfg.modulos.tiktok === true));
    /**
     * Scripts registrados ⇔ permissões concedidas E o TikTok ligado e SALVO em Ajustes (cfg.modulos.tiktok === true) E o consentimento gravado.
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
    /** "Apagar dados do TikTok": tudo o que o Copiloto guardou do TikTok neste Chrome (tt:*, tt@<empresa>:* e os custos c|tiktok|*). → quantas chaves saíram */
    TT.apagarDados = () => emFila(async () => {
        const ks = await chavesEm(crua(), DE_TODAS);
        if (ks.length) await crua().remove(ks);
        return ks.length;
    });
    // 3.3.0 (E9): há o que apagar? A tt:conta vem em toda captura; o resto (de todas as empresas) só é listado com o getKeys (Chrome 130+), sem ler tudo.
    TT.temDados = async () => !!(await area().get('tt:conta'))['tt:conta'] || (typeof crua().getKeys === 'function' && (await chavesEm(crua(), DE_TODAS)).length > 0);
    TT.daAbaDoTikTok = s => !!(s && s.id === root.chrome.runtime.id && s.tab && /^https:\/\/seller-br\.tiktok\.com\//.test(s.url || s.tab.url || ''));
    const daExtensao = s => !!(s && s.id === root.chrome.runtime.id && /^chrome-extension:\/\//.test(s.url || ''));

    TT.instalarFundo = function () {
        const ch = root.chrome;
        ch.runtime.onMessage.addListener((msg, sender, responder) => {
            if (!msg) return false;
            if (msg.acao === 'tiktok_captura') {   // da aba do Seller Center: {tipo, dados, conta, lido_em, pedido}
                if (!TT.daAbaDoTikTok(sender)) return false;
                // Script que ficou para trás com o TikTok desligado em Ajustes: não grava nada. Desmarcar devolve as permissões
                // na hora (antes do "Salvar canais"): sem elas, a aba que já estava aberta também para de gravar.
                area().get('cfg').then(async o => (moduloLigado((o && o.cfg) || {}) && await ch.permissions.contains(TT.PERM) ? TT.gravarCaptura(msg.tipo, msg.dados, msg.conta, msg.lido_em, msg.pedido) : { ok: false, motivo: 'desligado' }))
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
