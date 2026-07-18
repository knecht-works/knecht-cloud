#!/usr/bin/env bash
# The release changelog, built from conventional commits (CLAUDE.md §6): only
# feat/fix subjects make it in, grouped under Breaking/New/Fixed, as plain
# text (the dashboard renders release bodies as text, not markdown).
#
# The release pipeline (.github/workflows/release.yml) uses this to build the
# actual notes. Run it locally to preview what the NEXT release will say:
#
#   bash scripts/changelog-preview.sh                # last tag -> HEAD
#   bash scripts/changelog-preview.sh v0.2.0 v0.3.0  # explicit range
set -euo pipefail

to="${2:-HEAD}"
# Default range start: the last STABLE release tag before `to` (empty on the
# first release, which then lists the whole history). Pre-release tags
# (v*-rc.*) are excluded so the stable release after an RC still lists the
# whole window since the previous stable one.
from="${1:-$(git describe --tags --match 'v*.*.*' --exclude 'v*-*' --abbrev=0 "$to^" 2>/dev/null || true)}"

git log ${from:+$from..}"$to" --no-merges --pretty='%s' | awk '
  /^(feat|fix)(\([^)]*\))?!: / { sub(/^[^:]*: */, "- "); breaking = breaking $0 "\n"; next }
  /^feat(\([^)]*\))?: /        { sub(/^[^:]*: */, "- "); features = features $0 "\n"; next }
  /^fix(\([^)]*\))?: /         { sub(/^[^:]*: */, "- "); fixes = fixes $0 "\n" }
  END {
    out = ""
    if (breaking) out = out "Breaking:\n" breaking
    if (features) out = out (out ? "\n" : "") "New:\n" features
    if (fixes)    out = out (out ? "\n" : "") "Fixed:\n" fixes
    if (!out)     out = "- Maintenance release\n"
    printf "%s", out
  }'
