// Copiloto 3.4.0 — termos de uso por canal (RASCUNHO para a dona e o jurídico aprovarem; ver docs/TERMOS-POR-CANAL-3.4.0.md).
// Só dados e funções puras, sem tocar na página nem no storage. Carregado pelo painel.html (quadro de aceite) e pelo fundo (etiqueta-registro.js:
// sem aceite da versão atual, o canal não registra script nenhum). Mudou o texto = suba VERSAO: quem aceitou a anterior terá de aceitar de novo.
(function (root) {
    'use strict';
    const T = root.CopilotoTermos = {};
    T.VERSAO = '3.4.0-rascunho-2';   // -2: a junção com o PR #11 (visitas, frete médio e a comissão do contrato da Magalu)
    const comum = (site, extra) => [
        ['O que o Copiloto lê', 'Só da lista de produtos de ' + site + ' que você abriu: da resposta que a própria tela já recebeu, o SKU, o nome, o preço, o preço de promoção e o estoque de cada produto'
            + (extra || '') + '. Não faz nenhuma chamada nova ao canal e não clica, não altera e não escreve nada na página.'],
        ['Para quê', 'Mostrar, ao lado do preço, a etiqueta com o preço, o custo, quanto sobra e a margem, usando o custo que você informou no Copiloto.'],
        ['O que fica guardado', 'Neste computador: o aceite destes termos (data e versão), o custo por SKU que você digitar (vale para todos os canais) e, por produto, o número de visitas'
            + ' e o frete médio de cada dia, por 15 dias, para mostrar se subiram ou caíram. Nada do comprador.'],
        ['Para onde vai', 'Para lugar nenhum: tudo fica neste computador, dentro do Chrome. Nada é enviado para fora.'],
        ['Para parar', 'Desligue o canal aqui. O Copiloto tira a leitura, apaga as visitas e o frete guardados, devolve a permissão do site ao Chrome e oferece apagar o aceite.'],
    ];
    T.TEXTOS = {
        shopee: { nome: 'Shopee', site: 'seller.shopee.com.br', itens: comum('seller.shopee.com.br', ' e o total de visualizações') },
        magalu: { nome: 'Magalu', site: 'seller.magalu.com', itens: comum('seller.magalu.com', ', o frete médio, as visitas de 7 dias e, do Financeiro, só os percentuais de comissão do seu contrato (nunca os dados do banco)').concat([
            ['Comissão', 'Se você digitar a % da Magalu em Ajustes, vale a sua. Sem ela, o Copiloto usa a comissão do seu contrato lida no Financeiro e marca a sobra com "≈" (estimativa: a Magalu ajusta a comissão em cada pedido).']]) },
    };
    T.aceito = (cfg, c) => { const t = cfg && cfg.termos && cfg.termos[c]; return !!(t && t.versao === T.VERSAO && t.em); };
    T.pedeNovo = (cfg, c) => { const t = cfg && cfg.termos && cfg.termos[c]; return !!(t && t.em && t.versao !== T.VERSAO); };   // aceitou antes, o texto mudou
    T.registro = (agora) => ({ versao: T.VERSAO, em: new Date(agora === undefined ? Date.now() : agora).toISOString() });
    if (typeof module === 'object' && module.exports) module.exports = T;
})(typeof globalThis !== 'undefined' ? globalThis : this);
