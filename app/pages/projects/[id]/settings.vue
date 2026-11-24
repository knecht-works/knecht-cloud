<script setup lang="ts">
import { useRoute } from '#imports'
import KSettingsNav from '~/components/KSettingsNav.vue'
import { NuxtPage } from '#components'

const base = `/projects/${Number(useRoute().params.id)}/settings`
const SECTIONS = [
  { label: 'Environment', to: base },
  { label: 'Agent', to: `${base}/agent` },
  { label: 'Integrations', to: `${base}/integrations` },
  { label: 'Advanced', to: `${base}/advanced` },
]
</script>

<template>
  <KSettingsNav :sections="SECTIONS">
    <NuxtPage />
  </KSettingsNav>
</template>
