// ── 3.2.1 (revisão de 02/10/2026): faixa dos números que a aba do ML manda (o que vem da página não é verdade por si) ──
// O leitor do ML (SHC.valorRS, dinheiro) só devolve número ≥ 0; tarifa e "você recebe" nunca passam do preço; o frete do ML para o vendedor
// fica muito abaixo de R$ 1.000. Texto, NaN, Infinity, negativo ou fora disso não é leitura do ML: o número sai (null), o anúncio fica.
// Um número possível e errado continua passando: veja NOVIDADES-3.2.1.md, "Riscos que ficam", item 3.
const FAIXA_FRETE_MAX = 1000;
const numOk = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const naFaixa = (v, min, max) => (v === null || v === undefined || numOk(v, min, max) ? v : null);   // ausente continua ausente
const qtdOk = v => (v === null || v === undefined || (Number.isInteger(v) && v >= 0 && v <= 1e7) ? v : null);
const txtOk = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
// Um anúncio da lista (SHC.mlAnunciosDoEstado). Sem preço possível não há como conferir a tarifa e o "você recebe": saem também.
// Frete e taxa operacional (custo de envio do ML) podem passar do preço num anúncio barato: até o preço ou até R$ 1.000.
function anuncioNaFaixa(i) {
    if (!i || typeof i !== 'object' || Array.isArray(i)) return null;
    const o = Object.assign({}, i), temPreco = numOk(o.preco, 0.01, Infinity), p = temPreco ? o.preco : 0;
    o.preco = temPreco ? o.preco : null;
    ['tarifa', 'recebe'].forEach(k => { if (k in o) o[k] = temPreco ? naFaixa(o[k], 0, p) : null; });
    ['frete', 'taxaOperacional'].forEach(k => { if (k in o) o[k] = naFaixa(o[k], 0, Math.max(p, FAIXA_FRETE_MAX)); });
    ['precoCheio', 'flexBonus'].forEach(k => { if (k in o) o[k] = naFaixa(o[k], k === 'precoCheio' ? 0.01 : 0, Infinity); });
    if ('qtdVariacoes' in o && !(Number.isInteger(o.qtdVariacoes) && o.qtdVariacoes > 0 && o.qtdVariacoes <= 5000)) delete o.qtdVariacoes;
    if ('skus' in o) o.skus = Array.isArray(o.skus) ? o.skus.filter(s => typeof s === 'string') : [];
    // Revisão final 02/10: os textos que o painel percorre (titulo.toLowerCase() na busca) ficam texto; o leitor do ML sempre manda texto.
    ['titulo', 'status', 'sku', 'skuFonte', 'tipo', 'estoque', 'familia', 'familyId', 'userProductId'].forEach(k => { if (k in o && typeof o[k] !== 'string') o[k] = ''; });
    return o;
}
// Uma proposta da Central de promoções (SHC.mlPromosDoEstado): sem preço e "você recebe" possíveis ela não serve (o leitor do ML também
// descarta). Tarifa ou envio presentes e impossíveis: a proposta não entra (regra da 3.2.1, já no NOVIDADES).
function propostaNaFaixa(x) {
    if (!x || typeof x !== 'object' || Array.isArray(x) || !numOk(x.preco, 0.01, Infinity)) return false;
    const opcional = (v, max) => v === null || v === undefined || numOk(v, 0, max);
    return numOk(x.recebe, 0, x.preco) && opcional(x.tarifa, x.preco) && opcional(x.envio, Math.max(x.preco, FAIXA_FRETE_MAX));
}
// Uma linha do Editor em massa (SHC.editorLinha + variacoes:[SHC.editorVariacoes]). Os campos que o Copiloto percorre ou soma ficam com o tipo
// certo (variacoes texto travava o fontesSku e, com ele, toda leitura de Anúncios; dicas texto travava o cartão de pendências).
function editorNaFaixa(o) {
    const r = Object.assign({}, o);
    ['estoque', 'estoqueFlex', 'estoqueFull'].forEach(k => { if (k in r) r[k] = qtdOk(r[k]); });
    if ('nVar' in r && !(Number.isInteger(r.nVar) && r.nVar > 0 && r.nVar <= 5000)) delete r.nVar;
    if ('qNivel' in r && !/^(GOOD|MEDIUM|BAD)$/.test(String(r.qNivel))) r.qNivel = '';   // v3.3
    ['id', 'status', 'up', 'familyId', 'titulo', 'sku', 'tipo', 'tarifaTxt', 'prazo', 'garantia', 'qualidade', 'pai', 'nome'].forEach(k => { if (k in r && typeof r[k] !== 'string') r[k] = ''; });
    ['entrega', 'custoEnvio'].forEach(k => { if (k in r) r[k] = r[k] && typeof r[k] === 'object' && !Array.isArray(r[k]) ? { id: txtOk(r[k].id, 40), txt: txtOk(r[k].txt, 80) } : null; });
    if ('dicas' in r) r.dicas = Array.isArray(r.dicas) ? r.dicas.filter(t => typeof t === 'string').map(t => t.slice(0, 80)).slice(0, 10) : [];
    if ('variacoes' in r) {
        if (!Array.isArray(r.variacoes)) delete r.variacoes;
        else r.variacoes = r.variacoes.filter(v => v && typeof v === 'object' && !Array.isArray(v)).slice(0, 1000)
            .map(v => ({ id: txtOk(v.id, 40), sku: txtOk(v.sku, 80), nome: txtOk(v.nome, 60), estoque: qtdOk(v.estoque), estoqueFlex: qtdOk(v.estoqueFlex), estoqueFull: qtdOk(v.estoqueFull) }));
    }
    return r;
}

// A aba aberta na Central de promoções manda o que está na tela (mais fresco que a última sincronização). Mesma fila das gravações.
async function juntarPagina(conta, dados) {
    // 3.2.1: teto igual ao dos outros caminhos da aba e só proposta com preço, tarifa, envio e "você recebe" possíveis (propostaNaFaixa).
    const familias = Array.isArray(dados.familias) ? dados.familias.filter(f => f && typeof f.chave === 'string').slice(0, 500) : [];
    const propostas = Array.isArray(dados.propostas) ? dados.propostas.filter(propostaNaFaixa).slice(0, 2000) : [];
    await emFila(async () => {
        const snap = (await SHC.lerPromos(conta)) || { ts: Date.now(), paginas: 0, familias: [], propostas: [] };
        const chaves = new Set(familias.map(f => f.chave));
        snap.familias = snap.familias.filter(f => !chaves.has(f.chave)).concat(familias);
        snap.propostas = snap.propostas.filter(p => !chaves.has(p.familia)).concat(propostas);
        snap.ts = Date.now();
        if (snap.familias.length) delete snap.vazio;
        await SHC.salvarPromos(conta, snap);
    });
}

// A aba na lista de Anúncios manda a página que está na tela: entra no retrato da conta dela (já conferida).
// v3.2: famílias abertas pela aba (SHC.mlParaAbrir + row/expanded) vêm em familias → snap.familias (pai separado dos itens).
// lidoEm = quando a aba leu a página (o estado embutido é do carregamento da página): leitura mais velha que o retrato não entra (SHC.mesclaAnuncios).
async function juntarAnuncios(conta, itens, familias, lidoEm) {
    const lote = itens.slice(0, 500).map(anuncioNaFaixa), fams = Array.isArray(familias) ? familias.filter(f => f && /^[A-Z]{2}\d+$/.test(String(f.id || ''))).slice(0, 100) : [];
    let saiu = 0;
    const snap = await emFila(async () => {
        const antes = await SHC.lerAnuncios(conta);
        const s = SHC.mesclaAnuncios(antes, lote, fams.length ? { familias: fams } : undefined, Object.assign(await fontesSku(conta, antes), { lidoEm }));
        if (SHC.retratoMudou(antes, s) || fams.length) await SHC.salvarAnuncios(conta, s);   // nada novo: não regrava (nem avisa as abas)
        saiu = await gravarPromoSaiu(conta, antes, s, lote);   // v3.2.0
        return s;
    });
    await emFila(() => gravarFretes(lote));
    if (saiu && !emAndamento) atualizarAlertas(conta).catch(() => {});   // v3.2.0: "Saiu da promoção" já no sino (sincronização rodando: a etapa Alertas dela recalcula)
    return snap.itens.length;
}

// v3.3 Experiência de compra (SHC.mlExperienciaCompra) vinda da aba: tipos e tamanhos conferidos (a aba pode ter sido adulterada).
function experienciaNaFaixa(x) {
    if (!x || typeof x !== 'object' || Array.isArray(x) || !/^[A-Z]{3}U?\d{4,20}$/.test(String(x.id || ''))) return null;
    const nota = Number.isInteger(x.nota) && x.nota >= 0 && x.nota <= 100 ? x.nota : null, faixa = /^(boa|mediana|ruim|sem)$/.test(x.faixa) ? x.faixa : (nota === null ? 'sem' : SHC.faixaExperiencia('', nota));
    const lista = (a, n, t) => (Array.isArray(a) ? a.filter(v => typeof v === 'string').map(v => v.slice(0, t)).slice(0, n) : []);
    return { id: String(x.id), up: !!x.up, nota, faixa, cor: txtOk(x.cor, 20), status: /^(active|paused|moderated)$/.test(x.status) ? x.status : '', pelaExperiencia: x.pelaExperiencia === true,
        congelado: x.congelado === true, congeladoTxt: txtOk(x.congeladoTxt, 200), de: txtOk(x.de, 10), ate: txtOk(x.ate, 10), consequencia: txtOk(x.consequencia, 200),
        motivos: lista(x.motivos, 3, 300), recomendacoes: lista(x.recomendacoes, 3, 160), acaoPrincipal: txtOk(x.acaoPrincipal, 160),
        problemas: (Array.isArray(x.problemas) ? x.problemas : []).filter(p => p && typeof p === 'object').slice(0, 10).map(p => ({ chave: txtOk(p.chave, 40), grupo: txtOk(p.grupo, 20),
            titulo: txtOk(p.titulo, 90), qtd: qtdOk(p.qtd) || 0, reclamacoes: qtdOk(p.reclamacoes) || 0, cancelamentos: qtdOk(p.cancelamentos) || 0, principal: p.principal === true, remedio: txtOk(p.remedio, 160) })),
        ts: Date.now() };
}
// exp:<conta> = { ts, porItem:{MLB: registro}, porUp:{MLBU: registro}, antes:{porItem:{MLB:{nota}}, porUp:{…}} } — antes = a nota da leitura anterior
// (o alerta "caiu N pontos"). Leitura nova só troca o que veio; o resto fica. → quantos registros entraram.
async function juntarExperiencia(conta, lista) {
    const novos = (Array.isArray(lista) ? lista : []).slice(0, 200).map(experienciaNaFaixa).filter(Boolean);
    if (!novos.length) return 0;
    await emFila(async () => {
        const k = 'exp:' + conta, ant = (await SHC.lerChave(k)) || {}, porItem = Object.assign({}, ant.porItem), porUp = Object.assign({}, ant.porUp);
        const antes = { porItem: Object.assign({}, (ant.antes || {}).porItem), porUp: Object.assign({}, (ant.antes || {}).porUp) };
        novos.forEach(x => {
            const alvo = x.up ? porUp : porItem, velho = alvo[x.id], a = x.up ? antes.porUp : antes.porItem;
            if (velho && velho.nota !== null && velho.nota !== x.nota) a[x.id] = { nota: velho.nota, ts: velho.ts || 0 };
            alvo[x.id] = x;
        });
        await SHC.gravarChave(k, { ts: Date.now(), porItem, porUp, antes });
    });
    return novos.length;
}

// v3.2 Editor em massa (a seller abriu a tela; a aba leu só com GET): editor:<conta> = { ts, total, completo, porItem:{MLB: SHC.editorLinha + variacoes} }.
// Leitura parcial só junta. Depois completa o SKU que a lista não mostra (anúncio com variações) no retrato. → quantos anúncios vieram.
async function juntarEditor(conta, d) {
    const porItem = {};
    Object.keys(d.porItem).slice(0, 5000).forEach(id => { const o = d.porItem[id]; if (/^MLB\d{6,14}$/.test(id) && o && typeof o === 'object' && !Array.isArray(o)) porItem[id] = editorNaFaixa(o); });   // 3.2.1: tipos conferidos
    const n = Object.keys(porItem).length;
    if (!n) return 0;
    await emFila(async () => {
        const k = 'editor:' + conta, ant = await SHC.lerChave(k), base = d.completo || !ant ? {} : Object.assign({}, ant.porItem || {});
        // Variações que não vieram desta vez (GET que falhou, teto) ficam as já lidas: o SKU de cada variação não some (auditoria 01/10/2026).
        const antP = (ant && ant.porItem) || {};
        Object.keys(porItem).forEach(id => { const o = porItem[id], a = antP[id]; if (o.nVar > 0 && !(Array.isArray(o.variacoes) && o.variacoes.length) && a && Array.isArray(a.variacoes) && a.variacoes.length) porItem[id] = Object.assign({}, o, { variacoes: a.variacoes }); });
        await SHC.gravarChave(k, { ts: Date.now(), total: typeof d.total === 'number' ? d.total : null, completo: !!d.completo, porItem: Object.assign(base, porItem) });
    });
    await completarSkusRetrato(conta);
    await erpConferir(conta).catch(() => {});   // v3.2: o SKU de cada variação chegou — o cruzamento ERP × ML confere variação por variação
    return n;
}

// v3.1 Agenda do Canal ({acao:'canal_ler_anuncios', itemIds}): lê só os anúncios que faltam no retrato, com a MESMA leitura da lista de
// Anúncios da sincronização (lerPaginaML + SHC.mlPaginaAnuncios), buscando pelo código. Só GET. Visto ao vivo em 29/09/2026: /anuncios/lista
// desvia (302) para /anuncios; /anuncios?search=MLB… traz o anúncio. Só vale a linha com o mesmo código, e nunca junta página de outra conta
// (dono diferente da conta aberta no Copiloto; página sem dono = a sessão deste Chrome, como em confereSessao).
// → { ok:true, lidos:[MLB…] } | { ok:false, motivo:'login'|'outra_conta'|'indisponivel', lidos:[] }
async function lerAnunciosPorId(ids) {
    const conta = await SHC.contaAtual(), achados = [];
    const alvo = [...new Set((ids || []).map(String).filter(i => /^MLB\d{6,14}$/.test(i)))].slice(0, 20);
    let falhas = 0, login = false, outra = false;
    for (const id of alvo) {
        const pag = await lerPaginaML(BASE + '/anuncios?search=' + id, 'ler_pagina_anuncios', SHC.mlPaginaAnuncios, null);
        if (pag.falha) { falhas++; login = login || pag.falha === 'login'; continue; }
        const d = pag.dados || {}, dono = d.conta && d.conta.sellerId;
        if (dono && conta !== 'atual' && String(dono) !== String(conta)) { outra = true; continue; }
        achados.push(...(d.itens || []).filter(i => i && i.itemId === id));
        await espera(PAUSA_MS / 2);
    }
    if (achados.length) await juntarAnuncios(conta, achados);
    const lidos = [...new Set(achados.map(i => i.itemId))];
    if (!lidos.length && (outra || (alvo.length && falhas === alvo.length))) return { ok: false, motivo: outra ? 'outra_conta' : login ? 'login' : 'indisponivel', lidos };
    return { ok: true, lidos };
}

// v3.1 Robô do Canal (alarme 'shc-canal'): com shc:canal:robo.ligado, 1 vez por dia monta a agenda dos próximos dias do canal escolhido na
// Agenda (shc:canal:sel) com a MESMA regra da tela (SHC.canalRoboPassada) e guarda em shc:canal:plano:<canal> (o painel avisa).
// Só GET; não cria nada no ML: quem clica "Criar" em cada transmissão é a seller.
async function roboCanal() {
    if (!(await SHC.mlPermitidoAgora())) return { ok: false, motivo: 'sem_consentimento' };   // 3.3.1 (C2): ML desligado → a agenda não lê nada
    const sf = await SHC.lerChave('shc:canal:sel'), k = 'shc:canal:plano:' + sf, agora = new Date();
    const salvo = sf ? await SHC.lerChave(k) : null;
    if (!sf || !SHC.canalRoboDeveRodar(await SHC.lerChave('shc:canal:robo'), salvo, agora)) return { ok: false };
    const buscar = async (caminho, json) => {
        bateVivo();
        const r = await SHC.buscarVendo(BASE + caminho, comTempo({ credentials: 'include', cache: 'no-store' }));
        if (ehLogin(r.url) || !r.ok) throw new Error('ml');
        return json ? r.json() : r.text();
    };
    const reg = await SHC.canalRoboPassada(buscar, sf, salvo, agora);
    await SHC.gravarChave(k, reg);
    return { ok: true, n: reg.robo.n };
}

// Selo de frete na tela do ML → abre o painel lateral já na aba Frete daquele anúncio.
// O painel é aberto na hora (sem await antes), para não perder o clique do seller.
function abrirFrete(itemId, tabId) {
    chrome.storage.local.set({ 'shc:foco': { aba: 'frete', itemId, ts: Date.now() } }).catch(() => {});
    if (chrome.sidePanel && chrome.sidePanel.open) chrome.sidePanel.open({ tabId }).catch(() => {});
}

const daAbaDoML = s => !!(s && s.tab && /^https:\/\/vendedores\.mercadolivre\.com\.br\//.test(s.url || s.tab.url || ''));
// V15: a aba manda a conta da página (SHC.mlContaDoEstado → {sellerId} ou o número). Só vale se for a conta aberta agora.
const contaDaMsg = m => { const c = m && m.conta, id = c && typeof c === 'object' ? c.sellerId : c; return /^\d{6,15}$/.test(String(id || '').trim()) ? String(id).trim() : ''; };
async function daContaAtual(msg) { const c = contaDaMsg(msg); return c && c === await SHC.contaAtual() ? c : ''; }

// ── Concorrentes do catálogo (sob demanda, fora da sincronização). Permissão OPCIONAL de www/produto.mercadolivre.com.br, pedida
// pelo painel no clique. Só GET e SEM cookies (credentials 'omit'): a página não traz o endereço de entrega do usuário ("Enviar para…"),
// e o leitor ainda descarta tudo antes da 1ª oferta. A CONFIRMAR AO VIVO: se o ML responde igual sem a sessão.
const WWW = 'https://www.mercadolivre.com.br', PRODUTO = 'https://produto.mercadolivre.com.br';
async function temPermissaoCatalogo() {
    try { return !!(chrome.permissions && chrome.permissions.contains && await chrome.permissions.contains({ origins: [WWW + '/*', PRODUTO + '/*'] })); } catch (e) { return false; }
}
async function buscarPublico(url) {
    try { const r = await fetch(url, comTempo({ credentials: 'omit', cache: 'no-store' })); return r.ok ? { url: r.url || '', html: await r.text() } : null; } catch (e) { return null; }
}
async function lerConcorrentes(itemId) {
    if (!(await temPermissaoCatalogo())) return { semPermissao: true };
    const conta = await SHC.contaAtual();
    const p = await buscarPublico(PRODUTO + '/MLB-' + itemId.slice(3));   // redireciona para …/p/MLB<catálogo>?pdp_filters=item_id:…
    if (!p) return { ok: false, erro: 'O Mercado Livre não respondeu. Tente de novo em alguns minutos.' };
    const cat = (/\/p\/(MLB\d+)/.exec(p.url) || [])[1];
    if (!cat) return { ok: false, semCatalogo: true, erro: 'Este anúncio não está num produto de catálogo.' };
    const s = await buscarPublico(WWW + '/p/' + cat + '/s');
    const lidas = s ? SHC.mlOfertasCatalogo(s.html) : null;
    if (!lidas || !lidas.ofertas.length) return { ok: false, catalogo: cat, erro: 'Não consegui ler as ofertas do catálogo. Tente de novo mais tarde.' };
    const it = (((await SHC.lerAnuncios(conta)) || {}).itens || []).find(i => i && i.itemId === itemId) || {};
    const seu = { preco: typeof it.preco === 'number' ? it.preco : null };
    const snap = Object.assign({ ts: Date.now(), catalogo: cat, ofertas: lidas.ofertas, variacaoIncerta: lidas.variacaoIncerta, seu }, SHC.posicaoNoCatalogo(lidas.ofertas, seu.preco));
    await SHC.gravarChave('conc:' + conta + ':' + itemId, snap);
    return Object.assign({ ok: true }, snap);
}
