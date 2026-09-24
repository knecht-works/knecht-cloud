---
name: release
description: Write the curated release notes for the next Knecht release (.github/releases/vX.Y.Z.md) in the style of Nuxt release notes, with highlights, from the commits since the last stable tag. Use when the user asks for release notes, a changelog for the next version, or to prepare a release.
---

# Write the release notes

The release pipeline ships `.github/releases/<tag>.md` as the GitHub Release
body when the file exists (`scripts/changelog-preview.sh`), otherwise the raw
feat/fix commit list. This skill writes that file for minor and major
releases. Patch releases normally ship the commit list; only write a file for
one when the list reads badly.

The body is markdown. The dashboard (System page), the GitHub Release and the
Discord announcement all render it.

## Steps

1. **Find the tag.** From the argument, else from the branch name
   `releases/vX.Y.Z`, else ask. Reject a tag that already exists.

2. **Collect the material.** The raw list and the full commits, oldest first:

   ```bash
   bash scripts/changelog-preview.sh
   git log "$(git describe --tags --match 'v*.*.*' --exclude 'v*-*' --abbrev=0)..HEAD" --no-merges --reverse --format='%n=== %s%n%b'
   ```

   Read the bodies. They carry the behavior details the notes need; the
   subjects alone do not.

3. **Write `.github/releases/vX.Y.Z.md`** in this shape:

   ```markdown
   ## ✨ Highlights

   ### Linear and Plane are connected

   One to three sentences on what a user can now do and why it matters.
   Present tense, second person where natural. No implementation talk.

   ### Trigger conditions in and/or groups

   ...

   ## ⚠️ Breaking changes

   - What breaks and what to do about it.

   ## 🚀 New

   - One sentence per remaining feature.

   ## 🐛 Fixed

   - One sentence per fix.
   ```

   Rules:
   - Two to four highlights: the changes a user would notice first. Group
     related commits into one highlight (the same feature across Jira, Linear
     and Plane is one highlight, not three).
   - A change appears once. What is a highlight is not repeated under New.
   - Merge commits that describe one change from different angles into one
     bullet. Split a subject that bundles unrelated changes.
   - Drop fixes to features introduced in this same release: nobody saw the
     bug. Drop polish nobody would look for (copy tweaks, spacing, focus
     rings) unless it is the whole release.
   - Every bullet is one sentence about visible behavior, under 120
     characters where possible, and starts with the thing that changed
     ("Trigger filters accept * wildcards"), not with "Fixed" or "Added".
   - Keep the section headings with their emoji exactly as above. Omit empty sections. No commit hashes, no PR links, no Co-Authored
     lines.
   - No em-dashes anywhere (CLAUDE.md §5).

4. **Verify.** `bash scripts/changelog-preview.sh '' vX.Y.Z` must print the
   file. Every feat/fix commit in the raw list is either in the notes or
   deliberately dropped; say which were dropped and why.

5. **Hand over.** Show the notes, then commit them on the release branch as
   `docs: Release notes for vX.Y.Z`. Tagging stays with the user
   (CONTRIBUTING.md).
