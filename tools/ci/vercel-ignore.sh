#!/usr/bin/env bash
set -u

if [ "${VERCEL_ENV:-}" = "production" ]; then
  sha="${VERCEL_GIT_COMMIT_SHA:-}"
  case "$sha" in
    *[!0-9a-f]*) sha="" ;;
  esac
  if [ "${#sha}" -ne 40 ]; then
    echo "Skipping: production builds only when the owner approved the commit, and this commit id is missing or malformed."
    exit 0
  fi
  if reply="$(curl -fsS --max-time 15 --max-filesize 1048576 "https://api.github.com/repos/kenneth-yu/trip-planner/commits/${sha}/statuses?per_page=100")" \
    && printf '%s' "$reply" | node -e 'let d="";process.stdin.on("data",(c)=>{d+=c}).on("end",()=>{try{const list=JSON.parse(d);const latest=Array.isArray(list)?list.find((x)=>x&&x.context==="deploy/approved"):undefined;process.exit(latest&&latest.state==="success"&&latest.creator&&latest.creator.login==="github-actions[bot]"?0:1)}catch(e){process.exit(1)}})'; then
    echo "Building: the owner approved this commit for production (deploy/approved)."
    exit 1
  fi
  echo "Skipping: production deploys happen only when the owner asks for a release (deploy/approved is not set to success on this commit, or it could not be read)."
  exit 0
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
