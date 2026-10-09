// SellerHub Copiloto — onde ficam os dados: chrome.storage.local, só neste navegador.
//   cfg              → configurações (imposto, comissões, margem alvo)
//   c|<canal>|<id>   → custo de um anúncio  {custo, outros, frete, tipo, full, comissao_pct, titulo, atualizado}
//   v|<canal>|<id>   → anúncio visto numa tela (título/preço), pra montar a planilha de custos
// Uma chave por anúncio: duas abas salvando ao mesmo tempo não se atropelam.
(function (root) {
    'use strict';
    const SHC = root.SHC || (root.SHC = {});
    // ── v3.3 Multi-empresa (pedido da dona 07/10/2026: "o sistema tem que ser assertivo para não misturar os dados") ──
    // Conta do ML marcada em Ajustes como OUTRA EMPRESA (cfg.empresaSeparada = {sellerId: true}) tem só dela, enquanto ela é a conta aberta:
    //   · os custos por SKU: a chave lógica 'c|sku|X' é guardada como 'c|sku@<sellerId>|X';
    //   · o ERP (credencial e produtos lidos): 'erp:…' é guardado como 'erp@<sellerId>:…';
    //   · 3.3.0 (junção): a loja do TikTok (o prefixo do canal, SHC.PREFIXO_CANAL.tiktok) como o ERP: é da empresa da conta do ML aberta quando a
    //     tela do TikTok foi lida (o espaço entra depois de SHC.CANAIS, mais abaixo);
    //   · os números da empresa (SHC.CAMPOS_EMPRESA: imposto, margem, despesas fixas, plano da Shopee) em cfg.porConta[sellerId].
    // As contas não marcadas são a mesma empresa e dividem tudo, como sempre. O resto já é por conta (ml:anuncios:<c>, frete:<c>…) ou por
    // anúncio (c|ml|MLB…, ids únicos no ML). Tudo passa por area(): telas e fundo continuam usando a chave lógica; a de outra empresa some.
    const crua = () => chrome.storage.local;
    let empCache = null;
    SHC.empresaSeparada = async function () {
        if (empCache && Date.now() - empCache.ts < 1500) return empCache.e;
        const r = await crua().get(['ml:conta', 'cfg']), c = String(r['ml:conta'] || ''), sep = (r.cfg && r.cfg.empresaSeparada) || {};
        const e = /^\d{6,15}$/.test(c) && sep[c] === true ? c : '';
        empCache = { e, ts: Date.now() };
        return e;
    };
    try { chrome.storage.onChanged.addListener(m => { if (m && (m['ml:conta'] || m.cfg)) empCache = null; }); } catch (e) { /* sem onChanged (teste) */ }
    const ESPACOS = [['c|sku|', e => 'c|sku@' + e + '|', /^c\|sku@\d+\|/], ['erp:', e => 'erp@' + e + ':', /^erp@\d+:/]];
    SHC.chaveFisica = (k, e) => { if (!e || typeof k !== 'string') return k; const x = ESPACOS.find(([pre]) => k.indexOf(pre) === 0); return x ? x[1](e) + k.slice(x[0].length) : k; };
    // Física → lógica; null = é de OUTRA empresa (fica invisível para esta).
    SHC.chaveLogica = (k, e) => {
        for (const [pre, de, rx] of ESPACOS) {
            if (rx.test(k)) { const p = e ? de(e) : null; return p && k.indexOf(p) === 0 ? pre + k.slice(p.length) : null; }
            if (e && k.indexOf(pre) === 0) return null;
        }
        return k;
    };
    // forcada (revisão 07/10/2026): a empresa FIXA ('' = a das contas não separadas; sellerId = a conta separada). Quem lê do ERP por minutos
    // passa a empresa do começo da leitura: trocar a conta do ML no meio nunca grava os custos de uma empresa na outra. Sem ela: a conta aberta.
    const area = forcada => {
        const emp = () => (typeof forcada === 'string' ? Promise.resolve(forcada) : SHC.empresaSeparada());
        return areaDe(emp);
    };
    // Junção 3.3.0: chave fora de ESPACOS é a mesma em toda empresa, então vai direto, sem ler a empresa antes. A leitura a mais atrasava
    // cada get/set (o status gravado saía com o batimento de depois e quebrava o "1 por segundo"; a estimativa da sincronização mudava).
    const daEmpresa = ks => [].concat(ks).some(k => typeof k === 'string' && ESPACOS.some(([pre]) => k.indexOf(pre) === 0));
    const areaDe = emp => ({
        async get(ks) {
            if (ks !== null && ks !== undefined && !daEmpresa(ks)) return crua().get(ks);
            const e = await emp();
            if (ks === null || ks === undefined) {
                const t = await crua().get(null), o = {};
                Object.keys(t).forEach(k => { const l = SHC.chaveLogica(k, e); if (l !== null) o[l] = t[k]; });
                return o;
            }
            if (!e) return crua().get(ks);
            const lista = [].concat(ks), r = await crua().get(lista.map(k => SHC.chaveFisica(k, e))), o = {};
            lista.forEach(k => { const f = SHC.chaveFisica(k, e); if (f in r) o[k] = r[f]; });
            return o;
        },
        async set(obj) {
            if (!daEmpresa(Object.keys(obj))) return crua().set(obj);
            const e = await emp();
            if (!e) return crua().set(obj);
            const o = {};
            Object.keys(obj).forEach(k => { o[SHC.chaveFisica(k, e)] = obj[k]; });
            return crua().set(o);
        },
        async remove(ks) { if (!daEmpresa(ks)) return crua().remove(ks); const e = await emp(); return crua().remove(e ? [].concat(ks).map(k => SHC.chaveFisica(k, e)) : ks); },
        // Só as chaves desta empresa, com o nome lógico (como o get(null)). getKeys é do Chrome 130+; sem ele, o get(null).
        async getKeys() { const e = await emp(), c = crua(), ks = typeof c.getKeys === 'function' ? await c.getKeys() : Object.keys(await c.get(null)); return ks.map(k => SHC.chaveLogica(k, e)).filter(k => k !== null); },
    });
    SHC.areaEmpresa = area;   // para quem grava custo em lote (tiny.js) passar pelo mesmo caminho
    /**
     * Alguma OUTRA empresa ainda tem este ERP guardado ('erp:tiny' → 'erp:tiny' ou 'erp@<id>:tiny', fora o da empresa aberta)?
     * A permissão do Chrome para o site do ERP é uma só: o "Esquecer" de uma empresa só a tira quando nenhuma outra usa.
     */
    // Só conta a de conta AINDA marcada como outra empresa: o erp@<id> de uma conta desmarcada é sobra invisível e não segura a permissão.
    SHC.erpEmOutraEmpresa = async function (chave) {
        const minha = SHC.chaveFisica(chave, await SHC.empresaSeparada()), resto = String(chave).replace(/^erp:/, ''), t = await crua().get(null);
        const sep = (t.cfg && t.cfg.empresaSeparada) || {}, dono = k => (/^erp@(\d+):/.exec(k) || [])[1];
        return Object.keys(t).some(k => k !== minha && !!t[k] && (k === chave || (dono(k) && sep[dono(k)] === true && k.replace(/^erp@\d+:/, '') === resto)));
    };

    SHC.chave = (canal, id) => 'c|' + canal + '|' + id;

    // Custo por SKU: vale para TODOS os canais (ML, Shopee, …). O ML escreve "SKU F1-20-LILAS-RODA".
    // '|' vira '-' porque é o separador das chaves.
    SHC.normalizaSku = s => String(s || '').replace(/^\s*SKU[:\s]*/i, '').trim().toUpperCase().replace(/\s+/g, ' ').replace(/\|/g, '-').slice(0, 80);
    SHC.chaveSku = sku => { const n = SHC.normalizaSku(sku); return n ? 'c|sku|' + n : ''; };
    // Ordem ÚNICA de busca do custo de um anúncio (v2.4, V13): SKU → anúncio (MLB…) → família (F…). Devolve {chave, dados} ou null.
    // Exceção (30/09/2026, SHC.mlbNaFrente): anúncio com vários SKUs ou com SKU que a linha da lista não mostra → anúncio → SKU → família.
    // O painel lateral (P.lerCustosPainel) e as etiquetas usam esta mesma ordem.
    // Kit (produto composto): c|sku|<KIT>.kit = [{sku, q}] (SKU do componente normalizado × quantidade) e .outros = embalagem do kit.
    // Custo do kit = Σ custo do componente × q (+ "outros" do kit, como qualquer SKU). Custo DIGITADO no próprio kit ganha do
    // calculado (mesma regra do Tiny: origem 'manual', sem origem ou valor do ERP trocado à mão). Kit incompleto: não usa soma
    // (segue para o custo do próprio kit vindo do ERP/planilha, depois anúncio e família). SHC.kitDe diz o que falta.
    // ponytail: kit dentro de kit não soma — o componente precisa de custo próprio (vira "falta"); resolver em cadeia se pedirem.
    const custoDigitado = d => SHC.num(d.custo) > 0 && (d.origem === 'manual' || !d.origem || (d.origem === 'erp' && d.custoErp !== undefined && SHC.num(d.custo) !== d.custoErp));
    SHC.ehKit = d => !!d && Array.isArray(d.kit) && d.kit.length > 0;
    SHC.kitDe = function (custos, d) {
        if (!SHC.ehKit(d)) return null;
        let soma = 0; const faltam = [];
        d.kit.forEach(c => { const x = custos[SHC.chaveSku(c.sku)], v = x ? SHC.num(x.custo) : 0; if (v > 0) soma += v * c.q; else faltam.push(c.sku); });
        return { custo: faltam.length ? null : Math.round(soma * 100) / 100, faltam };
    };
    // SKUs do anúncio (it.sku + it.skus, sem repetir): anúncio com variações pode ter um SKU por variação.
    SHC.skusDoAnuncio = info => (info && info.sku ? [info.sku] : []).concat(info && Array.isArray(info.skus) ? info.skus : []).filter((s, i, a) => s && a.indexOf(s) === i);
    // O custo gravado no PRÓPRIO anúncio (c|ml|MLB…) vem ANTES do SKU quando (30/09/2026, relato "anúncio sem SKU"):
    //   • o anúncio tem mais de um SKU (variações): um custo só para o anúncio é mais certo que o de uma das variações;
    //   • o SKU não aparece na linha da lista (skuFonte ≠ 'lista': veio das variações, do mesmo produto, das vendas, do Full ou da leitura
    //     anterior) — o anúncio aparecia como "anúncio sem SKU" e o custo foi digitado nele: o lucro não troca de número sem aviso.
    SHC.mlbNaFrente = info => !!info && (SHC.skusDoAnuncio(info).length > 1 || (!!info.skuFonte && info.skuFonte !== 'lista'));
    const custoDaChave = (custos, k) => {
        const d = custos[k];
        if (!d) return null;
        if (SHC.ehKit(d) && !custoDigitado(d)) { const r = SHC.kitDe(custos, d); if (r.custo > 0) return { chave: k, dados: Object.assign({}, d, { custo: r.custo, origem: 'kit' }) }; }
        return SHC.num(d.custo) > 0 ? { chave: k, dados: d } : null;
    };
    SHC.custoDeAnuncio = function (custos, info) {
        const mlb = info.itemId ? SHC.chave('ml', info.itemId) : '', fam = info.familia ? SHC.chave('ml', info.familia) : '';
        const doSku = () => {
            // Vários SKUs com custo (variações de custos diferentes): usa o MAIOR — o lucro do anúncio nunca sai inflado.
            let melhor = null;
            SHC.skusDoAnuncio(info).forEach(s => { const r = custoDaChave(custos, SHC.chaveSku(s)); if (r && (!melhor || SHC.num(r.dados.custo) > SHC.num(melhor.dados.custo))) melhor = r; });
            return melhor;
        };
        const ordem = SHC.mlbNaFrente(info) ? [() => mlb && custoDaChave(custos, mlb), doSku] : [doSku, () => mlb && custoDaChave(custos, mlb)];
        ordem.push(() => fam && custoDaChave(custos, fam));
        for (const f of ordem) { const r = f(); if (r) return r; }
        return null;
    };
    // Leitura de custos com kit: traz também os SKUs de dentro dos kits lidos (1 leitura a mais, só quando há kit).
    async function comComponentes(custos) {
        const falta = new Set();
        Object.keys(custos).forEach(k => { if (SHC.ehKit(custos[k])) custos[k].kit.forEach(c => { const ck = SHC.chaveSku(c.sku); if (ck && !(ck in custos)) falta.add(ck); }); });
        return falta.size ? Object.assign(await area().get([...falta]), custos) : custos;
    }
    // Composição digitada, uma linha por item: "SKU x 2", "SKU;2", "SKU 2" ou só "SKU" (= 1). SKU repetido soma.
    // → {itens:[{sku, q}], erros:[texto]}. O kit não pode conter ele mesmo; quantidade inteira de 1 a 999.
    SHC.lerComposicao = function (texto, skuKit) {
        const kit = SHC.normalizaSku(skuKit), itens = [], erros = [];
        String(texto || '').split(/\r?\n/).forEach((lin, i) => {
            const t = lin.trim();
            if (!t) return;
            const m = /^(.*?\S)\s*(?:\s+[x×*]\s*|\s*[;,\t]\s*|\s+)(\d+)$/i.exec(t), sku = SHC.normalizaSku(m ? m[1] : t), q = m ? +m[2] : 1;
            if (!sku) return erros.push('Linha ' + (i + 1) + ': falta o SKU.');
            if (!(q >= 1 && q <= 999)) return erros.push('Linha ' + (i + 1) + ': a quantidade vai de 1 a 999.');
            if (sku === kit) return erros.push('Linha ' + (i + 1) + ': o kit não pode ter ele mesmo dentro.');
            const ja = itens.find(x => x.sku === sku);
            if (ja) ja.q += q; else itens.push({ sku, q });
        });
        return { itens, erros };
    };
    // Grava a composição no c|sku|<KIT> sem mexer no custo digitado, na origem nem nas medidas. itens vazio = deixa de ser kit.
    SHC.salvarKit = async function (sku, itens, outros) {
        const k = SHC.chaveSku(sku);
        if (!k) return null;
        const a = (await area().get(k))[k] || {}, kit = (itens || []).filter(c => c && SHC.chaveSku(c.sku) && c.q >= 1).map(c => ({ sku: SHC.normalizaSku(c.sku), q: Math.round(c.q) }));
        if (kit.length) a.kit = kit; else delete a.kit;
        const o = SHC.num(outros);
        if (o > 0) a.outros = o; else if (outros !== undefined) delete a.outros;
        if (!kit.length && !(SHC.num(a.custo) > 0) && !Object.keys(a).some(m => !CAMPOS_DE_CUSTO[m])) { await area().remove(k); return null; }
        await area().set({ [k]: a });
        return a;
    };
    // Todos os kits gravados + os custos dos componentes: {kits: [{sku, dados}], custos: {c|sku|…: dados}}
    SHC.lerKits = async function () {
        const todos = await area().get(null), custos = {}, kits = [];
        Object.keys(todos).forEach(k => { if (k.indexOf('c|sku|') === 0) { custos[k] = todos[k]; if (SHC.ehKit(todos[k])) kits.push({ sku: k.slice(6), dados: todos[k] }); } });
        return { kits: kits.sort((x, y) => x.sku.localeCompare(y.sku, 'pt-BR')), custos };
    };
    // Onde gravar um custo novo: no SKU quando existe (serve para todos os canais), senão no anúncio.
    SHC.chaveParaGravar = info => (info.sku ? SHC.chaveSku(info.sku) : '') || SHC.chave('ml', info.itemId || info.familia);
    SHC.chaveVisto = (canal, id) => 'v|' + canal + '|' + id;

    SHC.normalizaId = function (canal, id) {
        const s = String(id || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (canal === 'ml') {
            if (/^F\d{6,20}$/.test(s)) return s;   // v2: família de anúncios (id "#…" da Central de promoções)
            const m = /^(?:MLB)?(\d{6,14})$/.exec(s); return m ? 'MLB' + m[1] : '';
        }
        return /^\d{5,15}$/.test(s) ? s : '';
    };

    // ── v2: fotografia da Central de promoções + histórico diário do custo de envio por anúncio ──
    // v2.4 (V14): promoções POR CONTA em ml:promos:<sellerId>. A chave antiga 'ml:promos' (de uma conta qualquer) é lida
    // uma vez só, como migração para a conta aberta agora, e apagada. Retrato vazio = {ts, paginas, familias:[], propostas:[], vazio:true}.
    SHC.lerPromos = async function (conta) {
        const c = conta || await SHC.contaAtual(), k = 'ml:promos:' + c;
        const r = await area().get([k, 'ml:promos']);
        if (r[k]) return r[k];
        if (!r['ml:promos']) return null;
        await area().set({ [k]: r['ml:promos'] });
        await area().remove('ml:promos');
        return r['ml:promos'];
    };
    SHC.salvarPromos = async function (conta, snap) {
        await area().set({ ['ml:promos:' + (conta || await SHC.contaAtual())]: snap });
        if ((await area().get('ml:promos'))['ml:promos']) await area().remove('ml:promos');   // retrato novo: a chave antiga (sem conta) não serve mais
    };
    SHC.lerStatus = async function () { return (await area().get('shc:status'))['shc:status'] || {}; };
    SHC.salvarStatus = async function (st) { await area().set({ 'shc:status': st }); };

    SHC.hoje = function () {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    };

    // mapa { MLB…: valor do envio hoje } → fh|ml|MLB… = { 'AAAA-MM-DD': valor } (até ~13 meses)
    SHC.registraFretes = async function (mapa) {
        const ids = Object.keys(mapa);
        if (!ids.length) return;
        const chaves = ids.map(id => 'fh|ml|' + id);
        const atuais = await area().get(chaves);
        const dia = SHC.hoje(), lote = {};
        ids.forEach((id, i) => {
            const h = Object.assign({}, atuais[chaves[i]] || {});
            h[dia] = mapa[id];
            const dias = Object.keys(h).sort(), limite = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
            while (dias.length > 400 || (dias.length > 1 && dias[0] < limite)) delete h[dias.shift()];   // V16: também por data (> 400 dias)
            lote[chaves[i]] = h;
        });
        await area().set(lote);
    };
    SHC.lerFretes = async function (ids) {
        const chaves = ids.map(id => 'fh|ml|' + id);
        const r = await area().get(chaves);
        const out = {};
        ids.forEach((id, i) => { out[id] = r[chaves[i]] || {}; });
        return out;
    };

    // ── v2.1: base comum (etiquetas, painel, fundo e primeiro uso usam só estas funções) ──────────
    //   c|sku|<SKU>            → custo do SKU {custo, outros?, titulo?, origem:'manual'|'planilha'|'erp', atualizado,
    //                            pesoKg?, larguraCm?, alturaCm?, comprimentoCm?, ean?}  (v2.2: medidas da planilha; pode vir SEM custo)
    //   ad|ml|<MLB>            → {'AAAA-MM': custo de Product Ads no mês} (Faturamento)
    //   ml:contas              → { <sellerId>: {apelido, visto} }  contas do ML já vistas neste Chrome
    //   ml:conta               → sellerId da conta aberta agora
    //   ml:anuncios:<sellerId> → {ts, paginas, total, itens:[saída de SHC.mlAnunciosDoEstado]}  conta INTEIRA
    //   fh|ml|<MLB>            → {'AAAA-MM-DD': frete no preço atual}  (só da lista de Anúncios)
    //   vd|ml|<MLB>            → {<orderId>: {d:'AAAA-MM-DD', f:frete cobrado, q?:qtd, pc:true se por conta do comprador}}
    //                            q ausente = quantidade desconhecida (o Faturamento não informa; pode ser pedido de mais de 1 unidade)
    //   vm|ml|<MLB>            → {'AAAA-MM': unidades vendidas no mês} (v2.3, Faturamento: "Custo por vender" − cancelamentos)
    //                            mês ausente: se está em mesesLidos (ml:cobrancas:<sellerId>) = 0 vendas; senão = não lido
    //   ml:cobrancas:<sellerId>→ {completo12, ate, ts, incompletos:['AAAA-MM'], mesesLidos:['AAAA-MM'] (v2.3, até 13)}
    //   vd|pend                → {<sellerId>: {<título>: {titulo, cobs}}} frete sem MLB esperando o título casar (v2.3)
    //   ml:full:<sellerId>     → {ts, temFull, espaco, mesesEspaco, pontuacao, produtos, avisos, …} (v2.3, SHC.mlFullDoEstado)
    //   shc:guia               → progresso do primeiro uso {passo, feitos:{…}, pulados:{…}, tours:{anuncios, promos}} (v2.5: SHC.guiaProximo)
    // ── v3.3: o canal na chave por conta (multicanal). REGRA PARA SEMPRE: chave por conta SEM prefixo de canal = Mercado Livre.
    //   Os dados de quem usa a 3.2.1 ficam onde estão (sem migração). Canal novo SEMPRE leva o prefixo dele, antes da conta:
    //     ML           <familia>:<conta>[:<resto>]             ads:123 · fech:123:2026-09 · frete:123:hist (como sempre foi)
    //     outro canal  <prefixo>:<conta>:<familia>[:<resto>]   tt:765:afil · tt:765:ped:<pedido> (o jeito que o tiktok.js já grava)
    //   Prefixo de cada canal em SHC.PREFIXO_CANAL (sai de SHC.CANAIS; ids do copiloto-nucleo; tiktok → tt). Nenhuma família do ML começa
    //   com prefixo de canal: o mesmo número de conta em dois canais nunca dá a mesma chave (teste_chave_canal.js confere).
    //   Código NOVO monta a chave por SHC.chaveConta(familia, conta, canal, resto). As chamadas antigas do ML ('ads:' + conta …) ficam
    //   como estão: dão o mesmo nome. (SHC.chave é outra coisa: o custo c|<canal>|<id>; chave por anúncio já leva o canal.)
    // v3.3 (E1): registro ÚNICO dos canais (Ajustes, filtro e prefixo da chave). Canal novo = 1 linha a mais.
    //   telas: o que o canal lê, com os nomes de hoje de cada site (Ajustes); perm: permissões opcionais (null = nenhuma);
    //   ads_nas_tarifas: true = o Ads vem nas cobranças (fatura do ML); false = campo manual por mês (TikTok).
    SHC.CANAIS = [
        { id: 'ml', nome: 'Mercado Livre', curto: 'ML', prefixo: '', cor: '#B8890A', perm: null, ads_nas_tarifas: true,
            telas: ['Vendas', 'Faturamento', 'Anúncios', 'Pós-venda', 'Promoções', 'Mercado Ads', 'Full', 'Reputação', 'Afiliados', 'Canal de transmissão', 'Mercado Pago'] },
        { id: 'tiktok', nome: 'TikTok Shop', curto: 'TikTok', prefixo: 'tt', cor: '#0E9488', ads_nas_tarifas: false,
            perm: { permissions: ['scripting'], origins: ['https://seller-br.tiktok.com/*'] },   // = TT.PERM (tiktok.js)
            // E9: só as telas que o Copiloto lê de fato (TT.TELA do tiktok.js, nomes de 03/10); o chat de Mensagens e os Anúncios da loja ficam fora
            telas: ['Finanças › Resumo financeiro', 'Finanças › Demonstrativos', 'Finanças › Em espera', 'Finanças › detalhe do pedido', 'Pedidos', 'Gerenciar produtos',
                'Avaliação da integridade da conta', 'Pontuação de desempenho da loja', 'Gerenciar devoluções e reembolsos', 'Afiliados', 'Campanhas', 'Lista de tarefas da Página inicial'] },
    ];
    // Os do registro + os canais do núcleo ainda sem leitura (prefixo = id), já reservados na chave. Mesmos nomes e valores da 3.2.1.
    SHC.PREFIXO_CANAL = {};
    SHC.CANAIS.forEach(c => { SHC.PREFIXO_CANAL[c.id] = c.prefixo; });
    ['shopee', 'magalu', 'amazon', 'shein', 'temu'].forEach(id => { SHC.PREFIXO_CANAL[id] = id; });
    // 3.3.0 (junção, multi-empresa): a loja do TikTok na camada da empresa (ver ESPACOS no começo do arquivo).
    { const t = SHC.PREFIXO_CANAL.tiktok; ESPACOS.push([t + ':', e => t + '@' + e + ':', new RegExp('^' + t + '@[0-9]+:')]); }
    // 3.3.1 (C2, Política de Dados do Usuário da Chrome Web Store): o Mercado Livre também só é lido depois do "Concordo e ligar"
    // do quadro de Ajustes › Canais de venda (cfg.consentimento_ml {versao, em}). Sem ele o Copiloto não lê NADA do painel do
    // vendedor: nem a sincronização do fundo, nem o que a tela aberta já recebeu, nem as etiquetas dentro do ML. Nada é pedido
    // ao Chrome (as permissões do ML já vêm na instalação): o consentimento é a chave que liga e desliga a leitura.
    SHC.mlLigado = cfg => !!(cfg && cfg.consentimento_ml);
    /** Gate da leitura do ML em qualquer contexto (fundo, painel, tela do ML): true só com o "Concordo e ligar" gravado. */
    SHC.mlPermitidoAgora = async () => { try { return SHC.mlLigado(await SHC.lerCfg()); } catch (e) { return false; } };
    /** O mesmo gate com callback, para o arranque dos content scripts (que não podem fazer await no topo). Sem storage → false. */
    SHC.mlConsentido = cb => { try { chrome.storage.local.get('cfg', r => cb(SHC.mlLigado(r && r.cfg))); } catch (e) { cb(false); } };
    // Canais que entram no filtro. ML: só com o consentimento gravado (3.3.1, C2). Canal com permissão opcional só com as 3:
    // cfg.modulos[id] === true, fora de SHC.MODULOS_TRAVADOS (calc.js) e perms[id] === true (o painel lê com
    // chrome.permissions.contains(canal.perm)). Travado = [] (sem o ML: 0 ou 1 canal — o filtro some, P.canalValido devolve 'ml').
    SHC.canaisLigados = (cfg, perms) => SHC.CANAIS.filter(c => c.id === 'ml' ? SHC.mlLigado(cfg) : (!c.perm || (SHC.MODULOS_TRAVADOS.indexOf(c.id) < 0
        && !!(cfg && cfg.modulos && cfg.modulos[c.id] === true) && !!(perms && perms[c.id] === true)))).map(c => c.id);
    SHC.chaveConta = function (familia, conta, canal, resto) {
        const p = SHC.PREFIXO_CANAL[canal || 'ml'], fim = resto ? ':' + resto : '';
        if (typeof p !== 'string') throw new Error('SHC.chaveConta: canal desconhecido (' + canal + ')');   // canal errado nunca cai na chave do ML
        return p ? p + ':' + conta + ':' + familia + fim : familia + ':' + conta + fim;
    };
    const MEDIDAS = ['pesoKg', 'larguraCm', 'alturaCm', 'comprimentoCm', 'ean'];
    const CAMPOS_DE_CUSTO = { custo: 1, outros: 1, origem: 1, erp: 1, custoErp: 1, titulo: 1, atualizado: 1 };
    SHC.lerChave = async k => (await area().get(k))[k] || null;
    SHC.gravarChave = async (k, v) => { await area().set({ [k]: v }); };

    SHC.salvarCustoSku = async function (sku, dados) {
        const k = SHC.chaveSku(sku);
        if (!k) return null;
        const custo = SHC.num(dados.custo);
        const atual = (await area().get(k))[k] || {};
        if (!(custo > 0)) {   // custo 0 ou vazio = sem custo; medidas/EAN da planilha (v2.2) ficam
            // Só apaga o registro se nele só havia custo: medidas, EAN e o mínimo do Full (fullMinUn) ficam.
            if (!Object.keys(atual).some(m => !CAMPOS_DE_CUSTO[m])) { await area().remove(k); return null; }
            delete atual.custo; delete atual.outros;
            await area().set({ [k]: atual });
            return null;
        }
        const novo = Object.assign(atual, dados, { custo, atualizado: Date.now() });
        if (!novo.origem) novo.origem = 'manual';
        await area().set({ [k]: novo });
        return novo;
    };
    // Custos de vários anúncios de uma vez: infos = [{sku, familia, itemId}] → Map(info → {chave, dados} | null)
    SHC.custosDe = async function (infos) {
        const chaves = new Set();
        infos.forEach(i => {
            SHC.skusDoAnuncio(i).forEach(s => chaves.add(SHC.chaveSku(s)));
            if (i.familia) chaves.add(SHC.chave('ml', i.familia));
            if (i.itemId) chaves.add(SHC.chave('ml', i.itemId));
        });
        chaves.delete('');
        const custos = chaves.size ? await comComponentes(await area().get([...chaves])) : {};
        const out = new Map();
        infos.forEach(i => out.set(i, SHC.custoDeAnuncio(custos, i)));
        return out;
    };

    // v2.8 (pedido da dona: "preciso que seja exibido o nome da conta e o ID dela não somente o ID"): o nome de exibição da
    // PRÓPRIA conta do vendedor (nickname do ML, lido de SHC.mlContaDoEstado) passa a ser guardado — nunca o e-mail, nunca de
    // conta que não seja do próprio vendedor. O seller ainda pode sobrepor com um apelido dele em Ajustes (cfg.apelidos).
    SHC.registraConta = async function (sellerId, nomeMl) {
        if (!sellerId) return;
        const contas = (await SHC.lerChave('ml:contas')) || {};
        const antes = contas[sellerId] || {};
        const nome = typeof nomeMl === 'string' && nomeMl.trim() && !/@/.test(nomeMl) ? nomeMl.trim().slice(0, 60) : (antes.nomeMl || '');
        contas[sellerId] = { visto: Date.now(), nomeMl: nome };
        await area().set({ 'ml:contas': contas, 'ml:conta': String(sellerId) });
    };
    /** Nome de exibição da conta: apelido do seller (cfg.apelidos, Ajustes) OU o nome da própria conta lido do ML (nomeMl) OU "Conta ID …1234". */
    SHC.nomeConta = (sellerId, cfg, contas) => {
        const ap = cfg && cfg.apelidos && cfg.apelidos[sellerId];
        if (ap && String(ap).trim()) return String(ap).trim().slice(0, 40);
        const nm = contas && contas[sellerId] && contas[sellerId].nomeMl;
        if (nm && String(nm).trim()) return String(nm).trim().slice(0, 60);
        return 'Conta ID …' + String(sellerId || '').slice(-4);
    };
    /** Contas do ML já vistas neste Chrome → [{sellerId, nome (SHC.nomeConta), visto, atual}] (a aberta agora primeiro, depois as mais recentes). */
    SHC.contas = async function () {
        const [contas, cfg, atual] = await Promise.all([SHC.lerChave('ml:contas'), SHC.lerCfg(), SHC.contaAtual()]);
        return Object.keys(contas || {}).filter(id => /^\d{6,15}$/.test(id)).map(id => ({ sellerId: id, nome: SHC.nomeConta(id, cfg, contas), visto: (contas[id] || {}).visto || 0, atual: id === atual }))
            .sort((a, b) => (b.atual - a.atual) || (b.visto - a.visto));
    };
    // v3.3 multi-empresa: as contas da MESMA empresa da conta aberta (conta separada = só ela; as outras = todas as não separadas).
    // empresa (opcional): a de SHC.empresaSeparada guardada no começo de uma leitura longa (SHC.areaEmpresa(empresa)).
    SHC.contasDaEmpresa = async function (empresa) {
        const [cs, e, r] = await Promise.all([SHC.contas(), typeof empresa === 'string' ? empresa : SHC.empresaSeparada(), crua().get('cfg')]), sep = (r.cfg && r.cfg.empresaSeparada) || {};
        return cs.filter(c => (e ? c.sellerId === e : sep[c.sellerId] !== true));
    };
    /** Dados de cada conta para SHC.consolidado(…, mes): vb:<c>, fech:<c>:<mes> e shc:anomalias:<c> (gravado pelo fundo em atualizarAlertas). */
    // v3.3 multi-empresa (bloqueio 5): + empresa de cada conta ('' = as não separadas; sellerId = a marcada "Outra empresa") — o consolidado
    // nunca soma o faturamento de empresas diferentes.
    SHC.dadosContas = async function (mes) {
        const cs = await SHC.contas(), m = mes || SHC.hoje().slice(0, 7), sep = (((await crua().get('cfg')).cfg || {}).empresaSeparada) || {};
        const r = await area().get(cs.flatMap(c => ['vb:' + c.sellerId, SHC.chaveFech(c.sellerId, m), 'shc:anomalias:' + c.sellerId]));
        return cs.map(c => Object.assign({}, c, { empresa: sep[c.sellerId] === true ? c.sellerId : '', vb: r['vb:' + c.sellerId] || null, fech: r[SHC.chaveFech(c.sellerId, m)] || null, anomalias: r['shc:anomalias:' + c.sellerId] || null }));
    };
    // v2.7 (background.js): perguntas:<conta> = SHC.mlPerguntasDoEstado + {pendentes (do Resumo quando a página não disse), link, fonte}; resumo:<conta> = SHC.mlResumoDoConteudo;
    // reputacao:<conta> = SHC.mlReputacaoDoEstado; remessas:<conta>:detalhe = {ts, porId:{id: SHC.mlRemessaDetalheDoEstado + ts}}; resumo:<conta>:semanal = {ts, semana, texto, waLink, novo}.
    SHC.lerPerguntas = async conta => SHC.lerChave('perguntas:' + (conta || await SHC.contaAtual()));
    SHC.lerResumoML = async conta => SHC.lerChave('resumo:' + (conta || await SHC.contaAtual()));
    SHC.lerReputacao = async conta => SHC.lerChave('reputacao:' + (conta || await SHC.contaAtual()));
    SHC.lerRemessasDetalhe = async conta => SHC.lerChave('remessas:' + (conta || await SHC.contaAtual()) + ':detalhe');
    SHC.lerResumoSemanal = async conta => SHC.lerChave('resumo:' + (conta || await SHC.contaAtual()) + ':semanal');
    SHC.contaAtual = async () => (await SHC.lerChave('ml:conta')) || 'atual';
    SHC.lerAnuncios = async sellerId => SHC.lerChave('ml:anuncios:' + (sellerId || await SHC.contaAtual()));
    SHC.salvarAnuncios = async (sellerId, snap) => SHC.gravarChave('ml:anuncios:' + (sellerId || await SHC.contaAtual()), snap);

    // pedidos = { MLB…: { orderId: {d, f, q?, pc} | null } } — junta com o que já existe, até ~13 meses por anúncio; null apaga o pedido (cancelado)
    SHC.registraVendas = async function (pedidos) {
        const ids = Object.keys(pedidos);
        if (!ids.length) return;
        const chaves = ids.map(id => 'vd|ml|' + id);
        const atuais = await area().get(chaves);
        const limite = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10), lote = {};
        ids.forEach((id, i) => {
            const v = Object.assign({}, atuais[chaves[i]] || {}, pedidos[id]);
            Object.keys(v).forEach(o => { if (!v[o] || v[o].d < limite) delete v[o]; });
            lote[chaves[i]] = v;
        });
        await area().set(lote);
    };
    SHC.lerVendas = async function (ids) {
        const chaves = ids.map(id => 'vd|ml|' + id);
        const r = await area().get(chaves);
        const out = {};
        ids.forEach((id, i) => { out[id] = r[chaves[i]] || {}; });
        return out;
    };
    // Vendas de um anúncio por mês: {'AAAA-MM': {n, frete, medio, pedidos:[orderId…]}} — só frete por conta do vendedor
    SHC.fretePorMes = function (vendas) {
        const m = {};
        Object.keys(vendas || {}).forEach(o => {
            const v = vendas[o];
            if (!v || v.pc || !(v.f > 0)) return;
            const k = v.d.slice(0, 7), x = m[k] || (m[k] = { n: 0, frete: 0, pedidos: [] });
            x.n += v.q || 1; x.frete = SHC.r2(x.frete + v.f); x.pedidos.push(o);
        });
        Object.keys(m).forEach(k => { m[k].medio = SHC.r2(m[k].frete / m[k].n); });
        return m;
    };

    // v2.2: ad|ml|<MLB> → {'AAAA-MM': custo de Product Ads no mês} (do Faturamento; até 13 meses).
    // mapa = { MLB: {'AAAA-MM': valor} } — o mês que vem substitui o guardado: mande só mês lido INTEIRO (o fundo tira
    // o mês de antes do início da leitura e o de janela cortada pelo limite de páginas).
    async function gravaMeses(prefixo, mapa) {
        const ids = Object.keys(mapa || {});
        if (!ids.length) return;
        const chaves = ids.map(id => prefixo + id);
        const atuais = await area().get(chaves), lote = {};
        ids.forEach((id, i) => {
            const h = Object.assign({}, atuais[chaves[i]] || {}, mapa[id]);
            const meses = Object.keys(h).sort();
            while (meses.length > 13) delete h[meses.shift()];
            lote[chaves[i]] = h;
        });
        await area().set(lote);
    }
    async function leMeses(prefixo, ids) {
        const chaves = ids.map(id => prefixo + id);
        const r = await area().get(chaves);
        const out = {};
        ids.forEach((id, i) => { out[id] = r[chaves[i]] || {}; });
        return out;
    }
    // ad|ml|<MLB>: LEGADO (v2.2). O Faturamento real traz o Ads por dia e para a conta toda (sem anúncio): o fundo não grava
    // mais aqui (V8). O Ads por anúncio vem da API do Mercado Ads em ads:<conta> (SHC.lerAds(conta)).
    SHC.registraAds = mapa => gravaMeses('ad|ml|', mapa);
    // SHC.lerAds(conta) → ads:<conta>; SHC.lerAds([MLB…]) (lista) → leitura legada de ad|ml|.
    SHC.lerAds = async arg => Array.isArray(arg) ? leMeses('ad|ml|', arg) : SHC.lerChave('ads:' + (arg || await SHC.contaAtual()));
    // Afiliados (etapa 'afiliados' do fundo): afil:<conta> = { ts, temAfiliados, campanha, metricas } | null (ainda não lido).
    SHC.lerAfil = async conta => SHC.lerChave('afil:' + (conta || await SHC.contaAtual()));
    // v2.5 (background.js): fiscal:<conta> = {ts, total, itens:[MLB], familias:[familyId], completo, tarefas:[{id, qtd, titulo, texto, link}]} (etapa 'saude');
    // fotos:<conta> = {ts, porItem:{MLB:{qtd, max, capaId, ids, problemas, visitasTotal, vendidasTotal, ts, falhaTs?, falhas?}} (só falhaTs/falhas = nunca leu: recuo), lidos, de, semPermissao};
    // visitas:<conta> = {ts, porItem:{MLB:{ts, dias:{'AAAA-MM-DD': n}, total30, unicas30, variacaoPct, conversao}}};
    // robo:<conta> = {historico:[…], sugestoes:[{itemId, motivo, novaOrdem, ts}], ultimaPassada}. null = ainda não lido.
    SHC.lerFiscal = async conta => SHC.lerChave('fiscal:' + (conta || await SHC.contaAtual()));
    SHC.lerFotos = async conta => SHC.lerChave('fotos:' + (conta || await SHC.contaAtual()));
    SHC.lerVisitas = async conta => SHC.lerChave('visitas:' + (conta || await SHC.contaAtual()));
    SHC.lerRobo = async conta => SHC.lerChave('robo:' + (conta || await SHC.contaAtual()));
    // v2.5.2 (background.js, monitor de medidas): medidas:<conta> = {ts, porItem:{MLB:{sku, atual:{ordenadas:[3 cm crescentes], pesoKg, fonte:'tela',
    // secao:'envio'|'entrega', de, ts, envio, fabrica, entrega, quem?}, historico:[{ordenadas, pesoKg, de, ate, vistoAte, fonte, quem?}] (máx. 20), alterar?:[ts], falhaTs?, falhas?}},
    // (quem 'seller' = o seller disse "Fui eu"; alterar = cliques em "Alterar no ML") mudancas:[{itemId, sku, antes, depois, em, vistoAte, fonte}] (máx. 100, a mais nova 1º), lidos, de, semPermissao}. null = ainda não lido.
    SHC.lerMedidas = async conta => SHC.lerChave('medidas:' + (conta || await SHC.contaAtual()));
    // v3.2 (background.js juntarEditor): editor:<conta> = {ts, total, completo, porItem:{MLB: SHC.editorLinha + variacoes:[SHC.editorVariacoes]}} — Editor em massa,
    // lido só quando a seller abre a tela. ml:anuncios:<conta> ganhou familias:[{id:'TR…', tipo:'familia'|'verMais', familyId, titulo, estoque, esperado, itens:[MLB]}] e linhas.
    SHC.lerEditor = async conta => SHC.lerChave('editor:' + (conta || await SHC.contaAtual()));
    // v3.1 (background.js): catcomp:<conta> = {ts, porItem:{MLB: SHC.compCatRegistra(...) = SHC.mlCompeticaoDoEstado + {ts, hist:[{d, e, w, g, vp}]} (ou só falhaTs/falhas)}}.
    SHC.lerCatComp = async conta => SHC.lerChave('catcomp:' + (conta || await SHC.contaAtual()));
    // v2.5.3 (background.js): posvenda:<conta> = {ts, reclamacoes, mensagens, devolucoes} (null = aba não achada; só totais, nada do comprador)
    // + v2.9 casos:[{titulo, valor, unidades, motivo, afetouReputacao, situacao}] da 1ª página da lista, paginas, casosTs (sem pedido, id da reclamação nem comprador);
    // frete:<conta>:hist = {ts, hoje, desde, fonte, lidoAte, porAnuncio, conta, conciliacao} (SHC.freteHistorico + SHC.conciliaFrete; os pedidos
    // ficam à parte em frete:<conta>:pedidos = {ts, pedidos:{pedido: {itemId, data, cobrado, cheio, formato, cancelado, aprox?}}, vendas:{pedido: {itemId, data, cancelada}}});
    // conferir:<conta> = {ts, meses:['AAAA-MM'], itens:[SHC.fech.conferir…] (até 100), qtd, valor} (pagamento excedente);
    // cert:<conta> = {dias, data, expirou, ts, fonte:'faturador'|'remessa'}; shc:anomalias = SHC.anomalias(…) + ts (número do ícone).
    SHC.lerPosVenda = async conta => SHC.lerChave('posvenda:' + (conta || await SHC.contaAtual()));
    SHC.lerFreteHist = async conta => SHC.lerChave('frete:' + (conta || await SHC.contaAtual()) + ':hist');
    SHC.lerConferir = async conta => SHC.lerChave('conferir:' + (conta || await SHC.contaAtual()));
    SHC.lerCert = async conta => SHC.lerChave('cert:' + (conta || await SHC.contaAtual()));
    SHC.lerAnomalias = async () => SHC.lerChave('shc:anomalias');
    SHC.salvarAds = async (conta, snap) => SHC.gravarChave('ads:' + (conta || await SHC.contaAtual()), snap);
    // v2.3: vm|ml|<MLB> → {'AAAA-MM': unidades vendidas no mês, já sem as canceladas} (Faturamento; sazonalidade do Full).
    // Mesma regra do Ads: o mês que vem substitui o guardado, então só mande mês lido inteiro.
    SHC.registraVendasMes = mapa => gravaMeses('vm|ml|', mapa);
    SHC.lerVendasMes = ids => leMeses('vm|ml|', ids);
    // v2.5.2: vu|ml → {MLB: 'AAAA-MM-DD'} = dia da venda mais recente de cada anúncio (cobranças "venda"; com ou sem frete cobrado do seller).
    // Guarda sempre o dia mais novo. Diz quem vendeu nos últimos 3 dias (medidas relidas todo dia).
    SHC.registraUltimaVenda = async function (mapa) {
        const ids = Object.keys(mapa || {});
        if (!ids.length) return;
        const v = (await SHC.lerChave('vu|ml')) || {};
        ids.forEach(id => { if (!(v[id] >= mapa[id])) v[id] = mapa[id]; });
        await SHC.gravarChave('vu|ml', v);
    };
    SHC.lerUltimaVenda = async () => (await SHC.lerChave('vu|ml')) || {};
    // Meses já lidos inteiros no Faturamento: neles, vm|ml sem o mês = 0 vendas (fora deles = ainda não lido).
    SHC.lerMesesVendasLidos = async sellerId => ((await SHC.lerChave('ml:cobrancas:' + (sellerId || await SHC.contaAtual()))) || {}).mesesLidos || [];

    // v2.3: vd|pend → { <sellerId>: { <título normalizado>: {titulo, cobs:[{tipo, orderId, data, valor, id}]} } }
    // Frete que veio sem MLB e não casou com nenhum título do retrato: tenta de novo na próxima sincronização.
    SHC.lerPendentes = async function (sellerId) {
        const conta = ((await SHC.lerChave('vd|pend')) || {})[sellerId] || {}, out = [];
        Object.keys(conta).forEach(k => ((conta[k] && conta[k].cobs) || []).forEach(c => out.push(Object.assign({}, c, { itemId: '', titulo: conta[k].titulo }))));
        return out;
    };
    // cobs = as que continuam sem MLB (substitui as da conta). Até ~13 meses e 500 títulos por conta.
    SHC.salvarPendentes = async function (sellerId, cobs) {
        const tudo = (await SHC.lerChave('vd|pend')) || {}, conta = {};
        const limite = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
        (cobs || []).forEach(c => {
            const k = SHC.normalizaTitulo ? SHC.normalizaTitulo(c.titulo).slice(0, 120) : '';
            if (!k || !c.data || c.data < limite || (!conta[k] && Object.keys(conta).length >= 500)) return;
            const p = conta[k] || (conta[k] = { titulo: c.titulo, cobs: [] });
            if (!c.id || !p.cobs.some(x => x.id === c.id)) p.cobs.push({ tipo: c.tipo, orderId: c.orderId || '', data: c.data, valor: c.valor, id: c.id || '' });
        });
        if (Object.keys(conta).length) tudo[sellerId] = conta; else delete tudo[sellerId];
        await area().set({ 'vd|pend': tudo });
    };

    // v2.3: ml:full:<sellerId> → {ts, ...SHC.mlFullDoEstado} (Full da conta; falha na leitura não apaga o anterior)
    SHC.lerFull = async sellerId => SHC.lerChave('ml:full:' + (sellerId || await SHC.contaAtual()));
    SHC.salvarFull = async (sellerId, snap) => SHC.gravarChave('ml:full:' + (sellerId || await SHC.contaAtual()), snap);

    // ── v2.4: fechamento do mês, faturas, vendas brutas, repasse do Mercado Pago e alertas ──
    //   ads:<conta>              → {ts, temAds, periodo:{de,ate}, anterior:{periodo, campanhas:{id: metricas}, total}, campanhas, anuncios, resumo, advertiserId}
    //   fech:<conta>:<AAAA-MM>   → {mes, porTipo:{tarifa_venda, cobranca_mp, parcelamento, recebimento, frete, ads, ads_seguidores, outro} (líquido, já sem estornos),
    //                               estornos (≤ 0), total, qtdVendas, pedidos:{orderId:{tipo: valor}} (só últimos 3 meses), parcial, ate, vendasBrutas?,
    //                               porOrigem:{tipo: {venda, fatura, total}} ("descontado nas vendas" × "na fatura"; mês gravado por versão antiga não tem),
    //                               porDia:{'AAAA-MM-DD': {tipo: valor}} (para o rateio das faturas por mês do calendário)}
    //   fech:<conta>:rateio      → {ts, dia (fechamento da fatura; null = sem faturas), faturas:[{fatura:'AAAA-MM', nome, fechamento, ciclo:{de,ate}, total,
    //                               porMes:{'AAAA-MM': R$}, totalFatura, conferido, diferenca, incompleto, linkDetalhe}]}  (não é mês: varrer fech: com /^fech:\d+:\d{4}-\d{2}$/)
    //   fat:<conta>              → {ts, faturas:[SHC.mlFaturas…], aberta, notas:{'AAAA-MM': [SHC.mlNotasFiscais…]}}
    //   nfe:<conta>:<AAAA-MM>    → v2.8, NF-e das VENDAS (Faturador e Full), mês atual e anterior: {ts, mes, total, lidas, completo, porStatus:{'Autorizada': n…},
    //                               somaProdutos, somaEnvio, somaTotal (só as autorizadas), notas:[SHC.nfeVendasDaResposta…] (até 2.000; acima, [] e soTotais),
    //                               erro?, erroEm? (a última leitura falhou: o resto é o da leitura anterior)}. Nada do comprador.
    //   vb:<conta>               → {ts, dias:{'AAAA-MM-DD': {bruto, unidades, vendas, cancelado, devolvido}}, porAnuncio, periodoLido,
    //                               mesesLidos:['AAAA-MM'], completo13, naoLidos:['AAAA-MM'] (meses que o ML não respondeu)}
    //   mp:repasse:<conta>       → {ts, meses:{'AAAA-MM': {entrou, reembolsos, liquido, n}}, paginas}  (a confirmar ao vivo)
    //   shc:alertas              → {ts, conta, criticos, lista:[SHC.alertas…]}
    SHC.chaveFech = (conta, mes) => 'fech:' + conta + ':' + mes;
    // Últimos n meses (o atual incluso) → {'AAAA-MM': fech | null}
    SHC.lerFechamentos = async function (conta, n) {
        const c = conta || await SHC.contaAtual(), h = SHC.hoje(), meses = [];
        for (let i = 0, y = +h.slice(0, 4), m = +h.slice(5, 7); i < (n || 13); i++) {
            meses.push(y + '-' + String(m).padStart(2, '0'));
            if (--m < 1) { m = 12; y--; }
        }
        const r = await area().get(meses.map(m => SHC.chaveFech(c, m))), out = {};
        meses.forEach(m => { out[m] = r[SHC.chaveFech(c, m)] || null; });
        return out;
    };
    SHC.salvarFechamentos = async function (conta, mapa) {
        const lote = {};
        Object.keys(mapa || {}).forEach(m => { lote[SHC.chaveFech(conta, m)] = mapa[m]; });
        if (Object.keys(lote).length) await area().set(lote);
    };
    SHC.lerFaturas = async conta => SHC.lerChave('fat:' + (conta || await SHC.contaAtual()));
    SHC.salvarFaturas = async (conta, v) => SHC.gravarChave('fat:' + (conta || await SHC.contaAtual()), v);
    SHC.lerVendasBrutas = async conta => SHC.lerChave('vb:' + (conta || await SHC.contaAtual()));
    SHC.salvarVendasBrutas = async (conta, v) => SHC.gravarChave('vb:' + (conta || await SHC.contaAtual()), v);
    // v2.6: vendas por anúncio mês a mês (vbAnuncio:<conta>, etapa 'vendasAnuncio') e categoria de cada anúncio (cat:<conta>, da tela
    // "Alterar anúncio") → SHC.familias. Formatos no comentário de SHC.familias (ml-extrator.js).
    SHC.lerVendasAnuncio = async conta => SHC.lerChave('vbAnuncio:' + (conta || await SHC.contaAtual()));
    SHC.lerCategorias = async conta => SHC.lerChave('cat:' + (conta || await SHC.contaAtual()));
    SHC.lerRepasse = async conta => SHC.lerChave('mp:repasse:' + (conta || await SHC.contaAtual()));
    SHC.salvarRepasse = async (conta, v) => SHC.gravarChave('mp:repasse:' + (conta || await SHC.contaAtual()), v);
    SHC.lerAlertas = async () => SHC.lerChave('shc:alertas');
    SHC.salvarAlertas = async v => SHC.gravarChave('shc:alertas', v);

    // Suporte (um lugar só): botão "Falar com o suporte (WhatsApp)" em Ajustes, na apresentação e nas mensagens de erro.
    SHC.SUPORTE_WHATSAPP = 'https://wa.me/5544999121785?text=' + encodeURIComponent('Olá! Preciso de ajuda com o Copiloto.');
    // Omie (conexão por App Key + App Secret da própria conta, guardados só neste Chrome como o token do Tiny: erp:omie = {appKey, appSecret}).
    // A leitura (POST de CONSULTA ListarPosEstoque, só lê) é do fundo: {acao:'sincronizar_custos', erp:'omie'}. omie.js define os mesmos valores.
    SHC.OMIE_ORIGEM = SHC.OMIE_ORIGEM || 'https://app.omie.com.br/*';
    SHC.OMIE_CHAVE = SHC.OMIE_CHAVE || 'erp:omie';

    SHC.lerGuia = async () => Object.assign({ passo: 0, feitos: {}, tours: {}, pulados: {} }, (await SHC.lerChave('shc:guia')) || {});
    SHC.salvarGuia = async function (patch) {
        const g = await SHC.lerGuia();
        const novo = Object.assign(g, patch, {
            feitos: Object.assign({}, g.feitos, patch.feitos || {}),
            tours: Object.assign({}, g.tours, patch.tours || {}),
            pulados: Object.assign({}, g.pulados, patch.pulados || {}),
        });
        await area().set({ 'shc:guia': novo });
        return novo;
    };

    // ── v2.5: guia até o fim (painel lateral, boas-vindas e tela do ML leem daqui) ──
    // feitos.<id> = true ou 'AAAA-MM-DD'; pulados.<id> = true. A ordem desta lista é a ordem do guia.
    SHC.GUIA_ETAPAS = [
        { id: 'imposto', titulo: 'Imposto e meta', porque: 'Sem o imposto, o lucro aparece maior do que é.', botao: 'Informar imposto' },
        { id: 'icone', titulo: 'Fixar o ícone (opcional)', porque: 'Deixa o Copiloto sempre a um clique. Não é obrigatório.', botao: 'Mostrar como', pular: 'Pular' },
        { id: 'conta', titulo: 'Ler a sua conta do ML', porque: 'O Copiloto lê anúncios, vendas e promoções da conta aberta neste Chrome. Só lê.', botao: 'Ler minha conta agora' },
        { id: 'custos', titulo: 'Custo dos produtos que mais vendem', porque: 'Sem o custo, não dá para saber se o produto dá lucro. Comece pelos que mais vendem.', botao: 'Informar custos', pular: 'Já informei os principais' },
        { id: 'lucro', titulo: 'Ver o lucro nos seus anúncios', porque: 'Na lista de Anúncios, cada anúncio ganha uma etiqueta com quanto sobra.', botao: 'Abrir meus anúncios' },
        { id: 'promos', titulo: 'Conferir as promoções', porque: 'Mostra quais propostas de promoção dão lucro e qual é a melhor.', botao: 'Abrir a Central de promoções' },
        { id: 'fechamento', titulo: 'Ver o fechamento do mês', porque: 'Quanto o Mercado Livre cobrou no mês e quanto sobrou para você.', botao: 'Abrir o fechamento' },
        { id: 'ads', titulo: 'Ver o Ads por produto', porque: 'Mostra em quais produtos o Ads gasta mais do que o lucro.', botao: 'Abrir Ads por SKU' },
        { id: 'full', titulo: 'Ver a saúde do estoque Full', porque: 'Avisa o que vai acabar no Full e quanto enviar.', botao: 'Abrir a aba Full', pular: 'Pular' },
    ];

    // Custos dos SKUs que mais vendem. itens = retrato de Anúncios; custos = {'c|…': dados}; vm = {MLB: {'AAAA-MM': un.}}.
    // "Mais vendem" = soma do vm do mês de (hoje − 30 dias) até hoje: o vm é por mês.
    // ponytail: janela por mês inteiro (até ~60 dias); dia a dia só se o vm passar a ser por dia.
    // Sem vendas lidas: os 10 primeiros do retrato. → {com, de, comTodos, deTodos, faltam:[{sku, itemId, titulo}]}
    // faltam = os principais ainda sem custo, do que mais vende para o que menos vende (painel.html#custos lista esses).
    SHC.guiaCustos = function (itens, custos, vm, hoje) {
        const h = hoje || SHC.hoje(), desde = new Date(Date.parse(h + 'T12:00:00Z') - 30 * 864e5).toISOString().slice(0, 7);
        const lista = itens || [], grupos = new Map();
        lista.forEach((it, i) => {
            if (!it || (!it.dentroDeFamilia && it.preco === null && lista[i + 1] && lista[i + 1].dentroDeFamilia)) return;   // linha-mãe de família
            // Anúncio com variações de SKUs diferentes (it.skus): entra no grupo de CADA SKU (igual às linhas da tela de custos), com as
            // vendas do anúncio em cada um (o ML não separa as vendas por variação aqui) e o custo daquele SKU (ou o do próprio anúncio).
            const skus = SHC.skusDoAnuncio(it), v = (vm || {})[it.itemId] || {};
            (skus.length ? skus : ['']).forEach(s => {
                const k = s ? 'sku:' + SHC.normalizaSku(s) : 'mlb:' + it.itemId;
                const g = grupos.get(k) || { vendas: 0, custo: false, sku: s, itemId: it.itemId, titulo: it.titulo || '' };
                Object.keys(v).forEach(m => { if (m >= desde) g.vendas += Number(v[m]) || 0; });
                if (!g.custo && SHC.custoDeAnuncio(custos || {}, s && skus.length > 1 ? { sku: s, itemId: it.itemId, familia: it.familia } : it)) g.custo = true;
                grupos.set(k, g);
            });
        });
        const todos = [...grupos.values()];
        const venderam = todos.filter(g => g.vendas > 0).sort((a, b) => b.vendas - a.vendas);
        const top = (venderam.length ? venderam : todos).slice(0, 10);
        return { desde, com: top.filter(g => g.custo).length, de: top.length, comTodos: todos.filter(g => g.custo).length, deTodos: todos.length,
            faltam: top.filter(g => !g.custo).map(g => ({ sku: g.sku, itemId: g.itemId, titulo: g.titulo })) };
    };

    // Função pura: ctx = {cfg, status, anuncios, custos, vm, guia, icone, temFull, temPromos, hoje?}
    // temPromos: false = a Central foi lida e não tem proposta (retrato ml:promos com vazio) → etapa "promos" pulada com o motivo.
    // → {etapas:[{id, titulo, feito, pulado, detalhe, obs?}], feitas, total, proxima, concluido}
    SHC.guiaProximo = function (ctx) {
        const c = ctx || {}, g = c.guia || {}, feitos = g.feitos || {}, pulados = g.pulados || {}, tours = g.tours || {};
        const st = c.status || {}, cfg = c.cfg || {};
        const cu = SHC.guiaCustos(c.anuncios && c.anuncios.itens, c.custos, c.vm, c.hoje);
        const regra = {
            imposto: [!!cfg.configurado, cfg.configurado ? 'Imposto ' + String(SHC.num(cfg.imposto_pct) || 0).replace('.', ',') + '% · meta ' + String(SHC.num(cfg.margem_alvo_pct) || 0).replace('.', ',') + '%' : ''],
            icone: [!!c.icone, c.icone ? 'Ícone na barra.' : ''],
            conta: [!!(st.primeiraCompleta || st.ultimaOk),st.estado === 'sincronizando' ? 'Lendo a sua conta…' : (st.estado === 'erro' && st.erro === 'sem_sessao' ? 'Entre no Mercado Livre neste Chrome e clique de novo.' : '')],
            custos: [cu.de > 0 && cu.com >= cu.de, cu.de ? cu.com + ' de ' + cu.de + ' principais' : 'Primeiro o Copiloto precisa ler a sua conta.'],
            lucro: [tours.anuncios === true, ''],
            // Tour da Central concluído ou só em parte, mas com o veredito visto (Central lida com propostas).
            promos: [tours.promos === true || (Array.isArray(tours.promos) && tours.promos.indexOf('veredito') >= 0), ''],
            fechamento: [false, ''], ads: [false, ''], full: [false, ''],
        };
        const etapas = SHC.GUIA_ETAPAS.map(e => {
            const [ok, detalhe] = regra[e.id], feito = ok || !!feitos[e.id];
            const motivo = feito ? '' : e.id === 'full' && c.temFull === false ? 'Sua conta não usa o Full. Etapa pulada.'
                : e.id === 'promos' && c.temPromos === false ? 'Sua conta não tem proposta de promoção agora.' : '';
            const o = { id: e.id, titulo: e.titulo, feito, pulado: !feito && (!!pulados[e.id] || !!motivo), detalhe: motivo || detalhe };
            if (e.id === 'custos' && cu.deTodos) o.obs = cu.comTodos + ' de ' + cu.deTodos + ' SKUs com custo';
            return o;
        });
        const feitas = etapas.filter(e => e.feito || e.pulado).length;
        const proxima = etapas.find(e => !e.feito && !e.pulado) || null;
        return { etapas, feitas, total: etapas.length, proxima, concluido: !proxima };
    };

    // ── v2.5: selo e barra da sincronização (o MESMO componente em ads, fechamento, boas-vindas e painel lateral) ──
    // Lê shc:status (etapas/progresso gravados pelo fundo; SHC.SYNC_ETAPAS vem de ml-extrator.js). Funções puras + HTML em texto.
    const NOME_ETAPA = { anuncios: 'os seus anúncios', promos: 'a Central de promoções', vendasBrutas: 'as vendas brutas', faturamento: 'o Faturamento',
        faturas: 'as faturas do ML', full: 'o estoque Full', ads: 'o Mercado Ads', repasse: 'o Mercado Pago', posvenda: 'o pós-venda', vendasAnuncio: 'as vendas por anúncio', alertas: 'os alertas' };
    const UM = { meses: 'mês', 'páginas': 'página', 'anúncios': 'anúncio' };
    const syncEtapas = () => SHC.SYNC_ETAPAS || [];
    const hhmm = ts => { const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
    const escH = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    SHC.hhmm = hhmm;
    // "5 de 12 meses" (lista) ou "mês 5 de 12" (cartão da página); '' sem total conhecido.
    const contagem = (e, curto) => (e && e.de > 0 ? (curto && UM[e.unidade] ? UM[e.unidade] + ' ' + (e.feito || 0) + ' de ' + e.de : (e.feito || 0) + ' de ' + e.de + (e.unidade ? ' ' + e.unidade : '')) : '');
    const restanteTxt = s => (s === null || s === undefined ? 'calculando o tempo…' : s < 60 ? 'menos de 1 min' : 'falta cerca de ' + Math.round(s / 60) + ' min');
    // v2.5.1: "Lendo agosto (3 de 13 meses) · 6.722 cobranças · falta cerca de 4 min". feito = meses já lidos (o atual é o feito+1º).
    const MESES_NOME = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    const MESES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    SHC.textoLendoMes = function (o) {
        const nome = /^\d{4}-\d{2}$/.test(o.mes || '') ? MESES_NOME[+o.mes.slice(5, 7) - 1] : 'o mês';
        const k = Math.min(o.de || 0, Math.floor(o.feito || 0) + 1);
        return 'Lendo ' + nome + (o.de > 0 ? ' (' + k + ' de ' + o.de + (o.de === 1 ? ' mês)' : ' meses)') : '')
            + (o.cobrancas > 0 ? ' · ' + SHC.qtd(o.cobrancas, 'cobrança', 'cobranças') : '') + ' · ' + restanteTxt(o.restanteSeg);
    };
    /** Segundos que faltam pelo ritmo de agora: decorrido / meses feitos × meses que faltam. null antes do 1º mês. */
    SHC.estimaMeses = (inicioMs, feito, de, agoraMs) => (feito > 0 && de > feito ? Math.round((agoraMs - inicioMs) / feito * (de - feito) / 1000) : (feito >= de && de > 0 ? 0 : null));
    // Diagnóstico por mês (shc:status.etapas[id].meses = {'AAAA-MM': 'ok'|'sem resposta'|'login'|'formato mudou'|'vazio'|'cortado'}) → frases.
    const DIAG_MES = { 'sem resposta': 'o ML não respondeu — tento de novo na próxima', login: 'o Mercado Livre pediu para entrar de novo — entre no ML neste Chrome e sincronize',
        'formato mudou': 'o ML mandou os dados de um jeito que o Copiloto não reconheceu — tento de novo na próxima', vazio: 'o ML devolveu a lista vazia — tento de novo na próxima',
        cortado: 'lido só em parte: o mês tem movimento demais para ler inteiro', incompleto: 'uma das páginas não veio inteira — tento de novo na próxima',
        // v3.1: o motivo exato das vendas por anúncio (buscarJsonMotivo), depois de 4 tentativas com espera crescente
        tempo: 'o ML demorou demais para responder — tento de novo em alguns minutos', ocupado: 'o ML pediu uma pausa (muitos pedidos) — tento de novo em alguns minutos' };
    const diagMes = d => DIAG_MES[d] || (/^erro \d{3}$/.test(d) ? 'o ML recusou o pedido (' + d + ') — tento de novo na próxima' : DIAG_MES['sem resposta']);
    SHC.textosMeses = meses => Object.keys(meses || {}).filter(m => meses[m] && meses[m] !== 'ok').sort().reverse()
        .map(m => MESES_CURTO[+m.slice(5, 7) - 1] + '/' + m.slice(2, 4) + ': ' + diagMes(meses[m]));
    const rodando = (st, agora) => !!st && (st.estado === 'sincronizando' || st.sincronizando === true) && agora - (st.batimento || st.inicio || 0) <= 5 * 60e3;
    const VELHO_MS = 6 * 3600e3;

    /**
     * Estado da sincronização para o selo. → {estado:'sincronizando'|'ok'|'velho'|'erro'|'nunca', cor, texto, pct, etapa, restante}
     * "sincronizando" sem batimento há 5 min = parou (erro). Erro com leitura boa antes continua "erro" (o selo diz o que fazer).
     */
    SHC.statusSync = function (st, agoraMs) {
        st = st || {};
        const agora = agoraMs || Date.now(), p = st.progresso;
        if (rodando(st, agora)) {
            const e = p && p.etapa && (st.etapas || {})[p.etapa], id = (p && p.etapa) || '';
            // restanteSeg foi calculado na última gravação: desconta o que passou desde então.
            const s = p && typeof p.restanteSeg === 'number' ? Math.max(0, p.restanteSeg - (agora - (st.batimento || agora)) / 1000) : null;
            const pct = p ? Math.max(0, Math.min(100, Math.round(p.pct || 0))) : 0;
            const x = Object.assign({}, e, p && p.de > 0 ? { feito: p.feito, de: p.de, unidade: p.unidade } : {});
            if (e && e.mesAgora && x.de > 0) x.feito = Math.min(x.de, Math.floor(x.feito || 0) + 1);   // o mês que está sendo lido, como SHC.textoLendoMes
            const c = contagem(x);
            // v2.10: retomada (p.continua): as etapas já lidas no ciclo não voltam; a barra começa na etapa em que parou.
            const cont = p && p.continua ? 'Continuando de onde parou: etapa ' + (p.indice || 1) + ' de ' + (p.total || syncEtapas().length) : '';
            return { estado: 'sincronizando', cor: 'azul', texto: (cont || 'Sincronizando') + ' · ' + pct + '%', pct, continua: !!cont,
                etapa: 'Lendo ' + (NOME_ETAPA[id] || 'a sua conta') + (c ? ' · ' + c : ''), restante: restanteTxt(s) };
        }
        const parou = (st.estado === 'sincronizando' || st.sincronizando === true);
        // v2.5.3: 'interrompida' = o fundo reiniciou no meio (extensão recarregada, Chrome fechado) e já agendou uma nova leitura (retomaEm).
        if (st.estado === 'interrompida') {
            // v2.10: a retomada começa na hora e continua de onde parou (etapas e páginas já lidas não são pedidas de novo).
            const sozinho = !!st.retomaEm && agora - st.retomaEm < 120e3;   // continuando sozinho agora: âmbar (não é falha, é um instante)
            const fazer = sozinho ? 'A leitura parou no meio. O Copiloto continua de onde parou.' : 'A leitura parou no meio. Tente de novo: o Copiloto continua de onde parou.';
            return { estado: 'erro', interrompida: true, cor: sozinho ? 'amarelo' : 'vermelho', texto: 'Não sincronizou · ' + fazer, fazer, pct: null, etapa: '', restante: '' };
        }
        if (parou || st.estado === 'erro') {
            const fazer = parou ? 'A leitura parou no meio. Tente de novo.'
                : st.erro === 'sem_sessao' ? 'Entre no Mercado Livre neste Chrome e tente de novo.'
                // v3.3 multi-empresa: o login do ML mudou no meio da leitura (fundo/08: contaSegue).
                : st.erro === 'outra_conta' ? 'O Mercado Livre mudou de conta no meio da leitura. Parei para não misturar as empresas: sincronize de novo com a conta certa aberta.'
                : 'O Mercado Livre não respondeu. Tente de novo em alguns minutos.';
            return { estado: 'erro', cor: 'vermelho', texto: 'Não sincronizou · ' + fazer, fazer, pct: null, etapa: '', restante: '' };
        }
        const ult = st.ultimaOk || null;
        if (!ult) return { estado: 'nunca', cor: 'cinza', texto: 'Ainda não sincronizado', pct: null, etapa: '', restante: '' };
        const idade = agora - ult;
        if (idade <= VELHO_MS) return { estado: 'ok', cor: 'verde', texto: '✓ Atualizado às ' + hhmm(ult), pct: 100, etapa: '', restante: '' };
        const h = Math.floor(idade / 3600e3);
        return { estado: 'velho', cor: 'amarelo', texto: 'Desatualizado · lido há ' + (h >= 48 ? Math.floor(h / 24) + ' dias' : h + ' h'), pct: null, etapa: '', restante: '' };
    };

    /**
     * Etapa de UMA página (ids = etapas de que a página depende, ex. ['faturamento', 'vendasBrutas']) enquanto a sincronização roda
     * e ela ainda não está ok. → {id, texto, pct (null = sem contagem)} | null (não está rodando, ou já leu).
     */
    // restanteSeg da etapa foi calculado na última gravação: desconta o que passou desde então.
    const restanteEtapa = (st, e, agora) => (typeof e.restanteSeg === 'number' ? Math.max(0, e.restanteSeg - (agora - (st.batimento || agora)) / 1000) : null);
    SHC.etapaDaPagina = function (st, ids, agoraMs) {
        const agora = agoraMs || Date.now();
        if (!rodando(st, agora)) return null;
        const es = st.etapas || {}, id = [].concat(ids).find(i => !es[i] || (es[i].estado !== 'ok' && es[i].estado !== 'pulado' && es[i].estado !== 'erro'));
        if (!id) return null;
        const e = es[id] || {}, s = SHC.statusSync(st, agora), nome = NOME_ETAPA[id] || 'a sua conta';
        if (e.estado === 'lendo' && e.mesAgora) {
            return { id, texto: SHC.textoLendoMes({ mes: e.mesAgora, feito: e.feito, de: e.de, cobrancas: e.cobrancas, restanteSeg: restanteEtapa(st, e, agora) }), pct: e.de > 0 ? Math.min(100, Math.round((e.feito || 0) / e.de * 100)) : null };
        }
        if (e.estado === 'lendo') {
            const c = contagem(e, true);
            return { id, texto: 'Lendo ' + nome + ' agora' + (c ? ' · ' + c : '') + ' · ' + s.restante, pct: e.de > 0 ? Math.min(100, Math.round((e.feito || 0) / e.de * 100)) : null };
        }
        const k = syncEtapas().findIndex(x => x.id === id);
        return { id, texto: 'Na fila: ' + nome + (k >= 0 ? ' é a etapa ' + (k + 1) + ' de ' + syncEtapas().length : '') + ' · ' + s.restante, pct: s.pct };
    };

    // CSS do componente: injetado uma vez na página (as 4 telas usam as mesmas classes shs-*).
    const CSS_SYNC = '.shs{font-size:13px;line-height:1.45}.shs-selo{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:3px 11px;font-weight:700;font-size:12.5px}'
        + '.shs-verde .shs-selo{background:#ECFDF5;color:#047857}.shs-azul .shs-selo{background:#E0F2FE;color:#0369A1}.shs-amarelo .shs-selo{background:#FFFBEB;color:#92400E}'
        + '.shs-vermelho .shs-selo{background:#FEF2F2;color:#B91C1C}.shs-cinza .shs-selo{background:#F1F5F9;color:#475569}'
        + '.shs-barra{height:10px;background:#E2E8F0;border-radius:99px;overflow:hidden;margin:8px 0 4px}.shs-barra i{display:block;height:100%;background:#0284C7;border-radius:99px;transition:width .4s}'
        + '.shs-barra.shs-sem i{width:35%!important;animation:shs-vai 1.4s ease-in-out infinite}@keyframes shs-vai{0%{margin-left:-35%}100%{margin-left:100%}}'
        + '@media (prefers-reduced-motion:reduce){.shs-barra.shs-sem i{animation:none;width:100%!important;opacity:.35}}'
        + '.shs-lin{color:#475569;font-size:12.5px}.shs-lista{border:1px solid #E2E8F0;border-radius:12px;padding:10px 12px;margin-top:10px;background:#fff}'
        + '.shs-cab{margin:0 0 6px;font-weight:700;font-size:13px}.shs-lista ul{list-style:none;margin:0;padding:0}.shs-lista li{display:grid;grid-template-columns:22px 1fr;gap:2px 6px;padding:5px 0;border-top:1px solid #F1F5F9}'
        + '.shs-lista li:first-child{border-top:0}.shs-ic{font-weight:800;text-align:center}.shs-ok .shs-ic{color:#047857}.shs-lendo .shs-ic{color:#0284C7}.shs-fila .shs-ic,.shs-pulado .shs-ic{color:#94A3B8}'
        + '.shs-erro .shs-ic{color:#B45309}.shs-lista li small{grid-column:2;color:#475569;font-size:12px}.shs-lista li .shs-barra{grid-column:2;height:6px;margin:3px 0 0;max-width:260px}'
        + '.shs-lista li button{grid-column:2;justify-self:start;margin-top:3px;border:1px solid #CBD5E1;background:#fff;border-radius:8px;padding:3px 10px;font:inherit;font-size:12px;font-weight:700;cursor:pointer}'
        + '.shs-etapa{background:#F0F9FF;border:1px solid #BAE6FD;border-radius:10px;padding:8px 12px;margin:6px 0;color:#0C4A6E}.shs-etapa .shs-barra{margin:6px 0 0}'
        + '.shs-aviso{background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:8px 12px;margin:6px 0;color:#92400E}.shs-aviso a{color:#92400E;font-weight:700}';
    SHC.cssSync = function () {
        if (typeof document === 'undefined' || typeof document.getElementById !== 'function' || !document.head || document.getElementById('shs-css')) return;
        const s = document.createElement('style');
        s.id = 'shs-css'; s.textContent = CSS_SYNC;
        document.head.appendChild(s);
    };
    const barra = (pct, pequena) => (pct === null || pct === undefined
        ? '<div class="shs-barra shs-sem' + (pequena ? ' shs-mini' : '') + '" role="progressbar" aria-label="Lendo"><i></i></div>'
        : '<div class="shs-barra' + (pequena ? ' shs-mini' : '') + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><i style="width:' + pct + '%"></i></div>');

    /** Cartão de UMA etapa na página (texto + barra). '' quando SHC.etapaDaPagina não tem nada a dizer. */
    SHC.htmlEtapa = function (st, ids, agoraMs) {
        const e = SHC.etapaDaPagina(st, ids, agoraMs);
        SHC.cssSync();
        return e ? '<div class="shs shs-etapa" role="status" aria-live="polite"><b>' + escH(e.texto) + '</b>' + barra(e.pct) + '</div>' : '';
    };

    // Ads pulado porque não havia aba do painel do vendedor aberta (o fundo grava este resumo na etapa 'ads'; a conta migrada para
    // ads.mercadolivre.com.br só responde a pedido feito de uma página do ML).
    SHC.ADS_SEM_ABA = 'Abra o painel do vendedor do Mercado Livre numa aba para ler o Mercado Ads';
    SHC.adsSemAba = function (st) {
        const e = ((st || {}).etapas || {}).ads;
        return !!e && e.estado === 'pulado' && e.resumo === SHC.ADS_SEM_ABA;
    };
    // v3.1 (29/09/2026, print da dona): por que o Ads não foi lido, cada causa com a sua frase (nunca "confira se está logado" com o
    // login ok). status.erroAds (background.js): sem_sessao | ads_sem_conta (o ML pede abrir o Mercado Ads uma vez) | ads_escolher_conta
    // (abriu sozinho e continuou pedindo: o ML quer que a pessoa escolha a conta de anúncios) | outro = o Mercado Ads não respondeu.
    const ADS_CONTAS = 'https://ads.mercadolivre.com.br/accounts';
    SHC.adsAviso = function (st) {
        const cod = SHC.adsSemAba(st) ? 'sem_aba' : (st || {}).erroAds || '';
        const txt = {
            sem_aba: ['Falta abrir o painel do vendedor', 'Abra o painel do vendedor do Mercado Livre numa aba e clique em Sincronizar agora.', 'O Mercado Ads desta conta só é lido com essa aba aberta.', 'https://vendedores.mercadolivre.com.br', 'Abrir o painel do vendedor'],
            sem_sessao: ['Entre no Mercado Livre', 'Entre no Mercado Livre neste Chrome e clique em Sincronizar agora.', 'O Copiloto lê o Mercado Ads com a sua sessão.', 'https://vendedores.mercadolivre.com.br', 'Abrir o Mercado Livre'],
            ads_sem_conta: ['Abra o Mercado Ads uma vez', 'Abra o Mercado Ads uma vez e clique em Sincronizar agora.', 'O Mercado Livre só libera os números do Ads depois que a conta de anúncios é aberta neste Chrome.', ADS_CONTAS, 'Abrir o Mercado Ads'],
            ads_escolher_conta: ['Escolha a conta de anúncios', 'Abra o Mercado Ads e escolha a conta de anúncios.', 'Depois clique em Sincronizar agora. O Copiloto não escolhe por você.', ADS_CONTAS, 'Abrir o Mercado Ads'],
        }[cod] || (cod ? ['O Mercado Ads não respondeu', 'O Mercado Ads não respondeu agora.', 'Tente de novo em alguns minutos.', '', ''] : null);
        return txt && { cod, titulo: txt[0], frase: txt[1], det: txt[2], link: txt[3], linkTxt: txt[4] };
    };
    /** Aviso âmbar do Ads não lido (SHC.adsAviso), com o link do que abrir; '' quando o Ads foi lido. */
    SHC.htmlAdsSemAba = function (st) {
        const a = SHC.adsAviso(st);
        if (!a) return '';
        SHC.cssSync();
        return '<div class="shs shs-aviso" role="status"><b>' + escH(a.frase) + '</b> ' + escH(a.det)
            + (a.link ? ' <a href="' + escH(a.link) + '" target="_blank" rel="noopener">' + escH(a.linkTxt) + '</a>' : '') + '</div>';
    };

    /**
     * Só o andamento mudou: troca apenas o selo (.sync-caixa) e as etapas (.shs-etapa) de el, sem refazer a página
     * (não engole clique nem apaga o que a pessoa faz). Se os blocos mudaram de número, refaz tudo. → true se trocou só os blocos.
     */
    SHC.trocarSoSync = function (el, html) {
        const t = document.createElement('template'), sel = '.sync-caixa,.shs-etapa,.shs-aviso';
        t.innerHTML = html;
        const velhos = el.querySelectorAll(sel), novos = t.content.querySelectorAll(sel);
        if (!velhos.length || velhos.length !== novos.length) { el.innerHTML = html; return false; }
        velhos.forEach((v, i) => v.replaceWith(novos[i]));
        return true;
    };

    /**
     * Componente: selo colorido + (sincronizando) barra com etapa, % e tempo que falta + (opts.lista) "O que o Copiloto já leu"
     * com as 10 etapas. Botões "Tentar de novo" têm data-sync (a página decide o que fazer no clique).
     */
    SHC.htmlSync = function (st, agoraMs, opts) {
        st = st || {};
        const agora = agoraMs || Date.now(), s = SHC.statusSync(st, agora), o = opts || {};
        SHC.cssSync();
        let h = '<div class="shs shs-' + s.cor + '" data-sync-estado="' + s.estado + '"><span class="shs-selo">' + escH(s.texto) + '</span>';
        if (s.estado === 'sincronizando') h += barra(s.pct) + '<div class="shs-lin">' + escH(s.etapa + ' · ' + s.pct + '% · ' + s.restante) + '</div>';
        if (o.lista) {
            const es = st.etapas || {}, ids = syncEtapas(), p = st.progresso || {};
            let cab;
            if (s.estado === 'sincronizando') {
                const k = ids.findIndex(x => x.id === p.etapa);
                // v2.5.3: sem rótulo (o painel marcou "sincronizando" antes da 1ª batida do fundo) o trecho some: nunca "Etapa 1 de 12 ·  · …".
                cab = ['Etapa ' + (k + 1 || p.indice || 1) + ' de ' + (ids.length || p.total || 9), k >= 0 ? ids[k].rotulo : (p.rotulo || ''), s.restante]
                    .map(x => String(x || '').trim()).filter(Boolean).join(' · ');
            } else {
                const fins = ids.map(x => (es[x.id] || {}).fim).filter(Boolean), fim = fins.length ? Math.max(...fins) : null;
                // Parte não lida = erro ou pulada porque nada foi lido (naoLida). Nenhuma lida: não diz "Lido às".
                const probl = ids.filter(x => (es[x.id] || {}).estado === 'erro' || (es[x.id] || {}).naoLida).length;
                const ms = fim && st.inicio ? fim - st.inicio : null;
                cab = !fim ? 'O que o Copiloto já leu' : probl && probl === ids.length ? 'Tentei ler às ' + hhmm(fim) + ' · nada foi lido agora' : (probl ? 'Lido às ' + hhmm(fim) + ' · ' + probl + (probl === 1 ? ' parte não foi lida' : ' partes não foram lidas')
                    : '✓ Tudo lido às ' + hhmm(fim) + (ms !== null ? ' · levou ' + (ms < 60e3 ? 'menos de 1 min' : Math.round(ms / 60e3) + ' min') : ''));
            }
            h += '<div class="shs-lista"><p class="shs-cab">' + escH(cab) + '</p><ul>' + ids.map(x => {
                const e = es[x.id] || {}, est = e.estado || 'fila';
                let ic = '○', det = s.estado === 'sincronizando' ? 'Na fila' : 'Ainda não lido', extra = '';
                if (est === 'ok') { ic = '✓'; det = (e.resumo || 'Lido') + (e.jaLida && e.fim ? ' · lido às ' + hhmm(e.fim) + ', antes de parar' : ''); }
                else if (est === 'lendo') { ic = '⟳'; det = (e.mesAgora ? SHC.textoLendoMes({ mes: e.mesAgora, feito: e.feito, de: e.de, cobrancas: e.cobrancas, restanteSeg: restanteEtapa(st, e, agora) }) : contagem(e)) || 'Lendo agora…'; extra = barra(e.de > 0 ? Math.min(100, Math.round((e.feito || 0) / e.de * 100)) : null, true); }
                else if (est === 'erro') { ic = '⚠'; det = (e.erro || 'Não deu para ler agora.') + (e.resumoAnterior ? ' Última leitura: ' + e.resumoAnterior + '.' : ''); extra = s.estado === 'sincronizando' ? '' : '<button type="button" data-sync>Tentar de novo</button>'; }
                else if (est === 'pulado') { ic = '—'; det = e.resumo || 'Pulado'; }
                else if (e.resumoAnterior && s.estado !== 'sincronizando') det = 'Última leitura: ' + e.resumoAnterior;
                const diag = SHC.textosMeses(e.meses).map(t => '<small>' + escH(t) + '</small>').join('');
                return '<li class="shs-' + est + '"><span class="shs-ic" aria-hidden="true">' + ic + '</span><span>' + escH(x.rotulo) + '</span><small>' + escH(det) + '</small>' + diag + extra + '</li>';
            }).join('') + '</ul></div>';
        }
        return h + '</div>';
    };

    // v3.3 multi-empresa: números que são da EMPRESA (a conta separada tem os dela em cfg.porConta[sellerId]; sem eles, os padrões — nunca os da outra).
    // configurado (revisão 07/10/2026) também é da empresa: a conta separada sem números próprios não pode herdar o "imposto informado" da outra
    // (o 0% padrão viraria imposto de verdade no lucro), e salvar os números dela não marca a outra como configurada.
    SHC.CAMPOS_EMPRESA = ['imposto_pct', 'margem_alvo_pct', 'despesas_fixas', 'sp_comissao_pct', 'sp_taxa_fixa', 'configurado'];
    SHC.lerCfg = async function () {
        const r = await area().get('cfg'), c = r.cfg || {}, e = await SHC.empresaSeparada();
        if (!e) return Object.assign({}, SHC.PADRAO, c);
        const meu = (c.porConta && c.porConta[e]) || {}, proprio = {};
        SHC.CAMPOS_EMPRESA.forEach(k => { proprio[k] = k in meu ? meu[k] : k === 'configurado' ? false : SHC.PADRAO[k]; });
        return Object.assign({}, SHC.PADRAO, c, proprio, { empresa: e });
    };
    // opc.semMarcar: não marca cfg.configurado (as despesas fixas não podem inventar "imposto 0%").
    SHC.salvarCfg = async function (patch, opc) {
        const r = await crua().get('cfg'), base = Object.assign({}, r.cfg || {}), e = await SHC.empresaSeparada();
        const p = Object.assign({}, patch, opc && opc.semMarcar ? {} : { configurado: true });
        delete p.empresa; delete p.empresaSemNumeros;   // são da leitura (SHC.lerCfg; empresaSemNumeros: a da 3.3.0 em teste), não se gravam
        delete p.porConta;   // só esta função mexe nele: um cfg lido e devolvido inteiro traria o porConta velho por cima do novo
        if (e) {
            const meu = Object.assign({}, (base.porConta || {})[e]);
            SHC.CAMPOS_EMPRESA.forEach(k => { if (k in p) { meu[k] = p[k]; delete p[k]; } });
            base.porConta = Object.assign({}, base.porConta, { [e]: meu });
        }
        await crua().set({ cfg: Object.assign(base, p) });
        empCache = null;   // empresaSeparada pode ter mudado neste patch
        return SHC.lerCfg();
    };

    // ── Despesas fixas do mês (pesquisa aprovada pela dona): aluguel, salários, embalagem, sistemas, contador. cfg.despesas_fixas = [{nome, valor}].
    // Valor por mês, soma simples. Entram no Fechamento DEPOIS do lucro ("Sobra no fim do mês"). Lista vazia = sem a linha (nunca 0 inventado).
    SHC.DESPESA_MAX = 10000000;
    /** Lista guardada em cfg → só as linhas válidas (nome e valor ≥ 0), sempre um array NOVO. */
    SHC.despesasFixas = cfg => ((cfg && Array.isArray(cfg.despesas_fixas)) ? cfg.despesas_fixas : [])
        .map(d => ({ nome: String((d && d.nome) || '').replace(/\s+/g, ' ').trim().slice(0, 40), valor: SHC.num(d && d.valor), desde: d && /^\d{4}-\d{2}$/.test(d.desde || '') ? d.desde : null }))
        .filter(d => d.nome && d.valor !== null && d.valor >= 0 && d.valor <= SHC.DESPESA_MAX).map(d => Object.assign({ nome: d.nome, valor: SHC.r2(d.valor) }, d.desde ? { desde: d.desde } : {}));
    /**
     * Linhas digitadas [{nome, valor (texto)}] → { lista:[{nome, valor}], erros:[{i, campo:'nome'|'valor', texto}] }.
     * Linha toda vazia é ignorada. Valor: SHC.num, de 0 a 10 milhões (0 digitado vale). Nome: obrigatório, até 40 letras.
     */
    SHC.lerDespesasFixas = function (linhas) {
        const lista = [], erros = [];
        (linhas || []).forEach((l, i) => {
            const nome = String((l && l.nome) || '').replace(/\s+/g, ' ').trim(), txtV = String((l && l.valor) === null || (l && l.valor) === undefined ? '' : l.valor).trim();
            if (!nome && !txtV) return;
            const v = SHC.num(txtV);
            if (!nome) erros.push({ i, campo: 'nome', texto: 'Dê um nome à despesa (ex.: Aluguel).' });
            if (v === null || v < 0 || v > SHC.DESPESA_MAX) erros.push({ i, campo: 'valor', texto: (nome ? nome.slice(0, 40) : 'Valor') + ': use um valor em reais por mês, de 0 a 10.000.000 (ex.: 1.500).' });
            else if (nome) lista.push({ nome: nome.slice(0, 40), valor: SHC.r2(v) });
        });
        return { lista, erros };
    };
    /**
     * Despesas fixas que valem para o mês (AAAA-MM). hoje = 'AAAA-MM-DD'. → null (lista vazia ou mês que ainda não começou)
     * | { valor, mensal, n, proporcional, dias, diasMes }. Mês em andamento = proporcional aos dias corridos (mensal × dia de hoje ÷ dias do mês).
     */
    SHC.despesasFixasDoMes = function (lista, mes, hoje) {
        // desde (AAAA-MM do cadastro): a despesa só vale do mês em que foi cadastrada em diante (nunca num Fechamento de antes dela).
        const ls = (Array.isArray(lista) ? lista : []).filter(d => d && !(d.desde && d.desde > mes));
        if (!ls.length || !/^\d{4}-\d{2}$/.test(mes || '')) return null;
        const mensal = SHC.r2(ls.reduce((s, d) => s + (SHC.num(d.valor) || 0), 0));
        const diasMes = new Date(+mes.slice(0, 4), +mes.slice(5, 7), 0).getDate(), mesHoje = /^\d{4}-\d{2}-\d{2}/.test(hoje || '') ? hoje.slice(0, 7) : null;
        if (mesHoje && mes > mesHoje) return null;
        const proporcional = mesHoje === mes, dias = proporcional ? Math.min(diasMes, +hoje.slice(8, 10)) : diasMes;
        return { valor: proporcional ? SHC.r2(mensal * dias / diasMes) : mensal, mensal, n: ls.length, proporcional, dias, diasMes };
    };
    /** Grava só a lista (objeto cfg NOVO). Não marca cfg.configurado: salvar despesas não pode inventar "imposto 0%". */
    SHC.salvarDespesasFixas = async function (lista) {
        // v3.3 multi-empresa: a conta separada guarda as despesas dela (cfg.porConta[sellerId].despesas_fixas): SHC.salvarCfg decide onde.
        const antes = SHC.despesasFixas(await SHC.lerCfg()), mes = SHC.hoje().slice(0, 7);
        // desde: o da mesma despesa já guardada (pelo nome); despesa nova = o mês de hoje
        const nova = SHC.despesasFixas({ despesas_fixas: (lista || []).map(d => Object.assign({}, d, { desde: (d && d.desde) || ((antes.find(a => a.nome === String((d && d.nome) || '').replace(/\s+/g, ' ').trim().slice(0, 40)) || {}).desde) || mes })) });
        return SHC.salvarCfg({ despesas_fixas: nova }, { semMarcar: true });
    };

    SHC.lerCustos = async function (chaves) {
        if (!chaves.length) return {};
        return comComponentes(await area().get(chaves));   // kit: vêm junto os SKUs de dentro
    };
    SHC.salvarCusto = async function (canal, id, dados) {
        const k = SHC.chave(canal, id);
        const atual = (await area().get(k))[k] || {};
        const novo = Object.assign(atual, dados, { atualizado: Date.now() });
        await area().set({ [k]: novo });
        return novo;
    };
    SHC.removerCusto = async function (canal, id) { await area().remove(SHC.chave(canal, id)); };

    // Tudo (painel): separa custos, vistos e cfg.
    SHC.lerTudo = async function () {
        const todos = await area().get(null);
        const out = { cfg: await SHC.lerCfg(), custos: {}, vistos: {} };   // v3.3: com os números da empresa da conta aberta
        for (const k in todos) {
            const p = k.split('|');
            if (p.length < 3 || (p[0] !== 'c' && p[0] !== 'v')) continue;
            const canal = p[1], id = p.slice(2).join('|');   // canal 'sku' = custo por SKU (todos os canais)
            if (p[0] === 'c' && canal === 'sku' && !(SHC.num(todos[k].custo) > 0)) continue;   // só medidas/EAN (v2.2): não é custo
            (p[0] === 'c' ? out.custos : out.vistos)[canal + '|' + id] = Object.assign({ canal, id }, todos[k]);
        }
        return out;
    };

    // ── Planilha (CSV com ; — abre direto no Excel em português) ──────────────────────────────
    // v2.1: custo por SKU (serve para planilha do Bling, do Tiny ou de qualquer ERP) + custos antigos por anúncio.
    //   sku;canal;id;titulo;custo;outros;frete;tipo  → linha de SKU: sku preenchido; linha de anúncio: canal + id.
    const COLUNAS = ['sku', 'canal', 'id', 'titulo', 'custo', 'outros', 'frete', 'tipo'];
    const fmtNum = v => (v === null || v === undefined || v === '') ? '' : String(v).replace('.', ',');
    // Texto que começa com = + - @ vira fórmula no Excel: um apóstrofo na frente desliga (e sai de novo na leitura).
    const esc = v => {
        let s = String(v === null || v === undefined ? '' : v);
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
        return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const nomeCanal = c => c === 'ml' ? 'mercadolivre' : (c === 'sp' ? 'shopee' : String(c || ''));

    // linhas: {sku, titulo, custo, outros} (por SKU) ou {canal, id, titulo, custo, outros, frete, tipo} (por anúncio)
    // v2.4 (V11/V12): coluna "origem" (manual|planilha|tiny) no fim, só quando alguma linha traz origem.
    const origemCSV = o => o === 'erp' ? 'tiny' : (o === 'manual' || o === 'planilha' ? o : '');
    SHC.paraCSV = function (linhas) {
        const comOrigem = (linhas || []).some(l => l && origemCSV(l.origem));
        const out = [COLUNAS.concat(comOrigem ? ['origem'] : []).join(';')];
        for (const l of linhas) {
            const porSku = !!l.sku && !l.id;
            out.push([porSku ? l.sku : '', porSku ? '' : nomeCanal(l.canal), porSku ? '' : l.id, l.titulo || '',
                fmtNum(l.custo), fmtNum(l.outros), porSku ? '' : fmtNum(l.frete), porSku ? '' : (l.tipo || '')]
                .concat(comOrigem ? [origemCSV(l.origem)] : []).map(esc).join(';'));
        }
        return '﻿' + out.join('\r\n');   // BOM: o Excel reconhece acento
    };

    // Texto inteiro → linhas de células. Aspas podem ter ; e quebra de linha dentro (descrição do ERP).
    function celulas(texto, sep) {
        const linhas = []; let lin = [], cel = '', aspas = false;
        for (let i = 0; i < texto.length; i++) {
            const ch = texto[i];
            if (aspas) {
                if (ch === '"') { if (texto[i + 1] === '"') { cel += '"'; i++; } else aspas = false; }
                else cel += ch;
            } else if (ch === '"' && cel.trim() === '') { aspas = true; cel = ''; }
            else if (ch === sep) { lin.push(cel); cel = ''; }
            else if (ch === '\n' || ch === '\r') {
                if (ch === '\r' && texto[i + 1] === '\n') i++;
                lin.push(cel); linhas.push(lin); lin = []; cel = '';
            } else cel += ch;
        }
        lin.push(cel); linhas.push(lin);
        return linhas.map(l => l.map(c => c.trim().replace(/^'(?=[=+\-@])/, ''))).filter(l => l.some(c => c !== ''));
    }
    // Separador: o da 1ª linha (fora das aspas). ";" ganha de TAB, que ganha de ",".
    function separador(texto) {
        let aspas = false; const n = { ';': 0, '\t': 0, ',': 0 };
        for (let i = 0; i < texto.length; i++) {
            const ch = texto[i];
            if (ch === '"') aspas = !aspas;
            else if (!aspas && (ch === '\n' || ch === '\r')) break;
            else if (!aspas && ch in n) n[ch]++;
        }
        return n[';'] ? ';' : (n['\t'] ? '\t' : ',');
    }
    // "Preço de custo (R$)" → "preco de custo"; "preco_custo" → "preco custo"
    const nomeCol = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, ' ').trim().replace(/( (r|rs))+$/, '');
    // Nomes aceitos, do melhor para o pior. "ID" (número interno do ERP) nunca é SKU; "Código Pai" também não.
    const NOMES_SKU = ['codigo sku', 'sku codigo', 'cod sku', 'sku', 'codigo', 'codigo do produto', 'codigo produto', 'cod produto', 'cod', 'referencia'];
    const NOMES_CUSTO = [
        ['custo', 'custo un', 'custo unit', 'custo unitario', 'preco de custo', 'preco custo', 'valor de custo', 'valor custo', 'custo do produto', 'custo produto'],
        ['custo medio', 'preco de custo medio', 'preco custo medio', 'custo medio unitario'],
        ['preco de compra', 'preco compra', 'valor de compra', 'valor compra', 'custo de compra', 'ultimo preco de compra'],
    ];
    function nivelCusto(n) {
        for (let i = 0; i < NOMES_CUSTO.length; i++) if (NOMES_CUSTO[i].indexOf(n) >= 0) return i;
        if (/^custo/.test(n) && !/frete|envio|embalagem|total|adicional|operacional|fixo/.test(n)) return /medio/.test(n) ? 1 : 0;
        return -1;
    }
    const pareceId = n => /^mlb ?\d{6,}$/.test(n) || /^\d{5,}$/.test(n) || /^f\d{6,}$/.test(n);

    /**
     * Lê a planilha. Aceita: a do Copiloto (antiga "canal;id;…" ou nova "sku;canal;id;…"), a exportada do
     * Bling/Tiny (Código + Preço de custo) e a simples "id;custo" sem cabeçalho.
     * → { itens:[{sku,custo,…} | {canal,id,custo,…}], erros:[texto], ignorados:{motivo: n}, colunas:{sku,custo,id}, formato, linhas }
     * Custo vazio ou 0 nunca vira item; SKU sem custo mas com medidas/EAN vai para soMedidas. Com coluna de SKU, o valor é SKU (mesmo só com números).
     */
    SHC.lerCSV = function (texto) {
        texto = String(texto || '').replace(/^﻿/, '');
        return SHC.lerTabela(celulas(texto, separador(texto)));
    };
    // Mesmas regras para qualquer tabela já dividida em células (CSV ou .xls via SHC.lerXls).
    SHC.lerTabela = function (tab) {
        tab = (tab || []).filter(l => l && l.some(c => String(c).trim() !== ''));
        const vazio = msg => ({ itens: [], erros: [msg], ignorados: {}, colunas: {}, formato: '', linhas: 0 });
        if (!tab.length) return vazio('Planilha vazia.');
        const cab = tab[0], nomes = cab.map(nomeCol);
        const idx = { sku: -1, canal: -1, id: -1, titulo: -1, custo: -1, outros: -1, frete: -1, tipo: -1, peso: -1, pesoLiq: -1, larg: -1, alt: -1, comp: -1, ean: -1, origem: -1 };
        let nivel = 99, prioSku = 99;
        nomes.forEach((n, i) => {
            const ps = NOMES_SKU.indexOf(n), nc = nivelCusto(n);
            if (ps >= 0 && ps < prioSku) { prioSku = ps; idx.sku = i; }
            else if (nc >= 0) { if (nc < nivel) { nivel = nc; idx.custo = i; } }
            else if (/^(canal|marketplace)/.test(n) && idx.canal < 0) idx.canal = i;
            else if (/^(id|mlb|item|anuncio)\b/.test(n) && !/pai/.test(n) && idx.id < 0) idx.id = i;
            else if (/^(titulo|nome|produto|descricao)( do produto| do anuncio)?$/.test(n) && idx.titulo < 0) idx.titulo = i;
            else if (/^(outros|embalagem)/.test(n) && idx.outros < 0) idx.outros = i;
            else if (/^frete/.test(n) && idx.frete < 0) idx.frete = i;
            else if (/^tipo( de anuncio)?$/.test(n) && idx.tipo < 0) idx.tipo = i;
            // v2.2: medidas da embalagem e EAN (Tiny: "Peso bruto (Kg)", "Largura embalagem", …, "GTIN/EAN") → prova de medida do frete
            else if (/^peso bruto/.test(n) && idx.peso < 0) idx.peso = i;
            else if (/^peso( liquido)?( kg)?$/.test(n) && idx.pesoLiq < 0) idx.pesoLiq = i;
            else if (/^largura( da)? embalagem/.test(n) && idx.larg < 0) idx.larg = i;
            else if (/^altura( da)? embalagem/.test(n) && idx.alt < 0) idx.alt = i;
            else if (/^comprimento( da)? embalagem/.test(n) && idx.comp < 0) idx.comp = i;
            else if (/^(gtin ean|gtin|ean|codigo de barras)$/.test(n) && idx.ean < 0) idx.ean = i;
            else if (n === 'origem' && idx.origem < 0) idx.origem = i;   // v2.4: cópia de segurança do Copiloto
        });
        // Medidas de uma linha: só número > 0; peso bruto, senão o líquido; EAN só com 8 a 14 dígitos.
        const medidasDe = c => {
            const m = {}, pos = (k, i) => { const v = i >= 0 ? SHC.num(c[i]) : null; if (v > 0 && m[k] === undefined) m[k] = v; };
            pos('pesoKg', idx.peso); pos('pesoKg', idx.pesoLiq);
            pos('larguraCm', idx.larg); pos('alturaCm', idx.alt); pos('comprimentoCm', idx.comp);
            const ean = idx.ean >= 0 ? String(c[idx.ean] || '').replace(/\D/g, '') : '';
            if (/^\d{8,14}$/.test(ean)) m.ean = ean;
            return m;
        };
        // Cabeçalho = alguma coluna conhecida e NENHUMA célula com cara de ID de anúncio (senão é dado).
        const temCab = !nomes.some(pareceId) && (idx.sku >= 0 || idx.custo >= 0 || idx.id >= 0 || idx.canal >= 0);
        let formato;
        if (!temCab) { Object.keys(idx).forEach(k => { idx[k] = -1; }); idx.id = 0; idx.custo = 1; formato = 'simples'; }
        else if (idx.custo < 0) return vazio('Não achei a coluna do custo. Use um destes nomes na primeira linha: "Custo", "Preço de custo" ou "Custo médio".');
        else if (idx.canal >= 0 && (idx.id >= 0 || idx.sku >= 0)) formato = 'copiloto';
        else if (idx.sku >= 0) formato = 'erp';
        else if (idx.id >= 0) formato = 'anuncio';
        else return vazio('Não achei a coluna do código (SKU). Use "Código" ou "SKU" na primeira linha.');

        const itens = [], erros = [], ignorados = {}, porChave = {}, soMedidas = [], porSkuMed = {};
        const ignora = motivo => { ignorados[motivo] = (ignorados[motivo] || 0) + 1; };
        const dados = tab.slice(temCab ? 1 : 0);
        dados.forEach((c, n) => {
            const nLinha = n + (temCab ? 2 : 1);
            const custo = SHC.num(c[idx.custo]);
            const sku = idx.sku >= 0 && formato !== 'simples' ? SHC.normalizaSku(c[idx.sku]) : '';
            const med = sku ? medidasDe(c) : {};
            if (!(custo > 0)) {
                // Sem custo: guarda só medidas/EAN do SKU (se houver). Custo 0 continua não sendo custo.
                // Não entra em "ignorados": as medidas SÃO gravadas (conta própria em soMedidas.length).
                if (!Object.keys(med).length) { ignora('custo vazio ou 0'); return; }
                if (porSkuMed[sku] !== undefined) { ignora('repetido (valeu a última linha)'); soMedidas[porSkuMed[sku]] = Object.assign({ sku }, med); }
                else { porSkuMed[sku] = soMedidas.length; soMedidas.push(Object.assign({ sku }, med)); }
                return;
            }
            let it, chave;
            if (sku) {
                it = Object.assign({ sku, custo }, med); chave = 'sku|' + sku;
            } else if (formato === 'erp') {
                ignora('sem código (SKU)'); return;
            } else {
                const bruto = c[idx.id] || '';
                if (!bruto) { ignora(idx.sku >= 0 ? 'sem código (SKU)' : 'sem ID'); return; }
                // Sem coluna de canal, só MLB…/F… é anúncio: número puro pode ser o ID interno do ERP (não vira Shopee).
                if (formato === 'anuncio' && idx.canal < 0 && !/^\s*(mlb|f\d)/i.test(bruto)) { ignora('sem canal: use a coluna canal ou o SKU'); return; }
                let canal = idx.canal >= 0 ? (c[idx.canal] || '').toLowerCase() : '';
                canal = /shopee|^sp$/.test(canal) ? 'sp' : (/mercado|^ml$/.test(canal) ? 'ml' : (/^(mlb|f\d)/i.test(bruto) ? 'ml' : 'sp'));
                const id = SHC.normalizaId(canal, bruto);
                if (!id) { ignora('ID inválido'); erros.push('Linha ' + nLinha + ': ID inválido "' + String(bruto).slice(0, 40) + '"'); return; }
                it = { canal, id, custo }; chave = canal + '|' + id;
                if (idx.frete >= 0 && SHC.num(c[idx.frete]) !== null) { if (SHC.num(c[idx.frete]) >= 0) it.frete = SHC.num(c[idx.frete]); else erros.push('Linha ' + nLinha + ': frete negativo não foi usado'); }
                if (idx.tipo >= 0 && /prem/i.test(c[idx.tipo] || '')) it.tipo = 'premium';
                else if (idx.tipo >= 0 && /cl[aá]ss/i.test(c[idx.tipo] || '')) it.tipo = 'classico';
            }
            // Negativo aumentaria a sobra (a tabela do painel também recusa): fica de fora, com aviso da linha.
            if (idx.outros >= 0 && SHC.num(c[idx.outros]) !== null) { if (SHC.num(c[idx.outros]) >= 0) it.outros = SHC.num(c[idx.outros]); else erros.push('Linha ' + nLinha + ': "outros" negativo não foi usado'); }
            if (idx.titulo >= 0 && c[idx.titulo]) it.titulo = c[idx.titulo].replace(/\s+/g, ' ').slice(0, 120);
            const org = idx.origem >= 0 ? String(c[idx.origem] || '').trim().toLowerCase() : '';
            if (/^(manual|planilha|tiny|erp)$/.test(org)) it.origem = org === 'tiny' ? 'erp' : org;
            if (porChave[chave] !== undefined) { ignora('repetido (valeu a última linha)'); itens[porChave[chave]] = it; return; }
            porChave[chave] = itens.length;
            itens.push(it);
        });
        const colunas = {};
        ['sku', 'custo', 'id', 'titulo'].forEach(k => { if (temCab && idx[k] >= 0) colunas[k] = cab[idx[k]]; });
        // SKUs só com medidas vão PENDURADOS na lista (itens.soMedidas): a prévia continua contando "com custo"
        // e SHC.importar(itens) grava as medidas junto. Contagem: itens.length com custo + soMedidas.length só com medidas
        // + ignorados = linhas da planilha. O painel deve mostrar "e N SKUs com peso/medidas" e liberar o Importar com soMedidas.length > 0.
        itens.soMedidas = soMedidas;
        return { itens, soMedidas, erros, ignorados, colunas, formato, linhas: dados.length };
    };

    // Grava o que a planilha trouxe. SKU → c|sku|<SKU> (mesma chave de SHC.chaveSku), origem 'planilha'.
    // Nunca grava custo 0; título que já existe fica.
    // v2.2: medidas/EAN (pesoKg, larguraCm, alturaCm, comprimentoCm, ean) vão no mesmo c|sku, também do SKU SEM custo
    // (itens.soMedidas de SHC.lerTabela ou item com custo 0): aí grava só as medidas, nunca o campo custo.
    // Devolve quantos CUSTOS foram gravados (as medidas não entram na conta).
    SHC.importar = async function (itens) {
        const chaveDe = it => it.sku ? SHC.chaveSku(it.sku) : SHC.chave(it.canal, it.id);
        const temCusto = it => SHC.num(it.custo) > 0;
        const medidas = it => {
            const m = {};
            if (it.sku) MEDIDAS.forEach(k => { const v = k === 'ean' ? String(it.ean || '').replace(/\D/g, '') : SHC.num(it[k]); if (k === 'ean' ? /^\d{8,14}$/.test(v) : v > 0) m[k] = v; });
            return m;
        };
        const todos = (itens || []).concat((itens && itens.soMedidas) || []);
        const validos = todos.filter(it => it && (temCusto(it) ? (it.sku ? SHC.chaveSku(it.sku) : (it.canal && it.id))
            : (it.sku && SHC.chaveSku(it.sku) && Object.keys(medidas(it)).length)));
        if (!validos.length) return 0;
        const chaves = validos.map(chaveDe);
        const atuais = await area().get(chaves);
        const lote = {}, agora = Date.now(), comCusto = new Set();
        validos.forEach((it, i) => {
            const k = chaves[i], base = Object.assign({}, lote[k] || atuais[k] || {}, medidas(it));
            if (!temCusto(it)) { lote[k] = Object.assign(base, { origem: base.origem || 'planilha', atualizado: agora }); return; }
            comCusto.add(k);
            // v2.4 (V12): a origem da cópia de segurança vale (custo "manual" continua manual e o Tiny não troca).
            const d = Object.assign(base, { custo: SHC.num(it.custo), origem: /^(manual|planilha|erp)$/.test(it.origem || '') ? it.origem : 'planilha', atualizado: agora });
            if (SHC.num(it.outros) >= 0 && SHC.num(it.outros) !== null) d.outros = SHC.num(it.outros);
            if (it.titulo && !base.titulo) d.titulo = it.titulo;
            if (!it.sku) {
                if (SHC.num(it.frete) >= 0 && SHC.num(it.frete) !== null) d.frete = SHC.num(it.frete);
                if (it.tipo) d.tipo = it.tipo;
            }
            lote[k] = d;
        });
        await area().set(lote);
        return comCusto.size;
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);
