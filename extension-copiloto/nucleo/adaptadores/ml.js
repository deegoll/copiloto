// copiloto-nucleo · adaptador de EXEMPLO do Mercado Livre. Não lê o ML: converte os objetos que o Copiloto (extension-copiloto) JÁ
// produz hoje — SHC.mlCobrancasDaResposta, SHC.telaVendaConta, SHC.mlVendasDaLista, SHC.mpAtividadesDoEstado, SHC.freteDasCobrancas,
// SHC.devolucoesDasCobrancas, SHC.adsAnuncios, SHC.afilPedidos, SHC.mlPromosDoEstado, SHC.mlAnunciosDoEstado, SHC.mlPosVendaDoEstado,
// SHC.alertasConta — para o modelo único. "O ML já é o adaptador; muda o embrulho, não o código."
(function (root, fabrica) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = fabrica(require('../util'), require('../modelo'), require('../tarifas'), require('../adaptador'));
    else { const CN = root.CopilotoNucleo = root.CopilotoNucleo || {}; (CN.adaptadores = CN.adaptadores || {}).ml = fabrica(CN.util, CN.modelo, CN.tarifas, CN.adaptador); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (U, M, T, A) {
    'use strict';

    const O = conta => ({ canal: 'ml', conta: String(conta || ''), fonte: 'tela' });

    // RESERVA para rodar sem a extensão (servidor, testes): cópia de SHC.tipoCustoFechamento v3.4.1 (ml-extrator.js:1867-1898; DSB = frete).
    // Com a extensão carregada vale a original (tipoDaExtensao); o ml.test confere a cópia contra ela nas 180 cobranças reais.
    const TIPO_POR_CODIGO = { VVML: 'tarifa_venda', VVPRC: 'cobranca_mp', RAD: 'cobranca_mp', VVFN: 'parcelamento', FONPN: 'parcelamento', VVFNU: 'recebimento',
        XDE: 'frete', XD: 'frete', XDI: 'frete', FFE: 'frete', FFI: 'frete', DSB: 'frete', XDED: 'devolucao', DSDB: 'devolucao', PADS: 'ads', DLIT: 'ads_seguidores',
        DIFAL: 'impostos_ml', ESM: 'minha_pagina', FWA: 'full', FBA: 'full', FCBE: 'full', FPB: 'full', FRS: 'full' };
    const codigoCobranca = id => { const t = String(String(id || '').split('|')[2] || '').toUpperCase(); return /^[CB][A-Z]/.test(t) ? t.slice(1) : t; };
    /** detail_1 (+ c.id) → tipo do fechamento; texto vazio ou novo → pelo código do ML em c.id. */
    function tipoCustoFechamento(t, id) {
        const tp = tipoPeloTexto(t);
        return tp === 'outro' && id ? TIPO_POR_CODIGO[codigoCobranca(id)] || 'outro' : tp;
    }
    function tipoPeloTexto(t) {
        const s = String(t || '').replace(/^\s*cancelamento\s+(d[oa]s?|de)\s+/i, '');
        if (/seguidores/i.test(s)) return 'ads_seguidores';
        if (/product ads|publicidad/i.test(s)) return 'ads';
        if (/\bfull\b/i.test(s)) return 'full';
        if (/minha p[áa]gina/i.test(s)) return 'minha_pagina';
        if (/difal|al[íi]quota|\bimpostos?\b/i.test(s)) return 'impostos_ml';
        if (/devolu[çc][ãa]o/i.test(s)) return 'devolucao';
        if (/tarifa (de|por) envio|envios?\b/i.test(s)) return 'frete';
        if (/custo por vender/i.test(s)) return 'tarifa_venda';
        if (/custo por cobrar/i.test(s)) return 'cobranca_mp';
        if (/parcelamento/i.test(s)) return 'parcelamento';
        if (/taxa de recebimento/i.test(s)) return 'recebimento';
        if (/^tarifa de venda/i.test(s)) return 'tarifa_venda';
        if (/mercado pago|processamento/i.test(s)) return 'cobranca_mp';
        return 'outro';
    }
    /** A classificação da extensão, quando ela está carregada (lida na hora: a ordem de carga dos scripts não importa). */
    const tipoDaExtensao = () => { const S = typeof globalThis !== 'undefined' && globalThis.SHC; return S && typeof S.tipoCustoFechamento === 'function' ? S.tipoCustoFechamento : null; };
    /** SHC.TIPOS_FECHAMENTO → tipo padronizado. tarifa_venda = comissão + taxa fixa juntas ("Custo por vender"). */
    const RENOMEIA = {
        tarifa_venda: 'comissao', cobranca_mp: 'pagamento', parcelamento: 'pagamento', recebimento: 'pagamento',
        frete: 'frete_venda', devolucao: 'frete_devolucao', full: 'armazenagem', ads: 'ads', ads_seguidores: 'ads',
        minha_pagina: 'assinatura', impostos_ml: 'imposto_canal', outro: 'outro',
    };

    /** Taxa fixa do ML (tabela do núcleo) para qtd unidades a um preço unitário. */
    function taxaFixa(unit, qtd, data) {
        const ls = T.tarifasDoItem('ml', unit, { qtd }, data) || [];
        return U.soma(ls.filter(l => l.tipo === 'taxa_fixa'), l => l.valor);
    }

    /**
     * Cobranças do Faturamento (SHC.mlCobrancasDaResposta, lista inteira) → Tarifa[] padronizadas. Estorno com valor −.
     * opts: { conta, precos: {orderId: {preco_unit, qtd}} (separa comissão × taxa fixa do "Custo por vender"), tipoCustoFechamento }.
     * Tipo: opts.tipoCustoFechamento > SHC.tipoCustoFechamento (extensão carregada) > a cópia de reserva; sempre com o c.id (código do ML).
     * Lista não reconhecida (reconhecida === false) → naoLido (o fundo não grava zero por cima — mesma regra do Copiloto).
     */
    function tarifasDasCobrancas(cobs, opts) {
        opts = opts || {};
        if (!Array.isArray(cobs) || cobs.reconhecida === false) return M.naoLido('Faturamento do ML não reconhecido');
        const tipoDe = opts.tipoCustoFechamento || tipoDaExtensao() || tipoCustoFechamento, out = [];
        cobs.forEach(c => {
            const data = c && (c.dataRef || c.data);
            if (!c || !U.diaValido(data || '') || !(c.valor >= 0)) return;
            const antigo = tipoDe(c.texto, c.id), tipo = RENOMEIA[antigo] || 'outro', sinal = c.estorno ? -1 : 1;
            const base = Object.assign(O(opts.conta), {
                id: c.id || null, pedido_id: c.orderId || null, anuncio_id: c.itemId || null, data, tipo,
                valor: U.r2(sinal * c.valor), origem_pagamento: c.origemPagamento === 'venda' ? 'venda' : 'fatura',
                texto_original: String(c.texto || ''), estimada: false, tipo_ml: antigo,
            });
            const pr = tipo === 'comissao' && c.orderId && opts.precos && opts.precos[c.orderId];
            if (pr && pr.preco_unit > 0) {
                const fixo = Math.min(c.valor, taxaFixa(pr.preco_unit, pr.qtd || 1, data));
                if (fixo > 0) {
                    out.push(Object.assign({}, base, { id: base.id ? base.id + '#comissao' : null, valor: U.r2(sinal * (c.valor - fixo)) }));
                    out.push(Object.assign({}, base, { id: base.id ? base.id + '#fixa' : null, tipo: 'taxa_fixa', valor: U.r2(sinal * fixo), estimada: true }));
                    return;
                }
            }
            out.push(base);
        });
        return out;
    }

    const MES_CURTO = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
    /** "24 set 20:27 hs" / "hoje" / "ontem" → 'AAAA-MM-DD' (mesma regra do SHC.dataVendaLista) | null. */
    function diaDaLista(txt, hoje) {
        const t = String(txt || '').toLowerCase(), h = U.dia(hoje) || U.hoje();
        if (/\bhoje\b/.test(t)) return h;
        if (/\bontem\b/.test(t)) return U.somaDias(h, -1);
        const m = /(\d{1,2})\s*(?:de\s+)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*\.?(?:\s*(?:de\s+)?(\d{4}))?/.exec(t);
        if (!m || !(+m[1] >= 1 && +m[1] <= 31)) return null;
        const z = n => String(n).padStart(2, '0'), ano = m[3] ? +m[3] : +h.slice(0, 4);
        let d = ano + '-' + z(MES_CURTO[m[2]]) + '-' + z(+m[1]);
        if (!m[3] && d > h) d = (ano - 1) + d.slice(4);
        return U.diaValido(d) ? d : null;
    }
    const logisticaDoTexto = t => (/full/i.test(t) ? 'full' : /flex/i.test(t) ? 'flex' : /coleta/i.test(t) ? 'coleta' : /ag[êe]ncia|ponto/i.test(t) ? 'agencia' : null);

    /**
     * Venda da lista (SHC.mlVendasDaLista) → Pedido. opts: { conta, hoje, data (dia da venda, se o chamador já sabe) }.
     * Sem dia da venda → naoLido. Preço por produto: 1 produto = preço da lista × qtd (desde 01/10 a lista mostra o UNITÁRIO: "R$ 49,40 |
     * 2 unidades", mesma regra do valorDaLinha, ml-tela.js:548-551); vários = o que fechar com o total do carrinho (senão null = não lido).
     */
    function pedidoDaVenda(v, opts) {
        opts = opts || {};
        if (!v || !v.pedido) return M.naoLido('venda sem número');
        const data = U.dia(opts.data) || diaDaLista(v.quando, opts.hoje);
        if (!data) return M.naoLido('venda ' + v.pedido + ' sem dia');
        const ps = v.produtos && v.produtos.length ? v.produtos : [];
        const total = v.preco > 0 ? v.preco : U.soma(ps, p => (p.preco || 0) * (p.qtd || 1));
        let linha;   // total de cada linha
        if (ps.length === 1) { const q = ps[0].qtd || 1, un = v.preco > 0 ? v.preco : ps[0].preco; linha = [un > 0 ? U.r2(un * q) : null]; }
        else if (Math.abs(U.soma(ps, p => (p.preco || 0) * (p.qtd || 1)) - total) <= 0.05) linha = ps.map(p => U.r2(p.preco * (p.qtd || 1)));
        else if (Math.abs(U.soma(ps, p => p.preco || 0) - total) <= 0.05) linha = ps.map(p => p.preco);
        else linha = ps.map(() => null);
        return M.criar('pedido', Object.assign(O(opts.conta), {
            id: String(v.pedido), data_venda: data, status: v.cancelada ? 'cancelado' : 'pago',
            itens: ps.map((p, i) => ({ sku: p.sku || '', anuncio_id: p.itemId || '', titulo: p.titulo || '', qtd: p.qtd || 1,
                preco_unit: linha[i] === null ? null : U.r2(linha[i] / (p.qtd || 1)), total: linha[i] })),
            logistica: logisticaDoTexto(v.envio || ''),
        }));
    }

    /**
     * Venda + a conta que a etiqueta da lista já faz (SHC.telaVendaConta) → { pedido, tarifas, teto }.
     * Tarifa do anúncio (mesma % de hoje) sai como comissão + taxa fixa, 'estimada'; frete do Faturamento é real, senão estimado.
     * O repasse do núcleo bate com c.recebe e o lucro com c.sobra (mesmo custo e imposto) — teste de paridade em testes/.
     * teto = c.freteFalta: o frete grátis passou a ser do vendedor e o valor ainda não foi lido → o lucro é um TETO ("lucro até").
     */
    function contaDaVenda(v, c, opts) {
        const pedido = pedidoDaVenda(v, opts);
        // Sem custo a conta segue igual (o "Recebe" vale na etiqueta); quem diz 'sem custo' é o motor, pela lista de custos.
        if (M.ehNaoLido(pedido) || !c) return { pedido, tarifas: M.naoLido('venda sem conta (anúncio fora do retrato)'), teto: false };
        const o = O((opts || {}).conta), tarifas = [];
        const add = (tipo, valor, extra) => tarifas.push(Object.assign({}, o, { pedido_id: pedido.id, data: pedido.data_venda, tipo, valor: U.r2(valor), origem_pagamento: 'venda' }, extra));
        // Parte do total c.tarifa: cada item leva a sua parte arredondada e o último leva o centavo que sobra (como o rateioAds).
        let resto = U.r2(c.tarifa || 0);
        (c.itens || []).forEach((x, i, a) => {
            const tar = i === a.length - 1 ? resto : x.tarifa;
            resto = U.r2(resto - tar);
            const unit = x.qtd > 0 ? x.valor / x.qtd : x.valor, fixo = Math.min(tar, taxaFixa(unit, x.qtd || 1, pedido.data_venda));
            add('comissao', tar - fixo, { anuncio_id: x.itemId, estimada: true, texto_original: 'Tarifa de venda do anúncio (' + U.r2(x.taxaPct) + '%)' });
            if (fixo > 0) add('taxa_fixa', fixo, { anuncio_id: x.itemId, estimada: true, texto_original: 'Taxa fixa por faixa de preço' });
        });
        const real = c.freteFonte === 'faturamento', teto = !!c.freteFalta;
        add('frete_venda', c.frete || 0, { estimada: !real, texto_original: real ? 'Frete cobrado neste pedido (Faturamento)' : teto ? 'Frete grátis por sua conta, valor ainda não lido (lucro até)'
            : (c.freteComprador ? 'Frete por conta do comprador' : 'Frete estimado do anúncio') });
        if (c.taxaOp > 0) add('frete_venda', c.taxaOp, { estimada: true, texto_original: 'Custo operacional do ML (comprador paga o frete)' });
        return { pedido, tarifas: tarifas.map(t => M.criar('tarifa', t)), teto };
    }
    /**
     * Resultado do motor (+ teto de contaDaVenda, + meta de margem em %) → a classe da etiqueta da lista (SHC.telaVendaConta.classe).
     * A margem vai SEM arredondar contra a meta, como a extensão (sobra / total × 100 < alvo): o r.classe do motor usa a margem já
     * arredondada em 2 casas e numa venda de R$ 200 com sobra de R$ 19,99 (9,995%) daria 'lucrativo' onde a etiqueta mostra 'apertado'.
     */
    const classeEtiqueta = (r, teto, alvo) => (r.status === 'sem_custo' ? 'semcusto' : r.lucro_real === null ? r.classe : r.lucro_real < 0 ? 'prejuizo'
        : teto ? 'semfrete' : !(r.receita_liquida > 0) ? r.classe : r.lucro_real / r.receita_liquida * 100 < (U.num(alvo) || 0) ? 'apertado' : 'lucrativo');

    /** SHC.vendasDasCobrancas → Pedido[] PARCIAIS (sem preço: o motor dá 'nao_lido' até juntar com a lista de Vendas). */
    function pedidosDasCobrancas(vendas, conta) {
        if (!Array.isArray(vendas)) return M.naoLido('vendas do Faturamento não lidas');
        return vendas.filter(v => v && v.pedido && U.diaValido(v.data || '')).map(v => M.criar('pedido', Object.assign(O(conta), {
            id: String(v.pedido), data_venda: v.data, status: v.cancelada ? 'cancelado' : 'pago', parcial: true,
            itens: [{ anuncio_id: v.itemId || '', qtd: 1, preco_unit: null }],
        })));
    }

    /** Atividade do Mercado Pago (SHC.mpAtividadesDoEstado / mpAtividadesDoHtml) → Repasse[] (o MP não diz o nº do pedido do ML). */
    function repassesDoMP(itens, conta) {
        if (!Array.isArray(itens)) return M.naoLido('Atividade do Mercado Pago não lida');
        return itens.filter(i => i && U.diaValido(i.data || '') && typeof i.valor === 'number').map((i, k) => M.criar('repasse', Object.assign(O(conta), {
            id: String(i.transacao || (i.data + '#' + k)), data_liberada: i.data, valor: i.valor, status: 'disponivel',
            motivo: i.tipo === 'reembolso' ? 'reembolso' : '', pedidos: [], titulo: i.titulo || '',
        })));
    }

    /** SHC.freteDasCobrancas → Frete[] (cheio = antes do desconto do ML; subsídio = cheio − cobrado). */
    function fretesDasCobrancas(fretes, conta) {
        if (!Array.isArray(fretes)) return M.naoLido('frete por pedido não lido');
        return fretes.map(f => M.criar('frete', Object.assign(O(conta), {
            pedido_id: String(f.pedido), cobrado_vendedor: f.cobrado, cheio: f.cheio, subsidio: f.cheio !== null && f.cheio !== undefined ? U.r2(f.cheio - f.cobrado) : null,
            descricao: f.formato || '',
        })));
    }

    /** SHC.devolucoesDasCobrancas → Devolucao[] (só o frete de volta: o reembolso vem do MP / pós-venda). */
    function devolucoesDasCobrancas(devs, conta) {
        if (!Array.isArray(devs)) return M.naoLido('devoluções não lidas');
        return devs.map(d => M.criar('devolucao', Object.assign(O(conta), { pedido_id: String(d.pedido), frete_volta: d.valor, estado: 'frete de volta cobrado' })));
    }

    /** SHC.adsAnuncios (métricas do PERÍODO da tela de Ads) → Ads[] por anúncio no período {de, ate}. Catálogo sem MLB → anuncio_id null. */
    function adsDosAnuncios(res, opts) {
        opts = opts || {};
        if (!res || !Array.isArray(res.anuncios)) return M.naoLido('Mercado Ads não lido');
        if (!U.diaValido(opts.de || '') || !U.diaValido(opts.ate || '')) return M.naoLido('período do Ads não informado');
        return res.anuncios.filter(a => a.custo > 0).map(a => M.criar('ads', Object.assign(O(opts.conta), {
            campanha_id: a.campanhaId || null, anuncio_id: a.itemId || null, periodo_de: opts.de, periodo_ate: opts.ate,
            custo: a.custo, receita_atribuida: a.receita, direta: a.receitaDireta, indireta: a.receitaIndireta,
        })));
    }

    /** SHC.afilPedidos → Afiliado[] (o ML não dá o nº do pedido nessa tela: liga pelo anúncio/SKU). */
    function afiliadosDosPedidos(res, conta) {
        if (!res || !Array.isArray(res.vendas)) return M.naoLido('afiliados não lidos');
        return res.vendas.map(v => M.criar('afiliado', Object.assign(O(conta), {
            anuncio_id: v.itemId || null, sku: v.sku || '', comissao_valor: v.comissao,
            comissao_pct: v.comissao !== null && v.valor > 0 ? Math.round(v.comissao / v.valor * 10000) / 100 : null, estado: v.verificacao || '',
        })));
    }

    /** SHC.mlPromosDoEstado → Promocao[] (uma por proposta; datas ficam no texto como o ML mostra). */
    function promocoesDasPropostas(res, conta) {
        if (!res || !Array.isArray(res.propostas)) return M.naoLido('promoções não lidas');
        return res.propostas.filter(p => p.itemId).map(p => M.criar('promocao', Object.assign(O(conta), {
            anuncio_id: p.itemId, tipo: p.promo || '', preco_promo: p.preco, recebe: p.recebe, texto_original: [p.datas, p.desconto_txt].filter(Boolean).join(' · '),
        })));
    }

    /** SHC.mlAnunciosDoEstado → Listing[]. */
    function listingsDosAnuncios(itens, conta) {
        if (!Array.isArray(itens)) return M.naoLido('anúncios não lidos');
        return itens.filter(i => i && i.itemId).map(i => {
            const est = /(\d[\d.]*)/.exec(String(i.estoque || ''));
            return M.criar('listing', Object.assign(O(conta), {
                anuncio_id: i.itemId, sku: i.sku || '', titulo: i.titulo || '', preco: i.preco, estoque: est ? Number(est[1].replace(/\./g, '')) : null,
                status: i.status || '', tipo_anuncio: /premium/i.test(i.tipo || '') ? 'premium' : (/cl[áa]ssico/i.test(i.tipo || '') ? 'classico' : ''),
                logistica: i.full ? 'full' : null,
            }));
        });
    }

    /** SHC.mlPosVendaDoEstado + SHC.alertasConta → Saude[]. Contagem null (aba não achada) continua null. */
    function saudeDaConta(posvenda, alertas, conta) {
        const out = [];
        if (posvenda && typeof posvenda === 'object') ['reclamacoes', 'mensagens', 'devolucoes'].forEach(k => {
            out.push(M.criar('saude', Object.assign(O(conta), { indicador: 'posvenda_' + k, titulo: k + ' pendentes', valor: posvenda[k], meta: 0, direcao: 'menor_melhor',
                efeito_se_falhar: k === 'reclamacoes' ? 'reclamação sem resposta pesa na reputação' : '' })));
        });
        (Array.isArray(alertas) ? alertas : []).forEach(a => out.push(M.criar('saude', Object.assign(O(conta), {
            indicador: a.chave || 'alerta', titulo: a.nivel || '', valor: 1, meta: 0, direcao: 'menor_melhor', efeito_se_falhar: a.texto || '',
        }))));
        return out;
    }

    /**
     * Mês do ML (3.3.0, E3): a MESMA conta da F.cascata (extension-copiloto/fechamento.js:128-173), com as mesmas entradas:
     * d = { mes, vb (F.vendasBrutas), fech ('fech:<conta>:<mês>'), produtos (F.custoProdutos), imposto_pct (null = não informado),
     *       despesas (SHC.despesasFixasDoMes), afil (só informativo, fora da conta), conta }.
     * Uma fonte por custo: Ads e Full só pelas cobranças da fatura (fech.porTipo); nada venda a venda entra aqui.
     * null = não lido, nos mesmos lugares da F.cascata. A trava do ml.test.js compara as duas ao centavo: mudou uma, muda a outra.
     * → { canal, conta, mes, linhas:[{id, sinal:'total'|'menos'|'mais'|'info', valor, tipo? (padronizado), parcial?}], bruto, cancelado,
     *     custosML, liquido, produtos, imposto, lucro, despesas, sobra, faltando:[o que deixou o lucro em null] }
     */
    function mesDaCascata(d) {
        d = d || {};
        const fech = d.fech || null, vb = d.vb && d.vb.completo ? d.vb : null, linhas = [];
        const add = (id, sinal, valor, extra) => linhas.push(Object.assign({ id, sinal, valor: valor === null ? null : U.r2(valor) }, extra || {}));
        const bruto = vb ? vb.valor : null;
        const cancel = vb && vb.cancelado !== null && vb.devolvido !== null ? U.r2((vb.cancelado || 0) + (vb.devolvido || 0)) : null;
        add('bruto', 'total', bruto);
        // Mês com dia faltando: o valor lido vai marcado "parcial" (como na cascata), e a conta continua sem ele.
        if (!vb && d.vb && !d.vb.naoLidoInteiro && U.num(d.vb.valor) !== null) Object.assign(linhas[0], { valor: U.r2(d.vb.valor),
            parcial: 'parcial' + (typeof d.vb.dias === 'number' ? ' (' + d.vb.dias + ' de ' + d.vb.diasMes + ' dias)' : '') });
        add('cancelado', 'menos', cancel);
        // Cobranças por tipo menos os estornos, na ordem e com os tipos do RENOMEIA (= F.TIPOS da cascata).
        const pt = (fech && fech.porTipo) || {}, ept = fech && fech.estornosPorTipo;
        let custos = fech ? 0 : null;
        Object.keys(RENOMEIA).forEach(id => {
            const v = fech ? U.r2((U.num(pt[id]) || 0) - (ept ? (U.num(ept[id]) || 0) : 0)) : null;
            add(id, 'menos', v, { tipo: RENOMEIA[id] });
            if (v !== null) custos += v;
        });
        const est = fech ? Math.abs(U.num(fech.estornos) || 0) : null;
        if (ept) { add('estornos', 'mais', est); custos -= est; }
        else add('estornos', 'info', est);   // fech antigo: o estorno já está descontado nas linhas acima
        const custosML = custos === null ? null : U.r2(custos);
        const af = d.afil, per = af && af.periodo;
        if (af && U.num(af.custoEstimado) !== null && per && per.de && per.ate && (!d.mes || (per.de.slice(0, 7) <= d.mes && per.ate.slice(0, 7) >= d.mes)))
            add('afiliados', 'info', U.num(af.custoEstimado));
        const liquido = bruto !== null && cancel !== null && custosML !== null ? U.r2(bruto - cancel - custosML) : null;
        add('liquido', 'total', liquido);
        const prod = d.produtos && d.produtos.completo ? d.produtos.valor : null;
        add('produtos', 'menos', prod);
        const temImp = d.imposto_pct !== null && d.imposto_pct !== undefined;
        const imp = temImp && bruto !== null && cancel !== null ? U.r2((bruto - cancel) * d.imposto_pct / 100) : null;
        add('imposto', 'menos', imp);
        const lucro = liquido !== null && prod !== null && imp !== null ? U.r2(liquido - prod - imp) : null;
        add('lucro', 'total', lucro);
        const df = d.despesas && U.num(d.despesas.valor) !== null ? d.despesas : null;
        let sobra = null;
        if (df) {
            add('despesas', 'menos', df.valor);
            sobra = lucro !== null ? U.r2(lucro - df.valor) : null;
            add('sobra', 'total', sobra);
        }
        const faltando = [bruto === null || cancel === null ? 'vendas_brutas' : '', fech ? '' : 'faturamento', prod === null ? 'custo_produtos' : '', temImp ? '' : 'imposto'].filter(Boolean);
        return { canal: 'ml', conta: String(d.conta || ''), mes: d.mes || null, linhas, bruto, cancelado: cancel, custosML, liquido, produtos: prod, imposto: imp,
            lucro, despesas: df ? df.valor : null, sobra, faltando };
    }

    const nf = v => (typeof v === 'number' && isFinite(v) ? v : null);
    /**
     * Produto × mês do ML (3.3.0, E4), porta "mês × anúncio": por anúncio COM venda no mês, a MESMA conta do lucroItem do SHC.familias
     * (extension-copiloto/ml-extrator.js:4301-4310). d = { mes, vbAnuncio ('vbAnuncio:<conta>'), retrato ('ml:anuncios:<conta>'),
     *   custoDe (info {sku, skus, skuFonte, itemId, familia} → {custo, outros} | null: o custo pronto; na extensão, o SHC.custoDeAnuncio embrulhado,
     *   info => { const c = SHC.custoDeAnuncio(custos, info); return c ? c.dados : null; }, porque ele devolve {chave, dados}),
     *   imposto_pct (null = 0%, como o SHC.PADRAO), ads ({MLB: {'AAAA-MM': R$}}, formato do 'ad|ml|<MLB>': o Ads do anúncio na fatura), conta }.
     * lucro_antes_ads = venda − tarifa (% do retrato) − (frete + taxa operacional) × unidades − (custo + outros) × unidades − imposto.
     * Sem retrato (ou preço), sem unidades ou sem custo → null, nos mesmos casos do lucroItem (a trava do ml.test.js compara ao centavo).
     * Ads só da fatura: anúncio sem o valor no mês → ads null ("—") e lucro null; nada estimado por outra fonte. lucro = lucro_antes_ads − ads.
     * → Linha[] (agrupe com motor.lucroPorProduto) | naoLido (mês não lido por inteiro). Linha = { canal, conta, mes, anuncio_id,
     *   sku (normalizado; '' = anúncio de variações, que fica pelo MLB como no SHC.familias), titulo, bruto, unidades, vendas, tarifa, frete,
     *   custo, outros, imposto, lucro_antes_ads, lucro_antes_ads_exato (sem arredondar: o lucroPorProduto soma este e arredonda só no SKU,
     *   como o SHC.familias), ads, lucro, status (do lucro antes do Ads: 'ok'|'sem_custo'|'nao_lido'), faltando }
     */
    function produtosDoMes(d) {
        d = d || {};
        const mes = String(d.mes || ''), x = /^\d{4}-\d{2}$/.test(mes) && d.vbAnuncio && d.vbAnuncio.meses && d.vbAnuncio.meses[mes];
        if (!x || x.completo !== true || !x.porAnuncio || typeof x.porAnuncio !== 'object') return M.naoLido('vendas por anúncio de ' + (mes || '?') + ' não lidas');
        const info = d.vbAnuncio.itens || {}, ret = {}, imp = (U.num(d.imposto_pct) || 0) / 100;
        ((d.retrato && d.retrato.itens) || []).forEach(i => { if (i && i.itemId && !ret[i.itemId]) ret[i.itemId] = i; });
        return Object.keys(x.porAnuncio).filter(id => (U.num((x.porAnuncio[id] || {}).bruto) || 0) > 0).map(id => {
            const l = x.porAnuncio[id], b = U.num(l.bruto), u = nf(l.unidades), r = ret[id], ri = r || {}, i = info[id] || {};
            const sku = U.normalizaSku(l.sku || i.sku || ri.sku || '');
            const vs = new Set([].concat(ri.sku || [], ri.skus || [], i.sku || [], i.skus || []).map(U.normalizaSku).filter(Boolean));
            const cd = typeof d.custoDe === 'function' ? d.custoDe({ sku, skus: ri.skus, skuFonte: ri.skuFonte, itemId: id, familia: ri.familia }) : null;
            const custo = cd ? U.num(cd.custo) : null, outros = cd ? U.num(cd.outros) || 0 : 0;
            const tarifaPct = r && r.preco > 0 ? (nf(r.tarifa) || 0) / r.preco : null;
            const frete = r ? (nf(r.frete) || 0) + (r.freteComprador && U.num(r.taxaOperacional) > 0 ? U.num(r.taxaOperacional) : 0) : null;
            const faltando = [tarifaPct === null ? 'retrato' : '', u === null ? 'unidades' : '', custo === null ? 'custo' : ''].filter(Boolean);
            const exato = faltando.length ? null : b - b * tarifaPct - u * frete - u * (custo + outros) - b * imp, antes = U.r2(exato);   // = lucroItem
            const ads = U.num(((d.ads || {})[id] || {})[mes]);
            if (ads === null) faltando.push('ads');
            return { canal: 'ml', conta: String(d.conta || ''), mes, anuncio_id: id, sku: vs.size > 1 ? '' : sku, titulo: String(i.titulo || ri.titulo || '').slice(0, 120),
                bruto: U.r2(b), unidades: u, vendas: nf(l.vendas), tarifa: tarifaPct === null ? null : U.r2(b * tarifaPct),
                frete: frete === null || u === null ? null : U.r2(u * frete), custo: custo === null || u === null ? null : U.r2(u * custo),
                outros: custo === null || u === null ? null : U.r2(u * outros), imposto: U.r2(b * imp), lucro_antes_ads: antes, lucro_antes_ads_exato: exato, ads,
                lucro: antes === null || ads === null ? null : U.r2(antes - ads),
                status: tarifaPct === null || u === null ? 'nao_lido' : custo === null ? 'sem_custo' : 'ok', faltando };
        });
    }

    /**
     * Adaptador ML completo. fontes = funções (async) que devolvem os objetos do Copiloto para a janela {de, ate}:
     * { cobrancas, vendas ([{v, c}] da lista de Vendas + telaVendaConta), atividadesMP, fretes, devolucoes, ads, afiliados, promos, anuncios,
     *   posvenda, alertas }. Fonte que falta = o método some ("este canal não informa…" — no ML, "o Copiloto ainda não leu").
     */
    function criarAdaptadorML(o) {
        o = o || {};
        const f = o.fontes || {}, conta = o.conta, def = {
            id: 'ml', nome: 'Mercado Livre',
            hosts: [/^vendedores\.mercadolivre\.com\.br$/, /^ads\.mercadolivre\.com\.br$/, /^www\.mercadopago\.com\.br$/],
            fonte: {}, tarifa: T.TABELA.filter(l => l.canal === 'ml'),
        };
        const liga = (m, fonte, conv) => { if (typeof f[fonte] === 'function') { def[m] = async j => conv(await f[fonte](j), j); def.fonte[m] = 'tela'; } };
        liga('tarifas', 'cobrancas', (cobs, j) => tarifasDasCobrancas(cobs, { conta, precos: j && j.precos }));
        liga('pedidos', 'vendas', (vs, j) => (Array.isArray(vs) ? vs.map(x => pedidoDaVenda(x.v || x, { conta, hoje: j && j.hoje })).filter(p => !M.ehNaoLido(p)) : M.naoLido('lista de Vendas não lida')));
        liga('repasses', 'atividadesMP', its => repassesDoMP(its, conta));
        liga('fretes', 'fretes', fr => fretesDasCobrancas(fr, conta));
        liga('devolucoes', 'devolucoes', ds => devolucoesDasCobrancas(ds, conta));
        liga('ads', 'ads', (r, j) => adsDosAnuncios(r, { conta, de: j && j.de, ate: j && j.ate }));
        liga('afiliados', 'afiliados', r => afiliadosDosPedidos(r, conta));
        liga('promocoes', 'promos', r => promocoesDasPropostas(r, conta));
        liga('listings', 'anuncios', r => listingsDosAnuncios(r, conta));
        if (typeof f.posvenda === 'function' || typeof f.alertas === 'function') {
            def.saude = async j => saudeDaConta(f.posvenda ? await f.posvenda(j) : null, f.alertas ? await f.alertas(j) : null, conta);
            def.fonte.saude = 'tela';
        }
        return A.criarAdaptador(def);
    }

    return { tipoCustoFechamento, RENOMEIA, tarifasDasCobrancas, diaDaLista, pedidoDaVenda, contaDaVenda, classeEtiqueta, pedidosDasCobrancas, repassesDoMP,
        fretesDasCobrancas, devolucoesDasCobrancas, adsDosAnuncios, afiliadosDosPedidos, promocoesDasPropostas, listingsDosAnuncios, saudeDaConta,
        mesDaCascata, produtosDoMes, criarAdaptadorML };
});
