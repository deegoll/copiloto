// Copiloto — aba "TikTok" do painel lateral (v3.2). Só DESENHA: a conta vem de SHC.tt.resumo(SHC.tt.ler()) (tiktok.js + nucleo),
// que lê o que a captura passiva gravou (tt:<loja>:*). Nenhuma chamada ao TikTok, nenhum alarme, nada de navegar sozinho.
// Função pura (roda em teste): SHC.ttAba.html(vm, {hoje, abertos}). O painel-lateral.js só busca os dados e põe o HTML na tela.
// 3.3.0 (E21): a aba saiu do topo (E8) e o painel não chama mais o T.html. O arquivo fica até a 3.3.1 porque as abas usam
// T.alertas, T.linhaPedido, T.ROT_AFIL, T.lidoTxt, T.pede e T.VAZIO (dividir por aba fica para a 3.3.1).
(function (root) {
    'use strict';
    const SHC = root.SHC || (root.SHC = {});
    const T = SHC.ttAba = {};

    T.URL_FINANCEIRO = 'https://seller-br.tiktok.com/finance/bills';
    T.VAZIO = 'Abra o Seller Center do TikTok Shop e as telas de Pedidos/Financeiro para o Copiloto ler.';
    const n = v => (typeof v === 'number' && isFinite(v) ? v : null);
    const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const moeda = v => (SHC.moeda ? SHC.moeda(v) : String(v));
    const pct = v => (n(v) === null ? '—' : String(Math.round(v * 10) / 10).replace('.', ',') + '%');
    const qtd = (x, um, varios) => x + ' ' + (x === 1 ? um : varios);
    const ddmm = d => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(8, 10) + '/' + d.slice(5, 7) : '');
    const lidoTxt = (x, tela) => {
        const em = x && (typeof x === 'number' ? x : x.lido_em);
        if (!(em > 0)) return '';
        const d = new Date(em), p = k => String(k).padStart(2, '0');
        return 'lido em ' + p(d.getDate()) + '/' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ((x && x.tela) || tela ? ' · ' + ((x && x.tela) || tela) : '');
    };
    const hojeDe = ms => { const d = new Date(ms), p = k => String(k).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
    const menosDias = (dia, k) => { const d = new Date(dia + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - k); return d.toISOString().slice(0, 10); };

    T.ROT_TARIFA = { comissao: 'Comissão do TikTok', programa_frete: 'Programa de frete (SFP)', taxa_fixa: 'Tarifa fixa por item', afiliado: 'Comissão do afiliado',
        afiliado_ads: 'Shop Ads (criador)', frete_venda: 'Frete a seu cargo', pagamento: 'Tarifa de pagamento', armazenagem: 'Armazenagem', frete_devolucao: 'Frete da devolução', outro: 'Afiliado e outros' };
    T.ROT_MOTIVO = { em_transito: 'Esperando a entrega', devolucao: 'Esperando devolução ou reembolso', entregue_no_prazo: 'Entregue, esperando o prazo' };
    T.ROT_CANAL = { Live: 'Live', Video: 'Vídeo', 'Product card': 'Vitrine' };
    T.ROT_SAUDE = { late_dispatch_rate: 'Envio atrasado', seller_fault_cancellation_rate: 'Cancelamento por culpa da loja', '24_hour_response_rate': 'Resposta em 24 h' };
    T.ROT_AFIL = { creator_message_count: 'mensagens de criadores', products_without_sample_count: 'produtos sem amostra', sample_request_count: 'pedidos de amostra' };
    const COD_MOTIVO = { 1: 'em_transito', 2: 'devolucao', 3: 'entregue_no_prazo' };   // to_settle_reason do TikTok
    const motivo = m => m.chave || COD_MOTIVO[m.motivo] || COD_MOTIVO[m.codigo] || m.motivo;
    const ptBR = t => String(t || '').replace(/Shop Performance Score/g, 'nota de desempenho da loja').replace(/>=/g, '≥').replace(/<=/g, '≤').replace(/(\d)\.(\d)/g, '$1,$2');
    const canal = c => String(c || '').split(' + ').map(x => T.ROT_CANAL[x] || x).join(' + ');
    const afilNum = (vm, k) => { const it = (((vm.afiliados || {}).pendencias || {}).itens || []).find(x => x.metrica === k); return it ? n(it.num) : null; };

    /**
     * Extratos: a soma dos pedidos só é cobrada quando TODOS os pedidos do extrato foram lidos (a receita deles = a receita do extrato).
     * Com pedido faltando, "não fecha" seria alarme falso → "faltam pedidos". ponytail: pedido em 2 extratos soma a receita nos dois.
     */
    T.extratos = vm => ((vm.repasse && vm.repasse.extratos) || []).map(e => {
        const dele = (vm.pedidos || []).filter(r => (r.extratos || []).indexOf(e.id) >= 0);
        const completo = !!dele.length && n(e.receita) !== null && Math.abs(dele.reduce((t, r) => t + (n(r.receita_liquida) || 0), 0) - e.receita) <= 0.05;
        return Object.assign({}, e, { completo, naoFecha: e.conta_fecha === false || (completo && e.pedidos_fecham === false) });
    });

    /** "Precisa de você" (vermelho → âmbar → aviso). hoje = 'AAAA-MM-DD'. */
    T.alertas = function (vm, hoje) {
        const desde = menosDias(hoje, 29), mes = (vm.pedidos || []).filter(r => r.dia && r.dia >= desde && r.dia <= hoje), al = [];
        const pr = mes.filter(r => r.classe === 'prejuizo'), nf = T.extratos(vm).filter(e => e.naoFecha), sc = T.semCusto(vm);
        // 3.3.0 (revisão): a aba TikTok saiu do topo; o "Ver" da Geral abre a Conciliação (pedidos e demonstrativos) e o Catálogo (custo)
        if (pr.length) al.push({ c: 'pr', tit: qtd(pr.length, 'pedido no prejuízo', 'pedidos no prejuízo') + ' em 30 dias', sub: 'Veja a conta de cada um na Conciliação.' });
        if (nf.length) al.push({ c: 'pr', tit: qtd(nf.length, 'extrato não fecha', 'extratos não fecham'), sub: 'O valor pago não bate com a soma. Veja na Conciliação.' });
        if (sc.size) al.push({ c: 'at', tit: qtd(sc.size, 'produto sem custo', 'produtos sem custo'), sub: 'Informe o custo no Catálogo para ver o lucro.' });
        const ar = vm.repasse && vm.repasse.a_receber, dev = ar ? ((ar.motivos || []).find(m => motivo(m) === 'devolucao') || {}).valor : null;
        if (dev > 0) al.push({ c: 'at', tit: moeda(dev) + ' parados em devolução', sub: 'Só libera quando a devolução ou o reembolso terminar.' });
        const s = vm.saude || {};
        (s.itens || []).filter(T.fora).forEach(i => al.push({ c: 'at', tit: (T.ROT_SAUDE[i.indicador] || i.titulo) + ' fora da meta', sub: 'Hoje ' + pct(i.valor * 100) + ' · meta ' + (i.direcao === 'maior_melhor' ? '≥ ' : '≤ ') + pct(i.meta * 100) + '.' }));
        const prazo = (s.itens || []).find(i => i.indicador === 'prazo_repasse_dias');
        if (s.aviso_d3 && prazo) al.push({ c: 'n', tit: 'Receber em ' + prazo.meta + ' dias em vez de ' + prazo.valor, sub: ptBR(s.aviso_d3) + '.' });
        const msg = afilNum(vm, 'creator_message_count'), amo = afilNum(vm, 'products_without_sample_count');
        if (msg > 0) al.push({ c: 'at', tit: qtd(msg, 'mensagem de criador sem ler', 'mensagens de criadores sem ler'), sub: 'Responder conta para a nota da loja.' });
        if (amo > 0) al.push({ c: 'n', tit: qtd(amo, 'produto sem amostra', 'produtos sem amostra') + ' para criadores', sub: 'Com amostra, mais criadores fazem vídeo e live.' });
        T.abertas(vm, hoje).slice(0, 1).forEach(c => al.push({ c: 'n', tit: 'Campanha aberta: ' + c.titulo, sub: 'Você não entrou' + (c.inscricao_ate ? ' · inscrição até ' + ddmm(c.inscricao_ate) : '') + '.' }));
        return al;
    };
    T.fora = i => i.indicador !== 'prazo_repasse_dias' && n(i.valor) !== null && n(i.meta) !== null && (i.direcao === 'maior_melhor' ? i.valor < i.meta : i.valor > i.meta);
    T.abertas = (vm, hoje) => (((vm.campanhas || {}).abertas) || []).filter(c => c && !c.inscrita && (!c.inscricao_ate || c.inscricao_ate >= hoje));
    /** Chaves de produto (SKU ou tiktok:<sku_id>) sem custo nos pedidos lidos. */
    T.semCusto = vm => new Set([].concat.apply([], (vm.pedidos || []).map(r => r.sem_custo || [])));

    // ── HTML (as classes das abas do ML: manchete, kpis k4, card/ch, acoes, sobra, selo, conta-ped) ──
    const kpi = (cls, rot, v, sub) => `<div class="kpi kn ${cls}"><div class="l">${esc(rot)}</div><div class="v">${v}</div><div class="s">${sub || '&nbsp;'}</div></div>`;
    const COR = { lucrativo: 'ok', apertado: 'at', prejuizo: 'pr' };
    const card = (titulo, fonte, corpo) => `<div class="card"><div class="ch"><h3>${esc(titulo)}</h3></div>${corpo}${fonte ? `<p class="det tt-lido">${esc(fonte)}</p>` : ''}</div>`;
    const pede = tela => `<p class="det">Abra ${esc(tela)} do TikTok Shop para o Copiloto ler.</p>`;
    T.lidoTxt = lidoTxt; T.pede = pede;   // 3.3.0 (E16): peças que a aba Afiliados usa no filtro TikTok (painel-lateral.js, P.afilTikTok)
    const sobraCls = r => (COR[r.classe] ? r.classe : 'sem_custo');
    const sobraTxt = r => r.status === 'nao_lido' ? 'não lido' : r.lucro_real === null || r.lucro_real === undefined ? 'sem custo'
        : (r.lucro_real < 0 ? 'Prejuízo ' + moeda(-r.lucro_real) : 'Lucro ' + moeda(r.lucro_real)) + (n(r.margem_pct) !== null ? ' (' + pct(r.margem_pct) + ')' : '');
    const cl = (rot, v, cls, est) => `<div class="cl${cls ? ' ' + cls : ''}"><span>${esc(rot)}${est ? ' <span class="selo cz">estimado</span>' : ''}</span><b>${v}</b></div>`;
    const menos = v => (n(v) === null ? '—' : v < 0 ? '+' + moeda(-v) : '−' + moeda(v));

    function contaHtml(r) {
        let h = r.bruto !== undefined ? cl('Preço', (r.faltando || []).indexOf('preco') >= 0 ? '—' : moeda(r.bruto)) : '';   // preço não lido: "—", nunca R$ 0,00
        if (r.desconto_vendedor) h += cl('Seu desconto', menos(r.desconto_vendedor));
        if (r.reembolso) h += cl('Reembolso ao cliente', menos(r.reembolso), 'mais');
        const pt = r.tarifas_por_tipo || {}, est = !!r.tarifas_estimadas || !!r.estimado;
        Object.keys(pt).filter(k => pt[k]).forEach(k => { h += cl(T.ROT_TARIFA[k] || k, menos(pt[k]), '', est); });
        if (!Object.keys(pt).length && r.status === 'nao_lido') h += `<div class="cl fora"><span>Tarifas: abra o pedido no Financeiro do TikTok</span><b>—</b></div>`;
        if (n(r.ads_no_repasse)) h += cl('Ads pago com o repasse', menos(r.ads_no_repasse), '', est);   // GMV Pay: o TikTok tira do repasse
        h += cl('Repasse do TikTok', moeda(r.repasse), 'tot', !!r.estimado);
        h += r.custo_rs === null || r.custo_rs === undefined ? `<div class="cl fora"><span>Custo do produto: informe no Catálogo</span><b>—</b></div>` : cl('Custo do produto', menos(r.custo_rs));
        if (r.outros_rs) h += cl('Embalagem e outros', menos(r.outros_rs));
        if (r.imposto_rs) h += cl('Imposto (' + String(r.imposto_pct).replace('.', ',') + '%)', menos(r.imposto_rs));
        const adsFora = n(r.ads_rs) !== null ? Math.round((r.ads_rs - (n(r.ads_no_repasse) || 0)) * 100) / 100 : 0;   // Ads fora do repasse (rateado)
        if (adsFora) h += cl('Ads', menos(adsFora));
        if (n(r.lucro_real) !== null) h += cl(r.lucro_real < 0 ? 'Prejuízo' : 'Lucro', moeda(r.lucro_real), 'tot' + (r.lucro_real < 0 ? ' mais' : ' est'));
        return `<div class="conta-ped">${h}</div>`;
    }
    function linhaPedido(r) {
        const it = (r.itens || [])[0] || {};
        const sub = [ddmm(r.dia), canal(r.canal_venda), 'repasse ' + moeda(r.repasse), r.status_repasse === 'a_liberar' ? 'a liberar' : ''].filter(Boolean).join(' · ');
        return `<details class="tt-ped" data-k="ped:${esc(r.pedido_id)}"><summary><span class="rlt"><b>${esc(it.titulo || 'Pedido')}</b><span class="sobra ${sobraCls(r)}">${esc(sobraTxt(r))}</span></span>`
            + `<small>${esc(sub)} · nº ${esc(String(r.pedido_id || '').slice(-6))}</small></summary>${contaHtml(r)}</details>`;
    }
    T.linhaPedido = linhaPedido;   // 3.3.0 (revisão): o lucro de cada pedido na Conciliação do filtro TikTok (painel-lateral.js, concTtHtml)
    function linhaProduto(p, sem) {
        const cs = Object.keys(p.canais || {}).map(c => canal(c) + ' ' + p.canais[c]).join(', '), falta = sem.has(p.sku);
        const sub = [p.sku_vendedor ? 'SKU ' + p.sku_vendedor : 'sem SKU ligado'].concat(p.pedidos ? [qtd(p.unidades || 0, 'unidade', 'unidades'), 'receita ' + moeda(p.receita), 'repasse ' + moeda(p.repasse),
            n(p.afiliado_pct) !== null ? 'afiliado ' + pct(p.afiliado_pct) : ''] : [], [cs]).filter(Boolean).join(' · ');
        const cls = p.pedidos ? (p.lucro_real < 0 ? 'prejuizo' : 'lucrativo') : 'sem_custo';
        const res = p.pedidos ? (p.lucro_real < 0 ? 'Prejuízo ' + moeda(-p.lucro_real) : 'Lucro ' + moeda(p.lucro_real)) + (n(p.margem_pct) !== null ? ' (' + pct(p.margem_pct) + ')' : '') : 'sem custo';
        const campo = falta && p.sku_id ? `<div class="sim"><label for="ttc-${esc(p.sku_id)}">Custo por unidade</label><input class="inp" id="ttc-${esc(p.sku_id)}" data-tt-custo="${esc(p.sku_id)}" inputmode="decimal" placeholder="R$"><button class="bt pq" data-tt-salvar="${esc(p.sku_id)}">Salvar</button></div>` : '';
        return `<div class="linha-comp"><span class="rlt"><b>${esc(p.titulo || p.sku_vendedor || 'Produto')}</b><span class="sobra ${cls}">${esc(res)}</span></span><small>${esc(sub)}</small>`
            + (p.pendentes ? `<small>${esc(qtd(p.pendentes, 'pedido fora da conta (sem custo ou não lido)', 'pedidos fora da conta (sem custo ou não lidos)'))}</small>` : '') + campo + '</div>';
    }

    /** vm = SHC.tt.resumo(…). o = {hoje:'AAAA-MM-DD', abertos: Set de data-k dos <details> abertos (o redesenho não fecha o que ela abriu)}. */
    T.html = function (vm, o) {
        o = o || {};
        const abertos = o.abertos || new Set(), hoje = o.hoje || hojeDe(Date.now()), desde = menosDias(hoje, 29);
        const abre = h => h.replace(/<details class="([^"]+)" data-k="([^"]+)">/g, (m, c, k) => (abertos.has(k) ? `<details class="${c}" data-k="${k}" open>` : m));
        if (!vm || vm.vazio) return `<div class="card tt-vazio"><div class="ch"><h3>TikTok Shop</h3></div><p class="rs">${esc(T.VAZIO)}</p>`
            + '<p class="det">O Copiloto só lê o que a própria tela do TikTok já mostrou. Não faz chamadas e não muda nada na sua loja.</p>'
            + '<div class="acoes" style="justify-content:flex-start"><button class="bt verde" data-tt-abrir>Abrir o Financeiro do TikTok Shop</button></div></div>';
        const k = vm.kpis || {}, al = T.alertas(vm, hoje), cor = COR[k.classe] || '';
        const fato = n(k.lucro_30d) === null ? (k.pedidos_30d ? 'Pedidos do TikTok lidos.' : 'Nenhum pedido do TikTok nos últimos 30 dias.')
            : (k.lucro_30d < 0 ? 'Prejuízo de ' + moeda(-k.lucro_30d) : 'Lucro de ' + moeda(k.lucro_30d)) + ' em 30 dias no TikTok.';
        let h = `<p class="manchete"><span class="pt ${al.some(a => a.c === 'pr') ? 'pr' : al.some(a => a.c === 'at') ? 'at' : 'ok'}"></span><b>${esc(fato)}</b> ${esc(al.length ? al[0].tit + '.' : 'Nada pede sua atenção agora.')}</p>`
            + `<div class="kpis k4">${kpi(cor, 'Lucro 30 dias', moeda(k.lucro_30d), esc(qtd(k.pedidos_30d || 0, 'pedido', 'pedidos') + (k.sem_custo ? ' · ' + k.sem_custo + ' sem custo' : '') + (k.estimados ? ' · ' + k.estimados + ' estimado' + (k.estimados > 1 ? 's' : '') : '')))}`
            + kpi(cor, 'Margem', pct(k.margem_pct), 'sobre a receita') + kpi('', 'A receber', moeda(k.a_receber), 'ainda não liberado') + kpi('', 'Saldo disponível', moeda(k.saldo), 'para sacar no TikTok') + '</div>';
        if (al.length) h += card('Precisa de você', '', '<ul class="acoes">' + al.map(a => `<li class="acao ${a.c}"><div class="tx"><b>${esc(a.tit)}</b><span>${esc(a.sub)}</span></div></li>`).join('') + '</ul>');

        // Pedidos (30 dias; os 8 mais novos à vista, o resto em "Ver todos")
        const mes = (vm.pedidos || []).filter(r => r.dia && r.dia >= desde && r.dia <= hoje), maisNovo = mes.reduce((m, r) => (r.lido_em > (m.lido_em || 0) ? r : m), {});
        h += card('Pedidos', lidoTxt(maisNovo), mes.length ? '<p class="rs">Toque no pedido para ver a conta: tarifas, repasse, custo e lucro.</p>' + mes.slice(0, 8).map(linhaPedido).join('')
            + (mes.length > 8 ? `<details class="tt-mais" data-k="mais:ped"><summary class="lnk">Ver todos (${mes.length})</summary>${mes.slice(8).map(linhaPedido).join('')}</details>` : '')
            : pede('o Financeiro'));
        const sem = T.semCusto(vm);
        h += card('Produtos', lidoTxt(maisNovo), (vm.produtos || []).length ? vm.produtos.map(p => linhaProduto(p, sem)).join('')
            + '<p class="det">Custo: o mesmo que você já cadastrou pelo SKU. Produto sem SKU ligado: abra um pedido dele no TikTok ou informe o custo aqui.</p>' : pede('o Financeiro'));

        // Repasse: a receber por motivo, saldo, conciliação (esperado × recebido), linha do tempo e extratos com ✓ / não fecha.
        const rp = vm.repasse || {}, ar = rp.a_receber, c = vm.conciliacao || {}, ex = T.extratos(vm);
        let r = ar ? `<table class="tb"><tbody>${(ar.motivos || []).filter(m => n(m.valor) > 0).map(m => `<tr><td>${esc(T.ROT_MOTIVO[motivo(m)] || m.titulo || 'Outro motivo')}</td><td><b>${moeda(m.valor)}</b></td></tr>`).join('')}`
            + `<tr><td><b>A receber</b></td><td><b>${moeda(ar.total)}</b></td></tr>${rp.saldo ? `<tr><td>Saldo disponível</td><td><b>${moeda(rp.saldo.valor)}</b></td></tr>` : ''}</tbody></table>` : pede('o Financeiro (Visão geral)');
        if (n(c.recebido) !== null || n(c.a_liberar) !== null) r += `<p class="rs">Recebido: <b>${moeda(c.recebido)}</b> · a liberar: <b>${moeda(c.a_liberar)}</b>${n(c.diferenca) && Math.abs(c.diferenca) > 0.05 ? ` · diferença do esperado: <b class="rv pr">${moeda(c.diferenca)}</b>` : ''}</p>`;
        const lt = (rp.linha_do_tempo || []).filter(x => /^\d{4}/.test(x.dia));
        if (lt.length) r += `<p class="det">Previsto: ${esc(lt.slice(0, 4).map(x => ddmm(x.dia) + ' ' + moeda(x.valor)).join(' · '))}${lt.length > 4 ? ' …' : ''}</p>`;
        if (ex.length) r += `<details class="tt-mais" data-k="mais:ext"><summary class="lnk">Extratos (${ex.length}${ex.some(e => e.naoFecha) ? ', ' + ex.filter(e => e.naoFecha).length + ' não fecha' + (ex.filter(e => e.naoFecha).length > 1 ? 'm' : '') : ''})</summary>`
            + '<table class="tb"><thead><tr><th>Extrato</th><th>Valor</th><th>Confere</th></tr></thead><tbody>'
            + ex.map(e => `<tr><td>${esc(ddmm(e.data_liberada || e.data_prevista) || '—')}<span class="sm">${e.status === 'disponivel' ? 'pago' : 'aguardando'}${e.pedidos_lidos ? ' · ' + qtd(e.pedidos_lidos, 'pedido lido', 'pedidos lidos') : ''}</span></td><td>${moeda(e.valor)}</td>`
                + `<td>${e.naoFecha ? '<span class="selo pr">não fecha</span>' + (e.completo ? `<span class="sm">pedidos somam ${moeda(e.soma_pedidos)}</span>` : '') : '<span class="selo ok">✓</span>' + (e.pedidos_lidos && !e.completo ? '<span class="sm">faltam pedidos para conferir um a um</span>' : '')}</td></tr>`).join('')
            + '</tbody></table></details>';
        h += card('Repasse', lidoTxt(ar), r);

        // Saúde
        const s = vm.saude || {}, ind = (s.itens || []).filter(i => i.indicador !== 'prazo_repasse_dias'), temS = ind.length || s.violacoes || s.aviso_d3;
        h += card('Saúde', lidoTxt(s.lido_em, 'Saúde da conta'), temS ? (ind.length ? '<table class="tb"><tbody>' + ind.map(i => `<tr><td>${esc(T.ROT_SAUDE[i.indicador] || i.titulo)}<span class="sm">meta ${i.direcao === 'maior_melhor' ? '≥' : '≤'} ${pct(n(i.meta) === null ? null : i.meta * 100)}</span></td><td><b class="rv ${T.fora(i) ? 'pr' : 'ok'}">${pct(n(i.valor) === null ? null : i.valor * 100)}</b></td></tr>`).join('') + '</tbody></table>' : '')
            + (s.violacoes ? `<p class="rs">Pontos de violação: <b>${esc(s.violacoes.pontos)}</b>${n(s.violacoes.faixa_baixo_risco) !== null && s.violacoes.pontos < s.violacoes.faixa_baixo_risco ? ' (risco baixo)' : ''}</p>` : '')
            + (s.aviso_d3 ? `<p class="det">${esc(ptBR(s.aviso_d3))}.</p>` : '') : pede('a Saúde da conta'));

        // Afiliados
        const af = vm.afiliados || {}, pend = af.pendencias;
        h += card('Afiliados', lidoTxt(pend) || lidoTxt(maisNovo), (af.pedidos_com_detalhe ? `<p class="rs">Comissão paga em 30 dias: <b>${moeda(af.comissao_rs)}</b> (${pct(af.comissao_pct)} da venda, em ${qtd(af.pedidos_com_detalhe, 'pedido aberto', 'pedidos abertos')} no Financeiro)</p>`
            : '<p class="det">Abra um pedido no Financeiro do TikTok para ver a comissão de afiliado.</p>')
            + (pend ? `<p class="rs">${esc(Object.keys(T.ROT_AFIL).map(m => { const v = afilNum(vm, m); return v === null ? '' : v + ' ' + T.ROT_AFIL[m]; }).filter(Boolean).join(' · '))}</p>` : pede('a página de Afiliados')));

        // Campanha aberta (sem botão de inscrever: entrar é com ela, no TikTok)
        const ab = T.abertas(vm, hoje);
        if (ab.length) h += card(ab.length > 1 ? 'Campanhas abertas' : 'Campanha aberta', lidoTxt(vm.campanhas), ab.map(x => `<div class="linha-comp"><b>${esc(x.titulo)}</b><small>${esc([x.inscricao_ate ? 'inscrição até ' + ddmm(x.inscricao_ate) : '', x.fim ? 'vai até ' + ddmm(x.fim) : '', 'você não entrou'].filter(Boolean).join(' · '))}</small></div>`).join('')
            + '<p class="det">Entrar na campanha é com você, no TikTok.</p>');
        return abre(h) + '<p class="det">O Copiloto só lê o que a própria tela do TikTok já mostrou. Não faz chamadas e não muda nada na sua loja.</p>';
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = T;
})(typeof globalThis !== 'undefined' ? globalThis : this);
