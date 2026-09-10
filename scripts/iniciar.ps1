# Sobe o dashboard e abre o navegador SOMENTE quando o servidor responder.
#
# POR QUE ESPERAR ANTES DE ABRIR: o `next dev` leva ~12 s para ficar pronto. Abrir
# o navegador antes disso da "ERR_CONNECTION_REFUSED": a tela em branco que
# assusta e parece que o projeto quebrou, quando so faltou esperar.
#
# POR QUE E IDEMPOTENTE: se o servidor ja estiver no ar, so abre o navegador. Sem
# isso, um segundo duplo-clique tentaria subir outro servidor na mesma porta e
# morreria com EADDRINUSE, que tambem parece defeito.
#
# O SERVIDOR RODA SEM JANELA, e isso e uma correcao de um erro anterior.
#
# A primeira versao abria o servidor numa janela de console visivel, para ter os
# logs a mao. Na pratica aquilo era um botao de desligar disfarcado: uma janela
# preta cheia de texto tecnico da vontade de fechar para arrumar a tela, e fechar
# derruba o dashboard. O usuario perdeu o acesso duas vezes assim, e nas duas o
# sintoma foi "ERR_CONNECTION_REFUSED", que nao parece nada com "fechei a janela".
#
# Agora o processo nao tem janela para fechar por acidente, os logs vao para
# dev-server.log (nao se perdem, ficam consultaveis depois) e desligar e um ato
# explicito: o atalho "Desligar Dashboard".

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$porta = 3000
$url = "http://localhost:$porta/"
$log = Join-Path $raiz 'dev-server.log'
$logAnterior = Join-Path $raiz 'dev-server.anterior.log'

function Responde {
    try {
        Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop | Out-Null
        return $true
    } catch {
        # 401 e SUCESSO aqui: significa que o servidor esta no ar e pediu senha.
        # Tratar 401 como falha faria o script esperar 120 s e desistir de um
        # servidor que estava funcionando perfeitamente.
        $r = $_.Exception.Response
        if ($r -and [int]$r.StatusCode -eq 401) { return $true }
        return $false
    }
}

Write-Host ""
Write-Host "  Dashboard Manutencao FTTX" -ForegroundColor Cyan
Write-Host "  -------------------------"
Write-Host ""

if (Responde) {
    Write-Host "  Servidor ja estava no ar. Abrindo o navegador." -ForegroundColor Green
    Start-Process $url
    Start-Sleep -Seconds 2
    exit 0
}

# Se o projeto veio de um backup, node_modules nao vem junto (esta no .gitignore).
# Sem este passo o `next dev` falha com "next nao encontrado" e nao fica claro por que.
if (-not (Test-Path "$raiz\node_modules")) {
    Write-Host "  Dependencias ausentes. Instalando (demora alguns minutos)..." -ForegroundColor Yellow
    Push-Location $raiz
    try { & npm install } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  npm install falhou. Nada foi iniciado." -ForegroundColor Red
        Read-Host "  Enter para fechar"
        exit 1
    }
}

if (-not (Test-Path "$raiz\.env")) {
    Write-Host "  Falta o arquivo .env (credenciais dos bancos)." -ForegroundColor Red
    Write-Host "  Ele NAO vai no backup, por seguranca. Copie de .env.example e preencha."
    Read-Host "  Enter para fechar"
    exit 1
}

# GUARDA O LOG DA EXECUCAO ANTERIOR.
#
# O redirecionamento `>` sobrescreve o log a cada partida, e isso apagava
# justamente a evidencia que interessa: quando o servidor cai sozinho, quem
# reinicia destroi o motivo da queda no mesmo gesto. Aconteceu tres vezes e nas
# tres o log tinha so a subida nova, com zero erros.
#
# Uma geracao basta: o que se quer saber e "por que morreu da ultima vez", nao o
# historico do mes. E nao cresce sem limite, que seria o defeito do `>>`.
if (Test-Path $log) { Move-Item -Path $log -Destination $logAnterior -Force }

Write-Host "  Iniciando o servidor..." -ForegroundColor Yellow

# -WindowStyle Hidden com processo PROPRIO (nao -NoNewWindow): se o servidor
# herdasse este console, ele morreria junto quando esta janela fechasse, que e
# exatamente o problema que estamos corrigindo.
Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/c', "npm run dev > `"$log`" 2>&1" `
    -WorkingDirectory $raiz `
    -WindowStyle Hidden

Write-Host "  Aguardando ficar pronto (normalmente 15 s)..." -NoNewline
$pronto = $false
foreach ($i in 1..90) {
    if (Responde) { $pronto = $true; break }
    Start-Sleep -Seconds 1
    if ($i % 3 -eq 0) { Write-Host "." -NoNewline }
}
Write-Host ""

if (-not $pronto) {
    Write-Host ""
    Write-Host "  O servidor nao respondeu em 90 s." -ForegroundColor Red
    Write-Host ""
    # Sem janela visivel, o log e a UNICA fonte do erro real. Mostrar as ultimas
    # linhas aqui evita que a pessoa fique sem nenhuma informacao sobre a falha.
    if (Test-Path $log) {
        Write-Host "  Ultimas linhas de dev-server.log:" -ForegroundColor Yellow
        Get-Content $log -Tail 15 | ForEach-Object { Write-Host "    $_" }
        Write-Host ""
        Write-Host "  Mande essas linhas para quem for diagnosticar."
        if (Test-Path $logAnterior) {
            Write-Host ""
            Write-Host "  O log da execucao ANTERIOR esta em dev-server.anterior.log"
        }
    } else {
        Write-Host "  O log nao foi criado: o npm nao chegou a iniciar."
    }
    Read-Host "  Enter para fechar"
    exit 1
}

Write-Host ""
Write-Host "  Pronto. Abrindo $url" -ForegroundColor Green
Write-Host ""
Write-Host "  As primeiras telas levam alguns segundos: o Next compila sob demanda"
Write-Host "  e o cache comeca vazio. Voce vera os esqueletos cinzas carregando."
Write-Host ""
Write-Host "  O servidor roda em segundo plano. Nao ha janela para fechar." -ForegroundColor Cyan
Write-Host "  Para desligar, use o atalho 'Desligar Dashboard'."
Write-Host "  Os logs ficam em dev-server.log; o da subida anterior, em"
Write-Host "  dev-server.anterior.log. Ambos na pasta do projeto."
Write-Host ""
Start-Process $url
Start-Sleep -Seconds 4
