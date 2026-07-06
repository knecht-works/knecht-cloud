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
- **Isolated sandboxes** - every project runs in its own container (Docker + Sysbox), fully separated from the others.
- **Workflows** - configurable pipelines that define what happens during a run.
- **GitHub integration** - connected as a GitHub App, delivers fixes straight as a pull request.
- **Preview environments** - every run gets its own URL to inspect.
- **Dashboard** - projects, runs, and workflows in one place, built with Nuxt UI.

## Hosting

The Knecht dashboard will be self hostable on your own server. You own your data. 

Hostind Docs coming soon...

## Development Setup

Knecht needs a Linux host with [Sysbox](https://github.com/nestybox/sysbox).
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
> Running sandboxes requires a Linux host with Sysbox. Details on isolation and
> host setup live in `.env.example` and the provisioning scripts under `scripts/`.

