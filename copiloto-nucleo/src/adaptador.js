// copiloto-nucleo · interface de adaptador de canal. Todo canal entrega o MESMO objeto; o método que o canal não tem fica de fora e
// o painel diz "este canal não informa X". A leitura nunca lança para o painel: vira { status: 'ok' | 'nao_lido' | 'nao_informa' }.
(function (root, fabrica) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = fabrica(require('./modelo'));
    else { const CN = root.CopilotoNucleo = root.CopilotoNucleo || {}; CN.adaptador = fabrica(CN.modelo); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M) {
    'use strict';

    /** método → entidade que ele devolve (para validar) e o nome que o painel mostra. */
    const METODOS = {
        pedidos: { entidade: 'pedido', nome: 'os pedidos' },
        tarifas: { entidade: 'tarifa', nome: 'as tarifas por pedido' },
        repasses: { entidade: 'repasse', nome: 'os repasses' },
        fretes: { entidade: 'frete', nome: 'o frete por pedido' },
        devolucoes: { entidade: 'devolucao', nome: 'as devoluções' },
        ads: { entidade: 'ads', nome: 'o gasto com anúncios' },
        afiliados: { entidade: 'afiliado', nome: 'as comissões de afiliados' },
        promocoes: { entidade: 'promocao', nome: 'as promoções' },
        listings: { entidade: 'listing', nome: 'os anúncios' },
        saude: { entidade: 'saude', nome: 'a saúde da conta' },
    };
    const MODOS = ['tela', 'api', 'erp', 'manual'];

    /**
     * def = { id (canal), nome, hosts: [RegExp|texto] (telas lidas SÓ de forma passiva), fonte: {metodo: 'tela'|'api'|…},
     *         tarifa: linhas da tabela (tarifas.TABELA do canal), avisos_regra: [texto], pedidos(janela)…saude(janela) }
     * Lança Error se a definição estiver errada (erro de programação, não de leitura).
     */
    function criarAdaptador(def) {
        if (!def || M.CANAIS.indexOf(def.id) < 0) throw new Error('adaptador: id de canal inválido (' + (def && def.id) + ')');
        if (!def.nome) throw new Error('adaptador ' + def.id + ': falta nome');
        if (!Array.isArray(def.hosts)) throw new Error('adaptador ' + def.id + ': hosts precisa ser lista');
        Object.keys(METODOS).forEach(m => {
            if (def[m] !== undefined && typeof def[m] !== 'function') throw new Error('adaptador ' + def.id + ': ' + m + ' precisa ser função');
            if (typeof def[m] === 'function' && def.fonte && def.fonte[m] && MODOS.indexOf(def.fonte[m]) < 0) throw new Error('adaptador ' + def.id + ': fonte.' + m + ' inválida');
        });
        const a = Object.assign({}, def, { fonte: def.fonte || {}, tarifa: def.tarifa || [], avisos_regra: def.avisos_regra || [] });
        a.informa = m => typeof def[m] === 'function';
        a.naoInforma = m => (METODOS[m] ? 'Este canal não informa ' + METODOS[m].nome + '.' : 'Este canal não informa ' + m + '.');
        a.hostLido = host => a.hosts.some(h => (h instanceof RegExp ? h.test(host) : h === host));
        /**
         * Lê um método com rede de segurança → { status, dados, rejeitados, motivo, texto }.
         * 'nao_informa' = o canal não tem esse dado; 'nao_lido' = falhou (NUNCA vira lista vazia); 'ok' = dados validados
         * (registro inválido vai para rejeitados, com os erros, e não entra na conta).
         */
        a.ler = async function (m, janela) {
            if (!METODOS[m]) return { status: 'nao_informa', dados: [], rejeitados: [], texto: a.naoInforma(m) };
            if (!a.informa(m)) return { status: 'nao_informa', dados: [], rejeitados: [], texto: a.naoInforma(m) };
            let r;
            try { r = await def[m].call(a, janela || {}); } catch (e) { return { status: 'nao_lido', dados: [], rejeitados: [], motivo: String((e && e.message) || e) }; }
            if (M.ehNaoLido(r)) return { status: 'nao_lido', dados: [], rejeitados: [], motivo: r.motivo };
            if (!Array.isArray(r)) return { status: 'nao_lido', dados: [], rejeitados: [], motivo: m + ' não devolveu lista' };
            const ent = METODOS[m].entidade, dados = [], rejeitados = [];
            r.forEach(x => { const erros = M.validar(ent, x); if (erros.length) rejeitados.push({ registro: x, erros }); else dados.push(x); });
            return { status: 'ok', dados, rejeitados };
        };
        /** O que este canal informa e o que não: [{metodo, informa, fonte, texto}] — para o painel. */
        a.cobertura = () => Object.keys(METODOS).map(m => ({ metodo: m, informa: a.informa(m), fonte: a.fonte[m] || null, texto: a.informa(m) ? '' : a.naoInforma(m) }));
        return a;
    }

    /** Registro de canais: { ml: adaptador, tiktok: adaptador, … } (o SHC.canais do Copiloto). */
    function registrar(registro, adaptador) {
        if (!adaptador || typeof adaptador.ler !== 'function') throw new Error('registrar: passe um adaptador criado por criarAdaptador');
        registro[adaptador.id] = adaptador;
        return registro;
    }

    return { METODOS, criarAdaptador, registrar };
});
