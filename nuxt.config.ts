// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({

  // @comark/nuxt renders the agent's markdown replies in the follow-up chat.
  modules: ['@nuxt/ui', '@nuxt/eslint', 'nuxt-auth-utils', '@comark/nuxt'],

  devtools: { enabled: true },

  app: {
    head: {
      link: [
        { rel: 'icon', type: 'image/png', href: '/favicon/favicon-96x96.png', sizes: '96x96' },
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon/favicon.svg' },
        { rel: 'shortcut icon', href: '/favicon/favicon.ico' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/favicon/apple-touch-icon.png' },
        { rel: 'manifest', href: '/favicon/site.webmanifest' },
      ],
    },
  },

  css: ['~/assets/css/main.css'],

  // The product ships in a single dark theme, no toggle.
  colorMode: {
    preference: 'dark',
    fallback: 'dark',
  },

  // Scope the session cookie to a shared base domain so it is also sent to the
  // per-run preview subdomains (<runId>.preview.<base>), which the login-gated
  // preview proxy needs. Unset → host-only (plain localhost; previews then can't
  // be gated cross-subdomain). Locally use a domain that accepts subdomain
  // cookies, e.g. KNECHT_BASE_DOMAIN=lvh.me and open the app at lvh.me:3333.
  // NOTE: this is evaluated at BUILD time. The CI-built release image has no
  // KNECHT_BASE_DOMAIN, so production overrides it at runtime via
  // NUXT_SESSION_COOKIE_DOMAIN (docker-compose.yml derives it from .env).
  runtimeConfig: {
    session: {
      cookie: {
        domain: process.env.KNECHT_BASE_DOMAIN || undefined,
        // http://lvh.me is NOT a secure context (unlike http://localhost), so a
        // Secure cookie would be dropped and login would loop. Off in dev; in
        // production (https) it stays on.
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },

  // Inside the dev VM the repo is a macOS virtiofs share whose inotify
  // forwarding is unreliable: silently missed events leave the dev server on
  // stale code. scripts/vm-dev.sh sets KNECHT_DEV_POLLING; then ALL watchers
  // (Nuxt's chokidar, Vite's, and Nitro's, the one rebuilding server/) poll
  // instead of trusting inotify.
  watchers: {
    chokidar: {
      usePolling: !!process.env.KNECHT_DEV_POLLING,
    },
  },

  compatibilityDate: '2025-07-15',

  nitro: {
    watchOptions: {
      usePolling: !!process.env.KNECHT_DEV_POLLING,
    },
    // The agent assets (knecht-git bridge CLI, opencode instruction
    // templates), bundled into the server build: plugins/agent-tools.ts
    // stages the CLI into the tools dir, actions/ai.ts seeds the per-run
    // opencode config from them.
    serverAssets: [{ baseName: 'sandbox', dir: '../sandbox' }],
  },

  vite: {
    server: {
      // The dev server otherwise rejects non-localhost hosts. Allow the base
      // domain and all its subdomains (incl. <runId>.preview.<base>) so the
      // preview origins work in dev. `.example.com` matches example.com + subs.
      allowedHosts: process.env.KNECHT_BASE_DOMAIN ? [`.${process.env.KNECHT_BASE_DOMAIN}`] : undefined,
      watch: {
        usePolling: !!process.env.KNECHT_DEV_POLLING,
        interval: 1000,
      },
    },
    optimizeDeps: {
      include: [
        '@vue/devtools-core',
        '@vue/devtools-kit',
      ],
    },
  },

  eslint: {
    config: {
      stylistic: true,
    },
  },
})
