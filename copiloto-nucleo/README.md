# copiloto-nucleo

Núcleo multi-marketplace do Copiloto. É JavaScript puro, sem dependências, e o mesmo arquivo roda no navegador (extensão) e no Node (servidor e testes).

O núcleo não lê marketplace nenhum. Ele recebe dados já lidos, pela tela ou pela API, e faz sempre a mesma conta:

1. **Modelo único de dados** (`src/modelo.js`): fábricas e validação de Pedido, Item, Tarifa, Frete, Repasse, Devolucao, Ads, Afiliado, Promocao, Listing, CustoSKU, Imposto e Saude.
2. **Motor de lucro** (`src/motor.js`): calcula o lucro por pedido e por produto e fecha o mês. Considera tarifas padronizadas, frete, afiliado, Ads rateado por anúncio e dia, devolução, imposto com vigência e custo por SKU e por kit.
3. **Tabela de tarifas por canal com vigência** (`src/tarifas.js`): simula "e se eu vender a R$ X" e calcula o preço mínimo. Substitui o `if (canal === 'ml')` do `calc.js`.
4. **Conciliação pedido × repasse** (`src/conciliacao.js`): compara o que o canal devia pagar com o que pagou.
5. **Interface de adaptador** (`src/adaptador.js`), mais:
   - o adaptador de **exemplo do Mercado Livre** (`src/adaptadores/ml.js`), que converte os objetos que o Copiloto já produz hoje;
   - o **esqueleto do TikTok Shop** (`src/adaptadores/tiktok.js`), com conversores já testados nos retratos reais.

Nada aqui mexe na extensão (`extension-copiloto/`) nem no SellerHub. Os testes só **leem** `calc.js`, `ml-extrator.js`, `ml-tela.js` e as fixtures para conferir que as contas são iguais.

---

## Como rodar os testes

```bash
cd copiloto-nucleo
node rodar.js          # ou: npm test
```

Precisa de Node 18 ou mais novo, sem `npm install`. São 60 testes, todos com conta de verdade. A suíte também roda dentro de `tests/copiloto/rodar_todos.js`: núcleo vermelho = falha geral, e o `empacotar.ps1` não empacota.

| Arquivo | O que prova |
|---|---|
| `testes/shopee.test.js` | Adaptador Shopee (preparação, formato da Open Platform pelo servidor) com os exemplos oficiais: R$ 500 → R$ 96 e a loja recebe R$ 404; 20% + R$ 4 → R$ 4,50 em 01/10/2026; kit = 1 item; CPF + R$ 3 só acima de 450 pedidos. Cobre também o escrow que não fecha, devolução e o filtro sem dado do comprador. Campos e lacunas: `tests/copiloto/MAPEAMENTO-SHOPEE.md`. |
| `testes/tiktok.test.js` | Os 4 casos reais do financeiro do TikTok (liquidado, a liquidar com afiliado 12%, Shop Ads 3% e devolução com linha zerada). O extrato fecha no centavo, e o exemplo do MAPEAMENTO dá lucro de R$ 142,94 (25,08%). Na devolução real, o SFP fica retido e o produto se perde. Cobre também extratos, saúde e conciliação. |
| `testes/tarifas.test.js` | A vigência do TikTok (R$ 4 → R$ 6 em 15/07/2026) e os degraus da Shopee 2026. A tabela bate com o `SHC.calcular` em **300 cenários** e com o `SHC.precoMinimo`. |
| `testes/ml.test.js` | A tradução dos tipos do Fechamento e a venda da lista vista como Pedido (preço da lista **unitário** desde 01/10: receita = preço × qtd). Com as 180 cobranças reais, o total do mês fica igual ao `SHC.fechamentoDasCobrancas`, também com o texto vazio (tipo pelo código do ML em `c.id`). A etiqueta de lucro da lista (`SHC.telaVendaConta`) e o motor dão o **mesmo repasse ("Você recebe"), o mesmo lucro e a mesma classe** (lucrativo, apertado, prejuízo, sem custo e "lucro até"; a borda de margem 9,995% contra meta de 10%, lucro exatamente 0 e o carrinho de 3 produtos com o centavo no último). As demais telas são convertidas para o modelo. |
| `testes/modelo-motor.test.js` | Casos de conta completos (Shopee com 2 SKUs, estorno e Ads, cancelado, devolução), a regra "não lido nunca vira zero", o rateio de Ads, o lucro por produto, o fechamento do mês, a conciliação (ok, a menor, atrasado, grupo) e o adaptador. |
| `testes/navegador.test.js` | Os mesmos arquivos carregados como `<script>` (sem `require`) fazem a mesma conta. Nenhum arquivo usa rede, armazenamento ou `chrome.*`. |

Os testes marcados `[integrado]` e os de paridade com o `calc.js` são **pulados** quando a pasta `extension-copiloto/` não está ao lado. Dentro do `tests/copiloto/rodar_todos.js` teste pulado conta como **falha**.

---

## Como usar

**Node (servidor, cron, testes):**

```js
const CN = require('./copiloto-nucleo');
const t = CN.adaptadores.tiktok.transacaoDoExtrato(respostaDoTikTok, { conta: 'loja-1' });
const r = CN.motor.lucroPedido(pedido, { tarifas: t.tarifas, custos, imposto_pct: 6 });
// r.repasse, r.lucro_real, r.margem_pct, r.linhas (a conta linha a linha, pronta para a IA explicar)
```

**Extensão (3.2.0, TikTok):** o Chrome só carrega arquivos de dentro da extensão, então `util, modelo, tarifas, motor, conciliacao, adaptador` e `adaptadores/tiktok` são **copiados** para `extension-copiloto/nucleo/` (sem build). Mudou algum deles aqui? Copie de novo: `tests/copiloto/teste_tiktok_nucleo.js` falha se a cópia não for idêntica byte a byte. Quem usa: `extension-copiloto/tiktok.js` (`SHC.tt`).

**Navegador (extensão):** carregue os arquivos nesta ordem. Tudo fica em `window.CopilotoNucleo`.

```
src/util.js, src/modelo.js, src/tarifas.js, src/motor.js, src/conciliacao.js, src/adaptador.js,
src/adaptadores/ml.js, src/adaptadores/tiktok.js
```

---

## Modelo único

Todo registro de canal leva `canal` ('ml' | 'shopee' | 'tiktok' | 'magalu' | 'amazon' | 'shein' | 'temu'), `conta` e `fonte` ('tela' | 'api' | 'erp' | 'manual'). CustoSKU e Imposto são configuração do seller e não trazem esses três campos.

Algumas regras de formato:
- Dinheiro é guardado em centavos (`r2`).
- Dia é sempre `AAAA-MM-DD`, no horário de Brasília. O núcleo aceita ms e segundos do TikTok.
- Id grande (18–19 dígitos) é **sempre texto**. Se vier como número, a validação acusa.

**Tipos de tarifa padronizados:** `comissao, taxa_fixa, programa_frete, pagamento, frete_venda, frete_devolucao, afiliado, afiliado_ads, ads, armazenagem, imposto_canal, assinatura, outro`. Estorno usa o mesmo tipo, com valor negativo.

`M.criar(entidade, dados)` normaliza os dados, e `M.validar(entidade, obj)` lista os erros campo a campo. `M.garantir` faz as duas coisas e lança erro se algo estiver errado.

### Regra de ouro: leitura que falhou nunca vira zero

Quando uma leitura falha, o adaptador devolve `M.naoLido(motivo)`. O motor então responde `status: 'nao_lido'`, informa em `faltando` o que faltou e deixa `repasse` e `lucro_real` em `null`. Custo não informado dá `status: 'sem_custo'`. O mesmo vale para um kit com um componente sem custo: o núcleo nunca soma um custo parcial.

Tarifa estimada pela tabela só entra com `estimar_tarifas: true` e sai marcada (`tarifas_estimadas`). Um canal sem tabela na data continua "não lido".

---

## Regra de lucro única (todo canal)

```
lucro = vendas − tarifas do canal − frete a seu cargo − afiliados − Ads − devoluções − imposto − custo
```

- **Imposto** sobre a receita líquida de canceladas e devoluções: `(vendas − canceladas − reembolsos) × imposto%`. É a regra da `F.cascata` do fechamento do ML (`extension-copiloto/fechamento.js:160`) e o motor já faz assim (`motor.js:135`). Não trocar por "imposto sobre a venda cheia".
- Canal novo entra só com o adaptador (o que vendeu e o que foi cobrado). A conta é esta, a mesma para todos.
- **Pendente da 3.3.0: "Ads não lido nunca vira zero".** Hoje Ads ausente conta como 0 (`motor.js:137-140`), e o TikTok, que não informa o Ads, sai "sem Ads" sem aviso. Na 3.3.0 o Ads não lido vira "≈" e o canal sai do "melhor".

## Fórmula

```
receita         = Σ(preço × qtd) − desconto do vendedor      (o cupom da plataforma não entra: quem paga é o canal)
receita_liquida = receita − reembolso
repasse         = receita_liquida − Σ tarifas do pedido       (estorno com sinal −; 'ads' fica fora)
lucro_antes_ads = repasse − custo × qtd − receita_liquida × imposto% − outros
lucro_real      = lucro_antes_ads − Ads rateado (por anúncio e dia)
margem          = lucro_real / receita_liquida
```

Como a fórmula se aplica em cada caso:
- **Por produto:** use `lucroPorProduto(resultados)`. O custo de cada SKU é exato. O resto é dividido pela participação do item na receita, e o Ads do anúncio fica com o item daquele anúncio.
- **Mês:** use `fechamentoMes({ mes, resultados, tarifas, adsNaoRateado })`. O fechamento soma as tarifas sem pedido (fatura, Full, assinatura) e o Ads que não teve venda para ratear. Com `ads_rateados` (o padrão), a tarifa 'ads' da fatura não entra de novo.
- **Devolução:** o reembolso sai da receita. O custo do produto é contado, a não ser que `produto_voltou: true`. No TikTok, `reverse_type 2` quer dizer reembolso sem devolução: o vendedor perde o produto.
- **Cancelado:** receita, custo e imposto ficam em 0. Só conta a tarifa que sobrou depois do estorno.

---

## Tabela de tarifas (`src/tarifas.js`)

Cada linha traz `desde`/`ate`, a `faixa` de preço unitário, `pct`, `fixo` por unidade, a condição `se` e a `fonte`. A fonte tem `url`, `data` e `confianca`, que pode ser:
- `retrato`: visto na conta real;
- `codigo`: regra que o Copiloto ou o SellerHub já usa;
- `oficial`;
- `secundaria`: blog ou consultoria.

`simular()` devolve a `confianca` mais fraca entre as linhas usadas, para o painel avisar.

| Canal | Regra | Confiança |
|---|---|---|
| ML | Comissão de 13% no Clássico e 16,5% no Premium (varia por categoria; `comissao_pct` substitui). Taxa fixa: 50% do preço abaixo de R$ 12,50, R$ 6 até R$ 19, R$ 7,50 até R$ 49 e R$ 9,50 até R$ 79. Abaixo de R$ 79, fora do Full, o comprador paga o frete | código (`calc.js` = `MLCustoVenda.php`) |
| TikTok até 14/07/2026 | 6% + R$ 4 | oficial (knowledge_id 24428156307201; bate com o retrato do MAPEAMENTO-TIKTOK §1.5) |
| TikTok a partir de 15/07/2026, R$ 50 ou mais | 6% + R$ 6 por item, mais **SFP 6%** com teto de R$ 50 por item (programa de frete; a conta observada paga em todos os pedidos) | oficial (knowledge_id 24428156307201 e 5665577566734097) |
| TikTok a partir de 15/07/2026, abaixo de R$ 50 | 10% + R$ 4, mais SFP 6% | oficial (knowledge_id 24428156307201 e 5665577566734097) |
| Shopee CNPJ desde 01/03/2026 | 20% + R$ 4 abaixo de R$ 80 (R$ 4,50 desde 01/10/2026; no item bem barato o fixo é metade do preço). A partir de R$ 80, 14% mais R$ 16 (R$ 80–99,99), R$ 20 (R$ 100–199,99) ou R$ 26 (R$ 200 para cima; exemplo oficial: R$ 500 → R$ 96). Subsídio Pix de −5% no item de R$ 80 para cima, só quando o pedido diz `pagamento: 'pix'` | oficial (seller.shopee.com.br/edu/article/18483 e 26839). A faixa de R$ 500 para cima fica **a conferir no escrow / artigo 26839** (o texto oficial chegou cortado nesse trecho) |
| Magalu, Amazon, Shein, Temu | Sem linha na tabela: a simulação responde "não lido" | — |

O prazo de repasse do TikTok é a entrega + 7 dias. O `settlement_days` do `/dynamic_settlement` pode ser 3, 7 ou 31, e o valor da conta tem prioridade (`dataPrevistaRepasse(canal, entrega, dias)`).

---

## Conciliação (`src/conciliacao.js`)

`conciliar({ pedidos, tarifas, repasses, hoje, tolerancia, prazo_dias })` classifica cada pedido:

| Status | Quando |
|---|---|
| `ok` | O valor bate |
| `a_menor` / `a_maior` | O valor recebido difere do esperado |
| `parcial` | Recebeu uma parte e o resto ainda está pendente |
| `a_liberar` / `retido` | O repasse existe, mas ainda não foi liberado. Aqui a diferença é a **prevista** |
| `aguardando` / `atrasado` | Não há repasse, e o dia previsto (entrega + prazo) ainda não chegou ou já passou |
| `aguardando_entrega` | O pedido ainda não foi entregue |
| `cancelado` | Pedido cancelado |
| `agrupado` | O repasse cobre vários pedidos sem dizer quanto é de cada um. A conferência é feita no grupo |
| `nao_lido` | A leitura falhou |

Repasse repetido (mesmo id) conta uma vez. Um repasse que não é de nenhum pedido da lista vai para `sem_pedido`.

`conciliarPorMes(resultados, repasses)` serve para o ML × Mercado Pago, em que o MP não informa o número do pedido. É uma visão de tendência, não uma cobrança.

---

## Adaptadores

`criarAdaptador(def)` monta um adaptador a partir de: `id`, `nome`, `hosts` (as telas lidas só de forma passiva), `fonte` por método, `tarifa` (linhas da tabela) e os métodos que existirem entre `pedidos, tarifas, repasses, fretes, devolucoes, ads, afiliados, promocoes, listings, saude`.

- `ler(metodo, janela)` **nunca lança erro para o painel**. Ela devolve um destes três resultados:
  - `{status:'ok', dados, rejeitados}`, em que o registro inválido vai para `rejeitados` com os erros e não entra na conta;
  - `{status:'nao_lido', motivo}`;
  - `{status:'nao_informa', texto:'Este canal não informa …'}`.
- `cobertura()` lista o que o canal informa e o que não informa, para o painel.

### Mercado Livre (exemplo)

É o mesmo mapa do MERCADOS.md. Muda o embrulho, não o código do Copiloto.

| Método | Converte |
|---|---|
| tarifas | `SHC.mlCobrancasDaResposta` → `tarifasDasCobrancas`. O tipo vem do `SHC.tipoCustoFechamento` da extensão quando ela está carregada (texto + código do ML em `c.id`); sem a extensão, da cópia de reserva v3.4 em `ml.js`, conferida contra a original no `ml.test.js`. Os tipos mudam de nome assim: tarifa_venda vira comissao (e taxa_fixa, quando se sabe o preço); cobranca_mp, recebimento e parcelamento viram pagamento; full vira armazenagem; minha_pagina vira assinatura; impostos_ml vira imposto_canal; devolucao vira frete_devolucao |
| pedidos | `SHC.mlVendasDaLista` → `pedidoDaVenda`. A conta da etiqueta (`SHC.telaVendaConta`) passa por `contaDaVenda` (o `teto` diz que o frete grátis ainda não foi lido: "lucro até"); `classeEtiqueta(r, teto, margem_alvo_pct)` dá a classe da etiqueta (margem sem arredondar contra a meta, como a extensão). `SHC.vendasDasCobrancas` → `pedidosDasCobrancas` dá pedidos parciais, ainda sem preço |
| repasses | `SHC.mpAtividadesDoEstado` → `repassesDoMP` |
| fretes / devolucoes | `SHC.freteDasCobrancas` / `SHC.devolucoesDasCobrancas` |
| ads | `SHC.adsAnuncios` → `adsDosAnuncios`, por período. Anúncio de catálogo sem MLB não é rateado e vai para o fechamento |
| afiliados / promocoes / listings | `SHC.afilPedidos` / `SHC.mlPromosDoEstado` / `SHC.mlAnunciosDoEstado` |
| saude | `SHC.mlPosVendaDoEstado` + `SHC.alertasConta` |

`criarAdaptadorML({ conta, fontes })` recebe funções que devolvem esses objetos. Quando uma fonte falta, o método some.

### TikTok Shop (esqueleto)

Os campos vêm de `tests/copiloto/MAPEAMENTO-TIKTOK.md`, e as fixtures foram copiadas, anonimizadas, para `testes/fixtures/`.

- `transacaoDoExtrato` lê o `statement/transaction/detail` e devolve receita, tarifas, frete (custo, cliente, subsídio e peso cobrado), repasse, afiliados e canal de venda (Live, Video ou Product card). Também confere se o valor calculado bate com o `settlement_amount`.
- `juntaPorPedido` soma um pedido que aparece em mais de um extrato (devolução seguida de linha zerada) sem contar duas vezes.
- `pedidoDoDetalhe` lê o `trade/orders/get` e devolve o Pedido e a Devolucao. Traz o SKU do vendedor e o preço de origem, e o cupom da plataforma fica fora da receita. **Nada do comprador é lido.**
- `repassesDosExtratos` lê o `statement/list/detail`.
- `saudeDaConta` lê o `performance/list` e o `dynamic_settlement`.
- `criarAdaptadorTikTok({ conta, fontes })` monta o adaptador. **Ads fica de fora** ("este canal não informa o gasto com anúncios"), porque o gasto fica no Ads Manager.

**Regra do canal.** Os Termos do Vendedor BR proíbem bot, scraper ou qualquer outro meio automatizado sem permissão escrita. Por isso, na extensão, o Copiloto só pode ler a resposta que a tela aberta pela seller já recebeu: sem fetch em segundo plano, sem POST e sem navegar sozinho. Para ler em volume, o caminho é o app ISV pelo servidor (`core/TikTokShopAPI.php` → `ext_copiloto_api.php`, ação `canal_dados`, que devolve este mesmo formato).

---

## Onde a IA entra (e onde não entra)

A IA nunca calcula dinheiro. O motor devolve `linhas` (a conta linha a linha), `avisos` e `faltando`. O servidor (`core/AIGateway.php`, nunca com chave dentro da extensão) pode mandar isso para um modelo barato redigir 3 linhas em pt-BR, como "por que sobrou R$ 3". A tarifa que cai em `outro` (as duas tabelas `RENOMEIA`/`TIPOS` e o aviso "tarifa não mapeada") é candidata a a IA sugerir o tipo, com uma pessoa confirmando.

## Próximos passos

- Plugar na extensão: `SHC.calcular` passa a chamar `CopilotoNucleo.tarifas.simular`. A paridade já está provada em 300 cenários.
- Conferir a Shopee no escrow real (`cron_shopee_escrow_sync.php`) e trocar as linhas `secundaria` por `retrato`.
- Criar as linhas de Magalu, Amazon, Shein e Temu só quando houver fonte. Até lá, esses canais respondem "não lido".
- Capturar um retrato de cada **POST** do TikTok (lista de pedidos, devoluções, P&L por SKU) com a tela aberta pela dona.
