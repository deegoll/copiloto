# Mapeamento do painel do vendedor do Mercado Livre (Copiloto)

Levantado **ao vivo em 24/09/2026**, na conta logada do dono, só com leitura (GET).
Quando o ML mudar uma tela, é aqui que se confere o que quebrou. Os testes em
`tests/copiloto/teste_v2.js` usam esta mesma estrutura (com dados fictícios).

## Regra geral

- Painel em `https://vendedores.mercadolivre.com.br` (o `www.mercadolivre.com.br/anuncios/...` redireciona).
- Páginas renderizadas no servidor. O estado vai embutido no HTML em `_n.ctx.r = {...}`
  (script `#__NORDIC_RENDERING_CTX__`). Depois do objeto vem código que **não** é JSON
  (`new Set([...])`), por isso o recorte é por casamento de chaves: `SHC.mlExtraiEstado()`.
- O **código MLB não aparece no texto da tela** da Central de promoções. Na lista de Anúncios, cada
  linha é um `div id="MLB…"`.
- `fetch(url, { credentials: 'include' })` funciona com a sessão do Chrome (status 200, mesmo HTML).
- Um endereço antigo (`www.mercadolivre.com.br/promocoes`) respondeu `RequestHeaderSectionTooLarge`
  por excesso de cookies: usar sempre o domínio `vendedores.`.

## Central de promoções: `/anuncios/lista/promos?page=N`

- 25 famílias por página; `?page=N` pagina (o botão "Seguinte" da tela não troca a página).
- **Família (card)**: objeto com `shippingInfo` e `title`
  `{ id:"#8724893009446607", title, price:"R$ 689,90 a R$ 749,90", extraInfo:"Clássico e Premium", info:"Depósito: 3.716 u.", shippingInfo:"Você oferece frete grátis", pictures:[{url}] }`
- **Proposta**: `{ type, itemId:"MLB…", totalCharges:{ detail:{ costs:[…], summary:{ label:"Você recebe", value:"R$ 362,11", description:"Não contempla descontos cumulativos" } } } }`
  - `costs`: `{id:"price", value:"R$ 529,90"}`, `{id:"sale_fee", value:"-R$ 60,94", description:"Clássico"}`, `{id:"shipping", value:"-R$ 106,85"}`.
  - Conferido em 41 e 53 propostas: `preço − tarifa − envio = você recebe`, sem divergência.
- **Caixa da promoção** (ancestral com `columns`): `columns[0]` = nome + datas ("21/set a 13/out"),
  `columns[1]` = desconto sugerido ("R$ 90" / "(11%)"), `columns[2]` = preço.
- **Aporte do ML**: modelo atual é "promoções com redução nas suas tarifas". Nas propostas com custos,
  a tarifa já vem reduzida. As caixas "Con aporte de Mercado Libre" (`type:"always_on_meli"`) **não
  trazem `totalCharges`**: o custo depende do desconto escolhido. A simulação do ML ainda não foi mapeada.

## Anúncios — atualização ao vivo de 24/09/2026 (conta AVATRON, 419 anúncios)

- **Endereço novo:** `/anuncios/lista` redireciona para **`/anuncios`** (mantém `?page=N`). As etiquetas e a leitura aceitam os dois.
- Filtros (`/anuncios?filters=X&page=N&sort=DEFAULT`): sem filtro = todos (419); `OMNI_ACTIVE` = ativos (392);
  **`OMNI_INACTIVE` = pausados/inativos/restritos/finalizados (34)** — o frete ("A pagar") aparece neles também;
  **`COMPETING` = competindo no catálogo (173)**. Valor desconhecido de filtro volta a lista completa.
- Conta: `appProps.pageProps.initialAppContext.user.userId` (número de 9 dígitos).
- **Promoção ativa (F7 resolvido):** `price.lines` = ["R$ 165", "em promoção a R$ 156,75", "Com 1 preço de atacado"] e a tarifa,
  o frete e o "você recebe" são do PREÇO DA PROMOÇÃO (156,75 − 28,22 − 21,75 = 106,78). O leitor usa o preço da promoção.
- Outras linhas vistas: "Sincronizado com #…" (catálogo), "Você receberá até R$ x por usar o Flex" (bônus Flex, não é frete),
  competição "Ganhando" / "Você oferece condições melhores do que outros vendedores." / "Revisar condições".
- A aba "Central de promoções" dentro de Anúncios troca para `/anuncios/lista/promos` sem recarregar (SPA): a tela busca o estado da nova URL.

## Anúncios: `/anuncios/lista?page=N`

- `appProps.pageProps.viewData.rows[]`. A página 1 teve 30 linhas; `grid.pagination.total` = 55. `?page=2` pagina; `?offset=` não.
- Linha: `metadata.itemId` (MLB), `metadata.variationsQuantity`, `product.{title,status,sku:"SKU F1-20-LILAS-RODA",stock[0].label,pictures.urls}`,
  `price.lines[0].label` ("R$ 599,90") + "Com 1 preço de atacado",
  `purchaseOptions.lines`: tipo ("Clássico"), "A pagar R$ 68,99" (tarifa), "Você oferece frete grátis", "A pagar R$ 91,95" (frete),
  `earnings.lines[0].label` ("R$ 438,96" = você recebe no preço atual).
- Famílias com Clássico e Premium vêm como faixa ("R$ 518,61 a R$ 534,22"); os anúncios ficam em `innerRows`.
- **SKU** (30/09/2026): `product.sku` só vem na linha de anúncio simples. A linha de dentro (`innerRows`) do MESMO user product
  (`metadata.userProductId` igual ao do pai, ex. Clássico + Premium) vem SEM `product` → herda o SKU do pai. Anúncio com variações
  (`variationsQuantity > 0`, `product.expandable` "Expandir variações") não traz SKU na linha fechada: o SKU é de cada variação
  (doc do ML: atributo `SELLER_SKU` em `variations[].attributes`; `seller_custom_field` é campo interno, não é SKU). O Copiloto completa
  com as outras telas já lidas (Métricas › vendas por anúncio, Full) — `SHC.skusConhecidos`/`SHC.completaSkus`. Formato das variações
  abertas (`update-rows … rowType=inner`) ainda NÃO mapeado ao vivo (30/09/2026: tentativa pelo Chrome conectado não respondeu — a aba do
  ML travou; nada lido). Enquanto não houver leitura da variação, o anúncio com variações sem venda/Full aparece na tela de custos como
  "SKU nas variações · ainda não lido" (não mais "anúncio sem SKU"). **v3.2:** depois que a seller abre o Editor em massa uma vez, o SKU
  de cada variação vem de lá (seção "Editor em massa" abaixo).
- **Família de anúncios** (`metadata.entityType:"family"`, `itemId:""`, `documentId:"TR…"`/`"CA…"`, `itemsQuantity`/`userProductsQuantity` 2,
  `referenceUserProductId`, `product.expandable.srLabel:"Expandir anúncios"`): não é anúncio nem variação. Fechada vem com `innerRows:null`
  (retrato `anuncios_sem_dados_fiscais_p1.json` rows[4] e rows[24], conta de teste) → os anúncios de dentro NÃO entram no retrato até a
  família vir aberta. **Visto ao vivo em 30/09/2026** (conta de peças de caminhão, 155 linhas = 383 MLB): família aberta e "Ver mais N
  opções de venda" = `GET /anuncios/api/listing/row/expanded?filters=&sort=DEFAULT&search=&id=<TR…>&limit=50` (sem `limit` corta em 10);
  SKU por variação = Editor em massa `GET /anuncios/editor-massivo/api/items/<MLB>/variations`. Detalhes, contagens e retratos:
  `tests/copiloto/retratos_editor/MAPA-LEITURA-COMPLETA.md`.
- **Leitura completa no Copiloto (v3.2, 01/10/2026)** — `SHC.mlLeituraCompleta` (ml-extrator.js), usada pela sincronização (`sincronizarAnuncios`):
  - Páginas da lista: o total do ML (`grid.pagination.total`) conta **LINHAS** (155), não MLB. `SHC.mlPaginaAnuncios` devolve `chaves`
    (uma por linha: `documentId` ou MLB) e `paraAbrir`. O laço só para quando a página não traz LINHA nova (página só de famílias não é o fim)
    ou quando as linhas lidas chegam ao total. `completo` = linhas lidas = total **e** cada família/"Ver mais" trouxe os `itemsQuantity` que disse.
  - Abrir: `SHC.mlParaAbrir` (família fechada → `documentId`; "Ver mais" → `parentDocumentId`) + `SHC.mlUrlAbrir(id)` (sempre `&limit=50`),
    uma chamada de cada vez com a pausa da sincronização (1,2 s). Fundo sem sessão → a aba aberta faz o GET (`ler_json_ml`, só essa rota).
  - Dentro da família, `product.title` é o nome da variação ("Branco"): vira `nomeVariacao`; o `titulo` fica o do pai. Cada item ganha
    `familyId` e `userProductId` separados (o campo antigo `familia` continua igual) e `qtdVariacoes` (de `variationsQuantity`).
  - O pai fica separado dos itens em `ml:anuncios:<conta>.familias = [{id:'TR…', tipo:'familia'|'verMais', familyId, titulo, estoque, esperado, itens:[MLB]}]`.
  - Leitura parcial (página ou família que falhou/veio cortada) só JUNTA: nunca apaga MLB conhecido. Família sem `itemsQuantity` ou que
    voltou `{documentGroup: []}` também é parcial; família lida pela metade junta os membros com a lista antiga (não encolhe).
  - Cruzamento ERP × ML (`erp-cruzar.js`, v3.2): `SHC.erpLeitura(snap)` = MLB únicos lidos + (`esperado` − lidos) de cada família. "Não publicado"
    e "parado" só aparecem com `completo:true`, nada faltando nas famílias **e** as variações de todo anúncio com variação lidas no Editor em massa.
  - 429/503 ao abrir família (`abrirNaLista` usa `buscarJsonMotivo`): espera o Retry-After (mín. 10 s) e NÃO repete o GET nas abas;
    3 famílias seguidas sem resposta → para (parcial). Cada página e família lida fica no ciclo (`naCiclo('anuncios', …)`): a retomada
    depois de uma queda não volta do zero. A aba lê até 5 páginas por família (mais de 50 anúncios).
  - A aba de Anúncios aberta faz o mesmo para a página que está na tela (ml-tela.js `abreFamilias`): os anúncios de dentro vão ao retrato
    e ganham etiqueta quando a seller abre a família.
  - Filtros da lista confirmados ao vivo (30/09): `OMNI_ACTIVE`, `OMNI_INACTIVE`, `OMNI_PAUSED`, `WITHOUT_STOCK`, `OMNI_UNDER_REVIEW`.
    `OUT_OF_STOCK`, `NO_STOCK`, `PAUSED`, `OMNI_CLOSED` e `WITH_VARIATIONS` NÃO existem (voltam a lista inteira). Contagem do ML
    (Ativos/Inativos…) é de LINHAS: comparar com o Copiloto exige a mesma unidade ("155 linhas no ML = ~383 anúncios").

## Editor em massa (leitura PASSIVA, v3.2)

- Página `/anuncios/editor-massivo/<sessão>?viewId=listings`; a sessão começa com o id da conta (`3400202502-edition-…`). Só a visão
  `listings` é lida (`SHC.editorSessao`); a fiscal é outra sessão do ML (link `SHC.FISCAL_EDITOR`) e não é aberta pelo Copiloto.
- `completo` só quando a lista plana chegou ao total E todas as variações vieram (até `SHC.EDITOR_VAR_MAX` = 400 anúncios com variação;
  lista plana que falhou → não pede variações; 2 GETs de variação seguidos sem resposta → para). O fundo (`juntarEditor`) mantém as
  variações já lidas quando o anúncio vem sem elas. Leitura parcial espera 1 h desde a última tentativa (`editor:tentativa:<conta>`).
- Só quando a seller abre a tela (copiloto-ml.js `lerEditor`, 8 s depois da carga, 1,5 s entre chamadas, 1 leitura completa a cada 6 h):
  `GET /anuncios/editor-massivo/api/state?gridOnly=true&page=N&limit=50&viewId=listings&sessionId=<sessão>&useUpGrouping=false`
  (lista plana, todos os MLB; a ordem muda entre leituras → `SHC.editorLeitura` junta por id e repete até 3 passadas) e
  `GET …/api/items/<MLB>/variations?viewId=listings&sessionId=<sessão>` (SKU, nome "Cor: Vermelho", estoque, Flex/Full de cada variação).
- NUNCA: `PUT /response`, `save-to-session`, `save-session`, `save-queue-to-session`, `…/item/:itemId/cells`, `suggestion-ai/resolution`,
  nem trocar a aba de colunas (grava preferência no ML).
- Linha (`SHC.editorLinha`): `cells.<coluna>.data` — `sku.value`, `quantity.value.rawNumber`, `listing_type` (opção marcada + "Você paga R$ x
  por venda"), `shipping_method` (`SHIPPING_ME2` / `SHIPPING_REMOVE` "Você não faz envios" / `SHIPPING_CUSTOM` "Envios por sua conta" /
  sem opção = `data.text` "Não disponível"), `shipping_costs` (`SHIPPING_FREE` / `SHIPPING_BUYER` / `SHIPPING_REMOVE` / `SHIPPING_FREE_CUSTOM`),
  `shipping_type` (retirar), `manufacturing_time.value.number`, `warranty.data.{text, comment}`, `item_quality.data.comment[]`
  (`GOOD|MEDIUM|BAD` = nível; `REASON|EMPTY` = dica), `variation.data.variationsQuantity`. Nada de comprador na grade.
- Guardado em `editor:<conta>` → `SHC.skusConhecidos` (SKU das variações no retrato), `SHC.logisticaDoAnuncio` (forma de entrega
  confirmada) e o cartão "Pendências dos anúncios" da aba Saúde (`SHC.editorPendencias`: por tipo, sem os finalizados).
- Sem coluna de dado fiscal, medidas/peso nem GTIN nesta visão.
- O retrato `anuncios_sem_dados_fiscais_p1.json` é de uma **conta de teste** (pneus/empilhadeira), não da conta de peças de caminhão do relato.
- A API oficial (`/items` com `attributes`/`variations[].attributes` SELLER_SKU) NÃO é chamada pelo Copiloto: `SHC.skusDoItemML` só serve
  quando alguma tela trouxer esse formato.
- **Células carregadas depois** (lazy): `GET /anuncios/api/listing/update-rows?ids=<MLB|CA…>&cells=price|promotions,price|pxq,purchase_options|price,purchase_options|shipping,earnings,metrics,messages&rowType=main|inner`
  - Um id por chamada (lote devolve só 1).
  - `price|promotions` = promoção ativa. Veio vazio nos 30 anúncios da página 1 (nenhuma ativa em 24/09); formato preenchido ainda não visto.
- **Atacado**: `GET /anuncios/api/listing/tooltip?type=tiered_pricing&documentId=MLB…`
  → `priceList[0].table[] = { label:"10 unidades", value:"$ 618", suffix:"/u" }`. O ML não mostra "você recebe" do atacado.
  - Visto ao vivo 30/09/2026: a resposta vem em `data.priceList`; degrau acima do preço da promoção vem com
    `badge.srLabel "Com preços para revisar"` (o comprador não vê) → `revisar: true`. Anúncio sem atacado responde **424**.
  - v3.2: os degraus vão para `atacado:<conta>` = `{ ts, porItem:{ MLB:{ degraus:[{qtd, preco, revisar?}], ts } } }`
    (a tela manda `atacado_degraus`; a sincronização lê os anúncios marcados "Com N preço(s) de atacado", até 40).
  - Regras (ajuda/36440, developers "Preços por quantidade % B2B"): só comprador com CNPJ validado vê; até 5 degraus;
    frete do atacado é calculado sobre o PEDIDO inteiro (o Copiloto conta 1 frete por peça: estimativa conservadora).
- **Frete × faixa de preço** (ajuda/40538, conferido 30/09/2026): custo de envio = faixa de PESO × faixa de PREÇO
  (0–18,99 | 19–48,99 | 49–78,99 | 79–99,99 | 100–119,99 | 120–149,99 | 150–199,99 | 200+); Clássico × Premium não muda o
  frete. HA-14253: 45,35 = 8–9 kg e 58,75 = 9–10 kg, os dois na faixa 150–199,99 → `SHC.freteMesmoSku` acusa só anúncio do
  mesmo SKU na MESMA faixa com frete maior; diferença de faixa vai explicada no balão (`SHC.freteOutraFaixa`).

## Vendas

- Lista: `/vendas/omni/lista` → estado com `orderId`, `packId`, `shipmentId(s)`, `itemIds` (25 linhas).
  - Ao vivo em 01/10/2026 (conta de peças): a lista padrão veio com 8 vendas (`count_text_marketshops` = "8 vendas", lista `list_marketshops`,
    linhas `row-<pack>_<pedido>`) e SEM o brick `pagination` (o do retrato de 26/09 tinha `pagination.data.total`). `?page=2` devolve a MESMA
    página (ignorado). O parâmetro de página de verdade ainda não foi visto (só aparece com mais vendas do que cabem). O fundo (F11) segue
    páginas só quando a lista diz um total maior que o lido e para sozinho quando a página seguinte repete os pedidos.
- Detalhe: `/vendas/<orderId>/detalhe` → `appProps.pageProps.response`:
  - `account_rows-CHARGES`: "Tarifa de 11,5%", `subTotal:"-R$ 80,38"`;
  - `account_rows-SHIPMENT`: "Tarifa do Mercado Envios (por sua conta)", `subTotal:"-R$ 91,95"`;
  - também `account_rows-PRODUCT`, `account_rows-TOTAL`.
- Peso cobrado / medida: ainda não mapeado (a tela aponta para "detalhe de tarifas em Faturamento").

## Faturamento: frete cobrado em CADA venda (fonte do histórico de 12 meses) — ao vivo em 24/09/2026

- Resumo: `/billing/resume` (faturas por mês: fechamento, vencimento, total). Lista: `/billing/cnc/charges-summary`.
- **Cobranças por período (JSON):** `GET /billing/cnc/api/charges-summary/charges-summary-provider/bricks?siteId=MLB&platformId=ML&isBackoffice=false&searchText=&searchLimit=500&idDate=custom&fromDateCustom=AAAA-MM-DDT00:00:00.000Z&toDateCustom=AAAA-MM-DDT23:59:59.999Z&page=N`
  (`page` pagina; `offset` não; no máx. 500 por página). Resposta: `charges.data[]` com
  `{ date:"24/set/2026", detail_1:<tipo>, detail_2:"Venda #<orderId>", description_1:<título>, permalink:"https://produto.mercadolivre.com.br/MLB-<n>-…",
     amount:{ value:{ fraction:"-6", cents:"65" } }, modalTrigger:{ entityId, conceptId, conceptType:"SHIPPING"|…, type:"CXDE"(cobrança)|"BXDE"(estorno) } }`.
  O MLB sai do `permalink`; o pedido do `detail_2`.
- Tipos (`detail_1`) vistos em 15 dias: "Tarifa de envio extra ou intermunicipal (Por sua conta)" (88), "… (Por sua conta e por conta do comprador)" (4),
  "Tarifa por envio interno ao município (Por sua conta)", "Cancelamento da tarifa de envio …" (estorno), "Custo por vender no Mercado Livre",
  "Custo por cobrar no Mercado Pago", "Taxa de parcelamento", "Taxa de recebimento", **"Tarifa por campanha de publicidade de Product Ads" (93)**,
  "Cargo por campaña de Publicidad de Seguidores".
- Retrato de 30 dias da AMB MOVE (fixture local): também **"Tarifa do Mercado Envios (Por sua conta[ e por conta do comprador])"** (type CDSB; estorno
  "Cancelamento da tarifa por envios no Mercado Livre …", BDSB) — é frete e o leitor conta; 2 de 180 linhas de frete vieram com `permalink: null`
  (sem MLB → ficam de fora do vd). Na lista de Anúncios, "Sincronizado com #…" vem em `row.product.synchronized.label`; "Ganhando"/"Perdendo" em
  `dynamicCell.badges[].label` e a frase em `dynamicCell.lines[].label`. Conta sem Canal: `/marketing/canal-de-transmissao/lista` devolve a página de erro.
- Detalhe de uma cobrança ("Mais detalhes"): `GET /billing/cnc/api/charges/modal/<entityId>/bricks?siteId=MLB&conceptId=<id>&conceptType=SHIPPING&typeOfCharge=CXDE&referenceDate=AAAA-MM-DD…`
  → só título, valor e fatura. **Peso cobrado: o ML NÃO mostra** nem aqui nem no detalhe da venda. A prova de medida compara as medidas
  cadastradas (anúncio/ERP — a planilha do Tiny traz peso bruto e medidas da embalagem) com a subida do frete do mesmo produto.

## Full (Métricas › Estoque Full) — ao vivo em 24/09/2026 (conta AMB MOVE; a AVATRON não usa Full)

- Tela: `/metricas/stock-full?target=fbm`. Dados (JSON, pela sessão; o userId da URL pode faltar):
  `GET /metricas/stock-full/api/metrics/page-data?siteId=MLB&locale=pt-BR&target=fbm` →
  - `newStorageSpace.segments[]` = `{ id:'totable'|'non_totable', title:"Pequenos e médios: 0%", capacityText:"0 un. de 100 un.", percentage, occupationStatus,
    tooltip.content (HTML: "No Full", "Entrada pendente", "Você pode enviar até") }`;
  - `purchasedAssignedSpaceSummary` = espaço por mês (`cards[]{ title:"Setembro", subtitlePill:{text:"ATRIBUÍDO", tooltip:"Segundo a pontuação do dia 15/agosto: -2 pontos"}, segments[]{title, units:"100 un."} }`,
    `estimateText`: "No dia 23 de cada mês, atribuiremos seu espaço para o mês seguinte.");
  - `newCurrentQualityStock` = "Desempenho no Full": `tabs[].cards[]` (ex.: "Tempo de estoque" pill "30/30 pontos", "Fora de venda" "10/10 pontos",
    "Vendas por m³" "0 de 40 pontos" com bulletChart) + `newScoreQualityStock` (pontuação).
- Aba "Gestão de estoque Full" = `/anuncios/lista/space_management` (seções Controle de estoque / Planejamento de envios / Custos por estoque antigo).
  Tabela por produto (JSON): `GET /stock-management/space-management/api/content?offset=0&limit=20` (Accept: application/json) →
  `stockTable.headers[9]`: Produto, Vendas (últ. 30 dias), Estoque médio (últ. 30 dias), A caminho, Não aptas para venda, Aptas para venda,
  Com tempo de estoque, Tempo até esgotar estoque, **Ação sugerida** (do próprio ML); linhas trazem status ("Pausada"), tamanho ("MÉDIO"),
  "Sem estoque", avisos ("Resolva o problema fiscal da conta."). Também `stockDistributionSpaceFcv.segmentsSection` (uso do espaço) e
  `filterCounterSection.resultsCounter`. "Gestão de envios Full" = `/shipping/inbounds`.
- Vendas por mês para sazonalidade: sair do Faturamento ("Custo por vender no Mercado Livre" = 1 por venda, com data e MLB no permalink).

## Canal de transmissão (Marketing › Canal de transmissão) — mapeado ao vivo em 24/09/2026 (conta AVATRON)

- Entrada: `/marketing/canal-de-transmissao/lista` → cards de canal (uma conta pode ter mais de um "storefront"; ex.: 3).
  O id do canal vem nos links: `storefront_id` (40+ caracteres). No estado: `appProps.pageProps.data.storefront.{id,name,owner_id}`.
- Canal: `/marketing/canal-de-transmissao?storefront_id=<id>` → seguidores ("1.815 seguidores"), tipos de comunicação
  (Cupom de desconto, Produto em promoção; automáticos: Cupom carrinhos abandonados, Cupom de recompra), abas Mensagens/Stories.
  - Lista (10 por página) no estado: nó com `properties.campaigns[]` (1º = mensagens, 2º = stories) — cada uma
    `{ id, campaign_type:'checkout_recovery'|'new_arrival'|…, audience_target, cells:[…] }`, células por `id`:
    `title` (header = tipo, title = nome), `date` (text "Terça-feira, 3/fev/2026," + description "16:00 h"), `status` (title "Enviada", status "success"),
    `sent`, `views`, `clicks`, `ctr` ("4%"), `sales-units`, `sales-amount` ("R$1.440,49") — valor sempre em `.text`.
  - Páginas seguintes (JSON): `GET /marketing/canal/api/broadcast/campaigns?storefrontId=<id>&offset=10&input=&sort=date&order=DESC&communication_type=channel|story&locale=pt_BR`.
- Produtos que podem ser comunicados: `/marketing/canal-de-transmissao/lista-produtos-promocao?storefrontId=<id>` — "só os com promoção
  vigente nas datas disponíveis" (408 na AVATRON, 10 por página). Card: `{ itemId, title, promotions:"1 promoção ativa|agendada",
  availableUnits, href, thumbnailUrl, cardInfo:{ disabled, recommended, reason, cta } }`. Motivos de não elegível vistos:
  "anúncio sincronizado com um do catálogo — selecione o anúncio #…" e "outros vendedores oferecem melhores condições de venda".
  - **Paginação (ao vivo em 01/10/2026, conta de peças):** `&page=N` e `&offset=N` na página são IGNORADOS (voltam 10 produtos, `offset:0`).
    A página traz `pagination:{ total:75, limit:10, offset:0 }`; o botão "Vá para a página 2" da tela pede
    `GET /marketing/canal/api/broadcast/promotions?storefrontId=<id>&offset=10&input=` → JSON `{ pagination:{total, limit, offset}, items:[{ id, component,
    properties:{ itemId, title, promotions, availableUnits, thumbnailUrl, href, cardInfo } }] }`. A ORDEM muda entre dois pedidos iguais
    (2 de 10 se repetiram entre offset 0 e 10): `SHC.canalLer` junta sem repetir MLB e marca incompleto só quando uma página não responde (F14).
- Criar (NÃO automatizar; o seller confirma no ML): `selector-comunicacao?storefrontId=&itemId=MLB…&campaignType=promotion`
  → formulário `formulario-produto-promocao?storefrontId=&itemId=MLB…&communicationType=channel` (story|channel|ambos).
  Campos: Data e hora (dias úteis dentro de uma janela: em 24/09 aceitava 24, 25, 28, 29, 30/set e 1–2/out; horários cheios 08:00–19:00),
  Nome (60 caracteres), Promoção (preço final atualizado sozinho até o envio), Mensagem (textos prontos do ML), Audiência
  ("seguidores que demonstraram interesse no seu produto"). Botões "Criar mensagem" / "Sair sem criar".
- Preço da promoção numa data: `GET /marketing/canal/api/broadcast/promotions-info?date=AAAA-MM-DDTHH:MM&selectedItem=MLB…&storefrontId=<id>`.
- Conferência do que a seller criou (30/09/2026, `SHC.canalConfere`): a MESMA lista acima (`properties.campaigns[].cells`). Casa pelo nome que o
  Copiloto põe no formulário ("25/09 19h · título") e, se o nome mudou, por dia + hora + tipo. Só "Enviada"/`status:'success'` foi visto ao vivo;
  A CONFIRMAR AO VIVO: o `title`/`status` da célula `status` de uma comunicação PROGRAMADA (futura) e de uma CANCELADA/excluída; se a futura aparece
  já na 1ª página (ordem `sort=date&order=DESC` põe as futuras no topo?); se `sent/views/clicks` vêm vazios ou "-" antes do envio; onde fica o MLB
  da campanha (hoje procurado em qualquer lugar do JSON da campanha); se "Story e Canal" gera 1 ou 2 linhas (uma em cada aba).
  Até lá (`SHC.canalStatusML`, 30/09): só vira "programada" o texto que diz programada/agendada (ou código schedul/program); revisão, análise,
  pendente, aguardando e os códigos info/warning/accent aparecem com o texto cru do ML ("no ML: …") e não contam como confirmadas.

## Notas fiscais das VENDAS (Faturador e Full) — ao vivo em 25/09/2026

Página `/documents/overview/reports?start_date=AAAA-MM-DD&end_date=AAAA-MM-DD&page=N`. A lista vem de um POST de CONSULTA (só busca):
`/documents/overview/api/invoice/search?boUserId=&boSiteId=` com `{startDate, endDate, typeOfReceipt:['NFE'], offset, limit:10}` →
`{invoices:[…], total, offset, limit}`. O Copiloto guarda só data, venda, nº/série, status ("Aprobada" → Autorizada), valores e chave
(`SHC.nfeVendasDaResposta`); `recipient_*`, `cnpj`, `customer_type` e `observation` nunca. Excel/PDF/XML: botões da página (o Copiloto só linka).
Retrato: `tests/copiloto/fixtures/nfe_vendas_search.json`.

## Outras chamadas vistas (não usadas ainda)

`/anuncios/api/processes?viewId=listing&subViewId=marketplace`, `/anuncios/api/tasks`,
`/anuncios/api/price-competitiveness/score?seller_id=…` (404), `/emissor/informar-nfe?shipment_ids=…`.
