// SellerHub Copiloto — motor da "sobra" (quanto fica no bolso depois de tudo).
// Mesmas regras do SellerHub: core/MLCustoVenda.php (comissão por tipo de anúncio, taxa fixa por
// faixa de preço, regra do frete grátis a partir de R$ 79) e CustoLookup::taxaCanal (Shopee 20%).
// Roda 100% no navegador: nenhum dado sai daqui.
(function (root) {
    'use strict';
    const SHC = root.SHC || (root.SHC = {});

    const LIMITE_FRETE_GRATIS_ML = 79.0;

    // Valores iniciais. O seller ajusta no painel (o ML varia a comissão por categoria).
    SHC.PADRAO = {
        imposto_pct: 0,
        ml_comissao_classico: 13,
        ml_comissao_premium: 16.5,
        ml_tipo_padrao: 'classico',
        ml_frete_padrao: 0,
        sp_comissao_pct: 20,
        sp_taxa_fixa: 0,
        margem_alvo_pct: 10,
        // v2.5: robô de fotos e radar de visitas (background.js roboPassada/roboExecuta; SHC.roboDecide). robo_itens: {MLB: true}
        // liga por anúncio — grave sempre um objeto NOVO (este padrão é compartilhado).
        robo_ligado: false, robo_modo: 'sugerir', robo_itens: {}, robo_intervalo_dias: 7, robo_max_dia: 5, radar_queda_pct: 20,
        // v2.7: apelido de cada conta do ML dado pelo SELLER em Ajustes ({sellerId: 'Loja 1'}); tem prioridade sobre o nome da conta lido do ML (v2.8, ml:contas[id].nomeMl). Grave sempre um objeto NOVO.
        apelidos: {},
        // v2.8: sistema modular (pedido da dona: "escolher qual função o sistema quer que exiba, para ser mais objetivo nas
        // tarefas do dia a dia"). {} = tudo ligado; só uma chave === false desliga aquele módulo. Nunca tirar sem o seller escolher.
        modulos: {},
        // v2.9: robô de promoções (SHC.roboPromoSugestoes). {ligado, margem_pct (null = meta acima), modo:'sugerir'}. Grave sempre um objeto NOVO.
        robopromo: {},
    };
    // Módulos que o seller pode desligar (cada um = 1 aba do painel); Geral e Ajustes nunca somem.
    SHC.MODULOS = ['full', 'posvenda', 'promo', 'ads', 'frete', 'catalogo', 'afiliados', 'saude', 'conciliacao', 'canal'];   // v2.9: + posvenda, na ordem das abas
    /** true a não ser que o seller tenha desligado esse módulo em Ajustes (cfg.modulos[id] === false). */
    SHC.moduloLigado = (cfg, id) => !cfg || !cfg.modulos || cfg.modulos[id] !== false;

    const r2 = v => Math.round((v + (v >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;
    SHC.r2 = r2;
    /** Campos de apelido {sellerId: texto} (Ajustes) → objeto NOVO para cfg.apelidos: só ids válidos, texto até 40 letras; vazio tira o apelido. */
    SHC.apelidosLimpos = function (txt) {
        const out = {};
        Object.keys(txt || {}).forEach(id => { if (!/^\d{6,15}$/.test(id)) return; const t = String(txt[id] || '').replace(/\s+/g, ' ').trim().slice(0, 40); if (t) out[id] = t; });
        return out;
    };

    // Aceita número ou texto no jeito brasileiro ("1.234,56", "25,5", "R$ 30") e também "25.50".
    SHC.num = function (v) {
        if (v === null || v === undefined || v === '') return null;
        if (typeof v === 'number') return isFinite(v) ? v : null;
        let s = String(v).replace(/[R$\s ]/g, '');
        if (s === '') return null;
        // "1,234.56" (jeito americano), "1,2,3" e "1.234.5" não são número brasileiro: melhor ficar sem número do que com um errado.
        if (s.indexOf(',') >= 0) {
            if (s.indexOf(',') !== s.lastIndexOf(',') || s.lastIndexOf('.') > s.indexOf(',')) return null;
            s = s.replace(/\./g, '').replace(',', '.');
        } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
        else if (s.indexOf('.') !== s.lastIndexOf('.')) return null;
        // Só número inteiro (com "%" ou "+" opcional): "6abc", "1e9" e "1-2" não são número (antes o parseFloat aceitava o começo).
        const m = /^([-+]?\d+(?:\.\d+)?|[-+]?\.\d+)%?$/.exec(s);
        if (!m) return null;
        const n = Number(m[1]);
        return isFinite(n) ? n : null;
    };
    const num = SHC.num;
    // Faixa aceita no que o seller digita (Ajustes do painel lateral, "Seus números" e guia do painel.html): uma só para as duas telas.
    SHC.FAIXAS = { imposto_pct: [0, 60], margem_alvo_pct: [0, 90] };

    // Sessão caída: o ML manda (302) para o login em www.mercadolivre.com.br, que não tem CORS nem permissão → o fetch quebra com
    // TypeError antes de ver r.url. Refaz o MESMO GET sem seguir o redirecionamento: 'opaqueredirect' = mandou para o login.
    // Devolve a resposta normal, ou uma falsa com url de login (os chamadores já tratam com ehLogin(r.url)). Só GET; POST não é repetido.
    SHC.buscarVendo = async function (url, init, ir) {
        const f = ir || root.fetch;
        try { return await f(url, init); } catch (e) {
            if (!e || e.name !== 'TypeError' || (init && init.method && String(init.method).toUpperCase() !== 'GET')) throw e;
            let r = null;
            try { r = await f(url, Object.assign({}, init, { redirect: 'manual' })); } catch (e2) { throw e; }
            if (r && (r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400))) return { ok: false, status: 302, url: 'https://www.mercadolivre.com.br/login?redirecionado', redirecionadoLogin: true };
            throw e;
        }
    };

    SHC.moeda = v => (v === null || v === undefined || !isFinite(v)) ? '—'
        : (v < 0 ? '−' : '') + 'R$ ' + Math.abs(Number(v)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Taxa fixa do ML por faixa de preço (fallback oficial 2026 do MLCustoVenda).
    function taxaFixaML(preco) {
        if (preco >= LIMITE_FRETE_GRATIS_ML) return 0;
        if (preco < 12.5) return r2(preco * 0.5);
        if (preco < 19) return 6.0;
        if (preco < 49) return 7.5;
        return 9.5;
    }
    SHC.taxaFixaML = taxaFixaML;

    function comissaoPct(canal, item, cfg) {
        const propria = num(item.comissao_pct);
        if (propria !== null && propria >= 0) return propria;
        if (canal === 'ml') {
            const tipo = item.tipo || cfg.ml_tipo_padrao || 'classico';
            return num(tipo === 'premium' ? cfg.ml_comissao_premium : cfg.ml_comissao_classico) || 0;
        }
        return num(cfg.sp_comissao_pct) || 0;
    }

    // Frete que o SELLER paga. ML: abaixo de R$ 79 (fora do Full) quem paga é o comprador.
    function freteSeller(canal, preco, item, cfg) {
        const informado = num(item.frete);
        if (canal === 'ml') {
            if (!item.full && preco < LIMITE_FRETE_GRATIS_ML) return { rs: 0, regra: 'Comprador paga o frete (abaixo de R$ 79)', desconhecido: false };
            if (informado !== null) return { rs: informado, regra: item.full ? 'Full: frete que você informou' : 'Frete grátis: valor que você informou', desconhecido: false };
            const padrao = num(cfg.ml_frete_padrao) || 0;
            if (padrao > 0) return { rs: padrao, regra: 'Frete grátis: seu frete médio (configurações)', desconhecido: false };
            return { rs: 0, regra: 'Frete grátis: informe quanto você paga', desconhecido: true };
        }
        if (informado !== null) return { rs: informado, regra: 'Frete que você informou', desconhecido: false };
        return { rs: 0, regra: 'Sem frete informado', desconhecido: false };
    }

    /**
     * Quanto sobra vendendo a `preco`.
     * canal: 'ml' | 'sp' · item: {custo, outros, frete, tipo:'classico'|'premium', full, comissao_pct}
     */
    SHC.calcular = function (canal, preco, item, cfg) {
        cfg = Object.assign({}, SHC.PADRAO, cfg || {});
        item = item || {};
        preco = num(preco);
        if (!(preco > 0)) return null;

        const custo = num(item.custo);
        const outros = num(item.outros) || 0;
        const temCusto = custo !== null && custo > 0;
        const impPct = num(cfg.imposto_pct) || 0;
        const comPct = comissaoPct(canal, item, cfg);
        const taxaFixa = canal === 'ml' ? taxaFixaML(preco) : (num(cfg.sp_taxa_fixa) || 0);
        const fr = freteSeller(canal, preco, item, cfg);

        const comissaoRs = r2(preco * comPct / 100);
        const impostoRs = r2(preco * impPct / 100);
        const recebeRs = r2(preco - comissaoRs - taxaFixa - fr.rs);          // o que o canal repassa
        const sobraRs = temCusto ? r2(recebeRs - custo - outros - impostoRs) : null;
        const sobraPct = sobraRs !== null ? Math.round(sobraRs / preco * 1000) / 10 : null;
        const alvo = num(cfg.margem_alvo_pct) || 0;

        let classe = 'sem_custo';
        if (sobraPct !== null) classe = sobraPct < 0 ? 'prejuizo' : (sobraPct < alvo ? 'apertado' : 'lucrativo');

        return {
            canal, preco: r2(preco),
            tipo: canal === 'ml' ? (item.tipo || cfg.ml_tipo_padrao || 'classico') : null,
            comissao_pct: comPct, comissao_rs: comissaoRs, taxa_fixa_rs: r2(taxaFixa),
            frete_rs: r2(fr.rs), frete_regra: fr.regra, frete_desconhecido: fr.desconhecido,
            imposto_pct: impPct, imposto_rs: impostoRs,
            custo_rs: temCusto ? r2(custo) : null, outros_rs: r2(outros),
            recebe_rs: recebeRs, sobra_rs: sobraRs, sobra_pct: sobraPct, classe,
        };
    };

    /**
     * Menor preço que ainda deixa `alvoPct`% de sobra (0 = empatar). A conta é linear dentro de cada
     * faixa de tarifa do ML (a taxa fixa e o frete mudam de degrau), então resolve faixa a faixa e
     * confere o resultado no centavo com o próprio calcular().
     */
    SHC.precoMinimo = function (canal, item, cfg, alvoPct) {
        cfg = Object.assign({}, SHC.PADRAO, cfg || {});
        item = item || {};
        const custo = num(item.custo);
        if (!(custo > 0)) return null;
        const outros = num(item.outros) || 0;
        const alvo = (num(alvoPct) || 0) / 100;
        const imp = (num(cfg.imposto_pct) || 0) / 100;
        const com = comissaoPct(canal, item, cfg) / 100;

        // Faixas: [inicio, fim, fatorVariavelExtra, fixoReais]
        const faixas = [];
        if (canal === 'ml') {
            const freteAcima = (() => { const f = freteSeller(canal, 100, item, cfg); return f.rs; })();
            const freteAbaixo = item.full ? freteAcima : 0;
            faixas.push([0.01, 12.5, 0.5, freteAbaixo]);
            faixas.push([12.5, 19, 0, 6.0 + freteAbaixo]);
            faixas.push([19, 49, 0, 7.5 + freteAbaixo]);
            faixas.push([49, 79, 0, 9.5 + freteAbaixo]);
            faixas.push([79, 1e7, 0, freteAcima]);
        } else {
            const f = freteSeller(canal, 100, item, cfg).rs;
            faixas.push([0.01, 1e7, 0, (num(cfg.sp_taxa_fixa) || 0) + f]);
        }

        const ok = p => { const c = SHC.calcular(canal, p, item, cfg); return c && c.sobra_rs !== null && c.sobra_rs >= r2(alvo * p) - 0.0001; };
        for (const [ini, fim, extra, fixo] of faixas) {
            const den = 1 - com - imp - alvo - extra;
            if (den <= 0) continue;
            let p = Math.max(ini, (custo + outros + fixo) / den);
            if (p >= fim) continue;
            p = Math.max(ini, Math.ceil(p * 100 - 1e-6) / 100 - 0.02);   // 2 centavos antes: o arredondamento das tarifas pode empatar antes
            for (let i = 0; i < 300 && p < fim; i++, p = r2(p + 0.01)) {
                if (ok(p)) return r2(p);
            }
        }
        return null;
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = SHC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
