<script setup lang="ts">
const { user } = useUserSession()
</script>

<template>
  <div>
    <KTopBar
      title="Settings"
      sub="Account, host environment and agent configuration."
    />

    <div class="grid grid-cols-1 gap-[18px] lg:grid-cols-2">
      <KPanel
        title="Account"
        icon="i-simple-icons-github"
      >
        <div class="flex items-center gap-3.5">
          <UAvatar
            :src="user?.avatarUrl"
            :alt="user?.login"
            size="lg"
            class="flex-none"
          />
          <div class="min-w-0">
            <div class="text-sm text-(--text-toned)">
              {{ user?.name || user?.login }}
            </div>
            <div class="k-mono text-[11.5px] text-(--text-dimmed)">
              @{{ user?.login }}
            </div>
          </div>
        </div>
      </KPanel>

      <SystemPanel />

      <KPanel
        title="Agent"
        icon="i-lucide-sparkles"
        accent="var(--accent-orange)"
        class="lg:col-span-2"
      >
        <template #action>
          <span class="k-mono text-[11px] text-(--text-dimmed)">Planned</span>
        </template>
        <p class="text-[13px] text-(--text-muted)">
          OpenRouter key, model selection and run limits will live here. Not wired up yet.
        </p>
      </KPanel>
    </div>
  </div>
</template>
