// v3.3 Textos de contestação (pedido da dona 07/10/2026, com o modelo dela): assunto com SKU e pedido, "Prezada equipe de suporte", os
// números do painel, a regra do ML (título + link da Central) e o pedido explícito (revisão da cubagem, correção para envios futuros e estorno).
// E a trava: o pedido de exclusão só sai para os casos que as regras de exclusão do ML aceitam (nunca o que é responsabilidade do vendedor).
// Revisão 07/10/2026: culpa do vendedor no motivo VETA a exclusão (mesmo com "me arrependi"/"engano" junto), e o caso incerto (🟡, valor
// esperado estimado) pede a CONFERÊNCIA e o estorno só se confirmar — nunca afirma cobrança indevida.
// Junção com a nossa 3.3.0 (07/10): regras da dona por cima do modelo da nuvem. Trava do frete (06/10, "o ML está negando os chamados de
// frete"): nenhum texto de chamado nem de contestação de FRETE (P.textoChamado, F.chamadoFrete e F.textoChamado do frete dão ''; o frete
// fica "para conferir" até a 3.3.1). Chamado só com prova: o esperado ESTIMADO (preço de hoje, mediana, "pode estar certo") também dá ''.
// Rodar: node tests/copiloto/teste_contestacao_v33.js
'use strict';
require('./relogio').fixar();
const path = require('path');
global.chrome = { storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } }, runtime: { sendMessage: async () => ({}) } };
const EXT = path.join(__dirname, '../../extension-copiloto');
const SHC = require(path.join(EXT, 'calc.js'));
['store.js', 'ml-extrator.js', 'fechamento.js', 'painel-lateral.js'].forEach(a => require(path.join(EXT, a)));
let f = 0;
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

console.log('Frete do anúncio (P.textoChamado): trava do frete');
{
    const P = SHC.pl;
    const item = { itemId: 'MLB8000000001', sku: 'HA-14253', frete: 58.75 };
    // fh|ml|MLB: o frete do anúncio por dia (45,35 até 19/09; 58,75 desde 20/09). Pedidos (vd|ml): frete cobrado por pedido.
    const h = P.historicoFrete({ '2026-09-01': 45.35, '2026-09-19': 45.35, '2026-09-20': 58.75, '2026-10-01': 58.75 });
    const vendas = { '3000000001': { d: '2026-09-22', f: 58.75 }, '3000000002': { d: '2026-09-25', f: 58.75 } };
    // A nuvem tinha passado este texto ao formato de contestação (com e sem a caixa das medidas). Vale a trava (06/10, achado H1 da auditoria
    // de 05/10: o frete também muda pela faixa de preço): sem texto, e o cartão #frChamado do detalhe do anúncio não aparece.
    ok(P.textoChamado(item, h, vendas, true, '30×20×15 cm, 9,2 kg') === '' && P.textoChamado(item, h, vendas, false, '') === '',
        'trava do frete (06/10, H1): sem texto de chamado do frete do anúncio, com ou sem a caixa das medidas');
}

console.log('Cobrança do Fechamento (SHC.fech.textoChamado)');
{
    // Trava do frete: a cobrança de frete (regra 'frete') não tem texto, nem de contestação nem de dúvida (antes da junção: contestação com ajuda/40538).
    const fr = { pedido: '2000000123', data: '2026-09-20', itemId: 'MLB8000000002', titulo: 'Bomba d’água', cobranca: 'Tarifa de envio', valor: 58.75, esperado: 45.35, diferenca: 13.4, motivo: 'acima do frete do anúncio', regra: 'frete' };
    ok(SHC.fech.textoChamado(fr) === '' && SHC.fech.textoChamado(Object.assign({}, fr, { duvida: 'pode ser 2 unidades' })) === '' && SHC.fech.freteSemChamado(fr),
        'trava do frete: cobrança de frete sem texto (nem contestação nem dúvida); fica "para conferir"');
    // Com prova (o detalhe da venda do ML, F.provaTarifa): o modelo da nuvem, cobrado × devido × diferença e o estorno.
    const x = SHC.fech.provaTarifa({ pedido: '2000000123', data: '2026-09-20', itemId: 'MLB8000000002', titulo: 'Bomba d’água', cobrado: 30, cob: { venda: 30 } }, { preco: 150, tarifa: 20, tarifaPct: 13.33 });
    const t = SHC.fech.textoChamado(x);
    ok(/^Assunto: Contestação de cobrança indevida: Tarifa de venda \(Custo por vender\) – Pedido: #2000000123 – Anúncio: MLB8000000002/.test(t), 'assunto com o tipo da cobrança, pedido e anúncio');
    ok(/- Valor cobrado: R\$ 30,00\n- Valor devido: R\$ 20,00\n- Diferença: R\$ 10,00/.test(t) && /No detalhe desta venda o Mercado Livre mostra tarifa de R\$ 20,00/.test(t), 'valor cobrado × devido × diferença, com a prova do detalhe da venda');
    ok(/Solicitamos a revisão desta cobrança e o estorno da diferença de R\$ 10,00 na nossa conta\./.test(t), 'pede o estorno da diferença');
    const d = SHC.fech.textoChamado({ pedido: '2000000125', data: '2026-09-20', itemId: 'MLB8000000002', cobranca: 'Tarifa de venda', valor: 30, esperado: 20, diferenca: 10, regra: 'repetida', duvida: 'pode ser 1 cobrança por pagamento' });
    ok(/^Olá! Tenho uma dúvida/.test(d) && !/estorno/.test(d) && !/Diferença/.test(d), 'na dúvida continua só perguntando (nunca afirma erro nem pede estorno)');
}

console.log('Devolução, medidas, Full');
{
    const dv = SHC.chamadoDevolucao({ pedido: '2000000555', data: '2026-09-10', valor: 23.9, recuperar: 23.9, porque: 'No pós-venda, o Mercado Livre informou que a devolução não foi de minha responsabilidade.' });
    ok(/Contestação de tarifa de devolução – Pedido: #2000000555/.test(dv) && /devolucoes_3285/.test(dv) && /estorno de R\$ 23,90/.test(dv), 'devolução: pedido, regra da devolução e o estorno');
    const md = SHC.medidasChamado({ itemId: 'MLB8000000003', sku: 'HA-14253', antes: { ordenadas: [9, 7, 39], pesoKg: 1.76 }, depois: { ordenadas: [20, 15, 45], pesoKg: 3.2 },
        em: Date.parse('2026-09-18T12:00:00Z'), vistoAte: Date.parse('2026-09-11T12:00:00Z'), correta: { ordenadas: [9, 7, 39], pesoKg: 1.76 }, corretaDe: 'erp' });
    ok(/Contestação de cubagem alterada no anúncio – SKU: HA-14253 – Anúncio: MLB8000000003/.test(md) && /revisão da cubagem do anúncio, a correção das medidas para/.test(md)
        && /especificações técnicas do fabricante/.test(md), 'medidas: cubagem, correção para os envios futuros e as especificações do fabricante em anexo');
    const desce = SHC.medidasChamado({ itemId: 'MLB8000000003', sku: 'HA-14253', antes: { ordenadas: [15, 20, 45], pesoKg: 3.2 }, depois: { ordenadas: [7, 9, 39], pesoKg: 1.76 },
        em: Date.parse('2026-09-18T12:00:00Z'), vistoAte: Date.parse('2026-09-11T12:00:00Z'), correta: null, corretaDe: '' });
    ok(/^Assunto: Pedido de correção da cubagem do anúncio/.test(desce) && !/aumenta/.test(desce) && !/estorno/.test(desce) && /Peso considerado no frete/.test(desce),
        'medida que DIMINUIU: só a correção do cadastro, sem "aumenta" e sem estorno');
    const rem = SHC.chamadoRemessa({ id: '61234567', quando: '2026-09-28', custo: 27, prazo: '2026-10-12', declaradas: 100, aptas: 94,
        produtos: [{ itemId: 'MLB8000000004', sku: 'HA-14253', declaradas: 50, processadas: 44, diferencas: -6, naoAptas: 0, resultado: 'faltando' }, { itemId: 'MLB8000000005', sku: 'B2', declaradas: 50, processadas: 50, diferencas: 0 }] });
    ok(/Reclamação por diferenças na remessa do Full – Remessa: #61234567/.test(rem) && /SKU HA-14253 \(MLB8000000004\): declaradas 50, processadas 44/.test(rem) && !/SKU B2/.test(rem),
        'Full: só os produtos com diferença, declaradas × processadas');
    ok(/Total cobrado pelo Mercado Livre nesta remessa \(coleta e\/ou penalidade\): R\$ 27,00/.test(rem) && !/multa|por esta inconformidade/.test(rem) && /Prazo para reclamar informado pelo ML: 12\/10\/2026/.test(rem)
        && /se a diferença se confirmar, o estorno do que foi cobrado por ela/.test(rem) && !/cancelamento da cobrança de R\$ 27/.test(rem),
        'Full: o total cobrado na remessa (coleta e/ou penalidade, nunca "multa"), o prazo e o estorno só do que a diferença causou');
    // Auditoria da loja: só unidade não apta (sem diferença de contagem) não é erro de contagem — pede o motivo de cada uma.
    const na = SHC.chamadoRemessa({ id: '61234568', quando: '2026-09-28', custo: 27, declaradas: 50, aptas: 47,
        produtos: [{ itemId: 'MLB8000000004', sku: 'HA-14253', declaradas: 50, processadas: 50, diferencas: 0, naoAptas: 3, resultado: 'sem etiqueta' }] });
    ok(/^Assunto: Pedido de revisão de unidades não aptas na remessa do Full/.test(na) && /3 unidades foram consideradas não aptas/.test(na) && !/recontagem/.test(na)
        && /se a inaptidão não decorreu do nosso preparo/.test(na), 'Full só com unidades não aptas: pede o motivo de cada uma, sem afirmar erro de contagem');
}

console.log('Frete casado pela data (auditoria da loja): o par ambíguo vai para "para conferir"');
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
    // Trava do frete (06/10): nem o par único vira chamado (a nuvem tinha a parcela "frete" com o texto citando o número do frete). Ele fica
    // no "para conferir" com o número do frete, para o "Conferir no ML" abrir a cobrança certa.
    const r1 = SHC.fech.recuperar({ conc: um }), q1 = r1.freteConferir.itens[0];
    ok(um.pagoAMais.length === 1 && !um.pagoAMais[0].talvezUnidades && !r1.parcelas.find(x => x.id === 'frete') && q1 && q1.pedido === '2000000019' && q1.pedidoFrete === '9100000003'
        && SHC.fech.chamadoFrete(q1, 'Bomba') === '', 'par único (1 venda e 1 frete do anúncio no período): trava do frete, sem chamado; fica "para conferir" com o número do frete');
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
    ok(SHC.confereExclusao('Atraso na entrega') === 'você despachou dentro do prazo' && SHC.confereExclusao('Me arrependi da compra') === 'o produto voltou sem uso e em perfeitas condições'
        && SHC.confereExclusao('Produto com defeito') === '', 'cada regra diz o que o seller confere antes de enviar (nada quando não é excluível)');
    ok(!/respondidas|resolvidas/.test(ex), 'o pedido de exclusão não afirma o que o Copiloto não sabe ("já respondidas/resolvidas")');
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
    // Regra da dona (chamado só com prova; a tarifa só pelo detalhe da venda, F.provaTarifa, nunca pelo preço de hoje): o esperado estimado
    // não vira texto, nem como "Pedido de revisão" (a nuvem tinha). Fica "para conferir".
    const ta = SHC.fech.textoChamado(Object.assign({ estimado: 'Pelo preço atual do anúncio (R$ 150,00), a tarifa de venda seria de R$ 20,00 por unidade.' }, base));
    ok(ta === '' && SHC.fech.textoChamado(base) === '', 'tarifa estimada pelo preço de hoje e item guardado por versão anterior ("pode estar certo"): sem texto de chamado (só com prova)');
    // 2ª revisão: o item do "quanto dá para recuperar" tem valor = a diferença; o texto copiado usa o valor COBRADO (item provado: cobrança repetida).
    const rec = { pedido: '2000000123', data: '2026-09-20', itemId: 'MLB8000000002', cobranca: 'Tarifa de venda', regra: 'repetida', valor: 10, cobrado: 30, esperado: 20, diferenca: 10,
        motivo: 'A mesma tarifa foi cobrada 2 vezes no pedido.' };
    ok(/- Valor cobrado: R\$ 30,00\n- Valor devido: R\$ 20,00\n- Diferença: R\$ 10,00/.test(SHC.fech.textoChamado(SHC.fech.itemDoChamado(rec))),
        'texto copiado do "Como pedir de volta": cobrado R$ 30 × devido R$ 20 (antes saía "cobrado R$ 10")');
    const fr = SHC.fech.chamadoFrete({ pedido: '2000000124', data: '2026-09-21', itemId: 'MLB8000000002', cobrado: 58.75, esperado: 45.35, valor: 13.4 }, 'Bomba');
    ok(fr === '', 'trava do frete (06/10): F.chamadoFrete não gera texto de contestação do frete de envio (fica "para conferir")');
}

console.log(f ? '\n' + f + ' FALHA(S)' : '\nTUDO OK');
process.exit(f ? 1 : 0);
