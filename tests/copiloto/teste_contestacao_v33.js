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
        em: Date.parse('2026-09-18T12:00:00Z'), vistoAte: Date.parse('2026-09-11T12:00:00Z'), correta: { ordenadas: [9, 7, 39], pesoKg: 1.76 }, corretaDe: 'erp' });
    ok(/Contestação de cubagem alterada no anúncio – SKU: HA-14253 – Anúncio: MLB8000000003/.test(md) && /revisão da cubagem do anúncio, a correção das medidas para/.test(md)
        && /especificações técnicas do fabricante/.test(md), 'medidas: cubagem, correção para os envios futuros e as especificações do fabricante em anexo');
    const rem = SHC.chamadoRemessa({ id: '61234567', quando: '2026-09-28', custo: 27, prazo: '2026-10-12', declaradas: 100, aptas: 94,
        produtos: [{ itemId: 'MLB8000000004', sku: 'HA-14253', declaradas: 50, processadas: 44, diferencas: -6, naoAptas: 0, resultado: 'faltando' }, { itemId: 'MLB8000000005', sku: 'B2', declaradas: 50, processadas: 50, diferencas: 0 }] });
    ok(/Reclamação por diferenças na remessa do Full – Remessa: #61234567/.test(rem) && /SKU HA-14253 \(MLB8000000004\): declaradas 50, processadas 44/.test(rem) && !/SKU B2/.test(rem),
        'Full: só os produtos com diferença, declaradas × processadas');
    ok(/cobrado pelo Mercado Livre por esta inconformidade: R\$ 27,00/.test(rem) && /Prazo para reclamar informado pelo ML: 12\/10\/2026/.test(rem) && /cancelamento da cobrança de R\$ 27,00/.test(rem),
        'Full: o que o ML cobrou, o prazo e o pedido de cancelamento da cobrança');
}

console.log('Exclusão de reclamação e experiência de compra: só o que as regras do ML aceitam');
{
    const sim = ['Me arrependi da compra', 'Comprei por engano', 'Não reconheço esta compra', 'Diz que não recebeu mas consta como entregue', 'Demora dos Correios', 'Quero trocar de tamanho'];
    const nao = ['Produto com defeito', 'Chegou diferente do anunciado', 'Faltam peças', 'O vendedor não despachou', 'Sem estoque', 'Produto falsificado'];
    ok(sim.every(m => SHC.motivoExcluivel(m)), 'excluíveis: arrependimento, engano, não reconhece, consta entregue, demora do transporte, troca de tamanho');
    ok(nao.every(m => !SHC.motivoExcluivel(m)), 'NÃO excluíveis: defeito, diferente do anunciado, faltando, não despachou, sem estoque, falsificado');
    const ex = SHC.chamadoExclusao({ motivo: 'Me arrependi da compra', casos: 3, naReputacao: 2, produtos: ['Bomba d’água 12V'] });
    ok(/Pedido de exclusão de reclamações da reputação/.test(ex) && /regras-de-exclusao-de-reclamacoes/.test(ex) && /arrependeu da compra e o produto está em perfeitas condições/.test(ex)
        && /\(3 casos, 2 contando na reputação\)/.test(ex), 'pedido de exclusão com a regra em que se enquadra e os números');
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
    const base = { pedido: '2000000123', data: '2026-09-20', itemId: 'MLB8000000002', cobranca: 'Tarifa de venda', regra: 'tarifa', valor: 30, esperado: 20, diferenca: 10,
        motivo: 'No preço de hoje (R$ 150,00), este anúncio paga R$ 20,00 de tarifa por unidade. Se o preço da venda foi outro, pode estar certo.' };
    const ta = SHC.fech.textoChamado(Object.assign({ estimado: 'Pelo preço atual do anúncio (R$ 150,00), a tarifa de venda seria de R$ 20,00 por unidade.' }, base));
    ok(/^Assunto: Pedido de revisão de cobrança: Tarifa de venda – Pedido: #2000000123/.test(ta) && /Valor esperado \(estimativa nossa\): R\$ 20,00/.test(ta)
        && /Como estimamos: Pelo preço atual do anúncio \(R\$ 150,00\)/.test(ta) && /se a diferença se confirmar, o estorno de R\$ 10,00/.test(ta) && !/indevida|Valor devido/.test(ta),
        'tarifa estimada pelo preço de hoje: revisão com a base da estimativa, estorno só se confirmar');
    ok(/^Assunto: Pedido de revisão de cobrança/.test(SHC.fech.textoChamado(base)), 'item guardado por versão anterior (sem .estimado, "pode estar certo"): também revisão');
    const fr = SHC.fech.chamadoFrete({ pedido: '2000000124', data: '2026-09-21', itemId: 'MLB8000000002', cobrado: 58.75, esperado: 45.35, valor: 13.4 }, 'Bomba');
    ok(/^Assunto: Contestação de cobrança indevida: Frete de envio da venda/.test(fr) && /ajuda\/40538/.test(fr), 'frete acima do custo que o anúncio mostra: contestação firme, com a regra do frete do ML');
}

console.log(f ? '\n' + f + ' FALHA(S)' : '\nTUDO OK');
process.exit(f ? 1 : 0);
