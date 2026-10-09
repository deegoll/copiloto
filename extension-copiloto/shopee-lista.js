// Copiloto 3.4.0 — adaptador da lista "Meus produtos" do Seller Center da Shopee (seller.shopee.com.br/portal/product/list/...).
// Só LÊ o que a tela já mostra e entrega ao motor (etiqueta-canal.js). Seletores conferidos ao vivo em 07/10/2026; usei as classes SEMÂNTICAS
// da Shopee (product-variation-item, model-list-item, list-view-price...), não as de CSS-modules com hash (src-components-…--2mffS), que mudam a cada versão.
// Linhas: 1 por produto (".product-variation-item", menos o botão "Ver Mais") + 1 por variação (".model-list-item", só as já abertas na tela).
// Preço: o de VENDA atual = o menor R$ do bloco de preço, sem o preço riscado (<del>) e sem o balão da promoção; o balão ("Preço promocional") entra só
//        para baixar o preço (a linha-mãe com faixa mostra a faixa ORIGINAL; o promocional real está no balão). Faixa "R$ a - R$ b" → menor + faixa:true.
// SKU: produto = "SKU principal"; variação = "SKU da Variação". Produto com variações abertas leva itens:[{preco,sku}] de cada uma.
// Não aparece na lista: variações atrás de "Ver Mais" (só depois de abrir), e produto sem SKU principal vem com sku ''.
(function (root) {
    'use strict';
    const SHC = root.SHC || (root.SHC = {});
    const URL_OK = /^https:\/\/seller\.shopee\.com\.br\/portal\/product\/list\//;
    const reais = txt => [...String(txt || '').matchAll(/R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/g)].map(m => parseFloat(m[1].replace(/\./g, '').replace(',', '.')));
    const texto = (el, sel) => { const e = el.querySelector(sel); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; };
    const depois = (t, rotulo) => (t.indexOf(rotulo) === 0 ? t.slice(rotulo.length).trim() : '');
    function preco(bloco) {
        if (!bloco) return null;
        const c = bloco.cloneNode(true);
        c.querySelectorAll('del, .eds-popper, svg').forEach(e => e.remove());
        let v = reais(c.textContent);
        if (!v.length) return null;
        const faixa = v.length > 1;
        bloco.querySelectorAll('.promotion .price .value > div:first-child').forEach(e => { v = v.concat(reais(e.textContent)); });
        return { preco: Math.min.apply(null, v), faixa };
    }
    function variacao(m) {
        const p = preco(m.querySelector('.list-view-model-price')), a = m.querySelector('.list-view-model-price');
        return p && { preco: p.preco, faixa: p.faixa, sku: depois(texto(m, '.variation-name-info-sku'), 'SKU da Variação:'), titulo: texto(m, '.variation-name-info-name'), ancora: a };
    }
    function ler(linha) {
        if (linha.classList.contains('model-list-item')) return variacao(linha);
        const a = linha.querySelector('.list-view-price'), p = preco(a);
        const itens = [...(linha.parentElement ? linha.parentElement.querySelectorAll('.model-list-item') : [])].map(variacao).filter(Boolean);
        if (!p && !itens.length) return null;
        const r = { preco: p ? p.preco : Math.min.apply(null, itens.map(i => i.preco)), faixa: !!(p && p.faixa), sku: depois(texto(linha, '.product-sku'), 'SKU principal:'), titulo: texto(linha, '.product-name-wrap'), ancora: a };
        if (itens.length) { r.itens = itens.map(i => ({ preco: i.preco, sku: i.sku })); r.preco = Math.min(r.preco, Math.min.apply(null, itens.map(i => i.preco))); }
        return r;
    }
    const linhas = () => [...document.querySelectorAll('.product-list-container .product-variation-item:not(.product-more-models), .product-list-container .model-list-item')];
    SHC.shopeeLista = { reais, ler, linhas, URL_OK };
    if (root.SHC.etiquetaCanal && root.SHC.etiquetaCanal.iniciar) root.SHC.etiquetaCanal.iniciar({ canal: 'shopee', urlOk: () => URL_OK.test(location.href), linhas, ler });
})(typeof window !== 'undefined' ? window : globalThis);
