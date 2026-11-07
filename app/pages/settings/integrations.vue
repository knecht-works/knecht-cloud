<script setup lang="ts">
const { user } = useUserSession()
const { data: integrations } = await useIntegrations()
const { data: members } = await useMembers()
const isOwner = computed(() => !!members.value?.find(m => m.id === user.value?.id)?.isOwner)
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
        :editable="isOwner"
      />
    </template>
  </div>
</template>
