// copiloto-nucleo · util — dinheiro, datas e somas. JavaScript puro: roda no navegador (CopilotoNucleo.util) e no Node (require).
(function (root, fabrica) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = fabrica();
    else { const CN = root.CopilotoNucleo = root.CopilotoNucleo || {}; CN.util = fabrica(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    /** Arredonda em centavos (igual ao SHC.r2 do Copiloto) e nunca devolve −0. */
    function r2(v) {
        if (v === null || v === undefined || !isFinite(v)) return null;
        const x = Math.round((v + (v >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;
        return x === 0 ? 0 : x;
    }

    /**
     * Número a partir de número ou texto no jeito brasileiro ("1.234,56", "R$ 30", "25,5%", "−6,00") ou com ponto decimal ("549.9").
     * Texto que não é número → null (melhor ficar sem número do que com um errado — mesma regra do SHC.num).
     */
    function num(v) {
        if (v === null || v === undefined || v === '') return null;
        if (typeof v === 'number') return isFinite(v) ? v : null;
        let s = String(v).replace(/[R$\s ]/g, '').replace(/−/g, '-');
        if (s === '') return null;
        if (s.indexOf(',') >= 0) {
            if (s.indexOf(',') !== s.lastIndexOf(',') || s.lastIndexOf('.') > s.indexOf(',')) return null;
            s = s.replace(/\./g, '').replace(',', '.');
        } else if (/^[-+]?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
        else if (s.indexOf('.') !== s.lastIndexOf('.')) return null;
        const m = /^([-+]?\d+(?:\.\d+)?|[-+]?\.\d+)%?$/.exec(s);
        if (!m) return null;
        const n = Number(m[1]);
        return isFinite(n) ? n : null;
    }

    /** Soma com arredondamento em centavos; ignora null/undefined. */
    function soma(lista, f) {
        let t = 0;
        (lista || []).forEach(x => { const v = f ? f(x) : x; if (typeof v === 'number' && isFinite(v)) t += v; });
        return r2(t);
    }

    const FUSO_BRT_MS = 3 * 3600 * 1000;   // Brasília = UTC−3 o ano todo desde 2019 (sem horário de verão)
    const RE_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

    /**
     * Dia 'AAAA-MM-DD' no horário de Brasília a partir de:
     * 'AAAA-MM-DD' (fica igual), 'AAAA-MM-DDTHH:MM…' (usa o dia escrito), Date, milissegundos (número ou texto de 13 dígitos,
     * como no financeiro do TikTok) ou segundos (10 dígitos, como nos pedidos do TikTok). Inválido → null.
     */
    function dia(v) {
        if (v === null || v === undefined || v === '') return null;
        if (v instanceof Date) return isNaN(v.getTime()) ? null : new Date(v.getTime() - FUSO_BRT_MS).toISOString().slice(0, 10);
        const s = String(v).trim();
        if (RE_DIA.test(s)) return diaValido(s) ? s : null;
        if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return diaValido(s.slice(0, 10)) ? s.slice(0, 10) : null;
        if (/^\d{9,11}$/.test(s)) return dia(new Date(Number(s) * 1000));
        if (/^\d{12,14}$/.test(s)) return dia(new Date(Number(s)));
        return null;
    }
    function diaValido(s) {
        const m = RE_DIA.exec(s);
        if (!m) return false;
        const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        return t.getUTCFullYear() === +m[1] && t.getUTCMonth() === +m[2] - 1 && t.getUTCDate() === +m[3];
    }
    /** 'AAAA-MM-DD' + n dias (n pode ser negativo). */
    function somaDias(d, n) {
        const m = RE_DIA.exec(d || '');
        if (!m) return null;
        return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n)).toISOString().slice(0, 10);
    }
    /** Dias entre dois 'AAAA-MM-DD' (b − a). */
    function diasEntre(a, b) {
        const x = RE_DIA.exec(a || ''), y = RE_DIA.exec(b || '');
        if (!x || !y) return null;
        return Math.round((Date.UTC(+y[1], +y[2] - 1, +y[3]) - Date.UTC(+x[1], +x[2] - 1, +x[3])) / 864e5);
    }
    const mes = d => (d && /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : null);
    /** Hoje em Brasília ('AAAA-MM-DD'). */
    const hoje = () => dia(new Date());

    /** Cópia simples (JSON) — os objetos do núcleo são dados puros. */
    const copia = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

    /** Chave do SKU, a mesma regra do SHC.normalizaSku do Copiloto (store.js:15; o ml.test confere): sem "SKU:", maiúsculas, '|' vira '-'. */
    const normalizaSku = s => String(s || '').replace(/^\s*SKU[:\s]*/i, '').trim().toUpperCase().replace(/\s+/g, ' ').replace(/\|/g, '-').slice(0, 80);

    return { r2, num, soma, dia, diaValido, somaDias, diasEntre, mes, hoje, copia, normalizaSku };
});
