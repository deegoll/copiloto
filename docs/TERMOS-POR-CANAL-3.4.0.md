# Termos e escolha de canais (Copiloto 3.4.0) — RASCUNHO para a dona e o jurídico

Pedido (07/10/2026): cada canal com os próprios termos, aceite por canal, e a seller escolhe com quais canais quer trabalhar; nada de importar automático.

## Fluxo atual do TikTok (o molde)
1. Painel lateral › Ajustes › "Canais de venda": a chave do TikTok, ao ser ligada, só abre um `<dialog>` ("Antes de ligar o TikTok Shop") e volta desmarcada; nada é pedido (`P.quadroTiktokHtml`, painel-lateral.js).
2. O quadro diz o que lê, para quê, como (copia a resposta que a tela já recebeu; sem robô, sem chamadas próprias), como parar/apagar, aviso sobre os termos do TikTok e link da política de privacidade.
3. "Agora não" (ou Esc) fecha sem gravar. "Concordo e ligar" pede, no mesmo clique, `scripting` + `https://seller-br.tiktok.com/*` (permissões opcionais) e grava `cfg.consentimento_tiktok = {versao:'3.3.0', em}`.
4. A seller ainda toca em "Salvar canais" (`cfg.modulos.tiktok = true`). O fundo (`TT.sincronizarScripts`, tiktok.js) só registra `tiktok-pagina.js`/`tiktok-tela.js` com permissão + módulo + consentimento. Sem qualquer um, nenhum script e a captura do fundo recusa.
5. Desligar: o fundo tira a leitura, o painel devolve as permissões e pergunta "Apagar também os dados do TikTok?"; há também o botão "Apagar dados do TikTok" (`TT.apagarDados`: `tt:*` e `c|tiktok|*`).
6. O TikTok não troca de versão de termos (o consentimento guarda a versão, mas nada exige novo aceite).

## O que foi implementado (Shopee e Magalu, etiquetas 3.4.0)
- `termos-canais.js` (novo): `CopilotoTermos` = `VERSAO` ('3.4.0-rascunho'), textos por canal, `aceito(cfg, canal)`, `pedeNovo`, `registro()`. Mudou o texto: suba `VERSAO` e todos aceitam de novo.
- `etiqueta-registro.js`: `R.ligado` de Shopee/Magalu exige `cfg.etiquetas[c] === true` **e** `cfg.termos[c].versao === VERSAO`. Sem aceite: nenhum script, nenhuma leitura. O fundo carrega `termos-canais.js` antes (`fundo/01-carga-e-eventos.js`); versão nova desregistra na próxima sincronização.
- `etiqueta-ajustes.js` + `painel.html`: card "Escolha com quais canais quer trabalhar" (ML sempre ligado; Shopee e Magalu desligados por padrão com "Ligar este canal"; TikTok mostra o estado e aponta para o fluxo dele). Ligar = abre termos → marca "Li e concordo" → "Concordo e ligar" → pede permissão no clique → grava `cfg.termos[c] = {versao, em}`. Desligar = tira a leitura, devolve a permissão, oferece apagar aceite e interruptor do canal (o custo por SKU vale para todos os canais e fica). O card some após "Concluir a escolha" (`cfg.escolha_canais`); `painel.html#canais` reabre.
- Pendência de primeiro uso: a instalação ainda abre `apresentacao.html` (cujo "Começar" abre `painel.html#bem-vindo`). Para a escolha aparecer na instalação, mudar esse destino para `painel.html#canais` (não mexi: `apresentacao.js` e o teste dela).
- Teste: `tests/copiloto/teste_termos_canais.js`.

## Textos dos termos (Shopee / Magalu)
Para cada canal (site `seller.shopee.com.br` / `seller.magalu.com`):
- **O que lê:** só o preço e o SKU de cada produto que a lista já mostra; nenhuma chamada nova; não clica, não altera, não escreve.
- **Para quê:** a etiqueta "Sobra R$ X · margem Y%" com o custo que a seller já informou.
- **O que guarda:** o aceite (data e versão) e o custo por SKU (vale para todos os canais). Nada do canal é copiado.
- **Para onde vai:** lugar nenhum; fica no Chrome deste computador.
- **Para parar:** desligar o canal; devolve a permissão; oferece apagar os dados do canal.
- Magalu: a comissão é a que a seller informa em Ajustes.
Não há cláusula jurídica além do que a extensão faz. A tela marca "(texto em revisão)" enquanto a versão tiver "rascunho".

## ML: proposta (NÃO implementada; a dona decide)
Hoje o ML roda automático: `host_permissions` fixas (`vendedores.mercadolivre.com.br`, `pa.mercadolivre.com.br`) + content scripts no manifest.
Para ser opt-in como o TikTok:
1. Mover os 2 hosts para `optional_host_permissions`; tirar `content_scripts` do manifest e registrá-los por `chrome.scripting.registerContentScripts` (como `TT.SCRIPTS`), com aceite `cfg.termos.ml` + o mesmo quadro.
2. Migração de quem já usa: na atualização, se já há dados do ML (custos, `cfg`), gravar `termos.ml` com `versao` da migração e **manter** as permissões (host fixa concedida na instalação não some ao virar opcional? O Chrome costuma tratar como concedida; precisa teste em Chrome real) e registrar os scripts no `onInstalled('update')`. Quem não tiver permissão passa pelo quadro uma vez.
3. Sincronização (fundo) também lê o ML com host fixa: teria de checar o aceite antes de qualquer leitura.
Riscos: (a) o ML é o produto principal; um passo a mais na instalação derruba a ativação; (b) migração que perde a permissão deixa o Copiloto mudo sem aviso; (c) a Chrome Web Store reanalisa a mudança de permissões e a política/ficha; (d) quebra o `teste_ml_intocado.js` e as regras "ML intocado" da dona; (e) o painel lateral e o fundo assumem ML sempre presente. Benefício: coerência ("todo canal, com aceite") e menos permissão no momento da instalação.

## O que a política e a ficha precisarão dizer (não editei os arquivos publicados)
- Política: em "Etiquetas de ganho" já proposto em `ETIQUETAS-CANAIS-3.4.0.md`, acrescentar: cada canal só liga depois de a seller ler os termos e marcar "Li e concordo"; guardamos data e versão do aceite no Chrome; mudando os termos pede-se novo aceite; desligar oferece apagar os dados do canal.
- Ficha: descrição "você escolhe com quais canais trabalhar; os canais além do Mercado Livre começam desligados".
- Se o ML virar opt-in: justificativa de host do ML e a descrição mudam.
