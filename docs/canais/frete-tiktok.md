# Frete do vendedor no TikTok Shop Brasil — o que é cobrado, de que depende e o que o Copiloto deve somar

Pesquisa de 08/10/2026. Fontes: Seller University oficial (aberta pelo Chrome de teste; datas = data exibida no artigo) e retratos já gravados do portal logado (`tests/copiloto/retratos_tiktok`, só leitura). Complementa `tiktok.md` (não repete comissão/SFP/repasse). Texto resumido, não copiado.
Nesta rodada reli o portal logado só em `Logística > Enviando` (nada clicado/alterado).

## 0. Conclusão curta

- **Envio pela plataforma + SFP, peso/dimensão do cadastro corretos, sem desconto de frete próprio: o frete líquido do vendedor é R$ 0.** O custo real do frete (item 412) é coberto por "frete pago pelo cliente" (414) + "frete coberto pelo TikTok Shop" (413) — 3 pedidos reais (A, B, D) e a devolução (C) fecham assim (seção 6). O que o vendedor paga em vez do frete é a taxa SFP 6% (teto R$ 50/produto), que o Copiloto já tem.
- Logo, **o Copiloto não está errado ao usar frete 0 para TikTok** (`FRETE` em tarifas.js não tem `tiktok`; a simulação cai em "Sem frete informado" = R$ 0). O que **falta** são os casos em que o frete volta para o vendedor (seção 7).
- Não existe tarifa fixa "por peso" paga pelo vendedor no caso normal; a tabela por peso/região (seção 2) é o custo bruto da transportadora, que só vira custo do vendedor na diferença de peso, no desconto de frete próprio, em devolução por culpa do vendedor ou fora do SFP.

## 1. Quem paga o frete por tipo de envio

| Situação | Quem paga | Fonte (URL, título, data lida) |
|---|---|---|
| **Enviado pela plataforma** (padrão; J&T, Correios, iMile atribuída automaticamente a cada vendedor; vendedor não escolhe) | Frete real cobrado do vendedor só quando o pedido vira "Entregue" (não em RTS/coletado/trânsito). Na prática o comprador paga a taxa calculada no checkout e o TikTok subsidia; o vendedor responde pela diferença (peso, desconto próprio). | `knowledge_id=2429852922251024` "Como calcular a taxa de envio", 14/04/2026 (§1.3); `knowledge_id=2915348630603521` "Visão Geral da Opção 'Enviados Pela Plataforma'", 31/08/2026 (seção "Como calcular os custos do envio") |
| **Enviado pelo vendedor** (só "vendedores selecionados", ligado no nível da conta) | Vendedor contrata/paga a transportadora por fora; **não tem compensação por problema logístico**; cuida do atendimento. Sem tabela de frete da plataforma. | `knowledge_id=3023422608852744` "Comparação entre as soluções de envio", 24/08/2026; `3028311274702599` "Como processar pedidos com a opção Envio pelo vendedor", 24/08/2026 |
| **SFP — Programa de Taxas de Envio** (todo vendedor entra automaticamente; pode sair) | Vendedor paga **6% do preço de venda (depois do desconto do vendedor, antes de subsídio da plataforma) só em pedido entregue com sucesso, teto R$ 50 por produto**. Em troca o TikTok subsidia o frete do comprador (cupons). Fora do programa: sem subsídio e vendedor define/paga o próprio desconto de frete. | `knowledge_id=5665577566734097` "Programa de Taxas de Envio", **31/08/2026** (data agora exibida); portal logado: campanha da loja, loja inscrita desde 02/04/2026, "em vigor a partir de 04/04/2026" (retrato `programa_taxas_envio.json`, 03/10/2026) |
| **Desconto de frete do vendedor** (ferramenta de promoção) | Vendedor assume todo (Frete grátis) ou parte (Desconto parcial). O subsídio SFP é abatido primeiro; o do vendedor vem depois. Se o custo real passar do que o comprador paga, o extrato do pedido pode ficar **negativo**. | `knowledge_id=5702401538754320` "Desconto na Taxa de Envio", 01/10/2026; FAQ 3 do SFP (31/08/2026) |
| **Amostra grátis** | Frete 100% do vendedor; SFP não se aplica. | SFP, 31/08/2026 (FAQ 7) |
| **"Expresso" / dia seguinte** | **Não encontrado para o Brasil.** O artigo de Desconto na Taxa de Envio cita "expresso, dia seguinte, econômico, padrão" de forma genérica; o portal logado mostra só "Entrega padrão" em Logística > Enviando. | portal `/logistics/fee-and-service?tab=delivery-setting`, lido 08/10/2026 |

Quando é cobrado: na entrega (§1.3 acima). SFP: só entregue; cancelado/não pago/não enviado = não cobra; enviado e depois devolvido/reembolsado = SFP **não** volta.

## 2. Tabela de frete por peso / região (custo bruto da transportadora)

Fonte: `knowledge_id=2915348630603521`, 31/08/2026, seção "Taxas de envio". A tabela é **imagem** no artigo (lida pela imagem, não por texto). Pontos oficiais:
- Vale a partir de **13/07/2026 00:00** (reduz taxas) para **pacotes originados em SP, RJ, ES e MG**; outras origens "permanecem inalteradas" e a tabela delas **não foi encontrada**.
- Valores já incluem tributo ("IVA"). Sobrepeso: pacotes acima de **40 kg** pagam R$ 1,90 a R$ 22,00 por kg adicional.
- Cada célula é uma **faixa (mínimo a máximo)**, não um preço único; o artigo não diz o que escolhe o valor dentro da faixa (cidade/transportadora/serviço) — **não encontrado**. Chamada "tabela aproximada de taxas de envio para referência" em "Como calcular a taxa de envio" §1.1.
- Exemplo oficial: SP -> PR, 300 g: antes R$ 10,25 a R$ 25,30; depois R$ 7,10 a R$ 12,00 (coerente com a célula SP/Sul 0-0,5 kg).
- Regiões: Sudeste (SP, MG, RJ, ES); Sul (PR, RS, SC); Nordeste (BA, CE, PE, MA, PB, PI, RN, AL, SE); Norte (PA, AM, RO, TO, AC, AP, RR); Centro-Oeste (GO, MT, DF, MS).
- Peso por faixa (peso faturado): 0–0,5 | 0,5–1,25 | 1,25–3,0 | 3,0–10,0 | 10,0–30,0 | 30,0–40,0 kg.

Valores em R$ (mín a máx):

**Origem São Paulo**
| Destino | 0–0,5 | 0,5–1,25 | 1,25–3 | 3–10 | 10–30 | 30–40 |
|---|---|---|---|---|---|---|
| Sudeste | 6,10–14,50 | 8,20–15,70 | 9,20–25,10 | 12,30–49,80 | 26,60–125,40 | 63,40–163,30 |
| Sul | 7,10–12,00 | 10,20–14,50 | 12,30–22,60 | 18,20–45,00 | 33,80–112,60 | 81,20–146,50 |
| Nordeste | 9,20–27,50 | 12,30–31,20 | 14,40–44,50 | 21,30–91,40 | 39,40–225,00 | 93,50–291,90 |
| Norte | 14,40–67,80 | 21,30–79,20 | 25,40–116,40 | 33,70–246,50 | 62,60–618,20 | 145,00–804,10 |
| Centro-Oeste | 9,60–28,70 | 13,20–32,40 | 15,70–47,00 | 22,60–96,20 | 43,20–237,80 | 103,20–308,70 |

**Origem Rio de Janeiro**
| Destino | 0–0,5 | 0,5–1,25 | 1,25–3 | 3–10 | 10–30 | 30–40 |
|---|---|---|---|---|---|---|
| Sudeste | 6,50–14,50 | 8,60–15,70 | 9,70–25,10 | 13,00–49,80 | 29,40–125,40 | 70,00–163,30 |
| Sul | 8,20–12,00 | 10,20–14,50 | 13,00–22,60 | 19,20–45,00 | 35,50–112,60 | 86,00–146,50 |
| Nordeste | 9,70–27,50 | 13,00–31,20 | 15,20–44,50 | 22,60–91,40 | 46,30–225,00 | 110,00–293,10 |
| Norte | 14,40–79,80 | 21,30–93,20 | 25,40–136,90 | 33,70–290,00 | 62,60–727,30 | 145,00–946,00 |
| Centro-Oeste | 8,60–25,80 | 11,90–29,20 | 14,10–42,30 | 20,30–86,60 | 38,90–214,00 | 92,90–277,80 |

**Origem Espírito Santo**
| Destino | 0–0,5 | 0,5–1,25 | 1,25–3 | 3–10 | 10–30 | 30–40 |
|---|---|---|---|---|---|---|
| Sudeste | 6,10–13,80 | 8,10–16,00 | 9,10–25,10 | 12,30–49,80 | 26,60–126,10 | 63,80–164,20 |
| Sul | 8,20–12,00 | 10,10–14,30 | 12,20–22,60 | 18,20–45,00 | 33,90–113,30 | 81,50–147,40 |
| Nordeste | 9,20–26,80 | 12,20–31,20 | 14,10–44,50 | 21,30–91,50 | 39,40–226,10 | 94,10–293,40 |
| Norte | 14,60–78,40 | 21,00–93,20 | 25,00–136,90 | 33,70–290,50 | 62,80–731,20 | 146,30–951,60 |
| Centro-Oeste | 8,40–27,50 | 11,00–32,40 | 13,10–47,00 | 19,20–96,20 | 36,80–237,80 | 88,30–308,70 |

**Origem Minas Gerais**
| Destino | 0–0,5 | 0,5–1,25 | 1,25–3 | 3–10 | 10–30 | 30–40 |
|---|---|---|---|---|---|---|
| Sudeste | 6,10–14,10 | 8,00–15,80 | 8,90–25,10 | 11,30–49,50 | 27,70–127,50 | 64,70–166,50 |
| Sul | 8,20–12,20 | 10,20–14,20 | 12,20–22,60 | 16,20–68,10 | 39,70–190,60 | 96,40–251,90 |
| Nordeste | 9,20–27,20 | 12,40–31,40 | 14,30–44,50 | 19,00–102,50 | 38,10–262,00 | 87,90–341,70 |
| Norte | 15,00–79,50 | 20,80–93,80 | 23,90–136,90 | 32,00–274,40 | 77,60–680,60 | 180,60–883,90 |
| Centro-Oeste | 8,60–28,40 | 11,30–32,00 | 13,30–47,00 | 17,30–96,40 | 33,60–239,50 | 78,10–311,00 |

### Peso faturado (peso cubado) e limites
- **Peso faturado = maior de 4 valores**: peso declarado pelo vendedor; peso cubado das dimensões declaradas; peso medido pela transportadora; peso cubado medido pela transportadora. **Cubado = (C × L × A em cm) / 6.000.** (`2429852922251024`, 14/04/2026 §1.2; confirmado na imagem de "Visão Geral", 31/08/2026.)
- Informar peso/dimensão **com a embalagem**. Exemplos oficiais: vara 4 kg 15×15×130 -> 4,88 kg; copo 0,5 kg embalado 20×20×25 -> 1,33 kg; casaco 5 kg, transportadora mediu 50×50×40 -> faturado 16,67 kg.
- Limites do pacote (Visão Geral, imagem, 31/08/2026): até **30 kg**; um lado até **100 cm**; soma dos três lados até **200 cm**. O portal logado (08/10/2026) mostra o mesmo para "Entrega padrão": mín 0,00 kg, máx 30,00 kg, 100×100×100 cm, soma 200 cm. **Divergência dentro da própria documentação**: a tabela tem faixa 30–40 kg e sobrepeso acima de 40 kg, mas o limite do pacote é 30 kg — não resolvido.
- Exceder limite: a transportadora pode recusar o pacote; falha de entrega/taxa adicional por conta do vendedor.
- Peso do cadastro: cadastrar em Gerenciar produtos (também no nível do SKU: `8115097302763284`, 30/09/2026, não aberto — só listado na busca).
- Tributo: pedido enviado de um estado para outro pode gerar **DIFAL do ICMS** a cargo do vendedor; se não pago antes do envio e a transportadora arcar, o valor é debitado da conta no ajuste mensal, item "DIFAL – Ajuste devido ao Diferencial de Alíquota do ICMS cobrado durante fiscalização" (Visão Geral, 31/08/2026).

## 3. Subsídios de frete da plataforma

- Subsídio é **cupom de frete ao comprador**, só para quem está no SFP (31/08/2026). Quem sai do SFP não recebe.
- **Novo usuário**: gasto mínimo R$ 109, subsídio máx R$ 5 (1 uso por voucher).
- **Usuário recorrente** (até 30 usos/mês por voucher; níveis ligados a estado do comprador): Nível 1: R$ 9→R$ 9, R$ 29→R$ 20, R$ 139→R$ 25. Nível 2: R$ 12→R$ 12, R$ 39→R$ 20, R$ 139→R$ 30. Nível 3: R$ 15→R$ 15, R$ 69→R$ 25, R$ 159→R$ 40 (formato "compra mínima → subsídio máximo"). O mapeamento nível×estado é um link do artigo **não aberto — não encontrado**.
- Regras: gasto mínimo = preço de venda após descontos diretos do produto; desconto final = menor entre frete do comprador e teto do cupom; se o frete passar do subsídio, comprador paga a diferença; cupom é otimizado por pedido (nem todo pedido recebe); subsídio no nível do **pedido**, não do pacote.
- **Na liquidação** (retratos do portal, 03/10/2026): item 413 "Custo de frete coberto pelo TikTok Shop" (positivo), item 414 "Taxa de frete paga pelo cliente" (positivo), item 412 "Custo do frete" (negativo, o custo real); soma no grupo 53 "Custo líquido de frete". Subsídios de frete passam por validação antes da liquidação e parte pode liquidar ~3 dias após conclusão do pedido (Política de Pagamentos, `1442971112769281`, lida 07/10/2026, consta em `tiktok.md`).
- Quem mexe no frete pelo desconto próprio: o SFP desconta primeiro; exemplo oficial: pedido R$ 50, frete R$ 30, vendedor com frete grátis -> TikTok paga R$ 20, **vendedor paga R$ 10** (+ SFP R$ 3).
- Free shipping "badge" e tráfego de anúncios gratuito para quem permanece no SFP: benefício, sem valor em R$.

## 4. Devolução: frete reverso e quem paga

Fonte: `knowledge_id=894339073115921` "Diretrizes de Cancelamento, Devolução e Reembolso…", **24/09/2026**; SFP 31/08/2026; "Casos Comuns de Taxa de Envio" `4814789939824401` (16/10/2025).
- Culpa do **vendedor**: descrição imprecisa, peças ausentes/quebradas, item danificado, defeito, item errado, não chegaria a tempo, chegou tarde, "faltando item" (e, em Moda, tecido/material/estilo diferente). Para devolução (custo do frete de retorno): vendedor paga; para reembolso de frete ao cliente: vendedor.
- Culpa da **plataforma/sem culpa**: "Não preciso mais" (todas as categorias retornáveis) e, em Moda, "não cabe/pequeno/grande": TikTok Shop paga.
- SFP: se enviado e a culpa é do vendedor, vendedor paga **SFP 6% + frete de ida integral + frete reverso integral** (exemplo oficial: item R$ 100, frete R$ 20 -> 6 + 20 + 20). Sem culpa: só o SFP 6% (o frete de ida e o reverso não são cobrados). **SFP nunca é devolvido.**
- Frete reverso hoje é fornecido pela plataforma só em agências dos Correios (drop-off) (Visão Geral, 31/08/2026).
- Valores do frete reverso por peso/região: **não encontrado** (não há tabela do reverso nos artigos lidos).
- Problema logístico (pacote perdido/vazio/endereço errado): se a plataforma decide "falha do vendedor" (embalagem ruim, rastreio inválido, endereço incorreto), reembolso (item + frete) é deduzido do vendedor sem ressarcimento (24/09/2026). Em "Enviado pelo vendedor" não há compensação logística; em "pela plataforma" há (3023422608852744, 24/08/2026).
- Retrato do portal (03/10/2026): devolução sem culpa (pacote não recebido) mostra "Sem taxas de envio de ida e de devolução"; reembolso ao comprador inclui o frete de ida (R$ 46,46) — e o vendedor segue pagando só a SFP (caso C: SFP R$ 32,99 permanece).

## 5. O que mudou em 2026 (vigência)

| Data | Mudança | Fonte |
|---|---|---|
| 05/02/2026 | R$ 4 por item enviado; "todos os vendedores entram automaticamente no Programa de Frete" | `2494371300607761` "Dominando os Relatórios Financeiros", 01/06/2026 (texto de curso). O artigo de comissão chama a taxa por item de "inalterada" em 12/06/2026 — vigência 05/02 só neste curso. tarifas.js usa `2026-01-01` para a taxa fixa de R$ 4: **pode estar 5 semanas adiantada** (não confirmado) |
| 16/03/2026 | Novos prazos/cálculo da taxa de envio atrasado (LDR) — não é custo | busca da Academia (artigo não aberto) |
| 02–04/04/2026 | Loja consultada: inscrita 02/04 e SFP em vigor 04/04 (data da conta, não da regra) | `programa_taxas_envio.json` |
| 13/07/2026 00:00 | Redução das taxas de envio (tabela da seção 2) para origens SP/RJ/ES/MG | Visão Geral, 31/08/2026 |
| 15/07/2026 | Comissão/taxa por item (já em tarifas.js) | `tiktok.md` |
| 31/08/2026 | Reedição dos artigos "Visão Geral" e SFP | datas exibidas |

Não encontrei mudança nas regras do SFP (6%, teto R$ 50) em 2026.

## 6. Onde o frete aparece no demonstrativo (para o Copiloto conferir)

Tela: Finanças > Demonstrativos > Exibir por pedidos > Exibir detalhes. Endpoint que a tela usa: `POST /api/oec/pay/merchant/statement/view/order_breakdown` (retrato `financeiro_view_order_breakdown.json`, 03/10/2026). Itens (`item_id`):
- **53** "Custo líquido de frete" (em espera: "Frete estimado") = soma de 412 + 413 + 414. Valor assumido pelo vendedor.
- **412** "Custo do frete" (negativo; frete real pela tarifa/peso medido).
- **413** "Custo de frete coberto pelo TikTok Shop" (positivo).
- **414** "Taxa de frete paga pelo cliente" (positivo).
- Linhas extras possíveis: "Ajuste da taxa de envio" (diferença entre frete real e pré-pago; peso/dimensão), taxa de devolução (frete reverso do vendedor), "Reembolso de logística" (TikTok cobriu/compensou). Rótulos oficiais: Guia de Demonstração Financeira, `22854025807617`, 20/05/2026 — "Envio = taxa de envio do TikTok Shop + taxa de envio do cliente + incentivo de envio + taxa de devolução".
- Excel exportado (5 abas): Detalhes do pedido, Demonstrações, Relatórios, Pagamentos, Explicação das taxas.
- Também no detalhe do pedido (`GET /api/v1/trade/orders/get`): `shipping_origin_fee` (frete real), `shipping_fee` (pago pelo comprador), `shipping_fee_discount_platform`, `shipping_fee_discount_seller`. Identidade observada: `shipping_origin_fee` = `shipping_fee` + descontos (R$ 76,46 = 46,46 + 30,00).
- Peso: **não aparece** em nenhuma tela de extrato/detalhe do pedido (retrato `frete_peso_extrato.json`, 03/10/2026); só em criação de etiqueta.

Conferências reais (retratos 03/10/2026, pedidos entregues/espera): 
| Caso | 412 custo | 414 cliente | 413 TikTok | 53 líquido |
|---|---|---|---|---|
| A (liquidado) | -152,54 | 112,54 | 40,00 | 0 |
| B (liquidado) | -137,66 | 107,66 | 30,00 | 0 |
| C (reembolso total) | -76,46 | 46,46 | 30,00 | 0 |
| D (em espera) | -76,68 | 36,68 | 40,00 | 0 |
| Retrato do extrato "frete_peso" | -101,29 | 71,29 | — | **-30,00** (vendedor pagou R$ 30: causa não distinguida — peso ou desconto próprio) |

## 7. Fórmula que o Copiloto deve usar

```
frete_vendedor_por_pedido =
    0                                             # envio pela plataforma + SFP + peso/dimensão corretos + sem desconto de frete próprio (casos A, B, D, C)
  + desconto_de_frete_do_vendedor (se a loja tem a promoção "Desconto na Taxa de Envio")
  + ajuste_de_peso (≈ tarifa(peso_faturado) − tarifa(peso_declarado), só se medido/cubado maior que o cadastro)
  + se fora do SFP:  frete_real_cobrado_ao_comprador_fica_com_o_vendedor_quando_oferece_gratis
  + se devolução por culpa do vendedor:  frete de ida integral + frete reverso integral
SFP = 6% × (preço − desconto do vendedor), limitado a R$ 50 por produto, só pedido entregue, nunca devolvido   # já no Copiloto
```
- Rótulo recomendado na etiqueta: "Frete: R$ 0 (comprador + TikTok cobrem; confira peso/dimensões no cadastro)". Quando houver extrato (item 53), **usar o valor lido do extrato** e comparar com 0; se ≠ 0, mostrar a diferença e a causa possível (ajuste de peso / desconto próprio / sem SFP).
- Peso cubado de alerta (dado que o Copiloto tem do cadastro): se (C×L×A)/6000 > peso declarado, avisar que o frete real pode subir (a diferença cai em "Ajuste da taxa de envio").
- Reserva de devolução: se o Copiloto modela risco de devolução, na parcela por culpa do vendedor somar frete de ida + reverso (valor desconhecido; usar o custo 412 do próprio pedido como estimativa de ida e o mesmo para reverso, rotulado "estimativa").

## 8. O que depende de dado que o Copiloto não tem

- **Destino** do pedido (região do comprador) e **origem** (UF do armazém do vendedor): sem eles não dá para escolher a célula da tabela; mesmo com eles a faixa é ampla (ex.: SP->Sudeste 0–0,5 kg: R$ 6,10 a R$ 14,50).
- **Peso/dimensão medidos pela transportadora** (só aparecem como ajuste depois da entrega).
- Se a loja **ofereceu desconto de frete** (promoção própria) e se **está no SFP** (a conta lida está; vendedor pode sair).
- Qual **transportadora** foi atribuída (J&T/Correios/iMile) e o **nível/estado** do comprador (decide o cupom).
- Se o vendedor é do tipo "Enviado pelo vendedor" (custo fora da plataforma, nenhum dado do TikTok).
- Culpa da devolução (decidida pela plataforma).

## 9. Não encontrado

- Tabela de frete para origens fora de SP/RJ/ES/MG.
- Regra que escolhe o valor dentro da faixa (cidade/serviço/transportadora).
- Valor do frete reverso (tabela/faixa).
- Mapeamento nível 1/2/3 × estados do cupom (link do artigo não aberto).
- Serviço "Expresso/dia seguinte" no Brasil.
- Se o frete pago pelo comprador no checkout já usa peso cubado do cadastro (o balão do portal diz só "peso do produto que você carregou").
- Causa da linha líquida -R$ 30 no retrato `frete_peso_extrato.json`.
- Texto exato do limite 40 kg vs 30 kg (contradição entre tabela e limite).
- Data de vigência de 05/02/2026 em fonte de regra (só no resumo de curso).
- "Casos Comuns de Taxa de Envio" tem trechos em moeda errada ("$10.000" de mínimo para pagamento; valores em "$") — não usar como regra numérica.

Arquivos de apoio criados nesta pesquisa: `C:\xampp\copiloto-sync\cdp\ft-ler.js`, `ft-busca.js`, `ft-img2.js`, `ft-portal.js` (leitura de artigos e imagens; só leitura).
