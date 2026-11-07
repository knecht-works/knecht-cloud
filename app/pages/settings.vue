<script setup lang="ts">
const SECTIONS = [
  { label: 'Profile', icon: 'i-lucide-user-round', to: '/settings/profile' },
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
      sub="Profile, members, agent, integrations and advanced configuration."
    />

    <KSettingsNav :sections="SECTIONS">
      <NuxtPage />
    </KSettingsNav>
  </div>
</template>
