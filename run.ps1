# PowerShell launcher for Offline CTF
$Host.UI.RawUI.WindowTitle = "Offline CTF Server"
Set-Location -Path $PSScriptRoot

Write-Host "===================================================" -ForegroundColor Green
Write-Host "   OFFLINE CTF SERVER LAUNCHER - POWERSHELL" -ForegroundColor Green
Write-Host "===================================================" -ForegroundColor Green

# Optional Firewall helper notice
Write-Host "[*] Tip: If phones cannot connect, ensure port 5000 is open in Windows Firewall." -ForegroundColor Yellow
Write-Host "[*] Starting server..." -ForegroundColor Cyan

python server.py
