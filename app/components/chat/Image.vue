<script setup lang="ts">
import { agentImageFile } from '#shared/utils/agent-images'
import { CHAT_SESSION_ID } from '~/utils/chat'
import { computed, inject } from 'vue'
import ChatAgentImages from '~/components/chat/AgentImages.vue'

const props = defineProps<{ src?: string, alt?: string }>()

const sessionId = inject(CHAT_SESSION_ID)!
const file = computed(() => props.src ? agentImageFile(props.src) : null)
// While a reply streams, a half-written path would load as a dashboard route.
const external = computed(() => /^(?:https?|data):/.test(props.src ?? ''))
</script>

<template>
  <ChatAgentImages
    v-if="file"
    :session-id="sessionId"
    :files="[file]"
    large
    class="mr-1 mb-2"
  />
  <img
    v-else-if="external"
    :src="src"
    :alt="alt"
  >
</template>
