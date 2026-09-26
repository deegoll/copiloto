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

    /** Cobranças cruas → meses como 'fech:' + estornosPorTipo (≤ 0), para a cascata mostrar cada tipo antes do estorno. */
    F.fechDasCobrancas = function (cobs, desde) {
        const out = SHC.fechamentoDasCobrancas(cobs, desde);
        (cobs || []).forEach(c => {
            const f = c && c.estorno && out[String(c.dataRef || c.data || '').slice(0, 7)];
            if (!f || !(c.valor >= 0)) return;
            const e = f.estornosPorTipo || (f.estornosPorTipo = {}), t = SHC.tipoCustoFechamento(c.texto);
            e[t] = r2((e[t] || 0) - c.valor);
        });
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
        ['ads', 'Ads (Product Ads)', 'Anúncios patrocinados no Mercado Ads'],
        ['ads_seguidores', 'Ads de Seguidores', 'Publicidade de Seguidores'],
        ['outro', 'Outras tarifas', 'Ex.: manutenção da Minha página'],
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
        outro: 'Abra o Faturamento e veja o que é (ex.: tarifa da Minha página).',
    };
    F.ACOES = ACOES;
    /**
     * Maior gargalo: o custo do ML com maior % das vendas (ou maior R$ sem vendas brutas) e o que mais subiu contra o mês anterior.
     * → { maior:{id, rotulo, valor, pct, frase, acao} | null, subiu:{id, rotulo, antes, agora, frase, acao} | null }
     */
    F.gargalo = function (atual, anterior) {
        const custos = c => ((c && c.linhas) || []).filter(l => l.tipo === 'menos' && ACOES[l.id] && l.valor !== null);
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
        (cobs || []).forEach(c => { if (c && c.orderId && c.valor >= 0) (ped[c.orderId] || (ped[c.orderId] = [])).push(c); });
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
        const pt = fech.porTipo || {}, ept = fech.estornosPorTipo || {}, po = fech.porOrigem || null;
        return TIPOS.map(([id, rotulo]) => {
            const total = r2((SHC.num(pt[id]) || 0) - (SHC.num(ept[id]) || 0)), o = po && po[id];
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
        let mes = F.mesAntes(hoje.slice(0, 7), 1), dados = null, lidas = null, conferencia = [], msg = '', lendoMP = false, conferindo = false, lendoVb = false, querAula = location.hash === '#aula', visao = 'mes';
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
            (soSync ? h => SHC.trocarSoSync(app, h) : h => { app.innerHTML = h; })(F.htmlPagina({ a, b, mes, hoje, msg, lidas, conferencia, st: d.st, agora: Date.now(), temMP: d.temMP, rep: d.rep, fat: d.fat, vb: d.vb, fechs, visao, lendoMP, conferindo, lendoVb }));
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
            if (area !== 'local' || !Object.keys(mud).some(k => /^(fech:|vb:|fat:|afil:|mp:repasse:|shc:status|cfg|ml:conta|ml:anuncios:|vm\|ml\||c\|)/.test(k))) return;
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
