<script setup lang="ts">
const { data, status, error, refresh } = await useFetch('/api/system')
</script>

<template>
  <UApp>
    <UContainer class="py-12">
      <h1 class="text-2xl font-bold">
        Knecht
      </h1>
      <p class="mb-6 text-sm text-gray-500 dark:text-gray-400">
        Walking skeleton — UI → Daemon → ddev / Docker
      </p>

      <UCard>
        <div v-if="status === 'pending'">
          Lade Systeminfo…
        </div>
        <div
          v-else-if="error"
          class="text-red-500"
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
    </UContainer>
  </UApp>
</template>
