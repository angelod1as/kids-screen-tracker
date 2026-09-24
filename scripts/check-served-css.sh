#!/usr/bin/env bash
#
# #14, #74 and D42, checked on the built stylesheet rather than the source:
# Tailwind's extractor reads comments too, so prose naming a forbidden utility
# once shipped it. Runs after `pnpm build`.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

# A guard with nothing to look at must fail, not pass quietly.
css_files="$(find .next/static -type f -name '*.css' 2>/dev/null || true)"

if [ -z "$css_files" ]; then
  echo "ERROR: no stylesheet under .next/static — nothing to check."
  echo "       Run \`pnpm build\` before \`pnpm check:css\`."
  exit 1
fi

status=0

# Every palette colour but `black` and `white` carries a numeric shade.
shade_re='\.(text|bg|border|ring|outline|decoration|divide|from|via|to|fill|stroke|accent|caret|shadow)-[a-z]+-[0-9]{2,3}[^a-z0-9-]'

motion_re='(\.transition[-{]|\.animate-[a-z]|\.duration-[0-9]|\.ease-[a-z]|@keyframes)'

# The whole permission (D42, docs/design.md): red-700 negative balance,
# yellow-300 pendency, blue-800 and slate-100 furniture. A new colour is a
# reviewed diff here and in `src/ui/style.ts`.
allowed_re='^\.(text-red-700|bg-yellow-300|bg-blue-800|bg-slate-100)$'

while IFS= read -r file; do
  [ -n "$file" ] || continue

  greys="$(grep -oE "$shade_re" "$file" | sed 's/.$//' | sort -u |
    grep -vE "$allowed_re" || true)"
  if [ -n "$greys" ]; then
    echo "ERROR: $file serves a colour that is not on the declared palette (#14, #74):"
    printf '  %s\n' $greys
    status=1
  fi

  motion="$(grep -oE "$motion_re" "$file" | sort -u || true)"
  if [ -n "$motion" ]; then
    echo "ERROR: $file serves a rule that animates (#14):"
    printf '  %s\n' $motion
    status=1
  fi
done <<<"$css_files"

if [ "$status" -eq 0 ]; then
  echo "OK: the served stylesheet is on the declared palette, and nothing moves."
fi

exit "$status"
