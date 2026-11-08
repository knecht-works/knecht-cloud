declare module '#auth-utils' {
  interface User {
    id: number
    login: string
    name: string | null
    avatarUrl: string | null
  }

  interface UserSession {
    // The member's session_version at login; see sessionMember in server/utils/member-session.ts.
    sessionVersion?: number
  }
}

export {}
