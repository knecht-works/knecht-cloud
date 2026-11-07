declare module '#auth-utils' {
  interface User {
    id: number
    login: string
    name: string | null
    avatarUrl: string | null
  }

  interface UserSession {
    // When the member last proved who they are; see server/utils/member-session.ts.
    elevatedAt?: number
  }
}

export {}
