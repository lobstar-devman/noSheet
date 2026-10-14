#!/bin/bash
# Check, build and publish nosheet to npm. Run via: docker compose -f .docker/compose.yaml run --rm publish
# Extra arguments are passed to `npm publish`, e.g. `--dry-run` or `--otp=123456`.
set -e

cd "$(dirname "$0")"/..

echo "📦 Installing Node dependencies..."
npm ci --no-audit --no-fund

# Lint, test, clean and build before asking for a login, so a failing check costs nothing.
npm run prepublishOnly

if [[ " $* " == *" --dry-run "* ]]; then
  echo "🧪 Dry run: skipping npm login"
else
  # The login lives only in this throwaway container's ~/.npmrc and is gone when it exits.
  echo "🔑 Logging in to npm..."
  npm login
fi

echo "🚀 Publishing..."
# Checks already ran above; --ignore-scripts stops prepublishOnly running them a second time.
npm publish --ignore-scripts "$@"
