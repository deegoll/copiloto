// Copiloto 3.4.0 · Magalu — etiqueta de ganho na lista "Catálogo de produtos" (https://seller.magalu.com/products).
// Só LÊ o que a tela já mostra (preço e SKU de cada cartão) e entrega ao motor (etiqueta-canal.js), que desenha a etiqueta.
// Nunca clica, escreve nem pede nada à rede. Estrutura vista ao vivo em 07/10/2026:
//   cartão   = div com classe contendo "table--display-TableRow" (o hash da classe muda, esse trecho é estável; a tela pagina de 10 em 10)
//   SKU      = <p>SKU</p> seguido do irmão <span><p>VALOR</p></span> (o EAN vem em outro par "EAN"/valor)
//   preço    = bloco com classe "product-price-…"; com promoção mostra 2 valores: o de lista RISCADO (line-through) e o vigente.
// Regra do preço: vale o valor NÃO riscado; se houver mais de um não riscado, o MENOR. Tudo riscado ou sem valor → null ("preço não lido").
(function () {
    'use strict';
    const G = typeof window !== 'undefined' ? window : globalThis;
    const SHC = G.SHC;
    if (!SHC || !SHC.etiquetaCanal || typeof SHC.etiquetaCanal.iniciar !== 'function') return;
    const doc = () => G.document;
    const PRECO = /^R\$\s*(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/;
    const txt = e => String((e && e.textContent) || '').replace(/\s+/g, ' ').trim();
    const reais = s => { const m = PRECO.exec(s); return m ? parseFloat(m[1].replace(/\./g, '') + '.' + m[2]) : null; };
    function riscado(e) {   // o preço de lista com promoção vem com text-decoration: line-through (ou dentro de <s>/<del>)
        try {
            for (let a = e, k = 0; a && k < 3; a = a.parentElement, k++) {
                if (/^(S|DEL|STRIKE)$/i.test(a.tagName || '')) return true;
                const cs = G.getComputedStyle ? G.getComputedStyle(a) : null;
                if (cs && /line-through/.test(cs.textDecorationLine || cs.textDecoration || '')) return true;
            }
        } catch (x) { /* sem estilo: trata como não riscado */ }
        return false;
    }
    function linhas() {
        const d = doc();
        if (!d || !d.querySelectorAll) return [];
        // só o cartão mais interno que tem preço (o mesmo critério do mapeamento ao vivo)
        return Array.from(d.querySelectorAll('[class*="table--display-TableRow"]')).filter(e => /R\$\s*\d/.test(txt(e)));
    }
    function ler(linha) {
        if (!linha || !linha.querySelectorAll) return null;
        const ps = Array.from(linha.querySelectorAll('p'));
        const bloco = linha.querySelector('[class*="product-price"]');
        const cand = (bloco ? Array.from(bloco.querySelectorAll('p')) : ps).filter(p => reais(txt(p)) !== null && !riscado(p));
        if (!cand.length) return null;
        let ancora = cand[0], preco = reais(txt(cand[0]));
        cand.forEach(p => { const v = reais(txt(p)); if (v < preco) { preco = v; ancora = p; } });
        const rot = ps.find(p => txt(p) === 'SKU');
        const val = rot && rot.nextElementSibling;
        const sku = val ? txt(val) : '';
        const a = linha.querySelector('a');
        return { preco, sku: /^(-|—|SKU)?$/.test(sku) ? '' : sku, titulo: txt(a), ancora };
    }
    SHC.magaluLista = { linhas, ler, reais };
    SHC.etiquetaCanal.iniciar({ canal: 'magalu', urlOk: () => /^https:\/\/seller\.magalu\.com\/products(\/|\?|#|$)/.test(String(G.location && G.location.href)), linhas, ler });
})();
