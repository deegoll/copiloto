// SellerHub Copiloto v2.2 — ajudante no Canal de transmissão do ML (Marketing › Canal de transmissão).
// Na página do formulário (formulario-produto-promocao) da fila da Agenda: PRÉ-PREENCHE o nome, o texto pronto e,
// se der, a data/hora, e mostra uma barra "confira e clique em Criar". NUNCA clica em "Criar mensagem"/"Criar story"
// nem envia nada: só observa o clique do seller para marcar o item como feito e oferecer o próximo.
// Depende de store.js e agenda-canal.js (SHC.canal*). Para em silêncio se a extensão for recarregada.
(function () {
    'use strict';
    if (typeof window === 'undefined' || window.__SHC_CANAL__ || !window.chrome || !chrome.runtime || !chrome.storage || !window.SHC || !SHC.canalItemDaUrl) return;
    window.__SHC_CANAL__ = true;
    const BASE = 'https://vendedores.mercadolivre.com.br';
    const CHAVE = 'shc:canal:fila';
    const JANELA_CRIAR_MS = 10 * 60 * 1000;   // clicou em Criar há até 10 min e saiu do formulário → feito
    const vivo = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; } };
    const norm = t => String(t || '').replace(/\s+/g, ' ').trim();
    const ehForm = u => /\/formulario-produto-promocao\/?$/.test(new URL(u).pathname);

    let parado = false, timer = 0, href = location.href, idx = -1, preenchido = {}, tentativas = 0;

    // Plano B da Agenda: a aba do ML busca uma página do próprio canal (mesma origem, só leitura).
    chrome.runtime.onMessage.addListener((msg, sender, responder) => {
        if (!msg || msg.acao !== 'canal_ler' || sender.id !== chrome.runtime.id) return false;
        let u;
        try { u = new URL(msg.url); } catch (e) { return false; }
        if (u.origin !== BASE || !/^\/marketing\/canal(-de-transmissao)?\//.test(u.pathname + '/')) return false;
        fetch(u.href, { credentials: 'include', cache: 'no-store' })
            .then(r => r.ok ? r.text().then(texto => responder({ ok: true, texto })) : responder({ ok: false }))
            .catch(() => responder({ ok: false }));
        return true;
    });

    const ler = async () => { try { return await SHC.lerChave(CHAVE); } catch (e) { if (!vivo()) parar(); return null; } };
    const grava = async f => { try { await SHC.gravarChave(CHAVE, f); } catch (e) { if (!vivo()) parar(); } };

    // ── Barra (Shadow DOM fechado: o CSS do ML não entra, o nosso não sai) ──
    let H = null, SR = null;
    function barra() {
        if (H && H.isConnected) return SR;
        H = document.createElement('div');
        H.setAttribute('style', 'all:initial;position:fixed;left:0;right:0;bottom:12px;z-index:2147483647;display:flex;justify-content:center;pointer-events:none');
        SR = H.attachShadow({ mode: 'closed' });
        SR.innerHTML = '<style>:host{all:initial}*{box-sizing:border-box;font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif}'
            + '.b{pointer-events:auto;max-width:640px;margin:0 12px;background:#0F172A;color:#E2E8F0;border-radius:12px;padding:10px 14px;font-size:13px;line-height:1.45;box-shadow:0 12px 32px rgba(0,0,0,.35);display:flex;gap:10px;align-items:center;flex-wrap:wrap}'
            + '.t{flex:1;min-width:220px}.t b{color:#fff}.q{display:block;margin-top:4px;color:#FDE68A;font-weight:700}.q.forte{background:#FDE047;color:#0F172A;border-radius:6px;padding:3px 8px;display:inline-block}'
            + 'button{cursor:pointer;border-radius:7px;font-size:12.5px;font-weight:700;padding:6px 12px;border:1px solid #fff;background:#fff;color:#0F172A}button.sec{background:transparent;color:#E2E8F0;border-color:#475569}</style>'
            + '<div class="b" role="status" aria-live="polite"><div class="t"></div><div class="a"></div></div>';
        ['keydown', 'keyup', 'click', 'mousedown'].forEach(t => SR.addEventListener(t, e => e.stopPropagation()));
        SR.addEventListener('click', e => { const a = e.target.closest && e.target.closest('[data-a]'); if (a) acao(a.getAttribute('data-a')).catch(() => {}); });
        document.documentElement.appendChild(H);
        return SR;
    }
    function mostra(textoHtml, botoes) {
        const sr = barra();
        sr.querySelector('.t').innerHTML = textoHtml;   // só textos nossos + esc() do que veio do storage
        const a = sr.querySelector('.a');
        a.textContent = '';
        botoes.forEach(([id, rot, sec]) => { const b = document.createElement('button'); b.type = 'button'; b.setAttribute('data-a', id); b.textContent = rot; if (sec) b.className = 'sec'; a.append(b); });
    }
    const esconde = () => { if (H) H.remove(); H = null; };
    // Entrada da Agenda nas páginas do canal (sem fila ativa). agenda-canal.html está em web_accessible_resources.
    let fechouEntrada = false;
    const mostraEntrada = () => mostra('<b>Copiloto:</b> monte a agenda da semana do canal com os produtos que dão lucro.', [['abrir_agenda', 'Montar agenda da semana'], ['fechar', '×', true]]);
    const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    async function acao(a) {
        if (a === 'abrir_agenda') { window.open(chrome.runtime.getURL('agenda-canal.html'), '_blank', 'noopener'); return; }
        if (a === 'fechar') { fechouEntrada = true; return esconde(); }
        const f = await ler();
        if (!f) return esconde();
        if (a === 'parar') { f.parada = true; await grava(f); esconde(); return; }
        if (a === 'pular' && idx >= 0 && f.itens[idx]) { f.itens[idx].estado = 'pulado'; await grava(f); }
        if (a === 'pular' || a === 'proximo') {
            const p = SHC.canalProximo(f);
            if (p < 0) { mostraFim(f); return; }
            f.itens[p].estado = 'aberto';
            await grava(f);
            location.href = f.itens[p].url;   // URL montada por SHC.canalUrlFormulario (sempre do ML)
        }
    }
    function mostraFim(f) {
        const c = SHC.canalContagem(f);
        mostra('<b>Copiloto:</b> agenda concluída — ' + c.feitos + ' de ' + c.total + ' criadas no ML' + (c.pulados ? ', ' + c.pulados + ' puladas' : '') + '.', [['parar', 'Fechar', true]]);
    }

    // ── Pré-preenchimento (campos controlados pelo React: setter nativo + eventos) ──
    function poeValor(el, v) {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : (el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype);
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const rotuloDe = el => norm([el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]') && document.querySelector('label[for="' + CSS.escape(el.id) + '"]').textContent,
        el.closest('label') && el.closest('label').textContent].filter(Boolean).join(' '));

    // Cada campo uma vez só (não briga com o que o seller digitar depois). Seletores: a confirmar ao vivo.
    function preenche(it) {
        const form = document.querySelector('main') || document.body;
        if (!preenchido.nome) {
            const nome = [...form.querySelectorAll('input[type="text"],input:not([type])')].find(i => i.maxLength === 60 || /nome/i.test(rotuloDe(i)));
            if (nome) { if (!nome.value) poeValor(nome, it.nome); preenchido.nome = true; }
        }
        if (!preenchido.texto) {
            // Textos prontos do ML: escolhe o primeiro se nenhum estiver marcado (escolher opção não envia nada).
            const radios = [...form.querySelectorAll('input[type="radio"]')].filter(r => {
                const t = norm(rotuloDe(r) || (r.parentElement && r.parentElement.textContent));
                return t.length > 25 && !/seguidor|audi[eê]ncia|interesse|data|hor[aá]rio/i.test(t);   // só os textos prontos, nunca a audiência
            });
            if (radios.length) { if (!radios.some(r => r.checked)) radios[0].click(); preenchido.texto = true; }
        }
        if (!preenchido.quando) {
            const dia = it.dia, hora = String(it.hora).padStart(2, '0') + ':00', dm = dia.slice(8, 10) + '/' + dia.slice(5, 7);
            let ok = 0;
            form.querySelectorAll('input[type="date"]').forEach(i => { poeValor(i, dia); ok++; });
            form.querySelectorAll('input[type="datetime-local"]').forEach(i => { poeValor(i, dia + 'T' + hora); ok += 2; });
            form.querySelectorAll('input[type="time"]').forEach(i => { poeValor(i, hora); ok++; });
            form.querySelectorAll('select').forEach(s => {
                const o = [...s.options].find(x => norm(x.textContent).indexOf(hora) >= 0) || [...s.options].find(x => norm(x.textContent).indexOf(dm) >= 0);
                if (o) { poeValor(s, o.value); ok++; }
            });
            // Uma tentativa que achou qualquer campo encerra (não repõe a hora que o seller mudar); só com dia E hora
            // postos o destaque "Escolha: …" some.
            preenchido.quando = ok > 0;
            preenchido.quandoOk = ok >= 2;
        }
    }

    function barraDoForm(f) {
        const it = f.itens[idx], c = SHC.canalContagem(f), pos = idx + 1;
        const botao = it.tipo === 'story' ? 'Criar story' : 'Criar mensagem';   // rótulo de "ambos": a confirmar ao vivo
        mostra('<b>Copiloto:</b> confira e clique em ' + esc(botao) + ' — ' + pos + ' de ' + c.total
            + '<span class="q' + (preenchido.quandoOk ? '' : ' forte') + '">' + (preenchido.quandoOk ? 'Data e hora: ' : 'Escolha: ') + esc(it.quando) + '</span>',
            [['pular', 'Pular'], ['parar', 'Parar', true]]);
    }

    // O seller clicou em "Criar …" (o Copiloto só observa; não impede nem repete o clique).
    document.addEventListener('click', e => {
        if (parado || idx < 0) return;
        const b = e.target && e.target.closest && e.target.closest('button,[role="button"],a');
        const t = b ? norm(b.textContent) : '';
        const criou = /^criar\b/i.test(t) && !/cupom/i.test(t), saiu = /^sair\b/i.test(t);   // "Sair sem criar" desfaz
        if (!criou && !saiu) return;
        ler().then(f => { if (f && f.itens[idx]) { f.itens[idx].estado = criou ? 'criando' : 'aberto'; f.itens[idx].clicou = criou ? Date.now() : 0; return grava(f); } }).catch(() => {});
    }, { capture: true, passive: true });

    async function confere() {
        if (parado) return;
        if (!vivo()) return parar();
        try {
            const f = await ler();
            if (!f || f.parada || !Array.isArray(f.itens)) { idx = -1; return ehForm(location.href) || fechouEntrada ? esconde() : mostraEntrada(); }
            if (ehForm(location.href)) {
                const i = SHC.canalItemDaUrl(f, location.href);
                if (i < 0) { esconde(); idx = -1; return; }      // formulário aberto à mão: não mexe
                if (i !== idx) { idx = i; preenchido = {}; tentativas = 0; }
                if (f.itens[i].estado === 'pendente') { f.itens[i].estado = 'aberto'; await grava(f); }
                if ((!preenchido.nome || !preenchido.quando) && tentativas++ < 40) preenche(f.itens[i]);
                barraDoForm(f);
                return;
            }
            // Fora do formulário: quem clicou em Criar há pouco vira "feito".
            const agora = Date.now();
            let mudou = false;
            f.itens.forEach(it => { if (it.estado === 'criando' && agora - (it.clicou || 0) < JANELA_CRIAR_MS) { it.estado = 'feito'; mudou = true; } else if (it.estado === 'criando') { it.estado = 'aberto'; mudou = true; } });
            if (mudou) await grava(f);
            idx = -1;
            const p = SHC.canalProximo(f), c = SHC.canalContagem(f);
            if (p < 0) { if (c.total) mostraFim(f); return; }
            mostra('<b>Copiloto:</b> ' + (mudou ? 'feito! ' : '') + c.feitos + ' de ' + c.total + ' criadas. Próxima: ' + esc(f.itens[p].quando) + ' · ' + esc(f.itens[p].titulo.slice(0, 50)),
                [['proximo', 'Abrir a próxima'], ['parar', 'Parar', true]]);
        } catch (e) {
            if (!vivo() || /context invalidated/i.test(String(e && e.message))) parar();
        }
    }
    const agenda = ms => { if (!parado) { clearTimeout(timer); timer = setTimeout(confere, ms); } };

    const obs = new MutationObserver(() => {
        if (parado) return;
        if (location.href !== href) { href = location.href; agenda(0); return; }
        if (idx >= 0 && (!preenchido.nome || !preenchido.quando) && tentativas < 40) agenda(400);
    });
    const aoMudar = (m, area) => { if (area === 'local' && m[CHAVE] && !parado) agenda(100); };
    function parar() {
        if (parado) return;
        parado = true;
        clearTimeout(timer);
        try { obs.disconnect(); } catch (e) { /* ok */ }
        try { chrome.storage.onChanged.removeListener(aoMudar); } catch (e) { /* extensão recarregada */ }
        try { esconde(); } catch (e) { /* ok */ }
    }
    try { chrome.storage.onChanged.addListener(aoMudar); } catch (e) { /* ok */ }
    addEventListener('popstate', () => agenda(0));
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
    agenda(300);
})();
