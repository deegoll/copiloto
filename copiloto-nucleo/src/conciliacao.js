// copiloto-nucleo · conciliação pedido × repasse: o que o canal DEVIA pagar (repasse calculado pelo motor) × o que pagou.
(function (root, fabrica) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = fabrica(require('./util'), require('./modelo'), require('./tarifas'), require('./motor'));
    else { const CN = root.CopilotoNucleo = root.CopilotoNucleo || {}; CN.conciliacao = fabrica(CN.util, CN.modelo, CN.tarifas, CN.motor); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (U, M, T, MO) {
    'use strict';

    const LIBERADO = ['disponivel', 'sacado'];
    /** Status possíveis de cada pedido na conciliação. */
    const STATUS = ['ok', 'a_menor', 'a_maior', 'parcial', 'a_liberar', 'retido', 'aguardando', 'aguardando_entrega', 'atrasado', 'sem_prazo',
        'cancelado', 'agrupado', 'nao_lido'];

    function dedupe(repasses) {
        const vistos = new Set(), out = [];
        (repasses || []).forEach(r => {
            if (!r || M.ehNaoLido(r)) return;
            const k = r.canal + '|' + r.conta + '|' + r.id;
            if (vistos.has(k)) return;
            vistos.add(k); out.push(r);
        });
        return out;
    }

    /**
     * o = { pedidos: Pedido[], tarifas: Tarifa[] | naoLido, repasses: Repasse[] | naoLido, devolucoes?: Devolucao[],
     *       hoje: 'AAAA-MM-DD', tolerancia: 0.05 (R$), prazo_dias: {tiktok: 7} (sobrepõe o prazo padrão do canal) }
     * → { pedidos: [{ pedido_id, status, esperado, recebido, a_liberar, diferenca, data_prevista, repasses: [ids], motivo }],
     *     grupos: [{ repasse_id, pedidos, esperado, recebido, diferenca, status }], sem_pedido: Repasse[],
     *     totais: { esperado, recebido, a_liberar, diferenca, por_status: {status: n} } }   (sem nenhum pedido: esperado/recebido/a_liberar/diferenca null)
     * Repasse com vários pedidos e sem por_pedido é conciliado pelo GRUPO (os pedidos ficam 'agrupado').
     */
    function conciliar(o) {
        o = o || {};
        const hoje = U.dia(o.hoje) || U.hoje(), tol = o.tolerancia >= 0 ? o.tolerancia : 0.05;
        const repNaoLido = M.ehNaoLido(o.repasses), reps = repNaoLido ? [] : dedupe(o.repasses);
        const pedidos = (o.pedidos || []).filter(p => p && !M.ehNaoLido(p));
        const ids = new Set(pedidos.map(p => p.id));
        const porPedido = {}, grupos = [], semPedido = [];
        reps.forEach(r => {
            const ps = (r.pedidos || []).filter(id => ids.has(id));
            if (!ps.length) { semPedido.push(r); return; }
            if (r.por_pedido && typeof r.por_pedido === 'object') {
                ps.forEach(id => { if (typeof r.por_pedido[id] === 'number') (porPedido[id] = porPedido[id] || []).push({ r, valor: r.por_pedido[id] }); });
            } else if (r.pedidos.length === 1) (porPedido[ps[0]] = porPedido[ps[0]] || []).push({ r, valor: r.valor });
            else grupos.push({ r, pedidos: ps });
        });
        const noGrupo = new Map();
        grupos.forEach(g => g.pedidos.forEach(id => noGrupo.set(id, g.r.id)));

        const esperados = {};
        const linhas = pedidos.map(p => {
            const res = MO.lucroPedido(p, { tarifas: o.tarifas, devolucoes: o.devolucoes });
            const esperado = res.repasse;   // null = tarifas não lidas
            esperados[p.id] = esperado;
            const ls = porPedido[p.id] || [];
            const lib = ls.filter(x => LIBERADO.indexOf(x.r.status) >= 0), pend = ls.filter(x => LIBERADO.indexOf(x.r.status) < 0);
            const recebido = lib.length ? U.soma(lib, x => x.valor) : null, aLiberar = pend.length ? U.soma(pend, x => x.valor) : null;
            const prevLinha = ls.map(x => x.r.data_prevista).filter(Boolean).sort().pop() || null;
            const prevista = prevLinha || T.dataPrevistaRepasse(p.canal, p.data_entrega, o.prazo_dias && o.prazo_dias[p.canal]);
            const out = { pedido_id: p.id, canal: p.canal, conta: p.conta, esperado, recebido, a_liberar: aLiberar, diferenca: null, data_prevista: prevista,
                repasses: ls.map(x => x.r.id), motivo: '' };
            if (noGrupo.has(p.id) && !ls.length) { out.status = 'agrupado'; out.grupo = noGrupo.get(p.id); return out; }
            if (esperado === null || repNaoLido) { out.status = 'nao_lido'; out.motivo = repNaoLido ? 'repasses não lidos' : 'tarifas não lidas'; return out; }
            if (lib.length) {
                out.diferenca = U.r2(recebido - esperado);
                if (Math.abs(out.diferenca) <= tol) out.status = 'ok';
                else if (out.diferenca < 0 && pend.length) out.status = 'parcial';
                else out.status = out.diferenca < 0 ? 'a_menor' : 'a_maior';
                return out;
            }
            if (pend.length) {
                const retido = pend.find(x => x.r.status === 'retido');
                out.status = retido ? 'retido' : 'a_liberar';
                out.motivo = (retido || pend[0]).r.motivo || '';
                out.diferenca = U.r2(aLiberar - esperado);   // diferença PREVISTA (valores "Est." podem mudar até liquidar)
                return out;
            }
            if (p.status === 'cancelado' && Math.abs(esperado) <= tol) { out.status = 'cancelado'; return out; }
            if (!prevista) out.status = p.data_entrega || p.status === 'entregue' ? 'sem_prazo' : 'aguardando_entrega';
            else out.status = hoje > prevista ? 'atrasado' : 'aguardando';
            return out;
        });

        const gruposOut = grupos.map(g => {
            const es = g.pedidos.map(id => esperados[id]);
            const esperado = es.some(v => v === null || v === undefined) ? null : U.soma(es);
            const liberado = LIBERADO.indexOf(g.r.status) >= 0, diferenca = esperado === null ? null : U.r2(g.r.valor - esperado);
            return { repasse_id: g.r.id, pedidos: g.pedidos, esperado, recebido: liberado ? g.r.valor : null, a_liberar: liberado ? null : g.r.valor, diferenca,
                status: esperado === null ? 'nao_lido' : (!liberado ? (g.r.status === 'retido' ? 'retido' : 'a_liberar') : (Math.abs(diferenca) <= tol ? 'ok' : (diferenca < 0 ? 'a_menor' : 'a_maior'))) };
        });

        const porStatus = {};
        linhas.forEach(l => { porStatus[l.status] = (porStatus[l.status] || 0) + 1; });
        const soLidos = linhas.filter(l => l.esperado !== null && l.status !== 'agrupado');
        const nada = !linhas.length;   // nenhum pedido para conciliar: os totais são desconhecidos (null), nunca "Recebido R$ 0,00" inventado
        const tot = v => (nada ? null : U.r2(v));
        return {
            pedidos: linhas, grupos: gruposOut, sem_pedido: semPedido,
            totais: {
                esperado: tot(U.soma(soLidos, l => l.esperado) + U.soma(gruposOut, g => g.esperado)),
                recebido: tot(U.soma(linhas, l => l.recebido) + U.soma(gruposOut, g => g.recebido)),
                a_liberar: tot(U.soma(linhas, l => l.a_liberar) + U.soma(gruposOut, g => g.a_liberar)),
                diferenca: tot(U.soma(linhas, l => (l.status === 'ok' || l.status === 'a_menor' || l.status === 'a_maior' || l.status === 'parcial') ? l.diferenca : 0)
                    + U.soma(gruposOut, g => (g.recebido !== null ? g.diferenca : 0))),
                por_status: porStatus,
                repasses_nao_lidos: repNaoLido,
            },
        };
    }

    /**
     * Visão por mês quando o canal não liga o repasse ao pedido (ML × Mercado Pago): Σ repasse esperado dos pedidos (mês da venda)
     * × Σ repasses liberados (mês da liberação). As datas são diferentes: serve para ver tendência, não para cobrar diferença.
     * → { 'AAAA-MM': { esperado, recebido, diferenca, pedidos_nao_lidos } }
     */
    function conciliarPorMes(resultados, repasses) {
        const out = {}, m = k => out[k] || (out[k] = { esperado: 0, recebido: 0, diferenca: 0, pedidos_nao_lidos: 0 });
        (resultados || []).forEach(r => { const k = U.mes(r.data); if (!k) return; if (r.repasse === null || r.repasse === undefined) m(k).pedidos_nao_lidos++; else m(k).esperado = U.r2(m(k).esperado + r.repasse); });
        dedupe(repasses).forEach(r => { if (LIBERADO.indexOf(r.status) < 0) return; const k = U.mes(r.data_liberada); if (k) m(k).recebido = U.r2(m(k).recebido + r.valor); });
        Object.keys(out).forEach(k => { out[k].diferenca = U.r2(out[k].recebido - out[k].esperado); });
        return out;
    }

    return { STATUS, conciliar, conciliarPorMes };
});
