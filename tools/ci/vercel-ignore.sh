#!/usr/bin/env bash
set -u

if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "Building: production."
  exit 1
fi

case "${VERCEL_GIT_COMMIT_REF:-}" in
  infra/* | owner/*)
    echo "Skipping: ${VERCEL_GIT_COMMIT_REF} branches change no user-visible code."
    exit 0
    ;;
esac

if ! git rev-parse --verify --quiet HEAD^ >/dev/null; then
  echo "Building: no parent commit to compare with."
  exit 1
fi

if git diff --quiet HEAD^ HEAD -- src public next.config.ts package.json package-lock.json drizzle vercel.json \
  ':(exclude)src/**/*.test.ts' ':(exclude)src/**/*.test.tsx' ':(exclude)src/testing/**' ':(exclude)src/lint/**'; then
  echo "Skipping: this commit changes only tests, docs, CI or tooling."
  exit 0
fi

echo "Building: this commit changes user-visible code."
exit 1
