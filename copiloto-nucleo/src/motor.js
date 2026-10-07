// copiloto-nucleo · motor de lucro (por pedido, por produto e fechamento do mês). A conta é determinística; a IA só explica.
//   receita         = Σ(preço × qtd) − desconto do vendedor            (o cupom da plataforma não entra: quem paga é o canal)
//   receita_liquida = receita − reembolso                              (devolução)
//   repasse         = receita_liquida − Σ tarifas do pedido            (estorno entra com sinal −; 'ads' não entra aqui, SALVO o Ads que o
//                     − Ads tirado do repasse                           canal tirou do repasse da venda: tarifa 'ads' com origem_pagamento 'venda')
//   lucro_antes_ads = repasse (+ Ads tirado do repasse) − custo × qtd − receita_liquida × imposto% − outros
//   lucro_real      = lucro_antes_ads − ads rateado (por anúncio e dia)
//   margem          = lucro_real / receita_liquida
// Leitura que falhou nunca vira zero: o resultado sai com status 'nao_lido' (ou 'sem_custo') e os números que dependem dela em null.
(function (root, fabrica) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = fabrica(require('./util'), require('./modelo'), require('./tarifas'));
    else { const CN = root.CopilotoNucleo = root.CopilotoNucleo || {}; CN.motor = fabrica(CN.util, CN.modelo, CN.tarifas); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (U, M, T) {
    'use strict';

    const chaveItem = it => (it && (it.sku || it.anuncio_id)) || '';
    /** Valor da linha: o total que o canal deu, senão preço × qtd. null = não lido. */
    const valorItem = it => (it.total !== null && it.total !== undefined ? it.total : (it.preco_unit === null || it.preco_unit === undefined ? null : U.r2(it.preco_unit * it.qtd)));

    /**
     * Divide um valor (R$) pelos pesos, pelo MAIOR RESTO: a soma das partes = o valor, no centavo; cada parte a menos de 1 centavo da
     * exata (valor × peso ÷ Σ pesos) e nenhuma com o sinal trocado (R$ 0,05 em 10 partes iguais = 5 × 0,01 + 5 × 0,00, nunca −0,04 no último).
     * Peso ≤ 0 ou inválido vale 0; todos 0 → partes iguais. Empate de resto: a ordem da lista. valor null → partes null (não lido).
     */
    function reparte(valor, pesos) {
        const n = (pesos || []).length, v = U.r2(valor);
        if (v === null) return Array.from({ length: n }, () => null);
        let ws = (pesos || []).map(p => (typeof p === 'number' && isFinite(p) && p > 0 ? p : 0)), W = ws.reduce((a, b) => a + b, 0);
        if (!(W > 0)) { ws = ws.map(() => 1); W = n; }
        const C = Math.round(Math.abs(v) * 100), sinal = v < 0 ? -1 : 1;   // centavos inteiros
        const exatas = ws.map(w => C * w / W), cs = exatas.map(e => Math.floor(e + 1e-9));
        let falta = C - cs.reduce((a, b) => a + b, 0);
        exatas.map((e, i) => ({ i, resto: e - cs[i] })).sort((a, b) => b.resto - a.resto || a.i - b.i).forEach(x => { if (falta > 0) { cs[x.i]++; falta--; } });
        return cs.map(c => (c === 0 ? 0 : sinal * c / 100));
    }

    /**
     * Custo unitário de um SKU num dia, com vigência e kit (componentes somados, até 5 níveis).
     * custos = CustoSKU[] (chave = sku; para anúncio sem SKU o Copiloto guarda pelo id do anúncio).
     * → { custo, outros, fonte, kit } | null (sem custo informado).
     */
    function custoUnitario(custos, sku, data, nivel) {
        if (!sku || (nivel || 0) > 5) return null;
        const d = U.dia(data) || '9999-12-31';
        const cands = (custos || []).filter(c => c && c.sku === sku && (!c.vigencia_de || c.vigencia_de <= d))
            .sort((a, b) => String(b.vigencia_de || '').localeCompare(String(a.vigencia_de || '')));
        const c = cands[0];
        if (!c) return null;
        if (c.componentes && c.componentes.length) {
            let custo = 0, outros = U.num(c.outros) || 0;
            for (const comp of c.componentes) {
                const x = custoUnitario(custos, comp.sku, d, (nivel || 0) + 1);
                if (!x) return null;   // componente sem custo = kit sem custo (nunca soma parcial)
                custo += x.custo * comp.qtd; outros += x.outros * comp.qtd;
            }
            return { custo: U.r2(custo), outros: U.r2(outros), fonte: c.fonte || 'manual', kit: true };
        }
        const v = U.num(c.custo);
        return v !== null && v > 0 ? { custo: v, outros: U.num(c.outros) || 0, fonte: c.fonte || 'manual', kit: false } : null;
    }

    /** Alíquota (%) do seller para o pedido: ctx.imposto_pct fixo, ou a linha de Imposto mais recente em vigor (conta/canal). */
    function aliquota(ctx, pedido) {
        const fixo = U.num(ctx && ctx.imposto_pct);
        if (fixo !== null) return { pct: fixo, configurado: true };
        const d = pedido.data_venda;
        const cand = ((ctx && ctx.impostos) || []).filter(i => i && (!i.conta || i.conta === pedido.conta) && (!i.canal || i.canal === pedido.canal) && (!i.vigencia_de || i.vigencia_de <= d))
            .sort((a, b) => (Number(!!b.conta) + Number(!!b.canal)) - (Number(!!a.conta) + Number(!!a.canal)) || String(b.vigencia_de || '').localeCompare(String(a.vigencia_de || '')));
        return cand.length ? { pct: U.num(cand[0].aliquota_pct) || 0, configurado: true } : { pct: 0, configurado: false };
    }

    /**
     * Lucro de 1 pedido.
     * ctx = {
     *   tarifas: Tarifa[] do canal (as do pedido são filtradas por pedido_id) | naoLido | undefined (= não lido),
     *   custos: CustoSKU[], imposto_pct | impostos: Imposto[], outros: R$ extra do pedido (embalagem etc.),
     *   ads: número ou {total, porAnuncio} (de rateioAds) | naoLido | undefined (= canal não informa → 0),
     *   devolucoes: Devolucao[], estimar_tarifas: true → sem tarifa lida, estima pela tabela do canal (marcado 'estimada'),
     *   contexto_tarifa: {tipo_anuncio, frete_gratis_programa, ...} (para a estimativa), margem_alvo_pct, tabela
     * }
     */
    function lucroPedido(pedido, ctx) {
        ctx = ctx || {};
        const avisos = [], faltando = [];
        const base = { pedido_id: pedido && pedido.id, canal: pedido && pedido.canal, conta: pedido && pedido.conta, data: pedido && pedido.data_venda };
        if (M.ehNaoLido(pedido)) return Object.assign(base, { status: 'nao_lido', faltando: ['pedido'], motivo: pedido.motivo, avisos });
        const erros = M.validar('pedido', pedido);
        if (erros.length) return Object.assign(base, { status: 'nao_lido', faltando: ['pedido'], motivo: 'pedido inválido: ' + erros.join('; '), avisos });
        const cancelado = pedido.status === 'cancelado';

        // ── Receita ──
        if (pedido.itens.some(it => valorItem(it) === null)) faltando.push('preco');
        const bruto = cancelado ? 0 : U.soma(pedido.itens, it => (valorItem(it) || 0));
        const desconto = cancelado ? 0 : (pedido.desconto_vendedor || 0);
        const receita = U.r2(bruto - desconto);
        const devs = (ctx.devolucoes || []).filter(d => d && d.pedido_id === pedido.id);
        const reembDevs = U.soma(devs, d => d.valor_reembolsado);
        const reembolso = cancelado ? 0 : Math.min(receita, Math.max(pedido.reembolso || 0, reembDevs));
        const receitaLiq = U.r2(receita - reembolso);
        const reembolsoTotal = !cancelado && reembolso > 0 && reembolso >= receita - 0.01;

        // ── Tarifas ──
        let tarifas = null, estimadas = false;
        const lidas = ctx.tarifas;
        if (Array.isArray(lidas)) tarifas = lidas.filter(t => t && t.pedido_id === pedido.id);
        else if (ctx.estimar_tarifas && !faltando.length) {
            tarifas = [];
            pedido.itens.forEach(it => {
                const unit = it.qtd > 0 ? ((valorItem(it) || 0) - desconto * ((valorItem(it) || 0)) / (bruto || 1)) / it.qtd : 0;
                const ls = T.tarifasDoItem(pedido.canal, unit, Object.assign({}, ctx.contexto_tarifa || {}, { qtd: it.qtd }), pedido.data_venda, ctx.tabela);
                if (!ls) { faltando.push('tabela_tarifa'); return; }
                ls.forEach(l => tarifas.push({ tipo: l.tipo, valor: l.valor, pedido_id: pedido.id, anuncio_id: it.anuncio_id, estimada: true, texto_original: 'tabela: ' + l.regra }));
            });
            estimadas = true;
            avisos.push('tarifas estimadas pela tabela do canal (não lidas)');
        } else faltando.push('tarifas');
        if (tarifas && cancelado === false && reembolsoTotal) {
            // Com reembolso total o canal pode não cobrar comissão/fixo (TikTok): vale o que foi LIDO. Estimativa: só o que fica (programa de frete).
            if (estimadas) tarifas = tarifas.filter(t => t.tipo === 'programa_frete');
        }
        // Frete de volta que veio só na Devolucao (sem a tarifa no pedido) entra como frete_devolucao.
        if (tarifas && !tarifas.some(t => t.tipo === 'frete_devolucao')) devs.forEach(d => { if (d.frete_volta > 0) tarifas.push({ tipo: 'frete_devolucao', valor: d.frete_volta, pedido_id: pedido.id, texto_original: 'frete de volta (devolução)' }); });

        const porTipo = {};
        let adsDoPedido = 0, adsNoRepasse = 0;
        (tarifas || []).forEach(t => {
            // 'ads' com origem_pagamento 'venda' (o adaptador diz: veio no extrato/escrow do pedido — GMV Pay do TikTok, ads_escrow da Shopee):
            // o canal pagou a menos por ele → sai do repasse, senão a conciliação acusa "a menor" falso. Sem origem ou 'fatura': fora do repasse.
            if (t.tipo === 'ads') { adsDoPedido = U.r2(adsDoPedido + t.valor); if (t.origem_pagamento === 'venda') adsNoRepasse = U.r2(adsNoRepasse + t.valor); return; }
            porTipo[t.tipo] = U.r2((porTipo[t.tipo] || 0) + t.valor);
            if (t.estimada) estimadas = true;
        });
        const tarifasRs = tarifas ? U.soma(Object.keys(porTipo), k => porTipo[k]) : null;
        const repasse = tarifas && !faltando.length ? U.r2(receitaLiq - tarifasRs - adsNoRepasse) : null;   // falta preço ou tabela = sem repasse

        // ── Custo (SKU e kit) ──
        const semCusto = [], custoPorSku = {};
        let custo = 0, outrosSku = 0;
        const produtoVoltou = devs.map(d => d.produto_voltou).find(v => v === true || v === false);
        const custoZero = cancelado || (reembolsoTotal && produtoVoltou === true);
        if (reembolsoTotal && produtoVoltou === undefined) avisos.push('reembolso total sem saber se o produto voltou: o custo do produto foi contado');
        pedido.itens.forEach(it => {
            const k = chaveItem(it), c = custoUnitario(ctx.custos, k, pedido.data_venda);
            if (!c) { if (!cancelado) semCusto.push(k || '(sem SKU)'); return; }
            const v = custoZero ? 0 : U.r2(c.custo * it.qtd), o = custoZero ? 0 : U.r2(c.outros * it.qtd);
            custoPorSku[k] = U.r2((custoPorSku[k] || 0) + v);
            custo += v; outrosSku += o;
        });
        custo = U.r2(custo);

        // ── Imposto, outros, ads ──
        const al = aliquota(ctx, pedido);
        if (!al.configurado) avisos.push('imposto não configurado: contado como 0%');
        const imposto = U.r2(receitaLiq * al.pct / 100);
        const outros = U.r2(outrosSku + (U.num(ctx.outros) || 0));
        let adsRs = adsDoPedido, adsPorAnuncio = {};
        if (M.ehNaoLido(ctx.ads)) faltando.push('ads');
        else if (typeof ctx.ads === 'number') adsRs = U.r2(adsRs + ctx.ads);
        else if (ctx.ads && typeof ctx.ads === 'object') { adsRs = U.r2(adsRs + (U.num(ctx.ads.total) || 0)); adsPorAnuncio = ctx.ads.porAnuncio || {}; }

        const lucroAntesAds = repasse !== null && !semCusto.length ? U.r2(repasse + adsNoRepasse - custo - imposto - outros) : null;
        const lucroReal = lucroAntesAds !== null && !faltando.includes('ads') ? U.r2(lucroAntesAds - adsRs) : null;
        const margem = lucroReal !== null && receitaLiq > 0 ? Math.round(lucroReal / receitaLiq * 10000) / 100 : null;
        const alvo = U.num(ctx.margem_alvo_pct) || 0;
        const status = faltando.length ? 'nao_lido' : (semCusto.length ? 'sem_custo' : (cancelado ? 'cancelado' : 'ok'));

        // Rateio por item (para o lucro por produto): custo exato; o resto pela participação do item na receita bruta, pelo maior resto
        // (Σ itens = o pedido, no centavo). Ads de um anúncio fica nos itens dele; o Ads do pedido sem anúncio, nos itens sem Ads próprio.
        const its = pedido.itens, nIt = its.length, pesos = its.map(it => (bruto > 0 ? (valorItem(it) || 0) : 1));
        const recI = reparte(receitaLiq, pesos), tarI = reparte(tarifasRs, pesos), outI = reparte(outros, pesos), impI = reparte(imposto, pesos), adsRepI = reparte(adsNoRepasse, pesos);
        const adsI = its.map(() => 0), poeAds = (i, v) => { adsI[i] = U.r2(adsI[i] + v); };
        const anuncios = Object.keys(adsPorAnuncio).filter(a => its.some(it => it.anuncio_id === a));
        anuncios.forEach(a => {
            const ix = its.map((it, i) => (it.anuncio_id === a ? i : -1)).filter(i => i >= 0);
            reparte(U.num(adsPorAnuncio[a]) || 0, ix.map(i => valorItem(its[i]) || 0)).forEach((v, k) => poeAds(ix[k], v));
        });
        const semAnuncio = its.map((it, i) => (anuncios.indexOf(it.anuncio_id) < 0 ? i : -1)).filter(i => i >= 0), alvoAds = semAnuncio.length ? semAnuncio : its.map((it, i) => i);
        reparte(U.r2(adsRs - U.soma(anuncios, a => U.num(adsPorAnuncio[a]) || 0)), alvoAds.map(i => pesos[i])).forEach((v, k) => poeAds(alvoAds[k], v));
        const porItem = its.map((it, i) => {
            const k = chaveItem(it), part = bruto > 0 ? (valorItem(it) || 0) / bruto : 1 / nIt;
            const c = custoUnitario(ctx.custos, k, pedido.data_venda);
            return { sku: k, anuncio_id: it.anuncio_id, qtd: it.qtd, participacao: part, receita: recI[i], tarifas: tarI[i],
                custo: c ? (custoZero ? 0 : U.r2(c.custo * it.qtd)) : null, outros: outI[i], imposto: impI[i], ads: adsI[i], ads_repasse: adsRepI[i] };
        });

        const linhas = [];
        if (!cancelado) {
            linhas.push({ rotulo: 'Venda (preço × qtd)', valor: bruto, de: 'canal' });
            if (desconto) linhas.push({ rotulo: 'Desconto pago por você', valor: -desconto, de: 'canal' });
            if (reembolso) linhas.push({ rotulo: 'Reembolso ao comprador', valor: -reembolso, de: 'canal' });
        }
        Object.keys(porTipo).forEach(k => linhas.push({ rotulo: 'Tarifa: ' + k + (estimadas ? ' (estimada)' : ''), valor: -porTipo[k], de: 'canal' }));
        if (adsNoRepasse) linhas.push({ rotulo: 'Ads pago com o repasse', valor: -adsNoRepasse, de: 'canal' });
        if (repasse !== null) linhas.push({ rotulo: '= Repasse do canal', valor: repasse, de: 'canal', total: true });
        if (custo || semCusto.length) linhas.push({ rotulo: 'Custo do produto', valor: semCusto.length ? null : -custo, de: 'seller' });
        if (outros) linhas.push({ rotulo: 'Outros custos', valor: -outros, de: 'seller' });
        linhas.push({ rotulo: 'Imposto (' + String(al.pct).replace('.', ',') + '%)', valor: -imposto, de: 'seller' });
        // Com Ads tirado do repasse a conta já passou por ele: sem a linha "antes do Ads" (que não seria a soma das de cima); o resto do Ads depois.
        if (lucroAntesAds !== null && !adsNoRepasse) linhas.push({ rotulo: '= Lucro antes do Ads', valor: lucroAntesAds, de: 'seller', total: true });
        if (U.r2(adsRs - adsNoRepasse)) linhas.push({ rotulo: 'Ads (rateado)', valor: -U.r2(adsRs - adsNoRepasse), de: 'seller' });
        if (lucroReal !== null) linhas.push({ rotulo: lucroReal < 0 ? '= Prejuízo' : '= Lucro', valor: lucroReal, de: 'seller', total: true });

        return Object.assign(base, {
            status, faltando, sem_custo: semCusto, avisos,
            bruto, desconto_vendedor: desconto, receita, reembolso, receita_liquida: receitaLiq,
            tarifas_por_tipo: porTipo, tarifas_rs: tarifasRs, tarifas_estimadas: estimadas, repasse,
            custo_rs: semCusto.length ? null : custo, custo_por_sku: custoPorSku, outros_rs: outros,
            imposto_pct: al.pct, imposto_rs: imposto, lucro_antes_ads: lucroAntesAds, ads_rs: faltando.includes('ads') ? null : adsRs, ads_no_repasse: adsNoRepasse,
            lucro_real: lucroReal, margem_pct: margem,
            classe: lucroReal === null ? status : (lucroReal < 0 ? 'prejuizo' : (margem !== null && margem < alvo ? 'apertado' : 'lucrativo')),
            por_item: porItem, linhas,
        });
    }

    /**
     * Rateio do Ads por anúncio e dia: o custo de (anúncio, dia) vai para os pedidos daquele anúncio naquele dia, pela receita do item.
     * Entrada por período (periodo_de/periodo_ate) vale para os pedidos do anúncio no período. Custo sem venda (ou sem anuncio_id)
     * fica em naoRateado — vai para o fechamento do mês, nunca some.
     * → { porPedido: {pedido_id: {total, porAnuncio: {anuncio_id: valor}}}, naoRateado: Ads[], total_rateado, total_nao_rateado }
     */
    function rateioAds(ads, pedidos) {
        const porPedido = {}, naoRateado = [];
        let totR = 0, totN = 0;
        const validos = (pedidos || []).filter(p => p && !M.ehNaoLido(p) && p.status !== 'cancelado' && Array.isArray(p.itens));
        (ads || []).forEach(a => {
            if (!a || !(a.custo > 0)) return;
            const noDia = p => (a.dia ? p.data_venda === a.dia : (a.periodo_de && a.periodo_ate && p.data_venda >= a.periodo_de && p.data_venda <= a.periodo_ate));
            const alvo = [];
            if (a.anuncio_id) validos.forEach(p => { if (!noDia(p)) return; const peso = U.soma(p.itens.filter(it => it.anuncio_id === a.anuncio_id), it => (valorItem(it) || 0)); if (peso > 0) alvo.push({ p, peso }); });
            const somaPeso = U.soma(alvo, x => x.peso);
            if (!alvo.length || !(somaPeso > 0)) { naoRateado.push(a); totN += a.custo; return; }
            const partes = reparte(a.custo, alvo.map(x => x.peso));   // maior resto: nenhuma parte negativa e a soma = o custo
            alvo.forEach((x, i) => {
                const v = partes[i];
                const e = porPedido[x.p.id] || (porPedido[x.p.id] = { total: 0, porAnuncio: {} });
                e.total = U.r2(e.total + v);
                e.porAnuncio[a.anuncio_id] = U.r2((e.porAnuncio[a.anuncio_id] || 0) + v);
            });
            totR += a.custo;
        });
        return { porPedido, naoRateado, total_rateado: U.r2(totR), total_nao_rateado: U.r2(totN) };
    }

    /**
     * Lucro por produto (SKU; sem SKU, pelo id do anúncio) somando os pedidos. Só entram os resultados 'ok' e 'cancelado';
     * os outros contam em pendentes (o painel mostra "N pedidos sem custo / não lidos").
     */
    function lucroPorProduto(resultados) {
        const g = {};
        (resultados || []).forEach(r => {
            (r.por_item || []).forEach(x => {
                const s = g[x.sku] || (g[x.sku] = { sku: x.sku, pedidos: 0, unidades: 0, receita: 0, tarifas: 0, custo: 0, outros: 0, imposto: 0, ads: 0, ads_repasse: 0, lucro_real: 0, pendentes: 0, pedidos_ids: [] });
                if (r.status !== 'ok' && r.status !== 'cancelado') { s.pendentes++; return; }
                if (s.pedidos_ids.indexOf(r.pedido_id) < 0) { s.pedidos_ids.push(r.pedido_id); s.pedidos++; }
                if (r.status === 'ok') s.unidades += x.qtd;
                s.receita += x.receita; s.tarifas += x.tarifas || 0; s.custo += x.custo || 0; s.outros += x.outros; s.imposto += x.imposto; s.ads += x.ads; s.ads_repasse += x.ads_repasse || 0;
                s.lucro_real += x.receita - (x.tarifas || 0) - (x.custo || 0) - x.outros - x.imposto - x.ads;
            });
        });
        return Object.keys(g).map(k => {
            const s = g[k];
            ['receita', 'tarifas', 'custo', 'outros', 'imposto', 'ads', 'ads_repasse', 'lucro_real'].forEach(c => { s[c] = U.r2(s[c]); });
            s.margem_pct = s.receita > 0 ? Math.round(s.lucro_real / s.receita * 10000) / 100 : null;
            delete s.pedidos_ids;
            return s;
        }).sort((a, b) => b.receita - a.receita);
    }

    /**
     * Fechamento do mês ('AAAA-MM'): pedidos + tarifas SEM pedido (fatura, Full, assinatura…) + Ads que não deu para ratear.
     * ads_rateados = true (padrão): as tarifas 'ads' sem pedido NÃO entram (o Ads já foi pelo rateio + naoRateado — não contar 2 vezes).
     * → { mes, pedidos, receita_liquida, repasse, lucro_pedidos, sem_pedido: {porTipo, total, estornos}, ads_nao_rateado, lucro_mes, completo, pendentes }
     */
    function fechamentoMes(o) {
        o = o || {};
        const mes = o.mes, dentro = d => U.mes(d) === mes;
        const res = (o.resultados || []).filter(r => dentro(r.data));
        const conta = res.filter(r => r.status === 'ok' || r.status === 'cancelado');
        const porTipo = {};
        let estornos = 0;
        const tarifas = Array.isArray(o.tarifas) ? o.tarifas : [];
        tarifas.forEach(t => {
            if (!t || t.pedido_id || !dentro(t.data)) return;
            if (t.tipo === 'ads' && o.ads_rateados !== false) return;
            porTipo[t.tipo] = U.r2((porTipo[t.tipo] || 0) + t.valor);
            if (t.valor < 0) estornos = U.r2(estornos + t.valor);
        });
        const semPedido = U.soma(Object.keys(porTipo), k => porTipo[k]);
        const adsN = U.soma((o.adsNaoRateado || []).filter(a => dentro(a.dia || a.periodo_ate)), a => a.custo);
        const lucroPedidos = U.soma(conta, r => r.lucro_real);
        return {
            mes, pedidos: conta.length, pendentes: res.length - conta.length,
            receita_liquida: U.soma(conta, r => r.receita_liquida), repasse: U.soma(conta, r => r.repasse),
            custo: U.soma(conta, r => r.custo_rs), imposto: U.soma(conta, r => r.imposto_rs), ads_rateado: U.soma(conta, r => r.ads_rs),
            lucro_pedidos: lucroPedidos, sem_pedido: { porTipo, total: semPedido, estornos }, ads_nao_rateado: adsN,
            lucro_mes: U.r2(lucroPedidos - semPedido - adsN),
            completo: res.length === conta.length && !M.ehNaoLido(o.tarifas),
        };
    }

    return { custoUnitario, aliquota, lucroPedido, rateioAds, lucroPorProduto, fechamentoMes, reparte };
});
