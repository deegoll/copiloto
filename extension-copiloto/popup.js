// SellerHub Copiloto — popup: calculadora rápida + atalhos.
(function () {
    'use strict';
    const SHC = globalThis.SHC;
    const $ = s => document.querySelector(s);
    let cfg = Object.assign({}, SHC.PADRAO);
    let canal = 'ml', tipo = 'classico';
    const pct = v => (v < 0 ? '−' : '') + String(Math.abs(Math.round(v * 10) / 10)).replace('.', ',') + '%';

    function calcula() {
        const preco = SHC.num($('#preco').value);
        const item = { custo: SHC.num($('#custo').value), frete: SHC.num($('#frete').value), tipo: tipo || undefined };
        const res = $('#res');
        res.className = 'res';
        if (!(preco > 0)) { res.textContent = 'Digite o preço e o custo.'; return; }
        const c = SHC.calcular(canal, preco, item, cfg);
        if (c.sobra_rs === null) {
            res.innerHTML = 'Você recebe <b>' + SHC.moeda(c.recebe_rs) + '</b> do ' + (canal === 'ml' ? 'Mercado Livre' : 'Shopee') + '.<br>Informe o custo para ver o que sobra.';
            return;
        }
        res.classList.add(c.classe);
        const pmin = SHC.precoMinimo(canal, item, cfg, 0);
        res.innerHTML = 'Sobra no final<div class="v">' + SHC.moeda(c.sobra_rs) + ' <span style="font-size:13px">(' + pct(c.sobra_pct) + ')</span></div>'
            + 'Comissão ' + SHC.moeda(c.comissao_rs) + (c.taxa_fixa_rs ? ' · taxa fixa ' + SHC.moeda(c.taxa_fixa_rs) : '')
            + ' · frete ' + SHC.moeda(c.frete_rs) + (c.imposto_rs ? ' · imposto ' + SHC.moeda(c.imposto_rs) : '')
            + (pmin ? '<br>Preço mínimo sem prejuízo: <b>' + SHC.moeda(pmin) + '</b>' : '')
            + (c.frete_desconhecido ? '<br>⚠ Acima de R$ 79 o frete é seu: informe quanto paga.' : '')
            + (c.tarifa_aviso ? '<br>⚠ ' + c.tarifa_aviso : '');
    }

    $('#seg').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        document.querySelectorAll('#seg button').forEach(x => x.classList.toggle('on', x === b));
        canal = b.getAttribute('data-c');
        tipo = b.getAttribute('data-t');
        calcula();
    });
    ['#preco', '#custo', '#frete'].forEach(s => $(s).addEventListener('input', calcula));
    const abrePainel = e => { if (e) e.preventDefault(); chrome.runtime.openOptionsPage(); window.close(); };
    $('#painel').addEventListener('click', abrePainel);
    $('#ajustar').addEventListener('click', abrePainel);

    SHC.lerTudo().then(d => {
        cfg = d.cfg;
        const n = Object.keys(d.custos).length;
        const vistos = Object.keys(d.vistos).filter(k => !d.custos[k]).length;
        $('#st').textContent = n
            ? n + ' produto(s) com custo informado' + (vistos ? ' · ' + vistos + ' visto(s) ainda sem custo' : '') + '.'
            : 'Nenhum custo ainda: abra suas promoções e clique em “＋ custo” no anúncio.';
        if (!cfg.configurado) $('#aviso').classList.add('on');
        if (cfg.ml_tipo_padrao === 'premium') $('#seg button[data-t="premium"]').click();
        calcula();
        $('#preco').focus();
    });
})();
