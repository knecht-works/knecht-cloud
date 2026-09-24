#!/usr/bin/env bash
# The release notes, as markdown.
#
# Curated notes win: if .github/releases/<tag>.md exists for the target tag
# (the /release skill writes it; an RC tag looks up its stable tag), that file
# is the release body. Otherwise the notes are built from conventional commits
# (CLAUDE.md §6): only feat/fix subjects make it in, oldest first, grouped
# under Breaking changes / New / Fixed with the emoji headings every reader
# (GitHub, dashboard, Discord) shows as they are. A commit with a
# "Changelog: skip" trailer stays out.
#
# The release pipeline (.github/workflows/release.yml) uses this to build the
# actual notes. Run it locally to preview what the NEXT release will say:
#
#   bash scripts/changelog-preview.sh                # last tag -> HEAD
#   bash scripts/changelog-preview.sh '' v0.3.0      # what tag v0.3.0 ships
#   bash scripts/changelog-preview.sh v0.2.0 v0.3.0  # explicit commit range
set -euo pipefail

to="${2:-HEAD}"

notes_file=".github/releases/${to%%-*}.md"
if [[ "$to" == v* && -f "$notes_file" ]]; then
  cat "$notes_file"
  exit 0
fi

# Default range start: the last STABLE release tag before `to` (empty on the
# first release, which then lists the whole history). Pre-release tags
# (v*-rc.*) are excluded so the stable release after an RC still lists the
# whole window since the previous stable one.
from="${1:-$(git describe --tags --match 'v*.*.*' --exclude 'v*-*' --abbrev=0 "$to^" 2>/dev/null || true)}"

git log ${from:+$from..}"$to" --no-merges --reverse \
  --pretty='%(trailers:key=Changelog,valueonly,separator=%x20)%x1f%s' | awk -F "$(printf '\x1f')" '
  $1 == "skip" { next }
  {
    subject = $2
    if (!match(subject, /^(feat|fix)(\([^)]*\))?!?: /)) next
    header = substr(subject, 1, RLENGTH)
    text = substr(subject, RLENGTH + 1)
    if (match(header, /\([^)]*\)/)) text = "**" substr(header, RSTART + 1, RLENGTH - 2) ":** " text
    line = "- " text "\n"
    if (header ~ /!: $/)          breaking = breaking line
    else if (header ~ /^feat/)    features = features line
    else                          fixes = fixes line
  }
  END {
    out = ""
    if (breaking) out = out "## ⚠️ Breaking changes\n\n" breaking
    if (features) out = out (out ? "\n" : "") "## 🚀 New\n\n" features
    if (fixes)    out = out (out ? "\n" : "") "## 🐛 Fixed\n\n" fixes
    if (!out)     out = "Maintenance release.\n"
    printf "%s", out
  }'
