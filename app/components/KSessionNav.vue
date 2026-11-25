<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { RunStatus, SessionGroup } from '~/utils/dashboard'
import type { EnvState, EnvTransition } from '#shared/utils/run'
import { computed, ref, watch, nextTick, onMounted } from 'vue'
import { sessionObjectMeta, sessionTitle, sessionTicket, sessionBranch, sessionPr, projectStatusMeta, timeAgo, DOT_COLOR_VAR } from '~/utils/dashboard'
import { integrationUi } from '~/utils/integrations'
import KStatusBadge from '~/components/KStatusBadge.vue'
import { NuxtLink, UIcon, UTooltip } from '#components'
import { useRouter, $fetch } from '#imports'
import { liveTopics } from '#shared/utils/live-topics'
import { invalidate } from '~/composables/useLiveTopics'
import { useToastError } from '~/composables/useToastError'

interface Run {
  status: RunStatus
  envState: EnvState
  envTransition?: EnvTransition | null
  previewReady: boolean
  sessionStatus: 'open' | 'closed'
  workflow: string
  workflowId: number | null
  title: string | null
  branch: string | null
  prUrl: string | null
  createdAt: string | number | Date | null
  lastActivityAt?: string | number | Date | null
}

const props = defineProps<{
  groups: SessionGroup<Run>[]
  sessionTo: (group: SessionGroup<Run>) => RouteLocationRaw
  selectedSessionId?: number | null
  showDone?: boolean
}>()

// Manual sessions are named "New Preview Session" or "New Code Session" after how they started.
function sessionLabel(g: SessionGroup<Run>) {
  const first = g.runs.at(-1)!
  if (first.workflowId === null) return first.workflow.replace(/^New /, '')
  return first.workflow === sessionTitle(g) ? 'Workflow' : first.workflow
}

const rows = computed(() => props.groups.map((g) => {
  const head = g.runs[0]!
  const ticket = sessionTicket(g)
  const status = projectStatusMeta(head)
  const at = head.lastActivityAt ?? head.createdAt
  return {
    group: g,
    title: sessionTitle(g),
    status,
    // Archived, stopped and closed are what almost every session ends as, so only the rest earn a badge.
    notable: status.dot !== 'neutral',
    closed: head.sessionStatus === 'closed',
    manual: !g.objects.length,
    ticket: ticket && { ...ticket, meta: sessionObjectMeta(ticket.integration, ticket.kind) },
    label: sessionLabel(g),
    branch: sessionBranch(g),
    pr: sessionPr(g),
    at,
    atFull: at ? new Date(at).toLocaleString() : undefined,
  }
}))

type Row = (typeof rows.value)[number]

const active = computed(() => rows.value.filter(r => !r.closed))
const done = computed(() => rows.value.filter(r => r.closed))

const DONE_STEP = 25
const selectedDoneIndex = done.value.findIndex(r => r.group.sessionId === props.selectedSessionId)
const doneOpen = ref(props.showDone || selectedDoneIndex >= 0)
const doneLimit = ref(Math.max(10, selectedDoneIndex + 1))
const doneMore = computed(() => Math.min(DONE_STEP, done.value.length - doneLimit.value))

const toastError = useToastError()
const togglingId = ref<number | null>(null)
async function setStatus(r: Row, status: 'open' | 'closed') {
  togglingId.value = r.group.sessionId
  const next = status === 'open'
    ? r.group
    : r.group.sessionId === props.selectedSessionId
      ? active.value.find(x => x !== r)?.group
      : undefined
  try {
    await $fetch(`/api/sessions/${r.group.sessionId}/status`, { method: 'POST', body: { status } })
    await invalidate(liveTopics.runs)
    if (status === 'open') doneOpen.value = false
    if (next) open(next)
  }
  catch (e) {
    toastError(status === 'closed' ? 'Could not mark the session done' : 'Could not reopen the session', e)
  }
  finally {
    togglingId.value = null
  }
}

// The stretched link sits below the tooltip targets, so a click on the branch opens the session itself.
const router = useRouter()
function open(g: SessionGroup<Run>) {
  router.replace(props.sessionTo(g))
}

const rowEls = new Map<number, HTMLElement>()
function setRowEl(sessionId: number, el: unknown) {
  if (el instanceof HTMLElement) rowEls.set(sessionId, el)
  else rowEls.delete(sessionId)
}

const hoveredSessionId = ref<number | null>(null)
// The title tooltip only repeats what is cut off, so it stays away while the title fits.
const hoveredTitleCut = ref(false)
function enterRow(sessionId: number, e: MouseEvent) {
  hoveredSessionId.value = sessionId
  const title = (e.currentTarget as HTMLElement).querySelector('[data-title]')
  hoveredTitleCut.value = !!title && title.scrollWidth > title.clientWidth
}
const box = ref<{ list: string, top: number, height: number } | null>(null)
// Only a box already on screen slides; one that appears just shows up where it belongs.
const boxSlides = ref(false)
function placeBox() {
  const id = hoveredSessionId.value ?? props.selectedSessionId
  const el = id == null ? undefined : rowEls.get(id)
  const next = el ? { list: el.dataset.list!, top: el.offsetTop, height: el.offsetHeight } : null
  boxSlides.value = !!box.value && box.value.list === next?.list
  box.value = next
}
watch([hoveredSessionId, () => props.selectedSessionId, () => props.groups], () => nextTick(placeBox))
onMounted(placeBox)
</script>

<template>
  <div
    class="relative flex min-h-0 flex-1 flex-col"
    @mouseleave="hoveredSessionId = null"
  >
    <div
      class="k-scrollbar-none relative isolate flex min-h-0 flex-1 flex-col gap-px overflow-y-auto"
      :class="done.length ? 'pb-12' : ''"
    >
      <span
        v-if="box?.list === 'active'"
        class="pointer-events-none absolute inset-x-0 top-0 rounded-md border border-default bg-(--surface-glass) ease-out"
        :class="boxSlides ? 'transition-[translate,height] duration-200' : ''"
        :style="{ translate: `0 ${box.top}px`, height: `${box.height}px` }"
      />
      <p
        v-if="!active.length && done.length"
        class="px-3 py-2 text-2sm text-muted"
      >
        No active sessions.
      </p>
      <div
        v-for="r in active"
        :key="r.group.sessionId"
        :ref="el => setRowEl(r.group.sessionId, el)"
        data-list="active"
        class="group relative flex flex-col gap-0.5 rounded-md px-3 py-3"
        @mouseenter="enterRow(r.group.sessionId, $event)"
      >
        <span
          v-if="r.group.sessionId === selectedSessionId"
          class="pointer-events-none absolute inset-y-3 -left-px w-0.5 rounded-sm"
          :style="{ background: DOT_COLOR_VAR[r.status.dot], boxShadow: `0 0 8px ${DOT_COLOR_VAR[r.status.dot]}` }"
        />
        <UTooltip
          :text="r.title"
          :content="{ side: 'right' }"
          :delay-duration="800"
          :disabled="!hoveredTitleCut"
        >
          <NuxtLink
            :to="sessionTo(r.group)"
            replace
            class="absolute inset-0 z-1"
            :aria-label="`Open session ${r.title}`"
            :aria-current="r.group.sessionId === selectedSessionId ? 'true' : undefined"
          />
        </UTooltip>
        <div class="flex h-4 items-center gap-2">
          <div class="flex min-w-0 flex-1">
            <UTooltip
              v-if="r.ticket"
              :text="`Open ${integrationUi(r.ticket.integration).label} ${r.ticket.meta.label}`"
              :disabled="!r.ticket.url"
            >
              <component
                :is="r.ticket.url ? 'a' : 'span'"
                :href="r.ticket.url ?? undefined"
                :target="r.ticket.url ? '_blank' : undefined"
                class="relative z-2 flex min-w-0 items-center gap-1.5 text-xs text-muted transition-colors"
                :class="r.ticket.url ? 'hover:text-highlighted' : ''"
              >
                <UIcon
                  :name="r.ticket.meta.icon"
                  class="size-3 flex-none"
                  :style="{ color: r.ticket.closed ? 'var(--text-dimmed)' : r.ticket.meta.color }"
                />
                <span class="truncate">{{ r.ticket.meta.prefix }}{{ r.ticket.key }}</span>
              </component>
            </UTooltip>
            <span
              v-else-if="r.label"
              class="min-w-0 truncate text-xs text-dimmed"
            >{{ r.label }}</span>
          </div>
          <div
            class="flex flex-none items-center"
            :class="r.manual ? 'group-focus-within:hidden group-hover:hidden' : ''"
          >
            <KStatusBadge
              v-if="r.notable && r.group.sessionId !== selectedSessionId"
              :meta="r.status"
            />
            <UTooltip
              v-else
              :text="r.atFull"
              :disabled="!r.atFull"
            >
              <span class="relative z-2 flex-none text-xs tabular-nums text-dimmed">{{ timeAgo(r.at).replace(' ago', '') }}</span>
            </UTooltip>
          </div>
          <UTooltip
            v-if="r.manual"
            text="Mark done"
          >
            <button
              type="button"
              class="relative z-2 -my-1 hidden size-6 flex-none cursor-pointer items-center justify-center rounded-md text-dimmed transition-colors hover:bg-(--surface-accented) hover:text-highlighted group-focus-within:flex group-hover:flex"
              :aria-label="`Mark done: ${r.title}`"
              :disabled="togglingId === r.group.sessionId"
              @click="setStatus(r, 'closed')"
            >
              <UIcon
                name="i-lucide-check"
                class="size-3.5"
              />
            </button>
          </UTooltip>
        </div>
        <p
          data-title
          class="truncate text-sm font-medium leading-snug"
          :class="r.group.sessionId === selectedSessionId ? 'text-highlighted' : r.closed ? 'text-muted' : 'text-toned'"
        >
          {{ r.title }}
        </p>
        <div
          v-if="r.branch || r.pr"
          class="flex items-center gap-3 text-xs text-dimmed"
        >
          <UTooltip
            v-if="r.branch"
            :text="r.branch"
          >
            <span
              class="relative z-2 flex min-w-0 cursor-pointer items-center gap-1"
              @click="open(r.group)"
            >
              <UIcon
                name="i-lucide-git-branch"
                class="size-3 flex-none"
              />
              <span class="truncate">{{ r.branch }}</span>
            </span>
          </UTooltip>
          <UTooltip
            v-if="r.pr"
            :text="r.pr.closed ? 'Open pull request (closed)' : 'Open pull request'"
          >
            <a
              :href="r.pr.url"
              target="_blank"
              rel="noopener"
              class="relative z-2 ml-auto flex flex-none items-center gap-1 tabular-nums transition-colors hover:text-muted"
            >
              <UIcon
                name="i-lucide-git-pull-request"
                class="size-3"
                :style="{ color: r.pr.closed ? 'var(--text-dimmed)' : 'var(--primary)' }"
              />
              {{ r.pr.label }}
            </a>
          </UTooltip>
        </div>
      </div>
    </div>
    <div
      v-if="done.length"
      class="absolute -inset-x-5 bottom-0 flex flex-col overflow-hidden bg-(--surface-base) transition-[height] duration-300 ease-out before:absolute before:inset-x-5 before:top-0 before:border-t before:border-default"
      :class="doneOpen ? 'h-full' : 'h-12'"
    >
      <button
        type="button"
        class="flex h-12 flex-none cursor-pointer items-center gap-2 px-8 text-left text-sm text-muted transition-colors hover:text-highlighted"
        :aria-expanded="doneOpen"
        @click="doneOpen = !doneOpen"
      >
        Done
        <span class="ml-auto text-xs tabular-nums text-dimmed">{{ done.length }}</span>
        <UIcon
          name="i-lucide-chevron-right"
          class="size-3.5 text-dimmed transition-transform"
          :class="doneOpen ? 'rotate-90' : ''"
        />
      </button>
      <div
        class="k-scrollbar-none relative flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-5 pb-2"
        :inert="!doneOpen"
      >
        <span
          v-if="box?.list === 'done'"
          class="pointer-events-none absolute inset-x-5 top-0 rounded-md border border-default bg-(--surface-glass) ease-out"
          :class="boxSlides ? 'transition-[translate,height] duration-200' : ''"
          :style="{ translate: `0 ${box.top}px`, height: `${box.height}px` }"
        />
        <div
          v-for="r in done.slice(0, doneLimit)"
          :key="r.group.sessionId"
          :ref="el => setRowEl(r.group.sessionId, el)"
          data-list="done"
          class="group relative flex h-9 flex-none items-center gap-2.5 rounded-md px-3 text-sm"
          @mouseenter="enterRow(r.group.sessionId, $event)"
        >
          <NuxtLink
            :to="sessionTo(r.group)"
            replace
            class="absolute inset-0 z-1"
            :aria-label="`Open session ${r.title}`"
            :aria-current="r.group.sessionId === selectedSessionId ? 'true' : undefined"
          />
          <UIcon
            :name="r.ticket?.meta.icon ?? (r.pr ? 'i-lucide-git-pull-request' : 'i-lucide-message-square')"
            class="size-3.5 flex-none text-dimmed"
          />
          <span
            data-title
            class="min-w-0 flex-1 truncate"
            :class="r.group.sessionId === selectedSessionId ? 'text-highlighted' : 'text-muted'"
          >{{ r.title }}</span>
          <div
            class="flex flex-none items-center gap-2.5"
            :class="r.manual ? 'group-focus-within:hidden group-hover:hidden' : ''"
          >
            <span class="text-xs tabular-nums text-dimmed">{{ timeAgo(r.at).replace(' ago', '') }}</span>
          </div>
          <UTooltip
            v-if="r.manual"
            text="Reopen"
          >
            <button
              type="button"
              class="relative z-2 -mr-1.5 hidden size-6 flex-none cursor-pointer items-center justify-center rounded-md text-dimmed transition-colors hover:bg-(--surface-accented) hover:text-highlighted group-focus-within:flex group-hover:flex"
              :aria-label="`Reopen: ${r.title}`"
              :disabled="togglingId === r.group.sessionId"
              @click="setStatus(r, 'open')"
            >
              <UIcon
                name="i-lucide-rotate-ccw"
                class="size-3.5"
              />
            </button>
          </UTooltip>
        </div>
        <button
          v-if="doneMore > 0"
          type="button"
          class="flex flex-none cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm text-dimmed transition-colors hover:text-muted"
          @click="doneLimit += DONE_STEP"
        >
          <UIcon
            name="i-lucide-chevron-down"
            class="size-3.5"
          />
          Show {{ doneMore }} more
        </button>
      </div>
    </div>
  </div>
</template>
