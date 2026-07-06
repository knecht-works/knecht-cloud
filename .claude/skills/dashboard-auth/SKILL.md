---
name: dashboard-auth
description: Authenticate to the running Knecht dashboard so an agent can call its session-gated API (/api/**) or drive the UI. Use whenever you need to hit a Knecht endpoint, verify a feature end-to-end, or log into the dashboard without the interactive GitHub OAuth flow.
---

# Authenticate to the Knecht dashboard

Every `/api/**` route is session-gated (`server/middleware/auth.ts`) and the real
login is interactive GitHub OAuth. To drive the app programmatically, seed a real
session via the **dev-only** endpoint `server/routes/_test/login.get.ts`. It uses
the same `setUserSession` machinery as the OAuth callback, so afterwards every
route runs its real code path: nothing is stubbed.

## Prerequisites (one-time, operator sets these)

In `.env` (already documented in `.env.example`):
- `KNECHT_TEST_AUTH`: a shared secret (`openssl rand -hex 16`).
- `KNECHT_TEST_GITHUB_TOKEN`: a real GitHub token, so real clone/PR ops work.

The dev server must be running (`npm run dev:vm` serves on port 3333 inside
the Linux dev VM, forwarded to the Mac).

## Steps

Use the app's cookie domain as the host: `KNECHT_BASE_DOMAIN` (e.g. `lvh.me:3333`),
**not** `localhost`, or the session cookie won't round-trip. Load the secret from
`.env` without printing it:

```bash
set -a; . ./.env 2>/dev/null; set +a
HOST="${KNECHT_BASE_DOMAIN:-localhost}:3333"

# 1. Seed a session into a cookie jar.
curl -s -c /tmp/knecht-jar.txt "http://$HOST/_test/login?secret=$KNECHT_TEST_AUTH"
#    Expect: {"ok":true,"login":"<your-github-login>"}

# 2. Reuse the jar for any API call.
curl -s -b /tmp/knecht-jar.txt "http://$HOST/api/projects"
```

The same jar/cookie can be injected into a browser session if you need to verify
the UI rather than the API.

## Verify it worked

Login returns `{"ok":true,"login":...}`. A 401 `Bad or missing secret` means the
secret didn't match; a 404 means the endpoint is disabled (`KNECHT_TEST_AUTH`
unset) or you hit a production build.

## Rules

- Never echo `KNECHT_TEST_AUTH` or `KNECHT_TEST_GITHUB_TOKEN`: load them from
  `.env` inline as shown; don't `cat`/`grep` the `.env` into visible output.
- Dev/local only. This path does not exist in production, and must never be
  relied on there.
