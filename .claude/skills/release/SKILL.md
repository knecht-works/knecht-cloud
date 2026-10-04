---
name: release
description: Write the curated release notes for the next Knecht release (the body of the releases/vX.Y.Z PR) in the style of Nuxt release notes, with highlights, from the commits since the last stable tag. Use when the user asks for release notes, a changelog for the next version, or to prepare a release.
---

# Write the release notes

The release pipeline ships the body of the release PR (branch
`releases/<tag>`) as the GitHub Release body when it has one
(`scripts/changelog-preview.sh`), otherwise the raw feat/fix commit list. This
skill writes that body for minor and major releases. Patch releases normally
ship the commit list; only write a body for one when the list reads badly.

The body is markdown. The dashboard (System page), the GitHub Release and the
Discord announcement all render it. The user adds screenshots in the PR
afterwards; an image sits on its own line so the dashboard and Discord can pick
it up.

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

3. **Draft the notes** in this shape:

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

4. **Put them in the PR.** Write the draft to a temp file and set it as the
   body of the `releases/vX.Y.Z` PR (`gh pr edit releases/vX.Y.Z --body-file`),
   or open the PR with it (`gh pr create --base main --title vX.Y.Z
   --body-file`). If the PR body already holds notes, ask before replacing
   them: the user may have edited them or added images.

5. **Verify.** `bash scripts/changelog-preview.sh '' vX.Y.Z` must print the
   PR body. Every feat/fix commit in the raw list is either in the notes or
   deliberately dropped; say which were dropped and why.

6. **Hand over.** Show the notes and the PR link. Screenshots and tagging stay
   with the user (CONTRIBUTING.md).
