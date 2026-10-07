// v3.3 Textos de contestação (pedido da dona 07/10/2026, com o modelo dela): assunto com SKU e pedido, "Prezada equipe de suporte", os
// números do painel, a regra do ML (título + link da Central) e o pedido explícito (revisão da cubagem, correção para envios futuros e estorno).
// E a trava: o pedido de exclusão só sai para os casos que as regras de exclusão do ML aceitam (nunca o que é responsabilidade do vendedor).
// Revisão 07/10/2026: culpa do vendedor no motivo VETA a exclusão (mesmo com "me arrependi"/"engano" junto), e o caso incerto (🟡, valor
// esperado estimado) pede a CONFERÊNCIA e o estorno só se confirmar — nunca afirma cobrança indevida.
// Rodar: node tests/copiloto/teste_contestacao_v33.js
'use strict';
require('./relogio').fixar();
const path = require('path');
global.chrome = { storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } }, runtime: { sendMessage: async () => ({}) } };
const EXT = path.join(__dirname, '../../extension-copiloto');
const SHC = require(path.join(EXT, 'calc.js'));
['store.js', 'ml-extrator.js', 'fechamento.js', 'painel-lateral.js'].forEach(a => require(path.join(EXT, a)));
let f = 0;
const pendentes = [];   // conferências que rodam o clique do painel (async): rodam no fim, uma depois da outra
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) f++; };
const linhas = t => t.split('\n');

console.log('Formato do modelo da dona (SHC.textoContestacao)');
{
    const t = SHC.textoContestacao({ assunto: 'Contestação de cobrança indevida de frete', ids: [['SKU', 'HA-14253'], ['Pedido', '#2000001'], ['Anúncio', '']], intro: 'Identificamos uma divergência.',
        fatos: ['Valor cobrado: R$ 58,75', ''], regras: ['frete_tabela', 'inexistente'], pedido: 'a revisão da cubagem e o estorno.', anexos: ['nota fiscal do item'] });
    const l = linhas(t);
    ok(l[0] === 'Assunto: Contestação de cobrança indevida de frete – SKU: HA-14253 – Pedido: #2000001', 'assunto com SKU e pedido (vazio fica de fora)');
    ok(l[2] === 'Prezada equipe de suporte do Mercado Livre,' && /Dados do meu painel:\n- Valor cobrado: R\$ 58,75\n\nRegra aplicável:/.test(t), 'saudação formal, fatos em lista (vazio fica de fora)');
    ok(/- Central de Ajuda, "Custos dos Envios no Mercado Livre".*\(https:\/\/www\.mercadolivre\.com\.br\/ajuda\/40538\)/.test(t) && !/inexistente/.test(t), 'regra com título e link oficial; regra desconhecida não entra');
    ok(/\n\nSolicitamos a revisão da cubagem e o estorno\.\n\nSeguem em anexo: nota fiscal do item\.\n\nAtenciosamente\.$/.test(t), 'pedido explícito, anexos e fecho');
    ok(!/\*\*|`|\p{Extended_Pictographic}/u.test(t), 'sem markdown nem emoji (cola igual no chat do ML)');
    const sp = SHC.textoContestacao({ canal: 'shopee', assunto: 'X', regras: ['frete_tabela'], pedido: 'y.' });
    ok(/suporte da Shopee/.test(sp) && !/Regra aplicável/.test(sp), 'Shopee: saudação dela e sem regra do ML');
    ok(/suporte da Magalu/.test(SHC.textoContestacao({ canal: 'magalu', assunto: 'X', pedido: 'y.' })), 'Magalu: saudação dela');
}

console.log('Frete do anúncio (P.textoChamado) no formato novo');
{
    const P = SHC.pl;
    const item = { itemId: 'MLB8000000001', sku: 'HA-14253', frete: 58.75 };
    // fh|ml|MLB: o frete do anúncio por dia (45,35 até 19/09; 58,75 desde 20/09). Pedidos (vd|ml): frete cobrado por pedido.
    const h = P.historicoFrete({ '2026-09-01': 45.35, '2026-09-19': 45.35, '2026-09-20': 58.75, '2026-10-01': 58.75 });
    const vendas = { '3000000001': { d: '2026-09-22', f: 58.75 }, '3000000002': { d: '2026-09-25', f: 58.75 } };
    const t = P.textoChamado(item, h, vendas, true, '30×20×15 cm, 9,2 kg');
    ok(/^Assunto: Contestação de cobrança indevida de frete – SKU: HA-14253 – Anúncio: MLB8000000001/.test(t), 'assunto com SKU e anúncio');
    ok(/passou de R\$ 45,35 para R\$ 58,75 em 20\/09/.test(t) && /#3000000001 de 22\/09.*R\$ 13,40 a mais/.test(t) && /Diferença somada: R\$ 26,80/.test(t), 'a subida, os pedidos e a soma');
    ok(/Não alterei peso, medidas nem embalagem\. Peso e medidas da embalagem no meu cadastro: 30×20×15 cm, 9,2 kg\./.test(t), 'medidas do cadastro quando o seller confirma');
    ok(/Solicitamos a revisão da cubagem \(peso e medidas\).*a correção para os envios futuros e o estorno da diferença cobrada nos pedidos acima \(R\$ 26,80\)/.test(t),
        'pede revisão da cubagem, correção para os envios futuros e o estorno (o modelo da dona)');
    ok(/ajuda\/40538/.test(t) && /Seguem em anexo: especificações técnicas do fabricante/.test(t), 'com a regra do ML e os anexos');
    const sc = P.textoChamado(item, h, vendas, false, '');
    ok(/^Assunto: Pedido de revisão do custo de envio do anúncio/.test(sc) && /se houver erro na cubagem, a correção para os envios futuros e o estorno/.test(sc) && !/indevida/.test(sc),
        'sem o seller confirmar que não mexeu em peso e medidas: pedido de revisão, estorno só se houver erro na cubagem');
}

console.log('Cobrança do Fechamento (SHC.fech.textoChamado)');
{
    const x = { pedido: '2000000123', data: '2026-09-20', itemId: 'MLB8000000002', titulo: 'Bomba d’água', cobranca: 'Tarifa de envio', valor: 58.75, esperado: 45.35, diferenca: 13.4, motivo: 'acima do frete do anúncio', regra: 'frete' };
    const t = SHC.fech.textoChamado(x);
    ok(/^Assunto: Contestação de cobrança indevida: Tarifa de envio – Pedido: #2000000123 – Anúncio: MLB8000000002/.test(t), 'assunto com o tipo da cobrança, pedido e anúncio');
    ok(/- Valor cobrado: R\$ 58,75\n- Valor devido: R\$ 45,35\n- Diferença: R\$ 13,40/.test(t) && /ajuda\/40538/.test(t), 'valor cobrado × devido × diferença, com a regra do frete');
    ok(/Solicitamos a revisão desta cobrança e o estorno da diferença de R\$ 13,40 na nossa conta\./.test(t), 'pede o estorno da diferença');
    const d = SHC.fech.textoChamado(Object.assign({}, x, { duvida: 'pode ser 2 unidades' }));
    ok(/^Olá! Tenho uma dúvida/.test(d) && !/estorno/.test(d) && !/Diferença/.test(d), 'na dúvida continua só perguntando (nunca afirma erro nem pede estorno)');
}

console.log('Devolução, medidas, Full');
{
    const dv = SHC.chamadoDevolucao({ pedido: '2000000555', data: '2026-09-10', valor: 23.9, recuperar: 23.9, porque: 'No pós-venda, o Mercado Livre informou que a devolução não foi de minha responsabilidade.' });
    ok(/Contestação de tarifa de devolução – Pedido: #2000000555/.test(dv) && /devolucoes_3285/.test(dv) && /estorno de R\$ 23,90/.test(dv), 'devolução: pedido, regra da devolução e o estorno');
    const md = SHC.medidasChamado({ itemId: 'MLB8000000003', sku: 'HA-14253', antes: { ordenadas: [9, 7, 39], pesoKg: 1.76 }, depois: { ordenadas: [20, 15, 45], pesoKg: 3.2 },
        em: Date.parse('2026-09-18T12:00:00Z'), vistoAte: Date.parse('2026-09-11T12:00:00Z'), correta: { ordenadas: [9, 7, 39], pesoKg: 1.76 }, corretaDe: 'erp', quem: 'ml' });
    ok(/Pedido de revisão da cubagem do anúncio – SKU: HA-14253 – Anúncio: MLB8000000003/.test(md) && /pedimos também a correção das medidas para 39×7×9 cm e 1,76 kg nos envios futuros/.test(md)
        && /especificações técnicas do fabricante/.test(md) && !/não foi feita por nós|sem que nós mexêssemos|Contestação|estorno/.test(md),
        'medidas: pedido de revisão, correção condicionada à medida do cadastro, especificações do fabricante; nem com quem "ml" afirma autoria ou pede estorno');
    const desce = SHC.medidasChamado({ itemId: 'MLB8000000003', sku: 'HA-14253', antes: { ordenadas: [15, 20, 45], pesoKg: 3.2 }, depois: { ordenadas: [7, 9, 39], pesoKg: 1.76 },
        em: Date.parse('2026-09-18T12:00:00Z'), vistoAte: Date.parse('2026-09-11T12:00:00Z'), correta: null, corretaDe: '', quem: 'ml' });
    ok(/^Assunto: Pedido de revisão da cubagem do anúncio/.test(desce) && !/subiu|aumenta/.test(desce) && !/estorno|custo de envio cobrado/.test(desce) && /Peso considerado no frete/.test(desce),
        'medida que DIMINUIU: só a revisão da cubagem, sem "subiu" e sem estorno');
    const rem = SHC.chamadoRemessa({ id: '61234567', quando: '2026-09-28', custo: 27, prazo: '2026-10-12', declaradas: 100, aptas: 94,
        produtos: [{ itemId: 'MLB8000000004', sku: 'HA-14253', declaradas: 50, processadas: 44, diferencas: -6, aptas: 44, naoAptas: 0, resultado: 'faltando' }, { itemId: 'MLB8000000005', sku: 'B2', declaradas: 50, processadas: 50, diferencas: 0, aptas: 50 }] });
    ok(/Reclamação por diferenças na remessa do Full – Remessa: #61234567/.test(rem) && /SKU HA-14253 \(MLB8000000004\): declaradas 50, processadas 44/.test(rem) && !/SKU B2/.test(rem),
        'Full: só os produtos com diferença, declaradas × processadas');
    ok(/Total cobrado pelo Mercado Livre nesta remessa \(coleta e\/ou penalidade\): R\$ 27,00/.test(rem) && !/multa|por esta inconformidade/.test(rem) && /Prazo para reclamar informado pelo ML: 12\/10\/2026/.test(rem)
        && /se a diferença se confirmar, o estorno do que foi cobrado por ela/.test(rem) && !/cancelamento da cobrança de R\$ 27/.test(rem),
        'Full: o total cobrado na remessa (coleta e/ou penalidade, nunca "multa"), o prazo e o estorno só do que a diferença causou');
    // Auditoria da loja: só unidade não apta (sem diferença de contagem) não é erro de contagem — pede o motivo de cada uma.
    const na = SHC.chamadoRemessa({ id: '61234568', quando: '2026-09-28', custo: 27, declaradas: 50, aptas: 47,
        produtos: [{ itemId: 'MLB8000000004', sku: 'HA-14253', declaradas: 50, processadas: 50, diferencas: 0, aptas: 47, naoAptas: 3, resultado: 'sem etiqueta' }] });
    ok(/^Assunto: Pedido de revisão de unidades não aptas na remessa do Full/.test(na) && /3 unidades foram consideradas não aptas/.test(na) && !/recontagem/.test(na)
        && /se a inaptidão não decorreu do nosso preparo/.test(na), 'Full só com unidades não aptas: pede o motivo de cada uma, sem afirmar erro de contagem');
    // Revisão final (07/10): o ML marcou diferença, mas os produtos estão completos e iguais (sem diferença nem não apta lida): nada de "não aptas".
    const igual = SHC.chamadoRemessa({ id: '61234569', quando: '2026-09-28', custo: 27, declaradas: 10, aptas: 10, motivos: ['com diferenças'],
        produtos: [{ itemId: 'MLB8000000004', sku: 'HA-14253', declaradas: 10, processadas: 10, diferencas: 0, aptas: 10, naoAptas: 0 }] });
    ok(/^Assunto: Pedido de conferência da remessa do Full/.test(igual) && !/não aptas para venda|recebida com diferença|estorno/.test(igual) && /coleta e\/ou penalidade/.test(igual) && !/multa/.test(igual),
        'remessa marcada com diferença, mas sem diferença nem não apta lida por produto: só o pedido de conferência, sem "não aptas" e sem estorno');
    // Diferença só entre declaradas e aptas (sem diferença de contagem por produto): o texto diz "as disponíveis para venda", não "as que o CD processou".
    const soAptas = SHC.chamadoRemessa({ id: '61234570', quando: '2026-09-28', custo: 27, declaradas: 10, aptas: 8, produtos: [{ itemId: 'MLB8000000004', sku: 'HA-14253', declaradas: 10, aptas: 8 }] });
    ok(!soAptas || (/disponíveis para venda/.test(soAptas) && !/que o centro de distribuição processou/.test(soAptas)), 'diferença só nas aptas: "as disponíveis para venda", sem dizer que o CD processou menos');
}

console.log('Medidas (revisão 3): o Copiloto não sabe quem mudou — nunca "o ML mudou" nem "não foi feita por nós"; diz o que mudou e pede a revisão');
{
    const D = d => Date.parse(d + 'T12:00:00Z'), A = { ordenadas: [7, 9, 39], pesoKg: 1.76 }, B = { ordenadas: [15, 20, 45], pesoKg: 3.2 }, C = { ordenadas: [10, 12, 40], pesoKg: 2 };
    const AUTORIA = /não foi feita por nós|sem que nós mexêssemos|Mercado Livre (mudou|alterou)|ML (mudou|alterou)|Contestação/;
    const base = { itemId: 'MLB8000000013', sku: 'HA-90001', antes: A, depois: B, em: D('2026-09-18'), vistoAte: D('2026-09-11') };
    const sem = SHC.medidasChamado(Object.assign({ quem: '?', correta: null, corretaDe: '' }, base)), semCampo = SHC.medidasChamado(Object.assign({ correta: null, corretaDe: '' }, base));
    ok(/^Assunto: Pedido de revisão da cubagem do anúncio – SKU: HA-90001 – Anúncio: MLB8000000013/.test(sem) && !AUTORIA.test(sem),
        'sem saber quem mudou: pedido de revisão, sem afirmar autoria');
    ok(/Medidas da embalagem: de 39×9×7 cm e 1,76 kg para 45×20×15 cm e 3,20 kg entre 11\/09 e 18\/09\./.test(sem) && /Solicitamos a revisão da cubagem do anúncio e a confirmação de qual medida está sendo usada no cálculo do frete\./.test(sem)
        && /Se a medida anterior for a correta, pedimos também a revisão do custo de envio cobrado desde 11\/09\./.test(sem) && !/estorno/.test(sem), 'o texto diz o que mudou (de X para Y, quando) e pede a revisão, sem estorno firme');
    ok(semCampo === sem && SHC.medidasChamado(Object.assign({ quem: 'ml', correta: null, corretaDe: '' }, base)) === sem, 'com ou sem o campo de autoria (até "ml"), o texto é o mesmo');
    const comErp = SHC.medidasChamado(Object.assign({ quem: '?', correta: { ordenadas: [8, 9, 39], pesoKg: 1.8 }, corretaDe: 'erp' }, base));
    ok(/Medidas do nosso cadastro: 39×9×8 cm e 1,80 kg\./.test(comErp) && /Se a medida do nosso cadastro for a correta, pedimos também a correção das medidas para 39×9×8 cm e 1,80 kg nos envios futuros e a revisão do custo de envio cobrado desde 11\/09\./.test(comErp)
        && !AUTORIA.test(comErp) && !/estorno/.test(comErp), 'medida do cadastro conhecida: entra como "Medidas do nosso cadastro", a correção fica condicionada, sem autoria nem estorno');
    const comSeller = SHC.medidasChamado(Object.assign({ quem: '?', correta: A, corretaDe: 'seller' }, base));
    ok(!/Medidas do nosso cadastro|Medidas corretas/.test(comSeller) && !AUTORIA.test(comSeller), 'medida "confirmada" deduzida do histórico não vira "medida correta" no texto');
    // Caso 1 do revisor: o seller troca a caixa direto no site do ML e o ERP ainda tem a velha → antes saía "A alteração não foi feita por nós" e o estorno.
    const porItem = { MLB8000000013: { sku: 'HA-90001', atual: Object.assign({ de: D('2026-09-18'), ts: D('2026-10-05') }, B),
        historico: [Object.assign({ de: D('2026-08-01'), ate: D('2026-09-18'), vistoAte: D('2026-09-11') }, A)] } };
    const comErpH = SHC.medidasMudadas(porItem, D('2026-09-01'), { erpDe: () => A })[0], semRef = SHC.medidasMudadas(porItem, D('2026-09-01'))[0];
    ok(comErpH.quem === '?' && !AUTORIA.test(comErpH.chamado) && /Medidas do nosso cadastro: 39×9×7 cm/.test(comErpH.chamado) && semRef.quem === '?' && !AUTORIA.test(semRef.chamado),
        'pelo histórico, com o ERP igual à medida de antes: nunca marca "ml" nem afirma autoria (antes: "A alteração não foi feita por nós")');
    // Sino: nunca "o Mercado Livre mudou"; diz de X para Y e quando.
    const sino = pi => SHC.anomalias('1', { medidas: { porItem: pi }, agora: D('2026-10-07'), titulos: { MLB8000000013: 'Bomba HA' } }).itens.filter(i => i.tipo === 'medidas').map(i => i.texto);
    const s1 = sino(porItem);
    ok(s1.length === 1 && /^Bomba HA: a medida da embalagem mudou de 39×9×7 cm e 1,76 kg para 45×20×15 cm e 3,20 kg entre 11\/09 e 18\/09\. Se não foi você/.test(s1[0]) && !AUTORIA.test(s1[0]),
        'sino: "a medida mudou de X para Y entre dd/mm e dd/mm", sem culpar o ML');
    // Caso 2 do revisor: A → B → volta para A (vira "confirmada") → o próprio seller muda para C. Antes o sino dizia "o Mercado Livre mudou … para C".
    const volta = { MLB8000000013: { sku: 'HA-90001', atual: Object.assign({ de: D('2026-09-25'), ts: D('2026-10-05') }, C),
        historico: [Object.assign({ de: D('2026-07-01'), ate: D('2026-08-01'), vistoAte: D('2026-07-30') }, A), Object.assign({ de: D('2026-08-01'), ate: D('2026-08-20'), vistoAte: D('2026-08-18') }, B),
            Object.assign({ de: D('2026-08-20'), ate: D('2026-09-25'), vistoAte: D('2026-09-24') }, A)] } };
    const s2 = sino(volta);
    ok(s2.length === 1 && !AUTORIA.test(s2[0]) && /mudou de 39×9×7 cm e 1,76 kg para 40×12×10 cm e 2,00 kg/.test(s2[0]), 'sino com histórico que volta a uma medida antiga: sem "o Mercado Livre mudou"');
    const conf = { MLB8000000013: { sku: 'HA-90001', atual: Object.assign({ de: D('2026-09-18'), ts: D('2026-10-05') }, B),
        historico: [Object.assign({ de: D('2026-07-01'), ate: D('2026-08-01'), vistoAte: D('2026-07-30') }, { ordenadas: [7, 9, 30], pesoKg: 1.5 }),
            Object.assign({ de: D('2026-08-01'), ate: D('2026-09-18'), vistoAte: D('2026-09-11'), quem: 'seller' }, A)] } };
    const s3 = sino(conf), m3 = SHC.medidasMudadas(conf.MLB8000000013 ? conf : {}, D('2026-09-01'))[0];
    ok(s3.length === 1 && !AUTORIA.test(s3[0]) && m3 && m3.quem === '?' && !AUTORIA.test(m3.chamado), '"Fui eu" na medida de ANTES não prova quem fez a mudança seguinte: sem "o Mercado Livre mudou"');
}

console.log('Remessa do Full sem o detalhe por produto (rastreio 07/10, bloqueio 4): nenhum texto de contestação');
{
    // Só a lista do Full (dados inventados): units_count=3 conta PRODUTOS, não unidades; on_sale_units=2.
    const lista = { remessas: [{ id: '61239001', status: 'closed_with_changes', recebida: '2026-09-20', unidades: 3, aptas: 2, custo: 27 }] };
    const inc = SHC.remessasInconformes(lista, { porId: {} }, '2026-09-25');
    ok(inc.length === 1 && inc[0].semDetalhe && SHC.chamadoRemessa(inc[0]) === '', 'só a lista (sem o detalhe lido): nenhum texto ("declaradas 3; disponíveis 2" seria número que o Copiloto não leu)');
    ok(SHC.chamadoRemessa({ id: '61239002', quando: '2026-09-20', custo: 27, declaradas: 3, aptas: 2, produtos: [] }) === '', 'detalhe sem a lista de produtos: também nenhum texto');
    const det = { porId: { '61239001': { produtos: [{ itemId: 'MLB8000000021', sku: 'HA-77001', declaradas: 40, processadas: 37, diferencas: -3, aptas: 37, naoAptas: 0, resultado: 'faltando' }],
        reclamacoesDisponiveis: ['diferencas'] } } };
    const comDet = SHC.remessasInconformes(lista, det, '2026-09-25')[0], t = SHC.chamadoRemessa(comDet);
    ok(/SKU HA-77001 \(MLB8000000021\): declaradas 40, processadas 37/.test(t) && /\(coleta e\/ou penalidade\): R\$ 27,00/.test(t) && !/multa/i.test(t) && !/Unidades declaradas: 3/.test(t),
        'com o detalhe por produto: o texto sai com as unidades do detalhe e o total cobrado como coleta e/ou penalidade (nunca "multa")');
    // Revisão do grupo g: detalhe lido, mas os produtos vieram sem as quantidades (só itemId e SKU): declaradas e aptas voltam a ser as da lista.
    const lista2 = { remessas: [{ id: '61239101', status: 'closed_with_changes', recebida: '2026-09-20', unidades: 3, aptas: 2, custo: 27 }] };
    const dSem = SHC.mlRemessaDetalheDoEstado({ inboundId: 61239101, status: 'closed_with_changes', unitsDetail: {}, units: [{ itemId: 'MLB8000000031', sku: 'HA-77011' },
        { itemId: 'MLB8000000032', sku: 'HA-77012' }, { itemId: 'MLB8000000033', sku: 'HA-77013' }], claims: { typesClaimsAvailable: [{ type: 'RECOUNT', enabledToClaim: true }] } });
    const incSemQtd = SHC.remessasInconformes(lista2, { porId: { '61239101': dSem } }, '2026-09-25');
    ok(incSemQtd.length === 1 && !incSemQtd[0].semDetalhe && SHC.chamadoRemessa(incSemQtd[0]) === '', 'detalhe sem as quantidades por produto: nenhum texto (antes: "Unidades declaradas: 3; disponíveis para venda: 2", os números da lista)');
    const soDecl = SHC.remessasInconformes(lista2, { porId: { '61239101': { produtos: [{ itemId: 'MLB8000000031', sku: 'HA-77011', declaradas: 3 }], reclamacoesDisponiveis: ['diferencas'] } } }, '2026-09-25')[0];
    ok(soDecl && SHC.chamadoRemessa(soDecl) === '', 'produtos com as declaradas, mas sem as aptas nem diferença por produto: nenhum texto (as aptas seriam as da lista)');
    // Revisão 3: os totais e o "recebida com diferença" só com TODOS os produtos com declaradas e aptas (every, não some).
    const lista3 = { remessas: [{ id: '61239501', status: 'closed_with_changes', recebida: '2026-09-20', unidades: 2, aptas: 1, custo: 27 }] };
    const r3txt = units => { const d = SHC.mlRemessaDetalheDoEstado({ inboundId: 61239501, status: 'closed_with_changes', unitsDetail: {}, units, claims: { typesClaimsAvailable: [{ type: 'RECOUNT', enabledToClaim: true }] } });
        const i = SHC.remessasInconformes(lista3, { porId: { '61239501': d } }, '2026-09-25')[0]; return i ? SHC.chamadoRemessa(i) : ''; };
    const firme = t => /Reclama[çc][ãa]o por diferen[çc]as|recebida com diferen[çc]a|Unidades declaradas:|estorno/i.test(t);
    const c1 = r3txt([{ itemId: 'MLB8000000041', sku: 'HA-1', declaredQuantity: 10, processedQuantity: 10, readyToFullQuantity: 10 }, { itemId: 'MLB8000000042', sku: 'HA-2', declaredQuantity: 5 }]);
    ok(!firme(c1) && !/15|disponíveis para venda: 10/.test(c1), 'um produto completo + um só com as declaradas: sem "declaradas 15; disponíveis 10", sem "recebida com diferença" nem estorno (antes: reclamação firme)');
    const c2 = r3txt([{ itemId: 'MLB8000000041', sku: 'HA-1', declaredQuantity: 10 }, { itemId: 'MLB8000000042', sku: 'HA-2', readyToFullQuantity: 4 }]);
    ok(!firme(c2) && !/declaradas: 10; dispon/.test(c2), 'declaradas de um produto e aptas de outro: sem os totais nem reclamação firme (antes: "declaradas: 10; disponíveis: 4")');
    const c3 = r3txt([{ itemId: 'MLB8000000041', sku: 'HA-1', declaredQuantity: 10, processedQuantity: 8, differencesQuantity: -2, readyToFullQuantity: 8 }, { itemId: 'MLB8000000042', sku: 'HA-2', declaredQuantity: 5 }]);
    ok(!firme(c3) && /SKU HA-1 \(MLB8000000041\): declaradas 10, processadas 8/.test(c3) && !/HA-2/.test(c3), 'produto com diferença + outro incompleto: só o produto completo, sem total e sem reclamação firme');
    const c4 = r3txt([{ itemId: 'MLB8000000041', sku: 'HA-1', declaredQuantity: 10, processedQuantity: 8, differencesQuantity: -2, readyToFullQuantity: 8 }, { itemId: 'MLB8000000042', sku: 'HA-2', declaredQuantity: 5, processedQuantity: 5, readyToFullQuantity: 5 }]);
    ok(/^Assunto: Reclamação por diferenças na remessa do Full/.test(c4) && /SKU HA-1 \(MLB8000000041\): declaradas 10, processadas 8/.test(c4), 'todos os produtos completos: a reclamação por diferenças continua saindo');
    // O sino (SHC.remessasInconformes): com status "closed_ok", a soma parcial (15 declaradas × 10 aptas) não vira "unidades com diferenças".
    const okSt = { remessas: [{ id: '61239601', status: 'closed_ok', recebida: '2026-09-20', unidades: 2, aptas: 2, custo: 27 }] };
    const dOk = SHC.mlRemessaDetalheDoEstado({ inboundId: 61239601, status: 'closed_ok', unitsDetail: {}, units: [{ itemId: 'MLB8000000041', sku: 'HA-1', declaredQuantity: 10, processedQuantity: 10, readyToFullQuantity: 10 },
        { itemId: 'MLB8000000042', sku: 'HA-2', declaredQuantity: 5 }], claims: {} });
    ok(SHC.remessasInconformes(okSt, { porId: { '61239601': dOk } }, '2026-09-25').length === 0, 'remessa "closed_ok" com um produto sem as aptas: a soma parcial não marca "unidades com diferenças"');
    // O botão e o clique do painel, como estão no arquivo.
    const fs = require('fs'), src = fs.readFileSync(path.join(EXT, 'painel-lateral.js'), 'utf8');
    ok(/const cop = pend && SHC\.chamadoRemessa\(r\) \?/.test(src), 'painel: o botão "Copiar texto da reclamação" só aparece quando há texto');
    const ini = src.indexOf("const rc = t.closest('[data-rem-copiar]');"), bloco = src.slice(ini, src.indexOf("const pex = t.closest('[data-pos-excluir]');", ini));
    const clique = (rs, id) => {
        let copiado = null;
        const t = { closest: x => (x === '[data-rem-copiar]' ? { dataset: { remCopiar: id } } : null) }, nav = { clipboard: { writeText: async x => { copiado = x; } } };
        const f = new Function('t', 'incRemessas', 'navigator', 'SHC', 'aba', 'desenhaFull', 'let remCopiada = ""; return (async () => { ' + bloco + ' })().then(() => remCopiada);');
        return f(t, () => rs, nav, SHC, 'full', () => {}).then(rc => ({ copiado, rc }));
    };
    pendentes.push(() => Promise.all([clique(inc, '61239001'), clique([comDet], '61239001'), clique(incSemQtd, '61239101')]).then(([a, b, c]) => {
        console.log('Remessa do Full: o clique do painel');
        ok(ini > 0 && a.copiado === null && a.rc === '' && b.copiado === t && b.rc === '61239001', 'painel: o clique sem detalhe não copia nada; com detalhe copia o texto');
        ok(c.copiado === null && c.rc === '', 'painel: o clique com o detalhe sem as quantidades por produto não copia nada');
    }));
}

console.log('Frete casado pela data (auditoria da loja): só o par sem ambiguidade é contestável');
{
    const fd = { MLB8000000001: { '2026-09-01': 45.35, '2026-09-19': 45.35, '2026-09-20': 58.75, '2026-10-01': 58.75 } };
    const ret = { MLB8000000001: { frete: 58.75 } };
    const dois = SHC.conciliaFrete([{ pedido: '9100000001', itemId: 'MLB8000000001', data: '2026-09-22', cobrado: 45.35, formato: 'gratis' },
        { pedido: '9100000002', itemId: 'MLB8000000001', data: '2026-09-22', cobrado: 58.75, formato: 'gratis' }],
        ret, [{ pedido: '2000000018', itemId: 'MLB8000000001', data: '2026-09-18' }, { pedido: '2000000021', itemId: 'MLB8000000001', data: '2026-09-21' }], '2026-10-06', fd);
    ok(dois.pagoAMais.every(p => p.talvezUnidades) && dois.totalAMais === 0 && !(SHC.fech.recuperar({ conc: dois }).parcelas.find(x => x.id === 'frete')),
        '2 vendas e 2 fretes do anúncio com outro número: nada vai para "cobrado a mais (confirmado)" nem vira chamado (antes: "cobrança indevida" falsa de R$ 13,40)');
    const um = SHC.conciliaFrete([{ pedido: '9100000003', itemId: 'MLB8000000001', data: '2026-09-23', cobrado: 58.75, formato: 'gratis' }],
        ret, [{ pedido: '2000000019', itemId: 'MLB8000000001', data: '2026-09-18' }], '2026-10-06', fd);
    const p1 = SHC.fech.recuperar({ conc: um }).parcelas.find(x => x.id === 'frete');
    ok(um.pagoAMais.length === 1 && !um.pagoAMais[0].talvezUnidades && p1 && /– Pedido: #2000000019 – Frete: #9100000003/.test(SHC.fech.chamadoFrete(p1.itens[0], 'Bomba')),
        'par único (1 venda e 1 frete do anúncio no período): contestável, e o texto cita o número do frete');
}

console.log('Exclusão de reclamação e experiência de compra: só o que as regras do ML aceitam');
{
    const sim = ['Me arrependi da compra', 'Comprei por engano', 'Não reconheço esta compra', 'Diz que não recebeu mas consta como entregue', 'Demora dos Correios', 'Quero trocar de tamanho'];
    const nao = ['Produto com defeito', 'Chegou diferente do anunciado', 'Faltam peças', 'O vendedor não despachou', 'Sem estoque', 'Produto falsificado'];
    ok(sim.every(m => SHC.motivoExcluivel(m)), 'excluíveis: arrependimento, engano, não reconhece, consta entregue, demora do transporte, troca de tamanho');
    ok(nao.every(m => !SHC.motivoExcluivel(m)), 'NÃO excluíveis: defeito, diferente do anunciado, faltando, não despachou, sem estoque, falsificado');
    const ex = SHC.chamadoExclusao({ motivo: 'Me arrependi da compra', casos: 3, naReputacao: 2, produtos: ['Bomba d’água 12V'] });
    ok(/Pedido de análise de reclamações para exclusão da reputação/.test(ex) && /regras-de-exclusao-de-reclamacoes/.test(ex) && /Regra de exclusão em que pode se enquadrar: o comprador se arrependeu/.test(ex)
        && /\(3 casos, 2 contando na reputação\)/.test(ex) && !/se enquadram nas regras/.test(ex), 'pedido de exclusão: pede a análise, com a regra em que PODE se enquadrar e os números');
    const exp = SHC.chamadoExclusao({ motivo: 'Me arrependi da compra', casos: 2, naReputacao: 2, pedidos: ['2000000901', '2000000902'] });
    ok(/- Pedidos: #2000000901, #2000000902\./.test(exp) && /a análise de cada pedido acima e, nos que se enquadrarem, a exclusão/.test(exp), 'com os números dos pedidos: análise de cada um, exclusão só dos que se enquadrarem');
    ok(SHC.chamadoExclusao({ motivo: 'Produto com defeito', casos: 5 }) === '', 'defeito: nenhum pedido de exclusão (corrigir a causa)');
    const x = SHC.mlExperienciaCompra({ item_id: 'MLB8000000006', reputation: { color: 'orange', value: 55 }, metrics_details: { problems: [{ tag: 'PROBLEMA PRINCIPAL', claims: 3, level_three: { key: 'X', title: { text: 'Arrependimento do comprador' } } }], distribution: { from: '2026-04-01T00:00:00Z', to: '2026-10-01T00:00:00Z' } } });
    const te = SHC.chamadoExperiencia(x, [{ pedido: '2000000777', motivo: 'Me arrependi' }, { pedido: '2000000778', motivo: 'Produto com defeito' }]);
    ok(/Pedido #2000000777: o comprador se arrependeu/.test(te) && !/2000000778/.test(te) && /experiencia-de-compra_31968/.test(te), 'experiência: só o pedido excluível entra');
    ok(SHC.chamadoExperiencia(x, [{ pedido: '2000000778', motivo: 'Produto com defeito' }]) === '', 'sem caso excluível: nenhum texto');
    // Revisão 07/10/2026: frases que misturam um motivo excluível com culpa do vendedor.
    const veto = ['Me arrependi porque veio com defeito', 'Produto com defeito, quero trocar de modelo', 'O vendedor não postou nos Correios', 'Recebi o tamanho errado',
        'Produto enviado por engano (veio outro)', 'Faltam peças, a transportadora entregou a caixa aberta', 'Chegou diferente do anunciado, dúvida sobre a troca',
        'Desisti: o produto não chegou', 'Chegou quebrado pela transportadora', 'Desisti porque não tinha estoque'];
    const passou = veto.filter(m => SHC.motivoExcluivel(m));
    ok(!passou.length, 'culpa do vendedor no motivo VETA a exclusão (defeito, não postou, tamanho errado enviado, veio outro, faltando, não chegou, quebrado, estoque)'
        + (passou.length ? ': ' + passou.join(' | ') : ''));
    ok(SHC.motivoExcluivel('Comprei o tamanho errado, quero trocar') && SHC.motivoExcluivel('Comprou errado'), 'o erro do PRÓPRIO comprador continua excluível (troca, engano)');
    // Decisão da local (07/10, zero risco): "demorou demais/muito" sem dizer quem atrasou pode ser o despacho; só com Correios, transportadora
    // ou Mercado Envios no motivo é demora do transporte.
    const vaga = ['Demorou demais para chegar', 'Demorou muito para chegar', 'A entrega demorou demais', 'Desisti porque demorou muito', 'Muito demorado', 'Demorou muito mesmo para entregar'];
    const vagaPassou = vaga.filter(m => SHC.motivoExcluivel(m));
    ok(!vagaPassou.length, 'demora vaga ("demorou demais/muito" sem Correios ou transportadora): sem pedido de exclusão' + (vagaPassou.length ? ': ' + vagaPassou.join(' | ') : ''));
    // O mesmo para o atraso: "chegou atrasado", "a entrega atrasou" e variações sem o transportador ficam sem regra.
    const atraso = ['Chegou atrasado', 'A entrega atrasou', 'Entrega atrasada', 'Chegou com 5 dias de atraso', 'Passou do prazo de entrega', 'Chegou depois do prazo', 'Atrasou a entrega', 'Demora na entrega',
        'Atraso na entrega', 'Demorou para chegar', 'O produto foi enviado no prazo mas chegou atrasado', 'Chegou com 10 dias de atraso', 'Estou esperando há 20 dias, entrega atrasada',
        'Desisti, chegou atrasado', 'Não quero mais, demorou para chegar'];   // antes da decisão de 07/10 eram da regra do transporte
    const atrasoPassou = atraso.filter(m => SHC.motivoExcluivel(m));
    // Revisão final (07/10): a vírgula e o ponto separam orações ("Comprei o produto, está errado" não é o erro do comprador), e "você/vc" é o
    // vendedor ("foi engano de vc" não é reclamação aberta por engano).
    const oracoes = ['Comprei o produto, está errado', 'Pedi a peça. Está errada', 'Pedi 3, quantidade errada', 'pedi o item, esta errado', 'Selecionei a voltagem, está errada',
        'Comprei. Produto errado', 'comprei, peças erradas', 'pedi 40, está errado', 'foi engano de vc', 'foi engano de você', 'foi engano tb de você', 'foi engano de voce, desculpe o transtorno',
        'atrasou a entrega pela logistica de vc'];
    const oracoesPassou = oracoes.filter(m => SHC.motivoExcluivel(m));
    ok(!oracoesPassou.length, 'culpa do vendedor depois de vírgula ou ponto, e "você/vc": sem pedido de exclusão' + (oracoesPassou.length ? ': ' + oracoesPassou.join(' | ') : ''));
    const legitPont = ['Me arrependi da compra.', 'Desisti, comprei em outro lugar', 'Reclamação aberta por engano.', 'Comprei por engano', 'Escolhi o tamanho errado.'];
    const legitPontTravou = legitPont.filter(m => !SHC.motivoExcluivel(m));
    ok(!legitPontTravou.length, 'com pontuação, o arrependimento e o erro do comprador continuam excluíveis' + (legitPontTravou.length ? ': ' + legitPontTravou.join(' | ') : ''));
    ok(!atrasoPassou.length, 'atraso sem Correios, transportadora ou Mercado Envios no motivo: sem pedido de exclusão' + (atrasoPassou.length ? ': ' + atrasoPassou.join(' | ') : ''));
    const comQuem = ['Os Correios demoraram demais', 'A transportadora demorou demais', 'Demorou demais pelo Mercado Envios',
        'Os Correios atrasaram a entrega', 'Entrega atrasada pela transportadora', 'Demora dos Correios'];
    ok(comQuem.every(m => /demora do transporte/.test(SHC.motivoExcluivel(m))), 'demora com Correios, transportadora ou Mercado Envios no motivo continua na regra da demora do transporte');
    // 2ª revisão (07/10): despacho demorado e mensagem sem resposta são do vendedor; o engano e o "não foi usado" do comprador voltam a valer.
    const veto2 = ['Desisti porque demorou para despachar', 'Me arrependi, demorou demais para postar', 'Desisti, o vendedor não respondeu', 'Mensagem sem resposta, desisti', 'Engano no envio'];
    const vazou = veto2.filter(m => SHC.motivoExcluivel(m));
    ok(!vazou.length, 'despacho demorado, vendedor que não respondeu e engano no envio: sem pedido de exclusão' + (vazou.length ? ': ' + vazou.join(' | ') : ''));
    // Auditoria da loja: erro do comprador + culpa do vendedor no mesmo motivo → veta; transporte só com demora/atraso explícitos.
    const veto3 = ['Comprei errado e veio com defeito', 'Comprei errado e veio faltando peça', 'Escolhi o tamanho errado, e o produto é falsificado', 'Selecionei o tamanho errado e veio manchado',
        'Me arrependi, o produto não funcionou', 'Me arrependi, veio sem a caixa', 'Desisti porque o vendedor demorou', 'Correios: vendedor postou com atraso',
        'Pacote violado pelos Correios', 'Chegou aberto pela transportadora', 'Os Correios não entregaram'];
    const vazou3 = veto3.filter(m => SHC.motivoExcluivel(m));
    ok(!vazou3.length, 'erro do comprador não anula a culpa do vendedor; pacote violado/aberto/não entregue não é "demora do transporte"' + (vazou3.length ? ': ' + vazou3.join(' | ') : ''));
    ok(/arrependeu/.test(SHC.motivoExcluivel('Comprei por engano')) && /arrependeu/.test(SHC.motivoExcluivel('Engano na compra')) && /reclamação por engano/.test(SHC.motivoExcluivel('Abri a reclamação por engano'))
        && /meio de contato/.test(SHC.motivoExcluivel('Só queria perguntar sobre a garantia')), 'erro na compra é arrependimento; reclamação aberta por engano e meio de contato têm a regra deles');
    const comprador = ['Me arrependi, o produto não foi usado', 'Me arrependi, nunca usado', 'Escolhi o tamanho errado', 'Engano na compra', 'Foi engano'];
    const travou = comprador.filter(m => !SHC.motivoExcluivel(m));
    ok(!travou.length, 'erro ou arrependimento do comprador ("não foi usado", "escolhi errado", "foi engano"): excluível' + (travou.length ? ': ' + travou.join(' | ') : ''));
    ok(SHC.confereExclusao('Atraso dos Correios') === 'você despachou dentro do prazo e a entrega não foi feita por você (Flex)' && SHC.confereExclusao('Me arrependi da compra') === 'o produto voltou sem uso e em perfeitas condições'
        && SHC.confereExclusao('Produto com defeito') === '', 'cada regra diz o que o seller confere antes de enviar (nada quando não é excluível)');
    ok(!/respondidas|resolvidas/.test(ex), 'o pedido de exclusão não afirma o que o Copiloto não sabe ("já respondidas/resolvidas")');
}

console.log('Exclusão (rastreio 07/10, bloqueio 4): culpa do vendedor escrita de outro jeito nunca é excluível');
{
    const vazou = l => l.filter(m => SHC.motivoExcluivel(m));
    const travou = l => l.filter(m => !SHC.motivoExcluivel(m));
    // Autopeças: veículo incompatível é do anúncio (a regra oficial veta); "não serviu" sozinho não diz que é troca de tamanho.
    const veiculo = ['Não serviu no meu carro', 'Nao serviu no meu carro', 'nao serve no meu veiculo', 'A peça não serve no meu veículo', 'Não é compatível com o meu carro',
        'Incompatível com meu veículo', 'nao encaixou na moto', 'Quero trocar o modelo, não serviu no meu carro', 'Não serviu', 'num serviu no carro', 'ñ serviu na minha moto',
        'O anúncio dizia que era compatível e não serviu', 'Não serviu, a compatibilidade do anúncio está errada'];
    const v1 = vazou(veiculo);
    ok(!v1.length, 'autopeças: veículo incompatível (e "não serviu" sozinho) não é excluível' + (v1.length ? ': ' + v1.join(' | ') : ''));
    // Despacho atrasado é do vendedor, não demora do transporte.
    const despacho = ['Despachou com atraso', 'Vendedor despachou com atraso', 'despachou atrasado, chegou tarde', 'Enviou atrasado e chegou depois do prazo', 'Atraso no envio e na entrega',
        'Produto chegou atrasado porque o vendedor despachou depois do prazo', 'demoraram pra postar e chegou atrasado', 'So postaram depois de 5 dias, chegou atrasado',
        'Não foi postado no prazo, chegou atrasado', 'Chegou atrasado pq nao foi despachado', 'Atrasaram o envio', 'Mandaram tarde, atrasou a entrega', 'Enviaram fora do prazo, chegou atrasado',
        'Ainda não saiu, está atrasado', 'Atrasou a entrega porque o vendedor demorou', 'Não quero mais, demorou demais para chegar porque não foi postado'];
    const v2 = vazou(despacho);
    ok(!v2.length, '"despachou com atraso" e variações: não é demora do transporte' + (v2.length ? ': ' + v2.join(' | ') : ''));
    // Produto com defeito ou estragado não é arrependimento (com e sem acento, gíria).
    const estado = ['Desisti, veio trincado', 'desisti veio trincado', 'Me arrependi, veio riscado', 'Desisti, o produto veio vazando', 'Me arrependi, veio com cheiro forte',
        'Desisti porque chegou molhado', 'Desisti, enferrujado', 'Mudei de ideia, o produto estava sujo', 'Mudou de ideia, o produto estava sujo', 'Me arrependi, produto de má qualidade',
        'me arrependi, produto de ma qualidade', 'Desisti, veio todo zoado', 'Me arrependi, uma porcaria', 'Desisti, nao liga', 'Me arrependi, ñ funciona', 'Desisti, pifou no primeiro dia',
        'Me arrependi, veio rachado', 'Desisti, veio amassado', 'Desisti, a caixa veio vazia', 'Desisti, deu defeito', 'arrependi, veio estragado', 'Desisti, veio arranhado',
        'Desisti, veio com mofo', 'Desisti, nao carrega', 'Me arrependi, faz barulho', 'Me arrependi, veio usado', 'Me arrependi, não é original', 'desisti, xing ling', 'Desisti, veio torto'];
    const v3 = vazou(estado);
    ok(!v3.length, '"desisti, veio trincado" e variações: defeito ou estado ruim não é arrependimento' + (v3.length ? ': ' + v3.join(' | ') : ''));
    // Diferente do anúncio, da foto ou do comprado; vendedor, nota e garantia.
    const outro = ['Comprei mas chegou errado', 'Comprei um e recebi errado', 'Comprei e recebi o modelo trocado', 'Engano: veio a cor trocada', 'Desisti, a cor é outra',
        'Desisti, veio menor que o anunciado', 'Desisti, não é o da foto', 'Me arrependi, a foto do anúncio enganava', 'As medidas do anúncio não batem', 'Tamanho não corresponde à tabela de medidas',
        'Não reconheço o produto que chegou', 'Recebi por engano outro produto', 'Engano na cor enviada', 'nada a ver com a foto, desisti', 'Desisti, não é o que eu pedi',
        'Me arrependi, propaganda enganosa', 'Comprei azul e veio vermelho, desisti', 'Desisti, a voltagem veio errada', 'Desisti: o vendedor cancelou', 'Desisti porque a nota fiscal não veio',
        'Me arrependi, veio sem garantia', 'Desisti, o vendedor sumiu', 'Desisti, ninguém me respondeu', 'Desisti, só veio 1 de 2', 'O vendedor se enganou', 'Aparece como entregue mas veio vazio'];
    const v4 = vazou(outro);
    ok(!v4.length, 'produto diferente do anúncio/da foto, chegou errado, vendedor, nota e garantia: não é excluível' + (v4.length ? ': ' + v4.join(' | ') : ''));
    // Os legítimos continuam: arrependimento puro, erro do comprador na compra, demora do transporte sem culpa do vendedor, troca escolhida.
    const legit = ['Me arrependi da compra', 'me arrependi', 'Desisti da compra', 'Não quero mais', 'nao quero mais o produto', 'Mudei de ideia', 'mudei de idéia',
        'Recebi o produto, mas não quero mais', 'Comprei por engano', 'comprei errado', 'Escolhi o tamanho errado', 'Pedi a cor errada', 'Engano na compra', 'Foi engano',
        'Abri a reclamação por engano', 'Demora dos Correios', 'Atraso dos Correios', 'Os Correios atrasaram a entrega', 'Desisti, os Correios atrasaram',
        'O produto foi enviado no prazo mas os Correios atrasaram', 'Quero trocar de tamanho', 'Comprei o tamanho errado, quero trocar', 'Trocar por outro modelo', 'Não reconheço esta compra',
        'nao reconheco essa compra', 'Consta como entregue mas não recebi', 'Só queria perguntar sobre a garantia', 'Me arrependi, o produto não foi usado',
        'Desisti, comprei outro modelo em outra loja', 'Desisti, achei mais barato em outra loja'];
    const t1 = travou(legit);
    ok(!t1.length, 'continuam excluíveis: arrependimento puro, erro do comprador, demora do transporte, troca escolhida' + (t1.length ? ': ' + t1.join(' | ') : ''));
    ok(/escolha do comprador/.test(SHC.confereExclusao('Quero trocar de tamanho')) && /compatibilidade/.test(SHC.confereExclusao('Quero trocar de tamanho')),
        'troca de tamanho/modelo: o seller confere que foi escolha do comprador, não medida, tabela ou compatibilidade errada no anúncio');
    ok(SHC.chamadoExclusao({ motivo: 'Desisti, veio trincado', casos: 2, naReputacao: 2, pedidos: ['2000000951'] }) === ''
        && SHC.chamadoExclusao({ motivo: 'Vendedor despachou com atraso', casos: 1, naReputacao: 1 }) === '', 'com culpa do vendedor no motivo, nenhum texto de exclusão sai');
}

console.log('Exclusão (revisão do grupo g): só o núcleo da regra + complementos neutros dela; qualquer outra oração fica sem regra');
{
    const vazou = l => l.filter(m => SHC.motivoExcluivel(m));
    const travou = l => l.filter(m => !SHC.motivoExcluivel(m));
    const msg = (t, l) => t + (l.length ? ': ' + l.join(' | ') : '');
    // Autopeças sem as palavras "carro", "veículo", "compatível": a troca só vale pura (ou com o complemento de vestuário).
    const a1 = vazou(['Quero trocar o modelo, não deu no meu gol', 'Quero trocar o modelo, a furação não bateu', 'trocar por outro modelo, a rosca não bateu',
        'quero trocar o modelo pq nao e pro meu civic', 'Quero trocar de modelo, peça não é do meu ano', 'Quero trocar o modelo, não entra no meu onix', 'Quero trocar o modelo, a peça é de outro ano',
        'Quero trocar o modelo, não é pro meu ano/modelo', 'Quero trocar o modelo, não é pro meu fusca', 'Quero trocar o modelo, o furo não alinha', 'Quero trocar o modelo, é de outra versão',
        'quero trocar o modelo, veio errado', 'Quero trocar o tamanho, a tabela está errada', 'Quero trocar o tamanho, veio menor']);
    ok(!a1.length, msg('troca com outra oração (veículo, ano, furação, rosca, tabela): sem regra', a1));
    // Despacho atrasado com o substantivo antes do verbo, em preparação, "só saiu", loja: é do vendedor.
    const a2 = vazou(['A postagem atrasou e a entrega demorou', 'o despacho demorou e a entrega atrasou', 'Ficou em preparação 6 dias e a entrega atrasou',
        'ficou aguardando postagem uma semana e atrasou a entrega', 'O pedido só saiu depois de uma semana e chegou atrasado', 'levou uma semana pra sair e chegou atrasado',
        'o pacote ficou parado na loja 5 dias, chegou atrasado', 'a loja segurou o pedido e atrasou a entrega', 'Os Correios atrasaram, o produto não foi postado no prazo',
        'Chegou atrasado porque a loja demorou', 'Chegou atrasado e com defeito', 'Entrega atrasou, o envio foi feito depois do prazo', 'O pedido atrasou']);
    ok(!a2.length, msg('despacho, preparo, "só saiu", loja (em qualquer ordem): não é demora do transporte', a2));
    // Tamanho, número ou voltagem trocados pelo vendedor (sem "errado", "outro" ou "diferente").
    const a3 = vazou(['Quero trocar o tamanho, pedi 40 e veio 42', 'Quero trocar o tamanho pq mandaram 42 e eu pedi 40', 'Quero trocar o tamanho, chegou 38 e eu pedi 40',
        'quero trocar de numeração, pedi 39 e mandaram 41', 'Desisti, pedi M e veio G', 'desisti, veio 220v e eu pedi 110v', 'Quero trocar o número, mandaram 39']);
    ok(!a3.length, msg('o comprador diz o que pediu e o que chegou: o vendedor mandou outro, sem regra', a3));
    // Defeito, qualidade ou diferença do anúncio com palavra fora de qualquer lista: o arrependimento só vale com complemento neutro.
    const a4 = vazou(['Desisti, a tampa veio solta', 'desisti, a costura abriu', 'me arrependi, desmontou no primeiro uso', 'Desisti, desfiou na primeira lavagem', 'desisti, encolheu na lavagem',
        'desisti pq a tela veio com pixel morto', 'Desisti, a bateria não dura nada', 'Desisti, esquenta demais', 'me arrependi, solta tinta', 'Desisti, produto péssimo', 'desisti, produto muito ruim',
        'Me arrependi, é muito fraco', 'Desisti, horrível', 'me arrependi, coisa de camelô', 'Desisti, é menor do que o informado', 'Desisti, nao parece com a imagem',
        'desisti, é bem menor que nas especificações', 'desisti, o titulo dizia que servia no gol', 'desisti, não é a marca que comprei', 'Desisti, é de plástico e não de metal como dizia',
        'Me arrependi, a cor não é igual a da imagem', 'Desisti, veio em espanhol', 'Me arrependi, não é o que eu esperava', 'Desisti, a peça não serve', 'Desisti, é muito pequeno',
        'Me arrependi, não faz o que promete', 'Desisti, a loja não responde', 'desisti, a loja cancelou meu pedido', 'escolhi errado pq tava escrito 110v', 'Mudei de ideia, vou vender o carro']);
    ok(!a4.length, msg('"desisti, a tampa veio solta" e outras orações fora da lista neutra: sem regra', a4));
    // Engano da loja não é engano do comprador.
    const a5 = vazou(['Engano da loja', 'Engano da empresa', 'Foi engano deles', 'Foi engano da loja', 'Foi engano, veio outro produto', 'Engano no pedido, mandaram outro', 'Engano na separação']);
    ok(!a5.length, msg('engano da loja, da empresa, "deles": sem regra', a5));
    // Os legítimos (os que já passavam e os que tinham travado sem precisar) continuam excluíveis.
    const l1 = travou(['Me arrependi, achei em outro anúncio mais barato', 'Me arrependi, o produto está com o lacre intacto', 'Os Correios atrasaram, o produto foi postado no prazo',
        'Quero trocar o tamanho, não serviu', 'Quero trocar o tamanho, não coube', 'Quero trocar o tamanho, ficou apertado', 'Quero trocar o número, ficou grande', 'Quero trocar o tamanho por um maior',
        'Troca de tamanho', 'Quero trocar o modelo', 'Me arrependi de ter comprado', 'Desisti, ja comprei outro', 'Me arrependi, comprei outro igual mais barato', 'Desisti, nem abri a caixa',
        'Desisti, devolvo lacrado', 'Me arrependi, comprei outro na loja física', 'Desisti, comprei por impulso', 'Comprei 2 por engano', 'comprei a cor errada', 'Me arrependi, não combinou com o meu sofá',
        'Me arrependi, quero devolver', 'Comprei sem querer', 'Engano meu, desculpe', 'Abri por engano', 'Foi engano, pode cancelar a reclamação', 'Não reconheço essa compra, não fui eu',
        'Não fiz esta compra', 'No rastreio consta como entregue mas nao recebi', 'Atraso dos Correios', 'Estou esperando há 20 dias, os Correios atrasaram',
        'Demorou demais pra chegar, ficou parado nos correios', 'A transportadora atrasou a entrega', 'Só queria tirar uma dúvida']);
    ok(!l1.length, msg('continuam excluíveis: arrependimento com complemento neutro, troca pura, engano do comprador, transporte com o envio no prazo', l1));
    ok(/demora do transporte/.test(SHC.motivoExcluivel('Os Correios atrasaram, o produto foi postado no prazo')) && /demora do transporte/.test(SHC.motivoExcluivel('Não quero mais, demorou para chegar pelos Correios'))
        && /reclamação por engano/.test(SHC.motivoExcluivel('Engano meu')) && /arrependeu/.test(SHC.motivoExcluivel('Engano na compra')), 'cada motivo cai na regra certa (transporte, engano, arrependimento)');
    // Escolha documentada: o erro do comprador com o veículo junto fica como DÚVIDA (a compatibilidade pode ter vindo do anúncio); "tamanho
    // errado" sem dizer quem errou e "não gostei do cheiro" (pode ser o produto com cheiro) também. Na dúvida, não marca.
    const d1 = vazou(['Comprei a peça errada pro meu carro', 'Comprei o modelo errado pra minha moto', 'Tamanho errado', 'Desisti, não gostei do cheiro do perfume']);
    ok(!d1.length, msg('dúvida (erro do comprador com o veículo, "tamanho errado", "cheiro"): não marca', d1));
}

console.log('Exclusão (revisão 3): entre o verbo do comprador e "errado/por engano" só a lista fechada; agente e anúncio vetam antes de tirar o trecho');
{
    const ex = SHC.motivoExcluivel;
    const culpa = ['Comprei certo, separaram errado', 'Comprei, o vendedor separou errado', 'Pedi, a loja separou errado', 'Comprei certo, embalaram errado', 'Comprei certo, despacharam errado',
        'Comprei certo, faturaram errado', 'Pedi certo, separaram errado', 'Comprei 1, separaram 2 por engano', 'Comprei preto, despacharam branco por engano', 'Comprei 40, separaram 42 por engano',
        'Comprei azul, separaram errado', 'Escolhi, vendedor separou errado', 'Comprei, o vendedor colocou errado', 'Comprei, botaram o modelo errado', 'Comprei, trocaram por engano',
        'Comprei, a loja trocou por engano', 'Comprei um, cobraram dois por engano', 'Comprei, o vendedor errado', 'Comprei, etiquetaram errado', 'Comprei com a descrição errada', 'Comprei pela foto errada',
        'Comprei pela tabela errada', 'Comprei com a informação errada', 'Comprei com a medida errada', 'Escolhi pela tabela errada', 'Comprei pelo anúncio errado', 'Comprei pela ficha errada',
        'Selecionei pela descrição errada', 'Comprei, a loja mandou errado', 'Comprei, o vendedor despachou errado', 'Comprei e o vendedor separou errado', 'Pedi pela foto errada',
        'Escolhi pela foto errada do anúncio', 'Comprei, vendedor cobrou por engano', 'Comprei 1 unidade, faturaram 2 por engano', 'Comprei pelo título errado', 'Comprei com o título errado',
        'Selecionei com a voltagem errada da descrição', 'Comprei o anúncio errado', 'Comprei de vendedor errado', 'comprei certo vcs separaram errado', 'comprei certinho loja separou errado',
        'pedi certo separaram errado', 'Comprei na loja errada', 'Me arrependi, vcs demoraram', 'Desisti, o vendedor demorou', 'Comprei o tamanho certo, separaram errado'];
    const vazou = culpa.filter(m => ex(m));
    ok(!vazou.length, culpa.length + ' frases com vendedor, loja, preparo, envio, cobrança ou anúncio entre o verbo e "errado/por engano": nenhuma é excluível' + (vazou.length ? ' — vazou: ' + vazou.join(' | ') : ''));
    const duvida = ['Foi engano no pedido', 'Foi engano do pedido', 'Engano no pedido', 'Foi engano nos pedidos', 'Foi engano no produto', 'Engano no envio', 'Engano de produto',
        'Comprei o tamanho errado porque a tabela tava errada', 'Pedi a cor errada pq a foto engana'];
    ok(duvida.every(m => !ex(m)), '"foi engano no/do pedido" é ambíguo (costuma ser o pedido que veio errado): sem regra');
    const legit = ['Reclamação aberta por engano', 'Desisti, comprei em outro lugar', 'Me arrependi, vou comprar outro', 'Desisti, comprei na loja física', 'Desisti, comprei em outra loja',
        'Comprei por engano', 'Comprei errado', 'Comprei a cor errada', 'Comprei o tamanho errado', 'Escolhi a voltagem errada', 'Comprei o número errado', 'Comprei o modelo errado', 'Comprei o produto errado',
        'Comprei a peça errada', 'Pedi a quantidade errada', 'Comprei 3 por engano', 'Comprei duas vezes por engano', 'Comprei 2 vezes por engano', 'Comprei em dobro por engano', 'Comprei duplicado por engano',
        'Comprei isso por engano', 'Pedi errado', 'Engano na compra', 'Foi engano', 'Me arrependi da compra', 'Desisti, achei em outro anúncio mais barato', 'Foi engano, o pedido chegou certinho'];
    const travou = legit.filter(m => !ex(m));
    ok(!travou.length, legit.length + ' motivos legítimos continuam excluíveis (os 4 que o revisor viu travar voltaram)' + (travou.length ? ' — travou: ' + travou.join(' | ') : ''));
    ok(ex('Reclamação aberta por engano') === 'o comprador iniciou a reclamação por engano' && /arrependeu/.test(ex('Desisti, comprei na loja física')), 'cada legítimo cai na regra certa');
}

console.log('Caso incerto: pede a conferência, nunca afirma cobrança indevida');
{
    const dv = SHC.devolucoesContestar([{ pedido: '2000000999', itemId: 'MLB1', data: '2026-09-10', valor: 23.9, linhas: [{ v: 23.9 }] }], null, false).itens[0];
    ok(dv.cor === 'amarelo' && /^Assunto: Pedido de revisão de tarifa de devolução – Pedido: #2000000999/.test(dv.texto), 'devolução sem dado do pós-venda (🟡): "Pedido de revisão"');
    ok(!/não deveria ter sido cobrada|por não ser de nossa responsabilidade/.test(dv.texto) && /se ela não foi nossa, o estorno de R\$ 23,90/.test(dv.texto),
        'não afirma que não era nossa; pede o estorno só se a responsabilidade não foi nossa');
    const tr = SHC.devolucoesContestar([{ pedido: '2000000998', itemId: 'MLB1', data: '2026-09-10', valor: 30, linhas: [{ v: 30 }] }], { '2000000998': { motivo: 'Chegou amassado', afetouReputacao: null } }, false).itens[0];
    ok(tr.cor === 'amarelo' && /O que observamos: O motivo informado foi “Chegou amassado”, que pode ter acontecido no transporte\./.test(tr.texto), 'transporte (🟡): o fato observado vai no texto, sem afirmar');
    const vd = SHC.devolucoesContestar([{ pedido: '2000000997', itemId: 'MLB1', data: '2026-09-10', valor: 20, linhas: [{ v: 20 }] }], { '2000000997': { motivo: 'Me arrependi', afetouReputacao: false } }, false).itens[0];
    ok(vd.cor === 'verde' && /^Assunto: Contestação de tarifa de devolução/.test(vd.texto) && /estorno de R\$ 20,00 na nossa conta, por não ser de nossa responsabilidade/.test(vd.texto),
        'arrependimento do comprador (🟢): a contestação firme continua');
    const mx = SHC.devolucoesContestar([{ pedido: '2000000996', itemId: 'MLB1', data: '2026-09-10', valor: 25.9, linhas: [{ v: 25.9 }] }], { '2000000996': { motivo: 'Comprei errado e veio com defeito', afetouReputacao: null } }, false).itens[0];
    ok(mx.cor === 'amarelo' && mx.regra === 'motivo_misto' && /^Assunto: Pedido de revisão de tarifa de devolução/.test(mx.texto) && !/por não ser de nossa responsabilidade/.test(mx.texto),
        'motivo misto ("comprei errado e veio com defeito"): 🟡 e pedido de revisão (antes: arrependimento com contestação firme)');
    const base = { pedido: '2000000123', data: '2026-09-20', itemId: 'MLB8000000002', cobranca: 'Tarifa de venda', regra: 'tarifa', valor: 30, esperado: 20, diferenca: 10,
        motivo: 'No preço de hoje (R$ 150,00), este anúncio paga R$ 20,00 de tarifa por unidade. Se o preço da venda foi outro, pode estar certo.' };
    const ta = SHC.fech.textoChamado(Object.assign({ estimado: 'Pelo preço atual do anúncio (R$ 150,00), a tarifa de venda seria de R$ 20,00 por unidade.' }, base));
    ok(/^Assunto: Pedido de revisão de cobrança: Tarifa de venda – Pedido: #2000000123/.test(ta) && /Valor esperado \(estimativa nossa\): R\$ 20,00/.test(ta)
        && /Como estimamos: Pelo preço atual do anúncio \(R\$ 150,00\)/.test(ta) && /se a diferença se confirmar, o estorno de R\$ 10,00/.test(ta) && !/indevida|Valor devido/.test(ta),
        'tarifa estimada pelo preço de hoje: revisão com a base da estimativa, estorno só se confirmar');
    ok(/^Assunto: Pedido de revisão de cobrança/.test(SHC.fech.textoChamado(base)), 'item guardado por versão anterior (sem .estimado, "pode estar certo"): também revisão');
    // 2ª revisão: o item do "quanto dá para recuperar" tem valor = a diferença; o texto copiado usa o valor COBRADO.
    const rec = Object.assign({}, base, { valor: 10, cobrado: 30 });
    ok(/- Valor cobrado: R\$ 30,00\n- Valor esperado \(estimativa nossa\): R\$ 20,00\n- Diferença: R\$ 10,00/.test(SHC.fech.textoChamado(SHC.fech.itemDoChamado(rec))),
        'texto copiado do "Como pedir de volta": cobrado R$ 30 × esperado R$ 20 (antes saía "cobrado R$ 10")');
    const fr = SHC.fech.chamadoFrete({ pedido: '2000000124', data: '2026-09-21', itemId: 'MLB8000000002', cobrado: 58.75, esperado: 45.35, valor: 13.4 }, 'Bomba');
    ok(/^Assunto: Contestação de cobrança indevida: Frete de envio da venda/.test(fr) && /ajuda\/40538/.test(fr), 'frete acima do custo que o anúncio mostra: contestação firme, com a regra do frete do ML');
}

// Por último: o handler do botão roda com await (a área de transferência falsa); o resumo sai depois dele.
console.log('Pedido de exclusão (rastreio 07/10, R10): os pedidos certos, o SKU e nada em mediação — o botão do painel');
{
    const fs = require('fs');
    const P = SHC.pl, mot = 'Me arrependi da compra';
    const emMed = SHC.emMediacao || (() => null), grupo = P.grupoExclusao || (() => undefined);   // antes da correção não existiam: ✗ em vez de quebrar
    // posvenda:<conta> como o fundo grava: casos sem o nº do pedido; porPedido = nº → motivo, reputação e situação (dados inventados).
    const posvenda = {
        casos: [{ titulo: 'Bomba d’água 12V', motivo: mot, afetouReputacao: true, situacao: 'Aguardando sua resposta', valor: 89.9 },
            { titulo: 'Bomba d’água 12V', motivo: mot, afetouReputacao: true, situacao: 'Em mediação com o Mercado Livre', valor: 89.9 },
            { titulo: 'Bomba d’água 12V', motivo: 'Produto com defeito', afetouReputacao: true, situacao: 'Aguardando sua resposta', valor: 89.9 }],
        porPedido: {   // revisão do grupo g: o porPedido guarda o título do produto (SHC.posvendaJuntaPorPedido)
            '2000000101': { atual: true, motivo: mot, afetouReputacao: true, situacao: 'Mediação em andamento', titulo: 'Bomba d’água 12V' },
            '2000000102': { atual: true, motivo: mot, afetouReputacao: null, situacao: 'Aguardando sua resposta', titulo: 'Bomba d’água 12V' },
            '2000000103': { atual: true, motivo: mot, afetouReputacao: true, situacao: 'Aguardando sua resposta', titulo: 'Bomba d’água 12V' },
            '2000000104': { atual: true, motivo: mot, afetouReputacao: true, situacao: 'Em mediação com o Mercado Livre', titulo: 'Bomba d’água 12V' },
            '2000000105': { atual: true, motivo: 'Produto com defeito', afetouReputacao: true, situacao: 'Aguardando sua resposta', titulo: 'Bomba d’água 12V' },
            '2000000106': { atual: true, motivo: mot, afetouReputacao: false, situacao: 'Aguardando sua resposta', titulo: 'Bomba d’água 12V' } } };
    const itens = [{ itemId: 'MLB9100000001', sku: 'BOMBA-12V', titulo: 'Bomba d’água 12V' }, { itemId: 'MLB9100000002', sku: 'FILTRO-01', titulo: 'Filtro de ar esportivo' }];
    ok(['Mediação em andamento', 'Em mediação com o Mercado Livre', 'O comprador pediu ajuda ao Mercado Livre', 'O Mercado Livre está analisando o caso'].every(m => emMed(m) === true)
        && ['Aguardando sua resposta', 'Aguardando a devolução', ''].every(m => emMed(m) === false), 'situação com mediação aberta (ou o ML decidindo) é reconhecida');
    // O handler do botão "Copiar pedido de exclusão", como está no painel, rodando com a área de transferência falsa.
    const src = fs.readFileSync(path.join(EXT, 'painel-lateral.js'), 'utf8'), ini = src.indexOf("const pex = t.closest('[data-pos-excluir]');");
    const bloco = src.slice(ini, src.indexOf("const ccp = t.closest('[data-conc-copiar]');", ini));
    const clique = async (pv, m) => {
        let copiado = null;
        const t = { closest: s => (s === '[data-pos-excluir]' ? { dataset: { posExcluir: m } } : null) }, nav = { clipboard: { writeText: async x => { copiado = x; } } };
        const f = new Function('t', 'posvenda', 'itens', 'navigator', 'desenhaPos', 'SHC', 'P', 'let posCopiado = ""; return (async () => { ' + bloco + ' })().then(() => posCopiado);');
        const pc = await f(t, pv, itens, nav, () => {}, SHC, P);
        return { copiado, pc };
    };
    const espera = (async () => {
        const r = await clique(posvenda, mot), txt = r.copiado || '';
        ok(ini > 0 && /#2000000102, #2000000103\./.test(txt) && !/2000000101|2000000104/.test(txt) && !/2000000105|2000000106/.test(txt) && r.pc === mot,
            'botão: só os pedidos do motivo, fora os em mediação (101, 104), o de outro motivo (105) e o que não contou na reputação (106)');
        ok(/^Assunto: Pedido de análise de reclamações para exclusão da reputação – SKU: BOMBA-12V\n/.test(txt) && /- Produtos: SKU BOMBA-12V \(Bomba d’água 12V\)\./.test(txt)
            && /\(2 casos, 1 contando na reputação\)/.test(txt), 'botão: o texto leva o SKU (no assunto e no produto) e os números certos');
        const soMed = { casos: [posvenda.casos[1]], porPedido: { '2000000104': posvenda.porPedido['2000000104'] } };
        const r2 = await clique(soMed, mot);
        ok(grupo(soMed, mot, itens) === null && r2.copiado === null && r2.pc === '', 'tudo em mediação: o botão não aparece e o clique não copia nada');
        // O botão: só com caso da leitura atual, fora da mediação, que conta na reputação (o da mediação não vale).
        const soMedConta = { casos: [posvenda.casos[1], Object.assign({}, posvenda.casos[0], { afetouReputacao: false })], porPedido: posvenda.porPedido };
        ok((grupo(posvenda, mot, itens) || {}).contaAgora === 1 && (grupo(soMedConta, mot, itens) || {}).contaAgora === 0
            && /\(P\.grupoExclusao\(posvenda, x\.motivo, itens\) \|\| \{\}\)\.contaAgora > 0/.test(src),
            'o botão só aparece com caso da leitura atual, fora da mediação, que conta na reputação');
        const semNum = { casos: posvenda.casos.slice(0, 2) }, g3 = grupo(semNum, mot, itens), t3 = SHC.chamadoExclusao(g3);
        ok(g3 && g3.casos === 1 && !g3.pedidos.length && /\(1 caso, 1 contando na reputação\)/.test(t3) && /SKU BOMBA-12V/.test(t3) && /a análise de cada caso/.test(t3),
            'pós-venda lido sem o nº do pedido: conta só o caso fora da mediação e leva o SKU');
        const semSku = SHC.chamadoExclusao({ motivo: mot, casos: 1, naReputacao: 1, produtos: [{ sku: '', titulo: 'Produto sem SKU' }], pedidos: ['2000000107'] });
        ok(/^Assunto: Pedido de análise de reclamações para exclusão da reputação – Pedido: #2000000107\n/.test(semSku) && /- Produtos: Produto sem SKU\./.test(semSku), 'sem SKU conhecido: o título');
        // Revisão do grupo g (dados inventados): o SKU de um produto nunca vai para o pedido de outro.
        console.log('Pedido de exclusão (revisão do grupo g): SKU do produto certo e mediação reconhecida pelo que o ML escreve');
        const pad = 'Não quero mais o produto', aguarda = 'Aguardando sua resposta';
        // Ontem o 2000000201 (Filtro), hoje o 2000000202 (Bomba), o mesmo motivo padrão do ML: o porPedido guarda o título de cada um.
        const pp = SHC.posvendaJuntaPorPedido(null, [{ pedido: '2000000201', motivo: pad, afetouReputacao: true, situacao: aguarda, titulo: 'Filtro de ar esportivo' },
            { pedido: '2000000202', motivo: pad, afetouReputacao: true, situacao: aguarda, titulo: 'Bomba d’água 12V' }]);
        // Revisão final (07/10): o pedido visto numa leitura anterior (ontem) fica guardado, mas fora do pedido de exclusão (pode ter ido para a mediação).
        const ppOntem = SHC.posvendaJuntaPorPedido(SHC.posvendaJuntaPorPedido(null, [{ pedido: '2000000211', motivo: pad, afetouReputacao: true, situacao: aguarda, titulo: 'Filtro de ar esportivo' }]),
            [{ pedido: '2000000212', motivo: pad, afetouReputacao: true, situacao: aguarda, titulo: 'Bomba d’água 12V' }]);
        const gOntem = grupo({ casos: [{ titulo: 'Bomba d’água 12V', motivo: pad, afetouReputacao: true, situacao: aguarda }], porPedido: ppOntem }, pad, itens);
        ok(ppOntem['2000000211'].atual === false && ppOntem['2000000212'].atual === true && gOntem && JSON.stringify(gOntem.pedidos) === '["2000000212"]',
            'pedido de uma leitura anterior fica guardado (atual: false), mas fora do pedido de exclusão; só o da leitura atual entra');
        ok(pp && pp['2000000201'].titulo === 'Filtro de ar esportivo' && pp['2000000202'].titulo === 'Bomba d’água 12V', 'o porPedido guarda o título do produto de cada pedido');
        const r1 = await clique({ casos: [{ titulo: 'Bomba d’água 12V', motivo: pad, afetouReputacao: true, situacao: aguarda }], porPedido: pp }, pad), x1 = r1.copiado || '';
        ok(/^Assunto: Pedido de análise de reclamações para exclusão da reputação\n/.test(x1) && /- Produtos: SKU FILTRO-01 \(Filtro de ar esportivo\); SKU BOMBA-12V \(Bomba d’água 12V\)\./.test(x1)
            && /- Pedidos: #2000000201, #2000000202\./.test(x1), 'botão: pedidos de 2 produtos → os 2 produtos e nenhum SKU no assunto (antes: "SKU: BOMBA-12V" também para o pedido do filtro)');
        // porPedido de versão anterior (sem o título) + o caso de hoje sem o nº: o produto do pedido antigo é desconhecido.
        const velho = { casos: [{ titulo: 'Bomba d’água 12V', motivo: pad, afetouReputacao: true, situacao: aguarda }], porPedido: { '2000000301': { atual: true, motivo: pad, afetouReputacao: true, situacao: aguarda } } };
        const r2b = await clique(velho, pad), x2 = r2b.copiado || '';
        ok(/^Assunto: Pedido de análise de reclamações para exclusão da reputação – Pedido: #2000000301\n/.test(x2) && !/SKU|Produtos:/.test(x2),
            'botão: pedido antigo sem o título lido → nem produto nem SKU (antes: "SKU: BOMBA-12V – Pedido: #2000000301", e o 301 era do filtro)');
        // Mediação: o ML escreve em 1ª pessoa; situação vazia (não se sabe) também fica fora.
        ok(['O comprador pediu nossa ajuda', 'Pediram nossa ajuda', 'Vamos decidir até 10 de outubro', 'Decidiremos até 12 de outubro', 'Estamos analisando o caso', 'Aguardando nossa decisão',
            'Intervimos no caso', 'Em revisão'].every(m => emMed(m) === true), 'mediação escrita pelo ML em 1ª pessoa ("pediram nossa ajuda", "vamos decidir", "intervimos") é reconhecida');
        const vazia = { casos: [{ titulo: 'Bomba d’água 12V', motivo: pad, afetouReputacao: true, situacao: aguarda }, { titulo: 'Bomba d’água 12V', motivo: pad, afetouReputacao: true, situacao: '' }],
            porPedido: { '2000000401': { atual: true, motivo: pad, afetouReputacao: true, titulo: 'Bomba d’água 12V' }, '2000000402': { atual: true, motivo: pad, afetouReputacao: true, situacao: 'Pediram nossa ajuda', titulo: 'Bomba d’água 12V' },
                '2000000403': { atual: true, motivo: pad, afetouReputacao: true, situacao: aguarda, titulo: 'Bomba d’água 12V' } } };
        const g4 = grupo(vazia, pad, itens), r4 = await clique(vazia, pad), x4 = r4.copiado || '';
        ok(g4 && g4.contaAgora === 1 && /^Assunto: .* – SKU: BOMBA-12V – Pedido: #2000000403\n/.test(x4) && !/2000000401|2000000402/.test(x4),
            'botão: pedido sem a situação lida (401) e o da mediação em 1ª pessoa (402) ficam fora; o caso sem situação não conta');
        // Revisão 3: lista fechada do que é seguro. Qualquer outra situação (as do revisor, sem retrato real da tela) fica fora do pedido.
        const segura = SHC.situacaoSegura || (() => null);
        ok(['Aguardando sua resposta', 'Aguardando a devolução', 'Devolução em andamento', 'Reclamação encerrada', 'Reclamação resolvida', 'Reclamação fechada', 'Aguardando sua resposta até 10/10']
            .every(m => segura(m) === true), 'situações seguras da lista fechada entram ("Aguardando sua resposta", "Aguardando a devolução", "Devolução em andamento", reclamação encerrada/resolvida/fechada)');
        const naoSeguras = ['Vamos revisar o caso', 'O Mercado Livre está revisando o caso', 'Revisaremos o caso até 12/10', 'Em avaliação', 'Caso em avaliação pelo Mercado Livre', 'Aguardando a avaliação do Mercado Livre',
            'Esperando a resposta do Mercado Livre', 'Aguardando o Mercado Livre', 'Estamos verificando o caso', 'Vamos verificar o caso', 'O Mercado Livre vai resolver', 'Vamos resolver até 12/10', 'Resolveremos até 12/10',
            'O comprador acionou o Mercado Livre', 'Aguardando a análise', 'Analisando o caso', 'Revisando o caso', 'Mediação em andamento', 'Aguardando sua resposta. Pediram nossa ajuda', 'Reclamação encerrada com mediação', '', 'Situação desconhecida'];
        ok(naoSeguras.every(m => segura(m) === false), 'qualquer outra situação fica fora (as 17 do revisor, mediação, mistura com mediação, vazia, desconhecida)');
        const rev = { casos: [{ titulo: 'Bomba d’água 12V', motivo: pad, afetouReputacao: true, situacao: aguarda }],
            porPedido: { '2000000901': { atual: true, motivo: pad, afetouReputacao: true, situacao: 'O Mercado Livre está revisando o caso', titulo: 'Bomba d’água 12V' },
                '2000000902': { atual: true, motivo: pad, afetouReputacao: true, situacao: aguarda, titulo: 'Bomba d’água 12V' },
                '2000000903': { atual: true, motivo: pad, afetouReputacao: true, situacao: 'Em avaliação', titulo: 'Bomba d’água 12V' },
                '2000000904': { atual: true, motivo: pad, afetouReputacao: true, situacao: 'Devolução em andamento', titulo: 'Bomba d’água 12V' } } };
        const g9 = grupo(rev, pad, itens), r9 = await clique(rev, pad), x9 = r9.copiado || '';
        ok(g9 && JSON.stringify(g9.pedidos) === '["2000000902","2000000904"]' && /- Pedidos: #2000000902, #2000000904\./.test(x9) && !/2000000901|2000000903/.test(x9),
            'botão: "O Mercado Livre está revisando o caso" (901) e "Em avaliação" (903) ficam fora; só as situações seguras entram (antes: o 901 entrava)');
        const todasFora = { casos: [{ titulo: 'Bomba d’água 12V', motivo: pad, afetouReputacao: true, situacao: 'Vamos revisar o caso' }], porPedido: {} };
        ok(!grupo(todasFora, pad, itens) && !((await clique(todasFora, pad)).copiado), 'caso só com situação fora da lista: nenhum grupo, nada copiado');
        // Revisão 3: "Comprei, o vendedor separou errado" mostrava o botão e copiava "o comprador se arrependeu… perfeitas condições" com o SKU.
        const sep = 'Comprei, o vendedor separou errado';
        const vend = { casos: [{ titulo: 'Bomba d’água 12V', motivo: sep, afetouReputacao: true, situacao: aguarda }], porPedido: { '2000000951': { atual: true, motivo: sep, afetouReputacao: true, situacao: aguarda, titulo: 'Bomba d’água 12V' } } };
        const rv = await clique(vend, sep);
        ok(!SHC.motivoExcluivel(sep) && !SHC.confereExclusao(sep) && !grupo(vend, sep, itens) && !rv.copiado, 'botão: "Comprei, o vendedor separou errado" não tem regra, não mostra o botão nem copia nada');
    })();
    espera.then(() => pendentes.reduce((p, fn) => p.then(fn), Promise.resolve())).then(() => { console.log(f ? '\n' + f + ' FALHA(S)' : '\nTUDO OK'); process.exit(f ? 1 : 0); }, e => { console.error(e); process.exit(1); });
}
