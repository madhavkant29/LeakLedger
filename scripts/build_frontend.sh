#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/frontend"
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi
NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-/api}" npm run build
rm -rf "$ROOT/dist/frontend"
mkdir -p "$ROOT/dist/frontend"
cp -R "$ROOT/frontend/out/." "$ROOT/dist/frontend/"
echo "Static frontend export copied to $ROOT/dist/frontend"
