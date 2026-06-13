<script setup lang="ts">
const route = useRoute()
const toast = useToast()
const id = Number(route.params.id)

const { data: project } = await useFetch(`/api/projects/${id}`)

// Local editable copies (deep-copied so we don't mutate the fetched cache).
const siteUrl = ref(project.value?.siteUrl ?? '')
const envVars = ref((project.value?.envVars ?? []).map(e => ({ ...e })))
const saving = ref(false)

function addEnv() {
  envVars.value.push({ key: '', value: '' })
}
function removeEnv(index: number) {
  envVars.value.splice(index, 1)
}

async function save() {
  saving.value = true
  try {
    await $fetch(`/api/projects/${id}`, {
      method: 'PATCH',
      body: {
        siteUrl: siteUrl.value.trim() || null,
        envVars: envVars.value.filter(e => e.key.trim()),
      },
    })
    toast.add({ title: 'Saved', color: 'success' })
  }
  catch (e) {
    toast.add({
      title: 'Failed to save',
      description: (e as { data?: { statusMessage?: string } }).data?.statusMessage,
      color: 'error',
    })
  }
  finally {
    saving.value = false
  }
}

// Database dump upload
const dumpInput = ref<HTMLInputElement>()
const uploadingDump = ref(false)
const dumpName = computed(() => project.value?.dbDumpPath?.split('/').pop() ?? null)

async function uploadDump(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  uploadingDump.value = true
  try {
    const form = new FormData()
    form.append('file', file)
    project.value = await $fetch(`/api/projects/${id}/dump`, { method: 'POST', body: form })
    toast.add({ title: 'Database dump uploaded', color: 'success' })
  }
  catch (e) {
    toast.add({
      title: 'Upload failed',
      description: (e as { data?: { statusMessage?: string } }).data?.statusMessage,
      color: 'error',
    })
  }
  finally {
    uploadingDump.value = false
    input.value = ''
  }
}

async function removeDump() {
  project.value = await $fetch(`/api/projects/${id}/dump`, { method: 'DELETE' })
  toast.add({ title: 'Dump removed', color: 'success' })
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar :title="project?.fullName ?? 'Project'">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            to="/projects"
            color="neutral"
            variant="ghost"
            icon="i-lucide-arrow-left"
            label="Back"
          />
          <UButton
            label="Save"
            icon="i-lucide-save"
            :loading="saving"
            @click="save"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div
        v-if="project"
        class="max-w-2xl space-y-6"
      >
        <div class="flex items-center gap-2">
          <UBadge
            :color="project.private ? 'neutral' : 'success'"
            variant="subtle"
            size="sm"
          >
            {{ project.private ? 'private' : 'public' }}
          </UBadge>
          <span class="text-sm text-muted">Default branch: {{ project.defaultBranch }}</span>
        </div>

        <UCard>
          <template #header>
            <h2 class="font-semibold">
              General
            </h2>
          </template>
          <UFormField
            label="Site URL"
            description="Optional. The booted app's public URL."
          >
            <UInput
              v-model="siteUrl"
              placeholder="https://example.test"
              class="w-full"
            />
          </UFormField>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="font-semibold">
                Environment variables
              </h2>
              <UButton
                size="xs"
                variant="subtle"
                icon="i-lucide-plus"
                label="Add"
                @click="addEnv"
              />
            </div>
          </template>

          <div
            v-if="!envVars.length"
            class="text-sm text-muted"
          >
            No variables yet.
          </div>
          <div
            v-else
            class="space-y-2"
          >
            <div
              v-for="(env, index) in envVars"
              :key="index"
              class="flex items-center gap-2"
            >
              <UInput
                v-model="env.key"
                placeholder="KEY"
                class="flex-1"
              />
              <UInput
                v-model="env.value"
                placeholder="value"
                class="flex-1"
              />
              <UButton
                color="error"
                variant="ghost"
                icon="i-lucide-trash-2"
                aria-label="Remove"
                @click="removeEnv(index)"
              />
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <h2 class="font-semibold">
              Database
            </h2>
          </template>
          <div class="space-y-3">
            <p class="text-sm text-muted">
              Optional SQL dump. Imported once into the ddev volume on the first boot.
            </p>

            <div
              v-if="dumpName"
              class="flex items-center gap-2"
            >
              <UIcon
                name="i-lucide-database"
                class="size-4 text-muted"
              />
              <span class="text-sm">{{ dumpName }}</span>
              <UButton
                size="xs"
                color="error"
                variant="ghost"
                icon="i-lucide-trash-2"
                label="Remove"
                @click="removeDump"
              />
            </div>

            <div>
              <input
                ref="dumpInput"
                type="file"
                class="hidden"
                accept=".sql,.gz,.sql.gz,.zip,.bz2,.xz,.tar,.mysql"
                @change="uploadDump"
              >
              <UButton
                :label="dumpName ? 'Replace dump' : 'Upload dump'"
                icon="i-lucide-upload"
                variant="subtle"
                :loading="uploadingDump"
                @click="dumpInput?.click()"
              />
            </div>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
