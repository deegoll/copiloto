// Roda todos os teste_*.js desta pasta e falha (exit 1) se algum rc!==0 ou não terminar em "TUDO OK".
// Provar que não depende da data: FAKE_DATE=2026-10-01T10:00:00-03:00 NODE_OPTIONS="--require ./relogio.js" node rodar_todos.js   (rodando nesta pasta)
// Uso: node rodar_todos.js
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const arquivos = fs.readdirSync(dir).filter(f => /^teste_.*\.js$/.test(f)).sort();

let falhas = [];
for (const f of arquivos) {
    process.stdout.write('── ' + f + ' ──\n');
    try {
        const out = execFileSync(process.execPath, [path.join(dir, f)], { encoding: 'utf8' });
        process.stdout.write(out);
        if (!/TUDO OK\s*$/.test(out)) falhas.push(f + ' (saiu com 0 sem terminar em TUDO OK)');
    } catch (e) {
        if (e.stdout) process.stdout.write(e.stdout);
        if (e.stderr) process.stderr.write(e.stderr);
        falhas.push(f);
    }
}

// Suíte do núcleo multicanal (copiloto-nucleo, node --test): núcleo vermelho = falha geral (o empacotar.ps1 não empacota).
// Aqui teste pulado também é falha: sem a extensão/fixtures as travas de paridade com o ML são puladas e o resto passaria verde.
process.stdout.write('── copiloto-nucleo (node rodar.js) ──\n');
const nucleo = spawnSync(process.execPath, [path.join(dir, '..', '..', 'copiloto-nucleo', 'rodar.js')], { encoding: 'utf8' });
process.stdout.write(nucleo.stdout || '');
if (nucleo.stderr) process.stderr.write(nucleo.stderr);
const pulados = /^\S+ skipped (\d+)\s*$/m.exec(nucleo.stdout || '');
if (nucleo.status !== 0) falhas.push('copiloto-nucleo (node rodar.js)');
else if (!pulados || +pulados[1] > 0) falhas.push('copiloto-nucleo (' + (pulados ? pulados[1] + ' teste(s) pulado(s)' : 'sem o resumo "skipped"') + ')');

console.log('\n==============================');
if (falhas.length) {
    console.log(falhas.length + ' arquivo(s) com falha: ' + falhas.join(', '));
    process.exit(1);
} else {
    console.log('TUDO OK · ' + arquivos.length + ' arquivos de teste passaram + a suíte do copiloto-nucleo.');
    process.exit(0);
}
