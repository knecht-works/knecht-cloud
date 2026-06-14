<script setup lang="ts">
// Triggers are fully data-driven. The backend has no trigger feature yet, so
// /api/triggers returns [] and this renders its empty state; the card grid +
// metrics below light up automatically once real triggers exist.
const { data: triggers } = await useFetch('/api/triggers', { default: () => [] })

const metrics = computed(() => {
  const list = triggers.value ?? []
  return {
    total: list.length,
    active: list.filter(t => t.active).length,
    fires: list.reduce((sum, t) => sum + t.firedCount, 0),
    sources: new Set(list.map(t => t.source)).size,
  }
})
</script>

<template>
  <div>
    <KTopBar title="Triggers">
      <template #actions>
        <UTooltip text="Triggers aren't wired up yet">
          <UButton
            icon="i-lucide-plus"
            label="New trigger"
            color="primary"
            disabled
          />
        </UTooltip>
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
          Triggers will start workflows automatically — on a GitHub push, on a schedule, or
          from a webhook. They aren't wired up yet; for now, start workflows manually from a
          project or the workflow page.
        </p>
      </div>
      <div class="mt-1 flex items-center gap-2.5">
        <span class="k-mono flex items-center gap-1.5 rounded-full border border-(--border-default) bg-(--surface-glass) px-3 py-1.5 text-[11.5px] text-(--text-muted)">
          <KStatusDot
            color="violet"
            :size="5"
          /> Coming soon
        </span>
        <UButton
          to="/workflows"
          color="neutral"
          variant="outline"
          size="sm"
          trailing-icon="i-lucide-arrow-right"
          label="Go to workflows"
        />
      </div>
    </div>

    <!-- Trigger grid (renders once triggers exist) -->
    <div
      v-else
      class="grid grid-cols-1 gap-4 lg:grid-cols-2"
    >
      <TriggerCard
        v-for="(t, i) in triggers"
        :key="i"
        :trigger="t"
      />
    </div>
  </div>
</template>
