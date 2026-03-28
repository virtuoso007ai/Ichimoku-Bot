@echo off
cd /d "%~dp0"
call "%~dp0node_modules\.bin\tsx.cmd" "%~dp0scripts\degen\post-subscribe-dgclaw.ts" %*
