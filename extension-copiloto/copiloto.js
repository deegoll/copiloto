// SellerHub Copiloto — roda nas telas do Mercado Livre e da Shopee, na sessão que o seller já tem logada.
// Acha cada anúncio na tela, lê os preços da linha e mostra QUANTO SOBRA. Clique na etiqueta = informar
// ou editar o custo. Nunca confirma nada sozinho: "Marcar só os que dão lucro" só tica as caixas da página.
(function () {
    'use strict';
    if (window.__SHC_COPILOTO__) return;
    window.__SHC_COPILOTO__ = true;

    const SHC = globalThis.SHC;
    const TESTE = window.__SHC_TESTE__ || null;              // só a página de teste define (mundo isolado na extensão)
    const host = (TESTE && TESTE.host) || location.hostname;
    const CANAL = /(^|\.)mercadolivre\.com\.br$/.test(host) ? 'ml' : (/^seller\.shopee\.com\.br$/.test(host) ? 'sp' : '');
    if (!CANAL || !SHC) return;
    const NOME_CANAL = CANAL === 'ml' ? 'Mercado Livre' : 'Shopee';

    // ── Onde atuar (a checagem roda a cada varredura: as duas plataformas trocam de tela sem recarregar) ──
    const ROTA = CANAL === 'ml'
        ? /promo|promoc|deal|campa|central-de|anuncios|listings|publicidade|advertising|\/ads/i
        : /\/portal\/(marketing|product|ads)|promotion|discount|flash|voucher|campaign|boost/i;
    function rotaOk() {
        if (TESTE && TESTE.rota) return ROTA.test(TESTE.rota);
        let r = location.pathname + location.search;
        try { if (window.top !== window) r += ' ' + window.top.location.pathname; } catch (e) { r += ' iframe'; }
        return ROTA.test(r);
    }

    const RE_PRECO = /R\$\s?(\d{1,3}(?:\.\d{3})*,\d{2})/g;
    const RE_ID_ML = /MLB-?(\d{6,14})/i;
    const RE_ID_SP_HREF = /(?:\/product\/(?:\d+\/)?|item[_-]?id=)(\d{6,15})/i;
    const RE_ID_SP_TXT = /(?:ID do (?:produto|item)|Item ID)\s*[:#]?\s*(\d{6,15})/i;
    const RE_IDS_G = CANAL === 'ml' ? /MLB-?(\d{6,14})/gi : /(?:\/product\/(?:\d+\/)?|item[_-]?id=|ID do (?:produto|item)\s*[:#]?\s*|Item ID\s*[:#]?\s*)(\d{6,15})/gi;

    let cfg = Object.assign({}, SHC.PADRAO);
    const itens = new Map();        // chave → {id, ancora, linha, host, precos, titulo}
    const custos = new Map();       // chave → dados salvos (ou null = sem custo)
    const vistosGravados = new Set();
    const cacheLinha = new WeakMap();

    // ── Detecção ──────────────────────────────────────────────────────────────────────────────
    function achaAncoras() {
        const achados = new Map();
        const add = (bruto, el) => {
            const id = SHC.normalizaId(CANAL, bruto);
            if (id && !achados.has(id) && el && !el.closest('[data-shc-host],[data-shc-ui]')) achados.set(id, el);
        };
        const sel = CANAL === 'ml'
            ? 'a[href*="MLB"],a[href*="mlb"],[data-item-id],[data-id*="MLB"]'
            : 'a[href*="product"],a[href*="item"],[data-item-id],[data-itemid],[data-product-id]';
        document.querySelectorAll(sel).forEach(el => {
            const attrs = ['href', 'data-item-id', 'data-itemid', 'data-id', 'data-product-id'].map(a => el.getAttribute(a) || '').join(' ');
            let m = (CANAL === 'ml' ? RE_ID_ML : RE_ID_SP_HREF).exec(attrs);
            if (!m && CANAL === 'sp') m = /\b(\d{8,15})\b/.exec((el.getAttribute('data-item-id') || el.getAttribute('data-itemid') || el.getAttribute('data-product-id') || ''));
            if (m) add(m[1], el);
        });
        // ID escrito no texto (tabelas que não linkam o anúncio)
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: n => (n.nodeValue && n.nodeValue.length < 220 && n.parentElement
                && !n.parentElement.closest('[data-shc-host],[data-shc-ui],script,style,noscript,textarea'))
                ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
        });
        let t, lidos = 0;
        while ((t = walker.nextNode()) && lidos++ < 25000 && achados.size < 300) {
            const m = (CANAL === 'ml' ? RE_ID_ML : RE_ID_SP_TXT).exec(t.nodeValue);
            if (m) add(m[1], t.parentElement);
        }
        return achados;
    }

    function qtdIds(el) {
        const s = new Set();
        const txt = (el.textContent || '').slice(0, 20000) + ' ' + [...el.querySelectorAll('a[href]')].slice(0, 30).map(a => a.getAttribute('href')).join(' ');
        RE_IDS_G.lastIndex = 0;
        let m;
        while ((m = RE_IDS_G.exec(txt)) && s.size < 2) s.add(m[1].replace(/^0+/, ''));
        return s.size;
    }

    // A "linha" do anúncio: o maior bloco em volta dele que tem preço e não inclui outro anúncio.
    function linhaDe(el) {
        const c = cacheLinha.get(el);
        if (c && c.isConnected && c.contains(el)) return c;
        let melhor = null;
        for (let n = el, i = 0; n && n !== document.body && i < 12; n = n.parentElement, i++) {
            if (qtdIds(n) > 1) break;
            if (/R\$\s?\d/.test(n.textContent || '') || n.querySelector('input[type=text],input[type=number],input:not([type])')) melhor = n;
            if (melhor === n && /^(TR|LI|ARTICLE)$/.test(n.tagName)) break;
        }
        const linha = melhor || el.parentElement || el;
        cacheLinha.set(el, linha);
        return linha;
    }

    function precosDe(linha) {
        const s = new Set();
        const txt = linha.textContent || '';
        RE_PRECO.lastIndex = 0;
        let m;
        while ((m = RE_PRECO.exec(txt)) && s.size < 8) s.add(SHC.num(m[1]));
        linha.querySelectorAll('input').forEach(inp => {
            if (/checkbox|radio|hidden|file|button|submit/i.test(inp.type || '')) return;
            if (inp.closest('[data-shc-host],[data-shc-ui]')) return;
            const dica = [inp.name, inp.id, inp.placeholder, inp.getAttribute('aria-label'), inp.parentElement && inp.parentElement.textContent]
                .join(' ').toLowerCase();
            if (/%/.test(dica) || !/pre[cç]o|price|valor|r\$/.test(dica)) return;
            const v = SHC.num(inp.value);
            if (v && v > 0) s.add(v);
        });
        return [...s].filter(v => v > 0 && v < 1e6).sort((a, b) => a - b);
    }

    function tituloDe(ancora, linha) {
        const a = ancora.closest('a');
        const ta = a ? (a.textContent || '').trim() : '';
        if (ta.length >= 12 && !/R\$/.test(ta)) return ta.slice(0, 120);
        let melhor = '';
        const w = document.createTreeWalker(linha, NodeFilter.SHOW_TEXT);
        let t;
        while ((t = w.nextNode())) {
            const s = (t.nodeValue || '').trim();
            if (s.length > melhor.length && s.length <= 160 && !/R\$|^\d[\d.,\s%]*$/.test(s) && !RE_ID_ML.test(s) && !(t.parentElement && t.parentElement.closest('[data-shc-host]'))) melhor = s;
        }
        return melhor.slice(0, 120);
    }

    // ── Etiqueta no anúncio (Shadow DOM: o CSS da página não bagunça, o nosso não vaza) ──────────
    const CSS_ETIQUETA = `:host{all:initial;display:inline-block;vertical-align:middle;margin:0 0 0 6px}
button{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;gap:4px;padding:2px 9px;border-radius:999px;
font:700 11.5px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#fff;background:#475569;white-space:nowrap;box-shadow:0 1px 2px rgba(15,23,42,.18)}
button:hover{filter:brightness(1.08)} button:focus-visible{outline:2px solid #0EA5E9;outline-offset:2px}
.lucrativo{background:#047857}.apertado{background:#B45309}.prejuizo{background:#B91C1C}
.sem_custo{background:#fff;color:#0F172A;border:1px dashed #64748B;box-shadow:none}`;

    function criaEtiqueta(chave) {
        const h = document.createElement('span');
        h.setAttribute('data-shc-host', chave);
        const sr = h.attachShadow({ mode: 'open' });
        sr.innerHTML = '<style>' + CSS_ETIQUETA + '</style><button type="button"></button>';
        const b = sr.querySelector('button');
        ['pointerdown', 'mousedown', 'mouseup'].forEach(ev => b.addEventListener(ev, e => e.stopPropagation()));
        b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); abrirJanela(chave); });
        return h;
    }

    function calcDoItem(chave, preco) {
        const it = itens.get(chave), c = custos.get(chave) || {};
        const p = preco !== undefined ? preco : (it && it.precos.length ? it.precos[0] : null);
        return p ? SHC.calcular(CANAL, p, c, cfg) : null;
    }

    function pintaEtiqueta(chave) {
        const it = itens.get(chave);
        if (!it || !it.host) return;
        const b = it.host.shadowRoot.querySelector('button');
        const c = custos.get(chave);
        const r = calcDoItem(chave);
        b.className = '';
        if (!c || !(SHC.num(c.custo) > 0)) {
            b.classList.add('sem_custo');
            b.textContent = '＋ custo';
            b.title = 'Informe o custo deste produto para ver quanto sobra';
            it.classe = 'sem_custo';
            return;
        }
        if (!r) { b.classList.add('sem_custo'); b.textContent = 'custo ok · sem preço na tela'; it.classe = 'sem_custo'; return; }
        b.classList.add(r.classe);
        b.textContent = 'Sobra ' + SHC.moeda(r.sobra_rs) + ' · ' + pct(r.sobra_pct) + (r.frete_desconhecido ? ' ⚠' : '');
        b.title = (it.precos.length > 1 ? 'No menor preço da linha (' + SHC.moeda(r.preco) + '). ' : '') + 'Clique para ver a conta ou editar o custo.';
        it.classe = r.classe;
    }

    // ── Janela de custo + conta detalhada ─────────────────────────────────────────────────────
    const CSS_UI = `:host{all:initial}
*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
.jan{position:fixed;z-index:2147483646;width:340px;max-height:calc(100vh - 24px);overflow:auto;background:#fff;color:#0F172A;border-radius:14px;
box-shadow:0 18px 50px rgba(15,23,42,.35),0 0 0 1px rgba(15,23,42,.08);font-size:13px;line-height:1.45}
.cab{display:flex;align-items:flex-start;gap:8px;padding:12px 14px 8px;border-bottom:1px solid #E2E8F0}
.cab .t{flex:1;font-weight:700;font-size:13px}.cab .s{display:block;font-weight:500;color:#64748B;font-size:11.5px;margin-top:2px}
.x{all:unset;cursor:pointer;color:#64748B;font-size:18px;line-height:1;padding:2px 4px;border-radius:6px}.x:hover{background:#F1F5F9}
.corpo{padding:10px 14px 14px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 10px}
.chip{all:unset;cursor:pointer;padding:3px 9px;border-radius:999px;border:1px solid #CBD5E1;font-size:12px;font-weight:600;color:#334155}
.chip.on{background:#0F172A;border-color:#0F172A;color:#fff}
.res{border-radius:10px;padding:10px 12px;margin-bottom:10px;background:#F1F5F9}
.res.lucrativo{background:#ECFDF5}.res.apertado{background:#FFFBEB}.res.prejuizo{background:#FEF2F2}
.res .v{font-size:20px;font-weight:800;letter-spacing:-.2px}
.res.lucrativo .v{color:#047857}.res.apertado .v{color:#B45309}.res.prejuizo .v{color:#B91C1C}
.res .l{font-size:11.5px;color:#475569;font-weight:600}
table{width:100%;border-collapse:collapse;font-size:12px;margin:6px 0 2px}td{padding:2px 0;color:#334155}td:last-child{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;padding-left:8px}
.dica{font-size:11.5px;color:#475569;margin:6px 0 0}.av{color:#B45309}
.min{font-size:12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:7px 9px;margin-bottom:10px}
label{display:block;font-size:11.5px;font-weight:700;color:#334155;margin:8px 0 3px}
.inp{width:100%;padding:7px 9px;border:1px solid #CBD5E1;border-radius:8px;font-size:14px;color:#0F172A;background:#fff}
.inp:focus{outline:2px solid #0EA5E9;outline-offset:0;border-color:#0EA5E9}
.dupla{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.opcs{display:flex;gap:12px;align-items:center;font-size:12.5px;margin-top:4px}.opcs label{display:inline-flex;gap:4px;align-items:center;margin:0;font-weight:600}
.acoes{display:flex;gap:8px;margin-top:12px;align-items:center}
.bt{all:unset;cursor:pointer;padding:8px 14px;border-radius:8px;font-weight:700;font-size:13px;background:#0F172A;color:#fff}
.av2 summary{cursor:pointer;font-size:12px;color:#0369A1;font-weight:600;margin-top:10px}.av2 .inp{margin-top:5px}
.bt.sec{background:#fff;color:#B91C1C;border:1px solid #FCA5A5}.lnk{all:unset;cursor:pointer;color:#0369A1;font-size:12px;font-weight:600;margin-left:auto}
.pnl{position:fixed;z-index:2147483645;right:16px;bottom:72px;width:270px;background:#0F172A;color:#E2E8F0;border-radius:12px;padding:10px 12px;
box-shadow:0 12px 32px rgba(0,0,0,.35);font-size:12.5px}
.pnl h4{margin:0 0 6px;font-size:12.5px;color:#fff;display:flex;align-items:center;gap:6px}.pnl h4 span{flex:1}
.pnl .k{display:flex;justify-content:space-between;padding:1px 0}.pnl .k b{font-variant-numeric:tabular-nums}
.pnl .bol{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
.pnl .bt{display:block;text-align:center;margin-top:8px;background:#047857;padding:7px}
.pnl .mut{color:#94A3B8;font-size:11px;margin-top:6px}.pnl .x{color:#94A3B8}.pnl .x:hover{background:#1E293B}
.pnl .lnk{color:#7DD3FC;margin:0}
.mini{position:fixed;z-index:2147483645;right:16px;bottom:72px;all:unset;cursor:pointer;background:#0F172A;color:#fff;border-radius:999px;padding:7px 12px;font:700 12px/1 -apple-system,Segoe UI,Arial,sans-serif;box-shadow:0 8px 20px rgba(0,0,0,.3)}`;

    let uiHost = null, uiRoot = null;
    function ui() {
        if (uiHost && uiHost.isConnected) return uiRoot;
        uiHost = document.createElement('div');
        uiHost.setAttribute('data-shc-ui', '1');
        uiRoot = uiHost.attachShadow({ mode: 'open' });
        uiRoot.innerHTML = '<style>' + CSS_UI + '</style><div id="jan"></div><div id="pnl"></div>';
        ['keydown', 'keyup', 'keypress'].forEach(ev => uiHost.addEventListener(ev, e => e.stopPropagation()));
        document.documentElement.appendChild(uiHost);
        return uiRoot;
    }

    const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const nf = v => (v === null || v === undefined || v === '') ? '' : String(v).replace('.', ',');
    const nfr = v => (v === null || v === undefined || v === '' || !isFinite(v)) ? '' : Number(v).toFixed(2).replace('.', ',');
    const pct = v => (v < 0 ? '−' : '') + String(Math.abs(Math.round(v * 10) / 10)).replace('.', ',') + '%';

    let janelaAberta = null;
    function abrirJanela(chave) {
        const it = itens.get(chave);
        if (!it) return;
        janelaAberta = { chave, preco: it.precos.length ? it.precos[0] : null };
        desenhaJanela(true);
    }
    function fecharJanela() { janelaAberta = null; const r = ui(); r.getElementById('jan').innerHTML = ''; }

    function desenhaJanela(foco) {
        if (!janelaAberta) return;
        const { chave } = janelaAberta;
        const it = itens.get(chave);
        if (!it) return fecharJanela();
        const salvo = custos.get(chave) || {};
        const r = ui();
        const raiz = r.getElementById('jan');
        // Container novo a cada desenho: os ouvintes morrem junto com o anterior (não acumulam).
        raiz.innerHTML = '';
        const box = document.createElement('div');
        raiz.appendChild(box);
        const precos = it.precos.length ? it.precos : [];
        const precoManual = janelaAberta.precoManual;
        box.innerHTML = `<div class="jan" role="dialog" aria-label="Custo e sobra">
  <div class="cab"><div class="t">${esc(it.titulo || 'Anúncio')}<span class="s">${esc(it.id)} · ${NOME_CANAL}</span></div><button class="x" data-a="fechar" aria-label="Fechar">×</button></div>
  <div class="corpo">
    ${precos.length > 1 ? '<div class="l" style="font-size:11.5px;color:#475569;font-weight:600">Preço analisado</div><div class="chips">' + precos.map(p => `<button class="chip${p === janelaAberta.preco ? ' on' : ''}" data-p="${p}">${SHC.moeda(p)}</button>`).join('') + '</div>' : ''}
    ${!precos.length ? `<label for="pm">Preço de venda (não achei preço nesta linha)</label><input class="inp" id="pm" inputmode="decimal" placeholder="Ex.: 79,90" value="${esc(nfr(precoManual))}">` : ''}
    <div id="res"></div>
    <label for="custo">Custo do produto (R$)</label>
    <input class="inp" id="custo" inputmode="decimal" placeholder="Quanto você paga no produto" value="${esc(nfr(salvo.custo))}">
    <div class="dupla">
      <div><label for="outros">Embalagem e outros (R$)</label><input class="inp" id="outros" inputmode="decimal" placeholder="0,00" value="${esc(nfr(salvo.outros))}"></div>
      <div><label for="frete">Frete que você paga (R$)</label><input class="inp" id="frete" inputmode="decimal" placeholder="${CANAL === 'ml' ? 'só ≥ R$ 79 ou Full' : 'se houver'}" value="${esc(nfr(salvo.frete))}"></div>
    </div>
    ${CANAL === 'ml' ? `<div class="opcs"><label><input type="radio" name="tipo" value="classico"${(salvo.tipo || cfg.ml_tipo_padrao) !== 'premium' ? ' checked' : ''}> Clássico</label>
      <label><input type="radio" name="tipo" value="premium"${(salvo.tipo || cfg.ml_tipo_padrao) === 'premium' ? ' checked' : ''}> Premium</label>
      <label><input type="checkbox" id="full"${salvo.full ? ' checked' : ''}> Full</label></div>` : ''}
    <details class="av2"${salvo.comissao_pct !== undefined && salvo.comissao_pct !== null ? ' open' : ''}><summary>Comissão diferente neste anúncio?</summary>
      <input class="inp" id="com" inputmode="decimal" placeholder="padrão das configurações" value="${esc(nf(salvo.comissao_pct))}"></details>
    <div class="acoes"><button class="bt" data-a="salvar">Salvar custo</button>${salvo.custo ? '<button class="bt sec" data-a="remover">Remover</button>' : ''}<button class="lnk" data-a="painel">Configurações ⚙</button></div>
    ${!cfg.configurado ? '<p class="dica av">Imposto e comissões ainda estão no padrão. <button class="lnk" style="margin:0" data-a="painel">Ajustar em 1 minuto →</button></p>' : ''}
  </div></div>`;
        posicionaJanela(box.firstElementChild, it.host);
        const q = s => box.querySelector(s);
        const rascunho = () => {
            const d = { custo: SHC.num(q('#custo').value), outros: SHC.num(q('#outros').value), frete: SHC.num(q('#frete').value) };
            if (CANAL === 'ml') { const t = box.querySelector('input[name=tipo]:checked'); d.tipo = t ? t.value : 'classico'; d.full = !!(q('#full') && q('#full').checked); }
            d.comissao_pct = q('#com') ? SHC.num(q('#com').value) : null;
            return d;
        };
        const atualiza = () => {
            if (q('#pm')) janelaAberta.precoManual = SHC.num(q('#pm').value);
            const preco = precos.length ? janelaAberta.preco : janelaAberta.precoManual;
            q('#res').innerHTML = htmlConta(preco, rascunho(), Math.max(...precos, preco || 0));
        };
        box.addEventListener('input', atualiza);
        box.addEventListener('change', atualiza);
        box.addEventListener('click', async e => {
            const chip = e.target.closest('[data-p]');
            if (chip) { janelaAberta.preco = parseFloat(chip.getAttribute('data-p')); box.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === chip)); atualiza(); return; }
            const a = e.target.closest('[data-a]');
            if (!a) return;
            const acao = a.getAttribute('data-a');
            if (acao === 'fechar') fecharJanela();
            else if (acao === 'painel') abrirPainel();
            else if (acao === 'remover') { await SHC.removerCusto(CANAL, it.id); custos.set(chave, null); pintaEtiqueta(chave); atualizaPainel(); fecharJanela(); }
            else if (acao === 'salvar') {
                const d = rascunho();
                if (!(d.custo > 0)) { q('#custo').focus(); q('#custo').style.borderColor = '#DC2626'; return; }
                const dados = { custo: d.custo, outros: d.outros, frete: d.frete, comissao_pct: d.comissao_pct, titulo: it.titulo || '' };
                if (CANAL === 'ml') { dados.tipo = d.tipo; dados.full = d.full; }
                const novo = await SHC.salvarCusto(CANAL, it.id, dados);
                custos.set(chave, novo);
                pintaEtiqueta(chave); atualizaPainel(); fecharJanela();
            }
        });
        box.addEventListener('keydown', e => { if (e.key === 'Escape') fecharJanela(); if (e.key === 'Enter' && e.target.classList.contains('inp')) box.querySelector('[data-a=salvar]').click(); });
        atualiza();
        if (foco) setTimeout(() => { const alvo = q('#pm') && !janelaAberta.precoManual ? q('#pm') : q('#custo'); alvo && alvo.focus(); }, 30);
    }

    function htmlConta(preco, item, precoRef) {
        if (!preco) return '<div class="res"><div class="l">Informe o preço de venda para calcular.</div></div>';
        const c = SHC.calcular(CANAL, preco, item, cfg);
        if (!c) return '';
        const linhas = [
            ['Preço de venda', SHC.moeda(c.preco)],
            ['Comissão ' + NOME_CANAL + ' (' + pct(c.comissao_pct) + (CANAL === 'ml' ? ' · ' + (c.tipo === 'premium' ? 'Premium' : 'Clássico') : '') + ')', '− ' + SHC.moeda(c.comissao_rs)],
        ];
        if (c.taxa_fixa_rs > 0) linhas.push([CANAL === 'ml' ? 'Taxa fixa por venda' : 'Taxa fixa por item', '− ' + SHC.moeda(c.taxa_fixa_rs)]);
        linhas.push(['Frete · ' + c.frete_regra, '− ' + SHC.moeda(c.frete_rs)]);
        if (c.imposto_pct > 0) linhas.push(['Imposto (' + pct(c.imposto_pct) + ')', '− ' + SHC.moeda(c.imposto_rs)]);
        if (c.custo_rs !== null) linhas.push(['Custo do produto', '− ' + SHC.moeda(c.custo_rs)]);
        if (c.outros_rs > 0) linhas.push(['Embalagem e outros', '− ' + SHC.moeda(c.outros_rs)]);
        const rotulo = { lucrativo: 'Dá lucro', apertado: 'Lucro abaixo da sua meta de ' + pct(SHC.num(cfg.margem_alvo_pct) || 0), prejuizo: 'Prejuízo', sem_custo: 'Falta o custo' }[c.classe];
        let html = `<div class="res ${c.classe}">` + (c.sobra_rs === null
            ? `<div class="l">Você recebe do ${NOME_CANAL}</div><div class="v" style="color:#0F172A">${SHC.moeda(c.recebe_rs)}</div><div class="l">Informe o custo abaixo para ver o que sobra.</div>`
            : `<div class="l">Sobra no final · ${esc(rotulo)}</div><div class="v">${SHC.moeda(c.sobra_rs)} <span style="font-size:14px">(${pct(c.sobra_pct)})</span></div>`)
            + '<table>' + linhas.map(l => `<tr><td>${esc(l[0])}</td><td>${esc(l[1])}</td></tr>`).join('') + '</table>'
            + (c.frete_desconhecido ? '<p class="dica av">⚠ Acima de R$ 79 o frete grátis é seu. Informe quanto paga, ou um frete médio nas configurações.</p>' : '')
            + '</div>';
        if (c.custo_rs !== null) {
            const pmin = SHC.precoMinimo(CANAL, item, cfg, 0);
            const palvo = SHC.precoMinimo(CANAL, item, cfg, SHC.num(cfg.margem_alvo_pct) || 0);
            const ref = precoRef && precoRef > 0 ? precoRef : null;
            const desc = (p) => ref && p && p < ref ? ' · desconto máx. ' + pct((1 - p / ref) * 100) : '';
            html += '<div class="min">'
                + (pmin ? `Preço mínimo sem prejuízo: <b>${SHC.moeda(pmin)}</b>${desc(pmin)}<br>` : 'Nem vendendo mais caro sobra: revise o custo ou a comissão.<br>')
                + (palvo ? `Para sobrar ${pct(SHC.num(cfg.margem_alvo_pct) || 0)}: <b>${SHC.moeda(palvo)}</b>${desc(palvo)}` : '')
                + '</div>';
            if (CANAL === 'ml' && !item.full && preco >= 79) {
                const abaixo = SHC.calcular(CANAL, 78.99, item, cfg);
                if (abaixo && c.sobra_rs !== null && abaixo.sobra_rs > c.sobra_rs) html += `<p class="dica">💡 A R$ 78,99 o frete volta a ser do comprador e sobraria <b>${SHC.moeda(abaixo.sobra_rs)}</b>.</p>`;
            }
        }
        return html;
    }

    function posicionaJanela(el, ancora) {
        if (!el) return;
        const W = 340, H = Math.min(el.offsetHeight || 480, window.innerHeight - 24);
        let x = 12, y = 12;
        if (ancora && ancora.isConnected) {
            const b = ancora.getBoundingClientRect();
            x = Math.min(Math.max(12, b.left), window.innerWidth - W - 12);
            y = b.bottom + 8;
            if (y + H > window.innerHeight - 12) y = Math.max(12, b.top - H - 8);
        }
        el.style.left = x + 'px';
        el.style.top = y + 'px';
    }

    document.addEventListener('mousedown', e => {
        if (!janelaAberta || !uiHost) return;
        if (e.composedPath().indexOf(uiHost) >= 0) return;
        if (e.target.closest && e.target.closest('[data-shc-host]')) return;
        fecharJanela();
    }, true);

    // ── Resumo da tela ────────────────────────────────────────────────────────────────────────
    let painelOculto = false;
    let msgPainel = null;
    function atualizaPainel() {
        const r = ui();
        const box = r.getElementById('pnl');
        const vis = [...itens.values()].filter(i => i.host && i.host.isConnected);
        if (!vis.length || !rotaOk()) { box.innerHTML = ''; return; }
        if (painelOculto) { box.innerHTML = `<button class="mini" data-a="mostrar">Copiloto · ${vis.length}</button>`; return; }
        const n = cls => vis.filter(i => i.classe === cls).length;
        const temCaixa = vis.some(i => i.linha && i.linha.querySelector('input[type=checkbox]'));
        box.innerHTML = `<div class="pnl"><h4><span>Copiloto · ${vis.length} anúncio${vis.length > 1 ? 's' : ''}</span><button class="x" data-a="ocultar" aria-label="Minimizar">–</button></h4>
  <div class="k"><span><i class="bol" style="background:#10B981"></i>Dão lucro</span><b>${n('lucrativo')}</b></div>
  <div class="k"><span><i class="bol" style="background:#F59E0B"></i>Abaixo da meta</span><b>${n('apertado')}</b></div>
  <div class="k"><span><i class="bol" style="background:#EF4444"></i>Prejuízo</span><b>${n('prejuizo')}</b></div>
  <div class="k"><span><i class="bol" style="background:#94A3B8"></i>Sem custo</span><b>${n('sem_custo')}</b></div>
  ${temCaixa && (n('lucrativo') + n('apertado') + n('prejuizo')) ? '<button class="bt" data-a="marcar">✓ Marcar só os que dão lucro</button>' : ''}
  <div class="mut" id="msg">${msgPainel && Date.now() - msgPainel.ts < 15000 ? esc(msgPainel.txt) : (n('sem_custo') ? 'Clique em “＋ custo” no anúncio para informar.' : 'Clique na etiqueta para ver a conta.')}</div>
  <div style="margin-top:6px"><button class="lnk" data-a="painel">Custos e configurações ⚙</button></div></div>`;
    }

    function marcarLucrativos() {
        let marcados = 0, desmarcados = 0;
        itens.forEach(i => {
            if (!i.linha || !i.host || !i.host.isConnected) return;
            const cb = i.linha.querySelector('input[type=checkbox]');
            if (!cb || cb.disabled) return;
            const quer = i.classe === 'lucrativo';
            if (cb.checked !== quer) { cb.click(); if (quer) marcados++; else desmarcados++; }
        });
        msgPainel = { ts: Date.now(), txt: marcados + ' marcado(s), ' + desmarcados + ' desmarcado(s). Revise e confirme no ' + NOME_CANAL + '.' };
        atualizaPainel();
    }

    function abrirPainel() {
        try { chrome.runtime.sendMessage({ acao: 'abrir_painel' }); } catch (e) {}
    }

    ui();
    uiRoot.addEventListener('click', e => {
        const a = e.target.closest && e.target.closest('#pnl [data-a]');
        if (!a) return;
        const acao = a.getAttribute('data-a');
        if (acao === 'ocultar') { painelOculto = true; atualizaPainel(); }
        else if (acao === 'mostrar') { painelOculto = false; atualizaPainel(); }
        else if (acao === 'marcar') marcarLucrativos();
        else if (acao === 'painel') abrirPainel();
    });

    // ── Varredura ─────────────────────────────────────────────────────────────────────────────
    async function varrer() {
        if (!rotaOk()) { atualizaPainel(); return; }
        const ancoras = achaAncoras();
        const novas = [];
        ancoras.forEach((el, id) => {
            const chave = SHC.chave(CANAL, id);
            let it = itens.get(chave);
            if (!it) { it = { id }; itens.set(chave, it); }
            it.ancora = el;
            it.linha = linhaDe(el);
            it.precos = precosDe(it.linha);
            if (!it.titulo) it.titulo = tituloDe(el, it.linha);
            const alvo = el.closest('a') || el;
            // Lista que recicla linhas (rolagem virtual): a etiqueta ao lado pode ser de outro anúncio.
            const vizinha = alvo.nextElementSibling;
            if (vizinha && vizinha.hasAttribute && vizinha.hasAttribute('data-shc-host') && vizinha.getAttribute('data-shc-host') !== chave) vizinha.remove();
            if (!it.host || !it.host.isConnected) {
                it.host = criaEtiqueta(chave);
                alvo.insertAdjacentElement('afterend', it.host);
            }
            if (!custos.has(chave)) novas.push(chave);
        });
        // Anúncio que saiu da tela perde a etiqueta.
        itens.forEach((it, chave) => {
            if (!ancoras.has(it.id) && it.host) { it.host.remove(); it.host = null; }
        });
        if (novas.length) {
            const lidos = await SHC.lerCustos(novas);
            novas.forEach(k => custos.set(k, lidos[k] || null));
        }
        itens.forEach((it, chave) => { if (it.host && it.host.isConnected) pintaEtiqueta(chave); });
        atualizaPainel();
        if (janelaAberta) desenhaJanela(false);
        gravaVistos(ancoras);
    }

    // Lembra os anúncios vistos (título/preço) pra montar a planilha de custos no painel.
    async function gravaVistos(ancoras) {
        const lote = {};
        ancoras.forEach((el, id) => {
            const k = SHC.chaveVisto(CANAL, id);
            if (vistosGravados.has(k)) return;
            const it = itens.get(SHC.chave(CANAL, id));
            lote[k] = { titulo: (it && it.titulo) || '', preco: it && it.precos.length ? it.precos[it.precos.length - 1] : null, visto: Date.now() };
            vistosGravados.add(k);
        });
        if (Object.keys(lote).length) { try { await chrome.storage.local.set(lote); } catch (e) {} }
    }

    let tVarrer = null;
    const agenda = (ms) => { clearTimeout(tVarrer); tVarrer = setTimeout(varrer, ms); };
    const ehNosso = n => n && n.nodeType === 1 && (n.hasAttribute('data-shc-host') || n.hasAttribute('data-shc-ui'));
    new MutationObserver(muts => {
        for (const m of muts) {
            const alvo = m.target.nodeType === 1 ? m.target : m.target.parentElement;
            if (!alvo || alvo === uiHost || (alvo.closest && alvo.closest('[data-shc-host],[data-shc-ui]'))) continue;
            // Só as nossas etiquetas entrando/saindo não é mudança da página.
            if (m.type === 'childList' && [...m.addedNodes, ...m.removedNodes].every(ehNosso)) continue;
            agenda(700);
            return;
        }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });

    // O seller digitou um preço promocional na página → recalcula aquela linha.
    document.addEventListener('input', e => {
        const t = e.target;
        if (!t || !t.closest || t.closest('[data-shc-host],[data-shc-ui]')) return;
        if (/checkbox|radio/i.test(t.type || '')) return;   // marcar caixa não muda preço
        agenda(300);
    }, true);

    chrome.storage.onChanged.addListener((mud, area) => {
        if (area !== 'local') return;
        let repinta = false;
        for (const k in mud) {
            if (k === 'cfg') { cfg = Object.assign({}, SHC.PADRAO, mud.cfg.newValue || {}); repinta = true; }
            else if (k.indexOf('c|' + CANAL + '|') === 0) { custos.set(k, mud[k].newValue || null); repinta = true; }
        }
        if (repinta) { itens.forEach((it, chave) => pintaEtiqueta(chave)); atualizaPainel(); if (janelaAberta) desenhaJanela(false); }
    });
    window.addEventListener('resize', () => { if (janelaAberta) desenhaJanela(false); });

    SHC.lerCfg().then(c => { cfg = c; varrer(); });
})();
