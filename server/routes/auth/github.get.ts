// GitHub OAuth: first hit redirects to GitHub, the callback lands back here and
// exchanges the code. The `repo` scope means the returned token can also clone
// repos and open PRs later — login doubles as the repo credential
// (internals/docs/tech-stack.md §3). Single-session gate, no user model.
export default defineOAuthGitHubEventHandler({
  config: {
    // read:user for the profile, repo for clone + PR access.
    scope: ['read:user', 'repo'],
  },

  async onSuccess(event, { user, tokens }) {
    await setUserSession(event, {
      user: {
        login: user.login,
        name: user.name,
        avatarUrl: user.avatar_url,
      },
      // `secure` is encrypted in the cookie and never exposed to the client.
      // Plaintext-at-rest debt is accepted for the MVP (tech-stack.md §2).
      secure: {
        githubToken: tokens.access_token,
      },
    })
    return sendRedirect(event, '/')
  },

  onError(event, error) {
    console.error('GitHub OAuth error:', error)
    return sendRedirect(event, '/login?error=oauth')
  },
})
