<script setup lang="ts">
const { user, clear, fetch: refreshSession } = useUserSession()
const toast = useToast()
const toastError = useToastError()

const { data: signIn, refresh: refreshSignIn } = await useFetch('/api/me/sign-in')

async function logout() {
  await clear()
  await navigateTo('/login')
}

const fileInput = ref<HTMLInputElement>()
const uploading = ref(false)
async function upload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  uploading.value = true
  try {
    await $fetch('/api/me/avatar', { method: 'PUT', body: { image: await squareImageDataUrl(file) } })
    await refreshSession()
  }
  catch (e) {
    toastError('Could not upload the picture', e)
  }
  finally {
    uploading.value = false
    fileInput.value!.value = ''
  }
}

async function removePicture() {
  try {
    await $fetch('/api/me/avatar', { method: 'DELETE' })
    await refreshSession()
  }
  catch (e) {
    toastError('Could not remove the picture', e)
  }
}

const name = ref(user.value?.name ?? '')
const savingName = ref(false)
const nameChanged = computed(() => name.value.trim() !== (user.value?.name ?? ''))
async function saveName() {
  savingName.value = true
  try {
    await $fetch('/api/me', { method: 'PATCH', body: { name: name.value } })
    await refreshSession()
    name.value = user.value?.name ?? ''
    toast.add({ title: 'Name saved', color: 'success' })
  }
  catch (e) {
    toastError('Could not save the name', e)
  }
  finally {
    savingName.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <KPanel
      title="Profile"
      icon="i-lucide-user-round"
      accent="var(--primary)"
    >
      <template #action>
        <UButton
          label="Sign out"
          icon="i-lucide-log-out"
          color="neutral"
          variant="ghost"
          size="xs"
          @click="logout"
        />
      </template>

      <div class="flex flex-col gap-6">
        <div class="flex items-center gap-4">
          <UAvatar
            :src="user?.avatarUrl ?? undefined"
            :alt="user?.name || user?.login"
            size="3xl"
            class="flex-none"
          />
          <div class="flex flex-col gap-2">
            <div class="flex gap-2">
              <UButton
                label="Upload picture"
                icon="i-lucide-upload"
                color="neutral"
                variant="subtle"
                size="sm"
                :loading="uploading"
                @click="fileInput?.click()"
              />
              <UButton
                v-if="user?.avatarUrl"
                label="Remove"
                color="neutral"
                variant="ghost"
                size="sm"
                @click="removePicture"
              />
            </div>
            <p class="text-xs text-dimmed">
              PNG, JPEG or WebP. Cropped to a square.
            </p>
          </div>
          <input
            ref="fileInput"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            class="hidden"
            @change="upload"
          >
        </div>

        <form
          class="grid max-w-md gap-4"
          @submit.prevent="saveName"
        >
          <UFormField label="Display name">
            <div class="flex gap-2">
              <UInput
                v-model="name"
                :placeholder="user?.login"
                class="flex-1"
              />
              <UButton
                type="submit"
                label="Save"
                color="neutral"
                variant="subtle"
                :loading="savingName"
                :disabled="!nameChanged"
              />
            </div>
          </UFormField>
          <UFormField label="Username">
            <UInput
              :model-value="`@${user?.login}`"
              readonly
              disabled
              class="w-full"
              :ui="{ base: 'k-mono' }"
            />
          </UFormField>
        </form>
      </div>
    </KPanel>

    <KPanel
      title="Sign-in methods"
      icon="i-lucide-key-round"
      accent="var(--primary)"
    >
      <KSignInMethods
        v-if="signIn"
        :methods="signIn"
        @changed="refreshSignIn"
      />
    </KPanel>
  </div>
</template>
