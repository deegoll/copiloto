// Copiloto 3.4.0 — termos por canal (Shopee e Magalu): sem o aceite da versão atual nenhum script do canal é registrado; aceite grava versão e data;
// versão nova pede de novo; desligar desregistra; apagar tira o aceite. Chrome de mentira, dados inventados.
// Rodar:  node tests/copiloto/teste_termos_canais.js
const T = require('../../extension-copiloto/termos-canais.js');
globalThis.CopilotoTermos = T;
const R = require('../../extension-copiloto/etiqueta-registro.js');
let falhas = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) falhas++; };

function chromeFalso(cfg) {
    const reg = [], dadas = new Set(), st = { cfg };
    globalThis.chrome = {
        storage: { local: { get: async () => ({ cfg: st.cfg }) } },
        permissions: { contains: async p => (p.origins || []).every(o => dadas.has(o)) },
        scripting: {
            getRegisteredContentScripts: async q => reg.filter(s => q.ids.indexOf(s.id) >= 0),
            registerContentScripts: async l => { reg.push(...l); },
            unregisterContentScripts: async q => { for (let i = reg.length - 1; i >= 0; i--) if (q.ids.indexOf(reg[i].id) >= 0) reg.splice(i, 1); },
        },
    };
    return { reg, dadas, st, ids: () => reg.map(s => s.id).sort().join() };
}
const SHOPEE = 'https://seller.shopee.com.br/*', MAGALU = 'https://seller.magalu.com/*';

(async () => {
    console.log('— sem aceite: nada registra');
    let c = chromeFalso({ etiquetas: { shopee: true, magalu: true } });
    c.dadas.add(SHOPEE); c.dadas.add(MAGALU);   // até com permissão do site e interruptor ligado
    await R.sincronizar();
    ok(c.ids() === '', 'permissão + interruptor, sem aceite: nenhum script registrado');
    ok(R.ligado({ etiquetas: { shopee: true } }, 'shopee') === false, 'R.ligado falso sem cfg.termos');

    console.log('— aceite grava versão e data');
    const reg1 = T.registro(Date.parse('2026-10-07T12:00:00Z'));
    ok(reg1.versao === T.VERSAO && reg1.em === '2026-10-07T12:00:00.000Z', 'registro = {versao, em ISO}');
    c.st.cfg = { etiquetas: { shopee: true, magalu: true }, termos: { shopee: reg1 } };
    await R.sincronizar();
    ok(c.ids() === 'copiloto-etq-shopee', 'só a Shopee (aceitou); a Magalu segue sem script');
    ok(T.aceito(c.st.cfg, 'shopee') && !T.aceito(c.st.cfg, 'magalu'), 'T.aceito por canal');
    ok(c.reg[0].matches[0] === SHOPEE && c.reg[0].js.indexOf('shopee-lista.js') >= 0, 'o script é o da lista da Shopee, no site da Shopee');

    console.log('— aceite sem a permissão do Chrome: nada');
    c.dadas.delete(SHOPEE); await R.sincronizar();
    ok(c.ids() === '', 'sem permissão do site, o script sai');
    c.dadas.add(SHOPEE);

    console.log('— versão nova pede de novo');
    c.st.cfg = { etiquetas: { shopee: true }, termos: { shopee: { versao: '3.3.9-antiga', em: reg1.em } } };
    await R.sincronizar();
    ok(c.ids() === '', 'termos antigos aceitos: o script sai até aceitar a versão nova');
    ok(T.pedeNovo(c.st.cfg, 'shopee') && !T.aceito(c.st.cfg, 'shopee'), 'pedeNovo = true, aceito = false');
    ok(!T.pedeNovo({}, 'shopee') && !T.pedeNovo({ termos: {} }, 'magalu'), 'quem nunca aceitou não é "mudou": é primeira vez');

    console.log('— desligar desregistra; apagar tira o aceite');
    c.st.cfg = { etiquetas: { shopee: true, magalu: true }, termos: { shopee: reg1, magalu: reg1 } };
    c.dadas.add(MAGALU); await R.sincronizar();
    ok(c.ids() === 'copiloto-etq-magalu,copiloto-etq-shopee', 'os dois aceitos e ligados: os dois scripts');
    c.st.cfg = { etiquetas: { shopee: false, magalu: true }, termos: { shopee: reg1, magalu: reg1 } };
    await R.sincronizar();
    ok(c.ids() === 'copiloto-etq-magalu', 'desligar a Shopee tira só o script dela (o aceite fica)');
    const apagado = JSON.parse(JSON.stringify(c.st.cfg)); delete apagado.termos.shopee; delete apagado.etiquetas.shopee;
    c.st.cfg = apagado; c.dadas.delete(SHOPEE); await R.sincronizar();
    ok(!T.aceito(c.st.cfg, 'shopee') && !('shopee' in c.st.cfg.etiquetas) && c.ids() === 'copiloto-etq-magalu', 'apagar: sem aceite nem interruptor da Shopee');

    console.log('— TikTok segue o fluxo dele (consentimento próprio), sem o aceite novo');
    c.st.cfg = { consentimento_tiktok: { versao: '3.3.0', em: reg1.em }, modulos: { tiktok: true } };
    c.dadas.add('https://seller-br.tiktok.com/*'); await R.sincronizar();
    ok(c.ids() === 'copiloto-etq-tiktok', 'TikTok consentido e ligado: etiqueta liga como antes');
    c.st.cfg = { modulos: { tiktok: true } }; await R.sincronizar();
    ok(c.ids() === '', 'TikTok sem consentimento: nada');

    console.log('— textos');
    ['shopee', 'magalu'].forEach(k => {
        const t = T.TEXTOS[k].itens.map(i => i.join(' ')).join(' ');
        ok(/preço e o SKU/.test(t) && /Nada é enviado|Para lugar nenhum/.test(t) && /Desligue/.test(t), k + ': diz o que lê, que nada sai e como parar');
    });
    ok(/rascunho/.test(T.VERSAO), 'a versão marca "rascunho" até a dona e o jurídico aprovarem');
    console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nTUDO OK');
    process.exit(falhas ? 1 : 0);
})();
