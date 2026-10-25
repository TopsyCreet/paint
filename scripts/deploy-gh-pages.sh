#!/usr/bin/env bash
# Builds the app and publishes dist/ to the gh-pages branch from your machine.
# Use this when GitHub Actions is unavailable. Pages setting: Deploy from a branch → gh-pages → / (root).
set -euo pipefail
cd "$(dirname "$0")/.."
REMOTE="$(git remote get-url origin)"
SHA="$(git rev-parse --short HEAD)"
npm run build
cd dist
touch .nojekyll
rm -rf .git
git init -q -b gh-pages
git add -A
git commit -q -m "Deploy ${SHA}"
git push -f "$REMOTE" gh-pages
rm -rf .git
echo "Published ${SHA} to gh-pages."
