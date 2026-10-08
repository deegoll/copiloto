# Frete do vendedor na Shopee Brasil · o que o Copiloto deve somar

Pesquisa de 08/10/2026. Complementa `shopee.md` (não repete comissão/Ads). Leituras integrais feitas no navegador (Hub é SPA), mais o portal logado da loja (só leitura). Imagens de tabela do Hub foram baixadas e vistas. Nada de blog.

## 1. Quem paga o frete
- Programa de Frete Grátis: todos os vendedores participam desde 03/2026; a Shopee dá cupom de frete conforme o preço do item: até R$ 79,99 → frete até **R$ 20**; R$ 80 a 199,99 → até **R$ 30**; acima de R$ 200 → até **R$ 40**; mais cupom de 50% de desconto no frete em compras acima de R$ 10. Com pontos de penalidade ativos o cupom pode ficar limitado/indisponível. Fonte: "Programa de Frete Grátis" https://seller.shopee.com.br/edu/article/23431 (lido integral 08/10/2026) e "Novidades na Shopee: Pagamentos por Pix e Frete Grátis" https://seller.shopee.com.br/edu/article/26944 (23/02/2026, lido integral 08/10/2026).
- Coparticipação do vendedor no cupom (25% do desconto, teto R$ 10): vale **somente** para logística do vendedor (Intelipost/API de Frete), "não é regra geral da plataforma". Fonte: https://seller.shopee.com.br/edu/article/25794 (lido integral 08/10/2026). Para quem usa Shopee Xpress/Retirada/Entrega Direta: nenhuma regra oficial de coparticipação encontrada.
- Texto oficial NÃO diz quem paga a parte do frete acima do teto do cupom: **não encontrado**.
- Termos de Logística (https://help.shopee.com.br/portal/4/article/124091, atualizado 16/02/2023): o custo do frete é definido por dimensão cadastrada + origem/destino; o vendedor não pode cobrar nada extra do comprador.

## 2. Evidência em pedidos reais (portal logado, 10 pedidos concluídos 01–07/10/2026, todos Shopee Xpress, loja CNPJ)
Conta pela tabela do Copiloto (comissão % do preço + fixo) comparada ao "Valor final" liberado (tela de detalhes do pedido):

| Preço item | Cálculo tarifas.js | Valor final lido | Diferença |
|---|---|---|---|
| 199,99 | 151,99 | 151,99 | 0 |
| 237,50 | 178,25 | 178,25 | 0 |
| 237,50 (outro) | 178,25 | 173,50 | −4,75 (2,0% do preço) |
| 133,00 (x2) | 94,38 | 91,72 | −2,66 (2,0%) |
| 194,75 | 147,48 | 143,58 | −3,90 (2,0%) |
| 123,50 | 86,21 | 83,74 | −2,47 (2,0%) |
| 38,00 | 25,90 | 24,61 | −1,29 (3,4%) |

Leitura: **nenhum pedido mostra desconto de frete na renda** (o campo `shipping_fee` do pedido, de R$ 0,00 a R$ 23,98, é a cotação do frete, não custo do vendedor: o pedido de 237,50 com `shipping_fee` 19,12 liberou exatamente o valor da tabela). Em 5 de 10 pedidos aparece uma diferença de exatamente 2% do preço, de causa **não identificada** (pode ser outra tarifa, não frete; a decomposição está em Minha Renda). Amostra pequena, só Shopee Xpress, pesos baixos, sem divergência de peso: não prova que o frete é sempre zero.

## 3. Tabela de frete por peso e serviço
**Não encontrada.** O Hub só publica as FAIXAS de peso (0–500 g, 501–1000, 1001–2000, … faixas de 1 kg até 10.000 g) sem preço (https://seller.shopee.com.br/edu/article/3305, lido 08/10/2026); a tarifa em R$ depende de CEP origem/destino. Na tela de produto o painel mostra "Taxa de Envio" por canal (ex.: Shopee Xpress R$ 16,91; Retirada pelo Comprador R$ 13,53 num exemplo da própria página; esses valores são estimativa do comprador/cotação, não custo do vendedor). `get_channel_list` (Configurações de Envio) devolve `default_price: "0.00"` e nenhum preço por peso.
- Canais ativos na loja: Entrega Direta, Expresso Aéreo, Retirada pelo Comprador, Shopee Xpress.

## 4. Peso cubado e dimensões
- Peso cúbico = C × L × A (cm) ÷ **6.000**; vale o MAIOR entre peso bruto (produto + embalagem) e cúbico (artigo 3305; `volumetric_factor: 6000` no portal).
- Pacote/caixa: C 15–70 cm, L 10–70, A 1–70, soma 26–200 cm. Shopee Xpress/Coleta/Entrega Direta (ordem das imagens do artigo, inferida): lado máx. 120 cm, soma máx. 200 cm, peso máx. 30 kg; Entrega Rápida: lado 50 cm, soma 90 cm, 10 kg. Vários itens: regra de empilhamento (soma peso e dimensões).
- Fora das dimensões permitidas: **R$ 50,00 por envio** (taxa de manuseio de item volumoso), podendo haver remoção do anúncio/penalidade (artigo 3305).

## 5. Peso/dimensão errado
- Se o peso aferido passar para outra faixa, há cobrança adicional; mesma faixa = sem alteração. A diferença é repassada integralmente ao vendedor. A cobrança pode vir até 3 meses (90 dias) após a entrega, aparece em Finanças › Saldo da Carteira › aba **Ajuste** (pedido, divergência em kg, valor); contestação até 12 meses da entrega. Fonte: "Como funciona a cobrança adicional de frete?" https://seller.shopee.com.br/edu/article/4478 (lido integral 08/10/2026). Valor em R$ da diferença: não publicado (é por faixa/CEP).

## 6. Devolução (frete reverso)
- Erro comprovado do vendedor (produto incompleto, defeituoso, errado): vendedor paga envio e devolução. Arrependimento ou devolução na Garantia Shopee por outros motivos: Shopee paga. Disputa sobre o responsável: Shopee decide. Fonte: help.shopee.com.br/portal/4/article/77827, item 5 (lido 08/10/2026; "Última atualização 18/06/2024").
- Na lista "Retornos e Pedidos cancelados" do portal há colunas "Reembolso ao comprador", "Compensação ao vendedor" e **"Responsabilidade Logística"** (valores vistos: Shopee, Vendedor). Dos 12 retornos com devolução na 1ª página: "Mudei de ideia", "Produto não serviu" → Shopee; "Itens faltando" → Vendedor. Valor do frete reverso em R$: não encontrado ("Outros ajustes" estava "-" em todos os 40).

## 7. Vigências 2026
- 01/03/2026: Frete Grátis para todos (cupons acima). Nada de frete alterado em 01/10/2026 nas fontes lidas.

## 8. Onde conferir o frete por pedido (Minha Renda)
- A tela Minha Renda › Detalhes da transação (`/portal/finance/income`) **pede a senha de login** ao abrir; não digitei (regra). Conteúdo não lido.
- Retrato `shopee_renda_2026-10-07.json`: `income_overview/get_income_overviews` traz só `list[{type, amount}]` (tipos 12, 9, 8, 10; sem nome; valores em 1/100.000 de real); `get_order_income_components` sem parâmetros dá erro 90003 e **não há campo de frete** no retrato.
- Chamado com o pedido (tela de detalhes), `get_order_income_components` devolveu só `adjustment_info{total_adjustment_amount, amount_after_adjustment}` (151,99 = 15199000/100000) e `order_info`. Valor líquido liberado por pedido: "Valor final" na tela de detalhes do pedido. Campo de frete por pedido: **não encontrado**. Outro caminho oficial: planilha "Exportar" de Meus Pedidos com colunas "Valor estimado do frete", "Desconto de Frete Aproximado", "Taxa de envio pagas pelo comprador" (artigo 25794; só vi o nome, não abri o arquivo).

## 9. Fórmula que o Copiloto deve usar
1. Conta Shopee Xpress/Retirada/Entrega Direta com Frete Grátis, peso e dimensões corretos: **frete do vendedor = R$ 0** (hoje o Copiloto já faz isso por omissão; manter, com aviso "frete assumido zero: Frete Grátis da Shopee").
2. Logística do vendedor (Intelipost/API de Frete): frete próprio + coparticipação = min(25% × cupom de frete aplicado, R$ 10); cupom = 20/30/40 pela faixa do preço; só quando o comprador usa o cupom.
3. Risco a avisar, não a somar: divergência de peso/dimensão (cobrança em Ajuste até 90 dias depois) e R$ 50 por envio fora das dimensões. Usar peso/dimensão do cadastro: peso cobrado = max(bruto, C×L×A÷6000).
4. Devolução: se motivo do vendedor, somar frete de ida e volta (valor não publicado → pedir ao usuário).

## 10. Não encontrado
Tabela em R$ de frete por peso/serviço/CEP; quem paga o frete acima do teto do cupom; coparticipação fora da logística do vendedor; valor da cobrança por divergência de peso; valor do frete reverso; causa do desconto de 2% (e 3,4%) em parte dos pedidos; campo de frete por pedido em Minha Renda (tela bloqueada por senha).
