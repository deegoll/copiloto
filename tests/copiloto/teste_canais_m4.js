// M4 (07/10): as regras oficiais da Shopee e da Magalu em docs/canais/ são o que os textos de contestação desses canais vão citar.
// A regra da dona: só fonte oficial, com URL, título e data lida; o que não foi achado fica "não encontrado", nunca suposto.
//   a) os dois arquivos existem e têm as 5 seções (reclamação, devolução, exclusão de reclamação, frete, tarifas) + Fontes;
//   b) cada regra (linha "- ") cita uma fonte [Xn] ou diz "não encontrado";
//   c) cada fonte citada está na tabela, e cada fonte da tabela é citada;
//   d) cada fonte tem título, URL https de domínio oficial do canal e "Lida em" no formato dd/mm/aaaa;
//   e) nenhum dado de cliente (e-mail, CPF/CNPJ, telefone);
//   f) a tarifa fixa da Shopee que o arquivo cita desde 01/10/2026 (R$ 4,50 e metade do preço abaixo de R$ 9) é a do copiloto-nucleo.
// Rodar: node tests/copiloto/teste_canais_m4.js   (CANAIS=<pasta> lê outra pasta, para provar que o teste reprova)
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '../..');
const PASTA = process.env.CANAIS || path.join(RAIZ, 'docs/canais');
let falhas = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) falhas++; };

const CANAIS = {
    shopee: { prefixo: 'S', dominios: ['seller.shopee.com.br', 'help.shopee.com.br'] },
    magalu: { prefixo: 'M', dominios: ['universo.magalu.com', 'seller.magalu.com', 'parceiro.magalu.com', 'atendimento.magazineluiza.com.br', 'marketplace.magazineluiza.com.br'] },
};
const SECOES = ['Reclamação', 'Devolução', 'Exclusão de reclamação', 'Frete', 'Tarifas', 'Fontes'];
const textos = {};

for (const [canal, cfg] of Object.entries(CANAIS)) {
    console.log('── ' + canal + '.md');
    const arq = path.join(PASTA, canal + '.md');
    if (!fs.existsSync(arq)) { ok(false, 'arquivo ' + path.relative(RAIZ, arq) + ' existe'); continue; }
    const md = textos[canal] = fs.readFileSync(arq, 'utf8');

    // a) seções
    const titulos = [...md.matchAll(/^## (.+)$/gm)].map(m => m[1]);
    for (const s of SECOES) ok(titulos.some(t => t.startsWith(s)), 'seção "' + s + '"');

    // b) regras: cada linha "- " fora de Fontes cita [Xn] ou diz "não encontrado"
    const corpo = md.split(/^## Fontes$/m)[0];
    const regras = corpo.split('\n').filter(l => /^- /.test(l));
    const re = new RegExp('\\[' + cfg.prefixo + '\\d+\\]', 'g'), cita = new RegExp(re.source);
    const semFonte = regras.filter(l => !cita.test(l) && !/não encontrado/i.test(l));
    ok(regras.length >= 10, regras.length + ' regras');
    ok(!semFonte.length, 'toda regra cita a fonte ou diz "não encontrado"' + (semFonte.length ? ': ' + semFonte.map(l => l.slice(0, 60)).join(' | ') : ''));

    // c) e d) tabela de fontes
    const linhas = (md.split(/^## Fontes$/m)[1] || '').split('\n').filter(l => new RegExp('^\\| ' + cfg.prefixo + '\\d+ \\|').test(l));
    const fontes = {};
    for (const l of linhas) {
        const c = l.split('|').map(x => x.trim()).slice(1, -1);   // id, título, url, data na página, lida em
        fontes[c[0]] = c;
        let host = '';
        try { const u = new URL(c[2]); host = u.protocol === 'https:' ? u.hostname : ''; } catch (e) { /* URL inválida */ }
        ok(c.length === 5 && c[1].length > 3, c[0] + ' tem título');
        ok(cfg.dominios.includes(host), c[0] + ' é fonte oficial (' + (host || c[2]) + ')');
        ok(/^\d{2}\/\d{2}\/\d{4}$/.test(c[4] || ''), c[0] + ' tem a data em que foi lida (' + c[4] + ')');
    }
    ok(linhas.length > 0, linhas.length + ' fontes na tabela');
    const citadas = new Set((corpo.match(re) || []).map(x => x.slice(1, -1)));
    const orfas = [...citadas].filter(id => !fontes[id]), soltas = Object.keys(fontes).filter(id => !citadas.has(id));
    ok(!orfas.length, 'toda fonte citada está na tabela' + (orfas.length ? ': ' + orfas.join(', ') : ''));
    ok(!soltas.length, 'toda fonte da tabela é citada' + (soltas.length ? ': ' + soltas.join(', ') : ''));

    // e) dado de cliente
    const pessoal = [/[\w.+-]+@[\w-]+\.[\w.]+/, /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/, /\b\d{2}\.?\d{3}\.?\d{3}\/\d{4}-?\d{2}\b/, /\(\d{2}\)\s?9?\d{4}-?\d{4}/];
    ok(!pessoal.some(r => r.test(md)), 'sem e-mail, CPF/CNPJ ou telefone');
}

// f) Shopee × núcleo: a tarifa fixa citada desde 01/10/2026 é a da tabela do copiloto-nucleo.
console.log('── shopee.md × copiloto-nucleo');
if (textos.shopee) {
    const T = require(path.join(RAIZ, 'copiloto-nucleo/src/tarifas.js'));
    const fixa = T.vigentes('shopee', '2026-10-07').filter(l => l.tipo === 'taxa_fixa');
    const fixo = fixa.find(l => l.faixa[0] > 0 && l.faixa[1] === 80), metade = fixa.find(l => l.pct === 50);
    const brl = v => 'R$ ' + (Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ','));
    ok(fixo && textos.shopee.includes('**' + brl(fixo.fixo) + '**'), 'o fixo até R$ 79,99 do núcleo (' + (fixo ? brl(fixo.fixo) : '?') + ') está no shopee.md');
    ok(metade && textos.shopee.includes('**' + brl(metade.faixa[1]) + '** a partir de 01/10/2026'), 'o limite da "metade do preço" do núcleo (' + (metade ? brl(metade.faixa[1]) : '?') + ') está no shopee.md');
}

console.log(falhas ? '\n' + falhas + ' falha(s)' : '\nTUDO OK');
process.exit(falhas ? 1 : 0);
