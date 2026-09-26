// SellerHub Copiloto v2.2 — Agenda do Canal de transmissão (Marketing › Canal de transmissão do ML).
// Monta a agenda da janela aberta (dias úteis × horários) com os produtos em promoção que dão LUCRO e
// prepara a fila para o seller criar cada comunicação no próprio ML. Nada é criado aqui: o ml-canal.js só
// pré-preenche o formulário do ML e o seller clica em "Criar" em cada uma.
// Mapeado ao vivo em 24/09/2026 (ver MAPEAMENTO-ML.md › "Canal de transmissão"). O topo é puro (roda em node:
// tests/copiloto/teste_canal.js); a parte da tela só roda em agenda-canal.html.
(function (root) {
    'use strict';
    const SHC = root.SHC || (root.SHC = {});
    const BASE = 'https://vendedores.mercadolivre.com.br';
    const HORA_MIN = 8, HORA_MAX = 19;               // o ML aceitou horários cheios das 08:00 às 19:00
    const HORAS_PADRAO = [10, 19];                   // sem histórico
    const DIAS_JANELA = 8;                           // em 24/09 o ML aceitou até 02/10 (a confirmar ao vivo: pode mudar)
    const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const MESES = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
    SHC.CANAL_TIPOS = { channel: 'Mensagem', story: 'Story', ambos: 'Story e Canal' };

    const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const diaUTC = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
    const difDias = (a, b) => Math.round((diaUTC(a) - diaUTC(b)) / 864e5);
    const dowDe = s => new Date(diaUTC(s)).getUTCDay();
    const hh = h => String(h).padStart(2, '0') + ':00';
    SHC.canalDataCurta = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s.slice(8, 10) + '/' + s.slice(5, 7) : '';
    /** "Quinta 25/09 às 19:00" */
    SHC.canalQuando = (dia, hora) => DIAS_SEMANA[dowDe(dia)] + ' ' + SHC.canalDataCurta(dia) + ' às ' + hh(hora);

    // Percorre objetos do estado do ML (sem ciclos, com limite de nós). f(o) === false não desce naquele nó.
    function anda(r, f) {
        const pilha = [r], visto = new Set();
        for (let n = 0; pilha.length && n < 200000; n++) {
            const o = pilha.pop();
            if (!o || typeof o !== 'object' || visto.has(o)) continue;
            visto.add(o);
            if (!Array.isArray(o) && f(o) === false) continue;
            const ks = Object.keys(o);
            for (let i = ks.length - 1; i >= 0; i--) if (o[ks[i]] && typeof o[ks[i]] === 'object') pilha.push(o[ks[i]]);
        }
    }
    // Primeiro texto sob a chave k (até 4 níveis): cell.text, cell.value.text, …
    function achaTxt(o, k, prof) {
        if (!o || typeof o !== 'object' || (prof || 0) > 4) return '';
        if (typeof o[k] === 'string' || typeof o[k] === 'number') return String(o[k]);
        for (const x in o) { const v = achaTxt(o[x], k, (prof || 0) + 1); if (v) return v; }
        return '';
    }
    const texto = v => typeof v === 'string' ? v : (v && typeof v === 'object' ? (achaTxt(v, 'text') || achaTxt(v, 'label') || achaTxt(v, 'title')) : '');

    // ── 1. Leitura (funções puras sobre o estado _n.ctx.r / JSON do ML) ────────────────────────

    const ID_CANAL = /^[A-Za-z0-9_-]{20,120}$/;
    /** Canais (storefronts) da conta → [{id, nome}]. Lê o estado e, de reforço, os links storefront_id= do HTML. */
    SHC.canalCanais = function (r, html) {
        const out = new Map();
        const add = (id, nome) => {
            id = String(id || '');
            if (!ID_CANAL.test(id)) return;
            nome = texto(nome).replace(/\s+/g, ' ').trim().slice(0, 80);
            if (!out.has(id) || (!out.get(id).nome && nome)) out.set(id, { id, nome });
        };
        anda(r, o => {
            if (o.storefront && typeof o.storefront === 'object' && o.storefront.id) add(o.storefront.id, o.storefront.name);
            ['storefront_id', 'storefrontId'].forEach(k => { if (typeof o[k] === 'string') add(o[k], o.name || o.title); });
            for (const k in o) {
                if (typeof o[k] !== 'string') continue;
                const m = /storefront_?id=([A-Za-z0-9_-]{20,120})/i.exec(o[k]);
                if (m) add(m[1], o.title || o.name || o.label || o.text);   // nome do card: a confirmar ao vivo
            }
        });
        const re = /storefront_?id=([A-Za-z0-9_-]{20,120})/gi;
        let m;
        while (html && (m = re.exec(html))) add(m[1], '');
        return [...out.values()];
    };

    /**
     * Confirmado ao vivo em 25/09/2026: conta sem canal → a lista responde HTTP 302 SEM Location (o fetch devolve status 302)
     * com a página de erro "Tivemos um problema" e pageProps.status === 302. http = status da resposta (0/undefined = não se sabe).
     * canalMLFora: resposta ≥ 500, ou página de erro do ML sem o 302 → "o ML não respondeu" (nunca "não tem canal").
     * canalSemCanal: SÓ o 302 (resposta ou pageProps.status) → aviso da "Minha página", não erro. Lista lida sem nenhum canal
     * e sem o 302 (tela mudada, 4xx, HTML sem estado) → erro 'nao_lido' (CANAL_NAO_LIDO), nunca "não tem canal".
     */
    const statusDe = r => +((r && r.appProps && r.appProps.pageProps && r.appProps.pageProps.status) || 0);
    SHC.canalMLFora = function (r, http) {
        const pp = r && r.appProps && r.appProps.pageProps, st = statusDe(r);
        const paginaErro = !!(pp && pp.errorMessage) || /tivemos um problema/i.test((r && r.title) || '');
        return http >= 500 || st >= 500 || (paginaErro && http !== 302 && st !== 302);
    };
    SHC.canalSemCanal = function (r, canais, http) {
        if (SHC.canalMLFora(r, http)) return false;
        return http === 302 || statusDe(r) === 302;
    };
    SHC.CANAL_SEM_CANAL = 'Esta conta não tem Canal de transmissão. Ele precisa da \'Minha página\' ativa no Mercado Livre.';
    SHC.CANAL_ML_FORA = 'O Mercado Livre não respondeu, tente de novo em alguns minutos ("Ler de novo do ML").';
    SHC.CANAL_NAO_LIDO = 'Não consegui ler os seus canais no Mercado Livre, tente de novo em alguns minutos ("Ler de novo do ML").';
    /** Lucro mínimo inicial da Agenda = a meta do seller (Seus números); sem meta gravada, a padrão. */
    SHC.canalMetaInicial = cfg => { const v = SHC.num((cfg || {}).margem_alvo_pct); return v !== null && v >= 0 ? v : SHC.PADRAO.margem_alvo_pct; };
    SHC.CANAL_URL_MINHA_PAGINA = BASE + '/minha-pagina/resumo';

    // "Terça-feira, 3/fev/2026," + "16:00 h" → { dia:'2026-02-03', hora:16 }
    SHC.canalDataHora = function (txt, desc) {
        const m = /(\d{1,2})\/([a-zç]{3})[a-zç]*\.?\/(\d{4})/i.exec(String(txt || ''));
        const h = /(\d{1,2}):\d{2}/.exec(String(desc || '') + ' ' + String(txt || ''));
        const mes = m && MESES[m[2].toLowerCase()];
        return {
            dia: mes ? m[3] + '-' + String(mes).padStart(2, '0') + '-' + m[1].padStart(2, '0') : '',
            hora: h ? +h[1] : null,
        };
    };

    function lerCampanha(c, tipo) {
        if (!c || !Array.isArray(c.cells)) return null;
        const cel = id => c.cells.find(x => x && x.id === id) || {};
        const n = id => { const v = SHC.num(texto(cel(id).text !== undefined ? cel(id).text : cel(id))); return v === null ? null : v; };
        const tit = cel('title'), dt = cel('date'), st = cel('status');
        const quando = SHC.canalDataHora(texto(dt.text !== undefined ? dt.text : dt), texto(dt.description));
        const mlb = /MLB-?(\d{6,14})/.exec(JSON.stringify(c));      // produto da campanha: a confirmar ao vivo
        const statusTxt = texto(st.title) || texto(st);
        return {
            id: String(c.id || ''), tipo, campanha: String(c.campaign_type || ''),
            conteudo: texto(tit.header).slice(0, 60), nome: texto(tit.title).slice(0, 80),
            dia: quando.dia, hora: quando.hora, status: statusTxt.slice(0, 30),
            enviada: /enviad/i.test(statusTxt) || st.status === 'success',
            itemId: mlb ? 'MLB' + mlb[1] : '',
            envios: n('sent'), vistas: n('views'), cliques: n('clicks'), ctr: n('ctr'),
            vendas: n('sales-units'), valor: n('sales-amount'),
        };
    }
    /**
     * Histórico → [{id, tipo:'channel'|'story', nome, dia, hora, enviada, itemId, envios, cliques, ctr, vendas, valor}].
     * Estado da página do canal: nós properties.campaigns (1º = mensagens, 2º = stories).
     * JSON da API campaigns?offset=…: qualquer objeto com cells[] (tipo = o communication_type pedido).
     */
    SHC.canalCampanhas = function (r, tipoPadrao) {
        const listas = [], soltas = [];
        anda(r, o => {
            if (o.properties && Array.isArray(o.properties.campaigns)) { listas.push(o.properties.campaigns); return false; }
            if (Array.isArray(o.cells)) { soltas.push(o); return false; }
        });
        const pares = listas.length
            ? listas.flatMap((l, i) => l.map(c => [c, i === 0 ? 'channel' : 'story']))
            : soltas.map(c => [c, tipoPadrao || 'channel']);
        return pares.map(p => lerCampanha(p[0], p[1])).filter(Boolean);
    };

    /** Produtos que podem ser comunicados (lista-produtos-promocao) → [{itemId, titulo, …, elegivel, motivo}]. */
    SHC.canalProdutos = function (r) {
        const out = [], visto = new Set();
        anda(r, o => {
            if (!o.itemId || o.cardInfo === undefined) return;
            const id = String(o.itemId).replace(/[^A-Z0-9]/gi, '').toUpperCase();
            if (!/^MLB\d{6,14}$/.test(id) || visto.has(id)) return false;
            visto.add(id);
            const ci = o.cardInfo || {}, promo = texto(o.promotions);
            out.push({
                itemId: id, titulo: texto(o.title).slice(0, 120), promocoes: promo.slice(0, 60),
                ativa: /ativa/i.test(promo), agendada: /agendad/i.test(promo),
                unidades: SHC.num(typeof o.availableUnits === 'number' ? o.availableUnits : texto(o.availableUnits)), foto: /^https:\/\//.test(o.thumbnailUrl || '') ? o.thumbnailUrl : '',
                elegivel: !ci.disabled, recomendado: !!ci.recommended, motivo: texto(ci.reason).slice(0, 200),
            });
            return false;
        });
        return out;
    };

    /**
     * Preço da promoção numa data (promotions-info) → número ou null. Formato da resposta: a confirmar ao vivo.
     * Só chaves explícitas de preço final: 'price' solto pode ser o preço CHEIO, então nunca é usado (sem chave → null).
     */
    SHC.canalPrecoPromo = function (j) {
        const val = v => {
            if (v && typeof v === 'object' && v.fraction !== undefined) return SHC.num(String(v.fraction) + ',' + String(v.cents === undefined || v.cents === null ? '' : v.cents).padStart(2, '0'));
            if (v && typeof v === 'object') return val(v.value !== undefined ? v.value : v.amount);
            const n = SHC.num(typeof v === 'string' ? v.replace(/[^\d,.-]/g, '') : v);
            return n > 0 ? n : null;
        };
        for (const k of ['final_price', 'finalPrice', 'promotion_price', 'promotionPrice', 'deal_price', 'dealPrice', 'sale_price', 'salePrice']) {
            let achou = null;
            anda(j, o => { if (achou === null && o[k] !== undefined) achou = val(o[k]); if (achou !== null) return false; });
            if (achou !== null) return achou;
        }
        return null;
    };

    // ── 2. Plano (puro) ──────────────────────────────────────────────────────────────────────

    SHC.canalUltimoDiaPadrao = (agora, dias) => { const d = new Date(agora); d.setDate(d.getDate() + (dias || DIAS_JANELA)); return iso(d); };

    /**
     * Janela: dias úteis de hoje até ultimoDia, cada um com os horários pedidos (08–19).
     * Hoje só vale hora cheia DEPOIS da hora atual (antecedência mínima do ML: a confirmar ao vivo).
     * → [{dia, dow, horas:[…]}]
     */
    SHC.canalJanela = function (agora, ultimoDia, horas) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ultimoDia || '')) ultimoDia = SHC.canalUltimoDiaPadrao(agora, DIAS_JANELA);
        const hs = [...new Set((horas || []).map(Number))].filter(h => h >= HORA_MIN && h <= HORA_MAX).sort((a, b) => a - b);
        const out = [], hoje = iso(agora);
        for (let i = 0; i < 31; i++) {
            const d = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + i), dia = iso(d);
            if (dia > ultimoDia) break;
            if (d.getDay() === 0 || d.getDay() === 6) continue;
            const h = dia === hoje ? hs.filter(x => x > agora.getHours()) : hs;
            if (h.length) out.push({ dia, dow: d.getDay(), horas: h });
        }
        return out;
    };

    /**
     * Melhores horários pelo histórico: por hora (e por dia da semana), vendas por envio e CTR médio,
     * cada um normalizado pelo maior; nota = soma. Menos de 3 envios com números → 10:00 e 19:00.
     * → { horas:[…n], fonte:'historico'|'padrao', base, porHora:[{hora, envios, ctr, vendas, nota}], porDia:[{dow, …}] }
     */
    SHC.canalMelhoresHorarios = function (campanhas, n) {
        n = n || 2;
        const boas = (campanhas || []).filter(c => c && c.enviada && c.hora >= HORA_MIN && c.hora <= HORA_MAX && (c.ctr !== null || c.vendas !== null));
        const agrupa = chave => {
            const g = {};
            boas.forEach(c => {
                const k = chave(c); if (k === null || k === undefined || Number.isNaN(k)) return;
                const x = g[k] || (g[k] = { k, envios: 0, ctr: 0, vendas: 0 });
                x.envios++; x.ctr += c.ctr || 0; x.vendas += c.vendas || 0;
            });
            const l = Object.values(g).map(x => ({ k: x.k, envios: x.envios, ctr: x.ctr / x.envios, vendas: x.vendas / x.envios }));
            const mc = Math.max(0, ...l.map(x => x.ctr)) || 1, mv = Math.max(0, ...l.map(x => x.vendas)) || 1;
            l.forEach(x => { x.nota = x.vendas / mv + x.ctr / mc; });
            return l.sort((a, b) => b.nota - a.nota || b.envios - a.envios);
        };
        const porHora = agrupa(c => c.hora).map(x => ({ hora: +x.k, envios: x.envios, ctr: x.ctr, vendas: x.vendas, nota: x.nota }));
        const porDia = agrupa(c => c.dia ? dowDe(c.dia) : null).map(x => ({ dow: +x.k, envios: x.envios, ctr: x.ctr, vendas: x.vendas, nota: x.nota }));
        if (boas.length < 3) return { horas: HORAS_PADRAO.slice(0, Math.max(n, 2)), fonte: 'padrao', base: boas.length, porHora, porDia };
        return { horas: porHora.slice(0, n).map(x => x.hora), fonte: 'historico', base: boas.length, porHora, porDia };
    };

    /** Último dia em que cada produto já foi comunicado (campanhas com itemId) → { MLB…: 'AAAA-MM-DD' }. */
    SHC.canalRecentes = function (campanhas) {
        const out = {};
        (campanhas || []).forEach(c => { if (c && c.itemId && c.dia && !(out[c.itemId] >= c.dia)) out[c.itemId] = c.dia; });
        return out;
    };

    /**
     * Lucro de 1 venda no preço da promoção (estimativa). Com precoPromo (promotions-info) diferente do retrato:
     * aplica no preço novo a mesma proporção tarifa/preço do anúncio (em 2026 a tarifa é só a %, sem taxa fixa por faixa:
     * conferido no Simulador de custos, 11,63 = 17% de 68,44), tira a taxa operacional quando o comprador paga o frete
     * e mantém o frete (conservador), como SHC.sobraAtacado. Retrato abaixo de R$ 79 sem frete e promoção a
     * partir de R$ 79: o frete grátis passa a ser do seller e o ML não mostra quanto → não estima ({ sobra:null, motivo }).
     * Sem precoPromo: números do ML no retrato (item.preco já é o da promoção ativa).
     * → saída de SHC.sobraAnuncio + { preco, fonte:'promocao'|'retrato' } | { sobra:null, motivo } | null
     */
    SHC.canalLucro = function (item, custoDados, cfg, precoPromo) {
        if (!item) return null;
        const pp = SHC.num(precoPromo);
        if (pp > 0 && item.preco > 0 && typeof item.tarifa === 'number' && typeof item.frete === 'number' && Math.abs(pp - item.preco) >= 0.01) {
            if (item.preco < 79 && pp >= 79 && !(item.frete > 0)) return { sobra: null, pct: null, motivo: 'Na promoção o preço passa de R$ 79 e o frete grátis passa a ser seu: abra o anúncio no ML para ver o frete.' };
            // Achado 11: nada de taxa fixa por faixa (tabela de antes de 2026, que superestimava o lucro abaixo de R$ 79 com frete grátis).
            // A parte fixa é só a taxa operacional do ML ("Envio por conta do comprador"), mantida no preço novo.
            const op = SHC.num(item.taxaOperacional) > 0 ? SHC.num(item.taxaOperacional) : 0;
            const recebe = SHC.r2(pp - SHC.r2(pp * item.tarifa / item.preco) - op - item.frete);
            const s = SHC.sobraAnuncio({ preco: pp, recebe }, custoDados, cfg);
            return s && Object.assign(s, { preco: pp, recebe, fonte: 'promocao' });
        }
        const s = SHC.sobraAnuncio(item, custoDados, cfg);
        return s && Object.assign(s, { preco: item.preco, recebe: item.recebe, fonte: 'retrato' });
    };

    /**
     * Ranking dos produtos elegíveis. Entra só quem: está elegível, tem promoção ativa/agendada, tem estoque,
     * tem custo, dá lucro ≥ meta na promoção e não foi comunicado nos últimos N dias. Prejuízo NUNCA entra.
     * ctx = { anuncios:{MLB:item do retrato}, custos:{MLB:dados}, precos, cfg, metaPct, recentes, hoje, diasSemRepetir, dia, tentar }
     * Com ctx.dia o preço vem de precos['MLB…|AAAA-MM-DD'] (promotions-info naquele dia); sem dia, de precos['MLB…'].
     * Preço: > 0 = preço da promoção do ML; 0 = o ML não mostrou preço de promoção; -1 = a consulta falhou; ausente = não consultado.
     * Promoção só agendada precisa do preço da promoção confirmado (o retrato tem o preço cheio). ctx.tentar deixa a
     * agendada ainda não consultada entrar provisoriamente (lucro no preço cheio, que é o teto) só para ser consultada.
     * → { candidatos:[{itemId, titulo, foto, lucro, pct, fonte, motivo}], fora:[{itemId, titulo, motivo}] }
     */
    SHC.canalRanking = function (produtos, ctx) {
        const cfg = Object.assign({}, SHC.PADRAO, ctx.cfg || {});
        const meta = SHC.num(ctx.metaPct) !== null ? SHC.num(ctx.metaPct) : (SHC.num(cfg.margem_alvo_pct) || 0);
        const n = Math.max(1, SHC.num(ctx.diasSemRepetir) || 1);
        const candidatos = [], fora = [];
        (produtos || []).forEach(p => {
            const sai = motivo => fora.push({ itemId: p.itemId, titulo: p.titulo, motivo });
            if (!p.elegivel) return sai('O ML não deixa comunicar' + (p.motivo ? ': ' + p.motivo : '.'));
            if (!p.ativa && !p.agendada) return sai('Sem promoção ativa ou agendada.');
            if (p.unidades !== null && p.unidades !== undefined && p.unidades <= 0) return sai('Sem estoque.');
            const ult = (ctx.recentes || {})[p.itemId];
            if (ult && ctx.hoje && difDias(ctx.hoje, ult) < n) return sai('Já comunicado em ' + SHC.canalDataCurta(ult) + '.');
            const item = (ctx.anuncios || {})[p.itemId];
            if (!item) return sai('O Copiloto ainda não leu este anúncio: abra a lista de Anúncios do ML.');
            const pp = (ctx.precos || {})[ctx.dia ? p.itemId + '|' + ctx.dia : p.itemId];
            const cheio = item.precoCheio > 0 ? item.precoCheio : (p.ativa ? 0 : item.preco);
            const naData = ctx.dia ? ' em ' + SHC.canalDataCurta(ctx.dia) : '';
            // Preço igual ao cheio = sem promoção naquela data (o que o promotions-info devolve fora da vigência: a confirmar ao vivo).
            if (pp === 0 || (pp > 0 && cheio > 0 && pp >= cheio - 0.005)) return sai('O ML não mostrou preço de promoção' + naData + '.');
            if (!(pp > 0) && !p.ativa && !(ctx.tentar && pp === undefined)) return sai('Promoção agendada: preço da promoção ainda não confirmado' + naData + '.');
            const s = SHC.canalLucro(item, (ctx.custos || {})[p.itemId], cfg, pp > 0 ? pp : null);
            if (!s) return sai('O ML não mostrou o preço ou o "você recebe" deste anúncio: abra a lista de Anúncios do ML.');
            if (s.motivo) return sai(s.motivo);
            if (s.sobra === null) return sai('Falta o custo deste produto.');
            if (s.sobra < 0) return sai('Dá prejuízo na promoção: ' + SHC.moeda(s.sobra) + ' por venda.');
            if (s.pct < meta) return sai('Lucro abaixo da sua meta: ' + SHC.moeda(s.sobra) + ' (' + SHC.pctTxt(s.pct) + ').');
            candidatos.push({
                itemId: p.itemId, titulo: p.titulo || item.titulo || p.itemId, foto: p.foto || '', recomendado: p.recomendado,
                lucro: s.sobra, pct: s.pct, preco: s.preco, fonte: s.fonte, unidades: p.unidades,
                motivo: 'Lucro estimado de ' + SHC.moeda(s.sobra) + ' (' + SHC.pctTxt(s.pct) + ') no preço de ' + SHC.moeda(s.preco)
                    + (p.agendada && !p.ativa ? ' (promoção agendada)' : '') + (p.unidades > 0 ? ' · ' + p.unidades + ' em estoque' : ''),
            });
        });
        candidatos.sort((a, b) => b.lucro - a.lucro || (b.recomendado ? 1 : 0) - (a.recomendado ? 1 : 0));
        return { candidatos, fora };
    };

    const ORDEM_TIPO = { channel: 0, story: 1, ambos: 2 };
    const ordena = plano => plano.sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : a.hora - b.hora || ORDEM_TIPO[a.tipo] - ORDEM_TIPO[b.tipo]));
    const slotId = (dia, hora, tipo) => dia + '|' + hora + '|' + tipo;
    // O produto c pode ir no dia `dia`? Nenhum outro cartão com ele a menos de N dias (ignora o próprio cartão).
    const cabe = (plano, c, dia, n, ignora) => !plano.some(s => s !== ignora && s.itemId === c.itemId && Math.abs(difDias(s.dia, dia)) < n);
    const poe = (s, c) => Object.assign(s, { itemId: c.itemId, titulo: c.titulo, foto: c.foto, lucro: c.lucro, pct: c.pct, fonte: c.fonte, motivo: c.motivo });
    // candidatos: lista única ou função dia → lista (ranking com o preço da promoção de cada dia).
    const lista = (cands, dia) => (typeof cands === 'function' ? cands(dia) : cands) || [];
    const vazio = (s, algum) => Object.assign(s, { itemId: '', titulo: '', foto: '', lucro: null, pct: null, fonte: '',
        motivo: algum ? 'Nenhum produto livre neste dia (todos já usados há menos dos dias escolhidos).' : 'Nenhum produto com promoção e lucro neste dia.' });

    // Preenche os cartões vazios em ordem de data, com o melhor produto do dia que ainda cabe.
    function preencher(plano, cands, n) {
        ordena(plano).forEach(s => {
            if (s.itemId) return;
            const l = lista(cands, s.dia), c = l.find(x => cabe(plano, x, s.dia, n, s));
            if (c) poe(s, c); else vazio(s, l.length > 0);
        });
        return plano;
    }

    /** 'Story e Canal' já cria a mensagem E o story: com ele marcado, Mensagem e Story saem (senão o seguidor recebe em dobro). */
    SHC.canalTiposValidos = tipos => (tipos || []).indexOf('ambos') >= 0 ? ['ambos'] : (tipos || []).filter(t => t === 'channel' || t === 'story');

    /**
     * Agenda inteira: janela × tipos, produtos do ranking sem repetir em menos de N dias. → [cartão]
     * fixos = cartões já criados no ML (feito): ficam como estão e ocupam o horário. Sem nenhum produto em nenhum dia
     * não cria cartão vazio (a tela explica pelo "Fora da agenda").
     */
    SHC.canalMontaPlano = function (janela, tipos, candidatos, diasSemRepetir, fixos) {
        const n = Math.max(1, SHC.num(diasSemRepetir) || 1), plano = (fixos || []).map(s => Object.assign({}, s));
        if (!(janela || []).some(j => lista(candidatos, j.dia).length)) return ordena(plano);
        const ts = SHC.canalTiposValidos(tipos);
        janela.forEach(j => j.horas.forEach(h => ts.forEach(t => {
            const id = slotId(j.dia, h, t);
            if (!plano.some(s => s.id === id)) plano.push({ id, dia: j.dia, hora: h, tipo: t, itemId: '' });
        })));
        return preencher(plano, candidatos, n);
    };

    /**
     * Confere a agenda com o ranking de cada dia: cartão (não criado) cujo produto não está mais entre os candidatos
     * daquele dia (preço da promoção do dia, prejuízo, meta) perde o produto e é preenchido de novo.
     */
    SHC.canalRevalida = function (plano, candidatos, diasSemRepetir) {
        const n = Math.max(1, SHC.num(diasSemRepetir) || 1);
        plano.forEach(s => {
            if (!s.itemId || s.feito) return;
            const c = lista(candidatos, s.dia).find(x => x.itemId === s.itemId);
            if (c) poe(s, c); else s.itemId = '';
        });
        return preencher(plano, candidatos, n);
    };

    /** Pares produto|dia da agenda (não criados) sem preço da promoção consultado → [{itemId, dia, hora}] (1 por par). */
    SHC.canalPrecosFaltando = function (plano, precos) {
        const out = new Map();
        (plano || []).forEach(s => {
            const k = s.itemId + '|' + s.dia;
            if (s.itemId && !s.feito && (precos || {})[k] === undefined && !out.has(k)) out.set(k, { itemId: s.itemId, dia: s.dia, hora: s.hora });
        });
        return [...out.values()];
    };

    /**
     * Massivo: repete o horário e o tipo do cartão `id` em todos os dias da janela (sem duplicar o que já existe).
     * Com `agora`, hoje só entra se o horário ainda não passou (o ML não aceita horário passado).
     */
    SHC.canalRepetirHorario = function (plano, id, janela, candidatos, diasSemRepetir, agora) {
        const base = plano.find(s => s.id === id);
        if (!base) return plano;
        const n = Math.max(1, SHC.num(diasSemRepetir) || 1), novo = plano.slice(), hoje = agora ? iso(agora) : '';
        (janela || []).forEach(j => {
            if (j.dia < hoje || (j.dia === hoje && base.hora <= agora.getHours())) return;
            const sid = slotId(j.dia, base.hora, base.tipo);
            if (!novo.some(s => s.id === sid)) novo.push({ id: sid, dia: j.dia, hora: base.hora, tipo: base.tipo, itemId: '' });
        });
        return preencher(novo, candidatos, n);
    };

    /**
     * Aplica o cartão `id` (mesmo produto, dia e hora) a todos os tipos marcados. Escolha do seller: não checa repetição.
     * 'Story e Canal' exclui Mensagem e Story com o mesmo produto na mesma hora (e vice-versa). Cartão criado não muda.
     */
    SHC.canalAplicarTipos = function (plano, id, tipos) {
        const base = plano.find(s => s.id === id);
        if (!base || !base.itemId || base.feito) return plano;
        const alvo = SHC.canalTiposValidos(tipos), novo = plano.slice();
        alvo.forEach(t => {
            const sid = slotId(base.dia, base.hora, t);
            let s = novo.find(x => x.id === sid);
            if (s && s.feito) return;
            if (!s) novo.push(s = { id: sid, dia: base.dia, hora: base.hora, tipo: t });
            if (s !== base) poe(s, base);
        });
        const tira = alvo.indexOf('ambos') >= 0 ? ['channel', 'story'] : ['ambos'];
        return ordena(novo.filter(s => s.feito || s.dia !== base.dia || s.hora !== base.hora || s.itemId !== base.itemId || tira.indexOf(s.tipo) < 0));
    };

    /** Troca o produto do cartão (não criado) pelo próximo do ranking do dia que cabe. */
    SHC.canalTrocarProduto = function (plano, id, cands, diasSemRepetir) {
        const s = plano.find(x => x.id === id);
        const candidatos = s ? lista(cands, s.dia) : [];
        if (!s || s.feito || !candidatos.length) return plano;
        const n = Math.max(1, SHC.num(diasSemRepetir) || 1);
        const i0 = candidatos.findIndex(c => c.itemId === s.itemId);
        for (let k = 1; k <= candidatos.length; k++) {
            const c = candidatos[(i0 + k + candidatos.length) % candidatos.length];
            if (c.itemId !== s.itemId && cabe(plano, c, s.dia, n, s)) { poe(s, c); break; }
        }
        return plano;
    };

    SHC.canalRemover = (plano, id) => plano.filter(s => s.id !== id);

    /** "12 comunicações de 24/09 a 02/10" (só cartões com produto). */
    SHC.canalResumo = function (plano) {
        const ok = (plano || []).filter(s => s.itemId);
        if (!ok.length) return 'Nenhuma comunicação na agenda';
        const dias = ok.map(s => s.dia).sort();
        return ok.length + (ok.length === 1 ? ' comunicação' : ' comunicações') + ' de ' + SHC.canalDataCurta(dias[0]) + ' a ' + SHC.canalDataCurta(dias[dias.length - 1]);
    };

    // ── 4. Execução assistida (fila) ─────────────────────────────────────────────────────────

    /** URL do formulário do ML. communicationType 'story' e 'ambos': a confirmar ao vivo. */
    SHC.canalUrlFormulario = (storefrontId, itemId, tipo) => BASE + '/marketing/canal-de-transmissao/formulario-produto-promocao?storefrontId='
        + encodeURIComponent(storefrontId) + '&itemId=' + encodeURIComponent(itemId) + '&communicationType=' + encodeURIComponent(tipo);

    /** Nome da comunicação no ML (até 60 caracteres): "25/09 19h · Bicicleta aro 29 …". */
    SHC.canalNome = s => (SHC.canalDataCurta(s.dia) + ' ' + String(s.hora).padStart(2, '0') + 'h · ' + String(s.titulo || s.itemId).replace(/\s+/g, ' ').trim()).slice(0, 60);

    /**
     * Leva para a agenda (cartão.feito = true, guardado no plano do canal) o que a fila marcou como criado no ML.
     * Casa pelo horário, tipo E produto: cartão trocado depois não herda o "criada". → quantos cartões mudaram
     */
    SHC.canalMarcaFeitos = function (plano, fila, storefrontId) {
        if (!fila || fila.storefrontId !== storefrontId || !Array.isArray(fila.itens)) return 0;
        let n = 0;
        fila.itens.forEach(i => {
            const s = i.estado === 'feito' && (plano || []).find(x => x.id === i.id && x.itemId === i.itemId);
            if (s && !s.feito) { s.feito = true; n++; }
        });
        return n;
    };

    /** Fila para o ml-canal.js (chrome.storage 'shc:canal:fila'): só cartões com produto ainda não criados, em ordem. */
    SHC.canalFila = function (plano, storefrontId, agoraMs) {
        const itens = ordena((plano || []).filter(s => s.itemId && !s.feito).slice()).map(s => ({
            id: s.id, itemId: s.itemId, tipo: s.tipo, dia: s.dia, hora: s.hora, titulo: String(s.titulo || '').slice(0, 120),
            nome: SHC.canalNome(s), quando: SHC.canalQuando(s.dia, s.hora), url: SHC.canalUrlFormulario(storefrontId, s.itemId, s.tipo), estado: 'pendente',
        }));
        return { storefrontId, itens, ts: agoraMs || Date.now(), parada: false };
    };

    /** Qual item da fila é esta página do formulário (mesmo canal, anúncio e tipo; o primeiro ainda não feito). → índice ou -1 */
    SHC.canalItemDaUrl = function (fila, url) {
        if (!fila || fila.parada || !Array.isArray(fila.itens)) return -1;
        let u;
        try { u = new URL(url); } catch (e) { return -1; }
        if (!/\/formulario-produto-promocao\/?$/.test(u.pathname)) return -1;
        const sp = u.searchParams;
        if (sp.get('storefrontId') !== fila.storefrontId) return -1;
        return fila.itens.findIndex(i => i.itemId === sp.get('itemId') && i.tipo === sp.get('communicationType') && i.estado !== 'feito' && i.estado !== 'pulado');
    };
    /** Próximo item pendente → índice ou -1. */
    SHC.canalProximo = fila => (fila && !fila.parada && Array.isArray(fila.itens)) ? fila.itens.findIndex(i => i.estado === 'pendente' || i.estado === 'aberto') : -1;
    SHC.canalContagem = fila => {
        const it = (fila && fila.itens) || [];
        return { total: it.length, feitos: it.filter(i => i.estado === 'feito').length, pulados: it.filter(i => i.estado === 'pulado').length };
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = SHC;

    // ── 3. Tela (agenda-canal.html) ──────────────────────────────────────────────────────────
    if (typeof document === 'undefined' || !document.getElementById('shc-agenda') || !root.chrome || !chrome.storage) return;

    const $ = id => document.getElementById(id);
    const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const espera = ms => new Promise(r => setTimeout(r, ms));
    const ehLogin = u => /login|registration|\/lgz\//i.test(u || '');
    let canais = [], dados = null, plano = [], rank = { tentar: false, porDia: {} }, rctx = {}, janela = [], horarios = null;

    const status = (t, erro) => { const e = $('status'); e.textContent = t || ''; e.className = 'msg' + (erro ? ' erro' : ''); };

    // Busca uma página do ML com a sessão do Chrome. Plano B: pede para uma aba aberta do Canal buscar (ml-canal.js).
    // info (opcional) recebe { http }: o status da resposta direta. Falha de rede ou ≥ 500 sem plano B → erro 'ml_fora'.
    async function buscar(caminho, json, info) {
        const url = BASE + caminho;
        let fora = false;
        try {
            // buscarVendo: sessão caída (302 para o login sem CORS) volta com url de login → "Entre no painel", não "o ML não respondeu".
            const r = await SHC.buscarVendo(url, { credentials: 'include', cache: 'no-store' });
            if (info) info.http = r.status;
            if (!ehLogin(r.url) && r.ok) return json ? r.json() : r.text();
            fora = r.status >= 500;
            // 302 sem Location = conta sem canal (confirmado ao vivo em 25/09/2026); outra página de erro do ML com estado também
            // volta para a tela explicar (SHC.canalMLFora / canalSemCanal decidem). 5xx nunca vira "sem canal".
            if (!ehLogin(r.url) && !json && !fora) { const t = await r.text(); if (r.status === 302 || SHC.mlExtraiEstado(t)) return t; }
        } catch (e) { fora = true; /* falha de rede: tenta pela aba */ }
        try {
            const abas = await chrome.tabs.query({ url: BASE + '/marketing/canal-de-transmissao*' });
            for (const a of abas) {
                const resp = await chrome.tabs.sendMessage(a.id, { acao: 'canal_ler', url }).catch(() => null);
                if (resp && resp.ok) return json ? JSON.parse(resp.texto) : resp.texto;
            }
        } catch (e) { /* sem aba */ }
        throw new Error(fora ? 'ml_fora' : 'sem_sessao');
    }
    const estadoDe = async caminho => { const info = {}, html = await buscar(caminho, false, info); return { html, r: SHC.mlExtraiEstado(html), http: info.http }; };

    async function lerCanal(id) {
        const q = encodeURIComponent(id);
        status('Lendo o histórico do canal…');
        const pg = await estadoDe('/marketing/canal-de-transmissao?storefront_id=' + q);
        const campanhas = SHC.canalCampanhas(pg.r);
        for (const tipo of ['channel', 'story']) {          // páginas seguintes do histórico (10 por página)
            for (let off = 10; off <= 50; off += 10) {
                if (campanhas.filter(c => c.tipo === tipo).length < off) break;
                const j = await buscar('/marketing/canal/api/broadcast/campaigns?storefrontId=' + q + '&offset=' + off
                    + '&input=&sort=date&order=DESC&communication_type=' + tipo + '&locale=pt_BR', true).catch(() => null);
                const mais = j ? SHC.canalCampanhas(j, tipo) : [];
                if (!mais.length) break;
                campanhas.push(...mais);
                await espera(300);
            }
        }
        // Produtos elegíveis: paginação por &page=N (a confirmar ao vivo) — para quando não vem item novo.
        const produtos = [], vistos = new Set();
        for (let p = 1; p <= 80; p++) {
            status('Lendo os produtos em promoção… página ' + p);
            const e = await estadoDe('/marketing/canal-de-transmissao/lista-produtos-promocao?storefrontId=' + q + (p > 1 ? '&page=' + p : '')).catch(() => null);
            const novos = e ? SHC.canalProdutos(e.r).filter(x => !vistos.has(x.itemId)) : [];
            if (!novos.length) break;
            novos.forEach(x => { vistos.add(x.itemId); produtos.push(x); });
            await espera(350);
        }
        return { campanhas, produtos, precos: {} };
    }

    // Dados fixos do ranking (retrato, custos, meta…). O ranking em si é por dia (preço da promoção de cada dia).
    async function ranquear() {
        const cfg = await SHC.lerCfg();
        const snap = await SHC.lerAnuncios();
        const anuncios = {};
        ((snap && snap.itens) || []).forEach(i => { if (i && i.itemId) anuncios[i.itemId] = i; });
        const alvo = dados.produtos.map(p => anuncios[p.itemId]).filter(Boolean);
        const mapa = await SHC.custosDe(alvo.map(i => ({ sku: i.sku, familia: i.familia, itemId: i.itemId })));
        const custos = {};
        mapa.forEach((v, info) => { if (v) custos[info.itemId] = v.dados; });
        rctx = { anuncios, custos, cfg, metaPct: $('meta').value, recentes: SHC.canalRecentes(dados.campanhas), hoje: iso(new Date()), diasSemRepetir: n() };
        novoRank(true);
    }
    // tentar = agendada ainda não consultada entra provisoriamente (só para ser consultada no promotions-info).
    const novoRank = tentar => { rank = { tentar, porDia: {} }; };
    const rankDia = dia => rank.porDia[dia] || (rank.porDia[dia] = SHC.canalRanking(dados.produtos,
        Object.assign({}, rctx, { precos: dados.precos, tentar: rank.tentar, dia })));
    const cands = dia => rankDia(dia).candidatos;

    // Consulta o preço da promoção de cada produto|dia da agenda (promotions-info) e refaz os cartões que não passam.
    // Repete porque o cartão refeito pode trazer um produto|dia novo. Termina com o ranking estrito.
    async function conferir() {
        for (let volta = 0; volta < 6; volta++) {
            const faltam = SHC.canalPrecosFaltando(plano, dados.precos);
            if (!faltam.length) break;
            for (const f of faltam) {
                status('Conferindo o preço da promoção em ' + SHC.canalDataCurta(f.dia) + '…');
                const j = await buscar('/marketing/canal/api/broadcast/promotions-info?date=' + encodeURIComponent(f.dia + 'T' + hh(f.hora))
                    + '&selectedItem=' + encodeURIComponent(f.itemId) + '&storefrontId=' + encodeURIComponent($('canal').value), true).catch(() => null);
                dados.precos[f.itemId + '|' + f.dia] = j ? (SHC.canalPrecoPromo(j) || 0) : -1;   // 0 = sem preço de promoção; -1 = falhou
                await espera(250);
            }
            novoRank(true);
            plano = SHC.canalRevalida(plano, cands, n());
        }
        novoRank(false);
        plano = SHC.canalRevalida(plano, cands, n());
    }

    function horasMarcadas() { return [...document.querySelectorAll('#horas input:checked')].map(i => +i.value); }
    function tiposMarcados() { return [...document.querySelectorAll('#tipos input:checked')].map(i => i.value); }
    const n = () => +$('repetir').value || 3;

    async function montar() {
        janela = SHC.canalJanela(new Date(), $('ultimo').value, horasMarcadas());
        await ranquear();
        plano = SHC.canalMontaPlano(janela, tiposMarcados(), cands, n(), plano.filter(s => s.feito));
        await conferir();
        await salvar();
        await desenha();
        status('');
    }

    async function salvar() {
        try { await SHC.gravarChave('shc:canal:plano:' + $('canal').value, { ts: Date.now(), plano }); } catch (e) { /* ok */ }
    }

    function desenhaHorarios() {
        const h = horarios, e = $('melhores');
        if (h.fonte === 'padrao') e.textContent = 'Ainda não há histórico suficiente no canal. Sugestão inicial: 10:00 e 19:00.';
        else {
            const dias = h.porDia.slice(0, 2).map(d => DIAS_SEMANA[d.dow]).join(' e ');
            e.textContent = 'Pelo seu histórico (' + h.base + ' envios), os horários com mais vendas e cliques são ' + h.horas.map(hh).join(' e ')
                + (dias ? '; os melhores dias, ' + dias : '') + '.';
        }
        const box = $('horas');
        box.textContent = '';
        for (let x = HORA_MIN; x <= HORA_MAX; x++) {
            const l = document.createElement('label'), i = document.createElement('input');
            i.type = 'checkbox'; i.value = x; i.checked = h.horas.indexOf(x) >= 0;
            l.className = 'chk'; l.append(i, ' ' + hh(x));
            box.append(l);
        }
    }

    function cartao(s) {
        const d = document.createElement('div');
        d.className = 'cartao' + (s.itemId ? '' : ' vazio') + (s.feito ? ' feito' : '');
        d.dataset.id = s.id;
        const cab = '<div class="cab"><span class="tag t-' + esc(s.tipo) + '">' + esc(SHC.CANAL_TIPOS[s.tipo]) + '</span><b>' + hh(s.hora) + '</b>'
            + (s.feito ? '<span class="feito">✓ criada</span>' : '') + '</div>';
        if (!s.itemId) { d.innerHTML = cab + '<p class="mot">' + esc(s.motivo) + '</p><div class="ac"><button class="lnk" data-a="remover">Remover</button></div>'; return d; }
        d.innerHTML = cab
            + '<div class="prod">' + (s.foto ? '<img alt="" src="' + esc(s.foto) + '">' : '') + '<span>' + esc(s.titulo) + '</span></div>'
            + '<div class="luc">Lucro ' + esc(SHC.moeda(s.lucro)) + ' · ' + esc(SHC.pctTxt(s.pct)) + ' <small>estimativa</small></div>'
            + '<p class="mot">' + esc(s.motivo) + '</p>'
            + '<div class="ac">' + (s.feito ? '' : '<button class="lnk" data-a="trocar">Trocar produto</button><button class="lnk" data-a="remover">Remover</button>')
            + '<button class="lnk" data-a="repetir">Repetir este horário em todos os dias</button>'
            + (s.feito ? '' : '<button class="lnk" data-a="tipos">Aplicar a todos os tipos</button>') + '</div>';
        return d;
    }

    async function desenha() {
        const fila = await SHC.lerChave('shc:canal:fila');
        if (SHC.canalMarcaFeitos(plano, fila, $('canal').value)) await salvar();   // "criada" fica no plano do canal
        $('resumo').textContent = SHC.canalResumo(plano);
        const grade = $('grade');
        grade.textContent = '';
        // Fora da agenda: produto que não é candidato em nenhum dia da janela (motivo do 1º dia em que saiu).
        const diasR = [...new Set(janela.map(j => j.dia).concat(plano.map(s => s.dia)))];
        const ranks = (diasR.length ? diasR : ['']).map(rankDia);
        const candIds = new Set(), fora = new Map(), noPlano = new Set(plano.map(s => s.itemId).filter(Boolean));
        ranks.forEach(r => r.candidatos.forEach(c => candIds.add(c.itemId)));
        ranks.forEach(r => r.fora.forEach(x => { if (!candIds.has(x.itemId) && !noPlano.has(x.itemId) && !fora.has(x.itemId)) fora.set(x.itemId, x); }));
        const dias = [...new Set(plano.map(s => s.dia))].sort();
        if (!dias.length) {
            grade.innerHTML = '<p class="vazio">' + (candIds.size ? 'Nada na agenda. Marque horários e tipos e clique em "Montar agenda".'
                : fora.size ? 'Nenhum produto pode entrar na agenda agora (sem lucro acima da sua meta, sem custo ou sem promoção confirmada): veja "Fora da agenda e por quê" logo abaixo.'
                : 'Não achei produtos em promoção para comunicar neste canal.') + '</p>';
        }
        $('fora-box').open = !candIds.size && fora.size > 0;
        dias.forEach(dia => {
            const col = document.createElement('section');
            col.className = 'dia';
            const h = document.createElement('h3');
            h.textContent = SHC.canalQuando(dia, 0).replace(/ às .*/, '');
            col.append(h);
            plano.filter(s => s.dia === dia).forEach(s => col.append(cartao(s)));
            grade.append(col);
        });
        const ok = plano.filter(s => s.itemId && !s.feito).length;
        $('programar').disabled = !ok;
        $('programar').textContent = 'Programar no ML (' + ok + ')';
        const c = fila && fila.storefrontId === $('canal').value ? SHC.canalContagem(fila) : null;
        $('progresso').textContent = c && c.total ? c.feitos + ' de ' + c.total + ' criadas no ML' + (c.pulados ? ' · ' + c.pulados + ' puladas' : '') : '';
        const f = $('fora');
        f.textContent = '';
        fora.forEach(x => { const li = document.createElement('li'); const b = document.createElement('b'); b.textContent = x.titulo || x.itemId; li.append(b, ' — ' + x.motivo); f.append(li); });
        $('fora-n').textContent = fora.size;
        $('cand-n').textContent = candIds.size;
    }

    let ocupado = false;
    $('grade').addEventListener('click', async e => {
        const b = e.target.closest('[data-a]'), card = e.target.closest('.cartao');
        if (!b || !card || ocupado) return;
        const id = card.dataset.id, a = b.dataset.a;
        ocupado = true;
        try {
            if (a === 'trocar') plano = SHC.canalTrocarProduto(plano, id, cands, n());
            else if (a === 'remover') plano = SHC.canalRemover(plano, id);
            else if (a === 'repetir') plano = SHC.canalRepetirHorario(plano, id, janela.length ? janela : SHC.canalJanela(new Date(), $('ultimo').value, horasMarcadas()), cands, n(), new Date());
            else if (a === 'tipos') plano = SHC.canalAplicarTipos(plano, id, tiposMarcados());
            if (a !== 'remover') await conferir();   // produto|dia novo: confere o preço da promoção daquele dia
            await salvar();
            await desenha();
            status('');
        } catch (err) { erro(err); } finally { ocupado = false; }
    });
    // "Story e Canal" já manda os dois: não deixa marcar junto com Mensagem/Story.
    $('tipos').addEventListener('change', e => {
        const t = e.target;
        if (!t.checked) return;
        document.querySelectorAll('#tipos input').forEach(i => { if (i !== t && (t.value === 'ambos' || i.value === 'ambos')) i.checked = false; });
    });

    $('montar').addEventListener('click', () => montar().catch(erro));
    $('atualizar').addEventListener('click', () => carregar(true).catch(erro));
    $('canal').addEventListener('change', () => { try { SHC.gravarChave('shc:canal:sel', $('canal').value); } catch (e) { /* ok */ } carregar(false).catch(erro); });
    $('programar').addEventListener('click', async () => {
        const sf = $('canal').value, velha = await SHC.lerChave('shc:canal:fila');
        // Antes de trocar a fila, o que ela já criou vai para a agenda do canal dela (não volta para a fila nova).
        if (velha && velha.storefrontId && velha.storefrontId !== sf) {
            const k = 'shc:canal:plano:' + velha.storefrontId, pv = await SHC.lerChave(k);
            if (pv && Array.isArray(pv.plano) && SHC.canalMarcaFeitos(pv.plano, velha, velha.storefrontId)) await SHC.gravarChave(k, pv);
        } else if (SHC.canalMarcaFeitos(plano, velha, sf)) await salvar();
        const fila = SHC.canalFila(plano, sf);
        if (!fila.itens.length) return desenha();
        fila.itens[0].estado = 'aberto';
        await SHC.gravarChave('shc:canal:fila', fila);
        chrome.tabs.create({ url: fila.itens[0].url });
        status('Abrimos o formulário do Mercado Livre. Confira e clique em "Criar" lá; o Copiloto abre o próximo.');
    });
    chrome.storage.onChanged.addListener((m, area) => { if (area === 'local' && m['shc:canal:fila'] && plano.length) desenha(); });

    function erro(e) {
        if (e && e.message === 'ml_fora') return status(SHC.CANAL_ML_FORA, true);
        if (e && e.message === 'nao_lido') return status(SHC.CANAL_NAO_LIDO, true);
        status(e && e.message === 'sem_sessao'
            ? 'Não consegui ler o Mercado Livre. Entre no painel do vendedor neste Chrome (vendedores.mercadolivre.com.br) e clique em "Ler de novo do ML".'
            : 'Algo deu errado ao ler o Mercado Livre. Tente "Ler de novo do ML" em alguns minutos.', true);
    }

    // Conta sem canal (sem "Minha página"): aviso com link, no lugar da agenda — não é erro.
    function semCanal() {
        status('');
        plano = [];
        const p = document.createElement('p'), a = document.createElement('a');
        p.className = 'vazio';
        a.href = SHC.CANAL_URL_MINHA_PAGINA; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Abrir a Minha página no Mercado Livre';
        p.append(SHC.CANAL_SEM_CANAL + ' ', a);
        $('grade').replaceChildren(p);
        $('resumo').textContent = '';
        $('programar').disabled = true;
        $('montar').disabled = true;
    }

    // lerCanais: lê de novo a lista de canais. A agenda salva do canal é reaproveitada; "Montar agenda" refaz.
    async function carregar(lerCanais) {
        status('Lendo os seus canais…');
        if (!canais.length || lerCanais) {
            const l = await estadoDe('/marketing/canal-de-transmissao/lista');
            if (SHC.canalMLFora(l.r, l.http)) { canais = []; throw new Error('ml_fora'); }
            canais = SHC.canalCanais(l.r, l.html);
            if (SHC.canalSemCanal(l.r, canais, l.http)) canais = [];
            else if (!canais.length) throw new Error('nao_lido');   // sem o 302 não dá para dizer que a conta não tem canal
            const sel = $('canal'), salvo = await SHC.lerChave('shc:canal:sel');
            sel.textContent = '';
            canais.forEach((c, i) => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.nome || 'Canal ' + (i + 1); sel.append(o); });
            if (salvo && canais.some(c => c.id === salvo)) sel.value = salvo;
            $('canal-campo').hidden = canais.length < 2;
        }
        if (!canais.length) return semCanal();
        $('montar').disabled = false;
        $('cupom').href = BASE + '/marketing/canal-de-transmissao?storefront_id=' + encodeURIComponent($('canal').value);
        plano = [];   // a agenda (e os "criada") de outro canal não passa para este
        dados = await lerCanal($('canal').value);
        horarios = SHC.canalMelhoresHorarios(dados.campanhas, 2);
        desenhaHorarios();
        const salvo = await SHC.lerChave('shc:canal:plano:' + $('canal').value);
        const agora = new Date(), hoje = iso(agora);
        const valendo = salvo && Array.isArray(salvo.plano) ? salvo.plano.filter(s => s.dia > hoje || (s.dia === hoje && s.hora > agora.getHours())) : [];
        if (valendo.length) {
            plano = valendo;
            janela = SHC.canalJanela(new Date(), $('ultimo').value, horasMarcadas());
            await ranquear();
            await conferir();
            await salvar();
            await desenha();
            status('');
        } else await montar();
    }

    $('ultimo').value = SHC.canalUltimoDiaPadrao(new Date(), DIAS_JANELA);
    $('ultimo').min = iso(new Date());
    // Antes de ler o ML: horários padrão (10:00 e 19:00) e a meta, para a tela nunca ficar vazia se a leitura falhar.
    horarios = SHC.canalMelhoresHorarios([], 2);
    desenhaHorarios();
    $('meta').value = SHC.canalMetaInicial(null);
    SHC.lerCfg().then(cfg => { $('meta').value = SHC.canalMetaInicial(cfg); }).catch(() => {}).finally(() => carregar(true).catch(erro));
})(typeof globalThis !== 'undefined' ? globalThis : this);
