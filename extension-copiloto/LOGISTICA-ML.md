# Logística no Mercado Livre — regras que o Copiloto usa

Pesquisa feita em 30/09/2026. As páginas oficiais do ML (developers.mercadolivre.com.br, mercadolivre.com.br/ajuda e
vendedores.mercadolivre.com.br) responderam **403** para leitura direta; o texto oficial dos developers veio pelo índice
context7 (`/websites/developers_mercadolivre_br_pt_br`) e a Central de Ajuda pelo resumo da busca. Tudo que não foi lido
na fonte oficial está marcado **A CONFIRMAR**.

Legenda: ✅ = texto oficial lido · ⚠️ = A CONFIRMAR (fonte secundária ou resumo de busca).

## 1. Modalidades

| Código no ML | Nome na tela | Quem faz a logística | Quem paga o frete | Fonte |
|---|---|---|---|---|
| `me2` | Mercado Envios | o ML (etiqueta e rastreio do ML) | comprador ou vendedor (frete grátis); o vendedor paga parte conforme a reputação | ✅ developers › Gestão Mercado Envios; ✅ Mercado Envios 2 |
| `me2` + `logistic_type: cross_docking` | Coleta | o ML busca no depósito | idem ME2 | ✅ developers › Gestão Mercado Envios |
| `me2` + `xd_drop_off` | Agências (Places) | o vendedor leva à agência | idem ME2 | ✅ idem |
| `me2` + `drop_off` | Correios | o vendedor leva ao correio | idem ME2 | ✅ idem |
| `me2` + `self_service` | Flex | o vendedor entrega (mesmo dia) | o ML paga ao vendedor um bônus por envio | ✅ idem; o bônus aparece na lista ("Você receberá até R$ x por usar o Flex") |
| `me2` + `fulfillment` | Full | o ML guarda e despacha do centro dele | idem ME2 + custos do Full | ✅ idem |
| `me1` | Mercado Envios 1 | o vendedor (logística própria ou de terceiros), com calculadora de frete do ML; o vendedor informa o rastreio | o comprador vê o custo no anúncio | ✅ developers › Mercado Envios 1 |
| `custom` | Envio personalizado | o vendedor, com tabela de preços por região | comprador | ✅ developers › Envios personalizados |
| `not_specified` | "Combinar a entrega" | vendedor e comprador combinam depois da compra | combinado | ✅ developers (usado quando a categoria não suporta as medidas); ⚠️ o nome "Combine a entrega" na lista do vendedor foi visto nos retratos |

Regras oficiais que o Copiloto usa:
- ✅ "Itens que já possuem a modalidade ME2 disponível não podem ser publicados utilizando o ME1" (developers › Mercado Envios 1, "Importante").
- ✅ ME1 exige ao menos uma das dimensões até 500 cm ou peso até 500 kg (mesma página).
- ✅ `not_specified` é o modo quando a categoria não suporta as dimensões do produto; `custom` e `not_specified` vêm habilitados para todo vendedor.
- ✅ Medidas do pacote (`SELLER_PACKAGE_HEIGHT/WIDTH/LENGTH/WEIGHT`) são obrigatórias no ME2 em Coleta e Agências; ME1 usa `shipping.dimensions` (developers › Atributos).
- ✅ Peso volumétrico = (C × L × A) / 6.000; vale o maior entre o físico e o volumétrico (aviso da própria tela "Alterar anúncio", já no MAPEAMENTO-ML.md).

## 2. Limites de medida e peso por modalidade

| Modalidade | Peso máx. | Maior lado | Soma dos 3 lados | Status |
|---|---|---|---|---|
| Correios / envio tradicional (`drop_off`) | 30 kg | 100 cm | 200 cm | ⚠️ Central de Ajuda "Dimensões permitidas" (`/ajuda/Dimensoes-permitidas_3163`), resumo de busca de 30/09/2026 (página deu 403) |
| Agências Mercado Livre (`xd_drop_off`) ou Coleta (`cross_docking`) | 50 kg | 200 cm | 300 cm | ⚠️ idem (a Central põe as duas juntas) |
| Full | 25 kg | 120 cm | 260 cm | ⚠️ idem |
| Flex | até 300 cm e 80 kg quando o vendedor aumenta as dimensões | — | — | ⚠️ nota oficial `vendedores.mercadolivre.com.br/nota/como-aumentar-las-dimensiones-de-mis-envios-flex`, lida só pelo resumo da busca (30/09/2026) |
| Envios Agora (instantâneo) | 15 kg | 50 cm | 100 cm | ✅ developers › Mercado Envios Agora |
| ME1 | até 500 kg | até 500 cm | — | ✅ developers › Mercado Envios 1 |

No código: `SHC.LOGISTICA_LIMITES` (ml-extrator.js). **O que o ML diz na tela do anúncio vale mais que a tabela**: a
"Forma de entrega" da tela "Alterar anúncio" traz `metrics.confirm.marketplace.modes = {me1, me2, custom, notSpecified}`
com `available` true/false (retrato de 25/09/2026, MLB4248981180: `me2.available=true, type=MANDATORY`). Quando esse
dado existe, a pergunta "cabe no Mercado Envios?" é respondida por ele (confirmado); sem ele, pela tabela (não conferido).

## 3. Prazo de despacho e atrasos

- ✅ Cada envio tem a data e hora máxima de despacho (SLA): `GET /shipments/{id}/sla` → `status` (`on_time`, `delayed`,
  `early`, `insuficient_info`), `expected_date` (developers › Gerenciamento de envios). O campo antigo
  `estimated_handling_limit` foi descontinuado em 13/05/2025.
- ✅ Reputação: métricas de 60 dias (vendas, reclamações, **envios com atraso / delayed handling time**, cancelamentos);
  para o atraso o período vai de 60 a 365 dias conforme o volume de vendas; um pacote com vários pedidos atrasado pesa
  pelo número de pedidos (developers › Reputação de vendedores). Os limites por cor variam por país.
- ⚠️ Limite de atraso: o retrato real da tela de Reputação usado nos testes (`teste_perguntas_reputacao.js`) traz
  `limitePct: 6` (vendedores.mercadolivre.com.br "Enviar no prazo" não abriu). O Copiloto **não usa número fixo**:
  mostra o `limitePct` que a própria tela de Reputação traz.
- ⚠️ Prazo por modalidade (Coleta: dia da coleta; Agências: até a data da etiqueta; Flex: mesmo dia conforme horário de
  corte; Full: o ML despacha do centro dele). Na tela só aparece a frase do Full, sem afirmar prazo.
- ✅ Experiência de compra por anúncio: o ML avisa que "a experiência que brinda tua publicação afeta tua exposição e
  poderíamos pausá-la" (developers › Experiência de compra) — atraso e problema por anúncio afetam exposição.

## 4. Quando o ML muda ou restringe o anúncio

- ✅ Status do item: `active`, `paused`, `closed`, `under_review` (substatus `warning`, `waiting_for_patch`, `held`,
  `pending_documentation`, `forbidden`); pausa preventiva por moderação = `paused` + tag `moderation_penalty`
  (developers › Moderações / Sincronização de publicações).
- Na lista de Anúncios do vendedor (retratos de 24–26/09/2026) a faixa `dynamicCell.cellId = 'status_restriction'`
  traz `contentId` (`out_of_stock`, `paused`, `closed_finalized`) e o texto do ML. O Copiloto trata como **restrição do
  ML** o `under_review` e qualquer motivo que não seja do vendedor (sem estoque, pausado, finalizado por você).
- Na competição do catálogo: `BUYBOX-LOSING_BY_SHIPPING_MODE` = "Você não pode ganhar porque outros vendedores oferecem
  uma forma de entrega melhor" (retrato real) → aviso de logística.
- ⚠️ O ML recalcula o frete quando ajusta as medidas do pacote ("Com alteração no custo de envio … ajuste nas dimensões
  do pacote", tarefa da lista de Anúncios) — já coberto pelo Monitor de medidas.

## 5. Melhor cenário por tipo de produto (orientação, não regra do ML)

- Pequeno e leve, giro alto: Full (entrega rápida, o ML despacha) ou Coleta + Flex nas capitais.
- Médio, dentro do limite do Mercado Envios: Coleta (se tiver volume) ou Agências; Flex como extra.
- Grande/pesado acima do limite do Mercado Envios: ME1 (logística própria com frete no anúncio) é melhor que "combinar",
  porque o comprador vê custo e prazo antes de comprar.
- Frete que pesa muito no preço: regra do Copiloto (não do ML) — frete ≥ 25% do preço → conferir medida e comparar Flex/Full.

## 6. O que o Copiloto faz com isso (SHC.logisticaDoAnuncio)

Ordem das fontes da modalidade: estoque no Full (aba Full / "Full" no estoque) → NF-e das vendas (`logistic_type` por
venda, maioria) → "Combine a entrega" na lista (a combinar; ME1 se a tela do anúncio só liberar o ME1) → frete do
Mercado Envios na lista → não identificada. Sem esses sinais, não chuta.

A CONFIRMAR AO VIVO (não lido pelo Copiloto hoje):
1. Prazo de despacho e atraso **por anúncio/venda**: tela de Vendas ("Despachar até") e a de desempenho de envios
   (URL provável `https://www.mercadolivre.com.br/metricas/desempenho-em-envios` — não mapeada).
2. Se a lista de Anúncios mostra ME1 com outro texto que não "Combine a entrega".
3. Como a lista mostra o estoque no Full (`product.stock[].id`), para não depender só da aba Full.
4. Se `flexData.optInStatus` da tela do anúncio é do anúncio ou da conta.
5. Os limites da Central de Ajuda (tabela da seção 2) na página oficial.
6. Se o número da venda da NF-e (`sale_number`) é o mesmo número de pedido do Faturamento (pacotes podem ter outro número).
