#!/bin/bash
# Install, lint, test and build nosheet. Run via: docker compose -f .docker/compose.yaml run --rm build
set -e

cd "$(dirname "$0")"/..

echo "📦 Installing Node dependencies..."
npm ci --no-audit --no-fund

echo "🔍 Linting..."
npm run lint

echo "🧪 Testing..."
npm test

echo "🏭 Building..."
npm run clean
npm run build

echo "✅ Build complete: dist/ and examples/js/ are up to date"
