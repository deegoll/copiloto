# Registro de riscos do Copiloto (extensão do Chrome)

Pedido do TI da DB1 na "Análise SI extensão copiloto Meli 2" (item 3 do `docs/HANDOFF-ANALISE-TI-DB1.md`), 08/10/2026.

**Quem aceita cada risco é uma pessoa da DB1 ou da Marca Seleta, com nome e data.** Este documento foi redigido com ajuda de IA a partir do código e dos documentos do repositório. A IA não aceita risco em nome da empresa. Os campos "Dono", "Decisão" e "Aceite" ficam em branco até alguém responsável preencher e assinar.

Fontes no repositório: `deploy/seguranca/copiloto/SEGURANCA-COPILOTO.md` (revisão automatizada por IA de 01/10/2026, que não substitui auditoria independente), `extension-copiloto/manifest.json`, `deploy/copiloto-chrome-web-store/politica-privacidade.html` e os comentários do código citados abaixo.

## Escala

- **Probabilidade:** baixa, média ou alta.
- **Impacto:** baixo, médio ou alto.
- **Decisão:** aceitar, mitigar, transferir ou evitar.

## Resumo

| # | Risco | Probabilidade | Impacto | Dono | Decisão | Revisar em |
|---|---|---|---|---|---|---|
| A | Termos de uso do Mercado Livre (e dos outros canais) | média | alto | | | |
| B | LGPD sem papéis definidos nem contrato de tratamento | média | alto | | | |
| C | Dependência de telas e rotas internas não documentadas | alta | médio | | | |
| D | Tráfego da extensão lido como robô pelo canal | média | médio | | | |
| E | Token do ERP guardado sem criptografia no navegador | baixa | alto | | | |

A probabilidade e o impacto acima são uma **proposta** para discussão, não uma medição.

---

## A. Termos de uso do Mercado Livre e dos outros canais

**O que é.** O Copiloto lê as telas da conta da seller no Mercado Livre e, em segundo plano, consulta as mesmas rotas que essas telas usam, com a sessão já aberta no Chrome. Não usa a API oficial do ML com autorização de aplicativo. Os termos do ML (e os da Shopee, Magalu e TikTok Shop) podem não permitir ferramenta de terceiro que lê a loja dessa forma. O próprio Copiloto já mostra esse aviso para o TikTok antes do "Concordo e ligar".

**O que já existe.**
- A extensão só consulta. A escrita do robô de fotos e a adesão a promoções estão travadas no código (`SHC.ROBO_ESCRITA_CONFERIDA = false` em `ml-extrator.js`): hoje o robô só sugere, e quem troca as fotos é a seller. Na Agenda do Canal, quem clica em "Criar" é a seller (`SEGURANCA-COPILOTO.md`). Destravar a escrita muda este risco e pede nova decisão.
- Shopee, Magalu e TikTok só rodam com permissão opcional dada pela seller e aceite dos termos do canal (`cfg.termos[canal]`).
- Decisão da dona de 08/10: termos de uso e privacidade também para o ML, com escolha dos canais na instalação (ramo `local/termos-todos`).

**O que falta.**
- Pedir autorização ao ML ou migrar o que der para a API oficial. Decisão de negócio, não de código.
- Parecer jurídico sobre os termos de cada canal.

**Dono:** ____________ **Decisão:** ____________ **Revisar em:** ____/____/______

---

## B. LGPD sem papéis definidos nem contrato de tratamento

**O que é.** A extensão guarda no navegador da seller dados da operação dela (vendas, custos, anúncios, ERP). Não estão definidos por escrito: quem é controlador e quem é operador, a base legal, o mapa de dados e o contrato de tratamento (DPA) entre a DB1/Marca Seleta e a seller.

**O que já existe.**
- Os dados ficam no `chrome.storage` do navegador da seller. Nada vai para servidor da DB1 ou de terceiros (política de privacidade).
- Dado de comprador não é guardado. Os retratos de tela no GitHub passam pelo `deploy/retrato-har.js` e pelo `teste_fixtures_sem_cliente.js`.
- Remover a extensão apaga tudo. No painel há "Esquecer token" (Tiny), "Esquecer chaves" (Omie) e "Desconectar" (Bling). Desligar a etiqueta de um canal apaga o histórico de visitas dele (3.4.0, PR #15).

**O que falta.**
- Mapa de dados (o que é lido, onde fica, por quanto tempo).
- Papéis LGPD, base legal e DPA, com revisão jurídica.
- Canal do titular e pessoa encarregada (DPO), se aplicável.

**Dono:** ____________ **Decisão:** ____________ **Revisar em:** ____/____/______

---

## C. Dependência de telas e rotas internas não documentadas

**O que é.** O Copiloto depende do HTML e das respostas internas das telas dos canais. Quando o canal muda a tela, a leitura pode quebrar ou, pior, ler um número errado.

**O que já existe.**
- Regra "nunca número sem fonte": campo que não foi lido aparece como "não lido", nunca como zero.
- Testes com retratos anonimizados das telas (`tests/copiloto/fixtures/`).

**O que falta.**
- Testes de contrato para cada rota lida, que falham quando o formato muda.
- Aviso claro para a seller quando a leitura quebrar, em vez de esconder o número em silêncio.

**Dono:** ____________ **Decisão:** ____________ **Revisar em:** ____/____/______

---

## D. Tráfego da extensão lido como robô pelo canal

**O que é.** A sincronização em segundo plano faz várias consultas seguidas ao ML. O ML pode ler isso como robô, pedir captcha ou bloquear a conta da seller por um tempo.

**O que já existe.**
- Ao receber 429 ou 503, a extensão espera o `Retry-After` (no mínimo 10 s) e não repete a consulta em cada aba (`fundo/02-anuncios-promocoes.js`).
- Leitura parcial espera 1 h desde a última tentativa, e uma 2ª aba não lê junto (`copiloto-ml.js`).

**O que falta (item 4 do handoff; toca `calc.js`, que é "ML intocado", e precisa da liberação da dona).**
- Sincronizar só com uma aba do ML aberta e ativa, ou só ler o que a própria página já pede.
- Pausar sozinha em captcha, 429 ou 403.
- Deixar o segundo plano desligado por padrão.

**Dono:** ____________ **Decisão:** ____________ **Revisar em:** ____/____/______

---

## E. Token do ERP guardado sem criptografia no navegador

**O que é.** O token ou a chave do ERP (Tiny, Bling, Omie) fica em texto puro no `chrome.storage.local`. Quem tiver acesso ao perfil do Chrome da seller (outra pessoa no computador, um programa malicioso) pode ler o token.

**O que já existe.**
- O painel recomenda conectar o ERP com um usuário só de leitura e usar "Esquecer token", "Esquecer chaves" ou "Desconectar" ao trocar de computador (`SEGURANCA-COPILOTO.md`).
- A revisão de 01/10 não cifrou o token porque uma chave guardada no mesmo computador não protege. A proposta abaixo resolve isso com uma senha que só a seller sabe.

**O que falta (item 1 do handoff, depois da junção do PR #15).**
- Criptografar com AES-GCM (Web Crypto), com chave derivada de uma senha da seller (PBKDF2, sal por instalação). A senha nunca é guardada. Sem senha, o token não é guardado.

**Dono:** ____________ **Decisão:** ____________ **Revisar em:** ____/____/______

---

## Aceite formal

Declaro que li os riscos acima e tomei as decisões registradas em cada um.

| Nome | Cargo | Empresa | Data | Assinatura |
|---|---|---|---|---|
| | | | | |
| | | | | |
