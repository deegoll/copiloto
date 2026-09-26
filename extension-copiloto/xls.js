// SellerHub Copiloto — leitor mínimo de planilha .xls (Excel 97-2003, BIFF8), sem biblioteca.
// É o formato que o Tiny exporta ("Produtos.xls"). Devolve só os VALORES da 1ª planilha visível,
// como matriz de textos — a mesma entrada de SHC.lerTabela, então as regras de coluna são as do CSV.
// Estrutura: contêiner OLE2/CFB → stream "Workbook" → registros BIFF (SST, LABELSST, NUMBER, RK, MULRK, FORMULA…).
(function (root) {
    'use strict';
    const SHC = root.SHC || (root.SHC = {});
    const FIM = 0xFFFFFFFE;   // fim de cadeia (0xFFFFFFFF = livre também para, por ser maior)

    // ── contêiner CFB ─────────────────────────────────────────────────────────────────────────
    function abreCfb(buf) {
        const dv = new DataView(buf), u8 = new Uint8Array(buf);
        const ass = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
        if (u8.length < 512 || ass.some((b, i) => u8[i] !== b)) throw new Error('nao_xls');
        const tam = 1 << dv.getUint16(0x1E, true), miniTam = 1 << dv.getUint16(0x20, true);
        const corte = dv.getUint32(0x38, true);
        const setor = n => (n + 1) * tam;
        // DIFAT: 109 no cabeçalho + setores encadeados
        const difat = [];
        for (let i = 0; i < 109; i++) difat.push(dv.getUint32(0x4C + i * 4, true));
        let d = dv.getUint32(0x44, true), nd = dv.getUint32(0x48, true);
        while (nd-- > 0 && d < FIM) {
            const o = setor(d), por = tam / 4 - 1;
            for (let i = 0; i < por; i++) difat.push(dv.getUint32(o + i * 4, true));
            d = dv.getUint32(o + por * 4, true);
        }
        const fat = [];
        difat.filter(s => s < FIM && setor(s) + tam <= u8.length).forEach(s => {
            const o = setor(s);
            for (let i = 0; i < tam / 4; i++) fat.push(dv.getUint32(o + i * 4, true));
        });
        const cadeia = (ini, tabela, le) => {
            const partes = [], vistos = new Set();
            for (let s = ini; s !== undefined && s < FIM && !vistos.has(s); s = tabela[s]) { vistos.add(s); partes.push(le(s)); }
            const tot = partes.reduce((a, p) => a + p.length, 0), out = new Uint8Array(tot);
            let p = 0; partes.forEach(x => { out.set(x, p); p += x.length; });
            return out;
        };
        const leSetor = s => u8.subarray(setor(s), Math.min(setor(s) + tam, u8.length));
        const dir = cadeia(dv.getUint32(0x30, true), fat, leSetor);
        const ddv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
        const entradas = [];
        for (let o = 0; o + 128 <= dir.length; o += 128) {
            const nl = ddv.getUint16(o + 0x40, true);
            let nome = '';
            for (let i = 0; i + 2 < nl; i += 2) nome += String.fromCharCode(ddv.getUint16(o + i, true));
            entradas.push({ nome, tipo: dir[o + 0x42], ini: ddv.getUint32(o + 0x74, true), tam: ddv.getUint32(o + 0x78, true) });
        }
        const raiz = entradas.find(e => e.tipo === 5);
        let miniStream = null, miniFat = null;
        // Arquivo cortado (download incompleto): a cadeia termina antes do tamanho do diretório → erro, nunca metade da planilha calada.
        const inteiro = (b, tam) => { if (b.length < tam) throw new Error('nao_xls'); return b; };
        const leStream = e => {
            if (e.tam >= corte || !raiz) return inteiro(cadeia(e.ini, fat, leSetor).subarray(0, e.tam), e.tam);
            if (!miniStream) {
                miniStream = cadeia(raiz.ini, fat, leSetor);
                const mf = cadeia(dv.getUint32(0x3C, true), fat, leSetor), mdv = new DataView(mf.buffer, mf.byteOffset, mf.byteLength);
                miniFat = []; for (let i = 0; i + 4 <= mf.length; i += 4) miniFat.push(mdv.getUint32(i, true));
            }
            return inteiro(cadeia(e.ini, miniFat, s => miniStream.subarray(s * miniTam, (s + 1) * miniTam)).subarray(0, e.tam), e.tam);
        };
        return { entradas, leStream };
    }

    // ── registros BIFF8 ───────────────────────────────────────────────────────────────────────
    function registros(wb) {
        const dv = new DataView(wb.buffer, wb.byteOffset, wb.byteLength), out = [];
        for (let o = 0; o + 4 <= wb.length;) {
            const tipo = dv.getUint16(o, true), len = dv.getUint16(o + 2, true);
            out.push({ tipo, pos: o, dados: wb.subarray(o + 4, o + 4 + len) });
            o += 4 + len;
        }
        return out;
    }
    const dvDe = u => new DataView(u.buffer, u.byteOffset, u.byteLength);

    // Tabela de textos compartilhados (SST + CONTINUE). Texto partido entre CONTINUEs traz um byte de opção novo.
    function leSst(segs) {
        let si = 0, p = 0;
        const byte = () => { while (p >= segs[si].length) { si++; p = 0; if (si >= segs.length) throw new Error('sst'); } return segs[si][p++]; };
        const u16 = () => byte() | (byte() << 8);
        const u32 = () => (u16() | (u16() << 16)) >>> 0;
        const pula = n => { while (n > 0) { if (p >= segs[si].length) { si++; p = 0; if (si >= segs.length) return; } const k = Math.min(n, segs[si].length - p); p += k; n -= k; } };
        u32(); const unicos = u32();
        const lista = [];
        for (let k = 0; k < unicos; k++) {
            const cch = u16(), op = byte();
            let alto = op & 1;
            const runs = op & 8 ? u16() : 0, ext = op & 4 ? u32() : 0;
            let s = '';
            for (let c = 0; c < cch; c++) {
                if (p >= segs[si].length) { si++; p = 0; alto = segs[si][p++] & 1; }   // continua no próximo CONTINUE
                s += String.fromCharCode(alto ? u16() : byte());
            }
            pula(runs * 4 + ext);
            lista.push(s);
        }
        return lista;
    }
    function leTextoCurto(u, o) {          // XLUnicodeString de LABEL/STRING
        const dv = dvDe(u), cch = dv.getUint16(o, true), alto = u[o + 2] & 1;
        let s = '';
        for (let c = 0; c < cch; c++) s += String.fromCharCode(alto ? dv.getUint16(o + 3 + c * 2, true) : u[o + 3 + c]);
        return s;
    }
    function rk(v) {
        let n;
        if (v & 2) n = v >> 2;
        else { const b = new DataView(new ArrayBuffer(8)); b.setUint32(4, v & 0xFFFFFFFC, true); b.setUint32(0, 0, true); n = b.getFloat64(0, true); }
        return v & 1 ? n / 100 : n;
    }
    // Número → texto que SHC.num lê sem ambiguidade (decimal com vírgula; "1.234" seria milhar).
    const numTxt = n => Number.isInteger(n) ? String(n) : String(Math.round(n * 1e6) / 1e6).replace('.', ',');

    /** ArrayBuffer de um .xls → matriz de linhas (textos) da 1ª planilha visível. Lança Error('nao_xls'|'protegida'|'formato_antigo'). */
    SHC.lerXls = function (buf) {
        const cfb = abreCfb(buf);
        const ent = cfb.entradas.find(e => e.tipo === 2 && /^workbook$/i.test(e.nome));
        if (!ent) throw new Error(cfb.entradas.some(e => /^book$/i.test(e.nome)) ? 'formato_antigo' : 'nao_xls');
        const recs = registros(cfb.leStream(ent));
        let sst = [], planilha = -1;
        for (let i = 0; i < recs.length; i++) {
            const r = recs[i];
            if (r.tipo === 0x002F) throw new Error('protegida');
            if (r.tipo === 0x00FC) {
                const segs = [r.dados];
                for (let j = i + 1; j < recs.length && recs[j].tipo === 0x003C; j++) segs.push(recs[j].dados);
                sst = leSst(segs);
            }
            // BOUNDSHEET: 1ª planilha de dados visível
            if (r.tipo === 0x0085 && planilha < 0 && r.dados[4] === 0 && r.dados[5] === 0) planilha = dvDe(r.dados).getUint32(0, true);
            if (r.tipo === 0x000A) break;   // fim do bloco global
        }
        if (planilha < 0) throw new Error('nao_xls');
        const linhas = [];
        const poe = (l, c, v) => { (linhas[l] || (linhas[l] = []))[c] = v; };
        let i = recs.findIndex(r => r.pos === planilha);
        if (i < 0) throw new Error('nao_xls');
        for (i++; i < recs.length && recs[i].tipo !== 0x000A; i++) {
            const r = recs[i], u = r.dados, dv = dvDe(u);
            if (u.length < 6 && r.tipo !== 0x0207) continue;
            const l = u.length >= 4 ? dv.getUint16(0, true) : 0, c = u.length >= 4 ? dv.getUint16(2, true) : 0;
            switch (r.tipo) {
                case 0x00FD: poe(l, c, sst[dv.getUint32(6, true)] || ''); break;              // LABELSST
                case 0x0204: poe(l, c, leTextoCurto(u, 6)); break;                           // LABEL
                case 0x0203: poe(l, c, numTxt(dv.getFloat64(6, true))); break;               // NUMBER
                case 0x027E: poe(l, c, numTxt(rk(dv.getUint32(6, true)))); break;            // RK
                case 0x00BD: {                                                               // MULRK
                    const n = (u.length - 6) / 6;
                    for (let k = 0; k < n; k++) poe(l, c + k, numTxt(rk(dv.getUint32(6 + k * 6, true))));
                    break;
                }
                case 0x0205: poe(l, c, u[7] ? '' : (u[6] ? 'VERDADEIRO' : 'FALSO')); break;  // BOOLERR
                case 0x0006:                                                                 // FORMULA (valor em cache)
                    if (dv.getUint16(12, true) !== 0xFFFF) poe(l, c, numTxt(dv.getFloat64(6, true)));
                    else if (u[6] === 0 && recs[i + 1] && recs[i + 1].tipo === 0x0207) poe(l, c, leTextoCurto(recs[i + 1].dados, 0));
                    break;
            }
        }
        const larg = linhas.reduce((m, l) => Math.max(m, l ? l.length : 0), 0);
        const out = [];
        for (let k = 0; k < linhas.length; k++) {
            const l = linhas[k] || [];
            const lin = [];
            for (let c = 0; c < larg; c++) lin.push(l[c] === undefined ? '' : String(l[c]).trim());
            if (lin.some(x => x !== '')) out.push(lin);
        }
        return out;
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);
