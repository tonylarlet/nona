@echo off
setlocal
cd /d "%~dp0"
if "%NONA_MAIL_PORT%"=="" set NONA_MAIL_PORT=8798
if "%NONA_MAIL_MODE%"=="" set NONA_MAIL_MODE=send
if "%NONA_MAIL_TO%"=="" set NONA_MAIL_TO=t.larlet@brm.nc
node "%~dp0nona-mail-backend.mjs"
