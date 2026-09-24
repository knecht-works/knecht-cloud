<script setup lang="ts">
const { data, status, error, refresh } = useSystemInfo()

const { data: changelog, status: changelogStatus } = useFetch('/api/system/releases', { lazy: true })
const newReleases = computed(() => changelog.value?.releases.filter(r => r.isNew) ?? [])
const FULL_CHANGELOG_URL = 'https://github.com/knecht-works/knecht-cloud/releases'

const expanded = ref<Record<string, boolean>>({})
function toggleRelease(tag: string) {
  expanded.value[tag] = !expanded.value[tag]
}

function changeCount(notes: string): string {
  const n = notesLines(notes).filter(l => l.kind === 'item' || l.kind === 'title').length
  return n === 1 ? '1 change' : `${n} changes`
}

type NoteLine = { text: string, kind: 'heading' | 'title' | 'item' | 'text' }

const LEGACY_HEADINGS: Record<string, string> = { 'Breaking:': '⚠️ Breaking changes', 'New:': '🚀 New', 'Fixed:': '🐛 Fixed' }

function notesLines(notes: string): NoteLine[] {
  return notes
    .split('\n')
    .map(line => line.trim().replaceAll('**', '').replaceAll('`', ''))
    .filter(line => line && !/^full changelog/i.test(line))
    .map((line): NoteLine => {
      if (/^## /.test(line)) return { text: line.slice(3), kind: 'heading' }
      if (LEGACY_HEADINGS[line]) return { text: LEGACY_HEADINGS[line], kind: 'heading' }
      if (/^### /.test(line)) return { text: line.slice(4), kind: 'title' }
      if (/^[-*] /.test(line)) return { text: line.slice(2), kind: 'item' }
      return { text: line, kind: 'text' }
    })
}

const updating = ref(false)
const updateError = ref('')
const updateStale = ref(false)

async function runUpdate() {
  const target = data.value?.version.latest
  if (!target || updating.value) return
  updating.value = true
  updateError.value = ''
  try {
    await $fetch('/api/system/update', { method: 'POST' })
  }
  catch (err) {
    updating.value = false
    updateError.value = (err as { data?: { message?: string } }).data?.message || 'Update failed to start.'
    return
  }
  const startedAt = Date.now()
  const poll = setInterval(async () => {
    try {
      const info = await $fetch('/api/system')
      if (info.version.current === target) {
        clearInterval(poll)
        location.reload()
      }
    }
    catch { /* container is restarting */ }
    if (Date.now() - startedAt > 2 * 60 * 1000) updateStale.value = true
  }, 5000)
}
</script>

<template>
  <KPanel
    title="Host · Sandbox"
    icon="i-lucide-server"
    accent="var(--primary)"
  >
    <template #action>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-refresh-cw"
        :loading="status === 'pending'"
        @click="refresh()"
      />
    </template>

    <div
      v-if="status === 'pending'"
      class="k-mono text-xs text-dimmed"
    >
      Loading system info…
    </div>
    <div
      v-else-if="error"
      class="k-mono text-xs text-error"
    >
      {{ error.message }}
    </div>
    <div
      v-else-if="data"
      class="grid grid-cols-1 gap-8 lg:grid-cols-2"
    >
      <div>
        <span class="k-label">System</span>
        <div class="mt-2.5 flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <span class="k-mono text-xs text-dimmed">knecht</span>
            <span class="k-mono text-xs text-toned">{{ data.version.current }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="k-mono text-xs text-dimmed">docker</span>
            <span class="k-mono text-xs text-toned">{{ data.dockerVersion }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="k-mono text-xs text-dimmed">ddev</span>
            <span
              class="k-mono text-xs"
              :class="data.ddevVersion ? 'text-toned' : 'text-error'"
            >{{ data.ddevVersion ?? 'missing' }}</span>
          </div>
        </div>
      </div>
      <div class="lg:border-l lg:border-muted lg:pl-8">
        <span class="k-label">Host containers · {{ data.hostContainers.length }}</span>
        <div class="mt-2.5 flex flex-col gap-2">
          <div
            v-for="name in data.hostContainers"
            :key="name"
            class="flex items-center gap-2"
          >
            <KStatusDot
              color="primary"
              :size="5"
            />
            <span class="k-mono text-2xs text-muted">{{ name }}</span>
          </div>
          <span
            v-if="!data.hostContainers.length"
            class="k-mono text-2xs text-dimmed"
          >None running.</span>
        </div>
      </div>

      <div class="border-t border-muted pt-6 lg:col-span-2">
        <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span class="k-label">What's new</span>
          <div class="flex items-center gap-4">
            <a
              :href="FULL_CHANGELOG_URL"
              target="_blank"
              rel="noopener"
              class="k-mono flex items-center gap-1 text-2xs text-dimmed transition-colors hover:text-toned"
            >
              Full changelog
              <UIcon
                name="i-lucide-arrow-up-right"
                class="size-3"
              />
            </a>
            <UButton
              v-if="data.version.updateAvailable"
              color="primary"
              icon="i-lucide-arrow-up-circle"
              :loading="updating"
              @click="runUpdate()"
            >
              {{ updating ? `Updating to ${data.version.latest}…` : `Update to ${data.version.latest}` }}
            </UButton>
          </div>
        </div>
        <span
          v-if="updateError"
          class="k-mono mt-2 block text-2xs text-error"
        >{{ updateError }}</span>
        <span
          v-if="updateStale"
          class="k-mono mt-2 block text-2xs text-dimmed"
        >Still updating. Check `docker logs knecht-updater` on the server.</span>
        <div
          v-if="changelogStatus === 'pending'"
          class="k-mono mt-3 text-xs text-dimmed"
        >
          Loading changelog…
        </div>
        <div
          v-else-if="!newReleases.length"
          class="k-mono mt-3 text-xs text-dimmed"
        >
          Up to date. Nothing to install.
        </div>
        <div
          v-else
          class="mt-2 flex flex-col"
        >
          <div
            v-for="rel in newReleases"
            :key="rel.tag"
            class="border-b border-muted last:border-0"
          >
            <button
              type="button"
              class="group/row flex w-full cursor-pointer items-center gap-2.5 py-2.5 text-left"
              @click="toggleRelease(rel.tag)"
            >
              <UIcon
                name="i-lucide-chevron-right"
                class="size-3.5 flex-none text-dimmed transition-[transform,color] group-hover/row:text-primary"
                :class="expanded[rel.tag] && 'rotate-90'"
              />
              <span class="k-mono text-xs text-toned transition-colors group-hover/row:text-highlighted">{{ rel.tag }}</span>
              <span class="k-mono text-2xs text-dimmed">{{ timeAgo(rel.publishedAt) }}</span>
              <span class="k-mono ml-auto text-2xs text-dimmed">{{ changeCount(rel.notes) }}</span>
            </button>
            <ul
              v-if="expanded[rel.tag]"
              class="flex flex-col gap-1.5 pb-3 pl-6"
            >
              <li
                v-for="(line, i) in notesLines(rel.notes)"
                :key="i"
                class="flex gap-2 leading-normal"
                :class="{
                  'k-mono mt-1 text-2xs font-medium text-toned first:mt-0': line.kind === 'heading',
                  'mt-1 text-xs font-medium text-highlighted': line.kind === 'title',
                  'k-mono text-2xs text-muted': line.kind === 'item',
                  'max-w-prose text-xs text-muted': line.kind === 'text',
                }"
              >
                <span
                  v-if="line.kind === 'item'"
                  class="flex-none text-dimmed"
                >·</span>
                <span class="min-w-0 break-words">{{ line.text }}</span>
              </li>
              <li
                v-if="!notesLines(rel.notes).length"
                class="k-mono text-2xs text-dimmed"
              >
                No notes.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </KPanel>
</template>
