// Copiloto 3.4.0 — termos por canal (Shopee e Magalu): sem o aceite da versão atual nenhum script do canal é registrado; aceite grava versão e data;
// versão nova pede de novo; desligar desregistra; apagar tira o aceite. Chrome de mentira, dados inventados.
// Rodar:  node tests/copiloto/teste_termos_canais.js
const T = require('../../extension-copiloto/termos-canais.js');
globalThis.CopilotoTermos = T;
// Junção (08/10): o registro é o do PR #11 (etiqueta-fundo.js: SHC.etqSincronizar / SHC.etqLigada), agora com o aceite dos termos.
const SHC = require('../../extension-copiloto/etiqueta-fundo.js');
const R = { sincronizar: () => SHC.etqSincronizar(), ligado: (cfg, c) => SHC.etqLigada(cfg, c) };
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
const SHOPEE = 'https://seller.shopee.com.br/*', MAGALU = 'https://seller.magalu.com/*', MAGALU2 = 'https://magalu-sellers.magalu.com/*';
const SP = 'copiloto-etq-sp-pagina,copiloto-etq-sp-tela', MG = 'copiloto-etq-mg-pagina,copiloto-etq-mg-tela';

(async () => {
    console.log('— sem aceite: nada registra');
    let c = chromeFalso({ etiquetas: { shopee: true, magalu: true } });
    c.dadas.add(SHOPEE); c.dadas.add(MAGALU); c.dadas.add(MAGALU2);   // até com permissão do site e interruptor ligado
    await R.sincronizar();
    ok(c.ids() === '', 'permissão + interruptor, sem aceite: nenhum script registrado');
    ok(R.ligado({ etiquetas: { shopee: true } }, 'shopee') === false, 'R.ligado falso sem cfg.termos');

    console.log('— aceite grava versão e data');
    const reg1 = T.registro(Date.parse('2026-10-07T12:00:00Z'));
    ok(reg1.versao === T.VERSAO && reg1.em === '2026-10-07T12:00:00.000Z', 'registro = {versao, em ISO}');
    c.st.cfg = { etiquetas: { shopee: true, magalu: true }, termos: { shopee: reg1 } };
    await R.sincronizar();
    ok(c.ids() === SP, 'só a Shopee (aceitou); a Magalu segue sem script');
    ok(T.aceito(c.st.cfg, 'shopee') && !T.aceito(c.st.cfg, 'magalu'), 'T.aceito por canal');
    ok(c.reg.every(r => r.matches[0] === SHOPEE) && c.reg.some(r => r.js.indexOf('shopee-lista.js') >= 0 && r.js.indexOf('shopee-tela.js') >= 0), 'os scripts são os da Shopee (com o leitor da lista), no site da Shopee');

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
    ok(c.ids() === [MG, SP].join(), 'os dois aceitos e ligados: os scripts dos dois');
    c.st.cfg = { etiquetas: { shopee: false, magalu: true }, termos: { shopee: reg1, magalu: reg1 } };
    await R.sincronizar();
    ok(c.ids() === MG, 'desligar a Shopee tira só os scripts dela (o aceite fica)');
    const apagado = JSON.parse(JSON.stringify(c.st.cfg)); delete apagado.termos.shopee; delete apagado.etiquetas.shopee;
    c.st.cfg = apagado; c.dadas.delete(SHOPEE); await R.sincronizar();
    ok(!T.aceito(c.st.cfg, 'shopee') && !('shopee' in c.st.cfg.etiquetas) && c.ids() === MG, 'apagar: sem aceite nem interruptor da Shopee');

    console.log('— a Magalu precisa dos 2 sites (Portal e Financeiro)');
    c.dadas.delete(MAGALU2); await R.sincronizar();
    ok(c.ids() === '', 'sem a permissão do magalu-sellers.magalu.com, a Magalu não liga');
    c.dadas.add(MAGALU2);
    // TikTok: a etiqueta vem com a leitura do TikTok (tiktok-tela.js, o consentimento dele); o aceite novo não vale para o TikTok.
    console.log('— textos');
    ['shopee', 'magalu'].forEach(k => {
        const t = T.TEXTOS[k].itens.map(i => i.join(' ')).join(' ');
        ok(/o SKU, o nome, o preço/.test(t) && /visitas/.test(t) && /15 dias/.test(t) && /Nada é enviado|Para lugar nenhum/.test(t) && /Desligue/.test(t) && /apaga/.test(t), k + ': diz o que lê, o que guarda (15 dias), que nada sai e como parar');
    });
    ok(/rascunho/.test(T.VERSAO), 'a versão marca "rascunho" até a dona e o jurídico aprovarem');
    ok(/banco/.test(T.TEXTOS.magalu.itens.map(i => i.join(' ')).join(' ')) && /≈/.test(T.TEXTOS.magalu.itens.map(i => i.join(' ')).join(' ')), 'magalu: nunca os dados do banco; comissão do contrato com "≈"');
    console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nTUDO OK');
    process.exit(falhas ? 1 : 0);
})();
