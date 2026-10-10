// ── Segredos de integração (3.3.1; exigência da análise de SI de 09/10/2026): chaves, api-keys, senhas e tokens dos ERPs nunca
// em texto claro no chrome.storage.local. AES-256-GCM (WebCrypto, "criptografia forte" do parecer), chave única por instalação,
// gerada no 1º uso e guardada em 'shc:segredo:v1' (JWK). IV novo a cada gravação. Nada disso vai para log nem para a tela.
// Limite honesto (registrado no mapa do sistema): quem tem a sessão do Windows aberta lê a chave junto — a proteção é contra
// cópia do storage para fora do perfil (backup, sincronização do navegador, inspeção casual); a defesa em profundidade é a
// senha do Windows. ──
(function (root) {
    'use strict';
    const SHC = root.SHC || (root.SHC = {});
    const CHAVE = 'shc:segredo:v1', PREFIXO = 'v1.';
    let _k = null;   // CryptoKey em memória (um por contexto: fundo, painel, painel lateral)
    const b64 = b => btoa(String.fromCharCode.apply(null, new Uint8Array(b)));
    const desb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
    // Chave da instalação: lê a guardada; se não há, gera e grava. Releitura final = convergência: se dois contextos gerarem ao
    // mesmo tempo, vale a que ficou gravada (o já cifrado nunca vira ilegível por corrida de 1ª geração).
    async function chave() {
        if (_k) return _k;
        const imp = jwk => crypto.subtle.importKey('jwk', jwk, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
        const tem = await SHC.lerChave(CHAVE);
        if (tem && tem.kty) return _k = await imp(tem);
        const nova = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
        await SHC.gravarChave(CHAVE, await crypto.subtle.exportKey('jwk', nova));
        const ficou = await SHC.lerChave(CHAVE);
        return _k = await imp(ficou);
    }
    SHC.segredoEh = v => typeof v === 'string' && v.indexOf(PREFIXO) === 0;
    /** texto → 'v1.<b64 iv>.<b64 ct>'. Vazio/não-texto passa como está. */
    SHC.segredoCifra = async function (txt) {
        if (typeof txt !== 'string' || !txt) return txt;
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await chave(), new TextEncoder().encode(txt));
        return PREFIXO + b64(iv.buffer) + '.' + b64(ct);
    };
    /** 'v1.…' → texto | null (chave trocada ou valor corrompido). Texto claro (antes da 3.3.1) passa como está — a migração cifra na releitura. */
    SHC.segredoDecifra = async function (v) {
        if (!SHC.segredoEh(v)) return v;
        try {
            const p = v.split('.');
            const b = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: desb64(p[1]) }, await chave(), desb64(p[2]));
            return new TextDecoder().decode(b);
        } catch (e) { return null; }   // NUNCA apaga o guardado: o painel mostra "conectar de novo"
    };
    // Os campos secretos de cada ERP (o ERP é o final da chave lógica: 'erp:tiny' → tiny, 'erp@123:tiny' → tiny).
    SHC.ERP_SEGREDOS = { tiny: ['token'], omie: ['appKey', 'appSecret'], bling: ['clientId', 'clientSecret', 'access', 'refresh'] };
    const segredosDe = ch => SHC.ERP_SEGREDOS[String(ch || '').split(':').pop()] || [];
    /**
     * Chave lógica de ERP → o objeto com os campos secretos DECIFRADOS (pronto para usar). A = área da empresa (SHC.areaEmpresa(…));
     * sem ela, a da empresa aberta. Texto claro de versão anterior é devolvido E regravado cifrado (migração na 1ª leitura).
     * Campo que não decifra sai do objeto (o painel pede para conectar de novo) e nada é regravado — o ilegível nunca é tocado.
     */
    SHC.erpLer = async function (ch, A) {
        A = A || SHC.areaEmpresa();
        const o = (await A.get(ch))[ch] || null;
        if (!o || typeof o !== 'object') return o;
        const campos = segredosDe(ch);
        if (!campos.length) return o;
        const r = Object.assign({}, o);
        let migra = false, quebrado = false;
        for (const c of campos) {
            const v = o[c];
            if (typeof v !== 'string' || !v) continue;
            if (SHC.segredoEh(v)) { const d = await SHC.segredoDecifra(v); if (d === null) { quebrado = true; delete r[c]; } else r[c] = d; }
            else migra = true;
        }
        if (migra && !quebrado) await SHC.erpGravar(ch, r, A).catch(() => {});   // sem crypto (ambiente de teste) fica para a próxima leitura
        return r;
    };
    /** Grava o objeto do ERP com os campos secretos CIFRADOS (o que já está cifrado não é cifrado de novo). A = área da empresa. */
    SHC.erpGravar = async function (ch, o, A) {
        A = A || SHC.areaEmpresa();
        const campos = segredosDe(ch), x = Object.assign({}, o);
        for (const c of campos) if (typeof x[c] === 'string' && x[c] && !SHC.segredoEh(x[c])) x[c] = await SHC.segredoCifra(x[c]);
        await A.set({ [ch]: x });
    };
})(typeof self !== 'undefined' ? self : globalThis);
