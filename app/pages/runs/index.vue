<script setup lang="ts">
const { data: runs, refresh } = await useFetch('/api/runs')
const toast = useToast()

const statusColor = {
  queued: 'neutral',
  running: 'info',
  success: 'success',
  failed: 'error',
} as const

const deletingId = ref<number>()
async function remove(id: number) {
  deletingId.value = id
  try {
    await $fetch(`/api/runs/${id}`, { method: 'DELETE' })
    await refresh()
  }
  catch (e) {
    toast.add({
      title: 'Delete failed',
      description: (e as { data?: { statusMessage?: string } }).data?.statusMessage,
      color: 'error',
    })
  }
  finally {
    deletingId.value = undefined
  }
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar title="Runs">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div
        v-if="!runs?.length"
        class="text-muted"
      >
        No runs yet. Start one from the Workflows page.
      </div>

      <div
        v-else
        class="space-y-3"
      >
        <NuxtLink
          v-for="r in runs"
          :key="r.id"
          :to="`/runs/${r.id}`"
        >
          <UCard class="transition-colors hover:bg-elevated/50">
            <div class="flex items-center justify-between gap-4">
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <span class="font-medium">{{ r.workflow }}</span>
                  <UBadge
                    :color="statusColor[r.status]"
                    variant="subtle"
                    size="sm"
                  >
                    {{ r.status }}
                  </UBadge>
                </div>
                <p class="truncate text-sm text-muted">
                  {{ r.project }}
                </p>
              </div>
              <div class="flex items-center gap-1">
                <UButton
                  color="error"
                  variant="ghost"
                  icon="i-lucide-trash-2"
                  aria-label="Delete run"
                  :loading="deletingId === r.id"
                  @click.prevent.stop="remove(r.id)"
                />
                <UIcon
                  name="i-lucide-chevron-right"
                  class="size-5 text-muted"
                />
              </div>
            </div>
          </UCard>
        </NuxtLink>
      </div>
    </template>
  </UDashboardPanel>
</template>
