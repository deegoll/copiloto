// Copiloto 3.4.0 — etiqueta de ganho nas listas de produtos da Shopee, do TikTok Shop e da Magalu ("Sobra R$ X · margem Y%"), como a do ML.
// Roda como script de conteúdo (mundo isolado), registrado por etiqueta-registro.js só quando a seller liga o canal e o Chrome deu a permissão do site.
// Cada canal tem um adaptador (shopee-lista.js, tiktok-lista.js, magalu-lista.js) que só diz ONDE estão as linhas e o preço/SKU que a tela já mostra:
//   SHC.etiquetaCanal.iniciar({ canal: 'shopee'|'tiktok'|'magalu', urlOk: () => bool, linhas: () => Element[],
//       ler: linha => ({ preco, sku, titulo, ancora, itens? }) | null })
//   • preco em reais (número) e ancora = o elemento do PREÇO (a etiqueta entra logo depois dele). itens (opcional, linha-mãe de produto com
//     variações): [{ preco, sku }] de cada variação; a etiqueta mostra a faixa só quando TODAS têm custo (senão "N de M com custo").
// Regras (CONTRATO-ETIQUETAS.md): só LÊ o DOM (nenhuma requisição, nada sai do computador); só INSERE a pílula (Shadow DOM) ao lado do preço, nunca
// altera, clica nem escreve na página do canal. Custo = o do SKU (SHC.chaveSku/lerCustos/custoDeAnuncio), igual para todos os canais. Conta: Shopee pelo
// SHC.calcular('sp') (tabela do núcleo), TikTok pelo núcleo (CopilotoNucleo.tarifas.simular, a mesma conta do TT.simular), Magalu pela comissão que a seller
// informou (cfg.magalu_comissao_pct; sem ela "comissão da Magalu não informada"). Valor desconhecido = "não lido", nunca 0 nem chute.
(function (root) {
    'use strict';
    const SHC = root.SHC || (root.SHC = {});
    const E = SHC.etiquetaCanal = {};

    E.CANAIS = {
        shopee: { nome: 'Shopee', calc: 'sp' },
        tiktok: { nome: 'TikTok Shop', calc: 'tiktok' },
        magalu: { nome: 'Magalu', calc: 'magalu' },
    };
    const MAX_LINHAS = 400, INTERVALO_MIN_MS = 400;
    const num = v => (SHC.num ? SHC.num(v) : (typeof v === 'number' && isFinite(v) ? v : null));
    const r2 = v => Math.round((v + (v >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;

    // ── Textos ────────────────────────────────────────────────────────────────────────────────────────────────────
    const moeda = v => SHC.moeda(v);
    const rsCurto = v => (Math.abs(v - Math.round(v)) < 1e-9 ? 'R$ ' + String(Math.round(v)) : moeda(v));   // "R$ 6" · "R$ 211,45"
    const pctTxt = v => (v < 0 ? '−' : '') + Math.abs(v).toFixed(1).replace('.', ',') + '%';
    const pctCurto = v => String(Math.round(v * 100) / 100).replace('.', ',') + '%';

    /** A etiqueta está ligada para este canal? Shopee e Magalu só com cfg.etiquetas[canal] === true; TikTok liga junto com o TikTok, a não ser que a seller a desligue. */
    E.ligada = (canal, cfg) => {
        const e = (cfg && cfg.etiquetas) || {};
        return canal === 'tiktok' ? e.tiktok !== false : e[canal] === true;
    };

    // ── Conta (função pura: roda em teste) ────────────────────────────────────────────────────────────────────────
    function estadoDe(sobraPct, alvo) {
        return sobraPct < 0 ? 'prejuizo' : (sobraPct < alvo ? 'apertado' : 'ok');
    }
    function viraEtiqueta(canal, preco, custoRs, outros, cfg, b) {
        // b = { sobra_rs, sobra_pct, comissao (texto), imposto_pct, aviso }
        const alvo = num(cfg.margem_alvo_pct) || 0, estado = estadoDe(b.sobra_pct, alvo), perda = b.sobra_rs < 0;
        const partes = ['custo ' + moeda(custoRs + (outros || 0)), b.comissao];
        partes.push('imposto ' + pctCurto(b.imposto_pct));
        if (b.aviso) partes.push(b.aviso);
        return {
            estado, canal, preco: r2(preco), sobra_rs: b.sobra_rs, sobra_pct: b.sobra_pct, custo_rs: r2(custoRs + (outros || 0)),
            linha1: (perda ? 'Prejuízo ' + moeda(Math.abs(b.sobra_rs)) : 'Sobra ' + moeda(b.sobra_rs)) + ' · ' + pctTxt(b.sobra_pct),
            linha2: partes.join(' · '),
            dica: 'Estimativa do Copiloto com o preço desta tela e o custo que você informou. Não inclui frete, Ads nem desconto da plataforma. Meta de margem: ' + pctCurto(alvo) + '.',
            acao: null,
        };
    }
    /** Texto da comissão do TikTok pelas linhas do núcleo: "comissão 6% + R$ 6 · programa de frete 6%". */
    function textoTarifasTikTok(linhas) {
        const com = linhas.filter(l => l.tipo === 'comissao'), fixo = linhas.filter(l => l.tipo === 'taxa_fixa'), sfp = linhas.filter(l => l.tipo === 'programa_frete');
        let t = 'comissão ' + (com.length ? pctCurto(com.reduce((a, l) => a + (l.pct || 0), 0)) : '0%');
        const f = fixo.reduce((a, l) => a + (l.valor || 0), 0);
        if (f > 0) t += ' + ' + rsCurto(f);
        if (sfp.length) t += ' · programa de frete ' + pctCurto(sfp.reduce((a, l) => a + (l.pct || 0), 0));
        linhas.filter(l => l.tipo !== 'comissao' && l.tipo !== 'taxa_fixa' && l.tipo !== 'programa_frete').forEach(l => { t += ' · ' + l.tipo.replace(/_/g, ' ') + ' ' + (l.pct ? pctCurto(l.pct) : rsCurto(l.valor)); });
        return t;
    }

    /**
     * Uma conta só. leitura = { preco, sku }; custos = o que SHC.lerCustos devolveu; cfg = SHC.lerCfg().
     * → { estado: 'ok'|'apertado'|'prejuizo'|'sem_custo'|'sem_leitura', linha1, linha2, dica, acao: 'custo'|'comissao'|null, … }
     */
    E.modelo = function (canal, leitura, custos, cfg) {
        cfg = Object.assign({}, SHC.PADRAO || {}, cfg || {});
        const info = E.CANAIS[canal];
        const sem = (linha1, linha2, acao, dica) => ({ estado: 'sem_leitura', canal, linha1, linha2: linha2 || '', dica: dica || '', acao: acao || null });
        if (!info) return sem('canal desconhecido');
        const preco = num(leitura && leitura.preco);
        if (!(preco > 0)) return sem('preço não lido', 'o Copiloto só lê o que a tela mostra');
        const sku = String((leitura && leitura.sku) || '').trim();
        let comissaoMagalu = null;
        if (canal === 'magalu') {
            comissaoMagalu = num(cfg.magalu_comissao_pct);
            if (!(comissaoMagalu > 0 && comissaoMagalu <= 60)) return sem('comissão da Magalu não informada', 'informe a % que a Magalu cobra de você', 'comissao',
                'A Magalu não publica uma tabela única: o Copiloto usa a % que você informar em Ajustes. Sem ela, não mostra número.');
        }
        if (!sku) return sem('SKU não lido', 'a linha não mostra o SKU: sem ele não dá para achar o custo');
        const r = SHC.custoDeAnuncio(custos || {}, { sku });
        const custo = r ? num(r.dados.custo) : null, outros = r ? (num(r.dados.outros) || 0) : 0;
        if (!(custo > 0)) return { estado: 'sem_custo', canal, sku, titulo: String((leitura && leitura.titulo) || ''), linha1: '+ Informar custo', linha2: 'SKU ' + SHC.normalizaSku(sku), dica: 'Informe o custo deste SKU uma vez: ele vale para todos os canais.', acao: 'custo' };

        const imposto = num(cfg.imposto_pct) || 0;
        if (canal === 'shopee') {
            const c = SHC.calcular('sp', preco, { custo, outros }, cfg);
            if (!c || c.sobra_rs === null) return sem('não calculado', 'sem a tabela de tarifas da Shopee');
            if (c.tarifa_aviso) return sem('tarifa da Shopee não lida', c.tarifa_aviso);
            return viraEtiqueta(canal, preco, custo, outros, cfg, { sobra_rs: c.sobra_rs, sobra_pct: c.sobra_pct, imposto_pct: c.imposto_pct,
                comissao: 'comissão ' + pctCurto(c.comissao_pct) + (c.taxa_fixa_rs > 0 ? ' + ' + rsCurto(c.taxa_fixa_rs) : '') });
        }
        if (canal === 'tiktok') {
            const CN = root.CopilotoNucleo;
            if (!CN || !CN.tarifas || !CN.modelo) return sem('tarifa do TikTok não lida', 'o núcleo de tarifas não carregou');
            const s = CN.tarifas.simular('tiktok', preco, { custo, outros, imposto_pct: imposto, margem_alvo_pct: num(cfg.margem_alvo_pct) || 0 });
            if (!s || CN.modelo.ehNaoLido(s) || s.lucro === null) return sem('tarifa do TikTok não lida', (s && s.motivo) || '');
            return viraEtiqueta(canal, preco, custo, outros, cfg, { sobra_rs: s.lucro, sobra_pct: s.margem_pct, imposto_pct: imposto, comissao: textoTarifasTikTok(s.linhas) });
        }
        // Magalu: só a comissão informada (e a tarifa fixa por item, se a seller a informou). Nenhum número suposto.
        const fixo = num(cfg.magalu_taxa_fixa), fixoRs = fixo > 0 ? fixo : 0;
        const comissaoRs = r2(preco * comissaoMagalu / 100), impostoRs = r2(preco * imposto / 100);
        const sobra = r2(preco - comissaoRs - fixoRs - custo - outros - impostoRs), pct = Math.round(sobra / preco * 1000) / 10;
        return viraEtiqueta(canal, preco, custo, outros, cfg, { sobra_rs: sobra, sobra_pct: pct, imposto_pct: imposto,
            comissao: 'comissão ' + pctCurto(comissaoMagalu) + (fixoRs > 0 ? ' + ' + rsCurto(fixoRs) : ''), aviso: fixoRs > 0 ? '' : 'tarifa fixa não informada' });
    };

    /** Linha-mãe com variações: a faixa só quando todos os SKUs têm custo; senão "N de M com custo". */
    E.modeloVariacoes = function (canal, itens, custos, cfg) {
        const ms = itens.map(i => E.modelo(canal, i, custos, cfg));
        const n = ms.length, calc = ms.filter(m => m.sobra_rs !== undefined), semLeitura = ms.find(m => m.estado === 'sem_leitura');
        if (calc.length === n) {
            const ordem = { prejuizo: 3, apertado: 2, ok: 1 }, pior = calc.reduce((a, m) => (ordem[m.estado] > ordem[a.estado] ? m : a), calc[0]);
            const sobras = calc.map(m => m.sobra_rs), pcts = calc.map(m => m.sobra_pct);
            const a = Math.min.apply(null, sobras), b = Math.max.apply(null, sobras), pa = Math.min.apply(null, pcts), pb = Math.max.apply(null, pcts);
            const igual = a === b;
            return { estado: pior.estado, canal, variacoes: n, sobra_rs: a, sobra_pct: pa,
                linha1: (a < 0 && b <= 0 ? 'Prejuízo ' : 'Sobra ') + (igual ? moeda(Math.abs(a) * (a < 0 ? -1 : 1)) : moeda(a) + ' a ' + moeda(b)) + ' · ' + (igual ? pctTxt(pa) : pctTxt(pa) + ' a ' + pctTxt(pb)),
                linha2: n + ' variações com custo', dica: pior.dica, acao: null };
        }
        if (semLeitura && !calc.length && ms.every(m => m.estado === 'sem_leitura')) return semLeitura;
        if (ms.some(m => m.acao === 'comissao')) return ms.find(m => m.acao === 'comissao');
        return { estado: 'sem_custo', canal, variacoes: n, linha1: calc.length + ' de ' + n + ' com custo', linha2: calc.length ? 'complete o custo das outras' : 'informe o custo dos SKUs',
            dica: 'A faixa só aparece quando todos os SKUs da linha têm custo.', acao: 'custo' };
    };

    // ── Desenho (Shadow DOM: o CSS do site não entra e o nosso não vaza) ─────────────────────────────────────────
    const CSS = ':host{all:initial}.p{font:12px/1.25 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;display:inline-block;max-width:100%;box-sizing:border-box;padding:3px 8px;border-radius:6px;border:1px solid transparent;color:#222;background:#f3f4f6}'
        + '.l1{display:block;font-weight:700;font-size:12px}.l2{display:block;font-size:10.5px;opacity:.85;margin-top:1px}'
        + '.ok{background:#e6f6ec;border-color:#9bd3b0;color:#0b5c2a}.apertado{background:#fff3d6;border-color:#f0cd7a;color:#7a4e00}.prejuizo{background:#fde7e7;border-color:#f0a3a3;color:#9a1212}'
        + '.sem_custo{background:#eef4ff;border-color:#a9c3f0;color:#1a4aa0;border-style:dashed}.sem_leitura{background:#f3f4f6;border-color:#d1d5db;color:#4b5563}'
        + 'button{all:unset;cursor:pointer;font-weight:700;font-size:12px;text-decoration:underline}button:focus-visible{outline:2px solid currentColor;outline-offset:2px}'
        + '.pop{display:block;margin-top:6px;padding:8px;border:1px solid #a9c3f0;border-radius:8px;background:#fff;color:#1f2937;box-shadow:0 4px 14px rgba(0,0,0,.18);font:12px/1.3 system-ui,sans-serif;min-width:170px}'
        + '.pop b{display:block;margin-bottom:5px}.pop input{all:unset;display:block;box-sizing:border-box;width:100%;padding:5px 7px;border:1px solid #9ca3af;border-radius:5px;background:#fff;font-size:13px}'
        + '.pop input:focus{border-color:#1a4aa0;box-shadow:0 0 0 2px #cfe0ff}.pop .err{display:block;min-height:0;color:#b91c1c;font-size:11px;margin-top:3px}'
        + '.pop .acoes{display:flex;gap:8px;margin-top:6px}.pop .sv{background:#1a4aa0;color:#fff;text-decoration:none;padding:4px 10px;border-radius:5px}.pop .cn{color:#4b5563}';
    const dados = new WeakMap();   // ancora → { host, chave }
    const TXT = 'data-copiloto-etq-host';
    const ehNosso = n => !!(n && n.nodeType === 1 && n.hasAttribute && n.hasAttribute(TXT));

    function monta(host, vm, aoClicar) {
        const doc = host.ownerDocument || root.document, sombra = host.shadowRoot || host.attachShadow({ mode: 'open' });
        while (sombra.firstChild) sombra.removeChild(sombra.firstChild);
        const css = doc.createElement('style'); css.textContent = CSS; sombra.appendChild(css);
        const p = doc.createElement('span'); p.className = 'p ' + vm.estado; if (vm.dica) p.setAttribute('title', vm.dica);
        p.setAttribute('role', 'status');
        const l1 = doc.createElement('span'); l1.className = 'l1';
        if (vm.acao) {
            const b = doc.createElement('button'); b.setAttribute('type', 'button'); b.className = 'b'; b.textContent = vm.linha1;
            b.addEventListener('click', e => {
                try { e.preventDefault(); e.stopPropagation(); } catch (x) { /* ok */ }
                if (vm.acao === 'custo' && vm.sku) abreCusto(sombra, doc, vm); else aoClicar(vm.acao);   // 1 SKU: janelinha aqui mesmo; várias variações: painel
            });
            l1.appendChild(b);
        } else l1.textContent = vm.linha1;
        p.appendChild(l1);
        if (vm.linha2) { const l2 = doc.createElement('span'); l2.className = 'l2'; l2.textContent = vm.linha2; p.appendChild(l2); }
        sombra.appendChild(p);
    }

    // Janelinha "Informar custo" (como a do ML): digita o custo do SKU, salva em SHC.salvarCustoSku (vale para todos os canais) e a etiqueta
    // se recalcula sozinha pelo storage.onChanged. Nada é escrito na página do canal.
    function abreCusto(sombra, doc, vm) {
        const velha = sombra.querySelector('.pop'); if (velha) { velha.remove(); return; }
        const pop = doc.createElement('div'); pop.className = 'pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Informar custo do SKU');
        const t = doc.createElement('b'); t.textContent = 'Custo do SKU ' + SHC.normalizaSku(vm.sku); pop.appendChild(t);
        const inp = doc.createElement('input'); inp.type = 'text'; inp.setAttribute('inputmode', 'decimal'); inp.setAttribute('placeholder', 'Ex.: 250,00'); inp.setAttribute('aria-label', 'Custo em reais'); pop.appendChild(inp);
        const err = doc.createElement('span'); err.className = 'err'; pop.appendChild(err);
        const linha = doc.createElement('span'); linha.className = 'acoes';
        const ok = doc.createElement('button'); ok.type = 'button'; ok.className = 'sv'; ok.textContent = 'Salvar';
        const no = doc.createElement('button'); no.type = 'button'; no.className = 'cn'; no.textContent = 'Cancelar';
        linha.appendChild(ok); linha.appendChild(no); pop.appendChild(linha);
        const salva = async () => {
            const v = SHC.num(inp.value);
            if (!(v > 0)) { err.textContent = 'Digite um valor maior que zero. Ex.: 250,00'; return; }
            ok.disabled = true;
            try { await SHC.salvarCustoSku(vm.sku, { custo: SHC.r2 ? SHC.r2(v) : v, titulo: String(vm.titulo || '').slice(0, 120), origem: 'manual' }); pop.remove(); }
            catch (e) { err.textContent = 'Não consegui salvar. Recarregue a página e tente de novo.'; ok.disabled = false; }
        };
        const para = e => { try { e.stopPropagation(); } catch (x) { /* ok */ } };
        ['click', 'mousedown', 'mouseup', 'keyup', 'keypress'].forEach(n => pop.addEventListener(n, para));   // o site não vê o que se digita
        pop.addEventListener('keydown', e => { para(e); if (e.key === 'Enter') { e.preventDefault(); salva(); } else if (e.key === 'Escape') pop.remove(); });
        ok.addEventListener('click', salva); no.addEventListener('click', () => pop.remove());
        sombra.appendChild(pop);
        try { inp.focus(); } catch (e) { /* ok */ }
    }

    // ── Motor ─────────────────────────────────────────────────────────────────────────────────────────────────────
    let atual = null;
    E.parar = () => { if (atual) atual.parar(); };
    E.iniciar = function (adaptador) {
        if (atual) atual.parar();
        const canal = adaptador && adaptador.canal;
        if (!E.CANAIS[canal] || typeof adaptador.linhas !== 'function' || typeof adaptador.ler !== 'function') return null;
        const doc = root.document;
        let parou = false, timer = null, rodando = false, repete = false, obs = null, ativo = false, ultimaPassada = 0;
        const vivos = new Set();   // ancoras com etiqueta agora
        const seguro = (f, padrao) => { try { return f(); } catch (e) { return padrao; } };
        const aoClicar = acao => { try { const p = root.chrome.runtime.sendMessage({ acao: 'etiqueta_abrir_painel', alvo: acao === 'comissao' ? 'etiquetas' : 'custos', canal }); if (p && p.catch) p.catch(() => {}); } catch (e) { /* extensão recarregada */ } };

        function tira(a) {
            const d = dados.get(a);
            if (d && d.host) { try { d.host.remove(); } catch (e) { /* ok */ } }
            try { a.removeAttribute('data-copiloto-etq'); } catch (e) { /* ok */ }
            dados.delete(a); vivos.delete(a);
        }
        function limpa() {
            Array.from(vivos).forEach(tira);
            seguro(() => Array.from(doc.querySelectorAll('[' + TXT + ']')).forEach(h => h.remove()));
        }
        function desenha(a, vm) {
            const chave = JSON.stringify([vm.estado, vm.linha1, vm.linha2, vm.acao]);
            let d = dados.get(a);
            if (d && d.host && !d.host.isConnected) { dados.delete(a); d = null; }
            if (d && d.chave === chave) { vivos.add(a); return; }
            if (!d) {
                const pai = a.parentNode;
                if (!pai) return;
                const host = doc.createElement('span');
                host.setAttribute(TXT, canal);
                host.setAttribute('style', 'display:block;width:fit-content;max-width:100%;margin:4px 0 0;');
                host.addEventListener('click', e => { try { e.stopPropagation(); } catch (x) { /* ok */ } });
                pai.insertBefore(host, a.nextSibling);
                a.setAttribute('data-copiloto-etq', canal);
                d = { host, chave: '' };
                dados.set(a, d);
            }
            monta(d.host, vm, aoClicar);
            d.chave = chave;
            vivos.add(a);
        }
        async function passa() {
            if (parou) return;
            if (rodando) { repete = true; return; }
            rodando = true; ultimaPassada = Date.now();
            try {
                const cfg = await SHC.lerCfg();
                const liga = E.ligada(canal, cfg) && seguro(() => adaptador.urlOk ? adaptador.urlOk() : true, false);
                if (!liga) { if (ativo) { limpa(); } ativo = false; return; }
                ativo = true;
                const leituras = [];
                seguro(() => adaptador.linhas() || [], []).slice(0, MAX_LINHAS).forEach(l => {
                    const x = seguro(() => adaptador.ler(l), null);
                    if (x && x.ancora && x.ancora.parentNode) leituras.push(x);
                });
                const skus = new Set();
                leituras.forEach(x => [x.sku].concat((x.itens || []).map(i => i && i.sku)).forEach(s => { if (s) skus.add(s); }));
                const chaves = Array.from(skus).map(s => SHC.chaveSku(s)).filter(Boolean);
                const custos = chaves.length ? await SHC.lerCustos(chaves) : {};
                if (parou) return;
                const agora = new Set();
                leituras.forEach(x => {
                    const vm = Array.isArray(x.itens) && x.itens.length > 1 ? E.modeloVariacoes(canal, x.itens, custos, cfg) : E.modelo(canal, x, custos, cfg);
                    desenha(x.ancora, vm);
                    agora.add(x.ancora);
                });
                Array.from(vivos).forEach(a => { if (!agora.has(a) || !a.isConnected) tira(a); });
            } catch (e) { /* tela ou storage em mudança: a próxima passada refaz */ } finally {
                rodando = false;
                if (repete && !parou) { repete = false; agenda(INTERVALO_MIN_MS); }
            }
        }
        function agenda(ms) {
            if (parou || timer) return;
            const espera = Math.max(ms, 0), falta = Math.max(0, INTERVALO_MIN_MS - (Date.now() - ultimaPassada));
            timer = setTimeout(() => { timer = null; passa(); }, ms === 0 ? 0 : Math.max(espera, falta));
        }
        const aoMudarDom = muts => {
            if (parou) return;
            const nossa = m => (ehNosso(m.target) || (m.target && m.target.getRootNode && m.target.getRootNode() !== doc && m.target.getRootNode() !== m.target.ownerDocument))
                || ((m.addedNodes || []).length + (m.removedNodes || []).length > 0 && Array.from(m.addedNodes || []).concat(Array.from(m.removedNodes || [])).every(ehNosso));
            if (muts && muts.length && muts.every(nossa)) return;
            agenda(INTERVALO_MIN_MS);
        };
        const aoMudarStorage = (mud, area) => {
            if (parou || (area && area !== 'local')) return;
            if (Object.keys(mud || {}).some(k => /^c\|sku/.test(k) || k === 'cfg' || k === 'ml:conta')) agenda(150);
        };
        const aoNavegar = () => agenda(INTERVALO_MIN_MS);
        const controle = {
            canal, passar: passa, agenda,
            parar() {
                if (parou) return;
                parou = true; clearTimeout(timer); timer = null;
                seguro(() => obs && obs.disconnect());
                seguro(() => root.removeEventListener('popstate', aoNavegar));
                seguro(() => root.chrome.storage.onChanged.removeListener(aoMudarStorage));
                seguro(limpa);
                if (atual === controle) atual = null;
            },
        };
        atual = controle;
        try { obs = new root.MutationObserver(aoMudarDom); const alvo = doc.body || doc.documentElement; if (alvo) obs.observe(alvo, { childList: true, subtree: true }); } catch (e) { /* sem observer: só a passada inicial e as mudanças de custo */ }
        seguro(() => root.addEventListener('popstate', aoNavegar));
        seguro(() => root.chrome.storage.onChanged.addListener(aoMudarStorage));
        seguro(() => Array.from(doc.querySelectorAll('[' + TXT + ']')).forEach(h => h.remove()));   // sobra de uma carga anterior do script
        agenda(0);
        return controle;
    };

    if (typeof module === 'object' && module.exports) module.exports = E;
})(typeof globalThis !== 'undefined' ? globalThis : this);
