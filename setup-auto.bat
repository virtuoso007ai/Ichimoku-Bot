@echo off
REM Browser login if needed, then agent create (no broken stdin pipe — see setup-auto.ps1)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-auto.ps1" %*
