// 02/10: o background.js virou só o carregador e o código foi para fundo/ (partes por assunto, cortadas em instrução de topo).
// (a) a junção das partes, na ordem, é IGUAL byte a byte ao background.js do commit 7f7f312 (do git; sem git, da cópia guardada em
// _referencia_divisao/background.js.orig); (b) o carregador só tem o importScripts das partes, na ordem; (c) o fundo sobe no ambiente de
// mentira e registra os mesmos listeners, funções e alarmes que o background.js inteiro de antes; (d) nada que roda na carga usa nome de
// topo (função, const) de parte POSTERIOR — num arquivo só, a função declarada no fim já existe no começo (içamento); dividido, não.
// Rodar: node tests/copiloto/teste_fundo_dividido.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), { execFileSync } = require('child_process');
const montaFundo = require('./fundo_falso');
const EXT = path.join(__dirname, '../../extension-copiloto'), FUNDO = path.join(EXT, 'fundo');
const COMMIT = '7f7f312', REF = path.join(__dirname, '_referencia_divisao', 'background.js.orig');
// Funções de topo NOVAS no fundo depois da divisão (o resto continua igual ao background.js de 7f7f312). Função nova no fundo entra aqui,
// com a versão: assim o teste ainda pega função perdida ou criada por engano, e a divisão (a) continua provada pela cópia de referência.
const NOVAS = {
    contaSegue: 'v3.3 multi-empresa: a sessão do ML ainda é da conta da sincronização (fundo/10)',
    marcaReler: 'v3.3 multi-empresa: meses lidos depois de uma troca de conta voltam para a fila (fundo/10)',
    experienciaNaFaixa: 'v3.3 experiência de compra vinda da aba: tipos e tamanhos conferidos (fundo/13)',
    juntarExperiencia: 'v3.3 experiência de compra: grava exp:<conta> com a nota anterior (fundo/13)',
    empresaDoPedido: 'v3.3 multi-empresa: a empresa do clique que a tela manda com a importação do ERP, conferida (fundo/09)',
};
let falhas = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) falhas++; };

// ── (d) sem parser externo: fichas do JS (comentário fora; texto, template e regex viram 1 ficha), parênteses casados e as instruções
// de topo de cada parte. Função "roda na carga" quando é chamada ali (nome seguido de "(", ou passada direto a uma chamada que não adia)
// e aí o corpo dela entra na conta; função passada a addListener/setTimeout/then/catch/finally só precisa EXISTIR na carga.
// ponytail: regex reconhecida pela ficha anterior (o estilo do fundo); um caso fora disso desequilibra as chaves e o teste acusa.
const ADIA = new Set(['addListener', 'setTimeout', 'then', 'catch', 'finally']);
function fichas(src) {
    const t = [], tpl = [];
    let i = 0, prof = 0;
    const regexPode = () => { const p = t[t.length - 1]; return !p || (p.k === 'id' ? /^(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/.test(p.v) : p.k === 'p' && !/^[)\]}]$/.test(p.v)); };
    const lerTpl = () => {
        for (;;) {
            const c = src[i];
            if (c === undefined) throw new Error('template sem fim');
            if (c === '\\') i += 2;
            else if (c === '`') { i++; t.push({ k: 's' }); return; }
            else if (c === '$' && src[i + 1] === '{') { i += 2; t.push({ k: 's' }, { k: 'p', v: '(' }); tpl.push(prof); return; }
            else i++;
        }
    };
    while (i < src.length) {
        const c = src[i], d = src[i + 1];
        if (/\s/.test(c)) { i++; continue; }
        if (c === '/' && d === '/') { const j = src.indexOf('\n', i); i = j < 0 ? src.length : j; continue; }
        if (c === '/' && d === '*') { const j = src.indexOf('*/', i + 2); if (j < 0) throw new Error('comentário sem fim'); i = j + 2; continue; }
        if (c === '"' || c === "'") {
            let j = i + 1;
            for (; src[j] !== c; j++) { if (src[j] === '\\') j++; if (j >= src.length || src[j] === '\n') throw new Error('texto sem fim'); }
            i = j + 1; t.push({ k: 's' }); continue;
        }
        if (c === '`') { i++; lerTpl(); continue; }
        if (c === '}' && tpl.length && tpl[tpl.length - 1] === prof) { tpl.pop(); i++; t.push({ k: 'p', v: ')' }); lerTpl(); continue; }
        if (c === '/' && regexPode()) {
            let j = i + 1, classe = false;
            for (;; j++) {
                const x = src[j];
                if (x === undefined || x === '\n') throw new Error('regex sem fim');
                if (x === '\\') j++; else if (x === '[') classe = true; else if (x === ']') classe = false; else if (x === '/' && !classe) break;
            }
            i = j + 1; while (/[a-z]/.test(src[i] || '')) i++;
            t.push({ k: 's' }); continue;
        }
        const m = /^(?:[A-Za-z_$][\w$]*|\d[\w.]*|=>|\.\.\.)/.exec(src.slice(i, i + 80));
        if (m) { t.push({ k: /[A-Za-z_$]/.test(c) ? 'id' : /\d/.test(c) ? 'n' : 'p', v: m[0] }); i += m[0].length; continue; }
        if (c === '{') prof++; else if (c === '}') prof--;
        t.push({ k: 'p', v: c }); i++;
    }
    if (prof || tpl.length) throw new Error('chaves desequilibradas');
    // par[j] = o parêntese/colchete/chave que casa com j; dono[j] = a abertura que envolve a ficha j (-1 no topo).
    const par = [], dono = [], pilha = [], ABRE = { '(': ')', '[': ']', '{': '}' };
    t.forEach((x, j) => {
        dono[j] = pilha.length ? pilha[pilha.length - 1] : -1;
        if (x.k !== 'p') return;
        if (ABRE[x.v]) pilha.push(j);
        else if (/^[)\]}]$/.test(x.v)) { const a = pilha.pop(); if (a === undefined || ABRE[t[a].v] !== x.v) throw new Error('fecha sem abrir'); par[a] = j; par[j] = a; dono[j] = dono[a]; }
    });
    if (pilha.length) throw new Error('abre sem fechar');
    return { t, par, dono };
}
// Função que começa na ficha j (declaração, expressão ou seta) → { corpo: [ini, fim), fim: 1ª ficha depois dela } | null.
function funcaoEm(F, j, lim) {
    const { t, par } = F, v = k => t[k] && t[k].v;
    let k = j;
    if (v(k) === 'async' && (v(k + 1) === 'function' || v(k + 1) === '(' || (t[k + 1] && t[k + 1].k === 'id' && v(k + 2) === '=>'))) k++;
    if (v(k) === 'function') {
        k++; if (v(k) === '*') k++; if (t[k] && t[k].k === 'id') k++;
        if (v(k) !== '(') return null;
        const c = par[k] + 1;
        return { corpo: [c + 1, par[c]], fim: par[c] + 1 };
    }
    let seta;
    if (t[k] && t[k].k === 'id' && v(k + 1) === '=>') seta = k + 1;
    else if (v(k) === '(' && v(par[k] + 1) === '=>') seta = par[k] + 1;
    else return null;
    const c = seta + 1;
    if (v(c) === '{') return { corpo: [c + 1, par[c]], fim: par[c] + 1 };
    let f = c;
    while (f < lim && !/^[,;)\]}]$/.test(v(f))) f = par[f] > f ? par[f] + 1 : f + 1;
    return { corpo: [c, f], fim: f };
}
// Instruções de topo → { nomes, funcoes: {nome: corpo} (function e const nome = função), nDecl, carga: [[ini, fim)] (o que roda já) }.
function topo(F) {
    const { t, par } = F, v = k => t[k] && t[k].v, nomes = [], funcoes = {}, carga = [];
    const ate = (k, fim, sep) => { while (k < fim && !sep.test(v(k))) k = par[k] > k ? par[k] + 1 : k + 1; return k; };
    let j = 0, nDecl = 0;
    while (j < t.length) {
        if (v(j) === 'function' || (v(j) === 'async' && v(j + 1) === 'function')) {
            const fn = funcaoEm(F, j, t.length), a = v(j) === 'async' ? j + 2 : j + 1, nome = v(a) === '*' ? v(a + 1) : v(a);
            nomes.push(nome); funcoes[nome] = fn.corpo; nDecl++; j = fn.fim; continue;
        }
        const fim = ate(j, t.length, /^;$/);
        if (/^(const|let|var)$/.test(v(j))) {
            for (let k = j + 1; k < fim;) {
                const nome = v(k), f = ate(k, fim, /^,$/);
                nomes.push(nome);
                if (v(k + 1) === '=') { const fn = funcaoEm(F, k + 2, f); if (fn && fn.fim === f) funcoes[nome] = fn.corpo; else carga.push([k + 2, f]); }
                k = f + 1;
            }
        } else carga.push([j, fim]);
        j = fim + 1;
    }
    return { nomes, funcoes, carga, nDecl };
}
// partes = [[nome, texto]] na ordem de carga → { erros, chamadas (funções que rodam na carga), nDecl }.
function cargaTardia(partes) {
    const P = partes.map(([nome, src]) => { const F = fichas(src); return Object.assign(F, topo(F), { nome }); });
    const parteDe = {}, onde = {};
    P.forEach((p, n) => { p.nomes.forEach(x => { if (!(x in parteDe)) parteDe[x] = n; }); Object.keys(p.funcoes).forEach(x => { onde[x] = { p, corpo: p.funcoes[x] }; }); });
    const erros = [], chamadas = new Set(), visto = new Set();
    const anda = (p, [ini, fim], n) => {   // n = parte que está carregando
        const { t, dono } = p, v = k => t[k] && t[k].v;
        for (let j = ini; j < fim;) {
            const fn = funcaoEm(p, j, fim);
            if (fn) { const a = dono[j]; if (!(a >= 0 && v(a) === '(' && ADIA.has(v(a - 1)))) anda(p, fn.corpo, n); j = fn.fim; continue; }
            const x = t[j];
            if (x.k === 'id' && v(j - 1) !== '.' && !(v(j + 1) === ':' && /^[{,]$/.test(v(j - 1))) && x.v in parteDe) {
                if (parteDe[x.v] > n) erros.push(P[n].nome + ' usa ' + x.v + ' (de ' + P[parteDe[x.v]].nome + ') na carga');
                const a = dono[j], chama = v(j + 1) === '(' || (a >= 0 && v(a) === '(' && t[a - 1] && t[a - 1].k === 'id' && !ADIA.has(v(a - 1)) && /^[(,]$/.test(v(j - 1)) && /^[),]$/.test(v(j + 1)));
                if (chama && onde[x.v] && !visto.has(x.v + '@' + n)) { visto.add(x.v + '@' + n); chamadas.add(x.v); anda(onde[x.v].p, onde[x.v].corpo, n); }
            }
            j++;
        }
    };
    P.forEach((p, n) => p.carga.forEach(r => anda(p, r, n)));
    return { erros, chamadas, nDecl: P.reduce((s, p) => s + p.nDecl, 0) };
}

(async () => {
    console.log('a) junção das partes = background.js do commit ' + COMMIT);
    const ref = fs.readFileSync(REF);
    let orig = null;
    try { orig = execFileSync('git', ['show', COMMIT + ':extension-copiloto/background.js'], { cwd: path.join(__dirname, '../..'), stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 24 }); } catch (e) { orig = null; }
    if (orig) ok(orig.equals(ref), 'a cópia de referência (_referencia_divisao/background.js.orig) = git show ' + COMMIT + ' (' + orig.length + ' bytes)');
    else { console.log('  (sem git: compara com a cópia de referência)'); orig = ref; }
    const partes = fs.readdirSync(FUNDO).sort(), textos = partes.map(f => fs.readFileSync(path.join(FUNDO, f)));
    ok(partes.length >= 2 && partes.every((f, i) => f.startsWith(String(i + 1).padStart(2, '0') + '-') && /^\d\d-[a-z0-9-]+\.js$/.test(f)),
        partes.length + ' partes em fundo/, numeradas 01..' + String(partes.length).padStart(2, '0') + ' e só .js');
    // Depois da divisão o fundo evolui: a junção é a de 7f7f312 + as funções de NOVAS (e mudanças dentro das que já existiam).
    const junta = Buffer.concat(textos).toString('utf8'), declaradas = src => new Set((src.match(/^(?:async )?function\s+([\w$]+)/gm) || []).map(x => x.replace(/^(async )?function\s+/, '')));
    const antes = declaradas(orig.toString('utf8')), agora = declaradas(junta);
    const perdidas = [...antes].filter(n => !agora.has(n)), sobra = [...agora].filter(n => !antes.has(n) && !NOVAS[n]), faltam = Object.keys(NOVAS).filter(n => !agora.has(n));
    ok(Buffer.concat(textos).equals(orig) || (!perdidas.length && !sobra.length && !faltam.length),
        'junção das partes = background.js do ' + COMMIT + ' + ' + Object.keys(NOVAS).length + ' funções novas listadas (nenhuma antiga perdida)'
        + (perdidas.length ? ' · perdidas: ' + perdidas.join(', ') : '') + (sobra.length ? ' · novas fora da lista: ' + sobra.join(', ') : '') + (faltam.length ? ' · listadas e não achadas: ' + faltam.join(', ') : ''));
    const compila = partes.filter((f, i) => { try { new vm.Script(textos[i].toString('utf8'), { filename: f }); return false; } catch (e) { return true; } });
    ok(!compila.length && textos.every(b => b[b.length - 1] === 10), 'cada parte compila sozinha e termina em fim de linha' + (compila.length ? ' (não compila: ' + compila.join(', ') + ')' : ''));

    console.log('b) o carregador');
    const carregador = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');
    const codigo = carregador.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, '');
    ok(codigo === 'importScripts(' + partes.map(f => "'fundo/" + f + "'").join(',') + ');', 'background.js só tem o importScripts das ' + partes.length + ' partes, na ordem (fora os comentários)');
    const man = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
    ok(man.background && man.background.service_worker === 'background.js' && !man.background.type, 'manifest continua apontando para background.js (service worker clássico, sem "type": "module")');

    console.log('c) o fundo sobe igual ao de antes');
    const velho = montaFundo({ background: orig.toString('utf8') }), novo = montaFundo();
    const qtd = f => Object.keys(f.registros).map(k => k + ' ' + f.registros[k].length).join(', ');
    ok(qtd(novo) === qtd(velho) && Object.keys(novo.registros).every(k => novo.registros[k].length >= 1), 'listeners do Chrome registrados na carga: ' + qtd(novo));
    const funcoes = f => Object.keys(f.ctx).filter(k => typeof f.ctx[k] === 'function').sort().join();
    const comNovas = f => funcoes(f).split(',').concat(f === velho ? Object.keys(NOVAS) : []).sort().join();
    ok(comNovas(novo) === comNovas(velho) && funcoes(novo).split(',').length > 100, 'mesmas funções de topo no fundo, mais as novas listadas (' + funcoes(novo).split(',').length + ')');
    ok(Object.keys(novo.ctx.SHC).sort().join() === Object.keys(velho.ctx.SHC).sort().join(), 'mesmo SHC (' + Object.keys(novo.ctx.SHC).length + ' nomes, com o Object.assign do robô)');
    for (const motivo of ['install', 'update']) { velho.instala(motivo); novo.instala(motivo); }
    velho.alarme('shc-resumo'); novo.alarme('shc-resumo');
    await Promise.all([velho.tique(40), novo.tique(40)]);
    const alarmes = f => f.alarmes.map(a => a.nome + JSON.stringify(a.o)).join(' | ');
    ok(novo.alarmes.length >= 3 && alarmes(novo) === alarmes(velho), 'instalar/atualizar criam os mesmos alarmes: ' + novo.alarmes.map(a => a.nome).join(', '));
    ok(JSON.stringify(Object.keys(novo.dados).sort()) === JSON.stringify(Object.keys(velho.dados).sort()), 'e gravam as mesmas chaves (' + Object.keys(novo.dados).sort().join(', ') + ')');

    console.log('d) nada da carga usa nome de parte posterior');
    const c = s => cargaTardia(s.map((x, i) => ['p' + i, x])).erros.length;
    ok(c(['f();', 'function f() {}']) === 1 && c(['function f() { g(); } f();', 'function g() {}']) === 1 && c(['x.addListener(h);', 'function h() {}']) === 1
        && c(['Object.assign(S, { k });', 'function k() {}']) === 1 && c(['const a = () => b(); a();', 'function b() {}']) === 1 && c(['const a = B + 1;', 'const B = 1;']) === 1,
        'o detector acusa: chamada direta, chamada dentro de função chamada, listener, Object.assign e const de parte posterior');
    ok(c(['x.addListener(() => g());', 'function g() {}']) === 0 && c(['const a = () => b();', 'function b() {}']) === 0 && c(['p.then(() => z()); setTimeout(() => z(), 0);', 'function z() {}']) === 0
        && c(['g(); function g() {}', 'function h() {}']) === 0, 'e não acusa o que só roda depois (listener, função não chamada, then/setTimeout) nem içamento dentro da mesma parte');
    const r = cargaTardia(partes.map((f, i) => [f, textos[i].toString('utf8')]));
    const decl = (orig.toString('utf8').match(/^(async )?function\b/gm) || []).length + Object.keys(NOVAS).length;
    ok(r.nDecl === decl, 'achou as ' + decl + ' funções declaradas no topo (as fichas não se perderam)');
    ok(['retomarInterrompida', 'emFilaStatus'].every(x => r.chamadas.has(x)), 'viu o que roda na carga: ' + [...r.chamadas].join(', '));
    ok(!r.erros.length, 'nenhuma parte usa na carga função/const de parte posterior' + (r.erros.length ? ': ' + r.erros.join('; ') : ''));

    console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nTUDO OK');
    process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
