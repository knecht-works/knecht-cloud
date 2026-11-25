<script setup lang="ts">
import type { EnvTransition } from '#shared/utils/run'
import { computed, ref, onMounted, onUnmounted, watch } from 'vue'
import { useRequestURL } from '#imports'
import { previewLabel, previewHostname, isWebUrl, parsePreviewHost } from '#shared/utils/preview-host'
import { useResizableHeight } from '~/composables/useResizableHeight'
import KResizeHandle from '~/components/KResizeHandle.vue'
import { UButton, UIcon, UDropdownMenu, UTooltip } from '#components'

const props = withDefaults(defineProps<{
  sessionId: number
  hosts?: string[]
  online?: boolean
  busy?: EnvTransition | null
}>(), {
  hosts: () => [],
  online: false,
  busy: null,
})

const BUSY_COPY: Record<NonNullable<typeof props.busy>, { address: string, text: string }> = {
  booting: {
    address: 'Knecht is preparing the preview…',
    text: 'Knecht is booting the project. The preview appears here as soon as it\'s ready.',
  },
  stopping: {
    address: 'Knecht is stopping the environment…',
    text: 'Knecht is stopping the environment. The database is exported on the way down.',
  },
  rebooting: {
    address: 'Knecht is rebooting the environment…',
    text: 'Knecht is rebooting the environment. The preview is back in a few seconds.',
  },
  restoring: {
    address: 'Knecht is restoring the environment…',
    text: 'Knecht is restoring the environment from its archive. This takes a few minutes.',
  },
  archiving: {
    address: 'Knecht is archiving the environment…',
    text: 'Knecht is archiving the environment. Its code state and database are kept.',
  },
  expiring: {
    address: 'Knecht is deleting the archive…',
    text: 'The archive passed its retention period and is being deleted.',
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
const { el: viewport, height: viewportHeight, resizing, startResize } = useResizableHeight(240)
const frameSrc = ref(homeUrl)
const frameKey = ref(0)
const currentUrl = ref(homeUrl)
const bridged = ref(false)
const stack = ref<string[]>([])
const pos = ref(-1)

const SCREENS = [
  { id: 'mobile', label: 'Mobile', icon: 'i-lucide-smartphone', width: 390, height: 844 },
  { id: 'tablet', label: 'Tablet', icon: 'i-lucide-tablet', width: 768, height: 1024 },
  { id: 'desktop', label: 'Desktop', icon: 'i-lucide-monitor', width: null, height: null },
] as const
const screen = ref<typeof SCREENS[number]>(SCREENS[2])

const DEVICE_GAP = 16
const viewportSize = ref({ width: 0, height: 0 })
let viewportObserver: ResizeObserver | undefined
onMounted(() => {
  viewportObserver = new ResizeObserver(([entry]) => {
    if (entry) viewportSize.value = { width: entry.contentRect.width, height: entry.contentRect.height }
  })
  viewportObserver.observe(viewport.value!)
})
onUnmounted(() => viewportObserver?.disconnect())

const device = computed(() => {
  const { width, height } = screen.value
  if (!width) return null
  const scale = Math.min(
    1,
    (viewportSize.value.width - DEVICE_GAP * 2) / width,
    (viewportSize.value.height - DEVICE_GAP * 2) / height,
  )
  return { width, height, scale }
})

const canBack = computed(() => pos.value > 0)
const canForward = computed(() => pos.value < stack.value.length - 1)

function onMessage(e: MessageEvent) {
  const data = e.data as { knecht?: string, href?: string } | null
  if (data?.knecht !== 'nav' || typeof data.href !== 'string' || !isWebUrl(data.href)) return
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
      <div class="flex flex-1 items-center gap-3">
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
      </div>

      <div class="flex min-w-0 flex-[0_1_36rem] items-center">
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

      <div class="flex flex-1 items-center justify-end gap-3">
        <div class="flex flex-none items-center gap-0.5 rounded-md bg-(--surface-base) p-0.5">
          <UTooltip
            v-for="s in SCREENS"
            :key="s.id"
            :text="s.label"
          >
            <button
              type="button"
              :aria-label="`${s.label} screen`"
              :aria-pressed="screen.id === s.id"
              :disabled="!live"
              class="flex cursor-pointer items-center rounded-sm px-2 py-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              :class="screen.id === s.id ? 'bg-(--surface-accented) text-default' : 'text-dimmed hover:text-muted'"
              @click="screen = s"
            >
              <UIcon
                :name="s.icon"
                class="size-3.5"
              />
            </button>
          </UTooltip>
        </div>

        <div class="flex flex-none items-center gap-0.5">
          <UTooltip text="Open in new tab">
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
          </UTooltip>
          <slot name="actions" />
        </div>
      </div>
    </div>

    <div
      ref="viewport"
      class="relative aspect-video min-h-60 w-full bg-(--surface-base)"
      :style="viewportHeight ? { height: `${viewportHeight}px`, aspectRatio: 'auto' } : undefined"
    >
      <!-- The iframe would swallow pointermove while the handle is dragged across it. -->
      <div
        v-if="live"
        class="absolute inset-0 flex items-center justify-center overflow-hidden"
      >
        <div
          :class="device ? 'flex-none overflow-hidden rounded-xl ring-1 ring-accented' : 'size-full'"
          :style="device ? { width: `${device.width * device.scale}px`, height: `${device.height * device.scale}px` } : undefined"
        >
          <iframe
            :key="frameKey"
            ref="frame"
            :src="frameSrc"
            class="block origin-top-left"
            :class="{ 'pointer-events-none': resizing, 'size-full': !device }"
            :style="device ? { width: `${device.width}px`, height: `${device.height}px`, transform: `scale(${device.scale})` } : undefined"
          />
        </div>
      </div>
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
    <KResizeHandle @start="startResize" />
  </div>
</template>
