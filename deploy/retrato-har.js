// Retrato de tela para o GitHub, sem dado de cliente nem do vendedor (M2 Shopee, M3 Magalu; regra da dona, 07/10).
// Entrada: o HAR que o Chrome salva (DevTools › Rede › botão direito › "Save all as HAR with content"), com a tela aberta e recarregada.
// Saída: tests/copiloto/fixtures/<canal>_<tela>_<data>.json com as respostas JSON da tela, anonimizadas, e a lista das URLs (sem a query).
//   · chaves, tipos, booleanos, datas e textos curtos de estado ("READY_TO_SHIP", "Ativo") ficam: é a ESTRUTURA que o código precisa;
//   · nome, apelido, e-mail, telefone, CPF/CNPJ, endereço e CEP viram vazio ou "***";
//   · ids (números de 6+ dígitos e textos com cara de id) viram ids inventados, sempre o mesmo id inventado para o mesmo id real
//     (o pedido 123 da lista e o 123 do detalhe continuam iguais entre si);
//   · títulos, SKUs e textos longos viram "Produto 1", "SKU-1", "Texto 1";
//   · valores (preço, estoque, taxa) são multiplicados por um fator sorteado a cada execução (0,6 a 1,4), com 2 casas: as proporções
//     ficam (preço × quantidade, taxa ÷ preço), o valor real não.
// Também aceita um .html (outerHTML de 2 ou 3 linhas da lista, copiado no DevTools): troca os textos longos e os números do mesmo jeito.
// Uso: node deploy/retrato-har.js <arquivo.har|.html> <canal> <tela> [filtro-de-url]
//      ex.: node deploy/retrato-har.js ~/Downloads/shopee.har shopee produtos api/v3/product
// Depois: node tests/copiloto/teste_fixtures_sem_cliente.js (tem de dar TUDO OK) e conferir o arquivo antes do commit.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const PESSOAL = /^(buyer|receiver|recipient|comprador|destinatario|cliente|customer|shipping|consignee)?_?(name|nome|first_?name|last_?name|full_?name|nick_?name|user_?name|apelido|email|e_?mail|phone|telefone|celular|mobile|cpf|cnpj|doc_?number|document|documento|tax_?id|street|street_?name|street_?number|rua|logradouro|endereco|address|address_?line\d?|full_?address|zip_?code|zip|cep|postal_?code|neighborhood|bairro|city|cidade|district|complement|complemento|state|estado|uf|province|region|avatar|portrait)$/i;
const DONO = /buyer|receiver|recipient|comprador|destinat|client|customer|shipping|address|endereco|contact|contato|consignee|seller|vendedor|shop_?name|loja/i;
const TITULO = /^(title|titulo|name|nome|item_?name|product_?name|model_?name|variation_?name|description|descricao|shop_?name|store_?name)$/i;
const SKU = /sku|seller_?code|codigo|item_?code|model_?sku|ean|gtin|barcode/i;
// Blocos sigilosos inteiros (banco, empresa, e-mail financeiro) e rótulos de pares nome/valor que são dado pessoal (M3, 08/10).
const SIGILO = /^(bank_?account|bank|banco|conta_?bancaria|org|organization|empresa|company|financial_?email|billing|payout|pix_?key|chave_?pix)$/i;
const PAR = /(^|_)(customer|buyer|cliente|comprador|recipient|destinatario)?_?(name|nome|email|phone|telefone|celular|cpf|cnpj|document|documento|doc_?number|address|endereco|zip|cep|street|rua|nickname|apelido)$/i;
// O que a local achou escapando nos retratos de pedidos (08/10): @ e nome do criador/afiliado, nome do depósito, dados do banco fora de um
// bloco "bank", e valores já formatados ("format_price": "R$ 1.234,56"), que não passavam pelo fator.
const TERCEIRO = /(creator|affiliate|afiliado|influencer|author|autor|warehouse|deposito|armazem|filial|branch|pickup|store|shop|seller|vendedor|buyer|customer|cliente|comprador|receiver|recipient|holder|titular)_?(info_?)?(name|nome|handle|username|user_?name|nick_?name|display_?name|unique_?id)$/i;
const BANCO = /bank|banco|agencia|agency|account_?(number|no|num|holder|digit|type)|conta_?(corrente|numero|digito)|iban|swift|card_?(number|last_?4?|holder|brand)|cartao|pix_?key|chave_?pix/i;
const FORMATADO = /(^|_)(format|formatted|display|text|label)(_|$)|_str$|_text$/i;
const ID_CHAVE = /(^|_)(id|ids|sn|order_?sn|uuid|code|token|hash|number|numero)$|Id$|^id/i;
const VALOR = /price|preco|preço|amount|valor|total|fee|taxa|tarifa|cost|custo|stock|estoque|qtd|quantity|quantidade|sold|vendid|income|renda|repasse|commission|comissao|discount|desconto|shipping_?fee|frete|balance|saldo|revenue|gmv/i;
const ESTADO = /^[A-Z][A-Z0-9_]{1,40}$|^[a-z][a-z0-9_]{1,30}$/;   // "READY_TO_SHIP", "normal", "unpaid"
const DATA = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

function criaAnonimo(semente) {
    const fator = semente !== undefined ? semente : 0.6 + crypto.randomInt(0, 801) / 1000;
    const ids = new Map(), cont = { titulo: 0, sku: 0, texto: 0 }, memo = { titulo: new Map(), sku: new Map(), texto: new Map() };
    const novoId = real => {
        const k = String(real);
        if (!ids.has(k)) { const n = String(ids.size + 1); ids.set(k, k.length > n.length + 1 ? '9' + '0'.repeat(Math.max(0, k.length - 1 - n.length)) + n : '9' + n); }
        return ids.get(k);
    };
    const troca = (tipo, real, fazer) => { if (!memo[tipo].has(real)) memo[tipo].set(real, fazer(++cont[tipo])); return memo[tipo].get(real); };
    const num = v => (Number.isInteger(v) && Math.abs(v) < 1e6 ? Math.round(v * fator) : Math.round(v * fator * 100) / 100);
    const textoLivre = s => troca('texto', s, n => 'Texto ' + n);
    // Texto qualquer: some com e-mail, telefone, CPF/CNPJ; ids longos dentro de URLs e textos viram ids inventados.
    const limpaTexto = s => s.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, 'x@exemplo.com')
        .replace(/\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, '(00) 00000-0000')
        .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '***')
        .replace(/\d{6,}/g, d => novoId(d));
    // Valores no formato da tela ("189,90", "1.234,56", "189.90", "42") × fator; sequência de 6+ dígitos sem centavos é id (fica para o limpaTexto).
    function escala(t) {
        return t.replace(/\d[\d.,]*\d|\d/g, tok => {
            if (tok.replace(/\D/g, '').length >= 6 && !/[.,]\d{2}$/.test(tok)) return tok;
            const br = /,\d{1,2}$/.test(tok), n = br ? +tok.replace(/\./g, '').replace(',', '.') : +tok.replace(/,/g, '');
            if (!isFinite(n)) return tok;
            const r = num(n), casas = (tok.match(/[.,](\d{1,2})$/) || [])[1];
            const f = casas ? r.toFixed(casas.length) : String(Math.round(r));
            return br ? f.replace('.', ',') : f;
        });
    }
    // Tudo que está dentro vira de mentira, mantendo os tipos (string "***", número 0, booleano e null como estão).
    const apaga = x => (Array.isArray(x) ? x.map(apaga) : x && typeof x === 'object' ? Object.keys(x).reduce((o, k) => { o[k] = apaga(x[k]); return o; }, {})
        : typeof x === 'number' ? 0 : typeof x === 'string' ? (x === '' ? '' : '***') : x);
    function anda(v, chave, caminho) {
        if (Array.isArray(v)) return v.map(x => anda(x, chave, caminho));
        if (v && typeof v === 'object') {
            // Bloco inteiro do banco, da empresa ou do e-mail financeiro (retrato M3 da Magalu): só a estrutura, todo valor vira "***"/0.
            if (SIGILO.test(String(chave || ''))) return apaga(v);
            const o = {};
            // Par nome/valor ({key: "customer_name", value: "Fulana"}, {name: "cpf", value: …}): a chave pessoal está no TEXTO, não no nome do campo.
            // Com rótulo pessoal, TODO o resto do par some (value, values, display_value, text…); só os campos do rótulo ficam.
            const ROT = ['key', 'name', 'field', 'label', 'type', 'id', 'code'];
            const rotulo = ROT.map(c => v[c]).find(x => typeof x === 'string' && (PAR.test(x.replace(/[-\s]/g, '_')) || TERCEIRO.test(x.replace(/[-\s]/g, '_'))));
            Object.keys(v).forEach(k => { o[k] = rotulo && ROT.indexOf(k) < 0 ? apaga(v[k]) : anda(v[k], k, caminho + '.' + k); });
            return o;
        }
        const k = String(chave || ''), kk = k.replace(/[-\s]/g, '_');
        if (v === null || typeof v === 'boolean') return v;
        if (/^(org_?id|cnpj|company_?id|seller_?document|razao_?social|nome_?fantasia|trade_?name|legal_?name)$/i.test(kk)) return typeof v === 'number' ? 0 : (v === '' ? '' : '***');   // empresa do vendedor (M3)
        if (/creator|affiliate|afiliado|influencer/i.test(caminho) && /name|nome|handle|unique_?id|nick/i.test(kk)) return typeof v === 'number' ? 0 : (v === '' ? '' : '***');
        if (TERCEIRO.test(kk) || BANCO.test(kk)) return typeof v === 'number' ? 0 : (v === '' ? '' : '***');   // criador, depósito, banco
        if (PESSOAL.test(kk) && (DONO.test(caminho) || /cpf|cnpj|email|phone|telefone|celular|mobile|cep|zip|postal|doc_?number|street|address/i.test(kk))) return typeof v === 'number' ? 0 : (v === '' ? '' : '***');   // endereço do comprador E do vendedor (seller_address.state: retrato M2)
        if (typeof v === 'number') {
            if (/time|date|data|_at$|ts$/i.test(k) && v > 1e9) return v;   // timestamp: fica (não é dado pessoal e o código lê datas)
            if (ID_CHAVE.test(k) || (Number.isInteger(v) && Math.abs(v) >= 1e5 && !VALOR.test(k))) return +novoId(v) || v;
            return num(v);
        }
        if (typeof v !== 'string') return v;
        if (v === '' || DATA.test(v) || ESTADO.test(v) || /^(true|false|null)$/i.test(v)) return v;
        if (/^-?\d+([.,]\d+)?$/.test(v)) {   // número em texto ("12.90", "123456789")
            if (ID_CHAVE.test(k) || /^\d{6,}$/.test(v)) return novoId(v);
            const n = +v.replace(',', '.'), r = String(num(n));
            return v.indexOf(',') >= 0 ? r.replace('.', ',') : r;
        }
        if (/^@[\w.]{2,}/.test(v)) return '@***';   // @ de criador/afiliado/loja
        // Valor já formatado ("R$ 1.234,56", "12,5%", "format_price": "189.90"): os números × fator, o resto do texto fica.
        if (/R\$\s?-?\d|\d%/.test(v) || (FORMATADO.test(kk) || VALOR.test(k)) && /\d/.test(v) && v.length <= 40) return limpaTexto(escala(v));
        if (/^https?:\/\//.test(v)) {
            // Imagem e página de produto do vendedor (cdn, fotos, anúncio): o endereço inteiro sai (diz qual é a loja); a API do canal fica, sem a query.
            if (/\.(jpe?g|png|webp|gif|avif|svg)(\?|$)|\/(img|image|images|imagem|foto|photo|media|cdn|file|produto|product|p)\//i.test(v) || /cdn|static|img|image|media/i.test(v.split('/')[2] || ''))
                return 'https://exemplo.invalid/' + (/\.(jpe?g|png|webp|gif|avif|svg)(\?|$)/i.test(v) ? 'imagem.jpg' : 'pagina');
            return limpaTexto(v.split('?')[0]);
        }
        if (SKU.test(k)) return troca('sku', v, n => 'SKU-' + n);
        if (TITULO.test(k)) return DONO.test(caminho) ? '***' : troca('titulo', v, n => 'Produto ' + n);
        if (ID_CHAVE.test(k)) return novoId(v);
        if (v.length > 24) return textoLivre(v);
        return limpaTexto(v);
    }
    const html = s => s.replace(/>([^<]+)</g, (m, t) => {
        const tt = t.trim();
        if (!tt) return m;
        if (tt.length > 24) return '>' + textoLivre(tt) + '<';
        return '>' + limpaTexto(escala(t)) + '<';
    }).replace(/(data-[\w-]*id[\w-]*)="([^"]*)"/gi, (m, a, val) => a + '="' + val.replace(/\d{6,}/g, d => novoId(d)) + '"')
        .replace(/(href|src)="([^"]*)"/gi, (m, a, val) => a + '="' + limpaTexto(val.split('?')[0]) + '"');
    return { json: v => anda(v, '', '$'), html, limpaTexto, fator };
}

function doHar(har, filtro, an) {
    const ents = ((har && har.log && har.log.entries) || []).filter(e => e && e.response && e.response.content);
    const out = [];
    ents.forEach(e => {
        const c = e.response.content, tipo = String(c.mimeType || ''), url = String(e.request && e.request.url || '');
        if (!/json/i.test(tipo) || !c.text || (filtro && url.indexOf(filtro) < 0)) return;
        let txt = c.text;
        if (c.encoding === 'base64') txt = Buffer.from(txt, 'base64').toString('utf8');
        let corpo;
        try { corpo = JSON.parse(txt); } catch (err) { return; }
        const u = new URL(url);
        out.push({ metodo: e.request.method, url: an.limpaTexto(u.origin + u.pathname), parametros: [...u.searchParams.keys()], status: e.response.status, corpo: an.json(corpo) });
    });
    return out;
}

if (require.main === module) {
    const [arq, canal, tela, filtro] = process.argv.slice(2);
    if (!arq || !/^[a-z]+$/.test(canal || '') || !/^[a-z0-9-]+$/.test(tela || '')) {
        console.error('uso: node deploy/retrato-har.js <arquivo.har|.html> <canal: shopee|magalu> <tela: produtos|pedidos|renda…> [filtro-de-url]');
        process.exit(2);
    }
    const an = criaAnonimo(), bruto = fs.readFileSync(arq, 'utf8'), dia = new Date().toISOString().slice(0, 10);
    const pasta = path.join(__dirname, '..', 'tests', 'copiloto', 'fixtures');
    fs.mkdirSync(pasta, { recursive: true });
    if (/\.html?$/i.test(arq)) {
        const destino = path.join(pasta, canal + '_' + tela + '_' + dia + '.html');
        fs.writeFileSync(destino, '<!-- retrato anonimizado (deploy/retrato-har.js) -->\n' + an.html(bruto));
        console.log('ok: ' + path.relative(process.cwd(), destino));
    } else {
        const respostas = doHar(JSON.parse(bruto), filtro, an);
        if (!respostas.length) { console.error('nenhuma resposta JSON' + (filtro ? ' com "' + filtro + '" na URL' : '') + ' no HAR'); process.exit(1); }
        const destino = path.join(pasta, canal + '_' + tela + '_' + dia + '.json');
        fs.writeFileSync(destino, JSON.stringify({ canal, tela, lido_em: dia, origem: 'HAR do Chrome, anonimizado por deploy/retrato-har.js', respostas }, null, 2) + '\n');
        console.log('ok: ' + path.relative(process.cwd(), destino) + ' · ' + respostas.length + ' resposta(s):');
        respostas.forEach(r => console.log('   ' + r.metodo + ' ' + r.url + (r.parametros.length ? ' ?' + r.parametros.join('&') : '')));
    }
    console.log('Agora: node tests/copiloto/teste_fixtures_sem_cliente.js (tem de dar TUDO OK) e confira o arquivo antes do commit.');
}
module.exports = { criaAnonimo, doHar };
