<script setup lang="ts">
// Only mounts when logged in (gated by the parent), so this fetch — and the
// requireUserSession on /api/system — never runs for anonymous visitors.
const { data, status, error, refresh } = await useFetch('/api/system')
</script>

<template>
  <UCard>
    <div v-if="status === 'pending'">
      Lade Systeminfo…
    </div>
    <div
      v-else-if="error"
      class="text-error"
    >
      Fehler: {{ error.message }}
    </div>
    <div
      v-else-if="data"
      class="space-y-3"
    >
      <div>
        <span class="font-medium">ddev:</span> {{ data.ddevVersion }}
      </div>
      <div>
        <span class="font-medium">
          Host-Container ({{ data.hostContainers.length }}):
        </span>
        <ul class="mt-1 list-inside list-disc text-sm">
          <li
            v-for="name in data.hostContainers"
            :key="name"
          >
            {{ name }}
          </li>
        </ul>
      </div>
    </div>

    <template #footer>
      <UButton
        size="sm"
        :loading="status === 'pending'"
        @click="refresh()"
      >
        Aktualisieren
      </UButton>
    </template>
  </UCard>
</template>
