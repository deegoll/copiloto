# Etiquetas de ganho nas listas da Shopee, do TikTok Shop e da Magalu (Copiloto 3.4.0)

Em cada produto da lista aparece "Sobra R$ X · margem Y%" (ou "+ Informar custo"). Só lê o preço e o SKU que a página já mostra, usa o custo por SKU que a seller já informou e não manda nada para fora do computador.

## O que muda no pacote (para a sessão local empacotar; este ramo NÃO mexe em `deploy/copiloto-chrome-web-store/`)
Arquivos novos que o `empacotar.ps1` precisa incluir (lista fechada): `etiqueta-canal.js`, `etiqueta-registro.js`, `etiqueta-ajustes.js`, `shopee-lista.js`, `tiktok-lista.js`, `magalu-lista.js`. (`calc.js`, `store.js` e `nucleo/` já vão.) `painel.html` e `fundo/01-carga-e-eventos.js` mudaram. Versão do manifest ainda 3.3.0: subir para 3.4.0 na hora de empacotar (o teste de manifest e a ficha falam da versão).

Manifest: só `optional_host_permissions` ganhou `https://seller.shopee.com.br/*` e `https://seller.magalu.com/*` (o TikTok já estava). Nenhuma permissão nova, nenhum content script fixo: os scripts são registrados (`chrome.scripting.registerContentScripts`) só quando a seller liga o canal em Ajustes (painel.html, quadro "Etiquetas de ganho nos outros canais") e o Chrome concedeu a permissão do site.

## Guardas que ficam vermelhos de propósito até a dona aprovar os textos
- `teste_politica_manifest.js`: a política e o formulário da loja ainda não citam Shopee e Magalu.
- `teste_apresentacao.js` ("todo script que uma tela carrega está no pacote", `etiqueta-ajustes.js`): some quando o `empacotar.ps1` incluir os 6 arquivos acima.

## Texto que a política de privacidade precisa ganhar (proposta)
> **Etiquetas de ganho na Shopee, no TikTok Shop e na Magalu (opcional, desligada por padrão).** Se você ligar este recurso em Ajustes, o Copiloto pede ao Chrome acesso ao Seller Center do canal (seller.shopee.com.br, seller-br.tiktok.com ou seller.magalu.com). Nessas páginas ele lê apenas o preço e o SKU de cada produto que a própria lista mostra e, com o custo que você informou no Copiloto, desenha ao lado do preço a etiqueta "Sobra R$ X · margem Y%". Nada é enviado para fora do seu computador, o Copiloto não faz nenhuma chamada nova ao canal, não altera nem clica em nada na página, e o custo continua guardado só neste navegador. Desligar o canal em Ajustes remove a leitura e devolve a permissão. A comissão da Magalu é a porcentagem que você mesmo informa em Ajustes.

## Ficha da loja / formulário de privacidade (proposta)
- Justificativa de host `seller.shopee.com.br`, `seller.magalu.com` (e `seller-br.tiktok.com`, que ganha o uso): "Só com o canal ligado pela usuária, lê o preço e o SKU exibidos na lista de produtos para calcular e mostrar a margem localmente. Nenhum dado sai do computador."
- Justificativa de `scripting`: acrescentar "registrar a leitura da lista de produtos dos canais que a usuária ligar".
- Descrição curta/longa: "etiqueta de ganho por produto também na Shopee, no TikTok Shop e na Magalu".

## Como funciona (para revisão)
- `etiqueta-canal.js` (motor, mundo isolado): `SHC.etiquetaCanal.iniciar({canal, urlOk, linhas, ler})`; MutationObserver com intervalo mínimo de 400 ms; pílula em Shadow DOM; não duplica (marca `data-copiloto-etq`); recalcula quando custo/cfg mudam no storage; some ao desligar. Shopee = `SHC.calcular('sp')` (tabela do núcleo); TikTok = `CopilotoNucleo.tarifas.simular('tiktok')` (a mesma conta do `TT.simular`); Magalu = `cfg.magalu_comissao_pct` (+ `cfg.magalu_taxa_fixa` opcional). Sem comissão: "comissão da Magalu não informada". Linha-mãe com variações: faixa só se todos os SKUs têm custo, senão "N de M com custo".
- `etiqueta-registro.js` (fundo): registra/remove `copiloto-etq-<canal>`; mensagem `etiqueta_abrir_painel` abre `painel.html#custos` (ou `#etiquetas`) pelo clique da seller. TikTok: etiqueta liga junto com o TikTok consentido, a seller pode desligar só a etiqueta.
- Config nova: `cfg.etiquetas = {shopee, magalu, tiktok}`, `cfg.magalu_comissao_pct`, `cfg.magalu_taxa_fixa`.
