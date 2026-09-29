// SellerHub Copiloto — painel: boas-vindas guiadas, configurações, custos por SKU e planilha (backup e ERP).
(function () {
    'use strict';
    const SHC = globalThis.SHC;

    // ── Regras sem tela (testadas em tests/copiloto/teste_csv.js) ─────────────────────────────
    const P = {};
    // Linha-mãe de família (sem preço, seguida dos anúncios de dentro) não é anúncio.
    P.anunciosReais = itens => (itens || []).filter((it, i, a) => !(!it.dentroDeFamilia && it.preco === null && a[i + 1] && a[i + 1].dentroDeFamilia));

    // Linhas da tabela: um SKU por linha (retrato da conta + custos c|sku gravados) e, à parte, os
    // "anúncios sem SKU" (do retrato) e os custos antigos por anúncio (c|ml|F…/MLB…, c|sp|…) que não são de nenhum anúncio do retrato.
    // Custo antigo de um anúncio do retrato (MLB… de anúncio com SKU, ou F… da família dele) vai para l.antigos da linha dele.
    // custos = SHC.lerTudo().custos → { 'sku|X': {canal:'sku', id:'X', custo…}, 'ml|MLB…': {…} }; famDe = { MLB…: 'F…' } (Central de promoções)
    P.montaLinhas = function (itensRetrato, custos, famDe) {
        const skus = {}, anuncios = {}, donos = {};
        const novo = (tipo, o) => Object.assign({ tipo, titulo: '', ids: [], precos: [], custo: null, antigos: [] }, o);
        const liga = (k, l) => { const d = donos[k] || (donos[k] = []); if (d.indexOf(l) < 0) d.push(l); };
        P.anunciosReais(itensRetrato).forEach(it => {
            const l = it.sku ? (skus[it.sku] || (skus[it.sku] = novo('sku', { sku: it.sku, titulo: it.titulo })))
                : (anuncios['ml|' + it.itemId] || (anuncios['ml|' + it.itemId] = novo('anuncio', { canal: 'ml', id: it.itemId, titulo: it.titulo })));
            if (l.ids.indexOf(it.itemId) < 0) l.ids.push(it.itemId);
            if (it.preco > 0) l.precos.push(it.preco);
            if (!l.titulo) l.titulo = it.titulo || '';
            if (it.sku) liga('ml|' + it.itemId, l);
            if (famDe && famDe[it.itemId]) liga('ml|' + famDe[it.itemId], l);
        });
        Object.keys(custos || {}).forEach(k => {
            const c = custos[k];
            if (!(SHC.num(c.custo) > 0)) return;
            let l;
            if (c.canal === 'sku') l = skus[c.id] || (skus[c.id] = novo('sku', { sku: c.id }));
            else if (anuncios[k]) l = anuncios[k];
            else if (donos[k]) { donos[k].forEach(d => d.antigos.push(Object.assign({}, c, { custo: SHC.num(c.custo) }))); return; }
            else l = anuncios[k] = novo('anuncio', { canal: c.canal, id: c.id, antigo: true });
            l.custo = c;
            if (!l.titulo) l.titulo = c.titulo || '';
        });
        const ordem = (a, b) => String(a.titulo || a.sku || a.id).localeCompare(String(b.titulo || b.sku || b.id), 'pt-BR');
        return { skus: Object.values(skus).sort(ordem), anuncios: Object.values(anuncios).sort(ordem) };
    };
    // Linhas da cópia de segurança (SHC.paraCSV): SKUs, anúncios e também os custos antigos por família/anúncio (l.antigos,
    // V11), um por chave, com a origem (V12). Sem isso o CSV perdia esses custos e eles sumiam ao restaurar.
    // Origem na cópia: custo do Tiny redigitado (custoErp diferente) sai 'manual', senão o restaurar perde custoErp e o Tiny troca.
    const origemCSV = c => !c ? '' : (c.origem === 'erp' && SHC.tinyDigitado && SHC.tinyDigitado(c) ? 'manual' : c.origem);
    P.linhasCSV = function (m) {
        const out = m.skus.map(l => ({ sku: l.sku, titulo: l.titulo, custo: l.custo ? l.custo.custo : '', outros: l.custo ? l.custo.outros : '', origem: origemCSV(l.custo) }));
        const vistos = new Set(), anuncio = (c, titulo) => {
            const k = c.canal + '|' + c.id;
            if (vistos.has(k)) return;
            vistos.add(k);
            out.push({ canal: c.canal, id: c.id, titulo: titulo || c.titulo || '', custo: c.custo, outros: c.outros, frete: c.frete, tipo: c.tipo, origem: origemCSV(c) });
        };
        m.anuncios.forEach(l => anuncio(Object.assign({}, l.custo || {}, { canal: l.canal, id: l.id }), l.titulo));
        m.skus.concat(m.anuncios).forEach(l => l.antigos.forEach(a => anuncio(Object.assign({ canal: 'ml' }, a))));
        return out;
    };
    // Valor digitado na tabela de custos: vazio = apagar (null); texto que não é número = inválido (não apaga nada).
    // "Seus números": as mesmas regras do passo 1 das boas-vindas (vazio ou fora da faixa não grava 0% calado).
    P.validaCfg = function (txtImposto, txtMargem) {
        const imp = SHC.num(txtImposto), mg = SHC.num(txtMargem), FI = SHC.FAIXAS.imposto_pct, FM = SHC.FAIXAS.margem_alvo_pct;   // a mesma faixa dos Ajustes
        if (imp === null || imp < FI[0] || imp > FI[1]) return { erro: imp === null ? 'Digite o imposto (em %). Se não paga, digite 0.' : 'Confira o imposto: use um número entre ' + FI[0] + ' e ' + FI[1] + '.' };
        if (mg === null || mg < FM[0] || mg > FM[1]) return { erro: mg === null ? 'Digite a margem que você quer (em %). Ex.: 10.' : 'Confira a margem: use um número entre ' + FM[0] + ' e ' + FM[1] + '.' };
        return { cfg: { imposto_pct: imp, margem_alvo_pct: mg } };
    };
    P.valorCampo = txt => { const t = String(txt === null || txt === undefined ? '' : txt).trim(); if (t === '') return { ok: true, valor: null }; const v = SHC.num(t); return v === null ? { ok: false } : { ok: true, valor: v }; };
    // Sincronização presa (V17): "sincronizando" sem batimento há mais de 5 min = abandonada (o Chrome fechou no meio).
    P.syncParado = (st, agora) => !!st && (st.estado === 'sincronizando' || st.sincronizando === true) && (agora || Date.now()) - (st.batimento || st.inicio || 0) > 5 * 60000;
    P.CONTATO = 'diegoconsultoriamga@gmail.com';   // o mesmo de privacidade.html
    P.FALHA = 'Não consegui salvar. Baixe uma cópia dos custos e fale com o suporte pelo WhatsApp (botão no fim desta página).';   // chrome.storage cheio ou com erro
    // Tabela reduzida: as n linhas que mais vendem (vendasDe(linha) = unidades na janela do guia); empate mantém a ordem alfabética.
    // Sem vendas lidas (todas 0): as n primeiras. → {linhas, escondidas}
    P.reduzida = function (ls, vendasDe, n) {
        const top = (ls || []).map((l, i) => ({ l, i, v: vendasDe(l) || 0 })).sort((a, b) => (b.v - a.v) || (a.i - b.i)).slice(0, n || 10).map(x => x.l);
        return { linhas: top, escondidas: Math.max(0, (ls || []).length - top.length) };
    };
    // Resumo da importação do ERP (Tiny/Omie) em cartões: r = {atualizados, semCusto, mantidos}; falta = SKUs ainda sem custo.
    P.resumoImportacao = (r, falta) => ({ com: r.atualizados || 0, sem: r.semCusto || 0, mantidos: r.mantidos || 0, falta: falta || 0 });
    // Barra "Importando do Tiny: 120 de 253 SKUs" (shc:status.custosProgresso = {erp, feito, de, unidade?}); '' sem contagem.
    P.textoImportando = function (p) {
        if (!p || !p.erp) return '';
        const nome = { omie: 'Omie', tiny: 'Tiny', bling: 'Bling' }[p.erp] || String(p.erp);
        return 'Importando do ' + nome + (p.de > 0 ? ': ' + (p.feito || 0) + ' de ' + p.de + ' ' + (p.unidade || 'SKUs') : '…');
    };
    // Custo acima do maior preço de venda: provável zero a mais ou coluna errada.
    P.custoSuspeito = (custo, precos) => !!(precos && precos.length && custo > Math.max.apply(null, precos));
    P.passoInicial = g => Math.min(5, Math.max(1, parseInt((g && g.passo) || 1, 10) || 1));
    // Endereço que o painel lateral abre (guia v2.5): #guia-N = boas-vindas no passo N; #guia / #bem-vindo = de onde parou;
    // #custos = seção de custos (Ajustes/ícone: sem barra do guia, não fecha sozinha); #guia-custos = a mesma seção aberta pelo guia
    // (barra fixa no topo e a aba fecha ao salvar);
    // #erp = seção "Custos do ERP". → {guia: N|0} | {custos: true} | {erp: true} | null
    P.lerHash = function (h) {
        const m = /^#(?:bem-vindo|guia)(?:-([1-5]))?$/.exec(h || '');
        if (m) return { guia: m[1] ? +m[1] : 0 };
        if (h === '#guia-custos') return { custos: true, guia: true };
        return h === '#custos' ? { custos: true } : (h === '#erp' ? { erp: true } : null);
    };
    P.textoConta = function (st) {
        if (!st || st.estado !== 'ok') return null;
        const partes = ['Conta aberta neste Chrome'];
        if (st.anuncios > 0) partes.push(st.anuncios + (st.anuncios === 1 ? ' anúncio' : ' anúncios'));
        if (st.familias > 0) partes.push(st.familias + (st.familias === 1 ? ' produto' : ' produtos') + ' nas promoções');
        if (partes.length === 1) partes.push('nenhum anúncio encontrado ainda');
        return partes.join(' · ');
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = P;
    if (typeof document === 'undefined') return;

    // ── Tela ──────────────────────────────────────────────────────────────────────────────────
    const $ = s => document.querySelector(s);
    const CAMPOS_CFG = ['imposto_pct', 'margem_alvo_pct'];   // v2: tarifa, comissão e frete vêm do Mercado Livre
    const nf = v => (v === null || v === undefined || v === '') ? '' : String(v).replace('.', ',');
    const nfr = v => (v === null || v === undefined || v === '' || !isFinite(v)) ? '' : Number(v).toFixed(2).replace('.', ',');   // reais: sempre com centavos
    const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const dataBR = ts => ts ? new Date(ts).toLocaleDateString('pt-BR') : '';
    // Origem do custo: 'erp' diz qual (c.erp = 'tiny' | 'omie' | 'bling'); custo do ERP gravado sem dizer qual -> "ERP".
    const ORIGEM = c => c.origem === 'erp' ? ({ tiny: 'Tiny', omie: 'Omie', bling: 'Bling' }[c.erp] || 'ERP') : { manual: 'digitado', planilha: 'planilha' }[c.origem];
    const URL_ANUNCIOS = 'https://vendedores.mercadolivre.com.br/anuncios/lista';
    const URL_ML = 'https://vendedores.mercadolivre.com.br/';
    const FALHA = P.FALHA;

    let cfg = {}, guia = { passo: 0, feitos: {}, tours: {} }, modelo = { skus: [], anuncios: [] }, porChave = new Map(), temRetrato = false;
    let principais = { com: 0, de: 0, comTodos: 0, deTodos: 0, faltam: [] };   // SHC.guiaCustos: os 10 que mais vendem
    let vendasChave = {}, verTodos = false, peloGuia = false;   // vendas por SKU/anúncio na janela do guia; "Ver todos"; aberta pelo guia (#guia-custos)
    // Gravações do progresso uma de cada vez (senão uma apaga a outra).
    let filaGuia = Promise.resolve();
    const gravaGuia = patch => (filaGuia = filaGuia.then(() => SHC.salvarGuia(patch)).then(g => (guia = g), () => guia));

    // Família da Central de promoções (F…) de cada anúncio: é onde ficavam os custos antigos.
    function familiaPorItem(promos) {
        const out = {};
        if (!promos) return out;
        (promos.familias || []).forEach(f => (f.anuncios || []).forEach(id => { out[id] = f.chave; }));
        (promos.propostas || []).forEach(p => { if (p.itemId && p.familia && !out[p.itemId]) out[p.itemId] = p.familia; });
        return out;
    }

    async function lerDados() {
        const [tudo, an, promos, g] = await Promise.all([SHC.lerTudo(), SHC.lerAnuncios(), SHC.lerPromos(), SHC.lerGuia()]);
        cfg = tudo.cfg; guia = g;
        const itens = (an && an.itens) || [];
        temRetrato = itens.length > 0;
        modelo = P.montaLinhas(itens, tudo.custos, familiaPorItem(promos));
        const vm = itens.length ? await SHC.lerVendasMes(itens.map(it => it.itemId)) : {}, brutos = {};
        Object.keys(tudo.custos).forEach(k => { brutos['c|' + k] = tudo.custos[k]; });   // lerTudo tira o "c|" da chave
        principais = SHC.guiaCustos(itens, brutos, vm);
        // Unidades vendidas por SKU (ou por anúncio sem SKU) na mesma janela do guia (principais.desde): ordem da tabela reduzida.
        vendasChave = {};
        itens.forEach(it => {
            const k = it.sku ? 'sku:' + SHC.normalizaSku(it.sku) : 'mlb:' + it.itemId, v = vm[it.itemId] || {};
            Object.keys(v).forEach(m => { if (m >= principais.desde) vendasChave[k] = (vendasChave[k] || 0) + (Number(v[m]) || 0); });
        });
        porChave = new Map();
        modelo.skus.forEach(l => porChave.set('sku|' + l.sku, l));
        modelo.anuncios.forEach(l => porChave.set(l.canal + '|' + l.id, l));
    }

    async function carregar() {
        await lerDados();
        CAMPOS_CFG.forEach(k => { const el = $('#' + k); if (el) el.value = nf(cfg[k]); });
        desenhaTabela();
        desenhaCopia();
        desenhaMeta();
        desenhaContas().catch(() => {});
        const pedido = P.lerHash(location.hash);
        if (pedido) history.replaceState(null, '', location.pathname);
        if (pedido && pedido.custos) { peloGuia = !!pedido.guia; if (peloGuia) $('#gBar').hidden = false; desenhaRetoma(); $('#custos').scrollIntoView(); }
        else if (pedido && pedido.erp) { desenhaRetoma(); $('#erp').scrollIntoView(); }
        else if (pedido || (!guia.fim && !guia.fechado && !cfg.configurado)) abrirGuia((pedido && pedido.guia) || (guia.fim ? 1 : P.passoInicial(guia)));
        else desenhaRetoma();
    }
    // Um nome só para a meta ("meta de margem") em toda a página; a legenda das cores usa o valor do seller.
    function desenhaMeta() {
        const v = nf(cfg.margem_alvo_pct === undefined ? 10 : cfg.margem_alvo_pct);
        document.querySelectorAll('.metaTxt').forEach(el => { el.textContent = v; });
    }
    // Aberta pelo guia: "✓ Salvo" e a aba fecha sozinha (foi aberta pela extensão), voltando ao Mercado Livre.
    // Por conta própria: "✓ Salvo" + "Fechar esta página". fechar() = window.close (trocável no teste).
    let fechar = () => { try { window.close(); } catch (e) { /* aba que não pode fechar: fica */ } };
    P._fechar = f => { fechar = f; };
    async function focarML() {
        try {
            if (!chrome.tabs || !chrome.tabs.query) return;
            const abas = await chrome.tabs.query({ url: 'https://vendedores.mercadolivre.com.br/*' });
            const a = abas && abas.sort((x, y) => (y.lastAccessed || 0) - (x.lastAccessed || 0))[0];
            if (a) await chrome.tabs.update(a.id, { active: true });
        } catch (e) { /* sem aba do ML: nada a fazer */ }
    }
    function salvoEFecha(txt) {
        $('#gBar').hidden = false;
        if (!peloGuia) $('#gBarTxt').textContent = '';
        $('#gBarOk').textContent = txt || '✓ Salvo';
        $('#gBarPular').hidden = true; $('#gBarJa').hidden = true; $('#gBarFechar').hidden = peloGuia;
        if (!peloGuia) return;
        setTimeout(async () => { await focarML(); fechar(); }, 1200);
    }
    $('#gBarFechar').addEventListener('click', () => fechar());
    $('#gBarJa').addEventListener('click', async () => { await gravaGuia({ feitos: { custos: SHC.hoje() } }); desenhaPrincipais(); salvoEFecha('✓ Salvo'); });
    $('#gBarPular').addEventListener('click', async () => {
        await gravaGuia({ pulados: { custos: true } });
        salvoEFecha('Sem custo, o Copiloto não calcula o lucro; o guia lembra você depois.');
    });

    // ── Boas-vindas guiadas (5 passos, progresso em shc:guia) ─────────────────────────────────
    let passo = 1, timerIcone = null, verificando = false, esperandoLogin = false, naoSei = false;

    function abrirGuia(n) {
        document.body.classList.add('guiando');
        $('#guia').hidden = false;
        window.scrollTo(0, 0);
        irPasso(n);
    }
    function fecharGuia() {
        pararIcone();
        document.body.classList.remove('guiando');
        $('#guia').hidden = true;
        desenhaRetoma();
    }
    // Faixa "continuar boas-vindas" só para quem começou e não terminou.
    function desenhaRetoma() {
        const falta = !guia.fim && guia.passo > 0 && $('#guia').hidden;
        $('#retoma').hidden = !falta;
        if (falta) $('#retomaTxt').textContent = 'Faltam alguns passos das boas-vindas (passo ' + P.passoInicial(guia) + ' de 5).';
    }

    function irPasso(n) {
        passo = n;
        document.querySelectorAll('#guia .g-p').forEach(el => { el.hidden = Number(el.getAttribute('data-p')) !== n; });
        $('#gPasso').textContent = 'Passo ' + n + ' de 5';
        $('#gProg').style.width = (n * 20) + '%';
        pararIcone();
        if (n === 1) prepararImposto();
        if (n === 2) vigiarIcone();
        if (n === 3) verificarConta(false);
        if (n === 4) $('#gBackupOk').textContent = guia.feitos.backup ? '✓ Cópia baixada' + (guia.ultimoBackup ? ' em ' + dataBR(guia.ultimoBackup) : '') + '.' : '';
        gravaGuia({ passo: n });
    }

    // ① Imposto e margem
    function prepararImposto() {
        $('#gImposto').value = cfg.configurado || cfg.imposto_pct ? nf(cfg.imposto_pct) : '';
        $('#gMargem').value = nf(cfg.margem_alvo_pct === undefined ? 10 : cfg.margem_alvo_pct);
        naoSei = false;
        marcaChip();
    }
    function marcaChip() {
        const v = SHC.num($('#gImposto').value);
        document.querySelectorAll('#gChips button').forEach(b => {
            const d = b.getAttribute('data-v');
            b.classList.toggle('on', d === 'naosei' ? naoSei : (!naoSei && v === Number(d)));
        });
        $('#gNaoSei').hidden = !naoSei;
    }
    $('#gChips').addEventListener('click', e => {
        const b = e.target.closest('button[data-v]');
        if (!b) return;
        const d = b.getAttribute('data-v');
        naoSei = d === 'naosei';
        $('#gImposto').value = naoSei ? '0' : d;
        $('#gErro1').textContent = '';
        marcaChip();
    });
    $('#gImposto').addEventListener('input', () => { naoSei = false; $('#gErro1').textContent = ''; marcaChip(); });
    $('#g1').addEventListener('click', async () => {
        const imp = SHC.num($('#gImposto').value), mg = $('#gMargem').value.trim() === '' ? 10 : SHC.num($('#gMargem').value);
        const v = P.validaCfg($('#gImposto').value, String(mg === null ? '' : mg));   // mesma faixa do "Seus números" e dos Ajustes
        if (v.erro) { $('#gErro1').textContent = imp === null ? 'Escolha uma opção ou digite o percentual.' : v.erro; return; }
        try { cfg = await SHC.salvarCfg({ imposto_pct: imp, margem_alvo_pct: mg }); } catch (e) { $('#gErro1').textContent = FALHA; return; }
        CAMPOS_CFG.forEach(k => { $('#' + k).value = nf(cfg[k]); });
        await gravaGuia({ feitos: { imposto: true } });
        irPasso(2);
    });

    // ② Desenho em 3 quadros: alternam a cada 3 s, bolinhas 1-2-3 clicáveis, pausa com o mouse em cima (ou o foco dentro);
    // com "reduzir movimento" o CSS mostra os 3 empilhados e nada gira. Ícone fixado → para no quadro 3.
    let quadro = 1, timerQuadro = null, quadroPausado = false, fixou = false;
    const reduzMovimento = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    function mostraQuadro(n) {
        quadro = n;
        document.querySelectorAll('#gFix .fx-q, #gFix .fx-dots button').forEach(e => e.classList.toggle('on', Number(e.getAttribute('data-q')) === n));
    }
    function pararQuadros() { if (timerQuadro) clearInterval(timerQuadro); timerQuadro = null; }
    function girarQuadros() {
        pararQuadros();
        if (fixou || reduzMovimento()) return;
        timerQuadro = setInterval(() => { if (!quadroPausado) mostraQuadro(quadro % 3 + 1); }, 3000);
    }
    const gFix = $('#gFix');
    gFix.addEventListener('mouseenter', () => { quadroPausado = true; });
    gFix.addEventListener('mouseleave', () => { quadroPausado = false; });
    gFix.addEventListener('focusin', () => { quadroPausado = true; });
    gFix.addEventListener('focusout', () => { quadroPausado = false; });
    gFix.addEventListener('click', e => {
        const b = e.target.closest && e.target.closest('button[data-q]');
        if (!b) return;
        mostraQuadro(Number(b.getAttribute('data-q')));
        girarQuadros();
    });

    // Ícone fixado: o Chrome avisa (getUserSettings). Confere a cada 2 s enquanto o passo está aberto.
    async function iconeFixado() {
        try { const u = chrome.action && chrome.action.getUserSettings && await chrome.action.getUserSettings(); return !!(u && u.isOnToolbar); } catch (e) { return false; }
    }
    function vigiarIcone() {
        const checa = async () => {
            const sim = await iconeFixado();
            const el = $('#gIcone');
            el.className = 'estado' + (sim ? ' bom' : '');
            el.textContent = sim ? '✓ Ícone fixado. O Copiloto detectou sozinho.' : 'Ainda não fixou? Tudo bem: clique em Continuar.';
            if (sim && !fixou) { fixou = true; pararQuadros(); mostraQuadro(3); }
            if (sim && !guia.feitos.icone) await gravaGuia({ feitos: { icone: true } });
        };
        checa();
        timerIcone = setInterval(checa, 2000);
        girarQuadros();
    }
    function pararIcone() { if (timerIcone) clearInterval(timerIcone); timerIcone = null; pararQuadros(); }
    // Continuar sem fixar = etapa "ícone" pulada no guia (é opcional; o painel lateral não pede de novo).
    $('#g2').addEventListener('click', async () => {
        if (!guia.feitos.icone && !(await iconeFixado())) await gravaGuia({ pulados: { icone: true } });
        irPasso(3);
    });

    // ③ Conta do ML: sincroniza com a sessão aberta e mostra o resultado.
    let tConta = 0;
    function mostraConta(st) {
        $('#gSync').innerHTML = SHC.htmlSync(st, Date.now(), { lista: true });   // selo + barra + "O que o Copiloto já leu"
        if (P.syncParado(st)) st = { estado: 'erro', erro: 'parou' };   // V17: leitura interrompida → "Tentar de novo"
        clearTimeout(tConta);
        if (st && st.estado === 'sincronizando') tConta = setTimeout(async () => { if (passo === 3 && !$('#guia').hidden) mostraConta(await SHC.lerStatus()); }, 60e3);
        const el = $('#gConta'), txt = P.textoConta(st);
        const semSessao = st && st.estado === 'erro' && st.erro === 'sem_sessao';
        el.className = 'estado' + (txt ? ' bom' : (st && st.estado === 'erro' ? ' ruim' : ''));
        if (txt) el.textContent = '✓ ' + txt;
        else if (st && st.estado === 'sincronizando') el.textContent = 'Lendo sua conta no Mercado Livre…' + (st.anuncios ? ' ' + st.anuncios + ' anúncios até agora' : '');
        else if (semSessao) el.textContent = 'Entre no Mercado Livre em outra aba; o Copiloto espera você.';
        else if (st && st.estado === 'erro') el.textContent = st.erro === 'parou' ? 'A leitura da sua conta parou no meio. Clique em Tentar de novo.' : 'Não consegui ler sua conta agora. Tente de novo em instantes.';
        else el.textContent = 'Conferindo sua conta…';
        $('#gContaObs').hidden = !(st && st.estado === 'sincronizando');
        $('#gAbrirML').hidden = !semSessao;
        $('#gVerificar').hidden = !(st && st.estado === 'erro');
        esperandoLogin = semSessao;
        if (txt && !guia.feitos.conta) gravaGuia({ feitos: { conta: true } });
    }
    async function verificarConta(forcar) {
        const st = await SHC.lerStatus();
        // Leitura boa há menos de 10 min: não pede tudo de novo ao ML.
        if (!forcar && st.estado === 'ok' && st.ultimaOk && Date.now() - st.ultimaOk < 10 * 60e3) { mostraConta(st); return; }
        verificando = true;
        mostraConta(st.estado === 'sincronizando' && !P.syncParado(st) ? st : { estado: 'sincronizando', batimento: Date.now() });
        try {
            const r = await chrome.runtime.sendMessage({ acao: 'sincronizar' });
            mostraConta(r && r.estado ? r : await SHC.lerStatus());
        } catch (e) { mostraConta(await SHC.lerStatus()); }
        verificando = false;
    }
    $('#gVerificar').addEventListener('click', () => verificarConta(true));
    $('#gSync').addEventListener('click', e => { if (e.target.closest && e.target.closest('[data-sync]') && !verificando) verificarConta(true); });
    $('#gAbrirML').addEventListener('click', () => { chrome.tabs.create({ url: URL_ML }); });
    // Voltou para esta aba depois de entrar no ML: confere sozinho.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && passo === 3 && esperandoLogin && !verificando && !$('#guia').hidden) verificarConta(true);
    });
    $('#g3').addEventListener('click', () => irPasso(4));

    // ④ Backup
    $('#gBackup').addEventListener('click', async () => {
        await baixarPlanilha();
        $('#gBackupOk').textContent = '✓ Cópia baixada.';
    });
    $('#g4').addEventListener('click', () => irPasso(5));

    // ⑤ (último) Abrir a lista de Anúncios: as boas-vindas terminam aqui; o guia continua no painel lateral e na tela do ML.
    async function concluir() {
        await gravaGuia({ passo: 5, fim: Date.now() });
        fecharGuia();
        $('#custos').scrollIntoView({ behavior: 'smooth' });
    }
    $('#gAnuncios').addEventListener('click', async () => {
        chrome.tabs.create({ url: URL_ANUNCIOS });
        await gravaGuia({ feitos: { anuncios: true } });
        await concluir();
    });
    $('#g5').addEventListener('click', concluir);
    $('#gFechar').addEventListener('click', async () => { await gravaGuia({ fechado: Date.now() }); fecharGuia(); });
    $('#retomaBt').addEventListener('click', () => abrirGuia(P.passoInicial(guia)));
    $('#rever').addEventListener('click', () => abrirGuia(1));
    window.addEventListener('hashchange', () => {
        const pedido = P.lerHash(location.hash);
        if (!pedido) return;
        history.replaceState(null, '', location.pathname);
        if (pedido.custos) { if (!$('#guia').hidden) fecharGuia(); $('#custos').scrollIntoView({ behavior: 'smooth' }); }
        else abrirGuia(pedido.guia || (guia.fim ? 1 : P.passoInicial(guia)));
    });

    // ── Configurações ──
    $('#salvarCfg').addEventListener('click', async () => {
        const ok = $('#okCfg'), val = P.validaCfg($('#imposto_pct').value, $('#margem_alvo_pct').value);
        if (val.erro) { ok.className = 'msg erro'; ok.textContent = val.erro; return; }
        try { cfg = await SHC.salvarCfg(val.cfg); } catch (e) { ok.className = 'msg erro'; ok.textContent = FALHA; return; }
        ok.className = 'ok';
        ok.textContent = '✓ Salvo. As etiquetas abertas já foram atualizadas.';
        desenhaMeta();
        setTimeout(() => { ok.textContent = ''; }, 4000);
        salvoEFecha('✓ Salvo');
    });
    $('#fcfg').addEventListener('submit', e => { e.preventDefault(); $('#salvarCfg').click(); });
    // ── Suas contas (v2.8): c.nome = apelido de Ajustes OU o nome da própria conta lido do ML OU "Conta ID …1234" (SHC.nomeConta); nunca o e-mail ──
    async function desenhaContas() {
        let cs = [];
        try { cs = SHC.contas ? await SHC.contas() : []; } catch (e) { cs = []; }
        const el = $('#listaContas'), ap = cfg.apelidos || {};
        if (!el) return;
        el.innerHTML = cs.length ? cs.map(c => {
            const nomeAp = ap[c.sellerId];
            return `<div class="campo" style="background:#F8FAFC;border:1px solid var(--linha);border-left:3px solid ${c.atual ? 'var(--verde)' : '#D0D5DD'};border-radius:10px;padding:9px 10px 10px"><div class="conta-linha"><b>${esc(c.nome)}</b><span class="contatag">ID …${esc(c.sellerId.slice(-4))}</span>${c.atual ? '<span class="contatag agora">aberta agora</span>' : ''}</div><label for="ap-${esc(c.sellerId)}" style="font-weight:500;color:var(--suave)">Apelido próprio (opcional; no lugar do nome do ML)</label><input class="inp" id="ap-${esc(c.sellerId)}" data-apelido="${esc(c.sellerId)}" maxlength="40" placeholder="Ex.: Loja 1" value="${esc(nomeAp || '')}"></div>`;
        }).join('')
            : '<p class="sub">Entre no Mercado Livre e sincronize pelo Copiloto: cada conta em que você entrar neste Chrome aparece aqui.</p>';
        $('#salvarApelidos').hidden = !cs.length;
    }
    $('#salvarApelidos').addEventListener('click', async () => {
        const ok = $('#okApelidos'), txt = {};
        document.querySelectorAll('[data-apelido]').forEach(i => { txt[i.dataset.apelido] = i.value; });
        try { cfg = await SHC.salvarCfg({ apelidos: SHC.apelidosLimpos(txt) }); } catch (e) { ok.className = 'msg erro'; ok.textContent = FALHA; return; }
        ok.className = 'ok'; ok.textContent = '✓ Salvo';
        setTimeout(() => { ok.textContent = ''; }, 4000);
    });

    // ── Custos por SKU ──
    // Tem custo = o que a etiqueta usa: o do SKU ou, na falta dele, o antigo da família/anúncio (mesma conta do painel lateral).
    const temCusto = l => !!l.custo || l.antigos.some(a => a.custo > 0);
    const valoresAntigos = l => l.antigos.map(a => a.custo).filter((v, i, a) => a.indexOf(v) === i);
    // Mesma chave de SHC.guiaCustos: SKU normalizado ou, sem SKU, o MLB do anúncio.
    const chaveGuia = l => l.tipo === 'sku' ? 'sku:' + SHC.normalizaSku(l.sku) : 'mlb:' + l.id;
    function filtra(ls) {
        const busca = ($('#busca').value || '').trim().toLowerCase();
        const soSem = $('#soSem').checked;
        const falta = $('#soPrinc').checked ? new Set(principais.faltam.map(f => f.sku ? 'sku:' + SHC.normalizaSku(f.sku) : 'mlb:' + f.itemId)) : null;
        return ls.filter(l => (!soSem || !temCusto(l)) && (!falta || falta.has(chaveGuia(l))) &&
            (!busca || [l.titulo, l.sku, l.id].concat(l.ids).join(' ').toLowerCase().indexOf(busca) >= 0));
    }
    function linhaHtml(l) {
        const k = l.tipo === 'sku' ? 'sku|' + l.sku : l.canal + '|' + l.id;
        const c = l.custo || {};
        const qtd = l.ids.length ? l.ids.length + (l.ids.length === 1 ? ' anúncio' : ' anúncios') : 'sem anúncio no ML agora';
        const sub = l.tipo === 'sku' ? 'SKU ' + l.sku + ' · ' + qtd
            : (l.canal === 'sp' ? 'Shopee · ' : '') + l.id;
        let dica = '';
        // Custo antigo (v2.0) gravado na família da promoção (F…) ou no anúncio: um valor só → usa no SKU com 1 clique.
        const vs = l.custo ? [] : valoresAntigos(l);
        if (vs.length === 1) dica = `<span class="dica">Custo antigo ${esc(SHC.moeda(vs[0]))} (${l.antigos.some(a => /^F/.test(a.id)) ? 'da promoção' : 'do anúncio'}) · <button class="lnk" data-usar="1">usar ${l.tipo === 'sku' ? 'para o SKU' : 'neste anúncio'}</button></span>`;
        else if (vs.length > 1) dica = `<span class="dica">Custos antigos diferentes nos anúncios: ${esc(vs.map(v => SHC.moeda(v)).join(', '))}. Informe o custo aqui.</span>`;
        if (l.custo && P.custoSuspeito(SHC.num(c.custo), l.precos)) dica = `<span class="dica alerta">Custo maior que o preço de venda (${esc(SHC.moeda(Math.max.apply(null, l.precos)))}). Confira se não sobrou um zero.</span>`;
        const origem = l.custo ? ((c.origem === 'erp' && SHC.tinyDigitado(c) ? 'digitado' : ORIGEM(c)) ||(l.tipo === 'sku' ? 'digitado' : 'por anúncio')) + (c.atualizado ? ' · ' + dataBR(c.atualizado) : '') : (vs.length ? 'custo antigo' : 'sem custo');
        return `<tr data-k="${esc(k)}">
  <td class="tit"><b title="${esc(l.titulo || '')}">${esc(l.titulo || '(sem título)')}</b><span>${l.tipo === 'anuncio' ? '<span class="tag' + (l.canal === 'sp' ? ' sp' : '') + '">' + (l.antigo ? 'custo antigo por anúncio' : 'anúncio sem SKU') + '</span> ' : ''}${esc(sub)}</span></td>
  <td><input class="inp" data-f="custo" inputmode="decimal" value="${esc(nfr(c.custo))}" placeholder="informe">${dica}</td>
  <td><input class="inp" data-f="outros" inputmode="decimal" value="${esc(nfr(c.outros))}" placeholder="0,00"></td>
  <td style="color:#64748B;font-size:12px;white-space:nowrap">${esc(origem)}</td>
  <td>${l.custo ? '<button class="x" data-rm="1" title="Apagar este custo">×</button>' : ''}</td></tr>`;
    }
    let redesenharDepois = false;
    // Seção "Custo dos produtos que mais vendem": as 3 formas + progresso dos 10 principais (etapa "custos" do guia).
    const txtPrincipais = () => principais.de ? principais.com + ' de ' + principais.de + ' principais com custo' : '';
    function desenhaPrincipais() {
        const pronto = !!guia.feitos.custos || (principais.de > 0 && principais.com >= principais.de);
        $('#cPrinc').textContent = txtPrincipais() || 'Primeiro o Copiloto precisa ler a sua conta do Mercado Livre.';
        $('#cProg').style.width = (principais.de ? Math.round(principais.com / principais.de * 100) : 0) + '%';
        $('#cTodos').textContent = principais.deTodos ? principais.comTodos + ' de ' + principais.deTodos + ' SKUs com custo' : '';
        $('#cJa').hidden = pronto;
        $('#cFaltam').hidden = !principais.faltam.length;
        $('#cFaltamLista').innerHTML = principais.faltam.map(f => `<li>${esc(f.titulo || f.sku || f.itemId)}${f.sku ? ' <span class="cinza">SKU ' + esc(f.sku) + '</span>' : ''}</li>`).join('');
        $('#cOk').textContent = pronto ? '✓ Etapa de custos concluída. O guia segue no painel lateral.' : '';
    }
    // "Conectar Tiny ou Omie" (Bling: planilha): vai para os cartões "Custos do ERP" (conexão por chave que importa sozinha).
    $('#cTiny').addEventListener('click', () => { $('#erp').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    $('#cAnuncios').addEventListener('click', () => { chrome.tabs.create({ url: URL_ANUNCIOS }); });
    // Mostra na tabela só os principais sem custo, com o campo de custo de cada um.
    $('#cDigitar').addEventListener('click', () => { $('#soPrinc').checked = true; $('#busca').value = ''; desenhaTabela(); $('#lista').scrollIntoView({ behavior: 'smooth' }); });
    $('#cJa').addEventListener('click', async () => { await gravaGuia({ feitos: { custos: SHC.hoje() } }); desenhaPrincipais(); salvoEFecha('✓ Salvo'); });

    function desenhaTabela() {
        desenhaPrincipais();
        redesenharDepois = false;
        const todas = modelo.skus.concat(modelo.anuncios);
        // Progresso = SKUs + anúncios sem SKU (igual ao Catálogo do painel lateral). Com retrato, SKU sem anúncio na conta
        // (ex.: produto que só existe no Tiny) e custo só antigo não entram.
        const base = modelo.skus.filter(l => !temRetrato || l.ids.length).concat(modelo.anuncios.filter(l => !l.antigo));
        const com = base.filter(temCusto).length;
        $('#contador').textContent = base.length ? com + ' de ' + base.length + ' produtos com custo' : 'Nenhum produto ainda';
        const pctCusto = base.length ? Math.round(com / base.length * 100) : 0;
        $('#contProg').style.width = pctCusto + '%';
        $('#contPct').textContent = base.length ? pctCusto + '%' : '';
        let skus = filtra(modelo.skus), ans = filtra(modelo.anuncios);
        const corpo = $('#corpo'), MAX = 400;
        // Sem busca nem filtro: só os 10 que mais vendem (ordem por venda), com "Ver todos os N produtos". A busca e os filtros
        // continuam procurando em todos.
        const filtrando = !!($('#busca').value || '').trim() || $('#soSem').checked || $('#soPrinc').checked;
        let escondidas = 0;
        if (!filtrando && !verTodos) {
            const r = P.reduzida(skus.concat(ans), l => vendasChave[chaveGuia(l)], 10);
            escondidas = r.escondidas;
            skus = r.linhas.filter(l => l.tipo === 'sku'); ans = r.linhas.filter(l => l.tipo !== 'sku');
        }
        if (!skus.length && !ans.length) {
            corpo.innerHTML = `<tr><td colspan="5" class="vazio">${todas.length ? 'Nada encontrado com esse filtro.'
                : 'Nenhum produto ainda. Abra a lista de Anúncios do Mercado Livre neste Chrome: o Copiloto lê seus SKUs sozinho.'}</td></tr>`;
            $('#rodape').textContent = '';
            return;
        }
        let html = skus.slice(0, MAX).map(linhaHtml).join('');
        if (ans.length) html += '<tr class="grp"><td colspan="5">Anúncios sem SKU e custos antigos por anúncio · o custo fica gravado no próprio anúncio</td></tr>' + ans.slice(0, MAX).map(linhaHtml).join('');
        if (escondidas) html += `<tr><td colspan="5" style="text-align:center"><button class="bt sec" type="button" data-ver-todos="1">Ver todos os ${todas.length} produtos</button></td></tr>`;
        corpo.innerHTML = html;
        const cortou = skus.length > MAX || ans.length > MAX;
        $('#rodape').textContent = (escondidas ? 'Mostrando os ' + (skus.length + ans.length) + ' que mais vendem · ' : '') + SHC.qtd(modelo.skus.length, 'SKU', 'SKUs') + (modelo.anuncios.length ? ' · ' + SHC.qtd(modelo.anuncios.length, 'anúncio sem SKU', 'anúncios sem SKU') : '')
            + (cortou ? ' · mostrando até ' + MAX + ' (use a busca)' : '')
            + (temRetrato ? '' : ' · Os SKUs aparecem depois que o Copiloto ler a lista de Anúncios do Mercado Livre.');
    }
    $('#corpo').addEventListener('click', e => { if (e.target.closest && e.target.closest('[data-ver-todos]')) { verTodos = true; desenhaTabela(); } });
    $('#busca').addEventListener('input', desenhaTabela);
    $('#soSem').addEventListener('change', desenhaTabela);
    $('#soPrinc').addEventListener('change', desenhaTabela);

    function falhaTabela(el) { if (el) avisa(el, '#B91C1C', FALHA); $('#msgTab').textContent = FALHA; }
    function avisa(el, cor, dica) {
        el.style.borderColor = cor;
        el.title = dica || '';
        setTimeout(() => { el.style.borderColor = ''; }, 1200);
    }
    $('#corpo').addEventListener('change', async e => {
        const campo = e.target.getAttribute('data-f');
        const tr = e.target.closest('tr[data-k]');
        const l = tr && porChave.get(tr.getAttribute('data-k'));
        if (!campo || !l) return;
        const lido = P.valorCampo(e.target.value), valor = lido.valor;
        if (!lido.ok || (valor !== null && valor < 0)) {   // texto que não é número não apaga o custo gravado
            e.target.value = nfr(l.custo ? l.custo[campo] : '');
            avisa(e.target, '#B91C1C', lido.ok ? 'Use um valor positivo' : 'Digite só o número. Ex.: 25,90');
            $('#msgTab').textContent = lido.ok ? 'Use um valor positivo.' : 'Valor não entendido: digite só o número, por exemplo 25,90. Nada foi mudado.';
            return;
        }
        const custoAtual = l.custo ? SHC.num(l.custo.custo) : null;
        if (campo === 'outros' && !(custoAtual > 0)) { avisa(e.target, '#B45309', 'Informe o custo primeiro'); return; }
        const titulo = l.custo && l.custo.titulo ? {} : { titulo: l.titulo || '' };
        try {
            if (l.tipo === 'sku') {
                if (campo === 'custo') await SHC.salvarCustoSku(l.sku, valor > 0 ? Object.assign({ custo: valor, origem: 'manual' }, titulo) : { custo: 0 });
                else await SHC.salvarCustoSku(l.sku, { custo: custoAtual, outros: valor === null ? 0 : valor });
            } else if (campo === 'custo' && !(valor > 0)) await SHC.removerCusto(l.canal, l.id);
            else await SHC.salvarCusto(l.canal, l.id, campo === 'custo' ? Object.assign({ custo: valor, origem: 'manual' }, titulo) : { outros: valor === null ? 0 : valor });
        } catch (err) {
            e.target.value = nfr(l.custo ? l.custo[campo] : '');   // volta ao que está gravado
            falhaTabela(e.target);
            return;
        }
        $('#msgTab').textContent = '';
        await lerDados();
        redesenharDepois = true;
        const suspeito = campo === 'custo' && valor > 0 && P.custoSuspeito(valor, l.precos);
        avisa(e.target, suspeito ? '#B45309' : '#10B981', suspeito ? 'Custo maior que o preço de venda. Confira se não sobrou um zero.' : '');
    });
    // Redesenha só quando o seller sai da tabela (não atrapalha quem está digitando).
    $('#corpo').addEventListener('focusout', () => setTimeout(() => {
        if (redesenharDepois && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('#corpo'))) desenhaTabela();
    }, 50));
    $('#corpo').addEventListener('click', async e => {
        const rm = e.target.closest('[data-rm]'), usar = e.target.closest('[data-usar]');
        if (!rm && !usar) return;
        const tr = e.target.closest('tr[data-k]');
        const l = tr && porChave.get(tr.getAttribute('data-k'));
        if (!l) return;
        try {
            if (usar) {   // grava o custo antigo (valor único) como custo do SKU / do anúncio
                const d = { custo: valoresAntigos(l)[0], titulo: l.titulo || '' };
                if (l.tipo === 'sku') await SHC.salvarCustoSku(l.sku, Object.assign(d, { origem: 'manual' }));
                else await SHC.salvarCusto(l.canal, l.id, Object.assign(d, { origem: 'manual' }));
            } else if (l.tipo === 'sku') await SHC.salvarCustoSku(l.sku, { custo: 0 });
            else await SHC.removerCusto(l.canal, l.id);
        } catch (err) { falhaTabela(null); return; }
        $('#msgTab').textContent = '';
        await lerDados();
        desenhaTabela();
    });

    // ── Planilha: backup/modelo e importação com prévia ──
    function desenhaCopia() {
        $('#ultimaCopia').textContent = guia.ultimoBackup ? 'Última cópia baixada em ' + dataBR(guia.ultimoBackup) + '.' : 'Você ainda não baixou uma cópia dos seus custos.';
    }
    async function baixarPlanilha() {
        await lerDados();
        const url = URL.createObjectURL(new Blob([SHC.paraCSV(P.linhasCSV(modelo))], { type: 'text/csv;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'copiloto-custos-' + SHC.hoje() + '.csv';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        await gravaGuia({ feitos: { backup: true }, ultimoBackup: Date.now() });
        desenhaCopia();
    }
    $('#baixar').addEventListener('click', baixarPlanilha);

    let pendente = null;
    const plural = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);
    function cancelaPrevia() { pendente = null; $('#previa').hidden = true; }
    // Erro da planilha: na seção "Planilha" e também na faixa rápida, logo acima da tabela (onde a pessoa soltou o arquivo).
    const erroImp = t => ['#msgImp', '#rMsg'].forEach(s => { $(s).className = 'msg erro'; $(s).textContent = t; });
    // texto (CSV colado/arquivo) ou tabela já em células (.xls do Tiny/Bling via SHC.lerXls)
    async function prepararImportacao(texto, tabela) {
        const msg = $('#msgImp');
        msg.className = 'msg'; msg.textContent = '';
        if (/erro/.test($('#rMsg').className)) { $('#rMsg').className = 'msg'; $('#rMsg').textContent = ''; }
        cancelaPrevia();
        const r = tabela ? SHC.lerTabela(tabela) : SHC.lerCSV(texto);
        const ign = Object.keys(r.ignorados).map(m => r.ignorados[m] + ' ' + m).join(' · ');
        if (!r.itens.length) return erroImp((r.erros[0] && !r.linhas ? r.erros[0] : 'Nenhuma linha com custo para importar.') + (ign ? ' Linhas ignoradas: ' + ign + '.' : ''));
        const nSku = r.itens.filter(i => i.sku).length, nAn = r.itens.length - nSku;
        $('#pvTitulo').textContent = 'Encontrei ' + [nSku ? plural(nSku, 'SKU', 'SKUs') : '', nAn ? plural(nAn, 'anúncio', 'anúncios') : ''].filter(Boolean).join(' e ') + ' com custo';
        $('#pvColunas').textContent = r.formato === 'simples' ? 'Planilha sem cabeçalho: 1ª coluna = código do anúncio (MLB), 2ª = custo.'
            : [r.colunas.sku ? 'Coluna do SKU: “' + r.colunas.sku + '”' : '', r.colunas.id && (r.formato !== 'erp') ? 'Coluna do anúncio: “' + r.colunas.id + '”' : '',
                'Coluna do custo: “' + r.colunas.custo + '”'].filter(Boolean).join(' · ') + '. Confira se são as colunas certas.';
        $('#pvCorpo').innerHTML = r.itens.slice(0, 5).map(it => `<tr><td>${esc(it.sku || it.id)}</td><td class="tit"><b>${esc(it.titulo || '')}</b></td><td>${esc(SHC.moeda(it.custo))}</td></tr>`).join('');
        $('#pvIgnorados').textContent = ign ? 'Ignoradas: ' + ign + '.' + (r.erros.length ? ' Ex.: ' + r.erros.slice(0, 3).join(' · ') : '') : 'Nenhuma linha ignorada.';
        // Quantos já têm custo aqui (vão ser trocados) e quantos custos passam do preço de venda no ML.
        const chaves = r.itens.map(it => it.sku ? SHC.chaveSku(it.sku) : SHC.chave(it.canal, it.id));
        const atuais = await SHC.lerCustos(chaves);
        const ja = chaves.filter(k => atuais[k] && SHC.num(atuais[k].custo) > 0).length;
        const noML = r.itens.filter(it => porChave.get(it.sku ? 'sku|' + it.sku : it.canal + '|' + it.id));
        const semAnuncio = temRetrato ? r.itens.filter(it => it.sku && !((porChave.get('sku|' + it.sku) || {}).ids || []).length).length : 0;
        $('#pvAtualiza').textContent = [ja ? plural(ja, 'já tem custo aqui e vai', 'já têm custo aqui e vão') + ' ser atualizado' + (ja === 1 ? '' : 's') + ' com o valor da planilha.' : '',
            semAnuncio ? plural(semAnuncio, 'SKU não aparece', 'SKUs não aparecem') + ' nos seus anúncios do ML agora: o custo fica guardado para quando aparecer.' : ''].filter(Boolean).join(' ');
        const suspeitos = noML.filter(it => P.custoSuspeito(it.custo, porChave.get(it.sku ? 'sku|' + it.sku : it.canal + '|' + it.id).precos));
        $('#pvSuspeito').hidden = !suspeitos.length;
        if (suspeitos.length) {
            const ex = suspeitos[0], l = porChave.get(ex.sku ? 'sku|' + ex.sku : ex.canal + '|' + ex.id);
            $('#pvSuspeito').textContent = '⚠ ' + plural(suspeitos.length, 'custo é maior', 'custos são maiores') + ' que o preço de venda no Mercado Livre (ex.: ' + (ex.sku || ex.id) + ': custo ' + SHC.moeda(ex.custo) + ', preço ' + SHC.moeda(Math.max.apply(null, l.precos)) + '). Confira se a coluna do custo está certa.';
        }
        pendente = r.itens;
        $('#previa').hidden = false;
        $('#previa').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    $('#pvCancelar').addEventListener('click', () => { cancelaPrevia(); $('#msgImp').textContent = 'Importação cancelada. Nada foi gravado.'; });
    $('#pvImportar').addEventListener('click', async () => {
        if (!pendente) return;
        let n;
        try { n = await SHC.importar(pendente); } catch (e) { $('#msgImp').className = 'msg erro'; $('#msgImp').textContent = FALHA + ' Nada foi importado.'; return; }
        cancelaPrevia();
        await lerDados();
        desenhaTabela();
        $('#msgImp').className = 'msg ok';
        $('#msgImp').textContent = '✓ ' + plural(n, 'custo importado', 'custos importados') + '.' + (txtPrincipais() ? ' Agora: ' + txtPrincipais() + '.' : '');
    });

    // .xls (Excel 97-2003, o que o Tiny exporta) é lido direto. .xlsx ainda não: pede .xls ou CSV.
    // CSV: Excel às vezes salva em ANSI (Windows-1252) — tenta UTF-8 e cai para ANSI.
    async function lerArquivo(f) {
        const buf = await f.arrayBuffer();
        const b = new Uint8Array(buf.slice(0, 4));
        const erro = t => { cancelaPrevia(); erroImp(t); };
        if (b[0] === 0x50 && b[1] === 0x4B) return erro('Este arquivo é .xlsx. No Excel, use Arquivo › Salvar como › “Pasta de Trabalho do Excel 97-2003 (.xls)” ou “CSV” e importe de novo.');
        if (b[0] === 0xD0 && b[1] === 0xCF) {
            let tab;
            try { tab = SHC.lerXls(buf); } catch (err) {
                return erro(/protegida/.test(err.message) ? 'Esta planilha tem senha. Tire a senha no Excel e importe de novo.'
                    : 'Não consegui ler este arquivo do Excel. Salve como CSV e importe de novo.');
            }
            return prepararImportacao('', tab);
        }
        let texto;
        try { texto = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (err) { texto = new TextDecoder('windows-1252').decode(buf); }
        await prepararImportacao(texto);
    }
    $('#arquivo').addEventListener('change', async e => {
        const f = e.target.files && e.target.files[0];
        e.target.value = '';
        if (f) await lerArquivo(f);
    });
    // Arrastar e soltar a planilha em cima da tabela de custos (mesmo leitor: .xls pelo SHC.lerXls, CSV pelo SHC.lerCSV).
    const temArquivo = e => !!(e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0);
    const zona = $('#soltar');
    let arrastes = 0;
    zona.addEventListener('dragenter', e => { if (!temArquivo(e)) return; e.preventDefault(); arrastes++; zona.classList.add('arrastando'); });
    zona.addEventListener('dragover', e => { if (!temArquivo(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; zona.classList.add('arrastando'); });
    zona.addEventListener('dragleave', () => { if (--arrastes <= 0) { arrastes = 0; zona.classList.remove('arrastando'); } });
    zona.addEventListener('drop', async e => {
        e.preventDefault();
        arrastes = 0; zona.classList.remove('arrastando');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) await lerArquivo(f);
    });
    // Arquivo solto fora da tabela: o Chrome abriria o arquivo no lugar da página. Não deixa.
    window.addEventListener('dragover', e => { if (temArquivo(e)) e.preventDefault(); });
    window.addEventListener('drop', e => { if (temArquivo(e)) e.preventDefault(); });
    $('#importarColado').addEventListener('click', () => prepararImportacao($('#colar').value));

    // ── Tiny (API v2 por token, tiny.js): só lê os custos; grava origem 'erp' sem trocar o que o seller digitou ──
    const TINY = { origins: [SHC.TINY_ORIGEM] };
    let tinyRodando = false, tinyToken = '';   // tinyToken: o guardado (clique no botão rápido decide sem esperar o armazenamento)
    // A mesma mensagem na seção do Tiny e na faixa rápida da tabela de custos.
    const tinyMsg = (t, erro) => ['#tinyMsg', '#rMsg'].forEach(s => { const m = $(s); m.className = 'msg' + (erro ? ' erro' : (/^✓/.test(t || '') ? ' ok' : '')); m.textContent = t || ''; });
    const tinyBotoes = off => ['#tinyConectar', '#tinyAtualizar', '#tinyEsquecer', '#rTiny', '#rConectar'].forEach(s => { $(s).disabled = off; });
    const tinyBarra = (p, n) => {
        const pct = n ? Math.round(p / n * 100) : 0;
        $('#rProgLin').hidden = false;
        $('#rProg').style.width = pct + '%';
        $('#rProgTxt').textContent = pct + '% · ' + p + ' de ' + n + (n === 1 ? ' página' : ' páginas');
        impBarra({ erp: 'tiny', feito: p, de: n, unidade: n === 1 ? 'página' : 'páginas' });
    };
    // Importação visual (Tiny, Omie): barra "Importando do Tiny: 120 de 253 SKUs" e, no fim, os cartões do resumo.
    function impBarra(p) {
        const txt = P.textoImportando(p);
        $('#impProgLin').hidden = !txt;
        if (!txt) return;
        $('#impProg').style.width = (p.de > 0 ? Math.round((p.feito || 0) / p.de * 100) : 0) + '%';
        $('#impProgTxt').textContent = txt;
    }
    function impResumo(r, nome) {
        const x = P.resumoImportacao(r, Math.max(0, principais.deTodos - principais.comTodos));
        $('#impResumo').hidden = false;
        $('#impCom').textContent = String(x.com); $('#impSem').textContent = String(x.sem); $('#impMant').textContent = String(x.mantidos); $('#impFalta').textContent = String(x.falta);
        $('#impSemTxt').textContent = 'o ' + nome + ' não tem custo';
        $('#impVerFaltam').hidden = !x.falta;
    }
    $('#impVerFaltam').addEventListener('click', () => { $('#soSem').checked = true; $('#soPrinc').checked = false; $('#busca').value = ''; desenhaTabela(); $('#lista').scrollIntoView({ behavior: 'smooth' }); });
    $('#suporteZap').href = SHC.SUPORTE_WHATSAPP;
    async function desenhaTiny() {
        const t = await SHC.lerChave(SHC.TINY_CHAVE), com = !!(t && t.token);
        tinyToken = com ? t.token : '';
        $('#rTiny').textContent = com ? 'Puxar custos do Tiny' : 'Conectar o Tiny e puxar custos';
        $('#tinySem').hidden = com;
        $('#tinyCom').hidden = !com;
        $('#tinyMasc').textContent = com ? SHC.tinyMascara(t.token) : '';
        if (com && t.ultima && !tinyRodando && !$('#tinyMsg').textContent) tinyMsg('Última atualização em ' + dataBR(t.ultima.ts) + ': ' + SHC.tinyResumo(t.ultima) + '.');
    }
    // pedido = chrome.permissions.request(...) chamado DENTRO do clique, antes de qualquer await (senão o Chrome recusa).
    async function puxarTiny(pedido, token) {
        let deu = false;
        try { deu = await pedido; } catch (e) { deu = false; }
        if (!deu) return tinyMsg('Sem a permissão do Chrome o Copiloto não consegue ler o Tiny. Clique de novo e escolha “Permitir”.', true);
        if (tinyRodando) return;
        tinyRodando = true;
        tinyBotoes(true);
        tinyMsg('Lendo os produtos do Tiny…');
        $('#rProgLin').hidden = true;
        try {
            const produtos = await SHC.tinyPuxar(token, {
                fetch: (u, i) => fetch(u, i), espera: ms => new Promise(r => setTimeout(r, ms)),
                progresso: (p, n) => { tinyMsg('Lendo os produtos do Tiny… página ' + p + ' de ' + n); tinyBarra(p, n); },
            });
            const r = await SHC.tinyGravar(produtos, 'tiny');
            await SHC.gravarChave(SHC.TINY_CHAVE, { token, ultima: Object.assign({ ts: Date.now() }, r) });   // token só é guardado depois que o Tiny aceitou
            $('#tinyToken').value = ''; $('#rToken').value = ''; $('#rPassos').hidden = true;
            await lerDados();
            desenhaTabela();
            tinyMsg('✓ ' + SHC.tinyResumo(r) + '.' + (txtPrincipais() ? ' Agora: ' + txtPrincipais() + '.' : ''));
            impResumo(r, 'Tiny');
        } catch (e) {
            tinyMsg((e && e.msg) || FALHA, true);
        } finally {
            tinyRodando = false;
            tinyBotoes(false);
            $('#impProgLin').hidden = true;
            await desenhaTiny();
        }
    }
    // ── Omie: {appKey, appSecret} guardados só neste Chrome (SHC.OMIE_CHAVE, o mesmo que omie.js/background leem); a leitura é do fundo
    // ({acao:'sincronizar_custos', erp:'omie'}), que grava o andamento em shc:status.custosProgresso e responde {ok, atualizados, semCusto, mantidos} | {ok:false, msg}. ──
    const OMIE = { origins: [SHC.OMIE_ORIGEM] };
    let omieRodando = false;
    async function desenhaOmie() {
        const o = await SHC.lerChave(SHC.OMIE_CHAVE), com = !!(o && o.appKey && o.appSecret);
        $('#omieSem').hidden = com;
        $('#omieCom').hidden = !com;
        $('#omieMasc').textContent = com ? (SHC.omieMascara || SHC.tinyMascara)(o.appKey) : '';
    }
    async function puxarOmie(pedido, chaves) {
        let deu = false;
        try { deu = await pedido; } catch (e) { deu = false; }
        if (!deu) return tinyMsg('Sem a permissão do Chrome o Copiloto não consegue ler o Omie. Clique de novo e escolha “Permitir”.', true);
        if (omieRodando) return;
        omieRodando = true;
        ['#omieConectar', '#omieAtualizar', '#omieEsquecer'].forEach(s => { $(s).disabled = true; });
        tinyMsg('Lendo os produtos do Omie…');
        impBarra({ erp: 'omie' });
        try {
            if (chaves) await SHC.gravarChave(SHC.OMIE_CHAVE, chaves);
            const r = await chrome.runtime.sendMessage({ acao: 'sincronizar_custos', erp: 'omie' });
            if (!r || !r.ok) throw Object.assign(new Error('omie'), { msg: (r && r.msg) || 'Não consegui ler o Omie agora. Tente de novo em alguns minutos.' });
            $('#omieKey').value = ''; $('#omieSecret').value = '';
            await lerDados();
            desenhaTabela();
            tinyMsg('✓ Custos do Omie importados.' + (txtPrincipais() ? ' Agora: ' + txtPrincipais() + '.' : ''));
            impResumo(r, 'Omie');
        } catch (e) {
            if (chaves) await chrome.storage.local.remove(SHC.OMIE_CHAVE).catch(() => {});   // chave que o Omie recusou não fica guardada
            tinyMsg((e && e.msg) || FALHA, true);
        } finally {
            omieRodando = false;
            ['#omieConectar', '#omieAtualizar', '#omieEsquecer'].forEach(s => { $(s).disabled = false; });
            $('#impProgLin').hidden = true;
            await desenhaOmie();
        }
    }
    $('#omieConectar').addEventListener('click', () => {
        const appKey = $('#omieKey').value.trim(), appSecret = $('#omieSecret').value.trim();
        if (appKey.length < 8 || appSecret.length < 8 || /\s/.test(appKey + appSecret)) return tinyMsg('Cole a App Key e a App Secret inteiras do Omie (Configurações › Aplicativos).', true);
        puxarOmie(chrome.permissions.request(OMIE), { appKey, appSecret });
    });
    $('#omieSecret').addEventListener('keydown', e => { if (e.key === 'Enter') $('#omieConectar').click(); });
    $('#omieAtualizar').addEventListener('click', () => puxarOmie(chrome.permissions.request(OMIE), null));
    $('#omieEsquecer').addEventListener('click', async () => {
        await chrome.storage.local.remove(SHC.OMIE_CHAVE);
        try { await chrome.permissions.remove(OMIE); } catch (e) { /* ok */ }
        tinyMsg('Chaves esquecidas. Os custos que já vieram do Omie continuam na tabela.');
        desenhaOmie();
    });
    desenhaOmie();
    // ── Bling (v3.1, bling.js): OAuth 2.0 com o aplicativo do PRÓPRIO seller (o Copiloto não tem servidor nem segredo embutido).
    // Client ID/Secret e tokens só em erp:bling, neste Chrome. Conectar: pede identity + bling.com.br (opcionais) no clique →
    // launchWebAuthFlow com state aleatório conferido aqui → o fundo troca o code ({acao:'bling_conectar'}) e já importa os custos.
    const BLING = { permissions: ['identity'], origins: SHC.BLING_ORIGENS };
    let blingRodando = false, blingSalvo = null;   // blingSalvo: o guardado (o clique decide sem esperar o armazenamento)
    const blingBotoes = off => ['#blingConectar', '#blingAtualizar', '#blingEsquecer'].forEach(s => { $(s).disabled = off; });
    async function desenhaBling() {
        const b = (await SHC.lerChave(SHC.BLING_CHAVE)) || {}, com = !!(b.clientId && b.refresh);
        blingSalvo = b.clientId && b.clientSecret ? b : null;
        $('#blingSem').hidden = com;
        $('#blingCom').hidden = !com;
        $('#blingMasc').textContent = com ? SHC.tinyMascara(b.clientId) : '';
        $('#blingRetorno').textContent = SHC.blingRetorno(chrome.runtime.id, chrome.identity);
        if (!com && b.clientId && !$('#blingId').value) $('#blingId').value = b.clientId;
        if (b.reconectar && !blingRodando && !$('#tinyMsg').textContent) tinyMsg('Conecte o Bling de novo: a entrada venceu (30 dias sem uso). Clique em Conectar no cartão do Bling.', true);
    }
    // cred = {clientId, clientSecret} → entra no Bling e importa; null → só importa de novo (já conectado).
    async function puxarBling(pedido, cred) {
        let deu = false;
        try { deu = await pedido; } catch (e) { deu = false; }
        if (!deu) return tinyMsg('Sem a permissão do Chrome o Copiloto não consegue entrar no Bling. Clique de novo e escolha “Permitir”.', true);
        if (blingRodando) return;
        blingRodando = true;
        blingBotoes(true);
        let antes = null;
        try {
            let r;
            if (cred) {
                antes = (await SHC.lerChave(SHC.BLING_CHAVE)) || {};
                await SHC.gravarChave(SHC.BLING_CHAVE, antes.clientId === cred.clientId && antes.clientSecret === cred.clientSecret ? Object.assign({}, antes, cred) : cred);
                tinyMsg('Entre no Bling na janela que abriu e clique em “Autorizar”…');
                const state = SHC.blingEstado();
                let volta = '';
                try { volta = await chrome.identity.launchWebAuthFlow({ url: SHC.blingUrlAutorizar(cred.clientId, state), interactive: true }); }
                catch (e) { throw { msg: 'A entrada no Bling fechou sem autorizar. Confira o Client ID e a URL de redirecionamento do aplicativo (passo 3) e tente de novo.' }; }
                const v = SHC.blingLerVolta(volta, state);
                if (!v.ok) throw { msg: v.msg };
                tinyMsg('Lendo os produtos do Bling…');
                impBarra({ erp: 'bling' });
                r = await chrome.runtime.sendMessage({ acao: 'bling_conectar', code: v.code });
            } else {
                tinyMsg('Lendo os produtos do Bling…');
                impBarra({ erp: 'bling' });
                r = await chrome.runtime.sendMessage({ acao: 'sincronizar_custos', erp: 'bling' });
            }
            if (!r || !r.ok) throw { msg: (r && r.msg) || 'Não consegui ler o Bling agora. Tente de novo em alguns minutos.' };
            $('#blingId').value = ''; $('#blingSecret').value = '';
            await lerDados();
            desenhaTabela();
            tinyMsg('✓ ' + (r.resumo || 'Custos do Bling importados') + '.' + (txtPrincipais() ? ' Agora: ' + txtPrincipais() + '.' : ''));
            impResumo(r, 'Bling');
        } catch (e) {
            // Entrada que não deu certo (e não chegou a conectar): volta o que estava guardado antes (Client ID/Secret e tokens);
            // só apaga quando não havia nada antes.
            if (cred && antes) {
                const b = await SHC.lerChave(SHC.BLING_CHAVE).catch(() => null);
                if (b && !b.refresh) await (antes.clientId ? SHC.gravarChave(SHC.BLING_CHAVE, antes) : chrome.storage.local.remove(SHC.BLING_CHAVE)).catch(() => {});
            }
            tinyMsg((e && e.msg) || FALHA, true);
        } finally {
            blingRodando = false;
            blingBotoes(false);
            $('#impProgLin').hidden = true;
            await desenhaBling();
        }
    }
    $('#blingConectar').addEventListener('click', () => {
        let clientId = $('#blingId').value.trim(), clientSecret = $('#blingSecret').value.trim();
        // Reconectar (a entrada venceu): Client ID igual ao guardado e Secret em branco → usa o guardado.
        if (!clientSecret && blingSalvo && clientId === blingSalvo.clientId) clientSecret = blingSalvo.clientSecret;
        if (clientId.length < 8 || clientSecret.length < 8 || /\s/.test(clientId + clientSecret)) return tinyMsg('Cole o Client ID e o Client Secret inteiros do seu aplicativo do Bling (passo 4).', true);
        puxarBling(chrome.permissions.request(BLING), { clientId, clientSecret });
    });
    $('#blingSecret').addEventListener('keydown', e => { if (e.key === 'Enter') $('#blingConectar').click(); });
    $('#blingAtualizar').addEventListener('click', () => puxarBling(chrome.permissions.request(BLING), null));
    $('#blingCopiar').addEventListener('click', () => {
        const t = $('#blingRetorno').textContent;
        Promise.resolve(navigator.clipboard && navigator.clipboard.writeText(t)).then(() => tinyMsg('Endereço copiado. Cole em “URL de redirecionamento” no aplicativo do Bling.'), () => tinyMsg('Selecione o endereço e copie com Ctrl+C.'));
    });
    $('#blingEsquecer').addEventListener('click', async () => {
        await chrome.storage.local.remove(SHC.BLING_CHAVE);
        try { await chrome.permissions.remove(BLING); } catch (e) { /* ok */ }
        tinyMsg('Bling desconectado. Os custos que já vieram do Bling continuam na tabela.');
        desenhaBling();
    });
    desenhaBling();
    $('#tinyConectar').addEventListener('click', () => {
        const token = $('#tinyToken').value.trim();
        if (token.length < 10 || /\s/.test(token)) return tinyMsg('Cole o token inteiro do Tiny (Configurações › E-commerce › Token API).', true);
        puxarTiny(chrome.permissions.request(TINY), token);
    });
    $('#tinyToken').addEventListener('keydown', e => { if (e.key === 'Enter') $('#tinyConectar').click(); });
    // Botão rápido: conectado → puxa com 1 clique; sem token → abre o passo a passo com o campo do token ali mesmo.
    function tinyRapido() {
        if (tinyToken) return puxarTiny(chrome.permissions.request(TINY), tinyToken);
        $('#rPassos').hidden = false;
        $('#rToken').focus();
    }
    $('#rTiny').addEventListener('click', tinyRapido);
    $('#rConectar').addEventListener('click', () => {
        const token = $('#rToken').value.trim();
        if (token.length < 10 || /\s/.test(token)) return tinyMsg('Cole o token inteiro do Tiny (passo 2 acima).', true);
        puxarTiny(chrome.permissions.request(TINY), token);
    });
    $('#rToken').addEventListener('keydown', e => { if (e.key === 'Enter') $('#rConectar').click(); });
    $('#tinyAtualizar').addEventListener('click', () => {
        const pedido = chrome.permissions.request(TINY);
        SHC.lerChave(SHC.TINY_CHAVE).then(t => (t && t.token ? puxarTiny(pedido, t.token) : desenhaTiny()));
    });
    $('#tinyEsquecer').addEventListener('click', async () => {
        await chrome.storage.local.remove(SHC.TINY_CHAVE);
        try { await chrome.permissions.remove(TINY); } catch (e) { /* ok */ }
        tinyMsg('Token esquecido. Os custos que já vieram do Tiny continuam na tabela.');
        desenhaTiny();
    });
    desenhaTiny();

    // Mudou algo no armazenamento (etiqueta no ML, painel lateral, sincronização): relê.
    let espera = null;
    chrome.storage.onChanged.addListener((mud, area) => {
        if (area !== 'local') return;
        if (mud['shc:status'] && mud['shc:status'].newValue && passo === 3 && !$('#guia').hidden) mostraConta(mud['shc:status'].newValue);
        // Importação pelo fundo (Omie, ou o Tiny a cada sincronização): a barra acompanha shc:status.custosProgresso.
        if (mud['shc:status'] && !tinyRodando) impBarra((mud['shc:status'].newValue || {}).custosProgresso);
        const relevante = Object.keys(mud).some(k => /^(c\||vm\||ml:anuncios|ml:promos|cfg$|shc:guia$)/.test(k));
        if (!relevante) return;
        clearTimeout(espera);
        espera = setTimeout(async () => {
            await lerDados();
            if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#corpo')) { redesenharDepois = true; return; }
            desenhaTabela();
        }, 300);
    });

    carregar();
})();
