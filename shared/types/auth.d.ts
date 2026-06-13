// Types the auth session everywhere (atidone pattern). `user` is what we set in
// server/routes/auth/github.get.ts; `secure` is server-only (the repo token).
declare module '#auth-utils' {
  interface User {
    login: string
    name: string | null
    avatarUrl: string
  }

  interface SecureSessionData {
    // GitHub OAuth token — clone + PR credential. Server-only, never sent to the
    // client. Plaintext-at-rest is accepted MVP debt (tech-stack.md §2).
    githubToken: string
  }
}

export {}
