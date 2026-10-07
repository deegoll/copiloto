# Mapa do C1 (correções "cada centavo") para a 3.3.1

Ramo `nuvem/correcoes-centavos`, a partir do `643db14` (que é o `copiloto-v3.3.0` de 07/10 mais os 6 arquivos `teste_centavos_*.js`). São 39 divergências entre o que a tela mostra e a conta, todas confirmadas por script de reprodução e corrigidas. Cada correção tem um teste que falha no código antigo e passa no novo, com dados inventados. Cada grupo passou por revisão adversarial (2 ou 3 rodadas).

**Como usar (pedido da local, 07/10):** a 3.3.1 parte deste ramo, juntado à 3.3.0 enviada. Antes de mexer numa função nos ramos `c331/*`, procure-a na tabela "Por função" e trabalhe por cima do commit indicado, sem refazer.

**O que muda em todo número:** o `SHC.r2` (e o `r2` do núcleo) passou a arredondar o meio centavo para longe do zero, igual nos dois sinais (2,135 → 2,14; −1,285 → −1,29), e o `SHC.moeda` usa o mesmo arredondamento. Valor da suíte com dados reais que mudar 1 centavo por isso é esperado. Confira esses valores contra a fatura antes de aceitar.

**Grupos:** a = arredondamento e lucro do anúncio (#4, #9–#15, #36); b = Fechamento e frete (#1–#3, #5–#8); c = Full (#16–#21); d = Ads (#22–#28); e = TikTok e núcleo (#29–#35, #37–#39).

## Por commit

| Commit | O que mudou | Funções |
|---|---|---|
| `ff505f9` | centavos: r2 arredonda o meio centavo para longe do zero nos dois sinais (#4, #13, #36) | `r2 (núcleo/util.js)`, `r2 (calc.js)`, `SHC.moeda (calc.js)` |
| `859cab5` | centavos: SHC.calcular classifica pela sobra e pela margem sem arredondar (#9) | `SHC.calcular (calc.js)` |
| `b85dcab` | centavos: custo, outros e frete entram e são gravados em centavos (#11) | `tarifaSpTabela (calc.js)`, `freteSeller (calc.js)`, `SHC.calcular (calc.js)`, `SHC.precoMinimo (calc.js)`, `SHC.sobraProposta (ml-extrator.js)`, `SHC.sobraAnuncio (ml-extrator.js)`, `SHC.sobraAtacado (ml-extrator.js)`, `salvaCusto (ml-tela.js)`, `SHC.kitDe (store.js)`, `SHC.salvarCustoSku (store.js)`, `ignora (store.js)` |
| `6bdd400` | centavos: preço mínimo é o menor preço em centavos que bate a meta (#10, #12) | `freteAcima (calc.js)`, `ok (calc.js)`, `SHC.sobraProposta (ml-extrator.js)`, `SHC.recomendaPromo (ml-extrator.js)`, `bate (ml-extrator.js)` |
| `4b85c2e` | centavos: frete grátis sem valor deixa a sobra como teto, não R$ 0,00 firme (#14) | `freteSeller (calc.js)`, `SHC.calcular (calc.js)`, `SHC.precoMinimo (calc.js)`, `ok (calc.js)`, `calcula (popup.js)` |
| `9362e69` | centavos: "✓ Kit salvo" mostra o mesmo total da tabela de kits (#15) | `P.msgKitSalvo (painel.js)`, `desenhaKits (painel.js)` |
| `e61c2a1` | centavos: pela fatura, "bate" só com diferença menor que meio centavo (#3) | `F.conferirFatura (fechamento.js)`, `cop (fechamento.js)` |
| `1b91a74` | centavos: pela fatura, o motivo do total ✗ cita a sobra a partir de R$ 0,01 (#6) | `F.motivoTotal (fechamento.js)` |
| `ea057d4` | centavos: 2 regras na mesma cobrança contam 1 vez só, nunca acima do cobrado (#1) | `umaVezPorCobranca (fechamento.js)`, `doFrete (fechamento.js)`, `F.conferir (fechamento.js)`, `base (fechamento.js)` |
| `c36c193` | centavos: coleta da remessa do Full sai do "Dá para recuperar" e vira "para conferir" sem valor (#2) | `umaVezPorCobranca (fechamento.js)`, `doFrete (fechamento.js)`, `dvIt (fechamento.js)`, `blocoFull (fechamento.js)`, `item (fechamento.js)` |
| `2b35d53` | centavos: estorno de frete lido depois da tarifa baixa também o cheio (#8) | `gravarFreteHist (fundo/03-faturamento.js)` |
| `6e34646` | centavos: estorno de frete lido junto com a tarifa não desconta de novo na releitura (#8, bug vizinho) | `gravarFreteHist (fundo/03-faturamento.js)` |
| `fb66f5d` | centavos: "Frete cobrado a mais (confirmado)" usa o total e a contagem de antes do corte de 200 (#5, #7) | `umaVezPorCobranca (fechamento.js)`, `F.recuperar (fechamento.js)`, `doFrete (fechamento.js)`, `resto (fechamento.js)` |
| `d997dbf` | centavos: custo de anúncio sem SKU também é gravado em centavos (#11) | `SHC.salvarCusto (store.js)` |
| `c2e22a8` | centavos: o custo digitado no painel lateral (anúncio sem SKU e família) também é gravado em centavos (#11) | `P.gravarCusto (painel-lateral.js)`, `salvarCustoFamilia (painel-lateral.js)`, `salvarCustoGrupo (painel-lateral.js)` |
| `aa01d29` | centavos: repetida cortada pelo estorno não inventa o "valor devido" e não ganha da venda cancelada (#1, revisão) | `F.setaCusto (fechamento.js)`, `umaVezPorCobranca (fechamento.js)`, `doFrete (fechamento.js)` |
| `697fff6` | centavos: cobrança em dobro absorvida pela estimativa vai para o texto do chamado (#1, revisão) | `umaVezPorCobranca (fechamento.js)`, `F.textoChamado (fechamento.js)` |
| `ff34bde` | centavos: gasto em remessas do mês com uma definição só no cartão, nas linhas e na sincronização (#16) | `problemasTxt (ml-extrator.js)`, `SHC.remessasResumo (ml-extrator.js)` |
| `991c359` | centavos: custo por unidade do mês só com as remessas que têm unidades (#18) | `problemasTxt (ml-extrator.js)`, `SHC.remessasResumo (ml-extrator.js)` |
| `ed52cea` | centavos: simulador da próxima remessa só com remessas recebidas no custo da coleta (#17) | `SHC.simulaRemessa (ml-extrator.js)` |
| `07638f4` | centavos: dias até acabar = ⌊aptas × 30 ÷ previsão⌋, sem perder 1 dia na conta exata (#20) | `idsDe (ml-extrator.js)`, `v (painel-lateral.js)`, `P.saudeFull (painel-lateral.js)`, `chave (painel-lateral.js)` |
| `5f47e31` | centavos: ícone e sino do Full com a mesma previsão sazonal do painel (#19) | `SHC.vmDaParte (ml-extrator.js)`, `SHC.alertasDe (ml-extrator.js)`, `vmDe (ml-extrator.js)`, `P.previsaoFull (painel-lateral.js)`, `chave (painel-lateral.js)` |
| `1ad1299` | centavos: explicação sazonal mostra a conta que fecha, "7 × 1,33 = 9,31 → 10" (#21) | `mesMenos (ml-extrator.js)`, `doMes (ml-extrator.js)`, `vg (painel-lateral.js)` |
| `cf91fff` | centavos: simulador diz "nenhuma remessa recebida com cobrança" quando só há vencida ou cancelada (#17) | `SHC.simulaRemessa (ml-extrator.js)` |
| `10bdc8f` | centavos: simulador diz "a média das suas últimas N remessas recebidas", a base que a conta usou (#17) | `SHC.medidasParaSimular (ml-extrator.js)`, `SHC.simulaRemessa (ml-extrator.js)`, `fmt3 (painel-lateral.js)` |
| `53cd000` | centavos: recomendação por SKU com cobertura = ⌊estoque × dias ÷ vendas⌋, sem perder 1 dia no limite de 15 (#20) | `SHC.recomendaSku (ml-extrator.js)` |
| `494ea15` | centavos: ícone e painel com os mesmos anúncios do produto do Full, também os ligados pelo SKU (#19) | `atualizarAlertas (fundo/07-alertas-promocoes-full.js)`, `SHC.idsDoProdutoFull (ml-extrator.js)`, `SHC.alertasDe (ml-extrator.js)`, `P.anunciosDoFull (painel-lateral.js)`, `idsDoPlano (painel-lateral.js)` |
| `da1b803` | centavos: KPI em R$ inteiro arredonda o meio real para longe do zero e o rodapé do lucro fecha em centavos (#22) | `rs0 (ads.js)`, `cel (ads.js)` |
| `b74fa60` | centavos: selo "Acima do equilíbrio" pelo lucro depois do Ads em centavos, não por ACOS > margem em ponto flutuante (#23) | `A.porSku (ads.js)` |
| `245eed7` | centavos: TACOS e vendas orgânicas ficam "—" quando o ML não manda as orgânicas (#24) | `A.metricas (ads.js)`, `A.soma (ads.js)` |
| `1f42ed4` | centavos: ACOS e ROAS arredondados uma vez só, no texto, iguais em todas as telas (#25) | `lista (ads.js)`, `A.metricas (ads.js)`, `A.xTxt (ads.js)`, `dia10 (ml-extrator.js)`, `ou (ml-extrator.js)`, `ativoTxt (painel-lateral.js)` |
| `b65f6f2` | centavos: uma conta só do lucro depois do Ads do anúncio em ads.html e no painel (SHC.adsLucro) (#26) | `A.porSku (ads.js)`, `A.estado (ads.js)`, `A.montante (ads.js)`, `SHC.adsLucro (ml-extrator.js)`, `P.adsFatoCatalogo (painel-lateral.js)`, `P.adsEquilibrio (painel-lateral.js)` |
| `831d719` | centavos: sem o resumo do ML, o painel soma as campanhas (como ads.html) e a linha Total é a soma das linhas (#27) | `P.adsVeredito (painel-lateral.js)`, `um (painel-lateral.js)`, `s (painel-lateral.js)`, `linhaCamp (painel-lateral.js)` |
| `0e236c3` | centavos: Product Ads líquido negativo no mês é estorno, mostrado com o sinal −, nunca como gasto (#28) | `noFat (ads.js)`, `P.adsEquilibrio (painel-lateral.js)`, `v (painel-lateral.js)`, `cardAdsSku (painel-lateral.js)` |
| `3b4b31c` | centavos: cabeçalho do teste de Ads aponta a parte J com os casos das divergências corrigidas (#22–#28) | teste_centavos_ads.js |
| `6ffee5f` | centavos: o aviso do Ads no ícone e no sino usa a mesma conta do cartão Alertas e de ads.html (SHC.adsLucro) (#26) | `vmDe (ml-extrator.js)` |
| `86ff3b8` | centavos: recomendação por SKU em décimos de dia inteiros, dias com 1 casa sem perder 1 dia (#20, revisão 2) | `SHC.recomendaSku (ml-extrator.js)` |
| `e37e296` | centavos: simulador diz "a sua última remessa recebida com cobrança", a base que a conta usou (#17, revisão 2) | `SHC.simulaRemessa (ml-extrator.js)` |
| `c73b6aa` | Full: o motivo da recomendação por SKU começa com maiúscula também sem a tendência do mês anterior | `SHC.recomendaSku (ml-extrator.js)` |
| `cfabfe3` | centavos: rateioAds pelo maior resto, nenhum pedido com Ads negativo (#29 #31) | `reparte (núcleo/motor.js)`, `noDia (núcleo/motor.js)`, `fechamentoMes (núcleo/motor.js)` |
| `a10d5a6` | centavos: lucro por item e por produto somam o lucro do pedido (#32) | `lucroPedido (núcleo/motor.js)` |
| `23d14ad` | centavos: detalhe do pedido TikTok com vários SKUs fecha com o preço de origem (#30) | `pedidoDoDetalhe (núcleo/adaptadores/tiktok.js)` |
| `e0facc1` | centavos: Ads tirado do repasse (GMV Pay) entra no repasse e na conta da aba (#33) | `lucroPedido (núcleo/motor.js)`, `lucroPorProduto (núcleo/motor.js)`, `contaHtml (tiktok-aba.js)`, `TT.porProduto (tiktok.js)` |
| `cd54f46` | centavos: valor vazio ou ilegível no extrato do TikTok não vira 0 nem "exato" (#34) | `O (núcleo/adaptadores/tiktok.js)`, `dinheiro (núcleo/adaptadores/tiktok.js)`, `transacaoDoExtrato (núcleo/adaptadores/tiktok.js)`, `lido (núcleo/adaptadores/tiktok.js)`, `contaHtml (tiktok-aba.js)`, `tarifasEstimadas (tiktok.js)`, `fecha (tiktok.js)`, `TT.lucroDoPedido (tiktok.js)` |
| `79e718f` | centavos: KPI "Lucro 30 dias" do TikTok conta o cancelado, como Produtos (#35) | `TT.resumo (tiktok.js)` |
| `4bbd95a` | centavos: sem pedido do Financeiro lido, a aba não mostra "Recebido R$ 0,00" (#37) | `dedupe (núcleo/conciliacao.js)`, `tot (núcleo/conciliacao.js)` |
| `64ab86b` | centavos: "Est." lido só no detalhe do extrato entra no "Previsto" do TikTok (#38) | `TT.lucroDoPedido (tiktok.js)` |
| `73994e7` | centavos: o que está "a liberar" não entra na diferença do esperado (#39) | `dedupe (núcleo/conciliacao.js)`, `conciliar (núcleo/conciliacao.js)`, `tot (núcleo/conciliacao.js)`, `junta (tiktok.js)` |
| `f660a7d` | centavos: extrato ilegível com o preço do detalhe também ilegível mostra "—" (#34) | `TT.lucroDoPedido (tiktok.js)` |
| `47d21df` | centavos: pedido visto só em Pedidos com o preço não lido fica "não lido", Preço "—" (#34) | `TT.lucroDoPedido (tiktok.js)` |
| `aa62bb3` | centavos: extrato ilegível sem o bloco de receita mostra Preço "—", não R$ 0,00 (#34) | `TT.lucroDoPedido (tiktok.js)` |
| `444552e` | centavos: a repetida decide firme pela própria cobrança, não pelo tipo inteiro do pedido (#1, revisão 2) | `F.setaCusto (fechamento.js)`, `umaVezPorCobranca (fechamento.js)`, `F.conferir (fechamento.js)`, `tituloDe (fechamento.js)`, `base (fechamento.js)` |
| `9583f05` | centavos: a Conciliação volta a mostrar a remessa do Full pendente, "para conferir" e sem R$ (#2, revisão 2) | `concTopo (painel-lateral.js)`, `it (painel-lateral.js)`, `itFull (painel-lateral.js)` |
| `88fbf11` | centavos: estorno de nome e código sem tipo também tira a repetida do firme (#1, revisão 2) | `tituloDe (fechamento.js)`, `base (fechamento.js)` |
| `035d470` | centavos: cancelado sem tarifa lida fica fora do KPI e de Produtos, sem tarifa estimada (#35, revisão 2) | `aliquota (núcleo/motor.js)`, `lucroPedido (núcleo/motor.js)`, `sobraTxt (tiktok-aba.js)`, `contaHtml (tiktok-aba.js)`, `linhaProduto (tiktok-aba.js)`, `TT.lucroDoPedido (tiktok.js)`, `TT.resumo (tiktok.js)` |
| `bc3be46` | centavos: extrato ilegível do TikTok não perde o reembolso lido; reembolso não lido deixa o imposto "—" (#34, revisão 2) | `contaHtml (tiktok-aba.js)`, `TT.lucroDoPedido (tiktok.js)` |
| `7448619` | centavos: README do núcleo diz que o Ads com origem_pagamento 'venda' sai do repasse (#33, revisão 2) | teste_centavos_nucleo.js |
| `85bee3f` | centavos: extrato ilegível mostra o reembolso legível mesmo com outra linha da receita vazia (#34, revisão 2) | `TT.lucroDoPedido (tiktok.js)` |
| `f25fa9c` | centavos: o anúncio em várias campanhas tem um lucro só, com as campanhas somadas, no painel, no ícone e em ads.html (#26, revisão 2) | `A.porSku (ads.js)`, `A.estado (ads.js)`, `A.montante (ads.js)`, `ou (ml-extrator.js)`, `SHC.adsLucro (ml-extrator.js)`, `SHC.idsDoProdutoFull (ml-extrator.js)`, `vmDe (ml-extrator.js)`, `P.adsFatoCatalogo (painel-lateral.js)`, `P.adsEquilibrio (painel-lateral.js)`, `P.adsLinhas (painel-lateral.js)`, `orcDia (painel-lateral.js)`, `P.adsVereditoDe (painel-lateral.js)`, `pega (painel-lateral.js)`, `s (painel-lateral.js)`, `P.adsFiltros (painel-lateral.js)`, `corCamp (painel-lateral.js)` |
| `658fded` | centavos: veredito do painel e leitura da campanha em ads.html pelo lucro no centavo; R$ 0,00 é "No equilíbrio" (#23, revisão 2) | `A.proposta (ads.js)`, `A.leituraCampanha (ads.js)`, `soma (ads.js)`, `A.manchete (ads.js)`, `cel (ads.js)`, `P.adsDoItem (painel-lateral.js)`, `P.adsVeredito (painel-lateral.js)`, `s (painel-lateral.js)`, `cardAds (painel-lateral.js)`, `verConcorrentes (painel-lateral.js)`, `tit (painel-lateral.js)`, `kR (painel-lateral.js)` |
| `46abda3` | centavos: a etiqueta da venda mostra o mesmo ACOS de ads.html e do painel, calculado da base (#25, revisão 2) | `SHC.fullRateioUn (ml-tela.js)`, `acosDe (ml-tela.js)` |
| `72af292` | centavos: o ícone, o sino e a etiqueta da venda ligam o Ads de catálogo ao anúncio, como o painel e ads.html (#26, revisão 2) | `atualizarAlertas (fundo/07-alertas-promocoes-full.js)`, `alcancou (fundo/12-remessas-radar-resumo.js)`, `SHC.adsLigaCatalogo (ml-extrator.js)`, `vmDe (ml-extrator.js)`, `acosDe (ml-tela.js)`, `SHC.vendaExtras (ml-tela.js)`, `ctxVendas (ml-tela.js)`, `P.adsLigaCatalogo (painel-lateral.js)` |
| `94df299` | centavos: SKU com mais de um anúncio tem o lucro de cada anúncio com a margem dele em ads.html, como o painel (#26, revisão 2) | `A.kpis (ads.js)`, `A.porSku (ads.js)`, `A.leituraCampanha (ads.js)`, `A.montante (ads.js)` |

## Por função

| Função | Commits |
|---|---|
| `A.estado (ads.js)` | `b65f6f2`, `f25fa9c` |
| `A.kpis (ads.js)` | `94df299` |
| `A.leituraCampanha (ads.js)` | `658fded`, `94df299` |
| `A.manchete (ads.js)` | `658fded` |
| `A.metricas (ads.js)` | `245eed7`, `1f42ed4` |
| `A.montante (ads.js)` | `b65f6f2`, `f25fa9c`, `94df299` |
| `A.porSku (ads.js)` | `b74fa60`, `b65f6f2`, `f25fa9c`, `94df299` |
| `A.proposta (ads.js)` | `658fded` |
| `A.soma (ads.js)` | `245eed7` |
| `A.xTxt (ads.js)` | `1f42ed4` |
| `F.conferir (fechamento.js)` | `ea057d4`, `444552e` |
| `F.conferirFatura (fechamento.js)` | `e61c2a1` |
| `F.motivoTotal (fechamento.js)` | `1b91a74` |
| `F.recuperar (fechamento.js)` | `fb66f5d` |
| `F.setaCusto (fechamento.js)` | `aa01d29`, `444552e` |
| `F.textoChamado (fechamento.js)` | `697fff6` |
| `O (núcleo/adaptadores/tiktok.js)` | `cd54f46` |
| `P.adsDoItem (painel-lateral.js)` | `658fded` |
| `P.adsEquilibrio (painel-lateral.js)` | `b65f6f2`, `0e236c3`, `f25fa9c` |
| `P.adsFatoCatalogo (painel-lateral.js)` | `b65f6f2`, `f25fa9c` |
| `P.adsFiltros (painel-lateral.js)` | `f25fa9c` |
| `P.adsLigaCatalogo (painel-lateral.js)` | `72af292` |
| `P.adsLinhas (painel-lateral.js)` | `f25fa9c` |
| `P.adsVeredito (painel-lateral.js)` | `831d719`, `658fded` |
| `P.adsVereditoDe (painel-lateral.js)` | `f25fa9c` |
| `P.anunciosDoFull (painel-lateral.js)` | `494ea15` |
| `P.gravarCusto (painel-lateral.js)` | `c2e22a8` |
| `P.msgKitSalvo (painel.js)` | `9362e69` |
| `P.previsaoFull (painel-lateral.js)` | `5f47e31` |
| `P.saudeFull (painel-lateral.js)` | `07638f4` |
| `SHC.adsLigaCatalogo (ml-extrator.js)` | `72af292` |
| `SHC.adsLucro (ml-extrator.js)` | `b65f6f2`, `f25fa9c` |
| `SHC.alertasDe (ml-extrator.js)` | `5f47e31`, `494ea15` |
| `SHC.calcular (calc.js)` | `859cab5`, `b85dcab`, `4b85c2e` |
| `SHC.fullRateioUn (ml-tela.js)` | `46abda3` |
| `SHC.idsDoProdutoFull (ml-extrator.js)` | `494ea15`, `f25fa9c` |
| `SHC.kitDe (store.js)` | `b85dcab` |
| `SHC.medidasParaSimular (ml-extrator.js)` | `10bdc8f` |
| `SHC.moeda (calc.js)` | `ff505f9` |
| `SHC.precoMinimo (calc.js)` | `b85dcab`, `4b85c2e` |
| `SHC.recomendaPromo (ml-extrator.js)` | `6bdd400` |
| `SHC.recomendaSku (ml-extrator.js)` | `53cd000`, `86ff3b8`, `c73b6aa` |
| `SHC.remessasResumo (ml-extrator.js)` | `ff34bde`, `991c359` |
| `SHC.salvarCusto (store.js)` | `d997dbf` |
| `SHC.salvarCustoSku (store.js)` | `b85dcab` |
| `SHC.simulaRemessa (ml-extrator.js)` | `ed52cea`, `cf91fff`, `10bdc8f`, `e37e296` |
| `SHC.sobraAnuncio (ml-extrator.js)` | `b85dcab` |
| `SHC.sobraAtacado (ml-extrator.js)` | `b85dcab` |
| `SHC.sobraProposta (ml-extrator.js)` | `b85dcab`, `6bdd400` |
| `SHC.vendaExtras (ml-tela.js)` | `72af292` |
| `SHC.vmDaParte (ml-extrator.js)` | `5f47e31` |
| `TT.lucroDoPedido (tiktok.js)` | `cd54f46`, `64ab86b`, `f660a7d`, `47d21df`, `aa62bb3`, `035d470`, `bc3be46`, `85bee3f` |
| `TT.porProduto (tiktok.js)` | `e0facc1` |
| `TT.resumo (tiktok.js)` | `79e718f`, `035d470` |
| `acosDe (ml-tela.js)` | `46abda3`, `72af292` |
| `alcancou (fundo/12-remessas-radar-resumo.js)` | `72af292` |
| `aliquota (núcleo/motor.js)` | `035d470` |
| `ativoTxt (painel-lateral.js)` | `1f42ed4` |
| `atualizarAlertas (fundo/07-alertas-promocoes-full.js)` | `494ea15`, `72af292` |
| `base (fechamento.js)` | `ea057d4`, `444552e`, `88fbf11` |
| `bate (ml-extrator.js)` | `6bdd400` |
| `blocoFull (fechamento.js)` | `c36c193` |
| `calcula (popup.js)` | `4b85c2e` |
| `cardAds (painel-lateral.js)` | `658fded` |
| `cardAdsSku (painel-lateral.js)` | `0e236c3` |
| `cel (ads.js)` | `da1b803`, `658fded` |
| `chave (painel-lateral.js)` | `07638f4`, `5f47e31` |
| `concTopo (painel-lateral.js)` | `9583f05` |
| `conciliar (núcleo/conciliacao.js)` | `73994e7` |
| `contaHtml (tiktok-aba.js)` | `e0facc1`, `cd54f46`, `035d470`, `bc3be46` |
| `cop (fechamento.js)` | `e61c2a1` |
| `corCamp (painel-lateral.js)` | `f25fa9c` |
| `ctxVendas (ml-tela.js)` | `72af292` |
| `dedupe (núcleo/conciliacao.js)` | `4bbd95a`, `73994e7` |
| `desenhaKits (painel.js)` | `9362e69` |
| `dia10 (ml-extrator.js)` | `1f42ed4` |
| `dinheiro (núcleo/adaptadores/tiktok.js)` | `cd54f46` |
| `doFrete (fechamento.js)` | `ea057d4`, `c36c193`, `fb66f5d`, `aa01d29` |
| `doMes (ml-extrator.js)` | `1ad1299` |
| `dvIt (fechamento.js)` | `c36c193` |
| `fecha (tiktok.js)` | `cd54f46` |
| `fechamentoMes (núcleo/motor.js)` | `cfabfe3` |
| `fmt3 (painel-lateral.js)` | `10bdc8f` |
| `freteAcima (calc.js)` | `6bdd400` |
| `freteSeller (calc.js)` | `b85dcab`, `4b85c2e` |
| `gravarFreteHist (fundo/03-faturamento.js)` | `2b35d53`, `6e34646` |
| `idsDe (ml-extrator.js)` | `07638f4` |
| `idsDoPlano (painel-lateral.js)` | `494ea15` |
| `ignora (store.js)` | `b85dcab` |
| `it (painel-lateral.js)` | `9583f05` |
| `itFull (painel-lateral.js)` | `9583f05` |
| `item (fechamento.js)` | `c36c193` |
| `junta (tiktok.js)` | `73994e7` |
| `kR (painel-lateral.js)` | `658fded` |
| `lido (núcleo/adaptadores/tiktok.js)` | `cd54f46` |
| `linhaCamp (painel-lateral.js)` | `831d719` |
| `linhaProduto (tiktok-aba.js)` | `035d470` |
| `lista (ads.js)` | `1f42ed4` |
| `lucroPedido (núcleo/motor.js)` | `a10d5a6`, `e0facc1`, `035d470` |
| `lucroPorProduto (núcleo/motor.js)` | `e0facc1` |
| `mesMenos (ml-extrator.js)` | `1ad1299` |
| `noDia (núcleo/motor.js)` | `cfabfe3` |
| `noFat (ads.js)` | `0e236c3` |
| `ok (calc.js)` | `6bdd400`, `4b85c2e` |
| `orcDia (painel-lateral.js)` | `f25fa9c` |
| `ou (ml-extrator.js)` | `1f42ed4`, `f25fa9c` |
| `pedidoDoDetalhe (núcleo/adaptadores/tiktok.js)` | `23d14ad` |
| `pega (painel-lateral.js)` | `f25fa9c` |
| `problemasTxt (ml-extrator.js)` | `ff34bde`, `991c359` |
| `r2 (calc.js)` | `ff505f9` |
| `r2 (núcleo/util.js)` | `ff505f9` |
| `reparte (núcleo/motor.js)` | `cfabfe3` |
| `resto (fechamento.js)` | `fb66f5d` |
| `rs0 (ads.js)` | `da1b803` |
| `s (painel-lateral.js)` | `831d719`, `f25fa9c`, `658fded` |
| `salvaCusto (ml-tela.js)` | `b85dcab` |
| `salvarCustoFamilia (painel-lateral.js)` | `c2e22a8` |
| `salvarCustoGrupo (painel-lateral.js)` | `c2e22a8` |
| `sobraTxt (tiktok-aba.js)` | `035d470` |
| `soma (ads.js)` | `658fded` |
| `tarifaSpTabela (calc.js)` | `b85dcab` |
| `tarifasEstimadas (tiktok.js)` | `cd54f46` |
| `tit (painel-lateral.js)` | `658fded` |
| `tituloDe (fechamento.js)` | `444552e`, `88fbf11` |
| `tot (núcleo/conciliacao.js)` | `4bbd95a`, `73994e7` |
| `transacaoDoExtrato (núcleo/adaptadores/tiktok.js)` | `cd54f46` |
| `um (painel-lateral.js)` | `831d719` |
| `umaVezPorCobranca (fechamento.js)` | `ea057d4`, `c36c193`, `fb66f5d`, `aa01d29`, `697fff6`, `444552e` |
| `v (painel-lateral.js)` | `07638f4`, `0e236c3` |
| `verConcorrentes (painel-lateral.js)` | `658fded` |
| `vg (painel-lateral.js)` | `1ad1299` |
| `vmDe (ml-extrator.js)` | `5f47e31`, `6ffee5f`, `f25fa9c`, `72af292` |
