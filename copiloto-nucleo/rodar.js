// Roda todos os testes: node rodar.js   (o mesmo que: node --test testes/*.test.js)
'use strict';
const { spawnSync } = require('child_process'), path = require('path'), fs = require('fs');
const dir = path.join(__dirname, 'testes');
const arquivos = fs.readdirSync(dir).filter(f => /\.test\.js$/.test(f)).map(f => path.join(dir, f));
const r = spawnSync(process.execPath, ['--test'].concat(arquivos), { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
