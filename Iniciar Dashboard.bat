@echo off
rem Duplo-clique aqui para subir o dashboard e abrir o navegador.
rem A logica esta em scripts\iniciar.ps1; este arquivo so existe para ser clicavel.
rem MANTENHA ESTE ARQUIVO EM ASCII PURO. Com a codepage 65001 (UTF-8) ativa, o
rem parser de .bat do cmd.exe perde a sincronia num caractere multi-byte e passa a
rem executar o resto da linha: um travessao aqui gerava "'m' nao e reconhecido"
rem (o final de "rem" virando comando) antes de o script abrir.
rem -ExecutionPolicy Bypass: sem isso a politica padrao do Windows recusa o .ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\iniciar.ps1"
