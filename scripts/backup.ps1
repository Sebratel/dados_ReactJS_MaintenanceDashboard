# Guarda o estado atual do projeto e envia a copia para o OneDrive.
#
# POR QUE EXISTE: sem isto, proteger o trabalho depende de alguem lembrar de
# rodar comandos de git. Um commit tosco com data no titulo protege mais que um
# historico bonito que ninguem escreveu.
#
# O QUE NAO VAI NO BACKUP: o .env, de proposito. Senha de banco nao sobe para a
# nuvem. Se a maquina morrer, o codigo volta inteiro e voce recria o .env a
# partir do .env.example: sao 12 linhas de credencial que a TI fornece de novo.

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$remoto = 'onedrive'

Write-Host ""
Write-Host "  Backup do Dashboard Manutencao FTTX" -ForegroundColor Cyan
Write-Host "  -----------------------------------"
Write-Host ""

Push-Location $raiz
try {
    # Confirmacao de que o .env continua fora do versionamento. Esta checagem
    # roda a CADA backup porque um .gitignore editado por engano so aparece aqui.
    & git check-ignore -q .env
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  PARADO: o .env NAO esta mais ignorado pelo git." -ForegroundColor Red
        Write-Host "  Backup cancelado para nao mandar senha de banco para a nuvem."
        Write-Host "  Verifique a primeira linha do .gitignore."
        Read-Host "  Enter para fechar"
        exit 1
    }

    $mudancas = & git status --porcelain
    if (-not $mudancas) {
        Write-Host "  Nada mudou desde o ultimo backup." -ForegroundColor Green
    } else {
        Write-Host "  Alteracoes encontradas:" -ForegroundColor Yellow
        $mudancas | ForEach-Object { Write-Host "    $_" }
        Write-Host ""

        & git add -A
        $quando = Get-Date -Format 'dd/MM/yyyy HH:mm'
        & git commit -q -m "Backup de $quando"
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  Falha ao gravar o commit." -ForegroundColor Red
            Read-Host "  Enter para fechar"
            exit 1
        }
        Write-Host "  Estado gravado." -ForegroundColor Green
    }

    $url = & git remote get-url $remoto 2>$null
    if (-not $url) {
        Write-Host "  Sem o remoto '$remoto'. A copia na nuvem nao foi feita." -ForegroundColor Red
        Read-Host "  Enter para fechar"
        exit 1
    }
    if (-not (Test-Path $url)) {
        Write-Host "  A pasta do backup nao existe: $url" -ForegroundColor Red
        Write-Host "  O OneDrive pode ter sido desconectado."
        Read-Host "  Enter para fechar"
        exit 1
    }

    Write-Host "  Enviando para o OneDrive..." -ForegroundColor Yellow
    & git push -q $remoto HEAD
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  O envio falhou. O commit local esta salvo, a copia na nuvem nao." -ForegroundColor Red
        Read-Host "  Enter para fechar"
        exit 1
    }

    $n = (& git -C $url rev-list --count HEAD)
    Write-Host ""
    Write-Host "  Backup concluido. $n versao(oes) guardada(s) no OneDrive." -ForegroundColor Green
    Write-Host "  O .env ficou de fora, como deve ser."
    Write-Host ""
} finally {
    Pop-Location
}

Start-Sleep -Seconds 5
