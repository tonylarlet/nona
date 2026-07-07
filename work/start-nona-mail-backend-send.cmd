@echo off
setlocal
cd /d "%~dp0"
set NONA_MAIL_PORT=8798
set NONA_MAIL_MODE=send
set NONA_MAIL_TO=t.larlet@brm.nc
node "%~dp0nona-mail-backend.mjs"
