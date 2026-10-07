# Copiloto: extensão do Chrome para vendedores do Mercado Livre

Repositório do Copiloto preparado para a **revisão de segurança do código**. Ele contém só o Copiloto: a extensão, o núcleo de cálculo, os testes que conferem o código, o empacotador e o documento de segurança. Nenhum outro sistema da empresa e nenhum dado de cliente estão aqui.

- **Loja:** Chrome Web Store, item `fggodhhoencenpjoeppdlbabmhghilci` ("Copiloto: lucro no Mercado Livre").
- **Versão publicada:** 3.2.1 (02/10/2026).
- **Arquitetura:** tudo roda no Chrome do vendedor e os dados ficam em `chrome.storage.local`. Não há servidor intermediário, IA, telemetria nem biblioteca de terceiros.

## Versões publicadas e estado atual

| Etiqueta | O que é |
|---|---|
| `copiloto-v3.0.0` a `copiloto-v3.2.1` | Cada versão enviada à loja. Nelas, a pasta `extension-copiloto/` é idêntica, byte a byte, ao zip publicado. O SHA-256 de cada zip está em `deploy/copiloto-chrome-web-store/VERSOES.md` |
| `main` (último commit) | O código atual, à frente da 3.2.1 e **ainda não publicado** |

O código atual muda isto em relação à 3.2.1:

- `licenca.js` e `licenca-tela.js` não vão mais no pacote. Na 3.2.1, eles carregam, mas ficam inertes: não há chave de produção, e a tela está escondida.
- `background.js` virou só um carregador de 14 partes, na pasta `extension-copiloto/fundo/`. Juntas, as partes são idênticas ao `background.js` anterior. Quem confere é `tests/copiloto/teste_fundo_dividido.js`.
- A tarifa do Mercado Envios (código DSB) passa a ser classificada como frete quando a cobrança vem sem texto.
- Os dados guardados ganham o canal no nome da chave (`SHC.chaveConta`). Os nomes do Mercado Livre não mudam.

```bash
git show copiloto-v3.2.1 --stat
sha256sum deploy/copiloto-chrome-web-store/copiloto-v3.2.1.zip
```

Para fechar a cadeia, compare o CRX publicado com o zip da etiqueta:

```bash
node deploy/conferir-crx.js 3.2.1
```

O script baixa o CRX da loja e confere arquivo por arquivo. A loja só acrescenta `_metadata/` e a linha `update_url` no manifest. Conferido em 07/10/2026: os 43 arquivos são iguais.

**Versão 3.3.0:** a política de privacidade no ar foi atualizada em 06/10/2026 para a 3.3.0 (TikTok Shop ligável). O código da 3.3.0 ainda **não está** neste repositório nem na loja.

## Estrutura

| Pasta | O que é |
|---|---|
| `extension-copiloto/` | Código da extensão (MV3): `manifest.json`, `background.js` com `fundo/`, scripts de conteúdo e telas |
| `copiloto-nucleo/` | Núcleo de cálculo multicanal em JavaScript puro, sem dependências. `extension-copiloto/nucleo/` é uma cópia idêntica de parte dele |
| `tests/copiloto/` | Testes que conferem o código: segurança, conteúdo do pacote e divisão do fundo |
| `deploy/copiloto-chrome-web-store/` | Empacotador (`empacotar.ps1`), zips das versões 3.x, `VERSOES.md`, política de privacidade e textos da ficha |
| `deploy/conferir-crx.js` | Baixa o CRX da loja e compara com o zip enviado |
| `deploy/cws-publicar.js` e `cws-autorizar.js` | Envio do zip pela API da Chrome Web Store. A credencial não está no repositório (`.gitignore`) |
| `deploy/seguranca/copiloto/` | Resumo de segurança do Copiloto e o rascunho da nova política |

## Como rodar os testes

Precisa do Node 18 ou mais novo. Não há `npm install`.

```bash
node tests/copiloto/rodar_todos.js
```

O resultado esperado é `TUDO OK · 3 arquivos de teste passaram + a suíte do copiloto-nucleo` (30 de 30). Dentro da suíte, um teste pulado conta como falha.

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
