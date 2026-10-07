// Copiloto · desenho da etiqueta de ganho nas listas de produtos dos outros canais (Shopee, TikTok Shop, Magalu). Mundo ISOLADO da extensão.
// Recebe a lista já calculada (SHC.etqDosProdutos: [{produto_id, nome, sku, skus, classe, texto, detalhe}]) e:
//   1) ao lado de cada produto da página, a etiqueta "Sobra R$ X · margem Y%" (ou "Informe o custo"), com a conta completa no título.
//      O produto é achado pelo texto que a própria lista mostra: o NOME do produto (Shopee, Magalu) ou o SKU (TikTok, que não manda o nome);
//   2) uma caixa no canto com todos os produtos da página: vale mesmo quando o canal muda a tela e a etiqueta da linha não acha lugar.
// A lista muda sem recarregar (paginação, filtro): um MutationObserver refaz as etiquetas que sumiram. Só DESENHA: não clica, não digita,
// não chama o canal e não lê nada da página além do texto onde procura o nome/SKU.
(function (w) {
    'use strict';
    if (!w || !w.document || w.__copilotoEtq) return;
    const d = w.document, ATTR = 'data-copiloto-etq', CAIXA = 'copiloto-etq-caixa';
    const COR = { lucrativo: ['#e6f4ea', '#137333'], apertado: ['#fef7e0', '#a05a00'], prejuizo: ['#fce8e6', '#c5221f'] }, NEUTRO = ['#f1f3f4', '#5f6368'];
    const cor = c => COR[c] || NEUTRO;
    const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const PULA = /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|INPUT|SELECT|OPTION|SVG|CANVAS|IFRAME)$/;
    let canal = '', itens = [], fechada = false, agendado = null, obs = null;

    // Texto da página que é deste produto: o nome inteiro (4+ letras) ou o SKU sozinho / depois de "SKU:" (2+ letras).
    // → 'nome' | 'sku' | '' (o nome manda: na linha que mostra o nome, o SKU não ganha outra etiqueta).
    function casa(txt, it) {
        const t = norm(txt);
        if (!t) return '';
        const n = norm(it.nome);
        if (n.length >= 4 && t === n) return 'nome';
        return (it.skus && it.skus.length ? it.skus : [it.sku]).some(s => { const k = norm(s); return k.length >= 2 && (t === k || new RegExp('(^|\\s|:)' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$').test(t)); }) ? 'sku' : '';
    }
    function etiqueta(it) {
        const [fundo, letra] = cor(it.classe), s = d.createElement('span');
        s.setAttribute(ATTR, it.produto_id);
        s.textContent = it.texto;
        s.title = 'Copiloto · ' + it.texto + (it.detalhe && it.detalhe !== it.texto ? '\n' + it.detalhe : '') + (it.classe === 'sem_custo' ? '\nCadastre o custo pelo SKU no painel do Copiloto.' : '');
        s.style.cssText = 'display:inline-block;margin:2px 0 2px 6px;padding:1px 6px;border-radius:10px;font:600 11px/16px system-ui,sans-serif;white-space:nowrap;'
            + 'background:' + fundo + ';color:' + letra + ';border:1px solid ' + letra + '33;vertical-align:middle;cursor:help';
        return s;
    }
    // Uma etiqueta por produto e por lugar: depois do elemento que mostra o nome/SKU (até 3 lugares: variações que repetem o SKU).
    function desenhaLinhas() {
        if (!d.body || !itens.length) return 0;
        const achados = new Map(), tw = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT, {
            acceptNode: n => {
                const p = n.parentElement;
                if (!p || PULA.test(p.tagName) || p.closest('[' + ATTR + '],#' + CAIXA)) return NodeFilter.FILTER_REJECT;
                return n.nodeValue && n.nodeValue.trim().length >= 2 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
            } });
        for (let n = tw.nextNode(); n; n = tw.nextNode()) {
            for (const it of itens) {
                const tipo = casa(n.nodeValue, it);
                if (!tipo) continue;
                const a = achados.get(it) || { nome: [], sku: [] };
                if (a[tipo].length < 3) a[tipo].push(n.parentElement);
                achados.set(it, a);
                break;
            }
        }
        let postas = 0;
        achados.forEach((a, it) => (a.nome.length ? a.nome : a.sku).forEach(el => {
            const prox = el.nextElementSibling;
            if (prox && prox.getAttribute(ATTR) === it.produto_id && prox.textContent === it.texto) return;   // já está
            if (prox && prox.hasAttribute(ATTR)) prox.remove();   // de uma lista anterior
            el.insertAdjacentElement('afterend', etiqueta(it));
            postas++;
        }));
        return postas;
    }
    function desenhaCaixa() {
        let cx = d.getElementById(CAIXA);
        if (!itens.length || !d.body) { if (cx) cx.remove(); return; }
        if (!cx) {
            cx = d.createElement('div');
            cx.id = CAIXA;
            cx.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;max-width:360px;max-height:50vh;overflow:auto;background:#fff;'
                + 'border:1px solid #dadce0;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.15);font:12px/1.4 system-ui,sans-serif;color:#202124';
            d.body.appendChild(cx);
        }
        const semCusto = itens.filter(i => i.classe === 'sem_custo').length;
        cx.textContent = '';
        const cab = d.createElement('div');
        cab.style.cssText = 'display:flex;gap:8px;align-items:center;padding:8px 10px;font-weight:700;cursor:pointer;position:sticky;top:0;background:#fff';
        const tit = d.createElement('span');
        tit.textContent = 'Copiloto · sobra por produto (' + itens.length + ')' + (fechada ? ' ▸' : ' ▾');
        tit.style.flex = '1';
        const x = d.createElement('button');
        x.type = 'button'; x.textContent = '×'; x.title = 'Esconder nesta página';
        x.style.cssText = 'border:0;background:none;font-size:16px;line-height:1;cursor:pointer;color:#5f6368';
        x.addEventListener('click', e => { e.stopPropagation(); cx.remove(); itensEscondidos = true; });
        cab.addEventListener('click', () => { fechada = !fechada; desenhaCaixa(); });
        cab.append(tit, x);
        cx.appendChild(cab);
        if (fechada) return;
        const ul = d.createElement('ul');
        ul.style.cssText = 'list-style:none;margin:0;padding:0 10px 8px';
        itens.forEach(it => {
            const li = d.createElement('li'), [fundo, letra] = cor(it.classe);
            li.style.cssText = 'padding:4px 0;border-top:1px solid #f1f3f4';
            const nome = d.createElement('div');
            nome.textContent = it.nome || it.sku || 'Produto ' + it.produto_id;
            nome.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
            const v = d.createElement('span');
            v.textContent = it.texto;
            v.title = it.detalhe || it.texto;
            v.style.cssText = 'display:inline-block;padding:0 6px;border-radius:10px;font-weight:600;background:' + fundo + ';color:' + letra;
            li.append(nome, v);
            ul.appendChild(li);
        });
        cx.appendChild(ul);
        if (semCusto) {
            const p = d.createElement('div');
            p.textContent = semCusto + (semCusto === 1 ? ' produto sem custo' : ' produtos sem custo') + ': cadastre pelo SKU no painel do Copiloto (Custos).';
            p.style.cssText = 'padding:0 10px 8px;color:#5f6368';
            cx.appendChild(p);
        }
    }
    let itensEscondidos = false;
    function refaz() {
        agendado = null;
        if (!obs) return;
        obs.disconnect();
        try { desenhaLinhas(); if (!itensEscondidos) desenhaCaixa(); } finally { obs.observe(d.body, { childList: true, subtree: true, characterData: true }); }
    }
    const agenda = () => { if (!agendado) agendado = setTimeout(refaz, 400); };

    w.__copilotoEtq = {
        /** Mostra a lista calculada do canal (substitui a anterior). */
        mostra(c, lista) {
            // document_start: a lista pode chegar antes do <body>; desenha quando a página estiver pronta
            if (!d.body) { d.addEventListener('DOMContentLoaded', () => w.__copilotoEtq.mostra(c, lista), { once: true }); return; }
            canal = String(c || '');
            itens = (Array.isArray(lista) ? lista : []).filter(i => i && i.produto_id && i.texto);
            d.querySelectorAll('[' + ATTR + ']').forEach(e => { if (!itens.some(i => i.produto_id === e.getAttribute(ATTR))) e.remove(); });
            if (!obs && d.body) obs = new MutationObserver(ms => { if (ms.some(m => [...m.addedNodes, ...m.removedNodes].some(n => !(n.nodeType === 1 && (n.hasAttribute(ATTR) || n.id === CAIXA))))) agenda(); });
            if (obs) { obs.disconnect(); obs.observe(d.body, { childList: true, subtree: true, characterData: true }); }
            refaz();
        },
        /** Tira tudo (o canal foi desligado em Ajustes). */
        limpa() { itens = []; if (obs) obs.disconnect(); obs = null; d.querySelectorAll('[' + ATTR + ']').forEach(e => e.remove()); const cx = d.getElementById(CAIXA); if (cx) cx.remove(); },
        _casa: casa, _canal: () => canal,
    };
})(typeof window !== 'undefined' ? window : null);
