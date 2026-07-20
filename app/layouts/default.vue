<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

const { user, clear } = useUserSession()
const route = useRoute()

// Collapsed sidebar state, persisted across navigations/reloads (SSR-safe).
const collapsed = useCookie<boolean>('knecht-sidebar-collapsed', { default: () => false })

// Triggers aren't a top-level concept: they're configured inside each workflow.
// Runs get their own history; run detail pages highlight the Runs tab.
const NAV = [
  { label: 'Projects', icon: 'i-lucide-box', to: '/projects', match: ['/', '/projects'] },
  { label: 'Workflows', icon: 'i-lucide-workflow', to: '/workflows', match: ['/workflows'] },
  { label: 'Runs', icon: 'i-lucide-play', to: '/runs', match: ['/runs'] },
]

function isActive(item: typeof NAV[number]) {
  return item.match.some(m => m === '/' ? route.path === '/' : route.path.startsWith(m))
}

const initials = computed(() => {
  const base = user.value?.name || user.value?.login || '?'
  return base.split(/[\s-]+/).map(s => s[0]).slice(0, 2).join('').toUpperCase()
})

async function logout() {
  await clear()
  await navigateTo('/login')
}

const userMenu: DropdownMenuItem[][] = [
  [
    { label: 'Settings', icon: 'i-lucide-settings-2', to: '/settings' },
    { label: 'Logout', icon: 'i-lucide-log-out', onSelect: logout },
  ],
]

// The system card: the instance's real host plus a live host/sandbox pulse,
// linking to the System page. One shared probe per app load (useSystemInfo).
const instanceHost = useRequestURL().host
const { data: system, status: systemStatus } = useSystemInfo()
const systemLine = computed(() => {
  if (systemStatus.value === 'pending') return { color: 'neutral' as const, text: 'Checking host…' }
  if (systemStatus.value === 'error') return { color: 'error' as const, text: 'Host unreachable' }
  if (!system.value?.ddevVersion) return { color: 'error' as const, text: 'ddev missing' }
  const n = system.value.hostContainers.length
  return { color: 'primary' as const, text: `${n} container${n === 1 ? '' : 's'} up` }
})

// Update banner: the shared probe already knows whether a newer release
// exists; the System page holds the changelog and the update button.
const updateTarget = computed(() =>
  system.value?.version.updateAvailable ? system.value.version.latest : null,
)
</script>

<template>
  <div class="relative flex h-screen overflow-hidden bg-(--surface-base) text-default">
    <KBgField />

    <aside
      class="relative z-20 flex h-full flex-none flex-col border-r border-default transition-[width] duration-200"
      :class="collapsed ? 'w-18' : 'w-62'"
      style="background: color-mix(in oklab, var(--surface-elevated) 60%, transparent); backdrop-filter: blur(12px)"
    >
      <div
        class="flex items-center border-b border-muted pb-4.5 pt-5.5"
        :class="collapsed ? 'justify-center px-2' : 'justify-between px-5'"
      >
        <NuxtLink
          v-if="!collapsed"
          to="/projects"
        >
          <KLogo :height="26" />
        </NuxtLink>
        <UButton
          :icon="collapsed ? 'i-lucide-panel-left-open' : 'i-lucide-panel-left-close'"
          color="neutral"
          variant="ghost"
          size="sm"
          :aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
          @click="() => { collapsed = !collapsed }"
        />
      </div>

      <nav class="flex flex-col gap-1 p-3">
        <div
          v-if="!collapsed"
          class="k-label px-3 pb-2 pt-1"
        >
          Navigation
        </div>
        <UTooltip
          v-for="item in NAV"
          :key="item.to"
          :text="item.label"
          :disabled="!collapsed"
          :content="{ side: 'right' }"
        >
          <NuxtLink
            :to="item.to"
            class="group relative flex items-center gap-3 rounded-md border py-2.5 text-sm font-medium transition-colors"
            :class="[
              isActive(item)
                ? 'border-default bg-(--surface-glass) text-highlighted'
                : 'border-transparent text-muted hover:text-toned',
              collapsed ? 'justify-center px-0' : 'px-3',
            ]"
          >
            <span
              v-if="isActive(item)"
              class="absolute inset-y-2 -left-px w-0.5 rounded-sm bg-primary"
              style="box-shadow: 0 0 8px var(--primary)"
            />
            <UIcon
              :name="item.icon"
              class="size-4.5 flex-none"
              :class="isActive(item) ? 'text-primary' : 'text-dimmed'"
            />
            <span v-if="!collapsed">{{ item.label }}</span>
          </NuxtLink>
        </UTooltip>
      </nav>

      <div class="mt-auto flex flex-col gap-3 p-4">
        <template v-if="updateTarget">
          <NuxtLink
            v-if="!collapsed"
            to="/system"
            class="flex items-center gap-2.5 rounded-lg border border-(--primary-border) px-3.5 py-3 transition-colors hover:bg-(--surface-glass)"
            style="background: color-mix(in oklab, var(--primary) 8%, transparent)"
          >
            <UIcon
              name="i-lucide-arrow-up-circle"
              class="size-4 flex-none text-primary"
            />
            <div class="min-w-0">
              <div class="k-mono truncate whitespace-nowrap text-2xs leading-snug text-primary">
                Update available
              </div>
              <div class="k-mono mt-1 whitespace-nowrap text-3xs text-dimmed">
                {{ system?.version.current }} → {{ updateTarget }}
              </div>
            </div>
          </NuxtLink>
          <UTooltip
            v-else
            :text="`Update ${updateTarget} available`"
            :content="{ side: 'right' }"
          >
            <NuxtLink
              to="/system"
              :aria-label="`Update ${updateTarget} available`"
              class="flex items-center justify-center rounded-md border border-(--primary-border) py-2.5 transition-colors hover:bg-(--surface-glass)"
              style="background: color-mix(in oklab, var(--primary) 8%, transparent)"
            >
              <UIcon
                name="i-lucide-arrow-up-circle"
                class="size-4.5 text-primary"
              />
            </NuxtLink>
          </UTooltip>
        </template>

        <NuxtLink
          v-if="!collapsed"
          to="/system"
          class="flex items-center gap-2.5 rounded-lg border bg-(--surface-muted) px-3.5 py-3 transition-colors"
          :class="route.path.startsWith('/system')
            ? 'border-default bg-(--surface-glass)'
            : 'border-default hover:bg-(--surface-glass)'"
        >
          <UIcon
            name="i-lucide-server"
            class="size-4 flex-none text-primary"
          />
          <div class="min-w-0">
            <div class="k-mono truncate whitespace-nowrap text-2xs leading-snug text-toned">
              {{ instanceHost }}
            </div>
            <div class="k-mono mt-1 flex items-center gap-1.5 whitespace-nowrap text-3xs uppercase tracking-wider text-dimmed">
              <KStatusDot
                :color="systemLine.color"
                :size="5"
              /> {{ systemLine.text }}
            </div>
          </div>
        </NuxtLink>
        <UTooltip
          v-else
          text="System"
          :content="{ side: 'right' }"
        >
          <NuxtLink
            to="/system"
            aria-label="System"
            class="flex items-center justify-center rounded-md border border-transparent py-2.5 transition-colors hover:bg-(--surface-glass)"
          >
            <UIcon
              name="i-lucide-server"
              class="size-4.5 text-primary"
            />
          </NuxtLink>
        </UTooltip>

        <UDropdownMenu
          :items="userMenu"
          :content="{ side: 'top', align: 'start' }"
        >
          <button
            class="flex w-full items-center gap-2.5 rounded-md py-1 text-left transition-colors hover:bg-(--surface-glass)"
            :class="collapsed ? 'justify-center px-0' : 'px-1'"
          >
            <span
              v-if="!user?.avatarUrl"
              class="grid size-7.5 flex-none place-items-center rounded-full border text-xs font-semibold text-primary"
              style="background: var(--lime-950); border-color: var(--primary-border); font-family: var(--font-mono)"
            >{{ initials }}</span>
            <UAvatar
              v-else
              :src="user.avatarUrl"
              :alt="user?.login"
              size="xs"
              class="flex-none"
            />
            <template v-if="!collapsed">
              <div class="min-w-0 flex-1">
                <div class="truncate text-2sm leading-tight text-toned">
                  {{ user?.name || user?.login }}
                </div>
                <div class="truncate text-2xs leading-snug text-dimmed">
                  Admin
                </div>
              </div>
              <UIcon
                name="i-lucide-settings-2"
                class="size-4 flex-none text-dimmed"
              />
            </template>
          </button>
        </UDropdownMenu>
      </div>
    </aside>

    <!-- scrollbar-gutter keeps the content width identical whether a page is
         tall enough to scroll or not, otherwise the ~15px scrollbar makes
         screens visibly "jump" in width between routes. -->
    <main class="relative z-10 min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
      <div class="mx-auto max-w-480 px-8 py-7">
        <slot />
      </div>
    </main>
  </div>
</template>
