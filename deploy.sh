#!/usr/bin/env bash
set -euo pipefail

BUCKET="steed-network-tools"
DISTRIBUTION_ID="E2GLXNGXGNN6HJ"

cd "$(dirname "$0")"

aws s3 sync . "s3://${BUCKET}/" \
  --exclude ".git/*" \
  --exclude ".gitignore" \
  --exclude ".DS_Store" \
  --exclude "tests/*" \
  --exclude "README.md" \
  --exclude "deploy.sh" \
  --delete

aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "/*"

echo "Deployed. https://tools.steed.network"
