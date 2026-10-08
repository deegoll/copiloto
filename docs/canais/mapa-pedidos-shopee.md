# Shopee Brasil · mapa de PEDIDOS / RENDA / MARKETING (leitura ao vivo, 08/10/2026)

Método: Chrome de teste (perfil `copiloto-sync/chrome-teste`, porta 9222) logado, abas próprias, só leitura. Nada clicado que altere dado. Respostas medidas por `fetch`/CDP; valores de comprador não foram gravados em arquivo. Retratos anonimizados: `tests/copiloto/fixtures/shopee_pedidos_lista_2026-10-08.json` e `shopee_renda_pedido_2026-10-08.json` (`field_id` aparecem renumerados 9xx no retrato; os reais estão abaixo).

**Convenção de valores:** toda quantia nas APIs `seller.shopee.com.br` vem **multiplicada por 100000** (R$ 123,50 = `12350000`). Datas em segundos Unix.

## Resposta curta (a pergunta da dona)

Dá para saber **por pedido** a origem do custo, e quase tudo em UMA chamada por pedido: `POST /api/v4/accounting/pc/seller_income/income_detail/get_order_income_components` (body `{"order_id":<id>,"components":[2,3,4,5,6]}`). Mas só vale para pedidos com renda calculada (concluídos/liberados); pedido em andamento devolve só o lado do comprador ou `error_codes`.

| Origem | Por pedido? | Campo (field_name) | Observação |
|---|---|---|---|
| Comissão Shopee | sim | `COMMISSION_FEE` (líquida) e filho `COMMISSION_FEE_BREAKDOWN_ORIGINAL_VALUE` (bruta) | ~10–12% do preço do produto nas amostras |
| Taxa de serviço | sim | `SERVICE_FEE` (líquida) | 2–19% nas amostras (varia; não é % fixo) |
| Frete | sim | `SHIPPING_FEE_PAID_BY_BUYER`, `ACTUAL_SHIPPING_FEE` (negativo), `SHIPPING_REBATE_FROM_SHOPEE` (positivo) | frete líquido do vendedor = soma dos três |
| Desconto/ação de campanha, REBATE | sim, indireto | `COMMISSION_FEE_BREAKDOWN_SELLER_BORNE_REBATE_VALUE` ("Ajuste por participação em ação comercial", positivo) | é o abatimento de comissão por estar em campanha/ação comercial. Em 20 de 38 pedidos com comissão. **Não diz QUAL campanha.** |
| Cupom Shopee | sim | comprador: `SHOPEE_VOUCHER_DISCOUNT`; vendedor: `VOUCHER_DISCOUNT_FROM_SHOPEE` (dentro de MERCHANDISE_SUBTOTAL) e `REBATE_AND_VOUCHER > REMAINING_VOUCHER_DISCOUNT_FROM_SHOPEE` ("Incentivo de cupom") | cupom Shopee é bancado pela Shopee e devolvido ao vendedor |
| Cupom do vendedor | sim | comprador: `SELLER_VOUCHER_DISCOUNT` | apareceu em 1 de 40 pedidos (campo existe sempre, vale 0 quando não há) |
| Moedas Shopee | sim | comprador: `SHOPEE_COINS_REDEEMED` (caption "N moedas") | bancado pela Shopee nas amostras (a renda do vendedor não tem linha própria de moedas) |
| Desconto Pix | sim | `PIX_DISCOUNT` (comprador e dentro de MERCHANDISE_SUBTOTAL do vendedor) | reduz a renda do vendedor |
| **Afiliado** | **sim** | **`AMS_COMMISSION_FEE`** ("Taxa de comissão Afiliados do Vendedor"), dentro de `FEES_AND_CHARGES` | 6 de 40 pedidos; taxa 1,5%–5,27% do valor do item. Detalhe (quem, campanha, tipo): `GET /api/v3/affiliateplatform/conversion/report/list` (casa por `order_id` = order_sn). |
| **Ads** | **parcial** | **`ADS_ESCROW_TOP_UP_FEE`** ("Taxa da Recarga Automática (Pedido)") | 36 de 40 pedidos, sempre **2,00% de `PRODUCT_PRICE`**. É recarga automática do saldo de Ads descontada do pedido, **não** o gasto do clique que gerou a venda. Gasto real de Ads existe só por campanha/produto (ver Ads). |
| Reembolso | sim | `REFUND_AMOUNT` (pedido 100% reembolsado: renda 0) | |
| Acréscimo no cartão (comprador) | sim | comprador: `BUYER_TRANSACTION_FEE` | pago pelo comprador |
| **Campanha / promoção que gerou a venda** | **não encontrado** | — | Nenhum campo do pedido nomeia a campanha, a promoção de desconto do vendedor, a oferta relâmpago ou o "Minha Promoção". Só dá para inferir: preço pago × preço original do produto (lista de produtos tem selo "Minha Promoção"), e `add_on_deal_id`/`bundle_deal_id` (combo/compre junto) no `get_one_order`. Afiliado tem `campaign_type` e `internal_source` no relatório de conversão. |

Cálculo conferido (pedido real, valores em R$): produto 123,50 − Pix 6,17 = subtotal 117,33; frete 0 (comprador) −15,69 +15,69 (rebate); comissão líquida −12,86 (bruta −15,56 + ação comercial +2,70); serviço −18,26; **renda do pedido 86,21** = 117,33 − 12,86 − 18,26 − 0. Bate com `ESCROW_AMOUNT`.

Margem final sugerida: `ESCROW_AMOUNT` (já líquido de comissão, serviço, frete, afiliado, Ads-recarga, cupom/Pix) − custo do produto × qtd − imposto % − custo extra do vendedor. Atenção: o gasto de Ads por clique NÃO está dentro do `ESCROW_AMOUNT`; a recarga de 2% está.

## 1. Meus Pedidos (lista)

URL: `https://seller.shopee.com.br/portal/sale/order` (abas por `?type=` : `completed`, `toship`, `shipping`, `unpaid`…; a aba Concluído é `?type=completed`).

### APIs da lista (POST, JSON, cookie de sessão)
1. `/api/v3/order/search_order_list_index` — body `{"order_list_tab":500,"entity_type":1,"pagination":{"from_page_number":1,"page_number":1,"page_size":40},"filter":{...}}` → `data.index_list[{order_id,shop_id,region_id}]`, `data.pagination.total`. `order_list_tab`: 500 = Todos (os outros números por aba; ver `get_order_list_meta_v2`).
2. `/api/v3/order/get_order_list_card_list` — body `{"order_list_tab":500,"need_count_down_desc":true,"order_param_list":[{order_id,shop_id,region_id}×5]}` (a página pede 5 pedidos por vez) → `data.card_list[]`. Cada item é `order_card` (pedido normal) **ou** `package_level_order_card.package_list[]` (pedido dividido em pacotes). Campos úteis:
   - `…card_header.order_sn` (ex.: `261005TENXFJXK`, 14 car.), `…buyer_info.username` (pessoal; não gravar).
   - `…item_info_group.item_info_list[].item_list[]`: `name`, `image`, `description` (**texto "Variação: <nome> [<SKU pai> <SKU variação>]"** — o que está entre colchetes são os SKUs; com um token só, é o SKU do produto sem variação), `amount` (quantidade), `inner_item_ext_info{item_id,model_id}`, `is_wholesale`; `item_ext_info.is_bundle`.
   - `…payment_info{currency,total_price,payment_method}`: `total_price` = **"Preço pago pelo comprador"** (×100000), não é a renda do vendedor. Não há preço unitário na lista.
   - `…status_info{status ("A Enviar","Enviado","Pedido Recebido","Cancelado","Não pago"), status_description, status_tag{tag_value,"Para enviar em N horas"}}`.
   - `…fulfilment_info{fulfilment_channel_name ("Shopee Xpress"), tracking_number_list}`; `package_ext_info{package_number,consignment_no,…}`.
   - `…order_ext_info{order_id,ship_by_date,buyer_user_id,fulfilled_by_shopee,can_partial_cancel,seller_address{…}}` (`seller_address` e `buyer_*` são pessoais).
3. Auxiliares: `get_order_list_buttons`, `get_order_arrange_shipment_info`, `get_order_list_meta_v2` (contagem por aba), `get_order_list_config`.

**A lista não traz comissão, taxa, frete, cupom, afiliado nem Ads.** Isso só vem do `get_order_income_components` (um por pedido; a própria tela de detalhe chama 3–4 vezes com `components` diferentes: `[5]`, `[3]`, `[2,3,4]`, `[2,6]`; `[2,3,4,5,6]` numa chamada devolve tudo). Medido: 40 pedidos seguidos sem erro, sem bloqueio.

### DOM da lista (Vue + EDS, medido em 1500 px)
- Contêiner da lista: `.order-list-table-all` > `.table-body-wrapper` > **`a.order-card[data-testid="order-item"]`** (40 por página; `href="/portal/sale/order/<order_id>"`, o `order_id` interno, **não** o order_sn).
- Dentro de cada `a.order-card` (todos os seletores estáveis, existem em todas as 40 linhas):
  - cabeçalho `.order-card-header[data-testid="order-card-header"]` (altura 40, fundo cinza claro): esquerda `.left > .buyer-info (.buyer-username)`, direita `.right > .order-identifiers > span.order-sn` (texto "ID do Pedido 261005TENXFJXK") e **`.right-suffix` vazio (0×0): ponto de inserção livre à direita do cabeçalho**.
  - corpo `.order-card-body` (padding 16): por pacote `.package-of-package-level-order-card > .eds-row` com 5 colunas `eds-col`: `.item-infos-col` (8/24), `.payment-info-col` (3/24), `.status-info-col` (5/24), `.fulfillment-info-col` (4/24), `.actions-col` (4/24).
  - itens: `.order-item-infos[data-testid="order-item-infos"] .item` > `.item-inner` > `img.item-image` (56×56), `.item-name` (negrito 500, 2 linhas), `.item-description` ("Variação: …  [SKU]", 12 px cinza), `.item-amount` ("x1"). Pedido com vários itens: vários `.item` dentro de `.item-list` (classe `order-item-infos-many-items` aparece em todos).
  - pagamento: `.order-payment-info[data-testid="order-payment-info"]` > `.total-price` ("R$97,12", 14 px, #333) e `.payment-method` ("Credit Card"/"Pix", 12 px).
  - status: `.order-status-info-v2 > .order-status > .status-tag (.eds-tag warn/error) + .status-wrapper > span.status` e `.status-description`.
  - envio: `.order-fulfilment-info[data-testid="order-fulfilment-info"] .fulfilment-channel-name`.
- **Onde caberia a etiqueta de margem sem quebrar o layout:** (1) preferida: dentro de `.order-payment-info`, como terceira linha logo abaixo de `.payment-method` — a coluna tem 128 px de largura e 35 px de altura, enquanto a linha do pedido tem ≥ 71 px (a coluna de status é a mais alta), então 1 linha de 12 px (≈ 16 px) não aumenta a altura do cartão; (2) alternativa: `.order-card-header .right-suffix` (vazio, à direita do ID do pedido, fundo cinza de 40 px de altura, mesma região onde a Shopee põe tags). Evitar a `.item-text-info` (já tem 2 linhas de nome + variação e largura fixa 276 px). A página é SPA com virtualização leve: observar `.table-body-wrapper` com MutationObserver e reaplicar quando a aba/página muda; ordenar por `data-testid` não ajuda (o `href` é a chave: guardar `order_id` do `href`).
- Cuidado: pedido dividido em pacotes tem DOM `package-list-of-package-level-order-card` com 1+ `.package-of-package-level-order-card` dentro do mesmo `a.order-card`; o `.total-price` aparece por pacote.

### Detalhe do pedido
URL: `https://seller.shopee.com.br/portal/sale/order/<order_id>`. APIs: `get_one_order` (`GET ?order_id=`; `order_items[]{order_price,item_model{sku},product{sku},amount,add_on_deal_id,bundle_deal_id}`, `price_before_discount`, `buyer_*` pessoais), `get_package`, `get_forder_logistics`, `get_logistics_tracking_history`, `get_order_tracking_history`, `get_order_detail_page_buttons`, `get_invoice_status`, e os `get_order_income_components`. DOM: cartão `[data-testid="odp-order-payment"]` ("Informações de Pagamento": N°, Produto(s), Preço da unidade, Quantidade, Subtotal; "Ajuste no pedido"; "Valor final"; "Pagamento do comprador"; link "Visualizar histórico de transações" que abre o detalhamento de renda). `is_affiliated_shop_order` aqui é flag de loja SIP, **não** é venda de afiliado.

## 2. Minha Renda

- `https://seller.shopee.com.br/portal/finance/income` e `/portal/finance/income/overview` ("Detalhes da transação"): **exigem a SENHA DE LOGIN** (modal "Para a sua segurança, digite a sua SENHA DE LOGIN"; `POST /api/v1/check_pass_and_cache/` devolve 400). Não digitei. A visão geral renderiza vazia ("Erro. Tente novamente mais tarde.") e a listagem de transações não foi lida.
- Funciona sem a senha (mesma sessão): `GET /api/v4/accounting/pc/seller_income/income_overview/get_income_overviews` → `list:[{type,amount}]×4` (tipos 6,7,8,9 = totais da visão geral; ×100000). `get_cnpj_list_by_shop_id`. O bundle da tela cita ainda `income_overview/get_income_detail` (POST, lista de transações), `get_available_payout_detail_list`, `income_report/*` e `fee_calculator/simulate_fees_and_profits`; **não testados** (parâmetros não conhecidos; a lista de transações provavelmente passa pela senha).
- A renda **por pedido** NÃO depende da senha: `get_order_income_components` (acima) responde normalmente.

Estrutura da resposta de `get_order_income_components` (`data`):
- `order_info{order_id,order_sn,released_time,source ("Shopee Wallet"),status,shipping_carrier}`.
- `seller_income_breakdown.breakdown[]` (árvore `field_id/field_name/display_name/amount/sub_breakdown[]`): `1 MERCHANDISE_SUBTOTAL` (filhos `2 PRODUCT_PRICE`, `3 REFUND_AMOUNT`, `5 PIX_DISCOUNT`, `7 VOUCHER_DISCOUNT_FROM_SHOPEE`), `50 SHIPPING_SUBTOTAL` (`51 SHIPPING_FEE_PAID_BY_BUYER`, `52 ACTUAL_SHIPPING_FEE`, `54 SHIPPING_REBATE_FROM_SHOPEE`), `100 REBATE_AND_VOUCHER` (`110 REMAINING_VOUCHER_DISCOUNT_FROM_SHOPEE`), `150 FEES_AND_CHARGES` (`151 COMMISSION_FEE` com `181 …ORIGINAL_VALUE` e `182 …SELLER_BORNE_REBATE_VALUE`; `154 SERVICE_FEE`; `166 AMS_COMMISSION_FEE`; `184 ADS_ESCROW_TOP_UP_FEE`), `250 ESCROW_AMOUNT` (renda do pedido). Cada linha pode ter `ext_info` (regras de comissão/serviço: `commission_fee_infos`, `service_fee_infos`, `service_fee_rebate`) e `caption`.
- `buyer_payment_breakdown.breakdown[]`: `1 MERCHANDISE_SUBTOTAL`, `3 SHIPPING_FEE`, `5 SHOPEE_VOUCHER_DISCOUNT`, `6 SELLER_VOUCHER_DISCOUNT`, `7 SHOPEE_COINS_REDEEMED`, `10 BUYER_TRANSACTION_FEE`, `26 PIX_DISCOUNT`, `100 BUYER_PAID_AMOUNT`.
- `order_item_list.order_items[]{item_id,model_id,price,amount,subtotal,product_name,product_sku,model_name,model_sku,returned_qty,cancelled_qty,bundle_item_price}`. Aqui o **SKU** vem separado (`model_sku` = SKU da variação; `product_sku` = SKU pai).
- `adjustment_info{total_adjustment_amount,amount_after_adjustment,components[]}` (ajustes pós-conclusão).
- Campos aparecem/somem conforme o pedido (campo ausente = não se aplica, não zero). O ids numéricos de `field_id` colidem entre vendedor e comprador (ex.: 5 = PIX no vendedor, SHOPEE_VOUCHER no comprador): **casar sempre por `field_name`**.
- Em pedido ainda não liberado a árvore do vendedor pode vir ausente e `error_codes` preenchido; a tela de renda por pedido não deve inventar zero.

## 3. Marketing (só leitura)

### Shopee Ads — `/portal/marketing/pas/index`
APIs (`/api/pas/v1/…`, POST/GET): `report/get/` (corpo `{filter_params:{campaign_id},start_time,end_time,agg_type:"product_gms",campaign_type:"product_gms",need_ratio,use_paid_gmv}`) → `data[].metrics{cost, broad_gmv, direct_gmv, broad_order, direct_order, broad_roi, direct_roi, impression, click, cpc, ctr, cr, voucher_amount,…}`; `report/get_time_graph/` (série por dia/hora); `product/gms/list_item_product_performance/` (**por produto**: `result_list[{item_id,name,report{cost,direct_gmv,direct_order,roi,…}}]`, paginado por token); `homepage/query` (campanhas); `wallet/get/` (saldo de créditos); `topup/auto_escrow/get_setting/` (recarga automática; `additional_fee.value 2000` = 2,000%, bate com a taxa por pedido); `rebate/get_overview/`. Medido no período padrão da tela (intervalo do URL): custo ≈ R$ 219,82 para ≈ R$ 4.563,80 de GMV direto e 26 pedidos diretos.
**Ads por pedido: não.** O gasto é por campanha e por produto (`item_id`) e por dia; não há `order_sn` nem custo por pedido. Para rateio por pedido use custo do item ÷ pedidos diretos do item no período, rotulado como estimativa; a única linha por pedido é a recarga de 2% (`ADS_ESCROW_TOP_UP_FEE`).

### Afiliados do Vendedor — `/portal/web-seller-affiliate/*`
Relatório de pedidos: `/portal/web-seller-affiliate/conversion_report` ("Conversão de Pedidos": Detalhes do pedido, Informação do item, Informação do afiliado, Tipo de campanha do vendedor; filtros por ID do pedido, afiliado, produto, categoria, status).
API: `GET /api/v3/affiliateplatform/conversion/report/list?page_num=1&page_size=20&purchase_time_s=<unix>&purchase_time_e=<unix>` → `data{total_count,list[]}`. Por linha: `order_id` (**= order_sn**, 14 car.), `order_status` (PAID/COMPLETED), `purchase_time`, `affiliate_id`/`display_name` (pessoal-ish), `internal_source` ("Shopeevideo"…), `brand_after_fraud_commission` (comissão em R$ ×100000), `items[]{item_id,model_id,qty,item_price,actual_amount,refunded_amount,capped_brand_commission,brand_commission_rate ("5000" = 5%),campaign_type,order_attribution_type,expense,ams_deduction_status,global_category_*}`. Total de 39 conversões em 30 dias nesta loja. Outras APIs da área: `/api/v3/affiliateplatform/gql` (GraphQL: `GetHomepageWidget` = vendas/ROI do programa), `commissions/category_setting`, `dashboard/latest_report_date`.
**Por pedido: sim**, de duas formas que concordam: custo `AMS_COMMISSION_FEE` na renda do pedido e a linha do relatório de conversão (taxa e tipo de campanha). Pedidos `PAID` ainda não liberados já têm a conversão (comissão prevista), mas ainda não têm `AMS_COMMISSION_FEE`.

### Cupons — `/portal/marketing/vouchers/list`
`GET /api/marketing/v3/voucher/list/?offset=0&limit=10&promotion_type=0` → `voucher_list[{voucher_id,name,start_time,end_time,discount,value,min_price,use_type,current_usage,usage_limit,claim_quantity,usage_quantity,rule{is_seller_absorbed,fund_rule{fund_type,seller_party,shopee_party},is_cofund_campaign_voucher,…}}]`; `voucher/promotion_tool/metrics/?tool_name=marketing_voucher` → `buyers, sales, units, used, usage_rate` agregados. **Por pedido: não** (o pedido só traz o VALOR do cupom, não o `voucher_id`).

### Campanha — `/portal/marketing/cmt/campaign`
`/api/mkt/cmt/get_landing_page_campaign_list` e `…_count` (campanhas da Shopee: `name,start_time,end_time,status,nomination_statistics,campaign_tier,co_fund_rule`), `all_campaign_tiers`, `commonscene/get_shop_metric`. Sem ligação com pedido.

### Desconto — `/portal/marketing/list/discount`
`GET /api/marketing/v3/public/discount/list/` (`discounts[{discount_type,seller_discount{discount_id,name,time_status,start_time,end_time,item_preview{item_count}}}]`), `…/discount/metrics/` (`sales, orders, units, buyers` agregados do período). Sem ligação com pedido.

### Oferta Relâmpago da Loja — `/portal/marketing/shop-flash-sale/list`
`GET /api/marketing/v4/shop_flash_sale/get_shop_flash_sale_list/?offset=0&limit=10&type=0` (`flash_sale_list[{flash_sale_id,start_time,end_time,status,item_count,enabled_item_count}]`), `report_shop_flash_sale/` (`click_cnt`), `get_promotion_tool_metrics/?tool_name=marketing_shop_flash_sale` (`sales,orders,units,buyers`). Sem ligação com pedido.

## 4. Lacunas e limites declarados
- Minha Renda (lista de transações) exige senha: não lida; só o resumo (`get_income_overviews`) e a renda por pedido.
- Pedido ↔ campanha/promoção do vendedor: **não encontrado** (nenhum campo). Rebate de comissão por ação comercial existe, sem nome da campanha.
- Pedido ↔ cupom específico: só o valor; sem `voucher_id`.
- Ads por pedido: não; só recarga de 2% por pedido e gasto por campanha/produto.
- Moedas Shopee: aparece só do lado do comprador (`SHOPEE_COINS_REDEEMED`); não encontrei linha de custo para o vendedor (a renda parece não descontá-las).
- Custo por pedido exige 1 requisição por pedido (40 pedidos = 40 chamadas; a amostra de 40 em sequência não foi bloqueada, tempo não medido). Sugestão: buscar só os pedidos visíveis, em fila com no máx. 3 simultâneas e cache por `order_id` (renda de pedido liberado não muda; só `adjustment_info` pode mudar).
- Amostra de 40 pedidos concluídos; pedidos cancelados/devolvidos e pedidos Full/SBS não foram exercitados.
