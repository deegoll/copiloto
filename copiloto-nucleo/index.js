// copiloto-nucleo — núcleo multi-marketplace do Copiloto (modelo único, motor de lucro, conciliação e adaptadores).
// Node:      const CN = require('copiloto-nucleo')   (ou require('./copiloto-nucleo'))
// Navegador: carregue os <script> na ordem de ORDEM_NAVEGADOR; tudo fica em window.CopilotoNucleo.
'use strict';
const util = require('./src/util');
const modelo = require('./src/modelo');
const tarifas = require('./src/tarifas');
const motor = require('./src/motor');
const conciliacao = require('./src/conciliacao');
const adaptador = require('./src/adaptador');
const ml = require('./src/adaptadores/ml');
const tiktok = require('./src/adaptadores/tiktok');
const shopee = require('./src/adaptadores/shopee');

module.exports = {
    versao: '0.1.0',
    ORDEM_NAVEGADOR: ['src/util.js', 'src/modelo.js', 'src/tarifas.js', 'src/motor.js', 'src/conciliacao.js', 'src/adaptador.js',
        'src/adaptadores/ml.js', 'src/adaptadores/tiktok.js', 'src/adaptadores/shopee.js'],
    util, modelo, tarifas, motor, conciliacao, adaptador,
    adaptadores: { ml, tiktok, shopee },
};
