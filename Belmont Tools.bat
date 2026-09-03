@echo off
rem Buka Belmont Tools tanpa perlu terminal.
rem Electron dipanggil langsung dari node_modules, bukan lewat "npm start":
rem npm akan meninggalkan jendela cmd menganggur selama aplikasi hidup.
cd /d "%~dp0"
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0"
