#!/usr/bin/env bash
set -u

if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "Building: production."
  exit 1
fi

case "${VERCEL_GIT_COMMIT_REF:-}" in
  infra/* | owner/*)
    echo "Skipping: infra and owner branches change tooling, roles and docs, never user-visible code. They are checked in CI and get no preview."
    exit 0
    ;;
esac

base=""
previous="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -n "$previous" ] && git cat-file -e "${previous}^{commit}" 2>/dev/null; then
  base="$previous"
elif git rev-parse --verify --quiet HEAD^ >/dev/null; then
  base="HEAD^"
else
  echo "Building: no earlier commit to compare with."
  exit 1
fi

if ! changed="$(git diff --name-only --no-renames "$base" HEAD)"; then
  echo "Building: could not list the changed files."
  exit 1
fi

skippable() {
  case "$1" in
    tools/ci/vercel-ignore.sh) return 1 ;;
    *.md | docs/* | e2e/* | tools/* | .github/* | .claude/* | .pipeline/*) return 0 ;;
    *.test.ts | *.test.tsx | *.spec.ts | src/testing/* | src/lint/* | src/tools/*) return 0 ;;
    *) return 1 ;;
  esac
}

while IFS= read -r path; do
  [ -z "$path" ] && continue
  if ! skippable "$path"; then
    echo "Building: ${path} can change the deployed app."
    exit 1
  fi
done <<< "$changed"

echo "Skipping: the changes since ${base} touch only tests, docs, CI, tooling and agent files."
exit 0
