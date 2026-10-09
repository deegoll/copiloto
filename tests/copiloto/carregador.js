// Carregador único dos testes (3.3.0, E0): a lista de arquivos sai do próprio HTML e do manifest, nunca de lista fixa no teste.
// Quando o painel-lateral.js e o ml-extrator.js forem divididos (painel/*.js, extrator/*.js), os testes carregam as partes sozinhos.
//   C.scripts('painel-lateral.html') → os <script src> da página, na ordem do HTML (o que está em <!-- --> fica fora)
//   C.painel()                       → painel/*.js + painel-lateral.js, na ordem do painel-lateral.html
//   C.extrator()                     → ml-extrator.js + extrator/*.js, na ordem do manifest
//   C.texto('painel' | 'extrator')   → o texto juntado, para os testes que procuram trechos no código
'use strict';
const fs = require('fs'), path = require('path');
const EXT = path.join(__dirname, '../../extension-copiloto');
const ler = f => fs.readFileSync(path.join(EXT, f), 'utf8');
const scripts = pagina => [...ler(pagina).replace(/<!--[^]*?-->/g, '').matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]);
const painel = () => scripts('painel-lateral.html').filter(f => f === 'painel-lateral.js' || f.startsWith('painel/'));
const extrator = () => {
    const cs = JSON.parse(ler('manifest.json')).content_scripts.find(c => c.js.indexOf('ml-extrator.js') >= 0);
    return cs.js.filter(f => f === 'ml-extrator.js' || f.startsWith('extrator/'));
};
const texto = qual => {
    if (qual !== 'painel' && qual !== 'extrator') throw new Error('C.texto: "' + qual + '" não existe (painel ou extrator)');
    return (qual === 'painel' ? painel() : extrator()).map(ler).join('\n');
};
module.exports = { EXT, ler, scripts, painel, extrator, texto };
