# Registro de riscos do Copiloto (para a DB1 / Marca Seleta)

Origem: análise de segurança do TI da DB1 (08/10/2026). **Estes riscos só passam a ser aceitos com assinatura de quem representa a empresa; a IA que escreveu o código não aceita risco em nome de ninguém.**
Aviso: as revisões feitas até hoje foram **automatizadas por IA** e não substituem auditoria ou pentest independente.

| ID | Risco | Causa | Consequência | Mitigação feita / prevista | Dono | Revisão | Aceite (nome, data) |
|---|---|---|---|---|---|---|---|
| R1 | Chaves e tokens de ERP em texto puro no `chrome.storage` | Armazenamento local sem cifra | Quem acessar o perfil do Chrome lê as chaves | Cifrar com AES-GCM e senha da seller (a fazer, após o PR #15) | a definir | 30 dias | |
| R2 | Tráfego automatizado lido como bot pelo ML | Chamadas com a sessão da seller, inclusive do service worker sem aba aberta | Captcha, limite de taxa ou restrição da conta | Limite de taxa já existe; prever: só com aba do ML aberta, pausa em captcha/429/403, segundo plano desligado por padrão | a definir | 30 dias | |
| R3 (A) | Sem contrato ou autorização do ML | Acesso ao painel via sessão do navegador | Bloqueio em massa e dano à reputação | Termos por canal com aceite da seller; pedir autorização ao ML ou migrar para a API oficial | a definir | 90 dias | |
| R4 (B) | LGPD sem papéis nem DPA | Sem instrumento formal com a origem dos dados | Questionamento do titular ou da ANPD | Mapa de dados, definição de controlador/operador e parecer jurídico | Jurídico | 90 dias | |
| R5 (C) | Dependência de HTML/JSON não documentado | Sem SLA nem canal com o ML | Funções quebram sem aviso | Testes de contrato com fixtures e aviso na tela quando a leitura quebrar | a definir | 30 dias | |
| R6 | "Auditoria" feita pela própria IA | Revisão sem independência | Falsa sensação de segurança | Textos já trocados para "revisão automatizada por IA"; considerar pentest externo | DB1 | 90 dias | |
