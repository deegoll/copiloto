# Copiloto 3.2.1: versão blindada (auditoria de segurança de 01/10/2026)

Pacote: `copiloto-v3.2.1.zip` (nesta pasta). **Publicado na Chrome Web Store:** a ficha mostra a versão 3.2.1, atualizada em 02/10/2026 (conferido em 02/10/2026). Em 07/10/2026, o CRX que a loja distribui foi comparado com este zip: os 43 arquivos são iguais byte a byte (a loja só acrescenta `_metadata/` e a linha `update_url` do manifest). Para refazer: `node deploy/conferir-crx.js 3.2.1`.
SHA-256 do zip (gerado de novo em 02/10/2026, depois da revisão final): `809BEA9BA393637328F19F7BA49D58694BB12975ED6F60EB8AFEA0ACD213F0F1` (43 arquivos, iguais byte a byte ao código de `extension-copiloto`). Se o pacote for refeito, troque aqui e anote também no registro do envio.
Texto para a dona e para as clientes: `deploy/seguranca/copiloto/SEGURANCA-COPILOTO.md`.

## Em resumo: o que foi blindado

1. A tela da Agenda do Canal deixou de ficar visível para as páginas do Mercado Livre (não entra mais escondida dentro de outra página).
2. O fundo da extensão confere quem pede cada ação. Quase tudo só atende as telas do próprio Copiloto; da aba do ML só entram "abrir o frete", "abrir a Agenda" e os dados lidos da tela, com a conta conferida.
3. Os dados lidos da aba do ML passam por teto e faixa: número impossível, texto no lugar de número e lista gigante não entram.
4. Os links que vêm do ML só abrem se forem do Mercado Livre ou do Mercado Pago.
5. A planilha "ERP × ML" não deixa um nome virar fórmula no Excel, como a planilha de custos já fazia.
6. O aviso de certificado vencido não some por engano.
7. Tiny, Omie e Bling: uma linha nas telas de conectar recomenda usar um usuário só de leitura e o botão Esquecer ao trocar de computador.
8. O empacotador recusa arquivo estranho no pacote e imprime o SHA-256, para provar depois qual código foi enviado.

Nenhuma permissão nova. O visual não muda, a não ser pela linha do item 7. As travas de escrita continuam desligadas (`ROBO_ESCRITA_CONFERIDA` e `PROMO_ADESAO_CONFERIDA` = false).

## Permissões

Nenhuma permissão nova. Saiu uma exposição: a página da Agenda do Canal não fica mais acessível às páginas do Mercado Livre
(`web_accessible_resources` removido do manifest). Nada muda para a seller: "Montar agenda da semana" continua abrindo a Agenda numa aba nova.

## O que mudou (nada muda no visual, só uma linha de segurança nas telas de conectar o ERP)

- Planilha "ERP × ML": célula que começa com = + - @ (ou com TAB/CR antes) sai com apóstrofo, como já saía a planilha de custos (não vira fórmula no Excel).
- Links que vêm do Mercado Livre (faturas, resumo, reputação): só abrem se forem do Mercado Livre ou do Mercado Pago.
- O fundo da extensão confere quem pediu cada ação (sincronizar, alertas, repasse, abrir o painel, abrir o frete, abrir a Agenda).
- Revisão de 02/10: mais 10 ações do fundo só atendem as telas da extensão (painel e painel lateral), nunca a aba do ML: concorrentes do catálogo, dados fiscais, sincronizar custos do ERP, Simulador, Saúde dos anúncios, medidas (ler e marcar), catálogo e o robô de fotos (rodar e desfazer). Nenhuma tela do ML pedia essas ações; agora uma página do ML adulterada também não consegue pedir. Da aba do ML só entram abrir o frete, abrir a Agenda e os dados lidos da página (com a conta conferida, teto e faixa: veja os 2 itens abaixo).
- A Agenda do Canal só liga numa página da própria extensão, nunca dentro da página do ML.
- O que a aba do ML manda da Central de promoções tem teto (500 famílias, 2000 propostas) e só entra proposta com preço, tarifa, envio e "você recebe" possíveis: número de verdade (texto e NaN não passam), preço maior que zero, tarifa e "você recebe" entre zero e o preço, envio entre zero e o preço (ou até R$ 1.000).
- 2ª revisão de 02/10: a mesma faixa vale para a lista de Anúncios que a aba manda (até 500 anúncios) e para o Editor em massa (até 5000).
  Anúncios: preço, tarifa, "você recebe", frete, taxa operacional, preço cheio e bônus do Flex fora da faixa viram "sem número"; o anúncio continua no retrato. Faixa: preço maior que zero; tarifa e "você recebe" entre zero e o preço; frete e taxa operacional entre zero e o preço (ou até R$ 1.000). Sem preço possível, a tarifa e o "você recebe" também saem (não há como conferir). O frete impossível não entra no histórico de frete.
  Editor em massa: os campos que o Copiloto soma ou percorre ficam com o tipo certo (estoque, variações, dicas, forma de entrega). Antes, uma lista de variações trocada por texto travava toda leitura de Anúncios até o Editor ser lido de novo.
- Revisão final de 02/10: o link relativo dos cartões do Resumo também recusa TAB, quebra de linha e barra invertida (o navegador lê `/` + TAB + `/x` como `//x`, outro site). E os textos de cada anúncio que a aba manda (título, situação, SKU e afins) ficam texto: um título trocado por outra coisa travava a busca do painel lateral até a próxima sincronização.
- O aviso de certificado vencido que veio da remessa do Full não some só porque a tela do Faturador abriu sem o aviso.
- O custo digitado no balão: os eventos input/beforeinput também param no balão fechado. Isso tira só uma parte do caminho: veja "Riscos que ficam", item 1.
- Tiny, Omie e Bling: uma linha de segurança na tela de conectar (usar usuário ou aplicativo só de leitura; Esquecer ao trocar de computador).
- `empacotar.ps1`: recusa arquivo fora de .js/.html/.css/.json/.png dentro de icons/ e nucleo/ (em icons/, só .png) e imprime o SHA-256 do zip.
- Testes (fora do pacote): o `teste_painel.js` falhava às vezes dentro da suíte com o computador ocupado (o guia "Próximo passo" esperava um tempo fixo). Agora espera a condição. Com 14 execuções ao mesmo tempo: antes 11 falhavam, agora 14 de 14 passam. Assim a suíte que o `empacotar.ps1` roda não trava o pacote por acaso.

## Política de privacidade

O rascunho novo está em `deploy/seguranca/copiloto/privacidade-copiloto-RASCUNHO.html` (para a dona e o advogado revisarem).
Ele **substitui** o `politica-privacidade-3.2.0-RASCUNHO.html`: corrige a frase dos afiliados (a 3.2.0 guarda o número, a comissão e a situação de cada venda com afiliado, por 30 dias; o rascunho da 3.2.0 diz que "não guarda o número do pedido") e traz a parte da LGPD (encarregado, base legal, por quanto tempo, direitos).
Tem de ir ao ar **no dia em que a 3.2.0 for aprovada**: a partir daí a frase dos afiliados da política de hoje fica errada. Antes, a dona preenche os [colchetes] e o advogado revisa. Passo a passo: `PARA-A-DONA-3.2.0.md`, item 2.
O teste do pacote aceita o rascunho novo publicado (com os [colchetes] preenchidos): publicar não trava o `empacotar.ps1`.
A política no ar não foi mexida.

## Riscos que ficam (aceitos na 3.2.1)

1. **O custo digitado e as etiquetas de lucro podem ser lidos por scripts da própria página do Mercado Livre.**
   As etiquetas de lucro e de margem são texto dentro da página do ML: é assim que aparecem ao lado de cada anúncio.
   As teclas do custo digitado no balão passam primeiro pela página e só depois chegam ao balão. Parar os eventos no balão não impede a página de ver as teclas antes.
   Quem consegue ler: os scripts do próprio Mercado Livre nessa página, outra extensão que a seller instalou com acesso às páginas do ML, ou um script estranho que entrasse no site do ML.
   Esses mesmos scripts também conseguem DESENHAR uma etiqueta falsa com a cara da do Copiloto (as classes `.shc-w` e `.shc-r` ficam na página). Os números certos estão sempre no painel lateral do Copiloto, que a página do ML não alcança.
   Ferramentas de gravação de sessão ou de análise que rodem na página do ML também capturam o texto comum da página, e as etiquetas entram nisso.
   Motivo de aceitar: as teclas não têm como ser escondidas enquanto o campo de custo estiver dentro da tela do ML. As etiquetas dariam para ir para um shadow root fechado com a mesma aparência (como já foi feito com o balão), mas é uma mudança grande em todas as etiquetas, com risco de quebrar a tela. Fica para uma versão própria, testada ao vivo pela dona.
   Para as clientes, não diga "o Mercado Livre não vê o seu custo". Diga: "o Copiloto não envia o seu custo para ninguém; ele fica só no seu Chrome".
2. **As chaves do ERP ficam no armazenamento do Chrome, que a parte do Copiloto dentro da aba do ML também abre.**
   O token do Tiny, as chaves do Omie e do Bling (e a licença, quando a entrada for ligada; hoje ela nem é gravada) ficam em `chrome.storage.local`, junto com os outros dados do Copiloto.
   Os sites e as outras extensões não leem esse armazenamento. A parte do Copiloto que roda dentro da aba do ML consegue ler, porque o Chrome não separa o armazenamento por parte da extensão. Essa parte não usa as chaves.
   Para alguém aproveitar isso, teria de quebrar o próprio Chrome dentro da aba do ML. Isso é uma falha grave do navegador, que o Google corrige nas atualizações. Quem consegue isso já controla a conta do ML aberta naquela aba.
   O que protege de verdade: usuário ou aplicativo **só de leitura** no ERP (linha nova nas telas de conectar) e "Esquecer" ao trocar de computador.
   Correção possível numa versão própria: guardar as chaves no banco interno da extensão (IndexedDB), que a aba do ML não abre. Mexe no painel, no painel lateral, no fundo e nos testes do ERP, e exige levar as chaves de quem já conectou.
3. **Um número possível e errado, mandado pela aba do ML, ainda entra no retrato.**
   A faixa barra o impossível (texto, negativo, tarifa maior que o preço). Um script da página que mande, por exemplo, R$ 90 no lugar de R$ 100 não é barrado: para o Copiloto, é o que a tela do ML mostrou.
   Quem consegue: os mesmos do item 1. O estrago fica no Chrome da própria seller (o Copiloto não envia nada para fora) e o retrato volta ao certo na próxima sincronização, que relê a lista de Anúncios direto do ML. Um frete errado pode ficar como um ponto no histórico de frete daquele dia.
   Motivo de aceitar: a leitura da aba é o que deixa os números frescos sem esperar a sincronização; conferir cada número exigiria um GET a mais no ML por anúncio.
4. **Dois pontos da auditoria de 01/10 que hoje não se aplicam (registrados para não se perderem):**
   - Bling sem PKCE e com o Client Secret dentro da extensão: o aplicativo e o Client Secret são da própria seller (cada uma cria o seu no Bling, só leitura de Produtos), a volta da autorização só chega a `<id da extensão>.chromiumapp.org` e o `state` aleatório é conferido. Quem lê o Client Secret já está no Chrome da seller. Se o Bling passar a aceitar PKCE, ligar.
   - TikTok, `tiktok-tela.js` (recebe o que o `tiktok-pagina.js` manda de dentro da página): a origem conferida é a da própria página, então um script da página do TikTok também consegue mandar. Hoje o código está dormente: o manifest não tem a permissão `scripting` nem o site do TikTok, e sem os dois ele não roda. **Antes de ligar o módulo TikTok, endurecer essa conferência** e aplicar a mesma faixa dos números do ML.
