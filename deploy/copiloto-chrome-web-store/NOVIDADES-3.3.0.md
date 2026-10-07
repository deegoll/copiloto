# Copiloto 3.3.0: TikTok Shop

Pacote: `copiloto-v3.3.0.zip` (nesta pasta), gerado na E22 do `tests/copiloto/_multicanal/PLANO-3.3.0.md` com a suíte verde. **Não enviado à loja.** O envio espera o teste ao vivo com a dona (E23), a política nova no ar e o OK dela.
SHA-256 do zip (gerado em 06/10/2026 15:25): `CC04F97A64055D34EF32154C884C809F608A13F4B30A06AFFADBB623443FE857` (56 arquivos, iguais byte a byte ao código de `extension-copiloto` na etiqueta local `copiloto-v3.3.0`). Se o pacote for refeito, troque aqui e no `VERSOES.md`.
Textos da loja, política e a lista da manhã: pasta `go-live-3.3.0/` (`textos-loja-3.3.0.md`, `privacidade.html`, `PARA-A-DONA-GO-LIVE.md`). Os `.txt` desta pasta continuam sendo os da 3.2.1 publicada.

## Junção com o C2 da nuvem (07/10/2026, ramo `nuvem2/330-final`)

O pacote desta pasta foi refeito depois de juntar o C2 da nuvem (`nuvem/bloqueios-330`, PR #4) por cima desta 3.3.0. SHA-256: `8146eeffdfe459343cc73246214b5353b6be79f5dfa90ccb35e26c54e0c9f226` (56 arquivos; confira com `node deploy/conferir-pacote.js 3.3.0`). Ele substitui o zip de 06/10 (`CC04F97A…`).

- **Multi-empresa:**
  - a conta do ML é conferida depois de cada etapa da sincronização; se o login trocar no meio, o que foi lido naquela janela é desfeito e relido;
  - "Todas as contas" mostra o total de cada empresa e nunca soma empresas diferentes;
  - o Tiny do painel lateral fica preso à empresa do clique.
- **Contestação:**
  - pedido de exclusão só nos casos que as regras do ML aceitam: nunca culpa do vendedor e nunca mediação aberta;
  - medidas sem afirmar quem mudou, pedindo só a revisão (nunca estorno de frete, pela trava do frete);
  - remessa do Full só com os números por produto: os totais da lista nunca entram.
- **Política:** `politica-privacidade.html` desta pasta é a política no ar de 06/10 mais a experiência de compra, as contas de outra empresa e os textos de contestação (auditoria 3.A.2–3.A.7, sem o texto de frete e sem a cifra do 3.A.8). Ela vai ao ar no lugar da de 06/10, na mesma URL, **antes** do envio.
- **O envio continua esperando:** o teste ao vivo com a dona (E23, abaixo), o OK dela na política, a política no ar, os textos colados no painel e o envio.

## Em resumo

1. **TikTok Shop opcional.** Quem liga em Ajustes › Canais de venda vê o filtro Todos · Mercado Livre · TikTok Shop. O Copiloto só lê as telas do Seller Center que a seller abre, sem robô, sem nenhuma chamada própria ao TikTok e sem guardar dado de comprador.
2. **Quem não liga o TikTok vê o Copiloto como antes, com 2 mudanças do Mercado Livre feitas depois da 3.2.1** (pedido da dona em 05/10, commit `c845f12`, que vai no zip). O "bate" da fatura, o lucro e a etiqueta da venda não mudam: os testes de dinheiro do ML passam sem mudar valor esperado, menos a regra da tarifa abaixo, trocada de propósito no `teste_fechamento.js`.
   - **"Cobranças acima do esperado" só com prova.** A regra antiga comparava a tarifa cobrada com o preço de HOJE do anúncio e acusava cobrança a mais que não houve. Agora o preço de hoje só escolhe o que conferir, e a prova é o detalhe da própria venda: a página de Fechamento abre sozinha o detalhe de até 15 vendas por vez e guarda o resultado (`prova:<conta>`). A regra antiga sai também do que já estava guardado. Por isso a quantidade e o valor de "Cobranças acima do esperado", na Geral e na Conciliação, podem ser menores que na 3.2.1. O que bate com a venda some da tela.
   - **O painel segue a conta aberta no ML.** Ao abrir, ao voltar para o painel e a cada 2 min, ele lê qual conta está aberta no ML (1 leitura da lista de Anúncios). Se for outra, troca sozinho e sincroniza; com uma sincronização rodando, mostra o aviso com "Puxar os dados desta conta".
   - Menor (02/10, `64c88c7`): a Tarifa do Mercado Envios (código DSB) que vem sem texto no Faturamento conta como frete, e não como "outros". O total não muda.

   O teste ao vivo (E23) confere as 2 mudanças (`go-live-3.3.0/PARA-A-DONA-GO-LIVE.md`, parte 1).
3. **Nome novo:** "Copiloto: lucro real nos marketplaces" (escolhido pela dona em 06/10). Resumo: "Lucro real de cada venda no Mercado Livre e no TikTok Shop, com os números do próprio canal. Você só informa o custo."

As travas de escrita continuam desligadas (`ROBO_ESCRITA_CONFERIDA` e `PROMO_ADESAO_CONFERIDA` = false). Nada de robô no TikTok.

## Onde o TikTok aparece

**Com o TikTok (filtro Todos · Mercado Livre · TikTok Shop):**
- Geral (E10): lucro e vendas de cada canal; em Todos, a soma.
- Conciliação (E11): os Demonstrativos do TikTok, "O que cada canal cobra" e o lucro de cada pedido.
- Canal (E12): a comparação entre canais (lucro, margem, vendas e crescimento); a agenda do Canal de transmissão fica numa linha no fim.
- Ficha do SKU (E13, nova): abre pelo produto no Catálogo e mostra em qual canal ele dá mais lucro.
- Catálogo (E14): o custo do SKU do TikTok, com "ligar à mão" quando o SKU não veio.
- Ads (E15): o gasto de Ads de cada canal (no TikTok, o digitado em Ajustes).
- Afiliados (E16), Frete (E17), Pós-venda (E18), Promoções (E19) e Saúde (E20).
- Ajustes (E9): o cartão "Canais de venda" (ligar, "lido em", as telas lidas, "Apagar dados do TikTok") e o Ads do TikTok por mês, com "Não uso Ads no TikTok".

**Só Mercado Livre:** o Full. O TikTok Shop não tem Full no Brasil: no filtro TikTok a aba sai da barra e, se já estava aberta, diz isso.

**Nenhuma aba ficou para a 3.3.1:** as 12 etapas de aba (E9 a E20) foram aprovadas e juntadas. Ficam para a 3.3.1:
- dividir o `painel-lateral.js` e o `ml-extrator.js` por aba (ajuste de 05/10) e, com isso, tirar o `tiktok-aba.js`, que fica só como biblioteca das abas;
- o "Saldo disponível" do TikTok: é lido e guardado, mas nenhuma aba mostra (a dona decide se entra);
- na Ficha do SKU, o gráfico de linhas por canal e a ficha própria de cada variação.

## Permissões

Duas permissões **opcionais** novas, pedidas só quando a seller liga o TikTok Shop (no clique de "Concordo e ligar"): `scripting` e o site `https://seller-br.tiktok.com/*`. Nada novo em `permissions` nem em `host_permissions`: quem atualiza não recebe aviso do Chrome. Nenhum `content_scripts` fixo no TikTok: os 2 scripts de leitura são registrados só depois do aceite e saem ao desligar.

## Loja e política

- Textos para colar: `go-live-3.3.0/textos-loja-3.3.0.md` (e `colar-na-loja.html`, com o botão Copiar). Na E22 só mudou a contagem de caracteres nos cabeçalhos dos blocos 3, 4, 8 e 10; todos dentro do limite.
- Política: `go-live-3.3.0/subir/privacidade.html` sobe para o site **antes** do envio, com o OK da dona e do advogado. Na E22 mudaram 2 frases para bater com o código: "menos o Full, que o TikTok Shop não tem no Brasil" e o exemplo de link ("Abrir no TikTok", na aba Saúde).
- Uso de dados (bloco 10): decisão de 06/10 (validação jurídica, C3/C4) de marcar 5 caixas: Conteúdo do site, Informações financeiras e de pagamento, Informações de autenticação, Atividade do usuário e Informações de identificação pessoal. Histórico da Web fica desmarcada. A dona anota aqui o que marcou no envio: ______.
- A conferência de cada afirmação contra o código está no fim do `go-live-3.3.0/PARA-A-DONA-GO-LIVE.md` (parte 7).

## Teste ao vivo com a dona (E23)

Ainda não feito. O resultado entra aqui.

## Riscos que ficam (aceitos na 3.3.0)

1. **Um script da própria página do TikTok pode pegar a porta do canal privado.**
   Na 3.3.0 a leitura da tela passa por um canal privado entre as 2 partes do Copiloto na aba do Seller Center (`tiktok-tela.js` cria um `MessageChannel` e entrega 1 porta ao `tiktok-pagina.js`). Depois do aperto de mão, o recado comum da janela (`postMessage`) não grava mais nada.
   A porta, porém, é entregue uma vez pelo `postMessage` da janela, e esse recado chega a todo script da página que já esteja ouvindo. Um script assim pode pegar a porta antes e mandar números falsos por ela, ou só ficar com ela, e aí o Copiloto deixa de ler aquela aba.
   Quem consegue: os scripts do próprio TikTok nessa página, outra extensão que a seller instalou com acesso ao Seller Center, ou um script estranho que entrasse no site do TikTok.
   O que protege de verdade: a faixa dos números no fundo (`SHC.tt.gravarCaptura`). Dinheiro em texto tem de ser número e ficar abaixo de R$ 10 milhões, o id do pedido, do demonstrativo e do SKU tem de ter de 5 a 25 dígitos e o dia da venda fica entre 2024 e hoje (com 7 dias de folga, pelo fuso e pelo relógio do computador). Fora disso nada é gravado e o painel avisa que a tela mudou. Como no item 3 da 3.2.1, um número possível e errado (R$ 90 no lugar de R$ 100) ainda passa: para o Copiloto, é o que a tela mostrou. O estrago fica no Chrome da própria seller (o Copiloto não envia nada para fora). Um pedido ou demonstrativo que já estava guardado volta ao certo quando ela abre a tela de novo. Um pedido ou demonstrativo inventado com id NOVO fica guardado e entra nas contas até a poda (400 dias, ou quando sair dos 3.000 pedidos mais novos da loja; os demonstrativos, dos 200 mais novos), porque no TikTok não há sincronização que releia tudo e apague o que não veio, como a do ML no item 3 da 3.2.1.
   Motivo de aceitar: as 2 partes só conseguem se encontrar pela página. Não existe outro caminho entre o mundo da página e o da extensão que a página não alcance.
2. **O antirrobô do TikTok pode notar o embrulho do `fetch`.**
   Para ler a cópia da resposta que a tela já recebeu, o `tiktok-pagina.js` embrulha o `fetch` e o `XMLHttpRequest` da página. A chamada original acontece igual, com os mesmos argumentos, e o Copiloto não faz nenhuma chamada. Mesmo assim, um script do TikTok que confira se o `fetch` é o original do navegador consegue perceber o embrulho.
   O que pode acontecer: o TikTok pedir a verificação "Verify to continue" com mais frequência, ou marcar a sessão. A E23 confere isso ao vivo com a dona (item "trava": nenhum "Verify to continue" a mais).
   Motivo de aceitar: é o único jeito de ler sem robô. O caminho sem embrulho é o app ISV do TikTok pelo servidor (SellerHub), que fica fora da 3.3.0.
