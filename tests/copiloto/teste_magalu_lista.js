// Adaptador da lista de produtos da Magalu (magalu-lista.js) com uma página INVENTADA que imita a estrutura vista ao vivo em 07/10/2026:
// cartão "table--display-TableRow", <p>SKU</p> + <span><p>valor</p></span>, bloco "product-price-…" com preço de lista riscado na promoção.
// DOM falso mínimo (só o que o adaptador usa). Rodar: node tests/copiloto/teste_magalu_lista.js
'use strict';
const path = require('path');
let falhas = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) falhas++; };

class El {
    constructor(tag, cls, filhos) { this.tagName = tag.toUpperCase(); this.cls = cls || ''; this.kids = []; this.parentElement = null; (filhos || []).forEach(f => this.add(f)); }
    add(f) { if (typeof f === 'string') f = { txt: f }; if (f instanceof El) f.parentElement = this; this.kids.push(f); return this; }
    get children() { return this.kids.filter(k => k instanceof El); }
    get textContent() { return this.kids.map(k => (k instanceof El ? k.textContent : k.txt)).join(''); }
    get nextElementSibling() { const c = this.parentElement ? this.parentElement.children : []; return c[c.indexOf(this) + 1] || null; }
    desc() { return this.children.reduce((a, k) => a.concat([k], k.desc()), []); }
    querySelectorAll(sel) {
        const m = /^\[class\*="([^"]+)"\]$/.exec(sel);
        return this.desc().filter(e => (m ? e.cls.indexOf(m[1]) >= 0 : e.tagName === sel.toUpperCase()));
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
const P = t => new El('p', '', [t]);
const sku = v => new El('div', '', [P('SKU'), new El('span', '', [P(v)])]);
const preco = (...vs) => new El('div', 'product-price-x1', vs.map(v => (v[0] === '~' ? new El('s', '', [P(v.slice(1))]) : P(v))));
const cartao = (titulo, s, p) => new El('div', 'table--display-TableRow-ab12', [new El('a', '', [titulo]), sku(s), p]);
const cartoes = [
    cartao('Cadeira simples', 'CAD-1', preco('R$ 1.299,90')),
    cartao('Com promoção', 'PROMO-1', preco('~R$ 200,00', 'R$ 149,90')),          // vale o NÃO riscado
    cartao('Sem SKU', '-', preco('R$ 59,90')),                                     // SKU "-" vira ''
    cartao('Sem preço lido', 'X-9', preco('~R$ 80,00')),                           // tudo riscado → null
];
const corpo = new El('body', '', [new El('div', '', cartoes), new El('div', 'table--display-TableRow-zz', ['Cabeçalho sem preço'])]);
global.document = { querySelectorAll: s => corpo.querySelectorAll(s) };
global.location = { href: 'https://seller.magalu.com/products?page=1' };
let cfg = null;
global.SHC = { etiquetaCanal: { iniciar: c => { cfg = c; } } };
require(path.join(__dirname, '../../extension-copiloto/magalu-lista.js'));

ok(cfg && cfg.canal === 'magalu', 'chama etiquetaCanal.iniciar com canal magalu');
ok(cfg.urlOk() && !(global.location.href = 'https://seller.magalu.com/pedidos', cfg.urlOk()), 'urlOk: só /products');
const L = cfg.linhas(), R = L.map(cfg.ler);
ok(L.length === 4, 'linhas: os 4 cartões com preço (o cabeçalho sem preço fica fora)');
ok(R[0].preco === 1299.9 && R[0].sku === 'CAD-1' && R[0].titulo === 'Cadeira simples' && R[0].ancora.textContent === 'R$ 1.299,90', 'milhar com ponto e vírgula decimal: 1299,90; SKU e âncora no preço');
ok(R[1].preco === 149.9 && R[1].ancora.textContent === 'R$ 149,90', 'promoção: vale o preço não riscado (149,90), nunca o de lista');
ok(R[2].preco === 59.9 && R[2].sku === '', 'SKU "-" vira vazio (o motor diz "SKU não lido")');
ok(R[3] === null, 'só preço riscado: não lido (null), nunca 0');
console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nTUDO OK');
process.exitCode = falhas ? 1 : 0;
