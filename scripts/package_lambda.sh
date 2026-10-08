#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist/lambda"
PYTHON="${PYTHON:-python}"
rm -rf "$OUT"
mkdir -p "$OUT"
# Always install manylinux2014 x86_64 wheels so the artifact runs on the AWS
# Lambda Python 3.12 runtime regardless of the host OS (Windows/macOS/Linux).
"$PYTHON" -m pip install \
  --platform manylinux2014_x86_64 \
  --implementation cp \
  --python-version 3.12 \
  --only-binary=:all: \
  --target "$OUT" \
  --quiet \
  -r "$ROOT/backend/requirements.txt"
cp -R "$ROOT/backend/app" "$OUT/app"
find "$OUT/app" -type d -name __pycache__ -prune -exec rm -rf {} +
find "$OUT/app" -type f -name '*.pyc' -delete
echo "Lambda bundle created at $OUT"
