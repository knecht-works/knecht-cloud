import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeProject } from '../helpers/db'

const catalog = vi.hoisted(() => ({ ids: [] as string[], fail: false }))
vi.mock('#server/utils/ai-catalog', () => ({
  loadModelCatalog: async () => {
    if (catalog.fail) throw new Error('catalog down')
    return catalog.ids.map(id => ({ id, name: id, provider: 'Test' }))
  },
}))

const { aiConnection, resolveAiConnection } = await import('#server/utils/ai-connection')
const { detachFromGlobalProvider, getProjectAiSettings, setProjectAiSettings } = await import('#server/stores/project-ai-settings')
const { updateSettings } = await import('#server/utils/settings')

updateSettings({ aiProvider: 'anthropic', aiRegion: 'eu', aiKeyEnc: 'global-key', aiModel: 'claude-opus-5-5', aiSubtaskModel: 'claude-sonnet-5' })

const NONE = { aiProvider: null, aiRegion: null, aiKeyEnc: null, aiModel: null, aiSubtaskModel: null }

function projectWithOwnKey() {
  const project = makeProject()
  setProjectAiSettings(project.id, { ...NONE, aiKeyEnc: 'project-key' })
  return project
}

function projectWithOwnConnection() {
  const project = makeProject()
  setProjectAiSettings(project.id, { aiProvider: 'openai', aiRegion: 'eu', aiKeyEnc: 'project-key', aiModel: 'gpt-5', aiSubtaskModel: null })
  return project
}

describe('resolveAiConnection', () => {
  beforeEach(() => {
    catalog.ids = ['gpt-5', 'gpt-5-mini']
    catalog.fail = false
  })

  it('uses the global connection for a project without its own', async () => {
    const project = makeProject()
    expect(await resolveAiConnection(project.id, null)).toMatchObject({ connection: { aiKeyEnc: 'global-key' }, model: 'claude-opus-5-5' })
    expect(await resolveAiConnection(project.id, 'claude-sonnet-5')).toMatchObject({ connection: { aiKeyEnc: 'global-key' }, model: 'claude-sonnet-5' })
  })

  it('uses the project connection and its default model without a preferred model', async () => {
    const project = projectWithOwnConnection()
    expect(await resolveAiConnection(project.id, undefined)).toMatchObject({ connection: { aiProvider: 'openai', aiKeyEnc: 'project-key' }, model: 'gpt-5' })
  })

  it('runs a preferred model on the project connection when its provider offers it', async () => {
    const project = projectWithOwnConnection()
    expect(await resolveAiConnection(project.id, 'openai/gpt-5-mini')).toMatchObject({ connection: { aiKeyEnc: 'project-key' }, model: 'gpt-5-mini' })
  })

  it('falls back to the global connection when the project provider lacks the preferred model', async () => {
    const project = projectWithOwnConnection()
    expect(await resolveAiConnection(project.id, 'claude-opus-5-5')).toMatchObject({ connection: { aiProvider: 'anthropic', aiKeyEnc: 'global-key' }, model: 'claude-opus-5-5' })
  })

  it('resolves the subtask reference to the subtask model, else the default model', async () => {
    expect(await resolveAiConnection(makeProject().id, '@subtask')).toMatchObject({ connection: { aiKeyEnc: 'global-key' }, model: 'claude-sonnet-5' })
    expect(await resolveAiConnection(projectWithOwnConnection().id, '@subtask')).toMatchObject({ connection: { aiKeyEnc: 'project-key' }, model: 'gpt-5' })
  })

  it('stays on the project connection when its catalog cannot be loaded', async () => {
    const project = projectWithOwnConnection()
    catalog.fail = true
    expect(await resolveAiConnection(project.id, 'claude-opus-5-5')).toMatchObject({ connection: { aiKeyEnc: 'project-key' }, model: 'claude-opus-5-5' })
  })
})

describe('aiConnection', () => {
  it('returns the project connection when set, else the global one', () => {
    expect(aiConnection(projectWithOwnConnection().id)).toMatchObject({ aiKeyEnc: 'project-key', aiSubtaskModel: null })
    expect(aiConnection(makeProject().id)).toMatchObject({ aiKeyEnc: 'global-key', aiSubtaskModel: 'claude-sonnet-5' })
    expect(aiConnection(null)).toMatchObject({ aiKeyEnc: 'global-key' })
  })

  it('inherits every field the project leaves empty under the global provider', () => {
    const project = makeProject()
    setProjectAiSettings(project.id, { ...NONE, aiKeyEnc: 'project-key', aiSubtaskModel: 'claude-haiku-5' })
    expect(aiConnection(project.id)).toEqual({ aiProvider: 'anthropic', aiRegion: 'eu', aiKeyEnc: 'project-key', aiModel: 'claude-opus-5-5', aiSubtaskModel: 'claude-haiku-5' })
  })

  it('keeps a preferred model on the project key when the provider is inherited', async () => {
    expect(await resolveAiConnection(projectWithOwnKey().id, 'claude-sonnet-5')).toMatchObject({ connection: { aiKeyEnc: 'project-key' }, model: 'claude-sonnet-5' })
  })
})

describe('detachFromGlobalProvider', () => {
  it('pins projects with their own key to the previous provider and resets the rest', () => {
    const withKey = projectWithOwnKey()
    const modelOnly = makeProject()
    setProjectAiSettings(modelOnly.id, { ...NONE, aiModel: 'claude-sonnet-5' })
    const own = projectWithOwnConnection()
    detachFromGlobalProvider({ aiProvider: 'anthropic', aiRegion: 'eu', aiModel: 'claude-opus-5-5', aiSubtaskModel: null })
    expect(getProjectAiSettings(withKey.id)).toMatchObject({ aiProvider: 'anthropic', aiRegion: 'eu', aiKeyEnc: 'project-key', aiModel: 'claude-opus-5-5' })
    expect(getProjectAiSettings(modelOnly.id)).toBeUndefined()
    expect(getProjectAiSettings(own.id)).toMatchObject({ aiProvider: 'openai', aiModel: 'gpt-5' })
  })
})
