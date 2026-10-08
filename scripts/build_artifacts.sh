#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/scripts/build_frontend.sh"
"$ROOT/scripts/package_lambda.sh"
# The same static export is bundled so the API Lambda can serve the frontend when
# CloudFront is disabled (`leakledger:cloudfront=false`).
rm -rf "$ROOT/dist/lambda/frontend_static"
cp -R "$ROOT/dist/frontend" "$ROOT/dist/lambda/frontend_static"
echo "Deployment artifacts are ready under $ROOT/dist"
