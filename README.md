# Copiloto: extensão do Chrome para vendedores do Mercado Livre

Repositório do Copiloto preparado para a **revisão de segurança do código**. Ele contém só o Copiloto: a extensão, o núcleo de cálculo, os testes que conferem o código, o empacotador e o documento de segurança. Nenhum outro sistema da empresa e nenhum dado de cliente estão aqui.

- **Loja:** Chrome Web Store, item `fggodhhoencenpjoeppdlbabmhghilci` ("Copiloto: lucro no Mercado Livre").
- **Versão publicada:** 3.2.1 (02/10/2026).
- **Arquitetura:** tudo roda no Chrome do vendedor e os dados ficam em `chrome.storage.local`. Não há servidor intermediário, IA, telemetria nem biblioteca de terceiros.

## Versões publicadas e estado atual

| Etiqueta | O que é |
|---|---|
| `copiloto-v3.0.0` a `copiloto-v3.2.1` | Cada versão enviada à loja. Nelas, a pasta `extension-copiloto/` é idêntica, byte a byte, ao zip publicado. O SHA-256 de cada zip está em `deploy/copiloto-chrome-web-store/VERSOES.md` |
| `main` (último commit) | O código atual: a **3.3.0**, pronta e **ainda não enviada à loja** (zip e SHA-256 no `VERSOES.md`; o que mudou em `NOVIDADES-3.3.0.md`) |

A 3.3.0 traz, em relação à 3.2.1:

- **Multi-empresa:**
  - A sincronização confere a conta da sessão antes e depois de cada etapa e no fim. Se o login trocou, ela para (`outra_conta`) e os meses lidos voltam para a fila.
  - A tela do ML de outra conta fica sem etiqueta.
  - "Outra empresa" em Ajustes separa custos por SKU, imposto, despesas e ERP (`store.js`, `SHC.empresaSeparada`).
  - A importação do ERP grava sempre na empresa em que começou, e o "Esquecer" de uma empresa não apaga o ERP da outra.
- **Full pela saúde do anúncio:**
  - Anúncio parado não usa o ano passado, e a sazonalidade usa um índice.
  - Não envia para anúncio fora do ar, com experiência ruim ou pausado pela experiência. Anúncio esgotado (pausado pelo ML por falta de estoque) recebe a reposição.
  - Cautela (só 15 dias) com experiência mediana, problema na reputação, qualidade básica ou sem a Buy Box.
  - Aviso de estoque empacado.
- **Experiência de compra:** leitor no formato oficial do ML, alertas no sino e os avisos de exposição do próprio ML.
- **Textos de contestação:**
  - No modelo da dona, com a regra da Central e o pedido explícito.
  - Novos textos: remessa do Full e exclusão de reclamação. A exclusão sai só nos casos que as regras do ML aceitam, e nunca com culpa do vendedor no motivo.
  - Caso incerto vira "Pedido de revisão", com o estorno só se a diferença se confirmar.

Também já estavam no código atual em relação à 3.2.1:

- `licenca.js` e `licenca-tela.js` não vão mais no pacote. Na 3.2.1, eles carregam, mas ficam inertes: não há chave de produção, e a tela está escondida.
- `background.js` virou só um carregador de 14 partes, na pasta `extension-copiloto/fundo/`. Juntas, as partes são idênticas ao `background.js` anterior. Quem confere é `tests/copiloto/teste_fundo_dividido.js`.
- A tarifa do Mercado Envios (código DSB) passa a ser classificada como frete quando a cobrança vem sem texto.
- Os dados guardados ganham o canal no nome da chave (`SHC.chaveConta`). Os nomes do Mercado Livre não mudam.

```bash
git show copiloto-v3.2.1 --stat
sha256sum deploy/copiloto-chrome-web-store/copiloto-v3.2.1.zip
```

Para fechar a cadeia, baixe o CRX publicado do item acima e compare o conteúdo com o zip da etiqueta.

## Estrutura

| Pasta | O que é |
|---|---|
| `extension-copiloto/` | Código da extensão (MV3): `manifest.json`, `background.js` com `fundo/`, scripts de conteúdo e telas |
| `copiloto-nucleo/` | Núcleo de cálculo multicanal em JavaScript puro, sem dependências. `extension-copiloto/nucleo/` é uma cópia idêntica de parte dele |
| `tests/copiloto/` | Testes que conferem o código: segurança, conteúdo do pacote e divisão do fundo |
| `deploy/copiloto-chrome-web-store/` | Empacotador (`empacotar.ps1`), zips das versões 3.x, `VERSOES.md`, política de privacidade e textos da ficha |
| `deploy/cws-publicar.js` e `cws-autorizar.js` | Envio do zip pela API da Chrome Web Store. A credencial não está no repositório (`.gitignore`) |
| `deploy/seguranca/copiloto/` | Resumo de segurança do Copiloto e o rascunho da nova política |

## Como rodar os testes

Precisa do Node 18 ou mais novo. Não há `npm install`.

```bash
node tests/copiloto/rodar_todos.js
```

O resultado esperado é `TUDO OK · 7 arquivos de teste passaram + a suíte do copiloto-nucleo`. Dentro da suíte, um teste pulado conta como falha. Os 4 arquivos da 3.3.0 (`teste_multiconta.js`, `teste_full_saude_v33.js`, `teste_contestacao_v33.js` e `teste_sku_frete_v33.js`) usam só dados inventados no formato do ML.

**Por que só esses testes:** a suíte completa tem 87 arquivos de teste e 61 testes do núcleo, todos passando internamente em 03/10/2026. A maior parte usa dados reais de contas de clientes da consultoria (vendas, tarifas e faturas), e esses dados não podem sair da empresa. Aqui ficam os testes que conferem o código sem esses dados. O teste de segurança usa um resumo de conta com a mesma estrutura do real, mas com textos, números e identificadores inventados. A suíte completa pode rodar na nossa máquina, acompanhada pelo time de TI.

## Pontos para a revisão

- **Permissões:** `extension-copiloto/manifest.json` tem 4 permissões (`storage`, `unlimitedStorage`, `alarms` e `sidePanel`) e 2 hosts do Mercado Livre (`vendedores.` e `pa.mercadolivre.com.br`).
- **Permissões opcionais:** são pedidas só quando o vendedor clica: Mercado Pago (tela Atividade), anúncios e catálogo (`www.` e `produto.mercadolivre.com.br`), ERPs (Tiny, Omie e Bling, com a credencial do próprio vendedor), `background` e `identity` (login OAuth do Bling com o app do vendedor).
- **Leituras no Mercado Livre:** ficam em `background.js` e `fundo/`, com a sessão do navegador. Os únicos POSTs ao ML são consultas: busca de notas fiscais e calculadora do Simulador.
- **Travas de escrita:** `SHC.ROBO_ESCRITA_CONFERIDA` e `SHC.PROMO_ADESAO_CONFERIDA` ficam em `false` (`ml-extrator.js`). Com elas, os robôs de fotos e de promoções só sugerem.
- **Módulos desligados:** o TikTok fica travado (`SHC.MODULOS_TRAVADOS`, em `calc.js`). Ele não tem permissão nem host no manifest.
- **Conferências:** `tests/copiloto/teste_seguranca_321.js` cobre links, origens das mensagens, CSV e o pacote; `teste_pacote_licenca.js` confere a lista do empacotador.

## O que não está aqui

- Dados de clientes, retratos de telas de contas reais e testes que dependem deles.
- Credenciais de publicação, bloqueadas pelo `.gitignore`.
- Qualquer outro sistema da empresa.
- O histórico de desenvolvimento anterior. As versões publicadas foram refeitas a partir dos zips da loja.
