# Design tokens · Shopee Seller Center (listas), medido em 08/10/2026

Medição por `getComputedStyle` em elementos reais (Chrome 155, viewport 1500×950, `seller.shopee.com.br`). Prints: `C:/xampp/copiloto-sync/design-shopee-pedidos.png` (lista de pedidos, comprador e ID borrados), `design-shopee-produtos.png` (lista de produtos), `design-shopee-ads.png` (Shopee Ads). Biblioteca de componentes própria: prefixo **`eds-`** (EDS).

## Tipografia
- Família: **Roboto** em tudo (`font-family` começa em Roboto), sem serifa.
- Base 14 px (body, linhas, botões, abas). Contador "N Pedidos": 18 px peso 500 (título "Meus Pedidos" não medido). Texto secundário (variação/SKU, método de pagamento, descrição de status): **12 px**. Tags (`eds-tag`): **12 px / 18 px de altura de linha / peso 500**.
- Pesos usados: 400 normal, 500 nome do produto e status ("A Enviar"), 600 aba ativa.
- Nome do item na lista: 14 px/500 #666, até 2 linhas. Linha de variação+SKU: 12 px #8C8C8C ("Variação: …  [SKU pai SKU variação]").

## Cores (rgb → hex)
| Uso | Valor |
|---|---|
| Laranja Shopee (marca, aba ativa, "Esgotado", ícone de promoção, botão primário outline) | rgb(238,77,45) `#EE4D2D` |
| Texto forte (preço, status, valores, abas inativas) | rgb(51,51,51) `#333333` |
| Texto corrente da linha (nome, quantidade, cabeçalho de pedido) | rgb(102,102,102) `#666666` |
| Texto apagado (descrição/SKU, preço riscado "de") | rgb(140,140,140) `#8C8C8C` / rgb(153,153,153) `#999999` |
| Link / ação de linha ("Verifique os detalhes", "Organizar Envio") | rgb(38,115,221) `#2673DD` |
| Fundo da página (body) | rgb(246,246,246) `#F6F6F6` |
| Cartão / linha de pedido | fundo `#FFFFFF`, borda 1 px rgb(232,232,232) `#E8E8E8` |
| Cabeçalho do cartão de pedido | rgba(245,245,245,.5) |
| Borda de campos e botão neutro | rgb(229,229,229) `#E5E5E5` |

Tags de estado (`.eds-tag.eds-tag__information.eds-tag--normal`):
- **warn** ("Para enviar em N horas"): texto rgb(237,165,0) `#EDA500`, fundo rgb(255,247,224) `#FFF7E0`.
- **error** ("N Cancelled"): texto rgb(255,71,66) `#FF4742`, fundo rgb(255,233,232) `#FFE9E8`.
- Tag de sucesso/info não apareceu nas telas medidas: **não medida** (não inventar).
Selo de promoção na lista de produtos ("Minha Promoção / Ongoing / Preço promo"): ícone SVG 14×14 laranja `#EE4D2D` ao lado do preço promocional (14 px #333, popover ao passar o mouse) e preço original riscado 14 px `#999`; não é uma pílula, é ícone + texto no popover. "Esgotado" na lista de produtos: texto laranja `#EE4D2D` 14 px peso 400, sem fundo nem borda (`.soldout-text`).

## Formas, bordas, espaços
- Raio: cartão de pedido **4 px**; botões **4 px**; campo de busca 4 px nos cantos externos; miniatura do produto **2 px** (borda 1 px #E8E8E8, 56×56); **tags 2 px**; sem sombra nos cartões (borda de 1 px).
- Padding: corpo do cartão `16 px`; cabeçalho do cartão `0 16 px`, altura 40; tag `0 4 px` (altura 18); botão `0 16 px`, altura 32; aba `0 4 px`, altura 48. Margem entre cartões de pedido: 16 px (inferior).
- Colunas da linha (grade EDS 24 col): item 8, preço pago 3, status 5, canal de envio 4, ações 4. Coluna de pagamento: 128 px de largura útil, texto 14/12 px.
- Botões: primário = outline laranja (borda 1 px `#EE4D2D`, texto `#EE4D2D`, peso 500, fundo transparente), neutro = fundo branco, borda 1 px `#E5E5E5`, texto `#333` peso 500; "link" = texto `#2673DD` sem borda (desabilitado fica azul claro).
- Abas (`eds-tabs__nav-tab`): 14 px, ativa laranja peso 600 com sublinhado, inativas `#333` peso 400.

## Para a etiqueta do Copiloto na lista de pedidos
- Seguir o padrão nativo: Roboto, **12 px** (igual ao método de pagamento) ou tag `eds-tag` de 12 px/18 px/500, raio 2 px, padding `0 4px`.
- Verde para margem positiva e vermelho para negativa/baixa: reaproveitar o par da própria Shopee (`#FF4742` sobre `#FFE9E8` para negativa; para positiva **não existe token verde medido**: definir verde próprio sem imitar o laranja, que é a cor de marca e de "ação/aviso").
- Largura disponível na coluna "Preço pago pelo comprador": 128 px; cabe "Sobra R$ 123,45 · 17,2%" a 12 px (≈ 125 px) só em uma linha curta; usar "R$ 123,45 · 17%" ou quebrar em 2 linhas de 12 px (a altura mínima da linha do pedido é 71 px, a coluna de pagamento usa 35).
- Contraste: texto sobre `#FFFFFF` (cartão) ou `#F5F5F5` (cabeçalho); não usar sombra, a Shopee não usa.
