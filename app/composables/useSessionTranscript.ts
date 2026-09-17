import { PR_COMMAND, PUBLISH_FOLLOWUP_PROMPT } from '#shared/utils/followup'

export type ChatItemStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

export interface ChatItem {
  id: number
  followupId: number
  seq: number
  type: 'message' | 'tool' | 'usage' | 'notice' | 'divider'
  text: string
  kind: string | null
  status: ChatItemStatus | null
  output: string | null
  diff: { path: string, oldText: string | null, newText: string } | null
  locations: string[] | null
  cost: number | null
  tokens: { used: number, size: number } | null
}

export interface ChatAttachment {
  name: string
  size: number
  type: string
}

export type FollowupStatus = 'queued' | 'running' | 'success' | 'failed'

export interface ChatTurn {
  id: number
  runId: number
  prompt: string
  model: string | null
  attachments: ChatAttachment[]
  requestedBy: string | null
  origin: 'dashboard' | 'mention'
  status: FollowupStatus
  error: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  items: ChatItem[]
  // Shown before the server confirmed it; a negative id until then.
  optimistic?: boolean
  // Survives the swap from the temporary to the real id so the bubble is not re-mounted.
  key?: string
}

export interface ChatRun {
  id: number
  workflow: string
  kind: 'workflow' | 'mention'
  status: RunStatus
  prUrl: string | null
  createdAt: string
  finishedAt: string | null
}

interface TranscriptResponse {
  runs: ChatRun[]
  followups: ChatTurn[]
}

const STATUS_RANK: Record<FollowupStatus, number> = { queued: 0, running: 1, success: 2, failed: 2 }

export function isTurnActive(turn: Pick<ChatTurn, 'status'>): boolean {
  return turn.status === 'queued' || turn.status === 'running'
}

// The chat's state for one Knecht session: loaded once, then patched from the session's event stream.
export function useSessionTranscript(sessionId: number, runId: () => number) {
  const runs = ref<ChatRun[]>([])
  const turns = ref<ChatTurn[]>([])
  const connected = ref(false)

  const { data, refresh, status: loadStatus } = useFetch<TranscriptResponse>(`/api/sessions/${sessionId}/transcript`, { lazy: true })
  const loaded = computed(() => loadStatus.value !== 'idle' && loadStatus.value !== 'pending')

  // A fetch answers from before the newest events: never let it move a turn backwards.
  watch(data, (d) => {
    if (!d) return
    runs.value = d.runs
    const known = new Map(turns.value.map(t => [t.id, t]))
    turns.value = [
      ...d.followups.map((f) => {
        const cur = known.get(f.id)
        return cur && STATUS_RANK[cur.status] > STATUS_RANK[f.status] ? { ...cur, items: mergeItems(cur.items, f.items) } : f
      }),
      ...turns.value.filter(t => t.optimistic),
    ]
  })

  // The stream often delivers the new row before the POST answers: the optimistic bubble becomes that row.
  function applyTurn(f: Omit<ChatTurn, 'items'>) {
    const cur = turns.value.find(t => t.id === f.id)
    if (!cur) {
      const temp = turns.value.find(t => t.optimistic && t.status !== 'failed' && sameMessage(t.prompt, f.prompt))
      if (temp) Object.assign(temp, f, { optimistic: false })
      else turns.value.push({ ...f, items: [] })
      return
    }
    if (STATUS_RANK[f.status] < STATUS_RANK[cur.status]) return
    Object.assign(cur, f)
  }

  function applyItem(item: ChatItem) {
    const turn = turns.value.find(t => t.id === item.followupId)
    if (!turn) return
    const i = turn.items.findIndex(x => x.id === item.id)
    if (i === -1) {
      turn.items.push(item)
      turn.items.sort((a, b) => a.seq - b.seq)
    }
    else {
      turn.items[i] = item
    }
  }

  function reset(f: Omit<ChatTurn, 'items'>) {
    const i = turns.value.findIndex(t => t.id === f.id)
    if (i === -1) turns.value.push({ ...f, items: [] })
    else turns.value[i] = { ...f, items: [] }
  }

  function remove(id: number) {
    const i = turns.value.findIndex(t => t.id === id)
    if (i !== -1) turns.value.splice(i, 1)
  }

  let source: EventSource | undefined
  onMounted(() => {
    source = new EventSource(`/api/sessions/${sessionId}/events`)
    source.addEventListener('open', () => {
      connected.value = true
      if (loaded.value) refresh()
    })
    source.addEventListener('error', () => {
      connected.value = false
    })
    source.addEventListener('item', e => applyItem(JSON.parse(e.data)))
    source.addEventListener('followup', e => applyTurn(JSON.parse(e.data)))
    source.addEventListener('followup-removed', e => remove(JSON.parse(e.data).id))
    source.addEventListener('followup-reset', e => reset(JSON.parse(e.data)))
  })
  onUnmounted(() => source?.close())

  const active = computed(() => turns.value.some(isTurnActive))
  usePollWhile(() => !connected.value && active.value, refresh)

  let nextTempId = -1
  async function send(prompt: string, extra: Record<string, string> = {}, files: File[] = []): Promise<void> {
    const temp: ChatTurn = {
      id: nextTempId--,
      runId: runId(),
      prompt,
      model: extra.model ?? null,
      attachments: files.map(f => ({ name: f.name, size: f.size, type: f.type })),
      requestedBy: null,
      origin: 'dashboard',
      status: 'queued',
      error: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      items: [],
      optimistic: true,
      key: `sent-${Date.now()}-${-nextTempId}`,
    }
    // The id is read once: when the stream claims the bubble first, the object itself gets the real id.
    const tempId = temp.id
    turns.value.push(temp)
    try {
      const created = await $fetch<Omit<ChatTurn, 'items'>>(`/api/runs/${runId()}/followups`, { method: 'POST', body: followupBody(prompt, extra, files) })
      const i = turns.value.findIndex(t => t.id === tempId)
      if (i === -1) return
      if (turns.value.some(t => t.id === created.id)) turns.value.splice(i, 1)
      else turns.value[i] = { ...created, items: [], key: temp.key }
    }
    catch (e) {
      const t = turns.value.find(x => x.id === tempId)
      if (t) {
        t.status = 'failed'
        t.error = errMsg(e, 'Could not send the message')
      }
      throw e
    }
  }

  async function unqueue(id: number): Promise<void> {
    const turn = turns.value.find(t => t.id === id)
    if (turn?.optimistic) {
      remove(id)
      return
    }
    await $fetch(`/api/followups/${id}`, { method: 'DELETE' })
    remove(id)
  }

  async function retry(id: number): Promise<void> {
    reset(await $fetch<Omit<ChatTurn, 'items'>>(`/api/followups/${id}/retry`, { method: 'POST' }))
  }

  async function stop(): Promise<void> {
    await $fetch(`/api/runs/${runId()}/followups/cancel`, { method: 'POST' })
  }

  return { runs, turns, active, connected, loaded, refresh, send, unqueue, retry, stop }
}

function mergeItems(current: ChatItem[], fetched: ChatItem[]): ChatItem[] {
  const byId = new Map(fetched.map(i => [i.id, i]))
  for (const item of current) byId.set(item.id, item)
  return [...byId.values()].sort((a, b) => a.seq - b.seq)
}

function sameMessage(sent: string, stored: string): boolean {
  return sent === stored || (sent === PR_COMMAND && stored === PUBLISH_FOLLOWUP_PROMPT)
}

function followupBody(prompt: string, extra: Record<string, string>, files: File[]): FormData | Record<string, string> {
  if (!files.length) return { prompt, ...extra }
  const form = new FormData()
  form.set('prompt', prompt)
  for (const [k, v] of Object.entries(extra)) form.set(k, v)
  for (const file of files) form.append('files', file, file.name)
  return form
}
