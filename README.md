<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/mascot/knecht-logo-dark.svg">
  <img src="public/mascot/knecht-logo-light.svg" alt="Knecht" width="144">
</picture>

/knɛçt/ ("k-nekht")
<br>
<br>

[![Website](https://img.shields.io/badge/knecht.works-6BA96D?logo=googlechrome&logoColor=white)](https://knecht.works)
[![Nuxt](https://img.shields.io/badge/Nuxt-4-00DC82?logo=nuxt&logoColor=white)](https://nuxt.com)
[![Drizzle](https://img.shields.io/badge/Drizzle_ORM-SQLite-C5F74F?logo=drizzle&logoColor=black)](https://orm.drizzle.team)
[![DDEV](https://img.shields.io/badge/DDEV-sandbox-02A8E2?logo=docker&logoColor=white)](https://ddev.com)

Knecht boots your DDEV projects in an isolated sandbox and sends an AI agent
inside that reproduces bugs, fixes them, and validates the result on its own.
</div>

---

## The name

**Knecht** is a German word for a _farmhand_ or _servant_, someone who reliably
does the work for you. That is exactly the idea: your tireless helper that fixes
the bugs while you focus on the rest.

## What does Knecht do?

You report a bug, Knecht does the rest:

1. **Boot the sandbox** - your DDEV project spins up in an isolated container, cleanly separated from everything else.
2. **Reproduce** - the AI agent steps into the sandbox and recreates the failure.
3. **Fix** - it changes the code to resolve the problem.
4. **Validate** - it checks for itself that the fix actually works before handing you the result.

The result can come back as a pull request, including a preview environment to look at.

## Features

- **AI agent** - reproduces, fixes, and validates bugs on its own.
- **Isolated environments** - every run boots its own ddev project with unique containers, network and database, separated from the others.
- **Workflows** - configurable pipelines that define what happens during a run.
- **GitHub integration** - connected as a GitHub App, delivers fixes straight as a pull request.
- **Preview environments** - every run gets its own URL to inspect.
- **Dashboard** - projects, runs, and workflows in one place, built with Nuxt UI.

## Hosting

Knecht is self hosted on your own server. You own your data.

### Requirements

- A Linux host used only for Knecht: Ubuntu 24.04, amd64 or arm64, at least 4 GB RAM and 40 GB disk (8 GB RAM and 80 GB disk are comfortable). A cheap VPS is fine (e.g. a Hetzner CX23 or CX33). A Mac (e.g. a Mac mini) works too, via the Lima VM described below. Keep the host free of other Docker setups: Knecht boots ddev projects on the host daemon and expects ports 80/443 for its own entry point.
- A domain (or subdomain) for the instance. You will point two DNS records at the server.

### Install

As root on the fresh server:

```bash
curl -fsSL https://raw.githubusercontent.com/knecht-works/knecht-cloud/main/scripts/install.sh | bash
```

The installer asks for your domain and does the rest: Docker, the pinned ddev CLI, a one-time image warm-up, the repo checkout at the latest release under `/opt/knecht`, a generated `.env`, and finally the app plus the Caddy TLS entry point via docker compose. Takes a few minutes, safe to re-run.

Then:

1. Set two DNS records, both pointing at the server's IP:
   `A knecht.example.com` and `A *.preview.knecht.example.com`
2. Make sure ports 80 and 443 are reachable (cloud firewall).
3. Open `https://knecht.example.com` and complete the GitHub App setup. The first login claims the instance as owner.

TLS is automatic: Caddy fetches the dashboard certificate on first start and per-preview certificates on demand (the first visit of a new preview URL takes a few extra seconds while its certificate is issued).

### Install on MacOS (e.g. a Mac mini)

The run substrate (host Docker + ddev) is Linux-only, so on a Mac the same setup runs inside a [Lima](https://lima-vm.io) VM. Create the VM from the checked-in template, then run the installer inside it:

```bash
brew install lima
limactl create --name=knecht https://raw.githubusercontent.com/knecht-works/knecht-cloud/main/scripts/lima-server.yaml
limactl start knecht
limactl shell knecht
# inside the VM:
curl -fsSL https://raw.githubusercontent.com/knecht-works/knecht-cloud/main/scripts/install.sh | sudo bash
```

The VM template exposes ports 80 and 443 on all interfaces of the Mac, so the post-install steps above apply unchanged, with the home-network additions:

1. Forward TCP ports 80 and 443 on your router to the Mac.
2. Point the two DNS records at your public IP. Home connections usually change their IP over time, so use a dynamic DNS provider (or a static IP from your ISP) and give the Mac a fixed address in your router.

After a macOS reboot, run `limactl start knecht`; the containers inside come back up on their own. Updating and backups work exactly as below, with `/opt/knecht` and `/data/knecht` living inside the VM (`limactl shell knecht`).

#### Local Setup on MacOS

To just try Knecht on a Mac, follow the macOS install above and use `lvh.me` as the domain. It resolves to 127.0.0.1, so the dashboard and all preview subdomains work without any DNS setup. Ports 80 and 443 on the Mac must be free.

Let's Encrypt cannot issue certificates for a local domain, so you need to use Caddy's internal CA instead. Inside the VM, edit `/opt/knecht/Caddyfile` so both site blocks use `tls internal`:

```
{$KNECHT_BASE_DOMAIN} {
	tls internal
	reverse_proxy knecht:3000
}

https:// {
	tls internal {
		on_demand
	}
	reverse_proxy knecht:3000
}
```

Restart Caddy with `cd /opt/knecht && sudo docker compose restart caddy`. Open `https://lvh.me`, accept the certificate warning and complete the GitHub App setup.

> [!TIP]
> GitHub webhooks cannot reach a local instance, so GitHub triggers wont work.

### Updating

Releases are git tags (`vX.Y.Z`) built by CI into `ghcr.io/knecht-works/knecht-cloud`. When a newer release exists, the System panel in the dashboard shows an update button (owner only); it swaps the instance to the new version with data intact. Manual equivalent on the server:

```bash
cd /opt/knecht
git fetch --tags && git checkout vX.Y.Z
sed -i 's/^KNECHT_VERSION=.*/KNECHT_VERSION=vX.Y.Z/' .env
docker compose pull && docker compose up -d
```

Host-level changes (Docker, the ddev CLI, the image warm-up) are not covered by the in-app update; release notes call it out when the provisioning script must be re-run:

```bash
sudo KNECHT_UID=1000 KNECHT_GID=1000 /opt/knecht/scripts/provision-host.sh
```

### Pre-releases

Tags with a hyphen (e.g. `v0.3.0-rc.1`) are pre-releases: CI builds and publishes them like any release, but they never move the `latest` image tag, are never offered as an update, and a normal install ignores them. To test one, fetch the installer from the pre-release tag itself (so installer and version can't diverge) and pin the same tag:

```bash
curl -fsSL https://raw.githubusercontent.com/knecht-works/knecht-cloud/v0.3.0-rc.1/scripts/install.sh \
  | sudo env KNECHT_DOMAIN=knecht.example.com KNECHT_REF=v0.3.0-rc.1 bash
```

Once the matching stable release is published, the instance offers it as a regular update in the dashboard. Updating from a stable version to a pre-release is not possible.

### Backup and rollback

All state lives in `/data/knecht/data` (SQLite database, run archives, uploaded dumps). Back that folder up, or snapshot the server. Database migrations run forward only: rolling back to an older release does not roll the schema back, so take a copy of `/data/knecht/data` before updating if you want a safe return path.

### Notes for operators

- Let's Encrypt issues at most 50 new certificates per week per domain. Each newly visited preview hostname uses one; renewals don't. Heavy multi-user instances can switch to a wildcard certificate instead: delegate the preview subzone to a DNS provider with API access (e.g. `preview.knecht.example.com NS -> Hetzner DNS`, the main zone stays put), build Caddy with the matching DNS plugin, and replace `on_demand` with `tls { dns <provider> }` in the Caddyfile.
- The GHCR package must be public for anonymous pulls (one-time repo setting after the first release).

## Development Setup

Knecht needs a Linux host with Docker and the [ddev](https://ddev.com) CLI.
For local development there is a Lima VM that provides exactly that.

```bash
# Install dependencies
npm install

# Prepare the environment
cp .env.example .env   # adjust the values (see the comments in the file)

# Run database migrations
npm run db:migrate

# Start the dashboard
npm run dev
```

> [!NOTE]
> Running project environments requires a Linux host with Docker and ddev.
> Details on host setup live in `.env.example` and the provisioning scripts
> under `scripts/`.

