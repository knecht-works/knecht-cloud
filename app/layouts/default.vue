<script setup lang="ts">
import type { NavigationMenuItem, DropdownMenuItem } from '@nuxt/ui'

const { user, clear } = useUserSession()

const items: NavigationMenuItem[][] = [
  [
    { label: 'Dashboard', icon: 'i-lucide-house', to: '/' },
    { label: 'Projects', icon: 'i-lucide-folder-git-2', to: '/projects' },
    { label: 'Workflows', icon: 'i-lucide-workflow', to: '/workflows' },
    { label: 'Runs', icon: 'i-lucide-play', to: '/runs' },
  ],
  [
    { label: 'Settings', icon: 'i-lucide-settings', to: '/settings' },
  ],
]

async function logout() {
  await clear()
  await navigateTo('/login')
}

const userMenu: DropdownMenuItem[][] = [
  [{ label: 'Logout', icon: 'i-lucide-log-out', onSelect: logout }],
]
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar
      collapsible
      resizable
    >
      <template #header="{ collapsed }">
        <span
          v-if="!collapsed"
          class="text-lg font-bold"
        >
          Knecht
        </span>
        <UIcon
          v-else
          name="i-lucide-box"
          class="size-6"
        />
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu
          :collapsed="collapsed"
          :items="items"
          orientation="vertical"
        />
      </template>

      <template #footer="{ collapsed }">
        <UDropdownMenu
          :items="userMenu"
          :content="{ side: 'top', align: 'start' }"
          class="w-full"
        >
          <UButton
            color="neutral"
            variant="ghost"
            block
            :square="collapsed"
            :class="collapsed ? '' : 'justify-start'"
          >
            <UAvatar
              :src="user ? `https://github.com/${user.login}.png` : undefined"
              :alt="user?.login"
              size="2xs"
            />
            <span
              v-if="!collapsed"
              class="truncate"
            >
              {{ user?.login }}
            </span>
          </UButton>
        </UDropdownMenu>
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
