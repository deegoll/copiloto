// SellerHub Copiloto — licença (F1, 30/09/2026): "Entrar com o SellerHub" e o passe do plano, conferido SEM internet.
// Entrada: OAuth 2.0 authorization code + PKCE S256 (sem segredo na extensão). O painel pede a permissão opcional 'identity' no clique
// e abre chrome.identity.launchWebAuthFlow em copiloto_autorizar.php (state aleatório conferido aqui). O fundo troca o code em
// copiloto_token.php e guarda {passe, refresh} só em chrome.storage.local 'licenca'. Renovação: UMA de cada vez (single-flight),
// pelo alarme 'shc-licenca' a cada 24 h ± 2 h. Sair: revoga no servidor e apaga daqui.
// Passe: 'v1.' + b64url(json) + '.' + b64url(assinatura Ed25519 sobre 'v1.' + b64url(json)). json = {iss:'sellerhub', aud:'copiloto',
// kid, sub, plano:'gratis'|'teste'|'pago', mods:[…], vagas_ml, inst: sha256hex(inst), iat, exp (iat + 72 h), tol (s), ate? (fim do teste, epoch)}.
// A chave pública vem EMBUTIDA aqui, por kid (CHAVES). Nunca vem da rede: trocar de chave = versão nova da extensão.
// Tolerâncias (C13): até exp o passe vale; depois, até exp + tol (no máximo 7 dias) — é o caso de o SellerHub não responder;
// invalid_grant (conta revogada, senha trocada, reuso de refresh) → volta para o Grátis na hora e pede para entrar de novo.
// O plano Grátis (lucro por anúncio, visão Geral, 1 conta do ML) NUNCA depende do servidor: sem passe, sem internet ou com erro = Grátis.
// Nesta fase NENHUMA tela é travada: só SHC.licenca.plano() / SHC.licenca.tem(mod) e o "Seu plano: …" em Ajustes.
// Enviado ao servidor (C12), e mais nada: client_id, code, code_verifier, redirect_uri, refresh_token e inst. Nenhum id de conta do ML.
// Funções puras no topo (tests/copiloto/teste_licenca.js); as que falam com a rede recebem {fetch, agora, subtle, armazem, chaves}.
(function (root) {
    'use strict';
    const SHC = root.SHC || (root.SHC = {});

    const SERVIDOR = 'https://especialistaemmarketplace.com.br/sellerhub/';
    const AUTORIZAR = SERVIDOR + 'copiloto_autorizar.php', TOKEN = SERVIDOR + 'copiloto_token.php';
    const CLIENT_ID = 'copiloto', CAMINHO_VOLTA = 'sellerhub';
    const CHAVE = 'licenca', CHAVE_INST = 'licenca:inst';
    const ALARME = 'shc-licenca';
    const DIA_MIN = 1440, VARIA_MIN = 120, REPETE_MIN = 60;   // renova a cada 24 h ± 2 h; sem resposta, tenta de novo em ~1 h
    const TOL_MAX_S = 7 * 86400;                            // aceita no máximo 7 dias depois do exp, mesmo que o passe diga mais
    const TEMPO_MS = 15000;

    // ── CHAVES PÚBLICAS Ed25519 (32 bytes em base64url = 43 caracteres), por kid ─────────────────────────────────────────────
    // PRODUÇÃO: quando o par for gerado no servidor (COPILOTO_LICENCA_SK / COPILOTO_LICENCA_KID no .env de produção), a chave
    // PÚBLICA entra AQUI, com o mesmo kid. Exemplo:  'p2026a': 'AbCd…43 caracteres…',
    // Ainda não existe chave de produção: sem ela, nenhum passe é aceito numa instalação da loja e todo mundo fica no Grátis.
    const CHAVES = {
    };
    // TESTE: o kid 'teste' só é aceito numa instalação de DESENVOLVIMENTO (carregada sem compactação: o manifest não tem update_url).
    // A instalação da loja ignora esta tabela. Para testar ao vivo contra o servidor local, cole aqui a chave PÚBLICA do par de teste
    // (a privada fica só no .env local / arquivo temporário em tests\, nunca neste código).
    const CHAVES_TESTE = {
        teste: null,
    };

    // ── Catálogo (o mesmo nome dos módulos do servidor, core/CopilotoLicenca.php) ──────────────────────────────────────────
    const MODS_GRATIS = ['lucro_anuncio', 'visao_geral'];
    const MODS_PAGOS = ['copiloto_ml', 'copiloto_tiktok', 'copiloto_multi'];
    const NOME_PLANO = { gratis: 'Grátis', teste: 'Teste de 7 dias', pago: 'Completo' };
    const VAGAS_GRATIS = 1, VAGAS_MAX = 50, CONVITE_VAGAS = 3;   // teste de 7 dias: 3 contas do ML (decisão da dona, 30/09)
    const GRATIS = Object.freeze({ plano: 'gratis', nome: NOME_PLANO.gratis, mods: MODS_GRATIS.slice(), vagas_ml: VAGAS_GRATIS });

    // ── base64url e bytes ───────────────────────────────────────────────────────────────────────────────────────────────────
    const b64 = {
        de(s) {
            s = String(s || '');
            if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
            const p = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
            try {
                const bin = typeof atob === 'function' ? atob(p) : Buffer.from(p, 'base64').toString('binary');
                const u = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
                return u;
            } catch (e) { return null; }
        },
        para(bytes) {
            const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
            let bin = '';
            for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
            const s = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
            return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        },
    };
    const utf8 = s => new TextEncoder().encode(String(s));
    const hex = bytes => Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
    const aleatorio = n => { const a = new Uint8Array(n); root.crypto.getRandomValues(a); return a; };
    const subtleDe = o => (o && o.subtle) || (root.crypto && root.crypto.subtle);

    SHC.licencaB64 = b64;
    SHC.LICENCA_CHAVE = CHAVE;
    SHC.LICENCA_ALARME = ALARME;
    SHC.LICENCA_MODS = { gratis: MODS_GRATIS.slice(), pagos: MODS_PAGOS.slice() };

    /** sha256 em hex minúsculo (o servidor guarda e assina sha256(inst) do mesmo jeito: hash('sha256', $inst)). */
    SHC.licencaSha256Hex = async (texto, o) => hex(await subtleDe(o).digest('SHA-256', utf8(texto)));

    /** Instalação de desenvolvimento (sem update_url no manifest) → aceita o kid 'teste'. Loja → só CHAVES. */
    SHC.licencaEhDev = () => { try { return !!(root.chrome && chrome.runtime && chrome.runtime.getManifest && !chrome.runtime.getManifest().update_url); } catch (e) { return false; } };
    /** As chaves públicas que valem nesta instalação. */
    SHC.licencaChaves = () => Object.assign({}, CHAVES, SHC.licencaEhDev() ? CHAVES_TESTE : {});

    // ── PKCE e endereços ──────────────────────────────────────────────────────────────────────────────────────────────────
    /** {verifier (43), challenge = b64url(sha256(verifier)) (43), state (32)}. */
    SHC.licencaPkce = async o => {
        const verifier = b64.para(aleatorio(32));
        const challenge = b64.para(await subtleDe(o).digest('SHA-256', utf8(verifier)));
        return { verifier, challenge, state: b64.para(aleatorio(24)) };
    };
    /** Endereço de volta = https://<ID da extensão>.chromiumapp.org/sellerhub (o servidor aceita só os IDs da lista COPILOTO_EXT_IDS). */
    SHC.licencaRetorno = (runtimeId, identity) => (identity && identity.getRedirectURL ? identity.getRedirectURL(CAMINHO_VOLTA) : 'https://' + runtimeId + '.chromiumapp.org/' + CAMINHO_VOLTA);
    SHC.licencaUrlAutorizar = p => AUTORIZAR + '?' + new URLSearchParams({
        response_type: 'code', client_id: CLIENT_ID, redirect_uri: p.redirect, code_challenge: p.challenge,
        code_challenge_method: 'S256', state: p.state, inst: p.inst,
    }).toString();

    /** URL de volta do launchWebAuthFlow → {ok, code} | {ok:false, erro:'state'|'negado'|'outro', msg}. state diferente = recusa. */
    SHC.licencaLerVolta = function (url, stateEsperado, redirect) {
        let u;
        try { u = new URL(String(url || '')); } catch (e) { return { ok: false, erro: 'outro', msg: 'O SellerHub não devolveu a autorização. Tente de novo.' }; }
        if (redirect && (u.origin + u.pathname) !== redirect) return { ok: false, erro: 'outro', msg: 'A resposta não veio do endereço esperado. Por segurança, nada foi guardado. Tente de novo.' };
        const q = u.searchParams;
        if (!stateEsperado || q.get('state') !== stateEsperado) return { ok: false, erro: 'state', msg: 'A resposta do SellerHub não confere com o pedido. Por segurança, nada foi guardado. Tente de novo.' };
        if (q.get('error')) return { ok: false, erro: 'negado', msg: 'Você não permitiu a entrada. Quando quiser, clique em “Entrar com o SellerHub” de novo.' };
        const code = q.get('code');
        return code && /^[A-Za-z0-9_-]{16,128}$/.test(code) ? { ok: true, code } : { ok: false, erro: 'outro', msg: 'O SellerHub não devolveu a autorização. Tente de novo.' };
    };

    // ── Passe: leitura e conferência (offline) ────────────────────────────────────────────────────────────────────────────
    /**
     * Confere o passe: formato, kid conhecido, assinatura Ed25519 (WebCrypto), iss/aud e o inst DESTA instalação.
     * o = {chaves, instHash, subtle}. → {ok:true, dados} | {ok:false, motivo}.
     * Não olha o relógio (isso é do licencaAvaliar), para o mesmo passe poder valer na tolerância.
     */
    SHC.licencaConferir = async function (passe, o) {
        const s = String(passe || '');
        const m = /^v1\.([A-Za-z0-9_-]{10,4096})\.([A-Za-z0-9_-]{86})$/.exec(s);
        if (!m) return { ok: false, motivo: 'formato' };
        let dados;
        try { dados = JSON.parse(new TextDecoder().decode(b64.de(m[1]))); } catch (e) { return { ok: false, motivo: 'formato' }; }
        if (!dados || typeof dados !== 'object') return { ok: false, motivo: 'formato' };
        const chaves = (o && o.chaves) || SHC.licencaChaves();
        const pub = typeof dados.kid === 'string' && Object.prototype.hasOwnProperty.call(chaves, dados.kid) ? chaves[dados.kid] : null;
        if (!pub) return { ok: false, motivo: 'kid' };
        const pubBytes = b64.de(pub), assinatura = b64.de(m[2]);
        if (!pubBytes || pubBytes.length !== 32 || !assinatura || assinatura.length !== 64) return { ok: false, motivo: 'kid' };
        let valida = false;
        try {
            const sub = subtleDe(o);
            const chave = await sub.importKey('raw', pubBytes, { name: 'Ed25519' }, false, ['verify']);
            valida = await sub.verify({ name: 'Ed25519' }, chave, assinatura, utf8('v1.' + m[1]));
        } catch (e) { return { ok: false, motivo: 'cripto' }; }   // Chrome sem Ed25519 (antes do 137): fica no Grátis
        if (!valida) return { ok: false, motivo: 'assinatura' };
        if (dados.iss !== 'sellerhub' || dados.aud !== 'copiloto') return { ok: false, motivo: 'emissor' };
        if (!(Number(dados.exp) > 0) || !(Number(dados.iat) > 0) || Number(dados.exp) <= Number(dados.iat)) return { ok: false, motivo: 'datas' };
        if (!o || !o.instHash || typeof dados.inst !== 'string' || dados.inst.toLowerCase() !== String(o.instHash).toLowerCase()) return { ok: false, motivo: 'inst' };
        return { ok: true, dados };
    };

    /** Plano de um passe já conferido (null = Grátis). Os módulos do Grátis sempre entram. */
    SHC.licencaPlanoDe = function (dados) {
        const plano = dados && (dados.plano === 'teste' || dados.plano === 'pago') ? dados.plano : 'gratis';
        if (plano === 'gratis') return Object.assign({}, GRATIS, { mods: MODS_GRATIS.slice() });
        const mods = MODS_GRATIS.concat((Array.isArray(dados.mods) ? dados.mods : []).filter(x => typeof x === 'string' && /^[a-z_]{2,40}$/.test(x)));
        const v = Math.floor(Number(dados.vagas_ml));
        const r = { plano, nome: NOME_PLANO[plano], mods: mods.filter((x, i) => mods.indexOf(x) === i), vagas_ml: v >= 1 ? Math.min(v, VAGAS_MAX) : VAGAS_GRATIS };
        if (plano === 'teste' && Number(dados.ate) > 0) r.teste_ate = Number(dados.ate) * 1000;   // fim do teste (o passe leva 'ate' em epoch)
        return r;
    };

    /**
     * Plano valendo AGORA. conf = resultado de licencaConferir (ou null sem passe); guardado = chrome.storage 'licenca'; agora em ms.
     * → {plano, nome, mods, vagas_ml, estado:'sem_login'|'pede_login'|'invalido'|'ok'|'tolerancia'|'vencido', exp?, ate?}
     */
    SHC.licencaAvaliar = function (conf, guardado, agora) {
        const g = guardado || {};
        if (!g.passe) return Object.assign(SHC.licencaPlanoDe(null), { estado: g.pedeLogin ? 'pede_login' : 'sem_login' });
        if (!conf || !conf.ok) return Object.assign(SHC.licencaPlanoDe(null), { estado: 'invalido', motivo: conf && conf.motivo });
        const d = conf.dados, t = Math.floor((agora || Date.now()) / 1000), exp = Number(d.exp);
        const tol = Math.max(0, Math.min(Number(d.tol) > 0 ? Number(d.tol) : 0, TOL_MAX_S));
        if (t < exp) return Object.assign(SHC.licencaPlanoDe(d), { estado: 'ok', exp: exp * 1000 });
        if (t < exp + tol) return Object.assign(SHC.licencaPlanoDe(d), { estado: 'tolerancia', exp: exp * 1000, ate: (exp + tol) * 1000 });
        return Object.assign(SHC.licencaPlanoDe(null), { estado: 'vencido', exp: exp * 1000 });
    };

    /** Chrome sem Ed25519 no WebCrypto (antes do 137): entrar de novo não resolve, atualizar o Chrome resolve. */
    const MSG_CHROME_ANTIGO = 'Este Chrome é antigo demais para conferir o plano. Atualize o Chrome (versão 137 ou mais nova) em Menu > Ajuda > Sobre o Google Chrome. Enquanto isso, o plano Grátis continua funcionando.';
    SHC.LICENCA_MSG_CHROME = MSG_CHROME_ANTIGO;
    /** "Entrar" sem login: o que se ganha (fica visível, não só no "?"). */
    SHC.LICENCA_MSG_CONVITE = 'Entre para testar 7 dias com tudo liberado e até ' + CONVITE_VAGAS + ' contas do Mercado Livre. Sem cartão.';

    /** "Seu plano: …" para Ajustes (texto curto, pt-BR simples). agora em ms (padrão: Date.now()). */
    SHC.licencaTexto = function (p, agora) {
        const dia = ms => { const d = new Date(ms); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0'); };
        const contas = p.vagas_ml === 1 ? '1 conta do Mercado Livre' : 'até ' + p.vagas_ml + ' contas do Mercado Livre';
        let linha = 'Seu plano: ' + p.nome + ' · ' + contas;
        if (p.plano === 'teste' && p.teste_ate > 0) {
            const faltam = Math.max(0, Math.ceil((p.teste_ate - (agora || Date.now())) / 864e5));
            linha = 'Seu plano: ' + p.nome + ' · acaba em ' + dia(p.teste_ate) + ' (' + (faltam === 1 ? 'falta 1 dia' : 'faltam ' + faltam + ' dias') + ') · ' + contas;
        }
        if (p.estado === 'tolerancia') return { linha, aviso: 'Não consegui falar com o SellerHub. O seu plano continua até ' + dia(p.ate) + '; o Copiloto tenta de novo sozinho.' };
        if (p.estado === 'pede_login') return { linha, aviso: 'O SellerHub pediu para você entrar de novo (a senha mudou ou a entrada foi encerrada). Clique em “Entrar com o SellerHub”.' };
        if (p.estado === 'vencido') return { linha, aviso: 'Faz mais de 7 dias que o Copiloto não fala com o SellerHub. Confira a internet ou entre de novo.' };
        if (p.estado === 'invalido' && p.motivo === 'cripto') return { linha, aviso: MSG_CHROME_ANTIGO, chromeAntigo: true };
        if (p.estado === 'invalido') return { linha, aviso: 'Não consegui conferir o seu plano neste Chrome. Entre de novo com o SellerHub.' };
        if (p.estado === 'sem_login') return { linha, aviso: SHC.LICENCA_MSG_CONVITE };
        return { linha, aviso: '' };
    };

    // ── Armazenamento, instalação e rede ──────────────────────────────────────────────────────────────────────────────────
    const armazemPadrao = () => ({
        ler: async k => ((await chrome.storage.local.get(k)) || {})[k],
        gravar: async (k, v) => chrome.storage.local.set({ [k]: v }),
        apagar: async k => chrome.storage.local.remove(k),
    });
    const deps = o => Object.assign({
        fetch: (u, i) => root.fetch(u, Object.assign({}, i, (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? { signal: AbortSignal.timeout(TEMPO_MS) } : {})),
        agora: () => Date.now(),
    }, o || {}, { armazem: (o && o.armazem) || armazemPadrao() });

    /** inst: 32 bytes aleatórios gerados UMA vez nesta instalação (não muda em atualização). Cria se faltar. */
    SHC.licencaInst = async function (o) {
        const a = deps(o).armazem;
        let inst = await a.ler(CHAVE_INST);
        if (typeof inst !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(inst)) { inst = b64.para(aleatorio(32)); await a.gravar(CHAVE_INST, inst); }
        return inst;
    };

    /** POST form-urlencoded (pedido simples: sem preflight de CORS; sem cookie). → {status, j} | {rede:true}. */
    async function postar(corpo, o) {
        try {
            const r = await o.fetch(TOKEN, { method: 'POST', credentials: 'omit', cache: 'no-store', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(corpo).toString() });
            let j = null;
            try { j = await r.json(); } catch (e) { j = null; }
            return { status: r.status, j };
        } catch (e) { return { rede: true }; }
    }
    // Resposta do token → 'ok' | 'recusado' (invalid_grant: cai para o Grátis na hora) | 'indisponivel' (servidor fora, 5xx, 429, rede: mantém).
    function tipoResposta(r) {
        if (r.rede) return 'indisponivel';
        const e = String((r.j && r.j.error) || '').toLowerCase();
        if (r.status === 200 && r.j && r.j.passe && r.j.refresh_token) return 'ok';
        if (e === 'invalid_grant' || r.status === 401) return 'recusado';
        return 'indisponivel';
    }
    const MSG_FORA = 'O SellerHub não respondeu agora. Tente de novo em alguns minutos. O plano Grátis continua funcionando.';

    // Cache em memória da conferência (a assinatura só é conferida de novo quando o passe muda).
    let cache = { passe: null, instHash: null, conf: null };
    async function conferirGuardado(g, o) {
        if (!g || !g.passe) return null;
        const inst = await SHC.licencaInst(o), instHash = await SHC.licencaSha256Hex(inst, o);
        if (!o.chaves && cache.passe === g.passe && cache.instHash === instHash) return cache.conf;
        const conf = await SHC.licencaConferir(g.passe, { chaves: o.chaves, instHash, subtle: o.subtle });
        if (!o.chaves) cache = { passe: g.passe, instHash, conf };
        return conf;
    }

    /** Plano valendo agora (nunca lança: qualquer erro = Grátis). */
    SHC.licencaPlano = async function (opts) {
        try {
            const o = deps(opts), g = (await o.armazem.ler(CHAVE)) || null;
            return SHC.licencaAvaliar(await conferirGuardado(g, o), g, o.agora());
        } catch (e) { return Object.assign(SHC.licencaPlanoDe(null), { estado: 'sem_login' }); }
    };

    /**
     * Troca o code pelo passe (grant_type=authorization_code). p = {code, verifier, redirect}. Confere o passe ANTES de guardar.
     * → {ok:true, plano} | {ok:false, erro:'recusado'|'indisponivel'|'passe', msg}.
     */
    SHC.licencaTrocarCodigo = async function (p, opts) {
        const o = deps(opts), inst = await SHC.licencaInst(o);
        const r = await postar({ grant_type: 'authorization_code', code: String(p.code || ''), code_verifier: String(p.verifier || ''), redirect_uri: String(p.redirect || ''), client_id: CLIENT_ID, inst }, o);
        const tipo = tipoResposta(r);
        if (tipo === 'recusado') return { ok: false, erro: 'recusado', msg: 'O SellerHub não aceitou a entrada (ela vale só 1 minuto). Clique em “Entrar com o SellerHub” de novo.' };
        if (tipo !== 'ok') return { ok: false, erro: 'indisponivel', msg: (r.j && r.j.error === 'indisponivel') ? 'A entrada pelo SellerHub ainda não está disponível. O plano Grátis continua funcionando.' : MSG_FORA };
        const conf = await SHC.licencaConferir(r.j.passe, { chaves: o.chaves, instHash: await SHC.licencaSha256Hex(inst, o), subtle: o.subtle });
        if (!conf.ok) return { ok: false, erro: 'passe', msg: conf.motivo === 'cripto' ? MSG_CHROME_ANTIGO : 'O passe do SellerHub não confere com esta versão do Copiloto. Atualize a extensão e tente de novo.' };
        const agora = o.agora();
        await o.armazem.gravar(CHAVE, { passe: r.j.passe, refresh: String(r.j.refresh_token), desde: agora, renovadoEm: agora, falhaEm: null });
        return { ok: true, plano: SHC.licencaAvaliar(conf, { passe: r.j.passe }, agora) };
    };

    // ── Renovação ÚNICA (single-flight) ───────────────────────────────────────────────────────────────────────────────────
    // Alarme e painel pedindo juntos recebem a MESMA promessa: um refresh só vai ao servidor, e o servidor não vê "reuso" falso.
    let emVoo = null;
    /**
     * grant_type=refresh_token. → {ok:true, plano} | {ok:false, erro:'sem_login'|'recusado'|'indisponivel'|'passe', plano}.
     * recusado (invalid_grant) → apaga passe e refresh, marca pedeLogin → Grátis na hora. indisponivel → mantém (vale a tolerância).
     */
    SHC.licencaRenovar = function (opts) {
        if (emVoo) return emVoo;
        emVoo = (async () => {
            const o = deps(opts), g = (await o.armazem.ler(CHAVE)) || null;
            if (!g || !g.refresh) return { ok: false, erro: 'sem_login', plano: await SHC.licencaPlano(opts) };
            const inst = await SHC.licencaInst(o);
            const r = await postar({ grant_type: 'refresh_token', refresh_token: g.refresh, inst }, o);
            const tipo = tipoResposta(r);
            if (tipo === 'recusado') {
                await o.armazem.gravar(CHAVE, { pedeLogin: true, saiuEm: o.agora() });
                return { ok: false, erro: 'recusado', plano: await SHC.licencaPlano(opts) };
            }
            if (tipo === 'ok') {
                const conf = await SHC.licencaConferir(r.j.passe, { chaves: o.chaves, instHash: await SHC.licencaSha256Hex(inst, o), subtle: o.subtle });
                // O refresh novo SEMPRE é guardado (o antigo já foi girado no servidor; guardar o velho viraria "reuso" na próxima vez).
                // Passe que não confere não entra: fica o anterior (vale até exp + tol) e o próximo alarme tenta de novo.
                await o.armazem.gravar(CHAVE, Object.assign({}, g, { refresh: String(r.j.refresh_token), falhaEm: conf.ok ? null : o.agora() },
                    conf.ok ? { passe: r.j.passe, renovadoEm: o.agora() } : {}));
                return conf.ok ? { ok: true, plano: await SHC.licencaPlano(opts) } : { ok: false, erro: 'passe', plano: await SHC.licencaPlano(opts) };
            }
            await o.armazem.gravar(CHAVE, Object.assign({}, g, { falhaEm: o.agora() }));
            return { ok: false, erro: 'indisponivel', plano: await SHC.licencaPlano(opts) };
        })().catch(() => ({ ok: false, erro: 'indisponivel', plano: Object.assign(SHC.licencaPlanoDe(null), { estado: 'sem_login' }) }))
            .finally(() => { emVoo = null; });
        return emVoo;
    };

    /** Sair: revoga no servidor (action=revogar; a resposta não importa) e apaga passe e refresh daqui. O inst fica. */
    SHC.licencaSair = async function (opts) {
        const o = deps(opts), g = (await o.armazem.ler(CHAVE)) || null;
        if (emVoo) await emVoo.catch(() => {});
        if (g && g.refresh) await postar({ action: 'revogar', refresh_token: g.refresh }, o);
        await o.armazem.apagar(CHAVE);
        cache = { passe: null, instHash: null, conf: null };
        return { ok: true };
    };

    /** Minutos até a próxima tentativa: 24 h ± 2 h depois de renovar; ~1 h depois de falha; 1 min se o passe já venceu. */
    SHC.licencaProximaMin = function (resultado, sorteio) {
        const s = typeof sorteio === 'number' ? sorteio : Math.random();
        if (resultado && resultado.ok) return Math.round(DIA_MIN - VARIA_MIN + s * 2 * VARIA_MIN);
        if (resultado && resultado.erro === 'indisponivel') return Math.round(REPETE_MIN - 10 + s * 20);
        return null;   // sem login / recusado / passe inválido: não agenda (entrar de novo agenda)
    };
    /** Agenda (ou tira) o alarme 'shc-licenca' conforme o resultado da última renovação. */
    SHC.licencaAgendar = function (resultado, alarms, sorteio) {
        const a = alarms || (root.chrome && chrome.alarms);
        if (!a) return null;
        const min = SHC.licencaProximaMin(resultado, sorteio);
        try {
            if (min === null) { if (a.clear) a.clear(ALARME); }
            else a.create(ALARME, { delayInMinutes: min });
        } catch (e) { /* sem alarme: a próxima abertura do Chrome confere (licencaPreparar) */ }
        return min;
    };
    /** Abertura do Chrome / instalação: cria o inst e garante o alarme. Passe vencido (ou perto de vencer) → renova em 1 min. */
    SHC.licencaPreparar = async function (opts) {
        const o = deps(opts);
        await SHC.licencaInst(o);
        const g = (await o.armazem.ler(CHAVE)) || null, a = (o.alarms) || (root.chrome && chrome.alarms);
        if (!g || !g.refresh || !a) return null;
        const existe = a.get ? await Promise.resolve(a.get(ALARME)).catch(() => null) : null;
        const p = await SHC.licencaPlano(opts), falta = p.exp ? p.exp - o.agora() : 0;
        if (!existe || falta < 12 * 3600e3) { a.create(ALARME, { delayInMinutes: falta < 12 * 3600e3 ? 1 : SHC.licencaProximaMin({ ok: true }) }); return true; }
        return false;
    };

    /** API para as telas (nenhuma é travada nesta fase). */
    SHC.licenca = {
        plano: opts => SHC.licencaPlano(opts),
        tem: async (mod, opts) => MODS_GRATIS.indexOf(mod) >= 0 || (await SHC.licencaPlano(opts)).mods.indexOf(mod) >= 0,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = SHC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
