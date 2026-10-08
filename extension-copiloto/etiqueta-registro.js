// Copiloto 3.4.0 — registro das etiquetas de ganho por canal (fundo). Cada canal tem os scripts registrados SÓ com: permissão do site + 'scripting'
// concedidas e a etiqueta ligada em Ajustes (cfg.etiquetas[canal]; TikTok: junto com o TikTok ligado e consentido, salvo se a seller desligar a etiqueta).
// Mesmo desenho do SHC.tt.sincronizarScripts. As mensagens: 'etiquetas_sincronizar' (das páginas da extensão) e 'etiqueta_abrir_painel' (da aba do canal).
(function (root) {
    'use strict';
    const SHC = root.SHC || (root.SHC = {}), R = SHC.etqReg = {};
    R.CANAIS = {
        shopee: { origem: 'https://seller.shopee.com.br/*', adaptador: 'shopee-lista.js' },
        tiktok: { origem: 'https://seller-br.tiktok.com/*', adaptador: 'tiktok-lista.js' },
        magalu: { origem: 'https://seller.magalu.com/*', adaptador: 'magalu-lista.js' },
    };
    R.BASE = ['calc.js', 'store.js', 'nucleo/util.js', 'nucleo/modelo.js', 'nucleo/tarifas.js', 'etiqueta-canal.js'];
    R.perm = c => ({ permissions: ['scripting'], origins: [R.CANAIS[c].origem] });
    R.script = c => ({ id: 'copiloto-etq-' + c, matches: [R.CANAIS[c].origem], js: R.BASE.concat(R.CANAIS[c].adaptador), runAt: 'document_idle', persistAcrossSessions: true });
    R.ligado = (cfg, c) => {
        const e = (cfg && cfg.etiquetas) || {};
        if (c === 'tiktok') return e.tiktok !== false && !!(cfg && cfg.consentimento_tiktok) && !!(cfg.modulos && cfg.modulos.tiktok === true);
        // 3.4.0 (termos por canal): Shopee e Magalu só ligam com o aceite da versão ATUAL dos termos (cfg.termos[canal]); sem ele, nenhum script.
        const T = root.CopilotoTermos;
        return e[c] === true && !!T && T.aceito(cfg, c);
    };
    let fila = Promise.resolve();
    const emFila = f => (fila = fila.then(f, f));
    R.sincronizar = () => emFila(async () => {
        const ch = root.chrome;
        if (!ch.scripting || !ch.scripting.registerContentScripts || !ch.permissions || !ch.permissions.contains) return { ok: false, motivo: 'sem_scripting' };
        const cfg = (await ch.storage.local.get('cfg')).cfg || {}, ids = Object.keys(R.CANAIS).map(c => 'copiloto-etq-' + c);
        const ja = (await ch.scripting.getRegisteredContentScripts({ ids })).map(s => s.id), out = {};
        for (const c of Object.keys(R.CANAIS)) {
            const id = 'copiloto-etq-' + c, tem = R.ligado(cfg, c) && await ch.permissions.contains(R.perm(c));
            try {
                if (tem && ja.indexOf(id) < 0) await ch.scripting.registerContentScripts([R.script(c)]);
                if (!tem && ja.indexOf(id) >= 0) await ch.scripting.unregisterContentScripts({ ids: [id] });
                out[c] = tem;
            } catch (e) { out[c] = false; }
        }
        return { ok: true, ligados: out };
    });
        const daAbaDoCanal = s => !!(s && s.id === root.chrome.runtime.id && s.tab && Object.keys(R.CANAIS).some(c => String(s.url || s.tab.url || '').indexOf(R.CANAIS[c].origem.slice(0, -1)) === 0));
    R.instalarFundo = function () {
        const ch = root.chrome;
        ch.runtime.onMessage.addListener((msg, sender, responder) => {
            if (!msg) return false;
            if (msg.acao === 'etiquetas_sincronizar') {
                if (!(sender && sender.id === ch.runtime.id && /^chrome-extension:\/\//.test(sender.url || ''))) return false;
                R.sincronizar().then(responder, () => responder({ ok: false }));
                return true;
            }
            if (msg.acao === 'etiqueta_abrir_painel') {   // o clique em "+ Informar custo" (gesto da seller) abre a página de custos/Ajustes
                if (!daAbaDoCanal(sender)) return false;
                try { ch.tabs.create({ url: ch.runtime.getURL('painel.html#' + (msg.alvo === 'etiquetas' ? 'etiquetas' : 'custos')) }); } catch (e) { /* ok */ }
                responder({ ok: true });
                return false;
            }
            return false;
        });
        if (ch.permissions && ch.permissions.onAdded) { ch.permissions.onAdded.addListener(() => { R.sincronizar().catch(() => {}); }); ch.permissions.onRemoved.addListener(() => { R.sincronizar().catch(() => {}); }); }
        if (ch.storage && ch.storage.onChanged) ch.storage.onChanged.addListener((mud, onde) => {
            if (onde !== 'local' || !mud.cfg) return;
            const a = mud.cfg.oldValue || {}, b = mud.cfg.newValue || {};
            if (Object.keys(R.CANAIS).some(c => R.ligado(a, c) !== R.ligado(b, c))) R.sincronizar().catch(() => {});
        });
        R.sincronizar().catch(() => {});
    };
    if (typeof module === 'object' && module.exports) module.exports = R;
})(typeof globalThis !== 'undefined' ? globalThis : this);
