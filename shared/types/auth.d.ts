// Types the auth session everywhere (atidone pattern). `user` is what we set in
// server/routes/auth/github.get.ts: identity only; repo credentials come from
// the GitHub App (server/utils/github-app.ts), not the session.
declare module '#auth-utils' {
  interface User {
    login: string
    name: string | null
    avatarUrl: string
  }
}

export {}
