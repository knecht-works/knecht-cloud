---
name: marketing-shots
description: Refresh the Knecht dashboard screenshots on the marketing site (../knecht-www) after UI changes. Finds outdated images, retakes them with Playwright against the running dev dashboard, and replaces them. Use when the user asks to update, refresh, or check website/docs screenshots, or after UI work before a release.
---

# Refresh marketing screenshots

The marketing site lives in `../knecht-www`. Its dashboard screenshots are in
`public/assets/*.png`, referenced from `app/` (home page) and `content/` (docs,
updates). This skill retakes them from the running dev dashboard.

## Scope

- In scope: every image under `public/assets` that shows the Knecht dashboard
  and is referenced from `app/` or `content/*/docs`.
- Never touch images used by `content/*/updates`: an update shows the UI of its
  time. If an image is used by both docs and updates, save the new shot under a
  new filename and point only the docs at it.
- Manual, never retaken: screenshots of other tools (`jira-webhook-*`,
  `linear-*`, `plane-*`, `issue-*` GitHub screenshots), diagrams
  (`knecht-concepts`), mascots, logos.

List the candidates:

```bash
cd ../knecht-www
grep -rnoE "/assets/[a-zA-Z0-9_-]+\.png" app content | grep -v /updates/
grep -rhoE "/assets/[a-zA-Z0-9_-]+\.png" content/*/updates | sort -u   # never touch these
```

## Find what is outdated

1. `git log --oneline <last-tag>..HEAD -- app` in knecht-cloud shows the UI
   changes. Layout changes (sidebar, headers, navigation) make every shot stale.
2. Look at each candidate image (Read the PNG) and compare it with the current
   page. Report the list of stale images before replacing anything.

## Rules for every shot

- **Never zoom or crop.** Every Knecht dashboard screenshot is a full browser
  window. To focus on one part, remove unrelated elements from the DOM before
  the shot (for example the other integration panels, see `onlyIntegration` in
  `scripts/shots.mjs`), or pick a taller window when content would be cut off.
- Dark mode, `deviceScaleFactor: 2`, width 1440. Home page shots use 1440x826
  (the home frame is `aspect-[1915/1098]`), docs shots 1440x779 or 1440x900.
- The content must match the image's alt text. If the UI no longer allows that
  (renamed page, deleted workflow), pick the closest real state and update the
  alt text in the same change.
- Dialogs (trigger editor etc.) are filled in and shot, never saved.
- Nothing is faked: hide only dev-only noise (the "Update available" card is
  hidden by `run.mjs`). Real states such as "Paused" or "Incomplete" stay;
  mention them to the user instead.
- Avoid private content in shots (for example the instance-wide agent
  instructions). If it is visible, tell the user before replacing the image.

## Run it

1. The dev server must run (`npm run dev:vm`, port 3333). Get a session cookie
   with the `dashboard-auth` skill, written as a curl jar into the work dir:

   ```bash
   WORK=<scratchpad>/shots && mkdir -p $WORK/new
   cp .claude/skills/marketing-shots/scripts/*.mjs $WORK/
   (cd $WORK && npm init -y >/dev/null && npm i playwright >/dev/null)
   set -a; . ./.env; set +a
   curl -s -c $WORK/jar.txt "http://lvh.me:3333/_test/login?secret=$KNECHT_TEST_AUTH"
   ```

2. Check the ids in `scripts/shots.mjs` against the dev DB first
   (`/api/projects`, `/api/workflows`, `/api/runs`); they are ids of the local
   instance and change when data is reset.
3. Shoot: `cd $WORK && node run.mjs <name,name|all>`. Output lands in
   `$WORK/new/<name>.png`; a failing action saves `<name>-err.png`.
4. Read every new image, compare with the old one, iterate on `shots.mjs`.
5. Copy the approved images to `../knecht-www/public/assets/`, keep the
   filenames, adjust alt texts. Do not commit unless asked.
6. Copy improved recipes back into `.claude/skills/marketing-shots/scripts/`.

## Shots that need a live run

- `project`, `knecht-run`: need a run with a live preview. Start one with
  `POST /api/runs {"projectId": <test-no-ddev>, "workflowId": <Project Specific Boot>}`
  and shoot once it is `success` with `envState: up`. `boot-and-preview` fails
  on test-no-ddev (it runs npm, the project uses pnpm).
- `running-workflow`: start the same run and shoot `/workflows/<id>` about 15s
  later, while the boot step is still running.
- These are local ddev runs only. Never start workflows with AI steps or ones
  that push or open PRs without asking.

## Gotchas

- The session cookie must be set for `.lvh.me`, not `lvh.me`, or the preview
  iframe (`*.preview.lvh.me`) renders the Knecht dashboard instead of the site.
- Use `waitUntil: 'load'`; `networkidle` never settles while a run streams.
- Nuxt UI selects are `button[aria-haspopup="listbox"]`, not comboboxes;
  "Add condition" opens a menu (`menuitem`). Helpers are in `scripts/trig.mjs`.
- Jira, Plane and Linear triggers pre-check "Assigned to Knecht"; uncheck it
  when the alt text does not mention it.
- Home images are served via `/_ipx/` with `cache-control: immutable`. After
  replacing one, a browser that saw the old one needs a hard reload; tell the
  user.
