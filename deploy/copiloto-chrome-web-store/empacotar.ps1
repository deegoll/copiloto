# Monta o pacote da Chrome Web Store com uma lista FECHADA de arquivos.
# Para se faltar um arquivo da lista ou se aparecer na extensão um arquivo que não está nem na lista nem em $fora.
$ErrorActionPreference = 'Stop'
$ext = Resolve-Path "$PSScriptRoot\..\..\extension-copiloto"
# Antes de empacotar, todos os testes têm que passar (a pasta tests/ só existe nesta máquina).
$testes = "$PSScriptRoot\..\..\tests\copiloto\rodar_todos.js"
if (Test-Path $testes) {
    node $testes > $null
    if ($LASTEXITCODE -ne 0) { throw "Há teste falhando: rode 'node tests\copiloto\rodar_todos.js' e corrija antes de empacotar." }
}
$dentro = @('manifest.json', 'background.js', 'calc.js', 'store.js', 'xls.js', 'tiny.js', 'omie.js', 'bling.js', 'erp-cruzar.js', 'ml-extrator.js',
    'copiloto-ml.js', 'ml-tela.js', 'ml-tela.css', 'ml-canal.js', 'agenda-canal.html', 'agenda-canal.js',
    'painel.html', 'painel.js', 'painel-lateral.html', 'painel-lateral.js', 'tiktok-aba.js', 'ads.html', 'ads.js',
    'fechamento.html', 'fechamento.js', 'apresentacao.html', 'apresentacao.js', 'tour.js', 'icons',
    'tiktok.js', 'tiktok-pagina.js', 'tiktok-tela.js', 'nucleo', 'fundo')   # v3.2 TikTok: nucleo/ = cópia de copiloto-nucleo/src (teste_tiktok_nucleo.js confere)
# 02/10: fundo/ = o background.js dividido por assunto (o background.js ficou só o carregador; teste_fundo_dividido.js confere).
# 02/10: licenca.js e licenca-tela.js ("Entrar com o SellerHub") desligados e fora do pacote até o servidor entrar no ar.
# Religar: voltar os 2 para $dentro e devolver as referências (importScripts do fundo/01-carga-e-eventos.js e <script> do painel-lateral.html;
# o teste_pacote_licenca.js trava enquanto não for ajustado junto).
$fora = @('copiloto.js', 'popup.html', 'popup.js', 'MAPEAMENTO-ML.md', 'LOGISTICA-ML.md', '_teste', 'licenca.js', 'licenca-tela.js')

$faltam = $dentro | Where-Object { -not (Test-Path (Join-Path $ext $_)) }
if ($faltam) { throw "Faltam na extensão: $($faltam -join ', ')" }
$novos = Get-ChildItem $ext | Where-Object { $dentro -notcontains $_.Name -and $fora -notcontains $_.Name }
if ($novos) { throw "Arquivos fora da lista (decida se entram): $($novos.Name -join ', ')" }

$versao = (Get-Content (Join-Path $ext 'manifest.json') -Raw | ConvertFrom-Json).version
$zip = Join-Path $PSScriptRoot "copiloto-v$versao.zip"
# 07/10: versão com etiqueta já foi enviada à loja; refazer o zip apagaria o pacote guardado (e o SHA-256 do VERSOES.md).
$etiqueta = git -C $ext tag -l "copiloto-v$versao" 2>$null
if ($etiqueta) { throw "A versão $versao já foi publicada (etiqueta $etiqueta). Suba a versão no manifest.json antes de empacotar." }
$tmp = Join-Path $env:TEMP "copiloto-pacote-$versao"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory $tmp | Out-Null
$dentro | ForEach-Object { Copy-Item (Join-Path $ext $_) $tmp -Recurse }
# 3.2.1: icons/, nucleo/ e fundo/ entram inteiras: nada fora de .js .html .css .json .png (teste, .map, .env, .md, fixture) vai para a loja.
$estranhos = Get-ChildItem $tmp -Recurse -File -Force | Where-Object { '.js', '.html', '.css', '.json', '.png' -notcontains $_.Extension.ToLower() }
if ($estranhos) { Remove-Item $tmp -Recurse -Force; throw "Arquivo fora do padrão no pacote: $($estranhos.FullName -join ', ')" }
# Revisão de 02/10: em icons/ só entra .png (um icons/x.js ou x.json passava no filtro acima). nucleo/ é conferido arquivo a arquivo pelo teste_tiktok_nucleo.js.
$icones = Get-ChildItem (Join-Path $tmp 'icons') -Recurse -File -Force | Where-Object { $_.Extension.ToLower() -ne '.png' }
if ($icones) { Remove-Item $tmp -Recurse -Force; throw "Em icons/ só entra .png: $($icones.FullName -join ', ')" }
if (Test-Path $zip) { Remove-Item $zip -Force }
# tar do Windows (bsdtar) grava caminhos com "/"; o Compress-Archive do PowerShell 5.1 grava com "\" e a loja pode recusar.
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'   # o do Windows; o do Git (GNU) não grava .zip
& $tar -a -cf $zip -C $tmp @dentro
if ($LASTEXITCODE) { throw 'tar falhou' }
Remove-Item $tmp -Recurse -Force
& $tar -tf $zip
Write-Output "Pacote: $zip"
# Anote este hash no registro do envio à loja (fora deste disco): prova depois qual código foi enviado.
Write-Output "SHA-256: $((Get-FileHash $zip -Algorithm SHA256).Hash)"
