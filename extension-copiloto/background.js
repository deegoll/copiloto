// Service worker do Copiloto (o manifest aponta para cá). 02/10: o código fica em fundo/, dividido por assunto; a junção das partes,
// na ordem, é o background.js do commit 7f7f312 byte a byte (tests/copiloto/teste_fundo_dividido.js confere).
// A ordem importa: o que roda na carga (eventos do Chrome, retomarInterrompida(), Object.assign do robô) só usa nome da mesma parte
// ou de parte anterior. Os importScripts de dentro das partes (calc.js, ml-tela.js…) continuam relativos à raiz da extensão.
importScripts(
    'fundo/01-carga-e-eventos.js',             // bibliotecas (calc, store, ml-extrator, núcleo do TikTok…), constantes, preparar e eventos do Chrome
    'fundo/02-anuncios-promocoes.js',          // leitura das páginas do ML, anúncios, atacado e promoções
    'fundo/03-faturamento.js',                 // cobranças, frete por pedido, migrações, fechamento, rateio e faturas
    'fundo/04-notas-e-vendas.js',              // NF-e, vendas brutas e vendas por anúncio
    'fundo/05-ads.js',                         // Mercado Ads
    'fundo/06-repasse-afiliados-simulador.js', // repasse do Mercado Pago, afiliados e simulador de custos
    'fundo/07-alertas-promocoes-full.js',      // alertas do ícone, robô de promoções, Full e remessas
    'fundo/08-sincronizacao.js',               // ciclo (retomada de onde parou), sincronizar() e o histórico em segundo plano
    'fundo/09-custos-erp.js',                  // ERPs (Tiny, Omie, Bling) e o cruzamento ERP × ML
    'fundo/10-status-saude-posvenda.js',       // fila do status, custos pelo fundo, saúde/fiscal, pós-venda e a retomada na carga
    'fundo/11-certificado-fotos-robo.js',      // certificado digital, rodada lenta (fotos, visitas, medidas, categoria) e robô de fotos
    'fundo/12-remessas-radar-resumo.js',       // detalhe das remessas, venda no prejuízo, radar e resumo para a equipe
    'fundo/13-aba-do-ml-e-canal.js',           // o que a aba do ML manda, editor em massa, Agenda/Robô do Canal e concorrentes
    'fundo/14-mensagens.js');                  // chrome.runtime.onMessage (todas as {acao})
