# syntax=docker/dockerfile:1

# ─── Knecht image ─────────────────────────────────────────────────────────────
# Stages:
#   build    — compile the Nuxt app → .output (devDeps stay here, never shipped)
#   tooling  — shared runtime base: docker CLI, ddev, opencode, the node user
#   dev      — tooling + full deps; runs the Nuxt dev server (HMR) against a
#              bind-mounted source (see docker-compose.dev.yml). Local dev only.
#   prod     — tooling + built app; runs Nitro. The default/shipped image.
#
# DooD model + fixed path: internals/docs/dood-harness.md
# ──────────────────────────────────────────────────────────────────────────────

ARG NPM_VERSION=11.9.0


# ═══ build: compile the Nuxt app ══════════════════════════════════════════════
FROM node:22-bookworm-slim AS build
ARG NPM_VERSION
WORKDIR /app
# Pin npm to the lockfile's generator so `npm ci` is deterministic — the base
# image ships an older npm that resolves the lock differently. Keep NPM_VERSION
# in step with the dev machine's npm.
COPY . .
RUN npm i -g npm@${NPM_VERSION} && npm ci && npm run build
# Result: /app/.output (a self-contained Nitro node server)


# ═══ tooling: shared runtime base (DooD tools) ════════════════════════════════
FROM node:22-bookworm-slim AS tooling
ARG NPM_VERSION

# 1) Base system dependencies + mkcert (ddev uses it for local TLS)
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg lsb-release \
      mkcert libnss3-tools \
 && install -m 0755 -d /etc/apt/keyrings \
 && rm -rf /var/lib/apt/lists/*

# 2) Docker CLI (client only — there is no daemon in here; it talks to the
#    mounted host socket). Verify the repo URL against current Docker docs.
RUN curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
 && chmod a+r /etc/apt/keyrings/docker.asc \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
      > /etc/apt/sources.list.d/docker.list \
 && apt-get update && apt-get install -y --no-install-recommends \
      docker-ce-cli docker-buildx-plugin docker-compose-plugin \
 && rm -rf /var/lib/apt/lists/*

# 3) ddev (apt repo). Verify against https://ddev.readthedocs.io — install
#    methods move. The "* *" suite/component is ddev's documented apt format.
RUN curl -fsSL https://pkg.ddev.com/apt/gpg.key | gpg --dearmor -o /etc/apt/keyrings/ddev.gpg \
 && echo "deb [signed-by=/etc/apt/keyrings/ddev.gpg] https://pkg.ddev.com/apt/ * *" \
      > /etc/apt/sources.list.d/ddev.list \
 && apt-get update && apt-get install -y --no-install-recommends ddev \
 && rm -rf /var/lib/apt/lists/*

# 4) opencode (AI agent, MIT-licensed). Package name may change — verify upstream
#    (alternative: `curl -fsSL https://opencode.ai/install | bash`).
RUN npm install -g opencode-ai

# 5) Pin npm (as root, before dropping privileges) so both dev and prod resolve
#    the lockfile the same way the dev machine does. See the build stage note.
RUN npm i -g npm@${NPM_VERSION}

# 6) Run as non-root. ddev refuses to run as root, so we use node's built-in
#    `node` user (uid 1000). /app is handed to node so the dev stage can `npm ci`
#    into it. Socket access is granted at RUNTIME via `group_add` in compose —
#    keeps the image GID-agnostic (one image per host).
ENV DDEV_NONINTERACTIVE=true
RUN mkdir -p /app && chown node:node /app
USER node

# mkcert root CA in the node user's store (best-effort; ddev still serves HTTP
# if the system trust store can't be written as non-root).
RUN mkcert -install || true

WORKDIR /app


# ═══ dev: Nuxt dev server (HMR) inside the tooling container ═══════════════════
FROM tooling AS dev
# Bake node_modules so the anonymous /app/node_modules volume is seeded with the
# Linux build — never the host's (darwin) modules. The source itself is
# bind-mounted at runtime (docker-compose.dev.yml), so edits are live.
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--host"]


# ═══ prod: built app on Nitro (the shipped image, default target) ═════════════
FROM tooling AS prod
# The built app, copied from the build stage. Nothing else from stage 1 ships.
COPY --from=build --chown=node:node /app/.output ./.output

# Nitro listens here; the daemon drives ddev at /data/knecht/projects (mounted).
ENV NITRO_HOST=0.0.0.0 \
    NITRO_PORT=3000
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
