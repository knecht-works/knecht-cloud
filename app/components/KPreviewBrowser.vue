<script setup lang="ts">
import type { EnvTransition } from '#shared/utils/run'

const props = withDefaults(defineProps<{
  sessionId: number
  hosts?: string[]
  online?: boolean
  busy?: 'booting' | EnvTransition | null
}>(), {
  hosts: () => [],
  online: false,
  busy: null,
})

const BUSY_COPY: Record<NonNullable<typeof props.busy>, { label: string, address: string, text: string }> = {
  booting: {
    label: 'starting',
    address: 'Knecht is preparing the preview…',
    text: 'Knecht is booting the project. The preview appears here as soon as it\'s ready.',
  },
  stopping: {
    label: 'stopping',
    address: 'Knecht is stopping the environment…',
    text: 'Knecht is stopping the environment. The database is exported on the way down.',
  },
  rebooting: {
    label: 'rebooting',
    address: 'Knecht is rebooting the environment…',
    text: 'Knecht is rebooting the environment. The preview is back in a few seconds.',
  },
  restoring: {
    label: 'restoring',
    address: 'Knecht is restoring the environment…',
    text: 'Knecht is restoring the environment from its archive. This takes a few minutes.',
  },
  archiving: {
    label: 'archiving',
    address: 'Knecht is archiving the environment…',
    text: 'Knecht is archiving the environment. Its code state and database are kept.',
  },
}
const busyCopy = computed(() => props.busy ? BUSY_COPY[props.busy] : null)

const reqUrl = useRequestURL()
const primaryHost = computed(() => props.hosts[0] ?? null)

const live = computed(() => props.online && !props.busy)

function originFor(host: string | null): string {
  const label = host && host !== primaryHost.value ? previewLabel(host) : undefined
  return `${reqUrl.protocol}//${previewHostname(props.sessionId, reqUrl.host, label)}`
}

const homeUrl = `${originFor(null)}/`

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
  if (parsePreviewHost(new URL(e.origin).host)?.sessionId !== props.sessionId) return

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
  // '*' is safe: commands carry nothing sensitive and the bridge verifies the parent's
  // origin. Pinning the target only spams console errors on error pages (origin 'null').
  frame.value?.contentWindow?.postMessage({ knecht: 'cmd', action }, '*')
}

function go(url: string) {
  // Hard-navigate, not the bridge: must work from error pages and CSP-blocked bridges.
  if (frameSrc.value === url) frameKey.value++
  else frameSrc.value = url
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

const address = ref(displayUrl(homeUrl))
const editing = ref(false)

function displayUrl(url: string): string {
  try {
    const u = new URL(url)
    const target = parsePreviewHost(u.host)
    if (target?.sessionId === props.sessionId && props.hosts.length) {
      const host = target.label
        ? props.hosts.find(h => previewLabel(h) === target.label)
        : primaryHost.value
      if (host) return host + u.pathname + u.search + u.hash
    }
  }
  catch { /* not a URL, show as-is */ }
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

const hostItems = computed(() => props.hosts.map(host => ({
  label: host,
  onSelect: () => go(`${originFor(host)}/`),
})))
</script>

<template>
  <div
    class="overflow-hidden rounded-lg border border-default bg-(--surface-muted) shadow-browser"
  >
    <div class="flex items-center gap-3 border-b border-default bg-(--surface-elevated) px-4 py-2.5">
      <div class="flex flex-none items-center gap-2">
        <span class="size-3 rounded-full bg-error/80" />
        <span class="size-3 rounded-full bg-accent-violet/85" />
        <span class="size-3 rounded-full bg-accent-mint/85" />
      </div>

      <div class="flex flex-none items-center gap-0.5">
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          size="xs"
          aria-label="Back"
          :disabled="!live || !canBack"
          @click="post('back')"
        />
        <UButton
          icon="i-lucide-arrow-right"
          color="neutral"
          variant="ghost"
          size="xs"
          aria-label="Forward"
          :disabled="!live || !canForward"
          @click="post('forward')"
        />
        <UButton
          icon="i-lucide-rotate-cw"
          color="neutral"
          variant="ghost"
          size="xs"
          aria-label="Reload"
          :disabled="!live"
          @click="reload"
        />
      </div>

      <div class="flex min-w-0 flex-1 items-center">
        <div class="flex min-w-0 flex-1 items-center gap-2 rounded-sm bg-(--surface-base) px-3 py-1">
          <UIcon
            name="i-lucide-lock"
            class="size-3 flex-none text-muted"
          />
          <input
            v-if="live"
            v-model="address"
            type="text"
            spellcheck="false"
            autocomplete="off"
            aria-label="Preview address"
            class="k-mono min-w-0 flex-1 bg-transparent text-xs text-muted outline-none focus:text-default"
            @focus="editing = true; ($event.target as HTMLInputElement).select()"
            @blur="resetAddress"
            @keydown.enter="submitAddress(); ($event.target as HTMLInputElement).blur()"
            @keydown.esc="resetAddress(); ($event.target as HTMLInputElement).blur()"
          >
          <span
            v-else
            class="k-mono flex-1 truncate text-xs text-dimmed"
          >{{ busyCopy?.address ?? 'no live preview' }}</span>
          <UDropdownMenu
            v-if="live && hostItems.length > 1"
            :items="hostItems"
            :content="{ side: 'bottom', align: 'end' }"
          >
            <button
              type="button"
              aria-label="Switch preview host"
              class="flex flex-none cursor-pointer items-center text-dimmed transition-colors hover:text-muted"
            >
              <UIcon
                name="i-lucide-chevron-down"
                class="size-3.5"
              />
            </button>
          </UDropdownMenu>
        </div>
      </div>

      <span class="k-mono flex flex-none items-center gap-1.5 text-xs text-dimmed">
        <KStatusDot
          :color="live ? 'primary' : busyCopy ? 'orange' : 'neutral'"
          :pulse="!live && !!busyCopy"
          :glow="false"
          :size="6"
        />
        {{ live ? 'live' : busyCopy?.label ?? 'offline' }}
      </span>
      <UButton
        icon="i-lucide-external-link"
        color="neutral"
        variant="ghost"
        size="xs"
        aria-label="Open preview in a new tab"
        :disabled="!live"
        :to="live ? currentUrl : undefined"
        target="_blank"
      />
    </div>

    <div class="relative aspect-video w-full bg-(--surface-base)">
      <iframe
        v-if="live"
        :key="frameKey"
        ref="frame"
        :src="frameSrc"
        class="absolute inset-0 size-full"
      />
      <div
        v-else-if="busyCopy"
        class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center"
      >
        <img
          src="/mascot/mascotRight.png"
          alt="Knecht"
          class="h-24 w-auto drop-shadow-mascot"
        >
        <p class="flex items-center gap-2 text-2sm text-muted">
          <UIcon
            name="i-lucide-loader-circle"
            class="size-4 animate-spin text-dimmed"
          />
          {{ busyCopy.text }}
        </p>
      </div>
      <div
        v-else
        class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center"
      >
        <slot />
      </div>
    </div>
  </div>
</template>
