// Copiloto · TikTok Shop — etiquetas de lucro DENTRO do Seller Center (Produtos › Gerenciar produtos). 3.3.1.
// Só LÊ a página e INSERE elementos próprios (classe shc-tt-tag). Nunca clica, preenche nem envia nada do TikTok; não chama o TikTok.
// Os chips são calculados no FUNDO (SHC.tt.chipPreco/etiquetas: comissão do TikTok + SFP da tabela do núcleo + a comissão de afiliado
// do produto; custo e imposto da seller) e chegam pela mensagem {acao:'tiktok_etiqueta', loja}. O frete da entrega não entra na conta
// (o TikTok mede o peso depois da entrega) — a dica da etiqueta diz isso.
// Registrado pelo fundo (SHC.tt.sincronizarScripts) só com o TikTok ligado em Ajustes e o consentimento gravado, junto dos scripts de leitura.
// O topo do arquivo não toca no DOM: as funções SHC.ttTela* são puras e rodam em node (tests/copiloto/teste_tiktok_tela.js).
(function (root) {
    'use strict';
    const SHC = root.SHC || (root.SHC = {});

    // ── Lógica pura (testada em node) ─────────────────────────────────────────────────────────────────────────────

    /** Só Gerenciar produtos ganha etiqueta: '/product/manage' → 'produtos'; as outras telas → null. */
    SHC.ttTelaDe = function (url) {
        let p = '';
        try { p = new URL(url).pathname; } catch (e) { return null; }
        return /^\/product\/manage\/?$/.test(p) ? 'produtos' : null;
    };
    /** A loja da URL (oec_seller_id, o mesmo critério do tiktok-pagina.js) → os dígitos | null. */
    SHC.ttTelaLoja = function (url) {
        try { const v = new URL(url).searchParams.get('oec_seller_id'); return v && /^\d{5,25}$/.test(v) ? v : null; } catch (e) { return null; }
    };
    /** "R$ 1.234,56" num texto → 1234.56 | null. */
    SHC.ttTelaPreco = function (txt) {
        const m = /R\$\s*([\d.]+,\d{2})/.exec(String(txt == null ? '' : txt));
        if (!m) return null;
        const v = Number(m[1].replace(/\./g, '').replace(',', '.'));
        return isFinite(v) && v > 0 && v < 1e7 ? Math.round(v * 100) / 100 : null;
    };
    /** O valor de um CAMPO da tela ("849,90" ou "849.90"; "1.234" = mil) → número | null. Só lê, nunca escreve no campo. */
    SHC.ttTelaPrecoCampo = function (txt) {
        const t = String(txt == null ? '' : txt).trim();
        if (!t || !/^[\d.,]+$/.test(t)) return null;
        let v;
        if (t.indexOf(',') >= 0 && t.indexOf('.') >= 0) v = Number(t.replace(/\./g, '').replace(',', '.'));
        else if (t.indexOf(',') >= 0) v = Number(t.replace(',', '.'));
        else if (/^\d{1,3}(\.\d{3})+$/.test(t)) v = Number(t.replace(/\./g, ''));   // 1.234 = mil e duzentos
        else v = Number(t);
        return isFinite(v) && v > 0 && v < 1e7 ? Math.round(v * 100) / 100 : null;
    };
    /**
     * Qual etiqueta vai na linha: casa pelo SKU do vendedor; com o mesmo SKU em mais de um produto, o preço da linha (±1 centavo)
     * decide (retrato 03/10/2026: 20 SKUs aparecem em 2 produtos com preços diferentes). Mesmo SKU e mesmo preço com chips
     * diferentes (o afiliado dos 2 produtos difere), ou preço da linha que não casa com nenhum lido → null (melhor sem etiqueta
     * do que com a conta de outro produto).
     */
    SHC.ttTelaEscolhe = function (ets, sku, preco) {
        const mesmo = (ets || []).filter(e => e && e.sku === sku);
        if (!mesmo.length) return null;
        const iguais = lista => { const j = JSON.stringify(lista[0].chip); return lista.every(e => JSON.stringify(e.chip) === j) ? lista[0] : null; };
        if (preco > 0) {
            const exato = mesmo.filter(e => Math.abs(e.preco - preco) <= 0.011);
            return exato.length ? iguais(exato) : null;
        }
        return iguais(mesmo);
    };
    /**
     * Os elementos que mostram o SKU do vendedor (o MENOR elemento com esse texto: o TikTok desenha o SKU embaixo do nome da
     * variação). Sem achar o texto exato, vale o elemento curto que começa ou termina com o SKU (rótulo do lado, ex.: "SKU do
     * vendedor: X"). → [elemento] (vários = o mesmo SKU em mais de um produto na tela).
     */
    SHC.ttTelaAchaSku = function (doc, sku) {
        const alvo = String(sku || '').trim(), exatos = [], rotulo = [];
        if (!alvo || !doc) return exatos;
        const txt = el => String(el.textContent || '').replace(/\s+/g, ' ').trim();
        const anda = el => {
            const filhos = [].slice.call(el.children || []), t = txt(el);
            if (!t || t.indexOf(alvo) < 0) return;
            const dentro = filhos.filter(f => txt(f).indexOf(alvo) >= 0);
            if (dentro.length) { dentro.forEach(anda); return; }
            if (t === alvo) exatos.push(el);
            else if (t.length <= alvo.length + 24 && (t.endsWith(alvo) || t.indexOf(alvo) === 0)) rotulo.push(el);
        };
        anda(doc.body || doc);
        return exatos.length ? exatos : rotulo;
    };
    /**
     * Preço da variação na linha: o campo editável com o "R$" ao lado (o campo Preço; o de Estoque não tem "R$" no elemento pai)
     * vale primeiro; sem campo, o 1º "R$ …" do texto da linha. Só lê.
     */
    SHC.ttTelaPrecoDaLinha = function (linha) {
        const campos = linha && linha.querySelectorAll ? [].slice.call(linha.querySelectorAll('input')) : [];
        for (const c of campos) {
            const pai = c.parentElement;
            if (pai && /R\$/.test(String(pai.textContent || ''))) { const v = SHC.ttTelaPrecoCampo(c.value); if (v !== null) return v; }
        }
        return linha ? SHC.ttTelaPreco(linha.textContent) : null;
    };
    /**
     * A linha da variação: sobe do elemento do SKU até o 1º ancestral que mostra um preço (no máximo 8 níveis) E que não mistura
     * variações: um ancestral com o texto de 2 SKUs conhecidos (o contêiner do produto aberto, a lista inteira) não é a linha —
     * o 1º campo "R$" dele pode ser de OUTRA variação. → a linha | null.
     */
    SHC.ttTelaLinhaDaVariacao = function (elSku, skus) {
        let el = elSku, n = 0;
        while (el && n++ < 8) {
            if (SHC.ttTelaPrecoDaLinha(el) !== null) {
                const t = String(el.textContent || '');
                if ((skus || []).filter(s => s && t.indexOf(s) >= 0).length <= 1) return el;
            }
            el = el.parentElement;
        }
        return null;
    };
    /** Assinatura da etiqueta na linha (para não redesenhar a mesma): SKU | preço. */
    SHC.ttTelaAssinatura = et => et.sku + '|' + et.preco;

    // ── Só no navegador (document_idle), só em Gerenciar produtos ──────────────────────────────────────────────────
    if (typeof document === 'undefined' || typeof location === 'undefined' || !root.chrome || !root.chrome.runtime || !root.chrome.runtime.sendMessage) return;
    const CORES = {   // as mesmas cores da etiqueta do ML (ml-tela.css), inline: nenhum CSS da extensão é carregado no TikTok
        luc: 'background:#ECFDF5;color:#065F46;border:1px solid #A7F3D0',
        ate: 'background:#FFFBEB;color:#92400E;border:1px solid #FDE68A',
        pre: 'background:#FEF2F2;color:#991B1B;border:1px solid #FECACA',
        sem: 'background:#F1F5F9;color:#475569;border:1px dashed #94A3B8',
    };
    let dados = null, urlVista = '', pendente = 0;

    function desenha(elSku, linha, et) {
        const ass = SHC.ttTelaAssinatura(et), velha = linha.querySelector ? linha.querySelector('.shc-tt-tag') : null;
        if (velha) { if (velha.getAttribute('data-shc') === ass) return; velha.remove(); }
        const tag = document.createElement('span');
        tag.className = 'shc-tt-tag shc-tt-' + et.chip.cls;
        tag.setAttribute('data-shc', ass);
        tag.title = et.chip.dica || '';
        tag.textContent = et.chip.st + (et.chip.vl ? '  ' + et.chip.vl : '');
        tag.style.cssText = 'display:inline-block;margin:2px 0 0;padding:1px 8px;border-radius:10px;font:600 12px/18px sans-serif;white-space:nowrap;cursor:default;' + (CORES[et.chip.cls] || CORES.sem);
        if (elSku.parentElement) elSku.parentElement.insertBefore(tag, elSku.nextSibling);
    }

    function varre() {
        if (!dados || !dados.etiquetas || SHC.ttTelaDe(location.href) !== 'produtos') return;
        const skus = [];
        dados.etiquetas.forEach(e => { if (e.sku && skus.indexOf(e.sku) < 0) skus.push(e.sku); });
        skus.forEach(sku => {
            SHC.ttTelaAchaSku(document, sku).forEach(elSku => {
                if (elSku.closest && elSku.closest('.shc-tt-tag')) return;   // a nossa própria etiqueta não é âncora
                const linha = SHC.ttTelaLinhaDaVariacao(elSku, skus);
                if (!linha) return;
                const et = SHC.ttTelaEscolhe(dados.etiquetas, sku, SHC.ttTelaPrecoDaLinha(linha));
                if (et) desenha(elSku, linha, et);
            });
        });
    }

    function pede() {
        const loja = SHC.ttTelaLoja(location.href);
        if (!loja) { dados = null; return; }
        let p;
        try { p = chrome.runtime.sendMessage({ acao: 'tiktok_etiqueta', loja }); } catch (x) { return; }   // extensão recarregada: para quieto
        Promise.resolve(p).then(r => { if (r && r.ok && SHC.ttTelaLoja(location.href) === r.loja) { dados = r; varre(); } }, () => {});
    }

    // O Seller Center troca de tela sem recarregar (SPA): a troca de URL pede os chips de novo; as mutações só redesenham.
    function agenda() {
        if (pendente) return;
        pendente = setTimeout(() => {
            pendente = 0;
            if (location.href !== urlVista) {
                urlVista = location.href;
                if (SHC.ttTelaDe(urlVista) === 'produtos') pede(); else dados = null;
                return;
            }
            varre();
        }, 600);
    }

    if (SHC.ttTelaDe(location.href) === 'produtos') { urlVista = location.href; pede(); }
    try { new MutationObserver(agenda).observe(document.body || document.documentElement, { childList: true, subtree: true }); }
    catch (x) { /* sem MutationObserver: as etiquetas só não aparecem */ }
    // Anúncios relidos pela captura (a seller expandiu um produto): os chips chegam aos novos SKUs sem recarregar a tela.
    try {
        chrome.storage.onChanged.addListener((mud, onde) => {
            if (onde !== 'local' || !dados) return;
            if (Object.keys(mud).some(k => new RegExp('^tt(?:@\\d+)?:' + dados.loja + ':anuncios$').test(k))) pede();
        });
    } catch (x) { /* sem storage no content script: fica com a leitura da abertura */ }
})(typeof globalThis !== 'undefined' ? globalThis : this);
