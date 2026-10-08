# Passagem de bastão — análise de segurança do TI da DB1 (08/10/2026)

Origem: "Análise SI extensão copiloto Meli 2.docx" (TI da DB1). Decisão da dona: **fazer todas as alterações**.
Regras fixas: nada de dado de cliente no GitHub; sem `git push --force`, sem merge, nunca em `main`; envio à loja só com OK explícito; reservar arquivos no `COORDENACAO.md` antes de mexer; ML "intocado" (`ml-tela.js`, `ml-extrator.js`, `fechamento.js`, funções de `calc.js`) só com liberação da dona.

## O que o TI apontou e o que fazer (em ordem)

1. **Criptografar tokens/chaves do ERP (Tiny, Bling, Omie) no `chrome.storage`.** Hoje estão em texto puro.
   AES-GCM (Web Crypto), chave derivada de senha da seller (PBKDF2, sal por instalação), senha nunca guardada; sem senha, não guardar o token. Arquivos: `store.js`, `tiny.js`, `bling.js`, `omie.js`. **Esperar a junção do PR #15** (conflito nesses arquivos). Teste: token gravado não aparece em claro; senha errada falha.
2. **Trocar "auditoria" por "revisão automatizada por IA, não substitui auditoria independente"** em docs, política, ficha da loja e `privacidade-loja.txt`. Texto/documentação apenas.
3. **Registro de riscos para a DB1/Marca Seleta assinar** (`docs/REGISTRO-DE-RISCOS.md`): riscos A (compliance com o ML), B (LGPD sem papéis/DPA), C (dependência de HTML não documentado), operacional (tráfego lido como bot). Cada um com dono, mitigação, data de revisão e campo de aceite formal. A IA não aceita risco pela empresa.
4. **Reduzir o risco operacional com o ML:** sincronização em segundo plano (`SHC.buscarVendo`, `calc.js:97`, chamada por `fundo/02` a `fundo/13`) só com aba do ML aberta e ativa, ou só ler o que a página já pede; pausar sozinho em captcha/429/403; deixar o segundo plano desligado por padrão. **Toca `calc.js` (ML intocado): pedir liberação da dona antes.**
5. **Itens que dependem de decisão humana (não é só código):** pedir autorização ao ML ou migrar o que der para a API oficial (risco A); mapa de dados, papéis LGPD e parecer jurídico (risco B); testes de contrato com fixtures e aviso ao usuário quando a leitura quebrar, em vez de número errado (risco C).

## Decisões já tomadas nesta sessão
- Correção de centavos do ML (C1): **fora da 3.4.0**, vai numa 3.4.1 separada.
- Envio da 3.3.0 à loja: só depois de a dona preencher "Privacy practices". Comando: `node deploy\cws-publicar.js deploy\copiloto-chrome-web-store\copiloto-v3.3.0.zip --enviar` (PowerShell, na pasta do SellerHub). Depois mover a tag `copiloto-v3.3.0` para `dc48109`.
- Termos de uso/privacidade para todos os canais (ML, Shopee, Magalu, TikTok), escolha na instalação: ramo `local/termos-todos` sobre `nuvem2/etiquetas-juntas` (PR #15), reservado no quadro.

## Pendências abertas (sem mudança)
- Conferir fatura de setembro (R$ 1.751,90) e Full #75336307: o Chrome da dona não estava conectado à sessão local; precisa das capturas ou da extensão do Claude conectada.
- Tarefas N-A, N-G, N-H, N-I, N-J, N-K, N-L, N-M: ver `COORDENACAO.md`.
- Resolver vermelhos do PR #15 sobre o local (`teste_ads_dados`, `teste_tiktok_dados`, `teste_apresentacao`, `teste_fixtures`, `teste_tiktok_nucleo`).

## Como retomar
1. `git pull` e ler o topo do `COORDENACAO.md`.
2. Reservar os arquivos do item que for fazer.
3. Trabalhar num ramo `nuvem*/...`, rodar a suíte, publicar o ramo e dar o recado no quadro.

## Atualização (08/10, noite) — o que já foi feito
- Item 2 (termo "auditoria") e item 3 (`docs/REGISTRO-DE-RISCOS.md`): feitos, commit `5b67139`.
- Item 4, parte do **freio**: feito no projeto local (`extension-copiloto/calc.js`, `SHC.buscarVendo`): captcha/desafio ou 5 respostas 429 seguidas pausam a leitura em segundo plano por 15 min (`SHC.pausaLeitura()`); leitura dentro da página do ML não muda. Patch em `docs/PATCH-freio-leitura-calc.patch`, teste em `docs/teste_freio_leitura.js.txt` (copiar para `tests/copiloto/teste_freio_leitura.js`). Suíte local: 111 arquivos mais o novo, todos verdes. Liberado pela dona (calc.js).
- **Não feito de propósito:** "só com aba do ML aberta". Quebra a sincronização em segundo plano que as telas usam; decidir com a dona se vale (ou deixar a sincronização desligada por padrão).
- Item 1 (cifrar token do ERP) segue esperando a junção do PR #15.
