// copiloto-nucleo · modelo único de dados (fábricas + validação).
// Generaliza o que o Copiloto do ML já faz (SHC.TIPOS_FECHAMENTO vira o tipo de tarifa padronizado). Todo registro de canal leva
// canal, conta e fonte ('tela' | 'api' | 'erp' | 'manual'). Regra de ouro: leitura que falhou NUNCA vira zero — vira naoLido().
(function (root, fabrica) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = fabrica(require('./util'));
    else { const CN = root.CopilotoNucleo = root.CopilotoNucleo || {}; CN.modelo = fabrica(CN.util); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (U) {
    'use strict';

    const CANAIS = ['ml', 'shopee', 'tiktok', 'magalu', 'amazon', 'shein', 'temu', 'outro'];
    const FONTES = ['tela', 'api', 'erp', 'manual'];
    const FONTES_CUSTO = ['sellerhub', 'bling', 'tiny', 'omie', 'manual'];
    /** Tipos de tarifa padronizados (o mesmo nome em todos os canais). Estorno = mesmo tipo com valor negativo. */
    const TIPOS_TARIFA = ['comissao', 'taxa_fixa', 'programa_frete', 'pagamento', 'frete_venda', 'frete_devolucao',
        'afiliado', 'afiliado_ads', 'ads', 'armazenagem', 'imposto_canal', 'assinatura', 'outro'];
    const STATUS_PEDIDO = ['pago', 'enviado', 'entregue', 'cancelado', 'devolvido'];
    const STATUS_REPASSE = ['a_liberar', 'disponivel', 'retido', 'sacado'];
    const LOGISTICAS = ['full', 'coleta', 'agencia', 'flex', 'vendedor'];
    const ORIGENS_PAGAMENTO = ['venda', 'fatura'];
    const DIRECOES = ['maior_melhor', 'menor_melhor'];

    // ── Esquemas: { campo: {t, obrig, nulo, padrao, valores, item} } ──
    // t: 'id' | 'texto' | 'dinheiro' | 'numero' | 'inteiro' | 'dia' | 'bool' | 'enum' | 'lista' | 'objeto'
    const origem = {
        canal: { t: 'enum', valores: CANAIS, obrig: true },
        conta: { t: 'id', obrig: true },
        fonte: { t: 'enum', valores: FONTES, obrig: true },
    };
    const ESQUEMAS = {
        item: {
            sku: { t: 'texto', padrao: '' },
            anuncio_id: { t: 'texto', padrao: '' },
            titulo: { t: 'texto', padrao: '' },
            qtd: { t: 'inteiro', obrig: true, min: 1 },
            preco_unit: { t: 'dinheiro', nulo: true, min: 0 },   // null = não lido (o motor não calcula com ele)
            total: { t: 'dinheiro', nulo: true, min: 0 },        // total da linha, quando o canal dá (evita 3 × 33,33 ≠ 100,00)
        },
        pedido: Object.assign({}, origem, {
            id: { t: 'id', obrig: true },
            data_venda: { t: 'dia', obrig: true },
            data_entrega: { t: 'dia', nulo: true },   // dia T do repasse no TikTok
            status: { t: 'enum', valores: STATUS_PEDIDO, obrig: true },
            uf: { t: 'texto', nulo: true },
            itens: { t: 'lista', item: 'item', obrig: true, min: 1 },
            desconto_vendedor: { t: 'dinheiro', padrao: 0, min: 0 },
            desconto_plataforma: { t: 'dinheiro', padrao: 0, min: 0 },   // não entra na receita do vendedor (a plataforma paga)
            reembolso: { t: 'dinheiro', padrao: 0, min: 0 },   // produto reembolsado ao comprador (sai da receita)
            logistica: { t: 'enum', valores: LOGISTICAS, nulo: true },
            afiliado_id: { t: 'texto', nulo: true },
            canal_venda: { t: 'texto', nulo: true },   // TikTok: Live / Video / Product card
        }),
        tarifa: Object.assign({}, origem, {
            id: { t: 'texto', nulo: true },
            pedido_id: { t: 'texto', nulo: true },
            anuncio_id: { t: 'texto', nulo: true },
            data: { t: 'dia', obrig: true },
            tipo: { t: 'enum', valores: TIPOS_TARIFA, obrig: true },
            valor: { t: 'dinheiro', obrig: true },   // + cobrado · − estorno
            origem_pagamento: { t: 'enum', valores: ORIGENS_PAGAMENTO, padrao: 'venda' },
            texto_original: { t: 'texto', padrao: '' },
            estimada: { t: 'bool', padrao: false },   // "Est." do TikTok, tarifa do anúncio de hoje etc.
        }),
        frete: Object.assign({}, origem, {
            pedido_id: { t: 'id', obrig: true },
            cobrado_vendedor: { t: 'dinheiro', nulo: true },
            pago_comprador: { t: 'dinheiro', nulo: true },
            cheio: { t: 'dinheiro', nulo: true },
            subsidio: { t: 'dinheiro', nulo: true },
            peso_cobrado_g: { t: 'numero', nulo: true },
            peso_cadastro_g: { t: 'numero', nulo: true },
            descricao: { t: 'texto', padrao: '' },
        }),
        repasse: Object.assign({}, origem, {
            id: { t: 'id', obrig: true },
            data_prevista: { t: 'dia', nulo: true },
            data_liberada: { t: 'dia', nulo: true },
            valor: { t: 'dinheiro', obrig: true },
            status: { t: 'enum', valores: STATUS_REPASSE, obrig: true },
            motivo: { t: 'texto', padrao: '' },
            pedidos: { t: 'lista', padrao: [] },
            por_pedido: { t: 'objeto', nulo: true },   // {pedido_id: valor} quando o canal diz quanto de cada pedido
            estimado: { t: 'bool', padrao: false },
        }),
        devolucao: Object.assign({}, origem, {
            pedido_id: { t: 'id', obrig: true },
            motivo: { t: 'texto', padrao: '' },
            estado: { t: 'texto', padrao: '' },
            prazo_resposta: { t: 'dia', nulo: true },
            valor_reembolsado: { t: 'dinheiro', nulo: true },
            frete_volta: { t: 'dinheiro', nulo: true },
            afeta_reputacao: { t: 'bool', nulo: true },
            produto_voltou: { t: 'bool', nulo: true },   // false = reembolso sem devolução: o vendedor perde o produto
        }),
        ads: Object.assign({}, origem, {
            campanha_id: { t: 'texto', nulo: true },
            anuncio_id: { t: 'texto', nulo: true },
            dia: { t: 'dia', nulo: true },          // por dia (o ideal) …
            periodo_de: { t: 'dia', nulo: true },   // … ou por período (ML: métrica agregada da tela de Ads)
            periodo_ate: { t: 'dia', nulo: true },
            custo: { t: 'dinheiro', obrig: true, min: 0 },
            receita_atribuida: { t: 'dinheiro', nulo: true },
            direta: { t: 'dinheiro', nulo: true },
            indireta: { t: 'dinheiro', nulo: true },
            gmv_max: { t: 'bool', padrao: false },   // TikTok GMV Max: todo o GMV vai para a campanha (não somar com orgânico)
        }),
        afiliado: Object.assign({}, origem, {
            pedido_id: { t: 'texto', nulo: true },
            anuncio_id: { t: 'texto', nulo: true },
            sku: { t: 'texto', padrao: '' },
            criador_id: { t: 'texto', nulo: true },
            comissao_pct: { t: 'numero', nulo: true },
            comissao_valor: { t: 'dinheiro', nulo: true },
            via_ads: { t: 'bool', padrao: false },
            estado: { t: 'texto', padrao: '' },
        }),
        promocao: Object.assign({}, origem, {
            anuncio_id: { t: 'id', obrig: true },
            tipo: { t: 'texto', padrao: '' },
            inicio: { t: 'dia', nulo: true },
            fim: { t: 'dia', nulo: true },
            preco_promo: { t: 'dinheiro', nulo: true },
            subsidio_plataforma: { t: 'dinheiro', nulo: true },
            recebe: { t: 'dinheiro', nulo: true },   // "você recebe" que o canal mostra na proposta
            texto_original: { t: 'texto', padrao: '' },
        }),
        listing: Object.assign({}, origem, {
            anuncio_id: { t: 'id', obrig: true },
            sku: { t: 'texto', padrao: '' },
            titulo: { t: 'texto', padrao: '' },
            preco: { t: 'dinheiro', nulo: true },
            estoque: { t: 'numero', nulo: true },
            status: { t: 'texto', padrao: '' },
            tipo_anuncio: { t: 'texto', padrao: '' },
            categoria: { t: 'texto', padrao: '' },
            logistica: { t: 'enum', valores: LOGISTICAS, nulo: true },
            frete_gratis_programa: { t: 'bool', nulo: true },
        }),
        // Configuração do seller (não é dado do canal): sem canal/conta obrigatórios.
        custo_sku: {
            sku: { t: 'id', obrig: true },
            custo: { t: 'dinheiro', nulo: true, min: 0 },          // null quando é kit (vem dos componentes)
            outros: { t: 'dinheiro', padrao: 0, min: 0 },          // embalagem etc., por unidade
            componentes: { t: 'lista', padrao: [] },               // kit: [{sku, qtd}]
            vigencia_de: { t: 'dia', nulo: true },                 // null = desde sempre
            fonte: { t: 'enum', valores: FONTES_CUSTO, padrao: 'manual' },
        },
        imposto: {
            conta: { t: 'texto', nulo: true },   // null = vale para todas as contas
            canal: { t: 'enum', valores: CANAIS, nulo: true },
            regime: { t: 'texto', padrao: '' },
            aliquota_pct: { t: 'numero', obrig: true, min: 0 },
            vigencia_de: { t: 'dia', nulo: true },
        },
        saude: Object.assign({}, origem, {
            indicador: { t: 'id', obrig: true },
            titulo: { t: 'texto', padrao: '' },
            valor: { t: 'numero', nulo: true },   // null = não lido
            meta: { t: 'numero', nulo: true },
            direcao: { t: 'enum', valores: DIRECOES, nulo: true },
            efeito_se_falhar: { t: 'texto', padrao: '' },
        }),
    };

    function normaliza(esq, d) {
        const out = {};
        Object.keys(esq).forEach(k => {
            const e = esq[k];
            let v = d[k];
            if (v === undefined) v = e.padrao !== undefined ? U.copia(e.padrao) : (e.nulo ? null : undefined);
            if (v !== null && v !== undefined) {
                if (e.t === 'id' || e.t === 'texto') v = typeof v === 'number' ? (Number.isSafeInteger(v) || e.t === 'texto' ? String(v) : v) : v;
                else if (e.t === 'dinheiro') { const n = U.num(v); v = n === null ? v : U.r2(n); }
                else if (e.t === 'numero' || e.t === 'inteiro') { const n = U.num(v); v = n === null ? v : n; }
                else if (e.t === 'dia') { const x = U.dia(v); v = x || v; }
                else if (e.t === 'lista' && e.item && Array.isArray(v)) v = v.map(x => (x && typeof x === 'object' ? normaliza(ESQUEMAS[e.item], x) : x));
            }
            if (v !== undefined) out[k] = v;
        });
        // Campos fora do esquema passam (extras do canal), sem mexer.
        Object.keys(d).forEach(k => { if (!(k in esq)) out[k] = d[k]; });
        return out;
    }

    function erroCampo(e, v) {
        if (v === null || v === undefined) return (e.obrig && !e.nulo) ? 'obrigatório' : null;
        switch (e.t) {
        case 'id': return typeof v === 'string' && v.trim() ? null : (typeof v === 'number' ? 'id numérico grande demais: use texto' : 'precisa ser texto não vazio');
        case 'texto': return typeof v === 'string' ? null : 'precisa ser texto';
        case 'dinheiro': case 'numero':
            if (typeof v !== 'number' || !isFinite(v)) return 'precisa ser número';
            return e.min !== undefined && v < e.min ? 'precisa ser ≥ ' + e.min : null;
        case 'inteiro':
            if (!Number.isInteger(v)) return 'precisa ser inteiro';
            return e.min !== undefined && v < e.min ? 'precisa ser ≥ ' + e.min : null;
        case 'dia': return typeof v === 'string' && U.diaValido(v) ? null : 'precisa ser dia AAAA-MM-DD';
        case 'bool': return typeof v === 'boolean' ? null : 'precisa ser true/false';
        case 'enum': return e.valores.indexOf(v) >= 0 ? null : 'valor fora da lista (' + e.valores.join(', ') + ')';
        case 'lista':
            if (!Array.isArray(v)) return 'precisa ser lista';
            return e.min !== undefined && v.length < e.min ? 'precisa ter pelo menos ' + e.min : null;
        case 'objeto': return typeof v === 'object' && !Array.isArray(v) ? null : 'precisa ser objeto';
        default: return null;
        }
    }

    /** Lista de erros ('pedido.itens[0].qtd: precisa ser inteiro') — vazia quando o objeto está certo. */
    function validar(entidade, obj, prefixo) {
        const esq = ESQUEMAS[entidade];
        if (!esq) throw new Error('entidade desconhecida: ' + entidade);
        const nome = prefixo || entidade, erros = [];
        if (!obj || typeof obj !== 'object') return [nome + ': precisa ser objeto'];
        Object.keys(esq).forEach(k => {
            const e = esq[k], v = obj[k], err = erroCampo(e, v);
            if (err) { erros.push(nome + '.' + k + ': ' + err); return; }
            if (e.t === 'lista' && e.item && Array.isArray(v)) v.forEach((x, i) => { erros.push.apply(erros, validar(e.item, x, nome + '.' + k + '[' + i + ']')); });
        });
        if (entidade === 'custo_sku' && !obj.componentes.length && obj.custo === null) erros.push(nome + ': precisa de custo ou de componentes (kit)');
        if (entidade === 'custo_sku') (obj.componentes || []).forEach((c, i) => {
            if (!c || typeof c.sku !== 'string' || !c.sku || !Number.isInteger(c.qtd) || c.qtd < 1) erros.push(nome + '.componentes[' + i + ']: precisa de {sku, qtd ≥ 1}');
        });
        if (entidade === 'ads' && !obj.dia && !(obj.periodo_de && obj.periodo_ate)) erros.push(nome + ': precisa de dia ou de periodo_de/periodo_ate');
        return erros;
    }

    /** Fábrica: normaliza (dinheiro em centavos, dia em AAAA-MM-DD, padrões) sem validar. */
    function criar(entidade, dados) {
        const esq = ESQUEMAS[entidade];
        if (!esq) throw new Error('entidade desconhecida: ' + entidade);
        return normaliza(esq, dados || {});
    }
    /** Fábrica que valida: devolve o objeto ou lança Error com todos os erros. */
    function garantir(entidade, dados) {
        const o = criar(entidade, dados), erros = validar(entidade, o);
        if (erros.length) { const e = new Error(erros.join('; ')); e.erros = erros; throw e; }
        return o;
    }

    // ── "Não lido": leitura que falhou nunca vira zero ──
    function naoLido(motivo, extra) { return Object.assign({ nao_lido: true, motivo: String(motivo || 'leitura falhou') }, extra || {}); }
    const ehNaoLido = x => !!(x && typeof x === 'object' && x.nao_lido === true);

    const fabricas = {};
    Object.keys(ESQUEMAS).forEach(k => { fabricas[k] = d => criar(k, d); });

    return Object.assign({ CANAIS, FONTES, FONTES_CUSTO, TIPOS_TARIFA, STATUS_PEDIDO, STATUS_REPASSE, LOGISTICAS, ORIGENS_PAGAMENTO, DIRECOES,
        ESQUEMAS, criar, garantir, validar, naoLido, ehNaoLido }, fabricas);
});
