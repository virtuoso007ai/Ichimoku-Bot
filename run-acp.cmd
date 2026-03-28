@echo off
REM ACP CLI without npx (global `acp` may invoke npx, which is sometimes missing from PATH)
cd /d "%~dp0"
call "%~dp0node_modules\.bin\tsx.cmd" "%~dp0bin\acp.ts" %*
