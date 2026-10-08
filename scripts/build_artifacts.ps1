# Windows PowerShell equivalent of `make build-artifacts`.
# Produces dist/lambda (Linux-targeted Lambda bundle + bundled static frontend)
# and dist/frontend (static Next.js export).
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Python = if ($env:PYTHON) { $env:PYTHON } else { "python" }

Write-Output "== Building static frontend export =="
Push-Location (Join-Path $Root "frontend")
try {
  if (Test-Path "package-lock.json") { npm ci --no-audit --no-fund } else { npm install --no-audit --no-fund }
  if ($LASTEXITCODE -ne 0) { throw "frontend dependency install failed" }
  if (-not $env:NEXT_PUBLIC_API_URL) { $env:NEXT_PUBLIC_API_URL = "/api" }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }
} finally {
  Pop-Location
}
$FrontendOut = Join-Path $Root "dist/frontend"
if (Test-Path $FrontendOut) { Remove-Item -Recurse -Force $FrontendOut }
New-Item -ItemType Directory -Force -Path $FrontendOut | Out-Null
Copy-Item -Recurse (Join-Path $Root "frontend/out/*") $FrontendOut
Write-Output "Static frontend export copied to $FrontendOut"

Write-Output "== Packaging Lambda bundle =="
$LambdaOut = Join-Path $Root "dist/lambda"
if (Test-Path $LambdaOut) { Remove-Item -Recurse -Force $LambdaOut }
New-Item -ItemType Directory -Force -Path $LambdaOut | Out-Null
& $Python -m pip install `
  --platform manylinux2014_x86_64 `
  --implementation cp `
  --python-version 3.12 `
  --only-binary=:all: `
  --target $LambdaOut `
  --quiet `
  -r (Join-Path $Root "backend/requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "pip install for Lambda bundle failed" }
Copy-Item -Recurse (Join-Path $Root "backend/app") (Join-Path $LambdaOut "app")
Get-ChildItem -Recurse -Directory -Filter __pycache__ -Path $LambdaOut | Remove-Item -Recurse -Force
# The same static export is bundled so the API Lambda can serve the frontend when
# CloudFront is disabled (`leakledger:cloudfront=false`).
Copy-Item -Recurse $FrontendOut (Join-Path $LambdaOut "frontend_static")
Write-Output "Lambda bundle created at $LambdaOut"

Write-Output "Deployment artifacts are ready under $Root/dist"
