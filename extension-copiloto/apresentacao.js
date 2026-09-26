// SellerHub Copiloto — "Conheça o Copiloto" (abre na instalação, antes das boas-vindas; e por "Conheça o Copiloto" em Ajustes).
// Só navegação: "Começar" abre as boas-vindas (painel.html#bem-vindo); o suporte é o WhatsApp de SHC.SUPORTE_WHATSAPP.
(function () {
    'use strict';
    const SHC = globalThis.SHC || {};
    const A = {};
    A.URL_COMECAR = 'painel.html#bem-vindo';
    if (typeof module !== 'undefined' && module.exports) module.exports = A;
    if (typeof document === 'undefined') return;
    ['suporteZap', 'suporteZap2'].forEach(id => { const a = document.getElementById(id); if (a) a.href = SHC.SUPORTE_WHATSAPP; });
    ['comecar', 'comecar2'].forEach(id => { const b = document.getElementById(id); if (b) b.addEventListener('click', () => { location.href = A.URL_COMECAR; }); });
})();
