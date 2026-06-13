// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({

  modules: ['@nuxt/ui', '@nuxt/eslint', 'nuxt-auth-utils'],

  devtools: { enabled: true },

  css: ['~/assets/css/main.css'],

  // Scope the session cookie to a shared base domain so it is also sent to the
  // per-run preview subdomains (<runId>.preview.<base>), which the login-gated
  // preview proxy needs. Unset → host-only (plain localhost; previews then can't
  // be gated cross-subdomain). Locally use a domain that accepts subdomain
  // cookies, e.g. KNECHT_BASE_DOMAIN=lvh.me and open the app at lvh.me:3000.
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
  compatibilityDate: '2025-07-15',

  vite: {
    server: {
      // The dev server otherwise rejects non-localhost hosts. Allow the base
      // domain and all its subdomains (incl. <runId>.preview.<base>) so the
      // preview origins work in dev. `.example.com` matches example.com + subs.
      allowedHosts: process.env.KNECHT_BASE_DOMAIN ? [`.${process.env.KNECHT_BASE_DOMAIN}`] : undefined,
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
