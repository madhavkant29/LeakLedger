#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist/lambda"
rm -rf "$OUT"
mkdir -p "$OUT"
python -m pip install -r "$ROOT/backend/requirements.txt" -t "$OUT" --quiet
cp -R "$ROOT/backend/app" "$OUT/app"
echo "Lambda bundle created at $OUT"
