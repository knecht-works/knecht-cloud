<script setup lang="ts">
const toast = useToast()

const { data: projects, refresh } = await useFetch('/api/projects')

const open = ref(false)
const selected = ref()
const connecting = ref(false)

// Repos load lazily when the modal opens (avoids a GitHub call on page load).
// NOTE: no `await` here — awaiting a useFetch with `immediate: false` never
// resolves (there is no request to wait for), which would hang the page's setup.
const { data: repos, status: reposStatus, execute: loadRepos } = useFetch('/api/github/repos', {
  immediate: false,
  transform: rows => rows.map(r => ({ ...r, label: r.fullName })),
})

watch(open, (isOpen) => {
  if (isOpen && !repos.value) loadRepos()
})

async function connect() {
  if (!selected.value) return
  connecting.value = true
  try {
    await $fetch('/api/projects', {
      method: 'POST',
      body: {
        githubId: selected.value.githubId,
        owner: selected.value.owner,
        name: selected.value.name,
        fullName: selected.value.fullName,
        defaultBranch: selected.value.defaultBranch,
        private: selected.value.private,
        cloneUrl: selected.value.cloneUrl,
      },
    })
    toast.add({ title: 'Project connected', color: 'success' })
    open.value = false
    selected.value = undefined
    await refresh()
  }
  catch (e) {
    toast.add({
      title: 'Failed to connect',
      description: (e as { data?: { statusMessage?: string } }).data?.statusMessage,
      color: 'error',
    })
  }
  finally {
    connecting.value = false
  }
}

async function disconnect(id: number) {
  await $fetch(`/api/projects/${id}`, { method: 'DELETE' })
  await refresh()
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar title="Projects">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            icon="i-lucide-plus"
            label="Connect repo"
            @click="open = true"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div
        v-if="!projects?.length"
        class="text-muted"
      >
        No projects yet. Connect a GitHub repo to get started.
      </div>

      <div
        v-else
        class="space-y-3"
      >
        <UCard
          v-for="p in projects"
          :key="p.id"
        >
          <div class="flex items-center justify-between gap-4">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <NuxtLink
                  :to="`/projects/${p.id}`"
                  class="truncate font-medium hover:underline"
                >
                  {{ p.fullName }}
                </NuxtLink>
                <UBadge
                  :color="p.private ? 'neutral' : 'success'"
                  variant="subtle"
                  size="sm"
                >
                  {{ p.private ? 'private' : 'public' }}
                </UBadge>
              </div>
              <p class="text-sm text-muted">
                Default branch: {{ p.defaultBranch }}
              </p>
            </div>
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              aria-label="Disconnect"
              @click="disconnect(p.id)"
            />
          </div>
        </UCard>
      </div>

      <UModal
        v-model:open="open"
        title="Connect a GitHub repo"
      >
        <template #body>
          <div class="space-y-4">
            <USelectMenu
              v-model="selected"
              :items="repos ?? []"
              :loading="reposStatus === 'pending'"
              placeholder="Select a repo…"
              icon="i-simple-icons-github"
              class="w-full"
            />
            <div class="flex justify-end gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                label="Cancel"
                @click="open = false"
              />
              <UButton
                label="Connect"
                :loading="connecting"
                :disabled="!selected"
                @click="connect"
              />
            </div>
          </div>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
