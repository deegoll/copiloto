# Revisão automatizada (IA) de prontidão para a Chrome Web Store (07/10/2026)

> **Escopo:** o pacote do ramo `copiloto-v3.3.0` deste repositório, gerado pela nuvem (SHA-256 `a037454e…6e68`, **sem o TikTok Shop**). A 3.3.0 que vai para a loja é a do projeto local, com o TikTok Shop ligado; a política no ar descreve essa versão. Use este relatório assim:
> - **Achados de código (seção 4):** corrigidos neste ramo (ver NOVIDADES-3.3.0.md, "Auditoria de prontidão para a loja"). Na 3.3.0 local, o frete não tem texto de contestação (regra da dona); o resto vale.
> - **Política, ficha e formulário (seções 1 a 3):** os textos propostos tiram o TikTok porque este pacote não o tem. Na 3.3.0 local, **mantenha o TikTok** e aplique só o que não depende dele: experiência de compra e "Outra empresa" na política, o id e o nome da conta como dado de identificação no formulário, a aba do Mercado Ads em segundo plano na justificativa de host e a troca da estatística de 10% sem fonte.
> - Feita por 49 agentes (5 frentes e céticos que tentaram derrubar cada achado). Nada foi publicado e o painel da loja não foi aberto.

# Copiloto 3.3.0: prontidão para a Chrome Web Store

## 1) Veredito: ENVIAR DEPOIS DE CORRIGIR

**Por que não há bloqueador no pacote:**
- Nada no zip viola política da loja.
- O manifest só muda a `version` em relação à 3.2.1. As permissões são idênticas, então não há aviso de permissão nova.
- Não há código remoto: nenhum script externo, `eval` ou `new Function`, e vale a CSP padrão do MV3.
- O zip tem 55 arquivos, iguais byte a byte a `extension-copiloto/`.
- O SHA-256 do zip é `a037454ecabdf008d534c6f1d7b0849d50f70291e2581c7e2ccb5b6327116e68`. Conferi com `sha256sum` e é o mesmo de `VERSOES.md:11`.

**Por que não dá para enviar como está:** quatro pontos precisam ser resolvidos antes.
1. **Política de privacidade no ar (alto).**
   - A página publicada diz que a 3.3.0 traz o TikTok Shop, com as permissões "scripting" e seller-br.tiktok.com (linhas 16, 41 e 42 da página). O pacote não traz nada disso: veja `calc.js:44` `MODULOS_TRAVADOS=['tiktok']` e o manifest, que não tem essas permissões.
   - Ela também não descreve o que a 3.3.0 realmente mudou.
   - Regras: User Data Policy (a política precisa ser exata) e informação errada para o usuário.
2. **Formulário de privacidade (médio).**
   - Marca "As demais: não" (`privacidade-loja.txt:82`), mas a extensão guarda o id e o nome de exibição da conta do vendedor (`store.js:295-302`). O FAQ da User Data Policy, item 4, conta "username" e "account number" como dado pessoal (PII).
   - A justificativa de storage não cita a experiência de compra nem as credenciais, e diz "Nada é enviado a servidor algum", o que é falso para o token do ERP.
3. **Descrição da ficha (médio).** O texto atual é o da 3.2.x. O `deploy/cws-publicar.js:3-4` só troca o pacote, então a descrição precisa ser colada à mão no painel antes do envio. Regra: Program Policies › Listing Requirements, item 2.
4. **Código: frete "confirmado" falso (alto).**
   - Na 3.3.0, um frete casado com a venda pelo anúncio e pela data, e não pelo número do pedido, vira "Frete cobrado a mais (confirmado)" e gera "Contestação de cobrança indevida" com estorno.
   - Isso acontece mesmo quando as duas cobranças estão certas. Reproduzi com `sonda_par.js`, e acontece também com fretes lançados em dias diferentes.
   - A loja não rejeitaria por isso. Mas é dado errado para o vendedor e um texto falso enviado ao Mercado Livre, e o erro nasceu na 3.3.0 com a comparação pelo frete do dia da venda.

**Recomendado no mesmo novo empacotamento, sem bloquear a loja:** os 6 problemas médios nos textos de contestação (seção 4). O zip já vai ser refeito por causa do ponto 4, e esses textos contradizem o próprio NOVIDADES-3.3.0.md:25 e :39.

**Não precisa mexer agora:**
- Código do TikTok desligado no pacote: já foi assim na 3.2.0 e na 3.2.1.
- Credenciais do ERP guardadas sem cifra (baixo): passou na 3.2.1.
- Estatística de 10% que ainda aparece na tela.

---

## 2) Checklist de envio

**Antes de abrir o painel**
1. Aplicar a correção 4.1 e, de preferência, as 4.2 a 4.7. Depois:
   - rodar `empacotar.ps1`, que tem o portão de testes;
   - anotar o novo SHA-256 em `VERSOES.md`;
   - fazer o commit de `extension-copiloto/` e criar a etiqueta `copiloto-v3.3.0` nesse commit (`VERSOES.md:23`).
   A versão continua 3.3.0, porque nunca foi enviada. Se nada de código mudar, o zip atual (`a037454e…6e68`) serve.
2. Política de privacidade:
   - Salvar uma cópia do HTML que está no ar, a versão com TikTok, como rascunho para quando o TikTok for liberado.
   - Aplicar o bloco 3.A sobre o HTML no ar, nunca sobre o `politica-privacidade.html` do repositório, que é de 01/10 e está errado.
   - Publicar na mesma URL: `https://especialistaemmarketplace.com.br/sellerhub/copiloto/privacidade.html`.
   - Conferir com `curl`: "TikTok" só pode aparecer no item (4) de "O que mudou", e "Experiência de compra" e "Outra empresa" precisam estar presentes.
3. Atualizar no repositório (fonte única dos textos):
   - `politica-privacidade.html`: trocar pela versão publicada;
   - `descricao-loja.txt` e `privacidade-loja.txt`: trocar pelos textos da seção 3;
   - `ficha-loja.txt:51`: deixa de mandar publicar o arquivo de 01/10.
4. Pegar o OK da dona (`VERSOES.md:25`).

**No painel da loja**
1. **Pacote.**
   - Enviar o novo pacote `copiloto-v3.3.0.zip` e conferir que aparece a versão 3.3.0, sem permissão nova.
   - Se usar `node deploy/cws-publicar.js`, faça os passos 2 e 3 no painel antes do `--enviar`.
2. **Ficha da loja.**
   - Descrição: colar o texto 3.C.
   - Bloco de novidades (3.D): opcional, no topo da descrição. Se usar, tire na próxima versão.
   - Resumo: não mexe (128 caracteres, igual ao manifest).
   - Capturas: manter, porque não há achado sobre elas.
   - Salvar.
3. **Práticas de privacidade.**
   - Propósito único: colar 3.B.1.
   - Justificativa de storage: colar 3.B.2.
   - unlimitedStorage, alarms, sidePanel, background e identity: manter os textos atuais (`privacidade-loja.txt` linhas 14, 19, 24, 29 e 34).
   - Permissões de host:
     - se o painel tiver um campo só, colar 3.B.3;
     - se tiver um campo por domínio, colar 3.B.4 em pa.mercadolivre.com.br e manter os demais (linhas 39, 49, 54, 59, 64 e 69).
   - Código remoto: "Não" (linha 74).
   - Uso de dados:
     - manter marcados "Conteúdo do site", "Informações financeiras e de pagamento" e "Informações de autenticação";
     - marcar também "Informações de identificação pessoal" (3.B.5).
   - As 3 certificações: marcadas.
   - URL da política: a mesma (linha 92).
   - Salvar.
4. **Distribuição.** Nada muda, porque não há achado sobre visibilidade, regiões ou público. Só conferir que continua como na 3.2.1.
5. **Enviar para análise.** Depois de aprovado, atualizar a situação da 3.3.0 em `VERSOES.md`.

---

## 3) Textos finais para colar

### 3.A Política de privacidade (aplicar sobre o HTML no ar)

**3.A.1 Tirar o TikTok Shop.** Ele não está na 3.3.0 e aparece como disponível em vários parágrafos, então é melhor tirar do que só pôr um aviso.
- **"Em resumo":**
  - apagar "e, se você ligar, das telas do TikTok Shop que você abre";
  - trocar "Você pode desligar as funções opcionais, como o TikTok Shop, apagar" por "Você pode desligar as funções opcionais, apagar".
- **1º parágrafo:**
  - apagar "e, se o vendedor ligar, do TikTok Shop";
  - apagar a frase "Com o TikTok Shop ligado em Ajustes, cada aba mostra também o TikTok Shop, com um filtro de canal (Todos, Mercado Livre, TikTok Shop), menos o Full, que o TikTok Shop não tem no Brasil.";
  - trocar "não é afiliado ao Mercado Livre nem ao TikTok" por "não é afiliado ao Mercado Livre".
- **"O que a extensão lê":** apagar "Do TikTok Shop, veja a parte "TikTok Shop", abaixo."
- **"O que a extensão faz na página":** apagar "No TikTok Shop, a extensão não clica, não preenche e não muda nada na loja: só lê (veja "TikTok Shop", abaixo)."
- **"O que o vendedor informa":** apagar a frase que começa em "Se ligar o TikTok Shop:" e termina em "Não uso Ads no TikTok"."
- **"Onde ficam os dados":** apagar "No TikTok Shop, a extensão não faz nenhuma chamada: só lê, neste Chrome, o que a tela do TikTok já recebeu."
- **"Dados de compradores":** apagar "Do TikTok Shop também não guarda nada do comprador (veja "TikTok Shop", abaixo)."
- **"Dados que só passam pela memória":** trocar "As páginas do Mercado Livre e as respostas das telas do TikTok Shop chegam" por "As páginas do Mercado Livre chegam".
- **Partes do TikTok:** apagar inteiras as partes de "TikTok Shop. Esta parte vale só…" até "TikTok Shop: como desligar e apagar", inclusive a lista de telas.
- **"Como apagar":** apagar "Do TikTok Shop, "Apagar dados do TikTok", em Ajustes, apaga o que foi guardado do TikTok neste Chrome."
- **"Por quanto tempo":**
  - trocar `"Desconectar" e, do TikTok Shop, "Apagar dados do TikTok")` por `"Desconectar")`;
  - apagar "Do TikTok Shop, veja "TikTok Shop: onde fica e por quanto tempo", acima."
- **"Quem somos e base legal":**
  - apagar "e ao ligar o TikTok Shop";
  - trocar "o Mercado Pago, o TikTok e o Tiny" por "o Mercado Pago e o Tiny".

**3.A.2 "O que mudou nesta versão":** substituir o bloco inteiro e a data.
> O que mudou nesta versão (Copiloto 3.3.0). (1) Experiência de compra dos anúncios: quando uma tela do painel do vendedor que ele abre já traz esse dado, o Copiloto guarda a nota e os problemas que o Mercado Livre aponta em cada anúncio, sem nenhum dado do comprador, para avisar quando a nota cai e para não sugerir envio ao Full de anúncio com experiência de compra ruim (veja "O que a extensão lê"). (2) Contas de outra empresa: com duas ou mais contas no mesmo Chrome, o vendedor pode marcar uma conta como de outra empresa; custos por SKU, imposto, margem, despesas fixas e ERP passam a ficar separados para ela (veja "Onde ficam os dados" e "Como apagar"). (3) Textos de contestação: o Copiloto monta, para o vendedor copiar, a reclamação de uma remessa do Full e o pedido de exclusão de reclamação, só com dados que já guardava (como o número do pedido e o motivo da reclamação); a extensão não envia esses textos. (4) O TikTok Shop saiu desta política, porque não faz parte da versão 3.3.0: ela não pede as permissões do TikTok ("scripting" e seller-br.tiktok.com) e não lê nada do TikTok. Nenhuma permissão nova e nenhum dado novo de comprador.
> Atualizada em __/10/2026, para a versão 3.3.0 do Copiloto.

**3.A.3 "O que a extensão lê":** acrescentar no fim.
> Experiência de compra dos anúncios: quando uma tela do painel do vendedor que ele abre já traz a experiência de compra de um anúncio ou de um produto, a extensão copia dessa tela, sem fazer nenhuma consulta a mais, só estes dados: a nota de 0 a 100; a faixa (boa, mediana ou ruim); se o anúncio foi pausado ou moderado por causa dela; se está protegido por benefício de reputação; o período da medição; os problemas apontados pelo Mercado Livre (o tipo, o título, a quantidade de reclamações e de cancelamentos e a solução sugerida); e os textos de motivo e de recomendação que o Mercado Livre mostra. Esses dados não trazem nada do comprador. Nos avisos da lista de Anúncios entram também os de exposição, experiência de compra, moderação e qualidade.

**3.A.4 "Onde ficam os dados":** acrescentar antes da frase de Uso Limitado.
> Da experiência de compra, fica guardado, por conta do Mercado Livre, o último registro de cada anúncio ou produto (descrito acima) e a nota da leitura anterior, para avisar quando ela cai. Contas de outra empresa: com duas ou mais contas do Mercado Livre no mesmo Chrome, o vendedor pode marcar em Ajustes uma conta como "Outra empresa". Os custos por SKU, o imposto, a meta de margem, as despesas fixas e o ERP dessa conta (o token ou as chaves e os produtos lidos) ficam guardados à parte, só para ela, no mesmo chrome.storage.local. Assim, pode haver no mesmo Chrome um token do Tiny ou chaves do Omie ou do Bling para cada empresa. Cada um só é enviado ao próprio ERP.

**3.A.5 "Por quanto tempo":** acrescentar.
> A experiência de compra de cada anúncio fica até ser trocada por uma leitura nova ou até o vendedor remover a extensão.

**3.A.6 "Como apagar":** acrescentar.
> Com contas de outra empresa, "Esquecer token", "Esquecer chaves" e "Desconectar" apagam só o ERP da empresa da conta que está aberta no Mercado Livre; para apagar o de outra empresa, abra a conta dela e use o mesmo botão. Ao desmarcar "Outra empresa", os custos, os números e o ERP que eram só dessa conta deixam de aparecer, mas continuam guardados neste Chrome até a conta ser marcada de novo e o vendedor apagar, ou até ele remover a extensão.

**3.A.7 "O que a extensão faz na página":** acrescentar no fim. Se o parágrafo disser "Três pontos", trocar por "Quatro pontos".
> Textos de contestação: o Copiloto monta textos prontos (frete, cobranças, tarifa de devolução, medidas, remessa do Full com inconformidade e pedido de exclusão de reclamação) só com os números que já guarda, como o número do pedido e o motivo da reclamação. O texto só é copiado quando o vendedor clica em Copiar; quem envia ao Mercado Livre é o vendedor.

**3.A.8 "O que o vendedor informa":** só depois de aplicar a correção 4.10, acrescentar.
> O token e as chaves ficam guardados cifrados (AES) neste Chrome e só são enviados ao próprio ERP.

### 3.B Formulário de privacidade

**3.B.1 Propósito único (764 caracteres):**
> Mostrar ao vendedor do Mercado Livre a rentabilidade real e a saúde dos seus anúncios (promoções, frete, Full, Ads, fechamento do mês, notas e dados fiscais, fotos, medidas, visitas, faturamento por família, pós-venda, perguntas, reputação e remessas), com os números do próprio painel do vendedor e com o custo que ele informa. A extensão só lê o painel; as exceções são a Agenda do Canal de transmissão (pré-preenche o formulário e o vendedor clica em Criar), a calculadora do Simulador de custos e a busca de NF-e (só consultas). Os robôs de fotos e de promoções apenas sugerem; o robô do Canal (desligado até o vendedor ligar) só monta a agenda. Nada vai para o desenvolvedor nem para terceiros; as credenciais do ERP que o vendedor conectar vão só a esse ERP.

**3.B.2 storage (886 caracteres):**
> Guardar só no navegador do vendedor o que a extensão precisa entre uma leitura e outra: custos por SKU e configurações (imposto, margem, metas, despesas fixas, regras dos robôs e dos avisos), separados por empresa quando o vendedor marca uma conta como "Outra empresa"; o retrato dos anúncios e das variações; o histórico de frete, cobranças, faturas e vendas por anúncio; fotos, medidas, visitas e categoria; a nota e os problemas da experiência de compra de cada anúncio; as vendas no prejuízo e os anúncios que saíram da promoção; os resumos do Faturamento, do Ads, do pós-venda (sem dados do comprador) e dos afiliados (sem nome de afiliado); reputação, remessas do Full, a agenda do Canal e o id e o nome de exibição da própria conta. As credenciais de Tiny, Omie e Bling, se ele conectar, ficam só aqui e só são enviadas ao próprio ERP. Nada é enviado a servidor do desenvolvedor.

**3.B.3 Hosts, se o painel tiver um campo só (981 caracteres; já inclui a aba do Mercado Ads aberta em segundo plano):**
> vendedores.mercadolivre.com.br: ler, com a sessão do vendedor, as páginas do próprio painel (anúncios, vendas sem dados do comprador, promoções, Faturamento, Full, pós-venda, reputação, notas fiscais, Simulador) e mostrar o lucro na tela; só a Agenda do Canal pré-preenche o formulário, e o vendedor clica em Criar. pa.mercadolivre.com.br: ler os números do Mercado Ads (só leitura); se o ML exigir, abre a página do Mercado Ads numa aba em segundo plano, no máximo 1 vez a cada 6 horas por conta, e a fecha. Opcionais, pedidas só no clique do vendedor: www.mercadolivre.com.br e produto.mercadolivre.com.br (fotos, medidas e visitas dos próprios anúncios e ofertas públicas do catálogo); www.mercadopago.com.br (vendas e reembolsos da página Atividade, para conferir o mês); api.tiny.com.br, app.omie.com.br, www.bling.com.br e api.bling.com.br (custo e estoque pela API oficial do ERP que o vendedor conectar, com as credenciais dele). Nada é enviado a servidor do desenvolvedor.

**3.B.4 pa.mercadolivre.com.br, se houver um campo por domínio (556 caracteres):**
> Ler, com a mesma sessão, os números do Mercado Ads (campanhas, anúncios patrocinados, impressões, cliques, investimento, receita e orçamento) para mostrar ACOS e o resumo da conta. Se o ML desvia a leitura feita pelo fundo, a mesma consulta é feita pela aba aberta do painel do vendedor; se o ML exige que a conta de anúncios seja aberta antes, a extensão abre a página do Mercado Ads numa aba em segundo plano (no máximo 1 vez a cada 6 horas por conta) e a fecha, sem clicar nem escolher nada. Só leitura: não cria nem altera campanha, orçamento ou lance.

**3.B.5 Uso de dados:**
- Marcar a categoria nova: "Informações de identificação pessoal: sim, só do próprio vendedor (o id numérico e o nome de exibição de cada conta dele no Mercado Livre, para separar os dados por conta; nunca o e-mail). Só no navegador."
- Trocar a linha 82 por: "As demais: não. Não guarda dados de compradores. Nada é vendido nem transferido a terceiros."

### 3.C Descrição da ficha (11.949 caracteres; a atual tem 11.982)

Saiba quanto sobra de verdade em cada venda do Mercado Livre antes de entrar numa promoção, mudar um preço, investir em Ads ou mandar estoque para o Full.

O Copiloto funciona dentro do seu painel de vendedor, com a conta que você já usa. Ele lê os números que o próprio Mercado Livre mostra (preço, tarifa, frete, "você recebe", Faturamento e Mercado Ads) e junta com o que só você sabe: o custo do produto e o imposto.

Na tela do Mercado Livre:
• Anúncios: "Lucro" ou "Prejuízo" e a margem de cada anúncio, inclusive no preço de promoção. Passe o mouse e veja a conta completa. Embaixo, quantas fotos o anúncio tem, se está sem dados fiscais e se as visitas caíram.
• Clássico e Premium do mesmo produto lado a lado, cada um com preço, promoção, tarifa e lucro.
• Preço de atacado: o lucro por unidade em cada faixa de quantidade.
• Forma de entrega de cada anúncio (Full, Flex, Coleta…) e se ela combina com a medida do produto.
• Central de promoções: em cada proposta, "Dá para entrar", "Abaixo da meta" ou "Prejuízo", e a ★ Melhor opção para a sua meta. Um botão mostra só as que dão lucro.
• Vendas: em cada venda da lista, se deu lucro ou prejuízo.
• Frete: um selo avisa quando o frete de um anúncio sobe, e um aviso quando um anúncio paga mais frete que outro do mesmo SKU na mesma faixa de preço (quase sempre é peso ou medida errada).

No painel do Copiloto (ícone na barra do Chrome):
• Geral: um resumo de tudo numa tela só, uma linha por módulo, com "Ver mais" para os detalhes. Cada assunto fica na sua aba (Promoções, Frete, Catálogo, Ads, Full, Saúde, Conciliação, Canal, Afiliados).
• Faturamento por família com 13 meses, SKUs que caem e sobem, curva ABC e meta do mês: uma barra colorida mostra qual família de produtos (a categoria do ML) mais puxa o faturamento e qual está caindo; em "Ver 13 meses e os SKUs", o lucro por família, os SKUs que mais caíram ou subiram com o botão "Por que caiu?", a curva ABC, o aviso para preparar o Full antes do mês forte e a projeção do mês contra a sua meta.
• Todos os seus anúncios: a lista de Anúncios inteira, inclusive as famílias e as "opções de venda" que ficam fechadas. Anúncio finalizado sai da conta (há a opção "Mostrar finalizados").
• Custos por variação: cada variação e cada opção de compra (Clássico e Premium), com o estoque (o seu e o do Full). O SKU de cada variação vem do Editor em massa do ML, quando você abre essa tela.
• Venda nova no prejuízo: aviso na atualização seguinte (a cada 3 horas), quando o custo está informado, com o produto, o valor e o motivo principal (frete, promoção, tarifa…).
• Aviso de promoção: o sino avisa quando um produto sai da promoção e quando ela está perto de acabar (você escolhe quantos dias antes). Sete dias depois da saída, as vendas da semana antes e da semana depois. Sem data de fim, o Copiloto não avisa o fim: ele não inventa data. Quem entra de novo na promoção é você.
• Alertas: o número no ícone soma o que pede sua atenção: venda no prejuízo, promoção saindo ou acabando, estoque e Full, frete que subiu ou foi cobrado a mais, cobranças acima do esperado, reclamações e devoluções em aberto, Ads no prejuízo, anúncios sem dados fiscais ou perdendo visitas, experiência de compra em queda e avisos do ML sobre exposição, moderação ou qualidade, certificado digital, perguntas sem resposta, reputação perto do limite, remessas do Full com inconformidade e notas fiscais rejeitadas.
• Perguntas: quantas estão sem resposta e o seu tempo médio de resposta (só quantidades e tempos; nunca o texto nem quem perguntou). O Mercado Livre diz que um bom tempo de resposta aumenta a exposição nos resultados de busca.
• Reputação: seu nível (MercadoLíder, Platinum…) e cada variável (reclamações, mediações, cancelamentos, atrasos) contra o limite, em barras, colorida quando passa de 70% do limite, antes de o nível cair.
• Experiência de compra: quando uma tela do ML que você abre traz a experiência de compra do anúncio, o Copiloto guarda a nota (0 a 100), a faixa e o problema principal e avisa quando ela fica mediana ou ruim ou cai; se o anúncio tem estoque no Full, recomenda não mandar mais unidades. Os avisos de experiência, exposição, moderação e qualidade da lista de Anúncios também entram no sino, com o texto e o link do próprio ML.
• Remessas do Full: o que foi declarado, recebido e o que faltou, as inconformidades, as multas e a cobrança da coleta, com o texto da reclamação pronto, produto a produto. E o simulador da próxima remessa: quantas unidades mandar, o volume, o peso, o veículo que cabe e o custo estimado pelas suas remessas anteriores (sem remessa anterior, o Copiloto diz o motivo, não inventa um valor).
• Resumo para a equipe: do dia e/ou da semana, na hora que você escolher, um texto curto no formato do WhatsApp com faturamento, lucro, alertas, promoções, perguntas e reputação. Você copia ou abre o seu WhatsApp para mandar. O Copiloto nunca envia nada sozinho e não tem número de ninguém.
• Suas contas juntas: com mais de uma conta do Mercado Livre neste Chrome, a Geral mostra faturamento, lucro e alertas de todas lado a lado, cada uma pelo nome no ML com os 4 últimos dígitos do ID (ex.: "Minha Loja · ID …1234") ou pelo apelido que você der. O e-mail da conta nunca é lido. Conta de outra empresa: marque "Outra empresa" em Ajustes e ela passa a ter custos por SKU, imposto, margem, despesas fixas e ERP só dela; as da mesma empresa continuam dividindo tudo. Se o login do ML troca de conta no meio da sincronização, o Copiloto para, avisa e lê de novo depois, sem misturar as contas.
• Pós-venda: reclamações, mediações, mensagens e devoluções em aberto; de cada reclamação, o produto, o valor, o motivo e a situação, agrupados por motivo e por produto (nada do comprador). Quando o motivo pode se enquadrar nas regras de exclusão do Mercado Livre (ex.: desistência com o produto em perfeitas condições), o Copiloto diz o que conferir e deixa pronto o texto do pedido de exclusão. Quem confere e envia é você; quem decide é o Mercado Livre.
• Saúde dos anúncios: anúncios sem dados fiscais (sem eles você não emite a NF-e), quantas fotos cada um tem e quais o ML marcou, e o radar de visitas: quem perdeu visitas nos últimos 7 dias e o que fazer.
• Medidas da embalagem: SKUs com medidas diferentes entre anúncios e aviso quando o ML altera as medidas, com o texto do chamado pronto (só leitura da tela "Alterar anúncio").
• Robô de promoções (opcional; você liga): lista as propostas que respeitam a margem mínima que você definiu, com o atalho para participar no ML. Ele só sugere: quem entra é você.
• Sincronização automática: a cada 3 horas, com o Chrome aberto. Se você ligar "Continuar sincronizando com o Chrome fechado", segue enquanto o computador estiver ligado.
• Robô de fotos (opcional; você liga, anúncio por anúncio): nos anúncios perdendo visitas, sugere uma nova ordem das fotos, sempre com a mesma capa. Só sugere: não grava nada no anúncio.
• Frete: os últimos 30 dias contra os 30 anteriores (pelo que o ML cobrou em cada venda), por formato, e quanto subiu por anúncio e por SKU, com as vendas afetadas e um texto para pedir revisão. A conferência do “Você recebe” com o Simulador de custos do ML. "Frete cobrado a mais": cada pedido dos últimos 30 dias comparado com o frete do anúncio no dia da venda, separando o que dá para contestar do que vale conferir.
• Tarifa de devolução: cada tarifa cruzada com o pós-venda: dá para questionar, vale conferir ou foi sua.
• Catálogo: todos os seus SKUs, com e sem custo, e a competição de catálogo entre as suas contas.
• Full: saúde do estoque (crítico, atenção, saudável, excedente e parado), estoque mínimo, uso do espaço e quanto enviar de cada produto. A sugestão olha a saúde do anúncio: pausado por você, finalizado, em revisão ou com experiência de compra ruim não recebe envio (o motivo aparece); experiência mediana, problema na reputação ou qualidade básica cobrem no máximo 15 dias; esgotado continua sendo reposto. Anúncio parado não usa a venda do ano passado; na época forte, as vendas de 30 dias seguem o índice do ano anterior, até 3×. Estoque parado ou sobrando: quantas unidades sobram, a regra de armazenagem e de estoque antigo do ML e o que fazer (corrigir o anúncio, promoção ou retirada).
• Ads por SKU: ROAS, ACOS, TACOS, CTR, cliques, investimento e receita; impressões perdidas por orçamento e por classificação; o ponto de equilíbrio de cada produto e uma sugestão de organização das campanhas. Quem muda a campanha é você, no Mercado Ads.
• Gestão de afiliados: quanto os afiliados vendem e custam, os produtos fora da campanha e as suas campanhas exclusivas. Quem mexe na campanha é você, no Mercado Livre.
• Conciliação (fechamento do mês): vendas brutas, cada tarifa, frete, Ads e estornos, o líquido e o lucro do mês (menos as despesas fixas, se você informar), o maior gargalo e as cobranças para conferir. Custo novo na fatura: aviso quando aparece uma cobrança que não existia ou que subiu muito. As notas fiscais das tarifas do ML por mês. As notas fiscais das suas vendas (Faturador e Full) do mês atual e do anterior, com status e chave para copiar e o botão que abre a página do ML no mês certo para baixar Excel, PDF ou XML; aviso de nota rejeitada. Atalhos para CT-e e GNRE e aviso de certificado digital perto de vencer.
• Canal de transmissão: monta a agenda da semana só com produtos que dão lucro. Em Programar, o Copiloto pré-preenche o formulário do Mercado Livre; você confere e clica em Criar. Robô do Canal (opcional; vem desligado): monta a agenda uma vez por dia; criar no ML continua sendo com você.

Textos de chamado prontos para revisar e copiar: frete do anúncio, cobranças do fechamento, tarifa de devolução, medidas, remessa do Full e pedido de exclusão de reclamação. Eles trazem os números do painel, a regra do ML com o link da Central de Ajuda, o que se pede (revisão, correção dos próximos envios ou estorno) e os anexos. Confira os números e o texto antes de enviar. O Copiloto não abre chamado e não garante o resultado: quem envia é você e quem decide é o Mercado Livre.

Custos sem digitar: conecte o Tiny (token), o Omie (chaves da sua conta) ou o Bling (aplicativo seu, só leitura) e os custos entram sozinhos a cada sincronização; ou importe a planilha de produtos (.xls ou .csv).

ERP × Mercado Livre: com o Bling, o Tiny ou o Omie conectado, o Copiloto mostra o que está diferente, em 5 grupos: no ERP e não publicado; publicado mas parado no ML; à venda no ML mas inativo no ERP; no ML sem par no ERP; estoque diferente (Bling e Omie). Só compara: não muda nada no ERP nem no ML.

Primeiro uso guiado: a apresentação "Conheça o Copiloto", 5 passos de boas-vindas e um tour na própria tela do Mercado Livre.

Suporte: WhatsApp (44) 99912-1785 ou diegoconsultoriamga@gmail.com.

O Copiloto é uma ferramenta independente, sem vínculo com o Mercado Livre e sem aprovação dele. Mercado Livre, Mercado Ads, Mercado Envios Full e MercadoLíder são marcas do Mercado Livre, citadas só para dizer onde o Copiloto funciona.

Privacidade: não pedimos senha. O Copiloto lê as páginas do seu painel e só mexe no Mercado Livre quando você pede: a Agenda do Canal pré-preenche o formulário (quem clica em Criar é você) e o Robô de fotos só sugere uma nova ordem (não grava nada). A conferência com o Simulador de custos só calcula. Das notas fiscais das vendas guarda data, venda, número, status, valores e chave; das perguntas, só quantidades e tempos; da lista de Vendas, número, dia, envio, situação, produto, SKU e valores; da experiência de compra, a nota, a faixa e os problemas de cada anúncio. Nada de quem comprou é guardado. O Editor em massa é lido só quando você abre essa tela, e só para consultar. Avisos, textos de chamado e o resumo para a equipe só ficam prontos para você: quem muda preço, entra em promoção ou envia é você. Seus dados, inclusive os custos de cada empresa, ficam no seu navegador. Nada vai para servidores do SellerHub.

### 3.D Bloco "O que há de novo na 3.3.0" (opcional, 1.356 caracteres; a loja não tem campo próprio para notas da versão)

O que há de novo na 3.3.0
• Contas de empresas diferentes: marque "Outra empresa" em Ajustes e a conta passa a ter custos por SKU, imposto, margem, despesas fixas e ERP só dela. Se o login do Mercado Livre troca de conta no meio da sincronização, o Copiloto para, avisa e lê de novo depois, sem misturar as contas.
• Full pela saúde do anúncio: anúncio pausado por você, finalizado, em revisão ou com experiência de compra ruim não recebe sugestão de envio (o motivo aparece); experiência mediana cobre no máximo 15 dias; anúncio parado não usa mais a venda do ano passado; anúncio só esgotado continua sendo reposto. Estoque parado ou sobrando mostra quantas unidades sobram e o que fazer antes do custo de estoque antigo.
• Experiência de compra no sino: a nota, a faixa e o problema principal do anúncio quando a tela do ML traz esses dados, e os avisos de experiência, exposição, moderação e qualidade da lista de Anúncios.
• Textos de chamado no mesmo modelo, com os números do painel, a regra do ML e o link da Central de Ajuda, e dois novos: reclamação de remessa do Full com inconformidade e pedido de exclusão de reclamação (só quando o motivo pode se enquadrar nas regras de exclusão do ML). Confira os números e o texto antes de enviar: quem envia é você; quem decide é o Mercado Livre.
• Nenhuma permissão nova e nenhum dado novo de comprador.

### 3.E O que mudei nos textos propostos pelas frentes, e por quê

**Removido da descrição, porque não é verdade hoje:**
- "Defeito… nunca geram pedido": o veto falha (achado 4.2).
- "Compra por engano" como exemplo: o código liga esse motivo à regra errada (achado 4.8).
- "Quando o número é estimado, o texto só pede a revisão": falso hoje nos achados 4.1, 4.3 e 4.4.
- "Todos trazem… pedido": o pedido de exclusão sai sem número de pedido (achado 4.6).
- "Analisar desempenho": a tela ao vivo ainda não foi mapeada (NOVIDADES-3.3.0.md:116).

**Mantido como está hoje, porque os céticos derrubaram a mudança ou não há achado:**
- justificativas de background (linha 29) e de vendedores.* (linha 39);
- justificativa de alarms (linha 19).

**Corrigido:**
- Hash: o `ebf0d8a3…3689` que as frentes citam está errado. O certo é `a037454e…6e68`, ou o do zip refeito.
- Justificativa de host em campo único: passou a citar a aba do Mercado Ads aberta em segundo plano e foi enxugada para menos de 1.000 caracteres.
- Política, item (3) de "O que mudou": "com o número do pedido" virou "só com dados que já guardava", porque o pedido de exclusão hoje não traz o número do pedido.

**Opcional:** o parágrafo de independência do Mercado Livre na descrição. A loja não exige, e a política no ar já diz que o Copiloto não é afiliado ao Mercado Livre.

---

## 4) O que corrigir antes do envio (só achados confirmados)

**Obrigatória**

**4.1 Frete casado pelo anúncio e pela data (alto)**
- Onde está o problema:
  - `ml-extrator.js:1690-1697` casa o frete sem número com a venda mais recente e sem par do mesmo anúncio, até 20 dias antes.
  - Em `:1724-1726` o item recebe `pedidoFrete`, mas `talvezUnidades` continua false.
  - `fechamento.js:301` e `:307-308` põem o item em "Frete cobrado a mais (confirmado)".
  - `fechamento.js:332` leva ao texto firme de `:539-542`.
  - `painel-lateral.js:1752` (`chamadoFreteLote`) usa o mesmo filtro.
- Correção:
  - Só marcar como "confirmado" o frete casado pelo número da venda.
  - Item com `pedidoFrete` vai para "para conferir" (uma marca própria, excluída dos filtros de `fechamento.js:301` e `painel-lateral.js:1752`), ou sai como "Pedido de revisão" com valor estimado e o número do frete.
  - Texto para esse caso: "Assunto: Pedido de revisão de cobrança: Frete de envio – Frete: #<pedidoFrete> – Anúncio: <MLB>"; nos fatos, "o frete foi relacionado à venda pelo anúncio e pela data; o número do frete é outro"; no pedido, "Solicitamos a conferência desta cobrança e, se a diferença se confirmar, o estorno de R$ <dif>".
  - Corrigir o comentário de `ml-extrator.js:1672`.
  - Pôr em teste o cenário de `sonda_par.js`: R$ 45,35 até 19/09 e R$ 58,75 desde 20/09; vendas em 18/09 e 21/09; fretes lançados em 22/09 e 23/09. O esperado é nada "confirmado".

**Recomendadas no mesmo novo empacotamento (médio; não são problema de loja)**

**4.2 Pedido de exclusão sai para reclamação com culpa do vendedor**
- Onde está o problema:
  - `ml-extrator.js:1441`: `!DEV_COMPRADOR.test(semBom)` anula o veto inteiro.
  - `:1349`: `n[ãa]o funciona` não pega "não funcionou".
  - `:1435-1437` (EXCL_VETO) não pega atraso de postagem, "sem a caixa" nem "falsificado".
- Correção:
  - Tirar do texto o trecho de erro do comprador antes de testar a culpa do vendedor, como já se faz com BOM_ESTADO, e vetar se sobrar qualquer culpa.
  - Acrescentar ao EXCL_VETO: `n[ãa]o funcion`, `sem (o|a|os|as) (manual|caixa|acess|pe[çc]|cabo|carregador|nota)`, `post\w* (com atraso|tarde|atrasad)`, `vendedor (demor|atras)` e `falsific`.
  - Pôr as 8 frases da sonda em `tests/copiloto/teste_contestacao_v33.js` como não excluíveis.

**4.3 Tarifa de devolução firme só pelo motivo**
- Onde está o problema:
  - `ml-extrator.js:1532-1538`: o erro do comprador vence a culpa do vendedor, e o caso cai no texto firme de `:1411-1415`.
  - `:1350` passou a aceitar `escolh|selecion` na 3.3.0. Por isso "Escolhi o tamanho errado e veio falsificado", que era cinza, virou verde (regressão).
- Correção:
  - Em `:1532`, a culpa do vendedor passa a vencer, e o motivo misto vai para "Pedido de revisão".
  - Texto para esse caso: "Gostaríamos de confirmar se esta tarifa de devolução deveria ter sido cobrada de nós… e, se a devolução não foi de nossa responsabilidade, o estorno de R$ <valor>".
  - Corrigir `n[ãa]o funcion` no DEV_CULPA.
  - Manter o texto firme para arrependimento puro, decisão já testada em `teste_contestacao_v33.js:118-120`.

**4.4 Frete do anúncio contestado sem confirmação**
- Onde está o problema: `painel-lateral.js:1288-1306`. O assunto da linha 1302 e o estorno das linhas 1305-1306 saem sempre, com ou sem `confirmouMedidas` e também com base no valor típico.
- Correção:
  - Sem a caixa "Não alterei peso, medidas nem embalagem", ou com base no valor típico, usar o assunto "Pedido de revisão do custo de envio do anúncio – SKU – Anúncio".
  - O estorno fica só "se houver erro na cubagem".
  - "Contestação de cobrança indevida de frete" fica só com a confirmação do vendedor.

**4.5 Medidas que diminuíram tratadas como frete a mais**
- Onde está o problema: `ml-extrator.js:4126-4132` sempre diz "isso aumenta o custo de envio" e pede estorno, e `SHC.medidasMudadas` (`:4141-4160`) não compara antes e depois.
- Correção:
  - Comparar o peso cobrável antes e depois (o maior entre o peso físico e o volumétrico).
  - Se não aumentou, pedir só a correção das medidas, sem "aumenta" e sem estorno.
  - Pôr em teste.

**4.6 Pedido de exclusão junta todos os casos do motivo, sem número de pedido**
- Onde está o problema:
  - `painel-lateral.js:3843` mostra o botão sem olhar `naReputacao`.
  - `:5799-5803` monta o pedido sem `pedidos`: `fundo/10-status-saude-posvenda.js:196` apaga `pedido` dos casos, mas `porPedido` (`:198-199`) tem o motivo e `afetouReputacao`.
  - O texto é de `ml-extrator.js:1453-1463`.
- Correção:
  - Montar a lista por pedido a partir de `porPedido` (mesmo motivo e `afetouReputacao !== false`).
  - Esconder o botão quando `naReputacao = 0`.
  - Novo assunto: "Pedido de análise de reclamações para exclusão da reputação". Escrever "podem se enquadrar", uma linha por pedido, sem afirmar o estado do produto.

**4.7 Remessa do Full só com unidades não aptas descrita como diferença de contagem**
- Onde está o problema: `ml-extrator.js:1466-1478`. A introdução fixa da linha 1475 e o pedido de recontagem e cancelamento da linha 1477 saem mesmo quando o filtro da linha 1469 deixa entrar produto com `naoAptas` e nenhuma diferença.
- Correção:
  - Separar a introdução: "No processamento da remessa (<data>), <n> unidades foram consideradas não aptas para venda."
  - Pedido: o motivo de cada unidade e o cancelamento só "se a inaptidão não decorreu do nosso preparo".
  - Pôr em teste o caso 50 declaradas / 50 processadas / 3 não aptas "sem etiqueta".
  - Ao mexer aqui, conferir também o `r.custo`: um cético notou que `total_charged` (`:3205`) pode incluir coleta e multas (`:4999`).

**Opcionais (baixo)**

**4.8 Regra de exclusão citada não bate com o motivo**
- Em `ml-extrator.js:1423`, "comprei errado" ou "comprei por engano" vai para a regra de arrependimento, ou para nenhuma regra. O teste de `teste_contestacao_v33.js:79` muda junto.
- Em `:1426`, a regra do transporte passa a exigir "demora" ou "atraso" e a vetar `violad`, `abert` e `n[ãa]o entreg`.
- A regra "meio de contato" (`:1428`) fica: ela está na lista oficial do Mercado Livre. Falta só documentá-la em NOVIDADES:25 e no teste.

**4.9 TikTok desligado no pacote**
- Nada obrigatório. Tirar do pacote exige mexer em:
  - `empacotar.ps1` ($fora);
  - `painel-lateral.html:912-920`;
  - `fundo/01-carga-e-eventos.js:55`;
  - `PERM_TIKTOK` em `painel-lateral.js:6088`;
  - os testes.
- Ao religar o TikTok, seguir `calc.js:41-43`: permissões opcionais, ficha, justificativas, política e único propósito.

**4.10 Credenciais do ERP sem cifra**
- Onde está: `painel.js:1212`, `:1251` e `:1313`; `bling.js:7`; e por empresa em `store.js:26`.
- O FAQ da User Data Policy, item 9, pede AES ou RSA para dado em repouso.
- Pode ficar para a próxima versão. Um cético observou que guardar a chave no IndexedDB do mesmo perfil protege pouco.
- Se fizer, acrescentar a frase 3.A.8 na política.

**4.11 Estatística de 10% na tela**
- A frase "vende até 10% mais" continua em `ml-extrator.js:5185`. A descrição da loja já foi corrigida; a tela fica para a próxima versão.

**Documentos do repositório (não são código)**
- `deploy/copiloto-chrome-web-store/politica-privacidade.html` (01/10) contradiz o código:
  - a linha 8 diz que não guarda o número do pedido de afiliado, mas `fundo/06-repasse-afiliados-simulador.js:50-51` guarda;
  - não tem Uso Limitado nem LGPD.
  - Trocar pela versão publicada em 2.2 e nunca publicar o arquivo de 01/10.
- Ajustar `ficha-loja.txt:51`, que manda publicar esse arquivo.
- Se for atualizar o cabeçalho da ficha, usar o SHA real do zip enviado.

---

Os textos finais propostos estão neste relatório, nas seções 3.A a 3.D.
