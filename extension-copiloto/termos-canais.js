// Copiloto 3.4.0 — termos de uso por canal (RASCUNHO para a dona e o jurídico aprovarem; ver docs/TERMOS-POR-CANAL-3.4.0.md).
// Só dados e funções puras, sem tocar na página nem no storage. Carregado pelo painel.html (quadro de aceite) e pelo fundo (etiqueta-registro.js:
// sem aceite da versão atual, o canal não registra script nenhum). Mudou o texto = suba VERSAO: quem aceitou a anterior terá de aceitar de novo.
(function (root) {
    'use strict';
    const T = root.CopilotoTermos = {};
    T.VERSAO = '3.4.0-rascunho';
    const comum = site => [
        ['O que o Copiloto lê', 'Só o preço e o SKU de cada produto que a lista de produtos de ' + site + ' já mostra na tela que você abriu. Não faz nenhuma chamada nova ao canal e não clica, não altera e não escreve nada na página.'],
        ['Para quê', 'Desenhar, ao lado do preço, a etiqueta "Sobra R$ X · margem Y%" usando o custo que você já informou no Copiloto.'],
        ['O que fica guardado', 'O aceite destes termos (data e versão) e o custo por SKU que você digitar, que vale para todos os canais. Nada do canal é copiado nem guardado além disso.'],
        ['Para onde vai', 'Para lugar nenhum: tudo fica neste computador, dentro do Chrome. Nada é enviado para fora.'],
        ['Para parar', 'Desligue o canal aqui. O Copiloto tira a leitura, devolve a permissão do site ao Chrome e oferece apagar os dados deste canal.'],
    ];
    T.TEXTOS = {
        shopee: { nome: 'Shopee', site: 'seller.shopee.com.br', itens: comum('seller.shopee.com.br') },
        magalu: { nome: 'Magalu', site: 'seller.magalu.com', itens: comum('seller.magalu.com').concat([['Comissão', 'A comissão da Magalu é a porcentagem que você mesmo informa em Ajustes; o Copiloto não a lê da Magalu.']]) },
    };
    T.aceito = (cfg, c) => { const t = cfg && cfg.termos && cfg.termos[c]; return !!(t && t.versao === T.VERSAO && t.em); };
    T.pedeNovo = (cfg, c) => { const t = cfg && cfg.termos && cfg.termos[c]; return !!(t && t.em && t.versao !== T.VERSAO); };   // aceitou antes, o texto mudou
    T.registro = (agora) => ({ versao: T.VERSAO, em: new Date(agora === undefined ? Date.now() : agora).toISOString() });
    if (typeof module === 'object' && module.exports) module.exports = T;
})(typeof globalThis !== 'undefined' ? globalThis : this);
