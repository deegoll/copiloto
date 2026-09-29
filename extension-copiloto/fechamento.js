// SellerHub Copiloto — página "Fechamento do mês" (abre em aba: chrome.runtime.getURL('fechamento.html')).
// SÓ LÊ. Nada aqui muda cobrança, venda ou conta no ML/MP. O texto do chamado é só copiado: quem abre o chamado é o seller.
// Fontes: 'fech:<conta>:<AAAA-MM>' (fundo, Faturamento), 'vb:<conta>' (vendas brutas), 'fat:<conta>' (faturas),
// 'mp:repasse:<conta>' (Atividade do Mercado Pago, a confirmar ao vivo), vm|ml|<MLB> (vendas por mês), custos por SKU e cfg (imposto).
// O botão "Conferir cobranças" lê aqui mesmo (GET) o Faturamento do mês ESCOLHIDO e do anterior (v2.5.1: páginas 3 de cada vez).
// Contas em funções puras (SHC.fech.*), testadas em tests/copiloto/teste_fechamento.js com os retratos reais.
(function (root) {
    'use strict';
    const SHC = root.SHC || (root.SHC = {});
    const F = SHC.fech = {};

    const BASE = 'https://vendedores.mercadolivre.com.br';
    const MP = 'https://www.mercadopago.com.br';
    F.URL = {
        cobranca: pedido => BASE + '/billing/cnc/detail/charges?searchText=' + encodeURIComponent(pedido),   // a confirmar ao vivo
        faturamento: BASE + '/billing/resume',
    };
    // Limiares da conferência
    F.TARIFA_RAZAO = 1.3;     // tarifa cobrada ≥ 1,3× a do anúncio no preço de hoje
    F.FRETE_RAZAO = 1.5;      // frete ≥ 1,5× a mediana dos outros pedidos do anúncio
    F.DIF_MIN = 5;            // e pelo menos R$ 5 a mais
    F.REPASSE_DIF = 10;       // % de diferença entre repasse e líquido que vale explicar

    const r2 = v => SHC.r2(v);
    const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const NOMES_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    F.nomeMes = m => NOMES_MES[+m.slice(5, 7) - 1] + ' de ' + m.slice(0, 4);
    F.mesAntes = (mes, k) => { const d = new Date(+mes.slice(0, 4), +mes.slice(5, 7) - 1 - (k === undefined ? 1 : k), 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
    const diasNoMes = mes => new Date(+mes.slice(0, 4), +mes.slice(5, 7), 0).getDate();
    const dataBR = d => (/^\d{4}-\d{2}-\d{2}/.test(d || '') ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : '');

    // Pedido do COMUM: SHC.mpAtividades(htmlOuTexto). O leitor tolerante mora em ml-extrator.js (SHC.mpAtividadesDoHtml);
    // texto puro também serve (vira linhas pelas quebras). → [{data, tipo:'venda'|'reembolso', valor (com sinal), transacao, titulo, status}]
    if (!SHC.mpAtividades) SHC.mpAtividades = (htmlOuTexto, hoje) => SHC.mpAtividadesDoHtml(htmlOuTexto, hoje);

    /** Cobranças cruas → meses como 'fech:' (v3.1: o estornosPorTipo, ≤ 0, já vem de SHC.fechamentoDasCobrancas; antes era somado aqui). */
    F.fechDasCobrancas = function (cobs, desde) {
        const out = SHC.fechamentoDasCobrancas(cobs, desde);
        // Ads usa o dia das visitas (dataRef = véspera): ler a partir do dia 1 criaria um mês anterior "lido" com quase tudo 0.
        Object.keys(out).forEach(m => { if (desde && m < desde) delete out[m]; else out[m].lidoAgora = true; });
        return out;
    };

    /**
     * Vendas brutas do mês: os dias de vb:<conta> ou, sem eles, fech.vendasBrutas (o fundo grava a soma dos dias lidos: {valor, dias, …}).
     * → { valor, cancelado, devolvido, dias, diasMes, completo } | null. Mês com dia faltando = completo:false (não entra na cascata).
     * hoje = 'AAAA-MM-DD': no mês corrente basta ter lido até hoje. Sem 'dias' (e sem completo:true) = incompleto: nunca vira "mês inteiro".
     */
    F.vendasBrutas = function (fech, vb, mes, hoje) {
        const fv = fech && fech.vendasBrutas;
        const s = (vb && vb.dias && SHC.vendasBrutasDoMes(vb.dias, mes))
            || (fv && typeof fv === 'object' ? fv : (SHC.num(fv) !== null ? { valor: SHC.num(fv) } : null));
        if (!s || SHC.num(s.valor) === null) return null;
        const precisa = hoje && hoje.slice(0, 7) === mes ? +hoje.slice(8, 10) : diasNoMes(mes);
        const dias = typeof s.dias === 'number' ? s.dias : null;
        const completo = s.completo === true || (dias !== null && dias >= precisa);
        // v2.5.1: mês que já acabou e não foi lido inteiro: os dias soltos (de leituras antigas de 30 dias) nunca aparecem como se fossem o mês.
        return { valor: SHC.num(s.valor), cancelado: SHC.num(s.cancelado), devolvido: SHC.num(s.devolvido), dias, diasMes: diasNoMes(mes),
            completo, naoLidoInteiro: !completo && !!hoje && mes < hoje.slice(0, 7) };
    };

    /**
     * Custo dos produtos vendidos no mês = custo por SKU (SHC.custoDeAnuncio: SKU → anúncio → família, + "outros") × vendas do mês (vm|ml).
     * itens = anúncios do retrato da conta; vm = {MLB: {'AAAA-MM': n}}; custos = chaves c|… cruas; qtdVendas = fech.qtdVendas (conferência).
     * → { valor, unidades, semCusto:[{itemId, titulo, unidades}], faltam (vendas do Faturamento a mais que as achadas), faltamDemais, completo }
     * qtdVendas tira o cancelamento no mês DO CANCELAMENTO e vm|ml no mês DA VENDA: venda cancelada na virada do mês desencontra as contagens.
     */
    F.custoProdutos = function (itens, vm, custos, mes, qtdVendas) {
        let valor = 0, unidades = 0;
        const semCusto = [];
        (itens || []).forEach(it => {
            const n = SHC.num(((vm || {})[it.itemId] || {})[mes]) || 0;
            if (!(n > 0)) return;
            unidades += n;
            const c = SHC.custoDeAnuncio(custos || {}, { sku: it.sku, itemId: it.itemId, familia: it.familia });
            if (!c) { semCusto.push({ itemId: it.itemId, titulo: it.titulo || '', unidades: n }); return; }
            valor += n * (SHC.num(c.dados.custo) + (SHC.num(c.dados.outros) || 0));
        });
        const faltam = typeof qtdVendas === 'number' ? Math.max(0, qtdVendas - unidades) : 0;
        // ponytail: folga fixa (2 ou 10%) para os cancelamentos da virada do mês; exato quando o fech gravar a contagem pela regra do vm.
        const faltamDemais = faltam > Math.max(2, Math.ceil(qtdVendas * 0.1));
        return { valor: r2(valor), unidades, semCusto, faltam, faltamDemais, completo: !semCusto.length && !faltamDemais && (unidades > 0 || qtdVendas === 0) };
    };

    const TIPOS = [
        ['tarifa_venda', 'Tarifa de venda', 'Custo por vender no Mercado Livre'],
        ['cobranca_mp', 'Custo por cobrar', 'Tarifa do Mercado Pago por receber o pagamento'],
        ['parcelamento', 'Parcelamento', 'Custo das parcelas sem juros que você oferece'],
        ['recebimento', 'Taxa de recebimento', 'Taxa do Mercado Pago para liberar o dinheiro'],
        ['frete', 'Frete por sua conta', 'Envios que você pagou (Mercado Envios)'],
        ['devolucao', 'Frete de devoluções', 'Tarifa de devolução cobrada pelo ML'],
        ['full', 'Full', 'Armazenagem e estoque antigo no Full'],
        ['ads', 'Ads (Product Ads)', 'Anúncios patrocinados no Mercado Ads'],
        ['ads_seguidores', 'Ads de Seguidores', 'Publicidade de Seguidores'],
        ['minha_pagina', 'Minha página', 'Mensalidade da Minha página'],
        ['impostos_ml', 'Impostos cobrados pelo ML', 'Ex.: ICMS-DIFAL das vendas para outros estados'],
        ['outro', 'Outras tarifas', 'Ex.: assinaturas, conteúdos digitais e a tarifa do programa de afiliados'],
    ];
    F.TIPOS = TIPOS;

    /**
     * Cascata do mês. d = { fech, vb (de F.vendasBrutas), produtos (de F.custoProdutos), impostoPct (null = não informado) }.
     * → { linhas:[{id, rotulo, ajuda, tipo:'total'|'menos'|'mais'|'info', valor (≥ 0; o tipo dá o sinal) | null, pct | null}], bruto, liquido, lucro, custosML }
     * null = não lido ("—"), nunca 0. Tipo sem cobrança num mês lido = 0 (lido, sem cobrança).
     */
    F.cascata = function (d) {
        const fech = d.fech || null, vb = d.vb && d.vb.completo ? d.vb : null;
        const bruto = vb ? vb.valor : null;
        const cancel = vb && vb.cancelado !== null && vb.devolvido !== null ? r2((vb.cancelado || 0) + (vb.devolvido || 0)) : null;
        const pt = (fech && fech.porTipo) || {}, ept = fech && fech.estornosPorTipo;
        const linhas = [], pct = v => (v !== null && bruto > 0 ? v / bruto * 100 : null);
        const add = (id, rotulo, ajuda, tipo, valor) => linhas.push({ id, rotulo, ajuda, tipo, valor: valor === null ? null : r2(valor), pct: pct(valor) });
        add('bruto', 'Vendas brutas', 'Tudo o que você vendeu no mês, antes de qualquer desconto', 'total', bruto);
        // Mês com dia faltando: mostra o valor lido marcado "parcial (N de M dias)" em vez de "—"; a cascata continua sem ele.
        if (!vb && d.vb && !d.vb.naoLidoInteiro && SHC.num(d.vb.valor) !== null) Object.assign(linhas[0], { valor: r2(d.vb.valor),
            parcial: 'parcial' + (typeof d.vb.dias === 'number' ? ' (' + d.vb.dias + ' de ' + d.vb.diasMes + ' dias)' : '') });
        add('cancelado', 'Canceladas e devolvidas', 'Vendas que voltaram (o valor da venda sai)', 'menos', cancel);
        let custosML = fech ? 0 : null;
        TIPOS.forEach(([id, rotulo, ajuda]) => {
            const v = fech ? r2((SHC.num(pt[id]) || 0) - (ept ? (SHC.num(ept[id]) || 0) : 0)) : null;
            add(id, rotulo, ajuda, 'menos', v);
            linhas[linhas.length - 1].liq = fech ? r2(SHC.num(pt[id]) || 0) : null;   // já sem o estorno (compara mês com e sem estornosPorTipo)
            if (v !== null) custosML += v;
        });
        const est = fech ? Math.abs(SHC.num(fech.estornos) || 0) : null;
        if (ept) { add('estornos', 'Estornos', 'Tarifas que o ML devolveu (vendas canceladas)', 'mais', est); custosML -= est; }
        else add('estornos', 'Estornos', 'Tarifas devolvidas pelo ML. Já estão descontadas nas linhas acima', 'info', est);
        custosML = custosML === null ? null : r2(custosML);
        // Afiliados (afil:<conta>.metricas, últimos 30 dias): estimativa do ML, só informativa (entre parênteses, fora da conta:
        // o que o ML já cobrou está nas tarifas acima). Só aparece quando os 30 dias tocam o mês e o ML mandou o custo.
        const af = d.afil, per = af && af.periodo;
        if (af && SHC.num(af.custoEstimado) !== null && per && per.de && per.ate && (!d.mes || (per.de.slice(0, 7) <= d.mes && per.ate.slice(0, 7) >= d.mes)))
            add('afiliados', 'Comissão de afiliados (estimada)', 'Estimativa do ML, ' + dataBR(per.de) + ' a ' + dataBR(per.ate) + ' (Venda com afiliados). Não entra na conta', 'info', SHC.num(af.custoEstimado));
        const liquido = bruto !== null && cancel !== null && custosML !== null ? r2(bruto - cancel - custosML) : null;
        add('liquido', 'Líquido do ML (estimado)', 'O que sobra das vendas depois de tudo o que o ML cobrou', 'total', liquido);
        const prod = d.produtos && d.produtos.completo ? d.produtos.valor : null;
        add('produtos', 'Custo dos produtos', 'Seu custo por SKU × vendas do mês', 'menos', prod);
        const imp = d.impostoPct !== null && d.impostoPct !== undefined && bruto !== null && cancel !== null ? r2((bruto - cancel) * d.impostoPct / 100) : null;
        add('imposto', 'Imposto', 'Seu imposto (Ajustes) sobre as vendas que ficaram', 'menos', imp);
        const lucro = liquido !== null && prod !== null && imp !== null ? r2(liquido - prod - imp) : null;
        add('lucro', 'Lucro do mês', 'O que ficou no bolso', 'total', lucro);
        return { linhas, bruto, liquido, lucro, custosML };
    };

    const ACOES = {
        frete: 'Veja a aba Frete no painel lateral: lá aparecem os anúncios em que o frete subiu e o texto para contestar.',
        ads: 'Abra a página "Ads por SKU" e veja quais produtos gastam mais em Ads do que sobra na venda.',
        ads_seguidores: 'Confira no Mercado Ads se a Publicidade de Seguidores está trazendo vendas.',
        tarifa_venda: 'Confira o tipo de anúncio (Clássico ou Premium) dos que mais vendem: o Premium cobra mais por venda.',
        cobranca_mp: 'Esta tarifa acompanha o valor vendido. Confira no Faturamento se ela bate com as vendas.',
        parcelamento: 'Confira quantas parcelas sem juros você oferece: quanto mais parcelas, maior esta taxa.',
        recebimento: 'Abra o Faturamento e veja o detalhe desta taxa.',
        devolucao: 'Veja no pós-venda quais produtos mais voltam e por quê.',
        full: 'Veja na aba Full o estoque parado: ele gera a armazenagem e a tarifa de estoque antigo.',
        minha_pagina: 'É a mensalidade da Minha página. Se você não usa, dá para cancelar no ML.',
        impostos_ml: 'É imposto das vendas para outros estados (DIFAL), cobrado pelo ML. Confira com o seu contador.',
        outro: 'Abra o Faturamento e veja o que é (ex.: assinaturas).',
    };
    F.ACOES = ACOES;

    // ── v3.1 (pedido da dona 26/09): "tudo que é pertinente a custo", comparado com o mês anterior, e quanto dá para recuperar ──
    // Tópico = soma de linhas da cascata. comparaTipos: só compara com um mês lido na mesma separação de tipos (fech.tipos).
    F.TOPICOS = [
        ['comissao', 'Comissão do ML', ['tarifa_venda', 'cobranca_mp', 'recebimento'], true],
        ['parcelamento', 'Parcelamento', ['parcelamento'], true],
        ['frete', 'Frete por sua conta', ['frete'], true, true],   // sep: mês lido antes de separar a devolução tinha a devolução dentro do frete
        ['devolucao', 'Frete de devoluções', ['devolucao'], true, true],
        ['full', 'Full (armazenagem)', ['full'], true, true],
        ['ads', 'Ads', ['ads', 'ads_seguidores'], true],
        ['minha_pagina', 'Minha página', ['minha_pagina'], true, true],
        ['impostos_ml', 'Impostos cobrados pelo ML', ['impostos_ml'], true, true],
        ['outro', 'Outras tarifas', ['outro'], true, true],
        ['cancelado', 'Canceladas e devolvidas', ['cancelado'], true],
        ['afiliados', 'Afiliados (estimativa do ML)', ['afiliados'], false],   // 30 dias móveis, não o mês: não compara
        ['imposto', 'Seu imposto', ['imposto'], true],
        ['produtos', 'Custo dos produtos', ['produtos'], true],
    ];
    const ACAO_CURTA = { comissao: 'Confira Clássico × Premium dos que mais vendem.', parcelamento: 'Confira quantas parcelas sem juros você oferece.',
        frete: 'Veja na aba Frete os anúncios em que ele subiu.', devolucao: 'Veja no pós-venda o que mais volta.', full: 'Veja o estoque parado na aba Full.',
        ads: 'Veja na aba Ads quem gasta mais do que aguenta.', minha_pagina: 'Se não usa a Minha página, cancele no ML.', impostos_ml: 'Confira o DIFAL com o seu contador.',
        outro: 'Abra o Faturamento e veja o que é.', cancelado: 'Veja no pós-venda os motivos.' };
    F.ACAO_CURTA = ACAO_CURTA;
    /** Mês lido já com Full/Minha página/impostos/devolução separados (ou sem cobrança nenhuma, que vale igual). */
    F.fechTiposNovos = f => !!f && ((f.tipos || 0) >= 2 || !Object.keys(f.porTipo || {}).some(k => Math.abs(SHC.num(f.porTipo[k]) || 0) > 0));
    /**
     * Custos do mês por tópico × o mês anterior. a, b = { casc (F.cascata), fech } (b pode faltar); motivos = {id: texto} para o "não lido".
     * → { linhas:[{id, rotulo, valor|null, antes|null, dif, difPct, pct, pctAntes, pp, dir:'sobe'|'desce'|'igual'|'novo'|'', comparavel, motivo, estimativa}],
     *     maior (a linha de custo que mais subiu; null = nenhuma subiu), comparou (algum tópico teve os 2 meses), bruto, brutoAntes }
     * Valor null = não lido (nunca 0). "Subiu" = mais de R$ 10 e mais de 2%; com as vendas brutas dos 2 meses, a maior é a que mais
     * cresceu em % das vendas (não engana quando as vendas sobem). Custo que era 0 e passou a ter valor = 'novo'.
     */
    F.custosTopicos = function (a, b, motivos) {
        const por = c => { const o = {}; ((c && c.linhas) || []).forEach(l => { o[l.id] = l; }); return o; };
        const pa = por(a && a.casc), pb = por(b && b.casc), bruto = (a && a.casc && a.casc.bruto) || null, brutoAntes = (b && b.casc && b.casc.bruto) || null;
        // Sempre LÍQUIDO de estorno: o mês lido agora (estornosPorTipo) tem a linha bruta (pt − ept) e o guardado pela sincronização, a
        // líquida. Somar ept (≤ 0) de volta deixa os dois na mesma base (antes: o mesmo custo "caía 10%" só por ter vindo de outro lugar).
        const soma = (p, ids, f) => { const ls = ids.map(k => p[k]), e = f && f.estornosPorTipo;
            return ls.some(l => !l || l.valor === null || l.parcial) ? null : r2(ls.reduce((s, l, i) => s + l.valor + (e ? SHC.num(e[ids[i]]) || 0 : 0), 0)); };
        const mesmaSep = F.fechTiposNovos(a && a.fech) === F.fechTiposNovos(b && b.fech);
        // Mês pela metade (em andamento ou lido só até um dia antes do fim): R$ contra um mês inteiro engana (a cobrança mensal que ainda
        // não caiu virava "▼ 100%"). Compara só pelo % das vendas, e só quando as vendas brutas dos 2 meses foram lidas.
        const fimMes = m => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
        const pela = f => !!f && (!!f.parcial || (!!f.ate && /^\d{4}-\d{2}$/.test(f.mes || '') && f.ate < fimMes(f.mes)));
        const parcial = pela(a && a.fech) || pela(b && b.fech), porPct = bruto > 0 && brutoAntes > 0;
        const linhas = [];
        F.TOPICOS.forEach(([id, rotulo, ids, compara, sep]) => {
            if (id === 'afiliados' && !pa.afiliados) return;   // conta sem afiliados (ou sem a estimativa): não é custo do mês
            const valor = soma(pa, ids, a && a.fech), comparavel = compara && (!sep || mesmaSep);
            const antes = comparavel ? soma(pb, ids, b && b.fech) : null;
            const pct = valor !== null && bruto > 0 ? valor / bruto * 100 : null, pctAntes = antes !== null && brutoAntes > 0 ? antes / brutoAntes * 100 : null;
            const pp = pct !== null && pctAntes !== null ? pct - pctAntes : null, c = F.compara(valor, antes);
            let { dif, difPct } = c, dir = c.dir === 'novo' && ['cancelado', 'imposto', 'produtos'].indexOf(id) >= 0 ? 'sobe' : c.dir;   // "custo novo" = cobrança nova do ML
            let parcialSem = false, difEquiv = null;
            if (parcial && dir && dir !== 'novo') {
                if (valor === 0 || pp === null || !porPct) { parcialSem = true; dir = ''; dif = null; difPct = null; }   // nunca "▼ 100%" de cobrança que ainda não caiu
                else { dir = Math.abs(pp) <= 0.05 ? 'igual' : pp > 0 ? 'sobe' : 'desce'; difPct = pctAntes > 0 ? pp / pctAntes * 100 : null; difEquiv = r2(pp / 100 * bruto); dif = null; }
            }
            linhas.push({ id, rotulo, valor, antes, dif, difPct, pct, pctAntes, pp, dir, comparavel: antes !== null && !parcialSem, parcialSem, difEquiv,
                motivo: valor === null ? ((motivos || {})[id] || 'não lido') : '', estimativa: id === 'afiliados',
                semSep: compara && sep && !mesmaSep });
        });
        const sobem = linhas.filter(l => (l.dir === 'sobe' || l.dir === 'novo') && ACAO_CURTA[l.id] && (l.dif !== null ? l.dif : l.difEquiv) >= 10 && (!porPct || l.dir === 'novo' || l.pp > 0.05));
        const chave = l => (porPct && l.pp !== null ? l.pp : l.dif);
        return { linhas, maior: sobem.sort((x, y) => chave(y) - chave(x))[0] || null, comparou: linhas.some(l => l.comparavel), bruto, brutoAntes, parcial };
    };
    /** Valor × antes → { dif, difPct, dir: 'sobe' | 'desce' | 'igual' (menos de R$ 1 ou de 2%) | 'novo' (antes 0) | '' (falta um dos dois) }. */
    F.compara = function (valor, antes) {
        const dif = valor !== null && valor !== undefined && antes !== null && antes !== undefined ? r2(valor - antes) : null, difPct = dif !== null && antes > 0 ? dif / antes * 100 : null;
        const dir = dif === null ? '' : antes === 0 && valor > 0 ? 'novo' : Math.abs(dif) < 1 || (difPct !== null && Math.abs(difPct) < 2) ? 'igual' : dif > 0 ? 'sobe' : 'desce';
        return { dif, difPct, dir };
    };
    /** Linhas com valor (ou não lidas) × as que ficaram em R$ 0 nos 2 meses (vão para 1 linha "sem cobrança"). */
    F.custosVisiveis = t => ({ vis: t.linhas.filter(l => !(l.valor === 0 && !(l.antes > 0))), zerados: t.linhas.filter(l => l.valor === 0 && !(l.antes > 0)) });
    const nomeCurto = m => NOMES_MES[+m.slice(5, 7) - 1];
    const PLURAL = new Set(['cancelado', 'impostos_ml', 'outro']);
    /** "Frete subiu 18% em relação a agosto (de 9,1% para 10,4% das vendas)." | "Custo novo em setembro: Full (R$ 242,20)." | null */
    F.fraseMaior = function (l, mesAntes, curta) {
        if (!l) return null;
        if (l.dir === 'novo') return 'Custo novo: ' + l.rotulo + ' (' + SHC.moeda(l.valor) + '), sem cobrança em ' + nomeCurto(mesAntes) + '.';
        return l.rotulo + (PLURAL.has(l.id) ? ' subiram ' : ' subiu ') + (l.difPct !== null ? SHC.pctTxt(l.difPct) : SHC.moeda(l.dif !== null ? l.dif : l.difEquiv)) + (l.dif === null ? ' no peso nas vendas' : '') + ' em relação a ' + nomeCurto(mesAntes)
            + (l.pp !== null && !curta ? ' (de ' + SHC.pctTxt(l.pctAntes) + ' para ' + SHC.pctTxt(l.pct) + ' das vendas).' : '.');
    };
    /** Seta da linha: {txt: '▲ 18%' | '▼ 5%' | '= igual' | '▲ novo' | '', cls: 'sobe' (vermelho) | 'desce' (verde) | 'igual' (cinza) | ''}. Custo: subir é ruim.
     *  Com o % das vendas dos 2 meses (pp), a cor segue o peso nas vendas: subiu em R$ junto com as vendas = cinza. */
    F.setaCusto = function (l) {
        if (!l || !l.dir) return { txt: '', cls: '' };
        if (l.dir === 'novo') return { txt: '▲ novo', cls: 'sobe' };
        if (l.dir === 'igual') return { txt: '= igual', cls: 'igual' };
        const q = l.difPct !== null && l.difPct !== undefined ? SHC.pctTxt(Math.abs(l.difPct)) : l.dif !== null && l.dif !== undefined ? SHC.moeda(Math.abs(l.dif)) : '';
        // Mudou em R$ mas o peso nas vendas ficou igual (acompanhou as vendas): seta cinza, não alarme.
        const noRitmo = l.pp !== null && l.pp !== undefined && (l.dir === 'sobe' ? l.pp <= 0.05 : l.pp >= -0.05);
        return { txt: (l.dir === 'sobe' ? '▲ ' : '▼ ') + q, cls: noRitmo ? 'igual' : l.dir };
    };

    /**
     * Quanto dá para recuperar (ESTIMATIVA; só o que tem base, cada parcela com a origem):
     *  - frete: frete:<conta>:hist.conciliacao.pagoAMais (últimos 30 dias; cobrado acima do frete do anúncio; fora pedido que pode ter 2+ unidades);
     *  - cobrancas: "Cobranças para conferir" (SHC.fech.conferir: tarifa acima, cobrança repetida, frete fora da curva — sem repetir pedido do frete);
     *  - estorno: venda cancelada/devolvida com a tarifa devolvida e outra cobrança não (regra 'sem_estorno');
     *  - full: remessas do Full com inconformidade que ainda aceitam reclamação e já têm custo cobrado (SHC.remessasInconformes).
     * Devoluções do pós-venda ficam fora: o ML não diz se o dinheiro voltou (sem base = não entra).
     * d = { conc (hist.conciliacao), conferir (lista de itens), inconformes (lista) } → { total, parcelas:[{id, rotulo, origem, valor, itens:[…]}] }
     */
    const ORIGEM_CURTA = { frete: 'Faturamento × anúncio · 30 dias', cobrancas: 'cobranças para conferir', estorno: 'venda cancelada', full: 'remessa com diferença' };
    F.recuperar = function (d) {
        d = d || {};
        const parcelas = [], add = (id, rotulo, origem, itens) => {
            const valor = r2(itens.reduce((s, x) => s + (x.valor || 0), 0));
            if (itens.length && valor > 0) parcelas.push({ id, rotulo, origem, curta: ORIGEM_CURTA[id], valor, itens });
        };
        const fr = ((d.conc && d.conc.pagoAMais) || []).filter(p => p && p.diferenca > 0 && !p.talvezUnidades);
        // O frete vem com OUTRO número que a venda (conciliaFrete casa por anúncio e data): o mesmo frete no "para conferir" (regra 'frete')
        // sai pelo número do frete (pedidoFrete) ou, no guardado antes dele, por anúncio + data + valor cobrado.
        const pedFrete = new Set(), chFrete = new Set();
        fr.forEach(p => { pedFrete.add(String(p.pedido)); if (p.pedidoFrete) pedFrete.add(String(p.pedidoFrete)); chFrete.add(p.itemId + '|' + p.data + '|' + r2(p.cobrado)); });
        const doFrete = x => x.regra === 'frete' && (pedFrete.has(String(x.pedido)) || chFrete.has(x.itemId + '|' + x.data + '|' + r2(x.valor)));
        add('frete', 'Frete cobrado a mais', 'Faturamento × frete do anúncio · últimos 30 dias',
            fr.map(p => Object.assign({ pedido: p.pedido, itemId: p.itemId, data: p.data, valor: p.diferenca, cobrado: p.cobrado, esperado: p.esperado }, p.dev > 0 ? { dev: p.dev } : {})));
        // v3.1: "para conferir" gravado pela versão anterior pode ter a tarifa de devolução: ela nunca entra no que dá para recuperar.
        const cf = (d.conferir || []).filter(x => x && x.diferenca > 0 && SHC.tipoCustoFechamento(x.cobranca) !== 'devolucao');
        add('cobrancas', 'Cobranças acima do esperado', 'Cobranças para conferir (tarifa acima, repetida, frete fora da curva)',
            cf.filter(x => x.regra !== 'sem_estorno' && !doFrete(x)).map(x => Object.assign({}, x, { valor: x.diferenca })));
        add('estorno', 'Cancelada ou devolvida sem estorno', 'Venda cancelada: a tarifa voltou, outra cobrança do pedido não',
            cf.filter(x => x.regra === 'sem_estorno').map(x => Object.assign({}, x, { valor: x.diferenca })));
        add('full', 'Remessas do Full com diferença', 'Custo cobrado da remessa com inconformidade (ainda dá para reclamar)',
            (d.inconformes || []).filter(r => r && r.custo > 0 && SHC.remessaPendente(r)).map(r => ({ id: r.id, quando: r.quando, prazo: r.prazo, motivos: r.motivos, link: r.link, valor: r.custo })));
        return { total: r2(parcelas.reduce((s, p) => s + p.valor, 0)), parcelas };
    };
    /** Texto do chamado de um frete cobrado a mais (mesmo formato de F.textoChamado; só pede a revisão). */
    // v3.1: é só o frete de ENVIO da venda; a tarifa de devolução do mesmo pedido (dev) fica fora e o texto diz isso (nunca pede revisão dela).
    F.chamadoFrete = (p, titulo) => F.textoChamado({ pedido: p.pedido, data: p.data, itemId: p.itemId, titulo: titulo || '', cobranca: 'Frete de envio da venda (Mercado Envios)',
        valor: p.cobrado, esperado: p.esperado, diferenca: p.valor,
        motivo: 'O frete cobrado ficou acima do custo de envio que o anúncio mostra (' + SHC.moeda(p.esperado) + ').'
            + (p.dev > 0 ? ' A tarifa de devolução deste pedido (' + SHC.moeda(p.dev) + ') não está nesta conta.' : '') });
    /**
     * Maior gargalo: o custo do ML com maior % das vendas (ou maior R$ sem vendas brutas) e o que mais subiu contra o mês anterior.
     * → { maior:{id, rotulo, valor, pct, frase, acao} | null, subiu:{id, rotulo, antes, agora, frase, acao} | null }
     */
    F.gargalo = function (atual, anterior) {
        // v3.1: sempre o valor sem o estorno (liq): um mês lido com estornosPorTipo e outro sem não viram "subiu" falso.
        const custos = c => ((c && c.linhas) || []).filter(l => l.tipo === 'menos' && ACOES[l.id] && l.valor !== null)
            .map(l => (l.liq === undefined || l.liq === null ? l : Object.assign({}, l, { valor: l.liq, pct: c.bruto > 0 ? l.liq / c.bruto * 100 : null })));
        const cs = custos(atual);
        const chave = l => (l.pct !== null ? l.pct : l.valor);
        const top = cs.filter(l => l.valor > 0).sort((a, b) => chave(b) - chave(a))[0];
        const maior = top ? { id: top.id, rotulo: top.rotulo, valor: top.valor, pct: top.pct, acao: ACOES[top.id],
            // "maior cobrança do ML": o custo dos produtos (do seller) costuma ser maior e não entra nesta comparação.
            frase: (top.rotulo + ' é a maior cobrança do ML: ' + SHC.moeda(top.valor) + (top.pct !== null ? ' (' + SHC.pctTxt(top.pct) + ' das vendas).' : '.')).replace(/R\$ /g, 'R$\u00a0') } : null;
        const ant = {};
        custos(anterior).forEach(l => { ant[l.id] = l; });
        const porPct = atual && atual.bruto > 0 && anterior && anterior.bruto > 0;
        let subiu = null;
        cs.forEach(l => {
            const a = ant[l.id];
            if (!a) return;
            const dif = porPct ? l.pct - a.pct : l.valor - a.valor;
            if (!(dif > (porPct ? 0.5 : 10)) || (subiu && subiu.dif >= dif)) return;
            subiu = { id: l.id, rotulo: l.rotulo, antes: porPct ? a.pct : a.valor, agora: porPct ? l.pct : l.valor, dif, acao: ACOES[l.id],
                frase: porPct ? l.rotulo + ' subiu de ' + SHC.pctTxt(a.pct) + ' para ' + SHC.pctTxt(l.pct) + ' das vendas (' + SHC.moeda(a.valor) + ' → ' + SHC.moeda(l.valor) + ').'
                    : l.rotulo + ' subiu de ' + SHC.moeda(a.valor) + ' para ' + SHC.moeda(l.valor) + '.' };
        });
        return { maior, subiu };
    };

    /**
     * Cobranças para conferir, por pedido (cobranças cruas de SHC.mlCobrancasDaResposta dos últimos 3 meses).
     * itensPorId = {MLB: anúncio do retrato (preço e tarifa de hoje)}.
     * → [{pedido, data, itemId, titulo, cobranca, valor, esperado, diferenca, motivo, regra}] da maior diferença para a menor.
     * Regras: cobrança repetida (mesmo texto, anúncio e valor, sem estorno); venda cancelada com tarifa devolvida e outra cobrança não;
     * tarifa de venda bem acima da do anúncio (fora múltiplos: pedido com várias unidades); frete bem acima dos outros pedidos do anúncio.
     */
    // Valor ≈ 2×, 3×… o de 1 unidade (±8%): pedido com várias unidades, não é alerta. ponytail: pedido de 2+ unidades com preço diferente escapa.
    const variasUnidades = razao => { const k = Math.round(razao); return k >= 2 && Math.abs(razao - k) <= 0.08 * k; };
    F.conferir = function (cobs, itensPorId) {
        itensPorId = itensPorId || {};
        const ped = {};
        // v3.1: a tarifa de devolução (frete de VOLTA do produto devolvido) nunca vira pedido de revisão: fica só no custo do mês.
        (cobs || []).forEach(c => { if (c && c.orderId && c.valor >= 0 && SHC.tipoCustoFechamento(c.texto) !== 'devolucao') (ped[c.orderId] || (ped[c.orderId] = [])).push(c); });
        const out = [], freteItem = {};
        const tituloDe = (id, cs) => ((cs.find(c => c.titulo) || {}).titulo) || ((itensPorId[id] || {}).titulo) || '';
        Object.keys(ped).forEach(o => {
            const cs = ped[o], data = cs.map(c => c.data).filter(Boolean).sort()[0] || '';
            const liq = {};   // tipo|MLB → cobrado − estornado
            const grupos = {};
            cs.forEach(c => {
                const t = SHC.tipoCustoFechamento(c.texto), k = t + '|' + c.itemId;
                liq[k] = r2((liq[k] || 0) + (c.estorno ? -c.valor : c.valor));
                const g = String(c.texto).replace(/^cancelamento\s+(d[oa]s?|de)\s+/i, '').toLowerCase() + '|' + c.itemId + '|' + c.valor;
                const x = grupos[g] || (grupos[g] = { c: 0, e: 0, cob: c });
                if (c.estorno) x.e++; else { x.c++; x.cob = c; }
            });
            const base = (c, extra) => Object.assign({ pedido: o, data, itemId: c.itemId, titulo: tituloDe(c.itemId, cs), cobranca: c.texto }, extra);
            Object.keys(grupos).forEach(g => {
                const x = grupos[g];
                if (x.c - x.e >= 2) out.push(base(x.cob, { regra: 'repetida', valor: r2(x.cob.valor * (x.c - x.e)), esperado: x.cob.valor, diferenca: r2(x.cob.valor * (x.c - x.e - 1)),
                    motivo: 'A mesma cobrança aparece ' + (x.c - x.e) + ' vezes neste pedido, com o mesmo valor.' }));
            });
            // Venda cancelada: tarifa de venda estornada por inteiro, outra cobrança do MESMO pedido sem estorno.
            const cancelada = cs.some(c => c.estorno && SHC.tipoCustoFechamento(c.texto) === 'tarifa_venda')
                && !Object.keys(liq).some(k => /^tarifa_venda\|/.test(k) && liq[k] > 0.01);
            Object.keys(liq).forEach(k => {
                const [t, id] = k.split('|'), v = liq[k], c = cs.find(x => !x.estorno && SHC.tipoCustoFechamento(x.texto) === t && x.itemId === id);
                if (!c || !(v > 0.01)) return;
                if (cancelada && t !== 'tarifa_venda') out.push(base(c, { regra: 'sem_estorno', valor: v, esperado: 0, diferenca: v,
                    motivo: 'A venda foi cancelada e a tarifa de venda foi devolvida, mas esta cobrança não.' }));
                const it = itensPorId[id];
                if (t === 'tarifa_venda' && it && it.tarifa > 0) {
                    const razao = v / it.tarifa;
                    if (razao >= F.TARIFA_RAZAO && !variasUnidades(razao) && v - it.tarifa >= F.DIF_MIN) out.push(base(c, { regra: 'tarifa', valor: v, esperado: it.tarifa, diferenca: r2(v - it.tarifa),
                        motivo: 'No preço de hoje (' + SHC.moeda(it.preco) + '), este anúncio paga ' + SHC.moeda(it.tarifa) + ' de tarifa por unidade. Se o preço da venda foi outro, pode estar certo.' }));
                }
                if (t === 'frete' && id && !/comprador/i.test(c.texto)) (freteItem[id] || (freteItem[id] = [])).push({ c: base(c, {}), v });
            });
        });
        Object.keys(freteItem).forEach(id => {
            const l = freteItem[id];
            l.forEach((x, i) => {
                const outros = l.filter((_, j) => j !== i).map(y => y.v).sort((a, b) => a - b);
                if (outros.length < 3) return;
                const med = outros.length % 2 ? outros[(outros.length - 1) / 2] : r2((outros[outros.length / 2 - 1] + outros[outros.length / 2]) / 2);
                if (x.v >= med * F.FRETE_RAZAO && x.v - med >= F.DIF_MIN && !variasUnidades(x.v / med)) out.push(Object.assign(x.c, { regra: 'frete', valor: x.v, esperado: med, diferenca: r2(x.v - med),
                    motivo: 'O frete deste pedido ficou bem acima do que este anúncio costuma pagar (' + SHC.moeda(med) + ' nos outros ' + outros.length + ' pedidos). Se o pedido teve mais de 1 unidade, pode estar certo.' }));
            });
        });
        return out.sort((a, b) => b.diferenca - a.diferenca);
    };

    /**
     * Custos por tipo com a origem da cobrança: "descontado nas vendas" (cobrado na operação) × "na fatura" (pago na fatura/débito).
     * Lê fech.porOrigem = { tipo: {venda, fatura} } (líquido, já sem estornos) quando o fundo gravar; sem ele, só o total (venda/fatura = null).
     * → [{id, rotulo, venda, fatura, total}] só dos tipos com valor; [] sem fech.
     */
    F.tabelaTipos = function (fech) {
        if (!fech) return [];
        const pt = fech.porTipo || {}, po = fech.porOrigem || null;
        return TIPOS.map(([id, rotulo]) => {
            // v3.1: total LÍQUIDO (porTipo), como o porOrigem: antes somava o estorno de volta e "descontado + na fatura" não dava o total.
            const total = r2(SHC.num(pt[id]) || 0), o = po && po[id];
            return { id, rotulo, venda: o && SHC.num(o.venda) !== null ? r2(SHC.num(o.venda)) : null, fatura: o && SHC.num(o.fatura) !== null ? r2(SHC.num(o.fatura)) : null, total };
        }).filter(l => l.total !== 0 || l.venda !== null || l.fatura !== null);
    };
    /**
     * Ciclo da fatura do mês (fat:<conta>): o dia de fechamento sai das faturas da conta (SHC.diaFechamento, nunca fixo) e o período
     * de SHC.cicloFatura. → {mes, nome, de, ate, dia, total, status, link} | null (sem fatura desse mês).
     */
    F.ciclo = function (fat, mes) {
        const fs = (fat && fat.faturas) || [], f = fs.find(x => x && x.mes === mes), dia = SHC.diaFechamento(fs);
        const c = f && dia ? SHC.cicloFatura(dia, mes) : null;
        if (!c) return null;
        return { mes: f.mes, nome: f.nome, de: c.de, ate: f.fechamento || c.ate, dia, total: f.total, status: f.status, link: f.linkDetalhe || F.URL.faturamento };
    };
    /** Soma dos dias de vb.dias entre de e ate (inclusive). → {valor, cancelado, devolvido, n, diasPeriodo, completo} */
    F.somaDias = function (dias, de, ate) {
        const o = { valor: 0, cancelado: 0, devolvido: 0, n: 0, diasPeriodo: Math.round((Date.parse(ate + 'T12:00:00Z') - Date.parse(de + 'T12:00:00Z')) / 864e5) + 1 };
        Object.keys(dias || {}).forEach(d => {
            if (d < de || d > ate) return;
            const x = dias[d] || {};
            o.n++; o.valor = r2(o.valor + (SHC.num(x.bruto) || 0)); o.cancelado = r2(o.cancelado + (SHC.num(x.cancelado) || 0)); o.devolvido = r2(o.devolvido + (SHC.num(x.devolvido) || 0));
        });
        o.completo = o.n >= o.diasPeriodo;
        return o;
    };
    /**
     * Rateio das faturas por mês do calendário = SHC.rateioFaturas com o porDia de todos os fech:<conta>:<mês> (fechs = {'AAAA-MM': fech|null}).
     * Mês sem porDia (gravado por versão anterior) = não lido → a fatura que o toca fica "incompleto" (o fundo grava o mesmo em fech:<conta>:rateio).
     * → [{fatura, nome, fechamento, ciclo:{de, ate}, total, porMes, totalFatura, conferido, diferenca, incompleto, linkDetalhe}]
     */
    F.rateios = function (fat, fechs) {
        const fs = (fat && fat.faturas) || [], dia = SHC.diaFechamento(fs);
        if (!dia) return [];
        const j = SHC.porDiaDosFechs(fechs);
        return SHC.rateioFaturas(j.porDia, fs, dia, j.lidos);
    };

    /** Texto educado e factual para o chamado. Só pede a revisão (nunca promete reembolso). */
    F.textoChamado = function (x) {
        return ['Olá! Peço, por favor, a revisão de uma cobrança do meu Faturamento.', '',
            'Pedido: #' + x.pedido + (x.data ? ' (' + dataBR(x.data) + ')' : ''),
            'Anúncio: ' + (x.itemId || '—') + (x.titulo ? ' – ' + x.titulo : ''),
            'Cobrança: ' + x.cobranca,
            'Valor cobrado: ' + SHC.moeda(x.valor),
            'Valor que eu esperava: ' + SHC.moeda(x.esperado),
            'Diferença: ' + SHC.moeda(x.diferenca),
            'Por quê: ' + x.motivo, '',
            'Podem conferir se o valor está correto? Obrigado.'].join('\n');
    };

    /**
     * Repasse real (Mercado Pago) × líquido estimado do mês. rep = mp:repasse:<conta>.
     * → { real, estimado, diferenca, pct, grande, frase } | null (sem repasse do mês)
     */
    F.comparaRepasse = function (rep, mes, liquido) {
        const m = rep && rep.meses && rep.meses[mes];
        if (!m) return null;
        const real = SHC.num(m.liquido);
        if (rep.desde && mes <= String(rep.desde).slice(0, 7)) return { real, estimado: null, diferenca: null, pct: null, grande: false,
            frase: 'O Mercado Pago deste mês foi lido só em parte (a leitura começou em ' + dataBR(rep.desde) + '). Por isso não comparo.' };
        if (liquido === null || liquido === undefined) return { real, estimado: null, diferenca: null, pct: null, grande: false,
            frase: 'Entraram ' + SHC.moeda(real) + ' no Mercado Pago. Falta o líquido estimado do ML para comparar.' };
        const dif = r2(real - liquido), pct = liquido ? Math.abs(dif) / Math.abs(liquido) * 100 : null;
        const grande = pct !== null && pct > F.REPASSE_DIF && Math.abs(dif) >= 50;
        return { real, estimado: liquido, diferenca: dif, pct, grande,
            frase: Math.abs(dif) < 0.01 ? 'O repasse bate com o líquido estimado.'
                : (dif < 0 ? 'Entrou ' + SHC.moeda(-dif) + ' a menos' : 'Entrou ' + SHC.moeda(dif) + ' a mais') + ' do que o líquido estimado'
                    + (pct !== null ? ' (' + SHC.pctTxt(pct) + ').' : '.') };
    };

    // ── HTML (sem biblioteca; texto de fora sempre por esc) ──
    const cor = { total: '#334155', menos: '#B91C1C', mais: '#047857', info: '#94A3B8' };
    /** Cascata como tabela + barra SVG por linha (a tabela é a própria "visão em tabela" do gráfico). */
    F.htmlCascata = function (c) {
        let run = 0, conhecido = true;
        const barras = c.linhas.map(l => {
            if (l.valor === null || l.parcial) { if (l.tipo !== 'info') conhecido = false; return null; }
            if (l.tipo === 'total') { run = l.valor; conhecido = true; return [0, l.valor]; }
            if (!conhecido || l.tipo === 'info') return null;
            const de = run; run = l.tipo === 'menos' ? r2(run - l.valor) : r2(run + l.valor);
            return [de, run];
        });
        const vals = barras.filter(Boolean).reduce((a, b) => a.concat(b), [0]);
        const min = Math.min(...vals), max = Math.max(...vals), esc1 = max - min || 1;
        const x = v => (v - min) / esc1 * 1000;
        const linha = (l, i) => {
            const b = barras[i], sinal = l.tipo === 'menos' ? '− ' : (l.tipo === 'mais' ? '+ ' : (l.tipo === 'info' ? '(' : ''));
            const fim = l.tipo === 'info' ? ')' : '';
            const svg = b ? `<svg viewBox="0 0 1000 16" preserveAspectRatio="none" role="img" aria-label="${esc(l.rotulo)}"><rect x="${x(Math.min(...b)).toFixed(1)}" y="2" width="${Math.max(2, Math.abs(x(b[1]) - x(b[0]))).toFixed(1)}" height="12" rx="2" fill="${cor[l.tipo]}"><title>${esc(l.rotulo + ': ' + SHC.moeda(l.valor))}</title></rect></svg>` : '';
            return `<tr class="${l.tipo}"><td class="rot"><b>${esc(l.rotulo)}</b><span>${esc(l.ajuda)}</span></td><td class="bar">${svg}</td>`
                + `<td class="num">${l.valor === null ? '—' : esc(sinal + SHC.moeda(l.valor) + fim)}${l.parcial ? `<span class="mini">${esc(l.parcial)}</span>` : ''}</td><td class="num pc">${l.pct === null ? '—' : esc(SHC.pctTxt(l.pct))}</td></tr>`;
        };
        return `<div class="rola"><table class="cascata"><thead><tr><th>O que</th><th class="bar"></th><th class="num">R$</th><th class="num">% das vendas</th></tr></thead><tbody>${c.linhas.map(linha).join('')}</tbody></table></div>`;
    };

    F.htmlConferir = function (lista) {
        if (!lista.length) return '<p class="sub">Nenhuma cobrança fora do normal nos pedidos lidos.</p>';
        return `<div class="rola"><table class="tabela"><thead><tr><th>Pedido</th><th>Data</th><th>Cobrança</th><th class="num">Cobrado</th><th class="num">Esperado</th><th class="num">Diferença</th><th>Por quê</th><th></th></tr></thead><tbody>`
            + lista.map((x, i) => `<tr><td>#${esc(x.pedido)}<span class="mini">${esc(x.itemId)}</span></td><td>${esc(dataBR(x.data))}</td><td class="mot">${esc(x.cobranca)}</td>`
                + `<td class="num">${esc(SHC.moeda(x.valor))}</td><td class="num">${esc(SHC.moeda(x.esperado))}</td><td class="num"><b>${esc(SHC.moeda(x.diferenca))}</b></td>`
                + `<td class="mot">${esc(x.motivo)}</td><td><button class="bt sec pq" data-copiar="${i}">Copiar texto do chamado</button> <a class="lnk" href="${esc(F.URL.cobranca(x.pedido))}" target="_blank" rel="noopener">Abrir a cobrança</a></td></tr>`).join('')
            + '</tbody></table></div>';
    };

    /** Tabela "Custos por tipo": descontado nas vendas | na fatura | total ("—" enquanto o ML não separa a origem). */
    F.htmlTipos = function (fech) {
        const ls = F.tabelaTipos(fech);
        if (!ls.length) return '<p class="sub">Cobranças deste mês ainda não lidas.</p>';
        const v = x => (x === null ? '—' : esc(SHC.moeda(x)));
        const semOrigem = ls.every(l => l.venda === null && l.fatura === null);
        return `<div class="rola"><table class="tabela"><thead><tr><th>Tipo</th><th class="num">Descontado nas vendas</th><th class="num">Na fatura</th><th class="num">Total</th></tr></thead><tbody>`
            + ls.map(l => `<tr><td>${esc(l.rotulo)}</td><td class="num">${v(l.venda)}</td><td class="num">${v(l.fatura)}</td><td class="num"><b>${v(l.total)}</b></td></tr>`).join('')
            + `<tr class="total"><td><b>Total</b></td><td class="num">${v(semOrigem ? null : r2(ls.reduce((s, l) => s + (l.venda || 0), 0)))}</td><td class="num">${v(semOrigem ? null : r2(ls.reduce((s, l) => s + (l.fatura || 0), 0)))}</td><td class="num"><b>${v(r2(ls.reduce((s, l) => s + l.total, 0)))}</b></td></tr></tbody></table></div>`
            + (semOrigem ? '<p class="sub">“Descontado nas vendas” = cobrado na operação, antes do dinheiro cair; “na fatura” = pago na fatura ou no débito automático. Essa separação aparece quando o Faturamento for lido de novo.</p>' : '<p class="sub">“Descontado nas vendas” = cobrado na operação, antes do dinheiro cair; “na fatura” = pago na fatura ou no débito automático. Os dois lados somam o total do mês.</p>');
    };
    /** Seção "Ciclo da fatura (fecha dia N)": período, vendas brutas dos dias lidos e o total da fatura. */
    F.htmlCiclo = function (c, vb) {
        if (!c) return '<p class="sub">Sem fatura fechada deste mês. As faturas dos últimos meses aparecem depois da sincronização.</p>';
        const s = F.somaDias(vb && vb.dias, c.de, c.ate);
        const liq = s.completo && SHC.num(c.total) !== null ? r2(s.valor - s.cancelado - s.devolvido - c.total) : null;
        return `<p class="sub">Fatura de ${esc(c.nome || F.nomeMes(c.mes))}: de ${esc(dataBR(c.de))} a ${esc(dataBR(c.ate))} (fecha dia ${c.dia}). Não é o mês do calendário.</p>
          <div class="kpis"><div class="kpi"><span class="kn">Vendas brutas no ciclo</span><b>${s.n ? esc(SHC.moeda(s.valor)) : '—'}</b>${s.n && !s.completo ? `<span class="mini">parcial (${s.n} de ${s.diasPeriodo} dias)</span>` : ''}</div>
          <div class="kpi"><span class="kn">Canceladas e devolvidas</span><b>${s.n ? esc(SHC.moeda(r2(s.cancelado + s.devolvido))) : '—'}</b></div>
          <div class="kpi"><span class="kn">Total da fatura (tudo o que o ML cobrou)</span><b>${SHC.num(c.total) === null ? '—' : esc(SHC.moeda(c.total))}</b><span class="mini">${esc(c.status || '')}</span></div>
          <div class="kpi"><span class="kn">Sobra antes do custo dos produtos</span><b>${liq === null ? '—' : esc(SHC.moeda(liq))}</b></div></div>
          <a class="lnk" href="${esc(c.link)}" target="_blank" rel="noopener">Abrir esta fatura no ML</a>`;
    };
    /** Seção "Faturas × meses (rateio)": cada fatura repartida pelos meses do calendário, com a conferência e o link. */
    F.htmlRateio = function (fat, fechs) {
        const linhas = F.rateios(fat, fechs).slice(0, 6);
        if (!linhas.length) return '';
        const nomeMes = m => F.nomeMes(m).replace(/ de \d{4}$/, '');
        const conf = r => r.incompleto ? '<span class="mini">parte do ciclo ainda não lida no Faturamento</span>'
            : r.conferido ? '<span class="mini">✓ bate com o total da fatura</span>'
            : (r.diferenca === null ? '' : `<span class="mini" style="color:var(--ambar)">A soma das cobranças do ciclo (${esc(SHC.moeda(r.total))}) não bate com o total da fatura (${esc(SHC.moeda(r.totalFatura))}): diferença de ${esc(SHC.moeda(r.diferenca))}. Pode ser estorno de fatura anterior. Confira na fatura.</span>`);
        return `<section class="card" id="f-rateio"><h2>Faturas × meses (rateio)</h2><p class="sub">Cada fatura junta cobranças de dois meses do calendário. Aqui, quanto de cada fatura é de cada mês, conferido com o total da fatura.</p>
          <div class="rola"><table class="tabela"><thead><tr><th>Fatura</th><th>Ciclo</th><th class="num">Total da fatura</th><th>Por mês</th><th></th></tr></thead><tbody>${linhas.map(r => `<tr><td>${esc(r.nome || F.nomeMes(r.fatura))}</td><td>${esc(dataBR(r.ciclo.de))} a ${esc(dataBR(r.ciclo.ate))}</td><td class="num">${r.totalFatura === null ? '—' : esc(SHC.moeda(r.totalFatura))}</td>
            <td class="mot">${Object.keys(r.porMes).sort().map(m => esc(nomeMes(m)) + ': ' + esc(SHC.moeda(r.porMes[m]))).join(' · ')}${conf(r)}</td>
            <td><a class="lnk" href="${esc(r.linkDetalhe || F.URL.faturamento)}" target="_blank" rel="noopener">Abrir a fatura</a></td></tr>`).join('')}</tbody></table></div></section>`;
    };
    /** Notas fiscais por fatura (fat.notas['AAAA-MM'] de SHC.mlNotasFiscais) com "Baixar no ML" (aba fiscal da fatura). */
    F.htmlNotas = function (fat) {
        const notas = (fat && fat.notas) || {}, links = (fat && fat.linkNotas) || {};
        const meses = Object.keys(notas).filter(m => Array.isArray(notas[m]) && notas[m].length).sort().reverse().slice(0, 6);
        const fs = ((fat && fat.faturas) || []);
        if (!meses.length) return '';
        const nomeDe = m => { const f = fs.find(x => x.mes === m); return f && f.nome ? f.nome : F.nomeMes(m); };
        const linkDe = m => links[m] || (((fs.find(x => x.mes === m) || {}).notas || {}).url) || F.URL.faturamento;
        return `<section class="card" id="f-notas"><h2>Notas fiscais</h2><p class="sub">As notas que o ML emitiu para cada fatura. O arquivo é baixado na própria fatura do ML.</p>
          <div class="rola"><table class="tabela"><thead><tr><th>Fatura</th><th>Nota</th><th class="num">Valor</th><th>Emissão</th><th>Município</th><th>Número</th><th></th></tr></thead><tbody>${meses.map(m => notas[m].map((n, i) => `<tr>${i === 0 ? `<td rowspan="${notas[m].length}">${esc(nomeDe(m))}</td>` : ''}<td class="mot">${esc(n.concept)}${n.cancelamento ? ' <span class="mini">cancelamento</span>' : ''}</td><td class="num">${n.amount === null || n.amount === undefined ? '—' : esc(SHC.moeda(n.amount))}</td><td>${esc(dataBR(n.emissao))}</td><td>${esc(n.municipio)}</td><td>${esc(n.numero)}</td>${i === 0 ? `<td rowspan="${notas[m].length}"><a class="lnk" href="${esc(linkDe(m))}" target="_blank" rel="noopener">Baixar no ML</a></td>` : ''}</tr>`).join('')).join('')}</tbody></table></div></section>`;
    };

    // v3.1 (29/09): o que o Copiloto lê do Mercado Pago, sem prometer data (créditos/cashback/ajustes ainda sem retrato real).
    F.MP_LE = 'O Copiloto lê do Mercado Pago as vendas e os reembolsos. Créditos, bonificações, cashback e ajustes ainda não entram.';
    /** Cartão "Repasse do Mercado Pago": leitura ao vivo (etapa 'repasse') → "✓ Lido às HH:MM · N vendas e reembolsos" → comparação. */
    F.htmlRepasse = function (v, liquido) {
        const cab = '<section class="card" id="f-repasse"><h2>Repasse do Mercado Pago</h2>';
        if (!v.temMP) return cab + '<p class="sub">Conecte o Mercado Pago para comparar o que entrou de verdade com o líquido estimado. O Copiloto só lê a sua Atividade (vendas e reembolsos).</p><button class="bt" data-mp>Conectar Mercado Pago</button></section>';
        const etapa = SHC.htmlEtapa(v.st, ['repasse'], v.agora);
        // Leitura pedida por esta página (fora da sincronização): o fundo não manda a contagem de páginas → barra sem %.
        const lendo = etapa || (v.lendoMP ? '<div class="shs shs-etapa" role="status" aria-live="polite"><b>Lendo o Mercado Pago agora…</b><div class="shs-barra shs-sem"><i></i></div></div>' : '');
        const rep = F.comparaRepasse(v.rep, v.mes, liquido);
        let lido = '';
        if (!lendo && v.rep && v.rep.ts) {
            const n = Object.keys(v.rep.meses || {}).reduce((s, m) => s + (SHC.num((v.rep.meses[m] || {}).n) || 0), 0);
            const dia = new Date(v.rep.ts), hj = new Date(v.agora || Date.now());
            const quando = dia.toDateString() === hj.toDateString() ? 'às ' + SHC.hhmm(v.rep.ts)
                : 'em ' + String(dia.getDate()).padStart(2, '0') + '/' + String(dia.getMonth() + 1).padStart(2, '0') + ' às ' + SHC.hhmm(v.rep.ts);
            lido = `<p class="ok-lido">✓ Lido ${esc(quando)} · ${esc(n + (n === 1 ? ' venda ou reembolso' : ' vendas e reembolsos'))}</p>`;
        }
        return cab + lendo + lido
            + (rep ? `<div class="kpis"><div class="kpi"><span class="kn">Entrou no Mercado Pago</span><b>${esc(SHC.moeda(rep.real))}</b></div><div class="kpi"><span class="kn">Líquido estimado do ML</span><b>${esc(SHC.moeda(rep.estimado))}</b></div><div class="kpi"><span class="kn">Diferença</span><b>${esc(SHC.moeda(rep.diferenca))}</b></div></div><p${rep.grande ? ' class="aviso"' : ' class="sub"'}>${esc(rep.frase)}</p>`
                : (lendo ? '' : '<p class="sub">Repasse do Mercado Pago deste mês ainda não lido.</p>'))
            + '<p class="sub">O valor pode não bater no mesmo mês: o ML libera o dinheiro alguns dias depois da venda, e reembolsos e Ads entram quando são cobrados.</p>'
            + `<p class="sub">${esc(F.MP_LE)}</p>`
            + `<button class="bt sec" data-mp${lendo ? ' disabled' : ''}>Atualizar do Mercado Pago</button></section>`;
    };

    /**
     * Página inteira (string). v = {a, b (doMes do mês e do anterior), mes, hoje, msg, lidas, conferencia, st, agora, temMP, rep, fat, lendoMP, conferindo}.
     * Selo da sincronização ao lado de "Sincronizar agora"; enquanto Faturamento/Vendas brutas não foram lidos na sincronização
     * que está rodando, a etapa (texto + barra) fica no lugar do aviso "ainda não lidas".
     */
    F.htmlPagina = function (v) {
        const a = v.a, b = v.b, g = F.gargalo(a.casc, b.casc), st = v.st || {}, agora = v.agora || Date.now(), hoje = v.hoje, mes = v.mes;
        const meses = []; for (let i = 0; i < 13; i++) meses.push(F.mesAntes(hoje.slice(0, 7), i));
        const sinc = SHC.statusSync(st, agora).estado === 'sincronizando';
        const etFat = SHC.htmlEtapa(st, ['faturamento'], agora), etVb = SHC.htmlEtapa(st, ['vendasBrutas'], agora);
        const notas = [];
        // Diagnóstico do mês na última sincronização (etapas.faturamento.meses): diz por que não leu, em vez de só "ainda não lidas".
        const motivoFat = SHC.textosMeses({ [mes]: ((((st.etapas || {}).faturamento || {}).meses) || {})[mes] })[0];
        if (!a.fech) { if (!etFat) notas.push('As cobranças deste mês ainda não foram lidas.' + (motivoFat ? ' Última tentativa: ' + motivoFat + '.' : '') + ' Clique em "Conferir cobranças" para ler o Faturamento agora.'); }
        else if (!a.fechGuardado) notas.push('Cobranças lidas agora do Faturamento (ainda não guardadas pela sincronização).');
        else if (a.fech.parcial) notas.push('O Faturamento deste mês foi lido só em parte.');
        // v2.5.1: mês que já acabou sem as vendas brutas inteiras → aviso com "Tentar agora" (lê só esse mês na hora).
        const vbFalta = !etVb && mes < hoje.slice(0, 7) && (!a.vb || !a.vb.completo);
        if (vbFalta) { /* aviso com botão: F.htmlVbFalta */ }
        else if (!a.vb) { if (!etVb) notas.push('Vendas brutas de ' + F.nomeMes(mes) + ': ainda não lidas. Sincronize com o Mercado Livre aberto.'); }
        else if (!a.vb.completo) notas.push('Vendas brutas: o ML mostrou só ' + (a.vb.dias !== null ? a.vb.dias + ' de ' + a.vb.diasMes + ' dias' : 'parte') + ' deste mês (' + SHC.moeda(a.vb.valor) + '). Sem o mês inteiro, a cascata não usa esse valor.');
        if (a.produtos.semCusto.length) notas.push('Falta o custo de ' + SHC.qtd(a.produtos.semCusto.length, 'anúncio vendido', 'anúncios vendidos') + ' no mês: ' + a.produtos.semCusto.slice(0, 3).map(s => s.itemId).join(', ') + (a.produtos.semCusto.length > 3 ? '…' : '') + '.');
        if (a.produtos.faltam) notas.push('O Faturamento tem ' + SHC.qtd(a.produtos.faltam, 'venda', 'vendas') + ' a mais que as achadas nos anúncios: pode ser venda sem anúncio identificado ou cancelada no mês seguinte.'
            + (a.produtos.faltamDemais ? ' A diferença é grande: o custo dos produtos fica sem valor.' : ''));
        if (a.impostoPct === null) notas.push('Informe o seu imposto no painel do Copiloto (Ajustes) para ver o lucro.');
        else if (a.impostoPct === 0) notas.push('O imposto está em 0% nos Ajustes. Se você paga imposto, corrija lá.');
        const fat = ((v.fat && v.fat.faturas) || []).slice(0, 6);
        const lido = st.cobrancasEm ? 'Faturamento lido em ' + new Date(st.cobrancasEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
        const gl = x => x ? `<p><b>${esc(x.frase)}</b></p><p class="sub">${esc(x.acao)}${x.id === 'ads' ? ' <a class="lnk" href="ads.html">Abrir Ads por SKU</a>' : ''}</p>` : '';
        // Mês do calendário | Ciclo da fatura (fecha dia N): o dia vem das faturas da conta (nunca fixo).
        const ciclo = F.ciclo(v.fat, mes), diaFech = ciclo ? ciclo.dia : (fat[0] && fat[0].fechamento ? +fat[0].fechamento.slice(8, 10) : null);
        const visao = v.visao === 'ciclo' ? 'ciclo' : 'mes';
        const alterna = `<div class="acoes" style="margin:6px 0 8px"><button class="bt${visao === 'mes' ? '' : ' sec'} pq" data-visao="mes">Mês do calendário</button><button class="bt${visao === 'ciclo' ? '' : ' sec'} pq" data-visao="ciclo">Ciclo da fatura${diaFech ? ' (fecha dia ' + diaFech + ')' : ''}</button></div>`;
        return `<section class="card" id="f-mes"><div class="cab"><div><h2>Mês</h2><select id="mes" aria-label="Mês">${meses.map(m => `<option value="${m}"${m === mes ? ' selected' : ''}>${esc(F.nomeMes(m))}${m === hoje.slice(0, 7) ? ' (em andamento)' : ''}</option>`).join('')}</select>${alterna}
              <p class="sub">Comparação com ${esc(F.nomeMes(b.m))}. Números do Faturamento do ML, pela data da cobrança.</p></div>
              <div class="sync-caixa"><div class="sync-topo">${SHC.htmlSync(st, agora)}<button class="bt sec" data-sync${sinc ? ' disabled' : ''}>${sinc ? 'Sincronizando…' : 'Sincronizar agora'}</button><button class="bt" data-conferir${v.conferindo ? ' disabled' : ''}>${v.conferindo ? 'Lendo o Faturamento…' : 'Conferir cobranças'}</button></div>${lido ? `<small class="sync-lido">${esc(lido)}</small>` : ''}</div></div>
              <p id="aviso" class="sub" aria-live="polite">${esc(v.msg)}</p>${etFat}${etVb}${vbFalta ? F.htmlVbFalta(mes, st, v.lendoVb) : ''}${notas.map(n => `<p class="aviso">${esc(n)}</p>`).join('')}</section>
            ${F.htmlOndeFoi(a.casc, nomeCurto(mes)) ? `<section class="card" id="f-ondefoi"><h2>Para onde foi o dinheiro de ${esc(nomeCurto(mes))}</h2>${F.htmlOndeFoi(a.casc, nomeCurto(mes))}</section>` : ''}
            ${F.htmlConfFaturas(v.fat, v.fechs, v.vb, hoje)}
            ${F.htmlCustos(v.custos || F.custosTopicos(a, b, F.motivosMes(a)), mes, b.m)}
            ${F.htmlRecuperar(v.rec || null, v.tituloDe, !!v.recLido)}
            ${F.htmlCustoNovo(v.fat)}
            ${visao === 'ciclo' ? `<section class="card" id="f-ciclo"><h2>Ciclo da fatura</h2>${F.htmlCiclo(ciclo, v.vb)}</section>` : ''}
            <section class="card" id="f-cascata"><h2>Da venda ao lucro</h2><p class="sub">${visao === 'ciclo' ? 'Mês do calendário, para comparar com o ciclo acima. ' : ''}Cada linha em R$ e em % das vendas brutas. "—" = ainda não lido (não é zero).</p>${F.htmlCascata(a.casc)}</section>
            <section class="card" id="f-tipos"><h2>Custos por tipo</h2>${F.htmlTipos(a.fech)}</section>
            <section class="card" id="f-gargalo"><h2>Maior gargalo</h2>${g.maior || g.subiu ? gl(g.maior) + (g.subiu && (!g.maior || g.subiu.id !== g.maior.id) ? gl(g.subiu) : (g.subiu ? `<p class="sub">${esc(g.subiu.frase)}</p>` : '')) : '<p class="sub">Sem cobranças lidas neste mês.</p>'}</section>
            ${F.htmlRepasse(Object.assign({}, v, { st, agora }), a.casc.liquido)}
            <section class="card" id="f-conferir"><h2>Cobranças para conferir</h2><p class="sub">Pedidos do mês escolhido e do anterior. O Copiloto só aponta: quem decide abrir o chamado é você. O texto só pede a revisão, sem prometer reembolso.<br>No Mercado Livre: Ajuda › Faturamento e tarifas, ou "Abrir a cobrança" na linha.</p>
              ${v.lidas ? F.htmlConferir(v.conferencia || []) : '<p class="sub">Clique em "Conferir cobranças" para ler o Faturamento e procurar cobranças fora do normal.</p>'}</section>
            ${fat.length ? `<section class="card" id="f-faturas"><h2>Faturas do ML</h2><p class="sub">A fatura fecha todo dia ${esc((fat[0].fechamento || '').slice(8, 10) || '—')}: ela não é o mês do calendário.</p><div class="rola"><table class="tabela"><thead><tr><th>Fatura</th><th>Fechamento</th><th>Vencimento</th><th class="num">Total</th><th class="num">Pago</th><th class="num">A pagar</th><th>Situação</th><th></th></tr></thead><tbody>${fat.map(f => `<tr><td>${esc(f.nome)}</td><td>${esc(dataBR(f.fechamento))}</td><td>${esc(dataBR(f.vencimento))}</td><td class="num">${esc(SHC.moeda(f.total))}</td><td class="num">${SHC.num(f.quitado) === null ? '—' : esc(SHC.moeda(f.quitado))}</td><td class="num">${SHC.num(f.aPagar) === null ? '—' : esc(SHC.moeda(f.aPagar))}</td><td>${esc(f.status)}</td><td>${f.linkDetalhe ? `<a class="lnk" href="${esc(f.linkDetalhe)}" target="_blank" rel="noopener">Abrir a fatura</a>` : ''}</td></tr>`).join('')}</tbody></table></div><a class="lnk" href="${F.URL.faturamento}" target="_blank" rel="noopener">Abrir o Faturamento no ML</a></section>` : ''}
            ${F.htmlRateio(v.fat, v.fechs)}
            ${F.htmlNotas(v.fat)}
            <p class="fonte">Fontes: Faturamento, métricas e lista de Anúncios do Mercado Livre e Atividade do Mercado Pago (lidos neste Chrome) · custo e imposto = seus. Líquido e lucro são estimativas.</p>`;
    };

    /** Motivo do "não lido" de cada tópico do mês (doMes): falta custo, falta imposto, Faturamento/vendas ainda não lidos. */
    F.motivosMes = function (x) {
        const o = {};
        if (x && x.produtos && x.produtos.semCusto && x.produtos.semCusto.length) o.produtos = 'falta o custo de ' + SHC.qtd(x.produtos.semCusto.length, 'anúncio', 'anúncios');
        if (x && (x.impostoPct === null || x.impostoPct === undefined)) o.imposto = 'informe o imposto em Ajustes';
        if (x && !x.fech) F.TOPICOS.forEach(([id]) => { if (!o[id] && id !== 'cancelado' && id !== 'imposto' && id !== 'produtos') o[id] = 'Faturamento ainda não lido'; });
        if (x && (!x.vb || !x.vb.completo)) ['cancelado', 'imposto'].forEach(k => { if (!o[k]) o[k] = 'vendas do mês ainda não lidas'; });
        return o;
    };
    const menosM = v => (v < 0 ? '−' + SHC.moeda(-v) : '+' + SHC.moeda(v));
    /** Seção "Custos de agosto × julho": manchete com o maior aumento + um tópico por linha (valor, antes, ▲▼, % das vendas). */
    F.htmlCustos = function (t, mes, ant) {
        const fr = F.fraseMaior(t.maior, ant), m = t.maior;
        const cor = m ? (m.dir === 'novo' || (m.pp !== null ? m.pp >= 1 : m.difPct >= 20) ? 'pr' : 'at') : (t.comparou ? 'ok' : '');
        const fato = fr || (t.comparou ? 'Nenhum custo subiu em relação a ' + nomeCurto(ant) + (t.parcial ? ' (pelo peso nas vendas: o mês está em andamento).' : '.')
            : t.parcial ? 'Mês em andamento: comparo pelo % das vendas depois que as vendas dos 2 meses forem lidas.' : 'Falta ' + nomeCurto(ant) + ' lido para comparar.');
        const v = x => (x === null ? '<span class="nl">não lido</span>' : esc(SHC.moeda(x)));
        const linha = l => {
            const s = F.setaCusto(l), pc = l.pct === null ? '—' : esc(SHC.pctTxt(l.pct));
            return `<tr><td class="rot"><b>${esc(l.rotulo)}</b>${l.valor === null && l.motivo !== 'não lido' ? `<span>${esc(l.motivo)}</span>` : ''}${l.semSep ? `<span>${esc(nomeCurto(ant))} foi lido antes de separar este custo: sem comparação</span>` : ''}${l.parcialSem ? '<span>mês em andamento: sem comparação</span>' : ''}${l.estimativa ? '<span>últimos 30 dias · não entra na conta</span>' : ''}</td>`
                + `<td class="num">${v(l.valor)}</td><td class="num pc">${l.comparavel ? v(l.antes) : '—'}</td>`
                + `<td class="num">${s.txt ? `<span class="seta ${s.cls}">${esc(s.txt)}</span>` : ''}${l.dif !== null && l.dir !== 'igual' ? `<span class="mini">${esc(menosM(l.dif))}</span>` : ''}</td>`
                + `<td class="num pc">${pc}${l.pp !== null ? `<span class="mini">era ${esc(SHC.pctTxt(l.pctAntes))}</span>` : ''}</td></tr>`;
        };
        return `<section class="card" id="f-custos"><h2>Custos de ${esc(nomeCurto(mes))} × ${esc(nomeCurto(ant))}</h2>
          <p class="manchete"><span class="pt ${cor}"></span><b>${esc(fato)}</b>${m ? ' ' + esc(ACAO_CURTA[m.id]) : ''}</p>
          <div class="rola"><table class="tabela custos"><thead><tr><th>Custo</th><th class="num">${esc(nomeCurto(mes))}</th><th class="num">${esc(nomeCurto(ant))}</th><th class="num">Mudou</th><th class="num">% das vendas</th></tr></thead>
          <tbody>${F.custosVisiveis(t).vis.map(linha).join('')}</tbody></table></div>${F.custosVisiveis(t).zerados.length ? `<p class="sub">Sem cobrança nos 2 meses: ${esc(F.custosVisiveis(t).zerados.map(l => l.rotulo).join(', '))}.</p>` : ''}
          <p class="sub"><span class="seta sobe">▲</span> vermelho = o custo subiu · <span class="seta desce">▼</span> verde = caiu · <span class="seta igual">▲</span> cinza = mudou junto com as vendas (o peso nas vendas ficou igual) · “não lido” não é zero.</p></section>`;
    };
    /** Seção "Quanto dá para recuperar" (estimativa). rec = F.recuperar; tituloDe(MLB) → título; lido = alguma das bases já foi lida. */
    F.htmlRecuperar = function (rec, tituloDe, lido) {
        const cab = '<section class="card" id="f-recuperar"><h2>Quanto dá para recuperar <small>estimativa</small></h2>';
        const rod = '<p class="sub">Estimativa: quem decide o que devolve é o ML. O texto do chamado só pede a revisão. Devoluções do pós-venda ficam fora: o ML não informa se o dinheiro voltou.</p></section>';
        if (!rec || !rec.parcelas.length) return cab + `<p class="sub">${lido ? '✓ Nada para recuperar nas cobranças, fretes e remessas lidos.' : 'Aparece depois da próxima sincronização (Faturamento, frete e Full).'}</p>` + rod;
        const t = id => esc((tituloDe && tituloDe(id)) || id || '');
        const item = (p, x, i) => {
            if (p.id === 'full') return `<li><span><b>Remessa ${esc(x.id)}</b><small>${esc(x.motivos.join(' · '))}${x.prazo ? ' · reclamar até ' + esc(dataBR(x.prazo).slice(0, 5)) : ''}</small></span><b class="num">${esc(SHC.moeda(x.valor))}</b><a class="bt pq" href="${esc(x.link)}" target="_blank" rel="noopener">Reclamar no ML</a></li>`;
            const sub = p.id === 'frete' ? 'cobrado ' + SHC.moeda(x.cobrado) + ' × ' + SHC.moeda(x.esperado) + ' do anúncio' : curto(x.cobranca || '', 60);
            return `<li><span><b>Pedido #${esc(x.pedido)} · ${t(x.itemId)}</b><small>${esc(sub)}</small></span><b class="num">${esc(SHC.moeda(x.valor))}</b>`
                + `<span class="acoes"><button class="bt sec pq" data-copiar-rec="${p.id}:${i}">Copiar texto do chamado</button>`
                + (p.id === 'estorno' ? `<a class="lnk" href="${esc(SHC.POSVENDA_URL || F.URL.faturamento)}" target="_blank" rel="noopener">Ver no pós-venda</a>` : `<a class="lnk" href="${esc(F.URL.cobranca(x.pedido))}" target="_blank" rel="noopener">Abrir a cobrança</a>`) + '</span></li>';
        };
        return cab + `<p class="rec-tot"><b>${esc(SHC.moeda(rec.total))}</b> em ${esc(SHC.qtd(rec.parcelas.reduce((s, p) => s + p.itens.length, 0), 'item', 'itens'))}</p>`
            + rec.parcelas.map(p => `<div class="parc ${p.id}"><div class="pc-cab"><b>${esc(p.rotulo)}</b><b class="num">${esc(SHC.moeda(p.valor))}</b></div><span class="mini">Origem: ${esc(p.origem)}</span>`
                + `<ul class="rec-it">${p.itens.slice(0, 5).map((x, i) => item(p, x, i)).join('')}</ul>${p.itens.length > 5 ? `<p class="sub">E mais ${p.itens.length - 5}${p.id === 'frete' ? ' na aba Frete do painel' : p.id === 'full' ? ' na aba Full' : ' em “Cobranças para conferir”'}.</p>` : ''}</div>`).join('') + rod;
    };
    const curto = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
    /** v3.1: seção "Custo novo na fatura" (SHC.custosNovos de fat:<conta>). Sem 2 faturas lidas não compara → nada; sem custo novo → 1 linha verde. */
    F.htmlCustoNovo = function (fat) {
        const cn = SHC.custosNovos ? SHC.custosNovos(fat) : { base: false, itens: [] };
        if (!cn.base) return '';
        const linkOk = u => /^https:\/\/([a-z]+\.)*mercadolivre\.com\.br\//.test(u || ''), its = cn.itens;
        const umLink = its.length > 1 && its.every(x => x.link === its[0].link) && linkOk(its[0].link) ? its[0] : null;   // todos na mesma fatura: 1 botão só
        if (!cn.itens.length) return `<section class="card" id="f-custonovo"><h2>Custo novo na fatura</h2><p class="ok-lido">✓ Nenhum custo novo: comparei os tipos de tarifa de ${cn.lidas} faturas.</p></section>`;
        return `<section class="card" id="f-custonovo"><h2>Custo novo na fatura</h2><p class="manchete"><span class="pt ${cn.itens.some(x => x.novo) ? 'pr' : 'at'}"></span><b>${esc(SHC.qtd(cn.itens.length, 'custo novo ou que subiu muito', 'custos novos ou que subiram muito'))}.</b> Sai do seu lucro: veja por que e como evitar.</p>`
            + cn.itens.map(x => `<div class="parc ${x.novo ? 'novo' : ''}"><div class="pc-cab"><b>${esc(x.tipo)}</b><b class="num">${esc(SHC.moeda(x.valor))}</b></div>`
                + `<span class="mini">${esc(x.categoria)} · fatura ${esc(x.aberta ? 'em andamento' : 'de ' + x.nomeFatura)} · ${x.novo ? esc(x.desde && x.desde !== x.nomeFatura ? 'novo desde a fatura de ' + x.desde : 'novo: não aparecia nas faturas anteriores') : `<span class="seta sobe">▲ ${x.pct}%</span> era ${esc(SHC.moeda(x.antes))}`}</span>`
                + `<ul class="rec-it">${x.porque ? `<li><span><b>Por quê</b><small>${esc(x.porque)}</small></span></li><li><span><b>Como evitar</b><small>${esc(x.evitar)}</small></span></li>` : '<li><span><b>Custo novo sem explicação conhecida</b><small>Confira no detalhe da fatura.</small></span></li>'}`
                + (umLink ? '' : `<li><span><b>Não reconhece este custo?</b><small>Conteste no ML pela fatura.</small></span>${linkOk(x.link) ? `<a class="bt pq" href="${esc(x.link)}" target="_blank" rel="noopener">Abrir a fatura</a>` : ''}</li>`) + '</ul></div>').join('')
            + (umLink ? `<p class="manchete" style="margin-top:8px"><span>Não reconhece algum? Conteste no ML.</span> <a class="bt pq" href="${esc(umLink.link)}" target="_blank" rel="noopener">Abrir a fatura${umLink.aberta ? '' : ' de ' + esc(umLink.nomeFatura)}</a></p>` : '')
            + '<p class="sub">Comparei os tipos de tarifa de cada fatura com as anteriores: novo = não aparecia; subiu = mais de 50% e mais de R$ 50 contra a fatura anterior.</p></section>';
    };

    // ── v3.1 (29/09, perguntas da dona): CONFERE COM A FATURA DO ML · FATURA × FATURA ANTERIOR · PARA ONDE FOI O DINHEIRO ──
    // Categoria da fatura do ML ↔ tipos do Copiloto: UM LUGAR SÓ. A ordem importa ("Tarifas de envios Full" é Full, não envio).
    // A fatura põe a devolução dentro de "Tarifas de envios" e "Custo por cobrar", "Taxa de recebimento" e uma "Taxa de parcelamento" dentro de
    // "Tarifas de venda" (visto ao vivo 26/09): por isso "Tarifas de venda" e "Taxas de parcelamento" viram 1 linha (o Copiloto não separa as duas).
    // Afiliados ("Tarifas do programa de afiliados") e assinaturas caem em "Outras tarifas" (tipo 'outro' no Copiloto).
    F.GRUPOS_FATURA = [
        ['full', 'Full', /\bfull\b/i, ['full']],
        ['envios', 'Envios', /envio|devolu/i, ['frete', 'devolucao']],
        ['ads', 'Publicidade (Ads)', /publicidad|product ads/i, ['ads', 'ads_seguidores']],
        ['venda', 'Tarifas de venda e parcelamento', /^(?!.*afiliad).*(venda|vender|parcel|mercado pago|recebimento)/i, ['tarifa_venda', 'cobranca_mp', 'recebimento', 'parcelamento']],
        ['impostos', 'Impostos (DIFAL)', /imposto|difal|icms/i, ['impostos_ml']],
        ['minha_pagina', 'Minha página', /minha p[áa]gina/i, ['minha_pagina']],
        ['outro', 'Outras tarifas', /[\s\S]/, ['outro']],
    ];
    F.grupoFatura = nome => F.GRUPOS_FATURA.find(g => g[2].test(String(nome || '')));
    /** Mês do calendário que o Copiloto põe ao lado da fatura: fecha até o dia 15 → o mês anterior (a maior parte do ciclo; retrato 29/09:
     *  a fatura "Setembro", que fecha 05/09, bate com agosto do Copiloto em Ads e frete); fecha depois do dia 15 → o próprio mês. */
    F.mesDaFatura = (mes, fechamento) => { const d = +String(fechamento || '').slice(8, 10); return d >= 1 && d <= 15 ? F.mesAntes(mes, 1) : mes; };
    F.BATE_RS = 1; F.BATE_PCT = 0.5;   // bate = diferença de até R$ 1 ou até 0,5%
    F.bate = (dif, base) => Math.abs(dif) <= F.BATE_RS || (Math.abs(base) > 0 && Math.abs(dif) / Math.abs(base) * 100 <= F.BATE_PCT);
    const nomeC = m => NOMES_MES[+String(m).slice(5, 7) - 1] || '';
    const dm = d => (/^\d{4}-\d{2}-\d{2}/.test(d || '') ? d.slice(8, 10) + '/' + d.slice(5, 7) : '');
    const fimMesISO = m => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
    const diaMais = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
    /** Ciclo da fatura: do dia seguinte ao fechamento da fatura anterior (fat.categorias/fat.faturas) até o fechamento desta.
     *  Sem o fechamento anterior: SHC.cicloFatura (mesmo dia no mês anterior). → { de, ate } | null. */
    F.cicloDaFatura = function (fat, mesFat) {
        const cat = ((fat && fat.categorias) || {})[mesFat], ate = cat && String(cat.fechamento || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ate || '')) return null;
        const mAnt = F.mesAntes(mesFat, 1), a = ((fat.categorias || {})[mAnt]) || ((fat.faturas || []).find(f => f && f.mes === mAnt)) || null;
        const fa = a && /^\d{4}-\d{2}-\d{2}$/.test(String(a.fechamento || '')) && a.fechamento < ate ? a.fechamento : null;
        return fa ? { de: diaMais(fa, 1), ate } : SHC.cicloFatura(+ate.slice(8, 10), mesFat);
    };
    /**
     * Cobranças do Copiloto no ciclo EXATO da fatura (dia da cobrança, como a fatura), somando porDiaTipo/porDia de todos os fechs.
     * Todo mês que o ciclo toca tem de ter sido lido com porDiaTipo (v3.1) até o último dia do ciclo nele; senão null (usa o mês do calendário).
     * → { de, ate, porTipo (cobrado, antes dos cancelamentos), estornos (≥ 0), total (líquido) } | null
     * ponytail: ciclo que começa no dia 1º perde o Ads cobrado nesse dia se o fech do mês anterior não vier em fechs.
     */
    F.somaCiclo = function (fechs, de, ate) {
        if (!de || !ate || de > ate) return null;
        for (let m = de.slice(0, 7); m <= ate.slice(0, 7); m = F.mesAntes(m, -1)) {
            const f = (fechs || {})[m], ult = ate < fimMesISO(m) ? ate : fimMesISO(m);
            if (!f || !f.porDia || (!f.porDiaTipo && Object.keys(f.porDia).length) || (f.ate && f.ate < ult)) return null;
        }
        const porTipo = {}, j = SHC.porDiaDosFechs(fechs);
        let bruto = 0, total = 0;
        Object.keys(fechs || {}).forEach(m => { const pd = (fechs[m] && fechs[m].porDiaTipo) || {};
            Object.keys(pd).forEach(d => { if (d >= de && d <= ate) Object.keys(pd[d]).forEach(t => { const v = SHC.num(pd[d][t]) || 0; porTipo[t] = r2((porTipo[t] || 0) + v); bruto += v; }); }); });
        Object.keys(j.porDia).forEach(d => { if (d >= de && d <= ate) total += j.porDia[d]; });
        return { de, ate, porTipo, estornos: r2(Math.max(0, bruto - total)), total: r2(total) };
    };
    /**
     * A conta do "Total da fatura" em cada modo (a frase tem de fechar com o número mostrado; teste_confere_fatura confere):
     *  'ciclo'/'bruto': as linhas estão ANTES dos cancelamentos nos dois lados → total = custos − diferença dos cancelamentos.
     *  'misto': o Copiloto já tirou os cancelamentos das linhas; a fatura, não → total = custos + cancelamentos da fatura.
     *  'liquido': os dois lados já sem cancelamentos → total = custos + os de faturas anteriores (a fatura põe nos pagamentos).
     * → { custos (soma das diferenças das linhas), outro } com total.dif ≈ custos + outro.
     */
    F.contaTotal = function (modo, linhas, cancel, ant) {
        const custos = r2((linhas || []).reduce((s, l) => s + l.dif, 0));
        const outro = modo === 'misto' ? (cancel ? cancel.ml : 0) : modo === 'liquido' ? (ant || 0) : (cancel ? -cancel.dif : 0);
        return { custos, outro: r2(outro) };
    };
    F.motivoTotal = function (modo, linhas, cancel, ant, dif) {
        const k = F.contaTotal(modo, linhas, cancel, ant), resto = r2(dif - k.custos - k.outro), cus = 'Diferença nos custos (' + sinalM(k.custos) + ')';
        let t = modo === 'misto' ? cus + (cancel && cancel.ml >= 0.01 ? ' mais os cancelamentos da fatura (' + SHC.moeda(cancel.ml) + '): o Copiloto já tirou os cancelamentos das linhas; a fatura, não.' : '.')
            : modo === 'liquido' ? cus + (ant ? ' mais os cancelamentos de faturas anteriores (' + SHC.moeda(ant) + '), que a fatura põe nos pagamentos.' : '.')
            : cus + (cancel && Math.abs(cancel.dif) >= 0.01 ? ' menos a diferença nos cancelamentos (' + sinalM(cancel.dif) + ').' : '.');
        if (Math.abs(resto) > F.BATE_RS) t += ' Os outros ' + SHC.moeda(Math.abs(resto)) + ' não dá para saber de onde vêm: confira no detalhe da fatura.';
        return t;
    };
    /**
     * Uma fatura FECHADA (fat.categorias[mesFat]) × o Copiloto. Compara na mesma base:
     *  'ciclo' (soma = F.somaCiclo: os dias exatos da fatura, antes dos cancelamentos — o jeito certo) | e, sem ele, o mês do calendário
     *  (fech de F.mesDaFatura): 'bruto' (o fech tem estornosPorTipo) | 'liquido' (a fatura tem o cancelado de cada categoria) |
     *  'misto' (lidos por versão anterior: Copiloto sem estorno × fatura antes dos cancelamentos — o motivo diz isso).
     * ciclo = {de, ate} (F.cicloDaFatura, só para o texto do motivo; opcional).
     * → { mesFat, fatura, fechamento, mes, modo, de, ate, linhas:[{id, rotulo, ml, cop, dif, ok, motivo}], cancel (linha | null), total (linha | null),
     *     ok, manchete, link } | { mesFat, fatura, mes, semFech:true } (mês do Copiloto não lido inteiro) | null (fatura aberta ou sem categorias)
     */
    F.conferirFatura = function (cat, fech, mesFat, soma, ciclo, novos) {
        if (!cat || !Array.isArray(cat.categorias) || cat.aberta || !/^\d{4}-\d{2}$/.test(mesFat || '')) return null;
        const mes = F.mesDaFatura(mesFat, cat.fechamento), base = { mesFat, fatura: cat.nome || F.nomeMes(mesFat), fechamento: cat.fechamento || '', mes, link: cat.link || '' };
        if (!soma && (!fech || fech.parcial || (fech.ate && fech.ate < fimMesISO(mes)))) return Object.assign(base, { semFech: true });
        const pt = soma ? soma.porTipo : fech.porTipo || {}, ept = soma ? null : fech.estornosPorTipo || null;
        const modo = soma ? 'ciclo' : ept ? 'bruto' : cat.categorias.length && cat.categorias.every(c => typeof c.cancelado === 'number') ? 'liquido' : 'misto';
        const cic = soma || ciclo || null, periodo = cic ? dm(cic.de) + ' a ' + dm(cic.ate) : '';
        // Dias comparados (o ciclo, ou o mês do calendário): o motivo "virada" só vale para diferença do tamanho de ~2 dias da linha.
        const dias = cic ? Math.max(1, Math.round((Date.parse(cic.ate) - Date.parse(cic.de)) / 864e5) + 1) : +fimMesISO(mes).slice(8, 10);
        // Cancelamentos: a fatura põe à parte os das tarifas do mesmo ciclo; os de tarifas de fatura ANTERIOR viram "Cancelamentos de tarifas
        // em estornos" (nos pagamentos). O Copiloto soma todo cancelamento do período. Fatura lida por versão anterior (sem a linha):
        // cancelamentos = soma das categorias − total da fatura.
        const somaCat = r2(cat.categorias.reduce((s, c) => s + (SHC.num(c.valor) || 0), 0));
        const canc = typeof cat.cancelamentos === 'number' ? cat.cancelamentos : typeof cat.total === 'number' && somaCat - cat.total > 0 ? r2(somaCat - cat.total) : null;
        const ant = typeof cat.estornosAnteriores === 'number' ? cat.estornosAnteriores : 0;
        const ml = {};
        cat.categorias.forEach(c => { const g = F.grupoFatura(c.nome)[0]; ml[g] = r2((ml[g] || 0) + (SHC.num(c.valor) || 0) - (modo === 'liquido' ? c.cancelado : 0)); });
        const cop = ids => r2(ids.reduce((s, id) => s + (SHC.num(pt[id]) || 0) - (ept ? SHC.num(ept[id]) || 0 : 0), 0));
        const SEM_MOTIVO = 'Não dá para saber o motivo: confira esta linha no detalhe da fatura.';
        const linhas = [];
        F.GRUPOS_FATURA.forEach(([id, rotulo, , ids]) => {
            const m = ml[id] || 0, c = cop(ids);
            if (!(m > 0) && Math.abs(c) < 1) return;
            const dif = r2(c - m), ok = F.bate(dif, m), diario = Math.max(m, c) / dias;
            // Cobrança nova desta fatura na mesma categoria (SHC.custosNovos), quando a fatura cobrou mais: é a pista mais concreta.
            const nv = !ok && dif < 0 && (novos || []).find(x => x && x.novo && x.valor > 0 && (F.grupoFatura(x.categoria || x.tipo) || [])[0] === id);
            const motivo = ok ? '' : nv ? 'Nesta fatura há uma cobrança nova: ' + nv.tipo + ' (' + SHC.moeda(nv.valor) + '). Pode ser ela: confira no detalhe da fatura.'
                : modo === 'ciclo' ? 'Nos mesmos dias da fatura (' + periodo + ') não bate: confira esta linha no detalhe da fatura.'
                : !(m > 0) ? 'Não está nesta fatura: pode ter ido para a fatura anterior ou para a próxima.'
                : Math.abs(c) < 1 ? 'O Copiloto não achou esta cobrança em ' + nomeC(mes) + ': pode ser de outro mês.'
                : id === 'ads' ? (Math.abs(dif) <= 1.5 * diario ? 'O Copiloto conta o Ads pelo dia das visitas; o ML cobra no dia seguinte. Na virada do mês, 1 dia muda de lado.' : SEM_MOTIVO)
                : modo === 'misto' && dif < 0 ? (canc !== null && Math.abs(dif) <= canc + ant ? 'A fatura mostra esta linha antes dos cancelamentos; o Copiloto, depois deles.' : SEM_MOTIVO)
                : Math.abs(dif) > 2 * diario ? SEM_MOTIVO
                : periodo ? 'A fatura vai de ' + periodo + '; aqui é o mês de ' + nomeC(mes) + '. Os dias da virada mudam de lado.'
                : 'Pode ser cobrança perto da virada do mês (a fatura fecha em ' + dm(cat.fechamento) + ') ou cancelada depois.';
            linhas.push({ id, rotulo, ml: r2(m), cop: c, dif, ok, motivo });
        });
        let cancel = null;
        if (canc !== null) {
            const m = r2(canc + ant), c = r2(Math.abs(soma ? soma.estornos : SHC.num(fech.estornos) || 0));
            const dif = r2(c - m), ok = F.bate(dif, m);
            cancel = { id: 'cancel', rotulo: 'Cancelamentos de tarifas', ml: m, cop: c, dif, ok,
                motivo: ok ? '' : modo === 'ciclo' ? 'Nos mesmos dias da fatura não bate. A fatura põe à parte os cancelamentos feitos depois do fechamento: confira no detalhe da fatura.'
                    : 'O Copiloto soma os cancelamentos feitos em ' + nomeC(mes) + ', de qualquer fatura; a fatura só os das tarifas dela' + (ant ? ' (mais ' + SHC.moeda(ant) + ' de faturas anteriores, já somados)' : '') + '. Não é cobrança a mais.' };
        }
        // Total: o Copiloto tira todo cancelamento; a fatura, só os dela (os de faturas anteriores estão nos pagamentos): soma de volta o "ant".
        let total = null;
        if (typeof cat.total === 'number') {
            const liq = soma ? soma.total : SHC.TIPOS_FECHAMENTO.reduce((s, id) => s + (SHC.num(pt[id]) || 0), 0), c = r2(liq + ant), dif = r2(c - cat.total);
            // "✓ bate" no total só com diferença de até R$ 1, ou dentro dos 0,5% E com todas as linhas batendo (0,5% de um total grande
            // escondia uma linha ✗ de R$ 61).
            const ok = Math.abs(dif) <= F.BATE_RS || (F.bate(dif, cat.total) && linhas.every(l => l.ok) && (!cancel || cancel.ok));
            total = { id: 'total', rotulo: 'Total da fatura', ml: cat.total, cop: c, dif, ok, motivo: ok ? '' : F.motivoTotal(modo, linhas, cancel, ant, dif) };
        }
        // A manchete fala primeiro de custo (o que pode ser cobrança a mais); o cancelamento que não bate só vem depois.
        const ruins = linhas.filter(l => !l.ok).sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif)).concat(cancel && !cancel.ok ? [cancel] : []);
        const ok = !ruins.length && (!total || total.ok), Nome = nomeC(mes).charAt(0).toUpperCase() + nomeC(mes).slice(1);
        const manchete = ok ? Nome + ' bate com a fatura do ML.'
            : ruins.length ? 'Diferença de ' + SHC.moeda(Math.abs(ruins[0].dif)) + ' em ' + ruins[0].rotulo.toLowerCase() + (ruins.length > 1 ? ' (e mais ' + (ruins.length - 1) + ')' : '') + '.'
            : 'Diferença de ' + SHC.moeda(Math.abs(total.dif)) + ' no total da fatura.';
        return Object.assign(base, { modo, de: cic ? cic.de : '', ate: cic ? cic.ate : '', linhas, cancel, total, ok, manchete });
    };
    /** As faturas fechadas com categorias, da mais recente para trás (até n), cada uma × o Copiloto (ciclo exato quando der; senão o mês).
     *  fechs = {'AAAA-MM': fech | null}. A que ainda não dá para comparar (semFech) vai para o fim. */
    F.conferirFaturas = function (fat, fechs, n) {
        const cat = (fat && fat.categorias) || {};
        let novos = [];
        try { novos = typeof SHC.custosNovos === 'function' ? SHC.custosNovos(fat).itens : []; } catch (e) { novos = []; }
        return Object.keys(cat).filter(m => /^\d{4}-\d{2}$/.test(m)).sort().reverse()
            .map(m => { const c = F.cicloDaFatura(fat, m), s = c && F.somaCiclo(fechs, c.de, c.ate);
                return F.conferirFatura(cat[m], (fechs || {})[F.mesDaFatura(m, cat[m] && cat[m].fechamento)] || null, m, s, c, novos.filter(x => x && x.fatura === m)); })
            .filter(Boolean).sort((a, b) => !!a.semFech - !!b.semFech).slice(0, n || 3);
    };

    /**
     * Fatura × a fatura do mês anterior, por categoria (valor da fatura, antes dos cancelamentos). Só compara 2 faturas FECHADAS e seguidas.
     * vendas = {agora, antes} (vendas brutas dos meses do Copiloto; opcional) → frase do "por quê" (as vendas caíram junto?).
     * → { nome, nomeAnt, linhas:[{id, rotulo, agora, antes, dif, difPct, dir:'sobe'|'desce'|'igual'|'novo'|'sumiu'}], cancel, total, manchete, porque, vendasTxt } | null
     */
    F.faturaVsAnterior = function (fat, mesFat, vendas) {
        const cat = (fat && fat.categorias) || {}, a = cat[mesFat], mAnt = /^\d{4}-\d{2}$/.test(mesFat || '') ? F.mesAntes(mesFat, 1) : '', b = cat[mAnt];
        if (!a || !b || a.aberta || b.aberta || !Array.isArray(a.categorias) || !Array.isArray(b.categorias)) return null;
        const soma = c => { const o = {}; c.categorias.forEach(x => { const g = F.grupoFatura(x.nome)[0]; o[g] = r2((o[g] || 0) + (SHC.num(x.valor) || 0)); }); return o; };
        const sa = soma(a), sb = soma(b), linhas = [];
        const linha = (id, rotulo, agora, antes) => { const c = F.compara(agora, antes); return { id, rotulo, agora, antes, dif: c.dif, difPct: c.difPct, dir: agora === 0 && antes > 0 ? 'sumiu' : c.dir }; };
        F.GRUPOS_FATURA.forEach(([id, rotulo]) => { if ((sa[id] || 0) > 0 || (sb[id] || 0) > 0) linhas.push(linha(id, rotulo, sa[id] || 0, sb[id] || 0)); });
        const cancel = typeof a.cancelamentos === 'number' && typeof b.cancelamentos === 'number' ? linha('cancel', 'Cancelamentos (voltou para você)', a.cancelamentos, b.cancelamentos) : null;
        const total = typeof a.total === 'number' && typeof b.total === 'number' ? linha('total', 'Total da fatura', a.total, b.total) : null;
        const nome = a.nome || F.nomeMes(mesFat), nomeAnt = b.nome || F.nomeMes(mAnt), low = s => String(s).toLowerCase();
        let manchete = '', porque = '', vendasTxt = '';
        if (total && total.dir) {
            manchete = total.dir === 'igual' ? 'A fatura de ' + low(nome) + ' veio igual à de ' + low(nomeAnt) + '.'
                : 'A fatura de ' + low(nome) + ' veio ' + SHC.moeda(Math.abs(total.dif)) + (total.dif < 0 ? ' menor' : ' maior') + ' que a de ' + low(nomeAnt)
                    + (total.difPct !== null ? ' (' + (total.dif < 0 ? '−' : '+') + SHC.pctTxt(Math.abs(total.difPct)) + ')' : '') + '.';
            const mesmos = linhas.filter(l => l.dif && Math.sign(l.dif) === Math.sign(total.dif)).sort((x, y) => Math.abs(y.dif) - Math.abs(x.dif)).slice(0, 2);
            if (mesmos.length && total.dir !== 'igual') porque = (total.dif < 0 ? 'Caiu mais em ' : 'Subiu mais em ') + mesmos.map(l => l.rotulo.toLowerCase() + ' (' + (l.dif < 0 ? '−' : '+') + SHC.moeda(Math.abs(l.dif)) + ')').join(' e ') + '.';
        }
        // As vendas dos meses da fatura (quando lidas): custo que acompanhou as vendas não é alarme.
        const va = vendas && SHC.num(vendas.agora), vb2 = vendas && SHC.num(vendas.antes);
        if (total && va > 0 && vb2 > 0 && a.total > 0 && b.total > 0) {
            const pv = (va / vb2 - 1) * 100, pa = a.total / va * 100, pb = b.total / vb2 * 100;
            vendasTxt = 'As vendas ' + (pv < 0 ? 'caíram ' : 'subiram ') + SHC.pctTxt(Math.abs(pv)) + '. ' + (Math.abs(pa - pb) < 0.5 ? 'O peso da fatura nas vendas ficou igual (' + SHC.pctTxt(pa) + '): o custo acompanhou as vendas.'
                : 'O peso da fatura nas vendas ' + (pa > pb ? 'subiu' : 'caiu') + ' de ' + SHC.pctTxt(pb) + ' para ' + SHC.pctTxt(pa) + '.');
        }
        return { mesFat, mAnt, nome, nomeAnt, linhas, cancel, total, manchete, porque, vendasTxt, link: a.link || '' };
    };

    // ── Desenho (sem biblioteca). Barras em CSS (.cf-b > i com largura em %), cores do ESPEC. ──
    const larg = (v, max) => (max > 0 && v > 0 ? Math.max(1.5, Math.min(100, v / max * 100)).toFixed(1) : '0');
    const sinalM = v => (v < 0 ? '−' : '+') + SHC.moeda(Math.abs(v));
    /** Cartão "Confere com a fatura do ML" (conteúdo; o título fica com quem chama). r = F.conferirFatura. */
    F.htmlConfere = function (r) {
        if (!r) return '';
        const cab = `${esc(r.fatura)}${r.fechamento ? ' (fecha ' + esc(dm(r.fechamento)) + ')' : ''} × ${r.modo === 'ciclo' ? 'Copiloto de ' + esc(dm(r.de)) + ' a ' + esc(dm(r.ate)) : esc(nomeC(r.mes)) + ' no Copiloto'}`;
        if (r.semFech) return `<p class="cf-sub">${cab}</p><p class="est vazio">${esc(nomeC(r.mes).charAt(0).toUpperCase() + nomeC(r.mes).slice(1))} ainda não foi lido inteiro no Copiloto: sem comparação.</p>`;
        const todas = r.linhas.concat(r.cancel ? [r.cancel] : []), max = Math.max(1, ...todas.map(l => Math.max(l.ml, l.cop)));
        const lin = (l, forte) => `<div class="cf-l ${l.ok ? 'ok' : 'x'}${forte ? ' tot' : ''}"><div class="cf-t"><span class="cf-i" aria-label="${l.ok ? 'bate' : 'não bate'}">${l.ok ? '✓' : '✗'}</span><b>${esc(l.rotulo)}</b>`
            + `<span class="cf-v">${l.ok ? 'bate' : esc(sinalM(l.dif))}</span></div>`
            + (forte ? '' : `<div class="cf-b" title="Fatura do ML: ${esc(SHC.moeda(l.ml))}"><i class="ml" style="width:${larg(l.ml, max)}%"></i></div><div class="cf-b" title="Copiloto: ${esc(SHC.moeda(l.cop))}"><i class="cp" style="width:${larg(l.cop, max)}%"></i></div>`)
            + `<small class="cf-n">ML ${esc(SHC.moeda(l.ml))} · Copiloto ${esc(SHC.moeda(l.cop))}</small>${l.ok ? '' : `<small class="cf-m">${esc(l.motivo)}</small>`}</div>`;
        return `<p class="manchete"><span class="pt ${r.ok ? 'ok' : 'at'}"></span><b>${esc(r.manchete)}</b></p>`
            + `<p class="cf-sub">${cab} · <span class="cf-lg ml"></span>ML <span class="cf-lg cp"></span>Copiloto</p>`
            + todas.map(l => lin(l)).join('') + (r.total ? lin(r.total, true) : '')
            + (r.modo === 'misto' ? '<p class="cf-sub">Lido por versão anterior: o Copiloto mostra as tarifas já sem os cancelamentos; a fatura, antes deles. A comparação nos mesmos dias da fatura aparece nas próximas faturas, lidas por esta versão.</p>' : '')
            + (/^https:\/\/([a-z]+\.)*mercadolivre\.com\.br\//.test(r.link) ? `<a class="lnk" href="${esc(r.link)}" target="_blank" rel="noopener">Abrir a fatura no ML</a>` : '');
    };
    /** Cartão "Fatura × a anterior" (por que subiu ou caiu): barras antes (cinza) × agora (vermelho = subiu, verde = caiu). v = F.faturaVsAnterior. */
    F.htmlFaturaVs = function (v) {
        if (!v) return '';
        const ls = v.linhas.concat(v.cancel ? [v.cancel] : []), max = Math.max(1, ...ls.map(l => Math.max(l.agora, l.antes)));
        const chip = l => { const c = l.id === 'cancel' ? { sobe: 'desce', desce: 'sobe' }[l.dir] || l.dir : l.dir;   // cancelamento que sobe = mais dinheiro de volta (bom)
            const t = l.dir === 'novo' ? '▲ novo' : l.dir === 'sumiu' ? '▼ sumiu' : l.dir === 'igual' ? '= igual' : (l.dir === 'sobe' ? '▲ ' : '▼ ') + (l.difPct !== null ? SHC.pctTxt(Math.abs(l.difPct)) : SHC.moeda(Math.abs(l.dif)));
            return `<span class="var ${c === 'novo' ? 'sobe' : c === 'sumiu' ? 'desce' : c}">${esc(t)}</span>`; };
        const cor = l => (l.id === 'cancel' ? 'an2' : l.dir === 'sobe' || l.dir === 'novo' ? 'pr' : l.dir === 'desce' || l.dir === 'sumiu' ? 'ok' : 'cz');
        const lin = l => `<div class="cf-l fv"><div class="cf-t"><b>${esc(l.rotulo)}</b>${chip(l)}</div>`
            + `<div class="cf-b" title="${esc(v.nomeAnt)}: ${esc(SHC.moeda(l.antes))}"><i class="an" style="width:${larg(l.antes, max)}%"></i></div><div class="cf-b" title="${esc(v.nome)}: ${esc(SHC.moeda(l.agora))}"><i class="${cor(l)}" style="width:${larg(l.agora, max)}%"></i></div>`
            + `<small class="cf-n">${esc(v.nomeAnt)} ${esc(SHC.moeda(l.antes))} → ${esc(v.nome)} ${esc(SHC.moeda(l.agora))}${l.dif ? ' · ' + esc(sinalM(l.dif)) : ''}</small></div>`;
        const t = v.total, dirT = t ? t.dir : '';
        return `<p class="manchete"><span class="pt ${dirT === 'sobe' ? 'pr' : dirT === 'desce' ? 'ok' : ''}"></span><b>${esc(v.manchete || 'Fatura de ' + v.nome + ' × ' + v.nomeAnt + '.')}</b>${v.porque ? ' ' + esc(v.porque) : ''}</p>`
            + (v.vendasTxt ? `<p class="cf-sub">${esc(v.vendasTxt)}</p>` : '')
            + `<p class="cf-sub"><span class="cf-lg an"></span>${esc(v.nomeAnt)} <span class="cf-lg pr"></span>${esc(v.nome)} (vermelho = subiu · verde = caiu)</p>`
            + ls.map(lin).join('')
            + (t ? `<div class="cf-l tot"><div class="cf-t"><b>Total da fatura</b>${chip(t)}</div><small class="cf-n">${esc(v.nomeAnt)} ${esc(SHC.moeda(t.antes))} → ${esc(v.nome)} ${esc(SHC.moeda(t.agora))}</small></div>` : '');
    };
    /**
     * "Para onde foi o dinheiro": 1 barra das vendas brutas repartida em canceladas, tarifas, frete, devoluções, Ads e o que sobrou (líquido do ML).
     * Sempre com o valor SEM estorno (liq). → { partes:[{id, rotulo, valor, pct, cor}], bruto } | null (falta algum pedaço: nunca inventa).
     */
    F.PARTES_DINHEIRO = [['cancelado', 'Canceladas e devolvidas', ['cancelado'], '#94A3B8'], ['tarifas', 'Tarifas do ML', ['tarifa_venda', 'cobranca_mp', 'parcelamento', 'recebimento', 'full', 'minha_pagina', 'impostos_ml', 'outro'], '#EF4444'],
        ['frete', 'Frete', ['frete'], '#F59E0B'], ['devolucao', 'Frete de devoluções', ['devolucao'], '#FDBA74'], ['ads', 'Ads', ['ads', 'ads_seguidores'], '#8B5CF6'], ['liquido', 'Sobrou (líquido do ML)', ['liquido'], '#10B981']];
    F.ondeFoi = function (casc) {
        const por = {}; ((casc && casc.linhas) || []).forEach(l => { por[l.id] = l; });
        const bruto = casc && casc.bruto;
        if (!(bruto > 0) || casc.liquido === null || casc.liquido === undefined) return null;
        const v = id => { const l = por[id]; return !l || l.valor === null || l.parcial ? null : (l.liq !== undefined && l.liq !== null ? l.liq : l.valor); };
        const partes = [];
        for (const [id, rotulo, ids, cor] of F.PARTES_DINHEIRO) {
            const vs = ids.map(v);
            if (vs.some(x => x === null)) return null;
            const valor = r2(vs.reduce((s, x) => s + x, 0));
            partes.push({ id, rotulo, valor, pct: valor / bruto * 100, cor });
        }
        return { partes, bruto };
    };
    F.htmlOndeFoi = function (casc, nomeMes) {
        const o = F.ondeFoi(casc);
        if (!o) return '';
        const vis = o.partes.filter(p => p.valor > 0);
        return `<div class="od" role="img" aria-label="${esc('Para onde foi o dinheiro de ' + nomeMes)}">${vis.map(p => `<i style="width:${Math.max(0.8, p.pct).toFixed(2)}%;background:${p.cor}" title="${esc(p.rotulo + ': ' + SHC.moeda(p.valor))}"></i>`).join('')}</div>`
            + `<ul class="od-l">${o.partes.map(p => `<li${p.id === 'liquido' ? ' class="liq"' : ''}><span class="cf-lg" style="background:${p.cor}"></span><span class="od-r">${esc(p.rotulo)}</span><b>${esc(SHC.moeda(p.valor))}</b><small>${esc(SHC.pctTxt(p.pct))}</small></li>`).join('')}</ul>`
            + `<p class="cf-sub">De cada R$ 100 vendidos em ${esc(nomeMes)}, sobraram ${esc(SHC.moeda(o.partes[o.partes.length - 1].pct))} depois do ML.</p>`;
    };
    /** A fatura fechada mais recente com categorias: a conferência com o Copiloto e a comparação com a fatura anterior (vendas dos meses do Copiloto). */
    F.dadosConf = function (fat, fechs, vbRaw, hoje) {
        const conf = F.conferirFaturas(fat, fechs, 1)[0] || null;
        if (!conf) return { conf: null, vs: null };
        const vend = m => { const x = F.vendasBrutas((fechs || {})[m] || null, vbRaw, m, hoje); return x && x.completo ? x.valor : null; };
        const mAnt = F.mesAntes(conf.mesFat, 1), catAnt = ((fat && fat.categorias) || {})[mAnt];
        const vs = F.faturaVsAnterior(fat, conf.mesFat, { agora: vend(conf.mes), antes: catAnt ? vend(F.mesDaFatura(mAnt, catAnt.fechamento)) : null });
        return { conf, vs };
    };
    F.htmlConfFaturas = function (fat, fechs, vbRaw, hoje) {
        const d = F.dadosConf(fat, fechs, vbRaw, hoje);
        return (d.conf ? `<section class="card" id="f-confere"><h2>Confere com a fatura do ML</h2>${F.htmlConfere(d.conf)}</section>` : '')
            + (d.vs ? `<section class="card" id="f-faturavs"><h2>${esc(d.vs.nome)} × ${esc(d.vs.nomeAnt)}: por que mudou</h2>${F.htmlFaturaVs(d.vs)}</section>` : '');
    };
    F.porCss = doc => { if (doc && doc.head && !doc.getElementById('cf-css')) { const s = doc.createElement('style'); s.id = 'cf-css'; s.textContent = F.CSS_CONF; doc.head.appendChild(s); } };
    /** CSS dos cartões acima (o painel lateral e a página do fechamento usam o mesmo desenho). */
    F.CSS_CONF = '.cf-sub{margin:4px 0 8px;font-size:11.5px;color:#64748B}.cf-l{padding:7px 0;border-top:1px solid #F1F5F9}.cf-l:first-of-type{border-top:0}'
        + '.cf-t{display:flex;align-items:center;gap:6px;font-size:12.5px}.cf-t b{flex:1;min-width:0;font-weight:650}.cf-v{font-weight:750;font-variant-numeric:tabular-nums;white-space:nowrap}'
        + '.cf-i{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:99px;font-size:11px;font-weight:800;flex:none}.cf-l.ok .cf-i{background:#ECFDF5;color:#047857}.cf-l.x .cf-i{background:#FFFBEB;color:#B45309}.cf-l.ok .cf-v{color:#047857}.cf-l.x .cf-v{color:#B45309}'
        + '.cf-b{height:6px;border-radius:99px;background:#F1F5F9;margin-top:3px;overflow:hidden}.cf-b i{display:block;height:100%;border-radius:99px}'
        + '.cf-b i.ml{background:#3483FA}.cf-b i.cp{background:#0F172A}.cf-b i.an{background:#CBD5E1}.cf-b i.pr{background:#EF4444}.cf-b i.ok{background:#10B981}.cf-b i.cz,.cf-b i.an2{background:#64748B}'
        + '.cf-n{display:block;font-size:11px;color:#64748B;margin-top:3px;font-variant-numeric:tabular-nums}.cf-m{display:block;font-size:11.5px;color:#92400E;margin-top:3px}'
        + '.cf-l.tot{border-top:2px solid #E2E8F0;margin-top:2px}.cf-l.tot .cf-t b{font-weight:800}'
        + '.cf-lg{display:inline-block;width:10px;height:10px;border-radius:3px;margin:0 3px 0 6px;vertical-align:-1px}.cf-lg.ml{background:#3483FA}.cf-lg.cp{background:#0F172A}.cf-lg.an{background:#CBD5E1}.cf-lg.pr{background:#EF4444}'
        + '.od{display:flex;height:22px;border-radius:8px;overflow:hidden;margin:6px 0 8px;background:#F1F5F9}.od i{display:block;height:100%}'
        + '.od-l{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr;gap:3px}.od-l li{display:flex;align-items:center;gap:6px;font-size:12px}.od-l .cf-lg{margin:0}.od-l .od-r{flex:1;min-width:0}'
        + '.od-l b{font-variant-numeric:tabular-nums;white-space:nowrap}.od-l small{width:44px;text-align:right;color:#64748B;font-variant-numeric:tabular-nums}.od-l li.liq{font-weight:800;border-top:1px solid #E2E8F0;padding-top:4px;margin-top:2px}';

    /** Aviso "Vendas brutas de agosto de 2026 ainda não lidas por inteiro" + botão "Tentar agora" (data-vb-mes) + o motivo da última tentativa. */
    F.htmlVbFalta = function (mes, st, lendo) {
        const d = ((((st || {}).etapas || {}).vendasBrutas || {}).meses || {})[mes], motivo = SHC.textosMeses({ [mes]: d })[0];
        return `<p class="aviso">Vendas brutas de ${esc(F.nomeMes(mes))} ainda não lidas por inteiro. Sem o mês inteiro, a cascata não usa esse valor.`
            + ` <button class="bt pq" data-vb-mes="${esc(mes)}"${lendo ? ' disabled' : ''}>${lendo ? 'Lendo…' : 'Tentar agora'}</button>`
            + (motivo ? `<br><small>Última tentativa: ${esc(motivo)}</small>` : '') + '</p>';
    };
    /** Resposta de {acao:'vendas_brutas_mes'} → frase para o seller. */
    // v2.5.3: diz o valor lido ("Agosto de 2026 lido: R$ 170.639,70 em vendas brutas (31 dias).") e, na falha, o motivo e o que fazer.
    // r null = a página não recebeu resposta do Copiloto (fundo reiniciado no meio / extensão recarregada).
    F.fraseVbMes = function (r, mes) {
        const nome = F.nomeMes(mes), Nome = nome.charAt(0).toUpperCase() + nome.slice(1);
        if (r && r.ok) return Nome + ' lido' + (SHC.num(r.valor) !== null ? ': ' + SHC.moeda(r.valor) + ' em vendas brutas' : '') + (r.dias ? ' (' + r.dias + ' dias)' : '') + '.';
        if (!r) return 'O Copiloto não respondeu. Recarregue esta página e clique em "Tentar agora" de novo.';
        if (r.motivo === 'tempo') return 'O Mercado Livre está demorando para responder sobre ' + nome + '. Tente de novo em alguns minutos.';
        if (r.motivo === 'outra_conta') return 'O Mercado Livre aberto neste Chrome é de outra conta. Clique em Sincronizar agora para trocar de conta.';
        if (r.motivo === 'mes') return 'O Copiloto lê só os últimos 13 meses: ' + nome + ' está fora deles.';
        if (r.motivo === 'login' || r.diag === 'login') return 'Entre no Mercado Livre neste Chrome e clique em "Tentar agora" de novo.';
        if (r.diag === 'formato mudou') return 'O Mercado Livre mandou as vendas de ' + nome + ' de um jeito que o Copiloto não reconheceu. Tente de novo mais tarde.';
        if (r.diag === 'vazio') return 'O Mercado Livre não mostrou nenhum dia de ' + nome + '. Tente de novo mais tarde.';
        return 'O Mercado Livre não respondeu agora. Tente de novo em alguns minutos.';
    };
    /** "Lendo as vendas brutas de agosto de 2026…" enquanto o "Tentar agora" espera. */
    F.fraseVbLendo = mes => 'Lendo as vendas brutas de ' + F.nomeMes(mes) + '…';
    /** Mensagem ao fundo com limite de tempo: nunca fica "Lendo…" para sempre. → a resposta | null (sem resposta) | {ok:false, motivo:'tempo'} */
    F.pedirAoFundo = function (msg, ms, enviar) {
        const env = enviar || (m => chrome.runtime.sendMessage(m));
        return Promise.race([Promise.resolve().then(() => env(msg)).then(r => (r === undefined ? null : r), () => null),
            new Promise(res => setTimeout(() => res({ ok: false, motivo: 'tempo' }), ms))]);
    };

    // Aula guiada (tour.js). Alvo que não está na tela (ex.: sem faturas) é pulado.
    F.AULA = [
        { sel: '#mes', titulo: 'Escolha o mês', texto: 'Troque o mês aqui. A comparação é sempre com o mês anterior.' },
        { sel: '#f-cascata', titulo: 'Da venda ao lucro', texto: 'Das vendas brutas até o lucro: cada cobrança do ML em R$ e em % das vendas. "—" quer dizer que ainda não foi lido.' },
        { sel: '#f-gargalo', titulo: 'Maior gargalo', texto: 'A cobrança do ML que mais pesa no mês e o que fazer para baixar.' },
        { sel: '#f-repasse', titulo: 'Repasse do Mercado Pago', texto: 'O que entrou de verdade no Mercado Pago, comparado com o líquido estimado.' },
        { sel: '#f-conferir', titulo: 'Cobranças para conferir', texto: 'Cobranças fora do normal. O botão copia um texto pronto para você abrir o chamado no ML.' },
        { sel: '#f-faturas', titulo: 'Faturas e notas', texto: 'As faturas do ML, com fechamento, vencimento e situação. Logo abaixo, as notas fiscais de cada fatura, com o botão para baixar.' },
    ];

    // ── Na página (navegador) ──
    const espera = ms => new Promise(r => setTimeout(r, ms));
    const ehLogin = u => /login|registration|\/lgz\//i.test(u || '');
    async function buscar(url, json) {
        const r = await SHC.buscarVendo(url, { credentials: 'include', cache: 'no-store', headers: json ? { accept: 'application/json' } : {},
            signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(60000) : undefined });   // página do Faturamento: até ~30 s
        if (ehLogin(r.url)) return { login: true };
        if (!r.ok) return null;
        return json ? { json: await r.json() } : { html: await r.text() };
    }
    // v2.5.1: Faturamento de cada mês de `meses` (o escolhido primeiro), um mês por vez, com as páginas 3 de cada vez (SHC.paginasEmParalelo:
    // mesmo endereço e paginação do fundo; page começa em 1). O mês vai até o dia 1º do seguinte: o Ads do último dia é cobrado nele.
    // buscarJson(url) → Promise<{json} | {login} | null>. → { cobs, falhou: null | 'login' | 'ml' (mês que não respondeu: os anteriores ficam),
    //   cortados: meses que bateram no máximo de páginas (lidos pela metade: não valem como lidos) }. Vazio depois de > 15 s = 'ml'.
    // aviso(texto): "Lendo agosto (1 de 2 meses) · 6.722 cobranças · falta cerca de 1 min".
    // v2.5.3: período que falhou (o ML desistiu ou não respondeu) é lido em 2 metades e, se ainda falhar, em pedaços de 7 dias — como o fundo
    // (lerDividindo). Só não respondeu nem assim → o mês falha (os meses anteriores ficam). Login nunca é dividido.
    F.lerCobrancasMeses = async function (meses, hoje, aviso, buscarJson) {
        const cobs = [], vistos = new Set(), inicio = Date.now(), cortados = [];
        let feito = 0, noMes = 0;
        const diz = m => aviso(SHC.textoLendoMes({ mes: m, feito, de: meses.length, cobrancas: cobs.length + noMes, restanteSeg: SHC.estimaMeses(inicio, feito, meses.length, Date.now()) }));
        const dia = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
        const lerPeriodo = (m, de, ate) => SHC.paginasEmParalelo(async p => {
            const t0 = Date.now(), b = await Promise.resolve(buscarJson(BASE + '/billing/cnc/api/charges-summary/charges-summary-provider/bricks?siteId=MLB&platformId=ML&isBackoffice=false&searchText=&searchLimit=500'
                + '&idDate=custom&fromDateCustom=' + de + 'T00:00:00.000Z&toDateCustom=' + ate + 'T23:59:59.999Z&page=' + p)).catch(() => null);
            if (!b || b.login) return { falha: b && b.login ? 'login' : 'ml' };
            const lidas = SHC.mlCobrancasDaResposta(b.json);
            if (!lidas.reconhecida) return { falha: 'ml' };
            if (!lidas.brutas && Date.now() - t0 > SHC.COB_SUSPEITA_MS) return { falha: 'ml' };   // o ML desistiu: nunca vira "fim do mês"
            noMes += lidas.length; diz(m);
            await espera(F.PAUSA_MS);
            return lidas;
        }, { limite: 500, max: 20, paralelo: 3 });
        const dividindo = async (m, de, ate, nivel) => {
            const r = await lerPeriodo(m, de, ate);
            if (!r.falha || r.falha === 'login' || nivel >= 2) return r;
            const dias = Math.round((Date.parse(ate + 'T12:00:00Z') - Date.parse(de + 'T12:00:00Z')) / 864e5) + 1, passo = nivel ? 7 : Math.ceil(dias / 2);
            const junto = { linhas: [], cortado: false };
            for (let i = 0; i < dias; i += passo) {
                const x = await dividindo(m, dia(de, i), dia(de, Math.min(dias, i + passo) - 1), nivel + 1);
                if (x.falha) return x;
                junto.linhas.push(...x.linhas); junto.cortado = junto.cortado || !!x.cortado;
            }
            return junto;
        };
        for (const m of meses) {
            const prox = F.mesAntes(m, -1) + '-01', de = m + '-01', ate = prox < hoje ? prox : hoje;
            noMes = 0; diz(m);
            const r = await dividindo(m, de, ate, 0);
            if (r.falha) return { cobs, falhou: r.falha, cortados };
            if (r.cortado) cortados.push(m);   // bateu no máximo de páginas: o mês ficou pela metade
            r.linhas.forEach(c => { if (!c.id || !vistos.has(c.id)) { if (c.id) vistos.add(c.id); cobs.push(c); } });
            feito++;
        }
        return { cobs, falhou: null, cortados };
    };
    F.PAUSA_MS = 700;
    // A Atividade do Mercado Pago é lida pelo fundo ('sincronizar_repasse': página só com compras não para a leitura,
    // página repetida para, grava 'desde' e o status). Aqui só a resposta vira frase.
    F.fraseRepasse = function (r) {
        if (r && r.ok) return 'Mercado Pago lido (' + SHC.qtd(r.paginas, 'página', 'páginas') + ').';
        if (r && r.motivo === 'outra_conta') return 'O Mercado Livre aberto neste Chrome é de outra conta. Clique em Sincronizar agora para trocar de conta.';
        if (r && r.motivo === 'sincronizando') return 'Uma sincronização já está rodando e também lê o Mercado Pago. Espere terminar.';
        if (r && r.semPermissao) return 'Sem a permissão, o Copiloto não lê o Mercado Pago. O líquido estimado continua valendo.';
        if (r && r.falha === 'login') return 'Não achei a sua Atividade. Entre no Mercado Pago (mercadopago.com.br) neste Chrome e tente de novo.';
        return 'O Mercado Pago não respondeu. Tente de novo em alguns minutos.';
    };

    function iniciar() {
        try { SHC.salvarGuia({ feitos: { fechamento: SHC.hoje() } }).catch(() => {}); } catch (e) { /* guia: página aberta */ }
        const app = document.getElementById('app');
        const hoje = SHC.hoje();
        F.porCss(document);
        let rec = null, mes = F.mesAntes(hoje.slice(0, 7), 1), dados = null, lidas = null, conferencia = [], msg = '', lendoMP = false, conferindo = false, lendoVb = false, querAula = location.hash === '#aula', visao = 'mes';
        const aula = () => { if (root.SHCTour) root.SHCTour.iniciar(F.AULA); };
        const btAula = document.getElementById('verAula');
        if (btAula) btAula.addEventListener('click', aula);
        if (querAula) history.replaceState(null, '', location.pathname);
        // O andamento fica em msg: o redesenho (status a cada ~1 s) não apaga.
        const aviso = t => { msg = t; const el = document.getElementById('aviso'); if (el) el.textContent = t; };

        async function carregar() {
            const conta = await SHC.contaAtual();
            const tudo = await chrome.storage.local.get(null);
            const itens = ((tudo['ml:anuncios:' + conta] || {}).itens) || [];
            const vm = {};
            Object.keys(tudo).forEach(k => { if (k.indexOf('vm|ml|') === 0) vm[k.slice(6)] = tudo[k]; });
            const temMP = chrome.permissions ? await chrome.permissions.contains({ origins: [MP + '/*'] }).catch(() => false) : false;
            dados = { conta, tudo, itens, vm, cfg: Object.assign({}, SHC.PADRAO, tudo.cfg || {}), vb: tudo['vb:' + conta] || null,
                fat: tudo['fat:' + conta] || null, afil: tudo['afil:' + conta] || null, rep: tudo['mp:repasse:' + conta] || null, st: tudo['shc:status'] || {}, temMP };
        }
        function doMes(m) {
            const d = dados, fechGuardado = d.tudo[SHC.chaveFech(d.conta, m)] || null;
            const fech = fechGuardado || (lidas && lidas[m]) || null;
            const vb = F.vendasBrutas(fech, d.vb, m, hoje);
            const produtos = F.custoProdutos(d.itens, d.vm, d.tudo, m, fech ? fech.qtdVendas : null);
            const impostoPct = d.cfg.configurado ? SHC.num(d.cfg.imposto_pct) : null;
            const afil = d.afil && d.afil.temAfiliados ? d.afil.metricas : null;
            return { m, fech, fechGuardado, vb, produtos, impostoPct, casc: F.cascata({ fech, vb, produtos, impostoPct, afil, mes: m }) };
        }
        function desenha(soSync) {
            const d = dados, a = doMes(mes), b = doMes(F.mesAntes(mes, 1));
            const fechs = {}; for (let i = 0; i < 14; i++) { const m = F.mesAntes(hoje.slice(0, 7), i); fechs[m] = d.tudo[SHC.chaveFech(d.conta, m)] || (lidas && lidas[m]) || null; }
            // Quanto dá para recuperar: frete a mais (frete:<conta>:hist), cobranças para conferir (as lidas agora ou as da sincronização) e o Full.
            const fh = d.tudo['frete:' + d.conta + ':hist'], cfG = d.tudo['conferir:' + d.conta], rem = d.tudo['ml:full:remessas:' + d.conta];
            const conc = fh && fh.vendasLidas !== false ? fh.conciliacao || null : null;
            rec = F.recuperar({ conc, conferir: lidas ? conferencia : ((cfG && cfG.itens) || []), inconformes: rem ? SHC.remessasInconformes(rem, d.tudo['remessas:' + d.conta + ':detalhe'], hoje) : [] });
            const porId = {}; d.itens.forEach(i => { porId[i.itemId] = i; });
            (soSync ? h => SHC.trocarSoSync(app, h) : h => { app.innerHTML = h; })(F.htmlPagina({ a, b, mes, hoje, msg, lidas, conferencia, st: d.st, agora: Date.now(), temMP: d.temMP, rep: d.rep, fat: d.fat, vb: d.vb, fechs, visao, lendoMP, conferindo, lendoVb,
                rec, recLido: !!(conc || cfG || lidas || rem), tituloDe: id => (porId[id] || {}).titulo || '' }));
        }
        async function redesenha() { try { await carregar(); desenha(); if (querAula) { querAula = false; aula(); } } catch (e) { app.innerHTML = '<section class="card"><p class="msg erro">Não deu para montar a página: ' + esc((e && e.message) || e) + '</p></section>'; } }

        app.addEventListener('change', ev => { if (ev.target.id === 'mes') { mes = ev.target.value; desenha(); } });
        app.addEventListener('click', async ev => {
            const bt = ev.target.closest('button');
            if (!bt) return;
            if (bt.hasAttribute('data-visao')) { visao = bt.getAttribute('data-visao') === 'ciclo' ? 'ciclo' : 'mes'; return desenha(); }
            if (bt.hasAttribute('data-mp')) {
                // O pedido de permissão tem de sair direto do clique (sem await antes).
                const pedido = chrome.permissions.request({ origins: [MP + '/*'] });
                bt.disabled = true;
                try {
                    if (!(await pedido)) { msg = F.fraseRepasse({ semPermissao: true }); return desenha(); }
                    dados.temMP = true; lendoMP = true; msg = ''; desenha();
                    msg = F.fraseRepasse(await chrome.runtime.sendMessage({ acao: 'sincronizar_repasse' }));
                } catch (e) { msg = F.fraseRepasse(null); }
                lendoMP = false;
                return redesenha();
            }
            if (bt.hasAttribute('data-conferir')) {
                if (conferindo) return;
                conferindo = true; bt.disabled = true;
                try {
                    // O mês escolhido primeiro e o anterior (comparação). Mês que não respondeu: o que já veio fica.
                    const meses = [mes, F.mesAntes(mes, 1)], r = await F.lerCobrancasMeses(meses, hoje, aviso, u => buscar(u, true));
                    if (r.falhou && !r.cobs.length) throw new Error(r.falhou);
                    lidas = F.fechDasCobrancas(r.cobs, meses[1]);
                    Object.keys(lidas).forEach(m => { if (m > mes) delete lidas[m]; });   // o dia 1º do mês seguinte só entra pelo Ads
                    if (r.falhou) delete lidas[meses[1]];   // o anterior não veio inteiro: não vale como lido
                    r.cortados.forEach(m => { delete lidas[m]; });   // mês pela metade: não vale como lido
                    const porId = {}; dados.itens.forEach(i => { porId[i.itemId] = i; });
                    conferencia = F.conferir(r.cobs, porId);
                    msg = SHC.qtd(r.cobs.length, 'cobrança lida', 'cobranças lidas') + '. ' + (conferencia.length ? conferencia.length + ' para conferir.' : 'Nada fora do normal.')
                        + (r.falhou ? ' ' + F.nomeMes(meses[1]) + ' não respondeu: tente de novo em alguns minutos.' : '')
                        + r.cortados.map(m => ' ' + F.nomeMes(m) + ': lido só em parte, o mês tem cobranças demais.').join('');
                } catch (e) {
                    msg = e && e.message === 'login' ? 'Entre no Mercado Livre neste Chrome e tente de novo.' : 'O Faturamento do ML não respondeu. Tente de novo em alguns minutos.';
                }
                conferindo = false;
                return desenha();
            }
            if (bt.hasAttribute('data-vb-mes')) {
                const m = bt.getAttribute('data-vb-mes');
                if (lendoVb) return;
                // v2.5.3: nunca espera a sincronização (o fundo lê o mês agora, em paralelo) e sempre diz o que está acontecendo.
                lendoVb = true; msg = F.fraseVbLendo(m); desenha();
                const r = await F.pedirAoFundo({ acao: 'vendas_brutas_mes', mes: m }, 90000);
                lendoVb = false; msg = F.fraseVbMes(r, m);
                return redesenha();
            }
            if (bt.hasAttribute('data-copiar-rec')) {
                const [pid, i] = bt.getAttribute('data-copiar-rec').split(':'), p = rec && rec.parcelas.find(x => x.id === pid), x = p && p.itens[+i];
                if (!x) return;
                const tit = ((dados.itens.find(it => it.itemId === x.itemId)) || {}).titulo;
                try { await navigator.clipboard.writeText(pid === 'frete' ? F.chamadoFrete(x, tit) : F.textoChamado(x)); bt.textContent = 'Copiado'; }
                catch (e) { bt.textContent = 'Não copiou: selecione e copie à mão'; }
                return;
            }
            if (bt.hasAttribute('data-copiar')) {
                const x = conferencia[+bt.getAttribute('data-copiar')];
                try { await navigator.clipboard.writeText(F.textoChamado(x)); bt.textContent = 'Copiado'; }
                catch (e) { bt.textContent = 'Não copiou: selecione e copie à mão'; }
                return;
            }
            if (bt.hasAttribute('data-sync')) { bt.disabled = true; bt.textContent = 'Sincronizando…'; chrome.runtime.sendMessage({ acao: 'sincronizar' }).catch(() => {}).then(redesenha); }
        });
        // v2.5.3: durante a sincronização o andamento redesenha os botões a cada ~1 s; um clique no meio (apertou no botão velho, soltou no novo)
        // se perdia. Com o dedo/mouse apertado, o redesenho espera.
        let apertando = false;
        app.addEventListener('pointerdown', () => { apertando = true; });
        document.addEventListener('pointerup', () => { setTimeout(() => { apertando = false; }, 0); });
        document.addEventListener('pointercancel', () => { apertando = false; });
        let pendente = null, soStatus = true;
        chrome.storage.onChanged.addListener((mud, area) => {
            if (area !== 'local' || !Object.keys(mud).some(k => /^(fech:|vb:|fat:|afil:|mp:repasse:|shc:status|cfg|ml:conta|ml:anuncios:|vm\|ml\||c\||frete:|conferir:|ml:full:remessas:|remessas:)/.test(k))) return;
            if (Object.keys(mud).some(k => k !== 'shc:status')) soStatus = false;
            clearTimeout(pendente);
            pendente = setTimeout(async function vez() {
                if (apertando) { pendente = setTimeout(vez, 300); return; }
                const leve = soStatus && dados; soStatus = true;
                if (!leve) return redesenha();
                // Só o andamento mudou: relê o status, sem reler o armazenamento inteiro (não redesenha com o seletor de mês aberto).
                try { dados.st = (await chrome.storage.local.get('shc:status'))['shc:status'] || {}; if (document.activeElement && document.activeElement.id === 'mes') return; desenha(true); } catch (e) { redesenha(); }
            }, 400);
        });
        redesenha();
    }

    if (typeof module !== 'undefined' && module.exports) module.exports = F;
    // O painel lateral também carrega este arquivo (só as contas SHC.fech.*): a página só monta onde existe o #app do fechamento.html.
    else if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () => { if (document.getElementById('app')) iniciar(); });
})(typeof globalThis !== 'undefined' ? globalThis : this);
