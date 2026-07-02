# syntax=docker/dockerfile:1

# ─── Knecht image (the control plane) ─────────────────────────────────────────
# Stages:
#   build    — compile the Nuxt app → .output (devDeps stay here, never shipped)
#   tooling  — shared runtime base: git, docker CLI, the node user
#   prod     — tooling + built app; runs Nitro. The default/shipped image.
# (Local dev doesn't use this image — it runs `npm run dev:vm` in the dev VM.)
#
# This image never runs ddev or the agent itself: it drives the HOST daemon
# (mounted socket) to launch one Sysbox sandbox per run, and everything
# project-facing happens inside those (sandbox/Dockerfile). See
# internals/docs/run-isolation.md.
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


# ═══ tooling: shared runtime base ═════════════════════════════════════════════
FROM node:22-bookworm-slim AS tooling
ARG NPM_VERSION

# 1) Base system dependencies + git (clone/fetch project repos)
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git \
 && install -m 0755 -d /etc/apt/keyrings \
 && rm -rf /var/lib/apt/lists/*

# 2) Docker CLI (client only — there is no daemon in here; it talks to the
#    mounted host socket to launch the per-run sandboxes). Verify the repo URL
#    against current Docker docs.
RUN curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
 && chmod a+r /etc/apt/keyrings/docker.asc \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
      > /etc/apt/sources.list.d/docker.list \
 && apt-get update && apt-get install -y --no-install-recommends \
      docker-ce-cli docker-buildx-plugin docker-compose-plugin \
 && rm -rf /var/lib/apt/lists/*

# 3) Pin npm (as root, before dropping privileges) so both dev and prod resolve
#    the lockfile the same way the dev machine does. See the build stage note.
RUN npm i -g npm@${NPM_VERSION}

# 4) Run as non-root: node's built-in `node` user (uid 1000 — the sandbox
#    image bakes its inner user to the same uid so the mounted worktrees stay
#    writable on both sides). Socket access is granted at RUNTIME via
#    `group_add` in compose — keeps the image GID-agnostic (one image per host).
RUN mkdir -p /app && chown node:node /app
USER node

WORKDIR /app


# ═══ prod: built app on Nitro (the shipped image, default target) ═════════════
FROM tooling AS prod
# The built app, copied from the build stage. Nothing else from stage 1 ships.
COPY --from=build --chown=node:node /app/.output ./.output

# Nitro listens here; the daemon checks out worktrees at /data/knecht/projects
# (mounted) and boots one sandbox per run off them.
ENV NITRO_HOST=0.0.0.0 \
    NITRO_PORT=3000
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
