<script setup lang="ts">
const { data: integrations } = await useFetch('/api/integrations', { default: () => [] })
</script>

<template>
  <div class="flex flex-col gap-4.5">
    <template
      v-for="integration in integrations"
      :key="integration.id"
    >
      <KIntegrationConnection
        v-if="integration.connectionForm"
        :id="integration.id"
        :name="integration.name"
        :form="integration.connectionForm"
      />
    </template>
  </div>
</template>
