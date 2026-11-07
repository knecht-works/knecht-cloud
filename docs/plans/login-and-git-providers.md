# Login without GitHub, then several git providers

Today the GitHub App is three things at once: the way to log in, a requirement of the setup, and the access to repositories. This plan separates them in two parts. Part A makes login independent of GitHub. Part B turns the GitHub App into one git connection among several and adds GitLab. A comes first: once login no longer depends on GitHub, the GitHub App is just a connection.

## Decisions

### Members and login

- A member has its own Knecht username, unique within the instance and case-insensitive. Existing members keep their GitHub login as username.
- Login methods: username and password, and the identities of the connected git providers (GitHub now, GitLab later). Google and other login-only providers are out of scope for now.
- Every identity linked to a member can be used to log in. A member may remove a login method as long as one remains.
- Identities are matched by the provider's user id (`subject`), not by username, because usernames can be renamed.
- New members join only by invite link: single use, valid for 7 days, revocable, member role. No domain allowlist.
- A forgotten password is reset with a single-use link an owner creates. An owner without another owner resets their password with a CLI command on the server.
- Passwords have a minimum length of 12 characters, and login attempts are rate limited. No 2FA for now.
- `/setup` creates the first owner with username and password while the instance has no members. The GitHub App is set up later in the settings and is optional.
- An instance can have several owners, and at least one always remains. Only owners manage connections, login settings and invites.
- A removed member loses access on the next request (the auth middleware re-checks membership on every request).

### Mentions

- A mention in a git tool is attributed to a member only through a verified identity, that is one linked by OAuth login. Unlinking an identity removes the attribution for that provider.
- Migration: members who have logged in before get a verified GitHub identity. Members who were invited by GitHub username but never logged in get a pending identity: logging in with that GitHub username claims it, and their mentions count only from then on.

### Git providers

- One connection per provider type for the whole instance.
- All projects of a git trigger are on the same provider.
- Connections, the GitHub App included, are set up in the settings.
- GitLab connection: instance URL (gitlab.com or self-hosted), an access token (any kind; the docs recommend the personal access token of a dedicated bot user), and an OAuth application for login and linking. Knecht shows the token's expiry date and warns before it runs out. The bot's username, read from the API, is the mention handle.
- Knecht creates a project's GitLab webhook through the API when the project is added and removes it when the project is deleted. Without the rights for it, Knecht shows URL and secret to add by hand.

## Steps

### Part A: login

1. **Decouple identity** (`refactor`). Members keep their id as the stable reference; the session stores it. New table `member_identities` (member, provider, subject, username, verified). Migration as decided above. GitHub login, invites and mentions go through identities.
2. **Invite links** (`feat`). Owners create invite links; the recipient picks username and password or signs in with GitHub. Inviting by GitHub username goes away.
3. **Username and password login** (`feat`). Minimum length and rate limit.
4. **Setup without GitHub** (`feat`). `/setup` creates the owner with a password; the GitHub App moves into the settings. Runs still require the GitHub App until part B.
5. **Link and unlink GitHub in the profile** (`feat`).
6. **Owner tools** (`feat`). Reset links, promoting owners, CLI reset, owner-only management.

### Part B: git providers

7. **Connections per provider** (`refactor` / `feat`). The run guard (`server/utils/triggers.ts`) checks the project's provider; `getBotIdentity` moves into `GitProvider`; the project setup picks a provider and uses generic `/api/git/...` endpoints; reading repository files for `projectMeta` no longer takes an Octokit.
8. **GitLab** (`feat`). `gitlabProvider`, the `gitlab` integration (webhooks, snapshots, comments, labels, reactions), the connection form, login and linking via the GitLab OAuth application, webhook management.
