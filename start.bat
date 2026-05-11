@echo off
title Hotel Ginkgo - Serveur
cd /d "%~dp0"

echo.
echo  ================================
echo   Hotel Ginkgo - Demarrage...
echo  ================================
echo.

:: Ouvre Chrome apres 2s dans un processus en arriere-plan
start "" cmd /c "timeout /t 2 /nobreak >nul & start chrome http://localhost:3000"

:: Lance le serveur Node dans cette fenetre (logs visibles ici)
node server.js

pause
