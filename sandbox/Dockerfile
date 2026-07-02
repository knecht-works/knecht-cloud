# syntax=docker/dockerfile:1

# ─── Knecht run-sandbox image ─────────────────────────────────────────────────
# One container of this image is booted PER RUN under Sysbox
# (`--runtime=sysbox-runc`): an unprivileged Docker-in-Docker sandbox that runs
# the project's full ddev stack — router included — plus the agent. The host
# side that launches these lives in server/daemon/sandbox.ts; the decision and
# verified findings are in internals/docs/run-isolation.md (§7, §11).
#
# Build (multi-arch — prod is amd64, the local dev VM is arm64):
#   docker build -t knecht-sandbox sandbox/
#
# Layout: systemd is PID 1 (Sysbox's supported mode), the inner dockerd is a
# systemd unit, ddev drives it as the non-root `ddev` user. The run's git
# worktree is bind-mounted at /project by the launcher.
# ──────────────────────────────────────────────────────────────────────────────

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# systemd as init + the base tools ddev expects. mkcert: ddev generates its
# local CA at first start (previews still cross the ingress hop over HTTP —
# run-isolation.md §11 — but ddev wants mkcert present).
RUN apt-get update && apt-get install -y --no-install-recommends \
      systemd systemd-sysv ca-certificates curl gnupg sudo iproute2 git \
      mkcert libnss3-tools \
 && rm -rf /var/lib/apt/lists/*

# The INNER Docker daemon (dockerd runs inside the sandbox — this is the whole
# point). Note: the version pin from run-isolation.md §11 applies to the HOST
# daemon that launches sysbox containers, not to this inner one.
RUN curl -fsSL https://get.docker.com | sh

# ddev (same apt repo as everywhere else in Knecht).
RUN install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://pkg.ddev.com/apt/gpg.key | gpg --dearmor -o /etc/apt/keyrings/ddev.gpg \
 && echo "deb [signed-by=/etc/apt/keyrings/ddev.gpg] https://pkg.ddev.com/apt/ * *" \
      > /etc/apt/sources.list.d/ddev.list \
 && apt-get update && apt-get install -y --no-install-recommends ddev \
 && rm -rf /var/lib/apt/lists/*

# The non-root user everything project-facing runs as (ddev refuses root). Its
# uid/gid MUST match the Knecht process that owns the bind-mounted /project
# (sysbox identity-maps bind-mount ownership), so they are baked at build time —
# the provisioning script passes the invoking user's ids. A runtime `usermod`
# does NOT work: `docker exec -u ddev` under sysbox keeps resolving the name
# against the container's original passwd. Ubuntu's stock `ubuntu` user is
# removed to free the default 1000/1000.
ARG KNECHT_UID=1000
ARG KNECHT_GID=1000
RUN userdel -r ubuntu \
 && groupadd -o -g ${KNECHT_GID} ddev \
 && useradd -o -m -u ${KNECHT_UID} -g ${KNECHT_GID} -s /bin/bash ddev \
 && usermod -aG docker,sudo ddev \
 && echo 'ddev ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

ENV DDEV_NONINTERACTIVE=true

# The inner ddev-router must listen on 0.0.0.0, not 127.0.0.1 — otherwise the
# ingress can't reach it container-to-container (run-isolation.md §11). Written
# directly (`ddev config global` needs a running daemon, which a build has not);
# ddev merges this file with its defaults on first run.
RUN su - ddev -c 'mkdir -p ~/.ddev && printf "router_bind_all_interfaces: true\ninstrumentation_opt_in: false\n" > ~/.ddev/global_config.yaml'

# opencode (the AI agent) — runs INSIDE the sandbox, in the project checkout.
RUN su - ddev -c 'curl -fsSL https://opencode.ai/install | bash'

RUN systemctl enable docker

# systemd shuts down cleanly on SIGRTMIN+3 (SIGTERM is ignored by PID 1) — this
# is what makes `docker stop` on a sandbox orderly instead of a timeout+kill.
STOPSIGNAL SIGRTMIN+3

CMD ["/sbin/init"]
