# Copiloto — Estado por canal (ML · TikTok · Shopee) — 09/10/2026

> Documento de passagem para outro agente de IA. Medido no código (branch `copiloto`), no git (branch `copiloto-3.4.0`) e **ao vivo nas sessões do Chrome do Diego em 09/10/2026** (ML `/resumo`, TikTok `/homepage`, Shopee `Meus produtos` com 135 produtos ativos). Nada aqui é suposição de leitura de código quando diz "ao vivo".

## 1. O que é o Copiloto

Extensão Chrome (MV3, `manifest.json` v3.3.1 publicada na Chrome Web Store) que calcula o **lucro real** de cada venda usando só os números que o próprio canal mostra na tela do vendedor + o custo que o seller informa. Regras estruturais:

- **Nada sai do navegador** (sem servidor SellerHub na extensão; política aprovada na loja).
- **Nenhuma escrita externa**: o Copiloto só lê e sugere; quem clica é o seller.
- O **núcleo de conta** é a pasta `nucleo/`, cópia byte a byte de `../copiloto-nucleo/src` (7 arquivos: util, modelo, tarifas, motor, conciliacao, adaptador, adaptadores/). Mudou o núcleo → copiar de novo e rodar `tests/copiloto/teste_tiktok_nucleo.js`.
- **Consentimento por canal (3.3.1)**: nada é lido sem o aceite do termo do canal (ML: commit b66b06f; TikTok idem). Trava a replicar em canal novo.
- Erp (Tiny/Omie/Bling) com **chaves cifradas AES-256-GCM** (`segredo.js`, 3.3.1). "Apagar dados de todos os canais" num botão só (ec9b5cc).
- Suíte local: `tests/copiloto/` (116 arquivos na 3.3.1) + núcleo. Rodar antes de fechar qualquer implementação.

## 2. Mercado Livre — PRONTO (3.3.1 em produção)

Único canal com `content_scripts` fixos no manifest (`vendedores.mercadolivre.com.br`). Módulos (arquivos grandes: `ml-extrator.js` 549 KB, `ml-tela.js` 154 KB, `fechamento.js` 163 KB, `painel-lateral.js` 892 KB):

- Etiquetas de lucro na própria tela do ML (anúncios, promoções, vendas, frete, atacado, Clássico×Premium).
- Sincronização em **13 etapas guiadas** ("Etapa N de 13", `fundo/08-sincronizacao.js`): anuncios, vendasBrutas, faturamento, full, ads, posvenda, vendasAnuncio, promos, afiliados, saude, faturas, repasse, alertas — com "Tentar de novo esta parte".
- Painel lateral + painel de opções: Conciliação (fechamento de mês), Full (estoque + remessas + simulador), Ads por SKU, Canal de transmissão (agenda + pré-preencher formulário), Reputação, Perguntas, Pós-venda, Notas fiscais/certificado, Medidas, Robô de fotos (só sugere), multiconta, resumo para equipe.
- Freio anti-bloqueio: captcha ou 5×429 pausam 15 min (cd48f38).
- Filtros canônicos de venda e travas de conta em toda leitura.

**Falta (ML):** nada estrutural pendente na 3.3.1. A loja já está com pacote final (109f082, SHA a86300be).

## 3. TikTok Shop — PRONTO no modo passivo (3.3.1)

**Regra do canal (Termos BR — nada de robô):** o Copiloto NÃO chama o TikTok, não navega, não tem alarme. Só **captura passiva**: `tiktok-pagina.js` (mundo MAIN) embrulha fetch/XHR da própria página e copia a resposta de uma **lista fechada de 28 rotas/tipos** → `tiktok-tela.js` (porta privada MessageChannel) → `tiktok.js` (grava por loja). Scripts registrados só com permissão opcional concedida + `cfg.modulos.tiktok` + consentimento.

Já cobre: pedidos/liquidação, financeiro (extratos, transações, saldo, a receber), repasse, devoluções, saúde da loja, campanhas, afiliados, produtos/SKUs, etiquetas de lucro em "Gerenciar produtos" (3.3.1, `tiktok-etiqueta.js` — chips calculados no fundo com tabela do núcleo), aba TikTok no painel lateral, empresa multi-loja travada (tt:lojas).

**Falta (TikTok):** Ads é **digitado** pelo seller (`tt:<loja>:ads_manual`, sem leitura de tela); sem leitura agendada (por regra do canal mesmo — depende de o seller abrir as telas); `tiktok-aba.js` ainda é monolito (divisão por aba prometida "para a 3.3.1" e não feita).

## 4. Shopee — SÓ EXISTE NO BRANCH, E O ADAPTADOR ESTÁ QUEBRADO

### O que há
- **Branch `copiloto-3.4.0`** (8fb8700, 08/10; nasceu do 3.3.0, NÃO tem nada do 3.3.1): etiquetas de ganho por canal (`etiqueta-canal.js` 307 linhas, `etiqueta-registro.js`, `etiqueta-ajustes.js`), adaptador `shopee-lista.js` (42 linhas), `termos-canais.js` (aceite por canal), permissões opcionais `seller.shopee.com.br` + `seller.magalu.com`, testes `teste_shopee_lista/teste_magalu_lista/teste_termos_canais/teste_etiqueta_canal`. Manifest 3.4.0 continua com content_scripts só do ML — Shopee entra por `scripting` opcional.
- **Tabela de tarifas da Shopee no núcleo** (`nucleo/tarifas.js:43-56`): conferida nos artigos oficiais 18483/26839 em 30/09/2026, já com a virada de 01/10/2026 (fixo R$4→R$4,50, corte R$8→R$9, 14% acima de R$80, fixos R$16/20/26, subsídio Pix −5% ≥R$80, tabela CNPJ aplicada a todos com aviso).
- **Branch publicado `copiloto` (3.3.1): ZERO Shopee funcional.** `copiloto.js` (com código Shopee morto, não registrado no manifest) e botão "Shopee" no `popup.html` que não funciona — incoerência a limpar.
- Servidor SellerHub (fora da extensão) já tem muito de Shopee: `cron_shopee_sync/escrow/wallet/sbs/chat/ads`, `shopee/`, `p_shopee*.php`, `shopee_extension_receiver.php`, docs `SHOPEE_API_REFERENCE.md` etc. — referência útil de campos, mas a extensão não pode depender de servidor.
- GitHub `deegoll/copiloto`: só o pacote da revisão de segurança (nucleo+extensão+deploy+tests), texto "só ML". **O branch 3.4.0 nunca foi para o GitHub.**

### Medido AO VIVO em 09/10/2026 (conta comercial_vip, seller.shopee.com.br/portal/product/list/live/all)
A tela "Meus produtos" é uma **`eds-table` de colunas separadas** — e o `shopee-lista.js` assume linha única. Consequências comprovadas:

1. **Preço fora da linha**: dos 12 produtos da página 1, só 2 têm `.list-view-price` dentro de `.product-variation-item` (os 2 com "Minha Promoção"). Os outros 10 preços (ex.: `R$519,99`, faixas `R$204,99 - R$279,99`) estão em **células `.eds-table__cell` da coluna "Preço"**, fora do DOM da linha → o adaptador não os vê e a etiqueta não sairia.
2. **Riscado não é `<del>`**: é a classe `price-campaign-del` (span/div). A limpeza `querySelectorAll('del,...')` do adaptador não remove → risco de pegar preço antigo no `Math.min`.
3. **Paginação**: 135 ativos, 12 por página (opções 12/24/48; "1/12"). O adaptador lê só a página visível.
4. **Variações**: 4 linhas com "Ver Mais" fechado (`.product-more-models`); `.model-list-item` só existe quando expandido. Coluna "SKU ID" separada está disponível — é a chave certa para casar linha×coluna em vez de índice.
5. O que **continua válido** no adaptador: seletores `.product-name-wrap`, `.product-sku` ("SKU principal: X"), `.variation-name-info-sku` ("SKU da Variação:"), `.list-view-model-price`, balão `.eds-popper` (removível), URL_OK.

## 5. Regras e governança que valem para a extensão (dos registries e docs)

- **A string "Copiloto" não existe no `../CLAUDE.md`** (6.477 linhas) — a governança da extensão vive nela mesma: `AGENTS.md`, `VERSOES.md`, `NOVIDADES-*.md` e este documento. Os `.review/*_registry.md` quase não cobrem a extensão; a única ponte direta é **F-047**: a fonte única de tarifas é `core/TarifasCanal.php` (servidor), **espelhada** em `copiloto-nucleo/src/tarifas.js` → `nucleo/tarifas.js` (mapa em `tests/copiloto/TARIFAS-DEPLOY.md`). Mexeu em tarifa, mexe nos dois.
- **D-004 (decisão)**: margem bruta = GMV − comissão − Ads − descontos, com **FRETE FORA** — cobertura variável de frete já fabricou queda falsa 91%→38,6% na plataforma. Qualquer número novo de frete na extensão precisa declarar a base.
- **D-018/D-019**: frete do vendedor ML medido por `senders[].cost`; o que não dá para medir não vira número; log de mudança de frete só compara par comparável.
- Filtros canônicos (CLAUDE.md ~1210): ML `IN ('paid','confirmed')`; Shopee `NOT IN ('CANCELLED','IN_CANCEL','TO_RETURN','UNPAID','INVOICE_PENDING','')` — desvio exige `-- filtro-ok:` e o guard `tests/check_filtro_canonico.php`.
- **Publicação (VERSOES.md)**: na Chrome Web Store estão 3.0.0–3.2.1. **3.3.0 e 3.3.1 estão prontas e NÃO enviadas** (pacote 3.3.1 SHA a86300be). Envio só com OK da dona; conferir com `node deploy/conferir-pacote.js`. Pendências humanas da 3.3.1 (NOVIDADES): OK do Diego + advogado nos textos de consentimento, política nova no ar antes do envio.
- `docs/` tem material de referência da PLATAFORMA (não da extensão): `SHOPEE_API_REFERENCE.md`, `SHOPEE_ISV_PARTNER_REQUEST.md`, `SHOPEE_FULL_SBS_REQUEST.md`, `PARIDADE_CANAIS.md`, `DORES_2026_GAP_E_MELHORIAS.md`, `ml_aprender/04_mercado_envios.md` (frete ML) e mais 47 arquivos com menção a Shopee.

## 6. FRETE por canal — regra no código + tela medida ao vivo 09/10/2026

### Mercado Livre (o único com modelo de frete completo)
- **No código**: `LIMITE_FRETE_GRATIS_ML = 79` (`calc.js:10`; `<79` fora do Full → comprador paga, `calc.js:188-200`; espelho no núcleo `nucleo/tarifas.js:66-68`). Frete entra em `recebeRs = preço − comissão − taxaFixa − frete` (`calc.js:224`). Modalidades (`LOGISTICA-ML.md:12-22`): ME2/Coleta/Drop-off/Flex/Full/ME1; Flex = bônus do ML, não frete; peso volumétrico (C×L×A)/6.000 (`LOGISTICA-ML.md:29`). Custo de envio = faixa de PESO × faixa de PREÇO (`MAPEAMENTO-ML.md:127-130`). Conciliação de "frete cobrado por venda": `SHC.freteDasCobrancas` + `SHC.conciliaFrete` (`ml-extrator.js:1333-1356, 1925-2023`), régua = frete do anúncio NO DIA da venda, `pagoAMais` se dif > max(R$1, 5%); persistência em `fundo/03-faturamento.js:221-326`. Trava de texto: sem prova, a tela diz "para conferir", nunca "contestar" (`ml-extrator.js:5818-5822`).
- **Telas medidas hoje**: `/shipping` redireciona a `/resumo`; as páginas reais são **"Gestão de envios Full"** (`/shipping/inbounds` — remessas com Declaradas/Aptas, Data reservada, **Custo aplicado**, Status; na conta vista: 1 remessa #75751266 cancelada 10/−) e **"Métricas de envios"** (`/metricas/desempenho-em-envios` — exposição atual/prevista "Excelente/Chegará amanhã", **envios no prazo 99% (145/146)**, histórico semanal com antecipados/atrasados que afetam ou não a reputação, botão "Baixar relatório de envios"). O Copiloto já cobre Full e conciliação; o painel de métricas de desempenho em envios NÃO é lido hoje.

### Shopee
- **No código**: **não existe modelo de frete** — `FRETE` do núcleo só tem `ml` (`nucleo/tarifas.js:66-68`); o tarifário Shopee é só comissão/fixo/subsídio Pix (`:45-56`). O frete real por venda só aparece no extrato de repasse (não lido pela extensão).
- **Tela medida hoje**: `/portal/shipping` é **404**; a página real é **"Configurações de Envio › Canal Logístico"** (`/portal/all-settings/shipping/shipping-channel`): 4 canais com `eds-switch--open` (Entrega Direta "Novo", Expresso Aéreo, Retirada pelo Comprador, **Shopee Xpress**), abas "Não-Turbo" e "Canais de Envio Integrados" (exige impressora para etiqueta), + "Documento de Envio", "Horário de Funcionamento", "Devolução Fácil Shopee". A tabela de preço do frete por peso/zona da Shopee NÃO está nesta tela — para o custo real por venda vai precisar da lista de ordens/extrato.

### TikTok Shop
- **No código**: frete da entrega **não entra na etiqueta** — "o TikTok só mostra/depois mede o peso" (`tiktok-etiqueta.js:3-5`, `tiktok.js:698-700`). O que existe é **tarifa SFP 6% com teto R$50/produto**, automática para todo vendedor (`nucleo/tarifas.js:41, 60-64`), e `frete_venda` só quando vem do total do TikTok (`tiktok.js:433-440`). Repasse D+7 (`nucleo/tarifas.js:69-72`).
- **Tela medida hoje**: `/account/shipping` redireciona; as páginas reais são **"Envio" (`/logistics/fulfillment-setting`)**, **"Enviando" (`/logistics/fee-and-service`)**, "Armazéns" (`/logistics/warehouse-setting`) e **"Desempenho de envio" (`/health-center/fulfillment-performance`)**. Na `fee-and-service?tab=delivery-setting`: "Enviado pela plataforma" (Entrega padrão) — **peso 0–30kg, volume máx 100×100×100cm, soma máx 200cm, sem pagamento na entrega**. A tabela de taxas por peso não estava renderizada na aba vista (SPA sem tabs acessíveis; precisa de clique na própria tela — e a regra do canal proíbe a extensão navegar sozinha).

## 7. O que falta para a Shopee ficar no nível dos outros canais (ordem proposta)

1. **Reescrever `shopee-lista.js`** contra a eds-table de colunas (prova ao vivo acima): casar produto↔preço por SKU ID/alinhamento de células, tratar `price-campaign-del`, paginar (48/página) e expandir "Ver Mais" para variações. Manter a filosofia: só ler o que a tela já mostra.
2. **Fundir `copiloto-3.4.0` com a linha 3.3.1** — hoje o 3.4.0 não tem: termo de consentimento (o `termos-canais.js` do 3.4.0 é rascunho anterior ao padrão ML/TikTok de "Concordo e ligar"), cifragem AES dos ERPs, "Apagar dados de todos os canais" cobrindo Shopee, sincronização guiada por etapa, LEIA-ME espelhado. Fazer o merge e **reaplicar as travas da 3.3.1 ao canal novo**.
3. **Etiqueta na tela certa**: validar na conta real (etiqueta só onde há preço legível; faixa `R$a - R$b` → usar menor + avisar `faixa:true`, como o adaptador já faz).
4. **Depois da etiqueta — Vendas/Faturamento**: hoje o cálculo Shopee é "tabela estimada" (`calc.js:166-259`). O salto de valor é ler a **lista de ordens** (comissão, taxa fixa, frete real por venda) e o extrato (semelhante ao que o TikTok faz por captura passiva — avaliar se os Termos BR da Shopee permitem o mesmo modo; senão, só leitura de tela como os etiquetas).
5. **Limpeza da 3.3.1 publicada**: tirar o botão "Shopee" do `popup.html`/`copiloto.js` mortos OU registrá-los de verdade (não deixar remanescente que fere a descrição da loja).
6. **Loja e GitHub**: ficha/descrição do manifest ("Mercado Livre e TikTok Shop") precisam de seção Shopee; política de privacidade com o domínio novo; justificativas de `práticas de privacidade` para `seller.shopee.com.br`; subir o branch para `deegoll/copiloto` antes da revisão de segurança.
7. **Magalu** está no mesmo batch do 3.4.0 (`magalu-lista.js` + PLANO-MAGALU, commit ac3f24f) — decidir se vai junto ou depois; não prometer os dois na mesma submissão sem os testes ao vivo.
8. **Frete na Shopee (descoberto hoje)**: sem modelo de frete no núcleo e sem custo de envio na tela de configurações — o custo real por venda só sai de Ordens/Extrato (item 4). Até lá, a etiqueta Shopee é lucro **sem frete**, e o texto da loja não pode prometer frete da Shopee.

### 7.1 Lacunas por código — funções Shopee do branch 3.4.0 (lidas em 09/10/2026)

> **JÁ FEITO — NÃO SOBREPOR (sessão de 09/10/2026, agente Qoder):** as lacunas **1, 2 e 9** foram corrigidas e commitadas no branch **`c340/shopee-corrigida`** (nasce de `copiloto-3.4.0` 8fb8700; commit **07eacb7**), no worktree `../.tmp-shopee-corrigida` (pode ser removido com `git worktree remove` depois da fusão — o branch é a unidade que importa).
> - `shopee-lista.js` reescrito: pareamento linha↔célula da coluna "Preço" por índice **só com contagens batendo** (senão vale o inline; nunca por chute), riscado `price-campaign-del` fora da conta, balão `.eds-popper` só para baixar preço, linhas `.eds-table__row-expanded`/`.model-item` excluídas do zip, `estadoLista()` com cobertura da página. **Validado AO VIVO na conta comercial_vip: 12/12 produtos com preço (antes: 2/12).** Detalhe medido: cada coluna da eds-table é uma `<table>` própria — as células de preço ficam FORA de `.product-list-container`.
> - `teste_shopee_lista.js` refeito com a estrutura real de 09/10 (campanha inline, preço só na coluna, faixa, mãe com variações em `.view-more`, zip quebrado → null). Verde, junto com `teste_etiqueta_canal/teste_termos_canais/teste_magalu_lista/teste_tiktok_lista`.
> - **O que continua em aberto (3 a 8, 10 e 11): nada disso foi tocado.** A fusão `c340/shopee-corrigida` → linha 3.3.1 deve levar ESTE adaptador (não o do 8fb8700) e resolver as lacunas restantes na ordem da lista.

O que JÁ existe e é sólido: motor `etiqueta-canal.js` (Shadow DOM, custo via janelinha "Informar custo" com `SHC.salvarCustoSku`, faixa de variações só com custo em todas, MutationObserver com piso de 400 ms, MAX_LINHAS 400, limpeza no `parar`), registro no fundo `etiqueta-registro.js` (script só com permissão `scripting` + origem + `cfg.etiquetas[canal]` + aceite dos termos; re-sincroniza em `permissions.onAdded/onRemoved` e mudança de `cfg`), tabela do núcleo e caminho `calcular('sp')` com aviso "sem tabela", testes do adaptador/termos/etiqueta.

Falta / corrigir:

1. **`shopee-lista.js` não enxerga o preço de ~80% da tela** (medido hoje): preço mora na coluna "Preço" da `eds-table`, fora de `.product-variation-item` (`ler` → null → "preço não lido"). Reescrever casando produto↔preço pela coluna "SKU ID" ou pelo alinhamento de linhas das células.
2. **Riscado não removido**: `preco()` limpa só `del, .eds-popper, svg`; o riscado real é `price-campaign-del` e o preço promocional do balão entra no `Math.min` — pode sair preço errado. Testar com a estrutura de hoje.
3. **Sem paginação**: 12/página, 135 produtos → etiqueta cobre 12. O motor não tem noção de "página atual"; precisa ao menos rotular a página visível e dizer quantos de N estão cobertos (e deixar 48/página aproveitado).
4. **Variações atrás de "Ver Mais"**: `.product-more-models` é pulado; sem expandir, produto com variações fechadas fica sem conta certa.
5. **Duas contas no motor**: Shopee usa `SHC.calcular('sp')` (calc.js) e TikTok usa `CopilotoNucleo.tarifas.simular` direto — unificar no núcleo na fusão, senão a tabela diverge (F-047).
6. **Consentimento em dois padrões**: 3.4.0 criou `termos-canais.js` (rascunho "3.4.0-rascunho", aceite só no `painel.html`, gate `cfg.etiquetas[canal] + T.aceito`), enquanto a 3.3.1 usa "Concordo e ligar" (`consentimento_<canal>` + `cfg.modulos[canal]` + `MODULOS_TRAVADOS`, quadro no painel lateral). Na fusão, Shopee tem de entrar no padrão 3.3.1 (o `etiqueta-registro.js` NÃO checa `cfg.modulos.shopee`).
7. **"Apagar dados" não cobre Shopee**: o painel-lateral atual (linha ~2871) diz que leitura "não tem o que apagar" — mas há `cfg.termos.shopee`, `cfg.etiquetas.shopee` e a permissão de origem a devolver; incluir no botão único.
8. **Painel lateral sem seção Shopee**: ligar/desligar etiqueta e ver o aceite só existe no `painel.html` do 3.4.0; a tela que o seller usa todo dia (lateral) não tem.
9. **Teste do adaptador desatualizado**: `teste_shopee_lista.js` usa página inventada com a estrutura ANTIGA (linha única com preço dentro) — verde para uma tela que não existe mais; refazer com a eds-table medida hoje + um caso de paginação.
10. **Multiempresa**: custo é por SKU global (ok para etiqueta), mas quando a Shopee passar a ler vendas/faturamento vai precisar da trava de conta/empresa que ML (`conta conferida`) e TikTok (`tt:lojas`) têm.
11. **Empacotar/loja/GitHub**: ficha, descrição do manifest ("Mercado Livre e TikTok Shop") e política sem o domínio `seller.shopee.com.br`; branch 3.4.0 nunca foi para `deegoll/copiloto`.

## 8. Como trabalhar neste código (regras da casa)

- Ler `../CLAUDE.md` e `../AGENTS.md` antes de alterar; achados/decisões em `../.review/*_registry.md` — não reabrir assunto sem evidência nova.
- Testes: `node tests/copiloto/rodar_todos.js` (suíte local; node nem sempre está no PATH do filho — usar `process.execPath`). Toda tela nova = teste com página inventada + conferência ao vivo datada no comentário do arquivo.
- Textos e política da loja: `../deploy/copiloto-chrome-web-store/` (LEIA-ME, espelhar-politica-leia-me.js, empacotar.ps1). Submeter à loja **só com OK do dono**.
- Convenção dos comentários: português, data de conferência ao vivo ("seletores conferidos ao vivo em DD/MM/AAAA") — manter, é o que prova a validade dos seletores.
- Chrome para inspeção ao vivo: Browser Connector (`user-browser-use`) na sessão logada (comercial_vip na Shopee; ML e TikTok logados no mesmo Chrome).
