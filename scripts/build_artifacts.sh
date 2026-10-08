#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/scripts/package_lambda.sh"
"$ROOT/scripts/build_frontend.sh"
echo "Deployment artifacts are ready under $ROOT/dist"
