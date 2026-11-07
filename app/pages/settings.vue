<script setup lang="ts">
const SECTIONS = [
  { label: 'Members', icon: 'i-lucide-users', to: '/settings' },
  { label: 'Agent', icon: 'i-lucide-sparkles', to: '/settings/agent' },
  { label: 'Integrations', icon: 'i-lucide-plug', to: '/settings/integrations' },
  { label: 'Advanced', icon: 'i-lucide-sliders-horizontal', to: '/settings/advanced' },
]
</script>

<template>
  <div>
    <KTopBar
      title="Settings"
      sub="Members, agent, integrations and advanced configuration."
    />

    <KSettingsNav
      :sections="SECTIONS"
      tabs
    >
      <NuxtPage />
    </KSettingsNav>
  </div>
</template>
