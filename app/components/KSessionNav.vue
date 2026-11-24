<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { RunStatus, SessionGroup } from '~/utils/dashboard'
import type { EnvState, EnvTransition } from '#shared/utils/run'
import { computed, ref, watch, nextTick, onMounted } from 'vue'
import { sessionObjectMeta, sessionTitle, sessionTicket, sessionBranch, sessionPr, projectStatusMeta, timeAgo, DOT_COLOR_VAR } from '~/utils/dashboard'
import { integrationUi } from '~/utils/integrations'
import KStatusBadge from '~/components/KStatusBadge.vue'
import { NuxtLink, UIcon, UTooltip } from '#components'
import { useRouter } from '#imports'

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
}

const props = defineProps<{
  groups: SessionGroup<Run>[]
  sessionTo: (group: SessionGroup<Run>) => RouteLocationRaw
  selectedSessionId?: number | null
}>()

// Manual sessions are named "New Preview Session" or "New Code Session" after how they started.
function sessionLabel(g: SessionGroup<Run>) {
  const first = g.runs.at(-1)!
  if (first.workflowId === null) return first.workflow.replace(/^New /, '')
  return first.workflow === sessionTitle(g) ? null : first.workflow
}

const rows = computed(() => props.groups.map((g) => {
  const head = g.runs[0]!
  const ticket = sessionTicket(g)
  const status = projectStatusMeta(head)
  return {
    group: g,
    title: sessionTitle(g),
    status,
    // Archived, stopped and closed are what almost every session ends as, so only the rest earn a badge.
    notable: status.dot !== 'neutral',
    closed: head.sessionStatus === 'closed',
    ticket: ticket && { ...ticket, meta: sessionObjectMeta(ticket.integration, ticket.kind) },
    label: sessionLabel(g),
    branch: sessionBranch(g),
    pr: sessionPr(g),
    at: head.createdAt,
    atFull: head.createdAt ? new Date(head.createdAt).toLocaleString() : undefined,
  }
}))

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
const box = ref<{ top: number, height: number } | null>(null)
// Only a box already on screen slides; one that appears just shows up where it belongs.
const boxSlides = ref(false)
function placeBox() {
  const id = hoveredSessionId.value ?? props.selectedSessionId
  const el = id == null ? undefined : rowEls.get(id)
  boxSlides.value = !!box.value
  box.value = el ? { top: el.offsetTop, height: el.offsetHeight } : null
}
watch([hoveredSessionId, () => props.selectedSessionId, () => props.groups], () => nextTick(placeBox))
onMounted(placeBox)
</script>

<template>
  <div
    class="relative flex flex-col gap-px"
    @mouseleave="hoveredSessionId = null"
  >
    <span
      v-if="box"
      class="pointer-events-none absolute inset-x-0 top-0 rounded-md border border-default bg-(--surface-glass) ease-out"
      :class="boxSlides ? 'transition-[translate,height] duration-200' : ''"
      :style="{ translate: `0 ${box.top}px`, height: `${box.height}px` }"
    />
    <div
      v-for="r in rows"
      :key="r.group.sessionId"
      :ref="el => setRowEl(r.group.sessionId, el)"
      class="relative flex flex-col gap-0.5 rounded-md px-3 py-3"
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
        <KStatusBadge
          v-if="r.notable"
          :meta="r.status"
        />
        <UTooltip
          v-else
          :text="r.atFull"
          :disabled="!r.atFull"
        >
          <span class="relative z-2 flex-none text-xs tabular-nums text-dimmed">{{ timeAgo(r.at) }}</span>
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
</template>
