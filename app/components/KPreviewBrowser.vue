<script setup lang="ts">
// Browser chrome around the live preview iframe: back/forward/reload, an
// editable address bar, a host switcher (multisite projects serve several
// hostnames — each has its own per-run preview origin) and open-in-new-tab.
// The frame is cross-origin, so navigation state comes from the bridge script
// the preview proxy injects into every HTML response (preview-proxy.ts): the
// frame posts `nav` messages up, the chrome posts `cmd` messages down. The
// default slot renders inside the (16/9) viewport while the preview is offline.
const props = withDefaults(defineProps<{
  runId: number
  /** All ddev hostnames the run serves, primary first (run.previewHosts). */
  hosts?: string[]
  online?: boolean
}>(), {
  hosts: () => [],
  online: false,
})

const reqUrl = useRequestURL()
const primaryHost = computed(() => props.hosts[0] ?? null)

// The per-run preview origin for one of the project's ddev hostnames.
function originFor(host: string | null): string {
  const label = host && host !== primaryHost.value ? previewLabel(host) : undefined
  return `${reqUrl.protocol}//${previewHostname(props.runId, reqUrl.host, label)}`
}

const homeUrl = `${originFor(null)}/`

// ── Navigation state, fed by the bridge ────────────────────────────────────
// Own back/forward stack mirroring the frame's session history: a reported
// href matching the previous/next entry is a back/forward move, anything else
// a new navigation (which truncates the forward tail, like a real browser).
const frame = ref<HTMLIFrameElement>()
const frameSrc = ref(homeUrl)
const frameKey = ref(0)
const currentUrl = ref(homeUrl)
const bridged = ref(false)
const stack = ref<string[]>([])
const pos = ref(-1)

const canBack = computed(() => pos.value > 0)
const canForward = computed(() => pos.value < stack.value.length - 1)

function onMessage(e: MessageEvent) {
  const data = e.data as { knecht?: string, href?: string } | null
  if (data?.knecht !== 'nav' || typeof data.href !== 'string') return
  if (e.source !== frame.value?.contentWindow) return
  // Only trust this run's preview origins.
  if (parsePreviewHost(new URL(e.origin).host)?.runId !== props.runId) return

  bridged.value = true
  currentUrl.value = data.href
  if (stack.value[pos.value] === data.href) return // reload
  if (stack.value[pos.value - 1] === data.href) {
    pos.value--
  }
  else if (stack.value[pos.value + 1] === data.href) {
    pos.value++
  }
  else {
    stack.value = [...stack.value.slice(0, pos.value + 1), data.href]
    pos.value++
  }
}
onMounted(() => window.addEventListener('message', onMessage))
onUnmounted(() => window.removeEventListener('message', onMessage))

function post(action: string) {
  // Commands carry nothing sensitive and the bridge verifies the PARENT's
  // origin before acting, so '*' is safe — pinning the target would only
  // spam console errors whenever the frame sits on an error page (origin
  // 'null'), where no bridge is listening anyway.
  frame.value?.contentWindow?.postMessage({ knecht: 'cmd', action }, '*')
}

function go(url: string) {
  // Hard-navigate the frame itself rather than asking the bridge: it works
  // from ANY state — error pages, external pages, a CSP that blocked the
  // bridge — where a posted command would vanish into the void.
  if (frameSrc.value === url) frameKey.value++
  else frameSrc.value = url
  // Show the target right away; a bridged document confirms (or corrects)
  // it with its `nav` message once loaded — which also re-arms `bridged`,
  // so a reload after landing on a bridge-less page stays a hard reload.
  bridged.value = false
  currentUrl.value = url
}

function reload() {
  if (bridged.value) {
    post('reload')
  }
  else {
    frameKey.value++
  }
}

// ── Address bar ────────────────────────────────────────────────────────────
// The bar talks the PROJECT's world: the frame lives on per-run preview
// origins, but what the operator knows (and the dropdown lists, and the
// pasted .env points at) are the project's own hostnames — so preview
// origins are translated back to those for display, and typed project URLs
// are translated forward in resolveAddress. Editing detaches the bar until
// Enter navigates or blur snaps it back.
const address = ref(displayUrl(homeUrl))
const editing = ref(false)

function displayUrl(url: string): string {
  try {
    const u = new URL(url)
    const target = parsePreviewHost(u.host)
    if (target?.runId === props.runId && props.hosts.length) {
      const host = target.label
        ? props.hosts.find(h => previewLabel(h) === target.label)
        : primaryHost.value
      if (host) return host + u.pathname + u.search + u.hash
    }
  }
  catch { /* not a URL — show as-is */ }
  return url.replace(/^https?:\/\//, '')
}

watch(currentUrl, (url) => {
  if (!editing.value) address.value = displayUrl(url)
})

function submitAddress() {
  editing.value = false
  const input = address.value.trim()
  if (!input) return resetAddress()
  go(resolveAddress(input))
}

// Turn whatever was typed into a preview URL: paths resolve against the
// current origin, the project's own ddev hostnames map to THEIR preview
// origin (the .env / the app talk about those hosts, but only the preview
// origins are reachable from the browser), and bare words become paths.
function resolveAddress(input: string): string {
  const currentOrigin = (() => {
    try {
      return new URL(currentUrl.value).origin
    }
    catch {
      return originFor(null)
    }
  })()

  if (input.startsWith('/')) return currentOrigin + input
  if (!/^https?:\/\//.test(input) && !input.includes('.')) return `${currentOrigin}/${input}`

  try {
    const url = new URL(/^https?:\/\//.test(input) ? input : `${reqUrl.protocol}//${input}`)
    const ddevHost = props.hosts.find(h => h === url.hostname)
    if (ddevHost) return originFor(ddevHost) + url.pathname + url.search + url.hash
    return url.href
  }
  catch {
    return `${currentOrigin}/${input.replace(/^\/+/, '')}`
  }
}

function resetAddress() {
  editing.value = false
  address.value = displayUrl(currentUrl.value)
}

// ── Host switcher (multisite: one preview origin per ddev hostname) ────────
const hostItems = computed(() => props.hosts.map(host => ({
  label: host,
  onSelect: () => go(`${originFor(host)}/`),
})))
</script>

<template>
  <div
    class="overflow-hidden rounded-(--radius-lg) border border-(--border-default) bg-(--surface-muted)"
    style="box-shadow: var(--shadow-browser)"
  >
    <div class="flex items-center gap-3 border-b border-(--border-default) bg-(--surface-elevated) px-4 py-2.5">
      <div class="flex flex-none items-center gap-2">
        <span class="size-3 rounded-full bg-[rgba(248,113,113,0.8)]" />
        <span class="size-3 rounded-full bg-[rgba(252,196,110,0.85)]" />
        <span class="size-3 rounded-full bg-[rgba(183,248,162,0.85)]" />
      </div>

      <div class="flex flex-none items-center gap-0.5">
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          size="xs"
          aria-label="Back"
          :disabled="!online || !canBack"
          @click="post('back')"
        />
        <UButton
          icon="i-lucide-arrow-right"
          color="neutral"
          variant="ghost"
          size="xs"
          aria-label="Forward"
          :disabled="!online || !canForward"
          @click="post('forward')"
        />
        <UButton
          icon="i-lucide-rotate-cw"
          color="neutral"
          variant="ghost"
          size="xs"
          aria-label="Reload"
          :disabled="!online"
          @click="reload"
        />
      </div>

      <div class="flex min-w-0 flex-1 items-center">
        <div class="flex min-w-0 flex-1 items-center gap-2 rounded-(--radius-sm) bg-(--surface-base) px-3 py-1">
          <UIcon
            name="i-lucide-lock"
            class="size-[11px] flex-none text-(--text-muted)"
          />
          <input
            v-if="online"
            v-model="address"
            type="text"
            spellcheck="false"
            autocomplete="off"
            aria-label="Preview address"
            class="k-mono min-w-0 flex-1 bg-transparent text-xs text-(--text-muted) outline-none focus:text-(--text-default)"
            @focus="editing = true; ($event.target as HTMLInputElement).select()"
            @blur="resetAddress"
            @keydown.enter="submitAddress(); ($event.target as HTMLInputElement).blur()"
            @keydown.esc="resetAddress(); ($event.target as HTMLInputElement).blur()"
          >
          <span
            v-else
            class="k-mono flex-1 truncate text-xs text-(--text-dimmed)"
          >no live preview</span>
          <UDropdownMenu
            v-if="online && hostItems.length > 1"
            :items="hostItems"
            :content="{ side: 'bottom', align: 'end' }"
          >
            <button
              type="button"
              aria-label="Switch preview host"
              class="flex flex-none cursor-pointer items-center text-(--text-dimmed) transition-colors hover:text-(--text-muted)"
            >
              <UIcon
                name="i-lucide-chevron-down"
                class="size-3.5"
              />
            </button>
          </UDropdownMenu>
        </div>
      </div>

      <span class="k-mono flex flex-none items-center gap-1.5 text-xs text-(--text-dimmed)">
        <KStatusDot
          :color="online ? 'primary' : 'neutral'"
          :glow="false"
          :size="6"
        />
        {{ online ? 'live' : 'offline' }}
      </span>
      <UButton
        icon="i-lucide-external-link"
        color="neutral"
        variant="ghost"
        size="xs"
        aria-label="Open preview in a new tab"
        :disabled="!online"
        :to="online ? currentUrl : undefined"
        target="_blank"
      />
    </div>

    <div class="relative aspect-video w-full bg-(--surface-base)">
      <iframe
        v-if="online"
        :key="frameKey"
        ref="frame"
        :src="frameSrc"
        class="absolute inset-0 size-full"
      />
      <div
        v-else
        class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center"
      >
        <slot />
      </div>
    </div>
  </div>
</template>
