<script setup lang="ts">
import { useToastError } from '~/composables/useToastError'
import { ref } from 'vue'
import { $fetch, useRequestURL, useToast } from '#imports'
import { SHARE_PARAM } from '#shared/utils/preview-access'
import { previewHostname } from '#shared/utils/preview-host'
import { copyText } from '~/utils/clipboard'
import { UTooltip, UButton } from '#components'

const props = defineProps<{
  sessionId: number
}>()

const toastError = useToastError()
const toast = useToast()
const reqUrl = useRequestURL()

const sharing = ref(false)
async function share() {
  sharing.value = true
  try {
    const { token, expiresAt } = await $fetch(`/api/sessions/${props.sessionId}/share`, { method: 'POST' })
    const url = `${reqUrl.protocol}//${previewHostname(props.sessionId, reqUrl.host)}/?${SHARE_PARAM}=${token}`
    const until = new Date(expiresAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    try {
      await copyText(url)
      toast.add({ title: 'Share link copied', description: `Anyone with it can open the preview until ${until}.`, color: 'success' })
    }
    catch {
      toast.add({ title: `Share link, valid until ${until}`, description: url, color: 'warning' })
    }
  }
  catch (e) {
    toastError('Could not create the share link', e)
  }
  finally {
    sharing.value = false
  }
}
</script>

<template>
  <UTooltip text="Copy share link">
    <UButton
      icon="i-lucide-share-2"
      color="neutral"
      variant="ghost"
      size="xs"
      aria-label="Copy share link"
      :disabled="sharing"
      @click="share"
    />
  </UTooltip>
</template>
