#!/usr/bin/env bash
set -euo pipefail

base="${1:?Usage: branch-current.sh <base ref> <required commits file> [max commits behind]}"
required="${2:?Usage: branch-current.sh <base ref> <required commits file> [max commits behind]}"
max_behind="${3:-40}"
failed=0

while read -r sha why; do
  [ -z "$sha" ] && continue
  if ! git merge-base --is-ancestor "$sha" "$base"; then
    echo "::error::$sha in $required is not part of $base. Fix the list: it may only name commits that are already on main."
    failed=1
  elif ! git merge-base --is-ancestor "$sha" HEAD; then
    echo "::error::This branch is missing commit ${sha:0:7} ($why), which the tooling on main needs. Run: git fetch origin && git merge origin/main"
    failed=1
  fi
done < "$required"

behind="$(git rev-list --count "HEAD..$base")"
if [ "$behind" -gt "$max_behind" ]; then
  echo "::error::This branch is $behind commits behind main (limit $max_behind). Run: git fetch origin && git merge origin/main"
  failed=1
fi

exit "$failed"
