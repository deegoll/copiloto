# Versões do Copiloto publicadas na Chrome Web Store

Cada versão publicada tem uma etiqueta no Git (`copiloto-vX.Y.Z`). Nela, a pasta `extension-copiloto/` é idêntica, byte a byte, ao zip enviado à loja.

| Versão | Zip gerado em | Situação | SHA-256 do zip | Etiqueta |
|---|---|---|---|---|
| 3.0.0 | 26/09/2026 14:48 | Análise concluída em 28/09/2026 | `c71083f4e8d4c040d68057290fe226d4a97cac91e61b696db1dff161edc650af` | `copiloto-v3.0.0` |
| 3.1.0 | 29/09/2026 20:05 | Publicada (100%) em 30/09/2026 | `4a730e6f3c29c921734b35da49780dfbf930853eb423b6572ecbffcca2f4c909` | `copiloto-v3.1.0` |
| 3.2.0 | 01/10/2026 16:22 | Publicada (100%) em 01/10/2026 | `33571b17ac0d22014645137c91ee0ef9a344860a122755810158b60abeddfcff` | `copiloto-v3.2.0` |
| 3.2.1 | 02/10/2026 04:20 | Publicada (100%) em 02/10/2026 | `809bea9ba393637328f19f7ba49d58694bb12975ed6f60eb8afea0acd213f0f1` | `copiloto-v3.2.1` |
| 3.3.0 | 07/10/2026 (junção com o C2 da nuvem, `nuvem2/330-final`) | Pronta, **não enviada** (falta o OK da dona na política, a política no site, colar no painel e o envio) | `b8673b95e21713e55f60bb3f0e059cecf60463f61b26fab1f944cdd02724efb8` (refeito na local 07/10, atualizado em 08/10 com a política nova e regerado em 09/10 depois do teste ao vivo E23: janela de 3 meses na Conciliação, códigos CPMTP/CPCJP do ML e lista vazia do TikTok sem falso "tela mudou") | `copiloto-v3.3.0` (criar no commit enviado) |
| 3.3.1 | 09/10/2026 | Pronta, **não enviada** (falta o OK do Diego e do advogado nos textos novos, a política 3.3.1 no site, colar no painel e o envio) | `fff6ee21e6b630f04ec1b41a341e21c759eb6e356f94bd1075114f44850fbec5` (a 3.3.0 mais: consentimento do ML "Concordo e ligar", chaves dos ERPs cifradas AES-256-GCM, Catálogo preso à conta logada, etiqueta de lucro no Gerenciar produtos do TikTok, um "Apagar dados de todos os canais", a sincronização guiada com "Tentar de novo esta parte", a linha do tempo do frete dia a dia no detalhe do anúncio (com o botão "Ver a linha do tempo" no alerta) e os alertas analíticos de cobrança (produto, data, cobrado × esperado, link direto) e de fatura (ciclo)) | `copiloto-v3.3.1` (criar no commit enviado) |
| 3.3.2 | 10/10/2026 | Pronta, **não enviada** (falta o OK do Diego e do advogado nos textos novos, a política 3.3.2 no site, colar no painel, a validação ao vivo da etiqueta do TikTok e o envio) | `e3370072e10f72e11ae35cc3a72dd6be94a6d8c680e612ae9a58857a29236726` (a 3.3.1 mais: etiqueta do TikTok resolvendo a loja pelas chamadas de API da página quando a URL não mostra o `oec_seller_id` (com retentativa), e a devolutiva da revisão — "Abrir a cobrança" aponta para a lista do Faturamento validada ao vivo, aria do gráfico de frete separando "dias com dado" de "dias com venda", eixo do gráfico diário com o centavo do `SHC.moeda` e estilos inline em const) | `copiloto-v3.3.2` (criar no commit enviado) |

## Como conferir uma versão

```bash
git show copiloto-v3.2.1 --stat
sha256sum deploy/copiloto-chrome-web-store/copiloto-v3.2.1.zip
```

## Regra para as próximas versões

1. `empacotar.ps1` gera o zip (só depois de todos os testes passarem).
2. Antes de enviar à loja: commit da pasta `extension-copiloto/` e etiqueta `copiloto-vX.Y.Z` apontando para esse commit.
3. Acrescentar a linha nesta tabela com o SHA-256 do zip e a data.
4. Envio para análise só com o OK da dona.
