// SellerHub Copiloto — cartão "Seu plano" em Ajustes (F1). Usa licenca.js. Só MOSTRA o plano: nenhuma aba é travada nesta fase.
// Entrar: pede a permissão opcional 'identity' no clique (como o Bling em painel.js) → launchWebAuthFlow com PKCE S256 e state
// conferido AQUI → manda {acao:'licenca_entrar', code, verifier} para o fundo, que troca pelo passe. Sair: {acao:'licenca_sair'}.
(function () {
    'use strict';
    if (typeof document === 'undefined' || typeof chrome === 'undefined' || !window.SHC || !SHC.licencaPlano) return;
    const $ = s => document.querySelector(s);
    const el = { linha: $('#planoLinha'), aviso: $('#planoAviso'), entrar: $('#planoEntrar'), sair: $('#planoSair'), msg: $('#planoMsg'), ajudaBt: $('#planoAjudaBt'), ajuda: $('#planoAjuda') };
    if (!el.linha || !el.entrar || !el.sair) return;
    const IDENTITY = { permissions: ['identity'] };
    // Último plano mostrado neste Chrome: dá o aviso "seu teste acabou" (1 vez) e evita prometer teste a quem já entrou antes.
    const VISTO = 'licenca:visto';
    let rodando = false, temIdentity = false;
    const ler = k => chrome.storage.local.get(k).then(x => (x || {})[k], () => null);
    const olhaPermissao = () => { try { chrome.permissions.contains(IDENTITY).then(x => { temIdentity = !!x; }, () => {}); } catch (e) { /* sem a API: o pedido explica */ } };

    // Andamento = role status (educado); erro = role alert (interrompe). O papel muda ANTES do texto.
    const msg = (t, erro) => { el.msg.setAttribute('role', erro ? 'alert' : 'status'); el.msg.textContent = t || ''; el.msg.style.color = erro ? 'var(--verm)' : ''; };
    async function desenha() {
        const [p, g, visto] = await Promise.all([SHC.licencaPlano(), ler(SHC.LICENCA_CHAVE), ler(VISTO)]);
        const t = SHC.licencaTexto(p), entrou = !!(g && g.refresh);
        let aviso = t.aviso;
        if (p.estado === 'sem_login' && visto) aviso = 'Entre com o SellerHub para ver o seu plano.';
        if (entrou && p.estado === 'ok' && visto === 'teste' && p.plano === 'gratis') aviso = 'Seu teste acabou. Você está no plano Grátis (1 conta do Mercado Livre).';
        el.linha.textContent = t.linha;
        el.aviso.textContent = aviso;
        el.entrar.style.display = (entrou || t.chromeAntigo) ? 'none' : '';
        el.sair.style.display = entrou ? '' : 'none';
        el.entrar.disabled = el.sair.disabled = rodando;
        if (entrou && p.estado === 'ok' && p.plano !== visto) chrome.storage.local.set({ [VISTO]: p.plano }).catch(() => {});
    }

    async function entrar(pedido) {
        let deu = false;
        try { deu = await pedido; } catch (e) { deu = false; }
        if (!deu) return msg('Sem a permissão do Chrome o Copiloto não consegue abrir a entrada do SellerHub. Clique de novo e escolha “Permitir”.', true);
        temIdentity = true;
        if (rodando) return;
        rodando = true;
        desenha().catch(() => {});
        try {
            const inst = await SHC.licencaInst(), pk = await SHC.licencaPkce(), redirect = SHC.licencaRetorno(chrome.runtime.id);
            msg('Entre na sua conta do SellerHub na janela que abriu e clique em “Permitir”…');
            let volta = '';
            try { volta = await chrome.identity.launchWebAuthFlow({ url: SHC.licencaUrlAutorizar({ redirect, challenge: pk.challenge, state: pk.state, inst }), interactive: true }); }
            catch (e) { throw { msg: 'A janela do SellerHub fechou sem terminar. Se apareceu um aviso lá, siga o que ele disse; senão, clique em “Entrar com o SellerHub” de novo.' }; }
            const v = SHC.licencaLerVolta(volta, pk.state, redirect);
            if (!v.ok) throw { msg: v.msg };
            msg('Conferindo o seu plano…');
            const r = await chrome.runtime.sendMessage({ acao: 'licenca_entrar', code: v.code, verifier: pk.verifier });
            if (!r || !r.ok) throw { msg: (r && r.msg) || 'O SellerHub não respondeu agora. Tente de novo em alguns minutos. O plano Grátis continua funcionando.' };
            msg('✓ Pronto, você entrou.');   // a linha do plano, logo acima, já mostra o resto
        } catch (e) {
            msg((e && e.msg) || 'Não deu certo agora. Tente de novo em alguns minutos. O plano Grátis continua funcionando.', true);
        } finally {
            rodando = false;
            desenha().catch(() => {});
        }
    }

    // A permissão é pedida DENTRO do clique (o Chrome exige o gesto; nada de await antes); o resto espera a resposta.
    // Se ela ainda não foi dada, avisa ANTES que a caixa do Chrome vai aparecer (quem não espera o aviso clica em "Negar").
    el.entrar.addEventListener('click', () => {
        if (!temIdentity) msg('O Chrome vai pedir uma permissão para abrir a entrada do SellerHub. Clique em “Permitir”.');
        entrar(chrome.permissions.request(IDENTITY));
    });
    // "?" do cartão: abre/fecha no clique (e no teclado, que também é clique no botão), com aria-expanded.
    if (el.ajudaBt && el.ajuda) el.ajudaBt.addEventListener('click', () => {
        const abrir = el.ajuda.hidden;
        el.ajuda.hidden = !abrir;
        el.ajudaBt.setAttribute('aria-expanded', String(abrir));
    });
    olhaPermissao();
    el.sair.addEventListener('click', async () => {
        if (rodando) return;
        rodando = true;
        try {
            await chrome.runtime.sendMessage({ acao: 'licenca_sair' });
            msg('Você saiu do SellerHub neste Chrome. O plano Grátis continua funcionando.');
        } catch (e) { msg('Não consegui sair agora. Tente de novo.', true); }
        finally { rodando = false; desenha().catch(() => {}); }
    });
    if (chrome.storage && chrome.storage.onChanged) chrome.storage.onChanged.addListener((mud, area) => { if (area === 'local' && mud[SHC.LICENCA_CHAVE]) desenha().catch(() => {}); });
    desenha().catch(() => {});
    // Abriu o painel com o passe na tolerância (o SellerHub não respondeu da última vez): pede UMA renovação ao fundo (single-flight lá).
    SHC.licencaPlano().then(p => { if (p.estado === 'tolerancia') chrome.runtime.sendMessage({ acao: 'licenca_renovar' }).catch(() => {}); }, () => {});
})();
