<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

const { user, clear } = useUserSession()
const { data: members } = useMembers()
const isOwner = computed(() => !!members.value.find(m => m.id === user.value?.id)?.isOwner)
const route = useRoute()

const collapsed = useCookie<boolean>('knecht-sidebar-collapsed', { default: () => false })

const NAV = [
  { label: 'Projects', icon: 'i-lucide-box', to: '/projects', match: ['/', '/projects'] },
  { label: 'Workflows', icon: 'i-lucide-workflow', to: '/workflows', match: ['/workflows'] },
  { label: 'Sessions', icon: 'i-lucide-play', to: '/sessions', match: ['/sessions'] },
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

const { data: system, status: systemStatus } = useSystemInfo()
const systemLine = computed(() => {
  if (systemStatus.value === 'pending') return { color: 'neutral' as const, text: 'Checking host…' }
  if (systemStatus.value === 'error') return { color: 'error' as const, text: 'Host unreachable' }
  if (!system.value?.ddevVersion) return { color: 'error' as const, text: 'ddev missing' }
  const n = system.value.hostContainers.length
  return { color: 'primary' as const, text: `${n} container${n === 1 ? '' : 's'} up` }
})

const userMenu: DropdownMenuItem[][] = [
  [{ type: 'label', slot: 'account' }],
  [
    { label: 'Settings', icon: 'i-lucide-settings-2', to: '/settings' },
    { label: 'System', icon: 'i-lucide-server', to: '/system', slot: 'system' },
  ],
  [{ label: 'Logout', icon: 'i-lucide-log-out', color: 'error', onSelect: logout }],
]

const updateTarget = computed(() =>
  system.value?.version.updateAvailable ? system.value.version.latest : null,
)
</script>

<template>
  <div class="relative flex h-screen overflow-hidden bg-(--surface-base) text-default">
    <KBgField />

    <aside
      class="relative z-20 flex h-full flex-none flex-col border-r border-default transition-[width] duration-200"
      :class="collapsed ? 'w-16' : 'w-56'"
    >
      <div
        class="flex items-center border-b border-muted py-3"
        :class="collapsed ? 'justify-center px-2' : 'justify-between px-4'"
      >
        <NuxtLink
          v-if="!collapsed"
          to="/projects"
          class="flex"
        >
          <KLogo :height="24" />
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

      <div class="px-3 pt-3">
        <KAppSearch :collapsed="collapsed" />
      </div>

      <nav class="flex flex-col gap-1 p-3">
        <UTooltip
          v-for="item in NAV"
          :key="item.to"
          :text="item.label"
          :disabled="!collapsed"
          :content="{ side: 'right' }"
        >
          <NuxtLink
            :to="item.to"
            class="group relative flex items-center gap-3 rounded-md border py-2 text-sm font-medium transition-colors"
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
              class="size-4 flex-none"
              :class="isActive(item) ? 'text-primary' : 'text-dimmed'"
            />
            <span v-if="!collapsed">{{ item.label }}</span>
          </NuxtLink>
        </UTooltip>
      </nav>

      <div class="mt-auto flex flex-col gap-2 p-3">
        <template v-if="updateTarget">
          <NuxtLink
            v-if="!collapsed"
            to="/system"
            class="flex items-center gap-2.5 rounded-lg border border-(--primary-border) bg-[color-mix(in_oklab,var(--primary)_8%,transparent)] px-3 py-2 transition-colors hover:border-primary hover:bg-[color-mix(in_oklab,var(--primary)_16%,transparent)]"
          >
            <UIcon
              name="i-lucide-arrow-up-circle"
              class="size-4 flex-none text-primary"
            />
            <div class="min-w-0 flex-1">
              <div class="truncate text-2sm font-medium leading-snug text-primary">
                Update available
              </div>
              <div class="mt-0.5 whitespace-nowrap text-2xs tabular-nums text-dimmed">
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
              class="flex items-center justify-center rounded-md border border-(--primary-border) bg-[color-mix(in_oklab,var(--primary)_8%,transparent)] py-2.5 transition-colors hover:border-primary hover:bg-[color-mix(in_oklab,var(--primary)_16%,transparent)]"
            >
              <UIcon
                name="i-lucide-arrow-up-circle"
                class="size-4.5 text-primary"
              />
            </NuxtLink>
          </UTooltip>
        </template>

        <UDropdownMenu
          :items="userMenu"
          :content="collapsed ? { side: 'right', align: 'end' } : { side: 'top', align: 'start' }"
          :ui="{ content: collapsed ? 'w-52' : 'w-(--reka-dropdown-menu-trigger-width)' }"
        >
          <button
            class="group flex w-full items-center gap-2.5 rounded-md py-1.5 text-left transition-colors hover:bg-(--surface-elevated) data-[state=open]:bg-(--surface-elevated)"
            :class="collapsed ? 'justify-center' : 'px-2'"
            aria-label="Account menu"
          >
            <span
              v-if="!user?.avatarUrl"
              class="grid size-6 flex-none place-items-center rounded-full border text-3xs font-semibold text-primary"
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
              <span class="min-w-0 flex-1 truncate text-2sm text-toned group-hover:text-highlighted">
                {{ user?.name || user?.login }}
              </span>
              <KStatusDot
                v-if="systemLine.color === 'error'"
                color="error"
                :size="6"
              />
              <UIcon
                name="i-lucide-chevrons-up-down"
                class="size-3.5 flex-none text-dimmed"
              />
            </template>
          </button>

          <template #account>
            <div class="min-w-0">
              <div class="truncate text-2sm font-medium text-highlighted">
                {{ user?.name || user?.login }}
              </div>
              <div class="truncate text-2xs font-normal text-dimmed">
                {{ isOwner ? 'Owner' : 'Member' }}
              </div>
            </div>
          </template>
          <template #system-trailing>
            <span class="ml-auto flex items-center gap-1.5 text-2xs text-dimmed">
              <KStatusDot
                :color="systemLine.color"
                :size="5"
              /> {{ systemLine.text }}
            </span>
          </template>
        </UDropdownMenu>
      </div>
    </aside>

    <main class="relative z-10 min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
      <div class="mx-auto max-w-480 px-8 py-7">
        <slot />
      </div>
    </main>
  </div>
</template>
