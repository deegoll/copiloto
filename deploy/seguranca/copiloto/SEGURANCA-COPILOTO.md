# Segurança do Copiloto: o que foi conferido e o que dizer às clientes

Auditoria do código em 01/10/2026, com revisões em 02/10/2026. Este documento trata só do **Copiloto** (a extensão do Chrome), não do SellerHub.

Situação das versões hoje (02/10/2026):

| Versão | Onde está |
|---|---|
| 3.1.0 e 3.2.0 | Substituídas pela 3.2.1 na Chrome Web Store |
| 3.2.1 "blindada" | **Publicada na Chrome Web Store** (a ficha mostra a 3.2.1, atualizada em 02/10/2026). Pacote guardado: `deploy/copiloto-chrome-web-store/copiloto-v3.2.1.zip` |

Atualização de 02/10/2026: com a 3.2.1 publicada, os trechos abaixo que tratam a 3.1.0 como a versão das clientes, o envio da 3.2.1 e o teste antes do envio ficam como registro do que foi feito.

---

## Parte A: para você

### Quem fez e o que é esta auditoria

Foi uma **auditoria interna**, feita com ajuda de IA (Claude), lendo o código da extensão linha a linha e testando cada correção.
**Não é uma certificação nem um teste de invasão (pentest) feito por uma empresa de fora.** Se um dia quiser um selo, é preciso contratar uma empresa de segurança.

### O que foi conferido

- As permissões que o Copiloto pede ao Chrome.
- Para onde vai cada conexão de internet que o código faz.
- O que é lido das telas do Mercado Livre e do Mercado Pago, e o que fica guardado.
- Se algum texto vindo de fora consegue virar código na tela (todos os textos passam por limpeza antes de aparecer).
- As conversas entre as partes da extensão: quem pode pedir o quê.
- As planilhas que o Copiloto exporta.
- As chaves dos ERPs (Tiny, Omie, Bling) e o login da licença, que ainda está desligado.
- O pacote que vai para a loja e a política de privacidade.

### Resultado

Nenhum achado **grave** e nenhum **alto**. Todos ficaram como **baixo** ou **informativo** (reforço de defesa).
Para tirar proveito de qualquer um deles, a pessoa já precisaria estar **dentro** da página do Mercado Livre aberta no Chrome da seller, no computador dela ou no cadastro do ERP dela.
Nenhum deles deixava alguém de fora, pela internet, entrar no Copiloto ou pegar os dados da seller.

O que já estava bom (conferido no código):

- O Copiloto não pede senha e não lê cookies. Usa a sessão que a seller já tem aberta.
- Não altera nada no Mercado Livre. O robô de fotos e a adesão a promoções estão travados no código (`ROBO_ESCRITA_CONFERIDA` e `PROMO_ADESAO_CONFERIDA` = false). Na Agenda do Canal, o Copiloto preenche o formulário, mas quem clica em "Criar" é a seller.
- Não lê nem guarda nome, CPF/CNPJ, endereço, telefone ou mensagens de comprador.
- Os dados ficam no Chrome da seller. Hoje nada vai para servidores nossos nem para terceiros. A tela de login da licença está desligada e não faz nenhuma chamada.
- Nenhum site e nenhuma outra extensão consegue mandar comandos para o Copiloto.
- Não existe código baixado de fora. Tudo vai dentro do pacote revisado pela loja do Chrome.
- Pede pouca permissão: guardar dados, alarmes, painel lateral e 2 endereços do próprio Mercado Livre. O resto (Mercado Pago, ERPs, rodar com o Chrome fechado) é opcional e só é pedido quando a seller clica.

Isso também vale para a 3.1.0, que é a versão que as clientes têm hoje. Conferi o pacote dela: são as mesmas permissões e as mesmas travas, e não há nenhuma chamada a servidor nosso.

### O que foi achado e corrigido na 3.2.1

| # | O que era | O que foi feito |
|---|---|---|
| 1 | Uma tela do Copiloto (a Agenda do Canal) podia ser carregada pelas páginas do Mercado Livre | A tela não fica mais à vista dessas páginas. Para a seller, a Agenda continua abrindo igual |
| 2 | Algumas ações internas não conferiam quem estava pedindo | Agora todas conferem. Quase tudo só atende as telas do próprio Copiloto |
| 3 | Links que vêm do Mercado Livre eram usados sem conferir o endereço | Só abrem se forem do Mercado Livre ou do Mercado Pago |
| 4 | Os números lidos da tela do ML entravam sem limite | Agora entram com teto e faixa: número impossível, texto no lugar de número e lista gigante ficam de fora |
| 5 | Na planilha "ERP × ML", um nome de produto podia virar fórmula no Excel | Protegida, igual à planilha de custos, que já era |
| 6 | O aviso de certificado vencido podia sumir por engano | Corrigido |
| 7 | Chaves dos ERPs: faltava orientar a seller | Entrou uma linha nas telas de conectar: usar usuário só de leitura e, ao trocar de computador, "Esquecer token" (Tiny), "Esquecer chaves" (Omie) ou "Desconectar" (Bling) |
| 8 | A política de privacidade estava incompleta para a LGPD e tinha uma frase errada sobre afiliados (vale a partir da 3.2.0) | Rascunho novo pronto, **não publicado**: `deploy/seguranca/copiloto/privacidade-copiloto-RASCUNHO.html` |
| 9 | O empacotador não conferia as subpastas e não guardava a "impressão digital" do pacote | Confere as subpastas e imprime o SHA-256 |

Nenhuma permissão nova. O visual não muda, a não ser pela linha do item 7.
A lista técnica completa está em `deploy/copiloto-chrome-web-store/NOVIDADES-3.2.1.md`.

### O que ficou como risco aceito, e por quê

1. **As etiquetas de lucro e o custo digitado podem ser lidos por programas que rodam na própria página do Mercado Livre.**
   Isso inclui o próprio ML, outra extensão que a seller instalou ou uma ferramenta de análise da página.
   *Motivo:* as etiquetas aparecem dentro da tela do ML, e esse é o produto. Escondê-las com a mesma aparência é uma mudança grande, que fica para uma versão própria, testada por você ao vivo. Os números certos estão sempre no painel lateral, que a página do ML não alcança.
2. **As chaves dos ERPs ficam guardadas no Chrome sem cifra.**
   *Motivo:* cifrar com uma chave guardada no mesmo computador não protege de nada. O que protege de verdade é a seller conectar com um usuário **só de leitura** no ERP. Atenção: o token do Tiny e as chaves do Omie dão acesso à conta inteira do ERP. O Copiloto só usa a leitura de produtos e estoque, mas a chave em si abre tudo.
3. **Um número possível, mas errado, mandado pela página do ML ainda entra.**
   *Motivo:* para o Copiloto, é o que a tela do ML mostrou. O estrago fica só no Chrome da seller, e o número volta ao certo na próxima sincronização.
4. **Bling sem PKCE** (uma proteção extra do login): o aplicativo e a senha dele são da própria seller, e a volta do login é conferida. Se o Bling passar a aceitar PKCE, ligamos.
5. **Módulo TikTok:** está desligado. Antes de ligar, a conferência dele tem de ser reforçada (anotado).
6. **Licença:** hoje não manda nada. **Antes de ligar o login, a política nova tem de estar no ar**, porque a de hoje diz "não enviamos nada para os servidores do SellerHub".

### O que falta você decidir (nada foi enviado)

1. **Enviar a 3.2.1 para a loja.** Há dois caminhos:
   - **(a) Recomendado:** esperar a 3.2.0 ser aprovada e enviar a 3.2.1 logo em seguida.
   - **(b)** Cancelar a análise da 3.2.0 e enviar a 3.2.1 no lugar. A fila de análise começa de novo.
   Eu só envio com o seu OK.
2. **Política de privacidade:** preencher os [colchetes] do rascunho (nome ou razão social, CNPJ e encarregado), passar no advogado e publicar **no dia em que a 3.2.0 for aprovada**.
3. **Teste ao vivo da 3.2.1** (5 minutos, antes de enviar):
   1. Em `chrome://extensions`, clique em Recarregar no Copiloto e confira que aparece 3.2.1.
   2. Na página do Canal de transmissão, "Montar agenda da semana" tem de abrir a Agenda numa aba nova.
   3. Abra uma etiqueta de frete e veja se o painel lateral abre.
   4. No Resumo e nas Faturas do painel lateral, os botões têm de levar ao Mercado Livre normalmente.
   5. Exporte a planilha "ERP × ML" e abra no Excel: tem de abrir normal.
   6. Na tela de conectar o Tiny, o Omie ou o Bling, deve aparecer a linha "Segurança: …".

### Frases para NÃO usar com clientes

- "100% seguro", "impossível de hackear" ou "à prova de ataques". Nenhum programa é.
- "Certificado" ou "auditado por empresa de segurança". Foi uma auditoria interna.
- "Aprovado pelo Google como seguro". A loja revisa a extensão, mas isso não é um selo de segurança.
- "O Mercado Livre não vê o seu custo". Veja o risco 1. Diga: "o Copiloto não envia o seu custo para ninguém".
- "Só faz GET" ou "só lê as telas que você abre". O Copiloto também lê em segundo plano (sincronização), faz 2 consultas por POST que não gravam nada (notas fiscais e Simulador) e, quando o ML desvia a leitura do Ads, abre sozinho uma aba do Mercado Ads por alguns segundos (no máximo 1 vez a cada 6 h). Diga: "o Copiloto só **consulta**; não altera nada na sua conta".
- "As correções já estão na sua extensão". Isso só vale depois que a 3.2.1 for aprovada na loja.

---

## Parte B: texto pronto para clientes

### Versão curta (WhatsApp)

> Boa pergunta! Nenhum programa é 100% à prova de ataque, e a gente não vai prometer isso. Mas o Copiloto foi feito para correr pouco risco: ele só **consulta** o seu painel do Mercado Livre, não muda nada na sua conta, não pede a sua senha e não guarda dados dos seus compradores. Os seus números ficam só no seu Chrome: hoje o Copiloto não envia nada para servidores nossos nem para ninguém. O código passou por uma revisão de segurança em 01/10/2026. Para ficar ainda mais protegida: conecte o ERP com um usuário só de leitura, mantenha o Chrome atualizado e não instale extensões desconhecidas.

### Versão completa

> **Dá para hackear o Copiloto?**
>
> Nenhum programa é 100% à prova de ataque, e a gente não vai prometer isso. O que dá para garantir é como o Copiloto funciona, porque isso está no código:
>
> - **Ele só consulta.** O Copiloto lê o seu painel de vendedor do Mercado Livre (e o Mercado Pago, se você permitir) usando a sessão que já está aberta no seu Chrome. Ele não muda preço, anúncio, estoque, promoção nem campanha. Na Agenda do Canal, ele preenche o formulário, mas quem clica em "Criar" é você.
> - **Não pede a sua senha.** Ele não pede a senha do Mercado Livre e não lê os seus cookies. Se alguém pedir a sua senha "em nome do Copiloto", é golpe.
> - **Não guarda dados dos seus compradores.** Nome, CPF/CNPJ, endereço, telefone e mensagens de comprador não são lidos nem guardados.
> - **Os seus dados ficam no seu Chrome**, neste computador. Hoje o Copiloto não envia nada para servidores nossos nem para terceiros. As únicas conexões dele são com o Mercado Livre, com o Mercado Pago (se você permitir) e com o seu ERP (Tiny, Omie ou Bling, só se você conectar), direto do seu navegador. Se isso mudar um dia, a política de privacidade é atualizada antes.
> - **Nenhum site e nenhuma outra extensão consegue dar ordens ao Copiloto.** A parte dele que aparece dentro das páginas só roda no site de vendedores do Mercado Livre.
> - **Pede pouca permissão ao Chrome.** Ele não pede para "ler todos os sites", nem o seu histórico, cookies ou downloads. O que é extra (Mercado Pago, ERP) só é pedido quando você clica, e você pode tirar quando quiser.
> - **Não baixa código de fora.** Todo o código vai dentro da extensão que passa pela revisão da loja do Chrome.
> - **O código passou por uma revisão de segurança em 01/10/2026.** Não achamos nenhum ponto grave. Os reforços encontrados já foram corrigidos e vão na próxima atualização.
>
> **O que depende de você:**
>
> - Instale o Copiloto só pelo link oficial da Chrome Web Store.
> - No ERP, conecte o Copiloto com um usuário (ou aplicativo) **só de leitura**, se o seu ERP permitir. A chave do ERP fica guardada no seu Chrome, e com um usuário só de leitura ninguém consegue alterar nada no ERP com ela.
> - Mantenha o Chrome atualizado (as correções de segurança do Google chegam por ali) e use um antivírus.
> - Não instale extensões que você não conhece. Uma extensão maliciosa que tenha acesso ao site do Mercado Livre consegue ver o que aparece na tela, inclusive as etiquetas do Copiloto.
> - Ative a verificação em duas etapas na sua conta do Mercado Livre.
> - Ao trocar de computador ou num computador compartilhado, desconecte o ERP no Copiloto: "Esquecer token" (Tiny), "Esquecer chaves" (Omie) ou "Desconectar" (Bling).
>
> Ficou alguma dúvida? Pode chamar a gente.

---

## Parte C: rascunho da seção "Segurança" para a página do Copiloto no site

> ### Segurança e privacidade
>
> O Copiloto foi feito para **consultar**, não para mexer na sua conta.
>
> - **Só consulta o Mercado Livre.** Não altera preço, anúncio, estoque nem promoção.
> - **Não pede a sua senha** e não guarda dados dos seus compradores.
> - **Os seus números ficam no seu Chrome.** Hoje nada vai para servidores nossos nem para terceiros.
> - **Pede pouca permissão ao Chrome**, e o que é extra (Mercado Pago, ERP) só é pedido quando você clica.
> - **Código revisado** em uma auditoria interna de segurança em 01/10/2026.
>
> Dica: conecte o seu ERP com um usuário só de leitura.
> [Leia a política de privacidade completa](https://especialistaemmarketplace.com.br/sellerhub/copiloto/privacidade.html)

Observação: o link acima é o da política que está no ar hoje. Quando o rascunho novo for publicado, ele continua no mesmo endereço.
