# TikTok Shop Brasil — mapa das telas de PEDIDOS e VENDAS (08/10/2026)

Lido ao vivo no Chrome de teste (conta com 75 pedidos nos últimos 12 meses), só visualização. Conferido com os retratos de `tests/copiloto/retratos_tiktok` e a captura passiva `extension-copiloto/tiktok-pagina.js`. Nada de comprador aqui; ids e valores abaixo são de exemplo.
Convenção: "lista" = resposta que a própria tela recebe. Nenhuma rota abaixo funciona por GET direto: são POST com a assinatura que a página põe na query (o Copiloto só pode LER a resposta que a tela já pediu).

## 0. Resposta curta (o que o sistema "inteligente" pode afirmar por pedido)

| Pergunta | Dá para saber por pedido? | Campo | Onde |
|---|---|---|---|
| Veio de **afiliado**/criador? | **SIM** (sinal), **valor só no extrato** | `sku_module[].creator_info_name.items[]` com `"Criador de afiliada"` (position 1) e `"Destinatário da comissão: <@criador>"` (position 3). 43 de 55 pedidos distintos. R$ da comissão: item **113** "Comissão paga aos criadores" (afiliado) ou **253** "Comissão de Anúncios da loja paga aos criadores" (Shop Ads do criador) dentro do item 3026 do `order_breakdown`. % por produto: `products[].commission_plan_info.commission_rate` ÷ 100 (lista de produtos). | lista e detalhe de pedidos; `order_breakdown` |
| Veio de **LIVE**? | **SIM** | `order_label_module[].label_express_map.sales_source_live_tag` e `extra_data_map.sales_source_live_tag` (itens `"LIVE"` e `"LIVE: <@criador>"`). Tag LIVE cinza na lista. Todos os 7 pedidos LIVE também tinham afiliado. | lista/detalhe |
| **Amostra** reembolsável? | **SIM** | `order_label_module[].is_refundable_sample` / `extra_data_map.refundable_sample_tag`; tag "Amostra reembolsável" | lista |
| **Ads (GMV Max / Shop Ads)** pagou a venda? | **NÃO encontrado por pedido.** Nenhuma chave de pedido/extrato diz "anúncio". O gasto só existe por campanha, por produto (`spu_id`) e por dia (§5). Só o repasse ao criador de anúncio (item 253) aparece por pedido. | — | Ads é rateio ESTIMADO, nunca fato por pedido |
| **Campanha** da plataforma (10.10, 11.11…) | **Parcial**: o desconto financiado pela plataforma aparece como valor (`price_module.platform_discount_total`), sem nome da campanha. Não reduz o repasse (item 46 já é antes dele). | `platform_discount_total` | detalhe |
| **Promoção/desconto do vendedor** | **SIM, com nome e valor** | `price_module.seller_discount_total`; `promotion_infos[]{promotion_name, promotion_cost ("R$ 300,00"), promotion_type (só vi 1)}` (ex.: desconto no produto, "RELAMPAGO"); no extrato, item 312 | detalhe; extrato |
| **Cupom** | **Parcial/não confirmado**: cupom do vendedor entra em `seller_discount_total`/312; cupom da plataforma em `platform_discount_total`. Nenhum `voucher`/`coupon` com nome no pedido. A lista de promoções (`/api/v1/promotion/list`) abriu **CAPTCHA** e foi parada. | — | — |
| **Rebate** | **Não encontrado** (nenhuma chave, nenhuma linha do extrato). | — | — |
| Comissão, taxa fixa, SFP, frete | **SIM**, valor exato, por pedido | itens 5065, 440, 123, 412/413/414/53 | extrato (§3) |

Fórmula que fecha no centavo em todos os casos lidos: `total_net_amount = item46 + item53 + item51` (vendas líquidas + custo líquido de frete + taxas e impostos). Ex.: 569,90 + 0 − 142,77 = 427,13. A "Sobra" do Copiloto = esse valor − custo do produto − imposto − embalagem − (Ads rateado, estimado).

## 1. Pedidos › Gerenciar pedidos

- URL: `https://seller-br.tiktok.com/order?selected_sort=6&tab=all` (abas `tab=to_ship|…`; `/order` abre em "Para enviar"). 20/página, 12 meses (08/10/2025–08/10/2026), paginação `li.p-pagination-item[aria-label="Página N"]`.
- Abas: Todos, Para enviar, Enviado, Concluído, Pendente, Cancelado. Cartões do topo: Envio em 24 h, Cancelamento automático em 24 h, Envio atrasado, Cancelamento solicitado, Devolução/reembolso solicitado. Botões: Etiquetas de envio, Carregar, Filtro, Classificar por, Exportar (não usar).
- Colunas: Pedido · Comprador · Itens · Status do pedido · Método de envio · Opção de entrega · **Total** · (Ação) · (coluna fixa à direita vazia).

### Estrutura do DOM (seletores estáveis; as classes `sc-xxxx` são geradas, não usar)
- Linha: `tr[data-log_order_status][data-log_order_sub_status][data-log_order_fulfillment_type]` (20 por página; `data-log_order_status` = 102 enviado, 104 cancelado). O pedido ocupa só esse `tr`.
- Nº do pedido: `a[href^="/order/detail?order_no="] span.order_id_number` (texto = `main_order_id`, 18 dígitos) — **é a chave para casar com a resposta e com o extrato**.
- Data/hora: `div.text-p4-regular` logo abaixo do nº (12px, cinza `#6C6D6F`). Tag LIVE / Amostra: `span.p-tag-ng.p-tag-ng-color-neutral` entre o nº e a data.
- Comprador: `[data-log_click_for="buyer_info"]` (não ler). Itens: `[data-log_click_for="product_card"]` → texto "N item" + miniatura. **Título, SKU e quantidade NÃO estão no DOM da linha**: vêm da resposta (`sku_module[].seller_sku_name`, `quantity`, `product_name`).
- Status: 5ª `td` (`Entregue`/`Em trânsito`/`Cancelado`, com "N NF-e"). Total: 8ª `td`, texto `R$ 544,54`, alinhado à direita, 120 px.
- **Total = `price_module.grand_total` = `sub_total` + frete que o comprador pagou** (ex.: 455,92 + 88,62 = 544,54). NÃO é a receita do vendedor: o frete do comprador cobre o custo do frete (itens 412/414). Para margem usar o extrato, não esta coluna.
- Onde caberia a etiqueta "Sobra R$ X · Y%": (a) **recomendado**: mesma linha das tags da célula Pedido (`td.left-fixed`, 236 px), como pílula igual à "LIVE" (12px, raio 12, altura 20); (b) abaixo do valor na célula Total (120 px: quebra em 2 linhas); (c) coluna nova após Total. A linha tem ~93 px de altura, sobra espaço vertical na célula Pedido.

### APIs da lista e do detalhe
- `POST /api/fulfillment/order/list` corpo `{count:20, offset, pagination_type:0, sort_info:"6", search_condition:{condition_list:{…}}, search_cursor}` → `data{main_orders[], total_count, has_more, next_cursor_token, search_next_cursor…}`. Página seguinte usa o cursor. Contadores das abas: `POST …/order/search_count` → `count_map` (101 para enviar, 102 enviado, 110 pendente).
- Campos por pedido que importam (todos já vêm na LISTA): `main_order_id`; `trade_order_module{create_time, payment_time, shipping_fee.price_val, pay_method, fulfillment_type}`; `order_status_module[]{main_order_status, main_sub_order_status}`; `sku_module[]{sku_id, product_id, product_name, sku_name, seller_sku_name, quantity, sku_unit_price, sku_total_price, creator_info_name}`; `fulfill_line_module[]` (espelho do anterior; aqui `sku_unit_price` = preço do item depois dos descontos); `price_module{sub_total, grand_total}`; `order_label_module[]` (LIVE/amostra); `extra_data_map`; `reverse_module[]{reverse_status, reverse_reason, refund_time}` (cancelamento/devolução); `delivery_module[]` (frete/pacote/transportadora: não usar dados de rastreio).
- ⚠ Em `sku_module[].sku_unit_price`/`sku_total_price` o valor da LISTA já vem somado ao frete do comprador (484,84 quando o item é 299,90). Preço de item = `price_module.sub_total` (ou `fulfill_line_module[].sku_unit_price`).
- Detalhe: tela `/order/detail?order_no=<id>`; `POST /api/fulfillment/order/get` corpo `{"main_order_id":["<id>"]}` → mesmo molde da lista **mais** `price_module` completo: `main_order_origin_sale_price` (preço de tabela), `seller_discount_total`, `platform_discount_total`, `sub_total`, `shipping_fee`, `shipping_origin_fee`, `shipping_fee_discount_seller`, `shipping_fee_discount_platform`, `handling_fee`, `taxes`, `grand_total`, `promotion_infos[]`. Identidade: `item46 = main_order_origin_sale_price − seller_discount_total` e `sub_total = item46 − platform_discount_total` (645,72 = 949,90 − 300,00 − 4,18). Também `/api/fulfillment/package/list`, `/api/v1/fulfillment/order/history`.
- A tela de detalhe (texto) mostra só o que o COMPRADOR pagou: "Subtotal de item(s) após descontos", "Taxa de envio após descontos", "Taxa de processamento", "Total". **Não mostra taxas do vendedor nem repasse** — isso só no Finanças.
- Captura atual do Copiloto (`tiktok-pagina.js`, rota `pedidos`) guarda só `main_order_id`, `payment_time`, `sku_id`, `seller_sku_name`, `quantity`. **Falta** para a etiqueta: `creator_info_name`, `order_label_module`, `order_status_module`, `price_module` e `trade_order_module.shipping_fee`. O detalhe (`order/get`) hoje não é capturado.

## 2. Vendas por pedido = Finanças › Demonstrativos › Exibir por pedidos

- URL: `https://seller-br.tiktok.com/finance/bills?tab=statements&subTab=orders`. Abas: Resumo financeiro · Pagamentos · **Demonstrativos** · **Em espera** · Faturas. Sub-abas "Exibir por demonstrativos / por pedidos". Filtros: Data de criação do pedido, Data do demonstrativo (padrão ~90 dias), tipo, ID do pedido/ajuste. "Exportar" / "Exportar histórico": nunca usar.
- Tabela (10/página, `table tbody tr`): ID do pedido/ajuste (link teal + tag cinza "Pedido") · Data de criação do pedido · Data do demonstrativo · **Valor da liquidação** (`total_net_amount`) · Detalhamento da liquidação (3 grupos, texto cortado) · ID do demonstrativo · Ação (`button.p-btn-size-small` "Exibir detalhes"). Linhas de ajuste/zero têm "R$ 0" e "/".
- "Em espera" (`tab=` troca por clique, sem URL própria): pedidos ainda não liquidados, com "Tempo de liquidação estimado" (Entrega + 7 dias ou data), "Motivos de não liquidação", "Valor de liquidação estimado".
- Chave: `expression_order_id` (= `trade_order_id`) **é igual ao `main_order_id` da lista de Pedidos** (conferido: 15 de 15 pedidos presentes nas duas telas). Pedidos cancelados sem pagamento não aparecem.

## 3. APIs e campos do extrato

| Rota (POST, sem query) | Corpo | O que dá por pedido |
|---|---|---|
| `/api/oec/pay/merchant/statement/view/settled_orders` | `{size, statement_date_lower, statement_date_upper, expression_order_id?}` | liquidados: `order_records[]{expression_order_id, fund_order_id, placed_time, settlement_date, total_net_amount, simple_breakdown[] (itens 46/53/51), sku_records[]{product_name, sku_name, sku_id, quantity, simple_breakdown, sku_total_net_amount}}` |
| `/api/oec/pay/merchant/statement/view/onhold_orders` | (corpo não lido) | em espera: mesmos 3 grupos **estimados**, `estimate_settle_time`, `total_onhold_net_amount`, `sku_records[]{…, sku_total_onhold_net_amount}` |
| `/api/oec/pay/merchant/statement/view/order_breakdown` | `{breakdown_detail_type:1, settle_status:2, trade_order_id, fund_order_id}` | árvore `breakdown_info[]→sub_item_list[]` por tarifa (abaixo), `order_create_time`, `order_delivery_time`, `settlement_date` |
| `GET /api/v1/pay/statement/order/list`, `…/transaction/detail` | — | versão antiga (transações); o Copiloto usa as `view/*` |

Itens (ler sempre por `item_id`, não pelo texto; `starling_text` vem em pt-BR na tela):
`46` Vendas líquidas dos produtos (= tabela − 312) · `311` Subtotal antes dos descontos · `312` Descontos financiados pelo vendedor · `313` Reembolsos de produtos (devolução) · **`53` Custo líquido de frete** = `412` Custo do frete (negativo, ex. −152,54) + `414` Taxa de frete paga pelo cliente (+112,54) + `413` Custo de frete coberto pelo TikTok Shop (+40,00; subsídio) · **`51` Taxas e impostos** = `5065` Tarifa de comissão da plataforma + `3024` Taxas de serviço (`123` SFP, `440` Taxa por item vendido) + `3026` Comissões de afiliados (`113` criadores / `253` criadores de Shop Ads).
Exemplo real (afiliado 12%, desconto 280, liquidado): 46=569,90 · 53=0 (412 −152,54; 414 +112,54; 413 +40,00) · 51=−142,77 (5065 −34,19; SFP −34,19; item −6,00; afiliado −68,39) → líquido 427,13.
Confirmações: comissão = 6% de item 46 (pedido ≥ R$ 50; abaixo disso 10%); SFP = 6%; taxa por item R$ 6 (R$ 4 em pedidos antigos); afiliado vistos 9% e 12%; Shop Ads de criador 3% (253). O SFP vem com `item_factor_map.exemption_activity_id` (isenção/promoção do SFP). Subsídio 413 só em alguns pedidos (R$ 30, 40, 90).
- Capturado hoje pelo Copiloto: `pedidos_liq`, `pedidos_espera`, `detalhe` (tiktok-pagina.js l.48-55) com 46/53/51 + `sku_records`. Ok para a etiqueta; falta apenas casar com a lista por `expression_order_id`.

## 4. Afiliados

- Centro: `/affiliate/landing` → redireciona para `/affiliate/platform/homepage` (micro-app). Menu da API `GET /api/v1/affiliate/menu`: Colaboração aberta, Colaboração direcionada, Descobrir criadores, Gerenciar criadores, Amostras, **Insights › Desempenho/Amostras/Alcance/Vídeo**, **"Pedidos de afiliados" (`/product/order`)**.
- **Pedidos de afiliados NÃO renderizou** (tela em branco/volta para a Página inicial por URL direta e por clique; já constava no retrato de 03/10). Rotas de análise (Compass, POST `/api/v1/oec/affiliate/compass/*`) não foram chamadas. Contadores: `GET …/affiliate/backend/homepage/todo_dashboard/get`.
- Conclusão: comissão de afiliado por pedido = item 113/253 do extrato (R$ exato) + `creator_info_name` na lista (quem). A % configurada por produto = `commission_plan_info.commission_rate` ÷ 100 na lista de produtos (`/api/v1/product/local/products/list`).

## 5. Marketing / Anúncios (GMV Max, Shop Ads)

- `https://seller-br.tiktok.com/ads-creation/dashboard?mpa=1&type=product` (Painel de controle de anúncios), rotas `/oec_ads/shopping/v1/oec/stat/…` com `aadvid` na query:
  `post_campaign_list_v2` (por campanha: `cost` bruto, `billed_cost` cobrado, `onsite_roi2_shopping_sku` pedidos de SKU, `onsite_roi2_shopping_value` receita bruta, `onsite_roi2_shopping` ROI, `template_ad_roas_bid` meta de ROI), `post_product_list_v2` (por produto, dim `spu_id`), `post_overview_stat` / `post_shop_overview_stat` (totais e série por dia; `overall_onsite_order_count`).
- **Gasto atribuído por pedido: não existe.** Só por campanha/produto/dia. Para a etiqueta: ratear `billed_cost` do produto no período pelos pedidos dele e rotular "estimado". Diferença conhecida: `cost` (bruto) ≠ `billed_cost` (cobrado, pode ter crédito); usar `billed_cost`.
- O extrato NÃO traz linha de gasto de anúncio nesta conta (a "Taxa GMV Max" do guia oficial = (vendas líquidas + subsídio) ÷ ROI-alvo só aparece se a venda for paga com GMV Pay; não visto).

## 6. Campanhas, Promoções, Cupons

- Marketing › Campanhas: `/promotion/campaign-tools/all` (Registre-se / Recomendações / Gerencie / Regras de acumulação); APIs (retratos de 03/10) `parents_campaigns/list`, `recommend/list_product`, `campaign/seller/get`. Hoje a página só carregou o shell. A regra de preço é por produto (`campaign_price_range` vs `sale_price_range`), não um %.
- Marketing › Promoções: `/promotion/marketing-tools/management?tab=1` → `GET /api/v1/promotion/get_summary`, `POST /api/v1/promotion/list` — **abriu "Verifique para continuar: arraste a peça" (CAPTCHA)**; não resolvido (regra: não burlar). Sem nome/tipo das promoções ativas ao vivo. Ferramentas da loja (retrato 03/10): Oferta Relâmpago, Compre mais economize mais, Cupom, Desconto na taxa de envio, Combo etc.; todas financiadas pela loja → saem como item 312.
- Para a etiqueta a fonte útil é o **pedido** (`promotion_infos`, `seller_discount_total`), não estas telas.

## 7. O que falta e riscos

1. Nada prova Ads por pedido; Rebate não existe; Cupom/campanha só em valor. A etiqueta deve separar "fato do extrato" (comissão, SFP, frete, afiliado, desconto) de "estimado" (Ads rateado, custo informado).
2. Pedido recém-pago/"Para enviar" pode ainda não ter linha em "Em espera" (não havia pedido nesse estado para testar): sem extrato = sem margem (mostrar "aguardando extrato", não estimar).
3. Afiliado: o flag vem na lista; o R$ só depois da entrega/extrato (estimativa em espera já embute).
4. Ajustar a captura: acrescentar `creator_info_name`, `order_label_module`, `price_module`, `order_status_module` à rota `pedidos`; capturar `order/get`.
5. Telas não lidas ao vivo: Pedidos de afiliados (não renderiza), Promoções/Campanhas (CAPTCHA/shell), Cupons (idem).
