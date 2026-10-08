# Design do Portal do Seller Magalu · tokens lidos em 08/10/2026

Método: `getComputedStyle` em elementos reais das listas (conta de teste, viewport 1400x1000, Chrome). Telas: `/pedidos` (cartão de pedido) e `/products` (linha de produto). Prints (nomes de comprador desfocados): `C:/xampp/copiloto-sync/design-magalu-pedidos.png`, `design-magalu-cartao-expandido.png`, `design-magalu-produtos.png`.

## Tipografia
| Uso | Família | Tamanho/peso/altura de linha |
|---|---|---|
| Corpo da página | `Magalu` | 14px / 400 / 16px |
| Título da página ("Gestão de pedidos") | `MagaluTextos` | 26px / 700 / 32px |
| Nº do pedido no cartão (`LU-...`) | `MagaluTextos` | 14px / 400 / 24px |
| Texto de apoio do cartão (total, entrega, data) | `MagaluTextos` | 14px / 400 / 18px |
| Status em texto ("Em rota de entrega...") | `MagaluTextos` | 16px / 400 / 24px |
| Chip (filial, canal) e pill de status | `MagaluTextos` | 12px / 500 / 16px |
| Título do produto na lista | `Magalu` | 16px / 400 / 24px |
| Preço na lista de produtos | `Magalu` | 14px / 400 / 24px |
| Link/ação ("Enviar mensagem", "Alterar") | `Magalu(Textos)` | 14px / 500 / 18px |
| Botão ("Ações", "Menu") | `MagaluTextos` | 16px / 500 / 18px |
| Tag secundária "Competitivo!" | `Magalu` | 12px / 400 / 18px |

Sem `text-transform`, sem letter-spacing. Para a etiqueta do Copiloto usar `font-family: inherit` e 12px/500 (igual aos chips).

## Cores (rgb → hex)
| Papel | Valor |
|---|---|
| Texto principal | rgb(66,74,82) = `#424A52` |
| Texto secundário/desabilitado | rgb(120,128,137) = `#788089` |
| Fundo da página | rgb(250,250,250) = `#FAFAFA` |
| Fundo do cartão | `#FFFFFF`, borda 1px rgb(247,247,247) = `#F7F7F7` |
| Azul Magalu (links, "Alterar", "Enviar mensagem", botão "Ações", seleção "Mês atual") | rgb(0,134,255) = `#0086FF`; borda do botão outlined = `rgba(0,134,255,.5)` |
| Verde (tag "Publicado") | rgb(0,143,45) = `#008F2D`, texto branco |
| Amarelo (pill "Despachado") | rgb(255,199,0) = `#FFC700`, texto `rgba(0,0,0,.87)` |
| Cinza do chip (filial "#298: ...", canal "Magazine Luiza") | rgb(224,224,224) = `#E0E0E0`, texto `#424A52` |
| Queda no indicador ("88.53%") | vermelho em texto (visto no print; não medido por seletor) |

Escolha para o Copiloto: não reusar o azul/verde/amarelo nativos como fundo de "Sobra" (já significam "Publicado", "Despachado"); manter verde/âmbar/vermelho do Copiloto com cantos de 32px (mesmo raio das tags nativas) e texto 12px/700 branco.

## Forma
| Elemento | Raio | Padding | Sombra |
|---|---|---|---|
| Cartão de pedido (`.MuiPaper`) | 9px | 0 (conteúdo em grid) | `rgba(120,128,137,.12) 0 1px 10px 0` |
| Chip cinza | 9px | 0 8px, altura 18px | nenhuma |
| Pill de status e tag "Publicado" | 32px (cápsula) | 4/2 (pill) · 0/16 (tag), altura 24px | nenhuma |
| Botão ("Ações", "Menu") | 6px | 7/23/7/31 · 8/8, altura 34–40px | nenhuma |
| Linha de produto | 0 (sem caixa) | 0 | nenhuma |

Espaçamento: cartões empilhados com ~16px entre eles (1232px de largura x 132px de altura, +16px de margem); linha de produto 1192x302px com as colunas lado a lado.

## Tags nativas
- **"Publicado"**: cápsula verde `#008F2D`, 14px/500 branco, 96x24, padding horizontal 16px.
- **"Competitivo!"**: texto 12px/400 `#788089` dentro de um bloco de 278x18, sem fundo (não é cápsula).
- **Pill de pedido** ("Despachado" etc.): cápsula 32px, 92x24, 12px/500; cor muda com o status (amarelo para Despachado; outros status não medidos).
- **Chips** de filial e canal: cinza `#E0E0E0`, 12px/500.

## Seletores de estilo estáveis
O CSS usa classes geradas (`sc-xxxx`, `MuiGrid-root-208`), que mudam a cada versão. Estáveis: `data-testid` (`order-list-item`, `go-to-order-btn`, `expand-btn`, `send-message`, `expanded-content`, `package-item-row`, `tax-fields-row`, `sku-info`) e as classes sem hash `order-list-item`, `order-list-item-simple-info`, `order-list-item-delivery-info`, `order-list-item-status`, `order-list-item-action-button`, `table--display-TableRow` (produtos).
