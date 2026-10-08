// Copiloto 3.4.0 — painel.html: (1) "Escolha com quais canais quer trabalhar" (#escolhaCanais) e (2) o quadro "Etiquetas de ganho" (#etqCanais, só o
// interruptor da etiqueta do TikTok) + a comissão da Magalu.
// Shopee e Magalu: ligar = ABRIR os termos do canal, marcar "Li e concordo" e só então pedir ao Chrome 'scripting' + o site (no mesmo clique, antes de
// qualquer await) e gravar cfg.termos[canal] = {versao, em} + cfg.etiquetas[canal]; o fundo (etiqueta-registro.js) só registra a leitura com o aceite
// da versão atual (termos-canais.js). Desligar = fundo tira a leitura, o Chrome recebe a permissão de volta e a seller escolhe se apaga os dados do canal.
// O ML é automático desde sempre (não muda); o TikTok mantém o fluxo dele (quadro "Concordo e ligar" do painel lateral): aqui só aparece o estado.
(function () {
    'use strict';
    const SHC = globalThis.SHC, T = globalThis.CopilotoTermos, $ = s => document.querySelector(s), esc = $('#escolhaCanais'), box = $('#etqCanais');
    if (!SHC || !T || !(esc || box)) return;
    const CANAIS = [['shopee', 'Shopee', 'https://seller.shopee.com.br/*'], ['magalu', 'Magalu', 'https://seller.magalu.com/*']];
    const TTO = 'https://seller-br.tiktok.com/*';
    const perm = o => ({ permissions: ['scripting'], origins: [o] });
    const msg = t => { const e = $('#okEtq'); if (e) { e.textContent = t; setTimeout(() => { e.textContent = ''; }, 5000); } };
    const el = (tag, txt, cls) => { const e = document.createElement(tag); if (txt) e.textContent = txt; if (cls) e.className = cls; return e; };
    const temPerm = async o => { try { return await chrome.permissions.contains(perm(o)); } catch (e) { return false; } };

    // ── Quadro dos termos (um <dialog> nativo, montado com textContent: nada de HTML vindo de fora) ──
    function termos(id, nome, origem) {
        const d = el('dialog', '', 'modal'), t = T.TEXTOS[id];
        d.setAttribute('aria-label', 'Termos do ' + nome);
        d.appendChild(el('h3', 'Antes de ligar a ' + nome + (T.VERSAO.indexOf('rascunho') > 0 ? ' (texto em revisão)' : '')));
        t.itens.forEach(([a, b]) => { const p = el('p'); p.appendChild(el('b', a + ': ')); p.appendChild(document.createTextNode(b)); d.appendChild(p); });
        d.appendChild(el('p', 'Versão dos termos: ' + T.VERSAO, 'sub'));
        const l = el('label'), cx = el('input'); cx.type = 'checkbox'; cx.id = 'li-' + id;
        l.appendChild(cx); l.appendChild(document.createTextNode(' Li e concordo com os termos da ' + nome)); d.appendChild(l);
        const bs = el('div', '', 'acoes'), nao = el('button', 'Agora não', 'lnk'), sim = el('button', 'Concordo e ligar', 'bt');
        nao.type = sim.type = 'button'; sim.disabled = true; sim.id = 'liga-' + id;
        cx.addEventListener('change', () => { sim.disabled = !cx.checked; });
        nao.addEventListener('click', () => { d.close(); d.remove(); });
        sim.addEventListener('click', () => {
            if (!cx.checked) return;
            let pedido;   // dentro do clique, antes de qualquer await (senão o Chrome recusa)
            try { pedido = chrome.permissions.request(perm(origem)); } catch (e) { pedido = Promise.resolve(false); }
            d.close(); d.remove();
            Promise.resolve(pedido).catch(() => false).then(async ok => {
                if (!ok) { msg('O Chrome não deixou ler este site. Nada foi ligado.'); return; }
                const c = await SHC.lerCfg();
                await SHC.salvarCfg({ termos: Object.assign({}, c.termos, { [id]: T.registro() }), etiquetas: Object.assign({}, c.etiquetas, { [id]: true }) }, { semMarcar: true });
                try { await chrome.runtime.sendMessage({ acao: 'etiquetas_sincronizar' }); } catch (e) { /* ok */ }
                msg(nome + ' ligada. Abra a lista de produtos do canal.');
                desenha();
            }).catch(() => {});
        });
        bs.appendChild(nao); bs.appendChild(sim); d.appendChild(bs);
        document.body.appendChild(d);
        if (d.showModal) d.showModal(); else d.setAttribute('open', '');
    }

    async function desliga(id, nome, origem) {
        const c = await SHC.lerCfg();
        await SHC.salvarCfg({ etiquetas: Object.assign({}, c.etiquetas, { [id]: false }) }, { semMarcar: true });   // o fundo tira a leitura
        try { await chrome.runtime.sendMessage({ acao: 'etiquetas_sincronizar' }); } catch (e) { /* ok */ }
        try { await chrome.permissions.remove({ origins: [origem] }); } catch (e) { /* ok */ }
        let apagar = false;
        try { apagar = window.confirm(nome + ' desligada. Apagar também o aceite e os dados deste canal neste computador? (O custo por SKU vale para todos os canais e fica.)'); } catch (e) { /* ok */ }
        if (apagar) {
            const k = await SHC.lerCfg(), termosR = Object.assign({}, k.termos), etq = Object.assign({}, k.etiquetas);
            delete termosR[id]; delete etq[id];
            await SHC.salvarCfg({ termos: termosR, etiquetas: etq }, { semMarcar: true });
        }
        msg('Desligada.' + (apagar ? ' Dados do canal apagados.' : ''));
        desenha();
    }

    async function desenha() {
        const cfg = await SHC.lerCfg();
        if (esc) {
            esc.textContent = '';
            const linha = (nome, estado, ...extra) => { const l = el('div', '', 'aj-sw'), n = el('span', '', 'nm'); n.appendChild(el('b', nome)); n.appendChild(el('small', ' ' + estado)); l.appendChild(n); extra.forEach(x => l.appendChild(x)); esc.appendChild(l); };
            linha('Mercado Livre', 'sempre ligado: faz parte do Copiloto desde a instalação');
            for (const [id, nome, origem] of CANAIS) {
                const aceito = T.aceito(cfg, id), lig = aceito && (cfg.etiquetas || {})[id] === true && await temPerm(origem);
                const b = el('button', lig ? 'Desligar' : 'Ligar este canal', lig ? 'lnk' : 'bt'); b.type = 'button'; b.id = 'canal-' + id;
                b.addEventListener('click', () => (lig ? desliga(id, nome, origem) : termos(id, nome, origem)));
                linha(nome, lig ? 'ligado (termos aceitos em ' + String(cfg.termos[id].em).slice(0, 10) + ')' : T.pedeNovo(cfg, id) ? 'desligado: os termos mudaram, leia e aceite de novo' : 'desligado: nada é lido', b);
            }
            const ttOn = !!(cfg.consentimento_tiktok && cfg.modulos && cfg.modulos.tiktok === true) && await temPerm(TTO);
            linha('TikTok Shop', ttOn ? 'ligado' : 'desligado: nada é lido', el('small', 'Os termos do TikTok ficam no painel lateral › Ajustes › Canais de venda.'));
            const fim = el('button', cfg.escolha_canais === true ? 'Fechar' : 'Concluir a escolha', 'bt'); fim.type = 'button';
            fim.addEventListener('click', async () => { await SHC.salvarCfg({ escolha_canais: true }, { semMarcar: true }); const s = $('#escolha'); if (s) s.hidden = true; });
            esc.appendChild(fim);
            const s = $('#escolha'); if (s) s.hidden = cfg.escolha_canais === true && location.hash !== '#canais';
        }
        if (box) {   // etiqueta do TikTok: só aparece depois de ligar o canal pelo painel lateral (o aceite é o dele)
            box.textContent = '';
            const ttLigado = !!(cfg.consentimento_tiktok && cfg.modulos && cfg.modulos.tiktok === true);
            const tem = await temPerm(TTO);
            const l = el('label'), cx = el('input'), s = el('small', ttLigado ? '' : ' (ligue o TikTok Shop no painel lateral › Ajustes › Canais de venda)');
            cx.type = 'checkbox'; cx.id = 'etq-tiktok'; cx.checked = (cfg.etiquetas || {}).tiktok !== false && tem && ttLigado; cx.disabled = !ttLigado;
            l.appendChild(cx); l.appendChild(document.createTextNode(' Etiqueta no TikTok Shop')); l.appendChild(s); box.appendChild(l);
            cx.addEventListener('change', async () => {
                const c = await SHC.lerCfg();
                await SHC.salvarCfg({ etiquetas: Object.assign({}, c.etiquetas, { tiktok: cx.checked }) }, { semMarcar: true });
                try { await chrome.runtime.sendMessage({ acao: 'etiquetas_sincronizar' }); } catch (e) { /* ok */ }
                msg(cx.checked ? 'Etiqueta ligada.' : 'Etiqueta desligada.');
            });
        }
        if ($('#magalu_comissao_pct')) {
            $('#magalu_comissao_pct').value = cfg.magalu_comissao_pct > 0 ? String(cfg.magalu_comissao_pct).replace('.', ',') : '';
            $('#magalu_taxa_fixa').value = cfg.magalu_taxa_fixa > 0 ? String(cfg.magalu_taxa_fixa).replace('.', ',') : '';
        }
    }
    const salvar = $('#salvarEtq');
    if (salvar) salvar.addEventListener('click', async () => {
        const c = SHC.num($('#magalu_comissao_pct').value), f = SHC.num($('#magalu_taxa_fixa').value), vazio = v => String(v).trim() === '';
        if ((!vazio($('#magalu_comissao_pct').value) && !(c > 0 && c <= 60)) || (!vazio($('#magalu_taxa_fixa').value) && !(f >= 0 && f <= 1000))) { msg('Use só números: comissão de 0 a 60 e tarifa em reais.'); return; }
        await SHC.salvarCfg({ magalu_comissao_pct: c > 0 ? c : null, magalu_taxa_fixa: f > 0 ? f : null }, { semMarcar: true });
        msg('Salvo.');
    });
    desenha().then(() => { if (location.hash === '#etiquetas') $('#etiquetas').scrollIntoView(); if (location.hash === '#canais' && $('#escolha')) $('#escolha').scrollIntoView(); }).catch(() => {});
})();
