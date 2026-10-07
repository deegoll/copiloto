# Quadro das sessões (nuvem × local)

Regras no `CLAUDE.md`. Resumo: `git pull --rebase` → reservar aqui (commit + push na hora) → trabalhar só nos arquivos reservados → testes `TUDO OK` → mover para Feito → push. Nunca merge, nunca force.

Branch de trabalho: `copiloto-v3.3.0` (PR #1). Horários em UTC.

## Em andamento

| Lado | Tarefa | Arquivos reservados | Desde |
|---|---|---|---|
| nuvem | Auditoria de prontidão para a Chrome Web Store (só leitura; o resultado vira tarefas na Fila) | nenhum | 07/10 01:55 |
| nuvem | Rastreio dos pedidos da dona contra o código e backlog para vender mais (só leitura; o resultado vira tarefas na Fila) | nenhum | 07/10 02:05 |

## Fila

### Local (precisa do Chrome logado no ML)

1. **Sincronizar a pasta** com o branch `copiloto-v3.3.0` e carregar a extensão da pasta no Chrome (modo desenvolvedor, "Carregar sem compactação").
2. **Mapear ao vivo a tela de experiência de compra** de um anúncio amarelo ou vermelho ("Analisar desempenho"). Salvar o estado da página como retrato em `tests/copiloto/fixtures/` (sem dado de comprador) e anotar em **Recados** a URL e de onde vem o dado. É a peça que falta para a nota de experiência chegar ao vivo (`SHC.mlExperienciasDoEstado` já lê o formato oficial).
3. **Testar ao vivo:** etiquetas no ML, painel lateral (Full com produto esgotado, Pós-venda › Motivos com o "Envie só se…", Conciliação › Como pedir de volta), "Outra empresa" com 2 contas.
4. **Rodar a suíte interna de 87 arquivos** e anotar em **Recados** o que mudou de texto (devolução 🟡 e tarifa estimada agora são "Pedido de revisão").
5. **Publicar pela API** só depois do veredito da auditoria e com o OK da dona: `node deploy/cws-publicar.js deploy/copiloto-chrome-web-store/copiloto-v3.3.0.zip --enviar`.

### Nuvem

A lista completa sai do rastreio em andamento. Já conhecidas (lacunas registradas no `NOVIDADES-3.3.0.md`):

1. Full: médias de 7, 30, 60 e 90 dias, cobertura em dias e custo de armazenagem em R$ por produto.
2. Alerta de pausa repentina e de mudança de título, categoria ou marca no anúncio (comparando os retratos da lista de Anúncios).
3. Calendário de datas fortes na sazonalidade do Full.
4. Textos finais da ficha da loja e da política de privacidade (depois da auditoria).

## Ideias

(Qualquer sessão escreve aqui o que a outra deve pegar. Quem pegar, move para a Fila do seu lado.)

## Recados

- **nuvem → local (07/10 02:43):** o código da 3.3.0 está em `copiloto-v3.3.0`, commit mais novo no GitHub. Zip `copiloto-v3.3.0.zip`, SHA-256 `a037454e…6e68` (no `VERSOES.md`). Não publique antes do veredito da auditoria. Comece pelos itens 1 a 3 da Fila local.

## Feito

| Lado | Tarefa | Commit |
|---|---|---|
| nuvem | 3.3.0: multi-empresa, Full pela saúde do anúncio, experiência de compra, contestação técnica | `cb07cf0` |
| nuvem | 9 correções da 1ª revisão de código | `c49dd00` |
| nuvem | Publicação pela API lendo a credencial do ambiente | `d99848f` |
| nuvem | 7 correções da 2ª revisão (Full, exclusão, ERP por empresa, texto do Fechamento) | `9a8daca` |
| nuvem | `.gitattributes` sem conversão de fim de linha | `26d50a6` |
