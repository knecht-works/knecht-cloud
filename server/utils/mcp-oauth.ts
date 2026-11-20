import { auth, type OAuthClientProvider, type OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { McpServer } from '#server/db/schema'
import { getMcpServer, updateMcpServer } from '#server/stores/mcp-servers'
import { decrypt, encrypt } from '#server/utils/crypto'
import { mcpServerUrl } from '#server/utils/mcp'

const REFRESH_MARGIN_MS = 60_000

export interface McpOAuthState {
  redirectUrl?: string
  client?: OAuthClientInformationMixed
  manualClient?: boolean
  tokens?: OAuthTokens
  expiresAt?: number
  verifier?: string
  discovery?: OAuthDiscoveryState
  pending?: McpOAuthState
}

export function readOAuthState(row: Pick<McpServer, 'oauthEnc'>): McpOAuthState {
  return row.oauthEnc ? JSON.parse(decrypt(row.oauthEnc)) as McpOAuthState : {}
}

export function encryptOAuthState(state: McpOAuthState): string {
  return encrypt(JSON.stringify(state))
}

class KnechtOAuthProvider implements OAuthClientProvider {
  authorizationUrl: URL | undefined

  constructor(private id: number, public data: McpOAuthState, private flowState = '', private inFlight = false) {}

  get redirectUrl() {
    return this.data.redirectUrl
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Knecht',
      redirect_uris: [this.data.redirectUrl!],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }
  }

  state() {
    return this.flowState
  }

  clientInformation() {
    return this.data.client
  }

  saveClientInformation(client: OAuthClientInformationMixed) {
    this.save({ client })
  }

  tokens() {
    return this.data.tokens
  }

  saveTokens(tokens: OAuthTokens) {
    const expiresAt = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined
    this.save({ tokens: { refresh_token: this.data.tokens?.refresh_token, ...tokens }, expiresAt })
  }

  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url
  }

  saveCodeVerifier(verifier: string) {
    this.save({ verifier })
  }

  codeVerifier() {
    if (!this.data.verifier) throw new Error('the sign-in was not started here')
    return this.data.verifier
  }

  discoveryState() {
    return this.data.discovery
  }

  saveDiscoveryState(discovery: OAuthDiscoveryState) {
    this.save({ discovery })
  }

  private save(patch: Partial<McpOAuthState>) {
    this.data = { ...this.data, ...patch }
    const state = this.inFlight ? { ...readOAuthState(getMcpServer(this.id)!), pending: this.data } : this.data
    updateMcpServer(this.id, { oauthEnc: encryptOAuthState(state) })
  }
}

// A fresh sign-in starts without tokens, so auth() cannot answer with a refresh instead of a redirect.
// It lives under `pending` until it finishes, so the working connection keeps its tokens meanwhile.
export async function startMcpOAuth(row: McpServer, redirectUrl: string, flowState: string): Promise<URL> {
  const { client, manualClient, discovery } = readOAuthState(row)
  const registered = client && 'redirect_uris' in client ? client.redirect_uris : undefined
  const keepClient = manualClient || !registered || registered.includes(redirectUrl)
  const provider = new KnechtOAuthProvider(row.id, {
    redirectUrl,
    discovery,
    ...(keepClient ? { client, manualClient } : {}),
  }, flowState, true)
  if (await auth(provider, { serverUrl: mcpServerUrl(row) }) !== 'REDIRECT' || !provider.authorizationUrl) {
    throw new Error('the server did not ask for a sign-in')
  }
  return provider.authorizationUrl
}

export async function finishMcpOAuth(row: McpServer, code: string, connectedBy: string): Promise<void> {
  const provider = new KnechtOAuthProvider(row.id, readOAuthState(row).pending ?? {}, '', true)
  await auth(provider, { serverUrl: mcpServerUrl(row), authorizationCode: code })
  updateMcpServer(row.id, { oauthEnc: encryptOAuthState({ ...provider.data, verifier: undefined }), connectedBy, connectedAt: new Date(), authError: null })
}

const refreshing = new Map<number, Promise<string>>()

export function mcpAccessToken(row: McpServer): Promise<string> {
  const data = readOAuthState(row)
  if (!row.connectedAt || !data.tokens) return Promise.reject(new Error('it is not connected yet, connect it in the settings'))
  if (!data.expiresAt || data.expiresAt > Date.now() + REFRESH_MARGIN_MS) return Promise.resolve(data.tokens.access_token)
  let pending = refreshing.get(row.id)
  if (!pending) {
    pending = refresh(row.id).finally(() => refreshing.delete(row.id))
    refreshing.set(row.id, pending)
  }
  return pending
}

async function refresh(id: number): Promise<string> {
  const row = getMcpServer(id)!
  const provider = new KnechtOAuthProvider(id, readOAuthState(row))
  try {
    if (!provider.data.tokens?.refresh_token || await auth(provider, { serverUrl: mcpServerUrl(row) }) !== 'AUTHORIZED') {
      throw new Error('its sign-in expired, connect it again in the settings')
    }
    if (row.authError) updateMcpServer(id, { authError: null })
    return provider.data.tokens!.access_token
  }
  catch (e) {
    updateMcpServer(id, { authError: (e as Error).message })
    throw e
  }
}

export function mcpSettingsPath(row: Pick<McpServer, 'projectId'>): string {
  return row.projectId === null ? '/settings/agent' : `/projects/${row.projectId}/settings/agent`
}
