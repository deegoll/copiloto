// N-A (pedido da dona, 08/10/2026): retomada só do que falhou. Depois de uma leitura que chegou ao fim com uma etapa em erro, a próxima
// leitura pedida com {acao:'sincronizar', soErros:true} refaz SÓ a etapa com erro (e as derivadas: alertas sempre, Faturamento quando as
// vendas brutas falharam); as 'ok' entram com jaLida e "continuando de onde parou". O "Sincronizar agora" explícito ('manual') lê tudo.
// Ciclo com mais de CICLO_MS (3 h) não é aproveitado. Troca de conta no meio fecha o ciclo (nada da outra conta vale).
// As leituras de cada etapa são trocadas por contadores (conta e dados inventados); o resto é o fundo de verdade (fundo_falso).
// Rodar: node tests/copiloto/teste_retomada_erros_na.js
'use strict';
require('./relogio').fixar();
const montaFundo = require('./fundo_falso'), vm = require('vm');
let falhas = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) falhas++; };
const CONTA = '900000001';

// Fundo com as leituras trocadas: chamadas[etapa] conta as vezes que cada uma foi ao "ML"; falha = { etapa: true } faz ela falhar.
function monta(dados, falha) {
    const F = montaFundo({ dados, hoje: '2026-10-08', rota: () => null });
    const chamadas = {};
    const conta = id => { chamadas[id] = (chamadas[id] || 0) + 1; return falha[id] ? { falha: 'ml' } : null; };
    F.ctx.__stub = { conta, CONTA };
    vm.runInContext(`
        confereSessao = async () => 'mesma';
        sincronizarAnuncios = async () => (__stub.conta('anuncios') || { sellerId: __stub.CONTA, via: 'fundo', snap: { itens: [] }, paginas: 1, total: 0, completo: true });
        sincronizarVendasBrutas = async () => (__stub.conta('vendasBrutas') || {});
        sincronizarCobrancas = async () => (__stub.conta('faturamento') || { meses: 1, lidas: 1, pedidos: 0, fechamentoMeses: 1, incompletos: [], naoLidos: [] });
        sincronizarFullERemessas = async () => (__stub.conta('full') || { temFull: false, produtos: [] });
        sincronizarAds = async () => (__stub.conta('ads') || { temAds: false, campanhas: [], anuncios: [] });
        sincronizarPosVenda = async () => (__stub.conta('posvenda') || { ts: 1 });
        sincronizarVendasAnuncio = async () => (__stub.conta('vendasAnuncio') || {});
        sincronizarPromos = async () => (__stub.conta('promos') || { vazio: true, familias: 0, propostas: 0, paginas: 0 });
        sincronizarAfiliados = async () => (__stub.conta('afiliados') || { temAfiliados: false });
        fiscalCompartilhado = async () => (__stub.conta('saude') || {});
        sincronizarFaturas = async () => (__stub.conta('faturas') || { faturas: [] });
        sincronizarNfe = async () => null;
        sincronizarRepasse = async () => (__stub.conta('repasse') || { meses: 1, paginas: 1 });
        sincronizarRadar = async () => {}; sincronizarVendasPrejuizo = async () => {};
        atualizarAlertas = async () => (__stub.conta('alertas') || { criticos: 0, anomalias: { total: 0 } });
        completarSkusRetrato = async () => {}; gravarRateio = async () => {};
        resumoVendasBrutas = resumoFaturamento = resumoFull = resumoPosVenda = resumoVendasAnuncio = () => 'lido';
        SHC.afilResumo = () => 'lido';
        historicoConta = async () => ({ falta: 0 });
        sincronizarCustos = async () => {};
    `, F.ctx);
    return { F, chamadas };
}
const soma = c => Object.values(c).reduce((a, b) => a + b, 0);

(async () => {
    console.log('a) 12 etapas ok e 1 com erro (Ads): a 2ª leitura com soErros refaz só o Ads (e os alertas, que são conta de tudo)');
    {
        const dados = { 'ml:conta': CONTA, ['fiscal:' + CONTA]: { ts: 1 } };
        const p1 = monta(dados, { ads: true });
        const st1 = await p1.F.ctx.sincronizar('manual');
        const ids = p1.F.ctx.SHC.SYNC_ETAPAS.map(e => e.id);
        ok(ids.length === 13 && ids.filter(id => st1.etapas[id].estado === 'ok').length === 12 && st1.etapas.ads.estado === 'erro', '1ª leitura: 12 ok e o Ads em erro');
        const c = dados['shc:ciclo'];
        ok(c && !c.fechado && JSON.stringify(c.comErro) === '["ads"]', 'o ciclo fica aberto marcando a etapa com erro');
        const p2 = monta(dados, {});
        const r = await p2.F.envia({ acao: 'sincronizar', soErros: true, esperar: true });
        ok(JSON.stringify(Object.keys(p2.chamadas).sort()) === '["ads","alertas"]' && soma(p2.chamadas) === 2,
            '2ª leitura: pediu só o Ads e refez os alertas (antes: as 13) → ' + JSON.stringify(p2.chamadas));
        ok(r && r.estado === 'ok' && r.etapas.ads.estado === 'ok' && !r.etapas.ads.jaLida && r.etapas.vendasBrutas.jaLida && r.etapas.anuncios.jaLida && !r.etapas.alertas.jaLida,
            'as 11 ok entram como já lidas; o Ads e os alertas foram lidos agora');
        ok(dados['shc:ciclo'].fechado === true, 'sem erro na 2ª, o ciclo fecha');
        ok(p2.F.historico.some(s => s.progresso && s.progresso.continua && s.progresso.continua.feitas >= 11), 'a barra mostra "continuando de onde parou"');
        const p3 = monta(dados, {});
        await p3.F.envia({ acao: 'sincronizar', soErros: true, esperar: true });
        ok(soma(p3.chamadas) === 13, 'ciclo fechado: a próxima leitura lê as 13 de novo');
    }

    console.log('b) o "Sincronizar agora" explícito (sem soErros) continua lendo tudo');
    {
        const dados = { 'ml:conta': CONTA, ['fiscal:' + CONTA]: { ts: 1 } };
        await monta(dados, { ads: true }).F.ctx.sincronizar('manual');
        const p2 = monta(dados, {});
        await p2.F.envia({ acao: 'sincronizar', esperar: true });
        ok(soma(p2.chamadas) === 13, 'manual: as 13 etapas → ' + soma(p2.chamadas));
    }

    console.log('c) vendas brutas com erro: o Faturamento (que soma os dias delas) refaz junto');
    {
        const dados = { 'ml:conta': CONTA, ['fiscal:' + CONTA]: { ts: 1 } };
        await monta(dados, { vendasBrutas: true }).F.ctx.sincronizar('manual');
        const p2 = monta(dados, {});
        await p2.F.envia({ acao: 'sincronizar', soErros: true, esperar: true });
        ok(JSON.stringify(Object.keys(p2.chamadas).sort()) === '["alertas","faturamento","vendasBrutas"]', 'refez vendas brutas, Faturamento e alertas → ' + JSON.stringify(p2.chamadas));
    }

    console.log('d) ciclo com mais de 3 h: nada é aproveitado');
    {
        const dados = { 'ml:conta': CONTA, ['fiscal:' + CONTA]: { ts: 1 } };
        await monta(dados, { ads: true }).F.ctx.sincronizar('manual');
        dados['shc:ciclo'].inicio -= 3 * 3600e3 + 1;
        const p2 = monta(dados, {});
        await p2.F.envia({ acao: 'sincronizar', soErros: true, esperar: true });
        ok(soma(p2.chamadas) === 13, 'ciclo vencido: as 13 de novo → ' + soma(p2.chamadas));
    }

    console.log('e) a etapa que continua falhando segue marcada; a que nunca leu não vira zero');
    {
        const dados = { 'ml:conta': CONTA, ['fiscal:' + CONTA]: { ts: 1 } };
        await monta(dados, { ads: true, full: true }).F.ctx.sincronizar('manual');
        const p2 = monta(dados, { full: true });
        const r = await p2.F.envia({ acao: 'sincronizar', soErros: true, esperar: true });
        ok(JSON.stringify(dados['shc:ciclo'].comErro) === '["full"]' && !dados['shc:ciclo'].fechado && r.etapas.full.estado === 'erro' && r.erroFull,
            'o Full continua em erro e o ciclo continua aberto só com ele');
        ok(!('fullProdutos' in r) && !('temFull' in r), 'o Full nunca lido não grava "0 produtos" no status');
    }

    console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nTUDO OK');
    process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
