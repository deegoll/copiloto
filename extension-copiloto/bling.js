// SellerHub Copiloto v3.1 — custos do Bling pela API v3 (OAuth 2.0). A v2 (token simples) foi desligada pelo Bling.
// Sem servidor: cada seller cria o SEU aplicativo no Bling (só leitura de Produtos) e cola aqui o Client ID e o Client Secret.
// Entrada: chrome.identity.launchWebAuthFlow no painel (state aleatório conferido) → o fundo troca o code por tokens.
// access_token vale 6 h (renova sozinho antes de vencer e com 401); refresh_token vale 30 dias (renovar devolve um novo).
// Só LEITURA: GET https://api.bling.com.br/Api/v3/produtos?pagina=N&limite=100&criterio=2 (ativos). Custo = precoCusto (ou fornecedor.precoCusto),
// SKU = codigo. Limite do Bling: 3 pedidos por segundo → no mínimo 400 ms entre pedidos.
// Tudo só em chrome.storage.local 'erp:bling' = {clientId, clientSecret, access, refresh, expira, renovado, ultima} — nunca em log nem na tela.
// Funções puras no topo (tests/copiloto/teste_erp_bling.js); blingPuxar recebe fetch/espera/salvar para rodar em node.
(function (root) {
    'use strict';
    const SHC = root.SHC || (root.SHC = {});
    const AUTORIZA = 'https://www.bling.com.br/Api/v3/oauth/authorize', TOKEN = 'https://www.bling.com.br/Api/v3/oauth/token';
    const PRODUTOS = 'https://api.bling.com.br/Api/v3/produtos', POR_PAGINA = 100;
    SHC.BLING_ORIGENS = ['https://www.bling.com.br/*', 'https://api.bling.com.br/*'];
    SHC.BLING_CHAVE = 'erp:bling';
    const RECONECTAR = 'O Bling pediu para entrar de novo (a conexão vence depois de 30 dias sem uso). Clique em Conectar o Bling de novo.';

    const dec = v => { const n = typeof v === 'number' ? v : parseFloat(String(v === null || v === undefined ? '' : v).trim().replace(',', '.')); return isFinite(n) && n > 0 ? SHC.r2(n) : 0; };
    const b64 = s => (typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'utf8').toString('base64'));

    /** Endereço de volta que o seller cola no aplicativo do Bling (o mesmo que o launchWebAuthFlow usa). */
    SHC.blingRetorno = (runtimeId, identity) => (identity && identity.getRedirectURL ? identity.getRedirectURL('bling') : 'https://' + runtimeId + '.chromiumapp.org/bling');
    /** state aleatório (32 hex). */
    SHC.blingEstado = () => { const a = new Uint8Array(16); root.crypto.getRandomValues(a); return Array.from(a, x => x.toString(16).padStart(2, '0')).join(''); };
    SHC.blingUrlAutorizar = (clientId, state) => AUTORIZA + '?' + new URLSearchParams({ response_type: 'code', client_id: String(clientId || '').trim(), state }).toString();

    /** URL de volta do launchWebAuthFlow → {ok, code} | {ok:false, erro:'state'|'negado'|'outro', msg}. state diferente = recusa (pode ser outro site). */
    SHC.blingLerVolta = function (url, stateEsperado) {
        let q;
        try { q = new URL(String(url || '')).searchParams; } catch (e) { return { ok: false, erro: 'outro', msg: 'O Bling não devolveu a autorização. Tente de novo.' }; }
        if (!stateEsperado || q.get('state') !== stateEsperado) return { ok: false, erro: 'state', msg: 'A resposta do Bling não confere com o pedido. Por segurança, nada foi guardado. Tente de novo.' };
        if (q.get('error')) return { ok: false, erro: 'negado', msg: 'O Bling não autorizou. Clique em Conectar e escolha “Autorizar”.' };
        const code = q.get('code');
        return code ? { ok: true, code } : { ok: false, erro: 'outro', msg: 'O Bling não devolveu a autorização. Tente de novo.' };
    };

    /** POST no /oauth/token (Basic client_id:client_secret). corpo = {grant_type, code} | {grant_type, refresh_token}. */
    SHC.blingPedidoToken = (cred, corpo) => ({
        url: TOKEN,
        init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: '1.0', 'enable-jwt': '1',
                Authorization: 'Basic ' + b64(String(cred.clientId || '').trim() + ':' + String(cred.clientSecret || '').trim()) },
            body: new URLSearchParams(corpo).toString(),
        },
    });

    // Tipo do erro do Bling: {error:'invalid_grant'} ou {error:{type:'invalid_grant', message, description}}.
    const tipoErro = j => String((j && j.error && (typeof j.error === 'string' ? j.error : j.error.type || j.error.message)) || '').toLowerCase();

    /** Resposta do /oauth/token → {ok, tokens:{access, refresh, expira, renovado}} | {ok:false, erro:'reconectar'|'credenciais'|'limite'|'outro', msg}. */
    SHC.blingLerToken = function (j, status, agora) {
        const t = tipoErro(j);
        if (j && j.access_token && j.refresh_token) {
            const ag = agora || Date.now();
            return { ok: true, tokens: { access: String(j.access_token), refresh: String(j.refresh_token), expira: ag + (Number(j.expires_in) > 0 ? Number(j.expires_in) : 21600) * 1000, renovado: ag } };
        }
        if (t === 'invalid_client' || (status === 401 && t !== 'invalid_grant')) return { ok: false, erro: 'credenciais', msg: 'O Bling recusou o Client ID ou o Client Secret. Confira no seu aplicativo do Bling e cole de novo.' };
        if (t === 'invalid_grant') return { ok: false, erro: 'reconectar', msg: RECONECTAR };
        if (status === 429) return { ok: false, erro: 'limite', msg: 'O Bling pediu para esperar (muitos acessos). Tente de novo em alguns minutos.' };
        return { ok: false, erro: 'outro', msg: 'O Bling respondeu com erro' + (t ? ' (' + t.slice(0, 60) + ')' : '') + '. Tente de novo em alguns minutos.' };
    };

    async function pedirToken(cred, corpo, o) {
        const p = SHC.blingPedidoToken(cred, corpo);
        let j = null, status = 0;
        try { const r = await o.fetch(p.url, p.init); status = r.status; j = await r.json().catch(() => null); } catch (e) { throw { erro: 'rede', msg: 'Não consegui falar com o Bling. Confira a internet e tente de novo.' }; }
        const r = SHC.blingLerToken(j, status, o.agora ? o.agora() : Date.now());
        if (!r.ok) throw { erro: r.erro, msg: r.msg };
        return r.tokens;
    }
    /** Troca o code (vale 1 min) pelos tokens. → {access, refresh, expira, renovado}; erro → throw {erro, msg}. */
    SHC.blingTrocarCodigo = (cred, code, o) => pedirToken(cred, { grant_type: 'authorization_code', code: String(code || '') }, o);
    /** Renova com o refresh_token. → tokens novos; refresh vencido/recusado → throw {erro:'reconectar'}. */
    SHC.blingRenovar = (cred, o) => (cred && cred.refresh ? pedirToken(cred, { grant_type: 'refresh_token', refresh_token: cred.refresh }, o)
        : Promise.reject({ erro: 'reconectar', msg: RECONECTAR }));

    /** Página de /produtos → {ok, produtos:[{sku, custo, titulo}], n} | {ok:false, erro:'token'|'escopo'|'limite'|'outro', msg}. */
    SHC.blingLerProdutos = function (j, status) {
        if (status === 401) return { ok: false, erro: 'token', msg: RECONECTAR };
        if (status === 403) return { ok: false, erro: 'escopo', msg: 'O seu aplicativo do Bling não tem permissão de ler Produtos. Marque Produtos (leitura) no aplicativo e conecte de novo.' };
        if (status === 429) return { ok: false, erro: 'limite', msg: 'O Bling pediu para esperar (muitos acessos). Tente de novo em alguns minutos.' };
        if (!j || !Array.isArray(j.data)) return { ok: false, erro: 'outro', msg: 'O Bling respondeu num formato que o Copiloto não conhece' + (tipoErro(j) ? ' (' + tipoErro(j).slice(0, 60) + ')' : '') + '.' };
        const produtos = j.data.map(p => p || {}).map(p => ({
            sku: SHC.normalizaSku(p.codigo),
            custo: dec(p.precoCusto) || dec(p.fornecedor && p.fornecedor.precoCusto),
            titulo: String(p.nome || '').replace(/\s+/g, ' ').trim().slice(0, 120),
        })).filter(p => p.sku);
        return { ok: true, produtos, n: j.data.length };
    };

    /**
     * Lê todas as páginas. cred = erp:bling. opts = { fetch, espera(ms), salvar(tokens) (grava os tokens renovados), progresso(pagina, null),
     * agora(), ritmo (400 ms entre pedidos: limite de 3/s), esperasLimite:[ms…] }. Renova antes de vencer (5 min) e 1 vez com 401.
     * O Bling não diz quantas páginas há: página com menos de 100 = última. → [produtos]; erro → throw {erro, msg}.
     */
    SHC.blingPuxar = async function (cred, opts) {
        const o = Object.assign({ ritmo: 400, esperasLimite: [5e3, 15e3, 30e3], progresso: () => {}, salvar: async () => {}, agora: () => Date.now() }, opts || {});
        if (!cred || !cred.clientId || !cred.clientSecret || !cred.refresh) throw { erro: 'reconectar', msg: RECONECTAR };
        let c = Object.assign({}, cred), ultimoPedido = 0;
        const noRitmo = async () => { const falta = ultimoPedido + o.ritmo - o.agora(); if (ultimoPedido && falta > 0) await o.espera(falta); ultimoPedido = o.agora(); };
        const renovar = async () => { await noRitmo(); const t = await SHC.blingRenovar(c, o); c = Object.assign(c, t); await o.salvar(t); };
        if (!c.access || !(c.expira - o.agora() > 5 * 60e3)) await renovar();
        const todos = [];
        let pagina = 1, renovou = false, tentativa = 0;
        while (pagina <= 1000) {
            await noRitmo();
            let j = null, status = 0;
            try {
                const r = await o.fetch(PRODUTOS + '?' + new URLSearchParams({ pagina: String(pagina), limite: String(POR_PAGINA), criterio: '2' }).toString(),
                    { method: 'GET', headers: { Accept: 'application/json', Authorization: 'Bearer ' + c.access } });
                status = r.status; j = await r.json().catch(() => null);
            } catch (e) { throw { erro: 'rede', msg: 'Não consegui falar com o Bling. Confira a internet e tente de novo.' }; }
            const r = SHC.blingLerProdutos(j, status);
            if (!r.ok && r.erro === 'token' && !renovou) { renovou = true; await renovar(); continue; }
            if (!r.ok && r.erro === 'limite' && tentativa < o.esperasLimite.length) { await o.espera(o.esperasLimite[tentativa++]); continue; }
            if (!r.ok) throw { erro: r.erro === 'token' ? 'reconectar' : r.erro, msg: r.msg };
            tentativa = 0;
            todos.push(...r.produtos);
            o.progresso(pagina, null);
            if (r.n < POR_PAGINA) break;
            pagina++;
        }
        return todos;
    };

    /** "12 custos atualizados (…), 3 SKUs sem custo no Bling, 2 mantidos porque você digitou" (mesma regra do Tiny). */
    SHC.blingResumo = r => SHC.tinyResumo(r).replace(/Tiny/g, 'Bling');

    if (typeof module !== 'undefined' && module.exports) module.exports = SHC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
