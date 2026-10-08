# Mapa de PEDIDOS e VENDAS · Portal do Seller Magalu · lido ao vivo em 08/10/2026

Conta de teste, só leitura (nada clicado que altere dado). Valores em R$; nenhum dado de comprador aqui. Complementa `magalu.md` (docs oficiais) e as fixtures `wt-retratos/tests/copiloto/fixtures/magalu_*_2026-10-07.json`.

## Resposta curta
- **Margem por pedido dá para fazer com dado REAL**, sem estimar: a tela de pagamento do pedido (`/pedidos/{pedido}/{sub}/pagamento`, link "Ver cálculo de repasse e comissão") traz comissão (Serviços de Marketplace 11,0%), MDR, tarifa fixa, coparticipação de frete e "Valor líquido estimado a receber". Origem: `order-3p-api.magalu.com`.
- **Desconto por pedido: sim, com tipo e quem paga** (`amounts.discounts[]`: `cash_payment` = Desconto à vista, `promocode` = cupom, `loyalty` = Clube da Lu/Cliente Ouro; cada um com `shared` canal x vendedor).
- **Afiliado, Magalu Ads, campanha/promoção (PAS, Preço Promocional), rebate: NÃO ENCONTRADO por pedido.** Só existem agregados (Ads por campanha, promoções por SKU). Ver seção final.

## 1. Pedidos · `https://seller.magalu.com/pedidos`
Lista "Gestão de pedidos", últimos 30 dias, "Total de vendas" (Hoje/7 dias/Mês atual) no topo. Sem abas de status: o filtro é o painel lateral "Filtrar por" (Período, Status do pacote, Tipo de entrega, Status da nota fiscal, Status da etiqueta, Canal de Venda, Tipo de pacote, Pacotes para despacho). Nenhum filtro de afiliado/campanha/cupom.

### DOM do cartão (estável)
- Cartão: `[data-testid=order-list-item]` (classe sem hash `order-list-item`, 10 por página). Dentro: `.MuiPaper` (caixa branca) com colunas:
  - cabeçalho: `[data-testid=go-to-order-btn]` (link; texto "dd/mm/aaaa às hh:mm | LU-<nº do pedido>"; o nº sem "LU-" é o `order.external_id`), chips da filial ("#298: ...") e do canal ("Magazine Luiza");
  - `.order-list-item-simple-info`: 1º `<p>` = nome do comprador (não ler), 2º `<p>` = **"R$ 314,89 - 1 item"** (total do pacote, quantidade de itens), links `[data-testid=send-message]` e `call-btn`, botão `[data-testid=expand-btn]`;
  - `.order-list-item-delivery-info`: modalidade ("Agência Magalu"), "Despachado em", "Entregar até";
  - `.order-list-item-status`: pill de status ("Despachado") + texto + link de rastreio;
  - `.order-list-item-action-button`: menu `[data-testid=icon-button][aria-label=menu]` (não abrir: tem ações).
- **Expandido** (`[data-testid=expanded-content]`, sem chamada de rede nova, dados já vieram da lista): tabela `Itens | Preço un. | Frete | Desconto | Total`; linha `[data-testid=package-item-row]` com células `td.unity-price`, `td.freight`, `td.discount`, `td.total`, nome em `span.compact.name` (com `span.highlightBlue` = "1x" quantidade), SKU em `[data-testid=sku-info]` ("SKU XXX") dentro de `[data-testid=tax-fields-row]`. Bloco "Cálculo para emissão da NF-e" (`.label`/`.value`): Total dos Produtos, Frete Total, Desconto Total, Total do Pacote.
- **Onde a etiqueta de margem cabe:** (a) no cartão fechado, logo abaixo do `<p>` "R$ ... - N item" (inserir `div` depois desse `p`, igual ao que a prévia faz na lista de produtos); (b) no expandido, uma linha extra no bloco "Cálculo para emissão da NF-e" ou depois de `[data-testid=sku-info]` por item. Chave para casar: nº do pedido do `go-to-order-btn`. Ressalva: a lista só mostra preço, frete e desconto; comissão/tarifa só existem na tela de pagamento (seção 2), então a etiqueta da lista precisa ler a API (abaixo) ou usar estimativa marcada.

### API da lista (sem query)
`GET https://magalu-sellers.magalu.com/ps-core-order/api/v0/packages` (params: `purchased_at__gte/__lte`, `_limit` (máx. 1200), `_offset`, `delivery_type_priority`) e `.../packages/count`. Cabeçalhos exigidos: `authorization`, `x-channel-id`, `x-tenant-id`, `x-format`. Um `fetch` com só cookie para `order-3p-api` falhou no teste (precisa do mesmo token do app); a extensão deve **ler a resposta que a própria página já pede**, não chamar sozinha.

Campos por item (`results[].items[]`): `quantity`, `product.price` (unitário), `discount` (soma dos descontos), `freight`, `total`, `fee.total`, `fee.sub_total`, `fee.tech_total`, `product.seller_sku`. Do pacote: `shipping.amount` (frete), `shipping.carrier_description` ("Magalu Entregas"/"FRETE PROPRIO 1"), `shipping.additional_fields.meta.fee_freight`, `additional_fields.shared_freight_status` ("Em apuração", "Entregue", "Não se aplica"), `additional_fields.shared_freight_entry_type` ("Cobrança de Coparticipação"), `status.external_id`, `source_channel.description`, `package_identifiers.keys[]` (nomes: label_status, weight_class, customer_name, delivery_type, invoice_status, customer_document, posting_situation, deadline_situation, total, source_channel).

### O que cada campo significa (conferido em 10 pedidos)
- `item.total` = `product.price` − `discount` + `freight` (ex.: 349,99 − 70,00 + 34,90 = 314,89). É o que o cliente pagou, **não** o que o vendedor recebe.
- `fee.total` da lista = Uso de Plataforma + Serviços de Tecnologia + MDR da tela de pagamento (ex.: 3,05 + 9,17 + 2,72 = 14,94). **Não inclui a tarifa fixa de R$ 5,00 por item** nem a coparticipação de frete.
- `fee.sub_total` = base de cálculo parcial; em pedidos sem desconto do vendedor é igual ao preço; com desconto não bateu com preço − desconto em todos os casos (ex.: 349,99 com desconto de 70,00 deu 297,49). **Use a base da tela de pagamento ("Valor base para cálculo"), não `fee.sub_total`.**
- Taxa efetiva vista: 11,0% sobre a base na conta de teste (modo "Receber Parcelado"); no modo antecipado a tabela da conta mostra 14,20% (`financial-infos`).

## 2. Pagamento do pedido · `/pedidos/{pedido}/{sub-pedido}/pagamento` (o dado que importa)
Abre pelo link "Ver cálculo de repasse e comissão" no detalhe do pedido (`/pedidos/{pedido}/{sub-pedido}`; detalhe também mostra dados do comprador, NF-e e histórico: não ler). Mostra, na ordem: Valor total dos itens, Valor do frete, Juros, Descontos, **Valor total pago pelo cliente**; **Serviços de Marketplace (11,0%)** = Serviços de Intermediação + MDR + Serviços de Tecnologia; "Valor base para cálculo"; Tarifas > **Tarifa fixa** (por item); Outros eventos: **Coparticipação de frete**, "Valor pago pelo Magalu/por você (Desconto à vista)", "(Subsídio de Cupom)"; **Valor líquido estimado a receber**; forma de pagamento, parcelas e previsão.

Exemplo conferido (pedido entregue, à vista, Pix): itens 139,99; desconto 7,00 (Magalu 2,80 + vendedor 4,20); base 135,79; marketplace −14,94 (11%); tarifa fixa −5,00; coparticipação de frete −25,45; **líquido estimado 90,40** = 135,79 − 14,94 − 5,00 − 25,45. Outro (10x no cartão, Clube da Lu 19,95 pago pelo vendedor): base 379,05, taxas 41,70 (11%), tarifa fixa 5,00, líquido a receber (sellerpayable) 332,35, coparticipação de frete 27,45 à parte.

APIs (host `order-3p-api.magalu.com`, id = nº do pedido sem "LU-"; todas GET, só leitura):
| Endpoint | Campos úteis |
|---|---|
| `/api/v1/service-fees/{pedido}` | `calculated_fees[]`: `type` (`service_fee` = Uso de Plataforma, `service_fee_tech` = Serviços de tecnologia, `mdr_fee` = MDR, `fixed_rate__{item}` = tarifa fixa, R$ 5,00 "DEFAULT"), `value`, `fee_reference_amount` (base), `fee_reference_percentage` |
| `/api/v1/sellerpayable/{pedido}` | `net_value`, `status`, `transactions[].payable_model` ("Recebimento à vista"/"à prazo"), `payables[]` com `amount`, `payment_date`, `status` (paid/scheduled), `anticipated`, `anticipation_fee` |
| `/api/v1/orders/{pedido}` | `amounts.discounts[]`, `amounts.marketplace_shared_freight`, `amounts.seller_shared_freight`, `amounts.net_amount`, `payment.methods[]` (`method`, `installments.number`) |
| `/api/v1/validation/order-dre-display?external_id=` | `dre_available` (boolean; só mostrar se true) |
O detalhe também usa `GET magalu-sellers.magalu.com/ps-core-order/api/v0/orders/{pedido}` (mesmo conteúdo de `amounts`, `freight_detail.shared[]` por item).

### Campos de custo, por tipo
| Custo | Onde | Campo |
|---|---|---|
| Comissão (marketplace 11%) | pagamento / service-fees | soma de `service_fee`+`service_fee_tech` (+`mdr_fee`); lista: `fee.total` inclui MDR |
| Taxa fixa | service-fees | `fixed_rate__*` = R$ 5,00 por item (não aparece na lista) |
| MDR | service-fees | `mdr_fee` (≈2,0% da base) |
| Frete (Magalu Entregas) | pedido | `shipping.amount` (frete cobrado do cliente); parte do vendedor = `amounts.seller_shared_freight` / `freight_detail.shared[type=seller_freight_share]`; parte do Magalu = `marketplace_shared_freight`; cobrança vira "Coparticipação de frete" |
| Desconto | pedido | `amounts.discounts[]` com `type`, `total`, `shared[]` |
| Antecipação | sellerpayable | `anticipation_fee` (0,00 nos testados) |

## 3. Tipos de desconto vistos por pedido (`amounts.discounts[].type`)
- `cash_payment` "Desconto à vista" (Pix): `shared` = `cash_payment_channel_share` (Magalu) e `cash_payment_seller_share` (vendedor); proporção variou (40/60 em alguns, 0/100 em outros).
- `promocode` "Promocode: <CÓDIGO>" (**é o cupom**; o código aparece na descrição, ex. um código de campanha): `promocode_channel_share` / `promocode_seller_share`; nos casos vistos 100% do vendedor.
- `loyalty` "Fidelizacao: Clube da Lu" (Cliente Ouro): `loyalty_channel_share` / `loyalty_seller_share`; 100% do vendedor.
- Promoção "Preço Promocional" (`absolute_discount`): não observada como linha de desconto no pedido (o preço do pedido já vem reduzido); **não encontrado** como campo.
Na lista só vem `item.discount` somado; o tipo exige o detalhe/`orders/{id}`.

## 4. Vendas/Desempenho · `/desempenho`
Indicadores da loja (Vendas, Pedidos, Itens vendidos, Cancelados, Ticket médio, Visitas, % frete grátis, Conversão), período com comparação. Tabela por SKU ("Catálogo dos produtos"): `GET magalu-sellers.magalu.com/ps-lebron-bi/api/pricing/indicators/sku` (params `channel,org,start_date,end_date,page,per_page,sort`) com `sku, sales_total, items_sold, completed_orders, cancelled_orders, visit_qty, conversion_rate, rank, url`. Filtro `.../pricing/filters`. Não há custo, comissão nem margem aqui.

## 5. Financeiro · `/financeiro`
"Condições comerciais": modo de repasse atual ("Receber Parcelado"), periodicidade, dados bancários, e tabela **Remuneração por categoria** (Porcentagem + parcelas autorizadas; conta de teste: 11,00% parcelado, 14,20% antecipado, 86 linhas) = `GET magalu-sellers.magalu.com/ps-financial/api/v1/seller/financial-infos` (`agreements[commission].fees_type[category].fees[]` com `value`, `auto_anticipate`, `metadata.max_installment`) e `/seller/account`. Extrato/lançamentos: rotas `/financeiro/extrato`, `/extrato`, `/financeiro/lancamentos`, `/financeiro/historico`, `/relatorios` dão "página não existe"; **extrato por lançamento: não encontrado** (o equivalente por pedido é a tela de pagamento da seção 2).

## 6. Promocional · `/promocional`
Lista de promoções disponíveis ("Participando", "Criadas"). `GET magalu-sellers.magalu.com/ps-promo3p-api-core/v1/promotions` (`id, name, start_date, end_date, status, sku_selection, skus_count, benefits[]{type, value, subsidy{type,sponsor,value}}, tags`) e `/v1/channels/magalu` (regras do canal). Tipos: `fidelity_discount` (Cliente Ouro 5/10/15%), `absolute_discount` (Preço Promocional / PAS, "De 1 a 60%", "0% Nós investimos"), `percentage_discount` (Desconto à vista, "5% OFF no Pix"), `coupon_discount` (Cupom 5/10/15%), `freight_discount`. `subsidy` = quem financia (nos casos vistos `none`, vendedor investe). É por promoção/SKU, **não por pedido**.

## 7. Magalu Ads · `/sso-magalu-ads` → `/magalu-ads` (host `ads-portal-front.magalu.com`)
Saldo, consumo, vendas, ROAS, cliques, CTR, impressões e tabela de campanhas (CPC, orçamento, consumo, % consumido, ROAS, vendas). APIs: `/campaign/api/get-campaign/magazineluiza/campaigns/summarized/vendors/{vendedor}` (`budget, status, report{impressions,clicks,purchases,roas,acos,ctr,cvr,cpc}`), `/campaign/api/reports/publishers/magazineluiza/vendors/{vendedor}/chart-metrics` (`adSpent, purchases, roas, sellAmount`), `/financial/api/balance/...`. Agregado por campanha/dia. **Vínculo venda-pedido: não encontrado.**

## O que NÃO foi encontrado por pedido
| Origem da venda | Resultado |
|---|---|
| Afiliado | **Não encontrado.** Nenhum campo nos pacotes, no pedido, no pagamento nem filtro. Só `source_channel` ("Magazine Luiza"; o filtro "Canal de Venda" existe, outros valores não vistos). |
| Magalu Ads | **Não encontrado por pedido.** Ads só dá consumo e vendas por campanha/dia. Conta de teste: vendas atribuídas R$ 0,00 no período. Custo de Ads = gasto do dia/campanha rateado ou informado à mão. |
| Campanha / promoção (PAS, Preço Promocional) | **Não encontrado por pedido.** Só se vê o efeito no preço; promoção é por SKU/período. |
| Cupom | **Encontrado**: `discounts[].type = promocode`, código na descrição; pago por canal/vendedor em `shared`. |
| Cliente Ouro / Clube da Lu | **Encontrado**: `type = loyalty`. |
| Desconto à vista | **Encontrado**: `type = cash_payment`. |
| Rebate | **Não encontrado** em nenhuma tela lida. |
| Frete subsidiado | **Encontrado**: `marketplace_shared_freight` x `seller_shared_freight` (coparticipação, "Em apuração" até a entrega). |

## Fórmula sugerida ("Sobra do pedido")
`sobra = líquido estimado a receber (tela de pagamento) − custo do produto × quantidade − imposto (% do Copiloto) − custo extra informado − gasto de Ads rateado (informado)`. Se só a lista estiver disponível: `base = preço − desconto do vendedor`; `taxas ≈ fee.total` + R$ 5,00 por item; frete do vendedor = `freight` não coberto pelo cliente (só confirmado na tela de pagamento) — marcar "estimado". Pedido cancelado: não calcular.

## Observações de coleta
`/pedidos` carrega lento (microfrontend, 10-25 s) e às vezes cai em `/expired-password`; clicar só em "Lembre-me depois". Um modal "Melhoria" aparece no detalhe (fechar no X). Retratos anonimizados novos: não gerados (HAR bruto apagado).
