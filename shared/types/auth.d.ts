declare module '#auth-utils' {
  interface User {
    login: string
    name: string | null
    avatarUrl: string
  }
}

export {}
