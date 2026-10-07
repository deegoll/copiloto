// Copiloto · TikTok Shop — roda no MUNDO DA PÁGINA (world MAIN, document_start) de https://seller-br.tiktok.com, só depois que a
// seller liga o TikTok (permissão opcional; registrado por SHC.tt.sincronizarScripts).
// LEITURA PASSIVA: embrulha o fetch e o XMLHttpRequest da própria página. A chamada original acontece igual, com os mesmos argumentos,
// e a página recebe a mesma resposta. O Copiloto só lê uma CÓPIA (response.clone() / o texto do XHR no loadend) das rotas da lista
// fechada abaixo, cada uma só no método que a própria tela usa. Ele NUNCA cria uma requisição, nunca navega e nunca altera a página.
// Das telas de 03/10/2026 só sai da página uma lista fechada de CAMPOS por rota (valores, datas, status, ids, SKU, nome do produto e
// as chaves da tela); o resto da resposta fica aqui. Depois ainda sai tudo que tem nome de campo do comprador (2ª barreira, abaixo).
// Quando a resposta não diz de qual pedido é, lê do pedido que a TELA mandou só os ids listados na rota (nada mais do corpo).
// 3.3.0 (E7): a cópia vai ao tiktok-tela.js só pela porta PRIVADA que ele entrega (MessageChannel), nunca pelo postMessage da janela.
// Até a porta chegar, as respostas esperam numa fila curta (as 20 últimas).
// Qualquer erro aqui dentro: o embrulho sai do caminho e a tela segue normal.
(function (w) {
    'use strict';
    const MARCA = Symbol.for('copiloto.tiktok');
    if (!w || w[MARCA]) return;

    // ── O que PODE sair de cada resposta: 1 = valor simples · D = dinheiro · {campo: forma} (lista = cada item) · '*' = qualquer campo · 0 = a forma do pai (árvore) ──
    const D = 'din', DIN = { amount: 1, format_price: 1 };
    const ARV = { item_id: 1, amount: D, item_express: { name: { starling_key: 1 } }, sub_item_list: 0 };   // detalhamento da liquidação: só id, valor e chave
    const SKU_FIN = { sku_id: 1, product_name: 1, sku_name: 1, quantity: 1, simple_breakdown: ARV, sku_total_net_amount: D, sku_total_onhold_net_amount: D };
    const SUB = { id: 1, title: 1, language_field_map: { 'pt-BR': { campaign_name: 1 } }, has_joined: 1, play_type: 1, registration_end_time: 1, launch_begin_time: 1, launch_end_time: 1,
        benefits: { benefit_type: 1, discount_percentage: { range_value: { min: 1, max: 1 } } } };
    const FAIXA = { lowest_price: D, highest_price: D }, SKU_PROD = { id: 1, seller_sku: 1, base_price: { sale_price: 1 } };

    // ── O que se lê do pedido que a TELA fez (corpo ou consulta): só ids/códigos de até 25 dígitos ──
    const ids = (o, campos) => { const x = {}; campos.forEach(c => { const v = o && o[c]; if ((typeof v === 'string' || typeof v === 'number') && /^\d{1,25}$/.test(String(v))) x[c] = String(v); }); return x; };
    const doCorpo = campos => c => ids(c, campos);
    const daConsulta = campo => (c, q) => ids({ [campo]: q.get(campo) }, [campo]);
    const abaDasDevolucoes = c => ids({ tab: (((c.search_condition || {}).tab || {}).str_value_list || [])[0] }, ['tab']);

    // Lista FECHADA (PLANO-3.3.0, E6): [tipo, método, caminho, campos que PODEM sair, o que se lê do pedido da tela].
    // Fora dela nada é lido: nem pagamentos (payout/…: dados bancários), nem exportação de arquivos, saque, faturas, mensagens ou o detalhe do pedido.
    const ROTAS = [
        // GET de 29–30/09: a tela nova quase não chama mais; ficam para a paridade (sem forma: sai tudo menos os campos do comprador)
        ['pedidos_fin', 'GET', '/api/v1/pay/statement/order/list'],
        ['transacao', 'GET', '/api/v1/pay/statement/transaction/detail'],
        ['extratos', 'GET', '/api/v1/pay/statement/list/detail'],
        ['areceber', 'GET', '/api/v1/pay/statement/stat/info'],
        ['saldo', 'GET', '/api/v1/pay/settlement/balance/get'],
        ['saude_perf', 'GET', '/api/v1/seller/growth_center/performance/list'],
        ['saude_prazo', 'GET', '/api/v1/seller/growth_center/dynamic_settlement/get'],
        ['saude_viol', 'GET', '/api/v1/seller/growth_center/violation/overview/get'],
        ['afil', 'GET', '/api/v1/affiliate/backend/homepage/todo_dashboard/get'],
        ['camp_rec', 'GET', '/api/v1/promotion/campaign/seller/recommend_campaign/list'],
        // Telas de 03/10/2026 (MAPEAMENTO-TIKTOK.md §13)
        ['demonstrativos', 'POST', '/api/oec/pay/merchant/statement/view/statements', { total_count: 1, statement_records: { statement_id: 1, statement_date: 1, payment_order_id: 1, payment_status: 1,
            total_record: 1, total_net_amount: D, net_amount_exclude_reserve: D, reserve_amount: D, simple_breakdown: ARV } }],
        ['pedidos_liq', 'POST', '/api/oec/pay/merchant/statement/view/settled_orders', { total_count: 1, order_records: { trade_order_id: 1, expression_order_id: 1, fund_order_id: 1, placed_time: 1,
            settled_status: 1, settlement_date: 1, statement_date: 1, statement_id: 1, payment_id: 1, payment_status: 1, total_net_amount: D, simple_breakdown: ARV, sku_records: SKU_FIN } },
            doCorpo(['expression_order_id'])],
        ['pedidos_espera', 'POST', '/api/oec/pay/merchant/statement/view/onhold_orders', { total_count: 1, sum_total_amount: D, order_records: { trade_order_id: 1, expression_order_id: 1,
            order_create_time: 1, estimate_settle_time: 1, to_settle_reason: 1, total_onhold_net_amount: D, simple_breakdown: ARV, sku_records: SKU_FIN } }],
        ['detalhe', 'POST', '/api/oec/pay/merchant/statement/view/order_breakdown', { breakdown_info: ARV, trade_order_id: 1, fund_order_id: 1, order_create_time: 1, order_delivery_time: 1,
            estimate_settle_time: 1, payment_id: 1, settlement_date: 1, statement_date: 1, statement_id: 1, to_settle_reason: 1, total_net_amount: D, transaction_status: 1 },
            doCorpo(['trade_order_id', 'fund_order_id', 'settle_status'])],
        ['resumo_fin', 'POST', '/api/oec/pay/merchant/statement/view/amount_summary', { to_settle_amount: D, payout_success_amount: D, payout_in_progress_amount: D, base_account_balance: D, negative_balance_amount: D }],
        ['saude_ind', 'POST', '/api/v1/seller/growth_center/shop/metrics_module/query', { metric_groups: { metrics: { feature_code: 1, value: 1, target_value: 1, operator: 1, start_time: 1, end_time: 1, violation_count: 1 } } }],
        ['saude_sps', 'GET', '/api/v1/seller/experience-score/score-overview', { overview: { totalValidOrderCnt: 1, totalDeliveredOrderCnt: 1 }, metric: { metricGroups: { code: 1, groupName: 1, score: 1 } },
            benefitModule: { benefitList: { title: 1, Threshold: 1 } } }],
        // devoluções: só os contadores e o biz_data de cada linha; o cartão da tela (card.blocks, starling_keys) traz o texto do cliente e fica na página
        ['devolucoes', 'POST', '/api/v1/reverse/component/orders/list', { total_count: 1, search_component_overview: { '*': { order_count: 1 } },
            cards: { biz_data: { main_order_id: 1, reverse_main_order_id: 1, return_price: 1, reverseType: 1 } } }, abaDasDevolucoes],
        ['devolucoes_painel', 'POST', '/api/v1/reverse/dashboard/get', { dashboard_columns: { column_id: 1, order_count: 1 } }],
        ['camp_mgt', 'POST', '/api/v1/promotion/campaign/seller/mgt/list_registered/type_campaigns', { amount: 1, campaign_infos: { campaign_info: SUB,
            stat: { approved_count: 1, registered_count: 1, under_review_count: 1, rejected_count: 1 }, registration_infos: { approval_info: { status: 1 } } } }],
        ['camp_abertas', 'POST', '/api/v1/promotion/campaign/seller/parents_campaigns/list', { total_count: 1, campaigns_list: { campaign_info: { campaign_id: 1, language_field_map: { 'pt-BR': { campaign_name: 1 } } },
            com_campaigns_list: SUB } }, doCorpo(['campaign_id'])],
        ['camp_detalhe', 'GET', '/api/v1/promotion/campaign/seller/get', { registration_criteria: { registration_criteria_desc: { criteria_desc_detail: { desc_param: { param_key: 1, param_value: 1 }, product_tier: 1 } } } },
            daConsulta('sub_campaign_id')],
        ['camp_produtos', 'POST', '/api/v1/promotion/campaign/seller/recommend/list_product', { total_count: 1, info: { recommend_product_info: { product_id: 1, product_name: 1, sale_price_range: FAIXA, campaign_price_range: FAIXA } } },
            doCorpo(['campaign_id'])],
        ['camp_convites', 'POST', '/api/v1/promotion/campaign/seller/register_task/campaign/list', { total: 1, campaign_infos: { com_campaign_info: SUB, product_info: { product_id: 1, product_name: 1 } } }],
        // lista de Pedidos: só o nº do pedido, a hora do pagamento e, de cada SKU, sku_id, SKU do vendedor e quantidade. A mesma resposta traz
        // comprador (apelido, CPF), rastreio, observações e o nome do criador: nada disso sai da página.
        ['pedidos', 'POST', '/api/fulfillment/order/list', { total_count: 1, has_more: 1, main_orders: { main_order_id: 1, trade_order_module: { payment_time: 1 }, sku_module: { sku_id: 1, seller_sku_name: 1, quantity: 1 } } }],
        // Página inicial: só o contador "Mensagens não lidas de clientes" (os outros cartões e o chat ficam na página)
        ['tarefas', 'GET', '/api/v1/seller/home_task/get', d => ({ home_cards: (d && Array.isArray(d.home_cards) ? d.home_cards : [])
            .filter(c => c && c.card_title === 'home_task_unread_buyer_message_title').map(c => so(c, { card_title: 1, card_value: 1 }, 0)) })],
        // produtos: id, SKU do vendedor, preço do anúncio e a comissão de afiliado. Nunca o estoque por armazém (tem endereço)
        ['produtos', 'GET', '/api/v1/product/local/products/list', { total_product_count: 1, products: { product_id: 1, total_sku_count: 1, skus: SKU_PROD, commission_plan_info: { commission_rate: 1 } } }],
        ['produtos_skus', 'GET', '/api/v1/product/local/product/skus/list', SKU_PROD, daConsulta('product_id')],
    ];
    // Campo do comprador/entrega (em qualquer nível) nunca sai da página. product_name, sku_name e seller_sku_name passam.
    // Também cliente/usuário (customer*, user_id/user_info/username), documento (cnpj, tax_id, id_number, document) e recado (remark, note).
    const DO_COMPRADOR = /^(buyer|recipient|receiver|consignee|contact|tracking|provider|customer)|phone|mobile|e_?mail|address|endereco|cpf|cnpj|zipcode|zip_code|postal|nickname|avatar|user_?name|user_?(id|info)|full_name|first_name|last_name|tax_?(id|num|no|code)|taxpayer|document|id_?number|id_?card|remark|(^|_)notes?($|_)/i;

    const url = u => { try { return new URL(String(u), w.location.href); } catch (e) { return null; } };
    const idLoja = u => { const v = u && u.searchParams.get('oec_seller_id'); return v && /^\d{5,25}$/.test(v) ? v : ''; };
    let conta = idLoja(url(w.location.href));
    /** A rota da lista fechada (caminho exato E o método dela) ou null — só do próprio TikTok. Toda URL vista serve para saber a loja (oec_seller_id). */
    function rotaDe(u, metodo) {
        const x = url(u);
        if (!x || !/(^|\.)tiktok\.com$/.test(x.hostname)) return null;
        conta = idLoja(x) || conta;
        const r = ROTAS.find(r => r[1] === metodo && (x.pathname === r[2] || x.pathname === r[2] + '/'));
        // O Resumo financeiro de 03/10 usa o order/list de antes para a lista de RETENÇÃO (is_reserve_unreleased): não é a lista de pedidos, não é lida.
        if (r && r[0] === 'pedidos_fin' && x.searchParams.get('is_reserve_unreleased') === 'true') return null;
        return r ? { r, x } : null;
    }
    const tipoDe = (u, metodo) => { const a = rotaDe(u, String(metodo || 'GET').toUpperCase()); return a ? a.r[0] : ''; };
    /** Só o que está na forma sai (o resto da resposta fica na página). */
    function so(v, f, nivel) {
        if (v === undefined || nivel > 40) return undefined;
        if (v === null) return f === 1 || f === D ? null : undefined;   // null da tela (ex.: total_count: null da lista vazia) sai como null
        if (Array.isArray(v)) return v.map(x => so(x, f, nivel + 1)).filter(x => x !== undefined);
        if (typeof v !== 'object') return f === 1 || f === D ? v : undefined;
        if (f === D) return so(v, DIN, nivel);
        if (!f || typeof f !== 'object') return undefined;
        const o = {};
        (f['*'] ? Object.keys(v) : Object.keys(f)).forEach(c => { const x = so(v[c], f['*'] || (f[c] === 0 ? f : f[c]), nivel + 1); if (x !== undefined) o[c] = x; });
        return o;
    }
    function limpa(v, nivel) {
        if (nivel > 40 || v === null || typeof v !== 'object') return v;
        if (Array.isArray(v)) return v.map(x => limpa(x, nivel + 1));
        const o = {};
        Object.keys(v).forEach(c => { if (!DO_COMPRADOR.test(c)) o[c] = limpa(v[c], nivel + 1); });
        return o;
    }
    /** Do pedido que a TELA fez (corpo em texto ou a consulta da URL), só os ids que a rota lista. */
    function pedidoDe(a, corpo) {
        if (!a.r[4]) return null;
        let c = null;
        if (typeof corpo === 'string' && corpo.length < 20000) { try { c = JSON.parse(corpo); } catch (e) { c = null; } }
        const p = a.r[4](c && typeof c === 'object' ? c : {}, a.x.searchParams);
        return p && Object.keys(p).length ? p : null;
    }
    function envia(a, j, pedido) {
        if (!j || typeof j !== 'object') return;
        const f = a.r[3], dados = f ? { code: j.code, data: typeof f === 'function' ? f(j.data) : so(j.data, f, 0) } : j;
        const msg = { copiloto_tt: 1, tipo: a.r[0], conta: conta || 'tiktok', dados: limpa(dados, 0) };
        if (pedido) msg.pedido = pedido;
        if (porta) porta.postMessage(msg);
        else { fila.push(msg); if (fila.length > 20) fila.shift(); }
    }
    const quieto = f => { try { f(); } catch (e) { /* a página segue normal */ } };

    // Aperto de mão: a 1ª porta que o tiktok-tela.js oferece vale; ela leva o "olá" e o que esperava na fila. Se ele veio antes, pede outra.
    let porta = null;
    const fila = [];
    quieto(() => {
        w.addEventListener('message', e => quieto(() => {
            if (porta || e.source !== w || e.origin !== w.location.origin || !e.data || e.data.copiloto_tt_porta !== 1 || !e.ports || !e.ports[0]) return;
            porta = e.ports[0];
            porta.postMessage({ copiloto_tt: 1, ola: 1 });
            fila.splice(0).forEach(m => porta.postMessage(m));
        }));
        w.postMessage({ copiloto_tt: 1, quer_porta: 1 }, w.location.origin);
    });

    const fetchOriginal = w.fetch;
    if (typeof fetchOriginal === 'function') {
        w.fetch = function () {
            const resposta = fetchOriginal.apply(this, arguments);
            const args = arguments;
            quieto(() => {
                const a = args[0], init = args[1] || {};
                const metodo = String(init.method || (a && typeof a === 'object' && a.method) || 'GET').toUpperCase();
                const rota = rotaDe(a && typeof a === 'object' && a.url ? a.url : a, metodo);
                if (!rota) return;
                const pedido = pedidoDe(rota, init.body);
                resposta.then(r => quieto(() => { if (r && r.ok) r.clone().json().then(j => quieto(() => envia(rota, j, pedido)), () => {}); }), () => {});
            });
            return resposta;
        };
    }

    const X = w.XMLHttpRequest && w.XMLHttpRequest.prototype;
    if (X && typeof X.open === 'function' && typeof X.send === 'function') {
        const abrir = X.open, enviar = X.send, marcados = new WeakMap();
        X.open = function (metodo, u) {
            quieto(() => { const rota = rotaDe(u, String(metodo || 'GET').toUpperCase()); if (rota) marcados.set(this, rota); else marcados.delete(this); });
            return abrir.apply(this, arguments);
        };
        X.send = function () {
            const corpo = arguments[0];
            quieto(() => {
                const rota = marcados.get(this), xhr = this;
                if (!rota) return;
                const pedido = pedidoDe(rota, corpo);
                xhr.addEventListener('loadend', () => quieto(() => {
                    if (!(xhr.status >= 200 && xhr.status < 300)) return;
                    const rt = xhr.responseType;
                    envia(rota, rt === 'json' ? xhr.response : (rt === '' || rt === 'text' ? JSON.parse(xhr.responseText) : null), pedido);
                }));
            });
            return enviar.apply(this, arguments);
        };
    }
    Object.defineProperty(w, MARCA, { value: { tipoDe, limpa, so, ROTAS }, enumerable: false });
})(typeof window !== 'undefined' ? window : null);
