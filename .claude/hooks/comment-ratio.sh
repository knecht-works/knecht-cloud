#!/usr/bin/env bash
# Stop hook: warns when the uncommitted diff adds too many comment lines.
# Reads the hook payload from stdin; never fails the session.

input=$(cat)
if [ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" = "true" ]; then
  exit 0
fi

cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" || exit 0

threshold=15
stats=$(git diff HEAD --no-color -- 'app/**/*.ts' 'app/**/*.vue' 'server/**/*.ts' 'shared/**/*.ts' 'test/**/*.ts' 2>/dev/null \
  | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' \
  | awk '
      /^[+-][[:space:]]*$/ { next }
      /^\+/ { total++ }
      /^\+[[:space:]]*(\/\/|\/\*|\*)/ { comments++ }
      /^-[[:space:]]*(\/\/|\/\*|\*)/ { removed++ }
      END { printf "%d %d %d", total + 0, comments + 0, removed + 0 }
    ')
read -r total comments removed <<<"$stats"

[ "$total" -eq 0 ] && exit 0
# A cleanup pass that only shortens comments must not trip the check.
[ "$comments" -le "$removed" ] && exit 0
ratio=$(( comments * 100 / total ))
[ "$ratio" -lt "$threshold" ] && exit 0

jq -n --arg r "$ratio" --arg c "$comments" --arg t "$total" '{
  decision: "block",
  reason: ("Comment check: " + $c + " of " + $t + " added lines in the uncommitted diff are comments (" + $r + "%, limit 15%). Re-read CLAUDE.md section 7 and remove every comment in your diff that restates the code, narrates history, or introduces a section. Keep only non-obvious WHY comments. Then stop.")
}'
