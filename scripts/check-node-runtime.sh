#!/usr/bin/env bash
#
# D22: better-sqlite3 does not load on edge. The root layout only sets an
# inherited default that any segment can override, and middleware and
# instrumentation inherit nothing, so this guard fails the build instead.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

# `2>/dev/null` and `|| true` below would make an empty scan print "OK" too.
if [ ! -d "app" ] && [ ! -d "src/app" ]; then
  echo "ERROR: neither app/ nor src/app/ found — nothing to scan."
  exit 1
fi

# Any extension Next accepts, so a rename does not escape the guard.
config_found=0
for candidate in next.config.*; do
  if [ -f "$candidate" ]; then
    config_found=1
  fi
done

if [ "$config_found" -eq 0 ]; then
  echo "ERROR: no next.config.* found — nothing to scan."
  exit 1
fi

status=0

# 1. No file may opt into edge. The whole repository, because Next prefers a
#    root `app/` over `src/app/`. Comments are dropped and newlines folded, so
#    prose does not fail the build and a split declaration does not slip past.
edge_re='runtime[[:space:]]*[=:][[:space:]]*["'"'"']edge["'"'"']'

candidates="$(grep -rl 'runtime' \
  --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  --include='*.mts' --include='*.mjs' --include='*.cts' --include='*.cjs' \
  --exclude-dir={node_modules,.next,.git} \
  . 2>/dev/null || true)"

edge_hits=""
while IFS= read -r file; do
  [ -n "$file" ] || continue
  # Only `//` after whitespace is a comment, so a `https://` in a string stays.
  normalized="$(sed -e 's|/\*.*||' \
                    -e 's|^[[:space:]]*\*.*||' \
                    -e 's|^[[:space:]]*//.*||' \
                    -e 's|[[:space:]]//.*||' "$file" | tr '\n' ' ')"
  if [[ "$normalized" =~ $edge_re ]]; then
    edge_hits="$edge_hits$file: ${BASH_REMATCH[0]}
"
  fi
done <<<"$candidates"

if [ -n "$edge_hits" ]; then
  echo "ERROR: the edge runtime is forbidden (D22). Found:"
  printf '%s' "$edge_hits"
  status=1
fi

# 2. middleware and instrumentation default to edge, so they must say `nodejs`.
for entry in middleware instrumentation; do
  for path in "$entry.ts" "$entry.js" "src/$entry.ts" "src/$entry.js"; do
    [ -f "$path" ] || continue
    if ! grep -qE 'runtime[[:space:]]*[=:][[:space:]]*["'"'"']nodejs["'"'"']' "$path"; then
      echo "ERROR: $path does not inherit the root layout runtime and must"
      echo "       declare the Node runtime explicitly (D22)."
      status=1
    fi
  done
done

# 3. The root layout must declare the Node runtime positively: looking only for
#    the forbidden word let its deletion pass everything.
root_layout=""
for candidate in src/app/layout.tsx src/app/layout.js app/layout.tsx app/layout.js; do
  if [ -f "$candidate" ]; then
    root_layout="$candidate"
    break
  fi
done

if [ -z "$root_layout" ]; then
  echo "ERROR: no root layout found — nothing to assert the Node runtime on."
  status=1
elif ! grep -qE 'runtime[[:space:]]*[=:][[:space:]]*["'"'"']nodejs["'"'"']' "$root_layout"; then
  echo "ERROR: $root_layout does not declare the Node runtime (D22)."
  echo "       Add: export const runtime = \"nodejs\";"
  status=1
fi

if [ "$status" -eq 0 ]; then
  echo "OK: the root layout declares the Node runtime, and nothing declares edge."
fi

exit "$status"
