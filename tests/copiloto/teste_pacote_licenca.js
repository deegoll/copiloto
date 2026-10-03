// Licença fora do pacote da loja (02/10): licenca.js e licenca-tela.js são código dormente (tela desligada, sem chave de produção,
// servidor fora do ar). Prova: (a) o $dentro do empacotar.ps1 não tem licenca*.js; (b) nenhum arquivo do pacote carrega esses 2 por
// importScripts ou <script>; (c) o background.js sobe sem eles e mensagens/alarme da licença não quebram.
// Religar a licença = ajustar este teste junto. Rodar: node tests/copiloto/teste_pacote_licenca.js
'use strict';
const fs = require('fs'), path = require('path');
const montaFundo = require('./fundo_falso');
const EXT = path.join(__dirname, '../../extension-copiloto');
const LIC = ['licenca.js', 'licenca-tela.js'];
let falhas = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) falhas++; };

(async () => {
    console.log('a) empacotar.ps1');
    const ps1 = fs.readFileSync(path.join(__dirname, '../../deploy/copiloto-chrome-web-store/empacotar.ps1'), 'utf8');
    const lista = nome => { const m = new RegExp('^\\$' + nome + ' = @\\(([^)]*)\\)', 'm').exec(ps1); return m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : []; };
    const dentro = lista('dentro'), fora = lista('fora');
    ok(dentro.length > 20 && ['background.js', 'fundo', 'painel-lateral.html'].every(f => dentro.indexOf(f) >= 0), '$dentro lido (' + dentro.length + ' itens, com o carregador background.js e a pasta fundo/)');
    ok(!dentro.some(f => /^licenca/i.test(f)), '$dentro não tem licenca*.js');
    ok(LIC.every(f => fora.indexOf(f) >= 0) && LIC.every(f => fs.existsSync(path.join(EXT, f))), 'os 2 estão em $fora e continuam na pasta');
    ok(['tiktok.js', 'tiktok-pagina.js', 'tiktok-tela.js', 'nucleo'].every(f => dentro.indexOf(f) >= 0) && ['popup.js', 'copiloto.js'].every(f => fora.indexOf(f) >= 0),
        'TikTok continua no pacote; calculadora e copiloto.js continuam fora');

    console.log('b) nenhum arquivo do pacote carrega a licença');
    const arquivos = [];
    const anda = rel => { const p = path.join(EXT, rel); if (fs.statSync(p).isDirectory()) fs.readdirSync(p).forEach(n => anda(rel + '/' + n)); else if (/\.(js|html|json)$/.test(rel)) arquivos.push(rel); };
    dentro.forEach(anda);
    // Sem comentários: o painel-lateral.html guarda em comentário como religar.
    const semComent = (rel, s) => (/\.html$/.test(rel) ? s.replace(/<!--[^]*?-->/g, '') : s.replace(/(^|\s)\/\/.*$/gm, '$1'));
    const carrega = s => /importScripts\([^)]*licenca(-tela)?\.js/.test(s) || /<script[^>]*src=["']?[./]*licenca(-tela)?\.js/i.test(s) || /["'`][./]*licenca(-tela)?\.js["'`]/.test(s);
    ok(carrega("importScripts('a.js', 'licenca.js')") && carrega('<script src="licenca-tela.js"></script>') && carrega('{"js": ["licenca.js"]}')
        && !carrega(semComent('x.html', '<!-- <script src="licenca.js"></script> -->')) && !carrega(semComent('x.js', "x(); // importScripts('licenca.js')")),
        'o detector acha importScripts, <script> e o nome entre aspas, e ignora comentário');
    const codigo = rel => semComent(rel, fs.readFileSync(path.join(EXT, rel), 'utf8'));
    const culpados = arquivos.filter(rel => carrega(codigo(rel)));
    ok(arquivos.length > 30 && !culpados.length, arquivos.length + ' arquivos do pacote (.js/.html/.json) sem importScripts/<script> de licenca*.js' + (culpados.length ? ' (carregam: ' + culpados.join(', ') + ')' : ''));
    const usam = arquivos.filter(rel => rel !== 'background.js' && !/^fundo\//.test(rel) && /SHC\.licenca|LICENCA_/.test(codigo(rel)));   // fundo/ = o background.js dividido
    ok(!usam.length, 'nenhuma tela do pacote usa SHC.licenca* (só o fundo, com guarda)' + (usam.length ? ' (usam: ' + usam.join(', ') + ')' : ''));

    console.log('c) background.js sobe sem os 2 arquivos');
    const INST = 'X'.repeat(43);
    const f = montaFundo({ faltam: LIC, dados: { 'licenca:inst': INST } });   // como quem vem da 3.2.1 (o inst já foi criado)
    let recusou = false;
    try { f.ctx.importScripts('licenca.js'); } catch (e) { recusou = true; }
    ok(recusou, 'o fundo de teste recusa importScripts de licenca.js (simula o arquivo fora do pacote)');
    ok(!f.ctx.SHC.licencaPreparar && !f.ctx.SHC.LICENCA_ALARME, 'nada da licença carregado no fundo');
    const limpos = [];
    f.ctx.chrome.alarms.clear = n => { limpos.push(n); return Promise.resolve(true); };
    f.instala('install');
    f.instala('update');
    await f.tique(30);
    ok(limpos.indexOf('shc-licenca') >= 0 && !f.alarmes.some(a => a.nome === 'shc-licenca'), 'instalar/atualizar: o alarme shc-licenca não é criado e o que a 3.2.1 deixou é tirado');
    const antes = f.pedidos.length;
    let quebrou = null;
    try { f.alarme('shc-licenca'); } catch (e) { quebrou = e; }
    await f.tique(10);
    ok(!quebrou && f.pedidos.length === antes, 'alarme shc-licenca disparando (vindo da 3.2.1): não quebra e não chama a rede');
    for (const acao of ['licenca_entrar', 'licenca_renovar', 'licenca_sair']) {
        const r = await f.envia({ acao, code: 'A'.repeat(43), verifier: 'B'.repeat(43) }, f.EXT);
        ok(r && r.ok === false && r.erro === 'desligado', acao + ' pelo painel → { ok: false, erro: "desligado" }');
    }
    ok((await f.envia({ acao: 'licenca_renovar' }, { id: 'ml', url: 'https://vendedores.mercadolivre.com.br/x', tab: { id: 1 } })) === '__sem_resposta', 'vinda de uma aba do ML: continua ignorada');
    ok(f.dados['licenca:inst'] === INST && f.dados.licenca === undefined, 'o que a 3.2.1 guardou (licenca:inst) fica; nada novo da licença é gravado');

    console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nTUDO OK');
    process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
