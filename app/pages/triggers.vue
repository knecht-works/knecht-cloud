<script setup lang="ts">
// Triggers fire workflows automatically — on a cron schedule, a GitHub webhook,
// or on demand. The list, metrics and card grid are data-driven off /api/triggers;
// the cards emit toggle/run/delete intent that this page sends back to the API.
const { data: triggers, refresh } = await useFetch('/api/triggers', { default: () => [] })
const toast = useToast()
const showCreate = ref(false)

type Trigger = NonNullable<typeof triggers.value>[number]

const metrics = computed(() => {
  const list = triggers.value ?? []
  return {
    total: list.length,
    active: list.filter(t => t.active).length,
    fires: list.reduce((sum, t) => sum + t.firedCount, 0),
    sources: new Set(list.map(t => t.source)).size,
  }
})

async function toggle(t: Trigger) {
  try {
    await $fetch(`/api/triggers/${t.id}`, { method: 'PATCH', body: { active: !t.active } })
    await refresh()
  }
  catch (e) {
    toast.add({ title: 'Failed to update trigger', description: errMsg(e, ''), color: 'error' })
  }
}

async function run(t: Trigger) {
  try {
    const res = await $fetch(`/api/triggers/${t.id}/run`, { method: 'POST' })
    toast.add({ title: `Fired ${res.runIds.length} run(s)`, color: 'success' })
    await refresh()
  }
  catch (e) {
    toast.add({ title: 'Failed to fire trigger', description: errMsg(e, ''), color: 'error' })
  }
}

async function remove(t: Trigger) {
  try {
    await $fetch(`/api/triggers/${t.id}`, { method: 'DELETE' })
    await refresh()
  }
  catch (e) {
    toast.add({ title: 'Failed to delete trigger', description: errMsg(e, ''), color: 'error' })
  }
}
</script>

<template>
  <div>
    <KTopBar title="Triggers">
      <template #actions>
        <AppSearch />
        <UButton
          icon="i-lucide-plus"
          label="New trigger"
          color="neutral"
          @click="showCreate = true"
        />
      </template>
    </KTopBar>

    <div class="mb-[22px] grid grid-cols-2 gap-4 lg:grid-cols-4">
      <KMetric
        :value="metrics.total"
        label="Triggers"
      />
      <KMetric
        :value="metrics.active"
        label="Active"
        accent="var(--primary)"
      />
      <KMetric
        :value="metrics.fires"
        label="Total fires"
        accent="var(--accent-orange)"
      />
      <KMetric
        :value="metrics.sources"
        label="Sources connected"
      />
    </div>

    <!-- Empty state — no triggers yet -->
    <div
      v-if="!triggers.length"
      class="k-card flex flex-col items-center gap-4 px-6 py-16 text-center"
    >
      <img
        src="/mascot/mascotRight.png"
        alt="Knecht"
        class="h-20 w-auto"
        style="filter: var(--drop-shadow-mascot)"
      >
      <div>
        <div class="text-sm font-medium text-(--text-toned)">
          No triggers configured yet
        </div>
        <p class="mx-auto mt-1.5 max-w-[420px] text-[13px] leading-[1.5] text-(--text-muted)">
          A trigger starts a workflow automatically — on a cron schedule, on a GitHub push,
          or on demand. Create one to wire a workflow to an event.
        </p>
      </div>
      <UButton
        icon="i-lucide-plus"
        label="New trigger"
        color="primary"
        @click="showCreate = true"
      />
    </div>

    <!-- Trigger grid -->
    <div
      v-else
      class="grid grid-cols-1 gap-4 lg:grid-cols-2"
    >
      <TriggerCard
        v-for="t in triggers"
        :key="t.id"
        :trigger="t"
        @toggle="toggle(t)"
        @run="run(t)"
        @remove="remove(t)"
      />
    </div>

    <TriggerCreateModal
      v-model:open="showCreate"
      @created="refresh"
    />
  </div>
</template>
