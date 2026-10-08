$root = Split-Path -Parent $PSScriptRoot
Set-Location "$root/frontend"
npm install
npm run dev
