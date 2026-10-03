// Relógio dos testes: os retratos em fixtures/ são de 24-25/09/2026, então os testes não podem depender da data real.
//   require('./relogio').fixar();   → "agora" passa a ser 25/09/2026 12:00 (horário de Brasília), andando normalmente,
//                                      no Date do node e no Date de todo vm.createContext criado depois (menos os que
//                                      já recebem um Date próprio no sandbox).
// Para provar que a suíte não depende do dia em que roda, desloque o relógio "real" antes (o fixar() corrige por cima):
//   FAKE_DATE=2026-10-01T10:00:00-03:00 NODE_OPTIONS="--require ./relogio.js" node rodar_todos.js
const vm = require('vm');

const HOJE_TESTES = '2026-09-25T12:00:00-03:00';

// Troca o Date do realm por um que soma `delta` ms ao "agora" (new Date() sem argumentos, Date(), Date.now()).
// Vai como texto para rodar igual dentro de cada contexto vm (cada um tem o seu Date).
const TROCA = `(function (delta) {
    var O = Date;
    function D() {
        var a = Array.prototype.slice.call(arguments);
        if (!new.target) return new O(O.now() + delta).toString();
        return Reflect.construct(O, a.length ? a : [O.now() + delta], new.target);
    }
    D.prototype = O.prototype;
    Object.setPrototypeOf(D, O);
    D.now = function () { return O.now() + delta; };
    globalThis.Date = D;
})`;

let delta = 0;   // soma de todos os deslocamentos instalados neste processo

const cria = vm.createContext;
vm.createContext = function (sandbox, ...resto) {
    const ctx = cria.call(this, sandbox, ...resto);
    const temDate = sandbox && Object.prototype.hasOwnProperty.call(sandbox, 'Date');
    if (delta && !temDate) vm.runInContext(TROCA + '(' + delta + ')', ctx);
    return ctx;
};

function instalar(alvoMs) {
    if (!Number.isFinite(alvoMs)) throw new Error('relogio: data inválida');
    const d = alvoMs - Date.now();
    vm.runInThisContext(TROCA)(d);
    delta += d;
}

function fixar(iso) { instalar(Date.parse(iso || HOJE_TESTES)); }

if (process.env.FAKE_DATE) instalar(Date.parse(process.env.FAKE_DATE));

module.exports = { fixar, HOJE_TESTES };
