# Design da Central do vendedor (TikTok Shop Brasil) — tokens das listas

Medido em 08/10/2026 por `getComputedStyle` em elementos reais, viewport 1800×1000, pt-BR. Telas: Pedidos (`/order`), Finanças › Demonstrativos por pedido (`/finance/bills`), Produtos (`/product/manage`). Prints (comprador, nº de pedido e nome da loja mascarados): `C:/xampp/copiloto-sync/design-tiktok-pedidos.png`, `design-tiktok-financas.png`, `design-tiktok-produtos.png`.
Biblioteca de componentes da tela: prefixos `p-` (Pedidos/Finanças) e `core-` (Produtos). Classes `sc-xxxx` são geradas: não usar como seletor.

## Tipografia
- Família: `TikTokFont, Arial, Tahoma, "PingFang SC", sans-serif` (herdar; a extensão não deve declarar outra).
- Corpo e células: 14px / altura de linha 20–21px, peso 400, cor `#171718` (rgb 23,23,24); preto puro `#000` em cabeçalhos de tabela de Pedidos.
- Título da página (h1 "Gerenciar pedidos"): 28px / 700. Abas de página: 16px / 500; abas de lista e sub-abas: 14px / 500.
- Cabeçalho de tabela (th): 14px / 700 em Pedidos e Finanças (500 em Produtos), cor `#000` (Produtos `#1D2129`).
- Texto secundário (data/hora, "SKU do vendedor", "Hoje, às 11:00", dica): **12px, `#6C6D6F`** (rgb 108,109,111), linha 14–20px.
- Texto de tag: 12px / 400. Botões: 14px / 500 (pequeno 12px / 500).
- Números/dinheiro: mesma fonte, sem tabular especial; `R$ 544,54` 14px/400 alinhado à direita na coluna Total; valores em destaque (soma do período) 14px/500.

## Cores
| Uso | Valor |
|---|---|
| Fundo da página | `#F5F5F5` (245,245,245) |
| Cartão/tabela | `#FFFFFF`, raio 8px, padding 24px |
| Barra superior | `#000000`, texto branco |
| Cabeçalho de tabela | `#F9F9F9` (Pedidos) / `#F5F5F5` (Finanças, Produtos) |
| Borda de célula/linha e de campo | `#D3D4D5` (211,212,213), 1px |
| Texto principal | `#171718` |
| Texto secundário | `#6C6D6F` |
| **Destaque (verde-azulado)** | **`#009995`** (0,153,149): link, ID de pedido no Finanças, item ativo do menu, botão primário, aba/sub-aba ativa |
| Fundo do destaque suave | `rgba(0,153,149,.15)` (sub-aba "Exibir por pedidos" ativa) |
| Botão neutro (fundo) | `#ECECED` (236,236,237) |
| Menu lateral, item ativo | fundo `#EEEEEE`, raio 4px, texto `#009995` |
| Aviso informativo (faixa) | `#E3E7EB` (227,231,235), raio 8px, padding 16px |
| Bolinha "Ativo" | `#2D9F4B` (8×8, raio 4) |
| Erro (texto) | classe `text-function-error` (vermelho do sistema; não medido por não haver exemplo na tela) |

## Botões, campos, tags
- Botão neutro (Filtro, Exportar, Classificar por, Carregar, Exibir detalhes): fundo `#ECECED`, texto `#171718`, 14px/500, **raio 4px**, padding `6px 12px`, altura **32px** (pequeno: altura 24px, padding `3px 8px`, 12px). Borda 0 (Pedidos/Finanças); em Produtos `core-btn` tem borda 1px transparente.
- Botão primário ("Adicionar produto"): fundo `#009995`, texto branco, 14px/500, raio 4px, altura 32px. Botão-link ("Cadastre-se agora", "Ir"): sem fundo, texto `#009995`, 14px/500, altura 22px.
- Campo de busca/seleção/data: fundo branco, borda 1px `#D3D4D5`, raio 4px, altura 32px.
- **Tag nativa** (`span.p-tag-ng.p-tag-ng-color-neutral`: "LIVE", "Amostra reembolsável", "Pedido"): fundo `#ECECED`, texto `#171718`, 12px/400, **raio 12px, padding `0 6px`, altura 20px**, sem borda. Fica entre o nº do pedido e a data.
- **Status de produto "Ativo"** (`.pulse-status`): NÃO é pílula; é texto 14px/400 `#171718` precedido de bolinha `#2D9F4B` 8×8 (margem 12px) + linha abaixo 12px `#6C6D6F` ("Hoje, às 11:00"). "Precisa de atenção" aparece como ABA (14px/500, contador `0` em cinza) e não havia produto nesse estado para medir a versão de linha; "Em análise", "Desativado", "Rascunhos", "Excluídos" idem.
- Abas (`p-tabs-header-title`, `core-tabs-header-title`): 14px/500 `#171718`; ativa sublinhada (traço desenhado por elemento filho, não medido; em sub-abas do Finanças a ativa ganha texto `#009995` + fundo `rgba(0,153,149,.15)`, raio 4px, padding `0 8px`).

## Tabelas (listas)
- Pedidos: cabeçalho 48px, padding `4px 4px 4px 16px`; linha ~93px com a célula Pedido em duas–três linhas (nº 14px/400, tag, data 12px cinza). Colunas fixas à esquerda (checkbox 36px, Pedido 236px) e à direita; Total 120px à direita.
- Finanças: cabeçalho 60px, raio `4px 0 0` no 1º canto; linha 70px, `td` padding `12px 0 12px 12px`, borda inferior 1px `#D3D4D5`; linha seguinte sem zebra.
- Produtos: cabeçalho 42px; linha 117px; mesma `td` padding.
- Espaçamento geral: grade de 4px (4, 8, 12, 16, 24). Rodapé fixo de paginação: itens quadrados, página ativa com fundo cinza claro; seletor "20/Página".
- Onde encaixar a etiqueta "Sobra R$ X · Y%": usar o molde da tag nativa (12px, raio 12, padding 0 6px, altura 20px) com texto `#171718`/fundo `#ECECED` quando neutro, e cor própria só para sinal: positivo `#2D9F4B` (o verde que a Central já usa) e negativo em vermelho do sistema; evitar o teal `#009995` (já é cor de link/ação). Alinhar com os 12px da data.
