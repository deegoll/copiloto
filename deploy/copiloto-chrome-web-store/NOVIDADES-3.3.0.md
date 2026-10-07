# Copiloto 3.3.0: multi-empresa blindado, Full inteligente, experiência de compra e contestação técnica

Pacote: `copiloto-v3.3.0.zip` (nesta pasta, gerado pela mesma lista fechada do `empacotar.ps1`). SHA-256 e data no `VERSOES.md`.
**Ainda não enviado à loja.** O envio para análise só sai com o OK da dona (regra do `VERSOES.md`).

## Em resumo

1. **Multi-empresa sem mistura.** Trocar o login do ML no meio da sincronização gravava a empresa nova nas chaves da antiga, e o mês fechado lido assim não era mais relido. Agora a sessão é conferida antes e depois de cada etapa, e mais uma vez no fim. Se trocou, a sincronização para ("o Mercado Livre mudou de conta no meio da leitura") e os meses lidos naquela rodada voltam para a fila. Na página do ML de outra conta, o Copiloto não mostra etiqueta nenhuma e avisa.
2. **"Outra empresa" em Ajustes.** Com 2 ou mais contas, cada conta pode ser marcada como de outra empresa. Aí custos por SKU, imposto, margem, despesas fixas e ERP passam a ser só dela. As contas não marcadas continuam dividindo tudo, como sempre.
3. **Full pela saúde do anúncio.** A sugestão de envio não manda mais estoque para anúncio que não sai:
   - Anúncio parado (tem estoque e nenhuma venda em 30 dias) não usa mais a venda do ano passado.
   - Anúncio fora do ar, ou com experiência de compra ruim, ou pausado pela experiência: não envia.
   - Experiência mediana, problema na reputação ou qualidade básica: cobre no máximo 15 dias.
   - Sazonalidade de verdade: as vendas de 30 dias × o índice do ano passado (mês que vem ÷ mês de agora), até 3×.
4. **Estoque empacado.** "Parado ou sobrando no Full" agora diz quantas unidades sobram e o custo de armazenagem e de estoque antigo (a partir de 4 meses; 2 em Supermercado). Também sugere o que fazer: corrigir o anúncio, fazer promoção ou pedir a retirada antes dos 4 meses.
5. **Experiência de compra no sino.** Nota de 0 a 100, faixa, problema principal, queda desde a última leitura e "Não mande mais unidades ao Full" quando o anúncio tem estoque lá. Também entram os avisos do próprio ML sobre exposição, experiência, moderação e qualidade.
6. **Textos de contestação no modelo da dona.** Todos seguem a mesma estrutura:
   - Assunto com SKU e pedido.
   - "Prezada equipe de suporte".
   - Os números do painel.
   - A regra do ML com o link da Central.
   - O pedido explícito: revisão da cubagem, correção para os envios futuros e estorno.
   - Os anexos.

   São seis textos: frete do anúncio, cobranças do Fechamento, tarifa de devolução, medidas, **remessa do Full com inconformidade (novo)** e **pedido de exclusão de reclamação (novo)**. O pedido de exclusão só sai para os casos da lista oficial de exclusões do ML (arrependimento com produto perfeito, engano, não reconhece a compra, consta entregue, demora do transporte dentro do prazo, troca de tamanho). Defeito, produto diferente, peça faltando, não despachado e falta de estoque nunca geram pedido de exclusão.

Nenhuma permissão nova. Nenhum dado de comprador novo.

## Correções da revisão de código (07/10/2026)

Uma revisão independente do código da 3.3.0 achou 9 problemas antes do envio. Todos foram corrigidos e ganharam teste:

| # | Problema | Correção |
|---|---|---|
| 1 | "Esquecer" o ERP numa empresa apagava a credencial da OUTRA e tirava a permissão do Chrome de todas | Apaga só a da empresa aberta; a permissão só sai quando nenhuma empresa usa aquele ERP (`SHC.erpEmOutraEmpresa`) |
| 2 | O Fechamento (e o cartão do guia e o lucro do TikTok) usava custo, imposto e despesas da outra empresa | Leem pela camada da empresa (`SHC.areaEmpresa`, `SHC.lerCfg`) |
| 3 | O Full não repunha produto **esgotado**: o ML pausa o anúncio sem estoque e o Copiloto lia como "fora do ar" | Esgotado (`out_of_stock`, "Sem estoque" ou 0 aptas no Full) não trava o envio. Pausado por você, finalizado e em revisão continuam travando, com o motivo |
| 4 | O pedido de exclusão saía para frases com culpa do vendedor ("me arrependi porque veio com defeito", "não postou nos Correios", "veio outro") | Culpa do vendedor no motivo veta a exclusão. A tela diz o que conferir antes de enviar (ex.: "Envie só se você despachou dentro do prazo") |
| 5 | Caso incerto (🟡 da devolução, tarifa pelo preço de hoje, frete pela mediana) gerava texto afirmando "cobrança indevida" | Esses viram **Pedido de revisão**: os números, a base da estimativa e o estorno **se a diferença se confirmar** |
| 6 | "Configurado" (imposto informado) era um só para todas as empresas | É por empresa. Salvar apelidos, "Outra empresa" ou módulos não marca mais o imposto como informado |
| 7 | O seletor de conta da tabela de custos mostrava conta de outra empresa com os custos desta | Só as contas da mesma empresa; aviso de que as outras têm os custos delas |
| 8 | Importação do ERP que durava minutos podia gravar na empresa errada se o ML trocasse de conta no meio | A importação grava sempre na empresa do começo (Tiny, Omie e Bling, pelo painel e pelo fundo) |
| 9 | A releitura depois de troca de conta perdia meses: fuso fora de Brasília perto da meia-noite, mês cortado (80+ páginas) e vendas brutas | Compara pelo menor dia (local ou Brasília) e também põe na fila o mês cortado (`cortadoEm`) e o das vendas brutas (`lidoTs`) |

## O que mudou, por arquivo

- `store.js`:
  - A camada `area()` separa os custos por SKU (`c|sku@<conta>|…`) e o ERP (`erp@<conta>:…`) da conta marcada como outra empresa.
  - `lerCfg` e `salvarCfg` levam imposto, margem, despesas e o plano da Shopee para `cfg.porConta`.
  - Nova função `SHC.contasDaEmpresa`.
  - Mensagem nova de sincronização: `outra_conta`.
- `fundo/08` e `fundo/10`:
  - `contaSegue` faz no máximo 1 GET por minuto, e só acusa troca com prova.
  - `marcaReler` cuida dos meses lidos depois da troca.
  - Conferência no fim da sincronização e no histórico em segundo plano.
- `fundo/09` e `tiny.js`: o ERP grava e confere só as contas da mesma empresa.
- `fundo/13`, `fundo/14` e `copiloto-ml.js`: nova mensagem `experiencia_anuncios`. Ela confere a aba e a conta, e os tipos e tamanhos dos dados. Grava em `exp:<conta>`, com a nota anterior.
- `fundo/14`: o aviso de certificado sem a conta da página só vale com 1 conta no Chrome.
- `ml-extrator.js`:
  - `SHC.mlExperienciaCompra`, `SHC.experienciaAlertas` e `SHC.mlExperienciasDoEstado`, no formato oficial da documentação do ML.
  - Novo tipo de anomalia `experiencia`.
  - `SHC.REGRAS_ML` e `SHC.textoContestacao`.
  - Novas funções `SHC.chamadoExclusao`, `SHC.chamadoRemessa`, `SHC.chamadoExperiencia` e `SHC.motivoExcluivel`.
  - O Editor em massa guarda o nível da qualidade (`qNivel`).
- `ml-tela.js`: página de outra conta não ganha etiqueta e mostra um aviso.
- `painel-lateral.js`:
  - `P.previsaoFull` (parado e sazonal), `P.saudeEnvioFull`, `P.planoFull` (trava e cautela), `P.acaoParado` e a explicação de cada quantidade.
  - Novos botões "Copiar texto da reclamação" (remessa do Full) e "Copiar pedido de exclusão" (pós-venda).
  - "Outra empresa" em Ajustes.
- `painel.js` e `painel.html`: "Outra empresa" em Suas contas.
- `fechamento.js`: o texto da cobrança no formato novo. A dúvida continua só perguntando.
- Revisão de 07/10: `copiloto.js`, `tiktok.js`, `ml-tela.js` e `fechamento.js` leem custos e cfg pela camada da empresa. `erp-cruzar.js`, `tiny.js`, `fundo/09` e `fundo/10` gravam o ERP na empresa do começo da importação. `fundo/03` e `fundo/04` guardam quando cada mês foi lido (`cortadoEm`, `lidoTs`).

## Testes

`node tests/copiloto/rodar_todos.js` → `TUDO OK · 7 arquivos de teste passaram + a suíte do copiloto-nucleo`. São 4 arquivos novos:

| Arquivo | O que confere |
|---|---|
| `teste_multiconta.js` | Troca de login no meio da sincronização, releitura dos meses, certificado e isolamento de custos, imposto, despesas e ERP por empresa |
| `teste_full_saude_v33.js` | Previsão parada e sazonal, saúde do anúncio, plano travado e com cautela, estoque empacado, e a experiência da aba até o sino com a conta conferida |
| `teste_contestacao_v33.js` | O modelo da dona, as regras e o pedido explícito, e a trava de exclusão (nunca o que é do vendedor) |
| `teste_sku_frete_v33.js` | Herança de SKU no mesmo produto, SKU pelas vendas, Full e Editor, o alerta HA-14253 (R$ 45,35 × R$ 58,75) e a conta do "Cobrado a mais" (2.000 cenários) |

O `teste_fundo_dividido.js` agora aceita funções novas no fundo, desde que estejam listadas em `NOVAS` com a versão. A prova da divisão de 02/10 continua valendo: nenhuma função antiga pode sumir.

**A suíte interna (87 arquivos com dados reais) precisa ser rodada na máquina da empresa antes do envio.** Os testes que conferem o texto exato dos chamados e a previsão do Full vão precisar do texto e das regras novas. São estes os casos:

| Onde | O que mudou |
|---|---|
| `P.textoChamado` | Texto no formato novo |
| `SHC.fech.textoChamado` | Texto no formato novo |
| `SHC.chamadoDevolucao` | Texto no formato novo |
| `SHC.medidasChamado` | Texto no formato novo |
| `P.previsaoFull` | Anúncio parado com estoque passa a dar 0 |
| `SHC.chamadoDevolucao` (🟡) e `SHC.fech.textoChamado` (estimado) | "Pedido de revisão", com o estorno só se confirmar |
| `SHC.motivoExcluivel` | Culpa do vendedor no motivo veta a exclusão |
| `SHC.lerCfg` | `configurado` por empresa; o campo `empresaSemNumeros` saiu |
| `SHC.salvarCfg` de apelidos, "Outra empresa" e módulos | Não marca mais `configurado` |
| `P.saudeEnvioFull` | Anúncio esgotado não trava o envio |

## O que ainda falta (fica para as próximas)

1. **Ler a experiência de compra ao vivo.** O leitor está pronto no formato oficial e pega o registro em qualquer tela do ML que traga esse formato. Falta mapear ao vivo qual tela do painel ("Analisar desempenho") traz isso para o vendedor sem token de API. Até lá, entram os avisos de exposição e experiência que a lista de Anúncios já mostra.
2. **Shopee e Magalu.** Os textos de contestação já aceitam o canal (saudação certa, sem regra do ML). Falta a fonte de dados de cada canal: o adaptador da Shopee existe no `copiloto-nucleo`, mas não está na extensão. A Magalu não tem leitura.
3. **Política de privacidade.** Ela passa a cobrir `exp:<conta>` (nota e problemas da experiência de compra de cada anúncio, sem dado de comprador) e os custos e números por empresa. Conferir se a frase de "dados de saúde e reputação dos anúncios" da política no ar já cobre isso antes do envio.
4. **Envio à loja.** Precisa da credencial da Chrome Web Store (`deploy/cws-credentials.json`, fora do repositório) e do OK da dona.
