@echo off
rem Duplo-clique aqui para desligar o dashboard e liberar a memoria.
rem A logica esta em scripts\desligar.ps1; este arquivo so existe para ser clicavel.
rem MANTENHA ESTE ARQUIVO EM ASCII PURO (ver o porque em "Iniciar Dashboard.bat").
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\desligar.ps1"
