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
            dia: quando.dia, hora: quando.hora, status: statusTxt.slice(0, 30), statusCod: String(st.status || '').slice(0, 20),
            enviada: (/enviad/i.test(statusTxt) && !/n[aã]o\s+enviad/i.test(statusTxt)) || st.status === 'success',
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

    /** Motivo do ML "…sincronizado com um do catálogo… selecione o anúncio #6917042526" → 'MLB6917042526' | ''. */
    SHC.canalAlvoCatalogo = motivo => { const m = /cat[aá]logo[\s\S]*?#\s?(\d{6,14})/i.exec(String(motivo || '')); return m ? 'MLB' + m[1] : ''; };

    /**
     * A REGRA ÚNICA de quem pode entrar na agenda (a tela, o robô do canal e o painel lateral usam só esta).
     * Checklist por produto: o ML deixa comunicar, promoção ativa/agendada, estoque, não comunicado nos últimos N dias, anúncio lido e
     * ativo, promoção confirmada no dia, custo, sem prejuízo e lucro ≥ meta. Prejuízo NUNCA entra.
     * ctx = { anuncios:{MLB:item do retrato}, custos:{MLB:dados}, precos, cfg, metaPct, recentes, hoje, diasSemRepetir, dia, tentar }
     * Com ctx.dia o preço vem de precos['MLB…|AAAA-MM-DD'] (promotions-info naquele dia); sem dia, de precos['MLB…'].
     * Preço: > 0 = preço da promoção do ML; 0 = o ML não mostrou preço de promoção; -1 = a consulta falhou; ausente = não consultado.
     * Promoção só agendada precisa do preço da promoção confirmado (o retrato tem o preço cheio). ctx.tentar deixa a
     * agendada ainda não consultada entrar provisoriamente (lucro no preço cheio, que é o teto) só para ser consultada.
     * Catálogo: o ML pede outro anúncio (#…); se ele é desta conta (está no retrato), entra no lugar, com a conta de lucro dele.
     * → { candidatos:[{itemId, titulo, foto, lucro, pct, preco, fonte, motivo, agendada, trocadoDe}], fora:[{itemId, titulo, motivo, tipo, …}] }
     * tipo do "fora": ml · catalogo · semPromo · estoque · recente · leitura · inativo · semPreco · aguardando · dados · frete · custo · prejuizo · meta
     */
    SHC.canalRanking = function (produtos, ctx) {
        const cfg = Object.assign({}, SHC.PADRAO, ctx.cfg || {});
        const meta = SHC.num(ctx.metaPct) !== null ? SHC.num(ctx.metaPct) : (SHC.num(cfg.margem_alvo_pct) || 0);
        const n = Math.max(1, SHC.num(ctx.diasSemRepetir) || 1);
        const anuncios = ctx.anuncios || {}, candidatos = [], fora = [], visto = new Set();
        (produtos || []).forEach(p0 => {
            let p = p0;
            const alvo = !p.elegivel ? SHC.canalAlvoCatalogo(p.motivo) : '';
            if (alvo && anuncios[alvo]) {
                const a = anuncios[alvo];   // a promoção do outro anúncio só vale confirmada: retrato em promoção = ativa; senão, o promotions-info confirma
                p = Object.assign({}, p, { itemId: alvo, titulo: a.titulo || p.titulo, foto: '', elegivel: true, motivo: '', trocadoDe: p.itemId,
                    ativa: !!a.emPromocao, agendada: !a.emPromocao && !!(p.ativa || p.agendada) });
            }
            if (visto.has(p.itemId)) return;
            visto.add(p.itemId);
            const sai = (motivo, tipo, extra) => fora.push(Object.assign({ itemId: p.itemId, titulo: p.titulo, motivo, tipo }, p.trocadoDe ? { trocadoDe: p.trocadoDe } : {}, extra || {}));
            if (!p.elegivel) return alvo ? sai('O ML só deixa divulgar o anúncio #' + alvo.slice(3) + ' do catálogo, e ele não está entre os anúncios lidos desta conta.', 'catalogo', { alvo })
                : sai('O ML não deixa comunicar' + (p.motivo ? ': ' + p.motivo : '.'), 'ml');
            if (!p.ativa && !p.agendada) return sai('Sem promoção ativa ou agendada.', 'semPromo');
            if (p.unidades !== null && p.unidades !== undefined && p.unidades <= 0) return sai('Sem estoque.', 'estoque');
            const ult = (ctx.recentes || {})[p.itemId];
            if (ult && ctx.hoje && difDias(ctx.hoje, ult) < n) return sai('Já comunicado em ' + SHC.canalDataCurta(ult) + '.', 'recente', { dia: ult });
            const item = anuncios[p.itemId];
            if (!item) return sai('O Copiloto ainda não leu este anúncio.', 'leitura');
            if (item.status && !/^active$/i.test(item.status)) return sai('O anúncio não está ativo no ML (pausado ou finalizado).', 'inativo');
            // Sem custo não entra em dia nenhum: diz isso (a dona resolve ali) antes de "aguardando a promoção", que esconderia o custo.
            const cd = (ctx.custos || {})[p.itemId];
            if (!(SHC.num(cd && cd.custo) > 0)) return sai('Falta o custo deste produto.', 'custo', { sku: item.sku || '' });
            const pp =(ctx.precos || {})[ctx.dia ? p.itemId + '|' + ctx.dia : p.itemId];
            const cheio = item.precoCheio > 0 ? item.precoCheio : (p.ativa ? 0 : item.preco);
            const naData = ctx.dia ? ' em ' + SHC.canalDataCurta(ctx.dia) : '';
            // Preço igual ao cheio = sem promoção naquela data (o que o promotions-info devolve fora da vigência: a confirmar ao vivo).
            if (pp === 0 || (pp > 0 && cheio > 0 && pp >= cheio - 0.005)) return sai('O ML não mostrou preço de promoção' + naData + '.', p.ativa ? 'semPreco' : 'aguardando', { semPromoNoDia: true });
            if (!(pp > 0) && !p.ativa && !(ctx.tentar && pp === undefined)) return sai('Promoção agendada: preço da promoção ainda não confirmado' + naData + '.', 'aguardando');
            const s = SHC.canalLucro(item, (ctx.custos || {})[p.itemId], cfg, pp > 0 ? pp : null);
            if (!s) return sai('O ML não mostrou o preço ou o "você recebe" deste anúncio.', 'dados');
            if (s.motivo) return sai(s.motivo, 'frete');
            if (s.sobra === null) return sai('Falta o custo deste produto.', 'custo', { sku: item.sku || '' });
            if (s.sobra < 0) return sai('Dá prejuízo na promoção: ' + SHC.moeda(s.sobra) + ' por venda.', 'prejuizo', { lucro: s.sobra, preco: s.preco });
            if (s.pct < meta) return sai('Lucro abaixo da sua meta: ' + SHC.moeda(s.sobra) + ' (' + SHC.pctTxt(s.pct) + ').', 'meta',
                { lucro: s.sobra, pct: s.pct, preco: s.preco, meta, lucroMeta: SHC.r2(s.preco * meta / 100) });
            candidatos.push({
                itemId: p.itemId, titulo: p.titulo || item.titulo || p.itemId, foto: p.foto || '', recomendado: p.recomendado,
                lucro: s.sobra, pct: s.pct, preco: s.preco, fonte: s.fonte, unidades: p.unidades, agendada: !p.ativa, trocadoDe: p.trocadoDe || '',
                motivo: 'Lucro estimado de ' + SHC.moeda(s.sobra) + ' (' + SHC.pctTxt(s.pct) + ') no preço de ' + SHC.moeda(s.preco)
                    + (p.agendada && !p.ativa ? ' (promoção agendada)' : '') + (p.unidades > 0 ? ' · ' + p.unidades + ' em estoque' : ''),
            });
        });
        candidatos.sort((a, b) => b.lucro - a.lucro || (b.recomendado ? 1 : 0) - (a.recomendado ? 1 : 0));
        return { candidatos, fora };
    };

    /** Anúncios do canal (e os do catálogo que o ML indica) que o retrato ainda não tem → ['MLB…'] (sem repetir). */
    SHC.canalSemLeitura = function (produtos, anuncios) {
        const out = new Set(), a = anuncios || {};
        (produtos || []).forEach(p => {
            const alvo = !p.elegivel ? SHC.canalAlvoCatalogo(p.motivo) : '';
            if (alvo) { if (!a[alvo]) out.add(alvo); } else if (p.elegivel && !a[p.itemId]) out.add(p.itemId);
        });
        return [...out];
    };

    const ORDEM_TIPO = { channel: 0, story: 1, ambos: 2 };
    const ordena = plano => plano.sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : a.hora - b.hora || ORDEM_TIPO[a.tipo] - ORDEM_TIPO[b.tipo]));
    const slotId = (dia, hora, tipo) => dia + '|' + hora + '|' + tipo;
    // O produto c pode ir no dia `dia`? Nenhum outro cartão com ele a menos de N dias (ignora o próprio cartão).
    const cabe = (plano, c, dia, n, ignora) => !plano.some(s => s !== ignora && s.itemId === c.itemId && Math.abs(difDias(s.dia, dia)) < n);
    const poe = (s, c) => Object.assign(s, { itemId: c.itemId, titulo: c.titulo, foto: c.foto, lucro: c.lucro, pct: c.pct, fonte: c.fonte, motivo: c.motivo,
        agendada: !!c.agendada, trocadoDe: c.trocadoDe || '' });
    // candidatos: lista única ou função dia → lista (ranking com o preço da promoção de cada dia).
    const lista = (cands, dia) => (typeof cands === 'function' ? cands(dia) : cands) || [];
    const vazio = (s, algum, n) => Object.assign(s, { itemId: '', titulo: '', foto: '', lucro: null, pct: null, fonte: '',
        motivo: algum ? 'Nenhum produto livre: todos já divulgados a menos de ' + (n > 1 ? n + ' dias' : '1 dia') + ' deste.' : 'Nenhum produto com promoção e lucro neste dia.' });

    // Preenche os cartões vazios em ordem de data, com o melhor produto do dia que ainda cabe.
    function preencher(plano, cands, n) {
        ordena(plano).forEach(s => {
            if (s.itemId) return;
            const l = lista(cands, s.dia), c = l.find(x => cabe(plano, x, s.dia, n, s));
            if (c) poe(s, c); else vazio(s, l.length > 0, n);
        });
        return plano;
    }

    /** 'Story e Canal' já cria a mensagem E o story: com ele marcado, Mensagem e Story saem (senão o seguidor recebe em dobro). */
    SHC.canalTiposValidos = tipos => (tipos || []).indexOf('ambos') >= 0 ? ['ambos'] : (tipos || []).filter(t => t === 'channel' || t === 'story');

    // Cartões vazios da janela × tipos, sem duplicar os que já existem (base = cartões que ficam: criados no ML ou já escolhidos).
    function vagas(janela, tipos, base) {
        const plano = (base || []).map(s => Object.assign({}, s)), ts = SHC.canalTiposValidos(tipos);
        (janela || []).forEach(j => j.horas.forEach(h => ts.forEach(t => {
            const id = slotId(j.dia, h, t);
            if (!plano.some(s => s.id === id)) plano.push({ id, dia: j.dia, hora: h, tipo: t, itemId: '' });
        })));
        return plano;
    }

    /**
     * Agenda inteira com uma lista de candidatos já pronta (lista única ou função dia → lista), sem repetir em menos de N dias. → [cartão]
     * fixos = cartões já criados no ML (feito): ficam como estão e ocupam o horário. Sem nenhum produto em nenhum dia
     * não cria cartão vazio (a tela explica pelo "Fora da agenda").
     */
    SHC.canalMontaPlano = function (janela, tipos, candidatos, diasSemRepetir, fixos) {
        const n = Math.max(1, SHC.num(diasSemRepetir) || 1);
        if (!(janela || []).some(j => lista(candidatos, j.dia).length)) return ordena((fixos || []).map(s => Object.assign({}, s)));
        return preencher(vagas(janela, tipos, fixos), candidatos, n);
    };

    // Ranking de um dia guardado até chegar um preço novo (o ctx é refeito quando muda custo, meta ou retrato).
    const memos = new WeakMap();
    function rankDe(produtos, ctx, dia, tentar) {
        let m = memos.get(ctx);
        if (!m) memos.set(ctx, m = {});
        const k = dia + '|' + (tentar ? 1 : 0);
        return m[k] || (m[k] = SHC.canalRanking(produtos, Object.assign({}, ctx, { dia, tentar })));
    }
    const LIMITE_CONSULTAS = 150;   // promotions-info por montagem (≈ 250 ms cada): a agenda nunca fica minutos lendo
    async function consulta(ctx, precoDe, itemId, dia, hora) {
        const k = itemId + '|' + dia;
        ctx.precos = ctx.precos || {};
        if (ctx.precos[k] !== undefined || ctx._consultas >= (ctx.limite || LIMITE_CONSULTAS)) return;
        ctx._consultas++;
        ctx.precos[k] = await precoDe(itemId, dia, hora);
        memos.delete(ctx);
    }

    /**
     * Preenche/confere a agenda dia a dia SÓ com quem pode entrar NAQUELE dia (SHC.canalRanking com o preço da promoção do dia).
     * Cartão com produto: consulta o preço do dia e, se não passa mais, perde o produto. Cartão vazio: percorre os candidatos do dia
     * (maior lucro primeiro), consulta o preço do dia de cada um só quando precisa e põe o 1º que passa e não repete em menos de N dias.
     * Promoção agendada que começa depois cai sozinha no dia em que começa (antes disso o ML não mostra preço de promoção).
     * precoDe(itemId, dia, hora) → Promise<> 0 | 0 | -1> (promotions-info). Cartão criado no ML (feito) não muda. → o mesmo plano
     */
    SHC.canalPreenche = async function (plano, produtos, ctx, precoDe) {
        const n = Math.max(1, SHC.num(ctx.diasSemRepetir) || 1);
        ctx._consultas = 0;
        const passa = (id, dia) => rankDe(produtos, ctx, dia, false).candidatos.find(c => c.itemId === id);
        for (const s of ordena(plano)) {
            if (s.feito) continue;
            if (s.itemId) {
                await consulta(ctx, precoDe, s.itemId, s.dia, s.hora);
                const c = passa(s.itemId, s.dia);
                if (c && cabe(plano, c, s.dia, n, s)) { poe(s, c); continue; }
                s.itemId = '';
            }
            let achou = null, preso = false;
            for (const c of rankDe(produtos, ctx, s.dia, true).candidatos) {
                if (!cabe(plano, c, s.dia, n, s)) { preso = true; continue; }
                await consulta(ctx, precoDe, c.itemId, s.dia, s.hora);
                if ((achou = passa(c.itemId, s.dia))) break;
            }
            if (achou) poe(s, achou); else vazio(s, preso, n);
        }
        return plano;
    };

    /**
     * "Montar agenda": horários da janela × tipos + SHC.canalPreenche. base = cartões que ficam (a tela: os criados no ML; o robô: também os
     * que a seller já tinha). Nenhum produto em nenhum dia → sem cartão vazio (a tela explica pelo "Fora da agenda").
     */
    SHC.canalMontaAgenda = async function (janela, tipos, produtos, ctx, precoDe, base) {
        const plano = await SHC.canalPreenche(vagas(janela, tipos, base), produtos, ctx, precoDe);
        return ordena(plano.some(s => s.itemId && !s.feito) ? plano : plano.filter(s => s.feito));
    };

    /**
     * Para o "Fora da agenda" dizer a verdade: agendada que ainda não teve o preço consultado em nenhum dia é consultada dia a dia até
     * achar o dia em que a promoção começa (ou acabar a janela). Até `limite` consultas. → quantas consultas fez
     */
    SHC.canalSonda = async function (produtos, ctx, janela, precoDe, plano, limite) {
        const ja = new Set((plano || []).map(s => s.itemId).filter(Boolean)), lim0 = ctx.limite;
        ctx._consultas = 0;
        ctx.limite = limite === undefined ? 40 : limite;
        for (const j of janela || []) {
            if (!ctx.limite) break;
            rankDe(produtos, ctx, j.dia, false).candidatos.forEach(c => ja.add(c.itemId));
            for (const c of rankDe(produtos, ctx, j.dia, true).candidatos) {
                if (ja.has(c.itemId)) continue;
                await consulta(ctx, precoDe, c.itemId, j.dia, j.horas[0]);
                if (rankDe(produtos, ctx, j.dia, false).candidatos.some(x => x.itemId === c.itemId)) ja.add(c.itemId);
            }
        }
        ctx.limite = lim0;
        return ctx._consultas;
    };

    /**
     * Quem ficou fora da agenda e por quê (1 linha por produto), dos dias `dias` (janela + dias do plano). Quem pode entrar em algum dia
     * mas não ganhou horário vira 'semVaga' (com o 1º dia). Motivo que não depende do dia ganha do "sem promoção neste dia".
     * → [{itemId, titulo, tipo, motivo, etiqueta, dia?, lucro?, …}]
     */
    SHC.canalForaLista = function (plano, produtos, ctx, dias) {
        const noPlano = new Set((plano || []).filter(s => s.itemId).map(s => s.itemId)), por = new Map();
        const ds = (dias && dias.length ? dias.slice().sort() : ['']);
        const pega = id => por.get(id) || (por.set(id, { razoes: [] }), por.get(id));
        ds.forEach(dia => {
            const r = rankDe(produtos, ctx, dia || undefined, false);
            r.candidatos.forEach(c => { const e = pega(c.itemId); if (!e.cand) e.cand = Object.assign({ dia }, c); });
            r.fora.forEach(x => pega(x.itemId).razoes.push(Object.assign({ dia }, x)));
        });
        const dd = SHC.canalDataCurta, ult = ds[ds.length - 1], out = [];
        por.forEach((e, id) => {
            if (noPlano.has(id)) return;
            if (e.cand) {
                const c = e.cand;
                return out.push({ itemId: id, titulo: c.titulo, tipo: 'semVaga', dia: c.dia, lucro: c.lucro, pct: c.pct, trocadoDe: c.trocadoDe || '',
                    motivo: 'Dá lucro, mas não sobrou horário livre.',
                    etiqueta: c.agendada ? 'promoção começa em ' + dd(c.dia) + ': marque mais um horário' : 'cabe em ' + dd(c.dia) + ': marque mais um horário' });
            }
            const firme = e.razoes.find(x => x.tipo !== 'aguardando' && x.tipo !== 'semPreco'), x = firme || e.razoes[0];
            let etiqueta = ETIQUETA[x.tipo] ? ETIQUETA[x.tipo](x) : x.motivo;
            if (!firme && e.razoes.every(z => z.semPromoNoDia)) etiqueta = x.tipo === 'aguardando' ? 'a promoção só começa depois de ' + dd(ult) : 'sem promoção de ' + dd(ds[0]) + ' a ' + dd(ult);
            else if (!firme && x.tipo === 'aguardando') etiqueta = 'o ML ainda não confirmou o preço da promoção';
            out.push(Object.assign({}, x, { etiqueta }));
        });
        return out;
    };
    const ETIQUETA = {
        ml: x => x.motivo.replace(/^O ML não deixa comunicar:?\s*/, '').replace(/\.$/, '').slice(0, 80) || 'o ML não deixa',
        catalogo: x => 'o ML pede o anúncio #' + String(x.alvo || '').slice(3) + ', que não está nos anúncios lidos',
        semPromo: () => 'sem promoção ativa ou agendada', estoque: () => 'sem estoque', recente: x => 'divulgado em ' + SHC.canalDataCurta(x.dia),
        leitura: () => 'o Copiloto ainda não leu este anúncio', inativo: () => 'anúncio pausado ou finalizado', dados: () => 'o ML não mostrou o "você recebe"',
        frete: () => 'frete grátis passa a ser seu: abra o anúncio', custo: () => 'falta o custo', prejuizo: x => 'prejuízo de ' + SHC.moeda(Math.abs(x.lucro)) + ' por venda',
        meta: x => 'lucro ' + SHC.moeda(x.lucro) + ' (meta ' + SHC.moeda(x.lucroMeta) + ')',
    };

    /**
     * Grupos do "Fora da agenda" (visual): ordem = o que a seller resolve primeiro. Cada grupo: ícone, cor, título, contagem e UMA ação.
     * → { total, resumo:'10 fora: 3 aguardando promoção · …', grupos:[{tipo, icone, cor, titulo, rotulo, acao, botao, n, itens}] }
     */
    const GRUPOS = [
        // tipo(s), ícone (sprite da página), cor, título, rótulo curto (resumo), ação (texto), botão (data-grupo)
        // Grupos que ficam lado a lado na barra têm cor própria (vi = violeta, ci = ciano); a barra também leva o número de cada trecho.
        [['custo'], 'custo', 'az', 'Sem custo', 'sem custo', 'Informe o custo aqui: o produto entra na hora se der lucro.', ''],
        [['leitura'], 'doc', 'vi', 'Anúncio ainda não lido', 'sem leitura', 'O Copiloto lê estes anúncios no ML sozinho.', 'Ler estes anúncios agora'],
        [['catalogo'], 'link', 'ne', 'Anúncio de catálogo', 'catálogo', 'O ML só deixa divulgar o anúncio do catálogo que ele indica.', 'Usar o anúncio do catálogo'],
        [['semVaga'], 'cal', 'ok', 'Dá lucro, sem horário livre', 'sem horário', 'Marque mais um horário ou aumente o último dia.', ''],
        [['aguardando'], 'relogio', 'ci', 'Aguardando a promoção', 'aguardando promoção', 'Entram sozinhos no dia em que a promoção começar.', ''],
        [['meta'], 'desce', 'at', 'Lucro abaixo da meta', 'abaixo da meta', 'Lucro abaixo da meta: baixe a meta acima se quiser que entrem.', ''],
        [['prejuizo'], 'x', 'pr', 'Prejuízo na promoção', 'prejuízo', 'Nunca entram: dariam prejuízo.', ''],
        [['estoque', 'inativo'], 'caixa', 'ne', 'Sem estoque ou pausado', 'sem estoque', 'Entram quando voltarem a ter estoque e estiverem ativos.', ''],
        [['recente'], 'repete', 'ne', 'Divulgado há pouco', 'divulgados há pouco', 'Voltam depois dos dias escolhidos em "Não repetir".', ''],
        [['ml'], 'bloq', 'pr', 'O ML não deixa divulgar', 'bloqueados pelo ML', 'Motivo do próprio ML.', ''],
        [['semPromo', 'semPreco', 'dados', 'frete'], 'info', 'ne', 'Sem promoção ou sem dado', 'sem promoção', 'O ML não mostra promoção ou preço nestes dias.', ''],
    ];
    SHC.canalGrupos = function (fora) {
        const grupos = GRUPOS.map(([tipos, icone, cor, titulo, rotulo, acao, botao]) => {
            const itens = (fora || []).filter(x => tipos.indexOf(x.tipo) >= 0);
            return { tipo: tipos[0], icone, cor, titulo, rotulo, acao, botao, n: itens.length, itens };
        });
        const soltos = (fora || []).filter(x => !GRUPOS.some(g => g[0].indexOf(x.tipo) >= 0));
        if (soltos.length) grupos[grupos.length - 1].itens.push(...soltos), grupos[grupos.length - 1].n += soltos.length;
        const com = grupos.filter(g => g.n), total = (fora || []).length;
        return { total, grupos: com, resumo: total ? total + ' fora: ' + com.map(g => g.n + ' ' + g.rotulo).join(' · ') : '' };
    };
    /** Todos do grupo da leitura já saíram dele: o grupo vazio (só o resultado) volta no MESMO lugar da ordem de GRUPOS, onde a dona clicou. */
    SHC.canalGruposComVazio = function (grupos, tipo) {
        if (!tipo || grupos.some(x => x.tipo === tipo)) return grupos;
        const ordem = t => GRUPOS.findIndex(G => G[0].indexOf(t) >= 0);
        return grupos.concat(SHC.canalGrupos([{ tipo }]).grupos.map(x => Object.assign(x, { n: 0, itens: [], botao: '' }))).sort((a, b) => ordem(a.tipo) - ordem(b.tipo));
    };

    /**
     * Botão "Ler estes anúncios agora" (e "Usar o anúncio do catálogo"): o retorno fica NO grupo — botão, frase e cada linha.
     * l = { fase:'lendo'|'lista'|'fim', ids:[MLB…], est:{MLB:'fila'|'lendo'|'lido'|'nao'|'erro'}, motivo?, entraram?, onde?, lento?, desde?, listaOcupada? }
     * desde = hora do clique (a lista inteira só vale se a etapa "anuncios" começou depois); listaOcupada = outra sincronização já tinha passado dela.
     */
    SHC.CANAL_LINHA_LEITURA = { fila: 'na fila', lendo: 'lendo no ML…', lido: '✓ lido', nao: 'não achado no ML', erro: 'não lido' };
    /** Status da sincronização (shc:status) → a lista de anúncios já foi lida? (etapa "anuncios" fora da fila, ou a sincronização acabou) */
    SHC.canalListaLida = st => {
        const e = st && st.etapas && st.etapas.anuncios;
        return !!st && (!(st.sincronizando || st.estado === 'sincronizando') || (!!e && e.estado !== 'fila' && e.estado !== 'lendo'));
    };
    SHC.canalLeituraOcupada = l => !!l && (l.fase === 'lendo' || (l.fase === 'lista' && !l.lento));
    SHC.canalLeituraBotao = (l, botao) => !l ? botao : l.fase === 'lendo' ? 'Lendo ' + (l.ids.length === 1 ? '1 anúncio…' : l.ids.length + ' anúncios…')
        : SHC.canalLeituraOcupada(l) ? 'Lendo a lista…' : 'Ler de novo';
    SHC.canalLeituraTexto = function (l) {
        if (!l) return '';
        const est = l.est || {}, qt = s => l.ids.filter(id => est[id] === s).length;
        if (l.fase === 'lendo') return 'Lendo no ML: ' + (l.ids.length - qt('fila') - qt('lendo')) + ' de ' + l.ids.length + '…';
        if (l.fase === 'lista') return l.lento ? 'A lista inteira ainda está sendo lida. A agenda se atualiza sozinha quando terminar.'
            : 'Lendo a lista inteira de anúncios… a agenda se atualiza sozinha.';
        if (l.motivo === 'login') return 'Não consegui ler: entre no painel do vendedor neste Chrome (vendedores.mercadolivre.com.br) e clique em "Ler de novo".';
        if (l.motivo === 'outra_conta') return 'O Mercado Livre está aberto em outra conta neste Chrome. Entre na conta certa e clique em "Ler de novo".';
        const p = SHC.canalLeituraPartes(l);
        return [p.ok, p.falta].filter(Boolean).join(' · ') || 'Nada para ler.';
    };
    /** Resultado (fase 'fim', sem motivo) em duas partes: ok = o que deu certo (verde); falta = o que ainda falta (âmbar/vermelho). */
    SHC.canalLeituraPartes = function (l) {
        const est = l.est || {}, qt = s => l.ids.filter(id => est[id] === s).length, pl = (k, um, varios) => k + (k === 1 ? um : varios);
        const lidos = qt('lido'), nao = qt('nao'), erro = qt('erro'), partes = [];
        let ok = '';
        if (lidos) {   // onde cada lido está agora: na agenda (entraram) ou num grupo do "Fora da agenda" (onde = {título: n})
            const dest = [], onde = l.onde || {};
            if (l.entraram) dest.push([l.entraram, 'na agenda']);
            Object.keys(onde).forEach(t => dest.push([onde[t], 'em "' + t + '"']));
            const resto = lidos - dest.reduce((s, d) => s + d[0], 0);
            if (resto > 0 && dest.length) dest.push([resto, null]);
            const so = dest.length === 1 ? dest[0][1] : null;
            ok = ('✓ ' + pl(lidos, ' lido', ' lidos') + (dest.length > 1 ? ': ' + dest.map(([k, o]) => o ? k + ' ' + o : pl(k, ' conferido', ' conferidos')).join(', ')
                : so === 'na agenda' ? (lidos === 1 ? ': entrou na agenda' : ': entraram na agenda')
                : so ? ': agora ' + (lidos === 1 ? 'está ' : 'estão ') + so : ''));
        }
        // a lista inteira não foi relida (outra sincronização já tinha passado dela): uma frase curta no lugar do "não achado"
        if (nao && l.listaOcupada && !l.erroLista) partes.push('Falta ' + nao + ': a sincronização já passou pela lista. Clique em "Ler de novo" quando ela terminar');
        else if (nao) partes.push(pl(nao, ' não achado no ML', ' não achados no ML') + ': pode ser de outra conta, estar encerrado ou excluído');
        if (erro) partes.push(pl(erro, ' sem resposta do ML', ' sem resposta do ML') + ': clique em "Ler de novo" em alguns minutos');
        if (l.erroLista) partes.push('a lista inteira não foi lida: ' + l.erroLista);
        return { ok, falta: partes.join(' · ') };
    };

    /**
     * Registro guardado em shc:canal:plano:<canal> (a tela, o robô e o painel lateral leem este): o plano, as escolhas da seller e
     * "prontos" = quem pode entrar (na agenda ou sem horário livre), da MESMA regra (SHC.canalRanking).
     */
    SHC.canalRegistro = function (plano, fora, opcoes, agoraMs) {
        const prontos = new Map();
        (plano || []).forEach(s => { if (s.itemId && !prontos.has(s.itemId)) prontos.set(s.itemId, { itemId: s.itemId, titulo: s.titulo, lucro: s.lucro, pct: s.pct, dia: s.dia, feito: !!s.feito }); });
        (fora || []).filter(x => x.tipo === 'semVaga').forEach(x => { if (!prontos.has(x.itemId)) prontos.set(x.itemId, { itemId: x.itemId, titulo: x.titulo, lucro: x.lucro, pct: x.pct, dia: x.dia, semVaga: true }); });
        const g = SHC.canalGrupos(fora);
        return { ts: agoraMs || Date.now(), plano, opcoes: opcoes || {}, prontos: [...prontos.values()], fora: { total: g.total, resumo: g.resumo } };
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

    /** "12 comunicações de 24/09 a 02/10": conta os cartões com produto; o período é o da agenda inteira (dia sem produto também). */
    SHC.canalResumo = function (plano) {
        const ok = (plano || []).filter(s => s.itemId);
        if (!ok.length) return 'Nenhuma comunicação na agenda';
        const dias = (plano || []).map(s => s.dia).filter(Boolean).sort();
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

    // ── 4b. Conferência no ML: a transmissão que a fila marcou "criada" existe mesmo no ML? ─────────────
    // O "criada" da fila é só o clique da seller em "Criar" (ml-canal.js). Aqui ela é conferida na lista do próprio canal
    // (histórico: properties.campaigns / API campaigns), com o status e os números que o ML mostra. Só leitura.
    // Visto ao vivo (24/09/2026): status "Enviada" (status:'success'). Os textos de programada/cancelada: a confirmar ao vivo.
    SHC.CANAL_QUEM_FAZ = 'O Copiloto monta a agenda e pré-preenche o formulário. Quem cria cada transmissão é você, no ML. Quem envia aos seguidores é o próprio ML — o Copiloto não impulsiona nem paga divulgação.';
    SHC.CANAL_CONF_ROTULO = { enviada: '✓ enviada', programada: '✓ programada no ML', cancelada: '✗ cancelada no ML', outro: 'no ML: ', nao_achei: '✗ não achei no ML', nao_lido: 'não conferido' };
    SHC.CANAL_CRIADAS_DIAS = 14;   // quanto tempo a lista de "criadas" fica guardada para conferir

    /** Status de uma campanha lida (SHC.canalCampanhas) → 'enviada' | 'programada' | 'cancelada' | 'outro'. */
    SHC.canalStatusML = function (c) {
        if (!c) return 'outro';
        const t = String(c.status || '').toLowerCase(), cod = String(c.statusCod || '').toLowerCase();
        if (/cancel|exclu|removid|rejeit|recusad|reprovad|falh|erro|n[aã]o\s+enviad|expirad|pausad/.test(t) || /error|fail|cancel|reject|danger|negative/.test(cod)) return 'cancelada';
        if (c.enviada) return 'enviada';
        // Só "programada" o que diz programada/agendada. Revisão, análise, pendente, aguardando e os códigos info/warning/accent nunca foram
        // vistos ao vivo: vão para 'outro' (a tela mostra o texto cru do ML) e não somam em "confirmadas".
        if (/program|agend/.test(t) || /schedul|program/.test(cod)) return 'programada';
        return 'outro';
    };

    /**
     * Lista de transmissões "criadas" (guardada no registro do canal, reg.criadas): junta as já guardadas, os cartões do plano com
     * feito e os itens da fila com estado 'feito' do MESMO canal. Sem repetir (id + produto); some depois de CANAL_CRIADAS_DIAS dias.
     * → [{ id, itemId, tipo, dia, hora, nome, titulo, ts }] em ordem de dia e hora
     */
    SHC.canalGuardaCriadas = function (criadas, plano, fila, storefrontId, agoraMs) {
        const agora = agoraMs || Date.now(), limite = iso(new Date(agora - SHC.CANAL_CRIADAS_DIAS * 864e5)), out = new Map();
        const poe = (x, ts) => {
            if (!x || !x.itemId || !/^\d{4}-\d{2}-\d{2}$/.test(x.dia || '') || x.dia < limite) return;
            const k = x.id + '|' + x.itemId;
            if (out.has(k)) return;
            out.set(k, { id: String(x.id || ''), itemId: x.itemId, tipo: x.tipo, dia: x.dia, hora: +x.hora, nome: String(x.nome || SHC.canalNome(x)).slice(0, 60),
                titulo: String(x.titulo || '').slice(0, 120), ts: ts || agora });
        };
        (criadas || []).forEach(x => poe(x, x && x.ts));
        (plano || []).forEach(s => { if (s && s.feito) poe(s); });
        if (fila && fila.storefrontId === storefrontId && Array.isArray(fila.itens)) fila.itens.forEach(i => { if (i && i.estado === 'feito') poe(i, i.clicou); });
        return [...out.values()].sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : a.hora - b.hora));
    };

    // Segunda a domingo da semana de `agora` → ['AAAA-MM-DD', 'AAAA-MM-DD']
    const semanaDe = agora => { const d = new Date(agora), seg = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)); return [iso(seg), iso(new Date(seg.getFullYear(), seg.getMonth(), seg.getDate() + 6))]; };
    const nomeNorm = t => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const mesmoNome = (a, b) => { a = nomeNorm(a); b = nomeNorm(b); return !!a && !!b && (a === b || (Math.min(a.length, b.length) >= 20 && (a.indexOf(b) === 0 || b.indexOf(a) === 0))); };

    /**
     * Confere cada "criada" na lista do ML. Casa pelo nome que o Copiloto pôs no formulário ("25/09 19h · …") e, se a seller mudou o nome,
     * pelo mesmo dia, hora e tipo (e produto, quando o ML mostra). Cada campanha do ML casa com uma criada só.
     * campanhas = null → ainda não lido ('nao_lido'). Lista cheia (60 por tipo) e criada mais velha que a mais velha lida → 'nao_lido'.
     * → { ts, lido, itens:[criada + {estado, status, envios, vistas, cliques, ctr, vendas, valor}], semana:{ini, fim, criadas, confirmadas,
     *     enviadas, programadas, canceladas, naoAchadas, naoLidas, vistas, cliques} }
     */
    SHC.canalConfere = function (criadas, campanhas, agoraMs) {
        const agora = agoraMs || Date.now(), lido = Array.isArray(campanhas), cs = lido ? campanhas.filter(Boolean) : [], usadas = new Set();
        const maisVelho = {}, porTipo = {};
        cs.forEach(c => { porTipo[c.tipo] = (porTipo[c.tipo] || 0) + 1; if (c.dia && (!maisVelho[c.tipo] || c.dia < maisVelho[c.tipo])) maisVelho[c.tipo] = c.dia; });
        const tipos = x => x.tipo === 'ambos' ? ['channel', 'story'] : [x.tipo];
        const itens = (criadas || []).filter(x => x && x.itemId).map(x => {
            const livres = cs.filter(c => !usadas.has(c) && tipos(x).indexOf(c.tipo) >= 0);
            const c = livres.find(k => mesmoNome(k.nome, x.nome))
                || livres.find(k => k.dia === x.dia && k.hora === +x.hora && (!k.itemId || k.itemId === x.itemId));
            const base = Object.assign({}, x, { estado: 'nao_lido', status: '', envios: null, vistas: null, cliques: null, ctr: null, vendas: null, valor: null });
            if (c) {
                usadas.add(c);
                return Object.assign(base, { estado: SHC.canalStatusML(c), status: c.status || '', envios: c.envios, vistas: c.vistas, cliques: c.cliques, ctr: c.ctr, vendas: c.vendas, valor: c.valor });
            }
            if (!lido) return base;
            const foraDaLista = tipos(x).every(t => (porTipo[t] || 0) >= 60 && maisVelho[t] && x.dia < maisVelho[t]);
            base.estado = foraDaLista ? 'nao_lido' : 'nao_achei';
            return base;
        });
        const [ini, fim] = semanaDe(agora), sem = itens.filter(i => i.dia >= ini && i.dia <= fim);
        const conta = e => sem.filter(i => i.estado === e).length;
        const soma = k => { const v = sem.filter(i => i.estado === 'enviada' && i[k] !== null && i[k] !== undefined); return v.length ? v.reduce((s, i) => s + i[k], 0) : null; };
        return { ts: agora, lido, itens, semana: { ini, fim, criadas: sem.length, confirmadas: conta('enviada') + conta('programada'), enviadas: conta('enviada'), programadas: conta('programada'),
            canceladas: conta('cancelada'), naoAchadas: conta('nao_achei'), naoLidas: conta('nao_lido'), vistas: soma('vistas'), cliques: soma('cliques') } };
    };

    /**
     * "Voltar para a fila": a criada que o ML não tem (não achada/cancelada) deixa de ser "criada" no plano, na lista de criadas e na fila
     * (item da fila volta a 'pendente'; sem isso o canalMarcaFeitos marcaria de novo). Muda plano no lugar. → { plano, criadas, fila, filaMudou }
     */
    SHC.canalDesfazCriada = function (plano, criadas, fila, id, itemId) {
        const s = (plano || []).find(x => x.id === id && x.itemId === itemId);
        if (s) s.feito = false;
        const cr = (criadas || []).filter(x => !(x.id === id && x.itemId === itemId));
        let filaMudou = false;
        ((fila && fila.itens) || []).forEach(i => { if (i.id === id && i.itemId === itemId && i.estado === 'feito') { i.estado = 'pendente'; i.clicou = 0; filaMudou = true; } });
        return { plano, criadas: cr, fila, filaMudou };
    };

    /** Rótulo curto do status conferido ("✓ programada no ML", "no ML: Em revisão"). */
    SHC.canalConfRotulo = i => !i ? '' : i.estado === 'outro' ? SHC.CANAL_CONF_ROTULO.outro + (i.status || 'status desconhecido') : (SHC.CANAL_CONF_ROTULO[i.estado] || '');
    const milhar = v => Math.round(v).toLocaleString('pt-BR');
    /** Alcance que o ML mostra: "1.815 enviadas · 300 vistas · 40 cliques · CTR 4% · 1 venda" (só o que veio). '' sem números. */
    SHC.canalAlcanceTxt = function (i) {
        if (!i) return '';
        const p = [];
        if (i.envios !== null && i.envios !== undefined) p.push(milhar(i.envios) + ' enviadas');
        if (i.vistas !== null && i.vistas !== undefined) p.push(milhar(i.vistas) + (i.vistas === 1 ? ' vista' : ' vistas'));
        if (i.cliques !== null && i.cliques !== undefined) p.push(milhar(i.cliques) + (i.cliques === 1 ? ' clique' : ' cliques'));
        if (i.ctr !== null && i.ctr !== undefined) p.push('CTR ' + String(i.ctr).replace('.', ',') + '%');
        if (i.vendas !== null && i.vendas !== undefined) p.push(milhar(i.vendas) + (i.vendas === 1 ? ' venda' : ' vendas'));
        return p.join(' · ');
    };
    /**
     * Frase do painel: "3 transmissões confirmadas no ML esta semana (2 enviadas · 1 programada)" + o que não bateu.
     * → { titulo, detalhe, cor:'ok'|'at'|'pr'|'ne' } | null (nunca conferido)
     */
    SHC.canalSemanaTxt = function (conf, agoraMs) {
        if (!conf || !conf.semana) return null;
        const s = conf.semana, qt = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);
        const partes = [];
        if (s.enviadas) partes.push(qt(s.enviadas, 'enviada', 'enviadas'));
        if (s.programadas) partes.push(qt(s.programadas, 'programada', 'programadas'));
        const titulo = s.confirmadas ? qt(s.confirmadas, 'transmissão confirmada', 'transmissões confirmadas') + ' no ML esta semana' + (partes.length ? ' (' + partes.join(' · ') + ')' : '')
            : !conf.lido ? 'Transmissões desta semana ainda não conferidas no ML' : 'Nenhuma transmissão confirmada no ML esta semana';
        const det = [], al = [];
        if (s.naoAchadas) al.push(qt(s.naoAchadas, 'marcada como criada que não achei no ML', 'marcadas como criadas que não achei no ML'));
        if (s.canceladas) al.push(qt(s.canceladas, 'cancelada no ML', 'canceladas no ML'));
        if (s.vistas !== null || s.cliques !== null) det.push('alcance das enviadas: ' + [s.vistas !== null ? milhar(s.vistas) + ' vistas' : '', s.cliques !== null ? milhar(s.cliques) + ' cliques' : ''].filter(Boolean).join(' · '));
        const h = new Date(conf.ts || agoraMs || Date.now());
        det.push('conferido no ML em ' + String(h.getDate()).padStart(2, '0') + '/' + String(h.getMonth() + 1).padStart(2, '0') + ' às ' + String(h.getHours()).padStart(2, '0') + ':' + String(h.getMinutes()).padStart(2, '0'));
        // cor = a do título (verde quando há confirmadas); o que não bateu vai à parte em "alerta" (vermelho), para não pintar o que deu certo.
        return { titulo, detalhe: det.join(' · '), alerta: al.join(' · '), cor: s.confirmadas ? 'ok' : !conf.lido || !s.criadas ? 'ne' : al.length ? 'pr' : 'at' };
    };

    // ── 5. Leitura do ML e robô do canal (sem tela: a agenda e o service worker usam as mesmas) ─────────────
    // buscar(caminho, json) → Promise<texto | JSON>, lança erro se o ML não responde (a tela e o fundo põem tempo limite). Só GET.
    const espera = ms => new Promise(r => setTimeout(r, ms));

    /** Histórico e produtos que podem ser comunicados de um canal. aviso(texto) = andamento. → { campanhas, produtos, precos:{} } */
    SHC.canalLer = async function (buscar, id, aviso) {
        const q = encodeURIComponent(id), diz = aviso || (() => {});
        const campanhas = await SHC.canalLerHistorico(buscar, id, diz);
        // Produtos elegíveis. Mapeado ao vivo em 01/10/2026: &page=N e &offset=N na página são IGNORADOS (voltam os mesmos 10); a página
        // traz pagination {total, limit:10, offset:0} e o "Vá para a página 2" da tela pede GET /marketing/canal/api/broadcast/promotions
        // ?storefrontId=…&offset=10&input= (JSON {pagination, items:[{properties:{itemId, title, promotions, availableUnits, cardInfo…}}]}).
        // A ordem dos itens muda entre pedidos: junta sem repetir pelo MLB.
        // F14: página que NÃO respondeu (2 tentativas) ≠ fim da lista: marca incompleto e a tela pede "Ler de novo".
        const produtos = [], vistos = new Set(), junta = l => l.forEach(x => { if (!vistos.has(x.itemId)) { vistos.add(x.itemId); produtos.push(x); } });
        const duas = async (c, j) => { let r = await buscar(c, j).catch(() => null); if (r === null || r === undefined) { await espera(1500); r = await buscar(c, j).catch(() => null); } return r === undefined ? null : r; };
        let falhou = 0;
        diz('Lendo os produtos em promoção… página 1');
        const html = await duas('/marketing/canal-de-transmissao/lista-produtos-promocao?storefrontId=' + q, false);
        if (html === null) falhou = 1;
        const est = html === null ? null : SHC.mlExtraiEstado(html), pg = est ? SHC.canalPaginacao(est) : null;
        if (est) junta(SHC.canalProdutos(est));
        const lim = pg && pg.limit > 0 ? pg.limit : 10, total = pg ? pg.total : null;
        for (let off = lim, p = 2; !falhou && total !== null && off < total && p <= 200; off += lim, p++) {
            await espera(350);
            diz('Lendo os produtos em promoção… página ' + p + ' de ' + Math.ceil(total / lim));
            const j = await duas('/marketing/canal/api/broadcast/promotions?storefrontId=' + q + '&offset=' + off + '&input=', true);
            if (j === null) { falhou = p; break; }
            junta(SHC.canalProdutos(j));
        }
        return Object.assign({ campanhas, produtos, precos: {}, total }, falhou ? { incompleto: true, paginaFalhou: falhou } : {});
    };
    /** pagination {total, limit, offset} da lista de produtos do canal (página ou JSON) → {total, limit} | null. */
    SHC.canalPaginacao = function (r) {
        let out = null;
        anda(r, o => { const p = o.pagination; if (!out && p && typeof p === 'object' && SHC.num(p.total) !== null) { out = { total: SHC.num(p.total), limit: SHC.num(p.limit) || 0 }; return false; } });
        return out;
    };
    /** F14: aviso da leitura cortada ('' quando a lista foi lida até o fim). */
    SHC.canalAvisoIncompleto = d => d && d.incompleto ? 'Li ' + d.produtos.length + (typeof d.total === 'number' ? ' de ' + d.total : '') + ' produto' + (d.produtos.length === 1 && typeof d.total !== 'number' ? '' : 's') + '; o Mercado Livre não respondeu a página '
        + d.paginaFalhou + '. Clique em "Ler de novo do ML" para ver a lista toda.' : '';

    /** Só o histórico do canal (mensagens e stories já criados, com status e números do ML) → campanhas (SHC.canalCampanhas). */
    SHC.canalLerHistorico = async function (buscar, id, aviso) {
        const q = encodeURIComponent(id), diz = aviso || (() => {});
        diz('Lendo o histórico do canal…');
        const campanhas = SHC.canalCampanhas(SHC.mlExtraiEstado(await buscar('/marketing/canal-de-transmissao?storefront_id=' + q, false)));
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
        return campanhas;
    };

    /** Preço da promoção de um produto num dia (promotions-info): > 0 = preço; 0 = sem promoção naquele dia; -1 = a consulta falhou. */
    SHC.canalPrecoDe = (buscar, sf) => async (itemId, dia, hora) => {
        const j = await buscar('/marketing/canal/api/broadcast/promotions-info?date=' + encodeURIComponent(dia + 'T' + hh(hora || 10))
            + '&selectedItem=' + encodeURIComponent(itemId) + '&storefrontId=' + encodeURIComponent(sf), true).catch(() => null);
        await espera(250);
        return j ? (SHC.canalPrecoPromo(j) || 0) : -1;
    };

    /**
     * Dados fixos do ranking: retrato de anúncios (também o do catálogo que o ML indica), custos (SKU → anúncio → família), meta
     * (opc.meta ou a de Seus números), "não repetir" (opc.repetir) e o que já foi comunicado. O cache de preços (dados.precos) continua.
     */
    SHC.canalContexto = async function (dados, opc, agora) {
        const o = opc || {}, cfg = await SHC.lerCfg(), snap = await SHC.lerAnuncios(), anuncios = {};
        ((snap && snap.itens) || []).forEach(i => { if (i && i.itemId) anuncios[i.itemId] = i; });
        const alvo = dados.produtos.map(p => anuncios[p.itemId] || anuncios[SHC.canalAlvoCatalogo(p.motivo)]).filter(Boolean);
        // F3: todos os SKUs do anúncio (variação usa o maior custo), não só o 1º.
        const mapa = await SHC.custosDe(alvo.map(i => ({ sku: i.sku, skus: i.skus || [], skuFonte: i.skuFonte || '', familia: i.familia, itemId: i.itemId })));
        const custos = {};
        mapa.forEach((v, info) => { if (v) custos[info.itemId] = v.dados; });
        const meta = SHC.num(o.meta);
        return { anuncios, custos, cfg, metaPct: meta !== null && meta >= 0 ? meta : SHC.canalMetaInicial(cfg), recentes: SHC.canalRecentes(dados.campanhas),
            hoje: iso(agora || new Date()), diasSemRepetir: +o.repetir || 3, precos: dados.precos };
    };

    /** Cartões que ainda valem (criados no ML ou de hoje em diante, depois da hora atual). */
    SHC.canalValendo = (plano, agora) => {
        const hoje = iso(agora);
        return (plano || []).filter(s => s && (s.dia > hoje || (s.dia === hoje && s.hora > agora.getHours())));
    };

    /** Robô do canal: roda 1 vez por dia, só ligado (shc:canal:robo.ligado) e com um canal escolhido. */
    SHC.canalRoboDeveRodar = (robo, salvo, agora) => !!(robo && robo.ligado) && !(salvo && salvo.robo && salvo.robo.dia === iso(agora));

    /**
     * "Agenda de amanhã pronta: 4 transmissões — clique em Programar no ML" (null = nada para avisar). Conta no plano de agora os cartões
     * do dia que o robô preparou ainda não criados no ML: depois de programar, o aviso some.
     */
    SHC.canalAvisoRobo = function (reg, agora) {
        const r = reg && reg.robo, hoje = iso(agora);
        if (!r || !r.proximo || r.proximo < hoje) return null;
        const n = ((reg && reg.plano) || []).filter(s => s && s.dia === r.proximo && s.itemId && !s.feito).length;
        if (!n) return null;
        const am = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 1);
        const quando = r.proximo === iso(am) ? 'amanhã' : r.proximo === hoje ? 'hoje' : DIAS_SEMANA[dowDe(r.proximo)].toLowerCase() + ' ' + SHC.canalDataCurta(r.proximo);
        return 'Agenda de ' + quando + ' pronta: ' + n + (n === 1 ? ' transmissão' : ' transmissões') + ' — clique em Programar no ML';
    };

    /**
     * Uma passada do robô: lê o canal, monta os próximos dias com a MESMA regra da tela (SHC.canalMontaAgenda), mantendo o que a seller
     * já tinha e o que já foi criado no ML. Não cria nada no ML. salvo = registro anterior (shc:canal:plano:<canal>). → registro novo
     */
    SHC.canalRoboPassada = async function (buscar, sf, salvo, agora) {
        const dados = await SHC.canalLer(buscar, sf), op = (salvo && salvo.opcoes) || {};
        const horas = Array.isArray(op.horas) && op.horas.length ? op.horas : SHC.canalMelhoresHorarios(dados.campanhas, 2).horas;
        const tipos = Array.isArray(op.tipos) && op.tipos.length ? op.tipos : ['channel', 'story'];
        const ctx = await SHC.canalContexto(dados, op, agora);
        const janela = SHC.canalJanela(agora, SHC.canalUltimoDiaPadrao(agora, DIAS_JANELA), horas);
        const plano = await SHC.canalMontaAgenda(janela, tipos, dados.produtos, ctx, SHC.canalPrecoDe(buscar, sf), SHC.canalValendo(salvo && salvo.plano, agora));
        const dias = [...new Set(janela.map(j => j.dia).concat(plano.map(s => s.dia)))];
        const reg = SHC.canalRegistro(plano, SHC.canalForaLista(plano, dados.produtos, ctx, dias), Object.assign({}, op, { horas, tipos }), agora.getTime());
        const hoje = iso(agora), proximo = plano.filter(s => s.itemId && !s.feito && s.dia > hoje).map(s => s.dia).sort()[0] || '';
        reg.robo = { ts: agora.getTime(), dia: hoje, proximo, n: plano.filter(s => s.dia === proximo && s.itemId && !s.feito).length };
        // Conferência no ML das "criadas" (com as do plano velho, antes de os horários passados saírem), com o histórico que já foi lido.
        let fila = null;
        try { fila = SHC.lerChave ? await SHC.lerChave('shc:canal:fila') : null; } catch (e) { /* sem fila */ }
        reg.criadas = SHC.canalGuardaCriadas(salvo && salvo.criadas, (salvo && salvo.plano || []).concat(plano), fila, sf, agora.getTime());
        reg.conferencia = SHC.canalConfere(reg.criadas, dados.campanhas, agora.getTime());
        return reg;
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = SHC;

    // ── 3. Tela (agenda-canal.html) ──────────────────────────────────────────────────────────
    // 3.2.1: só numa página da própria extensão. Nas páginas do Canal este arquivo também roda (só dá SHC.canal* ao ml-canal.js):
    // ali quem decidiria se a tela liga seria o DOM do ML (um id="shc-agenda" na página).
    if (typeof document === 'undefined' || !root.location || root.location.protocol !== 'chrome-extension:' || !document.getElementById('shc-agenda') || !root.chrome || !chrome.storage) return;

    const $ = id => document.getElementById(id);
    const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const ehLogin = u => /login|registration|\/lgz\//i.test(u || '');
    const TEMPO_MS = 20000;   // (h) nenhuma leitura fica pendurada: 20 s por página
    const comLimite = (p, ms) => Promise.race([p, espera(ms).then(() => null)]);
    let canais = [], dados = null, plano = [], rctx = null, janela = [], horarios = null, fora = [], roboReg = null, esperaSync = false;
    let criadas = [], conf = null;   // 4b: o que a fila marcou "criada" e a conferência na lista do canal no ML
    const tentados = new Set();   // anúncios que a agenda já tentou ler sozinha nesta abertura

    // (h) "Lendo…" nunca fica parado: se nada muda em 60 s, a tela diz o que fazer.
    let vigia = null;
    const status = (t, erro) => {
        const e = $('status'); e.textContent = t || ''; e.className = 'msg' + (erro ? ' erro' : '');
        clearTimeout(vigia);
        if (t && !erro && /…$/.test(t)) vigia = setTimeout(() => status('O Mercado Livre está demorando para responder. Clique em "Ler de novo do ML" em alguns minutos.', true), 60000);
    };

    // Busca uma página do ML com a sessão do Chrome. Plano B: pede para uma aba aberta do Canal buscar (ml-canal.js).
    // info (opcional) recebe { http }: o status da resposta direta. Falha de rede, tempo esgotado ou ≥ 500 sem plano B → erro 'ml_fora'.
    async function buscar(caminho, json, info) {
        const url = BASE + caminho;
        let caiu = false;
        try {
            // buscarVendo: sessão caída (302 para o login sem CORS) volta com url de login → "Entre no painel", não "o ML não respondeu".
            const init = { credentials: 'include', cache: 'no-store' };
            if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(TEMPO_MS);
            const r = await SHC.buscarVendo(url, init);
            if (info) info.http = r.status;
            if (!ehLogin(r.url) && r.ok) return json ? r.json() : r.text();
            caiu = r.status >= 500;
            // 302 sem Location = conta sem canal (confirmado ao vivo em 25/09/2026); outra página de erro do ML com estado também
            // volta para a tela explicar (SHC.canalMLFora / canalSemCanal decidem). 5xx nunca vira "sem canal".
            if (!ehLogin(r.url) && !json && !caiu) { const t = await r.text(); if (r.status === 302 || SHC.mlExtraiEstado(t)) return t; }
        } catch (e) { caiu = true; /* falha de rede ou tempo esgotado: tenta pela aba */ }
        try {
            const abas = await chrome.tabs.query({ url: BASE + '/marketing/canal-de-transmissao*' });
            for (const a of abas) {
                const resp = await comLimite(chrome.tabs.sendMessage(a.id, { acao: 'canal_ler', url }).catch(() => null), TEMPO_MS + 5000);
                if (resp && resp.ok) return json ? JSON.parse(resp.texto) : resp.texto;
            }
        } catch (e) { /* sem aba */ }
        throw new Error(caiu ? 'ml_fora' : 'sem_sessao');
    }
    const estadoDe = async caminho => { const info = {}, html = await buscar(caminho, false, info); return { html, r: SHC.mlExtraiEstado(html), http: info.http }; };
    const precoDe = () => SHC.canalPrecoDe((c, j) => buscar(c, j), $('canal').value);

    function horasMarcadas() { return [...document.querySelectorAll('#horas input:checked')].map(i => +i.value); }
    function tiposMarcados() { return [...document.querySelectorAll('#tipos input:checked')].map(i => i.value); }
    const n = () => +$('repetir').value || 3;
    const opcoes = () => ({ horas: horasMarcadas(), tipos: tiposMarcados(), repetir: n(), meta: $('meta').value });

    // Retrato, custos e meta (SHC.canalContexto). (c) Anúncio do canal que o Copiloto ainda não leu: lê sozinho, 1 vez por abertura.
    async function ranquear(lerFaltando) {
        rctx = await SHC.canalContexto(dados, opcoes());
        const falta = SHC.canalSemLeitura(dados.produtos, rctx.anuncios).filter(id => !tentados.has(id));
        if (lerFaltando && falta.length && await lerAnuncios(falta.slice(0, 20))) rctx = await SHC.canalContexto(dados, opcoes());
    }
    // O fundo lê cada anúncio com a mesma leitura da lista de Anúncios da sincronização e junta no retrato (background: canal_ler_anuncios).
    // Leitura sozinha ao abrir: 1 pedido com todos, aviso só no topo.
    async function lerAnuncios(ids) {
        ids.forEach(id => tentados.add(id));
        status('Lendo no ML ' + (ids.length === 1 ? '1 anúncio que o Copiloto ainda não tinha…' : ids.length + ' anúncios que o Copiloto ainda não tinha…'));
        const r = await comLimite(Promise.resolve(chrome.runtime.sendMessage({ acao: 'canal_ler_anuncios', itemIds: ids })).catch(() => null), 90000);
        return ((r && r.lidos) || []).length;
    }

    // Botão do grupo ("Ler estes anúncios agora" / "Usar o anúncio do catálogo"): 1 anúncio por vez, para cada linha mostrar o andamento
    // de verdade; o retorno fica no grupo (SHC.canalLeitura*). Para no 1º "sem sessão"/"outra conta" e depois de 2 sem resposta seguidas.
    // O que o ?search= não achar vai pela lista inteira (sincronização); ao fim da etapa "Seus anúncios", a agenda se refaz e o grupo diz o resultado.
    const TEMPO_ANUNCIO_MS = 60000;   // lerPaginaML no fundo: página (20 s) + aba do ML (até 30 s)
    let leitura = null, vigiaLista = null;
    async function lerDoGrupo(tipo, ids) {
        const est = {};
        ids.forEach(id => { est[id] = 'fila'; tentados.add(id); });
        const l = leitura = { tipo, fase: 'lendo', ids, est };
        status('');
        pintaLeitura();
        let seguidas = 0;
        for (const id of ids) {
            est[id] = 'lendo'; pintaLeitura();
            const r = await comLimite(Promise.resolve(chrome.runtime.sendMessage({ acao: 'canal_ler_anuncios', itemIds: [id] })).catch(() => null), TEMPO_ANUNCIO_MS);
            if (r && Array.isArray(r.lidos) && r.lidos.indexOf(id) >= 0) { est[id] = 'lido'; seguidas = 0; }
            else if (r && r.ok) { est[id] = 'nao'; seguidas = 0; }
            else {
                est[id] = 'erro';
                if (r && (r.motivo === 'login' || r.motivo === 'outra_conta')) { l.motivo = r.motivo; break; }
                if (++seguidas >= 2) break;
            }
            pintaLeitura();
        }
        ids.forEach(id => { if (est[id] === 'fila' || est[id] === 'lendo') est[id] = 'erro'; });
        if (ids.some(id => est[id] === 'lido')) {   // espera um Salvar/cartão em curso terminar (a leitura não trava a tela, mas não refaz junto)
            while (ocupado) await new Promise(r => setTimeout(r, 300));
            ocupado = true;
            try { await recalcular(); } catch (e) { erro(e); } finally { ocupado = false; }   // o resultado da leitura aparece mesmo assim
        }
        if (leitura !== l) return;   // trocou de canal no meio
        if (!l.motivo && ids.some(id => est[id] === 'nao')) {
            const clique = Date.now();
            const s = await comLimite(Promise.resolve(chrome.runtime.sendMessage({ acao: 'sincronizar' })).catch(() => null), 15000);
            // Só espera a lista se a etapa "anuncios" vai começar DEPOIS do clique: sincronização nova (iniciou) ou uma em curso que ainda
            // não chegou nela. Uma que já passou dela não relê o que faltou → o grupo diz isso (sem "Lendo a lista…" que termina à toa).
            let vai = !!(s && s.iniciou === true);
            if (s && s.ok && !vai && s.emCurso) { const st = await SHC.lerChave('shc:status').catch(() => null), e = st && st.etapas && st.etapas.anuncios; vai = !!e && e.estado === 'fila'; }
            if (s && s.ok && !vai && leitura === l) l.listaOcupada = true;
            if (s && s.ok && vai && leitura === l) {
                l.desde = clique;
                esperaSync = true;
                l.fase = 'lista';
                clearTimeout(vigiaLista);
                vigiaLista = setTimeout(() => { if (leitura && leitura.fase === 'lista') { leitura.lento = true; pintaLeitura(); } }, 5 * 60e3);
                return pintaLeitura();
            }
        }
        fimLeitura();
    }
    // Resultado: quem está no retrato agora conta como lido (também o que veio pela lista inteira); "entraram" = já estão na agenda.
    function fimLeitura() {
        const l = leitura, an = (rctx && rctx.anuncios) || {};
        clearTimeout(vigiaLista);
        if (!l) return;
        l.ids.forEach(id => { if (an[id]) l.est[id] = 'lido'; });
        l.entraram = l.ids.filter(id => l.est[id] === 'lido' && plano.some(s => s.itemId === id && !s.feito)).length;
        l.onde = {};   // lido que não entrou: em que grupo do "Fora da agenda" ficou ("ainda não lido" = retrato atrasado, não conta)
        l.ids.forEach(id => {
            const x = l.est[id] === 'lido' && !plano.some(s => s.itemId === id && !s.feito) && fora.find(f => f.itemId === id && f.tipo !== 'leitura');
            const g = x && SHC.canalGrupos([x]).grupos[0];
            if (g) l.onde[g.titulo] = (l.onde[g.titulo] || 0) + 1;
        });
        l.fase = 'fim';
        l.lento = false;
        pintaLeitura();
        if ($('fora-card').hidden) status(SHC.canalLeituraTexto(l));   // ninguém mais fora: o resultado vai para o topo
    }
    async function depoisDaLista() {
        if (ocupado) return void setTimeout(depoisDaLista, 1000);
        ocupado = true;
        try { await recalcular(); } catch (e) { erro(e); } finally { ocupado = false; }
        if (leitura && leitura.fase === 'lista') fimLeitura();
    }
    // Pinta só o grupo da leitura (botão, frase e o andamento de cada linha); desenha() chama de novo depois de refazer os grupos.
    function pintaLeitura() {
        const l = leitura, sec = l && $('g-' + l.tipo);
        if (!sec || !sec.querySelector) return;
        const bt = sec.querySelector('[data-grupo]'), res = sec.querySelector('.res');
        if (bt) {
            bt.disabled = SHC.canalLeituraOcupada(l);
            bt.textContent = SHC.canalLeituraBotao(l, bt.dataset.botao);
            bt.className = 'bt sec pq' + (bt.disabled ? ' lendo' : '');
            bt.setAttribute('aria-busy', bt.disabled ? 'true' : 'false');
        }
        if (res) {
            const p = l.fase === 'fim' && !l.motivo ? SHC.canalLeituraPartes(l) : null;
            if (p && p.ok && p.falta) {   // deu certo em parte: o que deu certo em verde e, na linha de baixo, o que falta em âmbar
                const a = document.createElement('span'), b = document.createElement('span');
                a.className = 'r-ok'; a.textContent = p.ok;
                b.className = 'r-falta'; b.textContent = p.falta;
                res.textContent = '';
                res.append(a, b);
                res.className = 'res duas';
            } else {
                res.textContent = SHC.canalLeituraTexto(l);
                res.className = 'res' + (l.fase !== 'fim' ? '' : l.motivo || !l.ids.some(id => l.est[id] === 'lido') ? ' erro' : ' ok');
            }
        }
        (sec.querySelectorAll ? [...sec.querySelectorAll('[data-li]')] : []).forEach(li => {
            const e = li.querySelector('.and'), q = li.querySelector('.etq'), s = l.est[li.dataset.li];
            if (e) { e.textContent = s ? SHC.CANAL_LINHA_LEITURA[s] : ''; e.className = 'and' + (s ? ' a-' + s : ''); }
            if (q && q !== e) q.hidden = s === 'lido' || s === 'lendo' || s === 'nao';   // "ainda não leu" some quando a linha já diz o andamento
        });
    }

    async function montar() {
        janela = SHC.canalJanela(new Date(), $('ultimo').value, horasMarcadas());
        await ranquear(true);
        status('Conferindo a promoção de cada produto em cada dia…');
        plano = await SHC.canalMontaAgenda(janela, tiposMarcados(), dados.produtos, rctx, precoDe(), plano.filter(s => s.feito));
        await fechar();
    }
    // Depois de mexer na agenda: descobre quando começam as agendadas que ficaram fora, guarda e desenha.
    async function fechar() {
        status('Conferindo quem ficou fora…');
        await SHC.canalSonda(dados.produtos, rctx, janela, precoDe(), plano, 40);
        fora = SHC.canalForaLista(plano, dados.produtos, rctx, [...new Set(janela.map(j => j.dia).concat(plano.map(s => s.dia)))]);
        await salvar();
        await desenha();
        const inc = SHC.canalAvisoIncompleto(dados);   // F14: página que falhou não vira "fim da lista" calado
        status(inc, !!inc);
    }
    // Custo salvo, anúncios lidos: refaz o ranking e preenche os horários vazios (sem agenda nenhuma, monta de novo).
    async function recalcular() {
        if (!dados) return;
        await ranquear(false);
        if (!plano.some(s => !s.feito)) return montar();
        status('Conferindo a promoção de cada produto em cada dia…');
        plano = await SHC.canalPreenche(plano, dados.produtos, rctx, precoDe());
        await fechar();
    }

    // 4b: junta as "criadas" (plano + fila) e confere com o histórico lido do ML (dados.campanhas). O painel lê reg.conferencia.
    function confere(fila) {
        criadas = SHC.canalGuardaCriadas(criadas, plano, fila, $('canal').value);
        conf = SHC.canalConfere(criadas, dados ? dados.campanhas : null);
    }
    async function salvar() {
        const sf = $('canal').value, reg = SHC.canalRegistro(plano, fora, opcoes());
        if (roboReg && roboReg.robo) reg.robo = roboReg.robo;
        confere(await Promise.resolve(SHC.lerChave('shc:canal:fila')).catch(() => null));
        reg.criadas = criadas;
        reg.conferencia = conf;
        try { await SHC.gravarChave('shc:canal:plano:' + sf, reg); await SHC.gravarChave('shc:canal:sel', sf); } catch (e) { /* ok */ }
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

    const ic = nome => '<svg class="ic" aria-hidden="true"><use href="#i-' + nome + '"/></svg>';
    const CHECKLIST = 'Conferido: promoção confirmada no dia · lucro ≥ meta · custo · estoque · anúncio ativo · o ML deixa divulgar · não repetido';
    const curto = (t, max) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > max ? t.slice(0, max - 1) + '…' : t; };

    // 4b: status REAL lido na lista do canal no ML (não só "a dona clicou em Criar").
    const confDe = s => conf && conf.itens.find(i => i.id === s.id && i.itemId === s.itemId);
    const corConf = i => !i || i.estado === 'nao_lido' || i.estado === 'outro' ? 'ne' : i.estado === 'enviada' || i.estado === 'programada' ? 'ok' : 'pr';
    function etqFeito(s) {
        const i = confDe(s);
        if (!i || i.estado === 'nao_lido') return '<p class="st-ml cf-ne" title="Você clicou em Criar no ML. Ainda não conferi na lista do canal: clique em &quot;Conferir no ML&quot;.">✓ criada · a conferir no ML</p>';
        return '<p class="st-ml cf-' + corConf(i) + '" title="' + esc(i.status ? 'Status no ML: ' + i.status : '') + '">' + esc(SHC.canalConfRotulo(i)) + '</p>';
    }
    function cartao(s) {
        const d = document.createElement('div');
        d.className = 'cartao' + (s.itemId ? '' : ' vazio') + (s.feito ? ' feito' : '');
        d.dataset.id = s.id;
        const cf = s.feito ? confDe(s) : null, alc = SHC.canalAlcanceTxt(cf);
        const cab = '<div class="cab"><span class="tag t-' + esc(s.tipo) + '">' + esc(SHC.CANAL_TIPOS[s.tipo]) + '</span><b>' + hh(s.hora) + '</b>'
            + '</div>' + (s.feito ? etqFeito(s) : '')   // status do ML numa linha própria (no cabeçalho quebrava em 3 linhas)
            + (alc ? '<p class="alc">' + esc(alc) + '</p>' : '')
            + (cf && (cf.estado === 'nao_achei' || cf.estado === 'cancelada') ? '<p class="mot">Não está criada no ML. <button class="lnk" data-a="desfazer">Voltar para a fila</button></p>' : '');
        if (!s.itemId) { d.innerHTML = cab + '<p class="mot">' + esc(s.motivo) + '</p><div class="ac"><button class="lnk" data-a="remover">Remover</button></div>'; return d; }
        d.innerHTML = cab
            + '<div class="prod">' + (s.foto ? '<img alt="" src="' + esc(s.foto) + '">' : '') + '<span title="' + esc(s.titulo) + '">' + esc(s.titulo) + '</span></div>'
            + '<div class="luc">' + esc(SHC.moeda(s.lucro)) + ' <small>de lucro · ' + esc(SHC.pctTxt(s.pct)) + '</small></div>'
            + '<div class="chips"><span class="chip ok" title="' + esc(CHECKLIST) + '">✓ conferido</span>'
            + (s.agendada ? '<span class="chip at" title="A promoção agendada já vale neste dia (preço confirmado no ML).">promoção agendada</span>' : '')
            + (s.trocadoDe ? '<span class="chip az" title="O ML pediu este anúncio no lugar do #' + esc(String(s.trocadoDe).slice(3)) + ' (catálogo).">anúncio do catálogo</span>' : '') + '</div>'
            + '<div class="ac">' + (s.feito ? '' : '<button class="lnk" data-a="trocar">Trocar produto</button><button class="lnk" data-a="remover">Remover</button>')
            + '<button class="lnk" data-a="repetir">Repetir este horário em todos os dias</button>'
            + (s.feito ? '' : '<button class="lnk" data-a="tipos">Aplicar a todos os tipos</button>') + '</div>';
        return d;
    }

    // Horários do dia sem produto numa linha só ("10:00 e 19:00 · Nenhum produto livre: …"), para o que está programado aparecer.
    const juntaE = l => (l.length > 1 ? l.slice(0, -1).join(', ') + ' e ' + l[l.length - 1] : l[0] || '');
    function linhaVazios(dia, vaz) {
        const d = document.createElement('div');
        d.className = 'cartao vazios';
        d.dataset.dia = dia;
        const porMot = new Map(), nomeT = t => SHC.CANAL_TIPOS[t] || t;
        vaz.forEach(s => { const k = s.motivo || 'Sem produto.'; if (!porMot.has(k)) porMot.set(k, []); porMot.get(k).push(s); });
        // Todas as horas × todos os tipos → "10:00 e 19:00 · Mensagem e Story"; senão cada horário com o seu tipo.
        const quando = ss => { const hs = [...new Set(ss.map(s => s.hora))].sort((a, b) => a - b), ts = [...new Set(ss.map(s => s.tipo))];
            return hs.length * ts.length === ss.length ? juntaE(hs.map(hh)) + (new Set((plano || []).map(s => s.tipo)).size > 1 ? ' · ' + juntaE(ts.map(nomeT)) : '')
                : juntaE(ss.map(s => hh(s.hora) + ' ' + nomeT(s.tipo))); };
        d.innerHTML = [...porMot].map(([mot, ss]) => '<p class="mot"><b>' + esc(quando(ss)) + '</b> · ' + esc(mot) + '</p>').join('')
            + '<button class="lnk" data-a="remover-vazios">' + (vaz.length > 1 ? 'Tirar estes horários' : 'Tirar este horário') + '</button>';
        return d;
    }

    // "Ver mais (N)" ↔ "Ver menos" das listas longas: o resto já está no HTML (classe vm-x) dentro do bloco data-vm-box.
    const vmBotao = n => '<p class="vm-pe"><button class="lnk" type="button" data-vm-lista="Ver mais (' + n + ')" aria-expanded="false">Ver mais (' + n + ')</button></p>';
    if (document.addEventListener) document.addEventListener('click', e => {
        const bt = e.target && e.target.closest && e.target.closest('[data-vm-lista]');
        if (!bt) return;
        const box = bt.closest('[data-vm-box]'), ab = !!box && box.classList.toggle('vm-aberta');
        bt.textContent = ab ? 'Ver menos' : bt.getAttribute('data-vm-lista'); bt.setAttribute('aria-expanded', String(ab));
        if (!ab && box && box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
    });
    // Uma linha do "Fora da agenda": título curto + MLB + etiqueta do motivo (+ campo de custo no grupo "Sem custo").
    function linhaFora(x) {
        const id = esc(x.itemId);
        return '<li data-li="' + esc(x.alvo || x.itemId) + '"><span class="t" title="' + esc(x.titulo || x.itemId) + '">' + esc(curto(x.titulo || x.itemId, 40)) + '</span><code>' + id + '</code>'
            + '<span class="etq">' + esc(x.etiqueta || x.motivo) + '</span><span class="and"></span>'
            + (x.tipo === 'custo' ? '<span class="custo"><label>Custo R$ <input class="inp" inputmode="decimal" data-custo="' + id + '" placeholder="0,00" aria-label="Custo de ' + esc(curto(x.titulo, 40)) + '"></label>'
                + '<button class="bt pq" type="button" data-salvar="' + id + '">Salvar</button><small class="err" data-err="' + id + '"></small></span>' : '')
            + '</li>';
    }

    async function desenha() {
        const fila = await SHC.lerChave('shc:canal:fila');
        if (SHC.canalMarcaFeitos(plano, fila, $('canal').value)) await salvar();   // "criada" fica no plano do canal
        confere(fila);
        $('resumo').textContent = SHC.canalResumo(plano);
        const grade = $('grade');
        grade.textContent = '';
        const reg = SHC.canalRegistro(plano, fora, {}), g = SHC.canalGrupos(fora);
        const noPlano = plano.filter(s => s.itemId && !s.feito).length, podem = reg.prontos.length;
        const dias = [...new Set(plano.map(s => s.dia))].sort();
        // Números grandes: na agenda · podem entrar · fora
        $('k-agenda').textContent = noPlano;
        $('k-podem').textContent = podem;
        $('k-fora').textContent = g.total;
        $('kpi-fora').className = 'kpi ' + (g.total && !podem ? 'pr' : g.total ? 'at' : 'ok');
        $('kpi-podem').className = 'kpi ' + (podem ? 'ok' : 'pr');
        if (!dias.length) {
            grade.innerHTML = '<div class="est">' + ic(podem ? 'cal' : 'info') + '<p>' + (podem ? 'Nada na agenda. Marque horários e tipos e clique em "Montar agenda".'
                : g.total ? '<b>Nenhum produto pode entrar agora.</b> Veja abaixo, por motivo, o que falta para cada um.'
                : 'Não achei produtos em promoção para comunicar neste canal.') + '</p></div>';
        }
        dias.forEach(dia => {
            const col = document.createElement('section');
            col.className = 'dia';
            const h = document.createElement('h3');
            h.textContent = SHC.canalQuando(dia, 0).replace(/ às .*/, '');
            col.append(h);
            plano.filter(s => s.dia === dia && s.itemId).forEach(s => col.append(cartao(s)));
            const vaz = plano.filter(s => s.dia === dia && !s.itemId);
            if (vaz.length) col.append(linhaVazios(dia, vaz));   // horários sem produto: 1 linha curta, cinza, no fim do dia
            grade.append(col);
        });
        $('programar').disabled = !noPlano;
        $('programar').textContent = 'Programar no ML (' + noPlano + ')';
        const c = fila && fila.storefrontId === $('canal').value ? SHC.canalContagem(fila) : null;
        $('progresso').textContent = c && c.total ? c.feitos + ' de ' + c.total + ' criadas no ML' + (c.pulados ? ' · ' + c.pulados + ' puladas' : '') : '';
        // (f) Fora da agenda: barra empilhada por motivo + grupos com ícone, cor, contagem e UMA ação.
        $('fora-n').textContent = g.total;
        $('fora-card').hidden = !g.total;
        $('fora-resumo').textContent = g.resumo;
        $('fora-barra').innerHTML = g.grupos.map(x => '<i class="c-' + x.cor + '" style="flex:' + x.n + '" title="' + esc(x.n + ' ' + x.rotulo) + '">' + (x.n / g.total >= 0.06 ? x.n : '') + '</i>').join('');
        $('fora-legenda').innerHTML = g.grupos.map(x => '<button type="button" class="lg c-' + x.cor + '" data-ir="' + x.tipo + '"><i></i>' + esc(x.n + ' ' + x.rotulo) + '</button>').join('');
        // Todos do grupo da leitura já saíram dele: o grupo fica só com o resultado ("✓ 3 lidos…"), sem lista e sem botão.
        const gs = SHC.canalGruposComVazio(g.grupos, leitura && leitura.tipo);
        // O custo digitado e ainda não salvo sobrevive ao redesenho (ex.: a leitura do grupo terminou enquanto a dona digitava)
        const fg = $('fora-grupos'), digitado = {};
        (fg.querySelectorAll ? [...fg.querySelectorAll('[data-custo]')] : []).forEach(i => { if (i.value) digitado[i.dataset.custo] = i.value; });
        fg.innerHTML = gs.map(x => '<section class="grupo c-' + x.cor + '" id="g-' + x.tipo + '" data-vm-box>'
            + '<header>' + ic(x.icone) + '<b>' + esc(x.titulo) + '</b><span class="n">' + x.n + '</span></header>'
            + '<div class="acao"><span>' + esc(x.acao) + '</span>' + (x.botao ? '<button class="bt sec pq" type="button" data-grupo="' + x.tipo + '" data-botao="' + esc(x.botao) + '">' + esc(x.botao) + '</button>' : '') + '</div>'
            + (x.botao || !x.n ? '<p class="res" role="status" aria-live="polite"></p>' : '')
            + '<ul class="itens">' + x.itens.slice(0, 5).map(linhaFora).join('') + '</ul>'
            + (x.itens.length > 5 ? '<ul class="itens vm-x">' + x.itens.slice(5).map(linhaFora).join('') + '</ul>' + vmBotao(x.itens.length - 5) : '') + '</section>').join('');
        (fg.querySelectorAll ? [...fg.querySelectorAll('[data-custo]')] : []).forEach(i => { if (digitado[i.dataset.custo]) i.value = digitado[i.dataset.custo]; });
        pintaLeitura();
        if (!podem && g.total) $('fora-box').open = true;   // nada pode entrar: o porquê já vem aberto
        desenhaRobo();
        desenhaConf();
    }

    // 4b: "Conferência no ML" — cada transmissão marcada como criada, com o status e o alcance lidos na lista do canal.
    function desenhaConf() {
        const box = $('conf-card');
        if (!box) return;
        const t = SHC.canalSemanaTxt(conf), itens = conf ? conf.itens.slice().reverse() : [];
        box.hidden = !itens.length;
        if (!itens.length) return;
        $('conf-titulo').textContent = t ? t.titulo : '';
        $('conf-titulo').className = 'resumo cf-' + (t ? t.cor : 'ne');
        $('conf-det').textContent = t ? t.detalhe + '.' : '';
        // O que não bateu fica à parte, em vermelho, com o que fazer (o título verde continua dizendo o que deu certo).
        const naoAchou = itens.some(i => i.estado === 'nao_achei'), al = $('conf-alerta');
        if (al) {
            al.textContent = (t && t.alerta ? t.alerta + '. ' : naoAchou ? 'Há transmissão marcada como criada que não achei no ML. ' : '')
                + (naoAchou ? 'Talvez o formulário tenha sido fechado sem criar: confira no ML e, se faltar, use "Voltar para a fila" no cartão.' : '');
            al.hidden = !al.textContent;
        }
        $('conf-lista').innerHTML = itens.map((i, n) => {
            const alc = SHC.canalAlcanceTxt(i);
            return '<li' + (n >= 10 ? ' class="vm-x"' : '') + '><span class="t" title="' + esc(i.titulo || i.nome) + '">' + esc(SHC.canalQuando(i.dia, i.hora)) + ' · ' + esc(curto(i.titulo || i.nome, 40)) + '</span>'
                + '<span class="tag t-' + esc(i.tipo) + '">' + esc(SHC.CANAL_TIPOS[i.tipo] || i.tipo) + '</span>'
                + '<span class="etq cf-' + corConf(i) + '" title="' + esc(i.status ? 'Status no ML: ' + i.status : '') + '">' + esc(SHC.canalConfRotulo(i)) + '</span>'
                + (alc ? '<span class="alc">' + esc(alc) + '</span>' : '') + '</li>';
        }).join('') + (itens.length > 10 ? '<li class="vm-li">' + vmBotao(itens.length - 10) + '</li>' : '');
    }
    // Só a lista do canal (rápido): não relê os produtos nem refaz a agenda.
    async function conferirNoML() {
        if (!dados || ocupado) return;
        const b = $('conferir'), st = $('conf-status');
        b.disabled = true; st.textContent = 'Lendo a lista do canal no ML…'; st.className = 'msg';
        try {
            dados.campanhas = await SHC.canalLerHistorico((c, j) => buscar(c, j), $('canal').value);
            await salvar();
            await desenha();
            st.textContent = '';
        } catch (e) {
            st.textContent = 'Não consegui ler o canal no ML agora. Tente de novo em alguns minutos.'; st.className = 'msg erro';
        } finally { b.disabled = false; }
    }

    function desenhaRobo() {
        const r = roboReg && roboReg.robo, aviso = roboReg ? SHC.canalAvisoRobo(Object.assign({}, roboReg, { plano }), new Date()) : null;
        $('robo-info').textContent = r ? 'Última montagem do robô: ' + SHC.canalDataCurta(r.dia) + (aviso ? ' · ' + aviso + '.' : '.') : '';
    }

    let ocupado = false;
    $('grade').addEventListener('click', async e => {
        const b = e.target.closest('[data-a]'), card = e.target.closest('.cartao');
        if (!b || !card || ocupado) return;
        const id = card.dataset.id, a = b.dataset.a;
        // Trocar/repetir escolhem só entre quem já passou no dia (preço da promoção do dia confirmado ou promoção ativa).
        const cands = dia => SHC.canalRanking(dados.produtos, Object.assign({}, rctx, { dia })).candidatos;
        ocupado = true;
        try {
            if (a === 'desfazer') {   // 4b: não achei no ML (ou cancelada) → o cartão volta a "falta criar" e a fila oferece de novo
                const s = plano.find(x => x.id === id), r = SHC.canalDesfazCriada(plano, criadas, await SHC.lerChave('shc:canal:fila'), id, s && s.itemId);
                criadas = r.criadas;
                if (r.filaMudou) await SHC.gravarChave('shc:canal:fila', r.fila);
                await fechar();
                return;
            }
            if (a === 'trocar') plano = SHC.canalTrocarProduto(plano, id, cands, n());
            else if (a === 'remover') plano = SHC.canalRemover(plano, id);
            else if (a === 'remover-vazios') plano = plano.filter(s => !(s.dia === card.dataset.dia && !s.itemId && !s.feito));
            else if (a === 'repetir') plano = SHC.canalRepetirHorario(plano, id, janela.length ? janela : SHC.canalJanela(new Date(), $('ultimo').value, horasMarcadas()), cands, n(), new Date());
            else if (a === 'tipos') plano = SHC.canalAplicarTipos(plano, id, tiposMarcados());
            if (a !== 'remover' && a !== 'remover-vazios') { status('Conferindo a promoção de cada produto em cada dia…'); plano = await SHC.canalPreenche(plano, dados.produtos, rctx, precoDe()); }
            await fechar();
        } catch (err) { erro(err); } finally { ocupado = false; }
    });
    // "Fora da agenda": legenda leva ao grupo; botões dos grupos; custo salvo ali mesmo.
    $('fora-card').addEventListener('click', async e => {
        const ir = e.target.closest('[data-ir]'), gr = e.target.closest('[data-grupo]'), sv = e.target.closest('[data-salvar]');
        if (ir) { $('fora-box').open = true; const s = $('g-' + ir.dataset.ir); if (s && s.scrollIntoView) s.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
        // A leitura do grupo (até 60 s por anúncio) NÃO trava a tela: Salvar, os outros botões e os cartões continuam valendo.
        if (gr) {
            if (SHC.canalLeituraOcupada(leitura)) return;   // o botão já está desligado e girando
            const ids = [...new Set(fora.filter(x => x.tipo === gr.dataset.grupo).map(x => x.alvo || x.itemId))];
            if (ids.length) try { await lerDoGrupo(gr.dataset.grupo, ids); } catch (err) { erro(err); }
            return;
        }
        if (!sv) return;
        if (ocupado) { const er = document.querySelector('[data-err="' + sv.dataset.salvar + '"]'); if (er) er.textContent = 'Espere um instante e clique em Salvar de novo.'; return; }
        ocupado = true;
        try { await salvarCustoAqui(sv.dataset.salvar); } catch (err) { erro(err); } finally { ocupado = false; }
    });
    $('fora-card').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset && e.target.dataset.custo) { e.preventDefault(); const b = document.querySelector('[data-salvar="' + e.target.dataset.custo + '"]'); if (b) b.click(); } });
    // (e) Mesma chave e regra do "＋ Informar custo" da página de Anúncios: com SKU vale para todos os anúncios do SKU; sem SKU, só neste anúncio.
    async function salvarCustoAqui(itemId) {
        const inp = document.querySelector('[data-custo="' + itemId + '"]'), err = document.querySelector('[data-err="' + itemId + '"]');
        const v = SHC.num(inp && inp.value);
        if (!(v > 0)) { if (err) err.textContent = 'Digite um valor maior que zero. Ex.: 250,00'; return; }
        const a = (rctx && rctx.anuncios[itemId]) || {}, dados0 = { custo: v, titulo: String(a.titulo || '').slice(0, 120), origem: 'manual' };
        if (a.sku) await SHC.salvarCustoSku(a.sku, dados0); else await SHC.salvarCusto('ml', itemId, dados0);
        status('Custo salvo. Conferindo se o produto entra…');
        await recalcular();
    }
    // "Story e Canal" já manda os dois: não deixa marcar junto com Mensagem/Story.
    $('tipos').addEventListener('change', e => {
        const t = e.target;
        if (!t.checked) return;
        document.querySelectorAll('#tipos input').forEach(i => { if (i !== t && (t.value === 'ambos' || i.value === 'ambos')) i.checked = false; });
    });

    $('montar').addEventListener('click', () => montar().catch(erro));
    if ($('conferir')) $('conferir').addEventListener('click', () => conferirNoML());
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
        status('Abrimos o formulário do Mercado Livre. Confira e clique em "Criar" lá; o Copiloto abre o próximo. Depois, "Conferir no ML" mostra se cada uma ficou programada.');
    });
    chrome.storage.onChanged.addListener((m, area) => {
        if (area !== 'local') return;
        if (m['shc:canal:fila'] && plano.length) desenha();
        // "Ler estes anúncios agora" pediu a lista inteira: quando a etapa "Seus anúncios" termina (ou a sincronização), a agenda se refaz
        // e o grupo diz o resultado (mesmo sem nada novo no retrato).
        const st = m['shc:status'] && m['shc:status'].newValue, et = st && st.etapas && st.etapas.anuncios;
        if (esperaSync && SHC.canalListaLida(st)) {
            esperaSync = false;
            if (leitura && et && et.estado === 'erro') leitura.erroLista = String(et.erro || 'o Mercado Livre não respondeu').replace(/\.$/, '');
            else if (leitura && leitura.desde && !(et && et.inicio >= leitura.desde)) leitura.listaOcupada = true;   // a etapa não rodou depois do clique
            depoisDaLista();
        }
    });
    // (g) Robô do Canal: desligado por padrão; o alarme diário do fundo (shc-canal) só monta se estiver ligado.
    SHC.lerChave('shc:canal:robo').then(r => { $('robo').checked = !!(r && r.ligado); }).catch(() => {});
    $('robo').addEventListener('change', () => { SHC.gravarChave('shc:canal:robo', { ligado: $('robo').checked, ts: Date.now() }).catch(() => {}); });

    function erro(e) {
        if (e && e.message === 'ml_fora') return status(SHC.CANAL_ML_FORA, true);
        if (e && e.message === 'nao_lido') return status(SHC.CANAL_NAO_LIDO, true);
        status(e && e.message === 'sem_sessao'
            ? 'Não consegui ler o Mercado Livre. Entre no painel do vendedor neste Chrome (vendedores.mercadolivre.com.br) e clique em "Ler de novo do ML".'
            : 'Algo deu errado ao ler o Mercado Livre. Tente "Ler de novo do ML" em alguns minutos.', true);
    }

    // Conta sem canal (sem "Minha página"): aviso com link, no lugar da agenda — não é erro.
    // Em largura cheia no topo do cartão da agenda, com o link em botão; os contadores "0" somem e o motivo fica ao lado do botão desabilitado.
    function semCanal() {
        status('');
        plano = [];
        $('sem-canal-txt').textContent = SHC.CANAL_SEM_CANAL;
        $('sem-canal-link').href = SHC.CANAL_URL_MINHA_PAGINA;
        $('sem-canal').hidden = false;
        $('kpis').hidden = true;
        $('grade').replaceChildren();
        $('resumo').textContent = 'Sem canal nesta conta: nada para programar.';
        $('programar').disabled = true;
        $('montar').disabled = true;
        $('montar').title = SHC.CANAL_SEM_CANAL;
    }
    const comCanal = () => { $('sem-canal').hidden = true; $('kpis').hidden = false; $('montar').title = ''; };

    // lerCanais: lê de novo a lista de canais. A agenda salva do canal é reaproveitada; "Montar agenda" refaz.
    async function carregar(lerCanais) {
        status('Lendo os seus canais…');
        if (!canais.length || lerCanais) {
            // v3.0.1: visto ao vivo em 26/09/2026, a página "lista" passou a responder 302 + "Tivemos um problema" também para quem
            // TEM canal; a página principal do Canal traz o storefront. Principal primeiro; a lista só decide "sem canal" quando
            // a principal não traz nenhum.
            const p = await estadoDe('/marketing/canal-de-transmissao').catch(() => null);
            canais = p && !SHC.canalMLFora(p.r, p.http) ? SHC.canalCanais(p.r, p.html) : [];
            if (!canais.length) {
                const l = await estadoDe('/marketing/canal-de-transmissao/lista');
                if (SHC.canalMLFora(l.r, l.http)) { canais = []; throw new Error('ml_fora'); }
                canais = SHC.canalCanais(l.r, l.html);
                if (SHC.canalSemCanal(l.r, canais, l.http)) canais = [];
                else if (!canais.length) throw new Error('nao_lido');   // sem o 302 não dá para dizer que a conta não tem canal
            }
            const sel = $('canal'), salvo = await SHC.lerChave('shc:canal:sel');
            sel.textContent = '';
            canais.forEach((c, i) => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.nome || 'Canal ' + (i + 1); sel.append(o); });
            if (salvo && canais.some(c => c.id === salvo)) sel.value = salvo;
            $('canal-campo').hidden = canais.length < 2;
        }
        if (!canais.length) return semCanal();
        comCanal();
        $('montar').disabled = false;
        $('cupom').href = BASE + '/marketing/canal-de-transmissao?storefront_id=' + encodeURIComponent($('canal').value);
        plano = []; fora = []; leitura = null; criadas = []; conf = null;   // a agenda (e os "criada") de outro canal não passa para este
        dados = await SHC.canalLer((c, j) => buscar(c, j), $('canal').value, status);
        horarios = SHC.canalMelhoresHorarios(dados.campanhas, 2);
        const salvo = await SHC.lerChave('shc:canal:plano:' + $('canal').value);
        roboReg = salvo && salvo.robo ? salvo : null;
        // 4b: as "criadas" guardadas + as do plano salvo (antes de os horários passados saírem da agenda) → conferidas com o histórico lido agora
        criadas = SHC.canalGuardaCriadas(salvo && salvo.criadas, salvo && salvo.plano, null, $('canal').value);
        conf = SHC.canalConfere(criadas, dados.campanhas);
        const op = (salvo && salvo.opcoes) || {};   // as escolhas da última montagem (o robô usa as mesmas)
        if (Array.isArray(op.horas) && op.horas.length) horarios = Object.assign({}, horarios, { horas: op.horas });
        desenhaHorarios();
        if (Array.isArray(op.tipos) && op.tipos.length) document.querySelectorAll('#tipos input').forEach(i => { i.checked = op.tipos.indexOf(i.value) >= 0; });
        if (+op.repetir) $('repetir').value = String(op.repetir);
        const valendo = SHC.canalValendo(salvo && Array.isArray(salvo.plano) ? salvo.plano : [], new Date());
        if (valendo.some(s => s.itemId)) {
            plano = valendo;
            janela = SHC.canalJanela(new Date(), $('ultimo').value, horasMarcadas());
            await ranquear(true);
            status('Conferindo a promoção de cada produto em cada dia…');
            plano = await SHC.canalPreenche(plano, dados.produtos, rctx, precoDe());
            await fechar();
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
