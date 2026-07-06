<script setup lang="ts">
// The host's engine room, reached through the sidebar's system card: docker
// daemon, sysbox runtime and the knecht containers running on the host.
</script>

<template>
  <div>
    <KTopBar
      title="System"
      sub="Host daemon, sandbox runtime and running containers."
    >
      <template #actions>
        <AppSearch />
      </template>
    </KTopBar>

    <SystemPanel />
  </div>
</template>
