# Copiloto: regras para as sessões do Claude

Duas sessões trabalham neste repositório ao mesmo tempo: uma na **nuvem** (claude.ai/code) e uma **local** (no computador da dona, com o Chrome logado no Mercado Livre). Elas nunca podem fazer o mesmo trabalho nem mexer no mesmo arquivo ao mesmo tempo. O quadro `COORDENACAO.md` é o combinado entre as duas.

## Qual sessão é você

- **Nuvem:** a variável de ambiente `CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE` existe (container Linux, pasta `/home/user/copiloto`).
- **Local:** a variável não existe (computador da dona, Windows).

Uma sessão local aberta por `claude --teleport` traz o histórico da nuvem. Ela continua sendo a **local**: não retome o que o histórico mostra como "em andamento" na nuvem; olhe o `COORDENACAO.md`.

## Antes de qualquer trabalho

1. `git pull --rebase origin copiloto-v3.3.0`
2. Leia o `COORDENACAO.md`. Escolha uma tarefa da **Fila** que seja do seu lado (ver "Quem faz o quê") e cujos arquivos não estejam em **Em andamento** da outra sessão.
3. Reserve: mova a tarefa para **Em andamento** com o seu lado, os arquivos que vai mexer e a hora. Faça o commit (`coordenação: <nuvem|local> pega <tarefa>`) e o push **na hora**, antes de começar.
4. Se o push for recusado, a outra sessão gravou antes: `git pull --rebase`, leia o quadro de novo e, se ela pegou a mesma tarefa ou os mesmos arquivos, escolha outra.

## Durante e no fim

- Mexa só nos arquivos que você reservou. Precisa de outro? Reserve antes (commit e push do quadro).
- Commits pequenos. Antes de cada push: `git pull --rebase origin copiloto-v3.3.0`. **Nunca** `git merge`, nunca `git push --force`.
- Ao terminar: `node tests/copiloto/rodar_todos.js` tem de dar `TUDO OK`. Mova a tarefa para **Feito** com o hash do commit e libere os arquivos (commit e push).
- Ideia nova que a outra sessão deve fazer: escreva em **Ideias** no quadro. Não comece o que é do outro lado.

## Quem faz o quê

| Local (tem o Chrome logado) | Nuvem (sem acesso ao computador) |
|---|---|
| Mapear telas do ML ao vivo e salvar o retrato em `tests/copiloto/fixtures/` (sem dado de comprador) | Código a partir dos retratos, testes, refatoração |
| Testar a extensão carregada da pasta, no ML de verdade | Documentação (`NOVIDADES`, `README`, `VERSOES`) |
| Rodar a suíte interna de 87 arquivos | Empacotar (zip e SHA-256), quando reservado no quadro |
| Publicar pela API (`deploy/cws-publicar.js`, com o `cws-credentials.json` local), só com o OK da dona | Revisões e auditorias |

## Mensagens entre as sessões

- **Local → nuvem:** `claude -p "mensagem" --cloud session_01FE84vV3XUyQRiAJchsNoKy`
- **Nuvem → local:** a nuvem não manda mensagem; ela escreve no `COORDENACAO.md` (seção **Recados**) e faz o push. A local lê depois do `git pull`.

## Regras do projeto

- Português nas respostas e nos textos. Para cada problema: diagnóstico, solução e a lista de tarefas para a equipe.
- Nada de black hat: nada de fraude, de manipular avaliação, de burlar algoritmo. Textos de contestação só com fatos que o Copiloto leu; na dúvida, o texto pergunta.
- Melhore o que já existe antes de criar arquivo ou função nova; procure primeiro.
- Credenciais nunca no chat nem no Git (`deploy/cws-credentials.json` está no `.gitignore`).
- Pacote: o `deploy/copiloto-chrome-web-store/empacotar.ps1` define a lista fechada; o zip tem de ser byte a byte igual à pasta `extension-copiloto/`. O `.gitattributes` (`* -text`) impede conversão de fim de linha. Mudou código da extensão: zip refeito e SHA atualizado no `VERSOES.md` no mesmo commit.
- Etiqueta `copiloto-vX.Y.Z` e envio à loja só com o OK da dona.
