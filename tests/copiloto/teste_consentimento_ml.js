// 3.3.1 · C2 (termo do Mercado Livre, decisão da dona em 09/10): antes de ligar o Mercado Livre, o quadro "Concordo e ligar" em
// Ajustes › Canais de venda. Quem atualiza da 3.3.0 (cfg sem consentimento_ml) fica com o canal DESLIGADO: nada é lido — nem a
// sincronização do fundo, nem o que a tela aberta recebe, nem as etiquetas dentro do ML — até tocar em "Concordo e ligar" uma vez.
// "Agora não" (ou Esc) não grava nada; o clique grava cfg.consentimento_ml = {versao:'3.3.1', em:<ISO>} e dispara a 1ª leitura.
// Desligar pergunta e tira o consentimento (o que já foi lido fica guardado). Nada é pedido ao Chrome: as permissões do ML já vêm
// na instalação — o consentimento é a chave. Painel de verdade num DOM de mentira, como o teste_consentimento_tiktok.js.
// Rodar:  node tests/copiloto/teste_consentimento_ml.js
require('./relogio').fixar();
const fs = require('fs'), path = require('path'), vm = require('vm'), carregador = require('./carregador');
global.chrome = { storage: { local: {} } };
const SHC = require('../../extension-copiloto/calc.js');
require('../../extension-copiloto/store.js');
require('../../extension-copiloto/ml-extrator.js');
require('../../extension-copiloto/painel-lateral.js');
const montaFundo = require('./fundo_falso');
const P = SHC.pl, dir = carregador.EXT;
let falhas = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) falhas++; };
const HOJE = Date.parse('2026-09-25T12:00:00-03:00');
class D extends Date { constructor(...a) { super(...(a.length ? a : [HOJE])); } static now() { return HOJE; } }
const espera = ms => new Promise(r => setTimeout(r, ms));

// seq = o que o painel avisou ao fundo ({acao:'sincronizar'}). confResp = resposta do window.confirm (o "Desligar o Mercado Livre?").
async function abre({ confResp = true } = {}) {
    const els = {}, seq = [], conf = { resp: confResp };
    const mk = () => { const cls = new Set(); const e = { innerHTML: '', textContent: '', value: '', hidden: false, style: {}, dataset: {}, _on: {}, _at: {}, className: '',
        classList: { add: c => cls.add(c), remove: c => cls.delete(c), toggle: (c, on) => { if (on === undefined ? !cls.has(c) : on) cls.add(c); else cls.delete(c); }, contains: c => cls.has(c) },
        addEventListener(t, f) { (e._on[t] = e._on[t] || []).push(f); }, focus() {}, blur() {}, showModal() { e.open = true; }, close() { e.open = false; }, setAttribute(k, v) { e._at[k] = String(v); }, removeAttribute() {},
        matches: () => false, closest: () => null, appendChild: c => c, insertBefore: c => c, _q: {}, querySelector: s => e._q[s] || (e._q[s] = mk()), querySelectorAll: () => [] }; e.parentElement = e; return e; };
    const faixa = [];
    P.ABAS.forEach((a, i) => { const b = mk(); b.dataset.a = a; b.getBoundingClientRect = () => ({ left: i * 60 - 130, right: i * 60 - 70 }); faixa.push(b); });
    const document = { querySelector: s => (s === '#abas button.on' ? faixa.find(b => b.classList.contains('on')) || null : els[s] || (els[s] = mk())),
        querySelectorAll: s => (/#abas button/.test(s) ? faixa : []), createElement: () => mk(), activeElement: null, addEventListener() {} };
    document.body = document.querySelector('body');
    const mem = {}, ctx = { document, location: { search: '?seed=v2', hash: '' }, console, setTimeout, clearTimeout, setInterval: () => 0, URLSearchParams, Date: D, Promise,
        confirm: () => conf.resp };
    ctx.window = ctx; ctx.globalThis = ctx;
    ctx.localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'stub.js'), 'utf8'), ctx);
    ctx.__semSync = true;
    delete ctx.__mem.cfg.consentimento_ml;   // quem atualiza da 3.3.0: cfg inteira (imposto, margem…), mas sem o "Concordo e ligar"
    const enviar = ctx.chrome.runtime.sendMessage;
    ctx.chrome.runtime.sendMessage = function (m, cb) { if (m && m.acao === 'sincronizar') seq.push('msg:sincronizar'); return enviar.call(this, m, cb); };
    carregador.scripts('painel-lateral.html').forEach(f => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx));
    els['#abas'].getBoundingClientRect = () => ({ left: 0, right: 346 });
    await espera(300);
    const chave = ligar => { const alvo = { id: 'canal-ml', checked: ligar }; els['#listaCanais']._on.change[0]({ target: alvo }); return alvo; };
    const quadro = qual => els['#quadroML']._on.click[0]({ target: { closest: s => (s === '[data-ml-quadro]' ? { dataset: { mlQuadro: qual } } : null) } });
    const aba = a => els['#abas']._on.click[0]({ target: { closest: () => ({ dataset: { a } }) } });
    // tudo o que a tela mostra (cada elemento tocado pelo painel), menos o próprio quadro
    const foto = () => JSON.stringify(Object.keys(els).filter(k => k !== '#quadroML').sort().map(k => [k, els[k].innerHTML, els[k].textContent, els[k].hidden, !!els[k].checked, els[k].value]));
    return { els, ctx, mem: ctx.__mem, seq, chave, quadro, aba, foto, conf, q: s => document.querySelector(s) };
}

(async () => {
    console.log('1) O quadro: o que lê, para quê, como, como parar, a linha dos termos, a política e os 2 botões');
    const ML = SHC.CANAIS.find(c => c.id === 'ml'), h = P.quadroMlHtml(ML);
    ok(h.includes('<b>O que o Copiloto lê:</b> as telas do painel do vendedor: ' + ML.telas.join(', ') + '.'), '(1) as telas de SHC.CANAIS.ml.telas, pelo nome');
    ok(/<b>Para quê:<\/b> mostrar no Copiloto o lucro real de cada venda, a conciliação das cobranças e a saúde da sua loja\./.test(h), '(2) para quê: lucro real, conciliação e saúde da loja');
    ok(/lê as páginas do painel com a sua sessão e copia as respostas que a tela já recebeu\. Não clica, não preenche e não envia nada ao Mercado Livre\. Dado de comprador só passa pela memória e não é guardado\. Nada sai do seu Chrome\./.test(h),
        '(3) como: lê com a sua sessão e copia a resposta da tela; não clica nem envia nada; comprador só na memória; nada sai do Chrome');
    ok(/<b>Para parar:<\/b> desligue o Mercado Livre aqui em Canais de venda\. O que já foi lido fica guardado neste computador e volta a aparecer ao religar\./.test(h), '(4) como parar (o que foi lido fica guardado)');
    ok(h.includes('Os termos do vendedor do Mercado Livre podem não permitir ferramentas de terceiros que leem a sua loja; ao ligar, você decide usar o Copiloto assim.'), '(5) a linha dos termos do ML, palavra por palavra');
    ok(h.includes('<a class="lnk" href="https://especialistaemmarketplace.com.br/sellerhub/copiloto/privacidade.html" target="_blank" rel="noopener">'), '(6) o link da política de privacidade');
    ok(/<button type="button" class="bt leve" data-ml-quadro="nao" autofocus>Agora não<\/button><button type="button" class="bt verde" data-ml-quadro="sim">Concordo e ligar<\/button>/.test(h),
        'botões "Agora não" (com o foco ao abrir) e "Concordo e ligar"');
    const html = carregador.ler('painel-lateral.html');
    ok(/<dialog class="modal" id="quadroML" aria-labelledby="quadroMLt" aria-describedby="quadroMLd"><\/dialog>/.test(html) && /id="quadroMLt"/.test(h) && /id="quadroMLd"/.test(h),
        'HTML: <dialog> nativo (foco preso nele, Esc fecha), fechado e vazio, com título e descrição ligados ao quadro');

    console.log('2) Quem atualiza da 3.3.0: ML "desligado", Geral só com o convite; sem o clique nada é gravado nem lido');
    let t = await abre();
    const cfg0 = JSON.stringify(t.mem.cfg);
    ok(/O Copiloto ainda não lê nada deste computador/.test(t.els['#listaGeral'].innerHTML) && /data-ir-ajustes>Ligar o Mercado Livre</.test(t.els['#listaGeral'].innerHTML),
        'Geral sem o consentimento: só o convite com o botão "Ligar o Mercado Livre" (nenhum número guardado se apresenta como leitura)');
    ok(t.seq.length === 0, 'a abertura do painel não dispara leitura sem o consentimento');
    t.aba('ajustes'); await espera(30);
    const foto0 = t.foto();   // retrato da tela já em Ajustes: o quadro abre e fecha sem mexer em mais nada
    const lc = t.els['#listaCanais'].innerHTML;
    ok(/<b>Mercado Livre<\/b><small>desligado · /.test(lc) && /<input type="checkbox" class="tg" id="canal-ml" aria-label="Mercado Livre: ligar abre o termo/.test(lc) && !/id="canal-ml" checked/.test(lc)
        && !t.q('#quadroML').open && t.q('#quadroML').innerHTML === '' && !('consentimento_ml' in (t.mem.cfg || {})),
        'Ajustes: ML "desligado" com a chave livre (sem trava), o quadro fechado e vazio, nenhum consentimento gravado');
    const alvo = t.chave(true);
    ok(t.q('#quadroML').open === true && t.q('#quadroML').innerHTML === h && alvo.checked === false, 'tocou na chave: abre o quadro e a chave volta desmarcada');
    await espera(30);
    ok(t.seq.length === 0 && JSON.stringify(t.mem.cfg) === cfg0, 'sem o clique em "Concordo e ligar": nada avisado ao fundo, cfg igual');
    t.quadro('nao'); await espera(30);
    ok(!t.q('#quadroML').open && t.seq.length === 0 && JSON.stringify(t.mem.cfg) === cfg0 && t.foto() === foto0, '"Agora não": fecha, não grava nada, e a tela fica igual');
    t.chave(true); t.q('#quadroML').close(); await espera(30);   // Esc no <dialog>
    ok(t.seq.length === 0 && JSON.stringify(t.mem.cfg) === cfg0 && t.foto() === foto0, 'Esc: o mesmo que "Agora não"');

    console.log('3) "Concordo e ligar": grava o consentimento, marca a chave e a 1ª leitura sai na hora');
    t.chave(true); t.quadro('sim');
    ok(!t.q('#quadroML').open, 'o quadro fecha no clique');
    await espera(30);
    const c = t.mem.cfg.consentimento_ml;
    ok(c && c.versao === '3.3.1' && c.em === new Date(HOJE).toISOString() && Object.keys(c).join() === 'versao,em', 'cfg.consentimento_ml = {versao:"3.3.1", em:"' + (c && c.em) + '"}');
    ok(t.seq.join() === 'msg:sincronizar' && t.q('#canal-ml').checked === true && t.els['#aviso'].textContent === '✓ Mercado Livre ligado. O Copiloto começa a ler agora.',
        'avisa o fundo (1ª sincronização), a chave fica marcada e o aviso diz que a leitura começa');
    ok(/<b>Mercado Livre<\/b><small>(lido em|ainda não lido)/.test(t.els['#listaCanais'].innerHTML), 'a linha do ML sai de "desligado"');

    console.log('4) Desligar: pergunta; cancelou, fica ligado; confirmou, o consentimento sai e o ML volta a "desligado"');
    const cfgLigado = JSON.stringify(t.mem.cfg);
    t.conf.resp = false;   // "não" na pergunta "Desligar o Mercado Livre?"
    const alvoOff = t.chave(false);
    ok(alvoOff.checked === true && JSON.stringify(t.mem.cfg) === cfgLigado, 'confirm respondido "não": a chave volta marcada e nada muda');
    t.conf.resp = true;
    t.chave(false); await espera(30);
    ok(t.mem.cfg.consentimento_ml === null && t.els['#aviso'].textContent === 'Mercado Livre desligado. O Copiloto não lê mais nada do painel do vendedor.'
        && /<b>Mercado Livre<\/b><small>desligado · /.test(t.els['#listaCanais'].innerHTML),
        'confirm respondido "sim": consentimento_ml null, aviso claro e o ML "desligado" de novo');
    t = await abre();   // montagem nova, sem o consentimento: quem desligou vê a Geral só com o convite de novo
    ok(/data-ir-ajustes>Ligar o Mercado Livre</.test(t.els['#listaGeral'].innerHTML) && t.seq.length === 0, 'com o ML desligado: Geral só com o convite, nenhuma leitura');

    console.log('5) Fundo de verdade: sem o consentimento nenhuma via lê o ML');
    let F = montaFundo({ semConsentimento: true, rota: () => null });
    let r = await F.envia({ acao: 'sincronizar' });
    ok(r && r.ok === false && r.motivo === 'sem_consentimento' && F.pedidos.length === 0, 'sincronizar sem o "Concordo e ligar": {ok:false, motivo:"sem_consentimento"}, 0 pedidos de rede');
    r = await F.envia({ acao: 'concorrentes', itemId: 'MLB1000000001' });
    ok(r && r.ok === false && r.motivo === 'sem_consentimento' && F.pedidos.length === 0, 'concorrentes (pedido do painel) idem: recusado, 0 GETs');
    r = await F.envia({ acao: 'promos_pagina', itens: [] }, { id: 'ext', url: montaFundo.B + '/anuncios/lista/promos', tab: { id: 1, url: montaFundo.B + '/anuncios/lista/promos' } });
    ok(r && r.ok === false && r.motivo === 'sem_consentimento' && F.pedidos.length === 0, 'o que vem da aba do ML (promos_pagina) também para no portão');
    F = montaFundo({ rota: () => null });   // com o consentimento (o padrão do fundo_falso)
    r = await F.envia({ acao: 'sincronizar' });
    await F.tique(3);
    ok(F.pedidos.length > 0 && !(r && r.motivo === 'sem_consentimento'), 'com o "Concordo e ligar" gravado a leitura começa (pedidos de rede saem)');

    console.log('6) O que não pode ter mudado');
    ok(SHC.ROBO_ESCRITA_CONFERIDA === false && SHC.PROMO_ADESAO_CONFERIDA === false, 'as travas de escrita continuam false');
    ok(SHC.canaisLigados({}).length === 0 && SHC.mlLigado({}) === false && SHC.mlLigado({ consentimento_ml: { versao: '3.3.1', em: 'x' } }) === true,
        'instalação nova: nenhum canal ligado; o ML só com o consentimento');

    console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nTUDO OK');
    process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
