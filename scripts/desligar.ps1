# Desliga o dashboard e libera a memoria.
#
# POR QUE ESTE ARQUIVO EXISTE: o servidor passou a rodar em segundo plano, sem
# janela, para nao ser fechado por acidente. O efeito colateral e que tambem
# deixou de haver um jeito de desliga-lo de proposito. Sem este atalho, o unico
# caminho seria o Gerenciador de Tarefas.
#
# POR QUE NAO E "matar todo processo node": o Gerenciador de Tarefas mostra
# varios node.exe, e alguns nao sao nossos (extensoes de editor, ferramentas de
# linha de comando). Matar todos derrubaria coisas alheias. Aqui a mira e dupla:
# quem esta ESCUTANDO na porta 3000, e processos cuja linha de comando cita
# explicitamente este projeto.

$ErrorActionPreference = 'Stop'
$porta = 3000

Write-Host ""
Write-Host "  Desligar o Dashboard Manutencao FTTX" -ForegroundColor Cyan
Write-Host "  ------------------------------------"
Write-Host ""

$conexoes = @(Get-NetTCPConnection -LocalPort $porta -State Listen -ErrorAction SilentlyContinue)
$alvos = New-Object System.Collections.Generic.HashSet[int]

foreach ($c in $conexoes) { [void]$alvos.Add([int]$c.OwningProcess) }

# A propria linhagem deste script: o powershell, o cmd do .bat acima dele, e assim
# por diante. Precisa ser calculada e EXCLUIDA dos alvos.
#
# POR QUE: a primeira versao procurava por 'dashboard_manutencao_ia' na linha de
# comando, e a linha de comando do "Desligar Dashboard.bat" contem esse texto. O
# script se elegia como alvo, matava o proprio lancador com /T e morria no meio,
# sem terminar o servico nem informar o resultado. Encerrar-se e uma falha que
# nao aparece como erro: aparece como silencio.
$linhagem = New-Object System.Collections.Generic.HashSet[int]
$atual = $PID
for ($i = 0; $i -lt 8 -and $atual -gt 0; $i++) {
    [void]$linhagem.Add([int]$atual)
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$atual" -ErrorAction SilentlyContinue
    if (-not $proc) { break }
    $atual = [int]$proc.ParentProcessId
}

# O que escuta na porta e o node do Next, no fim da arvore. Acima dele ficam o
# npm e o cmd que o lancaram; matar so a folha deixaria esses dois orfaos
# ocupando memoria. Por isso a busca tambem por linha de comando.
#
# O padrao cita apenas os comandos do SERVIDOR. Nada de caminho de pasta: o
# caminho aparece em qualquer coisa lancada de dentro do projeto, inclusive neste
# proprio script.
$padrao = 'npm run dev|next dev|next-server'
foreach ($p in Get-CimInstance Win32_Process -Filter "Name='node.exe' or Name='cmd.exe'") {
    if ($p.CommandLine -and $p.CommandLine -match $padrao) {
        if (-not $linhagem.Contains([int]$p.ProcessId)) {
            [void]$alvos.Add([int]$p.ProcessId)
        }
    }
}

if ($alvos.Count -eq 0) {
    Write-Host "  O dashboard ja estava desligado." -ForegroundColor Green
    Write-Host ""
    Start-Sleep -Seconds 3
    exit 0
}

Write-Host "  Encerrando $($alvos.Count) processo(s)..." -ForegroundColor Yellow
foreach ($id in $alvos) {
    # /T leva os filhos junto: o cmd lanca npm, que lanca o node. Sem /T sobram
    # processos vivos que continuam segurando a porta.
    #
    # A REDIRECAO VAI DENTRO DO CMD, e nao em PowerShell, de proposito. No
    # PowerShell 5.1, escrever "taskkill ... 2>&1" transforma cada linha de erro
    # do executavel em excecao; com ErrorActionPreference 'Stop' isso ABORTA o
    # script. E o taskkill reclama toda vez que um processo da lista ja morreu
    # junto com o pai (corrida normal ao derrubar uma arvore). Resultado: uma
    # reclamacao inofensiva interrompia o desligamento no meio, deixando
    # processos vivos. Aconteceu no primeiro teste deste arquivo.
    & cmd.exe /c "taskkill /PID $id /T /F >nul 2>&1"
}

Start-Sleep -Seconds 2

if (Get-NetTCPConnection -LocalPort $porta -State Listen -ErrorAction SilentlyContinue) {
    Write-Host ""
    Write-Host "  Algo ainda esta ocupando a porta $porta." -ForegroundColor Red
    Write-Host "  Reinicie a maquina, ou me avise para eu investigar."
    Read-Host "  Enter para fechar"
    exit 1
}

Write-Host ""
Write-Host "  Desligado. A porta $porta esta livre e a memoria foi liberada." -ForegroundColor Green
Write-Host "  Para usar de novo: atalho 'Dashboard Manutenca...'."
Write-Host ""
Start-Sleep -Seconds 4
