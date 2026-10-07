# Versões do Copiloto publicadas na Chrome Web Store

Cada versão publicada tem uma etiqueta no Git (`copiloto-vX.Y.Z`). Nela, a pasta `extension-copiloto/` é idêntica, byte a byte, ao zip enviado à loja.

| Versão | Zip gerado em | Situação | SHA-256 do zip | Etiqueta |
|---|---|---|---|---|
| 3.0.0 | 26/09/2026 14:48 | Análise concluída em 28/09/2026 | `c71083f4e8d4c040d68057290fe226d4a97cac91e61b696db1dff161edc650af` | `copiloto-v3.0.0` |
| 3.1.0 | 29/09/2026 20:05 | Publicada (100%) em 30/09/2026 | `4a730e6f3c29c921734b35da49780dfbf930853eb423b6572ecbffcca2f4c909` | `copiloto-v3.1.0` |
| 3.2.0 | 01/10/2026 16:22 | Publicada (100%) em 01/10/2026 | `33571b17ac0d22014645137c91ee0ef9a344860a122755810158b60abeddfcff` | `copiloto-v3.2.0` |
| 3.2.1 | 02/10/2026 04:20 | Publicada (100%) em 02/10/2026 | `809bea9ba393637328f19f7ba49d58694bb12975ed6f60eb8afea0acd213f0f1` | `copiloto-v3.2.1` |

## Como conferir uma versão

```bash
git show copiloto-v3.2.1 --stat
sha256sum deploy/copiloto-chrome-web-store/copiloto-v3.2.1.zip
node deploy/conferir-crx.js 3.2.1   # baixa o CRX da loja e compara com o zip
```

O `conferir-crx.js` só confere a versão que a loja distribui hoje. Conferido em 07/10/2026: o CRX da 3.2.1 é igual ao zip (43 arquivos; a loja só acrescenta `_metadata/` e a linha `update_url`).

## Regra para as próximas versões

1. Subir a versão no `manifest.json`. O `empacotar.ps1` recusa uma versão que já tem etiqueta, para não apagar o zip publicado.
2. `empacotar.ps1` gera o zip (só depois de todos os testes passarem).
3. Antes de enviar à loja: commit da pasta `extension-copiloto/` e etiqueta `copiloto-vX.Y.Z` apontando para esse commit.
4. Acrescentar a linha nesta tabela com o SHA-256 do zip e a data.
5. Envio para análise só com o OK da dona.
6. Depois de publicada: `node deploy/conferir-crx.js X.Y.Z`.
