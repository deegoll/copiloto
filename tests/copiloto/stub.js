// Stub de chrome.* em memória para testar a extensão fora do Chrome (mesmo contrato: Promises + onChanged).
(function () {
  const mem = {}, ouvintes = [];
  const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  const avisa = mud => setTimeout(() => ouvintes.forEach(f => f(mud, 'local')), 0);
  window.chrome = {
    storage: {
      local: {
        get: async k => { if (k === null) return clone(mem); const ks = Array.isArray(k) ? k : [k]; const o = {}; ks.forEach(x => { if (x in mem) o[x] = clone(mem[x]); }); return o; },
        set: async o => { const mud = {}; for (const k in o) { mud[k] = { oldValue: clone(mem[k]), newValue: clone(o[k]) }; mem[k] = clone(o[k]); } avisa(mud); },
        remove: async k => { const ks = Array.isArray(k) ? k : [k]; const mud = {}; ks.forEach(x => { mud[x] = { oldValue: clone(mem[x]) }; delete mem[x]; }); avisa(mud); }
      },
      onChanged: { addListener: f => ouvintes.push(f) }
    },
    runtime: { sendMessage: m => { (window.__msgs = window.__msgs || []).push(m); }, openOptionsPage: () => { window.__abriuPainel = true; }, getURL: p => p }
  };
  window.__mem = mem;
})();

// ?seed=demo → dados de exemplo (capturas de tela da loja). Só existe na página de teste.
(function () {
  if (new URLSearchParams(location.search).get('seed') !== 'demo') return;
  const mem = window.__mem, agora = Date.now();
  mem.cfg = { consentimento_ml: { versao: '3.3.1', em: '2026-10-09T00:00:00.000Z' }, imposto_pct: 6, margem_alvo_pct: 10, ml_comissao_classico: 13, ml_comissao_premium: 16.5, ml_tipo_padrao: 'classico', ml_frete_padrao: 0, sp_comissao_pct: 20, sp_taxa_fixa: 0, configurado: true };
  const c = (id, titulo, custo, extra) => { mem['c|ml|' + id] = Object.assign({ custo, titulo, atualizado: agora }, extra || {}); mem['v|ml|' + id] = { titulo, visto: agora }; };
  c('MLB1111111111', 'Fone Bluetooth com cancelamento de ruído', 52, { frete: 21.9 });
  c('MLB2222222222', 'Garrafa térmica inox 500 ml', 22);
  c('MLB3333333333', 'Capinha de silicone para celular', 16);
  c('MLB4444444444', 'Luminária LED de mesa articulada', 45, { frete: 24.5 });
  c('MLB6666666666', 'Mouse sem fio ergonômico', 28);
  mem['v|ml|MLB5555555555'] = { titulo: 'Kit panos de microfibra (3 unidades)', preco: 34.9, visto: agora };
})();

// Complementos do stub para o painel lateral v2 (abas, sincronização simulada).
(function () {
  const c = window.chrome;
  c.tabs = { create: o => { (window.__abas = window.__abas || []).push(o.url); } };
  c.action = { getUserSettings: async () => ({ isOnToolbar: !!window.__iconeFixado }) };
  // Permissões opcionais (Tiny, Omie, Mercado Pago, catálogo): o clique pede e o Chrome "permite"; nenhuma concedida de antemão.
  c.permissions = { request: async () => true, contains: async () => false, remove: async () => true };
  // Próxima sincronização automática (alarme 'shc-sync' de 3 h): a hora vem do seed (window.__proxSync), senão daqui a 3 h.
  c.alarms = c.alarms || { get: async n => (n === 'shc-sync' ? { name: n, scheduledTime: window.__proxSync || Date.now() + 3 * 3600e3 } : undefined) };
  const enviarOriginal = c.runtime.sendMessage;
  c.runtime.sendMessage = function (m, cb) {
    if (m && m.acao === 'sincronizar' && window.__semSync) return Promise.resolve({ ok: true });   // ?sync=falhou|nunca: o status fica parado para o print
    if (m && m.acao === 'sincronizar') {
      const mem = window.__mem;
      c.storage.local.set({ 'shc:status': Object.assign({}, mem['shc:status'] || {}, { estado: 'sincronizando' }) });
      setTimeout(() => {
        // Promoções por conta (ml:promos:<sellerId>, v2.4) e a chave antiga (store.js de antes da migração).
        Object.keys(mem).filter(k => /^ml:promos(:|$)/.test(k)).forEach(k => { const snap = mem[k]; snap.ts = Date.now(); c.storage.local.set({ [k]: snap }); });
        c.storage.local.set({ 'shc:status': { estado: 'ok', ultimaOk: Date.now(), fim: Date.now() } });
      }, 900);
      if (cb) cb({ ok: true });
      return Promise.resolve({ ok: true });
    }
    return enviarOriginal(m, cb);
  };
})();

// ?seed=v2 → dados de exemplo no formato da sincronização v2 (fictícios). ?seed=familias = este + seed-final.js (servidor.js).
(function () {
  if (['v2', 'familias'].indexOf(new URLSearchParams(location.search).get('seed')) < 0) return;
  const mem = window.__mem, agora = Date.now();
  const foto = (txt, cor) => 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="18" fill="' + cor + '"/><text x="48" y="60" font-family="Segoe UI,Arial" font-size="34" font-weight="700" fill="#fff" text-anchor="middle">' + txt + '</text></svg>');
  const fam = (n, titulo, cor, estoque, anuncios) => ({ chave: 'F' + n, id: String(n), titulo, foto: foto(titulo.slice(0, 2).toUpperCase(), cor), preco_txt: '', tipos: 'Clássico e Premium', estoque, envio_txt: 'Você oferece frete grátis', anuncios });
  const prop = (f, itemId, promo, datas, desc, preco, tarifa, envio, tipo) => ({ familia: 'F' + f, itemId, promo, datas, desconto_txt: desc, preco, tarifa, tipo: tipo || 'Clássico', envio, envio_desc: envio ? 'Grátis para o comprador' : '', recebe: Math.round((preco - tarifa - envio) * 100) / 100, recebe_obs: 'Não contempla descontos cumulativos' });
  const familias = [
    fam(1001, 'Fone Bluetooth com cancelamento de ruído', '#2563EB', 'Depósito: 134 u.', ['MLB1111111111', 'MLB7777777777']),
    fam(1002, 'Garrafa térmica inox 500 ml', '#059669', 'Full: 58 u.', ['MLB2222222222']),
    fam(1003, 'Luminária LED de mesa articulada', '#D97706', 'Depósito: 22 u.', ['MLB3333333333']),
    fam(1004, 'Kit panos de microfibra (3 unidades)', '#7C3AED', 'Depósito: 310 u.', ['MLB4444444444']),
    fam(1005, 'Mouse sem fio ergonômico', '#0F172A', 'Full: 41 u.', ['MLB5555555555']),
    fam(1006, 'Capinha de silicone para celular', '#DB2777', 'Depósito: 870 u.', ['MLB6666666666']),
  ];
  const propostas = [
    prop(1001, 'MLB1111111111', 'Nova proposta!', '28/set a 13/out', '(12%)', 529.9, 60.94, 106.85),
    prop(1001, 'MLB1111111111', 'Oferta relâmpago', '30/set', 'R$ 90', 499.9, 57.49, 106.85),
    prop(1002, 'MLB2222222222', 'Nova proposta para ganhar competitividade!', '24 a 27/set', '(14%)', 59.9, 16.29, 0),
    prop(1003, 'MLB3333333333', 'Nova proposta!', '28/set a 13/out', '(20%)', 79.9, 10.39, 24.5),
    prop(1003, 'MLB3333333333', 'Campanha de outubro', '1 a 31/out', '(21%)', 78.99, 19.77, 0),
    prop(1004, 'MLB4444444444', 'Nova proposta!', '28/set a 13/out', '(20%)', 27.9, 11.13, 0),
    prop(1005, 'MLB5555555555', 'Nova proposta para ganhar competitividade!', '24 a 27/set', '(17%)', 74.9, 19.24, 0, 'Premium'),
  ];
  mem.cfg = { consentimento_ml: { versao: '3.3.1', em: '2026-10-09T00:00:00.000Z' }, imposto_pct: 6, margem_alvo_pct: 10, ml_comissao_classico: 13, ml_comissao_premium: 16.5, ml_tipo_padrao: 'classico', ml_frete_padrao: 0, sp_comissao_pct: 20, sp_taxa_fixa: 0, configurado: true };
  mem['ml:promos'] = { ts: agora - 2 * 60000, paginas: 1, familias, propostas };
  mem['shc:status'] = { estado: 'ok', ultimaOk: agora - 2 * 60000 };
  mem['c|ml|F1001'] = { custo: 250, titulo: familias[0].titulo, atualizado: agora };
  mem['c|ml|F1002'] = { custo: 22, titulo: familias[1].titulo, atualizado: agora };
  mem['c|ml|F1003'] = { custo: 45, titulo: familias[2].titulo, atualizado: agora };
  mem['c|ml|F1005'] = { custo: 28, titulo: familias[4].titulo, atualizado: agora };
  // Família sem SKU com custo antigo na família (F…): a edição no Catálogo tem de valer mesmo assim.
  mem['c|ml|F1004'] = { custo: 20, titulo: familias[3].titulo, atualizado: agora };
  const hist = (pares) => { const h = {}; pares.forEach(([ini, fim, v]) => { for (let d = new Date(ini); d <= new Date(fim); d.setDate(d.getDate() + 1)) h[d.toISOString().slice(0, 10)] = v; }); return h; };
  mem['fh|ml|MLB1111111111'] = hist([['2026-07-01', '2026-09-24', 106.85]]);
  mem['fh|ml|MLB3333333333'] = hist([['2026-07-01', '2026-07-31', 19.45], ['2026-08-01', '2026-09-07', 20.1], ['2026-09-08', '2026-09-24', 24.5]]);
  mem['fh|ml|MLB5555555555'] = hist([['2026-07-01', '2026-08-31', 17.4], ['2026-09-01', '2026-09-24', 19.6]]);

  // v2.1: conta, retrato da lista de Anúncios (conta inteira), vendas e primeiro uso. Tudo fictício.
  const SELLER = '123456789';
  mem['ml:contas'] = { [SELLER]: { apelido: 'LOJA TESTE', visto: agora } };
  mem['ml:conta'] = SELLER;
  const an = (itemId, familia, sku, titulo, tipo, preco, tarifa, frete, estoque, extra) => Object.assign({ itemId, familia, sku, titulo, status: 'Ativo', tipo, preco, tarifa, frete, freteDeduzido: false, recebe: Math.round((preco - tarifa - frete) * 100) / 100, atacado: false, estoque, dentroDeFamilia: false }, extra || {});
  mem['ml:anuncios:' + SELLER] = { ts: agora - 5 * 60000, paginas: 1, total: 8, itens: [
    an('MLB1111111111', 'MLBU1001', 'FONE-ANC-PRETO', 'Fone Bluetooth com cancelamento de ruído', 'Clássico', 599.9, 68.99, 106.85, '134 disponíveis'),
    an('MLB7777777777', 'MLBU1001', 'FONE-ANC-BRANCO', 'Fone Bluetooth com cancelamento de ruído (branco)', 'Premium', 629.9, 103.93, 106.85, '134 disponíveis'),
    an('MLB2222222222', 'MLBU1002', 'GT-500-INOX', 'Garrafa térmica inox 500 ml', 'Clássico', 69.9, 15.09, 0, '58 no Full'),
    an('MLB3333333333', 'MLBU1003', 'LUM-LED-01', 'Luminária LED de mesa articulada', 'Clássico', 99.9, 12.99, 24.5, '22 disponíveis', { atacado: true }),
    an('MLB4444444444', 'MLBU1004', '', 'Kit panos de microfibra (3 unidades)', 'Clássico', 34.9, 11.13, 0, '310 disponíveis'),
    an('MLB5555555555', 'MLBU1005', 'MOUSE-ERG', 'Mouse sem fio ergonômico', 'Premium', 89.9, 14.83, 19.6, '41 no Full'),
    an('MLB6666666666', 'MLBU1006', 'CAPA-SIL', 'Capinha de silicone para celular', 'Clássico', 29.9, 9.64, 0, '870 disponíveis'),
    an('MLB8888888888', 'MLBU1008', 'CAD-GMR-01', 'Cadeira gamer reclinável', 'Clássico', 899.9, 116.99, 131.4, '9 disponíveis'),
  ] };
  mem['c|sku|CAD-GMR-01'] = { custo: 520, titulo: 'Cadeira gamer reclinável', origem: 'manual', atualizado: agora };
  mem['c|sku|FONE-ANC-BRANCO'] = { custo: 265, titulo: 'Fone Bluetooth (branco)', origem: 'manual', atualizado: agora };   // família com 2 SKUs
  mem['c|sku|CAPA-SIL'] = { custo: 180, titulo: 'Capinha de silicone para celular', origem: 'planilha', atualizado: agora };   // custo suspeito (> preço)
  mem['fh|ml|MLB7777777777'] = hist([['2026-07-01', '2026-09-24', 106.85]]);
  mem['fh|ml|MLB8888888888'] = hist([['2026-07-01', '2026-08-14', 124.6], ['2026-08-15', '2026-09-24', 131.4]]);
  // vd|ml|MLB → {orderId: {d, f, pc}} como o Faturamento grava (sem q: o ML não traz a quantidade; sem dado de comprador)
  const vendas = (id, lista) => { const v = {}; lista.forEach(([o, d, f, q, pc]) => { v[o] = { d, f }; if (pc) v[o].pc = true; }); mem['vd|ml|' + id] = v; };
  vendas('MLB3333333333', [['2000000001', '2026-07-03', 19.45], ['2000000002', '2026-07-12', 19.45], ['2000000003', '2026-07-20', 19.45], ['2000000004', '2026-08-02', 20.1], ['2000000005', '2026-08-09', 20.1], ['2000000006', '2026-08-21', 20.1], ['2000000007', '2026-09-09', 24.5], ['2000000008', '2026-09-15', 24.5], ['2000000009', '2026-09-18', 24.5], ['2000000010', '2026-09-19', 0, 1, true]]);
  vendas('MLB8888888888', [['2000000021', '2026-07-05', 124.6], ['2000000022', '2026-07-22', 124.6], ['2000000023', '2026-08-03', 124.6], ['2000000024', '2026-08-18', 131.4], ['2000000025', '2026-09-02', 131.4], ['2000000026', '2026-09-11', 131.4], ['2000000027', '2026-09-20', 131.4]]);
  vendas('MLB5555555555', [['2000000031', '2026-08-04', 17.4], ['2000000032', '2026-08-25', 17.4], ['2000000033', '2026-09-06', 19.6], ['2000000034', '2026-09-14', 19.6], ['2000000035', '2026-09-22', 19.6]]);
  // v2.2: 12 meses de vendas (Faturamento), Ads por anúncio/mês, medidas do ERP, competição e uma 2ª conta com o mesmo catálogo/SKU.
  const meses12 = []; for (let i = 11; i >= 0; i--) meses12.push(new Date(Date.UTC(2026, 8 - i, 1)).toISOString().slice(0, 7));
  const vCad = [], vFone = [];
  meses12.forEach((m, i) => [5, 15, 25].forEach((dia, k) => {
    const d = m + '-' + String(dia).padStart(2, '0');
    if (d > '2026-09-24') return;
    // Cadeira: R$ 124,60 → R$ 128,90 em mar/26 → R$ 131,40 em 15/ago.
    vCad.push(['21' + String(i).padStart(2, '0') + k + '00001', d, d >= '2026-08-15' ? 131.4 : (d >= '2026-03-01' ? 128.9 : 124.6)]);
    // Fone: frete estável; 1 venda por mês com frete por conta do comprador (fica fora das contas).
    vFone.push(['22' + String(i).padStart(2, '0') + k + '00001', d, k === 2 ? 0 : 106.85, 1, k === 2]);
  }));
  vCad.push(['2199900001', '2026-09-12', 262.8]);   // pedido de 2 unidades (o ML não diz): fica fora como "possível pedido com mais de 1 unidade"
  vendas('MLB8888888888', vCad);
  vendas('MLB1111111111', vFone);
  Object.assign(mem['c|sku|CAD-GMR-01'], { pesoKg: 24.8, larguraCm: 70, alturaCm: 36, comprimentoCm: 68, ean: '7890000000017' });
  mem['c|sku|LUM-LED-01'] = { pesoKg: 1.2, larguraCm: 20, alturaCm: 12, comprimentoCm: 45, origem: 'planilha', atualizado: agora };   // só medidas, sem custo
  const itensA = mem['ml:anuncios:' + SELLER].itens;
  itensA.forEach(it => { it.catalogo = ''; it.competicao = ''; it.competicaoTexto = ''; });
  Object.assign(itensA.find(it => it.itemId === 'MLB8888888888'), { catalogo: '3545161785', competicao: 'ganhando', competicaoTexto: 'Você oferece condições melhores do que outros vendedores.' });
  Object.assign(itensA.find(it => it.itemId === 'MLB1111111111'), { catalogo: '2233445566', competicao: 'perdendo', competicaoTexto: 'Revisar condições' });
  const SELLER2 = '987654321';
  mem['ml:contas'][SELLER2] = { apelido: 'LOJA TESTE 2', visto: agora - 86400000 };
  mem['ml:anuncios:' + SELLER2] = { ts: agora - 86400000, paginas: 1, total: 3, itens: [
    an('MLB9100000001', 'MLBU9001', 'CADEIRA-GAMER', 'Cadeira gamer reclinável preta', 'Premium', 879.9, 140.78, 131.4, '4 disponíveis', { catalogo: '3545161785', competicao: 'perdendo', competicaoTexto: 'Revisar condições' }),
    an('MLB9100000002', 'MLBU9002', 'GT-500-INOX', 'Garrafa térmica inox 500 ml', 'Clássico', 64.9, 14.2, 0, '30 disponíveis', { catalogo: '', competicao: '' }),
    an('MLB9100000003', 'MLBU9003', 'SO-CONTA-2', 'Produto só da conta 2', 'Clássico', 49.9, 6.5, 0, '12 disponíveis', { catalogo: '', competicao: '' }),
  ] };
  mem['shc:guia'] = { passo: 3, feitos: {}, tours: { anuncios: true } };
  mem['ml:promos:' + SELLER] = mem['ml:promos'];   // v2.4: promoções por conta (a antiga fica para o store.js de antes)
  // ?foco=MLB… simula o clique "Ver frete no Copiloto" de uma etiqueta no ML.
  const foco = new URLSearchParams(location.search).get('foco');
  if (foco) mem['shc:foco'] = { aba: 'frete', itemId: foco };
})();

// v2.3 (com ?seed=v2): Full em várias situações + vendas por mês (vm|ml) de 12 meses + Ads de mais anúncios. Tudo fictício,
// no formato de SHC.mlFullDoEstado. ?full=produtos (padrão) | sem | fiscal | antigo | nada (Full ainda não lido)
// | estranho (sem Full e sem a frase do ML) | casos (variações, sem anúncio, sem aptas, tamanho desconhecido) | erro (leitura falhou agora).
// &vm=curto → vendas por mês só de ago e set/26 (quem atualiza da 2.2 relê só 40 dias); o Ads continua com jul/26.
(function () {
  const q = new URLSearchParams(location.search);
  if (['v2', 'familias'].indexOf(q.get('seed')) < 0) return;
  const mem = window.__mem, SELLER = '123456789', tipo = q.get('full') || 'produtos';
  const meses = []; for (let i = 12; i >= 0; i--) meses.push(new Date(Date.UTC(2026, 8 - i, 1)).toISOString().slice(0, 7));   // set/25 … set/26
  const vm = (id, base, pico) => { const o = {}; meses.forEach(m => { o[m] = m === '2025-10' ? pico : base + (+m.slice(5) % 3); }); mem['vm|ml|' + id] = o; };
  vm('MLB1111111111', 16, 42); vm('MLB7777777777', 4, 6); vm('MLB2222222222', 35, 30); vm('MLB3333333333', 8, 20);
  vm('MLB5555555555', 22, 24); vm('MLB6666666666', 10, 11); vm('MLB8888888888', 3, 9); vm('MLB4444444444', 12, 12);
  let lidos = meses;
  if (q.get('vm') === 'curto') {
    lidos = ['2026-08', '2026-09'];
    Object.keys(mem).filter(k => k.indexOf('vm|ml|') === 0).forEach(k => { const o = mem[k]; Object.keys(o).forEach(m => { if (lidos.indexOf(m) < 0) delete o[m]; }); });
  }
  mem['ml:cobrancas:' + SELLER] = { completo12: true, ate: '2026-09-24', ts: Date.now(), incompletos: [], mesesLidos: lidos };
  // v2.4: Ads por anúncio do Mercado Ads (ads:<conta>, no formato de SHC.adsAnuncios) e Ads da conta no mês (fech:<conta>:<mês>).
  // Acima do equilíbrio: Cadeira (R$ 96 de Ads, 1 venda, sobra R$ 77,52), Mouse (R$ 95, 2 vendas × R$ 22,08) e Kit (R$ 25 sem venda).
  const ad = (itemId, titulo, custo, receita, vendas) => ({ itemId, titulo, campanhaId: '1', campanha: 'Em Alta', impressoes: 5000, cliques: 40, custo, receita, vendas, acos: receita ? Math.round(custo / receita * 10000) / 100 : null });
  mem['ads:' + SELLER] = { ts: Date.now() - 20 * 60000, temAds: true, periodo: { de: '2026-08-26', ate: '2026-09-24' }, campanhas: [{ id: '1', nome: 'Em Alta', status: 'active', estrategia: 'PROFITABILITY', roasObjetivo: 14.29 }],
    anuncios: [ad('MLB8888888888', 'Cadeira gamer reclinável', 96, 899.9, 1), ad('MLB1111111111', 'Fone Bluetooth com cancelamento de ruído', 210.5, 1799.7, 3),
      ad('MLB5555555555', 'Mouse sem fio ergonômico', 95, 179.8, 2), ad('MLB2222222222', 'Garrafa térmica inox 500 ml', 40, 349.5, 5), ad('MLB4444444444', 'Kit panos de microfibra (3 unidades)', 25, 0, 0),
      ad('MLB6666666666', 'Capinha de silicone para celular', 0, 0, 0)], resumo: { custo: 466.5 } };
  mem['fech:' + SELLER + ':2026-09'] = { porTipo: { tarifa_venda: 1250.4, frete: 830.2, ads: 466.5, ads_seguidores: 30 }, estornos: -40, qtdVendas: 61 };
  const esp = (id, titulo, usado, cap, noFull, pend) => ({ id, titulo, usado, capacidade: cap, pct: Math.round(usado / cap * 100), livre: cap - usado, noFull, pendente: pend, status: 'available' });
  const mes = (m, pill, motivo, a, b) => ({ mes: m, pill, motivo, segmentos: [{ id: 'totable', titulo: 'Pequenos e médios', unidades: a }, { id: 'non_totable', titulo: 'Grandes e extragrandes', unidades: b }] });
  const card = (titulo, pontos, max, texto) => ({ titulo, pontos, max, texto: texto || '', periodo: '' });
  const prod = (itemId, sku, titulo, tamanho, vendas30, aptas, aCaminho, dias, acao, extra) => Object.assign({ produtoId: 'MLBU' + itemId.slice(3, 9), itemId, itemIds: [itemId], titulo, sku, ean: '', variacao: '',
    vendas30, estoqueMedio: aptas, aCaminho, naoAptas: 0, aptas, tempoEstoque: 0, diasAteEsgotar: dias, esgotarTexto: dias === null ? 'Sem estoque' : dias + ' dias', acaoSugerida: acao || '', status: 'Ativa', tamanho, avisos: acao ? [acao] : [], colunasML: [] }, extra || {});
  const produtos = [
    prod('MLB1111111111', 'FONE-ANC-PRETO', 'Fone Bluetooth com cancelamento de ruído', 'MÉDIO', 18, 6, 0, 10, 'Envie mais unidades'),
    prod('MLB2222222222', 'GT-500-INOX', 'Garrafa térmica inox 500 ml', 'PEQUENO', 40, 58, 20, 43, ''),
    prod('MLB3333333333', 'LUM-LED-01', 'Luminária LED de mesa articulada', 'MÉDIO', 9, 2, 0, 6, 'Envie mais unidades'),
    prod('MLB5555555555', 'MOUSE-ERG', 'Mouse sem fio ergonômico', 'PEQUENO', 25, 41, 0, 49, ''),
    prod('MLB6666666666', 'CAPA-SIL', 'Capinha de silicone para celular', 'PEQUENO', 12, 0, 0, null, 'Envie mais unidades', { status: 'Pausada' }),
    prod('MLB8888888888', 'CAD-GMR-01', 'Cadeira gamer reclinável', 'GRANDE', 3, 1, 0, 10, ''),
  ];
  const pont = (total, cards, dica) => ({ total, max: 100, titulo: 'Pontuação e métricas de 24 de setembro', cards, dica: dica || '' });
  const F = {
    sem: { temFull: false, vazio: 'Faça seu primeiro envio para o Full', espaco: [], mesesEspaco: [], pontuacao: { cards: [] }, produtos: [], avisos: [] },
    fiscal: { temFull: true, vazio: '', espaco: [esp('totable', 'Pequenos e médios', 0, 100, 0, 0), esp('non_totable', 'Grandes e extragrandes', 0, 100, 0, 0)],
      mesesEspaco: [mes('Setembro', 'ATRIBUÍDO', 'Segundo a pontuação do dia 15/agosto: -2 pontos', 100, 100), mes('Outubro', 'ATRIBUÍDO', 'Segundo a pontuação do dia 15/setembro: -2 pontos', 100, 100)],
      pontuacao: pont(40, [card('Tempo de estoque', 30, 30), card('Fora de venda', 10, 10), card('Vendas por estoque armazenado', 0, 40, 'Mede quanto você vende pelos m³ que seus produtos ocupam.'), card('Rotatividade de estoque', 0, 20, 'Mede as unidades vendidas sobre o estoque médio.')], 'Melhore sua pontuação antes de 15/out.'),
      produtos: [prod('MLB9999999999', '523', 'Fogão de mesa elétrico inox 220v', 'MÉDIO', 0, 0, 0, null, 'Resolva o problema fiscal da conta.', { status: 'Pausada' })],
      avisos: ['Resolva o problema fiscal da conta.'] },
    produtos: { temFull: true, vazio: '', espaco: [esp('totable', 'Pequenos e médios', 160, 250, 140, 20), esp('non_totable', 'Grandes e extragrandes', 4, 20, 4, 0)],
      mesesEspaco: [mes('Setembro', 'ATRIBUÍDO', 'Segundo a pontuação do dia 15/agosto: 72 pontos', 250, 20), mes('Outubro', 'ESTIMADO', 'Segundo a pontuação do dia 15/setembro: 72 pontos', 250, 20)],
      pontuacao: pont(72, [card('Tempo de estoque', 30, 30), card('Fora de venda', 10, 10), card('Vendas por estoque armazenado', 22, 40), card('Rotatividade de estoque', 10, 20)]),
      produtos, avisos: [] },
  };
  // Casos difíceis: 2 variações do mesmo anúncio (o vm|ml é do anúncio inteiro), SKU sem anúncio na lista,
  // coluna "aptas" que não veio (outro nome em outra conta) e tamanho que não casa com nenhum segmento.
  const vari = (cor, v30) => prod('MLB1111111111', 'FONE-ANC-PRETO', 'Fone Bluetooth com cancelamento de ruído', 'MÉDIO', v30, 1, 0, 5, '', { variacao: 'Cor: ' + cor });
  F.casos = Object.assign({}, F.produtos, { produtos: [vari('Azul', 9), vari('Preto', 9),
    prod('MLB0000000001', 'NAOEXISTE', 'Produto que saiu da lista', 'PEQUENO', 10, 0, 0, null, '', { itemIds: [], itemId: '' }),
    prod('MLB3333333333', 'LUM-LED-01', 'Luminária LED de mesa articulada', 'MÉDIO', 9, null, null, null, ''),
    prod('MLB2222222222', 'GT-500-INOX', 'Garrafa térmica inox 500 ml', 'GIGANTE', 400, 0, 0, 1, '')] });
  // Saúde do estoque: um produto em cada classe + mínimo por SKU (Mouse: 60 dias → crítico pelo mínimo; no padrão de 15, saudável).
  F.classes = Object.assign({}, F.produtos, { produtos: [
    prod('MLB3333333333', 'LUM-LED-01', 'Luminária LED de mesa articulada', 'MÉDIO', 9, 2, 0, 6, 'Envie mais unidades'),            // crítico (6 dias)
    prod('MLB0000000011', 'TAP-01', 'Tapete de yoga antiderrapante', 'MÉDIO', 30, 12, 10, 12, ''),                                // atenção (12 dias; 22 ≥ mínimo 15)
    prod('MLB2222222222', 'GT-500-INOX', 'Garrafa térmica inox 500 ml', 'PEQUENO', 40, 58, 20, 43, ''),                          // saudável
    prod('MLB0000000012', 'LAMP-XL', 'Luminária de chão grande', 'GRANDE', 3, 120, 0, 1200, ''),                                   // excedente (1200 dias)
    prod('MLB0000000013', 'BOLSA-01', 'Bolsa térmica 10 L', 'PEQUENO', 0, 15, 0, null, ''),                                        // parado
    prod('MLB6666666666', 'CAPA-SIL', 'Capinha de silicone para celular', 'PEQUENO', 12, 0, 0, null, 'Envie mais unidades'),        // sem estoque (alerta)
    prod('MLB5555555555', 'MOUSE-ERG', 'Mouse sem fio ergonômico', 'PEQUENO', 25, 41, 0, 49, ''),                                  // mínimo do SKU 60 dias
  ] });
  if (tipo === 'classes') mem['c|sku|MOUSE-ERG'] = { fullMinUn: 50 };   // mínimo em unidades (v2.4)
  F.estranho = { temFull: false, vazio: '', espaco: [], mesesEspaco: [], pontuacao: { cards: [] }, produtos: [], avisos: [] };
  F.erro = F.produtos;
  if (tipo === 'erro') mem['shc:status'] = Object.assign({}, mem['shc:status'], { erroFull: 'ml_indisponivel' });
  F.antigo = Object.assign({}, F.produtos, { custosEstoqueAntigo: { textos: ['Custos por estoque antigo', '2 produtos com tempo de estoque (exemplo fictício).'] },
    produtos: produtos.map(p => p.sku === 'GT-500-INOX' ? Object.assign({}, p, { tempoEstoque: 30, acaoSugerida: 'Faça uma promoção', avisos: ['Faça uma promoção'] }) : p) });
  if (F[tipo]) mem['ml:full:' + SELLER] = Object.assign({ ts: Date.now() - (tipo === 'erro' ? 26 : 0) * 3600000 - 10 * 60000 }, F[tipo]);
})();

// ?seed=loja → "Loja Exemplo": conta inteira, 100% fictícia e coerente, para as capturas da Chrome Web Store (v2.4).
// Tudo sai da tabela PROD: retrato de Anúncios, custos por SKU, vendas por mês (vm|ml), Faturamento por mês (fech:),
// vendas brutas por dia (vb:), faturas (fat:), Mercado Ads (ads:), Central de promoções (ml:promos:) e Full (ml:full:).
// Datas relativas a hoje (12 meses fechados + o atual). &aba=full abre o painel lateral na aba Full.
(function () {
  const q = new URLSearchParams(location.search);
  if (q.get('seed') !== 'loja') return;
  const mem = window.__mem, agora = Date.now(), CONTA = '100200300';
  const r2 = v => Math.round((v + (v >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;
  const pad = n => String(n).padStart(2, '0');
  const H = new Date(), hoje = H.getFullYear() + '-' + pad(H.getMonth() + 1) + '-' + pad(H.getDate());
  const mesMenos = k => { const d = new Date(H.getFullYear(), H.getMonth() - k, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
  const MESES = []; for (let k = 12; k >= 0; k--) MESES.push(mesMenos(k));
  const ATUAL = MESES[12], DIA = H.getDate();
  const diasNoMes = m => new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate();
  const diaMais = n => { const d = new Date(H.getFullYear(), H.getMonth(), H.getDate() + n); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const NOME_MES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const curta = d => +d.slice(8, 10) + '/' + MES_CURTO[+d.slice(5, 7) - 1];
  const foto = (txt, cor) => 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="18" fill="' + cor + '"/><text x="48" y="60" font-family="Segoe UI,Arial" font-size="34" font-weight="700" fill="#fff" text-anchor="middle">' + txt + '</text></svg>');

  // Tarifa do ML = % do tipo (Clássico 12%, Premium 16,5%) + taxa fixa abaixo de R$ 79 (como calc.js). Abaixo de R$ 79 o frete é do comprador.
  const taxaFixa = p => p >= 79 ? 0 : (p < 19 ? 6 : (p < 49 ? 7.5 : 9.5));
  const tarifaDe = (preco, tipo) => r2(preco * (tipo === 'Premium' ? 0.165 : 0.12) + taxaFixa(preco));
  // [MLB, SKU, título, tipo, preço, frete por sua conta, custo, vendas/mês (base), estoque, cor, sigla]
  const PROD = [
    ['MLB4000000101', 'BIKE-ARO20', 'Bicicleta Aro 20 infantil com rodinhas', 'Premium', 699.9, 62.9, 380, 14, 'Full: 30 u.', '#2563EB', 'BK'],
    ['MLB4000000102', 'PANELA-KIT5', 'Kit panelas antiaderentes 5 peças', 'Premium', 289.9, 34.9, 125, 22, '64 disponíveis', '#DC2626', 'KP'],
    ['MLB4000000103', 'FONE-BT-01', 'Fone Bluetooth sem fio com estojo', 'Clássico', 129.9, 21.45, 58, 48, 'Full: 9 u.', '#0F172A', 'FB'],
    ['MLB4000000104', 'GARRAFA-1L', 'Garrafa térmica inox 1 litro', 'Clássico', 89.9, 19.95, 46, 35, 'Full: 16 u.', '#059669', 'GT'],
    ['MLB4000000105', 'TAPETE-YOGA', 'Tapete de yoga antiderrapante 6 mm', 'Clássico', 99.9, 21.45, 42, 26, 'Full: 300 u.', '#7C3AED', 'TY'],
    ['MLB4000000106', 'MOCHILA-NB', 'Mochila para notebook 15,6"', 'Premium', 159.9, 23.95, 78, 18, 'Full: 0 u.', '#334155', 'MN'],
    ['MLB4000000107', 'CAIXA-SOM', 'Caixa de som portátil resistente à água', 'Premium', 149.9, 23.95, 98, 12, '21 disponíveis', '#EA580C', 'CS'],
    ['MLB4000000108', 'LUMI-LED', 'Luminária LED de mesa articulada', 'Clássico', 79.9, 19.95, 36, 20, '48 disponíveis', '#D97706', 'LL'],
    ['MLB4000000109', 'PANO-MICRO5', 'Kit panos de microfibra (5 unidades)', 'Clássico', 39.9, 0, 19, 40, 'Full: 70 u.', '#0891B2', 'PM'],
    ['MLB4000000110', 'SUP-CEL', 'Suporte de celular para mesa', 'Clássico', 34.9, 0, 11, 0, 'Full: 25 u.', '#64748B', 'SC'],
    ['MLB4000000111', 'ORGANIZ-6', 'Organizador de gavetas (6 peças)', 'Clássico', 49.9, 0, null, 0, '120 disponíveis', '#DB2777', 'OG'],
  ].map(([itemId, sku, titulo, tipo, preco, frete, custo, base, estoque, cor, sigla], i) => {
    const tarifa = tarifaDe(preco, tipo);
    return { itemId, sku, titulo, tipo, preco, frete, custo, base, estoque, cor, sigla, tarifa, recebe: r2(preco - tarifa - frete), familia: 'MLBU' + (7000 + i) };
  });
  // &etq=1 (só as fotos das etiquetas no ML): um 2º anúncio do fone (mesmo SKU) com a caixa maior, para a etiqueta "Medida ≠ #…".
  if (q.get('etq')) PROD.push(Object.assign({}, PROD[2], { itemId: 'MLB4000000112', titulo: PROD[2].titulo + ' (Premium)', tipo: 'Premium', familia: 'MLBU7011', base: 6, estoque: '14 disponíveis' }));
  const porSku = {}; PROD.forEach(p => { if (!porSku[p.sku]) porSku[p.sku] = p; });
  window.__lojaProdutos = PROD;   // a tela do ML de exemplo (loja_ml.html) desenha as fotos e as colunas a partir daqui

  // O nome que o topo/Ajustes mostram vem SÓ de cfg.apelidos (v2.7 — o apelido dentro de
  // 'ml:contas' abaixo é ignorado pelo código real; sem isto aqui as capturas mostravam
  // "Conta sem nome ainda" + ID, não o nome fictício da loja).
  mem.cfg = { consentimento_ml: { versao: '3.3.1', em: '2026-10-09T00:00:00.000Z' }, imposto_pct: 6, margem_alvo_pct: 10, ml_comissao_classico: 12, ml_comissao_premium: 16.5, ml_tipo_padrao: 'classico', ml_frete_padrao: 0, sp_comissao_pct: 20, sp_taxa_fixa: 0, configurado: true, apelidos: { [CONTA]: 'Loja Exemplo' } };
  // v2.9: robô de promoções ligado (margem mínima = a meta de 10%); ?robo=off = desligado, ?robo=12 = margem mínima de 12%.
  if (q.get('robo') !== 'off') mem.cfg.robopromo = q.get('robo') ? { ligado: true, margem_pct: +q.get('robo') } : { ligado: true };
  mem['ml:contas'] = { [CONTA]: { apelido: 'LOJA EXEMPLO', visto: agora } };
  mem['ml:conta'] = CONTA;
  mem['shc:status'] = { estado: 'ok', ultimaOk: agora - 4 * 60000, fim: agora - 4 * 60000, inicio: agora - 6 * 60000 };
  // ?sync=falhou: a sincronização de agora caiu na 1ª etapa (sessão do ML caída), com a leitura boa de ontem guardada.
  // ?sync=nunca: a 1ª leitura da conta falhou (nunca leu nada). Fictício, só para os prints dos consertos.
  const ETAPAS_IDS = ['anuncios', 'vendasBrutas', 'faturamento', 'full', 'ads', 'posvenda', 'vendasAnuncio', 'promos', 'afiliados', 'saude', 'faturas', 'repasse', 'alertas'];   // v2.11: a ordem de SHC.SYNC_ETAPAS
  const etapasFalhou = ant => ETAPAS_IDS.reduce((o, id, i) => { o[id] = i ? { estado: 'pulado', naoLida: true, resumo: 'Não lida: os anúncios não foram lidos', resumoAnterior: ant ? 'lido' : null, fim: agora - 60000 }
    : { estado: 'erro', erro: 'Entre no Mercado Livre neste Chrome e sincronize de novo.', resumoAnterior: ant ? '8 anúncios' : null, fim: agora - 60000 }; return o; }, {});
  if (q.get('sync') === 'falhou') { window.__semSync = true; mem['shc:status'] = { estado: 'erro', erro: 'sem_sessao', ultimaOk: agora - 20 * 3600e3, primeiraCompleta: agora - 30 * 864e5, inicio: agora - 90000, fim: agora - 60000, etapas: etapasFalhou(true) }; }
  if (q.get('sync') === 'nunca') { window.__semSync = true; mem['shc:status'] = { estado: 'erro', erro: 'sem_sessao', inicio: agora - 90000, fim: agora - 60000, etapas: etapasFalhou(false) }; }
  // ?sync=ok: a sincronização de 4 min atrás terminou com as 13 etapas lidas (o status que a extensão grava de verdade).
  if (q.get('sync') === 'ok') mem['shc:status'] = Object.assign(mem['shc:status'], { primeiraCompleta: agora - 30 * 864e5, etapas: ETAPAS_IDS.reduce((o, id) => { o[id] = { estado: 'ok', resumo: 'lido', fim: agora - 4 * 60000 }; return o; }, {}) });
  window.__proxSync = agora + 176 * 60000;   // alarme de 3 h: a próxima leitura sozinha
  // ?sync=lendo: sincronização em andamento (já leu antes): 2 etapas lidas, o Faturamento no 2º de 2 meses (v2.11: só o atual e o anterior), o resto na fila.
  if (q.get('sync') === 'lendo') {
    window.__semSync = true;
    const d6 = new Date(agora); d6.setDate(1); d6.setMonth(d6.getMonth() - 1);
    const mes6 = d6.getFullYear() + '-' + String(d6.getMonth() + 1).padStart(2, '0');
    mem['shc:status'] = { estado: 'sincronizando', sincronizando: true, ultimaOk: agora - 3 * 3600e3, primeiraCompleta: agora - 30 * 864e5, inicio: agora - 150000, batimento: agora,
      etapas: ETAPAS_IDS.reduce((o, id, i) => { o[id] = i < 2 ? { estado: 'ok', resumo: 'lido', fim: agora - 60000 } : i === 2 ? { estado: 'lendo', feito: 1, de: 2, unidade: 'meses', mesAgora: mes6, cobrancas: 6722 } : { estado: 'fila' }; return o; }, {}),
      progresso: { etapa: 'faturamento', indice: 3, total: 13, pct: 20, restanteSeg: 260, feito: 1, de: 2, unidade: 'meses' } };
  }
  // v2.10 ?sync=retomando: o worker caiu no meio da NF-e (Faturas do ML) e voltou. As 5 etapas lidas antes da queda ficam ✓ com a hora;
  // a barra continua na etapa 6 ("Continuando de onde parou"). ?sync=interrompida: o instante entre cair e continuar.
  if (q.get('sync') === 'retomando' || q.get('sync') === 'interrompida') {
    window.__semSync = true;
    const tq = agora - 12 * 60000, RES = ['8 anúncios', '13 meses · 391 dias', '2 meses · 2.114 cobranças', '1 produto no Full', '2 campanhas · 5 anúncios', '1 devolução em aberto', '2 meses · 6 anúncios com venda no mês', '3 propostas em 2 produtos', '2 produtos com afiliados', '2 anúncios sem dados fiscais'];
    const etp = ETAPAS_IDS.reduce((o, id, i) => { o[id] = i < 10 ? { estado: 'ok', resumo: RES[i], inicio: tq - (10 - i) * 60000, fim: tq - (9 - i) * 60000, jaLida: true }
      : i === 10 ? { estado: 'lendo', feito: 20, de: 45, unidade: 'notas' } : { estado: 'fila' }; return o; }, {});
    mem['shc:status'] = { estado: 'sincronizando', sincronizando: true, origem: 'retomada', ultimaOk: agora - 3 * 3600e3, primeiraCompleta: agora - 30 * 864e5, inicio: agora - 20000, batimento: agora,
      etapas: etp, progresso: { etapa: 'faturas', indice: 11, total: 13, pct: 80, restanteSeg: 190, feito: 20, de: 45, unidade: 'notas', continua: { feitas: 10, desde: tq - 11 * 60000 } } };
    if (q.get('sync') === 'interrompida') {
      etp.faturas = { estado: 'erro', erro: 'A leitura parou no meio (a extensão foi recarregada ou o Chrome fechou). Continuo de onde parou.', fim: agora - 2000 };
      ETAPAS_IDS.slice(11).forEach(id => { etp[id] = { estado: 'pulado', naoLida: true, resumo: 'Não lida: a leitura parou no meio', fim: agora - 2000 }; });
      mem['shc:status'] = { estado: 'interrompida', sincronizando: false, ultimaOk: agora - 3 * 3600e3, primeiraCompleta: agora - 30 * 864e5, inicio: agora - 20 * 60000, fim: agora - 2000,
        interrompidaEm: agora - 2000, retomaEm: agora - 2000, etapas: etp, progresso: null };
    }
  }
  // v2.11 ?hist=lendo: os meses antigos sendo lidos em segundo plano (7 de 12); ?hist=falta: parado com 7 de 12 lidos (o resto na próxima).
  if (q.get('hist')) mem['shc:status'].historico = { feitos: 7, de: 12, falta: 6, lendo: q.get('hist') === 'lendo', ts: agora };
  mem['shc:guia'] = { passo: 5, fim: agora, feitos: { icone: hoje, promos: hoje, listaOculta: true, custos: hoje, lucro: hoje, fechamento: hoje, ads: hoje, full: hoje }, tours: { anuncios: true, promos: true } };   // guia concluído: as capturas não mostram o cartão
  window.__iconeFixado = true;
  // v3.1 topo: &alertas=1 → anomalias do fundo (fictícias) para os prints dos contadores das abas e do sino.
  if (q.get('alertas')) mem['shc:anomalias'] = { ts: agora, conta: CONTA, total: 5, vermelho: true, porTipo: { ads: 2, frete: 1, posvenda: 2 }, itens: [
    { tipo: 'ads', aba: 'ads', texto: 'Caixa de som: o Ads gasta mais do que o lucro.', chave: 'anom|ads|MLB4000000107' },
    { tipo: 'ads', aba: 'ads', texto: 'Luminária: o Ads gasta mais do que o lucro.', chave: 'anom|ads|MLB4000000108' },
    { tipo: 'frete', aba: 'frete', texto: 'Bicicleta: o frete subiu.', chave: 'anom|frete|MLB4000000101' },
    { tipo: 'posvenda', aba: 'posvenda', texto: '2 reclamações ou mediações em aberto no pós-venda.', chave: 'anom|pv|reclamacoes', qtd: 2, vermelho: true }] };

  // Retrato da lista de Anúncios (formato de SHC.mlAnunciosDoEstado) + custos por SKU (o Organizador ficou sem custo de propósito).
  mem['ml:anuncios:' + CONTA] = { ts: agora - 4 * 60000, paginas: 1, total: PROD.length, itens: PROD.map(p => ({
    itemId: p.itemId, familia: p.familia, sku: p.sku, titulo: p.titulo, status: 'active', tipo: p.tipo, preco: p.preco, precoCheio: null, emPromocao: false,
    tarifa: p.tarifa, frete: p.frete, freteDeduzido: false, recebe: p.recebe, freteComprador: p.frete === 0, taxaOperacional: null, atacado: false,
    estoque: p.estoque, dentroDeFamilia: false, catalogoML: false, catalogo: '', sincronizado: false, competicao: '', competicaoTexto: '', flexBonus: null })) };
  PROD.forEach(p => { if (p.custo) mem['c|sku|' + p.sku] = { custo: p.custo, titulo: p.titulo, origem: 'manual', atualizado: agora - 20 * 864e5 }; });
  // Visitas por dia (visitas:<conta>), 14 dias: bicicleta, caixa de som e luminária caindo; fone e tapete subindo; o resto estável; suporte e organizador com poucas visitas.
  const TEND = { 'BIKE-ARO20': [50, 30], 'CAIXA-SOM': [40, 28], 'LUMI-LED': [40, 30], 'FONE-BT-01': [60, 80], 'TAPETE-YOGA': [30, 40], 'SUP-CEL': [1, 1], 'ORGANIZ-6': [2, 1] };
  const visPor = {}; PROD.forEach(p => { const [ant, ult] = TEND[p.sku] || [35, 36], dias = {}; for (let d = -14; d < 0; d++) dias[diaMais(d)] = d < -7 ? ant : ult; visPor[p.itemId] = { dias }; });
  mem['visitas:' + CONTA] = { ts: agora - 4 * 60000, porItem: visPor };
  // v3.1 catálogo (fictício): o fone perde para uma loja no Full (dá para ganhar baixando o preço, ainda com lucro); o tapete perde para quem
  // parcela sem juros (baixar dá prejuízo); a garrafa ganha. comp:<conta> = a linha do tempo (1 registro por mudança) desde 5 meses atrás.
  // Só com &aba=catalogo ou &cat=1 (os outros prints e testes da loja continuam sem catálogo).
  if (q.get('aba') === 'catalogo' || q.get('cat')) {
  const itA = mem['ml:anuncios:' + CONTA].itens, itDe = sku => itA.find(i => i.sku === sku);
  Object.assign(itDe('FONE-BT-01'), { catalogo: 'MLB19001', competicao: 'perdendo', competicaoMotivo: 'preco' });
  Object.assign(itDe('TAPETE-YOGA'), { catalogo: 'MLB19002', competicao: 'perdendo', competicaoMotivo: 'outro' });
  Object.assign(itDe('GARRAFA-1L'), { catalogo: 'MLB19003', competicao: 'ganhando' });
  const oferta = (loja, preco, parc, log) => ({ itemId: '', loja, unidades: '', preco, parcelamento: parc, frete: 'Frete grátis', logistica: log, melhor: true });
  const histW = ws => ws.map((w, k) => ({ d: diaMais(k - ws.length + 1), e: 'perdendo', w, g: null, vp: null }));
  mem['catcomp:' + CONTA] = { ts: agora - 3600e3, porItem: {
    [itDe('FONE-BT-01').itemId]: { itemId: itDe('FONE-BT-01').itemId, catalogo: 'MLB19001', estado: 'perdendo', tipo: 'losing_with_levers', winRate: 18, precoGanhar: 119.9,
      voce: Object.assign(oferta('Seu anúncio', 129.9, 'Clássico', 'Por agências'), { melhor: false }), vencedor: oferta('Loja Som Mais', 124.9, 'Clássico', 'Full'), souVencedor: false, concorrentes: 4,
      visitas: { voce: 22, concorrentes: 98, total: 120, delta: '3.0 pontos', tendencia: 'down', dias: [] }, mensagem: 'Baixe o preço do seu anúncio e seja a primeira opção de compra',
      ts: agora - 3600e3, hist: histW([31, 27, 25, 22, 20, 19, 18]) },
    [itDe('TAPETE-YOGA').itemId]: { itemId: itDe('TAPETE-YOGA').itemId, catalogo: 'MLB19002', estado: 'perdendo', tipo: 'losing_with_levers', winRate: 9, precoGanhar: 69.9,
      voce: Object.assign(oferta('Seu anúncio', 99.9, 'Clássico', 'Por agências'), { melhor: false }), vencedor: oferta('Yoga Center', 104.9, 'Premium', 'Com coleta'), souVencedor: false, concorrentes: 6,
      visitas: { voce: 6, concorrentes: 61, total: 67, delta: '1.0 pontos', tendencia: 'down', dias: [] }, mensagem: '', ts: agora - 3600e3, hist: histW([14, 12, 9]) },
  } };
  const mesD = (k, dia) => mesMenos(k) + '-' + pad(dia);
  mem['comp:' + CONTA] = {
    [itDe('FONE-BT-01').itemId]: [{ d: mesD(5, 3), e: 'ganhando', m: '', p: 129.9 }, { d: mesD(4, 20), e: 'perdendo', m: 'preco', p: 129.9 }, { d: mesD(3, 2), e: 'ganhando', m: '', p: 124.9 },
      { d: mesD(1, 12), e: 'perdendo', m: 'preco', p: 129.9 }],
    [itDe('TAPETE-YOGA').itemId]: [{ d: mesD(2, 10), e: 'ganhando', m: '', p: 99.9 }, { d: mesD(0, 1), e: 'perdendo', m: 'outro', p: 99.9 }],
    [itDe('GARRAFA-1L').itemId]: [{ d: mesD(3, 1), e: 'ganhando', m: '', p: 89.9 }],
  };
  }
  // &etq=1: fotos, dados fiscais e medidas lidos (etiquetas de saúde na lista de Anúncios). Tudo fictício.
  if (q.get('etq')) {
    mem['fotos:' + CONTA] = { ts: agora - 4 * 60000, porItem: { MLB4000000101: { qtd: 11, max: 12, problemas: 0, ids: [] }, MLB4000000102: { qtd: 12, max: 12, problemas: 0, ids: [] },
      MLB4000000103: { qtd: 7, max: 12, problemas: 2, ids: [] }, MLB4000000107: { qtd: 4, max: 12, problemas: 0, ids: [] } } };
    mem['fiscal:' + CONTA] = { ts: agora - 4 * 60000, total: 1, itens: ['MLB4000000104'], familias: [], completo: true };
    const med = (id, alt, kg) => ({ sku: 'FONE-BT-01', atual: { ordenadas: [8, alt, 20], pesoKg: kg, fonte: 'tela', secao: 'envio', de: agora - 20 * 864e5, ts: agora - 864e5 }, historico: [] });
    mem['medidas:' + CONTA] = { ts: agora - 4 * 60000, porItem: { MLB4000000103: med('MLB4000000103', 12, 0.4), MLB4000000112: med('MLB4000000112', 30, 1.9) } };
  }
  // Frete do fone subiu R$ 1,50 há 17 dias (fh|ml: 1 registro por dia).
  const fh = {}; for (let d = -60; d < 0; d++) fh[diaMais(d)] = d < -17 ? 19.95 : 21.45;
  mem['fh|ml|MLB4000000103'] = fh;

  // Vendas por mês (vm|ml) = base × sazonalidade (Black Friday e Natal mais fortes); mês atual proporcional aos dias.
  const SAZ = { 1: 0.8, 2: 0.8, 3: 0.9, 4: 0.95, 5: 1, 6: 0.95, 7: 0.94, 8: 1, 9: 1, 10: 0.92, 11: 1.3, 12: 1.4 };
  const un = (p, m) => { const b = p.sku === 'SUP-CEL' ? (m < MESES[9] ? 6 : 0) : p.base; return Math.round(b * SAZ[+m.slice(5, 7)] * (m === ATUAL ? DIA / diasNoMes(m) : 1)); };
  PROD.forEach(p => { const o = {}; MESES.forEach(m => { const n = un(p, m); if (n) o[m] = n; }); if (Object.keys(o).length) mem['vm|ml|' + p.itemId] = o; });
  // v3.1: vendas por anúncio mês a mês (vbAnuncio:) e a família de cada anúncio (cat:) para o "Faturamento por família" — as mesmas vendas
  // (vm|ml × preço). A mochila (Full zerado) vende 60% menos no mês atual: é o SKU que mostra o "Por que caiu?" com o gargalo.
  // ?fam=nada: sem vendas por anúncio lidas; ?fam=atual: o mês atual ainda não lido (o ML não respondeu) — o cartão mostra o mês passado.
  if (q.get('fam') !== 'nada') {
    const FAM = { 'BIKE-ARO20': 'Esportes e Fitness', 'TAPETE-YOGA': 'Esportes e Fitness', 'PANELA-KIT5': 'Casa, Móveis e Decoração', 'GARRAFA-1L': 'Casa, Móveis e Decoração',
      'PANO-MICRO5': 'Casa, Móveis e Decoração', 'ORGANIZ-6': 'Casa, Móveis e Decoração', 'LUMI-LED': 'Casa, Móveis e Decoração', 'FONE-BT-01': 'Eletrônicos, Áudio e Vídeo',
      'CAIXA-SOM': 'Eletrônicos, Áudio e Vídeo', 'SUP-CEL': 'Celulares e Telefones', 'MOCHILA-NB': 'Bolsas e Mochilas' };
    const va = { ts: agora - 4 * 60000, meses: {}, itens: {}, mesesLidos: [], naoLidos: [] };
    MESES.forEach(m => {
      if (q.get('fam') === 'atual' && m === ATUAL) return;
      if (q.get('ano') === 'nao' && m === MESES[0]) return;   // &ano=nao (print da dona 29/09): 12 meses lidos, sem o mesmo mês do ano passado
      const pa = {};
      // &fam=queda (prints do cartão visual, 29/09): no mês atual a caixa de som não vende e o fone vende metade — mais SKUs caindo, com causas diferentes.
      const QUEDA = q.get('fam') === 'queda' && m === ATUAL ? { 'CAIXA-SOM': 0, 'FONE-BT-01': 0.5 } : {};
      PROD.forEach(p => { let n = un(p, m); if (p.sku === 'MOCHILA-NB' && m === ATUAL) n = Math.round(n * 0.4); if (p.sku in QUEDA) n = Math.round(n * QUEDA[p.sku]); if (n) pa[p.itemId] = { bruto: r2(n * p.preco), unidades: n, vendas: n, visitas: n * 25, sku: p.sku }; });
      va.meses[m] = m === ATUAL ? { porAnuncio: pa, paginas: 1, linhas: Object.keys(pa).length, completo: true, lidoEm: hoje, lidoTs: agora - 4 * 60000 }
        : { porAnuncio: pa, paginas: 1, linhas: Object.keys(pa).length, completo: true, lidoEm: (m.slice(5) === '12' ? (+m.slice(0, 4) + 1) + '-01' : m.slice(0, 5) + pad(+m.slice(5) + 1)) + '-02' };
      va.mesesLidos.push(m);
    });
    PROD.forEach(p => { va.itens[p.itemId] = { sku: p.sku, titulo: p.titulo }; });
    mem['vbAnuncio:' + CONTA] = va;
    mem['cat:' + CONTA] = { ts: agora - 4 * 60000, porItem: PROD.reduce((o, p) => { o[p.itemId] = { familia: FAM[p.sku], sub: '', categoriaId: '', ts: agora }; return o; }, {}) };
    if (q.get('fam') === 'atual') mem['shc:status'].etapas = Object.assign({}, mem['shc:status'].etapas, { vendasAnuncio: { estado: 'ok', meses: { [ATUAL]: 'tempo' } } });
  }
  mem['ml:cobrancas:' + CONTA] = { completo12: true, ate: hoje, ts: agora - 4 * 60000, incompletos: [], mesesLidos: MESES.slice() };

  // Faturamento por mês (fech:) e vendas brutas por dia (vb:) a partir das mesmas vendas. Por mês: 2 kits de panela cancelados
  // e 1 fone devolvido (as tarifas voltam como estorno). Ads do Faturamento: subiu no mês passado.
  // Indexado por k = meses atrás (0 = mês atual), não pelo mês do calendário: o pico em k=1 (mês passado) precisa
  // valer sempre, não só quando o teste roda em setembro (achado 17/24 da auditoria).
  const K_MES = {}; MESES.forEach((m, i) => { K_MES[m] = 12 - i; });
  const ADS_MES_REL = [1400, 1482.6, 980.4, 950, 930, 900, 860, 790, 820, 1050, 1620, 1710, 1300];
  const FULL_MES_REL = [96.4, 88.2, 52.6, 48, 44, 0, 0, 0, 0, 0, 0, 0, 0];   // armazenagem no Full: começou há 4 meses e subiu no mês passado
  const KP = porSku['PANELA-KIT5'], FB = porSku['FONE-BT-01'];
  const dias = {}, fat = [];
  MESES.forEach(m => {
    const atual = m === ATUAL, fator = atual ? DIA / diasNoMes(m) : 1;
    let vendido = 0, tarifa = 0, frete = 0, qtd = 0;
    PROD.forEach(p => { const n = un(p, m); vendido += n * p.preco; tarifa += n * p.tarifa; frete += n * p.frete; qtd += n; });
    const cancelado = atual ? KP.preco : 2 * KP.preco, devolvido = atual ? 0 : FB.preco;
    const estornos = -r2(atual ? KP.tarifa : 2 * KP.tarifa + FB.tarifa);
    const porTipo = { tarifa_venda: r2(tarifa), cobranca_mp: 0, parcelamento: r2(vendido * 0.009), recebimento: 0, frete: r2(frete),
      ads: r2(ADS_MES_REL[K_MES[m]] * fator), ads_seguidores: 0, minha_pagina: r2(29.9 * fator),   // v3.1: a Minha página separada de "outro"
      full: r2(FULL_MES_REL[K_MES[m]] * fator), devolucao: atual ? 0 : 11.64, impostos_ml: 0, outro: 0 };   // Full = armazenagem + estoque antigo
    const total = r2(Object.keys(porTipo).reduce((s, k) => s + porTipo[k], 0));
    mem['fech:' + CONTA + ':' + m] = { mes: m, porTipo, estornos, total, qtdVendas: qtd, pedidos: {}, parcial: false, ate: atual ? hoje : m + '-' + pad(diasNoMes(m)), tipos: 2 };
    // Vendas brutas por dia: somam exatamente o mês, com mais movimento no começo da semana.
    const n = atual ? DIA : diasNoMes(m), bruto = r2(vendido + cancelado + devolvido);
    const pesos = []; for (let d = 1; d <= n; d++) pesos.push(1 + 0.3 * Math.cos((new Date(+m.slice(0, 4), +m.slice(5, 7) - 1, d).getDay() - 1) * 0.9));
    const soma = pesos.reduce((a, b) => a + b, 0);
    let resto = bruto, restoUn = qtd;
    pesos.forEach((w, i) => {
      const ult = i === n - 1, v = ult ? r2(resto) : r2(bruto * w / soma), u = ult ? Math.max(0, restoUn) : Math.round(qtd * w / soma);
      resto = r2(resto - v); restoUn -= u;
      dias[m + '-' + pad(i + 1)] = { bruto: v, unidades: u, vendas: u, cancelado: i === Math.min(3, n - 1) ? cancelado : 0, devolvido: i === Math.min(9, n - 1) ? devolvido : 0 };
    });
    if (!atual) fat.push({ mes: m, nome: NOME_MES[+m.slice(5, 7) - 1], fechamento: m + '-20', vencimento: MESES[MESES.indexOf(m) + 1] + '-05',
      total: r2(total), divida: 0, pago: r2(total), status: 'Paga', aberta: false });
  });
  mem['vb:' + CONTA] = { ts: agora - 4 * 60000, dias, porAnuncio: [], periodoLido: { de: MESES[0] + '-01', ate: hoje } };
  mem['fat:' + CONTA] = { ts: agora - 4 * 60000, faturas: fat.reverse(), aberta: null };
  // v3.1: resumo por categoria/tipo das 3 últimas faturas (formato de SHC.mlFaturaCategorias): na mais recente aparecem o estoque antigo
  // no Full e a devolução (custos novos) e o Ads sobe 80% (custo que subiu) → cartão "Custo novo na fatura".
  {
    const base = (ads, novos) => [
      { nome: 'Tarifas de envios no Mercado Livre', tipos: [{ nome: 'Tarifa de envio extra ou intermunicipal', valor: 3120.4 }].concat(novos ? [{ nome: 'Tarifa de devolução', valor: 23.4 }] : []) },
      { nome: 'Tarifas de venda', tipos: [{ nome: 'Custo por vender no Mercado Livre', valor: 4380.15 }, { nome: 'Taxa de parcelamento', valor: 310.2 }] },
      { nome: 'Tarifas por campanha de publicidade', tipos: [{ nome: 'Tarifa por campanha de publicidade de Product Ads', valor: ads }] },
      { nome: 'Tarifas de envios Full', tipos: [{ nome: 'Tarifa pelo serviço de armazenamento Full', valor: 96.5 }].concat(novos ? [{ nome: 'Tarifa por estoque antigo no Full', valor: 84 }] : []) },
    ].map(c => Object.assign(c, { valor: r2(c.tipos.reduce((s, t) => s + t.valor, 0)) }));
    const categorias = {};
    fat.slice(0, 3).reverse().forEach((f, i) => {
      const cs = base(i === 2 ? 1620 : 900, i === 2);
      categorias[f.mes] = { nome: f.nome, fechamento: f.fechamento, aberta: false, link: 'https://vendedores.mercadolivre.com.br/billing/detail/' + f.fechamento.replace(/-/g, '') + '?fromSummary=true',
        lidoEm: agora - 4 * 60000, total: r2(cs.reduce((s, c) => s + c.valor, 0)), categorias: cs };
    });
    mem['fat:' + CONTA].categorias = categorias;
  }

  // Mercado Ads, últimos 30 dias (formato do fundo: SHC.adsCampanhas/adsAnuncios/adsShare/adsResumo).
  // [SKU, investimento, vendas pelo Ads, impressões, cliques, campanha]. Garrafa e caixa de som: Ads acima do equilíbrio.
  const ADS = [['BIKE-ARO20', 420, 7, 38400, 612, '1'], ['PANELA-KIT5', 180, 9, 21500, 405, '1'], ['FONE-BT-01', 310, 16, 52800, 1180, '1'],
    ['TAPETE-YOGA', 118, 10, 16900, 322, '1'], ['GARRAFA-1L', 160, 8, 24100, 530, '2'], ['CAIXA-SOM', 140, 3, 19800, 410, '2'],
    ['MOCHILA-NB', 60, 5, 9600, 188, '2'], ['LUMI-LED', 45, 7, 8200, 176, '2']];
  const met = (custo, vendas, receita, impressoes, cliques, extra) => Object.assign({ impressoes, cliques, custo: r2(custo), cpc: cliques ? r2(custo / cliques) : null,
    ctr: impressoes ? r2(cliques / impressoes * 100) : null, receita: r2(receita), receitaDireta: r2(receita), receitaIndireta: 0, vendas, vendasDiretas: vendas, vendasIndiretas: 0,
    vendasOrganicas: null, receitaOrganica: null, acos: receita > 0 ? r2(custo / receita * 100) : null, tacos: null, roas: custo > 0 ? r2(receita / custo) : null, cvr: null, sov: null }, extra || {});
  const NOMES = { 1: 'Campanha principal', 2: 'Campanha 2' };
  const anuncios = ADS.map(([sku, custo, vendas, imp, cli, camp]) => { const p = porSku[sku];
    return Object.assign({ itemId: p.itemId, catalogoProduto: false, produtoCatalogoId: '', titulo: p.titulo, status: 'active', nivel: '', tipo: '', catalogo: false, ganhaBuyBox: false,
      campanhaId: camp, campanha: NOMES[camp], foto: '', tags: [], precoParaGanhar: null, advertiserId: '555000111' }, met(custo, vendas, vendas * p.preco, imp, cli)); });
  const somaCamp = id => { const l = anuncios.filter(a => !id || a.campanhaId === id), s = k => l.reduce((t, a) => t + a[k], 0);
    return met(s('custo'), s('vendas'), s('receita'), s('impressoes'), s('cliques')); };
  const camp = (id, estrategia, roasObjetivo, orcamentoDiario, share) => ({ id, nome: NOMES[id], status: 'active', estrategia, acosObjetivo: r2(100 / roasObjetivo), roasObjetivo,
    orcamento: orcamentoDiario, orcamentoDiario, orcamentoAutomatico: false, canal: 'marketplace', criada: MESES[4] + '-10', atualizada: diaMais(-12), advertiserId: '555000111',
    gruposVisiveis: 1, metricas: somaCamp(id), share });
  mem['ads:' + CONTA] = { ts: agora - 5 * 60000, temAds: true, periodo: { de: diaMais(-29), ate: hoje }, advertiserId: '555000111',
    campanhas: [camp('1', 'PROFITABILITY', 8, 40, { ganhas: 47, perdidasOrcamento: 38, perdidasClassificacao: 15, topo: 21 }),
      camp('2', 'PROFITABILITY', 5, 20, { ganhas: 58, perdidasOrcamento: 4, perdidasClassificacao: 38, topo: 17 })],
    anuncios, totalAnuncios: anuncios.length, completo: true,
    resumo: { total: Object.assign(somaCamp(), { vendasOrganicas: 171, receitaOrganica: 22948.6 }), diario: [] },
    // anterior.campanhas = {id: métricas} (como o fundo grava; soma = o total abaixo): o detalhe de Ads do anúncio compara a campanha.
    anterior: { periodo: { de: diaMais(-59), ate: diaMais(-30) }, campanhas: { 1: met(790, 34, 6720.2, 120100, 2240), 2: met(420, 20, 3700.1, 56200, 1070) },
      total: met(1210, 54, 10420.3, 176300, 3310, { vendasOrganicas: 158, receitaOrganica: 21530.9 }) } };

  // Central de promoções (formato de SHC.mlPromosDoEstado): os 11 produtos com propostas; o fone tem ainda uma caixa sem a conta do ML.
  // Kit de panelas: só a Oferta do dia bate a meta (é a ★), as outras duas ficam abaixo; a caixa de som dá prejuízo.
  const ini = curta(diaMais(4)), fim = curta(diaMais(17));
  const PROMOS = [
    ['PANELA-KIT5', [['Oferta do dia', curta(diaMais(2)), '(10%)', 259.9], ['Semana da casa', ini + ' a ' + fim, '(20%)', 231.9], ['Liquidação de primavera', ini + ' a ' + fim, '(24%)', 219.9]]],
    ['CAIXA-SOM', [['Ofertas da quinzena', ini + ' a ' + fim, '(10%)', 134.9]]],
    ['FONE-BT-01', [['Ofertas da quinzena', ini + ' a ' + fim, '(10%)', 116.9], ['Oferta relâmpago', curta(diaMais(5)), '(20%)', 103.9]]],
    ['BIKE-ARO20', [['Oferta relâmpago', curta(diaMais(3)), '(5%)', 664.9], ['Semana das crianças', ini + ' a ' + fim, '(10%)', 629.9], ['Campanha do mês', ini + ' a ' + fim, '(15%)', 594.9]]],
    ['GARRAFA-1L', [['Semana da casa', ini + ' a ' + fim, '(10%)', 80.9]]],
    ['TAPETE-YOGA', [['Ofertas da quinzena', ini + ' a ' + fim, '(10%)', 89.9]]],
    ['MOCHILA-NB', [['Ofertas da quinzena', ini + ' a ' + fim, '(10%)', 143.9]]],
    ['LUMI-LED', [['Ofertas da quinzena', ini + ' a ' + fim, '(5%)', 75.9]]],
    ['PANO-MICRO5', [['Oferta do dia', curta(diaMais(2)), '(10%)', 35.9]]],
    ['SUP-CEL', [['Oferta relâmpago', curta(diaMais(5)), '(15%)', 29.9]]],
    ['ORGANIZ-6', [['Ofertas da quinzena', ini + ' a ' + fim, '(10%)', 44.9]]],
  ];
  const familias = [], propostas = [];
  PROMOS.forEach(([sku, lista], i) => {
    const p = porSku[sku], chave = 'F' + (88001 + i);
    familias.push({ chave, id: String(88001 + i), titulo: p.titulo, foto: foto(p.sigla, p.cor), preco_txt: 'R$ ' + p.preco.toFixed(2).replace('.', ','), tipos: p.tipo,
      estoque: p.estoque, envio_txt: p.frete ? 'Você oferece frete grátis' : '', anuncios: [p.itemId] });
    lista.forEach(([promo, datas, desconto_txt, preco]) => {
      const tarifa = tarifaDe(preco, p.tipo), envio = preco >= 79 ? p.frete : 0;
      propostas.push({ familia: chave, itemId: p.itemId, promo, datas, desconto_txt, preco, tarifa, tipo: p.tipo, envio, envio_desc: envio ? 'Grátis para o comprador' : '',
        recebe: r2(preco - tarifa - envio), recebe_obs: 'Não contempla descontos cumulativos' });
    });
  });
  window.__lojaSemCalculo = [{ familia: 'F88003', nome: 'Campanha com participação do Mercado Livre', datas: ini + ' a ' + fim }];
  mem['ml:promos:' + CONTA] = { ts: agora - 4 * 60000, paginas: 1, familias, propostas };

  // Full (formato de SHC.mlFullDoEstado): um produto em cada classe de saúde do estoque.
  const prod = (sku, tamanho, vendas30, aptas, aCaminho, dias, acao) => { const p = porSku[sku];
    return { produtoId: p.familia, itemId: p.itemId, itemIds: [p.itemId], titulo: p.titulo, sku, ean: '', variacao: '', vendas30, estoqueMedio: aptas, aCaminho,
      naoAptas: 0, aptas, tempoEstoque: 0, diasAteEsgotar: dias, esgotarTexto: dias === null ? 'Sem estoque' : dias + ' dias', acaoSugerida: acao || '', status: 'Ativa', tamanho,
      avisos: acao ? [acao] : [], colunasML: [] }; };
  const produtos = [
    prod('FONE-BT-01', 'PEQUENO', 48, 9, 0, 5, 'Envie mais unidades'),       // crítico
    prod('MOCHILA-NB', 'MÉDIO', 18, 0, 0, null, 'Envie mais unidades'),      // sem estoque (alerta)
    prod('GARRAFA-1L', 'PEQUENO', 35, 16, 10, 14, ''),                        // atenção
    prod('PANO-MICRO5', 'PEQUENO', 40, 70, 0, 52, ''),                        // saudável
    prod('BIKE-ARO20', 'GRANDE', 14, 30, 0, 64, ''),                          // saudável
    prod('TAPETE-YOGA', 'MÉDIO', 26, 300, 0, 346, ''),                        // excedente
    prod('SUP-CEL', 'PEQUENO', 0, 25, 0, null, ''),                           // parado
  ];
  const esp = (id, titulo, usado, capacidade, pendente) => ({ id, titulo, usado, capacidade, pct: Math.round(usado / capacidade * 100), livre: capacidade - usado - pendente, noFull: usado, pendente, status: 'available' });
  const mesE = (m, pill, a, b) => ({ mes: m, pill, motivo: 'Segundo a pontuação do dia 15: 78 pontos', segmentos: [{ id: 'totable', titulo: 'Pequenos e médios', unidades: a }, { id: 'non_totable', titulo: 'Grandes e extragrandes', unidades: b }] });
  const card = (titulo, pontos, max) => ({ titulo, pontos, max, texto: '', periodo: '' });
  mem['ml:full:' + CONTA] = { ts: agora - 5 * 60000, temFull: true, vazio: '',
    espaco: [esp('totable', 'Pequenos e médios', produtos.filter(p => p.tamanho !== 'GRANDE').reduce((s, p) => s + p.aptas, 0), 600, 10), esp('non_totable', 'Grandes e extragrandes', 30, 40, 0)],
    mesesEspaco: [mesE(NOME_MES[H.getMonth()], 'ATRIBUÍDO', 600, 40), mesE(NOME_MES[(H.getMonth() + 1) % 12], 'ESTIMADO', 600, 40)],
    pontuacao: { total: 78, max: 100, titulo: 'Pontuação e métricas de ' + curta(diaMais(-1)), cards: [card('Tempo de estoque', 26, 30), card('Fora de venda', 10, 10), card('Vendas por estoque armazenado', 28, 40), card('Rotatividade de estoque', 14, 20)], dica: '' },
    produtos, avisos: [] };
  // Remessas do Full (formato de SHC.mlRemessasFull + o detalhe de SHC.mlRemessaDetalheDoEstado), fictícias: 1 a caminho, 1 recebida com diferença
  // (panos faltando e tapetes não aptos; o ML cobrou R$ 43,20) e 2 sem problema. Sem prazo para reclamar: o ML não manda, o Copiloto não inventa.
  const rem = (id, status, st, dAg, dRec, un, aptas, custo) => ({ id, tipo: 'ftl', status, subStatus: st === 'Recebida com mudanças' ? 'with_differences' : '', statusTexto: st,
    agendada: diaMais(dAg), recebida: dRec === null ? '' : diaMais(dRec), atualizada: diaMais(dRec === null ? -2 : dRec), unidades: un, declaradas: 3, aptas, custo,
    multa: null, multaFlag: false, multaTipo: '', problemas: { identificacao: false, semSolucao: false, fiscal: false }, centro: 'BRSC02' });
  const remessasLoja = [rem('77687990', 'confirmed', 'Agendada', 1, null, 298, 0, null), rem('76543210', 'closed_with_changes', 'Recebida com mudanças', -5, -4, 120, 111, 43.2),
    rem('75880412', 'closed_ok', 'Recebida', -22, -21, 210, 210, 96), rem('74901233', 'closed_ok', 'Recebida', -40, -39, 180, 180, 82),
    rem('73100555', 'closed_with_changes', 'Recebida com mudanças', -56, -55, 60, 58, 28.5)];   // reclamação já aberta pelo seller: sai do vermelho
  // v3.1: "Quanto dá para recuperar" — 2 fretes cobrados acima do frete do anúncio e 2 cobranças para conferir (tudo fictício).
  const pedF = n => '20000' + String(88110000 + n);
  mem['conferir:' + CONTA] = { ts: agora - 4 * 60000, meses: [MESES[11], MESES[12]], qtd: 2, valor: 26.9, itens: [
    { pedido: pedF(1), data: diaMais(-9), itemId: porSku['GARRAFA-1L'].itemId, titulo: porSku['GARRAFA-1L'].titulo || '', cobranca: 'Custo por vender no Mercado Livre', valor: 29.8, esperado: 14.9, diferenca: 14.9, regra: 'repetida', motivo: 'A mesma cobrança aparece 2 vezes neste pedido, com o mesmo valor.' },
    { pedido: pedF(2), data: diaMais(-12), itemId: porSku['PANELA-KIT5'].itemId, titulo: '', cobranca: 'Taxa de parcelamento', valor: 12, esperado: 0, diferenca: 12, regra: 'sem_estorno', motivo: 'A venda foi cancelada e a tarifa de venda foi devolvida, mas esta cobrança não.' }] };
  const fhAnt = mem['frete:' + CONTA + ':hist'] || null;
  if (!fhAnt) mem['frete:' + CONTA + ':hist'] = { ts: agora - 4 * 60000, fonte: 'faturamento', aprox: 0, vendasLidas: true, semLeitura: [], hoje, desde: diaMais(-60), porAnuncio: {},
    conta: { ult30: { pedidos: 180, total: 3861.2, medio: 21.45, tipico: 21.45, descontoML: 0 }, ant30: { pedidos: 172, total: 3431.4, medio: 19.95, tipico: 19.95, descontoML: 0 }, variacaoPct: 7.5 },
    conciliacao: { vendas: 180, conciliados: 176, faltam: 4, compradorPaga: 0, cancelados: 2, semCobrancaAinda: 3, pedidosSemCobranca: [], semFreteNoAnuncio: 1, freteSemVenda: 0, totalAMais: 31.1,
      pagoAMais: [{ pedido: pedF(3), itemId: porSku['MOCHILA-NB'].itemId, data: diaMais(-6), cobrado: 41.95, esperado: 23.95, diferenca: 18, formato: 'gratis', dev: 46.49,
          linhas: [{ t: 'Tarifa do Mercado Envios (Por sua conta)', v: 35.3, d: diaMais(-6) }, { t: 'Tarifa de envio extra ou intermunicipal (Por sua conta)', v: 6.65, d: diaMais(-6) }] },
        { pedido: pedF(4), itemId: porSku['FONE-BT-01'].itemId, data: diaMais(-15), cobrado: 34.55, esperado: 21.45, diferenca: 13.1, formato: 'gratis',
          linhas: [{ t: 'Tarifa do Mercado Envios (Por sua conta)', v: 38.55, d: diaMais(-15) }, { t: 'Cancelamento da tarifa por envios no Mercado Livre (Por sua conta)', v: 4, d: diaMais(-13), e: 1 }] },
        { pedido: pedF(5), itemId: porSku['GARRAFA-1L'].itemId, data: diaMais(-9), cobrado: 49.8, esperado: 24.9, diferenca: 24.9, formato: 'gratis', talvezUnidades: true }],
      talvez: { pedidos: 1, total: 24.9 } },
    // v3.1: frete de devoluções (tarifa de devolução = frete de volta), fora do frete das vendas
    devolucoes: { ult30: { pedidos: 3, total: 98.37 }, ant30: { pedidos: 2, total: 61.2 }, lista: [
      { pedido: pedF(3), itemId: porSku['MOCHILA-NB'].itemId, data: diaMais(-4), valor: 46.49 }, { pedido: pedF(6), itemId: porSku['PANELA-KIT5'].itemId, data: diaMais(-11), valor: 31.9 },
      { pedido: pedF(7), itemId: porSku['FONE-BT-01'].itemId, data: diaMais(-20), valor: 19.98 }] } };
  mem['ml:full:remessas:' + CONTA] = { ts: agora - 5 * 60000, total: 5, parcial: false, remessas: remessasLoja, porMes: {}, fiscal: '', penalidade: null };
  const pr = (sku, dec, proc, dif, aptas, naoAptas) => ({ itemId: porSku[sku].itemId, sku, declaradas: dec, processadas: proc, diferencas: dif, aptas, naoAptas, identificado: true, volumeCm3: null, volumeEstimado: false, pesoKg: null, resultado: '' });
  const det = (id, status, un, produtos) => ({ id, status, subStatus: '', statusTexto: '', fechada: /^closed/.test(status), agendadaPara: '', chegouEm: '', tipoColeta: 'ftl', centro: 'BRSC02', coletaPorDistancia: true,
    unidades: un, volumes: [], toleranciaPct: 5, cobrancas: [], multa: { ativa: false, tipo: '', valor: null }, inconformidades: [], reclamacoesDisponiveis: status === 'closed_with_changes' ? ['RECOUNT'] : [],
    reclamacoesAbertas: 0, prazoReclamar: null, produtos, ts: agora - 60 * 60000 });
  mem['remessas:' + CONTA + ':detalhe'] = { ts: agora - 60 * 60000, porId: {
    77687990: det('77687990', 'confirmed', { enviadas: 298, recebidas: null, faltando: null, inesperadas: null }, [pr('FONE-BT-01', 120, null, null, null, null), pr('GARRAFA-1L', 98, null, null, null, null), pr('MOCHILA-NB', 80, null, null, null, null)]),
    76543210: det('76543210', 'closed_with_changes', { enviadas: 120, recebidas: 114, faltando: 6, inesperadas: null },
      [pr('PANO-MICRO5', 40, 34, -6, 34, 0), pr('TAPETE-YOGA', 30, 30, 0, 27, 3), pr('PANELA-KIT5', 50, 50, 0, 50, 0)]) } };
  mem['remessas:' + CONTA + ':detalhe'].porId[73100555] = Object.assign(det('73100555', 'closed_with_changes', { enviadas: 60, recebidas: 58, faltando: 2, inesperadas: null }, [pr('FONE-BT-01', 60, 58, -2, 58, 0)]), { reclamacoesAbertas: 1 });
  mem['remessas:' + CONTA + ':detalhe'].porId[76543210].inconformidades = ['Faltando 6 unidades', '3 unidades não aptas para o Full'];

  // Afiliados (afil:<conta>, formato de sincronizarAfiliados): 9 dos 11 produtos na campanha (4%; a bicicleta a 6% e a garrafa a 10%),
  // a luminária pausada; 30 dias de métricas e 12 pedidos (a soma por SKU/situação é montada no DOMContentLoaded com SHC.afilPedidosAgrega).
  // A caixa de som já dá prejuízo e a garrafa passa a dar com os 10%: as duas aparecem em "comissão come o lucro".
  const AF_FORA = ['SUP-CEL', 'ORGANIZ-6'], AF_PCT = { 'BIKE-ARO20': 6, 'GARRAFA-1L': 10 };
  const afProds = PROD.filter(p => AF_FORA.indexOf(p.sku) < 0).map(p => ({ itemId: p.itemId, titulo: p.titulo, comissao: AF_PCT[p.sku] || 4, status: 'ACTIVE',
    publicacao: p.sku === 'LUMI-LED' ? 'PAUSED' : 'ACTIVE', inicio: MESES[10] + '-25' }));
  // [SKU, cliques, pedidos, unidades]
  const AF_MET = [['BIKE-ARO20', 84, 2, 2], ['PANELA-KIT5', 61, 3, 3], ['FONE-BT-01', 52, 4, 4], ['GARRAFA-1L', 23, 2, 2], ['CAIXA-SOM', 9, 1, 1], ['MOCHILA-NB', 27, 0, 0], ['TAPETE-YOGA', 9, 0, 0]];
  const afPor = AF_MET.map(([sku, cliques, ped, un]) => { const p = porSku[sku], v = r2(p.preco * un), c = r2(v * (AF_PCT[sku] || 4) / 100);
    return { itemId: p.itemId, titulo: p.titulo, preco: p.preco, cliques, vendas: v, unidades: un, qtdVendas: ped, custoEstimado: c, roi: c ? Math.round(v / c) : 0 }; });
  const afSoma = k => r2(afPor.reduce((t, p) => t + p[k], 0));
  mem['afil:' + CONTA] = { ts: agora - 5 * 60000, temAfiliados: true,
    campanha: { status: 'ACTIVE', comissaoGeral: 4, inicio: MESES[10] + '-25', faixa: { min: 4, max: 80, padrao: 8, alerta: 30 }, entradaAutomatica: true,
      produtos: afProds, totalProdutos: afProds.length, completo: true },
    metricas: { periodo: { de: diaMais(-29), ate: hoje }, vendas: afSoma('vendas'), unidades: afSoma('unidades'), qtdVendas: afSoma('qtdVendas'), custoEstimado: afSoma('custoEstimado'),
      ultimaAtualizacao: hoje + 'T03:10:00', porProduto: afPor, completo: true },
    pedidos: null,
    // v3.1: campanhas exclusivas (formato de SHC.afilExclusivasDoEstado), fictícias; ?excl=nada = conta sem nenhuma (o cartão some)
    exclusivas: q.get('excl') === 'nada' ? { total: 0, campanhas: [] } : { total: 3, campanhas: [
      { id: 'e1', numero: '5550000001', titulo: 'Semana da bike', status: 'ACTIVE', estado: 'ativa', afiliados: 12, produtos: 3, comissaoMin: 6, comissaoMax: 6, de: diaMais(-3), ate: diaMais(4) },
      { id: 'e2', numero: '5550000002', titulo: 'Volta às aulas', status: 'SCHEDULED', estado: 'programada', afiliados: 20, produtos: 5, comissaoMin: 4, comissaoMax: 6, de: diaMais(10), ate: diaMais(17) },
      { id: 'e3', numero: '5550000003', titulo: 'Cozinha completa', status: 'FINISHED', estado: 'finalizada', afiliados: 50, produtos: 4, comissaoMin: 5, comissaoMax: 5, de: diaMais(-60), ate: diaMais(-56) }] } };
  // [SKU, situação] — um por pedido; 'not_verified' = a verificar (prazo de conversão aberto), 'verified' = confirmado
  window.__afilVendas = [['BIKE-ARO20', 'verified'], ['BIKE-ARO20', 'not_verified'], ['PANELA-KIT5', 'verified'], ['PANELA-KIT5', 'verified'], ['PANELA-KIT5', 'not_verified'],
    ['FONE-BT-01', 'verified'], ['FONE-BT-01', 'verified'], ['FONE-BT-01', 'not_verified'], ['FONE-BT-01', 'not_verified'], ['GARRAFA-1L', 'verified'], ['GARRAFA-1L', 'verified'],
    ['CAIXA-SOM', 'not_verified']].map(([sku, v]) => { const p = porSku[sku]; return { itemId: p.itemId, sku, titulo: p.titulo, valor: p.preco, unidades: 1,
      comissao: r2(p.preco * (AF_PCT[sku] || 4) / 100), verificacao: v }; });
  // Pós-venda (posvenda:<conta>, formato de sincronizarPosVenda v2.9): 2 reclamações/mediações em aberto, 1 mensagem, 1 devolução e as
  // 11 reclamações que a lista do ML mostra (fictícias; sem pedido nem comprador). A caixa de som é o produto com mais problema.
  const PV = [['CAIXA-SOM', 'Produto diferente', true, 'Aguardando sua resposta'], ['CAIXA-SOM', 'Produto diferente', false, 'Devolução finalizada. Te demos o dinheiro dessa venda.'],
    ['CAIXA-SOM', 'Produto diferente', false, 'Devolução a caminho'], ['CAIXA-SOM', 'Pacote sem o produto', true, 'Mediação em andamento'], ['CAIXA-SOM', 'Pacote sem o produto', false, 'Liberamos o dinheiro da venda para você e reembolsamos o comprador'],
    ['FONE-BT-01', 'Produto diferente', false, 'Liberamos o dinheiro da venda para você e reembolsamos o comprador'], ['FONE-BT-01', 'Produto diferente', false, 'Devolução finalizada. Te demos o dinheiro dessa venda.'],
    ['FONE-BT-01', 'O comprador se arrependeu', false, 'Devolução finalizada. Te demos o dinheiro dessa venda.'], ['GARRAFA-1L', 'Embalagens e produtos danificados', false, 'Liberamos o dinheiro da venda para você e reembolsamos o comprador'],
    ['GARRAFA-1L', 'Embalagens e produtos danificados', false, 'Devolução finalizada. Te demos o dinheiro dessa venda.'], ['MOCHILA-NB', 'O comprador se arrependeu', false, 'Devolução finalizada. Te demos o dinheiro dessa venda.']];
  mem['posvenda:' + CONTA] = { ts: agora - 5 * 60000, reclamacoes: 2, mensagens: 1, devolucoes: 1, paginas: 2, casosTs: agora - 5 * 60000,
    casos: PV.map(([sku, motivo, rep, situacao], i) => ({ titulo: porSku[sku].titulo, valor: porSku[sku].preco, unidades: 1, motivo, afetouReputacao: rep, situacao })) };
  // Reputação (reputacao:<conta>, formato de SHC.mlReputacaoDoEstado) e perguntas (perguntas:<conta>), fictícias: conta verde (MercadoLíder),
  // reclamações em 73% do limite (3 de 412 vendas, limite 1%) e 2 perguntas sem resposta com tempo médio de 1h40. ?rep=nada = ainda não lidas.
  if (q.get('rep') !== 'nada') {
    const vRep = (id, rotulo, qtd, vendas, lim, saude) => ({ id, rotulo, pct: Math.round(qtd / vendas * 10000) / 100, qtd, vendas, limitePct: lim, proximoNivelPct: lim, saude: saude || 'healthy',
      link: 'https://www.mercadolivre.com.br/metricas/meu-atendimento/detalhe?filters=PROBLEM_TYPE.' + id.toUpperCase() + '_PROBLEMS' });
    mem['reputacao:' + CONTA] = { ts: agora - 5 * 60000, nivel: { codigo: 'green_silver', texto: 'MercadoLíder' }, periodo: { dias: 60, vendas: 412 },
      variaveis: [vRep('claims', 'Reclamações', 3, 412, 1), vRep('disputes', 'Mediações', 1, 412, 0.5), vRep('cancellations', 'Cancelamentos (por você)', 0, 412, 0.5), vRep('delayed_handling_time', 'Envios atrasados', 12, 412, 6)],
      topItens: [{ itemId: porSku['CAIXA-SOM'].itemId, problemas: 2 }, { itemId: porSku['FONE-BT-01'].itemId, problemas: 1 }],
      proximoNivel: { codigo: 'green_gold', texto: 'MercadoLíder Gold', faltam: [{ id: 'gmv', rotulo: 'faturamento', falta: 'R$ 18.200' }, { id: 'fulfilled_transactions', rotulo: 'vendas concluídas', falta: '88' }] },
      linkTop: 'https://www.mercadolivre.com.br/metricas/atendimento/detalhes?selected_period=lastTwoMonths&reputation=true' };
    mem['perguntas:' + CONTA] = { ts: agora - 5 * 60000, pendentes: 2, tempoMedio: { comercial: 100 }, link: 'https://www.mercadolivre.com.br/perguntas/vendedor', fonte: 'perguntas' };
  }
  // v3.1 (prints da aba Saúde, 29/09): &saude=cheia (use junto com &etq=1) → permissão das fotos/medidas dada, uma medida mudada pelo ML
  // (caixa de som), robô de fotos ligado com 1 sugestão e 1 troca já medida (garrafa: 7 dias antes × 7 depois). Tudo fictício.
  if (q.get('saude') === 'cheia') {
    window.chrome.permissions = { contains: async () => true, request: async () => true, remove: async () => true };
    const dia = 864e5, cx = porSku['CAIXA-SOM'].itemId, gt = porSku['GARRAFA-1L'].itemId;
    (mem['medidas:' + CONTA] = mem['medidas:' + CONTA] || { ts: agora - 4 * 60000, porItem: {} }).porItem[cx] = { sku: 'CAIXA-SOM', atual: { ordenadas: [15, 20, 30], pesoKg: 0.9, fonte: 'tela', secao: 'envio', de: agora - 11 * dia, ts: agora - dia },
      historico: [{ ordenadas: [10, 12, 18], pesoKg: 0.6, de: agora - 60 * dia, ate: agora - 11 * dia, vistoAte: agora - 18 * dia, fonte: 'tela' }] };
    const vg = {}; for (let d = -21; d < 0; d++) vg[diaMais(d)] = d < -8 ? 20 : 27;
    mem['visitas:' + CONTA].porItem[gt] = { dias: vg };
    mem.cfg = Object.assign(mem.cfg, { robo_ligado: true, robo_itens: { [cx]: true, [gt]: true } });
    const tsTroca = new Date(H.getFullYear(), H.getMonth(), H.getDate() - 8, 12).getTime();
    mem['robo:' + CONTA] = { ultimaPassada: hoje, historico: [{ ts: tsTroca, itemId: gt, antes: ['a', 'b', 'c'], depois: ['a', 'c', 'b'], motivo: 'Você trocou a ordem das fotos no Mercado Livre.', visitas7Antes: 140, resultado: 'manual' }],
      sugestoes: [{ itemId: cx, motivo: 'As visitas caíram 30% na última semana (196 contra 280). Nova ordem das fotos para testar; a capa fica.', novaOrdem: ['a', 'c', 'b'], ts: agora - 3600e3 }] };
  }
  // 30/09 (perguntas da dona: logística, canal e robô de fotos): &dona=1 (use junto com &saude=cheia&etq=1) → o que falta nos prints.
  // Frete: luminária "Combine a entrega" que cabe no Mercado Envios (o ML libera na tela) e organizador pausado pelo ML.
  // Saúde: 2ª troca sua (luminária, visitas caíram) → registro "2 trocas feitas por você · 1 melhorou · 1 piorou".
  // Canal: 3 transmissões criadas (1 enviada com alcance, 1 programada, 1 que não está no ML) + o estado da página do canal (window.__canalE2E).
  if (q.get('dona')) {
    const dia = 864e5, itA = mem['ml:anuncios:' + CONTA].itens, lum = itA.find(i => i.sku === 'LUMI-LED'), org = itA.find(i => i.sku === 'ORGANIZ-6');
    Object.assign(lum, { entregaTxt: 'Combine a entrega', frete: 0, recebe: r2(lum.preco - lum.tarifa) });
    (mem['medidas:' + CONTA] = mem['medidas:' + CONTA] || { ts: agora - 4 * 60000, porItem: {} }).porItem[lum.itemId] = { sku: 'LUMI-LED',
      atual: { ordenadas: [12, 20, 45], pesoKg: 1.2, fonte: 'tela', secao: 'envio', de: agora - 30 * dia, ts: agora - dia, modos: { me1: false, me2: true, combinar: true, me2Obrigatorio: false } }, historico: [] };
    Object.assign(org, { status: 'paused', restricao: { id: 'moderation_photo', txt: 'Pausado pelo Mercado Livre · Corrija as fotos do anúncio.' } });
    const vl = {}; for (let d = -21; d < 0; d++) vl[diaMais(d)] = d < -10 ? 40 : 24;
    mem['visitas:' + CONTA].porItem[lum.itemId] = { dias: vl };
    if (mem['robo:' + CONTA]) mem['robo:' + CONTA].historico.push({ ts: new Date(H.getFullYear(), H.getMonth(), H.getDate() - 10, 12).getTime(), itemId: lum.itemId,
      antes: ['a', 'b', 'c'], depois: ['a', 'c', 'b'], motivo: 'Você trocou a ordem das fotos no Mercado Livre.', visitas7Antes: 280, resultado: 'manual' });
    const SF = 'LojaExemploCanalE2E0000000000000000000001', DSEM = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
    const seg = -((H.getDay() + 6) % 7);   // segunda desta semana (dias a partir de hoje)
    const cria = (n, h, tipo, p) => { const d = diaMais(n); return { id: d + '|' + h + '|' + tipo, itemId: p.itemId, tipo, dia: d, hora: h, titulo: p.titulo, nome: d.slice(8) + '/' + d.slice(5, 7) + ' ' + pad(h) + 'h · ' + p.titulo, ts: agora - dia }; };
    const criadas = [cria(seg, 19, 'channel', porSku['BIKE-ARO20']), cria(Math.max(seg + 4, 1), 10, 'channel', porSku['GARRAFA-1L']), cria(Math.max(seg + 3, 1), 19, 'story', porSku['TAPETE-YOGA'])];
    const dataTxt = d => { const x = new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8)); return DSEM[x.getDay()] + ', ' + x.getDate() + '/' + MES_CURTO[x.getMonth()] + '/' + x.getFullYear() + ','; };
    const camp = (id, c, status, cod, nums) => ({ id, campaign_type: 'new_arrival', cells: [{ id: 'title', header: 'Produto em promoção', title: c.nome }, { id: 'date', text: dataTxt(c.dia), description: pad(c.hora) + ':00 h' }, { id: 'status', title: status, status: cod }]
      .concat(nums ? [{ id: 'sent', text: nums[0] }, { id: 'views', text: nums[1] }, { id: 'clicks', text: nums[2] }, { id: 'ctr', text: nums[3] }, { id: 'sales-units', text: nums[4] }] : []) });
    const estado = { appProps: { pageProps: { data: { storefront: { id: SF, name: 'Loja Exemplo', owner_id: 1 } } } },
      bricks: [{ properties: { campaigns: [camp('1', criadas[0], 'Enviada', 'success', ['1.815', '300', '40', '4%', '2']), camp('2', criadas[1], 'Programada', 'info')] } }, { properties: { campaigns: [] } }] };
    window.__canalE2E = { sf: SF, estado };
    const plano = criadas.map((c, i) => ({ id: c.id, dia: c.dia, hora: c.hora, tipo: c.tipo, itemId: c.itemId, titulo: c.titulo, lucro: [120.5, 18.4, 21.3][i], pct: [17.2, 20.5, 21.3][i], feito: true }));
    mem['shc:canal:sel'] = SF;
    mem['shc:canal:plano:' + SF] = { ts: agora - dia, plano, opcoes: { horas: [10, 19], tipos: ['channel', 'story'] }, prontos: plano.map(s => ({ itemId: s.itemId, titulo: s.titulo, lucro: s.lucro, pct: s.pct, dia: s.dia, feito: true })),
      fora: { total: 0, resumo: '' }, criadas };
    document.addEventListener('DOMContentLoaded', () => {   // a conferência (o que a Agenda grava) com a regra de verdade
      const S = window.SHC;
      if (S && S.canalConfere && S.canalCampanhas) mem['shc:canal:plano:' + SF].conferencia = S.canalConfere(criadas, S.canalCampanhas(estado));
    });
  }
  if (q.get('aba')) mem['shc:foco'] = Object.assign({ aba: q.get('aba') }, q.get('item') ? { itemId: q.get('item') } : {});   // &item=MLB… abre o detalhe (Frete/Ads)

  // Alertas do ícone (shc:alertas), com a regra do fundo (SHC.alertasDe), assim que a extensão carregar.
  document.addEventListener('DOMContentLoaded', () => {
    const S = window.SHC;
    if (!S || !S.alertasDe) return;
    if (S.afilPedidosAgrega && window.__afilVendas) mem['afil:' + CONTA].pedidos = Object.assign(S.afilPedidosAgrega(window.__afilVendas),
      { periodo: mem['afil:' + CONTA].metricas.periodo, total: window.__afilVendas.length, completo: true });
    // o painel já leu o storage antes deste ponto: avisa a mudança (como o fundo faria) para ele redesenhar com os pedidos
    if (mem['afil:' + CONTA] && mem['afil:' + CONTA].pedidos) chrome.storage.local.set({ ['afil:' + CONTA]: mem['afil:' + CONTA] });
    const custos = {}, vm = {};
    Object.keys(mem).forEach(k => { if (k.indexOf('c|') === 0) custos[k] = mem[k]; if (k.indexOf('vm|ml|') === 0) vm[k.slice(6)] = mem[k]; });
    const r = S.alertasDe({ full: mem['ml:full:' + CONTA], ads: mem['ads:' + CONTA], itens: mem['ml:anuncios:' + CONTA].itens, custos, cfg: mem.cfg, vm, mesesLidos: MESES, hoje });
    mem['shc:alertas'] = { ts: Date.now(), conta: CONTA, criticos: r.criticos, full: r.full, ads: r.ads, lista: r.lista };
    // Robô de promoções (robopromo:<conta>), com a regra do fundo: há 2 dias sugeriu parte; nesta sincronização, as outras (novo = ponto no ícone).
    if (S.roboPromoSugestoes && mem.cfg.robopromo) {
      const skuDe = {}; PROD.forEach(p => { skuDe[p.itemId] = p.sku; });
      const sugs = S.roboPromoSugestoes(mem['ml:promos:' + CONTA], p => mem['c|sku|' + skuDe[p.itemId]] || null, mem.cfg), m = S.roboPromoMargem(mem.cfg);
      mem['robopromo:' + CONTA] = S.roboPromoPassada(S.roboPromoPassada(null, sugs.slice(1), m, agora - 2 * 864e5 + 3 * 3600e3), sugs, m, agora - 4 * 60000);
    }
  });
})();
