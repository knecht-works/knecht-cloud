<script setup lang="ts">
import { NuxtPage, NuxtLayout, UApp } from '#components'
</script>

<template>
  <UApp :tooltip="{ delayDuration: 300, ignoreNonKeyboardFocus: true }">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
