// Nada de dado de cliente no GitHub (V2, regra da dona 07/10): os retratos de tela (tests/copiloto/fixtures/ e copiloto-nucleo/testes/fixtures/)
// sobem só com a estrutura, com ids e números inventados. Este teste falha se achar, em qualquer retrato:
//   a) CPF ou CNPJ com dígito verificador válido (inventado à toa quase nunca fecha o dígito; real sempre fecha);
//   b) e-mail ou telefone brasileiro;
//   c) campo de comprador, destinatário ou endereço com valor preenchido (nome, apelido, rua, CEP, documento, telefone, e-mail),
//      a não ser um valor claramente de mentira (vazio, "X", "***", "anon…", "inventad…", "exemplo", "teste", "Comprador 1"…).
// Achou e é inventado de propósito? Troque pelo formato de mentira, não afrouxe o teste.
// Rodar: node tests/copiloto/teste_fixtures_sem_cliente.js
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '../..');
const PASTAS = ['tests/copiloto/fixtures', 'copiloto-nucleo/testes/fixtures'];
let falhas = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) falhas++; };

const dig = s => String(s).replace(/\D/g, '');
function cpfValido(s) {
    const d = dig(s);
    if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
    const dv = n => { let t = 0; for (let i = 0; i < n; i++) t += +d[i] * (n + 1 - i); const r = (t * 10) % 11; return r === 10 ? 0 : r; };
    return dv(9) === +d[9] && dv(10) === +d[10];
}
function cnpjValido(s) {
    const d = dig(s);
    if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
    const dv = n => { const p = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; let t = 0; for (let i = 0; i < n; i++) t += +d[i] * p[i]; const r = t % 11; return r < 2 ? 0 : 11 - r; };
    return dv(12) === +d[12] && dv(13) === +d[13];
}
// Campos que, preenchidos de verdade, são dado pessoal (nomes do ML, do TikTok, da Shopee e da Magalu; minúsculas, sem _ nem -).
const CAMPO = /^(buyer|receiver|recipient|comprador|destinatario|cliente|customer)?(name|nome|firstname|lastname|fullname|nickname|apelido|email|phone|telefone|celular|mobile|cpf|cnpj|docnumber|document|documento|taxid|street|streetname|streetnumber|rua|logradouro|endereco|address|addressline|zipcode|zip|cep|postalcode|neighborhood|bairro)$/;
const DONO_PESSOAL = /buyer|receiver|recipient|comprador|destinat|client|customer|shipping|address|endereco|contact|contato/i;
const MENTIRA = /^(|x+|\*+|-+|anon\w*|inventad\w*|exemplo\w*|teste\w*|fake\w*|mock\w*|fulan[oa].*|(comprador|cliente|buyer|loja|vendedor|seller) ?\d*|[a-z]\*+|\d{5}-?0{3}|0+)$/i;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/;
const FONE = /(\(?\b\d{2}\)?\s?9\d{4}[-\s]?\d{4}\b)|(\+55\s?\d{2}\s?9?\d{4}[-\s]?\d{4})/;
const EMAIL_OK = /@(exemplo|example|teste|test|invalid)\.|^(nao-responda|noreply)@/i;

function varre(v, caminho, achados) {
    if (Array.isArray(v)) return v.forEach((x, i) => varre(x, caminho + '[' + i + ']', achados));
    if (v && typeof v === 'object') return Object.keys(v).forEach(k => {
        const x = v[k], kk = k.toLowerCase().replace(/[_-]/g, '');
        if ((typeof x === 'string' || typeof x === 'number') && CAMPO.test(kk) && (DONO_PESSOAL.test(caminho + '.' + k) || /cpf|cnpj|email|phone|telefone|celular|cep|zipcode|docnumber/.test(kk))
            && !MENTIRA.test(String(x).trim()) && !EMAIL_OK.test(String(x))) achados.push(caminho + '.' + k + ' = "' + String(x).slice(0, 40) + '"');
        varre(x, caminho + '.' + k, achados);
    });
    if (typeof v !== 'string') return;
    (v.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g) || []).filter(cpfValido).forEach(m => achados.push(caminho + ': CPF válido ' + m));
    (v.match(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g) || []).filter(cnpjValido).forEach(m => achados.push(caminho + ': CNPJ válido ' + m));
    const em = EMAIL.exec(v);
    if (em && !EMAIL_OK.test(em[0])) achados.push(caminho + ': e-mail ' + em[0]);
    const fo = FONE.exec(v);
    if (fo) achados.push(caminho + ': telefone ' + fo[0]);
}

// Autoteste: o detector acha o que tem de achar e deixa passar o que é de mentira.
console.log('a) o detector');
const acha = o => { const a = []; varre(o, '$', a); return a; };
ok(acha({ buyer: { nickname: 'MARIA.SILVA77' } }).length === 1, 'apelido de comprador preenchido é acusado');
ok(acha({ receiver_address: { zip_code: '87010-120', street_name: 'Av. Brasil' } }).length === 2, 'CEP e rua do destinatário são acusados');
ok(acha({ obs: 'cpf 529.982.247-25' }).length === 1 && acha({ obs: 'cpf 123.456.789-00' }).length === 0, 'CPF com dígito válido é acusado; inventado sem dígito, não');
ok(acha({ obs: 'cnpj 11.222.333/0001-81' }).length === 1, 'CNPJ válido é acusado');
ok(acha({ msg: 'fale com joao@gmail.com ou (44) 99912-1785' }).length === 2, 'e-mail e celular no texto são acusados');
ok(acha({ buyer: { nickname: 'COMPRADOR 1', email: 'x@exemplo.com', cpf: '***' }, seller: { nickname: 'LOJA 2' }, item: { title: 'Kit 3 peças' } }).length === 0,
    'valores de mentira, título e apelido de loja passam');

console.log('b) os retratos');
const arquivos = [];
const anda = p => { if (!fs.existsSync(p)) return; if (fs.statSync(p).isDirectory()) fs.readdirSync(p).forEach(n => anda(path.join(p, n))); else if (/\.(json|html|txt)$/i.test(p)) arquivos.push(p); };
PASTAS.forEach(d => anda(path.join(RAIZ, d)));
ok(arquivos.length > 0, arquivos.length + ' retrato(s) em ' + PASTAS.join(' e '));
arquivos.forEach(f => {
    const txt = fs.readFileSync(f, 'utf8'), rel = path.relative(RAIZ, f), achados = [];
    let obj = null;
    if (/\.json$/i.test(f)) { try { obj = JSON.parse(txt); } catch (e) { obj = null; } }
    varre(obj !== null ? obj : txt, '$', achados);
    ok(!achados.length, rel + (achados.length ? ' — ' + achados.slice(0, 5).join('; ') + (achados.length > 5 ? ' (+' + (achados.length - 5) + ')' : '') : ''));
});

console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nTUDO OK');
process.exit(falhas ? 1 : 0);
