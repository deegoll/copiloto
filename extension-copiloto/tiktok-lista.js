// Copiloto 3.4.0 — adaptador do TikTok Shop (Gerenciar produtos) para SHC.etiquetaCanal. Só LÊ o DOM (preço e SKU que a tela já mostra).
// Estrutura vista ao vivo: tabela Arco, uma tr.core-table-tr por produto (td do produto + td "Preço de varejo"); produto com variações tem logo
// depois uma tr.core-table-expand-content ("N SKUs · Expandir"); expandida, traz tr[class*=_skuRow_] com SKU, nome e preço (input readonly).
(function (root) {
    'use strict';
    const SHC = root.SHC;
    if (!SHC || !SHC.etiquetaCanal) return;
    const doc = () => root.document;
    const num = s => SHC.num(String(s || '').replace(/R\$/g, '').trim());
    const precos = t => (String(t || '').match(/\d[\d.]*,\d{2}/g) || []).map(num).filter(n => n != null && n > 0);
    const txt = e => ((e && e.textContent) || '').replace(/\s+/g, ' ').trim();

    // Coluna do preço = a do cabeçalho "Preço de varejo" (não depende de classe gerada); sem cabeçalho, a última com R$.
    function colPreco(tr) {
        const t = tr.closest('table'), ths = t ? [...t.querySelectorAll('th')] : [];
        const i = ths.findIndex(th => /pre[çc]o/i.test(txt(th)));
        return i >= 0 ? i : -1;
    }
    const temVariacoes = tr => { const n = tr.nextElementSibling; return !!(n && n.classList.contains('core-table-expand-content') && n.querySelector('[class*=_totalCount_]')); };

    function linhas() {
        const d = doc(); if (!d) return [];
        const out = [];
        d.querySelectorAll('tr.core-table-tr').forEach(tr => {
            if (tr.classList.contains('core-table-expand-content')) { out.push(...tr.querySelectorAll('tr[class*=_skuRow_]')); return; }
            if (tr.querySelectorAll('td').length < 5 || !/R\$\s*\d/.test(tr.textContent) || temVariacoes(tr)) return;   // mãe com variações: a etiqueta vai em cada SKU
            out.push(tr);
        });
        return out;
    }

    function ler(tr) {
        if (tr.matches('[class*=_skuRow_]')) {   // variação expandida: SKU e preço próprios
            const inp = tr.querySelector('[class*=_price_] input'), preco = inp && (parseFloat(inp.getAttribute('aria-valuenow')) || num(inp.value));
            const sku = txt(tr.querySelector('.text-neutral-text3'));
            if (!(preco > 0)) return null;
            return { preco, sku, titulo: txt(tr.querySelector('p')), ancora: inp.closest('[class*=_price_]') || inp };
        }
        const tds = [...tr.querySelectorAll('td')], i = colPreco(tr);
        let cel = i >= 0 ? tds[i] : null, ps = cel ? precos(cel.textContent) : [];
        if (!ps.length) for (let k = tds.length - 1; k >= 0 && !ps.length; k--) { ps = precos(tds[k].textContent); cel = tds[k]; }
        if (!ps.length) return null;
        const alvo = cel.querySelector('[class*=_salePrice_]') || cel.querySelector('div') || cel;
        const prod = tds.find(td => /ID:\s*\d/.test(td.textContent)) || tr;
        const m = /SKU do vendedor:\s*([^\s]+)/i.exec(prod.textContent);
        const r = { preco: Math.min(...ps), sku: m ? m[1] : '', titulo: txt(prod.querySelector('[translate=no]')), ancora: alvo };
        if (ps.length > 1) r.faixa = true;
        return r;
    }

    SHC.etiquetaCanal.iniciar({
        canal: 'tiktok',
        urlOk: () => /^https:\/\/seller-br\.tiktok\.com\/product\/manage/.test(String(root.location && root.location.href)),
        linhas, ler,
    });
})(typeof globalThis !== 'undefined' ? globalThis : this);
