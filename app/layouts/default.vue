<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

const { user, clear } = useUserSession()
const route = useRoute()

// Collapsed sidebar state, persisted across navigations/reloads (SSR-safe).
const collapsed = useCookie<boolean>('knecht-sidebar-collapsed', { default: () => false })

// Triggers aren't a top-level concept — they're configured inside each workflow.
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
  if (!system.value?.sysboxAvailable) return { color: 'error' as const, text: 'Sysbox missing' }
  const n = system.value.hostContainers.length
  return { color: 'primary' as const, text: `${n} container${n === 1 ? '' : 's'} up` }
})
</script>

<template>
  <div class="relative flex h-screen overflow-hidden bg-(--surface-base) text-(--text-default)">
    <KBgField />

    <aside
      class="relative z-20 flex h-full flex-none flex-col border-r border-(--border-default) transition-[width] duration-200"
      :class="collapsed ? 'w-[72px]' : 'w-[248px]'"
      style="background: color-mix(in oklab, var(--surface-elevated) 60%, transparent); backdrop-filter: blur(12px)"
    >
      <div
        class="flex items-center border-b border-(--border-muted) pb-[18px] pt-[22px]"
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
            class="group relative flex items-center gap-3 rounded-(--radius-md) border py-2.5 text-sm font-medium transition-colors"
            :class="[
              isActive(item)
                ? 'border-(--border-default) bg-(--surface-glass) text-(--text-highlighted)'
                : 'border-transparent text-(--text-muted) hover:text-(--text-toned)',
              collapsed ? 'justify-center px-0' : 'px-3',
            ]"
          >
            <span
              v-if="isActive(item)"
              class="absolute left-[-1px] top-[9px] bottom-[9px] w-[2.5px] rounded-sm bg-(--primary)"
              style="box-shadow: 0 0 8px var(--primary)"
            />
            <UIcon
              :name="item.icon"
              class="size-[18px] flex-none"
              :class="isActive(item) ? 'text-(--primary)' : 'text-(--text-dimmed)'"
            />
            <span v-if="!collapsed">{{ item.label }}</span>
          </NuxtLink>
        </UTooltip>
      </nav>

      <div class="mt-auto flex flex-col gap-3 p-4">
        <NuxtLink
          v-if="!collapsed"
          to="/system"
          class="flex items-center gap-2.5 rounded-(--radius-lg) border bg-(--surface-muted) px-3.5 py-3 transition-colors"
          :class="route.path.startsWith('/system')
            ? 'border-(--border-default) bg-(--surface-glass)'
            : 'border-(--border-default) hover:bg-(--surface-glass)'"
        >
          <UIcon
            name="i-lucide-server"
            class="size-4 flex-none text-(--text-primary)"
          />
          <div class="min-w-0">
            <div class="k-mono truncate whitespace-nowrap text-[11.5px] leading-[1.3] text-(--text-toned)">
              {{ instanceHost }}
            </div>
            <div class="k-mono mt-[3px] flex items-center gap-1.5 whitespace-nowrap text-[10.5px] uppercase tracking-[0.06em] text-(--text-dimmed)">
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
            class="flex items-center justify-center rounded-(--radius-md) border border-transparent py-2.5 transition-colors hover:bg-(--surface-glass)"
          >
            <UIcon
              name="i-lucide-server"
              class="size-[18px] text-(--text-primary)"
            />
          </NuxtLink>
        </UTooltip>

        <UDropdownMenu
          :items="userMenu"
          :content="{ side: 'top', align: 'start' }"
        >
          <button
            class="flex w-full items-center gap-2.5 rounded-(--radius-md) py-1 text-left transition-colors hover:bg-(--surface-glass)"
            :class="collapsed ? 'justify-center px-0' : 'px-1'"
          >
            <span
              v-if="!user?.avatarUrl"
              class="grid size-[30px] flex-none place-items-center rounded-full border text-[12px] font-semibold text-(--primary)"
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
                <div class="truncate text-[13px] leading-[1.2] text-(--text-toned)">
                  {{ user?.name || user?.login }}
                </div>
                <div class="truncate text-[11.5px] leading-[1.3] text-(--text-dimmed)">
                  Admin
                </div>
              </div>
              <UIcon
                name="i-lucide-settings-2"
                class="size-4 flex-none text-(--text-dimmed)"
              />
            </template>
          </button>
        </UDropdownMenu>
      </div>
    </aside>

    <!-- scrollbar-gutter keeps the content width identical whether a page is
         tall enough to scroll or not — otherwise the ~15px scrollbar makes
         screens visibly "jump" in width between routes. -->
    <main class="relative z-10 min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
      <div class="mx-auto max-w-[1920px] px-8 py-7">
        <slot />
      </div>
    </main>
  </div>
</template>
