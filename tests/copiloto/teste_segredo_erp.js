// 3.3.1 (exigência da análise de SI de 09/10/2026): chaves, api-keys, senhas e tokens de integração nunca em texto claro no
// chrome.storage.local — AES-256-GCM (segredo.js), chave única por instalação em 'shc:segredo:v1', IV novo a cada gravação.
// Cobre: ida e volta, IV aleatório, migração do texto claro (3.3.0) na 1ª leitura, valor corrompido (nunca apaga nem migra o
// ilegível), chave sem ERP intocada, não-recifragem do já cifrado e a chave física por empresa (erp@<id>:tiny).
// Rodar:  node tests/copiloto/teste_segredo_erp.js
'use strict';
require('./relogio').fixar();
const mem = {};
const cp = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
global.chrome = { storage: { local: {
    async get(ks) {
        if (ks === null || ks === undefined) return cp(mem);
        const o = {};
        [].concat(ks).forEach(k => { if (k in mem) o[k] = cp(mem[k]); });
        return o;
    },
    async set(o) { Object.keys(o).forEach(k => { mem[k] = cp(o[k]); }); },
    async remove(ks) { [].concat(ks).forEach(k => { delete mem[k]; }); },
    async getKeys() { return Object.keys(mem); }
} } };
const SHC = require('../../extension-copiloto/calc.js');
require('../../extension-copiloto/store.js');
require('../../extension-copiloto/segredo.js');
let falhas = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) falhas++; };

(async () => {
    console.log('1) Cifra e decifra (AES-256-GCM)');
    const c1 = await SHC.segredoCifra('tok-Segredo-123'), c2 = await SHC.segredoCifra('tok-Segredo-123');
    ok(SHC.segredoEh(c1) && c1.indexOf('tok-Segredo-123') < 0, 'o cifrado tem o prefixo v1. e NÃO contém o texto');
    ok(c1 !== c2, 'IV aleatório: a mesma chave gravada duas vezes gera textos diferentes');
    ok(await SHC.segredoDecifra(c1) === 'tok-Segredo-123' && await SHC.segredoDecifra(c2) === 'tok-Segredo-123', 'os dois decifram para o mesmo texto');
    ok(await SHC.segredoDecifra('texto-claro-legado') === 'texto-claro-legado', 'texto claro (antes da 3.3.1) passa como está');
    ok((await SHC.segredoCifra('')) === '' && (await SHC.segredoCifra(null)) === null, 'vazio e null passam como estão');
    ok(mem['shc:segredo:v1'] && mem['shc:segredo:v1'].kty === 'oct', 'a chave da instalação foi gerada e guardada (JWK), uma vez');

    console.log('2) erpGravar × erpLer (Tiny, Omie, Bling)');
    await SHC.erpGravar('erp:tiny', { token: 'TOKEN-TINY-XYZ', ultima: { ts: 1, atualizados: 3 } });
    ok(SHC.segredoEh(mem['erp:tiny'].token) && JSON.stringify(mem['erp:tiny']).indexOf('TOKEN-TINY-XYZ') < 0, 'erp:tiny guardado sem o token em texto claro');
    ok(mem['erp:tiny'].ultima && mem['erp:tiny'].ultima.atualizados === 3, 'o que não é segredo (ultima) continua legível');
    const t = await SHC.erpLer('erp:tiny');
    ok(t && t.token === 'TOKEN-TINY-XYZ' && t.ultima.atualizados === 3, 'erpLer devolve o token decifrado e o resto intacto');
    await SHC.erpGravar('erp:omie', { appKey: 'AK-123', appSecret: 'AS-456' });
    ok(SHC.segredoEh(mem['erp:omie'].appKey) && SHC.segredoEh(mem['erp:omie'].appSecret), 'erp:omie com appKey e appSecret cifrados');
    const o = await SHC.erpLer('erp:omie');
    ok(o.appKey === 'AK-123' && o.appSecret === 'AS-456', 'erpLer do Omie devolve os dois decifrados');
    await SHC.erpGravar('erp:bling', { clientId: 'CID', clientSecret: 'CSE', access: 'ACC', refresh: 'REF', expira: 1, reconectar: false });
    const bcr = JSON.stringify(mem['erp:bling']);
    ok(['CID', 'CSE', 'ACC', 'REF'].every(s => bcr.indexOf(s) < 0) && mem['erp:bling'].expira === 1, 'erp:bling sem nenhum segredo em texto claro (expira continua)');
    const b = await SHC.erpLer('erp:bling');
    ok(b.clientId === 'CID' && b.clientSecret === 'CSE' && b.access === 'ACC' && b.refresh === 'REF', 'erpLer do Bling devolve os 4 segredos');

    console.log('3) Migração da 3.3.0 (texto claro → cifrado na 1ª leitura)');
    mem['erp:tiny'] = { token: 'TOKEN-VELHO', ultima: { ts: 2 } };
    const m1 = await SHC.erpLer('erp:tiny');
    ok(m1.token === 'TOKEN-VELHO', 'a leitura do valor antigo funciona (texto claro passa)');
    ok(SHC.segredoEh(mem['erp:tiny'].token) && (await SHC.segredoDecifra(mem['erp:tiny'].token)) === 'TOKEN-VELHO', 'e o storage já foi migrado para cifrado');

    console.log('4) Valor corrompido: nunca apaga, nunca migra em cima');
    const guardado = mem['erp:omie'];
    mem['erp:omie'] = { appKey: 'v1.' + 'A'.repeat(16) + '.lixocorrompido', appSecret: 'AS-777' };
    const q = await SHC.erpLer('erp:omie');
    ok(q.appSecret === 'AS-777' && !('appKey' in q), 'o campo ilegível sai do objeto (o painel pede para conectar de novo), o legível fica');
    ok(mem['erp:omie'].appKey === 'v1.' + 'A'.repeat(16) + '.lixocorrompido' && mem['erp:omie'].appSecret === 'AS-777',
        'o storage NÃO foi tocado (sem migração em cima do ilegível)');

    console.log('5) Demais casos');
    mem['cfg'] = { imposto: 6 };
    const cfg = await SHC.erpLer('cfg');
    ok(cfg && cfg.imposto === 6 && mem['cfg'].imposto === 6, 'chave que não é de ERP passa sem cifrar');
    await SHC.erpGravar('erp:tiny', mem['erp:tiny']);   // o que já está cifrado (leitura crua) não é cifrado de novo
    ok((await SHC.segredoDecifra(mem['erp:tiny'].token)) === 'TOKEN-VELHO', 'erpGravar não recifra o já cifrado (decifra igual)');
    // multiempresa: conta separada → a chave física é erp@<id>:tiny e o segredo continua cifrado
    mem['ml:conta'] = '123456789';
    mem['cfg'] = { empresaSeparada: { '123456789': true } };
    await new Promise(r => setTimeout(r, 1600));   // empCache do store.js (1,5 s)
    await SHC.erpGravar('erp:tiny', { token: 'TOKEN-OUTRA-EMPRESA' });
    ok(mem['erp@123456789:tiny'] && SHC.segredoEh(mem['erp@123456789:tiny'].token), 'empresa separada: segredo cifrado na chave física erp@<id>:tiny');
    const outra = await SHC.erpLer('erp:tiny');
    ok(outra && outra.token === 'TOKEN-OUTRA-EMPRESA', 'erpLer da empresa separada decifra pela chave lógica');

    console.log(falhas ? '\nFALHOU: ' + falhas : '\nTUDO OK');
    process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO:', e); process.exit(1); });
