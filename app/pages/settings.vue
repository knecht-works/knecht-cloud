<script setup lang="ts">
import KTopBar from '~/components/KTopBar.vue'
import KSettingsNav from '~/components/KSettingsNav.vue'
import { NuxtPage } from '#components'

const SECTIONS = [
  { label: 'Account', icon: 'i-lucide-user-round', to: '/settings' },
  { label: 'Agent', icon: 'i-lucide-sparkles', to: '/settings/agent' },
  { label: 'Integrations', icon: 'i-lucide-plug', to: '/settings/integrations' },
  { label: 'Advanced', icon: 'i-lucide-sliders-horizontal', to: '/settings/advanced' },
]
</script>

<template>
  <div>
    <KTopBar title="Settings" />

    <KSettingsNav
      :sections="SECTIONS"
      tabs
    >
      <NuxtPage />
    </KSettingsNav>
  </div>
</template>
