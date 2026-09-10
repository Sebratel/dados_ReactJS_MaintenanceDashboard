@echo off
rem Duplo-clique aqui para guardar o estado do projeto e copiar para o OneDrive.
rem A logica esta em scripts\backup.ps1; este arquivo so existe para ser clicavel.
rem MANTENHA ESTE ARQUIVO EM ASCII PURO (ver o porque em "Iniciar Dashboard.bat").
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\backup.ps1"
