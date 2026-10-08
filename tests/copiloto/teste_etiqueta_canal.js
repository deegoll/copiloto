// 3.4.0: etiqueta de ganho nas listas da Shopee, do TikTok Shop e da Magalu (etiqueta-canal.js). Dados inventados, DOM de mentira.
// Cobre: ok, apertado, prejuízo, sem custo, sem leitura, Magalu sem comissão, variações, não duplicar, mudança de custo, desligar, clique, conta no centavo.
// Rodar: node tests/copiloto/teste_etiqueta_canal.js
'use strict';
const vm = require('vm'), C = require('./carregador');
let falhas = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) { falhas++; } };
const espera = ms => new Promise(r => setTimeout(r, ms));

// ── DOM mínimo ──
class El {
    constructor(tag, doc) { this.nodeType = 1; this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.attrs = {}; this.filhos = []; this.parentNode = null; this.ouvintes = {}; this.shadowRoot = null; this._txt = ''; this.className = ''; }
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === this.ownerDocument.body || n === this.ownerDocument.raiz; }
    get firstChild() { return this.filhos[0] || null; }
    get nextSibling() { const p = this.parentNode; return p ? (p.filhos[p.filhos.indexOf(this) + 1] || null) : null; }
    get textContent() { return this._txt + this.filhos.map(f => f.textContent).join(''); }
    set textContent(v) { this._txt = String(v); this.filhos = []; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    hasAttribute(k) { return k in this.attrs; }
    removeAttribute(k) { delete this.attrs[k]; }
    appendChild(f) { return this.insertBefore(f, null); }
    insertBefore(f, ref) { if (f.parentNode) f.parentNode.removeChild(f); const i = ref ? this.filhos.indexOf(ref) : -1; if (i < 0) this.filhos.push(f); else this.filhos.splice(i, 0, f); f.parentNode = this; return f; }
    removeChild(f) { this.filhos.splice(this.filhos.indexOf(f), 1); f.parentNode = null; return f; }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    attachShadow() { this.shadowRoot = new El('#shadow', this.ownerDocument); this.shadowRoot.parentNode = null; return this.shadowRoot; }
    addEventListener(t, f) { (this.ouvintes[t] = this.ouvintes[t] || []).push(f); }
    clique() { (this.ouvintes.click || []).forEach(f => f({ preventDefault() {}, stopPropagation() { this.parou = true; } })); }
    getRootNode() { return this.ownerDocument; }
    querySelector(sel) { const c = String(sel).replace(/^\./, ''); return this.todos(x => String(x.className || '').split(/\s+/).indexOf(c) >= 0)[0] || null; }   // só ".classe" (a janelinha do custo usa '.pop')
    todos(f, out) { out = out || []; this.filhos.forEach(x => { if (f(x)) out.push(x); x.todos(f, out); }); return out; }
}
function novoMundo(cfg, custos) {
    const mem = Object.assign({ cfg }, custos), ouv = [], msgs = [], obs = [];
    const doc = { nodeType: 9 }; doc.body = new El('body', doc); doc.createElement = t => new El(t, doc); doc.documentElement = doc.body;
    doc.querySelectorAll = sel => { const m = /^\[([\w-]+)\]$/.exec(sel); return doc.body.todos(e => m && e.hasAttribute(m[1])); };
    const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
    const chrome = { storage: { local: {
        get: async k => { const o = {}; (k === null ? Object.keys(mem) : [].concat(k)).forEach(x => { if (x in mem) o[x] = clone(mem[x]); }); return o; },
        set: async o => { const mud = {}; Object.keys(o).forEach(k => { mud[k] = { oldValue: clone(mem[k]), newValue: clone(o[k]) }; mem[k] = clone(o[k]); }); ouv.forEach(f => f(mud, 'local')); },
    }, onChanged: { addListener: f => ouv.push(f), removeListener: f => { const i = ouv.indexOf(f); if (i >= 0) ouv.splice(i, 1); } } },
        runtime: { sendMessage: async m => { msgs.push(m); } } };
    const ctx = vm.createContext({ console, setTimeout, clearTimeout, Date, JSON, Math, Number, String, Array, Object, Set, WeakMap, Promise, Map, document: doc, chrome,
        MutationObserver: class { constructor(f) { this.f = f; obs.push(this); } observe() {} disconnect() { this.f = null; } }, addEventListener() {}, removeEventListener() {} });
    ['calc.js', 'store.js', 'nucleo/util.js', 'nucleo/modelo.js', 'nucleo/tarifas.js', 'etiqueta-canal.js'].forEach(f => vm.runInContext(C.ler(f), ctx, { filename: f }));
    return { ctx, doc, mem, msgs, obs, SHC: vm.runInContext('SHC', ctx) };
}
const hosts = w => w.doc.querySelectorAll('[data-copiloto-etq-host]');
const texto = h => h.shadowRoot.todos(e => e.tagName !== 'STYLE' && !e.filhos.length && e._txt).map(e => e._txt).join(' | ');
// linha de produto de mentira: <div><span preço/></div>
function linha(w, preco, sku) { const l = w.doc.createElement('div'), a = w.doc.createElement('span'); l.appendChild(a); w.doc.body.appendChild(l); return { l, a, preco, sku }; }
const adaptador = (w, canal, itens, extra) => ({ canal, urlOk: () => true, linhas: () => itens.map(i => i.l), ler: l => { const i = itens.find(x => x.l === l); return Object.assign({ preco: i.preco, sku: i.sku, titulo: 'x', ancora: i.a }, i.extra || {}); } });
async function roda(w, canal, itens) { const ctl = w.SHC.etiquetaCanal.iniciar(adaptador(w, canal, itens)); await espera(30); await ctl.passar(); return ctl; }
const CFG = { imposto_pct: 6, margem_alvo_pct: 10, etiquetas: { shopee: true, magalu: true }, magalu_comissao_pct: 11 };
const custo = (sku, v) => ({ ['c|sku|' + sku]: { custo: v } });

(async () => {
    console.log('Shopee: ok, apertado, prejuízo (conta no centavo contra SHC.calcular)');
    for (const [nome, cs, est] of [['ok', 30, 'ok'], ['apertado', 55, 'apertado'], ['prejuizo', 70, 'prejuizo']]) {
        const w = novoMundo(CFG, custo('A1', cs)), L = linha(w, 100, 'A1'), ctl = await roda(w, 'shopee', [L]);
        const c = w.SHC.calcular('sp', 100, { custo: cs }, Object.assign({}, w.SHC.PADRAO, CFG)), t = hosts(w).length ? texto(hosts(w)[0]) : '';
        const esperado = (c.sobra_rs < 0 ? 'Prejuízo ' + w.SHC.moeda(-c.sobra_rs) : 'Sobra ' + w.SHC.moeda(c.sobra_rs)) + ' · ' + (c.sobra_pct < 0 ? '−' : '') + Math.abs(c.sobra_pct).toFixed(1).replace('.', ',') + '%';
        ok(hosts(w).length === 1 && t.indexOf(esperado) === 0 && hosts(w)[0].shadowRoot.todos(e => e.className.indexOf('p ' + est) === 0).length === 1, nome + ': "' + esperado + '" no estado ' + est + ' (' + c.classe + ')');
        ok(/custo R\$ \d+,\d\d · comissão 14% \+ R\$ 20 · imposto 6%/.test(t), nome + ': linha pequena com custo, comissão e imposto (' + t.split(' | ')[1] + ')');
        ctl.parar();
    }
    {
        const w = novoMundo(CFG, custo('A1', 30)), L = linha(w, 100, 'A1'), ctl = await roda(w, 'shopee', [L]);
        ok(texto(hosts(w)[0]).indexOf('Sobra R$ 30,00 · 30,0%') === 0, 'Shopee R$ 100 com custo R$ 30: 100 − 14 − 20 (faixa R$ 100 a 200) − 30 − 6 = R$ 30,00 (conta à mão)');
        ctl.parar();
    }

    console.log('TikTok pelo núcleo e Magalu pela comissão informada');
    {
        const w = novoMundo(Object.assign({}, CFG, { etiquetas: { tiktok: true } }), custo('T1', 40)), L = linha(w, 100, 'T1'), ctl = await roda(w, 'tiktok', [L]);
        ok(texto(hosts(w)[0]).indexOf('Sobra R$ 36,00 · 36,0%') === 0 && /comissão 6% \+ R\$ 6/.test(texto(hosts(w)[0])), 'TikTok R$ 100: 6% + R$ 6 + frete 6% = R$ 18; 100 − 18 − 40 − 6 = R$ 36,00 · ' + texto(hosts(w)[0]));
        ctl.parar();
    }
    {
        const w = novoMundo(CFG, custo('M1', 40)), L = linha(w, 100, 'M1'), ctl = await roda(w, 'magalu', [L]);
        ok(texto(hosts(w)[0]).indexOf('Sobra R$ 43,00 · 43,0%') === 0 && /tarifa fixa não informada/.test(texto(hosts(w)[0])), 'Magalu R$ 100, comissão 11%: 100 − 11 − 40 − 6 = R$ 43,00 e avisa a tarifa fixa que falta');
        ctl.parar();
        const w2 = novoMundo(Object.assign({}, CFG, { magalu_taxa_fixa: 5 }), custo('M1', 40)), L2 = linha(w2, 100, 'M1'), c2 = await roda(w2, 'magalu', [L2]);
        ok(texto(hosts(w2)[0]).indexOf('Sobra R$ 38,00') === 0, 'com a tarifa fixa de R$ 5 informada: R$ 38,00');
        c2.parar();
        const w3 = novoMundo(Object.assign({}, CFG, { magalu_comissao_pct: null }), custo('M1', 40)), L3 = linha(w3, 100, 'M1'), c3 = await roda(w3, 'magalu', [L3]);
        ok(/comissão da Magalu não informada/.test(texto(hosts(w3)[0])) && !/Sobra|R\$ \d/.test(texto(hosts(w3)[0]).split(' | ')[0]), 'Magalu sem comissão: "comissão da Magalu não informada", nenhum número suposto');
        c3.parar();
    }

    console.log('Sem custo, sem leitura, clique');
    {
        const w = novoMundo(CFG, {}), L = linha(w, 100, 'Z9'), L2 = linha(w, null, 'Z9'), L3 = linha(w, 100, ''), ctl = await roda(w, 'shopee', [L, L2, L3]);
        const ts = hosts(w).map(texto);
        ok(ts.length === 3 && /^\+ Informar custo/.test(ts[0]) && /^preço não lido/.test(ts[1]) && /^SKU não lido/.test(ts[2]), 'sem custo "+ Informar custo"; preço ausente "preço não lido" (nunca 0); sem SKU "SKU não lido"');
        const b = hosts(w)[0].shadowRoot.todos(e => e.tagName === 'BUTTON')[0];
        b.clique();
        const sombra = hosts(w)[0].shadowRoot, pop = sombra.querySelector('.pop');
        ok(w.msgs.length === 0 && !!pop, 'o clique em "+ Informar custo" de 1 SKU abre a janelinha na própria página (sem abrir outra aba)');
        const inp = pop.todos(e => e.tagName === 'INPUT')[0], sv = pop.todos(e => String(e.className).split(/\s+/).indexOf('sv') >= 0)[0];
        inp.value = '0'; sv.clique(); await espera(30);
        ok(!!sombra.querySelector('.err') && /maior que zero/.test(sombra.querySelector('.err').textContent) && !!sombra.querySelector('.pop'), 'custo zero: a janelinha fica aberta e diz "maior que zero"');
        inp.value = '55,00'; sv.clique(); await espera(60); await ctl.passar();
        ok(w.mem['c|sku|Z9'] && w.mem['c|sku|Z9'].custo === 55 && w.mem['c|sku|Z9'].origem === 'manual', 'salvar grava o custo do SKU (manual) no mesmo lugar do ML: vale para todos os canais');
        ok(!hosts(w)[0].shadowRoot.querySelector('.pop') && /^Sobra R\$/.test(texto(hosts(w)[0])), 'a janelinha fecha e a etiqueta já mostra a sobra');
        ctl.parar();
    }

    console.log('Variações, não duplicar, mudança de custo, desligar');
    {
        const w = novoMundo(CFG, Object.assign(custo('V1', 30), custo('V2', 40))), mae = linha(w, 100, '');
        mae.extra = { itens: [{ preco: 100, sku: 'V1' }, { preco: 100, sku: 'V2' }] };
        const ctl = await roda(w, 'shopee', [mae]);
        ok(/Sobra R\$ 20,00 a R\$ 30,00 · 20,0% a 30,0%/.test(texto(hosts(w)[0])), 'linha-mãe com todos os SKUs com custo mostra a faixa: ' + texto(hosts(w)[0]).split(' | ')[0]);
        mae.extra = { itens: [{ preco: 100, sku: 'V1' }, { preco: 100, sku: 'V3' }] };
        await ctl.passar();
        ok(/^1 de 2 com custo/.test(texto(hosts(w)[0])) && hosts(w).length === 1, 'com um SKU sem custo: "1 de 2 com custo" (sem faixa) e a mesma etiqueta é reaproveitada');
        ctl.parar();
    }
    {
        const w = novoMundo(CFG, custo('A1', 30)), L = linha(w, 100, 'A1'), ctl = await roda(w, 'shopee', [L]);
        await ctl.passar(); await ctl.passar();
        ok(hosts(w).length === 1 && L.a.getAttribute('data-copiloto-etq') === 'shopee', 'várias passadas: uma etiqueta só, âncora marcada');
        await w.ctx.chrome.storage.local.set(custo('A1', 70)); await espera(700);
        ok(/^Prejuízo/.test(texto(hosts(w)[0])) && hosts(w).length === 1, 'custo mudou no storage: a etiqueta recalcula sozinha (Prejuízo)');
        L.l.remove(); await ctl.passar();
        ok(hosts(w).length === 0, 'linha saiu da tela: a etiqueta sai junto (nada sobra)');
        ctl.parar();
    }
    {
        const w = novoMundo(CFG, custo('A1', 30)), L = linha(w, 100, 'A1'), ctl = await roda(w, 'shopee', [L]);
        await w.ctx.chrome.storage.local.set({ cfg: Object.assign({}, CFG, { etiquetas: { shopee: false } }) }); await espera(700);
        ok(hosts(w).length === 0 && L.a.getAttribute('data-copiloto-etq') === null, 'canal desligado em Ajustes: todas as etiquetas e marcas somem');
        await w.ctx.chrome.storage.local.set({ cfg: CFG }); await espera(700);
        ok(hosts(w).length === 1, 'ligou de novo: volta uma etiqueta');
        ctl.parar();
        ok(hosts(w).length === 0, 'parar() remove tudo');
        const w2 = novoMundo(CFG, custo('A1', 30)), L2 = linha(w2, 100, 'A1'), c2 = w2.SHC.etiquetaCanal.iniciar({ canal: 'shopee', urlOk: () => false, linhas: () => [L2.l], ler: () => ({ preco: 100, sku: 'A1', ancora: L2.a }) });
        await espera(30); await c2.passar();
        ok(hosts(w2).length === 0, 'fora da tela de lista (urlOk falso): nada é desenhado');
        c2.parar();
    }

    console.log('Registro e manifest');
    const man = JSON.parse(C.ler('manifest.json')), R = require('../../extension-copiloto/etiqueta-registro.js');
    ok(['https://seller.shopee.com.br/*', 'https://seller.magalu.com/*', 'https://seller-br.tiktok.com/*'].every(h => man.optional_host_permissions.indexOf(h) >= 0)
        && !man.host_permissions.some(h => /shopee|magalu|tiktok/.test(h)) && !man.content_scripts.some(c => c.matches.some(m => /shopee|magalu|tiktok/.test(m))), 'os 3 sites são permissão OPCIONAL; nenhum content_script fixo neles');
    ok(Object.keys(R.CANAIS).every(c => R.script(c).js.every(f => require('fs').existsSync(require('path').join(C.EXT, f)))), 'todo arquivo registrado existe (motor, núcleo e os 3 adaptadores)');
    // 3.4.0 (termos por canal): Shopee/Magalu só ligam com o aceite da versão atual (cfg.termos); o interruptor sozinho não basta (teste_termos_canais.js cobre o resto)
    const TM = require('../../extension-copiloto/termos-canais.js'); globalThis.CopilotoTermos = TM; const ac = { shopee: TM.registro(), magalu: TM.registro() };
    ok(!R.ligado({ etiquetas: { shopee: true } }, 'shopee') && R.ligado({ etiquetas: { shopee: true }, termos: ac }, 'shopee') && !R.ligado({}, 'shopee') && !R.ligado({ etiquetas: { magalu: false } }, 'magalu')
        && !R.ligado({ modulos: { tiktok: true } }, 'tiktok') && R.ligado({ consentimento_tiktok: {}, modulos: { tiktok: true } }, 'tiktok') && !R.ligado({ consentimento_tiktok: {}, modulos: { tiktok: true }, etiquetas: { tiktok: false } }, 'tiktok'),
        'só liga com o interruptor (TikTok: junto com o consentimento do TikTok e salvo desligar)');
    const regs = [], desreg = [], ch = { storage: { local: { get: async () => ({ cfg: { etiquetas: { magalu: true }, termos: ac } }) } }, permissions: { contains: async p => p.origins[0].indexOf('magalu') > 0 },
        scripting: { getRegisteredContentScripts: async () => [{ id: 'copiloto-etq-shopee' }], registerContentScripts: async s => regs.push(s[0].id), unregisterContentScripts: async o => desreg.push(o.ids[0]) } };
    const R2 = vm.runInNewContext(C.ler('etiqueta-registro.js') + '; SHC.etqReg', { chrome: ch, SHC: {}, Promise, Object, console, CopilotoTermos: TM });
    await R2.sincronizar();
    ok(regs.join() === 'copiloto-etq-magalu' && desreg.join() === 'copiloto-etq-shopee', 'sincronizar registra o canal ligado com permissão e tira o que não está mais ligado');

    console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nTUDO OK');
    process.exitCode = falhas ? 1 : 0;
})();
