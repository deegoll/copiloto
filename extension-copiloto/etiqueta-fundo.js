// Copiloto · fundo das etiquetas de ganho nos outros canais (N-C Shopee; a Magalu entra na mesma lista quando o retrato M3 chegar).
// Igual ao TikTok (SHC.tt.sincronizarScripts): NENHUM content_script fixo no site do canal. Os scripts da etiqueta só são registrados com
// as 2 permissões OPCIONAIS concedidas no clique de Ajustes ('scripting' + o site do canal) E cfg.etiquetas[canal] === true salvo.
// Desligou ou devolveu a permissão: os scripts saem na hora. Nada é gravado: a lista do canal fica só na aba (shopee-tela.js).
(function (root) {
    'use strict';
    const SHC = root.SHC = root.SHC || {};
    // Os arquivos do mundo isolado: a conta (calc, store, núcleo, etiqueta) + o desenho + o canal privado com a página.
    const ISOLADO = ['calc.js', 'store.js', 'nucleo/util.js', 'nucleo/modelo.js', 'nucleo/tarifas.js', 'nucleo/etiqueta.js', 'nucleo/adaptador.js'];
    SHC.ETQ_CANAIS = {
        shopee: { nome: 'Shopee', origens: ['https://seller.shopee.com.br/*'],
            scripts: [
                { id: 'copiloto-etq-sp-pagina', js: ['shopee-pagina.js'], world: 'MAIN' },
                { id: 'copiloto-etq-sp-tela', js: ISOLADO.concat(['nucleo/adaptadores/shopee.js', 'etiqueta-canal.js', 'etiqueta-tela.js', 'shopee-tela.js']) },
            ] },
        // N-D: o Portal do Seller (seller.magalu.com, docs/canais/magalu.md) e o magalu-sellers.magalu.com (Financeiro, retrato M3).
        // As APIs lidas (api-product*.magalu.com) não precisam de permissão: o script só vê a resposta que a própria página recebeu.
        magalu: { nome: 'Magalu', origens: ['https://seller.magalu.com/*', 'https://magalu-sellers.magalu.com/*'],
            scripts: [
                { id: 'copiloto-etq-mg-pagina', js: ['magalu-pagina.js'], world: 'MAIN' },
                { id: 'copiloto-etq-mg-tela', js: ISOLADO.concat(['nucleo/adaptadores/magalu.js', 'etiqueta-canal.js', 'etiqueta-tela.js', 'magalu-tela.js']) },
            ] },
    };
    SHC.etqPerm = canal => ({ permissions: ['scripting'], origins: SHC.ETQ_CANAIS[canal].origens.slice() });
    SHC.etqLigada = (cfg, canal) => !!(cfg && cfg.etiquetas && cfg.etiquetas[canal] === true);
    const registro = c => SHC.ETQ_CANAIS[c].scripts.map(s => Object.assign({ matches: SHC.ETQ_CANAIS[c].origens.slice(), runAt: 'document_start', persistAcrossSessions: true }, s));
    let fila = Promise.resolve();
    const emFila = f => { const p = fila.then(() => f()); fila = p.catch(() => {}); return p; };

    /** Scripts registrados ⇔ permissões concedidas E a etiqueta do canal ligada e SALVA em Ajustes. → { canal: true|false } */
    SHC.etqSincronizar = () => emFila(async () => {
        const ch = root.chrome, out = {};
        if (!ch || !ch.scripting || !ch.scripting.registerContentScripts || !ch.permissions || !ch.permissions.contains) return out;
        const cfg = (await ch.storage.local.get('cfg')).cfg || {};
        for (const c of Object.keys(SHC.ETQ_CANAIS)) {
            const ss = registro(c), ids = ss.map(s => s.id);
            const reg = await ch.scripting.getRegisteredContentScripts({ ids }), ja = reg.map(s => s.id);
            const tem = SHC.etqLigada(cfg, c) && await ch.permissions.contains(SHC.etqPerm(c));
            if (tem) {
                const falta = ss.filter(s => ja.indexOf(s.id) < 0);
                if (falta.length) await ch.scripting.registerContentScripts(falta);
                const velhos = ss.filter(s => reg.some(r => r.id === s.id && (r.js || []).join() !== s.js.join()));   // extensão atualizada: lista nova
                if (velhos.length && ch.scripting.updateContentScripts) await ch.scripting.updateContentScripts(velhos);
            }
            else if (ja.length) await ch.scripting.unregisterContentScripts({ ids: ja });
            out[c] = !!tem;
        }
        return out;
    });

    SHC.etqInstalarFundo = function () {
        const ch = root.chrome;
        if (!ch || !ch.runtime) return;
        if (ch.permissions && ch.permissions.onAdded) {
            ch.permissions.onAdded.addListener(() => { SHC.etqSincronizar().catch(() => {}); });
            ch.permissions.onRemoved.addListener(() => { SHC.etqSincronizar().catch(() => {}); });
        }
        if (ch.storage && ch.storage.onChanged) ch.storage.onChanged.addListener((mud, onde) => {
            if (onde !== 'local' || !mud.cfg) return;
            const antes = (mud.cfg.oldValue || {}).etiquetas || {}, depois = (mud.cfg.newValue || {}).etiquetas || {};
            if (Object.keys(SHC.ETQ_CANAIS).some(c => (antes[c] === true) !== (depois[c] === true))) SHC.etqSincronizar().catch(() => {});
        });
        // O painel (Ajustes) pede a sincronização ao desligar, ANTES de devolver as permissões (sem 'scripting' o fundo não desregistra mais).
        ch.runtime.onMessage.addListener((msg, sender, responder) => {
            if (!msg || msg.acao !== 'etq_sincronizar' || !(sender && sender.id === ch.runtime.id && /^chrome-extension:\/\//.test(sender.url || ''))) return false;
            SHC.etqSincronizar().then(responder, () => responder({}));
            return true;
        });
        SHC.etqSincronizar().catch(() => {});   // a cada início do fundo (depois de atualizar a extensão, os scripts voltam)
    };
    if (typeof module === 'object' && module.exports) module.exports = SHC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
