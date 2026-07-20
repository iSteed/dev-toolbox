#!/usr/bin/env bash
set -euo pipefail

BUCKET="steed-network-tools"
DISTRIBUTION_ID="E2GLXNGXGNN6HJ"

cd "$(dirname "$0")"

aws s3 sync . "s3://${BUCKET}/" \
  --exclude ".claude/*" \
  --exclude "*/.git" \
  --exclude "*/.git/*" \
  --exclude ".git" \
  --exclude ".git/*" \
  --exclude "*/.github/*" \
  --exclude ".github/*" \
  --exclude "*/.gitignore" \
  --exclude ".gitignore" \
  --exclude "*/.DS_Store" \
  --exclude ".DS_Store" \
  --exclude "*/tests/*" \
  --exclude "tests/*" \
  --exclude "*/node_modules/*" \
  --exclude "node_modules/*" \
  --exclude "*/package.json" \
  --exclude "package.json" \
  --exclude "*/package-lock.json" \
  --exclude "package-lock.json" \
  --exclude "*/LICENSE" \
  --exclude "LICENSE" \
  --exclude "*/README.md" \
  --exclude "README.md" \
  --exclude "*/deploy.sh" \
  --exclude "deploy.sh" \
  --delete

aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "/*"

echo "Deployed. https://tools.steed.network"
