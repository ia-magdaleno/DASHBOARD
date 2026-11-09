@echo off
title CALEBSYS SERVIDOR - NO CERRAR
cd /d A:\Calebsys_POS_RESPALDO_21Junio_v4_PERFECTO\backend
A:\Calebsys_POS_RESPALDO_21Junio_v4_PERFECTO\.venv\Scripts\uvicorn.exe main:app --host 127.0.0.1 --port 8000
pause
