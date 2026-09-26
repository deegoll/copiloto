// SellerHub Copiloto — aula guiada para as páginas da extensão (sem dependências).
// SHCTour.iniciar(passos, {aoTerminar}) com passos [{sel, titulo, texto, antes?}]: véu escuro + destaque no alvo (rola até ele),
// balão ao lado com "Anterior", "Próximo", "Sair" e "N de M". Teclado: Esc sai, ← volta, → avança. Alvo que não está na tela é pulado.
// aoTerminar({concluiu, visto}) — concluiu = chegou ao fim; visto = índice do último passo mostrado.
(function (root) {
    'use strict';
    const T = {};

    /** Índice do próximo passo que existe na tela, andando de i na direção dir (1 ou -1). -1 = não há. */
    T.proximoValido = function (passos, i, dir, existe) {
        for (let k = i; k >= 0 && k < passos.length; k += dir) if (existe(passos[k])) return k;
        return -1;
    };
    /**
     * Onde o balão fica: embaixo do alvo se couber, senão em cima, senão por cima do alvo (alvo mais alto que a tela);
     * sempre inteiro dentro da tela. alvo = {top, bottom, left}, balao = {w, h}, tela = {w, h} → {top, left, lado}
     */
    T.posicao = function (alvo, balao, tela) {
        const m = 12;
        let top, lado;
        if (alvo.bottom + m + balao.h <= tela.h) { top = alvo.bottom + m; lado = 'baixo'; }
        else if (alvo.top - m - balao.h >= 0) { top = alvo.top - m - balao.h; lado = 'cima'; }
        else { top = alvo.top + m; lado = 'dentro'; }
        top = Math.max(m, Math.min(tela.h - balao.h - m, top));
        const left = Math.max(m, Math.min(tela.w - balao.w - m, alvo.left));
        return { top: Math.round(top), left: Math.round(left), lado };
    };

    const CSS = '.sht-veu{position:fixed;inset:0;z-index:2147483000;background:transparent}'
        + '.sht-foco{position:fixed;z-index:2147483001;border-radius:12px;box-shadow:0 0 0 4px #38BDF8,0 0 0 9999px rgba(15,23,42,.55);pointer-events:none;transition:top .25s,left .25s,width .25s,height .25s}'
        + '.sht-balao{position:fixed;z-index:2147483002;width:min(340px,calc(100vw - 24px));background:#fff;color:#0F172A;border-radius:14px;padding:14px 16px;box-shadow:0 12px 40px rgba(0,0,0,.3);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}'
        + '.sht-balao h3{margin:0 0 4px;font-size:15.5px}.sht-balao p{margin:0 0 12px;font-size:13.5px;color:#334155}'
        + '.sht-pe{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.sht-n{font-size:12px;color:#64748B;margin-right:auto;font-weight:700}'
        + '.sht-pe button{border:1px solid #CBD5E1;background:#fff;color:#0F172A;border-radius:9px;padding:6px 12px;font:inherit;font-size:13px;font-weight:700;cursor:pointer}'
        + '.sht-pe button.sht-vai{background:#047857;border-color:#047857;color:#fff}.sht-pe button.sht-sai{border:0;background:none;color:#475569;text-decoration:underline;padding:6px 4px}'
        + '.sht-pe button:disabled{opacity:.45;cursor:default}.sht-pe button:focus-visible{outline:2px solid #0EA5E9;outline-offset:2px}'
        + '@media (prefers-reduced-motion:reduce){.sht-foco{transition:none}}';
    function css() {
        if (document.getElementById('sht-css')) return;
        const s = document.createElement('style');
        s.id = 'sht-css'; s.textContent = CSS;
        document.head.appendChild(s);
    }
    const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };

    let atual = null;   // uma aula por vez
    T.iniciar = function (passos, opts) {
        if (typeof document === 'undefined' || !Array.isArray(passos) || !passos.length) return null;
        if (atual) atual.sair();
        css();
        const o = opts || {}, existe = p => !!(p && p.sel && document.querySelector(p.sel));
        const reduz = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
        const veu = el('div', 'sht-veu'), foco = el('div', 'sht-foco'), balao = el('div', 'sht-balao');
        balao.setAttribute('role', 'dialog');
        balao.setAttribute('aria-labelledby', 'sht-tit');
        const tit = el('h3'), txt = el('p'), pe = el('div', 'sht-pe'), n = el('span', 'sht-n');
        tit.id = 'sht-tit';
        const bAnt = el('button', '', 'Anterior'), bProx = el('button', 'sht-vai', 'Próximo'), bSair = el('button', 'sht-sai', 'Sair');
        [bAnt, bProx, bSair].forEach(b => { b.type = 'button'; });
        pe.append(n, bAnt, bProx, bSair);
        balao.append(tit, txt, pe);
        document.body.append(veu, foco, balao);
        let i = -1, quadro = 0, fechado = false;

        function posiciona() {
            quadro = 0;
            if (fechado || i < 0) return;
            const alvo = document.querySelector(passos[i].sel);
            if (!alvo) return ir(i + 1, 1);   // a página redesenhou e o alvo sumiu: segue
            const r = alvo.getBoundingClientRect(), pad = 6;
            Object.assign(foco.style, { top: (r.top - pad) + 'px', left: (r.left - pad) + 'px', width: (r.width + pad * 2) + 'px', height: (r.height + pad * 2) + 'px' });
            const p = T.posicao({ top: r.top - pad, bottom: r.bottom + pad, left: r.left - pad }, { w: balao.offsetWidth, h: balao.offsetHeight }, { w: root.innerWidth, h: root.innerHeight });
            balao.style.top = p.top + 'px'; balao.style.left = p.left + 'px';
        }
        const agenda = () => { if (!quadro) quadro = root.requestAnimationFrame ? root.requestAnimationFrame(posiciona) : setTimeout(posiciona, 16); };

        async function ir(k, dir) {
            if (fechado) return;
            let alvoK = T.proximoValido(passos, k, dir, existe);
            if (alvoK < 0 && dir < 0) alvoK = T.proximoValido(passos, 0, 1, existe);
            if (alvoK < 0) return sair(i >= 0);
            const p = passos[alvoK];
            if (typeof p.antes === 'function') { try { await p.antes(); } catch (e) { /* segue mesmo assim */ } }
            const alvo = document.querySelector(p.sel);
            if (!alvo) return ir(alvoK + (dir || 1), dir || 1);
            i = alvoK;
            const vis = passos.filter(existe), pos = vis.indexOf(p);
            tit.textContent = p.titulo || '';
            txt.textContent = p.texto || '';
            n.textContent = (pos + 1) + ' de ' + vis.length;
            bAnt.disabled = T.proximoValido(passos, i - 1, -1, existe) < 0;
            bProx.textContent = T.proximoValido(passos, i + 1, 1, existe) < 0 ? 'Concluir' : 'Próximo';
            const alto = alvo.getBoundingClientRect().height > root.innerHeight * 0.6;
            alvo.scrollIntoView({ block: alto ? 'start' : 'center', behavior: reduz ? 'auto' : 'smooth' });
            posiciona();
            setTimeout(posiciona, reduz ? 0 : 400);
            bProx.focus({ preventScroll: true });
        }
        const tecla = e => {
            if (e.key === 'Escape') { e.preventDefault(); sair(false); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); ir(i + 1, 1); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); if (!bAnt.disabled) ir(i - 1, -1); }
        };
        const relogio = setInterval(agenda, 500);   // a página pode redesenhar sozinha (sincronização): o destaque acompanha
        function sair(concluiu) {
            if (fechado) return;
            fechado = true;
            clearInterval(relogio);
            document.removeEventListener('keydown', tecla, true);
            root.removeEventListener('scroll', agenda, true);
            root.removeEventListener('resize', agenda);
            [veu, foco, balao].forEach(x => x.remove());
            if (atual === api) atual = null;
            if (typeof o.aoTerminar === 'function') { try { o.aoTerminar({ concluiu: !!concluiu, visto: i }); } catch (e) { /* ok */ } }
        }
        bProx.addEventListener('click', () => ir(i + 1, 1));
        bAnt.addEventListener('click', () => ir(i - 1, -1));
        bSair.addEventListener('click', () => sair(false));
        veu.addEventListener('click', () => bProx.focus());
        document.addEventListener('keydown', tecla, true);
        root.addEventListener('scroll', agenda, true);
        root.addEventListener('resize', agenda);
        const api = { sair: () => sair(false), proximo: () => ir(i + 1, 1), anterior: () => ir(i - 1, -1), get passo() { return i; } };
        atual = api;
        ir(0, 1);
        return api;
    };

    root.SHCTour = T;
    if (typeof module !== 'undefined' && module.exports) module.exports = T;
})(typeof globalThis !== 'undefined' ? globalThis : this);
