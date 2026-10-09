// node tests/copiloto/teste_tiktok_lista.js — adaptador do TikTok: HTML inventado que imita a tabela real de "Gerenciar produtos" (sem dado da loja).
require('./relogio').fixar();
const assert = require('assert');
require('../../extension-copiloto/calc.js');
const SHC = globalThis.SHC, ok = m => console.log('  ✓ ' + m);

// ── DOM falso mínimo: só o que o adaptador usa (tag.classe, [attr*=v], [attr=v], descendente, matches/closest/nextElementSibling)
class El {
    constructor(tag, cls, attrs, kids) { this.tagName = tag.toUpperCase(); this.cls = (cls || '').split(/\s+/).filter(Boolean); this.attrs = attrs || {}; this.children = []; this.parent = null; this.t = ''; this.value = this.attrs.value || '';
        (Array.isArray(kids) ? kids : kids == null ? [] : [kids]).forEach(k => typeof k === 'string' ? (this.t += k) : (k.parent = this, this.children.push(k))); }
    get className() { return this.cls.join(' '); }
    get classList() { return { contains: c => this.cls.includes(c) }; }
    get textContent() { return this.t + this.children.map(c => c.textContent).join(' '); }
    getAttribute(n) { return n === 'class' ? this.className : (this.attrs[n] ?? null); }
    get nextElementSibling() { const s = this.parent && this.parent.children; return s ? s[s.indexOf(this) + 1] || null : null; }
    all() { return this.children.flatMap(c => [c, ...c.all()]); }
    matches(sel) { return sel.trim().split(/\s+/).length > 1 ? false : one(this, sel); }
    closest(sel) { for (let e = this; e; e = e.parent) if (one(e, sel)) return e; return null; }
    querySelectorAll(sel) { const parts = sel.trim().split(/\s+/); return this.all().filter(e => one(e, parts[parts.length - 1]) && (parts.length === 1 || anc(e, parts.slice(0, -1)))); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
function one(e, s) {
    const m = /^([a-z]+)?((?:[.\[][^.\[]*)*)$/i.exec(s.replace(/(\[[^\]]*\])/g, x => x)); const tag = (/^([a-z]+)/i.exec(s) || [])[1];
    if (tag && e.tagName !== tag.toUpperCase()) return false;
    for (const c of s.match(/\.[\w-]+/g) || []) if (!e.cls.includes(c.slice(1))) return false;
    for (const a of s.match(/\[[^\]]+\]/g) || []) { const [, n, op, v] = /\[([\w-]+)(\*?=)?([^\]]*)\]/.exec(a); const x = n === 'class' ? e.className : e.attrs[n]; if (op === '*=' ? !(x || '').includes(v) : op === '=' ? x !== v : x == null) return false; }
    return true;
}
const anc = (e, parts) => { let i = parts.length - 1; for (let p = e.parent; p && i >= 0; p = p.parent) if (one(p, parts[i])) i--; return i < 0; };
const h = (t, c, a, k) => new El(t, c, a, k);

const th = x => h('th', '', {}, x), td = (x, c) => h('td', c || 'core-table-td', {}, x);
const prodTd = (nome, id, sku) => td([h('div', '', { translate: 'no' }, nome), h('span', '', {}, 'ID:' + id), sku ? h('div', '', {}, 'SKU do vendedor: ' + sku) : null].filter(Boolean));
const precoTd = p => td(h('div', '_container_x', {}, h('div', '_salePrice_x', {}, p)));
const linha = (nome, id, sku, preco, extra) => h('tr', 'core-table-tr', {}, [td(''), td(''), prodTd(nome, id, sku), td('--'), td('Ativo'), td('500'), precoTd(preco), td('')]);
const sku = (cod, nome, preco) => h('tr', '_skuRow_x _newItem_x', {}, [td(''), td(''), td([h('p', '', {}, ' ' + nome), h('div', 'text-p4-regular text-neutral-text3', {}, cod)]), td(''), td(''), td(''),
    td(h('div', '', {}, h('div', '_price_x pulse-input-number', {}, h('input', 'core-input', { 'aria-valuenow': String(preco), value: String(preco).replace('.', ',') })))), td('')]);
const mae = (skus) => h('tr', 'core-table-tr core-table-expand-content', {}, h('td', 'core-table-td', {}, h('div', '_newManageSku_x', {}, [h('div', '_totalCount_x', {}, skus.length + ' SKUs'),
    ...(skus.length && skus[0] ? [h('table', '', {}, h('tbody', '', {}, skus))] : [])])));

const cab = h('tr', 'core-table-tr', {}, []);
const tabela = h('table', '', {}, [h('thead', '', {}, h('tr', '', {}, ['', '', 'Produto', 'Desempenho', 'Status', 'Estoque', 'Preço de varejo', 'Ação'].map(th))), h('tbody', '', {}, [
    cab,
    linha('Bike Simples', '111', 'ROCKET-12', 'R$ 469,90'),
    linha('Bike Sem SKU', '222', '', 'R$ 1.299,00'),
    linha('Bike Faixa', '333', 'FX-1', 'R$ 349,90 - R$ 399,90'),
    linha('Bike Variações Fechada', '444', '', 'R$ 349,90'), mae([]),
    linha('Bike Variações Aberta', '555', '', 'R$ 349,90'), mae([sku('DINO-12', 'DINO', 349.9), sku('ROCKET-13', 'ROCKET', 1234.5)]),
    h('tr', 'core-table-tr core-table-row-expanded', {}, h('td', '', {}, '')),   // marcador vazio da lista virtual
])]);
const body = new El('body', '', {}, [tabela]);
globalThis.document = { querySelectorAll: s => body.querySelectorAll(s), body };
globalThis.location = { href: 'https://seller-br.tiktok.com/product/manage?shop_region=BR' };
let cfg; SHC.etiquetaCanal = { iniciar: c => { cfg = c; } };
require('../../extension-copiloto/tiktok-lista.js');

console.log('tiktok-lista — adaptador');
assert.strictEqual(cfg.canal, 'tiktok'); assert.ok(cfg.urlOk());
globalThis.location = { href: 'https://seller-br.tiktok.com/order/manage' }; assert.ok(!cfg.urlOk());
globalThis.location = { href: 'https://seller-br.tiktok.com/product/manage?shop_region=BR' };
ok('só vale em /product/manage');
const ls = cfg.linhas(), l = ls.map(cfg.ler);
assert.strictEqual(ls.length, 5, 'simples, sem SKU, faixa e 2 variações abertas (mãe fechada/aberta e cabeçalho fora)');
ok('linhas: mãe com variações fica de fora; cada SKU expandido entra');
assert.deepStrictEqual([l[0].preco, l[0].sku, l[0].titulo], [469.9, 'ROCKET-12', 'Bike Simples']); ok('preço simples + SKU do vendedor + título');
assert.deepStrictEqual([l[1].preco, l[1].sku], [1299, '']); ok('milhar "R$ 1.299,00" e SKU vazio → ""');
assert.deepStrictEqual([l[2].preco, l[2].faixa, l[2].sku], [349.9, true, 'FX-1']); ok('faixa → menor preço e faixa:true');
assert.deepStrictEqual([l[3].preco, l[3].sku, l[3].titulo], [349.9, 'DINO-12', 'DINO']); assert.deepStrictEqual([l[4].preco, l[4].sku], [1234.5, 'ROCKET-13']); ok('variações: preço e SKU próprios');
assert.ok(l.every(x => x.ancora)); assert.ok(l[0].ancora.className.includes('_salePrice_')); assert.ok(l[3].ancora.className.includes('_price_')); ok('âncora = elemento do preço');
assert.strictEqual(cfg.ler(h('tr', 'core-table-tr', {}, [td('x'), td('sem preço')])), null); ok('linha sem preço → null (nunca 0)');
console.log('\nTUDO OK');
