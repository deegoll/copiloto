// Teste do adaptador da lista de produtos da Shopee (shopee-lista.js) com uma página INVENTADA que imita a estrutura real vista no Seller Center
// (07/10/2026): preço simples, promoção (preço riscado), faixa, SKU vazio, produto com variações, linha sem preço renderizado. Sem DOM de verdade:
// um DOM falso mínimo (só o que o adaptador usa). Rodar: node tests/copiloto/teste_shopee_lista.js
'use strict';
const fs = require('fs'), path = require('path');
let falhas = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) falhas++; };

// ── DOM falso mínimo ──
class El {
    constructor(tag, cls, filhos) { this.tag = tag; this.cls = (cls || '').split(' ').filter(Boolean); this.kids = []; this.parentElement = null; (filhos || []).forEach(f => this.add(f)); }
    add(f) { if (typeof f === 'string') f = { txt: f }; if (f.parentElement !== undefined) f.parentElement = this; this.kids.push(f); return this; }
    get classList() { return { contains: c => this.cls.indexOf(c) >= 0 }; }
    get children() { return this.kids.filter(k => k instanceof El); }
    get textContent() { return this.kids.map(k => (k instanceof El ? k.textContent : k.txt)).join(''); }
    get parentNode() { return this.parentElement; }
    remove() { const p = this.parentElement; if (p) p.kids = p.kids.filter(k => k !== this); }
    cloneNode() { const c = new El(this.tag, this.cls.join(' ')); this.kids.forEach(k => c.add(k instanceof El ? k.cloneNode() : { txt: k.txt })); return c; }
    desc() { return this.children.reduce((a, k) => a.concat([k], k.desc()), []); }
    querySelectorAll(sel) { const ss = sel.split(',').map(x => x.trim()); return this.desc().filter(e => ss.some(x => casa(e, x))); }   // na ordem do documento, como o navegador
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
const simples = (e, s) => s.split(/(?=:)|(?=\.(?![^(]*\)))/).every(p => p[0] === '.' ? e.cls.indexOf(p.slice(1)) >= 0 : p.startsWith(':not(.') ? e.cls.indexOf(p.slice(6, -1)) < 0 : p === ':first-child' ? !e.parentElement || e.parentElement.children[0] === e : p === e.tag);
function casa(e, sel) {   // "a b > c": do fim para o começo, com recursão
    const t = sel.replace(/\s*>\s*/g, ' > ').split(' ');
    const de = (el, i) => {
        if (!el || !simples(el, t[i])) return false;
        if (i === 0) return true;
        if (t[i - 1] === '>') return de(el.parentElement, i - 2);
        for (let p = el.parentElement; p; p = p.parentElement) if (de(p, i - 1)) return true;
        return false;
    };
    return de(e, t.length - 1);
}
const T = (cls, txt) => new El('div', cls, [txt]);
const precoBloco = (cls, span, riscado, promo) => new El('div', cls, [new El('div', '', [new El('span', '', [span]), ...(promo ? [new El('div', 'eds-popper', [new El('div', 'promotion', [new El('div', 'price', [new El('div', 'value', [new El('div', '', [promo])])])])])] : []), ...(riscado ? [new El('del', '', [riscado])] : [])])]);
const produto = (nome, sku, preco) => new El('div', 'product-variation-item', [new El('div', 'product-main', [new El('p', 'product-name-wrap', [nome]), T('product-sku', sku === null ? '' : 'SKU principal: ' + sku)]), ...(preco ? [preco] : [])]);
const variacao = (nome, sku, preco) => new El('div', 'model-list-item', [T('variation-name-info-name', nome), T('variation-name-info-sku', 'SKU da Variação: ' + sku), preco]);
const grupo = (...f) => new El('div', '', f);

const pagina = new El('div', 'product-list-container', [
    grupo(produto('Tripé simples', 'TPN-1', precoBloco('list-view-price', 'R$494,00', 'R$519,99', 'R$494,00'))),   // promoção: vale o de venda, não o riscado
    grupo(produto('Sem sku', null, precoBloco('list-view-price', 'R$1.209,50'))),                                  // milhar com ponto, SKU vazio
    grupo(produto('Mãe com faixa', 'MAE-1', precoBloco('list-view-price', 'R$204,99 - R$279,99', null, 'R$194,75 - R$266,00')),
        new El('div', 'view-more', [variacao('25 CM', 'V-25', precoBloco('list-view-model-price', 'R$224,99')), variacao('20 CM', 'V-20', precoBloco('list-view-model-price', 'R$204,25', 'R$214,99'))]),
        new El('div', 'product-variation-item product-more-models', ['Ver Mais'])),                                  // botão: não é linha
    grupo(produto('Preço não renderizado ainda', 'LAZY-1', null)),
]);
const corpo = new El('body', '', [pagina]);
global.document = { querySelectorAll: s => corpo.querySelectorAll(s) };
global.location = { href: 'https://seller.shopee.com.br/portal/product/list/all?x=1' };
let cfg = null;
global.SHC = { etiquetaCanal: { iniciar: c => { cfg = c; } } };
require(path.join(__dirname, '../../extension-copiloto/shopee-lista.js'));

ok(cfg && cfg.canal === 'shopee', 'chama etiquetaCanal.iniciar com canal shopee');
ok(cfg.urlOk() && !(global.location.href = 'https://seller.shopee.com.br/portal/order/list', cfg.urlOk()), 'urlOk: só a lista de produtos');
const L = cfg.linhas(), R = L.map(cfg.ler);
ok(L.length === 6, 'linhas: 4 produtos + 2 variações, sem o botão "Ver Mais" (' + L.length + ')');
ok(R[0].preco === 494 && R[0].sku === 'TPN-1' && !R[0].faixa && R[0].titulo === 'Tripé simples' && !!R[0].ancora, 'promoção: 494 (não o riscado 519,99), SKU e âncora');
ok(R[1].preco === 1209.5 && R[1].sku === '', 'milhar "R$1.209,50" → 1209,5; SKU vazio fica ""');
ok(R[2].faixa === true && R[2].preco === 194.75 && R[2].itens.length === 2, 'mãe com faixa: menor (inclui o promocional do balão), faixa:true, 2 itens');
ok(JSON.stringify(R[2].itens) === JSON.stringify([{ preco: 224.99, sku: 'V-25' }, { preco: 204.25, sku: 'V-20' }]), 'itens com preço e SKU da variação (preço riscado fora)');
ok(R[3].sku === 'V-25' && R[3].preco === 224.99 && R[4].preco === 204.25, 'linha de variação: SKU da Variação e preço próprios');
ok(R[5] === null || R[5] === undefined, 'linha sem preço renderizado → null (o motor mostra "preço não lido")');
console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nTUDO OK');
process.exit(falhas ? 1 : 0);
