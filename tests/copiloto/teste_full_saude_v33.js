// v3.3 (pedido da dona 07/10/2026): o Full sugere pelo estoque, pelo giro e pela sazonalidade, NÃO manda estoque para anúncio que não sai
// (parado, fora do ar, experiência de compra ruim) e avisa o estoque empacado (armazenagem e estoque antigo). E a experiência de compra
// chega da aba do ML ao sino, com a conta conferida.
// Rodar: node tests/copiloto/teste_full_saude_v33.js
'use strict';
require('./relogio').fixar();
const path = require('path');
global.chrome = { storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } }, runtime: { sendMessage: async () => ({}) } };
const EXT = path.join(__dirname, '../../extension-copiloto');
const SHC = require(path.join(EXT, 'calc.js'));
['store.js', 'ml-extrator.js', 'painel-lateral.js'].forEach(a => require(path.join(EXT, a)));
const P = SHC.pl, montaFundo = require('./fundo_falso'), { B } = montaFundo;
let f = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) f++; };
const HOJE = '2026-10-07';   // 30 dias ≈ setembro; mês alvo (hoje + 15) = outubro → ano passado: base 2025-09, alvo 2025-10

(async () => {
    console.log('Previsão do Full (P.previsaoFull)');
    {
        const vm = { '2025-09': 10, '2025-10': 25 };
        const x = P.previsaoFull(20, vm, HOJE, [], { aptas: 30 });
        ok(x.fonte === 'sazonal' && x.indice === 2.5 && x.qtd === 50, 'sazonal: 20 em 30 dias × (out/25 ÷ set/10 do ano passado = 2,5) = 50');
        ok(P.previsaoFull(20, { '2025-09': 2, '2025-10': 25 }, HOJE, [], { aptas: 30 }).fonte === 'anoPassado', 'mês base com menos de 3 vendas: sem índice (o ano passado puro, 25)');
        ok(P.previsaoFull(20, { '2025-09': 10, '2025-10': 100 }, HOJE, [], {}).qtd === 100 && P.previsaoFull(5, { '2025-09': 10, '2025-10': 100 }, HOJE, [], {}).indice === 3,
            'índice no máximo 3× (o maior entre 30 dias, ano passado e índice segue valendo)');
        ok(P.previsaoFull(30, { '2025-09': 20, '2025-10': 10 }, HOJE, [], {}).qtd === 30, 'época de queda: o índice não reduz (as vendas de 30 dias já mostram)');
        const parado = P.previsaoFull(0, vm, HOJE, [], { aptas: 40 });
        ok(parado.fonte === 'parado' && parado.qtd === 0, 'PARADO: 40 aptas e nenhuma venda em 30 dias → não puxa o ano passado (antes: 25)');
        ok(P.previsaoFull(0, vm, HOJE, [], { aptas: 0 }).qtd === 25, 'sem estoque e sem venda (acabou o estoque): o ano passado ainda vale para repor');
        ok(P.previsaoFull(20, null, HOJE, [], {}).qtd === 20 && P.previsaoFull(null, null, HOJE, [], {}).qtd === null, 'sem histórico: os 30 dias; sem nada: sem previsão (nunca 0 inventado)');
    }

    console.log('Saúde do anúncio antes de mandar estoque (P.saudeEnvioFull)');
    {
        const its = [{ itemId: 'MLB7000000001', status: 'active', userProductId: 'MLBU7000000001' }, { itemId: 'MLB7000000002', status: 'paused' }];
        const exp = (nota, cor, extra) => SHC.mlExperienciaCompra(Object.assign({ item_id: 'MLB7000000001', reputation: { color: cor, value: nota }, status: { id: 'active' } }, extra || {}));
        ok(!P.saudeEnvioFull(its, {}).bloqueia.length, 'um dos anúncios ativo e sem dado de experiência: pode enviar');
        ok(/pausado ou inativo/.test(P.saudeEnvioFull([its[1]], {}).bloqueia[0] || ''), 'todos os anúncios fora do ar: não envia');
        ok(/ruim \(nota 25/.test(P.saudeEnvioFull(its, { exp: { porItem: { MLB7000000001: exp(25, 'red') } } }).bloqueia[0] || ''), 'experiência ruim: não envia');
        const med = P.saudeEnvioFull(its, { exp: { porItem: { MLB7000000001: exp(60, 'orange') } } });
        ok(!med.bloqueia.length && /mediana \(nota 60/.test(med.reduz[0] || ''), 'experiência mediana: envia com cautela (no máximo ' + P.FULL_DIAS_CAUTELA + ' dias)');
        const cg = P.saudeEnvioFull(its, { exp: { porItem: { MLB7000000001: exp(25, 'red', { freeze: { text: 'Benefício de reputação' } }) } } });
        ok(!cg.bloqueia.length && /segurada por um benefício/.test(cg.reduz[0] || ''), 'ruim mas protegida por benefício do ML: cautela, não trava');
        const pausadoExp = exp(40, 'red', { status: { id: 'paused', assigned_by: 'reputation' } });
        ok(/pausou o anúncio pela experiência/.test(P.saudeEnvioFull(its, { exp: { porItem: { MLB7000000001: pausadoExp } } }).bloqueia[0] || ''), 'pausado pelo ML pela experiência: não envia');
        ok(/mais problemas na sua reputação \(3 casos\)/.test(P.saudeEnvioFull(its, { reputacao: { topItens: [{ itemId: 'MLB7000000002', problemas: 3 }] } }).reduz[0] || ''), 'entre os anúncios com problema na reputação: cautela');
        ok(/Qualidade do anúncio básica/.test(P.saudeEnvioFull([its[0]], { editor: { porItem: { MLB7000000001: { qNivel: 'BAD' } } } }).reduz[0] || ''), 'qualidade básica (BAD) no Editor em massa: cautela');
        const bb = P.saudeEnvioFull([{ itemId: 'MLB7000000003', status: 'active', competicao: 'perdendo', competicaoMotivo: 'preco' }, { itemId: 'MLB7000000004', status: 'active', competicao: 'restrito' }], {});
        ok(/Perdendo a Buy Box do catálogo por preço/.test(bb.reduz[0] || '') && !bb.bloqueia.length, 'perdendo a Buy Box (todos os do catálogo): cautela, com o motivo');
        ok(!P.saudeEnvioFull([{ itemId: 'MLB7000000003', status: 'active', competicao: 'perdendo' }, { itemId: 'MLB7000000005', status: 'active', competicao: 'ganhando' }], {}).reduz.length,
            'um dos anúncios ganhando a Buy Box: sem cautela');
        ok(!P.saudeEnvioFull(its, { exp: { porUp: { MLBU7000000001: SHC.mlExperienciaCompra({ up_id: 'MLBU7000000001', reputation: { color: 'green', value: 90 } }) }, porItem: { MLB7000000001: exp(25, 'red') } } }).bloqueia.length,
            'vale o MELHOR anúncio do produto: produto (UP) com nota boa libera o envio');
        // Revisão 07/10/2026: o ML pausa sozinho o anúncio que ESGOTOU (restrição out_of_stock) — é o envio ao Full que o reativa.
        const esg = { itemId: 'MLB7000000009', status: 'paused', restricao: { id: 'out_of_stock', txt: 'Inativo · Não há mais unidades à venda.' } };
        ok(!P.saudeEnvioFull([esg], {}).bloqueia.length, 'esgotado (out_of_stock): não é "fora do ar", o envio repõe');
        ok(!P.saudeEnvioFull([{ itemId: 'MLB7000000009', status: 'paused', estoque: 'Sem estoque' }], {}).bloqueia.length, 'linha que diz "Sem estoque": também esgotado');
        ok(!P.saudeEnvioFull([{ itemId: 'MLB7000000009', status: 'paused' }], { aptas: 0 }).bloqueia.length, 'linha sem o motivo e o produto com 0 aptas no Full: esgotado');
        ok(/fora do ar \(pausado por você\)/.test(P.saudeEnvioFull([{ itemId: 'MLB7000000009', status: 'paused', restricao: { id: 'paused' } }], { aptas: 0 }).bloqueia[0] || ''),
            'pausado pelo seller (mesmo com 0 aptas): não envia e diz o motivo');
        ok(/fora do ar \(em revisão pelo ML\)/.test(P.saudeEnvioFull([{ itemId: 'MLB7000000009', status: 'under_review', restricao: { id: 'under_review' } }], {}).bloqueia[0] || ''), 'em revisão pelo ML: não envia');
        const fullEsg = { produtos: [{ titulo: 'Esgotado', sku: 'X1', itemIds: ['MLB7000000009'], aptas: 0, aCaminho: 0, vendas30: 30 }], espaco: [] };
        const le = P.planoFull(fullEsg, { hoje: HOJE, dias: 30, vmDe: () => null, lucroDe: () => 10, saudeDe: p => P.saudeEnvioFull(P.anunciosDoFull(p, [esg]), { aptas: p.aptas }) }).linhas[0];
        ok(le.qtd === 30 && !le.travas.length, 'plano: produto que vendeu 30 e esgotou no Full → repor 30 (antes: 0, "Não enviar agora")');
    }

    console.log('Plano de envio com a saúde (P.planoFull)');
    {
        const full = { produtos: [
            { titulo: 'Bom', sku: 'A1', itemIds: ['MLB7100000001'], aptas: 10, aCaminho: 0, vendas30: 30 },
            { titulo: 'Ruim', sku: 'A2', itemIds: ['MLB7100000002'], aptas: 10, aCaminho: 0, vendas30: 30 },
            { titulo: 'Mediano', sku: 'A3', itemIds: ['MLB7100000003'], aptas: 10, aCaminho: 0, vendas30: 30 },
            { titulo: 'Parado', sku: 'A4', itemIds: ['MLB7100000004'], aptas: 60, aCaminho: 0, vendas30: 0 },
        ], espaco: [] };
        const saude = { MLB7100000002: { bloqueia: ['Experiência de compra ruim (nota 20 de 100): o anúncio fica quase sem exposição e o estoque empaca no Full.'], reduz: [] },
            MLB7100000003: { bloqueia: [], reduz: ['Experiência de compra mediana (nota 60 de 100): o anúncio perde exposição.'] } };
        const pl = P.planoFull(full, { hoje: HOJE, dias: 45, vmDe: p => (p.sku === 'A4' ? { '2025-10': 40 } : null), lucroDe: () => 10, saudeDe: p => saude[p.itemIds[0]] || { bloqueia: [], reduz: [] } });
        const l = t => pl.linhas.find(x => x.p.titulo === t);
        ok(l('Bom').qtd === 35, 'saudável: 30 × 45 ÷ 30 = 45 − 10 aptas = 35');
        ok(l('Ruim').qtd === 0 && l('Ruim').travas.length === 1, 'experiência ruim: 0 (travado, com o motivo)');
        ok(l('Mediano').qtd === 5 && l('Mediano').diasUsados === 15, 'mediana: cobre só 15 dias (30 × 15 ÷ 30 = 15 − 10 = 5)');
        ok(l('Parado').qtd === 0 && l('Parado').prev.fonte === 'parado', 'parado com estoque: 0, mesmo com 40 vendas no ano passado (antes mandava mais)');
        const ex = P.explicaFull(l('Ruim'), 45).linhas.join(' '), em = P.explicaFull(l('Mediano'), 45).linhas.join(' '), ep = P.explicaFull(l('Parado'), 45).linhas.join(' ');
        ok(/Não sugeri envio: Experiência de compra ruim/.test(ex) && /Cobri só 15 dias, não 45/.test(em) && /não usei o ano passado/.test(ep), 'a explicação diz por quê (travado, cautela e parado)');
        l('Parado').saude = P.saudeFull(l('Parado').p, l('Parado').prev.qtd, null, '');
        const ap = P.acaoParado(l('Parado'));
        ok(l('Parado').saude.classe === 'parado' && l('Parado').saude.excesso === 60 && /60 un\. paradas/.test(ap) && /4 meses/.test(ap) && /retirada/.test(ap),
            'estoque empacado: 60 un. paradas, com armazenagem, estoque antigo (4 meses) e retirada');
        const exc = { p: { aptas: 400, vendas30: 30, tempoEstoque: 0 } };
        exc.saude = P.saudeFull(exc.p, 30, null, '');
        ok(exc.saude.classe === 'excedente' && exc.saude.excesso === 310 && /310 un\. além de 90 dias/.test(P.acaoParado(exc)), 'excedente: 400 aptas − 90 dias de venda (90) = 310 sobrando');
    }

    console.log('Experiência de compra: da tela do ML ao sino');
    {
        const r = { appProps: { pageProps: { u: { sellerId: 900000001 }, bloco: { secoes: [{ x: { item_id: 'MLB7200000001', reputation: { color: 'red', text: 'Ruim', value: 30 }, status: { id: 'active' },
            metrics_details: { problems: [{ key: 'OPERATION', tag: 'PROBLEMA PRINCIPAL', claims: 2, level_two: { key: 'PACK_OFF', title: { text: 'Atrasos no envio' } } }] } } }] } } } };
        const lista = SHC.mlExperienciasDoEstado(r);
        ok(lista.length === 1 && lista[0].nota === 30 && lista[0].problemas[0].titulo === 'Atrasos no envio', 'acha o registro no estado da tela (em qualquer nível)');
        const dados = { 'ml:conta': '900000001', 'ml:anuncios:900000001': { itens: [{ itemId: 'MLB7200000001', titulo: 'Bomba d’água 12V', status: 'active', estoque: 'Full: 30 un.' }] },
            'fiscal:900000001': { tarefas: [{ id: 'GROUPED_PURCHASE_EXPERIENCE_BAD', qtd: 4, titulo: 'Anúncios perdendo exposição', texto: 'Experiência de compra ruim', link: B + '/anuncios?filters=x' },
                { id: 'GROUPED_WITHOUT_STOCK', qtd: 2, titulo: 'Sem estoque', texto: '' }] } };
        const F = montaFundo({ dados });
        const ABA = { tab: { id: 3 }, url: B + '/anuncios/lista' };
        const errada = await F.envia({ acao: 'experiencia_anuncios', lista, conta: { sellerId: '900000002' } }, ABA);
        ok(errada && errada.ok === false && !dados['exp:900000001'] && !dados['exp:900000002'], 'de outra conta: descartada (nenhuma empresa recebe)');
        ok(await F.envia({ acao: 'experiencia_anuncios', lista, conta: { sellerId: '900000001' } }, { tab: { id: 4 }, url: 'https://exemplo.com/' }) === '__sem_resposta', 'de fora do ML: ninguém responde');
        const lixo = [{ id: 'MLB7200000009', nota: 'mil', faixa: '<b>', problemas: 'x', motivos: [1, 2] }].concat(lista);
        const rr = await F.envia({ acao: 'experiencia_anuncios', lista: lixo, conta: { sellerId: '900000001' } }, ABA);
        const ex = dados['exp:900000001'];
        ok(rr && rr.ok && ex && ex.porItem.MLB7200000001.nota === 30 && ex.porItem.MLB7200000009.nota === null && ex.porItem.MLB7200000009.faixa === 'sem'
            && Array.isArray(ex.porItem.MLB7200000009.problemas) && !ex.porItem.MLB7200000009.motivos.length, 'gravou com os tipos conferidos (lixo vira vazio, nunca texto no lugar de número)');
        const melhor = lista.map(x => Object.assign({}, x, { nota: 55, faixa: 'mediana', cor: 'orange' }));
        await F.envia({ acao: 'experiencia_anuncios', lista: melhor, conta: { sellerId: '900000001' } }, ABA);
        ok(dados['exp:900000001'].antes.porItem.MLB7200000001.nota === 30 && dados['exp:900000001'].porItem.MLB7200000001.nota === 55, 'guarda a nota anterior (para o "caiu N pontos")');
        await F.envia({ acao: 'experiencia_anuncios', lista, conta: { sellerId: '900000001' } }, ABA);   // voltou a 30
        const an = await F.ctx.atualizarAlertas('900000001');
        const its = an.anomalias.itens.filter(i => i.tipo === 'experiencia');
        ok(its.some(i => /Bomba d’água 12V: experiência de compra ruim \(nota 30\)/.test(i.texto) && /Caiu 25 pontos/.test(i.texto) && /Não mande mais unidades ao Full/.test(i.texto) && i.vermelho),
            'sino: anúncio com experiência ruim, a queda, o aviso do Full e o problema principal');
        ok(its.some(i => /Anúncios perdendo exposição: Experiência de compra ruim \(4 anúncios\)/.test(i.texto) && i.link) && !its.some(i => /Sem estoque/.test(i.texto)),
            'e o aviso do próprio ML sobre exposição (o de estoque não entra aqui)');
        ok(an.anomalias.vermelho === true && an.anomalias.porTipo.experiencia >= 2, 'conta como urgente no ícone');
    }

    console.log(f ? '\n' + f + ' FALHA(S)' : '\nTUDO OK');
    process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
